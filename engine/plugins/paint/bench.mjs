// What the paint plugin's pass costs a frame (#314): the page's own `paced` (the march from here at the device's own
// pace, no 60 a second cap), with the plugins' passes drawn and without, turn about, the same view. Says the cost
// in milliseconds for a few marks and for as many as a rule may have, at two sizes, and whether anyone else was
// drawing on the GPU meanwhile (then the numbers mean less: run it again when it is quiet).
//
//   node plugins/paint/bench.mjs [--rounds 7]
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome } from '../../test/kit.mjs'
import { until, world } from '../../test/plugkit.mjs'

const rounds = Number(arg('rounds', '7')), w = await world(), browser = await chrome()
/** How many of the machine's places to draw are taken (kit.mjs `turn`): one is this bench's own. */
const drawing = () => { try { return readdirSync(join(homedir(), '.village', 'engine', 'turns')).length } catch { return 1 } }
const middle = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const FEW = `on('start', (world) => { world.paint('court', { line: [[640, 4040], [760, 4040], [760, 4100], [640, 4100]], closed: true, wide: 4, fill: 0.2 }); world.paint('half', { line: [[700, 4040], [700, 4100]] }); world.paint('spot', { at: [700, 4070], within: 8 }); world.paint('it', { at: [680, 4060], within: 6, colour: '#e23b2e', wide: 3, fill: 0.4 }) })`
// As many as a rule may have: sixteen marks, each a closed line of thirty-two points over the street in view.
const MANY = `on('start', (world) => { for (let m = 0; m < 16; m++) world.paint('m' + m, { line: Array.from({ length: 32 }, (_, k) => [640 + (m % 4) * 30 + 14 * Math.cos(k * Math.PI / 16), 4045 + Math.floor(m / 4) * 15 + 6 * Math.sin(k * Math.PI / 16)]), closed: true, wide: 2, fill: 0.3 }) })`
let busy = 0
try {
  for (const [size, dpr] of [[[1280, 720], 1], [[1440, 900], 2]]) {
    const page = await (await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr })).newPage()
    await page.goto(`${w.url}/city?shared=1&fly=0&sound=0&x=70&z=409`)
    await page.waitForFunction(() => globalThis.engine?.plugins?.loaded.paint, null, { timeout: 90_000 })
    await page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
    await page.evaluate(() => { const p = globalThis.engine.pose; p.x = 70; p.y = 30; p.z = 414; p.yaw = 0; p.pitch = -1.0 })
    await page.waitForTimeout(3000)
    for (const [what, source, marks] of [['four marks', FEW, 4], ['sixteen marks of 32 points', MANY, 16]]) {
      await w.rule('court', source)
      await page.waitForFunction((n) => globalThis.engine.plugins.of('paint')?.shown.marks.length === n, marks, { timeout: 20_000 })
      await page.waitForTimeout(1000)
      // Waits, up to five minutes, for nobody else to be drawing: another check on the GPU makes a round mean little.
      for (let waited = 0; drawing() > 1 && waited < 300; waited++) await new Promise((r) => setTimeout(r, 1000))
      const without = [], withIt = []
      for (let r = 0; r < rounds; r++) {
        busy = Math.max(busy, drawing() - 1)
        without.push(await page.evaluate(() => globalThis.engine.paced(undefined, false, false, false, false)))
        withIt.push(await page.evaluate(() => globalThis.engine.paced(undefined, false, false, false, true)))
      }
      const a = middle(without), b = middle(withIt), each = withIt.map((v, i) => v - without[i])
      console.log(`  ${size.join(' x ')} at ${dpr}x, ${what}: the march alone ${a.toFixed(2)} ms, with the pass ${b.toFixed(2)} ms: the pass costs ${middle(each).toFixed(2)} ms a frame (${(100 * middle(each) / a).toFixed(0)}% of the march; ${rounds} rounds, from ${Math.min(...each).toFixed(2)} to ${Math.max(...each).toFixed(2)})`)
      await w.post('ask', { by: 'tester', unrule: 'court' })
      await until('the marks are gone', () => page.evaluate(() => globalThis.engine.plugins.of('paint')?.shown.marks.length === 0))
    }
    await page.context().close()
  }
  console.log(busy ? `  note: ${busy} other check${busy > 1 ? 's were' : ' was'} drawing on this GPU at some point: run it again when it is quiet` : '  nobody else was drawing on this GPU meanwhile')
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
await browser.close().catch(() => {})
w.finish('paint bench')
