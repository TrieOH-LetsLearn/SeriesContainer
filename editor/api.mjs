/**
 * editorial/api.mjs — content operations for the editorial mode.
 *
 * Pure Node module (no Vite/Astro imports) that reads and writes every
 * authored file of the Learn platform on disk. Layout (repo root `content/`):
 *
 *   content/
 *     home/home.md                    hub (main home): identity + intro/footer copy
 *     projects/<slug>/                one folder per series
 *       home.md                       series home + catalog card (title, tagline,
 *                                     description, url, status, order, icon, links)
 *       books/<bookId>/               one folder per book (bookId = book-N-<topic>)
 *         book.md                     book frontmatter + intro body
 *         chapters/<NN>-<topic>.md    chapters live inside their book
 *
 * Invariants the module keeps on every operation:
 *   - a chapter's book is its parent folder (no name-linking needed);
 *   - renaming/re-slugging/reordering a book renames its folder;
 *   - creating a project writes its home.md (which doubles as the hub card),
 *     and deleting a project removes the folder tree.
 *
 * Used only by the dev-time editorial plugin (`dev-plugin.mjs`); it is never
 * part of a viewer build.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

const CONTENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../content');
const HOME_DIR = path.join(CONTENT_ROOT, 'home');
const PROJECTS_DIR = path.join(CONTENT_ROOT, 'projects');

const BOOK_STATUSES = ['not-started', 'in-progress', 'complete'];
const PROJECT_STATUSES = ['draft', 'launching', 'live', 'archived'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOK_ID_RE = /^book-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;

class ApiError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

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
	if (typeof body !== 'string') {
		throw new ApiError('Body must be text.');
	}
	if (body.length > 2_000_000) {
		throw new ApiError('Body is too large (max 2 MB).');
	}
}

function assertProjectSlug(slug) {
	assertSlug(slug, 'Project slug');
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
	if (url === undefined || url === null || url === '') return; // optional
	if (typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
		throw new ApiError(`${label} must be an absolute http(s) URL (e.g. https://networking.example.com).`);
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

/** Ensure a resolved path stays inside a root directory. */
function assertInside(root, candidate) {
	const rel = path.relative(root, candidate);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		throw new ApiError('Refusing a path outside the content tree.', 500);
	}
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const BOOK_PREFIX_RE = /^book-(\d+)-(.*)$/;

/** Split a book id into its encoded { order, topic }. */
function parseBookId(id) {
	const m = BOOK_PREFIX_RE.exec(id);
	if (!m) throw new ApiError(`Invalid book id "${id}".`, 500);
	return { order: Number(m[1]), topic: m[2] };
}

/** The canonical book folder name for a topic slug + order. */
function bookIdFor(slug, order) {
	return `book-${order}-${slug}`;
}

/** Zero-padded chapter filename for a topic slug + order. */
function chapterNameFor(slug, order) {
	return `${String(order).padStart(2, '0')}-${slug}`;
}

const CHAPTER_NAME_RE = /^(\d+)-(.*)$/;

/** Split a chapter filename into { order, topic }. */
function parseChapterName(name) {
	const m = CHAPTER_NAME_RE.exec(name);
	if (!m) throw new ApiError(`Invalid chapter name "${name}".`, 500);
	return { order: Number(m[1]), topic: m[2] };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const hubHomePath = () => path.join(HOME_DIR, 'home.md');
const projectDir = (slug) => path.join(PROJECTS_DIR, slug);
const projectHomePath = (slug) => path.join(projectDir(slug), 'home.md');
const bookDir = (slug, bookId) => path.join(projectDir(slug), 'books', bookId);
const bookFilePath = (slug, bookId) => path.join(bookDir(slug, bookId), 'book.md');
const chapterFilePath = (slug, bookId, name) =>
	path.join(bookDir(slug, bookId), 'chapters', `${name}.md`);

// ---------------------------------------------------------------------------
// Frontmatter via YAML
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

/** Parse markdown into { data, body }. Tolerant: falls back to flat scalars. */
function parseMarkdown(raw) {
	const { fm, body } = splitFrontmatter(raw);
	if (!fm) return { data: {}, body };
	try {
		const data = yamlParse(fm);
		return { data: data && typeof data === 'object' ? data : {}, body };
	} catch {
		// Hand-edited file with frontmatter YAML we can't parse: salvage flat
		// `key: value` lines so the editor can still list and rewrite it.
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

/**
 * Serialize an object to a frontmatter block, canonical known keys first
 * (in the order passed), unknown keys preserved afterwards.
 */
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

function writeMarkdown(filePath, data, knownOrder, body) {
	const cleanBody = String(body ?? '').replace(/^\n+/, '').replace(/\s+$/, '');
	const fm = fmToYaml(data, knownOrder);
	let out = `---\n${fm}\n---\n`;
	if (cleanBody) out += `\n${cleanBody}\n`;
	return fs.writeFile(filePath, out, 'utf8');
}

// ---------------------------------------------------------------------------
// Disk helpers
// ---------------------------------------------------------------------------

async function exists(p) {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function readIfExists(p) {
	try {
		return await fs.readFile(p, 'utf8');
	} catch {
		return null;
	}
}

async function listDir(dir) {
	try {
		return await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

async function listChapterNames(projectSlug, bookId) {
	const dir = path.join(bookDir(projectSlug, bookId), 'chapters');
	const entries = await listDir(dir);
	return entries
		.filter((e) => e.isFile() && e.name.endsWith('.md'))
		.map((e) => e.name.slice(0, -3))
		.sort();
}

async function listBookIds(projectSlug) {
	const entries = await listDir(path.join(projectDir(projectSlug), 'books'));
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((n) => BOOK_ID_RE.test(n))
		.sort();
}

async function listProjectSlugs() {
	const entries = await listDir(PROJECTS_DIR);
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((n) => SLUG_RE.test(n))
		.sort();
}

// Serialize filesystem mutations so renames can never interleave.
let opQueue = Promise.resolve();
function withLock(fn) {
	const run = opQueue.then(fn);
	opQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

/** Run an editorial operation under the module-wide mutation lock. */
export function withEditorLock(fn) {
	return withLock(fn);
}

/** Carry over unknown frontmatter keys so manual extra fields survive a save. */
async function mergeUnknown(filePath, data, knownKeys) {
	const raw = await readIfExists(filePath);
	if (raw) {
		const fm = parseMarkdown(raw);
		for (const key of Object.keys(fm.data)) {
			if (!knownKeys.includes(key) && data[key] === undefined) data[key] = fm.data[key];
		}
	}
	return data;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function listCatalog() {
	const hubRaw = await readIfExists(hubHomePath());
	const hub = hubRaw
		? { id: 'home', exists: true, ...parseMarkdown(hubRaw) }
		: { id: 'home', exists: false, data: {}, body: '' };

	const projects = [];
	for (const slug of await listProjectSlugs()) {
		const raw = await readIfExists(projectHomePath(slug));
		const home = raw
			? { exists: true, ...parseMarkdown(raw) }
			: { exists: false, data: {}, body: '' };
		const books = [];
		for (const bookId of await listBookIds(slug)) {
			const bookRaw = (await readIfExists(bookFilePath(slug, bookId))) ?? '';
			const bookFm = parseMarkdown(bookRaw);
			const { order: encOrder, topic } = parseBookId(bookId);
			const chapters = [];
			for (const name of await listChapterNames(slug, bookId)) {
				const chRaw = (await readIfExists(chapterFilePath(slug, bookId, name))) ?? '';
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
			books.push({
				bookId,
				order: bookFm.data.order ?? encOrder,
				title: bookFm.data.title ?? bookId,
				shortTitle: bookFm.data.shortTitle ?? '',
				status: bookFm.data.status ?? 'not-started',
				body: bookFm.body,
				chapters,
			});
		}
		books.sort((a, b) => a.order - b.order || a.bookId.localeCompare(b.bookId));
		projects.push({ slug, home, books });
	}
	projects.sort((a, b) => (a.home.data.order ?? 999) - (b.home.data.order ?? 999) || a.slug.localeCompare(b.slug));

	return {
		hub: { id: 'home', exists: hub.exists, fields: hub.data, body: hub.body },
		projects: projects.map((p) => ({
			slug: p.slug,
			home: { exists: p.home.exists, fields: p.home.data, body: p.home.body },
			books: p.books,
		})),
		enums: { projectStatuses: PROJECT_STATUSES, bookStatuses: BOOK_STATUSES },
	};
}

// ---------------------------------------------------------------------------
// Hub home
// ---------------------------------------------------------------------------

const HUB_KEYS = ['title', 'tagline', 'description', 'footer'];

async function saveHub(payload) {
	const { title, tagline, description, footer, body } = payload;
	assertTitle(title, 'Hub title');
	assertBody(body);
	if (tagline !== undefined && !['', undefined, null].includes(tagline)) assertTitle(tagline, 'Tagline');
	if (description !== undefined && !['', undefined, null].includes(description)) assertTitle(description, 'Description');
	if (footer !== undefined && !['', undefined, null].includes(footer)) assertTitle(footer, 'Footer');
	await fs.mkdir(HOME_DIR, { recursive: true });
	const data = await mergeUnknown(hubHomePath(), { title, tagline, description, footer }, HUB_KEYS);
	await writeMarkdown(hubHomePath(), data, HUB_KEYS, body);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Projects (each is a series; home.md doubles as the hub card)
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
	assertProjectSlug(slug);
	assertTitle(title, 'Series title');
	if (tagline !== undefined && !['', undefined, null].includes(tagline)) assertTitle(tagline, 'Tagline');
	if (description !== undefined && !['', undefined, null].includes(description)) assertTitle(description, 'Description');
	assertUrl(url);
	assertStatus(status ?? 'draft', PROJECT_STATUSES, 'Status');
	assertOrder(order ?? 0);
	assertIcon(icon);
	if (footer !== undefined && !['', undefined, null].includes(footer)) assertTitle(footer, 'Footer');
	if (backLabel !== undefined && !['', undefined, null].includes(backLabel)) assertTitle(backLabel, 'Back label');
	assertLinks(links);
	assertBody(body);

	await fs.mkdir(path.join(PROJECTS_DIR, slug), { recursive: true });
	const existed = await exists(projectHomePath(slug));
	const data = await mergeUnknown(
		projectHomePath(slug),
		{ title, tagline, description, url, status, order, icon, footer, backLabel, links },
		PROJECT_KEYS,
	);
	await writeMarkdown(projectHomePath(slug), data, PROJECT_KEYS, body);
	return { slug, created: !existed };
}

async function deleteProject(payload) {
	const { slug } = payload;
	assertProjectSlug(slug);
	const dir = projectDir(slug);
	if (!(await exists(dir))) throw new ApiError(`Project "${slug}" does not exist.`, 404);
	await fs.rm(dir, { recursive: true, force: true });
	return { deleted: slug };
}

// ---------------------------------------------------------------------------
// Books (one folder per book: book.md + chapters/)
// ---------------------------------------------------------------------------

async function saveBook(payload) {
	const { project, id, slug, order, title, shortTitle, status, body } = payload;
	assertProjectSlug(project);
	assertSlug(slug, 'Book slug');
	assertOrder(order);
	assertTitle(title, 'Title');
	assertTitle(shortTitle, 'Short title');
	assertStatus(status, BOOK_STATUSES, 'Status');
	assertBody(body);

	const dir = projectDir(project);
	if (!(await exists(dir))) {
		throw new ApiError(`Project "${project}" does not exist. Create the series first.`, 404);
	}

	const targetId = bookIdFor(slug, order);
	let finalId;
	let created = !id;

	if (id) {
		assertBookId(id);
		const oldBookDir = bookDir(project, id);
		if (!(await exists(oldBookDir))) {
			throw new ApiError(`Book "${id}" no longer exists on disk. Refresh and try again.`, 404);
		}
		const oldRaw = (await readIfExists(bookFilePath(project, id))) ?? '';
		const oldFm = parseMarkdown(oldRaw);
		const { order: encOrder, topic } = parseBookId(id);
		const orderChanged = (oldFm.data.order ?? encOrder) !== order;
		const slugChanged = topic !== slug;

		// Keep existing folder names unless order/slug actually changed
		// (folder names are the ids; everything else is inside them).
		finalId = orderChanged || slugChanged ? targetId : id;

		if (finalId !== id) {
			const newBookDir = bookDir(project, finalId);
			if (await exists(newBookDir)) {
				throw new ApiError(
					`A book "${finalId}" already exists in "${project}". Pick another slug or order.`,
					409,
				);
			}
			await fs.rename(oldBookDir, newBookDir);
		}
		const data = await mergeUnknown(
			bookFilePath(project, finalId),
			{ title, shortTitle, order, status },
			['title', 'shortTitle', 'order', 'status'],
		);
		await writeMarkdown(bookFilePath(project, finalId), data, ['title', 'shortTitle', 'order', 'status'], body);
	} else {
		finalId = targetId;
		const newBookDir = bookDir(project, finalId);
		if (await exists(newBookDir)) {
			throw new ApiError(
				`A book "${finalId}" already exists in "${project}". Pick another slug or order.`,
				409,
			);
		}
		await fs.mkdir(path.join(newBookDir, 'chapters'), { recursive: true });
		const data = await mergeUnknown(
			bookFilePath(project, finalId),
			{ title, shortTitle, order, status },
			['title', 'shortTitle', 'order', 'status'],
		);
		await writeMarkdown(bookFilePath(project, finalId), data, ['title', 'shortTitle', 'order', 'status'], body);
	}

	return { bookId: finalId, created, renamed: id !== undefined && finalId !== id };
}

async function deleteBook(payload) {
	const { project, id } = payload;
	assertProjectSlug(project);
	assertBookId(id);
	const dir = bookDir(project, id);
	if (!(await exists(dir))) throw new ApiError(`Book "${id}" does not exist.`, 404);
	await fs.rm(dir, { recursive: true, force: true });
	return { deleted: `${project}/${id}` };
}

// ---------------------------------------------------------------------------
// Chapters (NN-<topic>.md inside their book's chapters/ folder)
// ---------------------------------------------------------------------------

async function saveChapter(payload) {
	const { project, bookId, id, slug, order, title, body } = payload;
	assertProjectSlug(project);
	assertBookId(bookId);
	assertSlug(slug, 'Chapter slug');
	assertOrder(order);
	assertTitle(title, 'Title');
	assertBody(body);

	const bookFolder = bookDir(project, bookId);
	if (!(await exists(bookFilePath(project, bookId)))) {
		throw new ApiError(`Book "${bookId}" does not exist in "${project}".`, 404);
	}

	const targetName = chapterNameFor(slug, order);
	const targetPath = chapterFilePath(project, bookId, targetName);
	let finalName;
	let created = !id;

	if (id) {
		assertChapterName(id);
		const oldPath = chapterFilePath(project, bookId, id);
		if (!(await exists(oldPath))) {
			throw new ApiError(
				`Chapter "${id}" no longer exists on disk. Refresh and try again.`,
				404,
			);
		}
		const oldRaw = await fs.readFile(oldPath, 'utf8');
		const oldFm = parseMarkdown(oldRaw);
		const { order: encOrder, topic } = parseChapterName(id);
		const orderChanged = (oldFm.data.order ?? encOrder) !== order;
		const slugChanged = topic !== slug;
		finalName = orderChanged || slugChanged ? targetName : id;

		if (finalName !== id) {
			if (targetPath !== oldPath && (await exists(targetPath))) {
				throw new ApiError(
					`In book "${bookId}", a chapter named "${targetName}.md" already exists.`,
					409,
				);
			}
			if (targetPath !== oldPath) await fs.rename(oldPath, targetPath);
		}
		const data = await mergeUnknown(
			chapterFilePath(project, bookId, finalName),
			{ order, title },
			['order', 'title'],
		);
		await writeMarkdown(chapterFilePath(project, bookId, finalName), data, ['order', 'title'], body);
	} else {
		if (await exists(targetPath)) {
			throw new ApiError(
				`In book "${bookId}", a chapter named "${targetName}.md" already exists.`,
				409,
			);
		}
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		const data = await mergeUnknown(targetPath, { order, title }, ['order', 'title']);
		await writeMarkdown(targetPath, data, ['order', 'title'], body);
		finalName = targetName;
	}

	return { chapterId: `${bookId}/${finalName}`, name: finalName, created };
}

async function deleteChapter(payload) {
	const { project, bookId, id } = payload;
	assertProjectSlug(project);
	assertBookId(bookId);
	assertChapterName(id);
	const p = chapterFilePath(project, bookId, id);
	assertInside(CONTENT_ROOT, p);
	if (!(await exists(p))) throw new ApiError(`Chapter "${id}" does not exist.`, 404);
	await fs.unlink(p);
	return { deleted: `${bookId}/${id}` };
}

/** Whether a content area currently has zero files (recursive). */
async function areaEmpty(dir) {
	const entries = await listDir(dir);
	for (const e of entries) {
		if (e.isDirectory()) {
			if (!(await areaEmpty(path.join(dir, e.name)))) return false;
		} else if (e.name.endsWith('.md')) {
			return false;
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const editorialApi = {
	listCatalog,
	saveHub,
	saveProject,
	deleteProject,
	saveBook,
	deleteBook,
	saveChapter,
	deleteChapter,
	areaEmpty,
	ApiError,
	PROJECT_STATUSES,
	BOOK_STATUSES,
};
