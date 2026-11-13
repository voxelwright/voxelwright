// The sun's maps against traced shadows, for real (#140): the city page in the installed
// Chrome with WebGPU. Standing still, after flying down the street away from the sun (how soon
// the two agree again), a few seconds later, and after a blast. The page draws each view both ways and says what
// share of pixels differ.
//
//   node test/shadows.mjs
import { start, still as rest } from './kit.mjs'

const { city, check, failures, finish } = await start()
const percent = (x) => `${(x * 100).toFixed(2)}%`
try {
  const page = await city('scale=0.5&fire=0')
  const settled = () => page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 && e.world.stats.ready > 0 && e.march.sun.undrawn === 0 && e.march.sun.spoiled === 0 }, null, { timeout: 120_000 })
  const differ = () => page.evaluate(() => globalThis.engine.shadowsDiffer())
  const paced = (maps) => page.evaluate(async (m) => { const e = globalThis.engine, was = e.march.maps; e.march.maps = m; const ms = await e.paced(); e.march.maps = was; return ms }, maps)

  // Standing in the street, facing house fronts.
  await page.evaluate(() => Object.assign(globalThis.engine.pose, { y: globalThis.engine.pose.y - 10.2, yaw: 60 * Math.PI / 180, pitch: 5 * Math.PI / 180 }))
  await page.waitForTimeout(300)
  await settled()
  await page.waitForTimeout(500)
  const still = await differ()
  check(still < 0.04, `standing still, ${percent(still)} of pixels differ between mapped and traced shadows`)
  console.log(`       paced here: mapped ${(await paced(true)).toFixed(1)} ms, traced ${(await paced(false)).toFixed(1)} ms`)

  // Down the street away from the sun, 90 m in a second and a half, then stop. The town is still being made where
  // the eye now is, so at once the two differ by as much as the machine is behind (4% on a quiet Mac, 14% on a busy
  // one: said, not checked). What is checked is that they come to agree soon after, by themselves.
  for (let step = 0; step < 30; step++) { await page.evaluate(() => { globalThis.engine.pose.x -= 3 }); await page.waitForTimeout(50) }
  const behind = await page.evaluate(() => globalThis.engine.world.stats.wanted), stopped = Date.now(), atOnce = await differ()
  let now = atOnce, took = 0
  while (now >= 0.04 && took < 5000) { await page.waitForTimeout(150); now = await differ(); took = Date.now() - stopped }
  console.log(`       just stopped: ${percent(atOnce)} differ, ${behind} parts of the town still to make`)
  check(now < 0.04, `after flying 90 m away from the sun, mapped and traced shadows agree again ${(took / 1000).toFixed(1)} s after stopping (${percent(now)} differ)`)
  await settled()
  await page.waitForTimeout(2500)
  const later = await differ()
  check(later < 0.04, `a few seconds later, ${percent(later)} differ`)

  // A blast: what it took away must stop casting its shadow.
  const hit = await page.evaluate(() => globalThis.engine.blast(12))
  check(!!hit, 'a blast hit something')
  // Until what it threw out has come to rest, the town is made again and the sun's maps are drawn.
  await page.waitForTimeout(200)
  await rest(page, { sun: true })
  await page.waitForTimeout(1500)
  await rest(page, { sun: true })
  const broken = await differ()
  check(broken < 0.04, `after a blast and its sectors made again, ${percent(broken)} differ`)
} catch (e) {
  failures.push(String(e))
}
await finish('shadows')
