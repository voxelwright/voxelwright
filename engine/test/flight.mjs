// Runs the measuring flight for real (#140): the page server on a port of its own, a browser
// drawing with WebGPU, and the reports read back from the file the server kept. Nothing is
// stubbed: the numbers printed are this machine's.
//
//   node test/flight.mjs [--seconds 8] [--query "grid=8,8,8&levels=8&pool=128"] [--size 1280,720] [--dpr 2] [--shot picture.png]
//   --phone  a phone's screen with touch, so the page takes the settings and the handlers it would on one
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const here = new URL('..', import.meta.url).pathname
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = Number(arg('port', '5744')), seconds = arg('seconds', '8'), shot = arg('shot', '')
const reports = join(await mkdtemp(join(tmpdir(), 'engine-flight-')), 'reports.jsonl')
const server = spawn('node', ['serve.mjs', '--port', String(port), '--reports', reports], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('engine page on')) resolve() })
  server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
})
const kept = async () => (await readFile(reports, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const failures = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const phone = process.argv.includes('--phone')
const [w, h] = arg('size', phone ? '852,393' : '1280,720').split(',').map(Number)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(arg('dpr', phone ? '3' : '2')), ...(phone ? { hasTouch: true, isMobile: true, screen: { width: w, height: h } } : {}) })
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text().slice(0, 600)}`) })
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/?seconds=${seconds}&${arg('query', '')}`)
  const t0 = Date.now()
  let last
  for (;;) {
    await page.waitForTimeout(500)
    last = (await kept()).at(-1)
    if (last?.stage === 'flight' || last?.stage === 'error' || Date.now() - t0 > 240_000) break
  }
  if (shot) await page.screenshot({ path: shot })
  const all = await kept()
  for (const stage of ['start', 'made', 'places', 'flight']) check(all.some((r) => r.stage === stage), `no "${stage}" report was kept`)
  check(last?.stage !== 'error', `the page failed: ${last?.notes?.join(' | ')}`)
  check(!last?.faults?.length, `the device reported: ${last?.faults?.join(' | ')}`)
  check(last?.places?.length === 5 && last.places.every((p) => p.rays > 0 && p.shadows > 0 && p.all > 0), 'a place has no timings')
  check(last?.world?.full === 0 && last?.full === 0, `${last?.world?.full} sectors did not fit`)
  if (phone) check(last?.env?.touch > 0 && last?.world?.grid?.join() === '8,8,8' && last?.world?.levels === 8, `the page did not take a phone's settings (touch ${last?.env?.touch}, grid ${last?.world?.grid})`)
  check(last?.places?.every((p) => p.undrawn === 0), `sun maps were not all drawn at a place: ${last?.places?.map((p) => p.undrawn).join(' ')}`)
  check(last?.world?.whole === last?.world?.levels, `only ${last?.world?.whole} of ${last?.world?.levels} boxes were whole`)
} catch (e) {
  failures.push(String(e))
} finally {
  await browser.close()
  server.kill()
}
const { spawnSync } = await import('node:child_process')
console.log(spawnSync('node', ['test/read.mjs', reports], { cwd: here, encoding: 'utf8' }).stdout)
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('flight: ok')
