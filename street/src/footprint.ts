// The ground a toy stands over (#118): half its size across and along the street, turned as the
// toy is, and where the middle of that is from the toy's own place. For standing a made thing
// clear of what is there (make.ts), and for knowing what a made thing spans (problems.ts).
import { boxOf } from '../../home/src/engine/made.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'

export function footprint(toy: ToySpec): { half: [number, number]; off: [number, number]; top: number } {
  const { lo, hi } = boxOf(toy), c = Math.cos(toy.frame.yaw), s = Math.sin(toy.frame.yaw)
  // The box's four corners on the ground, turned by the toy's yaw (the hill's tilt moves them by under a hundredth).
  const xs = [lo[0], hi[0]].flatMap((x) => [lo[2], hi[2]].map((z) => x * c + z * s)), zs = [lo[0], hi[0]].flatMap((x) => [lo[2], hi[2]].map((z) => -x * s + z * c))
  return {
    half: [(Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2],
    off: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...zs) + Math.min(...zs)) / 2],
    top: hi[1],
  }
}
