// Where villagers can stand in the house and how they get between places.
// Hand-placed against the furniture in layout.ts, cabinets, chairs, table and fridge,
// and, past the doorway, the living room's sofa, coffee table and reading chair.
// A walk whose hand-placed curve comes too close to something placed since (a bed on the
// floor, #79) is planned instead on the floor grid (./floor.ts), which plugins/place.ts keeps.
import * as THREE from 'three/webgpu'
import { DOORWAY, KITCHEN, LIVING_X, WALL_T } from '../layout'
import type { Floor } from './floor'

const DOOR_Z = (DOORWAY.z0 + DOORWAY.z1) / 2

const SEAT_TOP = 0.515 // chair seat 0.45 plus its cushion

/** Corridor nodes on the floor (x, z). Edges below keep clear of the table, chairs, plant and fridge. */
const NODES: Record<string, [number, number]> = {
  l0: [-1.95, 0.5], l1: [-1.95, -0.55], l2: [-1.7, -1.15],
  b0: [-0.85, -1.15], b1: [0.1, -1.15], b2: [0.72, -1.02],
  r0: [1.55, -0.72], r1: [1.6, -0.3], r2: [2.2, -0.7],
  // Open floor in front of the table (#42 talk prototype).
  f0: [-1.75, 1.3], f1: [-0.3, 1.45], f2: [1.15, 1.3], f3: [1.85, 0.45],
  // Through the doorway in the shared wall (#42 one house): along the kitchen's right wall
  // behind the reading chair, a step either side of the doorway, then round the basket
  // and the coffee table to the living room's plant corner.
  k0: [KITCHEN.x1 - 0.55, 1.05], d0: [KITCHEN.x1 - 0.4, DOOR_Z], d1: [KITCHEN.x1 + WALL_T + 0.55, DOOR_Z],
  m0: [LIVING_X - 1.6, 2.15], m1: [LIVING_X - 0.65, 1.15], m2: [LIVING_X + 0.4, -0.75],
}
const EDGES: [string, string][] = [['l0', 'l1'], ['l1', 'l2'], ['l2', 'b0'], ['b0', 'b1'], ['b1', 'b2'], ['b2', 'r0'], ['r0', 'r1'], ['r0', 'r2'], ['r1', 'r2']]
/**
 * #42 talk prototype: walkers cross the room in the open, in front of the table,
 * instead of behind the far chairs where the room view loses them.
 */
const OPEN_EDGES: [string, string][] = [
  ...EDGES.filter(([a, b]) => !(a === 'b0' && b === 'b1')),
  ['l0', 'f0'], ['f0', 'f1'], ['f1', 'f2'], ['f2', 'f3'], ['f3', 'r1'],
  ['f3', 'k0'], ['k0', 'd0'], ['d0', 'd1'], ['d1', 'm0'], ['m0', 'm1'], ['m1', 'm2'],
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
  /** Floor points walked after `via`, before `at` (both faces of a doorway, say). */
  through?: [number, number][]
  /** The floor outline of the room the spot is in, when it is behind walls (build mode's new rooms): only a villager standing on it leaves through `through`. */
  floor?: [number, number][]
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
  // The living room's plant stand and grow shelves, reached through the doorway (open paths only).
  loungePlants: { at: [LIVING_X + 0.75, -1.3], face: Math.PI * 0.85, via: 'm2' },
}
/** Adds or replaces a spot (build mode's new rooms, #48); kept, since a villager may still be standing there. */
export function setSpot(name: string, spot: Spot) {
  SPOTS[name] = spot
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
  return curve(SPOTS[from].at, via(from, paths), to, paths, [...(SPOTS[from].through ?? [])].reverse())
}

/** A path from wherever a villager stands, through its nearest corridor node, to a spot. */
export function routeFrom(x: number, z: number, to: string, paths: Paths = 'kitchen'): THREE.CatmullRomCurve3 {
  // Standing by a spot reached through a doorway, it leaves the way it came.
  const inside = Object.values(SPOTS).find((s) => s.through && (s.floor ? onFloor(x, z, s.floor) : Math.hypot(s.at[0] - x, s.at[1] - z) < 1.5))
  if (inside && SPOTS[to] !== inside) return curve([x, z], inside.via, to, paths, [...inside.through!].reverse())
  return curve([x, z], nearestNode(x, z, paths) ?? via(to, paths), to, paths)
}

/** Whether a floor point lies inside a closed outline (even-odd crossings). */
function onFloor(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** The corridor node on these paths nearest a floor point (null when the paths have none). */
export function nearestNode(x: number, z: number, paths: Paths = 'kitchen'): string | null {
  let near: string | null = null, best = Infinity
  for (const n of new Set((paths === 'open' ? OPEN_EDGES : EDGES).flat())) {
    const d = Math.hypot(NODES[n][0] - x, NODES[n][1] - z)
    if (d < best) [near, best] = [n, d]
  }
  return near
}

let floor: Floor | null = null
/** The floor grid walks are planned on when their curve is in the way of something (null: hand-placed curves only). */
export function setFloor(f: Floor | null) {
  floor = f
}
/** Walks planned on the floor grid, for the checks: how many, and the last one's time. */
export const planned = { walks: 0, lastMs: 0, maxMs: 0, fellBack: 0 }

function curve(start: [number, number], via0: string, to: string, paths: Paths, leaving: [number, number][] = []): THREE.CatmullRomCurve3 {
  const b = SPOTS[to]
  const points: [number, number][] = [start, ...leaving]
  for (const n of nodes(via0, via(to, paths), paths)) points.push(NODES[n])
  if (b.through) points.push(...b.through)
  points.push(b.at)
  const hand = smooth(points)
  if (!floor) return hand
  const t0 = performance.now()
  const along = hand.getSpacedPoints(Math.max(2, Math.ceil(hand.getLength() / 0.05))).map((p) => [p.x, p.z] as [number, number])
  if (floor.clear(along, start, b.at)) return hand
  // In the way of something placed: round it on the floor grid, or, with no way round, the hand-placed curve
  // (the walker's body is held back and then passes, engine/world.ts), so nobody stands frozen.
  const path = floor.path(start, b.at)
  const ms = performance.now() - t0
  planned.walks++
  planned.lastMs = ms
  planned.maxMs = Math.max(planned.maxMs, ms)
  if (!path) planned.fellBack++
  return path ? smooth(path) : hand
}

/** A smooth floor curve through points, dropping any closer than 12 cm to the one before. */
function smooth(points: [number, number][]): THREE.CatmullRomCurve3 {
  const clean = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.12)
  if (clean.length === 1) clean.push([clean[0][0] + 0.01, clean[0][1]])
  if (clean.length === 2) clean.splice(1, 0, [(clean[0][0] + clean[1][0]) / 2, (clean[0][1] + clean[1][1]) / 2])
  return new THREE.CatmullRomCurve3(clean.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
}
