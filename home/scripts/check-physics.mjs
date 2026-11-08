// Headless proof of the physics world (#74): the policy (only ?physics pages may compile wasm),
// the pinball table fired many times by a scripted plunger with zero tunnelling and bumpers
// that score through their wires, the keys, the moon preset changing the ball's measured
// gravity, talk-to-tune refusals and clamps leaving or checking the rules, villagers pushing
// a light thing, and the physics step time with the table and villagers live. Starts its own
// villager host (stub ruler, no model) and dev server on a throwaway VILLAGE_ROOT.
// Usage: node scripts/check-physics.mjs [--dev=5383] [--host=5387] [--shots=40] [--shots-dir=dir]
//   --agent=claude: talk-to-tune asks a real model once ("make it feel like the moon").
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const SHOTS = Number(opt('shots') ?? 40)
const shotsDir = opt('shots-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(process.env.VILLAGE_SCRATCH ?? tmpdir(), 'physics-'))
const hostPort = Number(opt('host') ?? 5387)
const devPort = Number(opt('dev') ?? 5383)
const base = `http://localhost:${devPort}/`
const checks = []
const report = {}
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.error(pass ? 'pass' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 400) ?? '')
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
const { tokens } = JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
if (shotsDir) await mkdir(shotsDir, { recursive: true })

async function open(page, query) {
  await page.goto(`${base}${query}#token=${tokens.alex}`)
  await page.evaluate(() => window.village.ready())
}
const physics = (page) => page.waitForFunction(() => window.village?.physics, null, { timeout: 30_000 })

// The table's inside, in its own frame: half width 0.26, half length 0.52, glass lid 0.052 above
// the playfield. Tunnelling is the ball's centre past a wall's inner face (it went through);
// penetration (its surface past the face, centre still inside) is measured and reported apart.
const R = 0.0135
const BOUNDS = { min: [-0.26, 0, -0.52], max: [0.26, 0.052, 0.52] }
const TOUCH = { min: BOUNDS.min.map((v) => v + R), max: BOUNDS.max.map((v) => v - R) }

try {
  // ── The policy: only a ?physics page may compile WebAssembly ──
  const policy = async (q) => (await fetch(`${base}${q}`)).headers.get('content-security-policy') ?? ''
  const plain = await policy(''), withPhysics = await policy('?physics=1')
  check("Only a ?physics page gets 'wasm-unsafe-eval', and nothing else changes", !plain.includes('wasm') && withPhysics.includes("script-src 'self' 'wasm-unsafe-eval'") && withPhysics.replace(" 'wasm-unsafe-eval'", '') === plain, { plain, withPhysics })

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await open(page, '?talk=off&build=0&q=low')
  const quiet = await page.evaluate(() => ({ physics: Boolean(window.village.physics), wasm: performance.getEntriesByType('resource').some((r) => /jolt|\.wasm/.test(r.name)) }))
  check('The default page loads no physics and no wasm', !quiet.physics && !quiet.wasm, quiet)

  // ── The table, fired by a scripted plunger ──
  await open(page, '?physics=1&talk=off&build=0&q=low')
  await physics(page)
  report.loadMs = await page.evaluate(() => window.village.physics.loadMs)
  const shots = await page.evaluate(([SHOTS, BOUNDS]) => {
    const p = window.village.physics
    p.preset('normal')
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const rows = []
    for (let i = 0; i < SHOTS; i++) {
      p.reset()
      const tally = () => Object.entries(p.signals()).filter(([k]) => /bumper-.-sensor\.hit$/.test(k)).reduce((a, [, n]) => a + n, 0)
      const hits0 = tally()
      const score0 = p.counters()['pinball/score']
      const hold = 0.2 + rand() * 0.8
      p.input('plunger', true)
      const range = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      const merge = (r) => { if (!r) return; for (let k = 0; k < 3; k++) { range.min[k] = Math.min(range.min[k], r.min[k]); range.max[k] = Math.max(range.max[k], r.max[k]) } }
      merge(p.advance(hold, ['pinball/ball'])['pinball/ball'])
      p.input('plunger', false)
      let peak = 0
      for (let k = 0; k < 16; k++) {
        p.input('left', rand() < 0.4)
        p.input('right', rand() < 0.4)
        merge(p.advance(0.4, ['pinball/ball'])['pinball/ball'])
        const v = Math.hypot(...p.thing('pinball/ball').velocity)
        peak = Math.max(peak, v)
      }
      p.input('left', false)
      p.input('right', false)
      const hits = tally() - hits0
      const out = range.min.some((v, k) => v < BOUNDS.min[k]) || range.max.some((v, k) => v > BOUNDS.max[k])
      rows.push({ hold: +hold.toFixed(2), hits, score: p.counters()['pinball/score'] - score0, out, top: +range.min[2].toFixed(3), range })
    }
    return rows
  }, [SHOTS, BOUNDS])
  const tunnelled = shots.filter((s) => s.out)
  const penetration = Math.max(0, ...shots.flatMap((s) => [0, 1, 2].flatMap((k) => [TOUCH.min[k] - s.range.min[k], s.range.max[k] - TOUCH.max[k]])))
  report.maxPenetrationMm = +(penetration * 1000).toFixed(2)
  const scored = shots.filter((s) => s.hits > 0)
  const reachedTop = shots.filter((s) => s.top < -0.2)
  report.shots = { n: shots.length, tunnelled: tunnelled.length, reachedTop: reachedTop.length, withBumperHits: scored.length, hits: shots.reduce((a, s) => a + s.hits, 0), score: shots.reduce((a, s) => a + s.score, 0) }
  check(`${SHOTS} plunger shots: zero tunnelling (ball centre inside the rails, playfield and lid on every step)`, tunnelled.length === 0, { tunnelled: tunnelled.slice(0, 3), maxPenetrationMm: report.maxPenetrationMm })
  check('Most shots reach the top of the table', reachedTop.length >= SHOTS * 0.6, report.shots)
  check('Bumpers score through their wires: score = 10 x bumper sensor hits, on every shot', scored.length > 0 && shots.every((s) => s.score === 10 * s.hits), report.shots)
  const fired = await page.evaluate(() => window.village.physics.signals())
  const sum = (re) => Object.entries(fired).filter(([k]) => re.test(k)).reduce((a, [, n]) => a + n, 0)
  check('Every bumper hit fires its kick', sum(/bumper-.-kick\.kicked$/) === sum(/bumper-.-sensor\.hit$/) && sum(/kicked$/) > 0, fired)

  // ── Keys, while the table is being played ──
  const keys = await page.evaluate(() => {
    const p = window.village.physics
    p.reset()
    p.play(true)
    return { playing: p.playing(), flipper: p.thing('pinball/flipper-left').position, ball: p.thing('pinball/ball').local }
  })
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('ArrowDown')
  await page.waitForTimeout(600)
  const held = await page.evaluate(() => window.village.physics.thing('pinball/flipper-left').position)
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('ArrowDown')
  await page.waitForTimeout(700)
  const after = await page.evaluate(() => ({ ball: window.village.physics.thing('pinball/ball').local }))
  const flipped = Math.hypot(...held.map((v, i) => v - keys.flipper[i]))
  check('Keys play the table: Shift swings a flipper, the arrow fires the plunger', keys.playing === 'pinball' && flipped > 0.01 && after.ball[2] < keys.ball[2] - 0.1, { flipped, before: keys.ball, after: after.ball })
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'physics-play.jpg'), quality: 88 })
  await page.evaluate(() => window.village.physics.play(false))

  // ── Moon: the ball's measured gravity ──
  const roll = (preset) => page.evaluate((preset) => {
    const p = window.village.physics
    p.preset(preset)
    p.place('pinball/ball', [-0.2, 0.0136, -0.42])
    p.advance(0.3)
    const v = p.thing('pinball/ball').velocity
    return Math.hypot(...v) / 0.3
  }, preset)
  const earth = await roll('normal')
  const moon = await roll('moon')
  await page.evaluate(() => window.village.physics.preset('normal'))
  report.gravity = { earth: +earth.toFixed(3), moon: +moon.toFixed(3), ratio: +(moon / earth).toFixed(3), expected: +(1.62 / 9.81).toFixed(3) }
  check('The moon preset changes the ball\'s measured acceleration down the table by g ratio (1.62 / 9.81, ±25%)', Math.abs(moon / earth - 1.62 / 9.81) < 0.25 * (1.62 / 9.81), report.gravity)

  // ── Rules: checked, clamped, atomic ──
  const unit = await page.evaluate(async () => {
    const { checkRules, NORMAL } = await import('/src/physics/rules.ts')
    const hostile = checkRules(JSON.parse('{"__proto__": {"polluted": true}, "gravity": [1e308, "x", null], "timeScale": -1, "bounce": "NaN", "kick": 1e9, "substeps": 2.6, "eval": "alert(1)"}'), NORMAL)
    return {
      refused: [checkRules(null, NORMAL), checkRules([1, 2], NORMAL), checkRules('moon', NORMAL)].every((r) => 'reason' in r),
      polluted: ({}).polluted,
      rules: hostile.rules, clamped: hostile.clamped, keys: Object.keys(hostile.rules).sort(),
    }
  })
  check('checkRules refuses non-objects and clamps hostile fields without pollution or extra keys', unit.refused && unit.polluted === undefined && unit.rules.gravity[0] === 30 && unit.rules.gravity[1] === -9.81 && unit.rules.timeScale === 0.1 && unit.rules.bounce === 1 && unit.rules.kick === 4 && unit.rules.substeps === 3 && !unit.keys.includes('eval'), unit)

  // ── Talk-to-tune through the host (stub ruler unless --agent=claude) ──
  const tune = (text) => page.evaluate(async (text) => {
    const p = window.village.physics
    const before = JSON.stringify(p.rules())
    const n = p.events().filter((e) => e.kind === 'rules').length
    const r = await p.ask(text)
    return { r, before, after: JSON.stringify(p.rules()), rulesEvents: p.events().filter((e) => e.kind === 'rules').length - n }
  }, text)
  if (agent === 'stub') {
    for (const bad of ['[stub-rules-junk]', '[stub-rules-malformed]', '[stub-rules-fail]']) {
      const t = await tune(`make it ${bad}`)
      check(`A ${bad.slice(12, -1)} talk answer leaves the rules unchanged`, !t.r.ok && t.before === t.after && t.rulesEvents === 0, t)
    }
    const hostile = await tune('make it [stub-rules-hostile]')
    const hr = JSON.parse(hostile.after)
    check('A hostile talk answer is applied only as checked, clamped data, in one rules event', hostile.r.ok && hostile.rulesEvents === 1 && hr.gravity[0] === 30 && hr.timeScale === 0.1 && hr.kick === 4 && hr.maxSpeed === 1 && Number.isInteger(hr.substeps) && hostile.r.clamped.length >= 5 && !('eval' in hr), { clamped: hostile.r.clamped, rules: hr })
    const moonTalk = await tune('make it feel like the moon')
    check('"Make it feel like the moon" sets moon gravity and keeps the rest', moonTalk.r.ok && JSON.parse(moonTalk.after).gravity[1] === -1.62 && moonTalk.rulesEvents === 1, { note: moonTalk.r.note, after: moonTalk.after })
  } else {
    const t = await tune('make it feel like the moon')
    report.realModel = t
    check('A real model answer sets lower gravity', t.r.ok && JSON.parse(t.after).gravity[1] > -5, t)
  }
  const kept = await page.evaluate(() => { const p = window.village.physics; p.preset('moon'); p.reset(); return p.rules().gravity[1] })
  check('Tuning survives a reset', kept === -1.62, kept)
  await page.evaluate(() => window.village.physics.preset('normal'))
  check('No page errors on the physics page', !errors.length, errors.slice(0, 5))

  // ── Villagers as bodies, and the step time with the table and villagers live ──
  const live = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const liveErrors = []
  live.on('pageerror', (e) => liveErrors.push(String(e)))
  await open(live, '?physics=1&q=low')
  await physics(live)
  await live.waitForFunction(() => window.village.physics.stats().villagers > 0, null, { timeout: 20_000 }).catch(() => {})
  const pushed = await live.evaluate(async () => {
    const p = window.village.physics
    // A felt ball put where a villager stands is pushed out of the way by its body.
    let at = null
    window.village.kernel?.root.get('stage').scene.traverse((o) => { if (!at && typeof o.userData.villagerId === 'string') at = o.getWorldPosition(o.position.clone()) })
    if (!at) return { villagers: p.stats().villagers, moved: 0 }
    p.place('house/felt-ball', [at.x + 0.05, 0.3, at.z])
    const start = p.thing('house/felt-ball').position
    await new Promise((r) => setTimeout(r, 1500))
    const end = p.thing('house/felt-ball').position
    return { villagers: p.stats().villagers, moved: Math.hypot(end[0] - start[0], end[2] - start[2]), start, end }
  })
  check('Villagers are kinematic bodies that push a light thing out of their way', pushed.villagers > 0 && pushed.moved > 0.05, pushed)
  const steps = await live.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 4000))
    const e = window.village.physics.events().filter((x) => x.kind === 'step')
    return { n: e.length, sides: [...new Set(e.map((x) => x.side))], sample: e.at(-1) }
  })
  check('Walking villagers report footsteps on the ground (point, heading, foot size), alternating feet', steps.n > 0 && steps.sides.length === 2 && steps.sample.at.y === 0 && steps.sample.foot.length > 0, steps)
  // Real frames: the table played by script while villagers walk.
  const timing = await live.evaluate(async () => {
    const p = window.village.physics
    p.clearStats()
    const until = performance.now() + 10_000
    let shots = 0
    while (performance.now() < until) {
      p.input('plunger', true)
      await new Promise((r) => setTimeout(r, 500))
      p.input('plunger', false)
      shots++
      for (let k = 0; k < 6; k++) {
        p.input('left', k % 2 === 0)
        p.input('right', k % 3 === 0)
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    return { ...p.stats(), shots }
  })
  report.stepMs = timing
  check('Physics per frame stays small with the table and villagers live (frame median under 1 ms, p95 under 2 ms)', timing.frameMs.median < 1 && timing.frameMs.p95 < 2 && timing.villagers > 0, timing)
  check('No page errors with villagers and physics', !liveErrors.length, liveErrors.slice(0, 5))
  if (shotsDir) {
    await live.goto(`${base}?physics=1&q=high&room=living#token=${tokens.alex}`)
    await live.evaluate(() => window.village.ready())
    await physics(live)
    await live.waitForTimeout(4000)
    await live.screenshot({ path: join(shotsDir, 'physics-home.jpg'), quality: 88 })
  }
} catch (error) {
  check('the check ran to the end', false, String(error?.stack ?? error))
} finally {
  await browser.close().catch(() => {})
  for (const child of [...children]) await new Promise((resolve) => { child.once('exit', resolve); process.kill(-child.pid, 'SIGTERM') })
}
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ ok: !failed.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name), report }, null, 1))
process.exit(failed.length ? 1 : 0)
