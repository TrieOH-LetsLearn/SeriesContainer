/**
 * Smoke test for store.mjs — runs the full content lifecycle in Node by
 * mocking the File System Access API over a temp directory.
 *
 *   node test/store.test.mjs
 */
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.mjs';
import { MockDir } from './mock.mjs';

// ---------------------------------------------------------------------------
// File System Access API mock (enough surface for store.mjs + fs.mjs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

let failures = 0;
function ok(cond, label) {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failures++;
		console.error(`  ✗ ${label}`);
	}
}

async function call(op, payload) {
	return store.call(op, payload);
}

const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sc-editor-test-'));

// ===========================================================================
console.log('Hub preset lifecycle');
{
	const root = path.join(tmpBase, 'hub-project');
	await fsp.mkdir(root);
	store.setPicked(new MockDir(root));

	const init = await call('initialize', { preset: 'hub', title: 'Test Hub' });
	ok(init.data.mode === 'hub', 'initialize → hub mode');

	let cat = (await call('catalog')).data;
	ok(cat.mode === 'hub' && cat.hub.exists === true, 'catalog sees the scaffolded hub');
	ok(cat.projects.length === 0, 'no projects yet');

	await call('hub/save', { title: 'Test Hub', tagline: 'Learn things', description: 'd', footer: 'f', body: 'Hello hub' });
	cat = (await call('catalog')).data;
	ok(cat.hub.fields.title === 'Test Hub', 'hub/save round-trips');

	await call('project/save', {
		slug: 'ai', title: 'AI', tagline: '', description: '', url: '', status: 'live',
		order: 0, icon: '🧠', footer: '', backLabel: '', links: [{ label: 'Repo', url: 'https://github.com/x' }], body: 'AI body',
	});
	cat = (await call('catalog')).data;
	ok(cat.projects.length === 1 && cat.projects[0].slug === 'ai', 'project created');
	ok(cat.projects[0].home.fields.links.length === 1, 'links survive a save');

	await call('book/save', { project: 'ai', slug: 'foundations', order: 0, title: 'Foundations', shortTitle: 'F', status: 'in-progress', body: 'intro' });
	cat = (await call('catalog')).data;
	const bookId = cat.projects[0].books[0]?.bookId;
	ok(bookId === 'book-0-foundations', 'book created with canonical folder name');

	await call('chapter/save', { project: 'ai', bookId, slug: 'what-a-model-is', order: 1, title: 'What a model is', body: 'Chapter one' });
	cat = (await call('catalog')).data;
	ok(cat.projects[0].books[0].chapters.length === 1, 'chapter created');

	// reorder the book → folder rename carries the chapter
	await call('book/save', { project: 'ai', id: bookId, slug: 'foundations', order: 2, title: 'Foundations', shortTitle: 'F', status: 'in-progress', body: 'intro' });
	cat = (await call('catalog')).data;
	const renamed = cat.projects[0].books[0];
	ok(renamed.bookId === 'book-2-foundations', 'reorder renames the book folder');
	ok(renamed.chapters.length === 1 && renamed.chapters[0].name === '01-what-a-model-is', 'chapter moved with the book');

	// chapter rename via order change
	await call('chapter/save', { project: 'ai', bookId: 'book-2-foundations', id: '01-what-a-model-is', slug: 'what-a-model-is', order: 3, title: 'What a model is', body: 'Chapter one' });
	cat = (await call('catalog')).data;
	ok(cat.projects[0].books[0].chapters[0].name === '03-what-a-model-is', 'chapter order change renames the file');

	// unknown frontmatter keys survive
	const homePath = path.join(root, 'content', 'projects', 'ai', 'home.md');
	const withExtra = (await fsp.readFile(homePath, 'utf8')).replace('status: live', 'status: live\ncustomKey: hello');
	await fsp.writeFile(homePath, withExtra);
	await call('project/save', {
		slug: 'ai', title: 'AI 2', tagline: '', description: '', url: '', status: 'live',
		order: 0, icon: '🧠', footer: '', backLabel: '', links: [], body: 'AI body',
	});
	const saved = await fsp.readFile(homePath, 'utf8');
	ok(saved.includes('customKey: hello') && saved.includes('title: AI 2'), 'unknown frontmatter keys survive a save');

	await call('book/delete', { project: 'ai', id: 'book-2-foundations' });
	cat = (await call('catalog')).data;
	ok(cat.projects[0].books.length === 0, 'book deleted');

	await call('project/delete', { slug: 'ai' });
	cat = (await call('catalog')).data;
	ok(cat.projects.length === 0, 'project deleted');

	// validation errors
	let threw = '';
	try {
		await call('project/save', { slug: 'Bad Slug', title: 'X', body: '' });
	} catch (e) {
		threw = e.message;
	}
	ok(/Invalid project slug/.test(threw), 'slug validation throws with a friendly message');
}

// ===========================================================================
console.log('Book preset lifecycle');
{
	const root = path.join(tmpBase, 'book-project');
	await fsp.mkdir(root);
	store.setPicked(new MockDir(root));

	await call('initialize', { preset: 'book', title: 'ML from Scratch' });
	let cat = (await call('catalog')).data;
	ok(cat.mode === 'book', 'initialize → book mode');
	ok(cat.series.exists && cat.series.fields.title === 'ML from Scratch', 'series home scaffolded');
	ok(!('hub' in cat) && !('projects' in cat), 'book-mode catalog has no hub/projects');

	await call('series/save', {
		title: 'ML from Scratch', icon: '🤖', tagline: 't', description: 'd', footer: 'f', backLabel: 'Home', links: [], body: 'intro body',
	});
	cat = (await call('catalog')).data;
	ok(cat.series.fields.icon === '🤖' && cat.series.body.startsWith('intro body'), 'series/save round-trips');

	await call('book/save', { slug: 'basics', order: 0, title: 'Basics', shortTitle: 'B', status: 'complete', body: 'b' });
	await call('chapter/save', { bookId: 'book-0-basics', slug: 'first-chapter', order: 1, title: 'First', body: 'c1' });
	cat = (await call('catalog')).data;
	ok(cat.series.books.length === 1 && cat.series.books[0].chapters.length === 1, 'book + chapter in book mode (no project slug)');

	// files land at content/home.md and content/books/...
	const homeRaw = await fsp.readFile(path.join(root, 'content', 'home.md'), 'utf8');
	ok(homeRaw.startsWith('---'), 'home.md written at content root');
	await fsp.access(path.join(root, 'content', 'books', 'book-0-basics', 'chapters', '01-first-chapter.md'));
	ok(true, 'chapter file lands in content/books/<book>/chapters/');

	await call('chapter/delete', { bookId: 'book-0-basics', id: '01-first-chapter' });
	cat = (await call('catalog')).data;
	ok(cat.series.books[0].chapters.length === 0, 'chapter deleted');
}

// ===========================================================================
console.log('Opening an existing folder (mode detection)');
{
	const root = path.join(tmpBase, 'hub-project');
	await store.open(new MockDir(root));
	const cat = (await call('catalog')).data;
	ok(cat.mode === 'hub', 'reopening the hub project detects hub mode');
	ok(cat.hub.fields.title === 'Test Hub', 'existing content is read');

	const bookRoot = path.join(tmpBase, 'book-project');
	await store.open(new MockDir(bookRoot));
	const cat2 = (await call('catalog')).data;
	ok(cat2.mode === 'book', 'reopening the book project detects book mode');

	// Opening never creates: a random folder must be rejected, not adopted.
	const emptyRoot = path.join(tmpBase, 'not-a-project');
	await fsp.mkdir(emptyRoot);
	let openErr = '';
	try {
		await store.open(new MockDir(emptyRoot));
	} catch (err) {
		openErr = err.message;
	}
	ok(/not a SeriesContainer project/.test(openErr), 'opening a non-project folder throws');
	const cat3 = (await call('catalog')).data;
	ok(cat3.mode === 'book', 'the previously open project is untouched after a failed open');
	ok(!(await fsp.stat(path.join(emptyRoot, 'content')).catch(() => false)), 'nothing was scaffolded by open');
}

// ===========================================================================
console.log('Asset import (images)');
{
	const root = path.join(tmpBase, 'asset-project');
	await fsp.mkdir(root);
	store.setPicked(new MockDir(root));
	await call('initialize', { preset: 'book', title: 'A' });

	const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
	const res = await call('asset/import', { name: 'Result Picture.PNG', data: bytes });
	ok(res.data.path === '/assets/result-picture.png', 'name is slugified with a lowercase extension');
	ok(res.data.name === 'result-picture.png', 'returns the final file name');

	const onDisk = await fsp.readFile(path.join(root, 'content', 'assets', 'result-picture.png'));
	ok(Buffer.from(bytes).equals(onDisk), 'bytes round-trip uncorrupted');

	const res2 = await call('asset/import', { name: 'result-picture.png', data: bytes });
	ok(res2.data.name === 'result-picture-2.png', 'name collisions are uniquified, not overwritten');

	let threw = '';
	try {
		await call('asset/import', { name: 'notes.txt', data: bytes });
	} catch (err) {
		threw = err.message;
	}
	ok(/not an image/.test(threw), 'non-image extensions are rejected');

	threw = '';
	try {
		await call('asset/import', { name: 'no-ext', data: bytes });
	} catch (err) {
		threw = err.message;
	}
	ok(/not an image/.test(threw), 'missing extension is rejected');
}

await fsp.rm(tmpBase, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll green.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
