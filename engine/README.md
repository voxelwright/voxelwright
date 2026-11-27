# The engine

Voxelwright's own engine: a world of 10 cm cells, drawn in the browser with raw WebGPU by marching rays. The core is Rust built to WebAssembly, the page is TypeScript with no framework, and a shared world runs in a world server (`serve.mjs --world`) beside it. How a frame is made and how the parts fit: [the engine](../guide/engine.md).

## Run it

```sh
rustup target add wasm32-unknown-unknown   # once
cd engine
npm ci
npm run core     # build core/ to page/core.wasm; a clean, committed core/ is copied from a cache instead
npm run serve    # the page server on http://127.0.0.1:5740
npm run studio   # native in-game T3 Studio Bridge + Game-Use MCP on http://127.0.0.1:5764
```

To play San Francisco, run `./world` from the repository root instead. It builds the core, fetches the pinned city, builds the realm into `engine/dist-sf` and serves it on port 5760 ([quickstart](../guide/quickstart.md)).

| Address on the page server | What it is |
| --- | --- |
| `/city` | The generated town, flown through |
| `/` | The same page, which runs the measuring flight first and reports the device |
| `/probe` | A bare page that reports what the device can draw |
| `/city?shared=1` | The shared world, when the server runs with `--world` |
| `/city?realm=<id>` | A realm the server keeps beside it |
| `/world/` | Plain text saying how any program can act in the shared world |

The controls and every address option are on [gameplay](../guide/gameplay.md).

`node serve.mjs` takes these flags:

| Flag | Default | What it sets |
| --- | --- | --- |
| `--port` | 5740 | The port, on 127.0.0.1 only |
| `--reports` | `~/.village/engine/reports.jsonl` | Where device reports from pages are kept |
| `--inbox` | `~/.village/engine/inbox` | Where in-game feedback (`/api/feedback`), play-session traces (`/api/session`) and inbox summaries (`/api/inbox`) are kept |
| `--world` | none | A file that keeps one shared world across restarts |
| `--realms` | beside the world file | A folder of realms, each a world with its own process |
| `--idle` | 300 | Seconds before a realm nobody uses is stopped |
| `--release` | none | Stand every world on a pinned San Francisco release (a folder, or the address of a `current.json`) |
| `--release-cache` | `~/.village/engine/world/releases` | Where a fetched release is kept |
| `--arrive` | the realm's | Where people arrive: `x,y,z,yaw` |
| `--most`, `--tiles-most`, `--ground-wait` | 8, 16, 3000 | How many people and spare tiles a released world holds, and how long a change waits for ground (ms) |
| `--plugins` | `plugins/` | The engine plugins folder |

## The folder

| Path | What is in it |
| --- | --- |
| [core/](core/) | Rust: cells, sectors as trees, the generated town, edits, loose bodies, vehicles, fire and water. `core/build.mjs` builds it. |
| [page/](page/) | The page: the frame loop (`main.ts`), the ray marcher, the world's boxes of sectors, the HUD, driving, the map and everything drawn over the world |
| [page/sound/](page/sound/README.md) | The synthesiser, the music and how the world sounds |
| [sf/](sf/) | The San Francisco realm: its record (`realm.json`), signs, eggs, lockers and the static build (`sf/build.mjs`) |
| [sf/far/](sf/far/README.md) | The far view of the city, baked as faces |
| [bay/](bay/README.md) | The Bay Area from open data: the Python pipeline that makes the city's tiles |
| [kit/](kit/README.md) | The Voxelmorphism UI kit and its fonts |
| [blocks/](blocks/README.md) | The kit drawn by the engine as cubes |
| [make/](make/) | Making: a wish turned into a thing of the world's cells, by a model or from what is kept |
| [draw/](draw/README.md) | Python that carves and paints cells from a model's drawn views |
| [mind/](mind/README.md) | The people of a world who answer when spoken to |
| [rules/](rules/) | Rules: each in a thread and a QuickJS sandbox of its own, beside a shared world |
| [plugins/](plugins/) | Engine plugins: trusted folders a running world picks up |
| [workshop/](workshop/README.md) | Turns what a rule could not do into a session that builds the missing plugin |
| [studio/](studio/README.md) | Native in-game T3 Code Studio Bridge, DPoP/Effect-RPC client, worktree hot-swap, and `voxelwright-game` Game-Use MCP server (#98) |
| [player/](player/README.md) | One scene from static files, with no server, for an iframe on a site. `npm run player` builds it. |
| [landing/](player/README.md#the-landing-world) | The landing world: the site's front door as a street corner. `npm run landing` builds and serves it on port 5950. |
| [ears/](ears/README.md) | The sound judge: benchmark clips scored with nobody listening |
| [probe/](probe/) | The device probe page |
| [test/](test/) | Every check, and the tools for measuring |

The servers and tools at the top level:

| File | What it does |
| --- | --- |
| `serve.mjs` | The page server: serves the page's TypeScript with types stripped and keeps device reports. Run with `--world`, it is also the world server, which keeps shared worlds and realms. |
| `world.mjs` | The world process: one core in a thread behind the world server, which orders every change |
| `ground.mjs` | What a shared world stands on: the generated town or a pinned San Francisco release |
| `server.mjs`, `door.mjs` | The dedicated server (a world server and its door in one process) and the door strangers' pages reach it through |
| `guard.mjs` | Who may ask a server on this machine for anything |
| `helper.mjs` | The helper on a person's own machine, which runs their model to make things |
| `make.mjs` | Make a thing in a shared world from the command line |
| `voice.mjs`, `instrument.mjs` | Ask a model for a thing's sounds; stand a kept instrument in a world |
| `plugins.mjs`, `plug.mjs` | Load engine plugins; have a running world pick them up again |
| `about.mjs` | How a body the world moves finds its way round things |
| `text.mjs` | The one rule for showing text people or models wrote |
| `inbox.mjs` | Same-origin `/api/feedback`, `/api/session` and `/api/inbox` storage: writes feedback bundles, sibling canvas screenshots and session traces under `~/.village/engine/inbox` |
| `scan.mjs` | Scans recent feedback and play sessions in the local inbox, clusters anomalies by root signature and prints prompt-injection-hardened agent briefs (`--brief <id>`) |
| `replay.mjs` | Replays a saved feedback or session bundle in Chrome with WebGPU, restoring world edits, exact camera pose, foot/driving inputs and traffic PRNG |
| `playtest.mjs` | Automated & AI-scriptable (`--script actions.json`) open-world GTA-style playtester (destroying buildings, stealing/driving/crashing cars, rubble parkour) that flushes telemetry to the inbox |
| `live.mjs` | Serves main from a checkout of its own after each merge |

## Checks and tools

```sh
cd engine
npm run check                     # every check: cargo test, tsc, then each check of the real page in Chrome
npm run check -- --changed        # only the checks that cover what the branch changed against origin/main
npm run check -- --changed --list # which checks cover the change, and why, without running them
node test/all.mjs --only falls,blast
npm run sf                        # the San Francisco realm from static files, its look and its loader
npm run lobby                     # every check of playing in someone else's server
npm run typecheck
node test/bench.mjs               # how fast the march is against test/baseline.json
node test/drive-smooth.mjs --curve    # what going at 0, 60, 120 and 180 km/h costs a frame (--sf <folder> for San Francisco)
node test/paired.mjs --b 'bricks=1'   # what a change costs the march, A and B measured turn about
node test/look.mjs --out file.png --at 0,40,0 --look 20,-8   # one picture with given settings
node test/read.mjs                # the device reports the server kept
node playtest.mjs --scenarios all # automated GTA-style playtest into the local inbox
node scan.mjs --since 24h         # cluster recent feedback & session anomalies (add --brief <id>)
node replay.mjs <bundle.json>     # deterministically replay a saved feedback or session bundle
```

Iterate with `--changed`, then run everything once on the head you report. `test/changed.mjs` maps files to checks. Every module of the page comes in through `page/main.ts`, so a change there or in the core runs everything.

Checks that draw share the machine's one GPU, so each waits for a turn (`turn` in `test/kit.mjs`). The page checks run two at a time, so the times they print are not for quoting. Use `test/bench.mjs` or `test/paired.mjs` to measure. Page checks drive the real page in the installed Chrome. `test/make.mjs` puts kept replies in a model's place, so it proves the plumbing, not a model.

## Where to read more

| Topic | Read |
| --- | --- |
| The parts and how a frame is made | [the engine](../guide/engine.md), [the core](../guide/engine-core.md), [the page](../guide/engine-page.md), [worlds as cells](../guide/cells.md) |
| Playing: controls, driving, map, sky, eggs | [gameplay](../guide/gameplay.md) |
| Drawing from a plugin | [render passes](../guide/render-passes.md), [plugin types](../guide/plugin-types.md) |
| Making things from words | [making](../guide/making.md) |
| Living things, bodies and people who answer | [living](../guide/living.md) |
| One scene from static files, for an iframe | [player/](player/README.md) |
| Rules, realms and engine plugins | [engine plugins](../guide/engine-plugins.md), [workshop/](workshop/README.md) |
| Native in-game T3 Studio & Game-Use MCP | [Studio & Game-Use IDE](../guide/studio.md), [studio/](studio/README.md) |
| Sound and music | [sound](../guide/sound.md), [page/sound/](page/sound/README.md) |
| Shared worlds, dedicated servers and lobbies | [multiplayer](../guide/multiplayer.md), [hosting](../guide/hosting.md) |
| The city from data and its releases | [city pipeline](../guide/city-pipeline.md), [San Francisco release](../guide/sf-release.md), [bay/](bay/README.md) |
| Publishing the realm | [deploy](../guide/deploy.md), [site](../guide/site.md) |
| The kit's blocks and fonts | [blocks and fonts](../guide/blocks-and-fonts.md), [blocks/](blocks/README.md), [kit/](kit/README.md) |
| The checks | [checks](../guide/checks.md), [check runner](../guide/check-cli.md) |
| What the engine is, costs and lacks | [cell-engine skill](../.agents/skills/cell-engine/SKILL.md) |
