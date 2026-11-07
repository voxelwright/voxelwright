// Versioned house plans (#48): pure data and a store interface, no three.js.
//
// A version carries the plan it produced (`plan`, the fact) and the edits that
// made it from its parent (`edits`, the description, for people and diff; empty on
// the root). Opening a history reads each version's plan and replays nothing, so a
// change to plan.ts never changes a saved house. A plan saved under an older
// PLAN_VERSION is brought forward by UPGRADES, keyed on plan.version. A version
// whose plan cannot be read (no upgrade step, or saved by a newer page) is listed
// but cannot be shown or checked out; only an unreadable head stops open().
//
// The head (which version the house is at) and version names live in the store.
// Every head move is a compare-and-set: a commit names its parent, which must be
// the store's head; undo, redo and checkout name the head they expect. A stale
// page gets StaleHead, nothing of its own is saved and nothing is merged; the
// history reloads from the store before it throws, so trying again builds on the
// new head. A version exists only once the store has accepted it; until then
// head, versions and plan stay as they were. Plans and versions handed out are
// frozen: they are history, not scratch space.
import { apply, curveOf, PLAN_VERSION, PlanError, pointAt, validate, type Edit, type Id, type Opening, type Plan, type Room, type Wall } from './plan'

export interface Version {
  id: string
  parent: string | null
  /** What changed from the parent, as asked; empty on the root. A description: the house is `plan`. */
  edits: Edit[]
  /** Set by the store: the host's clock. */
  at: string
  note?: string
  /** The house this version is. */
  plan: Plan
}

/** What a page sends; the store adds `at`. */
export type NewVersion = Omit<Version, 'at'>

export interface StoreState {
  /** In the order the store accepted them; a parent always comes before its children. */
  versions: Version[]
  head: string | null
  names: Record<string, string>
}

export interface PlanStore {
  load(): Promise<StoreState>
  /**
   * Adds the version and moves the head to it, only if the head is still `version.parent`.
   * Throws StaleHead otherwise. Sending a version the store already holds, same in every
   * field, answers the stored one (a retry after a lost answer); a different one with the
   * same id is a StoreError 409.
   */
  commit(version: NewVersion): Promise<Version>
  /** Moves the head to `head`, only if it is still `expect`. Throws StaleHead otherwise. */
  setHead(head: string, expect: string): Promise<void>
  rename(id: string, name: string): Promise<void>
}

/** The store's head is not the one this page built on. The history has reloaded; try again. */
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

/** The stored history is damaged, or a version's plan cannot be read by this page. */
export class HistoryError extends Error {
  readonly versionId: string
  readonly reasons: string[]
  constructor(versionId: string, reasons: string[]) {
    super(`version ${versionId}: ${reasons.join('; ')}`)
    this.versionId = versionId
    this.reasons = reasons
  }
}

/** A house shown read-only because its store could not be opened; the reason is the one line to show. */
export class ReadOnly extends PlanError {}

export const VERSION_ID = /^[a-f0-9]{16}$/
const NAME_MAX = 60

/** JSON with object keys sorted, so equal plans always give equal text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

// ---------------------------------------------------------------- upgrades

/** One step: a stored plan at version n in, the same house at a later version out. */
export type Upgrade = (plan: any) => unknown

/** UPGRADES[n] brings a version-n plan forward. Add a step whenever PLAN_VERSION goes up. */
export const UPGRADES: Readonly<Record<number, Upgrade>> = Object.freeze({})

/** A stored plan at this page's PLAN_VERSION, or an Error saying why it cannot be. */
export function upgrade(stored: unknown, steps: Readonly<Record<number, Upgrade>> = UPGRADES): Plan {
  let plan = stored as { version?: unknown } | null
  for (;;) {
    const v = plan?.version
    if (v === PLAN_VERSION) return plan as Plan
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error('the plan has no version')
    if (v > PLAN_VERSION) throw new Error(`the plan was saved by a newer home (plan version ${v}, this page knows ${PLAN_VERSION})`)
    const step = steps[v]
    if (!step) throw new Error(`no upgrade from plan version ${v}`)
    const next = step(plan) as { version?: unknown } | null
    if (!(typeof next?.version === 'number' && next.version > v)) throw new Error(`the upgrade from plan version ${v} did not move it forward`)
    plan = next
  }
}

// ---------------------------------------------------------------- stores

/** A store in memory, with the same compare-and-set and retry rules as the host. For checks and pages without a host. */
export function memoryStore(): PlanStore {
  const state: StoreState = { versions: [], head: null, names: {} }
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  return {
    async load() {
      return copy(state)
    },
    async commit(version) {
      const held = state.versions.find((v) => v.id === version.id)
      if (held) {
        const { at: _, ...rest } = held
        if (canonical(rest) === canonical(version)) return copy(held)
        throw new StoreError(409, `version ${version.id} exists`)
      }
      if (version.parent !== state.head) throw new StaleHead(state.head)
      const stored: Version = { ...copy(version), at: new Date().toISOString() }
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
 * The house's store on the host: `${base}/house/plans`, behind the per-launch
 * token. The host sets `at` to its clock. Nobody is named: the host does not yet
 * know who is at the page.
 */
export function hostStore(opts: { base: string; token: string; fetch?: typeof fetch }): PlanStore {
  const f = opts.fetch ?? fetch
  const root = `${opts.base.replace(/\/$/, '')}/house/plans`
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
    // Only a compare-and-set mismatch carries the head.
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
  readonly #upgrades: Readonly<Record<number, Upgrade>>
  #versions: Version[] = []
  #plans = new Map<string, Plan>()
  /** Versions whose plan this page cannot read, with why. */
  #unreadable = new Map<string, string>()
  #names: Record<string, string> = {}
  #head = ''
  #readOnly: { why: string; cause: unknown } | null = null
  /** Versions undo walked back from, nearest last. Session-level: any commit or checkout clears it. */
  #redo: string[] = []
  #listeners = new Set<Listener>()
  /** Operations run one at a time, so a commit always builds on the head the previous one left. */
  #queue: Promise<unknown> = Promise.resolve()

  private constructor(store: PlanStore, upgrades: Readonly<Record<number, Upgrade>>) {
    this.#store = store
    this.#upgrades = upgrades
  }

  /** Opens the house's history. The first open of an empty store saves `base` as the root; afterwards the stored root wins. */
  static async open(store: PlanStore, base: Plan, opts: { upgrades?: Readonly<Record<number, Upgrade>> } = {}): Promise<PlanHistory> {
    const history = new PlanHistory(store, opts.upgrades ?? UPGRADES)
    let state = await store.load()
    if (!state.versions.length) {
      const reasons = validate(base)
      if (reasons.length) throw new PlanError(reasons)
      let failed: unknown = null
      try {
        await store.commit({ id: newId(), parent: null, edits: [], plan: base })
      } catch (error) {
        failed = error
      }
      // Another page saved a root first, or ours was saved and the answer lost: use what the store holds.
      state = await store.load()
      if (!state.versions.length) throw failed ?? new StoreError(500, 'the store accepted the root but holds no versions')
    }
    history.#adopt(state)
    return history
  }

  /**
   * A house that shows `plan` and refuses every change with ReadOnly(why): for a page
   * whose store is there but could not be opened, so nothing looks saved that is not.
   */
  static readOnly(plan: Plan, why: string, cause?: unknown): PlanHistory {
    const refuse = async (): Promise<never> => {
      throw new ReadOnly([why])
    }
    const root: Version = { id: '0'.repeat(16), parent: null, edits: [], at: new Date().toISOString(), plan: structuredClone(plan) }
    const history = new PlanHistory({ load: async () => ({ versions: [root], head: root.id, names: {} }), commit: refuse, setHead: refuse, rename: refuse }, UPGRADES)
    history.#adopt({ versions: [root], head: root.id, names: {} })
    history.#readOnly = { why, cause }
    return history
  }

  /** Why the house cannot be changed on this page, as one line to show; null when it can. */
  get readOnly(): string | null {
    return this.#readOnly?.why ?? null
  }

  /** The error behind readOnly, for the Workshop and the console. */
  get failure(): unknown {
    return this.#readOnly?.cause
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

  /** The house at a version. Throws HistoryError for a version this page cannot read. */
  planAt(id: string): Plan {
    const why = this.#unreadable.get(id)
    if (why) throw new HistoryError(id, [why])
    const plan = this.#plans.get(id)
    if (!plan) throw new Error(`no version ${id}`)
    return plan
  }

  name(id: string): string | undefined {
    return Object.hasOwn(this.#names, id) ? this.#names[id] : undefined
  }

  /**
   * Applies the edits on top of the head and saves them, with the plan they give, as a
   * new version. Throws PlanError with reasons when an edit fails, the result is invalid
   * or nothing changed; ReadOnly on a read-only house; StaleHead when someone else moved
   * the house (after reloading it); the store's error when the save fails. In every
   * failure no version of this page's is added.
   */
  commit(edits: Edit[], note?: string): Promise<Version> {
    return this.#serial(async () => {
      this.#writable()
      if (!edits.length) throw new PlanError(['no edits'])
      let next = this.plan
      for (const edit of edits) next = apply(next, edit)
      const reasons = validate(next)
      if (reasons.length) throw new PlanError(reasons)
      // A drag that snapped back to where it started is not a version.
      if (canonical(next) === canonical(this.plan)) throw new PlanError(['nothing changed'])
      const trimmed = note?.trim()
      const sent: NewVersion = { id: newId(), parent: this.#head, edits: structuredClone(edits), ...(trimmed ? { note: trimmed } : {}), plan: next }
      const stored = await this.#store.commit(sent)
      if (stored.id !== sent.id || stored.parent !== sent.parent || canonical(stored.plan) !== canonical(next)) throw new StoreError(500, 'the store returned a different version than it was sent')
      deepFreeze(stored)
      this.#versions = [...this.#versions, stored]
      this.#plans.set(stored.id, stored.plan)
      this.#redo = []
      this.#move(stored.id)
      return stored
    })
  }

  /** Moves the head to its parent. False at the root. Nothing is deleted. */
  undo(): Promise<boolean> {
    return this.#serial(async () => {
      this.#writable()
      const parent = this.#version(this.#head).parent
      if (parent === null) return false
      this.planAt(parent)
      await this.#store.setHead(parent, this.#head)
      this.#redo.push(this.#head)
      this.#move(parent)
      return true
    })
  }

  /** Moves the head forward along the path undo walked back. False when there is nothing to redo. */
  redo(): Promise<boolean> {
    return this.#serial(async () => {
      this.#writable()
      const next = this.#redo.at(-1)
      if (next === undefined) return false
      await this.#store.setHead(next, this.#head)
      this.#redo.pop()
      this.#move(next)
      return true
    })
  }

  /** Moves the head to any readable version; the next commit branches from it. */
  checkout(id: string): Promise<void> {
    return this.#serial(async () => {
      this.#writable()
      this.#version(id)
      this.planAt(id)
      if (id === this.#head) return
      await this.#store.setHead(id, this.#head)
      this.#redo = []
      this.#move(id)
    })
  }

  rename(id: string, name: string): Promise<void> {
    return this.#serial(async () => {
      this.#writable()
      this.#version(id)
      const clean = name.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim()
      if (!clean || clean.length > NAME_MAX) throw new PlanError([`a name is 1 to ${NAME_MAX} characters`])
      await this.#store.rename(id, clean)
      this.#names = { ...this.#names, [id]: clean }
    })
  }

  /** Reloads from the store, adopting other pages' versions and head. Clears redo. Every StaleHead does this first. */
  refresh(): Promise<void> {
    return this.#serial(() => this.#reload())
  }

  /** Called with the plan and head after every head move. Returns an unsubscribe. */
  onChange(fn: Listener): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      try {
        return await fn()
      } catch (error) {
        // Someone else moved the house: take their head now, so the person's next try builds on it.
        if (error instanceof StaleHead) await this.#reload().catch((e) => console.warn('the house plan could not be reloaded', e))
        throw error
      }
    }
    const run = this.#queue.then(guarded, guarded)
    this.#queue = run.catch(() => {})
    return run
  }

  async #reload() {
    const before = this.#head
    this.#adopt(await this.#store.load())
    this.#redo = []
    if (this.#head !== before) this.#emit()
  }

  #writable() {
    if (this.#readOnly) throw new ReadOnly([this.#readOnly.why])
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

  /** Reads every version's plan (upgraded) and checks the history's shape. Changes nothing unless the head is readable. */
  #adopt(state: StoreState) {
    const plans = new Map<string, Plan>()
    const unreadable = new Map<string, string>()
    const seen = new Set<string>()
    let roots = 0
    const versions = state.versions.map((v) => {
      if (v.parent === null) roots++
      else if (!seen.has(v.parent)) throw new HistoryError(v.id, [`its parent ${v.parent} comes later or is missing`])
      seen.add(v.id)
      try {
        const plan = deepFreeze(upgrade(v.plan, this.#upgrades))
        plans.set(v.id, plan)
        return deepFreeze({ ...v, plan })
      } catch (error) {
        unreadable.set(v.id, (error as Error).message)
        return deepFreeze(v)
      }
    })
    if (roots !== 1) throw new HistoryError(state.versions[0]?.id ?? '', [`${roots} roots; a house has one`])
    if (state.head === null || !seen.has(state.head)) throw new HistoryError(state.head ?? '', ['the head is not a stored version'])
    const why = unreadable.get(state.head)
    if (why) throw new HistoryError(state.head, [why])
    this.#versions = versions
    this.#plans = plans
    this.#unreadable = unreadable
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
