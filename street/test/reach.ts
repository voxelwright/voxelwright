// Can a browser reach the street at an address other than this machine's own loopback
// (#118 spike)? Opens the page at a URL (the tailnet one), waits for a seat, walks a little
// and reports the round trip and what arrived. Usage: node test/reach.ts <url> [chromium|webkit]
import { chromium, webkit } from 'playwright'

const url = process.argv[2], which = process.argv[3] ?? 'chromium'
if (!url) throw new Error('Usage: node test/reach.ts <url> [chromium|webkit]')
const browser = which === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let out: Record<string, unknown>
try {
  await page.goto(url)
  const has = await page.evaluate(() => typeof WebTransport === 'function')
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 15_000 })
  await page.evaluate(`window.__street.hold('KeyD', true)`)
  await new Promise((r) => setTimeout(r, 2500))
  await page.evaluate(`window.__street.hold('KeyD', false)`)
  out = { url, browser: `${which} ${browser.version()}`, webTransport: has, seated: true, stats: await page.evaluate('window.__street.stats()'), errors }
} catch (e) {
  out = { url, browser: `${which} ${browser.version()}`, seated: false, webTransport: await page.evaluate(() => typeof WebTransport === 'function').catch(() => null), why: String(e).split('\n')[0], pageSays: await page.textContent('#hud').catch(() => null), errors }
}
console.log(JSON.stringify(out))
await browser.close()
