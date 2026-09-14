/**
 * fs.mjs — thin wrapper over the File System Access API, plus handle
 * persistence so reopening the editor reconnects to the same folder.
 *
 * All content operations go through a root FileSystemDirectoryHandle (the
 * content folder the author picked). The API is Chromium-only; the start
 * screen explains that when `window.showDirectoryPicker` is missing.
 */

const DB_NAME = 'series-container-editor';
const STORE = 'handles';
const KEY = 'content-root';

function idb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function saveRootHandle(handle) {
	if (typeof indexedDB === 'undefined') return; // non-browser (tests)
	const db = await idb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(handle, KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}

export async function loadRootHandle() {
	if (typeof indexedDB === 'undefined') return null; // non-browser (tests)
	const db = await idb();
	const handle = await new Promise((resolve, reject) => {
		const req = db.transaction(STORE).objectStore(STORE).get(KEY);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
	});
	db.close();
	return handle;
}

export async function forgetRootHandle() {
	if (typeof indexedDB === 'undefined') return; // non-browser (tests)
	const db = await idb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}

/** Ask the user to (re)grant read/write for a restored handle. */
export async function ensurePermission(handle) {
	if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
	return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Show the folder picker. Returns a FileSystemDirectoryHandle or null. */
export async function pickRoot() {
	if (!window.showDirectoryPicker) {
		throw new Error(
			'This browser does not support choosing a local folder. Use Chrome, Edge or Opera (or any Chromium browser).'
		);
	}
	return window.showDirectoryPicker({ mode: 'readwrite', id: 'series-container' });
}

/** Get (optionally create) a subdirectory handle by path segments. */
export async function getDir(root, segments, create = false) {
	let dir = root;
	for (const seg of segments) {
		dir = await dir.getDirectoryHandle(seg, { create });
	}
	return dir;
}

/** Ensure the whole path exists; returns the final directory handle. */
export async function ensureDir(root, segments) {
	return getDir(root, segments, true);
}

export async function readText(dir, name) {
	try {
		const fh = await dir.getFileHandle(name);
		return await (await fh.getFile()).text();
	} catch {
		return null;
	}
}

export async function writeText(dir, name, text) {
	const fh = await dir.getFileHandle(name, { create: true });
	const w = await fh.createWritable();
	await w.write(text);
	await w.close();
}

/** Write binary data (BufferSource) — used for imported images. */
export async function writeData(dir, name, data) {
	const fh = await dir.getFileHandle(name, { create: true });
	const w = await fh.createWritable();
	await w.write(data);
	await w.close();
}

export async function removeFile(dir, name) {
	await dir.removeEntry(name);
}

/** List entries of a directory as [{ name, kind: 'file'|'directory' }], sorted. */
export async function listEntries(dir) {
	if (!dir) return [];
	const out = [];
	for await (const [name, handle] of dir.entries()) {
		out.push({ name, kind: handle.kind });
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Recursively remove a subdirectory (files included). No undo. */
export async function removeDirRecursive(dir, name) {
	await dir.removeEntry(name, { recursive: true });
}

/** Copy every entry of src into dst (recursive). */
async function copyInto(src, dst) {
	for (const entry of await listEntries(src)) {
		if (entry.kind === 'directory') {
			const sub = await dst.getDirectoryHandle(entry.name, { create: true });
			await copyInto(await src.getDirectoryHandle(entry.name), sub);
		} else {
			const text = await readText(src, entry.name);
			await writeText(dst, entry.name, text ?? '');
		}
	}
}

/**
 * "Rename" a directory: the File System Access API has no rename, so this
 * copies the whole tree to the new name and removes the old one. Used when
 * re-ordering/re-slugging a book.
 */
export async function renameDir(parent, oldName, newName) {
	const src = await parent.getDirectoryHandle(oldName);
	const dst = await parent.getDirectoryHandle(newName, { create: true });
	await copyInto(src, dst);
	await removeDirRecursive(parent, oldName);
}
