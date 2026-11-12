// Prints the reports the page server kept (#140), one device a block: node test/read.mjs [file] [--all]
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(homedir(), '.village', 'engine', 'reports.jsonl')
const kept = (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
// The last report of each run says everything the earlier ones did.
const runs = new Map()
for (const r of kept) runs.set(r.run, r)
for (const r of runs.values()) {
  const gpu = r.env?.gpu ?? {}
  console.log(`\n${r.at} run ${r.run} ${r.build} (${r.stage})`)
  console.log(`  ${r.env?.ua}`)
  console.log(`  ${gpu.vendor} ${gpu.architecture} ${gpu.device ?? ''} ${gpu.description ?? ''} · canvas ${r.env?.canvas?.join(' x ')} dpr ${r.env?.dpr} · screen ${r.base?.hz} Hz (${r.base?.ms} ms) · cores ${r.env?.cores} · walk ${r.walk?.ms} ms`)
  console.log(`  isolated ${r.env?.isolated} sharedMemory ${r.env?.sharedMemory} wasmSimd ${r.env?.wasmSimd} wasmThreads ${r.env?.wasmThreads} webTransport ${r.env?.webTransport} canTime ${gpu.canTime}`)
  if (process.argv.includes('--all')) {
    console.log(`  features: ${gpu.features?.join(' ')}`)
    console.log(`  limits: ${Object.entries(gpu.limits ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  }
  for (const f of r.fill ?? []) console.log(`  fill   ${f.layers} layers ${f.size.join('x')}: ${f.ms} ms (gpu ${f.gpuMs}) = ${(f.ms / f.mp / f.layers).toFixed(3)} ms/MP/layer`)
  for (const q of r.quads ?? []) console.log(`  quads  ${(q.count / 1e6).toFixed(2)}M (cell ${q.cell} m): ${q.ms} ms (gpu ${q.gpuMs}) = ${(q.ms / (q.count / 1e6)).toFixed(2)} ms/M`)
  for (const y of r.rays ?? []) console.log(`  rays   ${y.view}${y.shadow ? '+shadow' : ''} ${y.size.join('x')}: ${y.ms} ms (gpu ${y.gpuMs}), ${y.steps} steps = ${(y.ms / y.mp).toFixed(2)} ms/MP, ${((y.ms / y.mp / y.steps) * 1000).toFixed(1)} us/MP/step`)
  if (r.heat) {
    console.log(`  heat   ${r.heat.size.join('x')} (scale ${r.heat.scale}): paced ${r.heat.paced.map((p) => `${p.t}s ${p.ms}`).join(', ')} ms`)
    console.log(`         frames a second: ${r.heat.seconds.map((s) => s.frames).join(' ')}`)
    console.log(`         p95 gap ms:      ${r.heat.seconds.map((s) => s.p95).join(' ')}`)
  }
  if (r.world) console.log(`  world  made in ${(r.world.ms / 1000).toFixed(1)} s: grid ${r.world.grid?.join('x')}, ${r.world.levels} boxes, ${r.world.workers} workers, ${r.world.sectors} sectors (${r.world.makeMs} ms each), ${r.world.poolMb} of ${r.world.poolOfMb} MB, ${r.world.full} did not fit, ${r.world.whole} boxes whole`)
  for (const p of r.places ?? []) console.log(`  place  ${p.name.padEnd(7)} ${p.size.join('x')} (${p.mp} MP): rays ${p.rays} ms, +shadows ${p.shadows} ms, +mirrors ${p.all} ms${p.traced ? `, all traced ${p.traced} ms` : ''} = ${(p.rays / p.mp).toFixed(1)} / ${(p.shadows / p.mp).toFixed(1)} / ${(p.all / p.mp).toFixed(1)} ms/MP; by itself ${p.fps} fps at scale ${p.scale} (march ${p.liveGpuMs} ms); made in ${p.madeMs} ms${p.mapsMs === undefined ? '' : `, sun maps in ${p.mapsMs} ms (${p.undrawn} tiles not drawn)`}`)
  if (r.flight) {
    const s = r.flight.seconds
    console.log(`  flight ${s.length} s (shortest gap ${r.flight.shortest} ms): frames a second ${s.map((x) => x.frames).join(' ')}`)
    console.log(`         p95 gap ms: ${s.map((x) => x.p95).join(' ')}`)
    console.log(`         scale:      ${s.map((x) => x.scale).join(' ')}`)
  }
  for (const b of r.breaks ?? []) console.log(`  break  ${b.name.padEnd(5)} ${b.hit ? '' : '(missed) '}${b.pieces} pieces, ${b.cells} cells; worked out in ${b.workedMs} ms, answered after ${b.answeredMs} ms, town whole again after ${b.allMs} ms${b.late ? ' (gave up waiting)' : ''}${b.most ? `; most bodies at once ${b.most}, the solver's longest frame ${b.stepMs} ms` : ''}; ${b.frames} frames, gaps p50 ${b.p50} p95 ${b.p95} max ${b.max} ms, ${b.long} over 25 ms; scale ${b.scale}`)
  if (r.hand) console.log(`  hand   ${r.hand.asks} breaks: ${r.hand.pieces} pieces, ${r.hand.cells} cells fell; the last worked out in ${Math.round(r.hand.ms)} ms; ${r.hand.fps} fps at scale ${r.hand.scale}`)
  if (r.notes?.length) console.log(`  notes  ${r.notes.join(' | ')}`)
  if (r.faults?.length) console.log(`  faults ${r.faults.join(' | ')}`)
}
