---
name: tsl-stylised-post
description: Verified r187 recipes and gotchas for stylised post-processing in three.js TSL on WebGPU (16-bit pixel art, comic halftone and ink, neon night, painterly). Load before building a Village theme look on top of home/src/plugins/postfx.ts.
---

# TSL stylised post (three r187, WebGPU)

Verified 2026-11-07 against `home/node_modules/three` 0.187.0 (source in
`examples/jsm/tsl/display/` and `src/nodes/`) and executed in headless Chrome
(`channel: 'chrome'`, `--enable-unsafe-webgpu --use-angle=metal`, M1 Pro, real WebGPU backend,
not a mock). `probe/` holds the runnable page: `probe.js` implements every recipe below
(`?look=pixel|pixelpass|pixelbloom|comic|neon|paint|none`, `&h=180`, `&dpr=2`). Serve the repo root
with any static server (it uses an import map onto `home/node_modules`) and open
`/.agents/skills/tsl-stylised-post/probe/index.html`. Screenshots confirmed each look compiles and renders;
nothing was tuned for taste, and no GPU timings were taken (cost classes below are from reading the code).

Read first: `village-home-stack` (tiers, MRT, TRAA rules) and `home/src/plugins/postfx.ts` (the current pipeline).

## Core rules (source-proven)

- A look is one `THREE.RenderPipeline(renderer, node)`. Set `pipeline.outputColorTransform = false` and
  put `renderOutput(x)` yourself where you want tone mapping + sRGB. With the flag off the pipeline still
  hands `toneMapping`/`outputColorSpace` to the context (`RenderPipeline.js:196-199`), so bare `renderOutput(x)`
  works (probes `pixel`, `comic`, `neon`, `paint`). `renderOutput` also unpremultiplies and clamps alpha.
- `pass()` renders linear HDR (HalfFloat target); tone mapping is NOT applied inside it. Anything that
  needs display values (palette, dither, halftone thresholds, Kuwahara variance, FXAA) must run after `renderOutput`.
  Bloom and SSR belong before it (linear, HDR).
- `screenSize` = drawing-buffer size (or the current render target's size inside a pass or RTT),
  `screenCoordinate` = fragment pixel in that space, `screenUV` = 0..1. All scale with device pixel ratio,
  so size patterns as `screenSize.y / N` (N rows) instead of fixed pixels.
- `convertToTexture(node)` returns texture/sample nodes unchanged, returns `passNode.getTextureNode()` for a
  PassNode (the RAW colour, not the pass's own `setup()` output), and otherwise builds an `rtt()` (an extra
  render pass with a HalfFloat target at drawing-buffer size). `sobel`, `rgbShift`, `chromaticAberration` call it on
  their input, so feed them a texture node or you pay a pass. `bloom`, `dotScreen`, `lut3D`, `boxBlur`, `hashBlur` do not wrap.
- Sampling a PassNode attachment at offsets: `pass.getTextureNode('depth'|'normal'|name).sample(uv)`.
  `getLinearDepthNode()`/`getViewZNode()` cannot be sampled at an offset; linearise each tap yourself with
  `viewZToOrthographicDepth(perspectiveDepthToViewZ(d, cameraNear, cameraFar), cameraNear, cameraFar)`.
- `pass(scene, camera, opts)` forwards `opts` to the RenderTarget (`samples`, `minFilter`, `magFilter`, `depthBuffer`...).
  `samples` defaults to `renderer.samples` (MSAA); `samples: 0` gives hard edges, required for TRAA.

## Node reference (all verified in source; "pass" = renders the scene itself)

| Import (`three/addons/tsl/display/...`) | Signature | Consumes -> produces | Notes |
| --- | --- | --- | --- |
| `PixelationPassNode.js` `pixelationPass` | `(scene, camera, pixelSize=6, normalEdgeStrength=0.3, depthEdgeStrength=0.4)` | PASS (replaces `pass(scene,camera)`) -> colour with darkened/lightened depth+normal edges, Nearest-filtered target | Target = drawing-buffer size / `pixelSize` (floor), re-evaluated every frame, so `pp.pixelSize = drawH / 180` can be changed live. Uses its own MRT `{output, normal: normalView}`; `getTextureNode('output'|'depth'|'normal')` work, so bloom/outlines can follow. Normal is view space, unpacked. `setMRT(mrt({output, normal: normalView, velocity}))` is accepted and `getTextureNode('velocity')` returns (probe `pixelbloom`); TRAA on a Nearest low-res target was NOT tried. No palette or dither. Edge `If` branches are skipped when both strengths are 0. |
| `RetroPassNode.js` `retroPass` | `(scene, camera, {affineDistortion=null, filterTextures=false})` | PASS -> PS1-style colour, scale 0.25, UnsignedByte, Nearest | Swaps every material for MeshBasic/MeshPhong node materials each frame via `setRenderObjectFunction` and snaps vertices to the low-res grid. PBR, clearcoat, sheen, transmission, custom lights are lost; only colorNode/opacityNode/positionNode carry over, env reflection is faked from `metalness`. Not for the real Village scene; only for a deliberate PS1 theme. |
| `DotScreenNode.js` `dotScreen` | `(node, angle=1.57, scale=1)` | any vec4 -> greyscale sin-grid pattern | `uv()*screenSize` so DPR dependent, mono, sine lattice not circles, no ink colour. Write your own halftone (below). |
| `SobelOperatorNode.js` `sobel` | `(node)` | texture -> `vec4(vec3(G),1)` luminance gradient | Colour edges only; a lit, textured scene gives noisy lines. Use depth/normal for ink. |
| `OutlineNode.js` `outline` | `(scene, camera, {selectedObjects, edgeThickness=1, edgeGlow=0, downSampleRatio=2})` | selected objects -> edge mask node (output members not inspected) | Outlines a chosen object set (extra renders of those objects plus blur at 1/2 res); for hover/selection, not whole-scene ink. Read `OutlineNode.js` for its output members before use; not probed. |
| `ChromaticAberrationNode.js` `chromaticAberration` | `(node, strength=1, center=null, scale=1.1)` | texture -> vec4 (3 taps) | Radial, stronger at the edges; `center` null = middle. |
| `RGBShiftNode.js` `rgbShift` | `(node, amount=0.005, angle=0)` | texture -> vec4 (3 taps) | UV units, uniform offset. For comic mis-registration a hand-written 3-tap sample on the scene texture avoids any extra pass. |
| `Lut3DNode.js` `lut3D` | `(node, lutTextureNode, size, intensity)` | colour -> mixed LUT colour | Uses `rgb` as the 3D coordinate directly, so feed display-space values (after `renderOutput`). Needs a Data3DTexture; not probed. |
| `BleachBypass.js` `bleach` / `Sepia.js` `sepia` | `Fn([color, opacity=1])` / `Fn([color])` | vec4 -> vec4 | Plain functions, no pass, no texture. |
| `CRT.js` | `barrelUV(curvature=.1, coord)`, `barrelMask(coord)`, `colorBleeding(color, amount=.002)`, `scanlines(color, intensity=.3, count=240, speed=0, coord)`, `vignette(color, intensity=.4, smoothness=.5, coord)` | helpers | `count` should equal the pixel-art row count (use the same 180/224). |
| `boxBlur.js` / `hashBlur.js` | `boxBlur(tex,{size=1,separation=1})` / `hashBlur(tex, amount=.1,{repeats=45})` | texture node -> blurred vec4 | Single-pass, many taps; keep `size` 1..3. |
| `SSRNode.js` `ssr` | `(colorNode, depthNode, normalNode, {metalnessNode, roughnessNode, reflectNonMetals=false, stochastic=false, environmentNode, camera, ...})` | pass textures -> reflection layer via `.getTextureNode()` | Add the result to the scene colour yourself. MRT needs `normal` (view space) plus `metalness`/`roughness` from `three/tsl`. `reflectNonMetals` defaults false, so non-metal wet floors reflect nothing unless set true or `metalness > 0`. `resolutionScale`, `maxDistance` (view units), `thickness` are public. Own blur pass at `blurQuality=2`. Probe `neon`: floor and sphere reflections rendered. |
| `BloomNode.js` `bloom` | `(inputNode, strength=1, radius=0, threshold=0)` | texture node -> glow to add | Give it `scenePass.getTextureNode()`. Selective bloom: add an `emissive` attachment to the MRT and bloom that texture. |
| `PassNode.setResolutionScale(s)` | `s` in (0,1] | render target = `floor(drawingBuffer * s)` | Re-applied every frame in `updateBefore`, so calling it on resize is enough. Scales scissor/viewport too. Attachment textures keep the scaled size; `textureSize(tex)` returns it. |

## Recipe 1: 16-bit pixel art (probe `pixel`, verified)

Goal: fixed internal height (180 or 224 rows) whatever the DPR, Nearest upscale, display-space dither, palette.

```js
const sp = pass(scene, camera, { samples: 0, minFilter: NearestFilter, magFilter: NearestFilter })
const fit = () => sp.setResolutionScale(Math.min(1, TARGET_H / renderer.getDrawingBufferSize(v2).y))
// call fit() at start and on every resize / DPR change
const tex = sp.getTextureNode()
const px = uv().mul(vec2(textureSize(tex))).floor()           // art-pixel grid, not screen pixels
const disp = renderOutput(tex).rgb                              // tone map + sRGB first
const dithered = disp.add(bayer4(uvec2(px)).sub(0.5).mul(0.12)) // spread ~ 1 / (levels): tune 0.08..0.2
finalNode = vec4(nearestPalette(dithered), 1)                   // pipeline.outputColorTransform = false
```
- Palette: `uniformArray(vec3[] in sRGB display values, 'vec3')`; `Loop(N, ({i}) => ...)` with `If(d < bestD, ...)`
  keeping `best`/`bestD` as `.toVar()`. Build the values with `new Color().setStyle(hex, SRGBColorSpace).getRGB(out, SRGBColorSpace)`,
  because `Color` stores linear. A 16-colour loop is cheap; keep N <= 32.
- 4x4 Bayer, no lookup table (`bayer4` in `probe.js`): with `x=p.x&3, y=p.y&3, z=x^y`,
  `idx = ((z&1)<<3)|((y&1)<<2)|(((z>>1)&1)<<1)|((y>>1)&1)`, threshold `(idx+0.5)/16`. Needs `uvec2(px)`. For 8x8 repeat the
  interleave over three bits. Dither BEFORE quantising and in display space; dithering linear values bands the darks.
- Hard edges come from `samples: 0` plus Nearest. With MSAA on, silhouettes blend inside a art pixel.
- Non-integer ratio `drawH / TARGET_H` gives uneven pixel sizes (some 6, some 7 device px). For crisp pixels pick
  `TARGET_H = drawH / round(drawH / 180)` or accept it; the `?h=` param of the probe shows it.
- `pixelationPass` is the shorter route (edges for free) but has no palette/dither and sizes by `pixelSize`
  (device pixels): set `pp.pixelSize = drawH / TARGET_H` per resize to be DPR independent. To add palette/dither
  after it, take `renderOutput(pp)` as `disp` and use `textureSize(pp.getTextureNode())` for `px`.
- Chain order with the post stack: scene pass (low res) -> bloom (optional, runs at the low res, so it looks chunky) ->
  `renderOutput` -> dither -> palette. FXAA/TRAA do not belong after this; TRAA jitter shimmers on a Nearest low-res target (not tried).
- Camera snapping to the pixel grid (to stop swimming when the camera pans) is not implemented; RetroPassNode snaps vertices, but see its limits above.

## Recipe 2: comic halftone + ink (probe `comic`, verified)

One scene pass with `setMRT(mrt({ output, normal: normalView }))` at full resolution, then a single fused full-screen pass.
- Ink lines: `w` = one pixel times `screenSize.y/360` (so line width is DPR independent). Four neighbour taps of linearised depth:
  `dDiff = sum(|d(o) - d0|)`, edge where `dDiff / max(d0, .05) > 0.02`; four taps of the normal: `sum(length(n(o) - n0)) > 0.9`
  catches creases the depth misses. `ink = max(depthEdge, normalEdge)`, then `mix(colour, inkColour, ink)`.
- Single-ink halftone: rotate `screenCoordinate.xy` by 45 degrees, divide by `cell = screenSize.y / 70`,
  `dist = length(fract(r) - .5)`, radius `sqrt(1 - luminance(col)) * 0.72`, `smoothstep(rad + .08, rad - .08, dist)` = ink coverage;
  `mix(col, mix(paper, ink, coverage), 0.7)`. For CMYK, compute `k = 1 - max(rgb)` and the three subtractive channels, give each its
  own screen angle (15, 75, 0, 45 degrees), draw four dot layers and multiply. Not built; single ink is verified.
- Chromatic offset: sample the scene texture three times (`r` at +u, `g` at 0, `b` at -u, `u` about 0.0025) before `renderOutput`;
  no extra pass. `rgbShift`/`chromaticAberration` do the same but need a texture node input.
- Do halftone in display space (after `renderOutput`) and keep `cell` tied to `screenSize.y` so dots do not change size with DPR.
  Dots alias when animated at high zoom; keep radius smoothing >= 0.05.
- Cost: 1 scene render + 2 extra attachments (normal) + 8 depth/normal taps and 3 colour taps in one pass. Cheap, comparable to FXAA plus a little.

## Recipe 3: neon night (probe `neon`, verified)

- Emissive tubes: `MeshStandardMaterial({ color: 0, emissive: c, emissiveIntensity: 6 })`. HalfFloat pass target keeps values above 1.
- `bloom(lit, strength ~0.7, radius 0.4, threshold ~0.8)`; strength 1.6 with threshold 0 washed the frame into fog. Threshold keeps
  the bloom on the emissive pixels. Add to colour before `renderOutput`.
- Wet floor: floor material `roughness ~0.1, metalness ~0.5` (or `reflectNonMetals: true`), MRT
  `{ output, normal: normalView, metalness, roughness }`, `ssr(color, depth, normal, { metalnessNode, roughnessNode, reflectNonMetals: true, camera })`,
  `resolutionScale = 0.5`, `maxDistance` about the room depth. `lit = color.add(refl.getTextureNode())`. Add a screen-space
  limit: SSR only reflects what is on screen, so tubes off-screen vanish from the floor; a Village scene may want a planar `ReflectorNode` (not tried).
- Cost: SSR is its own pass (ray march plus blur) at `resolutionScale`; bloom is a multi-level blur chain. Village's table
  shows ssgi at 294 ms, so measure SSR on the target machine before enabling it on a tier. No timing was taken here.

## Recipe 4: painterly (probe `paint`, compiled and rendered; look unjudged on real textures)

- `disp = convertToTexture(renderOutput(scenePass.getTextureNode()))` renders the tone-mapped image once so the 64 Kuwahara taps are
  cheap texture reads (extra full-res HalfFloat pass; set `{ resolutionScale: 0.5 }` as the last argument to halve it).
- Classic 4-sector Kuwahara, radius R=3: for sectors `(+1,+1) (-1,+1) (+1,-1) (-1,-1)` average `(R+1)^2` taps, variance
  `sum(E[c^2] - E[c]^2)` over rgb, pick the lowest-variance mean with chained `lessThan(...).select`. Offset scale
  `screenSize.y / 540` keeps radius DPR independent. JS-unrolled loops compile and run (4x16 taps, 198 frames in 4 s headless).
  Anisotropic or generalized Kuwahara (structure tensor) is not implemented; R > 4 should move to a half-res pass.
- Edge darkening from depth differences (`smoothstep(0.004, 0.02, edge) * 0.45`), paper tint `vec3(1, .97, .9)` and a hashed paper grain at `screenSize.y / 540` cells.
  Hash grain is static; animate with `time` only if wanted (boil looks hand-made).
- Cost: scene pass + RTT + one 64-tap pass; heaviest of the four on fill rate at DPR 2.

## 12 fps character animation, camera stays smooth

Village rig (`home/src/villagers/rig.ts`): `FigureSpec.stepped` (set `true` in `home/src/villagers/kinds.ts:400`). In `pose()` it computes
`tick = floor(t * 12)`, returns early when the tick has not changed (the skeleton holds its pose), then evaluates with
`t = tick/12`, `dt = 1/12`; walk phase is quantised to eighths (`floor(phase*8)/8`), foot swing progress to quarters, and head glance eases faster
(rate 12 versus 5). Root translation, camera and particles are not stepped, so the camera stays smooth while limbs tick on twos.
Do the same in any new theme: step the pose, never the render loop or camera. TSL/post has no say in it.

## Cost summary

| Look | Scene renders | Extra full-screen passes | Notes |
| --- | --- | --- | --- |
| pixel (custom) | 1 at ~180 rows (cheaper than normal) | 0 (output pass does dither + palette) | Cheapest; bloom would run at the low res. |
| pixelationPass | 1 at 1/pixelSize, MRT normal | 0 | Edge taps in its own shader. |
| retroPass | 1 at 1/4, material swap per object | 0 | Loses PBR. |
| comic | 1 full-res, MRT normal | 0 (fused) | `sobel` or `rgbShift` on a non-texture input adds an RTT pass. |
| neon | 1 full-res, MRT normal/metalness/roughness | SSR (+blur) + bloom mips | Most passes. |
| paint | 1 full-res, MRT normal | 1 RTT + 1 heavy tap pass | Use half res if over budget. |
| outline() | + selected objects at 1/downSampleRatio | blur passes | Selection only. |

## Not verified

- GPU milliseconds for any look; TRAA with `pixelationPass` or the Nearest low-res pass; WebGL2 fallback; Ally/Linux AMD.
- `lut3D` with a real 3D LUT; `outline()` output members; Kuwahara quality on painted textures and at DPR 1; CMYK halftone;
  planar reflections; camera snapping for pixel art.
- Upstream three newer than r187 may rename `RenderPipeline`/`pass` options; refresh on a three bump or when a probe disagrees.

## Sources

Installed source (primary). Complementary, status 200 on 2026-11-07, not read line by line:
https://threejs.org/examples/webgpu_postprocessing_pixel.html, `..._retro.html`, `..._sobel.html`, `..._ssr.html`,
`..._outline.html`, `..._bloom_emissive.html`; TSL wiki https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language.
