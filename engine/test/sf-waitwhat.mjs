// WaitWhat autonomous robotaxis, stuck-street crowd reactions, and WaitWhat Station verification (#57).
// Runs real Chrome WebGPU against dist-sf and verifies:
//   1. WaitWhat Station renders cleanly on Stockton St (Fisherman's Wharf / North Beach) with active ingress/egress.
//   2. WaitWhat Station appears on the 3D/fullscreen map and supports Visit navigation.
//   3. WaitWhat spawn rate surges strongly near WaitWhat Station vs citywide baseline.
//   4. WaitWhat robotaxis drive smoothly and freeze at intersections / narrow streets with flashing hazards.
//   5. Stuck WaitWhats cause blocked cars to honk & flash high beams and pedestrians to stop, turn, yell, and film.
//   6. Players can take and drive a WaitWhat with E.
//   7. Captures full-size screenshots for visual inspection.
//
//   node test/sf-waitwhat.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/waitwhat-check] [--headed]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'waitwhat-check'))
const failures = [], errors = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
for (const f of readdirSync(shots)) if (f.endsWith('.png')) rmSync(join(shots, f))

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

  // ── 1. Map Visit pin for WaitWhat Station ──
  console.log('\n1. WaitWhat Station map pin & depot:')
  const hasStationPlace = await page.evaluate(() => {
    const places = globalThis.engine.map.places ?? []
    return places.find((p) => p.name === 'WaitWhat Station') ?? null
  })
  check(!!hasStationPlace && hasStationPlace.kind === 'landmark', `WaitWhat Station registered in map places (${JSON.stringify(hasStationPlace)})`)

  // Fly to WaitWhat Station overview on Stockton St looking West-Northwest across the depot!
  await page.evaluate(() => {
    const e = globalThis.engine
    e.me.walk(false)
    const st = e.street.waitwhat.station
    // East of Stockton St looking West into the gantry, canopies, pavilion & bays.
    const camX = (st.cx + 420) / 10, camZ = (st.cz + 180) / 10
    const gy = e.ground(camX, camZ)
    const dx = st.cx / 10 - camX, dz = st.cz / 10 - camZ
    Object.assign(e.pose, { x: camX, y: gy + 15.5, z: camZ, yaw: Math.atan2(dx, -dz), pitch: -0.30 })
    e.fov = 68
  })
  await settle(page)
  // Wait for the temporary "Back on your feet" HUD cue to finish fading out so the gantry is 100% unobstructed!
  await page.waitForFunction(() => !document.querySelector('[data-cue]') && ![...document.querySelectorAll('button,div')].some((el) => el.textContent?.includes('Back on your feet') && el.checkVisibility?.()), null, { timeout: 6000 }).catch(() => null)
  await page.waitForTimeout(1500)

  const st1 = await page.evaluate(() => {
    const e = globalThis.engine
    const ww = e.street.waitwhat
    const c = e.street.count(e.view(), 2500)
    return { station: ww.station, waitwhatNear: c.waitwhat, trafficNear: c.traffic, cars: e.street.cars(ww.station.cx, ww.station.cz, 500).filter((car) => car.model === 'waitwhat') }
  })
  check(st1.station.shown && st1.station.bays === 6 && st1.station.occupied + st1.station.exiting + st1.station.entering >= 4,
    `WaitWhat Station rendered with active bays (${JSON.stringify(st1.station)})`)
  await page.screenshot({ path: join(shots, '01-station-overview.png') })

  // Watch for 3.5 s and confirm depot WaitWhats actively move in/out of the station!
  const beforePos = st1.cars.map((c) => [c.x, c.z])
  await page.waitForTimeout(3500)
  const st2 = await page.evaluate(() => {
    const e = globalThis.engine, st = e.street.waitwhat.station
    return { station: st, cars: e.street.cars(st.cx, st.cz, 500).filter((car) => car.model === 'waitwhat') }
  })
  const movedAny = st2.cars.some((c) => beforePos.every(([bx, bz]) => Math.hypot(c.x - bx, c.z - bz) > 8))
  check(movedAny, `WaitWhat depot cars actively circulate in and out of bays (${st2.cars.length} WaitWhats around depot)`)

  // Street-level close-up right outside Stockton St gantry entrance showing signage + gate hardware + WaitWhats (wait if a street car is directly in front of lens!).
  await page.evaluate(async () => {
    const e = globalThis.engine, st = e.street.waitwhat.station
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
  })
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shots, '02-station-closeup-day.png') })

  // Nighttime shot of WaitWhat Station showing illuminated WAITWHAT archway, both lit canopies, active WaitWhats & crisp DEPOT marquee!
  await page.evaluate(() => {
    const e = globalThis.engine, st = e.street.waitwhat.station
    e.hour = 21.0
    const camX = (st.cx + 395) / 10, camZ = (st.cz + 155) / 10
    const gy = e.ground(camX, camZ)
    const dx = (st.cx - 10) / 10 - camX, dz = (st.cz - 10) / 10 - camZ
    Object.assign(e.pose, { x: camX, y: gy + 12.2, z: camZ, yaw: Math.atan2(dx, -dz), pitch: -0.24 })
    e.fov = 68
  })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: join(shots, '03-station-night.png') })
  await page.evaluate(() => { globalThis.engine.hour = 14.5 })
  await page.waitForTimeout(500)

  // ── 2. WaitWhat Vehicle Close-Up (clean unobstructed 3/4 view looking away from canopy pillars & chargers!) ──
  console.log('\n2. WaitWhat vehicle hero close-up:')
  await page.evaluate(() => {
    const e = globalThis.engine, st = e.street.waitwhat.station
    // Pick a charging WaitWhat and frame it from the OUTER/BAY side looking toward the open central aisle & sky (no canopy column or cyan charger behind its glass!).
    const parkedWW = e.street.cars(st.cx, st.cz, 220).find((c) => c.model === 'waitwhat' && c.kind === 'parked')
      ?? e.street.cars(st.cx, st.cz, 400).find((c) => c.model === 'waitwhat' && c.v < 2)
    if (parkedWW) {
      const fx = Math.cos(parkedWW.heading), fz = Math.sin(parkedWW.heading)
      const rx = -fz, rz = fx
      // Stand slightly forward-and-outward (opposite the aisle) looking diagonally across the car into the open sunlit forecourt!
      const toCenterDot = (st.cx - parkedWW.x) * rx + (st.cz - parkedWW.z) * rz
      const side = toCenterDot >= 0 ? -1 : 1
      const cx = (parkedWW.x + fx * 40 + rx * side * 36) / 10
      const cz = (parkedWW.z + fz * 40 + rz * side * 36) / 10
      const gy = e.ground(cx, cz)
      const dx = parkedWW.x / 10 - cx, dz = parkedWW.z / 10 - cz
      Object.assign(e.pose, { x: cx, y: gy + 1.48, z: cz, yaw: Math.atan2(dx, -dz), pitch: -0.09 })
      e.fov = 48
    }
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(shots, '04-waitwhat-closeup.png') })

  // ── 3. Spawn Rate Surge Near WaitWhat Station vs Citywide Baseline ──
  console.log('\n3. Spawn-rate boost around WaitWhat Station vs far neighborhood:')
  const nearRate = await page.evaluate(async () => {
    const e = globalThis.engine, st = e.street.waitwhat.station
    Object.assign(e.pose, { x: (st.cx + 300) / 10, y: e.ground((st.cx + 300) / 10, st.cz / 10) + 18, z: st.cz / 10 })
    await new Promise((r) => setTimeout(r, 1400))
    const all = e.street.cars(st.cx, st.cz, 2400).filter((c) => c.kind === 'traffic')
    const ww = all.filter((c) => c.model === 'waitwhat').length
    return { ww, total: all.length, ratio: all.length ? ww / all.length : 0 }
  })
  // Jump > 1.4 km away (Powell St & Washington St) so stationFactor == 0.
  const farRate = await page.evaluate(async () => {
    const e = globalThis.engine
    const fx = 519580, fz = 668046
    Object.assign(e.pose, { x: fx / 10, y: e.ground(fx / 10, fz / 10) + 18, z: fz / 10 })
    await new Promise((r) => setTimeout(r, 1800))
    const all = e.street.cars(fx, fz, 2400).filter((c) => c.kind === 'traffic')
    const ww = all.filter((c) => c.model === 'waitwhat').length
    return { ww, total: all.length, ratio: all.length ? ww / all.length : 0 }
  })
  check(nearRate.total >= 12 && farRate.total >= 10 && nearRate.ratio >= 0.45 && nearRate.ratio > farRate.ratio + 0.18,
    `WaitWhat share near station ${(nearRate.ratio * 100).toFixed(0)}% (${nearRate.ww}/${nearRate.total}) >> far baseline ${(farRate.ratio * 100).toFixed(0)}% (${farRate.ww}/${farRate.total})`)

  // ── 4. Stuck WaitWhat + Flashing Hazards + Cars Honking + Pedestrians Yelling & Filming ──
  console.log('\n4. Stuck WaitWhat at busy intersection + honking & crowd reactions:')
  await page.evaluate(() => {
    const e = globalThis.engine
    // Busy North Beach intersection (Columbus Ave & Broadway) — lots of pedestrians & traffic!
    const bx = 522628, bz = 664243
    Object.assign(e.pose, { x: bx / 10, y: e.ground(bx / 10, bz / 10) + 6, z: bz / 10 })
    e.fov = 68
  })
  await settle(page)
  await page.waitForTimeout(1600)

  const stuckInfo = await page.evaluate(() => {
    const e = globalThis.engine
    return e.street.waitwhat.triggerStuck('intersection')
  })
  check(!!stuckInfo && stuckInfo.kind === 'intersection', `triggered stuck WaitWhat at intersection (${JSON.stringify(stuckInfo)})`)

  // Position camera on sidewalk overlooking the stuck WaitWhat, blocked cars behind it, and nearby filming/yelling crowd!
  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const rx = -fz, rz = fx
    // Frame from across/beside the sidewalk looking across the crowd toward the frozen WaitWhat + queued honking cars.
    const cx = (st.x + fx * 75 - rx * 105) / 10
    const cz = (st.z + fz * 75 - rz * 105) / 10
    const gy = e.ground(cx, cz)
    const dx = (st.x - fx * 12) / 10 - cx, dz = (st.z - fz * 12) / 10 - cz
    Object.assign(e.pose, { x: cx, y: gy + 2.8, z: cz, yaw: Math.atan2(dx, -dz), pitch: -0.07 })
    e.fov = 70
  }, stuckInfo)

  // Listen for custom shout events and give blocked cars & pedestrians ~4.8 s to honk, film, and yell!
  await page.evaluate(() => {
    globalThis.__wwShoutEvents = 0
    window.addEventListener('voxelwright:waitwhat-shout', () => { globalThis.__wwShoutEvents++ })
  })
  await page.waitForTimeout(4800)

  const react = await page.evaluate(() => {
    const e = globalThis.engine
    const ww = e.street.waitwhat
    return {
      stuckCount: ww.stuck.length,
      reactions: ww.reactions,
      shoutEvents: globalThis.__wwShoutEvents ?? 0,
      folkCount: e.folk.drawn,
    }
  })
  console.log(`    crowd & traffic reactions: ${JSON.stringify(react)}`)
  check(react.stuckCount >= 1, `stuck WaitWhat remains frozen with hazards (${react.stuckCount} stuck)`)
  check(react.reactions.honks >= 1, `blocked cars honked & flashed high beams (${react.reactions.honks} honks)`)
  check(react.reactions.filmers + react.reactions.yellers >= 2 && react.reactions.shouts >= 1 && react.shoutEvents >= 1,
    `nearby pedestrians stopped to film/yell & shouted (${react.reactions.filmers} filmers, ${react.reactions.yellers} yellers, ${react.reactions.shouts} shouts, ${react.shoutEvents} events)`)

  // Wait squarely for the early ON window (phase 0.04..0.34 of the 0..0.65 ON pulse) right before taking each shot!
  const waitHazardOn = () =>
    page.waitForFunction((id) => {
      const s = globalThis.engine.street.waitwhat.stuck.find((x) => x.id === id)
      return !s || (s.hazardOn && s.hazardPhase >= 0.04 && s.hazardPhase < 0.34)
    }, stuckInfo.id, { timeout: 3000, polling: 20 }).catch(() => null)

  const pickCleanView = async (st, mode) =>
    page.evaluate(({ st, mode }) => {
      const e = globalThis.engine
      const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
      const rx = -fz, rz = fx
      const cars = e.street.cars(st.x, st.z, 260)
      const clearPoint = (px, pz, hM) => {
        const f = e.feet(Math.round(px), Math.round(pz))
        if (e.kind(Math.round(px), f + Math.round(hM * 10), Math.round(pz)) !== 0) return false
        // Reject camera points with any vehicle sitting right in front of the lens (within 4.8 m) or between camera and WaitWhat!
        for (const c of cars) {
          if (Math.hypot(c.x - st.x, c.z - st.z) < 8) continue
          const dc = Math.hypot(c.x - px, c.z - pz)
          if (dc < 64) return false
          // Check segment from camera to WaitWhat for obstructing vehicles.
          const vx = st.x - px, vz = st.z - pz, l2 = vx * vx + vz * vz || 1
          const t = ((c.x - px) * vx + (c.z - pz) * vz) / l2
          if (t > 0.05 && t < 0.85) {
            const perp = Math.hypot(c.x - (px + vx * t), c.z - (pz + vz * t))
            if (perp < 36) return false
          }
        }
        return true
      }
      if (mode === 'crowd-closeup') {
        const list = e.street.folk(e.view(), performance.now() / 1000)
        // Prefer a pedestrian actively filming with an outstretched smartphone (ideally also showing a speech pill!).
        const actors = list
          .filter((p) => (p.filming > 0.2 || p.says) && Math.hypot(p.at[0] - st.x, p.at[2] - st.z) < 240)
          .sort((a, b) => (b.filming > 0.2 && b.says ? 3 : b.filming > 0.2 ? 2 : 1) - (a.filming > 0.2 && a.says ? 3 : a.filming > 0.2 ? 2 : 1) || Math.hypot(a.at[0] - st.x, a.at[2] - st.z) - Math.hypot(b.at[0] - st.x, b.at[2] - st.z))
        const rayClear = (ax, ay, az, bx, by, bz) => {
          const steps = Math.max(14, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 4))
          for (let k = 1; k < steps; k++) {
            const u = k / steps
            if (e.kind(Math.round(ax + (bx - ax) * u), Math.round(ay + (by - ay) * u), Math.round(az + (bz - az) * u)) !== 0) return false
          }
          return true
        }
        const clearCloseup = (px, pz, hM) => {
          const f = e.feet(Math.round(px), Math.round(pz)), y = f + Math.round(hM * 10)
          for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) if (e.kind(Math.round(px + ox), y, Math.round(pz + oz)) !== 0) return false
          // Allow standing on the sidewalk near curb-parked cars; only reject cameras inside a car (< 2.2 m) or with a car directly blocking cam -> WaitWhat!
          for (const c of cars) {
            if (Math.hypot(c.x - st.x, c.z - st.z) < 8) continue
            if (Math.hypot(c.x - px, c.z - pz) < 22) return false
            const vx = st.x - px, vz = st.z - pz, l2 = vx * vx + vz * vz || 1
            const t = ((c.x - px) * vx + (c.z - pz) * vz) / l2
            if (t > 0.08 && t < 0.85) {
              if (Math.hypot(c.x - (px + vx * t), c.z - (pz + vz * t)) < 22) return false
            }
          }
          return true
        }
        for (const actor of actors) {
          const vx = st.x - actor.at[0], vz = st.z - actor.at[2], vl = Math.hypot(vx, vz) || 1
          if (vl < 45) continue
          const ux = vx / vl, uz = vz / vl, px = -uz, pz = ux
          // Stay on the open sidewalk/curb; dense rayClear from outdoor actor -> cam rejects stepping through walls into hollow buildings,
          // and bisecting unit directions keeps BOTH the foreground filming bystander AND the stuck WaitWhat cleanly on opposite thirds!
          for (const [fwd, lat] of [[-10, 36], [-10, -36], [-2, 40], [-2, -40], [6, 40], [6, -40], [14, 36], [14, -36]]) {
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
            const gx = camX / 10, gz = camZ / 10, gy = e.ground(gx, gz)
            Object.assign(e.pose, { x: gx, y: gy + 1.65, z: gz, yaw: Math.atan2(bx, -bz), pitch: -0.04 })
            e.fov = 74
            return 'closeup'
          }
        }
      }
      // Clean 3/4 elevated street/curb view showing stuck WaitWhat (front/side amber hazards), queued cars behind, and sidewalk crowd!
      const hM = mode === 'night' ? 2.5 : 3.2
      const opts = [
        [st.x + fx * 72 + rx * 64, st.z + fz * 72 + rz * 64],
        [st.x + fx * 72 - rx * 64, st.z + fz * 72 - rz * 64],
        [st.x + fx * 86 + rx * 80, st.z + fz * 86 + rz * 80],
        [st.x + fx * 86 - rx * 80, st.z + fz * 86 - rz * 80],
      ]
      const chosen = opts.find(([x, z]) => clearPoint(x, z, hM)) ?? opts[0]
      const gx = chosen[0] / 10, gz = chosen[1] / 10, gy = e.ground(gx, gz)
      const tx = (st.x - fx * 24) / 10, tz = (st.z - fz * 24) / 10
      Object.assign(e.pose, { x: gx, y: gy + hM, z: gz, yaw: Math.atan2(tx - gx, -(tz - gz)), pitch: mode === 'night' ? -0.07 : -0.10 })
      e.fov = 72
      return 'street'
    }, { st, mode })

  await pickCleanView(stuckInfo, 'day')
  await page.waitForTimeout(180)
  await waitHazardOn()
  await page.waitForTimeout(40)
  await page.screenshot({ path: join(shots, '05-stuck-intersection-crowd.png') })

  // Over-the-shoulder close-up showing BOTH the filming/yelling bystander (outstretched phone + bubble) AND the stuck WaitWhat in the street!
  await pickCleanView(stuckInfo, 'crowd-closeup')
  await page.waitForTimeout(260)
  await waitHazardOn()
  await page.waitForTimeout(40)
  await page.screenshot({ path: join(shots, '06-stuck-crowd-closeup.png') })

  // Night shot of stuck WaitWhat showing blazing 4-way amber hazards, amber roof dome, queued high-beam car & glowing phones!
  await page.evaluate(() => { globalThis.engine.hour = 20.6 })
  await pickCleanView(stuckInfo, 'night')
  await page.waitForTimeout(550)
  await waitHazardOn()
  await page.waitForTimeout(40)
  await page.screenshot({ path: join(shots, '07-stuck-night-hazards.png') })

  // Verify narrow-street freeze trigger too!
  const narrowInfo = await page.evaluate(() => {
    globalThis.engine.hour = 14.5
    return globalThis.engine.street.waitwhat.triggerStuck('narrow')
  })
  check(!!narrowInfo && narrowInfo.kind === 'narrow', `narrow-street WaitWhat freeze triggers cleanly (${JSON.stringify(narrowInfo)})`)

  // ── 5. Driving a WaitWhat from WaitWhat Station ──
  console.log('\n5. Player taking & driving a WaitWhat:')
  const driveResult = await page.evaluate(async () => {
    const e = globalThis.engine, st = e.street.waitwhat.station
    Object.assign(e.pose, { x: (st.cx + 100) / 10, y: e.ground((st.cx + 100) / 10, st.cz / 10) + 4, z: st.cz / 10 })
    await new Promise((r) => setTimeout(r, 1200))
    const ww = e.street.cars(st.cx, st.cz, 400).find((c) => c.model === 'waitwhat' && c.v < 5)
    if (!ww) return { ok: false, why: 'no parked WaitWhat' }
    e.me.walk(false)
    Object.assign(e.pose, { x: (ww.x + 22) / 10, y: e.ground((ww.x + 22) / 10, (ww.z + 18) / 10) + 1.8, z: (ww.z + 18) / 10 })
    e.me.walk(true)
    await new Promise((r) => setTimeout(r, 900))
    // Press E to take the WaitWhat!
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }))
    let riding = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (e.alive.riding) { riding = e.alive.riding; break }
    }
    if (!riding) return { ok: false, why: 'did not mount WaitWhat on E' }
    const startAt = [...e.alive.where(riding).at]
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    await new Promise((r) => setTimeout(r, 1600))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    const endAt = [...e.alive.where(riding).at]
    const movedM = Math.hypot(endAt[0] - startAt[0], endAt[2] - startAt[2]) / 10
    e.alive.mount(null)
    return { ok: riding.name === 'WaitWhat' && movedM > 2, name: riding.name, movedM: Math.round(movedM * 10) / 10 }
  })
  check(driveResult.ok, `player took and drove WaitWhat with E (${JSON.stringify(driveResult)})`)

  check(errors.length === 0, `zero runtime page/console errors (${errors.length}${errors.length ? ': ' + errors[0] : ''})`)
  writeFileSync(join(shots, 'report.json'), JSON.stringify({ hasStationPlace, st1, nearRate, farRate, react, driveResult, errors, failures }, null, 2))
} finally {
  await browser.close()
  site.stop()
  back()
}

if (failures.length) {
  console.error(`\nFAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\nALL WAITWHAT CHECKS PASSED! Screenshots in ${shots}`)
