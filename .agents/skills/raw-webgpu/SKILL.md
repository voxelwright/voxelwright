---
name: raw-webgpu
description: Verified facts, recipes and traps for raw WebGPU and WGSL in Voxelwright's engine pages (#140), with no scene library: opening a device, timing honestly on a busy or frame-capped device, WGSL and layout traps, serving TypeScript with Node's type stripper, driving Chrome and Safari. Load before changing engine/probe, engine/page or engine/blocks shaders or pipelines, or any timing claim.
---

# Raw WebGPU in the engine's pages

Adopted November 11, 2026 (#140). The engine's pages use the browser's WebGPU directly: no
three.js, no bundler. Types come from `@webgpu/types` 0.1.74. Verified in Chrome 158 (headless,
through Playwright 1.65) and Safari 27.2 on an M1 Pro. Primary sources: the WebGPU and WGSL
specifications, and the probes in `engine/probe` and `engine/test`.

## Opening a device

- Ask for the limits you use by name (`requiredLimits`), copied from the adapter. A device
  opened with none has the specification's lowest, which understates every machine
  (`probe/gpu.ts` `openGpu`).
- `maxTextureDimension2D` is 8192 on a device opened with no limits. A long list at 8 px a cube is taller (#430).
- `timestamp-query` is optional: ask for it only when the adapter has it. Both browsers on
  the Mac offer it. Do not design round other optional features until a device's own report
  lists them (`node test/read.mjs --all`).
- Safari 27.2 on the Mac: 2 GB storage buffer bindings, 3D textures to 2048, storage buffers
  readable in fragment shaders. Not yet read from an iPhone.
- Compile errors: `await module.getCompilationInfo()` and throw the messages (`shader()`).
  A page that fails must post why (`probe/tell.ts`), or a phone's failure is invisible.

## Timing honestly

- A page's frames are held to the screen's rate, so frames a second says nothing about room
  to spare. **Pace** instead: draw a batch of frames into a texture nobody shows, wait for
  `queue.onSubmittedWorkDone()` and a one-pixel read back, divide (`pace()`). It agreed with
  the GPU's own clock within 2% on a quiet GPU.
- Both the paced time and `timestamp-query` are wall time on a shared GPU. On this Mac the
  same probe read twice as slow an hour later because another thread was drawing. Compare two
  settings in one session, in turn (`test/look.mjs --ab`), and run `test/probe.mjs` as a
  reference before believing a regression.
- Apple GPUs throw hidden opaque layers away, so a fill test must blend its layers or it
  times one.
- This machine runs at load 11 to 18 all day. Trust ratios, not milliseconds.

## WGSL and layout traps (each cost a run)

- A backtick inside a WGSL comment ends the TypeScript template string round it.
- Avoid names WGSL may reserve (`patch`, `half`, `far`, `filter`, `sample`): use others.
- `cast`, `pass` and `from` are reserved too (#163: a field named `pass` and a `var from` failed the march's compile). A `let` declares one name: `let a = 1.0, b = 2.0;` does not parse.
- A picture's depth can be read in a later pass (`texture_depth_2d`, `textureLoad`) if its texture has `TEXTURE_BINDING` and that pass has no depth attachment: `depthFor` gives it (#246). From depth `d`, how far along the eye's forward is `NEAR / (1 - d * (FAR - NEAR) / FAR)`; good to about a twentieth of a cell at 100 m.
- `vec3f` followed by one `f32` packs into 16 bytes; a struct array in a uniform must start
  on a multiple of 16. Write uniforms through one `ArrayBuffer` with float, uint and int views.
- `1.0 / rd` needs every component of `rd` away from zero: clamp tiny components first.
- A value read from a storage buffer of `u32` as a signed number needs `bitcast<i32>`.
- A counter all of a pixel's rays add to is a `var<private>` at module scope.
- One shader module can serve two pipelines with different bindings: with `layout: 'auto'` each pipeline's groups hold only what its own entry point uses, so each needs its own bind groups.
- **Specialise mode-specific shader branches with WGSL `override` constants (`#139`)**: on Apple GPUs, unused code inside inlined functions (`march()`, `lit()`, `deep()`) still inflates register pressure and cuts occupancy by 10–35% even behind dynamic `if` checks. Gate infrequent or mode-specific paths (`MIRRORS`, `FOGGY`, `NIGHT`, `FAR_MODEL`, `UNDERWATER`) with `override` constants, cache pipelines by mode mask (sync compile on first draw for instant transitions like night/underwater/far so single-frame tests never flash wrong), and use an **explicit `GPUPipelineLayout`** rather than `layout: 'auto'` so dead-code elimination removing a binding (e.g. `looks` in `fs_sun` when `FAR_MODEL = false`) never invalidates shared bind groups.
- A layer of a texture array is drawn into through a view of that one layer (`dimension: '2d'`, `baseArrayLayer`), a tile of it with `setViewport` and `setScissorRect`. `r32float` can be drawn into and read with `textureLoad`.
- Every `queue.writeBuffer` before a `submit` lands before any of that submit's passes: one uniform buffer written twice shows only the second to all of them. Passes that need different values need different buffers.
- To write depth from a full-screen pass: return a struct with `@builtin(frag_depth)` and
  give the pipeline a depth target with compare `always`.

## Serving TypeScript with no bundler

- `engine/serve.mjs` sends `.ts` files through Node's `stripTypeScriptTypes` (Node 25.1,
  experimental), so a visit always runs what is on disk and imports name `.ts` files.
- Only syntax that erases is allowed (`erasableSyntaxOnly`): no constructor parameter
  properties, no enums. `tsc --noEmit` checks it.
- `queue.writeBuffer` wants `Uint32Array<ArrayBuffer>`, not the default `ArrayBufferLike`.
- The server sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`: pages are cross-origin isolated, through
  `tailscale serve` too. A module worker is `new Worker('/page/worker.ts', { type: 'module' })`.

## Driving browsers

- Chrome: Playwright `channel: 'chrome'`, headless, `--enable-unsafe-webgpu --use-angle=metal`.
- Safari: `open -g -a Safari <address>` and let the page post its own report. Driving Safari
  by script needs a permission prompt; do not wait on one.
- A phone: `tailscale serve --bg --https=10140 http://127.0.0.1:5740` (tailnet only; never
  `funnel`, never `reset`, the other entries belong to other threads).

## Measured (M1 Pro, Chrome and Safari agree, quiet GPU, 2560 x 1440)

| Work | Cost |
|---|---|
| A lit pixel | 0.09 to 0.12 ms a megapixel a layer |
| Small unmerged faces | 2.3 ms a million |
| Rays through a small two-level grid of cells | 45 to 50 microseconds a megapixel a step |
| The city's march, a step through open air | about 70 microseconds a megapixel |
| The city's march, a step that loads tree nodes | about 600 microseconds a megapixel |

## A real iPhone (iOS 27.0, Chrome over WebKit, November 11, 2026)

- The same features as Safari on the Mac, `timestamp-query` among them; 1 GB for buffers
  and storage bindings; cross-origin isolated through `tailscale serve`; shared memory, wasm
  SIMD and threads, WebTransport all present.
- **Its `timestamp-query` is not a measure.** A pass's time read 0.01 to 10 ms for the same
  work from one second to the next. Pacing (`pace()`) gave steady figures. Steer by late
  frames on a phone.
- `navigator.wakeLock.request('screen')` before any touch was refused: ask again on the
  first touch.
- `navigator.hardwareConcurrency` said 4.

## Many small transparent pictures in a page (#430, November 17, 2026)

Measured with the Voxelmorphism kit's parts (`engine/blocks`, `engine/blocks/proof`): Chrome 158, Playwright
WebKit 27.2 and real Safari 27.2 on the M1 Pro. Playwright's WebKit showed none of the Safari faults below, so test
real Safari (`open -g -a Safari`, the page posts what it found).
The kit must be at plant-a-seed 37c271f or later (`ownsCanvas`).

- **One device can show its picture in many canvases.** 64 canvases each with a `GPUCanvasContext` on one
  device (`alphaMode: 'premultiplied'`, usage `RENDER_ATTACHMENT | COPY_DST`) worked in all three. Draw every
  part that changed onto one texture in two passes, then `copyTextureToTexture` each part's area into its
  canvas's current texture: no pixel leaves the GPU.
- **A shown canvas keeps its picture** until `getCurrentTexture` is next called on it: nothing need be drawn at
  rest, and it stayed through scrolling away and back.
- **A shown canvas cannot be read back later.** `drawImage` of it into a 2D canvas gave nothing once its frame
  had been shown (Chrome). Read it in the turn it was drawn in, or compare screenshots. In Playwright's WebKit it can be read once
  a turn: a second `drawImage` of it in the same turn, after drawing into it again, gave nothing.
- **`drawImage` from a WebGPU canvas into a 2D canvas** is as fast as WebGL2's in Chrome. In real Safari it
  makes the page's thread wait for the GPU (10 ms for a button, 16 for a dialog), and with a source rectangle
  inside a larger canvas it copied the wrong pixels.
- **`discard` on a target of 4 samples is ruinous in Safari.** A fragment shader that may `discard`, and reads
  the shadow map 25 times, drew 8,000 cubes in 70 ms; the same without the `discard` in 6 (Chrome's time did not change).
  Hide by depth: draw what hides into the depth alone first (colour `writeMask: 0`).
- **Safari takes 0.2 to 1.3 s to make a pipeline from shader text it has not seen**, and 10 to 25 ms when it has
  (it keeps them between visits). Chrome: 7 to 60 ms.
- **What is cleared and resolved is the whole attachment**, however little is drawn (there is no scissor on a
  load or a store): keep the texture parts are drawn onto as small as what is laid on it.
- Parts written into the same buffers in several batches need a `submit` after each batch: see the `writeBuffer` trap above.
- **A device can be lost on purpose**: `device.destroy()` resolves `device.lost` (reason `destroyed`). A canvas
  context is told its new device with `configure` again; a new device with its pipelines was drawing 86 to 311 ms
  later.
- **Edges at any angle do not match WebGL2's to the pixel**, though both have four samples: WebGL2 holds its
  picture upside down, so its samples lie mirrored. Along the edges of turned cubes up to 1.8% of pixels differ by
  one sample, and a few beside halos at night. Drawn upside down and turned back, they match (2,711 pixels off
  became 7). Pictures of things at rest on whole pixels match either way.
- A shadow map sampled with `textureSampleCompareLevel` may be called inside `if` and loops;
  `textureSampleCompare` may not.

## Not verified

- Compute shaders. Workers that draw. A phone held sideways, or for more than a minute.
- Many canvases on one device on an iPhone, in Firefox, or in a tab hidden and come back to.
