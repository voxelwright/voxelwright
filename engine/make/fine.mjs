// A thing of cells finer than the world's (#372), as the maker handles it. A program (program.mjs) builds a thing
// in cells of 10, 2.5 or 1.25 cm. The world's cells are 10 cm and one of them may hold 4 or 8 finer cells along
// each way (#259), so a fine thing has a grain of 4 or 8.
//
// Everything that asks where a thing may stand, what is under it and whether it would fall works in the world's
// cells. So a fine thing has a stand-in: the thing in 10 cm cells, a cell filled wherever any of its finer cells
// is. The stand-in is placed and tried; the fine rows are what is sent.
import { FACINGS } from './form.mjs'

/** A thing made by a program, with its grain: 1 for cells of 10 cm, 4 for 2.5 cm, 8 for 1.25 cm. */
export const grained = (thing) => ({ ...thing, grain: thing.cm === 2.5 ? 4 : thing.cm === 1.25 ? 8 : 1 })

/**
 * A thing in the form the placing and the standing rule take (form.mjs `read`): cells of 10 cm, and nothing said of
 * parts. For a fine thing it is the stand-in: each of the world's cells that holds any of its finer cells, in the
 * kind most of them are.
 */
export function standin(thing) {
  const g = thing.grain, [w, h, d] = thing.size
  const plain = { name: thing.name, parts: 0, said: [], record: {}, left: thing.left ?? [], kept: thing.kept ?? 1, crumbs: thing.crumbs ?? 0 }
  if (g === 1) return { ...plain, size: thing.size, cells: thing.cells, by: new Uint16Array(thing.cells.length), filled: thing.filled }
  const W = Math.ceil(w / g), H = Math.ceil(h / g), D = Math.ceil(d / g), cells = new Uint16Array(W * H * D), count = new Map()
  let filled = 0
  for (let Y = 0; Y < H; Y++) for (let Z = 0; Z < D; Z++) for (let X = 0; X < W; X++) {
    count.clear()
    for (let y = Y * g; y < Math.min(h, (Y + 1) * g); y++) for (let z = Z * g; z < Math.min(d, (Z + 1) * g); z++) { const row = (y * d + z) * w; for (let x = X * g; x < Math.min(w, (X + 1) * g); x++) { const k = thing.cells[row + x]; if (k) count.set(k, (count.get(k) ?? 0) + 1) } }
    if (!count.size) continue
    let best = 0, most = 0
    for (const [k, n] of count) if (n > most) { most = n; best = k }
    cells[(Y * D + Z) * W + X] = best; filled++
  }
  return { ...plain, size: [W, H, D], cells, by: new Uint16Array(cells.length), filled }
}

/**
 * A fine thing's rows in the world: [x0, x1, y, z, kind] counted in its own finer cells (page/edits.ts `fineRows`),
 * sorted by y, then z, then x. `origin` is where its stand-in stands (form.mjs `rows`: the middle of its footprint
 * and its lowest cells, in the world's cells), and it lies in its stand-in cell for cell.
 */
export function fineRows(thing, [x, base, z], facing) {
  const g = thing.grain, [w, h, d] = thing.size, [xx, xz, zx, zz] = FACINGS[facing]
  const W = Math.ceil(w / g), D = Math.ceil(d / g)
  // A finer cell `t` cells from the low side of the stand-in's middle cell, along a way that runs with the world's (+) or against it.
  const to = (mid, t, sign) => mid * g + (sign > 0 ? t : g - 1 - t)
  const out = []
  // The world's x is the thing's own x (south, north) or its z (east, west): runs are gathered along that.
  const along = xx !== 0, n = along ? w : d, m = along ? d : w
  for (let y = 0; y < h; y++) for (let j = 0; j < m; j++) {
    let from = -1, kind = 0
    for (let i = 0; i <= n; i++) {
      const k = i < n ? thing.cells[(y * d + (along ? j : i)) * w + (along ? i : j)] : 0
      if (k === kind) continue
      if (kind) {
        // The run [from, i) along the thing's own way, as the world's x and z.
        const a = from - (along ? W >> 1 : D >> 1) * g, b = i - 1 - (along ? W >> 1 : D >> 1) * g, t = j - (along ? D >> 1 : W >> 1) * g
        const sx = along ? xx : xz, sz = along ? zz : zx
        const x0 = to(x, sx > 0 ? a : b, sx), x1 = to(x, sx > 0 ? b : a, sx), wz = to(z, t, sz)
        out.push([x0, x1 + 1, base * g + y, wz, kind])
      }
      from = i; kind = k
    }
  }
  return out.sort((p, q) => p[2] - q[2] || p[3] - q[3] || p[0] - q[0])
}
