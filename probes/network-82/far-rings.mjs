// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`.
//
// Where the far model's requests go, by distance from the eye and by whether the tile was in front of it.
//   static:   node probes/network-82/far-rings.mjs --release <built release dir>            (what the release lists, from the landing's eye)
//   measured: node probes/network-82/far-rings.mjs --release <dir> --log <measure.mjs output> [--phase cold-explore]
// A tile is 500 m square (far.size = 5000 cells of 10 cm). "In view" here is the horizontal wedge of the lens at
// 16:9, widened by the tile's own half-diagonal: far.ts tests the whole box against the frustum, so this is close,
// not exact.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const release = arg('release', null), logAt = arg('log', null), phase = arg('phase', 'cold-explore')
const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')), far = manifest.far, size = far.size
const RINGS = [1, 2, 3, 4, 6, 8, 10, 12, 16, Infinity]
const ringOf = (km) => RINGS.findIndex((r) => km <= r), label = (i) => (i === 0 ? `0-${RINGS[0]} km` : RINGS[i] === Infinity ? `>${RINGS[i - 1]} km` : `${RINGS[i - 1]}-${RINGS[i]} km`)
const brOf = (path) => { try { return statSync(join(release, `${path}.br`)).size } catch { return 0 } }
/** How far a tile's box is from a point on the ground, km (as far.ts `away`, without height). */
const away = (x, z, key) => { const [tx, tz] = key.split('_').map(Number); return Math.hypot(Math.max(tx * size - x, 0, x - (tx + 1) * size), Math.max(tz * size - z, 0, z - (tz + 1) * size)) / 10_000 }
const kb = (n) => Math.round(n / 1024)

if (!logAt) {
  const [ex, , ez] = far.landing.eye
  const rows = RINGS.map((_, i) => ({ ring: label(i), tiles: 0, 'band0 files': 0, 'band0 KB': 0, 'band1 files': 0, 'band1 KB': 0, 'band2 files': 0, 'band2 KB': 0 }))
  for (const [key, recs] of Object.entries(far.tiles)) {
    const row = rows[ringOf(away(ex, ez, key))]
    row.tiles++
    recs.forEach((rec, band) => { if (rec) { row[`band${band} files`]++; row[`band${band} KB`] += brOf(rec.path) / 1024 } })
  }
  for (const r of rows) for (const k of Object.keys(r)) if (k.endsWith('KB')) r[k] = Math.round(r[k])
  console.log(`what the release lists, by distance from the landing's eye (bands hold faces of ${far.bands.join(', ')} m and up; .br bytes)`)
  console.table(rows)
  let n = 0, bytes = 0
  console.log('cumulative: every band-0 file within a radius (what `FURTHEST` bounds once the eye has left the landing)')
  console.table(RINGS.map((r, i) => { n += rows[i]['band0 files']; bytes += rows[i]['band0 KB']; return { within: r === Infinity ? 'all' : `${r} km`, 'band0 files': n, 'band0 MB': Math.round(bytes / 102.4) / 10 } }))
} else {
  const run = JSON.parse(readFileSync(logAt, 'utf8')), poses = run.poses.filter((p) => p.phase === phase)
  const reqs = run.log.filter((r) => r.phase === phase && /\/far\/\d\//.test(r.url) && !r.cached)
  const poseAt = (t) => poses.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), poses[0])
  const rows = RINGS.map((_, i) => ({ ring: label(i), requests: 0, 'in view': 0, 'out of view': 0, 'wire KB': 0, 'out-of-view KB': 0 }))
  const bands = [0, 0, 0]
  for (const r of reqs) {
    // (engine.pose is in metres; the far model's tiles are in cells of 10 cm.)
    const [, band, key] = /\/far\/(\d)\/(\d+_\d+)\.far/.exec(r.url), p = poseAt(r.start), x = p.at[0] * 10, z = p.at[2] * 10
    const [tx, tz] = key.split('_').map(Number), cx = (tx + 0.5) * size - x, cz = (tz + 0.5) * size - z, d = Math.hypot(cx, cz)
    // The eye looks along (sin yaw, -cos yaw) on the ground (far.ts `cutLook`); the lens is `fov` degrees tall.
    const half = Math.atan(Math.tan(((p.fov ?? 60) * Math.PI) / 360) * (16 / 9)), off = Math.acos(Math.max(-1, Math.min(1, (cx * Math.sin(p.yaw) - cz * Math.cos(p.yaw)) / (d || 1))))
    const seen = d < size || off < half + Math.atan2(size * 0.71, d)
    const row = rows[ringOf(away(x, z, key))]
    row.requests++; row[seen ? 'in view' : 'out of view']++; row['wire KB'] += r.wire / 1024; if (!seen) row['out-of-view KB'] += r.wire / 1024
    bands[Number(band)]++
  }
  for (const r of rows) { r['wire KB'] = kb(r['wire KB'] * 1024); r['out-of-view KB'] = kb(r['out-of-view KB'] * 1024) }
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0)
  console.log(`${phase}: ${reqs.length} far-band requests from the network (band 0: ${bands[0]}, band 1: ${bands[1]}, band 2: ${bands[2]}), ${poses.length} poses`)
  console.table(rows)
  console.log(`out of view: ${sum('out of view')} of ${sum('requests')} requests (${Math.round((sum('out of view') / sum('requests')) * 100)}%), ${sum('out-of-view KB')} of ${sum('wire KB')} KB`)
  const beyond = (km) => rows.filter((_, i) => (RINGS[i - 1] ?? 0) >= km)
  for (const km of [3, 6, 10]) console.log(`beyond ${km} km: ${beyond(km).reduce((n, r) => n + r.requests, 0)} requests, ${beyond(km).reduce((n, r) => n + r['wire KB'], 0)} KB`)
}
