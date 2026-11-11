// Pictures of a street that is already running (#136), from fixed cameras, to compare one look
// with the next in seconds. Usage: node test/snap.ts <page-url> <out-dir> [views, e.g. "arrive,top"] [query]
// With `gpu=1` in the query it also says what each view costs: the GPU's time a frame over five seconds there.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Vec3 } from '../../home/src/engine/core.ts'
import { heightAt, planeAt } from '../src/ground.ts'
import { browser, sleep } from './lib.ts'

const [url, out, only = '', query = ''] = process.argv.slice(2)
if (!url || !out) throw new Error('Usage: node test/snap.ts <page-url> <out-dir> [views] [query]')
mkdirSync(out, { recursive: true })
const LEN = Math.hypot(1, 0.14)
/** Each view: where the camera stands and what it looks at. `arrive` is the camera that follows you. */
const VIEWS: Record<string, [Vec3, Vec3] | null> = {
  arrive: null,
  top: [[0.5, heightAt(-29 / LEN) + 3.2, -29 / LEN], [0, planeAt(-8) + 0.5, -8]],
  trench: [[-7, planeAt(-2) + 6, -5], [1, planeAt(6) + 0.3, 6.5]],
  below: [[3, planeAt(24) + 2.2, 24], [0, planeAt(10) + 1, 10]],
  // A pavement, near a front door, at eye height: what the houses are made of.
  door: [[4.2, planeAt(-14) + 1.6, -14], [7.9, planeAt(-19) + 1.9, -19]],
  // Across the street at a row of fronts.
  fronts: [[-6.6, planeAt(-2.2) + 1.7, -2.2], [8, planeAt(-9) + 4.2, -9]],
  // Low over the road, along it: what the ground is made of.
  road: [[1.2, planeAt(-20) + 1.0, -20], [3.5, planeAt(-13), -13]],
  // Where Ines stands asking for shade, and where Otis and Mabel stand.
  ines: [[1.5, planeAt(27) + 3.2, 27], [6.97, planeAt(23.6) + 0.9, 23.6]],
  otis: [[0.5, planeAt(-10) + 2.2, -10.5], [3.6, planeAt(-14.85) + 0.9, -14.85]],
  // A parked car from the pavement.
  car: [[-6.6, planeAt(-24.5) + 1.5, -24.5], [-3.9, planeAt(-19.3) + 0.7, -19.3]],
  // The bottom corner: the stop sign, the newspaper boxes, the crossing.
  corner: [[1.5, planeAt(21.5) + 2.1, 21.5], [-5.6, planeAt(28) + 1.6, 28]],
  // The top of the west pavement: a row of wheelie bins, the hydrant, the red kerb.
  bins: [[-3.2, planeAt(-25.5) + 1.7, -25.5], [-6.2, planeAt(-19.5) + 0.6, -19.5]],
  // From a roof, down the hill to the bay.
  roof: [[-3, planeAt(-26) + 16, -34], [0, planeAt(20), 20]],
}
const wanted = only ? only.split(',') : Object.keys(VIEWS)
const chrome = await browser()
try {
  const page = await chrome.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const said: string[] = []
  page.on('pageerror', (e) => said.push(String(e).slice(0, 400)))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) said.push(m.text().slice(0, 400)) })
  await page.goto(`${url}?name=Pavlo&${query}`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await page.addStyleTag({ content: '#more { display: none !important }' })
  await sleep(2500)
  for (const name of wanted) {
    const view = VIEWS[name]
    if (view === undefined) throw new Error(`no view called ${name}`)
    await page.evaluate(`window.__street.camera(${JSON.stringify(view?.[0] ?? null)}, ${JSON.stringify(view?.[1] ?? [0, 0, 0])})`)
    await sleep(1200)
    await page.screenshot({ path: join(out, `${name}.png`) })
    if (query.includes('gpu=1')) {
      await sleep(5200)
      const s = await page.evaluate('window.__street.stats()') as { gpuMs: { p50: number; p95: number }; quality: string }
      console.log(`${name}: ${s.gpuMs.p50} ms (p95 ${s.gpuMs.p95}) at ${s.quality}`)
    }
  }
  const stats = await page.evaluate('window.__street.stats()') as Record<string, unknown>
  console.log(JSON.stringify({ gpuMs: stats.gpuMs, cpuMs: stats.cpuMs, quality: stats.quality, tier: stats.tierReason, errors: said.slice(0, 6) }))
} finally {
  await chrome.close()
}
