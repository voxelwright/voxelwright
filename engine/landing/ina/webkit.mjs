// Does the place start in WebKit, as an iPhone's Safari would have it (#423)? Opens /city?place=ina in Playwright's
// WebKit, waits for the place's blocks, and keeps a picture. It says what the page said if it did not start.
//
//   node landing/ina/webkit.mjs [--place ina] [--size 844x390] [--out file.png]
import { homedir } from 'node:os'
import { join } from 'node:path'
import { webkit } from 'playwright'
import { arg, turn } from '../../test/kit.mjs'

await turn()
const [width, height] = arg('size', '844x390').split('x').map(Number)
const browser = await webkit.launch()
const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage()
const said = []
page.on('pageerror', (e) => said.push(`page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') said.push(`console: ${m.text().slice(0, 300)}`) })
await page.goto(`${arg('server', 'http://127.0.0.1:5961')}/city?place=${arg('place', 'ina')}&sound=0&people=0`)
const started = await page.waitForFunction(() => globalThis.engine?.spot && engine.spot.coming === 0 && engine.world.stats.ready > 0, null, { timeout: 180_000 }).then(() => true).catch(() => false)
await page.waitForTimeout(4000)
const out = arg('out', join(homedir(), '.village', 'engine', 'landing', 'ina', 'shots', 'webkit.png'))
await page.screenshot({ path: out })
const state = await page.evaluate(() => ({ gpu: !!navigator.gpu, faces: globalThis.engine?.spot?.faces ?? null, hud: document.querySelector('#hud')?.textContent?.slice(0, 160) ?? '' })).catch((e) => ({ error: e.message }))
console.log(JSON.stringify({ started, ...state, said: said.slice(0, 8), out }))
await browser.close()
process.exit(0)
