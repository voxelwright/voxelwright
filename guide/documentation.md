# Keeping a page current

Read the documentation in your checkout. Change the page in the same pull request as its source. The hosted handbook follows its own publication process for main.

Run `npm ci --prefix home` once for the repository's TypeScript parser. From the root, run `node scripts/docs.mjs`. The same check runs in `npm run check -- --ci`.

## Bind a claim

Add a page to [bindings.json](bindings.json). Each key below the page names a source path from the repository root. Pick the smallest surface that would change the answer a reader gets.

| Selector | What the gate reads |
| --- | --- |
| An array of dotted paths | Those fields of a JSON document. For example, `["scripts.dev"]` tracks the command a contributor runs. |
| `lines:<pattern>` | All trimmed source lines matching a regular expression. Anchor it on the declaration or option that owns the rule. A selector with no matches fails. |
| `types` | Exported TypeScript interfaces and type aliases declared in the file, printed without comments. Use `types:Pass,Passes` to select only named declarations. |
| `options` | CLI options from parser declarations. The [check runner](check-cli.md) and [public history tool](history-cli.md) use this selector. |
| `checks` | Names, default CI eligibility and required files from the check manifest. |
| `file` | The complete contents. Reserve this for a small contract, fixture or other source where every edit merits review. |

Use the source of the claim. A directory's modification history makes a poor signal for a single command. When adding prose, check whether its bindings would notice the change that would make that prose false. Generate lists and signatures when a source already enumerates them. The generators live in [scripts/docs.mjs](../scripts/docs.mjs).

## Check what a page mentions

Run `node scripts/docs.mjs mentions` for this check alone. Relative Markdown links resolve from their page. In examples, use `cd` or npm's prefix option to identify another package. A skill with examples throughout can say “Run commands from `engine/`.” A bare module name in prose can refer to a file named elsewhere in the checkout.

For a historical source, example filename, external package or private output that looks like a checkout path, record its exact token and reason under the page in [mention-ignores.json](mention-ignores.json). The check reads parser declarations and common argument accessors. It does not execute commands from Markdown.

## Resolve a failure

1. Read the named page and the printed Git diff, including local edits. A missing source or empty selector needs repair before verification.
2. Correct the page or its binding. For a generated page run `node scripts/docs.mjs generate guide/plugin-types.md`, substituting the reported page. Inspect the resulting diff.
3. For a hand-written page, run `node scripts/docs.mjs verify guide/render-passes.md` after reading the source. Commit the stamp with the change. If the prose still holds, say which claim you checked in the PR. Never update stamps in bulk to clear a failure.
4. Rerun the gate. Use `git log -p -G docs-verified -- PATH` to see when bindings were stamped. Each stamp records the selected surface of each source file. The commit that last changed the stamp is the verification baseline. A shallow clone prints the HEAD recorded at verification. That range also includes edits that were uncommitted when the page was verified. Use the full branch history for the exact stamp commit after a squash or history rewrite.

A green check establishes agreement with the selected source. It cannot tell whether a paragraph accurately explains intent, whether every claim has a binding, or whether an external deployment works. For behavior a reader relies on, add a small runnable example beside the prose, as in [Drawing from a page plugin](render-passes.md). For intent, ask the reviewer to read the claim against the change.

<!-- docs-verified d275af1c4ec25f6efc898f9e37606571023eeed1 {"scripts/docs.mjs":"29c29b9fc701992e205a83ae66db5d4f"} -->
