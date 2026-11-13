// Far from the town the cells are the planet's land (#217): at twenty places from 50 to 5,000 km out, what the
// core says the ground is (under the sea's level or over it) and what the planet's pass draws from 7 km straight
// over the same place (water or not) must agree. Coming down from space must find what was seen.
//
//   node test/far.mjs
import { seen, start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('fire=0&hour=13&scale=0.5')
  await still(page)
  // Places by a fixed rule, km east and south of the start: a turn of 137.5 degrees and a little further out each time.
  const places = Array.from({ length: 20 }, (_, i) => { const r = 50 * (5000 / 50) ** (i / 19), a = i * 2.39996; return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))] })
  let agreed = 0
  const said = []
  for (const [east, south] of places) {
    const ground = await page.evaluate(([east, south]) => {
      const e = globalThis.engine
      e.home ??= { ...e.pose }
      const x = e.home.x + east * 1000, z = e.home.z + south * 1000
      Object.assign(e.pose, { x, z, y: 7000, yaw: 0, pitch: -Math.PI / 2 })
      // The ground at nine columns 300 m apart: a place is sea or land when most of them are.
      let wet = 0
      for (const dx of [-300, 0, 300]) for (const dz of [-300, 0, 300]) if (e.ground(x + dx, z + dz) < 0) wet++
      return { wet, at: e.ground(x, z) }
    }, [east, south])
    // Three of the page's own frames, so that the picture is of this place: beside other checks a frame can take a third of a second.
    await page.evaluate(() => new Promise((done) => { let n = 0; const tick = () => (++n < 3 ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick) }))
    await page.waitForTimeout(100)
    const { rgb } = await seen(page)
    // Through the pale air of 7 km, water is bluer than it is red by 0.12 or more of full; grass, sand, rock and
    // snow by 0.03 or less.
    const water = rgb[2] - rgb[0] > 0.07
    const sea = ground.wet >= 5
    if (water === sea) agreed++
    said.push(`${east},${south}: cells ${sea ? 'sea' : 'land'} (${ground.at.toFixed(0)} m), planet ${water ? 'sea' : 'land'} (${rgb.map((v) => v.toFixed(2)).join(' ')})`)
  }
  for (const line of said) console.log(`    ${line}`)
  check(agreed >= 19, `the cells and the planet agree on sea or land at ${agreed} of ${places.length} places from 50 to 5,000 km out`)
  const seas = said.filter((l) => l.includes('cells sea')).length
  check(seas >= 4 && seas <= 16, `some of those places are sea and some land (${seas} sea)`)
} catch (e) {
  failures.push(String(e))
}
await finish('far')
