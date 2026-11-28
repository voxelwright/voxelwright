// Real headless Chrome WebGPU verification for engine/page/taa.ts (#165).
//
// Synthesizes a high-frequency GPU scene (thin ~1-px slanted grid lines, high-contrast HDR dots
// including rgb=[8.0, 2.0, 0.5] and >4.0 luminance emitters, and a moving foreground box) at 0.55x
// (352x198) into persistent allocated textures (640x360) with Halton(2, 3) jitter and exact
// analytic rg16float motion vectors, resolving to 640x360:
//   - Test 1: Static convergence & aliasing reduction vs 4x supersampled ground truth & raw bilinear.
//   - Test 2: Camera pan + moving foreground box tracking, disocclusion ghosting & hard reset.
//   - Test 3: HDR stability (zero NaNs/Infs/negatives, preserved HDR peak, zero black halo rings).
//   - Test 4: Dynamic resolution switching (0.50x/0.65x/0.85x/0.55x) with 0 reallocs & 0 GPU faults.
//
//   node engine/test/taa.mjs
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [800, 600], dpr: 1 })
  const harnessUrl = `${url}/taa-harness.html`
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<!doctype html><meta charset="utf-8"><title>Voxelwright TAA WebGPU Test</title>',
    }),
  )
  await page.goto(harnessUrl)

  const report = await page.evaluate(async () => {
    /** @type {any} */
    const gpuMod = await import('/probe/gpu.ts')
    /** @type {any} */
    const taaMod = await import('/page/taa.ts')

    const gpu = await gpuMod.openGpu()
    const { device } = gpu

    const OUT_W = 640
    const OUT_H = 360
    const RENDER_W = 352 // 0.55x of 640
    const RENDER_H = 198 // 0.55x of 360

    // Verify Halton(2, 3) helper bounds and NDC helper before GPU passes.
    const jitterSamples = []
    for (let i = 0; i < 16; i++) {
      const j = taaMod.haltonJitter(i, RENDER_W, RENDER_H)
      const ndc = taaMod.haltonJitterNdc(i, RENDER_W, RENDER_H)
      jitterSamples.push({ j: [j[0], j[1]], ndc: [ndc[0], ndc[1]] })
    }
    const jitterInRange = jitterSamples.every(
      (s) => s.j[0] >= -0.5 && s.j[0] <= 0.5 && s.j[1] >= -0.5 && s.j[1] <= 0.5,
    )
    const jitterUnique = new Set(jitterSamples.map((s) => `${s.j[0].toFixed(5)},${s.j[1].toFixed(5)}`)).size === 16
    const jitterRepeats =
      taaMod.haltonJitter(0, RENDER_W, RENDER_H)[0] === taaMod.haltonJitter(16, RENDER_W, RENDER_H)[0] &&
      taaMod.haltonJitter(0, RENDER_W, RENDER_H)[1] === taaMod.haltonJitter(16, RENDER_W, RENDER_H)[1]

    // Synthetic GPU scene shader:
    //   - `fs_scene`: renders jittered render-res color (rgba16float), analytic velocity (rg16float), depth (depth24plus)
    //   - `fs_ref`:   renders 4x4 (16-tap) supersampled ground-truth reference at 640x360
    //   - `fs_bilin`: raw bilinear upscale baseline of the jittered render-res color texture
    const SCENE_WGSL = /* wgsl */ `
struct SceneU {
  // xy: active renderSize, zw: outputSize (640, 360)
  sizes: vec4f,
  // xy: current camera UV offset, zw: previous camera UV offset
  cam: vec4f,
  // xy: current box center (world UV), zw: previous box center (world UV)
  boxPos: vec4f,
  // xy: pixel jitter in render-res pixels, zw: uvScale (renderSize / allocSize)
  jitterScale: vec4f,
}

@group(0) @binding(0) var<uniform> u: SceneU;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

struct EvalOut {
  col: vec3f,
  vel: vec2f,
  depth: f32,
}

fn evalScene(screenUV: vec2f) -> EvalOut {
  let worldUV = screenUV + u.cam.xy;
  let outSize = u.sizes.zw;

  // Background slate gradient (strictly > 0.16 so any dark halo ring is immediately detectable).
  var col = mix(vec3f(0.18, 0.21, 0.26), vec3f(0.25, 0.28, 0.33), clamp(worldUV.y, 0.0, 1.0));
  var depth = 0.85;
  var vel = u.cam.xy - u.cam.zw;

  // High-frequency ~1-px slanted grid lines tilted ~18 deg (tough aliasing & shimmer stress test).
  let p = worldUV * outSize;
  let ca = 0.9510565;
  let sa = 0.3090170;
  let rot = vec2f(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  let period = 13.0;
  let gx = abs(fract(rot.x / period + 0.5) - 0.5) * period;
  let gy = abs(fract(rot.y / period + 0.5) - 0.5) * period;
  let lineDist = min(gx, gy);
  let lineMask = 1.0 - smoothstep(0.48, 0.62, lineDist);
  col = mix(col, vec3f(0.88, 0.84, 0.76), lineMask);

  // Secondary finer diagonal hatch stripes in the right half for extra sub-pixel frequency content.
  let hatchP = (p.x * 0.848 + p.y * 0.530) / 7.5;
  let hatchDist = abs(fract(hatchP + 0.5) - 0.5) * 7.5;
  let hatchMask = (1.0 - smoothstep(0.45, 0.58, hatchDist)) * step(0.55, worldUV.x) * step(worldUV.x, 0.92) * step(0.12, worldUV.y) * step(worldUV.y, 0.88);
  col = mix(col, vec3f(0.76, 0.82, 0.92), hatchMask * 0.85);

  // High-contrast HDR emissive dots:
  //   Dot 0: exact rgb = [8.0, 2.0, 0.5] at worldUV (0.25, 0.30), radius 2.6 native px (clear uniform surround)
  //   Dot 1: >4.0 luminance rgb = [9.0, 5.0, 1.5] (Y_rec709 = 5.60) at worldUV (0.72, 0.28), radius 2.4 native px
  //   Dot 2: crisp small HDR dot rgb = [8.0, 2.0, 0.5] at worldUV (0.28, 0.72), radius 1.5 native px
  let d0 = length((worldUV - vec2f(0.25, 0.30)) * outSize);
  let d1 = length((worldUV - vec2f(0.72, 0.28)) * outSize);
  let d2 = length((worldUV - vec2f(0.28, 0.72)) * outSize);
  // Keep a clean flat background ring around Dot 0 (radius 3..10 px) for exact halo-ring verification.
  if (d0 < 10.0) {
    col = vec3f(0.22, 0.24, 0.28);
  }
  if (d0 < 2.6) {
    col = vec3f(8.0, 2.0, 0.5);
  }
  if (d1 < 2.4) {
    col = vec3f(9.0, 5.0, 1.5);
  }
  if (d2 < 1.5) {
    col = vec3f(8.0, 2.0, 0.5);
  }

  // Moving opaque foreground box (depth 0.25, much nearer than background 0.85).
  let rel = worldUV - u.boxPos.xy;
  let halfSize = vec2f(0.085, 0.115);
  if (abs(rel.x) < halfSize.x && abs(rel.y) < halfSize.y) {
    let localPx = rel * outSize;
    let stripe = abs(fract((localPx.x * 0.92 + localPx.y * 0.39) / 9.0 + 0.5) - 0.5) * 9.0;
    let sMask = 1.0 - smoothstep(0.55, 0.70, stripe);
    let border = step(halfSize.x - 0.004, abs(rel.x)) + step(halfSize.y - 0.006, abs(rel.y));
    var boxCol = mix(vec3f(0.14, 0.58, 0.64), vec3f(0.92, 0.42, 0.24), sMask);
    boxCol = mix(boxCol, vec3f(0.95, 0.92, 0.84), clamp(border, 0.0, 1.0));
    col = boxCol;
    depth = 0.25;
    vel = (u.boxPos.zw - u.boxPos.xy) + (u.cam.xy - u.cam.zw);
  }

  return EvalOut(col, vel, depth);
}

struct SceneFragOut {
  @location(0) col: vec4f,
  @location(1) vel: vec2f,
  @builtin(frag_depth) depth: f32,
}

@fragment fn fs_scene(@builtin(position) at: vec4f) -> SceneFragOut {
  // Exact jittered screen UV matching TAA's sign convention: (ix + 0.5 + jx) / renderW.
  let screenUV = (at.xy + u.jitterScale.xy) / u.sizes.xy;
  let e = evalScene(screenUV);
  return SceneFragOut(vec4f(e.col, 1.0), e.vel, e.depth);
}

@fragment fn fs_ref(@builtin(position) at: vec4f) -> @location(0) vec4f {
  // 4x4 (16-tap) supersampled ground-truth reference at native outputSize.
  let basePx = floor(at.xy);
  let outSize = u.sizes.zw;
  var acc = vec3f(0.0);
  for (var sy = 0; sy < 4; sy++) {
    for (var sx = 0; sx < 4; sx++) {
      let sub = (vec2f(f32(sx), f32(sy)) + 0.5) * 0.25;
      let uv = (basePx + sub) / outSize;
      acc += evalScene(uv).col;
    }
  }
  return vec4f(acc * (1.0 / 16.0), 1.0);
}
`

    const BILIN_WGSL = /* wgsl */ `
struct BilinU {
  uvScale: vec2f,
  invAlloc: vec2f,
}
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> bu: BilinU;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

@fragment fn fs_bilin(in: VsOut) -> @location(0) vec4f {
  let clampedUV = clamp(in.uv * bu.uvScale, bu.invAlloc * 0.5, bu.uvScale - bu.invAlloc * 0.5);
  return vec4f(textureSampleLevel(srcTex, samp, clampedUV, 0.0).rgb, 1.0);
}
`

    const [sceneMod, bilinMod] = await Promise.all([
      gpuMod.shader(device, 'taa-test-scene', SCENE_WGSL),
      gpuMod.shader(device, 'taa-test-bilin', BILIN_WGSL),
    ])

    const sceneLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const scenePipeLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] })
    const scenePipe = await device.createRenderPipelineAsync({
      label: 'taa-test-scene',
      layout: scenePipeLayout,
      vertex: { module: sceneMod, entryPoint: 'vs' },
      fragment: {
        module: sceneMod,
        entryPoint: 'fs_scene',
        targets: [{ format: 'rgba16float' }, { format: 'rg16float' }],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
    })

    const refPipe = await device.createRenderPipelineAsync({
      label: 'taa-test-ref',
      layout: scenePipeLayout,
      vertex: { module: sceneMod, entryPoint: 'vs' },
      fragment: { module: sceneMod, entryPoint: 'fs_ref', targets: [{ format: 'rgba16float' }] },
    })

    const bilinLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    const bilinPipe = await device.createRenderPipelineAsync({
      label: 'taa-test-bilin',
      layout: device.createPipelineLayout({ bindGroupLayouts: [bilinLayout] }),
      vertex: { module: bilinMod, entryPoint: 'vs' },
      fragment: { module: bilinMod, entryPoint: 'fs_bilin', targets: [{ format: 'rgba16float' }] },
    })

    // Persistent input textures allocated once at native 640x360; dynamic renderSize uses sub-viewport!
    const colorTex = device.createTexture({
      label: 'scene-color',
      size: [OUT_W, OUT_H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    const velTex = device.createTexture({
      label: 'scene-vel',
      size: [OUT_W, OUT_H],
      format: 'rg16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const depthTex = device.createTexture({
      label: 'scene-depth',
      size: [OUT_W, OUT_H],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const refTex = device.createTexture({
      label: 'scene-ref',
      size: [OUT_W, OUT_H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const bilinTex = device.createTexture({
      label: 'scene-bilin',
      size: [OUT_W, OUT_H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    const colorView = colorTex.createView()
    const velView = velTex.createView()
    const depthView = depthTex.createView()
    const refView = refTex.createView()
    const bilinView = bilinTex.createView()

    const sceneUbo = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const bilinUbo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const sceneBind = device.createBindGroup({ layout: sceneLayout, entries: [{ binding: 0, resource: { buffer: sceneUbo } }] })
    const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const bilinBind = device.createBindGroup({
      layout: bilinLayout,
      entries: [
        { binding: 0, resource: colorView },
        { binding: 1, resource: linSampler },
        { binding: 2, resource: { buffer: bilinUbo } },
      ],
    })

    // IEEE-754 half-float (uint16) decoder preserving NaN/Inf/sign for exact rgba16float verification.
    /** @param {number} h */
    const f16ToF32 = (h) => {
      const sign = (h & 0x8000) !== 0 ? -1 : 1
      const exp = (h >> 10) & 0x1f
      const frac = h & 0x3ff
      if (exp === 0) return frac === 0 ? sign * 0 : sign * Math.pow(2, -14) * (frac / 1024)
      if (exp === 31) return frac === 0 ? sign * Infinity : NaN
      return sign * Math.pow(2, exp - 15) * (1 + frac / 1024)
    }

    const bytesPerRow = Math.ceil((OUT_W * 8) / 256) * 256
    const readBuf = device.createBuffer({
      size: bytesPerRow * OUT_H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    /** Reads back an OUT_W x OUT_H rgba16float texture into packed Float32Array (OUT_W * OUT_H * 4). */
    /** @param {GPUTexture} tex */
    const readRgba16f = async (tex) => {
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow, rowsPerImage: OUT_H }, [OUT_W, OUT_H])
      device.queue.submit([enc.finish()])
      await readBuf.mapAsync(GPUMapMode.READ)
      const mapped = new Uint16Array(readBuf.getMappedRange())
      const out = new Float32Array(OUT_W * OUT_H * 4)
      const rowU16 = bytesPerRow >> 1
      for (let y = 0; y < OUT_H; y++) {
        const srcRow = y * rowU16
        const dstRow = y * OUT_W * 4
        for (let x = 0; x < OUT_W * 4; x++) {
          out[dstRow + x] = f16ToF32(mapped[srcRow + x])
        }
      }
      readBuf.unmap()
      return out
    }

    /** Perceptual tone-mapped [0, 1] RMSE so HDR spikes and SDR grid edges are weighted fairly. */
    /** @param {Float32Array} a @param {Float32Array} b @param {{x0:number,y0:number,x1:number,y1:number}} [rect] */
    const rmseTone = (a, b, rect) => {
      const x0 = rect ? rect.x0 : 0
      const y0 = rect ? rect.y0 : 0
      const x1 = rect ? rect.x1 : OUT_W
      const y1 = rect ? rect.y1 : OUT_H
      let sumSq = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * OUT_W + x) * 4
          for (let c = 0; c < 3; c++) {
            const ta = a[i + c] / (1 + Math.max(0, a[i + c]))
            const tb = b[i + c] / (1 + Math.max(0, b[i + c]))
            const d = ta - tb
            sumSq += d * d
            count++
          }
        }
      }
      return Math.sqrt(sumSq / Math.max(1, count))
    }

    /** Linear RMSE on a region (ideal for SDR slanted grid lines & disocclusion strip). */
    /** @param {Float32Array} a @param {Float32Array} b @param {{x0:number,y0:number,x1:number,y1:number}} rect */
    const rmseLinear = (a, b, rect) => {
      let sumSq = 0
      let count = 0
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const i = (y * OUT_W + x) * 4
          for (let c = 0; c < 3; c++) {
            const d = a[i + c] - b[i + c]
            sumSq += d * d
            count++
          }
        }
      }
      return Math.sqrt(sumSq / Math.max(1, count))
    }

    /** @param {number} renderW @param {number} renderH @param {[number,number]} cam @param {[number,number]} prevCam @param {[number,number]} box @param {[number,number]} prevBox @param {readonly [number,number]} jitter */
    const writeSceneUniforms = (renderW, renderH, cam, prevCam, box, prevBox, jitter) => {
      device.queue.writeBuffer(
        sceneUbo,
        0,
        new Float32Array([
          renderW, renderH, OUT_W, OUT_H,
          cam[0], cam[1], prevCam[0], prevCam[1],
          box[0], box[1], prevBox[0], prevBox[1],
          jitter[0], jitter[1], renderW / OUT_W, renderH / OUT_H,
        ]),
      )
      device.queue.writeBuffer(bilinUbo, 0, new Float32Array([renderW / OUT_W, renderH / OUT_H, 1 / OUT_W, 1 / OUT_H]))
    }

    /** @param {GPUCommandEncoder} enc @param {number} renderW @param {number} renderH */
    const encodeScene = (enc, renderW, renderH) => {
      const p = enc.beginRenderPass({
        colorAttachments: [
          { view: colorView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
          { view: velView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
        depthStencilAttachment: { view: depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      })
      p.setPipeline(scenePipe)
      p.setBindGroup(0, sceneBind)
      p.setViewport(0, 0, renderW, renderH, 0, 1)
      p.setScissorRect(0, 0, renderW, renderH)
      p.draw(3)
      p.end()
    }

    /** @param {[number,number]} cam @param {[number,number]} box */
    const renderRef = async (cam, box) => {
      writeSceneUniforms(OUT_W, OUT_H, cam, cam, box, box, [0, 0])
      const enc = device.createCommandEncoder()
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: refView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      p.setPipeline(refPipe)
      p.setBindGroup(0, sceneBind)
      p.draw(3)
      p.end()
      device.queue.submit([enc.finish()])
      return readRgba16f(refTex)
    }

    /** @param {GPUCommandEncoder} enc */
    const encodeBilin = (enc) => {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: bilinView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      p.setPipeline(bilinPipe)
      p.setBindGroup(0, bilinBind)
      p.draw(3)
      p.end()
    }

    const taa = await taaMod.createTaa(device, [OUT_W, OUT_H])

    // ── Test 1: Static convergence & aliasing/shimmer reduction (0.55x -> 640x360) ───────────
    /** @type {[number, number]} */
    const staticCam = [0.0, 0.0]
    /** @type {[number, number]} */
    const staticBox = [0.50, 0.52]
    const staticRef = await renderRef(staticCam, staticBox)
    const gridRect = { x0: 360, y0: 140, x1: 600, y1: 330 } // pure slanted grid + fine diagonal hatch

    /** @type {Float32Array | null} */
    let frame1Taa = null
    /** @type {Float32Array | null} */
    let frame16Taa = null
    /** @type {Float32Array | null} */
    let prevTaa = null
    /** @type {Float32Array | null} */
    let prevBilin = null
    let taaShimmerAcc = 0
    let bilinShimmerAcc = 0
    let shimmerPairs = 0
    let bilinRmseAcc = 0
    let bilinGridRmseAcc = 0

    for (let f = 0; f < 16; f++) {
      const jitter = taaMod.haltonJitter(f, RENDER_W, RENDER_H)
      writeSceneUniforms(RENDER_W, RENDER_H, staticCam, staticCam, staticBox, staticBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, RENDER_W, RENDER_H)
      encodeBilin(enc)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        reset: f === 0,
        sharpness: 0.25,
      })
      device.queue.submit([enc.finish()])

      if (f === 0 || f >= 9) {
        const curTaa = await readRgba16f(taa.texture)
        const curBilin = await readRgba16f(bilinTex)
        if (f === 0) frame1Taa = curTaa
        if (f === 15) frame16Taa = curTaa
        if (f >= 9) {
          bilinRmseAcc += rmseTone(curBilin, staticRef)
          bilinGridRmseAcc += rmseLinear(curBilin, staticRef, gridRect)
          if (prevTaa && prevBilin) {
            taaShimmerAcc += rmseTone(curTaa, prevTaa, gridRect)
            bilinShimmerAcc += rmseTone(curBilin, prevBilin, gridRect)
            shimmerPairs++
          }
          prevTaa = curTaa
          prevBilin = curBilin
        }
      }
    }

    const rmseFrame1 = rmseTone(frame1Taa, staticRef)
    const rmseFrame16 = rmseTone(frame16Taa, staticRef)
    const rmseGridFrame1 = rmseLinear(frame1Taa, staticRef, gridRect)
    const rmseGridFrame16 = rmseLinear(frame16Taa, staticRef, gridRect)
    const rmseBilin = bilinRmseAcc / (shimmerPairs + 1)
    const rmseGridBilin = bilinGridRmseAcc / (shimmerPairs + 1)
    const rmseImprovementPct = ((rmseFrame1 - rmseFrame16) / rmseFrame1) * 100
    const gridImprovementPct = ((rmseGridFrame1 - rmseGridFrame16) / rmseGridFrame1) * 100
    const taaShimmer = taaShimmerAcc / Math.max(1, shimmerPairs)
    const bilinShimmer = bilinShimmerAcc / Math.max(1, shimmerPairs)
    const shimmerDropPct = ((bilinShimmer - taaShimmer) / Math.max(1e-6, bilinShimmer)) * 100

    // ── Test 3 (Static Converged HDR inspection on frame16Taa + high-sharpness pass) ─────────
    /** @param {Float32Array} buf @param {number} cx @param {number} cy */
    const inspectHdr = (buf, cx, cy) => {
      let nans = 0
      let infs = 0
      let negatives = 0
      let maxDotLum = 0
      let minRingChan = Infinity
      let ringSamples = 0
      for (let y = 0; y < OUT_H; y++) {
        for (let x = 0; x < OUT_W; x++) {
          const i = (y * OUT_W + x) * 4
          for (let c = 0; c < 4; c++) {
            const v = buf[i + c]
            if (Number.isNaN(v)) nans++
            else if (!Number.isFinite(v)) infs++
            else if (v < -1e-6) negatives++
          }
          const dx = x + 0.5 - cx
          const dy = y + 0.5 - cy
          const dist = Math.hypot(dx, dy)
          if (dist < 2.2) {
            const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]
            if (lum > maxDotLum) maxDotLum = lum
          } else if (dist >= 3.6 && dist <= 8.5) {
            // Flat background ring around Dot 0 is [0.22, 0.24, 0.28]; any dark halo ring dips below 0.22!
            const m = Math.min(buf[i], buf[i + 1], buf[i + 2])
            if (m < minRingChan) minRingChan = m
            ringSamples++
          }
        }
      }
      // Also check Dot 1 (> 4.0 luminance emitter at (0.72 * 640, 0.28 * 360)).
      const d1x = Math.round(0.72 * OUT_W)
      const d1y = Math.round(0.28 * OUT_H)
      let maxDot1Lum = 0
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const i = ((d1y + dy) * OUT_W + (d1x + dx)) * 4
          const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]
          if (lum > maxDot1Lum) maxDot1Lum = lum
        }
      }
      return { nans, infs, negatives, maxDot0Lum: maxDotLum, maxDot1Lum, minRingChan, ringSamples }
    }

    const hdrStatic = inspectHdr(frame16Taa, 0.25 * OUT_W, 0.30 * OUT_H)

    // Also run one more frame at high sharpness (0.85) to stress-test RCAS anti-ringing around HDR dots.
    {
      const jitter = taaMod.haltonJitter(16, RENDER_W, RENDER_H)
      writeSceneUniforms(RENDER_W, RENDER_H, staticCam, staticCam, staticBox, staticBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, RENDER_W, RENDER_H)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        sharpness: 0.85,
      })
      device.queue.submit([enc.finish()])
    }
    const hdrSharpFrame = await readRgba16f(taa.texture)
    const hdrSharp = inspectHdr(hdrSharpFrame, 0.25 * OUT_W, 0.30 * OUT_H)

    // ── Test 2: Camera pan + moving foreground box + disocclusion + hard reset ───────────────
    /** @type {[number, number]} */
    let cam = [0.0, 0.0]
    /** @type {[number, number]} */
    let box = [0.34, 0.50]
    /** @type {[number, number]} */
    let prevCam = [cam[0], cam[1]]
    /** @type {[number, number]} */
    let prevBox = [box[0], box[1]]
    const camStep = [0.0055, 0.0022]
    const boxStep = [0.0155, -0.0018] // box moves right relative to background (~6.4 px/frame screen motion)

    /** @type {Float32Array | null} */
    let motionFrame12Taa = null
    /** @type {Float32Array | null} */
    let motionFrame12Bilin = null

    for (let f = 0; f < 12; f++) {
      if (f > 0) {
        prevCam = [cam[0], cam[1]]
        prevBox = [box[0], box[1]]
        cam = [cam[0] + camStep[0], cam[1] + camStep[1]]
        box = [box[0] + boxStep[0], box[1] + boxStep[1]]
      }
      const jitter = taaMod.haltonJitter(f, RENDER_W, RENDER_H)
      writeSceneUniforms(RENDER_W, RENDER_H, cam, prevCam, box, prevBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, RENDER_W, RENDER_H)
      encodeBilin(enc)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        reset: f === 0,
        sharpness: 0.25,
      })
      device.queue.submit([enc.finish()])
      if (f === 11) {
        motionFrame12Taa = await readRgba16f(taa.texture)
        motionFrame12Bilin = await readRgba16f(bilinTex)
      }
    }

    const motionRef12 = await renderRef(cam, box)
    const motionRmseTaa = rmseTone(motionFrame12Taa, motionRef12)
    const motionRmseBilin = rmseTone(motionFrame12Bilin, motionRef12)
    const hdrMotion = inspectHdr(motionFrame12Taa, (0.25 - cam[0]) * OUT_W, (0.30 - cam[1]) * OUT_H)

    // Compute exact screen-space box bounds on frame 12 and the newly disoccluded trailing strip just left of it.
    const boxScreenX = box[0] - cam[0]
    const boxScreenY = box[1] - cam[1]
    const boxRect = {
      x0: Math.max(0, Math.floor((boxScreenX - 0.085) * OUT_W) + 2),
      y0: Math.max(0, Math.floor((boxScreenY - 0.115) * OUT_H) + 2),
      x1: Math.min(OUT_W, Math.ceil((boxScreenX + 0.085) * OUT_W) - 2),
      y1: Math.min(OUT_H, Math.ceil((boxScreenY + 0.115) * OUT_H) - 2),
    }
    const disoccRect = {
      x0: Math.max(0, Math.floor((boxScreenX - 0.085) * OUT_W) - 18),
      y0: Math.max(0, Math.floor((boxScreenY - 0.10) * OUT_H)),
      x1: Math.max(1, Math.floor((boxScreenX - 0.085) * OUT_W) - 2),
      y1: Math.min(OUT_H, Math.ceil((boxScreenY + 0.10) * OUT_H)),
    }
    const motionBoxRmseTaa = rmseLinear(motionFrame12Taa, motionRef12, boxRect)
    const motionBoxRmseBilin = rmseLinear(motionFrame12Bilin, motionRef12, boxRect)
    const disoccGhostRmse = rmseLinear(motionFrame12Taa, motionRef12, disoccRect)
    const disoccBilinRmse = rmseLinear(motionFrame12Bilin, motionRef12, disoccRect)

    // Hard reset test: teleport camera & move box far away with reset: true.
    /** @type {[number, number]} */
    const cutCam = [0.22, -0.14]
    /** @type {[number, number]} */
    const cutBox = [0.82, 0.78]
    const cutRef = await renderRef(cutCam, cutBox)
    {
      const jitter = taaMod.haltonJitter(0, RENDER_W, RENDER_H)
      // Deliberately pass zero velocity on a hard camera cut to verify reset:true discards old history!
      writeSceneUniforms(RENDER_W, RENDER_H, cutCam, cutCam, cutBox, cutBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, RENDER_W, RENDER_H)
      encodeBilin(enc)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        reset: true,
        sharpness: 0.25,
      })
      device.queue.submit([enc.finish()])
    }
    const cutFrameTaa = await readRgba16f(taa.texture)
    const cutFrameBilin = await readRgba16f(bilinTex)
    // Run the exact same cut frame a second time with reset: true to prove bit-exact zero bleed from frame 12.
    {
      const jitter = taaMod.haltonJitter(0, RENDER_W, RENDER_H)
      const enc = device.createCommandEncoder()
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        reset: true,
        sharpness: 0.25,
      })
      device.queue.submit([enc.finish()])
    }
    const cutFrameClean = await readRgba16f(taa.texture)
    let resetMaxBleed = 0
    for (let i = 0; i < cutFrameTaa.length; i++) {
      const d = Math.abs(cutFrameTaa[i] - cutFrameClean[i])
      if (d > resetMaxBleed) resetMaxBleed = d
    }
    const resetRmse = rmseTone(cutFrameTaa, cutRef)
    const resetBilinRmse = rmseTone(cutFrameBilin, cutRef)
    const resetOldBoxRmse = rmseLinear(cutFrameTaa, cutRef, boxRect)
    const resetOldBoxBilinRmse = rmseLinear(cutFrameBilin, cutRef, boxRect)

    // Verify sharpness: 0 bypasses RCAS cleanly (1-pass direct history view) with finite output & zero reallocs.
    {
      const jitter = taaMod.haltonJitter(1, RENDER_W, RENDER_H)
      writeSceneUniforms(RENDER_W, RENDER_H, cutCam, cutCam, cutBox, cutBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, RENDER_W, RENDER_H)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [RENDER_W, RENDER_H],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        sharpness: 0,
      })
      device.queue.submit([enc.finish()])
    }
    const noSharpFrame = await readRgba16f(taa.texture)
    let noSharpNonFinite = 0
    for (let i = 0; i < noSharpFrame.length; i++) {
      if (!Number.isFinite(noSharpFrame[i])) noSharpNonFinite++
    }

    // ── Test 4: Dynamic resolution switching across 0.50x, 0.65x, 0.85x, 0.55x over 20 frames ─
    const scales = [0.50, 0.65, 0.85, 0.55]
    taa.reset()
    const dynRef = await renderRef(staticCam, staticBox)
    let dynWorstRmse = 0
    let dynNonFinite = 0

    for (let f = 0; f < 20; f++) {
      const sc = scales[Math.floor(f / 5) % scales.length]
      const rw = Math.max(1, Math.round(OUT_W * sc))
      const rh = Math.max(1, Math.round(OUT_H * sc))
      const jitter = taaMod.haltonJitter(f, rw, rh)
      writeSceneUniforms(rw, rh, staticCam, staticCam, staticBox, staticBox, jitter)
      const enc = device.createCommandEncoder()
      encodeScene(enc, rw, rh)
      taa.resolve(enc, {
        color: colorView,
        depth: depthView,
        velocity: velView,
        renderSize: [rw, rh],
        allocSize: [OUT_W, OUT_H],
        outputSize: [OUT_W, OUT_H],
        jitter,
        sharpness: 0.25,
      })
      device.queue.submit([enc.finish()])

      if (f % 5 === 4) {
        const px = await readRgba16f(taa.texture)
        for (let i = 0; i < px.length; i++) {
          if (!Number.isFinite(px[i])) dynNonFinite++
        }
        const r = rmseTone(px, dynRef)
        if (r > dynWorstRmse) dynWorstRmse = r
      }
    }
    const statsAfterDyn = taa.stats()

    // ── GPU pass timing via timestamp-query (median of 10 runs at 640x360) ───────────────────
    /** @type {number | null} */
    let passGpuMs = null
    if (gpu.canTime) {
      const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
      const resolvedBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const timeReadBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const times = []
      // Warmup
      writeSceneUniforms(RENDER_W, RENDER_H, staticCam, staticCam, staticBox, staticBox, taaMod.haltonJitter(0, RENDER_W, RENDER_H))
      {
        const enc = device.createCommandEncoder()
        encodeScene(enc, RENDER_W, RENDER_H)
        device.queue.submit([enc.finish()])
      }
      for (let i = 0; i < 10; i++) {
        const jitter = taaMod.haltonJitter(i, RENDER_W, RENDER_H)
        const enc = device.createCommandEncoder()
        taa.resolve(
          enc,
          {
            color: colorView,
            depth: depthView,
            velocity: velView,
            renderSize: [RENDER_W, RENDER_H],
            allocSize: [OUT_W, OUT_H],
            outputSize: [OUT_W, OUT_H],
            jitter,
            sharpness: 0.25,
          },
          { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
        )
        enc.resolveQuerySet(querySet, 0, 2, resolvedBuf, 0)
        enc.copyBufferToBuffer(resolvedBuf, 0, timeReadBuf, 0, 16)
        device.queue.submit([enc.finish()])
        await timeReadBuf.mapAsync(GPUMapMode.READ)
        const [t0, t1] = new BigUint64Array(timeReadBuf.getMappedRange().slice(0))
        timeReadBuf.unmap()
        if (t1 > t0) times.push(Number(t1 - t0) / 1e6)
      }
      querySet.destroy()
      resolvedBuf.destroy()
      timeReadBuf.destroy()
      if (times.length) {
        times.sort((a, b) => a - b)
        passGpuMs = times[times.length >> 1]
      }
    }

    await device.queue.onSubmittedWorkDone()

    // Clean teardown
    taa.destroy()
    colorTex.destroy()
    velTex.destroy()
    depthTex.destroy()
    refTex.destroy()
    bilinTex.destroy()
    sceneUbo.destroy()
    bilinUbo.destroy()
    readBuf.destroy()

    return {
      jitterInRange,
      jitterUnique,
      jitterRepeats,
      test1: {
        rmseFrame1,
        rmseFrame16,
        rmseBilin,
        rmseImprovementPct,
        rmseGridFrame1,
        rmseGridFrame16,
        rmseGridBilin,
        gridImprovementPct,
        taaShimmer,
        bilinShimmer,
        shimmerDropPct,
      },
      test2: {
        motionRmseTaa,
        motionRmseBilin,
        motionBoxRmseTaa,
        motionBoxRmseBilin,
        disoccGhostRmse,
        disoccBilinRmse,
        resetRmse,
        resetBilinRmse,
        resetOldBoxRmse,
        resetOldBoxBilinRmse,
        resetMaxBleed,
        noSharpNonFinite,
      },
      test3: {
        hdrStatic,
        hdrSharp,
        hdrMotion,
      },
      test4: {
        statsAfterDyn,
        dynWorstRmse,
        dynNonFinite,
      },
      passGpuMs,
      faults: [...gpu.faults],
    }
  })

  console.log('\nTAA / Spatial-Temporal Upscaler (0.55x 352x198 -> 640x360):')
  check(
    report.jitterInRange && report.jitterUnique && report.jitterRepeats,
    `Halton(2, 3) 16-sample jitter in [-0.5, 0.5] px, 16 unique points, periodic`,
  )

  const t1 = report.test1
  check(
    t1.rmseImprovementPct > 25 && t1.rmseFrame16 < t1.rmseBilin,
    `Test 1 (static convergence): full RMSE ${t1.rmseFrame1.toFixed(4)} -> ${t1.rmseFrame16.toFixed(4)} (-${t1.rmseImprovementPct.toFixed(1)}%, bilinear ${t1.rmseBilin.toFixed(4)}); slanted grid ${t1.rmseGridFrame1.toFixed(4)} -> ${t1.rmseGridFrame16.toFixed(4)} (-${t1.gridImprovementPct.toFixed(1)}%, bilinear ${t1.rmseGridBilin.toFixed(4)})`,
  )
  check(
    t1.shimmerDropPct > 70,
    `Test 1 (shimmer reduction): temporal grid shimmer ${t1.bilinShimmer.toFixed(4)} (bilinear) -> ${t1.taaShimmer.toFixed(4)} (TAA), -${t1.shimmerDropPct.toFixed(1)}%`,
  )

  const t2 = report.test2
  check(
    t2.motionRmseTaa < t2.motionRmseBilin && t2.motionBoxRmseTaa < t2.motionBoxRmseBilin,
    `Test 2 (motion tracking): frame 12 RMSE ${t2.motionRmseTaa.toFixed(4)} vs bilinear ${t2.motionRmseBilin.toFixed(4)}; moving box ${t2.motionBoxRmseTaa.toFixed(4)} vs bilinear ${t2.motionBoxRmseBilin.toFixed(4)}`,
  )
  check(
    t2.disoccGhostRmse < 0.16 && t2.disoccGhostRmse <= t2.disoccBilinRmse + 0.03,
    `Test 2 (disocclusion anti-ghosting): trailing strip RMSE ${t2.disoccGhostRmse.toFixed(4)} (bilinear ${t2.disoccBilinRmse.toFixed(4)})`,
  )
  check(
    t2.resetMaxBleed === 0 && t2.resetRmse <= t2.resetBilinRmse + 0.01 && t2.resetOldBoxRmse <= t2.resetOldBoxBilinRmse + 0.02 && t2.noSharpNonFinite === 0,
    `Test 2 (hard reset & 1-pass bypass): maxBleed=${t2.resetMaxBleed.toFixed(6)}, cut RMSE ${t2.resetRmse.toFixed(4)} (bilin ${t2.resetBilinRmse.toFixed(4)}), old box region ${t2.resetOldBoxRmse.toFixed(4)} (bilin ${t2.resetOldBoxBilinRmse.toFixed(4)}), sharpness=0 nonFinite=${t2.noSharpNonFinite}`,
  )

  const t3 = report.test3
  const hdrAllClean =
    t3.hdrStatic.nans === 0 && t3.hdrStatic.infs === 0 && t3.hdrStatic.negatives === 0 &&
    t3.hdrSharp.nans === 0 && t3.hdrSharp.infs === 0 && t3.hdrSharp.negatives === 0 &&
    t3.hdrMotion.nans === 0 && t3.hdrMotion.infs === 0 && t3.hdrMotion.negatives === 0
  check(
    hdrAllClean,
    `Test 3 (HDR finite/non-negative): 0 NaNs, 0 Infs, 0 negatives across static/sharp/motion`,
  )
  check(
    t3.hdrStatic.maxDot0Lum > 2.5 && t3.hdrStatic.maxDot1Lum > 4.0 &&
    t3.hdrStatic.minRingChan >= 0.205 && t3.hdrSharp.minRingChan >= 0.205,
    `Test 3 (HDR peak & no halo rings): dot0 lum ${t3.hdrStatic.maxDot0Lum.toFixed(2)}, dot1 lum ${t3.hdrStatic.maxDot1Lum.toFixed(2)}, ring min ${t3.hdrStatic.minRingChan.toFixed(3)} / sharp(0.85) ${t3.hdrSharp.minRingChan.toFixed(3)} (bg 0.220)`,
  )

  const t4 = report.test4
  check(
    t4.statsAfterDyn.reallocs === 0 && t4.dynNonFinite === 0 && t4.dynWorstRmse < 0.08,
    `Test 4 (dynamic resolution 0.50x/0.65x/0.85x/0.55x): reallocs=${t4.statsAfterDyn.reallocs}, frames=${t4.statsAfterDyn.frames}, worstRMSE=${t4.dynWorstRmse.toFixed(4)}, nonFinite=${t4.dynNonFinite}`,
  )
  check(
    report.faults.length === 0,
    report.faults.length === 0 ? 'WebGPU device faults: 0' : `WebGPU faults: ${report.faults.join(' | ')}`,
  )
  console.log(`  info pass GPU time (640x360 resolve + RCAS): ${report.passGpuMs !== null ? `${report.passGpuMs.toFixed(3)} ms` : 'timestamp-query unavailable'}`)
} catch (e) {
  failures.push(String(e))
}

await finish('taa')
