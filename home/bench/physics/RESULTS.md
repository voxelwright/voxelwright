# Physics bench results

`npm run bench` on Apple M1 Pro, Node v25.1.0, 2026-11-08. Node only, single thread; no browser numbers yet.

## Pinball tunnelling (1000 random shots at 10 m/s, 27 mm ball, 5 mm walls, 45 frames each)

| engine | ccd | substeps | tunnelled | ms per 60 Hz frame |
|---|---|---|---|---|
| rapier 0.21.0 | off | 1 | 0 | 0.0192 |
| rapier 0.21.0 | off | 2 | 0 | 0.0291 |
| rapier 0.21.0 | off | 4 | 0 | 0.0501 |
| rapier 0.21.0 | off | 8 | 0 | 0.0896 |
| rapier 0.21.0 | off | 16 | 0 | 0.1672 |
| rapier 0.21.0 | on | 1 | 0 | 0.0141 |
| jolt 1.1.1 | off | 1 | 896 | 0.0080 |
| jolt 1.1.1 | off | 2 | 500 | 0.0102 |
| jolt 1.1.1 | off | 4 | 43 | 0.0192 |
| jolt 1.1.1 | off | 8 | 0 | 0.0381 |
| jolt 1.1.1 | off | 16 | 0 | 0.0733 |
| jolt 1.1.1 | on | 1 | 0 | 0.0065 |
| xpbd (TS) | off | 4 | 701 | 0.0145 |
| xpbd (TS) | off | 8 | 126 | 0.0240 |
| xpbd (TS) | off | 12 | 1 | 0.0337 |
| xpbd (TS) | off | 16 | 1 | 0.0442 |
| xpbd (TS) | off | 24 | 0 | 0.0667 |

## Pinball at the best setting per engine

| engine | setting | tunnelled at 25 m/s | bounce out/in at 10 m/s (expect 0.50) | at 25 m/s | bumper contacts seen | ball speed after bumper kick (m/s) | impulse at bumper (N·s) | flipper launch speed median / min (m/s) | flipper tunnelled | deterministic rerun |
|---|---|---|---|---|---|---|---|---|---|---|
| rapier 0.21.0 | ccd, 1 substep | 0/500 | 0.493 | 0.397 | 200/200 | 4.21 ± 0.09 | 0.361 | 0.73 / 0.44 | 0/200 | identical |
| jolt 1.1.1 | ccd, 1 substep | 0/500 | 0.493 | 0.497 | 200/200 | 4.22 ± 0.08 | 0.339 | 1.40 / 0.56 | 0/200 | identical |
| xpbd (TS) | 16 substeps | 154/500 | 0.500 | 0.500 | 200/200 | 4.38 ± 0.07 | 0.364 | 1.24 / 0.83 | 0/200 | identical |

## Scale: 180 dynamic boxes + 20 kinematic capsule villagers, 60 Hz, node, single thread

| engine | setting | step median ms | step p95 ms | boxes lost | new contacts reported | 50 sphere overlap queries, ms |
|---|---|---|---|---|---|---|
| rapier 0.21.0 | 1 step, events on | 0.247 | 0.314 | 0 | 485 | 0.113 |
| jolt 1.1.1 | 1 step, JS contact listener | 0.246 | 0.383 | 0 | 782 | 0.075 |
| jolt 1.1.1 | 1 step, no listener | 0.175 | 0.274 | 0 | 0 | 0.072 |
| rapier 0.21.0 | 4 steps | 0.761 | 0.917 | 0 | 932 | 0.114 |
| jolt 1.1.1 | 4 collision steps, listener | 0.978 | 1.299 | 0 | 752 | 0.071 |
| xpbd (TS) | 8 substeps | 1.574 | 2.264 | 0 | 1242 | 0.278 |
| xpbd (TS) | 4 substeps | 0.979 | 1.282 | 0 | 1127 | 0.273 |

## Heightfield 128x128 (32 m), 40 resting 0.5 m boxes, 9 on the edited area

| engine | asleep before | placed right | 16x16 raise ms | awake after raise | right after raise | 48x48 crater ms | awake after crater | right after crater | others still right |
|---|---|---|---|---|---|---|---|---|---|
| rapier 0.21.0 (collider rebuilt) | 26/40 | 40/40 | 0.517 | 2/9 | 9/9 | 0.410 | 1/9 | 9/9 | 31/31 |
| jolt 1.1.1 (SetHeights + wake box) | 40/40 | 40/40 | 0.736 | 9/9 | 9/9 | 0.144 | 9/9 | 9/9 | 31/31 |
| jolt 1.1.1 (SetHeights, no wake) | 40/40 | 40/40 | 0.052 | 0/9 | 0/9 | 0.081 | 0/9 | 0/9 | 31/31 |
| xpbd (TS) | 40/40 | 40/40 | 0.133 | 9/9 | 9/9 | 0.134 | 9/9 | 9/9 | 31/31 |

## Size and load (node, median of 5 cold processes)

| engine | raw wasm | wasm gzip | shipped JS module (wasm inlined as base64) | cold load ms |
|---|---|---|---|---|
| rapier | 3010 KB | 1149 KB | 4239 KB | 61.5 |
| jolt | 1977 KB | 735 KB | 3156 KB | 65.6 |
| xpbd | - | - | 22 KB | 9.9 |

## Physics at the core (Nov 8)

Branch `feature/village-physics-core`, physics on by default. Headless Chrome (Metal), 1440x900 at DPR 2.

**Checks (stub provider unless noted).** `node scripts/check-physics.mjs` 37/37; `check-build-addroom` 77/77; `check-villager` 17/17; `check-talk-npc` 39/39; dev server `check-kernel` 14/14, `check-entries` 50/50, `check-navigation` 22/22, `check-build-plan` 39/39, `check-themes` 74/74. Host: `test/villager.ts` 298/298, `test/plans.ts` 71/71, `test/promote.ts` 25/25 on a quiet rerun (23/25 once under load), `test/regressions.ts` 22/24 then 23/24 (`fake-window-village` flaked once). Two checks needed edits for this branch: the add-room wall click now lets pointers through the writing pad and avoids the pinball table that stands against the living room's right wall, and the villager check no longer expects a bare address after the dev URL's `?talk=off&build=0`.

**Perf gate** (`npm run perf-gate`, base a3a2fac, one idle foreign headless Chrome present, so the GPU warning fired on all three runs). Dropped frames over 20 ms 0% and long tasks over 50 ms 0 in every scene on every run; frame p99 16.8 ms. Head GPU p50/p95 ms, three runs: home 9.2/12.8, 10.1/12.3, 9.8/13.9; villagers 7.8/9.5, 9.7/13.2, 7.9/9.0; talk 9.7/13.0, 12.0/13.8, 9.5/11.3. Runs 1 and 3 passed. Run 2 failed one relative gate: villagers CPU p50 5.6 to 6.2 ms (limit +0.56). Physics costs about 0.3 to 0.6 ms of CPU per frame in the villagers scene, at the edge of the noise limit.

**First frame** (production build, `vite preview`, 3 runs each). On `?talk=off&build=0&q=high`: first frame 108 to 125 ms with physics, 106 to 117 ms with `?physics=0`; the earlier before-change baseline was 107 to 128 ms. The extra long task is still there: 161 to 162 ms at about 2.1 s with physics, none with `?physics=0` (the 196 to 199 ms task at about 1.8 s is in both). On the default page (talk and build on): first frame 103 to 123 ms with physics, 105 to 114 ms without; longest frame gap about 4.4 to 4.5 s in both (talk and build startup, not physics).

**Real model** (`check-physics.mjs --agent=claude`, host Agent SDK to the official Claude Code binary). 32/32. Talk-to-tune "make it feel like the moon": claude-haiku-5-5, 5.6 s, $0.0015, gravity set to [0,-1.62,0] and drag to 0. Notepad on the real router: "make everything bouncy" routed to physics by the router (claude-haiku-5-5 and claude-sonnet-5-5, 2.1 s), ruler raised bounce from 1 to 1.4; "make gravity like the moon" was routed to physics and lowered gravity (asserted by the check).

**Fixes after the first gate (Nov 8, later).** Same machine and settings; one idle foreign headless Chrome present throughout, so the gate's GPU warning fired on every run.

- *The 160 ms long task.* A CPU profile of the load (CDP, unminified production build) put about 75% of it in `paintWood`, called from `World.addToy` for each toy's wood (one 256 px texture per material and paint, all in the task that built the toys); the rest was the three toys' geometry and the first read of the home (`homeMs` 8 to 10 ms). The wasm is not in it: Jolt's loader already uses `WebAssembly.instantiateStreaming`, and `loadJolt` is a 10 ms task of its own. Now each wood is drawn in its middle tone on its canvas and its grain is painted into that canvas one texture per task (about 10 to 20 ms each, profiled), and starting yields after each toy. Long tasks on `?talk=off&build=0&q=high`, production build, 3 runs each: before, 168 ms at 2.3 s, 169 ms at 2.15 s, 163 ms at 2.15 s; after, none from physics (the startup tasks of about 1.75 s at 0.1 s and 200 ms at 1.85 s, which `?physics=0` has too, remain).
- *Reading the home.* The scene is read in the next task after a plan change or a thing added to or removed from the scene, once per burst, plus every 3 s for parts changed in place, instead of every 500 ms; the box comparison no longer allocates. Villagers scene, 8 s after ready, 3 runs: 16 reads (median 1.4 ms, max 7.1 to 7.5 ms, the first read) before; 3 reads (median 1.1 to 1.4 ms, max 7.3 to 9.1 ms, the first read) after; 200 reads in a row 0.3 ms median. These reads run in timers, not in frames, so they were not what the gate's CPU p50 (rAF callbacks only) measured.
- *Gate* (`npm run perf-gate`, base a3a2fac, 3 runs). Every scene, every run: 0 frames over 20 ms, p99 16.7 to 16.8 ms, 0 long tasks. Head GPU p50/p95 ms: home 7.99/9.68, 10.47/14.74, 9.25/11.3; villagers 9.59/13.43, 8.6/12.32, 9.29/13.55; talk 8.18/9.94, 8.16/12.87, 9.3/10.9. Villagers CPU p50 against base: 5.6 to 6.2 (+0.6, limit +0.56, FAIL), 5.8 to 6.0 (+0.2, pass), 6.2 to 6.8 (+0.6, limit +0.62, pass); home +0.4, +0.1, +0.2 and talk +0.4, +0.1, +0.1 (limit +0.5) passed. Run 1 failed, runs 2 and 3 passed. The villagers delta is frame-side: the physics step and follow (frame median 0.2 to 0.3 ms) and 66 more draw calls (1014 to 1080; the table and the light things).
- *Physics unloaded during a talk-to-tune call.* The ask now ends `{ ok: false, why: 'gone' }` (the world has a `disposed` flag and `setRules` refuses on it), and talk catches a rejected answer, so the notepad says "Things can't move any differently just now." `check-physics.mjs` 38/38 with a new check that unloads physics mid-ask; `check-build-addroom` 77/77, `check-build-plan` 39/39.

**Drawing the toys' scenery together (Nov 8, later).** Measured first in the villagers scene (`?talk=npc&q=high`, production build, headless, one idle foreign headless Chrome). The toys drew 33 meshes, 66 draws (main pass and shadow pass): 1014 draws with `?physics=0`, 1080 with physics, 1048 with the toys' shadows off, 1015 with the toys hidden. `world.frame` median 0.2 to 0.3 ms, nearly all of it the solver step (step median 0.2 ms); following the 33 home bodies and syncing meshes (`advance(0)`, 1000 calls) 0.01 ms. Hiding the toys took rAF CPU p50 from 5.8 to 5.6 ms, so the draws were about as costly as the step. Now a toy's scenery, every static visible part that no gadget names and that is not the toy's handle, is merged into one mesh per look (material and paint): the table's walnut cabinet, backbox and rails, its maple lane and guides, its two pegs, and the stand's four legs. The playfield (the entry handle), the scoreboard (its display) and the bumpers (sensors and kicks) keep their own meshes, as do all moving parts. Same materials, same shadows; the merged parts no longer pulse when hit, while the bumpers, which take the hits that matter, still do. Table and stand meshes 26 to 13, toys 33 to 20, draws 1080 to 1054. `check-physics.mjs` 38/38 (stub); typecheck clean.

*Gate* (`npm run perf-gate`, base a3a2fac, 3 runs, GPU warning on every run for the foreign Chrome). Every scene, every run: 0 frames over 20 ms, p99 16.7 to 16.8 ms, 0 long tasks. Draws against base: villagers 1014 to 1054, talk 628 to 644/647, home 462 to 467. CPU p50 against base: villagers 5.6 to 6.0 (+0.4, limit +0.56), 5.9 to 6.2 (+0.3, +0.59), 5.6 to 6.0 (+0.4, +0.56); talk +0.4, +0.3, +0.2 and home +0.1, +0.1, +0.2 (limit +0.5). Head GPU p50/p95 ms: home 10.42/14.84, 9.0/10.4, 10.24/14.35; villagers 7.75/8.43, 9.85/12.82, 9.45/13.42; talk 10.03/13.47, 8.94/10.36, 8.6/9.86. All three runs passed. The villagers margin is 0.16 to 0.29 ms, still within reach of the gate's noise (the CPU p50 is read in 0.1 ms steps); what remains is the solver step and 20 toy meshes.

## Fire, heat and water (Nov 9)

Branch `feature/village-physics-fields`. Headless Chrome (Metal), M1 Pro.

- `node scripts/check-physics-fire.mjs`: 25/25 stub after the review fixes; 22/22 `--agent=claude` before them. Felt 8 cm from lit walnut catches at 2.0 simulated s on WebGPU and on WebGL2 (`?webgl=1`); steel beside it reaches 192 °C, cold. `check-physics.mjs` 44/44.
- Cost, real frames, sofa burning (4 parts lit): fire's CPU per frame median < 0.1 ms, p95 0.4 ms (field steps at 20 Hz, one 2048 × 1 sample readback in flight). Living room, `?q=high`, 1440 × 900 at DPR 2, two runs: GPU p50/p95 idle 7.92/10.49 and 9.52/12.34 ms, burning 8.00/10.11 and 9.29/12.95 ms; CPU p50 2.3 to 2.4 ms. With nothing burning, wet or charred, fire does nothing (no field step, no readback, the post look branches out). After a fire, the look makes one field read a pixel for the char (not measured).
- One readback in a few hundred never resolved in headless Chrome; a 2 s watchdog drops it and asks again (`stats().lost`).
