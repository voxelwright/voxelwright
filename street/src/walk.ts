// How a resident walks (#118 spike): the one rule the world process applies to a walker's
// body and the page applies to its own walker ahead of the answer (prediction). Pure.
import type { Vec3 } from '../../home/src/engine/core.ts'
import { GRADE, HALF_L, HALF_W, KERB, NORMAL, heightAt } from './ground.ts'

/** The street's own normal, for whoever stands a walker on it. */
export const NORMAL_UP = NORMAL

export const TICK = 1 / 60
export const SPEED = 4.5
export const JUMP = 4.8
export const GRAVITY = 9.81
/** m/s²: a walker gets to speed in about a tenth of a second and pushes with mass × this, no harder. */
export const ACCEL = 40
/** In the air a walker steers with this much of its push. */
export const AIR = 0.25
/** The walker's capsule: half the straight part, and the caps' radius. */
export const HALF_H = 0.45
export const RADIUS = 0.3
export const MASS = 70
/** Ticks after a jump in which the ground is not felt, so the jump gets off it. */
export const HOP = 8
/** How far above its resting height a walker still counts as standing. */
export const REACH = 0.12

export interface Input {
  seq: number
  /** Where to go, in the world's x and z, at most 1 long. */
  x: number
  z: number
  jump: boolean
}

export interface Walker {
  p: Vec3
  v: Vec3
  /** Ticks left of HOP. */
  hop: number
  grounded: boolean
}

/** A capsule's centre above the point of the surface under it, standing on a surface with this normal. */
export const standing = (normal: Vec3) => HALF_H + RADIUS / normal[1]

/**
 * The velocity a walker has after one tick of `input`, from the velocity it has now. On the
 * ground (`normal` is the surface's) it moves along the surface; in the air (`normal` null)
 * it falls and steers a little.
 */
export function steer(v: Vec3, input: Input, normal: Vec3 | null): Vec3 {
  const len = Math.hypot(input.x, input.z), k = len > 1 ? 1 / len : 1
  const wx = input.x * k * SPEED, wz = input.z * k * SPEED
  const max = ACCEL * TICK * (normal ? 1 : AIR)
  const dx = wx - v[0], dz = wz - v[2], d = Math.hypot(dx, dz), s = d > max ? max / d : 1
  const x = v[0] + dx * s, z = v[2] + dz * s
  if (!normal) return [x, v[1] - GRAVITY * TICK, z]
  if (input.jump) return [x, JUMP, z]
  return [x, -(x * normal[0] + z * normal[2]) / normal[1], z]
}

const LIMIT_X = HALF_W - KERB - RADIUS, LIMIT_Z = (HALF_L - KERB - RADIUS) / Math.hypot(1, GRADE)

/** One tick of a walker on the bare street: what the page expects before the world answers. It knows the ground, the kerbs and the end walls, and nothing that moves. */
export function predict(w: Walker, input: Input): Walker {
  const rest = (z: number) => heightAt(z) + standing(NORMAL)
  const hop = Math.max(0, w.hop - 1)
  const grounded = hop === 0 && w.p[1] - rest(w.p[2]) <= REACH
  const v = steer(w.v, input, grounded ? NORMAL : null)
  const p: Vec3 = [w.p[0] + v[0] * TICK, w.p[1] + v[1] * TICK, w.p[2] + v[2] * TICK]
  if (Math.abs(p[0]) > LIMIT_X) { p[0] = Math.sign(p[0]) * LIMIT_X; v[0] = 0 }
  if (Math.abs(p[2]) > LIMIT_Z) { p[2] = Math.sign(p[2]) * LIMIT_Z; v[2] = 0 }
  const jumped = grounded && input.jump
  if (!jumped && (grounded || p[1] < rest(p[2]))) p[1] = rest(p[2])
  return { p, v, hop: jumped ? HOP : hop, grounded }
}
