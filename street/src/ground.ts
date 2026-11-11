// The block's ground (#118 spike): one plane falling towards +z, kerbs along its sides and a
// wall across each end. The world process builds bodies from it; the page draws it and
// predicts its own walker on it. Metres, y up.
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'

/** Rise over run: 14 in 100, about 8 degrees. */
export const GRADE = 0.14
/** Half the street's width (x) and half its length along the ground (z). */
export const HALF_W = 8
export const HALF_L = 30
export const KERB = 0.25

const ANGLE = Math.atan(GRADE)
/** The ground's turn about x, as a quaternion. */
export const TILT: Quat = [Math.sin(ANGLE / 2), 0, 0, Math.cos(ANGLE / 2)]
const LEN = Math.hypot(1, GRADE)
/** The ground's normal. */
export const NORMAL: Vec3 = [0, 1 / LEN, GRADE / LEN]

/** The ground's height under a point. */
export const heightAt = (z: number) => -GRADE * z

/** A point `along` metres down the street from its middle, `across` metres to the side, `up` metres off the ground (along the normal). */
export const onStreet = (across: number, along: number, up = 0): Vec3 => [across, (-GRADE * along) / LEN + up * NORMAL[1], along / LEN + up * NORMAL[2]]

export interface Slab { half: Vec3; at: Vec3; color: number }
/** The static boxes of the block, all turned by TILT: the road, two kerbs, two end walls. */
export const SLABS: Slab[] = [
  { half: [HALF_W, 0.5, HALF_L], at: onStreet(0, 0, -0.5), color: 0x8f8a80 },
  { half: [KERB, 0.6, HALF_L], at: onStreet(-HALF_W, 0, 0.6), color: 0xd9d2c3 },
  { half: [KERB, 0.6, HALF_L], at: onStreet(HALF_W, 0, 0.6), color: 0xd9d2c3 },
  { half: [HALF_W, 1.5, KERB], at: onStreet(0, -HALF_L, 1.5), color: 0xd9d2c3 },
  { half: [HALF_W, 1.5, KERB], at: onStreet(0, HALF_L, 1.5), color: 0xd9d2c3 },
]
