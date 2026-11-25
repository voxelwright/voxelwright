// #47 look regroup 3: sewn skin (notes/villager-gen/LEARNING-look.md). The model builds a body from separate
// primitives that overlap (a trunk of three capsules, ears pushed into a sphere); trusted code here fuses the felt
// parts of one rig slot (the body, the head, a foot) into one continuous soft surface, as a plush is sewn from panels.
//
// Each part is matched to the analytic shape its vertices lie on (three's sphere, capsule, cylinder, cone, box,
// rounded box and torus put every vertex exactly on that surface), in its own axes with its world transform folded
// in. A part that matches nothing, is sheared, or is thinner than the grid can hold keeps its own mesh. The shapes'
// signed distances are joined with a smooth minimum (a blend about 3% of the height), sampled on a grid, and
// contoured with surface nets; each vertex is then pulled onto the exact field and takes its normal from the
// field's gradient, so a coarse grid still shades as a smooth plush. Colour: each surface point takes the felt of
// the nearest part, triangles are cut along the line where two felts are equally near (a clean seam, not a grid
// staircase), one mesh per felt, and a running stitch is laid along every seam.
import * as THREE from 'three/webgpu'
import { float, texture, triplanarTexture } from 'three/tsl'
import { canvas, toTexture } from '../../paint'
import { fuzzFill, srgb } from '../kinds'

type Sdf = (x: number, y: number, z: number) => number

/** A part matched to an analytic shape: its signed distance in the figure's space, its padded bounds and thickness. */
export interface Shape { kind: string; sdf: Sdf; box: THREE.Box3; thick: number }

const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y)
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)

/** Inigo Quilez's capped cone along y, radius ra at y = -h and rb at y = +h (rb = ra: a cylinder; rb = 0: a cone). */
function cappedCone(qx: number, qy: number, h: number, ra: number, rb: number) {
  const k1x = rb, k1y = h, k2x = rb - ra, k2y = 2 * h
  const cax = qx - Math.min(qx, qy < 0 ? ra : rb), cay = Math.abs(qy) - h
  const t = THREE.MathUtils.clamp(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y), 0, 1)
  const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t
  const s = cbx < 0 && cay < 0 ? -1 : 1
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
}

/** A rounded box with half sizes b and corner radius r. */
function roundBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r
}

type Local = (x: number, y: number, z: number) => number
/** Distance from axis k, and the coordinate along it. */
const RAD: Local[] = [(_x, y, z) => len2(y, z), (x, _y, z) => len2(z, x), (x, y) => len2(x, y)]
const AX: Local[] = [(x) => x, (_x, y) => y, (_x, _y, z) => z]
interface Candidate { kind: string; f: Local; thick: (s: number[]) => number }

/** The analytic shapes the part's local vertices could lie on, centred on the vertices' bounds. */
function candidates(h: number[], q: number[][]): Candidate[] {
  const out: Candidate[] = []
  const mean = (h[0] + h[1] + h[2]) / 3
  out.push({ kind: 'sphere', f: (x, y, z) => len3(x, y, z) - mean, thick: (s) => 2 * mean * Math.min(...s) })
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3, j = (k + 2) % 3
    const rad = RAD[k], ax = AX[k]
    // Capsule along k.
    const r = (h[i] + h[j]) / 2, a = Math.max(0, h[k] - r)
    out.push({ kind: 'capsule', f: (x, y, z) => len2(rad(x, y, z), Math.max(Math.abs(ax(x, y, z)) - a, 0)) - r, thick: (s) => 2 * r * Math.min(s[i], s[j]) })
    // Capped cone or cylinder along k: the radius at each end from the vertices there.
    let ra = 0, rb = 0, lo = Infinity, hi = 0
    for (const p of q) {
      const w = ax(p[0], p[1], p[2]), rho = rad(p[0], p[1], p[2])
      if (w < -h[k] * 0.98) ra = Math.max(ra, rho)
      if (w > h[k] * 0.98) rb = Math.max(rb, rho)
      lo = Math.min(lo, rho); hi = Math.max(hi, rho)
    }
    const hk = h[k]
    out.push({ kind: 'cone', f: (x, y, z) => cappedCone(rad(x, y, z), ax(x, y, z), hk, ra, rb), thick: (s) => 2 * Math.min(hk * s[k], Math.max(ra, rb) * Math.min(s[i], s[j])) })
    // Torus round axis k.
    const R = (lo + hi) / 2, tr = (hi - lo) / 2
    if (tr > 0 && R > tr) out.push({ kind: 'torus', f: (x, y, z) => len2(rad(x, y, z) - R, ax(x, y, z)) - tr, thick: (s) => 2 * tr * Math.min(...s) })
  }
  // Boxes, plain and rounded: the corner radius that fits best.
  const m = Math.min(h[0], h[1], h[2])
  for (let n = 0; n <= 8; n++) {
    const r = (m * n) / 8
    out.push({ kind: 'box', f: (x, y, z) => roundBox(x, y, z, h[0], h[1], h[2], r), thick: (s) => 2 * Math.min(h[0] * s[0], h[1] * s[1], h[2] * s[2]) })
  }
  return out
}

/**
 * The analytic shape a part's vertices lie on, in the figure's space (its matrixWorld must be current), or null:
 * no shape fits within 1.5% of its size, or its transform shears (a part turned under a parent scaled unevenly).
 */
export function fitPart(mesh: THREE.Mesh): Shape | null {
  const g = mesh.geometry
  const pos = g.attributes.position
  if (!pos || pos.count < 4) return null
  g.computeBoundingBox()
  const bb = g.boundingBox!
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3())
  const h = [size.x / 2, size.y / 2, size.z / 2]
  if (Math.min(...h) <= 1e-6) return null
  const e = mesh.matrixWorld.elements
  const cols = [0, 1, 2].map((k) => new THREE.Vector3(e[k * 4], e[k * 4 + 1], e[k * 4 + 2]))
  const s = cols.map((v) => v.length())
  if (Math.min(...s) <= 1e-9) return null
  const u = cols.map((v, k) => v.clone().divideScalar(s[k]))
  if (Math.abs(u[0].dot(u[1])) > 1e-3 || Math.abs(u[0].dot(u[2])) > 1e-3 || Math.abs(u[1].dot(u[2])) > 1e-3) return null
  const step = Math.max(1, Math.floor(pos.count / 400))
  const q: number[][] = []
  for (let i = 0; i < pos.count; i += step) q.push([pos.getX(i) - c.x, pos.getY(i) - c.y, pos.getZ(i) - c.z])
  const tol = 0.015 * Math.max(...h) + 1e-6
  let best: Candidate | null = null, bestErr = Infinity
  for (const cand of candidates(h, q)) {
    let err = 0
    for (const p of q) {
      err = Math.max(err, Math.abs(cand.f(p[0], p[1], p[2])))
      if (err >= bestErr) break
    }
    if (err < bestErr) { bestErr = err; best = cand }
  }
  if (!best || bestErr > tol) return null
  // World to the part's local axes (scale included), then to the vertices' centre.
  const inv = mesh.matrixWorld.clone().invert().elements
  const minS = Math.min(...s)
  const [i0, i1, i2, i4, i5, i6, i8, i9, i10, i12, i13, i14] = [inv[0], inv[1], inv[2], inv[4], inv[5], inv[6], inv[8], inv[9], inv[10], inv[12] - c.x, inv[13] - c.y, inv[14] - c.z]
  const f = best.f
  let sdf: Sdf
  if (best.kind === 'sphere' && Math.max(...s) - minS > 1e-6) {
    // A sphere scaled unevenly is an ellipsoid: Quilez's bound in the part's own (unscaled) axes.
    const r = s.map((k) => k * (h[0] + h[1] + h[2]) / 3)
    const T = new THREE.Vector3(e[12], e[13], e[14]).add(c.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld)))
    const [a0, a1, a2] = u
    sdf = (x, y, z) => {
      const dx = x - T.x, dy = y - T.y, dz = z - T.z
      const px = dx * a0.x + dy * a0.y + dz * a0.z, py = dx * a1.x + dy * a1.y + dz * a1.z, pz = dx * a2.x + dy * a2.y + dz * a2.z
      const k0 = len3(px / r[0], py / r[1], pz / r[2]), k1 = len3(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]))
      return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r)
    }
  } else {
    sdf = (x, y, z) => f(i0 * x + i4 * y + i8 * z + i12, i1 * x + i5 * y + i9 * z + i13, i2 * x + i6 * y + i10 * z + i14) * minS
  }
  return { kind: best.kind, sdf, box: new THREE.Box3().setFromObject(mesh, true), thick: best.thick(s) }
}

/** A surface component with fewer triangles than this is a speck the grid caught, not felt (dropped before colouring). */
const ISLAND = 16
/** A felt patch of fewer vertices than this inside another felt is a fleck and takes the felt around it. */
const FLECK = 9

/** A triangle's face normal against the sum of its vertex normals: negative when it faces inwards. */
function facing(p: ArrayLike<number>, n: ArrayLike<number>, a: number, b: number, c: number) {
  const A = a * 3, B = b * 3, C = c * 3
  const ux = p[B] - p[A], uy = p[B + 1] - p[A + 1], uz = p[B + 2] - p[A + 2], vx = p[C] - p[A], vy = p[C + 1] - p[A + 1], vz = p[C + 2] - p[A + 2]
  return (uy * vz - uz * vy) * (n[A] + n[B] + n[C]) + (uz * vx - ux * vz) * (n[A + 1] + n[B + 1] + n[C + 1]) + (ux * vy - uy * vx) * (n[A + 2] + n[B + 2] + n[C + 2])
}

/**
 * A sewn felt mesh's soundness, for the checks: its connected pieces, how many are specks (less area than `speck`), and
 * the triangles facing inwards (each shows as a hole). Spines and ears in one felt are honest separate pieces; specks
 * and inward triangles are not.
 */
export function surfaceStats(g: THREE.BufferGeometry, speck: number) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index!.array
  const up = new Int32Array(p.length / 3).map((_, i) => i)
  const find = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i] } return i }
  let inward = 0
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]); up[find(idx[t + 1])] = a; up[find(idx[t + 2])] = a
    if (facing(p, n, idx[t], idx[t + 1], idx[t + 2]) < 0) inward++
  }
  const area = new Map<number, number>()
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3
    const ux = p[B] - p[A], uy = p[B + 1] - p[A + 1], uz = p[B + 2] - p[A + 2], vx = p[C] - p[A], vy = p[C + 1] - p[A + 1], vz = p[C + 2] - p[A + 2]
    area.set(find(idx[t]), (area.get(find(idx[t])) ?? 0) + 0.5 * len3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx))
  }
  return { pieces: area.size, specks: [...area.values()].filter((a) => a < speck).length, inward }
}

/** Polynomial smooth minimum: a fillet of width k where two surfaces meet. */
const smin = (a: number, b: number, k: number) => {
  const t = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - t * t * k * 0.25
}

/** Felt fuzz that tiles (mirrored), with no stitch line, for triplanar mapping. */
function fuzz(base: string, seed: number) {
  const [c, g] = canvas(128, 128)
  fuzzFill(g, 128, 128, seed, srgb(base))
  const t = toTexture(c)
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping
  return t
}

export interface SkinPart { mesh: THREE.Mesh; colour: string }
export interface SkinOptions {
  /** Grid cell, model units. */
  cell: number
  /** Smooth-union width, model units. */
  blend: number
  /** The home's felt for a colour, with an optional map. */
  felt: (c: string, map?: THREE.Texture | null) => THREE.Material
  seed: number
  /** Triplanar repeats per model unit. */
  repeat?: number
}
export interface Skin {
  /** One mesh per felt, plus the stitches, in the figure's space (identity transform). */
  meshes: THREE.Mesh[]
  /** The parts the skin replaces. */
  fused: Set<THREE.Mesh>
  notes: string[]
  triangles: number
  /** Along a line from `o` (inside the skin) in unit direction `d`: how far to the skin, or null within `far`. */
  reach: (o: THREE.Vector3, d: THREE.Vector3, far: number) => number | null
}

/**
 * Sews one slot's felt parts into a skin. Returns null when fewer than two parts fit a shape (nothing to fuse).
 * Parts that fit nothing keep their own meshes (they are not in `fused`).
 */
export function sewSkin(parts: SkinPart[], o: SkinOptions): Skin | null {
  const shapes: { shape: Shape; part: SkinPart }[] = []
  const skipped: string[] = []
  for (const part of parts) {
    part.mesh.updateMatrixWorld(true)
    const shape = fitPart(part.mesh)
    if (!shape) skipped.push('unmatched')
    else if (shape.thick < 2.2 * o.cell) skipped.push(`thin ${shape.kind}`)
    else shapes.push({ shape, part })
  }
  if (shapes.length < 2) return null
  const { cell, blend: k } = o
  const pad = k + 2 * cell
  const bounds = new THREE.Box3()
  for (const { shape } of shapes) bounds.union(shape.box)
  bounds.expandByScalar(pad)
  const nx = Math.ceil((bounds.max.x - bounds.min.x) / cell) + 1
  const ny = Math.ceil((bounds.max.y - bounds.min.y) / cell) + 1
  const nz = Math.ceil((bounds.max.z - bounds.min.z) / cell) + 1
  const ox = bounds.min.x, oy = bounds.min.y, oz = bounds.min.z
  const field = new Float32Array(nx * ny * nz).fill(1)
  const padded = shapes.map(({ shape }) => shape.box.clone().expandByScalar(pad))
  // The field: each shape over its own padded bounds only (beyond them it is at least `pad` away, so the min holds).
  shapes.forEach(({ shape }, s) => {
    const b = padded[s]
    const i0 = Math.max(0, Math.floor((b.min.x - ox) / cell)), i1 = Math.min(nx - 1, Math.ceil((b.max.x - ox) / cell))
    const j0 = Math.max(0, Math.floor((b.min.y - oy) / cell)), j1 = Math.min(ny - 1, Math.ceil((b.max.y - oy) / cell))
    const k0 = Math.max(0, Math.floor((b.min.z - oz) / cell)), k1 = Math.min(nz - 1, Math.ceil((b.max.z - oz) / cell))
    for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) {
      let idx = i0 + nx * (j + ny * kk)
      for (let i = i0; i <= i1; i++, idx++) field[idx] = smin(field[idx], shape.sdf(ox + i * cell, oy + j * cell, oz + kk * cell), k)
    }
  })
  // The exact field at a point, and each felt's own (unblended) distance there.
  const colours = [...new Set(shapes.map(({ part }) => part.colour))]
  const colourOf = shapes.map(({ part }) => colours.indexOf(part.colour))
  const F = (x: number, y: number, z: number) => {
    let f = 1
    for (let s = 0; s < shapes.length; s++) if (padded[s].containsPoint(P.set(x, y, z))) f = smin(f, shapes[s].shape.sdf(x, y, z), k)
    return f
  }
  const P = new THREE.Vector3()
  const D = (x: number, y: number, z: number, out: Float32Array, at: number) => {
    for (let c = 0; c < colours.length; c++) out[at + c] = Infinity
    for (let s = 0; s < shapes.length; s++) {
      const d = shapes[s].shape.sdf(x, y, z)
      if (d < out[at + colourOf[s]]) out[at + colourOf[s]] = d
    }
  }

  // Surface nets: one vertex per cell the surface passes through, at the mean of its edge crossings.
  const pos: number[] = [], nrm: number[] = []
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const cid = (i: number, j: number, kk: number) => i + (nx - 1) * (j + (ny - 1) * kk)
  const fid = (i: number, j: number, kk: number) => i + nx * (j + ny * kk)
  const v = new Float32Array(8)
  const EDGES: [number, number][] = []
  for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) EDGES.push([a, a | bit])
  const e = cell * 0.3
  /** Pull a point onto the field with one Newton step; its normal from the gradient there. */
  const settle = (x: number, y: number, z: number) => {
    pos.push(0, 0, 0)
    nrm.push(0, 0, 0)
    const q = pos.length / 3 - 1
    project(q, x, y, z)
    return q
  }
  /** Vertex q to the point on the field nearest (x, y, z), with the field's normal there. */
  const project = (q: number, x: number, y: number, z: number) => {
    let f = F(x, y, z)
    let gx = F(x + e, y, z) - F(x - e, y, z), gy = F(x, y + e, z) - F(x, y - e, z), gz = F(x, y, z + e) - F(x, y, z - e)
    const g2 = (gx * gx + gy * gy + gz * gz) / (4 * e * e)
    if (g2 > 1e-12) {
      let sx = (f * gx) / (2 * e) / g2, sy = (f * gy) / (2 * e) / g2, sz = (f * gz) / (2 * e) / g2
      const sl = len3(sx, sy, sz)
      if (sl > cell) { sx *= cell / sl; sy *= cell / sl; sz *= cell / sl }
      x -= sx; y -= sy; z -= sz
      f = F(x, y, z)
      gx = F(x + e, y, z) - f; gy = F(x, y + e, z) - f; gz = F(x, y, z + e) - f
    }
    const nl = len3(gx, gy, gz) || 1
    pos[q * 3] = x; pos[q * 3 + 1] = y; pos[q * 3 + 2] = z
    nrm[q * 3] = gx / nl; nrm[q * 3 + 1] = gy / nl; nrm[q * 3 + 2] = gz / nl
  }
  for (let kk = 0; kk < nz - 1; kk++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0
    for (let c = 0; c < 8; c++) {
      v[c] = field[fid(i + (c & 1), j + ((c >> 1) & 1), kk + ((c >> 2) & 1))]
      if (v[c] < 0) mask |= 1 << c
    }
    if (mask === 0 || mask === 255) continue
    let sx = 0, sy = 0, sz = 0, n = 0
    for (const [a, b] of EDGES) {
      if ((v[a] < 0) === (v[b] < 0)) continue
      const t = v[a] / (v[a] - v[b])
      sx += (a & 1) + t * ((b & 1) - (a & 1))
      sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1))
      sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1))
      n++
    }
    cellVert[cid(i, j, kk)] = settle(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (kk + sz / n) * cell)
  }
  // Quads: each grid edge the surface crosses joins the four cells round it, wound so the face looks outwards.
  const tris: number[] = []
  const quad = (a: number, b: number, c: number, d: number, axis: number, inside: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    const p = (q: number, k2: number) => pos[q * 3 + k2]
    const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2)
    const wx = p(c, 0) - p(a, 0), wy = p(c, 1) - p(a, 1), wz = p(c, 2) - p(a, 2)
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx][axis]
    // The outward normal points along +axis when the edge starts inside.
    if ((n > 0) !== inside) [b, d] = [d, b]
    const d1 = (p(a, 0) - p(c, 0)) ** 2 + (p(a, 1) - p(c, 1)) ** 2 + (p(a, 2) - p(c, 2)) ** 2
    const d2 = (p(b, 0) - p(d, 0)) ** 2 + (p(b, 1) - p(d, 1)) ** 2 + (p(b, 2) - p(d, 2)) ** 2
    if (d1 <= d2) tris.push(a, b, c, a, c, d)
    else tris.push(a, b, d, b, c, d)
  }
  for (let kk = 1; kk < nz - 1; kk++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = field[fid(i, j, kk)] < 0
    if ((field[fid(i + 1, j, kk)] < 0) !== inside) quad(cellVert[cid(i, j - 1, kk - 1)], cellVert[cid(i, j, kk - 1)], cellVert[cid(i, j, kk)], cellVert[cid(i, j - 1, kk)], 0, inside)
    if ((field[fid(i, j + 1, kk)] < 0) !== inside) quad(cellVert[cid(i - 1, j, kk - 1)], cellVert[cid(i, j, kk - 1)], cellVert[cid(i, j, kk)], cellVert[cid(i - 1, j, kk)], 1, inside)
    if ((field[fid(i, j, kk + 1)] < 0) !== inside) quad(cellVert[cid(i - 1, j - 1, kk)], cellVert[cid(i, j - 1, kk)], cellVert[cid(i, j, kk)], cellVert[cid(i - 1, j, kk)], 2, inside)
  }
  // Islands: a speck of surface the grid caught on its own (a thin part's tip) is dropped before colouring, never a
  // colour patch (that would leave a hole).
  let islands = 0
  {
    const up = new Int32Array(pos.length / 3).map((_, i) => i)
    const find = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i] } return i }
    for (let t = 0; t < tris.length; t += 3) { const a = find(tris[t]); up[find(tris[t + 1])] = a; up[find(tris[t + 2])] = a }
    const count = new Map<number, number>()
    for (let t = 0; t < tris.length; t += 3) count.set(find(tris[t]), (count.get(find(tris[t])) ?? 0) + 1)
    if ([...count.values()].some((n) => n < ISLAND)) {
      const kept: number[] = []
      for (let t = 0; t < tris.length; t += 3) if (count.get(find(tris[t]))! >= ISLAND) kept.push(tris[t], tris[t + 1], tris[t + 2])
      islands = [...count.values()].filter((n) => n < ISLAND).length
      tris.length = kept.length
      for (let i = 0; i < kept.length; i++) tris[i] = kept[i]
    }
  }
  if (!tris.length) return null

  // Felts: each vertex's distance to each felt, its label the nearest.
  const nc = colours.length
  let dist = new Float32Array((pos.length / 3) * nc)
  const label: number[] = []
  const labelOf = (q: number) => {
    let best = 0
    for (let c = 1; c < nc; c++) if (dist[q * nc + c] < dist[q * nc + best]) best = c
    return best
  }
  for (let q = 0; q < pos.length / 3; q++) {
    D(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2], dist, q * nc)
    label.push(labelOf(q))
  }
  // A patch of one felt only a few vertices across, inside another (where two parts' surfaces nearly coincide), is a
  // fleck, not a panel: it takes the felt around it.
  if (nc > 1) {
    const nv = label.length
    const up = new Int32Array(nv).map((_, i) => i)
    const find = (i: number): number => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i] } return i }
    const nb: number[][] = Array.from({ length: nv }, () => [])
    for (let t = 0; t < tris.length; t += 3) for (let m = 0; m < 3; m++) {
      const a = tris[t + m], b = tris[t + (m + 1) % 3]
      nb[a].push(b)
      if (label[a] === label[b]) up[find(a)] = find(b)
    }
    const size = new Map<number, number>()
    for (let q = 0; q < nv; q++) if (nb[q].length) size.set(find(q), (size.get(find(q)) ?? 0) + 1)
    for (let q = 0; q < nv; q++) {
      if (!nb[q].length || size.get(find(q))! >= FLECK) continue
      const votes = new Map<number, number>()
      for (const o of nb[q]) if (find(o) !== find(q)) votes.set(label[o], (votes.get(label[o]) ?? 0) + 1)
      const best = [...votes].sort((a, b) => b[1] - a[1])[0]
      if (best) label[q] = best[0]
    }
    // A relabelled vertex is now as near its new felt as its old one, so the seam cut sees it on the new side.
    for (let q = 0; q < nv; q++) {
      const own = dist[q * nc + label[q]]
      for (let c = 0; c < nc; c++) if (c !== label[q] && dist[q * nc + c] < own) dist[q * nc + c] = own + 1e-6
    }
  }
  // Cut each triangle that two felts share along the line where they are equally near; shared cut vertices per edge.
  const regions: number[][] = colours.map(() => [])
  const seams: [number, number][] = []
  const cuts = new Map<string, number>()
  const cut = (a: number, b: number, A: number, B: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    const had = cuts.get(key)
    if (had !== undefined) return had
    const sa = dist[a * nc + A] - dist[a * nc + B], sb = dist[b * nc + A] - dist[b * nc + B]
    const t = THREE.MathUtils.clamp(sa / (sa - sb), 0, 1)
    const q = settle(pos[a * 3] + t * (pos[b * 3] - pos[a * 3]), pos[a * 3 + 1] + t * (pos[b * 3 + 1] - pos[a * 3 + 1]), pos[a * 3 + 2] + t * (pos[b * 3 + 2] - pos[a * 3 + 2]))
    cuts.set(key, q)
    return q
  }
  for (let t = 0; t < tris.length; t += 3) {
    const tri = [tris[t], tris[t + 1], tris[t + 2]]
    const ls = tri.map((q) => label[q])
    const distinct = [...new Set(ls)]
    if (distinct.length === 1) { regions[ls[0]].push(...tri); continue }
    if (distinct.length === 3) {
      // Three felts meet: each edge is cut where its two felts are equally near (the same cut its neighbour makes, so
      // no crack opens), and the three seams meet at the triangle's middle.
      const c = [0, 1, 2].map((m) => cut(tri[m], tri[(m + 1) % 3], ls[m], ls[(m + 1) % 3]))
      const g = settle((pos[tri[0] * 3] + pos[tri[1] * 3] + pos[tri[2] * 3]) / 3, (pos[tri[0] * 3 + 1] + pos[tri[1] * 3 + 1] + pos[tri[2] * 3 + 1]) / 3, (pos[tri[0] * 3 + 2] + pos[tri[1] * 3 + 2] + pos[tri[2] * 3 + 2]) / 3)
      for (let m = 0; m < 3; m++) {
        regions[ls[m]].push(tri[m], c[m], g, tri[m], g, c[(m + 2) % 3])
        seams.push([c[m], g])
      }
      continue
    }
    const [A, B] = distinct
    const side = (q: number) => dist[q * nc + A] - dist[q * nc + B] <= 0
    const polyA: number[] = [], polyB: number[] = [], seam: number[] = []
    for (let m = 0; m < 3; m++) {
      const a = tri[m], b = tri[(m + 1) % 3]
      ;(side(a) ? polyA : polyB).push(a)
      if (side(a) !== side(b)) {
        const c = cut(a, b, A, B)
        polyA.push(c); polyB.push(c); seam.push(c)
      }
    }
    for (const [poly, r] of [[polyA, A], [polyB, B]] as const) for (let m = 1; m + 1 < poly.length; m++) regions[r].push(poly[0], poly[m], poly[m + 1])
    if (seam.length === 2) seams.push([seam[0], seam[1]])
  }
  dist = new Float32Array(0)
  // The cut is straight inside each triangle, so on a coarse grid the seam zigzags (council: ragged edges). Each seam
  // vertex with two seam neighbours moves halfway to their middle and back onto the surface, twice. Both felts share
  // the vertex, so the seam stays closed.
  const along = new Map<number, number[]>()
  for (const [a, b] of seams) {
    if (!along.has(a)) along.set(a, [])
    if (!along.has(b)) along.set(b, [])
    along.get(a)!.push(b)
    along.get(b)!.push(a)
  }
  for (let pass = 0; pass < 2; pass++) {
    const moved: [number, number, number, number][] = []
    for (const [q, ns] of along) {
      if (ns.length !== 2) continue
      const [a, b] = ns
      moved.push([q, (pos[q * 3] + (pos[a * 3] + pos[b * 3]) / 2) / 2, (pos[q * 3 + 1] + (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2) / 2, (pos[q * 3 + 2] + (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2) / 2])
    }
    for (const [q, x, y, z] of moved) project(q, x, y, z)
  }

  // One mesh per felt, felt texture mapped triplanar in the figure's space.
  const meshes: THREE.Mesh[] = []
  let triangles = 0
  const repeat = o.repeat ?? 3
  regions.forEach((idx, c) => {
    if (!idx.length) return
    const remap = new Map<number, number>()
    const p: number[] = [], n: number[] = []
    const index: number[] = []
    for (const q of idx) {
      let r = remap.get(q)
      if (r === undefined) {
        r = p.length / 3
        remap.set(q, r)
        p.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2])
        n.push(nrm[q * 3], nrm[q * 3 + 1], nrm[q * 3 + 2])
      }
      index.push(r)
    }
    // Every triangle faces the way the field's normals do. After the vertices settle onto the field, a quad's winding
    // chosen on the grid can face inwards; culled, it showed as a pale fleck (the board or the room seen through it).
    for (let t = 0; t < index.length; t += 3) if (facing(p, n, index[t], index[t + 1], index[t + 2]) < 0) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]]
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
    geo.setIndex(index)
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    const map = fuzz(colours[c], o.seed + c * 7)
    const mat = o.felt(colours[c], map) as THREE.MeshStandardNodeMaterial
    mat.colorNode = triplanarTexture(texture(map), null, null, float(repeat))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'skin'
    mesh.userData.colour = colours[c]
    mesh.userData.skin = true
    // A piece of felt under three cells' area is a speck, not a panel or a spine (scripts read it through the checks).
    mesh.userData.stats = surfaceStats(geo, 3 * cell * cell)
    meshes.push(mesh)
    triangles += index.length / 3
  })

  // A running stitch along every seam: a short flat dash on each cut segment, in a thread darker than both felts.
  if (seams.length) {
    const dark = colours.reduce((a, c) => (new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 }).l < new THREE.Color(a).getHSL({ h: 0, s: 0, l: 0 }).l ? c : a))
    const thread = '#' + new THREE.Color(dark).lerp(new THREE.Color('#2a1c16'), 0.55).getHexString()
    const w = cell * 0.32
    const p: number[] = [], n: number[] = []
    const A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), M = new THREE.Vector3()
    for (const [a, b] of seams) {
      A.fromArray(pos, a * 3); B.fromArray(pos, b * 3)
      N.fromArray(nrm, a * 3).add(new THREE.Vector3().fromArray(nrm, b * 3)).normalize()
      const L = A.distanceTo(B)
      if (L < cell * 0.25) continue
      const s = A.clone().lerp(B, 0.2).addScaledVector(N, w * 0.35), t = A.clone().lerp(B, 0.8).addScaledVector(N, w * 0.35)
      M.copy(s).add(t).multiplyScalar(0.5).addScaledVector(N, w * 0.15)
      U.subVectors(t, s).cross(N).normalize().multiplyScalar(w / 2)
      const l = M.clone().add(U), r = M.clone().sub(U)
      // Wound to face along N.
      const face = new THREE.Vector3().subVectors(l, s).cross(new THREE.Vector3().subVectors(t, s)).dot(N) > 0
      const quad = face ? [s, l, t, s, t, r] : [s, t, l, s, r, t]
      for (const v3 of quad) { p.push(v3.x, v3.y, v3.z); n.push(N.x, N.y, N.z) }
    }
    if (p.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
      geo.computeBoundingBox()
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, o.felt(thread))
      mesh.name = 'stitches'
      mesh.userData.colour = thread
      mesh.userData.skin = true
      meshes.push(mesh)
      triangles += p.length / 9
    }
  }
  const kinds = shapes.reduce<Record<string, number>>((a, { shape }) => ({ ...a, [shape.kind]: (a[shape.kind] ?? 0) + 1 }), {})
  const notes = [`${shapes.length} parts (${Object.entries(kinds).map(([kk, n]) => `${n} ${kk}`).join(', ')}) in ${colours.length} felt${colours.length > 1 ? 's' : ''}, ${seams.length} seam stitches, ${nx}x${ny}x${nz} grid${islands ? `, ${islands} speck(s) dropped` : ''}${skipped.length ? `; kept apart: ${skipped.join(', ')}` : ''}`]
  const reach = (o: THREE.Vector3, d: THREE.Vector3, far: number) => {
    const at = (t: number) => F(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t)
    if (at(0) >= 0) return null
    // March out in half cells to the first crossing, then halve the bracket.
    let lo = 0, hi = 0
    for (let t = cell / 2; ; t += cell / 2) {
      if (t > far) return null
      if (at(t) >= 0) { hi = t; break }
      lo = t
    }
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (at(m) < 0) lo = m; else hi = m }
    return (lo + hi) / 2
  }
  return { meshes, fused: new Set(shapes.map(({ part }) => part.mesh)), notes, triangles, reach }
}
