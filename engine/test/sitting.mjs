// A sitting (#367): someone plays the real page for a long while, and every frame is written down.
//
// The engine's aim is 60 frames a second. An average hides what a player feels, which is the long frame: so this
// keeps each frame's gap, what the page's own thread spent inside it, the raw parts of it (`engine.laps`), and where
// the feet and the eye were, under the name of what was being done. A long gap with a long time inside the frame is
// the page's code and the parts name it; a long gap with a short one is the GPU, the picture-size steer, or another
// thread drawing on this machine. Nothing is filmed while it measures (a recorder costs frames).
//
//   node test/sitting.mjs [--parts street,turns,far,...] [--out dir] [--size 1512x860] [--query 'shadows=0'] [--alone]
//
// Not one of `npm run check`'s: it takes as long as it plays and its numbers are this machine's at this hour.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, quiet, serve, still, turn } from './kit.mjs'

const out = resolve(arg('out', join(homedir(), '.village', 'engine', 'polish', 'sitting')))
mkdirSync(out, { recursive: true })
const [W, H] = arg('size', '1512x860').split('x').map(Number)
const wanted = arg('parts', 'street,turns,far').split(',')
const alone = has('alone')

/** In the page before anything of its own runs: every frame's gap and the time spent inside it, kept with where the body and the eye were. */
const recorder = () => {
  const N = 120_000, F = 13
  const rows = new Float32Array(N * F), long = [], names = ['start']
  let n = 0, label = 0, last = 0, turning = 0, burn = 0
  // Whether the eye is in something that stands (all but water and leaves), or within a cell of it sideways: the picture's near edge then cuts into it.
  const solid = (e, x, y, z) => { const k = e.kind(x, y, z) & 15; return k !== 0 && k !== 5 && k !== 13 }
  const inside = (e) => { const x = e.pose.x * 10, y = e.pose.y * 10, z = e.pose.z * 10; return solid(e, x, y, z) ? 2 : solid(e, x + 1, y, z) || solid(e, x - 1, y, z) || solid(e, x, y, z + 1) || solid(e, x, y, z - 1) || solid(e, x, y - 1, z) ? 1 : 0 }
  // What kept the page's thread busy outside its frames (a message from a worker or the world, a timer): tasks over 50 ms, as the browser says.
  const tasks = []
  try { new PerformanceObserver((list) => { for (const t of list.getEntries()) tasks.push({ at: t.startTime, ms: t.duration, label: names[label] }) }).observe({ type: 'longtask', buffered: true }) } catch { /* no such observer */ }
  const raf = globalThis.requestAnimationFrame.bind(globalThis)
  globalThis.requestAnimationFrame = (f) => raf((now) => {
    const t0 = performance.now()
    // Frames made slow on purpose (`slow`): the thread is kept busy so long before each.
    if (burn && f.name === 'frame') while (performance.now() - t0 < burn) { /* busy */ }
    f(now)
    const e = globalThis.engine
    // Only the page's own frame (it reads `engine.laps` as it goes): other callbacks are not frames of the picture.
    if (!e || !e.laps || f.name !== 'frame') return
    const cpu = performance.now() - t0, gap = last ? now - last : 0
    last = now
    if (turning) e.pose.yaw += turning * Math.min(0.05, gap / 1000)
    const feet = e.me.feet, s = e.world.stats
    if (n < N) rows.set([now, gap, cpu, label, feet ? feet.at[0] : NaN, feet ? feet.at[1] : NaN, feet ? feet.at[2] : NaN, e.pose.x * 10, e.pose.y * 10, e.pose.z * 10, e.pose.yaw, e.scale, inside(e)], n++ * F)
    if (gap > 25) long.push({ at: now, label: names[label], gap, cpu, laps: { ...e.laps }, wanted: s.wanted, stale: s.stale, scale: e.scale, gpu: e.gpuMs, through: e.windowMs, bodies: e.bodies, pieces: e.pieces?.(), sun: [e.march.sun.undrawn, e.march.sun.spoiled], dropping: e.dropping, portal: e.portal?.state ? { ...e.portal.state } : undefined, realm: e.realms?.here })
  })
  globalThis.sitting = {
    mark(name) { label = names.push(name) - 1 },
    turn(rate) { turning = rate },
    slow(ms) { burn = ms },
    peek(name) { const got = []; for (let i = 0; i < n; i++) if (names[rows[i * F + 3]] === name) got.push([rows[i * F] / 1000, rows[i * F + 4], rows[i * F + 5], rows[i * F + 6], rows[i * F + 7], rows[i * F + 8], rows[i * F + 9], rows[i * F + 12]]); return got },
    take() { const got = { rows: Array.from(rows.subarray(0, n * F)), long: long.splice(0), tasks: tasks.splice(0), names: [...names], F }; n = 0; return got },
  }
}

// --quiet: both of this machine's turns on the GPU are taken, so that no other thread's check draws meanwhile and the GPU's times are this page's own. For short runs only: the others wait.
const both = () => {}, done = has('quiet') ? await quiet() : await turn()
const world = join(out, `world-${Date.now()}.log`)
// --made file: a realm someone made before (its world file), copied here so that the sitting plays in a made realm with no model run. The portal part then leads there.
const realms = join(out, `realms-${Date.now()}`), made = arg('made', '')
if (made) { mkdirSync(realms, { recursive: true }); copyFileSync(resolve(made), join(realms, basename(made))) }
const other = made ? basename(made, '.log') : 'dusk'
const server = await serve('/dev/null', alone ? [] : ['--world', world, '--realms', realms])
const post = (path, body) => fetch(server.url + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json().catch(() => ({})))
const browser = await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(recorder)
await page.goto(`${server.url}/city?fly=0&${alone ? '' : 'shared=1&name=Ada&'}${arg('query', '')}`)
await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
await still(page, { sun: true })

const wait = (ms) => page.waitForTimeout(ms)
const keys = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await wait(ms); for (const c of codes) await page.keyboard.up(c) }
const turnBy = async (rate, ms) => { await page.evaluate((r) => globalThis.sitting.turn(r), rate); await wait(ms); await page.evaluate(() => globalThis.sitting.turn(0)) }
// A picture taken stops the page for half a second: those frames are under a name of their own and not counted.
let doing = 'start'
const mark = async (name) => { doing = name; await page.evaluate((name) => globalThis.sitting.mark(name), name) }
const shot = async (name) => { const was = doing; await mark('picture'); await page.screenshot({ path: join(out, `${name}.png`) }); await wait(300); await mark(was) }
/** Onto the feet on the street the page starts above, looking east along it. */
const down = async (x = 76, z = 408.3, yaw = Math.PI / 2) => {
  await page.evaluate(([x, z, yaw]) => { const e = globalThis.engine; if (e.me.on) e.me.walk(false); e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 2; e.pose.yaw = yaw; e.pose.pitch = -0.12; e.me.walk(true) }, [x, z, yaw])
  await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await wait(1500)
}

const parts = {
  // Standing, a walk, a run, jumps, stopping: on the start street.
  async street() {
    await down()
    await mark('stand'); await wait(4000)
    await shot('street-stand')
    await mark('walk'); await keys(['KeyW'], 6000)
    await mark('stop'); await wait(1500)
    await mark('run'); await keys(['ShiftLeft', 'KeyW'], 8000)
    await shot('street-run')
    await mark('stop'); await wait(1500)
    await mark('jump'); for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await wait(900) }
    await mark('run-jump'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); for (let i = 0; i < 4; i++) { await wait(700); await page.keyboard.press('Space') } await wait(700); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
    await mark('stop'); await wait(1500)
  },
  // The head turned while standing and while walking, aside and back.
  async turns() {
    await down()
    await mark('look-round'); await turnBy(1.6, 4000)
    await mark('walk-turn'); await page.keyboard.down('KeyW'); await turnBy(0.8, 5000); await turnBy(-0.8, 5000); await page.keyboard.up('KeyW')
    await mark('aside'); await keys(['KeyA'], 2000); await keys(['KeyD'], 2000); await keys(['KeyS'], 2000)
    await mark('run-turn'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await turnBy(1.2, 6000); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
    await shot('turns-end')
  },
  // A long run east along the street: new parts of the town come in as it goes.
  async far() {
    await down()
    await mark('far-run'); await keys(['ShiftLeft', 'KeyW'], 45_000)
    await shot('far-end')
    await mark('stop'); await wait(2000)
  },
}

/** The rows kept so far under one name, as [seconds, feet x, y, z, eye x, y, z]: for a part that says something of its own. */
const traced = async (name) => page.evaluate((name) => globalThis.sitting.peek(name), name)
const line = (what) => console.log(`  ${what}`)
// How the body answers: a start, a stop, a wall met at a slant, a kerb, a jump, a fall.
parts.body = async () => {
  await down()
  await mark('b-start'); await keys(['ShiftLeft', 'KeyW'], 3000)
  await mark('b-stop'); await wait(1500)
  let t = await traced('b-start'), v = t.map((r, i) => i ? Math.hypot(r[1] - t[i - 1][1], r[3] - t[i - 1][3]) / (r[0] - t[i - 1][0]) : 0)
  line(`a run from standing reaches 4 m/s in ${(t[v.findIndex((x) => x > 40)]?.[0] - t[0][0]).toFixed(2)} s, top ${(Math.max(...v) / 10).toFixed(2)} m/s`)
  t = await traced('b-stop'); v = t.map((r, i) => i ? Math.hypot(r[1] - t[i - 1][1], r[3] - t[i - 1][3]) / (r[0] - t[i - 1][0]) : 0)
  line(`let go at a run it stops in ${(t[v.findIndex((x, i) => i > 2 && x < 1)]?.[0] - t[0][0]).toFixed(2)} s and ${(Math.hypot(t.at(-1)[1] - t[0][1], t.at(-1)[3] - t[0][3]) / 10).toFixed(2)} m`)
  // A jump standing: how high, how long.
  await mark('b-jump'); await page.keyboard.press('Space'); await wait(1400)
  t = await traced('b-jump')
  const y0 = t[0][2], up = t.filter((r) => r[2] > y0 + 0.5)
  line(`a standing jump rises ${((Math.max(...t.map((r) => r[2])) - y0) / 10).toFixed(2)} m and is off the ground ${up.length ? (up.at(-1)[0] - up[0][0]).toFixed(2) : 0} s; lands ${(Math.min(...t.slice(-30).map((r) => r[2])) - y0).toFixed(1)} cells from where it rose`)
  // North off the road, over the kerb, at a slant into the house fronts, held there.
  await down(90, 408.3, 0.6)
  await mark('b-kerb-wall'); await keys(['KeyW'], 14000)
  t = await traced('b-kerb-wall')
  const dy = t.map((r, i) => i ? r[2] - t[i - 1][2] : 0), ey = t.map((r, i) => i ? r[5] - t[i - 1][5] : 0)
  line(`walking north-east 14 s: feet went ${((t.at(-1)[1] - t[0][1]) / 10).toFixed(1)} m east, ${((t[0][3] - t.at(-1)[3]) / 10).toFixed(1)} m north, ${((t.at(-1)[2] - t[0][2]) / 10).toFixed(2)} m up; biggest step of the feet in one frame ${Math.max(...dy.map(Math.abs)).toFixed(1)} cells, of the eye ${Math.max(...ey.map(Math.abs)).toFixed(1)} cells`)
  const lastSec = t.filter((r) => r[0] > t.at(-1)[0] - 3)
  line(`in its last 3 s (against whatever it met) it went ${(Math.hypot(lastSec.at(-1)[1] - lastSec[0][1], lastSec.at(-1)[3] - lastSec[0][3]) / 10).toFixed(2)} m (a free walk is 4.3 m)`)
  await shot('body-wall')
  writeFileSync(join(out, 'body-kerb-wall.json'), JSON.stringify(t))
}

// A window to another realm opened with P, walked through, walked about in, and walked back through.
parts.portal = async () => {
  if (!made) await post('/realms', { by: 'sitting', id: 'dusk', name: 'Dusk in the east', about: 'the east end, late', arrive: { at: [9660, 4070] }, look: { hour: 17.6, rain: 0.3 } })
  await down(70, 412.5, 0)
  await page.evaluate((id) => { globalThis.engine.realms.selected = id }, other)
  await mark('portal-opening'); await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.state.passable && globalThis.engine.portal.state.open >= 1, null, { timeout: 60_000 })
  await mark('portal-open'); await wait(3000)
  await shot('portal-open')
  const face = () => page.evaluate(() => { const e = globalThis.engine, g = e.portal.gate.at, f = e.me.feet.at; e.pose.yaw = Math.atan2(g[0] - f[0], -(g[2] - f[2])) })
  await face()
  await mark('portal-through'); await page.keyboard.down('KeyW')
  await page.waitForFunction((id) => globalThis.engine.realms.here === id, other, { timeout: 30_000 })
  await wait(1500)
  // There: on a little, the head turned round, a run and back to the window.
  await mark('there'); await wait(2500); await page.keyboard.up('KeyW')
  await turnBy(1.5, 2100)
  await keys(['ShiftLeft', 'KeyW'], 5000); await turnBy(1.6, 4000)
  await shot('portal-there')
  await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.state.passable, null, { timeout: 30_000 })
  await face()
  await mark('portal-back'); await page.keyboard.down('KeyW')
  // Not back through the window in half a minute (something stood in the way there): stepped home, and said.
  await page.waitForFunction(() => globalThis.engine.realms.here === 'home', null, { timeout: 30_000 }).catch(async () => { line('did not get back through the window on foot: stepped home'); await page.keyboard.up('KeyW'); await page.evaluate(() => globalThis.engine.realms.step('home')); await page.waitForFunction(() => globalThis.engine.realms.here === 'home', null, { timeout: 30_000 }) })
  await wait(2000); await page.keyboard.up('KeyW')
  await mark('portal-closing'); await page.keyboard.press('KeyP'); await wait(3000)
  line(`the steps through: ${JSON.stringify(await page.evaluate(() => globalThis.engine.portal.stats.steps))}`.slice(0, 400))
}
// A kart a rule brings: got on, driven up the street with turns, got off.
parts.ride = async () => {
  await post('/world/ask', { by: 'sitting', rule: { id: 'karts', name: 'A kart for whoever asks', source: `on('said', (world, e) => { if (/a kart for me/.test(e.text)) { world.thing('k', {like: 'kart', at: [e.at[0] + 30, e.at[2]], yaw: Math.PI / 2, colour: 2}); world.seat(e.by, {on: 'k'}) } })` } })
  await down(76, 408.3)
  await wait(1000)
  await mark('ride-on'); await page.evaluate(() => globalThis.engine.say('a kart for me'))
  await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 10_000 }).catch(() => line('never got on the kart'))
  await wait(1000)
  await shot('ride-on')
  await mark('ride-go'); await keys(['KeyW'], 5000)
  await mark('ride-turn'); await page.keyboard.down('KeyW'); await keys(['KeyD'], 1200); await keys(['KeyA'], 2400); await keys(['KeyD'], 1200); await page.keyboard.up('KeyW')
  await shot('ride-turn')
  await mark('ride-stop'); await wait(2000)
  await mark('ride-off'); await page.keyboard.press('KeyE'); await wait(2500)
  await shot('ride-off')
}

// A room a rule builds, with steps and a deck beside it: in by the doorway, the head turned all the way round inside, out again, up the steps, off the deck's end.
parts.room = async () => {
  const said = async (name) => { const t = await traced(name), eye = t.map((r, i) => i ? Math.hypot(r[4] - t[i - 1][4], r[5] - t[i - 1][5], r[6] - t[i - 1][6]) : 0), feet = t.map((r, i) => i ? Math.abs(r[2] - t[i - 1][2]) : 0); line(`${name}: feet went ${((t.at(-1)[1] - t[0][1]) / 10).toFixed(1)} m east, ${((t.at(-1)[3] - t[0][3]) / 10).toFixed(1)} m south, ${((t.at(-1)[2] - t[0][2]) / 10).toFixed(2)} m up; the eye in something ${t.filter((r) => r[7] === 2).length} of ${t.length} frames, beside it ${t.filter((r) => r[7] === 1).length}; biggest move in a frame: eye ${Math.max(...eye).toFixed(1)}, feet up or down ${Math.max(...feet).toFixed(1)} cells`); return t }
  await post('/world/ask', { by: 'sitting', rule: { id: 'builder', name: 'A room for whoever asks', source: `on('said', (world, e) => { if (/a room/.test(e.text)) world.build('room', { at: [e.at[0] + 60, e.at[2]], parts: [['room', 'wood', '2:6', 0, 0, -25, 50, 28, 25, '-x'], ['steps', 'wood', '2:8', 0, 0, 34, 40, 20, 50, '-x', 2], ['box', 'wood', '2:8', 40, 0, 34, 80, 20, 50]] }) })` } })
  await down(74, 408.3)
  await wait(800)
  await mark('room-built'); await page.evaluate(() => globalThis.engine.say('a room')); await wait(3000)
  await shot('room-built')
  await mark('room-in'); await keys(['KeyW'], 5500)
  await said('room-in')
  await mark('room-round'); await turnBy(1.6, 4200)
  await said('room-round')
  await shot('room-inside')
  await page.evaluate(() => { globalThis.engine.pose.yaw = -Math.PI / 2 })
  await mark('room-out'); await keys(['KeyW'], 6500)
  await said('room-out')
  // Round to the foot of the steps (south of the room), and up them.
  await page.evaluate(() => { globalThis.engine.pose.yaw = Math.PI }); await keys(['KeyW'], 3200)
  await page.evaluate(() => { globalThis.engine.pose.yaw = Math.PI / 2 })
  await mark('steps-up'); await keys(['KeyW'], 7000)
  await said('steps-up')
  await shot('steps-top')
  await mark('deck-off'); await keys(['ShiftLeft', 'KeyW'], 2500); await wait(1200)
  await said('deck-off')
}
// Thrown at, pushed and put on the ground by a rule: what the eye does.
parts.fight = async () => {
  await post('/world/ask', { by: 'sitting', rule: { id: 'pitcher', name: 'A pitcher', source: `on('start', (world) => world.actor('pitcher', {name: 'Bea', at: [800, 4083]}))\non('said', (world, e) => { if (/throw at me/.test(e.text)) world.throw({from: 'pitcher', at: e.by, speed: 250, size: 2, material: 'wood'}); if (/push me/.test(e.text)) world.push(e.by, {to: [0, 0.4, 1], speed: 90}); if (/down/.test(e.text)) world.down(e.by, {for: 2.5}) })` } })
  await down(76, 408.3)
  await wait(1500)
  for (const [name, words, ms] of [['fight-thrown-at', 'throw at me', 2500], ['fight-thrown-at', 'throw at me', 2500], ['fight-pushed', 'push me', 3000], ['fight-down', 'down', 4000]]) {
    await mark(name); await page.evaluate((w) => globalThis.engine.say(w), words); await wait(ms)
    const t = await traced(name), eye = t.map((r, i) => i ? Math.hypot(r[4] - t[i - 1][4], r[5] - t[i - 1][5], r[6] - t[i - 1][6]) : 0)
    line(`${name}: the feet were moved ${(Math.hypot(t.at(-1)[1] - t[0][1], t.at(-1)[3] - t[0][3]) / 10).toFixed(1)} m; the eye's biggest move in a frame ${Math.max(...eye).toFixed(1)} cells; in something ${t.filter((r) => r[7] === 2).length} of ${t.length} frames`)
  }
  await shot('fight-end')
}
// Falling from 30 m, and flying: up, along, and down again.
parts.air = async () => {
  await page.evaluate(() => { const e = globalThis.engine; if (e.me.on) e.me.walk(false); e.pose.x = 76; e.pose.z = 408.3; e.pose.y = e.ground(76, 408.3) + 30; e.pose.yaw = Math.PI / 2; e.pose.pitch = -0.3 })
  await mark('fall'); await page.evaluate(() => globalThis.engine.me.walk(true)); await wait(4500)
  let t = await traced('fall'), eye = t.map((r, i) => i ? Math.hypot(r[4] - t[i - 1][4], r[5] - t[i - 1][5], r[6] - t[i - 1][6]) : 0)
  const landed = t.findIndex((r, i) => i > 5 && Math.abs(r[2] - t.at(-1)[2]) < 1)
  line(`a fall of ${((t[0][5] - t.at(-1)[5]) / 10).toFixed(1)} m takes ${(t[landed][0] - t[0][0]).toFixed(2)} s; the eye's biggest move in a frame ${Math.max(...eye).toFixed(1)} cells (${(Math.max(...eye) * 6).toFixed(0)} m/s at 60 frames a second)`)
  await page.evaluate(() => { globalThis.engine.me.can = { fly: 60 } })
  await mark('fly-up'); await keys(['Space'], 3000)
  await mark('fly-along'); await keys(['KeyW', 'ShiftLeft'], 4000)
  await shot('flying')
  await mark('fly-down'); await keys(['KeyC'], 5000)
  for (const name of ['fly-up', 'fly-along', 'fly-down']) { t = await traced(name); eye = t.map((r, i) => i ? Math.hypot(r[4] - t[i - 1][4], r[5] - t[i - 1][5], r[6] - t[i - 1][6]) : 0); line(`${name}: feet went ${(Math.hypot(t.at(-1)[1] - t[0][1], t.at(-1)[3] - t[0][3]) / 10).toFixed(1)} m along, ${((t.at(-1)[2] - t[0][2]) / 10).toFixed(1)} m up; the eye's biggest move in a frame ${Math.max(...eye).toFixed(1)} cells; in something ${t.filter((r) => r[7] === 2).length} of ${t.length} frames`) }
  await page.evaluate(() => { globalThis.engine.me.can = {} })
}
// The picture's size when the view is suddenly dear: the ground at one's feet looked at until the picture has grown, then the long street at once, as a turn of the head does.
parts.steer = async () => {
  await down()
  for (let i = 0; i < 3; i++) {
    await mark('cheap'); await page.evaluate(() => { globalThis.engine.pose.pitch = -1.5 }); await wait(7000)
    const big = await page.evaluate(() => globalThis.engine.scale)
    await mark('cheap-to-dear'); await page.evaluate(() => { globalThis.engine.pose.pitch = -0.05 }); await wait(4000)
    line(`looking at the ground the picture grew to ${big.toFixed(2)} of full size; looking up along the street at once, ${await page.evaluate(() => globalThis.engine.scale.toFixed(2))} four seconds on`)
  }
}
// Slow frames: the same run with the page's thread kept busy 30 and 60 ms a frame. The body should get as far.
parts.slow = async () => {
  for (const ms of [0, 30, 60]) {
    await down()
    await page.evaluate((ms) => globalThis.sitting.slow(ms), ms)
    await wait(500)
    await mark(`run-busy-${ms}`); await keys(['ShiftLeft', 'KeyW'], 4000)
    await page.evaluate(() => globalThis.sitting.slow(0))
    const t = await traced(`run-busy-${ms}`)
    line(`kept busy ${ms} ms a frame (${(t.length / 4).toFixed(0)} frames a second), a four-second run goes ${(Math.hypot(t.at(-1)[1] - t[0][1], t.at(-1)[3] - t[0][3]) / 10).toFixed(1)} m`)
    await wait(800)
  }
}
// The eye: with one's back to a house front and the head turned all the way round, on foot and then in a kart.
parts.eye = async () => {
  const said = async (name) => { const t = await traced(name), eye = t.map((r, i) => i ? Math.hypot(r[4] - t[i - 1][4], r[5] - t[i - 1][5], r[6] - t[i - 1][6]) : 0); line(`${name}: the eye was in something that stands for ${t.filter((r) => r[7] === 2).length} of ${t.length} frames and within a cell of it for ${t.filter((r) => r[7] === 1).length}; its biggest move in one frame ${Math.max(...eye).toFixed(1)} cells`) }
  await down(90, 408.3, 0)
  await keys(['KeyW'], 7000)
  await mark('eye-afoot-round'); await turnBy(1.6, 4200)
  await said('eye-afoot-round')
  await shot('eye-afoot')
  await mark('eye-afoot-along'); await page.evaluate(() => { globalThis.engine.pose.yaw = Math.PI / 2 }); await keys(['ShiftLeft', 'KeyW'], 5000)
  await said('eye-afoot-along')
  await post('/world/ask', { by: 'sitting', rule: { id: 'karts', name: 'A kart for whoever asks', source: `on('said', (world, e) => { if (/a kart for me/.test(e.text)) { world.thing('k', {like: 'kart', at: [e.at[0] + 30, e.at[2]], yaw: Math.PI / 2, colour: 2}); world.seat(e.by, {on: 'k'}) } })` } })
  await wait(1000)
  await page.evaluate(() => globalThis.engine.say('a kart for me'))
  await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 10_000 }).catch(() => line('never got on the kart'))
  await wait(1500)
  await mark('eye-riding-round'); await turnBy(1.6, 4200)
  await said('eye-riding-round')
  await page.evaluate(() => { globalThis.engine.pose.yaw += Math.PI / 2 }); await wait(400)
  await shot('eye-riding')
  await mark('eye-riding-go'); await keys(['KeyW'], 4000)
  await said('eye-riding-go')
  await page.keyboard.press('KeyE'); await wait(1000)
}

const all = { rows: [], long: [], names: null, F: 13 }
// --minutes n: the parts are played round again until so long has been played.
const until = Date.now() + Number(arg('minutes', 0)) * 60_000, list = [...wanted]
for (let i = 0; i < list.length; i++) {
  const name = list[i]
  if (i === list.length - 1 && Date.now() < until) list.push(...wanted)
  if (!parts[name]) { console.log(`no part called ${name}`); continue }
  // How quiet the GPU is as the part begins: a fixed piece of work that is none of the engine's (1.4 ms on this Mac when nothing else draws).
  await mark('picture'); const fixed = await page.evaluate(() => globalThis.engine.quiet()); await wait(200)
  // (1.44 ms at 2560 x 1440 when the bench's baseline was kept; it goes with the canvas's pixels.)
  const calm = 1.44 * (W * H * 4) / (2560 * 1440)
  console.log(`part: ${name}${fixed > calm * 1.3 ? `   (the GPU is busy with something else: its fixed work took ${fixed.toFixed(1)} ms, ${calm.toFixed(1)} when quiet; this part's frame times are not this page's alone)` : ''}`)
  await parts[name]().catch((e) => console.log(`  the part ${name} did not finish: ${String(e).slice(0, 200)}`))
  for (const code of ['KeyW', 'ShiftLeft', 'KeyA', 'KeyD', 'Space', 'KeyC']) await page.keyboard.up(code)
  const got = await page.evaluate(() => globalThis.sitting.take())
  all.rows.push(...got.rows); all.long.push(...got.long); (all.tasks ??= []).push(...got.tasks); all.names = got.names; all.F = got.F
}
await browser.close(); server.stop(); done(); both()

// What it was like, by what was being done.
const F = 13, by = new Map()
for (let i = 0; i < all.rows.length; i += F) {
  const name = all.names[all.rows[i + 3]]
  if (!by.has(name)) by.set(name, [])
  by.get(name).push(all.rows.slice(i, i + F))
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
console.log('\nwhat                frames   p50    p95    p99  worst  >20ms >33ms  cpu p95  feet m/s  uneven  eye uneven  scale')
for (const [name, rows] of by) {
  if (name === 'start' || name === 'picture') continue
  const gaps = rows.map((r) => r[1]).filter((g) => g > 0).sort((a, b) => a - b), cpus = rows.map((r) => r[2]).sort((a, b) => a - b)
  // How even the going is: the speed of the feet (and of the eye) from one frame to the next, as its spread over its mean. A steady walk is near 0.
  const speeds = (a) => { const v = []; for (let i = 1; i < rows.length; i++) { const dt = rows[i][1] / 1000; if (dt > 0 && Number.isFinite(rows[i][a]) && Number.isFinite(rows[i - 1][a])) v.push(Math.hypot(rows[i][a] - rows[i - 1][a], rows[i][a + 2] - rows[i - 1][a + 2]) / dt) } return v }
  const spread = (v) => { if (v.length < 2) return [0, 0]; const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / (m || 1)] }
  const [fm, fs] = spread(speeds(4)), [, es] = spread(speeds(7))
  console.log(`${name.padEnd(18)} ${String(gaps.length).padStart(7)} ${pct(gaps, 0.5).toFixed(1).padStart(6)} ${pct(gaps, 0.95).toFixed(1).padStart(6)} ${pct(gaps, 0.99).toFixed(1).padStart(6)} ${gaps.at(-1).toFixed(1).padStart(6)} ${String(gaps.filter((g) => g > 20).length).padStart(6)} ${String(gaps.filter((g) => g > 33.4).length).padStart(5)} ${pct(cpus, 0.95).toFixed(1).padStart(8)} ${(fm / 10).toFixed(2).padStart(9)} ${fs.toFixed(2).padStart(7)} ${es.toFixed(2).padStart(11)} ${rows.at(-1)[11].toFixed(2).padStart(6)}`)
}
all.long = all.long.filter((l) => l.label !== 'start' && l.label !== 'picture')
const worst = [...all.long].sort((a, b) => b.gap - a.gap).slice(0, 25)
console.log(`\nframes over 25 ms: ${all.long.length}; over 33.4 ms: ${all.long.filter((l) => l.gap > 33.4).length}. The longest:`)
for (const l of worst) {
  const top = Object.entries(l.laps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')
  console.log(`  ${l.gap.toFixed(0).padStart(4)} ms in ${l.label.padEnd(12)} inside the frame ${l.cpu.toFixed(1)} ms (${top}); making ${l.wanted}, stale ${l.stale}, picture ${l.scale.toFixed(2)}, bodies ${l.bodies}, pieces ${l.pieces}, sun tiles to draw ${l.sun}, march ${l.gpu.toFixed(1)} ms${l.through ? ` (${l.through.toFixed(1)} of it through a window)` : ''}${l.portal ? `, portal ${JSON.stringify(l.portal)}` : ''}`)
}
let sized = 0
for (let i = F; i < all.rows.length; i += F) if (all.rows[i + 11] !== all.rows[i - F + 11] && all.names[all.rows[i + 3]] !== 'start') sized++
console.log(`the picture changed size ${sized} times in ${(all.rows.length / F / 3600).toFixed(1)} minutes of frames`)
const busy = (all.tasks ?? []).filter((t) => t.label !== 'start' && t.label !== 'picture')
if (busy.length) console.log(`\nthe page's thread was kept busy over 50 ms outside its frames ${busy.length} times: ${busy.slice(0, 12).map((t) => `${t.ms.toFixed(0)} ms in ${t.label}`).join(', ')}`)
writeFileSync(join(out, `sitting-${Date.now()}.json`), JSON.stringify(all))
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`)
console.log(`kept in ${out}`)
process.exit(0)
