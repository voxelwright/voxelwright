// Runs the probe for real (#140): the page server on a port of its own, the installed Chrome
// drawing with WebGPU, and the report read back from the file the server kept. Nothing is
// stubbed: the numbers printed are this machine's.
//
//   node test/probe.mjs [--heat 5] [--shot picture.png] [--headed]
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const here = new URL('..', import.meta.url).pathname
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const port = 5741, heat = arg('heat', '3'), shot = arg('shot', '')
const reports = join(await mkdtemp(join(tmpdir(), 'engine-probe-')), 'reports.jsonl')

const server = spawn('node', ['serve.mjs', '--port', String(port), '--reports', reports], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('engine page on')) resolve() })
  server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
  setTimeout(() => reject(new Error('the server was not ready in 10 s')), 10_000)
})

const failures = []
const check = (ok, what) => { if (!ok) failures.push(what) }
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/probe?heat=${heat}`)
  await page.waitForFunction(() => document.body.dataset.done, null, { timeout: 180_000 })
  if (shot) await page.screenshot({ path: shot })
  const kept = (await readFile(reports, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  const last = kept[kept.length - 1]
  check(kept.some((r) => r.stage === 'sweep'), 'no sweep report was kept')
  check(last.stage !== 'error', `the page failed: ${last.notes?.join(' | ')}`)
  check(Number(heat) === 0 || last.stage === 'heat', 'no heat report was kept')
  check(!last.faults?.length, `the device reported: ${last.faults?.join(' | ')}`)
  for (const kind of ['fill', 'quads', 'rays']) check(last[kind]?.length && last[kind].every((r) => r.ms > 0), `${kind} has no timings`)
  check(last.rays?.every((r) => r.steps > 1), 'rays took no steps')
  check(last.env?.isolated === true, 'the page is not cross-origin isolated')
  const gpu = last.env?.gpu ?? {}
  console.log(`${gpu.vendor} ${gpu.architecture} ${gpu.description ?? ''} · ${last.env?.canvas?.join(' x ')} · screen ${last.base?.hz} Hz · walk ${last.walk?.ms} ms`)
  for (const r of last.fill ?? []) console.log(`  fill   ${r.layers} layers ${r.size.join('x')}: ${r.ms} ms (gpu ${r.gpuMs})`)
  for (const r of last.quads ?? []) console.log(`  quads  ${(r.count / 1e6).toFixed(2)}M (cell ${r.cell} m): ${r.ms} ms (gpu ${r.gpuMs})`)
  for (const r of last.rays ?? []) console.log(`  rays   ${r.view}${r.shadow ? '+shadow' : ''} ${r.size.join('x')}: ${r.ms} ms (gpu ${r.gpuMs}), ${r.steps} steps`)
  if (last.heat) console.log(`  heat   ${last.heat.size.join('x')}: paced ${last.heat.paced.map((p) => p.ms).join(', ')} ms; frames a second ${last.heat.seconds.map((s) => s.frames).join(' ')}`)
  if (last.notes?.length) console.log(`  notes  ${last.notes.join(' | ')}`)
} finally {
  await browser.close()
  server.kill()
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('probe: ok')
