// Data-driven Hierarchical StateTree + Utility AI Scorer + Blackboard (#164).
//
// Zero-dependency, deterministic ESM module usable both server-side and inside
// sandboxed rules. Implements:
//   - Typed per-actor Blackboard with dirty tracking, TTL expiry, and bounded
//     snapshot serialization for `world.keep` and `engine/mind` injection.
//   - Utility Scorer with response curves (linear, quadratic, logistic, step,
//     inverse) and inertia/hysteresis bonus to prevent action thrashing.
//   - Hierarchical StateTree with LCA exit/enter lifecycle, immediate
//     event-driven transitions, and UE 5.6+-style scheduled per-state tick
//     intervals for AI LOD.
//   - `createCityNpcTree()` factory modeling living city NPCs:
//     Routine <-> SmartActivity <-> WeatherShelter <-> ReactStimulus <-> Converse.
import { chooseReaction } from './stimulus.mjs'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// ── Blackboard ──────────────────────────────────────────────────────────

const TYPE_CHECKS = {
  string:  (v) => typeof v === 'string',
  number:  (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array:   (v) => Array.isArray(v),
  object:  (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  any:     () => true,
}

/**
 * Create a typed per-actor Blackboard with dirty-change tracking, TTL expiry
 * for transient memories, and bounded snapshot serialization.
 *
 * @param {Record<string, { type?: string, default?: unknown, priority?: number }>} [schema]
 * @param {{ maxBytes?: number }} [opts]
 */
export function createBlackboard(schema = {}, { maxBytes = 4096 } = {}) {
  const specs = Object.create(null)
  const store = new Map() // key -> { value, expiresAt, updatedAt, priority }
  const dirty = new Set()
  let version = 0

  for (const [k, raw] of Object.entries(schema ?? {})) {
    const spec = typeof raw === 'string' ? { type: raw } : (raw ?? {})
    const type = TYPE_CHECKS[spec.type] ? spec.type : 'any'
    specs[k] = { type, priority: Number.isFinite(spec.priority) ? spec.priority : 0 }
    if (spec.default !== undefined) {
      store.set(k, { value: spec.default, expiresAt: Infinity, updatedAt: 0, priority: specs[k].priority })
    }
  }

  function validateType(key, value) {
    const spec = specs[key]
    if (!spec || value === null || value === undefined) return
    if (!TYPE_CHECKS[spec.type](value)) {
      throw new TypeError(`blackboard key "${key}" expects ${spec.type}, got ${Array.isArray(value) ? 'array' : typeof value}`)
    }
  }

  /** Remove all keys whose TTL has expired at `now` (ms). */
  function prune(now = 0) {
    let removed = 0
    for (const [k, rec] of store) {
      if (rec.expiresAt <= now) {
        store.delete(k)
        dirty.add(k)
        version++
        removed++
      }
    }
    return removed
  }

  /**
   * Set a key on the blackboard.
   * `opts` may be a number (ttlMs) or `{ ttlMs?, now?, priority? }`.
   */
  function set(key, value, opts = null) {
    const k = String(key)
    validateType(k, value)
    let ttlMs = Infinity
    let now = 0
    let priority = specs[k]?.priority ?? 0
    if (typeof opts === 'number') {
      ttlMs = opts
    } else if (opts && typeof opts === 'object') {
      if (Number.isFinite(opts.ttlMs) && opts.ttlMs > 0) ttlMs = opts.ttlMs
      if (Number.isFinite(opts.now)) now = opts.now
      if (Number.isFinite(opts.priority)) priority = opts.priority
    }
    const expiresAt = Number.isFinite(ttlMs) ? now + ttlMs : Infinity
    const prev = store.get(k)
    const changed = !prev || prev.value !== value || prev.expiresAt !== expiresAt
    store.set(k, { value, expiresAt, updatedAt: now, priority })
    if (changed) {
      dirty.add(k)
      version++
    }
    return value
  }

  /** Read a key (returns `fallback` if absent or expired at `now`). */
  function get(key, now = null, fallback = undefined) {
    const rec = store.get(String(key))
    if (!rec) return fallback
    if (now !== null && rec.expiresAt <= now) {
      store.delete(String(key))
      dirty.add(String(key))
      version++
      return fallback
    }
    return rec.value
  }

  /** True if key exists and is not expired at `now`. */
  function has(key, now = null) {
    return get(key, now, undefined) !== undefined
  }

  /** Delete a key, marking it dirty if present. */
  function del(key) {
    const k = String(key)
    if (!store.delete(k)) return false
    dirty.add(k)
    version++
    return true
  }

  /** Return dirty keys and clear the dirty set. */
  function consumeDirty() {
    const out = [...dirty]
    dirty.clear()
    return out
  }

  /**
   * Produce a bounded, JSON-serializable snapshot (suitable for `world.keep`
   * and `engine/mind` prompt injection). Expired keys are pruned; if the JSON
   * exceeds `limit` bytes, lowest-priority / oldest entries are dropped first.
   */
  function snapshot(now = 0, { maxBytes: limit = maxBytes } = {}) {
    prune(now)
    const entries = [...store.entries()].map(([k, r]) => ({
      k,
      value: r.value,
      remMs: Number.isFinite(r.expiresAt) ? Math.max(0, Math.round(r.expiresAt - now)) : null,
      priority: r.priority,
      updatedAt: r.updatedAt,
    }))
    // Keep highest priority and freshest entries first when trimming to budget.
    entries.sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt || (a.k < b.k ? -1 : 1))

    const values = {}
    const ttl = {}
    let truncated = false
    for (const e of entries) {
      values[e.k] = e.value
      if (e.remMs !== null) ttl[e.k] = e.remMs
      const candidate = Object.keys(ttl).length ? { v: 1, values, ttl } : { v: 1, values }
      if (JSON.stringify(candidate).length > limit) {
        delete values[e.k]
        delete ttl[e.k]
        truncated = true
      }
    }
    const out = { v: 1, values }
    if (Object.keys(ttl).length) out.ttl = ttl
    if (truncated) out.truncated = true
    return out
  }

  /** Rehydrate blackboard state from a `snapshot()` object. */
  function restore(snap, now = 0) {
    store.clear()
    dirty.clear()
    if (!snap || typeof snap !== 'object' || !snap.values || typeof snap.values !== 'object') return
    const ttl = snap.ttl && typeof snap.ttl === 'object' ? snap.ttl : {}
    for (const [k, val] of Object.entries(snap.values)) {
      const rem = ttl[k]
      set(k, val, Number.isFinite(rem) && rem > 0 ? { ttlMs: rem, now } : { now })
    }
    dirty.clear()
  }

  function clear() {
    if (store.size > 0) {
      for (const k of store.keys()) dirty.add(k)
      store.clear()
      version++
    }
  }

  return {
    get size() { return store.size },
    get version() { return version },
    set,
    get,
    has,
    delete: del,
    prune,
    isDirty: (key) => dirty.has(String(key)),
    dirtyKeys: () => [...dirty],
    consumeDirty,
    clearDirty: () => dirty.clear(),
    keys: (now = null) => { if (now !== null) prune(now); return [...store.keys()] },
    entries: (now = null) => { if (now !== null) prune(now); return [...store.entries()].map(([k, r]) => [k, r.value]) },
    snapshot,
    restore,
    clear,
  }
}

// ── Utility AI Scorer ───────────────────────────────────────────────────

/** Standard response curves mapping normalized x in [0, 1] -> [0, 1]. */
export const CURVES = Object.freeze({
  linear:    (x, { slope = 1, offset = 0 } = {}) => clamp(x * slope + offset, 0, 1),
  quadratic: (x, { exp = 2, invert = false } = {}) => {
    const t = clamp(x, 0, 1)
    const y = Math.pow(t, exp)
    return clamp(invert ? 1 - y : y, 0, 1)
  },
  logistic:  (x, { k = 10, mid = 0.5 } = {}) => clamp(1 / (1 + Math.exp(-k * (clamp(x, 0, 1) - mid))), 0, 1),
  step:      (x, { threshold = 0.5, low = 0, high = 1 } = {}) => (clamp(x, 0, 1) >= threshold ? high : low),
  inverse:   (x, { exp = 1 } = {}) => clamp(1 - Math.pow(clamp(x, 0, 1), exp), 0, 1),
})

/**
 * Evaluate a named response curve or custom function on input `rawValue`.
 * Optional `{ min, max }` normalizes rawValue into [0, 1] before curve lookup.
 */
export function evalCurve(curveSpec, rawValue) {
  if (typeof curveSpec === 'function') return clamp(Number(curveSpec(rawValue)) || 0, 0, 1)
  const type = typeof curveSpec === 'string' ? curveSpec : (curveSpec?.type ?? 'linear')
  const fn = CURVES[type] ?? CURVES.linear
  const min = typeof curveSpec === 'object' && Number.isFinite(curveSpec.min) ? curveSpec.min : 0
  const max = typeof curveSpec === 'object' && Number.isFinite(curveSpec.max) ? curveSpec.max : 1
  const span = max - min
  const x = span === 0 ? 0 : clamp((Number(rawValue) - min) / span, 0, 1)
  return fn(x, typeof curveSpec === 'object' ? curveSpec : undefined)
}

/**
 * Score a single utility consideration `{ input(ctx), curve?, weight?, veto? }`.
 */
export function scoreConsideration(consideration, ctx) {
  const raw = typeof consideration.input === 'function' ? consideration.input(ctx) : Number(consideration.input ?? 0)
  const val = evalCurve(consideration.curve ?? 'linear', raw)
  const weight = Number.isFinite(consideration.weight) ? Math.max(0, consideration.weight) : 1
  return { raw, value: val, weight, vetoed: consideration.veto === true && val <= 0 }
}

/**
 * Score a candidate action with weighted considerations plus inertia/hysteresis
 * bonus when `action.id === currentActionId` so actors do not thrash between
 * close options.
 */
export function scoreAction(action, ctx, { currentActionId = null, inertia = 0.12 } = {}) {
  if (typeof action.canRun === 'function' && !action.canRun(ctx)) {
    return { id: action.id, score: 0, base: 0, inertiaApplied: 0 }
  }
  const considerations = Array.isArray(action.considerations) ? action.considerations : []
  let base
  if (considerations.length > 0) {
    let sum = 0
    let weightSum = 0
    for (const c of considerations) {
      const r = scoreConsideration(c, ctx)
      if (r.vetoed) return { id: action.id, score: 0, base: 0, inertiaApplied: 0 }
      sum += r.value * r.weight
      weightSum += r.weight
    }
    base = weightSum > 0 ? sum / weightSum : 0
  } else if (typeof action.score === 'function') {
    base = clamp(Number(action.score(ctx)) || 0, 0, 1)
  } else {
    base = clamp(Number(action.baseScore ?? 0), 0, 1)
  }

  const bias = Number.isFinite(action.weight) ? Math.max(0, action.weight) : 1
  const weighted = base * bias
  const inertiaBonus = currentActionId !== null && action.id === currentActionId
    ? (Number.isFinite(action.inertia) ? action.inertia : inertia)
    : 0
  return { id: action.id, score: weighted + inertiaBonus, base: weighted, inertiaApplied: inertiaBonus }
}

/**
 * Select the highest-scoring action deterministically (ties break by array order).
 */
export function selectUtility(actions, ctx, { currentActionId = null, inertia = 0.12, minScore = 0 } = {}) {
  const scores = []
  let best = null
  let bestScore = minScore
  for (const action of actions) {
    const res = scoreAction(action, ctx, { currentActionId, inertia })
    scores.push(res)
    if (res.score > bestScore) {
      bestScore = res.score
      best = action
    }
  }
  return { action: best, score: best ? bestScore : 0, scores }
}

// ── Hierarchical StateTree ──────────────────────────────────────────────

/**
 * Create a hierarchical StateTree instance.
 *
 * Supports both nested `children: [...]` definitions and flat `parent: 'Id'`
 * definitions. Each state node may declare:
 *   `{ id, parent?, enter?, tick?, exit?, conditions?, transitions?, children?, tickIntervalMs?, utility?, inertia? }`
 *
 * Transitions may be:
 *   - Event-driven (`event: 'stimulus' | '*' | string[]`): evaluated immediately
 *     in `sendEvent(event, ctx, now)` without polling.
 *   - Condition-driven (no `event` field): evaluated during scheduled `tick`.
 *   Each transition: `{ event?, when?(ctx, bb, ev), to: string | ((ctx, bb, ev) => string), priority? }`
 */
export function createStateTree(definition, { blackboard = null, initial = null, inertia = 0.12, lodScale = null } = {}) {
  const bb = blackboard ?? createBlackboard()
  const nodes = new Map()
  const childrenOf = new Map()
  let rootId = null

  // Flatten definition whether passed as a root node with nested `children` or an array of nodes.
  const ingest = (node, parentId = null) => {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) {
      throw new Error('each StateTree state requires a non-empty string id')
    }
    if (nodes.has(node.id)) throw new Error(`duplicate StateTree state id "${node.id}"`)
    const p = node.parent ?? parentId ?? null
    const copy = {
      id: node.id,
      parent: p,
      enter: typeof node.enter === 'function' ? node.enter : null,
      tick: typeof node.tick === 'function' ? node.tick : null,
      exit: typeof node.exit === 'function' ? node.exit : null,
      conditions: typeof node.conditions === 'function' ? node.conditions : null,
      transitions: Array.isArray(node.transitions) ? node.transitions : [],
      tickIntervalMs: node.tickIntervalMs ?? 0,
      utility: node.utility ?? null,
      inertia: node.inertia,
      data: node.data ?? null,
    }
    nodes.set(copy.id, copy)
    if (!childrenOf.has(copy.id)) childrenOf.set(copy.id, [])
    if (p !== null) {
      if (!childrenOf.has(p)) childrenOf.set(p, [])
      childrenOf.get(p).push(copy.id)
    } else if (rootId === null) {
      rootId = copy.id
    }
    if (Array.isArray(node.children)) {
      for (const ch of node.children) ingest(ch, copy.id)
    }
  }

  if (Array.isArray(definition)) {
    for (const n of definition) ingest(n, n.parent ?? null)
  } else {
    ingest(definition, null)
  }

  if (rootId === null) throw new Error('StateTree requires a root state (parent: null)')

  // Verify parents exist and there are no cycles.
  const ancestry = (id) => {
    const path = []
    const seen = new Set()
    let cur = id
    while (cur !== null) {
      if (seen.has(cur)) throw new Error(`cycle detected in StateTree at "${cur}"`)
      seen.add(cur)
      const n = nodes.get(cur)
      if (!n) throw new Error(`unknown StateTree state "${cur}"`)
      path.push(cur)
      cur = n.parent
    }
    path.reverse()
    return path
  }
  for (const id of nodes.keys()) ancestry(id)

  /** Current active chain from root down to active leaf. */
  let activePath = []
  /** Per-state timing: id -> { enteredAt, lastTickAt, nextTickAt }. */
  const timers = new Map()
  let started = false

  /** Compute scheduled tick interval (ms) for a state, factoring in LOD ring if present. */
  function intervalFor(node, ctx) {
    const raw = typeof node.tickIntervalMs === 'function'
      ? Number(node.tickIntervalMs(ctx, bb))
      : Number(node.tickIntervalMs ?? 0)
    const base = Number.isFinite(raw) && raw > 0 ? raw : 0
    if (base === 0) return 0
    if (typeof lodScale === 'function') return base * Math.max(0.1, Number(lodScale(ctx, node)) || 1)
    const lod = ctx?.lod ?? 1
    if (lod >= 3) return base * 10
    if (lod === 2) return base * 3
    return base
  }

  /** Resolve a target state down to its best eligible leaf child. */
  function resolveToLeaf(startId, ctx, event = null) {
    const path = ancestry(startId)
    let cur = startId
    const guard = new Set(path)
    while (true) {
      const kids = childrenOf.get(cur) ?? []
      if (kids.length === 0) break

      // Gather eligible children whose `conditions` pass.
      const eligible = []
      for (const kidId of kids) {
        const kid = nodes.get(kidId)
        if (kid.conditions && !kid.conditions(ctx, bb, event)) continue
        eligible.push(kid)
      }
      if (eligible.length === 0) break

      // If any eligible child declares `utility`, use Utility Scorer with inertia.
      const hasUtility = eligible.some((k) => k.utility !== null)
      let chosen
      if (hasUtility) {
        const prevChild = activePath.find((id) => nodes.get(id)?.parent === cur) ?? null
        const actions = eligible.map((k) => ({
          id: k.id,
          considerations: Array.isArray(k.utility?.considerations) ? k.utility.considerations : [],
          score: typeof k.utility === 'function' ? k.utility : k.utility?.score,
          baseScore: k.utility?.baseScore ?? 0.5,
          weight: k.utility?.weight ?? 1,
          inertia: k.inertia,
        }))
        const picked = selectUtility(actions, { ...ctx, blackboard: bb, event }, { currentActionId: prevChild, inertia })
        chosen = picked.action ? picked.action.id : eligible[0].id
      } else {
        chosen = eligible[0].id
      }
      if (guard.has(chosen)) break
      guard.add(chosen)
      path.push(chosen)
      cur = chosen
    }
    return path
  }

  /** Transition cleanly from `activePath` to `targetId` via Lowest Common Ancestor. */
  function transitionTo(targetId, ctx, now, event = null) {
    if (!nodes.has(targetId)) throw new Error(`unknown target state "${targetId}"`)
    const nextPath = resolveToLeaf(targetId, ctx, event)

    // Find Lowest Common Ancestor index.
    let lca = 0
    while (lca < activePath.length && lca < nextPath.length && activePath[lca] === nextPath[lca]) {
      lca++
    }
    // If transitioning explicitly to the same leaf, allow re-entering the leaf when triggered by event.
    if (lca === activePath.length && lca === nextPath.length && event !== null && lca > 0) {
      lca = activePath.length - 1
    }

    // Exit old states from leaf up to LCA.
    for (let i = activePath.length - 1; i >= lca; i--) {
      const id = activePath[i]
      const node = nodes.get(id)
      node.exit?.(ctx, bb, event)
      timers.delete(id)
    }

    activePath = nextPath

    // Enter new states from LCA down to new leaf.
    for (let i = lca; i < activePath.length; i++) {
      const id = activePath[i]
      const node = nodes.get(id)
      const iv = intervalFor(node, ctx)
      timers.set(id, { enteredAt: now, lastTickAt: now, nextTickAt: now + iv })
      node.enter?.(ctx, bb, event)
    }
    return activePath.at(-1)
  }

  /** Find highest-priority matching transition across the active chain. */
  function findTransition(ctx, event) {
    const evType = event ? (typeof event === 'string' ? event : event.type) : null
    let best = null
    // Walk root -> leaf so higher-level interrupts win ties unless a child has higher explicit priority.
    for (let depth = 0; depth < activePath.length; depth++) {
      const node = nodes.get(activePath[depth])
      for (const tr of node.transitions) {
        if (evType !== null) {
          if (!tr.event) continue
          const match = tr.event === '*' ||
            tr.event === evType ||
            (Array.isArray(tr.event) && tr.event.includes(evType))
          if (!match) continue
        } else {
          if (tr.event) continue
        }
        if (typeof tr.when === 'function' && !tr.when(ctx, bb, event)) continue
        const target = typeof tr.to === 'function' ? tr.to(ctx, bb, event) : tr.to
        if (!target || !nodes.has(target)) continue
        // Avoid no-op self transition for polling transitions.
        if (evType === null && target === activePath.at(-1)) continue
        const prio = Number.isFinite(tr.priority) ? tr.priority : (100 - depth)
        if (!best || prio > best.prio) best = { target, prio, tr }
      }
    }
    return best
  }

  /** Earliest scheduled `nextTickAt` across the active path. */
  function nextTickAt() {
    if (!started) return -Infinity
    let earliest = Infinity
    for (const id of activePath) {
      const t = timers.get(id)
      if (t && t.nextTickAt < earliest) earliest = t.nextTickAt
    }
    return earliest
  }

  /** Start the tree if not already entered. */
  function start(ctx = {}, now = 0) {
    if (started) return activePath.at(-1)
    started = true
    return transitionTo(initial ?? rootId, ctx, now, null)
  }

  /**
   * Deliver an event immediately to the StateTree (event-driven transition
   * without waiting for the next scheduled tick).
   */
  function sendEvent(event, ctx = {}, now = 0) {
    if (!started) start(ctx, now)
    const ev = typeof event === 'string' ? { type: event } : event
    const hit = findTransition(ctx, ev)
    if (!hit) return { transitioned: false, state: activePath.at(-1), activePath: [...activePath] }
    const state = transitionTo(hit.target, ctx, now, ev)
    return { transitioned: true, state, activePath: [...activePath] }
  }

  /**
   * Advance the StateTree at time `now` (ms). Respects each active state's
   * scheduled `tickIntervalMs` (UE 5.6+ scheduled ticks) so states are skipped
   * cleanly when not yet due.
   */
  function tick(ctx = {}, now = 0) {
    if (!started) start(ctx, now)
    bb.prune(now)

    let tickedAny = false
    const tickedStates = []

    // Evaluate each active state whose scheduled tick is due.
    const snapshotPath = [...activePath]
    for (const id of snapshotPath) {
      if (!activePath.includes(id)) break
      const node = nodes.get(id)
      const timer = timers.get(id)
      if (!timer) continue
      if (now < timer.nextTickAt) continue
      const dt = Math.max(0, now - timer.lastTickAt)
      timer.lastTickAt = now
      timer.nextTickAt = now + intervalFor(node, ctx)
      tickedAny = true
      tickedStates.push(id)
      node.tick?.(ctx, bb, dt, now)
    }

    // Evaluate polling transitions only when at least one active state ticked.
    let transitioned = false
    if (tickedAny) {
      const hit = findTransition(ctx, null)
      if (hit) {
        transitionTo(hit.target, ctx, now, null)
        transitioned = true
      }
    }

    return {
      ticked: tickedAny,
      tickedStates,
      transitioned,
      state: activePath.at(-1) ?? null,
      activePath: [...activePath],
      nextTickAt: nextTickAt(),
    }
  }

  /** True if `stateId` is currently in the active state hierarchy. */
  function isIn(stateId) {
    return activePath.includes(stateId)
  }

  /** Serialize current StateTree state + bounded Blackboard for persistence. */
  function snapshot(now = 0, opts = {}) {
    return {
      state: activePath.at(-1) ?? null,
      activePath: [...activePath],
      blackboard: bb.snapshot(now, opts),
    }
  }

  /** Restore StateTree state + Blackboard from a snapshot. */
  function restore(snap, ctx = {}, now = 0) {
    if (!snap || typeof snap !== 'object') return
    if (snap.blackboard) bb.restore(snap.blackboard, now)
    started = true
    activePath = []
    timers.clear()
    const target = snap.state && nodes.has(snap.state) ? snap.state : (initial ?? rootId)
    transitionTo(target, ctx, now, null)
  }

  return {
    blackboard: bb,
    get state() { return activePath.at(-1) ?? null },
    get activePath() { return [...activePath] },
    get nextTickAt() { return nextTickAt() },
    canTick: (now) => !started || now >= nextTickAt(),
    isIn,
    start,
    tick,
    sendEvent,
    transitionTo,
    snapshot,
    restore,
  }
}

// ── City NPC StateTree Factory ──────────────────────────────────────────

/** Map `stimulus.mjs` reaction names to `ReactStimulus` child state ids. */
const REACTION_STATE = {
  flee:      'Flee',
  shelter:   'Shelter',
  film:      'Film',
  confront:  'Confront',
  call_help: 'CallHelp',
  glance:    'Watch',
}

/**
 * Ready-to-use Rockstar-style living city NPC StateTree modeling:
 *   `Routine` (`Walk` / `Commute`)
 *   <-> `SmartActivity` (`Sit` / `Browse` / `Chat` / `Spectacle`)
 *   <-> `WeatherShelter` (seeks overhang/awning when `rain > 0.3`, releases when clear)
 *   <-> `ReactStimulus` (`Flee` / `Shelter` / `Film` / `Confront` / `CallHelp` / `Watch`)
 *   <-> `Converse`
 *
 * Expected `ctx` shape on `tick` / `sendEvent`:
 *   `{ actorId, pos, now, rain?, weather?: { rain }, personality?, smartObjects?, stimulus?, lod?, partnerId?, commuteTarget? }`
 */
export function createCityNpcTree(options = {}) {
  const rainThreshold = options.rainThreshold ?? 0.3
  const rainClear = options.rainClear ?? 0.25
  const smartSearchRadius = options.smartSearchRadius ?? 300
  const shelterSearchRadius = options.shelterSearchRadius ?? 500
  const slotTtlMs = options.slotTtlMs ?? 30_000
  const activityDurationMs = options.activityDurationMs ?? 12_000
  const reactionDurationMs = options.reactionDurationMs ?? 8_000
  const converseDurationMs = options.converseDurationMs ?? 10_000

  const rainOf = (ctx) => {
    if (Number.isFinite(ctx?.rain)) return ctx.rain
    if (Number.isFinite(ctx?.weather?.rain)) return ctx.weather.rain
    return 0
  }

  const releaseHeldSlot = (ctx, bb) => {
    const slotId = bb.get('claimedSlotId')
    if (slotId && ctx?.smartObjects) {
      ctx.smartObjects.release(slotId, ctx.actorId, ctx.now ?? 0)
    }
    bb.delete('claimedSlotId')
    bb.delete('claimedKind')
    bb.delete('targetPos')
  }

  const claimBestSlot = (ctx, bb, { kind, kinds, radius }) => {
    if (!ctx?.smartObjects || !ctx?.pos) return null
    const res = ctx.smartObjects.findBestAndClaim(
      ctx.actorId,
      { pos: ctx.pos, radius, kind, kinds, now: ctx.now ?? 0 },
      slotTtlMs
    )
    if (!res) return null
    bb.set('claimedSlotId', res.slot.slotId, { now: ctx.now ?? 0, priority: 5 })
    bb.set('claimedKind', res.slot.kind, { now: ctx.now ?? 0, priority: 4 })
    bb.set('targetPos', res.slot.pos, { now: ctx.now ?? 0, priority: 4 })
    return res
  }

  const bb = options.blackboard ?? createBlackboard({
    intent:          { type: 'string', default: 'walk', priority: 3 },
    claimedSlotId:   { type: 'string', priority: 5 },
    claimedKind:     { type: 'string', priority: 4 },
    targetPos:       { type: 'array',  priority: 4 },
    reaction:        { type: 'string', priority: 6 },
    lastStimulusKind:{ type: 'string', priority: 5 },
    stimulusPos:     { type: 'array',  priority: 5 },
    partnerId:       { type: 'string', priority: 4 },
    stateUntil:      { type: 'number', priority: 2 },
    energy:          { type: 'number', default: 0.8, priority: 1 },
    sociability:     { type: 'number', default: 0.5, priority: 1 },
  })

  const definition = {
    id: 'Root',
    tickIntervalMs: 250,
    transitions: [
      // Immediate event-driven reaction to any world stimulus (no polling lag).
      {
        event: 'stimulus',
        priority: 300,
        when: (_ctx, _bb, ev) => Boolean(ev?.stimulus),
        to: 'ReactStimulus',
      },
      // Event-driven conversation start (when not in a high-threat stimulus reaction).
      {
        event: 'converse',
        priority: 150,
        when: (_ctx, _bb, ev) => Boolean(ev?.partnerId),
        to: 'Converse',
      },
    ],
    children: [
      {
        id: 'Routine',
        tickIntervalMs: 500,
        transitions: [
          {
            priority: 220,
            when: (ctx) => Boolean(ctx?.stimulus),
            to: 'ReactStimulus',
          },
          {
            priority: 200,
            when: (ctx) => rainOf(ctx) > rainThreshold,
            to: 'WeatherShelter',
          },
          {
            priority: 120,
            when: (ctx) => {
              if (!ctx?.smartObjects || !ctx?.pos) return false
              const best = ctx.smartObjects.findBest(ctx.actorId, {
                pos: ctx.pos,
                radius: smartSearchRadius,
                kinds: ['sit', 'browse', 'spectacle', 'queue'],
                now: ctx.now ?? 0,
              })
              return Boolean(best && best.score >= 0.35)
            },
            to: 'SmartActivity',
          },
        ],
        children: [
          {
            id: 'Commute',
            tickIntervalMs: 500,
            conditions: (ctx) => Array.isArray(ctx?.commuteTarget),
            enter: (ctx, b) => {
              b.set('intent', 'commute', { now: ctx.now ?? 0 })
              b.set('targetPos', ctx.commuteTarget, { now: ctx.now ?? 0 })
            },
            tick: (ctx, b) => {
              if (Array.isArray(ctx?.commuteTarget)) b.set('targetPos', ctx.commuteTarget, { now: ctx.now ?? 0 })
            },
          },
          {
            id: 'Walk',
            tickIntervalMs: 500,
            enter: (ctx, b) => { b.set('intent', 'walk', { now: ctx.now ?? 0 }) },
          },
        ],
      },
      {
        id: 'SmartActivity',
        tickIntervalMs: 400,
        enter: (ctx, b) => {
          const now = ctx.now ?? 0
          b.set('stateUntil', now + activityDurationMs, { now })
        },
        exit: (ctx, b) => {
          releaseHeldSlot(ctx, b)
        },
        transitions: [
          {
            priority: 220,
            when: (ctx) => Boolean(ctx?.stimulus),
            to: 'ReactStimulus',
          },
          {
            priority: 200,
            when: (ctx) => rainOf(ctx) > rainThreshold,
            to: 'WeatherShelter',
          },
          {
            priority: 100,
            when: (ctx, b) => {
              const now = ctx.now ?? 0
              const until = b.get('stateUntil') ?? 0
              return now >= until || !b.get('claimedSlotId')
            },
            to: 'Routine',
          },
        ],
        children: [
          {
            id: 'Sit',
            tickIntervalMs: 600,
            utility: {
              considerations: [
                {
                  input: (c) => {
                    if (!c.smartObjects || !c.pos) return 0
                    const hit = c.smartObjects.findBest(c.actorId, { pos: c.pos, radius: smartSearchRadius, kind: 'sit', now: c.now ?? 0 })
                    return hit ? hit.score : 0
                  },
                  curve: 'linear',
                  weight: 1.2,
                  veto: true,
                },
                { input: (c) => 1 - (c.blackboard.get('energy') ?? 0.5), curve: 'quadratic', weight: 0.6 },
              ],
            },
            enter: (ctx, b) => {
              const claimed = claimBestSlot(ctx, b, { kind: 'sit', radius: smartSearchRadius })
              b.set('intent', claimed ? 'sit' : 'walk', { now: ctx.now ?? 0 })
            },
          },
          {
            id: 'Browse',
            tickIntervalMs: 500,
            utility: {
              considerations: [
                {
                  input: (c) => {
                    if (!c.smartObjects || !c.pos) return 0
                    const hit = c.smartObjects.findBest(c.actorId, { pos: c.pos, radius: smartSearchRadius, kind: 'browse', now: c.now ?? 0 })
                    return hit ? hit.score : 0
                  },
                  curve: 'linear',
                  weight: 1.1,
                  veto: true,
                },
              ],
            },
            enter: (ctx, b) => {
              const claimed = claimBestSlot(ctx, b, { kind: 'browse', radius: smartSearchRadius })
              b.set('intent', claimed ? 'browse' : 'walk', { now: ctx.now ?? 0 })
            },
          },
          {
            id: 'Spectacle',
            tickIntervalMs: 500,
            utility: {
              considerations: [
                {
                  input: (c) => {
                    if (!c.smartObjects || !c.pos) return 0
                    const hit = c.smartObjects.findBest(c.actorId, { pos: c.pos, radius: smartSearchRadius, kind: 'spectacle', now: c.now ?? 0 })
                    return hit ? hit.score : 0
                  },
                  curve: 'linear',
                  weight: 1.0,
                  veto: true,
                },
              ],
            },
            enter: (ctx, b) => {
              const claimed = claimBestSlot(ctx, b, { kind: 'spectacle', radius: smartSearchRadius })
              b.set('intent', claimed ? 'spectacle' : 'walk', { now: ctx.now ?? 0 })
            },
          },
          {
            id: 'Chat',
            tickIntervalMs: 500,
            utility: {
              considerations: [
                { input: (c) => (c.partnerId ? 0.8 : 0), curve: 'step', weight: 1.0, veto: true },
                { input: (c) => c.blackboard.get('sociability') ?? 0.5, curve: 'linear', weight: 0.5 },
              ],
            },
            enter: (ctx, b) => {
              b.set('intent', 'chat', { now: ctx.now ?? 0 })
              if (ctx.partnerId) b.set('partnerId', String(ctx.partnerId), { now: ctx.now ?? 0 })
            },
          },
        ],
      },
      {
        id: 'WeatherShelter',
        tickIntervalMs: 400,
        enter: (ctx, b) => {
          const now = ctx.now ?? 0
          const claimed = claimBestSlot(ctx, b, { kind: 'shelter', radius: shelterSearchRadius })
          b.set('intent', claimed ? 'shelter_rain' : 'seek_shelter', { now })
        },
        tick: (ctx, b) => {
          const now = ctx.now ?? 0
          const slotId = b.get('claimedSlotId')
          if (slotId && ctx?.smartObjects) {
            // Keep lease fresh while rain persists.
            ctx.smartObjects.claim(slotId, ctx.actorId, now, slotTtlMs)
          } else if (ctx?.smartObjects) {
            const claimed = claimBestSlot(ctx, b, { kind: 'shelter', radius: shelterSearchRadius })
            if (claimed) b.set('intent', 'shelter_rain', { now })
          }
        },
        exit: (ctx, b) => {
          releaseHeldSlot(ctx, b)
        },
        transitions: [
          {
            priority: 220,
            when: (ctx) => Boolean(ctx?.stimulus),
            to: 'ReactStimulus',
          },
          {
            priority: 180,
            when: (ctx) => rainOf(ctx) <= rainClear,
            to: 'Routine',
          },
        ],
      },
      {
        id: 'ReactStimulus',
        tickIntervalMs: 200,
        enter: (ctx, b, ev) => {
          const now = ctx.now ?? 0
          const stim = ev?.stimulus ?? ctx?.stimulus
          const picked = chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim ?? {})
          b.set('reaction', picked.reaction, { now, ttlMs: reactionDurationMs, priority: 6 })
          b.set('stateUntil', now + reactionDurationMs, { now })
          const rawEv = stim?.event ?? stim
          if (rawEv?.kind) b.set('lastStimulusKind', rawEv.kind, { now, ttlMs: reactionDurationMs * 2 })
          if (Array.isArray(rawEv?.pos)) b.set('stimulusPos', rawEv.pos, { now, ttlMs: reactionDurationMs * 2 })
        },
        exit: (ctx, b) => {
          releaseHeldSlot(ctx, b)
          b.delete('reaction')
        },
        transitions: [
          {
            priority: 120,
            when: (ctx, b) => (ctx.now ?? 0) >= (b.get('stateUntil') ?? 0),
            to: (ctx) => (rainOf(ctx) > rainThreshold ? 'WeatherShelter' : 'Routine'),
          },
        ],
        children: [
          {
            id: 'Flee',
            tickIntervalMs: 150,
            conditions: (ctx, b, ev) => {
              const stim = ev?.stimulus ?? ctx?.stimulus
              const r = stim ? chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim).reaction : b.get('reaction')
              return REACTION_STATE[r] === 'Flee'
            },
            enter: (ctx, b) => { b.set('intent', 'flee', { now: ctx.now ?? 0 }) },
          },
          {
            id: 'Shelter',
            tickIntervalMs: 250,
            conditions: (ctx, b, ev) => {
              const stim = ev?.stimulus ?? ctx?.stimulus
              const r = stim ? chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim).reaction : b.get('reaction')
              return REACTION_STATE[r] === 'Shelter'
            },
            enter: (ctx, b) => {
              claimBestSlot(ctx, b, { kinds: ['cover', 'shelter'], radius: shelterSearchRadius })
              b.set('intent', 'shelter', { now: ctx.now ?? 0 })
            },
          },
          {
            id: 'Film',
            tickIntervalMs: 300,
            conditions: (ctx, b, ev) => {
              const stim = ev?.stimulus ?? ctx?.stimulus
              const r = stim ? chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim).reaction : b.get('reaction')
              return REACTION_STATE[r] === 'Film'
            },
            enter: (ctx, b) => { b.set('intent', 'film', { now: ctx.now ?? 0 }) },
          },
          {
            id: 'Confront',
            tickIntervalMs: 200,
            conditions: (ctx, b, ev) => {
              const stim = ev?.stimulus ?? ctx?.stimulus
              const r = stim ? chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim).reaction : b.get('reaction')
              return REACTION_STATE[r] === 'Confront'
            },
            enter: (ctx, b) => { b.set('intent', 'confront', { now: ctx.now ?? 0 }) },
          },
          {
            id: 'CallHelp',
            tickIntervalMs: 300,
            conditions: (ctx, b, ev) => {
              const stim = ev?.stimulus ?? ctx?.stimulus
              const r = stim ? chooseReaction(ctx?.personality ?? { id: ctx?.actorId }, stim).reaction : b.get('reaction')
              return REACTION_STATE[r] === 'CallHelp'
            },
            enter: (ctx, b) => { b.set('intent', 'call_help', { now: ctx.now ?? 0 }) },
          },
          {
            id: 'Watch',
            tickIntervalMs: 400,
            enter: (ctx, b) => { b.set('intent', 'watch', { now: ctx.now ?? 0 }) },
          },
        ],
      },
      {
        id: 'Converse',
        tickIntervalMs: 400,
        enter: (ctx, b, ev) => {
          const now = ctx.now ?? 0
          b.set('intent', 'converse', { now })
          b.set('partnerId', String(ev?.partnerId ?? ctx?.partnerId ?? ''), { now, ttlMs: converseDurationMs })
          b.set('stateUntil', now + converseDurationMs, { now })
        },
        exit: (_ctx, b) => {
          b.delete('partnerId')
        },
        transitions: [
          {
            priority: 220,
            when: (ctx) => Boolean(ctx?.stimulus),
            to: 'ReactStimulus',
          },
          {
            priority: 200,
            when: (ctx) => rainOf(ctx) > rainThreshold,
            to: 'WeatherShelter',
          },
          {
            priority: 100,
            when: (ctx, b) => (ctx.now ?? 0) >= (b.get('stateUntil') ?? 0),
            to: 'Routine',
          },
        ],
      },
    ],
  }

  return createStateTree(definition, { blackboard: bb, inertia: options.inertia ?? 0.12, lodScale: options.lodScale ?? null })
}
