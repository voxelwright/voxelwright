// World rules (#74): one object that says how the whole world behaves, tuned live from the
// panel, by presets (one per game mode) or by talking. FIELDS is the one owner of each
// rule's range: the checker clamps to it, the panel draws its sliders from it, and the host
// quotes this file to the model. A change is checked whole and applied all at once
// (world.ts setRules), never half-applied; tuning is kept for the visit and survives a reset.

export interface Rules {
  /** m/s², world space; [0, -9.81, 0] is the Earth. */
  gravity: [number, number, number]
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
}

interface Field { min: number; max: number; step: number; about: string }

export const FIELDS: Record<Exclude<keyof Rules, 'gravity'>, Field> & { gravity: Field } = {
  gravity: { min: -30, max: 30, step: 0.01, about: 'gravity per axis, m/s²' },
  timeScale: { min: 0.1, max: 2, step: 0.01, about: 'simulated seconds per real second' },
  bounce: { min: 0, max: 1.6, step: 0.01, about: 'multiplies bounciness' },
  friction: { min: 0, max: 3, step: 0.01, about: 'multiplies friction' },
  drag: { min: 0, max: 3, step: 0.01, about: 'air drag per second' },
  kick: { min: 0, max: 4, step: 0.01, about: 'multiplies kicks, plungers and flippers' },
  impact: { min: 0, max: 3, step: 0.01, about: 'multiplies impact sound and dust' },
  maxSpeed: { min: 1, max: 40, step: 0.1, about: 'speed limit, m/s' },
  substeps: { min: 1, max: 4, step: 1, about: 'collision steps per frame' },
}

export const NORMAL: Rules = { gravity: [0, -9.81, 0], timeScale: 1, bounce: 1, friction: 1, drag: 0.05, kick: 1, impact: 1, maxSpeed: 12, substeps: 1 }

export const PRESETS: Record<string, { label: string; rules: Rules }> = {
  normal: { label: 'Normal', rules: NORMAL },
  moon: { label: 'Moon', rules: { ...NORMAL, gravity: [0, -1.62, 0], drag: 0 } },
  super: { label: 'Super powers', rules: { ...NORMAL, kick: 3, bounce: 1.25, impact: 2, maxSpeed: 25 } },
  slow: { label: 'Slow motion', rules: { ...NORMAL, timeScale: 0.3 } },
}

export const RULE_KEYS = Object.keys(FIELDS) as (keyof Rules)[]

const clampTo = (f: Field, v: number) => {
  const c = Math.min(f.max, Math.max(f.min, v))
  return f.step === 1 ? Math.round(c) : c
}

/**
 * Rules from untrusted data (a model's answer, a stored tuning), field by field over
 * `current`: own keys only, a missing field keeps its current value, a non-number or
 * non-finite one keeps it too and is listed, an out-of-range one is clamped and listed.
 * Anything that is not a plain object is refused.
 */
export function checkRules(raw: unknown, current: Rules): { rules: Rules; clamped: string[] } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'rules are not an object' }
  const r = raw as Record<string, unknown>
  const next: Rules = { ...current, gravity: [...current.gravity] }
  const clamped: string[] = []
  for (const key of RULE_KEYS) {
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

export const sameRules = (a: Rules, b: Rules) => RULE_KEYS.every((k) => (k === 'gravity' ? a.gravity.every((x, i) => x === b.gravity[i]) : a[k] === b[k]))
