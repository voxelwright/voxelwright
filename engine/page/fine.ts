// A thing of cells finer than the world's (#259), kept beside the world as a small volume of its own: its outside
// faces, as a body's are (pieces.ts), each cell a fraction of a world cell. An experiment's way in: the page is
// handed the cells, nothing is sent anywhere, and the world's own cells know nothing of it.
import type { Born } from './told.ts'

/**
 * The outside faces of a block of cells, rows of them merged, in the two words a face is to pieces.ts: where its row
 * starts (ten bits each of x, y, z), then how long it is, which way it looks and its kind. `cells[(y * d + z) * w + x]`.
 */
export function faces(cells: Uint16Array, size: readonly [number, number, number]): Uint32Array<ArrayBuffer> {
  return merged(cells, size).faces
}

/** What of a smooth word two faces must share to be one row: its normal to an eighth of its steps each way (a degree or two), its openness to a sixteenth, and its flag and blend. */
const alike = (v: number) => (v ? (((v & 1023) + 4) >> 3) | ((((v >>> 10) & 1023) + 4) >> 3) << 7 | ((v >>> 24) & 255) << 14 : 0)

/** A growing list of words. */
class Words {
  all = new Uint32Array(4096)
  n = 0
  push(v: number) { if (this.n === this.all.length) { const more = new Uint32Array(this.n * 2); more.set(this.all); this.all = more } this.all[this.n++] = v }
  done(): Uint32Array<ArrayBuffer> { return this.all.slice(0, this.n) }
}

/**
 * The faces, rows merged while kind stays the same. Given `corners`, it is asked of each face that shows (`i` its
 * cell) for the smooth words at its four corners, into `into` (along the row and across it: [0, 0], [1, 0], [0, 1],
 * [1, 1]), and says whether it has them; a row of smooth faces goes on only while all its corners are alike (a flat
 * stretch), and is given the words at its own four corners.
 */
function merged(cells: Uint16Array, [w, h, d]: readonly [number, number, number], corners?: (i: number, axis: number, side: number, into: Uint32Array) => boolean): { faces: Uint32Array<ArrayBuffer>; smooth: Uint32Array<ArrayBuffer> } {
  const out = new Words(), words = new Words(), here = new Uint32Array(4), first = new Uint32Array(4), last = new Uint32Array(4)
  // Axis 0: faces that look along x, rows along z. Axes 1 and 2: faces that look along y and z, rows along x.
  for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) {
    const step = side * 2 - 1
    const inner = axis === 0 ? w : d, along = axis === 0 ? d : w, stride = axis === 0 ? w : 1
    // The cell a face looks into, from its own: a step along the axis it looks along.
    const next = axis === 0 ? step : axis === 1 ? step * w * d : step * w
    for (let a = 0; a < h; a++) for (let b = 0; b < inner; b++) {
      // Whether the cell looked into is in the block at all is the same along the whole row.
      const lookedIn = axis === 0 ? b + step : axis === 1 ? a + step : b + step, room = axis === 0 ? w : axis === 1 ? h : d
      const open = lookedIn < 0 || lookedIn >= room
      const row = axis === 0 ? (a * d) * w + b : (a * d + b) * w
      let start = 0, kind = 0, soft = false
      for (let c = 0, i = row; c <= along; c++, i += stride) {
        const own = c < along ? cells[i] : 0
        // (Air after air: nothing to end and nothing begun. A row's start is set where its kind begins.)
        if (!own && !kind) continue
        const k = own && (open || !cells[i + next]) ? own : 0
        const s = k && corners ? corners(i, axis, side, here) : false
        if (k === kind && s === soft && c - start < 255) {
          if (!s) continue
          const a0 = alike(first[0]), a2 = alike(first[2])
          if (alike(first[1]) === a0 && alike(first[3]) === a2 && alike(here[0]) === a0 && alike(here[1]) === a0 && alike(here[2]) === a2 && alike(here[3]) === a2) { last.set(here); continue }
        }
        if (kind) {
          const sx = axis === 0 ? b : start, sz = axis === 0 ? start : b
          out.push((sx | (a << 10) | (sz << 20)) >>> 0)
          out.push(((c - start) | (axis << 8) | (side << 10) | (kind << 16)) >>> 0)
          if (corners) { if (soft) { words.push(first[0]); words.push(last[1]); words.push(first[2]); words.push(last[3]) } else for (let q = 0; q < 4; q++) words.push(0) }
        }
        start = c
        kind = k
        soft = s
        if (s) { first.set(here); last.set(here) }
      }
    }
  }
  return { faces: out.done(), smooth: words.done() }
}

// Smooth faces (#38). In cells of 2.5 cm a curved hood is a stair of treads and risers, and a face lit by its own
// square normal shows every step: treads bright with sky, risers dark, the lines of a 3D print. So each outside face
// is also given a normal from the shape round it, and how open it is (its share of the light from round it).
//
// The shape is the thing's cells with everything the outside air cannot reach counted as solid: a car is a shell a
// cell or two thick round its cabin, and the cabin's air behind a panel would pull a panel's normal inward. The air
// that reaches the box's sides is found by filling from them, glass and every other cell stopping it, and an air
// cell walled by cells on four or more of its six sides (a hole in a one-cell shell) stopping it too. Each corner of
// a face looks down the slope of that shape in a box round it (`reach` cells each way): the line fitted to how much
// of the shape lies in each slab of the box, each way, from a few lookups of the shape summed from a corner. Faces
// that meet at a corner share its normal, and a face is lit by its corners' blended across it, so a curve has no
// steps in its light, not even the size of a cell.
// A face whose air is not the outside air (a cabin's: seats, a dashboard, the inside of a door) keeps its own square
// normal: the inside, seen from the seat, stays as sharp as it was made. Nothing coarse changes: the core's bodies
// carry no smooth words and are drawn as they were.
//
// A face has four smooth words, one a corner (pieces.ts `vs`). A word: bit 31 set when it has one; bits 0-9 and 10-19 its normal folded flat (an
// octahedron, 0..1022 for -1..1, so that 0 is a whole step); bits 20-27 how open it is (0..255 for 0..1); bits 28-30 how far the smooth normal is
// taken over the square one (0..7). 0 is a face as it always was.
/** How far round a face its slope is measured, in cells, unless told: wider than a hood's steps are long. */
const REACH = 5
/** How far a face's normal may turn from its square one (cos): a thin fin, a mirror's stalk, a wire, has no clear slope round it. */
const LEAST_FACING = 0
/** How open a corner is: the share of the shape in a box 2 * OPEN_REACH cells across round it, against a flat face's half. */
const OPEN_REACH = 3

/**
 * The outside air of a block of cells, padded each way, and how many cells of its shape (all the outside air does not
 * reach) lie in each box from the corner to a cell.
 */
function shape(cells: Uint16Array, [w, h, d]: readonly [number, number, number], reach: number) {
  const pad = Math.max(reach, OPEN_REACH) + 2, W = w + 2 * pad, H = h + 2 * pad, D = d + 2 * pad, N = W * H * D, sz = W, sy = W * D
  // 0 air, 1 a cell, 2 the frame round it all, 3 a hole too small for air to get through (walled as a cell is).
  const wall = new Uint8Array(N)
  for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) {
    const row = (y * D + z) * W
    if (y === 0 || z === 0 || y === H - 1 || z === D - 1) wall.fill(2, row, row + W)
    else { wall[row] = 2; wall[row + W - 1] = 2 }
  }
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) {
    const from = (y * d + z) * w, to = ((y + pad) * D + z + pad) * W + pad
    for (let x = 0; x < w; x++) if (cells[from + x]) wall[to + x] = 1
  }
  // Holes a cell across: walled by cells on four sides or more (found first, then filled, so that none fills another).
  const holes = new Words()
  for (let y = pad; y < pad + h; y++) for (let z = pad; z < pad + d; z++) for (let i = (y * D + z) * W + pad, end = i + w; i < end; i++) {
    if (wall[i]) continue
    const n = (wall[i - 1] & 1) + (wall[i + 1] & 1) + (wall[i - sz] & 1) + (wall[i + sz] & 1) + (wall[i - sy] & 1) + (wall[i + sy] & 1)
    if (n >= 4) holes.push(i)
  }
  for (let k = 0; k < holes.n; k++) wall[holes.all[k]] = 3
  // The outside air, filled from a corner within the frame: the padding is air all round, so it reaches every side.
  const out = new Uint8Array(N), queue = new Int32Array(N)
  let head = 0, tail = 0
  const corner = (D + 1) * W + 1
  out[corner] = 1
  queue[tail++] = corner
  while (head < tail) {
    const i = queue[head++]
    let j = i - 1; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
    j = i + 1; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
    j = i - sz; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
    j = i + sz; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
    j = i - sy; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
    j = i + sy; if (!wall[j] && !out[j]) { out[j] = 1; queue[tail++] = j }
  }
  // Solid where the outside air is not (the frame is air), summed from the corner a way at a time: as it is, for how
  // open a corner is; and with slits a cell or two wide filled, for which way it looks. A door's seam is a slit: the
  // panels either side of it are one surface, and a seam left open turned their normals into it, a crease a hand wide.
  const sum = new Int32Array(N), shut = new Int32Array(N), z2 = 2 * sz, y2 = 2 * sy
  for (let i = 0; i < N; i++) sum[i] = wall[i] !== 2 && !out[i] ? 1 : 0
  shut.set(sum)
  const across = (i: number, t: number, t2: number) => (sum[i - t] & (sum[i + t] | sum[i + t2])) | (sum[i + t] & sum[i - t2])
  for (let y = 2; y < H - 2; y++) for (let z = 2; z < D - 2; z++) for (let i = (y * D + z) * W + 2, end = i + W - 4; i < end; i++) {
    if (!sum[i] && (across(i, 1, 2) | across(i, sz, z2) | across(i, sy, y2))) shut[i] = 1
  }
  for (const s of [sum, shut]) {
    for (let row = 0; row < N; row += W) for (let i = row + 1, end = row + W; i < end; i++) s[i] += s[i - 1]
    for (let y = 0; y < H; y++) for (let i = y * sy + sz, end = (y + 1) * sy; i < end; i++) s[i] += s[i - sz]
    for (let i = sy; i < N; i++) s[i] += s[i - sy]
  }
  return { pad, W, D, out, wall, sum, shut }
}

/** A unit normal folded flat (octahedral), ten bits each way. */
function fold(x: number, y: number, z: number): number {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z)
  let u = x / s, v = y / s
  if (z < 0) { const pu = u; u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1); v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1) }
  return Math.round((u * 0.5 + 0.5) * 1022) | (Math.round((v * 0.5 + 0.5) * 1022) << 10)
}

/**
 * A corner's normal and how open it is, as sums of lookups in the shape summed from the box's corner, at fixed steps
 * from the cell the corner is the low corner of (padded). A box is eight lookups; the normal along each axis is the
 * shape's slope along it in a box round the corner.
 */
interface Lookups { normal: { at: Int32Array; by: Float64Array }[]; open: Int32Array }
function lookups(W: number, D: number, r: number): Lookups {
  const sy = W * D
  // The eight corners of a box (cells from lo to hi, both within it) and the sign each is summed with.
  const corners = (lo: number[], hi: number[], by: number, into: Map<number, number>) => {
    for (const [cy, sy1] of [[hi[1], 1], [lo[1] - 1, -1]]) for (const [cz, sz1] of [[hi[2], 1], [lo[2] - 1, -1]]) for (const [cx, sx1] of [[hi[0], 1], [lo[0] - 1, -1]]) {
      const at = cy * sy + cz * W + cx
      into.set(at, (into.get(at) ?? 0) + by * sy1 * sz1 * sx1)
    }
  }
  // A box round the corner: 2r cells each way, r either side of it.
  const lo = [-r, -r, -r], hi = [r - 1, r - 1, r - 1], normal = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>()]
  let spread = 0
  for (let j = -r; j < r; j++) spread += (j + 0.5) ** 2
  for (let k = 0; k < 3; k++) for (let j = -r; j < r; j++) {
    // The shape's first moment along k about the corner (where along k each slab of the box lies, times how much of
    // the shape is in it), over that of an even spread: the slope of a line fitted to the shape along k, the same
    // however the face is turned. Down the slope, from more of the shape to less.
    const slabLo = [...lo], slabHi = [...hi]
    slabLo[k] = slabHi[k] = j
    corners(slabLo, slabHi, -(j + 0.5) / spread, normal[k])
  }
  const R = OPEN_REACH, open = new Map<number, number>()
  corners([-R, -R, -R], [R - 1, R - 1, R - 1], 1, open)
  return {
    normal: normal.map((m) => { const e = [...m.entries()].filter(([, v]) => Math.abs(v) > 1e-12); return { at: Int32Array.from(e, ([k]) => k), by: Float64Array.from(e, ([, v]) => v) } }),
    // (Each corner of one box is summed once, with a sign of 1 or -1.)
    open: Int32Array.from([...open.entries()].filter(([, v]) => v !== 0).flatMap(([k, v]) => [k, v])),
  }
}

/**
 * The same faces as `faces`, a row of smooth faces merged only over a flat stretch, and four smooth words for each
 * face, one a corner (0 for a face that keeps its square normal).
 */
export function facesWithSmooth(cells: Uint16Array, size: readonly [number, number, number], reach = REACH): { faces: Uint32Array<ArrayBuffer>; smooth: Uint32Array<ArrayBuffer> } {
  const [w, , d] = size, { pad, W, D, out, wall, sum, shut: seamless } = shape(cells, size, reach), sy = W * D, way = lookups(W, D, reach)
  const strides = [1, sy, W], openSize = (2 * OPEN_REACH) ** 3
  // Each corner's normal and openness, worked out once for the faces that meet there: its place in `known` by the
  // padded cell it is the low corner of (0: not yet).
  const slot = new Int32Array(W * D * (size[1] + 2 * pad))
  let known = new Float32Array(4 * 4096), count = 0
  const corner = (i: number) => {
    if (slot[i]) return slot[i] - 1
    const n = way.normal
    let nx = 0, ny = 0, nz = 0
    for (let k = 0, at = n[0].at, by = n[0].by; k < at.length; k++) nx += seamless[i + at[k]] * by[k]
    for (let k = 0, at = n[1].at, by = n[1].by; k < at.length; k++) ny += seamless[i + at[k]] * by[k]
    for (let k = 0, at = n[2].at, by = n[2].by; k < at.length; k++) nz += seamless[i + at[k]] * by[k]
    let l = Math.hypot(nx, ny, nz)
    if (l > 1e-6) {
      nx /= l; ny /= l; nz /= l
      // A step's moment in a box leans less than the step does (2t / (3 - t^2) for a lean of t, flat to a cube's
      // side): undone along the two lesser axes, against the greatest.
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), m = ax >= ay && ax >= az ? nx : ay >= az ? ny : nz
      const lean = (v: number) => { const r = v / m; return Math.abs(r) < 1e-6 ? 1.5 * r * m : ((-1 + Math.sqrt(1 + 3 * r * r)) / r) * m }
      if (m === nx) { ny = lean(ny); nz = lean(nz) } else if (m === ny) { nx = lean(nx); nz = lean(nz) } else { nx = lean(nx); ny = lean(ny) }
      l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
    } else nx = ny = nz = 0
    // How open: the share of the shape round the corner, against a flat face's half.
    let shut = 0
    for (let k = 0, o = way.open; k < o.length; k += 2) shut += sum[i + o[k]] * o[k + 1]
    if (count * 4 === known.length) { const more = new Float32Array(known.length * 2); more.set(known); known = more }
    known.set([nx, ny, nz, Math.max(0, Math.min(1, 1 - 2 * (shut / openSize - 0.5)))], count * 4)
    slot[i] = ++count
    return count - 1
  }
  return merged(cells, size, (cell, axis, side, into) => {
    const x = cell % w + pad, z = Math.floor(cell / w) % d + pad, y = Math.floor(cell / (w * d)) + pad
    const i = (y * D + z) * W + x, sign = side * 2 - 1
    // (A face onto a hole too small for air that opens to the outside air, the pit of a grille, is outside too. One
    // in the cabin, between a seat and the floor, is not.)
    const o = i + sign * strides[axis]
    if (!out[o] && !(wall[o] === 3 && (out[o - 1] | out[o + 1] | out[o - W] | out[o + W] | out[o - sy] | out[o + sy]))) return false
    const ox = axis === 0 ? sign : 0, oy = axis === 1 ? sign : 0, oz = axis === 2 ? sign : 0
    // The face's corners as pieces.ts makes them: along its row (u) and across it (v), and on its own side of its cell.
    const lift = side * strides[axis], u = axis === 0 ? W : 1, v = axis === 1 ? W : sy
    for (let q = 0; q < 4; q++) {
      const at = corner(i + lift + (q & 1) * u + (q >> 1) * v) * 4
      let nx = known[at], ny = known[at + 1], nz = known[at + 2]
      if (!nx && !ny && !nz) { nx = ox; ny = oy; nz = oz }
      // Never turned past side-on from the face's own square normal.
      const facing = nx * ox + ny * oy + nz * oz
      if (facing < LEAST_FACING) { const k = LEAST_FACING - facing; nx += ox * k; ny += oy * k; nz += oz * k; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l }
      into[q] = (fold(nx, ny, nz) | (Math.round(known[at + 3] * 255) << 20) | (7 << 28) | 0x80000000) >>> 0
    }
    return true
  })
}

/**
 * A thing of fine cells as a body for pieces.ts: its faces, and its middle as the point it is placed and turned by.
 * Square: smooth words cost several times as much, and are made off the page's thread (streetfaces.ts, main.ts `look`).
 */
export function thing(cells: Uint16Array, size: readonly [number, number, number]): Born {
  let n = 0
  for (const c of cells) if (c) n++
  return { id: 0, cells: n, size: [size[0], size[1], size[2]], com: [size[0] / 2, 0, size[2] / 2], low: [0, 0, 0], faces: faces(cells, size) }
}

/**
 * A thing of finer cells as rows for the world itself (edits.ts `fineRows`): the middle of its foot at `at` (the
 * world's cells), turned `quarters` quarter turns about y; `grain` of its cells (4 or 8) lie along one of the world's. Returns the rows and the box of the world's cells they reach.
 */
export function rowsOf(cells: Uint16Array, [w, h, d]: readonly [number, number, number], at: readonly [number, number, number], quarters = 0, grain = 4): { runs: Int32Array; box: [number, number, number, number, number, number] } {
  // Turned: its width and depth change places on odd turns.
  const [tw, td] = quarters & 1 ? [d, w] : [w, d]
  const kindAt = (x: number, y: number, z: number) => {
    const [sx, sz] = [[x, z], [z, d - 1 - x], [w - 1 - x, d - 1 - z], [w - 1 - z, x]][quarters & 3]
    return cells[(y * d + sz) * w + sx]
  }
  const low = [at[0] * grain - (tw >> 1), at[1] * grain, at[2] * grain - (td >> 1)], runs: number[] = []
  for (let y = 0; y < h; y++) for (let z = 0; z < td; z++) for (let x = 0; x < tw;) {
    const kind = kindAt(x, y, z)
    let end = x + 1
    while (end < tw && kindAt(end, y, z) === kind) end++
    if (kind) runs.push(low[0] + x, low[0] + end, low[1] + y, low[2] + z, kind)
    x = end
  }
  return { runs: Int32Array.from(runs), box: [Math.floor(low[0] / grain), Math.floor(low[1] / grain), Math.floor(low[2] / grain), Math.ceil((low[0] + tw) / grain), Math.ceil((low[1] + h) / grain), Math.ceil((low[2] + td) / grain)] }
}

/**
 * The handover (#259): a thing of finer cells that lies turned, at rest, beside the world, as rows of the world's
 * own finer cells where it lies. `pos` is where its `com` (in its own cells) is, in the world's cells, `rot` its turn
 * (x, y, z, w), `per` how many of its cells make one of the world's, `grain` how many finer cells the world's cell is
 * to hold each way (4 or 8). Every finer cell of the world whose middle lies in one of the thing's cells takes that
 * cell's kind: turned, a thing keeps its shape to within a cell of its own, where put down as the world's cells it
 * would keep it to within 10 cm.
 */
export function restedRows(cells: Uint16Array, [w, h, d]: readonly [number, number, number], com: readonly [number, number, number], pos: readonly [number, number, number], [qx, qy, qz, qw]: readonly [number, number, number, number], per: number, grain: number): { runs: Int32Array; box: [number, number, number, number, number, number]; cells: number } {
  // The turn as a matrix (its columns are where the thing's own x, y and z point).
  const m = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw), 2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw), 2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let corner = 0; corner < 8; corner++) {
    const p = [((corner & 1 ? w : 0) - com[0]) / per, ((corner & 2 ? h : 0) - com[1]) / per, ((corner & 4 ? d : 0) - com[2]) / per]
    for (let a = 0; a < 3; a++) { const v = (pos[a] + m[a * 3] * p[0] + m[a * 3 + 1] * p[1] + m[a * 3 + 2] * p[2]) * grain; lo[a] = Math.min(lo[a], Math.floor(v)); hi[a] = Math.max(hi[a], Math.ceil(v)) }
  }
  const runs: number[] = []
  let count = 0
  for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) {
    let start = 0, kind = 0
    for (let x = lo[0]; x <= hi[0]; x++) {
      let k = 0
      if (x < hi[0]) {
        // The middle of this finer cell, in the thing's own cells: the turn undone.
        const v = [(x + 0.5) / grain - pos[0], (y + 0.5) / grain - pos[1], (z + 0.5) / grain - pos[2]]
        const cx = Math.floor((m[0] * v[0] + m[3] * v[1] + m[6] * v[2]) * per + com[0]), cy = Math.floor((m[1] * v[0] + m[4] * v[1] + m[7] * v[2]) * per + com[1]), cz = Math.floor((m[2] * v[0] + m[5] * v[1] + m[8] * v[2]) * per + com[2])
        if (cx >= 0 && cy >= 0 && cz >= 0 && cx < w && cy < h && cz < d) k = cells[(cy * d + cz) * w + cx]
      }
      if (k === kind) continue
      if (kind) { runs.push(start, x, y, z, kind); count += x - start }
      start = x
      kind = k
    }
  }
  return { runs: Int32Array.from(runs), box: [Math.floor(lo[0] / grain), Math.floor(lo[1] / grain), Math.floor(lo[2] / grain), Math.ceil(hi[0] / grain), Math.ceil(hi[1] / grain), Math.ceil(hi[2] / grain)], cells: count }
}
