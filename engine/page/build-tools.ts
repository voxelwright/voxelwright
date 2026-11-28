// Building by hand (#226): the shapes a builder stamps into the world, the rake that levels ground or lays a ramp,
// the stack that takes edits back and gives them again, and where a shape goes when it is aimed. All of it is pure:
// it reads the world only through a `sample(x, y, z)` it is given and answers with rows of cells (edits.ts), so it
// runs the same in the page, a worker and Node.
//
// Places are the world's finest cells, ten to a metre. A row is [x0, x1, y, z, kind] with x1 exclusive, and the rows
// of one edit come sorted by y, then z, then x, never overlapping, as the core reads them.
import { rows, type Edit } from './edits.ts'

export type Box = readonly [number, number, number, number, number, number]
export type Vec3 = readonly [number, number, number]
/** What a cell is, edits and all; 0 is air. */
export type Sample = (x: number, y: number, z: number) => number

/** Cells to a metre. */
export const M = 10

// ── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────

export type Shape = 'wall' | 'slab' | 'stairs' | 'arch' | 'roof' | 'pillar' | 'window_cut' | 'door_cut'
export const SHAPES: readonly Shape[] = ['wall', 'slab', 'stairs', 'arch', 'roof', 'pillar', 'window_cut', 'door_cut']
/** Each shape's size in cells: across (local x), high (y), deep (local z). */
export const SIZES: Readonly<Record<Shape, Vec3>> = {
  wall: [20, 30, 4], slab: [20, 2, 20], stairs: [10, 20, 20], arch: [20, 30, 4],
  roof: [20, 10, 20], pillar: [4, 30, 4], window_cut: [12, 14, 6], door_cut: [10, 22, 6],
}

export interface StampOptions {
  /** 'add' sets the shape's cells to `kind`; 'carve' empties its opening (or, for a solid shape, the shape itself). */
  mode: 'add' | 'carve'
  /** The material added; ignored when carving. */
  kind?: number
  /** Across, high, deep in cells; the shape's own size when left out. */
  size?: Vec3
  /** The thin way: a wall's or arch's depth, a slab's height, a roof's skin, a frame's width round an opening. */
  thickness?: number
  /** Turns in degrees: yaw about up, then pitch about the shape's across, then roll about its depth. */
  yaw?: number
  pitch?: number
  roll?: number
  /** Stairs: how many steps (each rise is high / steps, each tread deep / steps). */
  steps?: number
  /** Pillar: cells cut off each corner. */
  chamfer?: number
}

export interface Stamp {
  /** Rows of cells, sorted y, z, x; x1 exclusive. */
  runs: Int32Array
  /** The finest cells it can change; high corner exclusive. */
  box: Box
  /** How many cells. */
  cells: number
}

type Inside = (u: number, v: number, w: number) => boolean

/**
 * Which local cells (u across, v up, w deep; 0 ≤ u < W, 0 ≤ v < H, 0 ≤ w < D) a shape fills in each mode.
 * Solid shapes carve what they fill. An arch adds a wall with an arched hole and carves the arched hole; a window or
 * door cut carves its opening and adds the frame round it (sides and head, and a sill for a window), the width of
 * `thickness`, so the same shape both cuts the hole and frames it.
 */
function inside(shape: Shape, mode: 'add' | 'carve', W: number, H: number, D: number, o: StampOptions): Inside {
  const all: Inside = () => true
  switch (shape) {
    case 'wall': case 'slab': return all
    case 'stairs': {
      const steps = Math.max(1, Math.min(D, H, Math.round(o.steps ?? Math.min(D, H) / 2)))
      // Rising along +w: the step a cell's tread is on, and the top of that step.
      return (_u, v, w) => v < Math.ceil(((Math.floor((w * steps) / D) + 1) * H) / steps)
    }
    case 'arch': {
      const side = Math.max(1, Math.round(W / 5)), r = Math.max(1, W / 2 - side), head = Math.max(1, Math.round(H / 7.5))
      const spring = H - head - r
      const hole: Inside = (u, v) => {
        const du = u + 0.5 - W / 2, dv = v + 0.5 - spring
        return Math.abs(du) < r && (dv < 0 || du * du + dv * dv < r * r)
      }
      return mode === 'carve' ? hole : (u, v, w) => !hole(u, v, w)
    }
    case 'roof': {
      // A gable at 45°: each cell deeper toward the ridge is a cell higher, its skin `thickness` cells thick.
      const skin = Math.max(1, Math.round(o.thickness ?? 2))
      return (_u, v, w) => { const top = Math.min(w, D - 1 - w); return v <= top && v > top - skin }
    }
    case 'pillar': {
      const c = Math.max(0, Math.round(o.chamfer ?? 1))
      return (u, _v, w) => Math.min(u, W - 1 - u) + Math.min(w, D - 1 - w) >= c
    }
    case 'window_cut': case 'door_cut': {
      if (mode === 'carve') return all
      const f = Math.max(1, Math.round(o.thickness ?? 1)), sill = shape === 'window_cut'
      return (u, v) => u < f || u >= W - f || v >= H - f || (sill && v < f)
    }
  }
}

const RAD = Math.PI / 180
/** cos and sin of an angle in degrees, exact at quarter turns so that turned cells land on cells. */
function cs(deg: number): [number, number] {
  const q = deg / 90
  if (Math.abs(q - Math.round(q)) < 1e-9) return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][])[((Math.round(q) % 4) + 4) % 4]
  return [Math.cos(deg * RAD), Math.sin(deg * RAD)]
}

/** The turn as three columns: where the shape's across, up and deep point in the world. R = Ry(yaw) · Rx(pitch) · Rz(roll). */
export function basisOf(yaw = 0, pitch = 0, roll = 0): { right: Vec3; up: Vec3; forward: Vec3 } {
  const [cy, sy] = cs(yaw), [cp, sp] = cs(pitch), [cr, sr] = cs(roll)
  // Rx·Rz, then Ry on the left.
  const xz = [[cr, -sr, 0], [cp * sr, cp * cr, -sp], [sp * sr, sp * cr, cp]]
  const m = [0, 1, 2].map((c) => [cy * xz[0][c] + sy * xz[2][c], xz[1][c], -sy * xz[0][c] + cy * xz[2][c]] as const)
  return { right: m[0], up: m[1], forward: m[2] }
}

/**
 * A shape as rows of cells. `origin` is where the middle of its foot goes (its local (W/2, 0, D/2)); it turns about
 * that point. A cell is the shape's when its middle, turned back into the shape, falls in a cell the shape fills.
 */
export function stampRuns(shape: Shape, origin: Vec3, opts: StampOptions): Stamp {
  const [W, H, D] = (opts.size ?? SIZES[shape]).map((v) => Math.max(1, Math.round(v))) as unknown as Vec3
  const t = opts.thickness === undefined ? undefined : Math.max(1, Math.round(opts.thickness))
  // The thin way of the simple shapes is their size that way.
  const w = shape === 'wall' || shape === 'arch' ? [W, H, t ?? D] : shape === 'slab' ? [W, t ?? H, D] : [W, H, D]
  const [sw, sh, sd] = w
  const fill = inside(shape, opts.mode, sw, sh, sd, opts)
  const kind = opts.mode === 'carve' ? 0 : (opts.kind ?? 0)
  if (opts.mode === 'add' && !kind) throw new Error('stampRuns: adding needs a kind')
  const { right, up, forward } = basisOf(opts.yaw, opts.pitch, opts.roll)
  // The world box: the shape's eight corners, turned.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const a = (i & 1 ? sw : 0) - sw / 2, b = i & 2 ? sh : 0, c = (i & 4 ? sd : 0) - sd / 2
    for (let k = 0; k < 3; k++) {
      const p = origin[k] + right[k] * a + up[k] * b + forward[k] * c
      lo[k] = Math.min(lo[k], Math.floor(p + 1e-9)); hi[k] = Math.max(hi[k], Math.ceil(p - 1e-9))
    }
  }
  const out: number[] = []
  let cells = 0
  for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) {
    let start = 0, open = false
    for (let x = lo[0]; x <= hi[0]; x++) {
      let on = false
      if (x < hi[0]) {
        // The middle of the cell, from the origin, turned back (the basis is orthonormal: its transpose undoes it).
        const px = x + 0.5 - origin[0], py = y + 0.5 - origin[1], pz = z + 0.5 - origin[2]
        const u = Math.floor(px * right[0] + py * right[1] + pz * right[2] + sw / 2 + 1e-9)
        const v = Math.floor(px * up[0] + py * up[1] + pz * up[2] + 1e-9)
        const ww = Math.floor(px * forward[0] + py * forward[1] + pz * forward[2] + sd / 2 + 1e-9)
        on = u >= 0 && u < sw && v >= 0 && v < sh && ww >= 0 && ww < sd && fill(u, v, ww)
      }
      if (on && !open) { start = x; open = true }
      else if (!on && open) { out.push(start, x, y, z, kind); cells += x - start; open = false }
    }
  }
  return { runs: Int32Array.from(out), box: boxOf(out), cells }
}

/** A stamp as an edit for `change` (main.ts) and `Wand.changed`. */
export const stampEdit = (shape: Shape, origin: Vec3, opts: StampOptions): Edit => { const s = stampRuns(shape, origin, opts); return rows(s.runs, s.box) }

/** The box round rows, high corner exclusive; empty rows give an empty box at 0. */
export function boxOf(runs: ArrayLike<number>): Box {
  if (!runs.length) return [0, 0, 0, 0, 0, 0]
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < runs.length; i += 5) {
    b[0] = Math.min(b[0], runs[i]); b[3] = Math.max(b[3], runs[i + 1])
    b[1] = Math.min(b[1], runs[i + 2]); b[4] = Math.max(b[4], runs[i + 2] + 1)
    b[2] = Math.min(b[2], runs[i + 3]); b[5] = Math.max(b[5], runs[i + 3] + 1)
  }
  return b as unknown as Box
}

/** Single cells (x, y, z, kind one after another) as rows: sorted y, z, x, the last word on a cell winning, neighbours of one kind joined. */
export function runsOf(cells: ArrayLike<number>): Int32Array {
  const n = cells.length / 4, order = Array.from({ length: n }, (_, i) => i)
  const c = (i: number, k: number) => cells[i * 4 + k]
  // Stable, so the last of two words on one cell is the last after sorting too.
  order.sort((a, b) => c(a, 1) - c(b, 1) || c(a, 2) - c(b, 2) || c(a, 0) - c(b, 0))
  const out: number[] = []
  for (let j = 0; j < n; j++) {
    const i = order[j]
    if (j + 1 < n) { const k = order[j + 1]; if (c(k, 0) === c(i, 0) && c(k, 1) === c(i, 1) && c(k, 2) === c(i, 2)) continue }
    const at = out.length - 5
    if (at >= 0 && out[at + 1] === c(i, 0) && out[at + 2] === c(i, 1) && out[at + 3] === c(i, 2) && out[at + 4] === c(i, 3)) out[at + 1]++
    else out.push(c(i, 0), c(i, 0) + 1, c(i, 1), c(i, 2), c(i, 3))
  }
  return Int32Array.from(out)
}

// ── The rake ───────────────────────────────────────────────────────────────────────────────────────────

export interface Rake extends Stamp {
  /** Cells filled up to the plane, and cells cut down to it. */
  filled: number
  trimmed: number
}

/** Water is not ground: the rake neither stands on it nor cuts it (kinds.rs: 5). */
const WATER = 5
const solidGround = (k: number) => k !== 0 && (k & 15) !== WATER

/**
 * Levels the ground in a round brush (`radiusCells` across from `center`) to the plane through `center` with normal
 * `planeNormal`: flat when the normal is straight up, a ramp when it leans. Under the plane each column is filled from
 * its ground up with `fillMaterial` (or, when it is null, with what the ground's top is); above it, it is cut away. No
 * column changes more than `maxDeltaY` cells either way, and a column with no ground within `maxDeltaY` under the
 * plane is left alone, so the rake never leaves a floating sheet over a pit, and so is a column still solid `maxDeltaY`
 * cells over the plane, so it never cuts the foot from under a wall or a trunk.
 */
export function rakeRuns(sample: Sample, center: Vec3, planeNormal: Vec3, radiusCells: number, fillMaterial: number | null, maxDeltaY: number): Rake {
  const len = Math.hypot(planeNormal[0], planeNormal[1], planeNormal[2])
  const [nx, ny, nz] = planeNormal.map((v) => v / (len || 1))
  // Steeper than about 72° is a wall, not ground to rake.
  if (!(ny > 0.3)) throw new Error('rakeRuns: the plane must face up')
  const r = Math.max(0.5, radiusCells), reach = Math.ceil(r), most = Math.max(1, Math.round(maxDeltaY))
  const cells: number[] = []
  let filled = 0, trimmed = 0
  for (let z = Math.floor(center[2]) - reach; z <= Math.floor(center[2]) + reach; z++) {
    for (let x = Math.floor(center[0]) - reach; x <= Math.floor(center[0]) + reach; x++) {
      const dx = x + 0.5 - center[0], dz = z + 0.5 - center[2]
      if (dx * dx + dz * dz > r * r) continue
      // Cells under `top` are ground once raked; `top` and up are air.
      const top = Math.round(center[1] - (nx * dx + nz * dz) / ny)
      // Standing higher than the rake reaches (a wall, a trunk, a cliff): cutting its foot would leave it hanging.
      if (solidGround(sample(x, top + most, z))) continue
      for (let y = top; y < top + most; y++) if (solidGround(sample(x, y, z))) { cells.push(x, y, z, 0); trimmed++ }
      let ground = top - 1
      while (ground >= top - most && !solidGround(sample(x, ground, z))) ground--
      if (ground < top - most) continue
      const kind = fillMaterial ?? sample(x, ground, z)
      for (let y = ground + 1; y < top; y++) { cells.push(x, y, z, kind); filled++ }
    }
  }
  const runs = runsOf(cells)
  return { runs, box: boxOf(runs), cells: filled + trimmed, filled, trimmed }
}

export const rakeEdit = (...a: Parameters<typeof rakeRuns>): Edit => { const k = rakeRuns(...a); return rows(k.runs, k.box) }

// ── Undo and redo ──────────────────────────────────────────────────────────────────────────────────────

/** What every cell of `after` is now, as rows: what puts them back. Air is kept as rows of kind 0. */
export function captureBefore(sample: Sample, after: ArrayLike<number>): Int32Array {
  const cells: number[] = []
  for (let i = 0; i < after.length; i += 5) for (let x = after[i]; x < after[i + 1]; x++) cells.push(x, after[i + 2], after[i + 3], sample(x, after[i + 2], after[i + 3]))
  return runsOf(cells)
}

interface Step { mark: number; label: string; before: Int32Array; after: Int32Array }

/**
 * Edits taken back and given again, newest last. Each step keeps the rows it set and the rows that were there before
 * (taken with `captureBefore` against the world as it stood just before), so taking it back sets exactly those cells
 * back. Steps go back strictly in order, and a new step drops whatever had been taken back.
 *
 * Every step gets a mark, counting up; `watermark` is the mark of the newest step in the world (0 for none), and
 * `truncateTo(mark)` takes back everything newer than it, for rewinding to a moment without keeping a second history.
 * At most `depth` steps and `words` numbers are kept: the oldest go first, and `floor` is the oldest mark still
 * reachable.
 *
 * Cells finer than the world's (FINE, the core's `plain`) come back as their plain kind: rows cannot carry them.
 */
export class EditUndoStack {
  readonly depth: number
  readonly words: number
  private done: Step[] = []
  private undone: Step[] = []
  private next = 1
  private held = 0
  private dropped = 0

  constructor(depth = 64, words = 4_000_000) { this.depth = Math.max(1, depth); this.words = words }

  /** Keeps a step: the rows that were there and the rows that were set. Answers its mark. */
  push(before: Int32Array, after: Int32Array, label: string): number {
    for (const s of this.undone) this.held -= s.before.length + s.after.length
    this.undone = []
    const step = { mark: this.next++, label, before, after }
    this.done.push(step)
    this.held += before.length + after.length
    while (this.done.length > this.depth || (this.held > this.words && this.done.length > 1)) {
      const old = this.done.shift()!
      this.held -= old.before.length + old.after.length
      this.dropped = old.mark
    }
    return step.mark
  }

  /** Reads what `after` will cover, keeps the step, and answers the edit to apply. Call it before applying. */
  record(sample: Sample, after: Int32Array, label: string): Edit {
    this.push(captureBefore(sample, after), after, label)
    return rows(after, boxOf(after))
  }

  /** The edit that takes the newest step back, or null when there is none. */
  undo(): Edit | null {
    const s = this.done.pop()
    if (!s) return null
    this.undone.push(s)
    return rows(s.before, boxOf(s.before))
  }

  /** The edit that gives the last step taken back again, or null. */
  redo(): Edit | null {
    const s = this.undone.pop()
    if (!s) return null
    this.done.push(s)
    return rows(s.after, boxOf(s.after))
  }

  get canUndo() { return this.done.length > 0 }
  get canRedo() { return this.undone.length > 0 }
  /** What the next undo and redo would take back or give again. */
  get undoLabel() { return this.done.at(-1)?.label ?? null }
  get redoLabel() { return this.undone.at(-1)?.label ?? null }
  /** The mark of the newest step in the world, 0 for none. */
  get watermark() { return this.done.at(-1)?.mark ?? this.dropped }
  /** The oldest mark `truncateTo` can still reach. */
  get floor() { return this.dropped }

  /**
   * Takes back every step newer than `mark`, newest first, and forgets them (and anything taken back before): the
   * edits to apply, in order. A mark older than `floor` reaches only `floor`; `reached` says whether it got there.
   */
  truncateTo(mark: number): { edits: Edit[]; reached: boolean } {
    const edits: Edit[] = []
    while (this.done.length && this.done.at(-1)!.mark > mark) {
      const s = this.done.pop()!
      this.held -= s.before.length + s.after.length
      edits.push(rows(s.before, boxOf(s.before)))
    }
    for (const s of this.undone) this.held -= s.before.length + s.after.length
    this.undone = []
    return { edits, reached: mark >= this.dropped }
  }
}

// ── Where a shape goes ─────────────────────────────────────────────────────────────────────────────────

export type SnapMode = 'global' | 'local' | 'free'
export interface SnapState {
  mode: SnapMode
  /** Global: the grid, in cells (1, 2, 4 or 10). */
  step: number
  /** The turns asked for, in degrees. Global keeps yaw to quarter turns; free keeps all three to `angleStep`. */
  yaw: number
  pitch: number
  roll: number
  /** Free: degrees a turn goes by (15), or 0 for any angle. */
  angleStep: number
  /** Carving: the shape goes into the face aimed at (through a wall, down into a floor) instead of standing on it. */
  into?: boolean
}
/** The name the brief (#226) gives it. */
export type PlacementSnap = SnapState
export interface Placement { origin: Vec3; yaw: number; pitch: number; roll: number; basis: { right: Vec3; up: Vec3; forward: Vec3 } }

export const snapAngle = (deg: number, step: number) => (step > 0 ? Math.round(deg / step) * step : deg)
const wrap = (deg: number) => { const d = ((deg % 360) + 360) % 360; return Math.abs(d - 360) < 1e-9 ? 0 : d }
const DEG = 180 / Math.PI

/** The axis a normal mostly points along (0, 1, 2) and which way (±1). */
function axisOf(n: Vec3): [number, number] {
  const a = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]) > Math.abs(n[best]) ? k : best), 1)
  return [a, Math.sign(n[a]) || 1]
}

/**
 * Where a shape `shapeBounds` (across, high, deep, in cells) goes when its builder aims at `hitPoint` on a face looking
 * `hitNormal`. The answer's `origin` and turns are what `stampRuns` takes.
 *
 * - global: yaw in quarter turns, no pitch or roll; the shape's low corner lands on the `step` grid, and it sits on
 *   the face it is aimed at (on a floor, under a ceiling, against a wall).
 * - local: flush with the face and turned with it: against a wall its back lies on the wall and its front looks out;
 *   on a floor or a slope its foot lies on the face, its up along the normal, its yaw as asked in quarter turns.
 * - free: the nearest cell, on the face, and any turn kept to `angleStep`.
 *
 * With `into` (carving) each goes into the face by the shape's depth (or height, on a floor) instead.
 */
export function snapPlacement(hitPoint: Vec3, hitNormal: Vec3, shapeBounds: Vec3, snap: SnapState): Placement {
  const len = Math.hypot(hitNormal[0], hitNormal[1], hitNormal[2]) || 1
  const n = hitNormal.map((v) => v / len) as unknown as Vec3
  const [W, H, D] = shapeBounds
  if (snap.mode === 'local') {
    if (Math.abs(n[1]) < 0.7) {
      // A wall: the shape's deep way out of it, its back on it.
      const h = Math.hypot(n[0], n[2]), fx = n[0] / h, fz = n[2] / h
      const yaw = wrap(Math.round(Math.atan2(fx, fz) * DEG * 1e6) / 1e6)
      const out = snap.into ? -D / 2 : D / 2
      const origin: Vec3 = [hitPoint[0] + fx * out, Math.round(hitPoint[1]), hitPoint[2] + fz * out]
      return { origin: origin.map(Math.round) as unknown as Vec3, yaw, pitch: 0, roll: 0, basis: basisOf(yaw) }
    }
    // A floor, a slope or a ceiling: up along the normal (a ceiling's turned over, so what hangs stays upright), the yaw
    // asked for kept; pitch and roll from the normal undone by the yaw.
    const yaw = wrap(snapAngle(snap.yaw, 90)), [cy, sy] = cs(-yaw), f = n[1] < 0 ? -1 : 1
    const ux = f * (cy * n[0] + sy * n[2]), uy = f * n[1], uz = f * (-sy * n[0] + cy * n[2])
    const roll = Math.asin(Math.max(-1, Math.min(1, -ux))) * DEG, pitch = Math.atan2(uz, uy) * DEG
    const clean = (d: number) => (Math.abs(d) < 1e-9 ? 0 : d)
    const basis = basisOf(yaw, clean(pitch), clean(roll))
    // Under a ceiling the shape hangs: its foot goes H below the face. Carving, it goes into the face instead.
    const down = (n[1] > 0) === !snap.into ? 0 : H
    const origin: Vec3 = [hitPoint[0] - basis.up[0] * down, hitPoint[1] - basis.up[1] * down, hitPoint[2] - basis.up[2] * down]
    const flat = Math.abs(pitch) < 1e-9 && Math.abs(roll) < 1e-9
    return { origin: (flat ? origin.map(Math.round) : origin) as unknown as Vec3, yaw, pitch: flat ? 0 : clean(pitch), roll: flat ? 0 : clean(roll), basis }
  }
  const free = snap.mode === 'free'
  const yaw = wrap(free ? snapAngle(snap.yaw, snap.angleStep) : snapAngle(snap.yaw, 90))
  const pitch = free ? snapAngle(snap.pitch, snap.angleStep) : 0, roll = free ? snapAngle(snap.roll, snap.angleStep) : 0
  const step = free ? 1 : Math.max(1, Math.round(snap.step))
  // How far the shape reaches each way of the world, as turned: a quarter turn swaps across and deep.
  const quarter = Math.round(yaw / 90) % 2 === 1
  const ext = [quarter ? D : W, H, quarter ? W : D]
  const [axis, sign] = axisOf(n)
  const origin = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const face = Math.round(hitPoint[k])
    if (k === axis) {
      // On the face: a floor holds its foot, a ceiling its top, a wall its back; carving, the other side of the face.
      const s = snap.into ? -sign : sign
      origin[k] = k === 1 ? (s > 0 ? face : face - H) : face + (s * ext[k]) / 2
    } else if (k === 1) {
      origin[k] = Math.floor(hitPoint[1] / step) * step
    } else {
      // The middle of the foot, put so its low corner is on the grid.
      origin[k] = Math.round((hitPoint[k] - ext[k] / 2) / step) * step + ext[k] / 2
    }
  }
  return { origin: origin as unknown as Vec3, yaw, pitch, roll, basis: basisOf(yaw, pitch, roll) }
}
