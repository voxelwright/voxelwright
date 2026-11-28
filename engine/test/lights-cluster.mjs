// Real headless Chrome WebGPU verification for engine/page/lights-cluster.ts (#165).
//
// Populates 512 dynamic point & spot lights on the real GPU and verifies:
//   - Test 1 (Vertical & Depth Separation): street level (Y = 5 m) vs skyscraper roof (Y = 120 m)
//     at identical (X, Z), plus near (25 m) vs far (180 m) depth lights along the camera ray ->
//     zero cross-contamination across 3D clusters.
//   - Test 2 (Frustum Culling): 100 lights behind the camera & far outside the frustum ->
//     0 appear in any of the 3,456 clusters.
//   - Test 3 (Brute-Force Reference Equivalence): fullscreen render shader evaluates
//     evalClusteredLightsGGX vs brute-force loop over all 512 lights across a synthetic 3D scene
//     of ground plane + skyscraper towers -> max pixel error < 1e-4, zero NaN/Inf, zero gpu.faults.
//   - Test 4 (Performance & Bounds Dirty Cache): verifies cs_cluster_bounds skips re-dispatch when
//     projection is unchanged, re-dispatches when projection changes, and measures cs_cluster_cull
//     GPU time for 512 lights via WebGPU timestamp-query.
//
//   node engine/test/lights-cluster.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route(`${url}/lights-cluster-test.html`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>lights-cluster test</title></head><body></body></html>',
  }))
  await page.goto(`${url}/lights-cluster-test.html`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader } = await import('/probe/gpu.ts')
    const {
      createClusteredLights,
      CLUSTER_X,
      CLUSTER_Y,
      CLUSTER_Z,
      CLUSTER_COUNT,
      MAX_CLUSTER_LIGHTS,
      CLUSTER_LIGHT_CAR,
      CLUSTER_LIGHT_STREET,
      CLUSTER_LIGHT_EXTRA,
      CLUSTER_LIGHTS_WGSL,
      clusterLightsBindings,
      depthToClusterZ,
      clusterZToDepth,
    } = await import('/page/lights-cluster.ts')

    const gpu = await openGpu()
    const { device } = gpu
    const clustered = await createClusteredLights(device, MAX_CLUSTER_LIGHTS)

    // Deterministic PRNG (Mulberry32) so all 512 lights are reproducible across runs.
    let seed = 0x5f165c1
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    async function readBufferU32(buf, count) {
      const staging = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(buf, 0, staging, 0, count * 4)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    async function readTextureF32(tex, width, height) {
      const bytesPerRow = Math.ceil((width * 16) / 256) * 256
      const buf = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [width, height, 1])
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const raw = new Float32Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      const rowFloats = bytesPerRow / 4
      const out = new Float32Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        out.set(raw.subarray(y * rowFloats, y * rowFloats + width * 4), y * width * 4)
      }
      return out
    }

    // Camera looking horizontally along -Z at mid-skyscraper altitude (Y = 60 m = 600 cells).
    // At Z = -200 m (2000 cells) with fovY = 60 deg (tanHalf = 0.57735):
    //   vertical half-span = 115.5 m -> Y visible in [-55.5 m, +175.5 m], cleanly capturing both
    //   street level (Y = 5 m) and skyscraper roof (Y = 120 m) in separate Y clusters!
    const zNear = 5.0
    const zFar = 4000.0
    const cam = {
      eye: [0, 600, 0],
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      tanHalf: Math.tan((60 * Math.PI) / 360),
      aspect: 16 / 9,
      zNear,
      zFar,
    }

    // Helper: map a world point to its exact cluster (cx, cy, cz) and flat index on CPU.
    const worldToCluster = (wx, wy, wz) => {
      const rx = wx - cam.eye[0], ry = wy - cam.eye[1], rz = wz - cam.eye[2]
      const vx = rx * cam.right[0] + ry * cam.right[1] + rz * cam.right[2]
      const vy = rx * cam.up[0] + ry * cam.up[1] + rz * cam.up[2]
      const vz = rx * cam.forward[0] + ry * cam.forward[1] + rz * cam.forward[2]
      const ndcX = vx / (vz * cam.tanHalf * cam.aspect)
      const ndcY = vy / (vz * cam.tanHalf)
      const u = ndcX * 0.5 + 0.5
      const v = 0.5 - ndcY * 0.5
      const cx = Math.max(0, Math.min(CLUSTER_X - 1, Math.floor(u * CLUSTER_X)))
      const cy = Math.max(0, Math.min(CLUSTER_Y - 1, Math.floor(v * CLUSTER_Y)))
      const cz = depthToClusterZ(vz, zNear, zFar)
      return { cx, cy, cz, idx: (cz * CLUSTER_Y + cy) * CLUSTER_X + cx, u, v, vz }
    }

    // Check TS logarithmic Z-slice round-trip accuracy across all 24 slices.
    let sliceRoundTripMaxErr = 0
    let sliceMonotonic = true
    for (let s = 0; s < CLUSTER_Z; s++) {
      const d0 = clusterZToDepth(s, zNear, zFar)
      const d1 = clusterZToDepth(s + 1, zNear, zFar)
      if (!(d1 > d0)) sliceMonotonic = false
      const dMid = Math.sqrt(d0 * d1)
      const back = depthToClusterZ(dMid, zNear, zFar)
      sliceRoundTripMaxErr = Math.max(sliceRoundTripMaxErr, Math.abs(back - s))
    }

    // ── Populate 512 Dynamic Lights ─────────────────────────────────────────
    clustered.beginFrame(0, 0, 0)

    // Test 1A: Vertical skyscraper separation — identical (X, Z) = (0, -200 m), Y = 5 m vs Y = 120 m.
    const idStreet = clustered.addPoint(0, 50, -2000, 1200, 820, 420, 220, 2, 0, CLUSTER_LIGHT_STREET)
    const idRoof = clustered.addPoint(0, 1200, -2000, 380, 920, 1500, 220, 2, 0, CLUSTER_LIGHT_EXTRA)

    // Test 1B: Depth separation along the exact same camera ray (X = -40 m? Use center ray X = 0, Y = 60 m):
    // Near at Z = -25 m (250 cells, radius 4 m = 40 cells) vs Far at Z = -180 m (1800 cells, radius 15 m = 150 cells).
    const idNear = clustered.addPoint(0, 600, -250, 900, 250, 120, 40, 1, 0, CLUSTER_LIGHT_EXTRA)
    const idFar = clustered.addPoint(0, 600, -1800, 180, 1200, 450, 150, 1, 0, CLUSTER_LIGHT_EXTRA)

    // Test 2: 100 lights strictly outside the frustum (60 behind camera + 40 far outside lateral/vertical planes).
    const outIds = new Set()
    for (let i = 0; i < 60; i++) {
      // Behind camera: Z in [+40 m, +300 m], radius 10..25 m -> never reaches zNear = 0.5 m in front (-Z).
      const pz = 400 + rand() * 2600
      const px = (rand() - 0.5) * 1600
      const py = 50 + rand() * 1400
      const radius = 100 + rand() * 150
      const id = i % 2 === 0
        ? clustered.addPoint(px, py, pz, 400, 300, 200, radius, 0, 0, CLUSTER_LIGHT_EXTRA)
        : clustered.addSpot(px, py, pz, 0, 0, 1, 500, 450, 350, radius, 0.7, 0.92, 0, 0, CLUSTER_LIGHT_CAR)
      outIds.add(id)
    }
    for (let i = 0; i < 40; i++) {
      // Far outside left/right/top/bottom frustum at Z = -30 m (300 cells), where frustum half-width is ~31 m and half-height is ~17 m.
      const side = i % 4
      const pz = -(200 + rand() * 400) // -20 m .. -60 m
      const radius = 80 + rand() * 120 // 8 m .. 20 m
      let px = 0, py = 600
      if (side === 0) px = -(1800 + rand() * 1000) // far left (-180..-280 m)
      else if (side === 1) px = 1800 + rand() * 1000 // far right (+180..+280 m)
      else if (side === 2) py = 2400 + rand() * 1000 // far above (+240..+340 m)
      else py = -(1200 + rand() * 1000) // far below (-120..-220 m)
      const id = clustered.addPoint(px, py, pz, 350, 250, 500, radius, 0, 0, CLUSTER_LIGHT_EXTRA)
      outIds.add(id)
    }

    // Remaining 408 lights: realistic SF street lamps, skyscraper facade lights, and vehicle headlight spots
    // distributed cleanly across the 3D frustum volume (radii 8..32 m so clusters stay rich without exceeding 64/cluster).
    let remaining = MAX_CLUSTER_LIGHTS - clustered.stats().lightCount
    for (let i = 0; i < remaining; i++) {
      const zDist = 120 + Math.pow(rand(), 0.75) * 3400 // 12 m .. 352 m
      const halfY = zDist * cam.tanHalf * 0.95
      const halfX = halfY * cam.aspect
      const px = (rand() * 2 - 1) * halfX
      const py = Math.max(20, cam.eye[1] + (rand() * 2 - 1) * halfY)
      const pz = -zDist
      const radius = 80 + rand() * 220 // 8 m .. 30 m
      const cr = 180 + rand() * 700
      const cg = 140 + rand() * 650
      const cb = 100 + rand() * 650
      if (i % 3 === 0) {
        // Directional headlight / streetlamp spot
        const dx = (rand() - 0.5) * 0.8
        const dy = -0.25 - rand() * 0.75
        const dz = (rand() - 0.5) * 0.8
        const cosOuter = 0.45 + rand() * 0.42
        const cosInner = Math.min(0.98, cosOuter + 0.08 + rand() * 0.15)
        clustered.addSpot(px, py, pz, dx, dy, dz, cr, cg, cb, radius, cosOuter, cosInner, 1.0, 1.0, CLUSTER_LIGHT_CAR)
      } else {
        clustered.addPoint(px, py, pz, cr, cg, cb, radius, 1.0, 0.0, i % 2 === 0 ? CLUSTER_LIGHT_STREET : CLUSTER_LIGHT_EXTRA)
      }
    }

    const stagedStats = clustered.stats()
    clustered.upload(device.queue)

    // Dispatch pass 1 (builds bounds + culls all 512 lights).
    {
      const enc = device.createCommandEncoder()
      clustered.dispatch(enc, cam)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const statsAfterFirst = clustered.stats()

    // Read back counters, clusterGrid, and lightIndexList for Tests 1 & 2.
    const counters = await readBufferU32(clustered.counterBuffer, 4)
    const gridRaw = await readBufferU32(clustered.clusterGridBuffer, CLUSTER_COUNT * 2)
    const totalAllocated = counters[0]
    const indexReadCount = Math.min(totalAllocated, clustered.indexPoolCapacity)
    const indicesRaw = indexReadCount > 0 ? await readBufferU32(clustered.lightIndexBuffer, indexReadCount) : new Uint32Array(0)

    const lightsInCluster = (clusterIdx) => {
      const offset = gridRaw[clusterIdx * 2]
      const count = gridRaw[clusterIdx * 2 + 1]
      const set = new Set()
      for (let k = 0; k < count; k++) set.add(indicesRaw[offset + k])
      return set
    }

    // ── Test 1: Vertical & Depth Separation ─────────────────────────────────
    const cStreet = worldToCluster(0, 50, -2000)
    const cRoof = worldToCluster(0, 1200, -2000)
    const cNear = worldToCluster(0, 600, -250)
    const cFar = worldToCluster(0, 600, -1800)

    const setStreet = lightsInCluster(cStreet.idx)
    const setRoof = lightsInCluster(cRoof.idx)
    const setNear = lightsInCluster(cNear.idx)
    const setFar = lightsInCluster(cFar.idx)

    // Verify zero overlap across ALL 3,456 clusters between vertical pair (idStreet, idRoof)
    // and between depth pair (idNear, idFar).
    let verticalCoOccurrences = 0
    let depthCoOccurrences = 0
    let outOfFrustumLeaks = 0
    for (let ci = 0; ci < CLUSTER_COUNT; ci++) {
      const off = gridRaw[ci * 2]
      const cnt = gridRaw[ci * 2 + 1]
      let hasStreet = false, hasRoof = false, hasNear = false, hasFar = false
      for (let k = 0; k < cnt; k++) {
        const lid = indicesRaw[off + k]
        if (lid === idStreet) hasStreet = true
        if (lid === idRoof) hasRoof = true
        if (lid === idNear) hasNear = true
        if (lid === idFar) hasFar = true
        if (outIds.has(lid)) outOfFrustumLeaks++
      }
      if (hasStreet && hasRoof) verticalCoOccurrences++
      if (hasNear && hasFar) depthCoOccurrences++
    }

    // ── Test 3: Fullscreen Brute-Force Reference Equivalence (512 Lights) ───
    const W = 256
    const H = 144
    const compareWgsl = /* wgsl */ `
${clusterLightsBindings(0, 0)}
${CLUSTER_LIGHTS_WGSL}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  // Fullscreen triangle covering clip [-1, 1]^2 with uv (0,0) top-left -> (1,1) bottom-right.
  var vOut: VsOut;
  vOut.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  vOut.uv = vec2f(x, y);
  return vOut;
}

struct Hit {
  hit: bool,
  t: f32,
  normal: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
}

fn rayBox(ro: vec3f, rd: vec3f, bMin: vec3f, bMax: vec3f) -> vec4f {
  let invD = 1.0 / select(rd, vec3f(1e-6), abs(rd) < vec3f(1e-6));
  let t0 = (bMin - ro) * invD;
  let t1 = (bMax - ro) * invD;
  let tSmall = min(t0, t1);
  let tBig = max(t0, t1);
  let tEnter = max(max(tSmall.x, tSmall.y), tSmall.z);
  let tExit = min(min(tBig.x, tBig.y), tBig.z);
  if (tExit < max(tEnter, 0.0)) { return vec4f(-1.0, 0.0, 0.0, 0.0); }
  var n = vec3f(0.0, 1.0, 0.0);
  if (tEnter == tSmall.x) { n = vec3f(-sign(rd.x), 0.0, 0.0); }
  else if (tEnter == tSmall.y) { n = vec3f(0.0, -sign(rd.y), 0.0); }
  else { n = vec3f(0.0, 0.0, -sign(rd.z)); }
  return vec4f(tEnter, n);
}

// Synthetic 3D urban scene: ground plane at Y = 0 + 6 skyscrapers spanning near..far depths + back wall.
fn traceScene(ro: vec3f, rd: vec3f) -> Hit {
  var best = Hit(false, 1e9, vec3f(0.0, 1.0, 0.0), vec3f(0.5), 0.5, 0.0);

  // Ground plane Y = 0
  if (rd.y < -1e-4) {
    let tg = (0.0 - ro.y) / rd.y;
    if (tg > 10.0 && tg < best.t) {
      best = Hit(true, tg, vec3f(0.0, 1.0, 0.0), vec3f(0.22, 0.23, 0.26), 0.55, 0.05);
    }
  }

  // Far backdrop wall at Z = -3400 (340 m) so upper sky pixels still sample deep clusters
  if (rd.z < -1e-4) {
    let tw = (-3400.0 - ro.z) / rd.z;
    if (tw > 10.0 && tw < best.t) {
      best = Hit(true, tw, vec3f(0.0, 0.0, 1.0), vec3f(0.45, 0.48, 0.54), 0.42, 0.25);
    }
  }

  // 6 skyscraper towers at varying (X, Z) and heights (90 m .. 160 m)
  let bMins = array<vec3f, 6>(
    vec3f(-260.0, 0.0, -750.0),
    vec3f(140.0, 0.0, -900.0),
    vec3f(-720.0, 0.0, -1450.0),
    vec3f(-160.0, 0.0, -2150.0),
    vec3f(480.0, 0.0, -1750.0),
    vec3f(820.0, 0.0, -2600.0),
  );
  let bMaxs = array<vec3f, 6>(
    vec3f(-90.0, 950.0, -560.0),
    vec3f(320.0, 1100.0, -700.0),
    vec3f(-420.0, 1450.0, -1150.0),
    vec3f(160.0, 1250.0, -1950.0),
    vec3f(760.0, 1550.0, -1450.0),
    vec3f(1220.0, 1650.0, -2250.0),
  );
  let albedos = array<vec3f, 6>(
    vec3f(0.65, 0.62, 0.58),
    vec3f(0.48, 0.55, 0.68),
    vec3f(0.72, 0.58, 0.48),
    vec3f(0.55, 0.60, 0.64),
    vec3f(0.62, 0.65, 0.68),
    vec3f(0.52, 0.50, 0.56),
  );
  let roughs = array<f32, 6>(0.35, 0.18, 0.62, 0.25, 0.12, 0.48);
  let metals = array<f32, 6>(0.10, 0.75, 0.05, 0.45, 0.85, 0.20);

  for (var i = 0u; i < 6u; i++) {
    let res = rayBox(ro, rd, bMins[i], bMaxs[i]);
    if (res.x > 10.0 && res.x < best.t) {
      best = Hit(true, res.x, res.yzw, albedos[i], roughs[i], metals[i]);
    }
  }
  return best;
}

struct FragOut {
  @location(0) clusteredCol: vec4f,
  @location(1) bruteForceCol: vec4f,
}

@fragment
fn fs(vIn: VsOut) -> FragOut {
  let uv = vIn.uv;
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let eye = clusterParams.eyeTanHalf.xyz;
  let tanHalf = clusterParams.eyeTanHalf.w;
  let fwd = clusterParams.fwdAspect.xyz;
  let aspect = clusterParams.fwdAspect.w;
  let right = clusterParams.rightNear.xyz;
  let up = clusterParams.upFar.xyz;

  let rd = normalize(fwd + right * (ndcX * tanHalf * aspect) + up * (ndcY * tanHalf));
  let hit = traceScene(eye, rd);
  if (!hit.hit) {
    return FragOut(vec4f(0.0, 0.0, 0.0, 0.0), vec4f(0.0, 0.0, 0.0, 0.0));
  }

  let worldPos = eye + rd * hit.t;
  let linearDepth = dot(worldPos - eye, fwd);
  let viewDir = -rd;

  // 1. Clustered 3D evaluation via CLUSTER_LIGHTS_WGSL
  let colClustered = evalClusteredLightsGGX(
    worldPos, hit.normal, viewDir, hit.albedo, hit.roughness, hit.metallic, uv, linearDepth,
  );

  // 2. Brute-force reference over ALL active lights
  var colRef = vec3f(0.0);
  if (linearDepth > 0.0 && linearDepth <= clusterParams.upFar.w) {
    let N = normalize(hit.normal);
    let V = normalize(viewDir);
    let nLights = clusterParams.counts.x;
    for (var i = 0u; i < nLights; i++) {
      colRef += evalClusterLightGGX(clusterLights[i], worldPos, N, V, hit.albedo, hit.roughness, hit.metallic);
    }
  }

  return FragOut(vec4f(colClustered, 1.0), vec4f(colRef, 1.0));
}
`
    const compareMod = await shader(device, 'lights-cluster-compare', compareWgsl)
    const comparePipe = await device.createRenderPipelineAsync({
      label: 'lights-cluster-compare',
      layout: 'auto',
      vertex: { module: compareMod, entryPoint: 'vs' },
      fragment: {
        module: compareMod,
        entryPoint: 'fs',
        targets: [{ format: 'rgba32float' }, { format: 'rgba32float' }],
      },
      primitive: { topology: 'triangle-list' },
    })
    const compareBg = device.createBindGroup({
      layout: comparePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: clustered.paramsBuffer } },
        { binding: 1, resource: { buffer: clustered.lightsBuffer } },
        { binding: 2, resource: { buffer: clustered.clusterGridBuffer } },
        { binding: 3, resource: { buffer: clustered.lightIndexBuffer } },
      ],
    })
    const clusteredTex = device.createTexture({
      size: [W, H],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const refTex = device.createTexture({
      size: [W, H],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    {
      const enc = device.createCommandEncoder()
      const pass = enc.beginRenderPass({
        colorAttachments: [
          { view: clusteredTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          { view: refTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
      })
      pass.setPipeline(comparePipe)
      pass.setBindGroup(0, compareBg)
      pass.draw(3)
      pass.end()
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    const clusteredPixels = await readTextureF32(clusteredTex, W, H)
    const refPixels = await readTextureF32(refTex, W, H)
    clusteredTex.destroy()
    refTex.destroy()

    let maxAbsErr = 0
    let maxRelErr = 0
    let nonFiniteCount = 0
    let litPixels = 0
    let peakRadiance = 0
    let hitPixels = 0
    for (let i = 0; i < W * H; i++) {
      const o = i * 4
      if (refPixels[o + 3] > 0.5) hitPixels++
      let pixLum = 0
      for (let c = 0; c < 3; c++) {
        const a = clusteredPixels[o + c]
        const b = refPixels[o + c]
        if (!Number.isFinite(a) || !Number.isFinite(b)) { nonFiniteCount++; continue }
        const err = Math.abs(a - b)
        if (err > maxAbsErr) maxAbsErr = err
        if (b > 1e-4) maxRelErr = Math.max(maxRelErr, err / b)
        if (b > peakRadiance) peakRadiance = b
        pixLum += b
      }
      if (pixLum > 1e-4) litPixels++
    }

    // ── Test 4: Bounds Dirty Cache & GPU Timestamp-Query Benchmark ──────────
    // 4A. Rotate/translate camera WITHOUT changing projection -> boundsDispatches MUST NOT increment.
    const camMoved = {
      ...cam,
      eye: [45, 620, -30],
      forward: [Math.sin(0.15), 0, -Math.cos(0.15)],
      right: [Math.cos(0.15), 0, Math.sin(0.15)],
      up: [0, 1, 0],
    }
    {
      const enc = device.createCommandEncoder()
      clustered.dispatch(enc, camMoved)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const statsAfterMove = clustered.stats()

    // 4B. Change projection (aspect & tanHalf) -> boundsDispatches MUST increment by 1.
    const camResized = {
      ...camMoved,
      aspect: 21 / 9,
      tanHalf: Math.tan((70 * Math.PI) / 360),
    }
    {
      const enc = device.createCommandEncoder()
      clustered.dispatch(enc, camResized)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const statsAfterProjChange = clustered.stats()

    // 4C. Restore original camera and measure cs_cluster_cull GPU time for 512 lights via timestamp-query.
    {
      const enc = device.createCommandEncoder()
      clustered.dispatch(enc, cam)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    let cullGpuMs = null
    let cullGpuMinMs = null
    let cullGpuMaxMs = null
    if (gpu.canTime) {
      const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
      const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const readBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const samples = []
      // Warmup 3 runs, measure 15 runs
      for (let i = 0; i < 18; i++) {
        const enc = device.createCommandEncoder()
        clustered.dispatch(enc, cam, {
          cull: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
        })
        enc.resolveQuerySet(querySet, 0, 2, resolved, 0)
        enc.copyBufferToBuffer(resolved, 0, readBuf, 0, 16)
        device.queue.submit([enc.finish()])
        await readBuf.mapAsync(GPUMapMode.READ)
        const [t0, t1] = new BigUint64Array(readBuf.getMappedRange().slice(0))
        readBuf.unmap()
        if (i >= 3 && t1 > t0) samples.push(Number(t1 - t0) / 1e6)
      }
      querySet.destroy()
      resolved.destroy()
      readBuf.destroy()
      if (samples.length) {
        samples.sort((a, b) => a - b)
        cullGpuMs = samples[samples.length >> 1]
        cullGpuMinMs = samples[0]
        cullGpuMaxMs = samples[samples.length - 1]
      }
    }

    clustered.destroy()

    return {
      faults: gpu.faults,
      canTime: gpu.canTime,
      stagedStats,
      sliceRoundTripMaxErr,
      sliceMonotonic,
      counters: {
        totalAllocated: counters[0],
        overflows: counters[1],
        maxPerCluster: counters[2],
        activeClusters: counters[3],
      },
      test1: {
        cStreet,
        cRoof,
        cNear,
        cFar,
        streetHasStreet: setStreet.has(idStreet),
        streetHasRoof: setStreet.has(idRoof),
        roofHasRoof: setRoof.has(idRoof),
        roofHasStreet: setRoof.has(idStreet),
        nearHasNear: setNear.has(idNear),
        nearHasFar: setNear.has(idFar),
        farHasFar: setFar.has(idFar),
        farHasNear: setFar.has(idNear),
        verticalCoOccurrences,
        depthCoOccurrences,
      },
      test2: {
        outCount: outIds.size,
        outOfFrustumLeaks,
      },
      test3: {
        pixels: W * H,
        hitPixels,
        litPixels,
        peakRadiance,
        maxAbsErr,
        maxRelErr,
        nonFiniteCount,
      },
      test4: {
        boundsDeltaOnMove: statsAfterMove.boundsDispatches - statsAfterFirst.boundsDispatches,
        cullDeltaOnMove: statsAfterMove.cullDispatches - statsAfterFirst.cullDispatches,
        boundsDeltaOnProj: statsAfterProjChange.boundsDispatches - statsAfterMove.boundsDispatches,
        cullDeltaOnProj: statsAfterProjChange.cullDispatches - statsAfterMove.cullDispatches,
        cullGpuMs,
        cullGpuMinMs,
        cullGpuMaxMs,
      },
    }
  })

  check(result.faults.length === 0, `zero WebGPU uncaptured errors (${result.faults.join('; ') || 'clean'})`)
  check(
    result.stagedStats.lightCount === 512 && result.stagedStats.pointCount > 0 && result.stagedStats.spotCount > 0,
    `staged 512 dynamic lights (${result.stagedStats.pointCount} point + ${result.stagedStats.spotCount} spot)`,
  )
  check(
    result.sliceMonotonic && result.sliceRoundTripMaxErr === 0,
    `logarithmic Z-slice mapping (24 slices) monotonic with exact inverse (max slice err=${result.sliceRoundTripMaxErr})`,
  )
  check(
    result.counters.overflows === 0 && result.counters.activeClusters > 100,
    `GPU atomic pool clean: ${result.counters.totalAllocated} total indices across ${result.counters.activeClusters}/3456 clusters, max ${result.counters.maxPerCluster}/cluster, ${result.counters.overflows} overflows`,
  )

  // Test 1: Vertical & Depth Separation
  const t1 = result.test1
  check(
    t1.cStreet.cy !== t1.cRoof.cy
      && t1.streetHasStreet && !t1.streetHasRoof
      && t1.roofHasRoof && !t1.roofHasStreet
      && t1.verticalCoOccurrences === 0,
    `Test 1A vertical separation (Y=5m cy=${t1.cStreet.cy} vs Y=120m cy=${t1.cRoof.cy}): zero cross-contamination (${t1.verticalCoOccurrences} co-occurrences)`,
  )
  check(
    t1.cNear.cz !== t1.cFar.cz
      && t1.nearHasNear && !t1.nearHasFar
      && t1.farHasFar && !t1.farHasNear
      && t1.depthCoOccurrences === 0,
    `Test 1B depth separation (Z=25m cz=${t1.cNear.cz} vs Z=180m cz=${t1.cFar.cz}): zero cross-contamination (${t1.depthCoOccurrences} co-occurrences)`,
  )

  // Test 2: Frustum Culling
  check(
    result.test2.outCount === 100 && result.test2.outOfFrustumLeaks === 0,
    `Test 2 frustum culling: 0/${result.test2.outCount} behind-camera & out-of-frustum lights entered any cluster`,
  )

  // Test 3: Brute-Force Reference Equivalence
  const t3 = result.test3
  check(
    t3.nonFiniteCount === 0 && t3.litPixels > 5000 && t3.peakRadiance > 0.05 && t3.maxAbsErr < 1e-4,
    `Test 3 brute-force equivalence (512 lights, ${t3.litPixels}/${t3.hitPixels} lit pixels, peak=${t3.peakRadiance.toFixed(3)}): maxAbsErr=${t3.maxAbsErr.toExponential(2)} (< 1e-4), nonFinite=${t3.nonFiniteCount}`,
  )

  // Test 4: Dirty Cache & GPU Timestamp-Query Performance
  const t4 = result.test4
  check(
    t4.boundsDeltaOnMove === 0 && t4.cullDeltaOnMove === 1
      && t4.boundsDeltaOnProj === 1 && t4.cullDeltaOnProj === 1,
    `Test 4A bounds dirty cache: move delta (bounds=${t4.boundsDeltaOnMove}, cull=${t4.cullDeltaOnMove}), proj change delta (bounds=${t4.boundsDeltaOnProj}, cull=${t4.cullDeltaOnProj})`,
  )
  check(
    result.canTime && t4.cullGpuMs !== null && t4.cullGpuMs > 0 && t4.cullGpuMs < 5.0,
    `Test 4B timestamp-query cs_cluster_cull (512 lights): median ${t4.cullGpuMs?.toFixed(4) ?? 'n/a'} ms (min ${t4.cullGpuMinMs?.toFixed(4) ?? 'n/a'} ms, max ${t4.cullGpuMaxMs?.toFixed(4) ?? 'n/a'} ms)`,
  )
} catch (e) {
  failures.push(String(e))
}

await finish('lights-cluster')
