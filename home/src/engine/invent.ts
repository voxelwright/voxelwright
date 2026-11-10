// An invented mechanic in the world (#106): a gadget kind whose behaviour is code a model wrote.
// The code never runs here. It runs in a sandbox (src/invent/sandbox.ts) that this file knows
// only as a Box: text in, text out, later. This is the trusted half. It registers as one more
// kind in the gadget registry (gadgets.ts), and each step it
//   1. reads the sandbox's answer to the last view and applies it: every command is checked like
//      any other data (a thing it was shown, finite numbers, held to limits) and goes through the
//      engine's own calls (api.ts); every state is numbers only;
//   2. sends the next view: the things that can move, the kind's gadgets with their knobs and
//      state, and what touched them or was wired to them since.
// So a mechanic acts one step after it sees, and only on toys' moving parts. Its state lives in
// each gadget's `state`, which snapshots already keep. Nothing here throws into the world's
// step. A sandbox that is slow skips views; one that keeps failing, or dies, stops the mechanic:
// its gadgets stay as parts, inert, and the world goes on.
import type { Gadget, ThingInfo, Touch, WorldApi } from './api'
import type { Vec3 } from './core'
import type { GadgetKind, Knob } from './gadgets'
import { obj, plain } from './made'
import { halfOf } from './world'
import { INVENT } from './invent-caps'
import type { Signal } from './toy'


/** One answer from the sandbox: its text, or why it has none, with the interrupt asks and ms it took. */
export interface Tock { out?: string; error?: string; asks: number; ms: number }

/** The sandbox as the engine sees it. Its answers arrive at Mechanic.tock. */
export interface Box {
  /** A view is out and unanswered. */
  readonly waiting: boolean
  tick(view: string): void
}

/** What a mechanic says its kind is, as checked data. */
interface KindDecl { about: string; knobs: Record<string, Knob>; inputs: string[]; outputs: string[] }

const NAME = /^[a-z][A-Za-z0-9]{0,23}$/
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const round = (x: number) => Math.round(x * 1e4) / 1e4
const round3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])]
/** A vector no longer than `max`. */
const held = (v: Vec3, max: number): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > max ? [v[0] * max / n, v[1] * max / n, v[2] * max / n] : v
}
/** A thing as a view shows it. */
const viewOf = (t: ThingInfo) => ({ key: t.key, material: t.material, position: round3(t.position), velocity: round3(t.velocity), mass: Number.isFinite(t.mass) ? round(t.mass) : 0, size: round(Math.max(...halfOf(t.shape))) })

/** A kind declaration from untrusted data, or why it cannot be one. */
export function checkKind(raw: unknown): KindDecl | { reason: string } {
  if (!obj(raw)) return { reason: 'it did not say what kind of gadget it is' }
  const knobs: Record<string, Knob> = {}
  const rawKnobs = raw.knobs === undefined ? {} : raw.knobs
  if (!obj(rawKnobs) || Object.keys(rawKnobs).length > INVENT.knobs) return { reason: `its knobs were not a list of at most ${INVENT.knobs}` }
  for (const [name, k] of Object.entries(rawKnobs)) {
    if (!NAME.test(name) || !obj(k)) return { reason: 'a knob had no plain name' }
    const { min, max, step } = k
    const def = k.default
    if (![min, max, step, def].every((x) => typeof x === 'number' && Number.isFinite(x))) return { reason: `the ${name} knob's range was not numbers` }
    if ((min as number) > (max as number) || (def as number) < (min as number) || (def as number) > (max as number) || !((step as number) > 0)) return { reason: `the ${name} knob needs its default between its lowest and highest, and a step above zero` }
    knobs[name] = { min: min as number, max: max as number, step: step as number, default: def as number, about: plain(k.about, 60) }
  }
  const ports = (v: unknown) => {
    const list = v === undefined ? [] : v
    return Array.isArray(list) && list.length <= INVENT.ports && list.every((p) => typeof p === 'string' && NAME.test(p)) && new Set(list).size === list.length ? list as string[] : null
  }
  const inputs = ports(raw.inputs), outputs = ports(raw.outputs)
  if (!inputs || !outputs) return { reason: `its inputs and outputs are at most ${INVENT.ports} plain names each` }
  return { about: plain(raw.about, 120) || 'An invented gadget.', knobs, inputs, outputs }
}

/** A gadget's state from untrusted data: plain names and finite numbers, at most INVENT.state of them. Anything else is left out. */
function checkState(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!obj(raw)) return out
  let n = 0
  for (const [name, v] of Object.entries(raw)) {
    if (n >= INVENT.state) break
    // A name every object already answers to ('constructor', 'toString') is not a state.
    if (!NAME.test(name) || name in out || typeof v !== 'number' || !Number.isFinite(v)) continue
    out[name] = v
    n++
  }
  return out
}

type GuestEvent = ['touch', { other: string; impulse: number; dir: Vec3; point: Vec3 }] | ['receive', string, { value: number; thing?: string }]

export class Mechanic {
  /** Why it stopped for good, or null while it runs. */
  stopped: string | null = null
  /** Told once when it stops. */
  onStop: (reason: string) => void = () => {}
  /** Told of each thing it moves (pushed, sped, put somewhere), so undoing it can put them back. */
  onMoved: (key: string) => void = () => {}
  private gadgets = new Map<string, Gadget>()
  private events = new Map<string, GuestEvent[]>()
  private answer: string | null = null
  /** Each gadget's state object as it went out in the last view: an answer replaces it only if it is still that one. */
  private sent = new Map<string, Record<string, number>>()
  /** The keys in the last view: the only things an answer may act on. */
  private offered = new Set<string>()
  private keys: string[] = []
  private keysVersion = -1
  private placesAt = -Infinity
  private placesSent = ''
  /** Per gadget: where its toy stands, worked out once. */
  private surfaces = new Map<string, { at: Vec3; x: Vec3; z: Vec3 } | null>()
  private clock = -1
  private sentClock = -1
  private strikes = 0
  /** Views sent and skipped, commands applied and refused, failed answers; and per view: ms on the page, ms in the sandbox, and interrupt asks. */
  readonly stats = { views: 0, skipped: 0, commands: 0, refused: 0, errors: 0, lastError: '', pageMs: [] as number[], boxMs: [] as number[], asks: [] as number[] }

  /** `hooks` are the functions the code defined ('step', 'touch', 'receive'); `places` returns the home's named things, each with the point it is at when called. */
  constructor(readonly kind: string, private decl: KindDecl, private hooks: string[], private places: () => Record<string, Vec3>, private box: Box) {}

  /** The kind to register: the trusted adapter between the world's hooks and the sandbox. */
  gadgetKind(): GadgetKind {
    const { about, knobs, inputs, outputs } = this.decl
    return {
      kind: this.kind, about, knobs, inputs, outputs,
      // A part of the toy to write on (`show`), as the counter has: naming it gives it a face of its own.
      settings: { display: 'part' },
      setup: (g) => void this.gadgets.set(g.id, g),
      step: (g, w) => {
        if (this.stopped || !this.gadgets.has(g.id) || w.clock === this.clock) return
        this.clock = w.clock
        const t0 = performance.now()
        try {
          this.turn(w)
        } catch (error) {
          this.stop(`it broke: ${plain(String((error as Error)?.message ?? error), 80)}`)
        }
        note(this.stats.pageMs, performance.now() - t0)
      },
      ...(this.hooks.includes('touch') ? { touch: (g: Gadget, t: Touch) => this.event(g, ['touch', { other: t.other, impulse: round(t.impulse), dir: round3(t.dir), point: round3(t.point) }]) } : {}),
      ...(this.hooks.includes('receive') ? { receive: (g: Gadget, port: string, s: Signal) => this.event(g, ['receive', port, { value: s.value, ...(s.thing ? { thing: s.thing } : {}) }]) } : {}),
    }
  }

  private event(g: Gadget, e: GuestEvent) {
    if (this.stopped) return
    const list = this.events.get(g.id) ?? []
    if (list.length < INVENT.events) list.push(e)
    this.events.set(g.id, list)
  }

  /** The sandbox's answer to the last view, kept until the next step applies it. */
  tock(reply: Tock) {
    if (this.stopped) return
    note(this.stats.boxMs, reply.ms)
    note(this.stats.asks, reply.asks)
    if (typeof reply.out === 'string') this.answer = reply.out
    else this.strike(plain(reply.error, 120) || 'it failed')
  }

  /** Stops it for good: no more views, no more commands. Its parts stay. */
  stop(reason: string) {
    if (this.stopped) return
    this.stopped = reason
    this.answer = null
    this.events.clear()
    this.onStop(reason)
  }

  private strike(reason: string) {
    this.stats.errors++
    this.stats.lastError = reason
    if (++this.strikes >= INVENT.strikes) this.stop(`it kept failing (${reason})`)
  }

  private turn(w: WorldApi) {
    if (this.answer !== null) {
      const text = this.answer
      this.answer = null
      this.apply(w, text)
    }
    if (this.stopped) return
    if (this.box.waiting) {
      this.stats.skipped++
      return
    }
    // A kind with no step of its own is asked only when something happened to it.
    if (!this.hooks.includes('step') && !this.events.size) return
    if (w.version !== this.keysVersion) {
      this.keysVersion = w.version
      this.keys = w.keys().filter((key) => {
        const t = w.thing(key)
        return t?.motion === 'dynamic' && t.toy !== 'followers' && t.toy !== 'bound'
      }).slice(0, INVENT.things)
    }
    const things = new Map<string, unknown>()
    for (const key of this.keys) {
      const t = w.thing(key)
      if (t) things.set(key, viewOf(t))
    }
    this.offered = new Set(things.keys())
    const gadgets = [...this.gadgets.values()].map((g) => {
      const part = g.part ? w.thing(g.part) : null
      this.sent.set(g.id, g.state)
      if (!this.surfaces.has(g.id)) this.surfaces.set(g.id, surfaceOf(w, g.toy))
      const surface = this.surfaces.get(g.id)
      return {
        id: g.id, knobs: g.knobs, state: g.state, events: this.events.get(g.id) ?? [], ...(surface ? { surface } : {}),
        ...(part ? { part: viewOf(part) } : {}),
      }
    })
    this.events.clear()
    const view = { h: round(this.sentClock < 0 || w.clock <= this.sentClock ? 1 / 60 : Math.min(INVENT.h, w.clock - this.sentClock)), clock: round(w.clock), gravity: w.rules.gravity, things: [...things.values()], gadgets }
    let json = ''
    // (The clock goes back when a snapshot is restored.)
    if (w.clock - this.placesAt >= INVENT.places || w.clock < this.placesAt) {
      this.placesAt = w.clock
      const places = JSON.stringify(this.places())
      if (places !== this.placesSent) {
        json = JSON.stringify({ ...view, places: JSON.parse(places) })
        if (json.length <= INVENT.view) this.placesSent = places
      }
    }
    if (!json || json.length > INVENT.view) json = JSON.stringify(view)
    if (json.length > INVENT.view) {
      this.stats.skipped++
      return
    }
    this.sentClock = w.clock
    this.stats.views++
    this.box.tick(json)
  }

  private apply(w: WorldApi, text: string) {
    let a: unknown
    try {
      a = JSON.parse(text)
    } catch {
      return this.strike('its answer could not be read')
    }
    if (!obj(a)) return this.strike('its answer could not be read')
    this.strikes = 0
    const commands = Array.isArray(a.commands) ? a.commands : []
    this.stats.refused += Math.max(0, commands.length - INVENT.commands)
    for (const c of commands.slice(0, INVENT.commands)) {
      if (this.command(w, c)) this.stats.commands++
      else this.stats.refused++
    }
    // A state changed from outside since the view went out (a snapshot restored) wins over the answer, which was worked out from the old one.
    if (obj(a.states)) for (const [id, g] of this.gadgets) if (Object.hasOwn(a.states, id) && this.sent.get(id) === g.state) g.state = checkState(a.states[id])
  }

  /** One command, checked. False when it was refused or did nothing. */
  private command(w: WorldApi, c: unknown): boolean {
    if (!Array.isArray(c)) return false
    const [op, a, b, d, e] = c as unknown[]
    if (op === 'fire' || op === 'show') {
      const g = typeof a === 'string' ? this.gadgets.get(a) : undefined
      if (!g) return false
      if (op === 'show') {
        const said = plain(typeof b === 'number' ? String(b) : b, INVENT.show)
        const display = g.spec.display
        if (typeof display !== 'string' || !said) return false
        w.show(`${g.toy}/${display}`, said)
        return true
      }
      if (typeof b !== 'string' || !this.decl.outputs.includes(b) || typeof d !== 'number' || !Number.isFinite(d)) return false
      w.fire(g, b, { value: d, ...(typeof e === 'string' && this.offered.has(e) ? { thing: e } : {}) })
      return true
    }
    if (typeof a !== 'string' || !this.offered.has(a) || !vec(b)) return false
    const done = op === 'push' ? w.applyImpulse(a, held(b, INVENT.impulse))
      : op === 'velocity' ? w.setVelocity(a, held(b, w.rules.maxSpeed))
      : op === 'move' ? (d === undefined || d === null || vec(d)) && w.moveTo(a, b, vec(d) ? d : [0, 0, 0])
      : false
    if (done) this.onMoved(a)
    return done
  }
}

/** Where a toy stands, from any of its things: its frame's origin and its x and z directions in the world. Null for a toy with no things. */
function surfaceOf(w: WorldApi, toy: string): { at: Vec3; x: Vec3; z: Vec3 } | null {
  const key = w.keys().find((k) => k.startsWith(`${toy}/`))
  const t = key ? w.thing(key) : null
  if (!t) return null
  const x = w.toWorldDir(toy, [1, 0, 0]), y = w.toWorldDir(toy, [0, 1, 0]), z = w.toWorldDir(toy, [0, 0, 1])
  const at = t.position.map((p, i) => p - x[i] * t.local[0] - y[i] * t.local[1] - z[i] * t.local[2]) as Vec3
  return { at: round3(at), x: round3(x), z: round3(z) }
}

/** Keeps the last few hundred of a measure. */
function note(list: number[], value: number) {
  list.push(value)
  if (list.length > 600) list.splice(0, 300)
}
