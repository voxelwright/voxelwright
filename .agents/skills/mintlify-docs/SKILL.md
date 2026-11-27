---
name: mintlify-docs
description: Write and publish pages in guide/, the Mintlify site. Frontmatter, navigation, links, components and the local build.
---

# Mintlify docs

Mintlify publishes `guide/` and nothing else. `guide/docs.json` is its configuration and navigation. Each `guide/<slug>.md` is read as MDX and served at `/<slug>`.

## A page

```md
---
title: The engine
description: One sentence a search result can show. Quote it if it contains ": ".
---

Lead with what the reader can do or understand after this page.

## A section
```

- The frontmatter title is the heading. Start sections at `##`.
- Link another page as `/slug` or `/slug#anchor`. Link a repository file as `https://github.com/voxelwright/voxelwright/blob/main/<path>` (a folder uses `tree`). Never `../`: the published site has no parent folder.
- Comments are `{/* comment */}`. An HTML comment stops the build. A schema marker is `{/* schema PATH Name */}`.
- Use `<Note>` or `<Warning>` for an invariant a reader must not break, `<Steps>` for a procedure, `<CardGroup>` with `<Card>` for a set of entry points, and Mermaid fences for diagrams. Keep components for what matters. A page of callouts reads as noise.

## Add a page

1. Write `guide/<slug>.md` and bind it to its sources in `guide/bindings.json` ([documentation gate](../../../guide/documentation.md)).
2. Add `<slug>` to the group in `guide/docs.json` where a reader would look for it. The gate fails a page missing from the navigation and a navigation entry with no page.
3. Run `node scripts/docs.mjs verify guide/<slug>.md`, then `node scripts/mint.mjs`. The second runs `mint validate` and `mint broken-links` on a copy of `guide/` under Node 22, because the CLI refuses Node 25.

Preview with `npx -y -p node@22 -p mint@4.3.96 -c 'mint dev'` from `guide/`. It writes build files beside the pages, so delete the untracked files `git status` shows afterwards.

The site is published at `https://voxelwright.mintlify.app/`. Changing its domain or Mintlify account settings stays the owner's decision.
