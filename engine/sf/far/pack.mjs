// Packs far-model faces into the release's far tiles (#450): the city past the cell tiles' reach, drawn by
// page/far.ts. The faces are #423's (page/matte.ts on PR 433, 20 bytes each), from two kinds of source:
//   - a place: #423's Ina wedge as landing/ina/matte.py baked it (`ina-all`: every side of every column, with
//     colours fitted to the photograph, the church's towers as solids, Salesforce Tower and the Bay Bridge by rule);
//   - squares: sf/far/bake.py's, one folder a square, from the data lane's archives.
//
//   node sf/far/pack.mjs [--out ~/.village/engine/sf/far/release] [--place <ina-all>] [--squares ~/.village/engine/sf/far/squares]
//                        [--wedge e,n,from,to,far]
//
// Writes <out>/far.json and <out>/far/<band>/<x>_<z>.far:
//   - far.json is the manifest's `far` object as asked of the data lane on #450: `size` (a tile's side in 10 cm cells,
//     on the frame's grid), `bands` (the least size of a face in each band, metres), `tiles` (key `x_z`, a record or
//     null per band: {path, bytes, sha256} over the bytes as written), `wedge` (the place's: its apex in cells, the
//     bearings it lies between and its reach in metres), `light` (the fill and gain the place's colours were fitted
//     under); far.state.json says what each tile was made from.
//   - A tile's band holds the faces whose low corner is in the tile and whose size (metres, the geometric mean of
//     its sides) is in the band. A far tile is fetched only for band 0, nearer ones add the rest.
//   - A `.far` file: 'FAR1', a u32 length, that many bytes of JSON (spaces to a multiple of 4), then the faces with
//     each of their 20 bytes grouped (all faces' byte 0, then all byte 1, ...), which Brotli packs better. The JSON
//     says the sections: faces in one frame (where its corner is, its cell, its turn), their range and bounds in the
//     world's cells, in runs by which way they look (1 up, 2 to 5 the walls), each run biggest first with how many of
//     its faces are at least each of `lods` metres across.
//
// One owner a place: the wedge's faces inside it, the squares' outside. A tile the wedge holds whole is the place's;
// one it holds in part takes both, each face by where its middle is: the tiles round the landing's eye are in part,
// and with the squares' metre cells there the foreground was coarser than the march's own. A tile with no squares is
// the place's. Incremental: a tile whose sources are as they were (owner, files, sizes, times) is kept as it is, so
// the far model grows square by square as the city's run finishes them.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const FAR = join(homedir(), '.village', 'engine', 'sf', 'far')
const out = arg('out', join(FAR, 'release'))
const placeDir = arg('place', join(homedir(), '.village', 'engine', 'landing', 'ina', 'home', '.village', 'engine', 'place', 'ina-all'))
const squaresDir = arg('squares', join(FAR, 'squares'))
const heroesDir = arg('heroes', join(FAR, 'heroes'))
// The wedge (landing/ina/place.py): its apex in UTM, the bearings it lies between, how far it reaches (metres). The
// apex is the place's own: matte.py measures its wedge from the solved camera (its index's `camera`), not the
// photograph's geotag, and between the two a sliver along the edge had neither the place's faces nor the squares'.
let [we, wn, wfrom, wto, wfar] = arg('wedge', '551634.8,4183590.6,87,152,3300').split(',').map(Number)
const E0 = 500_000, N0 = 4_250_000

/** A tile's side, in 10 cm cells: 500 m. */
export const SIZE = 5000
/** The least size of a face in each band, metres. */
export const BANDS = [4, 1, 0]
/** The sizes a section counts its faces down to, metres: the page draws only those a pixel or so across. */
export const LODS = [16, 8, 4, 2, 1, 0.5, 0.25]

// ── Sources: every block, its frame, and the tiles it may hold faces of (from its bounds, without reading it) ──
const blocks = []
const meta = { styles: null, sun: null, light: null, credits: [] }
const read = (dir, owner) => {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const turn = ((index.turn ?? 0) * Math.PI) / 180
  for (const b of index.blocks) {
    const c0 = b.c0 ?? [Math.cos(turn), 0, -Math.sin(turn)], c2 = b.c2 ?? [Math.sin(turn), 0, Math.cos(turn)], st = statSync(join(dir, b.file))
    const xs = [], zs = []
    for (const u of [0, b.size[0]]) for (const w of [0, b.size[2]]) { xs.push(b.pos[0] + (c0[0] * u + c2[0] * w) * b.cell); zs.push(b.pos[2] + (c0[2] * u + c2[2] * w) * b.cell) }
    const tiles = []
    if (b.tile) tiles.push(b.tile)
    else for (let x = Math.floor(Math.min(...xs) / SIZE); x <= Math.floor(Math.max(...xs) / SIZE); x++) for (let z = Math.floor(Math.min(...zs) / SIZE); z <= Math.floor(Math.max(...zs) / SIZE); z++) tiles.push(`${x}_${z}`)
    blocks.push({ owner, path: join(dir, b.file), faces: b.faces, layer: b.layer, frame: { pos: b.pos, cell: b.cell, c0, c2, uw: b.uw ?? [0, 0] }, tiles, sign: `${dir}/${b.file}:${st.size}:${Math.round(st.mtimeMs)}` })
  }
  meta.styles ??= index.styles
  if (owner === 'place') { meta.sun = index.sun; meta.light = index.light ?? null }
  if (index.credit && !meta.credits.includes(index.credit)) meta.credits.push(index.credit)
}
if (existsSync(join(placeDir, 'index.json'))) {
  read(placeDir, 'place')
  const at = JSON.parse(readFileSync(join(placeDir, 'index.json'), 'utf8')).camera?.at
  if (at && !arg('wedge', null)) { we = E0 + at[0]; wn = N0 - at[2] }
}
const squares = existsSync(squaresDir) ? readdirSync(squaresDir).filter((d) => existsSync(join(squaresDir, d, 'index.json'))).sort() : []
for (const d of squares) read(join(squaresDir, d), 'squares')
// Landmarks by rule (sf/far/heroes.mjs): drawn whoever owns the tile; where a rule owns its place (heroes.rs `owns`),
// the lidar's faces there are left out, so the two are never drawn together.
const heroes = existsSync(join(heroesDir, 'index.json')) ? JSON.parse(readFileSync(join(heroesDir, 'index.json'), 'utf8')) : null
if (heroes) read(heroesDir, 'hero')
const core = heroes ? (await WebAssembly.instantiate(readFileSync(new URL('../../page/core.wasm', import.meta.url)), {})).instance.exports : null
const stands = (heroes?.stands ?? []).map((h) => {
  const [u0, , w0, u1, , w1] = h.reach, c = Math.cos(h.turn), sn = Math.sin(h.turn), xs = [], zs = []
  for (const u of [u0, u1]) for (const w of [w0, w1]) { xs.push(h.at[0] + (u * c - w * sn) * 10); zs.push(h.at[1] + (u * sn + w * c) * 10) }
  return { ...h, cos: c, sin: sn, lo: [Math.min(...xs), Math.min(...zs)], hi: [Math.max(...xs), Math.max(...zs)] }
})
/** Whether a landmark's rule owns the place at (x, z), in cells. */
const ruled = (x, z) => stands.some((h) => x >= h.lo[0] && x <= h.hi[0] && z >= h.lo[1] && z <= h.hi[1] && (() => { const dx = x - h.at[0], dz = z - h.at[1]; return core.hero_owns(h.sort, (dx * h.cos + dz * h.sin) * 0.1, (dz * h.cos - dx * h.sin) * 0.1) === 1 })())
/** The tiles a landmark's box reaches: packed again when the rules change. */
const ruledTiles = new Set(stands.flatMap((h) => { const t = []; for (let x = Math.floor(h.lo[0] / SIZE); x <= Math.floor(h.hi[0] / SIZE); x++) for (let z = Math.floor(h.lo[1] / SIZE); z <= Math.floor(h.hi[1] / SIZE); z++) t.push(`${x}_${z}`); return t }))

// ── One owner a tile ──
const inWedge = (x, z) => {
  const de = x / 10 + E0 - we, dn = N0 - z / 10 - wn, bearing = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360
  return Math.hypot(de, dn) < wfar && bearing > wfrom && bearing < wto
}
const by = new Map()
for (const [i, b] of blocks.entries()) for (const t of b.tiles) { let l = by.get(t); if (!l) by.set(t, (l = [])); l.push(i) }
const owner = new Map()
for (const [key, list] of by) {
  const kinds = new Set(list.map((i) => blocks[i].owner).filter((o) => o !== 'hero'))
  const [x, z] = key.split('_').map(Number)
  const whole = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, c]) => inWedge((x + a) * SIZE, (z + c) * SIZE))
  owner.set(key, !kinds.size ? 'hero' : !kinds.has('place') ? 'squares' : whole || !kinds.has('squares') ? 'place' : 'both')
}
/** Whether a tile's owner takes a block's faces (`both`: the place's in the wedge, the squares' out of it). */
const takes = (key, from) => from === 'hero' || owner.get(key) === from || (owner.get(key) === 'both' && from !== 'hero')
/** What a tile is made from: its owner's blocks that may hold its faces. */
const sourcesOf = (key) => by.get(key).filter((i) => takes(key, blocks[i].owner))
const sign = (key) => createHash('sha256').update(`${PACKED}\n${owner.get(key)}${owner.get(key) === 'both' ? ` ${we} ${wn} ${wfrom} ${wto} ${wfar}` : ''}\n${ruledTiles.has(key) ? heroes.rules : ''}\n${sourcesOf(key).map((i) => blocks[i].sign).join('\n')}`).digest('hex').slice(0, 20)

// ── What changed since the last packing ──
const before = existsSync(join(out, 'far.json')) && existsSync(join(out, 'far.state.json')) ? { ...JSON.parse(readFileSync(join(out, 'far.json'), 'utf8')), sources: JSON.parse(readFileSync(join(out, 'far.state.json'), 'utf8')) } : null
/** How this packs a tile (the FAR1 object's own layout): raised when it changes, so every tile is packed again. */
const PACKED = 5
// The listing is the release manifest's `far` (engine/sf/release.md, version 1); what each tile was made from is
// kept beside it in far.state.json, for packing again only what changed.
const listing = { version: 1, size: SIZE, bands: BANDS, lods: LODS, tiles: {} }
const sources = {}
const todo = []
for (const key of [...by.keys()].sort()) {
  const s = sign(key)
  sources[key] = s
  // As it was: its records, or none where its sources held no face of it.
  if (before?.sources?.[key] === s) {
    const was = before.tiles[key]
    if (!was || was.every((r) => !r || existsSync(join(out, r.path)))) { if (was) listing.tiles[key] = was; continue }
  }
  todo.push(key)
}
for (const key of Object.keys(before?.tiles ?? {})) if (!by.has(key)) for (const r of before.tiles[key]) if (r) rmSync(join(out, r.path), { force: true })

/** A face's corners in its block's cells, its low and high y (10 cm), which way it lies, its two sides. */
const extent = (w0, w1, w2) => {
  const x = w0 & 0x7ff, z = (w0 >>> 11) & 0x7ff, lu = w0 >>> 22, lw = w2 & 0x3ff, axis = (w2 >>> 10) & 3
  const [x0, x1, z0, z1] = axis === 0 ? [x, x + lu, z, z + lw] : axis === 1 ? [x, x + 1, z, z + lw] : [x, x + lu, z, z + 1]
  return { x0, x1, z0, z1, y0: axis === 0 ? w1 >>> 16 : w1 & 0xffff, y1: w1 >>> 16, axis, lu, lw }
}
/** Its size in metres: a top's sides, a wall's length and height. */
const sizeOf = (e, cell) => e.axis === 0 ? Math.sqrt(e.lu * e.lw) * cell / 10 : Math.sqrt((e.axis === 1 ? e.lw : e.lu) * cell / 10 * Math.max(0.1, (e.y1 - e.y0) / 10))

// ── Packing the changed tiles, a batch at a time (a batch reads each block it needs once) ──
const BATCH = 48
let faces = 0, bytes = 0
const words = new Map()
const wordsOf = (i) => {
  let w = words.get(i)
  if (!w) {
    const raw = readFileSync(blocks[i].path)
    if (raw.length !== blocks[i].faces * 20) throw new Error(`${blocks[i].path}: ${raw.length} bytes for ${blocks[i].faces} faces`)
    words.set(i, (w = new Uint32Array(raw.buffer, raw.byteOffset, raw.length / 4)))
  }
  return w
}
for (let at = 0; at < todo.length; at += BATCH) {
  const batch = new Set(todo.slice(at, at + BATCH))
  /** key -> band -> block -> [face, size] */
  const sorted = new Map([...batch].map((k) => [k, BANDS.map(() => new Map())]))
  const need = new Set([...batch].flatMap(sourcesOf))
  words.clear()
  for (const i of need) {
    const b = blocks[i], w = wordsOf(i), { pos, cell, c0, c2 } = b.frame
    for (let f = 0; f < b.faces; f++) {
      const e = extent(w[f * 5], w[f * 5 + 1], w[f * 5 + 2])
      const wx = pos[0] + (c0[0] * e.x0 + c2[0] * e.z0) * cell, wz = pos[2] + (c0[2] * e.x0 + c2[2] * e.z0) * cell
      const key = `${Math.floor(wx / SIZE)}_${Math.floor(wz / SIZE)}`
      if (!batch.has(key) || !takes(key, b.owner)) continue
      // Where the place and the squares share a tile, a face whose middle is in the wedge is the place's, else the squares'
      // (the place's land past the lidar is out of the wedge).
      if (owner.get(key) === 'both' && b.owner !== 'hero' && (b.owner === 'place') !== inWedge(pos[0] + (c0[0] * (e.x0 + e.x1) + c2[0] * (e.z0 + e.z1)) * cell / 2, pos[2] + (c0[2] * (e.x0 + e.x1) + c2[2] * (e.z0 + e.z1)) * cell / 2)) continue
      // Under a landmark whose rule owns its place, the lidar's columns of it are not drawn (its ground is), nor is
      // anything else but a rule's own faces (the wedge's landmarks are layer 'hero' too).
      if (b.owner !== 'hero' && b.layer !== 'hero' && !b.layer.startsWith('ground') && ruledTiles.has(key) && ruled(pos[0] + (c0[0] * (e.x0 + e.x1) + c2[0] * (e.z0 + e.z1)) * cell / 2, pos[2] + (c0[2] * (e.x0 + e.x1) + c2[2] * (e.z0 + e.z1)) * cell / 2)) continue
      // The sea is the march's to draw: bare ground no higher than a metre over it is where the lidar had a return off
      // the water (matte.py and bake.py take that for land), and it drew grey bands across the Bay.
      if (b.layer.startsWith('ground') && pos[1] + e.y1 <= 10) continue
      // A landmark's faces are drawn as far as its tile is: a lattice tower 300 m tall is made of thin bars, each one
      // under a pixel from across the city, that together are what one sees of it.
      const size = b.owner === 'hero' ? LODS[0] : sizeOf(e, cell), band = BANDS.findIndex((least) => size >= least)
      const t = sorted.get(key)[band]
      let l = t.get(i)
      if (!l) t.set(i, (l = []))
      l.push([f, size])
    }
  }
  for (const key of batch) {
    const record = []
    for (const [band, perBlock] of sorted.get(key).entries()) {
      const sections = [], chunks = []
      let start = 0
      for (const [i, list] of perBlock) {
        const b = blocks[i], w = wordsOf(i), { pos, cell, c0, c2 } = b.frame
        // By which way a face looks (1 up, 2 to 5 the walls: a run the eye is behind is not drawn at all), then biggest
        // first, so that a far tile draws a prefix of each run (the site's prepare-city.mjs); the bake's order among equals.
        const way = (f) => { const w2 = w[f * 5 + 2], axis = (w2 >>> 10) & 3; return axis === 0 ? 1 : 2 + (axis - 1) * 2 + ((w2 >>> 12) & 1) }
        for (const e of list) e.push(way(e[0]))
        list.sort((p, q) => p[2] - q[2] || q[1] - p[1] || p[0] - q[0])
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], run = new Uint32Array(list.length * 5)
        for (const [k, [f]] of list.entries()) {
          run.set(w.subarray(f * 5, f * 5 + 5), k * 5)
          const e = extent(w[f * 5], w[f * 5 + 1], w[f * 5 + 2])
          lo[1] = Math.min(lo[1], pos[1] + e.y0); hi[1] = Math.max(hi[1], pos[1] + e.y1)
          for (const px of [e.x0, e.x1]) for (const pz of [e.z0, e.z1]) for (const a of [0, 2]) {
            const v = pos[a] + (c0[a] * px + c2[a] * pz) * cell
            lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v)
          }
        }
        const runs = []
        for (let k = 0; k < list.length;) {
          let end = k
          while (end < list.length && list[end][2] === list[k][2]) end++
          const lods = LODS.map((least) => { let n = k; while (n < end && list[n][1] >= least) n++; return n - k })
          runs.push({ way: list[k][2], start: start + k, count: end - k, lods })
          k = end
        }
        sections.push({ layer: b.layer, pos, cell, c0, c2, uw: b.frame.uw, start, count: list.length, runs, lo: lo.map(Math.floor), hi: hi.map(Math.ceil) })
        chunks.push(run)
        start += list.length
      }
      if (!start) { record.push(null); continue }
      const all = new Uint8Array(start * 20)
      let o = 0
      for (const c of chunks) { all.set(new Uint8Array(c.buffer), o); o += c.byteLength }
      // Each of a face's 20 bytes grouped: byte j of face i at j * n + i.
      const grouped = new Uint8Array(all.length)
      for (let i = 0; i < start; i++) for (let j = 0; j < 20; j++) grouped[j * start + i] = all[i * 20 + j]
      let head = Buffer.from(JSON.stringify({ version: 1, sections, styles: meta.styles, sun: ['place', 'both'].includes(owner.get(key)) ? meta.sun : null, grouped: true }))
      head = Buffer.concat([head, Buffer.alloc((4 - (head.length % 4)) % 4, 32)])
      const body = Buffer.concat([Buffer.from('FAR1'), Buffer.from(new Uint32Array([head.length]).buffer), head, grouped])
      const path = `far/${band}/${key}.far`
      mkdirSync(join(out, 'far', String(band)), { recursive: true })
      writeFileSync(join(out, path), body)
      record.push({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
      faces += start
      bytes += body.length
    }
    for (const [band, r] of record.entries()) if (!r) rmSync(join(out, 'far', String(band), `${key}.far`), { force: true })
    if (record.some(Boolean)) listing.tiles[key] = record
  }
}
listing.credit = [...new Set(meta.credits.flatMap((c) => c.split('; ')))].join('; ')
// Where the place's faces are (page/far.ts takes over from the cells nearer there): its apex in cells, its bearings, its reach.
// The light the place's colours were fitted under (#423's light.json), for page/far.ts to draw every face in.
if (meta.light) listing.light = meta.light
if (blocks.some((b) => b.owner === 'place')) listing.wedge = { at: [Math.round((we - E0) * 10), Math.round((N0 - wn) * 10)], from: wfrom, to: wto, far: wfar }
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'far.state.json'), JSON.stringify(sources))
writeFileSync(join(out, 'far.json.part'), JSON.stringify(listing))
writeFileSync(join(out, 'far.json'), readFileSync(join(out, 'far.json.part')))
rmSync(join(out, 'far.json.part'))
const owned = [...owner.values()].reduce((n, o) => ({ ...n, [o]: (n[o] ?? 0) + 1 }), {})
console.log(`${todo.length} of ${by.size} tiles packed again (${faces} faces, ${(bytes / 1048576).toFixed(1)} MB); ${Object.keys(listing.tiles).length} tiles listed; owners ${JSON.stringify(owned)}; ${squares.length} squares`)
