// Shared deterministic San Francisco pedestrian walk graph, district-clocked daily routines,
// and Three-Ring Multi-Tier AI LOD evaluator (#164).
//
// Pure ESM with zero Node-only or browser-only imports so both the authoritative world process
// (engine/world.mjs) and the browser page (engine/page/street.ts) compute bit-for-bit identical
// pedestrian positions, headings, speeds, strides, routines, and LOD tiers for any
// (squares, t, hour, rain).
//
// Lengths are the world's finest cells (10 cm); time is seconds on the shared world clock.

/** How far off street people are drawn on the page (140 m), and max one-way walk distance (160 m). */
export const REACH = 1400
export const WALK_MOST = 1600
/** How long a pair of steps is (people.ts STRIDE). */
export const STRIDE = 14.4
/** Signal timing (seconds), matching street.ts traffic lights identically. */
export const CYCLE = 60
export const GREEN = 26
export const AMBER = 3
export const WALK = 16
/** Three-Ring Multi-Tier AI LOD radii (world cells: 10 cells = 1 metre). */
export const RING1_RADIUS = 350   // <= 35 m: full detail (gaze, micro-reactions, avoidance, interaction)
export const RING2_RADIUS = 1100  // 35–110 m: mid-range (simplified kinematics, umbrella/posture)
export const RING3_RADIUS = 3000  // 110–300 m: macro city (lightweight route progression)
/** Default per-ring budget caps so dense downtown blocks stay predictable and bounded. */
export const DEFAULT_RING_CAPS = Object.freeze({ 1: 48, 2: 96, 3: 240 })

/** Resident archetypes assigned deterministically from (seed, district busy). */
export const ARCHETYPES = Object.freeze(['commuter', 'shopkeeper', 'tourist', 'runner', 'night_owl', 'resident'])

/** Hourly activity tables (0..23h): home residential curve (residents.ts) and commercial corridor curve (street.ts). */
export const HOME_HOURS = Object.freeze([0.1, 0.07, 0.05, 0.05, 0.07, 0.15, 0.4, 0.8, 1, 0.85, 0.75, 0.8, 0.95, 0.9, 0.75, 0.75, 0.85, 1, 1, 0.9, 0.7, 0.5, 0.32, 0.18])
export const SHOPS = Object.freeze([0.15, 0.08, 0.05, 0.04, 0.05, 0.1, 0.25, 0.5, 0.75, 0.85, 0.9, 1, 1, 1, 0.95, 0.95, 1, 1, 1, 0.95, 0.85, 0.7, 0.5, 0.3])

/** Per-archetype hourly presence multipliers around the base district curve (kept balanced within scene budgets). */
const ARCHETYPE_HOURS = Object.freeze({
  commuter:   [0.12, 0.06, 0.04, 0.04, 0.08, 0.25, 0.65, 1.00, 1.00, 0.78, 0.62, 0.78, 0.92, 0.85, 0.65, 0.68, 0.88, 1.00, 0.95, 0.75, 0.50, 0.35, 0.22, 0.16],
  shopkeeper: [0.06, 0.04, 0.03, 0.03, 0.05, 0.12, 0.35, 0.65, 0.88, 0.98, 1.00, 1.00, 1.00, 1.00, 0.96, 0.96, 0.98, 0.95, 0.88, 0.75, 0.55, 0.38, 0.22, 0.10],
  tourist:    [0.08, 0.04, 0.03, 0.02, 0.03, 0.06, 0.14, 0.30, 0.55, 0.80, 0.96, 1.00, 1.00, 1.00, 1.00, 0.98, 0.94, 0.88, 0.82, 0.76, 0.65, 0.48, 0.30, 0.15],
  runner:     [0.04, 0.03, 0.03, 0.04, 0.08, 0.35, 0.85, 1.00, 0.92, 0.62, 0.48, 0.52, 0.60, 0.52, 0.45, 0.50, 0.72, 0.92, 0.84, 0.52, 0.26, 0.14, 0.08, 0.05],
  night_owl:  [0.72, 0.42, 0.24, 0.14, 0.08, 0.06, 0.08, 0.12, 0.20, 0.32, 0.48, 0.62, 0.72, 0.76, 0.78, 0.80, 0.85, 0.92, 0.98, 1.00, 1.00, 1.00, 0.95, 0.86],
  resident:   HOME_HOURS,
})

/** Deterministic 0..1 hash for a seed and question number (matches residents.ts bit-for-bit). */
export function chance(seed, ask) {
  let h = Math.imul(seed ^ Math.imul(ask, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Deterministic 32-bit integer mix (matches street.ts bit-for-bit). */
export const mix = (a, b) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) | 0

/** Deterministic 32-bit seed from an OSM node or way id (up to 2^53). */
export const idSeed = (n) => mix(n % 2147483647, Math.floor(n / 2147483647))

/** Canonical resident string id from signed 32-bit seed (matches world.mjs residentId). */
export const residentId = (seed) => `r${(seed >>> 0).toString(36)}`

/** Smoothstep ease clamped to [0, 1]. */
export const ease = (v) => {
  const c = Math.max(0, Math.min(1, v))
  return c * c * (3 - 2 * c)
}

/** Interpolates a 24-hour cyclic table at fractional `hour`. */
export function hourly(table, hour) {
  const h = ((hour % 24) + 24) % 24
  const a = Math.floor(h)
  return table[a] + (table[(a + 1) % 24] - table[a]) * (h - a)
}

export const homeHours = (hour) => hourly(HOME_HOURS, hour)

/** World cell bounds [x0, z0, x1, z1] of a 1 km SF UTM square name (`E_N`, e.g. `551.7_4183.5`). */
export function squareBounds(name) {
  const [e, n] = name.split('_').map((v) => Number(v) * 1000)
  return [(e - 500000) * 10, (4250000 - n - 1000) * 10, (e + 1000 - 500000) * 10, (4250000 - n) * 10]
}

/**
 * Classifies a pedestrian distance (world cells, 10 cells = 1 m) into Three-Ring AI LOD:
 *   1: Ring 1 (<= 35 m)   — full detail (gaze, micro-reactions, obstacle avoidance, interaction)
 *   2: Ring 2 (35–110 m)  — mid-range (simplified kinematics, posture/umbrella)
 *   3: Ring 3 (110–300 m) — macro city (lightweight route progression, zero collision/animation)
 *   0: culled (> 300 m)
 */
export function classifyLod(distCells) {
  if (distCells <= RING1_RADIUS) return 1
  if (distCells <= RING2_RADIUS) return 2
  if (distCells <= RING3_RADIUS) return 3
  return 0
}

/**
 * District-clocked schedule phase for fractional hour [0, 24).
 */
export function schedulePhase(hour) {
  const h = ((hour % 24) + 24) % 24
  if (h >= 7 && h < 9.5) return 'morning_commute'
  if (h >= 9.5 && h < 17) return 'work_day'
  if (h >= 17 && h < 20) return 'evening_commute'
  if (h >= 20 || h < 1) return 'nightlife'
  return 'late_quiet'
}

/**
 * Deterministic resident archetype from seed and home walk `busy` score (0..100).
 */
export function archetypeOf(seed, busy = 40) {
  const u = chance(seed, 401)
  if (busy >= 65) {
    if (u < 0.34) return 'commuter'
    if (u < 0.56) return 'tourist'
    if (u < 0.74) return 'shopkeeper'
    if (u < 0.86) return 'night_owl'
    if (u < 0.92) return 'runner'
    return 'resident'
  }
  if (busy >= 35) {
    if (u < 0.24) return 'commuter'
    if (u < 0.48) return 'resident'
    if (u < 0.66) return 'shopkeeper'
    if (u < 0.78) return 'tourist'
    if (u < 0.90) return 'night_owl'
    return 'runner'
  }
  if (u < 0.42) return 'resident'
  if (u < 0.60) return 'commuter'
  if (u < 0.76) return 'runner'
  if (u < 0.86) return 'night_owl'
  if (u < 0.94) return 'shopkeeper'
  return 'tourist'
}

/**
 * District-clocked daily routine profile for one resident at `(hour, rain)`.
 * Anchored deterministically to `(seed, busy, phase, wet)` so routes & plans stay continuous.
 */
export function routineOf(seed, busy, hour, rain = 0) {
  const archetype = archetypeOf(seed, busy)
  const phase = schedulePhase(hour)
  const wet = rain > 0.3
  const baseDistrict = homeHours(hour) + (hourly(SHOPS, hour) - homeHours(hour)) * Math.min(1, busy / 60)
  const archCurve = hourly(ARCHETYPE_HOURS[archetype], hour)
  // Blend archetype schedule with district curve; rain slightly reduces casual outdoor turnout.
  let presence = baseDistrict * 0.45 + archCurve * 0.55
  if (wet) presence *= archetype === 'commuter' || archetype === 'shopkeeper' ? 0.92 : 0.78
  presence = Math.max(0.02, Math.min(1, presence))

  // Weather shelter shift when rain > 0.3 (most people hurry toward covered/busy storefronts).
  const shelter = wet && !(archetype === 'runner' && chance(seed, 402) < 0.25)
  const umbrella = wet && chance(seed, 30) < (shelter ? 0.68 : 0.45)

  let activity = 'walking'
  let speedScale = 1
  let dwellScale = 1
  let destinationBias = 'balanced'

  if (shelter) {
    activity = 'seeking_shelter'
    speedScale = archetype === 'runner' ? 1.38 : 1.2
    dwellScale = 1.35
    destinationBias = 'covered_storefront'
  } else if (archetype === 'commuter') {
    if (phase === 'morning_commute') { activity = 'commuting_to_work'; speedScale = 1.18; dwellScale = 0.55; destinationBias = 'transit_hub' }
    else if (phase === 'work_day') { activity = 'midday_errand'; speedScale = 1.02; dwellScale = 0.95; destinationBias = 'commercial' }
    else if (phase === 'evening_commute') { activity = 'commuting_home'; speedScale = 1.12; dwellScale = 0.7; destinationBias = 'residential' }
    else if (phase === 'nightlife') { activity = 'evening_dinner'; speedScale = 0.92; dwellScale = 1.25; destinationBias = 'nightlife' }
    else { activity = 'late_return'; speedScale = 0.96; dwellScale = 0.65; destinationBias = 'residential' }
  } else if (archetype === 'shopkeeper') {
    if (phase === 'morning_commute') { activity = 'opening_shop'; speedScale = 0.98; dwellScale = 1.3; destinationBias = 'commercial' }
    else if (phase === 'work_day') { activity = 'tending_storefront'; speedScale = 0.9; dwellScale = 1.45; destinationBias = 'commercial' }
    else if (phase === 'evening_commute') { activity = 'closing_shop'; speedScale = 1.0; dwellScale = 1.1; destinationBias = 'commercial' }
    else if (phase === 'nightlife') { activity = 'evening_stroll'; speedScale = 0.88; dwellScale = 1.2; destinationBias = 'commercial' }
    else { activity = 'early_delivery'; speedScale = 1.02; dwellScale = 0.85; destinationBias = 'commercial' }
  } else if (archetype === 'tourist') {
    if (phase === 'morning_commute') { activity = 'morning_sightseeing'; speedScale = 0.86; dwellScale = 1.35; destinationBias = 'scenic' }
    else if (phase === 'work_day') { activity = 'sightseeing'; speedScale = 0.82; dwellScale = 1.5; destinationBias = 'scenic' }
    else if (phase === 'evening_commute') { activity = 'dinner_browse'; speedScale = 0.86; dwellScale = 1.35; destinationBias = 'commercial' }
    else if (phase === 'nightlife') { activity = 'night_sightseeing'; speedScale = 0.84; dwellScale = 1.3; destinationBias = 'nightlife' }
    else { activity = 'returning_to_hotel'; speedScale = 0.95; dwellScale = 0.8; destinationBias = 'commercial' }
  } else if (archetype === 'runner') {
    if (phase === 'morning_commute') { activity = 'morning_jog'; speedScale = 1.55; dwellScale = 0.25; destinationBias = 'scenic' }
    else if (phase === 'work_day') { activity = 'midday_run'; speedScale = 1.48; dwellScale = 0.3; destinationBias = 'scenic' }
    else if (phase === 'evening_commute') { activity = 'evening_jog'; speedScale = 1.52; dwellScale = 0.25; destinationBias = 'scenic' }
    else if (phase === 'nightlife') { activity = 'cooldown_walk'; speedScale = 1.04; dwellScale = 0.65; destinationBias = 'residential' }
    else { activity = 'early_run'; speedScale = 1.5; dwellScale = 0.25; destinationBias = 'scenic' }
  } else if (archetype === 'night_owl') {
    if (phase === 'morning_commute') { activity = 'morning_coffee'; speedScale = 0.88; dwellScale = 1.25; destinationBias = 'commercial' }
    else if (phase === 'work_day') { activity = 'afternoon_browse'; speedScale = 0.92; dwellScale = 1.15; destinationBias = 'commercial' }
    else if (phase === 'evening_commute') { activity = 'heading_out'; speedScale = 1.04; dwellScale = 0.9; destinationBias = 'nightlife' }
    else if (phase === 'nightlife') { activity = 'nightlife_crawl'; speedScale = 0.98; dwellScale = 1.25; destinationBias = 'nightlife' }
    else { activity = 'late_night_walk'; speedScale = 0.94; dwellScale = 1.0; destinationBias = 'nightlife' }
  } else {
    if (phase === 'morning_commute') { activity = 'morning_errand'; speedScale = 1.0; dwellScale = 0.9; destinationBias = 'commercial' }
    else if (phase === 'work_day') { activity = 'neighborhood_walk'; speedScale = 0.94; dwellScale = 1.15; destinationBias = 'residential' }
    else if (phase === 'evening_commute') { activity = 'evening_walk'; speedScale = 0.96; dwellScale = 1.05; destinationBias = 'residential' }
    else if (phase === 'nightlife') { activity = 'evening_stroll'; speedScale = 0.9; dwellScale = 1.15; destinationBias = 'residential' }
    else { activity = 'quiet_walk'; speedScale = 0.92; dwellScale = 0.85; destinationBias = 'residential' }
  }

  return { archetype, phase, activity, shelter, umbrella, speedScale, dwellScale, destinationBias, presence }
}

function seg(p, i, into) {
  const dx = p[2 * i + 2] - p[2 * i]
  const dz = p[2 * i + 3] - p[2 * i + 1]
  const l = Math.hypot(dx, dz) || 1
  into.tx = dx / l
  into.tz = dz / l
}

/** Where along a polyline a distance `s` falls, and its unit tangent `(tx, tz)`. */
export function along(p, cum, s, into) {
  const n = cum.length
  if (n < 2) { into.x = p[0]; into.z = p[1]; into.tx = 1; into.tz = 0; return 0 }
  if (s <= 0) { into.x = p[0]; into.z = p[1]; seg(p, 0, into); return 0 }
  if (s >= cum[n - 1]) { into.x = p[2 * n - 2]; into.z = p[2 * n - 1]; seg(p, n - 2, into); return n - 2 }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m }
  const f = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])
  into.x = p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f
  into.z = p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f
  seg(p, lo, into)
  return lo
}

function decodeLine(flat, from) {
  const n = (flat.length - from) >> 1
  const p = new Float64Array(n * 2)
  const cum = new Float64Array(n)
  for (let i = 0; i < n * 2; i++) p[i] = flat[from + i]
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1])
  return { p, cum, len: cum[n - 1] }
}

function polylineBox(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i]
    if (p[i] > x1) x1 = p[i]
    if (p[i + 1] < z0) z0 = p[i + 1]
    if (p[i + 1] > z1) z1 = p[i + 1]
  }
  return [x0, z0, x1, z1]
}

/** Which of a junction's two phases a crossing direction belongs to: main axis (0) or cross axis (1). */
export const phaseOf = (j, dx, dz) => (Math.abs(dx * j.ax + dz * j.az) >= Math.SQRT1_2 ? 0 : 1)

/** Seconds into a junction's 60 s cycle at world clock time `t`. */
export const cycleAt = (j, t) => (((t + j.offset) % CYCLE) + CYCLE) % CYCLE

/** Traffic/pedestrian light state for direction `(dx, dz)` at junction `j` at time `t`. */
export function lightFor(j, dx, dz, t) {
  const u = cycleAt(j, t) - phaseOf(j, dx, dz) * (CYCLE / 2)
  return u >= 0 && u < GREEN ? 'green' : u >= GREEN && u < GREEN + AMBER ? 'amber' : 'red'
}

/**
 * Creates a deterministic SF pedestrian walk-graph evaluator.
 * Both `engine/world.mjs` (Node) and `engine/page/street.ts` (browser) instantiate this
 * and feed it the same `life/*.json` squares via `addSquare(name, data)`.
 */
export function createWalkGraph() {
  const GRID = 1000
  const walks = []
  const nodes = new Map()
  const walkGrid = new Map()
  /** Road approaches into each junction node (lightweight subset of life.roads for deterministic signal phase). */
  const roadsTo = new Map()
  const junctions = new Map()
  const routes = new Map()
  const squares = new Set()
  /** O(1) lookup from resident seed -> `{ wi, h }` (plus array on rare hash collision). */
  const bySeed = new Map()
  const cellKey = (gx, gz) => gx * 100003 + gz

  const fileGrid = (x0, z0, x1, z1, wi) => {
    for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
      for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) {
        const k = cellKey(gx, gz)
        let list = walkGrid.get(k)
        if (!list) walkGrid.set(k, (list = []))
        list.push(wi)
      }
    }
  }

  /** Sort comparator ensuring order-independent walk adjacency regardless of square load order. */
  const cmpWalkIndex = (i, j) => {
    const a = walks[i], b = walks[j]
    return (a.a - b.a) || (a.b - b.b) || (a.seed - b.seed) || (a.mx - b.mx) || (a.mz - b.mz)
  }

  /**
   * Ingests one `life/<square>.json` object (idempotent by square name).
   * Accepts `{ walk, roads? }`. Clears route & junction caches so seam junctions are re-timed cleanly.
   */
  function addSquare(name, data) {
    if (!data || squares.has(name)) return false
    squares.add(name)
    const touchedNodes = new Set()
    for (const w of data.walk ?? []) {
      const hasSignal = (w.length & 1) === 1
      const a = w[0], b = w[1], kind = w[2], busy = w[3], signal = hasSignal ? w[4] : 0
      const { p, cum, len } = decodeLine(w, hasSignal ? 5 : 4)
      if (len < 1) continue
      const per = kind === 1 ? 0 : kind === 2 ? 0.4 : 0.5 + 0.045 * busy
      const seed = mix(idSeed(a), idSeed(b))
      const homes = Math.floor((len / 1000) * per + chance(seed, 9))
      const mx = (p[0] + p[p.length - 2]) / 2
      const mz = (p[1] + p[p.length - 1]) / 2
      const wi = walks.push({ a, b, kind, busy, signal, p, cum, len, homes, seed, mx, mz }) - 1
      for (const [id, x, z] of [[a, p[0], p[1]], [b, p[p.length - 2], p[p.length - 1]]]) {
        let node = nodes.get(id)
        if (!node) nodes.set(id, (node = { x, z, walks: [] }))
        node.walks.push(wi)
        touchedNodes.add(id)
      }
      const [x0, z0, x1, z1] = polylineBox(p)
      fileGrid(x0, z0, x1, z1, wi)
      for (let h = 0; h < homes; h++) {
        const s = mix(seed, h)
        const existing = bySeed.get(s)
        if (!existing) bySeed.set(s, { wi, h })
        else if (Array.isArray(existing)) existing.push({ wi, h })
        else bySeed.set(s, [existing, { wi, h }])
      }
    }
    // Keep node adjacency order-independent across arbitrary square loading sequences.
    for (const id of touchedNodes) {
      const n = nodes.get(id)
      if (n && n.walks.length > 1) n.walks.sort(cmpWalkIndex)
    }
    const tmp = { x: 0, z: 0, tx: 1, tz: 0 }
    for (const r of data.roads ?? []) {
      const hasCtl = ((r.length - 7) & 1) === 0 && r.length >= 11
      const way = r[0], a = r[1], b = r[2], flags = r[4], ctl = hasCtl ? r[6] : 0
      const { p, cum, len } = decodeLine(r, hasCtl ? 7 : 6)
      if (len < 1) continue
      along(p, cum, len, tmp)
      let ins = roadsTo.get(b)
      if (!ins) roadsTo.set(b, (ins = []))
      ins.push({ way, a, b, cls: flags >> 4, len, tx: tmp.tx, tz: tmp.tz, x: tmp.x, z: tmp.z, ctl })
    }
    routes.clear()
    junctions.clear()
    return true
  }

  function junctionOf(node) {
    let j = junctions.get(node)
    if (j) return j
    const ins = roadsTo.get(node) ?? []
    const main = [...ins].sort((a, b) => (b.cls - a.cls) || (b.len - a.len) || (a.way - b.way) || (a.a - b.a))[0]
    const ax = main ? main.tx : 1
    const az = main ? main.tz : 0
    const x = main ? main.x : 0
    const z = main ? main.z : 0
    j = { x, z, ax, az, offset: chance(idSeed(node), 11) * CYCLE, lights: ins.some((r) => r.ctl >= 2) }
    junctions.set(node, j)
    return j
  }

  const updateRouteBox = (r) => {
    const p = r.p
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], z = p[i + 1]
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (z < z0) z0 = z; if (z > z1) z1 = z
    }
    r.x0 = x0; r.z0 = z0; r.x1 = x1; r.z1 = z1
  }

  const cutAt = (r, cut) => {
    const P2 = { x: 0, z: 0, tx: 0, tz: 0 }
    const at = r.cum.findIndex((c) => c >= cut)
    if (at <= 0) return
    along(r.p, r.cum, cut, P2)
    r.p.length = at * 2
    r.cum.length = at
    r.kinds.length = at - 1
    r.sigs.length = at - 1
    r.p.push(P2.x, P2.z)
    r.cum.push(cut)
    r.kinds.push(0)
    r.sigs.push(0)
    r.len = cut
    r.crossings = r.crossings.filter((c) => c.s1 <= cut)
    r.P = Float64Array.from(r.p)
    r.C = Float64Array.from(r.cum)
    r.destX = P2.x
    r.destZ = P2.z
    updateRouteBox(r)
  }

  /** Edge preference weight modulated by district-clocked destination bias. */
  const edgeWeight = (e, straight, bias) => {
    const dir = 0.25 + Math.max(0, straight) * 1.5
    if (bias === 'covered_storefront') {
      if (e.kind === 1) return 0.35 * dir
      if (e.kind === 2) return 0.12 * dir
      if (e.kind === 3) return 0.25 * dir
      return (1 + e.busy / 18) * dir
    }
    if (bias === 'transit_hub' || bias === 'commercial' || bias === 'nightlife') {
      const base = e.kind === 1 ? 0.45 : e.kind === 2 ? 0.25 : 1 + e.busy / 22
      return base * dir
    }
    if (bias === 'residential') {
      const base = e.kind === 1 ? 0.38 : e.kind === 2 ? 0.35 : 1 + (100 - e.busy) / 55
      return base * dir
    }
    if (bias === 'scenic') {
      const base = e.kind === 1 ? 0.45 : e.kind === 2 ? 0.85 : e.kind === 3 ? 1.55 : 1 + e.busy / 45
      return base * dir
    }
    return (e.kind === 1 ? 0.45 : e.kind === 2 ? 0.35 : 1 + e.busy / 40) * dir
  }

  /** Builds or retrieves a deterministic origin -> destination walk route for round `k` and `bias`. */
  function routeOf(wi, u, seed, k, want, bias) {
    const w = walks[wi]
    const key = `${seed}:${k}:${bias}`
    let r = routes.get(key)
    if (r) { r.used = k; return r }
    if (routes.size > 12000) {
      let n = 0
      for (const rk of routes.keys()) { routes.delete(rk); if (++n > 3000) break }
    }
    r = {
      p: [], cum: [0], kinds: [], sigs: [], len: 0, used: k,
      P: new Float64Array(0), C: new Float64Array(0),
      crossings: [], plans: new Map(),
      originX: 0, originZ: 0, destX: 0, destZ: 0, destBusy: w.busy,
      x0: 0, z0: 0, x1: 0, z1: 0,
    }
    const P = { x: 0, z: 0, tx: 0, tz: 0 }
    along(w.p, w.cum, u, P)
    r.originX = P.x
    r.originZ = P.z
    r.p.push(P.x, P.z)
    const push = (x, z, kind, sig = 0) => {
      const px = r.p[r.p.length - 2], pz = r.p[r.p.length - 1], d = Math.hypot(x - px, z - pz)
      if (d < 0.5) return
      r.p.push(x, z); r.len += d; r.cum.push(r.len); r.kinds.push(kind); r.sigs.push(sig)
    }
    let edge = wi
    const forward = chance(seed, 40 + k * 7) < 0.5
    let node = forward ? w.b : w.a
    const n0 = w.cum.length
    if (forward) {
      for (let i = 0; i < n0; i++) if (w.cum[i] > u) push(w.p[2 * i], w.p[2 * i + 1], w.kind, w.signal)
    } else {
      for (let i = n0 - 1; i >= 0; i--) if (w.cum[i] < u) push(w.p[2 * i], w.p[2 * i + 1], w.kind, w.signal)
    }
    let lastBusy = w.busy
    for (let step = 0; r.len < want && step < 40; step++) {
      const here = nodes.get(node)
      if (!here) break
      const last = r.p.length
      if (last < 4) break
      const hx = r.p[last - 2] - r.p[last - 4], hz = r.p[last - 1] - r.p[last - 3], hl = Math.hypot(hx, hz) || 1
      let total = 0
      const options = []
      for (const j of here.walks) {
        if (j === edge && here.walks.length > 1) continue
        const e = walks[j]
        const out = e.a === node
        const nx = out ? e.p[2] - e.p[0] : e.p[e.p.length - 4] - e.p[e.p.length - 2]
        const nz = out ? e.p[3] - e.p[1] : e.p[e.p.length - 3] - e.p[e.p.length - 1]
        const straight = (hx * nx + hz * nz) / (hl * (Math.hypot(nx, nz) || 1))
        const like = edgeWeight(e, straight, bias)
        options.push([j, like])
        total += like
      }
      if (!options.length) break
      let pick = chance(seed, 1000 + k * 53 + step) * total
      let j = options[0][0]
      for (const [o, like] of options) { pick -= like; if (pick <= 0) { j = o; break } }
      const e = walks[j], out = e.a === node, n = e.cum.length
      for (let i = 1; i < n; i++) {
        const at = out ? i : n - 1 - i
        push(e.p[2 * at], e.p[2 * at + 1], e.kind, e.signal)
      }
      if (e.kind !== 1) lastBusy = e.busy
      edge = j
      node = out ? e.b : e.a
    }
    // Cut to target trip length, never ending on a crossing (kind 1).
    let goalLen = want
    if (r.len > goalLen) {
      let i = r.cum.findIndex((c) => c >= goalLen) - 1
      if (r.kinds[i] === 1) {
        while (i > 0 && r.kinds[i - 1] === 1) i--
        goalLen = Math.max(1, r.cum[i] - 10)
      }
    }
    if (r.len > goalLen) {
      const P2 = { x: 0, z: 0, tx: 0, tz: 0 }
      const i = r.cum.findIndex((c) => c >= goalLen)
      if (i > 0) {
        along(r.p, r.cum, goalLen, P2)
        const kind = r.kinds[i - 1] ?? 0
        r.p.length = i * 2; r.cum.length = i; r.kinds.length = i - 1; r.sigs.length = i - 1
        r.p.push(P2.x, P2.z); r.cum.push(goalLen); r.kinds.push(kind); r.sigs.push(0); r.len = goalLen
      }
    }
    // Group contiguous signalised crossings (at most 2 per walk).
    for (let i = 0; i < r.sigs.length;) {
      if (r.kinds[i] !== 1) { i++; continue }
      let j = i
      while (j + 1 < r.kinds.length && r.kinds[j + 1] === 1) j++
      let sigNode = 0
      for (let m = i; m <= j && !sigNode; m++) if (r.sigs[m] && roadsTo.get(r.sigs[m])?.length) sigNode = r.sigs[m]
      if (!sigNode) { i = j + 1; continue }
      const dx = r.p[2 * j + 2] - r.p[2 * i], dz = r.p[2 * j + 3] - r.p[2 * i + 1], l = Math.hypot(dx, dz) || 1
      if (r.crossings.length === 2) { cutAt(r, Math.max(1, r.cum[i] - 10)); break }
      r.crossings.push({ s0: r.cum[i], s1: r.cum[j + 1], node: sigNode, dx: dx / l, dz: dz / l })
      i = j + 1
    }
    r.P = Float64Array.from(r.p)
    r.C = Float64Array.from(r.cum)
    r.destX = r.p[r.p.length - 2] ?? r.originX
    r.destZ = r.p[r.p.length - 1] ?? r.originZ
    r.destBusy = lastBusy
    updateRouteBox(r)
    routes.set(key, r)
    return r
  }

  /** Plans signal-timed outbound and return legs for route `r` so crossings never occur on red. */
  function planOf(r, v0, T, rest, start) {
    const leg = (from, forward, t0, v = v0) => {
      const pts = [0, from]
      let t = 0, s = from
      const order = forward ? r.crossings : [...r.crossings].reverse()
      for (const c of order) {
        const entry = forward ? Math.max(s, c.s0 - 8) : Math.min(s, c.s1 + 8)
        t += Math.abs(entry - s) / v; s = entry; pts.push(t, s)
        const j = junctionOf(c.node), across = (c.s1 - c.s0) / v
        const ws = phaseOf(j, c.dx, c.dz) * (CYCLE / 2)
        const last = Math.max(ws, Math.min(ws + WALK, ws + GREEN - across))
        const u = cycleAt(j, start + t0 + t)
        const wait = u >= ws && u <= last ? 0 : ((ws - u) % CYCLE + CYCLE) % CYCLE
        if (wait > 0) { t += wait; pts.push(t, s) }
        const exit = forward ? c.s1 : c.s0
        const gone = (((cycleAt(j, start + t0 + t) - ws) % CYCLE) + CYCLE) % CYCLE
        t += Math.min(Math.abs(exit - s) / v, Math.max(4, GREEN + AMBER - 1 - gone))
        s = exit
        pts.push(t, s)
      }
      const end = forward ? r.len : 0
      t += Math.abs(end - s) / v
      pts.push(t, end)
      return pts
    }
    const out = leg(0, true, 0), outEnd = out[out.length - 2]
    let backAt = Math.max(outEnd + 3, T - rest - (r.len / v0) * 1.15)
    let back = leg(r.len, false, backAt)
    for (let n = 0; n < 3 && backAt + back[back.length - 2] > T - rest; n++) {
      backAt = Math.max(outEnd + 2, T - rest - back[back.length - 2])
      back = leg(r.len, false, backAt)
    }
    for (let fast = 1.25; backAt + back[back.length - 2] > T - 1 && fast < 3; fast *= 1.25) {
      back = leg(r.len, false, backAt, v0 * fast)
    }
    const room = T - 1 - backAt, took = back[back.length - 2]
    if (took > room && r.crossings.length) return null
    if (took > room) for (let i = 0; i < back.length; i += 2) back[i] *= room / took
    return { out, back, outEnd, backAt, backEnd: backAt + Math.min(took, room) }
  }

  const FOLLOW = { s: 0, waiting: false, walking: 0 }
  function follow(pts, t) {
    let i = 0
    while (i + 2 < pts.length - 1 && pts[i + 2] <= t) i += 2
    const t0 = pts[i], s0 = pts[i + 1], t1 = pts[i + 2] ?? t0, s1 = pts[i + 3] ?? s0
    const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 1
    FOLLOW.s = s0 + (s1 - s0) * f
    FOLLOW.waiting = s1 === s0 && t1 > t0
    FOLLOW.walking = FOLLOW.waiting ? 0 : ease(Math.min(t - t0, t1 - t) / 0.7)
    return FOLLOW
  }

  // Scratch records to keep hot-loop allocations zero.
  const R = { x: 0, z: 0, tx: 0, tz: 0 }
  const A1 = { x: 0, z: 0, tx: 0, tz: 0 }, B1 = { x: 0, z: 0, tx: 0, tz: 0 }
  const A3 = { x: 0, z: 0, tx: 0, tz: 0 }, B3 = { x: 0, z: 0, tx: 0, tz: 0 }

  /**
   * Evaluates one pedestrian's exact deterministic state at `(wi, seed, t, hour, rain)` into `out`.
   * Produces bit-for-bit identical `(x, z, yaw, speed, stride, phase, home, seed, activity, archetype)`
   * across Node and browser. Optional `clip = [eyeX, eyeZ, reach]` returns `null` early when the
   * cached route AABB cannot intersect `[eyeX ± reach, eyeZ ± reach]` (skips `planOf`/`along`).
   */
  function placeOf(wi, seed, t, hour = 11, rain = 0, out = {}, clip = null) {
    const w = walks[wi]
    const routine = routineOf(seed, w.busy, hour, rain)
    const T = 180 + 180 * chance(seed, 1)
    const baseSpeed = 11 + 4 * chance(seed, 2)
    const v = Math.max(8, Math.min(26, baseSpeed * routine.speedScale))
    const u = t + chance(seed, 3) * T
    const k = Math.floor(u / T)
    const tau = u - k * T
    const homePos = (0.05 + 0.9 * chance(seed, 4)) * w.len
    const rawRest = (10 + 30 * chance(seed, 5 + k * 3)) * routine.dwellScale
    const rest = Math.max(6, Math.min(68, rawRest))
    const wantScale = routine.shelter ? 0.78 : routine.archetype === 'runner' ? 1.15 : 1
    const want = Math.max(180, Math.min(WALK_MOST, ((v * (T - rest - 15 - 90)) / 2) * wantScale))
    const r = routeOf(wi, homePos, seed, k, want, routine.destinationBias)
    if (clip) {
      const pad = clip[2] + 20
      if (r.x1 < clip[0] - pad || r.x0 > clip[0] + pad || r.z1 < clip[1] - pad || r.z0 > clip[1] + pad) return null
    }
    const planKey = `${routine.phase}:${routine.shelter ? 1 : 0}`
    let plan = r.plans.get(planKey)
    while (!plan) {
      const p = planOf(r, v, T, rest, k * T - chance(seed, 3) * T)
      if (p) { r.plans.set(planKey, (plan = p)); break }
      if (!r.crossings.length) {
        // Fallback degenerate plan if route has zero length.
        plan = { out: [0, 0], back: [0, 0], outEnd: 0, backAt: T * 0.5, backEnd: T * 0.5 }
        r.plans.set(planKey, plan)
        break
      }
      cutAt(r, Math.max(1, r.crossings[r.crossings.length - 1].s0 - 10))
      r.plans.clear()
    }

    let s = 0, back = false, stood = 0, waiting = false, still = false, far = false, walking = 0, walkDist = 0, pause = 0
    if (tau < plan.outEnd) {
      const at = follow(plan.out, tau)
      s = at.s; waiting = at.waiting; walking = at.walking; walkDist = s
    } else if (tau < plan.backAt) {
      s = r.len; still = true; far = true; stood = tau - plan.outEnd; pause = plan.backAt - plan.outEnd; walking = 0; walkDist = r.len
    } else if (tau < plan.backEnd) {
      const at = follow(plan.back, tau - plan.backAt)
      s = at.s; waiting = at.waiting; back = true; walking = at.walking; walkDist = 2 * r.len - s
    } else {
      s = 0; still = true; stood = tau - plan.backEnd; pause = T - plan.backEnd; walking = 0; walkDist = 2 * r.len
    }

    const P = r.P, C = r.C
    const segment = along(P, C, s, R)
    let hx = R.tx, hz = R.tz
    if (back) { hx = -hx; hz = -hz }
    along(P, C, s - 6, A1); along(P, C, s + 6, B1)
    if (Math.hypot(B1.x - A1.x, B1.z - A1.z) > 1) {
      hx = (B1.x - A1.x) * (back ? -1 : 1)
      hz = (B1.z - A1.z) * (back ? -1 : 1)
      const l = Math.hypot(hx, hz)
      hx /= l; hz /= l
    }
    const kind = r.kinds[segment] ?? 0
    const crossing = kind === 1 && !waiting
    const on = crossing ? r.crossings.find((c) => s >= c.s0 - 1 && s <= c.s1 + 1) : undefined

    let toCrossing = Infinity
    for (let j = Math.max(0, segment - 6); j < Math.min(r.kinds.length, segment + 7); j++) {
      if (r.kinds[j] === 1) toCrossing = Math.min(toCrossing, s < C[j] ? C[j] - s : s > C[j + 1] ? s - C[j + 1] : 0)
    }
    const side = 3 + (2 + 5 * chance(seed, 6)) * ease(toCrossing / 20)
    let lateral = back ? -side : side
    if (still) {
      const f = ease(Math.min((stood - 2) / 4, stood / Math.max(0.5, pause - 0.2)))
      lateral = far ? side * (1 - 2 * f) : -side * (1 - 2 * f)
    }
    lateral *= still && !far ? 0 : ease(s / 30)
    along(P, C, s - 15, A3); along(P, C, s + 15, B3)
    let nx = B3.x - A3.x, nz = B3.z - A3.z
    const nl = Math.hypot(nx, nz)
    if (nl > 1) { nx /= nl; nz /= nl } else { nx = R.tx; nz = R.tz }
    lateral *= Math.min(1, (nl / 30) ** 2)
    const x = R.x - nz * lateral
    const z = R.z + nx * lateral
    if (still) {
      const turn = ease((stood - 1) / 1.5) * ease((pause - stood - 0.3) / 1.2) * (chance(seed, 7 + k) < 0.5 ? 1 : -1) * Math.PI / 2
      const c = Math.cos(turn), sn = Math.sin(turn)
      const nhx = hx * c - hz * sn, nhz = hx * sn + hz * c
      hx = nhx; hz = nhz
    }

    let activity = routine.activity
    if (waiting) activity = 'waiting_for_signal'
    else if (still && far) activity = routine.shelter ? 'sheltering' : (routine.archetype === 'tourist' || routine.archetype === 'shopkeeper' ? 'browsing_storefront' : 'at_destination')
    else if (still) activity = routine.shelter ? 'sheltering' : 'pausing_home'

    out.seed = seed
    out.id = residentId(seed)
    out.x = x
    out.z = z
    out.hx = hx
    out.hz = hz
    out.yaw = Math.atan2(hx, -hz)
    out.speed = v
    out.s = walkDist
    out.stride = walkDist / STRIDE
    out.walking = walking
    out.still = still
    out.far = far
    out.stood = stood
    out.pause = pause
    out.waiting = waiting
    out.crossing = crossing
    out.kind = kind
    out.sig = on ? on.node : 0
    out.cdx = on ? on.dx : 0
    out.cdz = on ? on.dz : 0
    out.phase = routine.phase
    out.archetype = routine.archetype
    out.activity = activity
    out.shelter = routine.shelter
    out.umbrella = routine.umbrella
    out.destinationBias = routine.destinationBias
    out.originX = r.originX
    out.originZ = r.originZ
    out.destX = r.destX
    out.destZ = r.destZ
    out.round = k
    return out
  }

  const SHOCK_SCRATCH = {}
  const SHOCK_CLIP = [0, 0, 0]

  /** Evaluates startle (blast or crash shock) on one pedestrian at `(wi, seed, t)`. */
  function startleOf(wi, seed, t, hour, rain, shocks, crashShocks, feetAt, out = {}) {
    out.when = t; out.down = 0; out.flinch = 0; out.towards = 0; out.turned = 0; out.frozen = false
    const w = walks[wi]
    const maxWalkReach = w.len * 0.5 + WALK_MOST + 25
    const checkList = (list, crash) => {
      for (let k = list.length - 1; k >= 0; k--) {
        const shock = list[k], age = t - shock.t
        if (age < 0 || age > (crash ? 18 : 45)) continue
        const reach = crash ? shock.radius * 4 + 50 : shock.radius * 6 + 60
        const close = crash ? 28 : shock.radius * 2.5 + 10
        const maxR = Math.max(reach, close)
        if (Math.abs(w.mx - shock.at[0]) > maxWalkReach + maxR || Math.abs(w.mz - shock.at[2]) > maxWalkReach + maxR) continue
        SHOCK_CLIP[0] = shock.at[0]; SHOCK_CLIP[1] = shock.at[2]; SHOCK_CLIP[2] = maxR
        if (!placeOf(wi, seed, shock.t, hour, rain, SHOCK_SCRATCH, SHOCK_CLIP)) continue
        const sy = feetAt ? feetAt(SHOCK_SCRATCH.x, SHOCK_SCRATCH.z) + 9 : (shock.at[1] ?? 0)
        const far = Math.hypot(SHOCK_SCRATCH.x - shock.at[0], SHOCK_SCRATCH.z - shock.at[2], sy - shock.at[1])
        const isClose = far < close
        if (!isClose && far >= reach) continue
        const held = isClose ? (crash ? 2.4 : 4.4) + 1.4 * chance(seed, 31) : (crash ? 0.9 : 1.2) + 0.8 * chance(seed, 31)
        if (age < held) {
          out.when = shock.t; out.frozen = true
          if (isClose) {
            out.down = ease(age / 0.3) * (1 - ease((age - held + 1.2) / 1.2))
            out.turned = ease(age / 0.3)
          } else {
            out.flinch = ease(age / 0.12) * (1 - ease((age - held + 0.6) / 0.6))
            if (crash) out.turned = ease(age / 0.2) * (1 - ease((age - held + 0.6) / 0.6)) * 0.85
          }
          out.towards = Math.atan2(shock.at[0] - SHOCK_SCRATCH.x, -(shock.at[2] - SHOCK_SCRATCH.z))
        } else {
          out.when = Math.min(t, shock.t + (age - held) * 1.7)
        }
        return true
      }
      return false
    }
    if (shocks?.length && checkList(shocks, false)) return out
    if (crashShocks?.length) checkList(crashShocks, true)
    return out
  }

  /** Resolves a resident's walk index `wi` and home slot `h` by `seed` (and optional `home = [mx, mz, h]`). */
  function findResident(seed, home) {
    const hit = bySeed.get(seed)
    if (hit) {
      if (!Array.isArray(hit)) return hit
      if (home && home.length >= 3) {
        let best = hit[0], bestD = Infinity
        for (const cand of hit) {
          const w = walks[cand.wi]
          const d = Math.hypot(w.mx - home[0], w.mz - home[1]) + Math.abs(cand.h - home[2]) * 10
          if (d < bestD) { bestD = d; best = cand }
        }
        return best
      }
      return hit[0]
    }
    return null
  }

  /**
   * Instantaneous whereabouts of a single SF resident by `seed` and `home` (`[mx, mz, h]`) at `(t, hour, rain)`.
   * Used by `world.mjs` for zero-teleport `take()` and smooth `goingBack()` return.
   */
  function whereabouts(seed, home, t, hour = 11, rain = 0, opts = {}) {
    const found = findResident(seed, home)
    if (!found) return null
    const w = walks[found.wi]
    const st = opts.shocks?.length || opts.crashShocks?.length
      ? startleOf(found.wi, seed, t, hour, rain, opts.shocks, opts.crashShocks, opts.feetAt)
      : { when: t, down: 0, flinch: 0, towards: 0, turned: 0, frozen: false }
    const ev = placeOf(found.wi, seed, st.when, hour, rain)
    let yaw = ev.yaw
    if (st.turned) {
      let by = st.towards - yaw
      by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2
      yaw += by * st.turned
    }
    const y = opts.feetAt
      ? (opts.feetAt(ev.x + ev.hx * 2, ev.z + ev.hz * 2) + opts.feetAt(ev.x - ev.hx * 2, ev.z - ev.hz * 2) + opts.feetAt(ev.x, ev.z)) / 3
      : 0
    return {
      ...ev,
      yaw,
      at: [ev.x, y, ev.z],
      home: [Math.round(w.mx), Math.round(w.mz), found.h],
      down: st.down,
      flinch: st.flinch,
      frozen: st.frozen,
      walking: st.frozen ? 0 : ev.walking,
    }
  }

  let scanStamp = 1
  const walkStamp = new Map()
  const seenWalks = []

  /**
   * Queries all active SF pedestrians within `reach` cells of `eye = [x, z]`,
   * applying District-Clocked Daily Routines, `taken` suppression, and Three-Ring AI LOD classification + caps.
   */
  function query(eye, opts = {}) {
    const reach = opts.reach ?? RING3_RADIUS
    const t = opts.t ?? 0
    const hour = opts.hour ?? 11
    const rain = opts.rain ?? 0
    const taken = opts.taken
    const shocks = opts.shocks
    const crashShocks = opts.crashShocks
    const feetAt = opts.feetAt
    const timeOf = opts.timeOf
    const caps = opts.caps ?? DEFAULT_RING_CAPS
    const applyCaps = opts.applyCaps !== false

    scanStamp++
    seenWalks.length = 0
    const far = reach + WALK_MOST
    const gx0 = Math.floor((eye[0] - far) / GRID), gx1 = Math.floor((eye[0] + far) / GRID)
    const gz0 = Math.floor((eye[1] - far) / GRID), gz1 = Math.floor((eye[1] + far) / GRID)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const list = walkGrid.get(cellKey(gx, gz))
        if (!list) continue
        for (let idx = 0; idx < list.length; idx++) {
          const wi = list[idx]
          if (walkStamp.get(wi) !== scanStamp) { walkStamp.set(wi, scanStamp); seenWalks.push(wi) }
        }
      }
    }

    const candidates = []
    let suppressedTaken = 0
    const shockState = { when: 0, down: 0, flinch: 0, towards: 0, turned: 0, frozen: false }
    // Pre-filter shocks once per query so expired or far-away shocks never invoke per-resident startle work.
    const activeShocks = shocks?.length ? shocks.filter((s) => { const a = t - s.t; return a >= 0 && a <= 45 }) : null
    const activeCrash = crashShocks?.length ? crashShocks.filter((s) => { const a = t - s.t; return a >= 0 && a <= 18 }) : null
    const hasShocks = !!((activeShocks && activeShocks.length) || (activeCrash && activeCrash.length))
    const queryClip = [eye[0], eye[1], reach]
    const evScratch = {}

    for (let sIdx = 0; sIdx < seenWalks.length; sIdx++) {
      const wi = seenWalks[sIdx]
      const w = walks[wi]
      if (!w.homes || Math.hypot(w.mx - eye[0], w.mz - eye[1]) - w.len / 2 > far) continue
      const mx = Math.round(w.mx), mz = Math.round(w.mz)
      for (let h = 0; h < w.homes; h++) {
        const seed = mix(w.seed, h)
        const routine = routineOf(seed, w.busy, hour, rain)
        if (chance(seed, 20) >= routine.presence) continue
        if (taken?.has(seed)) { suppressedTaken++; continue }
        if (hasShocks) startleOf(wi, seed, t, hour, rain, activeShocks, activeCrash, feetAt, shockState)
        else { shockState.when = t; shockState.down = 0; shockState.flinch = 0; shockState.towards = 0; shockState.turned = 0; shockState.frozen = false }
        const routeTime = timeOf ? timeOf(seed, shockState.when, shockState) : shockState.when
        if (!placeOf(wi, seed, routeTime, hour, rain, evScratch, queryClip)) continue
        const dx = evScratch.x - eye[0], dz = evScratch.z - eye[1]
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue
        const dist = Math.hypot(dx, dz)
        if (dist > reach) continue
        const lod = classifyLod(dist)
        if (lod === 0) continue

        const ev = { ...evScratch }
        let yaw = ev.yaw
        if (shockState.turned) {
          let by = shockState.towards - yaw
          by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2
          yaw += by * shockState.turned
        }
        let y = 0
        if (feetAt) {
          if (lod === 1) {
            const high = feetAt(ev.x, ev.z)
            y = (feetAt(ev.x + ev.hx * 2, ev.z + ev.hz * 2) + feetAt(ev.x - ev.hx * 2, ev.z - ev.hz * 2) + high) / 3
          } else if (lod === 2 || opts.ring3Feet) {
            y = feetAt(ev.x, ev.z)
          }
        }
        ev.yaw = yaw
        ev.at = [ev.x, y, ev.z]
        ev.home = [mx, mz, h]
        ev.wi = wi
        ev.dist = dist
        ev.lod = lod
        ev.down = shockState.down
        ev.flinch = shockState.flinch
        ev.towards = shockState.towards
        ev.turned = shockState.turned
        ev.frozen = shockState.frozen
        ev.routeTime = routeTime
        candidates.push(ev)
      }
    }

    // Nearest-first deterministic ordering so ring caps always preserve closest residents.
    candidates.sort((a, b) => (a.dist - b.dist) || (a.seed - b.seed))

    const stats = { ring1: 0, ring2: 0, ring3: 0, total: 0, capped: 0, suppressedTaken, caps: { 1: caps[1] ?? DEFAULT_RING_CAPS[1], 2: caps[2] ?? DEFAULT_RING_CAPS[2], 3: caps[3] ?? DEFAULT_RING_CAPS[3] } }
    const people = []
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      if (applyCaps) {
        if (c.lod === 1 && stats.ring1 >= stats.caps[1]) { stats.capped++; continue }
        if (c.lod === 2 && stats.ring2 >= stats.caps[2]) { stats.capped++; continue }
        if (c.lod === 3 && stats.ring3 >= stats.caps[3]) { stats.capped++; continue }
      }
      if (c.lod === 1) stats.ring1++
      else if (c.lod === 2) stats.ring2++
      else stats.ring3++
      stats.total++
      people.push(c)
    }
    return { people, stats }
  }

  /** Traces one pedestrian seed across a list of clock times (for diagnostics and tests). */
  function trace(seed, times, hour = 11, rain = 0) {
    const found = findResident(seed)
    if (!found) return null
    return times.map((t) => {
      const ev = placeOf(found.wi, seed, t, hour, rain, {})
      return {
        t,
        x: Math.round(ev.x),
        z: Math.round(ev.z),
        s: Math.round(ev.s),
        still: ev.still,
        far: ev.far,
        waiting: ev.waiting,
        crossing: ev.crossing,
        kind: ev.kind,
        walking: Math.round(ev.walking * 100) / 100,
        archetype: ev.archetype,
        phase: ev.phase,
        activity: ev.activity,
      }
    })
  }

  /**
   * Fast Ring-3 macro telemetry counter (110–300 m) that avoids building or evicting multi-segment
   * routes for distant residents just to report `lod.ring3` (#164).
   */
  function countRing3(eye, opts = {}) {
    const reach = opts.reach ?? RING3_RADIUS
    const hour = opts.hour ?? 11
    const rain = opts.rain ?? 0
    const taken = opts.taken
    const cap3 = opts.caps?.[3] ?? DEFAULT_RING_CAPS[3]
    scanStamp++
    seenWalks.length = 0
    const gx0 = Math.floor((eye[0] - reach) / GRID), gx1 = Math.floor((eye[0] + reach) / GRID)
    const gz0 = Math.floor((eye[1] - reach) / GRID), gz1 = Math.floor((eye[1] + reach) / GRID)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const list = walkGrid.get(cellKey(gx, gz))
        if (!list) continue
        for (let idx = 0; idx < list.length; idx++) {
          const wi = list[idx]
          if (walkStamp.get(wi) !== scanStamp) { walkStamp.set(wi, scanStamp); seenWalks.push(wi) }
        }
      }
    }
    let count = 0
    for (let sIdx = 0; sIdx < seenWalks.length; sIdx++) {
      const w = walks[seenWalks[sIdx]]
      if (!w.homes) continue
      const d = Math.hypot(w.mx - eye[0], w.mz - eye[1])
      if (d <= RING2_RADIUS || d > reach) continue
      for (let h = 0; h < w.homes; h++) {
        const seed = mix(w.seed, h)
        const routine = routineOf(seed, w.busy, hour, rain)
        if (chance(seed, 20) >= routine.presence) continue
        if (taken?.has(seed)) continue
        if (++count >= cap3) return cap3
      }
    }
    return count
  }

  return {
    addSquare,
    hasSquare: (name) => squares.has(name),
    get squareCount() { return squares.size },
    get walkCount() { return walks.length },
    get residentCount() { return bySeed.size },
    walks,
    junctionOf,
    placeOf,
    whereabouts,
    findResident,
    query,
    countRing3,
    trace,
  }
}
