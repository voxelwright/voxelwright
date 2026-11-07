// What a person asked the house to become (#48), as the router wrote it: data,
// never geometry. checkIntent() keeps only known fields with known values and
// clamps every number, so nothing the model wrote reaches the plan unchecked.
// The resolver (resolve.ts) turns a checked intent into an edit.

export type Side = 'left' | 'right' | 'behind' | 'front'

export interface AddRoomIntent {
  op: 'addRoom'
  /** What to call the new room ("Study"). */
  label?: string
  anchor: {
    /** A room's label as said ("living room"), or 'this' for the room in view. */
    room?: string
    /** Relative to the camera's view of that room. */
    side?: Side
    /** 'selected': the wall picked in build mode. */
    wall?: 'selected'
  }
  /** Metres: w along the shared wall, d away from it. Or a fraction of the anchor room's floor area. */
  size?: { w?: number; d?: number; fraction?: number }
  connect?: { kind: 'door' | 'opening'; leaves?: 1 | 2; at?: 'selected-point' | 'middle' }
  shape?: 'rect'
}

export type Intent = AddRoomIntent

const SIDES: readonly Side[] = ['left', 'right', 'behind', 'front']
const MIN_SIDE = 1.5
const MAX_SIDE = 12

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u001f\u007f\s]+/g, ' ').slice(0, max) : undefined)
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** The intent as plain checked data, or why it was refused. */
export function checkIntent(raw: unknown): { intent: Intent } | { reason: string } {
  const v = obj(raw)
  if (!v) return { reason: 'the intent is not an object' }
  if (v.op !== 'addRoom') return { reason: 'the intent names no known change' }
  const out: AddRoomIntent = { op: 'addRoom', anchor: {} }
  const label = text(v.label, 32)
  // A label is a name on a tag: letters, digits, spaces and a little punctuation.
  if (label && /^[\p{L}\p{N} '’&-]+$/u.test(label)) out.label = label
  const anchor = obj(v.anchor)
  if (anchor) {
    const room = text(anchor.room, 40)
    if (room) out.anchor.room = /^(this|selected|here|current|the current room|this room)$/i.test(room) ? 'this' : room
    if (typeof anchor.side === 'string' && (SIDES as readonly string[]).includes(anchor.side)) out.anchor.side = anchor.side as Side
    if (anchor.wall === 'selected') out.anchor.wall = 'selected'
  }
  const size = obj(v.size)
  if (size) {
    const w = num(size.w, MIN_SIDE, MAX_SIDE), d = num(size.d, MIN_SIDE, MAX_SIDE), fraction = num(size.fraction, 0.1, 2)
    if (fraction !== undefined) out.size = { fraction }
    else if (w !== undefined || d !== undefined) out.size = { ...(w !== undefined ? { w } : {}), ...(d !== undefined ? { d } : {}) }
  }
  const connect = obj(v.connect)
  if (connect) {
    const kind = connect.kind === 'opening' ? 'opening' : 'door'
    out.connect = { kind }
    if (kind === 'door') out.connect.leaves = connect.leaves === 2 ? 2 : 1
    if (connect.at === 'selected-point' || connect.at === 'middle') out.connect.at = connect.at
  }
  if (v.shape !== undefined && v.shape !== 'rect') return { reason: 'only rectangular rooms for now' }
  return { intent: out }
}
