// Headless proof that the pinball table is a game (#108), made of logic parts wired as data
// (counter, game, lamp, points, collect, spawner) with no pinball code. A pull of the plunger starts a round; each ball put
// back counts one off three and puts a lamp out; a spare ball knocked about in the gutter costs
// none; the third ends the round once, with the score, as an event anyone can read; the next pull
// starts a new round with a clear board. Three top lanes release a multiball (a ball is used only
// when the last one in play is lost) and four side targets give one more ball, once a round. The
// table's mode lends its rules while it is played and the house is as it was afterwards. Reset and a snapshot put the game back with the rest. The
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
/** Stops vite and everything it started; nothing to do when it has gone already. */
const stopServer = () => new Promise((resolve) => {
  if (server.exitCode !== null || server.signalCode !== null) return resolve()
  server.once('exit', resolve)
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    resolve()
  }
})
const up = new Promise((resolve, reject) => {
  let out = ''
  const timer = setTimeout(() => reject(new Error(`vite did not start: ${out.slice(-400)}`)), 30_000)
  server.stdout.on('data', (d) => (/Local:/.test((out += d)) ? (clearTimeout(timer), resolve()) : undefined))
  server.stderr.on('data', (d) => (out += d))
  server.on('exit', (code) => reject(new Error(`vite exited ${code}: ${out.slice(-400)}`)))
})
await up.catch(async (error) => {
  await stopServer()
  throw error
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
    // Signals the engine dropped, counted as they are said (the handle's own list of events is a window that slides).
    window.dropped = 0
    window.village.kernel.root.on('village/physics', (e) => { if (e.kind === 'dropped') window.dropped += e.signals })
    const lit = (key) => p.engine.world.keys().includes(key) && window.village.kernel.root.get('stage').scene.getObjectByName(key).material.emissiveIntensity > 0
    window.game = {
      state: () => ({
        score: p.counters()['pinball/score'], balls: p.counters()['pinball/balls'],
        lamps: [1, 2, 3].map((n) => lit(`pinball/life-${n}`)), over: lit('pinball/over'), save: lit('pinball/save'),
        fired: Object.fromEntries(['started', 'lost', 'won'].map((port) => [port, p.signals()[`pinball/game.${port}`] ?? 0])),
      }),
      pull(hold = 0.5) {
        p.input('plunger', true)
        p.advance(hold)
        p.input('plunger', false)
        p.advance(0.3)
      },
      /** The ball dropped just above the drain, then time for it to be put back in the lane. `free`: within the grace period, as it is. */
      drain(after = 1, free = false) {
        if (!free) this.graceOver()
        p.place('pinball/ball', [-0.025, 0.0136, 0.47])
        p.advance(after)
      },
      /** The grace period waited out, the ball held in the lane meanwhile. */
      graceOver() {
        if (!lit('pinball/save')) return
        p.place('pinball/ball', [0.2405, 0.0135, 0.4345])
        p.advance(12.2)
      },
      /** Some score, by the wire a bumper uses: the ball dropped just above one. */
      bump() {
        p.place('pinball/ball', [-0.065, 0.0136, -0.26])
        p.advance(0.6)
      },
      lit,
    }
  })
  const game = (fn, arg) => page.evaluate(fn, arg)

  // ── A round, from the first pull to the last ball ──
  const fresh = await game(() => {
    const p = window.village.physics
    p.reset()
    // A ball in the drain before any round costs nothing.
    window.game.drain()
    p.advance(0.5)
    return window.game.state()
  })
  check('Before a round: three balls, three lamps lit, the end lamp dark, nothing started, and a ball drained then costs none', fresh.balls === 3 && fresh.lamps.every(Boolean) && !fresh.over && fresh.fired.started === 0, fresh)

  const round = await game(() => {
    const p = window.village.physics, g = window.game
    const out = {}
    const n0 = p.events().length
    g.pull()
    out.started = g.state()
    // A second pull while the round runs starts nothing.
    g.pull(0.3)
    out.pulledAgain = g.state().fired.started
    // Lost within the grace period: the ball comes back and none is used. Then the period runs out.
    g.drain(1, true)
    out.saved = g.state()
    out.savedBack = p.thing('pinball/ball').local
    g.graceOver()
    out.graceOver = g.state()
    g.bump()
    out.scored = g.state().score
    g.drain()
    out.one = g.state()
    out.ballBack = p.thing('pinball/ball').local
    // A spare ball lying in the gutter, knocked up out of it and falling back in, was never in play: no ball is lost.
    p.place('pinball/ball-2', [-0.1, 0.0136, 0.45])
    p.advance(1)
    out.spare = g.state()
    g.drain()
    out.two = g.state()
    out.scoreBeforeLast = g.state().score
    g.drain()
    out.three = g.state()
    out.lost = p.events().slice(n0).filter((e) => e.kind === 'signal' && e.gadget === 'pinball/game' && e.port === 'lost')
    // After the end: another drain ends nothing again, and costs no ball (none is in play).
    g.drain()
    out.afterEnd = g.state()
    return out
  })
  check('A pull of the plunger starts a round, once: a second pull while it runs starts nothing', round.started.fired.started === 1 && round.pulledAgain === 1 && round.started.balls === 3, { started: round.started, pulledAgain: round.pulledAgain })
  check('A ball lost within twelve seconds of the round starting comes back to the lane and costs none; the blue lamp is lit while that holds and goes out after', round.started.save && round.saved.balls === 3 && round.savedBack[0] > 0.2 && round.savedBack[2] > 0.4 && round.saved.save && !round.graceOver.save, { saved: round.saved, savedBack: round.savedBack, graceOver: round.graceOver })
  check('A drained ball costs one ball, puts one lamp out and comes back to the lane', round.one.balls === 2 && round.one.lamps.join() === 'true,true,false' && round.ballBack[0] > 0.2 && round.ballBack[2] > 0.4, { one: round.one, ballBack: round.ballBack })
  check('A spare ball falling back into the gutter costs nothing (it was never in play); the next ball lost costs one', round.spare.balls === 2 && round.two.balls === 1 && round.two.lamps.join() === 'true,false,false', { spare: round.spare, two: round.two })
  check('The third ball ends the round: lost fires once, every lamp is out and the end lamp is lit', round.three.balls === 0 && round.three.fired.lost === 1 && !round.three.lamps.some(Boolean) && round.three.over, round.three)
  check('The end is an event anyone can read: a signal from pinball/game, port lost, carrying the score', round.lost.length === 1 && round.scored > 0 && round.lost[0].value === round.scoreBeforeLast && round.three.score === round.scoreBeforeLast, { lost: round.lost, scored: round.scored, score: round.scoreBeforeLast })
  check('After the end a drain ends nothing again and counts no ball', round.afterEnd.fired.lost === 1 && round.afterEnd.fired.started === 1 && round.afterEnd.balls === 0, round.afterEnd)
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
    // Some score first, so a snapshot that lost it would show.
    g.bump()
    g.drain()
    const snap = p.snapshot()
    const before = g.state()
    g.bump()
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
  check('A snapshot puts the game back: balls, a score above zero and every lamp as they were, and the round carries on', undo.ended.over && undo.before.score > 0 && undo.ended.score > undo.before.score && same(undo.before, undo.restored) && undo.carriedOn.balls === undo.before.balls - 1 && !undo.carriedOn.over, undo)
  check('Reset puts the game back to before a round (three balls, lamps lit, end lamp dark), and a pull then starts one', undo.reset.balls === 3 && undo.reset.lamps.every(Boolean) && !undo.reset.over && undo.startedAfterReset === 1, undo)

  // ── The missions: three lanes for a multiball, four targets for another ball (a round is running) ──
  const missions = await game(() => {
    const p = window.village.physics, g = window.game, w = p.engine.world
    const fired = (k) => p.signals()[`pinball/${k}`] ?? 0
    const live = () => p.counters()['pinball/live']
    const out = {}
    g.graceOver()
    const s0 = g.state().score, all0 = fired('lanes.all')
    const lanes = { a: -0.1325, b: -0.0475, c: 0.0375 }
    out.lit = []
    for (const k of Object.keys(lanes)) {
      // Just above the lane's light, to roll down over it.
      p.place('pinball/ball', [lanes[k], 0.0136, -0.43])
      // To the step it rolls onto the light (the third completes the set; a bumper below may send it back through later).
      const n0 = fired(`lane-${k}-zone.enter`)
      for (let i = 0; i < 40 && fired(`lane-${k}-zone.enter`) === n0; i++) p.advance(1 / 60)
      p.advance(1 / 60)
      out.lit.push(Object.keys(lanes).map((j) => g.lit(`pinball/lane-${j}`)).join())
    }
    out.lanes = { all: fired('lanes.all') - all0, gained: g.state().score - s0, live: live(), spares: ['ball-2', 'ball-3'].map((id) => +p.thing(`pinball/${id}`).local[2].toFixed(2)) }
    // Three balls in play: one lost is not a ball used, the last one is.
    const b0 = g.state().balls
    out.grace = g.state().save
    p.place('pinball/ball-2', [-0.1, 0.0136, 0.47])
    p.advance(0.5)
    out.oneOfThree = { balls: g.state().balls, live: live() }
    p.place('pinball/ball', [-0.02, 0.0136, 0.47])
    p.place('pinball/ball-3', [0.06, 0.0136, 0.47])
    p.advance(1)
    out.allThree = { balls: g.state().balls, b0, live: live(), served: p.thing('pinball/ball').local }
    // The targets: thrown at each in turn.
    const targets = { a: [-0.254, -0.06], b: [-0.254, 0.05], c: [0.204, -0.1], d: [0.204, 0.02] }
    const throwAt = (k) => {
      const [x, z] = targets[k], side = Math.sign(x)
      p.place('pinball/ball', [x - side * 0.045, 0.0136, z])
      w.setVelocity('pinball/ball', w.toWorldDir('pinball', [side, 0, 0]).map((v) => v * 1.2))
      p.advance(0.12)
    }
    const t0 = { score: g.state().score, balls: g.state().balls, all: fired('targets.all') }
    for (const k of ['a', 'b', 'c']) throwAt(k)
    out.threeLit = Object.keys(targets).map((k) => g.lit(`pinball/target-${k}`)).join()
    throwAt('d')
    out.targets = { all: fired('targets.all') - t0.all, gained: g.state().score - t0.score, balls: g.state().balls - t0.balls, lit: Object.keys(targets).map((k) => g.lit(`pinball/target-${k}`)).join() }
    for (const k of Object.keys(targets)) throwAt(k)
    out.again = { all: fired('targets.all') - t0.all, balls: g.state().balls - t0.balls }
    return out
  })
  check('Each top lane lights as a ball rolls through it; the third pays 500 on top of 50 a lane, puts the three out and releases both spare balls onto the field', missions.lit.join(' ') === 'true,false,false true,true,false false,false,false' && missions.lanes.all === 1 && missions.lanes.gained >= 650 && missions.lanes.live === 3 && !missions.grace && missions.lanes.spares.every((z) => z < 0.3), missions)
  check('With three balls in play, one lost is not a ball used; when the last is lost one ball is used and the next is served to the lane', missions.oneOfThree.balls === missions.allThree.b0 && missions.oneOfThree.live === 2 && missions.allThree.balls === missions.allThree.b0 - 1 && missions.allThree.live === 1 && missions.allThree.served[0] > 0.2 && missions.allThree.served[2] > 0.4, { oneOfThree: missions.oneOfThree, allThree: missions.allThree })
  check('A side target lights when hit; the fourth pays 1000 on top of 30 a target, puts them out and gives one more ball', missions.threeLit === 'true,true,true,false' && missions.targets.all === 1 && missions.targets.gained >= 1120 && missions.targets.balls === 1 && missions.targets.lit === 'false,false,false,false', { threeLit: missions.threeLit, targets: missions.targets })
  check('A second set of targets in the same round pays again but gives no second ball', missions.again.all === 2 && missions.again.balls === 1, missions.again)

  // ── Game modes: rules and toys on loan, and the house as it was afterwards ──
  const modes = await game(() => {
    const p = window.village.physics
    const stored = () => localStorage.getItem('village.physics.rules')
    const census = () => JSON.stringify({ ...p.census(), draws: 0 })
    p.reset()
    p.preset('normal')
    p.setRules({ bounce: 1.1 })
    const out = { before: { substeps: p.rules().substeps, stored: stored() } }
    const n0 = p.events().length
    p.play(true)
    out.playing = { substeps: p.rules().substeps, active: p.modes.active(), storedSame: stored() === out.before.stored }
    // Tuned by someone while the table is played: theirs, so it stays; still nothing is kept until the mode ends.
    p.setRules({ gravity: [0, -1.62, 0] })
    out.tuned = { storedSame: stored() === out.before.stored }
    p.play(false)
    out.left = { substeps: p.rules().substeps, gravity: p.rules().gravity[1], bounce: p.rules().bounce, active: p.modes.active(), stored: JSON.parse(stored() ?? 'null') }
    out.events = p.events().slice(n0).filter((e) => e.kind === 'mode').map((e) => `${e.mode} ${e.state}`)
    // A mode that brings a toy and plays under a preset.
    p.preset('normal')
    const rules0 = JSON.stringify(p.rules()), census0 = census()
    const toy = { id: 'mode-toy', label: 'Blocks', frame: { at: [40, 0, 0], yaw: 0, tilt: 0 }, inputs: {}, wires: [], gadgets: [{ id: 'l', kind: 'lamp', part: 'block', knobs: { lit: 1 } }],
      parts: [{ id: 'floor', shape: { kind: 'box', half: [0.3, 0.02, 0.3] }, material: 'maple', at: [0, 0, 0] }, { id: 'block', shape: { kind: 'box', half: [0.03, 0.03, 0.03] }, material: 'cork', paint: '#7fa37a', motion: 'dynamic', at: [0, 0.2, 0] }] }
    out.started = p.modes.start({ id: 'moon-blocks', label: 'Moon blocks', preset: 'moon', rules: { bounce: 1.3 }, toys: [toy] })
    out.mid = { has: p.engine.hasToy('mode-toy'), gravity: p.rules().gravity[1], bounce: p.rules().bounce, active: p.modes.active() }
    out.second = p.modes.start({ id: 'other', label: 'Other' })
    p.advance(1)
    out.ended = p.modes.end()
    out.end = { rules: JSON.stringify(p.rules()) === rules0, census: census() === census0, has: p.engine.hasToy('mode-toy'), active: p.modes.active(), endedAgain: p.modes.end() }
    // A mode whose second toy cannot be built changes nothing.
    out.bad = p.modes.start({ id: 'bad', label: 'Bad', rules: { gravity: [0, 5, 0] }, toys: [{ ...toy, id: 'ok-toy' }, { ...toy, id: 'bad-toy', gadgets: [{ id: 'x', kind: 'teleporter' }] }] })
    out.afterBad = { rules: JSON.stringify(p.rules()) === rules0, census: census() === census0, active: p.modes.active() }
    p.preset('normal')
    return out
  })
  check('Choosing the table starts its mode (two collision steps a frame) and leaving it puts that rule back; both are said as events', modes.before.substeps === 1 && modes.playing.substeps === 2 && modes.playing.active === 'pinball' && modes.left.substeps === 1 && modes.left.active === null && modes.events.join() === 'pinball started,pinball ended', { before: modes.before, playing: modes.playing, left: modes.left, events: modes.events })
  check('A mode\'s rules are on loan: nothing is kept in the browser while it runs; what someone tuned meanwhile stays and is kept when it ends, without the mode\'s own rule', modes.playing.storedSame && modes.tuned.storedSame && modes.left.gravity === -1.62 && modes.left.bounce === 1.1 && modes.left.stored?.gravity?.[1] === -1.62 && modes.left.stored?.substeps === 1, { playing: modes.playing, tuned: modes.tuned, left: modes.left })
  check('A mode that brings a toy and a preset: both in force while it runs, a second mode is refused, and ending it leaves the rules and the census as they were', modes.started.ok && modes.mid.has && modes.mid.gravity === -1.62 && modes.mid.bounce === 1.3 && modes.second.ok === false && modes.ended && modes.end.rules && modes.end.census && !modes.end.has && modes.end.active === null && modes.end.endedAgain === false, { started: modes.started, mid: modes.mid, second: modes.second, end: modes.end })
  check('A mode whose toy cannot be built starts nothing: rules and census as they were', modes.bad.ok === false && /teleporter/.test(modes.bad.reason) && modes.afterBad.rules && modes.afterBad.census && modes.afterBad.active === null, { bad: modes.bad, afterBad: modes.afterBad })

  // ── Loops of wires, with the logic parts in them ──
  const loops = await game(() => {
    const p = window.village.physics
    const { engine } = p
    const frame = { at: [40, 0, 0], yaw: 0, tilt: 0 }
    const floor = { id: 'floor', shape: { kind: 'box', half: [0.3, 0.02, 0.3] }, material: 'maple', at: [0, 0, 0] }
    const ball = { id: 'ball', shape: { kind: 'sphere', radius: 0.03 }, material: 'steel', motion: 'dynamic', at: [0, 0.3, 0] }
    const bulb = { id: 'bulb', shape: { kind: 'sphere', radius: 0.02 }, material: 'glass', at: [0.2, 0.06, 0] }
    const dropped = () => window.dropped
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
    // The newer parts in a ring: a spawner whose `spawned` calls it back and whose `back` spawns it again, through points and a set of one.
    const d2 = dropped()
    engine.addToy({ id: 'churn', label: 'churn', frame, inputs: {}, parts: [floor, ball],
      gadgets: [{ id: 's', kind: 'sensor', part: 'floor', knobs: { threshold: 0.0001 } }, { id: 'sp', kind: 'spawner', part: 'ball', at: [0, 0.1, 0] }, { id: 'pt', kind: 'points', knobs: { value: 7 } }, { id: 'set', kind: 'collect', knobs: { count: 1 } }, { id: 'c', kind: 'counter' }],
      wires: [{ from: 's.hit', to: 'sp.spawn' }, { from: 'sp.spawned', to: 'pt.in' }, { from: 'pt.out', to: 'set.a' }, { from: 'set.all', to: 'sp.back' }, { from: 'sp.back', to: 'sp.spawn' }, { from: 'pt.out', to: 'c.plus' }] })
    p.advance(2)
    const churned = p.counters()['churn/c']
    p.advance(1)
    out.churn = { first: churned, later: p.counters()['churn/c'], hits: p.signals()['churn/s.hit'], dropped: dropped() - d2, ballY: p.thing('churn/ball').position[1] }
    engine.removeToy('churn')
    return out
  })
  check('A game wired to start itself the moment it ends is cut 64 wires from each physical cause (a bounce of the ball) and says so; the world still steps', loops.spin.first > 0 && loops.spin.first <= 64 * loops.spin.hits && loops.spin.later === loops.spin.first && loops.spin.dropped > 0 && loops.spin.ballY > 0, loops.spin)
  check('A ring of spawner, points and a set that feeds itself is cut the same way, having counted sevens; the world still steps', loops.churn.first > 0 && loops.churn.first % 7 === 0 && loops.churn.dropped > 0 && loops.churn.ballY > -1, loops.churn)
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
  await stopServer()
}
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ ok: !failed.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name) }, null, 1))
process.exit(failed.length ? 1 : 0)
