// Real headless Chrome WebGPU verification for standalone compute GTAO (engine/page/gtao.ts) (#165).
//
// Renders analytic synthetic depth24plus + view-space normal test scenes on GPU at 640x360 and 1280x720:
//   1. Flat open plane: AO > 0.94 everywhere (no self-occlusion artifacts).
//   2. 90-degree concave corner (floor meeting back wall): crease AO < 0.65, open floor AO > 0.92,
//      smooth monotonic falloff away from the crease (both with normal texture and depth-only normals).
//   3. Foreground pillar in front of distant background wall: background wall stays clear of dark halos.
//   4. Dynamic resolution stability across 0.50x, 0.75x, 1.0x + halfRes mode: reallocs === 0, zero faults, zero NaNs.
//   5. GTAO_WGSL multi-bounce helper compilation and algebraic sanity on GPU.
//   6. GPU execution timing at 1280x720 via timestamp-query and paced batch timing.
//
//   node engine/test/gtao.mjs
import { start } from './kit.mjs'

const { url, page: openPage, check, failures, finish } = await start()

try {
  const page = await openPage({ size: [1280, 720], dpr: 1 })
  await page.route('**/probe-gtao', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${url}/probe-gtao`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader, NEAR, FAR, DEPTH } = await import('/probe/gpu.ts')
    const { createGtao, GTAO_WGSL } = await import('/page/gtao.ts')

    const gpu = await openGpu()
    const { device } = gpu

    // Synthetic scene rasterizer: outputs exact Voxelwright depth24plus + view-space rgba8snorm normal.
    // sceneMode:
    //   0 = flat open plane (tilted ground plane facing camera, no occluders)
    //   1 = 90-degree concave corner (horizontal floor y=0 meeting vertical back wall z=-45)
    //   2 = foreground pillar (z=-25, x in [-4, 4]) in front of distant background wall (z=-120)
    const SCENE_WGSL = /* wgsl */ `
struct SceneU {
  renderSize: vec2f,
  tanHalf: vec2f,
  nearZ: f32,
  farZ: f32,
  mode: u32,
  pad: u32,
  camEye: vec4f,
  camRight: vec4f,
  camUp: vec4f,
  camForward: vec4f,
}
@group(0) @binding(0) var<uniform> s: SceneU;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VOut;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

struct FOut { @location(0) normal: vec4f, @builtin(frag_depth) depth: f32 }

fn encodeDepth(linearZ: f32) -> f32 {
  return clamp(s.farZ / (s.farZ - s.nearZ) * (1.0 - s.nearZ / max(linearZ, s.nearZ)), 0.0, 1.0);
}

fn worldToViewN(nw: vec3f) -> vec3f {
  return normalize(vec3f(dot(nw, s.camRight.xyz), dot(nw, s.camUp.xyz), -dot(nw, s.camForward.xyz)));
}

@fragment fn fs(in: VOut) -> FOut {
  let px = in.pos.xy;
  if (px.x >= s.renderSize.x || px.y >= s.renderSize.y) {
    return FOut(vec4f(0.0, 0.0, 1.0, 1.0), 1.0);
  }
  let uv = px / s.renderSize;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let rd = normalize(s.camForward.xyz + s.camRight.xyz * (ndc.x * s.tanHalf.x) + s.camUp.xyz * (ndc.y * s.tanHalf.y));
  let ro = s.camEye.xyz;

  var bestT = 1e9;
  var bestN = vec3f(0.0, 0.0, 1.0);

  if (s.mode == 0u) {
    // Open tilted ground plane y = 0.
    if (rd.y < -1e-5) {
      let t = -ro.y / rd.y;
      if (t > 0.0) { bestT = t; bestN = vec3f(0.0, 1.0, 0.0); }
    }
  } else if (s.mode == 1u) {
    // 90-degree concave corner: horizontal floor y = 0 (for z >= -45) + vertical back wall z = -45 (for y >= 0).
    if (rd.y < -1e-5) {
      let t = -ro.y / rd.y;
      let hit = ro + rd * t;
      if (t > 0.0 && hit.z >= -45.0 && t < bestT) {
        bestT = t;
        bestN = vec3f(0.0, 1.0, 0.0);
      }
    }
    if (rd.z < -1e-5) {
      let t = (-45.0 - ro.z) / rd.z;
      let hit = ro + rd * t;
      if (t > 0.0 && hit.y >= 0.0 && t < bestT) {
        bestT = t;
        bestN = vec3f(0.0, 0.0, 1.0);
      }
    }
  } else {
    // Foreground pillar (box x in [-5, 5], z in [-29, -21], y in [-40, 40]) in front of distant wall z = -120.
    if (rd.z < -1e-5) {
      let tWall = (-120.0 - ro.z) / rd.z;
      if (tWall > 0.0) { bestT = tWall; bestN = vec3f(0.0, 0.0, 1.0); }
    }
    let invRd = vec3f(
      1.0 / select(rd.x, 1e-6, abs(rd.x) < 1e-6),
      1.0 / select(rd.y, 1e-6, abs(rd.y) < 1e-6),
      1.0 / select(rd.z, 1e-6, abs(rd.z) < 1e-6),
    );
    let bMin = vec3f(-5.0, -40.0, -29.0);
    let bMax = vec3f(5.0, 40.0, -21.0);
    let t0 = (bMin - ro) * invRd;
    let t1 = (bMax - ro) * invRd;
    let tSmall = min(t0, t1);
    let tBig = max(t0, t1);
    let tEnter = max(max(tSmall.x, tSmall.y), tSmall.z);
    let tExit = min(min(tBig.x, tBig.y), tBig.z);
    if (tExit >= max(tEnter, 0.0) && tEnter > 0.0 && tEnter < bestT) {
      bestT = tEnter;
      let hit = ro + rd * tEnter;
      if (abs(hit.z - bMax.z) < 0.05) { bestN = vec3f(0.0, 0.0, 1.0); }
      else if (abs(hit.x - bMin.x) < 0.05) { bestN = vec3f(-1.0, 0.0, 0.0); }
      else if (abs(hit.x - bMax.x) < 0.05) { bestN = vec3f(1.0, 0.0, 0.0); }
      else { bestN = vec3f(0.0, 0.0, 1.0); }
    }
  }

  if (bestT > 1e8) {
    return FOut(vec4f(0.0, 0.0, 1.0, 1.0), 1.0);
  }
  let linearZ = bestT * dot(rd, s.camForward.xyz);
  let vn = worldToViewN(bestN);
  return FOut(vec4f(vn, 1.0), encodeDepth(linearZ));
}
`

    // Helper compute shader to decode rgba16float AO into f32 buffer for exact readback without JS float16 decoding bugs.
    const READBACK_WGSL = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<vec4f>;
struct CopyU { width: u32, height: u32, pad0: u32, pad1: u32 }
@group(0) @binding(2) var<uniform> cu: CopyU;

@compute @workgroup_size(8, 8, 1)
fn copyAo(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= cu.width || gid.y >= cu.height) { return; }
  outBuf[gid.y * cu.width + gid.x] = textureLoad(srcTex, vec2i(gid.xy), 0);
}
`

    // Multi-bounce WGSL test shader.
    const MB_WGSL = /* wgsl */ `
${GTAO_WGSL}
@group(0) @binding(0) var<storage, read_write> outMb: array<vec4f>;
@compute @workgroup_size(1)
fn testMb() {
  outMb[0] = vec4f(gtaoMultiBounce(1.0, vec3f(0.8, 0.5, 0.2)), 0.0);
  outMb[1] = vec4f(gtaoMultiBounce(0.0, vec3f(0.8, 0.5, 0.2)), 0.0);
  outMb[2] = vec4f(gtaoMultiBounce(0.5, vec3f(0.85, 0.85, 0.85)), 0.0);
  outMb[3] = vec4f(gtaoMultiBounce(0.5, vec3f(0.10, 0.10, 0.10)), 0.0);
}
`

    const [sceneMod, rbMod, mbMod] = await Promise.all([
      shader(device, 'gtao-test-scene', SCENE_WGSL),
      shader(device, 'gtao-test-readback', READBACK_WGSL),
      shader(device, 'gtao-test-mb', MB_WGSL),
    ])

    const scenePipe = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: sceneMod, entryPoint: 'vs' },
      fragment: { module: sceneMod, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' },
    })
    const sceneUBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const sceneBG = device.createBindGroup({ layout: scenePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sceneUBuf } }] })

    const rbPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: rbMod, entryPoint: 'copyAo' } })
    const rbUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    // Verify GTAO_WGSL multi-bounce on GPU.
    const mbPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: mbMod, entryPoint: 'testMb' } })
    const mbBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const mbRead = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const mbBG = device.createBindGroup({ layout: mbPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: mbBuf } }] })
    {
      const enc = device.createCommandEncoder()
      const p = enc.beginComputePass()
      p.setPipeline(mbPipe); p.setBindGroup(0, mbBG); p.dispatchWorkgroups(1); p.end()
      enc.copyBufferToBuffer(mbBuf, 0, mbRead, 0, 64)
      device.queue.submit([enc.finish()])
      await mbRead.mapAsync(GPUMapMode.READ)
    }
    const mbOut = Array.from(new Float32Array(mbRead.getMappedRange().slice(0)))
    mbRead.unmap(); mbBuf.destroy(); mbRead.destroy()

    function makeCam(eye, target, fovY = 60) {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
      const forward = unit(sub(target, eye))
      const right = unit(cross(forward, [0, 1, 0]))
      const up = cross(right, forward)
      return { eye, forward, right, up, tanHalfFovY: Math.tan((fovY * Math.PI) / 360) }
    }

    const MAX_W = 1280, MAX_H = 720
    const depthTex = device.createTexture({
      size: [MAX_W, MAX_H],
      format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const normalTex = device.createTexture({
      size: [MAX_W, MAX_H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const depthView = depthTex.createView()
    const normalView = normalTex.createView()

    const gtao = await createGtao(device, [MAX_W, MAX_H])

    const maxFloats = MAX_W * MAX_H * 4
    const rbStorage = device.createBuffer({ size: maxFloats * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const rbRead = device.createBuffer({ size: maxFloats * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const rbBG = device.createBindGroup({
      layout: rbPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: gtao.view },
        { binding: 1, resource: { buffer: rbStorage } },
        { binding: 2, resource: { buffer: rbUBuf } },
      ],
    })

    function renderScene(encoder, mode, renderSize, cam) {
      const [rw, rh] = renderSize
      const tanHalfY = cam.tanHalfFovY
      const tanHalfX = tanHalfY * (rw / rh)
      const ab = new ArrayBuffer(96)
      const f = new Float32Array(ab), u = new Uint32Array(ab)
      f[0] = rw; f[1] = rh; f[2] = tanHalfX; f[3] = tanHalfY
      f[4] = NEAR; f[5] = FAR; u[6] = mode; u[7] = 0
      f[8] = cam.eye[0]; f[9] = cam.eye[1]; f[10] = cam.eye[2]; f[11] = 0
      f[12] = cam.right[0]; f[13] = cam.right[1]; f[14] = cam.right[2]; f[15] = 0
      f[16] = cam.up[0]; f[17] = cam.up[1]; f[18] = cam.up[2]; f[19] = 0
      f[20] = cam.forward[0]; f[21] = cam.forward[1]; f[22] = cam.forward[2]; f[23] = 0
      device.queue.writeBuffer(sceneUBuf, 0, u)

      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view: normalView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 1, 1] }],
        depthStencilAttachment: { view: depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      })
      rp.setViewport(0, 0, rw, rh, 0, 1)
      rp.setPipeline(scenePipe)
      rp.setBindGroup(0, sceneBG)
      rp.draw(3)
      rp.end()
    }

    async function runAndReadAo({ mode, renderSize, cam, useNormal = true, radius = 14, power = 1.0, frameIndex = 0, halfRes = false }) {
      const enc = device.createCommandEncoder()
      renderScene(enc, mode, renderSize, cam)
      gtao.dispatch(enc, {
        depth: depthView,
        normal: useNormal ? normalView : undefined,
        renderSize,
        allocSize: [MAX_W, MAX_H],
        projParams: { tanHalfFovY: cam.tanHalfFovY, aspect: renderSize[0] / renderSize[1], near: NEAR, far: FAR },
        radius,
        power,
        frameIndex,
        halfRes,
      })
      const st = gtao.stats()
      const [aw, ah] = st.aoSize
      device.queue.writeBuffer(rbUBuf, 0, new Uint32Array([aw, ah, 0, 0]))
      const cp = enc.beginComputePass()
      cp.setPipeline(rbPipe); cp.setBindGroup(0, rbBG)
      cp.dispatchWorkgroups(Math.ceil(aw / 8), Math.ceil(ah / 8))
      cp.end()
      const byteLen = aw * ah * 16
      enc.copyBufferToBuffer(rbStorage, 0, rbRead, 0, byteLen)
      device.queue.submit([enc.finish()])
      await rbRead.mapAsync(GPUMapMode.READ, 0, byteLen)
      const data = new Float32Array(rbRead.getMappedRange(0, byteLen).slice(0))
      rbRead.unmap()
      return { data, width: aw, height: ah, stats: st }
    }

    function regionStats(buf, w, x0, y0, x1, y1) {
      let min = Infinity, max = -Infinity, sum = 0, n = 0, bad = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = buf[(y * w + x) * 4]
          if (!Number.isFinite(v)) { bad++; continue }
          if (v < min) min = v
          if (v > max) max = v
          sum += v; n++
        }
      }
      return { min, max, mean: n ? sum / n : NaN, bad, n }
    }

    function checkAllFinite(buf, w, h) {
      let bad = 0, outOfRange = 0
      for (let i = 0; i < w * h * 4; i += 4) {
        const ao = buf[i], z = buf[i + 1]
        if (!Number.isFinite(ao) || !Number.isFinite(z)) bad++
        else if (ao < -1e-4 || ao > 1.0001) outOfRange++
      }
      return { bad, outOfRange }
    }

    // ── 1. Flat open plane (640x360 & 1280x720, explicit & depth-only normals) ──
    const flatCam = makeCam([0, 22, 0], [0, 0, -40], 60)
    const flat640 = await runAndReadAo({ mode: 0, renderSize: [640, 360], cam: flatCam, useNormal: true, radius: 14 })
    const flat640Stats = regionStats(flat640.data, flat640.width, 40, 120, 600, 340)
    const flat720 = await runAndReadAo({ mode: 0, renderSize: [1280, 720], cam: flatCam, useNormal: true, radius: 14 })
    const flat720Stats = regionStats(flat720.data, flat720.width, 80, 240, 1200, 680)
    const flatDepthOnly = await runAndReadAo({ mode: 0, renderSize: [640, 360], cam: flatCam, useNormal: false, radius: 14 })
    const flatDepthOnlyStats = regionStats(flatDepthOnly.data, flatDepthOnly.width, 40, 120, 600, 340)

    // ── 2. 90-degree concave corner (floor y=0 meeting wall z=-45) ──────────────
    const cornerCam = makeCam([0, 16, 0], [0, 2, -45], 60)
    async function measureCorner(renderSize, useNormal) {
      const res = await runAndReadAo({ mode: 1, renderSize, cam: cornerCam, useNormal, radius: 16, power: 1.0 })
      const { data, width, height } = res
      const cx = width >> 1
      // Find the exact crease row where view-normal transitions from wall (+Z) to floor (+Y) along center column.
      let creaseY = -1
      for (let y = 10; y < height - 10; y++) {
        const ny0 = data[(y * width + cx) * 4 + 3]
        const ny1 = data[((y + 1) * width + cx) * 4 + 3]
        if (ny1 - ny0 > 0.35) { creaseY = y + 1; break }
      }
      // Measure band means moving downward along the floor away from the crease.
      const bandMean = (dyStart, dyEnd) => {
        const y0 = Math.min(height - 2, Math.max(1, creaseY + dyStart))
        const y1 = Math.min(height - 1, Math.max(y0 + 1, creaseY + dyEnd))
        return regionStats(data, width, Math.floor(width * 0.25), y0, Math.floor(width * 0.75), y1)
      }
      const scale = height / 360
      const crease = bandMean(0, Math.max(3, Math.round(4 * scale)))
      const near = bandMean(Math.round(8 * scale), Math.round(14 * scale))
      const mid = bandMean(Math.round(24 * scale), Math.round(34 * scale))
      const open = bandMean(Math.round(85 * scale), Math.round(115 * scale))
      return { creaseY, crease, near, mid, open, finite: checkAllFinite(data, width, height) }
    }
    const corner640 = await measureCorner([640, 360], true)
    const corner720 = await measureCorner([1280, 720], true)
    const cornerDepthOnly = await measureCorner([640, 360], false)

    // ── 3. Foreground pillar in front of distant background wall (halo test) ────
    const haloCam = makeCam([0, 0, 0], [0, 0, -120], 60)
    const halo720 = await runAndReadAo({ mode: 2, renderSize: [1280, 720], cam: haloCam, useNormal: true, radius: 14, power: 1.0 })
    // Find right edge of the foreground pillar on center row (z jumps from ~21 to ~120).
    let pillarRightX = -1
    const midY = halo720.height >> 1
    for (let x = halo720.width >> 1; x < halo720.width - 20; x++) {
      const z0 = halo720.data[(midY * halo720.width + x) * 4 + 1]
      const z1 = halo720.data[(midY * halo720.width + x + 1) * 4 + 1]
      if (z1 - z0 > 50) { pillarRightX = x + 1; break }
    }
    // Sample background wall right next to pillar silhouette (2..16 px past edge) vs far open background wall.
    const haloAdj = regionStats(halo720.data, halo720.width, pillarRightX + 2, midY - 80, pillarRightX + 18, midY + 80)
    const haloFar = regionStats(halo720.data, halo720.width, halo720.width - 220, midY - 80, halo720.width - 80, midY + 80)

    // ── 4. Dynamic resolution stability (0.50x, 0.75x, 1.0x + halfRes) ──────────
    const dynChecks = []
    const scales = [
      { label: '0.50x', size: [640, 360], halfRes: false },
      { label: '0.75x', size: [960, 540], halfRes: false },
      { label: '1.00x', size: [1280, 720], halfRes: false },
      { label: '1.00x-halfRes', size: [1280, 720], halfRes: true },
      { label: '0.75x-halfRes', size: [960, 540], halfRes: true },
      { label: '0.50x-return', size: [640, 360], halfRes: false },
    ]
    for (let i = 0; i < scales.length; i++) {
      const sc = scales[i]
      const res = await runAndReadAo({ mode: 1, renderSize: sc.size, cam: cornerCam, useNormal: true, radius: 16, frameIndex: i, halfRes: sc.halfRes })
      const fin = checkAllFinite(res.data, res.width, res.height)
      dynChecks.push({ label: sc.label, aoSize: res.stats.aoSize, reallocs: res.stats.reallocs, ...fin })
    }
    const finalStats = gtao.stats()

    // ── 5. GPU Timing at 1280x720 (timestamp-query + paced batch) ───────────────
    // Pre-render scene once into depthView/normalView at 1280x720 so timing isolates GTAO compute only.
    {
      const enc = device.createCommandEncoder()
      renderScene(enc, 1, [1280, 720], cornerCam)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }

    async function benchGtao(halfRes) {
      // Warmup
      for (let i = 0; i < 6; i++) {
        const enc = device.createCommandEncoder()
        gtao.dispatch(enc, {
          depth: depthView, normal: normalView, renderSize: [1280, 720], allocSize: [MAX_W, MAX_H],
          projParams: { tanHalfFovY: cornerCam.tanHalfFovY, aspect: 1280 / 720, near: NEAR, far: FAR },
          radius: 16, power: 1.0, frameIndex: i, halfRes,
        })
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()

      // Hardware timestamp-query across all 4 compute passes (8 timestamps = 4 begin/end pairs).
      let gpuMs = null
      let breakdown = null
      if (gpu.canTime) {
        const qs = device.createQuerySet({ type: 'timestamp', count: 8 })
        const resolved = device.createBuffer({ size: 64, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
        const read = device.createBuffer({ size: 64, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
        const totals = [], p0s = [], p4s = [], gts = [], dns = []
        for (let i = 0; i < 15; i++) {
          const enc = device.createCommandEncoder()
          gtao.dispatch(enc, {
            depth: depthView, normal: normalView, renderSize: [1280, 720], allocSize: [MAX_W, MAX_H],
            projParams: { tanHalfFovY: cornerCam.tanHalfFovY, aspect: 1280 / 720, near: NEAR, far: FAR },
            radius: 16, power: 1.0, frameIndex: i, halfRes,
            timestampWrites: {
              prefilter0: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
              prefilter4: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
              gtao: { querySet: qs, beginningOfPassWriteIndex: 4, endOfPassWriteIndex: 5 },
              denoise: { querySet: qs, beginningOfPassWriteIndex: 6, endOfPassWriteIndex: 7 },
            },
          })
          enc.resolveQuerySet(qs, 0, 8, resolved, 0)
          enc.copyBufferToBuffer(resolved, 0, read, 0, 64)
          device.queue.submit([enc.finish()])
          await read.mapAsync(GPUMapMode.READ)
          const t = new BigUint64Array(read.getMappedRange().slice(0))
          read.unmap()
          const d0 = Number(t[1] - t[0]) / 1e6
          const d1 = Number(t[3] - t[2]) / 1e6
          const d2 = Number(t[5] - t[4]) / 1e6
          const d3 = Number(t[7] - t[6]) / 1e6
          if (d0 >= 0 && d1 >= 0 && d2 >= 0 && d3 >= 0) {
            p0s.push(d0); p4s.push(d1); gts.push(d2); dns.push(d3); totals.push(d0 + d1 + d2 + d3)
          }
        }
        qs.destroy(); resolved.destroy(); read.destroy()
        const med = (arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1] }
        if (totals.length) {
          gpuMs = med(totals)
          breakdown = { prefilter: med(p0s) + med(p4s), gtao: med(gts), denoise: med(dns) }
        }
      }

      // Paced batch wall-clock timing (like gpu.ts pace()).
      const batches = 40
      const t0 = performance.now()
      for (let i = 0; i < batches; i++) {
        const enc = device.createCommandEncoder()
        gtao.dispatch(enc, {
          depth: depthView, normal: normalView, renderSize: [1280, 720], allocSize: [MAX_W, MAX_H],
          projParams: { tanHalfFovY: cornerCam.tanHalfFovY, aspect: 1280 / 720, near: NEAR, far: FAR },
          radius: 16, power: 1.0, frameIndex: i, halfRes,
        })
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()
      const pacedMs = (performance.now() - t0) / batches
      return { gpuMs, breakdown, pacedMs }
    }

    const timingFull = await benchGtao(false)
    const timingHalf = await benchGtao(true)

    gtao.destroy()
    depthTex.destroy(); normalTex.destroy(); sceneUBuf.destroy()
    rbStorage.destroy(); rbRead.destroy(); rbUBuf.destroy()
    await device.queue.onSubmittedWorkDone()

    return {
      canTime: gpu.canTime,
      faults: gpu.faults,
      mbOut,
      flat640Stats,
      flat720Stats,
      flatDepthOnlyStats,
      corner640,
      corner720,
      cornerDepthOnly,
      pillarRightX,
      haloAdj,
      haloFar,
      dynChecks,
      finalStats,
      timingFull,
      timingHalf,
    }
  })

  // ── Assertions ──────────────────────────────────────────────────────────────
  check(result.faults.length === 0, `zero WebGPU faults (got ${result.faults.length}: ${result.faults.join('; ')})`)

  // Flat open plane (> 0.94 everywhere)
  check(result.flat640Stats.min > 0.94 && result.flat640Stats.bad === 0,
    `flat open plane 640x360 AO min=${result.flat640Stats.min.toFixed(4)} mean=${result.flat640Stats.mean.toFixed(4)} (> 0.94)`)
  check(result.flat720Stats.min > 0.94 && result.flat720Stats.bad === 0,
    `flat open plane 1280x720 AO min=${result.flat720Stats.min.toFixed(4)} mean=${result.flat720Stats.mean.toFixed(4)} (> 0.94)`)
  check(result.flatDepthOnlyStats.min > 0.94 && result.flatDepthOnlyStats.bad === 0,
    `flat open plane 640x360 (depth-reconstructed normals) AO min=${result.flatDepthOnlyStats.min.toFixed(4)} mean=${result.flatDepthOnlyStats.mean.toFixed(4)} (> 0.94)`)

  // 90-degree concave corner (< 0.65 crease, > 0.92 open floor, monotonic falloff)
  for (const [label, c] of [['640x360', result.corner640], ['1280x720', result.corner720], ['640x360 depth-only normals', result.cornerDepthOnly]]) {
    check(c.creaseY > 0, `90° corner ${label} crease detected at y=${c.creaseY}`)
    check(c.crease.mean < 0.65, `90° corner ${label} crease AO mean=${c.crease.mean.toFixed(4)} (< 0.65)`)
    check(c.open.mean > 0.92, `90° corner ${label} open floor AO mean=${c.open.mean.toFixed(4)} (> 0.92)`)
    check(c.crease.mean < c.near.mean && c.near.mean < c.mid.mean && c.mid.mean < c.open.mean,
      `90° corner ${label} monotonic falloff: crease=${c.crease.mean.toFixed(3)} < near=${c.near.mean.toFixed(3)} < mid=${c.mid.mean.toFixed(3)} < open=${c.open.mean.toFixed(3)}`)
    check(c.finite.bad === 0 && c.finite.outOfRange === 0, `90° corner ${label} zero NaNs/Infs/out-of-range`)
  }

  // Halo rejection (foreground pillar in front of distant background wall)
  const haloDrop = result.haloFar.mean - result.haloAdj.mean
  check(result.pillarRightX > 0, `foreground pillar edge detected at x=${result.pillarRightX}`)
  check(result.haloAdj.mean > 0.92 && result.haloAdj.min > 0.88 && haloDrop < 0.05,
    `pillar halo rejection: adjacent wall mean=${result.haloAdj.mean.toFixed(4)} (min=${result.haloAdj.min.toFixed(4)}), far wall=${result.haloFar.mean.toFixed(4)}, drop=${haloDrop.toFixed(4)} (< 0.05)`)

  // Dynamic resolution stability + zero reallocs
  check(result.finalStats.reallocs === 0, `dynamic resolution reallocs=${result.finalStats.reallocs} (=== 0 across 0.50x/0.75x/1.0x + halfRes)`)
  for (const d of result.dynChecks) {
    check(d.reallocs === 0 && d.bad === 0 && d.outOfRange === 0,
      `scale ${d.label} aoSize=${d.aoSize.join('x')} reallocs=${d.reallocs} bad=${d.bad}`)
  }

  // Multi-bounce WGSL helper
  const mb1 = result.mbOut[0], mb0 = result.mbOut[4], mbBright = result.mbOut[8], mbDark = result.mbOut[12]
  check(Math.abs(mb1 - 1.0) < 1e-3 && Math.abs(mb0) < 1e-5 && mbBright > mbDark && mbBright > 0.7 && mbDark >= 0.5,
    `GTAO_WGSL gtaoMultiBounce: vis1=${mb1.toFixed(4)}, vis0=${mb0.toFixed(4)}, bright(0.5)=${mbBright.toFixed(4)} > dark(0.5)=${mbDark.toFixed(4)}`)

  // Timing report
  const fmt = (t) => t.gpuMs != null
    ? `gpu=${t.gpuMs.toFixed(3)} ms (prefilter=${t.breakdown.prefilter.toFixed(3)}, gtao=${t.breakdown.gtao.toFixed(3)}, denoise=${t.breakdown.denoise.toFixed(3)}), paced=${t.pacedMs.toFixed(3)} ms`
    : `paced=${t.pacedMs.toFixed(3)} ms (no timestamp-query)`
  console.log(`  timing 1280x720 full-res: ${fmt(result.timingFull)}`)
  console.log(`  timing 1280x720 half-res: ${fmt(result.timingHalf)}`)
  check(result.timingFull.pacedMs > 0 && result.timingHalf.pacedMs > 0, '1280x720 timing measured')
} catch (e) {
  failures.push(String(e))
}

await finish('gtao')
