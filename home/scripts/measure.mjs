// Scripted run in a real, headed Google Chrome.
// Usage: node scripts/measure.mjs [url] [--shot=path] [--perf] [--unload]
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5181/'
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7)
const flag = (name) => args.includes(`--${name}`)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-position=0,0'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url)
await page.evaluate(() => window.village.ready())
await page.waitForTimeout(2000)

const result = { url }
result.loaded = await page.evaluate(() => {
  const { objects, ...rest } = window.village.snapshot()
  return rest
})

if (flag('perf')) {
  result.perf = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const deltas = []
        let last = performance.now()
        const end = last + 6000
        const step = (now) => {
          deltas.push(now - last)
          last = now
          if (now < end) requestAnimationFrame(step)
          else {
            deltas.sort((a, b) => a - b)
            const q = (p) => deltas[Math.floor(p * (deltas.length - 1))]
            const s = window.village.snapshot()
            resolve({
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
  const strip = (s) => ({ plugins: s.plugins.length, sceneObjects: s.sceneObjects, objects: s.objects.join('|'), frameHooks: s.frameHooks, geometries: s.geometries, textures: s.textures, fog: s.fog, drawSwapped: s.drawSwapped })
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
  for (const n of ['postfx', 'camera', 'lamp', 'motes', 'fridge', 'table', 'window', 'room']) await page.evaluate((x) => window.village.unload(x), n)
  await frame()
  const { objects, ...empty } = await page.evaluate(() => window.village.snapshot())
  proof.rendererOnly = { ...empty, objects }
  result.unload = proof
}

result.errors = errors
console.log(JSON.stringify(result, null, 2))
await browser.close()
