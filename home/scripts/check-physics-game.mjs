// Headless proof that the pinball table is a game (#108), made of logic parts wired as data
// (counter, game, lamp) with no pinball code. A pull of the plunger starts a round; each ball put
// back counts one off three and puts a lamp out; a ball bouncing in the drain costs one ball, not
// two; the third ends the round once, with the score, as an event anyone can read; the next pull
// starts a new round with a clear board. Reset and a snapshot put the game back with the rest. The
// logic parts keep the engine's promise about loops of wires, and a toy with lamps leaves nothing
// behind. On a phone-sized touch screen a held plunger button starts a round. Starts its own dev
// server (no villager host: nothing here talks).
// Usage: node scripts/check-physics-game.mjs [--dev=5394] [--shots-dir=dir]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const shotsDir = opt('shots-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const devPort = Number(opt('dev') ?? 5394)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 500) ?? '')
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
  await page.waitForFunction(() => window.village.physics.stats().bodies > 50, null, { timeout: 30_000 })

  // Helpers in the page: the game as its parts say it, a pull of the plunger, and a ball put in the drain.
  await page.evaluate(() => {
    const p = window.village.physics
    const lit = (key) => p.engine.world.keys().includes(key) && window.village.kernel.root.get('stage').scene.getObjectByName(key).material.emissiveIntensity > 0
    window.game = {
      state: () => ({
        score: p.counters()['pinball/score'], balls: p.counters()['pinball/balls'],
        lamps: [1, 2, 3].map((n) => lit(`pinball/life-${n}`)), over: lit('pinball/over'),
        fired: Object.fromEntries(['started', 'lost', 'won'].map((port) => [port, p.signals()[`pinball/game.${port}`] ?? 0])),
      }),
      pull(hold = 0.5) {
        p.input('plunger', true)
        p.advance(hold)
        p.input('plunger', false)
        p.advance(0.3)
      },
      /** The ball dropped just above the drain, then time for it to be put back in the lane. */
      drain(after = 1) {
        p.place('pinball/ball', [-0.025, 0.0136, 0.47])
        p.advance(after)
      },
      lit,
    }
  })
  const game = (fn, arg) => page.evaluate(fn, arg)

  // ── A round, from the first pull to the last ball ──
  const fresh = await game(() => { window.village.physics.reset(); return window.game.state() })
  check('Before a round: three balls, three lamps lit, the end lamp dark, nothing started', fresh.balls === 3 && fresh.lamps.every(Boolean) && !fresh.over && fresh.fired.started === 0, fresh)

  const round = await game(() => {
    const p = window.village.physics, g = window.game
    const out = {}
    const n0 = p.events().length
    g.pull()
    out.started = g.state()
    // A second pull while the round runs starts nothing.
    g.pull(0.3)
    out.pulledAgain = g.state().fired.started
    // Some score, by the wire a bumper uses.
    p.place('pinball/ball', [-0.2, 0.0136, -0.36])
    p.advance(1.5)
    out.scored = g.state().score
    g.drain()
    out.one = g.state()
    out.ballBack = p.thing('pinball/ball').local
    // A ball that bounces in the drain: put in it three times before it is put back.
    for (let i = 0; i < 3; i++) g.drain(0.15)
    p.advance(1)
    out.two = g.state()
    out.scoreBeforeLast = g.state().score
    g.drain()
    out.three = g.state()
    out.lost = p.events().slice(n0).filter((e) => e.kind === 'signal' && e.gadget === 'pinball/game' && e.port === 'lost')
    // After the end: another drain ends nothing again.
    g.drain()
    out.afterEnd = g.state()
    return out
  })
  check('A pull of the plunger starts a round, once: a second pull while it runs starts nothing', round.started.fired.started === 1 && round.pulledAgain === 1 && round.started.balls === 3, { started: round.started, pulledAgain: round.pulledAgain })
  check('A drained ball costs one ball, puts one lamp out and comes back to the lane', round.one.balls === 2 && round.one.lamps.join() === 'true,true,false' && round.ballBack[0] > 0.2 && round.ballBack[2] > 0.4, { one: round.one, ballBack: round.ballBack })
  check('A ball bouncing in the drain (three entries before it is put back) costs one ball, not three', round.two.balls === 1 && round.two.lamps.join() === 'true,false,false', round.two)
  check('The third ball ends the round: lost fires once, every lamp is out and the end lamp is lit', round.three.balls === 0 && round.three.fired.lost === 1 && !round.three.lamps.some(Boolean) && round.three.over, round.three)
  check('The end is an event anyone can read: a signal from pinball/game, port lost, carrying the score', round.lost.length === 1 && round.scored > 0 && round.lost[0].value === round.scoreBeforeLast && round.three.score === round.scoreBeforeLast, { lost: round.lost, scored: round.scored, score: round.scoreBeforeLast })
  check('After the end nothing ends again', round.afterEnd.fired.lost === 1 && round.afterEnd.fired.started === 1, round.afterEnd)
  if (shotsDir) {
    await page.evaluate(() => window.village.physics.play(true))
    await page.waitForTimeout(1800)
    await page.screenshot({ path: join(shotsDir, 'game-over.jpg'), quality: 88 })
    await page.evaluate(() => window.village.physics.play(false))
  }

  const again = await game(() => {
    const g = window.game
    g.pull()
    return g.state()
  })
  check('The next pull starts a new round: score zero, three balls, lamps lit, the end lamp dark', again.fired.started === 2 && again.score === 0 && again.balls === 3 && again.lamps.every(Boolean) && !again.over, again)

  // ── Reset, and a snapshot put back ──
  const undo = await game(() => {
    const p = window.village.physics, g = window.game
    g.drain()
    const snap = p.snapshot()
    const before = g.state()
    g.drain()
    g.drain()
    const ended = g.state()
    p.restore(snap)
    const restored = g.state()
    // The restored round carries on: one more drain is the second ball, not a new game.
    g.drain()
    const carriedOn = g.state()
    p.reset()
    const reset = g.state()
    g.pull()
    return { before, ended, restored, carriedOn, reset, startedAfterReset: g.state().fired.started - reset.fired.started }
  })
  const same = (a, b) => a.balls === b.balls && a.score === b.score && a.lamps.join() === b.lamps.join() && a.over === b.over
  check('A snapshot puts the game back: balls, score and every lamp as they were, and the round carries on', undo.ended.over && same(undo.before, undo.restored) && undo.carriedOn.balls === undo.before.balls - 1 && !undo.carriedOn.over, undo)
  check('Reset puts the game back to before a round (three balls, lamps lit, end lamp dark), and a pull then starts one', undo.reset.balls === 3 && undo.reset.lamps.every(Boolean) && !undo.reset.over && undo.startedAfterReset === 1, undo)

  // ── Loops of wires, with the logic parts in them ──
  const loops = await game(() => {
    const p = window.village.physics
    const { engine } = p
    const frame = { at: [40, 0, 0], yaw: 0, tilt: 0 }
    const floor = { id: 'floor', shape: { kind: 'box', half: [0.3, 0.02, 0.3] }, material: 'maple', at: [0, 0, 0] }
    const ball = { id: 'ball', shape: { kind: 'sphere', radius: 0.03 }, material: 'steel', motion: 'dynamic', at: [0, 0.3, 0] }
    const bulb = { id: 'bulb', shape: { kind: 'sphere', radius: 0.02 }, material: 'glass', at: [0.2, 0.06, 0] }
    const dropped = () => p.events().filter((e) => e.kind === 'dropped').reduce((a, e) => a + e.signals, 0)
    const out = {}
    // A game that starts itself again the moment it ends, through a counter that counts each start: a loop with no physical cause in it after the first.
    const d0 = dropped()
    engine.addToy({ id: 'spin', label: 'spin', frame, inputs: {}, parts: [floor, ball, bulb],
      gadgets: [{ id: 's', kind: 'sensor', part: 'floor', knobs: { threshold: 0.0001 } }, { id: 'g', kind: 'game' }, { id: 'c', kind: 'counter' }, { id: 'l', kind: 'lamp', part: 'bulb' }],
      wires: [{ from: 's.hit', to: 'g.start' }, { from: 'g.started', to: 'g.lose' }, { from: 'g.lost', to: 'g.start' }, { from: 'g.started', to: 'c.add' }, { from: 'c.counting', to: 'l.flash' }, { from: 'c.changed', to: 'g.score' }] })
    p.advance(2)
    const first = p.counters()['spin/c']
    p.advance(1)
    out.spin = { first, later: p.counters()['spin/c'], hits: p.signals()['spin/s.hit'], dropped: dropped() - d0, steps: p.stats().stepMs.n > 0, ballY: p.thing('spin/ball').position[1] }
    engine.removeToy('spin')
    // A loop through a part that waits: an emitter whose `spawned` asks it to spawn again. One spawn per delay, never a flood.
    const d1 = dropped()
    engine.addToy({ id: 'wait', label: 'wait', frame, inputs: {}, parts: [floor, ball],
      gadgets: [{ id: 's', kind: 'sensor', part: 'floor', knobs: { threshold: 0.0001 } }, { id: 'e', kind: 'emitter', part: 'ball', knobs: { delay: 0.5 } }, { id: 'c', kind: 'counter' }],
      wires: [{ from: 's.hit', to: 'e.spawn' }, { from: 'e.spawned', to: 'e.spawn' }, { from: 'e.spawned', to: 'c.add' }] })
    p.advance(5)
    out.wait = { spawns: p.counters()['wait/c'], dropped: dropped() - d1 }
    engine.removeToy('wait')
    return out
  })
  check('A game wired to start itself the moment it ends is cut 64 wires from each physical cause (a bounce of the ball) and says so; the world still steps', loops.spin.first > 0 && loops.spin.first <= 64 * loops.spin.hits && loops.spin.later === loops.spin.first && loops.spin.dropped > 0 && loops.spin.ballY > 0, loops.spin)
  check('A loop through a part that waits (an emitter asked to spawn by its own spawn) runs once per wait, never a flood', loops.wait.spawns >= 1 && loops.wait.spawns <= 11 && loops.wait.dropped === 0, loops.wait)

  // ── A toy with lamps leaves nothing behind, and a lamp needs a part ──
  const tidy = await game(() => {
    const p = window.village.physics
    const { engine } = p
    const before = { census: p.census(), memory: p.memory() }
    const toy = { id: 'lights', label: 'lights', frame: { at: [40, 0, 0], yaw: 0, tilt: 0 }, inputs: {}, wires: [],
      parts: [{ id: 'a', shape: { kind: 'sphere', radius: 0.02 }, material: 'glass', paint: '#aa3355', at: [0, 0.05, 0] }, { id: 'b', shape: { kind: 'sphere', radius: 0.02 }, material: 'glass', paint: '#33aa55', at: [0.1, 0.05, 0] }],
      gadgets: [{ id: 'la', kind: 'lamp', part: 'a', knobs: { lit: 1 } }, { id: 'lb', kind: 'lamp', part: 'b' }] }
    engine.addToy(toy)
    const built = p.census()
    const litAtFirst = [window.game.lit('lights/a'), window.game.lit('lights/b')]
    engine.removeToy('lights')
    let noPart = null
    try { engine.addToy({ ...toy, id: 'dark', gadgets: [{ id: 'l', kind: 'lamp' }] }) } catch (e) { noPart = String(e.message) }
    return { before: before.census, built, after: p.census(), litAtFirst, noPart, left: engine.world.keys().filter((k) => k.startsWith('dark/')).length }
  })
  const { draws: _d0, ...c0 } = tidy.before, { draws: _d1, ...c1 } = tidy.after
  check('A toy with lamps: each lamp has its own glow, lit as its knob says, and taking the toy out leaves the census as it was', tidy.built.glows === tidy.before.glows + 2 && tidy.litAtFirst.join() === 'true,false' && JSON.stringify(c0) === JSON.stringify(c1), tidy)
  check('A lamp with no part is refused and nothing of its toy is left', /a lamp needs a part/.test(tidy.noPart ?? '') && tidy.left === 0, { noPart: tidy.noPart, left: tidy.left })

  // ── By finger: the plunger button held and let go starts a round ──
  await game(() => { window.village.physics.reset(); window.village.physics.play(true) })
  await page.waitForTimeout(1600)
  const cdp = await context.newCDPSession(page)
  const box = await page.locator('.village-table .plunger').boundingBox()
  const before = await game(() => window.game.state().fired.started)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 }] })
  await page.waitForTimeout(700)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(900)
  const byFinger = await game(() => ({ started: window.game.state().fired.started, ball: window.village.physics.thing('pinball/ball').local }))
  check('By finger on a phone-sized screen: the plunger button held and let go starts a round', byFinger.started === before + 1, { before, byFinger })
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'game-playing.jpg'), quality: 88 })
  await game(() => window.village.physics.play(false))
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
