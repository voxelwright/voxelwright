---
title: Keeping a page current
description: How a page stays true to the code with bindings, stamps, the coverage check and the Mintlify rules.
---

Every README, skill and guide page names the source it describes. When that source changes, the page turns red until someone reads the change and confirms the page still holds. Change the page in the same pull request as its source.

Three checks run in `npm run check -- --ci`:

- **`docs`** compares each page with the source it is bound to, and checks every path, link, command and flag it mentions.
- **`docs-coverage`** fails a branch that changes a component's source without touching any of that component's pages.
- **`docs-site`** builds `guide/` with the Mintlify CLI and checks its links.

Run `npm ci --prefix home` once for the repository's TypeScript parser. Then, from the root:

```sh
node scripts/docs.mjs               # every page against its sources
node scripts/docs.mjs mentions      # paths, links and commands only
node scripts/doc-coverage.mjs       # this branch against origin/main
node scripts/mint.mjs               # the Mintlify build and its links
```

## Bind a claim

Add a page to [bindings.json](https://github.com/voxelwright/voxelwright/blob/main/guide/bindings.json). Each key below the page names a source path from the repository root. Pick the smallest surface that would change the answer a reader gets.

| Selector | What the gate reads |
| --- | --- |
| An array of dotted paths | Those fields of a JSON document. For example, `["scripts.dev"]` tracks the command a contributor runs. |
| `lines:<pattern>` | All trimmed source lines matching a regular expression. Anchor it on the declaration or option that owns the rule. A selector with no matches fails. |
| `types` | Exported TypeScript interfaces and type aliases declared in the file, printed without comments. Use `types:Pass,Passes` to select only named declarations. |
| `options` | CLI options from parser declarations. The [check runner](/check-cli) uses this selector. |
| `checks` | Names, default CI eligibility and required files from the check manifest. |
| `file` | The complete contents. Reserve this for a small contract, fixture or other source where every edit merits review. |

The gate hashes each selected surface. [stamps.json](https://github.com/voxelwright/voxelwright/blob/main/guide/stamps.json) records, one line per page, the hashes at the last verification and the commit it was made on. A page is stale when a hash differs.

To show a TypeScript schema in a hand-written page, put `{/* schema PATH Name,Name */}` on the line before a `ts` fence. The gate prints the named exported interfaces and type aliases from `PATH` into that fence when the page is verified, and fails the page when the fence differs from the source. Bind the same declarations with `types:Name,Name` so the stamp moves with them.

Use the source of the claim. A directory's modification history makes a poor signal for a single command. When adding prose, check whether its bindings would notice the change that would make that prose false. Generate lists and signatures when a source already enumerates them. The generators live in [scripts/docs.mjs](https://github.com/voxelwright/voxelwright/blob/main/scripts/docs.mjs).

## Write for Mintlify

Mintlify publishes `guide/` and nothing else. It reads each page as MDX, so the gate holds every page in `guide/` to these rules:

- Start with YAML frontmatter holding a `title` and a `description`. The title is the page heading, so sections start at `##`. Quote a value that contains `: `.
- List the page exactly once in the navigation of [docs.json](https://github.com/voxelwright/voxelwright/blob/main/guide/docs.json).
- Link another guide page as `/slug`, for example `[the engine](/engine)`. Link a repository file by its GitHub URL under `https://github.com/voxelwright/voxelwright/blob/main/`. The gate checks that the page or file exists. A relative link such as `../AGENTS.md` fails, because it breaks on the published site.
- Write comments as `{/* comment */}`. An HTML comment stops the MDX build.
- Use Mintlify components where they help a reader: `<Note>` and `<Warning>` for an invariant someone must not break, `<Steps>` for a procedure.

READMEs and skills render on GitHub, so they keep ordinary relative links.

## Check what a page mentions

Run `node scripts/docs.mjs mentions` for this check alone. Relative Markdown links resolve from their page. In examples, use `cd` or npm's prefix option to identify another package. A skill with examples throughout can say “Run commands from `engine/`.” A bare module name in prose can refer to a file named elsewhere in the checkout.

For a historical source, example filename, external package or private output that looks like a checkout path, record its exact token and reason under the page in [mention-ignores.json](https://github.com/voxelwright/voxelwright/blob/main/guide/mention-ignores.json). The check reads parser declarations and common argument accessors. It does not execute commands from Markdown.

## Coverage on every pull request

A component is a top-level folder, or a folder under `engine/` such as `engine/page` or `engine/kit`. Its pages are the READMEs inside it and every page bound to a source in it. When a branch changes a component's source and none of those pages changed or was re-verified, `docs-coverage` fails and lists them. Tests, fixtures, images, fonts, lockfiles and Markdown never ask for a review.

Read the listed pages against your change. Fix what is now wrong. If nothing is, say so in a line in a commit message or the pull request body:

```text
Docs-unchanged: the retry delay is internal and no page describes it
```

A component with no page at all is listed too. Write its page, or bind an existing page to its source.

## Resolve a failure

1. Read the named page and the printed Git diff, including local edits. A missing source or empty selector needs repair before verification.
2. Correct the page or its binding. For a generated page run `node scripts/docs.mjs generate guide/plugin-types.md`, substituting the reported page. Inspect the resulting diff.
3. For a hand-written page, run `node scripts/docs.mjs verify guide/render-passes.md` after reading the source. Commit the stamp with the change. If the prose still holds, say which claim you checked in the PR.

<Warning>
Never update stamps in bulk to clear a failure. A stamp says someone read the change and the page still holds. A stamp written without reading turns the gate into a formality.
</Warning>

4. Rerun the gate. The commit that last changed a page's line in `guide/stamps.json` is the verification baseline, and the failure prints a `git diff` from it. A shallow clone prints the commit recorded at verification instead. That range also includes edits that were uncommitted when the page was verified.

A green check establishes agreement with the selected source. It cannot tell whether a paragraph accurately explains intent, whether every claim has a binding, or whether an external deployment works. For behaviour a reader relies on, add a small runnable example beside the prose, as in [Drawing from a page plugin](/render-passes). For intent, ask the reviewer to read the claim against the change.
