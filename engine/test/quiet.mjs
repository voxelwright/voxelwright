// How busy the GPU is with other things, for a while (#259): the fixed work that is none of the engine's, and the street's rays, every few seconds.
import { arg, start, still } from './kit.mjs'
import { from } from './rows.mjs'
const { city, finish } = await start()
const page = await city('scale=1&people=0', { size: [1280, 720], dpr: 2 })
await still(page)
await from(page, 0, 1.8, 0, 90, -2)
await still(page, { sun: true })
for (let i = 0; i < Number(arg('times', '10')); i++) {
  const r = await page.evaluate(async () => ({ quiet: await globalThis.engine.quiet(), all: await globalThis.engine.paced(3), steps: (await globalThis.engine.steps(3)).mean }))
  console.log(`${new Date().toISOString().slice(11, 19)} fixed ${r.quiet.toFixed(2)} ms, street all ${r.all.toFixed(1)} ms, steps ${r.steps.toFixed(2)}`)
  await page.waitForTimeout(2000)
}
await finish('quiet')
