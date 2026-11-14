// One real ask through the page's own ask bar, and pictures of the bar and of what came (#244). THIS RUNS A
// MODEL if the helper does: it drives the page in Chrome as a person would, against a helper already running.
//
//   node test/wish.mjs "a red telephone box" --link "$(grep -o 'http.*#helper.*' helper.log)" --out file.png
//       [--picture made-up.png] [--at x,y,z --look yaw,pitch] [--phone]
// The words may hold an address (a link). A picture is given through the bar's own file input.
import { arg, chrome, has } from './kit.mjs'

const wish = process.argv[2], link = new URL(arg('link', '')), out = arg('out', 'wish.png'), picture = arg('picture', '')
const browser = await chrome()
const context = await browser.newContext(has('phone') ? { viewport: { width: 393, height: 760 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, screen: { width: 393, height: 852 } } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
const page = await context.newPage()
page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
link.search = `?fly=0&shared=1&name=${arg('name', 'Ada')}&at=${arg('at', '70,17.2,406')}&look=${arg('look', '0,-11.3')}`
await page.goto(link.href)
await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 90_000 })
await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 90_000 })
const stages = []
await page.exposeFunction('heard', (s) => stages.push(s))
await page.evaluate(() => { const t0 = performance.now(); engine.wish.on((s) => globalThis.heard(`${((performance.now() - t0) / 1000).toFixed(1)} s ${s.stage}${s.why ? `: ${s.why.slice(0, 140)}` : ''}`)) })
if (has('phone')) await page.tap('#line'); else await page.keyboard.press('Enter')
await page.screenshot({ path: out.replace(/\.png$/, '-open.png') })
if (picture) { await page.setInputFiles('#ask input[type=file]:not([capture])', picture); await page.waitForSelector('#given img') }
if (wish) await page.keyboard.type(wish)
await page.screenshot({ path: out.replace(/\.png$/, '-bar.png') })
const began = Date.now()
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
await page.screenshot({ path: out.replace(/\.png$/, '-wait.png') })
await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 400_000 })
console.log(stages.join('\n'))
const made = await page.evaluate(() => [...engine.things.all.values()].at(-1)?.id), ok = stages.at(-1)?.includes('done') && !(await page.evaluate(() => [...document.querySelectorAll('#notices p, #cues p')].some((p) => p.textContent.startsWith('Not made'))))
console.log(`${ok ? 'made' : 'not made'} in ${((Date.now() - began) / 1000).toFixed(1)} s`)
if (ok && made) {
  // Close to and above it, from its front: further back on this street the eye is in a parked car.
  await page.evaluate((id) => { const t = engine.things.all.get(id), far = Math.max(t.size[0], t.size[1]) / 10 + 2.2; Object.assign(engine.pose, { x: t.at[0] / 10, y: t.at[1] / 10 + t.size[1] / 20 + 1, z: t.at[2] / 10 + far, yaw: 0, pitch: -0.2 }); console.log(t.name) }, made)
  await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out })
  console.log(`a picture of it: ${out}`)
}
await browser.close()
process.exit(ok ? 0 : 1)
