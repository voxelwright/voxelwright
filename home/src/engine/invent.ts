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
import type { Gadget, Touch, WorldApi } from './api'
import type { Shape, Vec3 } from './core'
import type { GadgetKind, Knob } from './gadgets'
import { plain } from './made'
import type { Signal } from './toy'

export const INVENT = {
  /** Moving things shown per view. */
  things: 96,
  /** Commands applied per answer; the rest are dropped and counted. */
  commands: 64,
  /** Touches and signals passed on per gadget per view. */
  events: 16,
  /** Numbers a gadget's state may hold. */
  state: 16,
  /** The most one push may add, N·s. */
  impulse: 20,
  /** Failed answers in a row before the mechanic is stopped. */
  strikes: 3,
  /** Characters a gadget may show on its part. */
  show: 12,
  /** Inputs, and outputs, a kind may declare. */
  ports: 4,
  /** Characters of one view; a longer one goes without the home's places, or not at all. */
  view: 48_000,
  /** The longest a view's `h` gets when views were skipped, s. */
  h: 0.1,
}

/** The sandbox as the engine sees it. Its answers arrive at Mechanic.tock. */
export interface Box {
  /** A view is out and unanswered. */
  readonly waiting: boolean
  tick(view: string): void
}

/** What a mechanic says its kind is, as checked data. */
export interface KindDecl { about: string; knobs: Record<string, Knob>; inputs: string[]; outputs: string[] }

const NAME = /^[a-z][A-Za-z0-9]{0,23}$/
const obj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const round = (x: number) => Math.round(x * 1e4) / 1e4
const round3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])]
/** A vector no longer than `max`. */
const held = (v: Vec3, max: number): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n > max ? [v[0] * max / n, v[1] * max / n, v[2] * max / n] : v
}
const sizeOf = (s: Shape) => round(s.kind === 'box' ? Math.max(...s.half) : s.kind === 'sphere' ? s.radius : s.kind === 'compound' ? Math.max(...s.boxes.flatMap((b) => b.half)) : Math.max(s.radius, s.halfHeight))

/** A kind declaration from untrusted data, or why it cannot be one. */
export function checkKind(raw: unknown): KindDecl | { reason: string } {
  if (!obj(raw)) return { reason: 'it did not say what kind of gadget it is' }
  const knobs: Record<string, Knob> = {}
  const rawKnobs = raw.knobs === undefined ? {} : raw.knobs
  if (!obj(rawKnobs) || Object.keys(rawKnobs).length > 3) return { reason: 'a gadget has at most three knobs' }
  for (const [name, k] of Object.entries(rawKnobs)) {
    if (!NAME.test(name) || !obj(k)) return { reason: 'a knob had no plain name' }
    const { min, max, step } = k
    const def = k.default
    if (![min, max, step, def].every((x) => typeof x === 'number' && Number.isFinite(x))) return { reason: `the ${name} knob's range was not numbers` }
    if ((min as number) > (max as number) || (def as number) < (min as number) || (def as number) > (max as number) || !((step as number) > 0)) return { reason: `the ${name} knob needs min <= default <= max` }
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
export function checkState(raw: unknown): Record<string, number> {
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
  private placesSent = false
  private clock = -1
  private sentClock = -1
  private strikes = 0
  private box: Box | null = null
  /** Views sent and skipped, commands applied and refused, failed answers; and per view: ms on the page, ms in the sandbox, and interrupt asks. */
  readonly stats = { views: 0, skipped: 0, commands: 0, refused: 0, errors: 0, lastError: '', pageMs: [] as number[], boxMs: [] as number[], asks: [] as number[] }

  /** `hooks` are the functions the code defined ('step', 'touch', 'receive'); `places` names fixed things of the home with a point each. */
  constructor(readonly kind: string, private decl: KindDecl, private hooks: string[], private places: () => Record<string, Vec3>) {}

  attach(box: Box) {
    this.box = box
  }

  /** The kind to register: the trusted adapter between the world's hooks and the sandbox. */
  gadgetKind(): GadgetKind {
    const { about, knobs, inputs, outputs } = this.decl
    return {
      kind: this.kind, about, knobs, inputs, outputs,
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
  tock(reply: { out?: string; error?: string; asks: number; ms: number }) {
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
    if (this.stopped || !this.box) return
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
      this.placesSent = false
    }
    const things = new Map<string, unknown>()
    for (const key of this.keys) {
      const t = w.thing(key)
      if (t) things.set(key, { key, material: t.material, position: round3(t.position), velocity: round3(t.velocity), mass: round(t.mass), size: sizeOf(t.shape) })
    }
    this.offered = new Set(things.keys())
    const gadgets = [...this.gadgets.values()].map((g) => {
      const part = g.part ? w.thing(g.part) : null
      this.sent.set(g.id, g.state)
      return {
        id: g.id, knobs: g.knobs, state: g.state, events: this.events.get(g.id) ?? [],
        ...(part ? { part: { key: part.key, material: part.material, position: round3(part.position), velocity: round3(part.velocity), mass: Number.isFinite(part.mass) ? round(part.mass) : 0, size: sizeOf(part.shape) } } : {}),
      }
    })
    this.events.clear()
    const view = { h: round(Math.min(INVENT.h, this.sentClock < 0 ? 1 / 60 : w.clock - this.sentClock)), clock: round(w.clock), gravity: w.rules.gravity, things: [...things.values()], gadgets }
    let json = this.placesSent ? '' : JSON.stringify({ ...view, places: this.places() })
    if (!json || json.length > INVENT.view) json = JSON.stringify(view)
    else this.placesSent = true
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
        if (!g.part || !said) return false
        w.show(g.part, said)
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

/** Keeps the last few hundred of a measure. */
function note(list: number[], value: number) {
  list.push(value)
  if (list.length > 600) list.splice(0, 300)
}
