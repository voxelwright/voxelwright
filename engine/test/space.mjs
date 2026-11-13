// The world from high up (#140): over 25 km the planet is drawn in place of the boxes of cells.
// Looked down on from space it must be there and lit, looked away from it must be dark, and
// come back down under 25 km the cells must be what is drawn again.
//
//   node test/space.mjs
import { seen, start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('fire=0&hour=13&scale=0.5')
  await still(page)
  const look = async (km, pitch) => {
    await page.evaluate(([km, pitch]) => Object.assign(globalThis.engine.pose, { y: km * 1000, pitch: (pitch * Math.PI) / 180 }), [km, pitch])
    await page.waitForTimeout(500)
    return seen(page)
  }
  const down = await look(300, -90)
  check(down.mean > 0.12, `from 300 km straight down the planet fills the picture, lit (${(down.mean * 100).toFixed(0)}% of full)`)
  const away = await look(300, 80)
  check(away.mean < 0.04, `looking away from it there is the dark (${(away.mean * 100).toFixed(1)}% of full)`)
  const whole = await look(20000, -90)
  check(whole.mean > 0.01 && whole.mean < down.mean * 0.5, `from 20,000 km it is a ball in the dark (${(whole.mean * 100).toFixed(1)}% of full)`)
  await look(1, -90)
  await still(page, { limit: 120_000 })
  const hit = await page.evaluate(() => globalThis.engine.pick(0, 0))
  check(hit && Math.abs(hit.t / 10 - 1000) < 150, `back at 1 km the town is under the eye again (${hit ? `material ${hit.material} at ${(hit.t / 10).toFixed(0)} m` : 'nothing'})`)
} catch (e) {
  failures.push(String(e))
}
await finish('space')
