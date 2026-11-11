// The engine's one API (#74): everything a gadget kind, a panel, a test or (later) an agent's
// sandboxed code may do with a running world. World implements it; gadget kinds receive it.
// Things are named by key (`toy/part`); positions are world space unless a name says local
// (the toy's own frame). Plain data in and out.
import type { Quat, Shape, Vec3 } from './core'
import type { PhysicsEvent } from './events'
import type { Material } from './materials'
import type { Rules } from './rules'
import type { GadgetSpec, Signal } from './toy'

export interface ThingInfo {
  key: string
  toy: string
  material: string
  shape: Shape
  motion: 'static' | 'dynamic' | 'kinematic'
  position: Vec3
  rotation: Quat
  velocity: Vec3
  /** The position in its toy's frame. */
  local: Vec3
  /** kg; Infinity for a static thing. */
  mass: number
}

/** A running gadget, as its kind sees it. `state` is the kind's own numbers, kept in snapshots. */
export interface Gadget {
  /** `toy/gadget`. */
  id: string
  toy: string
  spec: GadgetSpec
  /** The thing it acts on (`toy/part`), when its spec names a part. */
  part?: string
  knobs: Record<string, number>
  state: Record<string, number>
}

/** A contact with a gadget's part, from that part's side. */
export interface Touch {
  /** The other thing's key. */
  other: string
  /** N·s estimate, 0 for sensor volumes. */
  impulse: number
  /** Unit vector from the part towards the other thing. */
  dir: Vec3
  point: Vec3
  /** The part is a sensor volume (nothing was pushed). */
  sensor: boolean
}

/** A snapshot of everything that moves or counts, to undo an experiment (World.restore). */
export interface Snapshot {
  clock: number
  rules: Rules
  things: Record<string, { p: Vec3; q: Quat; v: Vec3 }>
  gadgets: Record<string, { knobs: Record<string, number>; state: Record<string, number> }>
  respawns: { key: string; t: number }[]
  /** Fire and wetness per part (fire.ts's own snapshot), when fire runs. Restoring without it puts every fire out. */
  fire?: unknown
}

export interface WorldApi {
  /** The rules in force (read only: change them with setRules). */
  readonly rules: Rules
  /** Simulated seconds since the world started. */
  readonly clock: number
  /** Changes whenever a thing is added or taken away: whoever keeps a list of things reads it again. */
  readonly version: number
  setRules(raw: unknown, by: Extract<PhysicsEvent, { kind: 'rules' }>['by'], preset?: string): { ok: true; rules: Rules; clamped: string[] } | { ok: false; reason: string }

  // Reading
  /** Every thing's key. */
  keys(): string[]
  thing(key: string): ThingInfo | null
  material(name: string): Material | undefined
  /** Whether a named input (a key binding) is held. */
  held(input: string): boolean
  /** How many times each gadget output (`toy/gadget.port`) has fired. */
  signals(): Record<string, number>

  // Acting on moving things (each returns false when the key is not a dynamic thing)
  setVelocity(key: string, v: Vec3): boolean
  applyImpulse(key: string, impulse: Vec3): boolean
  /** At rest at a point in its toy's frame. */
  place(key: string, local: Vec3): boolean
  /** At a point in the world at once, moving at `velocity` (held to the speed limit); its turn is kept unless one is given. False for a point outside the world or below the floor. */
  moveTo(key: string, position: Vec3, velocity: Vec3, rotation?: Quat): boolean
  /** Back where it started, at rest, after `delay` simulated seconds (once, however often asked meanwhile). */
  respawn(key: string, delay: number): boolean

  // Joints, for gadget kinds (axes and anchors in the part's toy frame)
  addHinge(key: string, anchor: Vec3, axis: Vec3, limits: [number, number]): number
  addSlider(key: string, axis: Vec3, limits: [number, number]): number
  /** Moves a joint's travel limits (radians for a hinge, metres for a slider). */
  setLimits(joint: number, limits: [number, number]): void
  setMotor(joint: number, velocity: number, limit: number): void
  jointPosition(joint: number): number

  // Gadgets and signals
  /** A gadget output: reported as an event, then carried along its wires. */
  fire(gadget: Gadget, port: string, signal: Signal): void
  /** Draws a short text on a part's face (a score card). */
  show(key: string, text: string): void
  /** A direction in a toy's frame, in world space. */
  toWorldDir(toy: string, dir: Vec3): Vec3

  // Heat and fire (null, or why not)
  /** Sets a thing, or one named part of it ('sofa' in a merged kit), alight. */
  ignite(key: string, part?: string, by?: 'ask' | 'gadget' | 'code'): string | null
  /** Water on a thing or a part: puts out what burns there and wets it. */
  douse(key: string, part?: string, by?: 'ask' | 'gadget' | 'code'): string | null
  burning(key: string): boolean
  /** Rain over the home for some seconds (at most 60). */
  rain(seconds: number): string | null
  /** Lightning at a thing: great heat for a moment; it catches if it burns. */
  strike(key: string, part?: string): string | null

  // Undo
  snapshot(): Snapshot
  /** Puts a snapshot back, checking it like any other input; `clamped` lists what had to be corrected or was skipped. */
  restore(s: Snapshot): { clamped: string[] }
}
