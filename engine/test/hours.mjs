// The hour for real: the city page in the installed Chrome with WebGPU. The sun's maps must follow the
// sun when the hour is changed, the night must be dark with windows lit in it, and with no hour asked
// the day must come back as it was.
//
//   node test/hours.mjs
import { seen, start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
const percent = (x) => `${(x * 100).toFixed(1)}%`
try {
  const page = await city('scale=0.5&fire=0')
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools { display: none }' })
  // Standing in the street, facing house fronts.
  await page.evaluate(() => Object.assign(globalThis.engine.pose, { y: globalThis.engine.pose.y - 10.2, yaw: 60 * Math.PI / 180, pitch: 5 * Math.PI / 180 }))
  const look = () => seen(page)
  const at = async (hour) => {
    await page.evaluate((h) => { globalThis.engine.hour = h }, hour)
    await page.waitForTimeout(300)
    await still(page, { sun: true })
    await page.waitForTimeout(500)
  }
  await at(null)
  const day = await look()

  await at(9)
  const morning = await page.evaluate(() => globalThis.engine.shadowsDiffer())
  check(morning < 0.04, `at nine, ${percent(morning)} of pixels differ between mapped and traced shadows: the sun's maps follow the sun`)

  await at(22)
  const night = await look()
  check(night.mean < day.mean * 0.4, `at twenty-two the picture is dark: ${percent(night.mean)} of full, ${percent(day.mean)} by day`)
  // With no window lit the lamps alone leave 0.6% of this picture bright; with them it is 1.1%.
  check(night.bright > 0.0085, `and windows are lit in it: ${percent(night.bright)} of the picture is bright`)

  await at(null)
  const again = await look()
  check(Math.abs(again.mean - day.mean) < 0.02, `with no hour asked the day is back: ${percent(again.mean)} of full, ${percent(day.mean)} before`)
} catch (e) { failures.push(String(e).slice(0, 400)) }
await finish('hours')
