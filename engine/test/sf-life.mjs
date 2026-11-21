// Street life in the San Francisco realm (#450), measured from the static folder (sf/build.mjs) in Chrome with
// WebGPU, as test/sf.mjs measures the rest of it.
//
//   node test/sf-life.mjs [--no-build] [--seconds 6] [--hour 12.5] [--shots ~/.village/engine/sf/life] [--no-pairs] [--headed]
//
// It says, at Columbus and Broadway, on Powell St with a cable car passing, along the Embarcadero and on a
// residential hill (Taylor St on Russian Hill):
//   - how many people and vehicles (parked, driving, cable cars) are within 150 m, and how many are in the eye's view;
//   - frame gaps (p50, p99), the march's GPU time and the page's CPU time, with street life on and then off (`enabled`),
//     and what street life itself costs on the CPU a frame;
// then gets into a parked car on Taylor St on foot (E) and drives it 60 s by the graph, through a turn and up a hill,
// and says how far it went, how high it climbed, how much it turned and whether it is whole; then sets off a charge
// among people and cars and says who was thrown down and what kept driving; and the bytes of the libraries.
// Pictures, and a contact sheet of them beside the street photographs of the same places where there are any (the
// panoramas kept in ~/.village/engine/bay/450-inputs, sf/pairs.py), go to ~/.village/engine/sf/life.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, constants } from 'node:zlib'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, 'dist-sf'), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'life')), seconds = Number(arg('seconds', '6')), hour = Number(arg('hour', '12.5'))
const PY = join(homedir(), '.village', 'engine', 'bay', 'venv', 'bin', 'python')
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
// (A picture this run does not take is not left from the last.)
for (const f of readdirSync(shots)) if (f.endsWith('.png')) rmSync(join(shots, f))

// ── The bytes of what street life brings ──
const bytes = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).reduce((n, f) => { const b = readFileSync(join(dir, f)); return { raw: n.raw + b.length, br: n.br + brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length, files: n.files + 1 } }, { raw: 0, br: 0, files: 0 })
const realm = JSON.parse(readFileSync(join(dist, 'sf/index.html'), 'utf8').match(/<script type="application\/json" id="realm">([^<]+)<\/script>/)[1])
const lifeDir = join(dist, 'sf', realm.street.life), carsDir = join(dist, 'sf', realm.street.cars)
const results = { hour, libraries: { life: bytes(lifeDir), cars: bytes(carsDir) } }
for (const f of readdirSync(carsDir)) if (f !== 'index.json') results.libraries[`cars/${f}`] = statSync(join(carsDir, f)).size
console.log('libraries', JSON.stringify(results.libraries))

// ── Where to look: from the graph, a point on each street near the place, looking along it ──
const graphs = readdirSync(join(here, 'sf/pilot-graph')).map((f) => JSON.parse(readFileSync(join(here, 'sf/pilot-graph', f), 'utf8')))
const onStreet = (name, x, z) => {
  let best = null
  for (const g of graphs) for (const r of g.roads) {
    if (r.name !== name) continue
    for (let i = 0; i + 1 < r.line.length; i++) {
      const [a, b] = [r.line[i], r.line[i + 1]], d = Math.hypot((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - z)
      if (!best || d < best.d) best = { d, a, b }
    }
  }
  const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], l = Math.hypot(dx, dz)
  return { x: (best.a[0] + best.b[0]) / 2, z: (best.a[1] + best.b[1]) / 2, dx: dx / l, dz: dz / l }
}
const SPOTS = [
  { name: 'columbus', street: 'Columbus Avenue', at: [522628, 664243], what: 'Columbus and Broadway' },
  { name: 'powell', street: 'Powell Street', at: [519580, 668046], what: 'Powell St at Washington', cable: true },
  { name: 'embarcadero', street: 'The Embarcadero', at: [529467, 662580], what: 'The Embarcadero at Pier 7' },
  { name: 'hill', street: 'Taylor Street', at: [515700, 663500], what: 'Taylor St on Russian Hill' },
]

const site = await plain(dist, '127.0.0.1')
const back = await turn()
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(m.text()) })

try {
  await page.goto(`${site.url}/sf/index.html?hour=${hour}`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.street?.ready, null, { timeout: 180_000 })
  const settle = () => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 90_000, polling: 250 }).catch(() => null)
  const look = (pose, fov = 70) => page.evaluate(({ pose, fov }) => { const e = globalThis.engine; Object.assign(e.pose, { ...pose, y: e.ground(pose.x, pose.z) + pose.h }); e.fov = fov }, { pose, fov })
  // The picture's size pinned for every take, so that on and off draw the same pixels: the page otherwise steers it
  // to hold 60 fps, and a frame gap alone flatters. `gpuMs` is the march's pass only (people and cars are drawn after it).
  const SCALE = 0.75
  // What the picture has within 3 m of the eye, from the march's own rays (engine.pick) across the middle of the view:
  // how many of 27 directions, 3.5 degrees apart (the picture's whole width), hit something that near at two heights of
  // three. A post or a trunk beside the eye (the first sheets had three) is a band of them.
  const nearView = () => page.evaluate(async () => {
    const e = globalThis.engine
    let n = 0
    for (let a = -13; a <= 13; a++) { let hits = 0; for (const up of [-0.2, 0, 0.25]) { const h = await e.pick(a * 0.06, up); if (h && h.t < 30) hits++ } if (hits >= 2) n++ }
    return n
  })
  const take = () => page.evaluate(async ({ ms, scale }) => {
    const e = globalThis.engine, gaps = [], street = []
    e.scale = scale
    await new Promise((r) => setTimeout(r, 1000))
    const stop = e.watch((g) => { gaps.push(g); street.push(e.street.ms) })
    // Once a second: who is on a crossing at red (none should be), who waits at a kerb, what each car waits for.
    let red = 0, waiting = 0, faces = 0
    const stops0 = e.street.count(e.view(), 1500).signStops
    const waits = {}
    for (let n = 0; n < ms / 1000; n++) {
      await new Promise((r) => setTimeout(r, 1000))
      const c = e.street.count(e.view(), 1500)
      red = Math.max(red, c.crossingRed); waiting = Math.max(waiting, c.waiting); faces = Math.max(faces, e.falling.faces)
      for (const car of e.street.cars(e.view().eye[0], e.view().eye[2], 1500)) if (car.kind === 'traffic' && car.v < 2) waits[car.wait || 'starting'] = (waits[car.wait || 'starting'] ?? 0) + 1
    }
    stop()
    const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => g[Math.min(g.length - 1, Math.floor(g.length * p))]
    return { frames: g.length, p50: q(0.5), p99: q(0.99), gpuMs: e.gpuMs, cpuMs: e.cpuMs, scale: e.scale, streetMs: street.reduce((a, b) => a + b, 0) / Math.max(1, street.length), count: e.street.count(e.view(), 1500), wide: e.street.count(e.view(), 3000), figures: e.folk.drawn, red, waiting, waits, faces, signStops: e.street.count(e.view(), 1500).signStops - stops0 }
  }, { ms: seconds * 1000, scale: SCALE })

  // ── Four places ──
  console.log(`\nfour places at ${hour}h`)
  results.places = {}
  for (const spot of SPOTS) {
    const s = onStreet(spot.street, ...spot.at)
    // Some 25 m back along the street from the place, a person's eye on its right-hand pavement: the first spot past the
    // lanes (7 m) clear of anything solid round the eye (a tree, an awning, a wall) and with nothing within 10 m in the
    // middle of its view (a post or a trunk beside the eye fills the picture: the first sheets had three).
    const placed = await page.evaluate(([sx, sz, dx, dz]) => {
      const e = globalThis.engine
      const clearAt = (x, z) => { const f = e.feet(Math.round(x), Math.round(z)); for (let y = f + 8; y <= f + 25; y += 3) for (const [ox, oz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) if (e.kind(x + ox, y, z + oz)) return false; return true }
      // Solid cells on rays across the picture's width (90 degrees), from 1 m to 10 m out, at knee, eye and over-head height.
      const blocked = (x, z) => { const f = e.feet(Math.round(x), Math.round(z)); let n = 0; for (let a = -0.78; a <= 0.79; a += 0.065) { const c = Math.cos(a), sn = Math.sin(a), rx = dx * c - dz * sn, rz = dx * sn + dz * c; for (let d = 10; d <= 100; d += 3) for (const y of [f + 6, f + 17, f + 30]) if (e.kind(x + rx * d, y, z + rz * d)) n++ } return n }
      const all = []
      for (const back of [250, 200, 300, 160, 340]) for (const o of [70, 80, 60, 90, 50, 100]) {
        const x = sx - dx * back - dz * o, z = sz - dz * back + dx * o
        if (clearAt(x, z)) all.push({ x, z, n: blocked(x, z), back, side: o })
      }
      return all.sort((a, b) => a.n - b.n).slice(0, 8)
    }, [s.x, s.z, s.dx, s.dz])
    // Of those, the first the march itself sees nothing near in (the world's cells miss some of what it draws: a trunk).
    let chosen = null
    for (const c of placed) {
      await look({ x: c.x / 10, z: c.z / 10, h: 1.7, yaw: Math.atan2(s.dx, -s.dz), pitch: -0.03 })
      await page.waitForTimeout(400)
      if (await nearView() === 0) { chosen = c; break }
    }
    chosen ??= placed[0] ?? { x: s.x - s.dx * 250 - s.dz * 35, z: s.z - s.dz * 250 + s.dx * 35, n: -1, back: 250, side: 35 }
    const x = chosen.x, z = chosen.z, placedAt = chosen
    const pose = { x: x / 10, z: z / 10, h: 1.7, yaw: Math.atan2(s.dx, -s.dz), pitch: -0.03 }
    if (spot.cable) {
      // The clock people and cars go by, moved on to when a cable car is coming up the line here.
      const when = await page.evaluate(({ x, z }) => globalThis.engine.street.cable(x, z), { x: s.x, z: s.z })
      if (when) await page.evaluate((dt) => { const e = globalThis.engine, was = e.folkClock.now; e.folkClock.now = () => was() + dt }, Math.max(0, when.in - 8))
      results.cableLine = when
    }
    await look(pose)
    await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(3000)
    // Off first, then on: the first seconds at a new place still make some of its world.
    await page.evaluate(() => { globalThis.engine.street.enabled = false })
    await page.waitForTimeout(1500)
    const off = await take()
    await page.evaluate(() => { globalThis.engine.street.enabled = true })
    await page.waitForTimeout(2500)
    const on = await take()
    await page.screenshot({ path: join(shots, `${spot.name}.png`) })
    const near = await nearView(), buses = await page.evaluate(() => globalThis.engine.street.audit(0).buses)
    // Everyone on a crossing with lights at 800 moments of the clock (frozen, so who is where is exactly the rule's):
    // none at red. A second a sample, as above, found it only by chance (one run in several).
    const sweep = await page.evaluate(() => {
      const e = globalThis.engine, v = e.view(), was = e.folkClock.now, t0 = Math.floor(was())
      let onLit = 0, red = 0
      for (let k = 0; k < 800; k++) { const t = t0 + k * 0.77; e.folkClock.now = () => t; onLit += e.street.folk(v, k * 0.77).filter((p) => p.sig).length; red += e.street.red.length }
      e.folkClock.now = was
      return { onLit, red }
    })
    const r = { what: spot.what, sweep, near, buses, eye: [round(pose.x), round(pose.z)], view: { back: placedAt.back / 10, side: placedAt.side / 10, solidAhead: placedAt.n }, ...on.count, redMost: on.red, waitingMost: on.waiting, signStopsSeen: on.signStops, waits: on.waits, faces: on.faces, within300: { tram: on.wide.tram, cable: on.wide.cable, bus: on.wide.bus, trolley: on.wide.trolley }, frames: { on: { p50: round(on.p50), p99: round(on.p99), gpuMs: round(on.gpuMs), cpuMs: round(on.cpuMs), scale: on.scale, streetCpuMs: round(on.streetMs, 2), figuresMs: round(on.figures?.ms ?? 0, 2), boxes: on.figures?.boxes }, off: { p50: round(off.p50), p99: round(off.p99), gpuMs: round(off.gpuMs), cpuMs: round(off.cpuMs), scale: off.scale } } }
    results.places[spot.name] = r
    results.places[spot.name].pose = pose
    console.log(`  ${spot.what}: buses ${JSON.stringify(r.buses)}`)
    console.log(`  ${spot.what}: on a lit crossing ${r.sweep.onLit} times in 800 frozen moments, ${r.sweep.red} at red`)
    console.log(`  ${spot.what}: people ${r.people} (${r.peopleSeen} in view, up to ${r.waitingMost} waiting at a kerb, ${r.redMost} on a crossing at red), parked ${r.parked}, driving ${r.traffic} (bus ${r.bus}, trolleybus ${r.trolley}, van ${r.van}, truck ${r.truck}), streetcars ${r.tram}, cable cars ${r.cable}; within 300 m ${JSON.stringify(r.within300)}; vehicles in view ${r.vehiclesSeen}, ${r.faces} faces drawn`)
    console.log(`    cars waiting on: ${JSON.stringify(r.waits)}; parked in a lane ${r.parkedInLaneNow}; signal heads in view ${r.headsShown} (${JSON.stringify(r.headsLit)}); eye ${r.view.back} m back, ${r.view.side} m aside, ${r.view.solidAhead} solid cells ahead`)
    console.log(`    on  p50 ${r.frames.on.p50} p99 ${r.frames.on.p99} ms, march only ${r.frames.on.gpuMs} ms at scale ${r.frames.on.scale}, page CPU ${r.frames.on.cpuMs} ms (street ${r.frames.on.streetCpuMs}, figures ${r.frames.on.figuresMs})`)
    console.log(`    off p50 ${r.frames.off.p50} p99 ${r.frames.off.p99} ms, march only ${r.frames.off.gpuMs} ms at scale ${r.frames.off.scale}, page CPU ${r.frames.off.cpuMs} ms`)
    if (spot.cable) await page.evaluate(() => { const e = globalThis.engine; e.folkClock.now = () => Date.now() / 1000 })
  }
  // ── Budgets: what street life may cost, by place (on this M1 Pro, 1280 x 720) ──
  const BUDGET = { peopleSeen: 80, vehiclesSeen: 40, streetCpuMs: 2.5, figuresCpuMs: 2.5, cpuAddedMs: 3, faces: 3_000_000, lifeBrotliPerSquareKB: 100, carBrotliKB: 250 }
  results.budget = BUDGET
  for (const [name, r] of Object.entries(results.places)) {
    const added = r.frames.on.cpuMs - r.frames.off.cpuMs
    check(r.peopleSeen <= BUDGET.peopleSeen && r.vehiclesSeen <= BUDGET.vehiclesSeen && r.frames.on.streetCpuMs <= BUDGET.streetCpuMs && r.frames.on.figuresMs <= BUDGET.figuresCpuMs && added <= BUDGET.cpuAddedMs, `${name} within budget: ${r.peopleSeen}/${BUDGET.peopleSeen} people and ${r.vehiclesSeen}/${BUDGET.vehiclesSeen} vehicles in view, street ${r.frames.on.streetCpuMs}/${BUDGET.streetCpuMs} ms and figures ${r.frames.on.figuresMs}/${BUDGET.figuresCpuMs} ms a frame on the CPU, ${round(added, 2)}/${BUDGET.cpuAddedMs} ms added to the page's CPU`)
  }
  check(results.libraries.life.br / 1024 / (results.libraries.life.files - 1) <= BUDGET.lifeBrotliPerSquareKB, `life ${round(results.libraries.life.br / 1024 / (results.libraries.life.files - 1))} KB brotli a square (budget ${BUDGET.lifeBrotliPerSquareKB})`)
  for (const f of readdirSync(carsDir).filter((f) => f !== 'index.json')) { const br = brotliCompressSync(readFileSync(join(carsDir, f)), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1024; check(br <= BUDGET.carBrotliKB, `${f} ${round(br)} KB brotli (budget ${BUDGET.carBrotliKB})`) }

  // ── The same places as a street photograph saw them: the eye where the nearest kept panorama was taken ──
  if (!has('no-pairs')) for (const spot of SPOTS) {
    const near = spawnSync(PY, [join(here, 'sf/pairs.py'), 'near', String(spot.at[0]), String(spot.at[1])], { encoding: 'utf8' })
    const cam = near.status === 0 ? JSON.parse(near.stdout.trim().split('\n').pop() || 'null') : null
    if (!cam || cam.far > 1500) continue
    const s = onStreet(spot.street, cam.x, cam.z), pose = { x: cam.x / 10, z: cam.z / 10, h: 2.4, yaw: Math.atan2(s.dx, -s.dz), pitch: -0.03 }
    await look(pose)
    await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(2500)
    await page.screenshot({ path: join(shots, `${spot.name}-engine.png`) })
    const out = join(shots, `${spot.name}-photo.png`)
    const made = spawnSync(PY, [join(here, 'sf/pairs.py'), 'view', cam.id, String(pose.yaw), String(pose.pitch), '70', '1280', '720', out], { encoding: 'utf8' })
    if (made.status === 0) results.places[spot.name].pair = { photo: cam.id, metres: round(cam.far / 10), captured: new Date(cam.captured).toISOString().slice(0, 10) }
  }
  const P = results.places
  // ── Junctions, transit, parking ──
  const places = Object.values(P).filter((p) => p.what)
  check(places.every((p) => p.redMost === 0), `nobody on a crossing at red, sampled each second (${places.map((p) => p.redMost).join(', ')})`)
  check(places.every((p) => p.sweep.red === 0) && places.reduce((n, p) => n + p.sweep.onLit, 0) > 1000, `nobody on a crossing at red over 800 frozen moments at each place (${places.map((p) => `${p.sweep.red}/${p.sweep.onLit}`).join(', ')} on lit crossings at red)`)
  check(places.every((p) => p.near === 0), `nothing within 3 m filling part of each place's picture (${places.map((p) => p.near).join(', ')} of 27 directions)`)
  check(P.columbus.headsShown >= 2 && P.columbus.heads > 500, `signal heads drawn at Columbus and Broadway (${P.columbus.headsShown} in view, showing ${JSON.stringify(P.columbus.headsLit)}; ${P.columbus.heads} known)`)
  const bus = places.reduce((n, p) => ({ driving: n.driving + p.buses.driving, onRoute: n.onRoute + p.buses.onRoute, trolleys: n.trolleys + p.buses.trolleys, wired: n.wired + p.buses.trolleysWired }), { driving: 0, onRoute: 0, trolleys: 0, wired: 0 })
  check(P.columbus.buses.pieces > 30 && bus.driving > 0 && bus.onRoute >= bus.driving * 0.8, `buses and trolleybuses on OSM's routes: ${bus.onRoute} of ${bus.driving} driving round the four places on their route's road (${P.columbus.buses.pieces} route pieces); trolleybuses under wires ${bus.wired} of ${bus.trolleys}`)
  // Left turns on green at Columbus and Broadway, 40 s with the yield turned off (what the old rule did), then on.
  {
    await look(P.columbus.pose)
    await page.waitForTimeout(3000)
    const a = await page.evaluate(async () => { const st = globalThis.engine.street, l0 = st.audit(0).left; st.rules.yieldLeft = false; await new Promise((r) => setTimeout(r, 40000)); const l1 = st.audit(0).left; st.rules.yieldLeft = true; return { turns: l1.turns - l0.turns, conflicts: l1.conflicts - l0.conflicts, before: l1 } })
    results.leftOff = a
    console.log(`  left turns with the yield off for 40 s: ${JSON.stringify(a)}`)
  }
  // The rules over half an hour of the clock from now: cable cars at the lights, and the same with their lights off (what the check would say of the old rule).
  results.rules = await page.evaluate(() => { const st = globalThis.engine.street, on = st.audit(1800); st.rules.cableLights = false; const off = st.audit(1800); st.rules.cableLights = true; return { on, cableLightsOff: off.cable } })
  console.log(`  rules: ${JSON.stringify(results.rules)}`)
  check(results.rules.on.cable.crossings > 200 && results.rules.on.cable.red === 0 && results.rules.cableLightsOff.red > 0, `cable cars cross ${results.rules.on.cable.crossings} stop lines in 30 min, ${results.rules.on.cable.red} at red (${results.rules.cableLightsOff.red} with their lights ignored, as before)`)
  check(places.some((p) => p.waitingMost > 0), `people wait at the kerb for their walking sign (most at once: ${places.map((p) => p.waitingMost).join(', ')})`)
  check((P.columbus.waits.lights ?? 0) > 0, `cars wait at the lights at Columbus and Broadway (${JSON.stringify(P.columbus.waits)})`)
  check(P.hill.signStopsSeen > 0, `cars come to a full stop at signs on Russian Hill (${P.hill.signStopsSeen} full stops in ${seconds} s; waiting on ${JSON.stringify(P.hill.waits)})`)
  check(P.embarcadero.within300.tram > 0, `a streetcar on the Embarcadero within 300 m (${P.embarcadero.within300.tram})`)
  check(places.every((p) => p.parkedInLaneNow === 0), `no parked car reaches into a lane (${places.map((p) => p.parkedInLaneNow).join(', ')}; ${Math.max(...places.map((p) => p.parkedInLane))} places dropped for it)`)
  // By day: at night the streets are near empty everywhere, and a charge may find nobody.
  const day = hour >= 7 && hour <= 22
  if (day) check(P.columbus.people > P.hill.people, `busier at Columbus and Broadway (${P.columbus.people} people) than on the residential hill (${P.hill.people})`)
  check(P.powell.cable > 0, `a cable car on Powell St (${P.powell.cable})`)
  check(Object.values(P).filter((p) => p.what).every((p) => p.parked + p.traffic > 0), 'vehicles at every place')

  // ── Someone standing on a busy pavement (Columbus Ave): people go round them, not through ──
  {
    await look(P.columbus.pose)
    await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(2000)
    const at = await page.evaluate(async () => {
      const e = globalThis.engine, v = e.view(), people = e.folk.from.flatMap((f) => [...f(v, performance.now() / 1000)])
      // Where the most people pass: the pavement point nearest the most walkers within 40 m.
      let best = null, most = -1
      for (const p of people) { if (!p.walking) continue; const n = people.filter((q) => Math.hypot(q.at[0] - p.at[0], q.at[2] - p.at[2]) < 400).length; if (n > most) { most = n; best = p } }
      return best ? [best.at[0], best.at[2]] : null
    })
    if (at) {
      await page.evaluate(([x, z]) => { const e = globalThis.engine; e.me.walk(true); Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 2 }) }, at)
      await page.waitForTimeout(3000)
      results.onFoot = await page.evaluate(async () => {
        const e = globalThis.engine, t0 = performance.now(), streetFolk = e.folk.from[e.folk.from.length - 2] ?? e.folk.from[0]
        let nearest = Infinity, passed = 0
        const seen = new Set()
        while (performance.now() - t0 < 30000) {
          const f = e.me.feet?.at
          // The street's own people only (the person's own figure stands where they do).
          if (f) for (const p of e.street.folk(e.view(), performance.now() / 1000)) { if (!p.walking) continue; const d = Math.hypot(p.at[0] - f[0], p.at[2] - f[2]); if (d < 50) { if (!seen.has(p.seed)) { seen.add(p.seed); passed++ } nearest = Math.min(nearest, d) } }
          await new Promise((r) => setTimeout(r, 50))
        }
        void streetFolk
        return { passedWithin5m: passed, nearestCells: Math.round(nearest * 10) / 10 }
      })
      console.log(`  on foot on the pavement: ${JSON.stringify(results.onFoot)}`)
      if (results.onFoot.passedWithin5m) check(results.onFoot.nearestCells >= 4, `${results.onFoot.passedWithin5m} people passed within 5 m of someone standing on the pavement, none nearer than ${round(results.onFoot.nearestCells / 10, 2)} m`)
      await page.evaluate(() => globalThis.engine.me.walk(false))
    }
  }

  for (const [name, r] of Object.entries(P)) if (r.what) check(r.faces <= BUDGET.faces, `${name}: ${r.faces} faces of things drawn (budget ${BUDGET.faces})`)

  // ── People are where they were a moment ago: no one jumps, at a round's end or a wait's ──
  {
    const jumps = await page.evaluate(async () => {
      const e = globalThis.engine, v = e.view(), was = e.folkClock.now
      let worst = 0, pairs = 0
      for (let n = 0; n < 150; n++) {
        const t = Date.now() / 1000 + n * 7.3
        e.folkClock.now = () => t
        const a = new Map(e.street.folk(v, 1).map((p) => [p.seed, [p.at[0], p.at[2]]]))
        e.folkClock.now = () => t + 0.1
        for (const p of e.street.folk(v, 1.1)) { const q = a.get(p.seed); if (q) { pairs++; worst = Math.max(worst, Math.hypot(p.at[0] - q[0], p.at[2] - q[1])) } }
      }
      e.folkClock.now = was
      return { pairs, worstCells: Math.round(worst * 10) / 10 }
    })
    results.continuity = jumps
    check(jumps.worstCells < 6, `over ${jumps.pairs} people a tenth of a second apart, nobody moves more than ${round(jumps.worstCells / 10, 2)} m`)
  }

  // ── Signal heads at Columbus and Broadway, from 7 m: the nearest to the place, looked at from across its corner ──
  {
    const heads = readdirSync(lifeDir).filter((f) => /^\d.*\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(lifeDir, f), 'utf8')).heads ?? [])
    const [hx, hz] = SPOTS[0].at, head = heads.sort((a, b) => Math.hypot(a[3] - hx, a[4] - hz) - Math.hypot(b[3] - hx, b[4] - hz))[0]
    if (head) {
      await page.evaluate(([x, z]) => { const e = globalThis.engine, ex = (x + 50) / 10, ez = (z + 50) / 10; Object.assign(e.pose, { x: ex, z: ez, y: e.ground(ex, ez) + 1.7, yaw: Math.atan2(x / 10 - ex, -(z / 10 - ez)), pitch: 0.1 }); e.fov = 60 }, [head[3], head[4]])
      await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(2500)
      await page.screenshot({ path: join(shots, 'signals.png') })
      results.signals = await page.evaluate(() => { const e = globalThis.engine, c = e.street.count(e.view(), 400); return { shown: c.headsShown, lit: c.headsLit } })
      await page.evaluate(() => { globalThis.engine.fov = 70 })
    }
  }

  // ── Every vehicle, close up ──
  {
    // Side by side across the Embarcadero, their fronts on a line 6 m off its middle, facing an eye 18 m off and to one
    // side, 5 m up: every one seen whole from three quarters (in a row nose to tail the first three hid the rest). The
    // side of the street with the clearer view is taken.
    const s = onStreet('The Embarcadero', 528000, 661600)
    const plan = await page.evaluate(([sx, sz, dx, dz]) => {
      const e = globalThis.engine
      let best = null
      for (const sign of [1, -1]) {
        const hx = -dz * sign, hz = dx * sign, lx = hz, lz = -hx
        const at = [sx + hx * 60 - lx * 190, sz + hz * 60 - lz * 190], mid = [sx + hx * 60, sz + hz * 60], eye = [mid[0] + hx * 180 - lx * 70, mid[1] + hz * 180 - lz * 70]
        const f = e.feet(Math.round(eye[0]), Math.round(eye[1]))
        let n = 0
        for (let k = 1; k < 20; k++) { const x = eye[0] + (mid[0] - eye[0]) * k / 20, z = eye[1] + (mid[1] - eye[1]) * k / 20; for (const y of [f + 15, f + 30, f + 45]) if (e.kind(x, y, z)) n++ }
        for (let y = f + 30; y <= f + 50; y += 5) if (e.kind(eye[0], y, eye[1])) n += 100
        if (!best || n < best.n) best = { at, mid, eye, h: Math.atan2(hz, hx), n }
      }
      return best
    }, [s.x, s.z, s.dx, s.dz])
    results.lineup = await page.evaluate(({ at, h }) => globalThis.engine.street.lineup(at, h), plan)
    await page.evaluate(({ mid, eye }) => { const e = globalThis.engine, ex = eye[0] / 10, ez = eye[1] / 10, cx = mid[0] / 10, cz = mid[1] / 10; Object.assign(e.pose, { x: ex, z: ez, y: e.ground(ex, ez) + 5, yaw: Math.atan2(cx - ex, -(cz - ez)), pitch: -0.2 }); e.fov = 72 }, plan)
    await page.waitForTimeout(3000); await settle(); await page.waitForTimeout(3000)
    await page.screenshot({ path: join(shots, 'lineup.png') })
    await page.evaluate(() => { const e = globalThis.engine; e.street.lineup(null); e.fov = 70 })
    check(results.lineup.length >= 9, `the line-up: ${results.lineup.join(', ')}`)
  }

  // ── Density against street photographs: Chinatown (Grant Ave), at each photograph's own hour ──
  // The engine's eye where each kept panorama was taken (2.4 m up, as a camera on a car or a pole is), looking as the
  // neighbourhood panel looks there, at the hour of day it was taken; who is in view counted, the photograph beside.
  // Union Square and the Mission are not in this release's squares (the city run has not reached them): said, not faked.
  results.density = []
  if (!has('no-pairs')) {
    const around = spawnSync(PY, [join(here, 'sf/pairs.py'), 'around', '522492', '666920', '600'], { encoding: 'utf8' })
    const photos = around.status === 0 ? JSON.parse(around.stdout.trim().split('\n').pop() || '[]') : []
    const yaw = (340 * Math.PI) / 180
    for (const [n, cam] of photos.slice(0, 4).entries()) {
      const when = new Date(cam.captured)
      // Its hour in San Francisco; but a photograph in daylight stamped in the night was taken by a camera whose
      // clock kept local time as if it were UTC: then the stamp's own hour is the hour.
      const crop = spawnSync(PY, [join(here, 'sf/pairs.py'), 'view', cam.id, String(yaw), '-0.02', '70', '1280', '720', join(shots, `chinatown-${n}-photo.png`)], { encoding: 'utf8' })
      const luma = crop.status === 0 ? JSON.parse(crop.stdout.trim().split('\n').pop()).luma : 0
      let h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(when)) + when.getUTCMinutes() / 60
      const local = luma > 90 && (h < 7 || h > 19)
      if (local) h = when.getUTCHours() + when.getUTCMinutes() / 60
      await page.evaluate((h) => { globalThis.engine.hour = h }, h)
      // On Grant Ave's carriageway beside the camera: at the camera's own spot the eye is inside the awnings and
      // arcades over the pavement, which the bake has solid.
      const g = onStreet('Grant Avenue', cam.x, cam.z), along = (cam.x - g.x) * g.dx + (cam.z - g.z) * g.dz
      await look({ x: (g.x + g.dx * along) / 10, z: (g.z + g.dz * along) / 10, h: 2.4, yaw, pitch: -0.02 })
      await page.waitForTimeout(2500); await settle(); await page.waitForTimeout(4000)
      const c = await page.evaluate(() => globalThis.engine.street.count(globalThis.engine.view(), 600))
      const name = `chinatown-${n}`
      await page.screenshot({ path: join(shots, `${name}-engine.png`) })
      results.density.push({ place: 'Chinatown, Grant Ave', photo: cam.id, captured: when.toISOString().slice(0, 16), hour: round(h), clockLocal: local, peopleSeen: c.peopleSeen, people60m: c.people, vehiclesSeen: c.vehiclesSeen, name })
      console.log(`  Chinatown ${n}: photo ${cam.id} at ${round(h)}h${local ? ' (its clock kept local time)' : ''}; engine at that hour: ${c.peopleSeen} people and ${c.vehiclesSeen} vehicles in view, ${c.people} people within 60 m`)
    }
    await page.evaluate((h) => { globalThis.engine.hour = h }, hour)
  }

  // ── A car got into on foot and driven 60 s, through a turn and up a hill ──
  console.log('\ndriving')
  const start = onStreet('Taylor Street', 515900, 663000)
  await look({ x: start.x / 10, z: start.z / 10, h: 1.7, yaw: Math.atan2(start.dx, -start.dz), pitch: -0.1 })
  await page.waitForTimeout(1500); await settle()
  // A car with no other parked within 16 m (beside someone on foot, the parked within 12 m wake): E takes the living thing nearest, and a van beside the car was taken.
  // (And none of the living things near: the realm sets its own van down on this street.)
  const car = await page.evaluate(({ x, z }) => { const e = globalThis.engine, all = e.street.cars(x, z, 1500).filter((c) => c.kind === 'parked'), alive = e.alive.things.map((t) => e.alive.where(t)).filter(Boolean).map((w) => w.at); return all.filter((c) => c.model === 'car' && Math.hypot(c.x - x, c.z - z) < 1200 && all.every((o) => o === c || Math.hypot(o.x - c.x, o.z - c.z) > 160) && alive.every((a) => Math.hypot(a[0] - c.x, a[2] - c.z) > 150)).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null }, { x: start.x, z: start.z })
  check(!!car, `a parked car on Taylor St to get into${car ? ` (${car.name})` : ''}`)
  if (car) {
    // On foot beside it: it comes to life, and E gets in.
    // (The eye there first: on foot, the person is set down where the eye is, and moving the eye after leaves them.)
    await page.evaluate((c) => { const e = globalThis.engine; e.me.walk(false); const side = c.heading + Math.PI / 2; Object.assign(e.pose, { x: (c.x + Math.cos(side) * 30) / 10, z: (c.z + Math.sin(side) * 30) / 10, y: e.ground((c.x + Math.cos(side) * 30) / 10, (c.z + Math.sin(side) * 30) / 10) + 2, yaw: Math.atan2(-Math.cos(side), Math.sin(side)) }); e.me.walk(true) }, car)
    await page.evaluate(() => { const e = globalThis.engine; globalThis.__gaps = []; globalThis.__stop = e.watch((g) => globalThis.__gaps.push(g)) })
    const woke = await page.waitForFunction(() => globalThis.engine.alive.near !== null, null, { timeout: 30_000 }).then(() => true, () => false)
    await page.waitForTimeout(1000)
    // What E would take is the living thing nearest; if that is another (a van woken beside it), from its other side.
    const isIt = () => page.evaluate((c) => { const e = globalThis.engine, w = e.alive.near && e.alive.where(e.alive.near); return !!w && Math.hypot(w.at[0] - c.x, w.at[2] - c.z) < 20 }, car)
    if (woke && !(await isIt())) {
      await page.evaluate((c) => { const e = globalThis.engine, side = c.heading - Math.PI / 2, x = (c.x + Math.cos(side) * 30) / 10, z = (c.z + Math.sin(side) * 30) / 10; e.me.walk(false); Object.assign(e.pose, { x, z, y: e.ground(x, z) + 2, yaw: Math.atan2(-Math.cos(side), Math.sin(side)) }); e.me.walk(true) }, car)
      await page.waitForTimeout(2500)
    }
    results.nearIsChosen = woke && await isIt()
    results.wakeWorstGapMs = await page.evaluate(() => { globalThis.__stop(); return Math.round(Math.max(...globalThis.__gaps) * 10) / 10 })
    console.log(`  worst frame gap while the parked car came to life beside someone on foot: ${results.wakeWorstGapMs} ms`)
    check(woke, 'standing beside it on foot, it is a living thing within reach (E)')
    // (What E takes is the living thing nearest: a van woken beside it was taken once. Said, so the drive is the car's.)
    results.nearToGetIn = await page.evaluate(() => globalThis.engine.alive.near?.name ?? null)
    await page.evaluate(() => { const e = globalThis.engine; globalThis.__gaps = []; globalThis.__stop = e.watch((g) => globalThis.__gaps.push(g)) })
    await page.keyboard.press('KeyE')
    const riding = await page.waitForFunction(() => globalThis.engine.alive.riding !== null, null, { timeout: 10_000 }).then(() => true, () => false)
    await page.waitForTimeout(1500)
    results.getInWorstGapMs = await page.evaluate(() => { globalThis.__stop(); return Math.round(Math.max(...globalThis.__gaps) * 10) / 10 })
    console.log(`  E took the ${results.nearToGetIn} (the parked one chosen: ${car.name}); worst frame gap getting in: ${results.getInWorstGapMs} ms`)
    check(riding, 'E gets in')
    check(results.nearIsChosen, `E gets into the car chosen (the ${results.nearToGetIn} was within reach)`)
    await page.screenshot({ path: join(shots, 'in-car.png') })
    if (riding) {
      // The route: from the road the car stands on, on through the graph, the first junction with a turn taken, then uphill.
      const driving = page.evaluate(async () => {
        const e = globalThis.engine, thing = e.alive.riding, w0 = e.alive.where(thing)
        const roads = e.street.roads(w0.at[0], w0.at[2], 9000).filter((r) => r.open !== false), byKey = new Map(roads.map((r) => [r.key, r]))
        const heading = Math.atan2(w0.front[2], w0.front[0])
        const dirOf = (l, i) => Math.atan2(l[i + 3] - l[i + 1], l[i + 2] - l[i])
        // The road it stands on: nearest, and running the way it faces.
        let first = null, best = Infinity
        for (const r of roads) for (let i = 0; i + 3 < r.line.length; i += 2) {
          const mx = (r.line[i] + r.line[i + 2]) / 2, mz = (r.line[i + 1] + r.line[i + 3]) / 2, d = Math.hypot(mx - w0.at[0], mz - w0.at[2])
          let a = dirOf(r.line, i) - heading; a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI
          if (d < best && Math.abs(a) < 1) { best = d; first = r }
        }
        if (!first) return { error: 'no road under the car' }
        const route = [first], pts = [...first.line]
        let turned = false
        const ground = (x, z) => e.ground(x / 10, z / 10)
        for (let k = 0; k < 80 && pts.length < 20000; k++) {
          const r = route[route.length - 1], end = dirOf(r.line, r.line.length - 4)
          const options = r.next.map((n) => byKey.get(n)).filter(Boolean)
          if (!options.length) break
          const score = (n) => { let a = dirOf(n.line, 0) - end; a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI; const rise = ground(n.line[n.line.length - 2], n.line[n.line.length - 1]) - ground(n.line[0], n.line[1]); return turned ? rise - Math.abs(a) * 2 : (Math.abs(a) > 0.8 && Math.abs(a) < 2.2 ? 100 : 0) + rise - (n.flags & 4 ? 50 : 0) }
          const n = options.sort((a, b) => score(b) - score(a))[0]
          let a = dirOf(n.line, 0) - end; a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI
          if (Math.abs(a) > 0.8) turned = true
          route.push(n); pts.push(...n.line.slice(2))
        }
        // Its lane: 1.65 m right of the line where the road runs both ways.
        const lane = []
        for (let i = 0; i + 1 < pts.length; i += 2) { const j = Math.min(i, pts.length - 4), dx = pts[j + 2] - pts[j], dz = pts[j + 3] - pts[j + 1], l = Math.hypot(dx, dz) || 1; lane.push(pts[i] - (dz / l) * 16, pts[i + 1] + (dx / l) * 16) }
        const track = [], t0 = performance.now(), start = w0.at
        let at = 0, last = null, turnSum = 0, lastHeading = heading, top = start[1], low = start[1], ticks = 0, off = 0
        const offs = [], samples = [], surface = []
        let wedged = 0, backing = 0
        let lastErr = 0
        while (performance.now() - t0 < 60_000 && thing.alive) {
          const w = e.alive.where(thing)
          if (!w) break
          // The point 9 m on along the lane from the nearest one ahead of it.
          let near = Infinity
          for (let i = at; i < Math.min(lane.length, at + 80); i += 2) { const d = Math.hypot(lane[i] - w.at[0], lane[i + 1] - w.at[2]); if (d < near) { near = d; at = i } }
          // How far it is from the middle of the nearest road (any the graph has), twice a second once it has set off.
          if (performance.now() - t0 > 3000 && ticks % 5 === 0) { let d = Infinity; for (const r of e.street.roads(w.at[0], w.at[2], 300)) for (let i = 0; i + 3 < r.line.length; i += 2) { const ax = r.line[i], az = r.line[i + 1], bx = r.line[i + 2] - ax, bz = r.line[i + 3] - az, l2 = bx * bx + bz * bz || 1, t = Math.max(0, Math.min(1, ((w.at[0] - ax) * bx + (w.at[2] - az) * bz) / l2)); d = Math.min(d, Math.hypot(w.at[0] - ax - bx * t, w.at[2] - az - bz * t)) } if (d < Infinity) { const f = e.feet(Math.round(w.at[0]), Math.round(w.at[2])); surface.push((e.kind(w.at[0], f - 1, w.at[2]) & 15) === 6); off = Math.max(off, d); offs.push(d); if (offs.length % 10 === 1) samples.push([Math.round(w.at[0]), Math.round(w.at[2]), Math.round(d), Math.round(near), offs.length]) } }
          let ahead = at, run = 0
          while (ahead + 3 < lane.length && run < (Math.abs(lastErr) > 0.3 ? 55 : 90)) { run += Math.hypot(lane[ahead + 2] - lane[ahead], lane[ahead + 3] - lane[ahead + 1]); ahead += 2 }
          const tx = lane[ahead] - w.at[0], tz = lane[ahead + 1] - w.at[2], h = Math.atan2(w.front[2], w.front[0])
          let err = Math.atan2(tz, tx) - h; err -= Math.round(err / (2 * Math.PI)) * 2 * Math.PI
          lastErr = err
          const speed = last ? Math.hypot(w.at[0] - last[0], w.at[2] - last[2]) / 0.1 : 0
          const wanted = Math.abs(err) > 0.35 ? 30 : 85
          // Wedged (pushing and not moving): back off a car's length, the wheel the other way, then on.
          if (speed < 3 && ticks > 30) wedged++; else wedged = 0
          if (wedged > 20) { backing = 15; wedged = 0 }
          // Near the route's end (where mapping or the road ends), it pulls up and stops.
          let rest = 0
          for (let i = at; i + 3 < lane.length && rest < 160; i += 2) rest += Math.hypot(lane[i + 2] - lane[i], lane[i + 3] - lane[i + 1])
          if (rest < 150) e.alive.drive(thing, speed > 5 ? -0.5 : 0, 0, 0)
          else if (backing > 0) { backing--; e.alive.drive(thing, -1, -Math.sign(err) || 1, 0) }
          else e.alive.drive(thing, speed < wanted ? 1 : speed > wanted + 15 ? -0.4 : 0.15, Math.max(-1, Math.min(1, err * 2.2)), 0)
          let dh = h - lastHeading; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI
          turnSum += dh; lastHeading = h
          top = Math.max(top, w.at[1]); low = Math.min(low, w.at[1])
          if (ticks++ % 10 === 0) track.push([Math.round(w.at[0]), Math.round(w.at[1]), Math.round(w.at[2])])
          last = w.at
          if (ahead + 3 >= lane.length && near < 30) break
          await new Promise((r) => setTimeout(r, 100))
        }
        const w = e.alive.where(thing)
        let largest = 0, sum = 0
        // The largest turn over any 6 s of it, from the track's headings.
        for (let i = 2; i < track.length; i++) { const a = Math.atan2(track[i][2] - track[i - 1][2], track[i][0] - track[i - 1][0]), b = Math.atan2(track[i - 1][2] - track[i - 2][2], track[i - 1][0] - track[i - 2][0]); let d = a - b; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; sum += d; largest = Math.max(largest, Math.abs(sum)); if (i % 6 === 0) sum = 0 }
        let path = 0
        for (let i = 1; i < track.length; i++) path += Math.hypot(track[i][0] - track[i - 1][0], track[i][2] - track[i - 1][2])
        return { seconds: (performance.now() - t0) / 1000, whole: thing.alive, route: route.length, routeMetres: lane.reduce((n, _v, i) => (i >= 2 && i % 2 === 0 ? n + Math.hypot(lane[i] - lane[i - 2], lane[i + 1] - lane[i - 1]) : n), 0) / 10, pathMetres: path / 10, climbMetres: (top - start[1]) / 10, dropMetres: (start[1] - low) / 10, endRiseMetres: w ? (w.at[1] - start[1]) / 10 : null, turnedDegrees: largest * 180 / Math.PI, offLaneMetres: off / 10, onAsphalt: surface.filter(Boolean).length / Math.max(1, surface.length), offLaneMedianMetres: ([...offs].sort((a, b) => a - b)[Math.floor(offs.length / 2)] ?? 0) / 10, samples, offLaneP95Metres: (offs.sort((a, b) => a - b)[Math.floor(offs.length * 0.95)] ?? 0) / 10, track }
      })
      // A picture half way up, from behind.
      await page.waitForTimeout(32_000)
      await page.screenshot({ path: join(shots, 'drive.png') })
      const drove = await driving
      results.drive = { ...drove, track: undefined }
      console.log(`  ${JSON.stringify(results.drive)}`)
      // On the road: asphalt under it (the world's own surface), not the distance from a mapped middle line, which on a wide street is 6 m from its kerb.
      check(drove.onAsphalt >= 0.9, `on the road: asphalt under it in ${Math.round(drove.onAsphalt * 100)}% of samples (${round(drove.offLaneMedianMetres)} m from a road's middle at the median, at most ${round(drove.offLaneMetres)} m)`)
      check(drove.whole && drove.seconds > 55, `driven ${round(drove.seconds)} s and still whole`)
      check(drove.pathMetres > 150, `went ${round(drove.pathMetres)} m`)
      check(drove.turnedDegrees > 60, `turned ${round(drove.turnedDegrees)}° at a junction`)
      check(drove.climbMetres > 5, `climbed ${round(drove.climbMetres)} m`)
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(500)
      await page.evaluate(() => { const e = globalThis.engine; if (e.alive.riding) e.alive.mount(null) })
    }
  }

  // ── A charge among people and cars at Columbus and Broadway ──
  console.log('\nreactions')
  await page.evaluate(() => globalThis.engine.me.walk(false))
  const c = P.columbus.pose
  await look(c)
  await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(2000)
  // Where: among the people nearest the eye. Seen from the eye's own spot 4 m up (clear of awnings), looking down at
  // it, a second after it goes off (the old picture, from 10 m up over it 20 s later, was a wall of cells).
  const target = await page.evaluate(() => {
    const e = globalThis.engine, v = e.view(), people = e.folk.from.flatMap((f) => [...f(v, performance.now() / 1000)])
    const near = people.filter((p) => Math.hypot(p.at[0] - v.eye[0], p.at[2] - v.eye[2]) < 400 && Math.hypot(p.at[0] - v.eye[0], p.at[2] - v.eye[2]) > 60).sort((a, b) => Math.hypot(a.at[0] - v.eye[0], a.at[2] - v.eye[2]) - Math.hypot(b.at[0] - v.eye[0], b.at[2] - v.eye[2]))
    const t = near[Math.min(near.length - 1, 3)]
    return t ? [Math.round(t.at[0]), Math.round(t.at[1] + 2), Math.round(t.at[2])] : null
  })
  if (target) {
    await page.evaluate(({ at, c }) => {
      const e = globalThis.engine, f = e.feet(Math.round(c.x * 10), Math.round(c.z * 10))
      let up = 40
      for (const h of [40, 30, 55, 25]) { let clear = true; for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) for (let y = -4; y <= 4; y += 2) if (e.kind(c.x * 10 + ox, f + h + y, c.z * 10 + oz)) clear = false; if (clear) { up = h; break } }
      const y = (f + up) / 10, dx = at[0] / 10 - c.x, dz = at[2] / 10 - c.z
      Object.assign(e.pose, { x: c.x, z: c.z, y, yaw: Math.atan2(dx, -dz), pitch: Math.atan2(at[1] / 10 - y, Math.hypot(dx, dz)) }); e.fov = 60
    }, { at: target, c })
    await page.waitForTimeout(1500)
  }
  const going = page.evaluate(async (at) => {
    const e = globalThis.engine
    if (!at) return { error: 'nobody near' }
    const carsBefore = e.street.cars(at[0], at[2], 300), livingBefore = e.alive.things.length
    e.strike(at, 20)
    await new Promise((r) => setTimeout(r, 700))
    const after = e.folk.from.flatMap((f) => [...f(e.view(), performance.now() / 1000)])
    const down = after.filter((p) => (p.down ?? 0) > 0.5).length, flinch = after.filter((p) => (p.flinch ?? 0) > 0.3).length
    // The cars nearest it thrown (alive now, in the solver), the traffic round it stopped.
    await new Promise((r) => setTimeout(r, 1500))
    const thrown = e.alive.things.length - livingBefore, moved = e.alive.things.slice(livingBefore).map((t) => { const w = e.alive.where(t); return w ? Math.round(Math.hypot(w.at[0] - at[0], w.at[2] - at[2])) : null })
    const stopped = e.street.cars(at[0], at[2], 800).filter((c) => c.kind === 'traffic').map((c) => Math.round(c.v))
    await new Promise((r) => setTimeout(r, 4000))
    const later = e.street.cars(at[0], at[2], 300)
    await new Promise((r) => setTimeout(r, 14000))
    const after20 = e.street.cars(at[0], at[2], 300)
    return { at, down, flinch, thrown, thrownCellsFromBlast: moved, trafficSpeedsAt2s: stopped, cars: carsBefore.length, carsLater: later.length, drivingAt6s: later.filter((c) => c.kind === 'traffic').map((c) => Math.round(c.v)), drivingAt20s: after20.filter((c) => c.kind === 'traffic').map((c) => Math.round(c.v)) }
  }, target)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: join(shots, 'blast.png') })
  const blast = await going
  await page.evaluate(() => { globalThis.engine.fov = 70 })
  results.blast = blast
  console.log(`  ${JSON.stringify(blast)}`)
  if (day || blast.down !== undefined) check(blast.down > 0, `a charge among the people at Columbus and Broadway throws ${blast.down} down and makes ${blast.flinch} flinch`)
  // A second charge beside a parked car: it is thrown.
  const thrown = await page.evaluate(async () => {
    const e = globalThis.engine, v = e.view(), car = e.street.cars(v.eye[0], v.eye[2], 600).filter((c) => c.kind === 'parked' && !c.living).sort((a, b) => Math.hypot(a.x - v.eye[0], a.z - v.eye[2]) - Math.hypot(b.x - v.eye[0], b.z - v.eye[2]))[0]
    if (!car) return null
    const before = e.alive.things.length, at = [Math.round(car.x + Math.cos(car.heading + Math.PI / 2) * 30), Math.round(car.y + 3), Math.round(car.z + Math.sin(car.heading + Math.PI / 2) * 30)]
    e.strike(at, 15)
    await new Promise((r) => setTimeout(r, 2500))
    const things = e.alive.things.slice(before).map((t) => e.alive.where(t)).filter(Boolean)
    return { car: car.name, thrown: things.length, movedCells: things.map((w) => Math.round(Math.hypot(w.at[0] - car.x, w.at[2] - car.z))), rose: things.map((w) => Math.round(w.at[1] - car.y)) }
  })
  results.carBlast = thrown
  console.log(`  ${JSON.stringify(thrown)}`)
  if (thrown) check(thrown.thrown > 0 && thrown.movedCells.some((d) => d > 8), `a charge 3 m from a parked ${thrown.car} throws ${thrown.thrown} car(s), now ${thrown.movedCells.join(', ')} cells from where it stood`)
  // (A car that comes into the 80 m after the blast was not near it.)
  if (blast.trafficSpeedsAt2s?.length) check(blast.trafficSpeedsAt2s.filter((v) => v < 15).length >= blast.trafficSpeedsAt2s.length * 0.8, `traffic within 80 m stops (${blast.trafficSpeedsAt2s.join(', ')} cells a second) and moves on later (${blast.drivingAt20s?.join(', ')})`)
  // A charge in the road at Columbus and Broadway: the world says where it is broken, the road is closed, and no car drives into the hole.
  {
    const s = onStreet('Columbus Avenue', 522628, 664243)
    await look({ x: s.x / 10 - s.dx * 25, z: s.z / 10 - s.dz * 25, h: 1.7, yaw: Math.atan2(s.dx, -s.dz), pitch: -0.05 })
    await page.waitForTimeout(2000); await settle(); await page.waitForTimeout(3000)
    const hole = await page.evaluate(async ([x, z]) => {
      const e = globalThis.engine, y = e.feet(Math.round(x), Math.round(z))
      e.strike([Math.round(x), y, Math.round(z)], 25)
      await new Promise((r) => setTimeout(r, 4000))
      const c = e.street.count(e.view(), 1500)
      let into = 0
      for (let n = 0; n < 15; n++) { await new Promise((r) => setTimeout(r, 1000)); into = Math.max(into, e.street.cars(x, z, 300).filter((k) => { if (k.kind !== 'traffic') return false; const f = e.feet(Math.round(k.x), Math.round(k.z)); return !e.kind(k.x, f - 1, k.z) && !e.kind(k.x, f - 3, k.z) }).length) }
      return { craters: c.craters, blockedRoads: c.blockedRoads, carsInHoleMost: into }
    }, [s.x, s.z])
    results.crater = hole
    await page.evaluate(([x, z]) => { const e = globalThis.engine, ex = x / 10 - 12, ez = z / 10 + 9; Object.assign(e.pose, { x: ex, z: ez, y: e.ground(x / 10, z / 10) + 11, yaw: Math.atan2(x / 10 - ex, -(z / 10 - ez)), pitch: -0.6 }) }, [s.x, s.z])
    await page.waitForTimeout(2000)
    await page.screenshot({ path: join(shots, 'crater.png') })
    console.log(`  ${JSON.stringify(hole)}`)
    check(hole.craters > 0 && hole.blockedRoads > 0 && hole.carsInHoleMost === 0, `a charge in Columbus Ave: ${hole.craters} hole(s) seen in the world, ${hole.blockedRoads} road(s) closed, no car in 15 s stood where the road was gone`)
    // The cutter in the road 30 m on: the road closed as a blast's hole closes it. And no vehicle near either stands on
    // air (the footing is a rule that knew nothing of holes: cars over one floated at the road's old height).
    const cutAt = [s.x + s.dx * 300, s.z + s.dz * 300]
    await page.evaluate(([x, z, dx, dz]) => { const e = globalThis.engine, ex = x / 10 - dx * 3, ez = z / 10 - dz * 3; Object.assign(e.pose, { x: ex, z: ez, y: e.ground(ex, ez) + 2.5, yaw: Math.atan2(dx, -dz), pitch: -0.7 }) }, [...cutAt, s.dx, s.dz])
    await page.waitForTimeout(1500)
    const cut = await page.evaluate(async () => {
      const e = globalThis.engine, before = e.street.count(e.view(), 1500).blockedRoads, made = await e.cut()
      await new Promise((r) => setTimeout(r, 4000))
      const c = e.street.count(e.view(), 1500)
      // Standing on air: nothing of the world in the 0.5 m under a vehicle's middle.
      let floating = 0, near = 0
      for (let n = 0; n < 8; n++) { await new Promise((r) => setTimeout(r, 1000)); for (const k of e.street.cars(e.view().eye[0], e.view().eye[2], 600)) { if (k.living) continue; near++; let under = false; for (let y = Math.round(k.y) + 1; y >= Math.round(k.y) - 5 && !under; y--) if (e.kind(k.x, y, k.z)) under = true; if (!under) floating++ } }
      return { cut: !!made, before, blockedRoads: c.blockedRoads, craters: c.craters, floating, near }
    })
    results.cutter = cut
    console.log(`  cutter: ${JSON.stringify(cut)}`)
    check(cut.cut && cut.blockedRoads > cut.before, `the cutter's slot in Columbus Ave closes ${cut.blockedRoads - cut.before} more road(s)`)
    check(cut.near > 0 && cut.floating === 0, `no vehicle near the holes stands on air (${cut.floating} of ${cut.near} looks)`)
  }
  // Left turns on green over the whole run (but the 40 s without the yield): none with something coming the other way.
  results.left = await page.evaluate(() => globalThis.engine.street.audit(0).left)
  const leftOn = { turns: results.left.turns - results.leftOff.turns, conflicts: results.left.conflicts - results.leftOff.conflicts }
  check(leftOn.turns > 0 && leftOn.conflicts === 0, `left turns on green wait for oncoming traffic: ${leftOn.turns} turned with the yield, ${leftOn.conflicts} with something coming (${results.leftOff.conflicts} of ${results.leftOff.turns} in 40 s without it)`)
  // (Over the whole run, reported: a bus first stood at a stop a minute or more after it was set down, and the run is a
  // few seconds at each place, so this was 0 in two of three runs on either branch, #450.)
  results.busStops = await page.evaluate(() => globalThis.engine.street.audit(0).buses.stops)
  console.log(`  (report) buses stood at ${results.busStops} of their stops over the run`)
  // Reset puts the street back.
  await page.evaluate(() => globalThis.engine.reset())
  await page.waitForTimeout(3000)
  results.afterReset = await page.evaluate(() => globalThis.engine.street.count(globalThis.engine.view(), 1500))
  check(results.afterReset.parked > 0, `after reset the parked cars are back (${results.afterReset.parked})`)
  // Buses at their stops, watched from when one is on its route: at Columbus and Broadway, up to 8 minutes (a Muni
  // line's headway, page/street.ts busSpawn) for a bus to be set down on its route near the eye, then up to 240 s for
  // one to stand at a stop (pull up, dwell 10 to 22 s, go). Six runs: on its route 1 to 21 s after the eye came, or not
  // in the first minute; at a stop 14 to 150 s after that.
  results.bus = await page.evaluate(async ([x, z]) => {
    const e = globalThis.engine, wait = (ms) => new Promise((r) => setTimeout(r, ms)), buses = () => e.street.audit(0).buses
    Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 1.7 })
    let t = 0
    while (buses().onRoute === 0 && t < 480) { await wait(1000); t++ }
    if (buses().onRoute === 0) return { onRouteAfter: null, served: 0, seconds: null }
    const from = buses().stops, started = t
    while (buses().stops === from && t < started + 240) { await wait(1000); t++ }
    return { onRouteAfter: started, served: buses().stops - from, seconds: t - started }
  }, SPOTS[0].at)
  check(results.bus.served > 0, `a bus stood at a stop at Columbus and Broadway: ${results.bus.served} served, ${results.bus.seconds} s after one was on its route (${results.bus.onRouteAfter} s after the eye came)`)
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} finally {
  await browser.close()
  site.close?.()
  back()
}

// ── Street photographs of the same places, and a contact sheet ──
const sheet = []
for (const spot of SPOTS) {
  const r = results.places?.[spot.name]
  if (!r) continue
  const item = { name: spot.what, engine: join(shots, `${spot.name}.png`), photo: null, line: `${r.people} people (${r.peopleSeen} seen) · ${r.parked} parked · ${r.traffic} driving${r.cable ? ` · ${r.cable} cable car` : ''} · p50 ${r.frames.on.p50} ms, march ${r.frames.on.gpuMs} ms` }
  sheet.push(item)
  if (r.pair) sheet.push({ name: `${spot.what}, as photographed`, engine: join(shots, `${spot.name}-engine.png`), photo: join(shots, `${spot.name}-photo.png`), photoFar: r.pair.metres, line: `panorama ${r.pair.photo}, ${r.pair.captured}, ${r.pair.metres} m from the place` })
}
for (const d of results.density ?? []) sheet.push({ name: `${d.place}, ${d.captured}`, engine: join(shots, `${d.name}-engine.png`), photo: join(shots, `${d.name}-photo.png`), photoFar: 0, line: `engine at ${d.hour}h: ${d.peopleSeen} people, ${d.vehiclesSeen} vehicles in view` })
for (const extra of ['signals', 'lineup', 'in-car', 'drive', 'blast', 'crater']) if (statSync(join(shots, `${extra}.png`), { throwIfNoEntry: false })) sheet.push({ name: extra, engine: join(shots, `${extra}.png`), photo: null, line: extra === 'signals' && results.signals ? `${results.signals.shown} signal heads within 40 m showing ${JSON.stringify(results.signals.lit)}, as the cars on their roads obey them` : extra === 'drive' && results.drive ? `${round(results.drive.pathMetres)} m in ${round(results.drive.seconds)} s, climbed ${round(results.drive.climbMetres)} m, turned ${round(results.drive.turnedDegrees)}°` : extra === 'blast' && results.blast ? `${results.blast.down} thrown down, ${results.blast.flinch} flinched` : extra === 'lineup' ? (results.lineup ?? []).join(', ') : extra === 'crater' && results.crater ? `${results.crater.blockedRoads} road(s) closed, ${results.crater.carsInHoleMost} cars in the hole` : '' })
const html = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#15171c;color:#e8ecf1;font:13px system-ui"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px">${sheet.map((s) => `<figure style="margin:0"><div style="display:flex;gap:4px">${[s.engine, s.photo].filter(Boolean).map((p) => `<img src="data:image/png;base64,${readFileSync(p).toString('base64')}" style="width:${s.photo ? '50%' : '100%'};display:block">`).join('')}</div><figcaption style="padding:4px 2px"><b>${s.name}</b> · ${s.line}${s.photo ? ` · right: street photograph ${s.photoFar} m away (Mapillary, CC BY-SA)` : ''}</figcaption></figure>`).join('')}</div>`
writeFileSync(join(shots, 'sheet.html'), html)
{
  const b = await chromium.launch(CHROME)
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
  await p.setContent(html)
  await p.screenshot({ path: join(shots, 'sheet.png'), fullPage: true })
  await b.close()
}
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
console.log(`\npictures, contact sheet and results in ${shots}`)
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1) }
console.log('\nall well')
process.exit(0)
