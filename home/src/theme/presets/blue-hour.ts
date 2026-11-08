import type { Theme } from '../tokens'

/**
 * The same kitchen just after sunset: the sun is gone, the sky through the window
 * is deep blue, the room fills with cool light and the lamp's warm pool carries it.
 * Same post chain as the home's, so switching between the two is a blend, not a rebuild.
 */
export const BLUE_HOUR: Theme = {
  id: 'blue-hour',
  label: 'Blue hour',
  about: 'The kitchen just after sunset: cool blue light through the window, the lamp glowing warm, the room settling down for the evening.',
  light: {
    key: { color: '#8aa2e8', tint: 0.75, gain: 0.32 },
    // The sky fill cooler and lower, so the walls fall off into blue-grey away from the lamp.
    fill: { color: '#6a80d8', tint: 0.7, gain: 0.64, ground: '#4c4466' },
    rim: { color: '#a0b0ff', tint: 0.6, gain: 0.75 },
    practical: { color: '#ffa850', tint: 0.4, gain: 2.1 },
    exposure: 1.18,
  },
  surfaces: {
    wall: {},
    floor: {},
    // Dusk outside: the garden goes deep blue and dim, so the lamp carries the room.
    view: { color: '#22306a', tint: 0.88, gain: 0.48 },
    beam: { color: '#8aa0e8', tint: 0.85, gain: 0.3 },
    glow: { color: '#ffc27a', tint: 0.3, gain: 1.25 },
    other: {},
    contact: { paint: 'contact-deep', color: '#2a3050', tint: 0.5 },
  },
  fog: { color: '#4a5280', tint: 0.6 },
  post: {
    bloom: { strength: 0.5, radius: 0.55, threshold: 0.74 },
    vignette: { amount: 0.48, inner: 0.36, outer: 0.95 },
    warm: [0.99, 0.99, 1.03],
    grain: 0.14,
    grade: { saturation: 0.96, contrast: 1.04, lift: [0.004, 0.006, 0.016] },
    veto: [],
    stages: [],
  },
  // A street at dusk: neighbours' lit windows, warm streetlamps, a blue lawn (./world/twilight.ts).
  world: 'twilight-street',
  motion: {},
  costumes: { follow: true, hint: 'felt plush in dusk colours: slate blue, plum, a warm mustard scarf' },
  props: { hint: 'painterly, hand-made, the same warm kitchen things seen in the evening' },
}
