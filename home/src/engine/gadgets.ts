// The gadget registry (#74): what each kind of gadget does, as hooks over the engine's API
// (api.ts). The world has no list of kinds: it calls a kind's hooks. The built-in kit below
// registers through registerGadget, the same call a new kind (a person's, or later an
// agent's sandboxed code) uses. Each kind has one to three named knobs.
import type { Gadget, Touch, WorldApi } from './api'
import type { Vec3 } from './core'
import type { Signal } from './toy'

export interface Knob { min: number; max: number; step: number; default: number; about: string }

export interface GadgetKind {
  kind: string
  about: string
  knobs: Record<string, Knob>
  /** Ports it reads (wired into) and writes (fires). */
  inputs: string[]
  outputs: string[]
  /** Once, when its toy is built. */
  setup?(g: Gadget, w: WorldApi): void
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
  inputs: [], outputs: [],
  setup(g, w) {
    g.state.joint = w.addHinge(g.part!, setting<Vec3>(g, 'anchor'), setting<Vec3>(g, 'axis'), [0, g.knobs.swing])
  },
  step(g, w) {
    const k = g.knobs
    w.setMotor(g.state.joint, (w.held(setting<string>(g, 'input')) ? 1 : -1) * k.speed * Math.min(2, w.rules.kick), k.torque * w.rules.kick)
  },
})

registerGadget({
  kind: 'piston', about: 'A dynamic part on a slider (settings: axis, input): pulled back along -axis while the input is held (fully after `charge` s, by `travel` m), driven forward on release at up to `strength` m/s, through its rest point by `travel` so a shot leaves at that speed, then eased back.',
  knobs: { strength: knob(0, 8, 0.05, 4.5, 'm/s'), travel: knob(0.01, 0.12, 0.005, 0.025, 'm'), charge: knob(0.1, 3, 0.05, 0.8, 's') },
  inputs: [], outputs: ['fired'],
  setup(g, w) {
    g.state.joint = w.addSlider(g.part!, setting<Vec3>(g, 'axis'), [-0.12, 0.12])
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
  knobs: {}, inputs: [], outputs: ['enter'],
  touch(g, t, w) {
    if (t.sensor && w.thing(t.other)?.motion === 'dynamic') w.fire(g, 'enter', { value: 1, thing: t.other, at: t.point })
  },
})

registerGadget({
  kind: 'emitter', about: 'On `spawn`, puts its part back where it started, at rest, after `delay` s: when the signal is about that part, or about nothing.',
  knobs: { delay: knob(0, 5, 0.1, 0.6, 's') }, inputs: ['spawn'], outputs: ['spawned'],
  receive(g, port, s, w) {
    if (port !== 'spawn' || !g.part || (s.thing && s.thing !== g.part)) return
    if (w.respawn(g.part, g.knobs.delay)) w.fire(g, 'spawned', { value: 1, thing: g.part })
  },
})

registerGadget({
  kind: 'counter', about: 'Adds `step` on `add`, zero on `reset`; `changed` carries the total. Shown on the part named by its `display` setting.',
  knobs: { step: knob(-100, 1000, 1, 1, 'per add') }, inputs: ['add', 'reset'], outputs: ['changed'],
  setup(g, w) {
    g.state.value = 0
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, '00000')
  },
  receive(g, port, _s, w) {
    if (port !== 'add' && port !== 'reset') return
    g.state.value = port === 'add' ? g.state.value + g.knobs.step : 0
    const display = setting<string | undefined>(g, 'display')
    if (display) w.show(`${g.toy}/${display}`, String(g.state.value).padStart(5, '0'))
    w.fire(g, 'changed', { value: g.state.value })
  },
})
