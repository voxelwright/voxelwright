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
    fill: { color: '#7d8fd0', tint: 0.55, gain: 0.85, ground: '#4c4466' },
    rim: { color: '#a0b0ff', tint: 0.6, gain: 0.75 },
    practical: { color: '#ffb066', tint: 0.35, gain: 1.6 },
    exposure: 1.18,
  },
  surfaces: {
    wall: { color: '#c8cce0', tint: 0.2 },
    floor: {},
    view: { color: '#34468e', tint: 0.72, gain: 0.62 },
    beam: { color: '#8aa0e8', tint: 0.85, gain: 0.3 },
    glow: { color: '#ffc27a', tint: 0.3, gain: 1.25 },
    other: {},
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
  motion: {},
  costumes: { follow: true, hint: 'felt plush in dusk colours: slate blue, plum, a warm mustard scarf' },
  props: { hint: 'painterly, hand-made, the same warm kitchen things seen in the evening' },
}
