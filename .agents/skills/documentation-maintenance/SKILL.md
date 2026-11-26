---
name: documentation-maintenance
description: Keep READMEs, skills and the Mintlify guide true to the code in the same pull request as the change.
---

# Documentation maintenance

A change lands with its documentation. Before you open a pull request:

1. Run `node scripts/doc-coverage.mjs`. It lists each component your branch changed whose pages you have not touched. Read those pages against the change.
2. Fix what the change made false: commands, flags, defaults, formats, limits, file names. Add what a reader now needs, such as a new control, query parameter, check or format version.
3. Run `node scripts/docs.mjs`. For each stale page, read the printed diff, correct the page, then `node scripts/docs.mjs verify PAGE` (or `generate` for a generated page). Never verify a page you have not read.
4. If no page needs to change, put `Docs-unchanged: <reason>` in a commit message or the pull request body. Give a reason a reviewer can check.
5. When you change `guide/`, run `node scripts/mint.mjs` for the Mintlify build.

A new component, format or server needs a page. Write it in `guide/` when a reader of the published site needs it, and as a README when only someone in that folder does. Bind it in `guide/bindings.json`.

Write so a reader understands the idea in one pass. Put the point first, give the mental model before the details, use a table or a diagram where it is clearer than prose, and cut anything a reader does not need. Keep private evidence and personal information outside the docs.

The rules are in the [documentation gate](../../../guide/documentation.md) and the [Mintlify skill](../mintlify-docs/SKILL.md). Use the [project map](../../../guide/project.md) to find a component's pages.
