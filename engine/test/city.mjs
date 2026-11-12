// Opens the city page for real (#140) in the installed Chrome with WebGPU, waits until the
// world round the start is made, and takes pictures from a few places. Prints what the page
// measured. Nothing is stubbed.
//
//   node test/city.mjs --out <dir> [--port 5742] [--query "scale=1"] [--headed]
import { mkdir } from 'node:fs/promises'
import { arg, start } from './kit.mjs'

const out = arg('out', ''), query = arg('query', '')
if (out) await mkdir(out, { recursive: true })
const { city, failures, finish } = await start()
try {
  const page = await city(query)
  const made = async (limit = 90_000) => {
    const t0 = Date.now()
    await page.waitForFunction(() => globalThis.engine.world.stats.wanted === 0 && globalThis.engine.world.stats.ready > 0, null, { timeout: limit })
    return Date.now() - t0
  }
  const first = await made()
  const stats = await page.evaluate(() => ({ ...globalThis.engine.world.stats, pose: { ...globalThis.engine.pose } }))
  console.log(`world made in ${(first / 1000).toFixed(1)} s: ${stats.ready} sectors ready, ${stats.made} made at ${(stats.makeMs / stats.made).toFixed(2)} ms each, pool ${(stats.poolUsed / 262144).toFixed(0)} MB, ${stats.full} did not fit, ${stats.wholeLevels} boxes whole`)
  if (stats.full) failures.push(`${stats.full} sectors did not fit the pool`)
  const base = stats.pose
  // Places to look from: [name, forward m, up m, yaw deg, pitch deg].
  // The page starts 12 m over the middle of a street: 10.2 m down is an eye 1.8 m above the road.
  const places = [['street', 0, -10.2, 90, -2], ['fronts', 0, -10.2, 60, 5], ['roofs', 0, 0, 20, -8], ['high', 0, 118, 30, -22], ['far', 0, 718, 200, -30]]
  for (const [name, ahead, up, yaw, pitch] of places) {
    await page.evaluate(([b, ahead, up, yaw, pitch]) => { const p = globalThis.engine.pose; p.x = b.x + ahead; p.y = b.y + up; p.z = b.z; p.yaw = yaw * Math.PI / 180; p.pitch = pitch * Math.PI / 180 }, [base, ahead, up, yaw, pitch])
    await page.waitForTimeout(300)
    const took = await made()
    await page.waitForTimeout(1500)
    const m = await page.evaluate(() => ({ gpuMs: globalThis.engine.gpuMs, frameMs: globalThis.engine.frameMs }))
    console.log(`  ${name}: made in ${(took / 1000).toFixed(1)} s, march ${m.gpuMs.toFixed(2)} ms, frame ${m.frameMs.toFixed(1)} ms`)
    if (out) await page.screenshot({ path: `${out}/${name}.png` })
  }
} catch (e) {
  failures.push(String(e))
}
await finish('city')
