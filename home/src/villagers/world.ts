// Where villagers can stand in the kitchen and how they get between places.
// Hand-placed against the furniture in layout.ts, cabinets, chairs, table and fridge.
import * as THREE from 'three/webgpu'

const SEAT_TOP = 0.515 // chair seat 0.45 plus its cushion

/** Corridor nodes on the floor (x, z). Edges below keep clear of the table, chairs, plant and fridge. */
const NODES: Record<string, [number, number]> = {
  l0: [-1.95, 0.5], l1: [-1.95, -0.55], l2: [-1.7, -1.15],
  b0: [-0.85, -1.15], b1: [0.1, -1.15], b2: [0.72, -1.02],
  r0: [1.55, -0.72], r1: [1.6, -0.3], r2: [2.2, -0.7],
}
const EDGES: [string, string][] = [['l0', 'l1'], ['l1', 'l2'], ['l2', 'b0'], ['b0', 'b1'], ['b1', 'b2'], ['b2', 'r0'], ['r0', 'r1'], ['r0', 'r2'], ['r1', 'r2']]

export interface Spot {
  at: [number, number]
  /** Heading to face while working here; forward is (sin, cos). */
  face: number
  /** The corridor node this spot hangs off. */
  via: string
  /** A chair: hop from `at` onto this seat. */
  seat?: { x: number; z: number; yaw: number }
}

const chairSeat = (x: number, z: number, yaw: number) => ({ x, z, yaw })
export const SPOTS: Record<string, Spot> = {
  shelf: { at: [-1.88, -1.5], face: Math.PI, via: 'l2' },
  window: { at: [-0.85, -1.58], face: Math.PI, via: 'b0' },
  plant: { at: [0.5, -1.42], face: Math.PI * 0.8, via: 'b2' },
  fridge: { at: [1.42, -1.12], face: Math.PI + 0.12, via: 'r0' },
  sink: { at: [2.2, -1.08], face: Math.PI, via: 'r2' },
  counter: { at: [1.85, -0.62], face: Math.PI * 0.8, via: 'r2' },
  // The middle chair faces the camera across the table; the right one is seen in profile.
  seatMid: { at: [0.63, -0.6], face: -Math.PI / 2, via: 'b2', seat: chairSeat(0.2, -0.49, 0) },
  seatRight: { at: [0.98, -0.5], face: -Math.PI * 0.7, via: 'b2', seat: chairSeat(1.05, -0.05, -Math.PI / 2 + 0.35) },
}
export const SEAT_Y = SEAT_TOP

/** Breadth-first route between two spots' corridor nodes. */
function nodes(from: string, to: string): string[] {
  const prev = new Map<string, string | null>([[from, null]])
  const queue = [from]
  while (queue.length) {
    const n = queue.shift()!
    if (n === to) break
    for (const [a, b] of EDGES) {
      const next = a === n ? b : b === n ? a : null
      if (next && !prev.has(next)) {
        prev.set(next, n)
        queue.push(next)
      }
    }
  }
  const path: string[] = []
  for (let n: string | null | undefined = to; n; n = prev.get(n)) path.unshift(n)
  return path
}

/** A smooth floor path from one spot to another through the corridor. */
export function route(from: string, to: string): THREE.CatmullRomCurve3 {
  const a = SPOTS[from], b = SPOTS[to]
  const points: [number, number][] = [a.at]
  const via = nodes(a.via, b.via)
  for (const n of via) points.push(NODES[n])
  points.push(b.at)
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.12)
  if (clean.length === 2) clean.splice(1, 0, [(clean[0][0] + clean[1][0]) / 2, (clean[0][1] + clean[1][1]) / 2])
  return new THREE.CatmullRomCurve3(clean.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
}
