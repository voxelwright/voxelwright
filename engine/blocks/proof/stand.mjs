// Pictures of the kit's panel standing in the landing world (#430, step 4), at several hours, from the street's
// own home view and from close by. Needs `npm run player` and `node blocks/serve.mjs --port 5991 --as kit`.
//
//   node blocks/proof/stand.mjs [--hours 10.4,17.6,22] [--port 5991]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, turn } from '../../test/kit.mjs'

const dir = join(homedir(), '.village', 'engine', 'blocks', 'world'), port = arg('port', '5991')
mkdirSync(dir, { recursive: true })
await turn()
const browser = await chromium.launch(CHROME)
for (const hour of arg('hours', '10.4,17.6,22').split(',')) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)) })
  await page.goto(`http://127.0.0.1:${port}/engine/landing/index.html?kit=/packages/voxelmorphism/&hour=${hour}&scale=1`)
  await page.waitForFunction(() => globalThis.landing?.on.seen.whole > 0 && document.querySelector('#standing'), null, { timeout: 90000 }).catch((e) => errors.push(String(e).split('\n')[0]))
  await page.keyboard.press('Escape') // the flight in is cut short
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(dir, `home-${hour}.png`) })
  // Close by, a little to its left and above, as someone standing before it
  const said = await page.evaluate(() => {
    const l = globalThis.landing, [x, y, z] = l.standing.at, c = l.standing.cube
    l.cam = { eye: [x + 6 * c, y - 34 * c, z + 120 * c], at: [x + 34 * c, y - 30 * c, z] }
    return { frameMs: l.on.frameMs, gpuMs: l.on.gpuMs, scale: l.on.scale, faults: l.on.gpu.faults, parts: document.querySelectorAll('#standing [data-vx-live]').length }
  }).catch((e) => ({ failed: String(e) }))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(dir, `near-${hour}.png`) })
  console.log(`hour ${hour}: ${JSON.stringify(said)}${errors.length ? ` errors: ${errors.slice(0, 3).join(' | ')}` : ''}`)
  await page.context().close()
}
await browser.close()
console.log(`pictures in ${dir}`)
