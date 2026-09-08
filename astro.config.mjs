// @ts-check
import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import { codeRevealMdastPlugin, codeRevealHastPlugin } from './src/lib/code-reveal-plugin.mjs';
import { editorialPlugin } from './editor/dev-plugin.mjs';

// https://astro.build/config
export default defineConfig({
	// Local dev builds at the root. CI deploys the platform under
	// trieoh.com/learn and sets ASTRO_BASE=/learn so every asset and link
	// gets the /learn prefix automatically.
	base: process.env.ASTRO_BASE ?? undefined,
	vite: {
		// The editorial UI (/editor) is served only by the dev server. The
		// plugin has `apply: 'serve'`, so viewer builds never include it.
		plugins: [editorialPlugin()],
	},
	markdown: {
		processor: satteri({
			mdastPlugins: [codeRevealMdastPlugin],
			hastPlugins: [codeRevealHastPlugin],
		}),
	},
});
