// The thin core interface Village's own physics model (materials, gadgets, world
// rules) sits on. Each candidate engine gets one adapter; the scenes in scenes.ts
// only talk to this. Plain types only: Node runs these files by stripping types.

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number] // x, y, z, w

export type Shape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; half: Vec3 }
  /** Along local y. halfHeight is the half length of the segment, not counting the caps. */
  | { kind: 'capsule'; halfHeight: number; radius: number }
  /** n x n samples, heights[z * n + x], centred on the body, side length `size` metres. */
  | { kind: 'heightfield'; n: number; size: number; heights: Float32Array }

export interface Material {
  name: string
  friction: number
  restitution: number
  density: number
}

export type Motion = 'static' | 'dynamic' | 'kinematic'

export interface BodySpec {
  shape: Shape
  material: Material
  motion: Motion
  position: Vec3
  rotation?: Quat
  velocity?: Vec3
  gravityScale?: number
}

export type BodyId = number
export type JointId = number

/** A new touching pair, reported after the frame. impulse is N·s along the normal (0 if unknown yet). */
export interface Contact {
  a: BodyId
  b: BodyId
  point: Vec3
  /** From a towards b. */
  normal: Vec3
  impulse: number
}

/** A hinge between a body and the world. */
export interface HingeSpec {
  body: BodyId
  anchor: Vec3
  axis: Vec3
  limits?: [number, number]
  motor?: { velocity: number; maxTorque: number }
}

export interface Rules {
  gravity: Vec3
  /** Solver substeps (or engine steps) per frame. */
  substeps: number
  /** Continuous collision detection on dynamic bodies, where the engine has it. */
  ccd: boolean
  /** Typical object size in metres; Rapier scales its tolerances by it. */
  lengthUnit: number
}

export interface PhysicsCore {
  readonly name: string
  setRules(rules: Partial<Rules>): void
  addBody(spec: BodySpec): BodyId
  removeBody(id: BodyId): void
  addHinge(spec: HingeSpec): JointId
  setMotorVelocity(joint: JointId, velocity: number): void
  /** One frame of dt seconds; the core substeps according to the rules. */
  step(dt: number): void
  /** New contacts since the last frame. */
  contacts(): Contact[]
  applyImpulse(id: BodyId, impulse: Vec3): void
  position(id: BodyId): Vec3
  velocity(id: BodyId): Vec3
  /** Teleport and set velocity (resets angular velocity), and wake. */
  setState(id: BodyId, position: Vec3, velocity: Vec3, rotation?: Quat): void
  setKinematicTarget(id: BodyId, position: Vec3): void
  sleeping(id: BodyId): boolean
  /** Replace a w x h block of heights starting at sample (x0, z0); values[z * w + x]. */
  editHeights(id: BodyId, x0: number, z0: number, w: number, h: number, values: Float32Array): void
  /** Bodies whose shapes overlap a sphere (fire spread, explosions). */
  overlapSphere(center: Vec3, radius: number): BodyId[]
  dispose(): void
}

export const DEFAULT_RULES: Rules = { gravity: [0, -9.81, 0], substeps: 1, ccd: false, lengthUnit: 1 }
