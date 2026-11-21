// The paint and rails on San Francisco's roads (#450), from the city run's street graphs, its rails (sf/rails.py) and
// the colours OSM gives crossings (sf/crossing-colours.mjs); sf/build.mjs writes them as `bay/marks.bin` beside the
// tiles, and the page server (serve.mjs) the same for its own. The march draws them as lines (page/marks.ts); the core
// reads only the squares they cover, where the bake's own paint is not drawn (bay.rs `marks`).
//
//   node sf/marks.mjs <graph dir> <out.bin> [--tags sf/street-tags.json] [--colours sf/crossing-colours.json]
//
// What is drawn, by the graph alone:
//   - a double yellow line down the middle of a two-way street of the city's grid (primary, secondary, tertiary and
//     their links), unless a track runs down its middle (Powell has its cable car, no line);
//   - dashed white lines between lanes going one way, where the graph says how many lanes (not where it guessed one);
//   - each mapped crossing that is marked: continental bars (zebra, ladder, marked, yes) or two lines (lines), white,
//     or yellow or in a rainbow where OSM says so of its way or of a node it ends at (crossing-colours.json);
//   - every track's rails, by its gauge (street-tags.json): a cable car's 1067 mm apart with the cable's slot between, a
//     streetcar's 1435 mm. Without street-tags.json, the graph's own tracks (the cable cars' alone).
// Lanes are 3.3 m wide (sf/life.py, page/street.ts: the cars drive them), to the right of the line on a two-way street
// and either side of it on a one-way one.
//
// The file: little-endian int32 words, 'MARK', the count of squares covered and of segments, each square's x0, z0, x1,
// z1, then each segment's x0, z0, x1, z1 and style (cells of 10 cm, x east and z south of the frame's origin). A
// style's low four bits are STYLE, the next two its colour (COLOUR).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STYLE = { whiteLine: 1, whiteDash: 2, yellowDouble: 3, crossBars: 4, crossLines: 5, railsCable: 6, rails: 7 }
export const COLOUR = { white: 0, yellow: 1, rainbow: 2 }
const HERE = dirname(fileURLToPath(import.meta.url))
const LANE = 33
const GRID = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'])
// A square's name is its south-west corner in UTM 10N kilometres; the frame's origin is 500000 E, 4250000 N, z south.
const squareOf = (name) => { const [e, n] = name.split('_').map(Number); const x0 = Math.round((e * 1000 - 500000) * 10), z1 = Math.round((4250000 - n * 1000) * 10); return [x0, z1 - 10000, x0 + 10000, z1] }

/**
 * The marks of some squares' graphs: the squares they cover and the segments. `tags` is street-tags.json (tracks with
 * their gauge, the grid's ways and those apart from the street), `colours` crossing-colours.json.
 */
export function marksOf(graphs, { tags = null, colours = { ways: {}, nodes: {} } } = {}) {
  const wayOf = (r) => Number(r.id.split('/')[0]), grid = new Set(tags?.grid ?? []), apart = new Set(tags?.apart ?? [])
  const isGrid = (r) => GRID.has(r.highway) || grid.has(wayOf(r)), isApart = (r) => r.tunnel === 'yes' || r.bridge === 'yes' || apart.has(wayOf(r))
  const covers = graphs.map((g) => squareOf(g.square)), segs = [], seen = new Set()
  const add = (a, b, style) => segs.push([Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]), style])
  const roads = new Map()
  for (const g of graphs) for (const r of g.roads) if (!roads.has(r.id)) roads.set(r.id, r)
  const tracks = []
  if (tags) for (const t of tags.tracks) tracks.push(t)
  else for (const g of graphs) for (const t of g.tracks ?? []) if (!seen.has(`t${t.id}`)) { seen.add(`t${t.id}`); tracks.push({ ...t, gauge: 1067 }) }
  // Each piece of track by every square of 20 m its box covers (a piece between two of OSM's nodes runs to 287 m: filed
  // by where it starts alone, a centre line beside its far part found no track and was drawn over the rails).
  const near = new Map(), key = (x, z) => `${Math.floor(x / 200)}_${Math.floor(z / 200)}`
  for (const t of tracks) for (let i = 0; i + 1 < t.line.length; i++) {
    const [a, b] = [t.line[i], t.line[i + 1]]
    for (let gx = Math.floor(Math.min(a[0], b[0]) / 200); gx <= Math.floor(Math.max(a[0], b[0]) / 200); gx++) for (let gz = Math.floor(Math.min(a[1], b[1]) / 200); gz <= Math.floor(Math.max(a[1], b[1]) / 200); gz++) {
      const k = `${gx}_${gz}`
      if (!near.has(k)) near.set(k, [])
      near.get(k).push([a, b])
    }
  }
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
    if (l < 5 || isApart(r)) continue
    const right = [-dz / l, dx / l], both = directions.get(pair(r)) > 1, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const shift = (p, by) => [p[0] + right[0] * by, p[1] + right[1] * by]
    // The middle once a street: from the direction whose first node is the lesser, every 5 m of it clear of rails (a
    // way 123 m long had rails along 37 m of it, and its middle was clear of them).
    if (both && isGrid(r) && r.nodes[0] < r.nodes[1]) {
      const n = Math.max(1, Math.ceil(l / 50)), at = (k) => [a[0] + (dx * k) / n, a[1] + (dz * k) / n]
      let from = null
      for (let k = 0; k <= n; k++) {
        const clear = trackNear(at(k)) > 25 && (k === n || trackNear(at(k + 0.5)) > 25)
        if (clear && from === null) from = k
        if ((!clear || k === n) && from !== null) { const to = clear ? k : k - 1; if (to > from) add(at(from), at(to), STYLE.yellowDouble); from = null }
      }
    }
    const n = r.lanesInferred ? 1 : r.lanes
    for (let k = 1; k < n; k++) { const off = both ? k * LANE : (k - n / 2) * LANE; add(shift(a, off), shift(b, off), STYLE.whiteDash) }
  }
  for (const g of graphs) for (const c of g.crossings ?? []) {
    if (seen.has(`c${c.id}`)) continue
    seen.add(`c${c.id}`)
    let style = ['zebra', 'ladder', 'marked', 'yes', 'zebra:bicolour', 'ladder:skewed', 'ladder:paired', 'zebra:paired'].includes(c.markings) ? STYLE.crossBars : c.markings === 'lines' ? STYLE.crossLines : 0
    const colour = colours.ways[c.id.split('/')[0]] ?? colours.nodes[c.nodes[0]] ?? colours.nodes[c.nodes[1]]
    // A rainbow crossing is six bands of colour, whatever its markings tag says of its lines.
    if (colour === 'rainbow' && style) style = STYLE.crossBars
    if (style && Math.hypot(c.line[1][0] - c.line[0][0], c.line[1][1] - c.line[0][1]) >= 20) add(c.line[0], c.line[c.line.length - 1], style | ((COLOUR[colour] ?? 0) << 4))
  }
  // The rails of the squares covered (street-tags.json holds the whole city's).
  const inside = (p) => covers.some((c) => p[0] >= c[0] - 50 && p[1] >= c[1] - 50 && p[0] < c[2] + 50 && p[1] < c[3] + 50)
  for (const t of tracks) {
    const style = t.gauge === 1067 ? STYLE.railsCable : STYLE.rails
    for (let i = 0; i + 1 < t.line.length; i++) if ((t.line[i][0] !== t.line[i + 1][0] || t.line[i][1] !== t.line[i + 1][1]) && (inside(t.line[i]) || inside(t.line[i + 1]))) add(t.line[i], t.line[i + 1], style)
  }
  return { covers, segs }
}

/** The marks of every graph in a folder, with the rails and crossing colours the repo keeps (sf/street-tags.json, sf/crossing-colours.json). */
export function marksIn(dir, tags = join(HERE, 'street-tags.json'), colours = join(HERE, 'crossing-colours.json')) {
  const graphs = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  return marksOf(graphs, { tags: JSON.parse(readFileSync(tags, 'utf8')), colours: JSON.parse(readFileSync(colours, 'utf8')) })
}

/** What some marks hold, in words: squares, segments and each style's count. */
export function said(bytes) {
  const w = new Int32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), nc = w[1], ns = w[2], by = {}
  for (let i = 0; i < ns; i++) { const s = w[3 + nc * 4 + i * 5 + 4], name = `${Object.keys(STYLE).find((k) => STYLE[k] === (s & 15))}${s >> 4 ? '/' + Object.keys(COLOUR)[s >> 4] : ''}`; by[name] = (by[name] ?? 0) + 1 }
  return `${nc} squares, ${ns} segments, ${bytes.length} bytes ${JSON.stringify(by)}`
}

/** The squares some marks cover, with no segments (marks-squares.bin): all the core reads (bay.rs `marks`). */
export const squaresBytes = (m) => marksBytes({ covers: m.covers, segs: [] })

/** The marks as the core takes them (bay.rs `marks`). */
export function marksBytes({ covers, segs }) {
  const w = new Int32Array(3 + covers.length * 4 + segs.length * 5)
  w.set([0x4b52414d, covers.length, segs.length])
  covers.forEach((c, i) => w.set(c, 3 + i * 4))
  segs.forEach((s, i) => w.set(s, 3 + covers.length * 4 + i * 5))
  return Buffer.from(w.buffer)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [dir, out] = process.argv.slice(2), opt = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
  const bytes = marksBytes(marksIn(dir, opt('tags', join(HERE, 'street-tags.json')), opt('colours', join(HERE, 'crossing-colours.json'))))
  writeFileSync(out, bytes)
  console.log(`  marks: ${said(bytes)}`)
}
