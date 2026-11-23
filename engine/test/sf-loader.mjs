// The SF realm's loader, checked (#450, page/loading.html): the folder `node sf/build.mjs` writes, served as plain
// files, opened cold on a throttled link (25 Mbit/s, 40 ms) in Chrome with WebGPU, wide and on an upright phone.
//
//   node test/sf-loader.mjs [--no-build] [--dist dist-sf]
//
// It fails unless:
//   - no frame of it is blocky: of its picture's 4 x 4 pixel squares, sampled every 0.4 s until the park is shown,
//     never half or more are one flat colour (the owner's fault with the cells it had before, whose first frames were
//     0.93 flat wide and 0.96 on a phone; under the fog 0.19 and 0.31 at worst, the phone's calm sky the most);
//   - the page asks for the one picture its window frames and not the other, and draws it under the fog (the top of
//     the frame, sky over the fog, is opaque);
//   - keys are held while it loads and are the page's once the place is ready, and it is gone within two seconds of that.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
const page0 = readFileSync(join(dist, 'sf/index.html'), 'utf8'), files = { wide: /loading-wide-[0-9a-f]+\.webp/.exec(page0)?.[0], upright: /loading-upright-[0-9a-f]+\.webp/.exec(page0)?.[0] }
check(!!files.wide && !!files.upright, `the page names both pictures (${files.wide}, ${files.upright})`)
const back = await turn()
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })

/** One cold visit: how blocky its frames were at worst, which pictures it asked for, and how it left. */
const visit = async (name, view, mobile) => {
  const site = await plain(dist, '127.0.0.1', 0, {})
  const context = await browser.newContext({ viewport: view, ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) })
  try {
    const page = await context.newPage(), link = await context.newCDPSession(page)
    await link.send('Network.enable')
    await link.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 25e6 / 8, uploadThroughput: 5e6 / 8 })
    await page.goto(`${site.url}/sf/index.html`)
    await page.evaluate(() => { globalThis.keysHeard = 0; addEventListener('keydown', () => globalThis.keysHeard++) })
    let pressed = false
    // The share of the loader's 4 x 4 squares that are one flat colour, as often as the page lets, until the park is shown.
    const flat = [], until = Date.now() + 120_000
    let drawn = false
    for (;;) {
      if (Date.now() > until) { check(false, `${name}: the park is shown within 120 s`); return }
      const r = await page.evaluate(() => {
        const shown = globalThis.engine?.seen?.near > 0, canvas = document.querySelector('#loading canvas')
        if (shown || !canvas?.width || document.getElementById('loading').classList.contains('done')) return { shown }
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, W = canvas.width, H = canvas.height
        let same = 0, all = 0
        for (let y = 0; y + 4 <= H; y += 4) for (let x = 0; x + 4 <= W; x += 4) {
          all++
          const o = (y * W + x) * 4
          let one = true
          for (let j = 0; j < 4 && one; j++) for (let i = 0; i < 4; i++) { const q = ((y + j) * W + x + i) * 4; if (d[q] !== d[o] || d[q + 1] !== d[o + 1] || d[q + 2] !== d[o + 2] || d[q + 3] !== d[o + 3]) { one = false; break } }
          if (one) same++
        }
        return { shown, flat: same / all, at: performance.now(), top: d[(2 * W + (W >> 1)) * 4 + 3] }
      })
      if (r.flat !== undefined) flat.push([Math.round(r.at), Math.round(r.flat * 1000) / 1000])
      if (r.top === 255) drawn = true
      if (!pressed && flat.length === 3) { await page.keyboard.press('Shift'); pressed = true }
      if (r.shown) break
      await page.waitForTimeout(400)
    }
    const worst = flat.reduce((m, [, f]) => Math.max(m, f), 0)
    check(flat.length >= 5 && worst < 0.5, `${name}: no frame is blocky (at worst ${worst} of its 4 x 4 squares one flat colour, bound 0.5; ${flat.length} frames)`)
    // (The page says `done` on its next tick after the park is shown.)
    const ready = await page.waitForFunction(() => { const l = document.getElementById('loading'); return !l || l.classList.contains('done') }, null, { timeout: 2000 }).then(() => true, () => false)
    const held = await page.evaluate(() => globalThis.keysHeard)
    await page.keyboard.press('Shift')
    const heard = await page.evaluate(() => globalThis.keysHeard)
    check(pressed && ready && held === 0 && heard === 1, `${name}: a key while it loads is held, and one once it is ready is the page's (${held} heard while loading, ${heard - held} after)`)
    const gone = await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 2000 }).then(() => true, () => false)
    check(gone, `${name}: the loader is gone within 2 s of the park being shown`)
    const asked = site.asked.filter((a) => a.path.includes('/sf/loading-')).map((a) => a.path.split('/').pop())
    const wanted = mobile ? files.upright : files.wide, other = mobile ? files.wide : files.upright
    const got = site.asked.some((a) => a.path.endsWith(`/${wanted}`) && a.status === 200)
    check(got && !asked.includes(other), `${name}: asks for its own picture alone (${asked.join(', ') || 'none'}), and has it`)
    check(drawn, `${name}: draws it under the fog`)
  } finally { await context.close(); site.stop() }
}

try {
  await visit('wide (1280 x 720)', { width: 1280, height: 720 }, false)
  await visit('upright phone (390 x 844)', { width: 390, height: 844 }, true)
} finally {
  await browser.close()
  back()
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall ok')
process.exit(failures.length ? 1 : 0)
