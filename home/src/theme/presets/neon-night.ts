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
    // The sun becomes cool moonlight and city glow, much dimmer.
    key: { color: '#5fc8ff', tint: 0.9, gain: 0.14 },
    fill: { color: '#3d5cff', tint: 0.85, gain: 0.8, ground: '#3a1a5a' },
    rim: { color: '#ff3fbf', tint: 0.85, gain: 0.9 },
    // The lamp turns neon magenta.
    practical: { color: '#ff4fc0', tint: 0.65, gain: 1.5 },
    exposure: 1.1,
  },
  surfaces: {
    wall: { color: '#2c2f45', tint: 0.75, gain: 0.55, roughness: 0.9 },
    floor: { color: '#1c1a2a', tint: 0.6, gain: 0.7, roughness: 0.2, metalness: 0.45 },
    // A painted night city replaces the garden; lifted a little so its lit windows catch the bloom.
    view: { paint: 'night-city', gain: 1.25 },
    beam: { color: '#6a7cff', tint: 0.9, gain: 0.18 },
    glow: { color: '#ff3ab8', tint: 0.85, gain: 1.2 },
    other: { color: '#4a4a90', tint: 0.25, gain: 0.75 },
    // Neon edges: skirting, window frames and the dollhouse's wall caps become cyan tubes.
    trim: { color: '#101018', tint: 0.9, emissive: '#2ef2ff', glow: 1.0, roughness: 0.4 },
    // The yard and the worktable become dark wet ground.
    backdrop: { color: '#24183e', tint: 0.85, gain: 0.45, roughness: 0.3, metalness: 0.3 },
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
  motion: {},
  costumes: { follow: true, hint: 'rain shells and knit layers in charcoal, with thin reflective magenta and cyan piping' },
  props: { hint: 'night city kitchenware: dark lacquer, brushed steel, frosted acrylic, thin neon edge lights in magenta and cyan' },
}
