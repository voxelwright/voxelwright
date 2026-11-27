// Touch driving schemes (#140) in the San Francisco realm, on a phone on its side (844 x 390 with an iPhone's safe area)
// in Chrome with WebGPU, by real touches (CDP's touch events, which the page hears as touch pointers). A car is got into
// on the roof and driven by each scheme, read where the page tells the car (`engine.alive.wheelDrive`: what it was told
// this frame, before the core eases it):
//   - what was kept and is not a record is the default (arrows and pedals), and what is set is kept over a reload;
//   - a drag on the left half of the picture turns the head and never drives (#75's stick drove up and down);
//   - arrows steer, and a thumb slid from one arrow to the other without lifting steers the other way;
//   - Gas held drives, and a cancelled touch or the window losing focus lets it go;
//   - auto gas waits for a touch, stops while Settings is open, and waits again after;
//   - the Controls sheet (Settings, Controls…) changes the keys behind it, and nothing drives while it is open;
//   - the wheel turned clockwise steers right and comes back when let go;
//   - the slide steers across only, and goes to the other half for the left-handed;
//   - tilt: refused, the arrows steer and the sheet says why; given, the phone turned clockwise steers right, Center
//     tilt makes how it is held straight ahead, and the brake is under the left thumb; with no sensor, the arrows;
//   - getting off puts every key away and gives the stick back to the feet.
// Every scheme's keys are kit keys 44 px or more that a touch at their middle reaches, clear of the safe area and of
// each other, and a picture of each is kept.
//
//   node test/sf-drive-touch.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/drive-touch]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'drive-touch'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch(CHROME)
const SAFE = { top: 0, bottom: 21, left: 59, right: 59 }
const until = (page, what, arg, ms = 5000) => page.waitForFunction(what, arg, { timeout: ms }).then(() => true, () => false)

try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  // (Once: a kept value that is not a record, as a broken write would leave.)
  await context.addInitScript(() => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('vw.drive-touch.v1', '{not json') } })
  const errors = []
  // (A page and its CDP session: a second one, in the same context and so the same storage, stands for a reload.)
  let page, cdp
  const open = async () => {
    page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: SAFE })
  }
  await open()
  // Touches by id, each where it is: every event says all that are down, as a touch screen does.
  const down = new Map()
  const touch = async (type, id, x, y) => {
    if (type === 'touchEnd' || type === 'touchCancel') down.delete(id); else down.set(id, { x, y, id })
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [...down.values()] : [...down.values()] })
  }
  const told = () => page.evaluate(() => { const w = globalThis.engine.alive.wheelDrive; return w ? { steer: w.steer, throttle: w.throttle, brake: w.brake, handbrake: w.handbrake } : null })
  const settle = (ms = 250) => page.waitForTimeout(ms)
  const keys = () => page.evaluate(() => [...document.querySelectorAll('[data-panel="living"] .dt-cluster [data-act]')].filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((el) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y)
    return { act: el.dataset.act, x, y, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, reached: !!hit && el.contains(hit), kit: el.hasAttribute('data-vx-live') }
  }))
  const at = async (act) => (await keys()).find((k) => k.act === act)
  const set = (patch) => page.evaluate((p) => globalThis.engine.alive.touch.set(p), patch)
  /** The scheme's keys: kit keys 44 px or more, reached at their middles, in the safe area, none on another or on the rail. */
  const laid = async (name) => {
    await page.waitForFunction(() => [...document.querySelectorAll('[data-panel="living"] .dt-cluster [data-act]')].every((el) => el.hasAttribute('data-vx-live')), null, { timeout: 8000 }).catch(() => {})
    await settle(600)
    await page.screenshot({ path: join(shots, `${name}.png`) })
    const ks = await keys()
    const rail = await page.evaluate(() => [...document.querySelectorAll('[data-panel="living"] .drive-util .vx-button, [data-panel="drive-hud"], #minimap, #realm .fold')].filter((el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true })).map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, id: el.dataset.act || el.id || el.className } }))
    const meet = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const clash = []
    for (let i = 0; i < ks.length; i++) { for (let j = i + 1; j < ks.length; j++) if (meet(ks[i], ks[j])) clash.push(`${ks[i].act}/${ks[j].act}`); for (const r of rail) if (meet(ks[i], r)) clash.push(`${ks[i].act}/${r.id}`) }
    const bad = ks.filter((k) => k.w < 44 || k.h < 44 || !k.reached || !k.kit || k.left < SAFE.left || k.right > 844 - SAFE.right || k.bottom > 390 - SAFE.bottom)
    check(ks.length > 0 && !bad.length && !clash.length, `${name}: ${ks.map((k) => k.act).join(', ')} are kit keys 44 px or more, reached at their middles, in the safe area, none on another${bad.length ? `; not: ${bad.map((k) => `${k.act} ${Math.round(k.w)}x${Math.round(k.h)}${k.reached ? '' : ' unreached'}${k.kit ? '' : ' plain'}`).join(', ')}` : ''}${clash.length ? `; meeting: ${clash.join(', ')}` : ''}`)
    return ks
  }
  const enter = async () => {
    await page.goto(`${site.url}/sf/index.html`, { timeout: 180_000, waitUntil: 'commit' })
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.explore && globalThis.engine.playHud, null, { timeout: 300_000 })
    // (Street life off and kept off, as sf-hud.mjs does: a car stopping beside the body is not the point here.)
    await page.evaluate(() => { const st = globalThis.engine.street; if (st) { st.enabled = false; Object.defineProperty(st, 'enabled', { get: () => false, set() {}, configurable: true }) } globalThis.engine.scale = 0.75; void globalThis.engine.explore.go() })
    await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 90_000 })
    await settle(2500)
    const got = await page.evaluate(async () => {
      const e = globalThis.engine, f = e.me.feet.at.map(Math.round), thing = await e.alive.spawn(e.car([f[0], f[1] + 5, f[2] - 40]))
      if (!thing.alive) return false
      e.alive.mount(thing)
      return e.alive.riding === thing
    })
    check(got, 'a car is got into on the roof')
    await settle(2500)
  }

  await enter()
  const first = await page.evaluate(() => ({ ...globalThis.engine.alive.touch.settings }))
  check(first.steer === 'arrows' && first.gas === 'pedals' && first.hand === 'right', `a kept value that is not a record is the default: arrows and pedals, pedals on the right (${JSON.stringify(first)})`)
  await laid('arrows-pedals')

  // The left half of the picture: the head turns, the car is not driven.
  const yaw0 = await page.evaluate(() => globalThis.engine.pose.yaw)
  await touch('touchStart', 1, 250, 150)
  for (let i = 1; i <= 6; i++) { await touch('touchMove', 1, 250 + i * 6, 150 - i * 12); await settle(40) }
  const drag = await told()
  await touch('touchEnd', 1)
  const yaw1 = await page.evaluate(() => globalThis.engine.pose.yaw)
  check(drag && drag.throttle === 0 && drag.steer === 0, `a drag up the left half of the picture does not drive the car (told ${JSON.stringify(drag)})`)
  check(Math.abs(yaw1 - yaw0) > 0.01, `it turns the head instead (${(yaw1 - yaw0).toFixed(3)} rad)`)

  // Arrows, and a thumb slid from one to the other.
  let k = await keys()
  const L = k.find((x) => x.act === 'left'), R = k.find((x) => x.act === 'right')
  await touch('touchStart', 2, R.x, R.y); await settle()
  const right = await told()
  await touch('touchMove', 2, (L.x + R.x) / 2, R.y); await touch('touchMove', 2, L.x, L.y); await settle()
  const left = await told()
  const pressedLeft = await page.evaluate(() => document.querySelector('.dt-cluster [data-act="left"]').getAttribute('aria-pressed'))
  await touch('touchEnd', 2); await settle()
  const free = await told()
  check(right?.steer === 1 && left?.steer === -1 && pressedLeft === 'true' && free?.steer === 0, `Right steers right, a thumb slid onto Left steers left without lifting, let go steers straight (${right?.steer}, ${left?.steer}, ${free?.steer})`)

  // Gas, and what lets it go.
  const G = k.find((x) => x.act === 'gas')
  await touch('touchStart', 3, G.x, G.y); await settle(900)
  const going = await told(), kmh = await page.evaluate(() => globalThis.engine.alive.telemetry?.kmh ?? 0)
  await touch('touchCancel', 3); await settle()
  const cancelled = await told()
  check(going?.throttle === 1 && kmh > 2 && cancelled?.throttle === 0, `Gas held drives (${kmh.toFixed(1)} km/h), and a cancelled touch lets it go (${cancelled?.throttle})`)
  await touch('touchStart', 3, G.x, G.y); await settle()
  await page.evaluate(() => dispatchEvent(new Event('blur'))); await settle()
  const blurred = await told()
  await touch('touchEnd', 3); await settle()
  check(blurred?.throttle === 0, `the window losing focus lets Gas go (${blurred?.throttle})`)
  // Brake held at a stop backs up; drift and boost under the same thumb.
  const B = k.find((x) => x.act === 'brake'), D = k.find((x) => x.act === 'drift')
  await touch('touchStart', 3, B.x, B.y); await touch('touchStart', 4, D.x, D.y); await settle()
  const braking = await told()
  await touch('touchEnd', 3); await touch('touchEnd', 4); await settle()
  check(braking?.throttle === -1 && braking?.handbrake, `Brake (backing up at a stop) and Drift at once, two touches (${JSON.stringify(braking)})`)

  // Auto gas: waits for a touch, stops under Settings, waits again.
  await set({ gas: 'auto' })
  await laid('arrows-auto')
  await page.evaluate(() => { const e = globalThis.engine, c = e.alive.riding; e.alive.touch.show(false); e.alive.mount(null); e.alive.mount(c) })
  await settle(800)
  const idle = await told(), note = await page.evaluate(() => document.querySelector('[data-panel="drive-hud"] .dh-note')?.textContent)
  await touch('touchStart', 5, 600, 120); await touch('touchEnd', 5); await settle()
  const auto = await told()
  check(idle?.throttle === 0 && /touch to go/i.test(note ?? '') && auto?.throttle === 1, `auto gas waits for a touch ("${note}"), then drives (${idle?.throttle} then ${auto?.throttle})`)
  const fold = await page.evaluate(() => { const r = document.querySelector('#realm .fold').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  await touch('touchStart', 6, ...fold); await touch('touchEnd', 6); await settle(500)
  const underSettings = await told()
  check(await page.evaluate(() => document.querySelector('div#realm').classList.contains('open')) && underSettings?.throttle === 0, `with Settings open nothing drives (${underSettings?.throttle})`)

  await touch('touchStart', 6, ...fold); await touch('touchEnd', 6); await settle(600)
  const afterSettings = await told()
  check(afterSettings?.throttle === 0, `closed again, auto gas waits for a touch again (${afterSettings?.throttle})`)
  await touch('touchStart', 6, ...fold); await touch('touchEnd', 6); await settle(500)

  // The Controls sheet, from Settings.
  const ctl = await page.evaluate(() => { const b = document.querySelector('#realm .sky .controls'); if (!b || !b.checkVisibility()) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  check(!!ctl, 'Settings has Controls… by touch')
  if (ctl) { await touch('touchStart', 7, ...ctl); await touch('touchEnd', 7) }
  const opened = await until(page, () => document.querySelector('#drive-controls')?.open)
  check(opened, 'Controls… opens the sheet')
  await page.screenshot({ path: join(shots, 'sheet.png') })
  const pick = async (name, value) => { const r = await page.evaluate(([n, v]) => { const el = document.querySelector(`#drive-controls input[name="dc-${n}"][value="${v}"]`)?.closest('label'); const b = el?.getBoundingClientRect(); return b && [b.left + b.width / 2, b.top + b.height / 2] }, [name, value]); if (r) { await touch('touchStart', 8, ...r); await touch('touchEnd', 8); await settle(300) } return !!r }
  await pick('gas', 'pedals'); await pick('steer', 'wheel')
  const behind = await page.evaluate(() => ({ wheel: !!document.querySelector('.dt-cluster [data-act="wheel"]'), arrows: !!document.querySelector('.dt-cluster [data-act="left"]'), kept: JSON.parse(localStorage.getItem('vw.drive-touch.v1')).steer }))
  check(behind.wheel && !behind.arrows && behind.kept === 'wheel', `choosing Wheel in the sheet puts the wheel in place of the arrows behind it, and keeps it (${JSON.stringify(behind)})`)
  await page.evaluate(() => document.querySelector('#drive-controls .dc-done').click()); await settle(400)

  // The wheel.
  k = await laid('wheel-pedals')
  const W = k.find((x) => x.act === 'wheel'), rad = W.w * 0.38
  await touch('touchStart', 9, W.x, W.y - rad)
  for (let i = 1; i <= 8; i++) { const a = i * 0.11; await touch('touchMove', 9, W.x + Math.sin(a) * rad, W.y - Math.cos(a) * rad) }
  await settle()
  const wheel = await told()
  await touch('touchEnd', 9); await settle(500)
  const wheelBack = await told()
  check(wheel?.steer > 0.3 && wheelBack?.steer === 0, `the wheel turned clockwise steers right (${wheel?.steer?.toFixed(2)}), and let go comes back to the middle (${wheelBack?.steer})`)

  // The slide: across only; on the other half for the left-handed.
  await set({ steer: 'slide' }); await settle(400)
  await page.screenshot({ path: join(shots, 'slide-pedals.png') })
  await touch('touchStart', 10, 200, 250)
  for (let i = 1; i <= 5; i++) await touch('touchMove', 10, 200 + i * 10, 250 - i * 12)
  await settle()
  const slid = await told()
  await touch('touchEnd', 10)
  check(slid?.steer > 0.2 && slid?.throttle === 0, `a slide to the right steers right and up-and-down does nothing (${JSON.stringify(slid)})`)
  await set({ hand: 'left' }); await settle(400)
  k = await laid('slide-pedals-left-handed')
  const gasLeft = k.find((x) => x.act === 'gas')
  await touch('touchStart', 11, 650, 250); for (let i = 1; i <= 5; i++) await touch('touchMove', 11, 650 - i * 10, 250); await settle()
  const slidLeft = await told()
  await touch('touchEnd', 11)
  check(gasLeft && gasLeft.right < 422 && slidLeft?.steer < -0.2, `left-handed: the pedals are on the left and the slide on the right half steers (${slidLeft?.steer?.toFixed(2)})`)
  await set({ hand: 'right' })

  // Tilt: refused, given, no sensor.
  const orient = (beta, gamma) => page.evaluate(([b, g]) => dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: b, gamma: g, alpha: 0 })), [beta, gamma])
  const angle = await page.evaluate(() => screen.orientation?.angle ?? 0)
  // (A pose for a turn clockwise by `t` degrees, on its side with the phone's top to the left (90) or right (270), from the unit test's poses.)
  const poseFor = (t) => angle === 270 ? [-t, 90] : angle === 90 ? [t, -90] : [90 - t, t === 0 ? 0 : 90]
  await page.evaluate(() => { DeviceOrientationEvent.requestPermission = async () => 'denied' })
  await page.evaluate(() => globalThis.engine.alive.touch.open()); await settle(300)
  await pick('steer', 'tilt'); await settle(400)
  const refused = await page.evaluate(() => ({ tilt: globalThis.engine.alive.touch.tilt, steer: globalThis.engine.alive.touch.steer, words: document.querySelector('#drive-controls .dc-tilt .dc-note').textContent }))
  check(refused.tilt === 'denied' && refused.steer === 'arrows' && /refused/i.test(refused.words), `tilt refused: the arrows steer, and the sheet says why (${JSON.stringify(refused)})`)
  await page.screenshot({ path: join(shots, 'sheet-tilt-refused.png') })
  await page.evaluate(() => { DeviceOrientationEvent.requestPermission = async () => 'granted' })
  await pick('steer', 'arrows'); await pick('steer', 'tilt'); await settle(200)
  await orient(...poseFor(0)); await settle(200)
  const given = await page.evaluate(() => ({ tilt: globalThis.engine.alive.touch.tilt, steer: globalThis.engine.alive.touch.steer }))
  await page.evaluate(() => document.querySelector('#drive-controls .dc-done').click()); await settle(400)
  for (let i = 0; i < 6; i++) { await orient(...poseFor(20)); await settle(50) }
  const tiltRight = await told()
  for (let i = 0; i < 6; i++) { await orient(...poseFor(-20)); await settle(50) }
  const tiltLeft = await told()
  k = await laid('tilt-pedals')
  const brakeAt = k.find((x) => x.act === 'brake')
  check(given.tilt === 'live' && given.steer === 'tilt' && tiltRight?.steer > 0.5 && tiltLeft?.steer < -0.5 && brakeAt && brakeAt.right < 422, `tilt given (screen at ${angle}): turned 20 degrees clockwise steers right (${tiltRight?.steer?.toFixed(2)}), anticlockwise left (${tiltLeft?.steer?.toFixed(2)}), the brake under the left thumb`)
  for (let i = 0; i < 6; i++) { await orient(...poseFor(10)); await settle(50) }
  await page.evaluate(() => globalThis.engine.alive.touch.open()); await settle(200)
  await page.evaluate(() => document.querySelector('#drive-controls .dc-center').click())
  await page.evaluate(() => document.querySelector('#drive-controls .dc-done').click()); await settle(300)
  await orient(...poseFor(10)); await settle(150)
  const centred = await told()
  check(Math.abs(centred?.steer ?? 1) < 0.05, `Center tilt makes how the phone is held straight ahead (${centred?.steer?.toFixed(3)})`)
  // No sensor: nothing comes for a second and a half.
  await page.evaluate(() => { delete DeviceOrientationEvent.requestPermission; const e = globalThis.engine; e.alive.touch.set({ steer: 'arrows' }) })
  await page.evaluate(() => { const e = globalThis.engine, c = e.alive.riding; e.alive.mount(null); e.alive.mount(c) }); await settle(300)
  await set({ steer: 'tilt' }); await settle(2000)
  const none = await page.evaluate(() => ({ tilt: globalThis.engine.alive.touch.tilt, steer: globalThis.engine.alive.touch.steer }))
  check(none.tilt === 'none' && none.steer === 'arrows', `with no sensor the arrows steer (${JSON.stringify(none)})`)

  // Kept over a reload, then off: every key put away, the stick the feet's again.
  await set({ steer: 'wheel', gas: 'auto', size: 1.2 })
  await page.close()
  await open()
  await enter()
  const kept = await page.evaluate(() => ({ ...globalThis.engine.alive.touch.settings }))
  check(kept.steer === 'wheel' && kept.gas === 'auto' && kept.size === 1.2, `what was set is kept over a reload (${JSON.stringify(kept)})`)
  await laid('wheel-auto-large')
  await set({ steer: 'slide', gas: 'pedals', size: 1 })
  const leave = await page.evaluate(() => { const r = document.querySelector('[data-panel="living"] [data-act="leave"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  await touch('touchStart', 12, ...leave); await touch('touchEnd', 12)
  const off = await until(page, () => !globalThis.engine.alive.riding, null, 3000)
  await settle(500)
  const afoot = await page.evaluate(() => ({ keys: document.querySelectorAll('.dt-cluster').length, slide: document.documentElement.classList.contains('steer-slide') }))
  await touch('touchStart', 13, 200, 250); for (let i = 1; i <= 4; i++) await touch('touchMove', 13, 200, 250 - i * 15); await settle()
  const thumb = await page.evaluate(() => !!document.documentElement.classList.contains('thumb-down'))
  await touch('touchEnd', 13)
  check(off && afoot.keys === 0 && !afoot.slide && thumb, `Get off puts the keys away and the left half is the feet's stick again (${JSON.stringify({ off, ...afoot, thumb })})`)
  check(errors.length === 0, `no errors on the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
  await context.close()
} catch (e) {
  failures.push(String(e.stack ?? e))
} finally {
  await browser.close().catch(() => {})
  site.close?.()
  back()
}
console.log(`pictures in ${shots}`)
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('sf-drive-touch: ok')
process.exit(0)
