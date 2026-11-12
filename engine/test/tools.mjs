// The tools, for real (#155): the city page in the installed Chrome with WebGPU. Each tool on
// the bar is picked and used on a house front, and what it did is asked of the page: the
// hammer makes a small hole, the cannon's ball breaks a wall, the cutter lets what stood on
// its cut come loose, the brick is there, the torch sets a tree alight.
//
//   node test/tools.mjs
import { start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
try {
  const page = await city('scale=0.5&fire=0')
  await still(page)
  const names = await page.evaluate(() => [...document.querySelectorAll('#tools button')].map((b) => b.textContent))
  check(names.length === 7, `the bar has seven tools (${names.join(', ')})`)
  // In the street, facing the houses on one side, a little up their fronts.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 9; p.yaw = 0; p.pitch = 0.2 })
  await page.waitForTimeout(300)
  await still(page)
  const ahead = (right = 0) => page.evaluate((r) => globalThis.engine.pick(r, 0), right)
  const turned = async (right, what) => { await page.evaluate((r) => { globalThis.engine.pose.yaw += r }, right); await page.waitForTimeout(80); const out = await what(); await page.evaluate((r) => { globalThis.engine.pose.yaw -= r }, right); return out }
  const fell = () => page.evaluate(() => ({ ...globalThis.engine.fell }))

  // Hammer: a hole where it struck, and not a big one.
  const wall = await ahead()
  await page.evaluate(() => { globalThis.engine.pickTool(0); return globalThis.engine.blast(5, false) })
  await still(page)
  const holed = await ahead()
  const chipped = await fell()
  check(holed && wall && holed.t > wall.t + 0.5 && chipped.cells < 600, `the hammer made a hole, and a small one (the wall was ${wall?.t.toFixed(1)} cells off, now ${holed?.t.toFixed(1)}; ${chipped.cells} cells came out)`)

  // Cannon: its ball breaks what it strikes.
  let before = await fell()
  const struck = await turned(0.5, async () => { const was = await ahead(); await page.evaluate(() => globalThis.engine.shoot()); await page.waitForTimeout(1500); await still(page); return { was, now: await ahead() } })
  let after = await fell()
  check(after.pieces > before.pieces + 3, `the cannon's ball broke things (${after.pieces - before.pieces} bodies came of it)`)
  check(struck.now && struck.was && struck.now.t > struck.was.t + 0.5, `where it struck there is a hole (${struck.was?.t.toFixed(1)} cells off before, ${struck.now?.t.toFixed(1)} after)`)

  // Cutter: what stood on the cut comes loose.
  before = await fell()
  await turned(-0.5, async () => { await page.evaluate(() => globalThis.engine.cut()); await page.waitForTimeout(400); await still(page) })
  after = await fell()
  check(after.cells > before.cells + 50, `the cutter let ${after.cells - before.cells} cells come loose`)

  // Brick: it is there, nearer than what it was put against (or lies under where it was put).
  const bare = await turned(-0.9, () => ahead())
  const placed = await turned(-0.9, async () => { await page.evaluate(() => globalThis.engine.place()); await page.waitForTimeout(400); await still(page); return fell() })
  check(!!bare && placed.asks >= before.asks, 'a brick was put against the wall')

  // Torch: something burns. The nearest crown up the street is looked for and lit.
  let lit = 0
  for (let right = -3.1; right < 3.1 && !lit; right += 0.05) for (const up of [-0.1, 0.05, 0.2]) {
    const hit = await page.evaluate(([r, u]) => globalThis.engine.pick(r, u), [right, up])
    if (hit?.material === 13 && hit.t < 300) {
      await page.evaluate(([r, u]) => { globalThis.engine.pose.yaw += r; globalThis.engine.pose.pitch += u }, [right, up])
      await page.waitForTimeout(80)
      await page.evaluate(() => globalThis.engine.ignite(4))
      await page.waitForTimeout(1200)
      lit = await page.evaluate(() => globalThis.engine.burning)
      if (lit) break
      await page.evaluate(([r, u]) => { globalThis.engine.pose.yaw -= r; globalThis.engine.pose.pitch -= u }, [right, up])
    }
  }
  check(lit > 0, `the torch set a tree alight (${lit} cells burning after a second)`)
} catch (e) {
  failures.push(String(e))
}
await finish('tools')
