// The house's plan versions (#48). The house is shared by the family, so there is
// one store, <root>/house/plans/, served at /house/plans behind a person's token.
// Every event records `by`, the person whose token wrote it (#40).
//
// The store is an append-only event log, one file per event:
//   events/<seq>.json   {seq, kind: 'version', version}  a version; the head moves to it
//                       {seq, kind: 'head', head, at, by}  undo, redo or checkout
//                       {seq, kind: 'name', id, name, at, by}
// A version is {id, parent, at, by, note?, plan}: `plan` is the stored house, and `note`
// says in a few words what changed. An event is written whole to tmp/
// and then hard-linked to its sequence number, which fails if that number exists. A
// write cut short leaves only a file in tmp/, never an event; two writers can never
// both take a number. Every head move is a compare-and-set against the head folded
// from the log: a version names its parent, a head move names the head it expects.
// A mismatch answers 409 with the current head; nothing is merged. Sending a version
// the store holds, same in every field, answers it again (a retry after a lost answer).
//
// The host checks the shape of everything, and that every library item a version
// places is kept, but never runs or interprets a plan: whether it is a valid house
// is plan.ts's call, on the page.
import { randomBytes } from 'node:crypto'
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const VERSION_ID = /^[a-f0-9]{16}$/
/** Plan ids: `kitchen.back-left`, `pantry.c1`. */
const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SEQ = /^(\d{8})\.json$/
const MAX_BODY = 256 * 1024
const MAX_ITEMS = 500
const MAX_NOTE = 200
const MAX_NAME = 60
const MAX_LABEL = 40
/** Events in the log: the whole log is read on every request, so it is bounded. */
const MAX_EVENTS = 5000
/** Metres; a house plan has no business beyond this. */
const MAX_METRES = 1000

export interface Version { id: string; parent: string | null; at: string; by: string; note?: string; plan: unknown }
type Event =
  | { seq: number; kind: 'version'; version: Version }
  | { seq: number; kind: 'head'; head: string; at: string; by: string }
  | { seq: number; kind: 'name'; id: string; name: string; at: string; by: string }
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
/** The head moved under the request: the one 409 that carries the head, so the page reloads. */
class Stale extends Error {}

// ── Shapes ──────────────────────────────────────────────────────────────────
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

/** A library item is 12 hex characters in one person's library; a kind is one the home builds itself. */
const LIBRARY_ITEM = /^[a-f0-9]{12}$/
/** villager.ts's person ids; a library ref's person is a path segment. */
const PERSON = /^[a-z][a-z0-9-]{0,31}$/
const KIND = /^[a-z][a-z0-9-]{0,31}$/
const ANGLE = 100

/** A placed thing (plan.ts Furniture): an id, what it is, and where (one anchor per mount). */
function furniture(v: unknown, at: string): Obj {
  const f = only(v, at, ['id', 'item', 'at'])
  const item = isObj(f.item) && 'library' in f.item ? only(f.item, `${at}.item`, ['library', 'person']) : only(f.item, `${at}.item`, ['kind'])
  return {
    id: id(f.id, `${at}.id`),
    item: item.library !== undefined
      ? {
          library: typeof item.library === 'string' && LIBRARY_ITEM.test(item.library) ? item.library : refuse(`${at}.item.library is 12 hex characters`),
          person: typeof item.person === 'string' && PERSON.test(item.person) ? item.person : refuse(`${at}.item.person is a person id`),
        }
      : { kind: typeof item.kind === 'string' && KIND.test(item.kind) ? item.kind : refuse(`${at}.item.kind is a lowercase word`) },
    at: anchor(f.at, `${at}.at`),
  }
}

function anchor(v: unknown, at: string): Obj {
  if (!isObj(v)) return refuse(`${at} is an object`)
  switch (v.mount) {
    case 'floor':
    case 'ceiling': {
      const a = only(v, at, ['mount', 'x', 'z', 'yaw'])
      return { mount: a.mount, x: num(a.x, `${at}.x`), z: num(a.z, `${at}.z`), yaw: num(a.yaw, `${at}.yaw`, ANGLE) }
    }
    case 'surface': {
      // `on`: the placed thing it stands on, when the top is one.
      const a = only(v, at, ['mount', 'x', 'y', 'z', 'yaw'], ['on'])
      return {
        mount: a.mount, x: num(a.x, `${at}.x`), y: num(a.y, `${at}.y`, 50), z: num(a.z, `${at}.z`), yaw: num(a.yaw, `${at}.yaw`, ANGLE),
        ...(a.on === undefined ? {} : { on: id(a.on, `${at}.on`) }),
      }
    }
    case 'wall': {
      const a = only(v, at, ['mount', 'wallId', 'roomId', 'along', 'height', 'spin'])
      return {
        mount: a.mount, wallId: id(a.wallId, `${at}.wallId`), roomId: id(a.roomId, `${at}.roomId`),
        along: num(a.along, `${at}.along`), height: num(a.height, `${at}.height`, 50), spin: num(a.spin, `${at}.spin`, ANGLE),
      }
    }
    default:
      return refuse(`${at}.mount is one of floor, surface, wall, ceiling`)
  }
}

/** A whole plan (every version's), rebuilt from its known fields. Whether it is a valid house is plan.ts's call, on the page. */
function plan(v: unknown): Obj {
  const p = only(v, 'plan', ['schema', 'corners', 'walls', 'rooms', 'furniture'])
  if (!Number.isInteger(p.schema) || (p.schema as number) < 1 || (p.schema as number) > 1000) refuse('plan.schema is a positive integer')
  return {
    schema: p.schema,
    corners: list(p.corners, 'plan.corners').map((c, i) => {
      const o = only(c, `plan.corners[${i}]`, ['id', 'x', 'z'])
      return { id: id(o.id, 'corner id'), x: num(o.x, 'corner x'), z: num(o.z, 'corner z') }
    }),
    walls: list(p.walls, 'plan.walls').map((w, i) => {
      const o = only(w, `plan.walls[${i}]`, ['id', 'a', 'b', 'thickness', 'height', 'sagitta', 'openings'])
      return {
        id: id(o.id, 'wall id'), a: id(o.a, 'wall a'), b: id(o.b, 'wall b'),
        thickness: num(o.thickness, 'thickness', 5), height: num(o.height, 'height', 50), sagitta: num(o.sagitta, 'sagitta'),
        openings: list(o.openings, 'openings', 50).map((x, j) => {
          const k = only(x, `plan.walls[${i}].openings[${j}]`, ['id', 'kind', 'from', 'to', 'sill', 'head'], ['leaves'])
          if (k.kind !== 'door' && k.kind !== 'window') refuse('an opening is a door or a window')
          if (k.leaves !== undefined && k.leaves !== 1 && k.leaves !== 2) refuse('leaves is 1 or 2')
          return { id: id(k.id, 'opening id'), kind: k.kind, from: num(k.from, 'from'), to: num(k.to, 'to'), sill: num(k.sill, 'sill', 50), head: num(k.head, 'head', 50), ...(k.leaves === undefined ? {} : { leaves: k.leaves }) }
        }),
      }
    }),
    rooms: list(p.rooms, 'plan.rooms').map((r, i) => {
      const o = only(r, `plan.rooms[${i}]`, ['id', 'label', 'loop'])
      return { id: id(o.id, 'room id'), label: text(o.label, 'room label', MAX_LABEL), loop: list(o.loop, 'loop', 200).map((c) => id(c, 'loop corner')) }
    }),
    furniture: list(p.furniture, 'plan.furniture').map((f, i) => furniture(f, `plan.furniture[${i}]`)),
  }
}

// ── Store ───────────────────────────────────────────────────────────────────
async function readBody(req: IncomingMessage): Promise<unknown> {
  // Bytes, not characters: a chunk may end inside a multi-byte character, so decode once at the end.
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) refuse(`a request is at most ${MAX_BODY} bytes`, 413)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return refuse('expected JSON')
  }
}

/** `kept(person, item)`: whether that listed person's library holds the item, kept. The villager service owns the library. */
export function planStore(root: string, kept: (person: string, item: string) => Promise<boolean>) {
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

  // Events are immutable once linked, so each request folds only the ones past the last it read.
  const fileOf = (seq: number) => `${String(seq).padStart(8, '0')}.json`
  let folded: State = { versions: [], head: null, names: {}, seq: 0 }
  async function load(): Promise<State> {
    const files = (await readdir(events).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)))).filter((f) => SEQ.test(f)).sort()
    // Events already folded must all still be there; a loss is a damaged store.
    for (let i = 0; i < folded.seq; i++) if (files[i] !== fileOf(i + 1)) throw new Error(`plan event ${i + 1} is missing`)
    const state: State = { versions: [...folded.versions], head: folded.head, names: { ...folded.names }, seq: folded.seq }
    for (const f of files.slice(folded.seq)) {
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
    folded = state
    return state
  }

  async function append(state: State, event: Obj): Promise<void> {
    await mkdir(events, { recursive: true, mode: 0o700 })
    await mkdir(tmp, { recursive: true, mode: 0o700 })
    const seq = state.seq + 1
    if (seq > MAX_EVENTS) refuse(`the house keeps at most ${MAX_EVENTS} changes`, 507)
    const scratch = join(tmp, `${seq}-${randomBytes(6).toString('hex')}.json`)
    await writeFile(scratch, JSON.stringify({ seq, ...event }), { mode: 0o600, flush: true })
    try {
      await link(scratch, join(events, fileOf(seq)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Stale('another writer saved first')
      throw error
    } finally {
      await unlink(scratch).catch(() => {})
    }
  }

  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  /**
   * Refuses 409 unless every library item the plan names is in that person's library and kept, and 403 when the
   * plan newly names someone else's: a person's library is their own (#40), so a version may add only the caller's
   * items. Items already in the parent version stay, whoever placed them.
   */
  async function checkKept(house: Obj, caller: string, parent: Obj | null) {
    const refs = (p: Obj | null) => {
      const out = new Map<string, { library: string; person: string }>()
      for (const f of (p?.furniture as unknown[] | undefined) ?? []) {
        const item = (f as Obj).item as Obj
        if (typeof item.library === 'string') out.set(`${item.person}/${item.library}`, item as { library: string; person: string })
      }
      return out
    }
    const before = refs(parent)
    for (const [key, { library, person }] of refs(house)) {
      if (!before.has(key) && person !== caller) refuse(`library item ${library} is ${person}'s, not yours to place`, 403)
      if (!(await kept(person, library))) refuse(`library item ${library} is not one ${person} has kept`, 409)
    }
  }

  /** /house/plans[/<what>]; the service has checked the token and passes whose it is. */
  return async function plans(what: 'versions' | 'head' | 'names' | undefined, req: IncomingMessage, res: ServerResponse, caller: string) {
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
          const v = only(only(b, 'body', ['version']).version, 'version', ['id', 'parent', 'plan'], ['note'])
          if (typeof v.id !== 'string' || !VERSION_ID.test(v.id)) refuse('version.id is 16 lowercase hex characters')
          if (v.parent !== null && (typeof v.parent !== 'string' || !VERSION_ID.test(v.parent))) refuse('version.parent is a version id or null')
          const house = plan(v.plan)
          const note = v.note === undefined ? undefined : text(v.note, 'version.note', MAX_NOTE)
          const sent = { id: v.id as string, parent: v.parent as string | null, ...(note === undefined ? {} : { note }), plan: house }
          const held = state.versions.find((k) => k.id === v.id)
          if (held) {
            // A retry of a version already saved (its answer was lost) gets the same answer; anything else with its id is refused.
            const { at: _, by: __, ...rest } = held
            if (isDeepStrictEqual(rest, sent)) return send(res, 200, { version: held })
            refuse(`version ${v.id} exists`, 409)
          }
          if (v.parent !== state.head) throw new Stale('the house plan moved on')
          await checkKept(house, caller, (state.versions.find((k) => k.id === state.head)?.plan as Obj | undefined) ?? null)
          const version: Version = { ...sent, at, by: caller }
          await append(state, { kind: 'version', version })
          return send(res, 200, { version })
        }
        if (what === 'head') {
          const h = only(b, 'body', ['head', 'expect'])
          if (typeof h.head !== 'string' || !state.versions.some((k) => k.id === h.head)) refuse('head is a stored version', 404)
          if (h.expect !== state.head) throw new Stale('the house plan moved on')
          await append(state, { kind: 'head', head: h.head, at, by: caller })
          return send(res, 200, { head: h.head })
        }
        const n = only(b, 'body', ['id', 'name'])
        if (typeof n.id !== 'string' || !state.versions.some((k) => k.id === n.id)) refuse('id is a stored version', 404)
        const name = text(n.name, 'name', MAX_NAME)
        await append(state, { kind: 'name', id: n.id, name, at, by: caller })
        return send(res, 200, { id: n.id, name })
      })
    } catch (error) {
      if (error instanceof Stale) return send(res, 409, { error: error.message, head: (await load().catch(() => null))?.head ?? null })
      if (error instanceof Refused) return send(res, error.status, { error: error.message })
      throw error
    }
  }
}
