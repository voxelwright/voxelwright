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
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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

// ── The bytes of what street life brings ──
const bytes = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).reduce((n, f) => { const b = readFileSync(join(dir, f)); return { raw: n.raw + b.length, br: n.br + brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length, files: n.files + 1 } }, { raw: 0, br: 0, files: 0 })
const results = { hour, libraries: { life: bytes(join(dist, 'sf/life')), cars: bytes(join(dist, 'sf/cars')) } }
for (const f of readdirSync(join(dist, 'sf/cars'))) if (f !== 'index.json') results.libraries[`cars/${f}`] = statSync(join(dist, 'sf/cars', f)).size
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
    // 25 m back along the street from the place and 3.5 m to its right, a person's eye by the kerb, looking along it.
    let x = s.x - s.dx * 250 - s.dz * 35, z = s.z - s.dz * 250 + s.dx * 35
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
    const r = { what: spot.what, eye: [round(pose.x), round(pose.z)], ...on.count, redMost: on.red, waitingMost: on.waiting, signStopsSeen: on.signStops, waits: on.waits, faces: on.faces, within300: { tram: on.wide.tram, cable: on.wide.cable, bus: on.wide.bus, trolley: on.wide.trolley }, frames: { on: { p50: round(on.p50), p99: round(on.p99), gpuMs: round(on.gpuMs), cpuMs: round(on.cpuMs), scale: on.scale, streetCpuMs: round(on.streetMs, 2), figuresMs: round(on.figures?.ms ?? 0, 2), boxes: on.figures?.boxes }, off: { p50: round(off.p50), p99: round(off.p99), gpuMs: round(off.gpuMs), cpuMs: round(off.cpuMs), scale: off.scale } } }
    results.places[spot.name] = r
    results.places[spot.name].pose = pose
    console.log(`  ${spot.what}: people ${r.people} (${r.peopleSeen} in view, up to ${r.waitingMost} waiting at a kerb, ${r.redMost} on a crossing at red), parked ${r.parked}, driving ${r.traffic} (bus ${r.bus}, trolleybus ${r.trolley}, van ${r.van}, truck ${r.truck}), streetcars ${r.tram}, cable cars ${r.cable}; within 300 m ${JSON.stringify(r.within300)}; vehicles in view ${r.vehiclesSeen}, ${r.faces} faces drawn`)
    console.log(`    cars waiting on: ${JSON.stringify(r.waits)}; parked in a lane ${r.parkedInLaneNow}`)
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
  for (const f of readdirSync(join(dist, 'sf/cars')).filter((f) => f !== 'index.json')) { const br = brotliCompressSync(readFileSync(join(dist, 'sf/cars', f)), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length / 1024; check(br <= BUDGET.carBrotliKB, `${f} ${round(br)} KB brotli (budget ${BUDGET.carBrotliKB})`) }

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

  // ── Every vehicle, close up ──
  {
    const s = onStreet('The Embarcadero', 528000, 661600), h = Math.atan2(s.dz, s.dx), at = [s.x - s.dz * 40, s.z + s.dx * 40]
    results.lineup = await page.evaluate(([at, h]) => globalThis.engine.street.lineup(at, h), [at, h])
    await page.evaluate(([at, h]) => { const e = globalThis.engine, cx = at[0] / 10 + Math.cos(h) * 25, cz = at[1] / 10 + Math.sin(h) * 25, ex = at[0] / 10 - Math.cos(h) * 9 - Math.sin(h) * 9, ez = at[1] / 10 - Math.sin(h) * 9 + Math.cos(h) * 9; Object.assign(e.pose, { x: ex, z: ez, y: e.ground(ex, ez) + 2.2, yaw: Math.atan2(cx - ex, -(cz - ez)), pitch: -0.06 }); e.fov = 55 }, [at, h])
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
  const car = await page.evaluate(({ x, z }) => globalThis.engine.street.cars(x, z, 600).filter((c) => c.kind === 'parked' && c.model === 'car').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null, { x: start.x, z: start.z })
  check(!!car, `a parked car on Taylor St to get into${car ? ` (${car.name})` : ''}`)
  if (car) {
    // On foot beside it: it comes to life, and E gets in.
    await page.evaluate((c) => { const e = globalThis.engine; e.me.walk(true); const side = c.heading + Math.PI / 2; Object.assign(e.pose, { x: (c.x + Math.cos(side) * 30) / 10, z: (c.z + Math.sin(side) * 30) / 10, y: e.ground((c.x + Math.cos(side) * 30) / 10, (c.z + Math.sin(side) * 30) / 10) + 2, yaw: Math.atan2(-Math.cos(side), Math.sin(side)) }) }, car)
    await page.evaluate(() => { const e = globalThis.engine; globalThis.__gaps = []; globalThis.__stop = e.watch((g) => globalThis.__gaps.push(g)) })
    const woke = await page.waitForFunction(() => globalThis.engine.alive.near !== null, null, { timeout: 30_000 }).then(() => true, () => false)
    await page.waitForTimeout(1000)
    results.wakeWorstGapMs = await page.evaluate(() => { globalThis.__stop(); return Math.round(Math.max(...globalThis.__gaps) * 10) / 10 })
    console.log(`  worst frame gap while the parked car came to life beside someone on foot: ${results.wakeWorstGapMs} ms`)
    check(woke, 'standing beside it on foot, it is a living thing within reach (E)')
    await page.keyboard.press('KeyE')
    const riding = await page.waitForFunction(() => globalThis.engine.alive.riding !== null, null, { timeout: 10_000 }).then(() => true, () => false)
    check(riding, 'E gets in')
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
  const blast = await page.evaluate(async () => {
    const e = globalThis.engine, v = e.view(), people = e.folk.from.flatMap((f) => [...f(v, performance.now() / 1000)])
    // The middle of the people in view, on the ground.
    const near = people.filter((p) => Math.hypot(p.at[0] - v.eye[0], p.at[2] - v.eye[2]) < 400).sort((a, b) => Math.hypot(a.at[0] - v.eye[0], a.at[2] - v.eye[2]) - Math.hypot(b.at[0] - v.eye[0], b.at[2] - v.eye[2]))
    const target = near[Math.min(near.length - 1, 3)]
    if (!target) return { error: 'nobody near' }
    const at = [Math.round(target.at[0]), Math.round(target.at[1] + 2), Math.round(target.at[2])]
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
  })
  // Seen from 10 m up, over where it went off (at the eye's height the smoke fills the picture).
  await page.evaluate((at) => { const e = globalThis.engine; Object.assign(e.pose, { x: at[0] / 10 - 14, z: at[2] / 10 + 8, y: at[1] / 10 + 10, yaw: Math.atan2(14, -(-8)), pitch: -0.55 }) }, blast.at ?? [P.columbus.pose.x * 10, 200, P.columbus.pose.z * 10])
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'blast.png') })
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
  }
  // Reset puts the street back.
  await page.evaluate(() => globalThis.engine.reset())
  await page.waitForTimeout(3000)
  results.afterReset = await page.evaluate(() => globalThis.engine.street.count(globalThis.engine.view(), 1500))
  check(results.afterReset.parked > 0, `after reset the parked cars are back (${results.afterReset.parked})`)
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
for (const extra of ['lineup', 'in-car', 'drive', 'blast', 'crater']) sheet.push({ name: extra, engine: join(shots, `${extra}.png`), photo: null, line: extra === 'drive' && results.drive ? `${round(results.drive.pathMetres)} m in ${round(results.drive.seconds)} s, climbed ${round(results.drive.climbMetres)} m, turned ${round(results.drive.turnedDegrees)}°` : extra === 'blast' && results.blast ? `${results.blast.down} thrown down, ${results.blast.flinch} flinched` : extra === 'lineup' ? (results.lineup ?? []).join(', ') : extra === 'crater' && results.crater ? `${results.crater.blockedRoads} road(s) closed, ${results.crater.carsInHoleMost} cars in the hole` : '' })
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
