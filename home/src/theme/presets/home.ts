import type { Theme } from '../tokens'

/**
 * Today's home: golden hour, painted plaster, felt. Every value here is the
 * literal the plugins and postfx used before themes, so this theme changes nothing.
 */
export const HOME: Theme = {
  id: 'home',
  label: 'Golden hour',
  about: 'A warm painterly kitchen at golden hour: low sun through the window, cream plaster, oiled wood, felt.',
  light: { key: {}, fill: {}, rim: {}, practical: {}, exposure: 1.25 },
  surfaces: { wall: {}, floor: {}, view: {}, beam: {}, glow: {}, other: {} },
  fog: {},
  post: {
    bloom: { strength: 0.42, radius: 0.55, threshold: 0.78 },
    vignette: { amount: 0.4, inner: 0.38, outer: 0.95 },
    warm: [1.03, 0.99, 0.93],
    grain: 0.14,
    grade: { saturation: 1, contrast: 1, lift: [0, 0, 0] },
    veto: [],
    stages: [],
  },
  motion: {},
  costumes: { follow: true, hint: 'felt plush, hand-stitched, warm natural dyes' },
  props: { hint: 'painterly, hand-made, oiled wood, enamel, linen, warm and slightly worn' },
}
