// Headless proof of toys made from a sentence (#88). Three asks ("build a marble run on the
// table", "make a seesaw", "set up ten pins and a ball") go through the notepad's physics path
// (the host's ruler, the page's checks, the engine's addToy), and each toy is then played in the
// real engine: the marble released at the top reaches the bottom and stays on the surface; a
// block dropped on the seesaw's high end raises the other; a rolled ball knocks pins over. Keep,
// Undo (the toy goes, the world is as it was) and Try another (the new one replaces it) work; a
// toy off its surface or with an unknown gadget is refused in plain words and changes nothing;
// the page's checker clamps and refuses hostile data; the route check sends toy lines to physics.
// With --agent=claude: --trials per toy ask on the --toy-model, one rules ask on the --rules-model, pass counts and latency as they are,
// and the dividing line between furnish and physics through the real router.
// Usage: node scripts/check-physics-toys.mjs [--dev=5372] [--host=5373] [--agent=claude] [--toy-model=sonnet] [--rules-model=haiku] [--trials=3] [--only=game] [--shots-dir=dir] [--out=file.json]
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pairLink } from './pairing.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const rulesModel = opt('rules-model') ?? 'haiku'
const model = opt('toy-model') ?? 'sonnet'
const trials = Number(opt('trials') ?? (agent === 'stub' ? 1 : 3))
const shotsDir = opt('shots-dir')
/** With --agent=claude: only these asks (by kind: marble, seesaw, pins, game), and neither the rules ask nor the router's line. */
const only = opt('only')?.split(',')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'toys-'))
const hostPort = Number(opt('host') ?? 5373)
const devPort = Number(opt('dev') ?? 5372)
const base = `http://localhost:${devPort}/`
const checks = []
const report = { agent, model: agent === 'stub' ? 'stub' : model, rulesModel, trials: [] }
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 600) ?? '')
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

const ASKS = [
  { kind: 'marble', text: 'build a marble run on the table' },
  { kind: 'seesaw', text: 'make a seesaw' },
  { kind: 'pins', text: 'set up ten pins and a ball' },
  // A game, not only a toy (#108): a round, a score and an end, from the logic parts.
  { kind: 'game', text: 'make a skittles game with a score: three throws to knock them all down' },
]

/**
 * Plays the toy on trial in the page and says whether it works, by kind. Runs in the page: the
 * engine's own WorldApi, the physics handle's advance, and a probe toy for the seesaw.
 */
async function works(page, kind) {
  return page.evaluate(async (kind) => {
    const p = window.village.physics
    const w = p.engine.world
    const trial = p.made.state().trial
    if (!trial) return { pass: false, why: 'no toy on trial' }
    const id = trial.id
    const keys = w.keys().filter((k) => k.startsWith(`${id}/`))
    const things = keys.map((k) => w.thing(k))
    const moving = things.filter((t) => t.motion === 'dynamic')
    const surface = p.made.surfaces().find((s) => s.label === trial.on) ?? p.made.surfaces()[0]
    const rotate = (q, v) => {
      const [x, y, z, s] = q, [a, b, c] = v
      const ix = s * a + y * c - z * b, iy = s * b + z * a - x * c, iz = s * c + x * b - y * a, iw = -x * a - y * b - z * c
      return [ix * s + iw * -x + iy * -z - iz * -y, iy * s + iw * -y + iz * -x - ix * -z, iz * s + iw * -z + ix * -y - iy * -x]
    }
    // What was built, for a report on a toy that did not work.
    const built = things.map((t) => ({ id: t.key.slice(id.length + 1), shape: t.shape, motion: t.motion, at: t.local.map((v) => +v.toFixed(3)) }))
    const size = (t) => (t.shape.kind === 'sphere' ? t.shape.radius : t.shape.kind === 'box' ? Math.max(...t.shape.half) : t.shape.halfHeight + t.shape.radius)
    const onSurface = (l, margin = 0.05) => Math.abs(l[0]) <= surface.half[0] + margin && Math.abs(l[2]) <= surface.half[1] + margin && l[1] >= -0.03
    if (kind === 'game') {
      // Whatever was built is played the way a person would: the ball flung at the standing pieces, a few times.
      const gadgets = p.snapshot().gadgets
      const mine = Object.keys(gadgets).filter((g) => g.startsWith(`${id}/`))
      const rounds = mine.filter((g) => 'playing' in gadgets[g].state)
      const counters0 = Object.fromEntries(mine.filter((g) => 'value' in gadgets[g].state).map((g) => [g, gadgets[g].state.value]))
      const fired = (port) => rounds.reduce((a, g) => a + (p.signals()[`${g}.${port}`] ?? 0), 0)
      const balls = moving.filter((t) => t.shape.kind === 'sphere').sort((a, b) => b.shape.radius - a.shape.radius)
      const pieces = moving.filter((t) => t.shape.kind !== 'sphere')
      if (!rounds.length) return { pass: false, why: 'no game gadget in it', built }
      if (!balls.length || !pieces.length) return { pass: false, why: 'nothing to throw, or nothing to throw it at', built }
      const ball = balls[0].key
      const start = Object.fromEntries(moving.map((t) => [t.key, t.position]))
      const centre = pieces.reduce((a, t) => a.map((v, i) => v + t.position[i] / pieces.length), [0, 0, 0])
      let throws = 0
      for (let t = 0; t < 6 && !fired('won') && !fired('lost'); t++) {
        const at = w.thing(ball).position
        const d = [centre[0] - at[0], 0, centre[2] - at[2]], n = Math.hypot(...d)
        // Off its surface, or resting among the pieces: nothing more to throw.
        if (!onSurface(w.thing(ball).local, 0.1) || n < 0.05) break
        w.setVelocity(ball, d.map((v) => (v / n) * 2.2))
        throws++
        p.advance(4.5)
      }
      // A last throw may still be deciding the round.
      for (let i = 0; i < 8 && !fired('won') && !fired('lost'); i++) p.advance(1)
      const now = p.snapshot().gadgets
      const scored = Object.entries(counters0).filter(([g, v]) => now[g].state.value !== v).map(([g]) => g.slice(id.length + 1))
      const down = pieces.filter((t) => w.upright(t.key) < 0.7).length
      const ended = fired('won') ? 'won' : fired('lost') ? 'lost' : null
      // Played twice: within ten seconds of the end everything stands where it started and the round is over.
      let again = false
      for (let i = 0; i < 20 && ended && !again; i++) {
        p.advance(0.5)
        again = moving.every((t) => Math.hypot(...w.thing(t.key).position.map((v, k) => v - start[t.key][k])) < 0.02 && w.upright(t.key) > 0.98) && rounds.every((g) => !p.snapshot().gadgets[g].state.playing)
      }
      const pass = fired('started') > 0 && scored.length > 0 && Boolean(ended)
      return { pass, why: pass ? '' : !fired('started') ? 'a throw started no round' : !scored.length ? 'nothing was scored' : 'the round never ended', started: fired('started'), throws, down, pieces: pieces.length, scored, ended, again, gadgets: mine.length, parts: keys.length, ...(pass ? {} : { built }) }
    }
    if (kind === 'marble') {
      const balls = moving.filter((t) => t.shape.kind === 'sphere')
      if (!balls.length) return { pass: false, why: 'no ball' }
      // Released from where it was made (it may have run already while the picture was taken).
      for (const b of balls) w.respawn(b.key, 0)
      p.advance(1 / 60)
      const marble = balls.map((b) => w.thing(b.key)).sort((a, b) => b.local[1] - a.local[1])[0]
      const fixed = things.filter((t) => t.motion === 'static')
      const low = Math.min(...fixed.map((t) => t.local[1]))
      const start = [...marble.local]
      const range = p.advance(8, [marble.key])[marble.key]
      const end = w.thing(marble.key)
      const travelled = range.max[0] - range.min[0] + range.max[2] - range.min[2]
      const fell = start[1] - end.local[1]
      const pass = onSurface(end.local) && fell >= 0.6 * (start[1] - low) && travelled > 0.15
      return { pass, ...(pass ? {} : { built }), why: pass ? '' : !onSurface(end.local) ? 'the marble left the surface' : fell < 0.6 * (start[1] - low) ? 'the marble stopped high up' : 'the marble barely moved', start: start.map((v) => +v.toFixed(3)), end: end.local.map((v) => +v.toFixed(3)), travelled: +travelled.toFixed(3), parts: keys.length }
    }
    if (kind === 'seesaw') {
      const boxes = moving.filter((t) => t.shape.kind === 'box')
      const plank = boxes.sort((a, b) => Math.max(b.shape.half[0], b.shape.half[2]) - Math.max(a.shape.half[0], a.shape.half[2]))[0]
      if (!plank) return { pass: false, why: 'no moving plank' }
      p.advance(1)
      const axis = plank.shape.half[0] >= plank.shape.half[2] ? [plank.shape.half[0], 0, 0] : [0, 0, plank.shape.half[2]]
      const ends = () => {
        const t = w.thing(plank.key)
        const d = rotate(t.rotation, axis)
        return [[t.position[0] + d[0], t.position[1] + d[1], t.position[2] + d[2]], [t.position[0] - d[0], t.position[1] - d[1], t.position[2] - d[2]]]
      }
      const before = ends()
      const hi = before[0][1] >= before[1][1] ? 0 : 1, lo = 1 - hi
      // A small block let go 3 cm over the high end, 70% of the way out from the middle.
      const mid = w.thing(plank.key).position
      const at = [0, 1, 2].map((i) => mid[i] + 0.7 * (before[hi][i] - mid[i]))
      const probe = { id: 'probe', label: 'Probe', frame: { at: [at[0], at[1] + 0.035 + 0.03 + 0.03, at[2]], yaw: 0, tilt: 0 }, inputs: {}, gadgets: [], wires: [], parts: [{ id: 'block', shape: { kind: 'box', half: [0.035, 0.035, 0.035] }, material: 'walnut', motion: 'dynamic', mass: 0.8, at: [0, 0, 0] }] }
      p.engine.addToy(probe)
      p.advance(2.5)
      const after = ends()
      p.engine.removeToy('probe')
      const rose = after[lo][1] - before[lo][1]
      const pass = rose >= 0.04
      return { pass, ...(pass ? {} : { built }), why: pass ? '' : 'the other end did not rise', rose: +rose.toFixed(3), sank: +(before[hi][1] - after[hi][1]).toFixed(3), parts: keys.length }
    }
    // Pins: roll the largest ball at the middle of the rest, then count what tipped or was knocked away.
    const balls = moving.filter((t) => t.shape.kind === 'sphere').sort((a, b) => b.shape.radius - a.shape.radius)
    const ball = balls[0]
    const pins = moving.filter((t) => t !== ball)
    if (!ball || pins.length < 3) return { pass: false, why: 'no ball and pins' }
    const c = [0, 1, 2].map((i) => pins.reduce((s, t) => s + t.position[i], 0) / pins.length)
    const d = [c[0] - ball.position[0], 0, c[2] - ball.position[2]]
    const n = Math.hypot(d[0], d[2])
    const home = new Map(pins.map((t) => [t.key, [...t.position]]))
    w.setVelocity(ball.key, [(d[0] / n) * 2.5, 0, (d[2] / n) * 2.5])
    p.advance(4)
    const fallen = pins.filter((t) => {
      const now = w.thing(t.key)
      const up = rotate(now.rotation, [0, 1, 0])
      const moved = Math.hypot(now.position[0] - home.get(t.key)[0], now.position[2] - home.get(t.key)[2])
      return up[1] < Math.cos(Math.PI / 4) || moved > 2 * size(t)
    }).length
    const need = Math.min(5, pins.length)
    return { pass: fallen >= need, ...(fallen >= need ? {} : { built }), why: fallen >= need ? '' : `only ${fallen} of ${pins.length} fell`, fallen, pins: pins.length, parts: keys.length }
  }, kind)
}

try {
  await run('node', ['src/villager-cli.ts', '--agent', agent, '--rules-model', rulesModel, '--toy-model', model, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
  await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
  if (shotsDir) await mkdir(shotsDir, { recursive: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  await page.goto(await pairLink(base, root))
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.made, null, { timeout: 30_000 })
  const surfaces = await page.evaluate(() => window.village.physics.made.surfaces())
  check('the page offers the table and the floor of the room the person is in', surfaces.map((s) => s.id).join() === 'table,floor', surfaces.map((s) => s.label))

  // A fingerprint of what moves and what is built, to see that Undo and a refusal leave the world as it was.
  // A fingerprint of the world: what is built (things, gadgets, joints, wires), the rules, the pinball ball's place and what burns or is wet.
  const world = () => page.evaluate(() => {
    const p = window.village.physics
    const w = p.engine.world
    // Cards drawn are a running count, not something built: a toy with a score card draws, and taking it out does not undraw.
    return { census: { ...p.census(), draws: 0 }, made: w.keys().filter((k) => k.startsWith('made-')).length, ball: w.thing('pinball/ball')?.position.map((v) => +v.toFixed(3)), rules: JSON.stringify(p.rules()), trial: p.made.state().trial?.id ?? null, kept: p.made.state().kept.join() }
  })
  const ask = (text, as = { toy: true }) => page.evaluate(([t, as]) => window.village.physics.ask(t, as), [text, as])
  // The pinball ball is left out: typing on the notepad reaches its keys, and no toy ask touches it.
  const same = (a, b) => JSON.stringify({ ...a, ball: 0 }) === JSON.stringify({ ...b, ball: 0 })

  if (agent === 'stub') {
    const baseline = await world()
    for (const a of ASKS) {
      const r = await ask(a.text)
      check(`"${a.text}" makes a toy on trial with a Keep / Undo / Try another tag`, r.ok && r.toy && (await page.evaluate(() => window.village.physics.made.state().tag !== null)), { ok: r.ok, toy: r.toy, reason: r.reason })
      if (shotsDir) {
        const s = surfaces.find((x) => x.id === r.toy?.on)
        const at = s?.at ?? [0, 0, 0]
        const eye = s?.id === 'table' ? [at[0] + 0.55, at[1] + 0.6, at[2] + 0.85] : [at[0] + 0.3, at[1] + 1.1, at[2] + 1.6]
        await page.evaluate(([eye, at]) => window.village.physics.look(eye, at), [eye, [at[0], at[1] + 0.1, at[2]]])
        await page.waitForTimeout(1600)
        await page.screenshot({ path: join(shotsDir, `toy-${a.kind}.png`) })
        await page.evaluate(() => window.village.physics.look(null))
      }
      const played = await works(page, a.kind)
      check(`the ${a.kind} works in the engine`, played.pass, played)
      if (a.kind === 'game') check('the game made from a sentence is a game: a throw starts a round, pieces knocked down score on its card, the round is won or lost, and it sets itself up to be played again', played.pass && played.down > 0 && played.again, played)
      const undone = await page.evaluate(() => window.village.physics.made.undo())
      const after = await world()
      check(`Undo takes the ${a.kind} away: things, gadgets, joints and wires back to the baseline`, undone && after.made === 0 && same(after.census, baseline.census) && after.rules === baseline.rules, { baseline, after })
    }

    // Undo and a replacing ask act on the toy only: a rules change made after the toy stays.
    await ask('make a seesaw')
    await page.evaluate(() => window.village.physics.preset('moon'))
    const moon = (await world()).rules
    await ask('set up ten pins and a ball')
    const replaced = await world()
    await page.evaluate(() => window.village.physics.made.undo())
    const undoneMoon = await world()
    check('a replacing ask and Undo leave a later rules change (the moon) as it is', replaced.rules === moon && undoneMoon.rules === moon && undoneMoon.made === 0 && same(undoneMoon.census, baseline.census), { moon, replaced: replaced.rules === moon, undone: undoneMoon })
    await page.evaluate(() => window.village.physics.preset('normal'))

    // Try another: the one you have stays until the new one is built, then is replaced.
    await ask('make a seesaw')
    const first = await page.evaluate(() => window.village.physics.made.state().trial)
    const again = await page.evaluate(() => window.village.physics.made.another())
    const ids = await page.evaluate(([a]) => ({ old: window.village.physics.engine.hasToy(a), trial: window.village.physics.made.state().trial }), [first.id])
    check('Try another replaces the toy on trial with a new one', again?.ok && ids.trial && ids.trial.id !== first.id && !ids.old && /another take/.test(ids.trial.text), { first: first.id, again, now: ids.trial?.id, oldStillBuilt: ids.old })
    await page.evaluate(() => window.village.physics.made.undo())

    // A Try another that fails, or that answers rules and acts with no toy, leaves the world exactly as it was.
    for (const [tag, what] of [['[stub-again-off]', 'a toy off its surface'], ['[stub-again-rules]', 'rules and rain but no toy']]) {
      await ask(`${tag} make a seesaw`)
      const before = await world()
      const fire = await page.evaluate(() => JSON.stringify(window.village.physics.fire.stats?.() ?? null))
      const r = await page.evaluate(() => window.village.physics.made.another())
      const after = await world()
      const raining = await page.evaluate(() => window.village.physics.events().some((e) => e.kind === 'rules' && e.rules.bounce === 1.3))
      check(`a Try another that brings ${what} changes nothing and the toy on trial stays`, r && !r.ok && same(before, after) && !raining, { r, before, after, raining, fire })
      await page.evaluate(() => window.village.physics.made.undo())
    }

    // Refusals change nothing and say why.
    for (const [text, words] of [['[stub-toy-off] build a marble run on the table', /would stand off the kitchen table/], ['[stub-toy-junk] make a seesaw', /no gadget called rocket/], ['[stub-toy-flame] make a seesaw', /can't have a flame/]]) {
      const before = await world()
      const r = await ask(text)
      const after = await world()
      check(`a refused toy says why in plain words and changes nothing (${text.slice(1, text.indexOf(']'))})`, !r.ok && r.toy && words.test(r.reason) && same(before, after), { reason: r.reason, before, after })
    }

    // Toy lines the router marks as toys reach the toy ask from the notepad, whatever the page's word list says.
    {
      const lines = ['make a see saw', 'build a catapult on the table', 'set up a ramp and a ball', 'build a pendulum']
      const reached = []
      for (const line of lines) {
        const n = await page.evaluate(() => window.village.physics.asked().length)
        await page.keyboard.press('Escape')
        await page.keyboard.type(line, { delay: 0 })
        await page.keyboard.press('Enter')
        let s
        for (let i = 0; i < 100; i++) {
          s = await page.evaluate((n) => ({ route: window.village.talk.state().input.routes.at(-1), asked: window.village.physics.asked().slice(n).at(-1) }), n)
          if (s.asked) break
          await page.waitForTimeout(100)
        }
        reached.push({ line, route: s.route?.route, askedAs: s.asked?.as, text: s.asked?.text })
        await page.evaluate(() => window.village.physics.made.undo())
      }
      // Typing reaches the page's keys too (a space plunges the pinball ball): every moving thing home again.
      await page.evaluate(() => window.village.physics.reset())
      await page.waitForTimeout(300)
      const { asksPhysics } = await page.evaluate(async (lines) => { const m = await import('/src/talk/route-check.ts'); return { asksPhysics: lines.map((l) => m.asksPhysics(l)) } }, lines)
      check('"make a see saw", "build a catapult on the table", "set up a ramp and a ball" and "build a pendulum" reach the toy ask from the notepad', reached.every((r, i) => r.route === 'physics' && r.text === lines[i] && r.askedAs?.toy === true), { reached, wordList: asksPhysics })
    }

    // A toy answer that also carries rules and acts builds the toy and applies nothing else.
    {
      const before = await world()
      const n = await page.evaluate(() => window.village.physics.events().length)
      const r = await ask('[stub-toy-rules] make a seesaw')
      const after = await world()
      const later = await page.evaluate((n) => window.village.physics.events().slice(n).map((e) => e.kind), n)
      check('a toy answer carrying moon gravity and rain builds the toy and changes no rules', r.ok && r.toy && after.rules === before.rules && !later.includes('rules'), { toy: r.toy, rulesSame: after.rules === before.rules, later })
      const n2 = await page.evaluate(() => window.village.physics.asked().length)
      const flagged = await ask('build a catapult on the table')
      check('a toy ask whose answer brings rules and no toy changes nothing and says so', !flagged.ok && /no toy came back/.test(flagged.reason) && (await world()).rules === after.rules, { flagged, n2 })
      await page.evaluate(() => window.village.physics.made.undo())
    }

    // Keep; one toy to a surface: a kept toy on the floor; pins asked for the floor do not fit the table either; the next goes to the free table; then there is no room.
    await ask('make a seesaw on the floor')
    const kept = await page.evaluate(() => (window.village.physics.made.keep(), window.village.physics.made.state()))
    check('Keep keeps the toy for the visit and closes the tag', !kept.trial && kept.kept.length === 1 && kept.tag === null && (await page.evaluate((id) => window.village.physics.engine.hasToy(id), kept.kept[0])), kept)
    const tooBig = await ask('set up ten pins and a ball on the floor')
    check('a toy for a taken surface that does not fit the free one says both, plainly', !tooBig.ok && /already a toy on the kitchen floor, and it doesn't fit on the kitchen table/.test(tooBig.reason), tooBig)
    const moved = await ask('make a seesaw on the floor')
    check('a toy asked for where a kept toy stands goes on the other free surface instead', moved.ok && moved.toy?.on === 'table', moved.toy ?? moved)
    await page.evaluate(() => window.village.physics.made.keep())
    const full = await world()
    const none = await ask('make a seesaw')
    check('with a kept toy on every offered surface, a new toy is refused in plain words and nothing changes', !none.ok && /already a toy on/.test(none.reason) && same(full, await world()), none)
    // The cap, on the toy keeper itself with a stand-in world: three kept on three surfaces, a fourth refused before anything is built.
    const capped = await page.evaluate(async () => {
      const { MadeToys, MAX_KEPT } = await import('/src/physics/made.ts')
      const built = []
      const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }
      const ctx = { on() {}, effect() {}, stage: { camera: { matrixWorldInverse: identity, projectionMatrix: identity } } }
      const keeper = new MadeToys(ctx, { addToy: (t) => built.push(t.id), removeToy() {} })
      const toy = (id) => ({ id, label: 'T', frame: { at: [0, 0, 0], yaw: 0, tilt: 0 }, parts: [], gadgets: [], wires: [], inputs: {} })
      const out = []
      for (let i = 0; i < MAX_KEPT + 1; i++) {
        const r = keeper.build(toy(`t${i}`), { text: 'x', person: 'alex', note: '', on: `surface ${i}`, height: 0.3 })
        out.push(r.ok ? 'built' : r.reason)
        keeper.keep()
      }
      document.querySelectorAll('.made-tag').forEach((t) => t.remove())
      return { MAX_KEPT, out, built }
    })
    check(`kept toys are capped at ${capped.MAX_KEPT}: the next is refused in plain words before it is built`, capped.out.slice(0, -1).every((o) => o === 'built') && /toys are kept already/.test(capped.out.at(-1)) && capped.built.length === capped.MAX_KEPT, capped)

    // A loop of wires through a counter with a display, under a heavy ball on a sensor: the checker refuses it, and built anyway (straight through addToy) it stays cheap.
    const loop = await page.evaluate(async () => {
      const p = window.village.physics
      const { checkMadeToy } = await import('/src/engine/made.ts')
      const s = p.made.surfaces()[1]
      const toy = (wires) => ({ label: 'Loop', parts: [{ id: 'pad', shape: { kind: 'box', half: [0.1, 0.01, 0.1] }, material: 'maple', at: [0, 0.01, 0] }, { id: 'card', shape: { kind: 'box', half: [0.05, 0.03, 0.005] }, material: 'maple', at: [0, 0.05, -0.15] }, { id: 'ball', shape: { kind: 'sphere', radius: 0.05 }, material: 'steel', motion: 'dynamic', mass: 10, at: [0, 0.07, 0] }],
        gadgets: [{ id: 's', kind: 'sensor', part: 'pad', knobs: { threshold: 0 } }, { id: 'c', kind: 'counter', display: 'card' }], wires })
      const reason = (w) => { const r = checkMadeToy(toy(w), s, 'made-x'); return 'reason' in r ? r.reason : null }
      const twice = reason([{ from: 's.hit', to: 'c.add' }, { from: 's.hit', to: 'c.add' }])
      const self = reason([{ from: 's.hit', to: 'c.add' }, { from: 'c.changed', to: 'c.add' }])
      const fine = reason([{ from: 's.hit', to: 'c.add' }])
      const spec = { id: 'loop', frame: { at: [s.at[0], s.at[1], s.at[2]], yaw: 0, tilt: 0 }, inputs: {}, ...toy([{ from: 's.hit', to: 'c.add' }, { from: 'c.changed', to: 'c.add' }, { from: 'c.changed', to: 'c.add' }]) }
      p.advance(0.5)
      const draws0 = p.census().draws
      let t0 = performance.now()
      p.advance(3)
      const quiet = performance.now() - t0
      p.engine.addToy(spec)
      t0 = performance.now()
      p.advance(3)
      const looped = performance.now() - t0
      const fired = p.signals()['loop/c.changed'] ?? 0
      const draws = p.census().draws - draws0
      p.engine.removeToy('loop')
      return { twice, self, fine, quietMs: Math.round(quiet), loopedMs: Math.round(looped), fired, steps: 180, draws }
    })
    check('the checker refuses a wire twice and a counter wired back into itself, and keeps a plain wire', /twice/.test(loop.twice) && /loop/.test(loop.self) && loop.fine === null, loop)
    check('a counter loop built anyway draws its card once per sync, not per signal, and fires at most the engine\'s 200 queued signals a step over its two wires', loop.draws <= 2 && loop.fired <= 2 * 200 * loop.steps, loop)

    // Drawn looks: build and take out 20 toys with their own colours; textures, geometries and looks come back to where they were.
    const memory = await page.evaluate(async () => {
      const p = window.village.physics
      const before = { memory: p.memory(), census: p.census() }
      for (let i = 0; i < 20; i++) {
        const paint = `#${(0x3a5f20 + i * 0x0b1d07).toString(16).slice(-6)}`
        p.engine.addToy({ id: `probe-${i}`, label: 'Probe', frame: { at: [2.1, 1.6, 0.45], yaw: 0, tilt: 0 }, inputs: {}, gadgets: [{ id: 'score', kind: 'counter', display: 'a' }], wires: [], parts: [{ id: 'a', shape: { kind: 'box', half: [0.05, 0.05, 0.05] }, material: 'maple', paint, at: [0, 0, 0] }, { id: 'b', shape: { kind: 'sphere', radius: 0.03 }, material: 'felt', paint, motion: 'dynamic', at: [0.2, 0, 0] }] })
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        p.engine.removeToy(`probe-${i}`)
      }
      await new Promise((r) => setTimeout(r, 300))
      return { before, after: { memory: p.memory(), census: p.census() } }
    })
    check('20 toys in their own colours, each with a score card, built and taken out leave no looks, cards, textures or geometries behind', memory.after.census.looks === memory.before.census.looks && memory.after.census.displays === memory.before.census.displays && memory.after.memory.textures <= memory.before.memory.textures && memory.after.memory.geometries <= memory.before.memory.geometries, memory)

    // The page's checker on hostile data, directly.
    const hostile = await page.evaluate(async () => {
      const { checkMadeToy, MADE } = await import('/src/engine/made.ts')
      const s = window.village.physics.made.surfaces()[1]
      const part = (o) => ({ id: 'a', shape: { kind: 'box', half: [0.05, 0.05, 0.05] }, material: 'maple', at: [0, 0.05, 0], ...o })
      const reason = (t) => { const r = checkMadeToy(t, s, 'made-x'); return 'reason' in r ? r.reason : null }
      const big = checkMadeToy({ parts: [part({ shape: { kind: 'box', half: [9, 0.05, 1e9] } })] }, s, 'made-x')
      const proto = checkMadeToy(JSON.parse('{"label": "<b>x</b>", "__proto__": {"polluted": 1}, "parts": [{"id": "a", "shape": {"kind": "sphere", "radius": 0.02}, "material": "steel", "motion": "dynamic", "mass": 1e6, "at": [0, 0.02, 0], "hidden": true, "paint": "red", "constructor": 1}]}'), s, 'made-x')
      return {
        material: reason({ parts: [part({ material: 'unobtainium' })] }),
        villager: reason({ parts: [part({ material: 'villager' })] }),
        kinematic: reason({ parts: [part({ motion: 'kinematic' })] }),
        nan: reason({ parts: [part({ at: [0, 'NaN', 0] })] }),
        tooMany: reason({ parts: Array.from({ length: MADE.parts + 1 }, (_, i) => part({ id: `p${i}` })) }),
        tooManyMoving: reason({ parts: Array.from({ length: MADE.moving + 1 }, (_, i) => part({ id: `p${i}`, motion: 'dynamic', at: [-0.5 + i * 0.06, 0.05, 0], shape: { kind: 'sphere', radius: 0.02 } })) }),
        wire: reason({ parts: [part()], gadgets: [{ id: 's', kind: 'sensor', part: 'a' }], wires: [{ from: 's.hit', to: 'nowhere.fire' }] }),
        wrongPort: reason({ parts: [part()], gadgets: [{ id: 's', kind: 'sensor', part: 'a' }, { id: 'k', kind: 'kick', part: 'a' }], wires: [{ from: 'k.fire', to: 's.hit' }] }),
        gadgetPart: reason({ parts: [part()], gadgets: [{ id: 'k', kind: 'kick', part: 'ghost' }] }),
        pivotNoPart: reason({ parts: [part({ motion: 'dynamic' })], gadgets: [{ id: 'p', kind: 'pivot', anchor: [0, 0, 0], axis: [0, 0, 1] }] }),
        pivotNoAnchor: reason({ parts: [part({ motion: 'dynamic' })], gadgets: [{ id: 'p', kind: 'pivot', part: 'a', axis: [0, 0, 1] }] }),
        pivotStatic: reason({ parts: [part()], gadgets: [{ id: 'p', kind: 'pivot', part: 'a', anchor: [0, 0.05, 0], axis: [0, 0, 1] }] }),
        flame: reason({ parts: [part()], gadgets: [{ id: 'f', kind: 'flame', part: 'a', knobs: { lit: 1 } }] }),
        hinge: reason({ parts: [part({ motion: 'dynamic' })], gadgets: [{ id: 'h', kind: 'hinge', part: 'a', anchor: [0, 0, 0], axis: [0, 1, 0] }] }),
        anchorOff: reason({ parts: [part({ motion: 'dynamic' })], gadgets: [{ id: 'p', kind: 'pivot', part: 'a', anchor: [5, 0, 0], axis: [0, 0, 1] }] }),
        off: reason({ parts: [part({ at: [s.half[0], 0.05, 0] })] }),
        under: reason({ parts: [part({ at: [0, -0.2, 0] })] }),
        tooTall: reason({ parts: [part({ at: [0, s.height, 0] })] }),
        clampedBig: 'reason' in big ? big.reason : big.clamped,
        proto: 'reason' in proto ? proto.reason : { clamped: proto.clamped, part: proto.toy.parts[0], label: proto.toy.label, polluted: {}.polluted ?? null, inputs: proto.toy.inputs },
      }
    })
    const refusedAll = ['material', 'villager', 'kinematic', 'nan', 'tooMany', 'tooManyMoving', 'wire', 'wrongPort', 'gadgetPart', 'anchorOff', 'off', 'under', 'tooTall'].every((k) => typeof hostile[k] === 'string')
    check('the page refuses unknown materials, people as parts, kinematic parts, non-numbers, too many parts, wires to nowhere, wrong ports, missing parts and anything off its surface', refusedAll, hostile)
    check('the checker refuses, before building, a pivot with no part, no anchor or a part that cannot move, and a flame or hinge (outside the made kit)', /no part to work on/.test(hostile.pivotNoPart) && /no anchor/.test(hostile.pivotNoAnchor) && /can't move/.test(hostile.pivotStatic) && /can't have a flame/.test(hostile.flame) && /can't have a hinge/.test(hostile.hinge), { pivotNoPart: hostile.pivotNoPart, pivotNoAnchor: hostile.pivotNoAnchor, pivotStatic: hostile.pivotStatic, flame: hostile.flame, hinge: hostile.hinge })
    check('a huge box is clamped (then refused for leaving the surface) and a hostile part is cleaned: mass clamped, hidden and bad paint dropped, label plain, nothing polluted', typeof hostile.clampedBig === 'string' && /off the/.test(hostile.clampedBig) && hostile.proto.part.mass === 10 && !('hidden' in hostile.proto.part) && !('paint' in hostile.proto.part) && !/[<>]/.test(hostile.proto.label) && hostile.proto.polluted === null && hostile.proto.clamped.includes('a.mass'), hostile)
  } else {
    // The real model: trials per ask, each one checked, played and undone.
    for (const a of ASKS.filter((x) => !only || only.includes(x.kind))) {
      for (let i = 0; i < trials; i++) {
        const t0 = Date.now()
        const r = await ask(a.text)
        const ms = Date.now() - t0
        const played = r.ok && r.toy ? await works(page, a.kind) : null
        if (shotsDir && r.ok && r.toy && i === 0) {
          const s = surfaces.find((x) => x.id === r.toy.on)
          const at = s.at
          const eye = s.id === 'table' ? [at[0] + 0.55, at[1] + 0.6, at[2] + 0.85] : [at[0] + 0.3, at[1] + 1.1, at[2] + 1.6]
          await page.evaluate(([eye, at]) => window.village.physics.look(eye, at), [eye, [at[0], at[1] + 0.1, at[2]]])
          await page.waitForTimeout(1600)
          await page.screenshot({ path: join(shotsDir, `${model}-${a.kind}-after-play.png`) })
          await page.evaluate(() => window.village.physics.look(null))
        }
        await page.evaluate(() => window.village.physics.made.undo())
        const row = { ask: a.text, trial: i + 1, built: Boolean(r.ok && r.toy), works: Boolean(played?.pass), reason: r.ok ? (r.toy ? played?.why || '' : 'no toy in the answer') : r.reason ?? r.why, ms, hostMs: r.hostMs, toy: r.ok && r.toy ? { label: r.toy.label, on: r.toy.on, parts: r.toy.parts, clamped: r.toy.clamped.length } : null, played }
        if (a.kind === 'game' && played) row.round = { started: played.started, ended: played.ended, down: played.down, pieces: played.pieces, scored: played.scored, again: played.again, gadgets: played.gadgets }
        report.trials.push(row)
        console.error(`${model} | ${a.kind} #${i + 1} | built ${row.built} | works ${row.works} | ${ms} ms | ${row.reason}`)
      }
    }
    const by = (kind) => report.trials.filter((t) => t.ask === ASKS.find((a) => a.kind === kind).text)
    report.summary = Object.fromEntries(ASKS.filter((x) => !only || only.includes(x.kind)).map((a) => {
      const rows = by(a.kind)
      const ms = rows.map((r) => r.ms).sort((x, y) => x - y)
      return [a.kind, { built: rows.filter((r) => r.built).length, works: rows.filter((r) => r.works).length, of: rows.length, medianMs: ms[Math.floor(ms.length / 2)], maxMs: ms[ms.length - 1] }]
    }))
    const all = report.trials
    report.summary.total = { built: all.filter((r) => r.built).length, works: all.filter((r) => r.works).length, of: all.length }
    console.error(JSON.stringify(report.summary))
    check(`${model}: toys built and checked as they are (no pass bar; see the summary)`, true, report.summary.total)

    if (!only) {
    // A rules ask, not flagged as a toy: the host answers it on the rules model with the short prompt.
    const t0 = Date.now()
    const rules = await ask('make gravity like the moon', {})
    report.rulesAsk = { ok: rules.ok, ms: Date.now() - t0, hostMs: rules.hostMs, models: rules.models, gravity: rules.rules?.gravity, toy: Boolean(rules.toy) }
    console.error(`rules ask | ${JSON.stringify(report.rulesAsk)}`)
    check(`a rules ask is answered on the rules model (${rulesModel}), changes gravity and builds no toy`, rules.ok && !rules.toy && rules.rules.gravity[1] > -5 && rules.models.some((m) => m.includes(rulesModel)), report.rulesAsk)
    await page.evaluate(() => window.village.physics.preset('normal'))

    // The dividing line through the real router: furniture stays furnish, toys go to physics.
    const lines = [
      ['a wooden chair by the window', 'furnish'], ['a seesaw', 'physics'], ['build a marble run on the table', 'physics'],
      ['set up ten pins and a ball', 'physics'], ['make a seesaw', 'physics'], ['put a wooden toy box in the corner', 'furnish'],
    ]
    const routed = await page.evaluate(async ([lines]) => {
      const { mayRoute, asksPhysics } = await import('/src/talk/route-check.ts')
      const cast = Object.entries(window.village.talk.state().cast)
      const me = window.village.talk.state().cast.alex.name
      const villagers = cast.map(([id, c]) => ({ id, name: c.name, role: 'Helper' }))
      const out = []
      for (const [text] of lines) {
        const res = await fetch('/villager/api/people/alex/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, primary: me, villagers }) })
        const body = await res.json().catch(() => ({}))
        out.push({ text, mayRoute: mayRoute({ text, others: [] }), asksPhysics: asksPhysics(text), route: body.routed?.route ?? `error ${res.status} ${body.error ?? ''}` })
      }
      return out
    }, [lines])
    const right = routed.filter((r, i) => r.route === lines[i][1] && r.mayRoute && (lines[i][1] !== 'physics' || r.asksPhysics))
    report.router = routed
    check(`the real router sends toy lines to physics and furniture to furnish (${right.length} of ${lines.length})`, right.length === lines.length, routed)
    }
  }
  check('no page errors', errors.length === 0, errors)
  await browser.close()
} catch (error) {
  check('the check ran', false, String(error?.stack ?? error).slice(0, 800))
} finally {
  for (const child of children) try { process.kill(-child.pid) } catch {}
}
const out = opt('out')
if (out) await writeFile(out, JSON.stringify({ checks, report }, null, 2))
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ agent, model: report.model, passed: checks.length - failed.length, failed: failed.map((f) => f.name), summary: report.summary }, null, 2))
process.exit(failed.length ? 1 : 0)
