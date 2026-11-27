// Surveyed kerb polylines for San Francisco's streets, from the city run's street graphs (packs/graph/*.json):
// sf/build.mjs writes them as `bay/kerbs.bin` beside the tiles, and serve.mjs serves the same for its own.
// Every core loads them once (page/bay.ts -> bay.rs `kerbs`) so sidewalks follow straight surveyed block faces
// and smooth rounded corners at sub-cell precision instead of the bake's 50 cm binary raster.
//
//   node sf/kerbs.mjs <graph dir> <out.bin>
//
// Binary format (little-endian):
//   Header (4 int32 words):
//     [0] magic   = 'KERB' (0x4252454b)
//     [1] version = 1
//     [2] nPolys  = number of polylines
//     [3] nVerts  = total vertices across all polylines
//   Then `nPolys` records, each:
//     uint32  flagsAndLen: bit 31 = closed loop (last vertex connects to first), bits 0..30 = vertex count m (>= 2)
//     int32   x0, z0: first vertex in quarter-cells (2.5 cm, x east, z south of frame origin)
//     (m - 1) × (int16 dx, int16 dz): delta from previous vertex in quarter-cells
//
// Winding convention: every polyline is oriented so LEFT of (P_i -> P_{i+1}) in (x east, z south),
// i.e. cross(P_{i+1} - P_i, Q - P_i) > 0, is PAVEMENT, and RIGHT (< 0) is ROAD.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAGIC = 0x4252454b // 'KERB'
const VERSION = 1
const BUCKET = 200 // 20 m spatial bucket for road/pavement orientation queries
const MAX_DELTA = 30000 // fits comfortably in int16 (quarter-cells: 750 m)

/** Smooth 10 cm integer-quantized corner arcs without moving straight block-face endpoints. */
function smoothArcs(pts, closed) {
  const n = pts.length
  if (n < 3) return pts.map((p) => [p[0], p[1]])
  let cur = pts.map((p) => [p[0], p[1]])
  const isArc = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? i - 1 : closed ? n - 2 : -1
    const next = i + 1 < n ? i + 1 : closed ? 1 : -1
    if (prev < 0 || next < 0) continue
    const d0 = Math.hypot(cur[i][0] - cur[prev][0], cur[i][1] - cur[prev][1])
    const d1 = Math.hypot(cur[next][0] - cur[i][0], cur[next][1] - cur[i][1])
    if (d0 <= 5 && d1 <= 5) isArc[i] = 1
  }
  for (let pass = 0; pass < 3; pass++) {
    const nxt = cur.map((p) => [p[0], p[1]])
    for (let i = 0; i < n; i++) {
      if (!isArc[i]) continue
      const prev = i > 0 ? i - 1 : n - 2
      const next = i + 1 < n ? i + 1 : 1
      nxt[i][0] = 0.25 * cur[prev][0] + 0.5 * cur[i][0] + 0.25 * cur[next][0]
      nxt[i][1] = 0.25 * cur[prev][1] + 0.5 * cur[i][1] + 0.25 * cur[next][1]
    }
    if (closed) nxt[n - 1] = [nxt[0][0], nxt[0][1]]
    cur = nxt
  }
  return cur
}

/** Iterative Ramer-Douglas-Peucker simplification in cell coordinates. */
function rdp(pts, eps) {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    const a = pts[s], b = pts[e]
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz
    let maxD = -1, idx = -1
    for (let i = s + 1; i < e; i++) {
      let d
      if (l2 === 0) d = Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1])
      else {
        const t = Math.max(0, Math.min(1, ((pts[i][0] - a[0]) * dx + (pts[i][1] - a[1]) * dz) / l2))
        d = Math.hypot(pts[i][0] - (a[0] + t * dx), pts[i][1] - (a[1] + t * dz))
      }
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > eps && idx > s) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const out = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** Signed area (2x) in (x east, z south); positive means LEFT normal (-dz, dx) points INSIDE. */
function signedArea2(pts) {
  let a = 0
  for (let i = 0; i + 1 < pts.length; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
  return a
}

/** Point-in-polygon test (even-odd) for a closed polyline. */
function pointInPoly(px, pz, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1]
    if ((zi > pz) !== (zj > pz) && px < xi + ((pz - zi) * (xj - xi)) / (zj - zi)) inside = !inside
  }
  return inside
}

/** Extract, smooth, simplify and consistently orient surveyed kerbs from street graph objects. */
export function kerbsOf(graphs, { eps = 0.28 } = {}) {
  const roadGrid = new Map(), paveGrid = new Map()
  const fileSeg = (grid, a, b) => {
    const x0 = Math.floor(Math.min(a[0], b[0]) / BUCKET), x1 = Math.floor(Math.max(a[0], b[0]) / BUCKET)
    const z0 = Math.floor(Math.min(a[1], b[1]) / BUCKET), z1 = Math.floor(Math.max(a[1], b[1]) / BUCKET)
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = `${gx}_${gz}`
      let list = grid.get(k)
      if (!list) grid.set(k, (list = []))
      list.push([a[0], a[1], b[0], b[1]])
    }
  }
  const seenRoad = new Set(), seenPave = new Set()
  for (const g of graphs) {
    for (const r of g.roads ?? []) {
      if (seenRoad.has(r.id)) continue
      seenRoad.add(r.id)
      for (let i = 0; i + 1 < r.line.length; i++) fileSeg(roadGrid, r.line[i], r.line[i + 1])
    }
    for (const p of g.pavements ?? []) {
      if (seenPave.has(p.id)) continue
      seenPave.add(p.id)
      for (let i = 0; i + 1 < p.line.length; i++) fileSeg(paveGrid, p.line[i], p.line[i + 1])
    }
  }

  const distTo = (grid, px, pz) => {
    const gx = Math.floor(px / BUCKET), gz = Math.floor(pz / BUCKET)
    let best = 1e9
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${gx + dx}_${gz + dz}`)
      if (!list) continue
      for (let i = 0; i < list.length; i++) {
        const s = list[i], vx = s[2] - s[0], vz = s[3] - s[1], l2 = vx * vx + vz * vz
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s[0]) * vx + (pz - s[1]) * vz) / l2)) : 0
        const d = Math.hypot(px - (s[0] + vx * t), pz - (s[1] + vz * t))
        if (d < best) best = d
      }
    }
    return best
  }

  const hasRoadInside = (pts) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]
      if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]
    }
    for (let gx = Math.floor(x0 / BUCKET); gx <= Math.floor(x1 / BUCKET); gx++) {
      for (let gz = Math.floor(z0 / BUCKET); gz <= Math.floor(z1 / BUCKET); gz++) {
        const list = roadGrid.get(`${gx}_${gz}`)
        if (!list) continue
        for (const s of list) {
          const mx = (s[0] + s[2]) * 0.5, mz = (s[1] + s[3]) * 0.5
          if (mx >= x0 && mx <= x1 && mz >= z0 && mz <= z1 && pointInPoly(mx, mz, pts)) return true
        }
      }
    }
    return false
  }

  const seenPoly = new Set()
  const polys = []
  for (const g of graphs) {
    for (const k of g.kerbs ?? []) {
      const raw = k.line
      if (!raw || raw.length < 2) continue
      const first = raw[0], last = raw[raw.length - 1]
      const polyKey = `${k.id ?? ''}:${raw.length}:${first[0]},${first[1]}:${last[0]},${last[1]}`
      if (seenPoly.has(polyKey)) continue
      seenPoly.add(polyKey)

      const closed = raw.length >= 4 && first[0] === last[0] && first[1] === last[1]
      let ordered = raw
      // For closed loops, rotate the start vertex to the endpoint of the longest straight edge
      // so arc smoothing & RDP never split a rounded corner across index 0.
      if (closed) {
        let bestIdx = 0, bestLen = -1
        for (let i = 0; i + 1 < raw.length; i++) {
          const l = Math.hypot(raw[i + 1][0] - raw[i][0], raw[i + 1][1] - raw[i][1])
          if (l > bestLen) { bestLen = l; bestIdx = i }
        }
        if (bestIdx > 0) {
          const ring = raw.slice(0, -1)
          ordered = [...ring.slice(bestIdx), ...ring.slice(0, bestIdx), ring[bestIdx]]
        }
      }

      const sm = smoothArcs(ordered, closed)
      const simp = rdp(sm, eps)
      if (simp.length < 2) continue

      // Orient so LEFT of (a -> b) is PAVEMENT (+), RIGHT is ROAD (-).
      const area2 = closed ? signedArea2(simp) : 0
      const absArea = Math.abs(area2) * 0.5
      let vote = 0
      if (closed && absArea < 40000 && !hasRoadInside(simp)) {
        // Small closed traffic/median island: interior is PAVEMENT -> want area2 > 0.
        vote = area2 >= 0 ? 1 : -1
      } else {
        for (let i = 0; i + 1 < simp.length; i++) {
          const [ax, az] = simp[i], [bx, bz] = simp[i + 1]
          const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz)
          if (l < 1) continue
          const nx = -dz / l, nz = dx / l // LEFT normal
          const samples = Math.max(1, Math.min(8, Math.floor(l / 40)))
          const w = l / samples
          for (let s = 0; s < samples; s++) {
            const f = (s + 0.5) / samples
            const mx = ax + dx * f, mz = az + dz * f
            for (const off of [12, 24]) {
              const dRoadL = distTo(roadGrid, mx + nx * off, mz + nz * off)
              const dRoadR = distTo(roadGrid, mx - nx * off, mz - nz * off)
              const dPaveL = distTo(paveGrid, mx + nx * off, mz + nz * off)
              const dPaveR = distTo(paveGrid, mx - nx * off, mz - nz * off)
              // Positive vote means LEFT = PAVEMENT, RIGHT = ROAD.
              let v = 0
              if (dRoadR < dRoadL - 2.5) v += 1
              else if (dRoadL < dRoadR - 2.5) v -= 1
              if (dPaveL < dPaveR - 2.5) v += 0.5
              else if (dPaveR < dPaveL - 2.5) v -= 0.5
              vote += v * w
            }
          }
        }
        if (vote === 0 && closed) vote = area2 >= 0 ? 1 : -1
      }
      if (vote < 0) simp.reverse()

      // Quantize to quarter-cells (2.5 cm) and subdivide any giant edge so deltas fit in int16.
      const q = simp.map((p) => [Math.round(p[0] * 4), Math.round(p[1] * 4)])
      const pts = [q[0]]
      for (let i = 1; i < q.length; i++) {
        const prev = pts[pts.length - 1], cur = q[i]
        const dx = cur[0] - prev[0], dz = cur[1] - prev[1]
        if (dx === 0 && dz === 0) continue
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / MAX_DELTA))
        for (let s = 1; s <= steps; s++) {
          pts.push([Math.round(prev[0] + (dx * s) / steps), Math.round(prev[1] + (dz * s) / steps)])
        }
      }
      // For a closed loop, omit the repeated final vertex (bit 31 marks closure back to pts[0]).
      if (closed && pts.length >= 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
        pts.pop()
      }
      if (pts.length < (closed ? 3 : 2)) continue
      polys.push({ closed, pts })
    }
  }
  return polys
}

/** Read every street graph in a folder and extract its surveyed kerbs. */
export function kerbsIn(dir, opts) {
  const graphs = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  return kerbsOf(graphs, opts)
}

/** Pack oriented kerb polylines into compact binary bytes for bay.rs `kerbs`. */
export function kerbsBytes(polys) {
  let nVerts = 0
  let totalBytes = 16
  for (const p of polys) {
    nVerts += p.pts.length
    totalBytes += 4 + 8 + (p.pts.length - 1) * 4
  }
  const buf = Buffer.allocUnsafe(totalBytes)
  buf.writeInt32LE(MAGIC, 0)
  buf.writeInt32LE(VERSION, 4)
  buf.writeInt32LE(polys.length, 8)
  buf.writeInt32LE(nVerts, 12)
  let off = 16
  for (const p of polys) {
    const m = p.pts.length
    buf.writeUInt32LE(((m & 0x7fffffff) | (p.closed ? 0x80000000 : 0)) >>> 0, off)
    off += 4
    buf.writeInt32LE(p.pts[0][0], off)
    buf.writeInt32LE(p.pts[0][1], off + 4)
    off += 8
    for (let i = 1; i < m; i++) {
      buf.writeInt16LE(p.pts[i][0] - p.pts[i - 1][0], off)
      buf.writeInt16LE(p.pts[i][1] - p.pts[i - 1][1], off + 2)
      off += 4
    }
  }
  return buf
}

/** Short human summary of a kerbs.bin buffer. */
export function said(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return `${dv.getInt32(8, true)} polylines, ${dv.getInt32(12, true)} vertices, ${bytes.length} bytes`
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [dir, out] = process.argv.slice(2)
  const bytes = kerbsBytes(kerbsIn(dir))
  writeFileSync(out, bytes)
  console.log(`  kerbs: ${said(bytes)}`)
}
