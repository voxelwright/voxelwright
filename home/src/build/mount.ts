// Mount rules for placing things (#48): where each mount may hold a thing, and the
// pose a plan anchor stands for. Pure geometry over the plan plus three.js boxes
// and rays; no DOM and no input.
//
// floor    stands on the floor inside a room's walls, clear of other furniture and
//          of the 0.6 m in front of a door.
// surface  stands on any upward face above SURFACE_MIN under the whole footprint:
//          the face is found by casting rays down at the footprint's middle and
//          four corners against what the room draws, so the built-in table, counters and
//          shelves work without tags. Limits: a face must be within 2.5 cm level at
//          all five points (a bowl's rim or a slatted top fails). A built-in support is
//          not remembered (stored as a height); a placed one is named by `on` and
//          carries what stands on it (plan.ts).
// wall     hangs flat on a wall face the camera can see whole (a cut-away wall is
//          not offered), clear of doors, windows and what already hangs there. On a
//          curved wall it faces the wall's normal at its middle and stands off the
//          curve enough that its ends do not sink in.
// ceiling  hangs from the room's ceiling (its lowest wall top) on a CORD-long cord,
//          inside the room and clear of what is up there.
// Collisions are against world-aligned boxes of the meshes other plugins draw (a
// slanted leaf's box is bigger than the leaf), skipping flat things such as rugs.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { paintPhoto } from '../paint'
import { curveOf, floorOf, inside, normalAt, segmentsCross, pointAt, roomAt, roomWalls, tangentAt, type Anchor, type Id, type Mount, type P, type Plan, type Room, type Wall } from './plan'
import { NEAR, fixturesOf, type Fixture } from './fixtures'
import { LIVING } from './pieces'

export const SURFACE_MIN = 0.3
/** How far below the ceiling a hung thing's top is. */
export const CORD = 0.75
/** Clear floor in front of a door. */
const DOOR_CLEAR = 0.6
const LEVEL = 0.025
/** How close a built-in comes to an opening (or to what already dresses it) to count as dressing it: a frame, a sill. */
const DRESS = 0.06
/** How far past its hole an opening's dressing may reach. */
const DRESS_REACH = 0.4

/** Where a thing stands in the world: the point its holder's origin sits on, and its turn. */
export interface Pose {
  x: number
  y: number
  z: number
  /** About the vertical; a wall thing's yaw faces it into its room. */
  yaw: number
  wallId?: string
  /** Wall things: which room's face. */
  roomId?: string
  /** Wall things: turn in the wall's plane. */
  spin?: number
}

export type Size = [w: number, h: number, d: number]

// ── Walls and rooms ─────────────────────────────────────────────────────────
export interface WallFace {
  wall: Wall
  room: Room
  /** Centreline length (arc length when curved). */
  length: number
  point: P
  /** Unit normal pointing into the room. */
  inward: P
  tangent: P
  thickness: number
  /** Positive when the face curves away from the room at this point (a bay), so a flat thing must stand off it. */
  concave: number
  radius: number
}

export function faceOf(plan: Plan, wallId: Id, roomId: Id, along: number): WallFace | null {
  const wall = plan.walls.find((w) => w.id === wallId)
  const room = plan.rooms.find((r) => r.id === roomId)
  if (!wall || !room) return null
  const side = roomWalls(plan, room).find(({ wall: w }) => w.id === wallId)
  if (!side) return null
  const c = curveOf(plan, wall)
  const t = Math.min(Math.max(along, 0), c.length)
  const [nx, nz] = normalAt(c, t)
  // The loop running a→b means the normal points out of this room.
  const k = side.forward ? -1 : 1
  return {
    wall, room, length: c.length, point: pointAt(c, t), inward: [nx * k, nz * k], tangent: tangentAt(c, t),
    thickness: wall.thickness, concave: Math.sign(c.sagitta) * (side.forward ? 1 : -1), radius: c.radius,
  }
}

export { floorOf, roomsOf } from './plan'

/** A room's ceiling: the top of its lowest wall. */
export const ceilingOf = (plan: Plan, room: Room) => Math.min(...roomWalls(plan, room).map(({ wall }) => wall.height))


/** Nearest point along a wall's centreline to (x, z), in metres from corner a. */
export function alongOf(plan: Plan, wall: Wall, x: number, z: number): number {
  const c = curveOf(plan, wall)
  let best = Infinity, at = 0
  for (let i = 0; i <= 128; i++) {
    const t = (c.length * i) / 128
    const [px, pz] = pointAt(c, t)
    const d = (px - x) ** 2 + (pz - z) ** 2
    if (d < best) [best, at] = [d, t]
  }
  // One refinement step along the tangent.
  const [px, pz] = pointAt(c, at)
  const [tx, tz] = tangentAt(c, at)
  return Math.min(Math.max(at + (x - px) * tx + (z - pz) * tz, 0), c.length)
}

/** How far a flat thing w wide stands off a face that curves away from it. */
const standOff = (f: WallFace, w: number) => (f.concave > 0 && Number.isFinite(f.radius) ? f.radius - Math.sqrt(Math.max(0, f.radius ** 2 - (w / 2) ** 2)) : 0)

// ── Poses ───────────────────────────────────────────────────────────────────
/** The pose an anchor stands for. Wall anchors off their wall's ends are drawn at the end. */
export function poseOf(plan: Plan, at: Anchor, size: Size = [0, 0, 0]): Pose | null {
  switch (at.mount) {
    case 'floor': return { x: at.x, y: 0, z: at.z, yaw: at.yaw }
    case 'surface': return { x: at.x, y: at.y, z: at.z, yaw: at.yaw }
    case 'ceiling': {
      const room = roomAt(plan, at.x, at.z)
      return { x: at.x, y: (room ? ceilingOf(plan, room) : 3) - CORD, z: at.z, yaw: at.yaw }
    }
    case 'wall': {
      const f = faceOf(plan, at.wallId, at.roomId, at.along)
      if (!f) return null
      const off = f.thickness / 2 + 0.004 + standOff(f, size[0])
      return {
        x: f.point[0] + f.inward[0] * off, y: at.height, z: f.point[1] + f.inward[1] * off,
        yaw: Math.atan2(f.inward[0], f.inward[1]), wallId: at.wallId, roomId: at.roomId, spin: at.spin,
      }
    }
  }
}

/** Put a holder at a pose: wall things face into the room and spin about that facing. */
export function setPose(holder: THREE.Object3D, pose: Pose) {
  holder.position.set(pose.x, pose.y, pose.z)
  holder.rotation.set(0, pose.yaw, 0, 'YXZ')
  if (pose.spin) holder.rotation.z = pose.spin
}

/**
 * Wrap an object so the holder's origin is the point a mount anchors: the middle of
 * its base (floor, surface), of its back (wall: +z is its front), or of its top
 * (ceiling). Returns the holder and the object's measured size.
 */
export function seat(object: THREE.Object3D, mount: Mount): { holder: THREE.Group; size: Size } {
  const holder = new THREE.Group()
  holder.name = 'placed thing'
  object.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(object)
  const size = b.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.x + size.y + size.z) || size.length() === 0) throw new Error('it has no size')
  const c = b.getCenter(new THREE.Vector3())
  const y = mount === 'ceiling' ? b.max.y : mount === 'wall' ? c.y : b.min.y
  object.position.sub(new THREE.Vector3(c.x, y, mount === 'wall' ? b.min.z : c.z))
  holder.add(object)
  return { holder, size: [size.x, size.y, size.z] }
}

// ── Obstacles ───────────────────────────────────────────────────────────────
export interface Obstacle {
  box: THREE.Box3
  /** The top-level thing it belongs to ("fridge", "table"), for a reason a person can read. */
  name: string
}

/** Top-level groups that are the house, light, air or people rather than furniture. */
const NOT_FURNITURE = /^(room|build|diorama|lounge diorama|villagers|talk|motes|sunbeam|glass|glass-sheet|furnish flat|lounge furnish flat|lamp pool|placement)$/

/** World boxes of everything solid the scene draws, except the house itself and `skip`. */
export function obstacles(scene: THREE.Scene, skip: THREE.Object3D[] = []): Obstacle[] {
  const out: Obstacle[] = []
  scene.updateMatrixWorld()
  const skipped = new Set(skip)
  for (const top of scene.children) {
    if (NOT_FURNITURE.test(top.name) || skipped.has(top)) continue
    const kits = new Set<THREE.Object3D>()
    top.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.geometry || skipped.has(m)) return
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible || skipped.has(p) || p.userData.seatOnly) return
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
      if (mat && mat.transparent && !mat.depthWrite) return
      // A kit (src/kit.ts) merges its parts by material but keeps each part's box and label: use those, once per kit.
      const regions = m.parent?.userData.regions as Array<{ name: string | null; box: THREE.Box3 }> | undefined
      if (regions) {
        if (kits.has(m.parent!)) return
        kits.add(m.parent!)
        for (const r of regions) {
          const box = r.box.clone().applyMatrix4(m.parent!.matrixWorld)
          if (box.max.y - box.min.y >= 0.02) out.push({ box, name: r.name ?? top.name })
        }
        return
      }
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)
      if (box.isEmpty() || box.max.y - box.min.y < 0.02) return
      // A mesh that merges many things (furnish.ts batches a room's worth) is no box: use columns of its triangles.
      if (box.max.x - box.min.x > BIG || box.max.z - box.min.z > BIG) out.push(...columns(m, top.name))
      else out.push({ box, name: top.name })
    })
  }
  return out
}

const BIG = 1.2
const CELL = 0.1

/** A merged mesh as 10 cm columns, each with the height ranges its triangles fill. Thin flat parts (rugs) drop out. */
function columns(m: THREE.Mesh, name: string): Obstacle[] {
  const pos = m.geometry.attributes.position as THREE.BufferAttribute
  const index = m.geometry.index
  const n = index ? index.count : pos.count
  const cells = new Map<string, Array<[number, number]>>()
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i + 2 < n; i += 3) {
    const [i0, i1, i2] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]
    a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld)
    b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld)
    c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld)
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y)
    for (let x = Math.floor(Math.min(a.x, b.x, c.x) / CELL); x <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); x++) {
      for (let z = Math.floor(Math.min(a.z, b.z, c.z) / CELL); z <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); z++) {
        const key = `${x},${z}`
        const spans = cells.get(key) ?? []
        spans.push([y0, y1])
        cells.set(key, spans)
      }
    }
  }
  const out: Obstacle[] = []
  for (const [key, spans] of cells) {
    const [x, z] = key.split(',').map(Number)
    spans.sort((p, q) => p[0] - q[0])
    let cur: [number, number] | null = null
    const flush = () => {
      if (cur && cur[1] - cur[0] >= 0.02) out.push({ box: new THREE.Box3(new THREE.Vector3(x * CELL, cur[0], z * CELL), new THREE.Vector3((x + 1) * CELL, cur[1], (z + 1) * CELL)), name })
    }
    for (const sp of spans) {
      if (cur && sp[0] <= cur[1] + 0.05) cur[1] = Math.max(cur[1], sp[1])
      else {
        flush()
        cur = [sp[0], sp[1]]
      }
    }
    flush()
  }
  return out
}

/** Meshes that can hold a surface thing: the same solid meshes, for rays. */
export function supports(scene: THREE.Scene, skip: THREE.Object3D[] = []): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const skipped = new Set(skip)
  for (const top of scene.children) {
    if (NOT_FURNITURE.test(top.name) || skipped.has(top)) continue
    top.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || skipped.has(m)) return
      for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible || skipped.has(p)) return
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
      if (mat && mat.transparent && !mat.depthWrite) return
      out.push(m)
    })
  }
  return out
}

// ── Fit ─────────────────────────────────────────────────────────────────────
/** The footprint's corners: a w × d rectangle about (x, z) turned by yaw. */
export function footprint(x: number, z: number, w: number, d: number, yaw: number): P[] {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => {
    const lx = (i * w) / 2, lz = (j * d) / 2
    return [x + lx * c + lz * s, z - lx * s + lz * c] as P
  })
}

/** Two convex polygons overlap (separating axis test). */
export function overlaps(a: P[], b: P[], margin = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length]
      const nx = q[1] - p[1], nz = p[0] - q[0]
      const len = Math.hypot(nx, nz) || 1
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
      for (const v of a) { const t = (v[0] * nx + v[1] * nz) / len; a0 = Math.min(a0, t); a1 = Math.max(a1, t) }
      for (const v of b) { const t = (v[0] * nx + v[1] * nz) / len; b0 = Math.min(b0, t); b1 = Math.max(b1, t) }
      if (a1 - margin <= b0 || b1 - margin <= a0) return false
    }
  }
  return true
}

/** The polygon lies inside the ring: every corner in, and no edge crossing it. */
export function within(ring: P[], poly: P[]): boolean {
  if (!poly.every((p) => inside(ring, p))) return false
  for (let i = 0; i < poly.length; i++) for (let j = 0; j < ring.length; j++) {
    if (segmentsCross(poly[i], poly[(i + 1) % poly.length], ring[j], ring[(j + 1) % ring.length])) return false
  }
  return true
}

const boxRect = (b: THREE.Box3): P[] => [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]]

/** The first obstacle a solid with this footprint and height range runs into. */
function bump(list: Obstacle[], poly: P[], y0: number, y1: number): Obstacle | null {
  for (const o of list) {
    if (Math.min(y1, o.box.max.y) - Math.max(y0, o.box.min.y) <= 0.01) continue
    if (overlaps(poly, boxRect(o.box), 0.01)) return o
  }
  return null
}

const named = (name: string) => (!name || /furnish|things/.test(name) ? 'something' : `the ${name.replace(/^(talk |lounge )/, '')}`)

/** Clear floor in front of each door of a room, as quads. */
function doorways(plan: Plan, room: Room): P[][] {
  const out: P[][] = []
  for (const { wall, forward } of roomWalls(plan, room)) {
    const c = curveOf(plan, wall)
    for (const o of wall.openings) {
      if (o.kind !== 'door') continue
      const quad: P[] = []
      for (const [t, k] of [[o.from, 0], [o.to, 0], [o.to, 1], [o.from, 1]] as const) {
        const [px, pz] = pointAt(c, t)
        const [nx, nz] = normalAt(c, t)
        const s = (forward ? -1 : 1) * (wall.thickness / 2 + k * DOOR_CLEAR)
        quad.push([px + nx * s, pz + nz * s])
      }
      out.push(quad)
    }
  }
  return out
}

export interface Fit { ok: boolean; why?: string }

/** The built-ins on a wall's faces, from these obstacles, worked out once per obstacle list, plan and wall. */
const faceCache = new WeakMap<Obstacle[], { plan: Plan; byWall: Map<Id, Fixture[]> }>()
function faceFixtures(list: Obstacle[], plan: Plan, wall: Wall): Fixture[] {
  let c = faceCache.get(list)
  if (!c || c.plan !== plan) faceCache.set(list, c = { plan, byWall: new Map() })
  let got = c.byWall.get(wall.id)
  // A bay bent out behind a built-in still has it in front: reach across the bulge too.
  if (!got) c.byWall.set(wall.id, got = fixturesOf(curveOf(plan, wall), wall, list, NEAR + Math.abs(wall.sagitta)))
  return got
}

export interface FitContext {
  plan: Plan
  size: Size
  obstacles: Obstacle[]
  /** Down rays for surface things. */
  supportAt: (x: number, y: number, z: number) => number | null
}

/** Whether a thing of this size may stand at this anchor, and if not, why in plain words. */
export function fit(ctx: FitContext, at: Anchor): Fit {
  const { plan, size: [w, h, d] } = ctx
  if (at.mount === 'wall') {
    const f = faceOf(plan, at.wallId, at.roomId, at.along)
    if (!f) return { ok: false, why: 'That wall is gone' }
    const c = Math.abs(Math.cos(at.spin)), s = Math.abs(Math.sin(at.spin))
    const ww = w * c + h * s, hh = w * s + h * c
    if (at.along - ww / 2 < f.thickness / 2 || at.along + ww / 2 > f.length - f.thickness / 2) return { ok: false, why: 'It runs off the end of the wall' }
    if (at.height - hh / 2 < 0.05 || at.height + hh / 2 > f.wall.height - 0.02) return { ok: false, why: at.height < f.wall.height / 2 ? "It's too low to hang there" : "It won't fit under the ceiling" }
    // What stands against or hangs on this face, flattened onto it: a bay bent out past the shelf still has the shelf in front.
    const nrm = normalAt(curveOf(plan, f.wall), at.along)
    const side = f.inward[0] * nrm[0] + f.inward[1] * nrm[1] > 0 ? 1 : -1
    const lo = at.along - ww / 2, hi = at.along + ww / 2, y0 = at.height - hh / 2, y1 = at.height + hh / 2
    const onFace = faceFixtures(ctx.obstacles, plan, f.wall).filter((x) => x.side === side)
    for (const o of f.wall.openings) {
      // An opening is its hole plus the built-ins dressing it (frame, sill, trim): nothing hangs over any of it.
      // Merged meshes come as 10 cm columns, so grow the rectangle until no more columns touch it.
      // Only pieces of what touches the hole itself (the window's own sill, not the shelf beside it), and only near it.
      const touches = (x: Fixture, a0: number, a1: number, s0: number, s1: number) => x.from <= a1 + DRESS && x.to >= a0 - DRESS && x.y0 <= s1 + DRESS && x.y1 >= s0 - DRESS
      const names = new Set(onFace.filter((x) => x.name !== 'placed things' && touches(x, o.from, o.to, o.sill, o.head)).map((x) => x.name))
      const rest = onFace.filter((x) => names.has(x.name) && x.from > o.from - DRESS_REACH && x.to < o.to + DRESS_REACH && x.y0 > o.sill - DRESS_REACH && x.y1 < o.head + DRESS_REACH)
      let [a0, a1, s0, s1] = [o.from, o.to, o.sill, o.head]
      for (let grew = true; grew;) {
        grew = false
        for (let i = rest.length - 1; i >= 0; i--) {
          const x = rest[i]
          if (!touches(x, a0, a1, s0, s1)) continue
          a0 = Math.min(a0, x.from); a1 = Math.max(a1, x.to); s0 = Math.min(s0, x.y0); s1 = Math.max(s1, x.y1)
          rest.splice(i, 1)
          grew = true
        }
      }
      if (hi > a0 - 0.03 && lo < a1 + 0.03 && y1 > s0 - 0.03 && y0 < s1 + 0.03) return { ok: false, why: `It would cover the ${o.kind}` }
    }
    const held = onFace.find((x) => !x.through && x.from < hi - 0.01 && x.to > lo + 0.01 && x.y0 < y1 - 0.01 && x.y1 > y0 + 0.01)
    if (held) return { ok: false, why: `It bumps into ${named(held.name)}` }
    const pose = poseOf(plan, at, ctx.size)!
    const back = f.thickness / 2 + 0.004 + standOff(f, ww)
    const fx = f.point[0] + f.inward[0] * back, fz = f.point[1] + f.inward[1] * back
    const t = f.tangent, n = f.inward
    const poly: P[] = [
      [fx - t[0] * ww / 2, fz - t[1] * ww / 2], [fx + t[0] * ww / 2, fz + t[1] * ww / 2],
      [fx + t[0] * ww / 2 + n[0] * d, fz + t[1] * ww / 2 + n[1] * d], [fx - t[0] * ww / 2 + n[0] * d, fz - t[1] * ww / 2 + n[1] * d],
    ]
    const hit = bump(ctx.obstacles, poly, pose.y - hh / 2, pose.y + hh / 2)
    return hit ? { ok: false, why: `It bumps into ${named(hit.name)}` } : { ok: true }
  }
  const room = roomAt(plan, at.x, at.z)
  if (!room) return { ok: false, why: "That's outside the house" }
  const poly = footprint(at.x, at.z, w, d, at.yaw)
  if (!within(floorOf(plan, room), poly)) return { ok: false, why: "It's poking through the wall" }
  if (at.mount === 'ceiling') {
    const top = ceilingOf(plan, room) - CORD
    const hit = bump(ctx.obstacles, poly, top - h, top + CORD)
    return hit ? { ok: false, why: `It bumps into ${named(hit.name)}` } : { ok: true }
  }
  const y = at.mount === 'surface' ? at.y : 0
  if (at.mount === 'surface') {
    if (y < SURFACE_MIN) return { ok: false, why: 'It needs a table, a counter or a shelf under it' }
    const pts: P[] = [[at.x, at.z], ...footprint(at.x, at.z, w * 0.8, d * 0.8, at.yaw)]
    for (const [px, pz] of pts) {
      const top = ctx.supportAt(px, y, pz)
      if (top === null || Math.abs(top - y) > LEVEL) return { ok: false, why: "It's hanging over the edge" }
    }
  } else if (doorways(plan, room).some((q) => overlaps(poly, q))) return { ok: false, why: "It's in the way of the door" }
  const hit = bump(ctx.obstacles, poly, y, y + h)
  return hit ? { ok: false, why: `It bumps into ${named(hit.name)}` } : { ok: true }
}

/** A sensible height for a wall thing's middle, by what it is. */
export function wallHeight(label = '', h = 0.4): number {
  const l = label.toLowerCase()
  if (/\b(tv|television|screen)\b/.test(l)) return 1.25
  if (/\bclock\b/.test(l)) return 2.0
  if (/\bshel(f|ves)\b/.test(l)) return 1.45
  if (/\b(hook|coat|key)s?\b/.test(l)) return 1.6
  return Math.max(1.5, h / 2 + 0.9)
}

// ── Built-in kinds ──────────────────────────────────────────────────────────
export interface Kind { mount: Mount; label: string; build: () => THREE.Object3D }

const wood = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.75 })

/** Things the home builds itself: the demo set, one per mount, and a living room's first pieces (pieces.ts). */
export const KINDS: Record<string, Kind> = {
  ...LIVING,
  crate: {
    mount: 'floor', label: 'apple crate',
    build: () => {
      const g = new THREE.Group()
      const m = wood('#c08a55')
      const slat = new RoundedBoxGeometry(0.56, 0.08, 0.4, 2, 0.012)
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(slat, m)
        s.position.y = 0.05 + i * 0.1
        g.add(s)
      }
      const post = new RoundedBoxGeometry(0.05, 0.4, 0.05, 2, 0.01)
      for (const [x, z] of [[-0.25, -0.17], [0.25, -0.17], [0.25, 0.17], [-0.25, 0.17]]) {
        const p = new THREE.Mesh(post, wood('#a87346'))
        p.position.set(x, 0.2, z)
        g.add(p)
      }
      const apples = new THREE.SphereGeometry(0.055, 16, 10)
      const red = new THREE.MeshStandardMaterial({ color: '#c2412f', roughness: 0.5 })
      for (const [x, z] of [[-0.14, -0.05], [0, 0.06], [0.13, -0.04], [-0.05, -0.1], [0.08, 0.1]]) {
        const a = new THREE.Mesh(apples, red)
        a.position.set(x, 0.42, z)
        g.add(a)
      }
      return g
    },
  },
  vase: {
    mount: 'surface', label: 'little vase',
    build: () => {
      const g = new THREE.Group()
      const pts = [[0.0, 0], [0.055, 0], [0.075, 0.05], [0.07, 0.12], [0.04, 0.18], [0.035, 0.22], [0.045, 0.24]].map(([x, y]) => new THREE.Vector2(x, y))
      const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshStandardMaterial({ color: '#cf7f55', roughness: 0.6, side: THREE.DoubleSide }))
      g.add(pot)
      const stem = new THREE.MeshStandardMaterial({ color: '#5d7f45', roughness: 0.8 })
      const bloom = new THREE.MeshStandardMaterial({ color: '#f2d36b', roughness: 0.7 })
      for (const [a, l] of [[-0.25, 0.2], [0.15, 0.24], [0.4, 0.18]]) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, l, 5), stem)
        s.position.set(Math.sin(a) * l / 2, 0.22 + Math.cos(a) * l / 2, 0)
        s.rotation.z = -a
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), bloom)
        f.position.set(Math.sin(a) * l, 0.22 + Math.cos(a) * l, 0)
        g.add(s, f)
      }
      return g
    },
  },
  picture: {
    mount: 'wall', label: 'framed picture',
    build: () => {
      const g = new THREE.Group()
      const frame = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.035, 2, 0.008), wood('#8a5a3a'))
      frame.position.z = 0.0175
      const art = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52), new THREE.MeshStandardMaterial({ map: paintPhoto('mountains', 11), roughness: 0.9 }))
      art.position.z = 0.0355
      g.add(frame, art)
      return g
    },
  },
  pendant: {
    mount: 'ceiling', label: 'paper lantern',
    build: () => {
      const g = new THREE.Group()
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 18), new THREE.MeshStandardMaterial({ color: '#fbefd8', emissive: '#ffcf8a', emissiveIntensity: 0.55, roughness: 0.9 }))
      shade.scale.y = 0.85
      shade.position.y = -0.17
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.03, 16), new THREE.MeshStandardMaterial({ color: '#3a2d25', roughness: 0.5 }))
      g.add(shade, cap)
      return g
    },
  },
}

/** The cord and ceiling rose a hung thing hangs from: `length` metres up from its top. */
export function cord(length: number): THREE.Group {
  const g = new THREE.Group()
  g.name = 'cord'
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.6 })
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, length, 6), dark)
  line.position.y = length / 2
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 20), new THREE.MeshStandardMaterial({ color: '#f3e7d2', roughness: 0.8 }))
  rose.position.y = length - 0.0125
  g.add(line, rose)
  return g
}
