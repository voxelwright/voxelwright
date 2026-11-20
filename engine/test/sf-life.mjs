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
  const take = () => page.evaluate(async (ms) => {
    const e = globalThis.engine, gaps = [], street = []
    const stop = e.watch((g) => { gaps.push(g); street.push(e.street.ms) })
    await new Promise((r) => setTimeout(r, ms))
    stop()
    const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => g[Math.min(g.length - 1, Math.floor(g.length * p))]
    return { frames: g.length, p50: q(0.5), p99: q(0.99), gpuMs: e.gpuMs, cpuMs: e.cpuMs, scale: e.scale, streetMs: street.reduce((a, b) => a + b, 0) / Math.max(1, street.length), count: e.street.count(e.view(), 1500), figures: e.folk.drawn }
  }, seconds * 1000)

  // ── Four places ──
  console.log(`\nfour places at ${hour}h`)
  results.places = {}
  for (const spot of SPOTS) {
    const s = onStreet(spot.street, ...spot.at)
    // 25 m back along the street from the place and 6 m to its right, a person's eye at the kerb, looking along it.
    let x = s.x - s.dx * 250 - s.dz * 60, z = s.z - s.dz * 250 + s.dx * 60
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
    const r = { what: spot.what, eye: [round(pose.x), round(pose.z)], ...on.count, frames: { on: { p50: round(on.p50), p99: round(on.p99), gpuMs: round(on.gpuMs), cpuMs: round(on.cpuMs), scale: on.scale, streetCpuMs: round(on.streetMs, 2), figuresMs: round(on.figures?.ms ?? 0, 2), boxes: on.figures?.boxes }, off: { p50: round(off.p50), p99: round(off.p99), gpuMs: round(off.gpuMs), cpuMs: round(off.cpuMs), scale: off.scale } } }
    results.places[spot.name] = r
    results.places[spot.name].pose = pose
    console.log(`  ${spot.what}: people ${r.people} (${r.peopleSeen} in view), parked ${r.parked}, driving ${r.traffic}, cable cars ${r.cable}, vehicles in view ${r.vehiclesSeen}`)
    console.log(`    on  p50 ${r.frames.on.p50} p99 ${r.frames.on.p99} ms, march ${r.frames.on.gpuMs} ms at scale ${r.frames.on.scale}, page CPU ${r.frames.on.cpuMs} ms (street ${r.frames.on.streetCpuMs}, figures ${r.frames.on.figuresMs})`)
    console.log(`    off p50 ${r.frames.off.p50} p99 ${r.frames.off.p99} ms, march ${r.frames.off.gpuMs} ms at scale ${r.frames.off.scale}, page CPU ${r.frames.off.cpuMs} ms`)
    if (spot.cable) await page.evaluate(() => { const e = globalThis.engine; e.folkClock.now = () => Date.now() / 1000 })
  }
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
  check(P.columbus.people > P.hill.people, `busier at Columbus and Broadway (${P.columbus.people} people) than on the residential hill (${P.hill.people})`)
  check(P.powell.cable > 0, `a cable car on Powell St (${P.powell.cable})`)
  check(Object.values(P).filter((p) => p.what).every((p) => p.parked + p.traffic > 0), 'vehicles at every place')

  // ── A car got into on foot and driven 60 s, through a turn and up a hill ──
  console.log('\ndriving')
  const start = onStreet('Taylor Street', 515900, 663000)
  await look({ x: start.x / 10, z: start.z / 10, h: 1.7, yaw: Math.atan2(start.dx, -start.dz), pitch: -0.1 })
  await page.waitForTimeout(1500); await settle()
  const car = await page.evaluate(({ x, z }) => globalThis.engine.street.cars(x, z, 600).filter((c) => c.kind === 'parked').sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0] ?? null, { x: start.x, z: start.z })
  check(!!car, `a parked car on Taylor St to get into${car ? ` (${car.name})` : ''}`)
  if (car) {
    // On foot beside it: it comes to life, and E gets in.
    await page.evaluate((c) => { const e = globalThis.engine; e.me.walk(true); const side = c.heading + Math.PI / 2; Object.assign(e.pose, { x: (c.x + Math.cos(side) * 30) / 10, z: (c.z + Math.sin(side) * 30) / 10, y: e.ground((c.x + Math.cos(side) * 30) / 10, (c.z + Math.sin(side) * 30) / 10) + 2, yaw: Math.atan2(-Math.cos(side), Math.sin(side)) }) }, car)
    const woke = await page.waitForFunction(() => globalThis.engine.alive.near !== null, null, { timeout: 30_000 }).then(() => true, () => false)
    check(woke, 'standing beside it on foot, it is a living thing within reach (E)')
    await page.keyboard.press('KeyE')
    const riding = await page.waitForFunction(() => globalThis.engine.alive.riding !== null, null, { timeout: 10_000 }).then(() => true, () => false)
    check(riding, 'E gets in')
    await page.screenshot({ path: join(shots, 'in-car.png') })
    if (riding) {
      // The route: from the road the car stands on, on through the graph, the first junction with a turn taken, then uphill.
      const drove = await page.evaluate(async () => {
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
        let at = 0, last = null, turnSum = 0, lastHeading = heading, top = start[1], low = start[1], ticks = 0
        while (performance.now() - t0 < 60_000 && thing.alive) {
          const w = e.alive.where(thing)
          if (!w) break
          // The point 9 m on along the lane from the nearest one ahead of it.
          let near = Infinity
          for (let i = at; i < Math.min(lane.length, at + 80); i += 2) { const d = Math.hypot(lane[i] - w.at[0], lane[i + 1] - w.at[2]); if (d < near) { near = d; at = i } }
          let ahead = at, run = 0
          while (ahead + 3 < lane.length && run < 90) { run += Math.hypot(lane[ahead + 2] - lane[ahead], lane[ahead + 3] - lane[ahead + 1]); ahead += 2 }
          const tx = lane[ahead] - w.at[0], tz = lane[ahead + 1] - w.at[2], h = Math.atan2(w.front[2], w.front[0])
          let err = Math.atan2(tz, tx) - h; err -= Math.round(err / (2 * Math.PI)) * 2 * Math.PI
          const speed = last ? Math.hypot(w.at[0] - last[0], w.at[2] - last[2]) / 0.1 : 0
          const wanted = Math.abs(err) > 0.35 ? 45 : 85
          e.alive.drive(thing, speed < wanted ? 1 : speed > wanted + 15 ? -0.4 : 0.15, Math.max(-1, Math.min(1, err * 2.2)), 0)
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
        return { seconds: (performance.now() - t0) / 1000, whole: thing.alive, route: route.length, routeMetres: lane.reduce((n, _v, i) => (i >= 2 && i % 2 === 0 ? n + Math.hypot(lane[i] - lane[i - 2], lane[i + 1] - lane[i - 1]) : n), 0) / 10, pathMetres: path / 10, climbMetres: (top - start[1]) / 10, dropMetres: (start[1] - low) / 10, endRiseMetres: w ? (w.at[1] - start[1]) / 10 : null, turnedDegrees: largest * 180 / Math.PI, track }
      })
      results.drive = { ...drove, track: undefined }
      console.log(`  ${JSON.stringify(results.drive)}`)
      await page.screenshot({ path: join(shots, 'drive.png') })
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
    const carsBefore = e.street.cars(at[0], at[2], 300)
    e.strike(at, 20)
    await new Promise((r) => setTimeout(r, 700))
    const after = e.folk.from.flatMap((f) => [...f(e.view(), performance.now() / 1000)])
    const down = after.filter((p) => (p.down ?? 0) > 0.5).length, flinch = after.filter((p) => (p.flinch ?? 0) > 0.3).length
    await new Promise((r) => setTimeout(r, 6000))
    const later = e.street.cars(at[0], at[2], 300)
    await new Promise((r) => setTimeout(r, 14000))
    const after20 = e.street.cars(at[0], at[2], 300)
    return { at, down, flinch, cars: carsBefore.length, carsLater: later.length, drivingAt6s: later.filter((c) => c.kind === 'traffic').map((c) => Math.round(c.v)), drivingAt20s: after20.filter((c) => c.kind === 'traffic').map((c) => Math.round(c.v)) }
  })
  await page.screenshot({ path: join(shots, 'blast.png') })
  results.blast = blast
  console.log(`  ${JSON.stringify(blast)}`)
  check(blast.down > 0, `a charge among the people at Columbus and Broadway throws ${blast.down} down and makes ${blast.flinch} flinch`)
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
for (const extra of ['in-car', 'drive', 'blast']) sheet.push({ name: extra, engine: join(shots, `${extra}.png`), photo: null, line: extra === 'drive' && results.drive ? `${round(results.drive.pathMetres)} m in ${round(results.drive.seconds)} s, climbed ${round(results.drive.climbMetres)} m, turned ${round(results.drive.turnedDegrees)}°` : extra === 'blast' && results.blast ? `${results.blast.down} thrown down, ${results.blast.flinch} flinched` : '' })
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
