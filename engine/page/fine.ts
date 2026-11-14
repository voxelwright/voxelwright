// A thing of cells finer than the world's (#259), kept beside the world as a small volume of its own: its outside
// faces, as a body's are (pieces.ts), each cell a fraction of a world cell. An experiment's way in: the page is
// handed the cells, nothing is sent anywhere, and the world's own cells know nothing of it.
import type { Born } from './told.ts'

/**
 * The outside faces of a block of cells, rows of them merged, in the two words a face is to pieces.ts: where its row
 * starts (ten bits each of x, y, z), then how long it is, which way it looks and its kind. `cells[(y * d + z) * w + x]`.
 */
export function faces(cells: Uint16Array, [w, h, d]: readonly [number, number, number]): Uint32Array<ArrayBuffer> {
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : cells[(y * d + z) * w + x])
  const out: number[] = []
  // Axis 0: faces that look along x, rows along z. Axes 1 and 2: faces that look along y and z, rows along x.
  for (let axis = 0; axis < 3; axis++) for (let side = 0; side < 2; side++) {
    const step = side * 2 - 1, n = [axis === 0 ? step : 0, axis === 1 ? step : 0, axis === 2 ? step : 0]
    const [outer, inner, along] = axis === 0 ? [h, w, d] : [h, d, w]
    for (let a = 0; a < outer; a++) for (let b = 0; b < inner; b++) {
      let start = 0, kind = 0
      for (let c = 0; c <= along; c++) {
        const [x, y, z] = axis === 0 ? [b, a, c] : [c, a, b]
        const k = c < along && !at(x + n[0], y + n[1], z + n[2]) ? at(x, y, z) : 0
        if (k === kind && c - start < 255) continue
        if (kind) {
          const [sx, sy, sz] = axis === 0 ? [b, a, start] : [start, a, b]
          out.push((sx | (sy << 10) | (sz << 20)) >>> 0, ((c - start) | (axis << 8) | (side << 10) | (kind << 16)) >>> 0)
        }
        start = c
        kind = k
      }
    }
  }
  return Uint32Array.from(out)
}

/** A thing of fine cells as a body for pieces.ts: its faces, and its middle as the point it is placed and turned by. */
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
