// @ts-check
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import { codeRevealMdastPlugin, codeRevealHastPlugin } from './src/lib/code-reveal-plugin.mjs';

// https://astro.build/config
export default defineConfig({
	// Local dev builds at the root. CI can deploy under a sub-path by setting
	// ASTRO_BASE=/learn (or any prefix) — every asset and link follows it.
	base: process.env.ASTRO_BASE ?? undefined,
	// The content folder is external to this package: the CLI (cli.mjs) points
	// SC_CONTENT at the user's folder (relative to this package root).
	markdown: {
		processor: satteri({
			mdastPlugins: [codeRevealMdastPlugin],
			hastPlugins: [codeRevealHastPlugin],
		}),
	},
});
