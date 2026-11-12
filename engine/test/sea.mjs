// The sea is a level plane, not cells: a look that comes down over it must meet its top at the
// height of the eye over it, however deep the floor or shallow the water, and a look from under
// it must never meet it. The check goes also to the last few cells of water before the shore,
// with the skips over empty air and without.
//
//   node test/sea.mjs
import { start, still } from './kit.mjs'

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
} catch (e) {
  failures.push(String(e).slice(0, 400))
}
await finish('sea')
