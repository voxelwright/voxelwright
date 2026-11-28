// Real headless Chrome WebGPU verification & A/B benchmark for engine/page/sun-compute.ts (#165).
//
// Exercises createComputeSunUpdater(device, { worldLayout, traceWgsl }) on the real GPU:
//   1. Bit-Exact Parity Test (1024x1024x4 r32float texture_2d_array):
//      - Legacy 8 separate beginRenderPass calls (setViewport + setScissorRect per 64x64 tile, exact march.tend() pattern)
//      - New 1 compute pass (dispatchWorkgroups(8, 8, 8)) writing via texture_storage_2d_array<r32float, write>
//      - Asserts maxAbsDiff === 0.0, bitMismatchCount === 0 across all 32,768 texels, zero NaN/Inf, zero gpu.faults,
//        and untouched sentinel texels outside the updated slots.
//   2. A/B GPU Timing Benchmark (timestamp-query + paced wall time + JS command-encoding time, interleaved A/B):
//      - Compares 8 render passes vs 1 compute dispatch and reports ms and speedup %.
//   3. Multi-Level & Edge Cases:
//      - Multi-level batch across levels 0, 1, 2, 3 in one dispatch
//      - tiles.length === 0 no-op
//      - Max batch (16 tiles = 65,536 texels) bit-exact parity against 16 legacy render passes
//      - Over-max clamping (>16 tiles -> 16)
//      - fineSun bit-0 LSB marking mode bit-exact parity
//
//   node engine/test/sun-compute.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route(`${url}/sun-compute-test.html`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>sun-compute test</title></head><body></body></html>',
  }))
  await page.goto(`${url}/sun-compute-test.html`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader } = await import('/probe/gpu.ts')
    const { SUN_SIDE, SUN_TILE, SunMaps } = await import('/page/sun.ts')
    const {
      MAX_SUN_TILES,
      SUN_TILE_BATCH_WGSL,
      createComputeSunUpdater,
      prepareSunTiles,
    } = await import('/page/sun-compute.ts')

    const gpu = await openGpu()
    const { device } = gpu
    const LEVELS = 4

    // ── Shared Synthetic 3D Scene Tracer (exact Globals + Hit + trace(...) contract of march.ts) ──
    const SHARED_TRACE_WGSL = /* wgsl */ `
struct Level {
  boxMin: vec3f, scale: f32,
  boxSize: vec3f, roof: f32,
}
struct Globals {
  eye: vec3f, sunFar: f32,
  sun: vec3f, levels: u32,
  sunU: vec3f, pad0: f32,
  sunV: vec3f, pad1: f32,
  level: array<Level, ${LEVELS}>,
}
struct Hit {
  t: f32,
  kind: u32,
  n: vec3f,
  level: u32,
  cell: vec3i,
  left: bool,
  out: f32,
}
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> sceneBoxes: array<vec4f>;

// Synthetic 3D city heightfield + elevated bridge/overhang slabs so through=true exercises
// finding the LAST solid exit along the sun ray, open-sky misses (-1e30), and multi-level boxes.
fn sceneSolid(p: vec3f) -> u32 {
  // Rolling ground terrain height (0..22 cells).
  let ground = 6.0 + 4.0 * sin(p.x * 0.018) * cos(p.z * 0.021) + 2.5 * sin((p.x + p.z) * 0.009);
  if (p.y <= ground && abs(p.x) < 360.0 && abs(p.z) < 360.0) {
    return 1u;
  }
  // 16 procedural city towers / bridges stored in sceneBoxes (2 vec4f per AABB: min+kind, max+fineFlag).
  let count = arrayLength(&sceneBoxes) >> 1u;
  for (var i = 0u; i < count; i++) {
    let lo = sceneBoxes[2u * i];
    let hi = sceneBoxes[2u * i + 1u];
    if (all(p >= lo.xyz) && all(p <= hi.xyz)) {
      return u32(lo.w);
    }
  }
  return 0u;
}

// Fine-cell helpers for testing fineSun=true bit-0 LSB marking parity.
fn sectorOf(c: vec3i, L: u32) -> u32 {
  return u32((c.x + c.y * 3 + c.z * 7 + i32(L)) & 15);
}
fn fineWord(entry: u32, c: vec3i) -> u32 {
  return select(0u, 1u, ((entry + u32(c.x & 3)) & 3u) == 0u);
}

// Raymarch along rd through box level0 with through=true semantics matching march.ts fs_sun:
// tracks the last solid exit along the line up to the box boundary.
fn trace(
  ro: vec3f,
  rd: vec3f,
  t0: f32,
  level0: u32,
  most: u32,
  wide: f32,
  spread: f32,
  rough: bool,
  through: bool,
  eyed: bool,
) -> Hit {
  var hit: Hit;
  hit.t = -1.0;
  hit.kind = 0u;
  hit.n = vec3f(0.0, 1.0, 0.0);
  hit.level = level0;
  hit.cell = vec3i(0);
  hit.left = false;
  hit.out = 0.0;
  let _unused = wide + spread + f32(rough) + f32(eyed);

  let lv = g.level[level0];
  let invRd = 1.0 / rd;
  let boxMax = fma(lv.boxSize, vec3f(1.0 / lv.scale), lv.boxMin);
  let a = (lv.boxMin - ro) * invRd;
  let b = (boxMax - ro) * invRd;
  let hiT = max(a, b);
  let leaveAt = min(hiT.x, min(hiT.y, hiT.z));
  let stepLen = max(1.0 / lv.scale, (leaveAt - t0) / 48.0);
  let maxIters = min(most, 48u);

  for (var i = 0u; i < maxIters; i++) {
    let t = fma(f32(i), stepLen, t0);
    if (t >= leaveAt) {
      hit.left = true;
      break;
    }
    let p = fma(rd, vec3f(t), ro);
    let k = sceneSolid(p);
    if (k != 0u) {
      let exitT = min(t + stepLen, leaveAt);
      hit.t = exitT;
      hit.kind = k;
      hit.cell = vec3i(floor((p - lv.boxMin) * lv.scale));
      if (!through) { break; }
    }
  }
  if (_unused < -1e30) { hit.out = _unused; }
  return hit;
}
`

    // ── Legacy Render-Pass Shader (exact fs_sun pattern from march.ts) ───────
    const makeLegacyWgsl = (fineSun) => /* wgsl */ `
${SHARED_TRACE_WGSL}
struct SunTile { corner: vec2f, texel: f32, level: u32, origin: vec2f, pad: vec2f }
@group(1) @binding(0) var<uniform> sunTile: SunTile;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

@fragment fn fs_sun(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let local = at.xy - sunTile.origin - 0.5;
  let uv = fma(local, vec2f(sunTile.texel), sunTile.corner);
  let eyeSun = g.sun * dot(g.eye, g.sun);
  let o = fma(g.sunV, vec3f(uv.y), fma(g.sunU, vec3f(uv.x), eyeSun));
  let lv = g.level[sunTile.level];
  let invSun = 1.0 / g.sun;
  let boxMax = fma(lv.boxSize, vec3f(1.0 / lv.scale), lv.boxMin);
  let a = (lv.boxMin - o) * invSun;
  let b = (boxMax - o) * invSun;
  let nearT = min(a, b);
  let hiT = max(a, b);
  let come = max(nearT.x, max(nearT.y, nearT.z));
  if (come >= min(hiT.x, min(hiT.y, hiT.z))) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  let hit = trace(o, g.sun, fma(0.01, sunTile.texel, come), sunTile.level, 768u, 0.0, 0.0, false, true, false);
  if (hit.kind == 0u) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  ${fineSun
    ? `let inside = vec3i(floor((fma(g.sun, vec3f(hit.t - 0.01 / lv.scale), o) - lv.boxMin) * lv.scale));
  let marked = fineWord(sectorOf(inside, sunTile.level), inside) != 0u;
  return vec4f(bitcast<f32>((bitcast<u32>(dot(o, g.sun) + hit.t + g.sunFar) & 0xfffffffeu) | u32(marked)), 0.0, 0.0, 1.0);`
    : 'return vec4f(dot(o, g.sun) + hit.t + g.sunFar, 0.0, 0.0, 1.0);'}
}
`

    // ── Scene Buffers & Layouts ──────────────────────────────────────────────
    const sunDir = [0.52, 0.62, 0.59]
    const sunMaps = new SunMaps(device, LEVELS, sunDir)
    const eye = [32, 48, -24]
    const anchor = [0, 0, 0]

    // Globals buffer: 64 bytes header + 4 * 32 bytes Level = 192 bytes.
    const globalsBuf = device.createBuffer({
      label: 'sun-test-globals',
      size: 64 + LEVELS * 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    {
      const ab = new ArrayBuffer(64 + LEVELS * 32)
      const f = new Float32Array(ab)
      const u = new Uint32Array(ab)
      const sunFar = sunMaps.s[0] * anchor[0] + sunMaps.s[1] * anchor[1] + sunMaps.s[2] * anchor[2]
      f.set([eye[0] - anchor[0], eye[1] - anchor[1], eye[2] - anchor[2], sunFar], 0)
      f.set(sunMaps.s, 4)
      u[7] = LEVELS
      f.set(sunMaps.u, 8)
      f.set(sunMaps.v, 12)
      for (let L = 0; L < LEVELS; L++) {
        const scale = 1 / (1 << L)
        const boxCells = 256
        const halfWorld = (boxCells * 0.5) / scale
        const o = 16 + L * 8
        f.set([-halfWorld, -32, -halfWorld, scale], o)
        f.set([boxCells, 160, boxCells, 140], o + 4)
      }
      device.queue.writeBuffer(globalsBuf, 0, ab)
    }

    // 16 synthetic buildings, towers & bridges across levels 0..3.
    const boxes = new Float32Array(16 * 8)
    const addBox = (i, x0, y0, z0, x1, y1, z1, kind = 7) => {
      boxes.set([x0, y0, z0, kind, x1, y1, z1, 0], i * 8)
    }
    addBox(0, -60, 0, -40, -18, 82, 12, 8)
    addBox(1, 24, 0, -55, 72, 108, -8, 7)
    addBox(2, -12, 34, -22, 40, 48, 22, 9) // elevated bridge overhang!
    addBox(3, -110, 0, 30, -52, 64, 92, 8)
    addBox(4, 58, 0, 45, 118, 96, 104, 7)
    addBox(5, -180, 0, -150, -90, 120, -70, 9)
    addBox(6, 115, 0, -170, 210, 134, -85, 8)
    addBox(7, -260, 0, 120, -140, 110, 230, 7)
    addBox(8, 160, 0, 140, 290, 145, 260, 8)
    addBox(9, -45, 60, 50, 35, 76, 110, 9) // high skywalk!
    addBox(10, -340, 0, -310, -220, 128, -190, 7)
    addBox(11, 240, 0, -320, 350, 112, -210, 8)
    addBox(12, -30, 0, -140, 30, 72, -80, 7)
    addBox(13, -135, 0, -25, -85, 58, 25, 8)
    addBox(14, 95, 0, -15, 145, 68, 35, 9)
    addBox(15, -20, 0, 120, 55, 88, 185, 7)

    const boxesBuf = device.createBuffer({
      label: 'sun-test-boxes',
      size: boxes.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(boxesBuf, 0, boxes)

    const worldLayout = device.createBindGroupLayout({
      label: 'sun-test-world',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    })
    const worldBind = device.createBindGroup({
      label: 'sun-test-world-bg',
      layout: worldLayout,
      entries: [
        { binding: 0, resource: { buffer: globalsBuf } },
        { binding: 1, resource: { buffer: boxesBuf } },
      ],
    })

    // ── Legacy Pipelines (8/16 render passes) ────────────────────────────────
    const legacyTileLayout = device.createBindGroupLayout({
      label: 'sun-legacy-tile',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    const legacyLayout = device.createPipelineLayout({ bindGroupLayouts: [worldLayout, legacyTileLayout] })
    const legacyMod = await shader(device, 'sun-legacy', makeLegacyWgsl(false))
    const legacyPipe = await device.createRenderPipelineAsync({
      label: 'sun-legacy-pipe',
      layout: legacyLayout,
      vertex: { module: legacyMod, entryPoint: 'vs' },
      fragment: { module: legacyMod, entryPoint: 'fs_sun', targets: [{ format: 'r32float' }] },
    })
    const legacyFineMod = await shader(device, 'sun-legacy-fine', makeLegacyWgsl(true))
    const legacyFinePipe = await device.createRenderPipelineAsync({
      label: 'sun-legacy-fine-pipe',
      layout: legacyLayout,
      vertex: { module: legacyFineMod, entryPoint: 'vs' },
      fragment: { module: legacyFineMod, entryPoint: 'fs_sun', targets: [{ format: 'r32float' }] },
    })
    const legacyTileSlots = Array.from({ length: MAX_SUN_TILES }, (_, i) => {
      const buffer = device.createBuffer({
        label: `legacy-tile-${i}`,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      const bind = device.createBindGroup({
        layout: legacyTileLayout,
        entries: [{ binding: 0, resource: { buffer } }],
      })
      return { buffer, bind, staging: new ArrayBuffer(32) }
    })

    // ── New Single-Dispatch Compute Updaters ─────────────────────────────────
    const updater = await createComputeSunUpdater(device, {
      worldLayout,
      traceWgsl: SHARED_TRACE_WGSL,
      label: 'sun-compute-main',
    })
    const fineUpdater = await createComputeSunUpdater(device, {
      worldLayout,
      traceWgsl: SHARED_TRACE_WGSL,
      fineSun: true,
      label: 'sun-compute-fine',
    })

    // ── Target 1024x1024x4 r32float texture_2d_array (RENDER_ATTACHMENT | STORAGE_BINDING | TEXTURE_BINDING | COPY_SRC) ──
    const makeShadowArray = (label) => {
      const texture = device.createTexture({
        label,
        size: [SUN_SIDE, SUN_SIDE, LEVELS],
        format: 'r32float',
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST,
      })
      const arrayView = texture.createView({ dimension: '2d-array' })
      const layers = Array.from({ length: LEVELS }, (_, L) =>
        texture.createView({ dimension: '2d', baseArrayLayer: L, arrayLayerCount: 1 }),
      )
      return { texture, arrayView, layers }
    }
    const legacyTarget = makeShadowArray('legacy-sun-maps')
    const computeTarget = makeShadowArray('compute-sun-maps')

    // Clear all 4 layers to a known sentinel value (12345.0) to catch any out-of-bounds writes.
    const SENTINEL = 12345.0
    const clearAllLayers = (target) => {
      const enc = device.createCommandEncoder()
      for (let L = 0; L < LEVELS; L++) {
        enc.beginRenderPass({
          colorAttachments: [{ view: target.layers[L], loadOp: 'clear', clearValue: [SENTINEL, 0, 0, 1], storeOp: 'store' }],
        }).end()
      }
      device.queue.submit([enc.finish()])
    }

    // Legacy render-pass encoder (exact march.tend() pattern).
    const encodeLegacy = (enc, tiles, target, pipe = legacyPipe, timing = null) => {
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i]
        const slot = legacyTileSlots[i]
        const texel = tile.texel ?? (1 << tile.level)
        new Float32Array(slot.staging).set([
          tile.corner[0], tile.corner[1], texel, 0,
          tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, 0, 0,
        ])
        new Uint32Array(slot.staging)[3] = tile.level
        device.queue.writeBuffer(slot.buffer, 0, slot.staging)
        const isFirst = timing && i === 0
        const isLast = timing && i === tiles.length - 1
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: target.layers[tile.level], loadOp: 'load', storeOp: 'store' }],
          ...(isFirst || isLast
            ? {
                timestampWrites: {
                  querySet: timing.querySet,
                  ...(isFirst ? { beginningOfPassWriteIndex: timing.begin } : {}),
                  ...(isLast ? { endOfPassWriteIndex: timing.end } : {}),
                },
              }
            : {}),
        })
        pass.setPipeline(pipe)
        pass.setBindGroup(0, worldBind)
        pass.setBindGroup(1, slot.bind)
        pass.setViewport(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE, 0, 1)
        pass.setScissorRect(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE)
        pass.draw(3)
        pass.end()
      }
    }

    // Read back a list of 64x64 tiles from an r32float 2d-array texture.
    const TILE_BYTES = SUN_TILE * SUN_TILE * 4 // 16384 bytes; bytesPerRow = 256 (aligned!)
    const readTiles = async (texture, tiles) => {
      const readBuf = device.createBuffer({
        size: tiles.length * TILE_BYTES,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i]
        enc.copyTextureToBuffer(
          { texture, origin: [t.slotX * SUN_TILE, t.slotY * SUN_TILE, t.level] },
          { buffer: readBuf, offset: i * TILE_BYTES, bytesPerRow: SUN_TILE * 4, rowsPerImage: SUN_TILE },
          [SUN_TILE, SUN_TILE, 1],
        )
      }
      device.queue.submit([enc.finish()])
      await readBuf.mapAsync(GPUMapMode.READ)
      const copy = readBuf.getMappedRange().slice(0)
      readBuf.unmap()
      readBuf.destroy()
      return { f32: new Float32Array(copy), u32: new Uint32Array(copy) }
    }

    const compareReadbacks = (a, b) => {
      let maxAbsDiff = 0
      let bitMismatches = 0
      let nanOrInf = 0
      let hitTexels = 0
      let missTexels = 0
      let sentinelLeaks = 0
      let minHit = Infinity
      let maxHit = -Infinity
      for (let i = 0; i < a.f32.length; i++) {
        const av = a.f32[i]
        const bv = b.f32[i]
        if (!Number.isFinite(av) || !Number.isFinite(bv)) nanOrInf++
        const diff = Math.abs(av - bv)
        if (diff > maxAbsDiff) maxAbsDiff = diff
        if (a.u32[i] !== b.u32[i]) bitMismatches++
        if (bv === SENTINEL) sentinelLeaks++
        if (bv <= -1e29) missTexels++
        else {
          hitTexels++
          if (bv < minHit) minHit = bv
          if (bv > maxHit) maxHit = bv
        }
      }
      return {
        texels: a.f32.length,
        maxAbsDiff,
        bitMismatches,
        nanOrInf,
        hitTexels,
        missTexels,
        sentinelLeaks,
        minHit,
        maxHit,
      }
    }

    // ── TEST 1: Bit-Exact Parity (8 tiles across levels 0, 1, 2, 3 = 32,768 texels) ──
    const rawTiles8 = [
      { level: 0, slotX: 0, slotY: 0, tx: -1, ty: -1 },
      { level: 0, slotX: 15, slotY: 15, tx: 0, ty: 0 },
      { level: 1, slotX: 7, slotY: 3, tx: -1, ty: 0 },
      { level: 1, slotX: 12, slotY: 9, tx: 1, ty: -1 },
      { level: 2, slotX: 1, slotY: 14, tx: 0, ty: 0 },
      { level: 2, slotX: 8, slotY: 8, tx: -1, ty: -1 },
      { level: 3, slotX: 15, slotY: 0, tx: 0, ty: 0 },
      { level: 3, slotX: 0, slotY: 15, tx: 2, ty: 2 }, // exercises out-of-box miss (-1e30) too
    ]
    const tiles8 = prepareSunTiles(rawTiles8, sunMaps, anchor)

    clearAllLayers(legacyTarget)
    clearAllLayers(computeTarget)
    {
      const enc = device.createCommandEncoder()
      encodeLegacy(enc, tiles8, legacyTarget)
      device.queue.submit([enc.finish()])
    }
    {
      const enc = device.createCommandEncoder()
      const dispatched = updater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
      if (dispatched !== 8) throw new Error(`expected 8 dispatched tiles, got ${dispatched}`)
    }
    await device.queue.onSubmittedWorkDone()

    const legacy8 = await readTiles(legacyTarget.texture, tiles8)
    const compute8 = await readTiles(computeTarget.texture, tiles8)
    const parity8 = compareReadbacks(legacy8, compute8)

    // Verify untouched slots on all 4 levels still hold SENTINEL (no out-of-bounds textureStore).
    const untouchedSlots = [
      { level: 0, slotX: 1, slotY: 0, tx: 0, ty: 0 },
      { level: 1, slotX: 0, slotY: 0, tx: 0, ty: 0 },
      { level: 2, slotX: 2, slotY: 2, tx: 0, ty: 0 },
      { level: 3, slotX: 7, slotY: 7, tx: 0, ty: 0 },
    ]
    const untouchedData = await readTiles(computeTarget.texture, untouchedSlots)
    let untouchedCorrupted = 0
    for (let i = 0; i < untouchedData.f32.length; i++) {
      if (untouchedData.f32[i] !== SENTINEL) untouchedCorrupted++
    }

    // Also verify fineSun=true bit-0 LSB marking bit-exact parity.
    clearAllLayers(legacyTarget)
    clearAllLayers(computeTarget)
    {
      const enc = device.createCommandEncoder()
      encodeLegacy(enc, tiles8, legacyTarget, legacyFinePipe)
      device.queue.submit([enc.finish()])
    }
    {
      const enc = device.createCommandEncoder()
      fineUpdater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const fineParity = compareReadbacks(
      await readTiles(legacyTarget.texture, tiles8),
      await readTiles(computeTarget.texture, tiles8),
    )

    // ── TEST 3: Edge Cases — Empty Batch (0 tiles) & Max Batch (16 tiles) & Over-Max Clamping ──
    const statsBeforeEmpty = updater.stats()
    {
      const enc = device.createCommandEncoder()
      const emptyCount = updater.dispatch(enc, [], computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
      if (emptyCount !== 0) throw new Error(`expected 0 for empty batch, got ${emptyCount}`)
    }
    const statsAfterEmpty = updater.stats()

    const rawTiles16 = []
    for (let L = 0; L < LEVELS; L++) {
      for (let k = 0; k < 4; k++) {
        rawTiles16.push({
          level: L,
          slotX: (L * 3 + k * 4) & 15,
          slotY: (L * 5 + k * 3 + 1) & 15,
          tx: k - 2,
          ty: (k % 2) - 1,
        })
      }
    }
    const tiles16 = prepareSunTiles(rawTiles16, sunMaps, anchor)
    clearAllLayers(legacyTarget)
    clearAllLayers(computeTarget)
    {
      const enc = device.createCommandEncoder()
      encodeLegacy(enc, tiles16, legacyTarget)
      device.queue.submit([enc.finish()])
    }
    let maxBatchDispatched = 0
    {
      const enc = device.createCommandEncoder()
      maxBatchDispatched = updater.dispatch(enc, tiles16, computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const parity16 = compareReadbacks(
      await readTiles(legacyTarget.texture, tiles16),
      await readTiles(computeTarget.texture, tiles16),
    )

    // Over-max clamping check (18 tiles -> clamped to MAX_SUN_TILES = 16, zero faults).
    let clampedDispatched = 0
    {
      const enc = device.createCommandEncoder()
      clampedDispatched = updater.dispatch(enc, [...tiles16, tiles8[0], tiles8[1]], computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    // ── TEST 2: Interleaved A/B GPU & CPU Benchmark (8 render passes vs 1 compute dispatch) ──
    // Warm up both paths so GPU clocks ramp cleanly.
    for (let w = 0; w < 6; w++) {
      const enc = device.createCommandEncoder()
      encodeLegacy(enc, tiles8, legacyTarget)
      updater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b)
      return s[s.length >> 1]
    }

    // 2a. GPU Timestamp-Query Interleaved A/B (15 rounds, alternating A-then-B / B-then-A).
    let gpuLegacyMs = null
    let gpuComputeMs = null
    let gpuSpeedupPct = null
    if (gpu.canTime) {
      const ROUNDS = 15
      const querySet = device.createQuerySet({ type: 'timestamp', count: 4 })
      const resolveBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const readTsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const legacySamples = []
      const computeSamples = []
      for (let r = 0; r < ROUNDS; r++) {
        const computeFirst = (r & 1) === 1
        const enc = device.createCommandEncoder()
        if (computeFirst) {
          updater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind, { querySet, begin: 0, end: 1 })
          encodeLegacy(enc, tiles8, legacyTarget, legacyPipe, { querySet, begin: 2, end: 3 })
        } else {
          encodeLegacy(enc, tiles8, legacyTarget, legacyPipe, { querySet, begin: 0, end: 1 })
          updater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind, { querySet, begin: 2, end: 3 })
        }
        enc.resolveQuerySet(querySet, 0, 4, resolveBuf, 0)
        enc.copyBufferToBuffer(resolveBuf, 0, readTsBuf, 0, 32)
        device.queue.submit([enc.finish()])
        await readTsBuf.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(readTsBuf.getMappedRange().slice(0))
        readTsBuf.unmap()
        const d0 = ts[1] > ts[0] ? Number(ts[1] - ts[0]) / 1e6 : null
        const d1 = ts[3] > ts[2] ? Number(ts[3] - ts[2]) / 1e6 : null
        const leg = computeFirst ? d1 : d0
        const cmp = computeFirst ? d0 : d1
        if (leg !== null && cmp !== null) {
          legacySamples.push(leg)
          computeSamples.push(cmp)
        }
      }
      querySet.destroy()
      resolveBuf.destroy()
      readTsBuf.destroy()
      if (legacySamples.length) {
        gpuLegacyMs = median(legacySamples)
        gpuComputeMs = median(computeSamples)
        gpuSpeedupPct = ((gpuLegacyMs - gpuComputeMs) / gpuLegacyMs) * 100
      }
    }

    // 2b. Interleaved Paced Wall-Time Benchmark (batch of frames + queue.onSubmittedWorkDone + 1-texel readback).
    const paceBatch = async (isCompute, frames) => {
      const pixelBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const target = isCompute ? computeTarget : legacyTarget
      const t0 = performance.now()
      for (let i = 0; i < frames; i++) {
        const enc = device.createCommandEncoder()
        if (isCompute) updater.dispatch(enc, tiles8, target.arrayView, worldBind)
        else encodeLegacy(enc, tiles8, target)
        device.queue.submit([enc.finish()])
      }
      const syncEnc = device.createCommandEncoder()
      syncEnc.copyTextureToBuffer({ texture: target.texture }, { buffer: pixelBuf, bytesPerRow: 256 }, [1, 1, 1])
      device.queue.submit([syncEnc.finish()])
      await device.queue.onSubmittedWorkDone()
      await pixelBuf.mapAsync(GPUMapMode.READ)
      pixelBuf.unmap()
      const elapsed = performance.now() - t0
      pixelBuf.destroy()
      return elapsed / frames
    }

    const PACE_ROUNDS = 7
    const PACE_FRAMES = 40
    const paceLegacySamples = []
    const paceComputeSamples = []
    for (let r = 0; r < PACE_ROUNDS; r++) {
      if ((r & 1) === 0) {
        paceLegacySamples.push(await paceBatch(false, PACE_FRAMES))
        paceComputeSamples.push(await paceBatch(true, PACE_FRAMES))
      } else {
        paceComputeSamples.push(await paceBatch(true, PACE_FRAMES))
        paceLegacySamples.push(await paceBatch(false, PACE_FRAMES))
      }
    }
    const paceLegacyMs = median(paceLegacySamples)
    const paceComputeMs = median(paceComputeSamples)
    const paceSpeedupPct = ((paceLegacyMs - paceComputeMs) / paceLegacyMs) * 100

    // 2c. Interleaved JS Command-Encoding Benchmark (CPU encode + writeBuffer cost per 8-tile update).
    const ENCODE_ROUNDS = 9
    const ENCODE_ITERS = 60
    const encLegacySamples = []
    const encComputeSamples = []
    const measureEncode = (isCompute) => {
      const t0 = performance.now()
      for (let i = 0; i < ENCODE_ITERS; i++) {
        const enc = device.createCommandEncoder()
        if (isCompute) updater.dispatch(enc, tiles8, computeTarget.arrayView, worldBind)
        else encodeLegacy(enc, tiles8, legacyTarget)
        enc.finish()
      }
      return (performance.now() - t0) / ENCODE_ITERS
    }
    for (let r = 0; r < ENCODE_ROUNDS; r++) {
      if ((r & 1) === 0) {
        encLegacySamples.push(measureEncode(false))
        encComputeSamples.push(measureEncode(true))
      } else {
        encComputeSamples.push(measureEncode(true))
        encLegacySamples.push(measureEncode(false))
      }
    }
    const cpuLegacyMs = median(encLegacySamples)
    const cpuComputeMs = median(encComputeSamples)
    const cpuSpeedupPct = ((cpuLegacyMs - cpuComputeMs) / cpuLegacyMs) * 100

    // Clean up all GPU resources and confirm destroyed state.
    const finalStats = updater.stats()
    updater.destroy()
    fineUpdater.destroy()
    const statsAfterDestroy = updater.stats()
    sunMaps.texture.destroy()
    legacyTarget.texture.destroy()
    computeTarget.texture.destroy()
    globalsBuf.destroy()
    boxesBuf.destroy()
    for (const s of legacyTileSlots) s.buffer.destroy()

    return {
      canTime: gpu.canTime,
      faults: gpu.faults,
      wgslHasEntry: SUN_TILE_BATCH_WGSL.includes('fn cs_sun_tiles'),
      parity8,
      untouchedCorrupted,
      fineParity,
      emptyNoOp: {
        dispatchesUnchanged: statsBeforeEmpty.dispatches === statsAfterEmpty.dispatches,
        lastTileCount: statsAfterEmpty.lastTileCount,
      },
      maxBatch: {
        dispatched: maxBatchDispatched,
        clampedDispatched,
        parity16,
      },
      bench: {
        gpuLegacyMs,
        gpuComputeMs,
        gpuSpeedupPct,
        paceLegacyMs,
        paceComputeMs,
        paceSpeedupPct,
        cpuLegacyMs,
        cpuComputeMs,
        cpuSpeedupPct,
      },
      finalStats,
      destroyed: statsAfterDestroy.destroyed,
    }
  })

  // ── Assertions ─────────────────────────────────────────────────────────────
  check(result.faults.length === 0, `zero WebGPU faults (${result.faults.length})`)
  check(result.wgslHasEntry, 'SUN_TILE_BATCH_WGSL exports cs_sun_tiles entry point')

  // Test 1: Bit-Exact Parity (8 tiles = 32,768 texels across levels 0..3)
  check(
    result.parity8.texels === 32768 &&
      result.parity8.maxAbsDiff === 0 &&
      result.parity8.bitMismatches === 0 &&
      result.parity8.nanOrInf === 0 &&
      result.parity8.sentinelLeaks === 0 &&
      result.parity8.hitTexels > 1000 &&
      result.parity8.missTexels > 0,
    `Test 1 bit-exact parity (8 tiles, ${result.parity8.texels} texels, levels 0..3): maxAbsDiff=${result.parity8.maxAbsDiff}, bitMismatches=${result.parity8.bitMismatches}, nanOrInf=${result.parity8.nanOrInf}, hits=${result.parity8.hitTexels} [${result.parity8.minHit.toFixed(1)}..${result.parity8.maxHit.toFixed(1)}], misses=${result.parity8.missTexels}`,
  )
  check(
    result.untouchedCorrupted === 0,
    `Test 1 untouched tile slots uncorrupted across all 4 levels (corrupted=${result.untouchedCorrupted})`,
  )
  check(
    result.fineParity.maxAbsDiff === 0 && result.fineParity.bitMismatches === 0 && result.fineParity.nanOrInf === 0,
    `Test 1 fineSun bit-0 marking parity (32,768 texels): maxAbsDiff=${result.fineParity.maxAbsDiff}, bitMismatches=${result.fineParity.bitMismatches}`,
  )

  // Test 3: Multi-level & Edge Cases
  check(
    result.emptyNoOp.dispatchesUnchanged && result.emptyNoOp.lastTileCount === 0,
    `Test 3 empty batch (tiles.length === 0) no-op: dispatchesUnchanged=${result.emptyNoOp.dispatchesUnchanged}, lastTileCount=${result.emptyNoOp.lastTileCount}`,
  )
  check(
    result.maxBatch.dispatched === 16 &&
      result.maxBatch.clampedDispatched === 16 &&
      result.maxBatch.parity16.texels === 65536 &&
      result.maxBatch.parity16.maxAbsDiff === 0 &&
      result.maxBatch.parity16.bitMismatches === 0 &&
      result.maxBatch.parity16.nanOrInf === 0,
    `Test 3 max batch (16 tiles, 65,536 texels across levels 0..3) + clamp(>16->16): maxAbsDiff=${result.maxBatch.parity16.maxAbsDiff}, bitMismatches=${result.maxBatch.parity16.bitMismatches}`,
  )
  check(result.destroyed, `Test 3 destroy() cleans up resources (destroyed=${result.destroyed})`)

  // Test 2: A/B Benchmark Report
  const b = result.bench
  check(
    (!result.canTime || (b.gpuLegacyMs > 0 && b.gpuComputeMs > 0)) && b.paceLegacyMs > 0 && b.paceComputeMs > 0 && b.cpuLegacyMs > 0 && b.cpuComputeMs > 0,
    `Test 2 A/B benchmark (8 tiles): GPU=${b.gpuLegacyMs !== null ? `${b.gpuLegacyMs.toFixed(3)}ms -> ${b.gpuComputeMs.toFixed(3)}ms (${b.gpuSpeedupPct >= 0 ? '+' : ''}${b.gpuSpeedupPct.toFixed(1)}%)` : 'n/a'}, paced=${b.paceLegacyMs.toFixed(3)}ms -> ${b.paceComputeMs.toFixed(3)}ms (${b.paceSpeedupPct >= 0 ? '+' : ''}${b.paceSpeedupPct.toFixed(1)}%), CPU encode=${b.cpuLegacyMs.toFixed(4)}ms -> ${b.cpuComputeMs.toFixed(4)}ms (${b.cpuSpeedupPct >= 0 ? '+' : ''}${b.cpuSpeedupPct.toFixed(1)}%)`,
  )

  await finish('sun-compute')
} catch (err) {
  console.error(err)
  await finish('sun-compute', 1, 'error')
}
