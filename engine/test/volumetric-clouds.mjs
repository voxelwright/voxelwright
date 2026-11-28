// Real headless Chrome WebGPU verification for engine/page/volumetric-clouds.ts (#165).
//
// Exercises the standalone temporally amortized volumetric 3D cloud compute engine on the real GPU:
//   - Init verification: 64^3 3D shape LUT, 32^3 3D detail LUT, 128^2 2D weather LUT populated & non-degenerate
//   - Test 1: Clear sky (coverage = 0.0 -> transmittance ~ 1.0, radiance ~ 0.0) vs overcast/broken
//             (coverage = 0.65 -> meanTransmittance < 0.80, sunlit cloud tops, zero NaN/Inf)
//   - Test 2: Dual-lobe HG silver lining (solar forward-scatter >> anti-solar back-scatter on identical
//             cloud edges) & solar elevation tinting (sunset R/B ratio >> noon R/B ratio)
//   - Test 3: Camera below (0.05 km), inside (2.2 km), and above (12 km) curved Earth cloud shell +
//             16-frame 4x4 Bayer temporal convergence, flight/pan reprojection, and reset full-frame fill
//   - Test 4: Dynamic resolution switching (0.50x, 0.75x, 1.00x) with 0 reallocs, VOLUMETRIC_CLOUDS_WGSL
//             composite verification, 0 WebGPU faults, and 1280x720 timestamp-query GPU timing (ms)
//
//   node engine/test/volumetric-clouds.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [800, 600], dpr: 1 })
  const harnessUrl = `${url}/volumetric-clouds-test.html`
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<!doctype html><html><head><meta charset="utf-8"><title>volumetric-clouds test</title></head><body></body></html>',
    }),
  )
  await page.goto(harnessUrl)

  const report = await page.evaluate(async () => {
    /** @type {any} */
    const gpuMod = await import('/probe/gpu.ts')
    /** @type {any} */
    const cloudsMod = await import('/page/volumetric-clouds.ts')

    const gpu = await gpuMod.openGpu()
    const { device } = gpu

    const MAX_W = 1280
    const MAX_H = 720
    const clouds = await cloudsMod.createVolumetricClouds(device, [MAX_W, MAX_H])

    // IEEE 754 binary16 -> float32 decoder for reading back rgba16float cloud output textures.
    const f16ToF32 = (h) => {
      const s = (h & 0x8000) ? -1 : 1
      const e = (h >> 10) & 0x1f
      const f = h & 0x03ff
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024)
      if (e === 31) return f === 0 ? s * Infinity : NaN
      return s * Math.pow(2, e - 15) * (1 + f / 1024)
    }

    const unit = (x, y, z) => {
      const l = Math.hypot(x, y, z) || 1
      return [x / l, y / l, z / l]
    }
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
    const basisFromForward = (fwd) => {
      const f = unit(fwd[0], fwd[1], fwd[2])
      const refUp = Math.abs(f[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0]
      const r = unit(...cross(f, refUp))
      const u = cross(r, f)
      return { cameraForward: f, cameraRight: r, cameraUp: u }
    }
    const sunAtDeg = (deg, azimZ = -1) => {
      const rad = (deg * Math.PI) / 180
      return [0, Math.sin(rad), Math.cos(rad) * azimZ]
    }
    const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

    async function readRgba16Rect(tex, width, height) {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256
      const buf = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [width, height, 1])
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()

      const stride = bytesPerRow / 2
      const data = new Float32Array(width * height * 4)
      let nonFinite = 0
      let negative = 0
      let transSum = 0
      let lumaSum = 0
      let maxLuma = 0
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let cloudPixels = 0
      let edgeLumaSum = 0
      let edgeCount = 0
      let maxEdgeLuma = 0
      let litR = 0
      let litB = 0
      let litCount = 0

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const src = y * stride + x * 4
          const dst = (y * width + x) * 4
          const r = f16ToF32(u16[src + 0])
          const g = f16ToF32(u16[src + 1])
          const b = f16ToF32(u16[src + 2])
          const a = f16ToF32(u16[src + 3])
          data[dst + 0] = r
          data[dst + 1] = g
          data[dst + 2] = b
          data[dst + 3] = a

          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
            nonFinite++
            continue
          }
          if (r < -1e-5 || g < -1e-5 || b < -1e-5 || a < -1e-5 || a > 1.001) {
            negative++
          }
          const yLum = luma(r, g, b)
          transSum += a
          lumaSum += yLum
          rSum += r
          gSum += g
          bSum += b
          if (yLum > maxLuma) maxLuma = yLum
          if (a < 0.92) {
            cloudPixels++
            litR += r
            litB += b
            litCount++
          }
          if (a > 0.15 && a < 0.92) {
            edgeLumaSum += yLum
            edgeCount++
            if (yLum > maxEdgeLuma) maxEdgeLuma = yLum
          }
        }
      }

      const n = Math.max(1, width * height)
      return {
        data,
        width,
        height,
        nonFinite,
        negative,
        meanTransmittance: transSum / n,
        meanLuma: lumaSum / n,
        maxLuma,
        meanRgb: [rSum / n, gSum / n, bSum / n],
        cloudFraction: cloudPixels / n,
        edgeMeanLuma: edgeCount > 0 ? edgeLumaSum / edgeCount : 0,
        maxEdgeLuma,
        edgeCount,
        litMeanR: litCount > 0 ? litR / litCount : 0,
        litMeanB: litCount > 0 ? litB / litCount : 0,
        litRBRatio: litCount > 0 && litB > 1e-6 ? litR / litB : 0,
      }
    }

    async function readRgba8Tex(tex, w, h, zSlice = 0) {
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256
      const buf = device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer(
        { texture: tex, origin: [0, 0, zSlice] },
        { buffer: buf, bytesPerRow },
        [w, h, 1],
      )
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const u8 = new Uint8Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      let minR = 255, maxR = 0, sumR = 0
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = u8[y * bytesPerRow + x * 4]
          if (v < minR) minR = v
          if (v > maxR) maxR = v
          sumR += v
        }
      }
      return { minR: minR / 255, maxR: maxR / 255, meanR: sumR / (w * h * 255) }
    }

    // Verify precomputed LUT textures were generated ONCE at init and contain real noise variation.
    await device.queue.onSubmittedWorkDone()
    const shapeStats = await readRgba8Tex(clouds.shapeNoiseTexture, 64, 64, 17)
    const detailStats = await readRgba8Tex(clouds.detailNoiseTexture, 32, 32, 9)
    const weatherStats = await readRgba8Tex(clouds.weatherTexture, 128, 128, 0)

    const tanHalf = Math.tan((60 * Math.PI) / 360)
    const upCam = basisFromForward([0, 0.42, -0.9075])

    function runFrame(params) {
      const enc = device.createCommandEncoder()
      clouds.update(enc, params)
      device.queue.submit([enc.finish()])
    }

    // ── Test 1: Clear Sky (coverage = 0.0) vs Broken/Overcast (coverage = 0.65) ──
    const testSize = [640, 360] // quarter-res = 320x180
    const cloudW = 320
    const cloudH = 180

    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 0.05, 0],
      ...upCam,
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(55),
      coverage: 0.0,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const clearRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 0.05, 0],
      ...upCam,
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(55),
      coverage: 0.65,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const overcastRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    // ── Test 2: Silver Lining Forward Scattering & Sun Elevation Warmth Shift ──
    // Keep camera fixed on the exact same cloud patch and flip sunDir between solar (+forward)
    // and anti-solar (-forward) at identical elevation to isolate HG silver lining cleanly.
    const silverCam = basisFromForward([0, 0.40, -0.9165])
    const sunForward = sunAtDeg(24, -1) // aligned with camera look direction -> cosTheta ~ 1.0
    const sunBehind = sunAtDeg(24, 1) // opposite azimuth, same 24 deg elevation -> anti-solar

    runFrame({
      renderSize: testSize,
      cameraPosKm: [4.2, 0.05, -2.5],
      ...silverCam,
      tanHalfFovY: tanHalf,
      sunDir: sunForward,
      coverage: 0.65,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const towardSunRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    runFrame({
      renderSize: testSize,
      cameraPosKm: [4.2, 0.05, -2.5],
      ...silverCam,
      tanHalfFovY: tanHalf,
      sunDir: sunBehind,
      coverage: 0.65,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const antiSolarRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    // Noon (60 deg) vs Sunset (3 deg) warmth shift on identical cloud field.
    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 0.05, 0],
      ...upCam,
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(60, -1),
      coverage: 0.65,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const noonRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 0.05, 0],
      ...upCam,
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(3, -1),
      coverage: 0.65,
      time: 0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const sunsetRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    // ── Test 3: Below (0.05 km), Inside (2.2 km), Above (12 km) + 16-Frame Convergence ──
    // 3A. Reference full-frame reset render at 0.05 km.
    const convParams = {
      renderSize: testSize,
      cameraPosKm: [1.5, 0.05, -1.0],
      ...upCam,
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(50, -1),
      coverage: 0.65,
      time: 12.0,
    }
    runFrame({ ...convParams, reset: true })
    await device.queue.onSubmittedWorkDone()
    const resetRefRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)
    const statsBefore16 = clouds.stats()

    // 3B. Seed history with clear sky (coverage = 0.0, reset = true), then switch to coverage = 0.65
    //     WITHOUT reset and run 16 amortized frames so all 16 Bayer sub-pixels populate from scratch.
    runFrame({ ...convParams, coverage: 0.0, reset: true })
    const fullBefore16 = clouds.stats().fullFrames
    const amortBefore16 = clouds.stats().amortizedFrames
    const visitedBayers = new Set()
    for (let f = 0; f < 16; f++) {
      runFrame({ ...convParams, reset: false })
      visitedBayers.add(clouds.stats().bayerIndex)
    }
    await device.queue.onSubmittedWorkDone()
    const after16Res = await readRgba16Rect(clouds.texture, cloudW, cloudH)
    const statsAfter16 = clouds.stats()

    // Compute per-subpixel-bucket (4x4 = 16 buckets) transmittance means & variance + MAE vs reset ref.
    const bucketTransSum = new Float64Array(16)
    const bucketLumaSum = new Float64Array(16)
    const bucketCounts = new Uint32Array(16)
    let maeTrans = 0
    let maeLuma = 0
    for (let y = 0; y < cloudH; y++) {
      for (let x = 0; x < cloudW; x++) {
        const idx = (y * cloudW + x) * 4
        const bIdx = (y & 3) * 4 + (x & 3)
        const a = after16Res.data[idx + 3]
        const l = luma(after16Res.data[idx], after16Res.data[idx + 1], after16Res.data[idx + 2])
        const refA = resetRefRes.data[idx + 3]
        const refL = luma(resetRefRes.data[idx], resetRefRes.data[idx + 1], resetRefRes.data[idx + 2])
        bucketTransSum[bIdx] += a
        bucketLumaSum[bIdx] += l
        bucketCounts[bIdx]++
        maeTrans += Math.abs(a - refA)
        maeLuma += Math.abs(l - refL)
      }
    }
    const bucketTransMeans = Array.from({ length: 16 }, (_, i) => bucketTransSum[i] / bucketCounts[i])
    const bucketLumaMeans = Array.from({ length: 16 }, (_, i) => bucketLumaSum[i] / bucketCounts[i])
    const meanBT = bucketTransMeans.reduce((s, v) => s + v, 0) / 16
    const maxSubpixelSpreadTrans = Math.max(...bucketTransMeans) - Math.min(...bucketTransMeans)
    const subpixelStdTrans = Math.sqrt(
      bucketTransMeans.reduce((s, v) => s + (v - meanBT) * (v - meanBT), 0) / 16,
    )
    const allBucketsPopulated = bucketTransMeans.every((m) => m < 0.85)
    maeTrans /= cloudW * cloudH
    maeLuma /= cloudW * cloudH

    // 3C. Reprojection stability under camera pan + flight translation (8 amortized frames).
    for (let f = 0; f < 8; f++) {
      const yaw = f * 0.045
      const panCam = basisFromForward([Math.sin(yaw), 0.35, -Math.cos(yaw)])
      runFrame({
        renderSize: testSize,
        cameraPosKm: [1.5 + f * 0.12, 0.05 + f * 0.05, -1.0 - f * 0.18],
        ...panCam,
        tanHalfFovY: tanHalf,
        sunDir: sunAtDeg(48, -1),
        coverage: 0.65,
        time: 12.0 + f * 0.05,
        reset: false,
      })
    }
    await device.queue.onSubmittedWorkDone()
    const panFlightRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    // 3D. Camera altitudes: Below (0.05 km), Inside (2.2 km), Above (12.0 km looking down).
    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 0.05, 0],
      ...basisFromForward([0, 0.42, -0.9075]),
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(50, -1),
      coverage: 0.65,
      time: 5.0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const altBelowRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 2.2, 0],
      ...basisFromForward([0, 0.0, -1.0]),
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(50, -1),
      coverage: 0.65,
      time: 5.0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const altInsideRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    runFrame({
      renderSize: testSize,
      cameraPosKm: [0, 12.0, 0],
      ...basisFromForward([0, -0.52, -0.854]),
      tanHalfFovY: tanHalf,
      sunDir: sunAtDeg(50, -1),
      coverage: 0.65,
      time: 5.0,
      reset: true,
    })
    await device.queue.onSubmittedWorkDone()
    const altAboveRes = await readRgba16Rect(clouds.texture, cloudW, cloudH)

    // ── Test 4: VOLUMETRIC_CLOUDS_WGSL Composite + Dynamic Resolution + 1280x720 GPU Timing ──
    const probeWgsl = /* wgsl */ `
${cloudsMod.VOLUMETRIC_CLOUDS_WGSL}
${cloudsMod.volumetricCloudsBindings(0, 0)}
@group(0) @binding(3) var<storage, read_write> outBuf: array<vec4f, 4>;

@compute @workgroup_size(1, 1, 1)
fn main() {
  let c0 = sampleVolumetricClouds(vec2f(0.5, 0.5));
  let skyCol = vec3f(0.25, 0.45, 0.85);
  let comp = compositeVolumetricClouds(skyCol, vec2f(0.5, 0.5));
  let cCorner = sampleVolumetricClouds(vec2f(0.99, 0.99));
  outBuf[0] = c0;
  outBuf[1] = vec4f(comp, 1.0);
  outBuf[2] = vec4f(skyCol * c0.a + c0.rgb, 1.0);
  outBuf[3] = cCorner;
}
`
    const probeMod = await gpuMod.shader(device, 'vol-clouds-composite-probe', probeWgsl)
    const probePipe = await device.createComputePipelineAsync({
      label: 'vol-clouds-composite-probe',
      layout: 'auto',
      compute: { module: probeMod, entryPoint: 'main' },
    })
    const probeOutBuf = device.createBuffer({
      size: 4 * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    const probeReadBuf = device.createBuffer({
      size: 4 * 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Switch renderSize across 0.50x (640x360), 0.75x (960x540), 1.00x (1280x720) and verify 0 reallocs.
    const scaleSizes = [
      [Math.round(MAX_W * 0.5), Math.round(MAX_H * 0.5)],
      [Math.round(MAX_W * 0.75), Math.round(MAX_H * 0.75)],
      [MAX_W, MAX_H],
      [Math.round(MAX_W * 0.5), Math.round(MAX_H * 0.5)],
      [MAX_W, MAX_H],
    ]
    const dynamicChecks = []
    for (const sz of scaleSizes) {
      for (let k = 0; k < 4; k++) {
        runFrame({
          renderSize: sz,
          cameraPosKm: [0, 0.05, 0],
          ...upCam,
          tanHalfFovY: tanHalf,
          sunDir: sunAtDeg(50, -1),
          coverage: 0.65,
          time: 20.0 + k * 0.1,
          reset: false,
        })
      }
      await device.queue.onSubmittedWorkDone()
      const cw = Math.ceil(sz[0] / 2)
      const ch = Math.ceil(sz[1] / 2)
      const r = await readRgba16Rect(clouds.texture, cw, ch)
      dynamicChecks.push({
        renderSize: sz,
        cloudSize: [cw, ch],
        nonFinite: r.nonFinite,
        negative: r.negative,
        meanTransmittance: r.meanTransmittance,
        reallocs: clouds.stats().reallocs,
      })
    }

    // Run VOLUMETRIC_CLOUDS_WGSL probe against latest 1280x720 cloud output.
    {
      const probeBg = device.createBindGroup({
        layout: probePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: clouds.view },
          { binding: 1, resource: clouds.sampler },
          { binding: 2, resource: { buffer: clouds.compositeUniforms } },
          { binding: 3, resource: { buffer: probeOutBuf } },
        ],
      })
      const enc = device.createCommandEncoder()
      const p = enc.beginComputePass()
      p.setPipeline(probePipe)
      p.setBindGroup(0, probeBg)
      p.dispatchWorkgroups(1, 1, 1)
      p.end()
      enc.copyBufferToBuffer(probeOutBuf, 0, probeReadBuf, 0, 4 * 16)
      device.queue.submit([enc.finish()])
      await probeReadBuf.mapAsync(GPUMapMode.READ)
    }
    const probeVals = new Float32Array(probeReadBuf.getMappedRange().slice(0))
    probeReadBuf.unmap()
    probeOutBuf.destroy()
    probeReadBuf.destroy()
    const compositeDiff = Math.max(
      Math.abs(probeVals[4] - probeVals[8]),
      Math.abs(probeVals[5] - probeVals[9]),
      Math.abs(probeVals[6] - probeVals[10]),
    )
    const probeAllFinite = Array.from(probeVals).every((v) => Number.isFinite(v))

    // Measure amortized per-frame GPU time (trace + reproject) at 1280x720 via timestamp-query.
    let gpuTiming = null
    if (gpu.canTime) {
      const N_FRAMES = 32 // two complete 16-frame 4x4 Bayer cycles
      const querySet = device.createQuerySet({ type: 'timestamp', count: 4 })
      const resolved = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
      const readBuf = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })

      // Warmup 4 amortized frames at 1280x720
      for (let i = 0; i < 4; i++) {
        runFrame({
          renderSize: [MAX_W, MAX_H],
          cameraPosKm: [0, 0.05, 0],
          ...upCam,
          tanHalfFovY: tanHalf,
          sunDir: sunAtDeg(50, -1),
          coverage: 0.65,
          time: 30.0 + i * 0.016,
          reset: false,
        })
      }
      await device.queue.onSubmittedWorkDone()

      const traceSamples = []
      const reprojectSamples = []
      const totalSamples = []
      for (let i = 0; i < N_FRAMES; i++) {
        const enc = device.createCommandEncoder()
        clouds.update(enc, {
          renderSize: [MAX_W, MAX_H],
          cameraPosKm: [0, 0.05, 0],
          ...upCam,
          tanHalfFovY: tanHalf,
          sunDir: sunAtDeg(50, -1),
          coverage: 0.65,
          time: 31.0 + i * 0.016,
          reset: false,
          timestampWrites: {
            trace: { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
            reproject: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
          },
        })
        enc.resolveQuerySet(querySet, 0, 4, resolved, 0)
        enc.copyBufferToBuffer(resolved, 0, readBuf, 0, 32)
        device.queue.submit([enc.finish()])
        await readBuf.mapAsync(GPUMapMode.READ)
        const ts = new BigUint64Array(readBuf.getMappedRange().slice(0))
        readBuf.unmap()
        if (ts[1] >= ts[0] && ts[3] >= ts[2]) {
          const tMs = Number(ts[1] - ts[0]) / 1e6
          const rMs = Number(ts[3] - ts[2]) / 1e6
          traceSamples.push(tMs)
          reprojectSamples.push(rMs)
          totalSamples.push(tMs + rMs)
        }
      }
      querySet.destroy()
      resolved.destroy()
      readBuf.destroy()

      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b)
        return s.length ? s[s.length >> 1] : null
      }
      const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
      gpuTiming = {
        samples: totalSamples.length,
        traceMedianMs: median(traceSamples),
        reprojectMedianMs: median(reprojectSamples),
        totalMedianMs: median(totalSamples),
        totalMeanMs: mean(totalSamples),
      }
    }

    const finalStats = clouds.stats()
    clouds.destroy()

    return {
      canTime: gpu.canTime,
      faults: [...gpu.faults],
      lutStats: { shapeStats, detailStats, weatherStats },
      test1: {
        clear: {
          meanTransmittance: clearRes.meanTransmittance,
          meanLuma: clearRes.meanLuma,
          maxLuma: clearRes.maxLuma,
          nonFinite: clearRes.nonFinite,
          negative: clearRes.negative,
        },
        overcast: {
          meanTransmittance: overcastRes.meanTransmittance,
          meanLuma: overcastRes.meanLuma,
          maxLuma: overcastRes.maxLuma,
          cloudFraction: overcastRes.cloudFraction,
          nonFinite: overcastRes.nonFinite,
          negative: overcastRes.negative,
        },
      },
      test2: {
        towardSun: {
          meanLuma: towardSunRes.meanLuma,
          edgeMeanLuma: towardSunRes.edgeMeanLuma,
          maxEdgeLuma: towardSunRes.maxEdgeLuma,
          maxLuma: towardSunRes.maxLuma,
          edgeCount: towardSunRes.edgeCount,
          nonFinite: towardSunRes.nonFinite,
        },
        antiSolar: {
          meanLuma: antiSolarRes.meanLuma,
          edgeMeanLuma: antiSolarRes.edgeMeanLuma,
          maxEdgeLuma: antiSolarRes.maxEdgeLuma,
          maxLuma: antiSolarRes.maxLuma,
          edgeCount: antiSolarRes.edgeCount,
          nonFinite: antiSolarRes.nonFinite,
        },
        noon: {
          meanTransmittance: noonRes.meanTransmittance,
          litRBRatio: noonRes.litRBRatio,
          meanRgb: noonRes.meanRgb,
          nonFinite: noonRes.nonFinite,
        },
        sunset: {
          meanTransmittance: sunsetRes.meanTransmittance,
          litRBRatio: sunsetRes.litRBRatio,
          meanRgb: sunsetRes.meanRgb,
          nonFinite: sunsetRes.nonFinite,
        },
      },
      test3: {
        visitedBayerCount: visitedBayers.size,
        fullDeltaDuring16: statsAfter16.fullFrames - fullBefore16,
        amortDeltaDuring16: statsAfter16.amortizedFrames - amortBefore16,
        resetImmediateTrans: resetRefRes.meanTransmittance,
        after16Trans: after16Res.meanTransmittance,
        allBucketsPopulated,
        subpixelStdTrans,
        maxSubpixelSpreadTrans,
        maeTrans,
        maeLuma,
        after16NonFinite: after16Res.nonFinite,
        panFlight: {
          meanTransmittance: panFlightRes.meanTransmittance,
          meanLuma: panFlightRes.meanLuma,
          nonFinite: panFlightRes.nonFinite,
          negative: panFlightRes.negative,
        },
        below: {
          meanTransmittance: altBelowRes.meanTransmittance,
          meanLuma: altBelowRes.meanLuma,
          maxLuma: altBelowRes.maxLuma,
          nonFinite: altBelowRes.nonFinite,
        },
        inside: {
          meanTransmittance: altInsideRes.meanTransmittance,
          meanLuma: altInsideRes.meanLuma,
          maxLuma: altInsideRes.maxLuma,
          nonFinite: altInsideRes.nonFinite,
        },
        above: {
          meanTransmittance: altAboveRes.meanTransmittance,
          meanLuma: altAboveRes.meanLuma,
          maxLuma: altAboveRes.maxLuma,
          nonFinite: altAboveRes.nonFinite,
        },
      },
      test4: {
        dynamicChecks,
        reallocs: finalStats.reallocs,
        vramBytes: finalStats.vramBytes,
        compositeDiff,
        probeAllFinite,
        gpuTiming,
      },
      statsBefore16,
    }
  })

  // ── Assertions & Diagnostics ───────────────────────────────────────────────
  console.log('Volumetric 3D Clouds WebGPU verification:')
  check(report.faults.length === 0, `zero WebGPU faults (${report.faults.length}: ${report.faults.join('; ')})`)

  // Precomputed LUTs populated
  const { shapeStats, detailStats, weatherStats } = report.lutStats
  check(
    shapeStats.maxR - shapeStats.minR > 0.25 && detailStats.maxR - detailStats.minR > 0.25 && weatherStats.maxR - weatherStats.minR > 0.25,
    `precomputed LUTs populated (shape=${shapeStats.minR.toFixed(2)}..${shapeStats.maxR.toFixed(2)}, detail=${detailStats.minR.toFixed(2)}..${detailStats.maxR.toFixed(2)}, weather=${weatherStats.minR.toFixed(2)}..${weatherStats.maxR.toFixed(2)})`,
  )

  // Test 1: Clear Sky vs Overcast Coverage
  const { clear, overcast } = report.test1
  check(
    clear.nonFinite === 0 && clear.negative === 0 && clear.meanTransmittance > 0.999 && clear.maxLuma < 1e-4,
    `Test 1 clear sky (cov=0.0): meanTrans=${clear.meanTransmittance.toFixed(4)}, maxLuma=${clear.maxLuma.toFixed(6)}, nonFinite=${clear.nonFinite}`,
  )
  check(
    overcast.nonFinite === 0 && overcast.negative === 0 && overcast.meanTransmittance < 0.80 && overcast.maxLuma > 0.5,
    `Test 1 broken/overcast (cov=0.65): meanTrans=${overcast.meanTransmittance.toFixed(4)}, meanLuma=${overcast.meanLuma.toFixed(3)}, maxLuma=${overcast.maxLuma.toFixed(3)}, cloudFrac=${(overcast.cloudFraction * 100).toFixed(1)}%`,
  )

  // Test 2: Silver Lining Forward Scattering & Sun Elevation Warmth Shift
  const { towardSun, antiSolar, noon, sunset } = report.test2
  const silverRatio = towardSun.edgeMeanLuma / Math.max(antiSolar.edgeMeanLuma, 1e-5)
  const peakSilverRatio = towardSun.maxEdgeLuma / Math.max(antiSolar.maxEdgeLuma, 1e-5)
  check(
    towardSun.nonFinite === 0 && antiSolar.nonFinite === 0 && towardSun.edgeCount > 50 && silverRatio > 1.8 && peakSilverRatio > 2.0,
    `Test 2 HG silver lining: towardSun edgeLuma=${towardSun.edgeMeanLuma.toFixed(3)} (peak ${towardSun.maxEdgeLuma.toFixed(2)}) vs antiSolar=${antiSolar.edgeMeanLuma.toFixed(3)} (peak ${antiSolar.maxEdgeLuma.toFixed(2)}), ratio=${silverRatio.toFixed(2)}x (peak ${peakSilverRatio.toFixed(2)}x)`,
  )
  const sunsetShiftRatio = sunset.litRBRatio / Math.max(noon.litRBRatio, 1e-5)
  check(
    noon.nonFinite === 0 && sunset.nonFinite === 0 && sunset.litRBRatio > 1.8 && sunsetShiftRatio > 1.8,
    `Test 2 sun elevation warmth: noon R/B=${noon.litRBRatio.toFixed(3)} -> sunset R/B=${sunset.litRBRatio.toFixed(3)} (${sunsetShiftRatio.toFixed(2)}x warmer)`,
  )

  // Test 3: 16-Frame Temporal Convergence + Below / Inside / Above Cloud Layer
  const t3 = report.test3
  check(
    t3.visitedBayerCount === 16 && t3.fullDeltaDuring16 === 0 && t3.amortDeltaDuring16 === 16,
    `Test 3 4x4 Bayer schedule: visited=${t3.visitedBayerCount}/16 unique sub-pixels, fullFrames+=${t3.fullDeltaDuring16}, amortizedFrames+=${t3.amortDeltaDuring16}`,
  )
  check(
    t3.after16NonFinite === 0 && t3.allBucketsPopulated && t3.subpixelStdTrans < 0.04 && t3.maeTrans < 0.08 && t3.resetImmediateTrans < 0.80,
    `Test 3 16-frame convergence: resetRefTrans=${t3.resetImmediateTrans.toFixed(4)}, after16Trans=${t3.after16Trans.toFixed(4)}, subpixelStd=${t3.subpixelStdTrans.toFixed(4)}, spread=${t3.maxSubpixelSpreadTrans.toFixed(4)}, maeTrans=${t3.maeTrans.toFixed(4)}`,
  )
  check(
    t3.panFlight.nonFinite === 0 && t3.panFlight.negative === 0 && t3.panFlight.meanTransmittance < 0.90,
    `Test 3 pan+flight reprojection: meanTrans=${t3.panFlight.meanTransmittance.toFixed(4)}, meanLuma=${t3.panFlight.meanLuma.toFixed(3)}, nonFinite=${t3.panFlight.nonFinite}`,
  )
  check(
    t3.below.nonFinite === 0 && t3.below.meanTransmittance < 0.80 && t3.below.maxLuma > 0.3,
    `Test 3 camera BELOW (0.05 km): meanTrans=${t3.below.meanTransmittance.toFixed(4)}, meanLuma=${t3.below.meanLuma.toFixed(3)}, maxLuma=${t3.below.maxLuma.toFixed(2)}`,
  )
  check(
    t3.inside.nonFinite === 0 && t3.inside.meanTransmittance < 0.80 && t3.inside.maxLuma > 0.2,
    `Test 3 camera INSIDE (2.2 km): meanTrans=${t3.inside.meanTransmittance.toFixed(4)}, meanLuma=${t3.inside.meanLuma.toFixed(3)}, maxLuma=${t3.inside.maxLuma.toFixed(2)}`,
  )
  check(
    t3.above.nonFinite === 0 && t3.above.meanTransmittance < 0.80 && t3.above.maxLuma > 0.3,
    `Test 3 camera ABOVE (12 km): meanTrans=${t3.above.meanTransmittance.toFixed(4)}, meanLuma=${t3.above.meanLuma.toFixed(3)}, maxLuma=${t3.above.maxLuma.toFixed(2)}`,
  )

  // Test 4: Dynamic Resolution (0.50x, 0.75x, 1.00x) + VOLUMETRIC_CLOUDS_WGSL + GPU Performance
  const t4 = report.test4
  const dynClean = t4.dynamicChecks.every((d) => d.nonFinite === 0 && d.negative === 0 && d.reallocs === 0 && d.meanTransmittance < 0.85)
  check(
    dynClean && t4.reallocs === 0,
    `Test 4 dynamic resolution (0.50x/0.75x/1.00x): reallocs=${t4.reallocs}, vram=${(t4.vramBytes / (1024 * 1024)).toFixed(2)} MB`,
  )
  check(
    t4.probeAllFinite && t4.compositeDiff < 1e-4,
    `Test 4 VOLUMETRIC_CLOUDS_WGSL composite probe: diff=${t4.compositeDiff.toExponential(2)}, finite=${t4.probeAllFinite}`,
  )
  if (report.canTime && t4.gpuTiming && t4.gpuTiming.totalMedianMs !== null) {
    const gt = t4.gpuTiming
    check(
      gt.samples >= 16 && gt.totalMedianMs > 0 && gt.totalMedianMs < 5.0,
      `Test 4 GPU timing @ 1280x720 (timestamp-query, n=${gt.samples}): trace=${gt.traceMedianMs.toFixed(3)} ms, reproject=${gt.reprojectMedianMs.toFixed(3)} ms, total=${gt.totalMedianMs.toFixed(3)} ms (mean ${gt.totalMeanMs.toFixed(3)} ms)`,
    )
  } else {
    console.log('  (timestamp-query not available on this adapter)')
  }
} catch (e) {
  failures.push(String(e))
}

await finish('volumetric-clouds')
