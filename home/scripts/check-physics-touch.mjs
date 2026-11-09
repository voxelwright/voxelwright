// Headless proof that the physics world answers a finger (#74), on a phone-sized touch screen
// (390x844, hasTouch) driven by real touch input (CDP Input.dispatchTouchEvent), so the page sees
// pointer events of type touch. With the pinball table chosen: a hold on the left half swings the left
// flipper, on the right half the right one, a swipe down and a hold on the plunger button fire the
// ball, none of it leaves the table or turns the view, and Done leaves it. Away from the table:
// a tap on the felt ball nudges it away from the viewer, a press-drag-release flings it the way the
// finger went, a tap on the wall moves nothing, a tap on an entry still chooses it, and a drag on
// empty floor still turns the view. Starts its own dev server (no villager host: nothing here talks).
// Usage: node scripts/check-physics-touch.mjs [--dev=5393] [--shots-dir=dir]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const shotsDir = opt('shots-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const devPort = Number(opt('dev') ?? 5393)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 400) ?? '')
}

const server = spawn('npx', ['vite', '--port', String(devPort), '--strictPort'], { cwd: homeDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
await new Promise((resolve, reject) => {
  let out = ''
  const timer = setTimeout(() => reject(new Error(`vite did not start: ${out.slice(-400)}`)), 30_000)
  server.stdout.on('data', (d) => (/Local:/.test((out += d)) ? (clearTimeout(timer), resolve()) : undefined))
  server.stderr.on('data', (d) => (out += d))
  server.on('exit', (code) => reject(new Error(`vite exited ${code}: ${out.slice(-400)}`)))
})
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
if (shotsDir) await mkdir(shotsDir, { recursive: true })

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?cam=iso&talk=off&build=0&q=low`)
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics, null, { timeout: 30_000 })
  await page.waitForFunction(() => window.village.physics.home.list().length > 0 && window.village.physics.stats().bodies > 50, null, { timeout: 30_000 })
  const wait = (ms) => page.waitForTimeout(ms)

  // Real touches: pointer events with pointerType 'touch'.
  const cdp = await context.newCDPSession(page)
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
  const tap = async (x, y, hold = 60) => {
    await touch('touchStart', [[x, y]])
    await wait(hold)
    await touch('touchEnd', [])
  }
  const drag = async (from, to, ms = 120, steps = 8) => {
    await touch('touchStart', [from])
    for (let i = 1; i <= steps; i++) {
      await wait(ms / steps)
      await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]])
    }
    await touch('touchEnd', [])
  }
  const world = (fn, arg) => page.evaluate(fn, arg)
  const thing = (key) => world((k) => window.village.physics.thing(k), key)
  const travelled = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
  const camera = () => world(() => window.village.kernel.root.get('stage').camera.position.toArray())
  const active = () => world(() => window.village.kernel.root.get('entries').active)
  // Where a thing is on the screen (CSS px), and what the first solid thing at that point is.
  const screenOf = (key) => world((k) => {
    const { camera, renderer } = window.village.kernel.root.get('stage')
    const [x, y, z] = window.village.physics.thing(k).position
    const p = camera.position.clone().set(x, y, z).project(camera)
    const r = renderer.domElement.getBoundingClientRect()
    const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height
    const hit = window.village.kernel.root.get('entries').probe(sx, sy)
    return { x: sx, y: sy, on: p.z < 1 && sx > 0 && sx < r.width && sy > 0 && sy < r.height, name: hit.hit?.object.name ?? null, entry: hit.entry }
  }, key)

  // ── The table, by finger ──
  await world(() => { window.village.physics.reset(); window.village.kernel.root.get('entries').choose('pinball') })
  await wait(1800)
  const table = await world(() => ({ playing: window.village.physics.playing(), active: window.village.kernel.root.get('entries').active, controls: getComputedStyle(document.querySelector('.village-table')).display, plunger: document.querySelector('.village-table .plunger').getBoundingClientRect().toJSON() }))
  check('Choosing the table shows its controls on the phone', table.playing === 'pinball' && table.active === 'pinball' && table.controls === 'block' && table.plunger.width > 40, table)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'touch-table.jpg'), quality: 88 })
  const eye = await camera()
  const flip = async (name, x) => {
    const before = await thing(`pinball/flipper-${name}`)
    await touch('touchStart', [[x, 640]])
    await wait(600)
    const held = await thing(`pinball/flipper-${name}`)
    const input = await world((n) => window.village.physics.engine.world.held(n), name)
    await touch('touchEnd', [])
    await wait(500)
    const after = await thing(`pinball/flipper-${name}`)
    return { moved: travelled(before.position, held.position), input, back: travelled(before.position, after.position) }
  }
  const left = await flip('left', 80)
  const right = await flip('right', 310)
  check('A hold on the left half swings the left flipper and lets it back down; the right half the right one', left.moved > 0.01 && left.input && left.back < 0.01 && right.moved > 0.01 && right.input && right.back < 0.01, { left, right })
  const bothHeld = await world(() => ({ left: window.village.physics.engine.world.held('left'), right: window.village.physics.engine.world.held('right') }))
  check('Both flippers are let go once the fingers lift', !bothHeld.left && !bothHeld.right, bothHeld)

  // A press the page loses (the window switched away mid-press) is let go, not held for good.
  await touch('touchStart', [[80, 640]])
  await wait(200)
  const lost = { before: await world(() => window.village.physics.engine.world.held('left')) }
  await world(() => window.dispatchEvent(new Event('blur')))
  lost.after = await world(() => window.village.physics.engine.world.held('left'))
  await touch('touchEnd', [])
  check('A press the window loses (blur) lets its flipper go', lost.before && !lost.after, lost)

  // A swipe down fires the plunger: the ball runs up the table.
  const shoot = async (fire) => {
    await world(() => window.village.physics.reset())
    await wait(300)
    const before = await thing('pinball/ball')
    await fire()
    await wait(900)
    const after = await thing('pinball/ball')
    return { before: before.local, after: after.local, plunger: await world(() => window.village.physics.engine.world.held('plunger')) }
  }
  const swipe = await shoot(() => drag([200, 360], [200, 520], 400))
  check('A swipe down pulls the plunger and lets it go on release: the ball is launched up the table', swipe.after[2] < swipe.before[2] - 0.1 && !swipe.plunger, swipe)
  const button = await world(() => { const r = document.querySelector('.village-table .plunger').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
  let heldPlunger = false
  const pull = await shoot(async () => {
    await touch('touchStart', [button])
    await wait(700)
    heldPlunger = await world(() => window.village.physics.engine.world.held('plunger'))
    await touch('touchEnd', [])
  })
  check('A hold on the plunger button pulls it and lets it go on release: the ball is launched', heldPlunger && pull.after[2] < pull.before[2] - 0.1 && !pull.plunger, pull)
  const stayed = await world(() => ({ active: window.village.kernel.root.get('entries').active, playing: window.village.physics.playing() }))
  const eyeAfter = await camera()
  check('None of it left the table or turned the view', stayed.active === 'pinball' && stayed.playing === 'pinball' && travelled(eye, eyeAfter) < 1e-3, { stayed, moved: travelled(eye, eyeAfter) })
  await tap(...(await world(() => { const r = document.querySelector('.village-table .done').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })))
  await wait(3500)
  const left_ = await world(() => ({ active: window.village.kernel.root.get('entries').active, playing: window.village.physics.playing(), controls: getComputedStyle(document.querySelector('.village-table')).display, held: ['left', 'right', 'plunger'].filter((n) => window.village.physics.engine.world.held(n)) }))
  check('Done leaves the table: controls gone, nothing held, no table in play', left_.active === null && left_.playing === null && left_.controls === 'none' && !left_.held.length, left_)

  // ── Poke and fling ──
  const eyeFree = await camera()
  const ball = 'house/felt-ball'
  // The phone's view frames part of the house: the ball is put on bare floor in the middle of what it shows.
  const bare = async () => {
    await world((k) => {
      const { renderer } = window.village.kernel.root.get('stage')
      const entries = window.village.kernel.root.get('entries')
      const r = renderer.domElement.getBoundingClientRect()
      for (let y = r.height * 0.5; y < r.height * 0.85; y += 12) for (let x = r.width * 0.3; x < r.width * 0.7; x += 12) {
        const p = entries.probe(x, y)
        if (p.hit && !p.entry && p.hit.point.y < 0.02) return window.village.physics.place(k, [p.hit.point.x, 0.07, p.hit.point.z])
      }
      return false
    }, ball)
    await world(() => window.village.physics.advance(1.5))
    return screenOf(ball)
  }
  let seen
  seen = await bare()
  check('The felt ball is under a finger on the phone screen', seen.on && seen.name === ball && seen.entry === null, seen)
  const away = await world(() => { const cam = window.village.kernel.root.get('stage').camera; const d = cam.getWorldDirection(cam.position.clone()); return [d.x, d.z] })
  const rightWay = await world(() => { const cam = window.village.kernel.root.get('stage').camera; const d = cam.position.clone().set(1, 0, 0).applyQuaternion(cam.quaternion); return [d.x, d.z] })
  const unit = (v) => v.map((x) => x / Math.hypot(...v))
  const settle = async () => { await world(() => window.village.physics.advance(2)); await wait(100) }

  // A tap nudges it away from the viewer, and lifts it a little.
  const at0 = await thing(ball)
  await tap(seen.x, seen.y)
  await wait(500)

  const poked = await thing(ball)
  const dir = unit([poked.position[0] - at0.position[0], poked.position[2] - at0.position[2]])
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
  check('A tap on the felt ball rolls it away from the viewer (along the camera ray)', travelled(poked.position, at0.position) > 0.03 && dot(dir, unit(away)) > 0.85, { moved: travelled(poked.position, at0.position), dot: dot(dir, unit(away)) })
  await settle()

  // A press, drag and release flings it the way the finger went (screen right here).
  seen = await bare()
  const before = await thing(ball)
  await drag([seen.x, seen.y], [seen.x + 90, seen.y], 120)
  await wait(500)
  const flung = await thing(ball)
  const flingDir = unit([flung.position[0] - before.position[0], flung.position[2] - before.position[2]])
  check('A press-drag-release flings the felt ball the way the finger went (screen right)', travelled(flung.position, before.position) > 0.1 && dot(flingDir, unit(rightWay)) > 0.8, { moved: travelled(flung.position, before.position), dot: dot(flingDir, unit(rightWay)) })
  check('Neither turned the view', travelled(eyeFree, await camera()) < 1e-3, { moved: travelled(eyeFree, await camera()) })
  await settle()

  // A drag that stops before the finger lifts puts it down: it is not thrown.
  seen = await bare()
  const still = await thing(ball)
  await touch('touchStart', [[seen.x, seen.y]])
  for (let i = 1; i <= 4; i++) { await wait(30); await touch('touchMove', [[seen.x + 12 * i, seen.y]]) }
  await wait(250)
  await touch('touchEnd', [])
  await wait(400)
  check('A drag held still before the finger lifts does not throw it', travelled((await thing(ball)).position, still.position) < 0.02, { moved: travelled((await thing(ball)).position, still.position) })

  // Walls and furniture are static: a tap on one moves nothing; an entry under the finger is still chosen.
  const bodies = () => world(() => Object.fromEntries(window.village.physics.engine.world.keys().filter((k) => window.village.physics.thing(k).motion === 'dynamic' && !k.startsWith('villager/')).map((k) => [k, window.village.physics.thing(k).position])))
  await settle()
  const before2 = await bodies()
  const solid = await world(() => {
    const { renderer } = window.village.kernel.root.get('stage')
    const entries = window.village.kernel.root.get('entries')
    const r = renderer.domElement.getBoundingClientRect()
    for (let y = r.height * 0.15; y < r.height * 0.9; y += 20) for (let x = 20; x < r.width; x += 20) {
      const p = entries.probe(x, y)
      if (p.hit && !p.entry && !p.hit.object.name.startsWith('house/') && !window.village.physics.thing(p.hit.object.name)) return { x, y, name: p.hit.object.name || p.hit.object.parent?.name || p.hit.object.type }
    }
    return null
  })
  if (solid) await tap(solid.x, solid.y)
  await wait(400)
  const after2 = await bodies()
  check('A tap on a wall or a piece of furniture moves nothing', solid && Object.keys(before2).every((k) => travelled(before2[k], after2[k]) < 0.01), { solid })
  const entry = await world(() => window.village.kernel.root.get('entries').list().find((e) => e.onScreen && e.id !== 'pinball'))
  let chose = null
  if (entry) {
    // Search outwards from the entry's centre for a point where the entries layer says it is the entry.
    const found = await world((id) => {
      const entries = window.village.kernel.root.get('entries')
      const e = entries.list().find((x) => x.id === id)
      for (let r = 0; r < 120; r += 6) for (let a = 0; a < 6.28; a += 0.5) { const x = e.x + Math.cos(a) * r, y = e.y + Math.sin(a) * r; if (entries.probe(x, y).entry === id) return { x, y } }
      return null
    }, entry.id)
    if (found) {
      await tap(found.x, found.y)
      await wait(300)
      chose = { id: entry.id, active: await active() }
    }
  }
  check('A tap on an entry still chooses it (not a poke)', chose && chose.active === chose.id, chose)
  await world(() => window.village.kernel.root.get('entries').back())
  await wait(1500)

  // The view still turns when the drag is on empty floor.
  const eyeTurn = await camera()
  const empty = await world(() => {
    const { renderer } = window.village.kernel.root.get('stage')
    const entries = window.village.kernel.root.get('entries')
    const r = renderer.domElement.getBoundingClientRect()
    for (let y = r.height * 0.2; y < r.height * 0.9; y += 20) for (let x = 40; x < r.width - 40; x += 20) {
      const p = entries.probe(x, y)
      if (p.hit && !p.entry && !window.village.physics.thing(p.hit.object.name)) return { x, y }
    }
    return null
  })
  await drag([empty.x, empty.y], [empty.x + 80, empty.y], 200)
  await wait(800)
  check('A drag that starts on nothing movable still turns the view', travelled(eyeTurn, await camera()) > 0.05, { moved: travelled(eyeTurn, await camera()), empty })
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'touch-home.jpg'), quality: 88 })
  check('No page errors', !errors.length, errors.slice(0, 5))
} catch (error) {
  check('the check ran to the end', false, String(error?.stack ?? error))
} finally {
  await browser.close().catch(() => {})
  await new Promise((resolve) => { server.once('exit', resolve); process.kill(-server.pid, 'SIGTERM') })
}
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ ok: !failed.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name) }, null, 1))
process.exit(failed.length ? 1 : 0)
