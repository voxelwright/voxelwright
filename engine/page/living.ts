// Living things on the page (#245): a thing that is a body for as long as it lives (the core's
// bodies/living.rs), that a person can get on and drive. The page decides nothing about how it
// moves: it says what the keys ask (go, turn, rise, roll, jump) again and again, and the solver's
// motor does the rest. A thing's motor and its control scheme are data, so a model can write
// them with the thing; nothing here is run.
import { AHEAD, clearWay, roomAfter, standsBy } from './eye.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Answer, Ask } from './mover.ts'
import type { Piece } from './pieces.ts'
import type { Struck, Told } from './told.ts'
import type { Link } from './link.ts'
import type { Things } from './things.ts'

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
const RISE: Binding = { keys: ['Space', 'KeyC'], shown: 'Space C', does: 'up and down', rise: 1 }
export const SCHEMES: Record<'drive' | 'fly' | 'hover' | 'ride', Scheme> = {
  drive: { name: 'drive', verb: 'drive', lines: [{ ...GO, does: 'drive and reverse' }, { ...TURN, does: 'steer' }, LEAVE] },
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
export interface Controls { scheme: keyof typeof SCHEMES; motor: Motor; /** Where its riders sit, each where their feet are, in its own cells from its low corner; and its size in cells, to place them by. */ seats?: [number, number, number][]; size?: [number, number, number]; rest?: { at: [number, number, number]; rot: [number, number, number, number] } }
const finite = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x))
/** A record's `controls`, if it is one that can be used; else null. The core clamps every number of the motor. */
export function controlsOf(value: unknown): Controls | null {
  const c = value as Partial<Controls> | null, m = c?.motor as Partial<Motor> | undefined
  if (!c || typeof c !== 'object' || typeof c.scheme !== 'string' || !Object.hasOwn(SCHEMES, c.scheme) || !m || typeof m !== 'object') return null
  const plain = ['front', 'grip', 'power', 'top', 'steer', 'hover', 'lift', 'upright', 'turns', 'jump', 'tough'] as const
  if (!plain.every((k) => typeof m[k] === 'number' && Number.isFinite(m[k])) || !Array.isArray(m.feet) || m.feet.length > 16) return null
  const feet: Foot[] = []
  for (const f of m.feet as Partial<Foot>[]) {
    if (!f || !finite(f.at, 3) || typeof f.reach !== 'number' || !Number.isFinite(f.reach)) return null
    feet.push({ at: [f.at[0], f.at[1], f.at[2]], reach: f.reach, steers: f.steers === true, drives: f.drives === true })
  }
  const motor = { ...Object.fromEntries(plain.map((k) => [k, m[k]])), feet } as unknown as Motor
  const rest = c.rest && finite(c.rest.at, 3) && finite(c.rest.rot, 4) ? { at: [...c.rest.at] as [number, number, number], rot: [...c.rest.rot] as [number, number, number, number] } : undefined
  const seats = Array.isArray(c.seats) && c.seats.length <= 8 && c.seats.every((s) => finite(s, 3)) && finite(c.size, 3) ? { seats: c.seats.map((s) => [s[0], s[1], s[2]] as [number, number, number]), size: [...c.size!] as [number, number, number] } : {}
  return { scheme: c.scheme, motor, ...seats, ...(rest ? { rest } : {}) }
}

/** A thing to bring to life: its cells (one kind each, laid out x, then z, then y), size and low corner in the world's cells, how it moves and how it is driven. */
export interface Making { name: string; cells: Int32Array; size: [number, number, number]; low: [number, number, number]; motor: Motor; controls?: keyof typeof SCHEMES; take?: boolean }
export interface Thing extends Making { id: number; alive: boolean; /** In a shared world: the id of its record there. */ ref?: string; /** How it is doing, as the solver last said: its speed along its front (cells a second), feet on the ground, touches, what it is told. */ state?: Told['live'][number]; /** Where its first rider sits, from its middle, in its own cells (its record's `seats`): for drawing whoever rides it from this page. */ seat?: [number, number, number] }

export interface Living {
  /** Brings a thing to life. Resolves when the solver has made it; its id is 0 if it could not. */
  spawn(making: Making): Promise<Thing>
  /** What the solver said: things made, things broken, what struck what. */
  heard(answer: Answer, told: Told): void
  /** A frame: what the keys ask of the thing ridden, the cue for one near, and where the eye is if it rides. True while it rides (the eye is then not the page's to move). */
  frame(dt: number): boolean
  /** Gets on a thing, or off (null). */
  mount(thing: Thing | null): void
  /** Where whoever rides from this page sits now and which way they face (cells; 0 is north), as the world's process places every rider (rules/things.mjs `carry`): in the thing's first seat, or its middle. Null when nobody rides. */
  readonly rider: { at: [number, number, number]; yaw: number } | null
  /** Tells a thing what to do as its rider would, for a check or a script: held for a second unless said again. */
  drive(thing: Thing, go: number, turn: number, rise: number, once?: 'roll' | 'jump'): void
  readonly things: Thing[]
  readonly riding: Thing | null
  /** The thing near enough to get on. */
  readonly near: Thing | null
  /** The last impacts told, newest last (at most 64). */
  readonly struck: Struck[]
  /** Where a thing is: its middle of mass (cells), how it is turned, and which way its front points along the ground. */
  where(thing: Thing): { at: [number, number, number]; rot: [number, number, number, number]; front: [number, number, number] } | null
}

const FRONTS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const
const turned = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
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
  /** The eye: metres, and which way it looks. */
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  /** How high the ground is at a place (metres). */
  ground(x: number, z: number): number
  /** What a cell of the world is made of (0: nothing), as this page has it: for keeping the eye that rides out of what stands. */
  kind?: (x: number, y: number, z: number) => number
  /** In a shared world: the page's line to it, and the made things it knows. The world's own process moves every living thing; this page only says what a rider asks. */
  world?: Link | null
  /** The page's person gets on a thing (true) or is set down off it (false): a body on foot is taken up and put down. */
  ridden?: (on: boolean) => void
  made?: () => Things
}): Living {
  const M = 10
  const things: Thing[] = [], waiting: { making: Making; done: (thing: Thing) => void }[] = [], struck: Struck[] = []
  let riding: Thing | null = null, near: Thing | null = null
  // The eye that rides: how much of the way back it is (0 to 1), and what it is kept out of.
  let room = 1, was: number[] | null = null
  const stands = standsBy(o.kind)
  // What was last said to the thing ridden and when, where the thing faced, and what is asked once (a roll, a jump, getting off).
  let said = '', since = 0, facing = 0, once: 'roll' | 'jump' | 'leave' | undefined
  let cue: { thing: Thing; remove(): void } | null = null, leave: (() => void) | null = null
  // A phone has no keys: the cue is touched to get on, the left thumb's stick drives, and what a scheme's other
  // keys do is a row of buttons while riding (held ones for up and down, touched ones for what is done once).
  const touch = navigator.maxTouchPoints > 0
  const held = { rise: 0 }
  const buttons = o.hud.panel('living')
  buttons.style.cssText = 'position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(110px,env(safe-area-inset-bottom));display:none;flex-direction:column;gap:8px;pointer-events:auto'
  const button = (words: string, press: () => void, release?: () => void) => {
    const b = document.createElement('button')
    b.textContent = words
    b.style.cssText = 'min-width:84px;padding:12px 14px;border:0;border-radius:12px;background:rgba(12,16,22,0.72);color:#e8ecf1;font:600 14px -apple-system,system-ui,sans-serif;touch-action:manipulation'
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press() })
    if (release) for (const up of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(up, release)
    return b
  }
  const showButtons = (scheme: Scheme | null) => {
    held.rise = 0
    buttons.style.display = scheme && touch ? 'flex' : 'none'
    if (!scheme) return
    buttons.replaceChildren(...scheme.lines.flatMap((line) => line.once ? [button(line.does, () => { once = line.once })] : line.rise ? [button('up', () => { held.rise = 1 }, () => { held.rise = 0 }), button('down', () => { held.rise = -1 }, () => { held.rise = 0 })] : []))
  }
  // Beside a thing, E gets on it: a mode that is there only while the cue is, and takes that one key.
  let beside: (() => void) | null = null
  const reach = (on: boolean) => {
    if (on && !beside) beside = o.input.push({ name: 'beside', key: (code) => { if (code !== 'KeyE' || !near || riding) return false; mount(near); return true } })
    // Taken off only from the top: taking it from under another mode would take that one off too.
    else if (!on && beside && o.input.top === 'beside') { beside(); beside = null }
  }
  const where: Living['where'] = (thing) => {
    const piece = o.piece(thing.id)
    if (!piece) return null
    const f = turned(piece.rot, FRONTS[thing.motor.front]), flat = Math.hypot(f[0], f[2]) || 1
    return { at: piece.pos, rot: piece.rot, front: [f[0] / flat, 0, f[2] / flat] }
  }
  const tell = (thing: Thing, go: number, turn: number, rise: number, once?: 'roll' | 'jump') => {
    if (o.world) { if (thing.ref) o.world.drive(thing.ref, go, turn, rise, once); return }
    o.send({ drive: { id: thing.id, go, turn, rise, roll: once === 'roll', jump: once === 'jump' } })
    o.wake()
  }
  // In a shared world a thing lives when the world says which body it is: what it is comes from its record.
  const hoped = new Map<string, (thing: Thing) => void>()
  if (o.world) o.world.onliving = ({ thing: ref, body }) => {
    const was = things.findIndex((t) => t.ref === ref)
    if (was >= 0) { const old = things[was]; old.alive = false; things.splice(was, 1); if (riding === old) mount(null) }
    const record = o.made?.().all.get(ref), controls = controlsOf(record?.controls)
    if (!body || !record || !controls) return
    const b = record.box, thing: Thing = { id: body, ref, alive: true, name: record.name, cells: new Int32Array(0), size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]], low: [b[0], b[1], b[2]], motor: controls.motor, controls: controls.scheme, seat: controls.seats?.[0] && controls.size ? [controls.seats[0][0] - controls.size[0] / 2, controls.seats[0][1] - controls.size[1] / 2, controls.seats[0][2] - controls.size[2] / 2] : undefined }
    things.push(thing)
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
    riding = thing?.alive ? thing : null
    said = ''
    // The world is told who rides what, and a body on foot is taken up or set down.
    if (was !== riding) {
      if (was?.ref) o.world?.ride(was.ref, false)
      if (riding?.ref) o.world?.ride(riding.ref, true)
      if (!was !== !riding) o.ridden?.(!!riding)
    }
    const at = riding && where(riding)
    if (riding && at) {
      // The eye goes behind it, looking the way it faces and a little down.
      facing = Math.atan2(at.front[0], -at.front[2])
      o.pose.yaw = facing
      o.pose.pitch = -0.22
    }
    const scheme = riding && SCHEMES[riding.controls ?? 'drive']
    o.hud.card(riding && scheme ? { title: riding.name, rows: scheme.lines.map((line) => [line.shown, line.does] as const) } : null)
    // Riding is a mode of its own: the keys and the look are the thing's, and the keys that are pressed once are taken here.
    leave?.()
    reach(false)
    leave = scheme ? o.input.push({ name: 'mounted', solid: true, key: (code) => { const line = scheme.lines.find((l) => l.once && l.keys[0] === code); if (line) once = line.once; return !!line } }) : null
    once = undefined
    showButtons(scheme || null)
  }

  return {
    things, struck, where, mount,
    get riding() { return riding },
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
        void o.world.ask({ edit: [1, r.length / 5, ...r], release: [making.low[0] - 2, making.low[1] + 1, making.low[2]], thing: { id: ref, name: making.name, wish: '', at: [making.low[0] + (making.size[0] >> 1), making.low[1], making.low[2] + (making.size[2] >> 1)], size: making.size, facing: 'east', controls: { scheme: making.controls ?? 'drive', motor: making.motor } satisfies Controls } }).then((taken) => { if (!taken) none() })
        setTimeout(() => { if (hoped.has(ref)) none() }, 10_000)
        return
      }
      waiting.push({ making, done })
      o.send({ spawn: { cells: making.cells, size: making.size, low: making.low, take: making.take, motor: numbers(making.motor) } })
    }),
    drive: tell,
    heard(answer, told) {
      if (answer.spawned !== undefined) {
        const next = waiting.shift()
        if (next) { const thing: Thing = { ...next.making, id: answer.spawned, alive: answer.spawned > 0 }; if (thing.alive) things.push(thing); next.done(thing) }
      }
      for (const id of told.broke) {
        const thing = things.find((t) => t.id === id)
        if (!thing) continue
        // Broken: it lives no more, and whoever rode it is on their own feet where it broke.
        thing.alive = false
        things.splice(things.indexOf(thing), 1)
        if (riding === thing) mount(null)
      }
      for (const state of told.live) { const thing = things.find((t) => t.id === state.id); if (thing) thing.state = state }
      for (const s of told.struck) { struck.push(s); if (struck.length > 64) struck.shift() }
    },
    frame(dt) {
      const eye = [o.pose.x * M, o.pose.y * M, o.pose.z * M]
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
        if (near && !cue) { const thing = near; cue = { thing, remove: o.hud.cue(`${touch ? '' : 'E  '}${SCHEMES[thing.controls ?? 'drive'].verb} the ${thing.name}`, () => { const at = where(thing); return at && [at.at[0], at.at[1] + thing.size[1] / 2 + 4, at.at[2]] }, () => { if (!riding && thing.alive) mount(thing) }).remove } }
        return false
      }
      if (cue) { cue.remove(); cue = null }
      const scheme = SCHEMES[riding.controls ?? 'drive'], axes = { go: 0, turn: 0, rise: 0 }
      for (const line of scheme.lines) {
        if (line.once) continue
        const way = (o.input.held(line.keys[0]) ? 1 : 0) - (o.input.held(line.keys[1]) ? 1 : 0)
        for (const axis of ['go', 'turn', 'rise'] as const) if (line[axis]) axes[axis] += way * line[axis]
      }
      // A phone's left thumb: forward and back, left and right.
      const stick = o.input.stick
      axes.go = Math.max(-1, Math.min(1, axes.go - stick[1]))
      axes.turn = Math.max(-1, Math.min(1, axes.turn + stick[0]))
      axes.rise = Math.max(-1, Math.min(1, axes.rise + held.rise))
      const asked = once
      once = undefined
      if (asked === 'leave') { mount(null); return false }
      // Said when it changes, and again four times a second: what a thing is told holds for a second only.
      const now = `${axes.go},${axes.turn},${axes.rise}`
      since += dt
      if (now !== said || asked || (since > 0.25 && now !== '0,0,0')) { tell(riding, axes.go, axes.turn, axes.rise, asked); said = now; since = 0 }
      // The head still turns, round the thing.
      const [right, up] = o.input.turn()
      o.pose.yaw += right
      o.pose.pitch = Math.max(-1.4, Math.min(1.2, o.pose.pitch + up))
      const at = where(riding)
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

/**
 * A car written by hand, the first thing proved (#245): a steel shell 4.2 m long, a glass cabin, four wheels with a
 * foot at each, the front two steering and the back two driving. 6 m/s gathered each second, up to 20 m/s.
 */
export function car(low: [number, number, number]): Making {
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
  const foot = (x: number, z: number, front: boolean): Foot => ({ at: [x, 3, z], reach: 5, steers: front, drives: !front })
  return {
    name: 'car', cells, size, low, controls: 'drive',
    motor: { front: 0, grip: 1.3, power: 60, top: 200, steer: 0.55, hover: 0, lift: 0, upright: 0, turns: 0, jump: 0, tough: 120, feet: [foot(7, 1, false), foot(7, 17, false), foot(35, 1, true), foot(35, 17, true)] },
  }
}
