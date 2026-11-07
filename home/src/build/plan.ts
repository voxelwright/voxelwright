// The floor plan (#48): pure data and pure functions, no three.js.
//
// A plan is a JSON document. Each fact has one home: a corner's position lives
// only on the corner; a wall names its two corners and carries what is its own
// (thickness, height, bulge, openings); a room is a loop of corner ids. Walls are
// first-class, so one wall can bound two rooms (a shared wall with a door in it).
// Every id is a stable string, never an array index. Edits are small JSON objects
// applied by apply(plan, edit) -> plan, so a history can store, replay and diff them.
import { DOORWAY, WALL_Z, WINDOW } from '../layout'

export const PLAN_VERSION = 1

export type Id = string

export interface Corner {
  id: Id
  /** Where the wall centrelines meet, in world metres. */
  x: number
  z: number
}

export interface Opening {
  id: Id
  kind: 'door' | 'window'
  /** Metres along the wall from its corner a (arc length on a curved wall). */
  from: number
  to: number
  /** Metres above the floor. A door's sill is 0. */
  sill: number
  head: number
  /** Door leaves: 2 is a double door. */
  leaves?: 1 | 2
}

export interface Wall {
  id: Id
  a: Id
  b: Id
  thickness: number
  height: number
  /**
   * How far the wall's midpoint bulges off the chord a→b, in metres; 0 is straight.
   * Positive bulges toward (dz, -dx) of the chord, which is outward for a room whose
   * loop runs a then b (rooms wind like the kitchen; validate() checks). Bounded by
   * a half circle: |sagitta| <= chord / 2.
   */
  sagitta: number
  openings: Opening[]
}

export interface Room {
  id: Id
  label: string
  /** Corner ids in order; consecutive corners (and last to first) are joined by a wall. */
  loop: Id[]
}

/** How a thing is held up: standing on the floor, on top of other furniture, hung on a wall or from the ceiling. */
export type Mount = 'floor' | 'surface' | 'wall' | 'ceiling'
export const MOUNTS: readonly Mount[] = ['floor', 'surface', 'wall', 'ceiling']

/**
 * What a placed thing is. A library item is a prop someone's villager made, kept in
 * that person's library on the host (its module text, name and size live there, not
 * here). A kind is a thing the home builds itself (src/build/mount.ts KINDS).
 */
export type ItemRef = { library: string; person: Id } | { kind: string }

/**
 * Where a placed thing is, by mount. Angles are radians. Positions are world metres.
 * floor:   the centre of its footprint on the floor; yaw turns it about the vertical.
 * surface: the centre of its footprint and the height of the top it stands on. The
 *          height is stored because supports are found by looking (any upward face
 *          above 0.3 m), and today's tables and counters have no id in the plan.
 *          When the top is a placed thing, `on` names it: moving that thing carries
 *          this one with it (x, y, z and yaw by the same move), and it cannot be
 *          removed while this one stands on it.
 * wall:    the centre of its back on the face of wallId that looks into roomId:
 *          `along` metres from the wall's corner a (arc length when curved), `height`
 *          metres above the floor. It always faces into the room; `spin` turns it
 *          in the wall's plane (a picture hung askew). roomId says which face, which
 *          the wall alone cannot (a wall can bound two rooms).
 * ceiling: the centre of its top, hung from the room's ceiling on a cord; yaw as floor.
 * Which room a floor, surface or ceiling thing is in follows from x and z, so it is not stored.
 */
export type Anchor =
  | { mount: 'floor'; x: number; z: number; yaw: number }
  | { mount: 'surface'; x: number; y: number; z: number; yaw: number; on?: Id }
  | { mount: 'wall'; wallId: Id; roomId: Id; along: number; height: number; spin: number }
  | { mount: 'ceiling'; x: number; z: number; yaw: number }

/** A placed thing. Its label and size are the item's, not the placement's: the version note names it. */
export interface Furniture {
  id: Id
  item: ItemRef
  at: Anchor
}

export interface Plan {
  version: typeof PLAN_VERSION
  corners: Corner[]
  walls: Wall[]
  rooms: Room[]
  furniture: Furniture[]
}

export type Edit =
  /** Move a wall (both its corners) along its chord normal; positive is toward (dz, -dx). Snaps to 10 cm. */
  | { op: 'moveWall'; wallId: Id; by: number }
  /** Set a wall's bulge. Snaps to 5 cm. */
  | { op: 'bendWall'; wallId: Id; sagitta: number }
  | { op: 'moveOpening'; openingId: Id; from: number; to: number }
  /**
   * Attach a new rectangular room along a straight wall that bounds one room: from/to
   * are metres along that wall from its corner a, depth how far the new room reaches.
   * The wall is split at the new corners so the shared stretch is one wall bounding
   * both rooms. New ids derive from room.id: corners `<id>.c1..`, walls `<id>.w1..w3`,
   * the shared piece `<id>.shared` (the host's id stays on the piece at its corner a,
   * and the piece after the shared one is `<id>.rest`). door.from/to use the host's frame.
   */
  | {
      op: 'addRoom'
      room: { id: Id; label: string }
      wallId: Id
      from: number
      to: number
      depth: number
      /** No leaves is a plain opening. */
      door?: { id: Id; from: number; to: number; leaves?: 1 | 2; head?: number }
    }
  /** Place a new thing. Its id is new to the plan; the anchor must be in a room (wall: on the wall, facing a room it bounds). */
  | { op: 'placeItem'; furniture: Furniture }
  /** Move a placed thing. It keeps its mount: a picture stays on walls. */
  | { op: 'moveItem'; furnitureId: Id; at: Anchor }
  | { op: 'removeItem'; furnitureId: Id }

export class PlanError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join('; '))
  }
}

export const MIN_WALL = 0.5
/** A wall move stops before any wall it drags along gets shorter than this. */
export const MIN_ROOM_SIDE = 2
export const MOVE_SNAP = 0.1
export const BEND_SNAP = 0.05

// Today's kitchen. The left wall is centred on x = -3.4 and the right wall's inner
// face is at x = 3.4 (room.ts and diorama.ts), so the centrelines are not symmetric.
const T = 0.18
const H = 3
const back = WALL_Z - T / 2
const front = WALL_Z + 6 + T / 2
const left = -3.4
const right = 3.4 + T / 2

export const KITCHEN: Plan = {
  version: PLAN_VERSION,
  corners: [
    { id: 'kitchen.back-left', x: left, z: back },
    { id: 'kitchen.back-right', x: right, z: back },
    { id: 'kitchen.front-right', x: right, z: front },
    { id: 'kitchen.front-left', x: left, z: front },
  ],
  walls: [
    {
      id: 'kitchen.back', a: 'kitchen.back-left', b: 'kitchen.back-right', thickness: T, height: H, sagitta: 0,
      openings: [
        { id: 'kitchen.door-living', kind: 'door', from: DOORWAY.x0 - left, to: DOORWAY.x1 - left, sill: 0, head: DOORWAY.top, leaves: 1 },
        { id: 'kitchen.window', kind: 'window', from: WINDOW.x0 - left, to: WINDOW.x1 - left, sill: WINDOW.y0, head: WINDOW.y1 },
      ],
    },
    { id: 'kitchen.right', a: 'kitchen.back-right', b: 'kitchen.front-right', thickness: T, height: H, sagitta: 0, openings: [] },
    { id: 'kitchen.front', a: 'kitchen.front-right', b: 'kitchen.front-left', thickness: T, height: H, sagitta: 0, openings: [] },
    { id: 'kitchen.left', a: 'kitchen.front-left', b: 'kitchen.back-left', thickness: T, height: H, sagitta: 0, openings: [] },
  ],
  rooms: [{ id: 'kitchen', label: 'Kitchen', loop: ['kitchen.back-left', 'kitchen.back-right', 'kitchen.front-right', 'kitchen.front-left'] }],
  furniture: [],
}

// ---------------------------------------------------------------- geometry

export type P = [number, number]

/** A wall's centreline, derived from its corners and sagitta. */
export interface Curve {
  a: P
  b: P
  chord: number
  /** Unit chord direction a→b and the unit normal (dz, -dx) that positive sagitta bulges toward. */
  dir: P
  normal: P
  sagitta: number
  /** Infinity for a straight wall. */
  radius: number
  centre: P
  /** Half the angle the arc subtends, in radians (0 when straight). */
  half: number
  /** Centreline length: the arc length when curved. */
  length: number
  /** +1 when the angle grows from a to b (atan2(z, x) convention), else -1. */
  turn: number
  start: number
}

const cornerOf = (plan: Plan, id: Id) => {
  const c = plan.corners.find((k) => k.id === id)
  if (!c) throw new PlanError([`corner ${id} does not exist`])
  return c
}
export const wallOf = (plan: Plan, id: Id) => {
  const w = plan.walls.find((k) => k.id === id)
  if (!w) throw new PlanError([`wall ${id} does not exist`])
  return w
}

export function curveOf(plan: Plan, wall: Wall): Curve {
  const A = cornerOf(plan, wall.a), B = cornerOf(plan, wall.b)
  return curve([A.x, A.z], [B.x, B.z], wall.sagitta)
}

export function curve(a: P, b: P, sagitta: number): Curve {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const chord = Math.hypot(dx, dz)
  const dir: P = [dx / chord, dz / chord]
  const normal: P = [dir[1], -dir[0]]
  if (Math.abs(sagitta) < 1e-9) {
    return { a, b, chord, dir, normal, sagitta: 0, radius: Infinity, centre: [NaN, NaN], half: 0, length: chord, turn: 1, start: 0 }
  }
  const s = Math.abs(sagitta)
  const radius = (chord * chord / 4 + s * s) / (2 * s)
  const half = 2 * Math.atan(2 * s / chord)
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
  const k = sagitta - Math.sign(sagitta) * radius
  const centre: P = [mx + normal[0] * k, mz + normal[1] * k]
  const ua: P = [a[0] - centre[0], a[1] - centre[1]]
  const um: P = [mx + normal[0] * sagitta - centre[0], mz + normal[1] * sagitta - centre[1]]
  const turn = ua[0] * um[1] - ua[1] * um[0] > 0 ? 1 : -1
  return { a, b, chord, dir, normal, sagitta, radius, centre, half, length: 2 * radius * half, turn, start: Math.atan2(ua[1], ua[0]) }
}

/** The centreline point t metres from a. Beyond either end it runs on along the end's tangent. */
export function pointAt(c: Curve, t: number): P {
  if (c.radius === Infinity) return [c.a[0] + c.dir[0] * t, c.a[1] + c.dir[1] * t]
  const u = Math.min(Math.max(t, 0), c.length)
  const phi = c.start + c.turn * u / c.radius
  const p: P = [c.centre[0] + c.radius * Math.cos(phi), c.centre[1] + c.radius * Math.sin(phi)]
  if (u === t) return p
  const [tx, tz] = tangentAt(c, u)
  return [p[0] + tx * (t - u), p[1] + tz * (t - u)]
}

export function tangentAt(c: Curve, t: number): P {
  if (c.radius === Infinity) return c.dir
  const phi = c.start + c.turn * Math.min(Math.max(t, 0), c.length) / c.radius
  return [-Math.sin(phi) * c.turn, Math.cos(phi) * c.turn]
}

/** The unit normal at t on the side positive sagitta bulges toward. */
export function normalAt(c: Curve, t: number): P {
  if (c.radius === Infinity) return c.normal
  const [tx, tz] = tangentAt(c, t)
  return [tz, -tx]
}

/** Segments to draw a wall with: one when straight, about one per 10 cm when curved, at most 64. */
export function segmentsOf(c: Curve): number {
  return c.radius === Infinity ? 1 : Math.min(64, Math.max(4, Math.ceil(c.length / 0.1)))
}

/** The area between the arc and its chord. */
export function segmentArea(c: Curve): number {
  return c.radius === Infinity ? 0 : (c.radius * c.radius * (2 * c.half - Math.sin(2 * c.half))) / 2
}

/** Each wall of a room in loop order, and whether the loop runs it a→b. */
export function roomWalls(plan: Plan, room: Room): Array<{ wall: Wall; forward: boolean }> {
  return room.loop.map((id, i) => {
    const next = room.loop[(i + 1) % room.loop.length]
    const wall = plan.walls.find((w) => (w.a === id && w.b === next) || (w.b === id && w.a === next))
    if (!wall) throw new PlanError([`room ${room.id} has no wall between ${id} and ${next}`])
    return { wall, forward: wall.a === id }
  })
}

/** Floor area inside the centrelines: the corner polygon plus or minus each wall's bulge. */
export function roomArea(plan: Plan, roomId: Id): number {
  const room = plan.rooms.find((r) => r.id === roomId)
  if (!room) throw new PlanError([`room ${roomId} does not exist`])
  const pts = room.loop.map((id) => cornerOf(plan, id))
  let area = 0
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]
    area += p.x * q.z - q.x * p.z
  })
  area /= 2
  for (const { wall, forward } of roomWalls(plan, room)) {
    const c = curveOf(plan, wall)
    area += segmentArea(c) * Math.sign(c.sagitta) * (forward ? 1 : -1)
  }
  return area
}

/**
 * The room's outline as a polygon (curved walls tessellated), pulled in from the
 * centrelines by `inset` metres. With inset = half the wall thickness it is the
 * floor inside the walls; at square corners it meets the inner corner exactly.
 */
export function outline(plan: Plan, room: Room, inset = 0): P[] {
  const out: P[] = []
  for (const { wall, forward } of roomWalls(plan, room)) {
    const c = curveOf(plan, wall)
    const n = segmentsOf(c)
    const t0 = inset, t1 = c.length - inset
    for (let i = 0; i <= n; i++) {
      const t = forward ? t0 + (t1 - t0) * (i / n) : t1 - (t1 - t0) * (i / n)
      const [px, pz] = pointAt(c, t)
      const [nx, nz] = normalAt(c, t)
      // Outward for this room is the normal when the loop runs a→b.
      const k = forward ? -inset : inset
      const p: P = [px + nx * k, pz + nz * k]
      const last = out[out.length - 1]
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push(p)
    }
  }
  const [f, l] = [out[0], out[out.length - 1]]
  if (out.length > 1 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) out.pop()
  return out
}

export function polygonArea(points: P[]): number {
  let a = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]
    a += p[0] * q[1] - q[0] * p[1]
  })
  return a / 2
}

function selfIntersects(points: P[]): boolean {
  const n = points.length
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent through the closing edge
      const c = points[j], d = points[(j + 1) % n]
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
    }
  }
  return false
}

// ---------------------------------------------------------------- validation

/** Every reason the plan is not a valid house; empty when it is. */
export function validate(plan: Plan): string[] {
  const reasons: string[] = []
  if (plan.version !== PLAN_VERSION) reasons.push(`version ${plan.version} is not ${PLAN_VERSION}`)
  const seen = new Set<Id>()
  const ids = [
    ...plan.corners.map((c) => c.id), ...plan.walls.map((w) => w.id), ...plan.walls.flatMap((w) => w.openings.map((o) => o.id)),
    ...plan.rooms.map((r) => r.id), ...plan.furniture.map((f) => f.id),
  ]
  for (const id of ids) {
    if (seen.has(id)) reasons.push(`id ${id} is used twice`)
    seen.add(id)
  }
  const corners = new Set(plan.corners.map((c) => c.id))
  const goodWalls = new Set<Id>()
  for (const w of plan.walls) {
    if (!corners.has(w.a) || !corners.has(w.b)) {
      reasons.push(`wall ${w.id} names a corner that does not exist`)
      continue
    }
    if (w.a === w.b) {
      reasons.push(`wall ${w.id} starts and ends at the same corner`)
      continue
    }
    const c = curveOf(plan, w)
    if (c.chord < MIN_WALL) reasons.push(`wall ${w.id} is ${c.chord.toFixed(2)} m, under ${MIN_WALL} m`)
    if (Math.abs(w.sagitta) > c.chord / 2 + 1e-9) reasons.push(`wall ${w.id} bulges ${w.sagitta.toFixed(2)} m, beyond a half circle`)
    const sorted = [...w.openings].sort((p, q) => p.from - q.from)
    sorted.forEach((o, i) => {
      if (!(o.from >= -1e-9 && o.to <= c.length + 1e-9 && o.from < o.to)) reasons.push(`opening ${o.id} does not fit on wall ${w.id}`)
      if (!(o.sill >= 0 && o.sill < o.head && o.head <= w.height)) reasons.push(`opening ${o.id} has a bad sill or head`)
      if (i > 0 && o.from < sorted[i - 1].to) reasons.push(`opening ${o.id} overlaps ${sorted[i - 1].id}`)
    })
    goodWalls.add(w.id)
  }
  const bounding = new Map<Id, number>()
  for (const r of plan.rooms) {
    if (r.loop.length < 3) {
      reasons.push(`room ${r.id} has fewer than three corners`)
      continue
    }
    const missing = r.loop.filter((id) => !corners.has(id))
    if (missing.length) {
      reasons.push(`room ${r.id} names corners that do not exist: ${missing.join(', ')}`)
      continue
    }
    let walls: ReturnType<typeof roomWalls>
    try {
      walls = roomWalls(plan, r)
    } catch (e) {
      reasons.push(...(e as PlanError).reasons)
      continue
    }
    if (walls.some(({ wall }) => !goodWalls.has(wall.id))) continue
    for (const { wall } of walls) bounding.set(wall.id, (bounding.get(wall.id) ?? 0) + 1)
    const ring = outline(plan, r)
    if (polygonArea(ring) <= 0) reasons.push(`room ${r.id} winds the wrong way or has no area`)
    if (selfIntersects(ring)) reasons.push(`room ${r.id} crosses itself`)
  }
  for (const [id, n] of bounding) if (n > 2) reasons.push(`wall ${id} bounds ${n} rooms`)
  // A wall thing stays on its wall (moving and bending walls, and adding rooms, carry it or
  // stop before it falls off). A floor or ceiling thing a wall move leaves outside its room
  // is still a valid house (the home clamps it when drawing); the edits that place and move
  // things check the fit (anchorReasons).
  const roomIds = new Set(plan.rooms.map((r) => r.id))
  for (const f of plan.furniture) {
    if (f.at.mount === 'surface' && f.at.on !== undefined) reasons.push(...supportReasons(plan, f.id, f.at.on))
    if (f.at.mount !== 'wall') continue
    const wall = plan.walls.find((w) => w.id === (f.at as { wallId: Id }).wallId)
    if (!wall) reasons.push(`furniture ${f.id} hangs on wall ${f.at.wallId}, which does not exist`)
    else if (goodWalls.has(wall.id)) {
      const { length } = curveOf(plan, wall)
      if (!(f.at.along >= -1e-9 && f.at.along <= length + 1e-9)) reasons.push(`furniture ${f.id} is ${f.at.along.toFixed(2)} m along wall ${wall.id}, which is ${length.toFixed(2)} m long`)
    }
    if (!roomIds.has(f.at.roomId)) reasons.push(`furniture ${f.id} faces room ${f.at.roomId}, which does not exist`)
  }
  return reasons
}

// ---------------------------------------------------------------- edits

const snap = (v: number, step: number) => Math.round(v / step) * step
const round = (v: number) => Math.round(v * 1e6) / 1e6

/** Apply one edit. Moves and bends snap and stop at the nearest valid value; other invalid edits throw a PlanError. */
export function apply(plan: Plan, edit: Edit): Plan {
  switch (edit.op) {
    case 'moveWall': return moveWall(plan, edit.wallId, edit.by)
    case 'bendWall': return bendWall(plan, edit.wallId, edit.sagitta)
    case 'moveOpening': return moveOpening(plan, edit.openingId, edit.from, edit.to)
    case 'addRoom': return addRoom(plan, edit)
    case 'placeItem': return placeItem(plan, edit.furniture)
    case 'moveItem': return moveItem(plan, edit.furnitureId, edit.at)
    case 'removeItem': return removeItem(plan, edit.furnitureId)
  }
}

function moveWall(plan: Plan, wallId: Id, by: number): Plan {
  const wall = wallOf(plan, wallId)
  const { normal } = curveOf(plan, wall)
  const touching = plan.walls.filter((w) => w.id !== wallId && [w.a, w.b].some((id) => id === wall.a || id === wall.b))
  const attempt = (d: number): Plan | null => {
    const moved = new Set([wall.a, wall.b])
    const corners = plan.corners.map((c) => (moved.has(c.id) ? { ...c, x: round(c.x + normal[0] * d), z: round(c.z + normal[1] * d) } : c))
    const next: Plan = { ...plan, corners }
    // Openings and wall things on a wall whose corner a moved stay where they are in the room.
    const shifts = new Map<Id, number>()
    for (const w of plan.walls) if (moved.has(w.a) && w.id !== wallId) shifts.set(w.id, curveOf(next, w).length - curveOf(plan, w).length)
    next.walls = plan.walls.map((w) => {
      const shift = shifts.get(w.id)
      if (shift === undefined || !w.openings.length) return w
      return { ...w, openings: w.openings.map((o) => ({ ...o, from: round(o.from + shift), to: round(o.to + shift) })) }
    })
    next.furniture = plan.furniture.map((f) => {
      const shift = f.at.mount === 'wall' ? shifts.get(f.at.wallId) : undefined
      return shift === undefined || f.at.mount !== 'wall' ? f : { ...f, at: { ...f.at, along: round(f.at.along + shift) } }
    })
    if (touching.some((w) => curveOf(next, w).chord < MIN_ROOM_SIDE - 1e-9)) return null
    return validate(next).length ? null : next
  }
  for (let d = snap(by, MOVE_SNAP); Math.abs(d) > 1e-9; d = round(d - Math.sign(d) * MOVE_SNAP)) {
    const next = attempt(round(d))
    if (next) return next
  }
  return plan
}

function bendWall(plan: Plan, wallId: Id, sagitta: number): Plan {
  const wall = wallOf(plan, wallId)
  const { chord } = curveOf(plan, wall)
  const limit = Math.floor((chord / 2) / BEND_SNAP + 1e-9) * BEND_SNAP
  for (let s = Math.max(-limit, Math.min(limit, snap(sagitta, BEND_SNAP))); ; s = round(s - Math.sign(s) * BEND_SNAP)) {
    const next: Plan = { ...plan, walls: plan.walls.map((w) => (w.id === wallId ? { ...w, sagitta: round(s) } : w)) }
    if (!validate(next).length || Math.abs(s) < 1e-9) return validate(next).length ? plan : next
  }
}

function moveOpening(plan: Plan, openingId: Id, from: number, to: number): Plan {
  const host = plan.walls.find((w) => w.openings.some((o) => o.id === openingId))
  if (!host) throw new PlanError([`opening ${openingId} does not exist`])
  const next: Plan = {
    ...plan,
    walls: plan.walls.map((w) => (w === host ? { ...w, openings: w.openings.map((o) => (o.id === openingId ? { ...o, from, to } : o)) } : w)),
  }
  const reasons = validate(next)
  if (reasons.length) throw new PlanError(reasons)
  return next
}

function addRoom(plan: Plan, edit: Extract<Edit, { op: 'addRoom' }>): Plan {
  const host = wallOf(plan, edit.wallId)
  const c = curveOf(plan, host)
  if (c.radius !== Infinity) throw new PlanError([`wall ${host.id} is curved; a room can only attach along a straight wall for now`])
  const owners = plan.rooms.filter((r) => roomWalls(plan, r).some(({ wall }) => wall.id === host.id))
  if (owners.length !== 1) throw new PlanError([`wall ${host.id} bounds ${owners.length} rooms; a new room needs a wall with one room on it`])
  const owner = owners[0]
  const forward = roomWalls(plan, owner).find(({ wall }) => wall.id === host.id)!.forward
  const { from, to, depth } = edit
  const L = c.length
  if (!(from >= 0 && to <= L + 1e-9 && to - from >= MIN_WALL && depth >= MIN_WALL)) throw new PlanError([`the new room does not fit along wall ${host.id}`])
  const out: P = forward ? c.normal : [-c.normal[0], -c.normal[1]]
  const id = edit.room.id
  const corners = [...plan.corners]
  const at = (t: number, name: string): Id => {
    if (t < 1e-9) return host.a
    if (t > L - 1e-9) return host.b
    const [x, z] = pointAt(c, t)
    corners.push({ id: `${id}.${name}`, x: round(x), z: round(z) })
    return `${id}.${name}`
  }
  const p = at(from, 'c1'), q = at(to, 'c2')
  const far = (t: number, name: string): Id => {
    const [x, z] = pointAt(c, t)
    corners.push({ id: `${id}.${name}`, x: round(x + out[0] * depth), z: round(z + out[1] * depth) })
    return `${id}.${name}`
  }
  const pf = far(from, 'c3'), qf = far(to, 'c4')

  // Split the host into up to three pieces and re-home its openings.
  const pieces: Array<{ id: Id; a: Id; b: Id; t0: number; t1: number }> = []
  if (from > 1e-9) pieces.push({ id: host.id, a: host.a, b: p, t0: 0, t1: from })
  const sharedId = from > 1e-9 ? `${id}.shared` : host.id
  pieces.push({ id: sharedId, a: p, b: q, t0: from, t1: to })
  if (to < L - 1e-9) pieces.push({ id: `${id}.rest`, a: q, b: host.b, t0: to, t1: L })
  const reasons: string[] = []
  const split: Wall[] = pieces.map((k) => ({
    ...host, id: k.id, a: k.a, b: k.b,
    openings: host.openings.filter((o) => o.from >= k.t0 - 1e-9 && o.to <= k.t1 + 1e-9).map((o) => ({ ...o, from: round(o.from - k.t0), to: round(o.to - k.t0) })),
  }))
  for (const o of host.openings) if (!split.some((w) => w.openings.some((x) => x.id === o.id))) reasons.push(`opening ${o.id} straddles a new corner`)
  // Things hung on the host move to the piece they are on, measured from its corner a.
  const furniture = plan.furniture.map((f) => {
    if (f.at.mount !== 'wall' || f.at.wallId !== host.id) return f
    const along = f.at.along
    const k = pieces.find((k) => along >= k.t0 - 1e-9 && along <= k.t1 + 1e-9)
    return k ? { ...f, at: { ...f.at, wallId: k.id, along: round(along - k.t0) } } : f
  })
  if (edit.door) {
    const shared = split.find((w) => w.id === sharedId)!
    shared.openings.push({ id: edit.door.id, kind: 'door', from: round(edit.door.from - from), to: round(edit.door.to - from), sill: 0, head: edit.door.head ?? DOORWAY.top, ...(edit.door.leaves ? { leaves: edit.door.leaves } : {}) })
  }
  const fresh = (n: number, a: Id, b: Id): Wall => ({ id: `${id}.w${n}`, a, b, thickness: host.thickness, height: host.height, sagitta: 0, openings: [] })
  const walls = plan.walls.flatMap((w) => (w.id === host.id ? split : [w]))
  walls.push(fresh(1, p, pf), fresh(2, pf, qf), fresh(3, qf, q))

  // The owner's loop gains the new corners between the host's ends; the new room runs the shared piece the other way.
  const ownerLoop: Id[] = []
  owner.loop.forEach((cid, i) => {
    ownerLoop.push(cid)
    const next = owner.loop[(i + 1) % owner.loop.length]
    if (forward && cid === host.a && next === host.b) ownerLoop.push(...[p, q].filter((k) => k !== host.a && k !== host.b))
    if (!forward && cid === host.b && next === host.a) ownerLoop.push(...[q, p].filter((k) => k !== host.a && k !== host.b))
  })
  const rooms = plan.rooms.map((r) => (r === owner ? { ...r, loop: ownerLoop } : r))
  rooms.push({ id, label: edit.room.label, loop: forward ? [q, p, pf, qf] : [p, q, qf, pf] })
  const next: Plan = { ...plan, corners, walls, rooms, furniture }
  reasons.push(...validate(next))
  if (reasons.length) throw new PlanError(reasons)
  return next
}

// ---------------------------------------------------------------- furniture

const finite = (...v: number[]) => v.every(Number.isFinite)
const ITEM_ID = /^[a-f0-9]{12}$/
const KIND = /^[a-z][a-z0-9-]{0,31}$/

/** Inside a ring (even-odd). */
export function inside(ring: P[], p: P): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** The room whose floor (inside its walls' centrelines) holds the point, if any. */
export function roomAt(plan: Plan, x: number, z: number): Room | null {
  return plan.rooms.find((r) => inside(outline(plan, r), [x, z])) ?? null
}

/** Why an item reference or anchor cannot be placed in this plan; empty when it can. */
export function anchorReasons(plan: Plan, id: Id, item: ItemRef | null, at: Anchor): string[] {
  const reasons: string[] = []
  if (item) {
    if ('library' in item) {
      if (!ITEM_ID.test(item.library) || typeof item.person !== 'string' || !item.person) reasons.push(`furniture ${id} names a library item that is not 12 hex characters of a person's library`)
    } else if (!('kind' in item) || !KIND.test(item.kind)) reasons.push(`furniture ${id} names no library item or kind`)
  }
  if (!MOUNTS.includes(at.mount)) return [...reasons, `furniture ${id} has no mount`]
  if (at.mount === 'wall') {
    const wall = plan.walls.find((w) => w.id === at.wallId)
    if (!wall) return [...reasons, `furniture ${id} hangs on wall ${at.wallId}, which does not exist`]
    const room = plan.rooms.find((r) => r.id === at.roomId)
    if (!room) return [...reasons, `furniture ${id} faces room ${at.roomId}, which does not exist`]
    if (!roomWalls(plan, room).some(({ wall: w }) => w.id === wall.id)) reasons.push(`wall ${wall.id} does not bound room ${room.id}`)
    if (!finite(at.along, at.height, at.spin)) reasons.push(`furniture ${id} has a position that is not a number`)
    else {
      const { length } = curveOf(plan, wall)
      if (at.along < 0 || at.along > length) reasons.push(`furniture ${id} is ${at.along.toFixed(2)} m along wall ${wall.id}, which is ${length.toFixed(2)} m long`)
      if (at.height < 0 || at.height > wall.height) reasons.push(`furniture ${id} hangs ${at.height.toFixed(2)} m up a ${wall.height} m wall`)
    }
    return reasons
  }
  const y = at.mount === 'surface' ? at.y : 0
  if (!finite(at.x, at.z, at.yaw, y)) return [...reasons, `furniture ${id} has a position that is not a number`]
  if (at.mount === 'surface' && at.on !== undefined) reasons.push(...supportReasons(plan, id, at.on))
  if (at.mount === 'surface' && (y < 0 || y > 3)) reasons.push(`furniture ${id} stands on a top ${y.toFixed(2)} m up`)
  if (!roomAt(plan, at.x, at.z)) reasons.push(`furniture ${id} at ${at.x.toFixed(2)}, ${at.z.toFixed(2)} is not in a room`)
  return reasons
}

/** Why furniture `id` cannot stand on furniture `on`: it must exist, stand on the floor or a top, and not stand (at any depth) on `id`. */
function supportReasons(plan: Plan, id: Id, on: Id): string[] {
  const seen = new Set<Id>([id])
  for (let at: Id | undefined = on; at !== undefined; ) {
    if (seen.has(at)) return [`furniture ${id} stands on ${on}, which stands on it`]
    seen.add(at)
    const support = plan.furniture.find((k) => k.id === at)
    if (!support) return [`furniture ${id} stands on ${at}, which is not in the house`]
    if (support.at.mount !== 'floor' && support.at.mount !== 'surface') return [`furniture ${id} stands on ${at}, which is on the ${support.at.mount}`]
    at = support.at.mount === 'surface' ? support.at.on : undefined
  }
  return []
}

// Rebuilt from their known fields, as the host stores them, so a replay hashes the same.
const itemOf = (item: ItemRef): ItemRef => ('library' in item ? { library: item.library, person: item.person } : { kind: item.kind })
function anchorOf(at: Anchor): Anchor {
  switch (at.mount) {
    case 'floor': return { mount: at.mount, x: at.x, z: at.z, yaw: at.yaw }
    case 'surface': return { mount: at.mount, x: at.x, y: at.y, z: at.z, yaw: at.yaw, ...(at.on === undefined ? {} : { on: at.on }) }
    case 'wall': return { mount: at.mount, wallId: at.wallId, roomId: at.roomId, along: at.along, height: at.height, spin: at.spin }
    case 'ceiling': return { mount: at.mount, x: at.x, z: at.z, yaw: at.yaw }
  }
}

function placeItem(plan: Plan, f: Furniture): Plan {
  const ids = [...plan.corners, ...plan.walls, ...plan.walls.flatMap((w) => w.openings), ...plan.rooms, ...plan.furniture].map((k) => k.id)
  const reasons = ids.includes(f.id) ? [`id ${f.id} is used`] : []
  reasons.push(...anchorReasons(plan, f.id, f.item, f.at))
  if (reasons.length) throw new PlanError(reasons)
  return { ...plan, furniture: [...plan.furniture, { id: f.id, item: itemOf(f.item), at: anchorOf(f.at) }] }
}

function moveItem(plan: Plan, furnitureId: Id, at: Anchor): Plan {
  const f = plan.furniture.find((k) => k.id === furnitureId)
  if (!f) throw new PlanError([`furniture ${furnitureId} does not exist`])
  if (f.at.mount !== at.mount) throw new PlanError([`furniture ${furnitureId} is mounted on the ${f.at.mount}, not the ${at.mount}`])
  const reasons = anchorReasons(plan, furnitureId, null, at)
  if (reasons.length) throw new PlanError(reasons)
  const moved = new Map<Id, Anchor>([[furnitureId, anchorOf(at)]])
  carry(plan, f, moved.get(furnitureId)!, moved)
  return { ...plan, furniture: plan.furniture.map((k) => (moved.has(k.id) ? { ...k, at: moved.get(k.id)! } : k)) }
}

/** What stands on `support` (at any depth) moves with it: the same shift, and turned about its centre by the same turn. */
function carry(plan: Plan, support: Furniture, to: Anchor, moved: Map<Id, Anchor>) {
  const from = support.at
  if ((from.mount !== 'floor' && from.mount !== 'surface') || (to.mount !== 'floor' && to.mount !== 'surface')) return
  const dy = (to.mount === 'surface' ? to.y : 0) - (from.mount === 'surface' ? from.y : 0)
  const turn = to.yaw - from.yaw
  const c = Math.cos(turn), s = Math.sin(turn)
  for (const g of plan.furniture) {
    if (g.at.mount !== 'surface' || g.at.on !== support.id || moved.has(g.id)) continue
    const ox = g.at.x - from.x, oz = g.at.z - from.z
    const next: Anchor = { ...g.at, x: round(to.x + ox * c + oz * s), y: round(g.at.y + dy), z: round(to.z - ox * s + oz * c), yaw: round(g.at.yaw + turn) }
    moved.set(g.id, next)
    carry(plan, g, next, moved)
  }
}

function removeItem(plan: Plan, furnitureId: Id): Plan {
  if (!plan.furniture.some((k) => k.id === furnitureId)) throw new PlanError([`furniture ${furnitureId} does not exist`])
  const standing = plan.furniture.filter((k) => k.at.mount === 'surface' && k.at.on === furnitureId).map((k) => k.id)
  if (standing.length) throw new PlanError([`furniture ${furnitureId} has ${standing.join(', ')} standing on it; move that first`])
  return { ...plan, furniture: plan.furniture.filter((k) => k.id !== furnitureId) }
}
