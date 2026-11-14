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
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over { display: none }' })
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
  // With no window lit the lamps alone leave 0.2% of this picture bright; with them it is 0.9% (measured again after
  // the lamps down the streets and the grade, November 12).
  check(night.bright > 0.005, `and windows are lit in it: ${percent(night.bright)} of the picture is bright`)

  // No lamp stands in open country: over the dry plain east of the town the night has nothing lit in it. (The page
  // works the lamps' light out from where the town's rule stands lamps, and once did so on bare land too.)
  const here = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  await page.evaluate(() => Object.assign(globalThis.engine.pose, { x: 6100, z: 407, y: globalThis.engine.ground(6100, 407) + 30, yaw: Math.PI / 2, pitch: -0.25 }))
  await at(22)
  const plain = await look()
  // With the lamps' light on it the plain was 19% of full. (A night to see by, #163: the moon on pale ground is
  // 0.1% of the picture bright and 11.6% of full, so it is the whole that tells lamps from none.)
  check(plain.bright < 0.002 && plain.mean < 0.14, `at night over the plain nothing is lit: ${percent(plain.bright)} of the picture is bright, ${percent(plain.mean)} of full on the whole`)
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), here)

  await at(null)
  const again = await look()
  check(Math.abs(again.mean - day.mean) < 0.02, `with no hour asked the day is back: ${percent(again.mean)} of full, ${percent(day.mean)} before`)
} catch (e) { failures.push(String(e).slice(0, 400)) }
await finish('hours')
