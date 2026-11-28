// Real headless Chrome WebGPU verification for engine/page/froxel-fog.ts (#165).
//
//   node engine/test/froxel-fog.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  await page.route('**/probe-froxel', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
  )
  await page.goto(`${url}/probe-froxel`)

  const result = await page.evaluate(async () => {
    const { openGpu, camera, depthFor } = await import('/probe/gpu.ts')
    const {
      createFroxelFog,
      depthToSlice,
      sliceToDepth,
      henyeyGreenstein,
      DEFAULT_FROXEL_DIMS,
      DEFAULT_NEAR_DIST,
      DEFAULT_MAX_DIST,
    } = await import('/page/froxel-fog.ts')

    const gpu = await openGpu()
    const { device } = gpu

    // Decode IEEE 754 binary16 -> JS float64 (preserving NaN / Infinity detection).
    const f16ToF32 = (bits) => {
      const sign = (bits & 0x8000) ? -1 : 1
      const exp = (bits >> 10) & 0x1f
      const frac = bits & 0x03ff
      if (exp === 0) return sign * (frac / 1024) * 6.103515625e-5
      if (exp === 31) return frac ? Number.NaN : sign * Number.POSITIVE_INFINITY
      return sign * (1 + frac / 1024) * Math.pow(2, exp - 15)
    }

    // Read full 160x90x64 rgba16float integrated volume into Float32Array (W*H*D*4).
    const [W, H, D] = DEFAULT_FROXEL_DIMS
    const bytesPerRow = Math.ceil((W * 8) / 256) * 256 // 1280 bytes (exact multiple of 256)
    const totalBytes = bytesPerRow * H * D
    const readBuf = device.createBuffer({
      size: totalBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    const readVolume = async (tex) => {
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer(
        { texture: tex, origin: [0, 0, 0] },
        { buffer: readBuf, bytesPerRow, rowsPerImage: H },
        [W, H, D],
      )
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      await readBuf.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(readBuf.getMappedRange().slice(0))
      readBuf.unmap()
      const rowU16 = bytesPerRow >> 1
      const out = new Float32Array(W * H * D * 4)
      let nonFinite = 0
      for (let z = 0; z < D; z++) {
        const zBase = z * H * rowU16
        const oZ = z * H * W * 4
        for (let y = 0; y < H; y++) {
          const yBase = zBase + y * rowU16
          const oY = oZ + y * W * 4
          for (let x = 0; x < W; x++) {
            const s = yBase + x * 4
            const o = oY + x * 4
            for (let c = 0; c < 4; c++) {
              const v = f16ToF32(u16[s + c])
              if (!Number.isFinite(v)) nonFinite++
              out[o + c] = v
            }
          }
        }
      }
      return { data: out, nonFinite }
    }

    const at = (vol, x, y, z) => {
      const o = ((z * H + y) * W + x) * 4
      return [vol[o], vol[o + 1], vol[o + 2], vol[o + 3]]
    }
    const lum = (rgba) => rgba[0] * 0.2126 + rgba[1] * 0.7152 + rgba[2] * 0.0722

    // ── 0. Pure JS slice math & phase check ────────────────────────────────────
    let maxSliceErr = 0
    for (let s = 0; s <= D; s += 0.5) {
      const d = sliceToDepth(s, D, DEFAULT_NEAR_DIST, DEFAULT_MAX_DIST)
      const sBack = depthToSlice(d, D, DEFAULT_NEAR_DIST, DEFAULT_MAX_DIST)
      maxSliceErr = Math.max(maxSliceErr, Math.abs(sBack - s))
    }
    const nearSliceMeters = (sliceToDepth(1, D) - sliceToDepth(0, D)) * 0.1
    const farDepthMeters = sliceToDepth(D, D) * 0.1
    const hgRatio = henyeyGreenstein(1, 0.65) / henyeyGreenstein(0, 0.65)

    const fog = await createFroxelFog(device, DEFAULT_FROXEL_DIMS)
    const aspect = 16 / 9

    // ── Test 1: Zero-density / clear air + HDR composite identity ──────────────
    const viewClear = camera([0, 200, 0], [0, 200, 100], 60)
    {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewClear,
        aspect,
        baseDensity: 0,
        heightDensity: 0,
        extinctionScale: 0,
        localLights: [],
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const clearVol = await readVolume(fog.integratedTexture)
    let clearMinT = Infinity, clearMaxT = -Infinity, clearMaxScatter = 0
    for (let i = 0; i < clearVol.data.length; i += 4) {
      const r = clearVol.data[i], g = clearVol.data[i + 1], b = clearVol.data[i + 2], t = clearVol.data[i + 3]
      clearMinT = Math.min(clearMinT, t)
      clearMaxT = Math.max(clearMaxT, t)
      clearMaxScatter = Math.max(clearMaxScatter, Math.abs(r), Math.abs(g), Math.abs(b))
    }

    // Verify composite pass (`apply`) preserves clear HDR scene and fogs dense scene.
    const hdrTex = device.createTexture({
      size: [64, 36],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const hdrDepth = depthFor(device, [64, 36])
    const hdrRead = device.createBuffer({ size: 512 * 36, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const compositeOnce = async (clearCol) => {
      const enc = device.createCommandEncoder()
      enc.beginRenderPass({
        colorAttachments: [{ view: hdrTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: clearCol }],
        depthStencilAttachment: { view: hdrDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      }).end()
      fog.apply(enc, { target: hdrTex.createView(), format: 'rgba16float', depth: hdrDepth.createView() })
      enc.copyTextureToBuffer({ texture: hdrTex }, { buffer: hdrRead, bytesPerRow: 512, rowsPerImage: 36 }, [64, 36])
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      await hdrRead.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(hdrRead.getMappedRange().slice(0))
      hdrRead.unmap()
      const o = 18 * 256 + 32 * 4
      return [f16ToF32(u16[o]), f16ToF32(u16[o + 1]), f16ToF32(u16[o + 2]), f16ToF32(u16[o + 3])]
    }
    const clearCompositePx = await compositeOnce([0.4, 0.6, 0.8, 1.0])
    const clearCompositeErr = Math.max(
      Math.abs(clearCompositePx[0] - 0.4),
      Math.abs(clearCompositePx[1] - 0.6),
      Math.abs(clearCompositePx[2] - 0.8),
    )

    // ── Test 2: Beer-Lambert monotonic extinction & SF marine-layer height fog ──
    const viewHeight = camera([0, 400, 0], [0, 400, 100], 60)
    {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewHeight,
        aspect,
        time: 1.5,
        baseDensity: 0.0004,
        heightDensity: 0.024,
        heightBase: 0,
        heightTop: 900,
        heightFalloff: 200,
        noiseAmount: 0.2,
        sunDir: [0.3, 0.6, 0.74],
        sunColor: [1.5, 1.35, 1.15],
        localLights: [],
        temporalJitter: false,
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const heightVol = await readVolume(fog.integratedTexture)
    let monotonicViolations = 0
    let prevT = 1.0
    const centerT = []
    for (let z = 0; z < D; z++) {
      const v = at(heightVol.data, W >> 1, H >> 1, z)
      centerT.push(v[3])
      if (v[3] > prevT + 5e-4) monotonicViolations++
      prevT = v[3]
    }
    // Low-altitude row (y = 78, looking down into marine bank) vs high-altitude row (y = 8, looking up above ceiling).
    const lowFarT = at(heightVol.data, W >> 1, 78, D - 1)[3]
    const highFarT = at(heightVol.data, W >> 1, 8, D - 1)[3]
    const foggedCompositePx = await compositeOnce([0.0, 0.0, 0.0, 1.0])
    const foggedCompositeLum = lum(foggedCompositePx)

    // ── Test 3: Spotlight headlight cone & point street lamp + forward HG peak ──
    const viewLights = camera([0, 25, 0], [0, 25, 100], 60)
    // Position the warm street lamp on the camera's left (-right) so screen right (x = W - 12) stays dark outside both lights.
    const lampPos = [
      viewLights.eye[0] - viewLights.right[0] * 110 + viewLights.up[0] * 35 + viewLights.forward[0] * 220,
      viewLights.eye[1] - viewLights.right[1] * 110 + viewLights.up[1] * 35 + viewLights.forward[1] * 220,
      viewLights.eye[2] - viewLights.right[2] * 110 + viewLights.up[2] * 35 + viewLights.forward[2] * 220,
    ]
    {
      const enc = device.createCommandEncoder()
      fog.beginLights()
      // Forward-pointing headlight spot cone straight ahead of camera.
      fog.addSpot(
        0, 25, 15,
        0, 0, 1,
        80, 74, 62,
        450,
        Math.cos((16 * Math.PI) / 180),
        Math.cos((7 * Math.PI) / 180),
        120,
        0.65,
        1.0,
      )
      // Warm SF street lamp point light on the left-upper midground.
      fog.addPoint(lampPos[0], lampPos[1], lampPos[2], 45, 24, 8, 220, 65, 0.55, 1.0)
      fog.update(enc, {
        view: viewLights,
        aspect,
        baseDensity: 0.02,
        heightDensity: 0,
        noiseAmount: 0,
        sunColor: [0, 0, 0],
        ambientSky: [0, 0, 0],
        ambientGround: [0, 0, 0],
        temporalJitter: false,
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const lightsVol = await readVolume(fog.integratedTexture)
    const insideCone = at(lightsVol.data, W >> 1, H >> 1, D - 1)
    const outsideCone = at(lightsVol.data, W - 12, H >> 1, D - 1)
    const insideConeLum = lum(insideCone)
    const outsideConeLum = lum(outsideCone)
    const coneContrast = insideConeLum / Math.max(outsideConeLum, 1e-6)

    // Find brightest froxel on the left half near the warm street lamp (x in 15..55, y in 20..50).
    let lampBest = [0, 0, 0, 1]
    let lampBestLum = 0
    for (let y = 20; y <= 50; y++) {
      for (let x = 15; x <= 55; x++) {
        const px = at(lightsVol.data, x, y, D - 1)
        const l = lum(px)
        if (l > lampBestLum) { lampBestLum = l; lampBest = px }
      }
    }
    const lampWarm = lampBest[0] > lampBest[1] && lampBest[1] > lampBest[2]

    // Test 3b: Forward-scattering HG peak (oncoming beam toward camera vs back-scatter beam away from camera at identical distance).
    const measureSpotSymmetry = async (posZ, dirZ) => {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewLights,
        aspect,
        baseDensity: 0.02,
        heightDensity: 0,
        noiseAmount: 0,
        sunColor: [0, 0, 0],
        ambientSky: [0, 0, 0],
        ambientGround: [0, 0, 0],
        localLights: [{
          kind: 'spot',
          position: [0, 25, posZ],
          direction: [0, 0, dirZ],
          color: [80, 80, 80],
          range: 250,
          halfDist: 80,
          cosOuter: Math.cos((20 * Math.PI) / 180),
          cosInner: Math.cos((10 * Math.PI) / 180),
          anisotropy: 0.72,
        }],
        temporalJitter: false,
        reset: true,
      })
      device.queue.submit([enc.finish()])
      const v = await readVolume(fog.integratedTexture)
      return lum(at(v.data, W >> 1, H >> 1, D - 1))
    }
    // Both beams illuminate the same [50..250] cell segment along +Z; one travels toward eye (cosTheta=+1), one away (cosTheta=-1).
    const forwardPeakLum = await measureSpotSymmetry(260, -1)
    const backScatterLum = await measureSpotSymmetry(40, 1)
    const forwardScatterRatio = forwardPeakLum / Math.max(backScatterLum, 1e-6)

    // ── Test 4: Temporal convergence, camera motion & instant reset ────────────
    const samplePatch = (data) => {
      const vals = []
      for (let z = 12; z < 48; z += 4) {
        for (let y = 30; y < 60; y += 6) {
          for (let x = 50; x < 110; x += 10) {
            const p = at(data, x, y, z)
            vals.push(p[0], p[1], p[2], p[3])
          }
        }
      }
      return vals
    }
    const rmsDelta = (a, b) => {
      let sum = 0
      for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d }
      return Math.sqrt(sum / a.length)
    }
    const viewTemporal = camera([0, 300, 0], [0, 300, 100], 60)
    // Unjittered reference for measuring jitter-noise variance reduction across temporal accumulation.
    {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewTemporal,
        aspect,
        time: 0,
        baseDensity: 0.001,
        heightDensity: 0.02,
        heightBase: 0,
        heightTop: 1000,
        heightFalloff: 250,
        noiseAmount: 0.9,
        noiseScale: 1 / 400,
        sunDir: [0.4, 0.5, 0.76],
        sunColor: [1.6, 1.4, 1.1],
        localLights: [],
        temporalJitter: false,
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const refPatch = samplePatch((await readVolume(fog.integratedTexture)).data)

    const patches = []
    let temporalNonFinite = 0
    for (let f = 0; f < 12; f++) {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewTemporal,
        aspect,
        time: 0, // frozen wind so variance comes purely from Z-slice jitter converging
        baseDensity: 0.001,
        heightDensity: 0.02,
        heightBase: 0,
        heightTop: 1000,
        heightFalloff: 250,
        noiseAmount: 0.9,
        noiseScale: 1 / 400, // high-frequency wisps to stress Z-jitter convergence
        sunDir: [0.4, 0.5, 0.76],
        sunColor: [1.6, 1.4, 1.1],
        localLights: [],
        temporalAlpha: 0.12,
        temporalJitter: true,
        reset: f === 0,
      })
      device.queue.submit([enc.finish()])
      const v = await readVolume(fog.integratedTexture)
      temporalNonFinite += v.nonFinite
      patches.push(samplePatch(v.data))
    }
    const frame0Err = rmsDelta(patches[0], refPatch)
    const frame11Err = rmsDelta(patches[11], refPatch)
    const earlyDelta = rmsDelta(patches[0], patches[1])
    const lateDelta = rmsDelta(patches[10], patches[11])

    // Camera motion across 6 frames (translate + yaw).
    let motionNonFinite = 0
    for (let f = 0; f < 6; f++) {
      const yaw = f * 0.04
      const eye = [f * 12, 300 + f * 3, f * 35]
      const target = [eye[0] + Math.sin(yaw) * 100, eye[1], eye[2] + Math.cos(yaw) * 100]
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: camera(eye, target, 60),
        aspect,
        time: f * 0.016,
        baseDensity: 0.001,
        heightDensity: 0.018,
        noiseAmount: 0.7,
        temporalAlpha: 0.1,
        temporalJitter: true,
      })
      device.queue.submit([enc.finish()])
    }
    const motionVol = await readVolume(fog.integratedTexture)
    motionNonFinite = motionVol.nonFinite

    // Instant reset: switch to zero density with reset: true and confirm zero ghosting in 1 frame.
    {
      const enc = device.createCommandEncoder()
      fog.update(enc, {
        view: viewTemporal,
        aspect,
        baseDensity: 0,
        heightDensity: 0,
        extinctionScale: 0,
        localLights: [],
        reset: true,
      })
      device.queue.submit([enc.finish()])
    }
    const resetVol = await readVolume(fog.integratedTexture)
    let resetMinT = Infinity, resetMaxScatter = 0
    for (let i = 0; i < resetVol.data.length; i += 4) {
      resetMinT = Math.min(resetMinT, resetVol.data[i + 3])
      resetMaxScatter = Math.max(resetMaxScatter, Math.abs(resetVol.data[i]), Math.abs(resetVol.data[i + 1]), Math.abs(resetVol.data[i + 2]))
    }

    // ── Test 5: GPU Performance (timestamp-query + paced batch) ────────────────
    const perfLights = [
      { kind: 'spot', position: [-8, 12, 20], direction: [0, -0.05, 1], color: [50, 48, 42], range: 450, cosOuter: 0.92, cosInner: 0.97 },
      { kind: 'spot', position: [8, 12, 20], direction: [0, -0.05, 1], color: [50, 48, 42], range: 450, cosOuter: 0.92, cosInner: 0.97 },
      { kind: 'point', position: [-60, 75, 160], color: [24, 15, 7], range: 220 },
      { kind: 'point', position: [60, 75, 280], color: [24, 15, 7], range: 220 },
      { kind: 'point', position: [-60, 75, 420], color: [24, 15, 7], range: 220 },
      { kind: 'point', position: [60, 75, 560], color: [24, 15, 7], range: 220 },
      { kind: 'spot', position: [25, 14, 380], direction: [0, -0.04, -1], color: [60, 56, 50], range: 400, cosOuter: 0.90, cosInner: 0.96 },
      { kind: 'point', position: [0, 35, 120], color: [30, 10, 4], range: 180 },
    ]
    const perfView = camera([0, 35, 0], [0, 35, 100], 60)

    // Warmup
    for (let i = 0; i < 4; i++) {
      const enc = device.createCommandEncoder()
      fog.update(enc, { view: perfView, aspect, time: i * 0.016, localLights: perfLights, reset: i === 0 })
      device.queue.submit([enc.finish()])
    }
    await device.queue.onSubmittedWorkDone()

    let injectMs = null, integrateMs = null, combinedGpuMs = null
    if (gpu.canTime) {
      const qs = device.createQuerySet({ type: 'timestamp', count: 4 })
      const resolved = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const qRead = device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const injSamples = [], intSamples = [], totSamples = []
      for (let i = 0; i < 15; i++) {
        const enc = device.createCommandEncoder()
        fog.update(enc, {
          view: perfView,
          aspect,
          time: 1 + i * 0.016,
          localLights: perfLights,
          injectTimestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
          integrateTimestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
        })
        enc.resolveQuerySet(qs, 0, 4, resolved, 0)
        enc.copyBufferToBuffer(resolved, 0, qRead, 0, 32)
        device.queue.submit([enc.finish()])
        await qRead.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(qRead.getMappedRange().slice(0))
        qRead.unmap()
        if (ts[1] > ts[0] && ts[3] > ts[2]) {
          const a = Number(ts[1] - ts[0]) / 1e6
          const b = Number(ts[3] - ts[2]) / 1e6
          injSamples.push(a)
          intSamples.push(b)
          totSamples.push(a + b)
        }
      }
      qs.destroy(); resolved.destroy(); qRead.destroy()
      const med = (arr) => { arr.sort((x, y) => x - y); return arr.length ? arr[arr.length >> 1] : null }
      injectMs = med(injSamples)
      integrateMs = med(intSamples)
      combinedGpuMs = med(totSamples)
    }

    // Paced batch timing (32 frames submitted back-to-back + single-texel readback fence).
    const fenceBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const batchFrames = 32
    const t0 = performance.now()
    for (let i = 0; i < batchFrames; i++) {
      const enc = device.createCommandEncoder()
      fog.update(enc, { view: perfView, aspect, time: 2 + i * 0.016, localLights: perfLights })
      device.queue.submit([enc.finish()])
    }
    const fenceEnc = device.createCommandEncoder()
    fenceEnc.copyTextureToBuffer({ texture: fog.integratedTexture }, { buffer: fenceBuf, bytesPerRow: 256 }, [1, 1, 1])
    device.queue.submit([fenceEnc.finish()])
    await device.queue.onSubmittedWorkDone()
    await fenceBuf.mapAsync(GPUMapMode.READ)
    fenceBuf.unmap()
    const pacedMs = (performance.now() - t0) / batchFrames
    fenceBuf.destroy()

    const stats = fog.stats()
    const faults = [...gpu.faults]
    readBuf.destroy()
    hdrRead.destroy()
    hdrTex.destroy()
    hdrDepth.destroy()
    fog.destroy()

    return {
      adapter: gpu.adapter.info ? `${gpu.adapter.info.vendor} ${gpu.adapter.info.architecture}` : 'unknown',
      canTime: gpu.canTime,
      faults,
      stats,
      math: { maxSliceErr, nearSliceMeters, farDepthMeters, hgRatio },
      test1: { nonFinite: clearVol.nonFinite, clearMinT, clearMaxT, clearMaxScatter, clearCompositeErr },
      test2: {
        nonFinite: heightVol.nonFinite,
        monotonicViolations,
        tNear: centerT[0],
        tMid: centerT[D >> 1],
        tFar: centerT[D - 1],
        lowFarT,
        highFarT,
        foggedCompositeLum,
      },
      test3: {
        nonFinite: lightsVol.nonFinite,
        insideConeLum,
        outsideConeLum,
        coneContrast,
        lampBestLum,
        lampWarm,
        forwardPeakLum,
        backScatterLum,
        forwardScatterRatio,
      },
      test4: {
        temporalNonFinite,
        frame0Err,
        frame11Err,
        earlyDelta,
        lateDelta,
        motionNonFinite,
        resetNonFinite: resetVol.nonFinite,
        resetMinT,
        resetMaxScatter,
      },
      test5: { injectMs, integrateMs, combinedGpuMs, pacedMs },
    }
  })

  console.log(`GPU: ${result.adapter} · dims ${result.stats.dims.join('x')} · vram ${(result.stats.vramBytes / (1024 * 1024)).toFixed(2)} MiB`)
  check(result.faults.length === 0, `no WebGPU uncaptured errors (${result.faults.join('; ') || 'clean'})`)

  // 0. Slice & phase math
  check(result.math.maxSliceErr < 1e-5, `sliceToDepth/depthToSlice round-trip max err ${result.math.maxSliceErr.toExponential(2)} < 1e-5`)
  check(result.math.nearSliceMeters < 0.25 && Math.abs(result.math.farDepthMeters - 600) < 0.01,
    `exponential slicing: slice0=${result.math.nearSliceMeters.toFixed(3)} m, maxDist=${result.math.farDepthMeters.toFixed(1)} m`)
  check(result.math.hgRatio > 20, `Henyey-Greenstein g=0.65 forward/90deg ratio ${result.math.hgRatio.toFixed(1)}x > 20x`)

  // Test 1: Zero-density clear air
  check(result.test1.nonFinite === 0, `Test 1 clear air: 0 NaN/Inf across all ${result.stats.froxels} froxels`)
  check(result.test1.clearMinT >= 0.999 && result.test1.clearMaxT <= 1.001,
    `Test 1 clear air transmittance in [${result.test1.clearMinT.toFixed(4)}, ${result.test1.clearMaxT.toFixed(4)}]`)
  check(result.test1.clearMaxScatter <= 1e-4, `Test 1 clear air max in-scatter ${result.test1.clearMaxScatter.toExponential(2)} <= 1e-4`)
  check(result.test1.clearCompositeErr < 2e-3, `Test 1 composite pass preserves clear HDR pixel (err ${result.test1.clearCompositeErr.toExponential(2)})`)

  // Test 2: Beer-Lambert monotonicity & height fog
  check(result.test2.nonFinite === 0, `Test 2 height fog: 0 NaN/Inf`)
  check(result.test2.monotonicViolations === 0 && result.test2.tFar < result.test2.tNear * 0.6,
    `Test 2 monotonic Beer-Lambert transmittance: z0=${result.test2.tNear.toFixed(4)} -> z32=${result.test2.tMid.toFixed(4)} -> z63=${result.test2.tFar.toFixed(4)} (violations=${result.test2.monotonicViolations})`)
  check(result.test2.lowFarT < result.test2.highFarT * 0.5,
    `Test 2 SF marine layer height profile: lowAlt T=${result.test2.lowFarT.toFixed(4)} << highAlt T=${result.test2.highFarT.toFixed(4)}`)
  check(result.test2.foggedCompositeLum > 0.01, `Test 2 composite pass adds linear HDR fog radiance (lum=${result.test2.foggedCompositeLum.toFixed(4)})`)

  // Test 3: Headlight spot cone, street lamp point light, forward HG peak
  check(result.test3.nonFinite === 0, `Test 3 local lights: 0 NaN/Inf`)
  check(result.test3.insideConeLum > 0.05 && result.test3.coneContrast > 20,
    `Test 3 headlight cone contrast: inside=${result.test3.insideConeLum.toFixed(4)} vs outside=${result.test3.outsideConeLum.toExponential(2)} (${result.test3.coneContrast.toFixed(1)}x)`)
  check(result.test3.lampBestLum > 0.02 && result.test3.lampWarm,
    `Test 3 warm street lamp halo: lum=${result.test3.lampBestLum.toFixed(4)}, warm(R>G>B)=${result.test3.lampWarm}`)
  check(result.test3.forwardScatterRatio > 5,
    `Test 3 HG forward-scattering peak: forward=${result.test3.forwardPeakLum.toFixed(4)} vs back=${result.test3.backScatterLum.toFixed(4)} (${result.test3.forwardScatterRatio.toFixed(1)}x)`)

  // Test 4: Temporal convergence, camera motion & reset
  check(result.test4.temporalNonFinite === 0 && result.test4.motionNonFinite === 0 && result.test4.resetNonFinite === 0,
    `Test 4 temporal/motion/reset: 0 NaN/Inf`)
  check(result.test4.frame0Err > 0 && result.test4.frame11Err < result.test4.frame0Err * 0.55 && result.test4.lateDelta < result.test4.earlyDelta * 0.8,
    `Test 4 temporal convergence over 12 frames: errVsRef ${result.test4.frame0Err.toExponential(2)} -> ${result.test4.frame11Err.toExponential(2)} (${((1 - (result.test4.frame11Err / result.test4.frame0Err) ** 2) * 100).toFixed(1)}% variance drop), stepRMS ${result.test4.earlyDelta.toExponential(2)} -> ${result.test4.lateDelta.toExponential(2)}`)
  check(result.test4.resetMinT >= 0.999 && result.test4.resetMaxScatter <= 1e-4,
    `Test 4 reset: true clears history immediately (minT=${result.test4.resetMinT.toFixed(4)}, maxScatter=${result.test4.resetMaxScatter.toExponential(2)})`)

  // Test 5: GPU performance
  const gpuTimingStr = result.test5.combinedGpuMs !== null
    ? `gpu=${result.test5.combinedGpuMs.toFixed(3)} ms (inject=${result.test5.injectMs.toFixed(3)} ms + integrate=${result.test5.integrateMs.toFixed(3)} ms), paced=${result.test5.pacedMs.toFixed(3)} ms`
    : `paced=${result.test5.pacedMs.toFixed(3)} ms (timestamp-query unavailable)`
  const measuredMs = result.test5.combinedGpuMs ?? result.test5.pacedMs
  check(Number.isFinite(measuredMs) && measuredMs > 0 && measuredMs < 5.0, `Test 5 perf (160x90x64 + 8 lights): ${gpuTimingStr}`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

await finish('froxel-fog')
