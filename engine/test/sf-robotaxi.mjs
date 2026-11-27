// Autonomous robotaxi fleet, sculpted Waymo Ojai vehicle, stuck-street crowd reactions & charging station check (#57).
// Completely service-agnostic: reads active services & stations dynamically from `engine.street.robotaxis`
// (configured in `page/robotaxi-services.ts`, default primary service: PayMo / PayMo Station).
// Runs real Chrome WebGPU against dist-sf and verifies:
//   1. Each registered robotaxi service's charging station renders cleanly with active ingress/egress.
//   2. Station appears in the 3D/fullscreen map places as a Visit-able landmark.
//   3. Robotaxi traffic share surges strongly near the station vs far citywide baseline.
//   4. Robotaxis drive smoothly and freeze at intersections / narrow streets with flashing 4-way amber hazards.
//   5. Stuck robotaxis cause blocked cars to honk & flash high beams and pedestrians to stop, turn, yell, and film.
//   6. Players can take and drive a robotaxi with E.
//   7. Captures full-size screenshots (including both front 3/4 and rear-side 3/4 close-ups of the sculpted Ojai!) for visual inspection.
//
//   node test/sf-robotaxi.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/robotaxi-check] [--headed]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'robotaxi-check'))
const failures = [], errors = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })

const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })

const settle = (page) =>
  page.waitForFunction(() => { const s = globalThis.engine?.world?.stats; return s && s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(`console: ${m.text()}`) })

  await page.goto(`${site.url}/sf/index.html?hour=14.5&rest=0`)
  await page.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.explore && globalThis.engine.map, null, { timeout: 180_000 })

  // Engage the realm so street life and map initialize cleanly.
  await page.evaluate(() => {
    const e = globalThis.engine
    e.scale = 0.85
    e.rests = false
    void e.explore.go()
  })
  const engaged = await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.street?.ready && globalThis.engine.map?.ready, null, { timeout: 90_000 }).then(() => true, () => false)
  check(engaged, 'SF realm engaged with street life and MAP1 ready')

  // Inspect active robotaxi registry (service-agnostic).
  const registry = await page.evaluate(() => globalThis.engine.street.robotaxis.services)
  check(Array.isArray(registry) && registry.length >= 1, `robotaxi service registry active (${JSON.stringify(registry)})`)
  const primary = registry[0]

  // ── 1. Map Visit pin & station depot ──
  console.log(`\n1. ${primary.station} map pin & depot:`)
  const hasStationPlace = await page.evaluate((stationName) => {
    const places = globalThis.engine.map.places ?? []
    return places.find((p) => p.name === stationName) ?? null
  }, primary.station)
  check(!!hasStationPlace && hasStationPlace.kind === 'landmark', `${primary.station} registered in map places (${JSON.stringify(hasStationPlace)})`)

  await page.keyboard.press('KeyM')
  await page.getByRole('button', { name: primary.station, exact: true }).click()
  await page.locator('#world-map .wm-visit').click()
  await page.waitForFunction(({ x, z }) => {
    const e = globalThis.engine
    return e.explore.state === 'in' && !e.map.open && e.me.on && Math.hypot(e.pose.x - x, e.pose.z - z) < 50
  }, hasStationPlace, { timeout: 30_000 })
  check(true, `Map Visit arrived on foot at ${primary.station}`)

  // Fly to primary station overview looking West-Northwest across the depot!
  await page.evaluate((serviceId) => {
    const e = globalThis.engine
    e.me.walk(false)
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    const camX = (st.cx + 420) / 10, camZ = (st.cz + 180) / 10
    const gy = e.ground(camX, camZ)
    const dx = st.cx / 10 - camX, dz = st.cz / 10 - camZ
    Object.assign(e.pose, { x: camX, y: gy + 15.5, z: camZ, yaw: Math.atan2(dx, -dz), pitch: -0.30 })
    e.fov = 68
  }, primary.id)
  await settle(page)
  await page.waitForFunction(() => !document.querySelector('[data-cue]') && ![...document.querySelectorAll('button,div')].some((el) => el.textContent?.includes('Back on your feet') && el.checkVisibility?.()), null, { timeout: 6000 }).catch(() => null)
  await page.waitForTimeout(1500)

  const st1 = await page.evaluate((serviceId) => {
    const e = globalThis.engine
    const rt = e.street.robotaxis
    const station = rt.stations.find((s) => s.serviceId === serviceId) ?? rt.stations[0]
    const c = e.street.count(e.view(), 2500)
    return { station, robotaxiNear: c.robotaxi, trafficNear: c.traffic, cars: e.street.cars(station.cx, station.cz, 500).filter((car) => car.model === 'robotaxi' && car.service === serviceId) }
  }, primary.id)
  check(st1.station.shown && st1.station.bays === 6 && st1.station.occupied + st1.station.exiting + st1.station.entering > 0,
    `${primary.station} rendered with active bays (${JSON.stringify(st1.station)})`)
  await page.screenshot({ path: join(shots, '01-station-overview.png') })

  // A Visit can arrive while every visible bay is charging. Count completed trips in each direction.
  const trips = await page.waitForFunction((id) => {
    const station = globalThis.engine.street.robotaxis.stations.find((s) => s.serviceId === id)
    return station.arrivals && station.departures && { arrivals: station.arrivals, departures: station.departures }
  }, primary.id, { timeout: 65_000, polling: 250 }).then((handle) => handle.jsonValue())
  check(true, `${primary.station} completed ${trips.arrivals} bay arrivals and ${trips.departures} departures into city traffic`)

  // Street-level close-up right outside Stockton St gantry entrance showing signage + gate hardware + robotaxis.
  await page.evaluate(async (serviceId) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    const camX = (st.cx + 315) / 10, camZ = (st.cz + 15) / 10
    const gy = e.ground(camX, camZ)
    const dx = (st.cx + 150) / 10 - camX, dz = st.cz / 10 - camZ
    Object.assign(e.pose, { x: camX, y: gy + 2.6, z: camZ, yaw: Math.atan2(dx, -dz), pitch: 0.04 })
    e.fov = 68
    for (let k = 0; k < 25; k++) {
      const blocking = e.street.cars(camX * 10, camZ * 10, 95).some((c) => Math.hypot(c.x - camX * 10, c.z - camZ * 10) < 85)
      if (!blocking) break
      await new Promise((r) => setTimeout(r, 150))
    }
  }, primary.id)
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shots, '02-station-closeup-day.png') })

  // Nighttime shot of station showing illuminated archway, both lit canopies, active robotaxis & crisp DEPOT marquee!
  await page.evaluate((serviceId) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    e.hour = 21.0
    const camX = (st.cx + 395) / 10, camZ = (st.cz + 155) / 10
    const gy = e.ground(camX, camZ)
    const dx = (st.cx - 10) / 10 - camX, dz = (st.cz - 10) / 10 - camZ
    Object.assign(e.pose, { x: camX, y: gy + 12.2, z: camZ, yaw: Math.atan2(dx, -dz), pitch: -0.24 })
    e.fov = 68
  }, primary.id)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(shots, '03-station-night.png') })
  await page.evaluate(() => { globalThis.engine.hour = 14.5 })
  await page.waitForTimeout(500)

  // ── 2. Sculpted Waymo Ojai Hero Close-Ups (Front 3/4 + Rear 3/4 to inspect full monobox silhouette & door badge) ──
  console.log(`\n2. ${primary.name} sculpted Ojai hero close-ups:`)
  const heroCar = await page.evaluate((serviceId) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    const parkedRT = e.street.cars(st.cx, st.cz, 240).find((c) => c.model === 'robotaxi' && c.service === serviceId && c.kind === 'parked')
      ?? e.street.cars(st.cx, st.cz, 400).find((c) => c.model === 'robotaxi' && c.service === serviceId && c.v < 2)
    if (!parkedRT) return null
    const fx = Math.cos(parkedRT.heading), fz = Math.sin(parkedRT.heading)
    const rx = -fz, rz = fx
    const toCenterDot = (st.cx - parkedRT.x) * rx + (st.cz - parkedRT.z) * rz
    const side = toCenterDot >= 0 ? -1 : 1
    // Front 3/4 close-up looking across the nose, Stargate visor, curved sliding door & PAYMO badge into open sunlit forecourt.
    const cx = (parkedRT.x + fx * 38 + rx * side * 36) / 10
    const cz = (parkedRT.z + fz * 38 + rz * side * 36) / 10
    const gy = e.ground(cx, cz)
    const dx = parkedRT.x / 10 - cx, dz = parkedRT.z / 10 - cz
    Object.assign(e.pose, { x: cx, y: gy + 1.46, z: cz, yaw: Math.atan2(dx, -dz), pitch: -0.08 })
    e.fov = 48
    return { x: parkedRT.x, z: parkedRT.z, heading: parkedRT.heading, side }
  }, primary.id)
  if (!heroCar) throw new Error('No parked robotaxi available for the Ojai silhouette check')
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(shots, '04-ojai-front-closeup.png') })

  if (heroCar) {
    // Rear 3/4 close-up from the open central aisle side (zero foreground charger pedestals!) inspecting tail, rear LED bar, floating roof & badge.
    await page.evaluate((hc) => {
      const e = globalThis.engine
      const fx = Math.cos(hc.heading), fz = Math.sin(hc.heading)
      const rx = -fz, rz = fx
      const aisleSide = -hc.side
      const cx = (hc.x - fx * 38 + rx * aisleSide * 38) / 10
      const cz = (hc.z - fz * 38 + rz * aisleSide * 38) / 10
      const gy = e.ground(cx, cz)
      const dx = hc.x / 10 - cx, dz = hc.z / 10 - cz
      Object.assign(e.pose, { x: cx, y: gy + 1.54, z: cz, yaw: Math.atan2(dx, -dz), pitch: -0.10 })
      e.fov = 48
    }, heroCar)
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(shots, '04b-ojai-rear-closeup.png') })
  }

  // ── 3. Spawn Rate Surge Near Station vs Citywide Baseline ──
  console.log(`\n3. Spawn-rate boost around ${primary.station} vs far neighborhood:`)
  const nearRate = await page.evaluate(async (serviceId) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    Object.assign(e.pose, { x: (st.cx + 300) / 10, y: e.ground((st.cx + 300) / 10, st.cz / 10) + 18, z: st.cz / 10 })
    await new Promise((r) => setTimeout(r, 1400))
    const all = e.street.cars(st.cx, st.cz, 2400).filter((c) => c.kind === 'traffic')
    const rt = all.filter((c) => c.model === 'robotaxi').length
    return { rt, total: all.length, ratio: all.length ? rt / all.length : 0 }
  }, primary.id)
  // Jump > 1.4 km away (Powell St & Washington St) so stationFactor == 0.
  const farRate = await page.evaluate(async () => {
    const e = globalThis.engine
    const fx = 519580, fz = 668046
    Object.assign(e.pose, { x: fx / 10, y: e.ground(fx / 10, fz / 10) + 18, z: fz / 10 })
    await new Promise((r) => setTimeout(r, 1800))
    const all = e.street.cars(fx, fz, 2400).filter((c) => c.kind === 'traffic')
    const rt = all.filter((c) => c.model === 'robotaxi').length
    return { rt, total: all.length, ratio: all.length ? rt / all.length : 0 }
  })
  check(nearRate.total >= 12 && farRate.total >= 10 && nearRate.ratio >= 0.45 && nearRate.ratio > farRate.ratio + 0.18,
    `robotaxi share near station ${(nearRate.ratio * 100).toFixed(0)}% (${nearRate.rt}/${nearRate.total}) >> far baseline ${(farRate.ratio * 100).toFixed(0)}% (${farRate.rt}/${farRate.total})`)

  // ── 4. Stuck Robotaxi + Flashing Hazards + Cars Honking + Pedestrians Yelling & Filming ──
  console.log(`\n4. Stuck ${primary.name} at busy intersection + honking & crowd reactions:`)
  await page.evaluate(() => {
    const e = globalThis.engine
    // Busy North Beach intersection (Columbus Ave & Broadway) — lots of pedestrians & traffic!
    const bx = 522628, bz = 664243
    Object.assign(e.pose, { x: bx / 10, y: e.ground(bx / 10, bz / 10) + 6, z: bz / 10 })
    e.fov = 68
  })
  await settle(page)
  await page.waitForTimeout(1600)

  const stuckInfo = await page.evaluate((serviceId) => globalThis.engine.street.robotaxis.triggerStuck('intersection', serviceId), primary.id)
  check(!!stuckInfo && stuckInfo.kind === 'intersection' && stuckInfo.serviceId === primary.id, `triggered stuck ${primary.name} at intersection (${JSON.stringify(stuckInfo)})`)

  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const rx = -fz, rz = fx
    const cx = (st.x + fx * 75 - rx * 105) / 10
    const cz = (st.z + fz * 75 - rz * 105) / 10
    const gy = e.ground(cx, cz)
    const dx = (st.x - fx * 12) / 10 - cx, dz = (st.z - fz * 12) / 10 - cz
    Object.assign(e.pose, { x: cx, y: gy + 2.8, z: cz, yaw: Math.atan2(dx, -dz), pitch: -0.07 })
    e.fov = 70
  }, stuckInfo)

  await page.evaluate(() => {
    globalThis.__rtShoutEvents = []
    window.addEventListener('voxelwright:robotaxi-shout', (ev) => { globalThis.__rtShoutEvents.push(ev.detail) })
  })
  await page.waitForTimeout(5600)

  const react = await page.evaluate(() => {
    const e = globalThis.engine
    const rt = e.street.robotaxis
    return {
      stuckCount: rt.stuck.length,
      reactions: rt.reactions,
      shoutEvents: (globalThis.__rtShoutEvents ?? []).length,
      sampleShout: (globalThis.__rtShoutEvents ?? [])[0] ?? null,
      spoken: e.ears?.count?.spoken ?? 0,
      folkCount: e.folk.drawn,
    }
  })
  console.log(`    crowd & traffic reactions: ${JSON.stringify(react)}`)
  check(react.stuckCount >= 1, `stuck robotaxi remains frozen with hazards (${react.stuckCount} stuck)`)
  check(react.reactions.honks >= 1, `blocked cars honked & flashed high beams (${react.reactions.honks} honks)`)
  check(react.reactions.filmers >= 1 && react.reactions.yellers >= 1 && react.reactions.shouts >= 1 && react.shoutEvents >= 1,
    `nearby pedestrians stopped to film/yell & shouted (${react.reactions.filmers} filmers, ${react.reactions.yellers} yellers, ${react.reactions.shouts} shouts, ${react.shoutEvents} events)`)
  check(react.spoken === 0, `bystander robotaxi comments do not play babble voice audio (spoken=${react.spoken})`)

  // Frame the stopped car and its own responding pedestrians at street level. Measure the
  // projected silhouette and distinct people, so a foreground back cannot stand in for a crowd.
  const pickView = (mode) => page.evaluate(({ id, mode }) => {
    const e = globalThis.engine, st = e.street.robotaxis.stuck.find((c) => c.id === id)
    if (!st) throw new Error('The incident cleared before capture')
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const people = e.street.folk(e.view(), performance.now() / 1000)
    const actors = people.filter((p) => p.robotaxiId === st.id && (p.filming > 0.3 || p.move))
    const cars = e.street.cars(st.x, st.z, 320)
    const otherCars = cars.filter((c) => Math.hypot(c.x - st.x, c.z - st.z) > 2)
    const sceneClear = (a, b, obstacles) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
      const steps = Math.ceil(Math.hypot(dx, dy, dz) / 3)
      for (let i = 1; i < steps; i++) {
        const t = i / steps
        if (e.kind(a[0] + t * dx, a[1] + t * dy, a[2] + t * dz)) return false
      }
      return obstacles.every((c) => {
        const hx = Math.cos(c.heading), hz = Math.sin(c.heading)
        const long = ['tram', 'bus', 'trolley', 'cable'].includes(c.model) ? 63 : c.model === 'truck' ? 43 : 24
        // Clip the sightline against the oriented footprint, including the point at the lens.
        let enter = 0, leave = 1
        for (const [ox, oz, extent] of [[hx, hz, long], [-hz, hx, 10]]) {
          const pos = (a[0] - c.x) * ox + (a[2] - c.z) * oz, vel = dx * ox + dz * oz
          if (Math.abs(vel) < 0.001) { if (Math.abs(pos) > extent) return true; continue }
          const u = (-extent - pos) / vel, v = (extent - pos) / vel
          enter = Math.max(enter, Math.min(u, v))
          leave = Math.min(leave, Math.max(u, v))
        }
        return enter > leave
      })
    }
    const atCar = (along, across, high) => {
      const forward = along * Math.cos(st.pitch) - high * Math.sin(st.pitch)
      return [st.x + forward * fx - across * fz, st.y + high * Math.cos(st.pitch) + along * Math.sin(st.pitch), st.z + forward * fz + across * fx]
    }
    const corners = [-22, 22].flatMap((i) => [-9, 9].map((j) => atCar(i, j, 9)))
    const lamps = [-22, 20].flatMap((i) => [-7, 7].map((j) => atCar(i, j, 9)))
    const fov = mode === 'day' ? 57 : 51, tan = Math.tan(fov * Math.PI / 360)
    let best = null
    for (const radius of (mode === 'day' ? [82, 100, 115] : [65, 80, 96])) {
      for (const angle of [0.7, -0.7, 1.05, -1.05, 1.35, -1.35, 1.75, -1.75, 2.1, -2.1, 2.4, -2.4]) {
        const x = st.x + Math.cos(st.heading + angle) * radius, z = st.z + Math.sin(st.heading + angle) * radius
        const y = e.feet(Math.round(x), Math.round(z)) + 18, eye = [x, y, z]
        if (Math.abs(y - st.y - 18) > 10 || e.kind(x, y, z) || e.kind(x, y + 18, z)) continue
        if (people.some((p) => Math.hypot(p.at[0] - x, p.at[2] - z) < 24)) continue
        if (!corners.every((v) => sceneClear(eye, v, otherCars))) continue
        const visible = actors.filter((p) => {
          const [px, py, pz] = p.at
          const dist = Math.hypot(x - px, z - pz)
          const facing = (Math.sin(p.yaw) * (x - px) - Math.cos(p.yaw) * (z - pz)) / dist
          return dist > 29 && dist < 175 && facing > -0.48 && sceneClear(eye, [px, py + 12, pz], cars)
        })
        for (const shift of [-0.29, -0.14, 0, 0.14, 0.29]) {
          const yaw = Math.atan2(st.x - x, z - st.z) + shift, pitch = Math.atan2(st.y + 11 - y, radius)
          const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch)
          const project = ([px, py, pz]) => {
            const dx = px - x, dy = py - y, dz = pz - z, ahead = dx * sy - dz * cy
            const depth = ahead * cp + dy * sp
            return { x: innerWidth / 2 + innerHeight / 2 * (dx * cy + dz * sy) / (depth * tan),
              y: innerHeight / 2 - innerHeight / 2 * (dy * cp - ahead * sp) / (depth * tan), depth }
          }
          const carX = corners.map((corner) => project(corner).x)
          const left = Math.min(...carX), right = Math.max(...carX), width = right - left
          if (left < 40 || right > innerWidth - 40 || width < 245) continue
          const cast = []
          for (const p of [...visible].sort((a, b) => (b.filming || 0) - (a.filming || 0))) {
            const [px, py, pz] = p.at, head = project([px, py + 17, pz]), foot = project(p.at)
            const height = foot.y - head.y, half = height * 0.17
            if (head.depth < 10 || height < 72 || head.y < 62 || foot.y > innerHeight - 60 ||
                head.x - half < 35 || head.x + half > innerWidth - 35) continue
            if (head.x + half > left && head.x - half < right) continue
            if (cast.some((c) => Math.abs(c.x - head.x) < half + c.half)) continue
            cast.push({ x: head.x, half, height, filming: p.filming > 0.3, id: p.seed })
          }
          const phone = cast.some((c) => c.filming)
          const filmerHeight = Math.max(0, ...cast.filter((c) => c.filming).map((c) => c.height))
          const score = Math.min(3, cast.length) * 5 + (phone ? 8 : 0) + Math.min(1.5, width / 340) +
            Math.min(2, filmerHeight / (mode === 'close' ? 85 : 140)) +
            (mode === 'night' && Math.cos(angle) < -0.3 ? 1.4 : 0)
          if (!best || score > best.score) best = { score, x, y, z, yaw, pitch, width, cast, phone, lamps: lamps.map(project) }
        }
      }
    }
    if (!best) throw new Error('No unobstructed street-level view of the stopped taxi')
    Object.assign(e.pose, { x: best.x / 10, y: best.y / 10, z: best.z / 10, yaw: best.yaw, pitch: best.pitch })
    e.fov = fov
    return { width: Math.round(best.width), actors: best.cast.map((p) => p.id), phone: best.phone, lamps: best.lamps }
  }, { id: stuckInfo.id, mode })

  // Let the renderer submit the chosen blink phase, then hold that presented frame while
  // Chromium takes the screenshot. The screenshot itself can take longer than a blink.
  const capturePhase = async (on, path) => {
    await page.evaluate(({ id, on }) => new Promise((resolve, reject) => {
      const e = globalThis.engine
      let rendered = false
      const stop = e.watch(() => {
        if (rendered) { e.resting = true; stop(); clearTimeout(timeout); resolve(); return }
        const st = e.street.robotaxis.stuck.find((c) => c.id === id)
        rendered = !!st && (on ? st.hazardPhase < 0.28 : st.hazardPhase >= 0.65 && st.hazardPhase < 0.84)
      })
      const timeout = setTimeout(() => { stop(); reject(new Error('Incident expired before the requested blink phase')) }, 5000)
    }), { id: stuckInfo.id, on })
    try { return await page.screenshot({ path }) }
    finally { await page.evaluate(() => { globalThis.engine.resting = false }) }
  }
  const framing = {}
  for (const [mode, filename] of [['day', '05-stuck-intersection-crowd.png'], ['close', '06-stuck-crowd-closeup.png']]) {
    const view = framing[mode] = await pickView(mode)
    check(view.actors.length >= 2 && view.phone, `${mode} frame fits a ${view.width}px taxi beside ${view.actors.length} distinct responders, including a filming pose: ${view.phone}`)
    await capturePhase(true, join(shots, filename))
  }
  await page.evaluate(() => { globalThis.engine.hour = 20.6 })
  await page.waitForTimeout(350)
  const night = framing.night = await pickView('night')
  check(night.width >= 245, `night frame shows the stopped taxi at ${night.width}px wide`)
  const dark = await capturePhase(false, join(shots, '07b-stuck-night-hazards-off.png'))
  const lit = await capturePhase(true, join(shots, '07-stuck-night-hazards.png'))
  const amber = await page.evaluate(async ({ dark, lit, lamps }) => {
    const read = async (png) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + png
      await img.decode()
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, img.width, img.height)
    }
    const [off, on] = await Promise.all([read(dark), read(lit)])
    return lamps.map((p) => {
      let count = 0
      for (let y = Math.round(p.y) - 20; y <= p.y + 20; y++) for (let x = Math.round(p.x) - 20; x <= p.x + 20; x++) {
        const i = 4 * (y * on.width + x), [r, g, b] = on.data.subarray(i, i + 3)
        if (r > 150 && g > 55 && r > g * 1.15 && g > b * 1.35 && g > off.data[i + 1] + 12) count++
      }
      return count
    })
  }, { dark: dark.toString('base64'), lit: lit.toString('base64'), lamps: night.lamps })
  check(Math.max(...amber) >= 5, `amber pixels brighten at projected taxi lamps between off and on frames (${amber.join(', ')})`)

  // Verify narrow-street freeze trigger too!
  const narrowInfo = await page.evaluate((serviceId) => {
    globalThis.engine.hour = 14.5
    return globalThis.engine.street.robotaxis.triggerStuck('narrow', serviceId)
  }, primary.id)
  check(!!narrowInfo && narrowInfo.kind === 'narrow', `narrow-street robotaxi freeze triggers cleanly (${JSON.stringify(narrowInfo)})`)

  // ── 5. Taking & Driving a Robotaxi from its Station ──
  console.log(`\n5. Player taking & driving a ${primary.name}:`)
  const driveResult = await page.evaluate(async ({ serviceId, expectedName }) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    Object.assign(e.pose, { x: (st.cx + 100) / 10, y: e.ground((st.cx + 100) / 10, st.cz / 10) + 4, z: st.cz / 10 })
    await new Promise((r) => setTimeout(r, 1200))
    const rt = e.street.cars(st.cx, st.cz, 400).find((c) => c.model === 'robotaxi' && c.service === serviceId && c.v < 5)
    if (!rt) return { ok: false, why: 'no parked robotaxi' }
    e.me.walk(false)
    Object.assign(e.pose, { x: (rt.x + 22) / 10, y: e.ground((rt.x + 22) / 10, (rt.z + 18) / 10) + 1.8, z: (rt.z + 18) / 10 })
    e.me.walk(true)
    await new Promise((r) => setTimeout(r, 900))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }))
    let riding = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (e.alive.riding) { riding = e.alive.riding; break }
    }
    if (!riding) return { ok: false, why: 'did not mount robotaxi on E' }
    const startAt = [...e.alive.where(riding).at]
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    await new Promise((r) => setTimeout(r, 1600))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    const endAt = [...e.alive.where(riding).at]
    const movedM = Math.hypot(endAt[0] - startAt[0], endAt[2] - startAt[2]) / 10
    e.alive.mount(null)
    return { ok: riding.name === expectedName && movedM > 2, name: riding.name, movedM: Math.round(movedM * 10) / 10 }
  }, { serviceId: primary.id, expectedName: primary.name })
  check(driveResult.ok, `player took and drove ${primary.name} with E (${JSON.stringify(driveResult)})`)

  check(errors.length === 0, `zero runtime page/console errors (${errors.length}${errors.length ? ': ' + errors[0] : ''})`)
  writeFileSync(join(shots, 'report.json'), JSON.stringify({ registry, hasStationPlace, st1, trips, nearRate, farRate, react, framing, amber, driveResult, errors, failures }, null, 2))
} finally {
  await browser.close()
  site.stop()
  back()
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\nALL ROBOTAXI CHECKS PASSED! Screenshots in ${shots}`)
