// @ts-check
import { createReadStream, existsSync, cpSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import { codeRevealMdastPlugin, codeRevealHastPlugin } from './src/lib/code-reveal-plugin.mjs';
import {
	spoilerImageMdastPlugin,
	spoilerImageHastPlugin,
} from './src/lib/spoiler-image-plugin.mjs';

const MIME = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.pdf': 'application/pdf',
};

/**
 * content-assets — serve the content folder's `assets/` directory.
 *
 * Images referenced as `/assets/<file>` in markdown (central assets folder
 * next to home.md / projects/) are served by the dev server through a
 * middleware and copied into the build output by `series-container build`.
 * The deploy base is handled here for dev requests and by the
 * spoiler-image plugin for the markdown-generated `src` attributes.
 *
 * @returns {import('astro').AstroIntegration}
 */
function contentAssets() {
	const assetsDir = resolve(process.env.SC_CONTENT ?? './content', 'assets');
	const base = (process.env.ASTRO_BASE ?? '').replace(/\/+$/, '');

	return {
		name: 'content-assets',
		hooks: {
			'astro:server:setup': ({ server }) => {
				if (!existsSync(assetsDir)) return;
				server.middlewares.use((req, res, next) => {
					let pathname = (req.url ?? '').split('?')[0];
					try {
						pathname = decodeURIComponent(pathname);
					} catch {
						/* keep raw */
					}
					if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);
					const match = /^\/assets\/(.+)$/.exec(pathname);
					if (!match) return next();
					const file = resolve(assetsDir, match[1]);
					// Stay inside assetsDir (no ../ escapes) and only serve real files.
					if (!file.startsWith(assetsDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
						res.statusCode = 404;
						return res.end('Not found');
					}
					res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
					createReadStream(file).pipe(res);
				});
			},
			'astro:build:done': ({ dir, logger }) => {
				if (!existsSync(assetsDir)) return;
				cpSync(assetsDir, join(fileURLToPath(dir), 'assets'), { recursive: true });
				logger.info('Copied content assets/ into the build output.');
			},
		},
	};
}

export default defineConfig({
	// Local dev builds at the root. CI can deploy under a sub-path by setting
	// ASTRO_BASE=/learn (or any prefix) — every asset and link follows it.
	base: process.env.ASTRO_BASE ?? undefined,
	// The content folder is external to this package: the CLI (cli.mjs) points
	// SC_CONTENT at the user's folder (relative to this package root).
	integrations: [contentAssets()],
	markdown: {
		processor: satteri({
			mdastPlugins: [codeRevealMdastPlugin, spoilerImageMdastPlugin],
			hastPlugins: [codeRevealHastPlugin, spoilerImageHastPlugin],
		}),
	},
});
