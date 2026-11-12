// A look at breaking things on a street of cells that is already running (#138): from a fixed
// camera, blasts where points of the screen look, with stills and a clip. By hand, for pictures.
// Usage: node test/break.ts <page-url> <out-dir> [view from "x,y,z"] [view to "x,y,z"] [points "x:y x:y ..."]
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { planeAt } from '../src/ground.ts'
import { browser, sleep } from './lib.ts'

const [url, out, from = `-6.6,${planeAt(-2.2) + 1.7},-2.2`, to = `8,${planeAt(-9) + 4.2},-9`, points = '700:330 760:300 640:380 820:250 700:230 560:300 900:380 700:420 760:360 640:300'] = process.argv.slice(2)
if (!url || !out) throw new Error('Usage: node test/break.ts <page-url> <out-dir> [from] [to] [points]')
mkdirSync(out, { recursive: true })
const chrome = await browser()
try {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } })
  const page = await context.newPage()
  const said: string[] = []
  page.on('pageerror', (e) => said.push(String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) said.push(m.text().slice(0, 300)) })
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  await page.goto(`${url}?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 40_000 })
  await page.addStyleTag({ content: '#more { display: none !important }' })
  await s(`s.camera([${from}], [${to}])`)
  await sleep(2500)
  console.log('drawn:', JSON.stringify(await s('s.cells()')))
  await page.screenshot({ path: join(out, '0-before.png') })
  let n = 0
  for (const point of points.split(' ')) {
    const [x, y] = point.split(':').map(Number)
    const at = await s<number[] | null>(`s.meets(${x}, ${y})`)
    if (!at) { console.log('nothing at', point); continue }
    await s(`s.blow(${JSON.stringify(at)}, 'boom')`)
    await sleep(140)
    if (n === 0 || n === 3) await page.screenshot({ path: join(out, `${n + 1}-blast.png`) })
    await sleep(760)
    n++
  }
  await sleep(2500)
  await page.screenshot({ path: join(out, '9-after.png') })
  const stats = await s<Record<string, unknown>>('s.stats()')
  console.log('after:', JSON.stringify(await s('s.cells()')), JSON.stringify({ gpuMs: stats.gpuMs, cpuMs: stats.cpuMs, quality: stats.quality, things: stats.things, errors: said.slice(0, 5) }))
  await context.close()
  for (const f of readdirSync(out)) if (f.endsWith('.webm') && f !== 'clip.webm') renameSync(join(out, f), join(out, 'clip.webm'))
} finally {
  await chrome.close()
}
