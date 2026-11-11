// A look at the street (#118): a fresh world, one page, a short walk, and a picture of it.
// Usage: node test/look.ts <out.png> [query, e.g. "shadows=0"] [width] [height]
import { browser as launch, sleep, startPage, startWorld } from './lib.ts'

const out = process.argv[2], query = process.argv[3] ?? '', width = Number(process.argv[4] ?? 1280), height = Number(process.argv[5] ?? 720)
if (!out) throw new Error('Usage: node test/look.ts <out.png> [query] [width] [height]')
const WT = 4833, PAGE = 5348
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT)
const browser = await launch()
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  const said: string[] = []
  page.on('pageerror', (e) => said.push(`error: ${e}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') said.push(`${m.type()}: ${m.text().slice(0, 300)}`) })
  await page.goto(`http://localhost:${PAGE}/?${query}`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 }).catch(() => said.push('never ready'))
  await page.evaluate(`window.__street?.hold('KeyW', true)`)
  await sleep(1400)
  await page.evaluate(`window.__street?.hold('KeyW', false)`)
  await sleep(2500)
  await page.screenshot({ path: out })
  console.log(JSON.stringify({ stats: await page.evaluate('window.__street?.stats()'), census: await page.evaluate('window.__street?.census()'), said: said.slice(0, 8) }))
} finally {
  await browser.close()
  world.kill()
  vite.kill()
}
