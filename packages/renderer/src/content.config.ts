import { existsSync } from 'node:fs';
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content lives in a folder OUTSIDE this package (any repo, any path) —
 * pointed at with the SC_CONTENT env var, relative to the renderer package
 * root (default `./content`). Two presets are supported and auto-detected;
 * only the active preset's collections scan the disk, the other preset's
 * collections are silent empties (so both route sets can coexist):
 *
 * An optional `assets/` directory at the content root holds images (and
 * other media), referenced from any markdown file as `/assets/<file>` —
 * see the contentAssets integration in astro.config.mjs.
 *
 * Hub preset (a catalog of series):
 *
 *   <content>/home/home.md                    →  hub entry, id "home"
 *   <content>/projects/<slug>/home.md         →  project entry, id = slug
 *   <content>/projects/<slug>/books/<book>/book.md
 *                                              →  book entry, id "<slug>/<book>"
 *   .../<book>/chapters/<NN>-<topic>.md       →  chapter entry, id
 *                                                  "<slug>/<book>/<NN>-<topic>"
 *
 * Book preset (one series, no hub):
 *
 *   <content>/home.md                         →  series home, id "home"
 *   <content>/books/<book>/book.md            →  book entry, id = book folder
 *   <content>/books/<book>/chapters/<NN>-<topic>.md
 *                                              →  chapter entry, id "<book>/<NN>-<topic>"
 */

const CONTENT = process.env.SC_CONTENT ?? './content';

/** Book preset = a home.md at the content root (no home/ + projects/). */
const isBookPreset = existsSync(`${CONTENT}/home.md`);

const bookSchema = z.object({
	title: z.string(),
	shortTitle: z.string(),
	order: z.number(),
	status: z.enum(['not-started', 'in-progress', 'complete']).default('not-started'),
});

const chapterSchema = z.object({
	order: z.number(),
	title: z.string(),
});

const linkSchema = z.object({ label: z.string(), url: z.string() });

// --- Hub preset -------------------------------------------------------------

const hub = defineCollection({
	loader: isBookPreset ? () => [] : glob({ pattern: '*.md', base: `${CONTENT}/home` }),
	schema: z.object({
		title: z.string(),
		tagline: z.string().default(''),
		description: z.string().default(''),
		footer: z.string().optional(),
	}),
});

const projects = defineCollection({
	loader: isBookPreset
		? () => []
		: glob({
				pattern: '*/home.md',
				base: `${CONTENT}/projects`,
				generateId: ({ entry }) => entry.split('/')[0], // the series slug
			}),
	schema: z.object({
		title: z.string(),
		tagline: z.string().default(''),
		description: z.string().default(''),
		/** Where the series is deployed (absolute URL). Manually maintained. */
		url: z.string().optional().default(''),
		status: z.enum(['draft', 'launching', 'live', 'archived']).default('draft'),
		order: z.number().default(0),
		icon: z.string().max(16).optional().default(''),
		footer: z.string().optional(),
		backLabel: z.string().optional(),
		links: z.array(linkSchema).optional().default([]),
	}),
});

/** Hub-preset books live inside content/projects/<slug>/books/<book>/. */
const books = defineCollection({
	loader: isBookPreset
		? () => []
		: glob({
				pattern: '*/books/*/book.md',
				base: `${CONTENT}/projects`,
				generateId: ({ entry }) => {
					const parts = entry.split('/');
					return `${parts[0]}/${parts[2]}`; // <slug>/<book folder>
				},
			}),
	schema: bookSchema,
});

const chapters = defineCollection({
	loader: isBookPreset
		? () => []
		: glob({
				pattern: '*/books/*/chapters/*.md',
				base: `${CONTENT}/projects`,
				generateId: ({ entry }) => {
					const parts = entry.split('/');
					const name = parts[4].replace(/\.md$/, '');
					return `${parts[0]}/${parts[2]}/${name}`; // <slug>/<book>/<NN>-<topic>
				},
			}),
	schema: chapterSchema,
});

// --- Book preset (one series, no hub) ---------------------------------------

const seriesHome = defineCollection({
	loader: isBookPreset ? glob({ pattern: 'home.md', base: CONTENT }) : () => [],
	schema: z.object({
		title: z.string(),
		tagline: z.string().default(''),
		description: z.string().default(''),
		icon: z.string().max(16).optional().default(''),
		footer: z.string().optional(),
		backLabel: z.string().optional(),
		links: z.array(linkSchema).optional().default([]),
	}),
});

/** Book-preset books live directly under content/books/<book>/. */
const directBooks = defineCollection({
	loader: isBookPreset
		? glob({
				pattern: 'books/*/book.md',
				base: CONTENT,
				generateId: ({ entry }) => entry.split('/')[1], // the book folder name
			})
		: () => [],
	schema: bookSchema,
});

const directChapters = defineCollection({
	loader: isBookPreset
		? glob({
				pattern: 'books/*/chapters/*.md',
				base: CONTENT,
				generateId: ({ entry }) => {
					const parts = entry.split('/');
					const name = parts[3].replace(/\.md$/, '');
					return `${parts[1]}/${name}`; // <book folder>/<NN>-<topic>
				},
			})
		: () => [],
	schema: chapterSchema,
});

export const collections = {
	hub,
	projects,
	books,
	chapters,
	seriesHome,
	directBooks,
	directChapters,
};
