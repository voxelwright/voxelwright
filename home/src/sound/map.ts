// The one place an event becomes a cue (#52). Each event in sound/contract.ts has a line
// here; a line returns the cue to play, or null when this moment of the event is silent.
// scripts/check-sound.mjs proves every contract event is here and reaches a cue.
import type { Events } from 'cordis'
import type { CueName, Where } from './contract'

type Payload<K extends keyof Events> = Parameters<Events[K]>[0]
type Line<K extends keyof Events> = (e: Payload<K>) => CueName | null

const lines = {
  'village/hover': () => 'hover',
  'village/chose': () => 'chose',
  'village/backed': () => 'backed',
  'village/glide': () => 'glide',
  'village/turned': () => 'turned',
  // Villagers are entries, so `village/hover` fires with the wave: the same cue, and its gap keeps it to one.
  'village/greeted': () => 'hover',
  'village/card': () => 'card',
  'village/pad': (e) => (e.up ? 'pad-up' : 'pad-down'),
  'village/wrote': () => 'writing',
  'village/sketched': () => 'sketch',
  'village/sent': () => 'sent',
  'village/routed': (e) => (e.ok ? 'routed' : 'unrouted'),
  'village/furnish': (e) => e.state,
  'village/book': (e) => (e.open ? 'book-open' : 'book-close'),
  'village/page': () => 'page',
  'village/sat': () => 'sat',
  // Leaving the table is the sit reversed: the same hop.
  'village/farewell': () => 'farewell',
  'village/news': () => 'news',
  // One sound for the walk, as the camera heads for the door; the arrival is part of it.
  'village/walk': (e) => (e.phase === 'leave' ? 'walk' : null),
  'village/refused': () => 'refused',
} satisfies { [K in keyof Events]?: Line<K> }

export type SoundEvent = keyof typeof lines
export const MAP: { [K in SoundEvent]: Line<K> } = lines
export const SOUND_EVENTS = Object.keys(MAP) as SoundEvent[]

/** Where an event happened, for stereo pan: `at`, else `from`. */
export const whereOf = (e: Record<string, unknown>): Where | undefined => (e.at ?? e.from) as Where | undefined
