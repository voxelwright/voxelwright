// A logo's link, run as a page of its own as voxelwright.world runs it (#450, boards.ts `leaving`): the folder
// `node sf/build.mjs` writes, served as plain files, not in a frame. Chrome with WebGPU.
//
// It fails unless, at 1280 x 720 and on an upright phone (390 x 844):
//   - a click on a logo in the park's picture flies the eye to it and leaves the page where it is: no navigation, no
//     new tab, and a card asks whether to open it in a new tab
//   - the card's open key opens the logo's address in a new tab, and the realm's page stays where it is
//   - the card's Back to the view flies the eye back to the first view's eye, and the card is gone
//   - Esc on the card does the same
//
//   node test/sf-leaving.mjs [--no-build] [--headed]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'leaving'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const at = `${site.url}/sf/index.html`
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
try {
  for (const [w, h, name] of [[1280, 720, 'wide'], [390, 844, 'phone']]) {
    console.log(`${name} (${w} x ${h})`)
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: name === 'phone', isMobile: name === 'phone' })
    // The networks' own pages are never fetched: a tab opened to one is enough.
    await context.route(/^https:\/\/(?!127\.0\.0\.1)/, (r) => r.abort())
    const page = await context.newPage()
    await page.goto(at)
    await page.waitForFunction(() => globalThis.engine?.seen?.near && globalThis.engine?.boards, null, { timeout: 120_000 })
    await page.waitForTimeout(1500)
    const eye = () => page.evaluate(() => { const p = globalThis.engine.pose ?? null; return p && { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch } })
    const logos = await page.evaluate(() => globalThis.engine.boards.listed().filter((b) => b.type === 'logo').map((b) => ({ ...b, w: globalThis.engine.boards.where(b.id) })))
    const logo = logos.find((b) => b.w && b.w.x > 40 && b.w.x < w - 40 && b.w.y > 80 && b.w.y < h - 80)
    check(!!logo, `a logo is in the park's picture to click (${logos.map((b) => `${b.id} ${b.w ? `${Math.round(b.w.x)},${Math.round(b.w.y)}` : 'none'}`).join('; ')})`)
    if (!logo) { await context.close(); continue }
    const start = await eye()
    const opened = []
    context.on('page', (p) => opened.push(p))
    if (name === 'phone') await page.touchscreen.tap(logo.w.x, logo.w.y); else await page.mouse.click(logo.w.x, logo.w.y)
    await page.waitForFunction(() => document.querySelector('#leaving.on'), null, { timeout: 15_000 }).catch(() => null)
    const card = await page.evaluate(() => { const c = document.querySelector('#leaving'); const r = c?.getBoundingClientRect(); return c && { on: c.classList.contains('on'), text: c.querySelector('p')?.textContent, href: c.querySelector('a')?.href, target: c.querySelector('a')?.target, inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight } })
    const there = await eye()
    check(page.url() === at && opened.length === 0, `the click on ${logo.id} left the page where it was (${page.url() === at ? 'same page' : page.url()}) and opened no tab (${opened.length})`)
    check(!!card?.on && card.href === logo.to && card.target === '_blank' && card.inside, `a card asks "${card?.text}", its key leads to ${card?.href} in a new tab, wholly on the screen (${card?.inside})`)
    check(Math.hypot(there.x - start.x, there.z - start.z) > 50, `the eye flew to the logo first (${Math.round(Math.hypot(there.x - start.x, there.z - start.z))} m)`)
    // (The kit's voxels assemble over a second or so.)
    await page.waitForTimeout(2000)
    await page.screenshot({ path: join(shots, `${name}-card.png`) })
    // Open: a new tab with the logo's address, and this page where it was.
    const popup = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null)
    if (name === 'phone') { const b = await page.locator('#leaving a').boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2) } else await page.click('#leaving a')
    const tab = await popup
    const tabUrl = tab ? await tab.evaluate(() => location.href).catch(() => tab.url()) : null
    check(!!tab && page.url() === at, `the open key opened a new tab (${tab ? tab.url() || tabUrl : 'none'}), and the realm stayed`)
    await tab?.close()
    // Back to the view.
    if (name === 'phone') { const b = await page.locator('#leaving .back').boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2) } else await page.click('#leaving .back')
    await page.waitForTimeout(3000)
    const back = await eye(), gone = await page.evaluate(() => document.querySelector('#leaving').hidden)
    const off = Math.hypot(back.x - start.x, back.y - start.y, back.z - start.z)
    check(gone && off < 1 && Math.abs(back.yaw - start.yaw) < 0.01 && Math.abs(back.pitch - start.pitch) < 0.01, `Back to the view flew the eye back to the first view (${off.toFixed(2)} m off, yaw ${(back.yaw - start.yaw).toFixed(3)}) and put the card away (${gone})`)
    await page.screenshot({ path: join(shots, `${name}-back.png`) })
    // Esc does the same.
    if (name === 'wide') {
      const again = await page.evaluate((id) => globalThis.engine.boards.where(id), logo.id)
      await page.mouse.click(again.x, again.y)
      await page.waitForFunction(() => document.querySelector('#leaving.on'), null, { timeout: 15_000 }).catch(() => null)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(3000)
      const esc = await eye(), off2 = Math.hypot(esc.x - start.x, esc.y - start.y, esc.z - start.z)
      check(off2 < 1 && (await page.evaluate(() => document.querySelector('#leaving').hidden)), `Esc on the card flew back too (${off2.toFixed(2)} m off)`)
      // And EXPLORE still arms from the first view after the way back.
      check(await page.evaluate(() => { const e = globalThis.engine.explore; if (!e) return 'no explore yet'; e.act(); const s = e.state; e.disarm(); return s === 'armed' }) === true, 'EXPLORE still arms from the first view after the way back')
    }
    await context.close()
  }
} finally {
  await browser.close()
  site.stop()
}
console.log(failures.length ? `${failures.length} failed` : 'all passed')
process.exit(failures.length ? 1 : 0)
