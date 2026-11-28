// CPU hierarchy against visible cells, then actual Metal/WebGPU output at a depth edge.
import assert from 'node:assert/strict'
import { SmokeGrid } from '../page/smoke-grid.ts'
import { start } from './kit.mjs'

const smoke = new SmokeGrid()
const interval = (o, d, max = Infinity) => smoke.rayInterval(o, d, max)
assert.equal(interval([0, 0, 0], [1, 0, 0]).visitedBricks, 0)
smoke.recenter(128, 128, 128, () => false)
smoke.inject(100, 100, 100, 1, 1)
smoke.inject(188, 100, 100, 1, 1)
smoke.step(0.01)
const bits = smoke.exportBitmask()
assert.equal(bits.byteLength, 520)
for (const [brick, leaf] of [[21, 42], [22, 43]]) {
  assert.ok(bits[brick >> 5] & (1 << (brick & 31)))
  assert.ok(bits[2 + brick * 2 + (leaf >> 5)] & (1 << (leaf & 31)))
}
const tight = interval([0, 100, 100], [1, 0, 0])
assert.deepEqual([tight.hit, tight.tEnter, tight.tExit], [true, 96, 192])
assert.equal(interval([256, 100, 100], [-1, 0, 0]).tEnter, 64)
assert.equal(interval([0, 100, 100], [1, 0, 0], 95).hit, false)
assert.equal(interval([0, 220, 100], [1, 0, 0]).visitedBricks, 0)
let seed = 19
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296
for (let i = 0; i < 128; i++) smoke.inject(random() * 256, random() * 256, random() * 256, 1, 2)
smoke.step(0.04, 1, 2)
smoke.recenter(120, 152, 144, () => false)
let rays = 0
for (const { x, y, z } of smoke.samplePuffs(32768)) {
  for (let j = 0; j < 8; j++) {
    const dir = [random() - 0.5, random() - 0.5, random() - 0.5]
    const origin = [x, y, z].map((p, a) => p - 500 * dir[a])
    const hit = interval(origin, dir)
    assert.ok(hit.hit && hit.tEnter <= 500 && hit.tExit >= 500)
    rays++
  }
}
smoke.clear()
assert.ok(smoke.exportBitmask().every(v => v === 0))
console.log(`Smoke: ${rays} dense-cell rays, no misses; plume [${tight.tEnter}, ${tight.tExit}], ${tight.visitedBricks} bricks.`)

const { url, page: open, check, failures, finish } = await start()
try {
  const page = await open({ size: [128, 64], dpr: 1 })
  await page.route('**/probe-masks', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  // Reference uses the same renderer and original shell interval, with skipping disabled.
  await page.route('**/page/cloud-reference.ts', async route => {
    const response = await route.fetch({ url: url + '/page/volumetric-clouds.ts' })
    const source = await response.text()
    const original = 'let occupied = cloudOccupiedInterval(rd, interval);'
    assert.ok(source.includes(original))
    // A separate probe frame writes the fraction excluded by the actual interval.
    const probe = `
      if (u.weather.z == 0.5) {
        let bounds = cloudOccupiedInterval(rd, interval);
        let skipped = 1.0 - clamp((bounds.y-bounds.x)/span, 0.0, 1.0);
        textureStore(traceOut, vec2i(coord), vec4f(skipped, 1.0, 0.0, 1.0));
        textureStore(distOut, vec2i(coord), vec4f(tStart));
        return;
      }
      let occupied = interval;`
    await route.fulfill({ response, body: source.replace(original, probe) })
  })
  await page.goto(url + '/probe-masks')
  const result = await page.evaluate(async () => {
    const { openGpu, camera, depthFor } = await import('/probe/gpu.ts')
    const { createFroxelFog } = await import('/page/froxel-fog.ts')
    const { createVolumetricClouds } = await import('/page/volumetric-clouds.ts')
    const reference = await import('/page/cloud-reference.ts')
    const { device, faults } = await openGpu()
    device.pushErrorScope('validation')
    const fog = await createFroxelFog(device, [2, 1, 40])
    const depth = depthFor(device, [64, 1])
    const depthView = depth.createView()
    const target = device.createTexture({
      size: [64, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var volume: texture_storage_3d<rgba16float, write>;
      @compute @workgroup_size(1) fn fill(@builtin(global_invocation_id) p: vec3u) {
        textureStore(volume, vec3i(p), vec4f(f32(p.x),0,0,1));
      }
      @vertex fn vs(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
        let p = vec2f(f32((i<<1u)&2u), f32(i&2u));
        return vec4f(p*2.0-1.0,0.99,1.0);
      }` })
    const fill = device.createComputePipeline({layout: 'auto', compute: {module, entryPoint: 'fill'}})
    const building = device.createRenderPipeline({
      layout: 'auto', vertex: {module, entryPoint: 'vs'},
      depthStencil: {format: depth.format, depthWriteEnabled: true, depthCompare: 'always'},
    })
    const enc = device.createCommandEncoder()
    fog.update(enc, {view: camera([0, 0, 0], [0, 0, 1], 60), aspect: 1, depthTex: depth})
    const fillBind = device.createBindGroup({
      layout: fill.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: fog.integratedView }],
    })
    function writeFogStep(encoder) {
      const pass = encoder.beginComputePass()
      pass.setPipeline(fill)
      pass.setBindGroup(0, fillBind)
      pass.dispatchWorkgroups(2, 1, 40)
      pass.end()
    }
    writeFogStep(enc)
    device.queue.submit([enc.finish()])

    async function readTexture(tex, width, height, bytesPerPixel) {
      const row = Math.ceil(width * bytesPerPixel / 256) * 256
      const buffer = device.createBuffer({size: row*height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ})
      const enc = device.createCommandEncoder()
      enc.copyTextureToBuffer({texture: tex}, {buffer, bytesPerRow: row}, [width, height])
      device.queue.submit([enc.finish()])
      await buffer.mapAsync(GPUMapMode.READ)
      const bytes = buffer.getMappedRange().slice(0)
      buffer.destroy()
      return bytes
    }
    async function edgeFrame(buildingWidth) {
      const enc = device.createCommandEncoder()
      const d = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
        view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      } })
      d.setPipeline(building)
      d.setScissorRect(0, 0, buildingWidth, 1)
      d.draw(3)
      d.end()
      enc.beginRenderPass({ colorAttachments: [{view: target.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store'}] }).end()
      fog.apply(enc, {target: target.createView(), format: target.format, depthTex: depth})
      device.queue.submit([enc.finish()])
      return new Uint8Array(await readTexture(target, 64, 1, 4))
    }
    const baseline = await edgeFrame(64)
    const edge = await edgeFrame(32)
    const restored = await edgeFrame(64)
    // With continuous depth, only the light-gradient path can mark this column.
    fog.beginLights()
    fog.addPoint(0, 0, 10, 1, 1, 1, 100)
    const lightEnc = device.createCommandEncoder()
    fog.update(lightEnc, {view: camera([0, 0, 0], [0, 0, 1], 60), aspect: 1})
    writeFogStep(lightEnc)
    device.queue.submit([lightEnc.finish()])
    const lightBoundary = (await edgeFrame(64))[124]
    fog.destroy()
    depth.destroy()
    target.destroy()
    const renderSize = [128, 64]
    const clouds = await createVolumetricClouds(device, renderSize)
    const control = await reference.createVolumetricClouds(device, renderSize)
    let maxError = 0, cloudy = 0
    for (const [coverage, altitude, pitch] of [[0, 0, 0.6], [0.65, 0.05, 0.6], [0.78, 2.1, 0], [0.78, 6, -0.6]]) {
      const f = Math.sqrt(1-pitch*pitch)
      const params = {
        renderSize, coverage, cameraPosKm: [29.99, altitude, -30.01], cameraForward: [0, pitch, -f],
        cameraUp: [0, f, pitch], cameraRight: [1, 0, 0], tanHalfFovY: 0.6, time: 1, reset: true,
      }
      const enc = device.createCommandEncoder()
      clouds.update(enc, params)
      control.update(enc, params)
      device.queue.submit([enc.finish()])
      const actual = new Float16Array(await readTexture(clouds.texture, 64, 32, 8))
      const expected = new Float16Array(await readTexture(control.texture, 64, 32, 8))
      for (let i = 0; i < actual.length; i++) {
        maxError = Math.max(maxError, Math.abs(expected[i]-actual[i]) / Math.max(1, Math.abs(expected[i])))
        if ((i & 3) === 3 && actual[i] < 0.95) cloudy++
      }
    }
    const probeEnc = device.createCommandEncoder()
    control.update(probeEnc, {
      renderSize, coverage: 0.35, cloudType: 0.5, cameraForward: [0, 0.6, -0.8],
      cameraUp: [0, 0.8, 0.6], cameraRight: [1, 0, 0], tanHalfFovY: 0.6, reset: true,
    })
    device.queue.submit([probeEnc.finish()])
    const fractions = new Float16Array(await readTexture(control.texture, 64, 32, 8))
    let skipped = 0, shellRays = 0
    for (let i = 0; i < fractions.length; i += 4) {
      skipped += fractions[i]
      shellRays += fractions[i+1]
    }
    const skippedFraction = skipped / shellRays
    clouds.destroy()
    control.destroy()
    const validation = await device.popErrorScope()
    return {before: baseline[124], after: edge[124], lightBoundary, sky: edge[128], restored: restored[124],
      maxError, cloudy, skippedFraction, errors: [...faults, ...(validation ? [validation.message] : [])]}
  })
  check(result.errors.length === 0, 'WebGPU validation: ' + (result.errors.join(', ') || 'clean'))
  check(result.before > 100 && result.after <= 1 && result.sky >= 254 && result.restored === result.before,
    `Foreground red bleed ${result.before} -> ${result.after}/255, sky ${result.sky}/255, uniform-depth rerender ${result.restored}/255`)
  check(result.lightBoundary < result.before / 2, `Light-only edge leakage ${result.before} -> ${result.lightBoundary}/255`)
  check(result.skippedFraction > 0.15, `Cloud interval excluded ${(result.skippedFraction*100).toFixed(1)}% of shell length on average`)
  check(result.cloudy > 100 && result.maxError < 0.003,
    `Cloud skip versus full shell: ${result.cloudy} cloudy pixels, max normalized channel error ${result.maxError}`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
await finish('volumetric-bitmasks')
