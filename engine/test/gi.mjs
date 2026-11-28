// Real headless Chrome WebGPU verification for engine/page/gi.ts (#165 — Moonshot 3A).
//
// Builds real 3D voxel worlds (Cornell Box room, sunlit SF street alley, sealed vs broken-roof
// interior room) and ray-traced GPU G-Buffers (depth24plus, rgba16float world normals,
// rg16float analytic velocity), running all 4 GI compute passes on the real GPU:
//   - Test 1: Cornell-Box color bleeding (red & green wall indirect bleed in both Mode 0
//             Stochastic+SVGF and Mode 1 5-Cone VCT) + sunlit SF alley terracotta bounce.
//   - Test 2: Sealed dark room (zero light leak through 1-voxel solid walls/roof under bright
//             noon sun + sky) vs broken-roof skylight room (>5x interior floor daylight gain).
//   - Test 3: 16-frame 1-spp SVGF noise variance reduction (>70%), 90-degree wall-floor crease
//             edge preservation, camera pan velocity reprojection, and hard reset cleanliness.
//   - Test 4: 20-iteration multi-bounce energy conservation & convergence, dynamic resolution
//             0.50x/0.75x/1.0x with 0 reallocs & 0 GPU faults, GI_WGSL GPU execution probe,
//             and timestamp-query GPU timing breakdown at 640x360 and 1280x720.
//
//   node engine/test/gi.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [800, 600], dpr: 1 })
  const harnessUrl = `${url}/gi-harness.html`
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<!doctype html><meta charset="utf-8"><title>Voxelwright Voxel GI + SVGF WebGPU Test</title>',
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

    const GRID_X = 64
    const GRID_Y = 32
    const GRID_Z = 64
    const VOX = 8 // 8 cells = 0.8 m per Cascade 0 voxel
    const MAX_W = 1280
    const MAX_H = 720
    const TEST_W = 640
    const TEST_H = 360

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

    // Build Scene A: Classic Cornell Box (interior air x=26..37, y=6..13, z=26..37 -> 9.6m x 6.4m x 9.6m)
    function buildCornellBox() {
      const s = createVoxelScene()
      // Solid 1-voxel outer shell: white floor, ceiling, back wall (z=25), front wall (z=38)
      s.box(25, 5, 25, 38, 5, 38, 0.85, 0.85, 0.85) // floor
      s.box(25, 14, 25, 38, 14, 38, 0.85, 0.85, 0.85) // ceiling
      s.box(25, 6, 25, 38, 13, 25, 0.85, 0.85, 0.85) // back wall (faces +Z toward camera)
      s.box(25, 6, 38, 38, 13, 38, 0.85, 0.85, 0.85) // front wall (behind camera)
      // Vivid RED left wall (x=25) & vivid GREEN right wall (x=38)
      s.box(25, 6, 26, 25, 13, 37, 0.88, 0.04, 0.04)
      s.box(38, 6, 26, 38, 13, 37, 0.04, 0.88, 0.04)
      // Bright emissive ceiling fixture (2x2 centered symmetrically at x=31..32, z=31..32 on ceiling y=14)
      s.box(31, 14, 31, 32, 14, 32, 0.85, 0.85, 0.85, 1.0, 26.0, 26.0, 26.0)
      return s.upload()
    }

    // Build Scene B: Sunlit SF Street Alley (sunlit terracotta building facing shaded white stucco wall)
    function buildSunlitAlley() {
      const s = createVoxelScene()
      // Dark asphalt street floor (y=5)
      s.box(16, 5, 16, 48, 5, 48, 0.25, 0.26, 0.28)
      // Sunlit terracotta/red SF building wall on left (x=26, faces +X toward sun!)
      s.box(25, 6, 18, 26, 22, 46, 0.88, 0.14, 0.06)
      // Shaded white stucco building wall on right (x=36, faces -X away from sun!)
      s.box(36, 6, 18, 37, 22, 46, 0.86, 0.86, 0.86)
      return s.upload()
    }

    // Build Scene C: Sealed Room vs Broken Roof Room (1-voxel solid walls & roof, zero emissives)
    function buildRoofRoom(openHole) {
      const s = createVoxelScene()
      s.box(25, 5, 25, 38, 5, 38, 0.82, 0.82, 0.82) // floor
      s.box(25, 16, 25, 38, 16, 38, 0.82, 0.82, 0.82) // roof (1 voxel thick)
      s.box(25, 6, 25, 38, 15, 25, 0.82, 0.82, 0.82) // back wall
      s.box(25, 6, 38, 38, 15, 38, 0.82, 0.82, 0.82) // front wall
      s.box(25, 6, 26, 25, 15, 37, 0.82, 0.82, 0.82) // left wall
      s.box(38, 6, 26, 38, 15, 37, 0.82, 0.82, 0.82) // right wall
      if (openHole) {
        // Punch a 4x4 skylight hole right through the 1-voxel roof
        s.box(30, 16, 28, 33, 16, 31, 0, 0, 0, 0.0)
      }
      return s.upload()
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
      await buf.mapAsync(GPUMapMode.READ)
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

    async function readCascadeMip0(tex) {
      const bytesPerRow = Math.ceil((GRID_X * 8) / 256) * 256
      const buf = device.createBuffer({
        size: bytesPerRow * GRID_Y * GRID_Z,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex, mipLevel: 0 }, { buffer: buf, bytesPerRow, rowsPerImage: GRID_Y }, [GRID_X, GRID_Y, GRID_Z])
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      const rowStride = bytesPerRow / 2
      const sliceStride = rowStride * GRID_Y
      let sumLum = 0
      let solidCount = 0
      let maxLum = 0
      let nonFinite = 0
      let negatives = 0
      for (let z = 0; z < GRID_Z; z++) {
        for (let y = 0; y < GRID_Y; y++) {
          for (let x = 0; x < GRID_X; x++) {
            const src = z * sliceStride + y * rowStride + x * 4
            const r = f16ToF32(u16[src])
            const g = f16ToF32(u16[src + 1])
            const b = f16ToF32(u16[src + 2])
            const a = f16ToF32(u16[src + 3])
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
              nonFinite++
              continue
            }
            if (r < -1e-5 || g < -1e-5 || b < -1e-5 || a < -1e-5) negatives++
            if (a > 0.5) {
              const lum = luma(r, g, b)
              sumLum += lum
              solidCount++
              if (lum > maxLum) maxLum = lum
            }
          }
        }
      }
      return { meanLum: solidCount > 0 ? sumLum / solidCount : 0, maxLum, solidCount, nonFinite, negatives }
    }

    function regionMeanRgb(data, normals, w, h, x0, y0, x1, y1, filterNormal) {
      let r = 0, g = 0, b = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          if (filterNormal) {
            const dot = normals[i] * filterNormal[0] + normals[i + 1] * filterNormal[1] + normals[i + 2] * filterNormal[2]
            if (dot < 0.9) continue
          }
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      return n > 0 ? { r: r / n, g: g / n, b: b / n, count: n } : { r: 0, g: 0, b: 0, count: 0 }
    }

    // High-frequency spatial noise variance estimator (horizontal+vertical first-difference variance / 2):
    // invariant to smooth indirect lighting gradients while accurately measuring Monte Carlo pixel noise.
    function spatialNoiseVariance(data, normals, w, h, x0, y0, x1, y1, filterNormal) {
      let sumSq = 0
      let count = 0
      for (let y = y0; y < y1 - 1; y++) {
        for (let x = x0; x < x1 - 1; x++) {
          const i = (y * w + x) * 4
          const ir = (y * w + (x + 1)) * 4
          const id = ((y + 1) * w + x) * 4
          if (filterNormal) {
            const d0 = normals[i] * filterNormal[0] + normals[i + 1] * filterNormal[1] + normals[i + 2] * filterNormal[2]
            const d1 = normals[ir] * filterNormal[0] + normals[ir + 1] * filterNormal[1] + normals[ir + 2] * filterNormal[2]
            const d2 = normals[id] * filterNormal[0] + normals[id + 1] * filterNormal[1] + normals[id + 2] * filterNormal[2]
            if (d0 < 0.9 || d1 < 0.9 || d2 < 0.9) continue
          }
          const l0 = luma(data[i], data[i + 1], data[i + 2])
          const lr = luma(data[ir], data[ir + 1], data[ir + 2])
          const ld = luma(data[id], data[id + 1], data[id + 2])
          const dx = lr - l0
          const dy = ld - l0
          sumSq += 0.25 * (dx * dx + dy * dy)
          count++
        }
      }
      return count > 0 ? sumSq / count : 0
    }

    const gi = await giMod.createVoxelGI(device, {
      maxSize: [MAX_W, MAX_H],
      cascadeSize: [GRID_X, GRID_Y, GRID_Z],
      cascadeVoxelCells: [8, 32, 128],
      bounceFeedback: 0.65,
      atrousPasses: 3,
    })

    const cornellCam = gpuMod.camera([32 * VOX, 9.5 * VOX, 36.8 * VOX], [32 * VOX, 8.9 * VOX, 25 * VOX], 66)
    const zeroSky = { zenith: [0, 0, 0], horizon: [0, 0, 0], ground: [0, 0, 0], sunGlow: 0 }
    const daySky = { zenith: [0.42, 0.72, 1.35], horizon: [0.85, 0.94, 1.15], ground: [0.18, 0.16, 0.14], sunGlow: 0.35 }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 1: Cornell-Box Color Bleeding (Stochastic+SVGF & 5-Cone VCT) + SF Alley
    // ════════════════════════════════════════════════════════════════════════
    const cornellScene = buildCornellBox()
    gi.reset()

    // Inject 10 iterations so multi-bounce color bleeding reaches steady state
    for (let i = 0; i < 10; i++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: cornellScene.source,
        sunDir: [0, 1, 0],
        sunIrradiance: [0, 0, 0],
        sky: zeroSky,
        reset: i === 0,
      })
      device.queue.submit([enc.finish()])
    }

    // Run 16 frames of 1-spp Stochastic GI + SVGF (also reused for Test 3!)
    // Read frame 15 with atrousPasses=0 (pure 15-frame temporal baseline) and frame 16 with atrousPasses=3 (full SVGF).
    let cornellTemp = null
    for (let f = 0; f < 16; f++) {
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, cornellScene, cornellCam, cornellCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...cornellCam, aspect: TEST_W / TEST_H },
        sunDir: [0, 1, 0],
        sky: zeroSky,
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        atrousPasses: f === 14 ? 0 : 3,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
      if (f === 14) {
        cornellTemp = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
      }
    }

    const cornellNorm = await readRgba16f2D(normalTex, TEST_W, TEST_H)
    const cornellDenoised = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    const cornellRaw = await readRgba16f2D(gi.rawGiTexture, TEST_W, TEST_H)

    // Locate exact horizontal extents of white back wall (normal +Z) and white floor (normal +Y)
    let backMinX = TEST_W, backMaxX = 0, backMinY = TEST_H, backMaxY = 0
    for (let y = 0; y < TEST_H; y++) {
      for (let x = 0; x < TEST_W; x++) {
        const i = (y * TEST_W + x) * 4
        if (cornellNorm.data[i + 2] > 0.9) {
          if (x < backMinX) backMinX = x
          if (x > backMaxX) backMaxX = x
          if (y < backMinY) backMinY = y
          if (y > backMaxY) backMaxY = y
        }
      }
    }
    const bwSpan = Math.max(1, backMaxX - backMinX)
    const backNearRed = regionMeanRgb(
      cornellDenoised.data, cornellNorm.data, TEST_W, TEST_H,
      backMinX + 4, backMinY + Math.round((backMaxY - backMinY) * 0.25),
      backMinX + Math.round(bwSpan * 0.16), backMaxY - 8,
      [0, 0, 1],
    )
    const backNearGreen = regionMeanRgb(
      cornellDenoised.data, cornellNorm.data, TEST_W, TEST_H,
      backMaxX - Math.round(bwSpan * 0.16), backMinY + Math.round((backMaxY - backMinY) * 0.25),
      backMaxX - 4, backMaxY - 8,
      [0, 0, 1],
    )
    const backCenter = regionMeanRgb(
      cornellDenoised.data, cornellNorm.data, TEST_W, TEST_H,
      Math.round((backMinX + backMaxX) * 0.5 - bwSpan * 0.08), backMinY + Math.round((backMaxY - backMinY) * 0.3),
      Math.round((backMinX + backMaxX) * 0.5 + bwSpan * 0.08), backMaxY - 8,
      [0, 0, 1],
    )
    // Measure floor strips hugging the actual perspective left (red) and right (green) wall boundaries.
    const sampleFloorWallEdge = (side) => {
      let r = 0, g = 0, b = 0, n = 0
      const yStart = backMaxY + 4
      const yEnd = Math.min(TEST_H - 8, backMaxY + 60)
      for (let y = yStart; y < yEnd; y++) {
        let fxMin = TEST_W, fxMax = -1
        for (let x = 0; x < TEST_W; x++) {
          const i = (y * TEST_W + x) * 4
          if (cornellNorm.data[i + 1] > 0.9) {
            if (x < fxMin) fxMin = x
            if (x > fxMax) fxMax = x
          }
        }
        if (fxMax - fxMin < 40) continue
        const span = Math.max(10, Math.round((fxMax - fxMin) * 0.085))
        const sx0 = side === 'left' ? fxMin + 2 : fxMax - span
        const sx1 = side === 'left' ? fxMin + span : fxMax - 2
        for (let x = sx0; x < sx1; x++) {
          const i = (y * TEST_W + x) * 4
          if (cornellNorm.data[i + 1] > 0.9) {
            r += cornellDenoised.data[i]
            g += cornellDenoised.data[i + 1]
            b += cornellDenoised.data[i + 2]
            n++
          }
        }
      }
      return n > 0 ? { r: r / n, g: g / n, b: b / n, count: n } : { r: 0, g: 0, b: 0, count: 0 }
    }
    const floorNearRed = sampleFloorWallEdge('left')
    const floorNearGreen = sampleFloorWallEdge('right')

    // Also test Mode 1 (5-Cone Voxel Cone Tracing) on the exact same Cornell Box!
    {
      const enc = device.createCommandEncoder()
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...cornellCam, aspect: TEST_W / TEST_H },
        sunDir: [0, 1, 0],
        sky: zeroSky,
        mode: giMod.GI_MODE_VCT,
        atrousPasses: 1,
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const vctData = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    const vctNearRed = regionMeanRgb(
      vctData.data, cornellNorm.data, TEST_W, TEST_H,
      backMinX + 4, backMinY + Math.round((backMaxY - backMinY) * 0.25),
      backMinX + Math.round(bwSpan * 0.16), backMaxY - 8,
      [0, 0, 1],
    )
    const vctNearGreen = regionMeanRgb(
      vctData.data, cornellNorm.data, TEST_W, TEST_H,
      backMaxX - Math.round(bwSpan * 0.16), backMinY + Math.round((backMaxY - backMinY) * 0.25),
      backMaxX - 4, backMaxY - 8,
      [0, 0, 1],
    )

    // Test 1B: Sunlit SF Street Alley (warm terracotta wall bouncing onto shadowed white wall)
    const alleyScene = buildSunlitAlley()
    const alleyCam = gpuMod.camera([30.5 * VOX, 10.0 * VOX, 41.0 * VOX], [35.5 * VOX, 10.0 * VOX, 27.0 * VOX], 60)
    const alleySunDir = [0.65, 0.74, 0.15]
    gi.reset()
    for (let i = 0; i < 6; i++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: alleyCam.eye,
        source: alleyScene.source,
        sunDir: alleySunDir,
        sunIrradiance: [9.0, 8.6, 8.0],
        sky: { zenith: [0.18, 0.28, 0.45], horizon: [0.30, 0.34, 0.40], ground: [0.1, 0.1, 0.1] },
        reset: i === 0,
      })
      device.queue.submit([enc.finish()])
    }
    for (let f = 0; f < 10; f++) {
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, alleyScene, alleyCam, alleyCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...alleyCam, aspect: TEST_W / TEST_H },
        sunDir: alleySunDir,
        sky: { zenith: [0.18, 0.28, 0.45], horizon: [0.30, 0.34, 0.40], ground: [0.1, 0.1, 0.1] },
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
    }
    const alleyNorm = await readRgba16f2D(normalTex, TEST_W, TEST_H)
    const alleyGi = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    const alleyShadedWall = regionMeanRgb(
      alleyGi.data, alleyNorm.data, TEST_W, TEST_H,
      Math.round(TEST_W * 0.25), Math.round(TEST_H * 0.25),
      Math.round(TEST_W * 0.85), Math.round(TEST_H * 0.78),
      [-1, 0, 0],
    )
    alleyScene.destroy()

    // ════════════════════════════════════════════════════════════════════════
    // TEST 2: Sealed Dark Room vs Broken Roof / Skylight Room (Retiring ROOM_LIGHT)
    // ════════════════════════════════════════════════════════════════════════
    const roofSunDir = [0.22, 0.95, 0.20]
    const roofSunIrr = [7.5, 7.2, 6.8]

    // Case 2A: Sealed dark room (solid 1-voxel walls & roof under bright noon sun + sky)
    const sealedRoom = buildRoofRoom(false)
    gi.reset()
    for (let i = 0; i < 8; i++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: sealedRoom.source,
        sunDir: roofSunDir,
        sunIrradiance: roofSunIrr,
        sky: daySky,
        reset: i === 0,
      })
      device.queue.submit([enc.finish()])
    }
    for (let f = 0; f < 10; f++) {
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, sealedRoom, cornellCam, cornellCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...cornellCam, aspect: TEST_W / TEST_H },
        sunDir: roofSunDir,
        sky: daySky,
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
    }
    const sealedNorm = await readRgba16f2D(normalTex, TEST_W, TEST_H)
    const sealedGi = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    const sealedFloor = regionMeanRgb(
      sealedGi.data, sealedNorm.data, TEST_W, TEST_H,
      backMinX + 8, backMaxY + 6, backMaxX - 8, TEST_H - 8,
      [0, 1, 0],
    )
    const sealedWall = regionMeanRgb(
      sealedGi.data, sealedNorm.data, TEST_W, TEST_H,
      backMinX + 8, backMinY + 8, backMaxX - 8, backMaxY - 8,
      [0, 0, 1],
    )
    let sealedMaxLum = 0
    for (let i = 0; i < sealedGi.data.length; i += 4) {
      const lum = luma(sealedGi.data[i], sealedGi.data[i + 1], sealedGi.data[i + 2])
      if (lum > sealedMaxLum) sealedMaxLum = lum
    }
    sealedRoom.destroy()

    // Case 2B: Exact same room with 4x4 hole punched in roof
    const openRoom = buildRoofRoom(true)
    gi.reset()
    for (let i = 0; i < 10; i++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: openRoom.source,
        sunDir: roofSunDir,
        sunIrradiance: roofSunIrr,
        sky: daySky,
        reset: i === 0,
      })
      device.queue.submit([enc.finish()])
    }
    let openTemp = null
    for (let f = 0; f < 16; f++) {
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, openRoom, cornellCam, cornellCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...cornellCam, aspect: TEST_W / TEST_H },
        sunDir: roofSunDir,
        sky: daySky,
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        atrousPasses: f === 14 ? 0 : 3,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
      if (f === 14) {
        openTemp = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
      }
    }
    const openNorm = await readRgba16f2D(normalTex, TEST_W, TEST_H)
    const openGi = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    const openFloor = regionMeanRgb(
      openGi.data, openNorm.data, TEST_W, TEST_H,
      backMinX + 8, backMaxY + 6, backMaxX - 8, TEST_H - 8,
      [0, 1, 0],
    )
    const openWall = regionMeanRgb(
      openGi.data, openNorm.data, TEST_W, TEST_H,
      backMinX + 8, backMinY + 8, backMaxX - 8, backMaxY - 8,
      [0, 0, 1],
    )
    openRoom.destroy()

    // ════════════════════════════════════════════════════════════════════════
    // TEST 3: SVGF Noise Reduction, 90-deg Corner Preservation, Motion & Reset
    // ════════════════════════════════════════════════════════════════════════
    // Compute raw 1-spp vs SVGF denoised high-frequency variance on the white back wall (from Test 1's 16-frame run)
    const patchX0 = backMinX + Math.round(bwSpan * 0.25)
    const patchX1 = backMaxX - Math.round(bwSpan * 0.25)
    const patchY0 = backMinY + Math.round((backMaxY - backMinY) * 0.25)
    const patchY1 = backMaxY - Math.round((backMaxY - backMinY) * 0.15)
    const rawBackVar = spatialNoiseVariance(cornellRaw.data, cornellNorm.data, TEST_W, TEST_H, patchX0, patchY0, patchX1, patchY1, [0, 0, 1])
    const denBackVar = spatialNoiseVariance(cornellDenoised.data, cornellNorm.data, TEST_W, TEST_H, patchX0, patchY0, patchX1, patchY1, [0, 0, 1])
    const varianceDropPct = rawBackVar > 1e-8 ? ((rawBackVar - denBackVar) / rawBackVar) * 100 : 0

    // Measure 90-degree corner edge preservation across TWO orthogonal creases:
    //   1. Horizontal back-wall (+Z) / floor (+Y) luminance step in the open-roof daylight room
    //      (large physical irradiance jump between skylight-facing back wall and shadowed floor edge):
    //      compare SVGF 3x à-trous 1-px crease jump vs 0-atrous 15-frame temporal jump.
    //   2. Vertical red-wall (+X) / white back-wall (+Z) 1-px chromaticity step in Cornell Box:
    //      compare SVGF 3x à-trous vs 0-atrous 15-frame temporal R/G contrast across the 90-deg corner.
    let wallEdgeSum = 0, floorEdgeSum = 0, tempWallEdgeSum = 0, tempFloorEdgeSum = 0, edgeSamples = 0
    for (let x = patchX0; x < patchX1; x++) {
      for (let y = backMaxY - 4; y <= backMaxY + 4; y++) {
        if (y < 12 || y >= TEST_H - 12) continue
        const iUp = (y * TEST_W + x) * 4
        const iDn = ((y + 1) * TEST_W + x) * 4
        if (openNorm.data[iUp + 2] > 0.9 && openNorm.data[iDn + 1] > 0.9) {
          wallEdgeSum += luma(openGi.data[iUp], openGi.data[iUp + 1], openGi.data[iUp + 2])
          floorEdgeSum += luma(openGi.data[iDn], openGi.data[iDn + 1], openGi.data[iDn + 2])
          tempWallEdgeSum += luma(openTemp.data[iUp], openTemp.data[iUp + 1], openTemp.data[iUp + 2])
          tempFloorEdgeSum += luma(openTemp.data[iDn], openTemp.data[iDn + 1], openTemp.data[iDn + 2])
          edgeSamples++
          break
        }
      }
    }
    const wallEdgeLum = edgeSamples > 0 ? wallEdgeSum / edgeSamples : 0
    const floorEdgeLum = edgeSamples > 0 ? floorEdgeSum / edgeSamples : 0
    const rawWallEdgeLum = edgeSamples > 0 ? tempWallEdgeSum / edgeSamples : 0
    const rawFloorEdgeLum = edgeSamples > 0 ? tempFloorEdgeSum / edgeSamples : 0
    const creaseJump = Math.abs(floorEdgeLum - wallEdgeLum)
    const rawCreaseJump = Math.abs(rawFloorEdgeLum - rawWallEdgeLum)
    const creaseRetentionRatio = rawCreaseJump > 1e-4 ? creaseJump / rawCreaseJump : 0

    let leftWallR = 0, leftWallG = 0, rightBackR = 0, rightBackG = 0
    let tLeftWallR = 0, tLeftWallG = 0, tRightBackR = 0, tRightBackG = 0
    let vertSamples = 0
    for (let y = patchY0; y < patchY1; y++) {
      for (let x = backMinX - 4; x <= backMinX + 4; x++) {
        if (x < 4 || x >= TEST_W - 4) continue
        const iL = (y * TEST_W + x) * 4
        const iR = (y * TEST_W + (x + 1)) * 4
        if (cornellNorm.data[iL] > 0.9 && cornellNorm.data[iR + 2] > 0.9) {
          leftWallR += cornellDenoised.data[iL]
          leftWallG += cornellDenoised.data[iL + 1]
          rightBackR += cornellDenoised.data[iR]
          rightBackG += cornellDenoised.data[iR + 1]
          tLeftWallR += cornellTemp.data[iL]
          tLeftWallG += cornellTemp.data[iL + 1]
          tRightBackR += cornellTemp.data[iR]
          tRightBackG += cornellTemp.data[iR + 1]
          vertSamples++
          break
        }
      }
    }
    const vertLeftRG = vertSamples > 0 ? leftWallR / Math.max(leftWallG, 1e-5) : 0
    const vertRightRG = vertSamples > 0 ? rightBackR / Math.max(rightBackG, 1e-5) : 0
    const vertContrast = Math.abs(vertRightRG - vertLeftRG)
    const tVertLeftRG = vertSamples > 0 ? tLeftWallR / Math.max(tLeftWallG, 1e-5) : 0
    const tVertRightRG = vertSamples > 0 ? tRightBackR / Math.max(tRightBackG, 1e-5) : 0
    const vertTempContrast = Math.abs(tVertRightRG - tVertLeftRG)

    // Camera pan reprojection + hard reset check
    gi.reset()
    for (let i = 0; i < 8; i++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: cornellScene.source,
        sunDir: [0, 1, 0],
        sunIrradiance: [0, 0, 0],
        sky: zeroSky,
        reset: i === 0,
      })
      device.queue.submit([enc.finish()])
    }
    let prevCam = cornellCam
    for (let f = 0; f < 8; f++) {
      const dx = (f - 3.5) * 1.4
      const curCam = gpuMod.camera(
        [32 * VOX + dx, 9.5 * VOX, 36.8 * VOX],
        [32 * VOX + dx * 0.6, 8.9 * VOX, 25 * VOX],
        66,
      )
      const enc = device.createCommandEncoder()
      renderGBuffer(enc, cornellScene, curCam, prevCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...curCam, aspect: TEST_W / TEST_H },
        sunDir: [0, 1, 0],
        sky: zeroSky,
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
      prevCam = curCam
    }
    const panGi = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)

    // Hard reset into a completely dark sealed room: must clear all prior bright history on frame 1!
    const darkResetRoom = buildRoofRoom(false)
    const resetsBefore = gi.stats().resets
    {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: darkResetRoom.source,
        sunDir: [0, 1, 0],
        sunIrradiance: [0, 0, 0],
        sky: zeroSky,
        reset: true,
      })
      renderGBuffer(enc, darkResetRoom, cornellCam, prevCam, TEST_W, TEST_H)
      gi.traceAndDenoise(enc, {
        depth: depthView,
        normal: normalView,
        velocity: velView,
        renderSize: [TEST_W, TEST_H],
        allocSize: [MAX_W, MAX_H],
        camera: { ...cornellCam, aspect: TEST_W / TEST_H },
        sunDir: [0, 1, 0],
        sky: zeroSky,
        mode: giMod.GI_MODE_STOCHASTIC,
        spp: 1,
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const resetGi = await readRgba16f2D(gi.giTexture, TEST_W, TEST_H)
    let resetMaxLum = 0
    for (let i = 0; i < resetGi.data.length; i += 4) {
      const lum = luma(resetGi.data[i], resetGi.data[i + 1], resetGi.data[i + 2])
      if (lum > resetMaxLum) resetMaxLum = lum
    }
    const resetsAfter = gi.stats().resets
    darkResetRoom.destroy()

    // ════════════════════════════════════════════════════════════════════════
    // TEST 4: 20-Iter Multi-Bounce Energy Conservation, Dynamic Res, GI_WGSL & GPU Perf
    // ════════════════════════════════════════════════════════════════════════
    gi.reset()
    const bounceCurve = []
    let bounceNonFinite = 0
    let bounceNegatives = 0
    let bouncePeakLum = 0

    for (let iter = 0; iter < 20; iter++) {
      const enc = device.createCommandEncoder()
      gi.inject(enc, {
        cameraPosCells: cornellCam.eye,
        source: cornellScene.source,
        sunDir: [0, 1, 0],
        sunIrradiance: [0, 0, 0],
        sky: zeroSky,
        bounceFeedback: 0.65,
        reset: iter === 0,
      })
      device.queue.submit([enc.finish()])
      const snap = await readCascadeMip0(gi.cascadeTextures[0])
      bounceCurve.push(snap.meanLum)
      bounceNonFinite += snap.nonFinite
      bounceNegatives += snap.negatives
      if (snap.maxLum > bouncePeakLum) bouncePeakLum = snap.maxLum
    }

    // Check monotonic convergence: iter 5 > iter 0, no significant regression across curve, late delta < 3%
    let maxDipRatio = 0
    for (let i = 1; i < bounceCurve.length; i++) {
      if (bounceCurve[i] < bounceCurve[i - 1]) {
        const dip = (bounceCurve[i - 1] - bounceCurve[i]) / Math.max(bounceCurve[i - 1], 1e-6)
        if (dip > maxDipRatio) maxDipRatio = dip
      }
    }
    const lateDeltaPct =
      (Math.abs(bounceCurve[19] - bounceCurve[18]) / Math.max(bounceCurve[19], 1e-6)) * 100

    // Dynamic resolution switching across 0.50x, 0.75x, 1.0x of 1280x720 (0 reallocs!)
    const dynSizes = [
      [640, 360],
      [960, 540],
      [1280, 720],
      [640, 360],
    ]
    let dynNonFinite = 0
    let dynNegatives = 0
    for (let idx = 0; idx < dynSizes.length; idx++) {
      const [rw, rh] = dynSizes[idx]
      for (let f = 0; f < 3; f++) {
        const enc = device.createCommandEncoder()
        renderGBuffer(enc, cornellScene, cornellCam, cornellCam, rw, rh)
        gi.traceAndDenoise(enc, {
          depth: depthView,
          normal: normalView,
          velocity: velView,
          renderSize: [rw, rh],
          allocSize: [MAX_W, MAX_H],
          camera: { ...cornellCam, aspect: rw / rh },
          sunDir: [0, 1, 0],
          sky: zeroSky,
          mode: giMod.GI_MODE_STOCHASTIC,
          spp: 1,
        })
        device.queue.submit([enc.finish()])
      }
      const res = await readRgba16f2D(gi.giTexture, rw, rh)
      dynNonFinite += res.nonFinite
      dynNegatives += res.negatives
    }
    const statsAfterDyn = gi.stats()

    // Reusable GI_WGSL GPU compilation & execution verification
    const probeCode = /* wgsl */ `
${giMod.giBindings(0, 0)}
@group(0) @binding(2) var<storage, read_write> outBuf: array<vec4f>;
${giMod.GI_WGSL}

@compute @workgroup_size(1)
fn main() {
  let uvScale = vec2f(640.0 / 1280.0, 360.0 / 720.0);
  let invCap = vec2f(1.0 / 1280.0, 1.0 / 720.0);
  let giS = sampleIndirectGI(vec2f(0.5, 0.5), uvScale, invCap);
  let combined = applyVoxelGI(vec3f(0.1, 0.1, 0.1), vec3f(0.8, 0.8, 0.8), vec3f(0.0), giS, 1.0);
  outBuf[0] = giS;
  outBuf[1] = vec4f(combined, 1.0);
}
`
    const probeMod = await gpuMod.shader(device, 'gi-wgsl-probe', probeCode)
    const probeOutBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const probeReadBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const probePipe = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: probeMod, entryPoint: 'main' },
    })
    const probeBg = device.createBindGroup({
      layout: probePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gi.giView },
        { binding: 1, resource: gi.linearSampler },
        { binding: 2, resource: { buffer: probeOutBuf } },
      ],
    })
    {
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(probePipe)
      pass.setBindGroup(0, probeBg)
      pass.dispatchWorkgroups(1)
      pass.end()
      enc.copyBufferToBuffer(probeOutBuf, 0, probeReadBuf, 0, 32)
      device.queue.submit([enc.finish()])
    }
    await probeReadBuf.mapAsync(GPUMapMode.READ)
    const probeVals = new Float32Array(probeReadBuf.getMappedRange().slice(0))
    probeReadBuf.unmap()
    probeOutBuf.destroy()
    probeReadBuf.destroy()
    const wgslProbeOk =
      Number.isFinite(probeVals[0]) &&
      Number.isFinite(probeVals[4]) &&
      probeVals[4] > 0.1 &&
      Math.abs(probeVals[4] - (0.1 + 0.8 * probeVals[0])) < 1e-3

    // ── GPU Performance Benchmark via timestamp-query (640x360 & 1280x720) ──
    async function benchmarkResolution(w, h, mode) {
      if (!gpu.canTime) return null
      // Prepare G-Buffer once at (w, h)
      {
        const enc = device.createCommandEncoder()
        renderGBuffer(enc, cornellScene, cornellCam, cornellCam, w, h)
        device.queue.submit([enc.finish()])
      }
      const querySet = device.createQuerySet({ type: 'timestamp', count: 8 })
      const resolvedBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const readBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const samples = { injectMip: [], trace: [], temporal: [], atrous: [], total: [] }

      // 2 warmup runs + 9 measured runs (take median)
      for (let i = 0; i < 11; i++) {
        const enc = device.createCommandEncoder()
        gi.inject(
          enc,
          {
            cameraPosCells: cornellCam.eye,
            source: cornellScene.source,
            sunDir: [0, 1, 0],
            sunIrradiance: [0, 0, 0],
            sky: zeroSky,
          },
          { all: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } },
        )
        gi.traceAndDenoise(
          enc,
          {
            depth: depthView,
            normal: normalView,
            velocity: velView,
            renderSize: [w, h],
            allocSize: [MAX_W, MAX_H],
            camera: { ...cornellCam, aspect: w / h },
            sunDir: [0, 1, 0],
            sky: zeroSky,
            mode,
            spp: 1,
          },
          {
            trace: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
            temporal: { querySet, beginningOfPassWriteIndex: 4, endOfPassWriteIndex: 5 },
            atrous: { querySet, beginningOfPassWriteIndex: 6, endOfPassWriteIndex: 7 },
          },
        )
        enc.resolveQuerySet(querySet, 0, 8, resolvedBuf, 0)
        enc.copyBufferToBuffer(resolvedBuf, 0, readBuf, 0, 64)
        device.queue.submit([enc.finish()])
        await readBuf.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(readBuf.getMappedRange().slice(0))
        readBuf.unmap()
        if (i >= 2) {
          const im = ts[1] > ts[0] ? Number(ts[1] - ts[0]) / 1e6 : 0
          const tr = ts[3] > ts[2] ? Number(ts[3] - ts[2]) / 1e6 : 0
          const tm = ts[5] > ts[4] ? Number(ts[5] - ts[4]) / 1e6 : 0
          const at = ts[7] > ts[6] ? Number(ts[7] - ts[6]) / 1e6 : 0
          samples.injectMip.push(im)
          samples.trace.push(tr)
          samples.temporal.push(tm)
          samples.atrous.push(at)
          samples.total.push(im + tr + tm + at)
        }
      }
      querySet.destroy()
      resolvedBuf.destroy()
      readBuf.destroy()
      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b)
        return s[s.length >> 1]
      }
      return {
        injectMipMs: median(samples.injectMip),
        traceMs: median(samples.trace),
        temporalMs: median(samples.temporal),
        atrousMs: median(samples.atrous),
        totalMs: median(samples.total),
      }
    }

    const perfHalfStoch = await benchmarkResolution(640, 360, giMod.GI_MODE_STOCHASTIC)
    const perfFullStoch = await benchmarkResolution(1280, 720, giMod.GI_MODE_STOCHASTIC)
    const perfHalfVct = await benchmarkResolution(640, 360, giMod.GI_MODE_VCT)

    await device.queue.onSubmittedWorkDone()

    // Clean teardown
    cornellScene.destroy()
    gi.destroy()
    depthTex.destroy()
    normalTex.destroy()
    velTex.destroy()
    gbufUbo.destroy()

    return {
      test1: {
        backNearRed,
        backNearGreen,
        backCenter,
        floorNearRed,
        floorNearGreen,
        vctNearRed,
        vctNearGreen,
        alleyShadedWall,
        nonFinite: cornellDenoised.nonFinite + cornellRaw.nonFinite + vctData.nonFinite + alleyGi.nonFinite,
        negatives: cornellDenoised.negatives + cornellRaw.negatives + vctData.negatives + alleyGi.negatives,
      },
      test2: {
        sealedFloorLum: luma(sealedFloor.r, sealedFloor.g, sealedFloor.b),
        sealedWallLum: luma(sealedWall.r, sealedWall.g, sealedWall.b),
        sealedMaxLum,
        openFloorLum: luma(openFloor.r, openFloor.g, openFloor.b),
        openWallLum: luma(openWall.r, openWall.g, openWall.b),
        nonFinite: sealedGi.nonFinite + openGi.nonFinite,
      },
      test3: {
        rawBackVar,
        denBackVar,
        varianceDropPct,
        wallEdgeLum,
        floorEdgeLum,
        rawWallEdgeLum,
        rawFloorEdgeLum,
        creaseJump,
        rawCreaseJump,
        creaseRetentionRatio,
        vertLeftRG,
        vertRightRG,
        vertContrast,
        vertTempContrast,
        panNonFinite: panGi.nonFinite,
        panNegatives: panGi.negatives,
        resetMaxLum,
        resetNonFinite: resetGi.nonFinite,
        resetsIncremented: resetsAfter > resetsBefore,
      },
      test4: {
        bounceIter0: bounceCurve[0],
        bounceIter4: bounceCurve[4],
        bounceIter19: bounceCurve[19],
        bouncePeakLum,
        maxDipRatio,
        lateDeltaPct,
        bounceNonFinite,
        bounceNegatives,
        statsAfterDyn,
        dynNonFinite,
        dynNegatives,
        wgslProbeOk,
        perfHalfStoch,
        perfFullStoch,
        perfHalfVct,
      },
      faults: [...gpu.faults],
    }
  })

  console.log('\nVoxel-Native Global Illumination (3-Cascade Toroidal Clipmap + SVGF):')

  // ── Test 1 Checks ─────────────────────────────────────────────────────────
  const t1 = report.test1
  const backRedRatio = t1.backNearRed.r / Math.max(t1.backNearRed.g, 1e-5)
  const backGreenRatio = t1.backNearGreen.g / Math.max(t1.backNearGreen.r, 1e-5)
  const floorRedRatio = t1.floorNearRed.r / Math.max(t1.floorNearRed.g, 1e-5)
  const floorGreenRatio = t1.floorNearGreen.g / Math.max(t1.floorNearGreen.r, 1e-5)
  const centerBal = Math.abs(t1.backCenter.r - t1.backCenter.g) / Math.max(t1.backCenter.r, t1.backCenter.g, 1e-5)
  const vctRedRatio = t1.vctNearRed.r / Math.max(t1.vctNearRed.g, 1e-5)
  const vctGreenRatio = t1.vctNearGreen.g / Math.max(t1.vctNearGreen.r, 1e-5)
  const alleyWarmRatio = t1.alleyShadedWall.r / Math.max(t1.alleyShadedWall.b, 1e-5)

  check(
    backRedRatio > 1.25 && floorRedRatio > 1.25 && backGreenRatio > 1.25 && floorGreenRatio > 1.25 && centerBal < 0.15,
    `Test 1 (Cornell Box bleed, Mode 0 Stochastic+SVGF): back R/G=${backRedRatio.toFixed(2)}x, floor R/G=${floorRedRatio.toFixed(2)}x, back G/R=${backGreenRatio.toFixed(2)}x, floor G/R=${floorGreenRatio.toFixed(2)}x, center |R-G|=${(centerBal * 100).toFixed(1)}%`,
  )
  check(
    vctRedRatio > 1.25 && vctGreenRatio > 1.25 && alleyWarmRatio > 1.15 && t1.nonFinite === 0 && t1.negatives === 0,
    `Test 1 (Mode 1 5-Cone VCT & SF sunlit alley): VCT R/G=${vctRedRatio.toFixed(2)}x, G/R=${vctGreenRatio.toFixed(2)}x; alley shaded wall R/B=${alleyWarmRatio.toFixed(2)}x (nonFinite=${t1.nonFinite}, neg=${t1.negatives})`,
  )

  // ── Test 2 Checks ─────────────────────────────────────────────────────────
  const t2 = report.test2
  const roofGain = t2.openFloorLum / Math.max(t2.sealedFloorLum, 1e-4)
  check(
    t2.sealedFloorLum < 0.01 && t2.sealedWallLum < 0.01 && t2.sealedMaxLum < 0.02,
    `Test 2 (sealed 1-voxel room, zero light leak): floor=${t2.sealedFloorLum.toFixed(5)}, wall=${t2.sealedWallLum.toFixed(5)}, max=${t2.sealedMaxLum.toFixed(5)}`,
  )
  check(
    t2.openFloorLum > 0.15 && roofGain > 5.0 && t2.openWallLum > 0.05 && t2.nonFinite === 0,
    `Test 2 (broken-roof skylight daylight): open floor=${t2.openFloorLum.toFixed(3)} (${roofGain.toFixed(1)}x vs sealed), open back wall=${t2.openWallLum.toFixed(3)} (nonFinite=${t2.nonFinite})`,
  )

  // ── Test 3 Checks ─────────────────────────────────────────────────────────
  const t3 = report.test3
  check(
    t3.varianceDropPct > 70,
    `Test 3 (SVGF 16-frame noise reduction): back-wall variance ${t3.rawBackVar.toFixed(5)} -> ${t3.denBackVar.toFixed(5)} (-${t3.varianceDropPct.toFixed(1)}%)`,
  )
  check(
    t3.creaseRetentionRatio > 0.80 && t3.vertRightRG > 1.35 && t3.vertContrast > 0.35,
    `Test 3 (90-deg corner edge preservation): wall-floor jump ${t3.creaseJump.toFixed(3)} (${t3.wallEdgeLum.toFixed(3)}|${t3.floorEdgeLum.toFixed(3)}) vs 0-atrous ${t3.rawCreaseJump.toFixed(3)} (${(t3.creaseRetentionRatio * 100).toFixed(1)}% retained); red/back 1px R/G ${t3.vertLeftRG.toFixed(2)}x|${t3.vertRightRG.toFixed(2)}x (contrast ${t3.vertContrast.toFixed(2)}x vs 0-atrous ${t3.vertTempContrast.toFixed(2)}x)`,
  )
  check(
    t3.panNonFinite === 0 && t3.panNegatives === 0 && t3.resetNonFinite === 0 && t3.resetMaxLum < 0.01 && t3.resetsIncremented,
    `Test 3 (camera motion reprojection & hard reset): pan nonFinite=${t3.panNonFinite}, neg=${t3.panNegatives}, post-reset maxLum=${t3.resetMaxLum.toFixed(5)}, resetsIncremented=${t3.resetsIncremented}`,
  )

  // ── Test 4 Checks ─────────────────────────────────────────────────────────
  const t4 = report.test4
  check(
    t4.bounceIter4 > t4.bounceIter0 &&
      t4.bouncePeakLum < 64.0 &&
      t4.maxDipRatio < 0.05 &&
      t4.lateDeltaPct < 3.0 &&
      t4.bounceNonFinite === 0 &&
      t4.bounceNegatives === 0,
    `Test 4 (20-iter multi-bounce energy conservation): mean ${t4.bounceIter0.toFixed(3)} -> ${t4.bounceIter4.toFixed(3)} -> ${t4.bounceIter19.toFixed(3)}, lateDelta=${t4.lateDeltaPct.toFixed(2)}%, maxDip=${(t4.maxDipRatio * 100).toFixed(2)}%, peak=${t4.bouncePeakLum.toFixed(2)}`,
  )
  check(
    t4.statsAfterDyn.reallocs === 0 && t4.dynNonFinite === 0 && t4.dynNegatives === 0 && t4.wgslProbeOk,
    `Test 4 (dynamic res 0.50x/0.75x/1.0x & GI_WGSL probe): reallocs=${t4.statsAfterDyn.reallocs}, frames=${t4.statsAfterDyn.frames}, nonFinite=${t4.dynNonFinite}, GI_WGSL=${t4.wgslProbeOk}`,
  )
  check(
    report.faults.length === 0,
    report.faults.length === 0 ? 'WebGPU device faults: 0' : `WebGPU faults: ${report.faults.join(' | ')}`,
  )

  if (t4.perfHalfStoch && t4.perfFullStoch && t4.perfHalfVct) {
    const p640 = t4.perfHalfStoch
    const p1280 = t4.perfFullStoch
    const pvct = t4.perfHalfVct
    console.log(
      `  info GPU ms (640x360, Mode 0 Stochastic+SVGF): inject+mip=${p640.injectMipMs.toFixed(3)}ms, trace=${p640.traceMs.toFixed(3)}ms, temporal=${p640.temporalMs.toFixed(3)}ms, 3x-atrous=${p640.atrousMs.toFixed(3)}ms, total=${p640.totalMs.toFixed(3)}ms`,
    )
    console.log(
      `  info GPU ms (1280x720, Mode 0 Stochastic+SVGF): inject+mip=${p1280.injectMipMs.toFixed(3)}ms, trace=${p1280.traceMs.toFixed(3)}ms, temporal=${p1280.temporalMs.toFixed(3)}ms, 3x-atrous=${p1280.atrousMs.toFixed(3)}ms, total=${p1280.totalMs.toFixed(3)}ms`,
    )
    console.log(
      `  info GPU ms (640x360, Mode 1 5-Cone VCT+SVGF): inject+mip=${pvct.injectMipMs.toFixed(3)}ms, trace=${pvct.traceMs.toFixed(3)}ms, temporal=${pvct.temporalMs.toFixed(3)}ms, 3x-atrous=${pvct.atrousMs.toFixed(3)}ms, total=${pvct.totalMs.toFixed(3)}ms`,
    )
  } else {
    console.log('  info GPU timing: timestamp-query unavailable')
  }
} catch (e) {
  failures.push(String(e))
}

await finish('gi')
