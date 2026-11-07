import type { Theme } from '../tokens'

/**
 * The kitchen as early-90s console pixel art: about 225 rows of even pixels, a
 * 37-colour palette of short hue-shifted ramps (shadows lean plum and blue,
 * highlights lean cream and gold) built around the home's own wood, plaster,
 * greens and felt, ordered dithering, and one-pixel outlines.
 */
export const SIXTEEN_BIT: Theme = {
  id: 'sixteen-bit',
  label: '16-bit',
  about: 'The warm kitchen as early-90s console pixel art: chunky even pixels, a small hue-shifted palette, ordered dithering and crisp outlines.',
  light: {
    key: { color: '#ffd9a0', tint: 0.25, gain: 1.1 },
    fill: { color: '#9aa8d8', tint: 0.3, ground: '#8a6a7a' },
    rim: {},
    practical: { color: '#ffc070', tint: 0.2 },
    exposure: 1.3,
  },
  // The additive light shafts quantise into stray diagonal lines, so their colour goes to zero. Thin
  // lines along the shafts still show (seen November 6); likely the crease pass reading blended normals.
  surfaces: { wall: {}, floor: {}, view: {}, beam: { gain: 0 }, glow: {}, other: {} },
  fog: { color: '#c8a890', tint: 0.3 },
  post: {
    bloom: { strength: 0.42, radius: 0.55, threshold: 0.78 },
    vignette: { amount: 0.25, inner: 0.45, outer: 1.0 },
    warm: [1.03, 0.99, 0.93],
    grain: 0,
    grade: { saturation: 1.4, contrast: 1.1, lift: [0, 0, 0] },
    veto: ['traa'],
    stages: [{
      kind: 'pixel',
      height: 225,
      dither: 0.04,
      outline: 0.8,
      crease: 0.25,
      samples: 0,
      palette: [
        // warm neutrals: ink, wood and plaster shadow to cream highlight
        '#1e1424', '#3a2630', '#5a3a3a', '#7c5444', '#a07050', '#b8865a', '#cc9e6c', '#dfba86', '#eed6a8', '#fbf0d6',
        // plaster, warm grey in the light and leaning mauve in shadow
        '#7a6e72', '#9c8e88', '#a8927a', '#bcac9c', '#c4ac8c', '#d4c6b2', '#e6dccb',
        // brick, tomato, orange, apricot, and a soft gold
        '#6c2024', '#a83a2c', '#d8603a', '#f09a58', '#ecc66a',
        // leaf greens
        '#24402e', '#2e5a3a', '#3e6a34', '#6a9a3a', '#a6c858',
        // sage paint
        '#7c9a78', '#a8c0a0',
        // blues for sky, cool shade and rug stripes
        '#2a3050', '#48608c', '#6a8ec0', '#7894bc', '#b6d0e6',
        // the fridge's cool dark greys, and one pink for felt and flowers
        '#403c48', '#5c5866', '#d07090',
      ],
    }],
  },
  motion: {},
  costumes: { follow: true, hint: 'chunky pixel-art sprites: two-tone felt with a dark outline, big readable shapes' },
  props: { hint: 'simple bold shapes with flat colour faces and few details, so they read at 225 rows' },
}
