# CONTEXT — SeriesContainer

One idea — *learning content as plain markdown folders* — with two tools
around it:

- **Renderer** (`packages/renderer`, CLI `series-container`): reads a
  `content/` folder from anywhere and emits a pure static site.
- **Editor** (`packages/editor`): a static web app. The author picks a
  folder on their PC (File System Access API) and edits the markdown
  through a UI; there is no server and no database.

The root `content/` folder is the Lets Learn site itself (hub preset) and
doubles as the renderer's reference content.

## Terms

- **Content folder** — a directory of markdown + frontmatter. The editor
  opens it (descending into `content/` if the picked folder has one); the
  renderer points at it with `--content`. Two presets, auto-detected by
  which files exist.
- **Hub preset** — a catalog of series (the Lets Learn shape):
  `home/home.md` + `projects/<slug>/…`. The hub lists `live`/`launching`
  series; each card links to that series' deploy URL or into the build.
- **Book preset** — one series, no hub: `home.md` + `books/<book>/…`.
  The site IS the series: `/` is the series home, `/books/…` the content.
- **Series (project)** — hub preset only: folder `projects/<slug>/`. Its
  `home.md` is the single source for BOTH the series landing page and its
  hub card (`title`, `tagline`, `description`, `url`, `status`, `order`,
  `icon`, `footer`, `backLabel`, `links[]`). Folder name = URL slug.
- **Book** — folder `books/<book>/` where `<book>` = `book-<order>-<topic>`,
  inside its series (hub) or the content root (book preset). `book.md`
  holds `title`, `shortTitle`, `order`, `status` + intro body.
- **Chapter** — `chapters/<NN>-<topic>.md` inside its book. Frontmatter
  `order`, `title`; body is markdown. A chapter's book is its parent folder.
- **Reading sequence** — every chapter in reading order (book `order`, then
  chapter `order`), with book pages as boundary items in prev/next nav.
  Implemented in `packages/renderer/src/lib/platform.ts` (hub mode) and by
  the `books/…` routes (book mode).
- **CodeReveal** — reference code hidden behind a toggle with a copy button.
  Default: only the last code block in a chapter is hidden; `keep`/`reveal`
  fence info strings override per block. Implemented by
  `packages/renderer/src/lib/code-reveal-plugin.mjs`.
- **Spoiler image** — an image hidden behind a heavy blur with a crossed-eye
  Show button (click to reveal, click again to hide; zero JS, a `<details>`
  toggle). Syntax: `!sp[alt](/assets/file.png)` — the `!sp` prefix before a
  normal image. Plain `![alt](…)` renders the image directly. Images live in
  the content folder's central `assets/` directory, referenced as
  `/assets/<file>` (served in dev and copied into builds by the
  content-assets integration in `astro.config.mjs`; works under the deploy
  base too). Implemented by
  `packages/renderer/src/lib/spoiler-image-plugin.mjs`.
- **Naming rules (editor-enforced)** — book folder `book-<order>-<topic>`,
  chapter file `<NN>-<topic>.md` with `NN` = zero-padded order. The editor
  keeps disk names and frontmatter consistent on every create/rename/
  reorder/delete; renaming a book renames its folder (File System Access
  has no rename, so the editor copies + deletes).

## Invariants

- Content is files on disk, always hand-editable, always diffable. No tool
  owns the format; both presets are detected from the file tree, so content
  folders can move between repos unchanged.
- The renderer never writes; the editor never builds. Deploying is always
  `series-container build` in CI (the deploy workflow builds the root
  content with base `/learn`).
- The editor persists only the folder handle (IndexedDB) — content itself
  never leaves the author's disk except through their own git push.
