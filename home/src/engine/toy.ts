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
