// A true frame strip of a switch: in-page, each frame's canvas and the held frame over it at
// its current opacity are composed into a thumbnail, at fixed times since the switch.
// Playwright screenshots take 0.1 to 8 s each on a busy GPU, too slow for a 1.5 s switch.
//   node scripts/theme-strip.mjs <out.png> <from-id> <to-id> <ms> [<ms> ...] [--base=http://localhost:5181/]
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const argv = process.argv.slice(2)
const base = argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:5181/'
const [out, from, to, ...times] = argv.filter((a) => !a.startsWith('--'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`${base}?talk=off&build=0&q=high&theme=${from}`)
await page.evaluate(() => { localStorage.clear(); return window.village.ready() })
await page.waitForTimeout(3000)
const url = await page.evaluate(([times, to]) => new Promise((done) => {
  const at = times.map(Number)
  const W = 480, H = 300, cols = 3, rows = Math.ceil(at.length / cols)
  const strip = document.createElement('canvas')
  strip.width = W * cols
  strip.height = (H + 28) * rows
  const g = strip.getContext('2d')
  g.fillStyle = '#2a1d16'
  g.fillRect(0, 0, strip.width, strip.height)
  const root = window.village.kernel.root
  const src = document.querySelector('canvas')
  let i = 0
  const t0 = performance.now()
  window.village.theme.set(to)
  const off = root.on('village/frame', () => {
    queueMicrotask(() => {
      const t = performance.now() - t0
      if (t < at[i]) return
      const x = (i % cols) * W, y = Math.floor(i / cols) * (H + 28)
      g.drawImage(src, x, y, W, H)
      const hold = document.querySelector('.village-theme-hold')
      if (hold) {
        g.globalAlpha = Number(getComputedStyle(hold).opacity)
        g.drawImage(hold, x, y, W, H)
        g.globalAlpha = 1
      }
      g.fillStyle = '#fbf3e2'
      g.font = '18px Georgia'
      g.fillText(`${Math.round(t)} ms`, x + 10, y + H + 21)
      if (++i === at.length) {
        off()
        done(strip.toDataURL('image/png'))
      }
    })
  })
}), [times, to])
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'))
await page.evaluate(() => localStorage.clear())
await browser.close()
