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
  /**
   * Boxes fixed together in the body's frame (a piece of furniture from its parts' boxes). Not for toys.
   * A box marked `round` is the ball or the can (a cylinder along its local y) inside it, so the thing rolls.
   */
  | { kind: 'compound'; boxes: { half: Vec3; at: Vec3; rotation: Quat; round?: 'ball' | 'can' }[] }

export type Motion = 'static' | 'dynamic' | 'kinematic'

export interface BodySpec {
  shape: Shape
  motion: Motion
  position: Vec3
  rotation?: Quat
  velocity?: Vec3
  /** kg/m³; only dynamic bodies use it. */
  density: number
  /** kg, in place of density × volume (furniture is mostly air, so its box would weigh far too much). */
  mass?: number
  /** Never tips or spins: only moves (a walking person). */
  upright?: boolean
  /** Added asleep: it waits to be touched (or woken) before the solver moves it. */
  asleep?: boolean
  friction: number
  restitution: number
  gravityFactor?: number
  linearDamping?: number
  /** How fast its spin dies, 1/s (the solver's own small value when not given): a soft thing does not roll far. */
  angularDamping?: number
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
  /** Moves a joint's travel limits (rad for a hinge, m for a slider). */
  setLimits(joint: JointId, limits: [number, number]): void
  /** Takes a joint out of the world (a toy that failed to build). */
  removeJoint(joint: JointId): void
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
  /** A body that touches nothing (false) or collides again (true). */
  setSolid(id: BodyId, solid: boolean): void
  /** Moves a static body to a new pose (its owner moved it); nothing is woken. */
  setPose(id: BodyId, position: Vec3, rotation: Quat): void
  /** kg. */
  mass(id: BodyId): number
  sleeping(id: BodyId): boolean
  /** Wakes a sleeping body where it is (a held thing must not doze off in the hand). */
  wake(id: BodyId): void
  /** Bodies that woke or fell asleep since the last call, in order (a sleeping body costs the solver nothing). */
  activity(): { id: BodyId; awake: boolean }[]
  /** rad/s, world space. */
  angularVelocity(id: BodyId): Vec3
  setAngularVelocity(id: BodyId, velocity: Vec3): void
  /** Puts a moving body somewhere at rest and asleep (tidying up): nothing is woken. */
  rest(id: BodyId, position: Vec3, rotation: Quat): void
  /**
   * The first solid body a ray meets: from `origin` along `direction` (its length is how far to look),
   * not counting `ignore`. `normal` is the surface's there, world space.
   */
  castRay(origin: Vec3, direction: Vec3, ignore?: BodyId[]): { body: BodyId; point: Vec3; normal: Vec3; fraction: number } | null
  dispose(): void
}
