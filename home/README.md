# Village home

The family kitchen at golden hour, painterly and stylized, rendered with three.js (WebGPU, falling back to
WebGL2). Every piece of the scene is a Cordis plugin that unloads cleanly.
All textures are painted in code in `src/paint.ts`.

## Run

```sh
npm install
npm run dev            # http://localhost:5181, ?q=high|medium|low overrides the measured tier
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

## Engine: GPU time, features and tiers (#41, November 6, 2026)

`npm run measure -- --perf --gpu` adds `?gpu=1` and reports, per frame, GPU ms
(submit to `device.queue.onSubmittedWorkDone()`), the summed three.js timestamp
pass durations, and CPU ms (frame hooks plus draw). Chrome launches with
`--enable-webgpu-developer-features`; timestamp sums were then not on 100 us
steps. GPU ms is quantized to 0.1 ms by `performance.now()`. The timestamp sums
are not frame cost on this Mac: bloom mips of a few pixels each read about 5 ms
and a frame summed to 60 to 70 ms while holding 60 fps, so passes overlap.

`?fx=phys,csm,gtao,traa,ssgi` runs exactly the named features: physical
materials (lacquered fridge, transmissive window glass, glazed mug and ceramics),
cascaded soft sun shadows, GTAO at half resolution, TRAA in place of 4x MSAA,
and SSGI (2 slices, 8 steps). Headless Chrome, 1440x900, DPR 2, M1 Pro, WebGPU,
one 6 s run each; repeat runs of the same page vary by 1 to 3 ms:

| Room | Features | GPU p50 / p95 ms |
| --- | --- | --- |
| kitchen | none | 7.0 to 7.9 / 9.5 to 10.2 |
| kitchen | phys | 11.9 / 16.2 |
| kitchen | csm | 9.9 / 11.2 (draw calls 480 to 766) |
| kitchen | gtao | 16.9 / 17.4 (frame bound) |
| kitchen | traa | 12.8 / 17.1 |
| kitchen | gtao, traa | 12.6 / 16.5 |
| kitchen | phys, csm, traa | 9.1 / 11.2 |
| kitchen | phys, traa (high tier) | 11.5 / 16.9 |
| kitchen | ssgi | 293.8 / 298.0 (15 fps) |
| kitchen | `?q=low` | 3.4 / 4.4 |
| living | none | 6.6 / 9.2 |
| living | phys | 7.7 / 9.4 |
| living | gtao | 14.4 / 23.1 |
| living | traa | 8.3 / 10.2 |
| living | phys, traa (high tier) | 8.5 / 10.3 |
| living | `?q=low` | 3.2 / 4.5 |

SSGI is not usable here; baked lighting is the next step for bounce light.

Tiers (`TIERS` in `src/plugins/renderer.ts`): high is DPR 2 with phys and traa,
medium DPR 1.5 with phys and traa, low DPR 1 with none. Without `?q=`, the page
skips 15 frames, takes the median GPU ms of 45 frames (or of 2 s, at least 8),
and steps down when high exceeds 13 ms or medium exceeds 12 ms. Stepping down
lowers the pixel ratio and rebuilds postfx; scene content keeps its load-time
detail. `?q=high|medium|low` skips calibration, and `?q=low` behaves as before.
`?fx=ssgi` with no `?q=` proved the step-down: 294 ms at high moved to medium.

Look (one round, blind A/B, rubric only, before `?q=high&fx=` against after
`?q=high&fx=phys,csm,traa`): Opus 6.5 to 7.0, Sonnet 7.1 to 7.3. Both saw
calmer speculars (faucet, cabinet edge) and a cleaner steam wisp; neither saw a
shadow change. GPT was not available. Screenshots: `screenshots/engine-before.png`,
`screenshots/engine-after.png`.

Ally (Linux, AMD Phoenix1): no Chromium, Chrome or Node installed, so nothing
was measured there.

## Camera variants (#42 probe)

`?cam=iso` looks down on the room like a dollhouse: a 20° perspective camera
16 m away (the stage camera stays perspective, so postfx and entries keep
working). Drag or Q/E orbit within about -30° to +80°, the wheel zooms from the
whole room to the table. `?cam=third` stands 2.4 m behind and 2.2 m above a
point on the floor; clicking the floor walks there, clicking an object walks to
a step in front of it (and chooses it, if it is an entry). Without `?cam=`
nothing changes. Both rigs hang off the resting pose that `travel()` moves, so
room walks work, and focus poses blend the field of view back to 40°. Q/E are
ignored while typing, so the notebook still takes the letter q.

Iso is a dollhouse cutaway. Only the iso plan loads `diorama` (kitchen) and
`loungediorama` (living room); `src/diorama.ts` builds the shell: a base with
a soft contact shadow, a floor clipped to the walls, thick walls with painted
caps, and low cut stubs that take a wall's place when the camera stands
outside it. Walls tagged `userData.inward` that face away move to a
shadow-only layer (`SHADOW_ONLY`), so they keep casting; in both wider views the
sun's shadow box covers the whole room, which removed the hard sun wedges.
Behind the kitchen sits a garden plot with a tree, which the window looks down
on, and the doorway passage has an outside. The pendant hangs from a braced
wall arm, and a soft pool on the table shows it is on. The kitchen's 9 m floor
and the painted garden card are `userData.seatOnly`. `?cam=third` keeps the old
fixes: walls cut away, fog slid back and a warm backdrop.

Still open in iso: the lamp shade reads dark from above; the living room's
walls are greyer than the kitchen's. (The bare floor and the tabletop bloom are
fixed; see "The room as a home screen" below.) In third person, walking to the
fridge leaves two entries on screen. `cam-third-fridge.jpg` was taken with the
pointer still on the fridge, so its hover glow makes it look beige.

Look (ui-craft, a fresh `claude -p --model opus` scorer each round, given only
the six iso shots, the seated view and the rubric), overall / diorama / daily:
before 5 / 4 / 5, round 1 5 / 5 / 5, round 2 5 / 5 / 5, round 3 5 / 5 / 5.
Stopped on the plateau; the remaining findings are mostly room content.

The seated view is unchanged. Comparing seated captures from before and after
(mocked clock, seeded `Math.random`): the kitchen at `?q=low` differs by
a mean of 0.10, against 0.11 between two runs of the old code; at
`?q=high&fx=` it differs by 2.67, the same as between two runs (film grain);
the living room at `?q=low` is identical (0.00).

Headless Chrome, 1440x900, DPR 2, WebGPU, `?q=high`, kitchen, one 6 s run each
(`npm run measure -- <url> --perf --gpu`):

| Mode | Draw calls | GPU p50 / p95 ms |
| --- | --- | --- |
| seat | 482 | 8.7 / 10.4 |
| `?cam=iso` | 491 | 10.6 / 17.1 |
| `?cam=third` | 491 | 10.8 / 17.1 |

The extra 9 draw calls are objects the wider views no longer cull.
Screenshots: `screenshots/talk/cam-*.jpg`.

Dollhouse shell, same setup, one 6 s run each:

| Mode | Draw calls | Triangles | GPU p50 / p95 ms |
| --- | --- | --- | --- |
| `?cam=iso&q=high`, before | 491 | 52,856 | 8.8 / 16.7 |
| `?cam=iso&q=high`, after | 555 | 66,358 | 9.8 / 16.7 |
| `?cam=iso&q=low`, before | 421 | 49,625 | 4.1 / 5.0 |
| `?cam=iso&q=low`, after | 485 | 63,127 | 4.7 / 6.8 |
| `?cam=iso&q=high&room=living`, after | 193 | 41,272 | 9.2 / 11.5 |

Screenshots: `screenshots/talk/iso-*.jpg`, since replaced by the furnished room below (`room-home-before.jpg` is this shell).

## The room as a home screen (#42, November 6, 2026)

The dollhouse view is the home screen, so the kitchen is furnished for it and
the house stands in a yard. The seated view changed with it (fruit, flowers and
a clock are on its table and wall); compare `room-seat-before.jpg` and
`room-seat-after.jpg`.

- Ground (`yard()` in `src/diorama.ts`, both dioramas): a lawn board a little
  below the house floor, a picket fence with a gate, stepping stones, flower
  clumps, shrubs and an orchard row, on an unlit painted worktable that fades
  into the fog. Fence posts, stones and blooms are instanced; all trees in a
  yard are merged into three meshes. The lawn takes no sun shadow (the low sun
  laid the house's 8 m shadow across it in wedges); a soft decal grounds the
  foundation. In iso the sun's shadow box is ±8 m.
- Kitchen (`furnish`, all camera modes): braided rug under the table, runner by
  the sink, a stove on the right wall with a towel on the oven bar and a kettle,
  a pan rail, a framed print, a painted dresser with an open shelf of jars and
  cookbooks, coat pegs and a bench with wellies by the doorway, a toy box, a
  reading chair with a lamp and side table, a tall basket plant, fruit and a jug
  of flowers on the table, and a wall clock that shows the real time. Living
  room (`loungefurnish`): sofa, round rug, coffee table, bookcase, floor lamp,
  reading chair, blanket basket, plant, pouf and board games, all left of or
  behind the seated view's line.
- Everything keeps clear of the corridors in `villagers/world.ts`; no waypoint
  moved. Rugs are 3 mm thick so the villagers' 4 mm contact shadows stay on top.
- Props are built with `src/kit.ts`: each part's transform and colour are baked
  into vertices and parts merge by material, so the kitchen's furniture is
  about a dozen draws. Things hung on the side walls sit in their own groups
  tagged `inward`, so they hide with their wall when the camera stands outside it.
- Contact shadows: one merged decal mesh per room (a wide and a tight quad per
  footprint) under furniture, the same at `?q=low`.
- Materials: floor roughness 0.86 and boards about 14 cm wide with staggered
  joints (`floorPlanks()`, shared by the seated and dollhouse floors); tabletop
  roughness 0.74 and the lamp's light pool at 55%, which removed the white
  hotspot; cabinets in grained eggshell paint over a darker carcass, so door
  gaps read; brushed steel fridge without the clear coat; the lamp arm painted
  cream and thinner.

Frame cost, headless Chrome, 1440x900, WebGPU, M1 Pro, `npm run measure --
'<url>' --perf --gpu`, one 6 s run each while the villagers walked (GPU p50
varies 1 to 3 ms between runs):

| Page | Draw calls | Triangles | GPU p50 / p95 ms |
| --- | --- | --- | --- |
| `?talk=npc&q=high`, before | 734 | 113,708 | 9.6 / 15.2 |
| `?talk=npc&q=high`, after | 781 | 184,116 | 10.2 / 17.2 |
| `?talk=npc&q=low`, before | 665 | 110,478 | 5.2 / 6.1 |
| `?talk=npc&q=low`, after | 712 | 180,886 | 4.9 / 7.5 |

High stays under its 13 ms step-down. Most new triangles are the trees' lobed
crowns and the fence, drawn again in the shadow pass.

Look (ui-craft, a fresh `claude -p --model opus --strict-mcp-config` scorer
each round, given the eight shots, the previous build's shots and the rubric
plus "a finished, lived-in diorama" and "home screen every day"; overall /
diorama / daily): round 1 6.2 / 6 / 6.5, round 2 7 / 7 / 7, round 3 7 / 7 / 7
(low tier 8). Stopped at the time box after three rounds. Open findings: the
lamp still hangs from a visible arm (no ceiling in the cutaway); the living
room's hard key-light shadows differ from the kitchen's soft light; contact
shadows under the villagers are still faint (`villagers/cast.ts`); the window's
painted view doesn't match the yard; the high chair and the fridge baskets
don't match the new props; fixed-height talk cards and Moss's floating limbs.

Screenshots: `screenshots/talk/iso-*.jpg` (home, both orbit ends, the table,
low tier, living room), `room-table-chat.jpg`, `room-home-before.jpg`,
`room-seat-before.jpg` and `room-seat-after.jpg`.

## Generated props (#42 experiment, November 6, 2026)

Question: how fast and how good can a model make a new furniture prop in this
style from a line of text? Two arms, same five prompts, same style guide
(`scripts/props/style.md`):

- **A, free code**: the model writes a module `build(api)` that gets three.js,
  `RoundedBoxGeometry` and the `paint.ts` painters through `api`.
- **B, JSON spec**: the model writes a prop spec (box, cylinder, sphere, lathe,
  extrude; per-part transform and bevel; wood, fabric, painted, metal, ceramic
  and wallpaper presets; an overall size). `src/props/spec.ts` validates it,
  clamps lengths to 0.002 to 3 m, and rejects more than 60 parts or 8
  materials and any unknown shape or preset. The spec is never executed.

`?props=<run-id>[,<run-id>]` loads results from `generated/props/` (git-ignored)
into the kitchen; `&focus=1` frames them. `main.ts` imports the loader only in
dev builds with the flag, so without it nothing loads and the production build
contains none of it. Run, with the dev server on 5302:

```sh
node scripts/props/run.mjs <out>      # claude -p, 5 at a time, one repair pass on failure
node scripts/props/capture.mjs <out>  # iso + close captures, draw calls, the floor
node scripts/props/score.mjs <out>    # a fresh claude -p --model opus scorer per result
node scripts/props/sheet.mjs <out>    # one sheet per prompt and results.md
```

Latency is wall clock for `claude -p` (default effort, about 1 to 2 s of CLI
start included), measured with 5 calls running at once. Triangles and draw
calls are the `?cam=iso&q=high` frame minus a frame without props (shadow
passes included). Scores are 1 to 10 for "belongs in this painterly home" and
"is what was asked", from Opus given the two captures and the request.

| Prompt | Arm | Model | Latency s | First try | Repair | Out tokens | Triangles | Draw calls | Belongs | Asked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | B | haiku | 11.1 | yes |  | 1525 | 1824 | 4 | 6 | 6 |
| 1 | B | sonnet | 9.4 | yes |  | 1240 | 2048 | 22 | 7 | 7 |
| 1 | B | opus | 22.8 | yes |  | 2291 | 5680 | 20 | 6 | 6 |
| 1 | A | haiku | 18.0 | yes |  | 3649 | 3872 | 6 | 6 | 6 |
| 1 | A | sonnet | 8.2 | yes |  | 1142 | 5344 | 26 | 7 | 7 |
| 1 | A | opus | 21.5 | yes |  | 2156 | 6272 | 30 | 8 | 8 |
| 2 | B | haiku | 40.4 | yes |  | 9348 | 24000 | 80 | 6 | 7 |
| 2 | B | sonnet | 17.5 | yes |  | 2601 | 13296 | 52 | 7 | 7 |
| 2 | B | opus | 27.4 | yes |  | 2910 | 15600 | 52 | 6 | 7 |
| 2 | A | haiku | 27.8 | yes |  | 5800 | 24000 | 80 | 6 | 7 |
| 2 | A | sonnet | 11.9 | yes |  | 1629 | 26064 | 60 | 6 | 7 |
| 2 | A | opus | 27.3 | yes |  | 2831 | 20352 | 64 | 6 | 7 |
| 3 | B | haiku | 22.2 | yes |  | 4235 | 4976 | 27 | 7 | 8 |
| 3 | B | sonnet | 21.9 | yes |  | 2808 | 6304 | 33 | 7 | 8 |
| 3 | B | opus | 55.7 | yes |  | 5654 | 8920 | 43 | 7 | 8 |
| 3 | A | haiku | 18.7 | yes |  | 4018 | 8880 | 32 | 6 | 8 |
| 3 | A | sonnet | 20.9 | yes |  | 2936 | 17872 | 48 | 8 | 9 |
| 3 | A | opus | 91.6 | yes |  | 5314 | 21624 | 47 | 8 | 9 |
| 4 | B | haiku | 8.3 | yes |  | 474 | 24 | 2 | 3 | 4 |
| 4 | B | sonnet | 4.2 | yes |  | 293 | 1224 | 6 | 5 | 3 |
| 4 | B | opus | 9.7 | yes |  | 534 | 24 | 2 | 5 | 4 |
| 4 | A | haiku | 5.5 | yes |  | 858 | 600 | 2 | 4 | 4 |
| 4 | A | sonnet | 6.1 | yes |  | 611 | 2376 | 6 | 6 | 4 |
| 4 | A | opus | 11.9 | yes |  | 1057 | 24 | 12 | 5 | 4 |
| 5 | B | haiku | 36.8 | yes |  | 7282 | 9280 | 50 | 6 | 7 |
| 5 | B | sonnet | 25.4 | yes |  | 3384 | 9976 | 48 | 7 | 9 |
| 5 | B | opus | 75.4 | yes |  | 8105 | 11192 | 64 | 8 | 9 |
| 5 | A | haiku | 71.7 | yes |  | 15898 | 11988 | 72 | 7 | 8 |
| 5 | A | sonnet | 43.5 | yes |  | 5835 | 16088 | 106 | 8 | 9 |
| 5 | A | opus | 115.9 | yes |  | 11508 | 17512 | 88 | 8 | 9 |

Every result built on the first try (30 of 30), so no repair pass ran and its timing is unmeasured. Arm A was checked by Vite's transform and a runtime build in Chrome, with no type check; arm B by `JSON.parse` and the validator. Cost
was $1.58 to generate and $1.88 to score.

| Arm, model | Median latency s | Mean belongs | Mean asked |
| --- | --- | --- | --- |
| B haiku | 22.2 | 5.6 | 6.4 |
| B sonnet | 17.5 | 6.6 | 6.8 |
| B opus | 27.4 | 6.4 | 6.8 |
| A haiku | 18.7 | 5.8 | 6.6 |
| A sonnet | 11.9 | 7.0 | 7.2 |
| A opus | 27.3 | 7.0 | 7.4 |

Findings:

- Sonnet is the fastest and about as good as Opus. Haiku is not faster: it
  writes 1.2 to 3.6 times Sonnet's tokens (pinball as code: 15,898 tokens, 72 s).
- Free code scores 0.2 to 0.6 higher than the spec on "belongs", and Sonnet's
  code came back faster (median 11.9 s against 17.5 s), but it is model output
  running in the home. The spec arm's gap is in the presets (lathe
  wood shows ring grain; no glass, lights or text) rather than in shapes.
- The pinball machine did not fail. All six read as pinball (asked 7 to 9). It
  is slow, 25 to 116 s, with 48 to 106 draw calls, against 4 to 30 for a table.
- Low "asked" scores for the wallpaper (3 to 4) and the chairs come from this
  harness: the wallpaper prompt asked for a 1.2 m panel, not the whole wall,
  and the chairs were captured without the table they were made for.
- Floor, no generation: a parsed "put a chair by the window" places a copy of
  the existing chair in 31 to 35 ms to the next frame (build 16 to 24 ms).

Fast path, for under 10 to 20 s: Sonnet writing a JSON spec, with the spec
arm's presets extended (glass, a simple emissive, a lathe wood mapping). Spec
results came back in 4 to 25 s. Opus and anything with many parts (the pinball
machine, a scene of several pieces) go to a background project.

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

## Villagers (#42 prototype)

Four art directions for villagers, on one procedural rig, in the real
kitchen. Nothing loads without the flag; with no `?villager=` the plugin adds
nothing.

- `?villager=a` peg dolls (turned, lacquered wood, kin to the toy shelf),
  `b` felt plush (fuzz and stitches painted in code, button eyes, posed on
  twos), `c` paper cutouts (layered cards with brass fasteners, turned toward
  the person), `d` soft-toon household spirits (toon ramp with a warm rim).
  Each direction has a cook, a tidier and a gardener with their own
  silhouettes, colours and props.
- `?villager=lineup` puts one of each side by side in front of the table.
- `&shot=near` moves the camera to a closer angle by the fridge.

The rig (`src/villagers/rig.ts`) plans feet in world space, so planted feet
don't slide. Walkers bob, squash on each footfall, sway over the standing foot
and lean into speed and turns. They breathe, blink and glance while idle, and
hop on and off two chairs (`src/villagers/world.ts` has the spots and the
corridor paths around the furniture). A walker waits for anyone just ahead.
Each villager is an entry: hover glows it, Tab and Enter or a click choose
it, and the chosen one stops, turns to face you and says one synthetic line in
a bubble over its head. Escape or a click elsewhere and it carries on.
Unloading `villagers` three times in a row returned the scene objects,
geometries (265), textures (59), frame hooks, DOM and entries to the no-flag
values.

Frame cost, headless Chrome, 1440x900, DPR 2 (`?q=high`) or 1 (`?q=low`),
M1 Pro, WebGPU, `npm run measure -- '<url>' --perf --gpu`, one 6 s run each
(GPU p50 varies 1 to 3 ms between runs of the same page). Taken before the last
tuning pass (shadow size, colours), which added no draw calls. The first `low`
run of `d` stalled headless (0.2 fps); the table shows a rerun:

| Flag | Tier | Draw calls | Triangles | GPU p50 / p95 ms |
| --- | --- | --- | --- | --- |
| none | high | 482 | 52,124 | 10.5 / 17.0 |
| a | high | 591 | 79,202 | 9.7 / 12.2 |
| b | high | 615 | 88,858 | 10.6 / 17.1 |
| c | high | 597 | 56,218 | 10.2 / 17.1 |
| d | high | 609 | 83,642 | 11.2 / 17.6 |
| none | low | 412 | 48,893 | 4.0 / 7.5 |
| a | low | 521 | 75,971 | 3.8 / 6.6 |
| b | low | 545 | 85,627 | 5.4 / 10.4 |
| c | low | 527 | 52,987 | 4.3 / 8.2 |
| d | low | 539 | 80,411 | 5.5 / 6.9 |

Three villagers cost about 110 to 130 draw calls with shadows, mostly from
separate meshes per part; ten families' worth would need instancing or merged
figures.

Look: a fresh Opus scorer per direction per round saw only the home view and
the closer angle, with the ui-craft rubric plus character appeal, silhouette
distinctness and fit with the room. Means over seven categories:

| Direction | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| a peg dolls | 6.1 | 6.3 | 6.1 |
| b felt plush | 6.6 | 6.9 | 6.4 |
| c paper | 4.9 | stopped | |
| d spirits | 6.0 | 6.0 | stopped |

Every round asked for better grounding (contact shadows, warm rim light) and
complained when furniture hid villagers from the seated view. Screenshots are
in `screenshots/talk/`.

## Notebook, richer (#42 prototype)

`?talk=notebook` swaps the table's notebook for a closed linen book
(`src/plugins/talkbook.ts`; `notebook.ts` returns early on the same flag). Choose
it and the cover swings open while the camera eases down. A cloth ribbon per
villager spills from the pages onto the table, each ending in a sewn tag with
the villager's mark and name; the chosen one also lies down the gutter. Paper
tabs on the fore-edge open Talk and Tasks. Changing villager flips four
leaves, changing section or PgUp/PgDn turns one; with reduced motion the book
opens and turns instantly.

Alex's villager is live through the host API (`src/villager.ts`). June and
Bram are synthetic: their pages say they are not awake yet and take no
writing. Tasks are a synthetic sample list; ticks are kept in local storage
(`village.talk.tasks`), as is the place in the book. A line that could not be
sent stays on the page marked "kept here, not sent" and is never resent on
its own. All text is painted on the paper; the DOM holds one off-screen input
and one polite live region.

Keys while open: type and Enter to write; ← → another villager (when the line
is empty); ↑ ↓ Talk or Tasks; PgUp PgDn earlier and later pages; Tab moves a
warm highlight over ribbons, tabs and tasks and Enter or Space chooses;
Escape closes. The pencilled key note on the villager's card is rubbed out
after the first arrow key. Pointer: click a tag, a tab, a task, or the
"earlier"/"later" corners.

`node scripts/check-talk-notebook.mjs` starts a stub host and dev server on a
temporary root and proves, headless: no change without the flag; the book
takes the table's place; Tab and Enter open it; ArrowRight flips to June,
who takes no writing; a click on Alex's tag turns back; a line gets a reply
written gradually; Tab and Enter tick one task and a click ticks another;
Escape closes; ticks, place and the last answer survive a reload; unload and
load are clean. 15 of 15 passed (stub host, November 6, 2026).

Real exchange through the new notebook (Sonnet, operator login, M1 Pro),
line "Could you help me remember to water the fern?": one note written,
then a four-sentence reply. First text 10.0 s and whole turn 10.7 s measured
in the host; $0.0103. Screenshots: `screenshots/talk/notebook-*.jpg`.

Look, ui-craft rounds (fresh Opus each round, screenshots at `?q=high` and
`?q=low` plus the rubric, "real object, not an app" and friction): mean 6.1,
6.9, 6.9, 6.9; lowest category 5, 6, 6, 5. The 9/10 bar was not reached.
Opus only; no GPT reviewer this slice. Still named: motion polish of the
multi-leaf flip, the sun band across the writing page, and the key note
printed on the paper.

## Talking to villagers (#42 prototype)

`?talk=npc` turns on three felt villagers (direction `b`) and the iso room
view. `?cam=` and `?villager=` still win: `?talk=npc&cam=seat` is today's
seated view, `?talk=npc&villager=a` uses the peg dolls. Without `?talk=` the
home is exactly as before, and `?villager=` alone still shows the art
directions.

Each villager belongs to one synthetic person, and its scarf and name tab
carry that person's colour: Dumpling (cook, Alex), Tuft (tidier, Sam), Moss
(gardener, Mia). Start the host with all three:

```sh
cd host && VILLAGER_PEOPLE=alex:Alex,sam:Sam,mia:Mia npm run villager
```

What works:

- Life: they do chores on their own paths (Dumpling between the sink and the
  fridge photos, Tuft between the toy shelf and the counter, crossing the room
  in front of the table, Moss tending the big plant). Walkers yield to each
  other and step around anyone standing still, then rejoin their path. Now and
  then one looks up from its chore and waves at you; hovering one makes it
  pause, wave and show its name tag, so it is easy to click.
- Talk in one step: click, or Tab and Enter. It stops, hops, turns to you, and
  the camera arcs (rate 7, about 0.4 s) into a close two-shot that turns until
  nothing stands in the way. While the talk is open the shot is locked: a
  walker about to step into it waits at the edge of frame, and one already at
  a chore in frame stays at it. The reply card wears the villager's name tag
  (felt ribbon in its colour, "Dumpling · Alex's"). Replies appear a whole word
  at a time (58 letters a second), on a card already sized for the page, with
  stitched dots while the villager is still talking and "go on" when there is
  more. A page is about two short sentences (one if two would pass 150
  letters). While the model works the villager looks up and taps its chin for
  at least half a second; there is no spinner.
- The slip: one stitched paper slip at the bottom right holds your last line,
  the writing line and two or three chips. Its tab says who the line goes to
  ("to Dumpling · Alex's", "to the table") in that villager's ink, so it never
  reads as the villager speaking. Chips already said are not offered again.
  `?slip=always` keeps the slip on screen with no talk open, addressed to your
  own villager (Alex's Dumpling) with "Write to Dumpling…"; a line written
  there turns Dumpling to you and sends it. Without the flag the slip shows
  only during a talk.
- The table: "Come sit with me" walks the villager (hurrying) to the nearest
  free chair, far side first; the talk prototype adds a fourth chair on the
  near side and a felt booster cushion on each chair, so a seated villager
  clears the table top. Every seated villager answers in turn: their requests
  start together, they speak one at a time with a lit name tag and a lean-in;
  cards that have finished shrink and dim, and only the speaker's tag shows
  while someone speaks. Starting a line with a name ("Tuft, ...") asks only
  that one; clicking a seated villager fills in its name.
- Goodbyes: "Thanks, everyone", or a typed farewell ("thanks, bye", "see you
  later"; the whole line, at most 40 letters), makes each villager say a short
  goodbye in turn and go back to chores. In a one-to-one talk the villager says
  goodbye and goes back. The goodbyes are written per villager, not model
  turns, and nothing is sent to the host. Escape still leaves at once.
- Villagers do not share memory with each other. At the table each one gets
  your line, and what the others said in the previous round as a separate
  `context` field (`POST /people/:id/messages` with `{"text", "context"}`).
  The host passes context to the villager's turn, marked as not the person's
  words, and never stores it in `conversation.jsonl`, so the notebook never
  shows it as your writing.
- The voice (`host/src/villager-agent.ts`): a warm household character, one
  or two short sentences, no lists, at most one gentle question, no talk of
  its notes or limits unless asked, and no claims of things it did not do. It
  writes notes quietly. The notebook uses the same host and voice.
- When the host is down the villager says "Sorry, I'm out for a moment. I've
  kept what you said."; the line stays on the slip and in
  `village.talk.kept` in local storage.
- One in-world signal: a villager with something for you shows a stitched
  felt "!" over its head (synthetic trigger: Moss after its first watering).
  It fades after about a second of hovering or when you talk to it, and
  never comes back or escalates.
- Low tier: FXAA after tone mapping softens stair-stepping on wall caps,
  window and cabinet edges (low has no MSAA).

Not done: dragging a villager onto a chair (only the chip seats them),
villagers talking among themselves, routing, voice, the journal button,
keeping talk history on screen, steering around furniture (walkers keep to
hand-placed corridors that clear it).

`node scripts/check-talk-npc.mjs` starts its own stub host and dev server
(ports 5296 and 5295, or `--host=` and `--dev=`) with a temporary
`VILLAGE_ROOT` and proves, headless: nothing changes without the flag; the
three walk their chores; hover shows the name tag; a click talks in one step
and focuses the line; the thinking beat shows and the reply streams onto the
card; replies are revealed in whole words with the still-talking cue, on a
card sized for the page (it fails if letters are revealed one by one); at most
two sentences per page; Escape returns to chores; Tab and Enter talk; two are
invited and seated; a table line is answered by both in turn with one speaker
and one lit tag at a time; a name asks only that villager; the other's words
arrive only as context and are never stored as your line; the host down is
said in character and the line kept; a typed farewell gets a goodbye from each
and sends nothing; Escape at the table releases everyone; the glyph shows,
fades after a second of looking and never returns; without `?slip=always` the
slip is hidden in the room, and with it the slip stays addressed to your
villager, re-addresses itself and sends there; unloading `talk` three times
leaves the same objects, geometries, textures, frame hooks, DOM and entries as
a `?cam=iso` page. 24 of 24 passed (stub host, November 6, 2026). `--agent=claude`
runs one real talk, one two-villager table exchange and a typed farewell
instead, and `--video=dir` records it.

Real model, November 6, 2026, M1 Pro, `--agent=claude` (Sonnet 5.5 with a
Haiku helper call), times measured in the host from the start of each turn:

| Turn | Villager | First text | Whole turn | Cost |
| --- | --- | --- | --- | --- |
| single talk, first turn of the session | Dumpling (alex) | 3.7 s | 4.2 s | $0.0048 |
| table, two seated | Dumpling (alex) | 4.5 s | 4.9 s | $0.0044 |
| table, two seated | Moss (mia) | 4.7 s | 5.3 s | $0.0053 |

Replies still run two or three sentences, usually ending in one question, so
pages sometimes turn by themselves.

Frame cost, headless Chrome, 1440x900, WebGPU, `npm run measure -- '<url>'
--perf --gpu`, one 6 s run each while the villagers walked, this branch against
its base commit measured the same evening (GPU p50 varies 1 to 3 ms between
runs of the same page):

| Page | Tier | Draw calls | Triangles | GPU p50 / p95 ms |
| --- | --- | --- | --- | --- |
| `?cam=iso`, base | high | 555 | 66,358 | 9.1 / 16.8 |
| `?talk=npc`, base | high | 722 | 107,372 | 9.5 / 11.1 |
| `?talk=npc`, this branch | high | 734 | 113,708 | 10.4 / 17.3 and 9.9 / 17.9 |
| `?cam=iso`, base | low | 485 | 63,127 | 3.5 / 4.6 |
| `?talk=npc`, base | low | 652 | 104,141 | 5.6 / 6.3 |
| `?talk=npc`, this branch | low | 665 | 110,478 | 4.3 / 5.9 and 4.6 / 6.0 |

The booster cushions and their buttons add 12 draw calls and 6,300
triangles. FXAA adds one full-screen pass on the low tier; with it on and off,
the GPU p50 stayed within run-to-run noise (4.6 against 5.0 ms on the talk
page, 4.4 against 3.8 ms on the iso page).

Look: a fresh Opus scorer per round saw only the `npc-*.jpg` screenshots and
nine categories (warmth, material honesty, lighting and depth, who is
speaking, consistency, character appeal, game not tool, friction, low mode).
Means: 5.7 for the merged screenshots, then 6.1, 6.3 and 6.6 after each round of fixes; stopped at the round cap. What holds it down now is mostly the scene and the characters,
not the talk: tube-like scarves, plastic-looking cabinets and fridge, the
pendant's hot spot on the table, small villagers in the room view, empty
floor, and a low mode that looks like a degraded high mode rather than its own
look. Screenshots: `screenshots/talk/npc-*.jpg` (real replies).
