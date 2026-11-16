// Pictures of the home page with the street under it (#421), for looking at while it is designed:
//
//   node landing/shots.mjs [--size 1280x720] [--out ~/.village/engine/landing/look] [--name tag] [--webkit] [--query '?view=2d'] [--do home|sign|face|page]
//
// It builds the static folder, serves it as plain files on port 5951, opens the home page as a visitor would, and
// keeps a picture of the page as it comes, of the street once the eye has landed, and of whatever `--do` asks for.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium, webkit } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'landing', 'look')), [w, h] = arg('size', '1280x720').split('x').map(Number), name = arg('name', 'home')
const built = spawnSync('node', ['player/build.mjs'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
mkdirSync(out, { recursive: true })
const site = await plain(join(here, 'dist'), '127.0.0.1', Number(arg('port', '5951')))
await turn()
const browser = has('webkit') ? await webkit.launch() : await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600, colorScheme: has('dark') ? 'dark' : 'light' })
const page = await context.newPage()
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') console.log(`  page: ${m.text().slice(0, 300)}`) })
const shot = async (what) => { const file = join(out, `${name}-${what}-${w}x${h}.png`); await page.screenshot({ path: file }); console.log(file) }
await page.goto(`${site.url}/landing/site/index.html${arg('query', '')}`)
await page.waitForTimeout(250)
await shot('page')
const view = await page.evaluate(() => globalThis.home.decided)
console.log(`  decided ${view}`)
if (view[0] === '3d') {
  await page.waitForFunction(() => globalThis.home.at === 'home' && !globalThis.home.flying, null, { timeout: 60000 })
  const inner = page.frames().find((f) => f !== page.mainFrame())
  await inner.waitForFunction(() => globalThis.landing?.on.seen.whole > 0, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  await shot('street')
  console.log(`  times ${JSON.stringify(await page.evaluate(() => globalThis.home.times))}`)
  for (const what of arg('do', '').split(',').filter(Boolean)) {
    if (what === 'face') { await page.keyboard.press('f') } else { await page.focus(`#menu a[data-sign="${what}"]`); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp') }
    await page.waitForFunction((id) => globalThis.home.at === id && !globalThis.home.flying, what, { timeout: 10000 }).catch(() => console.log(`  never came to ${what}`))
    await page.waitForTimeout(500)
    await shot(what)
  }
}
await browser.close()
site.stop()
process.exit(0)
