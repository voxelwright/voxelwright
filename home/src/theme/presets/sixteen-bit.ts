import type { Theme } from '../tokens'

/**
 * The kitchen as early-90s console pixel art: about 225 rows of even pixels, a
 * 38-colour palette of short hue-shifted ramps (shadows lean plum and blue,
 * highlights lean cream and gold) built around the home's own wood, plaster,
 * greens and felt, ordered dithering, and one-pixel outlines.
 */
export const SIXTEEN_BIT: Theme = {
  id: 'sixteen-bit',
  label: '16-bit',
  about: 'The warm kitchen as early-90s console pixel art: chunky even pixels, a small hue-shifted palette, ordered dithering and crisp outlines.',
  light: {
    key: { color: '#ffd9a0', tint: 0.25, gain: 0.95 },
    fill: { color: '#9aa8d8', tint: 0.3, ground: '#8a6a7a' },
    rim: {},
    practical: { color: '#ffc070', tint: 0.2, gain: 1.4 },
    exposure: 1.42,
  },
  // The additive light shafts quantise into stray diagonal lines, so their colour goes to zero (the
  // pixel stage also ignores the normals they write, which drew thin bright lines along the shafts).
  surfaces: {
    // Three value groups: greige plaster in the middle, darker honey wood below it, paint and paper on top.
    wall: { color: '#d4d4d4', tint: 0.4, paint: 'pixel-plaster' },
    // Broad boards in three values with one-pixel seams: the fine oak grain snaps to one flat brown at 225 rows.
    floor: { color: '#a8743e', tint: 0.2, gain: 0.84, paint: 'pixel-planks' },
    view: {},
    beam: { gain: 0 },
    glow: {},
    other: {},
    // A plum drop shadow under every piece, dense enough to survive the palette snap.
    contact: { paint: 'contact-deep', color: '#3a2630', tint: 0.5 },
  },
  world: 'pixel-lot',
  fog: { color: '#c8a890', tint: 0.3 },
  post: {
    bloom: { strength: 0.35, radius: 0.3, threshold: 0.95 },
    vignette: { amount: 0.25, inner: 0.45, outer: 1.0 },
    warm: [1.01, 0.99, 0.96],
    grain: 0,
    grade: { saturation: 1.15, contrast: 1.1, lift: [0, 0, 0] },
    // Art pixels snap to one palette colour each: nothing soft (occlusion, the lens's blur) under them.
    veto: ['traa', 'gtao', 'dof'],
    stages: [{
      kind: 'pixel',
      height: 225,
      dither: 0.3,
      outline: 0.8,
      crease: 0,
      samples: 0,
      palette: [
        // warm neutrals: ink, wood and plaster shadow to cream highlight
        '#1e1424', '#3a2630', '#5a3a3a', '#7c5444', '#a07050', '#b8865a', '#cc9e6c', '#dfba86', '#eed6a8', '#fbf0d6',
        // plaster, a low-chroma rosy greige kept apart from the wood's tans, leaning mauve in shadow
        '#6a5a60', '#8a7876', '#a8968e', '#c4b4a8', '#dacdc0', '#ece4d8',
        // clean whites for paint, pages and cushions
        '#f6f2e8', '#fffdf6',
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
