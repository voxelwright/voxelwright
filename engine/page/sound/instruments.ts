// Three instruments kept with the engine (#247): each a voice (a patch) and a surface to play it by, in the same
// form a model writes one in. They are data: the checks read them back from JSON.
//
// The guitar is after The Last of Us Part II's: a chord is picked, and the strings are strummed or plucked one at a
// time. (The owner named Spider-Man's guitar. One lookup of Spider-Man 2's control guides found none, and Miles
// Morales was not looked at: which game he meant is still to be asked.) The ocarina is after
// Ocarina of Time's: five notes, low to high, on five holes; here a finger drawn up or down a hole bends its note.
// The piano's two octaves lie on two rows of keys, as the lyre of Genshin Impact lays its notes.
import type { Patch } from './patch.ts'
import type { Part, Surface } from './instrument.ts'

export interface Instrument { name: string; sounds: { play: Patch; surface: Surface } }

const strings = [40, 45, 50, 55, 59, 64]
const chords: [string, number[]][] = [['D', [45, 50, 57, 62, 66, 69]], ['G', [43, 47, 50, 55, 59, 67]], ['A', [45, 52, 57, 61, 64, 69]], ['Bm', [47, 54, 59, 62, 66, 71]], ['Em', [40, 47, 52, 55, 59, 64]], ['C', [40, 48, 52, 55, 60, 64]]]
export const guitar: Instrument = { name: 'guitar', sounds: {
  play: { how: 'plucked', hard: 0.6, rough: 0.1, shape: 'string', pitch: 196, ring: 3.2, damp: 0.42, where: 0.2, gain: 0.75 },
  surface: { size: [14, 7], release: 'rings', parts: [
    { shape: 'round', at: [0.2, 0.3, 9.6, 6.4], colour: 'wood' },
    { shape: 'round', at: [3.2, 2, 3, 3], colour: 'dark' },
    { shape: 'rect', at: [7, 2.9, 2, 1.2], colour: 'dark' },
    ...strings.map((note, i): Part => ({ shape: 'rect', at: [0.6, 5.55 - i * 0.82, 8.8, 0.62], colour: i < 3 ? 'brass' : 'steel', note, string: i, key: `Key${'QWERTY'[i]}` })),
    ...chords.map(([label, chord], i): Part => ({ shape: 'rect', at: [10.2 + (i % 2) * 1.85, 0.4 + Math.floor(i / 2) * 1.5, 1.7, 1.3], colour: 'pale', label, chord, key: `Digit${i + 1}` })),
    { shape: 'rect', at: [10.2, 5, 3.55, 1.6], colour: 'clay', label: 'strum', strum: 22, key: 'Space' },
  ] } } }

const holes = [62, 65, 69, 71, 74]
export const ocarina: Instrument = { name: 'ocarina', sounds: {
  play: { how: 'blown', hard: 0.75, rough: 0.14, shape: 'hollow', pitch: 587, ring: 0.09, damp: 0.6, waver: 0.35, gain: 0.7 },
  surface: { size: [12, 6], parts: [
    { shape: 'poly', points: [[0.3, 3.2], [1.6, 1.2], [5, 0.4], [9, 0.9], [11.6, 2.6], [11.4, 4.2], [9, 5.4], [4.6, 5.6], [1.4, 4.9]], colour: 'blue' },
    { shape: 'poly', points: [[4.6, 0.45], [5.6, 0], [6.6, 0], [7.2, 0.6]], colour: 'sky' },
    // A finger drawn up a hole raises its note a tone, down lowers it: the middle is the note itself.
    ...holes.map((note, i): Part => ({ shape: 'round', at: [1.5 + i * 1.95, 1.9 + (i % 2) * 0.9, 1.5, 1.9], colour: 'night', label: ['D', 'F', 'A', 'B', 'D'][i], note: note - 2, slide: { to: note + 2, along: 'y' }, key: `Key${'ASDFG'[i]}` })),
  ] } } }

const white = [0, 2, 4, 5, 7, 9, 11], black: [number, number][] = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]]
const rows = [{ from: 60, white: 'ZXCVBNM', black: 'SDGHJ' }, { from: 72, white: 'QWERTYU', black: '23567' }]
export const piano: Instrument = { name: 'piano', sounds: {
  play: { how: 'struck', hard: 0.5, rough: 0.03, shape: 'string', pitch: 262, ring: 4.5, damp: 0.5, where: 0.12, gain: 0.7 },
  surface: { size: [14.4, 5], release: 'stops', parts: [
    { shape: 'rect', at: [0, 0, 14.4, 5], colour: 'dark' },
    ...rows.flatMap((row, r) => white.map((semi, i): Part => ({ shape: 'rect', at: [0.2 + (r * 7 + i), 0.5, 0.94, 4.3], colour: 'ivory', note: row.from + semi, key: `Key${row.white[i]}`, label: semi === 0 ? `C${r + 4}` : undefined }))),
    ...rows.flatMap((row, r) => black.map(([semi, after], i): Part => ({ shape: 'rect', at: [0.2 + (r * 7 + after) + 0.66, 0.5, 0.6, 2.7], colour: 'ebony', note: row.from + semi, key: /\d/.test(row.black[i]) ? `Digit${row.black[i]}` : `Key${row.black[i]}` }))),
  ] } } }

export const INSTRUMENTS: Instrument[] = [guitar, ocarina, piano].map((i) => JSON.parse(JSON.stringify(i)))
