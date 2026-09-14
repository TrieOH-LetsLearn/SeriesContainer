/**
 * store.mjs — the content operations, running IN THE BROWSER against a
 * folder picked with the File System Access API. This is the port of the
 * old dev-server `editor/api.mjs`: same operations, same invariants.
 *
 * Content root = the picked folder's `content/` subfolder (created when a
 * project is initialized). Two presets, auto-detected:
 *
 *   hub  — home/home.md + projects/<slug>/{home.md, books/<book>/…}
 *   book — home.md + books/<book>/{book.md, chapters/…}   (one series)
 *
 * Every op returns { ok: true, data } or throws an Error with a friendly
 * message (the UI shows it as a toast).
 */

import * as fs from './fs.mjs';
import { parse as yamlParse, stringify as yamlStringify } from './vendor/yaml.js';

const BOOK_STATUSES = ['not-started', 'in-progress', 'complete'];
const PROJECT_STATUSES = ['draft', 'launching', 'live', 'archived'];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOK_ID_RE = /^book-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let root = null; // FileSystemDirectoryHandle of the content folder
let mode = null; // 'hub' | 'book'

class ApiError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

/** Open a picked folder as the working project. Descends into content/. */
export async function open(picked) {
	const hasContent = await hasDir(picked, 'content');
	root = hasContent ? await picked.getDirectoryHandle('content') : picked;
	mode = await detectMode();
	await fs.saveRootHandle(picked);
	return { mode };
}

/** Reconnect to the last folder (permission already granted). */
export async function restore() {
	const picked = await fs.loadRootHandle();
	if (!picked) return false;
	if ((await picked.queryPermission({ mode: 'readwrite' })) !== 'granted') return false;
	return open(picked).then(() => true);
}

/** Reconnect asking the user to re-grant permission. */
export async function restoreWithPrompt() {
	const picked = await fs.loadRootHandle();
	if (!picked) return false;
	if (!(await fs.ensurePermission(picked))) return false;
	return open(picked).then(() => true);
}

export async function close() {
	root = null;
	mode = null;
	await fs.forgetRootHandle();
}

/** True if `dir` contains a subdirectory called `name`. */
async function hasDir(dir, name) {
	try {
		await dir.getDirectoryHandle(name);
		return true;
	} catch {
		return false;
	}
}

async function detectMode() {
	if (await hasDir(root, 'projects')) return 'hub';
	if (await hasDir(root, 'home')) return 'hub';
	try {
		const fh = await root.getFileHandle('home.md');
		const raw = await (await fh.getFile()).text();
		if (raw) return 'book';
	} catch {
		/* no home.md */
	}
	return 'hub';
}

/** Human-readable label of the picked folder (for the header). */
export function rootLabel() {
	return root?.name ?? '';
}

// ---------------------------------------------------------------------------
// Validation (same rules as the server API)
// ---------------------------------------------------------------------------

function assertSlug(slug, label = 'Slug') {
	if (!SLUG_RE.test(slug)) {
		throw new ApiError(
			`Invalid ${label.toLowerCase()} "${slug}". Use lowercase letters, numbers and single hyphens (e.g. "what-a-loss-function-is").`
		);
	}
}

function assertOrder(order) {
	if (!Number.isInteger(order) || order < 0 || order > 9999) {
		throw new ApiError(`Invalid order "${order}". Use a whole number from 0 to 9999.`);
	}
}

function assertTitle(value, label) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ApiError(`${label} is required.`);
	}
	if (/\r|\n|\t/.test(value)) {
		throw new ApiError(`${label} must be a single line of text.`);
	}
	if (value.length > 300) {
		throw new ApiError(`${label} is too long (max 300 characters).`);
	}
}

function assertBody(body) {
	if (typeof body !== 'string') throw new ApiError('Body must be text.');
	if (body.length > 2_000_000) throw new ApiError('Body is too large (max 2 MB).');
}

function assertBookId(id) {
	if (typeof id !== 'string' || !BOOK_ID_RE.test(id)) {
		throw new ApiError(`Invalid book id "${id}". Expected book-<order>-<topic>.`);
	}
}

function assertChapterName(name) {
	if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		throw new ApiError(`Invalid chapter id "${name}".`);
	}
}

function assertUrl(url, label = 'Deploy URL') {
	if (url === undefined || url === null || url === '') return;
	if (typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
		throw new ApiError(`${label} must be an absolute http(s) URL.`);
	}
}

function assertStatus(status, allowed, label) {
	if (!allowed.includes(status)) {
		throw new ApiError(`Unknown ${label.toLowerCase()} "${status}". Expected ${allowed.join(' | ')}.`);
	}
}

function assertLinks(links) {
	if (links === undefined) return;
	if (!Array.isArray(links)) throw new ApiError('Links must be a list.');
	for (const link of links) {
		if (!link || typeof link.label !== 'string' || !link.label.trim()) {
			throw new ApiError('Each link needs a label.');
		}
		assertUrl(link.url, `Link "${link.label}"`);
	}
}

function assertIcon(icon) {
	if (icon !== undefined && icon !== '' && (typeof icon !== 'string' || icon.length > 8)) {
		throw new ApiError('Icon must be a short string (an emoji or a few characters).');
	}
}

// ---------------------------------------------------------------------------
// Naming (same encoding rules)
// ---------------------------------------------------------------------------

const BOOK_PREFIX_RE = /^book-(\d+)-(.*)$/;

function parseBookId(id) {
	const m = BOOK_PREFIX_RE.exec(id);
	if (!m) throw new ApiError(`Invalid book id "${id}".`, 500);
	return { order: Number(m[1]), topic: m[2] };
}

const bookIdFor = (slug, order) => `book-${order}-${slug}`;
const chapterNameFor = (slug, order) => `${String(order).padStart(2, '0')}-${slug}`;

const CHAPTER_NAME_RE = /^(\d+)-(.*)$/;

function parseChapterName(name) {
	const m = CHAPTER_NAME_RE.exec(name);
	if (!m) throw new ApiError(`Invalid chapter name "${name}".`, 500);
	return { order: Number(m[1]), topic: m[2] };
}

// ---------------------------------------------------------------------------
// Frontmatter (same canonical ordering + unknown-key survival)
// ---------------------------------------------------------------------------

function splitFrontmatter(raw) {
	const norm = raw.replace(/\r\n/g, '\n');
	if (!norm.startsWith('---\n')) return { fm: '', body: norm };
	const lines = norm.slice(4).split('\n');
	const closeIdx = lines.findIndex((line) => line === '---');
	if (closeIdx === -1) return { fm: '', body: norm };
	const fm = lines.slice(0, closeIdx).join('\n');
	let body = lines.slice(closeIdx + 1).join('\n');
	if (body.startsWith('\n')) body = body.slice(1);
	return { fm, body };
}

function parseMarkdown(raw) {
	const { fm, body } = splitFrontmatter(raw);
	if (!fm) return { data: {}, body };
	try {
		const data = yamlParse(fm);
		return { data: data && typeof data === 'object' ? data : {}, body };
	} catch {
		const data = {};
		for (const line of fm.split('\n')) {
			const colon = line.indexOf(':');
			if (colon === -1) continue;
			const key = line.slice(0, colon).trim();
			const val = line.slice(colon + 1).trim();
			if (/^-?\d+(\.\d+)?$/.test(val)) data[key] = Number(val);
			else if (val === 'true') data[key] = true;
			else if (val === 'false') data[key] = false;
			else data[key] = val.replace(/^['"]|['"]$/g, '');
		}
		return { data, body };
	}
}

function fmToYaml(obj, knownOrder) {
	const doc = {};
	for (const key of knownOrder) {
		if (obj[key] !== undefined && obj[key] !== null) doc[key] = obj[key];
	}
	for (const key of Object.keys(obj)) {
		if (!knownOrder.includes(key)) doc[key] = obj[key];
	}
	return yamlStringify(doc, { lineWidth: 0 }).replace(/\n$/, '');
}

async function writeMarkdown(dir, name, data, knownOrder, body) {
	const cleanBody = String(body ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
	const fm = fmToYaml(data, knownOrder);
	let out = `---\n${fm}\n---\n`;
	if (cleanBody) out += `\n${cleanBody}\n`;
	await fs.writeText(dir, name, out);
}

/** Carry over unknown frontmatter keys so manual extra fields survive a save. */
async function mergeUnknown(dir, name, data, knownKeys) {
	const raw = await fs.readText(dir, name);
	if (raw) {
		const fm = parseMarkdown(raw);
		for (const key of Object.keys(fm.data)) {
			if (!knownKeys.includes(key) && data[key] === undefined) data[key] = fm.data[key];
		}
	}
	return data;
}

// ---------------------------------------------------------------------------
// Paths — segment arrays into the content root, per preset
// ---------------------------------------------------------------------------

const projectSegs = (slug) => (mode === 'book' ? [] : ['projects', slug]);
const booksSegs = (project) => [...projectSegs(project), 'books'];
const bookSegs = (project, bookId) => [...booksSegs(project), bookId];
const chaptersSegs = (project, bookId) => [...bookSegs(project, bookId), 'chapters'];

const dirAt = (segs) => fs.getDir(root, segs, false);
const ensureAt = (segs) => fs.ensureDir(root, segs);

async function existsAt(segs, name) {
	const dir = await dirAt(segs).catch(() => null);
	if (!dir) return false;
	return (await fs.readText(dir, name)) !== null;
}

// ---------------------------------------------------------------------------
// Listing helpers
// ---------------------------------------------------------------------------

async function listChapterNames(project, bookId) {
	const dir = await dirAt(chaptersSegs(project, bookId)).catch(() => null);
	if (!dir) return [];
	return (await fs.listEntries(dir))
		.filter((e) => e.kind === 'file' && e.name.endsWith('.md'))
		.map((e) => e.name.slice(0, -3))
		.sort();
}

async function listBookIds(project) {
	const dir = await dirAt(booksSegs(project)).catch(() => null);
	if (!dir) return [];
	return (await fs.listEntries(dir))
		.filter((e) => e.kind === 'directory')
		.map((e) => e.name)
		.filter((n) => BOOK_ID_RE.test(n))
		.sort();
}

async function listProjectSlugs() {
	const dir = await dirAt(['projects']).catch(() => null);
	if (!dir) return [];
	return (await fs.listEntries(dir))
		.filter((e) => e.kind === 'directory')
		.map((e) => e.name)
		.filter((n) => SLUG_RE.test(n))
		.sort();
}

/** Read { fields, body } for a markdown file, or { exists: false }. */
async function readEntry(segs, name) {
	const dir = await dirAt(segs).catch(() => null);
	const raw = dir ? await fs.readText(dir, name) : null;
	return raw ? { exists: true, ...parseMarkdown(raw) } : { exists: false, data: {}, body: '' };
}

/** The books of one project (or the single series in book mode). */
async function listBooks(project) {
	const out = [];
	for (const bookId of await listBookIds(project)) {
		const bookRaw =
			(await fs.readText(await dirAt(bookSegs(project, bookId)).catch(() => null), 'book.md')) ?? '';
		const bookFm = parseMarkdown(bookRaw);
		const { order: encOrder } = parseBookId(bookId);
		const chapters = [];
		for (const name of await listChapterNames(project, bookId)) {
			const chRaw =
				(await fs.readText(await dirAt(chaptersSegs(project, bookId)).catch(() => null), `${name}.md`)) ?? '';
			const chFm = parseMarkdown(chRaw);
			const { order: encChOrder, topic: chTopic } = parseChapterName(name);
			chapters.push({
				name,
				topic: chTopic,
				order: chFm.data.order ?? encChOrder,
				title: chFm.data.title ?? name,
				body: chFm.body,
			});
		}
		chapters.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
		out.push({
			bookId,
			order: bookFm.data.order ?? encOrder,
			title: bookFm.data.title ?? bookId,
			shortTitle: bookFm.data.shortTitle ?? '',
			status: bookFm.data.status ?? 'not-started',
			body: bookFm.body,
			chapters,
		});
	}
	out.sort((a, b) => a.order - b.order || a.bookId.localeCompare(b.bookId));
	return out;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function catalog() {
	if (mode === 'book') {
		const home = await readEntry([], 'home.md');
		const books = await listBooks(null);
		return {
			mode,
			folder: rootLabel(),
			series: { exists: home.exists, fields: home.data, body: home.body, books },
			enums: { bookStatuses: BOOK_STATUSES },
		};
	}

	const hubRaw = await fs.readText(await dirAt(['home']).catch(() => null), 'home.md');
	const hubEntry = hubRaw
		? { exists: true, ...parseMarkdown(hubRaw) }
		: { exists: false, data: {}, body: '' };

	const projects = [];
	for (const slug of await listProjectSlugs()) {
		const home = await readEntry(['projects', slug], 'home.md');
		projects.push({ slug, home: { exists: home.exists, fields: home.data, body: home.body }, books: await listBooks(slug) });
	}
	projects.sort(
		(a, b) => (a.home.data.order ?? 999) - (b.home.data.order ?? 999) || a.slug.localeCompare(b.slug)
	);

	return {
		mode,
		folder: rootLabel(),
		hub: { id: 'home', exists: hubEntry.exists, fields: hubEntry.data, body: hubEntry.body },
		projects,
		enums: { projectStatuses: PROJECT_STATUSES, bookStatuses: BOOK_STATUSES },
	};
}

// ---------------------------------------------------------------------------
// Hub home (hub preset)
// ---------------------------------------------------------------------------

const HUB_KEYS = ['title', 'tagline', 'description', 'footer'];

async function saveHub(payload) {
	const { title, tagline, description, footer, body } = payload;
	assertTitle(title, 'Hub title');
	assertBody(body);
	for (const [v, label] of [
		[tagline, 'Tagline'],
		[description, 'Description'],
		[footer, 'Footer'],
	]) {
		if (v !== undefined && !['', undefined, null].includes(v)) assertTitle(v, label);
	}
	const dir = await ensureAt(['home']);
	const data = await mergeUnknown(dir, 'home.md', { title, tagline, description, footer }, HUB_KEYS);
	await writeMarkdown(dir, 'home.md', data, HUB_KEYS, body);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Series home (book preset) — content/home.md
// ---------------------------------------------------------------------------

const SERIES_KEYS = ['title', 'icon', 'tagline', 'description', 'footer', 'backLabel', 'links'];

async function saveSeries(payload) {
	const { title, tagline, description, icon, footer, backLabel, links, body } = payload;
	assertTitle(title, 'Series title');
	if (tagline !== undefined && !['', undefined, null].includes(tagline)) assertTitle(tagline, 'Tagline');
	if (description !== undefined && !['', undefined, null].includes(description)) {
		assertTitle(description, 'Description');
	}
	assertIcon(icon);
	if (footer !== undefined && !['', undefined, null].includes(footer)) assertTitle(footer, 'Footer');
	if (backLabel !== undefined && !['', undefined, null].includes(backLabel)) {
		assertTitle(backLabel, 'Back label');
	}
	assertLinks(links);
	assertBody(body);

	const data = await mergeUnknown(root, 'home.md', { title, icon, tagline, description, footer, backLabel, links }, SERIES_KEYS);
	await writeMarkdown(root, 'home.md', data, SERIES_KEYS, body);
	return {};
}

// ---------------------------------------------------------------------------
// Projects (hub preset — home.md doubles as the hub card)
// ---------------------------------------------------------------------------

const PROJECT_KEYS = [
	'title',
	'tagline',
	'description',
	'url',
	'status',
	'order',
	'icon',
	'footer',
	'backLabel',
	'links',
];

async function saveProject(payload) {
	const { slug, title, tagline, description, url, status, order, icon, footer, backLabel, links, body } = payload;
	assertSlug(slug, 'Project slug');
	assertTitle(title, 'Series title');
	if (tagline !== undefined && !['', undefined, null].includes(tagline)) assertTitle(tagline, 'Tagline');
	if (description !== undefined && !['', undefined, null].includes(description)) {
		assertTitle(description, 'Description');
	}
	assertUrl(url);
	assertStatus(status ?? 'draft', PROJECT_STATUSES, 'Status');
	assertOrder(order ?? 0);
	assertIcon(icon);
	if (footer !== undefined && !['', undefined, null].includes(footer)) assertTitle(footer, 'Footer');
	if (backLabel !== undefined && !['', undefined, null].includes(backLabel)) {
		assertTitle(backLabel, 'Back label');
	}
	assertLinks(links);
	assertBody(body);

	const existed = await existsAt(['projects', slug], 'home.md');
	const dir = await ensureAt(['projects', slug]);
	const data = await mergeUnknown(
		dir,
		'home.md',
		{ title, tagline, description, url, status, order, icon, footer, backLabel, links },
		PROJECT_KEYS
	);
	await writeMarkdown(dir, 'home.md', data, PROJECT_KEYS, body);
	return { slug, created: !existed };
}

async function deleteProject(payload) {
	const { slug } = payload;
	assertSlug(slug, 'Project slug');
	const dir = await dirAt(['projects']).catch(() => null);
	if (!dir) throw new ApiError(`Project "${slug}" does not exist.`, 404);
	await fs.removeDirRecursive(dir, slug);
	return { deleted: slug };
}

// ---------------------------------------------------------------------------
// Books (one folder per book: book.md + chapters/)
// ---------------------------------------------------------------------------

async function saveBook(payload) {
	const { project, id, slug, order, title, shortTitle, status, body } = payload;
	assertOrder(order);
	assertTitle(title, 'Title');
	assertTitle(shortTitle, 'Short title');
	assertStatus(status, BOOK_STATUSES, 'Status');
	assertBody(body);
	assertSlug(slug, 'Book slug');
	if (project) assertSlug(project, 'Project slug');

	const targetId = bookIdFor(slug, order);
	let finalId;
	const created = !id;

	if (id) {
		assertBookId(id);
		const oldDir = await dirAt(bookSegs(project, id)).catch(() => null);
		if (!oldDir) throw new ApiError(`Book "${id}" no longer exists. Refresh and try again.`, 404);
		const oldRaw = (await fs.readText(oldDir, 'book.md')) ?? '';
		const oldFm = parseMarkdown(oldRaw);
		const { order: encOrder, topic } = parseBookId(id);
		const orderChanged = (oldFm.data.order ?? encOrder) !== order;
		const slugChanged = topic !== slug;
		finalId = orderChanged || slugChanged ? targetId : id;

		if (finalId !== id) {
			if (await existsAt(booksSegs(project), finalId)) {
				throw new ApiError(`A book "${finalId}" already exists. Pick another slug or order.`, 409);
			}
			const parent = await ensureAt(booksSegs(project));
			await fs.renameDir(parent, id, finalId);
		}
		const dir = await ensureAt(bookSegs(project, finalId));
		const data = await mergeUnknown(dir, 'book.md', { title, shortTitle, order, status }, [
			'title',
			'shortTitle',
			'order',
			'status',
		]);
		await writeMarkdown(dir, 'book.md', data, ['title', 'shortTitle', 'order', 'status'], body);
	} else {
		finalId = targetId;
		if (await existsAt(booksSegs(project), finalId)) {
			throw new ApiError(`A book "${finalId}" already exists. Pick another slug or order.`, 409);
		}
		await ensureAt(chaptersSegs(project, finalId));
		const dir = await ensureAt(bookSegs(project, finalId));
		const data = await mergeUnknown(dir, 'book.md', { title, shortTitle, order, status }, [
			'title',
			'shortTitle',
			'order',
			'status',
		]);
		await writeMarkdown(dir, 'book.md', data, ['title', 'shortTitle', 'order', 'status'], body);
	}

	return { bookId: finalId, created, renamed: id !== undefined && finalId !== id };
}

async function deleteBook(payload) {
	const { project, id } = payload;
	assertBookId(id);
	const parent = await dirAt(booksSegs(project)).catch(() => null);
	if (!parent) throw new ApiError(`Book "${id}" does not exist.`, 404);
	await fs.removeDirRecursive(parent, id);
	return { deleted: `${project ?? ''}/${id}` };
}

// ---------------------------------------------------------------------------
// Chapters (NN-<topic>.md inside their book's chapters/ folder)
// ---------------------------------------------------------------------------

async function saveChapter(payload) {
	const { project, bookId, id, slug, order, title, body } = payload;
	assertBookId(bookId);
	assertSlug(slug, 'Chapter slug');
	assertOrder(order);
	assertTitle(title, 'Title');
	assertBody(body);

	const chaptersDir = await dirAt(chaptersSegs(project, bookId)).catch(() => null);
	if (!chaptersDir) throw new ApiError(`Book "${bookId}" does not exist.`, 404);

	const targetName = chapterNameFor(slug, order);
	let finalName;
	const created = !id;

	if (id) {
		assertChapterName(id);
		const oldRaw = await fs.readText(chaptersDir, `${id}.md`);
		if (oldRaw === null) throw new ApiError(`Chapter "${id}" no longer exists. Refresh and try again.`, 404);
		const oldFm = parseMarkdown(oldRaw);
		const { order: encOrder, topic } = parseChapterName(id);
		const orderChanged = (oldFm.data.order ?? encOrder) !== order;
		const slugChanged = topic !== slug;
		finalName = orderChanged || slugChanged ? targetName : id;

		if (finalName !== id) {
			if (await existsAt(chaptersSegs(project, bookId), `${finalName}.md`)) {
				throw new ApiError(`A chapter named "${finalName}.md" already exists.`, 409);
			}
			await fs.writeText(chaptersDir, `${finalName}.md`, oldRaw);
			await fs.removeFile(chaptersDir, `${id}.md`);
		}
		const data = await mergeUnknown(chaptersDir, `${finalName}.md`, { order, title }, ['order', 'title']);
		await writeMarkdown(chaptersDir, `${finalName}.md`, data, ['order', 'title'], body);
	} else {
		if (await existsAt(chaptersSegs(project, bookId), `${targetName}.md`)) {
			throw new ApiError(`A chapter named "${targetName}.md" already exists.`, 409);
		}
		const data = await mergeUnknown(chaptersDir, `${targetName}.md`, { order, title }, ['order', 'title']);
		await writeMarkdown(chaptersDir, `${targetName}.md`, data, ['order', 'title'], body);
		finalName = targetName;
	}

	return { chapterId: `${bookId}/${finalName}`, name: finalName, created };
}

async function deleteChapter(payload) {
	const { bookId, id } = payload;
	assertChapterName(id);
	const chaptersDir = await dirAt(chaptersSegs(payload.project, bookId)).catch(() => null);
	if (!chaptersDir) throw new ApiError(`Chapter "${id}" does not exist.`, 404);
	await fs.removeFile(chaptersDir, `${id}.md`);
	return { deleted: `${bookId}/${id}` };
}

// ---------------------------------------------------------------------------
// Initialize a project (scaffolding for the two presets)
// ---------------------------------------------------------------------------

const HUB_TEMPLATE = (title) => `---
title: ${yamlStringify(title).trim()}
tagline: ''
description: ''
footer: ''
---

Write the intro for your hub here — it renders under the grid of series.
`;

const BOOK_TEMPLATE = (title) => `---
title: ${yamlStringify(title).trim()}
icon: '📚'
tagline: ''
description: ''
footer: ''
backLabel: Home
links: []
---

Write the intro for your series here — it renders under the hero on the home page.
`;

/**
 * Scaffold a fresh project into the picked folder's content/ subfolder.
 *   preset 'hub'  → home/home.md + projects/
 *   preset 'book' → home.md + books/
 */
async function initialize(payload) {
	const { preset, title } = payload;
	if (!['hub', 'book'].includes(preset)) throw new ApiError('Unknown preset. Expected "hub" or "book".');
	if (typeof title !== 'string' || !title.trim()) throw new ApiError('Title is required.');

	const picked = pickedHandle;
	if (!picked) throw new ApiError('No folder chosen.', 409);

	const contentRoot = await fs.ensureDir(picked, ['content']);
	root = contentRoot;
	mode = preset;
	await fs.saveRootHandle(picked);

	if (preset === 'hub') {
		const home = await fs.ensureDir(contentRoot, ['home']);
		await fs.writeText(home, 'home.md', HUB_TEMPLATE(title));
		await fs.ensureDir(contentRoot, ['projects']);
	} else {
		await fs.writeText(contentRoot, 'home.md', BOOK_TEMPLATE(title));
		await fs.ensureDir(contentRoot, ['books']);
	}
	return { mode: preset };
}

// The picked folder handle, registered by the UI before initializing.
let pickedHandle = null;

/** Register the picked folder handle (before scaffolding). */
export function setPicked(handle) {
	pickedHandle = handle;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const OPS = {
	catalog,
	'hub/save': saveHub,
	'series/save': saveSeries,
	'project/save': saveProject,
	'project/delete': deleteProject,
	'book/save': saveBook,
	'book/delete': deleteBook,
	'chapter/save': saveChapter,
	'chapter/delete': deleteChapter,
	initialize,
};

/** Call a content op by name (same shape the old server API answered). */
export async function call(op, payload = {}) {
	const fn = OPS[op];
	if (!fn) throw new ApiError(`Unknown operation "${op}".`, 404);
	if (!root && op !== 'initialize') throw new ApiError('No folder open.', 409);
	const data = await fn(payload);
	return { ok: true, data };
}
