// Versioned house plans (#48): pure data and a store interface, no three.js.
//
// A version stores the plan it produced (`plan`) and a short note of what changed;
// the edits that made it are applied and checked here, then not kept (the plan is
// the one record, and diff() compares plans). Opening a history reads each version's plan
// and replays nothing. validate() is a contract on stored plans: a change that refuses a
// plan the previous rules accepted bumps PLAN_SCHEMA and adds an UPGRADES step that brings
// older plans within it. A version whose plan cannot be read (no upgrade step, saved by a
// newer page, or invalid) is listed but cannot be shown or checked out; while the head is
// one, the house shows its nearest readable ancestor, refuses commits, and only undo or
// checkout moves it.
//
// The head (which version the house is at) and version names live in the store.
// Every head move is a compare-and-set: a commit names its parent, which must be
// the store's head; undo, redo and checkout name the head they expect. A stale
// page gets StaleHead, nothing of its own is saved and nothing is merged; the
// history reloads from the store before it throws, so trying again builds on the
// new head. A version exists only once the store has accepted it; until then
// head, versions and plan stay as they were. Plans and versions handed out are
// frozen: they are history, not scratch space.
import { apply, curveOf, PLAN_SCHEMA, PlanError, pointAt, round, validate, type Edit, type Id, type Opening, type Plan, type Room, type Wall } from './plan'

export interface Version {
  id: string
  parent: string | null
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

const NAME_MAX = 60
const NOTE_MAX = 200
/** Plain text as the host stores it (host/src/plans.ts text()): no control or format characters. */
const plain = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()

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

// ── Upgrades ────────────────────────────────────────────────────────────────
/** One step: a stored plan at schema n in, the same house at a later schema out. */
export type Upgrade = (plan: unknown) => unknown

// Schema 2's living room and doorway as schema 2 first defined them (HOUSE_PLAN on
// 2026-11-07). Frozen here, not read from HOUSE_PLAN: upgrades run on every load and
// are never saved, so a later change to layout.ts must not move every old version's
// living room or doorway. check-plan-history proves today's HOUSE_PLAN equals them.
const DOOR_LIVING: Opening = { id: 'kitchen.door-living', kind: 'door', from: 4.74, to: 5.44, sill: 0, head: 2.08, leaves: 1 }
/** The doorway's world z where it starts on the shared wall, which runs back (corner a) to front. */
const DOOR_LIVING_Z = 2.45
const LIVING_CORNERS = [
  { id: 'living.back-right', x: 8.47, z: -2.29 },
  { id: 'living.front-right', x: 8.47, z: 3.89 },
]
const livingWall = (id: Id, a: Id, b: Id, openings: Opening[] = []): Wall => ({ id, a, b, thickness: 0.18, height: 3, sagitta: 0, openings })
const LIVING_WALLS: Wall[] = [
  livingWall('living.back', 'kitchen.back-right', 'living.back-right'),
  livingWall('living.right', 'living.back-right', 'living.front-right', [
    { id: 'living.door-workshop', kind: 'door', from: 1.43, to: 2.25, sill: 0, head: 2.05, leaves: 1 },
  ]),
  livingWall('living.front', 'living.front-right', 'kitchen.front-right'),
]
const LIVING: Room = { id: 'living', label: 'Living room', loop: ['kitchen.back-right', 'living.back-right', 'living.front-right', 'kitchen.front-right'] }
/** How far a thing hung on the shared wall stays from the doorway's sides, and above its head. */
const DOOR_CLEAR = 0.5

/**
 * A room the person made that the living room would collide with (one called "Living
 * room", or with the id `living` that the home's living room needs) keeps its shape
 * and things under a fresh id and name: `living-2`, "Living room 2" and so on.
 */
function makeWayForLiving(plan: Plan): Plan {
  const ids = [...plan.corners.map((c) => c.id), ...plan.walls.map((w) => w.id), ...plan.walls.flatMap((w) => w.openings.map((o) => o.id)), ...plan.rooms.map((r) => r.id), ...plan.furniture.map((f) => f.id)]
  const free = (n: number, taken: (s: string) => boolean, make: (n: number) => string): string => (taken(make(n)) ? free(n + 1, taken, make) : make(n))
  let next = plan
  if (plan.rooms.some((r) => r.id === LIVING.id)) {
    const old = LIVING.id
    const fresh = free(2, (s) => ids.some((id) => id === s || id.startsWith(`${s}.`)), (n) => `${old}-${n}`)
    const ren = (s: Id) => (s === old ? fresh : s.startsWith(`${old}.`) ? fresh + s.slice(old.length) : s)
    next = {
      ...next,
      corners: next.corners.map((c) => ({ ...c, id: ren(c.id) })),
      walls: next.walls.map((w) => ({ ...w, id: ren(w.id), a: ren(w.a), b: ren(w.b), openings: w.openings.map((o) => ({ ...o, id: ren(o.id) })) })),
      rooms: next.rooms.map((r) => ({ ...r, id: ren(r.id), loop: r.loop.map(ren) })),
      furniture: next.furniture.map((f) => {
        const at = f.at.mount === 'wall' ? { ...f.at, wallId: ren(f.at.wallId), roomId: ren(f.at.roomId) } : f.at.mount === 'surface' && f.at.on !== undefined ? { ...f.at, on: ren(f.at.on) } : f.at
        return { ...f, id: ren(f.id), at }
      }),
    }
  }
  const key = LIVING.label.toLowerCase()
  if (next.rooms.some((r) => r.label.toLowerCase() === key)) {
    const label = free(2, (s) => next.rooms.some((r) => r.label.toLowerCase() === s.toLowerCase()), (n) => `${LIVING.label} ${n}`)
    next = { ...next, rooms: next.rooms.map((r) => (r.label.toLowerCase() === key ? { ...r, label } : r)) }
  }
  return next
}

/**
 * Schema 1 was the kitchen alone, its doorway in the back wall to a living room kept
 * elsewhere. Schema 2 is the whole house: the living room stands beside the kitchen,
 * and the doorway is in the wall they share, the kitchen's right wall. The step keeps
 * the kitchen as it was shaped (moved or bent walls, added rooms, things placed),
 * moves the doorway onto that wall at the height of the house it stood at (shifted
 * along to fit when the wall got shorter), moves anything hung where the doorway now
 * is to just beside it, and builds the living room against the wall. When the
 * kitchen's right side no longer allows that (a room added on it, or one where the
 * living room stands) it says why, and that version cannot be shown.
 */
function houseFromKitchen(stored: unknown): unknown {
  const plan = makeWayForLiving(structuredClone(stored) as Plan)
  const shared = plan.walls.find((w) => w.id === 'kitchen.right')
  if (!shared || shared.a !== 'kitchen.back-right' || shared.b !== 'kitchen.front-right') {
    throw new Error("a room was added on the kitchen's right wall, where the living room now stands")
  }
  const corners = plan.corners.map((c) => ({ ...c, x: round(c.x), z: round(c.z) }))
  const A = corners.find((c) => c.id === shared.a)!
  const length = curveOf({ ...plan, corners }, shared).length
  const width = round(DOOR_LIVING.to - DOOR_LIVING.from)
  const from = round(Math.min(Math.max(DOOR_LIVING_Z - A.z, 0.3), length - 0.3 - width))
  const door: Opening = { ...DOOR_LIVING, from, to: round(from + width) }
  const furniture = plan.furniture.map((f) => {
    const { at } = f
    if (at.mount !== 'wall' || at.wallId !== shared.id || at.height >= door.head + DOOR_CLEAR) return f
    const [before, after] = [door.from - DOOR_CLEAR, door.to + DOOR_CLEAR]
    if (!(at.along > before && at.along < after)) return f
    const fits = (v: number) => v >= 0 && v <= length
    const sides = (at.along - before <= after - at.along ? [before, after] : [after, before]).filter(fits)
    return sides.length ? { ...f, at: { ...at, along: round(sides[0]) } } : f
  })
  const next: Plan = {
    ...plan,
    schema: PLAN_SCHEMA,
    corners: [...corners, ...LIVING_CORNERS],
    walls: [
      ...plan.walls.map((w) => {
        const openings = w.openings.filter((o) => o.id !== door.id).map((o) => ({ ...o, from: round(o.from), to: round(o.to) }))
        return w.id === shared.id ? { ...w, openings: [...openings, door].sort((p, q) => p.from - q.from) } : { ...w, openings }
      }),
      ...LIVING_WALLS,
    ],
    rooms: [...plan.rooms, LIVING],
    furniture,
  }
  const reasons = validate(next)
  if (reasons.length) throw new Error(`the kitchen-only plan cannot become the whole house: ${reasons.join('; ')}`)
  return structuredClone(next)
}

/** UPGRADES[n] brings a schema-n plan forward. Add a step whenever PLAN_SCHEMA goes up, and bump it whenever validate() starts refusing plans it accepted. */
export const UPGRADES: Readonly<Record<number, Upgrade>> = Object.freeze({ 1: houseFromKitchen })

/** A stored plan at this page's PLAN_SCHEMA, or an Error saying why it cannot be. */
export function upgrade(stored: unknown, steps: Readonly<Record<number, Upgrade>> = UPGRADES): Plan {
  let plan = stored as { schema?: unknown } | null
  for (;;) {
    const v = plan?.schema
    if (v === PLAN_SCHEMA) return plan as Plan
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error('the plan has no schema')
    if (v > PLAN_SCHEMA) throw new Error(`the plan was saved by a newer home (plan schema ${v}, this page knows ${PLAN_SCHEMA})`)
    const step = steps[v]
    if (!step) throw new Error(`no upgrade from plan schema ${v}`)
    const next = step(plan) as { schema?: unknown } | null
    if (!(typeof next?.schema === 'number' && next.schema > v)) throw new Error(`the upgrade from plan schema ${v} did not move it forward`)
    plan = next
  }
}

// ── Stores ──────────────────────────────────────────────────────────────────
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
export function hostStore(opts: { base: string; token: string; refresh?: () => Promise<string | null> }): PlanStore {
  let token = opts.token
  const root = `${opts.base.replace(/\/$/, '')}/house/plans`
  const send = async (path: string, body?: unknown): Promise<Response> => {
    try {
      return await fetch(root + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new StoreError(0, `the host could not be reached: ${(error as Error).message}`)
    }
  }
  async function call<T>(path: string, body?: unknown): Promise<T> {
    let res = await send(path, body)
    // The host restarted with a new token: fetch it once and try again.
    if (res.status === 401 && opts.refresh) {
      const fresh = await opts.refresh()
      if (fresh) {
        token = fresh
        res = await send(path, body)
      }
    }
    const json = await res.json().catch(() => null)
    // Only a compare-and-set mismatch carries the head.
    if (res.status === 409 && json && 'head' in json) throw new StaleHead(json.head)
    if (!res.ok) throw new StoreError(res.status, json?.error ?? `the host answered ${res.status}`)
    return json as T
  }
  return {
    load: () => call<StoreState>(''),
    commit: async (version) => (await call<{ version: Version }>('/versions', { version })).version,
    setHead: async (head, expect) => void (await call<unknown>('/head', { head, expect })),
    rename: async (id, name) => void (await call<unknown>('/names', { id, name })),
  }
}

// ── History ─────────────────────────────────────────────────────────────────
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
  #readOnly: string | null = null
  #unsaved: string | null = null
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
  static async open(store: PlanStore, base: Plan, opts: { upgrades?: Readonly<Record<number, Upgrade>>; unsaved?: string } = {}): Promise<PlanHistory> {
    const history = new PlanHistory(store, opts.upgrades ?? UPGRADES)
    history.#unsaved = opts.unsaved ?? null
    let state = await store.load()
    if (!state.versions.length) {
      const reasons = validate(base)
      if (reasons.length) throw new PlanError(reasons)
      let failed: unknown = null
      try {
        await store.commit({ id: newId(), parent: null, plan: base })
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
  static readOnly(plan: Plan, why: string): PlanHistory {
    const refuse = async (): Promise<never> => {
      throw new ReadOnly([why])
    }
    const root: Version = { id: '0'.repeat(16), parent: null, at: new Date().toISOString(), plan: structuredClone(plan) }
    const history = new PlanHistory({ load: async () => ({ versions: [root], head: root.id, names: {} }), commit: refuse, setHead: refuse, rename: refuse }, UPGRADES)
    history.#adopt({ versions: [root], head: root.id, names: {} })
    history.#readOnly = why
    return history
  }

  /** Why the house cannot be changed on this page, as one line to show; null when it can. */
  get readOnly(): string | null {
    return this.#readOnly
  }

  /** Why changes here will not outlast the page, as one line to show; null when they are saved. */
  get unsaved(): string | null {
    return this.#unsaved
  }

  /** The house at the head, or at its nearest readable ancestor while the head cannot be read. */
  get plan(): Plan {
    for (let id: string | null = this.#head; id !== null; id = this.#version(id).parent) {
      const plan = this.#plans.get(id)
      if (plan) return plan
    }
    throw new HistoryError(this.#head, ['no version on the way to the root can be read'])
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
   * Applies the edits on top of the head and saves the plan they give as a new version. Throws PlanError with reasons when an edit fails, the result is invalid
   * or nothing changed; ReadOnly on a read-only house; StaleHead when someone else moved
   * the house (after reloading it); the store's error when the save fails. In every
   * failure no version of this page's is added.
   */
  commit(edits: Edit[], note?: string): Promise<Version> {
    return this.#serial(async () => {
      this.#writable()
      const unreadable = this.#unreadable.get(this.#head)
      if (unreadable) throw new HistoryError(this.#head, [unreadable])
      if (!edits.length) throw new PlanError(['no edits'])
      let next = this.plan
      for (const edit of edits) next = apply(next, edit)
      const reasons = validate(next)
      if (reasons.length) throw new PlanError(reasons)
      // A drag that snapped back to where it started is not a version.
      if (canonical(next) === canonical(this.plan)) throw new PlanError(['nothing changed'])
      const trimmed = note === undefined ? '' : plain(note).slice(0, NOTE_MAX)
      const sent: NewVersion = { id: newId(), parent: this.#head, ...(trimmed ? { note: trimmed } : {}), plan: next }
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
      const clean = plain(name)
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
    if (this.#readOnly) throw new ReadOnly([this.#readOnly])
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
        // The host checks shape only (host/src/plans.ts); a stored plan is held to the same rules as one this page made.
        const reasons = validate(plan)
        if (reasons.length) throw new Error(`the stored plan is not a valid house: ${reasons.join('; ')}`)
        plans.set(v.id, plan)
        return deepFreeze({ ...v, plan })
      } catch (error) {
        unreadable.set(v.id, (error as Error).message)
        return deepFreeze(v)
      }
    })
    if (roots !== 1) throw new HistoryError(state.versions[0]?.id ?? '', [`${roots} roots; a house has one`])
    if (state.head === null || !seen.has(state.head)) throw new HistoryError(state.head ?? '', ['the head is not a stored version'])
    // An unreadable head shows its nearest readable ancestor; only when none is readable does open fail.
    let readable: string | null = state.head
    while (readable !== null && !plans.has(readable)) readable = state.versions.find((v) => v.id === readable)!.parent
    if (readable === null) throw new HistoryError(state.head, [unreadable.get(state.head)!])
    this.#versions = versions
    this.#plans = plans
    this.#unreadable = unreadable
    this.#names = { ...state.names }
    this.#head = state.head
  }
}

// ── Diff ────────────────────────────────────────────────────────────────────
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
