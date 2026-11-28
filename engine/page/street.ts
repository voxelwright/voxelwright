// Street life on San Francisco's own streets (#450): the people on its pavements and crossings, the cars parked at
// its kerbs and driving its lanes, and the cable cars on their rails. All of it comes from plain files beside the page
// (sf/life.py's graphs of each square, sf/cars.mjs's kept vehicles); nothing is made, asked for or kept anywhere.
//
// People are a rule of place and time, as the town's residents are (residents.ts): anyone asked about the same
// pavement at the same second says the same people in the same places, so a blast can ask where somebody was when
// it went off. Each lives somewhere along a pavement, and goes out on a walk of the graph that their number chooses,
// stands a while at the far end, and comes back the same way, a new walk each round. How many live along a pavement
// is how busy the land round it is (shops, offices, visitors and homes within 60 m), and how many are out is the hour.
//
// Cars are the page's own: parked where the graph says there is a kerb to park at (a rule of the place, as people
// are), and driven round the eye in lanes, keeping their distance and taking turns at junctions with three ways or
// more. They are drawn, not solved: the solver's living things (living.ts) are for the few a visitor can reach. A
// parked car within a few steps of someone on foot is brought to life where it stands, so E gets in and drives it;
// a car stopped beside someone (it waits for whoever stands in its lane) can be taken the same way.
// Lengths are the world's finest cells (10 cm); time is seconds.
import type { View } from './march.ts'
import type { LocalLightSink } from './lights.ts'
import type { Person } from './people.ts'
import type { Piece, Pieces } from './pieces.ts'
import type { Living, Making, Motor, Thing } from './living.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Born } from './told.ts'
import { chance, type Shock } from './residents.ts'
import { createWalkGraph, DEFAULT_RING_CAPS, hourly, REACH, RING3_RADIUS, type LodStats, type WalkGraph } from '../sf-walks.mjs'
import { NAMED as NAMED_MOVES } from './moves.ts'
import { unrun } from './runs.ts'
import { POLISHED } from './spells.ts'
import { faces as facesOf } from './fine.ts'
import { LOCAL } from './local.ts'
import { PACKS_ENABLED, readPackedJson, squarePackName } from './pack.ts'
import { buildLidarDomeBorns, buildRobotaxiModel, buildStationBorns, ROBOTAXI_SERVICES, type RobotaxiModel, type RobotaxiService, type StationBorns } from './robotaxi.ts'
import {
  blockedSetKey,
  createDetourCache,
  crosswalkYieldBuffer,
  detectPedestrianNearMiss,
  driverProfile,
  EMERGENCY_SPAWN_SHARE,
  emitEmergencyFlashers,
  evaluateSirenYield,
  isLaneClear,
  planLocalDetour,
  rainDrivingFactors,
  stepLateralShift,
  type DetourGraph,
  type DriverProfile,
  type EmergencyEmitter,
  type EmergencyKind,
  type ObstacleBox,
  type PedestrianNearMissCue,
  type TrafficAiStats,
} from './traffic-ai.ts'

/** What street life asks of the land (the core's exports). */
export interface Ground { feet_at(x: number, z: number): number; ground_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number; world_under?(x: number, y: number, z: number, depth: number): number; top_at?(x: number, z: number): number }

type Ring = Float64Array
interface Road { key: string; way: number; a: number; b: number; lanes: number; flags: number; next: string[]; ctl: number; cls: number; wired: boolean; blocked: boolean; p: Ring; cum: Ring; len: number; open: boolean | null; weight: number; mx: number; mz: number; railShift?: number }
interface Slot { x: number; z: number; yaw: number; mapped: boolean; seed: number; y?: number; pitch?: number; ok?: boolean }
interface Line { p: Ring; cum: Ring; len: number; seed: number; lights?: { s: number; node: number; dx: number; dz: number }[] }
interface Look { size: [number, number, number]; per: number; low: [number, number, number]; palette: number[]; runs: string; roles?: string[] }
interface Model { id: string; name: string; kind: string; serviceId?: string; domeOffset?: readonly [number, number, number]; size: [number, number, number]; body: { palette: number[]; runs: string }; motor?: Motor; controls?: Making['controls']; seats?: [number, number, number][]; eye?: [number, number, number]; looks: Look[]; variants: { name: string; body: number[]; looks: number[][] }[]; front: number; long: number; wide: number }
/** How a drawn car comes to life (`wake`): with its inside, the speed it is given, when it was struck, and what to do with it then. */
interface Waking { inside: boolean; push?: [number, number, number]; asked?: number; then?: (t: Thing) => void }
interface Car {
  id: number; model: Model; paint: number; kind: 'parked' | 'traffic' | 'cable' | 'tram'; seed: number
  /** A streetcar's line. */
  track?: Line & { lights: { s: number; node: number; dx: number; dz: number }[] }
  x: number; y: number; z: number; heading: number; pitch: number; roll?: number; v: number
  /** Whether this parked car was settled after the finest terrain tiles covering its wheels had arrived. */
  fineGround?: boolean
  piece: Piece | null; shown: string
  // Driving: the road, its lane, how far along, the road before (for the corner) and the one after.
  road?: Road; prev?: Road | null; next?: Road | null; lane?: number; s?: number; hold?: number | null; stuck?: number; queued?: boolean
  /** The junction it last came to a stop at (a stop sign's), and how long it has waited on a control (lights, a sign, its turn). */
  stopped?: number; held?: number
  slot?: number; thing?: Thing | null; waking?: boolean
  /** When a blast near it went off (seconds on the page's clock): it stands on its brakes a while. */
  shaken?: number
  /** Thrown by a blast or struck by a driven car: it lives until the street is reset or the eye is far from it, wherever nobody is. */
  thrown?: boolean
  /** When this car was woken by a driven-vehicle crash (seconds on `performance.now()`), for cap recycling. */
  crashed?: number
  /** Last non-waking contact timestamp (seconds), for cooldown on rail/non-motorized vehicles. */
  hitAt?: number
  /** Alive, and still drawn where it stood: until the solver's answers show its body on the road (`wake`). And what is done with it then. */
  landing?: boolean
  then?: (t: Thing) => void
  /** Alive and thrown: where it was last seen to have moved to, how fast it goes on the ground (cells a second), and the seconds since. */
  going?: { x: number; z: number; vx: number; vz: number; dt: number }
  /** When the player honked near this traffic car (seconds), nudging it to pull forward or yield. */
  honked?: number
  /** Last time this traffic car honked back (seconds), so it never spams. */
  honkedBack?: number
  /** What it last waited for, if it is held up: a car, a person, a turn at a junction, the end of the road. */
  wait?: string
  /** A bus's route (OSM's, sf/life.py): the piece it runs, which of its roads it is on, the stop it last served there, and until when it stands at one. */
  route?: { piece: BusPiece; i: number; served: number; dwell?: number }
  /** Robotaxi spinning roof LiDAR turret piece, mode ('normal' | 'stuck'), and spin phase (radians). */
  dome?: Piece | null; domeMode?: '' | 'normal' | 'stuck'; lidarAngle?: number
  /** Active robotaxi freeze/deadlock at an intersection or blocking a narrow street (seconds on performance.now()). */
  rtStuck?: { at: number; until: number; kind: 'intersection' | 'narrow'; stutter: number; microEnd: number }
  /** Cooldown timestamp after recovering from a robotaxi freeze, and last evaluated junction/road so rolls happen once. */
  rtCool?: number; rtNode?: number; rtRoadKey?: string
  /** Impatience timer (seconds) while blocked behind a stuck robotaxi, and high-beam flash end timestamp. */
  annoyedAt?: number; beamFlash?: number
  /** Robotaxi charging-station depot circulation state: charging in a bay, exiting to the street, or entering a bay. */
  depot?: { serviceId: string; phase: 'charging' | 'exiting' | 'entering'; bay: number; until: number; pts: [number, number][]; cum: number[]; s: number; retryRoadAt?: number }
  /** Individualized seed-derived driver profile (#164 Phase 3A). */
  profile?: DriverProfile
  /** Smooth lateral offset from nominal lane center (cells; + right, - left) for zero-snap lane changes. */
  laneShift?: number
  /** Smooth lateral offset for single-lane shoulder/opposing-lane overtaking around stalled cars/craters. */
  overtakeShift?: number
  /** Active lateral overtake target around a lane obstruction on narrow/blocked roads. */
  overtake?: { shiftTarget: number; clearS: number; roadKey: string; aroundId?: number }
  /** Smooth right-kerb pull offset (cells, >= 0) while yielding inside an emergency acoustic siren cone. */
  sirenYieldShift?: number
  /** Instantaneous lateral velocity (cells/s) for steering yaw during lane transitions and kerb yields. */
  latVel?: number
  /** Emergency vehicle class and active acoustic siren state. */
  emergency?: EmergencyKind
  sirenActive?: boolean
  sirenYielding?: boolean
  /** Accumulated sim time (seconds) held behind a lane obstruction (crater, stalled robotaxi, or stopped car). */
  blockedAheadTime?: number
  /** True when queued behind an obstructed lane so trailing cars proactively change lanes or detour. */
  blockedByObstruction?: boolean
  /** True while executing an overtake or detour away from a blockage (credits `deadlocksResolved` once clear). */
  resolvingBlock?: boolean
  /** Accumulated sim time (seconds) held up by a pedestrian at a crosswalk. */
  pedBlockedTime?: number
  /** Sim-time cooldown timestamp before another lane change or overtake maneuver. */
  laneChangeCoolAt?: number
}
/** A piece of a bus route in these squares: its roads in order, and its stops as [road index, cells along that road]. */
interface BusPiece { keys: string[]; stops: [number, number][]; seed: number; apart: number; kind: 'bus' | 'trolley'; hours: [number, number]; ref: string }

/** Leading colour word on a base car name ("grey saloon", "blue saloon", "grey SUV"). */
const COLOUR_PREFIX = /^(grey|gray|blue|red|white|black|silver|green|beige|navy|yellow|orange|brown|gold|tan)\s+/i
/** Variant-aware car name (#74): a repainted street car names its paint ("white saloon", "yellow taxi"), not its base model. */
const carName = (m: Model, paint: number): string => {
  if (paint < 0 || paint >= m.variants.length) return m.name
  const v = m.variants[paint].name
  if (v === 'taxi') return 'yellow taxi'
  if (COLOUR_PREFIX.test(m.name)) return m.name.replace(COLOUR_PREFIX, `${v} `)
  return `${v} ${m.name}`
}
/** How much traffic there is at each hour, against the most. */
const TRAFFIC = [0.15, 0.1, 0.07, 0.07, 0.1, 0.25, 0.55, 0.9, 1, 0.85, 0.75, 0.8, 0.85, 0.8, 0.8, 0.85, 0.95, 1, 1, 0.85, 0.65, 0.5, 0.35, 0.22]
const ease = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c) }
const mix = (a: number, b: number) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) | 0
/** A number for an OSM node or way id (up to 2^53): the same always. */
const idSeed = (n: number) => mix(n % 2147483647, Math.floor(n / 2147483647))

/** Cars are drawn this far off, and driven round the eye this far; parked ones are set down this far. */
const DRAWN = 3600, DRIVEN = 2600, PARKED = 2200, CURVE = 60
/** A junction's lights (seconds): one cycle, each phase's green and amber, and how long a walking sign shows at the start of a green. */
const CYCLE = 60, GREEN = 26, AMBER = 3, WALK = 16
/** Cells a second: a car's top speed on a small street, an ordinary one and a wide one; how fast it gathers and stops. */
const SLOW = 70, ORDINARY = 110, FAST = 130, GATHER = 18, BRAKE = 30
/** A cable car's speed (9.5 mph, as the cable runs) and cycle-aligned departure period (2 light cycles = 120 s, ~500 m apart). */
const CABLE_SPEED = 42, CABLE_EVERY = CYCLE * 2

/** 2D SAT minimum separation gap between two oriented boxes (negative = overlapping penetration depth, cells). */
export function boxGap(ax: number, az: number, afx: number, afz: number, ahl: number, ahw: number, bx: number, bz: number, bfx: number, bfz: number, bhl: number, bhw: number): number {
  const arx = -afz, arz = afx, brx = -bfz, brz = bfx, dx = bx - ax, dz = bz - az
  let gap = -Infinity
  const axis = (ux: number, uz: number) => {
    const d = Math.abs(dx * ux + dz * uz)
    const pA = Math.abs(afx * ux + afz * uz) * ahl + Math.abs(arx * ux + arz * uz) * ahw
    const pB = Math.abs(bfx * ux + bfz * uz) * bhl + Math.abs(brx * ux + brz * uz) * bhw
    const g = d - (pA + pB)
    if (g > gap) gap = g
  }
  axis(afx, afz); axis(arx, arz); axis(bfx, bfz); axis(brx, brz)
  return gap
}

/**
 * Forward swept-corridor OBB check: returns the nearest distance along `(hx, hz)` from `(x, z)` where an oriented
 * obstacle enters the corridor of half-width `half`, or `Infinity` if clear.
 */
export function sweptPathNear(
  x: number, z: number, hx: number, hz: number, half: number,
  ob: { x: number; z: number; long: number; wide: number; hx: number; hz: number },
): number {
  const dx = ob.x - x, dz = ob.z - z
  const a0 = dx * hx + dz * hz, l0 = dz * hx - dx * hz
  const ca = ob.hx * hx + ob.hz * hz, sa = ob.hz * hx - ob.hx * hz
  let near = Infinity
  for (let k = 0; k < 4; k++) {
    const s0 = k === 0 || k === 3 ? 1 : -1, t0 = k < 2 ? 1 : -1, s1 = k === 3 || k === 2 ? 1 : -1, t1 = k === 0 || k === 3 ? 1 : -1
    const pa = a0 + s0 * ob.long * ca - t0 * ob.wide * sa, pl = l0 + s0 * ob.long * sa + t0 * ob.wide * ca
    const qa = a0 + s1 * ob.long * ca - t1 * ob.wide * sa, ql = l0 + s1 * ob.long * sa + t1 * ob.wide * ca
    let from = 0, to = 1
    if (Math.abs(ql - pl) < 1e-9) { if (Math.abs(pl) > half) continue } else {
      const u = (-half - pl) / (ql - pl), v = (half - pl) / (ql - pl)
      from = Math.max(0, Math.min(u, v)); to = Math.min(1, Math.max(u, v))
      if (from > to) continue
    }
    near = Math.min(near, pa + (qa - pa) * from, pa + (qa - pa) * to)
  }
  return near
}

/**
 * Returns `true` when stepping a vehicle from `prev` to `next` creates or deepens an oriented-box overlap
 * (`boxGap < -0.5` cells) with another vehicle `other` (#155). Prevents turning long vehicles (such as a city bus
 * bending out of lane 2 onto a corner curve) from sweeping their flank/tail into an adjacent-lane car.
 */
export function stepDeepensOverlap(
  prev: { x: number; z: number; heading: number; halfL: number; halfW: number },
  next: { x: number; z: number; heading: number; halfL: number; halfW: number },
  other: { x: number; z: number; heading: number; halfL: number; halfW: number },
): boolean {
  if (Math.abs(next.x - other.x) > 220 || Math.abs(next.z - other.z) > 220) return false
  const gapNext = boxGap(
    next.x, next.z, Math.cos(next.heading), Math.sin(next.heading), next.halfL, next.halfW,
    other.x, other.z, Math.cos(other.heading), Math.sin(other.heading), other.halfL, other.halfW,
  )
  if (gapNext >= -0.5) return false
  const gapPrev = boxGap(
    prev.x, prev.z, Math.cos(prev.heading), Math.sin(prev.heading), prev.halfL, prev.halfW,
    other.x, other.z, Math.cos(other.heading), Math.sin(other.heading), other.halfL, other.halfW,
  )
  return gapNext < gapPrev - 0.05
}

/**
 * Bumper-to-obstacle following/crossing gap (cells) for a traffic vehicle relative to one obstacle, or `Infinity` when
 * clear. Uses exact swept-path OBB checks for long transit vehicles AND for oblique-crossing cars (`-0.82 <= dot < -0.25`)
 * so diagonal intersections (like Columbus Ave) never drive through turning cross-traffic.
 */
export function trafficObstacleGap(
  c: { x: number; z: number; hx: number; hz: number; halfL: number; halfW: number; v: number; id: number },
  ob: { x: number; z: number; hx: number; hz: number; long: number; wide: number; v: number; id?: number },
): number {
  const dx = ob.x - c.x, dz = ob.z - c.z
  if (Math.abs(dx) > 450 || Math.abs(dz) > 450) return Infinity
  if (ob.long > 40) {
    const near = sweptPathNear(c.x, c.z, c.hx, c.hz, c.halfW + 1, ob)
    return near > 0 && near <= 400 ? near - c.halfL : Infinity
  }
  const dot = ob.hx * c.hx + ob.hz * c.hz
  if (ob.long > 3 && dot < -0.82) return Infinity
  if (ob.long > 3 && dot < -0.25) {
    const near = sweptPathNear(c.x, c.z, c.hx, c.hz, c.halfW + 1, ob)
    if (near <= 0 || near > 300) return Infinity
    if (ob.id !== undefined && c.v < 2 && ob.v < 2 && c.id < ob.id && near > c.halfL - 4) return Infinity
    return near - c.halfL
  }
  const ahead = dx * c.hx + dz * c.hz, across = Math.abs(dx * c.hz - dz * c.hx)
  const ext = Math.abs(ob.hx * c.hz - ob.hz * c.hx) * ob.long + Math.abs(dot) * ob.wide
  if (ahead <= 0 || ahead > 400 || across > c.halfW + ext * 0.9 + 2) return Infinity
  const g = ahead - c.halfL - (Math.abs(dot) * ob.long + Math.abs(ob.hx * c.hz - ob.hz * c.hx) * ob.wide)
  // Break perpendicular/oblique mutual deadlocks between two stopped traffic cars so intersections never gridlock (#129).
  if (Math.abs(dot) < 0.35 && ob.id !== undefined && c.v < 2 && ob.v < 2 && c.id < ob.id && g > -2) return Infinity
  return g
}

/**
 * Picks a departure phase offset `base` in `[0, every)` for each cable car line so cars sharing a corridor
 * (Powell–Hyde and Powell–Mason on Powell & Washington Sts) or crossing (California St) keep positive OBB
 * clearance throughout the entire shared period. Deterministic from each line's seed.
 */
export function coordinateCablePhases<L extends { p: ArrayLike<number>; cum: ArrayLike<number>; len: number; seed: number }>(
  lines: readonly L[],
  timetableAt: (l: L, left: number) => ArrayLike<number>,
  { every = CABLE_EVERY, cycle = CYCLE, step = 0.25, halfL = 44, halfW = 13, phaseStep = 4 }: { every?: number; cycle?: number; step?: number; halfL?: number; halfW?: number; phaseStep?: number } = {},
): Map<L, number> {
  const bases = new Map<L, number>()
  if (!lines.length) return bases
  const placed: { x: number; z: number; tx: number; tz: number }[][][] = []
  const Q = { x: 0, z: 0, tx: 1, tz: 0 }
  const sample = (l: L, base: number) => {
    const tt = timetableAt(l, ((base % cycle) + cycle) % cycle)
    const frames: { x: number; z: number; tx: number; tz: number }[][] = Array.from({ length: every }, () => [])
    for (let t = 0; t < every; t++) {
      for (let dt = ((t - base) % every + every) % every; ; dt += every) {
        const f = dt / step, i = Math.floor(f)
        if (i + 1 >= tt.length) break
        const s = tt[i] + (tt[i + 1] - tt[i]) * (f - i)
        along(l.p, l.cum, s, Q)
        frames[t].push({ x: Q.x, z: Q.z, tx: Q.tx, tz: Q.tz })
      }
    }
    return frames
  }
  const minGap = (cand: ReturnType<typeof sample>) => {
    let worst = Infinity
    for (const prev of placed) {
      for (let t = 0; t < every; t++) {
        const a = cand[t], b = prev[t]
        for (let i = 0; i < a.length; i++) {
          const ci = a[i]
          for (let j = 0; j < b.length; j++) {
            const cj = b[j]
            if (Math.abs(ci.x - cj.x) > 200 || Math.abs(ci.z - cj.z) > 200) continue
            const g = boxGap(ci.x, ci.z, ci.tx, ci.tz, halfL, halfW, cj.x, cj.z, cj.tx, cj.tz, halfL, halfW)
            if (g < worst) worst = g
          }
        }
      }
    }
    return worst
  }
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li]
    const seedStart = Math.floor(chance(l.seed, 1) * (every / phaseStep)) * phaseStep
    if (li === 0) {
      bases.set(l, seedStart)
      placed.push(sample(l, seedStart))
      continue
    }
    let bestBase = seedStart, bestGap = -Infinity, bestFrames: ReturnType<typeof sample> | null = null
    for (let k = 0; k < every; k += phaseStep) {
      const b = (seedStart + k) % every
      const cand = sample(l, b)
      const g = minGap(cand)
      if (g > bestGap) { bestGap = g; bestBase = b; bestFrames = cand }
    }
    // If coarse search landed tight (< 5 cells), refine +-3 s at 1 s resolution around the best phase.
    if (bestGap < 5 && phaseStep > 1) {
      for (let d = -phaseStep + 1; d < phaseStep; d++) {
        if (d === 0) continue
        const b = ((bestBase + d) % every + every) % every
        const cand = sample(l, b)
        const g = minGap(cand)
        if (g > bestGap) { bestGap = g; bestBase = b; bestFrames = cand }
      }
    }
    bases.set(l, bestBase)
    placed.push(bestFrames ?? sample(l, bestBase))
  }
  return bases
}

/** Where along a line a distance is, and which way it runs there. */
function along(p: ArrayLike<number>, cum: ArrayLike<number>, s: number, into: { x: number; z: number; tx: number; tz: number }): number {
  const n = cum.length
  if (n < 2) { into.x = p[0]; into.z = p[1]; into.tx = 1; into.tz = 0; return 0 }
  if (s <= 0) { into.x = p[0]; into.z = p[1]; seg(p, 0, into); return 0 }
  if (s >= cum[n - 1]) { into.x = p[2 * n - 2]; into.z = p[2 * n - 1]; seg(p, n - 2, into); return n - 2 }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m }
  const f = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])
  into.x = p[2 * lo] + (p[2 * hi] - p[2 * lo]) * f; into.z = p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * f
  seg(p, lo, into)
  return lo
}
function seg(p: ArrayLike<number>, i: number, into: { tx: number; tz: number }) { const dx = p[2 * i + 2] - p[2 * i], dz = p[2 * i + 3] - p[2 * i + 1], l = Math.hypot(dx, dz) || 1; into.tx = dx / l; into.tz = dz / l }
function line(flat: readonly number[], from: number): { p: Ring; cum: Ring; len: number } {
  const n = (flat.length - from) >> 1, p = new Float64Array(n * 2), cum = new Float64Array(n)
  for (let i = 0; i < n * 2; i++) p[i] = flat[from + i]
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1])
  return { p, cum, len: cum[n - 1] }
}

/** High-speed clean close pass past a street vehicle (speed in km/h, lateral clearance in metres, world position in cells). */
export interface NearMiss { speedKmh: number; clearance: number; at: [number, number, number] }
/** Contact between the driven vehicle and a street vehicle (speed in cells/s, normalised force 0..1). */
export interface StreetCrash { at: [number, number, number]; speed: number; force: number; car: string; woke: boolean }
/** A nearby traffic vehicle honking back in response to the player's horn or a stuck robotaxi. */
export interface TrafficHorn { at: [number, number, number]; pitch: number; annoyed: boolean }
/** A frustrated pedestrian yelling at a stuck robotaxi blocking traffic. */
export interface CrowdShout { service: string; serviceName: string; name: string; text: string; at: [number, number, number] }

export interface Street {
  /** The people to draw, for people.ts `from`. */
  folk(view: View, seconds: number): readonly Person[]
  /** Drives, parks and draws the vehicles: once a frame, before the pieces are drawn. */
  frame(dt: number, view: View): void
  /** Everything as it was: the traffic begins again, every parked car is back at its kerb. */
  reset(): void
  /** Callback fired on a high-speed clean close pass (> 65 km/h within ~2.0 m lateral clearance, 3 s per-car cooldown). */
  onNearMiss?: (info: NearMiss) => void
  /** What is in sight: people and vehicles within `r` cells of a point (both counted on the ground plan) and in the eye's view. */
  count(view: View, r?: number): { people: number; peopleSeen: number; parked: number; traffic: number; cable: number; tram: number; bus: number; trolley: number; van: number; truck: number; robotaxi: number; robotaxiStuck: number; vehiclesSeen: number; living: number; waiting: number; crossingRed: number; crossingLights: number; craters: number; blockedRoads: number; parkedInLane: number; signStops: number; parkedInLaneNow: number; heads: number; headsShown: number; headsLit: Record<string, number> }
  /** Autonomous robotaxi services, stations, stuck-incident & crowd-reaction inspection and deterministic test triggers. */
  readonly robotaxis: {
    readonly services: { id: string; name: string; badge: string; station: string }[]
    readonly stations: { serviceId: string; serviceName: string; name: string; cx: number; cz: number; visit: readonly [number, number]; bays: number; occupied: number; exiting: number; entering: number; arrivals: number; departures: number; shown: boolean }[]
    readonly stuck: { id: number; serviceId: string; serviceName: string; kind: 'intersection' | 'narrow'; x: number; y: number; z: number; heading: number; pitch: number; age: number; hazardOn: boolean; hazardPhase: number }[]
    readonly reactions: { honks: number; shouts: number; filmers: number; yellers: number }
    triggerStuck(kind?: 'intersection' | 'narrow', serviceId?: string): { id: number; serviceId: string; serviceName: string; kind: 'intersection' | 'narrow'; x: number; y: number; z: number; heading: number } | null
  }
  /** The roads near a place, for a driver to follow (the checks). */
  roads(x: number, z: number, r: number): { key: string; name: number; lanes: number; flags: number; next: string[]; line: number[]; open: boolean | null }[]
  /** Vehicles near a place: where each stands, which way it heads, and what it is (`id` is its own for as long as it is there). */
  cars(x: number, z: number, r: number): { id: number; kind: Car['kind']; model: string; service: string; x: number; y: number; z: number; heading: number; name: string; v: number; living: boolean; wait: string; stuck: number }[]
  /** Full vehicle state snapshot within `r` cells for black-box telemetry, overlap detection, and replay. */
  snapshot(x: number, z: number, r: number): { id: number; kind: Car['kind']; model: string; name: string; x: number; y: number; z: number; heading: number; v: number; long: number; wide: number; road: string; lane: number; s: number; wait: string; stuck: number; blocked: boolean; living: boolean; emergency?: EmergencyKind; archetype?: string; laneShift?: number; sirenYieldShift?: number }[]
  /** Traffic AI telemetry counters (#164 Phase 3A). */
  trafficAiStats(): TrafficAiStats
  /** Spawns an emergency vehicle (`police` | `ambulance`) with active siren cone and roof flashers (#164 Phase 3A). */
  spawnEmergency(opts?: { kind?: EmergencyKind; at?: readonly [number, number]; siren?: boolean; roadKey?: string; lane?: number; s?: number }): { id: number; kind: EmergencyKind; x: number; y: number; z: number; heading: number; road: string; sirenActive: boolean } | null
  /** Recent pedestrian near-miss reaction cues readable by street/HUD/sound (#164 Phase 3A). */
  readonly nearMissCues: readonly PedestrianNearMissCue[]
  /** Deterministic xorshift32 PRNG state for traffic replay. */
  rng: number
  /** Seconds from now on the clock people walk by until a cable car is nearest a place, and how near it comes (cells); null with no line. */
  cable(x: number, z: number): { in: number; near: number } | null
  /** Off, nothing of street life is worked out or drawn (for timing what it costs). */
  enabled: boolean
  /** Pre-warms location-independent vehicle models, smooth faces and robotaxi domes off-thread before landing. */
  prewarm(): void
  /** Pre-fetches the street-life graph squares around `(x, z)` cells ahead of arrival. */
  warmAt(x: number, z: number): void
  /** Appends active street-vehicle lights (traffic, robotaxis, trams, cable cars) to the shared GPU local-light sink. */
  lights(sink: LocalLightSink): void
  /** One of every kept vehicle side by side, `gap` cells apart (22), standing still, all facing a heading (radians) with their fronts on a line through a place (cells) and the row going off to their left: for looking at them (the checks' line-up). Null clears it. */
  lineup(at: readonly [number, number] | null, heading?: number, gap?: number): string[]
  /**
   * The rules kept, over `seconds` of the clock from now (for the checks): every cable car crossing a stop line with
   * lights, and how many of those at red; left turns on green as they crossed the line, and how many with something
   * coming the other way; the buses and trolleybuses driving, how many on their route, and the stops they served.
   */
  audit(seconds: number): { cable: { lines: number; crossings: number; red: number; amber: number; redAt: object[] }; left: { turns: number; conflicts: number }; buses: { driving: number; onRoute: number; trolleys: number; trolleysWired: number; stops: number; pieces: number } }
  /** Rules turned off, to show what each is for (the checks): left turns that wait for nobody, cable cars that pass every light. */
  rules: { yieldLeft: boolean; cableLights: boolean }
  /** What is on its way to life and which faces are made (for the checks). */
  readonly debug: unknown
  readonly red: unknown
  /** Three-Ring Multi-Tier AI LOD counts and suppression telemetry (#164). */
  readonly lod: LodStats
  trace(seed: number, times: number[]): unknown
  readonly ms: number
  readonly ready: boolean
}

export function street(o: {
  /** Where the life files (`life/index.json`) and the kept vehicles (`cars/index.json`) are. */
  life: URL; cars: URL
  land: Ground
  /** Whether the finest terrain tiles covering `(x, z)` are loaded, so parked cars re-settle once fine ground arrives. */
  fine?: (x: number, z: number) => boolean
  hour: () => number; rain: () => number
  /** How far lamps and headlights are on (0 by day to 1 at night/rain/fog, march.lights). */
  lights?: () => number
  /** Seconds on the clock people walk by. */
  clock: () => number
  shocks: readonly Shock[]
  /** Residents currently promoted to authoritative world actors: suppressed here so they never double-render (#164). */
  taken?: { has(seed: number): boolean }
  /** Where the cutter cut (main.ts `cut`): the road there is looked at as a blast's is. */
  cuts?: readonly { at: readonly [number, number, number]; radius: number }[]
  /** Where everyone else stands (their feet): people go round them, cars wait for them. */
  bodies: () => readonly (readonly [number, number, number])[]
  /** Where this page's own person stands on foot, or null: what is near is near them. */
  feet: () => readonly [number, number, number] | null
  pieces: Pieces
  alive: Living
  hud: Hud
  input: Input
  /** Faces made for a look's cells, for the page to keep beside the ones it makes itself (main.ts): a car brought to life finds its look's faces made. */
  faces?: (kinds: Uint16Array, size: readonly [number, number, number], born: Born) => void
  /** Pre-sculpted robotaxi models built off the page thread (robotaxi-maker.ts); built synchronously here when omitted. */
  robotaxis?: Promise<readonly RobotaxiModel[]>
  /** Called on a high-speed clean close pass past a parked or traffic car. */
  onNearMiss?: (info: NearMiss) => void
  /** Called when the driven vehicle collides with a street vehicle (for sparks, audio, and events). */
  onCrash?: (info: StreetCrash) => void
  /** Called when a nearby traffic car honks back after the player honks or at a stuck robotaxi. */
  onHorn?: (info: TrafficHorn) => void
  /** Called when a bystander yells at a stuck robotaxi blocking an intersection or narrow street. */
  onShout?: (info: CrowdShout) => void
}): Street {
  // ── The graph, a square at a time ──
  const walkGraph: WalkGraph = createWalkGraph()
  const roads = new Map<string, Road>(), roadsFrom = new Map<number, Road[]>(), roadsTo = new Map<number, Road[]>(), ways = new Map<number, Set<number>>()
  const slots: Slot[] = [], lines: Line[] = []
  /** The signal heads (sf/life.py): where each post stands, and the road whose lights it shows. */
  const heads: { key: string; x: number; z: number; piece: Piece | null; shown: string; curbed?: boolean }[] = [], headGrid = new Map<number, number[]>()
  const GRID = 1000
  const roadGrid = new Map<number, Road[]>(), slotGrid = new Map<number, number[]>()
  const cell = (gx: number, gz: number) => gx * 100003 + gz
  const file = (grid: Map<number, unknown[]>, x0: number, z0: number, x1: number, z1: number, v: unknown) => {
    for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) { const k = cell(gx, gz); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(v) }
  }
  const box = (p: Ring) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) } return [x0, z0, x1, z1] as const }
  let index: { life: Record<string, { path: string }>; transit?: { path: string } } | null = null
  /** The streetcar lines (life/transit.json), each a route's pieces of track in its order: driven, stopping at lights and behind cars. */
  const tramLines: (Line & { lights: { s: number; node: number; dx: number; dz: number }[] })[] = []
  /** The bus and trolleybus routes' pieces (life/transit.json `buses`). */
  const busPieces: BusPiece[] = []
  let routed = false
  const squares = new Map<string, 'asked' | 'held'>()
  const rails: { a: number; b: number; p: Ring }[] = []
  const take = (s: { walk: number[][]; roads: (number | number[])[][]; park: number[]; rail: number[][]; heads?: number[][] }, name = '') => {
    for (const [way, a, b, x, z] of s.heads ?? []) { const n = heads.push({ key: `${way}/${a}/${b}`, x, z, piece: null, shown: '' }) - 1; file(headGrid, x, z, x, z, n) }
    walkGraph.addSquare(name || `sq:${squares.size}`, s)
    for (const r of s.roads) {
      const [way, a, b, lanes, flags, next, ctl] = r as [number, number, number, number, number, number[], number]
      const { p, cum, len } = line(r as number[], 7)
      if (len < 1) continue
      const key = `${way}/${a}/${b}`, nexts: string[] = []
      for (let i = 0; i < next.length; i += 2) nexts.push(`${next[i]}/${b}/${next[i + 1]}`)
      // How many cars it carries, per cell of its length: by its class (sf/life.py: service, residential, tertiary,
      // secondary, primary, busway) and its lanes; an alley or a place fewer still.
      const cls = flags >> 4, weight = [0.15, 0.5, 1, 1.5, 2, 0.4][cls] * (flags & 4 ? 0.5 : 1) * Math.min(3, lanes) / 1000
      const mid = { x: 0, z: 0, tx: 0, tz: 0 }
      along(p, cum, len / 2, mid)
      const road: Road = { key, way, a, b, lanes: Math.max(1, Math.min(4, lanes)), flags, next: nexts, ctl, cls, wired: (flags & 8) !== 0, blocked: false, p, cum, len, open: null, weight, mx: mid.x, mz: mid.z }
      roads.set(key, road)
      let from = roadsFrom.get(a); if (!from) roadsFrom.set(a, from = []); from.push(road)
      let to = roadsTo.get(b); if (!to) roadsTo.set(b, to = []); to.push(road)
      for (const n of [a, b]) { let w = ways.get(n); if (!w) ways.set(n, w = new Set()); w.add(way) }
      const [x0, z0, x1, z1] = box(p)
      file(roadGrid, x0, z0, x1, z1, road)
    }
    for (let i = 0; i < s.park.length; i += 4) {
      const n = slots.push({ x: s.park[i], z: s.park[i + 1], yaw: s.park[i + 2] / 100, mapped: s.park[i + 3] === 1, seed: mix(s.park[i], s.park[i + 1]) }) - 1
      file(slotGrid, s.park[i], s.park[i + 1], s.park[i], s.park[i + 1], n)
    }
    for (const r of s.rail) if (r[2] === 1) rails.push({ a: r[0], b: r[1], p: line(r, 3).p })
    // (The rail's own joining is only for a release without transit routes.)
    if (!routed) joinRails()
    for (const l of [...tramLines, ...lines]) { l.lights!.length = 0; lightsDone.delete(l) }
    // A junction on a seam is whole only now: walks timed against half of it are timed again, and the cable cars'
    // timetables.
    junctions.clear(); timetables.clear(); cableBases.clear()
  }
  /** The cable car lines: track pieces joined end to end where only two meet, longest first. */
  const joinRails = () => {
    lines.length = 0; cableBases.clear()
    const ends = new Map<number, number[]>()
    rails.forEach((r, i) => { for (const n of [r.a, r.b]) { let l = ends.get(n); if (!l) ends.set(n, l = []); l.push(i) } })
    const used = new Set<number>()
    for (let i = 0; i < rails.length; i++) {
      if (used.has(i)) continue
      used.add(i)
      let pts = Array.from(rails[i].p), head = rails[i].b, tail = rails[i].a
      // Forward from its end, then back from its start, while the way on is one piece.
      for (const forward of [true, false]) {
        for (;;) {
          const at = forward ? head : tail, on = (ends.get(at) ?? []).filter((j) => !used.has(j))
          if (on.length !== 1 || (ends.get(at) ?? []).length > 2) break
          const j = on[0], r = rails[j], q = Array.from(r.p)
          used.add(j)
          const flip = (r.a === at) !== forward
          const add = flip ? q.reduceRight((acc: number[], _v, k) => { if (k % 2 === 0) acc.push(q[k], q[k + 1]); return acc }, []) : q
          if (forward) { pts = pts.concat(add.slice(2)); head = flip ? r.a : r.b } else { pts = add.slice(0, -2).concat(pts); tail = flip ? r.b : r.a }
        }
      }
      const l = line(pts, 0)
      if (l.len > 3000) lines.push({ ...l, seed: mix(Math.round(pts[0]), Math.round(pts[1])), lights: [] })
    }
  }
  const squareOf = (name: string) => { const [e, n] = name.split('_').map((v) => Number(v) * 1000); return [(e - 500000) * 10, (4250000 - n - 1000) * 10, (e + 1000 - 500000) * 10, (4250000 - n) * 10] }
  /** Life files on their way: at most `LIFE_AT_ONCE` (#81), the nearest the eye first, so a jump across the city does not ask for a dozen at once. */
  let lifeComing = 0
  const LIFE_AT_ONCE = 3
  const lifePacks = PACKS_ENABLED ? LOCAL?.packs ?? null : null
  const lifeReleaseRoot = new URL('../', o.life)
  const lifeJson = async <T>(relPath: string, packUrl: string | null): Promise<T | null> => {
    if (packUrl) {
      const packed = await readPackedJson<T>(packUrl, `life/${relPath}`)
      if (packed) return packed
    }
    return fetch(new URL(relPath, o.life)).then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null)
  }
  const wanted = (eye: readonly number[]) => {
    if (!index || lifeComing >= LIFE_AT_ONCE) return
    const near: { name: string; d: number }[] = []
    for (const name of Object.keys(index.life)) {
      if (squares.has(name)) continue
      const [x0, z0, x1, z1] = squareOf(name), dx = Math.max(x0 - eye[0], 0, eye[0] - x1), dz = Math.max(z0 - eye[2], 0, eye[2] - z1), d = Math.hypot(dx, dz)
      if (d <= 15000) near.push({ name, d })
    }
    near.sort((a, b) => a.d - b.d)
    for (const { name } of near.slice(0, LIFE_AT_ONCE - lifeComing)) {
      squares.set(name, 'asked')
      lifeComing++
      const packName = lifePacks?.life ? squarePackName('life', name, lifePacks.life) : null
      const packUrl = packName ? new URL(`${lifePacks!.dir ?? 'packs/'}${packName}`, lifeReleaseRoot).href : null
      void lifeJson<Parameters<typeof take>[0]>(index.life[name].path, packUrl).then((s) => { if (s) { take(s, name); squares.set(name, 'held') } else squares.delete(name) }, () => squares.delete(name)).finally(() => { lifeComing-- })
    }
  }
  /**
   * The life files' listing and the transit routes: asked for the first time street life is on or prewarmed (#81),
   * not as the page opens. In the first view it sleeps (main.ts `leaveLanding`), and a visitor who bounces off the landing costs none of these.
   */
  let pendingWarm: readonly [number, number, number] | null = null
  let lifeAsked = false
  const askLife = () => {
    if (lifeAsked) return
    lifeAsked = true
    const metaPack = lifePacks?.lifeMeta ? new URL(lifePacks.lifeMeta, lifeReleaseRoot).href : null
    void lifeJson<typeof index>('index.json', metaPack).then((i) => {
      if (!i) return
      index = i
      if (pendingWarm) wanted(pendingWarm)
      if (!i.transit) return
      void lifeJson<{ routes: { ref: string; kind: string; lines: number[][] }[]; buses?: { ref: string; kind: string; operator: string; hours: [number, number]; pieces: { roads: string[]; stops: [number, number][] }[] }[] }>(i.transit.path, metaPack).then((t) => {
        if (!t) return
        // The cable cars run their routes as OSM orders them, one way each; the streetcars are driven.
        lines.length = 0; cableBases.clear()
        for (const route of t.routes) for (const flat of route.lines) {
          const l = line(flat, 0)
          if (l.len < 3000) continue
          const seed = mix(Math.round(flat[0]), Math.round(flat[1]))
          if (route.kind === 'cable') lines.push({ ...l, seed, lights: [] })
          else tramLines.push({ ...l, seed, lights: [] })
        }
        // The buses' and trolleybuses' routes, a piece at a time: a Muni line every 8 minutes or so at its usual 7 m/s
        // between stops, another operator's every 20.
        for (const b of t.buses ?? []) for (const p of b.pieces) {
          const seed = mix(idSeed(Number(p.roads[0].split('/')[0])), b.ref.split('').reduce((h, ch) => mix(h, ch.charCodeAt(0)), 7))
          busPieces.push({ keys: p.roads, stops: p.stops, seed, apart: (/muni/i.test(b.operator) ? 8 : 20) * 60 * 70, kind: b.kind === 'trolleybus' ? 'trolley' : 'bus', hours: b.hours, ref: b.ref })
        }
        for (const r of roads.values()) r.railShift = undefined
        routed = true
      }, () => {})
    }, () => {})
  }

  // ── People (delegated to shared deterministic sf-walks.mjs evaluator + Three-Ring AI LOD, #164) ──
  /** Feet on the ground: the Bay's footing, but never on a roof over the pavement (an arcade, an awning). */
  const feetAt = (x: number, z: number) => { const ix = Math.round(x), iz = Math.round(z), f = o.land.feet_at(ix, iz), g = o.land.ground_at(ix, iz); return f - g > 25 ? g + 1 : f }
  /** Crash-induced shocks for pedestrians (separate from bomb blasts in `o.shocks` so crashes never crater roads or toss unrelated cars). */
  const crashShocks: Shock[] = []
  /** Most recent player horn pulse while driving, for pedestrian startle/step-clear within 14 m. */
  let hornPulse: { x: number; y: number; z: number; fx: number; fz: number; t: number } | null = null
  /** How far someone steps aside (to their right, cells; under 0 to their left) to go round whoever stands in their way. */
  const aside = (x: number, z: number, high: number, hx: number, hz: number, bodies: readonly (readonly [number, number, number])[]) => {
    let step = 0
    const ix = -hz, iz = hx
    for (const b of bodies) {
      const dx = b[0] - x, dz = b[2] - z
      if (Math.abs(dx) > 36 || Math.abs(dz) > 36 || Math.abs(b[1] - high) > 25) continue
      const ahead = dx * hx + dz * hz, across = dx * ix + dz * iz
      const near = ease((ahead + 22) / 18) * (1 - ease((ahead - 8) / 28))
      if (near <= 0 || Math.abs(across) >= 7) continue
      step -= (across > -1 ? 1 : -1) * (7 - Math.abs(across)) * near
    }
    return Math.max(-12, Math.min(12, step))
  }
  const shown: Person[] = [], held = new Map<number, { x: number; z: number; at: number }>()
  const watching = new Map<number, { car: number; when: number; seen: number; left?: number }>()
  let lastSeconds = 0
  let lastLod: LodStats = { ring1: 0, ring2: 0, ring3: 0, total: 0, capped: 0, suppressedTaken: 0, caps: { ...DEFAULT_RING_CAPS } }
  let macroAt = -99, macroRing3 = 0
  /** Where people were drawn last, for the cars to wait for them on a crossing, plus Ring-1 sidewalk pedestrians for near-miss reactions. */
  const crossing: [number, number][] = []
  const nearPeds: [number, number][] = []
  /** Living City Traffic AI state (#164 Phase 3A): sim clock, stats, detour cache, & pedestrian near-miss reaction cues. */
  let simTime = 0
  const aiStats: TrafficAiStats = { laneChanges: 0, detours: 0, sirenYields: 0, activeEmergency: 0, deadlocksResolved: 0 }
  const detourCache = createDetourCache(256)
  const nearMissCues: PedestrianNearMissCue[] = []
  const pedNearMissCool = new Map<string, number>()
  let nextNearMissCueId = 1
  let activeCongested = new Set<string>()
  let activeBlockedSig = ''
  let lastCrowdShout = -99, crowdShoutsStat = 0, rtFilmersStat = 0, rtYellersStat = 0, stuckHonksStat = 0, lastStuckHorn = -99
  let peopleMs = 0
  const folk = (view: View, seconds: number): readonly Person[] => {
    if (!on) { shown.length = 0; return shown }
    begin()
    const t0 = performance.now(), t = o.clock(), hour = o.hour(), rain = o.rain(), eye = view.eye, bodies = o.bodies()
    const dt = Math.max(0, Math.min(0.1, seconds - lastSeconds))
    lastSeconds = seconds
    wanted(eye)
    const nowPerf = performance.now() / 1000
    const activeHorn = hornPulse && nowPerf - hornPulse.t < 2.6 ? hornPulse : null
    if (hornPulse && !activeHorn) hornPulse = null
    // Stuck robotaxis that nearby Ring-1 sidewalk pedestrians react to (turning, yelling, and filming with phones).
    const stuckRT = traffic.filter((c) => c.rtStuck && nowPerf - c.rtStuck.at > 0.6 && Math.hypot(c.x - eye[0], c.z - eye[2]) < REACH + 250)
    const stuckIds = new Set(stuckRT.map((c) => c.id))
    const nearCars = stuckRT.length
      ? [...traffic, ...depotCars, ...parked.values()].filter((c) => Math.hypot(c.x - eye[0], c.z - eye[2]) < 380)
      : []
    const bubblePts: [number, number, number, number][] = []
    // Match people.ts SIGN depth bias (28 cells forward): test only obstacles closer than dist - 28 so walls behind/beside a sidewalk speaker never false-reject, while foreground awnings/buildings that would slice the pill DO reject!
    const rayFree = (tx: number, ty: number, tz: number, pull: number) => {
      const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2]
      const dist = Math.hypot(dx, dy, dz)
      const end = dist - pull
      if (end <= 12) return true
      const steps = Math.min(48, Math.max(10, Math.ceil(end / 4)))
      const uMax = end / dist
      for (let k = 1; k <= steps; k++) {
        const u = 0.06 + (k / steps) * (uMax - 0.06)
        if (u <= 0.05 || u >= uMax) continue
        if (o.land.world_kind(Math.floor(eye[0] + dx * u), Math.floor(eye[1] + dy * u), Math.floor(eye[2] + dz * u)) !== 0) return false
      }
      return true
    }
    // Only show a bystander speech bubble when the speaker AND full pill width have clean LOS (never awning-sliced or hidden behind a vehicle!)
    // and clear both 3D and screen-space separation from other active bubbles.
    const bubblePos = (px: number, py: number, pz: number): [number, number] | null => {
      if (bubblePts.length >= 8) return null
      const dx = px - eye[0], dy = py + 23 - eye[1], dz = pz - eye[2]
      const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]
      if (ahead < 18) return null
      const sx = (dx * view.right[0] + dy * view.right[1] + dz * view.right[2]) / (ahead * view.tanHalf * 1.78)
      const sy = (dx * view.up[0] + dy * view.up[1] + dz * view.up[2]) / (ahead * view.tanHalf)
      if (Math.abs(sx) > 0.88 || Math.abs(sy) > 0.86) return null
      for (const b of bubblePts) {
        if (Math.hypot(px - b[0], pz - b[1]) <= 44) return null
        if (Math.abs(sx - b[2]) < 0.44 && Math.abs(sy - b[3]) < 0.26) return null
      }
      const l2 = dx * dx + dz * dz
      if (l2 > 16) {
        for (const c of nearCars) {
          const t = ((c.x - eye[0]) * dx + (c.z - eye[2]) * dz) / l2
          if (t <= 0.04 || t >= 0.96) continue
          const perp = Math.hypot(c.x - (eye[0] + dx * t), c.z - (eye[2] + dz * t))
          const rad = Math.max(c.model.long, c.model.wide) * 0.58 + 7
          const rayY = eye[1] + (py + 19 - eye[1]) * t
          if (perp < rad && rayY < c.y + c.model.size[1] + 10) return null
        }
        // Also avoid signal-light posts standing directly between the eye and the speech pill (signal heads are pieces, not world_kind!).
        for (const h of headsShown) {
          const t = ((h.x - eye[0]) * dx + (h.z - eye[2]) * dz) / l2
          if (t <= 0.04 || t >= 0.96) continue
          const perp = Math.hypot(h.x - (eye[0] + dx * t), h.z - (eye[2] + dz * t))
          if (perp < 11) return null
        }
      }
      if (!rayFree(px, py + 15, pz, 12)) return null
      // Reject speakers standing directly underneath a storefront awning/overhang so dark speech pills never merge into black awnings!
      for (const oy of [20, 26, 32, 38]) {
        for (const ox of [-2, 0, 2]) {
          if (o.land.world_kind(Math.floor(px + view.right[0] * ox), Math.floor(py + oy), Math.floor(pz + view.right[2] * ox)) !== 0) return null
        }
      }
      // Test the true distance-scaled world footprint of the people.ts SIGN pill against foreground obstacles,
      // and ensure the pill's center doesn't sit directly over an awning overhang behind the speaker.
      const pillTall = Math.max(0.038 * 2 * view.tanHalf * ahead, 2.8) * 1.45
      const pillHalfW = Math.max(16, pillTall * 2.5)
      for (const fy of [0.2, 0.8]) {
        const ty = py + 19.5 + pillTall * fy
        for (const fx of [-0.8, 0, 0.8]) {
          const off = pillHalfW * fx
          const tx = px + view.right[0] * off, tz = pz + view.right[2] * off
          if (!rayFree(tx, ty, tz, 22)) return null
        }
        // Check center of pill for a dark awning immediately behind the speaker so pills never merge into a black awning band.
        for (const back of [4, 12]) {
          const bx = Math.floor(px + view.forward[0] * back)
          const by = Math.floor(ty + view.forward[1] * back)
          const bz = Math.floor(pz + view.forward[2] * back)
          if (o.land.world_kind(bx, by, bz) !== 0 && o.land.world_kind(bx, by - 12, bz) === 0) return null
        }
      }
      return [sx, sy]
    }

    const timeOf = watching.size
      ? (seed: number, baseTime: number, st: { down: number; flinch: number; turned: number; frozen: boolean }) => {
        const watch = watching.get(seed)
        if (!watch) return baseTime
        if (st.down || st.flinch || st.turned || st.frozen || t < watch.when) { watching.delete(seed); return baseTime }
        if (!stuckIds.has(watch.car)) watch.left ??= t
        // Hold the walk itself while watching. Resume along it and catch up as after a startle.
        const rt = watch.left === undefined ? watch.when : Math.min(t, watch.when + (t - watch.left) * 1.7)
        if (watch.left !== undefined && rt >= t) watching.delete(seed)
        watch.seen = seconds
        return rt
      }
      : undefined

    // Shared deterministic pedestrian evaluation + Three-Ring AI LOD classification & taken suppression (#164).
    const queried = walkGraph.query([eye[0], eye[2]], {
      reach: REACH,
      t,
      hour,
      rain,
      taken: o.taken,
      shocks: o.shocks,
      crashShocks,
      feetAt,
      ring3Feet: true,
      timeOf,
    })

    // Refresh Ring-3 macro city count (110–300 m) at throttled cadence so telemetry stays live at near-zero CPU cost.
    if (seconds - macroAt >= 0.5 || seconds < macroAt) {
      macroAt = seconds
      const macro = walkGraph.query([eye[0], eye[2]], { reach: RING3_RADIUS, t, hour, rain, taken: o.taken })
      macroRing3 = macro.stats.ring3
    }
    lastLod = { ...queried.stats, ring3: Math.max(queried.stats.ring3, macroRing3), total: queried.stats.ring1 + queried.stats.ring2 + Math.max(queried.stats.ring3, macroRing3) }

    let filmersNow = 0, yellersNow = 0
    let n = 0
    crossing.length = 0
    nearPeds.length = 0
    for (let idx = 0; idx < queried.people.length; idx++) {
      const ev = queried.people[idx]
      const { seed, down, flinch, turned, frozen, lod } = ev
      let x = ev.x, z = ev.z, y = ev.at[1], yaw = ev.yaw
      const hx = ev.hx, hz = ev.hz
      let hornFlinch = 0, hornTurn = 0, hornToward = 0, hornGlance = 0
      let rtReact: { car: Car; env: number; toward: number; dist: number } | null = null
      let glance = 0

      // Ring 1 (<= 35 m): full detail — obstacle avoidance, horn & robotaxi micro-reactions, and head-turn gaze.
      if (lod === 1) {
        const high = feetAt(x, z)
        const want = bodies.length && !down ? aside(x, z, high, hx, hz, bodies) : 0
        let hdx = 0, hdz = 0
        if (activeHorn && !down) {
          const dx = x - activeHorn.x, dz = z - activeHorn.z, d = Math.hypot(dx, dz)
          if (d < 140 && Math.abs(high - activeHorn.y) < 30) {
            const age = nowPerf - activeHorn.t
            const nearness = 1 - ease((d - 30) / 110)
            hornFlinch = ease(age / 0.14) * (1 - ease((age - 0.55) / 0.85)) * nearness * 0.65
            hornToward = Math.atan2(activeHorn.x - x, -(activeHorn.z - z))
            const turnEnv = ease(age / 0.18) * (1 - ease((age - 1.4) / 1.1))
            if (d < 95) hornTurn = 0.65 * turnEnv * nearness
            else hornGlance = turnEnv * nearness
            const ahead = dx * activeHorn.fx + dz * activeHorn.fz
            const lat = dx * (-activeHorn.fz) + dz * activeHorn.fx
            if (ahead > -25 && ahead < 140 && Math.abs(lat) < 55) {
              const sideSign = lat >= 0 ? 1 : -1
              const clear = (1 - ease((Math.abs(lat) - 16) / 39)) * ease(age / 0.22) * (1 - ease((age - 1.55) / 1.0)) * 14
              hdx = -activeHorn.fz * sideSign * clear
              hdz = activeHorn.fx * sideSign * clear
            }
          }
        }
        // Pedestrian-vehicle near-miss micro-reactions (#164 Phase 3A): visibly flinch and step back away from close passing cars.
        if (nearMissCues.length && !down) {
          for (let ci = 0; ci < nearMissCues.length; ci++) {
            const cue = nearMissCues[ci]
            const age = simTime - cue.at
            if (age < 0 || age > 2.2) continue
            const distC = Math.hypot(x - cue.pedX, z - cue.pedZ)
            if (distC > 38) continue
            const nearEnv = 1 - ease((distC - 12) / 26)
            const flinchEnv = ease(age / 0.12) * (1 - ease((age - 0.55) / 0.9)) * cue.severity * nearEnv * 0.85
            if (flinchEnv > hornFlinch) {
              hornFlinch = flinchEnv
              hornToward = Math.atan2(cue.carX - x, -(cue.carZ - z))
              hornGlance = Math.max(hornGlance, Math.min(1, flinchEnv * 1.1))
            }
            const stepAmt = ease(age / 0.16) * (1 - ease((age - 0.75) / 1.1)) * (10 + 10 * cue.severity) * nearEnv
            hdx += cue.stepDirX * stepAmt
            hdz += cue.stepDirZ * stepAmt
          }
        }
        // Crowd reaction to a stuck robotaxi blocking an intersection or narrow street:
        // Sidewalk pedestrians within 28 m step out from shaded storefronts/awnings to the open curb edge, turn toward it, film with phones, or gesture & yell!
        let rtdx = 0, rtdz = 0
        if (stuckRT.length && !down && !flinch && !ev.crossing) {
          let bestD = 280, bestC: Car | null = null
          for (const sc of stuckRT) {
            const d = Math.hypot(sc.x - x, sc.z - z)
            if (d < bestD && Math.abs(sc.y - high) < 40) { bestD = d; bestC = sc }
          }
          if (bestC) {
            const age = nowPerf - bestC.rtStuck!.at
            const env = ease((age - 0.5) / 0.7) * (1 - ease((bestD - 200) / 80))
            if (env > 0.05) {
              rtReact = { car: bestC, env, toward: Math.atan2(bestC.x - x, -(bestC.z - z)), dist: bestD }
              const watch = watching.get(seed)
              if (!watch || watch.car !== bestC.id || watch.left !== undefined) {
                watching.set(seed, { car: bestC.id, when: ev.routeTime, seen: seconds })
              }
              const vx = bestC.x - x, vz = bestC.z - z, vl = Math.hypot(vx, vz) || 1
              const ux = vx / vl, uz = vz / vl
              const curbSafe = (tx: number, tz: number) => {
                if (inLane(tx, tz, 12)) return false
                const ix = Math.round(tx), iz = Math.round(tz), fy = feetAt(tx, tz)
                if (Math.abs(fy - high) > 8) return false
                // Check the actual pavement voxel UNDER their shoes (not top_at, which hits overhead awnings!).
                const groundMat = o.land.world_kind(ix, fy - 1, iz) & 15
                if (groundMat === 6 || groundMat === 12 || groundMat === 4) return false
                return o.land.world_kind(ix, fy + 10, iz) === 0
              }
              const openSky = (tx: number, tz: number) => {
                const ix = Math.round(tx), iz = Math.round(tz), fy = feetAt(tx, tz)
                for (let yy = 18; yy <= 40; yy += 4) if (o.land.world_kind(ix, fy + yy, iz) !== 0) return false
                return true
              }
              let bestStep = 0
              for (let step = 4; step <= 44; step += 4) {
                const tx = x + ux * step, tz = z + uz * step
                if (!curbSafe(tx, tz)) break
                bestStep = step
                if (openSky(tx, tz) && step >= 24) break
              }
              if (bestStep > 0) {
                const moveEnv = ease((age - 0.45) / 0.9)
                rtdx = ux * bestStep * moveEnv
                rtdz = uz * bestStep * moveEnv
              }
            }
          }
        }
        let a = held.get(seed)
        if (want || hdx || hdz || rtdx || rtdz || a) {
          if (!a) held.set(seed, a = { x: 0, z: 0, at: seconds })
          if (seconds - a.at > 1) { a.x = 0; a.z = 0 }
          const tx = -hz * want + hdx + rtdx, tz = hx * want + hdz + rtdz, k = 1 - Math.exp(-dt * 9), dx = (tx - a.x) * k, dz = (tz - a.z) * k, d = Math.hypot(dx, dz), most = (hdx || hdz || rtdx || rtdz ? 18 : 11) * dt
          a.x += d > most ? (dx * most) / d : dx; a.z += d > most ? (dz * most) / d : dz; a.at = seconds
          x += a.x; z += a.z
          y = (feetAt(x + hx * 2, z + hz * 2) + feetAt(x - hx * 2, z - hz * 2) + feetAt(x, z)) / 3
          if (!want && !hdx && !hdz && !rtdx && !rtdz && Math.abs(a.x) + Math.abs(a.z) < 0.05) held.delete(seed)
        }
        if (!turned) {
          if (rtReact) { let by = rtReact.toward - yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; yaw += by * Math.min(1, rtReact.env * 1.15) }
          else if (hornTurn) { let by = hornToward - yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; yaw += by * hornTurn }
        }
        // They look at whoever is within three metres and not behind them, or glance toward a nearby honking car.
        if (!rtReact) {
          for (const b of bodies) {
            const dx = b[0] - x, dz = b[2] - z, d = Math.hypot(dx, dz)
            if (d > 32 || d < 1 || Math.abs(b[1] - y) > 25) continue
            let to = Math.atan2(dx, -dz) - yaw
            to -= Math.round(to / (Math.PI * 2)) * Math.PI * 2
            const keen = (1 - ease((d - 12) / 20)) * (1 - ease((Math.abs(to) - 1.3) / 0.9))
            if (Math.abs(to * keen) > Math.abs(glance)) glance = Math.max(-1, Math.min(1, to)) * keen
          }
          if (hornGlance && Math.abs(glance) < 0.2) {
            let to = hornToward - yaw
            to -= Math.round(to / (Math.PI * 2)) * Math.PI * 2
            glance = Math.max(-1, Math.min(1, to)) * hornGlance
          }
        }
      }

      const p = (shown[n] ??= { at: [0, 0, 0], yaw: 0, seed: 0 }) as { -readonly [K in keyof Person]: Person[K] }
      const at = (p.at as [number, number, number])
      at[0] = x; at[1] = y; at[2] = z
      p.yaw = yaw; p.seed = seed
      p.stride = ev.stride
      p.walking = frozen || rtReact ? 0 : ev.walking
      p.pace = ev.speed
      p.running = ev.speed > 16.5 ? Math.min(1, (ev.speed - 16.5) / 8) : 0
      // Ring 3 skips phone reading & micro-animations; Ring 1 & 2 show posture/reading/umbrella cleanly.
      p.reading = lod <= 2 && !rtReact && ev.still && ev.far && chance(seed, 29) < 0.45 && !hornFlinch ? ease((ev.stood - 2.5) / 1.2) : 0
      p.filming = 0
      p.robotaxiId = rtReact?.car.id
      p.move = undefined
      p.name = undefined
      p.says = undefined
      if (rtReact) {
        const svc = serviceOf(rtReact.car)
        const isFilmer = chance(seed, 71) < 0.46
        const phaseIdx = Math.floor((nowPerf + chance(seed, 72) * 10) / 5.5)
        if (isFilmer) {
          p.filming = rtReact.env
          filmersNow++
          if (rtReact.dist < 260 && chance(seed, 75 + (phaseIdx % 4)) < 0.72 && svc.filmLines.length) {
            const bp = bubblePos(x, at[1], z)
            if (bp) {
              p.says = svc.filmLines[Math.abs(mix(seed, phaseIdx)) % svc.filmLines.length]
              bubblePts.push([x, z, bp[0], bp[1]])
            }
          }
        } else {
          p.move = { move: NAMED_MOVES.yell, t: (seconds + chance(seed, 73) * 5) % 120 }
          yellersNow++
          const line = svc.yellLines[Math.abs(mix(seed, phaseIdx)) % svc.yellLines.length] ?? 'MOVE IT!'
          if (rtReact.dist < 265 && chance(seed, 76 + (phaseIdx % 4)) < 0.88) {
            const bp = bubblePos(x, at[1], z)
            if (bp) {
              p.says = line
              bubblePts.push([x, z, bp[0], bp[1]])
            }
          }
          const shoutSlot = Math.floor(nowPerf / 2.8)
          if (o.onShout && nowPerf - lastCrowdShout > 2.4 && Math.hypot(x - eye[0], z - eye[2]) < 360 && chance(seed, 79 + (shoutSlot & 15)) < 0.78) {
            lastCrowdShout = nowPerf
            crowdShoutsStat++
            o.onShout({ service: svc.id, serviceName: svc.name, name: `Bystander ${(seed >>> 0) % 64}`, text: line, at: [x, at[1] + 15, z] })
          }
        }
      }
      p.umbrella = ev.umbrella; p.time = seconds; p.flinch = Math.max(flinch, hornFlinch); p.down = down
      p.glance = glance
      const q = p as { waiting?: boolean; sig?: number; cdx?: number; cdz?: number; lod?: number; archetype?: string; activity?: string; phase?: string }
      q.waiting = ev.waiting; q.sig = ev.sig; q.cdx = ev.cdx; q.cdz = ev.cdz
      q.lod = lod; q.archetype = ev.archetype; q.activity = ev.activity; q.phase = ev.phase
      if (ev.crossing || ev.kind === 1) crossing.push([x, z])
      else if (lod === 1 && !down) nearPeds.push([x, z])
      n++
    }
    shown.length = n
    rtFilmersStat = filmersNow
    rtYellersStat = yellersNow
    if (held.size > 600) for (const [seed, a] of held) if (seconds - a.at > 5) held.delete(seed)
    for (const [seed, watch] of watching) if (seconds - watch.seen > 5) watching.delete(seed)
    peopleMs += (performance.now() - t0 - peopleMs) * 0.1
    return shown
  }

  // ── The kept vehicles ──
  const models = new Map<string, Promise<Model | null>>(), ready = new Map<string, Model>()
  let library: { id: string; kind: string }[] = []
  // Register every active robotaxi service from `ROBOTAXI_SERVICES` procedurally (zero extra fetches, works on every SF release).
  // When `o.robotaxis` is provided (built off the main thread in robotaxi-maker.ts), models arrive asynchronously without stalling boot.
  const serviceById = new Map<string, RobotaxiService>()
  const robotaxiModels = new Map<string, Model>()
  for (const svc of ROBOTAXI_SERVICES) serviceById.set(svc.id, svc)
  if (o.robotaxis) {
    for (const svc of ROBOTAXI_SERVICES) {
      models.set(svc.id, o.robotaxis.then((made) => made.find((m) => m.id === svc.id) ?? null))
    }
  } else {
    for (const svc of ROBOTAXI_SERVICES) {
      const built: Model = buildRobotaxiModel(svc)
      robotaxiModels.set(svc.id, built)
      ready.set(svc.id, built)
      models.set(svc.id, Promise.resolve(built))
    }
  }
  const serviceOf = (c: Car): RobotaxiService => serviceById.get(c.model.serviceId ?? '') ?? ROBOTAXI_SERVICES[0]
  const lidarBorn = (svc: RobotaxiService, stuck: boolean) => buildLidarDomeBorns(svc)[stuck ? 'stuck' : 'normal']
  const carsPackUrl = lifePacks?.cars ? new URL(lifePacks.cars, new URL('../', o.cars)).href : null
  const carsJson = async <T>(relPath: string): Promise<T | null> => {
    if (carsPackUrl) {
      const packed = await readPackedJson<T>(carsPackUrl, `cars/${relPath}`)
      if (packed) return packed
    }
    return fetch(new URL(relPath, o.cars)).then((r) => (r.ok ? (r.json() as Promise<T>) : null), () => null)
  }
  /** The kept vehicles' listing, and each of them: as the life files are, the first time street life is on (#81). */
  let carsAsked = false
  const askCars = () => {
    if (carsAsked) return
    carsAsked = true
    void carsJson<{ cars: { id: string; kind: string }[] }>('index.json').then((l) => {
      if (!l) return
      library = l.cars
      for (const c of library) if (!serviceById.has(c.id)) model(c.id)
      for (const svc of ROBOTAXI_SERVICES) {
        if (!library.some((c) => c.id === svc.id)) library = [...library, { id: svc.id, kind: 'robotaxi' }]
      }
    }, () => {})
  }
  const model = (id: string) => {
    let m = models.get(id)
    if (!m) models.set(id, m = carsJson<Omit<Model, 'id' | 'front' | 'long' | 'wide'>>(`${id}.json`).then((m) => {
      if (!m) return null
      const front = m.motor?.front ?? 0, done = { ...m, id, front, long: (front < 2 ? m.size[0] : m.size[2]), wide: (front < 2 ? m.size[2] : m.size[0]) }
      ready.set(id, done)
      if (prewarmOn) enqueueModelWarm(done)
      return done
    }, () => null))
    return m
  }
  /** The looks a vehicle is drawn in from far to near: its outside only (a car's inside is a look of its own, finer). */
  // (A body is cut to the cells it fills, so its look may start a cell under it: only its width and length say it is the whole outside.)
  const lodsKept = new Map<Model, { l: Look; i: number }[]>()
  const lods = (m: Model) => { let l = lodsKept.get(m); if (!l) lodsKept.set(m, l = m.looks.map((l, i) => ({ l, i })).filter(({ l }) => Math.abs(l.low[0]) < 0.5 && Math.abs(l.low[2]) < 0.5 && Math.abs(l.size[0] / l.per - m.size[0]) < 2.5 && Math.abs(l.size[2] / l.per - m.size[2]) < 2.5).sort((a, b) => a.l.per - b.l.per)); return l }
  // Faces, made off the page's thread (streetfaces.ts) and kept: one for each model, colour and look.
  const faces = new Map<string, Born | 'asked'>()
  const maker = new Worker(new URL('./streetfaces.ts', import.meta.url), { type: 'module' })
  let asking = 0
  let prewarmOn = false
  const warmQueue: { m: Model; paint: number; i: number }[] = []
  const warmQueued = new Set<string>()
  const drainWarm = () => {
    if (!prewarmOn || asking >= 1) return
    while (warmQueue.length && asking < 1) {
      const next = warmQueue.shift()!
      const key = `${next.m.id}/${next.paint}/${next.i}`
      if (faces.has(key)) continue
      bornOf(next.m, next.paint, next.i)
    }
  }
  const enqueueModelWarm = (m: Model) => {
    const ext = lods(m)
    if (!ext.length) return
    // Warm the sharpest exterior LOD (used close up on landing) and coarsest LOD (for mid-range traffic).
    const indices = ext.length > 1 ? [ext[ext.length - 1].i, ext[0].i] : [ext[0].i]
    const paints = m.variants.length > 0 ? [0, ...(m.variants.length > 1 ? [1] : [])] : [-1]
    for (const i of indices) for (const paint of paints) {
      const key = `${m.id}/${paint}/${i}`
      if (faces.has(key) || warmQueued.has(key)) continue
      warmQueued.add(key)
      warmQueue.push({ m, paint, i })
    }
    drainWarm()
  }
  const prewarm = () => {
    if (prewarmOn) return
    prewarmOn = true
    for (const svc of ROBOTAXI_SERVICES) buildLidarDomeBorns(svc)
    for (const m of ready.values()) enqueueModelWarm(m)
  }
  maker.onmessage = (e: MessageEvent<{ key: string; faces?: Uint32Array<ArrayBuffer>; smooth?: Uint32Array<ArrayBuffer>; filled?: number; cells?: Uint16Array }>) => {
    if (e.data.cells) { const k = e.data.key; if (fineKept.size >= 8) fineKept.delete(fineKept.keys().next().value!); fineKept.set(k, Promise.resolve(e.data.cells)); cellsAsked.get(k)?.(e.data.cells); cellsAsked.delete(k); return }
    asking--; const look = lookOf(e.data.key); if (look) faces.set(e.data.key, { id: 0, cells: e.data.filled!, size: look.size, com: [0, 0, 0], low: [0, 0, 0], faces: e.data.faces!, smooth: e.data.smooth })
    if (warmQueue.length) drainWarm()
  }
  /**
   * A look's palette in a colour, with what the library says is the vehicle's paint (sf/cars.mjs `rolesOf`) marked
   * polished (kinds.rs POLISHED): pieces.ts draws it as car paint, and its hubs, poles and brass as they were.
   */
  const paletteOf = (m: Model, paint: number, i: number) => {
    const p = paint >= 0 ? m.variants[paint].looks[i] : m.looks[i].palette, roles = m.looks[i].roles
    return roles ? p.map((k, j) => (roles[j] === 'paint' ? k | POLISHED : k)) : p
  }
  const lookOf = (key: string) => { const [id, , i] = key.split('/'); return ready.get(id)?.looks[Number(i)] }
  const bornOf = (m: Model, paint: number, i: number): Born | null => {
    const key = `${m.id}/${paint}/${i}`, f = faces.get(key)
    if (f && f !== 'asked') return f
    // An outside look's faces come smooth (#38), measured over as much of the car whatever its cells' size: 12.5 cm.
    if (!f && asking < 2) { faces.set(key, 'asked'); asking++; const l = m.looks[i], outside = lods(m).some((x) => x.i === i); maker.postMessage({ key, runs: l.runs, kinds: paletteOf(m, paint, i), size: l.size, reach: outside ? Math.max(2, Math.round((5 * l.per) / 4)) : 0 }) }
    return null
  }

  // ── Placing a vehicle ──
  /** The turn of a vehicle heading a way (radians: its front at cos, 0, sin) with its nose up by `pitch` and right side up by `roll`. */
  const turnOf = (m: Model, heading: number, pitch: number, roll = 0): [number, number, number, number] => {
    // Its own front: +x (0), -x (1), +z (2), -z (3); turned about y so that front is the heading, then pitched and rolled about its own axes.
    const own = [0, Math.PI, -Math.PI / 2, Math.PI / 2][m.front], yaw = own - heading
    const p = m.front === 1 ? -pitch : m.front === 0 ? pitch : m.front === 2 ? -roll : roll
    const r = m.front === 2 ? -pitch : m.front === 3 ? pitch : m.front === 0 ? -roll : roll
    const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], qz = [0, 0, Math.sin(p / 2), Math.cos(p / 2)], qx = [Math.sin(r / 2), 0, 0, Math.cos(r / 2)]
    const mul = (a: number[], b: number[]) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
    const q = mul(mul(qy, qz), qx)
    return [q[0], q[1], q[2], q[3]]
  }
  const rotate = (q: readonly number[], v: readonly number[]) => {
    const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
  }
  /** Spring equilibrium constants matching `engine/core/src/bodies/living.rs` (`SAG`, `STOP`) and `kinds.rs` (`weighs_own`). */
  const SAG = 0.4, STOP = 0.05
  const WEIGHS = [0, 1.6, 2.6, 1.0, 1.6, 1.0, 2.2, 2.4, 1.9, 1.6, 0.6, 2.4, 7.8, 0.15, 1.6, 1.9]
  interface StanceFoot { lx: number; ly: number; lz: number; along: number; right: number; comAlong: number; comRight: number; reach: number; ride: number }
  interface Stance { feet: StanceFoot[]; fit: [number, number, number][] }
  /** Solves a 3x3 linear system `A x = b` with partial pivoting; returns null if singular. */
  const solve3 = (a: number[][], b: readonly number[]): [number, number, number] | null => {
    const m = [[a[0][0], a[0][1], a[0][2], b[0]], [a[1][0], a[1][1], a[1][2], b[1]], [a[2][0], a[2][1], a[2][2], b[2]]]
    for (let c = 0; c < 3; c++) {
      let piv = c
      for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r
      if (Math.abs(m[piv][c]) < 1e-12) return null
      if (piv !== c) { const t = m[c]; m[c] = m[piv]; m[piv] = t }
      for (let r = c + 1; r < 3; r++) {
        const f = m[r][c] / m[c][c]
        for (let k = c + 1; k < 4; k++) m[r][k] -= f * m[c][k]
      }
    }
    const x2 = m[2][3] / m[2][2], x1 = (m[1][3] - m[1][2] * x2) / m[1][1], x0 = (m[0][3] - m[0][1] * x1 - m[0][2] * x2) / m[0][0]
    return Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(x2) ? [x0, x1, x2] : null
  }
  const stances = new WeakMap<Model, Stance | null>()
  /** Precomputes a motorized model's center of mass, wheel geometry and linear plane-fit weights for zero-jump settling. */
  const stanceOf = (m: Model): Stance | null => {
    const cached = stances.get(m)
    if (cached !== undefined) return cached
    const feetIn = m.motor?.feet
    if (!feetIn || feetIn.length < 3) { stances.set(m, null); return null }
    const [sx, sy, sz] = m.size
    const body = unrun(m.body.runs, sx * sy * sz, m.body.palette)
    let mass = 0, cx = 0, cy = 0, cz = 0
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const k = body[x + sx * (z + sz * y)]
      if (!k) continue
      const w = WEIGHS[k & 15] || 1
      mass += w; cx += (x + 0.5) * w; cy += (y + 0.5) * w; cz += (z + 0.5) * w
    }
    const com: [number, number, number] = mass > 0 ? [cx / mass, cy / mass, cz / mass] : [sx / 2, sy / 3, sz / 2]
    const toLocal = (dx: number, dz: number): [number, number] => (
      m.front === 0 ? [dx, dz] : m.front === 1 ? [-dx, -dz] : m.front === 2 ? [dz, -dx] : [-dz, dx]
    )
    const feet: StanceFoot[] = feetIn.map((f) => {
      const lx = f.at[0] - sx / 2, ly = f.at[1], lz = f.at[2] - sz / 2
      const [along, right] = toLocal(lx, lz)
      const [comAlong, comRight] = toLocal(f.at[0] - com[0], f.at[2] - com[2])
      return { lx, ly, lz, along, right, comAlong, comRight, reach: f.reach, ride: (1 - SAG) * f.reach - ly }
    })
    // Least-squares plane-fit weights: given target heights `h[i]`, `[y0, sp, sr] = sum_i fit[i] * h[i]`.
    let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0
    for (const f of feet) { s00++; s01 += f.along; s02 += f.right; s11 += f.along * f.along; s12 += f.along * f.right; s22 += f.right * f.right }
    const normal = [[s00, s01, s02], [s01, s11, s12], [s02, s12, s22]]
    const fit: [number, number, number][] = []
    for (const f of feet) {
      const w = solve3(normal, [1, f.along, f.right])
      if (!w) { stances.set(m, null); return null }
      fit.push(w)
    }
    const st: Stance = { feet, fit }
    stances.set(m, st)
    return st
  }
  /**
   * Solves the exact static 4-wheel spring+bump-stop equilibrium (`living.rs`: `SAG = 0.4`, `STOP = 0.05`) using
   * damped Newton with backtracking line search so a parked car stands where the solver will hold it with zero jump.
   */
  const solveStance = (st: Stance, g: readonly number[], yInit: number, pInit: number, rInit: number, cosTilt = 1): [number, number, number] => {
    const n = st.feet.length, invC = 1 / Math.max(0.2, cosTilt), target = invC
    let y = yInit, sp = pInit, sr = rInit
    const evalRes = (yy: number, pp: number, rr: number) => {
      let r0 = -target, r1 = 0, r2 = 0
      const a0 = [0, 0, 0], a1 = [0, 0, 0], a2 = [0, 0, 0]
      for (let i = 0; i < n; i++) {
        const f = st.feet[i]
        const p = f.reach - f.ly - (yy + f.along * pp + f.right * rr - g[i]) * invC
        if (p <= 0) continue
        const k = 1 / (n * SAG * f.reach), more = Math.max(0, p - SAG * f.reach)
        const force = k * (p + (more * more) / (STOP * f.reach))
        const dfdp = k * (1 + (2 * more) / (STOP * f.reach)) * invC
        r0 += force; r1 += force * f.comAlong; r2 += force * f.comRight
        a0[0] += dfdp; a0[1] += dfdp * f.along; a0[2] += dfdp * f.right
        a1[0] += dfdp * f.comAlong; a1[1] += dfdp * f.comAlong * f.along; a1[2] += dfdp * f.comAlong * f.right
        a2[0] += dfdp * f.comRight; a2[1] += dfdp * f.comRight * f.along; a2[2] += dfdp * f.comRight * f.right
      }
      return { r0, r1, r2, merit: r0 * r0 + r1 * r1 + r2 * r2, A: [a0, a1, a2] }
    }
    for (let iter = 0; iter < 12; iter++) {
      const cur = evalRes(y, sp, sr)
      if (cur.merit < 1e-10) break
      cur.A[0][0] += 1e-6; cur.A[1][1] += 1e-6; cur.A[2][2] += 1e-6
      const step = solve3(cur.A, [cur.r0, cur.r1, cur.r2])
      if (!step) break
      let alpha = 1, accepted = false
      for (let ls = 0; ls < 8; ls++) {
        const ny = y + alpha * step[0], np = sp + alpha * step[1], nr = sr + alpha * step[2]
        if (evalRes(ny, np, nr).merit < cur.merit) { y = ny; sp = np; sr = nr; accepted = true; break }
        alpha *= 0.5
      }
      if (!accepted || (Math.abs(alpha * step[0]) < 1e-5 && Math.abs(alpha * step[1]) < 1e-6 && Math.abs(alpha * step[2]) < 1e-6)) break
    }
    return [y, sp, sr]
  }
  /**
   * The road's top under a wheel: the town's footing (feetAt), lowered to what the world has there now if something
   * took the top away (a blast's hole, the cutter's slot). The footing is a rule and knows nothing of either: a car
   * set by it alone stood on air over a hole. Nothing solid within 3 m under it (the world not made there yet): the rule.
   * Asked of the world only near where a blast or the cutter changed it (asking under every wheel cost a millisecond a
   * frame): elsewhere the world is the rule's.
   */
  const changedNear = (x: number, z: number) => {
    for (const s of o.shocks) if (Math.abs(s.at[0] - x) < s.radius * 2 + 80 && Math.abs(s.at[2] - z) < s.radius * 2 + 80) return true
    for (const s of o.cuts ?? []) if (Math.abs(s.at[0] - x) < s.radius + 60 && Math.abs(s.at[2] - z) < s.radius + 60) return true
    return false
  }
  const wheelAt = (x: number, z: number) => {
    const f = feetAt(x, z), ix = Math.round(x), iz = Math.round(z)
    if (!changedNear(x, z)) return f
    if (o.land.world_kind(ix, f - 1, iz)) return f
    for (let y = f - 2; y >= f - 30; y--) if (o.land.world_kind(ix, y, iz)) return y + 1
    return f
  }
  /** Exact surface height under a wheel ray using `floor` cell coordinates and `world_under`, matching `living.rs::ray`. */
  const roadAt = (x: number, z: number, fromY?: number) => {
    const ix = Math.floor(x), iz = Math.floor(z)
    if (o.land.world_under) {
      const f = o.land.feet_at(ix, iz), g = o.land.ground_at(ix, iz)
      const base = f - g > 25 ? g + 1 : f
      const top = fromY !== undefined ? Math.floor(fromY) : base + 12
      const hit = o.land.world_under(ix, top, iz, 36)
      if (hit > -1_000_000) return hit
      return base
    }
    const f = o.land.feet_at(ix, iz), g = o.land.ground_at(ix, iz)
    const base = f - g > 25 ? g + 1 : f
    if (!changedNear(x, z)) return base
    if (o.land.world_kind(ix, base - 1, iz)) return base
    for (let y = base - 2; y >= base - 30; y--) if (o.land.world_kind(ix, y, iz)) return y + 1
    return base
  }
  /** Sets a car on the road under it: motorized vehicles match their 4-wheel spring equilibrium (pitch and roll); others use 2-point centerline footing. */
  const settle = (c: Car, exact = false) => {
    const st = stanceOf(c.model)
    const fx = Math.cos(c.heading), fz = Math.sin(c.heading)
    if (!st) {
      const hl = c.model.long * 0.32
      const front = wheelAt(c.x + fx * hl, c.z + fz * hl), back = wheelAt(c.x - fx * hl, c.z - fz * hl)
      c.y = (front + back) / 2 - 0.5
      c.pitch = Math.atan2(front - back, 2 * hl)
      c.roll = 0
      return
    }
    const rx = -fz, rz = fx
    const g: number[] = new Array(st.feet.length)
    let y0 = 0, sp = 0, sr = 0
    for (let i = 0; i < st.feet.length; i++) {
      const f = st.feet[i]
      const gi = exact ? roadAt(c.x + fx * f.along + rx * f.right, c.z + fz * f.along + rz * f.right) : wheelAt(c.x + fx * f.along + rx * f.right, c.z + fz * f.along + rz * f.right)
      g[i] = gi
      const h = gi + f.ride
      y0 += st.fit[i][0] * h; sp += st.fit[i][1] * h; sr += st.fit[i][2] * h
    }
    if (exact) {
      ;[y0, sp, sr] = solveStance(st, g, y0, sp, sr, 1)
      // Re-sample wheel rays along the tilted body's `down` vector to match `living.rs::ray` on hills and cross-slopes.
      const q = turnOf(c.model, c.heading, Math.atan(sp), Math.atan(sr))
      const down = rotate(q, [0, -1, 0])
      const cosTilt = Math.max(0.2, -down[1])
      let changed = cosTilt < 0.999
      for (let i = 0; i < st.feet.length; i++) {
        const f = st.feet[i]
        const start = rotate(q, [f.lx, f.ly, f.lz])
        const sx = c.x + start[0], sy = y0 + start[1], sz = c.z + start[2]
        const estDist = Math.max(0, (sy - g[i]) / cosTilt)
        const gi = roadAt(sx + down[0] * estDist, sz + down[2] * estDist, sy)
        if (gi !== g[i]) { g[i] = gi; changed = true }
      }
      if (changed) {
        ;[y0, sp, sr] = solveStance(st, g, y0, sp, sr, cosTilt)
      }
    }
    c.y = y0
    c.pitch = Math.atan(sp)
    c.roll = Math.atan(sr)
  }
  const mulQ = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
  const drawn = new Set<Car>()
  const show = (c: Car, view: View) => {
    const d = Math.hypot(c.x - view.eye[0], c.y - view.eye[1], c.z - view.eye[2])
    const lod = lods(c.model)
    let want = -1
    if (d < DRAWN && (!c.thing || c.landing)) {
      // In view, or so near that its back may be: the eye's cone, widened by the car's own length.
      const dx = c.x - view.eye[0], dy = c.y - view.eye[1], dz = c.z - view.eye[2], ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]
      const side = Math.hypot(dx - view.forward[0] * ahead, dy - view.forward[1] * ahead, dz - view.forward[2] * ahead)
      if (ahead > -c.model.long && side < (ahead + c.model.long) * view.tanHalf * 1.9 + c.model.long) want = lod.length ? lod[d < 200 ? lod.length - 1 : d < 900 ? Math.min(lod.length - 1, 1) : 0].i : -1
    }
    // The finest that is made, by way of coarser ones while it is made.
    let born: Born | null = null, key = ''
    if (want >= 0) {
      const order = lod.map((x) => x.i), from = order.indexOf(want)
      for (let k = from; k >= 0 && !born; k--) { born = bornOf(c.model, c.paint, order[k]); key = `${order[k]}` }
    }
    if (!born) { hide(c); return }
    if (c.shown !== key || !c.piece) { c.piece?.destroy(); c.piece = o.pieces.add(born, true); c.shown = key; drawn.add(c) }
    const look = c.model.looks[Number(key)], q = turnOf(c.model, c.heading, c.pitch, c.roll ?? 0)
    // Its look's low corner, from the middle of its foot.
    const off = rotate(q, [look.low[0] - c.model.size[0] / 2, look.low[1], look.low[2] - c.model.size[2] / 2])
    c.piece.born.com = [0, 0, 0]
    c.piece.pos = [c.x + off[0], c.y + off[1], c.z + off[2]]
    c.piece.rot = q
    c.piece.cell = 1 / look.per
    // Dynamic vehicle lamps: robotaxi brake/headlight/4-way amber hazard blinkers, plus annoyed high-beam flashes on blocked cars.
    const nowShow = performance.now() / 1000
    const ls = carLampState(c, nowShow)
    if (c.model.kind === 'robotaxi') {
      c.piece.lamps = [ls.brake, -ls.hazard, ls.head, c.model.front + 1]
      // Spinning 360° roof LiDAR turret on nearby robotaxis (< 140 m): calm brand spin vs amber hazard alert when stuck!
      if (d < 1400 && c.model.domeOffset) {
        const stuck = !!c.rtStuck
        const wantMode = stuck ? 'stuck' : 'normal'
        if (!c.dome || c.domeMode !== wantMode) {
          c.dome?.destroy()
          c.dome = o.pieces.add(lidarBorn(serviceOf(c), stuck), true)
          c.domeMode = wantMode
        }
        const spin = c.lidarAngle ?? (c.seed * 0.7)
        const domeOff = rotate(q, c.model.domeOffset)
        c.dome.pos = [c.x + domeOff[0], c.y + domeOff[1], c.z + domeOff[2]]
        c.dome.rot = mulQ(q, [0, Math.sin(spin / 2), 0, Math.cos(spin / 2)])
        c.dome.cell = 0.25
      } else if (c.dome) {
        c.dome.destroy(); c.dome = null; c.domeMode = ''
      }
    } else if (ls.head > 0 || ls.brake > 0) {
      c.piece.lamps = [ls.brake, 0, ls.head, c.model.front + 1]
    } else {
      c.piece.lamps = undefined
    }
  }
  const isDarkNow = () => {
    if (o.lights) return o.lights() > 0.2
    const hourNow = ((o.hour() % 24) + 24) % 24
    return hourNow < 6.5 || hourNow > 19.2
  }
  const carLampState = (c: Car, nowSec: number): { head: number; brake: number; hazard: number } => {
    const darkNow = isDarkNow()
    const beamFlashing = !!c.beamFlash && nowSec < c.beamFlash
    if (c.model.kind === 'robotaxi') {
      const stuck = !!c.rtStuck
      const hazard = stuck && (((nowSec - c.rtStuck!.at) * 2.2) % 1) < 0.65 ? 1.0 : 0.0
      const brake = stuck ? 1.0 : c.depot?.phase === 'charging' ? 0.25 : c.v < 12 ? 0.85 : 0.0
      const head = darkNow ? 1.0 : 0.0
      return { head, brake, hazard }
    }
    if (beamFlashing || (c.kind === 'traffic' && (darkNow || c.v < 8))) {
      return { head: beamFlashing ? 1.8 : darkNow ? 1.0 : 0, brake: c.kind === 'traffic' && c.v < 8 ? 0.65 : 0, hazard: 0 }
    }
    if ((c.kind === 'tram' || c.kind === 'cable') && darkNow) {
      return { head: 1.0, brake: 0, hazard: 0 }
    }
    return { head: 0, brake: 0, hazard: 0 }
  }
  const hide = (c: Car) => { c.piece?.destroy(); c.piece = null; c.shown = ''; c.dome?.destroy(); c.dome = null; c.domeMode = ''; drawn.delete(c) }

  // ── Signal heads ──
  /**
   * A post with a signal head, in cells of 2.5 cm, its lamps facing +x: a dark housing with its backplate, three lamps
   * under hoods, red at the top; the one of the phase lit (the core's lamp glows its colour), the others their own colour
   * dimmed. One look for each phase, made once.
   */
  const HEAD_PER = 4, HEAD_POLE: [number, number] = [7, 8]
  const headLooks = (['red', 'amber', 'green'] as const).map((phase) => {
    const W = 26, D = 16, H = 160, cells = new Uint16Array(W * H * D)
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, v: number) => { for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cells[x + W * (z + D * y)] = v }
    const k = (material: number, colour: number) => material | (colour << 8), hue = (h: number, tone: number) => 16 + h * 10 + tone
    const METAL = k(12, 1 + 9), HOUSING = k(12, 1 + 12), BLACK = k(14, 1 + 13)
    box(2, 13, 0, 2, 3, 14, METAL)
    box(4, 10, 0, 150, 5, 11, METAL)
    box(10, 12, 112, 116, 6, 10, METAL); box(10, 12, 140, 144, 6, 10, METAL)
    box(12, 13, 100, 156, 0, 16, BLACK)
    box(13, 21, 104, 152, 2, 14, HOUSING)
    const lamps: [number, number, number][] = [[143, 0, phase === 'red' ? 1 : 0], [128, 3, phase === 'amber' ? 1 : 0], [113, 8, phase === 'green' ? 1 : 0]]
    for (const [y, h, on] of lamps) {
      for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) if (dy * dy + dz * dz <= 26) box(21, 22, y + dy, y + dy + 1, 8 + dz, 8 + dz + 1, on ? k(15, hue(h, 4)) : k(12, hue(h, 6)))
      box(21, 25, y + 6, y + 7, 2, 14, HOUSING); box(21, 24, y - 2, y + 6, 2, 3, HOUSING); box(21, 24, y - 2, y + 6, 13, 14, HOUSING)
    }
    let n = 0
    for (const c of cells) if (c) n++
    return { id: 0, cells: n, size: [W, H, D] as [number, number, number], com: [0, 0, 0] as [number, number, number], low: [0, 0, 0] as [number, number, number], faces: facesOf(cells, [W, H, D]) } satisfies Born
  })
  const headsShown = new Set<(typeof heads)[number]>()
  const HEAD_FRONT = { front: 0 } as Model
  /** The heads within 120 m and in view, each showing its road's lights as they are now. */
  const showHeads = (view: View, t: number) => {
    const eye = view.eye, R = 1200, seen = new Set<(typeof heads)[number]>()
    for (let gx = Math.floor((eye[0] - R) / GRID); gx <= Math.floor((eye[0] + R) / GRID); gx++) for (let gz = Math.floor((eye[2] - R) / GRID); gz <= Math.floor((eye[2] + R) / GRID); gz++) for (const i of headGrid.get(cell(gx, gz)) ?? []) {
      const h = heads[i], r = roads.get(h.key)
      if (!r || Math.hypot(h.x - eye[0], h.z - eye[2]) > R) continue
      const dx = h.x - eye[0], dz = h.z - eye[2], ahead = dx * view.forward[0] + dz * view.forward[2]
      if (ahead < -20 || Math.abs(dx * view.forward[2] - dz * view.forward[0]) > (ahead + 20) * view.tanHalf * 2 + 40) continue
      along(r.p, r.cum, r.len, P)
      const ax = P.tx, az = P.tz, phase = lightFor(junctionOf(r.b), ax, az, t), key = phase
      // Keep every signal post off the asphalt carriageway and railbed onto the nearest sidewalk corner once ground tiles are loaded.
      if (!h.curbed && o.land.top_at) {
        const m0 = o.land.top_at(Math.round(h.x), Math.round(h.z)) & 15
        if (m0 !== 4) {
          if (m0 === 6 || m0 === 12) {
            const rx = -az, rz = ax
            const isSidewalk = (px: number, pz: number) => { const m = o.land.top_at!(px, pz) & 15; return m !== 6 && m !== 12 && m !== 4 }
            let placed = false
            // First try stepping right and back along the approach (handles wide cross-street intersections).
            for (const back of [0, 40, 80, 120, 160]) {
              for (let step = 4; step <= 130; step += 4) {
                const px = Math.round(h.x - ax * back + rx * step), pz = Math.round(h.z - az * back + rz * step)
                if (isSidewalk(px, pz)) {
                  const nx = px + Math.round(rx * 5), nz = pz + Math.round(rz * 5)
                  h.x = isSidewalk(nx, nz) ? nx : px; h.z = isSidewalk(nx, nz) ? nz : pz
                  placed = true
                  break
                }
              }
              if (placed) break
            }
            // Fallback: radial search to nearest sidewalk within 14 m.
            if (!placed) {
              for (let rad = 8; rad <= 140 && !placed; rad += 4) {
                for (let a = 0; a < 16; a++) {
                  const ang = (a * Math.PI * 2) / 16
                  const px = Math.round(h.x + Math.cos(ang) * rad), pz = Math.round(h.z + Math.sin(ang) * rad)
                  if (isSidewalk(px, pz)) {
                    const nx = px + Math.round(Math.cos(ang) * 4), nz = pz + Math.round(Math.sin(ang) * 4)
                    h.x = isSidewalk(nx, nz) ? nx : px; h.z = isSidewalk(nx, nz) ? nz : pz
                    placed = true
                    break
                  }
                }
              }
            }
            h.curbed = placed
          } else {
            h.curbed = true
          }
        }
      }
      seen.add(h)
      if (h.shown !== key || !h.piece) {
        h.piece?.destroy()
        const born = headLooks[phase === 'red' ? 0 : phase === 'amber' ? 1 : 2]
        h.piece = o.pieces.add(born, true); h.shown = key; headsShown.add(h)
        // Facing whoever comes along the road: its lamps (+x) the other way to the road's end.
        const q = turnOf(HEAD_FRONT, Math.atan2(-az, -ax), 0), off = rotate(q, [-HEAD_POLE[0] / HEAD_PER, 0, -HEAD_POLE[1] / HEAD_PER])
        h.piece.pos = [h.x + off[0], feetAt(h.x, h.z) + off[1], h.z + off[2]]
        h.piece.rot = q
        h.piece.cell = 1 / HEAD_PER
      }
    }
    for (const h of headsShown) if (!seen.has(h)) { h.piece?.destroy(); h.piece = null; h.shown = ''; headsShown.delete(h) }
  }

  // ── Parked ──
  const parked = new Map<number, Car>(), gone = new Set<number>()
  let ids = 1
  /** Proximity factor 0..1 to a robotaxi station: 1 inside its core radius, smoothly falling off to 0 at its outer reach. */
  const stationFactorAt = (st: RobotaxiService['station'], x: number, z: number) => {
    const d = Math.hypot(x - st.cx, z - st.cz)
    if (d <= st.boostCore) return 1
    if (d >= st.boostOuter) return 0
    return 1 - ease((d - st.boostCore) / (st.boostOuter - st.boostCore))
  }
  const maxStationFactor = (x: number, z: number) => {
    let best = 0
    for (const svc of ROBOTAXI_SERVICES) best = Math.max(best, stationFactorAt(svc.station, x, z))
    return best
  }
  const carModels = () => library.filter((c) => c.kind === 'car').map((c) => ready.get(c.id)).filter((m): m is Model => !!m)
  /** What drives a road: registered robotaxi services (surging around each service's own depot), vans/trucks off small streets, and everyday SF cars. */
  const mixOf = (r: Road, cars: Model[]): Model => {
    let totalW = 0
    const weights: [Model, number][] = []
    for (const svc of ROBOTAXI_SERVICES) {
      const m = robotaxiModels.get(svc.id)
      if (!m) continue
      const w = svc.share + svc.stationBoost * stationFactorAt(svc.station, r.mx, r.mz)
      if (w > 0) { weights.push([m, w]); totalW += w }
    }
    if (totalW > 0) {
      const capped = Math.min(0.86, totalW)
      const rollRT = random()
      if (rollRT < capped) {
        let pick = (rollRT / capped) * totalW
        for (const [m, w] of weights) { pick -= w; if (pick <= 0) return m }
        return weights[weights.length - 1][0]
      }
    }
    const roll = random(), get = (id: string) => ready.get(id)
    if (r.cls >= 1 && !(r.flags & 4)) { if (roll > 0.88 && get('van')) return get('van')!; if (roll > 0.85 && get('truck')) return get('truck')! }
    return cars[Math.floor(random() * cars.length)]
  }
  const parkedFill = (s: Slot, hour: number) => (s.mapped ? 0.8 : 0.6) * (hour < 7 || hour > 20 ? 1.15 : 1)
  const park = (eye: readonly number[], hour: number) => {
    const cars = carModels()
    if (!cars.length) return
    const seen = new Set<number>()
    for (let gx = Math.floor((eye[0] - PARKED) / GRID); gx <= Math.floor((eye[0] + PARKED) / GRID); gx++) for (let gz = Math.floor((eye[2] - PARKED) / GRID); gz <= Math.floor((eye[2] + PARKED) / GRID); gz++) {
      for (const i of slotGrid.get(cell(gx, gz)) ?? []) {
        const s = slots[i]
        if (Math.hypot(s.x - eye[0], s.z - eye[2]) > PARKED || gone.has(i)) continue
        seen.add(i)
        const isFine = o.fine ? o.fine(s.x, s.z) : true
        const existing = parked.get(i)
        if (existing) {
          if (!existing.fineGround && !existing.thing && !existing.waking && isFine) {
            settle(existing, true)
            existing.fineGround = true
          }
          continue
        }
        if (chance(s.seed, 3) >= parkedFill(s, hour)) continue
        const van = ready.get('van'), m = van && chance(s.seed, 8) < 0.08 ? van : cars[Math.floor(chance(s.seed, 4) * cars.length)], paint = chance(s.seed, 5) < 0.3 ? -1 : Math.floor(chance(s.seed, 6) * m.variants.length)
        const c: Car = { id: ids++, model: m, paint, kind: 'parked', seed: s.seed, x: s.x, y: 0, z: s.z, heading: s.yaw, pitch: 0, roll: 0, fineGround: isFine, v: 0, piece: null, shown: '', slot: i }
        settle(c, true)
        // Not on a roof or a stair (the footing there is not the street's), and not in what the survey left standing at the kerb.
        const g = o.land.ground_at(Math.round(s.x), Math.round(s.z))
        if (c.y + (m.looks[0]?.low[1] ?? 0) - g > 8 || Math.abs(c.pitch) > 0.3) { if (isFine) gone.add(i); continue }
        // Never in a lane: no part of it where a lane's cars go (by the lanes as traffic keeps them, laneOff).
        if (inLane(s.x, s.z, m.wide / 2)) { gone.add(i); inLanes++; continue }
        parked.set(i, c)
      }
    }
    for (const [i, c] of parked) if (!seen.has(i) && !c.thing) { hide(c); parked.delete(i) }
  }

  // ── Brought to life: what someone on foot can reach ──
  const living = new Set<Car>()
  /** Makes a car a living thing where it stands (the solver's, living.ts), and says when it is. */
  /**
   * Makes a car a living thing where it stands (the solver's, living.ts). Its look's faces are made first, off the
   * page's thread, and handed to the page's keeping (`faces`), so that coming to life makes none on it: until they
   * are, it is asked again later (false). `inside`: with the look of its inside, for whoever will sit in it; `push`:
   * the speed it is given once it lives (thrown by a blast, struck by a car); `asked`: when it was struck.
   *
   * The solver makes a body square to the world at a low corner, and only its next message turns and places it: steps
   * may run between the two, with the car lying across the street in whatever is there. So it is born `SKY` over its
   * place, where nothing is, and comes down in one move with its push. And where it was drawn is by then where
   * whatever struck it is: the solver's `place` moves it clear of every vehicle standing there (core hull.rs
   * `clear`), by where they are in that step, which the page learns only an answer later.
   */
  const SKY = 3000
  const wake = async (c: Car, o2: Waking): Promise<boolean> => {
    const motor = c.model.motor
    if (c.thing || c.waking || !motor) return !!c.thing
    const m = c.model, outside = new Set(lods(m).map((x) => x.i))
    const parts = m.looks.map((l, i) => ({ l, i })).filter(({ l, i }) => l.per >= 4 && (o2.inside || outside.has(i)))
    const made = parts.map(({ i }) => bornOf(m, c.paint, i))
    if (made.some((b) => !b)) return false
    c.waking = true
    const kinds = c.paint >= 0 ? m.variants[c.paint].body : m.body.palette
    const body = unrun(m.body.runs, m.size[0] * m.size[1] * m.size[2], kinds)
    // Its looks' cells, decoded off the page's thread.
    const looks = await Promise.all(parts.map(({ i }) => fineCells(m, c.paint, i)))
    const fine = parts.map(({ l }, k) => { const cells = looks[k]; o.faces?.(cells, l.size, made[k]!); return { size: l.size, per: l.per, low: l.low, cells } })
    const low: [number, number, number] = [Math.round(c.x - m.size[0] / 2), Math.round(c.y) + SKY, Math.round(c.z - m.size[2] / 2)]
    const thing = await o.alive.spawn({ name: carName(m, c.paint), cells: Int32Array.from(body), size: m.size, low, motor, controls: m.controls ?? 'drive', seats: m.seats, eye: m.eye, fine })
    c.waking = false
    if (!thing.alive) { pending.delete(c); return false }
    // Turned as it stood: placed directly at its solved 4-wheel spring equilibrium with no upward hop.
    const at = o.alive.where(thing), com = at ? [at.at[0] - low[0], at.at[1] - low[1], at.at[2] - low[2]] : [m.size[0] / 2, m.size[1] / 3, m.size[2] / 2]
    const q = turnOf(m, c.heading, c.pitch, c.roll ?? 0), off = rotate(q, [com[0] - m.size[0] / 2, com[1], com[2] - m.size[2] / 2])
    o.alive.place(thing, [c.x + off[0], c.y + off[1], c.z + off[2]], q)
    // (Where the solver put it is not known yet, `followed`: it goes as it was pushed.)
    if (o2.push) { o.alive.kick(thing, o2.push); c.thrown = true; c.going = { x: NaN, z: NaN, vx: o2.push[0], vz: o2.push[2], dt: 0 } }
    if (o2.asked !== undefined) { wakeLags.push(Math.min(0.15, Math.max(0.02, performance.now() / 1000 - o2.asked))); if (wakeLags.length > 4) wakeLags.shift(); wakeLag = Math.min(...wakeLags) }
    c.thing = thing
    pending.delete(c)
    // (Still drawn where it stood until its body is seen on the road, `landed`: the page sees it in the sky for an
    // answer or two yet, and put away now the car was not there at all for those frames.)
    c.landing = true
    c.then = o2.then
    living.add(c)
    return true
  }
  /** Cars on their way to life, drawn where they stand meanwhile, and asked again each frame. */
  const pending = new Map<Car, Waking>()
  /**
   * How long a car takes to come to life once it is struck (seconds): the faces, the solver's answer. Measured at each
   * waking (66 to 150 ms and more in one pileup, in Chrome on the M1 Pro), and the shortest of the last four kept: a
   * touch is looked for this far ahead of whatever moves (`reaches`), so that the car lives as it is reached. The
   * shortest, because a car that wakes late is put clear ahead of what is in its place by the solver, exactly, while
   * one that wakes early leaps away before it is touched (by 2.6 and 3.7 m, when the mean was looked ahead by).
   */
  let wakeLag = 0.05
  const wakeLags: number[] = []
  /** A look's cells in a colour, made once and kept: the page's faces for a look are kept by its cells (main.ts), so a second car of a kind makes nothing. */
  const fineKept = new Map<string, Promise<Uint16Array>>(), cellsAsked = new Map<string, (cells: Uint16Array) => void>()
  const fineCells = (m: Model, paint: number, i: number): Promise<Uint16Array> => {
    const key = `${m.id}/${paint}/${i}`
    let k = fineKept.get(key)
    if (!k) {
      const l = m.looks[i]
      fineKept.set(key, k = new Promise((done) => cellsAsked.set(key, done)))
      maker.postMessage({ key, runs: l.runs, kinds: paletteOf(m, paint, i), size: l.size, cells: true })
    }
    return k
  }
  /** Lets a living car go back to being drawn where it stands, if it was never moved and nobody is near it. */
  const sleep = (c: Car) => {
    if (!c.thing) return
    o.alive.vanish(c.thing)
    c.thing = null
    c.landing = false; c.then = undefined
    living.delete(c)
  }
  /** Draws each car that has just come to life where it stood, until its body is seen on the road: then it is the body that is drawn. */
  const landed = (view: View) => {
    for (const c of living) {
      if (!c.landing) continue
      const w = c.thing?.alive ? o.alive.where(c.thing) : null
      if (w && w.at[1] - c.y > SKY / 2) { show(c, view); continue }
      // (What was to be done with it, now that it is where it is: whoever took it is sat in it on the road, not in the sky.)
      const then = c.then
      c.landing = false; c.then = undefined
      hide(c)
      if (w && c.thing) then?.(c.thing)
    }
  }
  const reachable = (feet: readonly number[] | null) => {
    for (const c of living) {
      if (!c.thing) { living.delete(c); continue }
      const w = c.thing.alive ? o.alive.where(c.thing) : null
      if (!w) { if (c.crashed !== undefined) brokeStat++; if (c.landing) { c.landing = false; hide(c) } c.thing = null; living.delete(c); if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot) } continue }
      if (c.thrown) { if (lastEye && Math.hypot(w.at[0] - lastEye[0], w.at[2] - lastEye[2]) > (c.crashed ? 1800 : DRIVEN * 1.5)) sleep(c); continue }
      const moved = Math.hypot(w.at[0] - c.x, w.at[2] - c.z) > 25
      if (moved || o.alive.riding === c.thing) { if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot); c.slot = undefined } continue }
      if (!feet || Math.hypot(w.at[0] - feet[0], w.at[2] - feet[2]) > 260) sleep(c)
    }
    // Keep simultaneously awake thrown/crashed traffic cars bounded so multi-car pileups don't stall the mover worker (#155).
    const thrown = [...living].filter((l) => l.thrown && l.thing && l.thing !== o.alive.riding)
    const maxThrown = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 4 : 6
    if (thrown.length > maxThrown && lastEye) {
      thrown.sort((a, b) => {
        const wa = o.alive.where(a.thing!), wb = o.alive.where(b.thing!)
        const da = wa ? Math.hypot(wa.at[0] - lastEye![0], wa.at[2] - lastEye![2]) : Infinity
        const db = wb ? Math.hypot(wb.at[0] - lastEye![0], wb.at[2] - lastEye![2]) : Infinity
        return db - da
      })
      for (let k = 0; k < thrown.length - maxThrown; k++) sleep(thrown[k])
    }
    if (!feet || o.alive.riding) return
    // The nearest three parked within a dozen metres come to life.
    const near = [...parked.values()].filter((c) => !c.thing && !c.waking && Math.hypot(c.x - feet[0], c.z - feet[2]) < 120).sort((a, b) => Math.hypot(a.x - feet[0], a.z - feet[2]) - Math.hypot(b.x - feet[0], b.z - feet[2])).slice(0, 3)
    for (const c of near) if ([...living].filter((l) => l.kind === 'parked').length < 4) void wake(c, { inside: true })
  }

  // ── Traffic ──
  const traffic: Car[] = []
  let rng = 0x2545f491
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
  /** Who is crossing each junction now, and the way each came in and goes out: cars that cross no one's path (straight on, from the same way or the opposite one) share it. */
  const holds = new Map<number, Map<Car, { ax: number; az: number; straight: boolean }>>()
  const letGo = (c: Car) => { for (const [n, h] of holds) { h.delete(c); if (!h.size) holds.delete(n) } }
  const P = { x: 0, z: 0, tx: 0, tz: 0 }, Q = { x: 0, z: 0, tx: 0, tz: 0 }
  /**
   * Runtime fallback clearance for opposing parallel streetcar rails (#72): keeps lane 0 at least 2.8 m clear of
   * oncoming streetcar tracks even when loading older un-rebuilt life squares (shifted squares evaluate to 0).
   */
  const railShiftOf = (r: Road): number => {
    if (r.railShift !== undefined) return r.railShift
    if (!tramLines.length) return 0
    const base0 = (r.flags & 1 ? (0 - (r.lanes - 1) / 2) * 33 : 0.5 * 33)
    const S0 = { x: 0, z: 0, tx: 0, tz: 0 }
    let need = 0
    for (let s = 0; s <= r.len; s += Math.max(40, r.len / 4)) {
      along(r.p, r.cum, s, S0)
      const lx = S0.x - S0.tz * base0, lz = S0.z + S0.tx * base0
      for (const l of tramLines) {
        for (let i = 0; i + 3 < l.p.length; i += 2) {
          const ax = l.p[i], az = l.p[i + 1], bx = l.p[i + 2] - ax, bz = l.p[i + 3] - az
          if (Math.min(ax, ax + bx) - 60 > lx || Math.max(ax, ax + bx) + 60 < lx || Math.min(az, az + bz) - 60 > lz || Math.max(az, az + bz) + 60 < lz) continue
          const l2 = bx * bx + bz * bz
          if (l2 < 1) continue
          const len = Math.sqrt(l2)
          if ((S0.tx * bx + S0.tz * bz) / len > -0.9) continue
          const t = Math.max(0, Math.min(1, ((lx - ax) * bx + (lz - az) * bz) / l2))
          const d = Math.hypot(lx - ax - bx * t, lz - az - bz * t)
          if (d < 28) need = Math.max(need, 28 - d)
        }
      }
    }
    r.railShift = Math.min(35, need)
    return r.railShift
  }
  const laneOff = (r: Road, lane: number) => (r.flags & 1 ? (lane - (r.lanes - 1) / 2) * 33 : (lane + 0.5) * 33) + railShiftOf(r)
  /** A lane's middle at a distance along a road. */
  const lanePoint = (r: Road, lane: number, s: number, into: { x: number; z: number; tx: number; tz: number }) => { along(r.p, r.cum, s, into); const off = laneOff(r, Math.min(lane, r.lanes - 1)); into.x -= into.tz * off; into.z += into.tx * off }
  /** Whether cars may go along a road: not where its line runs under a roof (a tunnel, or a building over it: the footing there is the roof's). */
  /** How many roads may be looked over in a frame: each costs a few dozen questions of the land. Unknown, a road is not taken this frame. */
  let probes = 0
  /** Whether something this wide (half its width, cells) standing at a place reaches into any road's lanes. */
  const inLane = (x: number, z: number, half: number) => {
    for (const r of roadGrid.get(cell(Math.floor(x / GRID), Math.floor(z / GRID))) ?? []) {
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2] - ax, bz = r.p[i + 3] - az, l2 = bx * bx + bz * bz
        if (!l2) continue
        const t = ((x - ax) * bx + (z - az) * bz) / l2
        if (t < 0 || t > 1) continue
        const l = Math.sqrt(l2), right = ((x - ax) * -bz + (z - az) * bx) / l
        // A two-way road's lanes are to its right of the middle line; a one-way's either side of it.
        let lo = Infinity, hi = -Infinity
        for (let lane = 0; lane < r.lanes; lane++) { const off = laneOff(r, lane); lo = Math.min(lo, off - 16.5); hi = Math.max(hi, off + 16.5) }
        if (right + half > lo + 2 && right - half < hi - 2) return true
      }
    }
    return false
  }
  let inLanes = 0, signStops = 0
  const isSolidBuildingMat = (m: number) => m === 8 || m === 9 || m === 11 || m === 14
  const open = (r: Road) => {
    if (r.blocked) return false
    if (r.open !== null) return r.open
    if (probes <= 0) return false
    probes--
    // Verify centerline and full lane width (±0.9 m) across the entire segment including its endpoint `s = r.len`
    // against roofs and solid building walls; never cache `open = true` while a tile is unloaded (`ground_at <= -150`) (#129).
    const steps = Math.max(1, Math.ceil(r.len / 20))
    const checkSpot = (x: number, z: number): 'ok' | 'unloaded' | 'blocked' => {
      const ix = Math.round(x), iz = Math.round(z)
      const g = o.land.ground_at(ix, iz)
      if (g <= -150) return 'unloaded'
      if (o.land.feet_at(ix, iz) - g > 30) return 'blocked'
      if (isSolidBuildingMat(o.land.world_kind(Math.floor(x), g + 8, Math.floor(z)) & 15)) return 'blocked'
      return 'ok'
    }
    // Trimming `r.lanes` on a one-way road shifts its symmetric `laneOff`, so re-verify until stable.
    for (let attempt = 0; attempt < 4; attempt++) {
      let openLanes = r.lanes
      for (let k = 0; k <= steps; k++) {
        const s = (r.len * k) / steps
        along(r.p, r.cum, s, P)
        const centerState = checkSpot(P.x, P.z)
        if (centerState === 'unloaded') return false
        if (centerState === 'blocked') { r.open = false; return false }
        for (let lane = 0; lane < openLanes; lane++) {
          lanePoint(r, lane, s, P)
          const tx = P.tx, tz = P.tz, lx = P.x, lz = P.z
          let blocked = false
          for (const side of [0, -9, 9]) {
            const st = checkSpot(lx - tz * side, lz + tx * side)
            if (st === 'unloaded') return false
            if (st === 'blocked') { blocked = true; break }
          }
          if (blocked) { openLanes = lane; break }
        }
        if (openLanes <= 0) { r.open = false; return false }
      }
      if (openLanes === r.lanes) { r.open = true; return true }
      r.lanes = openLanes
      if (!(r.flags & 1)) { r.open = true; return true }
    }
    r.open = false
    return false
  }
  const ensureProfile = (c: Car): DriverProfile => (c.profile ??= driverProfile(c.seed, c.model.kind, c.emergency))
  const detourGraph: DetourGraph = {
    getRoad: (k) => roads.get(k),
    isOpen: (r) => open(r as Road),
    tangentAt: (r, atEnd) => {
      const rr = r as Road
      const tmp = { x: 0, z: 0, tx: 1, tz: 0 }
      along(rr.p, rr.cum, atEnd ? rr.len : 0, tmp)
      return { tx: tmp.tx, tz: tmp.tz }
    },
  }
  /** The road a vehicle takes next at a road's end: liking a straight way and a wide one; detours locally around blocked/congested outgoing roads. */
  const choose = (r: Road, kind = 'car'): Road | null => {
    let anyBlocked = false
    let total = 0
    const all: [Road, number, number][] = []
    for (const k of r.next) {
      const n = roads.get(k)
      if (!n) continue
      if (n.blocked || activeCongested.has(n.key)) { anyBlocked = true; continue }
      if (!open(n)) continue
      along(r.p, r.cum, r.len, P); along(n.p, n.cum, 0, Q)
      const straight = P.tx * Q.tx + P.tz * Q.tz
      let like = (0.3 + Math.max(0, straight) * 2) * (n.flags & 4 ? 0.3 : 1) * (n.lanes)
      if (kind === 'trolley') like *= n.wired ? 50 : 0.02
      else if (kind === 'bus') like *= n.cls >= 3 ? 8 : n.cls === 2 ? 1 : 0.05
      else if (kind === 'truck') like *= n.cls >= 2 ? 3 : n.flags & 4 ? 0.02 : 0.5
      all.push([n, like, straight])
    }
    if (anyBlocked) {
      const detour = planLocalDetour(detourGraph, r, activeCongested, { kind, cache: detourCache, blockedSignature: activeBlockedSig })
      if (detour) {
        const picked = roads.get(detour.nextKey)
        if (picked) { aiStats.detours++; return picked }
      }
    }
    if (!all.length) return null
    // Avoid sharp hairpin/acute turns (> ~115°, e.g. diagonal Columbus Ave turn-backs across adjacent lanes) whenever any gentler continuation exists.
    const gentle = all.filter(([, , straight]) => straight >= -0.42)
    const options = gentle.length ? gentle : all
    for (const [, like] of options) total += like
    let pick = random() * total
    for (const [n, like] of options) { pick -= like; if (pick <= 0) return n }
    return options[options.length - 1][0]
  }
  /** The road a vehicle takes next: a bus its route's next road (detouring if blocked/congested), anything else as `choose` likes. */
  const nextOf = (c: Car, r: Road): Road | null => {
    if (!c.route) return choose(r, c.model.kind)
    const n = roads.get(c.route.piece.keys[c.route.i + 1] ?? '')
    if (n && n.a === r.b && !n.blocked && !activeCongested.has(n.key) && open(n)) return n
    if (n && (n.blocked || activeCongested.has(n.key))) {
      const detour = planLocalDetour(detourGraph, r, activeCongested, { kind: c.model.kind, cache: detourCache, blockedSignature: activeBlockedSig })
      if (detour) {
        const alt = roads.get(detour.nextKey)
        if (alt) { c.route = undefined; aiStats.detours++; return alt }
      }
    }
    return null
  }
  /** Which way a road turns into the next at its end: 1 left, -1 right, 0 on (in the frame, x east and z south, a left turn is a negative cross). */
  const turning = (r: Road, n: Road) => { along(r.p, r.cum, r.len, P); along(n.p, n.cum, 0, Q); const cross = P.tx * Q.tz - P.tz * Q.tx, dot = P.tx * Q.tx + P.tz * Q.tz; return dot > 0.8 ? 0 : cross < 0 ? 1 : -1 }
  /** Where a driving car is and which way it faces: along its lane plus smooth lateral lane-change, overtake, and emergency kerb-yield offsets. */
  const pose = (c: Car) => {
    const r = c.road!, s = c.s!, lane = c.lane!
    const totalShift = (c.laneShift ?? 0) + (c.overtakeShift ?? 0) + (c.sirenYieldShift ?? 0)
    const steerYaw = c.latVel ? Math.max(-0.28, Math.min(0.28, Math.atan2(c.latVel, Math.max(c.v, 24)))) : 0
    const bend = (from: Road, to: Road, u: number) => {
      const lf = Math.min(lane, from.lanes - 1), lt = Math.min(lane, to.lanes - 1), cf = Math.min(CURVE, from.len / 2), ct = Math.min(CURVE, to.len / 2)
      lanePoint(from, lf, from.len - cf, P); const ax = P.x, az = P.z
      lanePoint(from, lf, from.len, P); const ex = P.x, ez = P.z, ftx = P.tx, ftz = P.tz
      lanePoint(to, lt, 0, Q); const sx = Q.x, sz = Q.z, ttx = Q.tx, ttz = Q.tz
      lanePoint(to, lt, ct, Q); const bx = Q.x, bz = Q.z
      let cx = (ex + sx) / 2, cz = (ez + sz) / 2
      // On multi-lane turns, intersect the incoming and outgoing lane lines so outer lanes turn concentrically
      // instead of bowing across inner lanes.
      const det = ftx * ttz - ftz * ttx
      if (Math.abs(det) > 0.35) {
        const ti = ((sx - ex) * ttz - (sz - ez) * ttx) / det
        const ix = ex + ftx * ti, iz = ez + ftz * ti
        if (Math.hypot(ix - cx, iz - cz) < 90 && (ix - ax) * ftx + (iz - az) * ftz >= -5 && (bx - ix) * ttx + (bz - iz) * ttz >= -5) {
          cx = ix; cz = iz
        }
      }
      const v = 1 - u
      c.x = v * v * ax + 2 * u * v * cx + u * u * bx; c.z = v * v * az + 2 * u * v * cz + u * u * bz
      const dx = 2 * v * (cx - ax) + 2 * u * (bx - cx), dz = 2 * v * (cz - az) + 2 * u * (bz - cz)
      if (Math.hypot(dx, dz) > 1e-3) c.heading = Math.atan2(dz, dx)
      if (totalShift !== 0) {
        const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
        c.x += -sh * totalShift
        c.z += ch * totalShift
      }
      if (steerYaw) c.heading += steerYaw * 0.5
    }
    const cf = Math.min(CURVE, r.len / 2)
    if (c.next && s > r.len - cf) bend(r, c.next, (s - (r.len - cf)) / (cf + Math.min(CURVE, c.next.len / 2)))
    else if (c.prev && s < Math.min(CURVE, r.len / 2)) { const cp = Math.min(CURVE, c.prev.len / 2), cr = Math.min(CURVE, r.len / 2); bend(c.prev, r, (cp + s) / (cp + cr)) }
    else {
      lanePoint(r, lane, s, P)
      c.x = P.x - P.tz * totalShift
      c.z = P.z + P.tx * totalShift
      c.heading = Math.atan2(P.tz, P.tx) + steerYaw
    }
    settle(c)
  }
  const limit = (r: Road) => (r.flags & 4 ? SLOW : r.lanes >= 2 ? FAST : ORDINARY)
  /** Whether a junction asks everyone to take a turn: three ways or more meet there. */
  /** A junction as its approaches say: three neighbours or more (two through-ways crossing share one way id each way). */
  interface Junction { x: number; z: number; ax: number; az: number; offset: number; lights: boolean; stops: boolean; allway: boolean; size: number }
  const junctions = new Map<number, Junction>()
  const junctionOf = (node: number): Junction => {
    let j = junctions.get(node)
    if (j) return j
    const ins = roadsTo.get(node) ?? [], outs = roadsFrom.get(node) ?? [], near = new Set<number>()
    for (const r of ins) near.add(r.a)
    for (const r of outs) near.add(r.b)
    // The main axis: the way in of the highest class (the longest of those), as a direction; its lights go green first.
    const main = [...ins].sort((a, b) => b.cls - a.cls || b.len - a.len || a.way - b.way || a.a - b.a)[0]
    let ax = 1, az = 0, x = 0, z = 0
    if (main) { along(main.p, main.cum, main.len, P); ax = P.tx; az = P.tz; x = P.x; z = P.z }
    j = { x, z, ax, az, offset: chance(idSeed(node), 11) * CYCLE, lights: ins.some((r) => r.ctl >= 2), stops: ins.some((r) => r.ctl === 1), allway: ins.length > 0 && ins.every((r) => r.ctl === 1), size: near.size }
    // (Cached only once its squares are in: a junction on a seam is asked again when the next square comes.)
    if (squares.size && [...squares.values()].every((v) => v === 'held')) junctions.set(node, j)
    return j
  }
  const busyJunction = (node: number) => junctionOf(node).size >= 3
  /** Which of a junction's two phases a way belongs to: the main axis's (0), or across it (1). */
  const phaseOf = (j: Junction, dx: number, dz: number) => (Math.abs(dx * j.ax + dz * j.az) >= Math.SQRT1_2 ? 0 : 1)
  /** Seconds into a junction's cycle at a moment on the clock everyone shares: lights and walking signs are a rule of the clock. */
  const cycleAt = (j: Junction, t: number) => (((t + j.offset) % CYCLE) + CYCLE) % CYCLE
  /** The lights for a way into a junction at a moment: green, amber or red. */
  const lightFor = (j: Junction, dx: number, dz: number, t: number): 'green' | 'amber' | 'red' => {
    const u = cycleAt(j, t) - phaseOf(j, dx, dz) * (CYCLE / 2)
    return u >= 0 && u < GREEN ? 'green' : u >= GREEN && u < GREEN + AMBER ? 'amber' : 'red'
  }
  const unseen = (x: number, z: number, view: View) => {
    const dx = x - view.eye[0], dz = z - view.eye[2], d = Math.hypot(dx, dz)
    if (d > 1500) return true
    const ahead = (dx * view.forward[0] + dz * view.forward[2]) / (Math.hypot(view.forward[0], view.forward[2]) || 1)
    return ahead < -60 || Math.abs(dx * view.forward[2] - dz * view.forward[0]) / (Math.hypot(view.forward[0], view.forward[2]) || 1) > ahead * view.tanHalf * 2 + 80
  }
  let filled = false, lastEye: number[] | null = null
  /**
   * Whether a vehicle set down at a place, heading a way, half so long and so wide, would be within `room` cells of
   * any vehicle that drives or lives there. Traffic was set down clear only of the cars in its own lane and streetcars
   * of other streetcars, and on the first frame after the street was filled a streetcar stood 2.6 m into a car that
   * waited behind another. (Parked
   * cars are not asked about: they stand beside the lanes, some a little into them, and a bus has 35 cm to spare
   * each side.)
   */
  const taken = (x: number, z: number, hx: number, hz: number, halfL: number, halfW: number, room: number, cars = true) => {
    const far = halfL + 160
    const near = (cx: number, cz: number, fx: number, fz: number, long: number, wide: number) => Math.abs(cx - x) < far && Math.abs(cz - z) < far && obbOverlap(x, z, hx, hz, halfL, halfW, cx, cz, fx, fz, long / 2, wide / 2) < room
    for (const list of cars ? [traffic, depotCars, trams, cables] : [depotCars, trams, cables]) for (const c of list) if (near(c.x, c.z, Math.cos(c.heading), Math.sin(c.heading), c.model.long, c.model.wide)) return true
    for (const c of pending.keys()) if (near(c.x, c.z, Math.cos(c.heading), Math.sin(c.heading), c.model.long, c.model.wide)) return true
    for (const t of o.alive.things) { const w = o.alive.where(t); if (w && near(w.at[0], w.at[2], w.front[0], w.front[2], Math.max(t.size[0], t.size[2]), Math.min(t.size[0], t.size[2]))) return true }
    return false
  }
  const spawn = (view: View, any: boolean) => {
    const eye = view.eye, near: Road[] = [], seen = new Set<Road>()
    for (let gx = Math.floor((eye[0] - DRIVEN) / GRID); gx <= Math.floor((eye[0] + DRIVEN) / GRID); gx++) for (let gz = Math.floor((eye[2] - DRIVEN) / GRID); gz <= Math.floor((eye[2] + DRIVEN) / GRID); gz++) for (const r of roadGrid.get(cell(gx, gz)) ?? []) if (!seen.has(r)) { seen.add(r); near.push(r) }
    // How many cars the roads round here carry: each road's share by its length and how busy it is.
    let want = 0
    const shares: number[] = []
    for (const r of near) { const w = Math.hypot(r.mx - eye[0], r.mz - eye[2]) < DRIVEN ? r.len * r.weight : 0; want += w; shares.push(want) }
    const total = want
    const stationBoost = maxStationFactor(eye[0], eye[2])
    const cap = Math.round(70 + 18 * stationBoost)
    want = Math.min(cap, Math.round(want * (1 + 0.35 * stationBoost) * hourly(TRAFFIC, o.hour())))
    const cars = carModels()
    const firstRobotaxi = ROBOTAXI_SERVICES.length ? robotaxiModels.get(ROBOTAXI_SERVICES[0].id) : undefined
    if ((!cars.length && !firstRobotaxi) || !total) return
    for (let tries = 0; tries < (any ? 300 : 6) && traffic.length < want; tries++) {
      const pick = random() * total
      let lo = 0, hi = shares.length - 1
      while (lo < hi) { const m = (lo + hi) >> 1; if (shares[m] < pick) lo = m + 1; else hi = m }
      const r = near[lo]
      if (!r || !open(r)) continue
      const s = random() * r.len, lane = Math.floor(random() * r.lanes)
      lanePoint(r, lane, s, P)
      const sg = o.land.ground_at(Math.round(P.x), Math.round(P.z))
      if (sg <= -150 || o.land.feet_at(Math.round(P.x), Math.round(P.z)) - sg > 30) continue
      const d = Math.hypot(P.x - eye[0], P.z - eye[2])
      if (d > DRIVEN || (!any && (d < 1200 || !unseen(P.x, P.z, view)))) continue
      if (traffic.some((c) => c.road === r && c.lane === lane && Math.abs(c.s! - s) < 120)) continue
      const m0 = cars.length ? mixOf(r, cars) : firstRobotaxi!
      let emergency: EmergencyKind | undefined
      let m = m0
      if (m.kind !== 'robotaxi' && m.kind !== 'truck' && random() < EMERGENCY_SPAWN_SHARE && traffic.filter((t2) => !!t2.emergency).length < 3) {
        emergency = random() < 0.58 ? 'police' : 'ambulance'
        if (emergency === 'ambulance' && ready.get('van')) m = ready.get('van')!
        else if (emergency === 'police' && ready.get('suv')) m = ready.get('suv')!
      }
      const paint = emergency ? -1 : !m.variants.length || random() < 0.3 ? -1 : Math.floor(random() * m.variants.length)
      if (taken(P.x, P.z, P.tx, P.tz, m.long / 2 + 40, m.wide / 2, 2)) continue
      const seedId = ids + 1
      const prof = driverProfile(seedId, m.kind, emergency)
      const c: Car = { id: ids++, model: m, paint, kind: 'traffic', seed: seedId, x: P.x, y: 0, z: P.z, heading: 0, pitch: 0, v: limit(r) * prof.speedBias * (0.5 + random() * 0.4), piece: null, shown: '', road: r, prev: null, next: null, lane, s, hold: null, stuck: 0, lidarAngle: random() * Math.PI * 2, profile: prof, emergency, sirenActive: !!emergency }
      c.next = choose(r, m.kind)
      pose(c)
      traffic.push(c)
    }
  }
  /** Whether anything comes the other way into a junction (about to cross it, or crossing it now) and goes on or turns right: what a car turning left waits for. */
  const oncoming = (c: Car, r: Road, ax: number, az: number) => {
    for (const o of traffic) {
      if (o === c || !o.road) continue
      const or = o.road
      if (or.b === r.b && or !== r) {
        along(or.p, or.cum, or.len, Q)
        if (Q.tx * ax + Q.tz * az > -0.7) continue
        const left = or.len - o.s!
        // Near enough to be at the junction in 4 s, and not standing at its own line.
        if (left > 60 + o.v * 4 || (o.v < 2 && left > 25)) continue
        if (o.next && turning(or, o.next) === 1) continue
        return true
      }
      if (o.prev && o.prev.b === r.b && o.s! < 70) {
        along(o.prev.p, o.prev.cum, o.prev.len, Q)
        if (Q.tx * ax + Q.tz * az > -0.7 || turning(o.prev, or) === 1) continue
        return true
      }
    }
    return false
  }
  let leftTurns = 0, leftConflicts = 0, yieldLeft = true, cableLights = true
  /**
   * Buses and trolleybuses on their routes: along each piece they come a headway apart (a rule of the clock: where the
   * n-th would be at its timetable's speed), and one is set down where a rule's bus is near the eye and none of the
   * piece's is near it; then it is driven as any vehicle is, keeping to the kerb lane, stopping at its stops. In its
   * hours only: an owl line at night, a peak line at its peak.
   */
  let busStops = 0, busLooked = -Infinity
  const busSpawn = (view: View, any: boolean, t: number) => {
    if (!any && Math.abs(t - busLooked) < 0.5) return
    busLooked = t
    const hour = ((o.hour() % 24) + 24) % 24, eye = view.eye
    for (const p of busPieces) {
      const [from, to] = p.hours
      if (!((hour >= from && hour < to) || (hour + 24 >= from && hour + 24 < to))) continue
      const m = ready.get(p.kind)
      if (!m) continue
      // Its roads as far as they are here, and where along the piece each begins.
      let s0 = 0
      const here: { r: Road; s0: number; i: number }[] = []
      for (let i = 0; i < p.keys.length; i++) { const r = roads.get(p.keys[i]); if (!r) { s0 += 1000; continue } here.push({ r, s0, i }); s0 += r.len }
      if (!here.length) continue
      const offset = chance(p.seed, 1) * p.apart, moved = (t * 70 + offset) % p.apart
      for (let at = moved; at < s0; at += p.apart) {
        let on: (typeof here)[number] | null = null
        for (const h of here) if (h.s0 <= at) on = h
        if (!on || at - on.s0 > on.r.len || !open(on.r)) continue
        const s = at - on.s0, lane = on.r.lanes - 1
        lanePoint(on.r, lane, s, P)
        const d = Math.hypot(P.x - eye[0], P.z - eye[2])
        if (d > DRIVEN || (!any && (d < 1200 || !unseen(P.x, P.z, view)))) continue
        if (traffic.some((c) => c.route?.piece === p && Math.hypot(c.x - P.x, c.z - P.z) < p.apart / 2)) continue
        if (traffic.some((c) => c.road === on.r && Math.abs(c.s! - s) < 150)) continue
        // (Clear of streetcars, cable cars and what lives; of the traffic by the rule above, as it was: a bus comes where its rule says, and is not tried elsewhere.)
        if (taken(P.x, P.z, P.tx, P.tz, m.long / 2 + 40, m.wide / 2, 2, false)) continue
        const c: Car = { id: ids++, model: m, paint: -1, kind: 'traffic', seed: ids, x: P.x, y: 0, z: P.z, heading: 0, pitch: 0, v: limit(on.r) * 0.5, piece: null, shown: '', road: on.r, prev: null, next: null, lane, s, hold: null, stuck: 0, route: { piece: p, i: on.i, served: s } }
        c.next = nextOf(c, on.r)
        pose(c)
        traffic.push(c)
      }
    }
  }
  // ── Multi-service robotaxi charging stations & bay circulation (#57) ──
  const depotCars: Car[] = []
  interface DepotState {
    service: RobotaxiService
    model: Model | null
    borns: StationBorns | null
    shown: boolean
    mascotAngle: number
    inGateLift: number
    outGateLift: number
    lastSpawn: number
    arrivals: number
    departures: number
    pieces: {
      gantry: Piece | null; mascot: Piece | null; northCanopy: Piece | null; southCanopy: Piece | null
      pavilion: Piece | null; inGate: Piece | null; outGate: Piece | null; inGatePosts: Piece | null; outGatePosts: Piece | null
      chargers: (Piece | null)[]; chargerActive: boolean[]; bollards: Piece[]
    }
  }
  const depots: DepotState[] = ROBOTAXI_SERVICES.map((service) => ({
    service,
    model: robotaxiModels.get(service.id) ?? null,
    borns: null,
    shown: false,
    mascotAngle: 0,
    inGateLift: 0,
    outGateLift: 0,
    lastSpawn: -99,
    arrivals: 0,
    departures: 0,
    pieces: {
      gantry: null, mascot: null, northCanopy: null, southCanopy: null, pavilion: null,
      inGate: null, outGate: null, inGatePosts: null, outGatePosts: null,
      chargers: service.station.bays.map(() => null),
      chargerActive: service.station.bays.map(() => false),
      bollards: [],
    },
  }))
  const depotByService = new Map<string, DepotState>(depots.map((d) => [d.service.id, d]))
  if (o.robotaxis) {
    void o.robotaxis.then((made) => {
      for (const built of made) {
        robotaxiModels.set(built.id, built)
        ready.set(built.id, built)
        const depot = depotByService.get(built.id)
        if (depot) depot.model = built
        if (prewarmOn) enqueueModelWarm(built)
      }
    })
  }

  const smoothWaypoints = (ctrl: [number, number][]): { pts: [number, number][]; cum: number[] } => {
    const pts: [number, number][] = []
    if (ctrl.length < 2) return { pts: ctrl, cum: [0] }
    pts.push(ctrl[0])
    for (let i = 1; i < ctrl.length - 1; i++) {
      const a = ctrl[i - 1], b = ctrl[i], c = ctrl[i + 1]
      const p0: [number, number] = [a[0] + (b[0] - a[0]) * 0.65, a[1] + (b[1] - a[1]) * 0.65]
      const p2: [number, number] = [b[0] + (c[0] - b[0]) * 0.35, b[1] + (c[1] - b[1]) * 0.35]
      for (let k = 0; k <= 5; k++) {
        const t = k / 5, u = 1 - t
        pts.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]])
      }
    }
    pts.push(ctrl[ctrl.length - 1])
    const cum: number[] = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return { pts, cum }
  }
  const sampleDepotPath = (pts: [number, number][], cum: number[], s: number): { x: number; z: number; heading: number } => {
    const total = cum[cum.length - 1] || 1
    const sc = Math.max(0, Math.min(total, s))
    let lo = 0, hi = cum.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= sc) lo = m; else hi = m }
    const segLen = Math.max(1e-4, cum[hi] - cum[lo]), f = (sc - cum[lo]) / segLen
    const x = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, z = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f
    const ptAt = (at: number): [number, number] => {
      const a = Math.max(0, Math.min(total, at))
      let i0 = 0, i1 = cum.length - 1
      while (i1 - i0 > 1) { const m = (i0 + i1) >> 1; if (cum[m] <= a) i0 = m; else i1 = m }
      const fl = (a - cum[i0]) / Math.max(1e-4, cum[i1] - cum[i0])
      return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * fl, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * fl]
    }
    const pA = ptAt(sc - 8), pB = ptAt(sc + 8)
    const heading = Math.atan2(pB[1] - pA[1], pB[0] - pA[0])
    return { x, z, heading }
  }
  const exitPathFor = (st: RobotaxiService['station'], bayIdx: number) => {
    const b = st.bays[bayIdx], tw = st.toWorld
    const ctrl: [number, number][] = [
      tw(b.u, b.w),
      tw(b.u * 0.45, b.w - 4.6),
      tw(3.2, Math.min(b.w - 6.8, -10.5)),
      tw(4.6, -13.5),
      tw(4.6, -18.5),
      tw(4.9, -24.5),
      tw(5.4, -29.5),
    ]
    return smoothWaypoints(ctrl)
  }
  const enterPathFor = (st: RobotaxiService['station'], bayIdx: number, fromX?: number, fromZ?: number) => {
    const b = st.bays[bayIdx], tw = st.toWorld
    const turnW = b.w + 5.8
    const ctrl: [number, number][] = [
      fromX !== undefined && fromZ !== undefined ? [fromX, fromZ] : tw(-5.0, -29.5),
      tw(-4.8, -24.5),
      tw(-4.6, -18.5),
      tw(-3.6, -11.5),
      tw(-1.2, Math.min(turnW, 14.5)),
      tw(b.u * 0.72, Math.min(turnW, 15.2)),
      tw(b.u, b.w + 3.2),
      tw(b.u, b.w),
    ]
    return smoothWaypoints(ctrl)
  }
  const attachToCityRoad = (c: Car): boolean => {
    let bestR: Road | null = null, bestS = 0, bestLane = 0, bestD = 260
    const fx = Math.cos(c.heading), fz = Math.sin(c.heading)
    for (let gx = Math.floor((c.x - 300) / GRID); gx <= Math.floor((c.x + 300) / GRID); gx++) {
      for (let gz = Math.floor((c.z - 300) / GRID); gz <= Math.floor((c.z + 300) / GRID); gz++) {
        for (const r of roadGrid.get(cell(gx, gz)) ?? []) {
          if (!open(r) || r.len < 60) continue
          for (let lane = 0; lane < r.lanes; lane++) {
            for (let s = 20; s <= r.len - 25; s += 20) {
              lanePoint(r, lane, s, P)
              const d = Math.hypot(P.x - c.x, P.z - c.z)
              const alignPenalty = (P.tx * fx + P.tz * fz) < -0.5 ? 65 : 0
              if (d + alignPenalty < bestD) { bestD = d + alignPenalty; bestR = r; bestS = s; bestLane = lane }
            }
          }
        }
      }
    }
    if (!bestR) return false
    c.road = bestR; c.s = bestS; c.lane = bestLane; c.prev = null; c.next = choose(bestR, c.model.kind)
    c.kind = 'traffic'; c.depot = undefined; c.stuck = 0; c.held = 0; c.v = Math.max(c.v, 22)
    pose(c)
    traffic.push(c)
    return true
  }
  const spawnDepotRobotaxi = (depot: DepotState, bayIdx: number, phase: 'charging' | 'exiting' | 'entering', now: number, progress = 0): Car => {
    const st = depot.service.station
    const b = st.bays[bayIdx]
    const [bx, bz] = st.toWorld(b.u, b.w)
    const path = phase === 'exiting' ? exitPathFor(st, bayIdx) : phase === 'entering' ? enterPathFor(st, bayIdx) : { pts: [[bx, bz] as [number, number]], cum: [0] }
    const total = path.cum[path.cum.length - 1] || 0
    const s = total * progress
    const c: Car = {
      id: ids++, model: depot.model!, paint: -1, kind: phase === 'charging' ? 'parked' : 'traffic', seed: ids,
      x: bx, y: 0, z: bz, heading: b.heading, pitch: 0, v: phase === 'charging' ? 0 : 28, piece: null, shown: '',
      lidarAngle: random() * Math.PI * 2,
      depot: { serviceId: depot.service.id, phase, bay: bayIdx, until: now + 9 + random() * 18, pts: path.pts, cum: path.cum, s },
    }
    if (phase !== 'charging') {
      const sp = sampleDepotPath(path.pts, path.cum, s)
      c.x = sp.x; c.z = sp.z; c.heading = sp.heading
    }
    settle(c)
    depotCars.push(c)
    return c
  }
  const hideDepot = (depot: DepotState) => {
    const sp = depot.pieces
    if (!depot.shown && !sp.gantry) return
    depot.shown = false
    sp.gantry?.destroy(); sp.gantry = null
    sp.mascot?.destroy(); sp.mascot = null
    sp.northCanopy?.destroy(); sp.northCanopy = null
    sp.southCanopy?.destroy(); sp.southCanopy = null
    sp.pavilion?.destroy(); sp.pavilion = null
    sp.inGate?.destroy(); sp.inGate = null
    sp.outGate?.destroy(); sp.outGate = null
    sp.inGatePosts?.destroy(); sp.inGatePosts = null
    sp.outGatePosts?.destroy(); sp.outGatePosts = null
    for (let i = 0; i < sp.chargers.length; i++) { sp.chargers[i]?.destroy(); sp.chargers[i] = null; sp.chargerActive[i] = false }
    for (const b of sp.bollards) b.destroy()
    sp.bollards.length = 0
  }
  const hideStations = () => { for (const depot of depots) hideDepot(depot) }
  const depotStep = (dt: number, view: View) => {
    const now = performance.now() / 1000
    for (const depot of depots) {
      if (!depot.model) continue
      const st = depot.service.station, sid = depot.service.id
      const dist = Math.hypot(view.eye[0] - st.cx, view.eye[2] - st.cz)
      if (dist > st.drawReach) {
        for (let i = depotCars.length - 1; i >= 0; i--) {
          if (depotCars[i].depot?.serviceId === sid) { hide(depotCars[i]); depotCars.splice(i, 1) }
        }
        continue
      }
      const own = depotCars.filter((c) => c.depot?.serviceId === sid)
      // Initial seeding when approaching a service's charging station: 4 charging across both canopies + 1 exiting + 1 entering!
      if (!own.length) {
        spawnDepotRobotaxi(depot, 0, 'charging', now + 12)
        spawnDepotRobotaxi(depot, 1, 'charging', now + 24)
        spawnDepotRobotaxi(depot, 3, 'charging', now + 18)
        spawnDepotRobotaxi(depot, 5, 'charging', now + 30)
        spawnDepotRobotaxi(depot, 4, 'exiting', now, 0.28)
        spawnDepotRobotaxi(depot, 2, 'entering', now, 0.16)
        depot.lastSpawn = now
      }
      const ownNow = depotCars.filter((c) => c.depot?.serviceId === sid)
      const occupiedBays = new Set(ownNow.map((c) => c.depot!.bay))
      const hasExiting = ownNow.some((c) => c.depot!.phase === 'exiting')
      const hasEntering = ownNow.some((c) => c.depot!.phase === 'entering')
      if (!hasEntering && occupiedBays.size < Math.max(1, st.bays.length - 1) && now - depot.lastSpawn > 8) {
        const freeBays = st.bays.filter((b) => !occupiedBays.has(b.id))
        const [ix, iz] = st.inRoad
        const clear = !obstacles.some((ob) => Math.hypot(ob.x - ix, ob.z - iz) < 65)
        if (freeBays.length && clear) {
          const pickBay = freeBays[Math.floor(random() * freeBays.length)]
          spawnDepotRobotaxi(depot, pickBay.id, 'entering', now, 0)
          occupiedBays.add(pickBay.id)
          depot.lastSpawn = now
        }
      }
      for (let i = depotCars.length - 1; i >= 0; i--) {
        const c = depotCars[i], d = c.depot!
        if (d.serviceId !== sid) continue
        c.lidarAngle = (c.lidarAngle ?? 0) + dt * (d.phase === 'charging' ? 1.2 : 4.6)
        if (d.phase === 'charging') {
          c.v = 0
          if (now >= d.until && !hasExiting && !depotCars.some((o2) => o2 !== c && o2.depot?.serviceId === sid && o2.depot.phase === 'exiting')) {
            const p = exitPathFor(st, d.bay)
            d.phase = 'exiting'; d.pts = p.pts; d.cum = p.cum; d.s = 0; c.kind = 'traffic'
          }
          continue
        }
        const hx = Math.cos(c.heading), hz = Math.sin(c.heading)
        let gap = Infinity
        for (const ob of obstacles) {
          if (ob.car === c) continue
          const dx = ob.x - c.x, dz = ob.z - c.z
          if (Math.abs(dx) > 160 || Math.abs(dz) > 160) continue
          const ahead = dx * hx + dz * hz, across = Math.abs(dx * hz - dz * hx)
          if (ahead <= 0 || ahead > 150 || across > c.model.wide * 0.55 + ob.wide + 3) continue
          const g = ahead - c.model.long / 2 - ob.long
          if (g < gap) gap = g
        }
        const total = d.cum[d.cum.length - 1] || 1
        const remain = total - d.s
        const cruise = d.phase === 'entering' && remain < 45 ? Math.max(14, remain * 0.65) : 34
        const vWant = gap < 14 ? 0 : gap < 45 ? cruise * ((gap - 14) / 31) : cruise
        c.v += Math.max(-BRAKE * 1.4, Math.min(GATHER * 0.9, (vWant - c.v) * 2.4)) * dt
        c.v = Math.max(0, c.v)
        d.s += c.v * dt
        if (d.s >= total) {
          if (d.phase === 'entering') {
            const b = st.bays[d.bay]
            const [bx, bz] = st.toWorld(b.u, b.w)
            c.x = bx; c.z = bz; c.heading = b.heading; c.v = 0; c.kind = 'parked'
            d.phase = 'charging'; d.until = now + 12 + random() * 16
            depot.arrivals++
            settle(c)
          } else {
            // The street graph can still be loading when a car first reaches the gate.
            const [x, z] = d.pts[d.pts.length - 1]
            c.x = x; c.z = z; c.v = 0; d.s = total
            if (now >= (d.retryRoadAt ?? 0)) {
              if (attachToCityRoad(c)) { depotCars.splice(i, 1); depot.departures++ }
              else { d.retryRoadAt = now + 0.5; settle(c) }
            }
          }
          continue
        }
        const sp = sampleDepotPath(d.pts, d.cum, d.s)
        c.x = sp.x; c.z = sp.z; c.heading = sp.heading
        settle(c)
      }
    }
  }
  const showStations = (view: View, dt: number) => {
    for (const depot of depots) {
      if (!depot.model) continue
      const st = depot.service.station, sid = depot.service.id, sp = depot.pieces
      const dist = Math.hypot(view.eye[0] - st.cx, view.eye[2] - st.cz)
      if (dist > st.drawReach) { hideDepot(depot); continue }
      const B = (depot.borns ??= buildStationBorns(depot.service))
      const eastQ = turnOf(HEAD_FRONT, st.eastHeading, 0)
      const westQ = turnOf(HEAD_FRONT, st.eastHeading + Math.PI, 0)
      const placeStatic = (cur: Piece | null, born: Born, uM: number, wM: number, q: [number, number, number, number], cellSize: number, yAdd = -0.2): Piece => {
        const p = cur ?? o.pieces.add(born, true)
        const [wx, wz] = st.toWorld(uM, wM)
        p.pos = [wx, feetAt(wx, wz) + yAdd, wz]
        p.rot = q
        p.cell = cellSize
        return p
      }
      const [gx, gz] = st.toWorld(0, -18.5)
      const gy = feetAt(gx, gz) - 0.2
      sp.gantry = placeStatic(sp.gantry, B.gantry, 0, -18.5, eastQ, 1)
      depot.mascotAngle = (depot.mascotAngle + dt * 1.15) % (Math.PI * 2)
      if (!sp.mascot) sp.mascot = o.pieces.add(B.mascot, true)
      sp.mascot.pos = [gx, gy + 65.5, gz]
      sp.mascot.rot = mulQ(eastQ, [0, Math.sin(depot.mascotAngle / 2), 0, Math.cos(depot.mascotAngle / 2)])
      sp.mascot.cell = 0.5
      sp.northCanopy = placeStatic(sp.northCanopy, B.canopy, -12.4, 2.0, eastQ, 1)
      sp.southCanopy = placeStatic(sp.southCanopy, B.canopy, 12.4, 2.0, westQ, 1)
      sp.pavilion = placeStatic(sp.pavilion, B.pavilion, 0, 23.5, eastQ, 1)
      for (let i = 0; i < st.bays.length; i++) {
        const b = st.bays[i]
        const active = depotCars.some((c) => c.depot?.serviceId === sid && c.depot.bay === b.id && c.depot.phase === 'charging')
        if (!sp.chargers[i] || sp.chargerActive[i] !== active) {
          sp.chargers[i]?.destroy()
          sp.chargers[i] = o.pieces.add(active ? B.chargerActive : B.chargerIdle, true)
          sp.chargerActive[i] = active
        }
        placeStatic(sp.chargers[i], active ? B.chargerActive : B.chargerIdle, b.row === 'north' ? -13.9 : 13.9, b.w, b.row === 'north' ? eastQ : westQ, 0.5)
      }
      const inGatePt = st.toWorld(-4.6, -15.8)
      const outGatePt = st.toWorld(4.6, -15.8)
      const nearGate = (pt: readonly [number, number]) => {
        for (const c of depotCars) if (c.depot?.phase !== 'charging' && Math.hypot(c.x - pt[0], c.z - pt[1]) < 95) return true
        for (const c of traffic) if (Math.hypot(c.x - pt[0], c.z - pt[1]) < 75) return true
        const f = o.feet()
        if (f && Math.hypot(f[0] - pt[0], f[2] - pt[1]) < 65) return true
        for (const t of o.alive.things) { const w = o.alive.where(t); if (w && Math.hypot(w.at[0] - pt[0], w.at[2] - pt[1]) < 85) return true }
        return false
      }
      const liftK = 1 - Math.exp(-dt * 5.2)
      depot.inGateLift += ((nearGate(inGatePt) ? 1.35 : 0) - depot.inGateLift) * liftK
      depot.outGateLift += ((nearGate(outGatePt) ? 1.35 : 0) - depot.outGateLift) * liftK
      sp.inGatePosts = placeStatic(sp.inGatePosts, B.gatePosts, -1.65, -15.8, westQ, 0.5)
      sp.outGatePosts = placeStatic(sp.outGatePosts, B.gatePosts, 1.65, -15.8, eastQ, 0.5)
      if (!sp.inGate) sp.inGate = o.pieces.add(B.gateArm, true)
      const [igx, igz] = st.toWorld(-1.85, -15.8)
      const igy = feetAt(igx, igz) - 0.2
      sp.inGate.pos = [igx, igy + 10.6, igz]
      sp.inGate.rot = mulQ(westQ, [-Math.sin(depot.inGateLift / 2), 0, 0, Math.cos(depot.inGateLift / 2)])
      sp.inGate.cell = 0.5
      if (!sp.outGate) sp.outGate = o.pieces.add(B.gateArm, true)
      const [ogx, ogz] = st.toWorld(1.85, -15.8)
      const ogy = feetAt(ogx, ogz) - 0.2
      sp.outGate.pos = [ogx, ogy + 10.6, ogz]
      sp.outGate.rot = mulQ(eastQ, [-Math.sin(depot.outGateLift / 2), 0, 0, Math.cos(depot.outGateLift / 2)])
      sp.outGate.cell = 0.5
      const bollardPts: [number, number][] = [[-14.5, -18.5], [14.5, -18.5], [-16.5, -9.5], [16.5, -9.5], [-16.5, 16.5], [16.5, 16.5], [-13.5, 22.0], [13.5, 22.0]]
      while (sp.bollards.length < bollardPts.length) sp.bollards.push(o.pieces.add(B.bollard, true))
      for (let i = 0; i < bollardPts.length; i++) placeStatic(sp.bollards[i], B.bollard, bollardPts[i][0], bollardPts[i][1], eastQ, 0.5)
      depot.shown = true
    }
  }

  /** The things in the way of cars: other cars, people on crossings and anyone standing in a lane, living things, cable cars. */
  const obstacles: { x: number; z: number; long: number; wide: number; v: number; hx: number; hz: number; car?: Car; alive?: boolean; isCrater?: boolean; isPedestrian?: boolean; stalled?: boolean }[] = []
  /**
   * Whether any of an obstacle's outline lies in the path straight ahead of a vehicle at a place heading a way, a
   * path `half` wide each side of its middle line; and if so how far ahead of the vehicle's middle that part of it
   * begins (`PATH.near`). By its sides, not its middle: each of its four edges cut to the path.
   */
  const PATH = { near: 0 }
  const inPath = (x: number, z: number, hx: number, hz: number, half: number, ob: (typeof obstacles)[number]) => {
    PATH.near = sweptPathNear(x, z, hx, hz, half, ob)
    return PATH.near < Infinity
  }
  /** How long a vehicle is, halved, from which it is a streetcar, a cable car or a bus (cells): in the way by where its sides are (`inPath`), not its middle. */
  const LONG = 40
  const drive = (dt: number, view: View, t: number) => {
    simTime += dt
    for (let k = nearMissCues.length - 1; k >= 0; k--) {
      if (simTime - nearMissCues[k].at > 2.4) nearMissCues.splice(k, 1)
    }
    const rainNow = o.rain()
    obstacles.length = 0
    const aiObstacles: ObstacleBox[] = []
    const emitters: EmergencyEmitter[] = []
    const pedPts: [number, number][] = []
    const stalledPerRoad = new Map<string, number>()
    activeCongested = new Set<string>()
    for (const r of roads.values()) if (r.blocked) activeCongested.add(r.key)

    for (const c of traffic) {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
      const stalled = !!c.rtStuck || (c.v < 2 && !c.queued && (c.stuck ?? 0) > 1.2)
      obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: c.v, hx: ch, hz: sh, car: c, stalled })
      aiObstacles.push({ x: c.x, z: c.z, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, hx: ch, hz: sh, id: c.id, stalled })
      // Reserve destination lane slot for cars mid-lane-change or mid-overtake so queued cars never merge into the same spot.
      if (c.road && (Math.abs(c.laneShift ?? 0) > 2 || c.overtake)) {
        lanePoint(c.road, c.lane!, c.s!, P)
        const targetSh = c.overtake ? c.overtake.shiftTarget : 0
        aiObstacles.push({
          x: P.x - P.tz * targetSh, z: P.z + P.tx * targetSh,
          halfL: c.model.long / 2 + 4, halfW: c.model.wide / 2 + 1,
          v: c.v, hx: P.tx, hz: P.tz, id: c.id,
        })
      }
      if (c.emergency && c.sirenActive) {
        emitters.push({ id: c.id, kind: c.emergency, x: c.x, y: c.y, z: c.z, hx: ch, hz: sh, v: c.v, active: true })
      }
      if (c.road) {
        if (c.rtStuck) {
          if (c.road.lanes === 1) activeCongested.add(c.road.key)
          else stalledPerRoad.set(c.road.key, (stalledPerRoad.get(c.road.key) ?? 0) + 2)
        } else if (c.blockedByObstruction && c.v < 4) {
          stalledPerRoad.set(c.road.key, (stalledPerRoad.get(c.road.key) ?? 0) + 1)
        }
      }
    }
    for (const [rKey, cnt] of stalledPerRoad) {
      if (cnt >= 3) activeCongested.add(rKey)
    }
    activeBlockedSig = blockedSetKey(activeCongested)
    aiStats.activeEmergency = emitters.length

    for (const c of depotCars) {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
      obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: c.v, hx: ch, hz: sh, car: c })
      aiObstacles.push({ x: c.x, z: c.z, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, hx: ch, hz: sh, id: c.id })
    }
    // Parked cars, which no place puts in a lane (inLane); and the holes blasts made in the road.
    for (const c of parked.values()) if (!c.thing) {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
      obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: 0, hx: ch, hz: sh })
      aiObstacles.push({ x: c.x, z: c.z, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: 0, hx: ch, hz: sh })
    }
    for (const h of craters) {
      obstacles.push({ x: h.x, z: h.z, long: h.r, wide: h.r, v: 0, hx: 1, hz: 0, isCrater: true })
      aiObstacles.push({ x: h.x, z: h.z, halfL: h.r, halfW: h.r, v: 0, hx: 1, hz: 0, isCrater: true })
    }
    for (const c of [...cables, ...trams]) {
      const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
      obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: c.v, hx: ch, hz: sh, car: c })
      aiObstacles.push({ x: c.x, z: c.z, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, hx: ch, hz: sh, id: c.id })
    }
    for (const th of o.alive.things) {
      const w = o.alive.where(th)
      if (w) {
        const hl = Math.max(th.size[0], th.size[2]) / 2, hw = Math.min(th.size[0], th.size[2]) / 2
        const v = th.state ? Math.abs(th.state.speed ?? 0) : 0
        obstacles.push({ x: w.at[0], z: w.at[2], long: hl, wide: hw, v, hx: w.front[0], hz: w.front[2], alive: true })
        aiObstacles.push({ x: w.at[0], z: w.at[2], halfL: hl, halfW: hw, v, hx: w.front[0], hz: w.front[2] })
      }
    }
    for (const [x, z] of crossing) {
      obstacles.push({ x, z, long: 3, wide: 3, v: 0, hx: 1, hz: 0, isPedestrian: true })
      pedPts.push([x, z])
    }
    for (const b of o.bodies()) {
      obstacles.push({ x: b[0], z: b[2], long: 3, wide: 3, v: 0, hx: 1, hz: 0, isPedestrian: true })
      pedPts.push([b[0], b[2]])
    }
    const nearMissPeds = nearPeds.length ? pedPts.concat(nearPeds) : pedPts

    for (let i = traffic.length - 1; i >= 0; i--) {
      const c = traffic[i], r = c.road!, hx = Math.cos(c.heading), hz = Math.sin(c.heading)
      const profile = ensureProfile(c)
      const rf = rainDrivingFactors(profile, rainNow)
      const pedYieldBuf = crosswalkYieldBuffer(profile, c.v, rainNow)
      let gap = Infinity, lead = 0, why = '', leadCar: Car | undefined, hitCrater = false
      const meCar = { x: c.x, z: c.z, hx, hz, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, id: c.id }
      for (const ob of obstacles) {
        if (ob.car === c) continue
        let g = trafficObstacleGap(meCar, ob.car ? { ...ob, id: ob.car.id } : ob)
        if (g === Infinity) continue
        if (ob.isPedestrian && g > 4) g = Math.max(0.5, g - pedYieldBuf)
        if (g < gap) {
          gap = g
          lead = ob.v * (ob.hx * hx + ob.hz * hz)
          why = ob.car ? 'car' : ob.isPedestrian ? 'person' : ob.isCrater ? 'crater' : 'vehicle'
          leadCar = ob.car
          hitCrater = !!ob.isCrater
        }
      }
      // Emergency acoustic siren yielding (#164 Phase 3A): regular vehicles in the forward siren cone pull smoothly toward right kerb and slow down.
      const sy = evaluateSirenYield({ id: c.id, x: c.x, y: c.y, z: c.z, hx, hz, lane: c.lane, lanes: r.lanes, emergency: c.emergency }, emitters)
      if (sy.yielding && !c.sirenYielding) {
        c.sirenYielding = true
        aiStats.sirenYields++
      } else if (!sy.yielding && c.sirenYielding) {
        c.sirenYielding = false
      }
      let safeSirenTarget = sy.targetShift
      if (safeSirenTarget > 0.5) {
        const deltaNeed = safeSirenTarget - (c.sirenYieldShift ?? 0)
        if (deltaNeed > 0.5 && !isLaneClear({ id: c.id, x: c.x, z: c.z, hx, hz, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, lateralShift: deltaNeed, forwardClear: 12, rearClear: 8, margin: 2 }, aiObstacles)) {
          safeSirenTarget = Math.max(c.sirenYieldShift ?? 0, safeSirenTarget * 0.45)
        }
      }
      const isEmergencyActive = !!(c.emergency && c.sirenActive)
      // At a junction of three ways or more: as its lights say, after a full stop at a sign, or by turns where nothing
      // controls it. Emergency vehicles with active siren slow briefly for caution then proceed through red lights.
      const left = r.len - c.s!
      let held = false
      let emergencyCaution = false
      const line = (at: number, because: string) => { if (left - at < gap) { gap = left - at; lead = 0; why = because } held = true }
      if (left < 150 && busyJunction(r.b)) {
        const j = junctionOf(r.b)
        along(r.p, r.cum, r.len, P)
        const ax = P.tx, az = P.tz
        if (r.ctl >= 2) {
          // Lights: through on green; on amber only if it cannot stop short of the line (rain elongates stopping distance).
          const light = lightFor(j, ax, az, t)
          const effBrakeStop = (BRAKE / rf.brakeMult) * 0.8
          if (isEmergencyActive) {
            if (light === 'red' && left < 95 && left > 12) emergencyCaution = true
          } else if (light === 'red' || (light === 'amber' && left - 35 > (c.v * c.v) / (2 * effBrakeStop))) {
            line(35, 'lights')
          } else if (light === 'green' && yieldLeft && left > 30 && c.next && turning(r, c.next) === 1 && (c.held ?? 0) < 45 && oncoming(c, r, ax, az)) {
            line(35, 'oncoming')
          }
          // (Counted as it crosses the line: a left turn on green, and whether anything came the other way then.)
          if (light !== 'red' && left >= 30 && left - c.v * dt < 30 && c.next && turning(r, c.next) === 1) { leftTurns++; if (oncoming(c, r, ax, az)) leftConflicts++ }
        } else {
          if (r.ctl === 1 && c.stopped !== r.b) {
            if (isEmergencyActive) {
              if (left < 60 && left > 10) emergencyCaution = true
              c.stopped = r.b
            } else {
              // A stop sign: a full stop at the line first.
              if (c.v < 1.5 && left < 60) { c.stopped = r.b; signStops++ }
              else line(30, 'stop sign')
            }
          }
          if (!held && !isEmergencyActive) {
            let h = holds.get(r.b)
            if (!h) holds.set(r.b, h = new Map())
            if (!h.has(c)) {
              let straight = true
              if (c.next) { along(c.next.p, c.next.cum, 0, Q); straight = ax * Q.tx + az * Q.tz > 0.8 }
              for (const k of h.keys()) if (!traffic.includes(k)) h.delete(k)
              // On the way with no sign where others have one, it goes and they wait: it only says it is crossing.
              const priority = j.stops && r.ctl === 0
              const clear = priority || [...h.values()].every((o2) => straight && o2.straight && Math.abs(o2.ax * ax + o2.az * az) > 0.8)
              // A sign's way yields to anyone on the way without one who is about to cross.
              const yielding = !priority && j.stops && !j.allway && traffic.some((o2) => o2 !== c && o2.road && o2.road.b === r.b && o2.road.ctl === 0 && o2.road.len - o2.s! < 200 && o2.v > 5)
              // Waited long (whoever holds it is held up in turn): it goes when it can.
              if ((clear && !yielding) || (c.held ?? 0) > 25) h.set(c, { ax, az, straight })
              else line(30, 'its turn')
            }
          }
        }
      }
      // A bus pulls up at each of its route's stops on this road and stands there a while for whoever gets on and off.
      if (c.route) {
        const R = c.route
        for (const [ri, at] of R.piece.stops) {
          if (ri !== R.i || at <= R.served) continue
          const ahead = at - c.s!
          if (ahead < -15) { R.served = at; continue }
          if (ahead > 300) break
          if (ahead < 15 && c.v < 3) {
            R.dwell ??= t + 10 + 12 * chance(c.seed, Math.round(at))
            if (t >= R.dwell) { R.served = at; R.dwell = undefined; busStops++; continue }
          }
          if (Math.max(0, ahead) < gap) { gap = Math.max(0, ahead); lead = 0; why = 'bus stop' }
          break
        }
      }
      // Budgeted local junction detour (#164 Phase 3A): if our planned outgoing road became blocked or congested, re-plan before entering it!
      if (c.next && left > 14 && left < 240 && (c.next.blocked || activeCongested.has(c.next.key))) {
        const detour = planLocalDetour(detourGraph, r, activeCongested, { kind: c.model.kind, cache: detourCache, blockedSignature: activeBlockedSig })
        if (detour) {
          const alt = roads.get(detour.nextKey)
          if (alt && alt !== c.next) {
            c.next = alt
            if (c.route) c.route = undefined
            c.resolvingBlock = true
            aiStats.detours++
          }
        }
      }
      if (!c.next && left < 220) { if (c.route && c.route.i + 1 >= c.route.piece.keys.length) c.route = undefined; c.next = nextOf(c, r); if (!c.next && left - 10 < gap) { gap = left - 10; lead = 0; why = 'end' } }
      // Individualized driver speed, rain wet-surface scaling, cornering slowdown, siren yield cap, and blast shock.
      let v0 = limit(r) * profile.speedBias * rf.topSpeedScale
      const nowDrive = performance.now() / 1000
      const isRT = c.model.kind === 'robotaxi'
      const nudged = !!c.honked && nowDrive - c.honked < 2.5
      if (nudged && c.shaken !== undefined) c.shaken = undefined
      if (c.shaken !== undefined && simTime - c.shaken < 5) { v0 = 0.01; gap = Math.min(gap, 1); why = why || 'blast' }
      if (c.next && left < 200) {
        along(r.p, r.cum, r.len, P); along(c.next.p, c.next.cum, 0, Q)
        if (P.tx * Q.tx + P.tz * Q.tz < 0.8) {
          v0 = Math.min(v0, 45 * rf.cornerSpeedScale * Math.max(0.75, 1.12 - 0.14 * profile.caution))
        }
      }
      if (sy.yielding) v0 = Math.min(v0, Math.max(6, limit(r) * sy.speedCapScale))
      if (emergencyCaution) v0 = Math.min(v0, 46)
      if (isRT) {
        // Autonomous robotaxi driving: extra smooth & polite — usually! Sometimes freezes at intersections or on narrow streets.
        c.lidarAngle = (c.lidarAngle ?? 0) + dt * (c.rtStuck ? Math.sin(nowDrive * 5.2 + c.seed) * 7.5 + 1.5 : 4.8)
        const dEye = Math.hypot(c.x - view.eye[0], c.z - view.eye[2])
        if (c.rtStuck) {
          if (nowDrive >= c.rtStuck.until) {
            c.rtStuck = undefined
            c.rtCool = nowDrive + 45
          } else {
            if (nowDrive >= c.rtStuck.stutter && gap > 14) {
              c.rtStuck.microEnd = nowDrive + 0.45
              c.rtStuck.stutter = nowDrive + 4.4 + random() * 3.0
            }
            if (nowDrive < c.rtStuck.microEnd) {
              v0 = 9
              gap = Math.min(gap, 14)
            } else {
              v0 = 0.01
              gap = 0
              why = 'robotaxi-stuck'
            }
          }
        } else if (dEye < 1300 && nowDrive > (c.rtCool ?? 0) && traffic.filter((t2) => t2.rtStuck).length < 2) {
          if (left > 14 && left < 78 && busyJunction(r.b) && c.rtNode !== r.b) {
            c.rtNode = r.b
            const nearOtherRT = traffic.some((o2) => o2 !== c && o2.model.kind === 'robotaxi' && Math.hypot(o2.x - c.x, o2.z - c.z) < 180)
            if (random() < (nearOtherRT ? 0.42 : 0.15)) {
              c.rtStuck = { at: nowDrive, until: nowDrive + 24 + random() * 14, kind: 'intersection', stutter: nowDrive + 3.2 + random() * 2.4, microEnd: 0 }
              v0 = 0.01; gap = 0; why = 'robotaxi-stuck'
            }
          } else if ((r.lanes === 1 || (r.flags & 4) !== 0) && c.s! > 55 && left > 55 && c.rtRoadKey !== r.key) {
            c.rtRoadKey = r.key
            const tight = traffic.some((o2) => o2 !== c && Math.hypot(o2.x - c.x, o2.z - c.z) < 180)
            if (random() < (tight ? 0.24 : 0.14)) {
              c.rtStuck = { at: nowDrive, until: nowDrive + 22 + random() * 14, kind: 'narrow', stutter: nowDrive + 3.6 + random() * 2.6, microEnd: 0 }
              v0 = 0.01; gap = 0; why = 'robotaxi-stuck'
            }
          }
        }
      }
      if (nudged && !c.rtStuck && why !== 'lights' && gap > 6) v0 *= 1.18
      const effBrake = BRAKE / rf.brakeMult
      const effGather = (isRT ? GATHER * 0.86 : GATHER * (0.82 + 0.36 * profile.aggression)) * (isEmergencyActive ? 1.25 : 1)
      const headway = (0.95 + 0.55 * profile.caution) * rf.gapMult
      const minGap = profile.followGapCells * rf.gapMult
      const want = minGap + c.v * headway + (c.v * (c.v - lead)) / (2 * Math.sqrt(effGather * effBrake))
      const acc = effGather * (1 - (c.v / Math.max(0.01, v0)) ** 4 - (gap < Infinity ? (Math.max(0, want) / Math.max(1, gap)) ** 2 : 0))
      c.v = Math.max(0, Math.min(v0 * 1.05, c.v + Math.max(-effBrake * 3, acc) * dt))
      if (nudged && !c.rtStuck && why !== 'lights' && gap > 8 && c.v < 18) c.v = Math.min(gap * 1.4, c.v + GATHER * 1.6 * dt)
      if (gap < 5) c.v = Math.min(c.v, Math.max(0, gap) * 2)
      const prevPose = {
        x: c.x, z: c.z, y: c.y, heading: c.heading, pitch: c.pitch, roll: c.roll,
        s: c.s!, road: c.road, prev: c.prev, next: c.next, lane: c.lane,
        laneShift: c.laneShift ?? 0, overtakeShift: c.overtakeShift ?? 0, sirenYieldShift: c.sirenYieldShift ?? 0,
        route: c.route ? { ...c.route } : undefined,
      }
      c.s! += c.v * dt

      // Pedestrian near-miss emission (#164 Phase 3A): close fast passes emit structured cues so nearby pedestrians flinch/step back.
      if (c.v >= 28 && nearMissPeds.length) {
        const cues = detectPedestrianNearMiss(
          { id: c.id, x: c.x, z: c.z, hx, hz, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v },
          nearMissPeds, simTime, pedNearMissCool, () => nextNearMissCueId++,
        )
        for (const cue of cues) {
          nearMissCues.push(cue)
          if (nearMissCues.length > 32) nearMissCues.shift()
        }
      }

      // Waiting on a control — or queued behind a vehicle waiting on one (red light, stop sign, bus stop, turn, or frozen robotaxi) — is not stuck.
      const queued = held || why === 'bus stop' || why === 'lights' || why === 'stop sign' || why === 'oncoming' || why === 'its turn' || (why === 'car' && !!(leadCar?.queued || leadCar?.rtStuck))
      c.queued = c.v < 2 && queued
      c.held = held && c.v < 2 ? (c.held ?? 0) + dt : 0
      c.stuck = c.v < 2 && !queued && !c.rtStuck ? c.stuck! + dt : 0
      c.wait = c.v < 2 ? (why === 'car' && (leadCar?.queued || leadCar?.rtStuck) ? 'queue' : why) : ''

      // Pedestrian crosswalk impatience: hurried drivers honk earlier when held up by pedestrians.
      if (!c.rtStuck && why === 'person' && c.v < 8) {
        c.pedBlockedTime = (c.pedBlockedTime ?? 0) + dt
        if (c.pedBlockedTime > profile.hornImpatience && nowDrive - (c.honkedBack ?? -99) > 4.5 && Math.hypot(c.x - view.eye[0], c.z - view.eye[2]) < 560) {
          c.honkedBack = nowDrive
          const heavy = c.model.kind === 'bus' || c.model.kind === 'trolley' || c.model.kind === 'truck'
          const pitch = heavy ? 235 + chance(c.seed, 47) * 65 : 350 + chance(c.seed, 47) * 140
          hornQueue.push({ at: [c.x, c.y + 8, c.z], pitch, annoyed: profile.aggression > 0.55, when: nowDrive + 0.04 })
        }
      } else {
        c.pedBlockedTime = Math.max(0, (c.pedBlockedTime ?? 0) - dt * 1.5)
      }

      // Annoyed nearby cars honk and flash high beams when blocked behind or around a stuck robotaxi (respects per-driver hornImpatience)!
      if (!c.rtStuck && c.v < 10) {
        const blockedByRT = traffic.some((sc) => {
          if (sc === c || !sc.rtStuck || nowDrive - sc.rtStuck.at < 0.9) return false
          const dx = sc.x - c.x, dz = sc.z - c.z, dd = Math.hypot(dx, dz)
          if (dd > 340) return false
          const ahead = (dx * hx + dz * hz) / Math.max(1, dd)
          return ahead > 0.15 || dd < 140
        })
        if (blockedByRT) {
          c.annoyedAt = (c.annoyedAt ?? 0) + dt
          if (c.annoyedAt > profile.hornImpatience && nowDrive - (c.honkedBack ?? -99) > 5.0 && nowDrive - lastStuckHorn > 2.0 && Math.hypot(c.x - view.eye[0], c.z - view.eye[2]) < 560) {
            c.honkedBack = nowDrive
            lastStuckHorn = nowDrive
            c.beamFlash = nowDrive + 0.65
            stuckHonksStat++
            const heavy = c.model.kind === 'bus' || c.model.kind === 'trolley' || c.model.kind === 'truck'
            const pitch = heavy ? 235 + chance(c.seed, 47) * 65 : 350 + chance(c.seed, 47) * 140
            hornQueue.push({ at: [c.x, c.y + 8, c.z], pitch, annoyed: true, when: nowDrive + 0.04 })
          }
        } else {
          c.annoyedAt = Math.max(0, (c.annoyedAt ?? 0) - dt * 0.5)
        }
      } else if (c.annoyedAt) {
        c.annoyedAt = Math.max(0, c.annoyedAt - dt)
      }

      // Returning city robotaxi turns cleanly into its own service's charging station when a bay is free!
      const homeDepot = isRT && !c.rtStuck && c.model.serviceId ? depotByService.get(c.model.serviceId) : undefined
      if (homeDepot?.shown && Math.hypot(c.x - homeDepot.service.station.inRoad[0], c.z - homeDepot.service.station.inRoad[1]) < 95 && !depotCars.some((dc) => dc.depot?.serviceId === homeDepot.service.id && dc.depot.phase === 'entering')) {
        const sid = homeDepot.service.id, st = homeDepot.service.station
        const usedBays = new Set(depotCars.filter((dc) => dc.depot?.serviceId === sid).map((dc) => dc.depot!.bay))
        const freeBay = st.bays.find((b) => !usedBays.has(b.id))
        if (freeBay) {
          const p = enterPathFor(st, freeBay.id, c.x, c.z)
          c.depot = { serviceId: sid, phase: 'entering', bay: freeBay.id, until: nowDrive + 20, pts: p.pts, cum: p.cum, s: 0 }
          c.road = undefined; c.prev = null; c.next = null; c.v = Math.min(c.v, 28)
          letGo(c)
          traffic.splice(i, 1)
          depotCars.push(c)
          continue
        }
      }

      // ── Dynamic Obstruction Detection, Smooth Adjacent Lane-Changing & Single-Lane Overtaking (#164 Phase 3A) ──
      const leadIsObstruction = !!(leadCar && (leadCar.rtStuck || leadCar.blockedByObstruction || (leadCar.v < 2.5 && !leadCar.queued && (leadCar.stuck ?? 0) > 1.2)))
      const craterObstruction = (r.blocked && (hitCrater || c.v < 12 || gap < 150)) || (hitCrater && gap < 160)
      const laneObstructed = !c.rtStuck && !held && !sy.yielding && why !== 'lights' && why !== 'stop sign' && why !== 'bus stop' && why !== 'oncoming' && why !== 'its turn' && (
        craterObstruction ||
        (why === 'car' && leadIsObstruction && gap < 185) ||
        ((why === 'car' || why === 'vehicle') && c.v < 6 && gap < 75 && !leadCar?.queued)
      )
      c.blockedByObstruction = laneObstructed && (c.v < 16 || gap < 130)
      if (laneObstructed) c.blockedAheadTime = (c.blockedAheadTime ?? 0) + dt
      else c.blockedAheadTime = Math.max(0, (c.blockedAheadTime ?? 0) - dt * 1.5)

      const reactDelay = isEmergencyActive ? 0.2 : 0.25 + (1 - profile.laneChangeWillingness) * 0.95
      const onStraightSegment = c.s! >= CURVE && left >= CURVE
      if (!c.rtStuck && !sy.yielding && onStraightSegment && Math.abs(c.laneShift ?? 0) < 2 && !c.overtake && (c.blockedAheadTime ?? 0) >= reactDelay && simTime >= (c.laneChangeCoolAt ?? 0)) {
        let shifted = false
        // 1) Multi-lane adjacent lane change with smooth lateral interpolation (ZERO snapping, ZERO overlaps).
        if (r.lanes > 1) {
          for (const delta of [-1, 1]) {
            const alt = c.lane! + delta
            if (alt < 0 || alt >= r.lanes) continue
            const deltaOff = laneOff(r, alt) - laneOff(r, c.lane!)
            if (isLaneClear({
              id: c.id, x: c.x, z: c.z, hx, hz,
              halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v,
              lateralShift: deltaOff, margin: 4.5,
            }, aiObstacles)) {
              c.lane = alt
              c.laneShift = (c.laneShift ?? 0) - deltaOff
              c.blockedAheadTime = 0
              c.stuck = 0
              c.resolvingBlock = true
              c.laneChangeCoolAt = simTime + 1.3
              aiStats.laneChanges++
              letGo(c)
              // Reserve new lane spot immediately for trailing cars evaluated later in the same tick.
              lanePoint(r, alt, c.s!, Q)
              aiObstacles.push({ x: Q.x, z: Q.z, halfL: c.model.long / 2 + 4, halfW: c.model.wide / 2 + 1, v: c.v, hx: Q.tx, hz: Q.tz, id: c.id })
              shifted = true
              break
            }
          }
        }
        // 2) Single-lane or all-lanes-obstructed smooth lateral overtake around stalled PayMo or crater.
        if (!shifted && (r.lanes === 1 || leadCar?.rtStuck || craterObstruction)) {
          const obS = leadCar && leadCar.road === r ? (leadCar.s! + leadCar.model.long * 0.5) : (c.s! + Math.min(Math.max(gap, 25), 95) + 25)
          const passDist = Math.max(68, (obS - c.s!) + c.model.long + 26)
          const candShifts = !(r.flags & 1) ? [-33, 26] : [-28, 28]
          for (const shiftCand of candShifts) {
            const opposing = !(r.flags & 1) && shiftCand < 0
            if (isLaneClear({
              id: c.id, x: c.x, z: c.z, hx, hz,
              halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v,
              lateralShift: shiftCand, forwardClear: passDist, opposingLane: opposing, margin: 4,
            }, aiObstacles)) {
              c.overtake = { shiftTarget: shiftCand, clearS: obS + c.model.long * 0.5 + 24, roadKey: r.key, aroundId: leadCar?.id }
              c.blockedAheadTime = 0
              c.stuck = 0
              c.resolvingBlock = true
              c.laneChangeCoolAt = simTime + 1.4
              aiStats.laneChanges++
              lanePoint(r, c.lane!, c.s!, Q)
              aiObstacles.push({ x: Q.x - Q.tz * shiftCand, z: Q.z + Q.tx * shiftCand, halfL: c.model.long / 2 + 6, halfW: c.model.wide / 2 + 1, v: c.v, hx: Q.tx, hz: Q.tz, id: c.id })
              shifted = true
              break
            }
          }
        }
      }

      // Smoothly interpolate lateral offsets (`laneShift`, `overtakeShift`, `sirenYieldShift`).
      const lsStep = stepLateralShift(c.laneShift ?? 0, 0, dt, Math.max(18, c.v * 0.45))
      c.laneShift = lsStep.value
      if (c.overtake) {
        const pastOb = c.overtake.roadKey !== r.key || c.s! >= c.overtake.clearS
        if (pastOb) {
          const retShift = -(c.overtakeShift ?? 0)
          if (Math.abs(retShift) < 1 || isLaneClear({ id: c.id, x: c.x, z: c.z, hx, hz, halfL: c.model.long / 2, halfW: c.model.wide / 2, v: c.v, lateralShift: retShift, forwardClear: 28, rearClear: 18, margin: 3.5 }, aiObstacles)) {
            c.overtake = undefined
          }
        }
      }
      const otStep = stepLateralShift(c.overtakeShift ?? 0, c.overtake ? c.overtake.shiftTarget : 0, dt, Math.max(18, c.v * 0.45))
      c.overtakeShift = otStep.value
      const syStep = stepLateralShift(c.sirenYieldShift ?? 0, safeSirenTarget, dt, sy.yielding ? 18 : 12)
      c.sirenYieldShift = syStep.value
      c.latVel = lsStep.vel + otStep.vel + syStep.vel

      // Credit deadlock resolution once a vehicle that was blocked smoothly clears and resumes cruising.
      if (c.resolvingBlock && !c.blockedByObstruction && c.v > 16 && Math.abs(c.laneShift ?? 0) < 4 && !c.overtake) {
        c.resolvingBlock = false
        aiStats.deadlocksResolved++
      }

      // A hole ahead in its road that cannot be bypassed laterally: turn round onto the reverse way if the exit path ahead of us is clear of craters.
      if (r.blocked && ((c.stuck ?? 0) > 2.0 || (c.blockedAheadTime ?? 0) > 2.0)) {
        const back = roads.get(`${r.way}/${r.b}/${r.a}`)
        if (back) {
          const ns = Math.max(0, back.len - c.s!)
          let backClearOfCraters = !back.blocked
          if (!backClearOfCraters) {
            backClearOfCraters = true
            for (let ds = ns + 15; ds <= back.len; ds += 25) {
              lanePoint(back, 0, ds, Q)
              if (craters.some((h) => Math.hypot(Q.x - h.x, Q.z - h.z) < h.r + 14)) { backClearOfCraters = false; break }
            }
          }
          if (backClearOfCraters) {
            lanePoint(back, 0, ns, Q)
            if (!taken(Q.x, Q.z, Q.tx, Q.tz, c.model.long / 2 + 8, c.model.wide / 2 + 2, 2)) {
              c.prev = null; c.road = back; c.s = ns; c.lane = 0; c.laneShift = 0; c.overtakeShift = 0; c.overtake = undefined
              c.route = undefined; c.next = choose(back, c.model.kind); c.stuck = 0; c.blockedAheadTime = 0
              aiStats.detours++; aiStats.deadlocksResolved++; letGo(c)
            }
          } else if (unseen(c.x, c.z, view)) { letGo(c); hide(c); traffic.splice(i, 1); continue }
        } else if (unseen(c.x, c.z, view)) { letGo(c); hide(c); traffic.splice(i, 1); continue }
      }
      // At the end of a road that goes nowhere it may (mapping ends there, or the way on is closed): it turns round,
      // or clears cleanly on one-way stubs where no reverse road exists so it cannot stall the lane forever (#129).
      if (!c.next && c.stuck! > 4 && c.road!.len - c.s! < 40) {
        const back = roads.get(`${c.road!.way}/${c.road!.b}/${c.road!.a}`)
        if (back && open(back)) { c.prev = null; c.road = back; c.s = 0; c.lane = Math.min(c.lane!, back.lanes - 1); c.laneShift = 0; c.overtake = undefined; c.overtakeShift = 0; c.route = undefined; c.next = choose(back, c.model.kind); c.stuck = 0; letGo(c) }
        else if (c.stuck! > 6) { letGo(c); hide(c); traffic.splice(i, 1); continue }
      }
      while (c.s! >= c.road!.len) {
        if (!c.next) break
        c.s! -= c.road!.len
        c.prev = c.road!; c.road = c.next; c.lane = Math.min(c.lane!, c.road.lanes - 1)
        if (c.overtake && c.overtake.roadKey !== c.road.key) c.overtake = undefined
        if (c.route) { c.route.i++; c.route.served = -Infinity; c.route.dwell = undefined; c.lane = c.road.lanes - 1 }
        c.next = nextOf(c, c.road)
      }
      // Past the junction it held by 8 m: it is free for the next.
      if (c.prev && c.s! > 80) { const h = holds.get(c.prev.b); if (h?.delete(c) && !h.size) holds.delete(c.prev.b) }
      const d = Math.hypot(c.x - view.eye[0], c.z - view.eye[2])
      // Gone where nobody sees: too far, at a road's end, or stuck a long while out of sight; also recycle mutual car-on-car deadlocks before 12 s (#129).
      const mutualDeadlock = c.stuck! > 9.5 && why === 'car' && !!leadCar && leadCar.v < 2 && !leadCar.queued && !leadCar.rtStuck && (leadCar.stuck ?? 0) > 8 && c.id > leadCar.id
      if (d > DRIVEN * 1.25 || (!c.next && c.s! >= c.road!.len - 12 && unseen(c.x, c.z, view)) || (c.stuck! > 10 && unseen(c.x, c.z, view)) || mutualDeadlock) { letGo(c); hide(c); traffic.splice(i, 1); continue }
      // Someone held a junction a long time without moving (a person stands in front of them): let it go.
      if (c.stuck! > 6) letGo(c)
      pose(c)
      // Corner-sweep & lateral-shift OBB guard (#155, #164): if advancing or shifting laterally deepens an OBB overlap
      // with an adjacent traffic vehicle, revert the step and yield instead of penetrating it.
      if (c.v > 0.1 || Math.abs(c.latVel ?? 0) > 0.1) {
        const pBox = { x: prevPose.x, z: prevPose.z, heading: prevPose.heading, halfL: c.model.long / 2, halfW: c.model.wide / 2 }
        const nBox = { x: c.x, z: c.z, heading: c.heading, halfL: c.model.long / 2, halfW: c.model.wide / 2 }
        let sweptHit: Car | null = null
        for (let j = 0; j < traffic.length; j++) {
          const oCar = traffic[j]
          if (oCar === c || Math.abs(oCar.y - c.y) > 25) continue
          if (stepDeepensOverlap(pBox, nBox, { x: oCar.x, z: oCar.z, heading: oCar.heading, halfL: oCar.model.long / 2, halfW: oCar.model.wide / 2 })) {
            sweptHit = oCar; break
          }
        }
        if (sweptHit) {
          c.x = prevPose.x; c.z = prevPose.z; c.y = prevPose.y
          c.heading = prevPose.heading; c.pitch = prevPose.pitch; c.roll = prevPose.roll
          c.s = prevPose.s; c.road = prevPose.road; c.prev = prevPose.prev; c.next = prevPose.next; c.lane = prevPose.lane
          c.laneShift = prevPose.laneShift; c.overtakeShift = prevPose.overtakeShift; c.sirenYieldShift = prevPose.sirenYieldShift; c.latVel = 0
          if (prevPose.route) c.route = prevPose.route
          c.v = 0; c.wait = 'car'; c.stuck = (c.stuck ?? 0) + dt
        }
      } else if (c.stuck! > 2.5) {
        // If two stopped vehicles are already overlapping (e.g. from a tight junction), clear the higher-id one before it lingers for 4+ s.
        const cfx = Math.cos(c.heading), cfz = Math.sin(c.heading)
        for (let j = 0; j < traffic.length; j++) {
          const oCar = traffic[j]
          if (oCar === c || oCar.v >= 2 || c.id <= oCar.id || Math.abs(oCar.x - c.x) > 150 || Math.abs(oCar.z - c.z) > 150 || Math.abs(oCar.y - c.y) > 25) continue
          const g = boxGap(c.x, c.z, cfx, cfz, c.model.long / 2, c.model.wide / 2, oCar.x, oCar.z, Math.cos(oCar.heading), Math.sin(oCar.heading), oCar.model.long / 2, oCar.model.wide / 2)
          if (g < -2) { letGo(c); hide(c); traffic.splice(i, 1); break }
        }
      }
    }
  }

  // ── Cable cars: a rule of the line and the clock ──
  // Every line leaves on a shared cycle-aligned period (CABLE_EVERY = 2 * CYCLE = 120 s) with phases coordinated across
  // all lines (`coordinateCablePhases`) so Powell–Hyde and Powell–Mason never drift into each other on shared tracks
  // and California St clears Powell St crossings. Each departure obeys red lights along the line (`lightsOf`). Because
  // CABLE_EVERY is a multiple of CYCLE, every car on a line hits lights at the same phase and stays a rule of the clock.
  const cables: Car[] = []
  let cableBases = new Map<Line, number>()
  const ensureCablePhases = () => {
    for (const ln of lines) freshLights(ln)
    if (cableBases.size === lines.length) return
    cableBases = coordinateCablePhases(lines, timetable)
  }
  /** A line's departures: shared cycle-aligned period, and its coordinated phase offset. */
  const departures = (l: Line) => { ensureCablePhases(); return { every: CABLE_EVERY, base: cableBases.get(l) ?? 0 } }
  /** Cells along the line each quarter second after leaving, for a car leaving at a second of the minute. */
  const timetables = new Map<Line, Map<number, Float32Array>>()
  const STEP = 0.25, CABLE_GATHER = 9, CABLE_BRAKE = 14
  const timetable = (l: Line, left: number): Float32Array => {
    let kept = timetables.get(l)
    if (!kept) timetables.set(l, kept = new Map())
    let tt = kept.get(left)
    if (tt) return tt
    const lights = cableLights ? lightsOf(l as (typeof tramLines)[number]) : [], out: number[] = []
    let s = 0, v = CABLE_SPEED, tau = 0, braking: (typeof lights)[number] | null = null
    while (s < l.len && out.length < 40000) {
      out.push(s)
      // The nearest light ahead that holds the car at its line (red, or amber where it can stop): every one within
      // reach, since two junctions may stand a few metres apart. Once it brakes for an amber it stops: asked again as
      // it slows, the step it goes in a quarter second would have it run the light.
      let stop = Infinity
      for (const L of lights) {
        const d = L.s - s
        if (d < 0) continue
        if (d > 400) break
        const light = lightFor(junctionOf(L.node), L.dx, L.dz, left + tau)
        if (light === 'red' || (light === 'amber' && (braking === L || d > (v * v) / (2 * CABLE_BRAKE)))) { stop = d; braking = L; break }
        if (braking === L) braking = null
      }
      // Gathers to the cable's speed, and brakes to stand at the line.
      const most = stop === Infinity ? CABLE_SPEED : Math.sqrt(2 * CABLE_BRAKE * Math.max(0, stop - 2))
      v = Math.min(CABLE_SPEED, most, v + CABLE_GATHER * STEP)
      s += v * STEP; tau += STEP
    }
    out.push(l.len)
    kept.set(left, tt = Float32Array.from(out))
    return tt
  }
  /**
   * A line's timetables are made again when its lights change: while squares come, a light may be found, or a
   * junction's main way (whose lights go green first) may change. Once every square near it is in, they are kept.
   */
  const lightsSeen = new WeakMap<Line, string>()
  const freshLights = (l: Line) => {
    if (!cableLights || lightsDone.has(l)) return
    const sig = lightsOf(l as (typeof tramLines)[number]).map((L) => { const j = junctionOf(L.node); return `${L.node}:${L.s}:${phaseOf(j, L.dx, L.dz)}:${j.offset}` }).join()
    if (lightsSeen.get(l) !== sig) { lightsSeen.set(l, sig); timetables.delete(l); cableBases.clear() }
  }
  /** Each car on a line at a moment: how far along it is and how fast it goes. */
  const cableAt = (l: Line, t: number, each: (s: number, v: number) => void) => {
    const { every, base } = departures(l), most = (2 * l.len) / CABLE_SPEED + 300
    for (let n = Math.ceil((t - most - base) / every); n <= Math.floor((t - base) / every); n++) {
      const t0 = base + n * every, tt = timetable(l, ((t0 % CYCLE) + CYCLE) % CYCLE), f = (t - t0) / STEP, i = Math.floor(f)
      if (i < 0 || i + 1 >= tt.length) continue
      each(tt[i] + (tt[i + 1] - tt[i]) * (f - i), (tt[i + 1] - tt[i]) / STEP)
    }
  }
  const cableCars = (t: number, view: View) => {
    const m = ready.get('cable-car')
    if (!m) return
    let n = 0
    for (const l of lines) {
      // (Not near the eye at all: its timetables are not made.)
      along(l.p, l.cum, l.len / 2, P)
      if (Math.hypot(P.x - view.eye[0], P.z - view.eye[2]) > l.len / 2 + DRAWN) continue
      cableAt(l, t, (s, v) => {
        along(l.p, l.cum, s, P)
        if (Math.hypot(P.x - view.eye[0], P.z - view.eye[2]) > DRAWN) return
        // Hard invariant: never emit two cable cars overlapping on a shared track or crossing.
        for (let k = 0; k < n; k++) {
          const prev = cables[k]
          if (Math.abs(P.x - prev.x) > 140 || Math.abs(P.z - prev.z) > 140) continue
          if (obbOverlap(P.x, P.z, P.tx, P.tz, m.long / 2, m.wide / 2, prev.x, prev.z, Math.cos(prev.heading), Math.sin(prev.heading), prev.model.long / 2, prev.model.wide / 2) < 1) return
        }
        const c = (cables[n] ??= { id: ids++, model: m, paint: -1, kind: 'cable', seed: n, x: 0, y: 0, z: 0, heading: 0, pitch: 0, v: 0, piece: null, shown: '' })
        c.x = P.x; c.z = P.z; c.heading = Math.atan2(P.tz, P.tx); c.v = v
        settle(c)
        n++
      })
    }
    for (let i = cables.length - 1; i >= n; i--) { hide(cables[i]); cables.pop() }
  }

  // ── Streetcars: driven along their routes, stopping at lights, behind cars and for whatever stands on the rails ──
  const trams: Car[] = []
  const TRAM_APART = 8000, TRAM_SPEED = 100
  /** The lights a line passes: junctions with lights within 10 m of it, where along it, and which way it goes there. */
  const lightsDone = new WeakSet<Line>()
  const lightsOf = (l: (typeof tramLines)[number]) => {
    if (lightsDone.has(l)) return l.lights
    l.lights.length = 0
    const seen = new Set<number>()
    for (let s = 0; s < l.len; s += 40) {
      along(l.p, l.cum, s, P)
      for (const r of roadGrid.get(cell(Math.floor(P.x / GRID), Math.floor(P.z / GRID))) ?? []) {
        if (r.ctl < 2 || seen.has(r.b)) continue
        const j = junctionOf(r.b)
        // (Two junctions within 15 m along the line, as a divided street's two, are one light: the first's.)
        if (Math.hypot(j.x - P.x, j.z - P.z) < 100) { seen.add(r.b); if (!l.lights.some((L) => Math.abs(L.s - Math.max(0, s - 60)) < 150)) l.lights.push({ s: Math.max(0, s - 60), node: r.b, dx: P.tx, dz: P.tz }) }
      }
    }
    l.lights.sort((a, b) => a.s - b.s)
    // (Kept once every square near it is in: a junction on a seam is whole only then.)
    if (squares.size && [...squares.values()].every((v) => v === 'held')) lightsDone.add(l)
    return l.lights
  }
  /**
   * How far a streetcar may go along its rails before its body would be in a vehicle's (cells; Infinity if it never
   * is within 40 m): the streetcar as it will stand every 2.4 m of the way, a cell wider each side, against the
   * vehicle's outline. Its path is its rails, not the line straight ahead of its middle, and they turn across the
   * lanes of the traffic: so whatever drives or lives is looked for along them whichever way it heads. (Left out
   * for coming the other way, as cars leave each other out, cars were driven through: of eight found in a streetcar
   * in twelve fillings of the street, 0.5 to 3.5 m deep, three headed the other way to it; the other five were in
   * one that stood, from the first frames after the street was filled. test/crash-stack.mjs.) One already in it that
   * it would leave by going on is not waited for.
   */
  const RAIL_STEP = 24, RAIL_AHEAD = 400
  const rail: { x: number; z: number; tx: number; tz: number }[] = []
  /** Where a streetcar will stand along its rails from here, every `RAIL_STEP`: made once for it, for every vehicle near (`railGap`). */
  const railAhead = (c: Car) => {
    const l = c.track!
    let n = 0
    for (let d = 0; d <= RAIL_AHEAD && c.s! + d <= l.len; d += RAIL_STEP, n++) { along(l.p, l.cum, c.s! + d, Q); (rail[n] ??= { x: 0, z: 0, tx: 1, tz: 0 }); rail[n].x = Q.x; rail[n].z = Q.z; rail[n].tx = Q.tx; rail[n].tz = Q.tz }
    return n
  }
  const railGap = (c: Car, n: number, ob: (typeof obstacles)[number]) => {
    const halfL = c.model.long / 2, halfW = c.model.wide / 2 + 1
    if (Math.hypot(ob.x - c.x, ob.z - c.z) > RAIL_AHEAD + halfL + ob.long + ob.wide) return Infinity
    const within = (k: number) => obbOverlap(rail[k].x, rail[k].z, rail[k].tx, rail[k].tz, halfL, halfW, ob.x, ob.z, ob.hx, ob.hz, ob.long, ob.wide) < 0
    const inNow = n > 0 && within(0)
    for (let k = 1; k < n; k++) {
      if (!within(k)) continue
      // In it already and behind its middle: going on leaves it.
      if (k === 1 && inNow && (ob.x - c.x) * rail[0].tx + (ob.z - c.z) * rail[0].tz < 0) return Infinity
      return (k - 1) * RAIL_STEP
    }
    return Infinity
  }
  const tramsDrive = (dt: number, view: View, t: number, any: boolean) => {
    const m = ready.get('streetcar') ?? ready.get('cable-car')
    if (!m) return
    const eye = view.eye
    // As many on each line near the eye as its length holds, set down out of sight once the street is filled.
    for (const l of tramLines) {
      along(l.p, l.cum, l.len / 2, P)
      if (Math.hypot(P.x - eye[0], P.z - eye[2]) > l.len / 2 + DRIVEN) continue
      const want = Math.max(1, Math.round(l.len / TRAM_APART)), have = trams.filter((c) => c.track === l).length
      for (let k = have, tries = 0; k < want && tries < 8; tries++) {
        const s = random() * l.len
        along(l.p, l.cum, s, P)
        if (Math.hypot(P.x - eye[0], P.z - eye[2]) > DRIVEN || (!any && !unseen(P.x, P.z, view)) || trams.some((c) => c.track === l && Math.abs(c.s! - s) < 400)) continue
        if (taken(P.x, P.z, P.tx, P.tz, m.long / 2 + 60, m.wide / 2, 3)) continue
        const c: Car = { id: ids++, model: m, paint: -1, kind: 'tram', seed: ids, x: P.x, y: 0, z: P.z, heading: Math.atan2(P.tz, P.tx), pitch: 0, v: TRAM_SPEED * 0.6, piece: null, shown: '', track: l, s, stuck: 0 }
        settle(c); trams.push(c); k++
      }
    }
    for (let i = trams.length - 1; i >= 0; i--) {
      const c = trams[i], l = c.track!, hx = Math.cos(c.heading), hz = Math.sin(c.heading)
      let gap = Infinity, lead = 0, held = false
      const poses = railAhead(c)
      for (const ob of obstacles) {
        if (ob.car === c) continue
        const dx = ob.x - c.x, dz = ob.z - c.z
        if (Math.abs(dx) > 500 || Math.abs(dz) > 500) continue
        // What drives or lives is looked for along the rails (`railGap`), whichever way it heads: where the rails turn
        // across the traffic, what comes the other way is in the streetcar's path. What stands (a parked car, a
        // person, a hole) straight ahead, as it was.
        if (ob.car || ob.alive) { const g = railGap(c, poses, ob); if (g < gap) { gap = g; lead = Math.max(0, ob.v * (ob.hx * hx + ob.hz * hz)) } continue }
        if (ob.long > 3 && ob.hx * hx + ob.hz * hz < -0.3) continue
        const ahead = dx * hx + dz * hz, across = Math.abs(dx * hz - dz * hx)
        if (ahead <= 0 || ahead > 500 || across > c.model.wide / 2 + ob.wide + 2) continue
        const g = ahead - c.model.long / 2 - ob.long
        if (g < gap) { gap = g; lead = ob.v * (ob.hx * hx + ob.hz * hz) }
      }
      for (const L of lightsOf(l)) {
        const left = L.s - c.s!
        if (left < 0 || left > 250) continue
        const light = lightFor(junctionOf(L.node), L.dx, L.dz, t)
        // (Every light within reach: two junctions may stand a few metres apart.)
        if (light === 'red' || (light === 'amber' && left > (c.v * c.v) / (2 * BRAKE * 0.6))) { if (left < gap) { gap = left; lead = 0 } held = true; break }
      }
      if (l.len - c.s! < 300 && l.len - c.s! < gap) { gap = l.len - c.s!; lead = 0 }
      const want = 30 + c.v * 1.5 + (c.v * (c.v - lead)) / (2 * Math.sqrt(GATHER * BRAKE))
      const acc = GATHER * 0.6 * (1 - (c.v / TRAM_SPEED) ** 4 - (gap < Infinity ? (Math.max(0, want) / Math.max(1, gap)) ** 2 : 0))
      c.v = Math.max(0, Math.min(TRAM_SPEED, c.v + Math.max(-BRAKE * 2, acc) * dt))
      if (gap < 5) c.v = Math.min(c.v, Math.max(0, gap) * 2)
      c.s! += c.v * dt
      c.held = held && c.v < 2 ? (c.held ?? 0) + dt : 0
      c.stuck = c.v < 2 && !held ? c.stuck! + dt : 0
      along(l.p, l.cum, c.s!, P)
      c.x = P.x; c.z = P.z; c.heading = Math.atan2(P.tz, P.tx)
      settle(c)
      // At its line's end (a terminus, or where the squares here end) or far off, out of sight, it is taken off.
      if (Math.hypot(c.x - eye[0], c.z - eye[2]) > DRIVEN * 1.3 || (c.s! >= l.len - 40 && unseen(c.x, c.z, view)) || (c.stuck! > 60 && unseen(c.x, c.z, view))) { hide(c); trams.splice(i, 1) }
    }
  }

  /** The line-up's vehicles (`lineup`). */
  const showcase: Car[] = []

  // ── Holes in the road ──
  /** Where blasts broke the road (cells): a hole, or rubble on it. Asked of the world itself (world_kind), not the blast. */
  const craters: { x: number; z: number; r: number }[] = []
  const looks: { at: readonly [number, number, number]; radius: number; when: number }[] = []
  const probe = () => {
    const now = performance.now() / 1000
    for (let n = looks.length - 1; n >= 0; n--) {
      const s = looks[n]
      if (now < s.when) continue
      looks.splice(n, 1)
      const reach = s.radius * 1.5 + 30
      const seen = new Set<Road>()
      for (let gx = Math.floor((s.at[0] - reach) / GRID); gx <= Math.floor((s.at[0] + reach) / GRID); gx++) for (let gz = Math.floor((s.at[2] - reach) / GRID); gz <= Math.floor((s.at[2] + reach) / GRID); gz++) for (const r of roadGrid.get(cell(gx, gz)) ?? []) seen.add(r)
      let bad = 0, sx = 0, sz = 0
      for (const r of seen) {
        let broken = false
        for (let lane = 0; lane < r.lanes; lane++) for (let d = 0; d <= r.len; d += 8) {
          lanePoint(r, lane, d, P)
          if (Math.hypot(P.x - s.at[0], P.z - s.at[2]) > reach) continue
          const x = Math.round(P.x), z = Math.round(P.z), f = o.land.feet_at(x, z)
          // The road's own top gone (and what was under it), or something fallen on it a car cannot go over.
          const hole = !o.land.world_kind(x, f - 1, z) && (!o.land.world_kind(x, f - 2, z) || !o.land.world_kind(x, f - 3, z))
          const heap = o.land.world_kind(x, f + 4, z) !== 0 && o.land.world_kind(x, f + 7, z) !== 0
          if (hole || heap) { broken = true; bad++; sx += P.x; sz += P.z }
        }
        if (broken) r.blocked = true
      }
      if (bad) craters.push({ x: sx / bad, z: sz / bad, r: s.radius + 10 })
      // Parked cars there settle on what is left under them.
      for (const c of parked.values()) if (!c.thing && Math.hypot(c.x - s.at[0], c.z - s.at[2]) < reach + c.model.long) settle(c, true)
    }
  }

  // ── Blasts ──
  /** How many of the shocks this has answered. A blast throws the few cars nearest it (they come to life, pushed away from it) and stops the traffic round it a while. */
  let heard = o.shocks.length, cutsHeard = o.cuts?.length ?? 0
  const shaken = (view: View) => {
    // The cutter's cuts: the road there is looked at once the world has been changed, as a blast's is.
    if (o.cuts) { if (o.cuts.length < cutsHeard) cutsHeard = 0; for (; cutsHeard < o.cuts.length; cutsHeard++) looks.push({ at: o.cuts[cutsHeard].at, radius: o.cuts[cutsHeard].radius, when: performance.now() / 1000 + 1 }) }
    if (o.shocks.length < heard) heard = 0
    for (; heard < o.shocks.length; heard++) {
      const s = o.shocks[heard], reach = s.radius * 3 + 40, now = performance.now() / 1000
      // Whatever stands in the blast itself goes, whatever it is (a bus is too big to throw: it is taken off, broken);
      // of the rest, the three nearest that can be are thrown.
      const inside = (c: Car) => Math.hypot(c.x - s.at[0], c.z - s.at[2]) < s.radius + c.model.long / 2 && Math.abs(c.y - s.at[1]) < s.radius + 20
      for (const c of [...traffic, ...parked.values()]) if (!c.thing && !c.model.motor && inside(c)) { hide(c); if (c.kind === 'traffic') { traffic.splice(traffic.indexOf(c), 1); letGo(c) } if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot) } }
      const candidates = [...parked.values(), ...traffic].filter((c) => !c.thing && !!c.model.motor && Math.hypot(c.x - s.at[0], c.z - s.at[2]) < reach && Math.abs(c.y - s.at[1]) < reach).sort((a, b) => Math.hypot(a.x - s.at[0], a.z - s.at[2]) - Math.hypot(b.x - s.at[0], b.z - s.at[2]))
      const near = candidates.filter((c, i) => i < 3 || inside(c))
      for (const c of near) {
        const dx = c.x - s.at[0], dz = c.z - s.at[2], d = Math.hypot(dx, dz) || 1, k = 1 - d / reach
        if (c.kind === 'traffic') { traffic.splice(traffic.indexOf(c), 1); letGo(c); c.kind = 'parked' }
        if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot); c.slot = undefined }
        pending.set(c, { inside: false, push: [(dx / d) * 160 * k, 60 + 80 * k, (dz / d) * 160 * k] })
      }
      for (const c of traffic) if (Math.hypot(c.x - s.at[0], c.z - s.at[2]) < 800) c.shaken = simTime
      looks.push({ at: s.at, radius: s.radius, when: now + 1.5 })
      // Where it broke the road is known once the world has been changed: looked at in a moment.
    }
    void view
  }

  // ── Taking a car that stops beside someone (including robotaxis parked/charging at a depot!) ──
  // On desktop with the play HUD active (#75), KeyE opens the radial tool wheel (or cycles tools): stopped live traffic
  // cars bind KeyF ("F  Take the …") so nearby traffic never steals E from the tool wheel, while charging depot
  // robotaxis and woken parked cars (living.ts) keep KeyE.
  const coarse = matchMedia('(pointer: coarse)')
  let cue: { car: Car; key: string; remove(): void } | null = null, beside: (() => void) | null = null
  const dropCue = () => { cue?.remove(); cue = null; beside?.(); beside = null }
  const offer = (feet: readonly number[] | null) => {
    const wheelOpen = document.documentElement.classList.contains('choosing')
    let best: Car | null = null, bestDepot = false, far = 45
    if (on && feet && !o.alive.riding && !o.alive.near && !wheelOpen) {
      for (const c of depotCars) {
        if (!c.model.motor || Math.abs(c.y - feet[1]) > 25) continue
        const d = Math.hypot(c.x - feet[0], c.z - feet[2]) - c.model.long / 2
        if (c.v < 25 && d < Math.min(far, 35)) { far = d; best = c; bestDepot = true }
      }
      for (const c of traffic) {
        if (!c.model.motor || Math.abs(c.y - feet[1]) > 25) continue
        const d = Math.hypot(c.x - feet[0], c.z - feet[2]) - c.model.long / 2
        if (c.v < 25 && d < Math.min(far, 28)) { far = d; best = c; bestDepot = false }
      }
    }
    const useF = !bestDepot && !!document.documentElement.dataset.hud && !coarse.matches
    const key = useF ? 'KeyF' : 'KeyE'
    if (cue && (cue.car !== best || cue.key !== key)) dropCue()
    if (!best || cue) return
    const car = best
    const takeIt = () => {
      const ti = traffic.indexOf(car), di = depotCars.indexOf(car)
      if (ti < 0 && di < 0) return
      if (ti >= 0) traffic.splice(ti, 1)
      if (di >= 0) depotCars.splice(di, 1)
      letGo(car)
      car.depot = undefined
      car.rtStuck = undefined
      car.kind = 'parked'
      pending.set(car, { inside: true, then: (thing) => o.alive.mount(thing) })
      dropCue()
    }
    const label = coarse.matches ? `Take the ${carName(car.model, car.paint)}` : `${useF ? 'F' : 'E'}  Take the ${carName(car.model, car.paint)}`
    cue = { car, key, remove: o.hud.cue(label, () => [car.x, car.y + car.model.size[1] + 4, car.z], takeIt).remove }
    beside = o.input.push({ name: 'take', key: (code) => { if (code !== key) return false; takeIt(); return true } })
  }

  // ── Reactive driving: crash waking on impact, horn reactions, and high-speed near-miss detection ──
  const MAX_CRASH_LIVING = 6
  const CRASH_SCAN = 120 // 12 m proximity radius (cells)
  const HORN_CAR_REACH = 260 // 26 m traffic reaction radius (cells)
  const NEAR_MISS_MIN_KMH = 65
  const NEAR_MISS_MAX_GAP = 20 // 2.0 m clearance on any axis (cells)
  const NEAR_MISS_COOL = 3.0 // seconds per car
  const ROLLS = 60 // a thrown car closing on a drawn one slower than this (cells a second: 22 km/h) is stopped by it, and wakes nothing
  let nearMissCb = o.onNearMiss
  let prevRideId = 0, prevRideAt: [number, number, number] | null = null, rideDt = 0
  const rideVel: [number, number, number] = [0, 0, 0]
  let hornWas = false, lastHornPulse = -99, lastTrafficHorn = -99
  const nearMissAt = new Map<number, number>()
  const hornQueue: { at: [number, number, number]; pitch: number; annoyed: boolean; when: number }[] = []
  let crashCountStat = 0, nearMissCountStat = 0, hornResponsesStat = 0
  /** Of the cars a crash woke: how many were sent away to make room, and how many broke or were lost (for the checks). */
  let sentAwayStat = 0, brokeStat = 0
  const OBB = { gap: 0, nx: 1, nz: 0 }
  const testAxis = (dx: number, dz: number, ux: number, uz: number, afx: number, afz: number, arx: number, arz: number, ahl: number, ahw: number, bfx: number, bfz: number, brx: number, brz: number, bhl: number, bhw: number) => {
    const d = dx * ux + dz * uz
    const pA = ahl * Math.abs(afx * ux + afz * uz) + ahw * Math.abs(arx * ux + arz * uz)
    const pB = bhl * Math.abs(bfx * ux + bfz * uz) + bhw * Math.abs(brx * ux + brz * uz)
    const g = Math.abs(d) - (pA + pB)
    if (g > OBB.gap) { const s = d >= 0 ? 1 : -1; OBB.gap = g; OBB.nx = ux * s; OBB.nz = uz * s }
  }
  const obbOverlap = (ax: number, az: number, afx: number, afz: number, ahl: number, ahw: number, bx: number, bz: number, bfx: number, bfz: number, bhl: number, bhw: number) => {
    const arx = -afz, arz = afx, brx = -bfz, brz = bfx, dx = bx - ax, dz = bz - az
    OBB.gap = -Infinity; OBB.nx = 1; OBB.nz = 0
    testAxis(dx, dz, afx, afz, afx, afz, arx, arz, ahl, ahw, bfx, bfz, brx, brz, bhl, bhw)
    testAxis(dx, dz, arx, arz, afx, afz, arx, arz, ahl, ahw, bfx, bfz, brx, brz, bhl, bhw)
    testAxis(dx, dz, bfx, bfz, afx, afz, arx, arz, ahl, ahw, bfx, bfz, brx, brz, bhl, bhw)
    testAxis(dx, dz, brx, brz, afx, afz, arx, arz, ahl, ahw, bfx, bfz, brx, brz, bhl, bhw)
    return OBB.gap
  }
  const activeCrashLiving = () => {
    let n = 0
    for (const c of living) if (c.crashed !== undefined) n++
    for (const c of pending.keys()) if (c.crashed !== undefined) n++
    return n
  }
  /**
   * Room for one more car woken by a crash (`MAX_CRASH_LIVING` live at once): one goes back to nothing, but for
   * `spare` (the one that is striking). One that has come to rest before any still thrown, and of those the one
   * furthest from a place and longest awake. False if none can go.
   */
  const makeCrashRoom = (rx: number, rz: number, riding: Thing | null, spare: Thing | null, now: number) => {
    while (activeCrashLiving() >= MAX_CRASH_LIVING) {
      let victim: Car | null = null, worst = -Infinity
      for (const c of living) {
        if (c.crashed === undefined || !c.thing || c.thing === riding || c.thing === spare) continue
        const w = o.alive.where(c.thing)
        const d = w ? Math.hypot(w.at[0] - rx, w.at[2] - rz) : 9999
        const still = !c.going || Number.isNaN(c.going.x) ? 0 : Math.hypot(c.going.vx, c.going.vz) < 5 ? 1000 : 0
        const score = still + d * 0.05 + (now - c.crashed)
        if (score > worst) { worst = score; victim = c }
      }
      if (victim) { sleep(victim); sentAwayStat++; continue }
      let pendVictim: Car | null = null, oldest = Infinity
      for (const c of pending.keys()) if (c.crashed !== undefined && c.crashed < oldest) { oldest = c.crashed; pendVictim = c }
      if (pendVictim) { pending.delete(pendVictim); hide(pendVictim); sentAwayStat++; continue }
      return false
    }
    return true
  }
  /**
   * Whatever may strike a drawn car: the vehicle ridden, every car a crash or a blast threw (the solver moves those),
   * and every car struck and still on its way to life, which will leave where it is drawn with its push. A thrown
   * car went through the drawn cars round it and came to rest in one, and the next struck came to life inside it:
   * so each is looked at as the ridden one is, and what it reaches comes to life before it is in it.
   */
  interface Mover { thing: Thing | null; car: Car | null; how: Waking | null; ridden: boolean; x: number; y: number; z: number; fx: number; fz: number; halfL: number; halfW: number; vx: number; vz: number; mass: number }
  const movers: Mover[] = []
  /**
   * How fast a thrown car goes over the ground, from where it was last seen (the solver answers some frames and not
   * others). One just come to life goes as it was pushed until it has been seen twice where the solver put it: that
   * is not where it was drawn (the solver moves it clear, `wake`), and taken for a move, those two or three metres
   * in a frame were 2,000 cells a second. Nor is any move a car cannot make taken for its speed.
   */
  const followed = (c: Car, x: number, z: number, dt: number) => {
    const g = (c.going ??= { x, z, vx: 0, vz: 0, dt: 0 })
    if (Number.isNaN(g.x)) { g.x = x; g.z = z; g.dt = 0; return g }
    g.dt += dt
    const mx = x - g.x, mz = z - g.z
    if (Math.hypot(mx, mz) > 1e-3 && g.dt > 1e-4) { if (Math.hypot(mx, mz) / g.dt < 900) { g.vx = mx / g.dt; g.vz = mz / g.dt } g.x = x; g.z = z; g.dt = 0 }
    else if (g.dt > 0.08) { g.vx = 0; g.vz = 0 }
    return g
  }
  /**
   * How near a mover's outline is to a drawn car's now (cells; `OBB` then says which way the car is from it), and
   * whether it touches it now or will within `ahead` seconds as the two are going: looked for every ten cells of the
   * way, since a car at 200 km/h covers nine in a frame.
   */
  const TOUCH = { gap: 0, touches: false, nx: 1, nz: 0 }
  const reaches = (m: Mover, c: Car, cfx: number, cfz: number, cHalfL: number, cHalfW: number, ahead: number) => {
    TOUCH.gap = obbOverlap(m.x, m.z, m.fx, m.fz, m.halfL, m.halfW, c.x, c.z, cfx, cfz, cHalfL, cHalfW)
    TOUCH.touches = TOUCH.gap <= 1.0
    TOUCH.nx = OBB.nx; TOUCH.nz = OBB.nz
    if (TOUCH.touches) return
    const vx = m.vx - cfx * c.v, vz = m.vz - cfz * c.v, far = Math.hypot(vx, vz) * ahead
    // (Only what closes on it: the way it is from the mover, and the mover's way.)
    if (far <= 1 || vx * OBB.nx + vz * OBB.nz <= 0) return
    const steps = Math.min(8, Math.ceil(far / 10))
    for (let k = 1; k <= steps; k++) {
      const t = (ahead * k) / steps
      if (obbOverlap(m.x + vx * t, m.z + vz * t, m.fx, m.fz, m.halfL, m.halfW, c.x, c.z, cfx, cfz, cHalfL, cHalfW) <= 1.0) { TOUCH.touches = true; TOUCH.nx = OBB.nx; TOUCH.nz = OBB.nz; return }
    }
  }
  /** A push on a mover: on the solver's body, or on the push a car on its way to life will be given. */
  const shove = (m: Mover, x: number, y: number, z: number) => {
    if (m.thing) o.alive.kick(m.thing, [x, y, z])
    else if (m.how?.push) { m.how.push[0] += x; m.how.push[2] += z }
    m.vx += x; m.vz += z
    // (Until the solver's answers show it: its next touch this frame or the next is reckoned from what it has left.)
    if (m.car?.going) { m.car.going.vx = m.vx; m.car.going.vz = m.vz }
  }
  const reactiveDrive = (dt: number) => {
    const now = performance.now() / 1000
    // Drain scheduled traffic horn responses even right after horn release.
    for (let i = hornQueue.length - 1; i >= 0; i--) {
      if (now < hornQueue[i].when) continue
      const h = hornQueue.splice(i, 1)[0]
      hornResponsesStat++
      o.onHorn?.({ at: h.at, pitch: h.pitch, annoyed: h.annoyed })
    }
    movers.length = 0
    const riding = o.alive.riding, rw = riding && o.alive.where(riding)
    if (!riding && prevRideId) { prevRideId = 0; prevRideAt = null; rideDt = 0; rideVel[0] = 0; rideVel[1] = 0; rideVel[2] = 0; hornWas = false }
    let speedKmh = 0, vDirX = 1, vDirZ = 0
    if (riding && rw) {
      const rx = rw.at[0], ry = rw.at[1], rz = rw.at[2]
      const rfx = rw.front[0], rfz = rw.front[2]
      // Track driven vehicle velocity smoothly across 60/120 Hz frames and async solver ticks.
      if (riding.id !== prevRideId || !prevRideAt) {
        prevRideId = riding.id; prevRideAt = [rx, ry, rz]; rideDt = 0
        const sp = riding.state?.speed ?? 0
        rideVel[0] = rfx * sp; rideVel[1] = 0; rideVel[2] = rfz * sp
      } else {
        rideDt += dt
        const mx = rx - prevRideAt[0], my = ry - prevRideAt[1], mz = rz - prevRideAt[2], moved = Math.hypot(mx, my, mz)
        if (moved > 1e-3 && rideDt > 1e-4) {
          if (moved / rideDt < 2500) {
            const k = Math.min(1, rideDt * 18)
            rideVel[0] += (mx / rideDt - rideVel[0]) * k
            rideVel[1] += (my / rideDt - rideVel[1]) * k
            rideVel[2] += (mz / rideDt - rideVel[2]) * k
          }
          prevRideAt[0] = rx; prevRideAt[1] = ry; prevRideAt[2] = rz; rideDt = 0
        } else if (rideDt > 0.08) {
          const decay = Math.exp(-dt * 12)
          rideVel[0] *= decay; rideVel[1] *= decay; rideVel[2] *= decay
        }
      }
      let rvx = rideVel[0], rvz = rideVel[2]
      const stateSp = riding.state?.speed ?? 0
      if (Math.hypot(rvx, rvz) < 5 && Math.abs(stateSp) > 5) { rvx = rfx * stateSp; rvz = rfz * stateSp }
      const speedCells = Math.max(Math.hypot(rvx, rvz), Math.abs(stateSp))
      speedKmh = Math.max(speedCells * 0.36, o.alive.telemetry?.kmh ?? 0)
      const vLen = Math.hypot(rvx, rvz)
      vDirX = vLen > 8 ? rvx / vLen : rfx; vDirZ = vLen > 8 ? rvz / vLen : rfz
      const isDrive = (riding.controls ?? 'drive') === 'drive'
      movers.push({ thing: riding, car: null, how: null, ridden: true, x: rx, y: ry - riding.size[1] * 0.5, z: rz, fx: rfx, fz: rfz, halfL: (riding.motor.front < 2 ? riding.size[0] : riding.size[2]) * 0.5, halfW: (riding.motor.front < 2 ? riding.size[2] : riding.size[0]) * 0.5, vx: rvx, vz: rvz, mass: Math.max(1, riding.size[0] * riding.size[1] * riding.size[2]) })

      // 1. Horn reactions (H): scatter/startle nearby pedestrians & nudge/elicit horn from traffic ahead.
      if (isDrive) {
        const honking = o.input.held('KeyH')
        if (honking && (!hornWas || now - lastHornPulse >= 1.15)) {
          lastHornPulse = now
          hornPulse = { x: rx, y: ry - riding.size[1] * 0.5, z: rz, fx: rfx, fz: rfz, t: now }
          let responder: Car | null = null, bestScore = Infinity
          for (const c of traffic) {
            if (c.thing || c.waking) continue
            const dx = c.x - rx, dz = c.z - rz
            if (Math.abs(dx) > HORN_CAR_REACH || Math.abs(dz) > HORN_CAR_REACH) continue
            const d = Math.hypot(dx, dz)
            if (d > HORN_CAR_REACH || Math.abs(c.y - (ry - riding.size[1] * 0.5)) > 35) continue
            const ahead = dx * rfx + dz * rfz, across = Math.abs(dx * (-rfz) + dz * rfx)
            // Nudge stopped or slow traffic ahead to gently pull forward / clear shake.
            if (ahead > -10 && ahead < 240 && across < 50 && c.v < 22) c.honked = now
            // Candidate for a rate-limited friendly/annoyed horn response within ~18 m.
            if (d < 185 && now - (c.honkedBack ?? -99) > 4.0) {
              const score = d - (c.v < 12 ? 35 : 0) - (ahead > 0 && across < 45 ? 25 : 0)
              if (score < bestScore) { bestScore = score; responder = c }
            }
          }
          if (responder && now - lastTrafficHorn >= 1.6) {
            lastTrafficHorn = now
            responder.honkedBack = now
            const heavy = responder.model.kind === 'bus' || responder.model.kind === 'trolley' || responder.model.kind === 'truck'
            const pitch = heavy ? 235 + chance(responder.seed, 41) * 65 : 345 + chance(responder.seed, 41) * 145
            const annoyed = responder.v < 12 || (responder.held ?? 0) > 2
            hornQueue.push({ at: [responder.x, responder.y + 8, responder.z], pitch, annoyed, when: now + 0.22 + chance(responder.seed, 42) * 0.26 })
          }
        }
        hornWas = honking
      }

    }
    // Thrown cars the solver moves, and struck cars about to be: each goes on as the ridden one does.
    for (const c of living) {
      if (!c.thing || c.thing === riding || !c.thrown) continue
      const w = o.alive.where(c.thing)
      if (!w) continue
      // (Born in the sky and put down a message later: until the solver's answers show it on the road, it is not looked at.)
      if (w.at[1] - c.y > SKY / 2) continue
      const g = followed(c, w.at[0], w.at[2], dt)
      if (Math.hypot(g.vx, g.vz) < 3) continue
      movers.push({ thing: c.thing, car: c, how: null, ridden: false, x: w.at[0], y: w.at[1] - c.model.size[1] * 0.5, z: w.at[2], fx: w.front[0], fz: w.front[2], halfL: c.model.long * 0.5, halfW: c.model.wide * 0.5, vx: g.vx, vz: g.vz, mass: Math.max(1, c.model.size[0] * c.model.size[1] * c.model.size[2]) })
    }
    for (const [c, how] of pending) {
      if (!how.push || Math.hypot(how.push[0], how.push[2]) < 3) continue
      movers.push({ thing: null, car: null, how, ridden: false, x: c.x, y: c.y, z: c.z, fx: Math.cos(c.heading), fz: Math.sin(c.heading), halfL: c.model.long * 0.5, halfW: c.model.wide * 0.5, vx: how.push[0], vz: how.push[2], mass: Math.max(1, c.model.size[0] * c.model.size[1] * c.model.size[2]) })
    }
    if (!movers.length) return

    // 2. What each reaches (within 12 m and the way it goes while a car wakes): crash waking, and the ridden one's near misses.
    const nearMissEligible = speedKmh > NEAR_MISS_MIN_KMH
    const tryNearMiss = (m: Mover, id: number, cx: number, cy: number, cz: number, cfx: number, cfz: number, cHalfL: number, cHalfW: number, gap: number) => {
      if (!nearMissEligible || gap <= 1.0 || gap > NEAR_MISS_MAX_GAP) return
      if (now - (nearMissAt.get(id) ?? -99) < NEAR_MISS_COOL) return
      const dx = cx - m.x, dz = cz - m.z
      const alongDist = dx * vDirX + dz * vDirZ
      const cAlongHalf = cHalfL * Math.abs(cfx * vDirX + cfz * vDirZ) + cHalfW * Math.abs(-cfz * vDirX + cfx * vDirZ)
      // Fire right as the player passes alongside/past the car (never ahead of a head-on collision).
      if (alongDist > m.halfL + cAlongHalf * 0.45 || alongDist < -(m.halfL + cAlongHalf + 10)) return
      nearMissAt.set(id, now)
      if (nearMissAt.size > 128) for (const [k, atT] of nearMissAt) if (now - atT > 10) nearMissAt.delete(k)
      nearMissCountStat++
      const top = m.y + (m.thing?.size[1] ?? 0) * 0.5
      nearMissCb?.({ speedKmh: Math.round(speedKmh * 10) / 10, clearance: Math.round((gap / 10) * 100) / 100, at: [(m.x + cx) * 0.5, Math.max(top, cy + 8), (m.z + cz) * 0.5] })
    }
    const checkCar = (m: Mover, c: Car) => {
      if (c.thing || c.waking || pending.has(c)) return
      const speed = Math.hypot(m.vx, m.vz), scan = CRASH_SCAN + speed * wakeLag
      const dx = c.x - m.x, dz = c.z - m.z
      if (Math.abs(dx) > scan || Math.abs(dz) > scan) return
      if (Math.abs(c.y - m.y) > 35) return
      const dist = Math.hypot(dx, dz)
      if (dist > scan) return
      // Pre-warm only the finest exterior look before impact so crash waking is instant without decoding 3.6M-cell interiors.
      if (c.model.motor && dist < scan - 10) {
        const ext = lods(c.model)
        if (ext.length) bornOf(c.model, c.paint, ext[ext.length - 1].i)
      }
      const cfx = Math.cos(c.heading), cfz = Math.sin(c.heading)
      const cHalfL = c.model.long * 0.5, cHalfW = c.model.wide * 0.5
      // A car that wakes is looked for as far ahead as waking takes, when what comes is fast: it then lives, and is
      // pushed, as it is reached. Slowly (under 6 m/s, and by degrees up to 18) it is looked for a frame ahead only: a
      // car nudged at walking pace would leap away half a metre before it was touched, and a slow one a few cells
      // into its place is put clear by the solver. One that only throws the mover back, a frame ahead.
      const frame = dt * 1.5, far = wakeLag * Math.max(0, Math.min(1, (speed - 60) / 120))
      reaches(m, c, cfx, cfz, cHalfL, cHalfW, c.model.motor ? (m.thing ? Math.max(frame, far) : far || wakeLag) : m.thing ? frame : 0)
      const gap = TOUCH.gap
      if (!TOUCH.touches) { if (m.ridden && now - (c.hitAt ?? -99) > 3.0) tryNearMiss(m, c.id, c.x, c.y, c.z, cfx, cfz, cHalfL, cHalfW, gap); return }
      const nx = TOUCH.nx, nz = TOUCH.nz
      const cvx = cfx * c.v, cvz = cfz * c.v
      const relVx = m.vx - cvx, relVz = m.vz - cvz
      const relSpeed = Math.hypot(relVx, relVz)
      const closing = relVx * nx + relVz * nz
      const cMass = Math.max(1, c.model.size[0] * c.model.size[1] * c.model.size[2])
      const top = m.y + (m.thing?.size[1] ?? c.model.size[1]) * 0.5
      const hitAt: [number, number, number] = [(m.x + c.x) * 0.5, Math.max(top, c.y + c.model.size[1] * 0.4), (m.z + c.z) * 0.5]
      const force = Math.min(1, Math.max(0.18, relSpeed / 150))
      const hitSpeed = Math.max(closing, relSpeed * 0.6)
      // A thrown car that rolls against a drawn one slowly (under `ROLLS`) is stopped by it and wakes nothing: the
      // blow that woke a row would otherwise run on down it, a car a link, long after it was spent (13 woke in one
      // pileup, with room for six). Unless it is pressed 2 cells into it already, by the pile behind: then nothing
      // but waking it keeps them apart.
      if (c.model.motor && !m.ridden && closing < ROLLS && TOUCH.gap > -2) {
        if (closing > 0 && now - (c.hitAt ?? -99) > 0.1) { c.hitAt = now; shove(m, -nx * closing, 0, -nz * closing) }
        return
      }
      // Whatever has a motor wakes, whoever reaches it: the ridden car, a thrown one, one about to be. A drawn car
      // cannot be made solid by pushes: thrown back off one for want of room, a car pressed on by the pile behind it
      // went into it all the same, and stayed (0.66 s and 5.6 s, 2 m deep, in two runs of test/crash-stack.mjs). Room is
      // made by sending away a car that has come to rest, the furthest and oldest, before any still thrown.
      if (c.model.motor) {
        const by = movers[0].ridden ? movers[0] : m
        makeCrashRoom(by.x, by.z, riding, m.thing, now)
        if (c.kind === 'traffic') { const idx = traffic.indexOf(c); if (idx >= 0) traffic.splice(idx, 1); letGo(c); c.kind = 'parked' }
        const di = depotCars.indexOf(c)
        if (di >= 0) { depotCars.splice(di, 1); c.depot = undefined; c.kind = 'parked' }
        c.rtStuck = undefined
        if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot); c.slot = undefined }
        c.crashed = now
        c.thrown = true
        const relTx = relVx - closing * nx, relTz = relVz - closing * nz
        let jNorm: number, recoil: number, carry: number
        if (m.ridden) {
          // Whoever drives ploughs on: the struck car is sent ahead at least as fast as the driver still goes, so the
          // two part and the solver has no second blow to give for the same touch.
          const massShare = Math.max(0.24, Math.min(0.85, (m.mass / (m.mass + cMass)) * 1.4))
          recoil = Math.max(0, closing) * (1 - massShare) * 0.5
          if (recoil <= 4) recoil = 0
          jNorm = Math.max(18, Math.max(closing, relSpeed * 0.45) * 1.15 * massShare, closing - recoil + 4)
          carry = 0.35 * massShare
        } else {
          // Car on car with nobody driving: what one gives the other it loses, by their weights, with a little spring.
          // (No least push: a car that rolls against the next at walking pace gives it that much, and the row beyond it stands.)
          const share = m.mass / (m.mass + cMass), spring = 1.15
          jNorm = Math.max(0, closing) * spring * share
          recoil = Math.max(0, closing) * spring * (1 - share)
          carry = 0.2 * share
        }
        let px = cvx + nx * jNorm + relTx * carry
        let pz = cvz + nz * jNorm + relTz * carry
        const ph = Math.hypot(px, pz)
        if (ph > 420) { px = (px * 420) / ph; pz = (pz * 420) / ph }
        // A little off the road, not a car's height: at 55 cells a second up it came down on the next car's roof.
        const py = Math.min(12, Math.max(3, (relSpeed - 28) * 0.06))
        // Both the striking vehicle and the woken street car dent immediately on impact; keep woken crash cars exterior-only
        // so collisions never decode or draw 3.6M-cell per=8 interiors (reachable on-foot waking still loads interiors).
        if (m.thing) o.alive.hit(m.thing, hitAt, [nx, 0, nz], hitSpeed, hitSpeed * 80)
        pending.set(c, { inside: false, push: [px, py, pz], asked: now, then: (thing: Thing) => o.alive.hit(thing, hitAt, [-nx, 0, -nz], hitSpeed, hitSpeed * 80) })
        void wake(c, pending.get(c)!)
        // Immediate tactile recoil on the striking vehicle.
        if (recoil > 0) shove(m, -nx * recoil, m.ridden ? Math.min(12, recoil * 0.08) : 0, -nz * recoil)
        crashCountStat++
        // Scatter nearby pedestrians & briefly alert nearby traffic.
        crashShocks.push({ at: hitAt, radius: 14 + force * 24, t: o.clock() })
        if (crashShocks.length > 16) crashShocks.shift()
        for (const tCar of traffic) if (Math.hypot(tCar.x - hitAt[0], tCar.z - hitAt[2]) < 260) tCar.shaken = simTime - 2.5
        if (m.ridden || closing > 30) o.onCrash?.({ at: hitAt, speed: relSpeed, force, car: carName(c.model, c.paint), woke: true })
      } else if (m.thing && closing > 0 && now - (c.hitAt ?? -99) > 0.45) {
        // What has no motor does not wake (cable cars, trams, buses): solid. The mover is thrown back off it; whoever
        // drives is dented, with sparks and the sound.
        c.hitAt = now
        const bounce = m.ridden ? Math.max(24, Math.max(closing, relSpeed * 0.5) * 1.25) : closing * 1.15
        shove(m, -nx * bounce, m.ridden ? Math.min(18, 4 + bounce * 0.1) : 0, -nz * bounce)
        if (m.ridden || closing > 30) {
          o.alive.hit(m.thing, hitAt, [nx, 0, nz], hitSpeed, hitSpeed * 120)
          crashShocks.push({ at: hitAt, radius: 14 + force * 20, t: o.clock() })
          if (crashShocks.length > 16) crashShocks.shift()
          o.onCrash?.({ at: hitAt, speed: relSpeed, force, car: carName(c.model, c.paint), woke: false })
        }
      }
    }
    for (const m of movers) {
      for (const c of [...parked.values()]) checkCar(m, c)
      for (let i = traffic.length - 1; i >= 0; i--) if (traffic[i]) checkCar(m, traffic[i])
      for (let i = depotCars.length - 1; i >= 0; i--) if (depotCars[i]) checkCar(m, depotCars[i])
      for (const c of cables) checkCar(m, c)
      for (const c of trams) checkCar(m, c)
    }
    // Also detect high-speed near-misses past already-awake street cars (excluding the player's own vehicle).
    const rider = movers[0]?.ridden ? movers[0] : null
    if (rider && nearMissEligible) {
      for (const c of living) {
        if (!c.thing || c.thing === riding) continue
        const cw = o.alive.where(c.thing)
        if (!cw || Math.abs(cw.at[0] - rider.x) > CRASH_SCAN || Math.abs(cw.at[2] - rider.z) > CRASH_SCAN || Math.abs(cw.at[1] - c.model.size[1] * 0.5 - rider.y) > 35) continue
        const gap = obbOverlap(rider.x, rider.z, rider.fx, rider.fz, rider.halfL, rider.halfW, cw.at[0], cw.at[2], cw.front[0], cw.front[2], c.model.long * 0.5, c.model.wide * 0.5)
        tryNearMiss(rider, c.id, cw.at[0], cw.at[1], cw.at[2], cw.front[0], cw.front[2], c.model.long * 0.5, c.model.wide * 0.5, gap)
      }
    }
  }

  let ms = 0, on = true
  /** What street life needs from the network, asked for once it is first on. */
  const begin = () => { askLife(); askCars() }
  const laps: Record<string, number> = {}
  const self: Street = {
    folk,
    frame(dt, view) {
      if (!on) { for (const c of [...parked.values(), ...traffic, ...depotCars, ...cables, ...trams]) hide(c); hideStations(); for (const h of headsShown) { h.piece?.destroy(); h.piece = null; h.shown = '' } headsShown.clear(); return }
      begin()
      const t0 = performance.now(), eye = view.eye
      wanted(eye)
      probes = filled ? 8 : 400
      // Moved far at once (a jump, a portal, the checks): the traffic round the new place is there already.
      if (lastEye && Math.hypot(eye[0] - lastEye[0], eye[2] - lastEye[2]) > 1500) { for (const c of [...traffic, ...depotCars, ...trams]) hide(c); traffic.length = 0; depotCars.length = 0; trams.length = 0; holds.clear(); filled = false }
      lastEye = [eye[0], eye[1], eye[2]]
      let tl = performance.now()
      const lap = (n: string) => { const now = performance.now(); laps[n] = (laps[n] ?? 0) + ((now - tl) - (laps[n] ?? 0)) * 0.1; tl = now }
      park(eye, o.hour())
      lap('park')
      if (roads.size && ready.size) { spawn(view, !filled); busSpawn(view, !filled, o.clock()); filled = true }
      lap('spawn')
      drive(dt, view, o.clock())
      lap('drive')
      depotStep(dt, view)
      lap('depot')
      tramsDrive(dt, view, o.clock(), !trams.length)
      lap('trams')
      cableCars(o.clock(), view)
      lap('cables')
      const feet = o.feet()
      lap('feet')
      shaken(view)
      lap('shaken')
      reactiveDrive(dt)
      lap('reactive')
      probe()
      lap('probe')
      for (const [c, how] of pending) void wake(c, how)
      lap('wake')
      reachable(feet)
      lap('reachable')
      offer(feet)
      lap('offer')
      for (const c of parked.values()) show(c, view)
      lap('showParked')
      for (const c of traffic) show(c, view)
      lap('showTraffic')
      for (const c of depotCars) show(c, view)
      lap('showDepot')
      showStations(view, dt)
      lap('showStation')
      for (const c of cables) show(c, view)
      lap('showCables')
      for (const c of trams) show(c, view)
      lap('showTrams')
      for (const c of showcase) show(c, view)
      lap('showcase')
      for (const c of pending.keys()) show(c, view)
      landed(view)
      lap('showPending')
      showHeads(view, o.clock())
      lap('heads')
      ms += (performance.now() - t0 - ms) * 0.1
    },
    reset() {
      for (const c of [...traffic, ...depotCars, ...parked.values(), ...cables]) hide(c)
      for (const c of trams) hide(c)
      hideStations()
      for (const r of roads.values()) r.blocked = false
      craters.length = 0; looks.length = 0; cutsHeard = o.cuts?.length ?? 0
      crashShocks.length = 0; hornPulse = null; hornQueue.length = 0; nearMissAt.clear()
      prevRideId = 0; prevRideAt = null; rideDt = 0; rideVel[0] = 0; rideVel[1] = 0; rideVel[2] = 0
      hornWas = false; lastHornPulse = -99; lastTrafficHorn = -99
      lastCrowdShout = -99; crowdShoutsStat = 0; rtFilmersStat = 0; rtYellersStat = 0; stuckHonksStat = 0; lastStuckHorn = -99
      simTime = 0
      aiStats.laneChanges = 0; aiStats.detours = 0; aiStats.sirenYields = 0; aiStats.activeEmergency = 0; aiStats.deadlocksResolved = 0
      detourCache.map.clear(); nearMissCues.length = 0; pedNearMissCool.clear(); activeCongested.clear(); activeBlockedSig = ''
      watching.clear()
      for (const depot of depots) { depot.inGateLift = 0; depot.outGateLift = 0; depot.lastSpawn = -99; depot.arrivals = 0; depot.departures = 0 }
      crashCountStat = 0; nearMissCountStat = 0; hornResponsesStat = 0; sentAwayStat = 0; brokeStat = 0
      for (const c of living) hide(c)
      traffic.length = 0; depotCars.length = 0; trams.length = 0; parked.clear(); gone.clear(); holds.clear(); living.clear(); cables.length = 0; pending.clear(); heard = o.shocks.length
      cue?.remove(); cue = null; beside?.(); beside = null
      rng = 0x2545f491; filled = false
    },
    count(view, r = 1500) {
      const eye = view.eye, seen = (x: number, y: number, z: number) => {
        const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2], ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2]
        if (ahead <= 0) return false
        const right = dx * view.right[0] + dy * view.right[1] + dz * view.right[2], up = dx * view.up[0] + dy * view.up[1] + dz * view.up[2]
        return Math.abs(up) < ahead * view.tanHalf && Math.abs(right) < ahead * view.tanHalf * (16 / 9)
      }
      const within = (x: number, z: number) => Math.hypot(x - eye[0], z - eye[2]) < r
      const people = shown.filter((p) => within(p.at[0], p.at[2]))
      const v = [...parked.values(), ...traffic, ...depotCars, ...cables, ...trams].filter((c) => within(c.x, c.z))
      return {
        people: people.length, peopleSeen: people.filter((p) => seen(p.at[0], p.at[1] + 9, p.at[2])).length,
        parked: v.filter((c) => c.kind === 'parked').length, traffic: v.filter((c) => c.kind === 'traffic').length, cable: v.filter((c) => c.kind === 'cable').length, tram: v.filter((c) => c.kind === 'tram').length,
        bus: v.filter((c) => c.model.kind === 'bus').length, trolley: v.filter((c) => c.model.kind === 'trolley').length, van: v.filter((c) => c.model.kind === 'van').length, truck: v.filter((c) => c.model.kind === 'truck').length,
        robotaxi: v.filter((c) => c.model.kind === 'robotaxi').length, robotaxiStuck: v.filter((c) => c.model.kind === 'robotaxi' && !!c.rtStuck).length,
        waiting: shown.filter((p) => within(p.at[0], p.at[2]) && (p as { waiting?: boolean }).waiting).length,
        // On a crossing with lights while their way is red (not green, not its amber): what the walking signs forbid.
        crossingRed: shown.filter((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }; if (!q.sig || !within(p.at[0], p.at[2])) return false; const j = junctionOf(q.sig); return lightFor(j, q.cdx!, q.cdz!, o.clock()) === 'red' }).length,
        crossingLights: shown.filter((p) => within(p.at[0], p.at[2]) && (p as { sig?: number }).sig).length,
        craters: craters.length, blockedRoads: [...roads.values()].filter((r) => r.blocked).length, parkedInLane: inLanes, signStops, parkedInLaneNow: [...parked.values()].filter((c) => !c.thing && inLane(c.x, c.z, c.model.wide / 2)).length,
        vehiclesSeen: v.filter((c) => seen(c.x, c.y + 7, c.z)).length, living: living.size,
        heads: heads.length, headsShown: [...headsShown].filter((h) => within(h.x, h.z)).length, headsLit: [...headsShown].filter((h) => within(h.x, h.z)).reduce((n: Record<string, number>, h) => { n[h.shown] = (n[h.shown] ?? 0) + 1; return n }, {}),
      }
    },
    get robotaxis() {
      const now = performance.now() / 1000
      return {
        services: ROBOTAXI_SERVICES.map((s) => ({ id: s.id, name: s.name, badge: s.badge, station: s.station.name })),
        stations: depots.map((depot) => {
          const st = depot.service.station, sid = depot.service.id
          return {
            serviceId: sid,
            serviceName: depot.service.name,
            name: st.name,
            cx: st.cx,
            cz: st.cz,
            visit: st.visit,
            bays: st.bays.length,
            occupied: depotCars.filter((c) => c.depot?.serviceId === sid && c.depot.phase === 'charging').length,
            exiting: depotCars.filter((c) => c.depot?.serviceId === sid && c.depot.phase === 'exiting').length,
            entering: depotCars.filter((c) => c.depot?.serviceId === sid && c.depot.phase === 'entering').length,
            arrivals: depot.arrivals,
            departures: depot.departures,
            shown: depot.shown,
          }
        }),
        stuck: traffic.filter((c) => !!c.rtStuck).map((c) => {
          const svc = serviceOf(c)
          const hazardPhase = ((now - c.rtStuck!.at) * 2.2) % 1
          return { id: c.id, serviceId: svc.id, serviceName: svc.name, kind: c.rtStuck!.kind, x: c.x, y: c.y, z: c.z, heading: c.heading, pitch: c.pitch, age: Math.round((now - c.rtStuck!.at) * 10) / 10, hazardOn: hazardPhase < 0.65, hazardPhase }
        }),
        reactions: { honks: stuckHonksStat, shouts: crowdShoutsStat, filmers: rtFilmersStat, yellers: rtYellersStat },
        triggerStuck(kind: 'intersection' | 'narrow' = 'intersection', serviceId?: string) {
          const svc = serviceId === undefined ? ROBOTAXI_SERVICES[0] : serviceById.get(serviceId)
          if (!svc) return null
          const svcModel = robotaxiModels.get(svc.id)
          if (!svcModel) return null
          const eye = lastEye ?? [svc.station.cx, 50, svc.station.cz]
          const nowT = performance.now() / 1000
          // Prefer a visible incident beside actual sidewalk traffic, keeping existing taxis when equally suitable.
          const crowdNear = (x: number, z: number) => {
            let film = 0, yell = 0
            for (const p of shown) {
              if (p.down || p.flinch || p.robotaxiId !== undefined) continue
              const w = Math.max(0, 1 - Math.hypot(p.at[0] - x, p.at[2] - z) / 150)
              if (chance(p.seed, 71) < 0.46) film += w
              else yell += w
            }
            return Math.min(2, film) + Math.min(2, yell) + Math.min(1, film, yell)
          }
          let target: Car | null = null, bestD = Infinity, bestCrowd = 0
          for (const c of traffic) {
            if (c.model.kind !== 'robotaxi' || !c.road || (c.s ?? 0) < 75) continue
            if (serviceId && c.model.serviceId !== serviceId) continue
            const ok = kind === 'intersection' ? busyJunction(c.road.b) && c.road.len - c.s! < 120 : (c.road.lanes === 1 || (c.road.flags & 4) !== 0)
            const d = Math.hypot(c.x - eye[0], c.z - eye[2])
            if (!ok || c.rtStuck || d >= 900) continue
            const crowd = crowdNear(c.x, c.z), rank = d + 1600 / (1 + crowd)
            if (rank < bestD) { bestD = rank; bestCrowd = crowd; target = c }
          }
          if (!target || bestCrowd < 1.5) {
            let bestR: Road | null = null, bestRd = bestD
            for (let gx = Math.floor((eye[0] - 1400) / GRID); gx <= Math.floor((eye[0] + 1400) / GRID); gx++) {
              for (let gz = Math.floor((eye[2] - 1400) / GRID); gz <= Math.floor((eye[2] + 1400) / GRID); gz++) {
                for (const r of roadGrid.get(cell(gx, gz)) ?? []) {
                  probes = Math.max(probes, 2)
                  if (!open(r) || r.len < 130) continue
                  const match = kind === 'intersection' ? busyJunction(r.b) : (r.lanes === 1 || (r.flags & 4) !== 0)
                  if (!match) continue
                  const sTest = kind === 'intersection' ? Math.max(85, r.len - 45) : r.len * 0.5
                  lanePoint(r, 0, sTest, P)
                  const d = Math.hypot(P.x - eye[0], P.z - eye[2])
                  if (d >= 1400 || traffic.some((c) => Math.hypot(P.x - c.x, P.z - c.z) < (svcModel.long + c.model.long) / 2 + 4)) continue
                  const rank = d + 1600 / (1 + crowdNear(P.x, P.z)) + 80
                  if (rank < bestRd) { bestRd = rank; bestR = r }
                }
              }
            }
            if (bestR) {
              const sAt = kind === 'intersection' ? Math.max(85, bestR.len - 45) : bestR.len * 0.5
              target = { id: ids++, model: svcModel, paint: -1, kind: 'traffic', seed: ids, x: 0, y: 0, z: 0, heading: 0, pitch: 0, v: 0, piece: null, shown: '', road: bestR, prev: null, next: choose(bestR, 'robotaxi'), lane: 0, s: sAt, hold: null, stuck: 0, lidarAngle: 0 }
              pose(target)
              traffic.push(target)
            }
          }
          if (!target) return null
          const tr = target.road!, ts = target.s!, tl = target.lane ?? 0
          const cars = carModels()
          const sleekCars = cars.filter((m) => m.id !== 'suv')
          const pool = sleekCars.length ? sleekCars : cars
          // Queue up to 2 impatient cars directly behind the frozen robotaxi (at 6.8 m and 13.8 m back) so traffic backups & honking read immediately.
          for (const backOff of [68, 138]) {
            if (!pool.length || ts <= backOff + 10) continue
            const sFollow = ts - backOff
            const taken = traffic.some((c) => c !== target && c.road === tr && c.lane === tl && Math.abs(c.s! - sFollow) < 52)
            if (taken) continue
            const followerM = pool[Math.floor(random() * pool.length)]
            const follower: Car = { id: ids++, model: followerM, paint: followerM.variants.length ? Math.floor(random() * followerM.variants.length) : -1, kind: 'traffic', seed: ids, x: 0, y: 0, z: 0, heading: 0, pitch: 0, v: 0, piece: null, shown: '', road: tr, prev: null, next: choose(tr, followerM.kind), lane: tl, s: sFollow, hold: null, stuck: 0 }
            pose(follower)
            traffic.push(follower)
          }
          const actualSvc = serviceOf(target)
          target.v = 0
          target.rtStuck = { at: nowT - 1.2, until: nowT + 35, kind, stutter: nowT + 3.5, microEnd: 0 }
          target.rtCool = 0
          return { id: target.id, serviceId: actualSvc.id, serviceName: actualSvc.name, kind, x: target.x, y: target.y, z: target.z, heading: target.heading }
        },
      }
    },
    roads(x, z, r) {
      const out: ReturnType<Street['roads']> = []
      for (const road of roads.values()) {
        if (Math.hypot(road.mx - x, road.mz - z) > r + road.len / 2) continue
        probes = Math.max(probes, 1)
        out.push({ key: road.key, name: road.way, lanes: road.lanes, flags: road.flags, next: road.next, line: Array.from(road.p), open: open(road) })
      }
      return out
    },
    cars(x, z, r) {
      return [...parked.values(), ...traffic, ...depotCars, ...cables, ...trams].filter((c) => Math.hypot(c.x - x, c.z - z) < r).map((c) => ({ id: c.id, kind: c.kind, model: c.model.kind, service: c.model.serviceId ?? '', x: c.x, y: c.y, z: c.z, heading: c.heading, name: carName(c.model, c.paint), v: c.v, living: !!c.thing, wait: c.wait ?? '', stuck: c.stuck ?? 0 }))
    },
    snapshot(x, z, r) {
      const out: ReturnType<Street['snapshot']> = []
      const push = (c: Car) => {
        if (Math.hypot(c.x - x, c.z - z) >= r) return
        out.push({
          id: c.id, kind: c.kind, model: c.model.kind, name: carName(c.model, c.paint),
          x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 10) / 10,
          heading: Math.round(c.heading * 1000) / 1000, v: Math.round(c.v * 10) / 10,
          long: c.model.long, wide: c.model.wide,
          road: c.road?.key ?? '', lane: c.lane ?? 0, s: Math.round((c.s ?? 0) * 10) / 10,
          wait: c.wait ?? '', stuck: Math.round((c.stuck ?? 0) * 10) / 10,
          blocked: !!c.road?.blocked, living: !!c.thing,
          emergency: c.emergency,
          archetype: c.profile?.archetype,
          laneShift: c.laneShift ? Math.round(c.laneShift * 10) / 10 : undefined,
          sirenYieldShift: c.sirenYieldShift ? Math.round(c.sirenYieldShift * 10) / 10 : undefined,
        })
      }
      for (const c of parked.values()) push(c)
      for (const c of traffic) push(c)
      for (const c of depotCars) push(c)
      for (const c of cables) push(c)
      for (const c of trams) push(c)
      return out
    },
    trafficAiStats() {
      return {
        laneChanges: aiStats.laneChanges,
        detours: aiStats.detours,
        sirenYields: aiStats.sirenYields,
        activeEmergency: traffic.filter((c) => !!(c.emergency && c.sirenActive)).length,
        deadlocksResolved: aiStats.deadlocksResolved,
      }
    },
    spawnEmergency(opts = {}) {
      const kind: EmergencyKind = opts.kind ?? 'police'
      const sirenActive = opts.siren ?? true
      const cars = carModels()
      const m = (kind === 'ambulance' ? ready.get('van') : ready.get('suv') ?? ready.get('saloon')) ?? cars[0] ?? robotaxiModels.values().next().value
      if (!m) return null
      let r: Road | undefined = opts.roadKey ? roads.get(opts.roadKey) : undefined
      if (!r) {
        const refX = opts.at ? opts.at[0] : (lastEye ? lastEye[0] : 0)
        const refZ = opts.at ? opts.at[1] : (lastEye ? lastEye[2] : 0)
        let bestD = Infinity
        for (const cand of roads.values()) {
          probes = Math.max(probes, 2)
          if (!open(cand) || cand.len < 60) continue
          const d = Math.hypot(cand.mx - refX, cand.mz - refZ)
          if (d < bestD) { bestD = d; r = cand }
        }
      }
      if (!r) return null
      const lane = Math.max(0, Math.min(opts.lane ?? 0, r.lanes - 1))
      let s = opts.s !== undefined ? Math.max(5, Math.min(r.len - 10, opts.s)) : Math.min(r.len * 0.25, 60)
      lanePoint(r, lane, s, P)
      if (taken(P.x, P.z, P.tx, P.tz, m.long / 2 + 10, m.wide / 2 + 1, 2)) {
        for (const tryS of [Math.max(10, s - 75), Math.min(r.len - 20, s + 75), r.len * 0.5]) {
          lanePoint(r, lane, tryS, P)
          if (!taken(P.x, P.z, P.tx, P.tz, m.long / 2 + 10, m.wide / 2 + 1, 2)) { s = tryS; break }
        }
      }
      const seedId = ids + 1
      const prof = driverProfile(seedId, m.kind, kind)
      const c: Car = {
        id: ids++, model: m, paint: -1, kind: 'traffic', seed: seedId,
        x: P.x, y: 0, z: P.z, heading: 0, pitch: 0,
        v: limit(r) * prof.speedBias * 0.75,
        piece: null, shown: '', road: r, prev: null, next: null, lane, s,
        hold: null, stuck: 0, profile: prof, emergency: kind, sirenActive,
      }
      c.next = choose(r, m.kind)
      pose(c)
      traffic.push(c)
      aiStats.activeEmergency = traffic.filter((t2) => !!(t2.emergency && t2.sirenActive)).length
      return { id: c.id, kind, x: c.x, y: c.y, z: c.z, heading: c.heading, road: r.key, sirenActive }
    },
    get nearMissCues() { return nearMissCues },
    get rng() { return rng },
    set rng(v: number) { if (Number.isInteger(v) && v !== 0) rng = v | 0 },
    cable(x, z) {
      let best: { in: number; near: number } | null = null
      const t = o.clock()
      for (const l of lines) {
        // The nearest point of the line, then when each of its cars is there.
        let at = 0, near = Infinity
        for (let s = 0; s <= l.len; s += 20) { along(l.p, l.cum, s, P); const d = Math.hypot(P.x - x, P.z - z); if (d < near) { near = d; at = s } }
        // When each car that has left or leaves in the next while comes there, by its timetable.
        freshLights(l)
        const { every, base } = departures(l), most = (2 * l.len) / CABLE_SPEED + 300
        for (let n = Math.ceil((t - most - base) / every); n <= Math.floor((t + most - base) / every); n++) {
          const t0 = base + n * every, tt = timetable(l, ((t0 % CYCLE) + CYCLE) % CYCLE)
          let lo = 0, hi = tt.length - 1
          if (tt[hi] < at) continue
          while (lo < hi) { const m = (lo + hi) >> 1; if (tt[m] < at) lo = m + 1; else hi = m }
          const wait = t0 + lo * STEP - t
          if (wait < 0) continue
          if (!best || near < best.near - 50 || (Math.abs(near - best.near) <= 50 && wait < best.in)) best = { in: wait, near }
        }
      }
      return best
    },
    get debug() { return { laps: Object.fromEntries(Object.entries(laps).map(([k, v]) => [k, Math.round(v * 100) / 100])), pending: [...pending.keys()].map((c) => ({ name: carName(c.model, c.paint), waking: !!c.waking, thing: !!c.thing })), living: living.size, wakeLag, reactive: { sentAway: sentAwayStat, broke: brokeStat, crashes: crashCountStat, nearMisses: nearMissCountStat, hornResponses: hornResponsesStat, crashLiving: activeCrashLiving() }, faces: [...faces.entries()].map(([k, v]) => `${k}:${v === 'asked' ? 'asked' : 'made'}`), asking } },
    get red() { return shown.filter((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }; return q.sig && lightFor(junctionOf(q.sig), q.cdx!, q.cdz!, o.clock()) === 'red' }).map((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }, j = junctionOf(q.sig!); return { seed: p.seed, node: q.sig, u: Math.round(cycleAt(j, o.clock())), phase: phaseOf(j, q.cdx!, q.cdz!), axis: [j.ax, j.az].map((v) => Math.round(v * 100) / 100), dir: [q.cdx!, q.cdz!].map((v) => Math.round(v * 100) / 100), at: [Math.round(p.at[0]), Math.round(p.at[2])], jat: [Math.round(j.x), Math.round(j.z)] } }) },
    lineup(at, heading = 0, gap = 22) {
      for (const c of showcase) hide(c)
      showcase.length = 0
      if (!at) return []
      let along = 0
      const fx = Math.cos(heading), fz = Math.sin(heading), lx = fz, lz = -fx
      for (const m of library.map((c) => ready.get(c.id)).filter((m): m is Model => !!m)) {
        const c: Car = { id: ids++, model: m, paint: -1, kind: 'parked', seed: ids, x: at[0] + lx * (along + m.wide / 2) - fx * m.long / 2, y: 0, z: at[1] + lz * (along + m.wide / 2) - fz * m.long / 2, heading, pitch: 0, v: 0, piece: null, shown: '' }
        settle(c); showcase.push(c); along += m.wide + gap
      }
      return showcase.map((c) => c.model.name)
    },
    get lod() { return lastLod },
    trace(seed: number, times: number[]) {
      return walkGraph.trace(seed, times, o.hour(), o.rain())
    },
    audit(seconds) {
      const t = o.clock()
      let crossings = 0, red = 0, amber = 0
      const redAt: object[] = []
      for (const l of lines) {
        freshLights(l)
        const { every, base } = departures(l), lights = cableLights ? lightsOf(l as (typeof tramLines)[number]) : lightsOf({ ...l, lights: [] } as (typeof tramLines)[number])
        for (let n = Math.ceil((t - base) / every); n <= Math.floor((t + seconds - base) / every); n++) {
          const t0 = base + n * every, tt = timetable(l, ((t0 % CYCLE) + CYCLE) % CYCLE)
          for (const L of lights) {
            let lo = 0, hi = tt.length - 1
            if (tt[hi] <= L.s) continue
            // (The moment it goes past the line: one standing at it has not crossed.)
            while (lo < hi) { const m = (lo + hi) >> 1; if (tt[m] <= L.s) lo = m + 1; else hi = m }
            const light = lightFor(junctionOf(L.node), L.dx, L.dz, t0 + lo * STEP)
            crossings++; if (light === 'red') { red++; if (redAt.length < 4) redAt.push({ s: Math.round(L.s), len: Math.round(l.len), left: ((t0 % CYCLE) + CYCLE) % CYCLE, at: lo * STEP, u: Math.round(cycleAt(junctionOf(L.node), t0 + lo * STEP)), before: Array.from(tt.slice(Math.max(0, lo - 12), lo + 2)).map((v) => Math.round(v)), done: lightsDone.has(l), fresh: (() => { const kept = timetables.get(l)?.get(((t0 % CYCLE) + CYCLE) % CYCLE); timetables.get(l)?.delete(((t0 % CYCLE) + CYCLE) % CYCLE); const f = timetable(l, ((t0 % CYCLE) + CYCLE) % CYCLE); if (kept) timetables.get(l)!.set(((t0 % CYCLE) + CYCLE) % CYCLE, kept); let i = 0; while (i < f.length - 1 && f[i] <= L.s) i++; return lightFor(junctionOf(L.node), L.dx, L.dz, t0 + i * STEP) })(), lights: lights.filter((M) => Math.abs(M.s - L.s) < 500).map((M) => Math.round(M.s)) }) } if (light === 'amber') amber++
          }
        }
      }
      const buses = traffic.filter((c) => c.model.kind === 'bus' || c.model.kind === 'trolley')
      return {
        cable: { lines: lines.length, crossings, red, amber, redAt },
        left: { turns: leftTurns, conflicts: leftConflicts },
        buses: { driving: buses.length, onRoute: buses.filter((c) => c.route && c.route.piece.keys[c.route.i] === c.road!.key).length, trolleys: buses.filter((c) => c.model.kind === 'trolley').length, trolleysWired: buses.filter((c) => c.model.kind === 'trolley' && c.road!.wired).length, stops: busStops, pieces: busPieces.length },
      }
    },
    rules: {
      get yieldLeft() { return yieldLeft }, set yieldLeft(v: boolean) { yieldLeft = v },
      get cableLights() { return cableLights }, set cableLights(v: boolean) { cableLights = v; timetables.clear(); cableBases.clear() },
    },
    get onNearMiss() { return nearMissCb },
    set onNearMiss(fn: ((info: NearMiss) => void) | undefined) { nearMissCb = fn },
    get enabled() { return on },
    set enabled(v: boolean) { on = v; if (v) begin(); else dropCue() },
    prewarm() { begin(); prewarm() },
    warmAt(x: number, z: number) {
      pendingWarm = [x, 0, z]
      begin()
      wanted(pendingWarm)
    },
    lights(sink) {
      if (!on) return
      const nowSec = performance.now() / 1000
      const emitList = (list: readonly Car[]) => {
        for (let i = 0; i < list.length; i++) {
          const c = list[i]
          if (c.thing && !c.landing) continue
          if (c.emergency && c.sirenActive) {
            emitEmergencyFlashers(sink, {
              x: c.x, y: c.y, z: c.z, heading: c.heading, height: c.model.size[1],
              emergency: c.emergency, sirenActive: c.sirenActive, seed: c.seed,
            }, simTime)
          }
          const ls = carLampState(c, nowSec)
          if (ls.head <= 0.01 && ls.brake <= 0.04 && ls.hazard <= 0.05) continue
          const ch = Math.cos(c.heading), sh = Math.sin(c.heading)
          const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch)
          sink.addVehicle(
            c.x, c.y, c.z,
            ch * cp, sp, sh * cp,
            -sh, 0, ch,
            -ch * sp, cp, -sh * sp,
            c.model.long * 0.5, c.model.wide * 0.5, c.model.size[1],
            ls.head, ls.brake, 0, ls.hazard, 0, false,
          )
        }
      }
      emitList(traffic)
      emitList(depotCars)
      emitList(trams)
      emitList(cables)
    },
    get ms() { return ms + peopleMs },
    get ready() { return roads.size > 0 && ready.size > 0 && robotaxiModels.size === ROBOTAXI_SERVICES.length },
  }
  return self
}
