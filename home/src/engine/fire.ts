// Fire, heat and water (#74). The heat itself lives on the GPU as a field (heat.ts): it spreads,
// rises, cools, is quenched by water and chars what it touches. What gameplay needs back is
// small and discrete, so it stays here, per part: a temperature that follows the field's heat
// around the part (read back as one sample per part, a few times a second, never the whole
// field), its fuel, how wet it is, and whether it is cold, burning or burnt. A burning part
// heats the field round it; a wet one is hard to light; water in the field puts fire out. The
// facts come from each part's material (materials.ts: flammability, ignition, burn rate, heat
// capacity, how much water it takes). What happens is said on the event stream: ignite,
// extinguish, burnt.
import type { Vec3 } from './core'
import type { PhysicsEvent } from './events'
import { thermal, type Thermal } from './materials'
import type { Burnable, Burner, World } from './world'

/** Something that adds to the field over a box: heat towards `heat` °C at `rate` per second, water up to `water`, char stamped up to `char`. */
export interface Source { center: Vec3; half: Vec3; heat: number; rate: number; water: number; char: number }

/** The field, on whatever runs it (heat.ts on the GPU). */
export interface HeatField {
  /** Advances the field by dt simulated seconds. `rain` is water falling everywhere, 0 to 1. */
  step(dt: number, sources: Source[], rain: number): void
  /** Per box: the hottest heat (°C above the room), the most water (0 to 1) and the char (0 to 1) in it. Null when the field could not be read. */
  sample(boxes: { center: Vec3; half: Vec3 }[]): Promise<Float32Array | null>
  /** Back to a cold, dry, clean field. */
  clear(): void
  /** The field's state for the looks: whether anything in it is worth drawing. */
  setActive(active: boolean): void
  /** Lightning's flash over the picture, 0 to 1. */
  setFlash(flash: number): void
  /** Whether it is stepping (fire or water at work): the looks read the heat and light only then. */
  setHot(hot: boolean): void
  /** The box it covers, world space. A part outside it takes no heat and gives none. */
  readonly bounds: { min: Vec3; max: Vec3 }
  dispose(): void
}

type State = 'cold' | 'burning' | 'burnt'
interface Part {
  b: Burnable; th: Thermal; state: State; fuel: number; wet: number; temp: number; char: number
  /** Seconds burning, this time. */
  burnt: number
  water: number
  /** Where it caught, from the part's centre: the fire spreads over the part from there, and moves with it. */
  origin: Vec3
  /** Its centre is inside the field. */
  inside: boolean
}

/** Simulated seconds per field step. */
const TICK = 1 / 20
/** At most this many field steps a frame (a slow frame does not pile up work). */
const MAX_TICKS = 2
/** Sources the field takes at once (heat.ts's texture width). */
export const MAX_SOURCES = 128
/** Probes the field answers at once (heat.ts's probe texture). */
export const MAX_PROBES = 2048
/** Seconds after the last fire or water before the field stops stepping (it has cooled and dried by then). */
const LINGER = 30
/** Wetness above which a burning part goes out, and how much harder wetness makes a part to light. */
const QUENCH = 0.35
const WET_IGNITION = 2.5
/** How long a douse or a candle's first flame pours into the field, s. */
const POUR = 1.2
/** How fast fire creeps across a part, m/s, at flammability 0 and 1 (felt is about 15 cm a second). */
const CREEP = [0.03, 0.16] as const
/** A part's temperature follows the heat round it with a lag of this many seconds per unit of heat capacity. */
const LAG = 3
/** ms after which a sample that has not come back is given up. */
const LOST_MS = 2000

/** The box a part's fire covers now: the part's box cut to a cube round where it caught, grown since. */
export function reach(center: Vec3, half: Vec3, origin: Vec3, radius: number): { center: Vec3; half: Vec3 } {
  const c: Vec3 = [0, 0, 0], h: Vec3 = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(center[i] - half[i], origin[i] - radius), hi = Math.min(center[i] + half[i], origin[i] + radius)
    c[i] = (lo + hi) / 2
    h[i] = Math.max(0, (hi - lo) / 2)
  }
  return { center: c, half: h }
}

export interface FireSnapshot { parts: Record<string, { state: State; fuel: number; wet: number; temp: number; burnt?: number; origin?: Vec3 }>; rain: number }

export interface FireStats {
  parts: number
  burning: number
  burnt: number
  wet: number
  hottest: number
  /** Simulated seconds the field has stepped since start. */
  fieldTime: number
  /** ms of CPU per frame this costs (field steps issued, samples read), recent median and p95. */
  frameMs: { median: number; p95: number; n: number }
  samples: number
  /** Samples given up because the GPU never answered. */
  lost: number
  active: boolean
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(3)
}
const at = (p: Vec3) => ({ x: +p[0].toFixed(3), y: +p[1].toFixed(3), z: +p[2].toFixed(3) })

export class Fire implements Burner {
  private parts = new Map<string, Part>()
  private order: Part[] = []
  private seen = -1
  private acc = 0
  private fieldTime = 0
  /** Field time of the samples last applied. */
  private appliedAt = 0
  private inFlight = false
  /** performance.now() when the sample in flight was asked for. */
  private askedAt = 0
  /** Samples dropped because the GPU never answered. */
  private lost = 0
  /** Bumped by restore and clear: a sample asked for before it is dropped. */
  private generation = 0
  private pours: { source: Source; until: number }[] = []
  private rainUntil = 0
  private rainAmount = 0
  private lastHot = -Infinity
  private frameTimes: number[] = []
  private samples = 0
  private disposed = false
  private burningCount = 0
  /** Something is still wet: the field keeps stepping (and things keep drying) until it is dry. */
  private damp = false
  private running = false
  /** The looks are reading heat and light (set by stepping, cleared by rest()). */
  private looksHot = false
  private pending: Promise<void> | undefined

  constructor(private world: World, private field: HeatField, private emit: (e: PhysicsEvent) => void) {
    world.burner = this
  }

  /** The parts that take heat, read again from the world when it changed; moving ones are moved. */
  private refresh() {
    if (this.world.version !== this.seen) {
      const list = this.world.burnables()
      this.seen = this.world.version
      const next = new Map<string, Part>()
      for (const b of list) {
        const old = this.parts.get(b.id)
        next.set(b.id, old ? Object.assign(old, { b, th: thermal(b.material) }) : { b, th: thermal(b.material), state: 'cold', fuel: 1, wet: 0, temp: 0, char: 0, burnt: 0, water: 0, origin: [0, 0, 0], inside: true })
      }
      this.parts = next
      for (const p of next.values()) p.inside = this.covers(p.b.center)
      // A thing taken away while it burned (undo in build mode) takes its fire with it.
      this.burningCount = [...next.values()].filter((p) => p.state === 'burning').length
      this.order = [...next.values()].slice(0, MAX_PROBES)
    } else for (const b of this.world.burnables(true)) {
      const p = this.parts.get(b.id)
      if (p) {
        p.b = b
        p.inside = this.covers(b.center)
      }
    }
  }

  private covers(c: Vec3) {
    const { min, max } = this.field.bounds
    return c.every((x, i) => x >= min[i] && x <= max[i])
  }

  /** A thing's parts: all of them (part undefined), its unnamed rest (''), or one named part. */
  private find(thing: string, part?: string): Part[] {
    this.refresh()
    if (part !== undefined) {
      const p = this.parts.get(part ? `${thing}:${part}` : thing)
      return p ? [p] : []
    }
    return [...this.parts.values()].filter((p) => p.b.thing === thing)
  }

  ignite(thing: string, part: string | undefined, by: 'ask' | 'gadget' | 'code') {
    const found = this.find(thing, part)
    if (!found.length) return `nothing called ${part ? `${thing}:${part}` : thing} takes heat`
    const lit = found.filter((p) => p.th.flammability > 0 && p.state !== 'burnt' && p.fuel > 0 && p.inside)
    if (!lit.length) return found.some((p) => p.state === 'burnt') ? 'it has burnt out' : found.some((p) => p.th.flammability > 0) ? 'it is outside the heat field' : `${found[0].b.material} does not burn`
    // A gadget's flame does not light what is soaked (a doused candle stays out); a person's ask dries it and lights it.
    if (by === 'gadget' && lit.every((p) => p.state !== 'burning' && p.wet > QUENCH)) return 'it is too wet'
    for (const p of lit) {
      if (by !== 'gadget') p.wet = 0
      p.temp = Math.max(p.temp, p.th.ignition)
      if (p.state !== 'burning') {
        p.origin = [0, p.b.half[1], 0]
        this.light(p, by)
      }
    }
    this.lastHot = this.fieldTime
    this.field.setActive(true)
    return null
  }

  douse(thing: string, part: string | undefined, by: 'ask' | 'gadget' | 'code') {
    const found = this.find(thing, part)
    if (!found.length) return `nothing called ${part ? `${thing}:${part}` : thing} to pour water on`
    for (const p of found) {
      p.wet = Math.min(1, p.wet + 0.4 + 0.6 * p.th.absorbs)
      // Water poured from above: it lands on the part and runs down round it.
      this.pours.push({ source: { center: [p.b.center[0], p.b.center[1] + p.b.half[1] * 0.5, p.b.center[2]], half: [p.b.half[0] + 0.1, p.b.half[1] * 0.6 + 0.1, p.b.half[2] + 0.1], heat: 0, rate: 0, water: 1, char: 0 }, until: this.fieldTime + POUR })
      if (p.state === 'burning') this.out(p, 'water')
    }
    this.lastHot = this.fieldTime
    this.field.setActive(true)
    return null
  }

  /** Rain everywhere for `seconds`: it wets what absorbs water and puts out fires that are not sheltered. */
  rain(seconds: number, amount = 0.8) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'rain lasts a few seconds'
    this.rainUntil = this.fieldTime + Math.min(60, seconds)
    this.rainAmount = Math.min(1, Math.max(0.05, amount))
    this.lastHot = this.fieldTime
    this.field.setActive(true)
    return null
  }

  strike(thing: string, part: string | undefined) {
    const found = this.find(thing, part)
    if (!found.length) return `nothing called ${part ? `${thing}:${part}` : thing} to strike`
    // A flash of great heat at the top of it: the field and each part's own facts decide what catches.
    for (const p of found) {
      this.pours.push({ source: { center: [p.b.center[0], p.b.center[1] + p.b.half[1] * 0.5, p.b.center[2]], half: [Math.min(p.b.half[0], 0.25), Math.min(p.b.half[1], 0.25), Math.min(p.b.half[2], 0.25)], heat: 1600, rate: 40, water: 0, char: 0.3 }, until: this.fieldTime + 0.5 })
      // A strike lands hot enough to light what burns at once, wherever its sample falls.
      p.temp = Math.max(p.temp, p.th.flammability > 0 ? p.th.ignition * (1 + WET_IGNITION * p.wet) : 900)
    }
    this.flash = 1
    this.lastHot = this.fieldTime
    this.field.setActive(true)
    return null
  }

  /** 1 just after lightning, fading: the looks flash the room. */
  flash = 0

  burning(thing: string) {
    for (const p of this.parts.values()) if (p.b.thing === thing && p.state === 'burning') return true
    return false
  }

  /** Where heat lit a part: its point nearest the nearest fire, from its centre. */
  private caughtAt(p: Part): Vec3 {
    let best: Vec3 = p.b.center, d = Infinity
    for (const q of this.order) {
      if (q === p || q.state !== 'burning') continue
      const near = q.b.center.map((x, i) => Math.min(p.b.center[i] + p.b.half[i], Math.max(p.b.center[i] - p.b.half[i], x))) as Vec3
      const dist = Math.hypot(near[0] - q.b.center[0], near[1] - q.b.center[1], near[2] - q.b.center[2])
      if (dist < d) [d, best] = [dist, near]
    }
    return [best[0] - p.b.center[0], best[1] - p.b.center[1], best[2] - p.b.center[2]]
  }

  /** The box a burning part's fire covers now. */
  private extent(p: Part) {
    const o = p.origin, c = p.b.center
    return reach(c, p.b.half, [c[0] + o[0], c[1] + o[1], c[2] + o[2]], 0.06 + (CREEP[0] + (CREEP[1] - CREEP[0]) * p.th.flammability) * p.burnt)
  }

  private light(p: Part, by: 'heat' | 'ask' | 'gadget' | 'code') {
    p.state = 'burning'
    p.burnt = 0
    this.burningCount++
    this.emit({ kind: 'ignite', thing: p.b.thing, part: p.b.part, material: p.b.material, at: at(p.b.center), by, temperature: Math.round(p.temp) })
  }

  private out(p: Part, by: 'water' | 'ask' | 'gadget' | 'code') {
    p.state = 'cold'
    this.burningCount--
    this.emit({ kind: 'extinguish', thing: p.b.thing, part: p.b.part, material: p.b.material, at: at(p.b.center), by, fuel: +p.fuel.toFixed(3) })
  }

  /** Whether anything burns now (cheap: kept as parts catch and go out). */
  get lit() {
    return this.burningCount > 0
  }

  /** Whether the field needs stepping: anything burning, poured, raining, or still cooling down. */
  get active() {
    return this.fieldTime - this.lastHot < LINGER || this.fieldTime < this.rainUntil || this.pours.length > 0 || this.damp
  }

  /** The field's sources now: burning parts heat round them, charred ones keep their char where their fire reached, pours and candles. */
  private sources(): Source[] {
    const out: Source[] = []
    for (const p of this.order) {
      if (p.state === 'burning' && p.inside) {
        // A fire grows over its first seconds and dies down as the last of its fuel goes.
        const grow = Math.min(1, 0.35 + p.burnt / 3) * Math.min(1, 0.2 + p.fuel * 5)
        const e = this.extent(p)
        out.push({ center: e.center, half: e.half, heat: (450 + 550 * p.th.flammability) * grow, rate: 1.5 + 3 * p.th.flammability, water: 0, char: p.char })
      }
    }
    for (const x of this.pours) out.push(x.source)
    for (const p of this.order) if (p.state !== 'burning' && p.inside && p.char > 0.02 && out.length < MAX_SOURCES) out.push({ ...(p.state === 'burnt' ? p.b : this.extent(p)), heat: 0, rate: 0, water: 0, char: p.char })
    return out.slice(0, MAX_SOURCES)
  }

  /** One field step of TICK simulated seconds. */
  /** Stopped: what is charred still shows (char stays), the heat and light are no longer read. */
  private rest() {
    this.looksHot = false
    this.field.setHot(false)
    this.field.setActive(this.order.some((p) => p.char > 0.02))
  }

  private tick() {
    this.looksHot = true
    this.field.setHot(true)
    this.fieldTime += TICK
    this.pours = this.pours.filter((x) => x.until > this.fieldTime)
    const raining = this.fieldTime < this.rainUntil ? this.rainAmount : 0
    this.field.step(TICK, this.sources(), raining)
  }

  /** What the samples say, for `dt` simulated seconds: temperatures follow, fires catch, burn, go out. */
  private apply(values: Float32Array, parts: Part[], dt: number) {
    let hot = false
    parts.forEach((p, i) => {
      if (this.parts.get(p.b.id) !== p) return
      // Outside the field there is no heat or water to read (it would be the field's edge, metres away).
      const heat = p.inside ? values[i * 4] : 0, water = p.inside ? values[i * 4 + 1] : 0
      p.water = water
      // A part follows the heat round it, more slowly the more heat it holds.
      p.temp += (heat - p.temp) * (1 - Math.exp(-dt / (p.th.heatCapacity * LAG)))
      p.wet = Math.min(1, Math.max(0, p.wet + water * p.th.absorbs * dt * 1.5 - p.wet * dt * (0.01 + Math.max(0, p.temp) / 1500)))
      if (p.state === 'cold' && p.th.flammability > 0 && p.fuel > 0 && p.temp >= p.th.ignition * (1 + WET_IGNITION * p.wet)) {
        p.origin = this.caughtAt(p)
        this.light(p, 'heat')
      }
      else if (p.state === 'burning') {
        p.burnt += dt
        // A big part burns as long as its fire takes to reach all of it, then at its material's rate.
        const e = this.extent(p)
        const covered = Math.min(1, [0, 1, 2].reduce((v, i) => v * Math.max(0.02, e.half[i]) / Math.max(0.02, p.b.half[i]), 1))
        p.fuel = Math.max(0, p.fuel - p.th.burnRate * covered * dt * (1 - 0.8 * p.wet))
        // It blackens in seconds, long before its fuel is gone.
        p.char = Math.max(p.char, Math.min(0.85, Math.max(1 - p.fuel, p.burnt / 6)))
        if (p.wet > QUENCH || water > 0.5) this.out(p, 'water')
        else if (p.fuel <= 0) {
          p.state = 'burnt'
          p.char = 1
          this.burningCount--
          this.emit({ kind: 'burnt', thing: p.b.thing, part: p.b.part, material: p.b.material, at: at(p.b.center) })
        }
      }
      if (p.state === 'burning' || p.temp > 60) hot = true
    })
    if (hot) this.lastHot = this.fieldTime
    this.damp = parts.some((p) => p.wet > 0.02 || p.water > 0.02)
    this.field.setActive(true)
  }

  /** Ask the field for one sample per part; applied when it comes back, for the field time that passed. */
  private ask() {
    if (this.disposed) return
    // A readback that never came back (seen once in a few hundred, headless) must not freeze fire: drop it and ask again.
    if (this.inFlight && performance.now() - this.askedAt > LOST_MS) {
      this.generation++
      this.inFlight = false
      this.lost++
    }
    if (this.inFlight) return
    this.refresh()
    this.inFlight = true
    this.askedAt = performance.now()
    const gen = this.generation
    const parts = this.order
    const asked = this.fieldTime
    return (this.pending = this.field.sample(parts.map((p) => p.b)).then((values) => {
      if (gen !== this.generation) return
      this.inFlight = false
      if (this.disposed || !values) return
      this.samples++
      this.apply(values, parts, Math.max(0, asked - this.appliedAt))
      this.appliedAt = asked
    }, (error) => {
      if (gen === this.generation) this.inFlight = false
      console.error('fire: the heat field could not be read', error)
    }))
  }

  /** One rendered frame of `dt` real seconds, at the world's time scale. Costs nothing while nothing is hot or wet. */
  frame(dt: number) {
    if (this.disposed) return
    if (this.flash > 0.001) {
      this.flash *= Math.exp(-dt * 7)
      this.field.setFlash(this.flash > 0.01 ? this.flash : 0)
    }
    // run() steps the field itself; frames add no time meanwhile.
    if (this.running) return
    if (!this.active) {
      this.acc = 0
      // It went quiet (a sample found things dry, or run() ended): the looks drop to char only, once.
      if (this.looksHot) this.rest()
      return
    }
    const t0 = performance.now()
    this.acc += Math.min(dt, 0.1) * this.world.rules.timeScale
    let n = 0
    while (this.acc >= TICK && n < MAX_TICKS) {
      this.tick()
      this.acc -= TICK
      n++
    }
    if (n === MAX_TICKS) this.acc = 0
    if (n) void this.ask()
    if (!this.active) this.rest()
    this.frameTimes.push(performance.now() - t0)
    if (this.frameTimes.length > 1200) this.frameTimes.splice(0, 600)
  }

  /** Steps `seconds` of simulated time at once, reading the field back every other step (checks and tests). */
  async run(seconds: number) {
    this.refresh()
    this.running = true
    try {
      // A sample a frame asked for is let in first, so each one below covers exactly the steps before it.
      // ...but not forever: a readback that never comes back must not hang this (and with it every frame).
      await Promise.race([this.pending, new Promise((r) => setTimeout(r, LOST_MS))])
      const n = Math.round(seconds / TICK)
      for (let i = 0; i < n && !this.disposed; i++) {
        this.lastHot = Math.max(this.lastHot, this.fieldTime - LINGER + 1)
        this.tick()
        if (i % 2 === 1 || i === n - 1) {
          await this.ask()
          this.refresh()
        }
      }
    } finally {
      this.running = false
    }
  }

  /** Every part as it stands: for the looks (flames.ts), the checks, and agents perceiving the home. */
  list() {
    this.refresh()
    return [...this.parts.values()].map((p) => ({ id: p.b.id, thing: p.b.thing, part: p.b.part, material: p.b.material, state: p.state, fuel: +p.fuel.toFixed(3), wet: +p.wet.toFixed(3), temp: Math.round(p.temp), char: +p.char.toFixed(3), center: p.b.center, half: p.b.half, burnt: p.burnt }))
  }

  /** The parts burning now, for drawing flames: box, how strong (0 to 1) and flammability. */
  flames() {
    const out: { id: string; center: Vec3; half: Vec3; strength: number; fierce: number; box: { center: Vec3; half: Vec3 } }[] = []
    for (const p of this.order) if (p.state === 'burning') out.push({ id: p.b.id, box: { center: p.b.center, half: p.b.half }, ...this.extent(p), strength: Math.min(1, 0.3 + p.burnt / 3) * Math.min(1, 0.2 + p.fuel * 5) * (1 - 0.7 * p.wet), fierce: p.th.flammability })
    return out
  }

  stats(): FireStats {
    this.refresh()
    let burning = 0, burnt = 0, wet = 0, hottest = 0
    for (const p of this.parts.values()) {
      if (p.state === 'burning') burning++
      if (p.state === 'burnt') burnt++
      if (p.wet > 0.05) wet++
      hottest = Math.max(hottest, p.temp)
    }
    return { parts: this.parts.size, burning, burnt, wet, hottest: Math.round(hottest), fieldTime: +this.fieldTime.toFixed(2), frameMs: { median: quantile(this.frameTimes, 0.5), p95: quantile(this.frameTimes, 0.95), n: this.frameTimes.length }, samples: this.samples, lost: this.lost, active: this.active }
  }

  clearStats() {
    this.frameTimes.length = 0
  }

  snapshot(): FireSnapshot {
    const parts: FireSnapshot['parts'] = {}
    for (const [id, p] of this.parts) if (p.state !== 'cold' || p.fuel < 1 || p.wet > 0 || p.temp > 1) parts[id] = { state: p.state, fuel: p.fuel, wet: p.wet, temp: p.temp, burnt: p.burnt, origin: [...p.origin] }
    return { parts, rain: Math.max(0, this.rainUntil - this.fieldTime) }
  }

  /**
   * Puts fire and wetness back as a snapshot had them (checked like any input), or every part
   * cold, dry and whole when it has none. The field starts again cold and dry; burning parts heat
   * it again and charred ones stamp their char back. Returns what had to be skipped.
   */
  restore(raw: unknown): string[] {
    const clamped: string[] = []
    this.generation++
    this.inFlight = false
    this.pours = []
    this.rainUntil = 0
    this.field.clear()
    this.refresh()
    for (const p of this.parts.values()) Object.assign(p, { state: 'cold', fuel: 1, wet: 0, temp: 0, char: 0, burnt: 0, water: 0 })
    this.burningCount = 0
    this.damp = false
    const s = raw as Partial<FireSnapshot> | undefined
    if (s === undefined || s === null) return clamped
    if (typeof s !== 'object' || !s.parts || typeof s.parts !== 'object') return ['fire']
    const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
    for (const [id, saved] of Object.entries(s.parts)) {
      const p = this.parts.get(id)
      if (!p || !saved || !['cold', 'burning', 'burnt'].includes(saved.state) || !unit(saved.fuel) || !unit(saved.wet) || !(typeof saved.temp === 'number' && Number.isFinite(saved.temp) && saved.temp >= -50 && saved.temp <= 3000)) {
        clamped.push(`fire.${id}`)
        continue
      }
      if (saved.state !== 'cold' && p.th.flammability === 0) {
        clamped.push(`fire.${id}`)
        continue
      }
      Object.assign(p, { state: saved.state, fuel: saved.fuel, wet: saved.wet, temp: saved.temp, char: saved.state === 'burnt' ? 1 : Math.min(1, 1 - saved.fuel), burnt: saved.state === 'burning' ? (typeof saved.burnt === 'number' && Number.isFinite(saved.burnt) && saved.burnt >= 0 ? Math.min(saved.burnt, 1e5) : 3) : 0,
        // Where it caught, from its centre, kept inside the part's box whatever the snapshot said.
        origin: p.b.half.map((h, i) => {
          const o = Array.isArray(saved.origin) ? saved.origin[i] : NaN
          return typeof o === 'number' && Number.isFinite(o) ? Math.min(h, Math.max(-h, o)) : 0
        }) as Vec3 })
    }
    this.burningCount = [...this.parts.values()].filter((p) => p.state === 'burning').length
    if (typeof s.rain === 'number' && Number.isFinite(s.rain) && s.rain > 0) this.rain(s.rain)
    this.lastHot = this.fieldTime
    this.field.setActive(true)
    return clamped
  }

  dispose() {
    this.disposed = true
    if (this.world.burner === this) this.world.burner = undefined
    this.field.dispose()
  }
}
