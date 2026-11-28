// Regression checks for parked-car waking/entry and person-vs-car impacts:
// 1. `planParkedWakes` wakes nearby parked cars regardless of distant crashed/thrown vehicles,
//    evicts farther unmoved parked cars along dense blocks with hysteresis, and protects cars within entry reach.
// 2. Running on foot (`me`) into a physical drivable car in real Chrome stops the player cleanly,
//    emits `STRUCK` with the figure flag bit (8/16), causes zero vehicle deformation, zero sparks/glint/crash bursts,
//    and still allows entering the car with KeyE.
//
//   node test/car-collision-entry.mjs
import { planParkedWakes } from '../page/street.ts'
import { STRUCK_FIGURE_MASK } from '../page/told.ts'
import { start, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

// ── 1. Unit tests for `planParkedWakes` ──
{
  const feet = [1000, 100, 2000]
  // Scenario A: only 1 unmoved parked car is active (3 distant crashed cars were excluded from `active`);
  // nearby parked cars 2002 (2 m) and 2005 (6 m) must both wake immediately.
  const activeA = [{ car: { id: 1994, x: 1012, y: 100, z: 2000 }, x: 1012, z: 2000 }]
  const candsA = [
    { id: 2002, x: 980, y: 100, z: 2000 },
    { id: 2005, x: 940, y: 100, z: 2000 },
    { id: 2099, x: 1010, y: 190, z: 2000 }, // 9 m above (overpass): must be ignored
  ]
  const resA = planParkedWakes(feet, activeA, candsA, 0)
  check(resA.evict.length === 0 && resA.wake.map((c) => c.id).join(',') === '2002,2005', `wakes nearby street-level parked cars and ignores overpass car (wake=${resA.wake.map((c) => c.id)})`)

  // Scenario B: dense block with 4 unmoved parked cars already awake (two far behind at 14 m & 18 m, two close at 2 m & 4 m);
  // approaching cars 5 (3 m) and 6 (7 m) must evict the two farthest cars and wake both.
  const activeB = [
    { car: { id: 1, x: 1180, y: 100, z: 2000 }, x: 1180, z: 2000 },
    { car: { id: 2, x: 1140, y: 100, z: 2000 }, x: 1140, z: 2000 },
    { car: { id: 3, x: 1040, y: 100, z: 2000 }, x: 1040, z: 2000 },
    { car: { id: 4, x: 1020, y: 100, z: 2000 }, x: 1020, z: 2000 },
  ]
  const candsB = [
    { id: 5, x: 970, y: 100, z: 2000 },
    { id: 6, x: 930, y: 100, z: 2000 },
  ]
  const resB = planParkedWakes(feet, activeB, candsB, 0)
  check(
    resB.evict.map((c) => c.id).join(',') === '1,2' && resB.wake.map((c) => c.id).join(',') === '5,6',
    `dense block evicts farthest behind-player cars (evict=${resB.evict.map((c) => c.id)}, wake=${resB.wake.map((c) => c.id)})`,
  )

  // Scenario C: entry-reach & hysteresis protection — 4 cars all within 4.5 m (<= 50 cells) must NOT be evicted.
  const activeC = [
    { car: { id: 10, x: 1042, y: 100, z: 2000 }, x: 1042, z: 2000 },
    { car: { id: 11, x: 1035, y: 100, z: 2000 }, x: 1035, z: 2000 },
    { car: { id: 12, x: 1020, y: 100, z: 2000 }, x: 1020, z: 2000 },
    { car: { id: 13, x: 1015, y: 100, z: 2000 }, x: 1015, z: 2000 },
  ]
  const resC = planParkedWakes(feet, activeC, [{ id: 14, x: 990, y: 100, z: 2000 }], 0)
  check(resC.evict.length === 0 && resC.wake.length === 0, 'never evicts awake parked cars within 5 m entry reach')

  // Scenario D: hysteresis margin — car at 8.0 m is not evicted for a candidate at 7.0 m (only 1.0 m closer < 1.5 m margin).
  const activeD = [
    { car: { id: 20, x: 1080, y: 100, z: 2000 }, x: 1080, z: 2000 },
    { car: { id: 21, x: 1040, y: 100, z: 2000 }, x: 1040, z: 2000 },
    { car: { id: 22, x: 1030, y: 100, z: 2000 }, x: 1030, z: 2000 },
    { car: { id: 23, x: 1020, y: 100, z: 2000 }, x: 1020, z: 2000 },
  ]
  const resD = planParkedWakes(feet, activeD, [{ id: 24, x: 930, y: 100, z: 2000 }], 0)
  check(resD.evict.length === 0 && resD.wake.length === 0, 'hysteresis prevents thrashing when candidate is within 1.5 m of farthest awake car')

  // Scenario E: in-flight waking count counts against cap without double-spawning.
  const resE = planParkedWakes(feet, activeA, candsA, 3)
  check(resE.wake.length === 0 && resE.evict.length === 0, 'respects in-flight waking count when pool + waking reaches cap')
}

// ── 2. Real Chrome WebGPU check: running on foot into a physical car ──
const { city, check: kitCheck, finish } = await start()
try {
  const page = await city('fire=0&people=0&hour=11', { size: [1280, 720], dpr: 1 })
  await still(page)
  await page.evaluate(async () => {
    const e = globalThis.engine, x = 660, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
    globalThis.car = await e.alive.spawn(e.car([x, ground + 5, z]))
  })
  await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.where(globalThis.car), null, { timeout: 20_000 })

  // Place player on foot 3.5 m west of the car, facing east straight into the car, and spy on crash/glint/debris FX.
  await page.evaluate(() => {
    const e = globalThis.engine, w = e.alive.where(globalThis.car)
    globalThis.fxCounts = { crash: 0, glint: 0, burst: 0 }
    const origCrash = e.smoke.crash.bind(e.smoke)
    const origGlint = e.smoke.glint.bind(e.smoke)
    const origBurst = e.debris.burst.bind(e.debris)
    e.smoke.crash = (...args) => { globalThis.fxCounts.crash++; return origCrash(...args) }
    e.smoke.glint = (...args) => { globalThis.fxCounts.glint++; return origGlint(...args) }
    e.debris.burst = (...args) => { globalThis.fxCounts.burst++; return origBurst(...args) }
    e.pose.x = (w.at[0] - 45) / 10
    e.pose.z = w.at[2] / 10
    e.pose.y = e.ground(e.pose.x, e.pose.z) + 2.2
    e.pose.yaw = Math.PI / 2
    e.pose.pitch = -0.1
    e.me.walk(true)
  })
  await page.waitForFunction(() => globalThis.engine.me.feet && globalThis.engine.me.id > 0, null, { timeout: 10_000 })
  await page.waitForTimeout(800)

  // Sprint straight into the car.
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2200)
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(400)

  const res = await page.evaluate((figMask) => {
    const e = globalThis.engine, car = globalThis.car, w = e.alive.where(car), f = e.me.feet
    const hits = e.alive.struck.filter((s) => (s.a === car.id && s.b === e.me.id) || (s.b === car.id && s.a === e.me.id))
    return {
      damage: e.alive.damage(car),
      fx: globalThis.fxCounts,
      hits: hits.map((s) => ({ speed: s.speed, flags: s.flags, hasFig: (s.flags & figMask) !== 0 })),
      carX: w?.at[0] ?? 0,
      footX: f?.at[0] ?? 0,
      nearId: e.alive.near?.id ?? 0,
    }
  }, STRUCK_FIGURE_MASK)

  kitCheck(res.hits.length > 0, `running into the car recorded solver contact (${res.hits.length} hit(s), max speed ${Math.max(0, ...res.hits.map((h) => h.speed)).toFixed(1)} cells/s)`)
  kitCheck(res.hits.every((h) => h.hasFig), `every person-car STRUCK record carries the figure flag bit (${JSON.stringify(res.hits.map((h) => h.flags))})`)
  kitCheck(res.footX < res.carX, `player body was stopped by the car rather than passing through (footX=${res.footX.toFixed(1)}, carX=${res.carX.toFixed(1)})`)
  kitCheck(res.damage === null, `running into the car left zero deformation (damage=${JSON.stringify(res.damage)})`)
  kitCheck(res.fx.crash === 0 && res.fx.glint === 0 && res.fx.burst === 0, `running into the car triggered zero crash/glint/spark bursts (${JSON.stringify(res.fx)})`)

  // Pressing E beside the car enters it cleanly.
  await page.keyboard.press('KeyE')
  await page.waitForFunction(() => globalThis.engine.alive.riding?.id === globalThis.car.id, null, { timeout: 5_000 })
  kitCheck(await page.evaluate(() => globalThis.engine.alive.riding?.id === globalThis.car.id), 'KeyE enters the car cleanly after bumping into it')
} finally {
  for (const f of failures) kitCheck(false, f)
  await finish('car-collision-entry')
}
