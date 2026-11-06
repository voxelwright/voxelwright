# Village home

The family kitchen at golden hour, painterly and stylized, rendered with three.js (WebGPU, falling back to
WebGL2). Every piece of the scene is a Cordis plugin that unloads cleanly.
All textures are painted in code in `src/paint.ts`.

## Run

```sh
npm install
npm run dev            # http://localhost:5181, add ?q=low for phones
npm run measure -- --perf --unload   # with the dev server running, headless
node scripts/check-kernel.mjs        # plugin failure and draw-pass checks
npm run typecheck
npm run build
```

`?plugins=renderer,room` loads only the named plugins; when `rooms` is listed, each room brings only its listed plugins. `window.village` exposes
`snapshot()`, `load(name)`, `unload(name)` and `ready()` for inspection.

A plugin whose `apply` throws is logged, emits `village/plugin-error`, has its
effects released and is removed from the registry, so a fixed version can load
under the same name. `ready()` resolves once every requested plugin is active
or failed and returns `ok`, the active list and any problems. `snapshot()`
separates registered, active and failed plugins. Post-processing adds a draw
pass with `stage.addDrawPass()`; passes are removed by identity, so plugins can
unload in any order.

## Plugins

`renderer` provides the `stage` service: renderer, scene, camera, quality and
the per-frame `village/frame` event. `camera` provides the `view` service,
which eases the camera to a pose and back. Every other plugin injects `stage`:
`room`, `window`, `glass`, `sunbeam`, `cabinets`, `table`, `chairs`,
`highchair`, `fridge`, `toyshelf`, `botanical`, `plant`, `motes`, `lamp`,
`rimlight`, `postfx` and the living room's `lounge`, `sideboard`, `growshelves`,
`plantstand` and `loungedoors`. `entries` is the interaction layer, `rooms` loads rooms,
and `notebook`, `fridge`, `kitchendoor`, `growshelves` and `loungedoors` register entries. Each one registers its
objects, listeners and atmosphere through Cordis effects, so `fiber.dispose()`
reverses them. `own()` in `src/kernel.ts` also releases each object's
geometries, materials and textures. In dev, every plugin file accepts Vite hot
updates by disposing the running fiber and loading the edited module.

## Notebook

Click or tap the notebook, or Tab to it and press Enter, and the camera eases down
to the open page. Typing appears on the paper in handwriting. Enter keeps the
line in this browser's local storage (`village.notebook.lines`). Escape or a
click elsewhere eases back. With `prefers-reduced-motion` the camera moves
without easing. `node scripts/check-notebook.mjs` proves the keyboard and
pointer paths, storage, reduced motion and a clean unload and reload.

## The home is the menu (#37)

There is no menu bar. Meaningful objects are entries, registered through the
`entries` plugin with a label, an object and an action. Pointer hover gives a
soft warm glow and a handwritten label; click or tap chooses; Tab cycles the
entries on screen from left to right and wraps, Enter chooses, Escape or a
click elsewhere backs out. Touch skips hover. The nearest visible, depth-writing mesh under the pointer wins, so furniture blocks the entries behind it; light shafts, glows and hidden rooms do not. With `prefers-reduced-motion`
glows, labels and camera moves are instant.

Entries today: the notebook, the fridge (frames its door; family moments and
what's coming up will live there), the kitchen doorway ("Living room"), and in
the living room the plant shelves ("Idea garden", a placeholder for Plant a
Seed), the doorway back ("Kitchen") and the closed "Workshop" door.

Rooms are groups of plugins (`PLANS` in `src/plugins/rooms.ts`). Choosing a
doorway eases the camera towards it, fades through warm dark, swaps rooms and
eases in. `?room=living` starts in the living room. By default the
neighbouring room stays loaded but hidden, because loading on entry stalled
one frame for 0.5 to 2.2 s behind the fade; `?rooms=unload` loads on entry and
unloads on leaving. `node scripts/check-entries.mjs` proves keyboard and
pointer reach for every entry, the walks, reduced motion, and that leaving a
room under `?rooms=unload` leaves no objects, plugins, frame hooks, geometries
or DOM behind; `--keep` runs the walks with the default.

Walk measurements, headless Chrome, 1440×900, DPR 1, four walks each:

| Policy | Swap behind the fade | Worst frame during a walk |
| --- | --- | --- |
| unload on leaving | 0.63 to 1.11 s | 0.52 to 2.2 s |
| keep neighbour loaded (default) | 0.09 s | 33 to 50 ms |

Per room at rest, headless Chrome, 1440×900, WebGPU, holding 60 fps (the
headless cap) in every mode:

| Room | Mode | Draw calls | Triangles |
| --- | --- | --- | --- |
| kitchen | DPR 2 | 480 | 52,121 |
| kitchen | `?q=low` | 412 | 48,893 |
| living | DPR 2 | 187 | 39,249 |
| living | `?q=low` | 140 | 22,003 |

## Measured, kitchen scene (November 6, 2026)

Headless Chrome through Playwright 1.65 (`--enable-unsafe-webgpu
--use-angle=metal`), 1440×900, Apple M1 Pro. Backend: WebGPU.

| Mode | Canvas | p50 frame | p95 frame | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| default, DPR 2 | 2880×1800 | 16.7 ms | 16.7 ms | 541 | 35,301 |
| `?q=low` | 1440×900 | 16.7 ms | 16.8 ms | 473 | 32,073 |

Headless Chrome caps animation frames at 60 Hz, so these show the scene holds
60 fps, not how much headroom remains. The `--unload` proof still restores the
same objects for `fridge`, `postfx` and `room`.

## Measured, first scene (November 6, 2026)

Command: `node scripts/measure.mjs [url] --perf --unload --shot=path --headed`
with the dev server on port 5181. These numbers came from headed Google Chrome
through Playwright 1.65 at 1440×900. The script now runs headless unless
`--headed` is passed, so it doesn't take focus on a Mac someone is using. Hardware: Apple M1 Pro with a 120 Hz display.
Backend: WebGPU.

| Mode | Canvas | p50 frame | p95 frame | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- |
| default, DPR 2 | 2880×1800 | 8.3 ms | 9.2 ms | 133 | 16,525 |
| `?q=low` | 1440×900 | 8.3 ms | 9.3 ms | 133 | 14,525 |

Both modes hold the display's 120 Hz refresh, so the frame time is capped by
vsync. These numbers show the headroom is above 60 fps; they don't show the
real GPU cost. WebGL2 and phones were not measured.

Unload proof (`--unload`): unloading and reloading `fridge`, `postfx` or `room`
restores the same sorted scene object list, plugin set, frame-listener count,
fog and draw function. Geometry counts return exactly (48). Unloading every
scene plugin leaves one scene node, no frame listeners and the plain draw
function. That matches a fresh `?plugins=renderer` page, except for one
texture held inside the renderer. The first postfx reload also leaves two
textures inside the renderer. Neither count grows over repeated cycles.

Hot reload: editing `src/plugins/fridge.ts` while the page was open replaced
the fridge without a page reload. The new rotation applied, and the object
and GPU counts stayed the same.

## Villager (#40)

Enter in the notebook also sends the line to Alex's villager (a synthetic
person). Its reply is written onto the facing page in its own green hand, at
32 characters a second, so a reply that arrives in chunks still reads as
writing. The finished reply goes to a polite live region for screen readers.
After a reload the last answer is already on the page. If the villager host is
not running, the page says "Your villager is out for a moment" and the line is
still kept in local storage.

The dev server (`vite.config.ts`) hands same-origin pages the host's
per-launch token at `/villager/launch`, read from
`$VILLAGE_ROOT/villager/launch.json` (default `~/.village`), and forwards
`/villager/api/*` to the host on `127.0.0.1:$VILLAGER_PORT` (default 5190).
Start the host with `npm run villager` in `host/`.

`node scripts/check-villager.mjs [--shot=path]` starts its own stub host and
dev server on a temporary root and proves, headless: the token is required
and not handed to cross-site requests; Enter sends the line and the reply is
written gradually onto the facing page; the proxy streams without buffering;
the answer is back after a reload; after a host restart the page fetches the
new token and the villager resumes the same session; with the host down the
page says so and keeps the line; both processes stop. 13 of 13 passed
(November 6, 2026). `--agent=claude` runs one real exchange instead.

Real exchange, November 6, 2026, M1 Pro, `--agent=claude` (Sonnet), line "I
keep forgetting to water the plants": one `write_note` call created
`notes/plants.md`, then a four-sentence reply. Sonnet 6 input, 288 output,
3,154 cache-read and 1,741 cache-creation tokens; a Haiku helper call 1,176
in and 17 out. Cost $0.0103. First text 5.3 s, whole turn 5.9 s, measured in
the host from the start of the turn. Screenshot:
`screenshots/villager-sonnet.jpg`.
