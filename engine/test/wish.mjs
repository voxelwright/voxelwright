// One real ask from the real page, and a picture of what came (#244). THIS RUNS A MODEL if the helper does:
// it drives the page in Chrome exactly as a person's would be, against a helper that is already running.
//
//   node test/wish.mjs "a red telephone box" --link "$(grep -o 'http.*#helper.*' helper.log)" --out file.png [--at x,y,z --look yaw,pitch]
import { chromium } from 'playwright'
import { arg, CHROME } from './kit.mjs'

const wish = process.argv[2], link = new URL(arg('link', '')), out = arg('out', 'wish.png')
const browser = await chromium.launch(CHROME), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
link.search = `?fly=0&shared=1&name=${arg('name', 'Ada')}&at=${arg('at', '70,17.2,406')}&look=${arg('look', '0,-11.3')}`
await page.goto(link.href)
await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 90_000 })
const began = Date.now()
const went = await page.evaluate(async (wish) => { const stages = []; const t0 = performance.now(); const done = await engine.ask({ wish }, (s) => stages.push(`${((performance.now() - t0) / 1000).toFixed(1)} s ${s.stage}${s.why ? `: ${s.why.slice(0, 120)}` : ''}`)); return { done, stages } }, wish)
console.log(went.stages.join('\n'))
console.log(`${went.done.state}${went.done.why ? `: ${went.done.why}` : ''} ${went.done.name ?? ''} in ${((Date.now() - began) / 1000).toFixed(1)} s (the model ${((went.done.ms ?? 0) / 1000).toFixed(1)} s, asked ${went.done.tries ?? 0} times)`)
if (went.done.state === 'there') {
  await page.waitForFunction((id) => engine.things.all.has(id), went.done.id, { timeout: 10_000 })
  // Close to and above it, from its front: further back on this street the eye is in a parked car.
  await page.evaluate((id) => { const t = engine.things.all.get(id), far = Math.max(t.size[0], t.size[1]) / 10 + 2.2; Object.assign(engine.pose, { x: t.at[0] / 10, y: t.at[1] / 10 + t.size[1] / 20 + 1, z: t.at[2] / 10 + far, yaw: 0, pitch: -0.2 }) }, went.done.id)
  await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: '#aim, #boom, #tools { display: none }' })
  await page.screenshot({ path: out })
  console.log(`a picture of it: ${out}`)
}
await browser.close()
process.exit(went.done.state === 'there' ? 0 : 1)
