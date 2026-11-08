// The thin core interface Village's physics model (materials, gadgets, world rules) sits on,
// promoted from the #74 bench (home/bench/physics/core.ts). One adapter implements it
// (jolt.ts); everything above talks only to this, so the solver can be swapped. Plain data
// in and out: world-space metres, seconds, kilograms, N·s.

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number] // x, y, z, w

export type Shape =
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; half: Vec3 }
  /** Along local y. halfHeight is the half length of the segment, not counting the caps. */
  | { kind: 'capsule'; halfHeight: number; radius: number }
  /** Along local y. */
  | { kind: 'cylinder'; halfHeight: number; radius: number }

export type Motion = 'static' | 'dynamic' | 'kinematic'

export interface BodySpec {
  shape: Shape
  motion: Motion
  position: Vec3
  rotation?: Quat
  velocity?: Vec3
  /** kg/m³; only dynamic bodies use it. */
  density: number
  friction: number
  restitution: number
  gravityFactor?: number
  linearDamping?: number
  /** Reports contacts but never pushes (trigger zones). */
  sensor?: boolean
}

export type BodyId = number
export type JointId = number

/** A new touching pair, reported after the step. impulse is an estimate in N·s along the normal (0 for sensors). */
export interface Contact {
  a: BodyId
  b: BodyId
  point: Vec3
  /** From a towards b. */
  normal: Vec3
  impulse: number
  sensor: boolean
}

/** A hinge between a body and the world, in world space. Its angle is 0 where the body was made. */
export interface HingeSpec {
  body: BodyId
  anchor: Vec3
  axis: Vec3
  limits: [number, number]
}

/** A slider between a body and the world along `axis`, world space. Its position is 0 where the body was made. */
export interface SliderSpec {
  body: BodyId
  axis: Vec3
  limits: [number, number]
}

/** Village's combine rule for a touching pair: [friction, restitution]. Called inside the solver's callback: pure, no body changes. */
export type Combine = (a: BodyId, b: BodyId) => readonly [number, number]

export interface PhysicsCore {
  readonly name: string
  setGravity(g: Vec3): void
  setCombine(combine: Combine): void
  addBody(spec: BodySpec): BodyId
  removeBody(id: BodyId): void
  addHinge(spec: HingeSpec): JointId
  addSlider(spec: SliderSpec): JointId
  /** Drive a joint's motor at a velocity (rad/s or m/s) with at most this torque (N·m) or force (N). */
  setMotor(joint: JointId, velocity: number, limit: number): void
  /** A hinge's angle (rad) or a slider's position (m). */
  jointPosition(joint: JointId): number
  /** One step of dt seconds in `substeps` collision steps. */
  step(dt: number, substeps: number): void
  /** New contacts since the last call. */
  contacts(): Contact[]
  applyImpulse(id: BodyId, impulse: Vec3): void
  position(id: BodyId): Vec3
  rotation(id: BodyId): Quat
  velocity(id: BodyId): Vec3
  setVelocity(id: BodyId, velocity: Vec3): void
  /** Teleport and set velocity (resets angular velocity), and wake. */
  setState(id: BodyId, position: Vec3, velocity: Vec3, rotation?: Quat): void
  /** A kinematic body reaches this pose by the end of the next step of dt seconds, pushing what is in the way. */
  moveKinematic(id: BodyId, position: Vec3, rotation: Quat, dt: number): void
  setLinearDamping(id: BodyId, damping: number): void
  setGravityFactor(id: BodyId, factor: number): void
  sleeping(id: BodyId): boolean
  dispose(): void
}
