// A toy is data (#74): parts (a shape made of a material), gadgets (a small Dreams-like kit,
// each with one to three knobs) and wires between gadgets. Nothing here knows what game a
// toy is: a pinball table works because a steel ball sits among walls, rubber posts and
// flippers, with sensors wired to kicks and a counter. world.ts builds and runs any toy.
import type { Motion, Shape, Vec3 } from './core'

export interface PartSpec {
  id: string
  shape: Shape
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
 * kick, hinge, piston, zone, emitter, counter), usually a part it acts on, its knobs (checked
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
  /** Where the toy stands: a point, a turn about y, then a tilt about its own x (a playfield leaning toward the player). */
  frame: { at: Vec3; yaw: number; tilt: number }
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
const ID = /^[A-Za-z0-9_-]{1,48}$/

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
  if (!f || !finite(f.at, 3) || !inside(f.at) || !Number.isFinite(f.yaw) || !Number.isFinite(f.tilt)) return `${toy.id}: the frame is a finite point inside the world, a yaw and a tilt`
  if (!Array.isArray(toy.parts) || !Array.isArray(toy.gadgets) || !Array.isArray(toy.wires)) return `${toy.id}: parts, gadgets and wires are lists`
  const seen = new Set<string>()
  for (const part of toy.parts) {
    const name = `${toy.id}/${part?.id}`
    if (typeof part?.id !== 'string' || !ID.test(part.id) || seen.has(part.id)) return `${name}: a part id is plain and used once`
    seen.add(part.id)
    if (!finite(part.at, 3) || !inside(part.at)) return `${name}: at is a finite point inside the world`
    if (part.turn !== undefined && !finite(part.turn, 3)) return `${name}: turn is three finite angles`
    if (part.motion !== undefined && !['static', 'dynamic', 'kinematic'].includes(part.motion)) return `${name}: motion is static, dynamic or kinematic`
    const s = part.shape
    const sizes = s?.kind === 'box' ? (finite(s.half, 3) ? s.half : null) : s?.kind === 'sphere' ? (finite([s.radius], 1) ? [s.radius] : null)
      : s?.kind === 'capsule' || s?.kind === 'cylinder' ? (finite([s.halfHeight, s.radius], 2) ? [s.halfHeight, s.radius] : null) : null
    if (!sizes || sizes.some((x) => x < SIZE[0] || x > SIZE[1])) return `${name}: a ${s?.kind ?? 'missing'} shape needs finite sizes from ${SIZE[0]} to ${SIZE[1]} m`
  }
  const gadgets = new Set<string>()
  for (const g of toy.gadgets) {
    if (typeof g?.id !== 'string' || !ID.test(g.id) || gadgets.has(g.id)) return `${toy.id}/${g?.id}: a gadget id is plain and used once`
    gadgets.add(g.id)
  }
  return null
}
