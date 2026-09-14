/**
 * Mock of the File System Access API over a real Node directory — lets the
 * store be exercised in tests without a browser.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

class MockFile {
	constructor(p, name) {
		this.path = p;
		this.name = name;
		this.kind = 'file';
	}
	async getFile() {
		return {
			text: async () => fsp.readFile(this.path, 'utf8'),
			arrayBuffer: async () => (await fsp.readFile(this.path)).buffer,
		};
	}
	async createWritable() {
		const file = this;
		let chunks = [];
		return {
			async write(data) {
				chunks.push(data);
			},
			async close() {
				// Text writes are joined as strings; binary (typed array) writes
				// are concatenated byte-wise so image imports round-trip.
				const binary = chunks.some((c) => typeof c !== 'string');
				const out = binary
					? Buffer.concat(chunks.map((c) => Buffer.from(c)) )
					: chunks.join('');
				await fsp.writeFile(file.path, out, binary ? null : 'utf8');
			},
		};
	}
}

class MockDir {
	constructor(p) {
		this.path = p;
		this.name = path.basename(p) || p;
		this.kind = 'directory';
	}
	async getDirectoryHandle(name, { create = false } = {}) {
		const p = path.join(this.path, name);
		if (create) await fsp.mkdir(p, { recursive: true });
		const st = await fsp.stat(p);
		if (!st.isDirectory()) throw Object.assign(new Error('type mismatch'), { name: 'TypeMismatchError' });
		return new MockDir(p);
	}
	async getFileHandle(name, { create = false } = {}) {
		const p = path.join(this.path, name);
		if (create) {
			await fsp.mkdir(path.dirname(p), { recursive: true });
			await fsp.writeFile(p, '', 'utf8').catch((e) => {
				if (e.code !== 'EEXIST') throw e;
			});
		} else {
			await fsp.access(p);
		}
		return new MockFile(p, name);
	}
	async removeEntry(name, { recursive = false } = {}) {
		const p = path.join(this.path, name);
		const st = await fsp.stat(p);
		if (st.isDirectory() && !recursive) {
			const any = (await fsp.readdir(p)).length > 0;
			if (any) throw Object.assign(new Error('not empty'), { name: 'InvalidModificationError' });
		}
		await fsp.rm(p, { recursive: true, force: true });
	}
	async *entries() {
		for (const e of await fsp.readdir(this.path, { withFileTypes: true })) {
			yield [e.name, e.isDirectory() ? new MockDir(path.join(this.path, e.name)) : new MockFile(path.join(this.path, e.name), e.name)];
		}
	}
	async queryPermission() {
		return 'granted';
	}
	async requestPermission() {
		return 'granted';
	}
}


export { MockDir, MockFile };
