// #47: the declarative villager spec. A model writes it from a description; trusted
// code (./build.ts) clamps every field to the ranges below and builds a felt-plush
// Figure for the shared rig. The spec is data: it is never executed, and any field
// outside its enum or range is clamped or replaced, never trusted.
//
// The owner's accent colour is an input to generation, not a model choice
// (colour = owner); it is worn as the scarf and the hover outline.

/** What the villager does in the household. Silhouette should read as role. */
export type Role = 'cook' | 'gardener' | 'tidier' | 'keeper' | 'tutor' | 'messenger' | 'maker' | 'carer'
export type BodyShape = 'pear' | 'egg' | 'bean' | 'round' | 'tall'
export type Ears = 'none' | 'floppy' | 'round' | 'pointed' | 'tuft' | 'long' | 'antlers'
export type Tail = 'none' | 'stub' | 'curl' | 'long' | 'fluffy'
/** A shell or cape over the back: tortoise shell, wings folded, a quilted coat. */
export type Back = 'none' | 'shell' | 'wings' | 'quilt'
export type Snout = 'none' | 'button' | 'muzzle' | 'beak' | 'long'
export type Pattern = 'plain' | 'belly' | 'spots' | 'stripes' | 'patches'
export type Accessory = 'none' | 'glasses' | 'hat' | 'beret' | 'bow' | 'apron' | 'satchel' | 'headphones' | 'flower'
/** Held props: the existing five plus a few more. Speciality reads from the prop. */
export type HeldProp = 'spoon' | 'duster' | 'can' | 'letter' | 'pouch' | 'book' | 'calendar' | 'pencil' | 'basket' | 'mug' | 'wrench' | 'none'

/** Babble voice, the same nine fields as voice/profiles.ts VoiceProfile, with hard ranges. */
export interface VoiceSpec {
  /** Base fundamental, Hz. 90 to 480. */
  pitch: number
  /** Per-word pitch spread, semitones. 0.5 to 7. */
  range: number
  /** Formant scale: 0.75 big and dark to 1.6 tiny and bright. */
  formant: number
  /** Syllables a second: 4 slow to 16 quick. */
  rate: number
  /** Breath noise, 0 to 0.6. */
  breath: number
  /** Vibrato depth, semitones, 0 to 1.2; rate 3 to 9 Hz. */
  wobble: number
  wobbleRate: number
  /** Source roll-off: 0.8 buzzy and bright to 2.6 round and dark. */
  tilt: number
  /** Level, 0.6 to 1.2. */
  gain: number
}

export interface VillagerSpec {
  /** Short name, one or two words; synthetic. */
  name: string
  role: Role
  /** One line the villager might say, for the bubble and the voice test. */
  bark: string
  body: {
    shape: BodyShape
    /** Body radius in model units, 0.11 to 0.24 (Dumpling 0.2, Tuft 0.14). */
    r: number
    /** Height factor of the body, 0.7 squat to 1.8 tall (Dumpling 0.9, Tuft 1.5). */
    tall: number
    /** Head size relative to body radius, 0.6 to 1.1. */
    head: number
    /** Leg length in model units, 0 (feet under the body) to 0.12. */
    legs: number
  }
  face: { snout: Snout; ears: Ears; /** Eye size 0.6 to 1.4 of the default button eye. */ eyes: number }
  tail: Tail
  back: Back
  pattern: Pattern
  /** Felt colours as #rrggbb: main felt, belly or muzzle, inner ears and accents. */
  palette: { felt: string; belly: string; inner: string; pattern?: string }
  accessories: Accessory[]
  prop: HeldProp
  /** Walk and idle personality. */
  gait: {
    /** Walking speed, m/s at model scale, 0.2 to 0.6. */
    speed: number
    /** Stride, model units per two steps, 0.14 to 0.34. */
    stride: number
    /** Vertical bob while walking, 0 to 0.08. */
    bob: number
    /** Posed on twos, like stop motion (true for the felt look). */
    stepped: boolean
    /** Idle sway and glance liveliness, 0 calm to 1 fidgety. */
    fidget: number
  }
  voice: VoiceSpec
}

/** The owner's accent, given to generation as a fixed input. */
export interface GenInput { description: string; owner: { name: string; accent: string } }

type Range = readonly [number, number]
export const RANGES = {
  body: { r: [0.11, 0.24], tall: [0.7, 1.8], head: [0.6, 1.1], legs: [0, 0.12] },
  eyes: [0.6, 1.4],
  gait: { speed: [0.2, 0.6], stride: [0.14, 0.34], bob: [0, 0.08], fidget: [0, 1] },
  voice: { pitch: [90, 480], range: [0.5, 7], formant: [0.75, 1.6], rate: [4, 16], breath: [0, 0.6], wobble: [0, 1.2], wobbleRate: [3, 9], tilt: [0.8, 2.6], gain: [0.6, 1.2] },
} as const satisfies Record<string, Range | Record<string, Range>>

export const ENUMS = {
  role: ['cook', 'gardener', 'tidier', 'keeper', 'tutor', 'messenger', 'maker', 'carer'],
  shape: ['pear', 'egg', 'bean', 'round', 'tall'],
  snout: ['none', 'button', 'muzzle', 'beak', 'long'],
  ears: ['none', 'floppy', 'round', 'pointed', 'tuft', 'long', 'antlers'],
  tail: ['none', 'stub', 'curl', 'long', 'fluffy'],
  back: ['none', 'shell', 'wings', 'quilt'],
  pattern: ['plain', 'belly', 'spots', 'stripes', 'patches'],
  accessory: ['none', 'glasses', 'hat', 'beret', 'bow', 'apron', 'satchel', 'headphones', 'flower'],
  prop: ['spoon', 'duster', 'can', 'letter', 'pouch', 'book', 'calendar', 'pencil', 'basket', 'mug', 'wrench', 'none'],
} as const
