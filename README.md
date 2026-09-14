# SeriesContainer

Learning content as plain markdown folders, with two tools around it:

- **`series-container` (the renderer)** — a CLI that turns a `content/`
  folder into a pure static site: a hub cataloging your series, series
  homes, books, chapters. No server, no tracking, no accounts.
- **The editor** — a static web app (open `packages/editor/index.html`
  through any static server). Pick a folder on your PC, write in a friendly
  UI, and the markdown lands on your disk. Initialize a project with either
  the **Hub preset** (a catalog of series) or the **Book preset** (one
  series, no hub).

Your content lives in **your** repo, as plain markdown + frontmatter — hand
editable, diffable, portable. The tools just read and write it.

## The two presets

A content folder is one of:

**Hub preset** — a catalog of series:

```
content/
  home/home.md              # the hub: title, tagline, description, footer + intro
  projects/<slug>/          # one folder per series
    home.md                 # series home AND its hub card
    books/<book>/           # book-<order>-<topic>
      book.md               # title/shortTitle/order/status + intro
      chapters/<NN>-<topic>.md
```

**Book preset** — one series, no hub (the site IS the series):

```
content/
  home.md                   # the series home: title, icon, tagline, … + intro
  books/<book>/
    book.md
    chapters/<NN>-<topic>.md
```

The preset is auto-detected from the files, so a content folder works
unchanged in any repo and either tool.

## Using the renderer

```sh
# in any repo that has a content/ folder:
npx @series-container/renderer dev      # live-reload preview
npx @series-container/renderer build    # static site → dist/

# options
--content <dir>   content folder (default ./content)
--base /learn     deploy under a sub-path (also: ASTRO_BASE env var)
--out <dir>       build output (default ./dist)
```

Only `live` and `launching` series appear on the public hub (hub preset);
`draft`/`archived` stay local-only. The last code block in a chapter renders
behind a CodeReveal toggle (override per block with `keep`/`reveal` fence
info strings).

Deploy `dist/` anywhere static — Cloudflare Pages, Netlify, GitHub Pages.

## Using the editor

Serve `packages/editor/` statically (any static file server) and open it in
a Chromium browser (Chrome, Edge, Opera — it uses the File System Access
API):

- **Open a content folder…** — point it at an existing project (the repo
  root works too; it descends into `content/`).
- **Initialize a project…** — pick a folder, choose Hub or Book preset, and
  the editor scaffolds `content/` for you.

Then edit: the left tree mirrors the disk, the middle pane edits fields +
markdown, the right pane live-previews the markdown you're writing. To see
the real rendered page, run `series-container dev` next to it.

Everything saves straight to your folder as files — commit and push with
git as usual. The editor remembers your last folder (permission is asked
again per browser session).

## This repo

This repository contains both packages **and** the Lets Learn content
itself:

```
packages/
  renderer/    the series-container CLI (Astro-based)
  editor/      the static editor app (+ store tests)
content/       the Lets Learn site (hub preset)
edge/          Cloudflare worker mapping trieoh.com/learn → the Pages deploy
```

Develop:

```sh
npm install
npm run site:dev       # preview the root content/ at localhost:4321
npm run site:build     # static build → dist/
npm run editor:dev     # serve the editor at localhost:5177
node packages/editor/test/store.test.mjs   # editor store tests
```

Deploy (CI): pushing to `main` builds the root `content/` with base `/learn`
and deploys to Cloudflare Pages; `edge/` maps `trieoh.com/learn*` onto it.

## Writing content by hand

All frontmatter is YAML. The essentials:

- `home/home.md` (hub): `title`, `tagline`, `description`, `footer` + body.
- `projects/<slug>/home.md`: `title`, `tagline`, `description`, `url`
  (deploy URL), `status` ∈ `draft | launching | live | archived`, `order`,
  `icon` (emoji), `footer`, `backLabel`, `links: [{label, url}]` + body.
- `home.md` (book preset): `title`, `icon`, `tagline`, `description`,
  `footer`, `backLabel`, `links` + body.
- `book.md`: `title`, `shortTitle`, `order`,
  `status` ∈ `not-started | in-progress | complete` + intro.
- `chapters/NN-<slug>.md`: `order`, `title` + markdown body. Chapter
  filenames must start with their zero-padded order; book folders are
  `book-<order>-<slug>`. The editor keeps these names in sync for you.
