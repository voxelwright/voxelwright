// The sun's maps against traced shadows, for real (#140): the city page in the installed
// Chrome with WebGPU. Standing still, straight after flying down the street away from the sun,
// two seconds later, and after a blast. The page draws each view both ways and says what
// share of pixels differ.
//
//   node test/shadows.mjs
import { start } from './kit.mjs'

const { city, check, failures, finish } = await start()
const percent = (x) => `${(x * 100).toFixed(2)}%`
try {
  const page = await city('scale=0.5')
  const settled = () => page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 && e.world.stats.ready > 0 && e.march.sun.undrawn === 0 }, null, { timeout: 120_000 })
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

  // Down the street away from the sun, 90 m in a second and a half, then stop and look at once.
  for (let step = 0; step < 30; step++) { await page.evaluate(() => { globalThis.engine.pose.x -= 3 }); await page.waitForTimeout(50) }
  const atOnce = await differ()
  const [mapped, traced] = [await paced(true), await paced(false)]
  console.log(`       just stopped: ${percent(atOnce)} differ; paced mapped ${mapped.toFixed(1)} ms, traced ${traced.toFixed(1)} ms; ${await page.evaluate(() => globalThis.engine.march.sun.undrawn)} tiles not drawn`)
  check(atOnce < 0.06, `straight after flying 90 m away from the sun, ${percent(atOnce)} differ`)
  await settled()
  await page.waitForTimeout(2500)
  const later = await differ()
  check(later < 0.04, `a few seconds later, ${percent(later)} differ`)

  // A blast: what it took away must stop casting its shadow.
  const hit = await page.evaluate(() => globalThis.engine.blast(12))
  check(!!hit, 'a blast hit something')
  await page.waitForTimeout(200)
  await settled()
  await page.waitForTimeout(1500)
  const broken = await differ()
  check(broken < 0.04, `after a blast and its sectors made again, ${percent(broken)} differ`)
} catch (e) {
  failures.push(String(e))
}
await finish('shadows')
