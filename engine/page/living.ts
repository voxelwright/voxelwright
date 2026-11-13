// Living things on the page (#245): a thing that is a body for as long as it lives (the core's
// bodies/living.rs), that a person can get on and drive. The page decides nothing about how it
// moves: it says what the keys ask (go, turn, rise, roll, jump) again and again, and the solver's
// motor does the rest. A thing's motor and its control scheme are data, so a model can write
// them with the thing; nothing here is run.
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Answer, Ask } from './mover.ts'
import type { Piece } from './pieces.ts'
import type { Struck, Told } from './told.ts'

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

/** A thing to bring to life: its cells (one kind each, laid out x, then z, then y), size and low corner in the world's cells, how it moves and how it is driven. */
export interface Making { name: string; cells: Int32Array; size: [number, number, number]; low: [number, number, number]; motor: Motor; controls?: keyof typeof SCHEMES; take?: boolean }
export interface Thing extends Making { id: number; alive: boolean; /** How it is doing, as the solver last said: its speed along its front (cells a second), feet on the ground, touches, what it is told. */ state?: Told['live'][number] }

export interface Living {
  /** Brings a thing to life. Resolves when the solver has made it; its id is 0 if it could not. */
  spawn(making: Making): Promise<Thing>
  /** What the solver said: things made, things broken, what struck what. */
  heard(answer: Answer, told: Told): void
  /** A frame: what the keys ask of the thing ridden, the cue for one near, and where the eye is if it rides. True while it rides (the eye is then not the page's to move). */
  frame(dt: number): boolean
  /** Gets on a thing, or off (null). */
  mount(thing: Thing | null): void
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
}): Living {
  const M = 10
  const things: Thing[] = [], waiting: { making: Making; done: (thing: Thing) => void }[] = [], struck: Struck[] = []
  let riding: Thing | null = null, near: Thing | null = null
  // What was last said to the thing ridden and when, where the thing faced, and what is asked once (a roll, a jump, getting off).
  let said = '', since = 0, facing = 0, once: 'roll' | 'jump' | 'leave' | undefined
  let cue: { thing: Thing; remove(): void } | null = null, leave: (() => void) | null = null
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
    o.send({ drive: { id: thing.id, go, turn, rise, roll: once === 'roll', jump: once === 'jump' } })
    o.wake()
  }
  const mount = (thing: Thing | null) => {
    if (riding && riding !== thing) {
      // Set down beside it, a little above the ground.
      tell(riding, 0, 0, 0)
      const at = where(riding)
      if (at) { o.pose.x = at.at[0] / M - at.front[2] * (riding.size[2] / M / 2 + 1.2); o.pose.z = at.at[2] / M + at.front[0] * (riding.size[2] / M / 2 + 1.2); o.pose.y = Math.max(o.pose.y, o.ground(o.pose.x, o.pose.z) + 1.7) }
    }
    riding = thing?.alive ? thing : null
    said = ''
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
  }

  return {
    things, struck, where, mount,
    get riding() { return riding },
    get near() { return near },
    spawn: (making) => new Promise((done) => { waiting.push({ making, done }); o.send({ spawn: { cells: making.cells, size: making.size, low: making.low, take: making.take, motor: numbers(making.motor) } }) }),
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
        if (near && !cue) { const thing = near; cue = { thing, remove: o.hud.cue(`E  ${SCHEMES[thing.controls ?? 'drive'].verb} the ${thing.name}`, () => { const at = where(thing); return at && [at.at[0], at.at[1] + thing.size[1] / 2 + 4, at.at[2]] }).remove } }
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
        o.pose.x = at.at[0] / M - look[0] * back
        o.pose.z = at.at[2] / M - look[2] * back
        o.pose.y = Math.max(at.at[1] / M + high - look[1] * back, o.ground(o.pose.x, o.pose.z) + 0.4)
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
