// Runs the probe for real (#140): the page in the installed Chrome drawing with WebGPU, and
// the reports it posts read off the wire. Nothing is stubbed: the numbers printed are this
// machine's.
//
//   node test/probe.mjs [--heat 5] [--shot picture.png] [--headed]
import { arg, start } from './kit.mjs'

const heat = arg('heat', '3'), shot = arg('shot', '')
const { url, page: open, check, failures, finish } = await start()
try {
  const page = await open()
  const kept = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/report')) kept.push(r.postDataJSON()) })
  await page.goto(`${url}/probe?heat=${heat}`)
  await page.waitForFunction(() => document.body.dataset.done, null, { timeout: 180_000 })
  if (shot) await page.screenshot({ path: shot })
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
} catch (e) {
  failures.push(String(e))
}
await finish('probe')
