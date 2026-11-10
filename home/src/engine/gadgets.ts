// The gadget registry (#74): what each kind of gadget does, as hooks over the engine's API
// (api.ts). The world has no list of kinds: it calls a kind's hooks. The built-in kit below
// registers through registerGadget, the same call a new kind (a person's, or later an
// agent's sandboxed code) uses. Each kind has one to three named knobs.
import type { Gadget, Touch, WorldApi } from './api'
import type { Vec3 } from './core'
import type { Signal } from './toy'

export interface Knob { min: number; max: number; step: number; default: number; about: string }

/**
 * What a kind's spec settings are, for whoever checks a toy written as data (made.ts): a point and a
 * direction in the toy's frame, a held input's name, or the id of one of the toy's parts.
 */
export type Setting = 'point' | 'direction' | 'input' | 'part'

export interface GadgetKind {
  kind: string
  about: string
  knobs: Record<string, Knob>
  /** Ports it reads (wired into) and writes (fires). */
  inputs: string[]
  outputs: string[]
  /** The spec settings it reads besides `part` and `knobs`. */
  settings?: Record<string, Setting>
  /** What its spec must give, so a toy written as data is refused before it is built: a part (`moving`: a dynamic one) and settings by name. */
  needs?: { part?: 'any' | 'moving' | 'sensor'; settings?: string[] }
  /** Once, when its toy is built. */
  setup?(g: Gadget, w: WorldApi): void
  /** A knob changed value (tuned live, or restored): bring whatever was fixed from it at setup into line. */
  knob?(g: Gadget, name: string, w: WorldApi): void
  /** Before each solver step of h simulated seconds. */
  step?(g: Gadget, w: WorldApi, h: number): void
  /** Its part touched something (after the step). */
  touch?(g: Gadget, t: Touch, w: WorldApi): void
  /** A signal arrived on an input port (after the step). */
  receive?(g: Gadget, port: string, s: Signal, w: WorldApi): void
}

const registry = new Map<string, GadgetKind>()

/** Adds or replaces a kind. Returns null, or why it was refused. */
export function registerGadget(kind: GadgetKind): string | null {
  if (!kind || typeof kind.kind !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(kind.kind)) return 'a kind is lowercase letters, digits and dashes'
  if (Object.keys(kind.knobs ?? {}).length > 3) return 'a gadget has at most three knobs'
  for (const [name, k] of Object.entries(kind.knobs ?? {})) {
    if (![k.min, k.max, k.step, k.default].every(Number.isFinite) || k.min > k.max || k.default < k.min || k.default > k.max) return `knob ${name} needs min <= default <= max`
  }
  registry.set(kind.kind, kind)
  return null
}
export const gadgetKind = (kind: string) => registry.get(kind)
export const gadgetKinds = () => [...registry.values()]

const knob = (min: number, max: number, step: number, def: number, about: string): Knob => ({ min, max, step, default: def, about })
const setting = <T>(g: Gadget, name: string) => g.spec[name] as T
/** A counter's total as a card shows it: five places, the first a minus sign below zero. */
export const digits = (value: number) => (value < 0 ? `-${String(-value).padStart(4, '0')}` : String(value).padStart(5, '0'))

// ── The built-in kit ──────────────────────────────────────────────────────

registerGadget({
  kind: 'sensor', about: 'Fires `hit` when its part is struck harder than `threshold`, about the thing that struck it.',
  knobs: { threshold: knob(0, 1, 0.001, 0.002, 'N·s') }, inputs: [], outputs: ['hit'],
  touch(g, t, w) {
    if (!t.sensor && t.impulse >= g.knobs.threshold) w.fire(g, 'hit', { value: t.impulse, thing: t.other, dir: t.dir, at: t.point })
  },
})

registerGadget({
  kind: 'kick', about: 'On `fire`, adds `strength` m/s (times the kick rule) to the signal\'s thing, away from its part.',
  knobs: { strength: knob(0, 8, 0.05, 1.2, 'm/s') }, inputs: ['fire'], outputs: ['kicked'],
  receive(g, port, s, w) {
    if (port !== 'fire' || !s.thing || !s.dir) return
    const t = w.thing(s.thing)
    if (t?.motion !== 'dynamic') return
    const dv = g.knobs.strength * w.rules.kick
    w.setVelocity(s.thing, [t.velocity[0] + s.dir[0] * dv, t.velocity[1] + s.dir[1] * dv, t.velocity[2] + s.dir[2] * dv])
    w.fire(g, 'kicked', { value: dv, thing: s.thing })
  },
})

registerGadget({
  kind: 'hinge', about: 'A motor hinge on a dynamic part (settings: anchor, axis, input): swings to `swing` rad at `speed` rad/s while the input is held, back when released.',
  knobs: { speed: knob(0, 60, 0.5, 25, 'rad/s'), torque: knob(0, 20, 0.1, 3, 'N·m'), swing: knob(0.1, 1.5, 0.01, 1, 'rad') },
  inputs: [], outputs: [], settings: { anchor: 'point', axis: 'direction', input: 'input' }, needs: { part: 'moving', settings: ['anchor', 'axis'] },
  setup(g, w) {
    if (!g.part) throw new Error(`${g.id}: a hinge needs a part`)
    g.state.joint = w.addHinge(g.part, setting<Vec3>(g, 'anchor'), setting<Vec3>(g, 'axis'), [0, g.knobs.swing])
  },
  knob(g, name, w) {
    if (name === 'swing') w.setLimits(g.state.joint, [0, g.knobs.swing])
  },
  step(g, w, h) {
    const k = g.knobs
    const speed = k.speed * Math.min(2, w.rules.kick)
    // Slows into the stop within one step, so the travel is the knob and not the knob plus an overshoot.
    const aim = ((w.held(setting<string>(g, 'input')) ? k.swing : 0) - w.jointPosition(g.state.joint)) / h
    w.setMotor(g.state.joint, Math.max(-speed, Math.min(speed, aim)), k.torque * w.rules.kick)
  },
})

registerGadget({
  kind: 'piston', about: 'A dynamic part on a slider (settings: axis, input): pulled back along -axis while the input is held (fully after `charge` s, by `travel` m), driven forward on release at up to `strength` m/s, through its rest point by `travel` so a shot leaves at that speed, then eased back.',
  knobs: { strength: knob(0, 8, 0.05, 4.5, 'm/s'), travel: knob(0.01, 0.12, 0.005, 0.025, 'm'), charge: knob(0.1, 3, 0.05, 0.8, 's') },
  inputs: [], outputs: ['fired'], settings: { axis: 'direction', input: 'input' }, needs: { part: 'moving', settings: ['axis'] },
  setup(g, w) {
    if (!g.part) throw new Error(`${g.id}: a piston needs a part`)
    g.state.joint = w.addSlider(g.part, setting<Vec3>(g, 'axis'), [-0.12, 0.12])
  },
  step(g, w) {
    const k = g.knobs, st = g.state
    const pos = w.jointPosition(st.joint)
    const held = w.held(setting<string>(g, 'input'))
    let velocity: number, limit: number
    if (st.firing) {
      if (pos >= k.travel * 0.9) st.firing = 0
      velocity = st.firing
      limit = 400
    } else if (held && pos <= 0.002) {
      st.charge = Math.min(1, Math.max(st.charge ?? 0, -pos / k.travel))
      velocity = pos > -k.travel ? -k.travel / k.charge : 0
      limit = 30
    } else if ((st.charge ?? 0) > 0.02) {
      st.firing = Math.max(0.05, k.strength * st.charge * w.rules.kick)
      w.fire(g, 'fired', { value: st.firing })
      st.charge = 0
      velocity = st.firing
      limit = 400
    } else {
      // At rest, held there gently so whatever leans on it does not push it back.
      st.charge = 0
      velocity = -pos * 12
      limit = 30
    }
    w.setMotor(st.joint, velocity, limit)
  },
})

registerGadget({
  kind: 'zone', about: 'A sensor part: `enter` when a moving thing comes in, about that thing.',
  knobs: {}, inputs: [], outputs: ['enter'], needs: { part: 'sensor' },
  touch(g, t, w) {
    if (t.sensor && w.thing(t.other)?.motion === 'dynamic') w.fire(g, 'enter', { value: 1, thing: t.other, at: t.point })
  },
})

registerGadget({
  kind: 'emitter', about: 'On `spawn`, puts its part back where it started, at rest, after `delay` s: when the signal is about that part, or about nothing.',
  knobs: { delay: knob(0, 5, 0.1, 0.6, 's') }, inputs: ['spawn'], outputs: ['spawned'], needs: { part: 'moving' },
  receive(g, port, s, w) {
    if (port !== 'spawn' || !g.part || (s.thing && s.thing !== g.part)) return
    if (w.respawn(g.part, g.knobs.delay)) w.fire(g, 'spawned', { value: 1, thing: g.part })
  },
})

registerGadget({
  kind: 'counter', about: 'A number, `start` at first. `add` adds `step` (a negative step counts down); `reset` puts it back to `start`. Every change fires `changed` with the total. An `add` then fires one of two, never both: `reached` when the total is now `target`, else `counting`. Shown on the part named by its `display` setting.',
  knobs: { step: knob(-100, 1000, 1, 1, 'per add'), start: knob(-1000, 100000, 1, 0, 'at first and on reset'), target: knob(-1000, 1000000, 1, 0, 'fires reached') },
  inputs: ['add', 'reset'], outputs: ['changed', 'reached', 'counting'], settings: { display: 'part' },
  setup(g, w) {
    g.state.value = g.knobs.start
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, digits(g.state.value))
  },
  receive(g, port, _s, w) {
    if (port !== 'add' && port !== 'reset') return
    g.state.value = port === 'add' ? g.state.value + g.knobs.step : g.knobs.start
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, digits(g.state.value))
    w.fire(g, 'changed', { value: g.state.value })
    // A reset decides nothing: only an add says whether the target was reached.
    if (port === 'add') w.fire(g, g.state.value === g.knobs.target ? 'reached' : 'counting', { value: g.state.value })
  },
})

registerGadget({
  kind: 'pivot', about: 'A free hinge on a dynamic part (settings: anchor, axis): it swings either way from where it was made, at most `swing` rad, slowed by `friction`. A seesaw\'s plank, a pendulum, a gate.',
  knobs: { swing: knob(0.05, 1.5, 0.01, 0.35, 'rad each way'), friction: knob(0, 5, 0.01, 0.02, 'N·m') },
  inputs: [], outputs: [], settings: { anchor: 'point', axis: 'direction' }, needs: { part: 'moving', settings: ['anchor', 'axis'] },
  setup(g, w) {
    if (!g.part) throw new Error(`${g.id}: a pivot needs a part`)
    g.state.joint = w.addHinge(g.part, setting<Vec3>(g, 'anchor'), setting<Vec3>(g, 'axis'), [-g.knobs.swing, g.knobs.swing])
    // Set once, not every step: setting a motor wakes its body, and a pivot at rest should sleep.
    w.setMotor(g.state.joint, 0, g.knobs.friction)
  },
  knob(g, name, w) {
    if (name === 'swing') w.setLimits(g.state.joint, [-g.knobs.swing, g.knobs.swing])
    if (name === 'friction') w.setMotor(g.state.joint, 0, g.knobs.friction)
  },
})

registerGadget({
  kind: 'flame', about: 'Keeps its part alight while `lit` is 1 (it lights it as soon as fire runs); `light` lights it, `out` puts it out with water. Fires `caught` when it lights.',
  knobs: { lit: knob(0, 1, 1, 0, 'on or off') }, inputs: ['light', 'out'], outputs: ['caught'],
  setup(g) {
    g.state.wanted = g.knobs.lit
  },
  knob(g, name, w) {
    // Only a change of `lit` re-arms it: a snapshot putting back the same value keeps the latch it saved.
    if (name !== 'lit' || g.knobs.lit === g.state.wanted) return
    g.state.wanted = g.knobs.lit
    g.state.lit = 0
    if (!g.knobs.lit && g.part && w.burning(g.part)) w.douse(g.part, undefined, 'gadget')
  },
  step(g, w) {
    // Lit once per time `lit` is set: lighting waits for fire to run, and a doused candle stays out until lit again.
    if (!g.knobs.lit || g.state.lit || !g.part) return
    if (w.burning(g.part)) {
      g.state.lit = 1
      return
    }
    const why = w.ignite(g.part, undefined, 'gadget')
    if (why === 'fire is not running') return
    // Lit, or it cannot be (burnt out, too wet): either way it stops trying until lit again.
    g.state.lit = 1
    if (why === null) w.fire(g, 'caught', { value: 1, thing: g.part })
  },
  receive(g, port, _s, w) {
    if (!g.part) return
    if (port === 'light') {
      g.knobs.lit = g.state.wanted = 1
      g.state.lit = 0
    } else if (port === 'out') {
      g.knobs.lit = g.state.wanted = 0
      w.douse(g.part, undefined, 'gadget')
    }
  },
})

// ── Logic parts (#108): what turns a contraption into a game ────────────────

registerGadget({
  kind: 'game', about: 'A round of play. `start` begins one unless one is running, and fires `started`. While it runs, `win` ends it with `won` and `lose` ends it with `lost`; `reset` ends it and says nothing. `score` remembers the signal\'s value (wire a counter\'s `changed` to it), and `won` and `lost` carry it. A signal into `during` comes out of `during` only while a round runs (what counts only in play: a ball lost, a point scored).',
  knobs: {}, inputs: ['start', 'win', 'lose', 'score', 'during', 'reset'], outputs: ['started', 'won', 'lost', 'during'],
  setup(g) {
    g.state.playing = 0
    g.state.score = 0
  },
  receive(g, port, s, w) {
    const st = g.state
    if (port === 'score') st.score = Number.isFinite(s.value) ? s.value : st.score
    else if (port === 'reset') st.playing = 0
    else if (port === 'during') {
      if (st.playing) w.fire(g, 'during', s)
    } else if (port === 'start' && !st.playing) {
      st.playing = 1
      w.fire(g, 'started', { value: 1 })
    } else if ((port === 'win' || port === 'lose') && st.playing) {
      st.playing = 0
      w.fire(g, port === 'win' ? 'won' : 'lost', { value: st.score })
    }
  },
})

/** How bright a lamp's part is: lit, and brighter for the moment of a flash. */
const LIT = 1, FLASH = 2
const shine = (g: Gadget, w: WorldApi) => {
  if (g.part) w.glow(g.part, g.state.until ? FLASH : g.state.on ? LIT : 0)
}
registerGadget({
  kind: 'lamp', about: 'Makes its part glow. `on` and `off` switch it. `set` lights it when the signal\'s value is at least `level` and puts it out otherwise (three lamps at levels 1, 2 and 3 on a counter show three lives). `flash` makes it bright for `seconds`, then as it was. Lit at first, and again on `reset`, when `lit` is 1.',
  knobs: { level: knob(-1000, 1000000, 1, 1, 'lit from this value'), seconds: knob(0.05, 10, 0.05, 0.2, 's a flash lasts'), lit: knob(0, 1, 1, 0, 'lit at first') },
  inputs: ['on', 'off', 'set', 'flash', 'reset'], outputs: [], needs: { part: 'any' },
  setup(g, w) {
    if (!g.part) throw new Error(`${g.id}: a lamp needs a part`)
    g.state.on = g.knobs.lit
    g.state.until = 0
    shine(g, w)
  },
  // A snapshot put back sets the knobs last: the part then shows the state that came with them.
  knob(g, _name, w) {
    shine(g, w)
  },
  step(g, w) {
    if (!g.state.until || w.clock < g.state.until) return
    g.state.until = 0
    shine(g, w)
  },
  receive(g, port, s, w) {
    const st = g.state
    if (port === 'on') st.on = 1
    else if (port === 'off') st.on = 0
    else if (port === 'set') st.on = s.value >= g.knobs.level ? 1 : 0
    else if (port === 'reset') [st.on, st.until] = [g.knobs.lit, 0]
    else if (port === 'flash') st.until = w.clock + g.knobs.seconds
    else return
    shine(g, w)
  },
})

const BUILT_IN = new Map(registry)
/** Drops every kind added at runtime, and puts back any built-in one replaced (the plugin unloading). */
export function resetGadgets() {
  registry.clear()
  for (const [name, k] of BUILT_IN) registry.set(name, k)
}
