// Living things on the page (#245): a thing that is a body for as long as it lives (the core's
// bodies/living.rs), that a person can get on and drive. The page decides nothing about how it
// moves: it says what the keys ask (go, turn, rise, roll, jump) again and again, and the solver's
// motor does the rest. A thing's motor and its control scheme are data, so a model can write
// them with the thing; nothing here is run.
import { AHEAD, clearWay, roomAfter, standsBy } from './eye.ts'
import { cockpit, type CockpitState } from './cockpit.ts'
import { VehicleDeformation, type DeformState } from './deform.ts'
import { createDriveCam, DRIVE_CAM_LABELS, nextDriveCam, type DriveCamMode } from './drive-cam.ts'
import { touchSteerCurve } from './gamepad.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Answer, Ask } from './mover.ts'
import type { Piece } from './pieces.ts'
import type { Placed, Struck, Told } from './told.ts'
import type { Link } from './link.ts'
import type { Things } from './things.ts'
import { carveWheelWells, type WheelProfile } from './wheels.ts'
import { sculptCoupe } from './car-sculpt.ts'
import { POLISHED } from './spells.ts'

/** A foot: where its ray starts (cells from the thing's own low corner), how far down it reaches, whether it steers and drives. */
export interface Foot { at: [number, number, number]; reach: number; steers?: boolean; drives?: boolean }
/**
 * How a thing moves, as the core's motor takes it. Lengths are cells (10 to a metre), times seconds.
 * `front` is which way it faces in its own cells (0 to 3: +x, -x, +z, -z); `power` how fast it gathers speed and
 * `top` the speed it gets to; `steer` how far steering feet turn (radians); `hover` the height it hangs at; `lift`
 * how fast it climbs; `upright` how firmly it is kept upright (0: left to roll); `turns` how fast it turns when it
 * is; `jump` the speed a jump gives; `tough` the loss of speed in one step that breaks it.
 */
export interface Motor { front: number; grip: number; power: number; top: number; steer: number; hover: number; lift: number; upright: number; turns: number; jump: number; tough: number; feet: Foot[] }
/** The motor's numbers in the order the core reads them. */
export const numbers = (m: Motor) => Float32Array.from([m.front, m.grip, m.power, m.top, m.steer, m.hover, m.lift, m.upright, m.turns, m.jump, m.tough, ...m.feet.flatMap((f) => [...f.at, f.reach, f.steers ? 1 : 0, f.drives ? 1 : 0])])

/** One line of a control scheme: the keys, how they are shown, what they are said to do, and what they tell the thing. */
export interface Binding { keys: string[]; shown: string; does: string; go?: number; turn?: number; rise?: number; once?: 'roll' | 'jump' | 'leave' }
/** A control scheme: data, one of a small standard set. Keys in the first place of `keys` push the thing's way one way, in the second the other. */
export interface Scheme { name: string; verb: string; lines: Binding[] }
const LEAVE: Binding = { keys: ['KeyE'], shown: 'E', does: 'get off', once: 'leave' }
const GO: Binding = { keys: ['KeyW', 'KeyS'], shown: 'W S', does: 'forward and back', go: 1 }
const TURN: Binding = { keys: ['KeyD', 'KeyA'], shown: 'A D', does: 'left and right', turn: 1 }
const DRIFT: Binding = { keys: ['Space'], shown: 'Space', does: 'drift', rise: 1 }
const RISE: Binding = { keys: ['Space', 'KeyC'], shown: 'Space C', does: 'up and down', rise: 1 }
export const SCHEMES: Record<'drive' | 'fly' | 'hover' | 'ride', Scheme> = {
  drive: { name: 'drive', verb: 'drive', lines: [{ ...GO, does: 'drive and reverse' }, { ...TURN, does: 'steer' }, DRIFT, LEAVE] },
  fly: { name: 'fly', verb: 'fly', lines: [GO, { ...TURN, does: 'turn' }, RISE, LEAVE] },
  hover: { name: 'hover', verb: 'ride', lines: [GO, { ...TURN, does: 'turn' }, RISE, { keys: ['KeyQ'], shown: 'Q', does: 'roll over', once: 'roll' }, LEAVE] },
  ride: { name: 'ride', verb: 'ride', lines: [GO, { ...TURN, does: 'turn' }, { keys: ['Space'], shown: 'Space', does: 'jump', once: 'jump' }, LEAVE] },
}

/**
 * A thing's `controls` as a shared world keeps it in the thing's record (the living lane's field): which scheme it
 * is driven by, how it moves, and where it last slept (its middle of mass in cells, and its turn), which the world's
 * own process writes so that a world started again can stand it up there. Data from a page or a model: checked by
 * `controlsOf` before anything uses it.
 */
export interface Controls {
  scheme: keyof typeof SCHEMES; motor: Motor
  /** Where its riders sit, each where their feet are, in its own cells from its low corner; and its size in cells, to place them by. */ seats?: [number, number, number][]; size?: [number, number, number]
  /** The driver's eye, in its own cells from its low corner: where the eye is when V puts it in the seat. */ eye?: [number, number, number]
  /** Its look in finer cells: each part as a `Fine` is, but its cells are kept by the server, under `kept` (`GET /world/fine/<kept>`, the sha256 of the 16-bit kinds). */ fine?: FineKept[]
  rest?: { at: [number, number, number]; rot: [number, number, number, number] }
  /** Written by the world the first time anyone gets on it or drives it, a rider or a rule (#245): kept in its record, so a better version of it never takes its place (make.mjs `asPut`). */ driven?: true
}
/**
 * A part of a living thing's look in cells finer than its own (#245): it rides on the body, and the body's own cells
 * of 10 cm are then not drawn. `per` of its cells lie along one of the body's (4 or 8); `low` is its low corner in
 * the body's own cells from the body's low corner (it may be fractional); `cells` are kinds laid
 * `cells[(y * d + z) * w + x]`, as base64 of the 16-bit kinds when a string.
 */
export interface Fine { size: [number, number, number]; per: number; low: [number, number, number]; cells: string | Uint16Array }
/** A part of a look as a shared world's record says it: its cells are fetched by `kept`, so a record of a car stays small. */
export interface FineKept { size: [number, number, number]; per: number; low: [number, number, number]; kept: string }
/** A look's cells as kinds, or null if they are not as many as its size says. */
export const kindsOf = (f: Fine): Uint16Array | null => {
  let kinds = f.cells
  if (typeof kinds === 'string') {
    // Text that is not base64, or not a whole number of 16-bit kinds, is no look (it used to throw, and a thing being made never answered).
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(kinds), (c) => c.charCodeAt(0)) } catch { return null }
    if (bytes.length % 2) return null
    kinds = new Uint16Array(bytes.buffer)
  }
  return kinds.length === f.size[0] * f.size[1] * f.size[2] ? kinds : null
}
/**
 * What a look may be, whoever's record says it: at most 8 parts, 8 million cells in a part and 12 million in all (a
 * car's outside at 2.5 cm and its cabin at 1.25 cm are 5 million), and at most 1.5 million of them filled (a look is
 * a thing's outside: every filled cell may cost a page six faces to make and to hold, and a record is read by every
 * page that joins its world).
 */
export const FINE_PARTS = 8, FINE_PART_CELLS = 8_000_000, FINE_CELLS = 12_000_000, FINE_FILLED = 1_500_000
const KEPT = /^[0-9a-f]{64}$/
const cellsOf = (f: { size: readonly number[] }) => f.size[0] * f.size[1] * f.size[2]
/** Whether parts are within what a look may be, by their sizes alone. */
export const fineWithin = (parts: readonly { size: readonly number[] }[]) => parts.length <= FINE_PARTS && parts.every((f) => cellsOf(f) <= FINE_PART_CELLS) && parts.reduce((n, f) => n + cellsOf(f), 0) <= FINE_CELLS
/** A part's size and grain are what the piece drawer can draw: at most 1023 cells a side. */
const fineShape = (f: Partial<Fine>) => finite(f.size, 3) && f.size.every((v) => Number.isInteger(v) && v > 0 && v <= 1023) && typeof f.per === 'number' && Number.isInteger(f.per) && f.per >= 1 && f.per <= 16 && finite(f.low, 3)
/** A number the core can read: finite as the 32-bit number it becomes there (1e300 is finite here and endless there, and the core then takes none of the motor). */
const real = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(Math.fround(x))
const finite = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(real)
/** A record's `controls`, if it is one that can be used; else null. The core clamps every number of the motor. */
export function controlsOf(value: unknown): Controls | null {
  const c = value as Partial<Controls> | null, m = c?.motor as Partial<Motor> | undefined
  if (!c || typeof c !== 'object' || typeof c.scheme !== 'string' || !Object.hasOwn(SCHEMES, c.scheme) || !m || typeof m !== 'object') return null
  const plain = ['front', 'grip', 'power', 'top', 'steer', 'hover', 'lift', 'upright', 'turns', 'jump', 'tough'] as const
  if (!plain.every((k) => real(m[k])) || !Array.isArray(m.feet) || m.feet.length > 16) return null
  const feet: Foot[] = []
  for (const f of m.feet as Partial<Foot>[]) {
    if (!f || !finite(f.at, 3) || !real(f.reach)) return null
    feet.push({ at: [f.at[0], f.at[1], f.at[2]], reach: f.reach, steers: f.steers === true, drives: f.drives === true })
  }
  const motor = { ...Object.fromEntries(plain.map((k) => [k, m[k]])), feet } as unknown as Motor
  const rest = c.rest && finite(c.rest.at, 3) && finite(c.rest.rot, 4) ? { at: [...c.rest.at] as [number, number, number], rot: [...c.rest.rot] as [number, number, number, number] } : undefined
  const seats = Array.isArray(c.seats) && c.seats.length <= 8 && c.seats.every((s) => finite(s, 3)) && finite(c.size, 3) ? { seats: c.seats.map((s) => [s[0], s[1], s[2]] as [number, number, number]), size: [...c.size!] as [number, number, number] } : {}
  const fine = Array.isArray(c.fine) && c.fine.length <= FINE_PARTS && c.fine.every((f) => f && fineShape(f) && typeof f.kept === 'string' && KEPT.test(f.kept)) && fineWithin(c.fine) ? { fine: c.fine.map((f) => ({ size: [...f.size] as [number, number, number], per: f.per, low: [...f.low] as [number, number, number], kept: f.kept })) } : {}
  const eye = finite(c.eye, 3) ? { eye: [...c.eye] as [number, number, number] } : {}
  return { scheme: c.scheme, motor, ...seats, ...eye, ...fine, ...(rest ? { rest } : {}), ...(c.driven === true ? { driven: true as const } : {}) }
}

/**
 * Whether words ask to drive a thing already made, pointed at and nothing more ("make it drivable", "let me drive
 * it", "make this driveable"). When what is aimed at is the asker's own made thing and not alive (the helper says:
 * make.mjs `aimed`), the page sends them to the helper as a thing (page/making.ts), and the helper brings it to life
 * where it stands (helper.mjs); aimed at anything else they are read as any words are. One rule for both. Words
 * that name what they mean ("make the dragon alive", "can I ride the horse") or say more ("drive it off the cliff", "let me drive it home")
 * are not this: they go where such words always went (a new thing, the realm's rules).
 */
export const asksToDrive = (text: string) => /^\s*(please\s+)?((make|turn)\s+(it|this|that)(\s+one)?\s+(into\s+something\s+)?(drivable|driveable|drive-able|rideable|ridable)|(let|can|could|may)\s+(me|i)\s+(drive|ride)\s+(it|this|that)(\s+one)?)\s*[.!?]?\s*$/i.test(text)

/** A thing to bring to life: its cells (one kind each, laid out x, then z, then y), size and low corner in the world's cells, how it moves and how it is driven. */
export interface Making {
  name: string; cells: Int32Array; size: [number, number, number]; low: [number, number, number]; motor: Motor; controls?: keyof typeof SCHEMES; take?: boolean
  /** Its look in finer cells, drawn riding on the body in place of the body's own cells (until it breaks). */ fine?: Fine[]
  /** Where its riders sit, and the driver's eye, in its own cells from its low corner (as `Controls` has them). */ seats?: [number, number, number][]; eye?: [number, number, number]
}
/** What a thing was asked to do and was measured doing (its record's `facts`, make/alive.mjs): names of numbers. */
export interface Facts { asked?: Record<string, number>; measured?: Record<string, number> }
/** A record's facts as one line for a card: its top speed and 0 to 100, as measured or else as asked ("240 km/h, 0 to 100 in 6.3 s"), or ''. */
export function factsLine(value: unknown): string {
  const f = value as Facts | null, pick = (name: string) => [f?.measured?.[name], f?.asked?.[name]].find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (!f || typeof f !== 'object') return ''
  const top = pick('top_kmh'), sprint = pick('zero_to_100_s')
  return [top !== undefined ? `${Math.round(top)} km/h` : '', sprint !== undefined ? `0 to 100 in ${sprint.toFixed(1)} s` : ''].filter(Boolean).join(', ')
}
export interface Thing extends Making { id: number; alive: boolean; /** One line of what it was measured doing, for its card (`factsLine`). */ facts?: string; /** In a shared world: its look's parts as its record says them, fetched from the world. */ kept?: FineKept[]; /** In a shared world: the id of its record there. */ ref?: string; /** How it is doing, as the solver last said: its speed along its front (cells a second), feet on the ground, touches, what it is told. */ state?: Told['live'][number]; /** Where its first rider sits, from its middle, in its own cells (its record's `seats`): for drawing whoever rides it from this page. */ seat?: [number, number, number]; /** Measured wheel-well dimensions from carving static wheels out of a fine look (wheels.ts). */ wheelProfile?: WheelProfile }

export interface Living {
  /** Brings a thing to life. Resolves when the solver has made it; its id is 0 if it could not. */
  spawn(making: Making): Promise<Thing>
  /** What the solver said: things made, things broken, what struck what. */
  heard(answer: Answer, told: Told): void
  /** A frame: what the keys ask of the thing ridden, the cue for one near, and where the eye is if it rides. True while it rides (the eye is then not the page's to move). */
  frame(dt: number): boolean
  /** Gets on a thing, or off (null). */
  mount(thing: Thing | null): void
  /** Whether the eye of whoever rides from this page is in the seat (V): their own figure is then not drawn. */
  readonly inside: boolean
  /** Puts the eye of whoever rides in the seat (true) or behind (false), as V does. */
  view(inside: boolean): void
  /** A living thing's look as drawn now, for a check: how big a cell of its own body is drawn (0: not drawn; null: no body), and each part of its fine look, where its low corner is (the world's cells), its turn and how big a cell of it is drawn. */
  look(thing: Thing): { body: number | null; parts: { pos: [number, number, number]; rot: [number, number, number, number]; cell: number; size: [number, number, number]; low: [number, number, number]; per: number; cracks: (readonly [number, number, number] | null)[] | null }[] }
  /** Where whoever rides from this page sits now and which way they face (cells; 0 is north), as the world's process places every rider (rules/things.mjs `carry`): in the thing's first seat, or its middle. Null when nobody rides. */
  readonly rider: { at: [number, number, number]; yaw: number } | null
  /** Lets go of every living thing, as the solver does when it forgets the world (mover.ts `forget`): whoever rides is set down, looks are put away, and a spawn still waiting is answered as not made. */
  forget(): void
  /** Tells a thing what to do as its rider would, for a check or a script: held for a second unless said again. */
  drive(thing: Thing, go: number, turn: number, rise: number, once?: 'roll' | 'jump', boost?: boolean): void
  /** Sets a thing still at a place (its middle, cells) turned so (a quaternion): one brought to life where it was drawn standing (#450). On this page's own solver only. */
  place(thing: Thing, at: readonly [number, number, number], rot: readonly [number, number, number, number]): void
  /** Takes a thing out of the world at once, leaving nothing (a parked car that is drawn again where it stood, #450). On this page's own solver only. */
  vanish(thing: Thing): void
  /** So much speed given to a thing at once (cells a second): thrown by a blast it was not alive for. On this page's own solver only. */
  kick(thing: Thing, speed: readonly [number, number, number]): void
  readonly things: Thing[]
  readonly riding: Thing | null
  /** The thing near enough to get on. */
  readonly near: Thing | null
  /** The last impacts told, newest last (at most 64). */
  readonly struck: Struck[]
  /** Where a thing is: its middle of mass (cells), how it is turned, and which way its front points along the ground. */
  where(thing: Thing): { at: [number, number, number]; rot: [number, number, number, number]; front: [number, number, number] } | null
  /** The eight corners of a thing's own box where they are now (cells), or null: what the controls keep off while it is ridden (play-hud.ts). */
  corners(thing: Thing): [number, number, number][] | null
  /** Live driving telemetry while driving a wheeled vehicle, or null. */
  readonly telemetry: { kmh: number; gear: number; rpm: number; slip: number; drifting: boolean; cam: DriveCamMode; fovAdd: number; boost: number; boosting: boolean; burnout: number; surface: 'paved' | 'wet' | 'offroad' } | null
  /** First-person cockpit immersion state (inertia, windshield rain/wipers, night dash glow). */
  readonly cockpit: CockpitState
  /** How a vehicle's look is dented (#37, deform.ts): the dents of its first part, or null if it was never struck hard. */
  damage(thing: Thing): DeformState | null
  /** Applies an impact directly to a vehicle's look (#61), or queues it until its look arrives: used when crashing into street cars. */
  hit(thing: Thing, worldHit: readonly [number, number, number], worldNormal: readonly [number, number, number], speed: number, push?: number): void
  /** Makes a vehicle's look as it was made: no dents, scuffs or cracks, and its engine quiet. */
  repair(thing: Thing): void
  /** Live wheel-animation inputs while driving a wheeled vehicle, or null (wheels.ts). */
  readonly wheelDrive: { id: number; steer: number; throttle: number; brake: number; handbrake: boolean; fwdSpeed: number; latSpeed: number; slip: number; drifting: boolean; burnout: number; decel: number } | null
}

const FRONTS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const
/** The eye's yaw that looks along each front in a thing's own cells (the eye's own straight ahead is -z). */
const AHEADS = [Math.PI / 2, -Math.PI / 2, Math.PI, 0]
/** How high a sitting person's eye is over where their feet are (cells): the seat is where the feet are. */
const SITTING_EYE = 12
/** How far outside its thing's own box a driver's eye may be (cells). */
const EYE_OUT = 6
/** How fast a vehicle must close on what it strikes to be dented (cells a second: 1.8 m/s), and to throw sparks and chips (2.8 m/s). */
const DENTS_FROM = 18, CRASH_FROM = 28
/** How near the eye a damaged engine must be to steam or smoke (cells). */
const ENGINE_SEEN = 900
/** How far round a driver's eye and each seat the look is kept from being bent into (cells): the head as it turns and leans. */
const HEAD_ROOM = 2
const turned = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}

/** How far ahead of the driver's eye nothing of its own but glass may be (cells): a head's room before the windscreen, the dash or a wheel. */
const EYE_CLEAR = 3.5
/**
 * Where a driver's eye sees out from (#74): `eye` itself where, through its windscreen (20 degrees to either side,
 * from 12 degrees down to 8 up), nothing of its own but glass is within `EYE_CLEAR` and no cell is within a head's
 * width of it; else the nearest place that is so, forward first along its front, then back and up and down. A
 * kept car's eye may be over its own seat's back (the street's blue saloon: its seat filled the lower half of the
 * picture, 3 cm under the eye). Null where the eye is clear already, or no place near is.
 */
export function clearEye(eye: readonly number[], front: number, parts: readonly { kinds: ArrayLike<number>; size: readonly number[]; per: number; low: readonly number[] }[]): [number, number, number] | null {
  const f = FRONTS[front] ?? FRONTS[0], r = [-f[2], 0, f[0]]
  /** The kind of its look at a place in its own cells: the first part with a cell there (0 for none). */
  const kindAt = (p: readonly number[]) => {
    for (const part of parts) {
      const x = Math.floor((p[0] - part.low[0]) * part.per), y = Math.floor((p[1] - part.low[1]) * part.per), z = Math.floor((p[2] - part.low[2]) * part.per)
      if (x < 0 || y < 0 || z < 0 || x >= part.size[0] || y >= part.size[1] || z >= part.size[2]) continue
      const k = part.kinds[x + part.size[0] * (z + part.size[2] * y)]
      if (k) return k
    }
    return 0
  }
  const solid = (p: readonly number[]) => { const k = kindAt(p); return k !== 0 && (k & 15) !== 11 }
  const rays: number[][] = []
  for (const side of [-20, -10, 0, 10, 20]) for (const up of [-12, -6, 0, 8]) {
    const a = (side * Math.PI) / 180, d = [f[0] * Math.cos(a) + r[0] * Math.sin(a), Math.tan((up * Math.PI) / 180), f[2] * Math.cos(a) + r[2] * Math.sin(a)], n = Math.hypot(d[0], d[1], d[2])
    rays.push(d.map((v) => v / n))
  }
  const clear = (p: readonly number[]) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (solid([p[0] + dx * 0.8, p[1] + dy * 0.8, p[2] + dz * 0.8])) return false
    for (const d of rays) for (let t = 0.25; t <= EYE_CLEAR; t += 1 / 8) {
      const k = kindAt([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t])
      // (Glass met: what is past it is the street's, or the bonnet's seen through it.)
      if ((k & 15) === 11) break
      if (k) return false
    }
    return true
  }
  if (clear(eye)) return null
  for (const step of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6]) for (const [along, up] of [[step, 0], [step, 0.5], [step, -0.5], [-step, 0], [0, step / 2], [0, -step / 2]]) {
    const p: [number, number, number] = [eye[0] + f[0] * along, eye[1] + up, eye[2] + f[2] * along]
    if (clear(p)) return p.map((v) => +v.toFixed(2)) as [number, number, number]
  }
  return null
}

export function living(o: {
  send(ask: Ask): void
  /** Says that something is to move, so that the solver is asked for steps again. */
  wake(): void
  piece(id: number): Piece | undefined
  /** The page's keys and pointer (input.ts): riding is a mode of its own there. */
  input: Input
  /** What is shown over the picture (hud.ts): the cue beside a thing, the card while riding. */
  hud: Hud
  /** The eye: metres, and which way it looks; `tilt` turns its whole frame (main.ts `view`), as it does in the seat. */
  pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] }
  /** Draws a block of finer cells as a piece (pieces.ts), for a thing's fine look: placed each frame where the body is. */
  look?: (kinds: Uint16Array, size: [number, number, number]) => Piece
  /** How high the ground is at a place (metres). */
  ground(x: number, z: number): number
  /** Where the person's own body is when they are on foot (cells, at the height of their chest), or null: what is near is near that. */
  body?: () => [number, number, number] | null
  /** What a cell of the world is made of (0: nothing), as this page has it: for keeping the eye that rides out of what stands. */
  kind?: (x: number, y: number, z: number) => number
  /** In a shared world: the page's line to it, and the made things it knows. The world's own process moves every living thing; this page only says what a rider asks. */
  world?: Link | null
  /** The page's person gets on a thing (true) or is set down off it (false): a body on foot is taken up and put down. */
  ridden?: (on: boolean) => void
  made?: () => Things
  /** A body taken out of the solver with nothing told of it (`vanish`): whoever keeps its piece lets it go. */
  dropped?: (id: number) => void
  /** Dynamic camera lens effects while driving: extra FOV (degrees), roll (radians), and speed-energy (0..1). */
  lens?: (fovAdd: number, rollAdd: number, energy: number) => void
  /** Driving visual FX: tire smoke, exhaust pops, persistent skidmarks, ground light pools, sparks, and weather/surface reads. */
  fx?: {
    smoke(at: readonly [number, number, number], vel: readonly [number, number, number], intensity: number, colour?: readonly [number, number, number]): void
    exhaust(at: readonly [number, number, number], dir: readonly [number, number, number], pop?: boolean, boost?: boolean): void
    track(wheel: number, at: readonly [number, number, number], strength: number, colour?: readonly [number, number, number]): void
    lift(wheel?: number): void
    light(at: readonly [number, number, number], dir: readonly [number, number], size: readonly [number, number], colour: readonly [number, number, number], alpha: number): void
    sparks(at: readonly [number, number, number], strength: number): void
    /** A hard crash (#37): dust, chips of the paint it was struck on (`kind`), and shards of glass if a window cracked. */
    crash?(at: readonly [number, number, number], strength: number, kind: number, glass: boolean): void
    /** A damaged engine under the bonnet (#37), for one frame of `dt` seconds: steam, then dark smoke, then flames as `level` goes from 0.35 to 1. */
    engine?(at: readonly [number, number, number], level: number, dt: number): void
    rain(): number
    day(): number
    surface(x: number, z: number): number
  }
  /** Driving audio hooks: continuous engine/tire/road beds, one-shot events, horn, and car radio. */
  audio?: {
    drive(v: { rpm: number; load: number; tone: number; slip: number; roll: number; rough: number; boost?: number } | null): void
    event(kind: 'door' | 'start' | 'shift' | 'pop' | 'thump', force?: number): void
    horn(on: boolean): void
    radio?(action: 'next' | 'enter' | 'exit'): void
  }
}): Living {
  const M = 10
  const things: Thing[] = [], waiting: { making: Making; done: (thing: Thing) => void }[] = [], struck: Struck[] = []
  let riding: Thing | null = null, near: Thing | null = null
  // The eye that rides: how much of the way back it is (0 to 1), and what it is kept out of.
  let room = 1, was: number[] | null = null
  const stands = standsBy(o.kind)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  // Cinematic driving camera suite (drive-cam.ts), 6-speed gearbox, drift & audio/FX telemetry state.
  let seatRoll = 0, boostFovPunch = 0, boostEnergyPunch = 0
  const cam = createDriveCam({
    pose: o.pose, ground: o.ground, stands,
    lens: o.lens ? (fovAdd, rollAdd, energy) => o.lens!(fovAdd + boostFovPunch, inside ? seatRoll : rollAdd, Math.min(1, energy + boostEnergyPunch)) : undefined,
  })
  let prevAt: [number, number, number] | null = null, velSm: [number, number, number] = [0, 0, 0], prevFwd = 0, prevOn = 4
  let gear = 1, rpm = 0.16, shiftCool = 0, popCool = 0, wasThrottle = 0, hornOn = false, smokeAcc = 0, boostAcc = 0, wasBoosting = false, wasLaunching = false
  let lightMode: 'auto' | 'off' | 'low' | 'high' = 'auto'
  const lampState: [number, number, number, number] = [0, 0, 0, 0]
  let telemetryNow: { kmh: number; gear: number; rpm: number; slip: number; drifting: boolean; cam: DriveCamMode; fovAdd: number; boost: number; boosting: boolean; burnout: number; surface: 'paved' | 'wet' | 'offroad' } | null = null
  let wheelDriveNow: Living['wheelDrive'] = null
  // What was last said to the thing ridden and when, where the thing faced, and what is asked once (a roll, a jump, getting off).
  let said = '', since = 0, facing = 0, once: 'roll' | 'jump' | 'leave' | undefined
  let cue: { thing: Thing; remove(): void } | null = null, leave: (() => void) | null = null
  // A phone has no keys: the cue is touched to get on, the left thumb's stick drives, and what a scheme's other
  // keys do is a column of keys while riding (held ones for up and down, touched ones for what is done once). They
  // are the kit's keys where the kit is (play-hud.ts) and are shown only by touch (index.html). While anyone rides
  // the page says so (`html.riding`): the keys of one on foot step aside meanwhile (realm-ui.ts).
  const coarse = matchMedia('(pointer: coarse)')
  const held = { rise: 0, boost: false, horn: false }
  const buttons = o.hud.panel('living')
  const cabin = cockpit(o.hud)
  // Sleek speed, gear, RPM bar, subtle boost bar, camera-mode toast and DRIFT indicator shown while driving a car.
  const drivePanel = o.hud.panel('drive-hud')
  drivePanel.innerHTML = '<div class="dh-cam" hidden></div><div class="dh-top"><span class="dh-spd">0</span><span class="dh-unit">km/h</span><span class="dh-gear">N</span><span class="dh-drift" hidden>DRIFT</span></div><div class="dh-rpm">' + '<i></i>'.repeat(12) + '</div><div class="dh-boost"><i style="width:100%"></i></div>'
  const dhCam = drivePanel.querySelector<HTMLElement>('.dh-cam')!
  const dhSpd = drivePanel.querySelector<HTMLElement>('.dh-spd')!
  const dhGear = drivePanel.querySelector<HTMLElement>('.dh-gear')!
  const dhDrift = drivePanel.querySelector<HTMLElement>('.dh-drift')!
  const dhBars = [...drivePanel.querySelectorAll<HTMLElement>('.dh-rpm i')]
  const dhBoost = drivePanel.querySelector<HTMLElement>('.dh-boost i')!
  let camToastTimer: ReturnType<typeof setTimeout> | undefined
  const showCamToast = () => {
    clearTimeout(camToastTimer)
    dhCam.textContent = `CAM · ${cam.label}`
    dhCam.hidden = false
    camToastTimer = setTimeout(() => { dhCam.hidden = true }, 1500)
  }
  let lastHudSpd = -1, lastHudGear = '', lastHudBars = -1, lastHudDrift = false, lastHudBoost = -1, lastHudBoosting = false, lastHudBurn = false
  const updateDriveHud = (kmh: number, g: number, r: number, drifting: boolean, boostFuel = 1, boosting = false, burnoutCharge = 0) => {
    const s = Math.max(0, Math.round(kmh))
    if (s !== lastHudSpd) { dhSpd.textContent = String(s); lastHudSpd = s }
    const gl = g < 0 ? 'R' : g === 0 ? 'N' : String(g)
    if (gl !== lastHudGear) { dhGear.textContent = gl; lastHudGear = gl }
    const lit = Math.max(0, Math.min(12, Math.round(((r - 0.14) / 0.84) * 12)))
    if (lit !== lastHudBars) {
      for (let i = 0; i < 12; i++) {
        const b = dhBars[i]
        b.className = i < lit ? (i >= 10 ? 'red' : i >= 7 ? 'hot' : 'on') : ''
      }
      lastHudBars = lit
    }
    if (drifting !== lastHudDrift) { dhDrift.hidden = !drifting; lastHudDrift = drifting }
    const burn = burnoutCharge > 0.05
    const pct = Math.max(0, Math.min(100, Math.round((burn ? burnoutCharge : boostFuel) * 100)))
    if (pct !== lastHudBoost) { dhBoost.style.width = `${pct}%`; lastHudBoost = pct }
    if (boosting !== lastHudBoosting) { drivePanel.classList.toggle('boost', boosting); lastHudBoosting = boosting }
    if (burn !== lastHudBurn) { drivePanel.classList.toggle('burn', burn); lastHudBurn = burn }
  }
  const resetDriveState = () => {
    cam.reset()
    boostFovPunch = 0; boostEnergyPunch = 0
    clearTimeout(camToastTimer)
    dhCam.hidden = true
    prevAt = null; velSm = [0, 0, 0]; prevFwd = 0; prevOn = 4
    gear = 1; rpm = 0.16; shiftCool = 0; popCool = 0; wasThrottle = 0; smokeAcc = 0; boostAcc = 0; wasBoosting = false; wasLaunching = false
    lightMode = 'auto'; lampState[0] = lampState[1] = lampState[2] = lampState[3] = 0
    telemetryNow = null
    wheelDriveNow = null
    if (hornOn) { hornOn = false; o.audio?.horn(false) }
    held.horn = false
    cabin.reset()
    o.lens?.(0, 0, 0)
    o.audio?.drive(null)
    o.input.rumble?.(null)
    o.fx?.lift()
    updateDriveHud(0, 0, 0.15, false, 1, false, 0)
  }
  const button = (act: string, words: string, press: () => void, release?: () => void) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'vx-button', textContent: words })
    b.dataset.act = act
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press() })
    if (release) for (const up of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(up, release)
    return b
  }
  let seat: HTMLButtonElement | null = null
  const showButtons = (scheme: Scheme | null) => {
    held.rise = 0; held.boost = false; held.horn = false
    document.documentElement.classList.toggle('riding', !!scheme)
    document.documentElement.classList.toggle('driving', scheme?.name === 'drive')
    if (!scheme) { buttons.replaceChildren(); seat = null; return }
    // From the bottom up (the column stands on the corner under the right thumb): drift, boost, horn (or down/up),
    // what is done once, seat, camera & radio, and getting off at the top, farthest from the thumb.
    const driftBtn = button('drift', 'Drift', () => { held.rise = 1 }, () => { held.rise = 0 })
    driftBtn.dataset.vxKind = 'main'
    const boostBtn = button('boost', 'Boost', () => { held.boost = true }, () => { held.boost = false })
    boostBtn.setAttribute('aria-label', 'Nitrous boost')
    const hornBtn = button('horn', 'Horn', () => { held.horn = true }, () => { held.horn = false })
    hornBtn.setAttribute('aria-label', 'Honk horn')
    const rises = scheme.name === 'drive'
      ? [driftBtn, boostBtn, hornBtn]
      : scheme.lines.some((l) => l.rise)
        ? [button('down', 'Down', () => { held.rise = -1 }, () => { held.rise = 0 }), button('up', 'Up', () => { held.rise = 1 }, () => { held.rise = 0 })]
        : []
    const onces = scheme.lines.filter((l) => l.once && l.once !== 'leave').map((l) => button(l.once!, l.does[0].toUpperCase() + l.does.slice(1), () => { once = l.once }))
    const leaves = scheme.lines.filter((l) => l.once === 'leave').map((l) => button('leave', 'Get off', () => { once = l.once }))
    seat = button('seat', 'Seat', () => view(!inside))
    seat.setAttribute('aria-label', 'Look from the seat')
    seat.setAttribute('aria-pressed', String(inside))
    const driveExtras: HTMLButtonElement[] = []
    if (scheme.name === 'drive') {
      const camBtn = button('cam', 'Cam', nextView)
      camBtn.setAttribute('aria-label', 'Next camera view, the seat among them')
      driveExtras.push(camBtn)
      if (o.audio?.radio) {
        const radioBtn = button('radio', 'Radio', () => { o.audio?.radio?.('next') })
        radioBtn.setAttribute('aria-label', 'Next car radio station')
        driveExtras.push(radioBtn)
      }
      const repairBtn = button('repair', 'Repair', () => { if (riding) repairCar(riding) })
      repairBtn.setAttribute('aria-label', 'Repair vehicle')
      driveExtras.push(repairBtn)
    }
    buttons.replaceChildren(...rises, ...onces, seat, ...driveExtras, ...leaves)
  }
  // Beside a thing, E gets on it: a mode that is there only while the cue is, and takes that one key.
  let beside: (() => void) | null = null
  const reach = (on: boolean) => {
    if (on && !beside) beside = o.input.push({ name: 'beside', key: (code) => { if (code !== 'KeyE' || !near || riding) return false; mount(near); return true } })
    else if (!on && beside) { beside(); beside = null }
  }
  const where: Living['where'] = (thing) => {
    const piece = o.piece(thing.id)
    if (!piece) return null
    const f = turned(piece.rot, FRONTS[thing.motor.front]), flat = Math.hypot(f[0], f[2]) || 1
    return { at: piece.pos, rot: piece.rot, front: [f[0] / flat, 0, f[2] / flat] }
  }
  /** Where a place in a thing's own cells (from its low corner) is in the world now (cells), or null. */
  const placeOf = (thing: Thing, p: readonly number[]): [number, number, number] | null => {
    const body = o.piece(thing.id)
    if (!body) return null
    // The body's own cells start at its low corner when it was made, which is the thing's own low corner unless the core left out empty rows.
    const b = body.born, v = turned(body.rot, [p[0] - (b.low[0] - thing.low[0]) - b.com[0], p[1] - (b.low[1] - thing.low[1]) - b.com[1], p[2] - (b.low[2] - thing.low[2]) - b.com[2]])
    return [body.pos[0] + v[0], body.pos[1] + v[1], body.pos[2] + v[2]]
  }
  // A thing's fine look (#245): a piece for each part, kept each frame where the body is, the body's own cells not drawn.
  // Its glass is seen through (pieces.ts), from the seat as from the street.
  /** glass: where its glass cells are, three numbers a cell (#37: where a crack starts). */
  interface Worn { piece: Piece; kinds: Uint16Array; size: [number, number, number]; low: [number, number, number]; per: number; glass: Int16Array }
  /** Where a look's glass cells are (kind 11), three numbers a cell. */
  const glassOf = (kinds: Uint16Array, [w, , d]: readonly number[]) => {
    const at: number[] = []
    for (let i = 0; i < kinds.length; i++) if ((kinds[i] & 15) === 11) at.push(i % w, Math.floor(i / (w * d)), Math.floor(i / w) % d)
    return Int16Array.from(at)
  }
  // Its dents (#37): one record a part, by the thing's body and the part's place in its look.
  const dents = new VehicleDeformation()
  const dentId = (thing: Thing, part: number) => thing.id * FINE_PARTS + part
  const looks = new Map<Thing, Worn[]>()
  /** Impacts on a drivable car before its fine look arrives (#61): replayed as soon as `wear` finishes. */
  const pendingDents = new Map<Thing, { at: readonly [number, number, number]; normal?: readonly [number, number, number]; speed: number; push: number; pose?: Placed }[]>()
  const repairCar = (thing: Thing) => {
    pendingDents.delete(thing)
    looks.get(thing)?.forEach((w, i) => { dents.repairVehicle(dentId(thing, i)); w.piece.cracks = undefined })
  }
  const wear = (thing: Thing, parts: { kinds: Uint16Array; size: [number, number, number]; per: number; low: [number, number, number] }[]) => {
    if (!o.look || !thing.alive || !things.includes(thing) || looks.has(thing) || !parts.length) return
    // Within what a look may be, counted before any of it is made into faces: its sizes, and how many of its cells are filled.
    let filled = 0
    for (const f of parts) for (let i = 0; i < f.kinds.length; i++) if (f.kinds[i]) filled++
    if (!fineWithin(parts) || filled > FINE_FILLED) { console.warn(`a look of ${parts.length} parts with ${filled} filled cells is more than a look may be: the thing is drawn as its own cells`); return }
    const carveWheels = (thing.controls ?? 'drive') === 'drive' && thing.motor.feet.length >= 2 && !(thing.motor.steer === 0 && thing.motor.upright > 0)
    looks.set(thing, parts.map((f) => {
      const carved = carveWheels ? carveWheelWells(f.kinds, f.size, f.per, f.low, thing.motor, thing.size) : null
      if (carved && !thing.wheelProfile) thing.wheelProfile = carved.profile
      const kinds = carved ? carved.kinds : f.kinds
      const piece = o.look!(kinds, f.size)
      // Placed by its low corner, so that a part is where `low` says however it is turned.
      piece.born.com = [0, 0, 0]
      piece.cell = 0
      return { piece, kinds, size: f.size, low: f.low, per: f.per, glass: glassOf(kinds, f.size) }
    }))
    // The eye where it sees out (#74): once, as its look is worn, and kept on it for the seat, its dents and its card.
    const eye = clearEye(eyeOf(thing), thing.motor.front, parts)
    if (eye) thing.eye = eye
    const queued = pendingDents.get(thing)
    if (queued) {
      pendingDents.delete(thing)
      for (const q of queued) applyDent(thing, q.at, q.normal, q.speed, q.push, q.pose)
    }
  }
  const unwear = (thing: Thing) => {
    pendingDents.delete(thing)
    // Its dents go with its look: a body's id may be given to another thing later.
    looks.get(thing)?.forEach((w, i) => { w.piece.destroy(); dents.clearVehicle(dentId(thing, i)) })
    looks.delete(thing)
  }
  /** Where a part of a thing's look is when its body is at `pos` turned `rot` (as `follow` places it). */
  const partAt = (thing: Thing, body: Piece, w: Worn, pos: readonly number[], rot: readonly number[]): [number, number, number] => {
    const b = body.born, v = turned(rot, [w.low[0] - (b.low[0] - thing.low[0]) - b.com[0], w.low[1] - (b.low[1] - thing.low[1]) - b.com[1], w.low[2] - (b.low[2] - thing.low[2]) - b.com[2]])
    return [pos[0] + v[0], pos[1] + v[1], pos[2] + v[2]]
  }
  /**
   * A vehicle struck hard (#37): each part of its look is dented where it was struck, pushed in from where it was
   * struck. The core says where and how fast, not which way: the way out of the look's own box at that place, so
   * a corner is struck from both its sides. The driver's eye and every seat are kept clear, with room for the head.
   */
  const applyDent = (thing: Thing, hitAt: readonly [number, number, number], worldNormal: readonly [number, number, number] | undefined, speed: number, push: number, pose: Placed | undefined) => {
    const worn = looks.get(thing), body = o.piece(thing.id)
    if (!worn || !body) {
      if (!worn && (thing.fine?.length || thing.kept?.length)) {
        const list = pendingDents.get(thing) ?? []
        if (list.length < 6) { list.push({ at: [hitAt[0], hitAt[1], hitAt[2]], normal: worldNormal ? [worldNormal[0], worldNormal[1], worldNormal[2]] : undefined, speed, push, pose }); pendingDents.set(thing, list) }
      }
      return
    }
    const pos = pose?.pos ?? body.pos, rot = pose?.rot ?? body.rot
    const eye = eyeOf(thing), lo = [eye[0] - HEAD_ROOM, eye[1] - SITTING_EYE / 2, eye[2] - HEAD_ROOM], hi = [eye[0] + HEAD_ROOM, eye[1] + HEAD_ROOM, eye[2] + HEAD_ROOM]
    for (const seat of thing.seats ?? []) for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], seat[a] - (a === 1 ? 0 : HEAD_ROOM))
      hi[a] = Math.max(hi[a], seat[a] + (a === 1 ? SITTING_EYE + HEAD_ROOM : HEAD_ROOM))
    }
    worn.forEach((w, i) => {
      const at = partAt(thing, body, w, pos, rot), cell = 1 / w.per
      // Where it was struck in the part's own cells, and from there the way out of its box.
      const local = turned([-rot[0], -rot[1], -rot[2], rot[3]], [hitAt[0] - at[0], hitAt[1] - at[1], hitAt[2] - at[2]])
      let normal: [number, number, number]
      if (worldNormal && Math.hypot(worldNormal[0], worldNormal[1], worldNormal[2]) > 1e-6) {
        normal = [worldNormal[0], worldNormal[1], worldNormal[2]]
      } else {
        const out = local.map((v, a) => { const d = Math.max(-1, Math.min(1, (v / cell - w.size[a] / 2) / (w.size[a] / 2))); return d * d * d * (a === 1 ? 0.5 : 1) })
        if (Math.hypot(out[0], out[1], out[2]) < 1e-6) out[0] = 1
        normal = turned(rot, out)
      }
      const cabin = { min: lo.map((v, a) => (v - w.low[a]) * w.per) as [number, number, number], max: hi.map((v, a) => (v - w.low[a]) * w.per) as [number, number, number] }
      const prev = dents.get(dentId(thing, i))?.glassCrack
      const was0 = prev ? prev[0] : 0, was1 = prev ? prev[1] : 0, was2 = prev ? prev[2] : 0, was3 = prev ? prev[3] : 0
      const state = dents.recordImpact(dentId(thing, i), { pos: at, rot: [rot[0], rot[1], rot[2], rot[3]], cell, born: { com: [0, 0, 0], size: w.size }, front: thing.motor.front as 0 | 1 | 2 | 3 }, hitAt, normal, speed, push, cabin)
      if (!state) return
      w.piece.deform = state
      // Each struck window keeps its own crack origin (#61): a blow on one window does not move another's cracks.
      const prevs = [was0, was1, was2, was3]
      if (w.glass.length) {
        let near = -1
        for (let z = 0; z < 4; z++) {
          if (state.glassCrack[z] <= prevs[z]) continue
          if (near < 0) {
            let best = Infinity
            const x = local[0] / cell, y = local[1] / cell, zz = local[2] / cell
            for (let g = 0; g < w.glass.length; g += 3) { const far = (w.glass[g] - x) ** 2 + (w.glass[g + 1] - y) ** 2 + (w.glass[g + 2] - zz) ** 2; if (far < best) { best = far; near = g } }
          }
          w.piece.cracks ??= [null, null, null, null]
          w.piece.cracks[z] = [w.glass[near] + 0.5, w.glass[near + 1] + 0.5, w.glass[near + 2] + 0.5]
        }
      }
    })
  }
  const dent = (thing: Thing, s: Struck, pose: Placed | undefined) => applyDent(thing, s.at, undefined, s.speed, s.push, pose)
  const setLamps = (thing: Thing | null, lamps?: [number, number, number, number]) => {
    if (!thing) return
    const body = o.piece(thing.id)
    if (body) body.lamps = lamps
    for (const w of looks.get(thing) ?? []) w.piece.lamps = lamps
  }
  const headlightLevel = (dark: number) => lightMode === 'high' ? 1.8 : lightMode === 'low' ? 1 : lightMode === 'off' ? 0 : dark > 0.12 ? 1 : 0
  const cycleLights = () => {
    const dark = o.fx ? Math.max(0, Math.min(1, 1 - o.fx.day() * 1.15)) : 0
    if (lightMode === 'auto') lightMode = dark > 0.12 ? 'high' : 'low'
    else if (lightMode === 'low') lightMode = 'high'
    else if (lightMode === 'high') lightMode = 'off'
    else lightMode = 'low'
  }
  const follow = () => {
    for (const [thing, worn] of looks) {
      const body = o.piece(thing.id)
      // Its own cells are not drawn while it wears a look; broken, its pieces are drawn as they are.
      if (body) body.cell = 0
      for (const w of worn) {
        const at = body && placeOf(thing, w.low)
        if (at && body) { w.piece.pos = at; w.piece.rot = body.rot; w.piece.cell = 1 / w.per } else w.piece.cell = 0
      }
    }
  }
  // In a shared world the cells of a look are the world's to keep and every page's to fetch, once each.
  const fetched = new Map<string, Promise<Uint16Array | null>>()
  const fetchKinds = (f: FineKept) => {
    // One that could not be had (the network, a busy server) is not kept as none: the next thing that wears it asks again.
    if (!fetched.has(f.kept)) fetched.set(f.kept, o.world!.fetch(`${o.world!.base}/fine/${f.kept}`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b && b.byteLength === f.size[0] * f.size[1] * f.size[2] * 2 ? new Uint16Array(b) : null), () => null).then((kinds) => { if (!kinds) fetched.delete(f.kept); return kinds }))
    return fetched.get(f.kept)!
  }
  /** Sends a part's cells to the world to keep; what its record then says of it, or null. */
  const keep = async (f: Fine): Promise<FineKept | null> => {
    const kinds = kindsOf(f)
    if (!kinds || !o.world) return null
    const r = await o.world.fetch(`${o.world.base}/fine`, { method: 'POST', body: kinds.slice() }).catch(() => null)
    const kept = r?.ok ? ((await r.json()) as { kept?: string }).kept : undefined
    if (!kept) return null
    fetched.set(kept, Promise.resolve(kinds))
    return { size: f.size, per: f.per, low: f.low, kept }
  }
  // The eye in the seat (V while riding): at the driver's eye, turning and leaning with the thing; the head still turns.
  let inside = false
  const head = [0, 0]
  /** Where the driver's eye is in a thing's own cells: its `eye`, else its first seat with a sitting person's eye over it, else over its middle. */
  const eyeOf = (thing: Thing): [number, number, number] => {
    const e = thing.eye ?? (thing.seats?.[0] ? [thing.seats[0][0], thing.seats[0][1] + SITTING_EYE, thing.seats[0][2]] : [thing.size[0] / 2, thing.size[1] + SITTING_EYE / 2, thing.size[2] / 2])
    // Held to the thing's own box and a little over it (a rider on a roof rack, not a kilometre off): a record's `eye` is anyone's to write.
    const held = (v: number, most: number) => Math.max(-EYE_OUT, Math.min(most + EYE_OUT, v))
    return [held(e[0], thing.size[0]), held(e[1], thing.size[1] + SITTING_EYE), held(e[2], thing.size[2])]
  }
  // A car's seat is one of the driving camera's views (#74): in it the camera says 'seat', and out of it the view
  // it was in before (`outside`), unless C says which view comes next.
  let outside: DriveCamMode = 'close'
  /** Says the ridden thing's keys on its card again (set as it is mounted). */
  let refreshCard: (() => void) | null = null
  const view = (on: boolean, next?: DriveCamMode) => {
    if (on === inside) return
    inside = on && !!riding
    seat?.setAttribute('aria-pressed', String(inside))
    const isDrive = !!riding && (riding.controls ?? 'drive') === 'drive'
    if (inside && riding) {
      if (isDrive && cam.mode !== 'seat') { outside = cam.mode; cam.setMode('seat') }
      cabin.reset(); head[0] = 0; head[1] = -0.08; o.lens?.(0, 0, 0)
    } else {
      // Behind again: looking the way the head was turned.
      cabin.reset()
      o.pose.tilt = undefined
      if (isDrive) cam.sync(facing, head[0], true)
      o.pose.yaw = facing + head[0]
      o.pose.pitch = isDrive ? -0.135 : -0.22
      room = 0
      // (After the pose is set: cinema blends in from where the eye was, the seat.)
      if (cam.mode === 'seat') cam.setMode(next ?? outside)
    }
  }
  /** C, the touch kit's Cam and a pad's next camera while driving: the next view of the driving camera, in or out of the seat. */
  const nextView = () => {
    const next = nextDriveCam(cam.mode)
    if (next === 'seat') view(true)
    else if (inside) view(false, next)
    else cam.setMode(next)
    showCamToast()
    refreshCard?.()
  }
  const tell = (thing: Thing, go: number, turn: number, rise: number, once?: 'roll' | 'jump', boost?: boolean, wetness?: number) => {
    if (o.world) { if (thing.ref) o.world.drive(thing.ref, go, turn, rise, once, boost, wetness); return }
    o.send({ drive: { id: thing.id, go, turn, rise, roll: once === 'roll', jump: once === 'jump', ...(boost !== undefined ? { boost } : {}), ...(wetness !== undefined ? { wetness } : {}) } })
    o.wake()
  }
  // In a shared world a thing lives when the world says which body it is: what it is comes from its record.
  const hoped = new Map<string, (thing: Thing) => void>()
  if (o.world) o.world.onliving = ({ thing: ref, body }) => {
    const was = things.findIndex((t) => t.ref === ref)
    if (was >= 0) { const old = things[was]; old.alive = false; things.splice(was, 1); unwear(old); if (riding === old) mount(null) }
    const record = o.made?.().all.get(ref), controls = controlsOf(record?.controls)
    if (!body || !record || !controls) return
    const b = record.box, thing: Thing = { id: body, ref, alive: true, name: record.name, cells: new Int32Array(0), size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]], low: [b[0], b[1], b[2]], motor: controls.motor, controls: controls.scheme, seats: controls.seats, eye: controls.eye, kept: controls.fine, facts: factsLine(record.facts) || undefined, seat: controls.seats?.[0] && controls.size ? [controls.seats[0][0] - controls.size[0] / 2, controls.seats[0][1] - controls.size[1] / 2, controls.seats[0][2] - controls.size[2] / 2] : undefined }
    things.push(thing)
    const kept = controls.fine
    if (kept?.length && o.look) void Promise.all(kept.map(fetchKinds)).then((all) => wear(thing, kept.flatMap((f, i) => { const kinds = all[i]; return kinds ? [{ kinds, size: f.size, per: f.per, low: f.low }] : [] })))
    hoped.get(ref)?.(thing)
    hoped.delete(ref)
  }
  /** A thing's cells as rows of the world (x0, x1, y, z, kind), for an ask. */
  const rows = (m: Making) => {
    const out: number[] = []
    for (let y = 0; y < m.size[1]; y++) for (let z = 0; z < m.size[2]; z++) for (let x = 0; x < m.size[0]; x++) {
      const kind = m.cells[x + m.size[0] * (z + m.size[2] * y)]
      if (!kind) continue
      let x1 = x + 1
      while (x1 < m.size[0] && m.cells[x1 + m.size[0] * (z + m.size[2] * y)] === kind) x1++
      out.push(m.low[0] + x, m.low[0] + x1, m.low[1] + y, m.low[2] + z, kind)
      x = x1 - 1
    }
    return out
  }
  const mount = (thing: Thing | null) => {
    if (riding && riding !== thing) {
      // Set down beside it, a little above the ground.
      tell(riding, 0, 0, 0)
      const at = where(riding)
      if (at) { o.pose.x = at.at[0] / M - at.front[2] * (riding.size[2] / M / 2 + 1.2); o.pose.z = at.at[2] / M + at.front[0] * (riding.size[2] / M / 2 + 1.2); o.pose.y = Math.max(o.pose.y, o.ground(o.pose.x, o.pose.z) + 1.7) }
    }
    const was = riding
    if (was && was !== thing) setLamps(was, undefined)
    view(false)
    riding = thing?.alive ? thing : null
    said = ''
    resetDriveState()
    // The world is told who rides what, and a body on foot is taken up or set down.
    if (was !== riding) {
      if (was?.ref) o.world?.ride(was.ref, false)
      if (riding?.ref) o.world?.ride(riding.ref, true)
      // Off: the seat's keys go first, and then the person is on their feet again (#367).
      if (!riding) { leave?.(); leave = null; if (was && (was.controls ?? 'drive') === 'drive') { o.audio?.radio?.('exit'); o.audio?.event('door', 0.65) } }
      else if (was && (was.controls ?? 'drive') === 'drive' && (riding.controls ?? 'drive') !== 'drive') o.audio?.radio?.('exit')
      if (!was !== !riding) o.ridden?.(!!riding)
    }
    const at = riding && where(riding)
    const scheme = riding && SCHEMES[riding.controls ?? 'drive']
    const isDrive = scheme?.name === 'drive'
    if (riding && at) {
      // The eye goes behind it, looking the way it faces and a little down (low & heroic for cars).
      facing = Math.atan2(at.front[0], -at.front[2])
      if (isDrive) cam.sync(facing, 0, true)
      o.pose.yaw = facing
      o.pose.pitch = isDrive ? -0.135 : -0.22
      if (isDrive && was !== riding) {
        const mounted = riding
        o.audio?.radio?.('enter')
        o.audio?.event('door', 0.72)
        setTimeout(() => { if (riding === mounted) o.audio?.event('start', 0.85) }, 140)
      }
    }
    // The card says the keys: by touch the keys are there to be touched instead (on a phone it lay under Credits and Back).
    refreshCard = () => {
      const extraRows: readonly (readonly [string, string])[] = isDrive ? [['Shift', 'boost'], ['C', `camera · ${cam.label}`], ['V', inside ? `back to ${DRIVE_CAM_LABELS[outside]}` : 'seat'], ['X', 'look back'], ['L', 'lights'], ['H', 'horn'], ['N', 'radio'], ['F', 'repair']] : [['V', 'look from the seat']]
      o.hud.card(riding && scheme && !coarse.matches ? { title: riding.name, note: riding.facts, rows: [...scheme.lines.filter((l) => l.once !== 'leave').map((line) => [line.shown, line.does] as const), ...extraRows, ...scheme.lines.filter((l) => l.once === 'leave').map((line) => [line.shown, line.does] as const)] } : null)
    }
    refreshCard()
    // Riding is a mode of its own: the keys and the look are the thing's, and the keys that are pressed once are taken here.
    leave?.()
    reach(false)
    leave = scheme ? o.input.push({ name: 'mounted', solid: true, key: (code, e) => { if (code === 'KeyV') { view(!inside); if (isDrive) { showCamToast(); refreshCard?.() } return true } if (isDrive && code === 'KeyC') { nextView(); return true } if (isDrive && code === 'KeyL') { if (!e?.repeat) cycleLights(); return true } if (isDrive && code === 'KeyN') { if (!e?.repeat) o.audio?.radio?.('next'); return true } if (isDrive && code === 'KeyF') { if (!e?.repeat && riding) repairCar(riding); return true } if (isDrive && (code === 'KeyX' || code === 'KeyH')) return true; const line = scheme.lines.find((l) => l.once && l.keys[0] === code); if (line) once = line.once; return !!line } }) : null
    once = undefined
    showButtons(scheme || null)
  }

  return {
    things, struck, where, mount, view,
    corners: (thing) => {
      const all: [number, number, number][] = []
      for (let i = 0; i < 8; i++) { const p = placeOf(thing, [i & 1 ? thing.size[0] : 0, i & 2 ? thing.size[1] : 0, i & 4 ? thing.size[2] : 0]); if (!p) return null; all.push(p) }
      return all
    },
    get riding() { return riding },
    get inside() { return inside && !!riding },
    get telemetry() { return telemetryNow },
    get cockpit() { return cabin.state },
    get wheelDrive() { return wheelDriveNow },
    look: (thing) => ({ body: o.piece(thing.id)?.cell ?? null, parts: (looks.get(thing) ?? []).map((w) => { const p = w.piece; return { pos: [...p.pos] as [number, number, number], rot: [...p.rot] as [number, number, number, number], cell: p.cell, size: w.size, low: w.low, per: w.per, cracks: p.cracks ? p.cracks.map((c) => (c ? ([...c] as [number, number, number]) : null)) : null } }) }),
    get rider() {
      const at = riding && where(riding)
      if (!riding || !at) return null
      const off = turned(at.rot, riding.seat ?? [0, -3, 0])
      return { at: [at.at[0] + off[0], at.at[1] + off[1], at.at[2] + off[2]] as [number, number, number], yaw: Math.atan2(at.front[0], -at.front[2]) }
    },
    get near() { return near },
    spawn: (making) => new Promise((done) => {
      if (o.world) {
        // In a shared world it is made as any thing is, its record and its cells together, and its controls with them: the world brings it to life.
        const ref = `${making.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'thing'}-${Math.random().toString(36).slice(2, 8)}`, r = rows(making)
        hoped.set(ref, done)
        const none = () => { hoped.delete(ref); done({ ...making, id: 0, alive: false }) }
        // Its look's cells are kept by the world first, and its record says where they are: a car's are megabytes, its record a few hundred bytes.
        const world = o.world
        void Promise.all((making.fine ?? []).map((f) => keep(f).catch(() => null))).then((kept) => {
          const fine = kept.filter((f): f is FineKept => f !== null)
          const controls: Controls = { scheme: making.controls ?? 'drive', motor: making.motor, ...(making.seats ? { seats: making.seats, size: making.size } : {}), ...(making.eye ? { eye: making.eye } : {}), ...(fine.length ? { fine } : {}) }
          void world.ask({ edit: [1, r.length / 5, ...r], release: [making.low[0] - 2, making.low[1] + 1, making.low[2]], thing: { id: ref, name: making.name, wish: '', at: [making.low[0] + (making.size[0] >> 1), making.low[1], making.low[2] + (making.size[2] >> 1)], size: making.size, facing: 'east', controls } }).then((taken) => { if (!taken) none() })
          setTimeout(() => { if (hoped.has(ref)) none() }, 10_000)
        })
        return
      }
      waiting.push({ making, done })
      o.send({ spawn: { cells: making.cells, size: making.size, low: making.low, take: making.take, motor: numbers(making.motor) } })
    }),
    drive: tell,
    kick(thing, speed) { if (o.world) return; o.send({ kick: { id: thing.id, speed: [speed[0], speed[1], speed[2]] } }); o.wake() },
    vanish(thing) {
      if (o.world || !things.includes(thing)) return
      if (riding === thing) mount(null)
      o.send({ vanish: thing.id })
      thing.alive = false
      things.splice(things.indexOf(thing), 1)
      unwear(thing)
      if (near === thing) { near = null; cue?.remove(); cue = null; reach(false) }
      o.piece(thing.id)?.destroy()
      o.dropped?.(thing.id)
    },
    place(thing, at, rot) { if (o.world) return; o.send({ place: { id: thing.id, at: [at[0], at[1], at[2]], rot: [rot[0], rot[1], rot[2], rot[3]] } }); o.wake() },
    forget() {
      if (riding) mount(null)
      for (const thing of things) { thing.alive = false; unwear(thing) }
      things.length = 0; struck.length = 0; near = null; cue?.remove(); cue = null
      for (const w of waiting.splice(0)) w.done({ ...w.making, id: 0, alive: false })
    },
    heard(answer, told) {
      if (answer.spawned !== undefined) {
        const next = waiting.shift()
        if (next) {
          const m = next.making, thing: Thing = { ...m, id: answer.spawned, alive: answer.spawned > 0, seat: m.seats?.[0] ? [m.seats[0][0] - m.size[0] / 2, m.seats[0][1] - m.size[1] / 2, m.seats[0][2] - m.size[2] / 2] : undefined }
          if (thing.alive) { things.push(thing); wear(thing, (m.fine ?? []).flatMap((f) => { const kinds = kindsOf(f); return kinds ? [{ kinds, size: f.size, per: f.per, low: f.low }] : [] })) }
          next.done(thing)
        }
      }
      for (const id of told.broke) {
        const thing = things.find((t) => t.id === id)
        if (!thing) continue
        // Broken: it lives no more, and whoever rode it is on their own feet where it broke.
        thing.alive = false
        things.splice(things.indexOf(thing), 1)
        unwear(thing)
        if (riding === thing) mount(null)
      }
      for (const state of told.live) { const thing = things.find((t) => t.id === state.id); if (thing) thing.state = state }
      // The hardest blow each vehicle wearing a look took in this answer (#37): the core tells a pair's meeting each
      // step, and one crash is several of them.
      let hardest: Map<Thing, Struck> | null = null
      for (const s of told.struck) {
        struck.push(s)
        if (struck.length > 64) struck.shift()
        if (riding && (s.a === riding.id || s.b === riding.id) && (s.flags & 3) !== 0 && s.speed > 18) {
          const hit = Math.min(1, s.speed / 120)
          cam.shake(hit * 0.032)
          if (inside) cabin.jolt('hit', hit)
          o.fx?.sparks(s.at, hit)
          o.input.pulse?.('crash', hit)
        }
        if (s.speed < DENTS_FROM) continue
        for (const id of [s.a, s.b]) {
          const thing = id ? things.find((t) => t.id === id) : undefined
          if (!thing || (thing.controls ?? 'drive') !== 'drive' || (!looks.has(thing) && !thing.fine?.length && !thing.kept?.length)) continue
          hardest ??= new Map()
          if ((hardest.get(thing)?.speed ?? 0) < s.speed) hardest.set(thing, s)
        }
      }
      if (hardest) for (const [thing, s] of hardest) {
        const cracked = Math.max(...(dents.get(dentId(thing, 0))?.glassCrack ?? [0]))
        dent(thing, s, told.moves.find((m) => m.id === thing.id))
        if (s.speed >= CRASH_FROM && !reducedMotion.matches) {
          const hit = Math.min(1, s.speed / 120)
          // The ridden one already threw its sparks above.
          if (thing !== riding) o.fx?.sparks(s.at, hit)
          o.fx?.crash?.(s.at, hit, s.a === thing.id ? s.kindA : s.kindB, Math.max(...(dents.get(dentId(thing, 0))?.glassCrack ?? [0])) > cracked + 0.05)
        }
      }
    },
    damage: (thing) => dents.get(dentId(thing, 0)) ?? null,
    hit(thing, worldHit, worldNormal, speed, push = 4000) {
      if (!thing.alive || speed < DENTS_FROM || (thing.controls ?? 'drive') !== 'drive') return
      const cracked = Math.max(...(dents.get(dentId(thing, 0))?.glassCrack ?? [0]))
      applyDent(thing, worldHit, worldNormal, speed, push, undefined)
      if (speed >= CRASH_FROM && !reducedMotion.matches) {
        const strength = Math.min(1, speed / 120)
        o.fx?.sparks(worldHit, strength)
        o.fx?.crash?.(worldHit, strength, 12, Math.max(...(dents.get(dentId(thing, 0))?.glassCrack ?? [0])) > cracked + 0.05)
      }
    },
    repair: repairCar,
    frame(dt) {
      follow()
      // A struck engine steams, then smokes, then burns (#37), under the bonnet at its front: only near the eye, and
      // gentler where motion is to be reduced.
      if (o.fx?.engine) for (const [thing, worn] of looks) {
        let level = 0
        for (const w of worn) level = Math.max(level, w.piece.deform?.hoodDamage ?? 0)
        if (level < 0.35) continue
        const f = FRONTS[thing.motor.front], half = (thing.motor.front < 2 ? thing.size[0] : thing.size[2]) * 0.5
        const at = placeOf(thing, [thing.size[0] / 2 + f[0] * half * 0.62, thing.size[1] * 0.8, thing.size[2] / 2 + f[2] * half * 0.62])
        if (at && Math.hypot(at[0] - o.pose.x * M, at[1] - o.pose.y * M, at[2] - o.pose.z * M) < ENGINE_SEEN) o.fx.engine(at, level, reducedMotion.matches ? dt * 0.4 : dt)
      }
      // Near is near the body when there is one (#367): by the eye, which rides three metres behind someone on foot, a kart
      // right beside them was out of reach and E did nothing until they had walked past it.
      const eye = o.body?.() ?? [o.pose.x * M, o.pose.y * M, o.pose.z * M]
      if (!riding) {
        // The nearest thing within reach of an arm, and a few steps more.
        near = null
        let best = Infinity
        for (const thing of things) {
          const at = where(thing)
          if (!at) continue
          const far = Math.hypot(at.at[0] - eye[0], at.at[1] - eye[1], at.at[2] - eye[2]) - Math.max(...thing.size) / 2
          if (far < 45 && far < best) { best = far; near = thing }
        }
        reach(near !== null)
        if (cue && cue.thing !== near) { cue.remove(); cue = null }
        if (near && !cue) { const thing = near; cue = { thing, remove: o.hud.cue(`${coarse.matches ? '' : 'E  '}${SCHEMES[thing.controls ?? 'drive'].verb} the ${thing.name}`, () => { const at = where(thing); return at && [at.at[0], at.at[1] + thing.size[1] / 2 + 4, at.at[2]] }, () => { if (!riding && thing.alive) mount(thing) }).remove } }
        return false
      }
      if (cue) { cue.remove(); cue = null }
      const scheme = SCHEMES[riding.controls ?? 'drive'], axes = { go: 0, turn: 0, rise: 0 }
      const isDrive = scheme.name === 'drive'
      for (const line of scheme.lines) {
        if (line.once) continue
        const way = (o.input.held(line.keys[0]) ? 1 : 0) - (o.input.held(line.keys[1]) ? 1 : 0)
        for (const axis of ['go', 'turn', 'rise'] as const) if (line[axis]) axes[axis] += way * line[axis]
      }
      // Gamepad full analog driving axes (triggers + curved left stick) and smooth-curved touch thumbstick.
      const gp = o.input.driveAxes ?? null
      const stick = o.input.stick
      const hasTouch = o.input.thumb !== null
      if (isDrive && gp && !hasTouch) {
        axes.go = Math.max(-1, Math.min(1, axes.go + gp.go))
        axes.turn = Math.max(-1, Math.min(1, axes.turn + gp.turn))
        axes.rise = Math.max(-1, Math.min(1, axes.rise + gp.handbrake + held.rise))
      } else {
        const turnStick = isDrive ? touchSteerCurve(stick[0], 0) : stick[0]
        axes.go = Math.max(-1, Math.min(1, axes.go - stick[1] + (isDrive && gp ? gp.go : 0)))
        axes.turn = Math.max(-1, Math.min(1, axes.turn + turnStick + (isDrive && gp ? gp.turn : 0)))
        axes.rise = Math.max(-1, Math.min(1, axes.rise + held.rise + (isDrive && gp ? gp.handbrake : 0)))
      }
      const asked = once
      once = undefined
      if (asked === 'leave') { mount(null); return false }
      const boostAsk = isDrive && (o.input.held('ShiftLeft') || o.input.held('ShiftRight') || held.boost || (gp?.boost ?? 0) > 0.5)
      const rainWet = isDrive && o.fx ? Math.max(0, Math.min(1, o.fx.rain())) : 0
      // Said when it changes, and again four times a second: what a thing is told holds for a second only.
      const now = `${Math.round(axes.go * 1000)},${Math.round(axes.turn * 1000)},${Math.round(axes.rise * 1000)},${boostAsk ? 1 : 0},${Math.round(rainWet * 10)}`
      since += dt
      if (now !== said || asked || (since > 0.25 && (axes.go !== 0 || axes.turn !== 0 || axes.rise !== 0 || boostAsk))) {
        tell(riding, axes.go, axes.turn, axes.rise, asked, isDrive ? boostAsk : undefined, isDrive ? rainWet : undefined)
        said = now
        since = 0
      }
      // The head still turns, round the thing.
      const [right, up] = o.input.turn()
      const at = where(riding)
      // Driving telemetry, 6-speed gearbox, procedural engine/tire/road audio, and tire smoke / skidmarks / light pools.
      let longAcc = 0, latSpeed = 0, fwdSpeed = 0, horizSpeed = 0, slipAmt = 0, drifting = false, onWheels = riding.motor.feet.length, rough = 0
      let boostFuel = 1, boosting = false, launching = false, burnoutCharge = 0
      if (isDrive && at && dt > 0) {
        const wantHorn = o.input.held('KeyH') || held.horn
        if (wantHorn !== hornOn) { hornOn = wantHorn; o.audio?.horn(hornOn) }
        if (prevAt) {
          const ivx = (at.at[0] - prevAt[0]) / dt, ivy = (at.at[1] - prevAt[1]) / dt, ivz = (at.at[2] - prevAt[2]) / dt
          if (Math.hypot(ivx, ivy, ivz) < 2500) {
            const k = Math.min(1, dt * 16)
            velSm[0] += (ivx - velSm[0]) * k; velSm[1] += (ivy - velSm[1]) * k; velSm[2] += (ivz - velSm[2]) * k
          }
        }
        prevAt = [at.at[0], at.at[1], at.at[2]]
        const rightX = -at.front[2], rightZ = at.front[0]
        const rawFwd = velSm[0] * at.front[0] + velSm[2] * at.front[2]
        fwdSpeed = riding.state ? riding.state.speed * 0.65 + rawFwd * 0.35 : rawFwd
        latSpeed = velSm[0] * rightX + velSm[2] * rightZ
        horizSpeed = Math.hypot(velSm[0], velSm[2])
        longAcc = Math.max(-220, Math.min(220, (fwdSpeed - prevFwd) / Math.max(dt, 0.008)))
        prevFwd = fwdSpeed
        onWheels = riding.state ? riding.state.feet : riding.motor.feet.length
        const grounded = onWheels >= 2
        boostFuel = riding.state ? riding.state.boost : 1
        boosting = riding.state ? riding.state.boosting : false
        launching = riding.state ? riding.state.launching : false
        burnoutCharge = riding.state ? riding.state.burnout : 0
        // Suspension landing thump & camera punch after cresting an SF hill.
        if (prevOn === 0 && onWheels >= 2 && velSm[1] < -20) {
          const drop = Math.min(1, (-velSm[1] - 18) / 70)
          o.audio?.event('thump', 0.4 + drop * 0.6)
          o.input.pulse?.('land', 0.4 + drop * 0.6)
          cam.shake(0.01 + drop * 0.024)
          if (inside) cabin.jolt('land', 0.35 + drop * 0.65)
        }
        prevOn = onWheels
        const handbraking = axes.rise > 0.1
        const braking = (axes.go < -0.1 && fwdSpeed > 8) || (axes.go > 0.1 && fwdSpeed < -8)
        const slipAngle = horizSpeed > 18 ? Math.abs(Math.atan2(latSpeed, Math.abs(fwdSpeed) + 8)) : 0
        drifting = grounded && horizSpeed > 26 && (slipAngle > 0.17 || (handbraking && Math.abs(axes.turn) > 0.15 && horizSpeed > 28))
        const burnout = grounded && ((handbraking && axes.go > 0.5 && horizSpeed < 38) || burnoutCharge > 0.05) ? Math.min(1, 0.75 + burnoutCharge * 0.25) : 0
        const launchSlip = grounded && launching ? 0.58 : 0
        const lockup = grounded && braking && Math.abs(fwdSpeed) > 35 && Math.abs(axes.go) > 0.6 ? 0.45 : 0
        slipAmt = grounded ? Math.max(0, Math.min(1, Math.max(burnout, launchSlip, lockup, (slipAngle - 0.12) * 1.9 + (handbraking && horizSpeed > 24 ? 0.42 : 0)))) : 0
        // 6-speed gearbox + rev limiter + upshift/overrun/nitrous exhaust bursts.
        const top = Math.max(120, riding.motor.top)
        const RATIOS = [0, 0.21, 0.36, 0.52, 0.69, 0.85, 1.06]
        shiftCool = Math.max(0, shiftCool - dt)
        popCool = Math.max(0, popCool - dt)
        const exhaustDir = [-at.front[0], 0.12, -at.front[2]] as const
        const rearTip = placeOf(riding, [riding.motor.front === 0 ? 1 : riding.motor.front === 1 ? riding.size[0] - 1 : riding.size[0] * 0.5, 2.5, riding.motor.front === 2 ? 1 : riding.motor.front === 3 ? riding.size[2] - 1 : riding.size[2] * 0.5])
        if (boosting && !wasBoosting) {
          o.audio?.event('pop', 0.85)
          if (rearTip) o.fx?.exhaust(rearTip, exhaustDir, false, true)
        }
        if (launching && !wasLaunching) {
          o.audio?.event('pop', 0.72)
          if (rearTip) o.fx?.exhaust(rearTip, exhaustDir, true)
        }
        if (boosting) {
          boostAcc += dt * 28
          if (boostAcc >= 1) {
            boostAcc -= Math.floor(boostAcc)
            if (rearTip) o.fx?.exhaust(rearTip, exhaustDir, false, true)
          }
        } else {
          boostAcc = 0
        }
        wasBoosting = boosting
        wasLaunching = launching
        if (fwdSpeed < -6 && axes.go < -0.1) {
          gear = -1
          const want = 0.22 + Math.min(0.68, Math.abs(fwdSpeed) / (top * 0.35))
          rpm += (want - rpm) * Math.min(1, dt * 10)
        } else if (Math.abs(fwdSpeed) < 5 && Math.abs(axes.go) < 0.05) {
          gear = 0
          rpm += (0.15 - rpm) * Math.min(1, dt * 6)
        } else {
          if (gear <= 0 || (burnout > 0 && fwdSpeed < 22)) gear = 1
          const hi = top * RATIOS[gear], lo = gear === 1 ? 0 : top * RATIOS[gear - 1] * 0.62
          let want = 0.2 + 0.78 * Math.max(0, Math.min(1.05, (Math.max(0, fwdSpeed) - lo) / Math.max(18, hi - lo)))
          if (burnout > 0 || !grounded) want = Math.max(want, 0.22 + Math.max(0, axes.go) * 0.74)
          if (boosting) want = Math.max(want, 0.78 + Math.min(0.2, fwdSpeed / top * 0.2))
          if (drifting && axes.go > 0.2) want = Math.max(want, 0.68 + slipAmt * 0.24)
          if (gear < 6 && want > 0.91 && shiftCool <= 0 && axes.go > 0.2 && grounded && burnout === 0) {
            gear++
            shiftCool = 0.32
            rpm = Math.max(0.46, rpm - 0.34)
            o.audio?.event('shift', 0.68 + Math.min(0.3, Math.abs(axes.go) * 0.25))
            o.input.pulse?.('shift', 0.5 + Math.min(0.4, Math.abs(axes.go) * 0.4))
            if (inside) cabin.jolt('shift', 0.45 + Math.min(0.45, Math.abs(axes.go) * 0.45))
            if (gear >= 2 && top >= 260 && popCool <= 0) {
              popCool = 0.55
              o.audio?.event('pop', 0.65)
              if (rearTip) o.fx?.exhaust(rearTip, exhaustDir, true)
            }
          } else if (gear > 1 && want < 0.32 && shiftCool <= 0) {
            gear--
            shiftCool = 0.24
            rpm = Math.min(0.78, rpm + 0.22)
          } else {
            rpm += (Math.min(0.99, want) - rpm) * Math.min(1, dt * (want > rpm ? 11 : 7))
          }
          // High-RPM throttle lift-off overrun backfire pop!
          if (wasThrottle > 0.65 && axes.go <= 0.05 && rpm > 0.58 && popCool <= 0 && horizSpeed > 35) {
            popCool = 0.85
            o.audio?.event('pop', 0.75)
            if (rearTip) o.fx?.exhaust(rearTip, exhaustDir, true)
          }
        }
        wasThrottle = axes.go
        const kmh = Math.abs(fwdSpeed) * 0.36
        const mat = o.fx ? o.fx.surface(Math.round(at.at[0]), Math.round(at.at[2])) : 6
        // Materials 1..4 are earth, rock, grass, sand (earth/grass/sand off-road); 6..12 are asphalt, concrete, brick, etc. (paved).
        const offroad = mat === 1 || mat === 3 || mat === 4 || mat === 13
        const paved = !offroad
        const wet = rainWet > 0.2
        rough = grounded ? (paved ? (wet ? 0.32 : 0.05) : 0.9) : 0
        const tone = Math.max(0, Math.min(1, (top - 180) / 360))
        const load = Math.max(0, Math.min(1, (axes.go > 0.05 ? 0.45 + 0.55 * axes.go : 0.1) + (drifting || boosting ? 0.25 : 0)))
        const turbo = boosting ? 1 : Math.min(0.65, burnoutCharge * 0.5 + (launching ? 0.55 : 0))
        o.audio?.drive({ rpm, load, tone, slip: slipAmt, roll: grounded ? Math.min(1, horizSpeed / 260) : 0, rough, boost: turbo })
        o.input.rumble?.({ rpm, slip: slipAmt, rough, speed: horizSpeed, grounded, drifting, boost: boosting ? 1 : (gp?.boost ?? 0) })
        const motion = reducedMotion.matches ? 0 : 1
        boostFovPunch += (motion * (boosting ? 5.5 : launching ? 2.2 : 0) - boostFovPunch) * Math.min(1, dt * 6.5)
        boostEnergyPunch += (motion * (boosting ? 0.35 : 0) - boostEnergyPunch) * Math.min(1, dt * 5.5)
        updateDriveHud(kmh, gear, rpm, drifting, boostFuel, boosting, burnoutCharge)
        telemetryNow = { kmh, gear, rpm, slip: slipAmt, drifting, cam: cam.mode, fovAdd: cam.fovAdd + boostFovPunch, boost: boostFuel, boosting, burnout: burnoutCharge, surface: offroad ? 'offroad' : wet ? 'wet' : 'paved' }
        wheelDriveNow = { id: riding.id, steer: axes.turn, throttle: axes.go, brake: braking ? Math.min(1, Math.abs(axes.go)) : 0, handbrake: handbraking, fwdSpeed, latSpeed, slip: slipAmt, drifting, burnout, decel: Math.max(0, -longAcc) }
        // Sync dynamic vehicle lamp emissives (brake, reverse, headlights) on the vehicle body & fine look pieces.
        const dark = o.fx ? Math.max(0, Math.min(1, 1 - o.fx.day() * 1.15)) : 0
        const headLevel = headlightLevel(dark)
        const lampBrake = braking || handbraking || (axes.go < -0.1 && fwdSpeed >= -2 && gear !== -1) ? (handbraking ? 1.25 : 1) : 0
        const lampRev = gear === -1 ? 1 : 0
        lampState[0] = lampBrake; lampState[1] = lampRev; lampState[2] = headLevel; lampState[3] = riding.motor.front + 1
        setLamps(riding, lampState)
        // Tire smoke, skidmarks, and road light pools (brake glow, nitrous splash, reverse pool, and headlights).
        if (o.fx) {
          const rearFeet = riding.motor.feet.filter((f) => f.drives || !f.steers)
          const wheels = rearFeet.length ? rearFeet : riding.motor.feet
          smokeAcc += dt * (14 + slipAmt * 28)
          const emitSmoke = smokeAcc >= 1
          if (emitSmoke) smokeAcc -= Math.floor(smokeAcc)
          const smokeCol: readonly [number, number, number] = wet ? [0.76, 0.83, 0.90] : paved ? [0.85, 0.85, 0.88] : [0.64, 0.52, 0.36]
          const trackCol: readonly [number, number, number] = paved ? (wet ? [0.03, 0.04, 0.055] : [0.04, 0.04, 0.045]) : [0.16, 0.11, 0.07]
          for (let i = 0; i < wheels.length; i++) {
            const f = wheels[i], p = placeOf(riding, [f.at[0], f.at[1] - f.reach * 0.72, f.at[2]])
            if (!p || !grounded) { o.fx.lift(i); continue }
            const markStrength = slipAmt > 0.16 ? slipAmt : 0
            if (markStrength > 0) o.fx.track(i, p, markStrength, trackCol)
            else o.fx.lift(i)
            const puffLevel = Math.max(slipAmt, wet && horizSpeed > 55 ? Math.min(0.55, (horizSpeed - 50) / 140) : 0, !paved && horizSpeed > 30 ? Math.min(0.65, horizSpeed / 120) : 0)
            if (emitSmoke && puffLevel > 0.14) o.fx.smoke(p, [-velSm[0] * 0.15, 6 + puffLevel * 12, -velSm[2] * 0.15], puffLevel, smokeCol)
          }
          // Red brake-light / cyan nitrous asphalt splash, white reverse pool in R, and headlight cones when on.
          const dir2: readonly [number, number] = [at.front[0], at.front[2]]
          const halfLen = (riding.motor.front < 2 ? riding.size[0] : riding.size[2]) * 0.5
          const halfWide = (riding.motor.front < 2 ? riding.size[2] : riding.size[0]) * 0.5
          if (boosting) {
            const nosPos: readonly [number, number, number] = [at.at[0] - at.front[0] * (halfLen + 11), at.at[1], at.at[2] - at.front[2] * (halfLen + 11)]
            o.fx.light(nosPos, dir2, [18, halfWide + 12], [0.18, 0.72, 1.0], 0.42 + dark * 0.38 + (wet ? 0.18 : 0))
          } else if (lampBrake > 0) {
            const backPos: readonly [number, number, number] = [at.at[0] - at.front[0] * (halfLen + 9), at.at[1], at.at[2] - at.front[2] * (halfLen + 9)]
            o.fx.light(backPos, dir2, [14, halfWide + 10], [1.0, 0.08, 0.03], (0.28 + dark * 0.45 + (wet ? 0.2 : 0)) * (handbraking ? 1.15 : 1))
          } else if (headLevel > 0) {
            const tailPos: readonly [number, number, number] = [at.at[0] - at.front[0] * (halfLen + 6), at.at[1], at.at[2] - at.front[2] * (halfLen + 6)]
            o.fx.light(tailPos, dir2, [8, halfWide + 5], [0.95, 0.06, 0.02], (0.06 + dark * 0.22) * Math.min(1, headLevel))
          }
          if (lampRev > 0) {
            const revPos: readonly [number, number, number] = [at.at[0] - at.front[0] * (halfLen + 11), at.at[1], at.at[2] - at.front[2] * (halfLen + 11)]
            o.fx.light(revPos, dir2, [13, halfWide + 7], [0.92, 0.96, 1.0], 0.12 + dark * 0.34 + (wet ? 0.12 : 0))
          }
          if (headLevel > 0) {
            const hi = headLevel > 1.2
            const reach = hi ? 96 : 68
            const beamPos: readonly [number, number, number] = [at.at[0] + at.front[0] * (halfLen + reach), at.at[1], at.at[2] + at.front[2] * (halfLen + reach)]
            o.fx.light(beamPos, dir2, [hi ? 104 : 74, halfWide + (hi ? 34 : 26)], hi ? [1.0, 0.97, 0.90] : [1.0, 0.93, 0.78], (0.12 + dark * 0.88) * (hi ? 0.52 : 0.34) + (wet ? 0.12 * dark : 0))
          }
        }
      } else if (telemetryNow || wheelDriveNow) {
        telemetryNow = null
        wheelDriveNow = null
        o.audio?.drive(null)
        o.input.rumble?.(null)
      }

      if (inside && at) {
        // In the seat: spring-damped head G-force inertia, windshield rain/wipers, and interior night dash glow (cockpit.ts).
        const g = cabin.frame({
          dt, longAcc, latSpeed, fwdSpeed, vertVel: velSm[1], steer: axes.turn, rough,
          rain: o.fx ? o.fx.rain() : 0, day: o.fx ? o.fx.day() : 1, rpm, drifting,
          reducedMotion: reducedMotion.matches, isDrive, topSpeed: Math.max(120, riding.motor.top),
        })
        const baseEye = eyeOf(riding), f = FRONTS[riding.motor.front], r = [-f[2], 0, f[0]]
        const sitting = placeOf(riding, [baseEye[0] + f[0] * g.fwd + r[0] * g.lat, baseEye[1] + g.up, baseEye[2] + f[2] * g.fwd + r[2] * g.lat])
        if (sitting) {
          head[0] += right
          head[1] = Math.max(-1.4, Math.min(1.2, head[1] + up))
          o.pose.x = sitting[0] / M; o.pose.y = sitting[1] / M; o.pose.z = sitting[2] / M
          o.pose.tilt = [...at.rot]
          o.pose.yaw = AHEADS[riding.motor.front] + head[0] + g.yaw + (gp?.lookBack || o.input.held('KeyX') ? Math.PI : 0)
          o.pose.pitch = Math.max(-1.45, Math.min(1.25, head[1] + g.pitch))
          facing = Math.atan2(at.front[0], -at.front[2])
          was = null
          seatRoll = g.roll
          if (isDrive) {
            cam.frameSeat(dt, fwdSpeed, Math.max(120, riding.motor.top), reducedMotion.matches)
            if (telemetryNow) telemetryNow.fovAdd = cam.fovAdd + boostFovPunch
          } else {
            o.lens?.(0, g.roll, 0)
          }
          return true
        }
      }
      if (at && isDrive) {
        facing = Math.atan2(at.front[0], -at.front[2])
        const parts = riding.fine ?? riding.kept
        let x0 = 0, y0 = 0, z0 = 0, x1 = riding.size[0], y1 = riding.size[1], z1 = riding.size[2]
        if (parts?.length) {
          for (const p of parts) {
            x0 = Math.min(x0, p.low[0]); y0 = Math.min(y0, p.low[1]); z0 = Math.min(z0, p.low[2])
            x1 = Math.max(x1, p.low[0] + p.size[0] / p.per)
            y1 = Math.max(y1, p.low[1] + p.size[1] / p.per)
            z1 = Math.max(z1, p.low[2] + p.size[2] / p.per)
          }
        }
        cam.frame({
          dt, at: at.at, rot: at.rot, front: at.front,
          size: riding.size, visualBox: [x0, y0, z0, x1, y1, z1],
          frontAxis: riding.motor.front, topSpeed: Math.max(120, riding.motor.top),
          place: (local) => placeOf(riding!, local),
          vel: velSm, fwdSpeed, latSpeed, horizSpeed, longAcc: longAcc + (boosting ? 75 : launching ? 45 : 0), steer: axes.turn, drifting,
          feet: onWheels, turn: [right, up], lookBack: o.input.held('KeyX') || !!gp?.lookBack, reducedMotion: reducedMotion.matches,
        })
        if (telemetryNow) telemetryNow.fovAdd = cam.fovAdd + boostFovPunch
        return true
      }
      o.pose.yaw += right
      o.pose.pitch = Math.max(-1.4, Math.min(1.2, o.pose.pitch + up))
      if (at) {
        // The eye turns with the thing, and stays behind and above it wherever the head is turned.
        const yaw = Math.atan2(at.front[0], -at.front[2])
        let by = yaw - facing
        if (by > Math.PI) by -= 2 * Math.PI
        if (by < -Math.PI) by += 2 * Math.PI
        o.pose.yaw += by
        facing = yaw
        const cp = Math.cos(o.pose.pitch), look = [Math.sin(o.pose.yaw) * cp, Math.sin(o.pose.pitch), -Math.cos(o.pose.yaw) * cp]
        const back = (Math.max(...riding.size) * 1.5 + 25) / M, high = (riding.size[1] * 0.6 + 6) / M
        // Not through a wall (#367), as the eye on foot (person.ts `clearWay`): from over the thing's middle out to where
        // the eye would ride, as far as the way is clear; in at once, out again slowly. Driven beside house fronts the
        // eye was inside them for 70 frames of 166, and a frame drawn from inside a wall took 50 ms.
        const head = [at.at[0], at.at[1] + riding.size[1] / 2 + 6, at.at[2]], wantY = Math.max(at.at[1] + (high - look[1] * back) * M, o.ground(at.at[0] / M - look[0] * back, at.at[2] / M - look[2] * back) * M + 4)
        const off = [-look[0] * back * M, wantY - head[1], -look[2] * back * M], free = clearWay(stands, head, off)
        // Where the thing will be in a third of a second, by how it moved since the last frame.
        const going = was && dt > 0 ? [(head[0] - was[0]) / dt * AHEAD, (head[2] - was[2]) / dt * AHEAD] : [0, 0], far = Math.hypot(going[0], going[1])
        was = [head[0], head[1], head[2]]
        room = roomAfter(room, free, far > 0.5 && far < 60 ? clearWay(stands, [head[0] + going[0], head[1], head[2] + going[1]], off) : 1, dt)
        o.pose.x = (head[0] + off[0] * room) / M
        o.pose.y = (head[1] + off[1] * room) / M
        o.pose.z = (head[2] + off[2] * room) / M
      }
      return true
    },
  }
}

/** A kind of cell: a material and a colour of the palette (the core's kinds.rs). */
const kind = (material: number, colour = 0) => material | (colour << 8)
const STEEL = 12, GLASS = 11, LAMP = 15, hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)

/** The hand-written car's coarse physics body (10 cm cells). */
function carBody(low: [number, number, number]): Making {
  const size: [number, number, number] = [42, 10, 18], cells = new Int32Array(size[0] * size[1] * size[2])
  const set = (x: number, y: number, z: number, k: number) => { cells[x + size[0] * (z + size[2] * y)] = k }
  const paint = kind(STEEL, hue(0, 4)), dark = kind(STEEL, 13), glass = kind(GLASS)
  for (let y = 2; y < 10; y++) for (let z = 1; z < 17; z++) for (let x = 0; x < 42; x++) {
    const cabin = y >= 6, inX = cabin ? x >= 10 && x < 31 : true
    if (!inX) continue
    const x0 = cabin ? 10 : 0, x1 = cabin ? 30 : 41, y0 = cabin ? 6 : 2, y1 = cabin ? 9 : 5
    const shell = x === x0 || x === x1 || z === 1 || z === 16 || y === y0 || y === y1
    if (!shell) continue
    // A cabin's walls are glass under a steel roof; the floor of the cabin is the body's top.
    set(x, y, z, cabin && y < 9 && y > 6 ? glass : paint)
  }
  // Lamps in front, and four wheels that stand a cell proud of the body.
  for (const z of [3, 4, 13, 14]) for (const y of [3, 4]) set(41, y, z, kind(LAMP))
  for (const x0 of [4, 32]) for (const z of [0, 17]) for (let x = x0; x < x0 + 6; x++) for (let y = 0; y < 6; y++) {
    const round = (x === x0 || x === x0 + 5) && (y === 0 || y === 5)
    if (!round) set(x, y, z, dark)
  }
  const foot = (x: number, z: number, front: boolean): Foot => ({ at: [x, 3, z], reach: 6, steers: front, drives: !front })
  return {
    name: 'car', cells, size, low, controls: 'drive',
    motor: { front: 0, grip: 1.3, power: 60, top: 200, steer: 0.55, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 120, feet: [foot(7, 1, false), foot(7, 17, false), foot(35, 1, true), foot(35, 17, true)] },
  }
}

/**
 * The hand-written car (#245, #61): every car wears a 2.5 cm sculpted coupe look (car-sculpt.ts, #39) at 4.2 m by
 * 1.3 m by 1.8 m, its wheels on `carBody`'s feet, polished paint (spells.ts `POLISHED`), seats, dash and steering
 * wheel inside (V from the seat), so every car dents. About 150,000 filled cells of 630,000.
 */
export function car(low: [number, number, number]): Making {
  const body = carBody(low), { cells, size } = sculptCoupe({ L: 4.2, H: 1.3, W: 1.8, per: 4, wheels: [0.7, 3.5], wheelY: 0.3, wheelR: 0.3, tyreW: 0.22, eye: [1.9, 1.0, 0.55], paint: kind(STEEL, hue(0, 4)) | POLISHED })
  // The driver's eye over the left front seat, in the body's cells: 1 m over the ground, a little behind the wheel. A seat is where a
  // sitting rider's feet are drawn, their eye 1.2 m over them (`SITTING_EYE`): low, so that their head is under the roof.
  return { ...body, name: 'car', fine: [{ size, per: 4, low: [0, 0, 0], cells }], seats: [[19.5, -1.5, 5.5], [19.5, -1.5, 12.5]], eye: [19, 10, 5.5] }
}

/** Alias kept for callers and `?living=finecar` (#61: every car wears a fine look). */
export const fineCar = car
