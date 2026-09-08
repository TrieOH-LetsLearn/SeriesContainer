/**
 * Learn editor UI — plain vanilla JS, served only by the dev server.
 * Manages the whole content tree: hub home.md, every series' home.md (which
 * doubles as its hub card), and per-series books + chapters. All writes go
 * through /_editor/api/* to editorial/api.mjs and land as files on disk.
 */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
	String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

const slugify = (s) =>
	String(s ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);

const pad = (n) => String(n ?? 0).padStart(2, '0');

const BOOK_STATUS = {
	'not-started': 'Not started',
	'in-progress': 'In progress',
	complete: 'Complete',
};
const PROJECT_STATUS = {
	draft: 'Draft',
	launching: 'Launching soon',
	live: 'Live',
	archived: 'Archived',
};

const state = {
	catalog: null,
	editing: null, // {kind, project?, bookId?, name?, isNew?}
	expanded: new Set(),
	previewMode: 'root',
	saveInFlight: false,
};

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

async function api(op, payload = {}) {
	const res = await fetch(`/_editor/api/${op}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});
	let body;
	try {
		body = await res.json();
	} catch {
		throw new Error(`Server answered ${res.status}.`);
	}
	if (!body.ok) throw new Error(body.error || `Server error (${res.status}).`);
	return body;
}

function toast(message, kind = 'ok', ms = 4200) {
	const el = document.createElement('div');
	el.className = `toast toast--${kind}`;
	el.textContent = message;
	$('#toasts').appendChild(el);
	setTimeout(() => el.remove(), ms);
}

// Catalog accessors
const projOf = (slug) => state.catalog.projects.find((p) => p.slug === slug);
const bookOf = (slug, bookId) => projOf(slug)?.books.find((b) => b.bookId === bookId);
const chOf = (slug, bookId, name) =>
	bookOf(slug, bookId)?.chapters.find((c) => c.name === name);

async function refresh() {
	const { data } = await api('catalog');
	state.catalog = data;
	// Re-resolve the selection against the fresh catalog.
	const e = state.editing;
	if (e && !e.isNew) {
		const okSel =
			e.kind === 'hub'
				? true
				: e.kind === 'project'
					? !!projOf(e.project)
					: e.kind === 'book'
						? !!bookOf(e.project, e.bookId)
						: !!chOf(e.project, e.bookId, e.name);
		if (!okSel) state.editing = null;
	}
	render();
}

// ---------------------------------------------------------------------------
// render: list
// ---------------------------------------------------------------------------

function renderList() {
	const tree = $('#tree');
	tree.innerHTML = '';

	// — Hub group —
	const hubGroup = groupEl('Hub');
	const hubRow = rowEl('select-hub', 'hub', false, '🏠', 'Main home');
	if (!state.catalog.hub.exists) {
		const badge = spanEl('tree__project-badge');
		badge.textContent = 'missing';
		hubRow.appendChild(badge);
	}
	hubRow.classList.toggle('is-selected', isEditing('hub'));
	hubGroup.appendChild(hubRow);
	tree.appendChild(hubGroup);

	// — Series group —
	const projGroup = groupEl('Series');
	tree.appendChild(projGroup);
	if (state.catalog.projects.length === 0) {
		const empty = document.createElement('li');
		empty.className = 'tree__empty-note';
		empty.textContent = 'No series yet — create one to start writing.';
		projGroup.appendChild(empty);
	}
	for (const project of state.catalog.projects) {
		const { slug } = project;
		const key = `p:${slug}`;
		const hasProjectEdit = isEditing('project', slug) && !state.editing.isNew;
		const hasBookEdit =
			state.editing?.kind === 'book' && state.editing.project === slug && !state.editing.isNew;
		const hasChEdit =
			state.editing?.kind === 'chapter' && state.editing.project === slug && !state.editing.isNew;
		const open = state.expanded.has(key) || hasProjectEdit || hasBookEdit || hasChEdit;

		const li = document.createElement('li');

		// Project row
		const row = rowEl('select-project', `p:${slug}`, open, undefined, titleOf(project), {
			kind: 'project',
			id: slug,
		});
		if (hasProjectEdit && !state.editing.isNew) row.classList.add('is-selected');
		const badge = spanEl('tree__project-badge');
		badge.textContent = PROJECT_STATUS[project.home.fields.status || 'draft'].toLowerCase();
		row.appendChild(badge);
		const plus = miniPlus('add-book', `p:${slug}`, 'Add book');
		row.appendChild(plus);
		li.appendChild(row);

		if (open) {
			const sub = document.createElement('ul');
			sub.className = 'tree__sub';

			// Home entry
			const homeRow = rowEl('select-home', `p:${slug}`, false, undefined, 'Home', {
				kind: 'project',
				id: slug,
			});
			homeRow.classList.add('tree__row-home');
			if (isEditing('project', slug)) homeRow.classList.add('is-selected');
			sub.appendChild(homeRow);

			if (project.books.length === 0) {
				const note = document.createElement('li');
				note.className = 'tree__empty-note';
				note.textContent = 'No books yet';
				sub.appendChild(note);
			}
			for (const book of project.books) {
				const bkey = `b:${slug}:${book.bookId}`;
				const bookOpen =
					state.expanded.has(bkey) || (isEditing('book', slug, book.bookId) && !state.editing.isNew);
				const bookLi = document.createElement('li');
				const brow = rowEl('select-book', bkey, bookOpen, pad(book.order), book.title, {
					kind: 'book',
					project: slug,
					id: book.bookId,
				});
				if (isEditing('book', slug, book.bookId)) brow.classList.add('is-selected');
				const bplus = miniPlus('add-chapter', bkey, 'Add chapter');
				brow.appendChild(bplus);
				bookLi.appendChild(brow);
				if (bookOpen) {
					const bsub = document.createElement('ul');
					bsub.className = 'tree__sub';
					if (book.chapters.length === 0) {
						const note = document.createElement('li');
						note.className = 'tree__empty-note';
						note.textContent = 'No chapters';
						bsub.appendChild(note);
					}
					for (const ch of book.chapters) {
						const crow = rowEl(
							'select-chapter',
							`c:${slug}:${book.bookId}:${ch.name}`,
							false,
							pad(ch.order),
							ch.title || ch.name,
							{ kind: 'chapter', project: slug, bookId: book.bookId, id: ch.name },
						);
						crow.classList.add('tree__row-chapter');
						if (isEditing('chapter', slug, book.bookId, ch.name))
							crow.classList.add('is-selected');
						const cli = document.createElement('li');
						cli.appendChild(crow);
						bsub.appendChild(cli);
					}
					bookLi.appendChild(bsub);
				}
				sub.appendChild(bookLi);
			}
			li.appendChild(sub);
		}
		projGroup.appendChild(li);
	}
}

function groupEl(label) {
	const li = document.createElement('li');
	li.className = 'tree__group';
	li.textContent = label;
	return li;
}

function spanEl(cls) {
	const s = document.createElement('span');
	s.className = cls;
	return s;
}

function titleOf(project) {
	const f = project.home.fields;
	if (f.title) return `${f.icon ? f.icon + ' ' : ''}${f.title}`;
	return project.slug;
}

function rowEl(action, key, open, idx, label, meta) {
	const row = document.createElement('button');
	row.type = 'button';
	row.className = 'tree__row';
	row.dataset.action = action;
	row.dataset.key = key;
	if (meta) row.dataset.meta = JSON.stringify(meta);
	if (action === 'select-project') row.classList.add('tree__row-book');
	if (action === 'select-book') row.classList.add('tree__row-book');
	const caret = document.createElement('span');
	caret.className = 'tree__caret';
	caret.textContent = open ? '▾' : '▸';
	caret.dataset.toggle = '1';
	const labelSpan = document.createElement('span');
	labelSpan.className = 'tree__label';
	labelSpan.textContent = label ?? '';
	if (idx !== undefined) {
		const idxSpan = document.createElement('span');
		idxSpan.className = 'tree__idx';
		idxSpan.textContent = idx;
		row.appendChild(idxSpan);
	}
	row.appendChild(caret);
	row.appendChild(labelSpan);
	return row;
}

function miniPlus(action, key, title) {
	const plus = document.createElement('button');
	plus.type = 'button';
	plus.className = 'tree__plus';
	plus.textContent = '＋';
	plus.title = title;
	plus.dataset.action = action;
	plus.dataset.key = key;
	return plus;
}

function isEditing(kind, project, bookId, name) {
	const e = state.editing;
	if (!e || e.kind !== kind || e.isNew) return false;
	if (project !== undefined && e.project !== project) return false;
	if (bookId !== undefined && e.bookId !== bookId) return false;
	if (name !== undefined && e.name !== name) return false;
	return true;
}

// ---------------------------------------------------------------------------
// render: forms
// ---------------------------------------------------------------------------

function renderForm() {
	const pane = $('#form-pane');
	const e = state.editing;
	if (!e) {
		pane.innerHTML = `
			<div class="ed-form__empty">
				<p>Select the hub home, a series, a book or a chapter on the left.</p>
				<p>Everything is saved as files under <code>content/</code> — commit when happy.</p>
				<p>
					<button type="button" class="btn btn--primary" data-action="new-project">
						＋ Create the first series
					</button>
				</p>
			</div>`;
		return;
	}
	if (e.kind === 'hub') renderHubForm(pane);
	else if (e.kind === 'project') renderProjectForm(pane);
	else if (e.kind === 'book') renderBookForm(pane);
	else renderChapterForm(pane);
}

function renderHubForm(pane) {
	const f = state.catalog.hub.fields;
	pane.innerHTML = `
		<div class="form-head">
			<div>
				<div class="eyebrow">Main home</div>
				<h2>${esc(f.title || 'Learn hub')}</h2>
			</div>
			<span class="filepath">content/home/home.md</span>
		</div>
		<p class="form-meta">The hub at / — its title and tagline become the hero; the body renders under the series list.</p>
		<div class="field">
			<label for="f-title">Title</label>
			<input id="f-title" type="text" value="${esc(f.title ?? '')}" placeholder="Lets Learn" />
		</div>
		<div class="field">
			<label for="f-tagline">Tagline</label>
			<input id="f-tagline" type="text" value="${esc(f.tagline ?? '')}" />
		</div>
		<div class="field">
			<label for="f-description">Description <span class="hint">(meta tag)</span></label>
			<input id="f-description" type="text" value="${esc(f.description ?? '')}" />
		</div>
		<div class="field">
			<label for="f-footer">Footer note</label>
			<input id="f-footer" type="text" value="${esc(f.footer ?? '')}" placeholder="Lets Learn, by TrieOH" />
		</div>
		<div class="field">
			<label for="f-body">Hub intro <span class="hint">(markdown, under the series grid)</span></label>
			<textarea id="f-body"></textarea>
		</div>
		<div class="form-actions">
			<button type="button" class="btn btn--primary" data-action="save">Save hub</button>
		</div>`;
	pane.querySelector('#f-body').value = state.catalog.hub.body ?? '';
}

function renderProjectForm(pane) {
	const e = state.editing;
	const isNew = e.isNew;
	const project = isNew ? null : projOf(e.project);
	const f = project?.home.fields ?? {};
	const body = isNew ? '' : project?.home.body ?? '';
	const nextOrder = state.catalog.projects.reduce((m, p) => Math.max(m, p.home.fields.order ?? 0), -1) + 1;

	pane.innerHTML = `
		<div class="form-head">
			<div>
				<div class="eyebrow">${isNew ? 'New series' : 'Series home + card'}</div>
				<h2>${esc(isNew ? 'New series' : f.title || e.project)}</h2>
			</div>
			<span class="filepath">${
				isNew ? 'content/projects/<slug>/home.md (new)' : `content/projects/${esc(e.project)}/home.md`
			}</span>
		</div>
		<p class="form-meta">
			${
				isNew
					? 'Creates the series folder. Its fields also power the card on the main home.'
					: 'One file drives both the series home page and its card on the main home.'
			}
		</p>
		${isNew ? `<div class="field"><label for="f-slug">Slug <span class="hint">(URL: /&lt;slug&gt;)</span></label><div class="slug-wrap"><input id="f-slug" type="text" data-role="slug" spellcheck="false" placeholder="ai" /></div></div>` : ''}
		<div class="field-row">
			<div class="field">
				<label for="f-title">Title</label>
				<input id="f-title" type="text" value="${esc(f.title ?? '')}" data-autoslug="1" placeholder="Neural Networks" />
			</div>
			<div class="field">
				<label for="f-icon">Icon <span class="hint">(emoji)</span></label>
				<input id="f-icon" type="text" value="${esc(f.icon ?? '')}" placeholder="🧠" />
			</div>
		</div>
		<div class="field">
			<label for="f-tagline">Tagline</label>
			<input id="f-tagline" type="text" value="${esc(f.tagline ?? '')}" />
		</div>
		<div class="field">
			<label for="f-description">Description <span class="hint">(card + meta)</span></label>
			<input id="f-description" type="text" value="${esc(f.description ?? '')}" />
		</div>
		<div class="field-row">
			<div class="field">
				<label for="f-url">Deploy URL <span class="hint">(where the series lives)</span></label>
				<input id="f-url" type="text" value="${esc(f.url ?? '')}" placeholder="https://" spellcheck="false" />
			</div>
			<div class="field">
				<label for="f-order">Order</label>
				<input id="f-order" type="number" min="0" step="1" value="${isNew ? nextOrder : f.order ?? 0}" />
			</div>
		</div>
		<div class="field-row">
			<div class="field">
				<label for="f-status">Status <span class="hint">(non-live hides from the public hub)</span></label>
				<select id="f-status">
					${Object.entries(PROJECT_STATUS)
						.map(
							([v, label]) =>
								`<option value="${v}" ${(f.status || 'draft') === v ? 'selected' : ''}>${label}</option>`,
						)
						.join('')}
				</select>
			</div>
			<div class="field">
				<label for="f-footer">Footer note</label>
				<input id="f-footer" type="text" value="${esc(f.footer ?? '')}" />
			</div>
		</div>
		<div class="field">
			<label for="f-backlabel">Back link label <span class="hint">(links to the hub)</span></label>
			<input id="f-backlabel" type="text" value="${esc(f.backLabel ?? '')}" placeholder="All Lets Learn series" />
		</div>
		<div class="field">
			<label>Extra links <span class="hint">(repo, discussion, …)</span></label>
			<div class="link-rows" id="link-rows"></div>
			<button type="button" class="btn btn--small" data-action="add-link">＋ Add link</button>
		</div>
		<div class="field">
			<label for="f-body">Series home copy <span class="hint">(markdown — rendered under the hero)</span></label>
			<textarea id="f-body" class="body--tall"></textarea>
		</div>
		<div class="form-actions">
			<button type="button" class="btn btn--primary" data-action="save">${isNew ? 'Create series' : 'Save'}</button>
			${!isNew ? `<button type="button" class="btn" data-action="new-book" data-project="${esc(e.project)}">＋ Add book</button>` : ''}
			<span class="spacer"></span>
			${!isNew ? `<button type="button" class="del" data-action="delete-project" data-project="${esc(e.project)}">Delete series…</button>` : ''}
		</div>`;

	pane.querySelector('#f-body').value = body ?? '';
	const links = (f.links ?? []).filter((l) => l && l.label);
	const host = pane.querySelector('#link-rows');
	for (const link of links) host.appendChild(linkRow(link.label, link.url));
}

function linkRow(label, url) {
	const wrap = document.createElement('div');
	wrap.className = 'link-row';
	const l = document.createElement('input');
	l.type = 'text';
	l.className = 'link-label';
	l.placeholder = 'label';
	l.value = label ?? '';
	const u = document.createElement('input');
	u.type = 'text';
	u.className = 'link-url';
	u.placeholder = 'https://…';
	u.value = url ?? '';
	const del = document.createElement('button');
	del.type = 'button';
	del.className = 'link-row__del';
	del.textContent = '✕';
	del.dataset.action = 'remove-link';
	wrap.append(l, u, del);
	return wrap;
}

function renderBookForm(pane) {
	const e = state.editing;
	const isNew = e.isNew;
	const project = projOf(e.project);
	const book = isNew ? null : bookOf(e.project, e.bookId);
	const f = book ?? {};
	const nextOrder = project.books.reduce((m, b) => Math.max(m, b.order), 0) + 1;

	pane.innerHTML = `
		<div class="form-head">
			<div>
				<div class="eyebrow">${isNew ? 'New book' : 'Book'}</div>
				<h2>${esc(isNew ? 'New book' : f.title || e.bookId)}</h2>
			</div>
			<span class="filepath">${
				isNew
					? `content/projects/${esc(e.project)}/books/book-${nextOrder}-<slug>/`
					: `content/projects/${esc(e.project)}/books/${esc(e.bookId)}/`
			}</span>
		</div>
		<p class="form-meta">
			Series: <strong>${esc(project.home.fields.title || project.slug)}</strong> · each book is a folder with book.md + chapters/.
		</p>
		<div class="field-row">
			<div class="field">
				<label for="f-title">Title</label>
				<input id="f-title" type="text" value="${esc(f.title ?? '')}" data-autoslug="1" placeholder="Neural Networks" />
			</div>
			<div class="field">
				<label for="f-shortTitle">Short title</label>
				<input id="f-shortTitle" type="text" value="${esc(f.shortTitle ?? '')}" placeholder="Book I" />
			</div>
		</div>
		<div class="field-row">
			<div class="field">
				<label for="f-order">Order</label>
				<input id="f-order" type="number" min="0" step="1" value="${isNew ? nextOrder : f.order}" />
			</div>
			<div class="field">
				<label for="f-status">Status</label>
				<select id="f-status">
					${Object.entries(BOOK_STATUS)
						.map(
							([v, label]) =>
								`<option value="${v}" ${(f.status || 'not-started') === v ? 'selected' : ''}>${label}</option>`,
						)
						.join('')}
				</select>
			</div>
		</div>
		<div class="field">
			<label for="f-slug">Slug <span class="hint">(book folder: book-<order>-<slug>)</span></label>
			<div class="slug-wrap">
				<span class="slug-prefix">book-${isNew ? nextOrder : (book ? book.bookId.match(/^book-(\d+)-/)?.[1] : nextOrder)}-</span>
				<input id="f-slug" type="text" value="${esc(isNew ? '' : book.bookId.replace(/^book-\d+-/, ''))}" data-role="slug" spellcheck="false" placeholder="foundations" />
			</div>
			<p class="form-note">Changing the slug or order renames the book folder (and its chapters).</p>
		</div>
		<div class="field">
			<label for="f-body">Book intro <span class="hint">(markdown)</span></label>
			<textarea id="f-body"></textarea>
		</div>
		<div class="form-actions">
			<button type="button" class="btn btn--primary" data-action="save">${isNew ? 'Create book' : 'Save'}</button>
			${!isNew ? `<button type="button" class="btn" data-action="add-chapter" data-project="${esc(e.project)}" data-book="${esc(e.bookId)}">＋ Add chapter</button>` : ''}
			<span class="spacer"></span>
			${!isNew ? `<button type="button" class="del" data-action="delete-book" data-project="${esc(e.project)}" data-book="${esc(e.bookId)}">Delete book…</button>` : ''}
		</div>`;
	pane.querySelector('#f-body').value = f.body ?? '';
}

function renderChapterForm(pane) {
	const e = state.editing;
	const isNew = e.isNew;
	const chapter = isNew ? null : chOf(e.project, e.bookId, e.name);
	const f = chapter ?? {};
	const book = bookOf(e.project, e.bookId);
	const project = projOf(e.project);
	const nextOrder =
		book?.chapters.reduce((m, c) => Math.max(m, c.order), 0) + 1;

	pane.innerHTML = `
		<div class="form-head">
			<div>
				<div class="eyebrow">${isNew ? 'New chapter' : 'Chapter'}</div>
				<h2>${esc(isNew ? 'New chapter' : f.title || e.name)}</h2>
			</div>
			<span class="filepath">${
				isNew
					? `content/projects/${esc(e.project)}/books/${esc(e.bookId)}/chapters/${pad(nextOrder)}-<slug>.md (new)`
					: `content/projects/${esc(e.project)}/books/${esc(e.bookId)}/chapters/${esc(e.name)}.md`
			}</span>
		</div>
		<p class="form-meta">
			Series: <strong>${esc(project?.home.fields.title || e.project)}</strong> · Book: <strong>${esc(book?.title || e.bookId)}</strong>
		</p>
		<div class="field-row">
			<div class="field">
				<label for="f-title">Title</label>
				<input id="f-title" type="text" value="${esc(f.title ?? '')}" data-autoslug="1" placeholder="What a loss function is" />
			</div>
			<div class="field">
				<label for="f-order">Order</label>
				<input id="f-order" type="number" min="0" step="1" value="${isNew ? nextOrder : f.order}" />
			</div>
		</div>
		<div class="field">
			<label for="f-slug">Slug <span class="hint">(chapter file: NN-<slug>.md)</span></label>
			<div class="slug-wrap">
				<span class="slug-prefix">${pad(isNew ? nextOrder : f.order)}-</span>
				<input id="f-slug" type="text" value="${esc(isNew ? '' : (e.name || '').replace(/^\d+-/, ''))}" data-role="slug" spellcheck="false" placeholder="what-model-means" />
			</div>
			<p class="form-note">Changing order or slug renames the file. The last code block is auto-hidden behind the CodeReveal toggle.</p>
		</div>
		<div class="field">
			<label for="f-body">Chapter body <span class="hint">(markdown)</span></label>
			<textarea id="f-body" class="body--tall"></textarea>
		</div>
		<div class="form-actions">
			<button type="button" class="btn btn--primary" data-action="save">${isNew ? 'Create chapter' : 'Save'}</button>
			<span class="spacer"></span>
			${!isNew ? `<button type="button" class="del" data-action="delete-chapter" data-project="${esc(e.project)}" data-book="${esc(e.bookId)}" data-name="${esc(e.name)}">Delete chapter…</button>` : ''}
		</div>`;
	pane.querySelector('#f-body').value = f.body ?? '';
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

function rootUrl() {
	const e = state.editing;
	// Inside a series, “Root” = that series' home; the hub is only edited directly.
	if (e && !e.isNew && ['project', 'book', 'chapter'].includes(e.kind)) return `/${e.project}/`;
	return '/';
}

function itemUrl() {
	const e = state.editing;
	if (!e) return null;
	if (e.kind === 'hub') return '/';
	if (e.kind === 'project') return `/${e.project}/`;
	if (e.kind === 'book') return `/${e.project}/books/${e.bookId}/`;
	if (e.kind === 'chapter')
		return `/${e.project}/books/${e.bookId}/chapters/${e.name}/`;
	return null;
}

function previewUrl() {
	return state.previewMode === 'root' ? rootUrl() : itemUrl() ?? rootUrl();
}

function renderPreview() {
	const frame = $('#preview-frame');
	const url = previewUrl();
	frame.src = url;
	$('#open-new-tab').href = url;
	document.querySelectorAll('#preview-seg button').forEach((b) => {
		b.classList.toggle('is-on', b.dataset.target === state.previewMode);
	});
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

function select(e) {
	state.editing = e;
	if (!e.isNew) {
		if (e.kind === 'project') state.expanded.add(`p:${e.project}`);
		if (e.kind === 'book') state.expanded.add(`p:${e.project}`);
		if (e.kind === 'chapter') {
			state.expanded.add(`p:${e.project}`);
			state.expanded.add(`b:${e.project}:${e.bookId}`);
		}
	}
	state.previewMode = 'item';
	render();
}

const newHub = () => select({ kind: 'hub', isNew: !state.catalog.hub.exists });
const editHub = () => select({ kind: 'hub' });
const editProject = (slug) => select({ kind: 'project', project: slug });
const newProject = () => {
	select({ kind: 'project', project: null, isNew: true });
	state.slugTouched = false;
};
const editBook = (slug, bookId) => select({ kind: 'book', project: slug, bookId });
const newBookIn = (slug) => {
	select({ kind: 'book', project: slug, bookId: null, isNew: true });
	state.slugTouched = false;
};
const editChapter = (slug, bookId, name) =>
	select({ kind: 'chapter', project: slug, bookId, name });
const newChapterIn = (slug, bookId) => {
	select({ kind: 'chapter', project: slug, bookId, name: null, isNew: true });
	state.slugTouched = false;
};

// ---------------------------------------------------------------------------
// save / delete
// ---------------------------------------------------------------------------

function collectLinks() {
	const out = [];
	for (const row of document.querySelectorAll('#link-rows .link-row')) {
		const label = row.querySelector('.link-label')?.value.trim();
		const url = row.querySelector('.link-url')?.value.trim();
		if (label || url) out.push({ label, url });
	}
	return out;
}

async function save() {
	if (state.saveInFlight) return;
	const e = state.editing;
	if (!e) return;

	const title = $('#f-title')?.value?.trim() ?? '';
	const slug = $('#f-slug')?.value?.trim().toLowerCase() ?? '';
	// Order only exists on series/book/chapter forms (not the hub).
	const needsOrder = e.kind !== 'hub';
	const orderEl = needsOrder ? $('#f-order') : null;
	const order = orderEl ? Number.parseInt(orderEl.value, 10) : 0;
	const body = $('#f-body')?.value ?? '';
	const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
	const problems = [];
	if (!title) problems.push('Title is required.');
	if (needsOrder && Number.isNaN(order)) problems.push('Order must be a number.');
	if (['project', 'book', 'chapter'].includes(e.kind) && !slugRe.test(slug))
		problems.push('Slug must be lowercase letters, numbers and single hyphens.');
	if (problems.length) {
		problems.forEach((p) => toast(p, 'err'));
		return;
	}

	state.saveInFlight = true;
	try {
		let result;
		let reselect;
		if (e.kind === 'hub') {
			result = await api('hub/save', {
				title,
				tagline: $('#f-tagline')?.value?.trim() ?? '',
				description: $('#f-description')?.value?.trim() ?? '',
				footer: $('#f-footer')?.value?.trim() ?? '',
				body,
			});
			reselect = { kind: 'hub' };
		} else if (e.kind === 'project') {
			result = await api('project/save', {
				slug: e.isNew ? slug : e.project,
				title,
				tagline: $('#f-tagline')?.value?.trim() ?? '',
				description: $('#f-description')?.value?.trim() ?? '',
				url: $('#f-url')?.value?.trim() ?? '',
				status: $('#f-status')?.value ?? 'draft',
				order: order,
				icon: $('#f-icon')?.value?.trim() ?? '',
				footer: $('#f-footer')?.value?.trim() ?? '',
				backLabel: $('#f-backlabel')?.value?.trim() ?? '',
				links: collectLinks().filter((l) => l.label && l.url),
				body,
			});
			reselect = { kind: 'project', project: result.data.slug };
		} else if (e.kind === 'book') {
			result = await api('book/save', {
				project: e.project,
				id: e.isNew ? undefined : e.bookId,
				slug,
				order: order,
				title,
				shortTitle: $('#f-shortTitle')?.value?.trim() ?? '',
				status: $('#f-status')?.value ?? 'not-started',
				body,
			});
			reselect = { kind: 'book', project: e.project, bookId: result.data.bookId };
		} else {
			result = await api('chapter/save', {
				project: e.project,
				bookId: e.bookId,
				id: e.isNew ? undefined : e.name,
				slug,
				order: order,
				title,
				body,
			});
			const idParts = result.data.chapterId.split('/');
			reselect = {
				kind: 'chapter',
				project: e.project,
				bookId: idParts[0],
				name: idParts[1],
			};
		}

		await refresh();
		state.editing = { ...reselect, isNew: false };
		toast('Saved.', result.resynced ? 'warn' : 'ok');
		if (result.resynced) toast('First file — content re-scanned, pages are live.', 'warn');
	} catch (err) {
		toast(err.message, 'err', 7000);
	} finally {
		state.saveInFlight = false;
	}

	// Preview follows the item, then reloads after the content layer settles.
	state.previewMode = 'item';
	renderPreview();
	setTimeout(() => {
		$('#preview-frame').src = `${previewUrl()}?v=${Date.now()}`;
	}, 600);
}

async function del(kind) {
	const e = state.editing;
	if (!e) return;
	const labels = {
		project: `this whole series (its home, books and chapters)`,
		book: 'this book and ALL of its chapters',
		chapter: 'this chapter',
	};
	if (!window.confirm(`Delete ${labels[kind]}? Files are removed from disk — no undo.`)) return;

	try {
		if (kind === 'project') {
			await api('project/delete', { slug: e.project });
			state.editing = null;
		} else if (kind === 'book') {
			await api('book/delete', { project: e.project, id: e.bookId });
			state.editing = null;
		} else {
			await api('chapter/delete', {
				project: e.project,
				bookId: e.bookId,
				id: e.name,
			});
			state.editing = null;
		}
		toast('Deleted.', 'warn');
		await refresh();
	} catch (err) {
		toast(err.message, 'err', 7000);
	}
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

function metaOf(row) {
	try {
		return JSON.parse(row.dataset.meta || '{}');
	} catch {
		return {};
	}
}

$('#tree').addEventListener('click', (ev) => {
	const caret = ev.target.closest('[data-toggle]');
	if (caret) {
		const row = caret.closest('.tree__row');
		const key = row.dataset.key;
		if (state.expanded.has(key)) state.expanded.delete(key);
		else state.expanded.add(key);
		render();
		return;
	}
	const plus = ev.target.closest('[data-action="add-book"]');
	if (plus) {
		const meta = metaOf(plus);
		newBookIn(meta.kind === 'project' ? meta.id : plus.dataset.key.replace(/^p:/, ''));
		return;
	}
	const addCh = ev.target.closest('[data-action="add-chapter"]');
	if (addCh) {
		const key = addCh.dataset.key; // b:slug:bookId
		const [, slug, bookId] = key.split(':');
		newChapterIn(slug, bookId);
		return;
	}
	const row = ev.target.closest('[data-action]');
	if (!row) return;
	const action = row.dataset.action;
	const key = row.dataset.key || '';
	const [a, b, c] = key.split(':');
	if (action === 'select-hub') editHub();
	else if (action === 'select-project' || action === 'select-home') editProject(b);
	else if (action === 'select-book') editBook(b, c);
	else if (action === 'select-chapter') {
		const [, slug, bookId, name] = key.split(':');
		editChapter(slug, bookId, name);
	}
});

$('#form-pane').addEventListener('click', (ev) => {
	const btn = ev.target.closest('[data-action]');
	if (!btn) return;
	const action = btn.dataset.action;
	if (action === 'new-project') newProject();
	else if (action === 'new-book') newBookIn(btn.dataset.project || state.editing?.project);
	else if (action === 'add-chapter') {
		newChapterIn(btn.dataset.project || state.editing?.project, btn.dataset.book || state.editing?.bookId);
	} else if (action === 'save') save();
	else if (action === 'delete-project') del('project');
	else if (action === 'delete-book') del('book');
	else if (action === 'delete-chapter') del('chapter');
	else if (action === 'add-link') {
		const host = document.querySelector('#link-rows');
		if (host) host.appendChild(linkRow('', ''));
	} else if (action === 'remove-link') {
		btn.closest('.link-row')?.remove();
	}
});

// Live slug suggestion (new items only); typing in the slug field stops it.
$('#form-pane').addEventListener('input', (ev) => {
	if (ev.target.matches('[data-role="slug"]')) {
		state.slugTouched = true;
		return;
	}
	if (ev.target.matches('[data-autoslug]') && !state.slugTouched) {
		const slug = $('#f-slug');
		if (slug && slug.dataset.role === 'slug') slug.value = slugify(ev.target.value);
	}
});

$('#preview-seg').addEventListener('click', (ev) => {
	const btn = ev.target.closest('button');
	if (!btn) return;
	state.previewMode = btn.dataset.target;
	renderPreview();
});

$('#btn-reload-preview').addEventListener('click', () => {
	$('#preview-frame').src = `${previewUrl()}?v=${Date.now()}`;
});

$('#btn-new-project').addEventListener('click', newProject);

$('#btn-restart').addEventListener('click', async () => {
	try {
		const res = await fetch('/_editor/rescan', { method: 'POST' });
		const body = await res.json();
		if (!body.ok) throw new Error(body.error || 'Re-scan failed.');
		toast('Content re-scanned.', body.resynced ? 'ok' : 'warn', 2500);
	} catch (err) {
		toast(err.message, 'err');
	}
});

document.addEventListener('keydown', (ev) => {
	if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
		ev.preventDefault();
		save();
	}
});

function render() {
	renderList();
	renderForm();
	renderPreview();
}

refresh().catch((err) => toast(err.message, 'err', 8000));
