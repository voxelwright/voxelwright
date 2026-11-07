// Before/after captures for themes (#50), headless Chrome, deterministic where it can be:
// Math.random is seeded and the page clock is frozen at a fixed instant, so two runs
// of the same page differ only by GPU nondeterminism and film grain.
//
//   node scripts/theme-shots.mjs <out-dir> <name>=<url> [<name>=<url> ...] [--dpr=1] [--wait=3000]
//   node scripts/theme-shots.mjs --diff a.png b.png      # mean absolute difference (0-255) and % pixels > 16
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const launch = () => chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
})

if (args[0] === '--diff') {
  const browser = await launch()
  const page = await browser.newPage()
  const [a, b] = args.slice(1, 3).map((p) => `data:image/png;base64,${readFileSync(resolve(p)).toString('base64')}`)
  const result = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.src = src })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const read = (img) => {
      const c = new OffscreenCanvas(img.width, img.height)
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, img.width, img.height).data
    }
    const da = read(ia), db = read(ib)
    let sum = 0, changed = 0
    for (let i = 0; i < da.length; i += 4) {
      let worst = 0
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(da[i + k] - db[i + k])
        sum += d
        worst = Math.max(worst, d)
      }
      if (worst > 16) changed++
    }
    const px = da.length / 4
    return { meanAbs: +(sum / (px * 3)).toFixed(3), changedPct: +((changed / px) * 100).toFixed(3), size: [ia.width, ia.height] }
  }, [a, b])
  console.log(JSON.stringify(result))
  await browser.close()
  process.exit(0)
}

const out = resolve(args[0])
mkdirSync(out, { recursive: true })
const dpr = Number(opt('dpr', '1'))
const wait = Number(opt('wait', '3000'))
for (const pair of args.slice(1).filter((a) => !a.startsWith('--'))) {
  const at = pair.indexOf('=')
  const name = pair.slice(0, at), url = pair.slice(at + 1)
  // A browser per capture: one GPU process crash costs one shot, not the run.
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr })
  await page.addInitScript(() => {
    let s = 1234567
    Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  })
  await page.clock.setFixedTime(new Date('2026-11-07T17:30:00'))
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  await page.waitForFunction(() => window.village, null, { timeout: 30000 })
  const ready = await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(wait)
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  const snap = await page.evaluate(() => { const { objects, ...s } = window.village.snapshot(); return { quality: s.quality, features: s.features, render: s.render, failed: s.plugins.failed } })
  console.log(JSON.stringify({ name, url, ok: ready.ok, ...snap, errors: errors.slice(0, 3), file }))
  await browser.close()
}
