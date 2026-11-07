// The trusted resolver (#48): a checked intent, the plan and what the person is
// looking at become a draft room, and the draft becomes plan edits. Pure: no
// three.js, no DOM. Whatever the model asked for, only this code chooses the
// geometry, and an unclear or impossible request comes back as one short line
// the person's villager says, never as a form.
//
// Rules, stated once:
// - Sides are relative to the camera. The camera's view direction on the floor
//   is "behind"; its reverse is "front"; turned a quarter left or right it is
//   "left" or "right". The anchor room's wall whose outward normal points most
//   that way is the side. When two walls point that way about equally (the camera
//   looks at a corner, within 0.15 of each other in cosine), the resolver asks.
// - Sizes: w runs along the shared wall, d away from it ("4 by 3" is w 4, d 3).
//   "2/3 the size" is 2/3 of the anchor room's floor area (inside the wall
//   centrelines, as roomArea measures it): w starts at the shared wall's length
//   times the square root of the fraction, and of the 10 cm steps within 50 cm of
//   that, the pair (w, d) closest to the target area wins.
// - Everything snaps to 10 cm. The room is centred on the wall (or on the clicked
//   point), then slid along the wall to the nearest stretch with no window or
//   door on it.
// - A door is single (0.9 m) unless asked for double doors (1.4 m), centred on the
//   shared stretch or at the clicked point. An "opening" is a doorway with no leaves.
// - A door keeps 10 cm clear of the built-ins against either face of the shared
//   wall (`occupied`, from fixtures.ts). Blocked where it was asked for, it moves to
//   the nearest clear spot, sliding the room along the wall if it must. Double doors
//   with no clear spot become a single door that has one, and the villager says so;
//   when nothing fits, the resolver asks and names what is in the way.
import { MIN_WALL, PlanError, apply, curveOf, normalAt, roomArea, roomWalls, roomsOf, runsForward, wallOf, type Edit, type Id, type P, type Plan, type Room, type Wall } from './plan'
import type { Intent, Side } from './intent'

export interface ResolveContext {
  /** The camera's view direction on the floor (x, z); need not be unit length. */
  view: P
  /** The wall picked in build mode and where along it (metres from its corner a). */
  selected?: { wallId: Id; t: number } | null
  /** The room in view, for "this room". */
  current?: Id | null
  /** Built-ins a door must keep clear of on a wall, either face, in metres from its corner a. */
  occupied?: (wallId: Id) => Occupied[]
}

/** A stretch of a wall something built in stands against, from its corner a. */
export interface Occupied { from: number; to: number; name: string }

/** A room being drawn, before it is applied. Every length is in metres and snapped to 10 cm. */
export interface Draft {
  roomId: Id
  label: string
  /** The straight wall it hangs on, and the stretch it shares, from that wall's corner a. */
  wallId: Id
  from: number
  to: number
  depth: number
  /** Bulge of the far wall (0 is straight). */
  bend: number
  /** A door in the shared stretch, in the host wall's frame; no leaves is a plain opening. */
  door: { from: number; to: number; leaves?: 1 | 2 }
  /** What stands against the host wall, which the door keeps clear of (not part of the plan). */
  keepOut?: Occupied[]
}

/** `note`: what the villager says with the outline instead of the usual line, when it is not quite what was asked. */
export type Resolved = { draft: Draft; plan: Plan; edits: Edit[]; note?: string } | { ask: string }

export const SNAP = 0.1
const DOOR_WIDTH = { 1: 0.9, 2: 1.4, opening: 1.2 } as const
const DEFAULT = { w: 3.6, d: 3 }
const TIE = 0.15
/** A door keeps this far from the shared stretch's ends. */
const JAMB = 0.15
/** And this far from a built-in. */
export const CLEAR = 0.1

const snap = (v: number) => Math.round(v / SNAP) * SNAP
const round = (v: number) => Math.round(v * 1e6) / 1e6
const fmt = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')
const lower = (label: string) => label.toLowerCase()

/** The edits a draft stands for: one addRoom, and a bend of its far wall if it has one. */
export function draftEdits(plan: Plan, d: Draft): Edit[] {
  const edits: Edit[] = [{
    op: 'addRoom', room: { id: d.roomId, label: d.label }, wallId: d.wallId, from: d.from, to: d.to, depth: d.depth,
    door: { id: `${d.roomId}.door`, from: d.door.from, to: d.door.to, ...(d.door.leaves ? { leaves: d.door.leaves } : { head: OPENING_HEAD }) },
  }]
  // The draft's bend is positive outward; the far wall runs the new room's loop backwards when the host does not.
  if (Math.abs(d.bend) > 1e-9) edits.push({ op: 'bendWall', wallId: `${d.roomId}.w2`, sagitta: hostForward(plan, d.wallId) ? d.bend : -d.bend })
  return edits
}

const applyDraft = (plan: Plan, d: Draft): Plan => draftEdits(plan, d).reduce(apply, plan)

/** Does the one room on this wall run it a→b? */
/** A plain opening's head: the tallest a new door gets, so built-ins below it keep clear of the door. */
export const OPENING_HEAD = 2.3
const hostForward = (plan: Plan, wallId: Id) => runsForward(plan, roomsOf(plan, wallId)[0], wallId)

/** Does the draft make a valid house that runs into no other room? The plan it makes, or what to say. */
export function fit(plan: Plan, d: Draft): { plan: Plan } | { ask: string } {
  let next: Plan
  try {
    next = applyDraft(plan, d)
  } catch (e) {
    if (!(e instanceof PlanError)) throw e
    const hit = plan.rooms.find((r) => e.reasons.includes(`room ${d.roomId} overlaps room ${r.id}`))
    return { ask: hit ? `That runs into the ${lower(hit.label)}. Smaller, or elsewhere?` : "That doesn't fit. A bit smaller?" }
  }
  if (Math.abs(Math.abs(wallOf(next, `${d.roomId}.w2`).sagitta) - Math.abs(d.bend)) > 1e-6) return { ask: "It can't bend that far. Gentler?" }
  const block = blockerOf(d.door, d.keepOut)
  if (block) return { ask: `The ${block.name}'s in the way of the door.` }
  return { plan: next }
}

/** Resolve an intent against the plan and the view: a draft and the plan it makes, or one line to say. */
export function resolve(plan: Plan, intent: Intent, ctx: ResolveContext): Resolved {
  const sel = ctx.selected ?? null
  const bySelection = intent.anchor.wall === 'selected' || intent.connect?.at === 'selected-point'
  let room: Room | undefined
  let host: Wall | undefined
  if (bySelection && !intent.anchor.side) {
    if (!sel) return { ask: 'Which wall? Click one and tell me again.' }
    host = plan.walls.find((w) => w.id === sel.wallId)
    if (!host) return { ask: 'Which wall? Click one and tell me again.' }
    const owners = roomsOf(plan, host.id)
    if (owners.length !== 1) return { ask: `That wall joins the ${owners.map((r) => lower(r.label)).join(' and the ')}. An outside wall?` }
    room = owners[0]
  } else {
    const found = anchorRoom(plan, intent.anchor.room, ctx)
    if ('ask' in found) return found
    room = found.room
    if (!intent.anchor.side) return { ask: `Which side of the ${lower(room.label)}?` }
    const side = sideWall(plan, room, intent.anchor.side, ctx.view)
    if ('ask' in side) return side
    host = side.wall
  }
  const c = curveOf(plan, host)
  if (c.radius !== Infinity) return { ask: `That wall curves. Rooms go on straight walls for now.` }
  const L = c.length

  // Size.
  let w: number, d: number
  const size = intent.size
  if (size?.fraction !== undefined) {
    const target = size.fraction * roomArea(plan, room.id)
    const w0 = L * Math.sqrt(size.fraction)
    let best: [number, number, number] | null = null
    for (let k = -5; k <= 5; k++) {
      const wk = round(snap(w0) + k * SNAP)
      if (wk < 1.5 || wk > L + 1e-9) continue
      const dk = round(Math.max(1.5, snap(target / wk)))
      const err = Math.abs(wk * dk - target)
      if (!best || err < best[2] - 1e-9 || (Math.abs(err - best[2]) < 1e-9 && Math.abs(wk - w0) < Math.abs(best[0] - w0))) best = [wk, dk, err]
    }
    if (!best) return { ask: `That wall's too short. Smaller?` }
    ;[w, d] = best
  } else {
    w = round(snap(size?.w ?? Math.min(DEFAULT.w, L)))
    d = round(snap(size?.d ?? DEFAULT.d))
  }
  if (w > L + 1e-9) return { ask: `That wall is ${fmt(L)} m. Make it ${fmt(Math.floor(L * 10) / 10)} m wide?` }

  // Where along the wall: centred on the click or the wall, then slid clear of windows and doors.
  const centre = bySelection && sel && sel.wallId === host.id ? sel.t : L / 2
  const free = freeStretches(host, L)
  let from: number | null = null
  /** Every place along the wall the room may start. */
  const starts: number[] = []
  for (const [a, b] of free) {
    if (b - a < w - 1e-9) continue
    const lo = Math.ceil((a - 1e-9) / SNAP) * SNAP, hi = Math.floor((b - w + 1e-9) / SNAP) * SNAP
    if (hi < lo - 1e-9) continue
    // Every 10 cm step in the stretch, and flush with its end; a split must not leave a piece of wall under MIN_WALL.
    const steps = Array.from({ length: Math.round((hi - lo) / SNAP) + 1 }, (_, i) => round(lo + i * SNAP))
    if (b > L - 1e-9) steps.push(round(L - w))
    for (const f of steps) {
      const rest = L - (f + w)
      if ((f > 1e-9 && f < MIN_WALL - 1e-9) || (rest > 1e-9 && rest < MIN_WALL - 1e-9) || f < a - 1e-9 || f + w > b + 1e-9) continue
      starts.push(f)
      if (from === null || Math.abs(f + w / 2 - centre) < Math.abs(from + w / 2 - centre) - 1e-9) from = f
    }
  }
  if (from === null) return { ask: host.openings.length ? `A window or a door is in the way. Narrower than ${fmt(w)} m?` : `That leaves a sliver of wall at the end. The whole wall, ${fmt(L)} m?` }
  let to = round(from + w)

  // The door, clear of what stands against the wall; the room slides along the wall if the door must.
  const kind = intent.connect?.kind ?? 'door'
  let leaves = kind === 'opening' ? undefined : intent.connect?.leaves ?? 1
  const atPoint = intent.connect?.at === 'selected-point' && sel && sel.wallId === host.id
  const doorAt = atPoint ? sel.t : (from + to) / 2
  const keepOut = ctx.occupied?.(host.id) ?? []
  /** The room start nearest where it was asked for that holds a clear door this wide, and that door. */
  const clearDoor = (dw: number) => {
    const here = placeDoor(from!, to, dw, doorAt, keepOut)
    if (!blockerOf(here, keepOut)) return { f: from!, door: here }
    const order = starts.filter((f) => f !== from).sort((p, q) => Math.abs(p + w / 2 - centre) - Math.abs(q + w / 2 - centre))
    for (const f of order) {
      const door = placeDoor(f, round(f + w), dw, atPoint ? doorAt : f + w / 2, keepOut)
      if (!blockerOf(door, keepOut)) return { f, door }
    }
    return null
  }
  let note: string | undefined
  const name = blockerOf(placeDoor(from, to, DOOR_WIDTH[leaves ?? 'opening'], doorAt), keepOut)?.name
  let found = clearDoor(DOOR_WIDTH[leaves ?? 'opening'])
  if (!found && leaves === 2 && (found = clearDoor(DOOR_WIDTH[1]))) {
    leaves = 1
    note = `The ${name}'s in the way. One single door here instead?`
  }
  if (!found) return { ask: `The ${name ?? 'furniture'} is in the way there. Another wall?` }
  from = found.f
  to = round(from + w)
  const door = found.door

  const label = freshLabel(plan, intent.label ? intent.label.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase()) : 'New room')
  const draft: Draft = { roomId: freshId(plan, intent.label ?? 'room'), label, wallId: host.id, from, to, depth: d, bend: 0, door: { ...door, ...(leaves ? { leaves } : {}) }, ...(keepOut.length ? { keepOut } : {}) }
  const fitted = fit(plan, draft)
  if ('ask' in fitted) return fitted
  return { draft, plan: fitted.plan, edits: draftEdits(plan, draft), ...(note ? { note } : {}) }
}

/**
 * A door of width dw centred near `at`, kept inside the stretch [from, to] and snapped.
 * With `keepOut`, the nearest 10 cm step whose door stays CLEAR of every built-in;
 * when none does, the plain answer, which blockerOf then names.
 */
export function placeDoor(from: number, to: number, dw: number, at: number, keepOut: Occupied[] = []): { from: number; to: number } {
  const w = Math.min(dw, to - from - 2 * JAMB)
  const lo = from + JAMB, hi = to - JAMB - w
  const f = round(Math.min(hi, Math.max(lo, snap(at - w / 2))))
  const plain = { from: f, to: round(f + w) }
  if (!keepOut.length || !blockerOf(plain, keepOut)) return plain
  let best: { from: number; to: number } | null = null
  for (let k = Math.ceil((lo - 1e-9) / SNAP); k * SNAP <= hi + 1e-9; k++) {
    const g = round(k * SNAP)
    const door = { from: g, to: round(g + w) }
    if (blockerOf(door, keepOut)) continue
    if (!best || Math.abs(g - (at - w / 2)) < Math.abs(best.from - (at - w / 2)) - 1e-9) best = door
  }
  return best ?? plain
}

/** The built-in a door at [from, to] comes within CLEAR of, if any: the one most in the way. */
export function blockerOf(door: { from: number; to: number }, keepOut: Occupied[] = []): Occupied | null {
  let best: Occupied | null = null, most = -Infinity
  for (const o of keepOut) {
    const over = Math.min(door.to, o.to + CLEAR) - Math.max(door.from, o.from - CLEAR)
    if (over > 1e-9 && over > most) [best, most] = [o, over]
  }
  return best
}

function anchorRoom(plan: Plan, said: string | undefined, ctx: ResolveContext): { room: Room } | { ask: string } {
  if (!said || said === 'this') {
    const room = plan.rooms.find((r) => r.id === ctx.current) ?? (plan.rooms.length === 1 ? plan.rooms[0] : undefined)
    return room ? { room } : { ask: `Next to which room: the ${plan.rooms.map((r) => lower(r.label)).join(', the ')}?` }
  }
  const words = said.toLowerCase().replace(/^the\s+/, '').trim()
  const matches = plan.rooms.filter((r) => {
    const l = r.label.toLowerCase()
    return l === words || r.id === words || l.includes(words) || words.includes(l)
  })
  if (matches.length === 1) return { room: matches[0] }
  const known = plan.rooms.map((r) => `the ${lower(r.label)}`)
  if (matches.length > 1) return { ask: `Which one do you mean: ${known.join(' or ')}?` }
  return { ask: `No ${words} yet, only ${known.length > 1 ? `${known.slice(0, -1).join(', ')} and ${known.at(-1)}` : known[0]}. Which one?` }
}

/** The direction a side points in on the floor, from the camera's view direction. */
export function sideDirection(side: Side, view: P): P {
  const n = Math.hypot(view[0], view[1]) || 1
  const [fx, fz] = [view[0] / n, view[1] / n]
  // three.js looks down -z with +x to the right, so right is (-fz, fx) and left is (fz, -fx).
  return side === 'behind' ? [fx, fz] : side === 'front' ? [-fx, -fz] : side === 'left' ? [fz, -fx] : [-fz, fx]
}

function sideWall(plan: Plan, room: Room, side: Side, view: P): { wall: Wall } | { ask: string } {
  const dir = sideDirection(side, view)
  const walls = roomWalls(plan, room).map(({ wall, forward }) => {
    const c = curveOf(plan, wall)
    const [nx, nz] = normalAt(c, c.length / 2)
    const s = forward ? 1 : -1
    return { wall, c, dot: nx * s * dir[0] + nz * s * dir[1] }
  })
  const best = Math.max(...walls.map((k) => k.dot))
  // Split pieces of one straight side point the same way; a corner view has two sides close in cosine.
  const face = walls.filter((k) => k.dot > best - TIE)
  const other = Math.max(-1, ...walls.filter((k) => !face.includes(k)).map((k) => k.dot))
  // Two faces of the room point that way about equally: a wall in the face turns away from the best one.
  const lead = face.find((k) => k.dot === best)!
  const turned = face.some((k) => Math.abs(k.c.dir[0] * lead.c.dir[1] - k.c.dir[1] * lead.c.dir[0]) > 0.05)
  if (turned || best - other < TIE) return { ask: `I'm looking at a corner. Click the wall you mean?` }
  if (face.some((k) => k.c.radius !== Infinity)) return { ask: `That side curves. Rooms go on straight walls for now.` }
  const outside = face.filter((k) => roomsOf(plan, k.wall.id).length === 1)
  if (!outside.length) {
    const next = roomsOf(plan, face[0].wall.id).find((r) => r.id !== room.id)
    return { ask: `The ${lower(next?.label ?? 'room')} is already there. Elsewhere?` }
  }
  return { wall: outside.sort((p, q) => q.c.length - p.c.length)[0].wall }
}

/** Stretches of a wall with no opening on them, from corner a. */
function freeStretches(wall: Wall, L: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let at = 0
  for (const o of [...wall.openings].sort((p, q) => p.from - q.from)) {
    if (o.from > at) out.push([at, o.from])
    at = Math.max(at, o.to)
  }
  if (L > at) out.push([at, L])
  return out.filter(([a, b]) => b - a >= MIN_WALL)
}

/** Room names are unique in a house (people find rooms by name): a second "Study" becomes "Study 2". */
export function freshLabel(plan: Plan, said: string): string {
  const taken = new Set(plan.rooms.map((r) => r.label.toLowerCase()))
  let label = said
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${said} ${n}`
  return label
}

export function freshId(plan: Plan, label: string): Id {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room'
  const taken = new Set([...plan.rooms.map((r) => r.id), ...plan.corners.map((c) => c.id), ...plan.walls.map((w) => w.id)])
  const used = (id: string) => taken.has(id) || [...taken].some((t) => t.startsWith(`${id}.`))
  let id = base
  for (let n = 2; used(id); n++) id = `${base}-${n}`
  return id
}


/** Where a draft's pieces are on the floor, for drawing: corners, far wall, door, in world metres. */
export function draftGeometry(plan: Plan, d: Draft) {
  const host = plan.walls.find((w) => w.id === d.wallId)!
  const c = curveOf(plan, host)
  const forward = hostForward(plan, host.id)
  const out: P = forward ? c.normal : [-c.normal[0], -c.normal[1]]
  const at = (t: number, k = 0): P => [c.a[0] + c.dir[0] * t + out[0] * k, c.a[1] + c.dir[1] * t + out[1] * k]
  return { dir: c.dir, out, thickness: host.thickness, height: host.height, at, p: at(d.from), q: at(d.to), pf: at(d.from, d.depth), qf: at(d.to, d.depth), hostLength: c.length }
}
