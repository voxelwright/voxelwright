// Real headless Chrome WebGPU verification for standalone GPU Compute Particles & Indirect Draw Culler
// (engine/page/gpu-particles.ts) (#165 — Wave 3D).
//
// Runs three real WebGPU tests in headless Chrome:
//   1. 65,536-Particle Compute Step + Frustum Culling + drawIndirect:
//      - Emits 32,768 particles inside frustum and 32,768 behind camera; steps 10 frames on GPU.
//      - Reads back drawIndirectArgs.instanceCount: asserts ~32,768 visible (zero behind-camera leaked),
//        and verifies clean expiration (instanceCount === 0) after lifetime elapses.
//      - Renders via pass.drawIndirect() into an HDR rgba16float target with a test depth wall at z=-30:
//        asserts non-zero HDR pixels, smooth monotonic soft-particle depth fade near wall, complete
//        occlusion behind wall, zero NaN/Inf, zero gpu.faults.
//   2. GPU Indirect Debris Culler (4,096 instances):
//      - Places 2,000 bounding boxes inside frustum and 2,096 outside (behind, left, right, beyond far, top/bottom).
//      - Verifies exact compacted visible count === 2000, every compacted ID genuinely in-frustum,
//        multiDrawIndirect entries match, and per-bucket indirect counts match exact expectations.
//   3. GPU Performance & Subgroups Report:
//      - Reports adapter/device `subgroups` status, tests fallback parity when subgroups is enabled,
//        and measures `timestamp-query` GPU time (ms) for 65,536 particles and 4,096 instances.
//
//   node engine/test/gpu-particles.mjs
import { start } from './kit.mjs'

const { url, page: openPage, check, failures, finish } = await start()

try {
  const page = await openPage({ size: [1280, 720], dpr: 1 })
  await page.route('**/probe-gpu-particles', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${url}/probe-gpu-particles`)

  const result = await page.evaluate(async () => {
    const { shader, camera, NEAR, FAR, DEPTH } = await import('/probe/gpu.ts')
    const {
      createGpuParticles,
      createIndirectCuller,
      PARTICLE_SMOKE,
      PARTICLE_FIRE,
      PARTICLE_CRUMB,
    } = await import('/page/gpu-particles.ts')

    if (!navigator.gpu) throw new Error('this browser has no WebGPU')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('WebGPU gave no adapter')

    const adapterHasSubgroups = adapter.features.has('subgroups')
    const adapterHasTimestamp = adapter.features.has('timestamp-query')
    const requiredFeatures = []
    if (adapterHasTimestamp) requiredFeatures.push('timestamp-query')
    if (adapterHasSubgroups) requiredFeatures.push('subgroups')

    const LIMITS = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxUniformBufferBindingSize']
    const requiredLimits = {}
    for (const k of LIMITS) requiredLimits[k] = adapter.limits[k]

    const device = await adapter.requestDevice({ requiredLimits, requiredFeatures })
    const faults = []
    device.addEventListener('uncapturederror', (e) => faults.push(`error: ${e.error.message}`))
    void device.lost.then((info) => faults.push(`lost: ${info.reason} ${info.message}`))

    const canTime = device.features.has('timestamp-query')
    const hasSubgroups = device.features.has('subgroups')

    // Helper: read u32s from any GPU buffer.
    async function readU32(srcBuf, count) {
      const byteLen = count * 4
      const staging = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(srcBuf, 0, staging, 0, byteLen)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    // Helper: read f32s from any GPU buffer.
    async function readF32(srcBuf, count) {
      const byteLen = count * 4
      const staging = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(srcBuf, 0, staging, 0, byteLen)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    // Helper: render a flat depth wall at linearZ = wallZ into a depth24plus texture.
    const DEPTH_WALL_WGSL = /* wgsl */ `
struct WallU { wallZ: f32, nearZ: f32, farZ: f32, pad: f32 }
@group(0) @binding(0) var<uniform> w: WallU;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

@fragment fn fs() -> @builtin(frag_depth) f32 {
  return clamp(w.farZ / (w.farZ - w.nearZ) * (1.0 - w.nearZ / max(w.wallZ, w.nearZ)), 0.0, 1.0);
}
`
    // Helper: decode rgba16float texture into f32 buffer on GPU (avoids JS float16 decoding errors).
    const READ_HDR_WGSL = /* wgsl */ `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<vec4f>;
struct CopyU { width: u32, height: u32, pad0: u32, pad1: u32 }
@group(0) @binding(2) var<uniform> cu: CopyU;

@compute @workgroup_size(8, 8, 1)
fn copyHdr(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= cu.width || gid.y >= cu.height) { return; }
  outBuf[gid.y * cu.width + gid.x] = textureLoad(srcTex, vec2i(gid.xy), 0);
}
`

    const [wallMod, copyMod] = await Promise.all([
      shader(device, 'test-depth-wall', DEPTH_WALL_WGSL),
      shader(device, 'test-read-hdr', READ_HDR_WGSL),
    ])
    const wallPipe = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: wallMod, entryPoint: 'vs' },
      fragment: { module: wallMod, entryPoint: 'fs', targets: [] },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' },
    })
    const wallUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const wallBG = device.createBindGroup({ layout: wallPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: wallUBuf } }] })

    const copyPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: copyMod, entryPoint: 'copyHdr' } })
    const copyUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    // Deterministic PRNG for repeatable tests.
    let rng = 0x12345678
    const rand = () => {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0
      return rng / 4294967296
    }

    const W = 512, H = 288
    const cam = camera([0, 20, 0], [0, 20, -100], 60)

    // ══════════════════════════════════════════════════════════════════════════
    // TEST 1: 65,536-Particle Compute Step + Frustum Culling + drawIndirect
    // ══════════════════════════════════════════════════════════════════════════
    const particles = await createGpuParticles(device, { capacity: 65536, colorFormat: 'rgba16float' })

    // Emit 32,768 strictly inside frustum (z in [-140, -20], well inside FOV cone)
    // and 32,768 strictly behind camera (z in [+20, +140]).
    for (let i = 0; i < 32768; i++) {
      const z = -(20 + rand() * 120)
      const dist = -z
      const halfY = dist * cam.tanHalf * 0.55
      const halfX = halfY * (W / H)
      const x = (rand() * 2 - 1) * halfX
      const y = 20 + (rand() * 2 - 1) * halfY
      particles.emitRaw(
        x, y, z,
        (rand() - 0.5) * 2, (rand() - 0.5) * 2, (rand() - 0.5) * 2,
        1.0, // life = 1.0s
        1.0, 0.55, 0.15,
        1.2, // size
        0.6, 2.0, 0.8,
        PARTICLE_FIRE, 0.65, 0.3, i & 255,
      )
    }
    for (let i = 0; i < 32768; i++) {
      const z = 20 + rand() * 120 // behind camera (+Z while looking along -Z)
      const x = (rand() * 2 - 1) * 40
      const y = 20 + (rand() * 2 - 1) * 25
      particles.emitRaw(
        x, y, z,
        (rand() - 0.5) * 2, (rand() - 0.5) * 2, 0.5,
        1.0,
        0.4, 0.4, 0.45,
        1.2,
        0.0, 1.0, 0.8,
        PARTICLE_SMOKE, 0.65, 0.3, i & 255,
      )
    }

    // Step 10 frames on GPU (10 * 1/60s = 0.167s < 1.0s life).
    for (let f = 0; f < 10; f++) {
      const enc = device.createCommandEncoder()
      particles.step(enc, {
        dt: 1 / 60,
        camera: cam,
        viewport: [W, H],
        near: NEAR,
        far: FAR,
        wind: [0, 0, 0],
        turbulence: 1.5,
        groundY: -100,
        smokeGrowRate: 0.2,
        softDepthRange: 6.0,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    const indirectAfter10 = await readU32(particles.indirectBuffer, 4)
    const visibleAfter10 = indirectAfter10[1]
    const vertexCountArg = indirectAfter10[0]

    // Verify zero behind-camera particles leaked into visibleIndices!
    const visIdxSample = await readU32(particles.visibleIndicesBuffer, visibleAfter10)
    const allParticleData = await readF32(particles.particleBuffer, 65536 * 16)
    let leakedBehindCount = 0
    for (let k = 0; k < visibleAfter10; k++) {
      const pIdx = visIdxSample[k]
      const pz = allParticleData[pIdx * 16 + 2]
      if (pz > 0) leakedBehindCount++
    }

    // Step past 1.0s lifetime and verify clean expiration (instanceCount -> 0).
    for (let f = 0; f < 6; f++) {
      const enc = device.createCommandEncoder()
      particles.step(enc, {
        dt: 0.2,
        camera: cam,
        viewport: [W, H],
        near: NEAR,
        far: FAR,
        wind: [0, 0, 0],
        turbulence: 0,
        groundY: -100,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const indirectExpired = await readU32(particles.indirectBuffer, 4)
    const visibleAfterExpire = indirectExpired[1]

    // Ground bounce physics check: drop a solid crumb from y=2.0 with vy=-25 onto groundY=0 inside frustum.
    {
      const enc = device.createCommandEncoder()
      particles.clear(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const bounceCam = camera([0, 4, 0], [0, 4, -100], 60)
    particles.emitRaw(0, 2.0, -25, 0, -25, 0, 2.0, 0.7, 0.6, 0.5, 1.0, 0.0, 0.0, 0.0, PARTICLE_CRUMB, 1.0, 0.5, 7)
    for (let f = 0; f < 8; f++) {
      const enc = device.createCommandEncoder()
      particles.step(enc, {
        dt: 1 / 60,
        camera: bounceCam,
        viewport: [W, H],
        gravity: -98,
        groundY: 0,
        groundBounce: true,
        wind: [0, 0, 0],
        turbulence: 0,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const bounceVisCount = (await readU32(particles.indirectBuffer, 4))[1]
    const bounceSlot = (await readU32(particles.visibleIndicesBuffer, 1))[0]
    const bounceData = await readF32(particles.particleBuffer, (bounceSlot + 1) * 16)
    const bouncedY = bounceData[bounceSlot * 16 + 1]
    const bouncedVy = bounceData[bounceSlot * 16 + 5]

    // Soft-particle depth fade + HDR drawIndirect render verification.
    const hdrTex = device.createTexture({
      size: [W, H],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const depthTex = device.createTexture({
      size: [W, H],
      format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const hdrView = hdrTex.createView()
    const depthView = depthTex.createView()

    // Clear particles and emit 4 identical HDR fire particles at 4 screen columns & 4 depths around depth wall z = -30:
    //   Col 0 (far from wall):  linearZ = 18.0 -> depthDelta = 12.0 (>= softDepthRange 6.0 -> softFade = 1.0)
    //   Col 1 (mid near wall):  linearZ = 27.0 -> depthDelta = 3.0  (50% of softDepthRange -> softFade = 0.5)
    //   Col 2 (very near wall): linearZ = 29.0 -> depthDelta = 1.0  (16.7% of softDepthRange -> softFade ~ 0.074)
    //   Col 3 (behind wall):    linearZ = 36.0 -> depthDelta = -6.0 (occluded -> 0.0)
    const renderCam = camera([0, 0, 0], [0, 0, -100], 60)
    const wallZ = 30.0
    const softRange = 6.0
    const probeConfigs = [
      { ndcX: -0.60, dist: 18.0 },
      { ndcX: -0.20, dist: 27.0 },
      { ndcX:  0.20, dist: 29.0 },
      { ndcX:  0.60, dist: 36.0 },
    ]
    {
      const enc = device.createCommandEncoder()
      particles.clear(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const aspect = W / H
    for (let i = 0; i < probeConfigs.length; i++) {
      const cfg = probeConfigs[i]
      // Place particle so its screen center lands at exact ndcX, y = 0, with constant angular screen radius!
      const px = cfg.ndcX * cfg.dist * renderCam.tanHalf * aspect
      const worldSize = cfg.dist * 0.075
      particles.emitRaw(
        px, 0, -cfg.dist,
        0, 0, 0,
        5.0,
        1.2, 0.7, 0.25, // HDR warm fire tint
        worldSize,
        1.1, // heat > 0 for HDR emissive
        0, 0,
        PARTICLE_FIRE, 0.35, 0.0, 42, // identical seed so billow shape is identical across all 4 columns
      )
    }

    // Write depth wall at z = -30, step particles (dt = 0 to keep exact probe positions), render via pass.drawIndirect().
    device.queue.writeBuffer(wallUBuf, 0, new Float32Array([wallZ, NEAR, FAR, 0]))
    const hdrBufSize = W * H * 16
    const hdrStorage = device.createBuffer({ size: hdrBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const hdrRead = device.createBuffer({ size: hdrBufSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const copyBG = device.createBindGroup({
      layout: copyPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: { buffer: hdrStorage } },
        { binding: 2, resource: { buffer: copyUBuf } },
      ],
    })
    device.queue.writeBuffer(copyUBuf, 0, new Uint32Array([W, H, 0, 0]))

    {
      const enc = device.createCommandEncoder()
      // 1. Render test depth wall into depthTex.
      const wp = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: depthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1.0 },
      })
      wp.setPipeline(wallPipe); wp.setBindGroup(0, wallBG); wp.draw(3); wp.end()

      // 2. Step particles (spawns 4 probes, frustum culls, writes indirect args).
      particles.step(enc, {
        dt: 0,
        camera: renderCam,
        viewport: [W, H],
        near: NEAR,
        far: FAR,
        wind: [0, 0, 0],
        turbulence: 0,
        groundBounce: false,
        smokeGrowRate: 0,
        softDepthRange: softRange,
      })

      // 3. Draw via pass.drawIndirect() into rgba16float HDR target with soft-particle depth fade.
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: hdrView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      })
      particles.draw(rp, { depth: depthView })
      rp.end()

      // 4. Copy rgba16float HDR pixels into f32 buffer for inspection.
      const cp = enc.beginComputePass()
      cp.setPipeline(copyPipe); cp.setBindGroup(0, copyBG)
      cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8))
      cp.end()
      enc.copyBufferToBuffer(hdrStorage, 0, hdrRead, 0, hdrBufSize)
      device.queue.submit([enc.finish()])
    }
    await hdrRead.mapAsync(GPUMapMode.READ)
    const hdrPixels = new Float32Array(hdrRead.getMappedRange().slice(0))
    hdrRead.unmap()

    let nonZeroPixels = 0, badHdrValues = 0, maxHdrChannel = 0
    for (let i = 0; i < hdrPixels.length; i += 4) {
      const r = hdrPixels[i], g = hdrPixels[i + 1], b = hdrPixels[i + 2], a = hdrPixels[i + 3]
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
        badHdrValues++
      } else {
        const m = Math.max(r, g, b)
        if (m > maxHdrChannel) maxHdrChannel = m
        if (m > 1e-4) nonZeroPixels++
      }
    }

    // Measure peak luminance in a 16x16 box around each probe's screen center.
    const probeLum = probeConfigs.map((cfg) => {
      const cx = Math.round((cfg.ndcX * 0.5 + 0.5) * W)
      const cy = Math.round(0.5 * H)
      let sum = 0, count = 0
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const x = Math.max(0, Math.min(W - 1, cx + dx))
          const y = Math.max(0, Math.min(H - 1, cy + dy))
          const o = (y * W + x) * 4
          sum += hdrPixels[o] * 0.2126 + hdrPixels[o + 1] * 0.7152 + hdrPixels[o + 2] * 0.0722
          count++
        }
      }
      return sum / count
    })

    // Parity test: if subgroups was active, verify workgroup-shared-memory fallback yields exact same 32,768 visible count.
    let particleFallbackVisible = null
    if (hasSubgroups) {
      const fbParticles = await createGpuParticles(device, { capacity: 65536, forceNoSubgroups: true })
      for (let i = 0; i < 32768; i++) {
        const z = -(25 + (i % 100))
        fbParticles.emitRaw(0, 20, z, 0, 0, 0, 1.0, 1, 1, 1, 1.0, 0, 0, 0, PARTICLE_SMOKE, 0.5, 0, i & 255)
      }
      for (let i = 0; i < 32768; i++) {
        const z = 25 + (i % 100)
        fbParticles.emitRaw(0, 20, z, 0, 0, 0, 1.0, 1, 1, 1, 1.0, 0, 0, 0, PARTICLE_SMOKE, 0.5, 0, i & 255)
      }
      const enc = device.createCommandEncoder()
      fbParticles.step(enc, { dt: 1 / 60, camera: cam, viewport: [W, H], wind: [0, 0, 0], turbulence: 0, groundY: -100 })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      particleFallbackVisible = (await readU32(fbParticles.indirectBuffer, 4))[1]
      fbParticles.destroy()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TEST 2: GPU Indirect Debris Culler — 4,096 Instances
    // ══════════════════════════════════════════════════════════════════════════
    const culler = await createIndirectCuller(device, { maxInstances: 4096, maxBuckets: 8, defaultVertexCount: 36 })
    for (let b = 0; b < 4; b++) culler.configureBucket(b, 36 + b * 12, b * 100, 0)

    const cullCam = camera([0, 10, 0], [0, 10, -100], 60)
    const cullAspect = 16 / 9
    const cullNear = 1.0
    const cullFar = 500.0
    const expectedVisibleIds = new Set()
    const expectedBucketCounts = [0, 0, 0, 0]

    // Interleave 2,000 in-frustum and 2,096 out-of-frustum instances across all 4,096 slots.
    const slots = Array.from({ length: 4096 }, (_, i) => i)
    // Deterministic Fisher-Yates shuffle so visible & culled slots are thoroughly interleaved across workgroups/subgroups.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp
    }

    for (let k = 0; k < 4096; k++) {
      const slot = slots[k]
      const instanceId = 10000 + slot
      const bucket = k & 3
      const vCount = 36 + bucket * 12
      const fVert = bucket * 100

      let cx = 0, cy = 10, cz = -50
      const hx = 1.5, hy = 1.5, hz = 1.5
      const rad = Math.hypot(hx, hy, hz)

      if (k < 2000) {
        // Strictly inside frustum: z in [-420, -15], within 60% of frustum half-extents.
        cz = -(15 + rand() * 405)
        const d = -cz
        const maxY = d * cullCam.tanHalf * 0.55
        const maxX = maxY * cullAspect
        cx = (rand() * 2 - 1) * maxX
        cy = 10 + (rand() * 2 - 1) * maxY
        expectedVisibleIds.add(instanceId)
        expectedBucketCounts[bucket]++
      } else {
        // Strictly outside frustum (split across behind, left, right, beyond far, above top, below bottom).
        const zone = (k - 2000) % 6
        if (zone === 0) {
          // Behind camera (+Z)
          cz = 15 + rand() * 200
          cx = (rand() * 2 - 1) * 30
          cy = 10 + (rand() * 2 - 1) * 20
        } else if (zone === 1) {
          // Outside left plane
          cz = -(20 + rand() * 300)
          const halfX = -cz * cullCam.tanHalf * cullAspect
          cx = -(halfX + 20 + rand() * 100)
          cy = 10 + (rand() * 2 - 1) * 20
        } else if (zone === 2) {
          // Outside right plane
          cz = -(20 + rand() * 300)
          const halfX = -cz * cullCam.tanHalf * cullAspect
          cx = halfX + 20 + rand() * 100
          cy = 10 + (rand() * 2 - 1) * 20
        } else if (zone === 3) {
          // Beyond far plane (far = 500)
          cz = -(cullFar + 25 + rand() * 300)
          cx = (rand() * 2 - 1) * 50
          cy = 10 + (rand() * 2 - 1) * 30
        } else if (zone === 4) {
          // Above top plane
          cz = -(20 + rand() * 250)
          const halfY = -cz * cullCam.tanHalf
          cy = 10 + halfY + 20 + rand() * 80
          cx = (rand() * 2 - 1) * 20
        } else {
          // Below bottom plane
          cz = -(20 + rand() * 250)
          const halfY = -cz * cullCam.tanHalf
          cy = 10 - (halfY + 20 + rand() * 80)
          cx = (rand() * 2 - 1) * 20
        }
      }

      culler.setInstance(
        slot,
        cx, cy, cz, rad,
        cx - hx, cy - hy, cz - hz,
        cx + hx, cy + hy, cz + hz,
        vCount, fVert, instanceId, bucket,
      )
    }

    culler.upload(4096)
    {
      const enc = device.createCommandEncoder()
      culler.dispatch(enc, {
        instanceCount: 4096,
        camera: cullCam,
        aspect: cullAspect,
        near: cullNear,
        far: cullFar,
      })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    const cullDrawArgs = await readU32(culler.drawIndirectBuffer, 4)
    const cullVisibleCount = cullDrawArgs[1]
    const compactedIds = await readU32(culler.visibleInstanceIdsBuffer, cullVisibleCount)
    const multiDrawRaw = await readU32(culler.multiDrawIndirectBuffer, cullVisibleCount * 4)
    const bucketDrawRaw = await readU32(culler.bucketIndirectBuffer, 4 * 4)

    const seenIds = new Set()
    let falsePositiveIds = 0
    let multiDrawMismatches = 0
    for (let i = 0; i < cullVisibleCount; i++) {
      const id = compactedIds[i]
      seenIds.add(id)
      if (!expectedVisibleIds.has(id)) falsePositiveIds++
      const mdInstCount = multiDrawRaw[i * 4 + 1]
      const mdFirstInst = multiDrawRaw[i * 4 + 3]
      if (mdInstCount !== 1 || mdFirstInst !== id) multiDrawMismatches++
    }
    const actualBucketCounts = [bucketDrawRaw[1], bucketDrawRaw[5], bucketDrawRaw[9], bucketDrawRaw[13]]

    // Fallback parity check for culler when subgroups is enabled.
    let cullerFallbackVisible = null
    if (hasSubgroups) {
      const fbCuller = await createIndirectCuller(device, { maxInstances: 4096, forceNoSubgroups: true })
      const instCopyEnc = device.createCommandEncoder()
      instCopyEnc.copyBufferToBuffer(culler.instanceBuffer, 0, fbCuller.instanceBuffer, 0, 4096 * 64)
      fbCuller.dispatch(instCopyEnc, {
        instanceCount: 4096,
        camera: cullCam,
        aspect: cullAspect,
        near: cullNear,
        far: cullFar,
      })
      device.queue.submit([instCopyEnc.finish()])
      await device.queue.onSubmittedWorkDone()
      cullerFallbackVisible = (await readU32(fbCuller.drawIndirectBuffer, 4))[1]
      fbCuller.destroy()
    }

    // ══════════════════════════════════════════════════════════════════════════
    // TEST 3: GPU Performance (timestamp-query + paced batch) & Subgroups Report
    // ══════════════════════════════════════════════════════════════════════════
    // Repopulate 65,536 long-lived particles (32,768 visible + 32,768 culled) for steady-state timing.
    {
      const enc = device.createCommandEncoder()
      particles.clear(enc)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    for (let i = 0; i < 32768; i++) {
      const z = -(20 + (i % 100))
      particles.emitRaw(((i % 64) - 32) * 0.4, 20 + (((i >> 6) % 32) - 16) * 0.4, z, 0, 0, 0, 60.0, 1.0, 0.6, 0.2, 1.2, 0.5, 0.5, 0.5, PARTICLE_FIRE, 0.6, 0.3, i & 255)
    }
    for (let i = 0; i < 32768; i++) {
      const z = 20 + (i % 100)
      particles.emitRaw(((i % 64) - 32) * 0.4, 20, z, 0, 0, 0, 60.0, 0.5, 0.5, 0.5, 1.2, 0.0, 0.5, 0.5, PARTICLE_SMOKE, 0.6, 0.3, i & 255)
    }
    // Initial spawn + warmup frames.
    for (let i = 0; i < 8; i++) {
      const enc = device.createCommandEncoder()
      particles.step(enc, { dt: 1 / 60, camera: cam, viewport: [W, H], wind: [2, 0, 0], turbulence: 6, groundY: -200 })
      culler.dispatch(enc, { instanceCount: 4096, camera: cullCam, aspect: cullAspect, near: cullNear, far: cullFar })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    let particleGpuMs = null
    let cullerGpuMs = null
    if (canTime) {
      const qs = device.createQuerySet({ type: 'timestamp', count: 4 })
      const resolved = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const readBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const pTimes = [], cTimes = []

      for (let i = 0; i < 21; i++) {
        const enc = device.createCommandEncoder()
        particles.step(enc, {
          dt: 1 / 60,
          camera: cam,
          viewport: [W, H],
          wind: [2, 0, 0],
          turbulence: 6,
          groundY: -200,
          timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
        })
        culler.dispatch(enc, {
          instanceCount: 4096,
          camera: cullCam,
          aspect: cullAspect,
          near: cullNear,
          far: cullFar,
          timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
        })
        enc.resolveQuerySet(qs, 0, 4, resolved, 0)
        enc.copyBufferToBuffer(resolved, 0, readBuf, 0, 32)
        device.queue.submit([enc.finish()])
        await readBuf.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(readBuf.getMappedRange().slice(0))
        readBuf.unmap()
        if (ts[1] > ts[0]) pTimes.push(Number(ts[1] - ts[0]) / 1e6)
        if (ts[3] > ts[2]) cTimes.push(Number(ts[3] - ts[2]) / 1e6)
      }
      qs.destroy(); resolved.destroy(); readBuf.destroy()
      const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1] }
      if (pTimes.length) particleGpuMs = med(pTimes)
      if (cTimes.length) cullerGpuMs = med(cTimes)
    }

    // Also measure paced batch time for both systems.
    const N_BATCH = 60
    const tP0 = performance.now()
    for (let i = 0; i < N_BATCH; i++) {
      const enc = device.createCommandEncoder()
      particles.step(enc, { dt: 1 / 60, camera: cam, viewport: [W, H], wind: [2, 0, 0], turbulence: 6, groundY: -200 })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const particlePacedMs = (performance.now() - tP0) / N_BATCH

    const tC0 = performance.now()
    for (let i = 0; i < N_BATCH; i++) {
      const enc = device.createCommandEncoder()
      culler.dispatch(enc, { instanceCount: 4096, camera: cullCam, aspect: cullAspect, near: cullNear, far: cullFar })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const cullerPacedMs = (performance.now() - tC0) / N_BATCH

    // Clean up all GPU resources.
    particles.destroy()
    culler.destroy()
    hdrTex.destroy(); depthTex.destroy()
    wallUBuf.destroy(); copyUBuf.destroy()
    hdrStorage.destroy(); hdrRead.destroy()
    await device.queue.onSubmittedWorkDone()

    return {
      faults,
      canTime,
      adapterHasSubgroups,
      hasSubgroups,
      particlesUsesSubgroups: particles.usesSubgroups,
      cullerUsesSubgroups: culler.usesSubgroups,
      // Test 1
      vertexCountArg,
      visibleAfter10,
      leakedBehindCount,
      visibleAfterExpire,
      bounceVisCount,
      bouncedY,
      bouncedVy,
      nonZeroPixels,
      badHdrValues,
      maxHdrChannel,
      probeLum,
      particleFallbackVisible,
      // Test 2
      cullVisibleCount,
      uniqueVisibleIds: seenIds.size,
      falsePositiveIds,
      multiDrawMismatches,
      expectedBucketCounts,
      actualBucketCounts,
      cullerFallbackVisible,
      // Test 3
      particleGpuMs,
      cullerGpuMs,
      particlePacedMs,
      cullerPacedMs,
    }
  })

  // ── Assertions ──────────────────────────────────────────────────────────────
  check(result.faults.length === 0, `zero WebGPU faults (got ${result.faults.length}: ${result.faults.join('; ')})`)

  // Test 1: 65,536 particles compute step, frustum culling, expiration, ground bounce, HDR soft-particle drawIndirect
  check(result.vertexCountArg === 6, `drawIndirectArgs.vertexCount === 6 (got ${result.vertexCountArg})`)
  check(
    result.visibleAfter10 === 32768 && result.leakedBehindCount === 0,
    `65,536 particles after 10 frames: visible=${result.visibleAfter10} (expected 32768), leakedBehind=${result.leakedBehindCount}`,
  )
  check(result.visibleAfterExpire === 0, `particles expire cleanly after life elapses: instanceCount=${result.visibleAfterExpire} (expected 0)`)
  check(
    result.bounceVisCount === 1 && result.bouncedY >= 0.49 && result.bouncedVy > 0,
    `ground bounce physics reflects crumb above groundY=0 (visible=${result.bounceVisCount}, y=${result.bouncedY.toFixed(3)}, vy=${result.bouncedVy.toFixed(2)})`,
  )

  const [lumFar, lumMid, lumNear, lumBehind] = result.probeLum
  check(
    result.nonZeroPixels > 50 && result.badHdrValues === 0 && result.maxHdrChannel > 1.0,
    `HDR rgba16float drawIndirect render: nonZeroPx=${result.nonZeroPixels}, maxHDR=${result.maxHdrChannel.toFixed(3)} (> 1.0), NaN/Inf=${result.badHdrValues}`,
  )
  check(
    lumFar > lumMid && lumMid > lumNear && lumNear > 0.005 && lumBehind < 1e-5,
    `soft-particle depth fade near wall: far=${lumFar.toFixed(4)} > mid=${lumMid.toFixed(4)} > near=${lumNear.toFixed(4)} > 0, behind=${lumBehind.toFixed(6)}`,
  )
  if (result.particleFallbackVisible !== null) {
    check(
      result.particleFallbackVisible === 32768,
      `workgroup-shared-memory fallback parity (65K particles): visible=${result.particleFallbackVisible} (expected 32768)`,
    )
  }

  // Test 2: 4,096-instance GPU indirect debris culler
  check(
    result.cullVisibleCount === 2000 && result.uniqueVisibleIds === 2000 && result.falsePositiveIds === 0,
    `4,096-instance debris culler: visible=${result.cullVisibleCount}, unique=${result.uniqueVisibleIds}, falsePositives=${result.falsePositiveIds} (expected exact 2000)`,
  )
  check(result.multiDrawMismatches === 0, `multiDrawIndirect compacted entries match visible IDs (mismatches=${result.multiDrawMismatches})`)
  const bucketsOk = result.expectedBucketCounts.every((v, i) => v === result.actualBucketCounts[i])
  check(
    bucketsOk,
    `per-bucket indirect counts match exact expectations: got [${result.actualBucketCounts.join(', ')}] vs expected [${result.expectedBucketCounts.join(', ')}]`,
  )
  if (result.cullerFallbackVisible !== null) {
    check(
      result.cullerFallbackVisible === 2000,
      `workgroup-shared-memory fallback parity (4K culler): visible=${result.cullerFallbackVisible} (expected 2000)`,
    )
  }

  // Test 3: Performance & subgroups report
  console.log(
    `  subgroups: adapter=${result.adapterHasSubgroups}, device=${result.hasSubgroups}, particles=${result.particlesUsesSubgroups}, culler=${result.cullerUsesSubgroups}`,
  )
  const pMsStr = result.particleGpuMs != null ? `gpu=${result.particleGpuMs.toFixed(4)} ms` : 'gpu=n/a'
  const cMsStr = result.cullerGpuMs != null ? `gpu=${result.cullerGpuMs.toFixed(4)} ms` : 'gpu=n/a'
  console.log(`  perf 65,536 particles (step+cull+compact): ${pMsStr}, paced=${result.particlePacedMs.toFixed(4)} ms`)
  console.log(`  perf  4,096 instances (cull+compact+buckets): ${cMsStr}, paced=${result.cullerPacedMs.toFixed(4)} ms`)
  check(
    result.particlePacedMs > 0 && result.cullerPacedMs > 0 && (!result.canTime || (result.particleGpuMs != null && result.cullerGpuMs != null)),
    `GPU timing measured (timestamp-query=${result.canTime})`,
  )
} catch (e) {
  failures.push(String(e))
}

await finish('gpu-particles')
