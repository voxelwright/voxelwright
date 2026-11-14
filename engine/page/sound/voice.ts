// What a person of the world sounds like when they speak (#264, #247): a direction being tried, two ways side by
// side, neither chosen. Words reach a page as text (what was said, by whom, where); this gives them a sound.
//
//   babble   made in the synthesiser like everything else: a syllable for each syllable of the words, at a pitch
//            that is the speaker's own, falling through a sentence, rising at a question, each vowel with its own
//            colour (a whisper through the vowel's formants under a tone). It is placed in the world: nearer is
//            louder, it comes from where they stand. It says no words: it is the sound of someone speaking.
//   speech   the browser's own speech (SpeechSynthesis): real words in a real voice, a pitch and pace of the
//            speaker's own, louder when near. It is not placed: it comes from the middle of the head whichever
//            side they stand, and it does not go through the synthesiser, so nothing here bounds or measures it.
//
// What is said is text someone or someone's model wrote: it is turned into sound, never anything else.
import type { Patch } from './patch.ts'
import type { Sound } from './sound.ts'

/** A syllable to sound: when (s from the start), how long, at what pitch, how hard, and which vowel it is. */
export interface Syllable { at: number; dur: number; hz: number; force: number; vowel: string }

/** The first three formants of the five vowels, Hz (Peterson and Barney's averages, rounded: the old home's table). */
const FORMANTS: Record<string, [number, number, number]> = { a: [800, 1250, 2700], e: [560, 1900, 2600], i: [320, 2300, 3000], o: [540, 920, 2500], u: [360, 900, 2300] }
/** How strong each formant is: a front vowel (i, e) has its weight in the second, a back one (o, u) in the first. */
const WEIGHT: Record<string, [number, number, number]> = { a: [1, 0.8, 0.3], e: [0.7, 1, 0.5], i: [0.45, 1, 0.7], o: [1, 0.55, 0.12], u: [1, 0.3, 0.08] }
/** A vowel as a whisper: noise through its three formants. */
export const WHISPER: Record<string, Patch> = Object.fromEntries(Object.entries(FORMANTS).map(([v, [f1, f2, f3]]) => [v, { how: 'rubbed', hard: 0.4, rough: 0.6, modes: [[1, WEIGHT[v][0]], [f2 / f1, WEIGHT[v][1]], [f3 / f1, WEIGHT[v][2]]], pitch: f1, ring: 0.035, damp: 0, gain: 0.6 } satisfies Patch]))
/** And the tone under it: darker for o and u, brighter for e and i. */
export const TONE: Record<string, Patch> = Object.fromEntries(Object.entries({ a: 0.5, e: 0.3, i: 0.2, o: 0.75, u: 0.85 }).map(([v, damp]) => [v, { how: 'blown', hard: 0.75, rough: 0.04, shape: 'tube', pitch: 140, ring: 0.06, damp, waver: 0.15, gain: 0.35 } satisfies Patch]))

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }
/** The pitch a speaker speaks at, Hz, by their name: from a low voice to a high one. */
export const pitchOf = (name: string) => 95 * 2 ** (hash(name) * 1.25)

/** The syllables of what was said, as a speaker of that name would sound them. At most sixty: the rest is left unsaid. */
export function babble(text: string, name: string): Syllable[] {
  const base = pitchOf(name), pace = 0.13 + 0.05 * hash(`${name}/pace`), out: Syllable[] = []
  // Sentences, for how the pitch runs: down through a statement, up at the end of a question, higher and harder when shouted.
  const sentences = String(text).toLowerCase().slice(0, 400).match(/[^.!?]+[.!?]*/g) ?? []
  let at = 0
  for (const sentence of sentences) {
    const asks = sentence.includes('?'), shouts = sentence.includes('!')
    const words = sentence.split(/[\s,;:]+/).filter((w) => /[a-z0-9]/.test(w))
    const groups: { vowel: string; pause: number }[] = []
    for (const word of words) {
      // A syllable for each run of vowels; a word with none (a number, "hm") is one.
      const runs = word.match(/[aeiouy]+/g) ?? ['a']
      runs.forEach((run, i) => groups.push({ vowel: 'aeiou'.includes(run[run.length - 1]) ? run[run.length - 1] : 'i', pause: i === runs.length - 1 ? 0.05 : 0 }))
    }
    groups.forEach((g, i) => {
      if (out.length >= 60) return
      const through = groups.length > 1 ? i / (groups.length - 1) : 1
      // Down three semitones through a statement; a question turns up five over its last third; every syllable a little off its line.
      const line = asks ? (through < 0.66 ? -1.5 * through : -1 + 18 * (through - 0.66)) : -3 * through
      const wobble = (hash(`${name}/${i}/${g.vowel}`) - 0.5) * 1.6
      out.push({ at, dur: pace * (0.85 + 0.3 * hash(`${i}${g.vowel}`)), hz: base * 2 ** ((line + wobble + (shouts ? 3 : 0)) / 12), force: shouts ? 0.9 : 0.55 + 0.2 * hash(`f${i}`), vowel: g.vowel })
      at += out[out.length - 1].dur + 0.02 + g.pause
    })
    at += 0.28
  }
  return out
}

export type Way = 'babble' | 'speech'
/** Sounds what someone said, one way or the other. `at` is where they stand, in cells. Returns how many syllables or words it began. */
export function speak(voice: Sound, way: Way, said: { name: string; text: string; at?: readonly [number, number, number] }): number {
  if (way === 'babble') {
    const all = babble(said.text, said.name)
    for (const s of all) {
      voice.play(TONE[s.vowel], { at: said.at, pitch: s.hz, dur: s.dur, after: s.at, force: s.force, reach: 5, travels: false })
      voice.play(WHISPER[s.vowel], { at: said.at, dur: s.dur, after: s.at, force: s.force * 0.8, reach: 5, travels: false })
    }
    return all.length
  }
  const synth = globalThis.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return 0
  // No more than three waiting: someone who walks into a crowd is not read to for a minute.
  if (synth.pending && synth.speaking) synth.cancel()
  const u = new SpeechSynthesisUtterance(String(said.text).slice(0, 300)), mine = synth.getVoices().filter((v) => v.lang.slice(0, 2) === (navigator.language || 'en').slice(0, 2))
  if (mine.length) u.voice = mine[Math.floor(hash(`${said.name}/voice`) * mine.length)]
  u.pitch = 0.6 + 0.9 * hash(said.name)
  u.rate = 0.9 + 0.3 * hash(`${said.name}/pace`)
  u.volume = said.at ? Math.min(1, voice.hear(said.at, 5).gain * 1.6) : 1
  if (u.volume < 0.03) return 0
  synth.speak(u)
  return u.text.split(/\s+/).length
}
