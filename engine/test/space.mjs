// The world from high up (#140): over 6 km the planet is drawn in place of the boxes of cells.
// Looked down on from space it must be there and lit, looked away from it must be dark, and
// just under 6 km the cells must still be what is drawn, with the ground in them: the way down
// from space must have no height at which there is nothing.
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
  const night = await page.evaluate(() => { globalThis.engine.hour = 23 }).then(() => look(300, -90))
  check(night.mean < down.mean * 0.25, `at night the planet under the eye is dark (${(night.mean * 100).toFixed(1)}% of full, ${(down.mean * 100).toFixed(0)}% by day)`)
  await page.evaluate(() => { globalThis.engine.hour = 13 })
  const over = await look(6.5, -90)
  check(over.mean > 0.1, `from 6.5 km the planet is what is drawn, and it is there (${(over.mean * 100).toFixed(0)}% of full)`)
  // The highest the cells are drawn from: the ground must still be in them, straight down and aslant.
  for (const [km, pitch, far] of [[5.8, -90, 5.8], [5.8, -40, 9], [1, -90, 1]]) {
    await look(km, pitch)
    await still(page, { limit: 120_000 })
    const hit = await page.evaluate(() => globalThis.engine.pick(0, 0))
    check(hit && Math.abs(hit.t / 10000 - far) < far * 0.2, `from ${km} km at ${pitch} degrees the ground is met (${hit ? `material ${hit.material} at ${(hit.t / 10000).toFixed(2)} km` : 'nothing'})`)
  }
} catch (e) {
  failures.push(String(e))
}
await finish('space')
