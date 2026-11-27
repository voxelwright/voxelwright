// SPIKE PROTOTYPE (#82, network optimizations). Not a check.
//
// A measured run (measure.mjs) played back under each proposed change, to count what would still be asked of the
// Worker: the requests are the run's own, only regrouped (an object in a pack counts once a pack) or dropped (a far
// tile past the radius). A MODEL built on a measurement: it does not know what a change would do to timing.
//
//   node probes/network-82/replay.mjs --release <built release dir> --log <measure.mjs output> [--squares 8] [--radius 6]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const run = JSON.parse(readFileSync(arg('log', ''), 'utf8')), far = JSON.parse(readFileSync(join(arg('release', ''), 'manifest.json'), 'utf8')).far
const k = Number(arg('squares', '8')), radius = Number(arg('radius', '6')), size = far.size
const WORKER_FIRST = (p) => p.startsWith('/releases/') || p.startsWith('/bay/') || p === '/weather'
const origin = new URL(run.url).origin
const rows = {}
for (const phase of Object.keys(run.summary).filter((p) => p.includes('-'))) {
  const poses = run.poses.filter((p) => p.phase === phase)
  const eyeAt = (t) => { if (!poses.length) return [far.landing.eye[0], far.landing.eye[2]]; const p = poses.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b)); return [p.at[0] * 10, p.at[2] * 10] }
  const reqs = run.log.filter((r) => r.phase === phase && !r.cached && new URL(r.url).origin === origin).map((r) => ({ ...r, path: new URL(r.url).pathname.replace(/^\/sf\//, '/') })).filter((r) => WORKER_FIRST(r.path))
  /** The requests left after a change: `group(r)` names what a request becomes part of (one request a name), null drops it, undefined leaves it alone. */
  const after = (list, group) => { const seen = new Set(), out = []; for (const r of list) { const g = group(r); if (g === undefined) out.push(r); else if (g !== null && !seen.has(g)) { seen.add(g); out.push({ ...r, path: g }) } } return out }
  const squareOf = (r, re, n) => { const m = re.exec(r.path); return m ? `${Math.floor(Number(m[1]) / n)}_${Math.floor(Number(m[2]) / n)}` : undefined }
  const steps = [
    ['1 heroes + squares in the page record', (r) => (/\/bay\/(heroes\.json|marks-squares\.bin)$/.test(r.path) ? null : undefined)],
    ['2 landing cut as one pack', (r) => (r.path.includes('/far/landing/') ? 'pack:landing' : undefined)],
    ['3 cars as one pack', (r) => (/\/cars\/[^/]+\.json$/.test(r.path) ? 'pack:cars' : undefined)],
    [`4 band 0 in ${k}x${k}-tile packs`, (r) => { const s = squareOf(r, /\/far\/0\/(\d+)_(\d+)\.far$/, k); return s && `pack:far0:${s}` }],
    ['5 names + life in 4 km packs', (r) => { const m = /\/(names|life)\/([\d.]+)_([\d.]+)\.json$/.exec(r.path); return m ? `pack:${m[1]}:${Math.floor(Number(m[2]) / 4)}_${Math.floor(Number(m[3]) / 4)}` : undefined }],
    [`6 far tiles past ${radius} km not asked for`, (r) => { const m = /\/far\/\d\/(\d+)_(\d+)\.far$/.exec(r.path) ?? /^pack:far0:(\d+)_(\d+)$/.exec(r.path); if (!m) return undefined; const pack = r.path.startsWith('pack:'), n = pack ? k : 1, [ex, ez] = eyeAt(r.start), x0 = Number(m[1]) * n * size, z0 = Number(m[2]) * n * size, d = Math.hypot(Math.max(x0 - ex, 0, ex - (x0 + n * size)), Math.max(z0 - ez, 0, ez - (z0 + n * size))) / 10_000; return d > radius ? null : undefined }],
  ]
  let list = reqs
  const row = (rows[phase] = { now: reqs.length })
  for (const [name, group] of steps) { list = after(list, group); row[name] = list.length }
  const left = {}
  for (const r of list) { const kind = r.path.startsWith('pack:') ? 'packs' : r.path.includes('/tiles/') ? 'tiles (.bay)' : r.path.includes('/far/') ? 'far bands 1-2' : r.path.includes('/bay/') ? 'bay' : 'other'; left[kind] = (left[kind] ?? 0) + 1 }
  row['what is left'] = Object.entries(left).map(([n, c]) => `${n} ${c}`).join(', ')
}
console.log(`Worker-first requests from the network, the run's own (${run.url}), then after each change in turn:`)
console.table(rows)
