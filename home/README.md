# Village home

> **Paused prototype.** Active work is in the [engine](../engine/README.md). This folder still builds and its checks run.

The home is Village's private family house: a painterly kitchen and living room drawn with three.js (WebGPU, falling back to WebGL2), where each person talks to their own villager, builds rooms, places things and plays with physics toys. Every piece of the scene is a Cordis plugin that unloads cleanly, and every texture is painted in code (`src/paint.ts`). The page talks to the villager host in [`host/`](../host/README.md). The [Village guide page](../guide/village.md) shows how the parts fit.

## Run

```sh
npm install
npm run dev              # http://localhost:5181
npm run typecheck
npm run build
```

Talk, villagers, build mode and physics need the villager host behind the page. In a second terminal:

```sh
cd ../host && npm install && npm run villager    # 127.0.0.1:5190, the port the dev server forwards /villager/api/* to
```

The daily way to run the whole home (live copy, villagers, Elder, pairing, launchd) is `npm run village` in `host/`.

### Query parameters

`src/features.ts` is the one rule for which features a page has. Talk, villagers, the dollhouse view, babble, build mode and physics are on by default.

| Parameter | Effect |
| --- | --- |
| `?talk=off` | The quiet seated kitchen: no villagers, music or babble, no build mode. |
| `?build=0` | Build mode off. `?build=1` turns it on with any talk setting. |
| `?physics=0` | No physics world and no WebAssembly; the page keeps the stricter policy. `?physics=panel` shows the world-rules panel (dev builds). |
| `?cam=seat`, `iso`, `third` | Seated view, dollhouse view (the default with talk) or a camera behind a walking point. |
| `?q=high`, `medium`, `low` | Skip GPU calibration and use that tier (`TIERS` in `src/plugins/renderer.ts`). |
| `?fx=phys,csm,gtao,traa,ssgi` | Run exactly the named render features. |
| `?webgl=1` | Use three.js's WebGL2 backend even where WebGPU exists. |
| `?gpu=1` | Record GPU busy time per frame from timestamp queries (`src/gpu-time.js`). |
| `?room=living` | Start in or framed on the living room. |
| `?plugins=renderer,room` | Load only the named plugins (used for baselines). |
| `?theme=<id>` | Load a theme from `src/theme/presets/`. |

`window.village` exposes `snapshot()`, `load(name)`, `unload(name)` and `ready()`. `ready()` resolves once every requested plugin is active or failed. A plugin whose `apply` throws is logged, emits `village/plugin-error`, has its effects released and leaves the registry, so a fixed version can load under the same name.

## How it is built

- **Plugins.** `renderer` provides the `stage` service (renderer, scene, camera, quality tier, the per-frame `village/frame` event); `camera` provides `view`. Every other plugin injects `stage` and registers its objects and listeners as Cordis effects, so `fiber.dispose()` reverses them. `own()` in `src/kernel.ts` also frees each object's geometries, materials and textures. In dev, an edited plugin file hot-swaps by disposing the running fiber first.
- **Rooms.** `PLANS` in `src/plugins/rooms.ts` groups plugins by room. The kitchen and living room are one house, always drawn; a doorway glides the camera between them.
- **The home is the menu.** There is no menu bar. Meaningful objects (the notebook, the fridge, the doorway, the plant shelves, the Workshop door) are entries registered with the `entries` plugin: hover glows and labels, click or tap chooses, Tab walks the entries on screen left to right and leaves the scene past either end, Escape backs out. Reduced motion makes glows, labels and camera moves instant.
- **Talk.** A keypress anywhere starts writing on a held notepad (`src/talk/input.ts`). Enter sends the line to the host's router, which returns one of the routes in `ROUTES` (`host/src/villager-input.ts`): talk, answer, furnish, project, journal, theme, build, physics or elder. The page checks the route (`src/talk/route-check.ts`) and acts only on what the person's own words named.
- **Physics.** Every thing drawn in the house is a body by one rule (`src/physics/home.ts`): `userData.body` on an object says its material and motion, and anything without it is static walnut. The world (`src/engine/world.ts`) runs toys: data made of parts, gadgets with knobs, and wires between gadgets (`src/engine/toy.ts`). The pinball table, the candle and fire, heat and water are built this way. The solver is Jolt (`src/engine/jolt.ts`), chosen by the [physics bench](bench/physics/README.md).
- **Build mode.** The floor plan is JSON with one home for each fact (`src/build/plan.ts`): corners own positions, walls name two corners, rooms are loops of corner ids. Edits are small JSON objects, and each version stores the plan that results. The host keeps the shared house's versions.
- **Reminders.** `src/plugins/reminders.ts` asks the host every 30 s and when the page becomes visible. A due reminder is pinned to the fridge door as a note; the page acknowledges it, and a lost acknowledgement means it arrives again, deduplicated by id.
- **Themes.** A theme shifts lights, materials and fog by role (`src/theme/plugin.ts`) and eases each change (`src/theme/switch.ts`). Presets live in `src/theme/presets/`.

## Folder map

| Path | What it holds |
| --- | --- |
| `src/main.ts`, `src/kernel.ts` | Plugin loading, `window.village`, the Cordis kernel additions. |
| `src/features.ts` | Which features a page has, from its query. |
| `src/plugins/` | Every scene piece and interaction: renderer, camera, rooms, entries, furniture, talk, villagers, build, place, physics, reminders, sound, music, themes, the door to the street. |
| `src/engine/` | The physics world: `World`, toys, gadgets, rules, materials, the Jolt adapter, cells (`voxels.ts`, `cells.ts`). No app imports, so the street runs it too. |
| `src/physics/` | The home as bodies: hands, touch, tidying, impacts, the toys and invented mechanics. |
| `src/invent/`, `src/props/`, `src/sealed.ts` | Sandboxes for model-written code (below). |
| `src/build/` | The floor plan, its edits, history, lot and placement. |
| `src/talk/` | The notepad, route checks, the Elder line, furnishing and sketches. |
| `src/villagers/`, `src/villager.ts` | The felt villagers: cast, rig, motion and the generator. |
| `src/theme/`, `src/sound/`, `src/voice/` | Themes, sound cues and the villagers' babble voices. |
| `src/pair.ts` | The pairing card for a home-screen app. |
| `scripts/` | Checks, `measure.mjs`, `perf-gate.mjs`, demos and shot tools. |
| `bench/physics/` | The solver comparison that chose Jolt. |

## Checks

The root runner owns every check. Run one or several by name:

```sh
cd .. && npm run check -- --only kernel notebook entries
```

Names that run in `home/` (from `scripts/checks.mjs`): `home-typecheck`, `home-build`, `plan-history`, `route-inside`, `engine-no-page`, `voxels`, `kernel`, `notebook`, `entries`, `navigation`, `build-plan`, `babble`, `themes`, `villager-gen`, `villager-motion`, `music`, `sound`, `sound-lab`, `build-addroom`, `place`, `physics`, `physics-fire`, `physics-toys`, `invent`, `reminders`, `physics-touch`, `tactile`, `physics-game`, `prop-sandbox`, `sketch`, `talk-input`, `talk-notebook`, `talk-npc`, `theme-ask`, `villager`. The runner starts one shared dev server for the checks that open a page on it and hands every check free ports, so none depends on 5181 or 5190. A check that needs a villager host starts a stub of its own.

Two tools run by hand:

```sh
npm run measure -- --perf --gpu      # with the dev server running: frame times and GPU ms, headless
npm run perf-gate                    # production builds of the merge base and the working tree, measured side by side
```

`perf-gate` alternates base and head pages in one headless Chrome and fails on dropped 60 fps frames, GPU headroom at the high tier (13 ms p50, 16 ms p95) or growth over the base. Its options are in the header of `scripts/perf-gate.mjs`.

## Trust boundaries the page enforces

- **Content Security Policy** (`vite.config.ts`): scripts, fetches and sockets reach only the page's own origin. Physics adds `'wasm-unsafe-eval'` so Jolt can compile; `?physics=0` keeps the policy without it.
- **Model-written code never runs in the page.** A made prop (`src/props/`, dev builds only) or an invented mechanic (`src/invent/`) runs in a worker inside a sealed frame: an opaque origin with its own policy and no network (`src/sealed.ts`). A mechanic runs in a QuickJS interpreter inside that worker with no host functions bound. Only text comes back, and the engine checks it field by field (`src/engine/invent.ts`). The page listens on one `MessagePort`, never on `window` messages.
- **The session cookie is out of reach.** Pairing sets an HttpOnly cookie, so page scripts (promoted plugins included) can use the session but never read it. They can still act as the paired person while the page is open.
- **The street's address** is believed only when it is on this page's own host name (`src/plugins/street.ts`).

## Ideas to carry forward into the engine

1. **The home is the menu.** Objects in the world are the interface, with full keyboard reach and no trap: `src/plugins/entries.ts`.
2. **One rule makes everything a body.** Material and motion as data on the drawn object, defaults that hold still: `src/physics/home.ts`.
3. **Toys as data: parts, gadgets with knobs, wires.** A pinball table needs no game code: `src/engine/toy.ts`, `src/engine/gadgets.ts`, `src/physics/toys/pinball-table.ts`.
4. **Three walls around model code.** Sealed frame, worker, interpreter, checked text out: `src/invent/sandbox.ts`, `src/sealed.ts`.
5. **A floor plan with one home per fact,** small JSON edits and stored versions: `src/build/plan.ts`, `src/build/history.ts`.
6. **A notepad that routes.** One input; a router names the intent; the page acts only on what the person's own words said: `src/talk/input.ts`, `src/talk/route-check.ts`.
7. **A performance gate against the base,** interleaved, with GPU time from timestamp queries: `scripts/perf-gate.mjs`, `src/gpu-time.js`.
8. **Measured quality tiers.** Calibrate on real GPU time and step down once: `TIERS` in `src/plugins/renderer.ts`.
