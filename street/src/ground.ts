// The block's ground (#118): one plane falling towards +z, kerbs along its sides and a wall
// across each end. scene.ts builds the street's toy from these numbers; the page predicts its
// own walker on them. Metres, y up.
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
