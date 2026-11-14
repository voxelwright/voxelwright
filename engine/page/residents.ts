// The town's residents (#218): who is out on the pavements, and where, by rule from place and time.
// Nothing is kept and nothing is sent: any page and the world process, asked about the same block at
// the same moment, name the same people in the same places. Each lives on the pavements round one
// block: they walk its four sides in one of two lanes that the street's trees, lamps and hydrants
// leave clear (city.rs puts those 16 cells and more from the houses' side; the lanes are about 6 and 10),
// one lane each way, and stop here and there to stand, step aside and look at a phone or the street.
// When something is blown up near them they are not targets: those close are thrown off their feet,
// lie a few seconds and get up; those further off shrink from it; then all of them hurry on until
// they are where they would have been. Nobody is hurt and nobody is gone.
// And they stand about wherever a block's own ground is paved and nothing stands on it (a towers' block today, a
// square when there is one): the rule asks the land, it has no list of places.
// Lengths are the world's finest cells; time is seconds on a clock everyone shares.

/** What the rule asks of the land (the core's exports): how high feet stand at a column, and what sort of block it is in (0 open, 1 shore, 2 park, 3 homes, 4 towers, 5 yard; 8 more where it is paved). */
export interface Land { feet_at(x: number, z: number): number; paving_at(x: number, z: number): number; world_kind(x: number, y: number, z: number): number }

/** A resident at a moment. Everything a figure needs (people.ts Person) but an umbrella's being up and the time, which are the page's own. */
export interface Resident {
  /** Which resident: the same number always, anywhere. */
  seed: number
  at: [number, number, number]
  yaw: number
  stride: number
  walking: number
  reading: number
  /** Whether they carry an umbrella: it is up where it rains. */
  carries: boolean
  /** 0 to 1: shrunk from a blast near them; and 0 to 1: knocked off their feet by one, lying. */
  flinch: number
  down: number
  /** Which block they live round and which of its people they are: enough to ask the rule about this one alone (`whereabouts`). */
  home: [number, number, number]
}

/** Something that broke with a bang: where, how big (a blast's radius in cells), and when on the shared clock. */
export interface Shock { at: readonly [number, number, number]; radius: number; t: number }

/** A block of the town (city.rs BLOCK_X, BLOCK_Z, STREET). */
const BLOCK_X = 1280, BLOCK_Z = 800, STREET = 140
/** How many live round a block of each sort. */
const LIVE = [0, 0, 24, 40, 64, 16]
/** How long a pair of steps is (people.ts STRIDE): the feet stay where they are put. */
const STRIDE = 14.4

/** A number from 0 to 1 that is always the same for the same seed and the same question. */
export const chance = (seed: number, ask: number) => { let h = Math.imul(seed ^ Math.imul(ask, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
const mix = (a: number, b: number, c: number) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) | 0

/** What share of a block's residents are out at an hour of the day: few at night, most on the way to work and home. */
export function out(hour: number): number {
  const H = [0.1, 0.07, 0.05, 0.05, 0.07, 0.15, 0.4, 0.8, 1, 0.85, 0.75, 0.8, 0.95, 0.9, 0.75, 0.75, 0.85, 1, 1, 0.9, 0.7, 0.5, 0.32, 0.18]
  const h = ((hour % 24) + 24) % 24, a = Math.floor(h)
  return H[a] + (H[(a + 1) % 24] - H[a]) * (h - a)
}

/** The two lanes, as cells out from the lots on each of a block's four sides (low z, high x, high z, low x). No line
 * along a street is clear of everything for ten blocks (boughs, bays and shops' boards hang at head height); these
 * are the clearest by count: in one sample in a thousand somebody's head brushes something. */
const LANES = [[6, 6, 5, 6], [9, 10, 9, 10]]
/** How far from a corner each lane leaves the straight to cut across it: a lamp stands at each corner of a crossing
 * (city.rs), on the outer lane's own line, and the lots' corner is as near again on the other side. */
const CUTS = [6, 12]
const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]]
/** A place on the walk round a block, `s` cells along it from its low corner, in a lane. Also which way the walk runs there and which way the lots are. */
function along(x0: number, z0: number, lane: number, s: number, into: { x: number; z: number; dx: number; dz: number; ix: number; iz: number }) {
  const d = LANES[lane], CUT = CUTS[lane]
  const xa = x0 + STREET - d[3], xb = x0 + BLOCK_X + d[1], za = z0 + STREET - d[0], zb = z0 + BLOCK_Z + d[2], w = xb - xa, h = zb - za
  const side = s < w ? 0 : s < w + h ? 1 : s < 2 * w + h ? 2 : 3, a = s - [0, w, w + h, 2 * w + h][side], long = side & 1 ? h : w
  const corner = (k: number) => [k === 1 || k === 2 ? xb : xa, k >= 2 ? zb : za]
  const [dx, dz] = SIDES[side]
  into.dx = dx; into.dz = dz; into.ix = -dz; into.iz = dx
  // Past a corner or coming to the next: across from one street's lane to the other's in a straight line.
  const q = a < CUT ? a : long - a < CUT ? a - long : null
  if (q === null) { const k = corner(side); into.x = k[0] + dx * a; into.z = k[1] + dz * a; return }
  const k = corner((side + (q < 0 ? 1 : 0)) & 3), before = SIDES[(side + (q < 0 ? 0 : 3)) & 3], after = SIDES[(side + (q < 0 ? 1 : 0)) & 3], f = (q + CUT) / (2 * CUT)
  into.x = k[0] - before[0] * CUT * (1 - f) + after[0] * CUT * f
  into.z = k[1] - before[1] * CUT * (1 - f) + after[1] * CUT * f
}
const A = { x: 0, z: 0, dx: 0, dz: 0, ix: 0, iz: 0 }, B = { ...A }, C = { ...A }
const ease = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c) }
/** How long after a bang it still moves anyone, seconds: by then all have caught up with where they would have been. */
const SHAKEN = 45

/** One resident's walk at a moment, before anything startles them: where, heading, and what they are doing. */
const W = { x: 0, z: 0, hx: 0, hz: 1, s: 0, still: false, moving: 0, aside: 0, ix: 0, iz: 0 }
function walk(x0: number, z0: number, seed: number, t: number) {
  // Keep right: the lane nearer the houses goes round one way, the other the other.
  const inner = chance(seed, 21) < 0.5, lane = inner ? 0 : 1, d = LANES[lane]
  const round = 2 * (BLOCK_X - STREET + d[1] + d[3] + BLOCK_Z - STREET + d[0] + d[2])
  const speed = 11 + 4 * chance(seed, 22)
  // Two places on the way round where they stop, and for how long: most for a little while, one in six for
  // minutes (someone waiting), one in four not at all.
  const sort = chance(seed, 23)
  const stay = sort < 0.25 ? 0 : sort > 0.84 ? 240 : 30
  const s1 = chance(seed, 24) * round * 0.5, s2 = (0.5 + chance(seed, 25) * 0.5) * round
  const d1 = stay * (0.5 + chance(seed, 26)), d2 = stay * (0.5 + chance(seed, 27))
  const whole = round / speed + d1 + d2
  let tm = (t + chance(seed, 28) * whole) % whole
  if (tm < 0) tm += whole
  // How far round they are, and how long since they last stood still or until they next do (seconds).
  let s = 0, still = false, moving = 1e9, aside = 0
  const t1 = s1 / speed, t2 = t1 + d1 + (s2 - s1) / speed
  if (tm < t1) { s = tm * speed; moving = Math.min(stay ? tm : 1e9, stay ? t1 - tm : 1e9) }
  else if (tm < t1 + d1) { s = s1; still = true; aside = Math.min(tm - t1, t1 + d1 - tm) }
  else if (tm < t2) { s = s1 + (tm - t1 - d1) * speed; moving = Math.min(tm - t1 - d1, t2 - tm) }
  else if (tm < t2 + d2) { s = s2; still = true; aside = Math.min(tm - t2, t2 + d2 - tm) }
  else { s = s2 + (tm - t2 - d2) * speed; moving = stay ? tm - t2 - d2 : 1e9 }
  // Round the other way in the outer lane.
  const way = inner ? 1 : -1, at = way > 0 ? s : round - s
  along(x0, z0, lane, at, A)
  // A corner is turned over a few steps, not on the spot: the heading is from a little behind to a little ahead.
  along(x0, z0, lane, (at - 5 + round) % round, B)
  along(x0, z0, lane, (at + 5) % round, C)
  W.hx = (C.x - B.x) * way; W.hz = (C.z - B.z) * way
  W.x = A.x; W.z = A.z; W.s = s; W.still = still; W.moving = moving; W.aside = aside; W.ix = A.ix; W.iz = A.iz
  if (still) {
    // Standing: out of the way (the lane by the houses has no room to step into, the other has two cells towards
    // the kerb), turned to the street.
    const k = ease(aside / 1.4), step = inner ? 0 : -2
    W.x += A.ix * step * k; W.z += A.iz * step * k
    W.hx = W.hx * (1 - k) - A.ix * 10 * k; W.hz = W.hz * (1 - k) - A.iz * 10 * k
  }
}

/** What the last bang that reached someone at a place does to them now: they stop where they were when it went off
 * (down if it was close, shrinking if not), then make up the time at a hurry. `where` puts them where they were at a second. */
const S = { when: 0, down: 0, flinch: 0, towards: 0, turned: 0, frozen: false }
function startle(land: Land, seed: number, t: number, shocks: readonly Shock[], where: (t: number) => void) {
  S.when = t; S.down = 0; S.flinch = 0; S.towards = 0; S.turned = 0; S.frozen = false
  for (let k = shocks.length - 1; k >= 0; k--) {
    const shock = shocks[k], age = t - shock.t
    if (age < 0 || age > SHAKEN) continue
    where(shock.t)
    const far = Math.hypot(W.x - shock.at[0], W.z - shock.at[2], land.feet_at(Math.round(W.x), Math.round(W.z)) + 9 - shock.at[1])
    const close = far < shock.radius * 2.5 + 10
    if (!close && far >= shock.radius * 6 + 60) continue
    const held = close ? 4.4 + 1.6 * chance(seed, 31) : 1.2 + 0.9 * chance(seed, 31)
    if (age < held) {
      S.when = shock.t; S.frozen = true
      if (close) { S.down = ease(age / 0.3) * (1 - ease((age - held + 1.4) / 1.4)); S.turned = ease(age / 0.3) }
      else S.flinch = ease(age / 0.12) * (1 - ease((age - held + 0.6) / 0.6))
      // Thrown onto the back, away from it: lying, they face where it came from.
      S.towards = Math.atan2(shock.at[0] - W.x, -(shock.at[2] - W.z))
    } else S.when = Math.min(t, shock.t + (age - held) * 1.7)
    return
  }
}

/** Places to stand in a block's own ground, where the rule paves it and nothing stands: found a few at a time (the
 * first cell asked of a sector costs a millisecond or more) and kept, for the rule gives the same ones always. */
const STOOD = new Map<string, { spots: [number, number, number][]; tried: number }>()
const TRIES = 24, STAND_MOST = 12
/** How many places may be tried in one asking of the rule: one, so that coming to a paved block costs a frame a few milliseconds for some seconds and never a long one (three a block in reach took 15 to 25 ms). */
let tries = 0
/** How high feet stand in a column as the land is made there, if what is under them is paving (concrete) with room over it for a body; else null. Lots are levelled for what is built on them, so the ground's own rule does not say. */
function paved(land: Land, x: number, z: number): number | null {
  const about = land.feet_at(x, z)
  if (land.world_kind(x, about + 12, z) !== 0) return null
  for (let y = about + 11; y > about - 60; y--) {
    const kind = land.world_kind(x, y, z)
    if (!kind) continue
    if ((kind & 15) !== 7) return null
    for (let up = about + 13; up < y + 20; up++) if (land.world_kind(x, up, z) !== 0) return null
    return y + 1
  }
  return null
}
function standing(land: Land, bx: number, bz: number): [number, number, number][] {
  const key = `${bx},${bz}`
  let found = STOOD.get(key)
  if (!found) { if (STOOD.size > 256) STOOD.clear(); STOOD.set(key, found = { spots: [], tried: 0 }) }
  for (; tries > 0 && found.tried < TRIES && found.spots.length < STAND_MOST; tries--) {
    const seed = mix(bx, bz, 5000 + found.tried++)
    const x = bx * BLOCK_X + STREET + 12 + Math.floor(chance(seed, 1) * (BLOCK_X - STREET - 24)), z = bz * BLOCK_Z + STREET + 12 + Math.floor(chance(seed, 2) * (BLOCK_Z - STREET - 24))
    // Paved and level, with room for a body and an arm's length each way.
    const feet = paved(land, x, z)
    if (feet === null || ![[3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dz]) => paved(land, x + dx, z + dz) === feet)) continue
    if (found.spots.every((s) => Math.hypot(s[0] - x, s[2] - z) > 12)) found.spots.push([x, feet, z])
  }
  return found.spots
}

/**
 * The residents out within `reach` cells of a place at second `t`, at an hour of the day, written over `into`
 * (which is kept and grown, not made again). `shocks` is what has gone off lately. `taken` is who is off their
 * round because a rule of the world has taken them as its own (they are somebody's actor meanwhile): left out. Returns how many.
 */
export function residents(land: Land, eye: readonly [number, number], reach: number, t: number, hour: number, into: Resident[], shocks: readonly Shock[] = [], taken?: { has(seed: number): boolean }): number {
  let n = 0
  const share = out(hour)
  tries = 1
  // A block's people are on the pavements round its lots, which reach a lane's width past its own corner.
  for (let bz = Math.floor((eye[1] - reach - 20) / BLOCK_Z); bz <= Math.floor((eye[1] + reach) / BLOCK_Z); bz++) {
    for (let bx = Math.floor((eye[0] - reach - 20) / BLOCK_X); bx <= Math.floor((eye[0] + reach) / BLOCK_X); bx++) {
      const x0 = bx * BLOCK_X, z0 = bz * BLOCK_Z
      const live = LIVE[land.paving_at(x0 + BLOCK_X / 2, z0 + (BLOCK_Z + STREET) / 2) & 7]
      for (let i = 0; i < live; i++) {
        const seed = mix(bx, bz, i)
        if (chance(seed, 20) >= share || taken?.has(seed)) continue
        if (shocks.length) startle(land, seed, t, shocks, (at) => walk(x0, z0, seed, at))
        else { S.when = t; S.down = 0; S.flinch = 0; S.turned = 0; S.frozen = false }
        const when = S.when, down = S.down, flinch = S.flinch, towards = S.towards, turned = S.turned, frozen = S.frozen
        walk(x0, z0, seed, when)
        if (Math.abs(W.x - eye[0]) > reach || Math.abs(W.z - eye[1]) > reach) continue
        const r = (into[n] ??= { seed: 0, at: [0, 0, 0], yaw: 0, stride: 0, walking: 0, reading: 0, carries: false, flinch: 0, down: 0, home: [0, 0, 0] })
        r.seed = seed; r.home[0] = bx; r.home[1] = bz; r.home[2] = i
        const x = W.x, z = W.z, long = Math.hypot(W.hx, W.hz) || 1, hx = W.hx / long, hz = W.hz / long
        r.at[0] = x; r.at[2] = z
        // A kerb is stepped over two steps, not jumped.
        r.at[1] = (land.feet_at(Math.round(x + hx * 2), Math.round(z + hz * 2)) + land.feet_at(Math.round(x - hx * 2), Math.round(z - hz * 2)) + land.feet_at(Math.round(x), Math.round(z))) / 3
        let yaw = Math.atan2(hx, -hz)
        if (turned) { let by = towards - yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; yaw += by * turned }
        r.yaw = yaw
        r.stride = W.s / STRIDE
        r.walking = W.still || frozen ? 0 : ease(W.moving / 0.7)
        // Some take out a phone once they have stood a moment.
        r.reading = W.still && chance(seed, 29) < 0.45 ? ease((W.aside - 1.5) / 1.2) : 0
        r.carries = chance(seed, 30) < 0.6
        r.flinch = flinch; r.down = down
        n++
      }
      // And those who stand about on the block's own paving, where it has any.
      if (!(land.paving_at(x0 + BLOCK_X / 2, z0 + (BLOCK_Z + STREET) / 2) & 8)) continue
      const spots = standing(land, bx, bz)
      for (let j = 0; j < spots.length; j++) {
        const seed = mix(bx, bz, 9000 + j), [x, feet, z] = spots[j]
        if (chance(seed, 20) >= share || taken?.has(seed) || Math.abs(x - eye[0]) > reach || Math.abs(z - eye[1]) > reach) continue
        if (shocks.length) startle(land, seed, t, shocks, () => { W.x = x; W.z = z })
        else { S.down = 0; S.flinch = 0; S.turned = 0 }
        const r = (into[n] ??= { seed: 0, at: [0, 0, 0], yaw: 0, stride: 0, walking: 0, reading: 0, carries: false, flinch: 0, down: 0, home: [0, 0, 0] })
        r.seed = seed; r.home[0] = bx; r.home[1] = bz; r.home[2] = 9000 + j
        r.at[0] = x; r.at[1] = feet; r.at[2] = z
        // Turned to whoever stands nearest, if they are near enough to be talking; else as they happen to stand.
        let yaw = chance(seed, 32) * Math.PI * 2, nearest = 60
        for (let k = 0; k < spots.length; k++) { const far = Math.hypot(spots[k][0] - x, spots[k][2] - z); if (k !== j && far < nearest) { nearest = far; yaw = Math.atan2(spots[k][0] - x, -(spots[k][2] - z)) } }
        if (S.turned) { let by = S.towards - yaw; by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2; yaw += by * S.turned }
        r.yaw = yaw; r.stride = 0; r.walking = 0
        r.reading = nearest >= 60 && chance(seed, 29) < 0.5 ? 1 : 0
        r.carries = chance(seed, 30) < 0.6
        r.flinch = S.flinch; r.down = S.down
        n++
      }
    }
  }
  return n
}

/**
 * Where one resident would be on their round at second `t`, whoever has them meanwhile: the place and the way they
 * face, or null if their place is not known here (someone who stands on a lot the rule has not looked over yet).
 */
export function whereabouts(land: Land, home: readonly [number, number, number], t: number): { at: [number, number, number]; yaw: number } | null {
  const [bx, bz, i] = home
  if (i >= 9000) { const spot = STOOD.get(`${bx},${bz}`)?.spots[i - 9000]; return spot ? { at: [spot[0], spot[1], spot[2]], yaw: 0 } : null }
  walk(bx * BLOCK_X, bz * BLOCK_Z, mix(bx, bz, i), t)
  return { at: [W.x, land.feet_at(Math.round(W.x), Math.round(W.z)), W.z], yaw: Math.atan2(W.hx, -W.hz) }
}
