// The paint and rails on San Francisco's roads (#450), from the street graph the release holds (sf/build.mjs copies
// it as `bay/marks.bin` beside the tiles): the core draws them in the road's top cell at 10 cm (bay.rs `marks`).
//
//   node sf/marks.mjs <graph dir> <out.bin>
//
// What is drawn, by the graph alone:
//   - a double yellow line down the middle of a two-way street of the city's grid (primary, secondary, tertiary and
//     their links), unless a track runs down its middle (Powell has its cable car, no line);
//   - dashed white lines between lanes going one way, where the graph says how many lanes (not where it guessed one);
//   - each mapped crossing that is marked: continental bars (zebra, ladder, marked, yes) or two lines (lines);
//   - every track's rails, a cable car's 1067 mm apart with the cable's slot between, a streetcar's 1435 mm.
// Lanes are 3.3 m wide (sf/life.py, page/street.ts: the cars drive them), to the right of the line on a two-way street
// and either side of it on a one-way one.
//
// The file: little-endian int32 words, 'MARK', the count of squares covered and of segments, each square's x0, z0, x1,
// z1, then each segment's x0, z0, x1, z1 and style (cells of 10 cm, x east and z south of the frame's origin).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STYLE = { whiteLine: 1, whiteDash: 2, yellowDouble: 3, crossBars: 4, crossLines: 5, railsCable: 6, rails: 7 }
const LANE = 33
const GRID = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'])
const CABLE = /^(Powell|Mason|Hyde|California|Jackson|Washington|Taylor) Street$/
// A square's name is its south-west corner in UTM 10N kilometres; the frame's origin is 500000 E, 4250000 N, z south.
const squareOf = (name) => { const [e, n] = name.split('_').map(Number); const x0 = Math.round((e * 1000 - 500000) * 10), z1 = Math.round((4250000 - n * 1000) * 10); return [x0, z1 - 10000, x0 + 10000, z1] }

/** The marks of some squares' graphs: the squares they cover and the segments. */
export function marksOf(graphs) {
  const covers = graphs.map((g) => squareOf(g.square)), segs = [], seen = new Set()
  const add = (a, b, style) => segs.push([Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), style])
  const roads = new Map()
  for (const g of graphs) for (const r of g.roads) if (!roads.has(r.id)) roads.set(r.id, r)
  const tracks = []
  for (const g of graphs) for (const t of g.tracks ?? []) if (!seen.has(`t${t.id}`)) { seen.add(`t${t.id}`); tracks.push(t) }
  // Each piece of track by the square of 20 m it starts in.
  const near = new Map(), key = (x, z) => `${Math.floor(x / 200)}_${Math.floor(z / 200)}`
  for (const t of tracks) for (let i = 0; i + 1 < t.line.length; i++) { const k = key(...t.line[i]); if (!near.has(k)) near.set(k, []); near.get(k).push([t.line[i], t.line[i + 1]]) }
  /** How far a point is from the nearest track, in cells (to 40). */
  const trackNear = (p) => {
    let best = 40
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [a, b] of near.get(key(p[0] + i * 200, p[1] + j * 200)) ?? []) {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz
      const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dz * u))
    }
    return best
  }
  const pair = (r) => `${Math.min(...r.nodes)}/${Math.max(...r.nodes)}`
  const directions = new Map()
  for (const r of roads.values()) { const k = pair(r); directions.set(k, (directions.get(k) ?? 0) + 1) }
  for (const r of roads.values()) {
    const [a, b] = r.line, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz)
    if (l < 5 || r.tunnel === 'yes' || r.bridge === 'yes') continue
    const right = [-dz / l, dx / l], both = directions.get(pair(r)) > 1, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const shift = (p, by) => [p[0] + right[0] * by, p[1] + right[1] * by]
    // The middle once a street: from the direction whose first node is the lesser.
    if (both && GRID.has(r.highway) && r.nodes[0] < r.nodes[1] && trackNear(mid) > 25) add(a, b, STYLE.yellowDouble)
    const n = r.lanesInferred ? 1 : r.lanes
    for (let k = 1; k < n; k++) { const off = both ? k * LANE : (k - n / 2) * LANE; add(shift(a, off), shift(b, off), STYLE.whiteDash) }
  }
  for (const g of graphs) for (const c of g.crossings ?? []) {
    if (seen.has(`c${c.id}`)) continue
    seen.add(`c${c.id}`)
    const style = ['zebra', 'ladder', 'marked', 'yes'].includes(c.markings) ? STYLE.crossBars : c.markings === 'lines' ? STYLE.crossLines : 0
    if (style && Math.hypot(c.line[1][0] - c.line[0][0], c.line[1][1] - c.line[0][1]) >= 20) add(c.line[0], c.line[c.line.length - 1], style)
  }
  for (const t of tracks) {
    // Which: by the street it runs in.
    let name = '', best = Infinity
    const m = t.line[Math.floor(t.line.length / 2)]
    for (const r of roads.values()) { const [a, b] = r.line, d = Math.hypot((a[0] + b[0]) / 2 - m[0], (a[1] + b[1]) / 2 - m[1]); if (d < best) { best = d; name = r.name } }
    const style = CABLE.test(name) ? STYLE.railsCable : STYLE.rails
    for (let i = 0; i + 1 < t.line.length; i++) if (t.line[i][0] !== t.line[i + 1][0] || t.line[i][1] !== t.line[i + 1][1]) add(t.line[i], t.line[i + 1], style)
  }
  return { covers, segs }
}

/** The marks as the core takes them (bay.rs `marks`). */
export function marksBytes({ covers, segs }) {
  const w = new Int32Array(3 + covers.length * 4 + segs.length * 5)
  w.set([0x4b52414d, covers.length, segs.length])
  covers.forEach((c, i) => w.set(c, 3 + i * 4))
  segs.forEach((s, i) => w.set(s, 3 + covers.length * 4 + i * 5))
  return Buffer.from(w.buffer)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [dir, out] = process.argv.slice(2)
  const m = marksOf(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))))
  writeFileSync(out, marksBytes(m))
  const by = {}
  for (const s of m.segs) by[s[4]] = (by[s[4]] ?? 0) + 1
  console.log(`  marks: ${m.covers.length} squares, ${m.segs.length} segments`, JSON.stringify(Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, by[v] ?? 0]))))
}
