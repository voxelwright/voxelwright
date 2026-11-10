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
  /**
   * Per input, the outputs it can fire at once, in the same chain of signals (an input not named
   * can fire any of them). What a kind fires later from its `step` (a timer's `done`, a bell's
   * `rang`) is caused by no input: a ring of wires through it runs at most once a wait, so whoever
   * checks a toy for loops (made.ts) lets it be.
   */
  causes?: Record<string, string[]>
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
/** The furthest a counter counts, either way. */
const COUNT_MAX = 9_999_999
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
  kind: 'counter', about: 'A number, `start` at first. `add` adds `step`, `sub` takes `step` away, `plus` adds the signal\'s own value (a `points` gadget\'s); `reset` puts it back to `start`. Every change fires `changed` with the total. A change that is not a reset then fires one of two, never both: `reached` when the total is now `target`, else `counting`. Shown on the part named by its `display` setting.',
  knobs: { step: knob(-100, 1000, 1, 1, 'per add'), start: knob(-1000, 100000, 1, 0, 'at first and on reset'), target: knob(-1000, 1000000, 1, 0, 'fires reached') },
  inputs: ['add', 'sub', 'plus', 'reset'], outputs: ['changed', 'reached', 'counting'], causes: { reset: ['changed'] }, settings: { display: 'part' },
  setup(g, w) {
    g.state.value = g.knobs.start
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, digits(g.state.value))
  },
  receive(g, port, s, w) {
    const by = port === 'add' ? g.knobs.step : port === 'sub' ? -g.knobs.step : port === 'plus' && Number.isFinite(s.value) ? Math.round(s.value) : port === 'reset' ? 0 : null
    if (by === null) return
    // Held where a card and a snapshot can carry it.
    g.state.value = port === 'reset' ? g.knobs.start : Math.max(-COUNT_MAX, Math.min(COUNT_MAX, g.state.value + by))
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, digits(g.state.value))
    w.fire(g, 'changed', { value: g.state.value })
    // A reset decides nothing: only a count says whether the target was reached.
    if (port !== 'reset') w.fire(g, g.state.value === g.knobs.target ? 'reached' : 'counting', { value: g.state.value })
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
  kind: 'game', about: 'A round of play. `start` begins one unless one is running, and fires `started`. While it runs, `win` ends it with `won` and `lose` ends it with `lost`; `reset` ends it and says nothing. `score` remembers the signal\'s value (wire a counter\'s `changed` to it), and `won` and `lost` carry it. A signal into `during` comes out of `during` while a round runs and out of `idle` when none does, never both (what counts only in play: a ball lost, a point scored).',
  knobs: {}, inputs: ['start', 'win', 'lose', 'score', 'during', 'reset'], outputs: ['started', 'won', 'lost', 'during', 'idle'], causes: { start: ['started'], win: ['won'], lose: ['lost'], score: [], during: ['during', 'idle'], reset: [] },
  setup(g) {
    g.state.playing = 0
    g.state.score = 0
  },
  receive(g, port, s, w) {
    const st = g.state
    if (port === 'score') st.score = Number.isFinite(s.value) ? s.value : st.score
    else if (port === 'reset') st.playing = 0
    else if (port === 'during') w.fire(g, st.playing ? 'during' : 'idle', s)
    else if (port === 'start' && !st.playing) {
      st.playing = 1
      w.fire(g, 'started', { value: 1 })
    } else if ((port === 'win' || port === 'lose') && st.playing) {
      st.playing = 0
      w.fire(g, port === 'win' ? 'won' : 'lost', { value: st.score })
    }
  },
})

/** A record's card: the word and the number. */
const best = (g: Gadget, w: WorldApi) => {
  const display = setting<string | undefined>(g, 'display')
  if (display) w.show(`${g.toy}/${display}`, `BEST ${g.knobs.best}`)
}

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

registerGadget({
  kind: 'points', about: 'On `in`, fires `out` with `value` as the signal\'s value, about the same thing: wire it to a counter\'s `plus` so a target is worth what it says.',
  knobs: { value: knob(-100000, 100000, 1, 100, 'points') }, inputs: ['in'], outputs: ['out'],
  receive(g, port, s, w) {
    if (port === 'in') w.fire(g, 'out', { ...s, value: g.knobs.value })
  },
})

const SLOTS = ['a', 'b', 'c', 'd', 'e', 'f']
registerGadget({
  kind: 'collect', about: 'A set to complete. Each of its inputs `a` to `f` is remembered the first time it arrives and fires `got` with how many are in; when `count` different ones are in it fires `all` and forgets them, ready to be collected again. `reset` forgets them and says nothing. Three lanes to roll through, four targets to hit.',
  knobs: { count: knob(1, 6, 1, 3, 'different inputs that complete it') }, inputs: [...SLOTS, 'reset'], outputs: ['got', 'all'], causes: { reset: [] },
  setup(g) {
    g.state.have = 0
  },
  receive(g, port, s, w) {
    const st = g.state
    if (port === 'reset') return void (st.have = 0)
    const slot = SLOTS.indexOf(port)
    if (slot < 0 || st.have & (1 << slot)) return
    st.have |= 1 << slot
    const n = SLOTS.filter((_, i) => st.have & (1 << i)).length
    w.fire(g, 'got', { ...s, value: n })
    if (n < g.knobs.count) return
    st.have = 0
    w.fire(g, 'all', { ...s, value: n })
  },
})

registerGadget({
  kind: 'spawner', about: 'Puts its moving part into play. On `spawn`, unless the part is out already, it places it at the `at` setting (where it was made, when there is none), moving at `speed` along the `toward` setting, and fires `spawned`. On `back`, when the signal is about its part (or about nothing) and the part is out, it fires `back`: the part is where it fell, out of play until spawned again. Out at first, and again on `reset`, when `out` is 1. Extra balls for a multiball; the next ball after one is lost.',
  knobs: { speed: knob(0, 8, 0.05, 0, 'm/s'), out: knob(0, 1, 1, 0, 'in play at first') },
  inputs: ['spawn', 'back', 'reset'], outputs: ['spawned', 'back'], causes: { spawn: ['spawned'], back: ['back'], reset: [] }, settings: { at: 'point', toward: 'direction' }, needs: { part: 'moving' },
  setup(g) {
    if (!g.part) throw new Error(`${g.id}: a spawner needs a part`)
    g.state.out = g.knobs.out
  },
  receive(g, port, s, w) {
    const st = g.state
    if (!g.part) return
    if (port === 'reset') st.out = g.knobs.out
    else if (port === 'back' && st.out && (!s.thing || s.thing === g.part)) {
      st.out = 0
      w.fire(g, 'back', { value: 1, thing: g.part })
    } else if (port === 'spawn' && !st.out) {
      const at = setting<Vec3 | undefined>(g, 'at')
      const placed = at ? w.place(g.part, at) : w.respawn(g.part, 0)
      if (!placed) return
      const toward = setting<Vec3 | undefined>(g, 'toward')
      if (at && toward && Math.hypot(...toward) > 1e-9 && g.knobs.speed > 0) {
        // A unit vector, whatever the setting's length.
        const d = w.toWorldDir(g.toy, toward)
        w.setVelocity(g.part, [d[0] * g.knobs.speed, d[1] * g.knobs.speed, d[2] * g.knobs.speed])
      }
      st.out = 1
      w.fire(g, 'spawned', { value: 1, thing: g.part })
    }
  },
})

registerGadget({
  kind: 'timer', about: 'Counts `seconds` of the world\'s time. `start` begins it (again from the top when it is running) and fires `started`; when the time is up it fires `done`; `stop` and `reset` end it and say nothing. A signal into `pass` comes out of `running` while it counts and out of `idle` when it does not, never both: a grace period after a ball is served, a time limit on a round.',
  knobs: { seconds: knob(0.1, 600, 0.1, 10, 's') }, inputs: ['start', 'stop', 'pass', 'reset'], outputs: ['started', 'done', 'running', 'idle'], causes: { start: ['started'], stop: [], pass: ['running', 'idle'], reset: [] },
  setup(g) {
    g.state.until = 0
  },
  receive(g, port, s, w) {
    const st = g.state
    if (port === 'start') {
      st.until = w.clock + g.knobs.seconds
      w.fire(g, 'started', { value: g.knobs.seconds })
    } else if (port === 'stop' || port === 'reset') st.until = 0
    else if (port === 'pass') w.fire(g, st.until ? 'running' : 'idle', s)
  },
  // The one firing it holds for later: `done`, once, on the step the time is up.
  step(g, w) {
    if (!g.state.until || w.clock < g.state.until) return
    g.state.until = 0
    w.fire(g, 'done', { value: g.knobs.seconds })
  },
})

registerGadget({
  kind: 'tilt', about: 'Watches its moving part and fires `fell` once, about that part, when it has tipped more than `angle` from how it was made: a pin knocked down, a tower toppled. `reset` lets it fire again.',
  knobs: { angle: knob(0.1, 1.5, 0.01, 0.8, 'rad from upright') }, inputs: ['reset'], outputs: ['fell'], causes: { reset: [] }, needs: { part: 'moving' },
  setup(g) {
    if (!g.part) throw new Error(`${g.id}: a tilt needs a part`)
    g.state.fell = 0
  },
  step(g, w) {
    if (g.state.fell || !g.part || w.upright(g.part) >= Math.cos(g.knobs.angle)) return
    g.state.fell = 1
    w.fire(g, 'fell', { value: 1, thing: g.part })
  },
  receive(g, port) {
    if (port === 'reset') g.state.fell = 0
  },
})

registerGadget({
  kind: 'restart', about: 'On `go`, puts its whole toy back as it was made and fires `done`: every moving part where it started and at rest, every counter, game, lamp, timer and the like reset. The pins stood up again for the next round.',
  knobs: {}, inputs: ['go'], outputs: ['done'],
  receive(g, port, _s, w) {
    if (port === 'go' && w.restartToy(g.toy)) w.fire(g, 'done', { value: 1 })
  },
})

registerGadget({
  kind: 'record', about: 'The best so far. On `in`, when the signal\'s value beats `best`, it keeps that value as `best` and fires `beaten` with it. Shown as "BEST 1230" on the part named by its `display` setting. A reset does not clear it: whoever keeps the house may keep `best` between visits.',
  knobs: { best: knob(0, 9_999_999, 1, 0, 'the best so far') }, inputs: ['in'], outputs: ['beaten'], settings: { display: 'part' },
  setup(g, w) {
    best(g, w)
  },
  knob(g, _name, w) {
    best(g, w)
  },
  receive(g, port, s, w) {
    if (port !== 'in' || !Number.isFinite(s.value) || Math.round(s.value) <= g.knobs.best) return
    g.knobs.best = Math.min(9_999_999, Math.round(s.value))
    best(g, w)
    w.fire(g, 'beaten', { value: g.knobs.best })
  },
})

// ── Feedback (#108): what makes a hit land. Each only says what happened; sound and the view listen. ──

/** Seconds between two notes of one bell: a run is heard as notes, and a bell wired to ring itself cannot flood. */
const RING_GAP = 0.09
registerGadget({
  kind: 'bell', about: 'Rings. On `ring` it fires `rang` with `note` as the value (semitones above middle C; whoever makes the home\'s sounds plays it), `rings` times in a row, each `step` semitones from the last: one note for a hit, a run up for a prize, a run down for a loss. Heard from where its part is, when it has one.',
  knobs: { note: knob(-12, 36, 1, 12, 'semitones above middle C'), rings: knob(1, 6, 1, 1, 'notes in a row'), step: knob(-12, 12, 1, 7, 'semitones between them') },
  inputs: ['ring'], outputs: ['rang'], causes: { ring: [] },
  setup(g) {
    Object.assign(g.state, { left: 0, n: 0, next: 0 })
  },
  receive(g, port) {
    if (port !== 'ring') return
    g.state.left = g.knobs.rings
    g.state.n = 0
  },
  // One note a step at most, from here and not from `ring`: a run is spread over time, and it is said at most every RING_GAP.
  step(g, w) {
    const st = g.state
    if (!st.left || w.clock < st.next) return
    const at = g.part ? w.thing(g.part)?.position : undefined
    st.left--
    st.next = w.clock + RING_GAP
    w.fire(g, 'rang', { value: Math.max(-12, Math.min(36, g.knobs.note + st.n++ * g.knobs.step)), ...(at ? { at } : {}) })
  },
})

registerGadget({
  kind: 'freeze', about: 'Hit-stop. On `hit` the whole world holds still for `seconds` and then carries on, and it fires `held`: the beat that makes a hit land. The world refuses a hold too soon after the last, so it never stutters.',
  knobs: { seconds: knob(0, 0.15, 0.005, 0.06, 's held; 0 is off') }, inputs: ['hit'], outputs: ['held'],
  receive(g, port, s, w) {
    if (port === 'hit' && g.knobs.seconds > 0 && w.hold(g.knobs.seconds)) w.fire(g, 'held', { ...s, value: g.knobs.seconds })
  },
})

registerGadget({
  kind: 'shake', about: 'On `hit` it fires `shook` with `strength` as the value: the view of whoever is playing the toy jumps that much and settles (nothing in the world moves).',
  knobs: { strength: knob(0, 1, 0.01, 0.2, '0 to 1') }, inputs: ['hit'], outputs: ['shook'],
  receive(g, port, s, w) {
    if (port === 'hit' && g.knobs.strength > 0) w.fire(g, 'shook', { ...s, value: g.knobs.strength })
  },
})

const BUILT_IN = new Map(registry)
/** Drops every kind added at runtime, and puts back any built-in one replaced (the plugin unloading). */
export function resetGadgets() {
  registry.clear()
  for (const [name, k] of BUILT_IN) registry.set(name, k)
}
