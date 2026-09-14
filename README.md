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

## Putting your site online

Your project builds into a folder of plain web pages, so it can live
anywhere websites are hosted for free. The two we recommend:

### Cloudflare Pages (recommended)

Cloudflare gives you fast, free hosting with an easy dashboard.

**The two-minute way — no tools needed:**

1. Put your project folder on GitHub (create a repo and upload it).
2. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) →
   **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Pick your repo, then tell Cloudflare how to build it:
   - **Build command:** `npx @series-container/renderer build`
   - **Build output directory:** `dist`
   - **Environment variable:** add `NODE_VERSION` = `22`
4. Hit **Save and Deploy**. Your site is live at
   `your-project.pages.dev` — you can attach your own domain later in
   the same dashboard.

From now on, every time you push new lessons to GitHub, your site
updates itself. ✨

**The terminal way** (if you'd rather not use GitHub):

```sh
npx @series-container/renderer build        # creates the dist/ folder
npx wrangler pages deploy dist              # uploads it to Cloudflare
```

The first time, `wrangler` opens a browser to log you in and asks for a
project name — after that it's a single command to publish updates.

### GitHub Pages

Free hosting that lives right inside your GitHub repository.

1. In your repo on GitHub, go to **Settings → Pages** and set **Source**
   to **GitHub Actions**.
2. Add a file named `.github/workflows/deploy.yml` to your project:

   ```yaml
   name: Deploy
   on:
     push:
       branches: [main]
   permissions:
     contents: read
     pages: write
     id-token: write
   jobs:
     deploy:
       runs-on: ubuntu-latest
       environment:
         name: github-pages
         url: ${{ steps.deployment.outputs.page_url }}
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 22
         - name: Build
           run: npx --yes @series-container/renderer build --base /YOUR_REPO_NAME
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v3
           with:
             path: dist
         - uses: actions/deploy-pages@v4
           id: deployment
   ```

3. Replace `YOUR_REPO_NAME` with your repository's name (GitHub hosts the
   site under that name — e.g. `my-course` becomes
   `yourname.github.io/my-course/`), commit, and push.

That's it — every push rebuilds your site automatically.

> Both hosts update your site whenever you push new lessons to GitHub.
> Writing stays exactly the same: you just save files and push.

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

- `packages/renderer` — the site builder. It turns a `content/` folder
  into a complete website (see *Putting your site online* above).
  It auto-detects whether your content is a Hub or a Book, and can also
  deploy under a sub-path (`--base /learn`) — that's how the Lets Learn
  site itself lives at **trieoh.com/learn**.
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
