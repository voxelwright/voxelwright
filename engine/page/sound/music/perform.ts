// A section as notes in time (#247): which of its parts sound (a piece comes in a layer at a time), when each note
// falls in seconds from the section's start, at what pitch and how hard. No clock and no sound here: the page's
// conductor and the checks both play what this says.
import type { Patch } from '../patch.ts'
import type { Section } from './compose.ts'

export interface Played { at: number; patch: Patch; hz: number; force: number; dur: number; pan: number; gain: number; room: number; voice: string }
/** How loud the music is against a thing struck beside you: it lies under the world. */
export const LEVEL = 0.95

/** Seconds a step takes. */
export const stepTime = (s: Section) => 60 / s.bpm / s.beat
/** Seconds a section takes. */
export const length = (s: Section) => s.steps * s.bars * stepTime(s)

/**
 * The notes of a section that start in steps [from, to) counted from the piece's start (so a part whose own length
 * is not the section's keeps its own place), for the layers up to `layers`. `at` is seconds from the piece's start.
 */
export function perform(s: Section, from: number, to: number, layers: number, jitter: () => number = Math.random): Played[] {
  const step = stepTime(s), out: Played[] = []
  for (const p of s.parts) {
    if (!p.notes.length || p.layer > layers || p.layer === 0) continue
    for (let turn = Math.floor(from / p.period); turn * p.period < to; turn++) for (const n of p.notes) {
      const at = turn * p.period + n.at
      if (at < from || at >= to) continue
      // Steps between the beats come a little late where the idiom swings; nothing is struck quite like a machine.
      // A plucked string is left to ring (a bass is stopped, to keep it out of the next note's way).
      const late = (n.at % 2 === 1 ? s.swing * step : 0) + (jitter() - 0.5) * 0.008
      out.push({ at: at * step + late, patch: p.patch, hz: n.midi ? 440 * 2 ** ((n.midi - 69) / 12) : 0, force: Math.max(0.05, Math.min(1, n.vel * (0.94 + 0.12 * jitter()))), dur: p.patch.how === 'plucked' && p.kind !== 'bass' ? 0 : n.len * step * (p.kind === 'pad' ? 1.02 : 0.9), pan: p.pan, gain: p.gain * LEVEL, room: s.room, voice: p.voice })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}
