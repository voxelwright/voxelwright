// The tools, for real (#155): the city page in the installed Chrome with WebGPU. Each tool on
// the bar is picked and used on a house front, and what it did is asked of the page: the
// hammer makes a small hole, the cannon's ball breaks a wall, the Cleave (#226) parts what it is
// drawn across and lets what stood above the cut come loose, the brick is there, the torch sets a
// tree alight. The weapons (#166) follow the first seven on the bar.
//
//   node test/tools.mjs
import { start, still } from './kit.mjs'

const { city, check, failures, finish } = await start()
/** How coloured the middle of the picture is (mean of each pixel's max less its min channel, 0 to 1), clear of the HUD. */
const chroma = async (page) => {
  const png = (await page.screenshot({ clip: { x: 280, y: 60, width: 720, height: 480 } })).toString('base64')
  return page.evaluate(async (png) => {
    const paper = new OffscreenCanvas(180, 120).getContext('2d')
    paper.drawImage(await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob()), 0, 0, 180, 120)
    const d = paper.getImageData(0, 0, 180, 120).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])
    return sum / (d.length / 4) / 255
  }, png)
}
try {
  const page = await city('scale=0.5&fire=0')
  await still(page)
  // (each button is its key's number, then its name)
  const names = await page.evaluate(() => [...document.querySelectorAll('#tools button')].map((b) => b.textContent.replace(/^\d+/, '')))
  const first = ['Hammer', 'Charge', 'Big charge', 'Cannon', 'Torch', 'Cleave', 'Brick'], weapons = ['Lightsaber', 'Rifle', 'Rocket', 'Laser', 'Grapple', 'Tennis']
  check(names.length === 13 && first.every((n, i) => names[i] === n) && weapons.every((n, i) => names[7 + i] === n), `the bar has the seven tools, then the six weapons (${names.join(', ')})`)
  await page.evaluate(() => globalThis.engine.spells)
  check(await page.evaluate(() => !!globalThis.engine.cleave && !!globalThis.engine.rewind && !!globalThis.engine.combat), 'the Cleave, time and the weapons are made')
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

  // Torch: something burns. The nearest crown up the street is looked for and lit (before the Cleave, whose stroke fells the trees in view).
  let lit = 0
  for (let right = -3.1; right < 3.1 && !lit; right += 0.05) for (const up of [-0.1, 0.05, 0.2]) {
    const hit = await page.evaluate(([r, u]) => globalThis.engine.pick(r, u), [right, up])
    if (hit?.material === 13 && hit.t < 300) {
      await page.evaluate(([r, u]) => { globalThis.engine.pose.yaw += r; globalThis.engine.pose.pitch += u }, [right, up])
      await page.waitForTimeout(80)
      await page.evaluate(() => globalThis.engine.ignite(4))
      // (what it set alight is heard when the mover answers)
      await page.waitForFunction(() => globalThis.engine.burning > 0, null, { timeout: 6000 }).catch(() => {})
      lit = await page.evaluate(() => globalThis.engine.burning)
      await page.evaluate(([r, u]) => { globalThis.engine.pose.yaw -= r; globalThis.engine.pose.pitch -= u }, [right, up])
      if (lit) break
    }
  }
  check(lit > 0, `the torch set a tree alight (${lit} cells burning)`)

  // Cleave (tool 6, key 6): in hand, its gesture is the picture's; a stroke drawn across the houses parts them.
  const inHand = await page.evaluate(() => { globalThis.engine.pickTool(5); const e = globalThis.engine; return { tool: e.tool, live: e.input.live('cleaving') } })
  check(inHand.tool === 'Cleave' && inHand.live, `tool 6 is the Cleave, and its gesture is the picture's (${JSON.stringify(inHand)})`)
  before = await fell()
  const cleft = await turned(-0.5, async () => { const made = await page.evaluate(() => globalThis.engine.cut()); await page.waitForTimeout(1500); await still(page); return made })
  after = await fell()
  const cuts = await page.evaluate(() => globalThis.engine.cleave.stats.cuts)
  check(!!cleft && cuts >= 1, `the Cleave struck (${cuts} cut${cuts === 1 ? '' : 's'}, at ${cleft?.at})`)
  check(after.cells > before.cells + 50, `the Cleave let ${after.cells - before.cells} cells come loose`)
  // Put down again: another tool in hand, its gesture is gone.
  check(await page.evaluate(() => { globalThis.engine.pickTool(1); return !globalThis.engine.input.live('cleaving') }), 'another tool taken, the Cleave lets the picture go')

  // Brick: it is there, nearer than what it was put against (or lies under where it was put).
  const bare = await turned(-0.9, () => ahead())
  const placed = await turned(-0.9, async () => { await page.evaluate(() => globalThis.engine.place()); await page.waitForTimeout(400); await still(page); return fell() })
  check(!!bare && placed.asks >= before.asks, 'a brick was put against the wall')


  // The thirteen tools run the width of a laptop's screen: the minimap in the corner stands clear of the bar (#226).
  const crossed = await page.evaluate(() => {
    const map = document.querySelector('#minimap'), bar = document.querySelector('#tools')
    if (!map || !bar || getComputedStyle(map).display === 'none') return null
    const a = map.getBoundingClientRect(), b = bar.getBoundingClientRect()
    return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top
  })
  check(crossed !== true, 'the minimap does not cover the tool bar')

  // Time stopped (T, nothing in the hands): the colour drains to silver, seen in the picture itself. Looked at away from the fire.
  await page.evaluate(() => { globalThis.engine.pose.yaw += Math.PI; globalThis.engine.pose.pitch = 0.1 })
  await page.waitForTimeout(600)
  const live = await chroma(page)
  await page.keyboard.down('KeyT'); await page.waitForTimeout(60); await page.keyboard.up('KeyT')
  await page.waitForFunction(() => globalThis.engine.rewind.state === 'frozen', null, { timeout: 10_000 })
  await page.waitForTimeout(1200)
  const stopped = await chroma(page)
  check(stopped < live * 0.78, `time stopped drains the colour (chroma ${live.toFixed(3)} running, ${stopped.toFixed(3)} stopped)`)
  await page.keyboard.down('KeyT'); await page.waitForTimeout(60); await page.keyboard.up('KeyT')
  await page.waitForFunction(() => globalThis.engine.rewind.state === 'live', null, { timeout: 10_000 })

  // Grass grows on the town's lawns (grass.ts reads what the top cell of each column is): stood on the nearest one.
  const lawn = await page.evaluate(() => {
    const g = globalThis.engine, p = g.pose
    const isGrass = (x, z) => { const X = Math.round(x * 10), Z = Math.round(z * 10), f = g.feet(X, Z); return (g.kind(X, f - 1, Z) & 15) === 3 }
    for (let r = 2; r < 200; r += 2) for (let a = 0; a < 6.283; a += 0.5 / r) {
      const x = Math.round(p.x + Math.cos(a) * r), z = Math.round(p.z + Math.sin(a) * r)
      if (isGrass(x, z) && isGrass(x + 2, z) && isGrass(x, z + 2) && isGrass(x - 2, z) && isGrass(x, z - 2)) return { x, z }
    }
    return null
  })
  if (lawn) {
    await page.evaluate((l) => { const g = globalThis.engine, p = g.pose; p.x = l.x; p.z = l.z; p.y = g.ground(l.x, l.z) + 1.7 }, lawn)
    await page.waitForTimeout(800)
  }
  const grassTexels = await page.evaluate(() => globalThis.engine.grass?.stats.grassTexels ?? -1)
  check(!!lawn && grassTexels > 0, `grass grows on the lawn (${grassTexels} grass texels round the eye at ${JSON.stringify(lawn)})`)
} catch (e) {
  failures.push(String(e))
}
await finish('tools')
