// The house's plan versions (#48). The house is shared by the family, so there is
// one store, <root>/house/plans/, reached through /people/<id>/plans so the
// per-launch token and person check apply; each version records who made it.
//
// The store is an append-only event log, one file per event:
//   events/<seq>.json   {seq, kind: 'version', version}  a version; the head moves to it
//                       {seq, kind: 'head', head, by, at} undo, redo or checkout
//                       {seq, kind: 'name', id, name, by, at}
// An event is written whole to tmp/ and then hard-linked to its sequence number,
// which fails if that number exists. A write cut short leaves only a file in tmp/,
// never an event; two writers can never both take a number. Every head move is a
// compare-and-set against the head folded from the log: a version names its parent,
// a head move names the head it expects. A mismatch answers 409 with the current
// head; nothing is merged.
//
// The host checks the shape of everything and never runs or interprets a plan:
// the page replays edits with plan.ts and checks each version's hash.
import { randomBytes } from 'node:crypto'
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

const VERSION_ID = /^[a-f0-9]{16}$/
const HASH = /^[a-f0-9]{64}$/
/** Plan ids: `kitchen.back-left`, `pantry.c1`. */
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SEQ = /^(\d{8})\.json$/
const MAX_BODY = 256 * 1024
const MAX_EDITS = 50
const MAX_ITEMS = 500
const MAX_NOTE = 200
const MAX_NAME = 60
const MAX_LABEL = 40
/** Metres; a house plan has no business beyond this. */
const MAX_METRES = 1000

export interface Version { id: string; parent: string | null; edits: unknown[]; at: string; by: string; note?: string; base?: unknown; hash: string }
type Event =
  | { seq: number; kind: 'version'; version: Version }
  | { seq: number; kind: 'head'; head: string; by: string; at: string }
  | { seq: number; kind: 'name'; id: string; name: string; by: string; at: string }
interface State { versions: Version[]; head: string | null; names: Record<string, string>; seq: number }

class Refused extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const refuse = (message: string, status = 400): never => {
  throw new Refused(status, message)
}

// ---------------------------------------------------------------- shapes

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
function only(v: unknown, what: string, required: string[], optional: string[] = []): Obj {
  if (!isObj(v)) refuse(`${what} is an object`)
  const o = v as Obj
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) refuse(`${what} has an unknown field ${k}`)
  for (const k of required) if (o[k] === undefined) refuse(`${what} needs ${k}`)
  return o
}
const num = (v: unknown, what: string, max = MAX_METRES) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : refuse(`${what} is a number within ±${max}`))
const id = (v: unknown, what: string) => (typeof v === 'string' && PLAN_ID.test(v) ? v : refuse(`${what} is an id like kitchen.back-left`))
const text = (v: unknown, what: string, max: number) =>
  typeof v === 'string' && v.trim() && v.length <= max && !/[\p{Cc}\p{Cf}]/u.test(v) ? v.trim() : refuse(`${what} is 1 to ${max} characters of plain text`)
const list = (v: unknown, what: string, max = MAX_ITEMS) => (Array.isArray(v) && v.length <= max ? v : refuse(`${what} is a list of at most ${max}`))

/** One edit, rebuilt from its known fields. The ops are plan.ts's Edit union. */
function edit(v: unknown, at: string): Obj {
  if (!isObj(v)) return refuse(`${at} is an object`)
  switch (v.op) {
    case 'moveWall': {
      const e = only(v, at, ['op', 'wallId', 'by'])
      return { op: e.op, wallId: id(e.wallId, `${at}.wallId`), by: num(e.by, `${at}.by`) }
    }
    case 'bendWall': {
      const e = only(v, at, ['op', 'wallId', 'sagitta'])
      return { op: e.op, wallId: id(e.wallId, `${at}.wallId`), sagitta: num(e.sagitta, `${at}.sagitta`) }
    }
    case 'moveOpening': {
      const e = only(v, at, ['op', 'openingId', 'from', 'to'])
      return { op: e.op, openingId: id(e.openingId, `${at}.openingId`), from: num(e.from, `${at}.from`), to: num(e.to, `${at}.to`) }
    }
    case 'addRoom': {
      const e = only(v, at, ['op', 'room', 'wallId', 'from', 'to', 'depth'], ['door'])
      const room = only(e.room, `${at}.room`, ['id', 'label'])
      const out: Obj = {
        op: e.op, room: { id: id(room.id, `${at}.room.id`), label: text(room.label, `${at}.room.label`, MAX_LABEL) },
        wallId: id(e.wallId, `${at}.wallId`), from: num(e.from, `${at}.from`), to: num(e.to, `${at}.to`), depth: num(e.depth, `${at}.depth`),
      }
      if (e.door !== undefined) {
        // No leaves is a plain opening.
        const d = only(e.door, `${at}.door`, ['id', 'from', 'to'], ['leaves', 'head'])
        if (d.leaves !== undefined && d.leaves !== 1 && d.leaves !== 2) refuse(`${at}.door.leaves is 1 or 2`)
        out.door = {
          id: id(d.id, `${at}.door.id`), from: num(d.from, `${at}.door.from`), to: num(d.to, `${at}.door.to`),
          ...(d.leaves === undefined ? {} : { leaves: d.leaves }), ...(d.head === undefined ? {} : { head: num(d.head, `${at}.door.head`) }),
        }
      }
      return out
    }
    default:
      return refuse(`${at}.op is one of moveWall, bendWall, moveOpening, addRoom`)
  }
}

/** A whole plan (the root's base), rebuilt from its known fields. Whether it is a valid house is plan.ts's call, on the page. */
function plan(v: unknown): Obj {
  const p = only(v, 'base', ['version', 'corners', 'walls', 'rooms', 'furniture'])
  if (!Number.isInteger(p.version) || (p.version as number) < 1 || (p.version as number) > 1000) refuse('base.version is a positive integer')
  return {
    version: p.version,
    corners: list(p.corners, 'base.corners').map((c, i) => {
      const o = only(c, `base.corners[${i}]`, ['id', 'x', 'z'])
      return { id: id(o.id, 'corner id'), x: num(o.x, 'corner x'), z: num(o.z, 'corner z') }
    }),
    walls: list(p.walls, 'base.walls').map((w, i) => {
      const o = only(w, `base.walls[${i}]`, ['id', 'a', 'b', 'thickness', 'height', 'sagitta', 'openings'])
      return {
        id: id(o.id, 'wall id'), a: id(o.a, 'wall a'), b: id(o.b, 'wall b'),
        thickness: num(o.thickness, 'thickness', 5), height: num(o.height, 'height', 50), sagitta: num(o.sagitta, 'sagitta'),
        openings: list(o.openings, 'openings', 50).map((x, j) => {
          const k = only(x, `base.walls[${i}].openings[${j}]`, ['id', 'kind', 'from', 'to', 'sill', 'head'], ['leaves'])
          if (k.kind !== 'door' && k.kind !== 'window') refuse('an opening is a door or a window')
          if (k.leaves !== undefined && k.leaves !== 1 && k.leaves !== 2) refuse('leaves is 1 or 2')
          return { id: id(k.id, 'opening id'), kind: k.kind, from: num(k.from, 'from'), to: num(k.to, 'to'), sill: num(k.sill, 'sill', 50), head: num(k.head, 'head', 50), ...(k.leaves === undefined ? {} : { leaves: k.leaves }) }
        }),
      }
    }),
    rooms: list(p.rooms, 'base.rooms').map((r, i) => {
      const o = only(r, `base.rooms[${i}]`, ['id', 'label', 'loop'])
      return { id: id(o.id, 'room id'), label: text(o.label, 'room label', MAX_LABEL), loop: list(o.loop, 'loop', 200).map((c) => id(c, 'loop corner')) }
    }),
    furniture: list(p.furniture, 'base.furniture').map((f, i) => {
      const o = only(f, `base.furniture[${i}]`, ['id', 'kind', 'x', 'z', 'yaw', 'roomId'])
      return { id: id(o.id, 'furniture id'), kind: id(o.kind, 'furniture kind'), x: num(o.x, 'x'), z: num(o.z, 'z'), yaw: num(o.yaw, 'yaw', 10), roomId: id(o.roomId, 'roomId') }
    }),
  }
}

// ---------------------------------------------------------------- store

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) refuse(`a request is at most ${MAX_BODY} bytes`, 413)
  }
  try {
    return JSON.parse(raw)
  } catch {
    return refuse('expected JSON')
  }
}

export function planStore(root: string) {
  const dir = join(root, 'house', 'plans')
  const events = join(dir, 'events')
  const tmp = join(dir, 'tmp')
  // One write at a time in this process; link() refuses a second writer from elsewhere.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  async function load(): Promise<State> {
    const files = (await readdir(events).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))).filter((f) => SEQ.test(f)).sort()
    const state: State = { versions: [], head: null, names: {}, seq: 0 }
    for (const f of files) {
      const seq = Number(SEQ.exec(f)![1])
      // A gap or an unreadable event is a damaged store: fail loudly, never fold around it.
      if (seq !== state.seq + 1) throw new Error(`plan event ${seq} follows ${state.seq}`)
      const e = JSON.parse(await readFile(join(events, f), 'utf8')) as Event
      if (e.seq !== seq) throw new Error(`plan event file ${f} holds seq ${e.seq}`)
      if (e.kind === 'version') {
        state.versions.push(e.version)
        state.head = e.version.id
      } else if (e.kind === 'head') state.head = e.head
      else if (e.kind === 'name') state.names[e.id] = e.name
      else throw new Error(`plan event ${seq} has an unknown kind`)
      state.seq = seq
    }
    return state
  }

  async function append(state: State, event: Obj): Promise<void> {
    await mkdir(events, { recursive: true, mode: 0o700 })
    await mkdir(tmp, { recursive: true, mode: 0o700 })
    const seq = state.seq + 1
    const scratch = join(tmp, `${seq}-${randomBytes(6).toString('hex')}.json`)
    await writeFile(scratch, JSON.stringify({ seq, ...event }), { mode: 0o600, flush: true })
    try {
      await link(scratch, join(events, `${String(seq).padStart(8, '0')}.json`))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') refuse('another writer saved first', 409)
      throw error
    } finally {
      await unlink(scratch).catch(() => {})
    }
  }

  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  /** /people/<person>/plans[/<what>]; the caller has checked the token and the person. */
  return async function plans(person: string, what: string | undefined, req: IncomingMessage, res: ServerResponse) {
    try {
      if (what === undefined && req.method === 'GET') {
        const { versions, head, names } = await load()
        return send(res, 200, { versions, head, names })
      }
      if (what === undefined || req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const b = await readBody(req)
      return await serial(async () => {
        const state = await load()
        const at = new Date().toISOString()
        if (what === 'versions') {
          const v = only(only(b, 'body', ['version']).version, 'version', ['id', 'parent', 'edits', 'hash'], ['note', 'base'])
          if (typeof v.id !== 'string' || !VERSION_ID.test(v.id)) refuse('version.id is 16 lowercase hex characters')
          if (v.parent !== null && (typeof v.parent !== 'string' || !VERSION_ID.test(v.parent))) refuse('version.parent is a version id or null')
          if (typeof v.hash !== 'string' || !HASH.test(v.hash)) refuse('version.hash is a SHA-256 in hex')
          const edits = list(v.edits, 'version.edits', MAX_EDITS).map((e, i) => edit(e, `edits[${i}]`))
          // The root carries a base plan and no edits; every other version the reverse.
          if (v.parent === null ? v.base === undefined || edits.length : v.base !== undefined || !edits.length) refuse('the root carries base and no edits; every other version carries edits and no base')
          if (state.versions.some((k) => k.id === v.id)) refuse(`version ${v.id} exists`, 409)
          if (v.parent !== state.head) return send(res, 409, { error: 'the house plan moved on', head: state.head })
          const version: Version = {
            id: v.id as string, parent: v.parent as string | null, edits, at, by: person,
            ...(v.note === undefined ? {} : { note: text(v.note, 'version.note', MAX_NOTE) }),
            ...(v.base === undefined ? {} : { base: plan(v.base) }),
            hash: v.hash as string,
          }
          await append(state, { kind: 'version', version })
          return send(res, 200, { version })
        }
        if (what === 'head') {
          const h = only(b, 'body', ['head', 'expect'])
          if (typeof h.head !== 'string' || !state.versions.some((k) => k.id === h.head)) refuse('head is a stored version', 404)
          if (h.expect !== state.head) return send(res, 409, { error: 'the house plan moved on', head: state.head })
          await append(state, { kind: 'head', head: h.head, by: person, at })
          return send(res, 200, { head: h.head })
        }
        if (what === 'names') {
          const n = only(b, 'body', ['id', 'name'])
          if (typeof n.id !== 'string' || !state.versions.some((k) => k.id === n.id)) refuse('id is a stored version', 404)
          const name = text(n.name, 'name', MAX_NAME)
          await append(state, { kind: 'name', id: n.id, name, by: person, at })
          return send(res, 200, { id: n.id, name })
        }
        return send(res, 404, { error: 'not found' })
      })
    } catch (error) {
      if (error instanceof Refused) return send(res, error.status, error.status === 409 ? { error: error.message, head: (await load().catch(() => null))?.head ?? null } : { error: error.message })
      throw error
    }
  }
}
