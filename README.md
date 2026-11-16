# site

Personal site and blog. A small custom static generator in Node: no framework, no bundler.
Every page is published twice, as HTML for people and as Markdown for agents.

## Commands

Needs Node 24 or later (developed on Node 25). Run `npm install` once.

| Command | What it does |
| --- | --- |
| `npm run new "Title"` | Creates `posts/<slug>/index.md` with front matter and `draft: true`. No body. |
| `npm run dev` | Builds with drafts into `.dev/`, watches, serves at http://localhost:4321/ with live reload. Uses `cf dev` (the Workers runtime, Markdown negotiation on); falls back to a Node server that mimics it. `npm run dev -- --node` forces the fallback. |
| `npm run build` | Production build into `dist/`. Drafts are left out. |
| `npm run check` | Builds, checks the output (production and a drafts-included build), and runs the tests. |
| `npm run deploy` | Runs `check`, then `cf deploy` from `dist/`. Needs `cf auth login` first. |

## Writing a post

A post is a folder: `posts/<slug>/index.md`, with its images, clips and models beside it.
Relative links (`![…](photo.jpg)`) resolve to the post folder.

```yaml
---
title: "Title"
date: 2026-11-16
summary: "One sentence. Required before publishing."
tags: [ai, village]
draft: true
---
```

Drafts appear in `npm run dev` only. Set `draft: false` to publish.

### Embeds

Write these custom elements straight into the Markdown, each as its own block (blank line
before, no indentation). The build fails if a required attribute or file is missing.

```html
<engine-scene src="scene.json" poster="poster.png" alt="What the scene shows.">

<model-compare before="a.glb" after="b.glb" poster="compare.png" alt="What changes between them.">

<model-note model="Model name" maker="Maker">
The model's words, in Markdown.
</model-note>
```

- Scenes and comparisons need `alt` (the text equivalent), `poster` (a still), or both; give both when you can. A closing tag on the same line is optional. An optional `caption` replaces the default caption.
- For now they render as the poster (or the alt text, if there is no poster) with a caption; the element is present but inert.
- `model-note` renders as an attributed aside. In the Markdown version it becomes a blockquote starting `**Note from <model> (<maker>):**`.

## What the build writes

- `/`, `/blog/`, `/blog/<slug>/`, `/tags/`, `/tags/<tag>/`, `/404.html`
- A Markdown twin for every page: `/index.md`, `/blog.md`, `/blog/<slug>.md`, `/tags/<tag>.md`, linked from each page's `<link rel="alternate" type="text/markdown">`
- `/llms.txt` ([llmstxt.org](https://llmstxt.org)), `/feed.xml` (Atom), `/sitemap.xml`, `/robots.txt` (AI crawlers allowed)

## Settings

`site.config.mjs` holds the title, description, origin (still `https://example.com`), home page
text, projects, links, and `negotiateMarkdown`.

### Markdown by `Accept` header

With `negotiateMarkdown: true`, a small Worker (`src/worker.mjs`) answers `Accept: text/markdown`
on page routes (`/` and paths ending in `/`) with the page's `.md` twin. Files (images, scripts,
models, engine files) never reach it.

It is off because every page view would then invoke the Worker. On the Workers Free plan that
counts against 100,000 requests a day, and over the limit those requests get an error instead of
the static page. Turn it on after moving to Workers Paid. With it off the deploy is assets only
and costs nothing; the `.md` URLs and alternate links work either way.

## Layout

```
posts/<slug>/index.md   posts and their files
site.config.mjs         settings
generator/              build: posts, Markdown and embeds, pages, feeds
lib/paths.mjs           URL rules shared by build, Worker, checks and dev server
src/worker.mjs          Markdown negotiation Worker
static/style.css        all styling (temporary baseline)
scripts/                new, build, dev, check, Node dev server
test/                   Worker and build-failure tests
cloudflare.config.ts    Worker config for the cf CLI
wrangler.config.ts      assets directory (cf builds static sites through Wrangler)
```
