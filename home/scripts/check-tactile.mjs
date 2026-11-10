// Headless proof that the house can be felt (#107), in the real home (the default page: villagers,
// build mode and the dollhouse view on). The kitchen's loose things (plates, jars, cookbooks,
// fruit, the kettle, toy blocks) are bodies of their own that cost nothing to draw at rest: each
// stays inside its kit's merged meshes until it first moves. A mouse lifts a plate, carries it over
// the table and sets it down; a flick throws the toy ball; a tap nudges; a finger on a phone-sized
// touch screen does the same, two fingers let go, and the view and the entries still answer.
// Tidying puts everything back where it was made and draws it merged again. Impacts are heard by
// material: pottery clacks, steel and glass ring, wood knocks, soft things thud.
// Starts its own dev server (no villager host: nothing here talks).
// Usage: node scripts/check-tactile.mjs [--dev=5441] [--shots-dir=dir]
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const shotsDir = opt('shots-dir')
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const devPort = Number(opt('dev') ?? 5441)
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

const T = 'home/kitchen things/'
/** Opens the home and waits for its bodies. */
async function open(context, query = '') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}${query}`)
  await page.evaluate(() => window.village.ready())
  await page.waitForFunction(() => window.village?.physics?.home.list().some((h) => h.key.startsWith('home/kitchen things/')), null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  const world = (fn, arg) => page.evaluate(fn, arg)
  return {
    page, errors, world,
    wait: (ms) => page.waitForTimeout(ms),
    thing: (key) => world((k) => window.village.physics.thing(k), key),
    /** Where a thing, or a world point, is on the screen (CSS px). */
    screen: (at) => world((at) => {
      const { camera, renderer } = window.village.kernel.root.get('stage')
      const [x, y, z] = typeof at === 'string' ? window.village.physics.thing(at).position : at
      const p = camera.position.clone().set(x, y, z).project(camera)
      const r = renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    }, at),
    /** How the loose things are drawn: meshes of their own, and things with any. */
    drawn: () => world(() => {
      let meshes = 0, things = 0
      const names = []
      window.village.kernel.root.get('stage').scene.traverse((o) => {
        if (!o.userData.loose) return
        things++
        const own = o.children.filter((c) => c.isMesh).length
        meshes += own
        if (own) names.push(o.name)
      })
      return { things, out: names.length, meshes, drawCalls: window.village.snapshot().render.drawCalls, names: names.slice(0, 8) }
    }),
    events: (kind) => world((kind) => window.village.physics.events().filter((e) => e.kind === kind), kind),
  }
}
const far = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))

try {
  // ── A desktop, a mouse ──
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const h = await open(desk)
  const { page } = h

  const rest = await h.drawn()
  const list = await h.world(() => window.village.physics.home.list().filter((x) => x.key.startsWith('home/kitchen things/')))
  check('The kitchen\'s loose things are bodies of their own, moving ones, each with its material', list.length >= 40 && list.every((x) => x.motion === 'dynamic') && ['ceramic', 'glass', 'paper', 'steel', 'maple', 'rubber', 'fruit'].every((m) => list.some((x) => x.material === m)), { things: list.length, materials: [...new Set(list.map((x) => x.material))] })
  check('At rest none of them is drawn on its own: they are inside the kits\' merged meshes', rest.things === list.length && rest.out === 0 && rest.meshes === 0, rest)
  const kit = await h.world(() => window.village.physics.home.list().find((x) => x.key === 'home/furnish'))
  check('The kit\'s own body no longer holds their boxes', kit && kit.motion === 'static' && kit.parts < 149, kit)

  // Everything woken at once settles where it was drawn (the fruit shifts in the bowl, a block tips off its pile).
  const settle = await h.world((T) => {
    const p = window.village.physics, w = p.engine.world
    const keys = p.home.list().filter((x) => x.key.startsWith(T)).map((x) => x.key)
    const before = Object.fromEntries(keys.map((k) => [k, p.thing(k).position]))
    for (const k of keys) w.applyImpulse(k, [0, 1e-5, 0])
    p.advance(3)
    return keys.map((k) => { const a = before[k], b = p.thing(k).position; return { key: k.slice(T.length), moved: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), fell: a[1] - b[1] } })
  }, T)
  const loosePile = /^(clementine|apple|pear|lemon|toy block)/
  const strayed = settle.filter((s) => (loosePile.test(s.key) ? s.moved > 0.25 || s.fell > 0.12 : s.moved > 0.012))
  check('Woken all at once, they stay where they were drawn (fruit and blocks may shift in their piles)', strayed.length === 0, { strayed, worst: settle.sort((a, b) => b.moved - a.moved).slice(0, 4) })
  await h.wait(400)
  await h.world(() => window.village.physics.hand.tidy())
  await h.wait(1500)
  const again = await h.drawn()
  check('Tidying after that puts every thing back, drawn merged again', again.out === 0 && again.meshes === 0 && Object.keys(await h.world(() => window.village.physics.hand.astray())).length === 0, { rest, again, astray: await h.world(() => window.village.physics.hand.astray()) })

  // The mouse lifts the top plate off the dresser, carries it to the kitchen table and sets it down.
  const plate = `${T}plate#4`
  const from = await h.thing(plate)
  const at = await h.screen(plate)
  await page.mouse.move(at.x, at.y)
  await h.wait(120)
  const cursor = await h.world(() => window.village.kernel.root.get('stage').renderer.domElement.style.cursor)
  await page.mouse.down()
  await h.wait(350)
  const lifted = await h.thing(plate)
  const holding = await h.world(() => window.village.physics.hand.holding())
  check('Over a loose thing the mouse shows a hand; a press takes the plate and lifts it off the pile', cursor === 'grab' && holding === plate && lifted.position[1] - from.position[1] > 0.03, { cursor, holding, lift: lifted.position[1] - from.position[1] })
  const during = await h.drawn()
  check('The moving plate is drawn by its own mesh, the rest still merged', during.out >= 1 && during.out <= 4, during)
  const table = await h.screen([-0.45, 0.75, -0.18])
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(at.x + ((table.x - at.x) * i) / 24, at.y + ((table.y - at.y) * i) / 24)
    await h.wait(25)
  }
  await h.wait(900)
  const carried = await h.thing(plate)
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'tactile-carry.jpg'), quality: 88 })
  await page.mouse.up()
  await h.wait(1500)
  const down = await h.thing(plate)
  check('Dragged to the table it follows the pointer over it, and let go it rests on the table top', far([carried.position[0], carried.position[2]], [-0.45, -0.18]) < 0.25 && carried.position[1] > 0.78 && far([down.position[0], down.position[2]], [-0.45, -0.18]) < 0.35 && Math.abs(down.position[1] - 0.76) < 0.04, { carried: carried.position, down: down.position })
  const held = (await h.events('held')).filter((e) => e.thing === plate)
  check('Taking and letting go are told as events', held.length === 2 && held[0].held && !held[1].held && held[0].material === 'ceramic', held.map((e) => e.held))

  // A flick throws the toy ball across the floor.
  const ball = `${T}toy ball`
  const b0 = await h.thing(ball)
  const bs = await h.screen(ball)
  await page.mouse.move(bs.x, bs.y)
  await page.mouse.down()
  await h.wait(150)
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(bs.x + i * 22, bs.y - i * 6)
    await h.wait(16)
  }
  await page.mouse.up()
  const thrown = await h.thing(ball)
  await h.wait(2500)
  const b1 = await h.thing(ball)
  const speed = Math.hypot(...thrown.velocity)
  check('A flick throws the toy ball: it leaves the hand at speed and ends well away, inside the house', speed > 1 && speed <= 6 && far(b0.position, b1.position) > 0.5 && b1.position[1] > -0.1 && Math.abs(b1.position[0]) < 9, { speed, travelled: far(b0.position, b1.position), at: b1.position })
  const hits = (await h.events('impact')).filter((e) => e.a === ball || e.b === ball)
  check('Its landing is an impact with its material (rubber)', hits.length > 0 && hits.every((e) => e.materials.includes('rubber')), hits.length)

  // A tap nudges; a press on a wall, or on nothing, is the view's.
  const block = `${T}cup`
  const k0 = await h.thing(block)
  const ks = await h.screen(block)
  await page.mouse.click(ks.x, ks.y, { delay: 30 })
  const nudged = Math.hypot(...(await h.thing(block)).velocity)
  await h.wait(900)
  const k1 = await h.thing(block)
  check('A tap nudges the cup on the side table away', far(k0.position, k1.position) > 0.03, { nudged, moved: far(k0.position, k1.position) })
  const eye = await h.world(() => window.village.kernel.root.get('stage').camera.position.toArray())
  const lawn = await h.screen([0.8, 0, 2.9])
  await page.mouse.move(lawn.x, lawn.y)
  await page.mouse.down()
  await page.mouse.move(lawn.x + 120, lawn.y + 10, { steps: 8 })
  await page.mouse.up()
  await h.wait(600)
  const eye2 = await h.world(() => window.village.kernel.root.get('stage').camera.position.toArray())
  check('A drag that starts on nothing loose still turns the view', far(eye, eye2) > 0.2 && !(await h.world(() => window.village.physics.hand.holding())), { turned: far(eye, eye2), lawn })

  // Sound: which cue an impact plays is what the smaller thing is made of.
  const cues = await h.world(async () => {
    const { cueOf, struckOf } = await import('/src/sound/palette/impact.ts')
    const box = (x) => ({ kind: 'box', half: [x, x, x] }), floor = { kind: 'box', half: [4, 0.05, 4] }
    const of = (m) => cueOf({ materials: [m, 'plaster'], shapes: [box(0.05), floor] })
    return { ceramic: of('ceramic'), glass: of('glass'), steel: of('steel'), maple: of('maple'), felt: of('felt'), fruit: of('fruit'), rubber: of('rubber'), bigSteelSmallWood: cueOf({ materials: ['steel', 'maple'], shapes: [box(0.5), box(0.05)] }), held: cueOf(struckOf({ kind: 'held', material: 'ceramic', shape: box(0.05) })) }
  })
  check('Pottery clacks, glass and steel ring, wood knocks, soft things thud; the smaller thing leads', cues.ceramic === 'clack' && cues.glass === 'ring' && cues.steel === 'ring' && cues.maple === 'knock' && cues.felt === 'thud' && cues.fruit === 'thud' && cues.rubber === 'thud' && cues.bigSteelSmallWood === 'knock' && cues.held === 'clack', cues)

  // Tidy: everything home again.
  const back = await h.world(() => window.village.physics.hand.tidy().length)
  await h.wait(400)
  const tidy = await h.drawn()
  const home = await h.thing(plate)
  check('Tidying puts the plate, the ball and the cup back and draws them merged again', back >= list.length && tidy.out === 0 && far(home.position, from.position) < 0.002 && Object.keys(await h.world(() => window.village.physics.hand.astray())).length === 0, { back, tidy })
  const stats = await h.world(() => { window.village.physics.clearStats(); return new Promise((r) => setTimeout(() => r(window.village.physics.stats()), 2500)) })
  check('At rest the world still steps in well under a millisecond', stats.stepMs.median <= 0.6 && stats.stepMs.n > 30, stats)
  check('No page errors with a mouse', h.errors.length === 0, h.errors.slice(0, 3))
  await desk.close()

  // ── A phone, a finger ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const m = await open(phone, '?q=low')
  const cdp = await phone.newCDPSession(m.page)
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) })
  // The view is brought round to the kitchen table first.
  await m.world(() => window.village.physics.look([3.2, 3.4, 4.6], [0.2, 0.8, 0]))
  await m.wait(1800)
  const jug = `${T}flower jug`
  const j0 = await m.thing(jug)
  const js = await m.screen(jug)
  // A finger a little off the jug still takes it (a fingertip covers more than a jug from here).
  await touch('touchStart', [[js.x + 12, js.y + 10]])
  await m.wait(300)
  const fingerHolds = await m.world(() => window.village.physics.hand.holding())
  const to = await m.screen([0.25, 0.75, 0.3])
  for (let i = 1; i <= 16; i++) {
    await touch('touchMove', [[js.x + 12 + ((to.x - js.x) * i) / 16, js.y + 10 + ((to.y - js.y) * i) / 16]])
    await m.wait(30)
  }
  await m.wait(400)
  const j1 = await m.thing(jug)
  const shown = await m.screen(jug)
  if (shotsDir) await m.page.screenshot({ path: join(shotsDir, 'tactile-finger.jpg'), quality: 88 })
  await touch('touchEnd', [])
  await m.wait(1200)
  const j2 = await m.thing(jug)
  check('A finger near the jug takes it, carries it across the table and sets it down upright', fingerHolds === jug && far(j0.position, j1.position) > 0.4 && far(j1.position, j2.position) < 0.3 && Math.abs(j2.position[1] - j0.position[1]) < 0.05, { fingerHolds, carried: far(j0.position, j1.position), rest: j2.position })
  check('While carried it shows above the fingertip, not under it', to.y + 10 - shown.y > 15, { finger: to.y + 10, thing: shown.y })
  // Two fingers are the view's: the held thing is let go.
  const cup = `${T}fruit bowl`
  const cs = await m.screen(cup)
  await touch('touchStart', [[cs.x, cs.y]])
  await m.wait(200)
  const one = await m.world(() => window.village.physics.hand.holding())
  await touch('touchStart', [[cs.x, cs.y], [cs.x + 90, cs.y + 40]])
  await m.wait(120)
  const two = await m.world(() => window.village.physics.hand.holding())
  await touch('touchEnd', [])
  check('A second finger lets go of what the first held', one !== null && two === null, { one, two })
  // An entry is still chosen by a tap.
  await m.world(() => window.village.physics.look(null))
  await m.wait(1500)
  const entry = await m.world(() => {
    const entries = window.village.kernel.root.get('entries')
    const e = entries.list().find((x) => x.id === 'notebook') ?? entries.list()[0]
    return e?.id ?? null
  })
  check('No page errors with a finger', m.errors.length === 0, { errors: m.errors.slice(0, 3), entry })
  await phone.close()
} catch (error) {
  check('The check ran to its end', false, String(error?.stack ?? error).slice(0, 600))
} finally {
  await browser.close()
  try { process.kill(-server.pid) } catch { /* already gone */ }
}
const failed = checks.filter((c) => !c.pass)
console.log(JSON.stringify({ checks: checks.length, failed: failed.map((c) => c.name) }, null, 2))
process.exit(failed.length ? 1 : 0)
