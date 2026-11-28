// Living City Traffic AI Overhaul (#164 Phase 3A):
// - Deterministic seed-derived per-driver profiles & rain/wet-surface braking coupling
// - Dynamic lane-changing clearance checks, smooth lateral overtake/return, & anti-deadlock helpers
// - Budgeted local junction detour planner around craters and stalled robotaxis (cached per road + blocked set)
// - Emergency vehicle acoustic siren cone & kerb-pulling yield solver + roof flasher light emission
// - Pedestrian-vehicle coupling: caution/rain-aware crosswalk yielding & near-miss reaction cues
import type { LocalLightSink } from './lights.ts'

export type DriverArchetype = 'cautious' | 'commuter' | 'assertive' | 'hurried' | 'delivery' | 'emergency'
export type EmergencyKind = 'police' | 'ambulance'

export interface DriverProfile {
  readonly archetype: DriverArchetype
  /** 0.4..1.4 — higher values yield earlier at crosswalks, slow more on corners/rain, and leave wider gaps. */
  readonly caution: number
  /** 0..1 — higher values accelerate briskly, merge decisively, and tolerate tighter safe gaps. */
  readonly aggression: number
  /** 0.82..1.22 — multiplier on nominal road speed limit. */
  readonly speedBias: number
  /** 1.15..1.75 — braking distance & following-gap elongation factor in heavy rain (rain > 0.2). */
  readonly rainBrakeScale: number
  /** Seconds of being blocked before honking. */
  readonly hornImpatience: number
  /** 0..1 — propensity to proactively change lanes or overtake around an obstruction. */
  readonly laneChangeWillingness: number
  /** Nominal minimum bumper-to-bumper following gap (cells, 10 cells = 1 m). */
  readonly followGapCells: number
}

export interface RainDrivingFactors {
  /** Multiplier on safe stopping distance (>= 1.0; braking deceleration scales by 1 / brakeMult). */
  readonly brakeMult: number
  /** Multiplier on desired following gap (>= 1.0). */
  readonly gapMult: number
  /** Multiplier on safe cornering speed (<= 1.0). */
  readonly cornerSpeedScale: number
  /** Multiplier on cruise speed (<= 1.0). */
  readonly topSpeedScale: number
}

export interface TrafficRoad {
  readonly key: string
  readonly way: number
  readonly a: number
  readonly b: number
  readonly lanes: number
  readonly flags: number
  readonly next: readonly string[]
  readonly cls: number
  readonly wired: boolean
  readonly blocked: boolean
  readonly len: number
  readonly mx: number
  readonly mz: number
}

export interface DetourGraph {
  getRoad(key: string): TrafficRoad | undefined
  isOpen?(road: TrafficRoad): boolean
  tangentAt?(road: TrafficRoad, atEnd: boolean): { tx: number; tz: number }
}

export interface DetourResult {
  readonly nextKey: string
  readonly path: readonly string[]
  readonly expansions: number
  readonly fromCache: boolean
}

export interface ObstacleBox {
  readonly x: number
  readonly z: number
  readonly hx: number
  readonly hz: number
  readonly halfL: number
  readonly halfW: number
  readonly v: number
  readonly id?: number
  readonly isCrater?: boolean
  readonly isPedestrian?: boolean
  readonly stalled?: boolean
}

export interface LaneClearQuery {
  readonly id: number
  readonly x: number
  readonly z: number
  readonly hx: number
  readonly hz: number
  readonly halfL: number
  readonly halfW: number
  readonly v: number
  /** Lateral shift from current position to candidate lane/pass corridor (cells; + right, - left). */
  readonly lateralShift: number
  /** Extra forward distance that must be clear in the target corridor (cells). */
  readonly forwardClear?: number
  /** Extra rear distance that must be clear in the target corridor (cells). */
  readonly rearClear?: number
  /** Minimum OBB edge clearance in cells (default 4). */
  readonly margin?: number
  /** True when passing in an opposing lane on a 1-lane two-way street (enforces stricter oncoming clearance). */
  readonly opposingLane?: boolean
}

export interface EmergencyEmitter {
  readonly id: number
  readonly kind: EmergencyKind
  readonly x: number
  readonly y?: number
  readonly z: number
  readonly hx: number
  readonly hz: number
  readonly v: number
  readonly active: boolean
}

export interface SirenYieldResult {
  readonly yielding: boolean
  readonly intensity: number
  /** Desired lateral shift toward right kerb (cells, >= 0). */
  readonly targetShift: number
  /** Multiplier on desired cruise speed (0.06..1.0). */
  readonly speedCapScale: number
  readonly emitterId: number | null
}

export interface PedestrianNearMissCue {
  readonly id: number
  readonly carId: number
  readonly pedX: number
  readonly pedZ: number
  readonly carX: number
  readonly carZ: number
  readonly carHx: number
  readonly carHz: number
  readonly speedCells: number
  readonly clearanceCells: number
  readonly at: number
  readonly severity: number
  readonly stepDirX: number
  readonly stepDirZ: number
}

export interface TrafficAiStats {
  laneChanges: number
  detours: number
  sirenYields: number
  activeEmergency: number
  deadlocksResolved: number
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Acoustic siren forward cone reach (45 m = 450 cells). */
export const SIREN_RANGE = 450
/** Acoustic siren forward cone half-angle (50 degrees). */
export const SIREN_HALF_ANGLE_RAD = (50 * Math.PI) / 180
export const SIREN_COS_HALF_ANGLE = Math.cos(SIREN_HALF_ANGLE_RAD)
/** Omnidirectional siren proximity awareness radius (18 m = 180 cells). */
export const SIREN_OMNI_RANGE = 180
/** Standard SF traffic lane width in cells (3.3 m). */
export const LANE_WIDTH_CELLS = 33
/** Ambient emergency vehicle spawn share (~4%). */
export const EMERGENCY_SPAWN_SHARE = 0.04
/** Default budgeted graph expansion limit for local junction detours. */
export const DEFAULT_DETOUR_BUDGET = 20

// ── Deterministic Seed Helpers ───────────────────────────────────────────────

/** Deterministic hash in [0, 1) matching the engine's seed conventions. */
export function hash01(seed: number, salt: number): number {
  let h = (Math.imul(seed | 0, 374761393) ^ Math.imul(salt | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** 2D SAT minimum edge separation between two oriented rectangles (negative = overlap penetration, cells). */
export function obbGap2D(
  ax: number, az: number, afx: number, afz: number, ahl: number, ahw: number,
  bx: number, bz: number, bfx: number, bfz: number, bhl: number, bhw: number,
): number {
  const arx = -afz, arz = afx, brx = -bfz, brz = bfx
  const dx = bx - ax, dz = bz - az
  let gap = -Infinity
  const axis = (ux: number, uz: number) => {
    const d = Math.abs(dx * ux + dz * uz)
    const pA = Math.abs(afx * ux + afz * uz) * ahl + Math.abs(arx * ux + arz * uz) * ahw
    const pB = Math.abs(bfx * ux + bfz * uz) * bhl + Math.abs(brx * ux + brz * uz) * bhw
    const g = d - (pA + pB)
    if (g > gap) gap = g
  }
  axis(afx, afz)
  axis(arx, arz)
  axis(bfx, bfz)
  axis(brx, brz)
  return gap
}

// ── 1. Individualized Per-Driver Profiles & Rain Coupling ────────────────────

/**
 * Derives a deterministic individualized driver profile from `(seed, kind, emergency)`.
 * Produces distinct speed biases, caution/aggression ranges, rain braking elongation,
 * horn impatience, lane-change willingness, and following gaps.
 */
export function driverProfile(seed: number, kind: string, emergency?: EmergencyKind): DriverProfile {
  const r0 = hash01(seed, 101)
  const r1 = hash01(seed, 102)
  const r2 = hash01(seed, 103)
  const r3 = hash01(seed, 104)
  const r4 = hash01(seed, 105)
  const r5 = hash01(seed, 106)
  const r6 = hash01(seed, 107)

  let archetype: DriverArchetype
  if (emergency) {
    archetype = 'emergency'
  } else if (kind === 'van' || kind === 'truck') {
    archetype = 'delivery'
  } else if (kind === 'robotaxi' || kind === 'bus' || kind === 'trolley') {
    archetype = 'cautious'
  } else {
    archetype = r0 < 0.22 ? 'cautious' : r0 < 0.64 ? 'commuter' : r0 < 0.86 ? 'assertive' : 'hurried'
  }

  switch (archetype) {
    case 'emergency':
      return {
        archetype,
        caution: lerp(0.45, 0.65, r1),
        aggression: lerp(0.80, 0.96, r2),
        speedBias: lerp(1.15, 1.22, r3),
        rainBrakeScale: lerp(1.15, 1.28, r4),
        hornImpatience: lerp(0.60, 0.95, r5),
        laneChangeWillingness: lerp(0.92, 0.99, r6),
        followGapCells: lerp(19, 24, r1),
      }
    case 'delivery':
      return {
        archetype,
        caution: lerp(0.85, 1.15, r1),
        aggression: lerp(0.28, 0.56, r2),
        speedBias: lerp(0.88, 1.00, r3),
        rainBrakeScale: lerp(1.36, 1.65, r4),
        hornImpatience: lerp(1.75, 2.85, r5),
        laneChangeWillingness: lerp(0.48, 0.72, r6),
        followGapCells: lerp(28, 35, r1),
      }
    case 'cautious': {
      const isRT = kind === 'robotaxi'
      return {
        archetype,
        caution: lerp(isRT ? 1.18 : 1.10, 1.40, r1),
        aggression: lerp(0.05, isRT ? 0.20 : 0.28, r2),
        speedBias: lerp(0.82, 0.94, r3),
        rainBrakeScale: lerp(1.48, 1.75, r4),
        hornImpatience: lerp(isRT ? 3.8 : 3.2, 4.6, r5),
        laneChangeWillingness: lerp(0.40, 0.62, r6),
        followGapCells: lerp(30, 38, r1),
      }
    }
    case 'commuter':
      return {
        archetype,
        caution: lerp(0.80, 1.10, r1),
        aggression: lerp(0.26, 0.56, r2),
        speedBias: lerp(0.94, 1.06, r3),
        rainBrakeScale: lerp(1.30, 1.54, r4),
        hornImpatience: lerp(2.00, 3.20, r5),
        laneChangeWillingness: lerp(0.56, 0.80, r6),
        followGapCells: lerp(24, 31, r1),
      }
    case 'assertive':
      return {
        archetype,
        caution: lerp(0.56, 0.82, r1),
        aggression: lerp(0.56, 0.80, r2),
        speedBias: lerp(1.04, 1.15, r3),
        rainBrakeScale: lerp(1.20, 1.42, r4),
        hornImpatience: lerp(1.20, 2.05, r5),
        laneChangeWillingness: lerp(0.74, 0.92, r6),
        followGapCells: lerp(20, 26, r1),
      }
    case 'hurried':
      return {
        archetype,
        caution: lerp(0.40, 0.60, r1),
        aggression: lerp(0.78, 1.00, r2),
        speedBias: lerp(1.12, 1.22, r3),
        rainBrakeScale: lerp(1.15, 1.32, r4),
        hornImpatience: lerp(0.72, 1.30, r5),
        laneChangeWillingness: lerp(0.85, 0.99, r6),
        followGapCells: lerp(18, 23, r1),
      }
  }
}

/**
 * Computes wet-surface braking, following-gap, and corner-speed scaling smoothly from weather `rain` (0..1).
 * Elongates braking distance and following gaps whenever `rain > 0.2`.
 */
export function rainDrivingFactors(profile: DriverProfile, rain: number): RainDrivingFactors {
  const w = clamp((rain - 0.2) / 0.8, 0, 1)
  if (w <= 0) return { brakeMult: 1, gapMult: 1, cornerSpeedScale: 1, topSpeedScale: 1 }
  const extra = profile.rainBrakeScale - 1
  return {
    brakeMult: 1 + extra * w,
    gapMult: 1 + extra * 0.85 * w,
    cornerSpeedScale: 1 - clamp((0.10 + 0.13 * profile.caution) * w, 0, 0.34),
    topSpeedScale: 1 - clamp((0.05 + 0.08 * profile.caution) * w, 0, 0.22),
  }
}

// ── 2. Dynamic Lane-Changing & Smooth Lateral Overtake ───────────────────────

/**
 * Verifies whether shifting laterally by `q.lateralShift` into an adjacent lane or shoulder/opposing
 * overtake corridor is clear of neighboring vehicles, oncoming traffic, and blast craters across both
 * the transition midpoint and destination corridor.
 */
export function isLaneClear(q: LaneClearQuery, obstacles: readonly ObstacleBox[]): boolean {
  const rx = -q.hz, rz = q.hx
  const margin = q.margin ?? 4
  const fwdClear = q.forwardClear ?? (q.halfL + 36 + q.v * 0.45)
  const rearClear = q.rearClear ?? (q.halfL + 22)
  const tx = q.x + rx * q.lateralShift
  const tz = q.z + rz * q.lateralShift
  const mx = q.x + rx * (q.lateralShift * 0.5)
  const mz = q.z + rz * (q.lateralShift * 0.5)
  const scanR = Math.max(fwdClear, rearClear) + 260

  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i]
    if (ob.id !== undefined && ob.id === q.id) continue
    const dxT = ob.x - tx, dzT = ob.z - tz
    if (Math.abs(dxT) > scanR || Math.abs(dzT) > scanR) continue

    // 1. Direct OBB clearance at target lane position (zero overlap invariant).
    const gDest = obbGap2D(tx, tz, q.hx, q.hz, q.halfL + 3, q.halfW + 1, ob.x, ob.z, ob.hx, ob.hz, ob.halfL, ob.halfW)
    if (gDest < margin) return false

    // 2. Diagonal transition midpoint clearance (prevents clipping a neighbor mid-shift).
    // Skip checking against the stalled vehicle straight ahead in our original lane that we are pulling around!
    const dxOrig = ob.x - q.x, dzOrig = ob.z - q.z
    const origAhead = dxOrig * q.hx + dzOrig * q.hz
    const origAcross = Math.abs(dxOrig * rx + dzOrig * rz)
    const isFrontLeadInOldLane = !ob.isCrater && origAhead > q.halfL * 0.5 && origAcross < q.halfW + ob.halfW + 3
    if (!isFrontLeadInOldLane) {
      const gMid = obbGap2D(mx, mz, q.hx, q.hz, q.halfL + 1, q.halfW, ob.x, ob.z, ob.hx, ob.hz, ob.halfL, ob.halfW)
      if (gMid < Math.max(1.5, margin * 0.5)) return false
    }

    // 3. Corridor longitudinal clearance in the destination lane.
    const along = dxT * q.hx + dzT * q.hz
    const across = Math.abs(dxT * rx + dzT * rz)
    const dot = ob.hx * q.hx + ob.hz * q.hz
    const obAcrossHalf = Math.abs(dot) * ob.halfW + Math.abs(ob.hx * rx + ob.hz * rz) * ob.halfL
    const obAlongHalf = Math.abs(dot) * ob.halfL + Math.abs(ob.hx * rx + ob.hz * rz) * ob.halfW
    if (across > q.halfW + obAcrossHalf + margin) continue

    // Crater in destination corridor: never merge into a crater!
    if (ob.isCrater && along > -obAlongHalf - q.halfL - 10 && along < fwdClear + obAlongHalf + 80) {
      return false
    }

    // Opposing lane pass: require generous clear sightline against oncoming vehicles.
    if (q.opposingLane && dot < -0.5) {
      const closingNeed = fwdClear + 150 + (q.v + ob.v) * 1.4
      if (along > -q.halfL - obAlongHalf - 10 && along < closingNeed + obAlongHalf) return false
    }

    // Ahead in destination lane: must have room to pull in cleanly without immediately slamming brakes.
    if (along >= 0 && along - q.halfL - obAlongHalf < (ob.stalled ? fwdClear + 45 : Math.min(fwdClear, 26 + q.v * 0.35))) {
      return false
    }

    // Approaching from behind in destination lane: check safe closing gap / TTC.
    if (along < 0 && dot > 0.3) {
      const behindGap = -along - q.halfL - obAlongHalf
      const closing = Math.max(0, ob.v - q.v)
      const needBehind = Math.max(rearClear - q.halfL, 12 + closing * 1.35)
      if (behindGap < needBehind) return false
    }
  }
  return true
}

/**
 * Smoothly moves a lateral offset (`laneShift`, `overtakeShift`, or `sirenYieldShift`) toward `target`
 * without snapping, returning the updated offset and instantaneous lateral speed (cells/s) for steering yaw.
 */
export function stepLateralShift(
  current: number,
  target: number,
  dt: number,
  maxRateCellsPerSec: number,
): { value: number; vel: number } {
  const diff = target - current
  if (Math.abs(diff) < 0.02 || dt <= 0) return { value: target, vel: 0 }
  const desiredVel = clamp(diff * 3.4, -maxRateCellsPerSec, maxRateCellsPerSec)
  const step = desiredVel * dt
  if (Math.abs(step) >= Math.abs(diff)) return { value: target, vel: diff / Math.max(dt, 1e-4) }
  return { value: current + step, vel: desiredVel }
}

// ── 3. Budgeted Local Junction Detour Planner ────────────────────────────────

export interface DetourCache {
  readonly map: Map<string, DetourResult | null>
  readonly maxEntries: number
}

export function createDetourCache(maxEntries = 256): DetourCache {
  return { map: new Map(), maxEntries }
}

/** Canonical cache signature for the currently blocked/congested road set. */
export function blockedSetKey(blocked: ReadonlySet<string>): string {
  if (blocked.size === 0) return ''
  if (blocked.size === 1) return blocked.values().next().value!
  return [...blocked].sort().join(',')
}

/**
 * Budgeted local graph detour planner (`maxExpansions` default 20, clamped 16..24).
 * When approaching a junction whose preferred outgoing road is blocked (blast crater) or
 * congested by a stalled robotaxi, explores local alternate outgoing roads to pick one that
 * leads to clear unblocked continuation instead of piling into a deadlock.
 * Results are cached per `(currentRoad.key, kind, blockedSet)`.
 */
export function planLocalDetour(
  graph: DetourGraph,
  currentRoad: TrafficRoad,
  congestedKeys: ReadonlySet<string>,
  opts: {
    maxExpansions?: number
    kind?: string
    preferredHeading?: { tx: number; tz: number }
    cache?: DetourCache
    blockedSignature?: string
  } = {},
): DetourResult | null {
  const kind = opts.kind ?? 'car'
  const maxExpansions = clamp(Math.round(opts.maxExpansions ?? DEFAULT_DETOUR_BUDGET), 16, 24)
  const sig = opts.blockedSignature ?? blockedSetKey(congestedKeys)
  const cacheKey = opts.cache ? `${currentRoad.key}|${kind}|${sig}` : ''

  if (opts.cache && opts.cache.map.has(cacheKey)) {
    const cached = opts.cache.map.get(cacheKey)!
    return cached ? { ...cached, fromCache: true } : null
  }

  const isPassable = (r: TrafficRoad | undefined): r is TrafficRoad => {
    if (!r || r.blocked || congestedKeys.has(r.key)) return false
    if (graph.isOpen && !graph.isOpen(r)) return false
    return true
  }

  const curEnd = opts.preferredHeading ?? graph.tangentAt?.(currentRoad, true) ?? { tx: 1, tz: 0 }

  // Candidate first outgoing roads from `currentRoad.b`.
  interface State {
    road: TrafficRoad
    firstKey: string
    path: string[]
    depth: number
    dist: number
    cost: number
    isReverse: boolean
  }

  const open: State[] = []
  const visited = new Set<string>([currentRoad.key])

  for (const candKey of currentRoad.next) {
    const cand = graph.getRoad(candKey)
    if (!isPassable(cand)) continue
    const isReverse = cand.way === currentRoad.way && cand.b === currentRoad.a
    const startT = graph.tangentAt?.(cand, false) ?? { tx: curEnd.tx, tz: curEnd.tz }
    const align = curEnd.tx * startT.tx + curEnd.tz * startT.tz
    // Prefer gentle/forward continuations, wider roads, and kind-appropriate classes; penalize immediate U-turns.
    let turnCost = (1 - align) * 90
    if (isReverse) turnCost += 260
    else if (align < -0.45) turnCost += 140
    let classCost = cand.flags & 4 ? 75 : 0
    if (kind === 'trolley' && !cand.wired) classCost += 220
    else if (kind === 'bus' && cand.cls < 2) classCost += 120
    else if (kind === 'truck' && (cand.flags & 4 || cand.cls < 1)) classCost += 110
    const laneBonus = Math.min(3, cand.lanes) * 14
    const cost = Math.max(1, turnCost + classCost - laneBonus)
    open.push({ road: cand, firstKey: cand.key, path: [cand.key], depth: 1, dist: cand.len, cost, isReverse })
  }

  if (!open.length) {
    if (opts.cache) storeCache(opts.cache, cacheKey, null)
    return null
  }

  let expansions = 0
  let bestComplete: State | null = null
  let bestFallback: State | null = null

  while (open.length > 0 && expansions < maxExpansions) {
    // Pop lowest-cost frontier state (open list is tiny <= 24 so linear scan is zero-overhead).
    let bestIdx = 0
    for (let i = 1; i < open.length; i++) {
      if (open[i].cost < open[bestIdx].cost) bestIdx = i
    }
    const st = open.splice(bestIdx, 1)[0]
    if (visited.has(st.road.key)) continue
    visited.add(st.road.key)
    expansions++

    // Track best reachable fallback in case the local graph has only a single-hop clear road.
    if (!bestFallback || st.cost - st.dist * 0.05 < bestFallback.cost - bestFallback.dist * 0.05) {
      bestFallback = st
    }

    // Count passable continuations from this state to avoid dead-ending into another blockage.
    let clearNextCount = 0
    for (const nk of st.road.next) {
      const nr = graph.getRoad(nk)
      if (!isPassable(nr)) continue
      if (nr.way === st.road.way && nr.b === st.road.a) continue
      clearNextCount++
    }

    // A detour is considered solidly clear once it has reached depth >= 2 (or long clear road >= 260 cells)
    // with open continuation ahead, or has bent back toward the original travel direction.
    const reachedClear = (st.depth >= 2 && (clearNextCount > 0 || st.dist >= 220)) || (st.dist >= 320 && clearNextCount > 0)
    if (reachedClear) {
      const score = st.cost - Math.min(180, st.dist * 0.12) - (clearNextCount > 0 ? 45 : 0)
      const bestScore = bestComplete ? bestComplete.cost - Math.min(180, bestComplete.dist * 0.12) - 45 : Infinity
      if (!bestComplete || score < bestScore) {
        bestComplete = st
        // Early exit if we found a non-reverse clean 2+ hop route cleanly.
        if (!st.isReverse && st.depth >= 2 && clearNextCount > 0 && expansions >= 4) break
      }
    }

    if (st.depth >= 4) continue

    for (const nk of st.road.next) {
      if (visited.has(nk)) continue
      const nr = graph.getRoad(nk)
      if (!isPassable(nr)) continue
      if (nr.way === st.road.way && nr.b === st.road.a) continue
      const nt = graph.tangentAt?.(nr, false) ?? curEnd
      const alignOrig = curEnd.tx * nt.tx + curEnd.tz * nt.tz
      // Reward paths that realign with our original travel heading past the blockage.
      const stepCost = Math.max(8, nr.len * 0.18 + (1 - alignOrig) * 45 - Math.min(3, nr.lanes) * 8)
      open.push({
        road: nr,
        firstKey: st.firstKey,
        path: [...st.path, nr.key],
        depth: st.depth + 1,
        dist: st.dist + nr.len,
        cost: st.cost + stepCost,
        isReverse: st.isReverse,
      })
    }
  }

  const chosen = bestComplete ?? bestFallback
  const result: DetourResult | null = chosen
    ? { nextKey: chosen.firstKey, path: chosen.path, expansions, fromCache: false }
    : null

  if (opts.cache) storeCache(opts.cache, cacheKey, result)
  return result
}

function storeCache(cache: DetourCache, key: string, value: DetourResult | null): void {
  if (cache.map.size >= cache.maxEntries) {
    const first = cache.map.keys().next().value
    if (first !== undefined) cache.map.delete(first)
  }
  cache.map.set(key, value)
}

// ── 4. Emergency Vehicles: Acoustic Siren Cone, Yield Solver & Flashers ──────

/**
 * Evaluates whether a regular traffic car is inside any active emergency vehicle's acoustic siren cone
 * (forward 45 m / 50° half-angle cone OR 18 m omnidirectional proximity) and computes its smooth
 * right-kerb pull offset and safe deceleration speed cap.
 */
export function evaluateSirenYield(
  car: { id: number; x: number; y?: number; z: number; hx: number; hz: number; lane?: number; lanes?: number; emergency?: EmergencyKind },
  emitters: readonly EmergencyEmitter[],
): SirenYieldResult {
  if (car.emergency || !emitters.length) {
    return { yielding: false, intensity: 0, targetShift: 0, speedCapScale: 1, emitterId: null }
  }

  let bestIntensity = 0
  let bestEmitterId: number | null = null

  for (let i = 0; i < emitters.length; i++) {
    const em = emitters[i]
    if (!em.active || em.id === car.id) continue
    if (car.y !== undefined && em.y !== undefined && Math.abs(car.y - em.y) > 40) continue

    const dx = car.x - em.x
    const dz = car.z - em.z
    if (Math.abs(dx) > SIREN_RANGE || Math.abs(dz) > SIREN_RANGE) continue
    const dist = Math.hypot(dx, dz)
    if (dist > SIREN_RANGE) continue

    // Longitudinal projection of `car` along emergency vehicle's heading.
    const alongEm = dx * em.hx + dz * em.hz
    // Once the emergency vehicle has clearly passed (5.5 m past the car), release yield cleanly!
    if (alongEm < -55) continue

    const cosAngle = dist > 1e-4 ? alongEm / dist : 1
    const inForwardCone = cosAngle >= SIREN_COS_HALF_ANGLE && alongEm >= -15
    const inOmni = dist <= SIREN_OMNI_RANGE
    if (!inForwardCone && !inOmni) continue

    const distFactor = inOmni
      ? clamp(1 - (dist / SIREN_OMNI_RANGE) * 0.45, 0.55, 1)
      : clamp(1 - (dist - 80) / (SIREN_RANGE - 80), 0.18, 1)
    const angleFactor = inOmni
      ? 1
      : clamp((cosAngle - SIREN_COS_HALF_ANGLE) / (1 - SIREN_COS_HALF_ANGLE) * 0.65 + 0.35, 0.35, 1)
    // Smooth fade-out right as emergency vehicle pulls past (`alongEm` in [-55, 0]).
    const passFade = alongEm < 0 ? clamp(1 + alongEm / 55, 0, 1) : 1
    const intensity = clamp(distFactor * angleFactor * passFade, 0, 1)

    if (intensity > bestIntensity) {
      bestIntensity = intensity
      bestEmitterId = em.id
    }
  }

  if (bestIntensity <= 0.05) {
    return { yielding: false, intensity: 0, targetShift: 0, speedCapScale: 1, emitterId: null }
  }

  // Pull smoothly toward the right kerb: outer lane hugs kerb (+21 cells = 2.1 m), inner lane shifts further right (+24 cells).
  const isRightmostLane = car.lanes !== undefined && car.lane !== undefined ? car.lane >= car.lanes - 1 : true
  const maxKerbShift = isRightmostLane ? 21 : 24
  const targetShift = maxKerbShift * clamp(0.45 + bestIntensity * 0.55, 0, 1)
  // Decelerate smoothly down to a near-stop / slow crawl as the emergency vehicle approaches.
  const speedCapScale = clamp(1 - bestIntensity * 0.92, 0.06, 0.65)
  return {
    yielding: true,
    intensity: bestIntensity,
    targetShift,
    speedCapScale,
    emitterId: bestEmitterId,
  }
}

/**
 * Emits pulsing red/blue roof flasher local lights via the existing `LocalLightSink` interface
 * (does not modify `lights.ts`).
 */
export function emitEmergencyFlashers(
  sink: LocalLightSink,
  car: { x: number; y: number; z: number; heading: number; height: number; emergency: EmergencyKind; sirenActive: boolean; seed: number },
  simTime: number,
): void {
  if (!car.sirenActive) return
  const freq = car.emergency === 'police' ? 3.4 : 2.6
  const phase = (simTime * freq + (car.seed & 15) * 0.13) % 1
  const rx = -Math.sin(car.heading), rz = Math.cos(car.heading)
  const roofY = car.y + car.height + 2.5
  const barOff = 4.2

  // Alternating crisp red (left) and blue (right) roof bar strobe pulses (ambulance adds bright white-red alternating pulse).
  const redPulse = phase < 0.45 ? (phase < 0.16 || (phase > 0.24 && phase < 0.42) ? 1.0 : 0.22) : 0.06
  const bluePulse = phase >= 0.50 ? (phase < 0.68 || (phase > 0.76 && phase < 0.94) ? 1.0 : 0.22) : 0.06

  if (redPulse > 0.15) {
    const p = 3.8 * redPulse
    sink.addPoint(
      car.x - rx * barOff, roofY, car.z - rz * barOff,
      p, 0.08 * p, 0.06 * p,
      245, 58, 1.5, 250, 0,
    )
  }
  if (bluePulse > 0.15) {
    const p = 3.6 * bluePulse
    const isAmb = car.emergency === 'ambulance'
    sink.addPoint(
      car.x + rx * barOff, roofY, car.z + rz * barOff,
      (isAmb ? 0.85 : 0.10) * p, (isAmb ? 0.92 : 0.36) * p, p,
      245, 58, 1.5, 245, 0,
    )
  }
}

// ── 5. Pedestrian-Vehicle Coupling ───────────────────────────────────────────

/**
 * Extra crosswalk yield buffer (cells) for a driver based on their `caution`, speed, and current `rain`.
 * Cautious drivers start yielding significantly earlier and leave wider crosswalk clearance,
 * especially on wet roads.
 */
export function crosswalkYieldBuffer(profile: DriverProfile, speedCells: number, rain: number): number {
  const rf = rainDrivingFactors(profile, rain)
  const cautionFactor = clamp(profile.caution, 0.4, 1.4)
  // Cautious (1.35) gets ~26–48 cells extra buffer; hurried (0.45) gets ~4–12 cells.
  const baseBuffer = Math.max(3, (cautionFactor - 0.32) * 26)
  const speedLookahead = speedCells * (0.14 * cautionFactor)
  return (baseBuffer + speedLookahead) * rf.brakeMult
}

/**
 * Evaluates a moving vehicle against nearby crosswalk/roadside pedestrians to detect near-misses
 * and emit structured `PedestrianNearMissCue` records so nearby pedestrians visibly flinch and step back.
 */
export function detectPedestrianNearMiss(
  car: { id: number; x: number; z: number; hx: number; hz: number; halfL: number; halfW: number; v: number },
  peds: readonly (readonly [number, number])[],
  simTime: number,
  cooldowns: Map<string, number>,
  nextCueId: () => number,
  opts: { minSpeedCells?: number; maxClearanceCells?: number; cooldownSec?: number } = {},
): PedestrianNearMissCue[] {
  const minSpeed = opts.minSpeedCells ?? 28
  if (car.v < minSpeed || !peds.length) return []

  const maxClear = opts.maxClearanceCells ?? 24
  const cool = opts.cooldownSec ?? 2.4
  const rx = -car.hz, rz = car.hx
  const out: PedestrianNearMissCue[] = []

  for (let i = 0; i < peds.length; i++) {
    const px = peds[i][0], pz = peds[i][1]
    const dx = px - car.x, dz = pz - car.z
    if (Math.abs(dx) > car.halfL + 65 || Math.abs(dz) > car.halfL + 65) continue

    const ahead = dx * car.hx + dz * car.hz
    const lat = dx * rx + dz * rz
    // Trigger as vehicle rushes past or bears down closely beside/in front of the pedestrian.
    if (ahead < -(car.halfL + 12) || ahead > car.halfL + 42) continue
    const latClear = Math.abs(lat) - (car.halfW + 3)
    const alongClear = ahead > car.halfL + 3 ? ahead - (car.halfL + 3) : ahead < -(car.halfL + 3) ? -(ahead + car.halfL + 3) : 0
    const clearance = Math.hypot(Math.max(0, latClear), Math.max(0, alongClear))
    if (clearance > maxClear) continue

    const bucketKey = `${car.id}:${Math.round(px / 25)},${Math.round(pz / 25)}`
    const prevT = cooldowns.get(bucketKey)
    if (prevT !== undefined && simTime - prevT < cool) continue
    cooldowns.set(bucketKey, simTime)

    // Step-back direction: away from the vehicle's centerline toward the nearest side.
    const sideSign = lat >= 0 ? 1 : -1
    const stepDirX = rx * sideSign
    const stepDirZ = rz * sideSign
    const speedFactor = clamp((car.v - minSpeed) / 90, 0.2, 1)
    const proxFactor = clamp(1 - clearance / maxClear, 0.15, 1)
    const severity = clamp(speedFactor * 0.55 + proxFactor * 0.45, 0.15, 1)

    out.push({
      id: nextCueId(),
      carId: car.id,
      pedX: px,
      pedZ: pz,
      carX: car.x,
      carZ: car.z,
      carHx: car.hx,
      carHz: car.hz,
      speedCells: Math.round(car.v * 10) / 10,
      clearanceCells: Math.round(clearance * 10) / 10,
      at: simTime,
      severity: Math.round(severity * 100) / 100,
      stepDirX,
      stepDirZ,
    })
  }

  // Keep cooldown map bounded.
  if (cooldowns.size > 256) {
    for (const [k, at] of cooldowns) {
      if (simTime - at > cool * 2) cooldowns.delete(k)
    }
  }
  return out
}
