// A handmade, deterministic voice for a generated villager (#47): words in the description
// move the nine VoiceProfile fields, then everything is clamped to RANGES.voice. No model.
import { RANGES } from '../villagers/gen/spec'
import { NEUTRAL, type VoiceProfile } from './profiles'

type Nudge = Partial<Record<keyof VoiceProfile, number>>

/** Semitones for pitch; multipliers for formant, rate and gain; additions for the rest. */
const TRAITS: Array<[RegExp, { st?: number } & Nudge]> = [
  // size
  [/\b(tiny|little|small|wee|baby)\b/, { st: 5, formant: 1.2, rate: 1.15 }],
  [/\b(big|huge|large|giant|burly)\b/, { st: -6, formant: 0.82, tilt: 0.3 }],
  [/\b(tall|long)\b/, { st: -2, formant: 0.92 }],
  [/\b(round|plump|chubby)\b/, { st: -1, formant: 0.95, tilt: 0.2 }],
  // age
  [/\b(old|elderly|ancient|wise)\b/, { st: -2, rate: 0.85, wobble: 0.3, breath: 0.1 }],
  [/\b(young|child|kid)\b/, { st: 3, formant: 1.1, rate: 1.1 }],
  // energy and manner
  [/\b(jittery|nervous|chattering|chatty|restless|fizzy)\b/, { rate: 1.3, range: 2, wobble: 0.3, wobbleRate: 2 }],
  [/\b(quick|fast|brisk|busy)\b/, { rate: 1.2 }],
  [/\b(calm|patient|slow|steady|unhurried)\b/, { rate: 0.75, range: -1, wobble: -0.1 }],
  [/\b(sleepy|drowsy|dozy)\b/, { rate: 0.7, breath: 0.15, st: -1, gain: 0.9 }],
  [/\b(gentle|soft|kind|warm)\b/, { breath: 0.15, tilt: 0.3, rate: 0.92, gain: 0.95 }],
  [/\b(cheerful|happy|bubbly|bright)\b/, { st: 2, range: 1.5, rate: 1.1, tilt: -0.2 }],
  [/\b(strict|stern|severe|precise|crisp)\b/, { range: -1.5, tilt: -0.3, wobble: -0.1, breath: -0.03 }],
  [/\b(hums?|singing|sings|musical|jazz)\b/, { wobble: 0.2, range: 0.5 }],
  // species
  [/\b(mouse|mice|sparrow|wren|chick|hamster)\b/, { st: 6, formant: 1.2, rate: 1.1 }],
  [/\b(bird|robin|finch|jay)\b/, { st: 4, formant: 1.1, range: 1.5, rate: 1.1, tilt: -0.2 }],
  [/\b(heron|crane|stork)\b/, { st: -2, formant: 0.95, tilt: -0.2 }],
  [/\b(bear|ox|bull|boar|badger|hippo)\b/, { st: -4, formant: 0.88, tilt: 0.3 }],
  [/\b(tortoise|turtle|snail|sloth)\b/, { st: -3, rate: 0.72, breath: 0.05 }],
  [/\b(frog|toad)\b/, { st: -1, formant: 0.95, wobble: 0.2, tilt: 0.2 }],
]

const FACTOR = new Set<keyof VoiceProfile>(['formant', 'rate', 'gain'])

/** Pulls a model-chosen or mapped voice into the hard ranges; a missing or non-numeric field takes the neutral value. */
export function clampVoice(raw: Partial<VoiceProfile>): VoiceProfile {
  const out = { ...NEUTRAL }
  for (const k of Object.keys(RANGES.voice) as Array<keyof VoiceProfile>) {
    const [lo, hi] = RANGES.voice[k]
    const v = Number(raw[k])
    out[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : NEUTRAL[k]
  }
  return out
}

export function voiceFromDescription(text: string): VoiceProfile {
  const words = text.toLowerCase()
  const v: VoiceProfile = { ...NEUTRAL }
  for (const [pattern, { st = 0, ...nudge }] of TRAITS) {
    if (!pattern.test(words)) continue
    v.pitch *= 2 ** (st / 12)
    for (const [k, n] of Object.entries(nudge) as Array<[keyof VoiceProfile, number]>) {
      if (FACTOR.has(k)) v[k] *= n
      else v[k] += n
    }
  }
  return clampVoice(v)
}
