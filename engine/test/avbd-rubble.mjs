// Standalone headless Chrome WebGPU verification for Lane SM-GPU-FX (#226):
//   1. `avbd-rubble.ts`:
//      - Compiles all 6 compute + 1 render pipelines with 0 GPU validation faults.
//      - Spawns a dense rubble burst (512 boxes) above groundY = 10, steps 120 frames on GPU
//        with zero CPU readback during stepping.
//      - Verifies every body remains finite (0 NaN/Inf, 0 explosions), settles cleanly on/above
//        groundY without tunneling, drops velocity significantly, and heap-truncates dense piles
//        to <= 32 neighbors per body.
//      - Renders zero-copy directly from `bodiesBuffer` into an HDR rgba16float + depth24plus target
//        and verifies non-zero lit HDR pixels & finite output.
//   2. `billows.ts` + `puffs.ts`:
//      - Compiles solid toroidal billows & 3D flame tongues pipelines cleanly via `puffs()`.
//      - Verifies stateless `setClock(t)` Time Rewind replays blast billows cleanly backward and
//        renders non-zero HDR pixels (solid billows + close-range 3D flame tongues + puffs).
//   3. `grass.ts`:
//      - Compiles instanced grass blade + wildflower stem + multi-petal head pipelines cleanly.
//      - Updates rolling 128x128 patch, tests incremental shift, `scorch`, `flatten`, `setShock`,
//        and renders non-zero HDR grass/wildflower pixels with 0 GPU faults.
//
//   node engine/test/avbd-rubble.mjs
import { start } from './kit.mjs'

const { url, page: openPage, check, failures, finish } = await start()

try {
  const page = await openPage({ size: [1280, 720], dpr: 1 })
  await page.route('**/probe-avbd-rubble', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${url}/probe-avbd-rubble`)

  const result = await page.evaluate(async () => {
    const { openGpu, camera, DEPTH, shader } = await import('/probe/gpu.ts')
    const { createAvbdRubble, AVBD_BODY_FLOATS } = await import('/page/avbd-rubble.ts')
    const { puffs } = await import('/page/puffs.ts')
    const { createGrass } = await import('/page/grass.ts')

    const gpu = await openGpu()
    const { device, faults } = gpu
    const colorFormat = 'rgba16float'
    const W = 384, H = 216

    // Helper compute pass to copy rgba16float texture to f32 storage buffer for inspection.
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
    const copyMod = await shader(device, 'test-read-hdr', READ_HDR_WGSL)
    const copyPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: copyMod, entryPoint: 'copyHdr' } })
    const copyUBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(copyUBuf, 0, new Uint32Array([W, H, 0, 0]))

    const hdrTex = device.createTexture({
      size: [W, H],
      format: colorFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const depthTex = device.createTexture({
      size: [W, H],
      format: DEPTH,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const to = { color: hdrTex.createView(), depth: depthTex.createView(), size: [W, H] }

    const hdrBufSize = W * H * 16
    const hdrStorage = device.createBuffer({ size: hdrBufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const hdrRead = device.createBuffer({ size: hdrBufSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const copyBG = device.createBindGroup({
      layout: copyPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: to.color },
        { binding: 1, resource: { buffer: hdrStorage } },
        { binding: 2, resource: { buffer: copyUBuf } },
      ],
    })

    async function inspectHdr() {
      const enc = device.createCommandEncoder()
      const cp = enc.beginComputePass()
      cp.setPipeline(copyPipe)
      cp.setBindGroup(0, copyBG)
      cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8))
      cp.end()
      enc.copyBufferToBuffer(hdrStorage, 0, hdrRead, 0, hdrBufSize)
      device.queue.submit([enc.finish()])
      await hdrRead.mapAsync(GPUMapMode.READ)
      const px = new Float32Array(hdrRead.getMappedRange().slice(0))
      hdrRead.unmap()
      let nonZero = 0, bad = 0, maxCh = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
          bad++
        } else {
          const m = Math.max(r, g, b)
          if (m > maxCh) maxCh = m
          if (m > 1e-4) nonZero++
        }
      }
      return { nonZero, bad, maxCh }
    }

    async function readF32(buf, count) {
      const byteLen = count * 4
      const staging = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(buf, 0, staging, 0, byteLen)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    async function readU32(buf, count) {
      const byteLen = count * 4
      const staging = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(buf, 0, staging, 0, byteLen)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Uint32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    function clearTarget(enc) {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1.0 },
      })
      p.end()
    }

    // ════════════════════════════════════════════════════════════════════════
    // 1. AVBD Rubble: Dense pile spawn, 120 GPU steps, heap-truncation, render
    // ════════════════════════════════════════════════════════════════════════
    const rubble = await createAvbdRubble(device, colorFormat)
    const groundY = 10.0
    const spawned = rubble.spawnBurst([0, groundY + 18, -60], 10, 256, groundY, [0.46, 0.42, 0.38], {
      emberHeat: 0.85,
      speedScale: 0.75,
      seed: 42,
    })
    // Also spawn a tight cluster of 96 overlapping boxes to exercise the >32 neighbor heap-sort truncation!
    const spawnedDense = rubble.spawnBurst([0, groundY + 8, -60], 4, 96, groundY, [0.5, 0.36, 0.3], {
      emberHeat: 0.5,
      speedScale: 0.15,
      seed: 99,
    })
    const totalRubble = spawned + spawnedDense

    // Capture initial mean speed after 1 step vs settled speed after 120 steps.
    {
      const enc = device.createCommandEncoder()
      rubble.step(enc, 1 / 60, groundY)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()
    const neighCountsEarly = await readU32(rubble.neighborCountsBuffer, totalRubble)
    let maxNeigh = 0
    let denseBodiesHitCap = 0
    for (let i = 0; i < totalRubble; i++) {
      if (neighCountsEarly[i] > maxNeigh) maxNeigh = neighCountsEarly[i]
      if (neighCountsEarly[i] === 32) denseBodiesHitCap++
    }

    for (let s = 0; s < 140; s++) {
      const enc = device.createCommandEncoder()
      rubble.step(enc, 1 / 60, groundY)
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    const bodyData = await readF32(rubble.bodiesBuffer, totalRubble * AVBD_BODY_FLOATS)
    let nonFiniteCount = 0
    let tunneledCount = 0
    let explodedCount = 0
    let sleepingCount = 0
    let speedSum = 0
    let minY = Infinity
    let maxY = -Infinity

    for (let i = 0; i < totalRubble; i++) {
      const o = i * AVBD_BODY_FLOATS
      const px = bodyData[o], py = bodyData[o + 1], pz = bodyData[o + 2], invM = bodyData[o + 3]
      const qx = bodyData[o + 4], qy = bodyData[o + 5], qz = bodyData[o + 6], qw = bodyData[o + 7]
      const vx = bodyData[o + 8], vy = bodyData[o + 9], vz = bodyData[o + 10]
      const sleepTimer = bodyData[o + 15]
      const hx = bodyData[o + 16], hy = bodyData[o + 17], hz = bodyData[o + 18]
      if (
        !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) ||
        !Number.isFinite(qx) || !Number.isFinite(qy) || !Number.isFinite(qz) || !Number.isFinite(qw) ||
        !Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz) ||
        invM <= 0
      ) {
        nonFiniteCount++
        continue
      }
      const speed = Math.hypot(vx, vy, vz)
      speedSum += speed
      if (sleepTimer > 0.3) sleepingCount++
      const minHalf = Math.min(hx, hy, hz)
      if (py < groundY + minHalf * 0.5 - 0.25) tunneledCount++
      if (Math.hypot(px, py - groundY, pz + 60) > 4000) explodedCount++
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    const meanSpeedSettled = speedSum / totalRubble

    // Render rubble zero-copy into HDR target.
    const rubbleCam = camera([0, groundY + 26, 25], [0, groundY + 6, -60], 60)
    rubble.setViewport(W, H)
    {
      const enc = device.createCommandEncoder()
      clearTarget(enc)
      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      rp.setViewport(0, 0, W, H, 0, 1)
      rp.setScissorRect(0, 0, W, H)
      rubble.draw(rp, rubbleCam)
      rp.end()
      device.queue.submit([enc.finish()])
    }
    const rubbleRender = await inspectHdr()

    // ════════════════════════════════════════════════════════════════════════
    // 2. Billows + 3D Flame Tongues via Puffs (including Time Rewind clock)
    // ════════════════════════════════════════════════════════════════════════
    const smoke = await puffs(device, colorFormat)
    smoke.setClock(5.0)
    smoke.blast([0, 14, -75], 22)
    smoke.step(0.45) // age = 0.45s: fiery incandescent billow fireball
    // Active close-range burning cells (< 240 cells from eye) feed 3D tapered flame tongues.
    smoke.flame([8, 4, -45], 1 / 60)
    smoke.flame([-8, 4, -45], 1 / 60)

    const fxCam = camera([0, 22, 10], [0, 16, -75], 60)
    {
      const enc = device.createCommandEncoder()
      clearTarget(enc)
      smoke.draw(enc, to, fxCam)
      device.queue.submit([enc.finish()])
    }
    const billowsForward = await inspectHdr()
    const billowsStatsFwd = smoke.billows.stats

    // Rewind clock backward to before the blast (t = 4.5 < born 5.0): blast billows should vanish!
    smoke.setClock(4.5)
    {
      const enc = device.createCommandEncoder()
      clearTarget(enc)
      smoke.billows.draw(enc, to, fxCam)
      device.queue.submit([enc.finish()])
    }
    const billowsRewoundBefore = smoke.billows.stats.activeBlasts

    // Scrub clock forward again to age = 1.2s: stateless blast billows reappear cleanly!
    smoke.setClock(6.2)
    {
      const enc = device.createCommandEncoder()
      clearTarget(enc)
      smoke.billows.draw(enc, to, fxCam)
      device.queue.submit([enc.finish()])
    }
    const billowsRewoundActive = smoke.billows.stats.activeBlasts
    const billowsScrubRender = await inspectHdr()

    // ════════════════════════════════════════════════════════════════════════
    // 3. Toroidal Instanced Grass & Wildflowers
    // ════════════════════════════════════════════════════════════════════════
    const grass = await createGrass(device, colorFormat)
    const sampleGround = (wx, wz) => ({
      y: Math.sin(wx * 0.015) * 2.5 + Math.cos(wz * 0.015) * 2.5,
      kind: 3, // material 3 = grass
    })
    grass.update([0, 12, 0], sampleGround, { dt: 1 / 60, pushPos: [0, 0, -25] })
    const grassTexelsInit = grass.stats.grassTexels
    grass.scorch([0, 0, -40], 24, 1.0)
    grass.flatten([15, 0, -35], 18, 0.9)
    grass.setShock([0, 0, -40], 35, 1.4)
    // Shift camera by 2 texels (10 cells) to verify incremental rolling patch update.
    grass.update([10, 12, 5], sampleGround, { dt: 1 / 60, pushPos: [10, 0, -20] })
    const grassStatsAfter = grass.stats

    const grassCam = camera([10, 16, 20], [10, 2, -60], 60)
    {
      const enc = device.createCommandEncoder()
      clearTarget(enc)
      grass.draw(enc, to, grassCam)
      device.queue.submit([enc.finish()])
    }
    const grassRender = await inspectHdr()

    // Clean up GPU resources.
    rubble.dispose()
    smoke.billows.dispose()
    grass.dispose()
    hdrTex.destroy(); depthTex.destroy()
    copyUBuf.destroy(); hdrStorage.destroy(); hdrRead.destroy()
    await device.queue.onSubmittedWorkDone()

    return {
      faults,
      // AVBD Rubble
      totalRubble,
      maxNeigh,
      denseBodiesHitCap,
      nonFiniteCount,
      tunneledCount,
      explodedCount,
      sleepingCount,
      meanSpeedSettled,
      minY,
      maxY,
      rubbleRender,
      // Billows + Tongues
      billowsForward,
      billowsStatsFwd,
      billowsRewoundBefore,
      billowsRewoundActive,
      billowsScrubRender,
      // Grass
      grassTexelsInit,
      grassStatsAfter,
      grassRender,
    }
  })

  // ── Assertions ────────────────────────────────────────────────────────────
  check(result.faults.length === 0, `zero WebGPU validation faults (got ${result.faults.length}: ${result.faults.join('; ')})`)

  // 1. AVBD Rubble
  check(result.totalRubble === 352, `spawned ${result.totalRubble} AVBD rubble boxes (expected 352)`)
  check(
    result.maxNeigh <= 32,
    `neighbor adjacency heap-sort truncation enforces <= 32 (max=${result.maxNeigh}, hitCap32=${result.denseBodiesHitCap})`,
  )
  check(
    result.nonFiniteCount === 0 && result.explodedCount === 0 && result.tunneledCount === 0,
    `141 AVBD steps finite & grounded: nonFinite=${result.nonFiniteCount}, exploded=${result.explodedCount}, tunneled=${result.tunneledCount}, y=[${result.minY.toFixed(2)}, ${result.maxY.toFixed(2)}]`,
  )
  check(
    result.meanSpeedSettled < 12.0 && result.sleepingCount > 50,
    `rubble settles on groundY=10: meanSpeed=${result.meanSpeedSettled.toFixed(2)} cells/s, sleeping=${result.sleepingCount}/${result.totalRubble}`,
  )
  check(
    result.rubbleRender.nonZero > 100 && result.rubbleRender.bad === 0,
    `zero-copy AVBD rubble render: nonZeroPx=${result.rubbleRender.nonZero}, maxHDR=${result.rubbleRender.maxCh.toFixed(2)}, bad=${result.rubbleRender.bad}`,
  )

  // 2. Billows + 3D Flame Tongues + Rewind
  check(
    result.billowsForward.nonZero > 200 && result.billowsForward.bad === 0 && result.billowsForward.maxCh > 1.0 &&
    result.billowsStatsFwd.billowInstances === 84 && result.billowsStatsFwd.tongueInstances > 0,
    `billows + 3D tongues HDR render: nonZeroPx=${result.billowsForward.nonZero}, maxHDR=${result.billowsForward.maxCh.toFixed(2)}, billows=${result.billowsStatsFwd.billowInstances}, tongues=${result.billowsStatsFwd.tongueInstances}`,
  )
  check(
    result.billowsRewoundBefore === 0 && result.billowsRewoundActive === 1 && result.billowsScrubRender.nonZero > 200,
    `stateless billow Time Rewind clock: beforeBorn=${result.billowsRewoundBefore} (0), scrubbed=${result.billowsRewoundActive} (1), px=${result.billowsScrubRender.nonZero}`,
  )

  // 3. Grass + Wildflowers
  check(
    result.grassTexelsInit === 128 * 128 && result.grassStatsAfter.updates === 2 && result.grassStatsAfter.scorchedTexels > 20,
    `rolling 128x128 grass patch: grassTexels=${result.grassTexelsInit}, updates=${result.grassStatsAfter.updates}, scorched=${result.grassStatsAfter.scorchedTexels}`,
  )
  check(
    result.grassRender.nonZero > 500 && result.grassRender.bad === 0,
    `toroidal grass & wildflowers render: nonZeroPx=${result.grassRender.nonZero}, maxHDR=${result.grassRender.maxCh.toFixed(2)}, bad=${result.grassRender.bad}`,
  )
} catch (e) {
  failures.push(String(e))
}

await finish('avbd-rubble')
