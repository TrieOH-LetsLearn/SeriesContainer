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

Deployments are separate per series (each series can live at its own URL or
domain; Cloudflare micro-fronts map paths). The hub links out with absolute
URLs, so "where is it deployed" is just a field on each series' home.md.

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
