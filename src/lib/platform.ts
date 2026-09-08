import { getCollection, type CollectionEntry } from 'astro:content';

/**
 * The platform library: how the reader pages derive everything from the
 * content tree. One collection holds the hub; every series (project) is a
 * folder under content/projects and shows up as:
 *
 *   project entry  id = <slug>
 *   book entry     id = <slug>/<book folder>        (folder = book-N-<topic>)
 *   chapter entry  id = <slug>/<book>/<NN>-<topic>
 */

export type Project = CollectionEntry<'projects'>;
export type Book = CollectionEntry<'books'>;
export type Chapter = CollectionEntry<'chapters'>;

export const BOOK_STATUS_LABEL: Record<Book['data']['status'], string> = {
	'not-started': 'Not started',
	'in-progress': 'In progress',
	complete: 'Complete',
};

export const PROJECT_STATUS_LABEL: Record<Project['data']['status'], string> = {
	draft: 'Draft',
	launching: 'Launching soon',
	live: 'Live',
	archived: 'Archived',
};

/** The series root for a given slug, in this combined site. */
export const seriesRoot = (slug: string): string => `/${slug}`;

const bookKeyOf = (bookId: string): string => bookId.slice(bookId.indexOf('/') + 1);

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

export async function getHub(): Promise<CollectionEntry<'hub'> | undefined> {
	return (await getCollection('hub'))[0];
}

/** Every series in the folder tree, in the order their home.md says. */
export async function getProjects(): Promise<Project[]> {
	const projects = await getCollection('projects');
	return projects.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

/** Series that the hub's public page lists (live + launching). */
export async function getPublicProjects(): Promise<Project[]> {
	return (await getProjects()).filter((p) => p.data.status === 'live' || p.data.status === 'launching');
}

export async function getProject(slug: string): Promise<Project | undefined> {
	return (await getCollection('projects')).find((p) => p.id === slug);
}

// ---------------------------------------------------------------------------
// Series content
// ---------------------------------------------------------------------------

/** The books of one series, in reading order. */
export async function getBooksOf(slug: string): Promise<Book[]> {
	const books = await getCollection('books');
	return books
		.filter((b) => b.id.startsWith(`${slug}/`))
		.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

export async function getBook(slug: string, bookKey: string): Promise<Book | undefined> {
	return (await getCollection('books')).find((b) => b.id === `${slug}/${bookKey}`);
}

export async function getChaptersOf(slug: string): Promise<Chapter[]> {
	const chapters = await getCollection('chapters');
	return chapters.filter((c) => c.id.startsWith(`${slug}/`));
}

/** The chapters inside one book. */
export async function getChaptersInBook(bookId: string): Promise<Chapter[]> {
	const chapters = await getCollection('chapters');
	return chapters
		.filter((c) => c.id.startsWith(`${bookId}/`))
		.sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id));
}

/** How many chapters a book has (by the book's full entry id). */
export async function countChapters(bookId: string): Promise<number> {
	return (await getChaptersInBook(bookId)).length;
}

// ---------------------------------------------------------------------------
// URLs + reading sequence (book-aware, per series)
// ---------------------------------------------------------------------------

export interface SeqItem {
	bookId: string; // full book entry id, "<slug>/<book folder>"
	bookKey: string;
	bookTitle: string;
	num: number;
	title: string;
	href: string;
}

export function bookHref(slug: string, bookKey: string): string {
	return `${seriesRoot(slug)}/books/${bookKey}/`;
}

export function chapterHref(slug: string, bookKey: string, chapterName: string): string {
	return `${seriesRoot(slug)}/books/${bookKey}/chapters/${chapterName}/`;
}

/** The full reading sequence of one series across its books. */
export async function buildSequence(slug: string): Promise<SeqItem[]> {
	const books = await getBooksOf(slug);
	const chapters = (await getChaptersOf(slug)).sort((a, b) => {
		const bookOrder = (c: Chapter) => {
			const key = c.id.slice(slug.length + 1, c.id.indexOf('/', slug.length + 1));
			return books.find((b) => bookKeyOf(b.id) === key)?.data.order ?? 0;
		};
		return bookOrder(a) - bookOrder(b) || a.data.order - b.data.order;
	});
	const bookByKey = new Map(books.map((b) => [bookKeyOf(b.id), b]));

	return chapters.map((chapter) => {
		const parts = chapter.id.split('/'); // <slug>/<book>/<NN>-<topic>
		const bookKey = parts[1];
		const chapterName = parts[2];
		const book = bookByKey.get(bookKey);
		return {
			bookId: `${slug}/${bookKey}`,
			bookKey,
			bookTitle: book?.data.shortTitle ?? bookKey,
			num: chapter.data.order,
			title: chapter.data.title,
			href: chapterHref(slug, bookKey, chapterName),
		};
	});
}
