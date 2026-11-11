// Where the street's sun stands (#136): the one fact the sky, the light and the shade a
// resident asks for (problems.ts) agree on. A late afternoon: forty degrees up, behind you
// and a little west as you look down the hill, so it rakes along the fronts and lays the
// west row's shadow half across the road.
import type { Vec3 } from '../../home/src/engine/core.ts'

const UP = (40 * Math.PI) / 180, ALONG = Math.hypot(0.42, 0.9)
/** Towards the sun, a unit vector in the world. */
export const SUN: Vec3 = [(-0.42 / ALONG) * Math.cos(UP), Math.sin(UP), (-0.9 / ALONG) * Math.cos(UP)]
