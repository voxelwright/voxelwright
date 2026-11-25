// Against the running quickstart. Playwright drives installed Chrome with a fresh profile.
import { chromium } from 'playwright'
import { CHROME, turn } from './kit.mjs'

const [url, picture] = process.argv.slice(2)
if (!url || !picture) throw new Error('usage: node engine/test/quickstart.mjs URL picture.png')
await turn()
const browser = await chromium.launch(CHROME)
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
  const outside = new Set(), errors = []
  await context.route('**/*', route => {
    const request = new URL(route.request().url())
    if (request.origin === new URL(url).origin) return route.continue()
    outside.add(request.origin)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 240_000 })
  const seen = await page.evaluate(() => globalThis.engine.seen)
  await page.screenshot({ path: picture })
  if (errors.length || outside.size) throw new Error(`page errors: ${errors.join(', ')}; external origins: ${[...outside].join(', ')}`)
  console.log(`SF drawn: first frame ${Math.round(seen.first)} ms, park ${Math.round(seen.near)} ms, whole ${Math.round(seen.whole)} ms; no external page requests`)
} finally {
  await browser.close()
}
