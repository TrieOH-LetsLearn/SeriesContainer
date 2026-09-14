# Lets Learn — SeriesContainer

**Write what you know. Share it with the world. No coding required.**

Lets Learn is a home for step-by-step learning — courses, guides, and
tutorials — made by the TrieOH community. This project is the machinery
behind it: a simple place to **write** your lessons, and a builder that
turns them into a beautiful website, automatically.

You bring the words. We handle everything else.

---

## How it works (the 30-second version)

1. **You write** your lessons in the Lets Learn editor — like a friendly
   writing app that saves straight to your own project folder.
2. **It becomes a website.** Your lessons turn into pages: a course home,
   chapters to click through, previous/next buttons, the works.
3. **You publish** by saving your work to your project (like saving any
   file). The website updates on the next publish.

Your writing lives as ordinary text files on your computer. That means you
own it completely — you can read it, back it up, share it, and it will
never be locked inside anyone's app.

---

## Two kinds of sites you can create

When you start a new project, the editor asks you to pick one:

### 🗺️ Hub — "I'm building a collection"

A home page with your name on it, listing **several courses**. Each course
gets its own section with books and chapters, like a little university
campus.

> *Good for:* teaching more than one topic, or a series of series.

### 📖 Book — "I'm writing one course"

One course, start to finish. The whole website **is** your course: a cover
page, then your books and chapters in reading order.

> *Good for:* a single, focused class — "Machine Learning from Scratch",
> "Git for Artists", you name it.

Not sure? Pick **Book** — you can always start a Hub project later and move
your course into it.

---

## Writing with the editor

The editor runs in your browser (Chrome, Edge, or Opera) and talks directly
to a folder on your computer. There's no account, no cloud, no server in
the middle — your words never leave your machine unless *you* share them.

**Getting started:**

1. Open the editor and choose **Initialize a project**.
2. Pick a folder on your computer (a new, empty one is perfect).
3. Choose **Hub** or **Book**, give your site a title — done. Your project
   is created and ready to write in.

**Day to day:**

- The **left side** shows your project as a tree: courses, books, chapters.
- The **middle** is where you write: titles, order, and the lesson itself.
- The **right side** previews your writing as you type.
- **Ctrl/Cmd + S** saves. That's it — saving writes the files to your
  folder.

A few nice touches built in:

- **Neat numbering.** Chapters and books stay in perfect order even when
  you reorder them — the editor renames everything behind the scenes.
- **The big reveal.** The last code block in a lesson can be hidden behind
  a "Reference code" toggle, so readers try it themselves first. Mark a
  code block as *visible* or *reference answer* with one click.
- **Drafts stay private.** Nothing appears on the public site until you
  mark it ready.

## Publishing

When your course is ready for readers, set its status to **Live** (the
editor walks you through it) — drafts never appear publicly, so you can
write at your own pace.

How it reaches readers depends on where your project lives: content in the
Lets Learn repo goes out automatically when it's pushed; your own project
can be published with one command (see below) or with a hand from the
TrieOH community. Either way, publishing is just "build the site and put
it online" — no servers to manage.

---

## Prefer writing by hand?

Everything is plain **Markdown** — the same format used by GitHub, Notion
exports, and a million blogs. You can ignore the editor completely and
write in any text editor. The two ways of working get along perfectly:
write some chapters by hand, edit others in the app, whatever suits you.

The short version of the format:

```
---
title: What a model even means
order: 1
---

Your lesson goes here. You can use **bold**, lists,
and code blocks.
```

The project folder has a README inside it (or ask in the TrieOH community)
if you want the full details.

---

## For the technically curious

- `packages/renderer` — the site builder. Run
  `npx @series-container/renderer build` in any folder that has a
  `content/` directory to get a complete static website in `dist/`.
  It auto-detects whether your content is a Hub or a Book, supports
  deploying under a sub-path (`--base /learn`), and deploys anywhere that
  serves files.
- `packages/editor` — the writing app. It's a static page: serve the
  folder with any file server and open it in a Chromium browser. It uses
  the File System Access API, so it needs no backend and never sends your
  content anywhere.
- This repository also *contains* the Lets Learn site itself (`content/`).
  Pushing to `main` rebuilds and republishes it under
  **trieoh.com/learn** via Cloudflare Pages.

Develop the tools themselves:

```sh
npm install
npm run site:dev       # preview the Lets Learn site while you work on it
npm run editor:dev     # run the writing app locally
npm test               # editor correctness tests
```

---

## Questions?

Bring them to the TrieOH community — that's what it's for. And welcome:
there's something only you can teach. 📚
