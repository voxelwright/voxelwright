// Packs far-model faces into the release's far tiles (#450): the city past the cell tiles' reach, drawn by
// page/far.ts. The faces are #423's (page/matte.ts, 20 bytes each). Their sources are a place baked by
// landing/ina/matte.py (the Ina wedge, `ina-all`) and squares baked by sf/far/bake.py.
//
//   node sf/far/pack.mjs --out <dir> [--place <place dir>] [--squares <dir of square bakes>] [--wedge-owns 1]
//
// Writes <out>/far.json and <out>/far/<band>/<x>_<z>.far:
//   - far.json is the manifest's `far` object as asked of the data lane on #450: `size` (a tile's side in 10 cm cells,
//     on the frame's grid), `bands` (the least size of a face in each band, metres), `tiles` (key `x_z`, each a list
//     of a record or null per band: {path, bytes, sha256} over the bytes as written).
//   - A tile's band holds the faces whose low corner is in the tile and whose size (metres, the geometric mean of
//     its sides) is in the band. A far tile is fetched only for band 0, and nearer ones add the rest.
//   - A `.far` file: 'FAR1', a u32 length, that many bytes of JSON (spaces to a multiple of 4), then the faces with
//     each of their 20 bytes grouped (all faces' byte 0, then all byte 1, ...), which Brotli packs better. The JSON
//     says the sections: a block of faces with one frame (where its corner is, its cell, its turn), their range,
//     their bounds in the world's cells, and how many are at least each of `lods` metres across, biggest first.
//
// One owner a tile: where both a place and squares hold faces, `--wedge-owns 1` gives the tiles the place covers
// whole to the place, and the rest to the squares.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const out = arg('out')
if (!out) { console.error('usage: node sf/far/pack.mjs --out <dir> [--place <dir>] [--squares <dir>]'); process.exit(1) }

/** A tile's side, in 10 cm cells: 500 m. */
export const SIZE = 5000
/** The least size of a face in each band, metres. */
export const BANDS = [4, 1, 0]
/** The sizes a section counts its faces down to, metres: the page draws only those a pixel or so across. */
export const LODS = [16, 8, 4, 2, 1, 0.5, 0.25]

/** Every source's blocks: {frame, words, layer, owner}. A place's index lists its blocks; a square bake's is the same shape. */
const sources = []
const read = (dir, owner) => {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const turn = ((index.turn ?? 0) * Math.PI) / 180
  for (const b of index.blocks) {
    const bytes = readFileSync(join(dir, b.file))
    if (bytes.length !== b.faces * 20) throw new Error(`${dir}/${b.file}: ${bytes.length} bytes for ${b.faces} faces`)
    const c0 = b.c0 ?? [Math.cos(turn), 0, -Math.sin(turn)], c2 = b.c2 ?? [Math.sin(turn), 0, Math.cos(turn)]
    sources.push({ owner, name: `${owner}:${b.file}`, layer: b.layer, frame: { pos: b.pos, cell: b.cell, c0, c2, uw: b.uw ?? [0, 0] }, words: new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4) })
  }
  return index
}
const place = arg('place') ? read(arg('place'), 'place') : null
const squares = arg('squares') ? readdirSync(arg('squares')).filter((d) => existsSync(join(arg('squares'), d, 'index.json'))).map((d) => read(join(arg('squares'), d), `square ${d}`)) : []
const styles = place?.styles ?? squares[0]?.styles ?? []
const sun = place?.sun ?? squares[0]?.sun ?? null

/** A face's corners in its block's cells: low x, high x, low z, high z; and its low and high y (10 cm). */
const extent = (w0, w1, w2) => {
  const x = w0 & 0x7ff, z = (w0 >>> 11) & 0x7ff, lu = w0 >>> 22, lw = w2 & 0x3ff, axis = (w2 >>> 10) & 3
  const [x0, x1, z0, z1] = axis === 0 ? [x, x + lu, z, z + lw] : axis === 1 ? [x, x + 1, z, z + lw] : [x, x + lu, z, z + 1]
  return { x0, x1, z0, z1, y0: axis === 0 ? w1 >>> 16 : w1 & 0xffff, y1: w1 >>> 16, axis, lu, lw }
}
/** Its size in metres: a top's sides, a wall's length and height. */
const sizeOf = (e, cell) => e.axis === 0 ? Math.sqrt(e.lu * e.lw) * cell / 10 : Math.sqrt((e.axis === 1 ? e.lw : e.lu) * cell / 10 * Math.max(0.1, (e.y1 - e.y0) / 10))

// ── Which tile and band each face is in ──
/** key -> band -> source index -> face indices */
const tiles = new Map()
const coveredBy = new Map()
for (const [si, s] of sources.entries()) {
  const { pos, cell, c0, c2 } = s.frame, n = s.words.length / 5
  for (let i = 0; i < n; i++) {
    const e = extent(s.words[i * 5], s.words[i * 5 + 1], s.words[i * 5 + 2])
    const wx = pos[0] + (c0[0] * e.x0 + c2[0] * e.z0) * cell, wz = pos[2] + (c0[2] * e.x0 + c2[2] * e.z0) * cell
    const key = `${Math.floor(wx / SIZE)}_${Math.floor(wz / SIZE)}`
    const size = sizeOf(e, cell), band = BANDS.findIndex((least) => size >= least)
    let t = tiles.get(key)
    if (!t) tiles.set(key, (t = BANDS.map(() => new Map())))
    let list = t[band].get(si)
    if (!list) t[band].set(si, (list = []))
    list.push(i)
    // What owns the tile: the sources that hold its faces.
    let o = coveredBy.get(key)
    if (!o) coveredBy.set(key, (o = new Set()))
    o.add(s.owner)
  }
}

// One owner a tile (--wedge-owns): the place where it holds ground under the tile's four corners, else the squares.
const owner = new Map()
for (const [key, by] of coveredBy) {
  if (by.size === 1) { owner.set(key, [...by][0]); continue }
  owner.set(key, arg('wedge-owns', '1') === '1' && by.has('place') ? 'place' : [...by].find((o) => o !== 'place'))
}

// ── Writing ──
rmSync(join(out, 'far'), { recursive: true, force: true })
const listing = { version: 1, size: SIZE, bands: BANDS, lods: LODS, tiles: {} }
let faces = 0, bytes = 0
const round = (v) => Math.round(v)
for (const key of [...tiles.keys()].sort()) {
  const record = []
  for (const [band, bySource] of tiles.get(key).entries()) {
    const sections = [], chunks = []
    let start = 0
    for (const [si, list] of bySource) {
      const s = sources[si]
      if (s.owner !== owner.get(key)) continue
      const { pos, cell, c0, c2 } = s.frame
      const sized = list.map((i) => ({ i, size: sizeOf(extent(s.words[i * 5], s.words[i * 5 + 1], s.words[i * 5 + 2]), cell) }))
      // Biggest first, so that a far tile draws a prefix (the site's prepare-city.mjs); the bake's order among equals.
      sized.sort((a, b) => b.size - a.size || a.i - b.i)
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      const words = new Uint32Array(sized.length * 5)
      for (const [k, { i }] of sized.entries()) {
        words.set(s.words.subarray(i * 5, i * 5 + 5), k * 5)
        const e = extent(s.words[i * 5], s.words[i * 5 + 1], s.words[i * 5 + 2])
        lo[1] = Math.min(lo[1], pos[1] + e.y0); hi[1] = Math.max(hi[1], pos[1] + e.y1)
        for (const px of [e.x0, e.x1]) for (const pz of [e.z0, e.z1]) for (const a of [0, 2]) {
          const v = pos[a] + (c0[a] * px + c2[a] * pz) * cell
          lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v)
        }
      }
      sections.push({ layer: s.layer, pos, cell, c0, c2, uw: s.frame.uw, start, count: sized.length, lods: LODS.map((least) => sized.filter((f) => f.size >= least).length), lo: lo.map(Math.floor), hi: hi.map(Math.ceil) })
      chunks.push(words)
      start += sized.length
    }
    if (!start) { record.push(null); continue }
    const all = new Uint8Array(start * 20)
    let at = 0
    for (const c of chunks) { all.set(new Uint8Array(c.buffer), at); at += c.byteLength }
    // Each of a face's 20 bytes grouped: byte j of face i at j * n + i.
    const grouped = new Uint8Array(all.length)
    for (let i = 0; i < start; i++) for (let j = 0; j < 20; j++) grouped[j * start + i] = all[i * 20 + j]
    let head = Buffer.from(JSON.stringify({ version: 1, sections, styles, sun, grouped: true }))
    head = Buffer.concat([head, Buffer.alloc((4 - (head.length % 4)) % 4, 32)])
    const body = Buffer.concat([Buffer.from('FAR1'), Buffer.from(new Uint32Array([head.length]).buffer), head, grouped])
    const path = `far/${band}/${key}.far`
    mkdirSync(join(out, 'far', String(band)), { recursive: true })
    writeFileSync(join(out, path), body)
    record.push({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
    faces += start
    bytes += body.length
  }
  if (record.some(Boolean)) listing.tiles[key] = record
}
listing.credit = [place?.credit, ...squares.map((s) => s.credit)].filter(Boolean).filter((c, i, all) => all.indexOf(c) === i).join('; ')
writeFileSync(join(out, 'far.json'), JSON.stringify(listing))
console.log(`${faces} faces in ${Object.keys(listing.tiles).length} tiles, ${(bytes / 1048576).toFixed(1)} MB as written`)
