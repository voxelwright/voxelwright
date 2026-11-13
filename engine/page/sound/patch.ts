// A sound as data (#247): what a model writes beside a made thing, and the only reading of it.
//
// A patch says how a thing is set sounding and what it is, never how to compute it:
//
//   { "how": "struck",            struck | plucked | blown | rubbed
//     "hard": 0.8,                0 to 1: how hard the two things that meet are (felt 0.1, wood 0.5, steel 1).
//                                 Harder means a shorter touch and so a brighter sound. Blown or rubbed: how suddenly it speaks.
//     "rough": 0.2,               0 to 1: grit in the touch, breath in the tone
//     "shape": "bar",             what rings: bar plate bell skin string tube pipe hollow lump cup
//     "modes": [[1, 1], [2.7, 0.5]],   or its own modes in place of a shape: up to 12 of [ratio 1 to 40, loudness 0 to 1]
//     "pitch": 440,               Hz of its lowest mode at the thing's own size, 20 to 8000
//     "ring": 1.2,                seconds until that mode has died away (60 dB), 0.01 to 12. Blown or rubbed: how long it takes to stop.
//     "damp": 0.5,                0 to 1: how much sooner high modes die than low ones (metal 0.1, glass 0.3, wood 0.8)
//     "where": 0.3,               0 to 0.5: where along it it is struck or plucked (0.5 the middle), optional
//     "bend": 0,                  -2 to 2 octaves: it starts that far off its pitch and settles (a drum skin +, a drop of water -), optional
//     "waver": 0,                 0 to 1: how much a held tone trembles, optional
//     "pieces": { "count": 12, "over": 0.4, "spread": 0.6 },   optional: after the blow, that many small ones of the same stuff
//                                 (a thing breaking, gravel, a rattle) over so many seconds, each up to 1 + 3 * spread times higher
//     "air": { "from": 4000, "to": 800, "for": 0.3, "gain": 0.5 },   optional: a rush of noise that sweeps between two pitches
//                                 (a crash, a whoosh, a puff), "q" 0.3 to 12 for how narrow
//     "gain": 0.7 }               0 to 1
//
// A patch is data. Anything that is not exactly this is refused with the reason; nothing in it is run; every number
// has a range. How loud it can ever be is not the patch's to say: the synthesiser's own ceiling is after everything
// (dsp.ts), so a patch that passes here and is as loud as it can be is still under it.
//
// A thing's `sounds` is at most six of these under the names of what happens to it, and for a thing that is played
// the surface it is played by (surface.ts), which sounds its "play":
//   { "hit": patch, "break": patch, "step": patch, "use": patch, "hum": patch, "play": patch, "surface": surface }

import { surface, type Surface } from './surface.ts'

export type How = 'struck' | 'plucked' | 'blown' | 'rubbed'
export interface Patch {
  how: How; hard: number; rough: number; shape?: string; modes?: [number, number][]; pitch: number; ring: number; damp: number
  where?: number; bend?: number; waver?: number
  pieces?: { count: number; over: number; spread: number }
  air?: { from: number; to: number; for: number; gain: number; q?: number }
  gain: number
}
/** A patch as the synthesiser takes it: numbers only. */
export interface Compiled {
  how: number; tau: number; rough: number; ratios: number[]; gains: number[]; pitch: number; ring: number; damp: number; bend: number; waver: number; tilt: number; hard: number; /** 1 if blown or bowed: a held tone, not modes. */ tone: number; where: number
  pieces: number; over: number; spread: number; airFrom: number; airTo: number; airFor: number; airQ: number; airGain: number; gain: number
}

export const HOWS: readonly How[] = ['struck', 'plucked', 'blown', 'rubbed']
/** What happens to a thing that it may have a sound for. */
export const ROLES = ['hit', 'break', 'step', 'use', 'hum', 'play'] as const
export const MODES_MOST = 12

/**
 * The modes of a shape, as multiples of its lowest. Bar: a free bar's (Euler-Bernoulli: 1, 2.756, 5.404, 8.933...). Skin: an
 * ideal round membrane's (zeros of Bessel functions). String, tube: whole multiples; pipe (stopped at one end): odd ones.
 * Bell: hum, prime, tierce, quint, nominal and up, from the hum. Plate, lump and cup are chosen by us to be uneven and
 * close (a plate), closer still (a compact lump of stone), and wide (a glazed cup, from the old home's #107): not measured.
 */
export const SHAPES: Record<string, readonly number[]> = {
  bar: [1, 2.756, 5.404, 8.933, 13.344, 18.638],
  plate: [1, 1.52, 2.11, 2.83, 3.37, 4.25, 5.07, 6.2, 7.6, 9.1],
  bell: [1, 2, 2.4, 3, 4, 5.33, 6.6, 8.1],
  skin: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501],
  string: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  tube: [1, 2, 3, 4, 5, 6, 7, 8],
  pipe: [1, 3, 5, 7, 9, 11],
  hollow: [1, 4.1, 6.3],
  lump: [1, 1.37, 1.91, 2.33, 2.87, 3.45, 4.1, 4.9],
  cup: [1, 2.32, 4.25, 6.63, 9.4],
}
/** How much of a saw is in a held tone of each shape (the rest is a sine): a hollow thing (an ocarina) is nearly a pure tone. */
const TILT: Record<string, number> = { hollow: 0.04, pipe: 0.3, tube: 0.45, string: 0.8, bar: 0.2, bell: 0.2, plate: 0.5, skin: 0.5, lump: 0.5, cup: 0.15 }

const KEYS = ['how', 'hard', 'rough', 'shape', 'modes', 'pitch', 'ring', 'damp', 'where', 'bend', 'waver', 'pieces', 'air', 'gain']
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const only = (o: object, keys: readonly string[]) => Object.keys(o).find((k) => !keys.includes(k))
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/** A patch read from data: the patch, or why it is refused. Nothing is filled in but what the form calls optional. */
export function patch(v: unknown): { patch: Patch } | { refused: string } {
  const no = (why: string) => ({ refused: why })
  if (!plain(v)) return no('a patch is an object')
  const stray = only(v, KEYS)
  if (stray) return no(`a patch has no "${stray}"`)
  if (!HOWS.includes(v.how as How)) return no(`"how" is one of ${HOWS.join(', ')}`)
  for (const [key, lo, hi] of [['hard', 0, 1], ['rough', 0, 1], ['pitch', 20, 8000], ['ring', 0.01, 12], ['damp', 0, 1], ['gain', 0, 1]] as const) if (!num(v[key], lo, hi)) return no(`"${key}" is a number from ${lo} to ${hi}`)
  for (const [key, lo, hi] of [['where', 0, 0.5], ['bend', -2, 2], ['waver', 0, 1]] as const) if (key in v && !num(v[key], lo, hi)) return no(`"${key}" is a number from ${lo} to ${hi}`)
  if ('shape' in v === 'modes' in v) return no('a patch has a "shape" or its own "modes", one of the two')
  if ('shape' in v && !(typeof v.shape === 'string' && Object.hasOwn(SHAPES, v.shape))) return no(`"shape" is one of ${Object.keys(SHAPES).join(', ')}`)
  if ('modes' in v) {
    const m = v.modes
    if (!Array.isArray(m) || m.length < 1 || m.length > MODES_MOST) return no(`"modes" is 1 to ${MODES_MOST} of [ratio, loudness]`)
    for (const each of m) if (!Array.isArray(each) || each.length !== 2 || !num(each[0], 1, 40) || !num(each[1], 0, 1)) return no('a mode is [ratio 1 to 40, loudness 0 to 1]')
    if (!m.some((each) => each[1] > 0)) return no('one mode at least is heard')
  }
  if ('pieces' in v) {
    const p = v.pieces
    if (!plain(p) || only(p, ['count', 'over', 'spread'])) return no('"pieces" is {count, over, spread}')
    if (!Number.isInteger(p.count) || !num(p.count, 1, 40) || !num(p.over, 0.02, 4) || !num(p.spread, 0, 1)) return no('"pieces" is a count of 1 to 40, over 0.02 to 4 seconds, spread 0 to 1')
  }
  if ('air' in v) {
    const a = v.air
    if (!plain(a) || only(a, ['from', 'to', 'for', 'gain', 'q'])) return no('"air" is {from, to, for, gain, q}')
    if (!num(a.from, 40, 12000) || !num(a.to, 40, 12000) || !num(a.for, 0.01, 6) || !num(a.gain, 0, 1) || ('q' in a && !num(a.q, 0.3, 12))) return no('"air" goes from and to 40 to 12000 Hz, for 0.01 to 6 seconds, gain 0 to 1, q 0.3 to 12')
  }
  return { patch: v as unknown as Patch }
}

/** A thing's sounds as they are kept in its record. */
export type Sounds = Partial<Record<(typeof ROLES)[number], Patch>> & { surface?: Surface }
/** A thing's sounds read from data: each under a known name, at most one a name, and its surface if it is played; or why they are refused. */
export function sounds(v: unknown): { sounds: Sounds } | { refused: string } {
  if (!plain(v)) return { refused: 'sounds is an object' }
  const out: Sounds = {}
  for (const [name, each] of Object.entries(v)) {
    if (name === 'surface') {
      const read = surface(each)
      if ('refused' in read) return { refused: `surface: ${read.refused}` }
      out.surface = read.surface
      continue
    }
    if (!(ROLES as readonly string[]).includes(name)) return { refused: `a thing has no sound called "${name}": ${ROLES.join(', ')}, surface` }
    const read = patch(each)
    if ('refused' in read) return { refused: `${name}: ${read.refused}` }
    out[name as (typeof ROLES)[number]] = read.patch
  }
  if (out.surface && !out.play) return { refused: 'a surface plays the "play" sound: there is none' }
  return { sounds: out }
}

/** A patch as numbers for the synthesiser. Only a patch that `patch` passed is to be given. */
export function compile(p: Patch): Compiled {
  const ratios = p.modes ? p.modes.map((m) => m[0]) : [...SHAPES[p.shape!]]
  const where = p.where ?? 0.23
  // A shape's modes fall off as they go up, and one struck or plucked at a point hears little of a mode that is still there.
  const stringy = p.shape === 'string' || p.shape === 'tube' || p.shape === 'pipe'
  let gains = p.modes ? p.modes.map((m) => m[1]) : ratios.map((r, k) => (1 / (k + 1) ** 0.8) * (stringy ? 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * r * where)) : 0.6 + 0.4 * Math.abs(Math.cos(1.7 * k * (0.5 - where) * Math.PI))))
  const sum = gains.reduce((a, b) => a + b, 0)
  gains = gains.map((g) => g / sum)
  // How long the two touch: a tenth of a millisecond for steel on stone, eight for felt (FoleyAutomatic gives 50 microseconds for marble).
  const tau = 0.008 * (0.0001 / 0.008) ** p.hard
  return {
    how: HOWS.indexOf(p.how), tau, rough: p.rough, ratios, gains, pitch: p.pitch, ring: p.ring, damp: p.damp, bend: p.bend ?? 0, waver: p.waver ?? 0, hard: p.hard,
    tilt: p.modes ? 0.3 : TILT[p.shape!] ?? 0.3, where,
    tone: p.how === 'blown' || (p.how === 'rubbed' && ['string', 'tube', 'pipe', 'hollow'].includes(p.shape ?? '')) ? 1 : 0,
    pieces: p.pieces?.count ?? 0, over: p.pieces?.over ?? 0, spread: p.pieces?.spread ?? 0,
    airFrom: p.air?.from ?? 0, airTo: p.air?.to ?? 0, airFor: p.air?.for ?? 0, airQ: p.air?.q ?? 1, airGain: p.air?.gain ?? 0, gain: p.gain,
  }
}
