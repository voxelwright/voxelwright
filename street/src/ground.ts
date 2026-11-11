// The block's ground (#118): one plane falling towards +z with a trench cut across it, house
// fronts along its sides (houses.ts) and a wall nobody sees across each end. scene.ts builds the
// street's toy from these numbers; the page predicts its own walker on them. Metres, y up.
import type { Quat, Vec3 } from '../../home/src/engine/core.ts'

/** Rise over run: 14 in 100, about 8 degrees. */
export const GRADE = 0.14
/** Half the street's width (x) and half its length along the ground (z). */
export const HALF_W = 8
export const HALF_L = 30
/** Half the roadway's width: from there to the fronts is pavement, level with the road (a walker's own rule knows one height across the street). */
export const ROAD = 5
export const KERB = 0.25

const ANGLE = Math.atan(GRADE)
/** The ground's turn about x, as a quaternion. */
export const TILT: Quat = [Math.sin(ANGLE / 2), 0, 0, Math.cos(ANGLE / 2)]
const LEN = Math.hypot(1, GRADE)
/** The ground's normal. */
export const NORMAL: Vec3 = [0, 1 / LEN, GRADE / LEN]

/** A trench cut across the whole street: from and to (m along the ground from the street's middle) and how deep. Too wide to jump and too deep to climb out of: a thing to solve. */
export const TRENCH = { from: 4, to: 10, depth: 2.2 }

/** The road's own height under a point, as if nothing were cut into it. */
export const planeAt = (z: number) => -GRADE * z
/** Whether a point is over the trench. (Its walls lean with the street; this takes them as upright, which is 0.3 m out at its floor.) */
export const overTrench = (z: number) => z * LEN > TRENCH.from && z * LEN < TRENCH.to
/** The ground's height under a point. */
export const heightAt = (z: number) => planeAt(z) - (overTrench(z) ? TRENCH.depth * LEN : 0)

/** A point `along` metres down the street from its middle, `across` metres to the side, `up` metres off the ground (along the normal). */
export const onStreet = (across: number, along: number, up = 0): Vec3 => [across, (-GRADE * along) / LEN + up * NORMAL[1], along / LEN + up * NORMAL[2]]
