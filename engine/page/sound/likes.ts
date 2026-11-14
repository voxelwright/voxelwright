// Sounds by what they are like (#247, #264): a small kept set a rule can ask for by a word, each a patch or two of
// the same form anything else is written in (patch.ts). `reach` is the metres at which it is half as loud as close
// to. A rule that wants a sound that is not here writes its own patch; nothing here is for any game.
import type { Patch } from './patch.ts'

export interface Like { says: string; reach: number; patches: Patch[]; /** Held for as long as asked (`for`), not struck once. */ held?: boolean }

export const LIKES: Record<string, Like> = {
  blow: { says: 'a fist or a stick landing on someone', reach: 6, patches: [{ how: 'struck', hard: 0.25, rough: 0.6, shape: 'lump', pitch: 95, ring: 0.07, damp: 0.9, air: { from: 2600, to: 700, for: 0.07, gain: 0.5, q: 0.6 }, gain: 0.85 }] },
  slap: { says: 'an open hand, a wet cloth', reach: 6, patches: [{ how: 'struck', hard: 0.4, rough: 1, shape: 'lump', pitch: 300, ring: 0.02, damp: 1, air: { from: 4200, to: 1500, for: 0.06, gain: 0.9, q: 0.7 }, gain: 0.7 }] },
  thud: { says: 'a body or a sack falling', reach: 8, patches: [{ how: 'struck', hard: 0.15, rough: 0.5, shape: 'lump', pitch: 60, ring: 0.12, damp: 0.9, air: { from: 600, to: 120, for: 0.15, gain: 0.5, q: 0.6 }, gain: 0.9 }] },
  knock: { says: 'knuckles on wood', reach: 8, patches: [{ how: 'struck', hard: 0.6, rough: 0.3, shape: 'bar', pitch: 260, ring: 0.12, damp: 0.5, gain: 0.8 }] },
  clang: { says: 'metal struck: an anvil, a pan, a shield', reach: 20, patches: [{ how: 'struck', hard: 1, rough: 0.15, shape: 'plate', pitch: 620, ring: 0.9, damp: 0.2, gain: 0.75 }] },
  shot: { says: 'a gun fired', reach: 120, patches: [
    { how: 'struck', hard: 1, rough: 1, shape: 'lump', pitch: 1400, ring: 0.02, damp: 0.9, air: { from: 9000, to: 500, for: 0.13, gain: 1, q: 0.4 }, gain: 1 },
    { how: 'struck', hard: 0.5, rough: 0.5, shape: 'skin', pitch: 85, ring: 0.3, damp: 0.7, bend: 1, air: { from: 1800, to: 140, for: 0.6, gain: 0.7, q: 0.4 }, gain: 0.8 }] },
  bang: { says: 'a shell, a firework, a door blown in', reach: 250, patches: [
    { how: 'struck', hard: 1, rough: 1, shape: 'lump', pitch: 800, ring: 0.03, damp: 0.9, air: { from: 7500, to: 700, for: 0.22, gain: 1, q: 0.4 }, gain: 1 },
    { how: 'struck', hard: 0.45, rough: 0.6, shape: 'skin', pitch: 46, ring: 1.3, damp: 0.7, bend: 1.3, air: { from: 1400, to: 60, for: 1.8, gain: 1, q: 0.4 }, gain: 1 }] },
  bell: { says: 'a bell rung: a ring bell, a tower bell (size makes it bigger and lower)', reach: 60, patches: [{ how: 'struck', hard: 0.9, rough: 0.05, shape: 'bell', pitch: 520, ring: 4, damp: 0.18, gain: 0.8 }] },
  chime: { says: 'a small bright ring: a coin, a glass, a triangle', reach: 12, patches: [{ how: 'struck', hard: 0.95, rough: 0.03, shape: 'bar', pitch: 2100, ring: 1.2, damp: 0.2, gain: 0.55 }] },
  gong: { says: 'a great plate struck soft', reach: 80, patches: [{ how: 'struck', hard: 0.3, rough: 0.1, shape: 'plate', pitch: 110, ring: 6, damp: 0.25, bend: -0.05, gain: 0.85 }] },
  drum: { says: 'a drum beaten', reach: 40, patches: [{ how: 'struck', hard: 0.4, rough: 0.2, shape: 'skin', pitch: 110, ring: 0.4, damp: 0.7, bend: 0.4, gain: 0.85 }] },
  clap: { says: 'two hands', reach: 12, patches: [{ how: 'struck', hard: 0.9, rough: 1, modes: [[1, 0.3]], pitch: 1100, ring: 0.03, damp: 1, air: { from: 2300, to: 1300, for: 0.1, gain: 0.9, q: 1.5 }, gain: 0.6 }] },
  cheer: { says: 'a crowd roaring and clapping, about three seconds', reach: 90, patches: [{ how: 'struck', hard: 0.9, rough: 1, modes: [[1, 0.25]], pitch: 1200, ring: 0.03, damp: 1, pieces: { count: 36, over: 2.6, spread: 0.5 }, air: { from: 650, to: 2100, for: 3, gain: 1, q: 0.45 }, gain: 0.8 }] },
  strum: { says: 'a guitar string; with notes, a chord strummed or a tune picked', reach: 25, patches: [{ how: 'plucked', hard: 0.6, rough: 0.1, shape: 'string', pitch: 196, ring: 3, damp: 0.42, where: 0.2, gain: 0.75 }] },
  key: { says: 'a piano key; with notes, a chord or a tune', reach: 25, patches: [{ how: 'struck', hard: 0.5, rough: 0.03, shape: 'string', pitch: 262, ring: 3.5, damp: 0.5, where: 0.12, gain: 0.7 }] },
  pipe: { says: 'a flute or a whistled note, held for as long as asked', reach: 25, held: true, patches: [{ how: 'blown', hard: 0.6, rough: 0.16, shape: 'hollow', pitch: 587, ring: 0.12, damp: 0.6, waver: 0.4, gain: 0.6 }] },
  horn: { says: 'a horn, a bugle, a car’s horn, held for as long as asked', reach: 120, held: true, patches: [{ how: 'blown', hard: 0.7, rough: 0.12, shape: 'tube', pitch: 233, ring: 0.1, damp: 0.25, gain: 0.7 }] },
  whistle: { says: 'a referee’s whistle, held for as long as asked', reach: 80, held: true, patches: [{ how: 'blown', hard: 0.95, rough: 0.5, shape: 'hollow', pitch: 2700, ring: 0.05, damp: 0.5, waver: 1, gain: 0.55 }] },
  engine: { says: 'a motor running, held for as long as asked; pitch is how fast it turns', reach: 50, held: true, patches: [{ how: 'rubbed', hard: 0.6, rough: 0.5, shape: 'string', pitch: 70, ring: 0.2, damp: 0.35, waver: 0.6, gain: 0.5 }] },
  whoosh: { says: 'something passing fast through the air', reach: 15, patches: [{ how: 'struck', hard: 0.05, rough: 1, modes: [[1, 0.02]], pitch: 200, ring: 0.02, damp: 1, air: { from: 500, to: 2600, for: 0.4, gain: 0.8, q: 1.2 }, gain: 0.6 }] },
  splash: { says: 'something into water', reach: 20, patches: [{ how: 'struck', hard: 0.3, rough: 0.6, shape: 'hollow', pitch: 420, ring: 0.09, damp: 0.6, bend: -0.5, pieces: { count: 8, over: 0.4, spread: 0.7 }, air: { from: 1800, to: 5000, for: 0.4, gain: 0.7, q: 0.5 }, gain: 0.75 }] },
  smash: { says: 'glass or china breaking', reach: 25, patches: [{ how: 'struck', hard: 1, rough: 0.3, shape: 'plate', pitch: 1500, ring: 0.35, damp: 0.3, pieces: { count: 30, over: 0.7, spread: 0.9 }, air: { from: 9500, to: 4500, for: 0.3, gain: 0.75, q: 0.6 }, gain: 0.8 }] },
  click: { says: 'a switch, a latch, an empty gun', reach: 5, patches: [{ how: 'struck', hard: 1, rough: 0.2, shape: 'lump', pitch: 2400, ring: 0.015, damp: 0.8, gain: 0.5 }] },
}
