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

/** The voice key for a villager named by name ("Dumpling", "Dumpling, the cook"), entry or person id; null if unknown. */
export function voiceKey(villager: string): string | null {
  const word = villager.toLowerCase().replace(/^villager-/, '').split(/[,\s]/)[0]
  if (word in VOICES) return word
  return OWNERS[word] ?? null
}
