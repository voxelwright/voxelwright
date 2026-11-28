// Real-world verification of unified vehicle lighting (headlights, taillights, brake lights, hazards)
// and San Francisco street lamps illuminating the environment, people, and other cars across Low/Medium/High presets.
//
//   node test/car-lights.mjs [--no-build] [--dist dist-sf] [--shots /path/to/shots] [--headed]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = resolve(here, arg('dist', 'dist-sf'))
const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'car-lights-check'))
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

/** Reads mean RGB and red-excess from a rectangular region of the canvas screenshot (0..1 fractions). */
const sampleRegion = async (page, rect = { x: 0, y: 0, w: 1, h: 1 }) => {
  const buf = await page.screenshot({ type: 'png' })
  return await page.evaluate(async ({ b64, r }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const x0 = Math.floor(r.x * img.width), y0 = Math.floor(r.y * img.height)
    const w = Math.max(1, Math.floor(r.w * img.width)), h = Math.max(1, Math.floor(r.h * img.height))
    const d = ctx.getImageData(x0, y0, w, h).data
    let sr = 0, sg = 0, sb = 0, n = 0
    for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++ }
    const mr = sr / n / 255, mg = sg / n / 255, mb = sb / n / 255
    return { r: mr, g: mg, b: mb, lum: 0.2126 * mr + 0.7152 * mg + 0.0722 * mb, redExcess: mr - (mg + mb) * 0.5 }
  }, { b64: buf.toString('base64'), r: rect })
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => { console.error('PAGEERROR:', e.message); errors.push(`pageerror: ${e.message}`) })
  page.on('console', (m) => {
    const t = m.type(), txt = m.text()
    if (t === 'error' && !/404 \(Not Found\)/.test(txt)) { console.error('CONSOLE ERROR:', txt); errors.push(`console: ${txt}`) }
    else if (t === 'warning' || /WebGPU|WGSL|shader|error|fail/i.test(txt)) { console.warn(`CONSOLE ${t}:`, txt.slice(0, 300)) }
  })
  page.on('requestfailed', (r) => console.warn('REQFAIL:', r.url(), r.failure()?.errorText))

  await page.goto(`${site.url}/sf/index.html?hour=22&rest=0`)
  try {
    await page.waitForFunction(() => globalThis.engine?.seen?.near > 0 && globalThis.engine.explore && globalThis.engine.map, null, { timeout: 180_000 })
  } catch (err) {
    const diag = await page.evaluate(() => ({
      hasEngine: !!globalThis.engine,
      seen: globalThis.engine?.seen,
      explore: !!globalThis.engine?.explore,
      map: !!globalThis.engine?.map,
      world: globalThis.engine?.world?.stats,
      farReady: globalThis.engine?.far?.ready,
      body: document.body.innerText.slice(0, 400),
    })).catch((e) => String(e))
    console.error('DIAG ON TIMEOUT:', JSON.stringify(diag, null, 2))
    throw err
  }

  await page.evaluate(() => {
    const e = globalThis.engine
    e.scale = 0.85
    e.rests = false
    e.graphics.preset = 'high'
    void e.explore.go()
  })
  const engaged = await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.street?.ready && globalThis.engine.map?.ready, null, { timeout: 90_000 }).then(() => true, () => false)
  check(engaged, 'SF realm engaged at night (hour=22) with street life ready')

  // Move to Market St / Financial District where traffic, robotaxis, signals, and dense SFST street lamps all overlap.
  await page.evaluate(() => {
    const e = globalThis.engine
    const tx = 53550, tz = 67100
    e.me.walk(false)
    Object.assign(e.pose, { x: tx, y: e.ground(tx, tz) + 12, z: tz, yaw: 0, pitch: -0.25 })
    e.hour = 22
  })
  await settle(page)
  await page.waitForTimeout(2500)

  // Trigger a stopped robotaxi with queued cars behind it so we have guaranteed close-up headlights, taillights, brake lights, and car-to-car interaction!
  const stuck = await page.evaluate(() => {
    const e = globalThis.engine
    return e.street.robotaxis.triggerStuck('intersection') || e.street.robotaxis.triggerStuck('narrow')
  })
  check(!!stuck, `triggered stopped robotaxi with queued traffic behind it (${stuck ? `${stuck.serviceName} at ${Math.round(stuck.x)},${Math.round(stuck.z)}` : 'none'})`)
  await page.waitForTimeout(800)

  // ── 1. Front view facing headlights (with player standing right in front, like IMG_6806) ──
  console.log('\n1. Front view (headlights illuminating road, player & nearby cars):')
  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const rx = -fz, rz = fx
    // Put player on foot 4.2 m directly in front of the robotaxi's headlights, facing the car (camera sits behind player -> IMG_6806 framing!).
    const px = (st.x + fx * 48 + rx * 4) / 10, pz = (st.z + fz * 48 + rz * 4) / 10
    const py = e.ground(px, pz) + 1.8
    e.me.walk(false)
    const dx = st.x / 10 - px, dz = st.z / 10 - pz
    Object.assign(e.pose, { x: px, y: py, z: pz, yaw: Math.atan2(dx, -dz), pitch: -0.26 })
    e.me.walk(true)
    e.fov = 66
    e.graphics.preset = 'high'
  }, stuck)
  await settle(page)
  await page.waitForTimeout(700)

  const statsHigh = await page.evaluate(() => ({ ...globalThis.engine.localLights }))
  console.log('  localLights (high):', statsHigh)
  check(statsHigh.quality === 'high' && statsHigh.budget === 48, `High preset budget active (${JSON.stringify(statsHigh)})`)
  check(statsHigh.car > 0, `active car lights detected (${statsHigh.car})`)
  check(statsHigh.street > 0, `active SF street lamps detected from .bay SFST (${statsHigh.street})`)
  check(statsHigh.extra > 0, `systemic LAMP=15 piece emitters active (LiDAR domes / signals / depots: ${statsHigh.extra})`)

  await page.screenshot({ path: join(shots, '01-front-high.png') })
  const frontOn = await sampleRegion(page, { x: 0.2, y: 0.40, w: 0.6, h: 0.52 })

  // Compare with local lights disabled to prove measurable illumination on road, player & environment!
  await page.evaluate(() => globalThis.engine.off.add('lights'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, '01-front-off.png') })
  const frontOff = await sampleRegion(page, { x: 0.2, y: 0.40, w: 0.6, h: 0.52 })
  await page.evaluate(() => globalThis.engine.off.delete('lights'))
  await page.waitForTimeout(250)
  console.log(`  front road/player lum: ON=${frontOn.lum.toFixed(4)} vs OFF=${frontOff.lum.toFixed(4)} (+${((frontOn.lum - frontOff.lum) * 100).toFixed(2)}%)`)
  check(frontOn.lum > frontOff.lum + 0.025, `headlights + street lamps measurably illuminate front road, player & surroundings (${frontOn.lum.toFixed(3)} > ${frontOff.lum.toFixed(3)})`)

  // ── 2. Rear view behind braking robotaxi & queued following car (with player standing right behind taillight, like IMG_6808) ──
  console.log('\n2. Rear view (taillights/brakelights illuminating road, player & following car):')
  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const rx = -fz, rz = fx
    // Stand right behind the queued follower / robotaxi rear bumper looking forward along the line of cars (IMG_6808 framing!).
    const px = (st.x - fx * 34 - rx * 8) / 10, pz = (st.z - fz * 34 - rz * 8) / 10
    const py = e.ground(px, pz) + 1.8
    e.me.walk(false)
    const tx = (st.x + fx * 60) / 10, tz = (st.z + fz * 60) / 10
    Object.assign(e.pose, { x: px, y: py, z: pz, yaw: Math.atan2(tx - px, -(tz - pz)), pitch: -0.34 })
    e.me.walk(true)
    e.fov = 66
    e.graphics.preset = 'high'
  }, stuck)
  await settle(page)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, '02-rear-high.png') })
  const rearOn = await sampleRegion(page, { x: 0.22, y: 0.25, w: 0.56, h: 0.65 })

  await page.evaluate(() => globalThis.engine.off.add('lights'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, '02-rear-off.png') })
  const rearOff = await sampleRegion(page, { x: 0.22, y: 0.25, w: 0.56, h: 0.65 })
  await page.evaluate(() => globalThis.engine.off.delete('lights'))
  await page.waitForTimeout(250)
  console.log(`  rear lum: ON=${rearOn.lum.toFixed(4)} vs OFF=${rearOff.lum.toFixed(4)}; redExcess ON=${rearOn.redExcess.toFixed(4)} vs OFF=${rearOff.redExcess.toFixed(4)}`)
  check(rearOn.lum > rearOff.lum + 0.015, `rear lights & headlights illuminate street, player & queued cars (${rearOn.lum.toFixed(3)} > ${rearOff.lum.toFixed(3)})`)
  check(rearOn.redExcess > rearOff.redExcess + 0.008, `red taillight/brake splash lifts red channel on road, player & following car (${rearOn.redExcess.toFixed(4)} > ${rearOff.redExcess.toFixed(4)})`)

  // ── 2b. Car-to-car view: along the road lane looking forward past the queued follower & PayMo (no sideways offset into buildings!) ──
  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const rx = -fz, rz = fx
    e.me.walk(false)
    const cx = (st.x - fx * 110 - rx * 12) / 10, cz = (st.z - fz * 110 - rz * 12) / 10
    const cy = e.ground(cx, cz) + 3.2
    const tx = (st.x - fx * 10) / 10, tz = (st.z - fz * 10) / 10
    Object.assign(e.pose, { x: cx, y: cy, z: cz, yaw: Math.atan2(tx - cx, -(tz - cz)), pitch: -0.22 })
    e.fov = 62
    e.graphics.preset = 'high'
  }, stuck)
  await settle(page)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, '02b-car-to-car-high.png') })

  // ── 3. Preset comparison (Low / Medium / High) + GPU timing ──
  console.log('\n3. Graphics presets (Low / Medium / High) & GPU performance:')
  const timings = {}
  for (const preset of ['low', 'medium', 'high']) {
    await page.evaluate((p) => { globalThis.engine.graphics.preset = p }, preset)
    await page.waitForTimeout(400)
    const st = await page.evaluate(() => ({ ...globalThis.engine.localLights }))
    const ms = await page.evaluate(() => globalThis.engine.paced(undefined, true, false, true))
    timings[preset] = { ms: Number(ms.toFixed(2)), ...st }
    await page.screenshot({ path: join(shots, `03-preset-${preset}.png`) })
    console.log(`  ${preset.padEnd(6)}: ${ms.toFixed(2)} ms | lights=${st.total} (car=${st.car}, street=${st.street}, extra=${st.extra}, budget=${st.budget})`)
  }
  await page.evaluate(() => { globalThis.engine.graphics.preset = 'high'; globalThis.engine.off.add('lights') })
  await page.waitForTimeout(300)
  const msOff = await page.evaluate(() => globalThis.engine.paced(undefined, true, false, true))
  await page.evaluate(() => globalThis.engine.off.delete('lights'))
  console.log(`  high (lights OFF): ${msOff.toFixed(2)} ms | delta=${(timings.high.ms - msOff).toFixed(2)} ms`)
  check(timings.low.budget === 12 && timings.medium.budget === 28 && timings.high.budget === 48, 'Low/Medium/High light budgets scale 12 -> 28 -> 48')

  // ── 4. Wet road night shot on High (headlights, red brake lights, & street lamps reflecting on wet asphalt) ──
  console.log('\n4. Wet road reflections at night (High):')
  await page.evaluate(() => { globalThis.engine.graphics.preset = 'high'; globalThis.engine.rain = 0.85 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, '04-rear-wet-high.png') })
  await page.evaluate(() => { globalThis.engine.rain = 0 })

  // ── 5. Elevated avenue overview along the road corridor at night (High) ──
  console.log('\n5. Avenue overview at night (High):')
  await page.evaluate((st) => {
    const e = globalThis.engine
    const fx = Math.cos(st.heading), fz = Math.sin(st.heading)
    const cx = (st.x + fx * 170) / 10, cz = (st.z + fz * 170) / 10
    const cy = e.ground(cx, cz) + 14.0
    Object.assign(e.pose, { x: cx, y: cy, z: cz, yaw: Math.atan2(st.x / 10 - cx, -(st.z / 10 - cz)), pitch: -0.45 })
    e.fov = 66
    e.graphics.preset = 'high'
  }, stuck)
  await settle(page)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, '05-avenue-high.png') })

  // ── 6. Robotaxi charging depot & spinning cyan-mint roof LiDAR domes at night (High) ──
  console.log('\n6. Robotaxi charging depot & spinning roof LiDAR illumination at night (High):')
  const depotCar = await page.evaluate(() => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations[0]
    if (!st) return null
    e.me.walk(false)
    // `st.visit` is the forecourt approach point looking straight into `(st.cx, st.cz)`.
    const cx = st.visit[0] / 10, cz = st.visit[1] / 10
    const cy = e.ground(cx, cz) + 4.5
    const tx = st.cx / 10, tz = st.cz / 10
    Object.assign(e.pose, { x: cx, y: cy, z: cz, yaw: Math.atan2(tx - cx, -(tz - cz)), pitch: -0.18 })
    e.fov = 66
    e.graphics.preset = 'high'
    return { cx, cz, tx, tz }
  })
  await settle(page)
  await page.waitForTimeout(1000)
  const depotStats = await page.evaluate(() => ({ ...globalThis.engine.localLights }))
  console.log('  depot localLights (high):', depotStats)
  check(depotStats.extra > 0, `depot canopies, active chargers & spinning LiDAR domes emitting (${depotStats.extra})`)
  await page.screenshot({ path: join(shots, '06-depot-lidar-high.png') })

  // Close-up of a normal (non-stuck) charging PayMo inside the depot so its cyan-mint spinning roof LiDAR illuminates its white roof.
  const closeOk = await page.evaluate(() => {
    const e = globalThis.engine
    const st = e.street.robotaxis.stations[0]
    if (!st) return false
    const cars = e.street.cars(st.cx, st.cz, 350).filter((c) => c.service === st.serviceId)
    const target = cars[0]
    if (!target) return false
    const cx = target.x / 10 - 3.6, cz = target.z / 10 - 3.6
    const cy = e.ground(cx, cz) + 3.2
    Object.assign(e.pose, { x: cx, y: cy, z: cz, yaw: Math.atan2(target.x / 10 - cx, -(target.z / 10 - cz)), pitch: -0.35 })
    e.fov = 60
    return true
  })
  if (closeOk) {
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(shots, '06b-lidar-closeup-high.png') })
  }

  // ── 7. Parked cars at night keep all headlights/taillights off and emit zero generic LAMP spotlights ──
  console.log('\n7. Parked cars at night (Sansome St curb):')
  await page.evaluate(() => {
    const e = globalThis.engine
    e.me.walk(false)
    Object.assign(e.pose, { x: 52534.32, y: 6.06, z: 65820.94, yaw: 2.76, pitch: -0.128 })
    e.fov = 58
    e.hour = 22
    e.graphics.preset = 'high'
  })
  await settle(page)
  await page.waitForTimeout(800)
  const parkedCheck = await page.evaluate(() => {
    const e = globalThis.engine
    const cars = e.street.cars(525343, 658209, 400)
    const parked = cars.filter((c) => c.kind === 'parked')
    return { parkedCount: parked.length, localLights: { ...e.localLights } }
  })
  console.log('  parkedCheck:', parkedCheck)
  await page.screenshot({ path: join(shots, '07-parked-cars-off.png') })
  const parkedSample = await sampleRegion(page, { x: 0.05, y: 0.35, w: 0.9, h: 0.55 })
  console.log(`  parked curb redExcess=${parkedSample.redExcess.toFixed(4)} lum=${parkedSample.lum.toFixed(4)}`)
  check(parkedCheck.parkedCount >= 4, `parked cars present on Sansome St (${parkedCheck.parkedCount})`)
  check(parkedCheck.localLights.extra <= 6, `parked cars do not flood localLights.extra with generic LAMP spotlights (${parkedCheck.localLights.extra})`)
  check(parkedSample.redExcess < 0.04, `parked cars do not cast red taillight glow onto street/buildings (redExcess=${parkedSample.redExcess.toFixed(4)})`)

  check(errors.length === 0, errors.length ? `console/page errors: ${errors.join('; ')}` : 'zero console or page errors')
} catch (e) {
  console.error('TEST ERROR:', e)
  failures.push(String(e))
} finally {
  await browser.close()
  site.stop()
  back()
}

console.log(`\ncar-lights: ${failures.length ? `FAIL (${failures.length})\n  - ${failures.join('\n  - ')}` : 'PASS'}`)
console.log(`screenshots: ${shots}`)
process.exit(failures.length ? 1 : 0)
