// A block of cells (#138): the stuff a breakable thing is made of. Each cell is air or one of
// the block's kinds, and a kind names a material from the registry (materials.ts), so what a
// cell weighs, how it burns and how it is drawn all follow from the material, as for any part.
//
// Whole numbers in, whole numbers out, and nothing here knows about a solver, a page or a
// renderer: the world process and every page run the same edits on the same cells and hold the
// same block afterwards. An edit is told in cells, never in metres.

/** What a cell is made of: a material by name, and perhaps a paint over its colour (the look only). */
export interface Kind {
  material: string
  paint?: string
}

export interface Voxels {
  /** Cells along x, y and z. */
  size: readonly [number, number, number]
  /** A cell's edge, metres. */
  cell: number
  /** 0 is air, k is kinds[k - 1]. A layer (one y) is contiguous: x + size[0] * (z + size[2] * y). */
  cells: Uint8Array
  /** Up to 255. */
  kinds: Kind[]
}

/** Low corner (inclusive) and high corner (exclusive), in cells. */
export type Box = [number, number, number, number, number, number]

export const KINDS = 255

export function voxels(size: readonly [number, number, number], cell: number, kinds: Kind[] = []): Voxels {
  const [nx, ny, nz] = size
  if (![nx, ny, nz].every((n) => Number.isInteger(n) && n > 0 && n <= 1024) || !(cell > 0)) throw new Error('a block of cells is 1 to 1024 cells a side and its cell has a size')
  return { size: [nx, ny, nz], cell, cells: new Uint8Array(nx * ny * nz), kinds }
}

/** The number a kind has in this block, adding it if it is new. Throws when the block has all the kinds it can hold. */
export function kindOf(v: Voxels, material: string, paint?: string): number {
  const at = v.kinds.findIndex((k) => k.material === material && k.paint === paint)
  if (at >= 0) return at + 1
  if (v.kinds.length >= KINDS) throw new Error(`a block of cells has at most ${KINDS} kinds`)
  v.kinds.push(paint === undefined ? { material } : { material, paint })
  return v.kinds.length
}

export const cellAt = (v: Voxels, x: number, y: number, z: number): number =>
  x < 0 || y < 0 || z < 0 || x >= v.size[0] || y >= v.size[1] || z >= v.size[2] ? 0 : v.cells[x + v.size[0] * (z + v.size[2] * y)]

const clampBox = (v: Voxels, b: Box): Box => [Math.max(0, b[0]), Math.max(0, b[1]), Math.max(0, b[2]), Math.min(v.size[0], b[3]), Math.min(v.size[1], b[4]), Math.min(v.size[2], b[5])]

/** Sets every cell of a box to a kind (0 empties it). Returns how many cells changed. */
export function fillBox(v: Voxels, box: Box, kind: number): number {
  const [x0, y0, z0, x1, y1, z1] = clampBox(v, box), nx = v.size[0], nz = v.size[2], c = v.cells
  let changed = 0
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
    const row = nx * (z + nz * y)
    for (let x = x0; x < x1; x++) if (c[row + x] !== kind) { c[row + x] = kind; changed++ }
  }
  return changed
}

/**
 * Sets every cell whose middle is within `r` cells of the middle of cell `at` to a kind (0 carves
 * a hole). `only` limits it to cells that are solid (carving, painting) or to air (adding).
 * `rough` leaves the rim ragged, by `seed`. The lowest `keep` layers are never touched (the
 * footing a thing is held by: nobody digs through the bottom of the world).
 * Returns the box it touched and how many cells changed, or null when nothing did.
 */
export function fillSphere(v: Voxels, at: readonly [number, number, number], r: number, kind: number, only?: 'solid' | 'air', rough = 0, seed = 0, keep = 0): { box: Box; changed: number } | null {
  const [cx, cy, cz] = at, nx = v.size[0], nz = v.size[2], c = v.cells, r2 = r * r
  const [x0, y0, z0, x1, y1, z1] = clampBox(v, [cx - r, Math.max(cy - r, keep), cz - r, cx + r + 1, cy + r + 1, cz + r + 1])
  let changed = 0, bx0 = x1, by0 = y1, bz0 = z1, bx1 = x0, by1 = y0, bz1 = z0
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
    const rest = r2 - (y - cy) * (y - cy) - (z - cz) * (z - cz)
    if (rest < 0) continue
    const row = nx * (z + nz * y)
    for (let x = x0; x < x1; x++) {
      if ((x - cx) * (x - cx) > rest) continue
      // A rough edge: each cell near the rim stays or goes by a number of its own, the same on every machine.
      if (rough && (x - cx) * (x - cx) + r2 - rest > r2 * (1 - rough * chance(x, y, z, seed))) continue
      const was = c[row + x]
      if (was === kind || (only === 'solid' && !was) || (only === 'air' && was)) continue
      c[row + x] = kind
      changed++
      if (x < bx0) bx0 = x
      if (x >= bx1) bx1 = x + 1
      if (y < by0) by0 = y
      if (y >= by1) by1 = y + 1
      if (z < bz0) bz0 = z
      if (z >= bz1) bz1 = z + 1
    }
  }
  return changed ? { box: [bx0, by0, bz0, bx1, by1, bz1], changed } : null
}

/** A number from 0 to 1 for a cell and a seed, the same wherever it is worked out (whole-number arithmetic only). */
export function chance(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(seed, 2654435761)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** Takes the solid cells within `r` cells of cell `at` out of a block into a block of their own (its low corner is `at` less `r` each way), leaving the lowest `keep` layers. Null when there are none. */
export function takeSphere(v: Voxels, at: readonly [number, number, number], r: number, keep = 0): { block: Voxels; cells: number } | null {
  const side = 2 * r + 1, out = voxels([side, side, side], v.cell, v.kinds), [nx, ny, nz] = v.size
  let cells = 0
  for (let y = 0; y < side; y++) for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const X = at[0] - r + x, Y = at[1] - r + y, Z = at[2] - r + z
    if (X < 0 || Y < keep || Z < 0 || X >= nx || Y >= ny || Z >= nz || (x - r) * (x - r) + (y - r) * (y - r) + (z - r) * (z - r) > r * r) continue
    const i = X + nx * (Z + nz * Y)
    if (!v.cells[i]) continue
    out.cells[x + side * (z + side * y)] = v.cells[i]
    v.cells[i] = 0
    cells++
  }
  return cells ? { block: out, cells } : null
}

/** A number that two blocks with the same cells share, and two that differ almost never do: to tell a copy has kept up. */
export function sumOf(v: Voxels): number {
  let h = 2166136261
  for (let i = 0; i < v.cells.length; i++) if (v.cells[i]) h = Math.imul(h ^ (i * 31 + v.cells[i]), 16777619)
  return h >>> 0
}

/** How many cells are not air. */
export function solidCells(v: Voxels): number {
  let n = 0
  for (let i = 0; i < v.cells.length; i++) if (v.cells[i]) n++
  return n
}

/** A piece of a block that holds together: cells joined face to face. */
export interface Piece {
  /** Its number in the labels `pieces` filled. */
  label: number
  cells: number
  box: Box
  /** Whether one of its cells is held (see `pieces`). */
  held: boolean
}

let scratch = { labels: new Int32Array(0), stack: new Int32Array(0) }

/**
 * The pieces a block is in: cells that touch face to face are one piece. A piece with a cell
 * in the lowest `heldBelow` layers is held (a house stands on its footing; a loose thing has
 * none, so pass 0). `labels` (one per cell, the piece's label or 0) is good until the next call.
 */
export function pieces(v: Voxels, heldBelow = 0): { list: Piece[]; labels: Int32Array } {
  const [nx, ny, nz] = v.size, n = nx * ny * nz, c = v.cells, layer = nx * nz
  if (scratch.labels.length < n) scratch = { labels: new Int32Array(n), stack: new Int32Array(n) }
  const labels = scratch.labels, stack = scratch.stack
  labels.fill(0, 0, n)
  const list: Piece[] = []
  for (let start = 0; start < n; start++) {
    if (!c[start] || labels[start]) continue
    const label = list.length + 1
    let top = 0, cells = 0, held = false, x0 = nx, y0 = ny, z0 = nz, x1 = 0, y1 = 0, z1 = 0
    stack[top++] = start
    labels[start] = label
    while (top) {
      const i = stack[--top]
      const y = (i / layer) | 0, rem = i - y * layer, z = (rem / nx) | 0, x = rem - z * nx
      cells++
      if (y < heldBelow) held = true
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (z < z0) z0 = z
      if (z > z1) z1 = z
      let j
      if (x > 0 && c[(j = i - 1)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      if (x < nx - 1 && c[(j = i + 1)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      if (z > 0 && c[(j = i - nx)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      if (z < nz - 1 && c[(j = i + nx)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      if (y > 0 && c[(j = i - layer)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      if (y < ny - 1 && c[(j = i + layer)] && !labels[j]) { labels[j] = label; stack[top++] = j }
    }
    list.push({ label, cells, held, box: [x0, y0, z0, x1 + 1, y1 + 1, z1 + 1] })
  }
  return { list, labels }
}

/**
 * Takes a piece out of a block into a block of its own, as big as the piece's box, with the
 * same kinds. The piece's low corner in the old block is `piece.box`'s. `labels` is from the
 * `pieces` call that found it.
 */
export function take(v: Voxels, piece: Piece, labels: Int32Array): Voxels {
  const [x0, y0, z0, x1, y1, z1] = piece.box, nx = v.size[0], nz = v.size[2]
  const out = voxels([x1 - x0, y1 - y0, z1 - z0], v.cell, v.kinds)
  const ox = out.size[0], oz = out.size[2]
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
    const row = nx * (z + nz * y), to = ox * (z - z0 + oz * (y - y0)) - x0
    for (let x = x0; x < x1; x++) if (labels[row + x] === piece.label) { out.cells[to + x] = v.cells[row + x]; v.cells[row + x] = 0 }
  }
  return out
}

/** Empties a piece's cells (a crumb too small to be a thing of its own). */
export function drop(v: Voxels, piece: Piece, labels: Int32Array): void {
  const [x0, y0, z0, x1, y1, z1] = piece.box, nx = v.size[0], nz = v.size[2]
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
    const row = nx * (z + nz * y)
    for (let x = x0; x < x1; x++) if (labels[row + x] === piece.label) v.cells[row + x] = 0
  }
}

let near = { labels: new Int32Array(0), touched: new Int32Array(0), count: 0 }

/**
 * The pieces that came loose when the cells of `box` changed, found by looking only as far as
 * it must: outwards from the cells round the change. `labels` marks each loose piece's cells
 * with its label and is good until the next call.
 *
 * It trusts that before the change the block was whole: every cell joined to a held layer
 * (`heldBelow` > 0, a thing that stands on its footing), or all of it one piece (`heldBelow`
 * 0, a loose thing; then the piece the search is still inside when the others are known stays,
 * and the rest are returned). A hole in a standing thing costs the cells round it and a path
 * down to its footing; a hole in a loose thing that leaves the cells round it joined costs
 * only those; a piece that did come loose costs its own size. `added` says the change put
 * cells in as well as took them out: new cells may touch nothing, which in a loose thing only
 * the search of the whole block can tell.
 */
export function loosened(v: Voxels, box: Box, heldBelow = 0, added = false): { list: Piece[]; labels: Int32Array } {
  if (!heldBelow && added) {
    const { list, labels } = pieces(v, 0)
    if (list.length < 2) return { list: [], labels }
    const stays = list.reduce((a, b) => (b.cells > a.cells ? b : a))
    return { list: list.filter((p) => p !== stays), labels }
  }
  const [nx, ny, nz] = v.size, n = nx * ny * nz, layer = nx * nz, c = v.cells
  if (near.labels.length < n) near = { labels: new Int32Array(n), touched: new Int32Array(n), count: 0 }
  const labels = near.labels, touched = near.touched
  for (let i = 0; i < near.count; i++) labels[touched[i]] = 0
  let count = 0
  // Groups: one for each run of joined cells found so far; two that meet become one (the lower number leads).
  const lead: number[] = [0], held: boolean[] = [false], cells: number[] = [0], edge: number[][] = [[]]
  const lo: [number, number, number][] = [[0, 0, 0]], hi: [number, number, number][] = [[0, 0, 0]]
  const find = (a: number) => { while (lead[a] !== a) a = lead[a] = lead[lead[a]]; return a }
  const join = (a: number, b: number) => {
    a = find(a); b = find(b)
    if (a === b) return
    if (b < a) [a, b] = [b, a]
    lead[b] = a
    held[a] ||= held[b]
    cells[a] += cells[b]
    for (let k = 0; k < 3; k++) { lo[a][k] = Math.min(lo[a][k], lo[b][k]); hi[a][k] = Math.max(hi[a][k], hi[b][k]) }
  }
  const mark = (i: number, g: number, x: number, y: number, z: number) => {
    labels[i] = g
    touched[count++] = i
    const r = find(g), l = lo[r], h = hi[r]
    cells[r]++
    if (y < heldBelow) held[r] = true
    if (x < l[0]) l[0] = x
    if (x > h[0]) h[0] = x
    if (y < l[1]) l[1] = y
    if (y > h[1]) h[1] = y
    if (z < l[2]) l[2] = z
    if (z > h[2]) h[2] = z
  }
  const [x0, y0, z0, x1, y1, z1] = clampBox(v, [box[0] - 1, box[1] - 1, box[2] - 1, box[3] + 1, box[4] + 1, box[5] + 1])
  const inside = (x: number, y: number, z: number) => x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1
  /** Looks at the six cells round one: a free solid cell joins group g (onto `local` inside the box, onto the group's edge outside it); another group's cell joins the groups. Downwards last, so it is looked at first: the footing is found soon. */
  const spread = (i: number, g: number, local: number[] | null) => {
    const y = (i / layer) | 0, rem = i - y * layer, z = (rem / nx) | 0, x = rem - z * nx
    const step = (j: number, ax: number, ay: number, az: number) => {
      if (!c[j]) return
      const other = labels[j]
      if (other) { if (other !== g) join(g, other); return }
      mark(j, g, ax, ay, az)
      if (local && inside(ax, ay, az)) local.push(j)
      else edge[g].push(j)
    }
    if (y < ny - 1) step(i + layer, x, y + 1, z)
    if (x > 0) step(i - 1, x - 1, y, z)
    if (x < nx - 1) step(i + 1, x + 1, y, z)
    if (z > 0) step(i - nx, x, y, z - 1)
    if (z < nz - 1) step(i + nx, x, y, z + 1)
    if (y > 0) step(i - layer, x, y - 1, z)
  }
  // First only inside the box round the change: most changes leave everything there joined, and that settles it.
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const i = x + nx * (z + nz * y)
    if (!c[i] || labels[i]) continue
    const g = lead.length
    lead.push(g); held.push(false); cells.push(0); edge.push([]); lo.push([x, y, z]); hi.push([x, y, z])
    mark(i, g, x, y, z)
    const local = [i]
    while (local.length) spread(local.pop()!, g, local)
  }
  near.count = count
  const roots = () => { const set = new Set<number>(); for (let g = 1; g < lead.length; g++) set.add(find(g)); return set }
  // A loose thing whose cells round the hole are still joined is still one piece. A standing thing must still find its footing.
  const first = roots().size
  if (!first || (!heldBelow && first === 1)) return { list: [], labels }
  // Then each group in turn spreads beyond the box, until it meets its footing, meets another group, or runs out of cells: a piece.
  let staying = 0
  for (;;) {
    const busy = new Set<number>()
    for (let g = 1; g < lead.length; g++) {
      const todo = edge[g]
      if (!todo.length) continue
      if (held[find(g)]) { todo.length = 0; continue }
      for (let budget = 512; budget > 0 && todo.length && !held[find(g)]; budget--) spread(todo.pop()!, g, null)
      if (todo.length && !held[find(g)]) busy.add(find(g))
    }
    // Groups may have joined during the round: count the ones still spreading by who leads them now.
    const still = new Set<number>()
    for (const g of busy) if (!held[find(g)]) still.add(find(g))
    if (!still.size) break
    if (!heldBelow && still.size === 1 && roots().size > 1) {
      // A loose thing: every other piece is known, so the one still spreading is the one that stays.
      let others = true
      for (let g = 1; g < lead.length; g++) if (edge[g].length && find(g) !== [...still][0]) others = false
      if (others) { staying = [...still][0]; break }
    }
  }
  near.count = count
  const all = [...roots()]
  if (!heldBelow && !staying) staying = all.reduce((a, b) => (cells[b] > cells[a] ? b : a))
  const list: Piece[] = []
  for (const r of all) {
    if (heldBelow ? held[r] : r === staying) continue
    const b: Box = [lo[r][0], lo[r][1], lo[r][2], hi[r][0] + 1, hi[r][1] + 1, hi[r][2] + 1]
    // One label for the whole piece, so take() and drop() can tell its cells.
    for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) {
      const row = nx * (z + nz * y)
      for (let x = b[0]; x < b[3]; x++) { const l = labels[row + x]; if (l && l !== r && find(l) === r) labels[row + x] = r }
    }
    list.push({ label: r, cells: cells[r], held: false, box: b })
  }
  return { list, labels }
}

let seen = new Uint8Array(0)

/**
 * The solid cells of a box of the block as few boxes as a simple sweep finds: each grows along
 * x, then z, then y while every cell it would take is solid and not yet in a box. Six whole
 * numbers a box (low corner, high corner, in cells of the whole block). What a solver collides with.
 */
export function boxesOf(v: Voxels, within?: Box): Int16Array {
  const [x0, y0, z0, x1, y1, z1] = clampBox(v, within ?? [0, 0, 0, v.size[0], v.size[1], v.size[2]])
  const nx = v.size[0], nz = v.size[2], c = v.cells
  const wx = x1 - x0, wy = y1 - y0, wz = z1 - z0, n = wx * wy * wz
  if (seen.length < n) seen = new Uint8Array(n)
  seen.fill(0, 0, n)
  const at = (x: number, y: number, z: number) => x - x0 + wx * (z - z0 + wz * (y - y0))
  const free = (x: number, y: number, z: number) => c[x + nx * (z + nz * y)] !== 0 && !seen[at(x, y, z)]
  const out: number[] = []
  for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!free(x, y, z)) continue
    let ex = x + 1
    while (ex < x1 && free(ex, y, z)) ex++
    let ez = z + 1
    grow: for (; ez < z1; ez++) for (let i = x; i < ex; i++) if (!free(i, y, ez)) break grow
    let ey = y + 1
    rise: for (; ey < y1; ey++) for (let k = z; k < ez; k++) for (let i = x; i < ex; i++) if (!free(i, ey, k)) break rise
    for (let j = y; j < ey; j++) for (let k = z; k < ez; k++) seen.fill(1, at(x, j, k), at(ex - 1, j, k) + 1)
    out.push(x, y, z, ex, ey, ez)
  }
  return Int16Array.from(out)
}

/** A block's weight and where it balances: kg and a point in cells from its low corner, given each kind's kg/m³. */
export function weigh(v: Voxels, density: (kind: Kind) => number): { mass: number; centre: [number, number, number] } {
  const [nx, ny, nz] = v.size, c = v.cells, per = v.kinds.map((k) => density(k) * v.cell ** 3)
  let mass = 0, mx = 0, my = 0, mz = 0, i = 0
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++, i++) {
    const k = c[i]
    if (!k) continue
    const m = per[k - 1]
    mass += m
    mx += m * (x + 0.5)
    my += m * (y + 0.5)
    mz += m * (z + 0.5)
  }
  return mass ? { mass, centre: [mx / mass, my / mass, mz / mass] } : { mass: 0, centre: [nx / 2, ny / 2, nz / 2] }
}

// ── Cells on a wire or in a file ────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const toBase64 = (bytes: number[]) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=')
  }
  return out
}
const B64_AT = new Uint8Array(128)
for (let i = 0; i < 64; i++) B64_AT[B64.charCodeAt(i)] = i
const fromBase64 = (text: string) => {
  const n = text.length, pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((n >> 2) * 3 - pad)
  for (let i = 0, o = 0; i < n; i += 4) {
    const v = (B64_AT[text.charCodeAt(i)] << 18) | (B64_AT[text.charCodeAt(i + 1)] << 12) | (B64_AT[text.charCodeAt(i + 2)] << 6) | B64_AT[text.charCodeAt(i + 3)]
    if (o < out.length) out[o++] = v >> 16
    if (o < out.length) out[o++] = (v >> 8) & 255
    if (o < out.length) out[o++] = v & 255
  }
  return out
}

/**
 * A block's cells as text. Built things repeat: a row of a wall is the row under it, a row of a
 * floor is the row beside it. So each row (along x) is told as "the same as the row below", "the
 * same as the row before" or its own runs of one kind, and rows told the same way are counted.
 */
export function pack(v: Voxels): string {
  const [nx, ny, nz] = v.size, c = v.cells, out: number[] = []
  const number = (n: number) => { while (n > 127) { out.push((n & 127) | 128); n >>>= 7 } out.push(n) }
  const same = (a: number, b: number) => { for (let x = 0; x < nx; x++) if (c[a + x] !== c[b + x]) return false; return true }
  const empty = (a: number) => { for (let x = 0; x < nx; x++) if (c[a + x]) return false; return true }
  let code = -1, count = 0
  const flush = () => { if (count) { out.push(code); number(count) } count = 0 }
  for (let row = 0; row < ny * nz; row++) {
    const at = row * nx
    const below = row >= nz ? same(at, at - nz * nx) : empty(at)
    const how = below ? 0 : row > 0 && same(at, at - nx) ? 1 : 2
    if (how !== 2) {
      if (how !== code) { flush(); code = how }
      count++
      continue
    }
    flush()
    code = -1
    out.push(2)
    for (let x = 0; x < nx;) {
      const kind = c[at + x]
      let run = 1
      while (x + run < nx && c[at + x + run] === kind) run++
      out.push(kind)
      number(run)
      x += run
    }
  }
  flush()
  return toBase64(out)
}

/** The block `pack` told. Throws when the text does not tell a whole block of this size. */
export function unpack(size: readonly [number, number, number], cell: number, kinds: Kind[], text: string): Voxels {
  const v = voxels(size, cell, kinds), [nx, ny, nz] = v.size, c = v.cells, data = fromBase64(text)
  let i = 0, row = 0
  const number = () => { let n = 0, shift = 0, b; do { b = data[i++]; n |= (b & 127) << shift; shift += 7 } while (b & 128); return n }
  const rows = ny * nz
  while (i < data.length && row < rows) {
    const code = data[i++]
    if (code === 2) {
      const at = row * nx
      for (let x = 0; x < nx;) {
        const kind = data[i++], run = number()
        if (!(run > 0) || x + run > nx || kind > kinds.length) throw new Error('packed cells do not fit their block')
        if (kind) c.fill(kind, at + x, at + x + run)
        x += run
      }
      row++
      continue
    }
    const count = number()
    if (code > 1 || !(count > 0) || row + count > rows) throw new Error('packed cells do not fit their block')
    for (let k = 0; k < count; k++, row++) {
      const at = row * nx, from = code === 0 ? at - nz * nx : at - nx
      if (from >= 0) c.copyWithin(at, from, from + nx)
    }
  }
  if (row !== rows || i !== data.length) throw new Error('packed cells do not fit their block')
  return v
}

// ── Cells from shapes ───────────────────────────────────────────────────────

/** A shape to fill with one kind of cell: where it is and how it is turned (a quaternion x, y, z, w) in the block's frame, metres. */
export interface Solid {
  shape: { kind: 'box'; half: readonly [number, number, number] } | { kind: 'sphere'; radius: number } | { kind: 'cylinder' | 'capsule'; halfHeight: number; radius: number }
  at: readonly [number, number, number]
  turn?: readonly [number, number, number, number]
  kind: Kind
  /** Cells to empty instead of fill (a window's hole). */
  hole?: boolean
}

/**
 * A block of cells from shapes, later ones over earlier ones: a cell is the last shape its middle
 * is in. A shape thinner than a cell is fattened to one, so a trim or a post is never lost. The
 * block's cells sit on the frame's own lattice (multiples of `cell` from its origin), so two
 * blocks made in one frame line up. `low` is the block's low corner in that frame, metres.
 */
export function cellsFrom(solids: Solid[], cell: number): { v: Voxels; low: [number, number, number] } {
  // Each shape's reach in its own frame, fattened, and the box round it in the block's frame.
  const reach = solids.map((s) => {
    const sh = s.shape
    return sh.kind === 'box' ? sh.half.map((h) => Math.max(h, cell / 2)) : sh.kind === 'sphere' ? Array(3).fill(Math.max(sh.radius, 0.87 * cell))
      : [Math.max(sh.radius, 0.71 * cell), Math.max(sh.halfHeight, cell / 2) + (sh.kind === 'capsule' ? sh.radius : 0), Math.max(sh.radius, 0.71 * cell)]
  })
  const rot = solids.map((s) => {
    const [x, y, z, w] = s.turn ?? [0, 0, 0, 1]
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
  })
  const spans = solids.map((s, i) => {
    const m = rot[i], h = reach[i], out: number[] = []
    for (let a = 0; a < 3; a++) {
      const e = Math.abs(m[a * 3]) * h[0] + Math.abs(m[a * 3 + 1]) * h[1] + Math.abs(m[a * 3 + 2]) * h[2]
      out.push(Math.floor((s.at[a] - e) / cell + 1e-6), Math.ceil((s.at[a] + e) / cell - 1e-6))
    }
    return out
  })
  const lo = [0, 1, 2].map((a) => Math.min(...spans.filter((_, i) => !solids[i].hole).map((sp) => sp[a * 2])))
  const hi = [0, 1, 2].map((a) => Math.max(...spans.filter((_, i) => !solids[i].hole).map((sp) => sp[a * 2 + 1])))
  if (!lo.every(Number.isFinite)) throw new Error('cells need at least one shape')
  const v = voxels([Math.max(1, hi[0] - lo[0]), Math.max(1, hi[1] - lo[1]), Math.max(1, hi[2] - lo[2])], cell)
  const [nx, , nz] = v.size
  solids.forEach((s, i) => {
    const k = s.hole ? 0 : kindOf(v, s.kind.material, s.kind.paint), m = rot[i], h = reach[i], sp = spans[i], sh = s.shape
    const x0 = Math.max(0, sp[0] - lo[0]), x1 = Math.min(v.size[0], sp[1] - lo[0]), y0 = Math.max(0, sp[2] - lo[1]), y1 = Math.min(v.size[1], sp[3] - lo[1]), z0 = Math.max(0, sp[4] - lo[2]), z1 = Math.min(v.size[2], sp[5] - lo[2])
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      // The cell's middle in the shape's own frame: the turn's inverse is its transpose.
      const px = (x + lo[0] + 0.5) * cell - s.at[0], py = (y + lo[1] + 0.5) * cell - s.at[1], pz = (z + lo[2] + 0.5) * cell - s.at[2]
      const lx = m[0] * px + m[3] * py + m[6] * pz, ly = m[1] * px + m[4] * py + m[7] * pz, lz = m[2] * px + m[5] * py + m[8] * pz
      let inside
      if (sh.kind === 'box') inside = lx >= -h[0] && lx < h[0] && ly >= -h[1] && ly < h[1] && lz >= -h[2] && lz < h[2]
      else if (sh.kind === 'sphere') inside = lx * lx + ly * ly + lz * lz <= h[0] * h[0]
      else if (sh.kind === 'cylinder') inside = ly >= -h[1] && ly < h[1] && lx * lx + lz * lz <= h[0] * h[0]
      else { const along = Math.max(-sh.halfHeight, Math.min(sh.halfHeight, ly)); inside = lx * lx + (ly - along) * (ly - along) + lz * lz <= h[0] * h[0] }
      if (inside) v.cells[x + nx * (z + nz * y)] = k
    }
  })
  // The box round the shapes is generous (a turned shape, a cell whose middle a shape just misses): keep only the layers that have cells, so the lowest layer is what the thing stands on.
  const b = bounds(v)
  if (!b) return { v, low: [lo[0] * cell, lo[1] * cell, lo[2] * cell] }
  const out = voxels([b[3] - b[0], b[4] - b[1], b[5] - b[2]], cell, v.kinds)
  for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) out.cells.set(v.cells.subarray(b[0] + nx * (z + nz * y), b[3] + nx * (z + nz * y)), out.size[0] * (z - b[2] + out.size[2] * (y - b[1])))
  return { v: out, low: [(lo[0] + b[0]) * cell, (lo[1] + b[1]) * cell, (lo[2] + b[2]) * cell] }
}

/** The box round a block's solid cells, or null when it has none. */
export function bounds(v: Voxels): Box | null {
  const [nx, ny, nz] = v.size, c = v.cells
  let x0 = nx, y0 = ny, z0 = nz, x1 = 0, y1 = 0, z1 = 0, i = 0
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++, i++) {
    if (!c[i]) continue
    if (x < x0) x0 = x
    if (x >= x1) x1 = x + 1
    if (y < y0) y0 = y
    if (y >= y1) y1 = y + 1
    if (z < z0) z0 = z
    if (z >= z1) z1 = z + 1
  }
  return x1 > x0 ? [x0, y0, z0, x1, y1, z1] : null
}
