// Far from the town the cells are the planet's land (#217): at twenty places from 50 to 5,000 km out, what the
// core says the ground is (under the sea's level or over it) and what the planet's pass draws from 7 km straight
// over the same place (water or not) must agree. Coming down from space must find what was seen.
// And the kind of country must agree (#228): over mountains, a desert, the ice, the snow and green land, the
// planet's picture from 7 km and the cells' own from 5.5 km are the same kind of colour.
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
  // The kind of country, by the picture's mean colour through the haze: red where red is past green, green where
  // green is past both others, else pale (snow, ice, and rock under snow).
  const sort = ([r, g, b]) => (r - g > 0.02 ? 'red' : g - r > 0.02 && g - b > 0.02 ? 'green' : 'pale')
  for (const [name, east, south, want] of [['mountains', 1160, 720, 'pale'], ['a desert', 130, 40, 'red'], ['the ice on the sea', 300, -3900, 'pale'], ['the snow', 1500, -3600, 'pale'], ['green land', 300, -900, 'green']]) {
    const found = []
    for (const up of [7000, 5500]) {
      await page.evaluate(([east, south, up]) => { const e = globalThis.engine; Object.assign(e.pose, { x: e.home.x + east * 1000, z: e.home.z + south * 1000, y: up, yaw: 0, pitch: -Math.PI / 2 }) }, [east, south, up])
      await page.waitForTimeout(500)
      if (up < 6000) await still(page, { sun: true, limit: 90_000 })
      await page.waitForTimeout(300)
      found.push((await seen(page)).rgb)
    }
    const [planet, cells] = found.map(sort)
    check(planet === want && cells === want, `over ${name} (${east} km east, ${south} km south) the planet shows ${planet} country and the cells are ${cells} (${found.map((c) => c.map((v) => v.toFixed(2)).join(' ')).join(' and ')})`)
  }
} catch (e) {
  failures.push(String(e))
}
await finish('far')
