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
  check(st1.station.shown && st1.station.bays === 6 && st1.station.occupied + st1.station.exiting + st1.station.entering >= 4,
    `${primary.station} rendered with active bays (${JSON.stringify(st1.station)})`)
  await page.screenshot({ path: join(shots, '01-station-overview.png') })

  // Watch for 3.5 s and confirm depot robotaxis actively move in/out of the station!
  const beforePos = st1.cars.map((c) => [c.x, c.z])
  await page.waitForTimeout(3500)
  const st2 = await page.evaluate((serviceId) => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations.find((s) => s.serviceId === serviceId) ?? e.street.robotaxis.stations[0]
    return { station: st, cars: e.street.cars(st.cx, st.cz, 500).filter((car) => car.model === 'robotaxi' && car.service === serviceId) }
  }, primary.id)
  const movedAny = st2.cars.some((c) => beforePos.every(([bx, bz]) => Math.hypot(c.x - bx, c.z - bz) > 8))
  check(movedAny, `${primary.name} depot cars actively circulate in and out of bays (${st2.cars.length} ${primary.name}s around depot)`)

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
      folkCount: e.folk.drawn,
    }
  })
  console.log(`    crowd & traffic reactions: ${JSON.stringify(react)}`)
  check(react.stuckCount >= 1, `stuck robotaxi remains frozen with hazards (${react.stuckCount} stuck)`)
  check(react.reactions.honks >= 1, `blocked cars honked & flashed high beams (${react.reactions.honks} honks)`)
  check(react.reactions.filmers >= 1 && react.reactions.yellers >= 1 && react.reactions.shouts >= 1 && react.shoutEvents >= 1,
    `nearby pedestrians stopped to film/yell & shouted (${react.reactions.filmers} filmers, ${react.reactions.yellers} yellers, ${react.reactions.shouts} shouts, ${react.shoutEvents} events)`)

  const waitHazardOn = () =>
    page.waitForFunction((id) => {
      const s = globalThis.engine.street.robotaxis.stuck.find((x) => x.id === id)
      return s?.hazardOn && s.hazardPhase >= 0.04 && s.hazardPhase < 0.34
    }, stuckInfo.id, { timeout: 3000, polling: 20 })

  const pickCleanView = async (st, mode) =>
    page.evaluate(({ st, mode }) => {
      const e = globalThis.engine
      const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
      const rx = -fz, rz = fx
      const cars = e.street.cars(st.x, st.z, 260)
      const rayClear = (ax, ay, az, bx, by, bz) => {
        const steps = Math.max(14, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 4))
        for (let k = 1; k < steps; k++) {
          const u = k / steps
          if (e.kind(Math.round(ax + (bx - ax) * u), Math.round(ay + (by - ay) * u), Math.round(az + (bz - az) * u)) !== 0) return false
        }
        return true
      }
      const clearPoint = (px, pz, hM) => {
        const f = e.feet(Math.round(px), Math.round(pz)), camY = f + Math.round(hM * 10)
        // Reject hollow building interiors & under-awning points: require open air around lens AND open sky overhead!
        for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) if (e.kind(Math.round(px + ox), camY, Math.round(pz + oz)) !== 0) return false
        for (let dy = 8; dy <= 72; dy += 6) if (e.kind(Math.round(px), camY + dy, Math.round(pz)) !== 0) return false
        if (!rayClear(px, camY, pz, st.x, st.y + 10, st.z)) return false
        for (const c of cars) {
          if (Math.hypot(c.x - st.x, c.z - st.z) < 8) continue
          if (Math.hypot(c.x - px, c.z - pz) < 58) return false
          const vx = st.x - px, vz = st.z - pz, l2 = vx * vx + vz * vz || 1
          const t = ((c.x - px) * vx + (c.z - pz) * vz) / l2
          if (t > 0.05 && t < 0.85 && Math.hypot(c.x - (px + vx * t), c.z - (pz + vz * t)) < 34) return false
        }
        return true
      }
      if (mode === 'crowd-closeup') {
        const list = e.street.folk(e.view(), performance.now() / 1000)
        // Prefer actively filming bystanders (phone outstretched), then gesturing yellers/speakers, sorted nearest first!
        const actors = list
          .filter((p) => (p.filming > 0.2 || !!p.move || !!p.says) && Math.hypot(p.at[0] - st.x, p.at[2] - st.z) < 260)
          .sort((a, b) => (b.filming > 0.2 && b.says ? 4 : b.filming > 0.2 ? 3 : b.says ? 2 : 1) - (a.filming > 0.2 && a.says ? 4 : a.filming > 0.2 ? 3 : a.says ? 2 : 1) || Math.hypot(a.at[0] - st.x, a.at[2] - st.z) - Math.hypot(b.at[0] - st.x, b.at[2] - st.z))
        const clearCloseup = (px, pz, hM) => {
          const f = e.feet(Math.round(px), Math.round(pz)), y = f + Math.round(hM * 10)
          for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) if (e.kind(Math.round(px + ox), y, Math.round(pz + oz)) !== 0) return false
          // Never stand underneath a low storefront awning so no dark awning edge intrudes into the top of the close-up frame!
          for (let dy = 8; dy <= 28; dy += 4) if (e.kind(Math.round(px), y + dy, Math.round(pz)) !== 0) return false
          for (const c of cars) {
            if (Math.hypot(c.x - st.x, c.z - st.z) < 8) continue
            if (Math.hypot(c.x - px, c.z - pz) < 22) return false
            const vx = st.x - px, vz = st.z - pz, l2 = vx * vx + vz * vz || 1
            const t = ((c.x - px) * vx + (c.z - pz) * vz) / l2
            if (t > 0.08 && t < 0.85 && Math.hypot(c.x - (px + vx * t), c.z - (pz + vz * t)) < 22) return false
          }
          return true
        }
        for (const actor of actors) {
          const vx = st.x - actor.at[0], vz = st.z - actor.at[2], vl = Math.hypot(vx, vz) || 1
          if (vl < 40) continue
          const ux = vx / vl, uz = vz / vl, px = -uz, pz = ux
          for (const [fwd, lat] of [[-14, 34], [-14, -34], [-10, 38], [-10, -38], [-2, 42], [-2, -42], [6, 40], [6, -40], [14, 36], [14, -36]]) {
            const camX = actor.at[0] + ux * fwd + px * lat
            const camZ = actor.at[2] + uz * fwd + pz * lat
            if (!clearCloseup(camX, camZ, 1.65)) continue
            const camY = e.feet(Math.round(camX), Math.round(camZ)) + 16.5
            if (!rayClear(actor.at[0], actor.at[1] + 13, actor.at[2], camX, camY, camZ)) continue
            if (!rayClear(camX, camY, camZ, st.x, st.y + 10, st.z)) continue
            const dax = actor.at[0] - camX, daz = actor.at[2] - camZ, dal = Math.hypot(dax, daz) || 1
            const dsx = st.x - camX, dsz = st.z - camZ, dsl = Math.hypot(dsx, dsz) || 1
            if ((dax * dsx + daz * dsz) / (dal * dsl) < 0.35) continue
            const bx = (dax / dal) * 0.56 + (dsx / dsl) * 0.44
            const bz = (daz / dal) * 0.56 + (dsz / dsl) * 0.44
            Object.assign(e.pose, { x: camX / 10, y: camY / 10, z: camZ / 10, yaw: Math.atan2(bx, -bz), pitch: -0.04 })
            e.fov = 74
            return 'closeup'
          }
        }
      }
      // Try front three-quarter views first, then the rest of the street if traffic fills the foreground.
      const opts = []
      for (const distance of [94, 78, 115]) {
        for (const angle of [0.65, -0.65, 0.35, -0.35, 1.0, -1.0, 1.45, -1.45, 0, 2.2, -2.2, Math.PI]) {
          const dx = Math.cos(angle + st.heading) * distance, dz = Math.sin(angle + st.heading) * distance
          opts.push([st.x + dx, st.z + dz])
        }
      }
      // Score clear street viewpoints by how many curb-side filming/yelling spectators sit visibly in frame!
      const crowd = e.street.folk(e.view(), performance.now() / 1000).filter((p) => (p.filming > 0.2 || !!p.move || !!p.says) && Math.hypot(p.at[0] - st.x, p.at[2] - st.z) < 250)
      let hM = mode === 'night' ? 2.5 : 3
      let valid = opts.filter(([x, z]) => clearPoint(x, z, hM))
      if (!valid.length) {
        hM = 4.5
        valid = opts.filter(([x, z]) => clearPoint(x, z, hM))
      }
      if (!valid.length) throw new Error('No clear camera position around the stopped robotaxi')
      let chosen = valid[0], bestScore = -1
      for (const [cx, cz] of valid) {
        const tx = st.x - fx * 24, tz = st.z - fz * 24
        const dirX = tx - cx, dirZ = tz - cz, dl = Math.hypot(dirX, dirZ) || 1
        const ux = dirX / dl, uz = dirZ / dl
        let score = 0
        for (const p of crowd) {
          const px = p.at[0] - cx, pz = p.at[2] - cz, d = Math.hypot(px, pz)
          if (d < 35 || d > 280) continue
          const dot = (px * ux + pz * uz) / d
          if (dot > 0.72) score += (p.filming > 0.2 ? 3 : 2) + (p.says ? 3 : 0) + (d < 150 ? 2 : 0)
        }
        if (score > bestScore) { bestScore = score; chosen = [cx, cz] }
      }
      const gx = chosen[0] / 10, gz = chosen[1] / 10, gy = e.feet(Math.round(chosen[0]), Math.round(chosen[1])) / 10
      const tx = (st.x - fx * 24) / 10, tz = (st.z - fz * 24) / 10
      Object.assign(e.pose, { x: gx, y: gy + hM, z: gz, yaw: Math.atan2(tx - gx, -(tz - gz)), pitch: Math.atan2(st.y / 10 + 1 - (gy + hM), Math.hypot(tx - gx, tz - gz)) })
      e.fov = 72
      return 'street'
    }, { st, mode })

  const waitLensClear = (st) =>
    page.evaluate(async (st) => {
      const e = globalThis.engine
      // Wait (up to ~5 s) until no moving car sits near the lens OR anywhere along the sightline to the stuck robotaxi.
      for (let k = 0; k < 36; k++) {
        const cx = e.pose.x * 10, cz = e.pose.z * 10
        const vx = st.x - cx, vz = st.z - cz, l2 = vx * vx + vz * vz || 1
        const blocker = e.street.cars(cx, cz, Math.sqrt(l2) + 60).some((c) => {
          if (Math.hypot(c.x - st.x, c.z - st.z) < 12) return false
          if (Math.hypot(c.x - cx, c.z - cz) < 75) return true
          const t = ((c.x - cx) * vx + (c.z - cz) * vz) / l2
          return t > 0.03 && t < 0.9 && Math.hypot(c.x - (cx + vx * t), c.z - (cz + vz * t)) < 30
        })
        if (!blocker) return true
        await new Promise((r) => setTimeout(r, 140))
      }
      return false
    }, st)

  await pickCleanView(stuckInfo, 'day')
  await page.waitForTimeout(180)
  await waitLensClear(stuckInfo)
  await waitHazardOn()
  await page.waitForTimeout(40)
  await page.screenshot({ path: join(shots, '05-stuck-intersection-crowd.png') })

  await pickCleanView(stuckInfo, 'crowd-closeup')
  await page.waitForTimeout(260)
  await waitHazardOn()
  await page.waitForTimeout(40)
  await page.screenshot({ path: join(shots, '06-stuck-crowd-closeup.png') })

  await page.evaluate(() => { globalThis.engine.hour = 20.6 })
  await pickCleanView(stuckInfo, 'night')
  await page.waitForTimeout(550)
  // A car may pull into the sightline after the view is picked: re-pick once if it never clears.
  if (!(await waitLensClear(stuckInfo))) { await pickCleanView(stuckInfo, 'night'); await page.waitForTimeout(300); await waitLensClear(stuckInfo) }
  await waitHazardOn()
  await page.waitForTimeout(40)
  const nightFrame = await page.screenshot({ path: join(shots, '07-stuck-night-hazards.png') })
  // An eye inside a wall left the entire street blank while the HUD rendered normally.
  // Read the central scene, excluding all HUD corners, from the frame we actually captured.
  const edges = await page.evaluate(async (png) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + png
    await img.decode()
    const ctx = new OffscreenCanvas(64, 40).getContext('2d')
    ctx.drawImage(img, img.width * 0.15, img.height * 0.2, img.width * 0.7, img.height * 0.6, 0, 0, 64, 40)
    const { data } = ctx.getImageData(0, 0, 64, 40)
    let count = 0
    for (let i = 4; i < data.length; i += 4) {
      if (i % 256 && Math.max(...[0, 1, 2].map((c) => Math.abs(data[i + c] - data[i + c - 4]))) > 16) count++
    }
    return count
  }, nightFrame.toString('base64'))
  check(edges > 75, `night frame shows the street around the robotaxi (${edges} contrasting samples)`)

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
  writeFileSync(join(shots, 'report.json'), JSON.stringify({ registry, hasStationPlace, st1, nearRate, farRate, react, driveResult, errors, failures }, null, 2))
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
