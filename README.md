# SeriesContainer — the Lets Learn container

One Astro repo for the whole **Lets Learn** family: the main home
(`/`, the hub that lists every series) and each series' site live in the
same source, authored as plain files on disk and built to pure static HTML.
No server, no tracking, no accounts — just content files and Astro.

The editorial side (a UI to write content without touching markdown) runs
only inside the dev server. The shipped site stays static.

## What lives where

```
content/
  home/
    home.md              # the hub (main home): title, tagline, description,
                         #   footer + body copy (rendered under the series grid)
  projects/<slug>/       # one folder per series (ai, networking, …)
    home.md              # series home AND its card on the hub: title, tagline,
                         #   description, deploy URL, status, order, icon,
                         #   footer, back label, extra links, body copy
    books/<book>/        # one folder per book (folder = book-<order>-<slug>)
      book.md            # book frontmatter (title/shortTitle/order/status) + intro
      chapters/          # chapters live inside their book
        <NN>-<slug>.md   # chapter files (order/title + markdown body)
```

Everything under `content/` is the authored content — files on disk, easy to
diff and commit. The site's reader code (`src/`) renders whatever exists.

## Routes

In the dev server — and in a combined static build — everything is visible:

- `/` — the hub: hero + grid of series cards (only `live`/`launching`
  series are listed; each card's link goes to that series' **deploy URL**).
- `/<slug>/` — a series home (hero, CTA, stats, body copy from its home.md)
- `/<slug>/books/` — that series' books
- `/<slug>/books/<book>/` — a book (folder name = URL)
- `/<slug>/books/<book>/chapters/<NN>-<topic>/` — a chapter

The whole platform deploys as one micro-front under **trieoh.com/learn**
(the Astro base is set to `/learn` in CI builds, so every page, book,
chapter, link and asset is prefix-aware). A series that is hosted
elsewhere just gets its deploy URL set in the editor — the hub card then
links there instead of into this build.

## Deploy (CI)

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci` →
`ASTRO_BASE=/learn npm run build` → `wrangler pages deploy` to a Cloudflare
Pages project (rename `--project-name` in the workflow if yours differs).

Before the first deploy:
1. Create the Cloudflare Pages project and set its production branch to
   `main`.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets.
3. Point trieoh.com/learn at the Pages project (custom domain/route).

Only `live` and `launching` series generate pages in the public build;
`draft`/`archived` stay local-only (previewable in the dev server, never
deployed).

### trieoh.com/learn (the micro-frontend)

Cloudflare Pages serves the built files at the project root, so an `edge/`
worker maps `trieoh.com/learn*` onto the Pages deployment by stripping the
`/learn` prefix (the HTML's links/assets are absolute `/learn/…` paths):

```sh
# static site → Pages project "letslearn"
wrangler pages deploy dist --project-name=letslearn --branch=main
# edge worker → trieoh.com/learn route (from edge/)
wrangler deploy
```

Both are authenticated with `wrangler login` (OAuth) or
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` env vars.

## Editorial mode

```sh
npm run dev          # site + editor → http://localhost:4321
# open http://localhost:4321/editor
```

- **Left:** the content tree — the hub's Main home, then every series with
  its Home, books and chapters.
- **Middle:** edit whatever is selected. Series creation asks for a slug and
  deploy URL up front (URL editable any time); status controls whether the
  series shows on the public hub. Books and chapters keep their naming rules
  (`book-<order>-<slug>`, `NN-<slug>`) enforced automatically.
- **Right:** a live preview of the actual page, reloaded after each save.
  Toggle Root / Item.
- `Ctrl/⌘+S` saves; deletes confirm. Deleting a series removes its folder
  tree; deleting a book removes its chapter folder.

The first save into an area that was empty when the dev server started
(no series yet, no books yet, no chapters yet) triggers a one-off content
re-scan so nothing requires a manual restart. If content ever looks stale,
the *Re-scan content* button forces the same resync.

The editor is a dev-server-only Vite plugin in `editor/`. It never ships:
viewer builds contain nothing under `/editor`, and the header's Editor link
is compiled out.

## Writing content (any way you like)

Content is markdown + frontmatter, so it can also be written by hand or
committed straight from the editor:

- `content/home/home.md` — hub identity + intro/footer copy.
- `content/projects/<slug>/home.md` — the series' home page copy and its
  hub card. `url` = where the deployed series lives; `status` ∈
  `draft | launching | live | archived`; `icon` is an emoji; `links` is a
  small list of `{label, url}`.
- `books/<book>/book.md` — a volume: `title`, `shortTitle`, `order`,
  `status` (`not-started | in-progress | complete`).
- `chapters/NN-<slug>.md` — a lesson: `order`, `title`, body in markdown.
  The last code block is the reference answer and renders collapsed behind
  a CodeReveal toggle (override with `keep`/`reveal` fence info strings).

The content schema lives in `src/content.config.ts`.

## Develop

```sh
npm install
npm run dev      # site + /editor → http://localhost:4321
npm run build    # viewer build: static site → dist/ (hub + every series)
npm run preview  # serve the built site
```

> Stale content after files changed outside the editor (e.g. a `git pull`):
> Astro caches its content store in `.astro/` and `node_modules/.astro/`.
> Clear it with `rm -rf .astro node_modules/.astro dist && npm run dev`, or
> use the editor's *Re-scan content* button while the dev server runs.
