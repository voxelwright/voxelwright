// The sea is a level plane, not cells: a look that comes down over it must meet its top at the
// height of the eye over it, however deep the floor or shallow the water, and a look from under
// it must never meet it. The check goes also to the last few cells of water before the shore,
// with the skips over empty air and without. And from under the sea the picture is the water's.
//
//   node test/sea.mjs
import { seen, start, still } from './kit.mjs'

const WATER = 5, SAND = 4
const { city, check, failures, finish } = await start()
try {
  const page = await city('scale=0.25&fire=0')
  await still(page)
  /** Stands the eye at a height over the sea's top and asks what each look (yaw, pitch) meets; `plain` asks with no skip over empty air. */
  const looks = async ([x, z], y, pitches, plain = false) => {
    await page.evaluate(([x, y, z]) => Object.assign(globalThis.engine.pose, { x, y, z, yaw: 0, pitch: 0 }), [x, y, z])
    await page.waitForTimeout(300)
    await still(page, { limit: 120_000 })
    return page.evaluate(async ([pitches, plain]) => {
      const e = globalThis.engine, out = []
      for (const yaw of [0.4, 2.9]) for (const pitch of pitches) {
        e.pose.yaw = yaw; e.pose.pitch = pitch
        out.push({ yaw, pitch, hit: await e.pick(0, 0, plain) })
      }
      return out
    }, [pitches, plain])
  }
  const said = (r) => `yaw ${r.yaw} pitch ${r.pitch}: ${r.hit ? `material ${r.hit.material} at ${(r.hit.t / 10).toFixed(1)} m` : 'nothing'}`
  const middle = [-1630, 407], shallows = [-1215, 440]
  const floors = await page.evaluate(([a, b]) => [globalThis.engine.ground(...a), globalThis.engine.ground(...b)], [middle, shallows])
  check(floors[0] < -10 && floors[1] < -0.3 && floors[1] > -2, `the lake's middle is deep (${floors[0].toFixed(1)} m) and its edge shallow (${floors[1].toFixed(1)} m)`)

  // From over the water, every look that lands on it within 150 m.
  let asked = 0
  const wrong = []
  for (const [place, up, pitches] of [[middle, 2, [-0.1, -0.5, -1.4]], [middle, 20, [-0.3, -0.9, -1.5]], [middle, 100, [-0.8, -1.3]], [middle, 800, [-1.45, -1.55]], [shallows, 3, [-1.0, -1.5]]]) {
    for (const r of await looks(place, up, pitches)) {
      asked++
      const far = up / Math.sin(-r.pitch)
      if (!(r.hit && r.hit.material === WATER && Math.abs(r.hit.t / 10 - far) <= Math.max(0.2, far * 0.005))) wrong.push(`${up} m over ${place}, ${said(r)}; the sea's top is ${far.toFixed(1)} m off`)
    }
  }
  check(wrong.length === 0, `${asked} looks down over the lake meet the sea's top where it is${wrong.length ? `; ${wrong.length} do not:\n       ${wrong.slice(0, 10).join('\n       ')}` : ''}`)

  // The last of the water before the shore: straight down on columns whose floor is one to three cells under.
  const edge = await page.evaluate(([x0, z]) => {
    const e = globalThis.engine, out = []
    for (let x = x0 - 40; x < x0 + 60 && out.length < 6; x += 0.1) { const g = e.ground(x, z); if (g <= -0.1 && g >= -0.3) out.push(x) }
    return out
  }, shallows)
  check(edge.length === 6, `there are columns at the lake's edge with the floor one to three cells under (${edge.length} found)`)
  const dry = []
  // With the skips a ray comes down to the floor in a pass of its own; without them it walks down through the leaf
  // the floor is in, air and floor in one pass.
  for (const x of edge) for (const plain of [false, true]) for (const r of await looks([x + 0.05, shallows[1] + 0.05], 3, [-1.5607], plain)) if (!(r.hit && r.hit.material === WATER)) dry.push(`at x ${x.toFixed(1)}${plain ? ' with no skips' : ''}, ${said(r)}`)
  check(dry.length === 0, `looks straight down on them meet water, not the floor${dry.length ? `; these do not:\n       ${dry.join('\n       ')}` : ''}`)

  // From 5 m under it: up and level there is no sea to meet, down there is the floor.
  const under = await looks(middle, -5, [1.5, 0.9, 0.3, 0, -1.2])
  const met = under.filter((r) => r.hit && r.hit.material === WATER)
  check(met.length === 0, `from under the sea no look meets it${met.length ? `; these do:\n       ${met.map(said).join('\n       ')}` : ''}`)
  const down = under.filter((r) => r.pitch < -1)
  check(down.every((r) => r.hit && r.hit.material === SAND), `and looks down from there meet the floor: ${down.map(said).join('; ')}`)

  // The look from under it: the page knows it is under, and the picture is the water's colour, not the day's.
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over { display: none }' })
  const from = async (y, pitch) => {
    await page.evaluate(([x, z, y, pitch]) => Object.assign(globalThis.engine.pose, { x, y, z, yaw: 0.4, pitch }), [...middle, y, pitch])
    await page.waitForTimeout(400)
    await still(page, { limit: 120_000 })
    await page.waitForTimeout(600)
    return { under: await page.evaluate(() => globalThis.engine.march.under), ...(await seen(page)) }
  }
  const [over, below] = [await from(3, -0.3), await from(-5, -0.3)]
  check(!over.under && below.under, `the page says it is under the sea 5 m under its top (${below.under}) and not 3 m over it (${over.under})`)
  const [r, g, b] = below.rgb
  check(g > r * 2 && b > r * 2, `from under it the picture is blue-green: red ${r.toFixed(2)}, green ${g.toFixed(2)}, blue ${b.toFixed(2)}`)

  // Above-water rasterized objects (people, vehicles, billboards, far city) must be occluded by the water ceiling
  // when viewed from underwater, not drawn cleanly on top of it.
  await page.evaluate(([x, z]) => {
    Object.assign(globalThis.engine.pose, { x, y: -2, z, yaw: 0, pitch: 0.25 })
    const e = globalThis.engine
    e.folk.from.push(() => [
      { id: 99001, seed: 7, at: [x * 10, 2, (z - 7) * 10], yaw: 0, speed: 0 },
      { id: 99002, seed: 11, at: [(x - 1) * 10, 2, (z - 7) * 10], yaw: 0, speed: 0 },
      { id: 99003, seed: 19, at: [(x + 1) * 10, 2, (z - 7) * 10], yaw: 0, speed: 0 },
    ])
  }, middle)
  await page.waitForTimeout(400)
  const occluded = await seen(page)
  const [or, og, ob] = occluded.rgb
  check(og > or * 1.8 && ob > or * 1.8, `above-water figures do not bleed through the water ceiling: red ${or.toFixed(2)}, green ${og.toFixed(2)}, blue ${ob.toFixed(2)}`)
  await page.evaluate(() => { globalThis.engine.folk.from.pop() })
} catch (e) {
  failures.push(String(e).slice(0, 400))
}
await finish('sea')
