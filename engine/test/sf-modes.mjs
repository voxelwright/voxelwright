// The sky a visitor chooses (#524, page/modes.ts): Light, Dark or San Francisco now, in the settings key's panel.
// The folder `node sf/build.mjs` writes, served as plain files with a stand-in for the Worker's /weather (a report
// as the National Weather Service gives it, through deploy/worker.mjs's trim), the page's clock held at known instants
// (Playwright's clock), Chrome with WebGPU at 1440 x 900 and on an upright phone. One GPU is shared: it waits its turn, and
// a picture is given 90 s (another worktree's checks on the same GPU have held one past the default 30).
//
//   node test/sf-modes.mjs [--no-build] [--dist dist-sf] [--sizes desk,phone] [--shots ~/.village/engine/sf/modes]
//
// It fails unless:
//   - with nothing kept, a visitor whose system is dark has Dark; one whose system is light has the realm's own light
//     and no Sky key pressed;
//   - Dark and Light go to their hours (21.5, 17.25) under a clear sky, and the page is dark or light (data-theme);
//     each is kept (vx-sky, and vx-theme for the blog);
//   - SF now, at 22:20 on 24 November 2026 (a full moon high in the east), takes the clock (22.33), the weather the
//     report says, and lights the city by the moon, its disc whole; at 17:30 on 12 November (a crescent low in the
//     southwest after sunset) by a thin moon; at noon by the sun with no moon drawn; the page dark at night and
//     light by day;
//   - the light comes round to the real sky (settled), and once there the moon's disc stands where the almanac says;
//   - the fader, or a weather key, lets go of SF now (no Sky key pressed), and SF now again takes it back;
//   - the Matrix, and the moon egg, take the sky, and once they end SF now has it again and comes round to the real sky;
//     a mode chosen while the Matrix runs is still the sky once it ends; an hour set while a mode glides is the visitor's;
//   - an address with an hour (?hour=12) keeps its hour over a kept choice;
//   - a weather service that fails leaves the weather as it was, with nothing worse than a note in the console.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { heavens, sfHour } from '../page/almanac.ts'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'modes'))
const sizes = arg('sizes', 'desk,phone').split(',')
const failures = [], errors = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })

// The Worker's /weather, as its trim gives it: a report ten minutes before the page's clock (null: the service failed).
let report = { clouds: ['CLR'], present: [], ceiling: null, visibility: 16093 }, clock = 0, asked = 0
const site = await plain(dist, '127.0.0.1', 0, {
  extra: (req, res) => {
    if (!req.url.startsWith('/weather')) return false
    asked++
    if (!report) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"the weather service did not answer"}'); return true }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' })
    res.end(JSON.stringify({ observed: { time: new Date(clock - 600_000).toISOString(), ...report } }))
    return true
  },
})
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const SIZES = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}
const TONIGHT = Date.parse('2026-11-25T06:20:00Z'), CRESCENT = Date.parse('2026-11-13T01:30:00Z'), NOON = Date.parse('2026-11-24T20:00:00Z')
const until = (page, what, arg, ms = 30_000) => page.waitForFunction(what, arg, { timeout: ms }).then(() => true, () => false)
const ready = (page) => page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far?.whole && globalThis.engine.eggs && globalThis.engine.first, null, { timeout: 300_000 })

/** A page of the realm at a size, its clock held at `at`, what is kept in its storage put there first. */
const open = async (size, at, { kept = {}, query = '', dark = false } = {}) => {
  clock = at
  const context = await browser.newContext({ ...SIZES[size], colorScheme: dark ? 'dark' : 'light' }), page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${size}: ${e.message}`))
  const notes = []
  // (The browser's own line for the stand-in's failed service is what the page is asked to bear, not an error of its.)
  page.on('console', (m) => { if (m.type() === 'error' && !(report === null && /status of 502/.test(m.text()))) errors.push(`${size}: ${m.text()}`); else notes.push(m.text()) })
  await page.clock.setFixedTime(at)
  await context.addInitScript((kept) => { if (sessionStorage.getItem('kept-once')) return; sessionStorage.setItem('kept-once', '1'); for (const [k, v] of Object.entries(kept)) localStorage.setItem(k, v) }, kept)
  await page.goto(`${site.url}/sf/index.html${query}`)
  await ready(page)
  await page.waitForTimeout(1500)
  return { context, page, notes }
}
/** What the sky's modes say, and the light the page is drawn by. */
const state = (page) => page.evaluate(() => {
  const e = globalThis.engine, m = e.realmControls.modes, sky = e.realmControls.sky, march = e.march
  let kept = {}
  try { kept = { sky: localStorage.getItem('vx-sky'), theme: localStorage.getItem('vx-theme') } } catch { /* none */ }
  return {
    mode: m?.mode, showing: m?.showing ?? null, held: m?.held, settled: m?.settled, real: m?.real ?? null,
    hour: e.hour, weather: sky.weather, moving: sky.moving, day: march.day, sun: [...march.sun.s], moon: { ...march.moon, sun: [...march.moon.sun] },
    checked: document.querySelector('#realm input[name=realm-mode]:checked')?.value ?? null,
    theme: document.documentElement.dataset.theme ?? null, kept,
  }
})
const middle = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }, sel)
const press = async (page, phone, sel) => { const [x, y] = await middle(page, sel); if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y) }
const panel = async (page, phone, want) => {
  const shown = await page.evaluate(() => !document.querySelector('#realm .sky').hidden && document.querySelector('#realm .sky').checkVisibility())
  if (shown !== want) { await press(page, phone, '#realm .fold'); await page.waitForTimeout(500) }
}
const choose = async (page, phone, mode) => { await panel(page, phone, true); await press(page, phone, `#realm .modes label:has(input[value=${mode}])`); await page.waitForTimeout(300) }
const near = (a, b, d = 0.02) => typeof a === 'number' && Math.abs(a - b) < d
const angle = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180 / Math.PI
/** The eye turned to look at a direction (main.ts `view`: forward is [sin yaw cos pitch, sin pitch, -cos yaw cos pitch]). */
const look = (page, d) => page.evaluate((d) => { const p = globalThis.engine.pose; p.yaw = Math.atan2(d[0], -d[2]); p.pitch = Math.asin(d[1]) }, d)
const settledAt = (page, h, ms = 30_000) => until(page, (h) => { const m = globalThis.engine.realmControls.modes; return m.showing === 'sf' && m.settled && Math.abs(globalThis.engine.hour - h) < 0.02 }, h, ms)
const still = (page) => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 30 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }))

try {
  for (const size of sizes) {
    console.log(`${size}:`)
    const phone = size !== 'desk'

    // ── Nothing kept: the system's light or dark ──
    {
      const { context, page } = await open(size, TONIGHT, { dark: true })
      const s = await state(page)
      check(s.mode === 'dark' && (await until(page, () => globalThis.engine.realmControls.modes.showing === 'dark' && Math.abs(globalThis.engine.hour - 21.5) < 0.02 && !globalThis.engine.realmControls.sky.moving, null)), `with nothing kept, a dark system has Dark (${s.mode}, at ${(await state(page)).hour})`)
      await context.close()
    }
    const { context, page, notes } = await open(size, TONIGHT)
    let s = await state(page)
    check(s.mode === null && s.showing === null && s.hour === null, `with nothing kept, a light system has the realm's own light (mode ${s.mode}, hour ${s.hour})`)
    await panel(page, phone, true)
    s = await state(page)
    const said = await page.evaluate(() => document.querySelector('#realm .sky output').value)
    check(s.checked === null && /^13:/.test(said), `no Sky key pressed (${s.checked}), the clock at the hour nearest the realm's own light (${said})`)
    await page.screenshot({ timeout: 90_000, path: join(shots, `${size}-panel.png`) })

    // ── Dark, and Light ──
    await choose(page, phone, 'dark')
    const dark = await until(page, () => { const e = globalThis.engine; return e.realmControls.modes.showing === 'dark' && Math.abs(e.hour - 21.5) < 0.02 && !e.realmControls.sky.moving }, null, 40_000)
    s = await state(page)
    check(dark && s.weather === 'clear' && s.theme === 'dark' && s.kept.sky === 'dark' && s.kept.theme === 'dark' && s.checked === 'dark', `Dark goes to 21.5 under a clear sky (${s.hour}, ${s.weather}), the page dark (${s.theme}), kept (vx-sky ${s.kept.sky}, vx-theme ${s.kept.theme})`)
    await panel(page, phone, false); await still(page)
    await page.screenshot({ timeout: 90_000, path: join(shots, `${size}-dark.png`) })
    await choose(page, phone, 'light')
    const light = await until(page, () => { const e = globalThis.engine; return e.realmControls.modes.showing === 'light' && Math.abs(e.hour - 17.25) < 0.02 && !e.realmControls.sky.moving }, null, 40_000)
    s = await state(page)
    check(light && s.weather === 'clear' && s.kept.sky === 'light' && s.kept.theme === 'light' && s.theme === 'light' && s.checked === 'light', `Light goes to 17.25 (${s.hour}), the page light (${s.theme}), kept (${s.kept.sky}, ${s.kept.theme})`)
    await panel(page, phone, false); await still(page)
    await page.screenshot({ timeout: 90_000, path: join(shots, `${size}-light.png`) })

    // ── SF now, tonight: the full moon ──
    report = { clouds: ['CLR'], present: [], ceiling: null, visibility: 16093 }
    await choose(page, phone, 'sf')
    const h = sfHour(TONIGHT), sky = heavens(TONIGHT)
    const sfTonight = await settledAt(page, h)
    s = await state(page)
    check(sfTonight && s.weather === 'clear' && s.real === 'clear' && s.kept.sky === 'sf' && s.kept.theme === null && s.checked === 'sf', `SF now at 22:20 takes the clock (${s.hour?.toFixed(2)}, ${h.toFixed(2)}) and the report's weather (${s.weather}), and comes round to the real sky (${s.settled}); kept as sf, the blog's night let go (${s.kept.theme})`)
    check(s.moon.disc === 1 && angle(s.sun, sky.moon) < 0.5 && s.day < 0.01 && s.theme === 'dark', `lit by the full moon: its disc phased (${s.moon.disc}), drawn where the almanac has it (${angle(s.sun, sky.moon).toFixed(2)} degrees off), lit ${s.moon.light.toFixed(2)}, the page dark (${s.theme})`)
    await panel(page, phone, false); await still(page)
    await page.screenshot({ timeout: 90_000, path: join(shots, `${size}-sf-tonight.png`) })
    if (!phone) { await look(page, sky.moon); await still(page); await page.screenshot({ timeout: 90_000, path: join(shots, `${size}-sf-tonight-moon.png`) }) }

    // ── The fader and a weather key let go; SF now takes it back ──
    await panel(page, phone, true)
    await press(page, phone, `#realm .weather label:has(input[value=fog])`)
    await page.waitForTimeout(500)
    s = await state(page)
    check(s.showing === null && s.checked === null && s.weather === 'fog', `a weather key lets go of SF now (showing ${s.showing}, Sky key ${s.checked}, ${s.weather})`)
    await choose(page, phone, 'sf')
    check(await settledAt(page, h), 'SF now again takes the sky back')
    if (!phone) {
      const [fx, fy] = await middle(page, '#realm .sky .vx-slider')
      await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx - 60, fy, { steps: 6 }); await page.mouse.up()
      await page.waitForTimeout(500)
      s = await state(page)
      check(s.showing === null && s.checked === null && !near(s.hour, h, 0.1), `the fader lets go of SF now (showing ${s.showing}, the hour ${s.hour?.toFixed(2)})`)
      await choose(page, phone, 'sf')
      check(await settledAt(page, h), 'and SF now again takes it back')
    }
    await panel(page, phone, false)

    // ── The eggs take the sky and give it back ──
    await page.evaluate(() => globalThis.engine.eggs.say('wake up neo'))
    const inMatrix = await until(page, () => globalThis.engine.eggs.state.running === 'matrix' && globalThis.engine.realmControls.modes.showing === null, null)
    check(inMatrix, 'the Matrix takes the sky (SF now stands aside)')
    await page.waitForTimeout(3000)
    await page.evaluate(() => globalThis.engine.eggs.say('blue pill'))
    const outMatrix = await settledAt(page, h, 90_000)
    s = await state(page)
    check(outMatrix && s.weather === 'clear' && s.moon.disc === 1 && angle(s.sun, sky.moon) < 0.5, `once it ends, SF now has the sky again and comes round to it (${s.showing}, ${s.hour?.toFixed(2)}, ${s.weather}, ${angle(s.sun, sky.moon).toFixed(2)} degrees off the moon)`)
    await page.evaluate(() => globalThis.engine.eggs.say('moon'))
    const moonEgg = await until(page, () => globalThis.engine.realmControls.modes.showing === null && Math.abs(globalThis.engine.hour - 23.5) < 0.05, null)
    check(moonEgg, 'the moon egg takes the sky to its own night')
    await page.evaluate(() => globalThis.engine.eggs.undo())
    check(await settledAt(page, h, 90_000), 'and once undone, SF now has it again')

    // ── A choice made while an egg runs is still the choice once it ends; a change on the way to an hour is the visitor's ──
    await page.evaluate(() => globalThis.engine.eggs.say('wake up neo'))
    await until(page, () => globalThis.engine.eggs.state.running === 'matrix', null)
    await page.waitForTimeout(2000)
    // (Through the panel's owner: the Matrix's player may stand over the panel's keys on a small screen.)
    await page.evaluate(() => globalThis.engine.realmControls.modes.choose('light'))
    await page.evaluate(() => globalThis.engine.eggs.say('blue pill'))
    await until(page, () => globalThis.engine.eggs.state.running === null, null)
    await page.waitForTimeout(8000)
    s = await state(page)
    check(s.showing === 'light' && near(s.hour, 17.25) && s.weather === 'clear', `Light chosen in the Matrix is still the sky once it ends (showing ${s.showing}, ${s.hour?.toFixed(2)}, ${s.weather})`)
    await choose(page, phone, 'dark')
    await page.evaluate(() => { globalThis.engine.hour = globalThis.engine.hour + 0.5 })
    await page.waitForTimeout(3000)
    s = await state(page)
    check(s.showing === null && s.checked === null, `an hour set while Dark is on its way is the visitor's (showing ${s.showing}, Sky key ${s.checked}, ${s.hour?.toFixed(2)})`)
    await choose(page, phone, 'sf')
    check(await settledAt(page, h), 'SF now again')
    await panel(page, phone, false)

    // ── A reload keeps SF now ──
    await page.reload({ waitUntil: 'commit' })
    await ready(page)
    check(await settledAt(page, h), 'after a reload SF now is still chosen, and comes round to the real sky')
    await context.close()

    // ── The address's hour wins over the kept choice ──
    {
      const { context, page } = await open(size, TONIGHT, { kept: { 'vx-sky': 'sf' }, query: '?hour=12' })
      await page.waitForTimeout(3000)
      const p = await state(page)
      check(p.hour === 12 && p.showing === null && p.mode === 'sf', `?hour=12 keeps its hour (${p.hour}) over a kept SF now (showing ${p.showing})`)
      await context.close()
    }
    if (phone) continue

    // ── A crescent after sunset, noon, and a failed service (desk) ──
    {
      const { context, page } = await open(size, CRESCENT, { kept: { 'vx-sky': 'sf' } })
      const c = heavens(CRESCENT), there = await settledAt(page, sfHour(CRESCENT)), p = await state(page)
      check(there && p.moon.disc === 1 && angle(p.sun, c.moon) < 0.5 && near(p.moon.light, 0.55 + 0.45 * c.lit, 0.01), `17:30 on 12 November: lit by a crescent (${(c.lit * 100).toFixed(0)}% lit, light ${p.moon.light.toFixed(2)}) where the almanac has it (${angle(p.sun, c.moon).toFixed(2)} degrees off), the page ${p.theme}`)
      await still(page)
      await page.screenshot({ timeout: 90_000, path: join(shots, 'desk-sf-crescent.png') })
      await look(page, c.moon); await still(page)
      await page.screenshot({ timeout: 90_000, path: join(shots, 'desk-sf-crescent-moon.png') })
      await context.close()
    }
    {
      report = { clouds: ['FEW', 'SCT'], present: [], ceiling: null, visibility: 16093 }
      const { context, page } = await open(size, NOON, { kept: { 'vx-sky': 'sf' } })
      const n = heavens(NOON), there = await settledAt(page, 12), p = await state(page)
      check(there && p.moon.disc === -1 && p.day > 0.99 && angle(p.sun, n.sun) < 0.5 && p.theme !== 'dark', `noon: lit by the sun where the almanac has it (${angle(p.sun, n.sun).toFixed(2)} degrees off), no moon drawn (${p.moon.disc}), the page light (${p.theme})`)
      await still(page)
      await page.screenshot({ timeout: 90_000, path: join(shots, 'desk-sf-noon.png') })
      await context.close()
    }
    {
      report = null
      const { context, page, notes } = await open(size, NOON, { kept: { 'vx-sky': 'sf' } })
      const there = await settledAt(page, 12), p = await state(page)
      check(there && p.real === null && p.weather === 'clear' && notes.some((n) => /weather did not come/.test(n)), `a failed weather service leaves the weather as it was (${p.weather}), the clock and sun still the city's, and says so in the console`)
      await context.close()
      report = { clouds: ['CLR'], present: [], ceiling: null, visibility: 16093 }
    }
    void notes
  }
  check(errors.length === 0, `no errors on any page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) { console.log(`  FAIL ${e.message.split('\n')[0]}`); failures.push(e.message.split('\n')[0]) } finally { await browser.close(); site.stop(); back() }
console.log(`(the weather asked ${asked} times)`)
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
