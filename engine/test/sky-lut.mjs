// Real headless Chrome WebGPU verification for engine/page/sky-lut.ts (#165).
//
// Runs createSkyLut(device) on the real GPU across 4 solar regimes (noon, sunset,
// civil/nautical twilight, night) plus SPACE altitude, verifying:
//   - Physical sky scattering (Rayleigh blue zenith, Mie sun aureole, warm sunset horizon,
//     cool sunset zenith, darker anti-solar horizon, Ozone blue twilight, graceful night drop)
//   - Transmittance LUT zenith > horizon and zero NaN/Inf across every LUT texel
//   - Aerial Perspective monotonic in-scattering increase & transmittance decrease across slices 0..31
//   - L2 Spherical Harmonics sky IBL irradiance ordering (noon > sunset > twilight > night)
//   - Reusable SKY_LUT_WGSL compilation & sampling helpers on the GPU
//   - Dirty-tracking cache skips redundant passes and reports compute update timing (ms)
//
//   node engine/test/sky-lut.mjs [--headed]
import { start } from './kit.mjs'

const { url, page: open, check, failures, finish } = await start()

try {
  const page = await open({ size: [640, 360], dpr: 1 })
  // Minimal same-origin harness page so we import /page/sky-lut.ts and /probe/gpu.ts directly
  // without booting the full city scene.
  await page.route(`${url}/sky-lut-test.html`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>sky-lut test</title></head><body></body></html>',
  }))
  await page.goto(`${url}/sky-lut-test.html`)

  const result = await page.evaluate(async () => {
    const { openGpu, shader } = await import('/probe/gpu.ts')
    const { createSkyLut, DEFAULT_ATMOSPHERE, SKY_LUT_DIMS, SKY_LUT_WGSL, skyLutBindings } = await import('/page/sky-lut.ts')

    const gpu = await openGpu()
    const { device } = gpu
    const sky = await createSkyLut(device)

    // IEEE 754 binary16 -> float32 decoder for reading back rgba16float LUT textures.
    const f16ToF32 = (h) => {
      const s = (h & 0x8000) ? -1 : 1
      const e = (h >> 10) & 0x1f
      const f = h & 0x03ff
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024)
      if (e === 31) return f === 0 ? s * Infinity : NaN
      return s * Math.pow(2, e - 15) * (1 + f / 1024)
    }

    async function readTexture2D(tex, width, height) {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256
      const buf = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow }, [width, height, 1])
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      const stride = bytesPerRow / 2
      const out = new Float32Array(width * height * 4)
      let nonFinite = 0, negative = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const src = y * stride + x * 4
          const dst = (y * width + x) * 4
          for (let c = 0; c < 4; c++) {
            const v = f16ToF32(u16[src + c])
            out[dst + c] = v
            if (!Number.isFinite(v)) nonFinite++
            else if (v < -1e-6) negative++
          }
        }
      }
      return { data: out, nonFinite, negative }
    }

    async function readTexture3D(tex, w, h, d) {
      const bytesPerRow = Math.ceil((w * 8) / 256) * 256
      const buf = device.createBuffer({ size: bytesPerRow * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow, rowsPerImage: h }, [w, h, d])
      device.queue.submit([enc.finish()])
      await buf.mapAsync(GPUMapMode.READ)
      const u16 = new Uint16Array(buf.getMappedRange().slice(0))
      buf.unmap()
      buf.destroy()
      const rowStride = bytesPerRow / 2
      const sliceStride = rowStride * h
      const out = new Float32Array(w * h * d * 4)
      let nonFinite = 0, negative = 0
      for (let z = 0; z < d; z++) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const src = z * sliceStride + y * rowStride + x * 4
            const dst = ((z * h + y) * w + x) * 4
            for (let c = 0; c < 4; c++) {
              const v = f16ToF32(u16[src + c])
              out[dst + c] = v
              if (!Number.isFinite(v)) nonFinite++
              else if (v < -1e-6) negative++
            }
          }
        }
      }
      return { data: out, nonFinite, negative }
    }

    async function readBufferF32(buf, count) {
      const staging = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      enc.copyBufferToBuffer(buf, 0, staging, 0, count * 4)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const out = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      staging.destroy()
      return out
    }

    // Compile and bind a probe compute shader that directly exercises SKY_LUT_WGSL:
    //   sampleSkyView(rd, sunDir), sampleAerialPerspective(uv, distKm), evalSkyIrradianceSH(normal).
    const probeWgsl = /* wgsl */ `
${skyLutBindings(0, 0)}
struct ProbeReq {
  sunDir: vec4f,
  skyDirs: array<vec4f, 6>,
  normals: array<vec4f, 4>,
  aerialDists: array<vec4f, 4>,
}
@group(1) @binding(0) var<uniform> req: ProbeReq;
@group(1) @binding(1) var<storage, read_write> probeOut: array<vec4f, 14>;
${SKY_LUT_WGSL}

@compute @workgroup_size(1, 1, 1)
fn main() {
  let sd = req.sunDir.xyz;
  for (var i = 0u; i < 6u; i++) {
    probeOut[i] = vec4f(sampleSkyView(req.skyDirs[i].xyz, sd), 1.0);
  }
  for (var i = 0u; i < 4u; i++) {
    probeOut[6u + i] = vec4f(evalSkyIrradianceSH(req.normals[i].xyz), 1.0);
  }
  for (var i = 0u; i < 4u; i++) {
    probeOut[10u + i] = sampleAerialPerspective(vec2f(0.5, 0.5), req.aerialDists[i].x);
  }
}
`
    const probeMod = await shader(device, 'sky-lut-probe', probeWgsl)
    const probePipe = await device.createComputePipelineAsync({ label: 'sky-lut-probe', layout: 'auto', compute: { module: probeMod, entryPoint: 'main' } })
    const probeReqBuf = device.createBuffer({ size: (1 + 6 + 4 + 4) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const probeOutBuf = device.createBuffer({ size: 14 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const probeBg0 = device.createBindGroup({
      layout: probePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sky.skyView },
        { binding: 1, resource: sky.skyViewSampler },
        { binding: 2, resource: sky.aerialView },
        { binding: 3, resource: sky.clampSampler },
        { binding: 4, resource: { buffer: sky.shBuffer } },
      ],
    })
    const probeBg1 = device.createBindGroup({
      layout: probePipe.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: probeReqBuf } },
        { binding: 1, resource: { buffer: probeOutBuf } },
      ],
    })

    const unit = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l] }
    const sunAtDeg = (deg) => { const r = (deg * Math.PI) / 180; return [Math.cos(r), Math.sin(r), 0] }
    const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]

    async function runRegime(params, dirs) {
      const enc = device.createCommandEncoder()
      sky.update(enc, params)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()

      const reqData = new Float32Array((1 + 6 + 4 + 4) * 4)
      const sd = unit(params.sunDir[0], params.sunDir[1], params.sunDir[2])
      reqData.set([sd[0], sd[1], sd[2], 0], 0)
      for (let i = 0; i < 6; i++) {
        const d = dirs[i] ?? [0, 1, 0]
        reqData.set([d[0], d[1], d[2], 0], (1 + i) * 4)
      }
      // Normals: up (+Y), sun-facing (+X), anti-solar (-X), down (-Y)
      const normals = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0]]
      for (let i = 0; i < 4; i++) reqData.set([normals[i][0], normals[i][1], normals[i][2], 0], (7 + i) * 4)
      // Aerial sample distances (km)
      const dists = [0.5, 4.0, 16.0, 32.0]
      for (let i = 0; i < 4; i++) reqData.set([dists[i], 0, 0, 0], (11 + i) * 4)

      device.queue.writeBuffer(probeReqBuf, 0, reqData)
      const penc = device.createCommandEncoder()
      const pass = penc.beginComputePass()
      pass.setPipeline(probePipe)
      pass.setBindGroup(0, probeBg0)
      pass.setBindGroup(1, probeBg1)
      pass.dispatchWorkgroups(1, 1, 1)
      pass.end()
      device.queue.submit([penc.finish()])
      await device.queue.onSubmittedWorkDone()

      const out = await readBufferF32(probeOutBuf, 14 * 4)
      const vec = (idx) => [out[idx * 4], out[idx * 4 + 1], out[idx * 4 + 2], out[idx * 4 + 3]]
      const skySamples = Array.from({ length: 6 }, (_, i) => vec(i).slice(0, 3))
      const shIrradiance = Array.from({ length: 4 }, (_, i) => vec(6 + i).slice(0, 3))
      const aerialSamples = Array.from({ length: 4 }, (_, i) => vec(10 + i))
      const shCoeffs = Array.from(await readBufferF32(sky.shBuffer, 9 * 4))
      const shNonFinite = shCoeffs.filter((v) => !Number.isFinite(v)).length
      const skyTex = await readTexture2D(sky.skyViewTexture, SKY_LUT_DIMS.skyViewWidth, SKY_LUT_DIMS.skyViewHeight)
      return { skySamples, shIrradiance, aerialSamples, shNonFinite, skyNonFinite: skyTex.nonFinite, skyNegative: skyTex.negative, skyData: skyTex.data }
    }

    // 1. NOON (~60 deg elevation)
    const noonSun = sunAtDeg(60)
    const noonAureole = sunAtDeg(58) // 2 deg from sun
    const noonOppositeElev = [-noonAureole[0], noonAureole[1], 0] // same 58 deg elevation, opposite azimuth
    const noon = await runRegime(
      {
        ...DEFAULT_ATMOSPHERE,
        sunDir: noonSun,
        cameraForward: [1, 0.05, 0],
        cameraRight: [0, 0, 1],
        cameraUp: [0, 1, 0],
      },
      [
        [0, 1, 0], // 0: zenith
        noonAureole, // 1: near-sun aureole
        unit(1, 0.06, 0), // 2: solar horizon
        unit(-1, 0.06, 0), // 3: anti-solar horizon
        noonOppositeElev, // 4: opposite sky at same elevation as aureole
        [0, -1, 0], // 5: nadir
      ],
    )

    // Verify Transmittance LUT (zenith vs horizon) and Multi-Scatter LUT finite/non-negative
    const transTex = await readTexture2D(sky.transmittanceTexture, SKY_LUT_DIMS.transmittanceWidth, SKY_LUT_DIMS.transmittanceHeight)
    const msTex = await readTexture2D(sky.multiScatterTexture, SKY_LUT_DIMS.multiScatterSize, SKY_LUT_DIMS.multiScatterSize)
    // At ground row y = 0: x = 0 is straight up (cosZenith = 1), x = W-1 is horizon (cosZenith = 0)
    const transZenith = [transTex.data[0], transTex.data[1], transTex.data[2]]
    const hOff = (SKY_LUT_DIMS.transmittanceWidth - 1) * 4
    const transHorizon = [transTex.data[hOff], transTex.data[hOff + 1], transTex.data[hOff + 2]]

    // Verify Aerial Perspective 3D LUT monotonicity across slices 0..31 at center column (16, 16)
    const aerialTex = await readTexture3D(sky.aerialTexture, SKY_LUT_DIMS.aerialSize, SKY_LUT_DIMS.aerialSize, SKY_LUT_DIMS.aerialSize)
    const aerialSlices = []
    for (let z = 0; z < SKY_LUT_DIMS.aerialSize; z++) {
      const idx = ((z * SKY_LUT_DIMS.aerialSize + 16) * SKY_LUT_DIMS.aerialSize + 16) * 4
      aerialSlices.push([aerialTex.data[idx], aerialTex.data[idx + 1], aerialTex.data[idx + 2], aerialTex.data[idx + 3]])
    }
    let aerialScatterMonotonic = true
    let aerialTransMonotonic = true
    for (let z = 1; z < aerialSlices.length; z++) {
      const prevLum = lum(aerialSlices[z - 1])
      const currLum = lum(aerialSlices[z])
      if (currLum < prevLum - 1e-4) aerialScatterMonotonic = false
      if (aerialSlices[z][3] > aerialSlices[z - 1][3] + 1e-4) aerialTransMonotonic = false
    }

    // 2. GOLDEN HOUR / SUNSET (2 deg elevation)
    const sunsetSun = sunAtDeg(2)
    const sunset = await runRegime(
      { ...DEFAULT_ATMOSPHERE, sunDir: sunsetSun },
      [
        [0, 1, 0], // 0: zenith
        unit(Math.cos(0.05), Math.sin(0.05), 0), // 1: solar horizon (~3 deg)
        unit(-Math.cos(0.05), Math.sin(0.05), 0), // 2: anti-solar horizon (~3 deg)
        unit(0, Math.sin(0.15), Math.cos(0.15)), // 3: cross-sun low sky
        unit(0.5, 0.5, 0), // 4: mid solar sky
        [0, -1, 0], // 5: nadir
      ],
    )

    // 3. CIVIL / NAUTICAL TWILIGHT (-4 deg elevation)
    const twilightSun = sunAtDeg(-4)
    const twilight = await runRegime(
      { ...DEFAULT_ATMOSPHERE, sunDir: twilightSun },
      [
        [0, 1, 0], // 0: zenith (ozone blue)
        unit(Math.cos(0.08), Math.sin(0.08), 0), // 1: solar horizon
        unit(-Math.cos(0.08), Math.sin(0.08), 0), // 2: anti-solar horizon
        unit(0, 0.707, 0.707), // 3: mid sky
        unit(0.3, 0.9, 0), // 4: high sky
        [0, -1, 0], // 5: nadir
      ],
    )
    // Check twilight zenith-band smoothness across neighboring rows in Sky-View LUT
    let twilightMaxJump = 0
    for (let y = Math.floor(SKY_LUT_DIMS.skyViewHeight * 0.55); y < SKY_LUT_DIMS.skyViewHeight - 2; y++) {
      const i0 = (y * SKY_LUT_DIMS.skyViewWidth + 96) * 4
      const i1 = ((y + 1) * SKY_LUT_DIMS.skyViewWidth + 96) * 4
      const l0 = lum([twilight.skyData[i0], twilight.skyData[i0 + 1], twilight.skyData[i0 + 2]])
      const l1 = lum([twilight.skyData[i1], twilight.skyData[i1 + 1], twilight.skyData[i1 + 2]])
      twilightMaxJump = Math.max(twilightMaxJump, Math.abs(l1 - l0))
    }

    // 4. NIGHT (-30 deg elevation)
    const nightSun = sunAtDeg(-30)
    const night = await runRegime(
      { ...DEFAULT_ATMOSPHERE, sunDir: nightSun },
      [
        [0, 1, 0],
        unit(1, 0.05, 0),
        unit(-1, 0.05, 0),
        unit(0, 0.5, 1),
        unit(0.5, 0.5, 0),
        [0, -1, 0],
      ],
    )

    // 5. SPACE ALTITUDE (250 km above sea level — above 100 km atmosphere top)
    const space = await runRegime(
      { ...DEFAULT_ATMOSPHERE, sunDir: sunAtDeg(25), cameraAltitudeKm: 250.0 },
      [
        [0, 1, 0], // 0: deep space zenith (dark)
        unit(1, -0.35, 0), // 1: sunlit planetary limb / atmosphere
        [0, -1, 0], // 2: nadir toward Earth
        unit(1, 0, 0),
        unit(-1, 0, 0),
        unit(0, 0.5, 1),
      ],
    )

    // 6. DIRTY-TRACKING & CACHING + TIMING BENCHMARK
    const cacheBase = {
      ...DEFAULT_ATMOSPHERE,
      sunDir: noonSun,
      cameraAltitudeKm: 0.05,
      haze: 1.2,
    }
    // First update with new haze triggers all 5 passes
    {
      const enc = device.createCommandEncoder()
      sky.update(enc, cacheBase)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const sAfterFirst = sky.stats()

    // Second update with IDENTICAL params must perform 0 dispatches across all 5 passes
    {
      const enc = device.createCommandEncoder()
      sky.update(enc, cacheBase)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const sAfterIdentical = sky.stats()

    // Third update rotating camera only: ONLY aerial dispatches (0 trans/ms/sky/sh)
    {
      const enc = device.createCommandEncoder()
      sky.update(enc, { ...cacheBase, cameraForward: [0.6, 0.0, -0.8], cameraRight: [0.8, 0.0, 0.6] })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const sAfterCamTurn = sky.stats()

    // Fourth update moving sun only: sky + sh + aerial dispatch (0 trans/ms)
    {
      const enc = device.createCommandEncoder()
      sky.update(enc, { ...cacheBase, cameraForward: [0.6, 0.0, -0.8], cameraRight: [0.8, 0.0, 0.6], sunDir: sunAtDeg(45) })
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
    }
    const sAfterSunMove = sky.stats()

    // Measure GPU wall time for (a) full rebuild (invalidate + update), (b) sun-only update, (c) camera-only aerial update
    const timeBatch = async (iters, fn) => {
      // Warmup
      for (let i = 0; i < 2; i++) {
        const enc = device.createCommandEncoder()
        fn(enc, i)
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()
      const t0 = performance.now()
      for (let i = 0; i < iters; i++) {
        const enc = device.createCommandEncoder()
        fn(enc, i)
        device.queue.submit([enc.finish()])
      }
      await device.queue.onSubmittedWorkDone()
      return (performance.now() - t0) / iters
    }

    const fullRebuildMs = await timeBatch(10, (enc) => {
      sky.invalidate()
      sky.update(enc, cacheBase)
    })
    const sunUpdateMs = await timeBatch(20, (enc, i) => {
      sky.update(enc, { ...cacheBase, sunDir: sunAtDeg(20 + (i % 2) * 5) })
    })
    const aerialOnlyMs = await timeBatch(40, (enc, i) => {
      const a = i * 0.1
      sky.update(enc, { ...cacheBase, cameraForward: [Math.sin(a), 0, -Math.cos(a)], cameraRight: [Math.cos(a), 0, Math.sin(a)] })
    })
    const cachedNoopMs = await timeBatch(40, (enc) => {
      sky.update(enc, cacheBase)
    })

    probeReqBuf.destroy()
    probeOutBuf.destroy()
    sky.destroy()

    return {
      faults: gpu.faults,
      transmittance: {
        zenith: transZenith,
        horizon: transHorizon,
        nonFinite: transTex.nonFinite,
        negative: transTex.negative,
      },
      multiScatter: {
        nonFinite: msTex.nonFinite,
        negative: msTex.negative,
      },
      aerial: {
        nonFinite: aerialTex.nonFinite,
        negative: aerialTex.negative,
        slice0: aerialSlices[0],
        slice15: aerialSlices[15],
        slice31: aerialSlices[31],
        scatterMonotonic: aerialScatterMonotonic,
        transMonotonic: aerialTransMonotonic,
        probeSamples: noon.aerialSamples,
      },
      noon: {
        zenith: noon.skySamples[0],
        aureole: noon.skySamples[1],
        oppositeElev: noon.skySamples[4],
        shUp: noon.shIrradiance[0],
        shSun: noon.shIrradiance[1],
        shNonFinite: noon.shNonFinite,
        skyNonFinite: noon.skyNonFinite,
        skyNegative: noon.skyNegative,
      },
      sunset: {
        zenith: sunset.skySamples[0],
        solarHorizon: sunset.skySamples[1],
        antiSolarHorizon: sunset.skySamples[2],
        shUp: sunset.shIrradiance[0],
        shNonFinite: sunset.shNonFinite,
        skyNonFinite: sunset.skyNonFinite,
        skyNegative: sunset.skyNegative,
      },
      twilight: {
        zenith: twilight.skySamples[0],
        solarHorizon: twilight.skySamples[1],
        shUp: twilight.shIrradiance[0],
        maxJump: twilightMaxJump,
        shNonFinite: twilight.shNonFinite,
        skyNonFinite: twilight.skyNonFinite,
        skyNegative: twilight.skyNegative,
      },
      night: {
        zenith: night.skySamples[0],
        horizon: night.skySamples[1],
        shUp: night.shIrradiance[0],
        shNonFinite: night.shNonFinite,
        skyNonFinite: night.skyNonFinite,
        skyNegative: night.skyNegative,
      },
      space: {
        zenith: space.skySamples[0],
        nadir: space.skySamples[2],
        skyNonFinite: space.skyNonFinite,
        skyNegative: space.skyNegative,
      },
      cache: {
        identicalDelta: {
          trans: sAfterIdentical.transmittanceDispatches - sAfterFirst.transmittanceDispatches,
          ms: sAfterIdentical.multiScatterDispatches - sAfterFirst.multiScatterDispatches,
          sky: sAfterIdentical.skyViewDispatches - sAfterFirst.skyViewDispatches,
          sh: sAfterIdentical.shDispatches - sAfterFirst.shDispatches,
          aerial: sAfterIdentical.aerialDispatches - sAfterFirst.aerialDispatches,
        },
        camTurnDelta: {
          trans: sAfterCamTurn.transmittanceDispatches - sAfterIdentical.transmittanceDispatches,
          ms: sAfterCamTurn.multiScatterDispatches - sAfterIdentical.multiScatterDispatches,
          sky: sAfterCamTurn.skyViewDispatches - sAfterIdentical.skyViewDispatches,
          sh: sAfterCamTurn.shDispatches - sAfterIdentical.shDispatches,
          aerial: sAfterCamTurn.aerialDispatches - sAfterIdentical.aerialDispatches,
        },
        sunMoveDelta: {
          trans: sAfterSunMove.transmittanceDispatches - sAfterCamTurn.transmittanceDispatches,
          ms: sAfterSunMove.multiScatterDispatches - sAfterCamTurn.multiScatterDispatches,
          sky: sAfterSunMove.skyViewDispatches - sAfterCamTurn.skyViewDispatches,
          sh: sAfterSunMove.shDispatches - sAfterCamTurn.shDispatches,
          aerial: sAfterSunMove.aerialDispatches - sAfterCamTurn.aerialDispatches,
        },
      },
      timingMs: {
        fullRebuild: fullRebuildMs,
        sunUpdate: sunUpdateMs,
        aerialOnly: aerialOnlyMs,
        cachedNoop: cachedNoopMs,
      },
    }
  })

  const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  const fmt = (v) => `[${v.map((x) => x.toFixed(4)).join(', ')}]`

  check(result.faults.length === 0, `no WebGPU uncaptured errors (${result.faults.join('; ') || 'clean'})`)

  // 1. Noon checks
  check(
    result.transmittance.nonFinite === 0 && result.transmittance.negative === 0 && result.multiScatter.nonFinite === 0 && result.multiScatter.negative === 0,
    `Transmittance & Multi-Scatter LUTs have zero NaN/Inf/negative values`,
  )
  check(
    result.transmittance.zenith[0] > result.transmittance.horizon[0]
      && result.transmittance.zenith[1] > result.transmittance.horizon[1]
      && result.transmittance.zenith[2] > result.transmittance.horizon[2],
    `Transmittance zenith ${fmt(result.transmittance.zenith)} > horizon ${fmt(result.transmittance.horizon)}`,
  )
  check(
    result.noon.skyNonFinite === 0 && result.noon.skyNegative === 0 && result.noon.shNonFinite === 0,
    `Noon Sky-View LUT & SH buffer have zero NaN/Inf/negative values`,
  )
  check(
    result.noon.zenith[2] > result.noon.zenith[0] * 2.0 && result.noon.zenith[2] > result.noon.zenith[1],
    `Noon zenith is Rayleigh blue (B > 2*R): ${fmt(result.noon.zenith)}`,
  )
  check(
    lum(result.noon.aureole) > lum(result.noon.zenith) * 1.8
      && result.noon.aureole[0] > result.noon.zenith[0] * 2.5
      && lum(result.noon.aureole) > lum(result.noon.oppositeElev) * 1.8,
    `Noon sun aureole ${fmt(result.noon.aureole)} is >1.8x brighter than zenith ${fmt(result.noon.zenith)} and opposite 58 deg sky ${fmt(result.noon.oppositeElev)}`,
  )

  // 2. Sunset checks
  check(
    result.sunset.skyNonFinite === 0 && result.sunset.skyNegative === 0 && result.sunset.shNonFinite === 0,
    `Sunset Sky-View LUT & SH buffer have zero NaN/Inf/negative values`,
  )
  check(
    result.sunset.solarHorizon[0] > result.sunset.solarHorizon[2] * 1.5,
    `Sunset solar horizon is warm orange/red (R > 1.5*B): ${fmt(result.sunset.solarHorizon)}`,
  )
  check(
    result.sunset.zenith[2] > result.sunset.zenith[0],
    `Sunset zenith stays cool blue (B > R): ${fmt(result.sunset.zenith)}`,
  )
  check(
    lum(result.sunset.antiSolarHorizon) < lum(result.sunset.solarHorizon) * 0.5,
    `Sunset anti-solar horizon ${fmt(result.sunset.antiSolarHorizon)} is darker than solar horizon ${fmt(result.sunset.solarHorizon)}`,
  )

  // 3. Twilight (-4 deg) checks
  check(
    result.twilight.skyNonFinite === 0 && result.twilight.skyNegative === 0 && result.twilight.shNonFinite === 0,
    `Twilight Sky-View LUT & SH buffer have zero NaN/Inf/negative values`,
  )
  check(
    result.twilight.zenith[2] > result.twilight.zenith[0] && result.twilight.zenith[2] > 1e-4 && result.twilight.maxJump < 0.1,
    `Twilight (-4 deg) ozone blue zenith is smooth and non-zero: ${fmt(result.twilight.zenith)} (max row step ${result.twilight.maxJump.toFixed(5)})`,
  )

  // 4. Night (-30 deg) checks
  check(
    result.night.skyNonFinite === 0 && result.night.skyNegative === 0 && result.night.shNonFinite === 0,
    `Night Sky-View LUT & SH buffer have zero NaN/Inf/negative values`,
  )
  check(
    lum(result.night.zenith) < 1e-3 && lum(result.night.horizon) < 1e-3 && result.night.zenith.every((v) => v >= 0),
    `Night (-30 deg) radiance drops gracefully toward zero: zenith ${fmt(result.night.zenith)}, horizon ${fmt(result.night.horizon)}`,
  )

  // 5. Space altitude check
  check(
    result.space.skyNonFinite === 0 && result.space.skyNegative === 0 && lum(result.space.zenith) < 1e-4 && lum(result.space.nadir) > 0.01,
    `SPACE altitude (250 km): dark space zenith ${fmt(result.space.zenith)}, sunlit Earth nadir ${fmt(result.space.nadir)}`,
  )

  // 6. Aerial Perspective monotonicity checks
  check(
    result.aerial.nonFinite === 0 && result.aerial.negative === 0,
    `Aerial Perspective 3D LUT has zero NaN/Inf/negative values`,
  )
  check(
    result.aerial.scatterMonotonic && lum(result.aerial.slice31) > lum(result.aerial.slice0),
    `Aerial Perspective in-scattering increases monotonically slice 0 -> 31: lum ${lum(result.aerial.slice0).toFixed(4)} -> ${lum(result.aerial.slice15).toFixed(4)} -> ${lum(result.aerial.slice31).toFixed(4)}`,
  )
  check(
    result.aerial.transMonotonic && result.aerial.slice0[3] > result.aerial.slice31[3] && result.aerial.slice31[3] < 0.9,
    `Aerial Perspective transmittance decreases monotonically slice 0 -> 31: T ${result.aerial.slice0[3].toFixed(4)} -> ${result.aerial.slice15[3].toFixed(4)} -> ${result.aerial.slice31[3].toFixed(4)}`,
  )
  const ap = result.aerial.probeSamples
  check(
    lum(ap[0]) < lum(ap[1]) && lum(ap[1]) < lum(ap[2]) && lum(ap[2]) < lum(ap[3])
      && ap[0][3] > ap[1][3] && ap[1][3] > ap[2][3] && ap[2][3] > ap[3][3],
    `SKY_LUT_WGSL sampleAerialPerspective(0.5..32 km): T ${ap.map((s) => s[3].toFixed(4)).join(' -> ')}`,
  )

  // 7. SH Irradiance checks
  const shNoon = lum(result.noon.shUp)
  const shSunset = lum(result.sunset.shUp)
  const shTwilight = lum(result.twilight.shUp)
  const shNight = lum(result.night.shUp)
  check(
    shNoon > shSunset && shSunset > shTwilight && shTwilight > shNight && shNight >= 0,
    `SH irradiance ordering noon (${shNoon.toFixed(4)}) > sunset (${shSunset.toFixed(4)}) > twilight (${shTwilight.toFixed(4)}) > night (${shNight.toFixed(5)})`,
  )

  // 8. Dirty-tracking & caching checks
  const id = result.cache.identicalDelta
  check(
    id.trans === 0 && id.ms === 0 && id.sky === 0 && id.sh === 0 && id.aerial === 0,
    `Dirty cache skips all 5 passes on identical update (deltas: trans=${id.trans}, ms=${id.ms}, sky=${id.sky}, sh=${id.sh}, aerial=${id.aerial})`,
  )
  const ct = result.cache.camTurnDelta
  check(
    ct.trans === 0 && ct.ms === 0 && ct.sky === 0 && ct.sh === 0 && ct.aerial === 1,
    `Camera turn updates Aerial Perspective only (deltas: trans=${ct.trans}, ms=${ct.ms}, sky=${ct.sky}, sh=${ct.sh}, aerial=${ct.aerial})`,
  )
  const sm = result.cache.sunMoveDelta
  check(
    sm.trans === 0 && sm.ms === 0 && sm.sky === 1 && sm.sh === 1 && sm.aerial === 1,
    `Sun move updates Sky-View + SH + Aerial only (deltas: trans=${sm.trans}, ms=${sm.ms}, sky=${sm.sky}, sh=${sm.sh}, aerial=${sm.aerial})`,
  )

  console.log(`  timing: full rebuild ${result.timingMs.fullRebuild.toFixed(3)} ms | sun update ${result.timingMs.sunUpdate.toFixed(3)} ms | aerial only ${result.timingMs.aerialOnly.toFixed(3)} ms | cached noop ${result.timingMs.cachedNoop.toFixed(3)} ms`)
} catch (e) {
  failures.push(String(e))
}

await finish('sky-lut')
