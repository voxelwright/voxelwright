// Scripted run in Google Chrome, headless by default so no window takes focus.
// --headed shows the window; the README perf numbers were taken headed.
// Usage: node scripts/measure.mjs [url] [--shot=path] [--perf] [--gpu] [--unload] [--headed]
// --gpu adds ?gpu=1 and reports GPU time per frame (submit to queue done) and
// the summed WebGPU timestamp-query pass durations. Chrome rounds timestamps to 100 us unless WebGPU developer features
// are on, so --gpu launches with --enable-webgpu-developer-features.
import { chromium } from 'playwright'

const args = process.argv.slice(2)
let url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
if (args.includes('--gpu')) url += (url.includes('?') ? '&' : '?') + 'gpu=1'
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7)
const flag = (name) => args.includes(`--${name}`)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !flag('headed'),
  args: [
    '--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--window-position=0,0',
    ...(args.includes('--gpu') ? ['--enable-webgpu-developer-features'] : []),
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url)
const readiness = await page.evaluate(() => window.village.ready())
await page.waitForTimeout(2000)

const result = { url, readiness }
result.loaded = await page.evaluate(() => {
  const { objects, ...rest } = window.village.snapshot()
  return rest
})

if (flag('perf')) {
  result.perf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const deltas = []
        const timing = window.village.timing()
        const from = { gpu: timing?.gpu.length ?? 0, passSum: timing?.passSum.length ?? 0, cpu: timing?.cpu.length ?? 0 }
        let last = performance.now()
        const end = last + 6000
        const step = (now) => {
          deltas.push(now - last)
          last = now
          if (now < end) requestAnimationFrame(step)
          else {
            deltas.sort((a, b) => a - b)
            const pick = (list, p) => list[Math.floor(p * (list.length - 1))]
            const q = (p) => pick(deltas, p)
            const stats = (list) => {
              const sorted = [...list].sort((a, b) => a - b)
              return sorted.length ? { samples: sorted.length, p50ms: +pick(sorted, 0.5).toFixed(3), p95ms: +pick(sorted, 0.95).toFixed(3) } : null
            }
            const gpu = timing?.gpu.slice(from.gpu) ?? []
            const passSum = timing?.passSum.slice(from.passSum) ?? []
            const s = window.village.snapshot()
            resolve({
              gpu: stats(gpu),
              timestampPassSum: stats(passSum),
              // Timestamps quantized to 100 us would all land on multiples of 0.1 ms.
              timestampsQuantized: passSum.length ? passSum.every((ms) => Math.abs(ms * 10 - Math.round(ms * 10)) < 1e-6) : null,
              cpuFrame: stats(timing?.cpu.slice(from.cpu) ?? []),
              quality: s.quality,
              features: s.features,
              tierReason: s.tierReason,
              frames: deltas.length,
              p50ms: +q(0.5).toFixed(2),
              p95ms: +q(0.95).toFixed(2),
              fps: +(1000 / q(0.5)).toFixed(1),
              drawCalls: s.render.drawCalls,
              triangles: s.render.triangles,
              backend: s.backend,
              canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height],
            })
          }
        }
        requestAnimationFrame(step)
      }),
  )
}

if (shot) await page.screenshot({ path: shot })

if (flag('unload')) {
  const strip = (s) => ({ plugins: s.plugins.active.length, sceneObjects: s.sceneObjects, objects: s.objects.join('|'), frameHooks: s.frameHooks, geometries: s.geometries, textures: s.textures, fog: s.fog, drawPasses: s.drawPasses })
  const frame = () => page.waitForTimeout(300)
  const proof = {}
  for (const name of ['fridge', 'postfx', 'room']) {
    const before = strip(await page.evaluate(() => window.village.snapshot()))
    await page.evaluate((n) => window.village.unload(n), name)
    await frame()
    const unloaded = strip(await page.evaluate(() => window.village.snapshot()))
    await page.evaluate((n) => window.village.load(n), name)
    await frame()
    const reloaded = strip(await page.evaluate(() => window.village.snapshot()))
    const { objects: _a, ...b } = before
    const { objects: _b, ...u } = unloaded
    const { objects: _c, ...r } = reloaded
    proof[name] = { before: b, unloaded: u, reloaded: r, sameObjectsAfterReload: before.objects === reloaded.objects }
  }
  // Unload every scene plugin and compare with a renderer-only baseline.
  const loaded = await page.evaluate(() => window.village.snapshot().plugins.active.filter((n) => n !== 'renderer'))
  for (const n of loaded) await page.evaluate((x) => window.village.unload(x), n)
  await frame()
  const { objects, ...empty } = await page.evaluate(() => window.village.snapshot())
  proof.rendererOnly = { ...empty, objects }
  result.unload = proof
}

result.errors = errors
console.log(JSON.stringify(result, null, 2))
await browser.close()
if (!readiness.ok) process.exitCode = 1
