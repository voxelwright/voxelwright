// How fast the march is, kept against a baseline (#144). Five places, three ways each (the
// rays a pixel sends, with the sun's shadows, with mirrors too), paced at the full 2560 x 1440
// in turn for three rounds, the middle one kept. Beside them a fixed piece of work that is none
// of the engine's tells whether the GPU was busy with something else: this Mac's timings double
// when another thread draws, and a comparison made then is worth nothing.
//
//   node test/bench.mjs            compare with test/baseline.json; fails if a place is over a tenth slower
//   node test/bench.mjs --update   keep what was measured as the baseline (only when the GPU is quiet)
//
// Ends 0 when no slower, 1 when slower, 3 when the GPU was too busy to say.
import { readFile, writeFile } from 'node:fs/promises'
import { arg, has, here, start, still } from './kit.mjs'
import { from } from './rows.mjs'

const PLACES = [['street', 0, 1.8, 0, 90, -2], ['fronts', 0, 1.8, 0, 60, 5], ['roofs', 0, 12, 0, 20, -8], ['high', 0, 130, 0, 30, -22], ['far', 0, 730, 0, 200, -30]]
const WAYS = [['rays', 0], ['shadows', 1], ['all', 3]]
const SLOWER = 1.1, BUSY = 1.3
const file = `${here}test/baseline.json`
const kept = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
const middle = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const { city, failures, finish } = await start()
let busy = false
try {
  const page = await city('scale=1', { size: [1280, 720], dpr: 2 })
  await still(page)
  const machine = await page.evaluate(() => `${globalThis.engine.gpu.adapter?.info?.description || globalThis.engine.gpu.adapter?.info?.vendor || 'gpu'} ${document.querySelector('canvas').width}x${document.querySelector('canvas').height}`)
  const base = kept[machine]
  const quiet = [await page.evaluate(() => globalThis.engine.quiet())]
  const now = {}
  for (const [name, ...at] of PLACES) {
    await from(page, ...at)
    await page.waitForTimeout(300)
    await still(page, { sun: true })
    const times = WAYS.map(() => [])
    for (let round = 0; round < 3; round++) for (const [i, [, flags]] of WAYS.entries()) times[i].push(await page.evaluate((f) => globalThis.engine.paced(f), flags))
    for (const [i, [way]] of WAYS.entries()) now[`${name} ${way}`] = Number(middle(times[i]).toFixed(2))
    quiet.push(await page.evaluate(() => globalThis.engine.quiet()))
  }
  const fixed = Number(Math.max(...quiet).toFixed(2))
  console.log(`${machine}; the fixed work took ${Math.min(...quiet).toFixed(2)} to ${fixed} ms${base ? ` (${base.quiet} when the baseline was kept)` : ''}`)
  busy = base ? fixed > base.quiet * BUSY : Math.max(...quiet) > Math.min(...quiet) * BUSY
  for (const [key, ms] of Object.entries(now)) {
    const was = base?.ms[key], ratio = was ? ms / was : 1
    console.log(`  ${key.padEnd(15)} ${ms.toFixed(2).padStart(6)} ms${was ? `   was ${was.toFixed(2).padStart(6)}   ${ratio > SLOWER ? 'SLOWER' : ratio < 1 / SLOWER ? 'faster' : 'same'} (${((ratio - 1) * 100).toFixed(0)}%)` : ''}`)
    if (!busy && ratio > SLOWER) failures.push(`${key} is ${((ratio - 1) * 100).toFixed(0)}% slower than the baseline (${ms} against ${was} ms)`)
  }
  if (busy) console.log('the GPU was busy with something else: nothing is said about faster or slower')
  else if (has('update') || !base) {
    kept[machine] = { kept: new Date().toISOString().slice(0, 10), quiet: fixed, ms: now }
    await writeFile(file, JSON.stringify(kept, null, 2) + '\n')
    console.log(`kept as the baseline in test/baseline.json`)
    failures.length = 0
  }
} catch (e) {
  failures.push(String(e))
}
// Through finish, so that the server and the browser this started are stopped: ending here left the server running.
if (busy && !failures.length) await finish('bench', 3, 'busy')
await finish('bench')
