import type { Theme } from '../tokens'

/**
 * The kitchen on a summer afternoon in a painted countryside: high warm-white
 * daylight, a sky-blue fill and green bounce so shadows stay gentle, cream gouache
 * walls, lush greens, a watercolour sky with towering clouds through the window,
 * and paper grain with pigment pooling at the edges of every shape.
 */
export const PASTORAL: Theme = {
  id: 'pastoral',
  label: 'Hand-painted pastoral',
  about: 'A summer afternoon in a painted countryside: soft high daylight, towering clouds and green hills through the window, watercolour on warm paper.',
  light: {
    // The low golden sun becomes high summer daylight, a little softer so shadows stay gentle.
    key: { color: '#fff4dc', tint: 0.7, gain: 0.75, soften: 2.5 },
    // The sky fills the shadows blue and the grass bounces green up from below.
    fill: { color: '#eef0e8', tint: 0.45, gain: 1.4, ground: '#b4c27a' },
    rim: { color: '#fff4dc', tint: 0.5, gain: 0.9 },
    // Daytime: the lamp is lit but no longer the brightest thing in the room.
    practical: { color: '#ffe2b0', tint: 0.4, gain: 0.7 },
    exposure: 1.45,
  },
  surfaces: {
    wall: { paint: 'gouache-wall', gain: 1.02 },
    floor: { paint: 'gouache-planks', gain: 1.0, roughness: 0.95 },
    view: { paint: 'pastoral-view', gain: 0.9 },
    beam: { color: '#fff1d0', tint: 0.6, gain: 1.0 },
    glow: {},
    // Painted, not polished: metal reads as enamel, so the steel fridge takes the room's warm light. No roughness here:
    // 'other' includes the window glass, which a high roughness frosts over.
    other: { color: '#f6e0bc', tint: 0.12, gain: 1.03, metalness: 0.1 },
    // The yard and the worktable beyond it become lush summer meadow.
    backdrop: { paint: 'gouache-meadow', gain: 0.92 },
    foliage: { paint: 'gouache-leaves', gain: 1.25 },
  },
  sky: { paint: 'pastoral-sky' },
  // Unpainted paper: in the dollhouse view the meadow fades out to the sheet's margin, as a watercolour does.
  fog: { color: '#f4ecdc', tint: 1 },
  post: {
    bloom: { strength: 0.35, radius: 0.6, threshold: 0.85 },
    vignette: { amount: 0.18, inner: 0.45, outer: 1.0 },
    warm: [1.0, 1.0, 0.99],
    grain: 0,
    grade: { saturation: 1.15, contrast: 1.06, lift: [0.008, 0.008, 0.01] },
    veto: [],
    // Paper alone: the brush stage (Kuwahara) smeared the painted textures and photos into blocks.
    stages: [{ kind: 'paper', grain: 0.7, edges: 0.9, tint: '#fdf7ea', shadow: '#9a8ccc' }],
  },
  motion: {},
  costumes: { follow: true, hint: 'summer cotton and linen in faded indigo, cream and leaf green, straw hats, rolled sleeves' },
  props: { hint: 'hand-painted countryside kitchenware: glazed earthenware, wicker, gingham, fresh flowers in jars, painted in soft gouache' },
}
