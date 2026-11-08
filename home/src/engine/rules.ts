// World rules (#74): one object that says how the whole world behaves, tuned live from the
// panel, by presets (one per game mode) or by talking. FIELDS is the one owner of each
// rule's range and default: the checker clamps to it, the panel draws its sliders from it,
// and the host quotes this file to the model. Open at runtime: registerRule adds a rule (a
// gadget kind reads it from world.rules), registerPreset a game mode. A change is checked
// whole and applied all at once (World.setRules), never half-applied.

export type Gravity = [number, number, number]

export interface Rules {
  /** m/s², world space; [0, -9.81, 0] is the Earth. */
  gravity: Gravity
  /** Simulated seconds per real second. */
  timeScale: number
  /** Multiplies every pair's combined restitution (bounciness). */
  bounce: number
  /** Multiplies every pair's combined friction. */
  friction: number
  /** Air drag: linear damping per second on every moving thing. */
  drag: number
  /** Multiplies the strength of kicks, plungers and flipper motors. */
  kick: number
  /** Multiplies how loud and dusty impacts look and sound. */
  impact: number
  /** No moving thing goes faster than this (m/s); faster ones are visibly clamped instead of exploding. */
  maxSpeed: number
  /** Collision steps per frame. */
  substeps: number
  /** The most force (N) a walking villager pushes with: what needs more holds it back. */
  strength: number
  /** Rules registered at runtime (registerRule): numbers only. */
  [added: string]: number | Gravity
}

export interface Field { min: number; max: number; step: number; about: string }

export const FIELDS: Record<string, Field> = {
  gravity: { min: -30, max: 30, step: 0.01, about: 'gravity per axis, m/s²' },
  timeScale: { min: 0.1, max: 2, step: 0.01, about: 'simulated seconds per real second' },
  bounce: { min: 0, max: 1.6, step: 0.01, about: 'multiplies bounciness' },
  friction: { min: 0, max: 3, step: 0.01, about: 'multiplies friction' },
  drag: { min: 0, max: 3, step: 0.01, about: 'air drag per second' },
  kick: { min: 0, max: 4, step: 0.01, about: 'multiplies kicks, plungers and flippers' },
  impact: { min: 0, max: 3, step: 0.01, about: 'multiplies impact sound and dust' },
  maxSpeed: { min: 1, max: 40, step: 0.1, about: 'speed limit, m/s' },
  substeps: { min: 1, max: 4, step: 1, about: 'collision steps per frame' },
  strength: { min: 0, max: 2000, step: 1, about: 'how hard a villager pushes, N' },
}

export const NORMAL: Rules = { gravity: [0, -9.81, 0], timeScale: 1, bounce: 1, friction: 1, drag: 0.05, kick: 1, impact: 1, maxSpeed: 12, substeps: 1, strength: 120 }

/** Each preset says only what differs from NORMAL. */
export const PRESETS: Record<string, { label: string; rules: Partial<Rules> }> = {
  normal: { label: 'Normal', rules: {} },
  moon: { label: 'Moon', rules: { gravity: [0, -1.62, 0], drag: 0 } },
  super: { label: 'Super powers', rules: { kick: 3, bounce: 1.25, impact: 2, maxSpeed: 25, strength: 900 } },
  slow: { label: 'Slow motion', rules: { timeScale: 0.3 } },
}

/** A preset's whole rules: NORMAL with its changes. */
export const presetRules = (name: string): Rules | undefined =>
  Object.hasOwn(PRESETS, name) ? { ...NORMAL, gravity: [...NORMAL.gravity], ...PRESETS[name].rules } as Rules : undefined

export const ruleKeys = () => Object.keys(FIELDS)

// What the module held before anything was registered at runtime, so unloading can put it back.
const BUILT_IN = { fields: structuredClone(FIELDS), normal: structuredClone(NORMAL), presets: { ...PRESETS } }
/** Worlds hear of a rule added after they started, so their rules carry it too. */
const listeners = new Set<(name: string, value: number) => void>()
export function onRuleAdded(fn: (name: string, value: number) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Drops every rule and preset added at runtime and restores the built-ins (the plugin unloading). */
export function resetRules() {
  for (const key of Object.keys(FIELDS)) delete FIELDS[key]
  for (const key of Object.keys(NORMAL)) delete NORMAL[key]
  for (const key of Object.keys(PRESETS)) delete PRESETS[key]
  Object.assign(FIELDS, structuredClone(BUILT_IN.fields))
  Object.assign(NORMAL, structuredClone(BUILT_IN.normal))
  Object.assign(PRESETS, BUILT_IN.presets)
}

/** Whether two rule sets say the same about every known rule. */
export const sameRules = (a: Rules, b: Rules) =>
  ruleKeys().every((k) => (k === 'gravity' ? (a.gravity as number[]).every((v, i) => v === b.gravity[i]) : a[k] === b[k]))

const NAME = /^[a-z][a-zA-Z0-9]{0,31}$/
/** Adds a numeric rule with its range and default. Returns null, or why it was refused. */
export function registerRule(name: string, field: Field & { default: number }): string | null {
  if (!NAME.test(name) || Object.hasOwn(FIELDS, name)) return `${name} is taken or not a rule name`
  const { min, max, step, about } = field
  if (![min, max, step, field.default].every(Number.isFinite) || min > max || step <= 0 || field.default < min || field.default > max) return 'a rule needs min <= default <= max and a positive step'
  FIELDS[name] = { min, max, step, about: String(about).slice(0, 120) }
  NORMAL[name] = field.default
  for (const fn of listeners) fn(name, field.default)
  return null
}

/** Adds or replaces a preset: a label and the rules it changes (checked when applied). */
export function registerPreset(name: string, label: string, rules: Partial<Rules>): string | null {
  if (!NAME.test(name)) return 'a preset name is letters and digits'
  PRESETS[name] = { label: String(label).slice(0, 40), rules }
  return null
}

const clampTo = (f: Field, v: number) => {
  const c = Math.min(f.max, Math.max(f.min, v))
  return f.step === 1 ? Math.round(c) : c
}

/**
 * Rules from untrusted data (a model's answer, a stored tuning), field by field over
 * `current`: own keys of FIELDS only, a missing field keeps its current value, a non-number
 * or non-finite one keeps it too and is listed, an out-of-range one is clamped and listed.
 * Anything that is not a plain object is refused.
 */
export function checkRules(raw: unknown, current: Rules): { rules: Rules; clamped: string[] } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'rules are not an object' }
  const r = raw as Record<string, unknown>
  const next: Rules = { ...NORMAL, ...current, gravity: [...current.gravity] }
  const clamped: string[] = []
  for (const key of ruleKeys()) {
    if (!Object.hasOwn(r, key)) continue
    const v = r[key]
    if (key === 'gravity') {
      if (!Array.isArray(v) || v.length !== 3) {
        clamped.push('gravity')
        continue
      }
      for (let i = 0; i < 3; i++) {
        const x = v[i]
        if (typeof x !== 'number' || !Number.isFinite(x)) clamped.push(`gravity[${i}]`)
        else {
          next.gravity[i] = clampTo(FIELDS.gravity, x)
          if (next.gravity[i] !== x) clamped.push(`gravity[${i}]`)
        }
      }
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      clamped.push(key)
      continue
    }
    next[key] = clampTo(FIELDS[key], v)
    if (next[key] !== v) clamped.push(key)
  }
  return { rules: next, clamped }
}
