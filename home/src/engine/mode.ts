// A game mode (#108): a preset that bundles the rules a game is played under and the toys it
// brings, started and ended as one. Starting changes those rules and builds those toys, all or
// nothing; ending takes its toys out and puts back each rule it changed, unless someone changed
// that rule again meanwhile (their change stays). One mode runs at a time. Both ends are said as
// events, so whoever keeps the rules (the page's storage) or watches the home knows a mode's
// rules are on loan.
import type { PhysicsEvent } from './events'
import { presetRules, type Gravity, type Rules } from './rules'
import type { ToySpec } from './toy'
import type { World } from './world'

export interface GameMode {
  /** Lowercase letters, digits and dashes. */
  id: string
  label: string
  /** A preset (rules.ts) to play under, by name: what it changes from the rules in force. */
  preset?: string
  /** Rules it changes while it runs, over the preset's. */
  rules?: Partial<Rules>
  /** Toys it brings: built at the start, taken out at the end. */
  toys?: ToySpec[]
}

type Value = number | Gravity
const same = (a: Value | undefined, b: Value | undefined) => (Array.isArray(a) && Array.isArray(b) ? a.every((v, i) => v === b[i]) : a === b)
const copy = (v: Value): Value => (Array.isArray(v) ? [...v] : v)

export class Modes {
  private running: { mode: GameMode; before: Record<string, Value>; set: Record<string, Value> } | null = null

  constructor(private world: World, private emit: (e: PhysicsEvent) => void) {}

  /** The running mode's id, or null. */
  get active() {
    return this.running?.mode.id ?? null
  }

  /** Starts a mode: its toys built and its rules in force, or nothing changed and the reason. */
  start(mode: GameMode): { ok: true } | { ok: false; reason: string } {
    if (!mode || typeof mode.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(mode.id)) return { ok: false, reason: 'a mode id is lowercase letters, digits and dashes' }
    if (this.running) return { ok: false, reason: `${this.running.mode.label} is running` }
    if (this.world.disposed) return { ok: false, reason: 'the world has stopped' }
    const preset = mode.preset === undefined ? {} : presetRules(mode.preset)
    if (!preset) return { ok: false, reason: `no preset ${mode.preset}` }
    // Only what differs from now is changed, so only that is put back.
    const now = this.world.rules
    const wanted: Record<string, Value> = {}
    for (const [key, v] of Object.entries({ ...preset, ...mode.rules })) if (v !== undefined && Object.hasOwn(now, key) && !same(v, now[key])) wanted[key] = v
    const built: string[] = []
    try {
      for (const toy of mode.toys ?? []) {
        this.world.addToy(toy)
        built.push(toy.id)
      }
    } catch (error) {
      for (const id of built) this.world.removeToy(id)
      return { ok: false, reason: String((error as Error)?.message ?? error).slice(0, 160) }
    }
    const before: Record<string, Value> = {}
    for (const key of Object.keys(wanted)) before[key] = copy(now[key])
    const set: Record<string, Value> = {}
    if (Object.keys(wanted).length) {
      const applied = this.world.setRules(wanted, 'mode')
      if (!applied.ok) {
        for (const id of built) this.world.removeToy(id)
        return { ok: false, reason: applied.reason }
      }
      // As the checker left them (clamped to their ranges): what the end compares against.
      for (const key of Object.keys(wanted)) set[key] = copy(applied.rules[key])
    }
    this.running = { mode, before, set }
    this.emit({ kind: 'mode', mode: mode.id, label: mode.label, state: 'started' })
    return { ok: true }
  }

  /** Ends the running mode: its toys out, its rules back. False when none runs. */
  end() {
    const r = this.running
    if (!r) return false
    this.running = null
    if (this.world.disposed) return true
    for (const toy of r.mode.toys ?? []) this.world.removeToy(toy.id)
    const back: Record<string, Value> = {}
    for (const [key, v] of Object.entries(r.set)) if (same(this.world.rules[key], v)) back[key] = r.before[key]
    if (Object.keys(back).length) this.world.setRules(back, 'mode')
    this.emit({ kind: 'mode', mode: r.mode.id, label: r.mode.label, state: 'ended' })
    return true
  }
}
