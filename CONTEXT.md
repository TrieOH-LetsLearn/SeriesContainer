# CONTEXT — SeriesContainer

The domain model for the **Lets Learn container**: one Astro repo holding
the main home (hub) and every series' site, authored as files under
`content/` and built to pure static HTML. `src/` holds the reader code;
`src/content.config.ts` defines the content schema.

## Terms

- **Hub (main home)** — the catalog site at `/` (`content/home/home.md`):
  hub title/tagline/description/footer and body copy rendered under the grid
  of series cards. It lists only `live`/`launching` series; each card links
  to that series' absolute deploy URL.
- **Series (project)** — one course, a folder `content/projects/<slug>/`.
  Its `home.md` is the single source for BOTH the series' landing page and
  its card on the hub: `title`, `tagline`, `description`, `url` (deploy
  location — prompted when creating a series, editable any time), `status`
  (`draft | launching | live | archived`), `order`, `icon` (emoji),
  `footer`, `backLabel`, `links[]`. Folder name is the URL slug.
- **Book** — one volume, a folder `content/projects/<slug>/books/<book>/`
  where `<book>` = `book-<order>-<topic>`. Inside: `book.md` (frontmatter
  `title`, `shortTitle`, `order`, `status` and the intro body) and its
  `chapters/` folder. Renaming/re-slugging/reordering a book renames the
  folder, moving its chapters with it.
- **Chapter** — one lesson: `chapters/<NN>-<topic>.md` inside its book.
  Frontmatter `order`, `title`; body is markdown. Lives inside its book, so
  the old name-linking between separate folders no longer exists.
- **Reading sequence** — per series: every chapter across the series' books
  in reading order (book `order`, then chapter `order`), with book pages as
  boundary items in prev/next nav. Implemented by `src/lib/platform.ts`, the
  single derivation for hub + series selectors, URLs, and counts.
- **CodeReveal** — reference code hidden behind a toggle with a copy button.
  Default: only the last code block in a chapter is hidden; `keep`/`reveal`
  fence info strings override per block. Implemented by
  `src/lib/code-reveal-plugin.mjs` and styled in `src/styles/global.css`.
- **Editorial mode** — the authoring side, served by the dev server only
  (`npm run dev` / `npm run editorial`). A Vite plugin in `editor/` mounts
  the editor UI at `/editor` and a file API under `/_editor/api/*` that
  reads/writes `content/` on disk. Viewer builds never include it.
- **Viewer mode** — the shipped site: `astro build` renders the hub + every
  series at `/` and `/<slug>/…` as pure static pages. Per-series deploys are
  separate (absolute URLs in the catalog; Cloudflare micro-fronts map them).
- **Naming rules (editor-enforced)** — book folder `book-<order>-<topic>`,
  chapter file `<NN>-<topic>.md` with `NN` = zero-padded order. The editor
  keeps disk names and frontmatter consistent on every create/rename/
  reorder/delete and on project creation/deletion.
