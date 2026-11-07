// Versioned house plans (#48): pure data and a store interface, no three.js.
//
// One home per fact. A version records the edits a person made on top of its
// parent; the plan at a version is derived by replaying edits from the root,
// which alone carries a whole plan (`base`). Each version also carries `hash`,
// the SHA-256 of the plan it produced when it was saved. The hash is a check,
// not a second copy: if plan.ts changes so that replay gives a different house,
// open() refuses with a HistoryError naming the first version that drifted,
// instead of quietly showing a different house.
//
// The head (which version the house is at) and version names live in the store.
// Every head move is a compare-and-set: a commit names its parent, which must be
// the store's head; undo, redo and checkout name the head they expect. A stale
// page gets StaleHead and nothing changes; nothing is merged. A version exists
// only once the store has accepted it; until then head, versions and plan stay
// as they were.
import { apply, curveOf, PlanError, pointAt, validate, type Edit, type Id, type Opening, type Plan, type Room, type Wall } from './plan'

export interface Version {
  id: string
  parent: string | null
  /** Empty on the root, which carries `base` instead. */
  edits: Edit[]
  /** Set by the store: the host's clock and the person the request came from. */
  at: string
  by: string
  note?: string
  /** Only on the root: the plan the history starts from. */
  base?: Plan
  /** SHA-256 hex of the canonical JSON of the plan this version produced. */
  hash: string
}

/** What a page sends; the store adds `at` and `by`. */
export type NewVersion = Omit<Version, 'at' | 'by'>

export interface StoreState {
  /** In the order the store accepted them; a parent always comes before its children. */
  versions: Version[]
  head: string | null
  names: Record<string, string>
}

export interface PlanStore {
  load(): Promise<StoreState>
  /** Adds the version and moves the head to it, only if the head is still `version.parent`. Throws StaleHead otherwise. */
  commit(version: NewVersion): Promise<Version>
  /** Moves the head to `head`, only if it is still `expect`. Throws StaleHead otherwise. */
  setHead(head: string, expect: string): Promise<void>
  rename(id: string, name: string): Promise<void>
}

/** The store's head is not the one this page built on. Reload (refresh()) and try again. */
export class StaleHead extends Error {
  readonly head: string | null
  constructor(head: string | null) {
    super(`the house plan moved on (head is now ${head}); reload before changing it`)
    this.head = head
  }
}

/** The store refused or could not be reached. */
export class StoreError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** A stored version no longer replays to the plan it saved, or does not replay at all. */
export class HistoryError extends Error {
  readonly versionId: string
  readonly reasons: string[]
  /** The plan replay gives today, when it gives one; never shown as the house without a decision. */
  readonly replayed?: Plan
  constructor(versionId: string, reasons: string[], replayed?: Plan) {
    super(`version ${versionId}: ${reasons.join('; ')}`)
    this.versionId = versionId
    this.reasons = reasons
    this.replayed = replayed
  }
}

export const VERSION_ID = /^[a-f0-9]{16}$/
const NAME_MAX = 60

// ---------------------------------------------------------------- hashing

/** JSON with object keys sorted, so equal plans always give equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function planHash(plan: Plan): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(plan)))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')

// ---------------------------------------------------------------- stores

/** A store in memory, with the same compare-and-set rules as the host. For checks and pages without a host. */
export function memoryStore(opts: { by?: string } = {}): PlanStore {
  const state: StoreState = { versions: [], head: null, names: {} }
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  return {
    async load() {
      return copy(state)
    },
    async commit(version) {
      if (version.parent !== state.head) throw new StaleHead(state.head)
      if (state.versions.some((v) => v.id === version.id)) throw new StoreError(409, `version ${version.id} exists`)
      const stored: Version = { ...copy(version), at: new Date().toISOString(), by: opts.by ?? 'local' }
      state.versions.push(stored)
      state.head = stored.id
      return copy(stored)
    },
    async setHead(head, expect) {
      if (expect !== state.head) throw new StaleHead(state.head)
      if (!state.versions.some((v) => v.id === head)) throw new StoreError(404, `no version ${head}`)
      state.head = head
    },
    async rename(id, name) {
      if (!state.versions.some((v) => v.id === id)) throw new StoreError(404, `no version ${id}`)
      state.names[id] = name
    },
  }
}

/**
 * The house's store on the host: `${base}/people/${person}/plans`, behind the
 * per-launch token. The host sets `by` to the person and `at` to its clock.
 */
export function hostStore(opts: { base: string; person: string; token: string; fetch?: typeof fetch }): PlanStore {
  const f = opts.fetch ?? fetch
  const root = `${opts.base.replace(/\/$/, '')}/people/${encodeURIComponent(opts.person)}/plans`
  async function call(path: string, body?: unknown): Promise<any> {
    let res: Response
    try {
      res = await f(root + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${opts.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      throw new StoreError(0, `the host could not be reached: ${(error as Error).message}`)
    }
    const json = await res.json().catch(() => null)
    if (res.status === 409 && json && 'head' in json) throw new StaleHead(json.head)
    if (!res.ok) throw new StoreError(res.status, json?.error ?? `the host answered ${res.status}`)
    return json
  }
  return {
    load: () => call(''),
    commit: async (version) => (await call('/versions', { version })).version,
    setHead: async (head, expect) => void (await call('/head', { head, expect })),
    rename: async (id, name) => void (await call('/names', { id, name })),
  }
}

// ---------------------------------------------------------------- history

type Listener = (plan: Plan, head: string) => void

export class PlanHistory {
  readonly #store: PlanStore
  #versions: Version[] = []
  #plans = new Map<string, Plan>()
  #names: Record<string, string> = {}
  #head = ''
  /** Versions undo walked back from, nearest last. Session-level: any commit or checkout clears it. */
  #redo: string[] = []
  #listeners = new Set<Listener>()
  /** Operations run one at a time, so a commit always builds on the head the previous one left. */
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(store: PlanStore) {
    this.#store = store
  }

  /** Opens the house's history. The first open of an empty store saves `base` as the root; afterwards the stored root wins. */
  static async open(store: PlanStore, base: Plan): Promise<PlanHistory> {
    const history = new PlanHistory(store)
    let state = await store.load()
    if (!state.versions.length) {
      const reasons = validate(base)
      if (reasons.length) throw new PlanError(reasons)
      let failed: unknown = null
      try {
        await store.commit({ id: newId(), parent: null, edits: [], base, hash: await planHash(base) })
      } catch (error) {
        failed = error
      }
      // Another page saved a root first, or ours was saved and the answer lost: use what the store holds.
      state = await store.load()
      if (!state.versions.length) throw failed ?? new StoreError(500, 'the store accepted the root but holds no versions')
    }
    await history.#adopt(state)
    return history
  }

  get plan(): Plan {
    return this.#plans.get(this.#head)!
  }

  get head(): string {
    return this.#head
  }

  versions(): Version[] {
    return [...this.#versions]
  }

  planAt(id: string): Plan {
    const plan = this.#plans.get(id)
    if (!plan) throw new Error(`no version ${id}`)
    return plan
  }

  name(id: string): string | undefined {
    return Object.hasOwn(this.#names, id) ? this.#names[id] : undefined
  }

  /**
   * Applies the edits on top of the head and saves them as a new version. Throws
   * PlanError with reasons when an edit fails, the result is invalid or nothing
   * changed; StaleHead when someone else moved the house; the store's error when
   * the save fails. In every failure the history is unchanged.
   */
  commit(edits: Edit[], note?: string): Promise<Version> {
    return this.#serial(async () => {
      if (!edits.length) throw new PlanError(['no edits'])
      let next = this.plan
      for (const edit of edits) next = apply(next, edit)
      const reasons = validate(next)
      if (reasons.length) throw new PlanError(reasons)
      const hash = await planHash(next)
      const head = this.#version(this.#head)
      // A drag that snapped back to where it started is not a version.
      if (hash === head.hash) throw new PlanError(['nothing changed'])
      const trimmed = note?.trim()
      const sent: NewVersion = { id: newId(), parent: head.id, edits: structuredClone(edits), ...(trimmed ? { note: trimmed } : {}), hash }
      const stored = await this.#store.commit(sent)
      if (stored.id !== sent.id || stored.parent !== sent.parent || stored.hash !== hash) throw new StoreError(500, 'the store returned a different version than it was sent')
      this.#versions.push(stored)
      this.#plans.set(stored.id, next)
      this.#redo = []
      this.#move(stored.id)
      return stored
    })
  }

  /** Moves the head to its parent. False at the root. Nothing is deleted. */
  undo(): Promise<boolean> {
    return this.#serial(async () => {
      const parent = this.#version(this.#head).parent
      if (parent === null) return false
      await this.#store.setHead(parent, this.#head)
      this.#redo.push(this.#head)
      this.#move(parent)
      return true
    })
  }

  /** Moves the head forward along the path undo walked back. False when there is nothing to redo. */
  redo(): Promise<boolean> {
    return this.#serial(async () => {
      const next = this.#redo.at(-1)
      if (next === undefined) return false
      await this.#store.setHead(next, this.#head)
      this.#redo.pop()
      this.#move(next)
      return true
    })
  }

  /** Moves the head to any version; the next commit branches from it. */
  checkout(id: string): Promise<void> {
    return this.#serial(async () => {
      this.#version(id)
      if (id === this.#head) return
      await this.#store.setHead(id, this.#head)
      this.#redo = []
      this.#move(id)
    })
  }

  rename(id: string, name: string): Promise<void> {
    return this.#serial(async () => {
      this.#version(id)
      const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim()
      if (!clean || clean.length > NAME_MAX) throw new PlanError([`a name is 1 to ${NAME_MAX} characters`])
      await this.#store.rename(id, clean)
      this.#names = { ...this.#names, [id]: clean }
    })
  }

  /** Reloads from the store, adopting other pages' versions and head (after a StaleHead). Clears redo. */
  refresh(): Promise<void> {
    return this.#serial(async () => {
      const before = this.#head
      await this.#adopt(await this.#store.load())
      this.#redo = []
      if (this.#head !== before) this.#emit()
    })
  }

  /** Called with the plan and head after every head move. Returns an unsubscribe. */
  onChange(fn: Listener): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn)
    this.#queue = run.catch(() => {})
    return run
  }

  #version(id: string): Version {
    const v = this.#versions.find((k) => k.id === id)
    if (!v) throw new Error(`no version ${id}`)
    return v
  }

  #move(head: string) {
    this.#head = head
    this.#emit()
  }

  #emit() {
    for (const fn of this.#listeners) fn(this.plan, this.#head)
  }

  /** Replays every version from the root and checks each against its saved hash. Changes nothing unless all of it holds. */
  async #adopt(state: StoreState) {
    const plans = new Map<string, Plan>()
    let roots = 0
    for (const v of state.versions) {
      let plan: Plan
      if (v.parent === null) {
        roots++
        if (!v.base) throw new HistoryError(v.id, ['the root carries no base plan'])
        plan = v.base
      } else {
        const parent = plans.get(v.parent)
        if (!parent) throw new HistoryError(v.id, [`its parent ${v.parent} comes later or is missing`])
        plan = parent
        try {
          for (const edit of v.edits) plan = apply(plan, edit)
        } catch (error) {
          throw new HistoryError(v.id, error instanceof PlanError ? error.reasons : [String(error)])
        }
      }
      const reasons = validate(plan)
      if (reasons.length) throw new HistoryError(v.id, reasons, plan)
      if ((await planHash(plan)) !== v.hash) throw new HistoryError(v.id, ['replays to a different plan than was saved (plan code changed?)'], plan)
      plans.set(v.id, plan)
    }
    if (roots !== 1) throw new HistoryError(state.versions[0]?.id ?? '', [`${roots} roots; a house has one`])
    if (state.head === null || !plans.has(state.head)) throw new HistoryError(state.head ?? '', ['the head is not a stored version'])
    this.#versions = state.versions
    this.#plans = plans
    this.#names = { ...state.names }
    this.#head = state.head
  }
}

// ---------------------------------------------------------------- diff

export interface IdDiff {
  added: Id[]
  removed: Id[]
  changed: Id[]
}

export interface PlanDiff {
  corners: IdDiff
  /** A wall changed when its own fields (not its openings) or either corner's position changed. */
  walls: IdDiff
  /** An opening changed when its fields, its wall or its place in the room changed. */
  openings: IdDiff
  /** A room changed when its label, loop or any of its corners' positions changed. */
  rooms: IdDiff
  furniture: IdDiff
}

/** Items by id; changed means the key differs. Keys are computed against each side's own plan. */
function byId<T extends { id: Id }>(a: T[], b: T[], ka: (item: T) => string, kb: (item: T) => string = ka): IdDiff {
  const before = new Map(a.map((x) => [x.id, ka(x)]))
  const after = new Map(b.map((x) => [x.id, kb(x)]))
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id)),
  }
}

export function diff(a: Plan, b: Plan): PlanDiff {
  const positions = (plan: Plan) => {
    const pos = new Map(plan.corners.map((c) => [c.id, [c.x, c.z]]))
    return (id: Id) => pos.get(id) ?? null
  }
  const pa = positions(a), pb = positions(b)
  const wallKey = (pos: (id: Id) => unknown) => ({ openings: _, ...w }: Wall) => canonical({ ...w, at: [pos(w.a), pos(w.b)] })
  const roomKey = (pos: (id: Id) => unknown) => (r: Room) => canonical({ ...r, at: r.loop.map(pos) })
  const walls = byId(a.walls, b.walls, wallKey(pa), wallKey(pb))
  // An opening changed when its fields, its wall or where it stands in the room changed.
  const openingKey = (plan: Plan) => {
    const round = (p: number[]) => p.map((v) => Math.round(v * 1e6) / 1e6)
    return (o: Opening & { wall: Wall }) => {
      const c = curveOf(plan, o.wall)
      const { wall, ...rest } = o
      return canonical({ ...rest, wall: wall.id, at: [round(pointAt(c, o.from)), round(pointAt(c, o.to))] })
    }
  }
  const openingsOf = (plan: Plan) => plan.walls.flatMap((w) => w.openings.map((o) => ({ ...o, wall: w })))
  const openings = byId(openingsOf(a), openingsOf(b), openingKey(a), openingKey(b))
  return {
    corners: byId(a.corners, b.corners, canonical),
    walls,
    openings,
    rooms: byId(a.rooms, b.rooms, roomKey(pa), roomKey(pb)),
    furniture: byId(a.furniture, b.furniture, canonical),
  }
}
