// Text to babble notes (#42): pure and deterministic, no Web Audio here.
// A word becomes a few syllables (vowel groups with their consonant onsets);
// punctuation and capitals shape the pitch and loudness. Every random choice is
// drawn from a seed of the word's letters, so a word always sounds the same in
// the same voice and the same place in a sentence.
import type { VoiceProfile } from './profiles'

/** talk.ts reveals 58 letters a second, a whole word at a time; the babble keeps the same clock. */
export const TYPE_RATE = 58

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u'
export type Mark = 'question' | 'exclaim' | 'trail' | 'stop' | 'pause' | null

/** A consonant's noise: a band-passed burst before the vowel. */
export interface Onset { freq: number; q: number; dur: number; gain: number }

export interface Note {
  /** Seconds from the word's start. */
  at: number
  /** Blip length in seconds. */
  dur: number
  /** Fundamental in Hz across the blip, evenly spaced. */
  pitch: Float32Array
  vowel: Vowel
  onset: Onset | null
  /** Linear loudness, 1 is normal speech. */
  gain: number
  /** Where in the shared noise buffer this blip's noise starts, 0 to 1. */
  noise: number
}

export interface WordPlan {
  notes: Note[]
  /** Seconds the word occupies, including the pause its punctuation asks for. */
  length: number
  mark: Mark
}

/** FNV-1a, then mulberry32: a small seeded random that is identical in every browser. */
export function seeded(text: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function markOf(word: string): Mark {
  const tail = word.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? ''
  if (tail.includes('?')) return 'question'
  if (tail.includes('!')) return 'exclaim'
  if (tail.includes('…') || tail.includes('..')) return 'trail'
  if (tail.includes('.')) return 'stop'
  if (/[,;:—–-]/.test(tail)) return 'pause'
  return null
}

/** A word in capitals, like "NOW" (two letters or more, so "I" and "A" are not shouting). */
export function shouted(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '')
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

interface Syllable { onset: string; vowel: Vowel }

const DIGRAPH: Record<string, Vowel> = { ee: 'i', ea: 'i', ie: 'i', ey: 'i', oo: 'u', ou: 'u', ew: 'u', ai: 'e', ay: 'e', ei: 'e', au: 'o', aw: 'o', oa: 'o', oi: 'o' }

function vowelOf(group: string): Vowel {
  const two = DIGRAPH[group.slice(0, 2)]
  if (two) return two
  const c = group[0]
  return c === 'y' ? 'i' : (c as Vowel)
}

/** Vowel groups with the consonants before each. "Hello" is h-e, ll-o; "rhythm" falls back to one. */
export function syllables(word: string): Syllable[] {
  const core = word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  if (!core) return []
  if (/^[0-9]+$/.test(core)) {
    const vowels: Vowel[] = ['a', 'e', 'i', 'o', 'u']
    return [...core.slice(0, 3)].map((d) => ({ onset: 'n', vowel: vowels[Number(d) % 5] }))
  }
  const out: Syllable[] = []
  // A leading y is a consonant ("yes"); elsewhere y is a vowel ("happy").
  const re = /((?:^y)?[^aeiouy]*)([aeiouy]+)/g
  for (const m of core.matchAll(re)) {
    if (!m[2]) continue
    out.push({ onset: m[1], vowel: vowelOf(m[2]) })
  }
  if (!out.length) out.push({ onset: core[0], vowel: core.includes('m') || core.includes('h') ? 'u' : 'a' })
  // Silent final e ("make", "home") after another syllable.
  if (out.length > 1 && /[^aeiouy]e$/.test(core) && out[out.length - 1].vowel === 'e' && out[out.length - 1].onset.length > 0) out.pop()
  return out
}

/** The consonant noise for an onset cluster, from its first letter. */
export function onsetOf(cluster: string, formant: number): Onset | null {
  if (!cluster) return null
  const c = cluster[0]
  const two = cluster.slice(0, 2)
  if (two === 'sh' || two === 'ch') return { freq: 3200 * formant, q: 2, dur: 0.035, gain: 0.5 }
  if (two === 'th') return { freq: 5200 * formant, q: 1.2, dur: 0.025, gain: 0.25 }
  if ('szcxj'.includes(c)) return { freq: 6200 * formant, q: 2.5, dur: 0.035, gain: 0.45 }
  if ('fv'.includes(c)) return { freq: 4200 * formant, q: 1, dur: 0.025, gain: 0.25 }
  if (c === 'h') return { freq: 1600 * formant, q: 0.8, dur: 0.02, gain: 0.3 }
  if ('pb'.includes(c)) return { freq: 900 * formant, q: 1.5, dur: 0.012, gain: 0.5 }
  if ('td'.includes(c)) return { freq: 3800 * formant, q: 1.5, dur: 0.012, gain: 0.45 }
  if ('kgq'.includes(c)) return { freq: 2000 * formant, q: 1.8, dur: 0.015, gain: 0.45 }
  return null
}

const PAUSE: Record<Exclude<Mark, null>, number> = { pause: 0.13, stop: 0.2, trail: 0.3, question: 0.2, exclaim: 0.2 }
const POINTS = 24

/**
 * The notes for one word. `position` is the word's place in its sentence (0 for
 * the first): a gentle declination lowers later words. `slot` is the time the
 * text gives the word; a voice with a lower rate fits fewer, longer syllables in it.
 */
export function planWord(word: string, voice: VoiceProfile, position: number, slot = (word.length + 1) / TYPE_RATE): WordPlan {
  const mark = markOf(word)
  const all = syllables(word)
  if (!all.length) return { notes: [], length: mark ? PAUSE[mark] : 0, mark }
  const rand = seeded(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  const fit = Math.max(1, Math.round(slot * voice.rate))
  const kept = all.length <= fit ? all : [...all.slice(0, fit - 1), all[all.length - 1]]
  const loud = shouted(word)
  const step = 1 / voice.rate
  const wordShift = (rand() * 2 - 1) * (voice.range / 2) - 0.35 * Math.min(position, 8)
  const notes: Note[] = []
  let at = 0
  kept.forEach((s, j) => {
    const final = j === kept.length - 1
    let dur = step * (0.85 + rand() * 0.3)
    let from = wordShift + (rand() * 2 - 1) * (voice.range / 4)
    let to = from - 0.6
    let gain = 0.85 + rand() * 0.15
    if (loud) {
      gain *= 1.6
      from += 1.5
      to += 1.5
    }
    if (mark === 'exclaim') {
      gain *= 1.45
      from += 3
      to = from + (final ? 2 : 0.5)
    } else if (mark === 'question') {
      // The whole last word lifts, and its last syllable glides up.
      from += 2 + j * 1.5
      to = final ? from + 6 : from + 1
      if (final) dur *= 1.35
    } else if (mark === 'stop' && final) {
      to = from - 4
      dur *= 1.25
    } else if (mark === 'trail') {
      const k = (j + 1) / kept.length
      gain *= 1 - 0.55 * k
      from -= 1.5 * k
      to = from - 2
      dur *= 1.5
    }
    const pitch = new Float32Array(POINTS)
    for (let i = 0; i < POINTS; i++) {
      const u = i / (POINTS - 1)
      const t = at + u * dur
      const semis = from + (to - from) * u + voice.wobble * Math.sin(2 * Math.PI * voice.wobbleRate * t)
      pitch[i] = voice.pitch * 2 ** (semis / 12)
    }
    notes.push({ at, dur, pitch, vowel: s.vowel, onset: onsetOf(s.onset, voice.formant), gain, noise: rand() })
    at += dur
  })
  return { notes, length: at + (mark ? PAUSE[mark] : 0), mark }
}
