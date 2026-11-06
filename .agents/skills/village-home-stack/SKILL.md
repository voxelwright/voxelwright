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
- `WebGPURenderer` + `await renderer.init()` uses WebGPU in headed Chrome 
  (`channel: 'chrome'`, `--enable-unsafe-webgpu`). Read
  `renderer.backend.isWebGPUBackend` to see which backend ran.
- Post-processing: `THREE.RenderPipeline(renderer, outputNode)` with `pass()`,
  `bloom` (`three/addons/tsl/display/BloomNode.js`) and `film` (`FilmNode.js`).
- Frame stats: `renderer.info.render.drawCalls`, `.triangles`;
  memory: `renderer.info.memory.geometries`, `.textures`.

## Known limits

- Cordis 4 is a release candidate. Recheck `dispose` and `provide` on upgrade.
- TypeScript 7 (native port) was not tried; 5.9.3 is pinned.
- The renderer keeps 1 to 2 internal textures after postfx and scene unloads.
  The count does not grow.

Refresh when any pinned version changes or a probe contradicts this file.
