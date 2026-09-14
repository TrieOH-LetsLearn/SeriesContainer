# SeriesContainer

Monorepo with two packages:

- **`packages/renderer`** — turns a folder of markdown into a static
  hub/series/book site (`series-container` CLI: build / dev / preview).
- **`packages/editor`** — a static authoring UI (no server) that reads and
  writes a content folder on disk through the File System Access API.

Content is always plain markdown + frontmatter in a `content/` folder; it
can live in any repo. `content/` at this repo's root is the Lets Learn
site itself (the hub preset), built by CI to Cloudflare Pages.

## Development

All commands run from the repo root:

```sh
npm run site:dev        # render the root content/ with the renderer (dev server)
npm run site:build      # static build → dist/
npm run editor:dev      # serve the editor UI at http://localhost:5177
```

When starting the renderer's dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and
`astro dev logs` (run inside `packages/renderer`).

Editor tests (store logic, mocked File System Access API):

```sh
node packages/editor/test/store.test.mjs
```

## Documentation

Full renderer docs: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)

File System Access API (editor):

- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
