// The far model as the landing's eye sees it (#450): of every face in a release's far tiles, only those that are
// seen from the park's camera (sf/realm.json `arrive`, `fov`, `roll`), one object a tile, for the page to fetch
// before the park is first shown (page/far.ts `landing`). From that eye they draw the same skyline as every band
// together, in a small share of the bytes: most faces of a city look away from one eye or stand behind others.
//
// Each face the page would draw from that eye is drawn into a depth buffer `--over` times finer than the screen each
// way, and a face that is the nearest at any sample is kept: one that looks toward the eye, lies past the far model's
// reach, is in the view (as wide as `--size`, with the eye's own roll), is in a band the page fetches at its distance
// and is at least `fardetail` pixels across there (far.ts `needs` and the runs' `lods`); of a landmark's section (layer
// `hero`), every face, each grown about its middle to a pixel each way, as far.ts `vs` grows it, and kept if it is as
// near as what is drawn anywhere within a pixel of it (edge-on, it is a sliver the samples miss). A face the page leaves out
// must hide nothing here, or what it shows through would be lost. Faces that tie at a sample (a landmark's glass and
// the bars on it lie in one plane) are all kept: which one the GPU shows there is its own order's to say. The page's pixels depend on how tall its picture
// is (the size of the window and the scale it draws at), so this is done for each of `--heights` and the faces any
// of them keeps are kept. Faces nearer than the reach are left out and hide nothing (the cells draw there),
// so nothing seen is lost to them. Kept faces stay in their sections and runs, in order, with each run's counts
// down to `lods` counted again, so the page draws them as it draws a band.
//
//   node sf/far/landing.mjs <release folder with manifest.json> [--out ~/.village/engine/sf/far/landing] [--size 2018x864] [--over 2] [--reach 500]
//                           [--heights 864,720,576,432] [--detail 0.75]
//
// Writes <out>/landing.json (the manifest's `far.landing`: the eye, and a record a tile) and <out>/far/landing/<x>_<z>.far,
// laid out as the far model's bands are (release.md), so that both go into a release beside them.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const release = process.argv[2]
const out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'far', 'landing'))
const [W0, H0] = arg('size', '2018x864').split('x').map(Number), over = Number(arg('over', '2')), reach = Number(arg('reach', '500')) * 10
const heights = arg('heights', '864,720,576,432').split(',').map(Number), detail = Number(arg('detail', '0.75'))
const realm = JSON.parse(readFileSync(new URL('../realm.json', import.meta.url), 'utf8'))
const far = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')).far
const LODS = far.lods

// ── The eye, as page/main.ts `view` makes it ──
const eye = realm.arrive.at, yaw = realm.arrive.yaw, pitch = realm.arrive.pitch, roll = ((realm.roll ?? 0) * Math.PI) / 180
const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp], level = [Math.cos(yaw), 0, Math.sin(yaw)]
const plumb = [level[1] * f[2] - level[2] * f[1], level[2] * f[0] - level[0] * f[2], level[0] * f[1] - level[1] * f[0]]
const cr = Math.cos(roll), sr = Math.sin(roll)
const r = [0, 1, 2].map((i) => level[i] * cr + plumb[i] * sr), u = [0, 1, 2].map((i) => plumb[i] * cr - level[i] * sr)
const tanHalf = Math.tan((realm.fov * Math.PI) / 360), aspect = W0 / H0
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Whether a box (cells) is anywhere in the view, a little wider (far.ts `inView`). */
const inView = (lo, hi) => {
  const tx = tanHalf * aspect * 1.05, ty = tanHalf * 1.05
  for (const n of [[0, 1, 2].map((i) => f[i] * tx - r[i]), [0, 1, 2].map((i) => f[i] * tx + r[i]), [0, 1, 2].map((i) => f[i] * ty - u[i]), [0, 1, 2].map((i) => f[i] * ty + u[i])]) {
    let most = 0
    for (let i = 0; i < 3; i++) most += n[i] * ((n[i] > 0 ? hi[i] : lo[i]) - eye[i])
    if (most < 0) return false
  }
  return true
}

// ── The objects of the tiles in the view, every band ──
const objects = []
for (const [key, recs] of Object.entries(far.tiles)) {
  const [x, z] = key.split('_').map(Number)
  if (!inView([x * far.size, -2000, z * far.size], [(x + 1) * far.size, 6000, (z + 1) * far.size])) continue
  for (const rec of recs) {
    if (!rec) continue
    const b = readFileSync(join(release, rec.path)), length = b.readUInt32LE(4), head = JSON.parse(b.subarray(8, 8 + length).toString())
    const g = b.subarray(8 + length), n = g.length / 20, flat = Buffer.alloc(g.length)
    if (head.grouped) for (let j = 0; j < 20; j++) for (let i = 0; i < n; i++) flat[i * 20 + j] = g[j * n + i]
    else g.copy(flat)
    objects.push({ key, band: recs.indexOf(rec), head, words: new Uint32Array(flat.buffer, flat.byteOffset, flat.length / 4), n })
  }
}

// ── Every face into the depth buffer: one over the distance along the look, nearest greatest (far.ts `vs`) ──
/** How far a box is from the eye, cells (far.ts `away`). */
const away = (lo, hi) => Math.hypot(...[0, 1, 2].map((a) => Math.max(lo[a] - eye[a], 0, eye[a] - hi[a])))
const tileBox = new Map()
for (const o of objects) for (const s of o.head.sections) {
  let b = tileBox.get(o.key)
  if (!b) tileBox.set(o.key, (b = { lo: [...s.lo], hi: [...s.hi] }))
  for (let a = 0; a < 3; a++) { b.lo[a] = Math.min(b.lo[a], s.lo[a]); b.hi[a] = Math.max(b.hi[a], s.hi[a]) }
}
let W = 0, H = 0, depth = null, marking = false
/** How near the nearest a face at a sample is still kept, a share of the distance: a few millimetres at 2 km. */
const TIE = 1e-6
const base = []
let total = 0
for (const o of objects) { base.push(total); total += o.n }
const corner = new Float64Array(12), sx = new Float64Array(4), sy = new Float64Array(4), iz = new Float64Array(4)
const triangle = (a, b, c, face) => {
  const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
  if (Math.abs(area) < 1e-12) return
  const x0 = Math.max(0, Math.ceil(Math.min(sx[a], sx[b], sx[c]) - 0.5)), x1 = Math.min(W - 1, Math.floor(Math.max(sx[a], sx[b], sx[c]) - 0.5))
  const y0 = Math.max(0, Math.ceil(Math.min(sy[a], sy[b], sy[c]) - 0.5)), y1 = Math.min(H - 1, Math.floor(Math.max(sy[a], sy[b], sy[c]) - 0.5))
  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5
      const wa = ((sx[b] - cx) * (sy[c] - cy) - (sx[c] - cx) * (sy[b] - cy)) / area
      const wb = ((sx[c] - cx) * (sy[a] - cy) - (sx[a] - cx) * (sy[c] - cy)) / area
      const wc = 1 - wa - wb
      if (wa < 0 || wb < 0 || wc < 0) continue
      const d = wa * iz[a] + wb * iz[b] + wc * iz[c], at = py * W + px
      if (marking) { if (d >= depth[at] * (1 - TIE)) kept[face] = 1 }
      else if (d > depth[at]) depth[at] = d
    }
  }
}
const kept = new Uint8Array(total)
for (const h of heights) {
  const focal = h / (2 * tanHalf), pixel = (2 * tanHalf) / h
  W = Math.round(h * aspect) * over; H = h * over
  depth = new Float32Array(W * H)
  // Twice: the nearest at each sample, then every face as near as it.
  for (marking of [false, true]) {
  for (const [oi, o] of objects.entries()) {
    const w = o.words
    // The bands the page fetches for this tile at its distance (far.ts `needs`).
    const tb = tileBox.get(o.key), dt = away(tb.lo, tb.hi)
    if (o.band > 0 && !((dt / 10) * detail < far.bands[o.band - 1] * focal)) continue
    for (const s of o.head.sections) {
      const { pos, cell, c0, c2 } = s
      // Each run's prefix the page draws at this section's distance: faces at least `detail` pixels across. A
      // landmark's every face (far.ts `draw`), grown to a pixel (far.ts `vs`): left out, the sky showed through it.
      const hero = s.layer === 'hero'
      const least = (detail * away(s.lo, s.hi)) / 10 / focal, k = hero ? -1 : LODS.findIndex((l) => l <= least)
      const drawn = new Set()
      for (const run of s.runs) { const c = k < 0 ? run.count : run.lods[k]; for (let i = run.start; i < run.start + c; i++) drawn.add(i) }
      for (let i = s.start; i < s.start + s.count; i++) {
        if (!drawn.has(i)) continue
        const w0 = w[i * 5], w1 = w[i * 5 + 1], w2 = w[i * 5 + 2]
        const x = w0 & 0x7ff, z = (w0 >>> 11) & 0x7ff, lu = w0 >>> 22, y0 = w1 & 0xffff, y1 = w1 >>> 16, lw = w2 & 0x3ff, axis = (w2 >>> 10) & 3, side = (w2 >>> 12) & 1
        let n, gu = 0, gv = 0
        if (hero) {
          const mid = [0, 1, 2].map((a) => pos[a] + c0[a] * (x + lu * 0.5) * cell + (a === 1 ? (y0 + y1) * 0.5 : 0) + c2[a] * (z + lw * 0.5) * cell - eye[a])
          const most = Math.max(dot(mid, f), 1) * pixel
          const across = axis === 0 ? [lu * cell, lw * cell] : axis === 1 ? [lw * cell, y1 - y0] : [lu * cell, y1 - y0]
          gu = Math.max(most - across[0], 0); gv = Math.max(most - across[1], 0)
        }
        for (let v = 0; v < 4; v++) {
          const cu = v & 1, cv = v >> 1, eu = gu * (cu - 0.5), ev = gv * (cv - 0.5)
          let px, py, pz
          if (axis === 0) { px = x + cu * lu + eu / cell; py = y1; pz = z + cv * lw + ev / cell; n = [0, 1, 0] }
          else if (axis === 1) { px = x + side; py = y0 + (y1 - y0) * cv + ev; pz = z + cu * lw + eu / cell; n = c0.map((c) => c * (side * 2 - 1)) }
          else { px = x + cu * lu + eu / cell; py = y0 + (y1 - y0) * cv + ev; pz = z + side; n = c2.map((c) => c * (side * 2 - 1)) }
          for (let a = 0; a < 3; a++) corner[v * 3 + a] = pos[a] + c0[a] * px * cell + (a === 1 ? py : 0) + c2[a] * pz * cell - eye[a]
        }
        // Looking away from the eye, or any of it nearer than the reach (the cells' there): not drawn, hides nothing.
        if (n[0] * corner[0] + n[1] * corner[1] + n[2] * corner[2] >= 0) continue
        let skip = false
        for (let v = 0; v < 4 && !skip; v++) {
          const d = [corner[v * 3], corner[v * 3 + 1], corner[v * 3 + 2]], along = dot(d, f)
          if (along < 10 || Math.hypot(d[0], d[1], d[2]) < reach) { skip = true; break }
          sx[v] = ((dot(d, r) / (along * tanHalf * aspect)) + 1) * 0.5 * W
          sy[v] = (1 - dot(d, u) / (along * tanHalf)) * 0.5 * H
          iz[v] = 1 / along
        }
        if (skip) continue
        if (Math.max(sx[0], sx[1], sx[2], sx[3]) < 0 || Math.min(sx[0], sx[1], sx[2], sx[3]) > W || Math.max(sy[0], sy[1], sy[2], sy[3]) < 0 || Math.min(sy[0], sy[1], sy[2], sy[3]) > H) continue
        const face = base[oi] + i
        if (marking && hero) {
          // A landmark's face, grown to a pixel, still lies edge-on as a sliver under a pixel across, which the page's
          // pixels meet where this buffer's samples (a quarter of a pixel off them) do not: the sky showed through the
          // tower there. So it is kept if it is as near as what is drawn anywhere within a pixel of it.
          const nearest = Math.max(iz[0], iz[1], iz[2], iz[3])
          const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2], sx[3])) - over), x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2], sx[3])) + over)
          const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2], sy[3])) - over), y1 = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2], sy[3])) + over)
          for (let py = y0; py <= y1 && !kept[face]; py++) for (let px = x0; px <= x1; px++) if (nearest >= depth[py * W + px] * (1 - TIE)) { kept[face] = 1; break }
          continue
        }
        triangle(0, 1, 2, face)
        triangle(1, 3, 2, face)
      }
    }
  }
  }
}

// ── A tile's kept faces, in their sections and runs as they were ──
rmSync(join(out, 'far', 'landing'), { recursive: true, force: true })
mkdirSync(join(out, 'far', 'landing'), { recursive: true })
const byTile = new Map()
for (const [oi, o] of objects.entries()) { let l = byTile.get(o.key); if (!l) byTile.set(o.key, (l = [])); l.push(oi) }
const listing = { version: 1, eye, yaw, pitch, fov: realm.fov, roll: realm.roll ?? 0, size: [W0, H0], heights, over, detail, reach: reach / 10, tiles: {} }
let faces = 0, bytes = 0
for (const [key, list] of [...byTile].sort()) {
  const sections = [], chunks = []
  let start = 0, styles = null, sun = null
  for (const oi of list) {
    const o = objects[oi], b = base[oi]
    styles ??= o.head.styles; sun ??= o.head.sun
    for (const s of o.head.sections) {
      const runs = [], from = start
      for (const run of s.runs) {
        const picked = []
        for (let i = run.start; i < run.start + run.count; i++) if (kept[b + i]) picked.push(i)
        if (!picked.length) continue
        const lods = run.lods.map((n) => picked.filter((i) => i < run.start + n).length)
        runs.push({ way: run.way, start, count: picked.length, lods })
        for (const i of picked) chunks.push(o.words.subarray(i * 5, i * 5 + 5))
        start += picked.length
      }
      if (start > from) sections.push({ ...s, start: from, count: start - from, runs })
    }
  }
  if (!start) continue
  const all = new Uint8Array(start * 20)
  for (const [k, c] of chunks.entries()) all.set(new Uint8Array(c.buffer, c.byteOffset, 20), k * 20)
  const grouped = new Uint8Array(all.length)
  for (let i = 0; i < start; i++) for (let j = 0; j < 20; j++) grouped[j * start + i] = all[i * 20 + j]
  let head = Buffer.from(JSON.stringify({ version: 1, sections, styles, sun, grouped: true }))
  head = Buffer.concat([head, Buffer.alloc((4 - (head.length % 4)) % 4, 32)])
  const body = Buffer.concat([Buffer.from('FAR1'), Buffer.from(new Uint32Array([head.length]).buffer), head, grouped])
  const path = `far/landing/${key}.far`
  writeFileSync(join(out, path), body)
  listing.tiles[key] = { path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  faces += start; bytes += body.length
}
writeFileSync(join(out, 'landing.json'), JSON.stringify(listing))
console.log(`${objects.length} objects of ${byTile.size} tiles in the view, ${total} faces: ${faces} seen from the landing (${(faces / total * 100).toFixed(1)}%), ${Object.keys(listing.tiles).length} tiles, ${(bytes / 1048576).toFixed(2)} MB`)
