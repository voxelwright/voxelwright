// Real headless Chrome WebGPU verification for LocalLights dual-backend upgrade (#165 Wave 3B).
//
// Exercises engine/page/lights.ts directly (`createLocalLights` -> `initClustered` -> `beginFrame`
// -> `addPoint` / `addSpot` / `addVehicle` / `addStreetLamps` -> `finishFrame` -> `dispatchCluster`)
// with 300+ realistic San Francisco Market St dynamic lights and verifies:
//   1. Backward compatibility: existing 48-light uniform buffer stays populated with top-48 priority
//      lights across car/street/extra reserves (plus Low=12, Medium=28, High=48 preset scaling) and
//      shades cleanly via `LOCAL_LIGHTS_STRUCT` + `localLightsEval()`.
//   2. 512-light 3D clustered GPU path: stages 300+ Market St lights (`clusterCount >= 300`),
//      cleanly separates vertical skyscraper floors (Y=5m vs Y=120m) & depth Z-slices (25m vs 180m)
//      with zero cross-contamination, culls out-of-frustum lights, matches brute-force GGX shading
//      to < 1e-4 using `localLights.clusterBindGroupLayout` / `clusterBindGroup` + re-exported
//      `CLUSTER_LIGHTS_WGSL`, 0 overflows, 0 GPU faults, and < 0.2 ms GPU cull time.
//
//   node engine/test/lights-cluster-live.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route(`${url}/lights-cluster-live-test.html`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>lights-cluster-live test</title></head><body></body></html>',
  }))
  await page.goto(`${url}/lights-cluster-live-test.html`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader } = await import('/probe/gpu.ts')
    const {
      createLocalLights,
      LOCAL_LIGHTS_STRUCT,
      localLightsEval,
      CLUSTER_LIGHTS_WGSL,
      clusterLightsBindings,
      CLUSTER_X,
      CLUSTER_Y,
      CLUSTER_Z,
      CLUSTER_COUNT,
      MAX_CLUSTER_LIGHTS,
      DEFAULT_CLUSTER_Z_NEAR,
      DEFAULT_CLUSTER_Z_FAR,
      depthToClusterZ,
      LIGHT_EXTRA,
      LIGHT_STREET,
    } = await import('/page/lights.ts')

    const gpu = await openGpu()
    const { device } = gpu
    const localLights = createLocalLights(device)

    const beforeInit = {
      clusteredNull: localLights.clustered === null,
      clusterCount: localLights.clusterCount,
      bglNull: localLights.clusterBindGroupLayout === null,
      bgNull: localLights.clusterBindGroup === null,
    }

    const c1 = await localLights.initClustered()
    const c2 = await localLights.initClustered()
    const afterInit = {
      sameInstance: c1 === c2 && localLights.clustered === c1,
      maxLights: c1.maxLights,
      hasBgl: localLights.clusterBindGroupLayout !== null,
      hasBg: localLights.clusterBindGroup !== null,
    }

    // Deterministic PRNG (Mulberry32) for reproducible Market St lighting layout.
    let seed = 0x5f1653b
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

    // Anchored Market St corridor coordinates (matches march.ts 64-cell chunk anchoring!).
    const ancX = 53504
    const ancY = 0
    const ancZ = 67072
    const aspect = 16 / 9
    const zNear = DEFAULT_CLUSTER_Z_NEAR
    const zFar = DEFAULT_CLUSTER_Z_FAR
    const view = {
      eye: [ancX, ancY + 420, ancZ], // 42 m downtown balcony altitude looking down Market St (-Z)
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      tanHalf: Math.tan((60 * Math.PI) / 360),
    }

    const worldToCluster = (wx, wy, wz) => {
      const rx = wx - view.eye[0], ry = wy - view.eye[1], rz = wz - view.eye[2]
      const vx = rx * view.right[0] + ry * view.right[1] + rz * view.right[2]
      const vy = rx * view.up[0] + ry * view.up[1] + rz * view.up[2]
      const vz = rx * view.forward[0] + ry * view.forward[1] + rz * view.forward[2]
      const ndcX = vx / (vz * view.tanHalf * aspect)
      const ndcY = vy / (vz * view.tanHalf)
      const u = ndcX * 0.5 + 0.5
      const v = 0.5 - ndcY * 0.5
      const cx = Math.max(0, Math.min(CLUSTER_X - 1, Math.floor(u * CLUSTER_X)))
      const cy = Math.max(0, Math.min(CLUSTER_Y - 1, Math.floor(v * CLUSTER_Y)))
      const cz = depthToClusterZ(vz, zNear, zFar)
      return { cx, cy, cz, idx: (cz * CLUSTER_Y + cy) * CLUSTER_X + cx, u, v, vz }
    }

    // Realistic downtown SF street-lamp grid (~28 m spacing across Market St + parallel Mission/Sutter/Howard/Bush corridors).
    const streetLamps = []
    const streetXs = [-1100, -760, -420, -135, 135, 420, 760, 1100]
    for (let s = 0; s < streetXs.length; s++) {
      const sx = ancX + streetXs[s]
      for (let i = 0; i < 12; i++) {
        const zOff = -(140 + i * 285 + (s % 2) * 90)
        streetLamps.push(sx, ancY + 75, ancZ + zOff)
      }
    }

    // Populates one full realistic SF Market St frame with 360+ dynamic lights (skyscrapers, cars, street lamps, fires, signals).
    const populateMarketSt = (quality) => {
      // Reset seed per call so Low/Med/High preset checks see the exact same Market St light scene.
      seed = 0x5f1653b
      localLights.beginFrame(view, ancX, ancY, ancZ, quality, 1.0, 0.35)

      // Sentinel Test 1A: Vertical skyscraper separation at identical (X, Z) = (ancX, ancZ - 200 m).
      // Street-level lobby lantern (Y = 5 m) vs skyscraper roof beacon (Y = 120 m).
      const idStreet = localLights.clusterCount
      localLights.addPoint(ancX, ancY + 50, ancZ - 2000, 3.2, 2.2, 1.1, 200, 56, 1.0, 95, LIGHT_STREET)
      const idRoof = localLights.clusterCount
      localLights.addPoint(ancX, ancY + 1200, ancZ - 2000, 1.1, 2.8, 4.4, 200, 56, 1.0, 95, LIGHT_EXTRA)

      // Sentinel Test 1B: Depth Z-slice separation along center ray (X = ancX, Y = 42 m):
      // Near light at Z = -25 m (range 4 m) vs Far light at Z = -180 m (range 14 m).
      const idNear = localLights.clusterCount
      localLights.addPoint(ancX, ancY + 420, ancZ - 250, 3.8, 1.1, 0.5, 40, 14, 1.0, 110, LIGHT_EXTRA)
      const idFar = localLights.clusterCount
      localLights.addPoint(ancX, ancY + 420, ancZ - 1800, 0.7, 3.6, 1.4, 140, 42, 1.0, 110, LIGHT_EXTRA)

      // 20 far-lateral out-of-frustum lights (inside CLUSTER_REACH so they stage into clustered, then MUST cull to 0 clusters).
      const outIds = new Set()
      for (let i = 0; i < 20; i++) {
        const side = i % 4
        const pz = ancZ - (220 + rand() * 350)
        const radius = 80 + rand() * 100
        let px = ancX, py = ancY + 420
        if (side === 0) px = ancX - (1900 + rand() * 700)
        else if (side === 1) px = ancX + (1900 + rand() * 700)
        else if (side === 2) py = ancY + (2400 + rand() * 700)
        else py = ancY - (1200 + rand() * 600)
        const id = localLights.clusterCount
        localLights.addPoint(px, py, pz, 2.5, 1.8, 3.0, radius, 32, 1.0, 40, LIGHT_EXTRA)
        if (localLights.clusterCount > id) outIds.add(id)
      }

      // 40 vehicles distributed across Market St + adjacent Mission/Sutter/Howard avenues (headlights, taillights, brakes, hazards).
      const roadCenters = [0, 0, -420, 420, -760, 760]
      for (let i = 0; i < 40; i++) {
        const roadX = roadCenters[i % roadCenters.length]
        const lane = (i >> 1) % 2 === 0 ? -36 : 36
        const bx = ancX + roadX + lane
        const bz = ancZ - (120 + Math.floor(i / 4) * 310 + (i % 4) * 75)
        const dir = lane < 0 ? -1 : 1
        const braking = i % 3 === 0 ? 1.0 : 0.0
        const hazard = i % 8 === 0 ? 0.9 : 0.0
        localLights.addVehicle(
          bx, ancY + 4, bz,
          0, 0, dir,
          -dir, 0, 0,
          0, 1, 0,
          22, 9.5, 15,
          1.15, braking, 0, hazard, 0,
          i === 0,
        )
      }

      // 96 SF street lamps via addStreetLamps() across downtown corridors.
      localLights.addStreetLamps(streetLamps)

      // 180 multi-floor skyscraper facade beacons, office windows, fires, portals & traffic signals across the 3D frustum.
      const towerXs = [-1250, -880, -540, -250, 250, 540, 880, 1250]
      for (let i = 0; i < 180; i++) {
        const tx = ancX + towerXs[i % towerXs.length] + (rand() - 0.5) * 180
        const floorY = ancY + 40 + (i % 14) * 110 + rand() * 30 // floors from 4 m to 158 m
        const tz = ancZ - (160 + Math.floor(i / 8) * 145 + (rand() - 0.5) * 55)
        const range = 95 + rand() * 135
        const dHalf = 28 + rand() * 32
        if (i % 3 === 0) {
          // Traffic signal / awning downlight / skyscraper uplight spotlight
          const dy = i % 6 === 0 ? -0.85 : 0.55
          localLights.addSpot(
            tx, floorY, tz,
            (rand() - 0.5) * 0.4, dy, (rand() - 0.5) * 0.4,
            1.6 + rand() * 2.2, 1.2 + rand() * 2.0, 0.8 + rand() * 2.4,
            range, dHalf, 0.42, 0.85, 0.25, 0.0, 1.1, 70, LIGHT_EXTRA,
          )
        } else {
          // Warm fire / office glow / neon accent / portal point light
          localLights.addPoint(
            tx, floorY, tz,
            1.4 + rand() * 2.5, 1.0 + rand() * 2.1, 0.6 + rand() * 2.4,
            range, dHalf, 1.0, 75, LIGHT_EXTRA,
          )
        }
      }

      // 16 near-camera balcony/plaza fires, signals & portal lights (within Low preset reach 420 cells) so Low/Med/High all fill their uniform budgets.
      for (let i = 0; i < 16; i++) {
        const px = ancX + ((i % 4) - 1.5) * 110
        const py = ancY + 180 + (i % 3) * 110
        const pz = ancZ - (110 + Math.floor(i / 4) * 70)
        localLights.addPoint(px, py, pz, 2.4, 1.5, 0.7, 130, 40, 1.0, 90, i % 2 === 0 ? LIGHT_EXTRA : LIGHT_STREET)
      }

      localLights.finishFrame()
      return { idStreet, idRoof, idNear, idFar, outIds }
    }

    // ── Check Low / Medium / High Uniform Preset Budgets + Clustered Staging ──
    populateMarketSt('low')
    const statsLow = { ...localLights.stats, count: localLights.count, clusterCount: localLights.clusterCount }
    populateMarketSt('medium')
    const statsMed = { ...localLights.stats, count: localLights.count, clusterCount: localLights.clusterCount }
    const sentinels = populateMarketSt('high')
    const statsHigh = { ...localLights.stats, count: localLights.count, clusterCount: localLights.clusterCount }

    // Dispatch 3D frustum clustering through LocalLights.dispatchCluster().
    {
      const enc = device.createCommandEncoder()
      localLights.dispatchCluster(enc, view, aspect, zNear, zFar)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    const clustered = localLights.clustered
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

    // Verify vertical (Y=5m vs Y=120m) & depth (25m vs 180m) separation + out-of-frustum culling.
    const cStreet = worldToCluster(ancX, ancY + 50, ancZ - 2000)
    const cRoof = worldToCluster(ancX, ancY + 1200, ancZ - 2000)
    const cNear = worldToCluster(ancX, ancY + 420, ancZ - 250)
    const cFar = worldToCluster(ancX, ancY + 420, ancZ - 1800)

    const setStreet = lightsInCluster(cStreet.idx)
    const setRoof = lightsInCluster(cRoof.idx)
    const setNear = lightsInCluster(cNear.idx)
    const setFar = lightsInCluster(cFar.idx)

    let verticalCoOccurrences = 0
    let depthCoOccurrences = 0
    let outOfFrustumLeaks = 0
    for (let ci = 0; ci < CLUSTER_COUNT; ci++) {
      const off = gridRaw[ci * 2]
      const cnt = gridRaw[ci * 2 + 1]
      let hasStreet = false, hasRoof = false, hasNear = false, hasFar = false
      for (let k = 0; k < cnt; k++) {
        const lid = indicesRaw[off + k]
        if (lid === sentinels.idStreet) hasStreet = true
        if (lid === sentinels.idRoof) hasRoof = true
        if (lid === sentinels.idNear) hasNear = true
        if (lid === sentinels.idFar) hasFar = true
        if (sentinels.outIds.has(lid)) outOfFrustumLeaks++
      }
      if (hasStreet && hasRoof) verticalCoOccurrences++
      if (hasNear && hasFar) depthCoOccurrences++
    }

    // ── Render Verification: Clustered GGX vs Brute Force + Uniform Backward-Compat Pass ──
    const W = 256
    const H = 144
    const renderWgsl = /* wgsl */ `
${LOCAL_LIGHTS_STRUCT}
@group(0) @binding(0) var<uniform> localLights: LocalLights;
${localLightsEval()}

${clusterLightsBindings(1, 0)}
${CLUSTER_LIGHTS_WGSL}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
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

// Synthetic Market St corridor (anchor-relative): asphalt street Y=0 + 6 skyscrapers + far wall.
fn traceMarketSt(ro: vec3f, rd: vec3f) -> Hit {
  var best = Hit(false, 1e9, vec3f(0.0, 1.0, 0.0), vec3f(0.5), 0.5, 0.0);
  if (rd.y < -1e-4) {
    let tg = (0.0 - ro.y) / rd.y;
    if (tg > 10.0 && tg < best.t) {
      best = Hit(true, tg, vec3f(0.0, 1.0, 0.0), vec3f(0.20, 0.21, 0.24), 0.52, 0.05);
    }
  }
  if (rd.z < -1e-4) {
    let tw = (-3400.0 - ro.z) / rd.z;
    if (tw > 10.0 && tw < best.t) {
      best = Hit(true, tw, vec3f(0.0, 0.0, 1.0), vec3f(0.42, 0.46, 0.52), 0.45, 0.20);
    }
  }
  let bMins = array<vec3f, 6>(
    vec3f(-560.0, 0.0, -900.0),
    vec3f(180.0, 0.0, -950.0),
    vec3f(-620.0, 0.0, -1700.0),
    vec3f(200.0, 0.0, -1800.0),
    vec3f(-540.0, 0.0, -2550.0),
    vec3f(220.0, 0.0, -2650.0),
  );
  let bMaxs = array<vec3f, 6>(
    vec3f(-180.0, 1150.0, -350.0),
    vec3f(580.0, 1250.0, -400.0),
    vec3f(-190.0, 1450.0, -1100.0),
    vec3f(620.0, 1500.0, -1150.0),
    vec3f(-185.0, 1600.0, -1950.0),
    vec3f(640.0, 1550.0, -2000.0),
  );
  let albedos = array<vec3f, 6>(
    vec3f(0.62, 0.58, 0.54),
    vec3f(0.48, 0.55, 0.66),
    vec3f(0.68, 0.56, 0.48),
    vec3f(0.54, 0.60, 0.64),
    vec3f(0.60, 0.64, 0.68),
    vec3f(0.52, 0.50, 0.56),
  );
  let roughs = array<f32, 6>(0.38, 0.22, 0.58, 0.28, 0.16, 0.46);
  let metals = array<f32, 6>(0.12, 0.65, 0.08, 0.40, 0.78, 0.22);

  for (var i = 0u; i < 6u; i++) {
    let res = rayBox(ro, rd, bMins[i], bMaxs[i]);
    if (res.x > 10.0 && res.x < best.t) {
      best = Hit(true, res.x, res.yzw, albedos[i], roughs[i], metals[i]);
    }
  }
  return best;
}

struct FragClusterOut {
  @location(0) clusteredCol: vec4f,
  @location(1) bruteForceCol: vec4f,
}

@fragment
fn fsCluster(vIn: VsOut) -> FragClusterOut {
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
  let hit = traceMarketSt(eye, rd);
  if (!hit.hit) {
    return FragClusterOut(vec4f(0.0), vec4f(0.0));
  }

  let worldPos = eye + rd * hit.t;
  let linearDepth = dot(worldPos - eye, fwd);
  let viewDir = -rd;

  let colClustered = evalClusteredLightsGGX(
    worldPos, hit.normal, viewDir, hit.albedo, hit.roughness, hit.metallic, uv, linearDepth,
  );

  var colRef = vec3f(0.0);
  if (linearDepth > 0.0 && linearDepth <= clusterParams.upFar.w) {
    let N = normalize(hit.normal);
    let V = normalize(viewDir);
    let nLights = clusterParams.counts.x;
    for (var i = 0u; i < nLights; i++) {
      colRef += evalClusterLightGGX(clusterLights[i], worldPos, N, V, hit.albedo, hit.roughness, hit.metallic);
    }
  }

  return FragClusterOut(vec4f(colClustered, 1.0), vec4f(colRef, 1.0));
}

@fragment
fn fsUniform(vIn: VsOut) -> @location(0) vec4f {
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
  let hit = traceMarketSt(eye, rd);
  if (!hit.hit) {
    return vec4f(0.0);
  }
  let worldPos = eye + rd * hit.t;
  let colUniform = evalLocalLights(worldPos, hit.normal, rd, hit.albedo, hit.roughness, 0.0, 0.0);
  return vec4f(colUniform, 1.0);
}
`
    const renderMod = await shader(device, 'lights-cluster-live-compare', renderWgsl)
    const uniformBgl = device.createBindGroupLayout({
      label: 'lights-live-uniform-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    const pipeLayout = device.createPipelineLayout({
      bindGroupLayouts: [uniformBgl, localLights.clusterBindGroupLayout],
    })
    const [clusterPipe, uniformPipe] = await Promise.all([
      device.createRenderPipelineAsync({
        label: 'lights-cluster-live-compare',
        layout: pipeLayout,
        vertex: { module: renderMod, entryPoint: 'vs' },
        fragment: {
          module: renderMod,
          entryPoint: 'fsCluster',
          targets: [{ format: 'rgba32float' }, { format: 'rgba32float' }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      device.createRenderPipelineAsync({
        label: 'lights-cluster-live-uniform',
        layout: pipeLayout,
        vertex: { module: renderMod, entryPoint: 'vs' },
        fragment: {
          module: renderMod,
          entryPoint: 'fsUniform',
          targets: [{ format: 'rgba32float' }],
        },
        primitive: { topology: 'triangle-list' },
      }),
    ])
    const uniformBg = device.createBindGroup({
      label: 'lights-live-uniform-bg',
      layout: uniformBgl,
      entries: [{ binding: 0, resource: { buffer: localLights.buffer } }],
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
    const uniformTex = device.createTexture({
      size: [W, H],
      format: 'rgba32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    {
      const enc = device.createCommandEncoder()
      const pass1 = enc.beginRenderPass({
        colorAttachments: [
          { view: clusteredTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
          { view: refTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
      })
      pass1.setPipeline(clusterPipe)
      pass1.setBindGroup(0, uniformBg)
      pass1.setBindGroup(1, localLights.clusterBindGroup)
      pass1.draw(3)
      pass1.end()

      const pass2 = enc.beginRenderPass({
        colorAttachments: [
          { view: uniformTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
        ],
      })
      pass2.setPipeline(uniformPipe)
      pass2.setBindGroup(0, uniformBg)
      pass2.setBindGroup(1, localLights.clusterBindGroup)
      pass2.draw(3)
      pass2.end()

      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    const clusteredPixels = await readTextureF32(clusteredTex, W, H)
    const refPixels = await readTextureF32(refTex, W, H)
    const uniformPixels = await readTextureF32(uniformTex, W, H)
    clusteredTex.destroy()
    refTex.destroy()
    uniformTex.destroy()

    let maxAbsErr = 0
    let maxRelErr = 0
    let nonFiniteCount = 0
    let clusteredLitPixels = 0
    let uniformLitPixels = 0
    let uniformPeak = 0
    let peakRadiance = 0
    let hitPixels = 0
    for (let i = 0; i < W * H; i++) {
      const o = i * 4
      if (refPixels[o + 3] > 0.5) hitPixels++
      let pixLum = 0
      let uLum = 0
      for (let c = 0; c < 3; c++) {
        const a = clusteredPixels[o + c]
        const b = refPixels[o + c]
        const u = uniformPixels[o + c]
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(u)) { nonFiniteCount++; continue }
        const err = Math.abs(a - b)
        if (err > maxAbsErr) maxAbsErr = err
        if (b > 1e-4) maxRelErr = Math.max(maxRelErr, err / b)
        if (b > peakRadiance) peakRadiance = b
        if (u > uniformPeak) uniformPeak = u
        pixLum += b
        uLum += u
      }
      if (pixLum > 1e-4) clusteredLitPixels++
      if (uLum > 1e-4) uniformLitPixels++
    }

    // ── GPU Timestamp-Query Benchmark of LocalLights.dispatchCluster() ──────
    // Submit back-to-back dispatches in one command buffer (after a warmup batch) so Apple Silicon
    // GPU clocks up to active frame frequency instead of idling between CPU mapAsync stalls.
    let cullGpuMs = null
    let cullGpuMinMs = null
    let cullGpuMaxMs = null
    if (gpu.canTime) {
      const warmupRuns = 24
      const timedRuns = 16
      const querySet = device.createQuerySet({ type: 'timestamp', count: timedRuns * 2 })
      const resolved = device.createBuffer({
        size: timedRuns * 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
      const readBuf = device.createBuffer({
        size: timedRuns * 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      for (let i = 0; i < warmupRuns; i++) {
        localLights.dispatchCluster(enc, view, aspect, zNear, zFar)
      }
      for (let i = 0; i < timedRuns; i++) {
        localLights.dispatchCluster(enc, view, aspect, zNear, zFar, {
          cull: { querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 },
        })
      }
      enc.resolveQuerySet(querySet, 0, timedRuns * 2, resolved, 0)
      enc.copyBufferToBuffer(resolved, 0, readBuf, 0, timedRuns * 16)
      device.queue.submit([enc.finish()])
      await readBuf.mapAsync(GPUMapMode.READ)
      const stamps = new BigUint64Array(readBuf.getMappedRange().slice(0))
      readBuf.unmap()
      querySet.destroy()
      resolved.destroy()
      readBuf.destroy()
      const samples = []
      for (let i = 0; i < timedRuns; i++) {
        const t0 = stamps[i * 2]
        const t1 = stamps[i * 2 + 1]
        if (t1 > t0) samples.push(Number(t1 - t0) / 1e6)
      }
      if (samples.length) {
        samples.sort((a, b) => a - b)
        cullGpuMs = samples[samples.length >> 1]
        cullGpuMinMs = samples[0]
        cullGpuMaxMs = samples[samples.length - 1]
      }
    }

    // ── Verify clear() resets both uniform & clustered paths cleanly ────────
    localLights.clear()
    {
      const enc = device.createCommandEncoder()
      localLights.dispatchCluster(enc, view, aspect, zNear, zFar)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const clearedCounters = await readBufferU32(clustered.counterBuffer, 4)
    const afterClear = {
      count: localLights.count,
      clusterCount: localLights.clusterCount,
      statsTotal: localLights.stats.total,
      statsClustered: localLights.stats.clustered,
      activeClusters: clearedCounters[3],
      allocated: clearedCounters[0],
    }

    localLights.destroyClustered()
    const afterDestroy = {
      clusteredNull: localLights.clustered === null,
      clusterCount: localLights.clusterCount,
      bglNull: localLights.clusterBindGroupLayout === null,
      bgNull: localLights.clusterBindGroup === null,
    }

    return {
      faults: gpu.faults,
      canTime: gpu.canTime,
      beforeInit,
      afterInit,
      statsLow,
      statsMed,
      statsHigh,
      counters: {
        totalAllocated: counters[0],
        overflows: counters[1],
        maxPerCluster: counters[2],
        activeClusters: counters[3],
      },
      separation: {
        cStreet,
        cRoof,
        cNear,
        cFar,
        streetHasStreet: setStreet.has(sentinels.idStreet),
        streetHasRoof: setStreet.has(sentinels.idRoof),
        roofHasRoof: setRoof.has(sentinels.idRoof),
        roofHasStreet: setRoof.has(sentinels.idStreet),
        nearHasNear: setNear.has(sentinels.idNear),
        nearHasFar: setNear.has(sentinels.idFar),
        farHasFar: setFar.has(sentinels.idFar),
        farHasNear: setFar.has(sentinels.idNear),
        verticalCoOccurrences,
        depthCoOccurrences,
        outCount: sentinels.outIds.size,
        outOfFrustumLeaks,
      },
      render: {
        pixels: W * H,
        hitPixels,
        clusteredLitPixels,
        uniformLitPixels,
        uniformPeak,
        peakRadiance,
        maxAbsErr,
        maxRelErr,
        nonFiniteCount,
      },
      timing: {
        cullGpuMs,
        cullGpuMinMs,
        cullGpuMaxMs,
      },
      afterClear,
      afterDestroy,
      maxClusterLights: MAX_CLUSTER_LIGHTS,
    }
  })

  check(result.faults.length === 0, `zero WebGPU uncaptured errors (${result.faults.join('; ') || 'clean'})`)
  check(
    result.beforeInit.clusteredNull && result.beforeInit.clusterCount === 0
      && result.beforeInit.bglNull && result.beforeInit.bgNull
      && result.afterInit.sameInstance && result.afterInit.maxLights === result.maxClusterLights
      && result.afterInit.hasBgl && result.afterInit.hasBg,
    `LocalLights.initClustered() lazy idempotent init with 512-light layout & bind group`,
  )

  // 1. Uniform buffer backward compatibility (12 / 28 / 48 priority budgets + live shader render)
  check(
    result.statsLow.count === 12 && result.statsLow.budget === 12
      && result.statsMed.count === 28 && result.statsMed.budget === 28
      && result.statsHigh.count === 48 && result.statsHigh.budget === 48
      && result.statsHigh.car > 0 && result.statsHigh.street > 0 && result.statsHigh.extra > 0,
    `uniform top-48 backward compatibility intact (low=${result.statsLow.count}/12, med=${result.statsMed.count}/28, high=${result.statsHigh.count}/48: car=${result.statsHigh.car}, street=${result.statsHigh.street}, extra=${result.statsHigh.extra})`,
  )
  check(
    result.render.uniformLitPixels > 2000 && result.render.uniformPeak > 0.05,
    `legacy evalLocalLights() uniform path shades Market St (${result.render.uniformLitPixels} lit pixels, peak=${result.render.uniformPeak.toFixed(3)})`,
  )

  // 2. 512-light 3D clustered GPU path
  check(
    result.statsHigh.clusterCount >= 300 && result.statsHigh.clusterCount <= result.maxClusterLights
      && result.statsHigh.clustered === result.statsHigh.clusterCount,
    `3D clustered path stages ${result.statsHigh.clusterCount} simultaneous Market St lights (>= 300, <= 512)`,
  )
  check(
    result.counters.overflows === 0 && result.counters.activeClusters > 100,
    `GPU atomic pool clean: ${result.counters.totalAllocated} indices across ${result.counters.activeClusters}/3456 clusters, max ${result.counters.maxPerCluster}/cluster, ${result.counters.overflows} overflows`,
  )

  const sep = result.separation
  check(
    sep.cStreet.cy !== sep.cRoof.cy
      && sep.streetHasStreet && !sep.streetHasRoof
      && sep.roofHasRoof && !sep.roofHasStreet
      && sep.verticalCoOccurrences === 0,
    `vertical skyscraper separation (Y=5m cy=${sep.cStreet.cy} vs Y=120m cy=${sep.cRoof.cy}): 0 co-occurrences`,
  )
  check(
    sep.cNear.cz !== sep.cFar.cz
      && sep.nearHasNear && !sep.nearHasFar
      && sep.farHasFar && !sep.farHasNear
      && sep.depthCoOccurrences === 0,
    `depth Z-slice separation (Z=25m cz=${sep.cNear.cz} vs Z=180m cz=${sep.cFar.cz}): 0 co-occurrences`,
  )
  check(
    sep.outCount === 20 && sep.outOfFrustumLeaks === 0,
    `out-of-frustum culling: 0/${sep.outCount} lateral out-of-frustum lights entered any cluster`,
  )

  const r = result.render
  check(
    r.nonFiniteCount === 0 && r.clusteredLitPixels > 5000 && r.peakRadiance > 0.05 && r.maxAbsErr < 1e-4,
    `clustered GGX vs brute-force (${result.statsHigh.clusterCount} lights, ${r.clusteredLitPixels}/${r.hitPixels} lit, peak=${r.peakRadiance.toFixed(3)}): maxAbsErr=${r.maxAbsErr.toExponential(2)} (< 1e-4), nonFinite=${r.nonFiniteCount}`,
  )

  const t = result.timing
  check(
    result.canTime && t.cullGpuMs !== null && t.cullGpuMs > 0 && t.cullGpuMs < 0.2,
    `dispatchCluster() GPU cull time (${result.statsHigh.clusterCount} lights): median ${t.cullGpuMs?.toFixed(4) ?? 'n/a'} ms (min ${t.cullGpuMinMs?.toFixed(4) ?? 'n/a'} ms, max ${t.cullGpuMaxMs?.toFixed(4) ?? 'n/a'} ms; < 0.2 ms)`,
  )

  check(
    result.afterClear.count === 0 && result.afterClear.clusterCount === 0
      && result.afterClear.statsTotal === 0 && result.afterClear.statsClustered === 0
      && result.afterClear.activeClusters === 0 && result.afterClear.allocated === 0
      && result.afterDestroy.clusteredNull && result.afterDestroy.bglNull && result.afterDestroy.bgNull,
    `clear() and destroyClustered() cleanly zero GPU clusters and release resources`,
  )
} catch (e) {
  failures.push(String(e))
}

await finish('lights-cluster-live')
