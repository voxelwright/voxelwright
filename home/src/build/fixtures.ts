// What the kitchen's built-in furniture holds against each plan wall (#48): the
// dresser, the shelf over it, the coat pegs, the clock. Those are drawn by plugins
// (furnish.ts, cabinets.ts, fridge.ts...) and are not in the plan yet, so a door or
// a hung picture must ask the scene where they are.
//
// What counts: every solid, visible mesh mount.ts's obstacles() counts, so the
// house itself (room, build, diorama), villagers, talk, light shafts, motes,
// glass, flat textiles and seat-only things are already out; on top of that the
// placed things (they are in the plan) and the outline being drawn are skipped.
// A built-in is on a face when its world box comes within NEAR of that face.
//
// Stretches are in metres along the wall from its corner a (arc length when
// curved), with the height range they fill. `side` is +1 for the face the wall's
// normal points to, -1 for the other.
import type * as THREE from 'three/webgpu'
import { curveOf, normalAt, pointAt, type Curve, type Id, type Plan, type Wall } from './plan'
import { obstacles } from './mount'

/** How far off a face a built-in still stands against it. */
export const NEAR = 0.6

export interface Fixture {
  name: string
  side: 1 | -1
  from: number
  to: number
  y0: number
  y1: number
  /** Its gap to the face, in metres (0 when it touches or goes through). */
  gap: number
  /** It reaches both faces: a window's or a doorway's frame, which the opening itself already stands for. */
  through: boolean
}

/** Along-wall position and signed offset from the centreline (positive on the normal's side) of a floor point. */
function project(c: Curve, x: number, z: number): [along: number, off: number] {
  let t: number
  if (c.radius === Infinity) t = (x - c.a[0]) * c.dir[0] + (z - c.a[1]) * c.dir[1]
  else {
    let u = (Math.atan2(z - c.centre[1], x - c.centre[0]) - c.start) * c.turn
    u = Math.atan2(Math.sin(u), Math.cos(u))
    t = u * c.radius
  }
  const [px, pz] = pointAt(c, t)
  const [nx, nz] = normalAt(c, t)
  return [t, (x - px) * nx + (z - pz) * nz]
}

/** The built-ins on each face of one wall, from boxes, up to `reach` metres off the face. */
export function fixturesOf(c: Curve, wall: Wall, boxes: Array<{ box: THREE.Box3; name: string }>, reach = NEAR): Fixture[] {
  const out: Fixture[] = []
  const half = wall.thickness / 2
  for (const { box, name } of boxes) {
    const pts = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.max.x, box.max.z], [box.min.x, box.max.z], [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2]]
    let a0 = Infinity, a1 = -Infinity, o0 = Infinity, o1 = -Infinity
    for (const [x, z] of pts) {
      const [t, o] = project(c, x, z)
      a0 = Math.min(a0, t); a1 = Math.max(a1, t); o0 = Math.min(o0, o); o1 = Math.max(o1, o)
    }
    if (a1 <= 0 || a0 >= c.length) continue
    const from = Math.max(0, a0), to = Math.min(c.length, a1)
    const through = o0 < -half + 1e-3 && o1 > half - 1e-3
    for (const side of [1, -1] as const) {
      // Distance from this face to the nearest part of the box, along the normal.
      const near = side > 0 ? o0 - half : -o1 - half
      const far = side > 0 ? o1 - half : -o0 - half
      if (far < -1e-3 && near < -1e-3) continue // wholly on the other side
      const gap = Math.max(0, near)
      if (gap > reach) continue
      out.push({ name, side, from, to, y0: box.min.y, y1: box.max.y, gap, through })
    }
  }
  return out
}

/** One owner per scan: the fixtures of every wall of a plan, cached until the plan or the scene's furniture changes. */
export function makeFixtures(scene: THREE.Scene, skip: () => THREE.Object3D[]) {
  let plan: Plan | null = null
  let byWall = new Map<Id, Fixture[]>()
  let boxes: Array<{ box: THREE.Box3; name: string }> | null = null
  const times: number[] = []
  const scan = (p: Plan) => {
    const start = performance.now()
    boxes ??= obstacles(scene, skip())
    byWall = new Map(p.walls.map((w) => [w.id, fixturesOf(curveOf(p, w), w, boxes!)]))
    plan = p
    times.push(performance.now() - start)
  }
  return {
    /** The built-ins against a wall's faces, in that plan; `side` picks one face. */
    on(p: Plan, wallId: Id, side?: 1 | -1): Fixture[] {
      if (p !== plan) scan(p)
      const all = byWall.get(wallId) ?? []
      return side ? all.filter((f) => f.side === side) : all
    },
    /** The plan changed: rescan on the next question. Placed things are never fixtures, so the scene boxes stand. */
    invalidate() {
      plan = null
    },
    /** Milliseconds each scan took. */
    times: () => times.slice(),
  }
}
export type Fixtures = ReturnType<typeof makeFixtures>
