// What blows cost on the path the world process runs (#138): Block.blow with the boom (ragged
// edge, lumps, loose pieces built as toys), the step after it, and the steps that follow while
// things fall. Headless. Usage: node test/voxel-blows.mjs [blows]
import { loadavg } from 'node:os'
import { createServer } from 'vite'

const blows = Number(process.argv[2] ?? 200)
const here = new URL('..', import.meta.url).pathname
const server = await createServer({ root: here, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const round = (x) => +x.toFixed(2)
// A seat may strike only so often by the clock: the clock is pushed on between blows, and times are read from the real one.
const real = performance.now.bind(performance)
let skew = 0
performance.now = () => real() + skew
try {
  const { Block } = await server.ssrLoadModule('/src/block.ts')
  const { planeAt, HALF_W } = await server.ssrLoadModule('/src/ground.ts')
  const block = await Block.make({ crates: 48, balls: 6, cell: 0.1 })
  const seat = block.join('Tester')
  for (let i = 0; i < 120; i++) block.step()
  const rss0 = process.memoryUsage().rss / 1e6
  let seed = 11
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) / 16777216 }
  const call = [], next = [], after = [], idle = [], slow = []
  let cuts = 0, added = 0, removed = 0, none = 0
  for (let i = 0; i < 60; i++) { const t = real(); block.step(); idle.push(real() - t) }
  for (let i = 0; i < blows; i++) {
    skew += 1000
    // A house front, a roof edge, the road or a pavement, anywhere along the block the tester can reach.
    const z = -27 + rnd() * 50, kind = rnd()
    const at = kind < 0.6 ? [(rnd() < 0.5 ? -1 : 1) * (HALF_W - 0.2), planeAt(z) + 0.5 + rnd() * 8, z] : [(rnd() * 2 - 1) * (HALF_W - 1), planeAt(z) - 0.1, z]
    let t = real()
    const did = block.blow(seat, at, 'boom')
    call.push(real() - t)
    if ('reason' in did) { none++; continue }
    cuts += did.cuts.length; added += did.added.length; removed += did.removed.length
    t = real(); block.step(); next.push(real() - t)
    let worst = next[next.length - 1], at20 = 0
    for (let k = 0; k < 20; k++) { t = real(); block.step(); const ms = real() - t; after.push(ms); if (ms > worst) { worst = ms; at20 = k + 1 } }
    if (worst > 40 && slow.length < 8) slow.push({ blow: i, ms: round(worst), step: at20, cuts: did.cuts.map((c) => c.thing), pieces: did.added.map((d) => d.toy.parts[0].cells.size.join('x')), awake: block.awake() })
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0) }
  const spread = (xs) => ({ p50: q(xs, 0.5), p95: q(xs, 0.95), p99: q(xs, 0.99), max: q(xs, 1) })
  console.log(JSON.stringify({ blows, refused: none, cuts, piecesAdded: added, piecesSwept: removed, idleStepMs: spread(idle), blowCallMs: spread(call), stepAfterBlowMs: spread(next), next20StepsMs: spread(after), rssMB: { before: round(rss0), after: round(process.memoryUsage().rss / 1e6) }, load1: round(loadavg()[0]) }))
  for (const s of slow) console.log('slow:', JSON.stringify(s))
  block.dispose()
} catch (e) { console.log('FAILED:', e?.stack?.split('\n').slice(0, 8).join('\n')); process.exitCode = 1 }
await server.close()
