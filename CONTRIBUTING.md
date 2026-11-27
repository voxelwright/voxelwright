# Contributing to Voxelwright

Start by walking the city with `./world` (see the [README](README.md)), then read the [project map](guide/project.md) and the README of the part you will change. Agents also read [AGENTS.md](AGENTS.md), and [DESIGN.md](DESIGN.md) before UI work.

## Branches and commits

Track work in a GitHub issue. Use a branch named `feature/<issue>-<name>` and commit subjects of the form `[#<issue>] <change>`. Run the flow you changed by hand, then its tests, then the root gate with current main merged into the branch.

## Test the part you changed

Each part has its own tests. The root runner does not run them.

Run each command from the repository root.

| Part | Command | What it runs |
| --- | --- | --- |
| Engine | `cd engine && npm ci && npm run core && npm run check` | The core's `cargo test`, `tsc`, then the page checks in the installed Chrome. `npm --prefix engine run check -- --changed` runs only the checks that cover the branch. |
| SF realm | `cd engine && npm run sf` | Builds the realm from the pinned release, then checks its look, controls and loader. Needs the city data under `~/.village`: run `node deploy/data.mjs fetch` once. |
| Lobbies | `cd engine && npm run lobby` | Every check of joining someone else's server, on ports of its own. Needs the same city data. |
| City bake | `~/.village/engine/bay/venv/bin/python -m unittest discover -s engine/bay -p 'test_*.py'` | The `test_*.py` files, with the Bay venv's Python, which has shapely and the other bake libraries. |
| Kit | `cd engine/kit && PORT=5989 node tools/serve.mjs`, then in another terminal `cd engine/kit && PORT=5989 node tools/links.mjs` | Opens every showcase page in Playwright's Chromium and fails on an error. Playwright comes from `npm ci` in `engine/`. |
| Master | `cd master && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` | Formatting, lints and tests. `node master/test/e2e.mjs` runs real WebRTC joins against the release build (`cargo build --release`) after `npm ci` in `probes/lobby-transport`. |
| Site | `cd site && npm ci && npm run check` | Builds the site, checks the output and runs the tests. |
| Deploy | `cd deploy && npm ci && npm test` | The assembly, notice, ship and Worker tests. |
| Docs | `node scripts/docs.mjs` | Every page against its sources, and every path, link, command and flag it mentions. |

## The root gate

```sh
npm ci --prefix home && npm ci --prefix host
npm run check -- --ci --webgl --timeout 240
```

Run it from the repository root and put its result line in the pull request.

- **What it runs.** The checks in `scripts/checks.mjs` that are not marked local-only: the four documentation checks (`docs`, `docs-mentions`, `docs-coverage`, `docs-site`) and 14 checks of the paused Village home and host. The street's checks and most of the home's browser checks are local-only and run without `--ci`. `npm run check -- --list` shows which is which.
- **What it does not run.** None of the engine's, the kit's, the master's, the site's or the deploy's own tests. Run those for the part you changed.
- **What GitHub runs.** The same gate on pull requests and pushes to main (`check.yml`). The master's format, lint and tests on pushes that touch `master/` (`master.yml`). The site and deploy tests before each deploy from main (`deploy.yml`).

See [repository checks](guide/checks.md).

## Documentation

Change a page in the same pull request as the source it describes. The `docs` check fails a page whose bound source changed, and `docs-coverage` fails a branch that changes a part's source without touching any of that part's pages. If you read the pages and nothing in them is now wrong, say so in a commit message or the pull request body:

```text
Docs-unchanged: the retry delay is internal and no page describes it
```

See [Keeping a page current](guide/documentation.md).

## Agreement

Outside contributions require a signed [individual contributor agreement](CLA.md) and Pavlo Zahynailo's approval. AI-written contributions are welcome. The human submitting the work signs the agreement and must have the rights it grants. The owner's agents may merge their own changes once the required checks and review pass.
