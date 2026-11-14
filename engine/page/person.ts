// A person's own body (#264, the bodies lane): someone at a page walks the world on their feet.
//
// The body is a living thing of the core's (bodies/living.rs `figure`): a box on a leg that is a spring, taken to
// the speed it is told, stopped by walls, standing on what is built and on rubble, thrown by what hits it. What it
// can do is the motor's numbers, so a rule changes them and never the engine.
//
// Who moves it: this page, in a core of its own. Tried first the other way (November 13): told through the world's
// own process a living thing is seen to move 30 ms later on this machine, and the owner's phone was 127 to 429 ms
// away by the tailnet's relay at that hour, so every step would come a quarter of a second late. So the page moves
// its own body against the world as it knows it (a core fed every edit the world tells of) and says where its feet
// are, as it always said where its eye was; the world's process is the judge of what that body is struck by.
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import { numbers, type Motor } from './living.ts'
import type { Answer, Ask } from './mover.ts'
import { runningAt, strideAt, type Doing, type People, type Person } from './people.ts'
import { NAMED, type Move } from './moves.ts'
import type { Limbs } from './link.ts'
import type { Told } from './told.ts'

/** How big someone's body is in cells (wide, tall, deep): a box 1.4 m tall on a leg that reaches 0.6 m down, 1.76 m in all. */
export const BODY: [number, number, number] = [4, 14, 3]
/** How a person moves until a rule says otherwise: runs at 4.5 m/s (walks at a third of it), jumps 0.75 m. */
export const ON_FOOT: Motor = { front: 0, grip: 1.5, power: 300, top: 45, steer: 0, hover: 0, lift: 0, upright: 30, turns: 8, jump: 38, tough: 2000, feet: [{ at: [2, 0.5, 1.5], reach: 6 }] }
/**
 * What a body can do, as a rule sets it (`world.person`, rules/bodies.mjs): how fast it runs (cells a second), how
 * high it jumps (cells), how high a wall it climbs (cells), how fast it flies, how much of the world's pull it feels.
 */
export interface Can { pace: number; jump: number; climb: number; fly: number; fall: number; /** Which way is down for it, a way in the world's axes; null for the world's own. */ down: [number, number, number] | null; /** Whether it clings: its down turns to whatever face it walks onto. */ cling: boolean }
export const AS_IT_IS: Can = { pace: 45, jump: 7.4, climb: 0, fly: 0, fall: 1, down: null, cling: false }
type Q = [number, number, number, number]
/** A vector turned by a quaternion (x, y, z, w). */
const turned = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
/** The motor that does it: the jump's speed is what takes it that high under the pull it feels. */
const motorOf = (can: Can): Motor => ({ ...ON_FOOT, top: can.pace, power: 300 * Math.max(1, can.pace / 45), jump: Math.sqrt(2 * 98 * Math.max(can.fall, 0.05) * can.jump), lift: can.fly })
/** How far under the body's low corner the feet are when it stands: the leg's reach less how far it is pressed in, less where the leg starts. */
const LEG = 6 * 0.6 - 0.5
/** How near what stands the eye behind comes (cells), and how near its own head before its figure is in its way and is not drawn. */
const CLEAR = 3, NEAR = 9

/** No move at all: what a body comes to rest in. */
const REST: Move = { keys: [{ t: 0 }], hold: true }

/** How high the eyes are over the feet, and what share of a run a walk is. */
const EYES = 16.5, WALK = 0.32

export interface Me {
  /** Whether the person is on their feet (and not flying as an eye). */
  readonly on: boolean
  /** Gets down onto the feet where the eye is, or back up to fly. */
  walk(on: boolean): void
  /** Where the eye rides: behind the body, or in its head. */
  view: 'behind' | 'head'
  /** A frame: what the keys ask of the body, and where the eye is. True while on foot (the eye is then not the page's to move). */
  frame(dt: number): boolean
  /** What the core that moves the body said. */
  heard(answer: Answer, told: Told): void
  /** An edit of the world, for a core of the body's own (a shared world): it walks on what is there now. */
  edit(words: Int32Array): void
  /** Where the feet are (cells) and which way the body faces (0 north, a quarter turn east), or null in the air as an eye. */
  readonly feet: { at: [number, number, number]; yaw: number; speed: number; /** The turn from its own upright to the world's, when its down is not the world's. */ frame?: [number, number, number, number] } | null
  /** What the body can do; set (any of the numbers) to change it. */
  can: Partial<Can>
  /** What a rule gave the figure: a look, and a move (`world.person`). In the console: `engine.me.limbs = {move: {n: 1, name: 'strike'}}`. */
  limbs: Limbs
  /** The figure as it is drawn (people.ts), whether or not it is in view. */
  readonly figure: Person
  /** How far behind the head the eye is now (cells): all the way, or as far as there is room. */
  readonly back: number
  /** A blow: so much speed given to the body at once (cells a second). Nothing if it is not on its feet. */
  push(speed: readonly [number, number, number]): void
  /** Puts the body on the ground for so many seconds: it does not walk meanwhile. None gets it up. */
  down(seconds: number): void
  /** How fast time goes for this body: 1, or the world's clock when a rule has slowed it and has not spared this person. */
  clock: number
}

export function person(o: {
  /** Asks the core that moves the body. */
  send(ask: Ask): void
  /** Says that something is to move (a core shared with the page's other bodies is then asked for steps). */
  wake(): void
  /** Whether the core is the body's own, so that this asks it for steps itself. */
  own: boolean
  /** What a cell of the world is made of (0: nothing), as this page has it: for keeping the eye out of what stands. */
  kind?: (x: number, y: number, z: number) => number
  input: Input
  hud: Hud
  /** The eye: metres, and which way it looks. */
  pose: { x: number; y: number; z: number; yaw: number; pitch: number; /** A turn of the eye's whole frame (x, y, z, w): for someone whose down is not the world's, so that what they stand on is the floor they see. */ tilt?: [number, number, number, number] }
  folk: People
  /** Who they are to look at, and what they are called. */
  seed: number
  name?: string
}): Me {
  const M = 10
  let on = false, id = 0, asked = false, view: Me['view'] = 'behind', can: Can = AS_IT_IS, clock = 1
  const tellCan = () => { if (id) o.send({ motor: { id, numbers: numbers(motorOf(can)) }, ways: { id, fall: can.fall, climb: can.climb }, down: { id, way: can.down ?? [0, 0, 0], cling: can.cling } }) }
  // Which way is up for the body as the core last said (the turn from its own upright to the world's), and the eye's, which follows it over a fifth of a second.
  let frame: Q = [0, 0, 0, 1], tilt: Q = [0, 0, 0, 1]
  const tilted = () => Math.abs(frame[3]) < 0.9999
  // Where the body is as the core last said (its middle of mass), and where the eye's height has got to.
  let at: [number, number, number] | null = null, com = [2, 7, 1.5], eyeY = 0
  // The eye behind: how far back it is of what it would be (0 to 1). Something in the way brings it in at once; it
  // goes out again slowly, so that passing a lamp post is not a lurch there and back.
  let room = 1, backNow = 0
  /** What the eye cannot be in or see through: all that stands but water and leaves. */
  const stands = (x: number, y: number, z: number) => { const k = (o.kind?.(Math.floor(x), Math.floor(y), Math.floor(z)) ?? 0) & 15; return k !== 0 && k !== 5 && k !== 13 }
  // Which way it faces (the core's heading: its front at cos, 0, sin), a jump still to ask, and its walk for the drawing.
  let heading = 0, jump = false, stride = 0, speed = 0, walking = 0
  let downUntil = 0, lying = 0
  let waiting = false, since = 0, awake = true, leave: (() => void) | null = null
  const shown: Person = { at: [0, 0, 0], yaw: 0, seed: o.seed, name: o.name }
  // What a rule gave the figure (`world.person`: a look, a move): as presence.ts has it for everyone else's. A new
  // move takes over from the one before, and none brings it to rest from whatever it was in. A move begins when this
  // page hears of it: by the world's clock a strike of half a second told a little late began part way through.
  type Under = { n: number; move: Move; since: number; aim?: [number, number, number] }
  let limbs: Limbs = {}, doing: Under | null = null, before: Under | null = null
  const moved = () => {
    const m = limbs.move, now = performance.now() / 1000
    if (!m) { if (doing && doing.move !== REST) { before = doing; doing = { n: -1, move: REST, since: now } } return }
    if (doing?.n === m.n) { doing.aim = m.aim; return }
    const move = m.name ? NAMED[m.name] : m.keys
    if (!move) return
    before = doing
    doing = { n: m.n, move, since: now, aim: m.aim }
  }
  const part = (d: Under, now: number): Doing => ({ move: d.move, t: now - d.since, aim: d.aim })
  o.folk.from.push((_view, seconds) => {
    // In the head nobody sees their own figure; on a wall the eye is in the head (below). The figure itself stands by its own up.
    if (!on || !at || view === 'head' || tilted() || backNow < NEAR) return []
    const now = performance.now() / 1000, d = turned(frame, [0, -(com[1] + LEG), 0])
    Object.assign(shown, { at: [at[0] + d[0], at[1] + d[1], at[2] + d[2]], yaw: heading + Math.PI / 2, frame: tilted() ? frame : undefined, stride, walking, running: runningAt(speed), down: lying, time: seconds, look: limbs.look, move: doing ? part(doing, now) : undefined, was: before && doing ? part(before, now) : undefined })
    return [shown]
  })
  const feet = () => { if (!at) return null; const d = turned(frame, [0, -(com[1] + LEG), 0]); return { at: [at[0] + d[0], at[1] + d[1], at[2] + d[2]] as [number, number, number], yaw: heading + Math.PI / 2, speed, frame: tilted() ? frame : undefined } }
  const walk = (to: boolean) => {
    if (to === on) return
    on = to
    leave?.()
    leave = null
    if (!on) {
      if (id) o.send({ vanish: id })
      // Up from where the body stood, the eye where the head was.
      if (at) { o.pose.x = at[0] / M; o.pose.z = at[2] / M; o.pose.y = (at[1] - com[1] - LEG + EYES) / M }
      id = 0; at = null; asked = false; frame = [0, 0, 0, 1]; tilt = [0, 0, 0, 1]; o.pose.tilt = undefined
      return
    }
    // The body is made where the eye is, the eye in its head: from the air it falls to whatever is under it.
    const low: [number, number, number] = [Math.round(o.pose.x * M) - 2, Math.round(o.pose.y * M - EYES + LEG), Math.round(o.pose.z * M) - 1]
    heading = o.pose.yaw - Math.PI / 2
    eyeY = o.pose.y * M
    asked = true
    o.send({ figure: { low, size: BODY, motor: numbers(motorOf(can)) } })
    o.wake()
    // On foot the page's own keys still do what they did (tools, the wand); Space jumps and V changes where the eye rides.
    leave = o.input.push({ name: 'afoot', key: (code) => { if (code === 'Space') { jump = true; return true } if (code === 'KeyV') { view = view === 'behind' ? 'head' : 'behind'; return true } return false } })
  }
  return {
    get on() { return on },
    walk,
    get view() { return view },
    set view(v) { view = v },
    get feet() { return on ? feet() : null },
    get limbs() { return limbs },
    set limbs(l) { limbs = l; moved() },
    get figure() { return shown },
    get back() { return backNow },
    get can() { return can },
    set can(c) { const next = { ...AS_IT_IS, ...c }; if (JSON.stringify(next) === JSON.stringify(can)) return; can = next; tellCan() },
    push(speed) { if (id) { o.send({ kick: { id, speed: [speed[0], speed[1], speed[2]] } }); o.wake(); awake = true } },
    down(seconds) { downUntil = seconds > 0 ? performance.now() + seconds * 1000 : 0 },
    get clock() { return clock },
    set clock(rate) { clock = rate },
    edit(words) { if (o.own) o.send({ edit: words }) },
    heard(answer, told) {
      waiting = false
      // While the core says a body of its own is awake it is asked on: one in the air told nothing must still come down.
      awake = answer.bodies > 0
      if (asked && answer.spawned !== undefined && told.figures.length) { id = answer.spawned; asked = false; const f = told.figures.find((f) => f.id === id); if (f) { com = f.com; at = null } tellCan() }
      if (!id) return
      for (const m of told.moves) if (m.id === id) at = m.pos
      for (const l of told.live) if (l.id === id) frame = l.frame
    },
    frame(dt) {
      if (!on) return false
      // The head turns as it always did.
      const [right, up] = o.input.turn()
      o.pose.yaw += right
      o.pose.pitch = Math.max(-1.5, Math.min(1.5, o.pose.pitch + up))
      // Forward and to the right as the eye looks: the keys, or a phone's left thumb. Shift runs; a thumb pushed right over runs.
      const held = o.input.held, stick = o.input.stick
      let go = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0), side = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0)
      const pace = held('ShiftLeft') || held('ShiftRight') ? 1 : WALK
      go = go * pace - stick[1]
      side = side * pace + stick[0]
      // On the ground it goes nowhere until it is up.
      const isDown = performance.now() < downUntil
      lying += ((isDown ? 1 : 0) - lying) * Math.min(1, dt * (isDown ? 7 : 2.2))
      if (isDown) { go = 0; side = 0; jump = false }
      const long = Math.hypot(go, side)
      // Behind it, the body turns to face the way it goes; in its head it faces where the eye looks and steps aside.
      const looks = o.pose.yaw - Math.PI / 2
      let ask: NonNullable<Ask['walk']> | null = null
      if (id) {
        // One who flies rises with Space and sinks with C.
        const rise = can.fly > 0 ? (held('Space') ? 1 : 0) - (held('KeyC') ? 1 : 0) : 0
        if (view === 'head' || tilted()) { heading = looks; ask = { id, heading, go: Math.max(-1, Math.min(1, go)), side: Math.max(-1, Math.min(1, side)), rise, jump } }
        else { if (long > 0.01) heading = looks + Math.atan2(side, go); ask = { id, heading, go: Math.min(1, long), side: 0, rise, jump } }
      }
      since += dt
      const moving = long > 0.01 || (ask?.jump ?? false) || (ask?.rise ?? 0) !== 0
      if (ask && o.own) {
        // Its own core: asked for a step each frame while anything of it moves, and not again before it has answered.
        // A jump asked while the last step is still out waits for the next: taken as sent, it was lost.
        if (!waiting && (moving || awake || since < 1)) { waiting = true; o.send({ walk: ask, tick: Math.min(dt, 0.05) * clock }); jump = false }
        if (moving) since = 0
      } else if (ask && (moving || since > 0.25)) { o.send({ walk: ask }); if (moving) o.wake(); since = 0; jump = false }
      if (at) {
        const f = feet()!, was = shown.at
        // How far along its own floor: a fall is not a walk, whichever way down is for it.
        const mine = turned(frame, [0, 1, 0]), d = [f.at[0] - was[0], f.at[1] - was[1], f.at[2] - was[2]], rise = d[0] * mine[0] + d[1] * mine[1] + d[2] * mine[2]
        const step = Math.hypot(d[0] - mine[0] * rise, d[1] - mine[1] * rise, d[2] - mine[2] * rise)
        if (step < 20) { stride += step / strideAt(speed); speed += ((dt > 0 ? step / dt : 0) - speed) * Math.min(1, dt * 10) }
        walking += ((speed > 3 ? 1 : 0) - walking) * Math.min(1, dt * 8)
        shown.at = f.at
        // The eye: in the head, or behind and above it, the height eased so that a kerb is not a jolt.
        // The eye's frame comes round to the body's over a fifth of a second: at once, the world snapped a quarter turn.
        const same = tilt[0] * frame[0] + tilt[1] * frame[1] + tilt[2] * frame[2] + tilt[3] * frame[3] < 0 ? -1 : 1, ease = 1 - Math.exp(-dt * 9)
        const next = tilt.map((v, i) => v + (frame[i] * same - v) * ease), long = Math.hypot(...next)
        tilt = next.map((v) => v / long) as Q
        const level = Math.abs(tilt[3]) > 0.99999
        o.pose.tilt = level ? undefined : tilt
        const up = turned(tilt, [0, 1, 0]), cp = Math.cos(o.pose.pitch)
        const look = turned(tilt, [Math.sin(o.pose.yaw) * cp, Math.sin(o.pose.pitch), -Math.cos(o.pose.yaw) * cp]), right = turned(tilt, [Math.cos(o.pose.yaw), 0, Math.sin(o.pose.yaw)])
        // The eye: in the head, or behind and above it. Level, its height is eased so that a kerb is not a jolt.
        const want = f.at[1] + EYES
        eyeY += (want - eyeY) * (Math.abs(want - eyeY) > 30 || !level ? 1 : 1 - Math.exp(-dt * 14))
        const head = level ? [f.at[0], eyeY, f.at[2]] : [f.at[0] + up[0] * EYES, f.at[1] + up[1] * EYES, f.at[2] + up[2] * EYES]
        // Behind: back from the head, over it, and a little to the right, so that what is aimed at is not behind one's own head.
        // On a wall the eye is in the head: behind and above, it would be inside the wall or the ground as often as not (nothing keeps the eye out of what is solid).
        const inHead = view === 'head' || tilted(), back = inHead ? 0 : 32, over = inHead ? 0 : 6, aside = inHead ? 0 : 5
        const off = [up[0] * over - look[0] * back + right[0] * aside, up[1] * over - look[1] * back + right[1] * aside, up[2] * over - look[2] * back + right[2] * aside], far = Math.hypot(off[0], off[1], off[2])
        // Not through a wall: from the head out to where the eye would be (and a little past, for the picture's near
        // edge), the first thing that stands is as far as it goes, less that little. With no room at all it is in the head.
        let free = 1
        if (far > 0) for (let s = 1; s <= far + CLEAR; s += 0.5) if (stands(head[0] + off[0] / far * s, head[1] + off[1] / far * s, head[2] + off[2] / far * s)) { free = Math.max(0, s - CLEAR) / far; break }
        // And nothing stands close beside where that leaves it: a wall met at a slant was a cell from the eye, and the
        // picture's near edge cut into it.
        const tight = (r: number) => { const x = head[0] + off[0] * r, y = head[1] + off[1] * r, z = head[2] + off[2] * r; return stands(x + 2, y, z) || stands(x - 2, y, z) || stands(x, y + 2, z) || stands(x, y - 2, z) || stands(x, y, z + 2) || stands(x, y, z - 2) }
        while (free > 0 && far > 0 && tight(free)) free = Math.max(0, free - 1 / far)
        room = free < room ? free : Math.min(free, room + dt * 1.5)
        backNow = inHead ? 0 : far * room
        o.pose.x = (head[0] + off[0] * room) / M
        o.pose.y = (head[1] + off[1] * room) / M
        o.pose.z = (head[2] + off[2] * room) / M
      }
      return true
    },
  }
}
