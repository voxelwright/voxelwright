# site

The owner's personal site: the front page at zahynailo.dev and the blog under `/blog/`. A small custom static generator in Node, with no framework. Every page is published twice, as HTML for people and as Markdown for agents, and every page is drawn with the Voxelmorphism kit from `../engine/kit`.

[The site guide](../guide/site.md) explains what the build writes, the embeds, the `ai-session/1` format, feature flags, the kit and the landing. [The deploy guide](../guide/deploy.md) explains how `dist/` reaches zahynailo.dev.

## Commands

Node 24 or later. Run `npm ci` once.

| Command | What it does |
| --- | --- |
| `npm run new "Title"` | Creates `posts/<slug>/index.md` with front matter and `draft: true`. |
| `npm run dev` | Builds with drafts into `.dev/`, watches, and serves http://localhost:4321/ with live reload. Uses `cf dev` (the Workers runtime, Markdown negotiation on) and falls back to a Node server that mimics it; `npm run dev -- --node` forces the fallback. |
| `npm run build` | The production build into `dist/`: the front page at `/` and the blog under `/blog/`, drafts left out. `SITE_PERSONAL_HOME=0` leaves out `/`. |
| `npm test` | The unit tests in `test/`. |
| `npm run check` | Builds production and a drafts-included copy, checks both outputs, then runs the tests. |
| `npm run check-home` | Checks the front page at `/` in a browser. |
| `npm run session -- <command>` | Imports and trims an AI session (below). |
| `npm run flag-proof -- <base>` | Proves a change behind a flag that is off leaves the build identical. See [features/README.md](features/README.md). |
| `npm run cards` | Paints the share cards into `static/og/` (committed). Needs Chrome and Playwright (`PLAYWRIGHT=/path/to/node_modules/playwright`). |

## Writing a post

A post is a folder, `posts/<slug>/index.md`, with its images, clips and models beside it. Relative links (`![…](photo.jpg)`) resolve to the post folder.

```yaml
---
title: "Title"
date: 2026-11-16
summary: "One sentence. Required before publishing."
tags: [ai, village]
draft: true
---
```

Drafts appear only in `npm run dev`. Set `draft: false` to publish.

Write embeds straight into the Markdown, each as its own block (a blank line before, no indentation). The build fails when a required attribute or file is missing.

```html
<engine-scene src="scene.json" poster="poster.png" alt="What the scene shows.">

<model-compare before="a.glb" after="b.glb" poster="compare.png" alt="What changes between them.">

<model-note model="Model name" maker="Maker">
The model's words, in Markdown.
</model-note>

<ai-session src="founding.session.json" open="1">
```

Scenes and comparisons need `alt`, `poster` or both, and render as the poster (or the alt text) with a caption for now. An optional `caption` replaces the default one.

To import an AI session from Claude Code, Codex or ChatGPT:

```sh
npm run session -- find "words from the first prompt"
npm run session -- import <transcript.jsonl> --post <slug> --name founding --prompts 1-3 --as "Name"
npm run session -- review posts/<slug>/founding.session.json
npm run session -- cut posts/<slug>/founding.session.json t4,t9-t12
```

Redaction runs before anything is written, and the build checks every session again. The format and the import options are in [notes/ai-session-format.md](notes/ai-session-format.md).

## Settings

`site.config.mjs` holds the title, description, origin (`https://zahynailo.dev`), `base: "/blog/"`, social links, `flags` and `negotiateMarkdown`.

`negotiateMarkdown` turns on `src/worker.mjs`, which answers `Accept: text/markdown` on page routes with the page's `.md` twin. Only `npm run dev` runs that Worker (`cloudflare.config.ts`). The deployed zahynailo.dev is `deploy/`'s assets-only Worker, so the switch changes nothing there. The `.md` addresses and alternate links work either way.

## Rules

- **The plain page is canonical.** Every page reads without script and without WebGPU, and every sign in 3D mirrors a real link. The design rules are in the [site-craft skill](../.agents/skills/site-craft/SKILL.md).
- **A part the site needs and the kit lacks goes into the kit** (`engine/kit`), not into `static/site.css`. [notes/voxelmorphism-dogfood.md](notes/voxelmorphism-dogfood.md) lists what building the site found.
- **No visitor spends the owner's model tokens.** Nothing on the site calls a model for a visitor. Model use at build time or by the owner is fine.
- **Easter eggs are homages made from our own art and sound,** with short quoted lines at most. The two music videos are the exception: they come only from the private media in `VOXELWRIGHT_EGG_MEDIA` and are never in the repository.

## Layout

```
posts/<slug>/index.md   posts and their files
site.config.mjs         settings
generator/              the build: posts, Markdown and embeds, pages, feeds, the kit, the front page, the landing
lib/paths.mjs           the base path and page-to-Markdown rules, shared by build, Worker, checks and dev server
lib/flags.mjs           feature flags (features/README.md)
lib/session/            the ai-session/1 format, importers, redaction and rendering
src/worker.mjs          the Markdown negotiation Worker (dev only)
static/                 site.css and site.js, fonts, the landing, the 404 page, share cards, the support button
features/               features behind flags
scripts/                new, build, dev, check, session, cards, flag-proof, the Node dev server and browser checks
scripts/landing/        the landing's refresh and checks (scripts/landing/README.md)
designs/support-button/ the support button's notes and browser check
notes/                  design notes: the session format, the kit on the site, the editor, easter eggs
writing/                a spike for posting from the web: store, auth and the write path (its own package)
test/                   unit and build tests
```
