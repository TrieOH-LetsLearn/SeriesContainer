/**
 * editorial/dev-plugin.mjs — the editorial mode for the dev server.
 *
 * Dev-only middleware on `astro dev`:
 *
 *   GET  /editor                the editorial UI (single page)
 *   GET  /_editor/editor.js     UI script
 *   GET  /_editor/editor.css    UI styles
 *   POST /_editor/api/<op>      content operations (see api.mjs)
 *   POST /_editor/rescan        force a content-layer sync (dev CLI `s`)
 *
 * `apply: 'serve'` — viewer builds never include it, and nothing under
 * `/editor` exists in the shipped output.
 *
 * Astro quirk handled here: a glob content loader only wires its file
 * watcher for a collection that had ≥1 file at boot. A collection that
 * boots empty silently ignores newly created files until the loader runs
 * again. The plugin therefore calls Astro's content-layer `sync()` (same as
 * the dev CLI's `s` shortcut) the first time a file is created into one of
 * the content areas that were empty at boot (projects, books, chapters), so
 * first-run authoring works without restarting anything.
 */

import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { editorialApi, withEditorLock } from './api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_ROOT = path.join(ROOT, 'content');
const HOME_DIR = path.join(CONTENT_ROOT, 'home');
const PROJECTS_DIR = path.join(CONTENT_ROOT, 'projects');

// Astro does not export internals via package.json "exports", so import the
// content-layer module by its resolved file URL — Node shares the exact
// module instance Astro itself uses (same cache entry), including the
// globalContentLayer singleton.
const require = createRequire(import.meta.url);
const ASTRO_INSTANCE_URL = (() => {
	const astroPkg = require.resolve('astro/package.json');
	const file = path.join(path.dirname(astroPkg), 'dist/content/instance.js');
	return pathToFileURL(file).href;
})();

async function syncContentLayer() {
	try {
		const { globalContentLayer } = await import(ASTRO_INSTANCE_URL);
		const layer = globalContentLayer.get?.();
		if (!layer || typeof layer.sync !== 'function') return false;
		await layer.sync();
		return true;
	} catch (err) {
		console.error('[editorial] content-layer sync failed:', err);
		return false;
	}
}

/** Does any markdown file under `dir` satisfy `pred` (relative posix path)? */
async function hasMdWhere(dir, pred) {
	let entries = [];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return false;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (await hasMdWhere(full, pred)) return true;
		} else if (entry.name.endsWith('.md')) {
			const rel = path.relative(CONTENT_ROOT, full).split(path.sep).join('/');
			if (pred(rel)) return true;
		}
	}
	return false;
}

// Area emptiness predicates, keyed by collection name.
const areaChecks = {
	projects: () => hasMdWhere(PROJECTS_DIR, (rel) => rel.endsWith('/home.md')),
	books: () => hasMdWhere(PROJECTS_DIR, (rel) => rel.includes('/books/') && rel.endsWith('/book.md')),
	chapters: () => hasMdWhere(PROJECTS_DIR, (rel) => rel.includes('/chapters/')),
};

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
	res.statusCode = status;
	res.setHeader('Content-Type', type);
	res.setHeader('Cache-Control', 'no-store');
	res.end(body);
}

function sendJson(res, status, obj) {
	send(res, status, JSON.stringify(obj));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (c) => {
			size += c.length;
			if (size > 8_000_000) {
				reject(new Error('Request body too large.'));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
			} catch {
				reject(new Error('Request body is not valid JSON.'));
			}
		});
		req.on('error', reject);
	});
}

export function editorialPlugin() {
	return {
		name: 'series-editorial',
		apply: 'serve', // dev server only — never part of `astro build`
		configureServer(server) {
			// Snapshot at boot; the sync below re-arms emptiness by re-checking.
			const bootEmpty = { projects: false, books: false, chapters: false };
			const bootState = (async () => {
				const [p, b, c] = await Promise.all([
					areaChecks.projects(),
					areaChecks.books(),
					areaChecks.chapters(),
				]);
				bootEmpty.projects = !p;
				bootEmpty.books = !b;
				bootEmpty.chapters = !c;
			})();

			/** op → handler; `coll` says which content area a create touches. */
			const ops = {
				catalog: { fn: () => editorialApi.listCatalog() },
				'hub/save': { fn: (p) => editorialApi.saveHub(p) },
				'project/save': { fn: (p) => editorialApi.saveProject(p), coll: 'projects' },
				'project/delete': { fn: (p) => editorialApi.deleteProject(p) },
				'book/save': { fn: (p) => editorialApi.saveBook(p), coll: 'books' },
				'book/delete': { fn: (p) => editorialApi.deleteBook(p) },
				'chapter/save': { fn: (p) => editorialApi.saveChapter(p), coll: 'chapters' },
				'chapter/delete': { fn: (p) => editorialApi.deleteChapter(p) },
			};

			server.middlewares.use(async (req, res, next) => {
				try {
					const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

					// --- Editor UI -------------------------------------------------
					if (req.method === 'GET' && (pathname === '/editor' || pathname === '/editor/')) {
						const file = await fs.readFile(path.join(ROOT, 'editor/index.html'), 'utf8');
						send(res, 200, file, MIME['.html']);
						return;
					}
					if (
						req.method === 'GET' &&
						(pathname === '/_editor/editor.js' || pathname === '/_editor/editor.css')
					) {
						const file = await fs.readFile(
							path.join(ROOT, 'editor', path.basename(pathname)),
							'utf8',
						);
						send(res, 200, file, MIME[path.extname(pathname)]);
						return;
					}

					// --- Editorial API ----------------------------------------------
					if (req.method === 'POST' && pathname.startsWith('/_editor/api/')) {
						await bootState;
						const op = pathname.slice('/_editor/api/'.length).replace(/\/$/, '');
						const handler = ops[op];
						if (!handler) {
							sendJson(res, 404, { ok: false, error: `Unknown operation "${op}".` });
							return;
						}
						const payload = await readBody(req);

						// Run under the mutation lock so renames never interleave.
						const result = await withEditorLock(() => handler.fn(payload));

						// A create into an area that booted empty needs a content-layer
						// sync to wire up the collection's watcher.
						let resynced = false;
						if (handler.coll && result?.created && bootEmpty[handler.coll]) {
							const hasContentNow = await areaChecks[handler.coll]();
							if (hasContentNow) {
								resynced = await syncContentLayer();
								if (resynced) bootEmpty[handler.coll] = false;
							}
						}

						sendJson(res, 200, { ok: true, data: result, resynced });
						return;
					}

					if (req.method === 'POST' && pathname === '/_editor/rescan') {
						const ok = await syncContentLayer();
						sendJson(res, 200, { ok: true, resynced: ok });
						return;
					}

					next();
				} catch (err) {
					const status = err?.status ?? 500;
					const message = err instanceof Error ? err.message : String(err);
					if (status >= 500) {
						console.error('[editorial]', err);
					}
					sendJson(res, status, { ok: false, error: message });
				}
			});
		},
	};
}
