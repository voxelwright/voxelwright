// The settings key (a gear) in the SF realm's first view (#506, page/first.ts, page/realm-ui.ts): the weather, the hour and the
// graphics before the visitor goes in. The folder `node sf/build.mjs` writes, served as plain files; Chrome with
// WebGPU at 1440 x 900, on an upright phone of 390 x 844 and on one on its side (844 x 390). One GPU is shared, so it
// waits its turn.
//
//   node test/sf-sky.mjs [--no-build] [--dist dist-sf] [--sizes desk,phone,side] [--shots ~/.village/engine/sf/landing-sky]
//
// It fails unless, at each size:
//   - the first view shows the settings key, a gear named "Weather, time of day and graphics", and nothing else of the
//     realm's (no tools, no thumbs' keys), its panel folded; the key in the top right, clear of every board and of the
//     credits key, and the banner never under it;
//   - the key opens the panel: the weather and the graphics, no Say and no Reset world; open, it leaves the EXPLORE
//     board, its tower (projected from its record) and BLOG clear;
//   - a press on Fog brings fog, and a press on Low draws at Low and keeps it (localStorage), and neither asks for
//     the way in nor leaves the focus on the control: Enter after it opens the eggs' line, as in the first view;
//   - the key folds the panel again, and Low is still chosen after a reload;
//   - (desk and upright phone) two presses on the EXPLORE board still go in, the panel folded behind the key there,
//     and the way back comes to the first view with the key shown and the panel folded.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'landing-sky'))
const sizes = arg('sizes', 'desk,phone,side').split(',')
const failures = [], errors = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const SIZES = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  side: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  // (A smaller phone on its side, 667 x 375: not in the default sizes, asked for with --sizes.)
  small: { viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}
const ready = (page) => page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far?.whole && globalThis.engine.explore && globalThis.engine.eggs, null, { timeout: 300_000 })
const until = (page, what, ms = 30_000) => page.waitForFunction(what, null, { timeout: ms }).then(() => true, () => false)

/** What of the realm's controls is seen, and where the key is against the boards and the credits key (CSS px). */
const look = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !el.closest('[hidden]') && el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  const box = (el) => { const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } }
  const e = globalThis.engine, key = document.querySelector('#realm .fold')
  // (A kit key's solid stands up and to the left of its face, and a voxel past it all round: 12 px is room for it.)
  const k = box(key), grown = { x0: k.x0 - 12, y0: k.y0 - 12, x1: k.x1 + 4, y1: k.y1 + 4 }
  const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const boards = e.boards.records.map((b) => { const w = e.boards.where(b.id); return w && { id: b.id, x0: w.x - w.wide / 2, y0: w.y - w.high / 2, x1: w.x + w.wide / 2, y1: w.y + w.high / 2 } }).filter(Boolean)
  // What the open panel must leave clear: the EXPLORE board, its tower (the building under it, from the street to its
  // roof and 30 m either side of its middle, projected as sf-towers.mjs projects the landmarks) and BLOG.
  const v = e.view(), rect = document.querySelector('canvas').getBoundingClientRect()
  const on = (c) => { const d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]; return { x: (((d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far) + 1) / 2) * rect.width, y: ((1 - (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)) / 2) * rect.height, far } }
  const ex = e.boards.records.find((r) => r.does === 'explore'), foot = ex && on([ex.building[0], 0, ex.building[1]]), roof = ex && on([ex.building[0], ex.at[1], ex.building[1]])
  const half = foot && ((300 / roof.far / v.tanHalf) / 2) * rect.height
  const tower = foot && { id: 'explore\'s tower', x0: roof.x - half, y0: roof.y, x1: roof.x + half, y1: Math.min(innerHeight, foot.y) }
  const keep = [...boards.filter((b) => b.id === 'explore' || b.id === 'blog'), ...(tower ? [tower] : [])]
  const sky = document.querySelector('#realm .sky'), s = sky.getBoundingClientRect(), solid = { x0: s.left - 12, y0: s.top - 12, x1: s.right + 4, y1: s.bottom + 4 }
  const covers = vis(sky) ? keep.filter((b) => meets(solid, b)).map((b) => b.id) : []
  // A seat's words inside its key: clear of its side walls (two cells of the panel's own size each side).
  const cell = parseFloat(getComputedStyle(sky).getPropertyValue('--vx')) || 4
  const cramped = vis(sky) ? [...sky.querySelectorAll('.vx-toggle-group > label')].filter(vis).filter((l) => { const w = (l.querySelector('.vx-label') ?? l).getBoundingClientRect(), r = l.getBoundingClientRect(); return w.left < r.left + 2 * cell || w.right > r.right - 2 * cell }).map((l) => l.textContent.trim()) : []
  const others = [...document.querySelectorAll('#realm > *:not(.fold, .sky), #hud, #aim, #where, #over')].filter(vis).map((el) => el.id ? `#${el.id}` : `.${[...el.classList].join('.')}`)
  return {
    key: vis(key), words: key.textContent.trim(), name: key.getAttribute('aria-label'), glyph: key.dataset.vxIcon, covers, cramped, panelAt: [s.left, s.top, s.width, s.height].map(Math.round), keep: keep.map((b) => `${b.id} ${[b.x0, b.y0, b.x1, b.y1].map(Math.round).join(',')}`), at: [Math.round(k.x0), Math.round(k.y0), Math.round(k.x1 - k.x0), Math.round(k.y1 - k.y0)], vw: innerWidth, vh: innerHeight,
    over: boards.filter((b) => meets(grown, b)).map((b) => b.id), credits: meets(grown, box(document.querySelector('#first .credits'))),
    panel: vis(document.querySelector('#realm .sky')), others,
    parts: Object.fromEntries(Object.entries({ weather: '#realm .sky .weather', graphics: '#realm .sky .graphics', time: '#realm .sky .vx-slider', say: '#realm .sky .say', reset: '#realm .sky .reset', home: '#realm .sky .home' }).map(([n, s]) => [n, vis(document.querySelector(s))])),
    weather: e.realmControls.sky.weather, preset: e.graphics.preset, resolution: e.graphics.resolution, kept: (() => { try { return localStorage.getItem('village.graphics') } catch { return null } })(),
    checked: document.querySelector('#realm input[name=realm-graphics]:checked')?.value ?? null,
    resAutoShown: vis(document.querySelector('#realm .sky .res-auto')),
    resFpsShown: vis(document.querySelector('#realm .sky .res-fps')),
    resManualShown: vis(document.querySelector('#realm .sky .res-manual')),
    focus: !!document.activeElement && document.querySelector('#realm').contains(document.activeElement),
    engaged: e.first.engaged, first: document.documentElement.classList.contains('first'), state: e.explore.state,
  }
})
const middle = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }, sel)
const press = async (page, phone, x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y) }
const label = (name, value) => `input[name=${name}][value=${value}]`

try {
  for (const size of sizes) {
    console.log(`${size}:`)
    const phone = size !== 'desk', context = await browser.newContext(SIZES[size]), page = await context.newPage()
    page.on('pageerror', (e) => errors.push(`${size}: ${e.message}`))
    await page.goto(`${site.url}/sf/index.html`)
    await ready(page)
    await page.waitForTimeout(2000)
    const shut = await look(page)
    await page.screenshot({ path: join(shots, `${size}-closed.png`) })
    check(shut.first && !shut.engaged && shut.key && shut.glyph === 'gear' && !shut.words && shut.name === 'Weather, time of day and graphics' && !shut.panel && !shut.others.length, `the first view shows the settings key (a ${shut.glyph}, no words: "${shut.words}"; named "${shut.name}") and nothing else of the realm's${shut.others.length ? ` (but ${shut.others.join(', ')})` : ''}, its panel folded`)
    check(shut.at[0] > shut.vw / 2 && shut.at[1] < shut.vh / 4 && !shut.over.length && !shut.credits, `the key at ${shut.at.join(', ')} (x, y, w, h) is in the top right, clear of every board${shut.over.length ? ` (not ${shut.over.join(', ')})` : ''} and of the credits key`)
    if (phone) check(shut.at[3] >= 44, `by touch the key is ${shut.at[3]} px high (44 or more)`)
    // The banner its plane tows, kept in the first view's picture, at every 120th of its round: never under the key.
    const banner = await page.evaluate(async () => {
      const p = globalThis.engine.boards.plane, frame = () => new Promise((r) => requestAnimationFrame(() => r()))
      if (!p) return null
      const k = document.querySelector('#realm .fold').getBoundingClientRect(), under = []
      for (let i = 0; i < 120; i++) { p.hold = i / 120; await frame(); const c = p.box; if (c && c.x0 < k.right + 4 && c.x1 > k.left - 12 && c.y0 < k.bottom + 4 && c.y1 > k.top - 12) under.push(i) }
      p.hold = null
      return under
    })
    check(banner !== null && banner.length === 0, `the banner never passes under the key on its round${banner?.length ? ` (it does at ${banner.length} of 120 places)` : ''}`)

    await press(page, phone, ...(await middle(page, '#realm .fold')))
    await page.waitForTimeout(600)
    const open = await look(page)
    await page.screenshot({ path: join(shots, `${size}-open.png`) })
    check(open.panel && !open.cramped.length, `every seat's words are inside its key${open.cramped.length ? ` (not ${open.cramped.join(', ')})` : ''}`)
    check(open.panel && !open.covers.length, `the open panel (${open.panelAt.join(', ')}) leaves clear ${open.keep.join('; ')}${open.covers.length ? ` (but covers ${open.covers.join(', ')})` : ''}`)
    check(open.panel && open.parts.weather && open.parts.graphics && !open.parts.say && !open.parts.reset && !open.parts.home && !open.engaged && open.state === 'idle', `the key opens the panel: ${Object.entries(open.parts).map(([n, v]) => `${n} ${v ? 'shown' : 'hidden'}`).join(', ')}; nobody in, the board ${open.state}`)

    await press(page, phone, ...(await middle(page, `#realm .weather label:has(${label('realm-weather', 'fog')})`)))
    await press(page, phone, ...(await middle(page, `#realm .graphics label:has(${label('realm-graphics', 'low')})`)))
    await page.waitForTimeout(600)
    const used = await look(page)
    check(used.weather === 'fog', `a press on Fog brings fog (${used.weather})`)
    check(used.preset === 'low' && used.kept === 'low' && used.checked === 'low' && used.resolution.auto === true, `a press on Low draws at Low, keeps it, and leaves Dynamic resolution On (${used.preset}, kept ${used.kept}, checked ${used.checked}, auto ${used.resolution.auto})`)
    check(!used.focus && !used.engaged && used.state === 'idle', `neither leaves the focus on the control (${used.focus}) nor asks for the way in (${used.state})`)
    // Where the resolution section is shown (desk and upright phone), Dynamic resolution is On by default with Target FPS
    // shown and the slider hidden; turning it Off shows the slider and hides Target FPS, without affecting Graphics.
    if (used.resAutoShown) {
      check(used.resFpsShown && !used.resManualShown, 'Dynamic resolution On by default shows Target FPS and hides the resolution slider')
      await press(page, phone, ...(await middle(page, '#realm .sky .res-auto')))
      await page.waitForTimeout(400)
      const manual = await look(page)
      await page.screenshot({ path: join(shots, `${size}-manual-res.png`) })
      check(!manual.resolution.auto && !manual.resFpsShown && manual.resManualShown && manual.preset === 'low', `turning Dynamic resolution Off shows the slider, hides Target FPS, and keeps Graphics preset (${JSON.stringify({ auto: manual.resolution.auto, fps: manual.resFpsShown, manual: manual.resManualShown, preset: manual.preset })})`)
      check(!manual.covers.length, `with the resolution slider shown, the open panel still leaves clear ${manual.keep.join('; ')}${manual.covers.length ? ` (but covers ${manual.covers.join(', ')})` : ''}`)
      await press(page, phone, ...(await middle(page, '#realm .sky .res-auto')))
      await page.waitForTimeout(400)
      const backOn = await look(page)
      check(backOn.resolution.auto && backOn.resFpsShown && !backOn.resManualShown, 'turning Dynamic resolution back On restores Target FPS and hides the slider')
    }
    if (!phone) {
      // The hour's fader dragged and let go over the picture gives the keys back too.
      const [fx, fy] = await middle(page, '#realm .sky .vx-slider')
      await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx - 80, fy + 300, { steps: 8 }); await page.mouse.up()
      await page.waitForTimeout(300)
      check(!(await look(page)).focus && !(await look(page)).engaged, 'the hour\'s fader let go over the picture leaves the focus off the panel, and nobody in')
      await page.keyboard.press('Enter'); await page.waitForTimeout(300)
      const line = await page.evaluate(() => { const l = document.querySelector('.egg-line'); return !!l && !l.hidden && l.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && document.activeElement?.tagName === 'INPUT' })
      check(line && !(await look(page)).engaged, 'after them, Enter opens the eggs\' line as in the first view, and nothing else')
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    }
    await press(page, phone, ...(await middle(page, '#realm .fold')))
    await page.waitForTimeout(400)
    check(!(await look(page)).panel, 'the key folds the panel again')
    await page.screenshot({ path: join(shots, `${size}-fog-low.png`) })

    await page.reload()
    await ready(page)
    const kept = await look(page)
    check(kept.preset === 'low' && kept.checked === 'low' && !kept.panel && kept.key, `after a reload Low is still chosen (${kept.preset}, checked ${kept.checked}), the key there and its panel folded`)
    await page.evaluate(() => { try { localStorage.removeItem('village.graphics'); localStorage.removeItem('village.resolution') } catch { /* nothing kept */ } })

    if (size !== 'side') {
      // Open the panel, then go in: the panel is folded on the roof. On a desk by two presses on the board (the panel
      // is clear of it); on an upright phone the open panel is over the board, so by the host's `explore`.
      await press(page, phone, ...(await middle(page, '#realm .fold')))
      await page.waitForTimeout(400)
      check((await look(page)).panel, 'the panel is open as the visitor goes in')
      const board = async () => { const w = await page.evaluate(() => globalThis.engine.boards.where('explore')); return [w.x, w.y] }
      if (phone) await page.evaluate(() => void globalThis.engine.explore.go())
      else { await press(page, phone, ...(await board())); await page.waitForTimeout(800); await press(page, phone, ...(await board())) }
      const went = await until(page, () => globalThis.engine.explore.state === 'in', 60_000)
      const inside = await look(page)
      check(went && inside.engaged && !inside.first && !inside.panel && inside.key, `${phone ? 'the host\'s explore' : 'two presses on EXPLORE'} still go${phone ? 'es' : ''} in (${inside.state}): the panel folded behind the key there`)
      await page.evaluate(() => globalThis.engine.explore.back())
      const home = await until(page, () => globalThis.engine.explore.state === 'idle' && !globalThis.engine.first.engaged, 60_000)
      await page.waitForTimeout(800)
      const again = await look(page)
      check(home && again.first && again.key && !again.panel && !again.others.length, `the way back comes to the first view: the key shown, its panel folded, nothing else of the realm's${again.others.length ? ` (but ${again.others.join(', ')})` : ''}`)
    }
    if (size === 'desk') {
      // With no board that leads in, a key ends the first view: on a desk the panel is then open in its corner, as before #506.
      await page.goto(`${site.url}/sf/index.html?boards=0`)
      await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.first, null, { timeout: 300_000 })
      await page.waitForTimeout(1000)
      await page.keyboard.press('KeyW')
      const opened = await until(page, () => globalThis.engine.first.engaged && !document.querySelector('#realm .sky').hidden, 10_000)
      check(opened, 'with ?boards=0, a key goes in and the desk\'s panel is open in its corner, as before')
    }
    await context.close()
  }
  check(errors.length === 0, `no errors on any page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) { console.log(`  FAIL ${e.message.split('\n')[0]}`); failures.push(e.message.split('\n')[0]) } finally { await browser.close(); site.stop(); back() }
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
