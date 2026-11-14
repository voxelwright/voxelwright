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
import { STRIDE, type People, type Person } from './people.ts'
import type { Told } from './told.ts'

/** How big someone's body is in cells (wide, tall, deep): a box 1.4 m tall on a leg that reaches 0.6 m down, 1.76 m in all. */
export const BODY: [number, number, number] = [4, 14, 3]
/** How a person moves until a rule says otherwise: runs at 4.5 m/s (walks at a third of it), jumps 0.75 m. */
export const ON_FOOT: Motor = { front: 0, grip: 1.5, power: 300, top: 45, steer: 0, hover: 0, lift: 0, upright: 30, turns: 8, jump: 38, tough: 2000, feet: [{ at: [2, 0.5, 1.5], reach: 6 }] }
/** How far under the body's low corner the feet are when it stands: the leg's reach less how far it is pressed in, less where the leg starts. */
const LEG = 6 * 0.6 - 0.5
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
  readonly feet: { at: [number, number, number]; yaw: number; speed: number } | null
  /** The motor's numbers now; set to change what the body can do. */
  motor: Motor
}

export function person(o: {
  /** Asks the core that moves the body. */
  send(ask: Ask): void
  /** Says that something is to move (a core shared with the page's other bodies is then asked for steps). */
  wake(): void
  /** Whether the core is the body's own, so that this asks it for steps itself. */
  own: boolean
  input: Input
  hud: Hud
  /** The eye: metres, and which way it looks. */
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  folk: People
  /** Who they are to look at, and what they are called. */
  seed: number
  name?: string
}): Me {
  const M = 10
  let on = false, id = 0, asked = false, view: Me['view'] = 'behind', motor = ON_FOOT
  // Where the body is as the core last said (its middle of mass), and where the eye's height has got to.
  let at: [number, number, number] | null = null, com = [2, 7, 1.5], eyeY = 0
  // Which way it faces (the core's heading: its front at cos, 0, sin), a jump still to ask, and its walk for the drawing.
  let heading = 0, jump = false, stride = 0, speed = 0, walking = 0
  let waiting = false, since = 0, leave: (() => void) | null = null
  const shown: Person = { at: [0, 0, 0], yaw: 0, seed: o.seed, name: o.name }
  o.folk.from.push((_view, seconds) => {
    if (!on || !at || view === 'head') return []
    Object.assign(shown, { at: [at[0], at[1] - com[1] - LEG, at[2]], yaw: heading + Math.PI / 2, stride, walking, time: seconds })
    return [shown]
  })
  const feet = () => (at ? { at: [at[0], at[1] - com[1] - LEG, at[2]] as [number, number, number], yaw: heading + Math.PI / 2, speed } : null)
  const walk = (to: boolean) => {
    if (to === on) return
    on = to
    leave?.()
    leave = null
    if (!on) {
      if (id) o.send({ vanish: id })
      // Up from where the body stood, the eye where the head was.
      if (at) { o.pose.x = at[0] / M; o.pose.z = at[2] / M; o.pose.y = (at[1] - com[1] - LEG + EYES) / M }
      id = 0; at = null; asked = false
      return
    }
    // The body is made where the eye is, the eye in its head: from the air it falls to whatever is under it.
    const low: [number, number, number] = [Math.round(o.pose.x * M) - 2, Math.round(o.pose.y * M - EYES + LEG), Math.round(o.pose.z * M) - 1]
    heading = o.pose.yaw - Math.PI / 2
    eyeY = o.pose.y * M
    asked = true
    o.send({ figure: { low, size: BODY, motor: numbers(motor) } })
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
    get motor() { return motor },
    set motor(m) { motor = m; if (id) o.send({ motor: { id, numbers: numbers(m) } }) },
    edit(words) { if (o.own) o.send({ edit: words }) },
    heard(answer, told) {
      waiting = false
      if (asked && answer.spawned !== undefined && told.figures.length) { id = answer.spawned; asked = false; const f = told.figures.find((f) => f.id === id); if (f) { com = f.com; at = null } }
      if (!id) return
      for (const m of told.moves) if (m.id === id) at = m.pos
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
      const long = Math.hypot(go, side)
      // Behind it, the body turns to face the way it goes; in its head it faces where the eye looks and steps aside.
      const looks = o.pose.yaw - Math.PI / 2
      let ask: NonNullable<Ask['walk']> | null = null
      if (id) {
        if (view === 'head') { heading = looks; ask = { id, heading, go: Math.max(-1, Math.min(1, go)), side: Math.max(-1, Math.min(1, side)), rise: 0, jump } }
        else { if (long > 0.01) heading = looks + Math.atan2(side, go); ask = { id, heading, go: Math.min(1, long), side: 0, rise: 0, jump } }
        jump = false
      }
      since += dt
      const moving = long > 0.01 || (ask?.jump ?? false)
      if (ask && o.own) {
        // Its own core: asked for a step each frame while anything of it moves, and not again before it has answered.
        if (!waiting && (moving || since < 3)) { waiting = true; o.send({ walk: ask, tick: Math.min(dt, 0.05) }) }
        if (moving) since = 0
      } else if (ask && (moving || since > 0.25)) { o.send({ walk: ask }); if (moving) o.wake(); since = 0 }
      if (at) {
        const f = feet()!, was = shown.at
        const step = Math.hypot(f.at[0] - was[0], f.at[2] - was[2])
        if (step < 20) { stride += step / STRIDE; speed += ((dt > 0 ? step / dt : 0) - speed) * Math.min(1, dt * 10) }
        walking += ((speed > 3 ? 1 : 0) - walking) * Math.min(1, dt * 8)
        shown.at = f.at
        // The eye: in the head, or behind and above it, the height eased so that a kerb is not a jolt.
        const want = f.at[1] + EYES
        eyeY += (want - eyeY) * (Math.abs(want - eyeY) > 30 ? 1 : 1 - Math.exp(-dt * 14))
        const cp = Math.cos(o.pose.pitch), look = [Math.sin(o.pose.yaw) * cp, Math.sin(o.pose.pitch), -Math.cos(o.pose.yaw) * cp]
        // Behind: back from the head, over it, and a little to the right, so that what is aimed at is not behind one's own head.
        const back = view === 'head' ? 0 : 32, over = view === 'head' ? 0 : 6, aside = view === 'head' ? 0 : 5
        o.pose.x = (f.at[0] - look[0] * back + Math.cos(o.pose.yaw) * aside) / M
        o.pose.z = (f.at[2] - look[2] * back + Math.sin(o.pose.yaw) * aside) / M
        o.pose.y = (eyeY + over - look[1] * back) / M
      }
      return true
    },
  }
}
