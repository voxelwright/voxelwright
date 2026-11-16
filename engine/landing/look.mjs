// Pictures of the landing world (#421), for looking at while it is designed:
//
//   node landing/look.mjs [--at home,blog,village,tags,feed,face] [--size 1280x720] [--out ~/.village/engine/landing/look] [--query '&hour=18'] [--webkit] [--name tag]
//
// It builds the static folder, serves it as plain files on port 5950, opens the world alone (no page round it) at
// each place, waits until the whole world is made, and keeps the picture.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium, webkit } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'landing', 'look')), [w, h] = arg('size', '1280x720').split('x').map(Number)
const built = spawnSync('node', ['player/build.mjs'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
mkdirSync(out, { recursive: true })
const site = await plain(join(here, 'dist'), '127.0.0.1', Number(arg('port', '5950')))
await turn()
const browser = has('webkit') ? await webkit.launch() : await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
for (const at of arg('at', 'home').split(',')) {
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  page: ${m.text().slice(0, 300)}`) })
  await page.goto(`${site.url}/landing/index.html?at=${at}&calm=1${arg('query', '')}`)
  await page.waitForFunction(() => globalThis.landing?.on.seen.whole > 0 || document.documentElement.dataset.state === 'error', null, { timeout: 60000 })
  await page.waitForTimeout(Number(arg('wait', '1200')))
  const file = join(out, `${arg('name', 'look')}-${at}-${w}x${h}.png`)
  await page.screenshot({ path: file })
  console.log(file, await page.evaluate(() => `${document.documentElement.dataset.state} ${document.documentElement.dataset.said} scale ${globalThis.landing?.on.scale}`))
  await page.close()
}
await browser.close()
site.stop()
process.exit(0)
