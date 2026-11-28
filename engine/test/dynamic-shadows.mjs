// Real headless Chrome WebGPU verification for engine/page/dynamic-shadows.ts (#165).
//
// Exercises createDynamicShadows(device) on the real GPU:
//   Test 1: No casters = fully lit (1.0 everywhere, stale shadow cleanup, zero GPU faults)
//   Test 2: Box OBB + rigid mesh + pieces merged-face shadow accuracy, soft PCF penumbra,
//           zero shadow acne on ground & caster top, plus branched fragment-shader verification
//   Test 3: Texel-snapping camera-move stability across 10 sub-texel + boundary-crossing frames
//   Test 4: Cascade 0 (20 m) -> cross-fade (44 m) -> Cascade 1 (100 m) handoff &
//           500-caster GPU performance via timestamp-query
//
//   node engine/test/dynamic-shadows.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route(`${url}/dynamic-shadows-test.html`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>dynamic-shadows test</title></head><body></body></html>',
  }))
  await page.goto(`${url}/dynamic-shadows-test.html`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader } = await import('/probe/gpu.ts')
    const {
      createDynamicShadows,
      DYNAMIC_SHADOW_WGSL,
      dynamicShadowBindings,
    } = await import('/page/dynamic-shadows.ts')

    const gpu = await openGpu()
    const { device } = gpu
    const shadows = await createDynamicShadows(device, 1024)

    // ── Compute Probe Harness exercising DYNAMIC_SHADOW_WGSL directly ────────
    const MAX_PROBES = 1024
    const probeWgsl = /* wgsl */ `
${dynamicShadowBindings(0, 0)}
struct ProbePoint {
  pos: vec4f,
  norm: vec4f,
}
struct ProbeInfo {
  count: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}
@group(1) @binding(0) var<uniform> probeInfo: ProbeInfo;
@group(1) @binding(1) var<storage, read> probes: array<ProbePoint>;
@group(1) @binding(2) var<storage, read_write> results: array<f32>;
${DYNAMIC_SHADOW_WGSL}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= probeInfo.count) { return; }
  let p = probes[idx];
  results[idx] = sampleDynamicSunShadow(p.pos.xyz, normalize(p.norm.xyz));
}
`
    const probeMod = await shader(device, 'dyn-shadow-probe', probeWgsl)
    const probePipe = await device.createComputePipelineAsync({
      label: 'dyn-shadow-probe',
      layout: 'auto',
      compute: { module: probeMod, entryPoint: 'main' },
    })

    const metaBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const probeInBuf = device.createBuffer({ size: MAX_PROBES * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    const probeOutBuf = device.createBuffer({ size: MAX_PROBES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const probeReadBuf = device.createBuffer({ size: MAX_PROBES * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })

    const probeBg0 = device.createBindGroup({
      layout: probePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shadows.uniformBuffer } },
        { binding: 1, resource: shadows.shadowTextureView },
        { binding: 2, resource: shadows.compareSampler },
      ],
    })
    const probeBg1 = device.createBindGroup({
      layout: probePipe.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: metaBuf } },
        { binding: 1, resource: { buffer: probeInBuf } },
        { binding: 2, resource: { buffer: probeOutBuf } },
      ],
    })

    // ── Fragment-Shader Branch Harness (verifies Safari-safe textureSampleCompareLevel in fragment branches) ──
    const fragWgsl = /* wgsl */ `
${dynamicShadowBindings(0, 0)}
struct FragRegion {
  // x: minX, y: maxX, z: minZ, w: maxZ
  bounds: vec4f,
}
@group(1) @binding(0) var<uniform> region: FragRegion;
${DYNAMIC_SHADOW_WGSL}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[vi];
  var out: VsOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = xy * 0.5 + 0.5;
  return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  var s = 1.0;
  // Intentionally non-uniform / conditional branch to verify textureSampleCompareLevel compiles & executes safely.
  if (in.uv.x >= 0.0 && in.uv.y >= 0.0) {
    let wx = mix(region.bounds.x, region.bounds.y, in.uv.x);
    let wz = mix(region.bounds.z, region.bounds.w, in.uv.y);
    s = sampleDynamicSunShadow(vec3f(wx, 0.0, wz), vec3f(0.0, 1.0, 0.0));
  }
  return vec4f(s, s, s, 1.0);
}
`
    const fragMod = await shader(device, 'dyn-shadow-frag-probe', fragWgsl)
    const fragPipe = await device.createRenderPipelineAsync({
      label: 'dyn-shadow-frag-probe',
      layout: 'auto',
      vertex: { module: fragMod, entryPoint: 'vs' },
      fragment: { module: fragMod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    })
    const fragRegionBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const fragTex = device.createTexture({
      size: [64, 64],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const fragBg0 = device.createBindGroup({
      layout: fragPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: shadows.uniformBuffer } },
        { binding: 1, resource: shadows.shadowTextureView },
        { binding: 2, resource: shadows.compareSampler },
      ],
    })
    const fragBg1 = device.createBindGroup({
      layout: fragPipe.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: fragRegionBuf } }],
    })

    async function evalProbes(points) {
      const count = points.length
      const inData = new Float32Array(count * 8)
      for (let i = 0; i < count; i++) {
        const [p, n] = points[i]
        inData[i * 8 + 0] = p[0]
        inData[i * 8 + 1] = p[1]
        inData[i * 8 + 2] = p[2]
        inData[i * 8 + 3] = 0
        inData[i * 8 + 4] = n[0]
        inData[i * 8 + 5] = n[1]
        inData[i * 8 + 6] = n[2]
        inData[i * 8 + 7] = 0
      }
      device.queue.writeBuffer(metaBuf, 0, new Uint32Array([count, 0, 0, 0]))
      device.queue.writeBuffer(probeInBuf, 0, inData)
      const enc = device.createCommandEncoder()
      const pass = enc.beginComputePass()
      pass.setPipeline(probePipe)
      pass.setBindGroup(0, probeBg0)
      pass.setBindGroup(1, probeBg1)
      pass.dispatchWorkgroups(Math.ceil(count / 64))
      pass.end()
      enc.copyBufferToBuffer(probeOutBuf, 0, probeReadBuf, 0, count * 4)
      device.queue.submit([enc.finish()])
      await probeReadBuf.mapAsync(GPUMapMode.READ)
      const out = Array.from(new Float32Array(probeReadBuf.getMappedRange(0, count * 4).slice(0)))
      probeReadBuf.unmap()
      return out
    }

    async function renderFragRegion(minX, maxX, minZ, maxZ) {
      device.queue.writeBuffer(fragRegionBuf, 0, new Float32Array([minX, maxX, minZ, maxZ]))
      const readBuf = device.createBuffer({ size: 256 * 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: fragTex.createView(), loadOp: 'clear', clearValue: [1, 1, 1, 1], storeOp: 'store' }],
      })
      pass.setPipeline(fragPipe)
      pass.setBindGroup(0, fragBg0)
      pass.setBindGroup(1, fragBg1)
      pass.draw(3)
      pass.end()
      enc.copyTextureToBuffer({ texture: fragTex }, { buffer: readBuf, bytesPerRow: 256 }, [64, 64])
      device.queue.submit([enc.finish()])
      await readBuf.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(readBuf.getMappedRange().slice(0))
      readBuf.unmap()
      readBuf.destroy()
      let minVal = 1, maxVal = 0, pcfCount = 0
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const v = bytes[y * 256 + x * 4] / 255
          if (v < minVal) minVal = v
          if (v > maxVal) maxVal = v
          if (v > 0.1 && v < 0.9) pcfCount++
        }
      }
      return { minVal, maxVal, pcfCount }
    }

    // Build a rigid triangle-list cube vertex buffer (half-size = 10 cells, 36 verts).
    const makeCubeVerts = (h) => new Float32Array([
       h, -h, -h,   h,  h, -h,   h,  h,  h,   h, -h, -h,   h,  h,  h,   h, -h,  h,
      -h, -h,  h,  -h,  h,  h,  -h,  h, -h,  -h, -h,  h,  -h,  h, -h,  -h, -h, -h,
      -h,  h,  h,   h,  h,  h,   h,  h, -h,  -h,  h,  h,   h,  h, -h,  -h,  h, -h,
      -h, -h, -h,   h, -h, -h,   h, -h,  h,  -h, -h, -h,   h, -h,  h,  -h, -h,  h,
      -h, -h,  h,   h, -h,  h,   h,  h,  h,  -h, -h,  h,   h,  h,  h,  -h,  h,  h,
       h, -h, -h,  -h, -h, -h,  -h,  h, -h,   h, -h, -h,  -h,  h, -h,   h,  h, -h,
    ])
    const meshCubeVerts = makeCubeVerts(10)
    const meshCubeBuf = device.createBuffer({
      label: 'test-rigid-cube',
      size: meshCubeVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(meshCubeBuf, 0, meshCubeVerts)

    // Build a pieces.ts merged-face solid slab (20 x 12 x 20 cells, top + 4 side faces in 24-byte stride).
    const pieceFaces = []
    const pushFace = (sx, sy, sz, long, axis, side) => {
      const a = (sx & 1023) | ((sy & 1023) << 10) | ((sz & 1023) << 20)
      const b = (long & 255) | ((axis & 3) << 8) | ((side & 1) << 10)
      pieceFaces.push(a >>> 0, b >>> 0, 0, 0, 0, 0)
    }
    for (let z = 0; z < 20; z++) pushFace(0, 11, z, 20, 1, 1) // +Y roof (20 x 20)
    for (let y = 0; y < 12; y++) pushFace(0, y, 19, 20, 2, 1) // +Z front wall
    const pieceFaceData = new Uint32Array(pieceFaces)
    const pieceFaceBuf = device.createBuffer({
      label: 'test-piece-faces',
      size: pieceFaceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(pieceFaceBuf, 0, pieceFaceData)

    const SUN_45 = [0, Math.SQRT1_2, Math.SQRT1_2]
    const UP = [0, 1, 0]

    // ── TEST 1: No Casters = Fully Lit ───────────────────────────────────────
    shadows.updateView([0, 20, 0], SUN_45)
    shadows.beginFrame()
    {
      const enc = device.createCommandEncoder()
      shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const t1Grid = []
    for (let iz = -7; iz <= 8; iz++) {
      for (let ix = -7; ix <= 8; ix++) {
        t1Grid.push([[ix * 35, 0, iz * 35], UP])
      }
    }
    const t1Vals = await evalProbes(t1Grid)
    const t1Min = Math.min(...t1Vals)
    const t1Max = Math.max(...t1Vals)
    const t1Active = shadows.stats().active

    // ── TEST 2: Box OBB + Rigid Mesh + Piece Faces + PCF Penumbra + Zero Acne ─
    shadows.updateView([0, 30, 0], SUN_45)
    shadows.beginFrame()
    // Car-sized OBB: 2.0 m wide x 1.5 m tall x 4.0 m long (halfExtents [10, 7.5, 20]) centered at (-40, 10, 40).
    // With sun (0, +1/sqrt2, +1/sqrt2), shadow projects onto y=0 at x in [-50, -30], z in [2.5, 57.5].
    shadows.addBoxCaster([-40, 10, 40], [10, 7.5, 20], [0, 0, 0, 1])
    // 45-deg yaw rotated long bar OBB at (-90, 15, 0), halfExtents [20, 6, 4]: verifies quaternion rotation.
    // Rotated +X axis points along (+0.707, 0, -0.707); tip at (-90 + 11, 15, -11) projects shadow to (-79, 0, -26).
    const qYaw45 = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]
    shadows.addBoxCaster([-90, 15, 0], [20, 6, 4], qYaw45)
    {
      const enc = device.createCommandEncoder()
      shadows.render(enc, (pass) => {
        // Raised rigid mesh cube (half-size 10) at (45, 25, 40) -> shadow on y=0 at x in [35, 55], z in [-5, 35].
        shadows.drawMesh(pass, meshCubeBuf, 36, [45, 25, 40], [0, 0, 0, 1])
        // Pieces merged-face block (20x12x20, com=[10,6,10]) at (0, 20, -40) -> shadow center on y=0 near (0, 0, -60).
        shadows.drawPieceFaces(pass, pieceFaceBuf, pieceFaceData.length / 6, [0, 20, -40], [0, 0, 0, 1], [10, 6, 10], 1)
      })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    const t2Stats = shadows.stats()
    // Umbra + outside probes (including rotated OBB shadow tip vs unrotated-would-be-lit point)
    const [boxUmbra, boxLit, meshUmbra, meshLit, pieceUmbra, rotTipUmbra, rotSideLit] = await evalProbes([
      [[-40, 0, 30], UP],
      [[-40, 0, 90], UP],
      [[45, 0, 15], UP],
      [[45, 0, 90], UP],
      [[0, 0, -60], UP],
      [[-79, 0, -26], UP], // inside 45-deg rotated bar's shadow (would be lit if unrotated!)
      [[-73, 0, -15], UP], // outside 45-deg rotated bar's shadow (would be shadowed if unrotated!)
    ])

    // Edge scans for soft PCF penumbra (0.1 < s < 0.9) on both OBB and rigid mesh shadows.
    const boxEdgeProbes = []
    for (let i = 0; i <= 40; i++) boxEdgeProbes.push([[-55 + i * 0.25, 0, 30], UP])
    const boxEdgeVals = await evalProbes(boxEdgeProbes)
    const boxPcfMid = boxEdgeVals.filter((v) => v > 0.1 && v < 0.9)

    const meshEdgeProbes = []
    for (let i = 0; i <= 40; i++) meshEdgeProbes.push([[30 + i * 0.25, 0, 15], UP])
    const meshEdgeVals = await evalProbes(meshEdgeProbes)
    const meshPcfMid = meshEdgeVals.filter((v) => v > 0.1 && v < 0.9)

    // Flat lit receiver acne check (100 ground points outside all shadows) + caster top-face self-acne check.
    const litGroundProbes = []
    for (let iz = 0; iz < 10; iz++) {
      for (let ix = 0; ix < 10; ix++) {
        litGroundProbes.push([[-120 + ix * 25, 0, 80 + iz * 15], UP])
      }
    }
    const litGroundVals = await evalProbes(litGroundProbes)
    const litGroundMin = Math.min(...litGroundVals)

    const carRoofProbes = []
    for (let iz = 0; iz < 5; iz++) {
      for (let ix = 0; ix < 5; ix++) {
        carRoofProbes.push([[-48 + ix * 4, 17.5, 24 + iz * 8], UP])
      }
    }
    const carRoofVals = await evalProbes(carRoofProbes)
    const carRoofMin = Math.min(...carRoofVals)

    // Fragment-shader branch check over the OBB car shadow footprint.
    const fragCheck = await renderFragRegion(-60, -20, 0, 70)

    // Stale-shadow cleanup check: empty frame after active casters must return 1.0 at previous umbra.
    shadows.beginFrame()
    {
      const enc = device.createCommandEncoder()
      shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const [clearedUmbra] = await evalProbes([[[-40, 0, 30], UP]])

    // ── TEST 3: Texel-Snapping Camera-Move Stability ─────────────────────────
    const renderStaticEdge = async (eye) => {
      shadows.updateView(eye, SUN_45)
      shadows.beginFrame()
      shadows.addBoxCaster([0, 15, 15], [12, 10, 12], [0, 0, 0, 1])
      const enc = device.createCommandEncoder()
      shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    // Frame 0: scan shadow edge around x = -12, z = 0 to pick world-fixed edge probe points with 0.15 < s < 0.85.
    await renderStaticEdge([0, 25, 0])
    const edgeScanPoints = []
    for (let i = 0; i <= 60; i++) edgeScanPoints.push([[-15 + i * 0.1, 0, 0], UP])
    const edgeScanVals = await evalProbes(edgeScanPoints)
    const edgeFixedProbes = []
    for (let i = 0; i < edgeScanVals.length; i++) {
      if (edgeScanVals[i] > 0.18 && edgeScanVals[i] < 0.82) {
        edgeFixedProbes.push(edgeScanPoints[i])
      }
    }
    // Keep up to 8 representative edge probes.
    const trackedProbes = edgeFixedProbes.slice(0, 8)
    const baselineEdge = await evalProbes(trackedProbes)

    // Move camera smoothly across 10 frames in sub-texel increments (crossing >2 texels total in U and V).
    let maxEdgeDelta = 0
    for (let frame = 1; frame <= 10; frame++) {
      const eye = [frame * 0.23, 25 + frame * 0.11, frame * 0.19]
      await renderStaticEdge(eye)
      const vals = await evalProbes(trackedProbes)
      for (let k = 0; k < vals.length; k++) {
        const d = Math.abs(vals[k] - baselineEdge[k])
        if (d > maxEdgeDelta) maxEdgeDelta = d
      }
    }

    // ── TEST 4: Cascade 0 -> Cascade 1 Handoff & 500-Caster GPU Timing ───────
    shadows.updateView([0, 20, 0], SUN_45)
    shadows.beginFrame()
    // Near caster at 20 m (200 cells, Cascade 0) -> shadow center at (200, 0, -15)
    shadows.addBoxCaster([200, 15, 0], [12, 12, 12], [0, 0, 0, 1])
    // Blend-band caster at 44 m (440 cells, C0->C1 cross-fade band [0.85..0.998]) -> shadow center at (440, 0, -15)
    shadows.addBoxCaster([440, 15, 0], [14, 12, 14], [0, 0, 0, 1])
    // Mid caster at 100 m (1000 cells, Cascade 1) -> shadow center at (1000, 0, -25)
    shadows.addBoxCaster([1000, 25, 0], [20, 20, 20], [0, 0, 0, 1])
    {
      const enc = device.createCommandEncoder()
      shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const [c0Umbra, c0Lit, blendUmbra, c1Umbra, c1Lit, outsideC1] = await evalProbes([
      [[200, 0, -15], UP],
      [[200, 0, 60], UP],
      [[440, 0, -15], UP],
      [[1000, 0, -25], UP],
      [[1000, 0, 90], UP],
      [[2000, 0, 0], UP],
    ])

    // Verify smooth cross-fade continuity across C0->C1 boundary with a long continuous wall caster at x in [360..540].
    shadows.updateView([0, 20, 0], SUN_45)
    shadows.beginFrame()
    shadows.addBoxCaster([450, 15, 0], [90, 12, 12], [0, 0, 0, 1])
    {
      const enc = device.createCommandEncoder()
      shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const handoffProbes = []
    for (let x = 380; x <= 520; x += 5) handoffProbes.push([[x, 0, -15], UP])
    const handoffVals = await evalProbes(handoffProbes)
    const handoffMax = Math.max(...handoffVals)

    // 500-caster GPU timing benchmark across both 1024x1024 cascades via timestamp-query.
    shadows.updateView([0, 20, 0], SUN_45)
    shadows.beginFrame()
    for (let i = 0; i < 500; i++) {
      const ring = i < 200 ? 40 + (i % 40) * 10 : 500 + ((i - 200) % 100) * 10
      const ang = i * 2.399963229728653
      const cx = Math.cos(ang) * ring
      const cz = Math.sin(ang) * ring
      const yaw = (i * 0.37) % (Math.PI * 2)
      shadows.addBoxCasterRaw(
        cx, 10, cz,
        10, 7.5, 22,
        0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5),
      )
    }
    const benchCasters = shadows.stats().boxCasters

    // Warm up 5 frames back-to-back so GPU clocks ramp up cleanly.
    {
      const enc = device.createCommandEncoder()
      for (let w = 0; w < 5; w++) shadows.render(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    let gpuTotalMs = null
    let gpuC0Ms = null
    let gpuC1Ms = null
    if (gpu.canTime) {
      const SAMPLES = 11
      const querySet = device.createQuerySet({ type: 'timestamp', count: SAMPLES * 4 })
      const resolveBuf = device.createBuffer({ size: SAMPLES * 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const readTsBuf = device.createBuffer({ size: SAMPLES * 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      for (let i = 0; i < SAMPLES; i++) {
        const b = i * 4
        shadows.render(enc, undefined, [
          { querySet, beginningOfPassWriteIndex: b + 0, endOfPassWriteIndex: b + 1 },
          { querySet, beginningOfPassWriteIndex: b + 2, endOfPassWriteIndex: b + 3 },
        ])
      }
      enc.resolveQuerySet(querySet, 0, SAMPLES * 4, resolveBuf, 0)
      enc.copyBufferToBuffer(resolveBuf, 0, readTsBuf, 0, SAMPLES * 32)
      device.queue.submit([enc.finish()])
      await readTsBuf.mapAsync(GPUMapMode.READ)
      const ts = new BigUint64Array(readTsBuf.getMappedRange().slice(0))
      readTsBuf.unmap()
      const totals = []
      const c0s = []
      const c1s = []
      for (let i = 0; i < SAMPLES; i++) {
        const b = i * 4
        if (ts[b + 1] > ts[b + 0] && ts[b + 3] > ts[b + 2]) {
          const d0 = Number(ts[b + 1] - ts[b + 0]) / 1e6
          const d1 = Number(ts[b + 3] - ts[b + 2]) / 1e6
          c0s.push(d0)
          c1s.push(d1)
          totals.push(d0 + d1)
        }
      }
      querySet.destroy()
      resolveBuf.destroy()
      readTsBuf.destroy()
      if (totals.length) {
        totals.sort((a, b) => a - b)
        c0s.sort((a, b) => a - b)
        c1s.sort((a, b) => a - b)
        const mid = totals.length >> 1
        gpuTotalMs = totals[mid]
        gpuC0Ms = c0s[mid]
        gpuC1Ms = c1s[mid]
      }
    }

    // Cleanup all resources.
    shadows.destroy()
    metaBuf.destroy()
    probeInBuf.destroy()
    probeOutBuf.destroy()
    probeReadBuf.destroy()
    fragRegionBuf.destroy()
    fragTex.destroy()
    meshCubeBuf.destroy()
    pieceFaceBuf.destroy()

    return {
      canTime: gpu.canTime,
      faults: gpu.faults,
      t1: { min: t1Min, max: t1Max, active: t1Active, clearedUmbra },
      t2: {
        boxUmbra, boxLit, meshUmbra, meshLit, pieceUmbra, rotTipUmbra, rotSideLit,
        boxPcfCount: boxPcfMid.length,
        boxPcfSample: boxPcfMid[Math.floor(boxPcfMid.length / 2)] ?? null,
        meshPcfCount: meshPcfMid.length,
        meshPcfSample: meshPcfMid[Math.floor(meshPcfMid.length / 2)] ?? null,
        litGroundMin,
        carRoofMin,
        fragCheck,
        meshDraws: t2Stats.meshDraws,
      },
      t3: {
        trackedCount: trackedProbes.length,
        maxEdgeDelta,
        baselineSample: baselineEdge[0] ?? null,
      },
      t4: {
        c0Umbra, c0Lit, blendUmbra, c1Umbra, c1Lit, outsideC1,
        handoffMax,
        benchCasters,
        gpuTotalMs,
        gpuC0Ms,
        gpuC1Ms,
      },
    }
  })

  // ── Assertions ─────────────────────────────────────────────────────────────
  check(result.faults.length === 0, `zero WebGPU faults (${result.faults.length})`)

  // Test 1
  check(result.t1.min === 1 && result.t1.max === 1 && !result.t1.active,
    `Test 1 empty frame fully lit: min=${result.t1.min.toFixed(4)}, max=${result.t1.max.toFixed(4)}, active=${result.t1.active}`)
  check(result.t1.clearedUmbra === 1,
    `Test 1 stale-shadow cleanup after active frame: umbra=${result.t1.clearedUmbra.toFixed(4)}`)

  // Test 2
  check(result.t2.boxUmbra < 0.05 && result.t2.boxLit > 0.99 && result.t2.rotTipUmbra < 0.05 && result.t2.rotSideLit > 0.99,
    `Test 2 OBB caster shadow (aligned + 45° rotated): umbra=${result.t2.boxUmbra.toFixed(4)}, lit=${result.t2.boxLit.toFixed(4)}, rotTip=${result.t2.rotTipUmbra.toFixed(4)}, rotSide=${result.t2.rotSideLit.toFixed(4)}`)
  check(result.t2.meshUmbra < 0.05 && result.t2.meshLit > 0.99 && result.t2.pieceUmbra < 0.05,
    `Test 2 rigid mesh & piece-faces shadows: meshUmbra=${result.t2.meshUmbra.toFixed(4)}, meshLit=${result.t2.meshLit.toFixed(4)}, pieceUmbra=${result.t2.pieceUmbra.toFixed(4)}, draws=${result.t2.meshDraws}`)
  check(result.t2.boxPcfCount >= 2 && result.t2.meshPcfCount >= 2,
    `Test 2 soft PCF penumbra (0.1<s<0.9): boxEdgePts=${result.t2.boxPcfCount} (mid=${result.t2.boxPcfSample?.toFixed(3)}), meshEdgePts=${result.t2.meshPcfCount} (mid=${result.t2.meshPcfSample?.toFixed(3)})`)
  check(result.t2.litGroundMin > 0.99 && result.t2.carRoofMin > 0.99,
    `Test 2 zero shadow acne: flatGroundMin=${result.t2.litGroundMin.toFixed(4)} (>0.99), casterRoofMin=${result.t2.carRoofMin.toFixed(4)} (>0.99)`)
  check(result.t2.fragCheck.minVal < 0.05 && result.t2.fragCheck.maxVal > 0.99 && result.t2.fragCheck.pcfCount > 0,
    `Test 2 branched fragment shader: min=${result.t2.fragCheck.minVal.toFixed(3)}, max=${result.t2.fragCheck.maxVal.toFixed(3)}, pcfPx=${result.t2.fragCheck.pcfCount}`)

  // Test 3
  check(result.t3.trackedCount >= 2 && result.t3.maxEdgeDelta < 0.02,
    `Test 3 texel-snapped camera-move stability (10 frames, ${result.t3.trackedCount} edge probes): maxDelta=${result.t3.maxEdgeDelta.toFixed(5)} (<0.02)`)

  // Test 4
  check(result.t4.c0Umbra < 0.05 && result.t4.c0Lit > 0.99,
    `Test 4 Cascade 0 (20 m): umbra=${result.t4.c0Umbra.toFixed(4)}, lit=${result.t4.c0Lit.toFixed(4)}`)
  check(result.t4.blendUmbra < 0.05 && result.t4.handoffMax < 0.05,
    `Test 4 C0->C1 cross-fade handoff (44 m & continuous wall): blendUmbra=${result.t4.blendUmbra.toFixed(4)}, wallMax=${result.t4.handoffMax.toFixed(4)}`)
  check(result.t4.c1Umbra < 0.05 && result.t4.c1Lit > 0.99 && result.t4.outsideC1 > 0.99,
    `Test 4 Cascade 1 (100 m) & outer fade (200 m): umbra=${result.t4.c1Umbra.toFixed(4)}, lit=${result.t4.c1Lit.toFixed(4)}, outside=${result.t4.outsideC1.toFixed(4)}`)
  check(result.t4.benchCasters === 500 && (!result.canTime || (result.t4.gpuTotalMs !== null && result.t4.gpuTotalMs > 0)),
    `Test 4 GPU performance (500 OBB casters, 2x1024^2): ${result.t4.gpuTotalMs !== null ? `${result.t4.gpuTotalMs.toFixed(3)} ms total (C0=${result.t4.gpuC0Ms.toFixed(3)} ms, C1=${result.t4.gpuC1Ms.toFixed(3)} ms)` : 'timestamp-query unavailable'}`)

  await finish('dynamic-shadows')
} catch (err) {
  console.error(err)
  await finish('dynamic-shadows', 1, 'error')
}
