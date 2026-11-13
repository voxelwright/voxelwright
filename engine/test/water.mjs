// Water that flows (#140): a charge against the side of the yard's water tank, and the water
// that comes out of it. It must come out, spread over the yard while the frames hold, show in
// the picture, and leave the untouched town as it was: no water where no tank was holed.
//
//   node test/water.mjs
import { film, seen, start, still } from './kit.mjs'
import { lookFrom, strikeAt } from './rows.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('fire=0')
  await still(page)
  await lookFrom(page, [28, 411], 1.6, [40, 425], 5)
  await page.waitForTimeout(400)
  await still(page, { sun: true })
  const state = () => page.evaluate(() => ({ flowing: globalThis.engine.flowing, columns: globalThis.engine.water.columns }))
  // A blast elsewhere wets nothing.
  await strikeAt(page, [70, 419], 4, 8, false)
  await page.waitForTimeout(1500)
  await still(page)
  const dry = await state()
  check(dry.columns === 0 && !dry.flowing, `a charge at the chimney lets no water out (${dry.columns} columns wet, flowing ${dry.flowing})`)
  const before = await seen(page)
  // Low on the tank's wall, on the side towards the eye.
  const shot = await film(page, 6, () => strikeAt(page, [38.75, 423.57], 12.6, 8, false))
  const wet = await state()
  check(wet.flowing && wet.columns > 2000, `six seconds after the tank is holed its water lies over ${wet.columns} columns of the yard, and is still running`)
  check(shot.p95 < 34 && shot.worst < 150, `the frames held while it ran (${shot.frames} frames in ${shot.seconds.toFixed(1)} s, 19 in 20 within ${shot.p95.toFixed(0)} ms, the longest gap ${shot.worst.toFixed(0)} ms)`)
  const after = await seen(page)
  // The yard is dark and the water over it is pale and blue: the picture's mean colour moves.
  const moved = after.rgb.reduce((sum, v, c) => sum + Math.abs(v - before.rgb[c]), 0)
  check(moved > 0.02, `the picture shows it: its mean colour moved by ${moved.toFixed(3)} of 3 (${before.rgb.map((v) => v.toFixed(3))} before, ${after.rgb.map((v) => v.toFixed(3))} after)`)
} catch (e) {
  failures.push(String(e))
}
await finish('water')
