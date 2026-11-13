// What goes up when hit sets off the next (#160): three drums of the kind that goes up (kinds.rs `CHARGED`), set
// on the street by an edit, 2.5 m apart. A charge catches the first only. Each goes off a moment after it is caught
// and catches the next (or throws it, and it goes up where it lands), and the page shows each one's fire.
//
//   node test/chain.mjs [--out dir]
import { mkdir } from 'node:fs/promises'
import { arg, start } from './kit.mjs'

const out = arg('out', '')
if (out) await mkdir(out, { recursive: true })
const { city, check, failures, finish } = await start()
const STEEL = 12, CHARGED = 32, RED = 20 << 8
try {
  const page = await city('fire=0')
  const made = () => page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.ready > 0 && e.world.stats.stale === 0 }, null, { timeout: 120_000 })
  await made()
  // Down in the street, looking along it at where the drums will stand.
  await page.evaluate(() => { const p = globalThis.engine.pose; p.y -= 10.5; p.yaw = Math.PI / 2; p.pitch = -0.1 })
  await made()
  const drums = await page.evaluate(([kind]) => {
    const e = globalThis.engine, p = e.pose
    const at = [0, 1, 2].map((k) => { const x = p.x + 5 + 2.5 * k, z = p.z; return [Math.round(x * 10), Math.round(e.ground(x, z) * 10) + 6, Math.round(z * 10)] })
    for (const c of at) e.set(c, 4, kind)
    return at
  }, [STEEL | CHARGED | RED])
  await page.waitForFunction(() => !globalThis.engine.settling, null, { timeout: 20_000 })
  await made()
  await page.waitForTimeout(500)
  const ahead = await page.evaluate(() => globalThis.engine.pick(0, 0))
  check(ahead?.material === STEEL && ahead.t < 80, `the drums stand in the street (material ${ahead?.material} ahead, ${ahead?.t?.toFixed(0)} cells off)`)
  if (out) await page.screenshot({ path: `${out}/chain-before.png` })
  // A charge of 12 a metre short of the first drum: the second is 3.5 m from it.
  const times = await page.evaluate(async ([c]) => {
    const e = globalThis.engine, t0 = performance.now(), seen = []
    e.strike([c[0] - 10, c[1], c[2]], 12, false)
    while (performance.now() - t0 < 30_000 && seen.length < 3) {
      await new Promise((r) => setTimeout(r, 8))
      while (seen.length < e.fell.bursts) seen.push(Math.round(performance.now() - t0))
    }
    return seen
  }, [drums[0]])
  if (out) await page.screenshot({ path: `${out}/chain-during.png` })
  check(times.length === 3, `three drums went off (${times.join(', ')} ms after the charge)`)
  check(times.length === 3 && times[0] >= 100 && times[1] - times[0] >= 100 && times[2] - times[1] >= 100, 'each a tenth of a second or more after the last, and none with the charge')
  await page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 && !e.settling && e.dropping === 0 }, null, { timeout: 40_000 })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => globalThis.engine.pick(0, 0))
  check(!(after?.material === STEEL && after.t < 80), `no drum is left where they stood (material ${after?.material} ahead, ${after?.t?.toFixed(0)} cells off)`)
  if (out) await page.screenshot({ path: `${out}/chain-after.png` })
} catch (e) {
  failures.push(String(e))
}
await finish('chain')
