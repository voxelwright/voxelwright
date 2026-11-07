---
name: village-home-stack
description: Versions, verified recipes and limits for the Village home scene stack (three.js WebGPU, Cordis, Vite). Load before changing home/ rendering, plugins or build.
---

# Village home stack

Pinned in `home/package.json` (verified November 6, 2026):
three 0.187.0, cordis 4.0.0-rc.12, vite 8.3.6, typescript 5.9.3, playwright 1.65.0.

## Verified recipes

- Cordis 4 in the browser: `ctx.effect(() => cleanup)`, `ctx.provide(name, value)`
  and `ctx.on(event)` are all reversed by `fiber.dispose()`. Services remove
  themselves too, and plugins with `inject: ['stage']` wait for the service.
  Proven in Node and in Chrome with `home/scripts/measure.mjs --unload`.
- Cordis 4 has no `'dispose'` event in its types. Use `ctx.effect` instead.
- Hot reload: each plugin module calls `import.meta.hot.accept(m => replace(m.default))`.
  Cordis's own HMR plugin targets Node file watching; it isn't used here.
- `WebGPURenderer` + `await renderer.init()` uses WebGPU in Chrome, headed or
  headless (`channel: 'chrome'`, `--enable-unsafe-webgpu`, `--use-angle=metal`;
  headless verified November 6, 2026 on an M1 Pro by the Elder's checks). Read
  `renderer.backend.isWebGPUBackend` to see which backend ran.
- Post-processing: `THREE.RenderPipeline(renderer, outputNode)` with `pass()`,
  `bloom` (`three/addons/tsl/display/BloomNode.js`) and `film` (`FilmNode.js`).
- Frame stats: `renderer.info.render.drawCalls`, `.triangles`;
  memory: `renderer.info.memory.geometries`, `.textures`.

- GPU time per frame (#42, verified November 6, 2026): `src/gpu-time.js`
  wraps `device.createCommandEncoder` so each render and compute pass gets
  `timestampWrites` into one query set (set on three's reused descriptor for
  the call only, then cleared); after the frame's submits, `endFrame()`
  resolves the used queries into a pool of `MAP_READ` buffers. GPU ms is the
  union of the frame's pass intervals. Do not use three's
  `resolveTimestampsAsync`: it keeps only per-pass durations, and under Metal a
  pass's begin is written while earlier passes still run, so sums reach 60 to
  150 ms at 60 fps. Do not use submit-to-`onSubmittedWorkDone()`: it counts
  main-thread delay (a 12 ms CPU loop read 16.7 ms p50, up to 31.5 ms p95; the union stayed at
  8 ms). Verified: GPU-bound, GPU ms equals the frame interval within 0.2 ms.
  `--enable-webgpu-developer-features` made no difference to quantization in
  headless Chrome on the M1 Pro.
- Feature cost on the M1 Pro, kitchen, DPR 2, GPU p50 (bare 7 to 8 ms): phys
  (clearcoat, sheen, glass transmission) +4 ms; csm +2 ms and +286 draw calls;
  gtao at half resolution +5 to 9 ms; traa alone +5 ms, but traa with phys and
  csm 9.1 ms because it drops 4x MSAA; ssgi 294 ms. Runs vary by 1 to 3 ms.
  Full table in `home/README.md`.
- Tiers: high DPR 2 phys+traa (step down above 13 ms), medium DPR 1.5
  phys+traa (step down above 12 ms), low DPR 1. `?q=` overrides, `?fx=` names
  features exactly. TRAA needs `pass(scene, camera, { samples: 0 })` and an MRT
  with `velocity`; GTAO and SSGI need `normal: packNormalToRGB(normalView)`
  (`directionToColor` is renamed in r187).
- CSM: `sun.shadow.shadowNode = new CSMShadowNode(sun, { cascades: 3, maxFar: 9 })`;
  set `maxFar` near the room depth, since the camera's far plane is 60.
- Ally (Linux, AMD Phoenix1), November 6, 2026: no Chromium, Chrome, Node or
  Flatpak browser, so WebGPU on Linux AMD is still unmeasured.

## Known limits

- Cordis 4 is a release candidate. Recheck `dispose` and `provide` on upgrade.
- TypeScript 7 (native port) was not tried; 5.9.3 is pinned.
- The renderer keeps 1 to 2 internal textures after postfx and scene unloads.
  The count does not grow.

Refresh when any pinned version changes or a probe contradicts this file.
