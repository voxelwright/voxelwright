import type { Stage, Theme } from '../tokens'

const STAGES: Stage[] = [
  // Colour plates a hair out of register; the ink, drawn later, stays true.
  { kind: 'chroma', offset: 0.0005, angle: 35 },
  // Dots in the mid and dark tones, overprinted in a warm plum ink.
  { kind: 'halftone', cell: 150, angle: 45, strength: 0.8, ink: '#6a4a78', paper: '#fff4e0' },
  // Bold outlines from depth jumps, finer creases from normals.
  { kind: 'ink', width: 2, depth: 1, normal: 0.6, color: '#22161c' },
]

// ?drop=halftone,ink measures a stage's cost by leaving it out (debug only).
const drop = new Set((new URLSearchParams(location.search).get('drop') ?? '').split(','))

/**
 * The kitchen as a printed, inked comic page come to life: a bright low sun with
 * crisp shadow shapes, cool violet shade, saturated flat colour, round halftone
 * dots in the mid and dark tones, bold ink outlines, colour plates slightly out of
 * register, and villagers animated on twos.
 */
export const COMIC: Theme = {
  id: 'comic',
  label: 'Comic-book halftone',
  about: 'The warm kitchen as a printed comic come to life: flat saturated colour, crisp shadow shapes, halftone dots in the shade, bold ink lines, slightly mis-registered colour, characters on twos.',
  light: {
    // A stronger, warmer sun so light and shadow read as two shapes.
    key: { color: '#ffe0a8', tint: 0.25, gain: 1.3 },
    // Shade leans a little cool, so the warm sun reads against it.
    fill: { color: '#b0b4f0', tint: 0.18, gain: 0.9, ground: '#9a7a70' },
    rim: { color: '#ffb070', tint: 0.4 },
    practical: { color: '#ffc060', tint: 0.3, gain: 1.1 },
    exposure: 1.3,
  },
  surfaces: {
    // Plaster a touch warmer and flatter, so the walls print as one clean colour.
    wall: { color: '#fbecd2', tint: 0.5, gain: 1.1, roughness: 1 },
    // Print has no gloss: every surface is matte, so a lit face is one colour, not a sheen.
    // Metals stay metal (the fridge keeps its dark steel), only without the shine.
    floor: { roughness: 1 },
    view: { gain: 0.8 },
    // The sunbeam stays, a little lighter, so it prints as a shape rather than a haze.
    beam: { gain: 0.4 },
    glow: {},
    other: { roughness: 1 },
    contact: { paint: 'contact-deep', color: '#22161c', tint: 0.6 },
    trim: { roughness: 1 },
    backdrop: { roughness: 1 },
  },
  fog: { color: '#e8c8a0', tint: 0.3 },
  post: {
    bloom: { strength: 0.1, radius: 0.2, threshold: 0.95 },
    vignette: { amount: 0.18, inner: 0.5, outer: 1.05 },
    warm: [1.02, 1.0, 0.96],
    grain: 0,
    grade: { saturation: 1.22, contrast: 1.08, lift: [0, 0, 0.008] },
    veto: [],
    stages: STAGES.filter((s) => !drop.has(s.kind)),
  },
  motion: { characterFps: 12 },
  costumes: { follow: true, hint: 'flat bold colour blocks with a dark ink outline, simple graphic patterns, readable silhouettes' },
  props: { hint: 'graphic shapes with clean silhouettes, flat saturated colour faces and few small details, so they ink well' },
}
