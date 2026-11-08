import type { Theme } from '../tokens'

/**
 * The same kitchen at night in a rain-soaked neon city: cool moonlight and city
 * glow through the window, a deep blue-violet fill, magenta and cyan accents
 * carried by emissive surfaces and bloom, wet streets outside, a violet fog.
 */
export const NEON_NIGHT: Theme = {
  id: 'neon-night',
  label: 'Neon night',
  about: 'The kitchen at night in a rainy neon city: moonlight and city glow through the window, violet shadows, magenta and cyan light, wet streets outside.',
  light: {
    // The sun becomes a cool city light through the window, spilling cyan on the sill, the chairs and
    // the table's far edge. The floor is matte now, so it no longer glares there.
    key: { color: '#5fc8ff', tint: 0.9, gain: 0.1 },
    // A violet sky fill over a warm ground bounce, so the household keeps its colours.
    fill: { color: '#3d5cff', tint: 0.8, gain: 0.95, ground: '#6a3a30' },
    rim: { color: '#ff3fbf', tint: 0.85, gain: 0.9 },
    // The lamp turns neon magenta.
    practical: { color: '#ff5fb0', tint: 0.6, gain: 1.2 },
    exposure: 1.1,
  },
  surfaces: {
    wall: { color: '#2c2f45', tint: 0.75, gain: 0.55, roughness: 0.9 },
    // An indoor floor, not the street: dark stained boards, matte and not metallic, so the
    // screen-space reflections (gated by metalness) stay outside and the magenta rim cannot
    // lay a specular spill across the floor. The wood's grain still shows through the stain.
    floor: { color: '#2a2030', tint: 0.45, gain: 0.78, roughness: 0.78, metalness: 0 },
    // A painted night city replaces the garden; lifted a little so its lit windows catch the bloom.
    view: { paint: 'night-city', gain: 1.45 },
    beam: { color: '#6a7cff', tint: 0.9, gain: 0 },
    glow: { color: '#ff3ab8', tint: 0.85, gain: 0.8 },
    other: { color: '#4a4a90', tint: 0.15, gain: 0.95 },
    contact: { paint: 'contact-deep', color: '#1a1030', tint: 0.5 },
    // Edges (skirting, window frames, the dollhouse's wall caps and base) turn charcoal with the
    // faintest teal cast, matte: brighter or glossier, the caps read as a selection outline.
    trim: { color: '#181826', tint: 0.9, emissive: '#2ab8c8', glow: 0.04, roughness: 0.85 },
    // The yard and the worktable become dark wet ground.
    backdrop: { color: '#160f2a', tint: 0.9, gain: 0.3, roughness: 0.3, metalness: 0.3 },
  },
  fog: { color: '#2a1846', tint: 1 },
  post: {
    bloom: { strength: 0.7, radius: 0.4, threshold: 0.8 },
    vignette: { amount: 0.55, inner: 0.32, outer: 0.95 },
    warm: [0.96, 0.97, 1.06],
    grain: 0.16,
    grade: { saturation: 1.15, contrast: 1.08, lift: [0.01, 0.006, 0.022] },
    sky: '#140a24',
    // The wet street: screen-space reflections on the high and medium tiers, on metallic surfaces only.
    reflect: { maxDistance: 4, thickness: 0.15, resolutionScale: 0.33, strength: 1.6 },
    veto: [],
    stages: [],
  },
  // The house stands on a wet city block (./world/neon.ts); chrome and wet satin by material (./shade).
  world: 'neon-city',
  shade: 'wet',
  motion: {},
  costumes: { follow: true, hint: 'rain shells and knit layers in charcoal, with thin reflective magenta and cyan piping' },
  props: { hint: 'night city kitchenware: dark lacquer, brushed steel, frosted acrylic, thin neon edge lights in magenta and cyan' },
}
