// Synthesized AudioWorklet patches for the Smartphone OS & DoorSmash food delivery game (#247).
// Pure strict Patch data played through engine/page/sound/sound.ts — zero external audio files.
import type { Patch } from './sound/patch.ts'
import type { Sound } from './sound/sound.ts'
import { BUS } from './sound/sound.ts'

/** Crisp two-tone smartphone order dispatch chime (high glass marimba). */
export const PHONE_ORDER_PING_A: Patch = {
  how: 'struck', hard: 0.72, rough: 0.08, shape: 'bar', pitch: 880, ring: 0.28, damp: 0.35, gain: 0.42,
}
export const PHONE_ORDER_PING_B: Patch = {
  how: 'struck', hard: 0.78, rough: 0.06, shape: 'bar', pitch: 1174.66, ring: 0.42, damp: 0.28, gain: 0.46,
}

/** Subtle chat notification pop (soft water-drop pluck). */
export const PHONE_CHAT_POP: Patch = {
  how: 'struck', hard: 0.45, rough: 0.12, shape: 'hollow', pitch: 740, ring: 0.12, damp: 0.55, bend: 0.24, gain: 0.34,
}

/** Tactile phone tap / app click. */
export const PHONE_TAP: Patch = {
  how: 'struck', hard: 0.8, rough: 0.2, shape: 'bar', pitch: 1420, ring: 0.035, damp: 0.85, gain: 0.22,
}

/** Supermarket barcode auto-buy scanner beep. */
export const GROCERY_SCAN_BEEP: Patch = {
  how: 'struck', hard: 0.9, rough: 0.04, shape: 'cup', pitch: 2093, ring: 0.11, damp: 0.25, gain: 0.36,
}

/** Plastic soup lid snap-seal click. */
export const LID_SEAL_SNAP: Patch = {
  how: 'struck', hard: 0.88, rough: 0.32, shape: 'hollow', pitch: 520, ring: 0.06, damp: 0.78, bend: 0.18, gain: 0.44,
}

/** Liquid slosh / soup spill splat. */
export const LIQUID_SPILL: Patch = {
  how: 'struck', hard: 0.25, rough: 0.75, shape: 'hollow', pitch: 310, ring: 0.12, damp: 0.68, bend: -0.45,
  pieces: { count: 7, over: 0.28, spread: 0.7 },
  air: { from: 2200, to: 520, for: 0.28, gain: 0.65, q: 0.6 }, gain: 0.58,
}

/** Crunch / munch sound when eating the customer's food! */
export const EAT_CRUNCH: Patch = {
  how: 'struck', hard: 0.65, rough: 0.92, shape: 'lump', pitch: 260, ring: 0.06, damp: 0.86,
  pieces: { count: 8, over: 0.24, spread: 0.65 },
  air: { from: 3600, to: 900, for: 0.18, gain: 0.6, q: 0.7 }, gain: 0.55,
}

/** Cheeky low brass buzzer when sending the middle finger emoji. */
export const MIDDLE_FINGER_HONK: Patch = {
  how: 'blown', hard: 0.85, rough: 0.42, shape: 'tube', pitch: 164.8, ring: 0.16, damp: 0.4, bend: -0.22, gain: 0.48,
}

/** Cash payout register bell (bright metallic ring). */
export const CASH_CHIME: Patch = {
  how: 'struck', hard: 0.92, rough: 0.06, shape: 'plate', pitch: 1568, ring: 0.55, damp: 0.18, gain: 0.42,
}

/** Death Stranding–inspired crystalline Like (👍) ping. */
export const LIKE_SHIMMER: Patch = {
  how: 'struck', hard: 0.6, rough: 0.04, shape: 'cup', pitch: 1046.5, ring: 0.48, damp: 0.22, gain: 0.34,
}

/** Cargo rattle / thud on a rough bump or crash. */
export const CARGO_THUD: Patch = {
  how: 'struck', hard: 0.38, rough: 0.65, shape: 'hollow', pitch: 118, ring: 0.11, damp: 0.88,
  pieces: { count: 4, over: 0.16, spread: 0.5 },
  air: { from: 1200, to: 220, for: 0.14, gain: 0.5, q: 0.7 }, gain: 0.62,
}

/** Shop entrance door chime. */
export const DOOR_BELL: Patch = {
  how: 'struck', hard: 0.72, rough: 0.06, shape: 'cup', pitch: 1318.5, ring: 0.52, damp: 0.22, gain: 0.38,
}

export type DeliverySfx =
  | 'order'
  | 'chat'
  | 'tap'
  | 'scan'
  | 'seal'
  | 'spill'
  | 'eat'
  | 'finger'
  | 'cash'
  | 'likes'
  | 'thud'
  | 'door'

export function playDeliverySfx(voice: Sound | null | undefined, kind: DeliverySfx): void {
  if (!voice || !voice.running) return
  const opts = { bus: BUS.play, room: 0.06 }
  switch (kind) {
    case 'order':
      voice.play(PHONE_ORDER_PING_A, { ...opts, gain: 0.36 })
      voice.play(PHONE_ORDER_PING_B, { ...opts, after: 0.11, gain: 0.42 })
      break
    case 'chat':
      voice.play(PHONE_CHAT_POP, { ...opts, gain: 0.34 })
      break
    case 'tap':
      voice.play(PHONE_TAP, { ...opts, gain: 0.18 })
      break
    case 'scan':
      voice.play(GROCERY_SCAN_BEEP, { ...opts, gain: 0.34 })
      break
    case 'seal':
      voice.play(LID_SEAL_SNAP, { ...opts, gain: 0.42 })
      break
    case 'spill':
      voice.play(LIQUID_SPILL, { ...opts, gain: 0.52 })
      break
    case 'eat':
      voice.play(EAT_CRUNCH, { ...opts, gain: 0.48 })
      voice.play(EAT_CRUNCH, { ...opts, after: 0.22, pitch: 295, gain: 0.44 })
      break
    case 'finger':
      voice.play(MIDDLE_FINGER_HONK, { ...opts, dur: 0.24, gain: 0.42 })
      voice.play(MIDDLE_FINGER_HONK, { ...opts, after: 0.18, pitch: 138.6, dur: 0.32, gain: 0.45 })
      break
    case 'cash':
      voice.play(PHONE_ORDER_PING_A, { ...opts, pitch: 1046.5, gain: 0.3 })
      voice.play(CASH_CHIME, { ...opts, after: 0.09, gain: 0.42 })
      break
    case 'likes':
      voice.play(LIKE_SHIMMER, { ...opts, pitch: 880, gain: 0.26 })
      voice.play(LIKE_SHIMMER, { ...opts, after: 0.075, pitch: 1108.7, gain: 0.28 })
      voice.play(LIKE_SHIMMER, { ...opts, after: 0.15, pitch: 1318.5, gain: 0.32 })
      voice.play(LIKE_SHIMMER, { ...opts, after: 0.23, pitch: 1760, gain: 0.26 })
      break
    case 'thud':
      voice.play(CARGO_THUD, { ...opts, gain: 0.56 })
      break
    case 'door':
      voice.play(DOOR_BELL, { ...opts, pitch: 1318.5, gain: 0.32 })
      voice.play(DOOR_BELL, { ...opts, after: 0.14, pitch: 1046.5, gain: 0.28 })
      break
  }
}
