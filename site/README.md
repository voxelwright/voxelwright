# site

Personal site and blog. A small custom static generator in Node: no framework, no bundler.
Every page is published twice, as HTML for people and as Markdown for agents.

## Commands

Needs Node 24 or later (developed on Node 25). Run `npm install` once.

| Command | What it does |
| --- | --- |
| `npm run new "Title"` | Creates `posts/<slug>/index.md` with front matter and `draft: true`. No body. |
| `npm run dev` | Builds with drafts into `.dev/`, watches, serves at http://localhost:4321/blog/ with live reload (`/` is the realm's and answers 404 here). Uses `cf dev` (the Workers runtime, Markdown negotiation on); falls back to a Node server that mimics it. `npm run dev -- --node` forces the fallback. |
| `npm run build` | Production build into `dist/`. Drafts are left out. |
| `npm run check` | Builds, checks the output (production and a drafts-included build), and runs the tests. |

The main-branch workflow builds two Workers from `deploy/`. zahynailo.dev serves the SF realm at `/` and this site under `/blog/`. voxelwright.world serves the realm and links here for the blog. See [deployment](../deploy/README.md). This folder came in with `git subtree` (history kept). The realm, the site and the Voxelmorphism kit stay together in this one repository (#534).

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

### AI sessions

```html
<ai-session src="founding.session.json" open="1">
```

A session from Claude Code, Codex or ChatGPT, shown like a code block: numbered exchanges that
are links, the person's prompts, each agent's replies with its model and maker, decisions, and
tool calls and subagents folded into one line each. Import one with:

```bash
npm run session -- find "words from the first prompt"
npm run session -- import <transcript.jsonl> --post <slug> --name founding --prompts 1-3 --as "Name"
npm run session -- review posts/<slug>/founding.session.json
npm run session -- cut posts/<slug>/founding.session.json t4,t9-t12
```

Redaction runs before anything is written, and the build checks every session again. The format
and the import options are in `notes/ai-session-format.md`.

## What the build writes

`site.config.mjs` mounts the site at `base: "/blog/"` on zahynailo.dev, whose `/` is the SF
realm. `dist/` mirrors the origin, so a deploy copies it into the Worker's assets unchanged:

- `/blog/` (posts list), `/blog/<slug>/`, `/blog/tags/`, `/blog/tags/<tag>/`, `/blog/voxelmorphism/`, and every static file under `/blog/`
- A Markdown twin for every page: `/blog/index.md`, `/blog/<slug>.md`, `/blog/tags/<tag>.md`, `/blog/voxelmorphism.md`, linked from each page's `<link rel="alternate" type="text/markdown">`
- `/blog/llms.txt` ([llmstxt.org](https://llmstxt.org)), `/blog/feed.xml` (Atom), `/blog/sitemap.xml`
- At the root: `/robots.txt` (AI crawlers allowed, Sitemap at `/blog/sitemap.xml`), `/404.html` (the host's not-found page), and `/_headers` (`static/_headers` with its patterns moved under `/blog/`)
- No `/`: the landing is built only with `base: "/"`, which writes the site as the whole origin (`/`, `/blog/`, `/tags/`, `/index.md`, `/blog.md`, ...). `npm run cards` builds that way.

The base path rule lives in `lib/paths.mjs`.

## Settings

`site.config.mjs` holds the title, description, canonical origin (`https://zahynailo.dev`),
social links, and `negotiateMarkdown`.

### Voxelmorphism

Every page is built from Voxelmorphism, Voxelwright's UI kit, installed from `../engine/kit` by npm
(see `notes/voxelmorphism.md`). The page stands on the kit's ground and is fitted as the Signal
Desk's instrument (walnut case, Ridgeline caps; at night the same case with its lights down). The
bar is the kit's navbar, post lists are its list groups, an article is its prose, code sits in its
code window, a model note is its callout. `static/site.css` places these and holds no colours or
controls; `static/site.js` starts the kit. Pages work without script: the kit's stylesheet is the
plain version. `?view=2d`, the footer's "Plain page" link, reduced motion, or no WebGPU keep a page
plain; the Night key in the bar switches the time of day. Choosing a finish on the Signal Desk
refits every page for the rest of the visit.

A part the site needs and the kit lacks goes into the kit (Voxelwright `engine/kit`), not into
`site.css`; `notes/voxelmorphism-dogfood.md` lists what building the site found. The rules the
site is designed against are in `.claude/skills/site-craft/SKILL.md`.

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
static/site.css         layout of the kit's parts; static/site.js starts the kit
static/fonts/           self-hosted fonts and their licences
scripts/                new, build, dev, check, Node dev server
test/                   Worker and build-failure tests
cloudflare.config.ts    Worker config for the cf CLI
wrangler.config.ts      assets directory (cf builds static sites through Wrangler)
```

<!-- docs-verified 00420ce4a7390b907c04f07adcd84a232f5ae4d1 {"site/package.json":"08074e98dac22a6bc119019f646526b0"} -->
