// Real headless Chrome WebGPU check of demand-activated GI and glossy GI in engine/page/gi.ts (#226).
//
// A sunlit courtyard the camera looks into, with a field of pillars it cannot see, run on the real
// GPU as the full update and demand-activated from the depth buffer, each on a VoxelGIPass of its own
// that is destroyed before the next is made (the queue drains every 4 frames).
//   - Demand: clear, mark, compact, finalize and the fixed-size worklist run with 0 GPU faults and no
//     device loss. The voxels that trace gather rays are under 25% of all cascade voxels and under
//     half of what the full update gathers for; the visible floor and walls keep the full update's
//     bounce light within 10%.
//   - Timing: timed the way the live page times GI (begin on an earlier pass, `all` end), demand
//     frames skip the end write and keep the device; that range shape lost it on Chrome's Metal backend.
//   - Budget and switches: amortized slices are respected, a small budget is held, no depth source or
//     `demand: false` is the full update, and `setDepthSource()` turns demand on unless
//     `inject({ demand: null })` overrides it.
//   - Glossy: sampleSpecularGI reflects the sunlit red wall more strongly on a smooth surface than a
//     rough one, keeps its colour, follows the view direction, and never returns NaN or Inf.
//
//   node engine/test/gi-demand.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, finish } = await start()

try {
  const page = await open({ size: [800, 600], dpr: 1 })
  const harnessUrl = `${url}/gi-demand-harness.html`
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<!doctype html><meta charset="utf-8"><title>Voxelwright demand GI WebGPU Test</title>',
    }),
  )
  await page.goto(harnessUrl)

  const report = await page.evaluate(async () => {
    /** @type {any} */
    const gpuMod = await import('/probe/gpu.ts')
    /** @type {any} */
    const giMod = await import('/page/gi.ts')

    const gpu = await gpuMod.openGpu()
    const { device } = gpu
    // Every GPU wait races device loss and a labelled timeout, so a lost or stuck device fails by name
    // instead of hanging the run.
    const lost = device.lost.then((info) => {
      throw new Error(`device lost: ${info.reason} ${info.message}`)
    })
    lost.catch(() => {})
    const step = (label, promise, ms = 30_000) => {
      let timer
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${label}`)), ms)
      })
      const lostHere = lost.catch((e) => {
        throw new Error(`${label}: ${e.message}`)
      })
      return Promise.race([promise, lostHere, timeout]).finally(() => clearTimeout(timer))
    }

    const GRID_X = 64
    const GRID_Y = 32
    const GRID_Z = 64
    const VOX = 8 // 8 cells = 0.8 m per Cascade 0 voxel
    const MAX_W = 640
    const MAX_H = 360
    const TEST_W = 640
    const TEST_H = 360
    const FRAMES = 40

    // ── IEEE 754 binary16 <-> float32 helpers ──────────────────────────────
    const f32View = new Float32Array(1)
    const u32View = new Uint32Array(f32View.buffer)
    const f32ToF16 = (val) => {
      f32View[0] = val
      const x = u32View[0]
      const sign = (x >> 16) & 0x8000
      let exp = ((x >> 23) & 0xff) - 127 + 15
      let mant = x & 0x7fffff
      if (exp <= 0) {
        if (exp < -10) return sign
        mant = (mant | 0x800000) >> (1 - exp)
        return sign | ((mant + 0x1000) >> 13)
      }
      if (exp >= 31) return sign | 0x7bff
      return sign | (exp << 10) | ((mant + 0x1000) >> 13)
    }

    const f16ToF32 = (h) => {
      const s = (h & 0x8000) ? -1 : 1
      const e = (h >> 10) & 0x1f
      const f = h & 0x03ff
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024)
      if (e === 31) return f === 0 ? s * Infinity : NaN
      return s * Math.pow(2, e - 15) * (1 + f / 1024)
    }

    const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

    // ── 3D Voxel Scene Builder & GPU Uploader ──────────────────────────────
    function createVoxelScene() {
      const total = GRID_X * GRID_Y * GRID_Z
      const albedo = new Uint8Array(total * 4)
      const emissive = new Uint16Array(total * 4)
      const negOneF16 = f32ToF16(-1.0)
      for (let i = 0; i < total; i++) {
        emissive[i * 4 + 3] = negOneF16
      }

      const set = (x, y, z, r, g, b, op = 1.0, er = 0, eg = 0, eb = 0, sunHint = -1.0) => {
        if (x < 0 || x >= GRID_X || y < 0 || y >= GRID_Y || z < 0 || z >= GRID_Z) return
        const idx = ((z * GRID_Y + y) * GRID_X + x) * 4
        albedo[idx] = Math.round(Math.max(0, Math.min(1, r)) * 255)
        albedo[idx + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
        albedo[idx + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
        albedo[idx + 3] = Math.round(Math.max(0, Math.min(1, op)) * 255)
        emissive[idx] = f32ToF16(er)
        emissive[idx + 1] = f32ToF16(eg)
        emissive[idx + 2] = f32ToF16(eb)
        emissive[idx + 3] = f32ToF16(sunHint)
      }

      const box = (x0, y0, z0, x1, y1, z1, r, g, b, op = 1.0, er = 0, eg = 0, eb = 0, sunHint = -1.0) => {
        for (let z = z0; z <= z1; z++) {
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              set(x, y, z, r, g, b, op, er, eg, eb, sunHint)
            }
          }
        }
      }

      const upload = () => {
        const albedoTex = device.createTexture({
          size: [GRID_X, GRID_Y, GRID_Z],
          dimension: '3d',
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
        const emissiveTex = device.createTexture({
          size: [GRID_X, GRID_Y, GRID_Z],
          dimension: '3d',
          format: 'rgba16float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
        device.queue.writeTexture(
          { texture: albedoTex },
          albedo,
          { bytesPerRow: GRID_X * 4, rowsPerImage: GRID_Y },
          [GRID_X, GRID_Y, GRID_Z],
        )
        device.queue.writeTexture(
          { texture: emissiveTex },
          emissive,
          { bytesPerRow: GRID_X * 8, rowsPerImage: GRID_Y },
          [GRID_X, GRID_Y, GRID_Z],
        )
        return {
          albedoTex,
          emissiveTex,
          source: {
            albedoOpacity: albedoTex.createView({ dimension: '3d' }),
            emissiveSun: emissiveTex.createView({ dimension: '3d' }),
            size: [GRID_X, GRID_Y, GRID_Z],
            originCells: [0, 0, 0],
            voxelCells: VOX,
          },
          destroy() {
            albedoTex.destroy()
            emissiveTex.destroy()
          },
        }
      }

      return { set, box, upload }
    }

    // ── Ray-Traced GPU G-Buffer Generator (exact voxel DDA matching source grid) ──
    const GBUF_WGSL = /* wgsl */ `
struct GbufU {
  renderInfo: vec4f,     // xy: renderSize, zw: 1/renderSize
  camEyeNear: vec4f,     // xyz: eye, w: near
  camFwdFar: vec4f,      // xyz: forward, w: far
  camRightTan: vec4f,    // xyz: right, w: tanHalf
  camUpAspect: vec4f,    // xyz: up, w: aspect
  gridInfo: vec4f,       // xyz: gridSize, w: voxelCells
  prevVp: mat4x4<f32>,   // previous frame viewProjection for exact screen velocity
}

@group(0) @binding(0) var srcAlbedoTex: texture_3d<f32>;
@group(0) @binding(1) var<uniform> u: GbufU;

struct VsOut {
  @builtin(position) pos: vec4f,
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VsOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  return o;
}

struct GbufOut {
  @location(0) normal: vec4f,
  @location(1) vel: vec2f,
  @builtin(frag_depth) depth: f32,
}

@fragment fn fs(@builtin(position) at: vec4f) -> GbufOut {
  let curUV = at.xy * u.renderInfo.zw;
  let sx = (curUV.x * 2.0 - 1.0) * u.camRightTan.w * u.camUpAspect.w;
  let sy = (1.0 - curUV.y * 2.0) * u.camRightTan.w;
  let rayStep = u.camFwdFar.xyz + u.camRightTan.xyz * sx + u.camUpAspect.xyz * sy;
  let rd = normalize(rayStep);
  let rdLen = length(rayStep);

  let vox = u.gridInfo.w;
  let gridI = vec3i(u.gridInfo.xyz);
  let ro = u.camEyeNear.xyz / vox;

  // Clip ray to grid AABB [0, gridSize]
  let axisActive = abs(rd) >= vec3f(1e-6);
  let safeRd = select(select(vec3f(-1e-6), vec3f(1e-6), rd >= vec3f(0.0)), rd, axisActive);
  let invRd = 1.0 / safeRd;
  let t0v = (vec3f(0.0) - ro) * invRd;
  let t1v = (u.gridInfo.xyz - ro) * invRd;
  let tMinV = min(t0v, t1v);
  let tMaxV = max(t0v, t1v);
  let tEnter = max(0.0, max(tMinV.x, max(tMinV.y, tMinV.z)));
  let tExitBox = min(tMaxV.x, min(tMaxV.y, tMaxV.z));

  if (tExitBox <= tEnter) {
    return GbufOut(vec4f(0.0), vec2f(0.0), 1.0);
  }

  let startP = ro + rd * (tEnter + 1e-4);
  var cell = clamp(vec3i(floor(startP)), vec3i(0), gridI - vec3i(1));
  let stepDir = select(vec3i(-1), vec3i(1), rd >= vec3f(0.0));
  let ahead = select(vec3f(0.0), vec3f(1.0), rd >= vec3f(0.0));
  var sideDist = select(vec3f(1e20), (vec3f(cell) + ahead - ro) * invRd, axisActive);
  let deltaDist = select(vec3f(1e20), abs(invRd), axisActive);

  var tHit = tEnter;
  var hitN = vec3f(0.0);
  var hit = false;

  for (var i = 0u; i < 160u; i++) {
    if (any(cell < vec3i(0)) || any(cell >= gridI)) { break; }
    if (textureLoad(srcAlbedoTex, cell, 0).a >= 0.5) {
      hit = true;
      break;
    }
    if (sideDist.x <= sideDist.y && sideDist.x <= sideDist.z) {
      tHit = sideDist.x;
      sideDist.x += deltaDist.x;
      cell.x += stepDir.x;
      hitN = vec3f(-f32(stepDir.x), 0.0, 0.0);
    } else if (sideDist.y <= sideDist.z) {
      tHit = sideDist.y;
      sideDist.y += deltaDist.y;
      cell.y += stepDir.y;
      hitN = vec3f(0.0, -f32(stepDir.y), 0.0);
    } else {
      tHit = sideDist.z;
      sideDist.z += deltaDist.z;
      cell.z += stepDir.z;
      hitN = vec3f(0.0, 0.0, -f32(stepDir.z));
    }
  }

  if (!hit || dot(hitN, hitN) < 0.5) {
    return GbufOut(vec4f(0.0), vec2f(0.0), 1.0);
  }

  let hitCells = tHit * vox;
  let linZ = hitCells / rdLen;
  let nearD = u.camEyeNear.w;
  let farD = u.camFwdFar.w;
  let depth = clamp((farD / (farD - nearD)) * (1.0 - nearD / max(linZ, nearD)), 0.0, 0.9999);

  let worldPos = u.camEyeNear.xyz + rd * hitCells;
  let prevClip = u.prevVp * vec4f(worldPos, 1.0);
  var vel = vec2f(0.0);
  if (prevClip.w > 1e-4) {
    let prevNdc = prevClip.xy / prevClip.w;
    let prevUV = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
    vel = prevUV - curUV;
  }

  return GbufOut(vec4f(hitN, 1.0), vel, depth);
}
`

    const gbufMod = await gpuMod.shader(device, 'gi-test-gbuf', GBUF_WGSL)
    const gbufLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    const gbufPipe = await device.createRenderPipelineAsync({
      label: 'gi-test-gbuf',
      layout: device.createPipelineLayout({ bindGroupLayouts: [gbufLayout] }),
      vertex: { module: gbufMod, entryPoint: 'vs' },
      fragment: {
        module: gbufMod,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }, { format: 'rg16float' }],
      },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
    })

    const gbufUbo = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const gbufRaw = new ArrayBuffer(160)
    const gbufF32 = new Float32Array(gbufRaw)

    const depthTex = device.createTexture({
      size: [MAX_W, MAX_H],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const normalTex = device.createTexture({
      size: [MAX_W, MAX_H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    const velTex = device.createTexture({
      size: [MAX_W, MAX_H],
      format: 'rg16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const depthView = depthTex.createView()
    const normalView = normalTex.createView()
    const velView = velTex.createView()

    function renderGBuffer(encoder, scene, cam, prevCam, w, h) {
      const aspect = w / h
      const prevVp = gpuMod.viewProjection(prevCam, aspect, gpuMod.NEAR, gpuMod.FAR)
      gbufF32[0] = w
      gbufF32[1] = h
      gbufF32[2] = 1 / w
      gbufF32[3] = 1 / h
      gbufF32[4] = cam.eye[0]
      gbufF32[5] = cam.eye[1]
      gbufF32[6] = cam.eye[2]
      gbufF32[7] = gpuMod.NEAR
      gbufF32[8] = cam.forward[0]
      gbufF32[9] = cam.forward[1]
      gbufF32[10] = cam.forward[2]
      gbufF32[11] = gpuMod.FAR
      gbufF32[12] = cam.right[0]
      gbufF32[13] = cam.right[1]
      gbufF32[14] = cam.right[2]
      gbufF32[15] = cam.tanHalf
      gbufF32[16] = cam.up[0]
      gbufF32[17] = cam.up[1]
      gbufF32[18] = cam.up[2]
      gbufF32[19] = aspect
      gbufF32[20] = GRID_X
      gbufF32[21] = GRID_Y
      gbufF32[22] = GRID_Z
      gbufF32[23] = VOX
      gbufF32.set(prevVp, 24)
      device.queue.writeBuffer(gbufUbo, 0, gbufRaw)

      const bg = device.createBindGroup({
        layout: gbufLayout,
        entries: [
          { binding: 0, resource: scene.source.albedoOpacity },
          { binding: 1, resource: { buffer: gbufUbo } },
        ],
      })
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: normalView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
          { view: velView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' },
        ],
        depthStencilAttachment: { view: depthView, depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, w, h, 0, 1)
      pass.setScissorRect(0, 0, w, h)
      pass.setPipeline(gbufPipe)
      pass.setBindGroup(0, bg)
      pass.draw(3)
      pass.end()
    }

    async function readRgba16f2D(tex, w, h) {
      const bytesPerRow = Math.ceil((w * 8) / 256) * 256
      const buf = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [w, h, 1])
      device.queue.submit([enc.finish()])
      await step('read rgba16f', buf.mapAsync(GPUMapMode.READ))
      const u16 = new Uint16Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      const stride = bytesPerRow / 2
      const out = new Float32Array(w * h * 4)
      let nonFinite = 0
      let negatives = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const src = y * stride + x * 4
          const dst = (y * w + x) * 4
          for (let c = 0; c < 4; c++) {
            const v = f16ToF32(u16[src + c])
            out[dst + c] = v
            if (!Number.isFinite(v)) nonFinite++
            else if (c < 3 && v < -1e-5) negatives++
          }
        }
      }
      return { data: out, nonFinite, negatives }
    }


    // ── The scene: a courtyard in view, and a lot of surface that is not ────
    // Courtyard: floor y=5, air x=23..41, z=21..41, open to the sky. A red wall (x=22) stands in the
    // sun; the white wall opposite (x=42) is in shade and lit only by what bounces. All round it,
    // behind the walls and behind the camera, stand pillars no pixel shows.
    function buildCourtyard() {
      const s = createVoxelScene()
      s.box(1, 5, 1, 62, 5, 62, 0.55, 0.55, 0.55) // ground
      s.box(22, 6, 20, 22, 14, 42, 0.88, 0.04, 0.04) // red wall, faces +X into the sun
      s.box(42, 6, 20, 42, 14, 42, 0.86, 0.86, 0.86) // white wall, faces -X, shaded
      s.box(22, 6, 20, 42, 14, 20, 0.86, 0.86, 0.86) // back wall, faces +Z toward the camera
      s.box(22, 6, 42, 42, 14, 42, 0.86, 0.86, 0.86) // wall behind the camera
      for (let z = 2; z <= 60; z += 3) {
        for (let x = 2; x <= 60; x += 3) {
          if (x >= 19 && x <= 45 && z >= 17 && z <= 45) continue
          s.box(x, 6, z, x, 6 + ((x * 7 + z * 13) % 9), z, 0.7, 0.66, 0.6)
        }
      }
      return s.upload()
    }

    const scene = buildCourtyard()
    const cam = gpuMod.camera([32 * VOX, 9.5 * VOX, 40.5 * VOX], [32 * VOX, 8.5 * VOX, 20 * VOX], 66)
    const camera = { ...cam, aspect: TEST_W / TEST_H }
    const sunDir = [1, 1.2, 0.2]
    const sunIrradiance = [4.0, 3.8, 3.4]
    const sky = { zenith: [0.21, 0.36, 0.67], horizon: [0.42, 0.47, 0.57], ground: [0.09, 0.08, 0.07], sunGlow: 0 }

    /**
     * Runs `frames` frames of inject + trace on a fresh pass; `demand` picks the path. `probe(gi)` runs
     * before the pass is destroyed, so only one pass's cascades are ever alive at once. `viaSetter`
     * hands the depth through `setDepthSource()` and passes `demand: null` on inject when `demand` is false.
     */
    async function run({ name, demand, frames = FRAMES, amortizeStride = 1, options = {}, timed = false, probe = null, viaSetter = false }) {
      console.warn(`gi-demand: run ${name}`)
      const gi = await step(`${name}: createVoxelGI`, giMod.createVoxelGI(device, {
        maxSize: [MAX_W, MAX_H],
        cascadeSize: [GRID_X, GRID_Y, GRID_Z],
        cascadeVoxelCells: [8, 32, 128],
        ...options,
      }))
      const depthSource = { depth: depthView, renderSize: [TEST_W, TEST_H], camera }
      if (viaSetter) gi.setDepthSource(depthSource)
      const canTime = timed && gpu.canTime
      const querySet = canTime ? device.createQuerySet({ type: 'timestamp', count: 2 }) : null
      const resolved = canTime ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null
      const times = []
      let endsWritten = 0
      let endsRead = 0
      for (let f = 0; f < frames; f++) {
        const enc = device.createCommandEncoder()
        renderGBuffer(enc, scene, cam, cam, TEST_W, TEST_H)
        // Timed the way the live page times GI: the range begins on an earlier pass of the caller's.
        if (querySet) enc.beginComputePass({ label: 'gi-demand-test-begin', timestampWrites: { querySet, beginningOfPassWriteIndex: 0 } }).end()
        gi.inject(
          enc,
          {
            cameraPosCells: cam.eye,
            source: scene.source,
            sunDir,
            sunIrradiance,
            sky,
            amortizeStride,
            reset: f === 0,
            demand: viaSetter ? (demand ? undefined : null) : demand ? depthSource : undefined,
          },
          querySet ? { all: { querySet, endOfPassWriteIndex: 1 } } : undefined,
        )
        gi.traceAndDenoise(enc, {
          depth: depthView,
          normal: normalView,
          velocity: velView,
          renderSize: [TEST_W, TEST_H],
          allocSize: [MAX_W, MAX_H],
          camera,
          sunDir,
          sky,
          spp: 1,
          atrousPasses: 3,
          reset: f === 0,
        })
        if (querySet && resolved) enc.resolveQuerySet(querySet, 0, 2, resolved, 0)
        device.queue.submit([enc.finish()])
        // Never let more than a few frames of GI work pile up in the queue.
        if (f % 4 === 3) await step(`${name}: frame ${f}`, device.queue.onSubmittedWorkDone())
        if (querySet && resolved && f >= frames - 12) {
          const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
          const copy = device.createCommandEncoder()
          copy.copyBufferToBuffer(resolved, 0, read, 0, 16)
          device.queue.submit([copy.finish()])
          await step(`${name}: timestamps ${f}`, read.mapAsync(GPUMapMode.READ))
          const ts = new BigUint64Array(read.getMappedRange().slice(0))
          read.unmap()
          read.destroy()
          // An end written this frame lands after this frame's begin; a skipped one is 0 or an old value.
          endsRead++
          if (ts[1] > ts[0]) {
            endsWritten++
            times.push(Number(ts[1] - ts[0]) / 1e6)
          }
        }
      }
      const demandStats = await step(`${name}: readDemandStats`, gi.readDemandStats())
      const out = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
      const probed = probe ? await step(`${name}: probe`, probe(gi)) : null
      times.sort((a, b) => a - b)
      await step(`${name}: drain`, device.queue.onSubmittedWorkDone())
      querySet?.destroy()
      resolved?.destroy()
      gi.destroy()
      return { out, demandStats, probed, endsWritten, endsRead, injectMs: times.length ? times[times.length >> 1] : null }
    }

    /** Mean GI of every pixel whose normal is `n`. */
    function meanByNormal(data, normals, n) {
      let r = 0, g = 0, b = 0, count = 0
      for (let i = 0; i < TEST_W * TEST_H * 4; i += 4) {
        if (normals[i] * n[0] + normals[i + 1] * n[1] + normals[i + 2] * n[2] < 0.9) continue
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        count++
      }
      return count ? { r: r / count, g: g / count, b: b / count, lum: luma(r, g, b) / count, count } : { r: 0, g: 0, b: 0, lum: 0, count: 0 }
    }

    // ── sampleSpecularGI, probed on the demand-activated cache ─────────────
    const CASES = [
      // pos (cells), roughness, normal, view (surface -> eye), noise
      // 0, 1: a floor point 3 voxels from the red wall, mirror direction into the wall: smooth, rough.
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.08, n: [0, 1, 0], v: [1, 0.35, 0], noise: [0.5, 0.5] },
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.85, n: [0, 1, 0], v: [1, 0.35, 0], noise: [0.5, 0.5] },
      // 2: the same smooth point seen from the other side: mirror direction away from the red wall.
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.08, n: [0, 1, 0], v: [-1, 0.35, 0], noise: [0.5, 0.5] },
      // 3..: inputs a shader will meet at its edges.
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0, n: [0, 1, 0], v: [1, 0.35, 0], noise: [0, 0] },
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 1, n: [0, 1, 0], v: [1, 0.35, 0], noise: [0.999, 0.999] },
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.3, n: [0, 1, 0], v: [0.5, -1, 0.2], noise: [0.25, 0.75] },
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.3, n: [0, 1, 0], v: [0, 0, 0], noise: [0.5, 0.5] },
      { pos: [26 * VOX, 6 * VOX, 31 * VOX], rough: 0.3, n: [0, 0, 0], v: [1, 0.35, 0], noise: [0.5, 0.5] },
      { pos: [1e6, 1e6, 1e6], rough: 0.3, n: [0, 1, 0], v: [1, 0.35, 0], noise: [0.5, 0.5] },
      { pos: [32 * VOX, 6 * VOX, 31 * VOX], rough: 0.5, n: [0, 1, 0], v: [0, 1, 0], noise: [0.1, 0.9] },
    ]
    const specMod = await gpuMod.shader(device, 'gi-demand-test-specular', /* wgsl */ `
${giMod.giSpecularBindings(0, 0)}
${giMod.GI_SPECULAR_WGSL}
struct ProbeCase { posRough: vec4f, normal: vec4f, view: vec4f, noise: vec4f }
@group(1) @binding(0) var<storage, read> cases: array<ProbeCase>;
@group(1) @binding(1) var<storage, read_write> results: array<vec4f>;
@compute @workgroup_size(1)
fn probe(@builtin(global_invocation_id) gid: vec3u) {
  let c = cases[gid.x];
  results[gid.x] = sampleSpecularGI(c.posRough.xyz, c.normal.xyz, c.view.xyz, c.posRough.w, vec3f(0.04), c.noise.xy);
}
`)
    const specPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: specMod, entryPoint: 'probe' } })
    const caseData = new Float32Array(CASES.length * 16)
    CASES.forEach((c, i) => {
      caseData.set([...c.pos, c.rough], i * 16)
      caseData.set(c.n, i * 16 + 4)
      caseData.set(c.v, i * 16 + 8)
      caseData.set(c.noise, i * 16 + 12)
    })
    const caseBuf = device.createBuffer({ size: caseData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(caseBuf, 0, caseData)
    const resultBuf = device.createBuffer({ size: CASES.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const resultRead = device.createBuffer({ size: CASES.length * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    async function probeSpecular(gi) {
      const views = gi.cascadeViews
      const specEnc = device.createCommandEncoder()
      const specPass = specEnc.beginComputePass()
      specPass.setPipeline(specPipe)
      specPass.setBindGroup(0, device.createBindGroup({
        layout: specPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: views[0] },
          { binding: 1, resource: views[1] },
          { binding: 2, resource: views[2] },
          { binding: 3, resource: gi.cascadeSampler },
          { binding: 4, resource: { buffer: gi.specularParams } },
        ],
      }))
      specPass.setBindGroup(1, device.createBindGroup({
        layout: specPipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: caseBuf } },
          { binding: 1, resource: { buffer: resultBuf } },
        ],
      }))
      specPass.dispatchWorkgroups(CASES.length)
      specPass.end()
      specEnc.copyBufferToBuffer(resultBuf, 0, resultRead, 0, CASES.length * 16)
      device.queue.submit([specEnc.finish()])
      await step('specular read', resultRead.mapAsync(GPUMapMode.READ))
      const specular = Array.from(new Float32Array(resultRead.getMappedRange().slice(0)))
      resultRead.unmap()
      for (const b of [caseBuf, resultBuf, resultRead]) b.destroy()
      return specular
    }

    // ── Full update against demand activation, same frames ────────────────
    const full = await run({ name: 'full', demand: false, timed: true })
    const dem = await run({ name: 'demand', demand: true, timed: true, probe: probeSpecular })
    const specular = dem.probed
    const normals = (await readRgba16f2D(normalTex, TEST_W, TEST_H)).data
    const regions = {}
    for (const [name, n] of [['floor', [0, 1, 0]], ['shadedWall', [-1, 0, 0]], ['sunlitWall', [1, 0, 0]], ['backWall', [0, 0, 1]]]) {
      regions[name] = { full: meanByNormal(full.out.data, normals, n), demand: meanByNormal(dem.out.data, normals, n) }
    }

    // ── Amortized slices, a small budget, and no depth at all ─────────────
    const sliced = await run({ name: 'sliced', demand: true, frames: 16, amortizeStride: 4 })
    const tight = await run({ name: 'budget', demand: true, frames: 16, options: { maxActiveCells: 256 } })
    const off = await run({ name: 'off', demand: true, frames: 4, options: { demand: false } })
    const setter = await run({ name: 'setter', demand: true, frames: 6, viaSetter: true })
    const nulled = await run({ name: 'null', demand: false, frames: 6, viaSetter: true })
    const forcedFull = { demandInjects: full.demandStats.demandInjects, lastInjectDemand: full.demandStats.lastInjectDemand }

    await step('final drain', device.queue.onSubmittedWorkDone())
    scene.destroy()

    return {
      regions,
      fullStats: full.demandStats,
      demandStats: dem.demandStats,
      slicedStats: sliced.demandStats,
      tightStats: tight.demandStats,
      offStats: off.demandStats,
      setterStats: setter.demandStats,
      nulledStats: nulled.demandStats,
      forcedFull,
      nonFinite: full.out.nonFinite + dem.out.nonFinite + sliced.out.nonFinite + tight.out.nonFinite,
      negatives: full.out.negatives + dem.out.negatives + sliced.out.negatives + tight.out.negatives,
      injectMs: full.injectMs,
      ends: { full: [full.endsWritten, full.endsRead], demand: [dem.endsWritten, dem.endsRead] },
      specular,
      faults: [...gpu.faults],
    }
  })

  console.log('\nDemand-activated GI and glossy GI (#226):')
  const pct = (x) => `${(x * 100).toFixed(1)}%`
  const d = report.demandStats

  check(
    report.faults.length === 0,
    report.faults.length === 0 ? 'WebGPU validation faults and device loss: 0 (clear, mark, compact, finalize, worklist, glossy probe; 7 VoxelGIPasses made and destroyed in turn)' : `WebGPU faults: ${report.faults.join(' | ')}`,
  )
  check(
    d.lastInjectDemand && d.demandInjects > 0 && d.activeCells > 0 && d.visibleCells > 0,
    `demand ran: ${d.demandInjects} injects, ${d.activeCells} voxels traced gather rays (${d.visibleCells} visible, ${d.backgroundCells} background; per cascade ${d.activeCellsPerCascade.join('/')})`,
  )
  check(
    d.activeCells < 0.25 * d.totalCells,
    `active voxels ${d.activeCells} < 25% of all ${d.totalCells} cascade voxels (${pct(d.activeCells / d.totalCells)})`,
  )
  check(
    d.activeCells < 0.5 * d.fullUpdateCells,
    `active voxels ${d.activeCells} < 50% of the ${d.fullUpdateCells} a full update gathers for (${pct(d.activeCells / Math.max(1, d.fullUpdateCells))})`,
  )
  for (const [name, r] of Object.entries(report.regions)) {
    const rel = Math.abs(r.demand.lum - r.full.lum) / Math.max(r.full.lum, 1e-6)
    check(
      r.full.count > 500 && r.full.lum > 1e-3 && rel < 0.1,
      `${name} bounce light matches the full update within 10%: full ${r.full.lum.toFixed(4)}, demand ${r.demand.lum.toFixed(4)} (${pct(rel)} apart, ${r.full.count} px)`,
    )
  }
  const shaded = report.regions.shadedWall.demand
  check(
    shaded.r > 1.15 * shaded.g,
    `shaded white wall carries the red wall's bounce under demand: r/g ${(shaded.r / Math.max(shaded.g, 1e-6)).toFixed(2)}`,
  )
  check(
    report.nonFinite === 0 && report.negatives === 0,
    `GI output finite and non-negative: ${report.nonFinite} non-finite, ${report.negatives} negative`,
  )
  const s = report.slicedStats
  check(
    s.activeCells > 0 && s.activeCells < 0.5 * s.fullUpdateCells,
    `with amortizeStride 4, demand stays inside the due slices: ${s.activeCells} active of ${s.fullUpdateCells} due`,
  )
  const t = report.tightStats
  check(
    t.activeCells > 0 && t.activeCells <= t.budget && t.wantedCells > t.budget,
    `a budget of ${t.budget} is held: ${t.activeCells} active of ${t.wantedCells} wanting rays`,
  )
  check(
    !report.forcedFull.lastInjectDemand && report.forcedFull.demandInjects === 0 && report.offStats.demandInjects === 0 && !report.offStats.enabled,
    'no depth source, or demand: false, is the full update',
  )
  check(
    report.setterStats.demandInjects > 0 && report.setterStats.lastInjectDemand && report.nulledStats.demandInjects === 0 && !report.nulledStats.lastInjectDemand,
    `setDepthSource() turns demand on (${report.setterStats.demandInjects} demand injects); inject({ demand: null }) overrides it with the full update (${report.nulledStats.demandInjects})`,
  )

  const sp = (i) => report.specular.slice(i * 4, i * 4 + 4)
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const [smooth, rough, away] = [sp(0), sp(1), sp(2)]
  check(
    report.specular.every((v) => Number.isFinite(v) && v >= 0),
    `sampleSpecularGI finite and non-negative over ${report.specular.length / 4} cases (roughness 0 and 1, view below the surface, zero vectors, outside every cascade)`,
  )
  check(
    lum(smooth) > 1.5 * lum(rough) && lum(rough) > 0,
    `smooth (0.08) reflects the sunlit wall more strongly than rough (0.85): ${lum(smooth).toFixed(4)} vs ${lum(rough).toFixed(4)}`,
  )
  check(
    smooth[0] > 3 * smooth[1],
    `the smooth reflection keeps the red wall's colour: rgb ${smooth.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}`,
  )
  // Seen from the other side, the mirror direction points at the shaded white wall and the sky: the
  // red wall's tint (low in luma, so compare colour, not brightness) must go with it.
  const redness = (c) => c[0] / Math.max(c[1], 1e-6)
  check(
    redness(smooth) > 2 * redness(away) && smooth[0] > 1.5 * away[0],
    `the smooth reflection follows the view: toward the red wall rgb ${smooth.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}, away rgb ${away.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}`,
  )
  if (report.ends.full[1] > 0) {
    // The guard in inject(): on demand frames the range's end is not written after the demand passes.
    check(
      report.ends.full[0] === report.ends.full[1] && report.ends.demand[0] === 0 && report.ends.demand[1] > 0,
      `timed like the live page (begin on an earlier pass, \`all\` end): the full update wrote ${report.ends.full[0]}/${report.ends.full[1]} ends, demand frames skipped theirs (${report.ends.demand[0]}/${report.ends.demand[1]} written) and kept the device`,
    )
  }
  if (report.injectMs !== null) console.log(`  info GPU ms from the caller's begin to the end of the full update's mips (median of 12, shared GPU): ${report.injectMs.toFixed(3)}`)
} catch (e) {
  check(false, `gi-demand threw: ${e?.stack ?? e}`)
  // A lost GPU can leave the browser unable to close: never let that hang the run.
  setTimeout(() => {
    console.error('FAILED (the browser did not close after the failure)')
    process.exit(1)
  }, 30_000)
}

await finish('gi-demand')
