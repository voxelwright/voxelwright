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
node scripts/check-build-plan.mjs http://localhost:5350/   # build mode (#48): pixels, plan model, drag and bend
npm run typecheck
npm run build
npm run perf-gate                    # before merging to main; see "Performance gate"
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

`npm run measure -- --perf --gpu` adds `?gpu=1` and reports, per frame, GPU ms,
the summed pass durations, submit-to-done ms and CPU ms (frame hooks plus draw).

GPU ms (#42) is GPU busy time from WebGPU timestamp queries (`src/gpu-time.js`):
every render and compute pass gets a begin and end timestamp, and a frame's GPU ms
is the union of its pass intervals. Summed pass durations are not frame cost on
this Mac: under Metal a pass's begin is written while earlier passes still run, so
a frame summed to 60 to 150 ms while holding 60 fps. Submit-to-done (the wait from
the last submit to `onSubmittedWorkDone()`, the measure before #42) counts the main
thread's delay in delivering the callback. Checked in headless Chrome, kitchen,
`?q=high`, 4 s per run:

| Ground truth | GPU ms p50 | Submit-to-done p50 / p95 | Frame |
| --- | --- | --- | --- |
| none | 7.7 to 9.1 | 8.9 to 10.5 / 10.6 to 16.5 | 60 fps |
| 12 ms CPU loop per frame | 7.8 to 8.0 | 16.7 / 17.8 to 31.5 | 60 fps |
| GPU-bound: extra full-screen passes, 4 / 6 / 8 | 18.3 / 24.6 / 31.1 | 107 / 145 / 183 | 18.3 / 24.8 / 31.3 ms |

When the GPU is the bottleneck, GPU ms matches the frame interval within 0.2 ms.
Below that, small loads add less than their isolated cost (one pass +2.2 ms, two
+2.6 ms), consistent with the GPU raising its clock under load. Results were the
same with and without `--enable-webgpu-developer-features`: busy times were not on
100 us steps either way, so the flag is no longer passed.

The tables below this point, up to the performance gate, were measured with
submit-to-done.

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
and steps down when high exceeds 13 ms or medium exceeds 12 ms (GPU busy ms since
#42; without timestamp queries it falls back to submit-to-done). With a 12 ms CPU
loop per frame the kitchen now stays high (8.8 and 10.1 ms). Stepping down
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

## Performance gate (#42, November 6, 2026)

`npm run perf-gate` builds the base (default: the merge base with `origin/main`) and the
working tree for production, serves both on 127.0.0.1:5430 and :5431, and measures them in
one headless Chrome at 1440x900, DPR 2. Options: `--base <ref>`, `--head <ref>`,
`--scenes home,talk`, `--full` (adds `home-low`), `--seconds 2`, `--json path`. It prints a
table (base, head, delta, limit, verdict), writes `perf-gate.json` and exits 1 on a failed
gate, 2 on an error.

How it measures. A probe added before the app's code seeds `Math.random`, wraps
`requestAnimationFrame` (CPU ms is each frame's callbacks; a paused page's callbacks are
held), and injects `src/gpu-time.js` so GPU ms is the frame's GPU busy time from
timestamp queries, the renderer's own measure, for base and head alike. Submit-to-done is
reported next to it for reference. `--port <n>` serves the base on n and the head on n + 1
(default 5430).
Each page has its own browser context. After `ready()` it renders until 20 frames in a row
arrive on time (pipelines keep compiling for a few seconds; pausing earlier stalled the next
page for 7 s), then pauses. Only one page renders at a time. Base and head alternate
(B, H, B, H), 2 s of steady frames per version per scene after a 0.3 s warm-up.
Builds are cached in `~/.cache/village/perf-gate`: a base by commit (`git archive`, `npm ci`,
`vite build`), the working tree by the hash of its `home/` tree, untracked files included.

Scenes: `home` (`?q=high`, kitchen seat view), `villagers` (`?talk=npc&q=high`, walking),
`talk` (the same page after clicking Alex's villager: the close-up), and with `--full`
`home-low` (`?q=low`). A scene that needs a plugin the base lacks (villagers, talk: main has
no villagers yet) runs on the head only, with the absolute gates; one the head lacks is
skipped and listed.

Gates:

| Gate | Rule |
| --- | --- |
| 60 fps (head, every scene) | under 1% of intervals over 20 ms; p99 at most 20 ms; no long task over 50 ms; at least 90% of 60 Hz frames measured |
| Headroom (head, high tier) | GPU p50 under the high tier's `maxGpuMs` (13 ms, the median threshold calibration uses, read from `renderer.ts`) and GPU p95 under 16 ms (inside one 60 Hz frame). GPU ms measures GPU work (`src/gpu-time.js`). Kitchen medians are 8 to 10 ms; p95 is 9.8 to 14.3 ms on main and 12.2 to 14.5 ms on this branch. |
| Relative (head against base) | growth at most the larger of 10% and a floor: GPU p50 3 ms, GPU p95 8 ms, CPU p50 0.5 ms, draw calls 10 |

Noise, base against base (`--base X --head X`), M1 Pro, with 3 to 8 other agents' headless
Chrome checks running on the same machine: GPU p50 moved by up to 2.4 ms and GPU p95 by up to
7.3 ms; CPU p50 0.1 ms; draw calls 0; frame intervals none. The GPU floors sit just above that
spread. Remeasure on a quiet machine and tighten them.

Time, base build cached, three runs (the first also built the head, 2.0 s): 25.0 to 26.6 s
inside the script, 27.6 to 29.7 s wall clock (page loads 11.8 to 13.4 s, measuring 11.2 s). An uncached head adds a
2 to 5 s build, which runs while the base pages load. The first base build adds 17 s
(`npm ci` and `vite build`). `--full` does not fit in 30 s.

Today (5f89124 plus the gate, against cb1d565, three runs): every scene holds 60 fps except
one `talk` run (3 of 116 intervals over 20 ms, p99 33 ms). GPU p95 at high is 16 to 19 ms in
`home`, `villagers` and `talk` on the old submit-to-done measure; that measure counted callback delay, and the headroom rule now uses GPU ms that measures GPU work (see the table above).
GPU p50 swings between 7 and 17 ms for the same build from run to run under contention.
`home` CPU p50 is 0.3 to 0.6 ms above main every run (draw calls 482 to 526, triangles
52k to 84k, from the furnishing), which is at the 0.5 ms limit. `home-low` draw calls are 412 to 457,
over the 10% limit.

Deliberate regressions, not committed: a 5 ms busy loop per frame in the renderer failed
`home` CPU p50 (+5.2 ms against +0.5) while frames still held 60 fps; a 12 ms loop failed
`villagers` with 17% of frames over 20 ms and p99 33.4 ms. Both exited 1.

With GPU busy ms (#42), against cb1d565 (main), four runs on a quiet machine, GPU p95 at
high: `home` main 10.2, 10.4, 9.8, 13.4 ms, head 13.7, 12.5, 13.6, 13.8 ms (p50 8.0 to 10.0
on main, 8.3 to 10.4 on the head); `villagers` 12.4 to 13.7 ms; `talk` 11.6 to 14.0 ms.
Submit-to-done p95 on the same frames was 11.4 to 17.8 ms. Five earlier runs, with 0 to 1
other headless Chrome instances, read main 13.6 to 14.3 and head 12.2 to 14.5 ms (the gate's
count of other instances was one too high until #42). Every run passed every gating rule.
The kitchen's typical cost, by the ms each pass adds to GPU ms (p50 / p95 per pass; the
p95s do not fall in the same frames; `?q=high`, 240 frames, 28 passes):
the first scene render context 2.7 / 4.5, the first post pass after `output` 2.1 / 3.3,
the full-resolution `output` pass 1.1 / 1.9, the next post pass 0.8 / 1.1, the first
full-resolution pass 0.6 / 1.0; the 13 bloom mips together under 0.2.

What it cannot see: displays above 60 Hz (headless Chrome caps at 60 Hz, so intervals show
missed frames, not spare time), phones and other GPUs, the WebGL2 fallback, dev-only features
(the prop sandbox, `village.kernel`), the villager host (no `/villager/*` routes, so no model
replies or table rounds), page load time (reported in the JSON, not gated) and audio.

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
  moved. Rugs sit 2.5 mm up and furniture decals 3.5 mm, so the villagers' 4 mm
  contact shadows stay on top.
- Props are built with `src/kit.ts`: each part's transform and colour are baked
  into vertices and parts merge by material, so the kitchen's furniture is
  about a dozen draws. Things hung on the side walls sit in their own groups
  tagged `inward`, so they hide with their wall when the camera stands outside it.
- Contact shadows: one merged decal mesh per room (a wide and a tight quad per
  footprint) under furniture, the same at `?q=low`. Furniture meshes are never
  frustum-culled: small pieces first drawn when a room walk turned the camera to
  them added a geometry on the second cycle of `check-entries`.
- Materials: floor roughness 0.86 and boards about 14 cm wide with staggered
  joints (`floorPlanks()`, shared by the seated and dollhouse floors); tabletop
  roughness 0.74 and the lamp's light pool at 55%, which removed the white
  hotspot; cabinets in grained eggshell paint over a darker carcass, so door
  gaps read; brushed steel fridge without the clear coat. The lamp arm is now
  cream and thinner, which round 3 read as a stray white line: still open.

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
into the kitchen; `&focus=1` frames them. Since the prop sandbox (below), code
modules run in the sandbox and both arms reach the home as the same checked
data; `&run=direct` imports a module into the page as this experiment did, for
comparison only. `main.ts` imports the loader only in
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

## Prop sandbox (#42, November 6, 2026)

Model-written prop code runs in a sealed box, and only data comes back.

- **Box.** `src/props/sandbox.ts` adds a hidden iframe with
  `sandbox="allow-scripts"` (no `allow-same-origin`, so its origin is opaque)
  and a `srcdoc` whose first element is the CSP
  `default-src 'none'; script-src 'nonce-<random>' blob:; worker-src blob:`.
  Its one inline script, the relay, starts a classic Worker from a blob. The
  worker is `src/props/box/worker.ts`, bundled into one script (three core
  r187 with `three/webgpu` aliased to `three`, the `paint.ts` painters on
  OffscreenCanvas, the spec presets, the serializer) by the dev-only
  `prop-box` plugin in `vite.config.ts` and handed over as text. The box has
  no network, so it cannot load anything itself.
- **Run.** Each module gets a fresh worker. It imports the module text from a
  blob and calls `build(api)` (the experiment's contract) or
  `default(prop, api)`. `api` holds `THREE`, `RoundedBoxGeometry`, `paint` and
  `prop`: `prop.add(object)`, `prop.material(preset, options)` (the spec arm's
  wood, fabric, painted, metal, ceramic and wallpaper presets) and
  `prop.note(text)`. Before the module runs, the worker allows only 2D
  canvases and deletes `Worker` and `SharedWorker`. The relay terminates the
  worker after the first message or at the wall-clock limit (5 s by default).
  The page has its own limit, 3 s longer, and closes the whole box if the
  relay stops answering.
- **Data.** `src/props/wire.ts` turns the tree into plain data. Each mesh is
  sent as positions, normals, uvs, an index and a matrix. Each material is
  sent as a preset name and fixed parameters. Each texture is sent as an
  ImageBitmap with its wrap, repeat and colour space. Only the `standard` preset
  exists; any other material arrives under its type name and is rejected. No
  shader code or functions are ever sent. The JSON spec arm is now another
  producer: the trusted interpreter builds the spec in the page, then it is
  serialized and goes through the same check and rebuild.
- **Messages.** The page transfers one MessageChannel port once at startup and
  never listens on `window`. The relay forwards only a result or an error for
  the current run. It refuses anything over 64 MB (counting each typed array's
  whole buffer and each bitmap's pixels), anything over 200,000 values, and
  any object that is not a plain object, array, typed array or ImageBitmap.
- **Home.** `src/props/rebuild.ts` treats the data as untrusted. It reads
  fields by name from own properties only, copies every typed array, and
  rejects the whole prop with a reason if any limit is broken: 300 meshes and
  geometries, 64 materials, 16 textures, 200,000 drawn triangles, 400,000
  vertices, 2048 px a side and 16 Mpx of textures, 64 MB, 4 m on any side once
  placed, finite numbers only, and indexes inside their arrays. Colours,
  roughness and the like are clamped. Only then does it build trusted
  geometry, `MeshStandardMaterial`s and canvas textures (each bitmap is drawn
  onto a page canvas, as `paint.ts` makes them). Nothing is half-placed.

The working combination, found by a probe in headless Chrome 158 (Playwright
1.65): a **classic** blob Worker created from the sandboxed `srcdoc` frame
inherits the frame's CSP. fetch, XHR, WebSocket, `importScripts`, outside
`import()`, `eval` and `new Function` are all blocked, and `import()` of a blob
still works. A control run with `connect-src` left open reached the outside
server, so the CSP is what blocks it. A module worker from a blob failed to
start in this frame. A `data:` worker also inherits the CSP; it is not used.

`node scripts/check-prop-sandbox.mjs` starts its own dev server on 5304
(through Vite's API, counting requests) on a temporary `VILLAGE_ROOT` with a
synthetic villager token, plus an "outside" server on a random port. It
proves, headless, 33 checks: a plain module builds; fetch, XHR, WebSocket,
`importScripts`, `import()`, EventSource and sendBeacon never reach the outside
server; the villager token is never requested; the worker has no `document`,
`window`, `parent`, `top`, storage, cookies, indexedDB or caches, and its origin
is `null`; the iframe itself (probed with Playwright as if the relay were
compromised) cannot reach the page, storage, cookies, network, top navigation
or popups; a result forged by the module, a message to the parent window, and
results forged on the box's own port (unknown preset, `__proto__` keys, a valid
prop with `__proto__` keys) are rejected or rebuilt from fresh objects with
`Object.prototype` untouched; pollution inside the worker stays there; no
WebGPU, WebGL or nested workers; an infinite loop is stopped at its limit with
the home's largest 10 ms tick gap at 15 ms; a typed-array flood fails with
"Array buffer allocation failed"; a plain-object flood is stopped at its limit;
5 million triangles and a 16384x16384 texture exceed 64 MB; 320,000
triangles, NaN, Infinity, a prop 1,000 km wide, a 16384x64 texture and a
ShaderMaterial are rejected by the home's checks; an empty module and a
syntax error are rejected; `eval` and `new Function` are blocked; a busy
iframe main thread does not stall the home; afterwards the box still works,
the page's DOM, storage and cookies are unchanged, nothing hostile was
placed, and no error reached the page. 33 of 33 passed (November 6, 2026).

Parity and overhead, `node scripts/props/sandbox-parity.mjs <out> [base]`
with the dev server on 5304, the five Sonnet free-code modules from the
experiment, `?cam=iso&q=high&focus=1`, 1280x800 PNG. Changed pixels are those
whose largest channel differs by more than 16 of 255. Direct against direct
is the noise floor of the animated scene. Timings are the p50 of 3 cold runs (a
fresh page each) and 7 warm runs (one page), in ms: box start / run in the
box (import, build, painting) / serialize / transfer / check and rebuild /
text to the second frame after placing.

| Prompt | Triangles | Changed px box vs direct | Direct vs direct | Direct build ms | Cold | Warm |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2,672 | 0.08% | 0.03% | 41, 40 | 34 / 46 / 1.6 / 2.1 / 2.2 / 110 | 0 / 41 / 1.3 / 3.1 / 0.5 / 79 |
| 2 | 13,032 | 0.06% | 0.05% | 42, 52 | 44 / 52 / 2.6 / 6.6 / 7.8 / 140 | 0 / 63 / 2.6 / 6.3 / 2.3 / 106 |
| 3 | 9,208 | 0.04% | 0.03% | 46, 48 | 37 / 56 / 2.6 / 5.1 / 5.1 / 128 | 0 / 45 / 2.2 / 2.5 / 1.4 / 80 |
| 4 | 1,188 | 0.12% | 0.01% | 38, 37 | 36 / 40 / 1.1 / 3.2 / 2.0 / 110 | 0 / 40 / 1.0 / 2.0 / 0.5 / 78 |
| 5 | 8,044 | 0.01% | 0.00% | 62, 64 | 36 / 71 / 3.0 / 5.0 / 4.9 / 147 | 0 / 67 / 2.8 / 3.1 / 1.3 / 108 |

All five render the same through the box: the mean absolute difference is
3.2 to 3.3 against a 3.2 floor, and a diff image of prompt 4 shows the
changed pixels on the sunlit sill, the lamp cord and the motes, not the prop.
The box adds about 40 to 70 ms to a model call that takes 6 to 44 s. The
worker bundle is 766 kB; a warm start is 0 because the relay starts the next
worker as soon as a run ends. The first version of the rebuild hit a three.js
r187 detail: a mesh with `matrixAutoUpdate = false` never refreshes `matrixWorld`
in `updateWorldMatrix`, so meshes now take position, rotation and scale (a
matrix with shear has it baked into its own copy of the geometry).

What the box relies on:

- Chrome's sandboxed iframes: an opaque origin with `allow-scripts` alone, a
  `<meta>` CSP in `srcdoc` enforced before the inline script, and blob
  workers inheriting their creator's CSP. Only Chrome 158 headless was
  tested; Safari and Firefox were not.
- Chrome runs the sandboxed frame in another process: a frame main thread
  kept busy for 1.5 s did not stall the home (largest gap 14 ms). Model code
  never runs on that thread anyway, only in the worker.
- `script-src blob:` lets code in the worker import further blobs it makes.
  That gives it no new reach: they run in the same worker under the same CSP.
- The worker's narrowing (2D only, no nested workers) is done in the worker's
  own realm before the module runs; the module cannot redefine `getContext`.
  It relies on there being no other way to get a fresh realm in a worker, and
  on the narrowing code touching no prototype or global the module can patch:
  the wrapper captures `getContext` and `Reflect.apply` up front and uses no
  `.call` or spread (Sentinel found a `Function.prototype.call` bypass, fixed).
- The relay counts strings and object keys toward the 64 MB budget, and type
  names are cut to 40 characters, so a huge string cannot stall the page.

Not isolated, or unproven:

- CPU and memory. The module shares the machine until its limit. A heap
  flood fast enough to reach V8's limit (`new Array(1 << 20).fill(0)` in a
  loop) kills the box frame's whole process in about 4.5 s. A one-off probe
  showed the home survives: the page's heartbeats to the dev server
  continued, the page's own limit closed the box at 15 + 3 s ("the sandbox
  stopped answering"), and the next prop built in a fresh box. Two gaps
  remain. The page waits for its limit instead of noticing the crash, and the
  probe is not in the check, because Playwright reports an out-of-process
  frame's crash as a page crash and stops driving the page.
- Timing. `performance.now` and timers are available, so side channels inside
  the frame's own process are not ruled out; with no network, nothing read
  can leave except through the prop's own shape and pixels.
- The prop itself is model output: the box limits its size and cost, not
  whether it is offensive or misleading. Notes are shown only as text.
- TypeScript is stripped by Vite's dev transform before the text reaches the
  box. Outside dev, a trusted strip step or plain-JS prompts are needed.
- Dev only. The box, its plugin and the trial hook load only with `?props=`
  in a dev build; the production build contains none of them (checked).
- If the frame navigated itself, the page would still post the init message
  with `'*'` (an opaque origin cannot be named). That message carries only
  the port and the public worker source, and anything coming back on the port
  is still checked.

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
  pause, wave, take on a soft outline in its owner's colour and show its name
  tag ("Alex's Dumpling") just over its own head, so it is easy to click.
- Talk in one step: click, or Tab and Enter. It stops, hops, turns to you, and
  the camera arcs (rate 7, about 0.4 s) into a close two-shot that turns until
  nothing stands in the way. While the talk is open the shot is locked: a
  walker about to step into it waits at the edge of frame, and one already at
  a chore in frame stays at it. In a talk or at the table, anyone not in the
  conversation who comes well in front of it, or is cut off by the frame's
  edge, fades out (hashed alpha, so no sorting or shader rebuild) and back once
  clear. The reply card wears the villager's name tag (felt ribbon in its
  colour) and sits beside its head in a talk and above it at the table, with
  its tail on the head; it keeps off other speakers' faces and the slip.
  Replies appear a whole word at a time (58 letters a second) and the card
  grows with them, with stitched dots after the last word while the villager
  is still talking. A page holds seven lines: only a reply that would overflow
  turns its page (by itself after a read, or with "go on"), and the page
  before stays above as one dimmed line that opens on a click. While the model
  works the villager looks up and taps its chin for at least half a second;
  there is no spinner.
- The slip: one stitched paper slip at the bottom right holds your last line,
  the writing line and two or three chips. Its tab says who the line goes to
  ("to Dumpling", "to the table") in that villager's ink, so it never reads as
  the villager speaking. Lines are written in the book face; handwriting is
  kept for short labels. A chip once said, or whose topic you already wrote
  about ("What's for dinner?" after a typed dinner question), is not offered
  again; after the first exchange the chips fold behind one quiet "…", and
  they hide while a villager answers. `?slip=always` keeps the slip on screen
  with no talk open, addressed to your own villager with "Write to
  Dumpling…": Dumpling wears a soft outline and turns to you while you write,
  and the line turns it to you and is sent there. Without the flag the slip
  shows only during a talk.
- The table: "Come sit with me" walks the villager (hurrying) to the nearest
  free chair, far side first; the talk prototype adds a fourth chair on the
  near side and a felt booster cushion on each chair, so a seated villager
  clears the table top. A line to the table starts a round (see "Table
  rounds" below): they speak one at a time with a lit name tag and a lean-in;
  cards that have finished fold to two dimmed lines and move aside for the
  speaker, and only the speaker's tag shows while someone speaks. A line that
  names a villager ("Tuft, ...") has that one speak first; clicking a seated
  villager fills in its name.
- Goodbyes: "Thanks, everyone", or a typed farewell ("thanks, bye", "see you
  later"; the whole line, at most 40 letters), makes each villager say a short
  goodbye in turn and go back to chores. In a one-to-one talk the villager says
  goodbye and goes back. The goodbyes are written per villager, not model
  turns, and nothing is sent to the host. Escape still leaves at once.
- Villagers do not share memory with each other. At the table each one gets
  your line, and the round so far (and the previous round) as a separate
  `context` field (`POST /people/:id/messages` with `{"text", "context"}`).
  The host passes context to the villager's turn, marked as not the person's
  words, and never stores it in `conversation.jsonl`, so the notebook never
  shows it as your writing.
- Voices: each word that appears on a card is emitted on the card's own
  reveal clock as `village/said` (`{ villager, word, index, last }`, with
  `last` on the reply's final word), and a reply cut short (Escape, the host
  failing mid-reply, a goodbye) as `village/said-stop`. The talk plugin makes
  no sound itself.
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
card; replies are revealed in whole words with the still-talking cue (it
fails if letters are revealed one by one); each word fires `village/said` in
order with `last` on the final one, and Escape mid-reply fires
`village/said-stop`; the card grows with the words, with no pre-sized card; a
short reply stays on one page and a long one turns only on overflow, keeping
the first page as a dimmed line; hover shows "Sam's Tuft" over Tuft's own head
and outlines it; Escape returns to chores; Tab and Enter talk; after the first
exchange the chips fold behind "…" and a typed dinner question drops "What's
for dinner?"; two are invited and seated; a table line is answered by both in
turn with one speaker and one lit tag at a time, and drops "What's everyone up
to?"; every card and tag stays inside the window with its tail over its own
villager; a walker brought between the camera and the table fades out and
back; a name asks only that villager; the other's words arrive only as context
and are never stored as your line; the host down is said in character and the
line kept; a typed farewell gets a goodbye from each and sends nothing; Escape
at the table releases everyone; the glyph shows, fades after a second of
looking and never returns; without `?slip=always` the slip is hidden in the
room, and with it the slip stays addressed to your villager, which wears the
outline and turns to you while you write, re-addresses itself and sends there;
unloading `talk` three times leaves the same objects, geometries, textures,
frame hooks, DOM and entries as a `?cam=iso` page. 32 of 32 passed (stub host,
November 6, 2026). `--agent=claude`
runs one real talk, one two-villager table exchange and a typed farewell
instead, and `--video=dir` records it.

Real model, November 6, 2026, M1 Pro (Sonnet 5.5 with a Haiku helper call),
times measured in the host from the start of each turn, last of three
recorded runs:

| Turn | Villager | First text | Whole turn | Cost |
| --- | --- | --- | --- | --- |
| single talk, first turn of the session | Dumpling (alex) | 4.0 s | 4.7 s | $0.0037 |
| table, two seated | Dumpling (alex) | 4.4 s | 5.3 s | $0.0043 |
| table, two seated | Moss (mia) | 4.5 s | 5.3 s | $0.0049 |

Replies run two to four sentences (230 to 280 letters); with seven-line
pages a three-sentence reply now stays on one page, and only longer ones
turn.

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
Means: 5.7 for the merged screenshots, then 6.1, 6.3 and 6.6 after each round of fixes; stopped at the round cap.
Round 3 (#42 talk polish, ten categories with motion polish added): 6.9, 7.0
and 7.0. What still holds it down: a fixed composer in the corner that reads
as a chat widget (and its typing dots and "…"), villagers that clip into
chairs or bunch at one spot after the table, a hovered walker that stays
turned away, the room's empty floor and bare walls, and the hot spot on the
table. Screenshots: `screenshots/talk/npc-*.jpg` (real replies).

Means: 5.7 for the merged screenshots, then 6.1, 6.3 and 6.6 after each round of fixes; stopped at the round cap. What holds it down now is mostly the scene and the characters,
not the talk: tube-like scarves, plastic-looking cabinets and fridge, the
pendant's hot spot on the table, small villagers in the room view, empty
floor, and a low mode that looks like a degraded high mode rather than its own
look. Screenshots: `screenshots/talk/npc-*.jpg` (real replies).

## Villager voices (#42)

With `?talk=npc`, each felt villager babbles as its words appear: a few soft
synthesized syllables per word, in the genre of game character voices but all
our own sound, made in code with Web Audio (nothing sampled). `?babble=off`
turns it off; without `?talk=npc` the plugin adds nothing.

- `src/voice/text.ts` turns a word into syllables (vowel groups with their
  consonant onsets) and prosody: a question rises at the end, `!` lifts and is
  louder, `…` trails off, a comma pauses, a full stop falls, CAPITALS are
  louder, and later words in a sentence sit slightly lower. Every random choice
  is seeded from the word's letters, so the same word in the same voice and the
  same place in a sentence always sounds the same.
- `src/voice/engine.ts` renders each syllable as a glottal-like tone (all
  harmonics, rolling off by 1/n^tilt) through three formant band-passes for its
  vowel, with breath noise and a short noise burst for the consonant, under a
  soft envelope. A master gain sets a quiet level; a stateless soft clip keeps
  peaks under -1 dBFS. One speaker at a time: a word from someone else fades
  the previous voice in 12 ms. A voice that falls more than 0.3 s behind its
  text skips words until it catches up.
- `src/voice/profiles.ts` holds the voices: Dumpling round, warm and mid-low,
  Moss breathy and slower, Tuft quick, bright and higher.
- `src/voice/context.ts` owns the one AudioContext the voices and the music share. The rule
  is no sound before a gesture, not no context: the page's first `new AudioContext()` blocks the
  main thread for 0.4 to 1.7 s (Chrome 158, M1 Pro) whenever it runs, so a context made in the
  first key press froze the page just as someone started writing. In Chrome the context is made
  at load on a silent sink (`sinkId: { type: 'none' }`, about 1 ms), suspended, and the real
  device is attached by the asynchronous `setSinkId('')`, so the 0.9 s of start-up happens off
  the main thread (no gap over 13 ms). Without `setSinkId` it is made when the page has loaded
  and the browser is idle, or on the first gesture. A gesture (`pointerdown`, `pointerup`,
  `keydown`) only calls `resume()`, and every later gesture resumes a context that is not
  running. A hidden tab suspends it. It closes when the last of the voices and the music has
  unloaded, and on `pagehide`. See `.agents/skills/web-audio-voice/SKILL.md`.
- `src/plugins/babble.ts` listens for `village/said` (`{ villager, word, index,
  last }`, sent by talk.ts as each word appears) and `village/said-stop`
  (`{ villager }`) and builds the voices on the shared context.
  `M` or the felt speaker button at the bottom left mutes all sound (the voices and the
  music); the choice is kept in `localStorage` (`village.babble.muted`). Hidden tabs,
  `pagehide` and unloading the plugin stop the voice.
- `?babble=demo` (dev only) plays a scripted exchange between the three at
  talk.ts's reveal pace, without talk.ts or a model.

```sh
node scripts/check-babble.mjs [base-url]             # 28 headless checks
node scripts/demo-babble.mjs [base-url] --out=dir    # demo MP4 + WAV and cost; needs ffmpeg
```

Measured November 6, 2026, headless Chrome 158 on an M1 Pro, 27 of 27
checks passed. On the same line, median fundamental and spectral centroid:
Dumpling 161 Hz and 690 Hz, Moss 222 Hz and 1,303 Hz, Tuft 322 Hz and
1,734 Hz (each pair at least 4.9 semitones and 33% apart). A question ends 20
to 25% higher than it starts. The 16 s demo exchange: -30.5 LUFS integrated,
peak -11.3 dBFS. A word to an idle voice is heard 3 to 6 ms later on the
audio clock (plus the device's output latency); a stop is silent (below -60
dBFS) within 11 to 17 ms. The same word renders identically within -138 dBFS in two
contexts and within -77 dBFS twice in one. Cost: 67 ms of offline rendering
per second of babble (about 7% of one core), 0.19 ms of main thread per word,
and no frame-time change (rAF median 16.7 ms and p95 16.7 ms with the voices
playing, 16.8 ms with `?babble=off`).

Not done: talk.ts does not send `village/said` yet (another branch adds it);
the voices have only been measured, not listened to by a person.

## Music (#42)

Music: with `?talk=npc` a quiet looped bed plays under the villagers, "Groove Music" by
benpm (CC BY 4.0, https://freesound.org/s/203099/), the only sampled sound in the home. `?music=off` turns it
off; without `?talk=npc` the plugin adds nothing. The credit shows when you hover or Tab to the
note beside the speaker button, and is in `CREDITS.md` and `public/audio/CREDITS.md`.

- `public/audio/groove-music.ogg` is the original re-encoded to Ogg Opus at 112 kb/s (341 KB). It
  is exactly eight bars at 90 BPM (1,024,000 samples at 48 kHz), so it loops as it is, with no trim
  or crossfade: `loopStart` 0, `loopEnd` the buffer's duration. The step at the loop point is
  -65 dBFS, about twice the median step of the music itself.
- `src/voice/bed.ts` plays it through Web Audio on any context (source, level, duck, mute), at
  a gain of 0.26: -32 LUFS integrated (the file alone is -20.3), peak -15.8 dBFS. It fades in over
  2 s, and drops 6 dB (80 ms down) while a villager speaks. `src/plugins/music.ts` shares the
  voices' AudioContext (`src/voice/context.ts`: made at load, suspended, silent until a gesture
  resumes it), fetches the loop on the first touch or key press, and listens for `village/said`
  and `village/said-stop`: the duck is released 0.6 s after the last word (250 ms time constant
  back). A hidden tab suspends the context; unloading the music stops and disconnects the bed, and
  the context closes once the voices have unloaded too.
- Switches: `M` and the speaker button (babble.ts) mute everything and tell the music with
  `village/muted`; Shift+M or the note mutes the music alone (`village.music.muted`). Both survive a
  reload. With `?babble=off` there are no voices, so nothing ducks and the music takes `M` itself.

```sh
node scripts/check-music.mjs [base-url]   # 30 headless checks, dev server on 5322 by default
```

The first key press does not freeze the page (checked in `check-music`, in a browser of its
own because only the browser's first audio start-up is slow). Before: the old create-on-gesture
code showed a single 3.1 s long task in the key press, in a cold browser with the whole scene.
Now: no long task and a largest timer gap of 20 to 26 ms (two runs) from the key press until the loop has played
for a second; at load the context costs 0.5 to 1.3 ms of main thread, with the device opening
off the main thread over 0.6 to 5.9 s (the dev scene's own load is slow). Not heard: the output
after `setSinkId('')` was verified for state and a running clock, not by ear on a device.

## Always-on input (#42 prototype)

`?talk=npc` now has the held notepad by default (`?input=speech` for the
speech card, `?input=slip` for the old slip): an input that is always there. A keypress anywhere starts writing (a lowercase
`j` with nothing written opens the journal instead; a capital J still starts a
line). Lines go to your own villager (Dumpling) unless you have turned to
someone: clicking a villager or sitting at the table re-addresses it, and in
the room a line that names another villager ("chat with Moss") is addressed
to them as you type.

- **held**: your own notepad, held at the bottom of the view by a knitted
  mitten. It is a 3D object riding with the camera (`src/talk/input.ts`), lit
  by the room. Your words are written on it in your ink with the addressee in
  their colour; Enter tears the note off and it flies to its recipient.
- **speech**: nothing on screen until you type, apart from a pencilled hint
  before the first line. Your words rise from the bottom centre as your own
  card (a blue "You" tab, a "to Dumpling" tag), and Enter sends it flying
  toward the recipient.
- Both have a tiny felt journal with a stitched J at the bottom left: one click,
  or `j`, opens the journal (the `talkbook`, now with a ribbon for each of
  Dumpling, Tuft and Moss) at the last villager you talked with.

Routing: a line to your own villager goes to `POST /people/:id/route` on the
host, a tool-less model call (Sonnet by default, `--router-model haiku`) whose
JSON answer the host checks field by field (`checkRouted` in
`host/src/villager-input.ts`). Lines to someone else, typed farewells and
"come sit with me" skip it. While it runs, your villager taps its chin.

| Route | What happens in the room |
| --- | --- |
| talk | that villager turns to you and the camera eases to it; any message for it is sent |
| answer | your villager turns to you and answers through its own session |
| furnish | a translucent ghost of the right size at once, then the made prop in its place, with Keep, Undo and Try another on a paper tag |
| project | your villager says so in one line; a kraft-paper parcel with a stitched "being made" tag stands where it will go; the host records it in `projects.jsonl`, and parcels come back after a reload |
| journal | the journal opens at that villager or section |

Furnishing (`src/talk/furnish.ts`): trusted code resolves the place from the
words (around the table, by the window, in the corner, on the counter, the
living room's door, or "here", the last thing clicked, only when the person said
here). A line that starts like furnishing ("add", "put", "replace") shows the
ghost before the route comes back; a different route dissolves it. The prop is
made by `POST /people/:id/props` (Sonnet writing a plain-JS `build(api)`
module), run in the prop sandbox, checked and rebuilt, then swapped in for the
ghost. "Replace the table" hides the table and Undo shows it again. "Another
one like that" clones what was pointed at or placed last, with no model call.
Keep marks the module kept in the person's library
(`people/<id>/library/<item>.json`, module text plus metadata), and the router
is told the library's names, so "put the green armchair by the window" places
a saved one again through the sandbox. A failed or rejected prop leaves
nothing placed, and your villager says so. The host stores and returns module
text only; it never imports or runs it. The sandbox is dev only, so in a
production build furnishing fails honestly.

New host endpoints, all behind the per-launch token and under one listed
person: `POST /people/:id/route` `{text, primary, villagers}`,
`POST /people/:id/props` `{what, size?, variant?}`, `GET /people/:id/library`,
`GET /people/:id/library/:item`, `POST /people/:id/library/:item/keep`,
`GET` and `POST /people/:id/projects`. Model failures answer 422, so the page
can tell them from the host being away.

`node scripts/check-talk-input.mjs` (stub host: keyword router, box maker)
proves, headless, 39 checks: no input without the flag; the pad rides with
the camera; a keypress anywhere writes; your villager turns to you; Escape
clears; `j` and the felt journal open the journal and the input steps aside;
each route's effect in the room (talk with Moss, an answer from Dumpling, the
ghost within 400 ms then the prop through the sandbox, replace and undo, two
around the table, Keep into the host library, a library placement, a copy with
no generation, a parcel and its host record, the journal); a failed and a
rejected prop leave nothing; a failing and a nonsense router keep the line;
the parcel after a reload; three clean unloads with the table restored; the
speech card, its live re-addressing and its flight. 39 of 39 passed (stub
host, November 6, 2026). `--agent=claude --variant=held|speech
[--shots=dir] [--video=file]` runs the real session, and `--agent=claude
--furnish` times five furnishing requests.

Routing, 15 written lines, `node test/route-bench.ts haiku sonnet` in `host/`
(operator login, M1 Pro, one call at a time; wall time includes the CLI
start):

| Model | Correct | p50 | p90 | max | Output tokens p50 | Cost for 15 |
| --- | --- | --- | --- | --- | --- | --- |
| Haiku | 15 of 15 | 2.2 s | 5.5 s | 6.1 s | 53 | $0.008 |
| Sonnet | 15 of 15 | 2.0 s | 2.3 s | 5.2 s | 57 | $0.127 |

Sonnet is the default for its steadier tail; Haiku is 15 times cheaper and as
accurate on these lines. In the page, through the dev proxy, the furnishing run's routes took 2.9
to 5.5 s; one took 12.9 s while other checks were running.

Furnishing, real models (Sonnet router and maker), one request at a time,
measured in the page from Enter:

| Request | Enter to ghost | Enter to prop | Maker | Sandbox and rebuild | Cost (route + maker) |
| --- | --- | --- | --- | --- | --- |
| add a round oak table for four | 3 ms | 14.7 s | 10.4 s | 231 ms | $0.022 |
| add a couple of chairs around the table | 2 ms | 15.8 s | 10.1 s | 88 ms | $0.030 |
| replace the table with a round oak one | 2 ms | 12.4 s | 8.7 s | 85 ms | $0.021 |
| put a tall reading lamp by the window | 2 ms | 15.9 s | 11.9 s | 50 ms | $0.032 |
| a green velvet armchair in the corner | 2.9 s | 13.1 s | 10.2 s | 82 ms | $0.030 |

The last line has no verb, so its ghost waited for the route. The first real
run made a black table: the model passed the painters 0 to 1 colours. The
maker's prompt now states the 0 to 255 range and carries the house chair
example, and the next five were coloured.

Look: a fresh Opus scorer per variant per round saw only the nine real-model
screenshots and ten categories (the ui-craft rubric plus game not tool,
friction, input part of the world, and each request visibly changing the
world). Means over the ten: held 6.6 then 6.7, speech 6.3 then 6.8 (overall
6, then 7 for both). Round 2 followed live re-addressing, a slower note
flight, a labelled ghost, paper keep and undo and the journal at the last talk.
Two small fixes came after round 2 and are unscored (the pad keeps "to Moss"
while the line is routed; the ghost tag names its maker). Still named: the
pad and the journal cut by the bottom edge read as on the screen rather than
in the room, a sent line leaves no lasting trace, long replies are cut to a
dimmed line, the parcel is small and far away by the door, the talk camera can
frame a post in the foreground, and a red sheet floating by the door (in the
scene before this branch). Claude only; no GPT reviewer this slice.

Stubbed or missing: "messages from the school" has no data source (the
villager says it cannot see any); projects are a record and a parcel, nobody
builds them yet, and there is no static stand-in; the living room is not
furnished from the kitchen (a request for it lands in the kitchen and the
villager says so); placed props are not kept across a reload (the library is);
no voice toggle and no context from where you are. Screenshots:
`screenshots/talk/input-*.jpg` (real models).

## Table rounds, faster replies and the compact notepad (#42, November 7, 2026)

Table rounds (`table()` in `src/plugins/talk.ts`): a line to the table starts
a round. The villager it names first speaks first; otherwise the opener
rotates round the table. Each speaker gets your line and every reply so far
in the round (and the last round) in `context`, never stored as anyone's
line. A villager may turn to another by name, who then speaks next, even if
it already spoke; one with nothing to add answers with a short action in
parentheses, such as "(nods)", shown as a nod and an italic beat with no
voice. A round stops after four turns (`MAX_ROUND`) and waits for you. The
next speaker is asked the moment the previous reply is complete, while its
card is still being revealed. The host prompt tells a villager at the table
to build on the last line, and to add one line to a game going round the
table (a joke, a story) rather than restart it.

Real joke round, Haiku, three seated, "Let's make a joke together. Each one
continue from the other one:":

> Moss: Why did the mug keep telling jokes at breakfast? It figured a little steam always helps a good punchline rise.
> Tuft: Then the toaster heard it and popped up, saying it could never let a joke like that go to waste.
> Dumpling: The butter dish slid across the table, looked at the toast, and said it would spread the good news to everyone who had just burned their fingers.

In that run the next speaker was asked 0 ms after the reply before it was
complete. Its first words still came 1.8 to 2.0 s after the previous card
finished, because first text in the page took 2.5 to 3.4 s while headless
WebGPU was rendering.

One call per line: a line to your own villager goes to `POST
/people/:id/messages` with `route`. The villager either answers (words
stream) or replies `ROUTE {json}`, which the host checks and sends as a
`route` event (see `host/README.md`). Plain chat costs one model call;
`?route=separate` keeps the router-then-answer path (two calls). A talk route
moves the line to another villager only when your own words name that
villager, and it sends your exact words, never the model's paraphrase.

Compact notepad (`src/talk/input.ts`): at rest the pad is about 0.42 of its
writing size, tucked mostly below the bottom edge, showing only "to
Dumpling". The first keypress, or a click on it, raises it to writing size
(eased); it settles after sending or Escape. It is a button for clicks and
taps. The villagers' cards keep clear of its screen box. On a touch screen a
tap on it shows the field as a real line just above the keyboard (at least
48 px tall, `enterkeyhint="send"`, placed from `visualViewport`) and focuses
it inside the tap, so the phone keyboard comes up.

Keys: `talk.ts` has the one keyboard listener (`onKey`). In order: the
input's `key()` (any key while a line has the keyboard; `j` opens the
journal; a printable key starts a line; Escape clears a restored line);
then the slot for room navigation, for arrows and WASD only while nothing is
being written (`input.writing`); then Escape at the table leaves it.

Checks, stub host: `check-talk-npc` 39 of 39 (new: named first speaks first,
a pass is a nod with no voice, the second speaker hears your line and the
first reply, the context sent is what the villager heard, hand-offs by name
stop at four turns, the next speaker is asked under 150 ms after the reply
before it and before its card ends, `village/said` words in order and never
interleaved). `check-talk-input` 49 of 49 (new: held is the default; at rest
under 4% of the screen at the bottom edge; rises to over three times that
on a keypress, settles on Escape; a click raises it; an answer is one call
with no router entry; a model's talk route to an unnamed villager is not
followed on either path; `?route=separate` makes two calls; on a phone in
touch emulation a tap focuses a visible 44 px line with a send key, and the
line typed is sent). Also passing: `check-talk-notebook` 15, `check-villager`
13, `check-kernel` 10, `check-entries` 27, `check-babble` 27. The check
scripts take `--host=` and `--dev=` (5319 and 5318 in these runs).

Look: a fresh Opus scorer per round saw only the real-model screenshots
(the notepad at rest, rising, writing and sent, the Moss talk, the table mid-round
and after, `?q=low`) and nine categories (the ui-craft rubric plus "the input
feels part of the world" and "the table reads as a conversation"). Round 1: mean 5.7
(input 5, table 5). The fixes after it: the flying note glows warm paper instead
of blooming white, finished turns at the table keep three lines, a pass is
italic, and seated villagers turn their heads to whoever speaks. Round 2: mean 5.8
(input 6, table 6). Stopped on the time box. Still named: the sent note
neither folds nor reads as paper, bubble sizes vary, the notepad is a flat card
facing the camera, "to Dumpling" is faint at rest, and the tan void and the
round sound button look like an app. Claude only; no GPT reviewer.

Not done: the round has a pause of about 2 s between speakers while first
text is slow; thinking still appears on some Haiku turns despite
`thinking: disabled`; the phone layout (field of view, tap areas, card
placement) is a later unit; the speech variant has no touch path.

## Build mode (#48 experiment, November 6, 2026)

`?build=1` builds the kitchen's walls, floor and dollhouse shell from a floor
plan instead of `room.ts` and `diorama.ts`. With `?cam=iso` you can drag the
right wall to move it (snaps to 10 cm) or pull the glowing dot at its middle to
bend it into a bay (snaps to 5 cm of bulge). The size and floor area show on a
handwritten paper tag while you drag. Escape cancels a drag. Without the flag,
`plugins/build.ts` does nothing.

The plan (`src/build/plan.ts`, pure, no three.js) is a JSON document,
`version: 1`, with stable string ids:

- `corners` {id, x, z}: where wall centrelines meet. A position is stored only here.
- `walls` {id, a, b, thickness, height, sagitta, openings}. `sagitta` is how
  far the wall's middle bulges off the chord (0 means straight, and it is capped at
  a half circle). Openings {id, kind door|window, from, to, sill, head, leaves?}
  are measured in metres along the wall (arc length when curved).
- `rooms` {id, label, loop}: a loop of corner ids. Walls are first-class, so
  one wall can bound two rooms.
- `furniture` {id, kind, x, z, yaw, roomId}: empty for now.

An edit is a small JSON object, applied by `apply(plan, edit)` and returning a
new plan: `moveWall`, `bendWall`, `moveOpening` and `addRoom`. `addRoom`
attaches a rectangle along a straight wall. It splits that wall so the shared
stretch is one wall in both loops, re-measures the openings on it, and can put a
door (`leaves: 2` for double doors) on the shared wall. It refuses to split a
curved wall. `validate(plan)` returns its reasons for rejecting a plan:
dangling ids, duplicate ids, walls under 0.5 m, bulges beyond a half circle,
openings that don't fit or that overlap, rooms that cross themselves or wind the
wrong way. Drags record their edits, and replaying them from `KITCHEN` gives
the same plan.

`src/build/walls.ts` builds one box per wall piece along a world axis and bends
it onto the arc only when the wall is curved. A straight wall therefore matches
today's geometry exactly. Its UVs and corner joinery copy today's, wall by wall.
The shell is a copy of `shell()` that handles arcs. A rebuild moves its new
geometry into the meshes the camera already tracks and reuses one set of
materials and textures. The plugin sets today's meshes aside while it runs and
puts them back when it unloads.

```sh
npx vite --port 5350 --strictPort &
node scripts/check-build-plan.mjs http://localhost:5350/
```

Headless Chrome, WebGPU, 1440x900 at DPR 1, `q=low&fx=`, all 28 checks pass.
Captures run with a fixed `Date`, a seeded `Math.random`, and frames stepped
by the script with synthetic rAF and `performance.now()` time. Two runs of
today's code are then identical.

| Capture | Noise floor (today vs today) | Generated vs today |
| --- | --- | --- |
| `?cam=iso` | 0.000 | 0.001 mean, 3,762 px (0.29%), max 43/765 |
| seated | 0.000 | 0.000 (identical) |

The iso residual is scattered single pixels on the dollhouse floor only. The
floor is now a triangulated polygon with UVs computed from world positions, so
texel rounding moves slightly. Walls, shell and the seated view are
bit-identical.

Dragging the right wall 1 m out moves the plan corners and the wall by 1.00 m.
The floor goes from 40.26 to 46.26 m². 1 m in gives 34.26 m². Back at the start
after 100 moves, geometries and textures are flat (329 / 78). Bending the wall
out by 1 m adds 4.16 m² of floor, against a 4.21 m² circular segment on the
centreline. A rebuild takes 1 ms median and 3 ms max. Unloading `build` gives a
scene object list equal to a page without it (563 objects). There are no
console errors; the 503 from `/villager/launch` is the same without the flag. In the model, adding a
4 x 3 m pantry on the left wall with a double door validates. The shared wall
is 4 m long, appears once and is in both loops, and the pantry measures
12.00 m².

Without the flag nothing changes. `check-kernel` passes 10/10. `check-entries`
passes 25/27; its two failures (one extra geometry on the second room cycle)
happen in the same way with `plugins/build.ts` removed.

Still open or broken: furniture doesn't follow a moved wall (the stove and
things hung on the right wall stay put, and the villagers' corridors are
unchanged). The garden plot, passage and lamp arm from `diorama.ts` don't
follow the plan. Dragging works only in iso, because the seated room has never
had a right wall, and the seated floor stays a fixed 9 m. The base stays a
rectangle around a bay. Corners use today's butt joints, not mitres. The plan
isn't saved, and there is no undo UI. Screenshots are in `screenshots/build/`:
`iso-` and `seat-` `baseline`, `generated` and `diff`, plus `drag-out`,
`drag-in`, `bend-drag` and `bend` (jpg). The clip is `drag.mp4`.
