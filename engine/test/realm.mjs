// A realm asked for through the page's own ask bar, with pictures (#264). THIS RUNS A MODEL if the helper does.
//   node test/realm.mjs "Create a realm called ... " --link <the helper's address> --out dir [--ask]   (--ask: be asked first, taking each first answer)
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has } from './kit.mjs'

const idea = process.argv[2], link = new URL(arg('link', '')), out = arg('out', 'realm')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(CHROME), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'info') console.log(m.text()) })
link.search = `?fly=0&shared=1&name=${arg('name', 'Neo')}&at=${arg('at', '70,17.2,406')}&look=${arg('look', '0,-11.3')}`
await page.goto(link.href)
await page.waitForFunction(() => { const s = globalThis.engine?.world.stats; return s && s.ready > 0 && s.wanted === 0 }, null, { timeout: 120_000 })
const t0 = Date.now(), at = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`
const choice = async (starts, timeout = 30_000) => { await page.waitForFunction((s) => !document.querySelector('#choice').hidden && document.querySelector('#choice p')?.textContent !== globalThis.lastChoice && (!s || document.querySelector('#choice p').textContent.includes(s)), starts, { timeout }); const text = await page.evaluate(() => { const p = document.querySelector('#choice p').textContent; globalThis.lastChoice = p; return `${p} [${[...document.querySelectorAll('#choice button')].map((b) => b.textContent.replace(/^\d/, '')).join(' | ')}]` }); console.log(`${at()}  ${text}`); return text }
if (has('enter')) {
  // A realm that is there already: straight in, to say things.
  await page.goto(`${link.origin}/city?fly=0&name=Neo&at=${arg('at', '70,17.2,406')}&look=${arg('look', '0,-11.3')}&realm=${arg('enter', '')}`)
  await page.waitForFunction(() => { const s = globalThis.engine?.world.stats; return s && s.ready > 0 && s.wanted === 0 }, null, { timeout: 120_000 })
  await page.waitForTimeout(5000)
  for (const [n, text] of arg('say', '').split('|').entries()) { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(Number(arg('pause', '5000'))); await page.screenshot({ path: join(out, `5-said-${n + 1}.png`) }) }
  await browser.close(); process.exit(0)
}
await page.keyboard.press('Enter')
await page.keyboard.type(idea, { delay: 2 })
await page.screenshot({ path: join(out, '1-asked.png') })
await page.keyboard.press('Enter')
await choice('A new realm')
await page.keyboard.press(has('ask') ? 'Digit2' : 'Digit1')
for (;;) {
  const text = await choice('', 400_000)
  if (text.includes('is ready')) break
  await page.screenshot({ path: join(out, `2-question-${Date.now() - t0}.png`) })
  await page.keyboard.press('Digit1')
  await page.waitForTimeout(400)
  if (!globalThis.shot) { globalThis.shot = true }
}
await page.screenshot({ path: join(out, '3-ready.png') })
await Promise.all([page.waitForNavigation({ timeout: 60_000 }), page.keyboard.press('Digit1')])
await page.waitForFunction(() => { const s = globalThis.engine?.world.stats; return s && s.ready > 0 && s.wanted === 0 }, null, { timeout: 120_000 })
console.log(`${at()}  stepped in: ${new URL(page.url()).search}`)
await page.waitForTimeout(6000)
await page.screenshot({ path: join(out, '4-inside.png') })
for (const [n, text] of (arg('say', '') ? arg('say', '').split('|') : []).entries()) {
  await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter')
  await page.waitForTimeout(5000)
  await page.screenshot({ path: join(out, `5-said-${n + 1}.png`) })
}
await browser.close()
process.exit(0)
