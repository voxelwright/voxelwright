// The realm's two faces side by side (#450): the same pictures set in Vox Zakon and in Vox Block (page/typeface.ts,
// `?face=`), for the owner to compare in the world.
//
//   node sf/type-shots.mjs [--no-build] [--dist dist-sf] [--out ~/.village/engine/sf/type] [--faces zakon,block]
//
// Into <out>/<face>/: the park's first view by day and by night at 1280 x 720 and on an upright phone (390 x 844,
// three pixels to one), BLOG close by (flown to), the Credits key, and in explore mode the tools and the
// hour's panel (on the phone with the panel unfolded). Into <out>: a sheet of each, Zakon | Block a row, labelled, and
// fit.json: every key's box and whether its words overflow it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'type')), faces = arg('faces', 'zakon,block').split(',')
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
const NAMES = { zakon: 'Vox Zakon', block: 'Vox Block' }
/** The glyph set BLOG is in: the face's display set, on a phone its compact set (typeface.ts). */
const SETS = { zakon: { desktop: 'Vox Zakon', phone: 'Vox Zakon Text Caps' }, block: { desktop: 'Vox Block', phone: 'Vox Sign 2' } }
const site = await plain(dist, '127.0.0.1', 0, {}), back = await turn(), browser = await chromium.launch(CHROME)
const DESKTOP = { viewport: { width: 1280, height: 720 } }, PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const fit = {}
/** Every kit key on the page: its words, its box, and whether the words are wider than the box. */
const KEYS = () => [...document.querySelectorAll('#first .vx-button, #realm .vx-button, #realm .vx-toggle-group > label')].filter((el) => el.getBoundingClientRect().width > 0 && el.checkVisibility({ visibilityProperty: true })).map((el) => {
  const r = el.getBoundingClientRect(), words = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }; for (let n = words.nextNode(); n; n = words.nextNode()) { if (!n.textContent.trim()) continue; const range = document.createRange(); range.selectNodeContents(n); /* (the kit moves a key's words with its face as it rises and sinks, by a transform on what holds them: taken out, the words against the key at rest) */ let dx = 0, dy = 0; for (let a = n.parentElement; a && a !== el; a = a.parentElement) { const tf = getComputedStyle(a).transform; if (tf !== 'none') { const m = new DOMMatrix(tf); dx += m.m41; dy += m.m42 } } for (const q of range.getClientRects()) { t.left = Math.min(t.left, q.left - dx); t.top = Math.min(t.top, q.top - dy); t.right = Math.max(t.right, q.right - dx); t.bottom = Math.max(t.bottom, q.bottom - dy) } }; if (t.left === Infinity) Object.assign(t, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  return { words: el.textContent.trim(), font: getComputedStyle(el).fontFamily.split(',')[0], size: getComputedStyle(el).fontSize, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], over: Math.round(Math.max(0, r.left - t.left, t.right - r.right, r.top - t.top, t.bottom - r.bottom)), onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }
})
const clipOf = async (page, selector, pad = 20) => {
  const boxes = await page.evaluate((s) => [...document.querySelectorAll(s)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => [r.left, r.top, r.right, r.bottom]), selector)
  const [x0, y0, x1, y1] = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [1e9, 1e9, -1e9, -1e9])
  const size = page.viewportSize(), x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad)
  return { x, y, width: Math.min(size.width, x1 + pad) - x, height: Math.min(size.height, y1 + pad) - y }
}
try {
  for (const face of faces) {
    const dir = join(out, face), q = `knock=0&face=${face}`
    mkdirSync(dir, { recursive: true })
    fit[face] = {}
    for (const [name, options] of [['desktop', DESKTOP], ['phone', PHONE]]) {
      const context = await browser.newContext(options), page = await context.newPage()
      page.on('console', (m) => { if (m.type() === 'error') console.log(`  (${face} ${name}) ${m.text()}`) })
      // (At the page's own starting scale, pinned: a check drawing beside these stills, as one may with a turn each since
      // #497, brought the picture down to a smear of the banner and EXPLORE.)
      await page.goto(`${site.url}/sf/index.html?${q}&scale=${name === 'phone' ? 0.5 : 0.75}`)
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far.whole, null, { timeout: 300_000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() => { const p = globalThis.engine.boards.plane, b = p.box; return p.readable && b && b.x0 > innerWidth * 0.12 && b.x1 < innerWidth * 0.9 }, null, { timeout: 60_000 }).catch(() => null)
      await page.waitForTimeout(2500)
      const shown = await page.evaluate(() => globalThis.engine.boards.letters('blog')?.face)
      if (shown !== SETS[face][name]) throw new Error(`?face=${face} drew BLOG in ${shown}`)
      await page.screenshot({ path: join(dir, `day-${name}.png`) })
      for (const key of ['credits']) await page.screenshot({ path: join(dir, `keys-${key}-${name}.png`), clip: await clipOf(page, `#first .${key}`, 24) })
      fit[face][`first-${name}`] = await page.evaluate(KEYS)
      // By night: the plane held where it is, the hour set, the lights given time to come.
      await page.evaluate(() => { const p = globalThis.engine.boards.plane; p.hold = p.phase; globalThis.engine.hour = 21.5 })
      await page.waitForTimeout(6000)
      await page.screenshot({ path: join(dir, `night-${name}.png`) })
      // Explore mode by day: the tools and the hour's panel (folded away on a phone until its key is pressed).
      await page.evaluate(() => { globalThis.engine.hour = 15; globalThis.engine.first.engage() })
      await page.waitForTimeout(3500)
      await page.screenshot({ path: join(dir, `explore-${name}.png`) })
      await page.screenshot({ path: join(dir, `tools-${name}.png`), clip: await clipOf(page, '#realm .tools', 24) })
      if (name === 'phone') { await page.locator('#realm .fold').tap(); await page.waitForTimeout(1800) }
      await page.screenshot({ path: join(dir, `panel-${name}.png`), clip: await clipOf(page, '#realm .sky, #realm .fold', 24) })
      fit[face][`explore-${name}`] = await page.evaluate(KEYS)
      if (name === 'desktop') {
        // BLOG close by, flown to as a click on it flies.
        await page.evaluate(() => globalThis.engine.boards.fly('blog'))
        await page.waitForTimeout(7000)
        await page.screenshot({ path: join(dir, 'blog-close.png') })
        await page.evaluate(() => { globalThis.engine.hour = 21.5 })
        await page.waitForTimeout(6000)
        await page.screenshot({ path: join(dir, 'blog-close-night.png') })
      }
      await context.close()
      console.log(`${face} ${name}: shot`)
    }
  }
  writeFileSync(join(out, 'fit.json'), JSON.stringify(fit, null, 1))
  // The sheets: a row a picture, the faces side by side in the order asked (Zakon first), each labelled.
  const SHEETS = [['park-day', ['day-desktop', 'day-phone']], ['park-night', ['night-desktop', 'night-phone']], ['blog', ['blog-close', 'blog-close-night']], ['keys', ['keys-credits-desktop', 'keys-credits-phone']], ['explore', ['tools-desktop', 'panel-desktop', 'tools-phone', 'panel-phone']], ['explore-whole', ['explore-desktop', 'explore-phone']]]
  const context = await browser.newContext({ viewport: { width: 1800, height: 800 } }), page = await context.newPage()
  for (const [sheet, rows] of SHEETS) {
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#15171c;color:#e8ebf0;font:600 15px system-ui}table{border-spacing:16px 10px}th{text-align:left;font-size:17px}td{vertical-align:top}td.l{color:#9aa3ad;font-weight:500;white-space:nowrap}img{display:block;max-width:820px;max-height:620px;outline:1px solid #333}</style><table><tr><th></th>${faces.map((f) => `<th>${NAMES[f]}${f === 'zakon' ? ' (asked first)' : ''}</th>`).join('')}</tr>${rows.map((r) => `<tr><td class="l">${r}</td>${faces.map((f) => `<td><img src="file://${join(out, f, r + '.png')}"></td>`).join('')}</tr>`).join('')}</table>`
    const at = join(out, `sheet-${sheet}.html`)
    writeFileSync(at, html)
    await page.goto(`file://${at}`); await page.waitForLoadState('load')
    await page.screenshot({ path: join(out, `sheet-${sheet}.png`), fullPage: true })
  }
  await context.close()
  console.log(`pictures and sheets in ${out}`)
} finally { await browser.close(); site.stop(); back() }
