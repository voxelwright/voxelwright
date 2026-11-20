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
import type { Person } from './people.ts'
import type { Piece, Pieces } from './pieces.ts'
import type { Living, Making, Motor, Thing } from './living.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Born } from './told.ts'
import { chance, out as homeHours, type Shock } from './residents.ts'
import { unrun } from './runs.ts'

/** What street life asks of the land (the core's exports). */
export interface Ground { feet_at(x: number, z: number): number; ground_at(x: number, z: number): number }

type Ring = Float64Array
interface Walk { a: number; b: number; kind: number; busy: number; signal: number; p: Ring; cum: Ring; len: number; homes: number; seed: number; mx: number; mz: number }
interface Road { key: string; way: number; a: number; b: number; lanes: number; flags: number; next: string[]; ctl: number; cls: number; wired: boolean; blocked: boolean; p: Ring; cum: Ring; len: number; open: boolean | null; weight: number; mx: number; mz: number }
interface Slot { x: number; z: number; yaw: number; mapped: boolean; seed: number; y?: number; pitch?: number; ok?: boolean }
interface Line { p: Ring; cum: Ring; len: number; seed: number }
interface Look { size: [number, number, number]; per: number; low: [number, number, number]; palette: number[]; runs: string }
interface Model { id: string; name: string; kind: string; size: [number, number, number]; body: { palette: number[]; runs: string }; motor?: Motor; controls?: Making['controls']; seats?: [number, number, number][]; eye?: [number, number, number]; looks: Look[]; variants: { name: string; body: number[]; looks: number[][] }[]; front: number; long: number; wide: number }
interface Car {
  id: number; model: Model; paint: number; kind: 'parked' | 'traffic' | 'cable' | 'tram'; seed: number
  /** A streetcar's line. */
  track?: Line & { lights: { s: number; node: number; dx: number; dz: number }[] }
  x: number; y: number; z: number; heading: number; pitch: number; v: number
  piece: Piece | null; shown: string
  // Driving: the road, its lane, how far along, the road before (for the corner) and the one after.
  road?: Road; prev?: Road | null; next?: Road | null; lane?: number; s?: number; hold?: number | null; stuck?: number
  /** The junction it last came to a stop at (a stop sign's), and how long it has waited on a control (lights, a sign, its turn). */
  stopped?: number; held?: number
  slot?: number; thing?: Thing | null; waking?: boolean
  /** When a blast near it went off (seconds on the page's clock): it stands on its brakes a while. */
  shaken?: number
  /** Thrown by a blast: it lives until the street is reset or the eye is far from it, wherever nobody is. */
  thrown?: boolean
  /** What it last waited for, if it is held up: a car, a person, a turn at a junction, the end of the road. */
  wait?: string
}

/** How far off people are worked out and drawn (people.ts REACH), and how far a walk takes anyone from home. */
const REACH = 1400, WALK_MOST = 1600
/** How long a pair of steps is (people.ts STRIDE). */
const STRIDE = 14.4
/** The share of a busy street's people out at each hour: shops and offices, open from morning to late. */
const SHOPS = [0.15, 0.08, 0.05, 0.04, 0.05, 0.1, 0.25, 0.5, 0.75, 0.85, 0.9, 1, 1, 1, 0.95, 0.95, 1, 1, 1, 0.95, 0.85, 0.7, 0.5, 0.3]
/** How much traffic there is at each hour, against the most. */
const TRAFFIC = [0.15, 0.1, 0.07, 0.07, 0.1, 0.25, 0.55, 0.9, 1, 0.85, 0.75, 0.8, 0.85, 0.8, 0.8, 0.85, 0.95, 1, 1, 0.85, 0.65, 0.5, 0.35, 0.22]
const hourly = (table: readonly number[], hour: number) => { const h = ((hour % 24) + 24) % 24, a = Math.floor(h); return table[a] + (table[(a + 1) % 24] - table[a]) * (h - a) }
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
/** A cable car's speed (9.5 mph, as the cable runs) and how far apart they come. */
const CABLE_SPEED = 42, CABLE_APART = 4200

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

/** A walk out from home and back: the line it takes, its length so far, and what each piece of it is (a crossing is 1). */
interface Route {
  p: number[]; cum: number[]; kinds: number[]; sigs: number[]; len: number; used: number; P: Float64Array; C: Float64Array
  /** The crossings on it that wait on lights: where each begins and ends along it, whose lights, and which way it crosses. */
  crossings: { s0: number; s1: number; node: number; dx: number; dz: number }[]
  /** When it is where (seconds from its round's start, and how far along): out, standing, back, waiting at kerbs on the way. */
  plan?: { out: number[]; back: number[]; outEnd: number; backAt: number; backEnd: number }
}

export interface Street {
  /** The people to draw, for people.ts `from`. */
  folk(view: View, seconds: number): readonly Person[]
  /** Drives, parks and draws the vehicles: once a frame, before the pieces are drawn. */
  frame(dt: number, view: View): void
  /** Everything as it was: the traffic begins again, every parked car is back at its kerb. */
  reset(): void
  /** What is in sight: people and vehicles within `r` cells of a point (both counted on the ground plan) and in the eye's view. */
  count(view: View, r?: number): { people: number; peopleSeen: number; parked: number; traffic: number; cable: number; tram: number; bus: number; trolley: number; van: number; truck: number; vehiclesSeen: number; living: number; waiting: number; crossingRed: number; crossingLights: number }
  /** The roads near a place, for a driver to follow (the checks). */
  roads(x: number, z: number, r: number): { key: string; name: number; lanes: number; flags: number; next: string[]; line: number[]; open: boolean | null }[]
  /** Vehicles near a place: where each stands, which way it heads, and what it is. */
  cars(x: number, z: number, r: number): { kind: Car['kind']; model: string; x: number; y: number; z: number; heading: number; name: string; v: number; living: boolean; wait: string; stuck: number }[]
  /** Seconds from now on the clock people walk by until a cable car is nearest a place, and how near it comes (cells); null with no line. */
  cable(x: number, z: number): { in: number; near: number } | null
  /** Off, nothing of street life is worked out or drawn (for timing what it costs). */
  enabled: boolean
  /** One of every kept vehicle in a row along a heading from a place (cells, radians), standing still: for looking at them (the checks' line-up). Null clears it. */
  lineup(at: readonly [number, number] | null, heading?: number): string[]
  /** What is on its way to life and which faces are made (for the checks). */
  readonly debug: unknown
  readonly red: unknown
  readonly ms: number
  readonly ready: boolean
}

export function street(o: {
  /** Where the life files (`life/index.json`) and the kept vehicles (`cars/index.json`) are. */
  life: URL; cars: URL
  land: Ground
  hour: () => number; rain: () => number
  /** Seconds on the clock people walk by. */
  clock: () => number
  shocks: readonly Shock[]
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
}): Street {
  // ── The graph, a square at a time ──
  const walks: Walk[] = [], nodes = new Map<number, { x: number; z: number; walks: number[] }>()
  const roads = new Map<string, Road>(), roadsFrom = new Map<number, Road[]>(), roadsTo = new Map<number, Road[]>(), ways = new Map<number, Set<number>>()
  const slots: Slot[] = [], lines: Line[] = []
  const GRID = 1000
  const walkGrid = new Map<number, number[]>(), roadGrid = new Map<number, Road[]>(), slotGrid = new Map<number, number[]>()
  const cell = (gx: number, gz: number) => gx * 100003 + gz
  const file = (grid: Map<number, unknown[]>, x0: number, z0: number, x1: number, z1: number, v: unknown) => {
    for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) { const k = cell(gx, gz); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(v) }
  }
  const box = (p: Ring) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]) } return [x0, z0, x1, z1] as const }
  let index: { life: Record<string, { path: string }>; transit?: { path: string } } | null = null
  /** The streetcar lines (life/transit.json), each a route's pieces of track in its order: driven, stopping at lights and behind cars. */
  const tramLines: (Line & { lights: { s: number; node: number; dx: number; dz: number }[] })[] = []
  let routed = false
  const squares = new Map<string, 'asked' | 'held'>()
  const rails: { a: number; b: number; p: Ring }[] = []
  const take = (s: { walk: number[][]; roads: (number | number[])[][]; park: number[]; rail: number[][] }) => {
    for (const w of s.walk) {
      const [a, b, kind, busy, signal] = w, { p, cum, len } = line(w, 5)
      if (len < 1) continue
      // How many live along it: none on a crossing, a few on steps, and on a pavement more the busier it is.
      const per = kind === 1 ? 0 : kind === 2 ? 0.4 : 0.5 + 0.1 * busy, seed = mix(idSeed(a), idSeed(b))
      const homes = Math.floor((len / 1000) * per + chance(seed, 9))
      const i = walks.push({ a, b, kind, busy, signal, p, cum, len, homes, seed, mx: (p[0] + p[p.length - 2]) / 2, mz: (p[1] + p[p.length - 1]) / 2 }) - 1
      for (const [id, x, z] of [[a, p[0], p[1]], [b, p[p.length - 2], p[p.length - 1]]]) { let n = nodes.get(id); if (!n) nodes.set(id, n = { x, z, walks: [] }); n.walks.push(i) }
      const [x0, z0, x1, z1] = box(p)
      file(walkGrid, x0, z0, x1, z1, i)
    }
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
    for (const l of tramLines) l.lights.length = 0
    // A junction on a seam is whole only now: walks timed against half of it are timed again.
    routes.clear(); junctions.clear()
  }
  /** The cable car lines: track pieces joined end to end where only two meet, longest first. */
  const joinRails = () => {
    lines.length = 0
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
      if (l.len > 3000) lines.push({ ...l, seed: mix(Math.round(pts[0]), Math.round(pts[1])) })
    }
  }
  const squareOf = (name: string) => { const [e, n] = name.split('_').map((v) => Number(v) * 1000); return [(e - 500000) * 10, (4250000 - n - 1000) * 10, (e + 1000 - 500000) * 10, (4250000 - n) * 10] }
  const wanted = (eye: readonly number[]) => {
    if (!index) return
    for (const name of Object.keys(index.life)) {
      if (squares.has(name)) continue
      const [x0, z0, x1, z1] = squareOf(name), dx = Math.max(x0 - eye[0], 0, eye[0] - x1), dz = Math.max(z0 - eye[2], 0, eye[2] - z1)
      if (Math.hypot(dx, dz) > 15000) continue
      squares.set(name, 'asked')
      void fetch(new URL(index.life[name].path, o.life)).then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) { take(s); squares.set(name, 'held') } }, () => squares.delete(name))
    }
  }
  void fetch(new URL('index.json', o.life)).then((r) => r.json()).then((i) => {
    index = i
    if (!i.transit) return
    void fetch(new URL(i.transit.path, o.life)).then((r) => r.json()).then((t: { routes: { ref: string; kind: string; lines: number[][] }[] }) => {
      // The cable cars run their routes as OSM orders them, one way each; the streetcars are driven.
      lines.length = 0
      for (const route of t.routes) for (const flat of route.lines) {
        const l = line(flat, 0)
        if (l.len < 3000) continue
        const seed = mix(Math.round(flat[0]), Math.round(flat[1]))
        if (route.kind === 'cable') lines.push({ ...l, seed })
        else tramLines.push({ ...l, seed, lights: [] })
      }
      routed = true
    }, () => {})
  }, () => {})

  // ── People ──
  const routes = new Map<string, Route>()
  /** A walk of the graph from where someone lives: each turn chosen by their number and the round, liking a straight way and a busy one. */
  const route = (wi: number, u: number, seed: number, k: number, want: number): Route => {
    const w = walks[wi]
    const key = `${seed}:${k}`
    let r = routes.get(key)
    if (r) { r.used = k; return r }
    if (routes.size > 6000) { let n = 0; for (const key of routes.keys()) { routes.delete(key); if (++n > 2000) break } }
    r = { p: [], cum: [0], kinds: [], sigs: [], len: 0, used: k, P: new Float64Array(0), C: new Float64Array(0), crossings: [] }
    const P = { x: 0, z: 0, tx: 0, tz: 0 }
    along(w.p, w.cum, u, P)
    r.p.push(P.x, P.z)
    const push = (x: number, z: number, kind: number, sig = 0) => { const px = r!.p[r!.p.length - 2], pz = r!.p[r!.p.length - 1], d = Math.hypot(x - px, z - pz); if (d < 0.5) return; r!.p.push(x, z); r!.len += d; r!.cum.push(r!.len); r!.kinds.push(kind); r!.sigs.push(sig) }
    // Along their own pavement first, one way or the other.
    let edge = wi, forward = chance(seed, 40 + k * 7) < 0.5, node = forward ? w.b : w.a
    const n0 = w.cum.length
    if (forward) { for (let i = 0; i < n0; i++) if (w.cum[i] > u) push(w.p[2 * i], w.p[2 * i + 1], w.kind, w.signal) } else { for (let i = n0 - 1; i >= 0; i--) if (w.cum[i] < u) push(w.p[2 * i], w.p[2 * i + 1], w.kind, w.signal) }
    for (let step = 0; r.len < want && step < 40; step++) {
      const here = nodes.get(node)
      if (!here) break
      const last = r.p.length, hx = r.p[last - 2] - r.p[last - 4], hz = r.p[last - 1] - r.p[last - 3], hl = Math.hypot(hx, hz) || 1
      let total = 0
      const options: [number, number][] = []
      for (const j of here.walks) {
        if (j === edge && here.walks.length > 1) continue
        const e = walks[j], out = e.a === node, nx = out ? e.p[2] - e.p[0] : e.p[e.p.length - 4] - e.p[e.p.length - 2], nz = out ? e.p[3] - e.p[1] : e.p[e.p.length - 3] - e.p[e.p.length - 1]
        const straight = (hx * nx + hz * nz) / (hl * (Math.hypot(nx, nz) || 1))
        const like = (e.kind === 1 ? 0.45 : e.kind === 2 ? 0.35 : 1 + e.busy / 40) * (0.25 + Math.max(0, straight) * 1.5)
        options.push([j, like]); total += like
      }
      if (!options.length) break
      let pick = chance(seed, 1000 + k * 53 + step) * total, j = options[0][0]
      for (const [o, like] of options) { pick -= like; if (pick <= 0) { j = o; break } }
      const e = walks[j], out = e.a === node, n = e.cum.length
      for (let i = 1; i < n; i++) { const at = out ? i : n - 1 - i; push(e.p[2 * at], e.p[2 * at + 1], e.kind, e.signal) }
      edge = j; node = out ? e.b : e.a
    }
    // Cut to how far they mean to go.
    // A walk never ends on a crossing (they would stand in the road): it ends at the kerb before it.
    if (r.len > want) { let i = r.cum.findIndex((c) => c >= want) - 1; if (r.kinds[i] === 1) { while (i > 0 && r.kinds[i - 1] === 1) i--; want = Math.max(1, r.cum[i] - 10) } }
    if (r.len > want) { const P2 = { x: 0, z: 0, tx: 0, tz: 0 }, i = r.cum.findIndex((c) => c >= want); along(r.p, r.cum, want, P2); const kind = r.kinds[i - 1] ?? 0; r.p.length = i * 2; r.cum.length = i; r.kinds.length = i - 1; r.p.push(P2.x, P2.z); r.cum.push(want); r.kinds.push(kind); r.len = want }
    // Its crossings that wait on lights (whose junction is known here). Past the second, the walk ends at the kerb: two
    // waits each way are what a round leaves room for.
    for (let i = 0; i < r.sigs.length;) {
      const node = r.sigs[i]
      if (!node || r.kinds[i] !== 1 || !(roadsTo.get(node)?.length)) { i++; continue }
      let j = i
      while (j + 1 < r.sigs.length && r.sigs[j + 1] === node && r.kinds[j + 1] === 1) j++
      const dx = r.p[2 * j + 2] - r.p[2 * i], dz = r.p[2 * j + 3] - r.p[2 * i + 1], l = Math.hypot(dx, dz) || 1
      if (r.crossings.length === 2) { const cut = Math.max(1, r.cum[i] - 10); const P2 = { x: 0, z: 0, tx: 0, tz: 0 }; const at = r.cum.findIndex((c) => c >= cut); along(r.p, r.cum, cut, P2); r.p.length = at * 2; r.cum.length = at; r.kinds.length = at - 1; r.sigs.length = at - 1; r.p.push(P2.x, P2.z); r.cum.push(cut); r.kinds.push(0); r.sigs.push(0); r.len = cut; break }
      r.crossings.push({ s0: r.cum[i], s1: r.cum[j + 1], node, dx: dx / l, dz: dz / l })
      i = j + 1
    }
    r.P = Float64Array.from(r.p); r.C = Float64Array.from(r.cum)
    routes.set(key, r)
    return r
  }
  /** One person at a second: where on their walk, which way they face, what they are doing. */
  const W = { x: 0, z: 0, hx: 0, hz: 1, s: 0, walking: 0, still: false, far: false, stood: 0, crossing: false, kind: 0, waiting: false, sig: 0, cdx: 0, cdz: 0 }
  /**
   * A walk out and back, timed: at each crossing with lights they stop a step short of the kerb and wait for their
   * walking sign (a rule of the clock, cycleAt), going only if what is left of it sees them across before the lights
   * change. `start` is when the round began on the shared clock, so where anyone is stays a rule of place and time.
   * The time in between, at the far end, is what the round has left; if waits leave none, the walk back is hurried.
   */
  const planOf = (r: Route, v: number, T: number, rest: number, start: number) => {
    const leg = (from: number, forward: boolean, t0: number) => {
      const pts = [0, from]
      let t = 0, s = from
      const order = forward ? r.crossings : [...r.crossings].reverse()
      for (const c of order) {
        const entry = forward ? c.s0 - 8 : c.s1 + 8
        if (forward ? entry < s : entry > s) continue
        t += Math.abs(entry - s) / v; s = entry; pts.push(t, s)
        const j = junctionOf(c.node), across = (c.s1 - c.s0) / v
        const ws = phaseOf(j, c.dx, c.dz) * (CYCLE / 2), last = Math.max(ws, Math.min(ws + WALK, ws + GREEN - across))
        const u = cycleAt(j, start + t0 + t)
        const wait = u >= ws && u <= last ? 0 : ((ws - u) % CYCLE + CYCLE) % CYCLE
        if (wait > 0) { t += wait; pts.push(t, s) }
        // Across before the lights change: a long crossing (the Embarcadero's) is hurried.
        const exit = forward ? c.s1 : c.s0, gone = (((cycleAt(j, start + t0 + t) - ws) % CYCLE) + CYCLE) % CYCLE
        t += Math.min(Math.abs(exit - s) / v, Math.max(4, GREEN + AMBER - 1 - gone)); s = exit; pts.push(t, s)
      }
      const end = forward ? r.len : 0
      t += Math.abs(end - s) / v; pts.push(t, end)
      return pts
    }
    const out = leg(0, true, 0), outEnd = out[out.length - 2]
    let backAt = Math.max(outEnd + 3, T - rest - (r.len / v) * 1.15), back = leg(r.len, false, backAt)
    for (let n = 0; n < 3 && backAt + back[back.length - 2] > T - rest; n++) { backAt = Math.max(outEnd + 2, T - rest - back[back.length - 2]); back = leg(r.len, false, backAt) }
    // Still over: the way back is walked faster, so that the round ends at home.
    const room = T - rest - backAt, took = back[back.length - 2]
    if (took > room) for (let i = 0; i < back.length; i += 2) back[i] *= room / took
    return { out, back, outEnd, backAt, backEnd: backAt + Math.min(took, room) }
  }
  /** Where along a timed leg a moment is, whether they wait there, and how much of a walk it is (eased at each stop). */
  const FOLLOW = { s: 0, waiting: false, walking: 0 }
  const follow = (pts: number[], t: number) => {
    let i = 0
    while (i + 2 < pts.length - 1 && pts[i + 2] <= t) i += 2
    const t0 = pts[i], s0 = pts[i + 1], t1 = pts[i + 2] ?? t0, s1 = pts[i + 3] ?? s0
    const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 1
    FOLLOW.s = s0 + (s1 - s0) * f
    FOLLOW.waiting = s1 === s0 && t1 > t0
    FOLLOW.walking = FOLLOW.waiting ? 0 : ease(Math.min(t - t0, t1 - t) / 0.7)
    return FOLLOW
  }
  const R = { x: 0, z: 0, tx: 0, tz: 0 }
  const placeOf = (wi: number, seed: number, t: number) => {
    const w = walks[wi]
    const T = 180 + 180 * chance(seed, 1), v = 11 + 4 * chance(seed, 2), u = t + chance(seed, 3) * T, k = Math.floor(u / T), tau = u - k * T
    const home = (0.05 + 0.9 * chance(seed, 4)) * w.len
    // Room in the round for waiting at lights: a minute and a half each way at most.
    const rest = 10 + 30 * chance(seed, 5 + k * 3), r = route(wi, home, seed, k, Math.max(200, Math.min(WALK_MOST, (v * (T - rest - 15 - 90)) / 2)))
    const plan = r.plan ??= planOf(r, v, T, rest, k * T - chance(seed, 3) * T)
    let s = 0, back = false, stood = 0, waiting = false
    W.still = false; W.far = false
    if (tau < plan.outEnd) { const at = follow(plan.out, tau); s = at.s; waiting = at.waiting; W.walking = at.walking; W.s = s }
    else if (tau < plan.backAt) { s = r.len; W.still = true; W.far = true; stood = tau - plan.outEnd; W.walking = 0; W.s = r.len }
    else if (tau < plan.backEnd) { const at = follow(plan.back, tau - plan.backAt); s = at.s; waiting = at.waiting; back = true; W.walking = at.walking; W.s = 2 * r.len - s }
    else { s = 0; W.still = true; stood = tau - plan.backEnd; W.walking = 0; W.s = 2 * r.len }
    W.stood = stood
    W.waiting = waiting
    const P = r.P, C = r.C
    const segment = along(P, C, s, R)
    let hx = R.tx, hz = R.tz
    if (back) { hx = -hx; hz = -hz }
    // The way they face over a few steps, so a corner is turned and not snapped.
    const a = { x: 0, z: 0, tx: 0, tz: 0 }, b = { x: 0, z: 0, tx: 0, tz: 0 }
    along(P, C, s - 6, a); along(P, C, s + 6, b)
    if (Math.hypot(b.x - a.x, b.z - a.z) > 1) { hx = (b.x - a.x) * (back ? -1 : 1); hz = (b.z - a.z) * (back ? -1 : 1); const l = Math.hypot(hx, hz); hx /= l; hz /= l }
    W.kind = r.kinds[segment] ?? 0; W.crossing = W.kind === 1 && !waiting
    // Which lights the crossing they are on waits on, and which way it crosses as a whole (its pieces may bend).
    const on = W.crossing ? r.crossings.find((c) => s >= c.s0 - 1 && s <= c.s1 + 1) : undefined
    W.sig = on ? on.node : 0; W.cdx = on ? on.dx : 0; W.cdz = on ? on.dz : 0
    // Keep right: half a metre to a metre to the right of their way, less on a crossing. Standing, they cross over
    // to the other side slowly, to walk back on their right.
    const side = (W.crossing ? 3 : 5 + 5 * chance(seed, 6))
    let lateral = back ? -side : side
    if (W.still) { const f = ease((stood - 2) / 4); lateral = W.far ? side * (1 - 2 * f) : -side * (1 - 2 * f) }
    // Right of the way out: (-tz, tx).
    W.x = R.x - R.tz * lateral; W.z = R.z + R.tx * lateral; W.hx = hx; W.hz = hz
    if (W.still) {
      // Standing they turn to the houses or the street, whichever their number says.
      const turn = ease((stood - 1) / 1.5) * (chance(seed, 7 + k) < 0.5 ? 1 : -1) * Math.PI / 2, c = Math.cos(turn), sn = Math.sin(turn)
      W.hx = hx * c - hz * sn; W.hz = hx * sn + hz * c
    }
  }
  /** Feet on the ground: the Bay's footing, but never on a roof over the pavement (an arcade, an awning). */
  const feetAt = (x: number, z: number) => { const ix = Math.round(x), iz = Math.round(z), f = o.land.feet_at(ix, iz), g = o.land.ground_at(ix, iz); return f - g > 25 ? g + 1 : f }
  const S = { when: 0, down: 0, flinch: 0, towards: 0, turned: 0, frozen: false }
  const startle = (wi: number, seed: number, t: number) => {
    S.when = t; S.down = 0; S.flinch = 0; S.towards = 0; S.turned = 0; S.frozen = false
    for (let k = o.shocks.length - 1; k >= 0; k--) {
      const shock = o.shocks[k], age = t - shock.t
      if (age < 0 || age > 45) continue
      placeOf(wi, seed, shock.t)
      const far = Math.hypot(W.x - shock.at[0], W.z - shock.at[2], feetAt(W.x, W.z) + 9 - shock.at[1])
      const close = far < shock.radius * 2.5 + 10
      if (!close && far >= shock.radius * 6 + 60) continue
      const held = close ? 4.4 + 1.6 * chance(seed, 31) : 1.2 + 0.9 * chance(seed, 31)
      if (age < held) {
        S.when = shock.t; S.frozen = true
        if (close) { S.down = ease(age / 0.3) * (1 - ease((age - held + 1.4) / 1.4)); S.turned = ease(age / 0.3) }
        else S.flinch = ease(age / 0.12) * (1 - ease((age - held + 0.6) / 0.6))
        S.towards = Math.atan2(shock.at[0] - W.x, -(shock.at[2] - W.z))
      } else S.when = Math.min(t, shock.t + (age - held) * 1.7)
      return
    }
  }
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
  const seenWalks: number[] = []
  let stamp = 1, lastSeconds = 0
  const walkStamp = new Map<number, number>()
  /** Where people were drawn last, for the cars to wait for them on a crossing. */
  const crossing: [number, number][] = []
  let peopleMs = 0
  const folk = (view: View, seconds: number): readonly Person[] => {
    if (!on) { shown.length = 0; return shown }
    const t0 = performance.now(), t = o.clock(), hour = o.hour(), wet = o.rain() > 0.3, eye = view.eye, bodies = o.bodies()
    const dt = Math.max(0, Math.min(0.1, seconds - lastSeconds))
    lastSeconds = seconds
    wanted(eye)
    stamp++
    seenWalks.length = 0
    const far = REACH + WALK_MOST
    for (let gx = Math.floor((eye[0] - far) / GRID); gx <= Math.floor((eye[0] + far) / GRID); gx++) for (let gz = Math.floor((eye[2] - far) / GRID); gz <= Math.floor((eye[2] + far) / GRID); gz++) {
      for (const i of walkGrid.get(cell(gx, gz)) ?? []) if (walkStamp.get(i) !== stamp) { walkStamp.set(i, stamp); seenWalks.push(i) }
    }
    const homeShare = homeHours(hour), shopShare = hourly(SHOPS, hour)
    let n = 0
    crossing.length = 0
    for (const i of seenWalks) {
      const w = walks[i]
      if (!w.homes || Math.hypot(w.mx - eye[0], w.mz - eye[2]) - w.len / 2 > far) continue
      const share = homeShare + (shopShare - homeShare) * Math.min(1, w.busy / 60)
      for (let h = 0; h < w.homes; h++) {
        const seed = mix(w.seed, h)
        if (chance(seed, 20) >= share) continue
        if (o.shocks.length) startle(i, seed, t)
        else { S.when = t; S.down = 0; S.flinch = 0; S.turned = 0; S.frozen = false }
        const { when, down, flinch, towards, turned, frozen } = S
        placeOf(i, seed, when)
        if (Math.abs(W.x - eye[0]) > REACH || Math.abs(W.z - eye[2]) > REACH) continue
        let x = W.x, z = W.z, hx = W.hx, hz = W.hz
        const high = feetAt(x, z)
        // Going round whoever is in the way: brought in at a brisk step at most, so nobody is seen to jump.
        const want = bodies.length && !down ? aside(x, z, high, hx, hz, bodies) : 0
        let a = held.get(seed)
        if (want || a) {
          if (!a) held.set(seed, a = { x: 0, z: 0, at: seconds })
          if (seconds - a.at > 1) { a.x = 0; a.z = 0 }
          const tx = -hz * want, tz = hx * want, k = 1 - Math.exp(-dt * 9), dx = (tx - a.x) * k, dz = (tz - a.z) * k, d = Math.hypot(dx, dz), most = 11 * dt
          a.x += d > most ? (dx * most) / d : dx; a.z += d > most ? (dz * most) / d : dz; a.at = seconds
          x += a.x; z += a.z
          if (!want && Math.abs(a.x) + Math.abs(a.z) < 0.05) held.delete(seed)
        }
        const p = (shown[n] ??= { at: [0, 0, 0], yaw: 0, seed: 0 }) as { -readonly [K in keyof Person]: Person[K] }
        const at = (p.at as [number, number, number])
        at[0] = x; at[2] = z
        at[1] = (feetAt(x + hx * 2, z + hz * 2) + feetAt(x - hx * 2, z - hz * 2) + high) / 3
        let yaw = Math.atan2(hx, -hz)
        if (turned) { let by = towards - yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; yaw += by * turned }
        p.yaw = yaw; p.seed = seed
        p.stride = W.s / STRIDE; p.walking = frozen ? 0 : W.walking; p.pace = 11 + 4 * chance(seed, 2)
        p.reading = W.still && W.far && chance(seed, 29) < 0.45 ? ease((W.stood - 2.5) / 1.2) : 0
        p.umbrella = wet && chance(seed, 30) < 0.6; p.time = seconds; p.flinch = flinch; p.down = down
        // They look at whoever is within three metres and not behind them.
        let glance = 0
        for (const b of bodies) {
          const dx = b[0] - x, dz = b[2] - z, d = Math.hypot(dx, dz)
          if (d > 32 || d < 1 || Math.abs(b[1] - at[1]) > 25) continue
          let to = Math.atan2(dx, -dz) - yaw
          to -= Math.round(to / (Math.PI * 2)) * Math.PI * 2
          const keen = (1 - ease((d - 12) / 20)) * (1 - ease((Math.abs(to) - 1.3) / 0.9))
          if (Math.abs(to * keen) > Math.abs(glance)) glance = Math.max(-1, Math.min(1, to)) * keen
        }
        p.glance = glance
        const q = p as { waiting?: boolean; sig?: number; cdx?: number; cdz?: number }
        q.waiting = W.waiting; q.sig = W.sig; q.cdx = W.cdx; q.cdz = W.cdz
        if (W.crossing || W.kind === 1) crossing.push([x, z])
        n++
      }
    }
    shown.length = n
    if (held.size > 600) for (const [seed, a] of held) if (seconds - a.at > 5) held.delete(seed)
    peopleMs += (performance.now() - t0 - peopleMs) * 0.1
    return shown
  }

  // ── The kept vehicles ──
  const models = new Map<string, Promise<Model | null>>(), ready = new Map<string, Model>()
  let library: { id: string; kind: string }[] = []
  void fetch(new URL('index.json', o.cars)).then((r) => r.json()).then((l) => { library = l.cars; for (const c of library) model(c.id) }, () => {})
  const model = (id: string) => {
    let m = models.get(id)
    if (!m) models.set(id, m = fetch(new URL(`${id}.json`, o.cars)).then((r) => (r.ok ? r.json() : null)).then((m: Omit<Model, 'id' | 'front' | 'long' | 'wide'> | null) => {
      if (!m) return null
      const front = m.motor?.front ?? 0, done = { ...m, id, front, long: (front < 2 ? m.size[0] : m.size[2]), wide: (front < 2 ? m.size[2] : m.size[0]) }
      ready.set(id, done)
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
  maker.onmessage = (e: MessageEvent<{ key: string; faces: Uint32Array<ArrayBuffer>; filled: number }>) => { asking--; const look = lookOf(e.data.key); if (look) faces.set(e.data.key, { id: 0, cells: e.data.filled, size: look.size, com: [0, 0, 0], low: [0, 0, 0], faces: e.data.faces }) }
  const lookOf = (key: string) => { const [id, , i] = key.split('/'); return ready.get(id)?.looks[Number(i)] }
  const bornOf = (m: Model, paint: number, i: number): Born | null => {
    const key = `${m.id}/${paint}/${i}`, f = faces.get(key)
    if (f && f !== 'asked') return f
    if (!f && asking < 2) { faces.set(key, 'asked'); asking++; const l = m.looks[i]; maker.postMessage({ key, runs: l.runs, kinds: paint >= 0 ? m.variants[paint].looks[i] : l.palette, size: l.size }) }
    return null
  }

  // ── Placing a vehicle ──
  /** The turn of a vehicle heading a way (radians: its front at cos, 0, sin) with its nose up by `pitch`. */
  const turnOf = (m: Model, heading: number, pitch: number): [number, number, number, number] => {
    // Its own front: +x (0), -x (1), +z (2), -z (3); turned about y so that front is the heading, then pitched about its own side.
    const own = [0, Math.PI, -Math.PI / 2, Math.PI / 2][m.front], yaw = own - heading
    const p = m.front === 1 ? -pitch : m.front === 0 ? pitch : 0, r = m.front === 2 ? pitch : m.front === 3 ? -pitch : 0
    const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], qz = [0, 0, Math.sin(p / 2), Math.cos(p / 2)], qx = [Math.sin(r / 2), 0, 0, Math.cos(r / 2)]
    const mul = (a: number[], b: number[]) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]
    const q = mul(mul(qy, qz), qx)
    return [q[0], q[1], q[2], q[3]]
  }
  const rotate = (q: readonly number[], v: readonly number[]) => {
    const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
  }
  /** Sets a car on the road under a point: its height from the ground under its front and back wheels, its nose up the hill. */
  const settle = (c: Car) => {
    const hl = c.model.long * 0.32, fx = Math.cos(c.heading), fz = Math.sin(c.heading)
    const front = feetAt(c.x + fx * hl, c.z + fz * hl), back = feetAt(c.x - fx * hl, c.z - fz * hl)
    c.y = (front + back) / 2 - 0.5
    c.pitch = Math.atan2(front - back, 2 * hl)
  }
  const drawn = new Set<Car>()
  const show = (c: Car, view: View) => {
    const d = Math.hypot(c.x - view.eye[0], c.y - view.eye[1], c.z - view.eye[2])
    const lod = lods(c.model)
    let want = -1
    if (d < DRAWN && !c.thing) {
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
    if (!born) { if (c.piece) { c.piece.destroy(); c.piece = null; c.shown = ''; drawn.delete(c) } return }
    if (c.shown !== key || !c.piece) { c.piece?.destroy(); c.piece = o.pieces.add(born, true); c.shown = key; drawn.add(c) }
    const look = c.model.looks[Number(key)], q = turnOf(c.model, c.heading, c.pitch)
    // Its look's low corner, from the middle of its foot.
    const off = rotate(q, [look.low[0] - c.model.size[0] / 2, look.low[1], look.low[2] - c.model.size[2] / 2])
    c.piece.born.com = [0, 0, 0]
    c.piece.pos = [c.x + off[0], c.y + off[1], c.z + off[2]]
    c.piece.rot = q
    c.piece.cell = 1 / look.per
  }
  const hide = (c: Car) => { c.piece?.destroy(); c.piece = null; c.shown = ''; drawn.delete(c) }

  // ── Parked ──
  const parked = new Map<number, Car>(), gone = new Set<number>()
  let ids = 1
  const carModels = () => library.filter((c) => c.kind === 'car').map((c) => ready.get(c.id)).filter((m): m is Model => !!m)
  /** What drives a road: under trolley wires one in five is a trolleybus, on a main street one in ten a bus, and off the small streets a van or a truck now and then. */
  const mixOf = (r: Road, cars: Model[]): Model => {
    const roll = random(), get = (id: string) => ready.get(id)
    if (r.wired && roll < 0.2 && get('trolley')) return get('trolley')!
    if (r.cls >= 3 && roll < 0.1 && get('bus')) return get('bus')!
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
        if (parked.has(i) || chance(s.seed, 3) >= parkedFill(s, hour)) continue
        const m = cars[Math.floor(chance(s.seed, 4) * cars.length)], paint = chance(s.seed, 5) < 0.3 ? -1 : Math.floor(chance(s.seed, 6) * m.variants.length)
        const c: Car = { id: ids++, model: m, paint, kind: 'parked', seed: s.seed, x: s.x, y: 0, z: s.z, heading: s.yaw, pitch: 0, v: 0, piece: null, shown: '', slot: i }
        settle(c)
        // Not on a roof or a stair (the footing there is not the street's), and not in what the survey left standing at the kerb.
        const g = o.land.ground_at(Math.round(s.x), Math.round(s.z))
        if (c.y - g > 8 || Math.abs(c.pitch) > 0.3) { gone.add(i); continue }
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
   * the speed it is given once it lives (thrown by a blast).
   */
  const wake = async (c: Car, o2: { inside: boolean; push?: readonly [number, number, number]; then?: (t: Thing) => void }): Promise<boolean> => {
    const motor = c.model.motor
    if (c.thing || c.waking || !motor) return !!c.thing
    const m = c.model, outside = new Set(lods(m).map((x) => x.i))
    const parts = m.looks.map((l, i) => ({ l, i })).filter(({ l, i }) => l.per >= 4 && (o2.inside || outside.has(i)))
    const made = parts.map(({ i }) => bornOf(m, c.paint, i))
    if (made.some((b) => !b)) return false
    c.waking = true
    const kinds = c.paint >= 0 ? m.variants[c.paint].body : m.body.palette
    const body = unrun(m.body.runs, m.size[0] * m.size[1] * m.size[2], kinds)
    const fine = parts.map(({ l, i }, k) => { const cells = fineCells(m, c.paint, i); o.faces?.(cells, l.size, made[k]!); return { size: l.size, per: l.per, low: l.low, cells } })
    const low: [number, number, number] = [Math.round(c.x - m.size[0] / 2), Math.round(c.y) + 4, Math.round(c.z - m.size[2] / 2)]
    const thing = await o.alive.spawn({ name: m.name, cells: Int32Array.from(body), size: m.size, low, motor, controls: m.controls ?? 'drive', seats: m.seats, eye: m.eye, fine })
    c.waking = false
    if (!thing.alive) return false
    // Turned as it stood: its middle where it was, a little over the road, still.
    const at = o.alive.where(thing), com = at ? [at.at[0] - low[0], at.at[1] - low[1], at.at[2] - low[2]] : [m.size[0] / 2, m.size[1] / 3, m.size[2] / 2]
    const q = turnOf(m, c.heading, c.pitch), off = rotate(q, [com[0] - m.size[0] / 2, com[1], com[2] - m.size[2] / 2])
    o.alive.place(thing, [c.x + off[0], c.y + off[1] + 1, c.z + off[2]], q)
    if (o2.push) { o.alive.kick(thing, o2.push); c.thrown = true }
    c.thing = thing
    pending.delete(c)
    hide(c)
    living.add(c)
    o2.then?.(thing)
    return true
  }
  /** Cars on their way to life, drawn where they stand meanwhile, and asked again each frame. */
  const pending = new Map<Car, { inside: boolean; push?: readonly [number, number, number]; then?: (t: Thing) => void }>()
  /** A look's cells in a colour, made once and kept: the page's faces for a look are kept by its cells (main.ts), so a second car of a kind makes nothing. */
  const fineKept = new Map<string, Uint16Array>()
  const fineCells = (m: Model, paint: number, i: number) => {
    const key = `${m.id}/${paint}/${i}`
    let k = fineKept.get(key)
    if (!k) { const l = m.looks[i]; if (fineKept.size >= 8) fineKept.delete(fineKept.keys().next().value!); fineKept.set(key, k = unrun(l.runs, l.size[0] * l.size[1] * l.size[2], paint >= 0 ? m.variants[paint].looks[i] : l.palette)) }
    return k
  }
  /** Lets a living car go back to being drawn where it stands, if it was never moved and nobody is near it. */
  const sleep = (c: Car) => {
    if (!c.thing) return
    o.alive.vanish(c.thing)
    c.thing = null
    living.delete(c)
  }
  const reachable = (feet: readonly number[] | null) => {
    for (const c of living) {
      if (!c.thing) { living.delete(c); continue }
      const w = c.thing.alive ? o.alive.where(c.thing) : null
      if (!w) { c.thing = null; living.delete(c); if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot) } continue }
      if (c.thrown) { if (lastEye && Math.hypot(w.at[0] - lastEye[0], w.at[2] - lastEye[2]) > DRIVEN * 1.5) sleep(c); continue }
      const moved = Math.hypot(w.at[0] - c.x, w.at[2] - c.z) > 25
      if (moved || o.alive.riding === c.thing) { if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot); c.slot = undefined } continue }
      if (!feet || Math.hypot(w.at[0] - feet[0], w.at[2] - feet[2]) > 260) sleep(c)
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
  const laneOff = (r: Road, lane: number) => (r.flags & 1 ? (lane - (r.lanes - 1) / 2) * 33 : (lane + 0.5) * 33)
  /** A lane's middle at a distance along a road. */
  const lanePoint = (r: Road, lane: number, s: number, into: { x: number; z: number; tx: number; tz: number }) => { along(r.p, r.cum, s, into); const off = laneOff(r, Math.min(lane, r.lanes - 1)); into.x -= into.tz * off; into.z += into.tx * off }
  /** Whether cars may go along a road: not where its line runs under a roof (a tunnel, or a building over it: the footing there is the roof's). */
  /** How many roads may be looked over in a frame: each costs a few dozen questions of the land. Unknown, a road is not taken this frame. */
  let probes = 0
  const open = (r: Road) => {
    if (r.open !== null) return r.open
    if (probes <= 0) return false
    probes--
    let ok = true
    for (let s = 0; s <= r.len && ok; s += 30) { along(r.p, r.cum, s, P); const f = o.land.feet_at(Math.round(P.x), Math.round(P.z)), g = o.land.ground_at(Math.round(P.x), Math.round(P.z)); if (f - g > 30) ok = false }
    r.open = ok
    return ok
  }
  /** The road a vehicle takes next at a road's end: liking a straight way and a wide one; a trolleybus keeps under its wires where it can, a bus to the main streets, a truck off the small ones. */
  const choose = (r: Road, kind = 'car'): Road | null => {
    let total = 0
    const options: [Road, number][] = []
    for (const k of r.next) {
      const n = roads.get(k)
      if (!n || !open(n)) continue
      along(r.p, r.cum, r.len, P); along(n.p, n.cum, 0, Q)
      const straight = P.tx * Q.tx + P.tz * Q.tz
      let like = (0.3 + Math.max(0, straight) * 2) * (n.flags & 4 ? 0.3 : 1) * (n.lanes)
      if (kind === 'trolley') like *= n.wired ? 50 : 0.02
      else if (kind === 'bus') like *= n.cls >= 3 ? 8 : n.cls === 2 ? 1 : 0.05
      else if (kind === 'truck') like *= n.cls >= 2 ? 3 : n.flags & 4 ? 0.02 : 0.5
      options.push([n, like]); total += like
    }
    if (!options.length) return null
    let pick = random() * total
    for (const [n, like] of options) { pick -= like; if (pick <= 0) return n }
    return options[options.length - 1][0]
  }
  /** Where a driving car is and which way it faces: along its lane, and round a corner on a curve from one road's lane to the next's. */
  const pose = (c: Car) => {
    const r = c.road!, s = c.s!, lane = c.lane!
    const bend = (from: Road, to: Road, u: number) => {
      const lf = Math.min(lane, from.lanes - 1), lt = Math.min(lane, to.lanes - 1), cf = Math.min(CURVE, from.len / 2), ct = Math.min(CURVE, to.len / 2)
      lanePoint(from, lf, from.len - cf, P); const ax = P.x, az = P.z
      lanePoint(from, lf, from.len, P); const ex = P.x, ez = P.z
      lanePoint(to, lt, 0, Q); const sx = Q.x, sz = Q.z
      lanePoint(to, lt, ct, Q); const bx = Q.x, bz = Q.z
      const cx = (ex + sx) / 2, cz = (ez + sz) / 2, v = 1 - u
      c.x = v * v * ax + 2 * u * v * cx + u * u * bx; c.z = v * v * az + 2 * u * v * cz + u * u * bz
      const dx = 2 * v * (cx - ax) + 2 * u * (bx - cx), dz = 2 * v * (cz - az) + 2 * u * (bz - cz)
      if (Math.hypot(dx, dz) > 1e-3) c.heading = Math.atan2(dz, dx)
    }
    const cf = Math.min(CURVE, r.len / 2)
    if (c.next && s > r.len - cf) bend(r, c.next, (s - (r.len - cf)) / (cf + Math.min(CURVE, c.next.len / 2)))
    else if (c.prev && s < Math.min(CURVE, r.len / 2)) { const cp = Math.min(CURVE, c.prev.len / 2), cr = Math.min(CURVE, r.len / 2); bend(c.prev, r, (cp + s) / (cp + cr)) }
    else { lanePoint(r, lane, s, P); c.x = P.x; c.z = P.z; c.heading = Math.atan2(P.tz, P.tx) }
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
    const main = [...ins].sort((a, b) => b.cls - a.cls || b.len - a.len)[0]
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
  const spawn = (view: View, any: boolean) => {
    const eye = view.eye, near: Road[] = [], seen = new Set<Road>()
    for (let gx = Math.floor((eye[0] - DRIVEN) / GRID); gx <= Math.floor((eye[0] + DRIVEN) / GRID); gx++) for (let gz = Math.floor((eye[2] - DRIVEN) / GRID); gz <= Math.floor((eye[2] + DRIVEN) / GRID); gz++) for (const r of roadGrid.get(cell(gx, gz)) ?? []) if (!seen.has(r)) { seen.add(r); near.push(r) }
    // How many cars the roads round here carry: each road's share by its length and how busy it is.
    let want = 0
    const shares: number[] = []
    for (const r of near) { const w = Math.hypot(r.mx - eye[0], r.mz - eye[2]) < DRIVEN ? r.len * r.weight : 0; want += w; shares.push(want) }
    const total = want
    want = Math.min(70, Math.round(want * hourly(TRAFFIC, o.hour())))
    const cars = carModels()
    if (!cars.length || !total) return
    for (let tries = 0; tries < (any ? 300 : 4) && traffic.length < want; tries++) {
      const pick = random() * total
      let lo = 0, hi = shares.length - 1
      while (lo < hi) { const m = (lo + hi) >> 1; if (shares[m] < pick) lo = m + 1; else hi = m }
      const r = near[lo]
      if (!r || !open(r)) continue
      const s = random() * r.len, lane = Math.floor(random() * r.lanes)
      lanePoint(r, lane, s, P)
      const d = Math.hypot(P.x - eye[0], P.z - eye[2])
      if (d > DRIVEN || (!any && (d < 1200 || !unseen(P.x, P.z, view)))) continue
      if (traffic.some((c) => c.road === r && c.lane === lane && Math.abs(c.s! - s) < 120)) continue
      const m = mixOf(r, cars), paint = !m.variants.length || random() < 0.3 ? -1 : Math.floor(random() * m.variants.length)
      const c: Car = { id: ids++, model: m, paint, kind: 'traffic', seed: ids, x: P.x, y: 0, z: P.z, heading: 0, pitch: 0, v: limit(r) * (0.5 + random() * 0.4), piece: null, shown: '', road: r, prev: null, next: null, lane, s, hold: null, stuck: 0 }
      c.next = choose(r, m.kind)
      pose(c)
      traffic.push(c)
    }
  }
  /** The things in the way of cars: other cars, people on crossings and anyone standing in a lane, living things, cable cars. */
  const obstacles: { x: number; z: number; long: number; wide: number; v: number; hx: number; hz: number; car?: Car }[] = []
  const drive = (dt: number, view: View, t: number) => {
    obstacles.length = 0
    for (const c of traffic) obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: c.v, hx: Math.cos(c.heading), hz: Math.sin(c.heading), car: c })
    // (Parked cars are at the kerb, out of every lane: a place inferred a little into one is passed, not queued behind for ever.)
    for (const c of [...cables, ...trams]) obstacles.push({ x: c.x, z: c.z, long: c.model.long / 2, wide: c.model.wide / 2, v: c.v, hx: Math.cos(c.heading), hz: Math.sin(c.heading), car: c })
    for (const t of o.alive.things) { const w = o.alive.where(t); if (w) obstacles.push({ x: w.at[0], z: w.at[2], long: Math.max(t.size[0], t.size[2]) / 2, wide: Math.min(t.size[0], t.size[2]) / 2, v: t.state ? Math.abs(t.state.speed ?? 0) : 0, hx: w.front[0], hz: w.front[2] }) }
    for (const [x, z] of crossing) obstacles.push({ x, z, long: 3, wide: 3, v: 0, hx: 1, hz: 0 })
    for (const b of o.bodies()) obstacles.push({ x: b[0], z: b[2], long: 3, wide: 3, v: 0, hx: 1, hz: 0 })
    for (let i = traffic.length - 1; i >= 0; i--) {
      const c = traffic[i], r = c.road!, hx = Math.cos(c.heading), hz = Math.sin(c.heading)
      let gap = Infinity, lead = 0, why = ''
      for (const ob of obstacles) {
        if (ob.car === c) continue
        const dx = ob.x - c.x, dz = ob.z - c.z
        if (Math.abs(dx) > 450 || Math.abs(dz) > 450) continue
        const ahead = dx * hx + dz * hz, across = Math.abs(dx * hz - dz * hx)
        // Whatever stands in its way: across from its middle line by less than the two of them are wide.
        const ext = Math.abs(ob.hx * hz - ob.hz * hx) * ob.long + Math.abs(ob.hx * hx + ob.hz * hz) * ob.wide
        if (ahead <= 0 || ahead > 400 || across > c.model.wide / 2 + ext * 0.9 + 2) continue
        // A vehicle coming the other way keeps to its own lane: waited for, two meeting at a corner would wait for ever.
        if (ob.long > 3 && ob.hx * hx + ob.hz * hz < -0.3) continue
        const g = ahead - c.model.long / 2 - (Math.abs(ob.hx * hx + ob.hz * hz) * ob.long + Math.abs(ob.hx * hz - ob.hz * hx) * ob.wide)
        if (g < gap) { gap = g; lead = ob.v * (ob.hx * hx + ob.hz * hz); why = ob.car ? 'car' : ob.long === 3 ? 'person' : 'vehicle' }
      }
      // At a junction of three ways or more: as its lights say, after a full stop at a sign, or by turns where nothing
      // controls it. Whoever crosses it holds it; those whose way crosses theirs wait at the line.
      const left = r.len - c.s!
      let held = false
      const line = (at: number, because: string) => { if (left - at < gap) { gap = left - at; lead = 0; why = because } held = true }
      if (left < 150 && busyJunction(r.b)) {
        const j = junctionOf(r.b)
        along(r.p, r.cum, r.len, P)
        const ax = P.tx, az = P.tz
        if (r.ctl >= 2) {
          // Lights: through on green; on amber only if it cannot stop short of the line.
          const light = lightFor(j, ax, az, t)
          if (light === 'red' || (light === 'amber' && left - 35 > (c.v * c.v) / (2 * BRAKE * 0.8))) line(35, 'lights')
        } else {
          if (r.ctl === 1 && c.stopped !== r.b) {
            // A stop sign: a full stop at the line first.
            if (c.v < 1.5 && left < 60) c.stopped = r.b
            else line(30, 'stop sign')
          }
          if (!held) {
            let h = holds.get(r.b)
            if (!h) holds.set(r.b, h = new Map())
            if (!h.has(c)) {
              let straight = true
              if (c.next) { along(c.next.p, c.next.cum, 0, Q); straight = ax * Q.tx + az * Q.tz > 0.8 }
              for (const k of h.keys()) if (!traffic.includes(k)) h.delete(k)
              // On the way with no sign where others have one, it goes and they wait: it only says it is crossing.
              const priority = j.stops && r.ctl === 0
              const clear = priority || [...h.values()].every((o) => straight && o.straight && Math.abs(o.ax * ax + o.az * az) > 0.8)
              // A sign's way yields to anyone on the way without one who is about to cross.
              const yielding = !priority && j.stops && !j.allway && traffic.some((o) => o !== c && o.road && o.road.b === r.b && o.road.ctl === 0 && o.road.len - o.s! < 200 && o.v > 5)
              // Waited long (whoever holds it is held up in turn): it goes when it can.
              if ((clear && !yielding) || (c.held ?? 0) > 25) h.set(c, { ax, az, straight })
              else line(30, 'its turn')
            }
          }
        }
      }
      if (!c.next && left < 200) { c.next = choose(r, c.model.kind); if (!c.next && left - 10 < gap) { gap = left - 10; lead = 0; why = 'end' } }
      // A turn is taken slowly; after a blast near it, not at all for a while.
      let v0 = limit(r)
      if (c.shaken && performance.now() / 1000 - c.shaken < 5) { v0 = 0.01; gap = Math.min(gap, 1); why = why || 'blast' }
      if (c.next && left < 200) { along(r.p, r.cum, r.len, P); along(c.next.p, c.next.cum, 0, Q); if (P.tx * Q.tx + P.tz * Q.tz < 0.8) v0 = Math.min(v0, 45) }
      const want = 25 + c.v * 1.3 + (c.v * (c.v - lead)) / (2 * Math.sqrt(GATHER * BRAKE))
      const acc = GATHER * (1 - (c.v / v0) ** 4 - (gap < Infinity ? (Math.max(0, want) / Math.max(1, gap)) ** 2 : 0))
      c.v = Math.max(0, Math.min(v0 * 1.05, c.v + Math.max(-BRAKE * 3, acc) * dt))
      if (gap < 5) c.v = Math.min(c.v, Math.max(0, gap) * 2)
      c.s! += c.v * dt
      // Waiting on a control is not being stuck: a red light outlasts every patience below.
      c.held = held && c.v < 2 ? (c.held ?? 0) + dt : 0
      c.stuck = c.v < 2 && !held ? c.stuck! + dt : 0
      c.wait = c.v < 2 ? why : ''
      // At the end of a road that goes nowhere it may (mapping ends there, or the way on is closed): it turns round.
      if (!c.next && c.stuck! > 4 && c.road!.len - c.s! < 40) {
        const back = roads.get(`${c.road!.way}/${c.road!.b}/${c.road!.a}`)
        if (back && open(back)) { c.prev = null; c.road = back; c.s = 0; c.lane = Math.min(c.lane!, back.lanes - 1); c.next = choose(back, c.model.kind); c.stuck = 0; letGo(c) }
      }
      while (c.s! >= c.road!.len) {
        if (!c.next) break
        c.s! -= c.road!.len
        c.prev = c.road!; c.road = c.next; c.lane = Math.min(c.lane!, c.road.lanes - 1); c.next = choose(c.road, c.model.kind)
      }
      // Past the junction it held by 8 m: it is free for the next.
      if (c.prev && c.s! > 80) { const h = holds.get(c.prev.b); if (h?.delete(c) && !h.size) holds.delete(c.prev.b) }
      const d = Math.hypot(c.x - view.eye[0], c.z - view.eye[2])
      // Gone where nobody sees: too far, at a road's end, or stuck a long while out of sight.
      if (d > DRIVEN * 1.25 || (!c.next && c.s! >= c.road!.len - 12 && unseen(c.x, c.z, view)) || (c.stuck! > 40 && unseen(c.x, c.z, view))) { letGo(c); hide(c); traffic.splice(i, 1); continue }
      // Someone held a junction a long time without moving (a person stands in front of them): let it go.
      if (c.stuck! > 6) letGo(c)
      pose(c)
    }
  }

  // ── Cable cars: a rule of the line and the clock ──
  const cables: Car[] = []
  const cableCars = (t: number, view: View) => {
    const m = ready.get('cable-car')
    for (const c of cables) c.v = -1
    if (!m) return
    let n = 0
    for (const l of lines) {
      const count = Math.max(1, Math.floor(l.len / CABLE_APART))
      for (let k = 0; k < count; k++) {
        const s = ((t * CABLE_SPEED + k * (l.len / count) + chance(l.seed, 1) * l.len) % l.len + l.len) % l.len
        along(l.p, l.cum, s, P)
        if (Math.hypot(P.x - view.eye[0], P.z - view.eye[2]) > DRAWN) continue
        const c = (cables[n] ??= { id: ids++, model: m, paint: -1, kind: 'cable', seed: n, x: 0, y: 0, z: 0, heading: 0, pitch: 0, v: 0, piece: null, shown: '' })
        // It stops for nothing on a short line's turn: the car is at either end at most a moment.
        c.x = P.x; c.z = P.z; c.heading = Math.atan2(P.tz, P.tx); c.v = CABLE_SPEED
        settle(c)
        n++
      }
    }
    for (let i = cables.length - 1; i >= n; i--) { hide(cables[i]); cables.pop() }
  }

  // ── Streetcars: driven along their routes, stopping at lights, behind cars and for whatever stands on the rails ──
  const trams: Car[] = []
  const TRAM_APART = 8000, TRAM_SPEED = 100
  /** The lights a line passes: junctions with lights within 10 m of it, where along it, and which way it goes there. */
  const lightsOf = (l: (typeof tramLines)[number]) => {
    if (l.lights.length) return l.lights
    const seen = new Set<number>()
    for (let s = 0; s < l.len; s += 40) {
      along(l.p, l.cum, s, P)
      for (const r of roadGrid.get(cell(Math.floor(P.x / GRID), Math.floor(P.z / GRID))) ?? []) {
        if (r.ctl < 2 || seen.has(r.b)) continue
        const j = junctionOf(r.b)
        if (Math.hypot(j.x - P.x, j.z - P.z) < 100) { seen.add(r.b); l.lights.push({ s: Math.max(0, s - 60), node: r.b, dx: P.tx, dz: P.tz }) }
      }
    }
    l.lights.sort((a, b) => a.s - b.s)
    return l.lights
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
        const c: Car = { id: ids++, model: m, paint: -1, kind: 'tram', seed: ids, x: P.x, y: 0, z: P.z, heading: Math.atan2(P.tz, P.tx), pitch: 0, v: TRAM_SPEED * 0.6, piece: null, shown: '', track: l, s, stuck: 0 }
        settle(c); trams.push(c); k++
      }
    }
    for (let i = trams.length - 1; i >= 0; i--) {
      const c = trams[i], l = c.track!, hx = Math.cos(c.heading), hz = Math.sin(c.heading)
      let gap = Infinity, lead = 0, held = false
      for (const ob of obstacles) {
        if (ob.car === c) continue
        const dx = ob.x - c.x, dz = ob.z - c.z
        if (Math.abs(dx) > 500 || Math.abs(dz) > 500) continue
        const ahead = dx * hx + dz * hz, across = Math.abs(dx * hz - dz * hx)
        if (ahead <= 0 || ahead > 500 || across > c.model.wide / 2 + ob.wide + 2) continue
        if (ob.long > 3 && ob.hx * hx + ob.hz * hz < -0.3) continue
        const g = ahead - c.model.long / 2 - ob.long
        if (g < gap) { gap = g; lead = ob.v * (ob.hx * hx + ob.hz * hz) }
      }
      for (const L of lightsOf(l)) {
        const left = L.s - c.s!
        if (left < 0 || left > 250) continue
        const light = lightFor(junctionOf(L.node), L.dx, L.dz, t)
        if (light === 'red' || (light === 'amber' && left > (c.v * c.v) / (2 * BRAKE * 0.6))) { if (left < gap) { gap = left; lead = 0 } held = true }
        break
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

  // ── Blasts ──
  /** How many of the shocks this has answered. A blast throws the few cars nearest it (they come to life, pushed away from it) and stops the traffic round it a while. */
  let heard = o.shocks.length
  const shaken = (view: View) => {
    if (o.shocks.length < heard) heard = 0
    for (; heard < o.shocks.length; heard++) {
      const s = o.shocks[heard], reach = s.radius * 3 + 40, now = performance.now() / 1000
      const near = [...parked.values(), ...traffic].filter((c) => !c.thing && !!c.model.motor && Math.hypot(c.x - s.at[0], c.z - s.at[2]) < reach && Math.abs(c.y - s.at[1]) < reach).sort((a, b) => Math.hypot(a.x - s.at[0], a.z - s.at[2]) - Math.hypot(b.x - s.at[0], b.z - s.at[2])).slice(0, 3)
      for (const c of near) {
        const dx = c.x - s.at[0], dz = c.z - s.at[2], d = Math.hypot(dx, dz) || 1, k = 1 - d / reach
        if (c.kind === 'traffic') { traffic.splice(traffic.indexOf(c), 1); letGo(c); c.kind = 'parked' }
        if (c.slot !== undefined) { gone.add(c.slot); parked.delete(c.slot); c.slot = undefined }
        pending.set(c, { inside: false, push: [(dx / d) * 160 * k, 60 + 80 * k, (dz / d) * 160 * k] })
      }
      for (const c of traffic) if (Math.hypot(c.x - s.at[0], c.z - s.at[2]) < 800) c.shaken = now
    }
    void view
  }

  // ── Taking a car that stops beside someone ──
  let cue: { car: Car; remove(): void } | null = null, beside: (() => void) | null = null
  const offer = (feet: readonly number[] | null) => {
    let best: Car | null = null, far = 45
    if (feet && !o.alive.riding && !o.alive.near) for (const c of traffic) { if (!c.model.motor) continue; const d = Math.hypot(c.x - feet[0], c.z - feet[2]) - c.model.long / 2; if (c.v < 25 && d < far) { far = d; best = c } }
    if (cue && cue.car !== best) { cue.remove(); cue = null; beside?.(); beside = null }
    if (!best || cue) return
    const car = best
    const takeIt = () => {
      if (!traffic.includes(car)) return
      traffic.splice(traffic.indexOf(car), 1)
      letGo(car)
      car.kind = 'parked'
      pending.set(car, { inside: true, then: (thing) => o.alive.mount(thing) })
      cue?.remove(); cue = null; beside?.(); beside = null
    }
    cue = { car, remove: o.hud.cue(`E  Take the ${car.model.name}`, () => [car.x, car.y + car.model.size[1] + 4, car.z], takeIt).remove }
    beside = o.input.push({ name: 'take', key: (code) => { if (code !== 'KeyE') return false; takeIt(); return true } })
  }

  let ms = 0, on = true
  const self: Street = {
    folk,
    frame(dt, view) {
      if (!on) { for (const c of [...parked.values(), ...traffic, ...cables]) hide(c); return }
      const t0 = performance.now(), eye = view.eye
      wanted(eye)
      probes = filled ? 8 : 400
      // Moved far at once (a jump, a portal, the checks): the traffic round the new place is there already.
      if (lastEye && Math.hypot(eye[0] - lastEye[0], eye[2] - lastEye[2]) > 1500) { for (const c of [...traffic, ...trams]) hide(c); traffic.length = 0; trams.length = 0; holds.clear(); filled = false }
      lastEye = [eye[0], eye[1], eye[2]]
      park(eye, o.hour())
      if (roads.size && ready.size) { spawn(view, !filled); filled = true }
      drive(dt, view, o.clock())
      tramsDrive(dt, view, o.clock(), !trams.length)
      cableCars(o.clock(), view)
      const feet = o.feet()
      shaken(view)
      for (const [c, how] of pending) void wake(c, how)
      reachable(feet)
      offer(feet)
      for (const c of parked.values()) show(c, view)
      for (const c of traffic) show(c, view)
      for (const c of cables) show(c, view)
      for (const c of trams) show(c, view)
      for (const c of showcase) show(c, view)
      for (const c of pending.keys()) show(c, view)
      ms += (performance.now() - t0 - ms) * 0.1
    },
    reset() {
      for (const c of [...traffic, ...parked.values(), ...cables]) hide(c)
      for (const c of trams) hide(c)
      traffic.length = 0; trams.length = 0; parked.clear(); gone.clear(); holds.clear(); living.clear(); cables.length = 0; pending.clear(); heard = o.shocks.length
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
      const v = [...parked.values(), ...traffic, ...cables, ...trams].filter((c) => within(c.x, c.z))
      return {
        people: people.length, peopleSeen: people.filter((p) => seen(p.at[0], p.at[1] + 9, p.at[2])).length,
        parked: v.filter((c) => c.kind === 'parked').length, traffic: v.filter((c) => c.kind === 'traffic').length, cable: v.filter((c) => c.kind === 'cable').length, tram: v.filter((c) => c.kind === 'tram').length,
        bus: v.filter((c) => c.model.kind === 'bus').length, trolley: v.filter((c) => c.model.kind === 'trolley').length, van: v.filter((c) => c.model.kind === 'van').length, truck: v.filter((c) => c.model.kind === 'truck').length,
        waiting: shown.filter((p) => within(p.at[0], p.at[2]) && (p as { waiting?: boolean }).waiting).length,
        // On a crossing with lights while their way is red (not green, not its amber): what the walking signs forbid.
        crossingRed: shown.filter((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }; if (!q.sig || !within(p.at[0], p.at[2])) return false; const j = junctionOf(q.sig); return lightFor(j, q.cdx!, q.cdz!, o.clock()) === 'red' }).length,
        crossingLights: shown.filter((p) => within(p.at[0], p.at[2]) && (p as { sig?: number }).sig).length,
        vehiclesSeen: v.filter((c) => seen(c.x, c.y + 7, c.z)).length, living: living.size,
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
      return [...parked.values(), ...traffic, ...cables, ...trams].filter((c) => Math.hypot(c.x - x, c.z - z) < r).map((c) => ({ kind: c.kind, model: c.model.kind, x: c.x, y: c.y, z: c.z, heading: c.heading, name: c.model.name, v: c.v, living: !!c.thing, wait: c.wait ?? '', stuck: c.stuck ?? 0 }))
    },
    cable(x, z) {
      let best: { in: number; near: number } | null = null
      const t = o.clock()
      for (const l of lines) {
        // The nearest point of the line, then when each of its cars is there.
        let at = 0, near = Infinity
        for (let s = 0; s <= l.len; s += 20) { along(l.p, l.cum, s, P); const d = Math.hypot(P.x - x, P.z - z); if (d < near) { near = d; at = s } }
        const count = Math.max(1, Math.floor(l.len / CABLE_APART))
        for (let k = 0; k < count; k++) {
          const start = k * (l.len / count) + chance(l.seed, 1) * l.len, now = (((t * CABLE_SPEED + start) % l.len) + l.len) % l.len
          const wait = (((at - now) % l.len) + l.len) % l.len / CABLE_SPEED
          if (!best || near < best.near - 50 || (Math.abs(near - best.near) <= 50 && wait < best.in)) best = { in: wait, near }
        }
      }
      return best
    },
    get debug() { return { pending: [...pending.keys()].map((c) => ({ name: c.model.name, waking: !!c.waking, thing: !!c.thing })), living: living.size, faces: [...faces.entries()].map(([k, v]) => `${k}:${v === 'asked' ? 'asked' : 'made'}`), asking } },
    get red() { return shown.filter((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }; return q.sig && lightFor(junctionOf(q.sig), q.cdx!, q.cdz!, o.clock()) === 'red' }).map((p) => { const q = p as { sig?: number; cdx?: number; cdz?: number }, j = junctionOf(q.sig!); return { seed: p.seed, node: q.sig, u: Math.round(cycleAt(j, o.clock())), phase: phaseOf(j, q.cdx!, q.cdz!), axis: [j.ax, j.az].map((v) => Math.round(v * 100) / 100), dir: [q.cdx!, q.cdz!].map((v) => Math.round(v * 100) / 100), at: [Math.round(p.at[0]), Math.round(p.at[2])], jat: [Math.round(j.x), Math.round(j.z)] } }) },
    lineup(at, heading = 0) {
      for (const c of showcase) hide(c)
      showcase.length = 0
      if (!at) return []
      let along = 0
      const fx = Math.cos(heading), fz = Math.sin(heading)
      for (const m of library.map((c) => ready.get(c.id)).filter((m): m is Model => !!m)) {
        const c: Car = { id: ids++, model: m, paint: -1, kind: 'parked', seed: ids, x: at[0] + fx * (along + m.long / 2), y: 0, z: at[1] + fz * (along + m.long / 2), heading, pitch: 0, v: 0, piece: null, shown: '' }
        settle(c); showcase.push(c); along += m.long + 15
      }
      return showcase.map((c) => c.model.name)
    },
    get enabled() { return on },
    set enabled(v: boolean) { on = v },
    get ms() { return ms + peopleMs },
    get ready() { return roads.size > 0 && ready.size > 0 },
  }
  return self
}
