// Headless proof of fire, heat and water (#74). On a small arena of parts added through the
// engine's own addToy (a walnut block, a felt cushion 8 cm from it, a steel kettle and a glass
// pane as near on other sides, and felt far away): lighting the wood spreads to the felt through
// the GPU heat field and not to the far felt; steel heats but never burns and refuses to be lit;
// glass does not burn; the felt burns out; water puts the wood out and it stays out; ignite,
// extinguish and burnt are on the event stream; a snapshot restores fire and wetness and starts
// the field cold; rain wets; lightning lights felt; the candle's flame gadget lights it. Then the
// notepad (stub router and ruler, or --agent=claude): "set the sofa on fire" lights the sofa,
// "pour a bucket of water on the sofa" puts it out, "set the fridge on fire" says steel does not
// burn. Then the same spread on three.js's WebGL2 backend (?webgl=1), and the cost per frame
// idle and burning. Starts its own villager host and dev server on a throwaway VILLAGE_ROOT.
// Usage: node scripts/check-physics-fire.mjs [--dev=5393] [--host=5397] [--agent=claude] [--shots-dir=dir]
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pairLink } from './pairing.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const shotsDir = opt('shots-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'fire-'))
const hostPort = Number(opt('host') ?? 5397)
const devPort = Number(opt('dev') ?? 5393)
const base = `http://localhost:${devPort}/`
const checks = []
const report = {}
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 500) ?? '')
}
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
    child.stdout.on('data', (d) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.stderr.on('data', (d) => (out += d))
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}

await run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
if (shotsDir) await mkdir(shotsDir, { recursive: true })

async function open(page, query) {
  await page.goto(await pairLink(`${base}${query}`, root))
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.fire, null, { timeout: 30_000 })
}

/** The arena, in mid-air over the kitchen's open floor (static parts do not fall): nothing else burns within a metre. */
const ARENA = {
  id: 'arena', label: 'Fire arena', frame: { at: [1.6, 1.35, 1.7], yaw: 0, tilt: 0 }, inputs: {}, gadgets: [], wires: [],
  parts: [
    { id: 'oak', shape: { kind: 'box', half: [0.08, 0.08, 0.08] }, material: 'walnut', at: [0, 0, 0] },
    { id: 'cushion', shape: { kind: 'box', half: [0.08, 0.06, 0.08] }, material: 'felt', at: [0.24, 0, 0] },
    { id: 'kettle', shape: { kind: 'box', half: [0.08, 0.08, 0.08] }, material: 'steel', at: [-0.24, 0, 0] },
    { id: 'pane', shape: { kind: 'box', half: [0.08, 0.08, 0.01] }, material: 'glass', at: [0, 0, 0.17] },
    { id: 'far', shape: { kind: 'box', half: [0.08, 0.06, 0.08] }, material: 'felt', at: [1.3, 0, -0.6] },
  ],
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  // GPU validation errors arrive as console errors, not page errors.
  const listen = (pg, list) => {
    pg.on('pageerror', (e) => list.push(String(e)))
    pg.on('console', (m) => m.type() === 'error' && list.push(m.text().slice(0, 300)))
  }
  listen(page, errors)
  await open(page, '?talk=off&build=0&q=low')

  // ── Idle: nothing hot, nothing wet, nothing stepped ──
  await page.waitForTimeout(1000)
  const idle = await page.evaluate(() => ({ ...window.village.physics.fire.stats(), backend: window.village.physics.fire.backend }))
  report.backend = idle.backend
  check('Idle, the heat field is not stepped and fire costs no frame time', !idle.active && idle.frameMs.n === 0 && idle.burning === 0 && idle.parts > 50, idle)

  // ── The materials ──
  const mats = await page.evaluate(() => Object.fromEntries(['walnut', 'felt', 'steel', 'glass', 'paper', 'wax'].map((m) => [m, window.village.physics.engine.world.material(m).heat])))
  check('Materials carry heat facts: wood and felt burn (felt catches lower and burns faster), steel and glass do not', mats.walnut.flammability > 0 && mats.felt.flammability > mats.walnut.flammability && mats.felt.ignition < mats.walnut.ignition && mats.felt.burnRate > mats.walnut.burnRate && mats.steel.flammability === 0 && mats.glass.flammability === 0, mats)
  const reg = await page.evaluate(() => {
    const e = window.village.physics.engine
    return {
      bad: e.registerMaterial('napalm', { density: 900, friction: 0.5, restitution: 0.2, hardness: 0.3, look: { color: '#aa3300', roughness: 0.5, metalness: 0 }, heat: { flammability: 7, ignition: 100, burnRate: 0.1, heatCapacity: 1, absorbs: 0 } }),
      plain: e.registerMaterial('slate', { density: 2700, friction: 0.6, restitution: 0.2, hardness: 0.9, look: { color: '#556070', roughness: 0.7, metalness: 0 } }),
      slate: e.world.material('slate')?.heat ?? null,
    }
  })
  check('A material out of range is refused; one with no heat facts is accepted and does not burn', typeof reg.bad === 'string' && reg.plain === null && reg.slate === null, reg)

  // ── The arena: wood lit, felt beside it catches, steel and glass do not, far felt does not ──
  const spread = await page.evaluate(async (arena) => {
    const p = window.village.physics
    p.engine.addToy(arena)
    const before = p.snapshot()
    const n = p.events().length
    const lit = p.fire.ignite('arena/oak')
    const steel = p.fire.ignite('arena/kettle')
    const glass = p.fire.ignite('arena/pane')
    const t0 = performance.now()
    let caughtAt = null
    for (let t = 0; t < 30 && caughtAt === null; t += 0.5) {
      await p.fire.run(0.5)
      if (p.fire.burning('arena/cushion')) caughtAt = t + 0.5
    }
    const runMs = performance.now() - t0
    // A few seconds more: steel takes heat slowly.
    await p.fire.run(4)
    const state = Object.fromEntries(p.fire.list().filter((x) => x.thing.startsWith('arena/')).map((x) => [x.thing.slice(6), { state: x.state, temp: x.temp, fuel: x.fuel }]))
    const events = p.events().slice(n).filter((e) => ['ignite', 'extinguish', 'burnt'].includes(e.kind)).map((e) => ({ kind: e.kind, thing: e.thing, by: e.by }))
    return { lit, steel, glass, caughtAt, runMs: Math.round(runMs), state, events, before }
  }, ARENA)
  report.spread = { caughtAt: spread.caughtAt, runMs: spread.runMs, state: spread.state }
  check('Lighting the walnut block emits ignite (by code)', spread.lit === null && spread.events[0]?.kind === 'ignite' && spread.events[0].thing === 'arena/oak' && spread.events[0].by === 'code', spread.events.slice(0, 2))
  check('Steel and glass refuse to be lit, and say so', /does not burn/.test(spread.steel ?? '') && /does not burn/.test(spread.glass ?? ''), { steel: spread.steel, glass: spread.glass })
  check('Fire spreads from the wood to the felt cushion 8 cm away through the heat field (ignite by heat)', spread.caughtAt !== null && spread.caughtAt > 0.5 && spread.events.some((e) => e.kind === 'ignite' && e.thing === 'arena/cushion' && e.by === 'heat'), { caughtAt: spread.caughtAt, cushion: spread.state.cushion })
  check('The steel kettle beside the fire heats up but never burns; the glass does not burn; the far felt is untouched', spread.state.kettle.state === 'cold' && spread.state.kettle.temp > 60 && spread.state.pane.state === 'cold' && spread.state.far.state === 'cold' && spread.state.far.temp < 40, { kettle: spread.state.kettle, pane: spread.state.pane, far: spread.state.far })

  // ── Burnt, water, snapshot ──
  const later = await page.evaluate(async () => {
    const p = window.village.physics
    const n = p.events().length
    const s0 = p.fire.stats()
    for (let i = 0; i < 40 && p.fire.list().find((x) => x.thing === 'arena/cushion').state !== 'burnt'; i++) await p.fire.run(1)
    const cushion = p.fire.list().find((x) => x.thing === 'arena/cushion')
    const burning = p.snapshot()
    const doused = p.fire.douse('arena/oak')
    await p.fire.run(4)
    const oak = p.fire.list().find((x) => x.thing === 'arena/oak')
    const events = p.events().slice(n).filter((e) => ['ignite', 'extinguish', 'burnt'].includes(e.kind)).map((e) => ({ kind: e.kind, thing: e.thing, by: e.by }))
    return { s0, s1: p.fire.stats(), cushion, oak, doused, events, burning, oakBurningInSnapshot: burning.fire?.parts?.['arena/oak']?.state }
  })
  check('The felt cushion burns out: burnt is emitted and its fuel is gone', later.cushion.state === 'burnt' && later.cushion.fuel === 0 && later.events.some((e) => e.kind === 'burnt' && e.thing === 'arena/cushion'), { s0: later.s0, s1: later.s1, cushion: later.cushion, events: later.events })
  check('Water on the burning wood puts it out (extinguish by water), and wet, it does not catch again', later.doused === null && later.events.some((e) => e.kind === 'extinguish' && e.thing === 'arena/oak' && e.by === 'water') && later.oak.state === 'cold' && later.oak.wet > 0.2, { oak: later.oak, events: later.events })

  const restored = await page.evaluate(async ([before, burning]) => {
    const p = window.village.physics
    const a = p.restore(before)
    await p.fire.run(1)
    const cold = p.fire.list().filter((x) => x.thing.startsWith('arena/')).map((x) => ({ thing: x.thing, state: x.state, fuel: x.fuel, wet: x.wet, temp: x.temp }))
    const hottest = p.fire.stats().hottest
    const b = p.restore(burning)
    const back = Object.fromEntries(p.fire.list().filter((x) => x.thing.startsWith('arena/')).map((x) => [x.thing.slice(6), x.state]))
    await p.fire.run(1)
    const still = p.fire.burning('arena/oak')
    const bad = p.restore({ ...before, fire: { parts: { 'arena/oak': { state: 'burning', fuel: 'lots', wet: 0, temp: 0 }, 'arena/kettle': { state: 'burning', fuel: 1, wet: 0, temp: 900 } } } })
    const afterBad = p.fire.list().filter((x) => x.thing.startsWith('arena/') && x.state !== 'cold').length
    const none = p.restore({ ...before, fire: undefined })
    return { a: a.clamped, cold, hottest, b: b.clamped, back, still, bad: bad.clamped, afterBad, none: none.clamped }
  }, [spread.before, later.burning])
  check('Restoring the snapshot from before the fire: every part cold, whole and dry, and the field cold', restored.cold.every((x) => x.state === 'cold' && x.fuel === 1 && x.wet === 0) && restored.hottest < 30 && !restored.a.length, restored)
  check('Restoring the snapshot taken while it burned: the wood burns again, the cushion is burnt', restored.back.oak === 'burning' && restored.back.cushion === 'burnt' && restored.still && !restored.b.length, { back: restored.back, still: restored.still })
  check('A snapshot with junk fire data is checked: a bad fuel and a burning kettle are skipped and listed, nothing burns', restored.bad.includes('fire.arena/oak') && restored.bad.includes('fire.arena/kettle') && restored.afterBad === 0, { bad: restored.bad, afterBad: restored.afterBad })

  // ── Rain, lightning, the candle's gadget ──
  const weather = await page.evaluate(async () => {
    const p = window.village.physics
    const n = p.events().length
    p.fire.rain(6)
    await p.fire.run(3)
    const far = p.fire.list().find((x) => x.thing === 'arena/far')
    const kettle = p.fire.list().find((x) => x.thing === 'arena/kettle')
    p.restore({ ...p.snapshot(), fire: undefined })
    const struck = p.engine.world.strike('arena/far')
    await p.fire.run(2)
    const lit = p.fire.burning('arena/far')
    const kettleStrike = p.engine.world.strike('arena/kettle')
    await p.fire.run(1)
    const kettleAfter = p.fire.list().find((x) => x.thing === 'arena/kettle')
    p.restore({ ...p.snapshot(), fire: undefined })
    p.setKnob('candles/flame', 'lit', 1)
    p.advance(0.1)
    const candle = p.fire.burning('candles/candle')
    await p.fire.run(2)
    const candleStill = p.fire.list().find((x) => x.thing === 'candles/candle')
    const events = p.events().slice(n).filter((e) => ['ignite', 'extinguish', 'burnt'].includes(e.kind)).map((e) => ({ kind: e.kind, thing: e.thing, by: e.by }))
    p.setKnob('candles/flame', 'lit', 0)
    const candleOut = p.fire.burning('candles/candle')
    p.restore({ ...p.snapshot(), fire: undefined })
    return { far, kettle, struck, lit, kettleStrike, kettleAfter, candle, candleStill, candleOut, events }
  })
  check('Rain wets what absorbs water (felt) and not steel', weather.far.wet > 0.1 && weather.kettle.wet === 0, { far: weather.far.wet, kettle: weather.kettle.wet })
  check('Lightning lights felt; on steel it only heats it', weather.struck === null && weather.lit && weather.kettleStrike === null && weather.kettleAfter.state === 'cold' && weather.kettleAfter.temp > 100, { lit: weather.lit, kettle: weather.kettleAfter })
  check('The candle\'s flame gadget lights it (ignite by gadget), it keeps burning slowly, and lit 0 puts it out', weather.candle && weather.events.some((e) => e.kind === 'ignite' && e.thing === 'candles/candle' && e.by === 'gadget') && weather.candleStill.state === 'burning' && weather.candleStill.fuel > 0.99 && !weather.candleOut, { candle: weather.candleStill, out: weather.candleOut })
  const edges = await page.evaluate(async () => {
    const p = window.village.physics
    const b = p.fire.bounds
    // A wooden block well past the field: it cannot be lit (its heat would be read from the field's edge).
    p.engine.addToy({ id: 'outside', label: 'Outside', frame: { at: [b.max[0] + 3, 1, (b.min[2] + b.max[2]) / 2], yaw: 0, tilt: 0 }, inputs: {}, gadgets: [], wires: [], parts: [{ id: 'oak', shape: { kind: 'box', half: [0.08, 0.08, 0.08] }, material: 'walnut', at: [0, 0, 0] }] })
    const outside = p.fire.ignite('outside/oak')
    const parts = p.fire.list()
    const bookcase = parts.find((x) => x.part === 'bookcase')?.material
    // The candle: lit by its gadget, put out with water, the knob left at 1; a snapshot restored keeps it out.
    p.setKnob('candles/flame', 'lit', 0)
    p.setKnob('candles/flame', 'lit', 1)
    p.advance(0.1)
    const lit = p.fire.burning('candles/candle')
    p.fire.douse('candles/candle')
    p.advance(0.1)
    const out = !p.fire.burning('candles/candle')
    const snap = p.snapshot()
    p.restore(snap)
    p.advance(0.5)
    await p.fire.run(0.5)
    const stillOut = !p.fire.burning('candles/candle')
    p.setKnob('candles/flame', 'lit', 0)
    p.restore({ ...p.snapshot(), fire: undefined })
    return { outside, bookcase, lit, out, stillOut }
  })
  check('A part outside the heat field is not lit (it says why); the bookcase is wood, not paper', /outside the heat field/.test(edges.outside ?? '') && edges.bookcase === 'walnut', edges)
  check('A candle put out with water stays out when a snapshot is restored (its gadget does not relight it)', edges.lit && edges.out && edges.stillOut, edges)
  check('No page errors or GPU errors on the fire page', !errors.length, errors.slice(0, 5))
  await page.close()

  // ── The notepad, the default page ──
  const live = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const liveErrors = []
  listen(live, liveErrors)
  await open(live, '?q=low&room=living')
  const said = async (line) => {
    const n = await live.evaluate(() => window.village.physics.asked().length)
    await live.keyboard.press('Escape')
    await live.keyboard.type(line, { delay: 0 })
    await live.keyboard.press('Enter')
    let s
    for (let i = 0; i < (agent === 'stub' ? 100 : 900); i++) {
      s = await live.evaluate((n) => ({ routes: window.village.talk.state().input.routes, asked: window.village.physics.asked().slice(n) }), n)
      if (s.asked.length) break
      await live.waitForTimeout(100)
    }
    await live.evaluate(() => window.village.physics.fire.run(1))
    const sofa = await live.evaluate(() => window.village.physics.fire.list().find((x) => x.part === 'sofa'))
    return { route: s.routes.at(-1)?.route, asked: s.asked.at(-1), sofa: sofa && { state: sofa.state, wet: sofa.wet } }
  }
  const lightSofa = await said('set the sofa on fire')
  if (shotsDir) {
    await live.evaluate(() => window.village.physics.fire.run(4))
    await live.waitForTimeout(1500)
    await live.screenshot({ path: join(shotsDir, 'fire-sofa.jpg'), quality: 88 })
  }
  const water = await said('pour a bucket of water on the sofa')
  const fridge = await said('set the fridge on fire')
  // The rest of a merged kit is offered under the kit's name; an act on it does not reach its named parts.
  const rest = await live.evaluate(() => {
    const p = window.village.physics
    const why = p.fire.ignite('home/lounge furnish', '')
    const sofa = p.fire.list().find((x) => x.part === 'sofa').state
    p.restore({ ...p.snapshot(), fire: undefined })
    return { why, sofa }
  })
  check("Lighting a kit's unnamed rest does not light its named parts (the sofa)", rest.sofa !== 'burning', rest)
  report.notepad = { lightSofa, water, fridge }
  const by = agent === 'stub' ? 'stub router and ruler' : 'real router and ruler'
  check(`Notepad: "set the sofa on fire" is routed to physics and the sofa burns (${by})`, lightSofa.route === 'physics' && lightSofa.asked?.ok && lightSofa.asked.acts?.[0]?.act === 'ignite' && lightSofa.sofa?.state === 'burning', lightSofa)
  check(`Notepad: "pour a bucket of water on the sofa" puts it out and wets it (${by})`, water.route === 'physics' && water.asked?.ok && water.sofa?.state !== 'burning' && water.sofa?.wet > 0.2, water)
  check(`Notepad: "set the fridge on fire" does not light it and says steel does not burn (${by})`, fridge.route === 'physics' && !(fridge.asked?.acts ?? []).some((a) => a.act === 'ignite' && !a.refused) && /does not burn|won't|will not|doesn't/.test(JSON.stringify(fridge.asked)), fridge)

  // ── Cost per frame: idle, then burning, real frames ──
  const cost = await live.evaluate(async () => {
    const p = window.village.physics
    p.restore({ ...p.snapshot(), fire: undefined })
    await new Promise((r) => setTimeout(r, 300))
    p.fire.clearStats()
    p.fire.ignite('home/lounge furnish', 'sofa')
    await new Promise((r) => setTimeout(r, 4000))
    const burning = p.fire.stats()
    p.restore({ ...p.snapshot(), fire: undefined })
    return { burning: burning.frameMs, parts: burning.parts, samples: burning.samples, lit: burning.burning }
  })
  report.cost = cost
  check('Burning, fire costs under 0.5 ms of CPU per frame (median), stepping the field and reading samples back', cost.burning.n > 30 && cost.burning.median < 0.5 && cost.samples > 5, cost)
  check('No page errors or GPU errors on the default page', !liveErrors.length, liveErrors.slice(0, 5))
  await live.close()

  // ── WebGL2: the same field and the same spread on three.js's fallback backend ──
  const gl = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const glErrors = []
  listen(gl, glErrors)
  await open(gl, '?talk=off&build=0&q=low&webgl=1')
  const glSpread = await gl.evaluate(async (arena) => {
    const p = window.village.physics
    p.engine.addToy(arena)
    p.fire.ignite('arena/oak')
    let caughtAt = null
    for (let t = 0; t < 30 && caughtAt === null; t += 0.5) {
      await p.fire.run(0.5)
      if (p.fire.burning('arena/cushion')) caughtAt = t + 0.5
    }
    const kettle = p.fire.list().find((x) => x.thing === 'arena/kettle')
    return { backend: p.fire.backend, caughtAt, kettle: { state: kettle.state, temp: kettle.temp } }
  }, ARENA)
  report.webgl = glSpread
  check('On WebGL2 (?webgl=1) the field runs the same: the felt catches from the wood within a second of WebGPU\'s time, the steel heats and does not burn', glSpread.backend === 'WebGL2' && glSpread.caughtAt !== null && Math.abs(glSpread.caughtAt - spread.caughtAt) <= 1 && glSpread.kettle.state === 'cold' && glSpread.kettle.temp > 60 && !glErrors.length, { ...glSpread, webgpu: spread.caughtAt, errors: glErrors.slice(0, 3) })
} catch (error) {
  check('the check ran to the end', false, String(error?.stack ?? error))
} finally {
  await browser.close().catch(() => {})
  for (const child of [...children]) await new Promise((resolve) => { child.once('exit', resolve); process.kill(-child.pid, 'SIGTERM') })
}
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ ok: !failed.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name), report }, null, 1))
process.exit(failed.length ? 1 : 0)
