// A toy made of cells (#138): any toy's shapes filled with cells (voxels.ts), so it is drawn
// from them and breaks. Kept apart from toy.ts, which stays plain data and types that a script
// may load with no bundler.
import type { Quat, Shape, Vec3 } from './core'
import { quatOf, type CellsSpec, type PartSpec, type ToySpec } from './toy'
import { cellsFrom, pack, solidCells, type Kind, type Solid } from './voxels'

/** A shape of a part as a solid to fill with cells, where the part's own frame puts it (`at` and `turn` in the toy's frame). */
const solidOf = (shape: Exclude<Shape, { kind: 'compound' }>, at: Vec3, turn: Quat, kind: Kind): Solid =>
  ({ shape: shape.kind === 'box' ? { kind: 'box', half: shape.half } : shape.kind === 'sphere' ? { kind: 'sphere', radius: shape.radius } : { kind: shape.kind, halfHeight: shape.halfHeight, radius: shape.radius }, at, turn, kind })
const mul = (a: Quat, b: Quat): Quat => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
const turned = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]
}
/** A part's shapes (its pieces, or its one shape) as solids in a frame the part stands in at `at`, turned `turn`. */
function solidsOf(part: PartSpec, at: Vec3, turn: Quat): Solid[] {
  if (part.pieces) return part.pieces.map((piece) => solidOf(piece.shape, turned(turn, piece.at).map((x, i) => x + at[i]) as Vec3, mul(turn, quatOf(piece.turn ?? [0, 0, 0])), { material: piece.material ?? part.material, ...(piece.paint ?? part.paint ? { paint: piece.paint ?? part.paint } : {}) }))
  if (part.shape.kind === 'compound') return part.shape.boxes.map((b) => solidOf(b.round === 'ball' ? { kind: 'sphere', radius: [...b.half].sort((p, q) => p - q)[1] } : b.round === 'can' ? { kind: 'cylinder', halfHeight: b.half[1], radius: Math.min(b.half[0], b.half[2]) } : { kind: 'box', half: b.half }, turned(turn, b.at).map((x, i) => x + at[i]) as Vec3, mul(turn, b.rotation), { material: part.material, ...(part.paint ? { paint: part.paint } : {}) }))
  return [solidOf(part.shape, at, turn, { material: part.material, ...(part.paint ? { paint: part.paint } : {}) })]
}

/**
 * A toy made of cells (#138): the same toy, drawn from cells and breakable. Its still parts that
 * are seen and that no gadget names become parts of cells, held by their lowest `held` layers:
 * parts that touch are one block under the first one's id (a road, its kerbs and the earth under
 * them), a part that stands alone keeps its id (a lamp, a tree). Each moving part keeps its shape
 * to collide as while whole (`smooth`) and gets cells of its own. Parts that are hidden, sensors,
 * upright or already cells are left as they are.
 */
export function cellsToy(toy: ToySpec, cell: number, held = 1): ToySpec {
  const named = new Set(toy.gadgets.flatMap((g) => Object.values(g).filter((v): v is string => typeof v === 'string')))
  const plain = (p: PartSpec) => !p.cells && !p.hidden && !p.sensor && !named.has(p.id)
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  const still = toy.parts.filter((p) => plain(p) && (p.motion ?? 'static') === 'static').map((part) => {
    const solids = solidsOf(part, part.at, quatOf(part.turn ?? [0, 0, 0])), { v, low } = cellsFrom(solids, cell)
    return { part, solids, lo: low, hi: low.map((l, i) => l + v.size[i] * cell), group: -1 }
  })
  // Parts whose boxes touch are one block.
  const groups: (typeof still)[] = []
  for (const s of still) {
    const touching = groups.filter((g) => g.some((o) => [0, 1, 2].every((i) => s.lo[i] <= o.hi[i] + 1e-6 && o.lo[i] <= s.hi[i] + 1e-6)))
    const into = touching[0] ?? (groups.push([]), groups[groups.length - 1])
    into.push(s)
    for (const other of touching.slice(1)) { into.push(...other); groups.splice(groups.indexOf(other), 1) }
  }
  const blocks = new Map<PartSpec, PartSpec | null>()
  for (const group of groups) {
    const members = still.filter((s) => group.includes(s))
    const { v, low } = cellsFrom(members.flatMap((s) => s.solids), cell)
    const half = v.size.map((n) => r((n * cell) / 2)) as Vec3
    // What most of it is made of is what the whole part is called (its cells know their own).
    const count = new Map<string, number>()
    for (const s of members) count.set(s.part.material, (count.get(s.part.material) ?? 0) + 1)
    members.forEach((s, i) => blocks.set(s.part, i ? null : {
      id: s.part.id, shape: { kind: 'box', half }, material: [...count].sort((a, b) => b[1] - a[1])[0][0], at: low.map((l, k) => r(l + half[k])) as Vec3,
      cells: { size: [...v.size], cell, kinds: v.kinds, data: pack(v), low: half.map((h) => -h) as Vec3, held },
    }))
  }
  const parts: PartSpec[] = []
  for (const p of toy.parts) {
    const block = blocks.get(p)
    if (block !== undefined) { if (block) parts.push(block); continue }
    if (!plain(p) || p.upright) { parts.push(p); continue }
    // A moving part: its cells in its own frame, its shape kept to collide as while it is whole.
    const { v, low } = cellsFrom(solidsOf(p, [0, 0, 0], [0, 0, 0, 1]), cell)
    if (!solidCells(v)) { parts.push(p); continue }
    parts.push({ ...p, cells: { size: [...v.size], cell, kinds: v.kinds, data: pack(v), low: low.map(r) as Vec3, smooth: true } })
  }
  return { ...toy, parts }
}
