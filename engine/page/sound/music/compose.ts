// Music made by rule and search (#247): for each voice of a place's music, thousands of patterns are made at
// random, each is scored against that voice's named rules (rules.ts), and the best is kept, with what each rule gave
// it. The harmony is found the same way first, so the voices have something to agree with. Nothing is looped from a
// file: a section is composed from a number, and another number gives another section.
//
// The place chooses the idiom: a town has a house groove, the coast lilts in six, under the sea there is no pulse
// at all. All of them share one tonic (D), so going from one to another is a change of mode and never of key.
import type { Patch } from '../patch.ts'
import * as R from './rules.ts'
import type { Around, Beat, Chords, Line, Rule } from './rules.ts'

export interface Voice {
  name: string
  /** beat: struck where the pattern says. line: a melody. bass: a line under the chords. pad: the bar's chord held. stab: the chord, struck in a rhythm. */
  kind: 'beat' | 'line' | 'bass' | 'pad' | 'stab'
  patch: Patch
  /** When it comes in as a piece builds: 1 first. */
  layer: number
  gain: number
  pan?: number
  /** Semitones from the mood's tonic to this voice's lowest note. */
  low: number
  /** Onsets a bar (a beat, a stab) or the share of steps that sound (a line). */
  want: number
  rules: Rule<never>[]
  /** How many bars its pattern is, if not the section's: voices of unlike lengths drift against each other and do not line up again for a long time. */
  bars?: number
  /** How many scale steps a line may range over. */
  span?: number
}
export interface Mood {
  name: string
  /** What kind of music, in a few words. */
  idiom: string
  bpm: number
  /** Steps in a bar and in a beat. */
  steps: number; beat: number
  /** Bars in a section. */
  bars: number
  /** MIDI note of the tonic the voices count from. */
  tonic: number
  scale: number[]
  minor: boolean
  /** The degree that makes the mode itself. */
  colour: number
  voices: Voice[]
  /** How many sections a piece is, and the seconds of quiet between two pieces. */
  sections: number; gap: [number, number]
  /** How far the off steps are late (0 none, 0.1 a light swing). */
  swing: number
  /** How much of it goes to the room. */
  room: number
}
export interface Note { at: number; len: number; midi: number; vel: number }
export interface Part {
  voice: string; kind: Voice['kind']; layer: number; patch: Patch; gain: number; pan: number
  /** Steps after which its notes come round again. */
  period: number
  notes: Note[]
  /** The best candidate's score, how many were tried, and what a candidate scored on average. */
  total: number; tried: number; mean: number
  rules: { name: string; why: string; source: string; read: string; weight: number; score: number }[]
  /** A melody as it was found, for the sections after it to come back to. */
  line?: Line
}
export interface Section { mood: string; idiom: string; seed: number; bpm: number; steps: number; beat: number; bars: number; swing: number; room: number; chords: Chords; parts: Part[]; ms: number }

/** How many candidates each voice is given. */
export const TRIES = 3000

// ── The instruments: patches like any other (patch.ts) ────────────────────
const kick: Patch = { how: 'struck', hard: 0.35, rough: 0.15, shape: 'skin', pitch: 50, ring: 0.3, damp: 0.85, bend: 1.5, gain: 0.95 }
const hat: Patch = { how: 'struck', hard: 1, rough: 1, modes: [[1, 0.2]], pitch: 6500, ring: 0.02, damp: 1, air: { from: 9500, to: 7500, for: 0.045, gain: 0.7, q: 1.2 }, gain: 0.3 }
const clap: Patch = { how: 'struck', hard: 0.9, rough: 1, modes: [[1, 0.3]], pitch: 1100, ring: 0.03, damp: 1, air: { from: 2300, to: 1300, for: 0.13, gain: 0.9, q: 1.5 }, gain: 0.35 }
const shaker: Patch = { how: 'struck', hard: 0.6, rough: 1, modes: [[1, 0.1]], pitch: 5000, ring: 0.01, damp: 1, air: { from: 6000, to: 8500, for: 0.07, gain: 0.7, q: 1 }, gain: 0.22 }
const drum: Patch = { how: 'struck', hard: 0.4, rough: 0.3, shape: 'skin', pitch: 74, ring: 0.5, damp: 0.7, bend: 0.5, gain: 0.8 }
const bass: Patch = { how: 'plucked', hard: 0.3, rough: 0, shape: 'string', pitch: 55, ring: 1.1, damp: 0.75, gain: 0.85 }
const keys: Patch = { how: 'struck', hard: 0.42, rough: 0.04, modes: [[1, 1], [2, 0.35], [3, 0.12], [4.2, 0.06], [14.2, 0.03]], pitch: 220, ring: 1.5, damp: 0.45, gain: 0.5 }
const pad: Patch = { how: 'blown', hard: 0.04, rough: 0.05, shape: 'tube', pitch: 220, ring: 1.6, damp: 0.78, waver: 0.3, gain: 0.26 }
const strum: Patch = { how: 'plucked', hard: 0.6, rough: 0.1, shape: 'string', pitch: 196, ring: 2.6, damp: 0.45, where: 0.2, gain: 0.55 }
const bell: Patch = { how: 'struck', hard: 0.85, rough: 0, shape: 'bell', pitch: 880, ring: 4.5, damp: 0.2, gain: 0.3 }
const celesta: Patch = { how: 'struck', hard: 0.8, rough: 0, modes: [[1, 1], [4, 0.22], [10, 0.05]], pitch: 880, ring: 1.9, damp: 0.3, gain: 0.36 }
const marimba: Patch = { how: 'struck', hard: 0.5, rough: 0.08, modes: [[1, 1], [4, 0.3], [9.2, 0.08]], pitch: 262, ring: 0.5, damp: 0.5, gain: 0.55 }
const piano: Patch = { how: 'struck', hard: 0.5, rough: 0.03, shape: 'string', pitch: 262, ring: 3.6, damp: 0.5, where: 0.12, gain: 0.5 }
const flute: Patch = { how: 'blown', hard: 0.45, rough: 0.2, shape: 'hollow', pitch: 587, ring: 0.25, damp: 0.6, waver: 0.5, gain: 0.3 }
const low: Patch = { how: 'rubbed', hard: 0.2, rough: 0.1, shape: 'string', pitch: 73, ring: 0.6, damp: 0.6, waver: 0.2, gain: 0.3 }

const rules = (...list: Rule<never>[]) => list
const as = <T>(r: Rule<T>, weight = r.weight) => ({ ...r, weight }) as unknown as Rule<never>
const L = R.lineRhythm
const melody = (rest: number) => rules(as(R.inKey), as(R.bySteps), as(R.leapsTurnBack), as(R.oneSummit), as(R.keepsItsRange), as(R.onTheChord), as(R.comesHome), as(R.leavesRoom, rest), as(R.returnsToItsFigure), as(R.doesNotStammer))
const under = rules(as(R.rootsDown), as(R.onTheChord), as(R.fewNotes), as(R.leavesRoom, 1.5), as(L(R.pushes), 1), as(R.bySteps, 0.5))

const DORIAN = [0, 2, 3, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11], AEOLIAN = [0, 2, 3, 5, 7, 8, 10], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], PENTA = [0, 2, 4, 7, 9]

/** The music of each place. The tonic is D for all of them. */
export const MOODS: Record<string, Mood> = {
  town: { name: 'town', idiom: 'a deep house groove', bpm: 116, steps: 16, beat: 4, bars: 4, tonic: 50, scale: DORIAN, minor: true, colour: 5, sections: 12, gap: [45, 100], swing: 0.06, room: 0.18, voices: [
    { name: 'pad', kind: 'pad', patch: pad, layer: 1, gain: 0.8, low: 12, want: 1, rules: [] },
    { name: 'keys', kind: 'stab', patch: keys, layer: 2, gain: 0.7, pan: -0.25, low: 12, want: 3, rules: rules(as(R.amount), as(R.pushes, 3), as(R.fillsGaps, 1), as(R.likeATradition), as(R.loudAndSoft, 0.5)) },
    { name: 'bass', kind: 'bass', patch: bass, layer: 2, gain: 0.9, low: -12, want: 0.3, rules: under },
    { name: 'kick', kind: 'beat', patch: kick, layer: 3, gain: 0.9, low: 0, want: 4, rules: rules(as(R.onTheFloor), as(R.amount)) },
    { name: 'hat', kind: 'beat', patch: hat, layer: 3, gain: 0.8, pan: 0.2, low: 0, want: 6, rules: rules(as(R.fillsGaps), as(R.amount), as(R.even), as(R.repeats), as(R.loudAndSoft)) },
    { name: 'clap', kind: 'beat', patch: clap, layer: 4, gain: 0.7, pan: -0.1, low: 0, want: 2, rules: rules(as(R.backbeat), as(R.amount)) },
    { name: 'lead', kind: 'line', patch: strum, layer: 4, gain: 0.7, pan: 0.25, low: 12, want: 0.34, span: 9, bars: 2, rules: melody(2) },
  ] },
  coast: { name: 'coast', idiom: 'a lilt in six, guitar and flute', bpm: 84, steps: 12, beat: 3, bars: 4, tonic: 50, scale: LYDIAN, minor: false, colour: 3, sections: 8, gap: [50, 110], swing: 0, room: 0.3, voices: [
    { name: 'guitar', kind: 'line', patch: strum, layer: 1, gain: 0.75, pan: -0.2, low: 0, want: 0.5, span: 10, bars: 2, rules: rules(as(R.inKey), as(R.onTheChord, 3), as(R.leavesRoom), as(R.keepsItsRange), as(R.doesNotStammer), as(L(R.likeATradition))) },
    { name: 'pad', kind: 'pad', patch: pad, layer: 2, gain: 0.7, low: 12, want: 1, rules: [] },
    { name: 'bass', kind: 'bass', patch: bass, layer: 2, gain: 0.7, low: -12, want: 0.18, rules: under },
    { name: 'shaker', kind: 'beat', patch: shaker, layer: 3, gain: 0.6, pan: 0.3, low: 0, want: 5, rules: rules(as(R.likeATradition, 3), as(R.amount), as(R.loudAndSoft)) },
    { name: 'flute', kind: 'line', patch: flute, layer: 3, gain: 0.7, pan: 0.15, low: 12, want: 0.3, span: 8, bars: 4, rules: melody(2.5) },
  ] },
  sea: { name: 'sea', idiom: 'no pulse: long tones and far bells', bpm: 48, steps: 8, beat: 2, bars: 4, tonic: 50, scale: PENTA, minor: false, colour: 2, sections: 6, gap: [25, 60], swing: 0, room: 0.6, voices: [
    { name: 'deep', kind: 'pad', patch: low, layer: 1, gain: 0.9, low: 0, want: 1, rules: [] },
    { name: 'pad', kind: 'pad', patch: pad, layer: 1, gain: 0.8, low: 12, want: 1, rules: [] },
    // Three lines of three lengths: together they come round only every 105 bars.
    { name: 'bell', kind: 'line', patch: bell, layer: 2, gain: 0.6, pan: -0.4, low: 24, want: 0.1, span: 7, bars: 3, rules: rules(as(R.inKey), as(R.leavesRoom, 4), as(R.bySteps, 1), as(R.doesNotStammer)) },
    { name: 'glass', kind: 'line', patch: celesta, layer: 2, gain: 0.5, pan: 0.4, low: 24, want: 0.08, span: 7, bars: 5, rules: rules(as(R.inKey), as(R.leavesRoom, 4), as(R.leapsTurnBack), as(R.doesNotStammer)) },
    { name: 'far', kind: 'line', patch: flute, layer: 3, gain: 0.45, pan: 0.1, low: 12, want: 0.12, span: 5, bars: 7, rules: rules(as(R.inKey), as(R.leavesRoom, 4), as(R.bySteps), as(R.comesHome)) },
  ] },
  snow: { name: 'snow', idiom: 'bells, and space between them', bpm: 60, steps: 8, beat: 2, bars: 4, tonic: 50, scale: PENTA, minor: false, colour: 2, sections: 5, gap: [60, 140], swing: 0, room: 0.5, voices: [
    { name: 'celesta', kind: 'line', patch: celesta, layer: 1, gain: 0.8, pan: -0.2, low: 24, want: 0.16, span: 8, bars: 4, rules: melody(4) },
    { name: 'pad', kind: 'pad', patch: pad, layer: 2, gain: 0.55, low: 12, want: 1, rules: [] },
    { name: 'bell', kind: 'line', patch: bell, layer: 3, gain: 0.5, pan: 0.3, low: 24, want: 0.06, span: 6, bars: 5, rules: rules(as(R.inKey), as(R.leavesRoom, 4), as(R.onTheChord), as(R.doesNotStammer)) },
  ] },
  night: { name: 'night', idiom: 'slow, a few notes on a piano', bpm: 66, steps: 16, beat: 4, bars: 4, tonic: 50, scale: AEOLIAN, minor: true, colour: 5, sections: 5, gap: [60, 130], swing: 0, room: 0.4, voices: [
    { name: 'piano', kind: 'line', patch: piano, layer: 1, gain: 0.8, pan: -0.1, low: 12, want: 0.14, span: 9, bars: 4, rules: melody(4) },
    { name: 'pad', kind: 'pad', patch: pad, layer: 2, gain: 0.6, low: 12, want: 1, rules: [] },
    { name: 'bass', kind: 'bass', patch: bass, layer: 3, gain: 0.6, low: -12, want: 0.08, rules: under },
  ] },
  danger: { name: 'danger', idiom: 'a driving figure over low drums', bpm: 138, steps: 16, beat: 4, bars: 4, tonic: 50, scale: PHRYGIAN, minor: true, colour: 1, sections: 4, gap: [0, 0], swing: 0, room: 0.15, voices: [
    { name: 'drum', kind: 'beat', patch: drum, layer: 1, gain: 0.9, low: 0, want: 6, rules: rules(as(R.amount), as(R.pushes, 3), as(R.likeATradition), as(R.loudAndSoft)) },
    { name: 'figure', kind: 'line', patch: marimba, layer: 1, gain: 0.7, pan: 0.2, low: 0, want: 0.75, span: 5, bars: 1, rules: rules(as(R.inKey), as(R.bySteps), as(R.onTheChord), as(R.leavesRoom), as(L(R.repeats), 2)) },
    { name: 'low', kind: 'pad', patch: low, layer: 2, gain: 0.9, low: -12, want: 1, rules: [] },
    { name: 'hat', kind: 'beat', patch: hat, layer: 2, gain: 0.7, pan: -0.2, low: 0, want: 8, rules: rules(as(R.amount), as(R.even), as(R.loudAndSoft)) },
  ] },
  making: { name: 'making', idiom: 'bright and busy: a marimba at work', bpm: 122, steps: 16, beat: 4, bars: 4, tonic: 50, scale: PENTA, minor: false, colour: 2, sections: 4, gap: [0, 0], swing: 0.04, room: 0.2, voices: [
    { name: 'marimba', kind: 'line', patch: marimba, layer: 1, gain: 0.8, pan: -0.2, low: 12, want: 0.5, span: 8, bars: 2, rules: rules(as(R.inKey), as(R.bySteps), as(R.leapsTurnBack), as(R.onTheChord), as(R.leavesRoom), as(R.doesNotStammer), as(L(R.pushes))) },
    { name: 'shaker', kind: 'beat', patch: shaker, layer: 1, gain: 0.6, pan: 0.3, low: 0, want: 10, rules: rules(as(R.likeATradition, 3), as(R.amount), as(R.loudAndSoft)) },
    { name: 'bass', kind: 'bass', patch: bass, layer: 2, gain: 0.8, low: -12, want: 0.25, rules: under },
    { name: 'keys', kind: 'stab', patch: keys, layer: 2, gain: 0.6, pan: 0.2, low: 12, want: 2, rules: rules(as(R.amount), as(R.pushes, 3)) },
  ] },
}

/** The modes a mood may be put in, all on D: the scale, whether its third is minor, and the degree that makes it itself. */
export const MODES: Record<string, { scale: number[]; minor: boolean; colour: number }> = {
  major: { scale: [0, 2, 4, 5, 7, 9, 11], minor: false, colour: 6 }, lydian: { scale: LYDIAN, minor: false, colour: 3 }, mixolydian: { scale: [0, 2, 4, 5, 7, 9, 10], minor: false, colour: 6 },
  dorian: { scale: DORIAN, minor: true, colour: 5 }, minor: { scale: AEOLIAN, minor: true, colour: 5 }, phrygian: { scale: PHRYGIAN, minor: true, colour: 1 }, pentatonic: { scale: PENTA, minor: false, colour: 2 },
}
/** How slow and how fast music may be asked to go, beats a minute. */
export const PACE = [40, 180] as const
const made = new Map<string, Mood>()
/** The name of a mood as it is asked for: a kept one, at a pace of its own (0 for the mood's) and in a mode of its own ('' for the mood's). */
export const moodKey = (like: string, pace = 0, mode = '') => (pace || mode ? `${like}|${pace}|${mode}` : like)
/**
 * The mood a name stands for: a kept one, or one made of a kept one at another pace and in another mode. What a
 * name holds may have come from a stranger: an unknown mood is the town's, a pace is kept within PACE, an unknown
 * mode is the mood's own.
 */
export function resolve(key: string): Mood {
  const known = made.get(key)
  if (known) return known
  const [like, pace, mode] = String(key).split('|'), base = Object.hasOwn(MOODS, like) ? MOODS[like] : MOODS.town
  const bpm = Number(pace) > 0 ? Math.min(PACE[1], Math.max(PACE[0], Number(pace))) : base.bpm, m = mode && Object.hasOwn(MODES, mode) ? MODES[mode] : null
  const mood: Mood = bpm === base.bpm && !m ? base : { ...base, name: key, bpm, ...(m ?? {}) }
  if (made.size > 64) made.clear()
  made.set(key, mood)
  return mood
}

/** Numbers from a seed: the same seed, the same music. */
export function dice(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function best<T>(make: () => T, list: Rule<T>[], around: Around, tries: number) {
  let top = -1, kept: T | null = null, each: number[] = [], sum = 0
  for (let i = 0; i < tries; i++) {
    const c = make(), j = R.judge(list, c, around)
    sum += j.total
    if (j.total > top) { top = j.total; kept = c; each = j.each }
  }
  return { kept: kept!, total: top, mean: sum / tries, rules: list.map((r, i) => ({ name: r.name, why: r.why, source: r.source, read: r.read, weight: r.weight, score: each[i] })) }
}

const HARMONY = [R.startsAtHome, R.leadsBack, R.keepsATone, R.showsItsColour, R.noSourChord, R.moves]

/**
 * A section of a mood's music from a seed. `figure` is the piece's own (the lead's line from its first section): later
 * sections are scored on coming back to it. `groove` is a seed for what should stay the same through a piece (its
 * chords and its drums); left out, the section's own.
 */
export function compose(mood: Mood, seed: number, { figure, groove = seed, tries = TRIES }: { figure?: Line; groove?: number; tries?: number } = {}): Section {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const n = mood.scale.length, total = mood.steps * mood.bars
  const base: Around = { steps: mood.steps, beat: mood.beat, scale: mood.scale, minor: mood.minor, chords: [], want: mood.colour }
  // The harmony first: a chord a bar.
  const hr = dice(groove ^ 0x51ed)
  const harmony = best<Chords>(() => Array.from({ length: mood.bars }, () => Math.floor(hr() * n)), HARMONY, base, tries)
  const chords = harmony.kept, triads = chords.map((r) => [r, r + 2, r + 4])
  const midi = (degree: number, lowest: number) => mood.tonic + lowest + 12 * Math.floor(degree / n) + mood.scale[((degree % n) + n) % n]
  const parts: Part[] = [{ voice: 'harmony', kind: 'pad', layer: 0, patch: pad, gain: 0, pan: 0, period: total, notes: [], total: harmony.total, tried: tries, mean: harmony.mean, rules: harmony.rules }]
  let kickBeat: Beat | undefined
  // The kick first: others are scored on fitting round it. Each voice keeps its own dice whatever the order.
  const order = mood.voices.map((v, index) => ({ v, index })).sort((x, y) => Number(y.v.name === 'kick') - Number(x.v.name === 'kick'))
  for (const { v, index } of order) {
    // What holds through a piece (drums, the chords' rhythm) comes of the groove's seed; the rest of the section's own.
    const rnd = dice((v.kind === 'beat' || v.kind === 'stab' ? groove : seed) ^ Math.imul(index + 1, 0x9e3779b1))
    const bars = v.bars ?? (v.kind === 'beat' || v.kind === 'stab' ? 1 : mood.bars), len = bars * mood.steps
    const around: Around = { ...base, chords: triads, kick: kickBeat, want: v.want, motif: v.name === 'lead' || v.layer === 1 ? figure : undefined }
    const part: Part = { voice: v.name, kind: v.kind, layer: v.layer, patch: v.patch, gain: v.gain, pan: v.pan ?? 0, period: len, notes: [], total: 1, tried: 0, mean: 1, rules: [] }
    if (v.kind === 'pad') {
      // The bar's chord, held, each note as near as may be to where the last chord's lay.
      part.period = total
      const middle = mood.tonic + v.low + 7
      triads.forEach((chord, bar) => { for (const d of chord) { let m = midi(d % n, v.low); while (m - middle > 6) m -= 12; while (middle - m > 6) m += 12; part.notes.push({ at: bar * mood.steps, len: mood.steps, midi: m, vel: 0.6 }) } })
    } else if (v.kind === 'beat' || v.kind === 'stab') {
      const p = v.want / mood.steps
      const found = best<Beat>(() => {
        const density = p * (0.5 + 1.2 * rnd()), half = rnd() < 0.5, b: Beat = []
        for (let i = 0; i < len; i++) b.push(half && i >= len / 2 ? b[i - len / 2] : rnd() < density ? 0.4 + 0.6 * rnd() : 0)
        return b
      }, v.rules as unknown as Rule<Beat>[], around, tries)
      Object.assign(part, { total: found.total, mean: found.mean, tried: tries, rules: found.rules })
      if (v.name === 'kick') kickBeat = found.kept
      if (v.kind === 'beat') found.kept.forEach((vel, i) => { if (vel > 0) part.notes.push({ at: i, len: 1, midi: 0, vel }) })
      else {
        part.period = total
        const middle = mood.tonic + v.low + 7
        for (let bar = 0; bar < mood.bars; bar++) found.kept.forEach((vel, i) => { if (vel > 0) for (const d of triads[bar]) { let m = midi(d % n, v.low); while (m - middle > 6) m -= 12; while (middle - m > 6) m += 12; part.notes.push({ at: bar * mood.steps + i, len: 2, midi: m, vel: vel * 0.8 }) } })
      }
    } else {
      const span = v.span ?? n, isBass = v.kind === 'bass'
      const found = best<Line>(() => {
        const l: Line = []
        const density = v.want * (0.6 + 0.9 * rnd())
        let at = isBass ? 0 : triads[0][Math.floor(rnd() * 3)] % n, sounding = false
        for (let i = 0; i < len; i++) {
          const bar = Math.floor(i / mood.steps) % mood.bars, root = chords[bar]
          if (isBass && i % mood.steps === 0 && rnd() < 0.9) { at = root % n; l.push(at); sounding = true; continue }
          if (rnd() < density) {
            // A bass goes between its chord's root, fifth and octave, or a step from where it is; a melody mostly by step, now and then by leap.
            const r = rnd(), home = root % n
            at = isBass ? [home, home, home + 4, home + n, at + 1, at - 1][Math.floor(r * 6)] : at + (r < 0.34 ? 1 : r < 0.68 ? -1 : r < 0.76 ? 2 : r < 0.84 ? -2 : r < 0.89 ? 0 : (rnd() < 0.5 ? 1 : -1) * (3 + Math.floor(rnd() * 3)))
            at = Math.max(0, Math.min(isBass ? n + 4 : span, at))
            l.push(at); sounding = true
          } else if (sounding && rnd() < 0.55) l.push(-2)
          else { l.push(-1); sounding = false }
        }
        return l
      }, v.rules as unknown as Rule<Line>[], { ...around, chords: isBass ? chords.map((r) => [r % n, r % n + 4]) : triads }, tries)
      Object.assign(part, { total: found.total, mean: found.mean, tried: tries, rules: found.rules })
      for (const note of R.notes(found.kept)) part.notes.push({ at: note.at, len: note.len, midi: midi(note.degree, v.low), vel: 0.55 + 0.4 * rnd() + (note.at % mood.beat === 0 ? 0.05 : -0.05) })
      if (v.name === 'lead' || (v.layer === 1 && v.kind === 'line')) part.line = found.kept
    }
    parts.push(part)
  }
  return { mood: mood.name, idiom: mood.idiom, seed, bpm: mood.bpm, steps: mood.steps, beat: mood.beat, bars: mood.bars, swing: mood.swing, room: mood.room, chords, parts, ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0 }
}

/** Which layers sound in each section of a piece: it comes in a layer at a time, thins once past its middle, fills again and leaves. */
export function arc(sections: number, layers: number, takingOver = false): number[] {
  return Array.from({ length: sections }, (_, i) => {
    // Taking over from another place's music, it does not start from one voice alone: that would be a hole.
    if (i === 0 && takingOver) return Math.min(layers, 2)
    if (sections <= 4) return Math.min(layers, i + 1 + (i === sections - 1 ? -1 : 0)) || 1
    if (i === sections - 1) return 1
    if (i === Math.floor(sections * 0.6)) return Math.max(1, Math.min(2, layers - 1))
    return Math.min(layers, i + 1)
  })
}
