// A picture of a place in a shared world that is already being served (#244): for looking at what was made.
//   node test/shot.mjs --world http://127.0.0.1:5761 --at x,y,z --look yaw,pitch --out file.png     (metres, degrees)
import { arg, chrome } from './kit.mjs'
const browser = await chrome(), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
await page.goto(`${arg('world', 'http://127.0.0.1:5761')}/city?fly=0&shared=1&people=${arg('people', '1')}&at=${arg('at', '70,17,406')}&look=${arg('look', '0,-10')}&scale=1`)
await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 120_000 })
// The world made round the eye, or as much of it as a minute makes.
await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000 }).catch(() => console.log('not all made in a minute'))
await page.waitForTimeout(Number(arg('wait', '4000')))
await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over { display: none }' })
await page.screenshot({ path: arg('out', 'shot.png') })
await browser.close()
process.exit(0)
