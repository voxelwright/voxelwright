// A toy is data (#74): parts (a shape made of a material), gadgets (a small Dreams-like kit,
// each with one to three knobs) and wires between gadgets. Nothing here knows what game a
// toy is: a pinball table works because a steel ball sits among walls, rubber posts and
// flippers, with sensors wired to kicks and a counter. world.ts builds and runs any toy.
import type { Motion, Quat, Shape, Vec3 } from './core'
import type { Kind } from './voxels'

/** One shape of a part made of several (PartSpec.pieces), in the part's own frame. */
export interface Piece {
  shape: Exclude<Shape, { kind: 'compound' }>
  /** In the part's frame, metres. */
  at: Vec3
  /** Euler angles in the part's frame, radians, XYZ order. */
  turn?: Vec3
  /** Paint over the part's own colour. */
  paint?: string
  /** What this piece's cells are made of, when the part is turned into cells and that is not the part's material (a car's glass, a lamp's pane). The part collides and weighs as its own material while whole. */
  material?: string
}

/**
 * A part made of cells (voxels.ts, #138): what it is drawn from, and what a blow takes out of it.
 * A still part collides as its cells. A moving one collides as its cells too, unless `smooth`
 * keeps its `shape` (a ball that rolls, a crate that is one box) until the first blow.
 */
export interface CellsSpec {
  /** Cells along x, y and z, and a cell's edge in metres. */
  size: [number, number, number]
  cell: number
  /** What its cells are made of: cell k is kinds[k - 1]. */
  kinds: Kind[]
  /** The cells, as voxels.ts pack() tells them. */
  data: string
  /** The block's low corner in the part's frame, metres. */
  low: Vec3
  /** A still part: how many of its lowest layers hold it up. What a blow cuts off from them falls. */
  held?: number
  smooth?: boolean
}

export interface PartSpec {
  id: string
  /** Made of cells: drawn from them, and breakable. `shape` is then the box round them, or with `smooth` what it collides as while whole. */
  cells?: CellsSpec
  /** A box, a sphere, a cylinder or a capsule. With `pieces` it is the compound piecesShape() makes of them. */
  shape: Shape
  /** One body made of several shapes (a dog: a body, a head, four legs), each drawn as it is. They move as one. */
  pieces?: Piece[]
  /** A name from the material registry (materials.ts). */
  material: string
  /** static unless said. */
  motion?: Motion
  /** In the toy's frame, metres. */
  at: Vec3
  /** Euler angles in the toy's frame, radians, XYZ order. */
  turn?: Vec3
  /** Paint over the material's own colour (the look only; the physics is the material's). */
  paint?: string
  /** A collider with no mesh (the room's walls behind their own furniture). */
  hidden?: boolean
  /** A trigger volume: reports what enters and never pushes. */
  sensor?: boolean
  /** kg, a moving part: in place of its material's density × its volume (a sofa is mostly air). */
  mass?: number
  /** A moving part that never tips or spins: it only moves (a person's body). */
  upright?: boolean
}

/** What travels along a wire: a value, and the thing it is about when there is one. */
export interface Signal {
  value: number
  /** The thing the signal is about, by key (the ball that hit a sensor). */
  thing?: string
  /** Unit vector from the gadget's part towards that thing, world space. */
  dir?: Vec3
  at?: Vec3
}

/**
 * A gadget in a toy: a kind from the gadget registry (gadgets.ts: the built-in kit is sensor,
 * kick, hinge, pivot, piston, zone, emitter, counter), usually a part it acts on, its knobs (checked
 * against the kind's ranges; missing ones take the kind's defaults) and any settings the kind
 * documents (a hinge's anchor and axis, an input name).
 */
export interface GadgetSpec {
  id: string
  kind: string
  part?: string
  knobs?: Record<string, number>
  [setting: string]: unknown
}

/** `gadget.port` to `gadget.port`. */
export interface Wire { from: string; to: string }

export interface ToySpec {
  id: string
  label: string
  /** Where the toy stands: a point, a turn about y, then a tilt about its own x (a playfield leaning toward the player), then a roll about its own z (with the tilt, flat on any slope). */
  frame: { at: Vec3; yaw: number; tilt: number; roll?: number }
  parts: PartSpec[]
  gadgets: GadgetSpec[]
  wires: Wire[]
  /** Input name to KeyboardEvent.code values. */
  inputs: Record<string, string[]>
  /** The part people choose to play with it, if any. */
  handle?: string
}

/** Nothing lives farther than this from the origin (m); a thing that gets past it is put back. */
export const WORLD_BOUND = 50
/** Part sizes (half extents, radii) are between these (m). */
const SIZE = [0.001, 20] as const
/** The most pieces one part is made of. */
const PIECES = 64
/** The most cells one part is made of. */
const CELLS = 8e6
const ID = /^[A-Za-z0-9_-]{1,48}$/

/** Euler angles (XYZ order, radians) as a quaternion. */
export const quatOf = ([x, y, z]: Vec3): Quat => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3]
}

/**
 * The one solid shape of a part made of pieces: a box for each, a ball for a sphere, a can for a
 * cylinder or a capsule (its caps squared off).
 */
export function piecesShape(pieces: Piece[]): Shape {
  return {
    kind: 'compound',
    boxes: pieces.map(({ shape: s, at, turn }) => ({
      half: s.kind === 'box' ? [...s.half] as Vec3 : s.kind === 'sphere' ? [s.radius, s.radius, s.radius] : [s.radius, s.halfHeight + (s.kind === 'capsule' ? s.radius : 0), s.radius],
      at: [...at] as Vec3, rotation: quatOf(turn ?? [0, 0, 0]),
      ...(s.kind === 'sphere' ? { round: 'ball' as const } : s.kind === 'box' ? {} : { round: 'can' as const }),
    })),
  }
}

const finite = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const inside = (v: number[]) => v.every((x) => Math.abs(x) <= WORLD_BOUND)

/**
 * Whether a toy's numbers can be built: ids that are plain, a finite frame and finite poses
 * inside the world, sizes in range, no id used twice. Returns null, or why not. (The solver
 * does not abort on NaN, zero or huge sizes; it carries on and poisons the whole world.)
 */
export function checkToy(toy: ToySpec): string | null {
  if (!toy || typeof toy.id !== 'string' || !ID.test(toy.id)) return 'a toy id is letters, digits, dashes and underscores'
  const f = toy.frame
  if (!f || !finite(f.at, 3) || !inside(f.at) || !Number.isFinite(f.yaw) || !Number.isFinite(f.tilt) || (f.roll !== undefined && !Number.isFinite(f.roll))) return `${toy.id}: the frame is a finite point inside the world, a yaw, a tilt and perhaps a roll`
  if (!Array.isArray(toy.parts) || !Array.isArray(toy.gadgets) || !Array.isArray(toy.wires)) return `${toy.id}: parts, gadgets and wires are lists`
  const seen = new Set<string>()
  for (const part of toy.parts) {
    const name = `${toy.id}/${part?.id}`
    if (typeof part?.id !== 'string' || !ID.test(part.id) || seen.has(part.id)) return `${name}: a part id is plain and used once`
    seen.add(part.id)
    if (!finite(part.at, 3) || !inside(part.at)) return `${name}: at is a finite point inside the world`
    if (part.turn !== undefined && !finite(part.turn, 3)) return `${name}: turn is three finite angles`
    if (part.motion !== undefined && !['static', 'dynamic', 'kinematic'].includes(part.motion)) return `${name}: motion is static, dynamic or kinematic`
    if (part.mass !== undefined && !(typeof part.mass === 'number' && part.mass >= 0.001 && part.mass <= 5000)) return `${name}: mass is 0.001 to 5000 kg`
    if (part.upright !== undefined && typeof part.upright !== 'boolean') return `${name}: upright is true or false`
    const sizesOf = (s: Shape | undefined) => s?.kind === 'box' ? (finite(s.half, 3) ? s.half : null) : s?.kind === 'sphere' ? (finite([s.radius], 1) ? [s.radius] : null)
      : s?.kind === 'capsule' || s?.kind === 'cylinder' ? (finite([s.halfHeight, s.radius], 2) ? [s.halfHeight, s.radius] : null) : null
    const s = part.shape
    if (part.cells !== undefined) {
      const c = part.cells
      if (!c || !finite(c.size, 3) || !c.size.every((n) => Number.isInteger(n) && n >= 1 && n <= 1024) || c.size[0] * c.size[1] * c.size[2] > CELLS) return `${name}: cells are 1 to 1024 a side and at most ${CELLS} in all`
      if (!(typeof c.cell === 'number' && c.cell >= 0.01 && c.cell <= 2)) return `${name}: a cell is 0.01 to 2 m`
      if (!Array.isArray(c.kinds) || !c.kinds.length || c.kinds.length > 255 || !c.kinds.every((k) => k && typeof k.material === 'string' && (k.paint === undefined || /^#[0-9a-f]{6}$/i.test(k.paint)))) return `${name}: cells have 1 to 255 kinds, each a material and perhaps a #rrggbb paint`
      if (typeof c.data !== 'string' || c.data.length > 8e6) return `${name}: cells' data is packed text`
      if (!finite(c.low, 3) || !inside(c.low)) return `${name}: cells' low corner is a finite point inside the world`
      if (c.held !== undefined && !(Number.isInteger(c.held) && c.held >= 0 && c.held <= 1024)) return `${name}: held is a number of layers`
      // The box round a block of cells may be as big as the block (a street's ground is one).
      if (!part.pieces && s?.kind === 'box' && finite(s.half, 3) && s.half.every((x) => x >= SIZE[0] && x <= 1024)) continue
    }
    if (part.pieces !== undefined) {
      // Made of pieces: each a plain shape in the part's frame, and the part's shape the compound of exactly those.
      if (!Array.isArray(part.pieces) || !part.pieces.length || part.pieces.length > PIECES) return `${name}: pieces is a list of 1 to ${PIECES} shapes`
      for (const piece of part.pieces) {
        const sizes = sizesOf(piece?.shape)
        if (!sizes || sizes.some((x) => x < SIZE[0] || x > SIZE[1])) return `${name}: a piece needs a box, sphere, cylinder or capsule with finite sizes from ${SIZE[0]} to ${SIZE[1]} m`
        if (!finite(piece.at, 3) || !inside(piece.at) || (piece.turn !== undefined && !finite(piece.turn, 3))) return `${name}: a piece's at is a finite point and its turn three finite angles`
        if (piece.material !== undefined && typeof piece.material !== 'string') return `${name}: a piece's material is a name`
      }
      if (s?.kind !== 'compound' || s.boxes.length !== part.pieces.length) return `${name}: a part made of pieces has the shape piecesShape() makes of them`
      continue
    }
    const sizes = sizesOf(s)
    if (!sizes || sizes.some((x) => x < SIZE[0] || x > SIZE[1])) return `${name}: a ${s?.kind ?? 'missing'} shape needs finite sizes from ${SIZE[0]} to ${SIZE[1]} m`
  }
  const gadgets = new Set<string>()
  for (const g of toy.gadgets) {
    if (typeof g?.id !== 'string' || !ID.test(g.id) || gadgets.has(g.id)) return `${toy.id}/${g?.id}: a gadget id is plain and used once`
    gadgets.add(g.id)
  }
  return null
}
