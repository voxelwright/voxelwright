// A toy is data (#74): parts (a shape made of a material), gadgets (a small Dreams-like kit,
// each with one to three knobs) and wires between gadgets. Nothing here knows what game a
// toy is: a pinball table works because a steel ball sits among walls, rubber posts and
// flippers, with sensors wired to kicks and a counter. world.ts builds and runs any toy.
import type { Motion, Shape, Vec3 } from './core'
import type { MaterialName } from './materials'

export interface PartSpec {
  id: string
  shape: Shape
  material: MaterialName
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
  /** The world body the signal is about (the ball that hit a sensor). */
  body?: number
  /** Unit vector from the gadget's part towards that body, world space. */
  dir?: Vec3
  at?: Vec3
}

/**
 * The kit. Ports: sensor out `hit`; kick in `fire`, out `kicked`; hinge and piston are driven by
 * an input (a named key binding); zone out `enter`; emitter in `spawn`, out `spawned`;
 * counter in `add` and `reset`, out `changed`.
 */
export type GadgetSpec =
  /** Fires `hit` when its part is struck harder than `threshold` (N·s). */
  | { id: string; kind: 'sensor'; part: string; knobs: { threshold: number } }
  /** On `fire`, adds `strength` m/s to the signal's body, away from its part. */
  | { id: string; kind: 'kick'; part: string; knobs: { strength: number } }
  /** A motor hinge on a dynamic part: swings to `swing` rad at `speed` rad/s while the input is held, back when released. */
  | { id: string; kind: 'hinge'; part: string; anchor: Vec3; axis: Vec3; input: string; knobs: { speed: number; torque: number; swing: number } }
  /** A kinematic part pulled back along -axis while the input is held (full after `charge` s, `travel` m), shot forward at up to `strength` m/s on release. */
  | { id: string; kind: 'piston'; part: string; axis: Vec3; input: string; knobs: { strength: number; travel: number; charge: number } }
  /** A sensor part: `enter` when a moving thing comes in. */
  | { id: string; kind: 'zone'; part: string }
  /** On `spawn`, puts its part back where it started, at rest, after `delay` s. */
  | { id: string; kind: 'emitter'; part: string; knobs: { delay: number } }
  /** Adds `step` on `add`, zero on `reset`; `changed` carries the total. Shown on `display` when given (a part's face). */
  | { id: string; kind: 'counter'; display?: string; knobs: { step: number } }

export type GadgetKind = GadgetSpec['kind']

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

/** Each knob's range, for the panel and for checking a tuned value. */
export const KNOBS: Record<string, { min: number; max: number; step: number }> = {
  threshold: { min: 0, max: 1, step: 0.001 },
  strength: { min: 0, max: 8, step: 0.05 },
  speed: { min: 0, max: 60, step: 0.5 },
  torque: { min: 0, max: 20, step: 0.1 },
  swing: { min: 0.1, max: 1.5, step: 0.01 },
  travel: { min: 0.01, max: 0.12, step: 0.005 },
  charge: { min: 0.1, max: 3, step: 0.05 },
  delay: { min: 0, max: 5, step: 0.1 },
  step: { min: -100, max: 1000, step: 1 },
}
