#!/usr/bin/env node
/**
 * series-container — build a static hub/series/book site from a folder of
 * markdown. The content lives anywhere (any repo, any path); this package
 * holds the rendering.
 *
 *   series-container build   [--content <dir>] [--base <path>] [--out <dir>]
 *   series-container dev     [--content <dir>] [--base <path>]
 *   series-container preview [--content <dir>] [--base <path>]
 *
 * --content  the content folder (default: ./content). Must contain either
 *            home/home.md + projects/ (hub preset) or home.md + books/
 *            (book preset) — auto-detected.
 * --base     deploy base path, e.g. /learn (same as the ASTRO_BASE env var).
 * --out      where `build` writes the static site (default: ./dist, relative
 *            to where you ran the command — not to this package).
 *
 * How it works: Astro builds FROM this package (its src/ holds the pages),
 * with SC_CONTENT pointing at your folder. For `build`, the finished site is
 * copied back to <out>.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ASTRO_BIN = path.join(path.dirname(require.resolve('astro/package.json')), 'bin', 'astro.mjs');

function usage(code = 1) {
	console.log(`series-container — build a static site from a folder of markdown

Usage:
  series-container <command> [options]

Commands:
  build     Render the static site into <out> (default: ./dist)
  dev       Run a dev server with live reload (site preview)
  preview   Serve a previous build's output

Options:
  --content <dir>   Content folder (default: ./content)
  --base <path>     Deploy base path, e.g. /learn (or ASTRO_BASE env var)
  --out <dir>       Build output directory (default: ./dist)`);
	process.exit(code);
}

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--content' || a === '--base' || a === '--out') {
			const value = argv[++i];
			if (!value) usage();
			args[a.slice(2)] = value;
		} else if (a === '--help' || a === '-h') {
			usage(0);
		} else {
			args._.push(a);
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (!command || !['build', 'dev', 'preview'].includes(command)) usage();

// Where the USER invoked the command. npm workspace scripts run with cwd set
// to the package dir, so process.cwd() can lie; npm's INIT_CWD tells the truth.
const userCwd = process.env.INIT_CWD ?? process.cwd();

const contentDir = path.resolve(process.cwd(), args.content ?? './content');
if (!existsSync(contentDir)) {
	console.error(`Content folder not found: ${contentDir}`);
	console.error('Point --content at the folder that holds your markdown (home.md / projects/).');
	process.exit(1);
}

// Preset sanity check: warn when the folder matches neither known layout.
const hasHub = existsSync(path.join(contentDir, 'home', 'home.md')) ||
	existsSync(path.join(contentDir, 'projects'));
const hasBook = existsSync(path.join(contentDir, 'home.md')) && existsSync(path.join(contentDir, 'books'));
if (!hasHub && !hasBook) {
	console.error(`WARNING: ${contentDir} does not look like SeriesContainer content.
Expected either (hub preset):
  home/home.md, projects/<slug>/home.md, projects/<slug>/books/...
or (book preset):
  home.md, books/<book>/book.md, books/<book>/chapters/...
Continuing anyway — the site will just have no pages.`);
}

// SC_CONTENT must be relative to THIS package (Astro's project root when we
// spawn it below), because the content config resolves it against that root.
const scContent = path.relative(PKG_ROOT, contentDir) || '.';
const env = {
	...process.env,
	SC_CONTENT: scContent,
	...(args.base ? { ASTRO_BASE: args.base } : {}),
};

// Astro caches its content layer in .astro (keyed per collection, not per
// content dir), so a stale cache would leak entries from another folder.
const wipeCache = () => {
	for (const dir of [path.join(PKG_ROOT, '.astro'), path.join(PKG_ROOT, 'node_modules', '.astro')]) {
		rmSync(dir, { recursive: true, force: true });
	}
};

function runAstro(astroArgs) {
	wipeCache();
	const result = spawnSync(process.execPath, [ASTRO_BIN, ...astroArgs], {
		stdio: 'inherit',
		cwd: PKG_ROOT,
		env,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === 'dev') {
	runAstro(['dev']);
} else if (command === 'preview') {
	// The built site lives in the user's --out dir; stage it where Astro's
	// preview server expects (the package's dist/).
	const built = path.resolve(userCwd, args.out ?? './dist');
	if (!existsSync(built)) {
		console.error(`No build found at ${built}. Run \`series-container build\` first.`);
		process.exit(1);
	}
	const staging = path.join(PKG_ROOT, 'dist');
	rmSync(staging, { recursive: true, force: true });
	cpSync(built, staging, { recursive: true });
	runAstro(['preview']);
	rmSync(staging, { recursive: true, force: true });
} else {
	// build — render into the package's own dist, then move it out.
	const outDir = path.resolve(userCwd, args.out ?? './dist');
	const staging = path.join(PKG_ROOT, 'dist');
	rmSync(staging, { recursive: true, force: true });
	runAstro(['build']);
	mkdirSync(path.dirname(outDir), { recursive: true });
	rmSync(outDir, { recursive: true, force: true });
	cpSync(staging, outDir, { recursive: true });
	rmSync(staging, { recursive: true, force: true });
	console.log(`\nStatic site written to ${outDir}`);
}
