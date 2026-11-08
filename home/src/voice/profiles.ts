// Each felt villager's babble voice (#42). Pure data: the engine in ./engine.ts reads it.
// Tuned by measurement in scripts/check-babble.mjs, which asserts the three stay apart.

export interface VoiceProfile {
  /** Base fundamental in Hz. */
  pitch: number
  /** Per-word pitch spread in semitones, drawn from a seed of the word. */
  range: number
  /** Formant scale: 1 is an adult vowel, above 1 is a smaller, brighter throat. */
  formant: number
  /** Syllables a second this voice aims for; fewer means slower, longer blips. */
  rate: number
  /** Breath noise mixed into the vowel, 0 to 1. */
  breath: number
  /** Vibrato depth in semitones and its rate in Hz. */
  wobble: number
  wobbleRate: number
  /** Harmonic roll-off of the glottal source: higher is rounder and darker. */
  tilt: number
  /** Output level of this voice before the master. */
  gain: number
}

export const VOICES: Record<string, VoiceProfile> = {
  /** Round and warm, mid-low: a dark source, low formants, unhurried. */
  dumpling: { pitch: 180, range: 3, formant: 0.92, rate: 10, breath: 0.05, wobble: 0.2, wobbleRate: 5.5, tilt: 2.1, gain: 1 },
  /** Gentle and breathy, slower, a little higher than Dumpling. */
  moss: { pitch: 245, range: 2, formant: 1.0, rate: 7, breath: 0.32, wobble: 0.45, wobbleRate: 4.5, tilt: 2.2, gain: 1.05 },
  /** Quick and bright, higher: a buzzy source, small formants, wide pitch swings. */
  tuft: { pitch: 360, range: 5, formant: 1.4, rate: 14, breath: 0.03, wobble: 0.15, wobbleRate: 7, tilt: 1.0, gain: 0.8 },
}

/** Anyone not listed: a middle voice, so an unknown speaker still sounds like someone. */
export const NEUTRAL: VoiceProfile = { pitch: 240, range: 3, formant: 1.1, rate: 10, breath: 0.1, wobble: 0.25, wobbleRate: 5, tilt: 1.6, gain: 0.9 }

/** talk.ts's synthetic people, each with their own villager. */
const OWNERS: Record<string, string> = { alex: 'dumpling', sam: 'tuft', mia: 'moss' }

const BUILT_IN = new Set(Object.keys(VOICES))

/** A villager's name or id, trimmed, lowercased and without "villager-". */
const normal = (villager: string) => villager.trim().toLowerCase().replace(/^villager-/, '')

/** The first word of a villager's name or id, lowercased and without "villager-": how a built-in villager is found by name. */
export function keyWord(villager: string): string {
  return normal(villager).split(/[,\s]/)[0]
}

/**
 * The voice key for a villager: a registered id, whole ("setup-1", "gen:code-1"), else a built-in villager by the
 * first word of its name ("Dumpling", "Dumpling, the cook") or its person's id; null if unknown. Own keys only, so
 * "Constructor, the maker" is no one's.
 */
export function voiceKey(villager: string): string | null {
  const id = normal(villager)
  if (Object.hasOwn(VOICES, id)) return id
  const word = keyWord(villager)
  if (BUILT_IN.has(word)) return word
  return Object.hasOwn(OWNERS, word) ? OWNERS[word] : null
}

/**
 * Gives a generated villager a voice under its unique id, whole ("villager-gen-3", "setup-1"), so two villagers whose
 * names share a first word ("Old Tom", "Old Bess") never share a voice; voiceKey() finds it by the same id. Returns
 * the key it registered. The built-in voices and their people's ids cannot be replaced.
 */
export function registerVoice(villager: string, profile: VoiceProfile): string {
  const key = normal(villager)
  if (!key || key === '__proto__') throw new Error(`"${key}" is not a voice id`)
  if (BUILT_IN.has(key) || Object.hasOwn(OWNERS, key)) throw new Error(`"${key}" is a built-in voice`)
  VOICES[key] = profile
  return key
}

export function unregisterVoice(villager: string): void {
  const key = normal(villager)
  if (!BUILT_IN.has(key)) delete VOICES[key]
}
