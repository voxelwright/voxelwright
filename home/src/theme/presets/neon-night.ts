import type { Theme } from '../tokens'

/**
 * The same kitchen at night in a rain-soaked neon city: cool moonlight and city
 * glow through the window, a deep blue-violet fill, magenta and cyan accents
 * carried by emissive surfaces and bloom, a wet floor, a violet fog.
 */
export const NEON_NIGHT: Theme = {
  id: 'neon-night',
  label: 'Neon night',
  about: 'The kitchen at night in a rainy neon city: moonlight and city glow through the window, violet shadows, magenta and cyan light, a wet floor.',
  light: {
    // The sun becomes a faint cool moonlight: any brighter and it glares off the wet floor.
    key: { color: '#5fc8ff', tint: 0.9, gain: 0.03 },
    // A violet sky fill over a warm ground bounce, so the household keeps its colours.
    fill: { color: '#3d5cff', tint: 0.8, gain: 0.95, ground: '#6a3a30' },
    rim: { color: '#ff3fbf', tint: 0.85, gain: 0.9 },
    // The lamp turns neon magenta.
    practical: { color: '#ff5fb0', tint: 0.6, gain: 1.2 },
    exposure: 1.1,
  },
  surfaces: {
    wall: { color: '#2c2f45', tint: 0.75, gain: 0.55, roughness: 0.9 },
    // Rough enough that the lamp spreads into a sheen instead of a hot spot; SSR keeps it wet.
    floor: { color: '#1c1a2a', tint: 0.6, gain: 0.7, roughness: 0.42, metalness: 0.45 },
    // A painted night city replaces the garden; lifted a little so its lit windows catch the bloom.
    view: { paint: 'night-city', gain: 1.45 },
    beam: { color: '#6a7cff', tint: 0.9, gain: 0 },
    glow: { color: '#ff3ab8', tint: 0.85, gain: 0.8 },
    other: { color: '#4a4a90', tint: 0.15, gain: 0.95 },
    contact: { paint: 'contact-deep', color: '#1a1030', tint: 0.5 },
    // Edges (skirting, window frames, the dollhouse's wall caps and base) turn charcoal with a faint
    // cyan cast: brighter, the caps read as glowing paint bands and pull the eye from the table.
    trim: { color: '#181826', tint: 0.9, emissive: '#2ee8ff', glow: 0.12, roughness: 0.4 },
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
    // The wet floor: screen-space reflections on the high and medium tiers.
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
