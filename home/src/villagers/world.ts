// Where villagers can stand in the kitchen and how they get between places.
// Hand-placed against the furniture in layout.ts, cabinets, chairs, table and fridge.
import * as THREE from 'three/webgpu'

const SEAT_TOP = 0.515 // chair seat 0.45 plus its cushion

/** Corridor nodes on the floor (x, z). Edges below keep clear of the table, chairs, plant and fridge. */
const NODES: Record<string, [number, number]> = {
  l0: [-1.95, 0.5], l1: [-1.95, -0.55], l2: [-1.7, -1.15],
  b0: [-0.85, -1.15], b1: [0.1, -1.15], b2: [0.72, -1.02],
  r0: [1.55, -0.72], r1: [1.6, -0.3], r2: [2.2, -0.7],
  // Open floor in front of the table (#42 talk prototype).
  f0: [-1.75, 1.3], f1: [-0.3, 1.45], f2: [1.15, 1.3], f3: [1.85, 0.45],
}
const EDGES: [string, string][] = [['l0', 'l1'], ['l1', 'l2'], ['l2', 'b0'], ['b0', 'b1'], ['b1', 'b2'], ['b2', 'r0'], ['r0', 'r1'], ['r0', 'r2'], ['r1', 'r2']]
/**
 * #42 talk prototype: walkers cross the room in the open, in front of the table,
 * instead of behind the far chairs where the room view loses them.
 */
const OPEN_EDGES: [string, string][] = [
  ...EDGES.filter(([a, b]) => !(a === 'b0' && b === 'b1')),
  ['l0', 'f0'], ['f0', 'f1'], ['f1', 'f2'], ['f2', 'f3'], ['f3', 'r1'],
]
export type Paths = 'kitchen' | 'open'
/** On open paths some spots are reached from a different node, so the walk avoids others' workplaces. */
const OPEN_VIA: Record<string, string> = { counter: 'r1' }
const via = (spot: string, paths: Paths) => (paths === 'open' && OPEN_VIA[spot]) || SPOTS[spot].via

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
  // The talk prototype's other seats: the far-left chair, and a fourth chair it adds on the near side.
  seatLeft: { at: [-1.2, -0.62], face: Math.PI / 2, via: 'l1', seat: chairSeat(-0.7, -0.49, 0) },
  plantSide: { at: [1.04, -1.48], face: -2.58, via: 'b2' },
  seatNear: { at: [0.62, 1.05], face: -Math.PI / 2, via: 'f2', seat: chairSeat(0.2, 0.86, Math.PI) },
}
/** Where the talk prototype puts its fourth chair, facing the table. */
export const NEAR_CHAIR = { x: 0.2, z: 0.86, yaw: Math.PI }
export const SEAT_Y = SEAT_TOP

/** Shortest route between two spots' corridor nodes. */
function nodes(from: string, to: string, paths: Paths): string[] {
  const edges = paths === 'open' ? OPEN_EDGES : EDGES
  const prev = new Map<string, string | null>([[from, null]])
  const cost = new Map<string, number>([[from, 0]])
  const open = new Set([from])
  while (open.size) {
    const n = [...open].reduce((x, y) => (cost.get(x)! <= cost.get(y)! ? x : y))
    open.delete(n)
    if (n === to) break
    for (const [a, b] of edges) {
      const next = a === n ? b : b === n ? a : null
      if (!next) continue
      const c = cost.get(n)! + Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1])
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c)
        prev.set(next, n)
        open.add(next)
      }
    }
  }
  const path: string[] = []
  for (let n: string | null | undefined = to; n; n = prev.get(n)) path.unshift(n)
  return path
}

/** A smooth floor path from one spot to another through the corridor. */
export function route(from: string, to: string, paths: Paths = 'kitchen'): THREE.CatmullRomCurve3 {
  return curve(SPOTS[from].at, via(from, paths), to, paths)
}

/** A path from wherever a villager stands, through its nearest corridor node, to a spot. */
export function routeFrom(x: number, z: number, to: string, paths: Paths = 'kitchen'): THREE.CatmullRomCurve3 {
  const used = new Set((paths === 'open' ? OPEN_EDGES : EDGES).flat())
  let near = via(to, paths), best = Infinity
  for (const n of used) {
    const d = Math.hypot(NODES[n][0] - x, NODES[n][1] - z)
    if (d < best) [near, best] = [n, d]
  }
  return curve([x, z], near, to, paths)
}

function curve(start: [number, number], via0: string, to: string, paths: Paths): THREE.CatmullRomCurve3 {
  const b = SPOTS[to]
  const points: [number, number][] = [start]
  for (const n of nodes(via0, via(to, paths), paths)) points.push(NODES[n])
  points.push(b.at)
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.12)
  if (clean.length === 2) clean.splice(1, 0, [(clean[0][0] + clean[1][0]) / 2, (clean[0][1] + clean[1][1]) / 2])
  return new THREE.CatmullRomCurve3(clean.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
}
