// The skips over empty air change nothing a ray meets (#176): the same looks are asked with them
// and without, from 20 m to 800 m up, level to straight down, and must meet the same thing at
// the same distance. Twice a skip took a ray past where it leaves its box: once the ground
// showed pits from 30 m up, once the whole town was not drawn from 100 m. Both were found in
// pictures taken for something else.
//
//   node test/skips.mjs
import { start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('scale=0.25&fire=0')
  await still(page)
  const home = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  let asked = 0
  const wrong = []
  for (const [dx, dz] of [[0, 0], [310, 140]]) for (const up of [20, 60, 100, 160, 300, 800]) {
    await page.evaluate(([h, dx, dz, up]) => { const e = globalThis.engine; Object.assign(e.pose, { x: h.x + dx, z: h.z + dz, y: e.ground(h.x + dx, h.z + dz) + up, yaw: 0, pitch: 0 }) }, [home, dx, dz, up])
    await page.waitForTimeout(300)
    await still(page, { limit: 120_000 })
    const rows = await page.evaluate(async () => {
      const e = globalThis.engine, out = []
      for (const yaw of [0.3, 1.7, 3.6, 5.1]) for (const pitch of [-0.05, -0.2, -0.5, -0.9, -1.4]) {
        e.pose.yaw = yaw; e.pose.pitch = pitch
        const [fast, plain] = [await e.pick(0, 0, false), await e.pick(0, 0, true)]
        out.push({ yaw, pitch, fast, plain })
      }
      return out
    })
    for (const r of rows) {
      asked++
      const same = (!r.fast && !r.plain) || (r.fast && r.plain && r.fast.material === r.plain.material && Math.abs(r.fast.t - r.plain.t) <= Math.max(1, r.plain.t * 0.002))
      if (!same) wrong.push(`${up} m up at ${dx},${dz}, yaw ${r.yaw} pitch ${r.pitch}: with skips ${r.fast ? `${r.fast.material} at ${r.fast.t.toFixed(0)}` : 'nothing'}, without ${r.plain ? `${r.plain.material} at ${r.plain.t.toFixed(0)}` : 'nothing'}`)
    }
  }
  check(wrong.length === 0, `${asked} looks meet the same thing with the skips and without${wrong.length ? `; ${wrong.length} do not:\n       ${wrong.slice(0, 12).join('\n       ')}` : ''}`)
} catch (e) {
  failures.push(String(e))
}
await finish('skips')
