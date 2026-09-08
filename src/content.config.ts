import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content lives outside `src/`, under the repo `content/` tree — one hub
 * home plus a folder per series (project). Each collection carries the
 * series slug (and book id) inside its entry id, so a single dev server can
 * render the hub AND every series at once:
 *
 *   content/home/home.md                      →  hub entry, id "home"
 *   content/projects/<slug>/home.md           →  project entry, id = slug
 *   content/projects/<slug>/books/<book>/book.md
 *                                              →  book entry, id "<slug>/<book>"
 *   .../<book>/chapters/<NN>-<topic>.md       →  chapter entry, id
 *                                                  "<slug>/<book>/<NN>-<topic>"
 */

/** Book folders and chapter files sit inside content/projects/<slug>/books/. */
const slugFromProjectPath = (entry) => entry.split('/')[0];

const hub = defineCollection({
	loader: glob({ pattern: '*.md', base: './content/home' }),
	schema: z.object({
		title: z.string(),
		tagline: z.string().default(''),
		description: z.string().default(''),
		footer: z.string().optional(),
	}),
});

const projects = defineCollection({
	loader: glob({
		pattern: '*/home.md',
		base: './content/projects',
		generateId: ({ entry }) => slugFromProjectPath(entry),
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
		links: z
			.array(z.object({ label: z.string(), url: z.string() }))
			.optional()
			.default([]),
	}),
});

const books = defineCollection({
	loader: glob({
		pattern: '*/books/*/book.md',
		base: './content/projects',
		generateId: ({ entry }) => {
			const parts = entry.split('/');
			return `${parts[0]}/${parts[2]}`; // <slug>/<book folder>
		},
	}),
	schema: z.object({
		title: z.string(),
		shortTitle: z.string(),
		order: z.number(),
		status: z.enum(['not-started', 'in-progress', 'complete']).default('not-started'),
	}),
});

const chapters = defineCollection({
	loader: glob({
		pattern: '*/books/*/chapters/*.md',
		base: './content/projects',
		generateId: ({ entry }) => {
			const parts = entry.split('/');
			const name = parts[4].replace(/\.md$/, '');
			return `${parts[0]}/${parts[2]}/${name}`; // <slug>/<book>/<NN>-<topic>
		},
	}),
	schema: z.object({
		order: z.number(),
		title: z.string(),
	}),
});

export const collections = { hub, projects, books, chapters };
