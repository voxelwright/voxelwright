// What the world's own stuff sounds like (#247): one patch for each material struck, one for it coming apart, and
// the few sounds that are nobody's material (a blast, a step, a tool). They are patches like any a model writes
// (patch.ts): the world is heard through the same form a made thing is, and the checks read these as data too.
//
// A patch's pitch is for a piece about 30 cm across: a bigger piece is lower and rings longer, by the synthesiser's rule.
import type { Patch } from './patch.ts'

/** The core's materials by number (core/src/kinds.rs), as form.mjs names them. */
export const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp'] as const

/** Struck: by a tool, or as a piece of it lands. */
export const HIT: Record<string, Patch> = {
  earth: { how: 'struck', hard: 0.15, rough: 0.7, shape: 'lump', pitch: 85, ring: 0.09, damp: 0.9, air: { from: 500, to: 140, for: 0.12, gain: 0.5, q: 0.7 }, gain: 0.8 },
  rock: { how: 'struck', hard: 0.95, rough: 0.35, shape: 'lump', pitch: 520, ring: 0.07, damp: 0.75, air: { from: 3200, to: 1200, for: 0.04, gain: 0.25 }, gain: 0.9 },
  grass: { how: 'struck', hard: 0.1, rough: 0.8, shape: 'lump', pitch: 75, ring: 0.07, damp: 0.95, air: { from: 3000, to: 1100, for: 0.14, gain: 0.35, q: 0.6 }, gain: 0.6 },
  sand: { how: 'struck', hard: 0.2, rough: 1, shape: 'lump', pitch: 130, ring: 0.04, damp: 0.95, air: { from: 5200, to: 2400, for: 0.16, gain: 0.7, q: 0.5 }, gain: 0.6 },
  water: { how: 'struck', hard: 0.3, rough: 0.6, shape: 'hollow', pitch: 420, ring: 0.09, damp: 0.6, bend: -0.5, pieces: { count: 6, over: 0.3, spread: 0.7 }, air: { from: 1800, to: 5000, for: 0.3, gain: 0.6, q: 0.5 }, gain: 0.7 },
  asphalt: { how: 'struck', hard: 0.85, rough: 0.55, shape: 'lump', pitch: 290, ring: 0.05, damp: 0.85, air: { from: 2400, to: 900, for: 0.05, gain: 0.3 }, gain: 0.85 },
  concrete: { how: 'struck', hard: 0.9, rough: 0.45, shape: 'lump', pitch: 240, ring: 0.09, damp: 0.8, air: { from: 2800, to: 900, for: 0.05, gain: 0.3 }, gain: 0.9 },
  brick: { how: 'struck', hard: 0.85, rough: 0.5, shape: 'lump', pitch: 390, ring: 0.06, damp: 0.8, air: { from: 3400, to: 1300, for: 0.09, gain: 0.35 }, gain: 0.9 },
  plaster: { how: 'struck', hard: 0.5, rough: 0.6, shape: 'plate', pitch: 210, ring: 0.07, damp: 0.9, air: { from: 2600, to: 800, for: 0.09, gain: 0.4, q: 0.6 }, gain: 0.75 },
  wood: { how: 'struck', hard: 0.6, rough: 0.35, shape: 'bar', pitch: 250, ring: 0.13, damp: 0.45, gain: 0.85 },
  glass: { how: 'struck', hard: 1, rough: 0.1, shape: 'plate', pitch: 1250, ring: 0.45, damp: 0.3, gain: 0.7 },
  steel: { how: 'struck', hard: 1, rough: 0.1, shape: 'plate', pitch: 310, ring: 1.6, damp: 0.12, gain: 0.75 },
  leaves: { how: 'struck', hard: 0.05, rough: 1, shape: 'lump', pitch: 240, ring: 0.03, damp: 1, air: { from: 6500, to: 2800, for: 0.25, gain: 0.6, q: 0.5 }, gain: 0.4 },
  roofing: { how: 'struck', hard: 0.7, rough: 0.5, shape: 'plate', pitch: 430, ring: 0.08, damp: 0.75, gain: 0.8 },
  lamp: { how: 'struck', hard: 1, rough: 0.1, shape: 'cup', pitch: 1900, ring: 0.3, damp: 0.3, gain: 0.6 },
}

/** Coming apart: the blow, then pieces of it going on. Glass is many small bright ones; a wall is fewer, lower, in dust. */
export const BREAK: Record<string, Patch> = {
  glass: { how: 'struck', hard: 1, rough: 0.3, shape: 'plate', pitch: 1500, ring: 0.35, damp: 0.3, pieces: { count: 34, over: 0.7, spread: 0.9 }, air: { from: 6500, to: 3200, for: 0.3, gain: 0.55, q: 0.7 }, gain: 0.8 },
  brick: { how: 'struck', hard: 0.85, rough: 0.7, shape: 'lump', pitch: 330, ring: 0.07, damp: 0.8, pieces: { count: 16, over: 0.7, spread: 0.5 }, air: { from: 1900, to: 240, for: 0.7, gain: 0.8, q: 0.5 }, gain: 0.9 },
  concrete: { how: 'struck', hard: 0.9, rough: 0.7, shape: 'lump', pitch: 210, ring: 0.1, damp: 0.8, pieces: { count: 14, over: 0.8, spread: 0.5 }, air: { from: 1600, to: 180, for: 0.9, gain: 0.85, q: 0.5 }, gain: 0.9 },
  rock: { how: 'struck', hard: 0.95, rough: 0.6, shape: 'lump', pitch: 420, ring: 0.08, damp: 0.75, pieces: { count: 12, over: 0.6, spread: 0.6 }, air: { from: 2200, to: 300, for: 0.6, gain: 0.7, q: 0.5 }, gain: 0.9 },
  wood: { how: 'struck', hard: 0.7, rough: 0.6, shape: 'bar', pitch: 520, ring: 0.12, damp: 0.8, pieces: { count: 9, over: 0.35, spread: 0.7 }, air: { from: 4200, to: 1100, for: 0.25, gain: 0.7, q: 0.7 }, gain: 0.9 },
  plaster: { how: 'struck', hard: 0.5, rough: 0.8, shape: 'plate', pitch: 200, ring: 0.06, damp: 0.9, pieces: { count: 10, over: 0.5, spread: 0.5 }, air: { from: 2400, to: 300, for: 0.6, gain: 0.8, q: 0.5 }, gain: 0.85 },
  steel: { how: 'struck', hard: 1, rough: 0.4, shape: 'plate', pitch: 260, ring: 1.4, damp: 0.15, pieces: { count: 5, over: 0.5, spread: 0.4 }, air: { from: 5000, to: 900, for: 0.3, gain: 0.5 }, gain: 0.85 },
  earth: { how: 'struck', hard: 0.15, rough: 0.9, shape: 'lump', pitch: 80, ring: 0.1, damp: 0.9, pieces: { count: 6, over: 0.5, spread: 0.3 }, air: { from: 900, to: 150, for: 0.5, gain: 0.8, q: 0.5 }, gain: 0.85 },
  leaves: { how: 'struck', hard: 0.05, rough: 1, shape: 'lump', pitch: 240, ring: 0.03, damp: 1, air: { from: 7000, to: 2500, for: 0.6, gain: 0.8, q: 0.5 }, gain: 0.5 },
}
for (const [like, as] of [['asphalt', 'concrete'], ['roofing', 'brick'], ['lamp', 'glass'], ['grass', 'earth'], ['sand', 'earth'], ['water', 'earth']]) BREAK[like] = BREAK[as]

/** Sounds that are not a material's. */
export const WORLD: Record<string, Patch> = {
  // A blast near: the crack. Far off only its boom is left, late.
  crack: { how: 'struck', hard: 1, rough: 1, shape: 'lump', pitch: 800, ring: 0.03, damp: 0.9, air: { from: 4800, to: 500, for: 0.22, gain: 1, q: 0.5 }, gain: 1 },
  // The boom: a great skin that starts high and falls, with the air rolling away under it.
  boom: { how: 'struck', hard: 0.45, rough: 0.6, shape: 'skin', pitch: 46, ring: 1.3, damp: 0.7, bend: 1.3, air: { from: 1400, to: 60, for: 1.8, gain: 1, q: 0.4 }, gain: 1 },
  // A shoe on something hard, on earth, on grass, on sand, in water.
  step: { how: 'struck', hard: 0.85, rough: 0.6, shape: 'lump', pitch: 92, ring: 0.07, damp: 0.7, air: { from: 2400, to: 700, for: 0.09, gain: 0.3, q: 0.6 }, gain: 0.6 },
  stepSoft: { how: 'struck', hard: 0.6, rough: 0.8, shape: 'lump', pitch: 76, ring: 0.07, damp: 0.8, air: { from: 1800, to: 500, for: 0.1, gain: 0.3, q: 0.6 }, gain: 0.55 },
  stepLoose: { how: 'struck', hard: 0.7, rough: 1, shape: 'lump', pitch: 84, ring: 0.07, damp: 0.8, air: { from: 3800, to: 1200, for: 0.12, gain: 0.25, q: 0.5 }, gain: 0.65 },
  // The torch catching: a puff that opens.
  catch: { how: 'struck', hard: 0.1, rough: 1, shape: 'lump', pitch: 120, ring: 0.1, damp: 0.9, air: { from: 250, to: 1800, for: 0.45, gain: 0.8, q: 0.5 }, gain: 0.6 },
  // The cutter: steel drawn through a wall.
  cut: { how: 'rubbed', hard: 1, rough: 0.9, shape: 'plate', pitch: 780, ring: 0.5, damp: 0.25, gain: 0.5 },
  // The cannon: a thump in a pipe, and the ball's air.
  shot: { how: 'struck', hard: 0.6, rough: 0.8, shape: 'skin', pitch: 70, ring: 0.5, damp: 0.7, bend: 1, air: { from: 3000, to: 250, for: 0.5, gain: 0.9, q: 0.5 }, gain: 0.9 },
  // Something set down.
  place: { how: 'struck', hard: 0.7, rough: 0.5, shape: 'lump', pitch: 300, ring: 0.05, damp: 0.85, gain: 0.5 },
  // Driven vehicle foley: door thump, ignition bark, upshift burble, exhaust overrun pop, suspension landing thud, dual-tone horn.
  carDoor: { how: 'struck', hard: 0.35, rough: 0.4, shape: 'lump', pitch: 72, ring: 0.09, damp: 0.9, air: { from: 420, to: 110, for: 0.08, gain: 0.45, q: 0.8 }, gain: 0.75 },
  carStart: { how: 'struck', hard: 0.4, rough: 0.85, shape: 'skin', pitch: 58, ring: 0.32, damp: 0.75, bend: 0.65, air: { from: 260, to: 900, for: 0.28, gain: 0.65, q: 1.1 }, gain: 0.8 },
  carShift: { how: 'struck', hard: 0.45, rough: 0.8, shape: 'skin', pitch: 76, ring: 0.14, damp: 0.85, bend: -0.35, air: { from: 700, to: 180, for: 0.12, gain: 0.55, q: 0.7 }, gain: 0.65 },
  carPop: { how: 'struck', hard: 0.85, rough: 1, shape: 'lump', pitch: 140, ring: 0.05, damp: 0.9, air: { from: 1900, to: 260, for: 0.09, gain: 0.75, q: 0.8 }, gain: 0.7 },
  carThump: { how: 'struck', hard: 0.2, rough: 0.5, shape: 'skin', pitch: 54, ring: 0.18, damp: 0.92, bend: -0.25, air: { from: 320, to: 85, for: 0.14, gain: 0.55, q: 0.6 }, gain: 0.85 },
  // Damped body & vehicle impacts: short hollow thuds and crumple noise, never a ringing steel bell.
  bodyBump: { how: 'struck', hard: 0.14, rough: 0.45, shape: 'lump', pitch: 82, ring: 0.055, damp: 0.92, bend: -0.15, air: { from: 320, to: 90, for: 0.06, gain: 0.35, q: 0.6 }, gain: 0.48 },
  carBump: { how: 'struck', hard: 0.32, rough: 0.55, shape: 'skin', pitch: 66, ring: 0.11, damp: 0.9, bend: -0.25, air: { from: 520, to: 110, for: 0.1, gain: 0.55, q: 0.65 }, gain: 0.8 },
  carCrunch: { how: 'struck', hard: 0.72, rough: 0.95, shape: 'plate', pitch: 155, ring: 0.16, damp: 0.82, bend: -0.2, pieces: { count: 6, over: 0.22, spread: 0.45 }, air: { from: 2400, to: 260, for: 0.22, gain: 0.85, q: 0.5 }, gain: 0.88 },
  carHorn: { how: 'blown', hard: 0.9, rough: 0.15, shape: 'tube', pitch: 415, ring: 0.08, damp: 0.28, gain: 0.55 },
}
