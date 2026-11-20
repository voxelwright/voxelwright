// A quick look at the static realm (#450): what the far model holds after a while, and a picture. For working on it.
//   node sf/far/peek.mjs [--size 1280x720] [--query "&at=..."] [--seconds 20] [--out file.png] [--eval "js"]
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, here, turn } from '../../test/kit.mjs'
import { plain } from '../../player/serve.mjs'

const site = await plain(join(here, 'dist-sf'), '127.0.0.1')
const back = await turn()
const browser = await chromium.launch(CHROME)
const [w, h] = arg('size', '1280x720').split('x').map(Number)
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)) })
await page.goto(`${site.url}/sf/index.html?scale=1&sound=0&people=0${arg('query', '')}`)
await page.waitForFunction(() => globalThis.engine?.far, null, { timeout: 120000 })
await page.waitForTimeout(Number(arg('seconds', '20')) * 1000)
await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where { display: none }' })
await page.waitForTimeout(500)
if (arg('eval')) console.log('eval:', JSON.stringify(await page.evaluate(arg('eval'))))
if (arg('out')) await page.screenshot({ path: arg('out') })
console.log(JSON.stringify(await page.evaluate(() => ({ stats: engine.far.stats, whole: engine.far.whole, world: engine.world.stats.wanted, scale: engine.scale, frame: engine.frameMs }))))
await browser.close(); back?.(); process.exit(0)
