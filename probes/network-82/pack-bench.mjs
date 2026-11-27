// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`.
//
// What packing a release's small files buys: bytes (is one Brotli stream over many tiles smaller than a stream each?)
// and requests. Reads a built release (engine/dist-sf/sf/releases/<hash>, with the plain files and their q11 `.br`
// copies as sf/build.mjs writes them) and prints tables; with --write <dir> it also writes the landing pack and
// reads it back, checking every entry against the manifest's sha256.
//
//   node probes/network-82/pack-bench.mjs --release <dir> [--only landing] [--write <dir>]
//
// The pack is pack.mjs's: sent as ONE object, compressed as a whole (Content-Encoding: br, or by the client).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as Z, gzipSync, zstdCompressSync } from 'node:zlib'
import { pack, unpack } from './pack.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const release = arg('release', null), only = arg('only', ''), write = arg('write', null)
if (!release || !existsSync(join(release, 'manifest.json'))) { console.error('pack-bench: --release <a built release folder with manifest.json>'); process.exit(1) }
const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'))
const br = (bytes, lgwin = 24, quality = 11) => brotliCompressSync(bytes, { params: { [Z.BROTLI_PARAM_QUALITY]: quality, [Z.BROTLI_PARAM_LGWIN]: lgwin, [Z.BROTLI_PARAM_SIZE_HINT]: bytes.length, ...(lgwin > 24 ? { [Z.BROTLI_PARAM_LARGE_WINDOW]: 1 } : {}) } })
const kb = (n) => `${(n / 1024).toFixed(1)} KB`, pct = (a, b) => `${(((a - b) / b) * 100).toFixed(1)}%`
const sha = (b) => createHash('sha256').update(b).digest('hex')

/** One row: these files each as its own request (the q11 `.br` beside each, as the Worker sends it now) against one pack. */
function row(label, files, { order = (a, b) => (a < b ? -1 : 1), variants = true } = {}) {
  const names = [...files].sort(order)
  const raw = names.map((f) => readFileSync(join(release, f)))
  const each = names.reduce((n, f) => n + statSync(join(release, `${f}.br`)).size, 0), rawBytes = raw.reduce((n, b) => n + b.length, 0)
  const packed = pack(names.map((f, i) => [f, raw[i]]))
  const t0 = performance.now(), b24 = br(packed, 24), t1 = performance.now()
  const out = { set: label, files: names.length, raw: kb(rawBytes), 'each .br (now)': kb(each), 'one pack br q11 w24': kb(b24.length), 'vs now': pct(b24.length, each), 'q11 s': ((t1 - t0) / 1000).toFixed(1) }
  if (variants) {
    out['pack br q11 w22'] = kb(br(packed, 22).length)
    out['pack br q5 (edge-like)'] = kb(br(packed, 22, 5).length)
    out['pack gzip -9'] = kb(gzipSync(packed, { level: 9 }).length)
    out['pack zstd -19'] = kb(zstdCompressSync(packed, { params: { [Z.ZSTD_c_compressionLevel]: 19 } }).length)
    const d0 = performance.now(); for (let i = 0; i < 5; i++) brotliDecompressSync(b24)
    out['unbr ms'] = ((performance.now() - d0) / 5).toFixed(1)
  }
  return { out, packed, compressed: b24, names, raw }
}

const tables = []
// ── The landing's cut: 167 objects, one a tile, all asked for before the first picture. ──
if (!only || only === 'landing') {
  const files = Object.values(manifest.far.landing.tiles).map((t) => t.path)
  const plain = row('far/landing (as files)', files)
  tables.push(plain.out)
  // The same bytes laid out for the compressor: every head (JSON) first, then the faces' 20 byte planes, each plane
  // over ALL tiles (a .far is already plane by plane within itself: far.ts `grouped`).
  const heads = [], planes = Array.from({ length: 20 }, () => [])
  let grouped = 0
  for (const b of plain.raw) {
    const length = b.readUInt32LE(4), head = JSON.parse(b.toString('utf8', 8, 8 + length)), faces = b.subarray(8 + length), n = faces.length / 20
    heads.push(b.subarray(0, 8 + length))
    if (head.grouped) grouped++
    for (let j = 0; j < 20; j++) planes[j].push(head.grouped ? faces.subarray(j * n, (j + 1) * n) : Buffer.from(Uint8Array.from({ length: n }, (_, i) => faces[i * 20 + j])))
  }
  const columns = Buffer.concat([...heads, ...planes.flat()]), c24 = br(columns, 24)
  tables.push({ set: `far/landing (heads, then each plane over all tiles; ${grouped}/${plain.raw.length} grouped)`, files: files.length, raw: kb(columns.length), 'each .br (now)': plain.out['each .br (now)'], 'one pack br q11 w24': kb(c24.length), 'vs now': pct(c24.length, Number.parseFloat(plain.out['each .br (now)']) * 1024) })
  if (write) {
    mkdirSync(write, { recursive: true })
    writeFileSync(join(write, 'landing.pack'), plain.packed); writeFileSync(join(write, 'landing.pack.br'), plain.compressed)
    const back = unpack(brotliDecompressSync(readFileSync(join(write, 'landing.pack.br'))))
    let ok = 0
    for (const t of Object.values(manifest.far.landing.tiles)) if (sha(back.get(t.path)) === t.sha256) ok++
    console.log(`wrote ${join(write, 'landing.pack.br')} (${kb(plain.compressed.length)}); read back: ${ok}/${back.size} entries match the manifest's sha256`)
    if (ok !== files.length) process.exit(1)
  }
}

// ── Square packing: the files a tile or a square has, joined into clusters of k x k. ──
/** Files keyed "x_z" (far tiles) or "x_z" in half-kilometres (life, names, graph), grouped k x k. */
function clusters(label, keyed, k, variants = false) {
  const groups = new Map()
  for (const [x, z, path] of keyed) { const g = `${Math.floor(x / k)}_${Math.floor(z / k)}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(path) }
  let each = 0, joined = 0, biggest = 0, n = 0
  for (const files of groups.values()) { const r = row('', files, { variants: false }); each += Number.parseFloat(r.out['each .br (now)']) * 1024; joined += r.compressed.length; biggest = Math.max(biggest, r.compressed.length); n += files.length }
  return { set: `${label} ${k}x${k}`, files: n, requests: groups.size, 'each .br (now)': kb(each), 'packs br q11 w24': kb(joined), 'vs now': pct(joined, each), 'mean pack': kb(joined / groups.size), 'largest pack': kb(biggest) }
}
const squares = []
if (!only || only === 'far0') {
  // Band 0 (faces of 4 m and up): the band every tile within 16 km is asked for, 15 KB a file.
  const band0 = Object.entries(manifest.far.tiles).flatMap(([key, recs]) => (recs[0] ? [[...key.split('_').map(Number), recs[0].path]] : []))
  for (const k of [2, 4, 8, 1000]) squares.push(clusters('far band 0', band0, k))
}
for (const kind of ['life', 'names', 'graph']) {
  if (only && only !== kind) continue
  const objects = kind === 'life' ? manifest.life.objects : manifest[kind]
  // Squares are named by their south-west corner in kilometres ("542.7_4173.5"): 1 km apart.
  const keyed = Object.entries(objects).flatMap(([key, o]) => { const [x, z] = key.split('_').map(Number); return Number.isFinite(x) && Number.isFinite(z) ? [[Math.round(x - 0.7), Math.round(z - 0.5), o.path]] : [] })
  for (const k of [2, 4, 1000]) squares.push(clusters(kind, keyed, k))
}
if (!only || only === 'cars') tables.push(row('cars (all models + index)', [manifest.cars.index.path, ...Object.values(manifest.cars.objects).map((o) => o.path)]).out)

if (tables.length) console.table(tables)
if (squares.length) console.table(squares)
