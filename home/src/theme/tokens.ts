// A theme is data: tokens every plugin's output is read through. Nothing here
// runs model output; a theme written by a model is checked by `check()` in
// ./index.ts before it reaches the scene.

/** A colour written as #rrggbb (sRGB). */
export type Hex = string

/**
 * How a theme moves one role towards its look. `color` is where the role's own
 * colour is pulled, `tint` how far (0 keeps the plugin's colour, 1 replaces it),
 * `gain` a brightness multiplier. Unset fields leave the plugin's value alone.
 */
export interface Shift {
  color?: Hex
  tint?: number
  gain?: number
}

/** Lights by role. Each plugin's light keeps its own colour and level; the theme shifts them. */
export interface Lighting {
  /** The shadow-casting light: the sun through the window, the living room's key. `soften` scales its shadow's blur radius (unset keeps the plugin's). */
  key: Shift & { soften?: number }
  /** Hemisphere fill. `ground` shifts the hemisphere's ground colour. */
  fill: Shift & { ground?: Hex }
  /** Directional lights without shadows: the rim behind the furniture. */
  rim: Shift
  /** Point and spot lights: lamps, the glow in the sideboard, grow lights. */
  practical: Shift
  /** Tone-mapping exposure (today 1.25). */
  exposure: number
}

/** Materials by role. `roughness` and `metalness` replace the plugin's values when set. */
export interface Surface extends Shift {
  roughness?: number
  metalness?: number
  /** Makes a lit role glow: its emissive becomes this colour times `glow` (neon trim). Unset leaves the emissive alone. */
  emissive?: Hex
  glow?: number
  /** Repaints the role's texture with a painter from ../paint.ts by name, e.g. 'night-city' for the view. */
  paint?: string
}

export interface Surfaces {
  /** Plaster walls (tagged `userData.themeRole = 'wall'`). */
  wall: Surface
  /** Floors (tagged `'floor'`). */
  floor: Surface
  /** The painted view through the window (tagged `'view'`). */
  view: Surface
  /** Unlit additive light shapes: the sunbeam, the lamp's pool (tagged `'beam'`). */
  beam: Surface
  /** Anything glowing on its own: bulbs, screens. Shifts the emissive colour. Found by a non-black emissive. */
  glow: Surface
  /** Everything else: furniture, props, villagers' felt, the yard. */
  other: Surface
  /** Thin edges of the house: skirting, window frames, the dollhouse's wall caps (tagged `'trim'`). Falls back to `other`. */
  trim?: Surface
  /** The ground beyond the house in the dollhouse view: the yard's lawn and the worktable (tagged `'backdrop'`). Falls back to `other`. */
  backdrop?: Surface
  /** Leaves: the garden's trees and shrubs (tagged `'foliage'`). Falls back to `other`. A `paint` here lays a texture on maps the leaves never had. */
  foliage?: Surface
}

/**
 * Post-processing. The first six reproduce today's chain exactly when left at
 * their defaults. `stages` are extra looks appended in order (see ./fx).
 */
export interface Post {
  bloom: { strength: number; radius: number; threshold: number }
  /** Dark corners: amount 0 to 1 and the radii it ramps between. */
  vignette: { amount: number; inner: number; outer: number }
  /** A colour multiplier over the whole frame (today a warm 1.03, 0.99, 0.93). */
  warm: [number, number, number]
  /** Film grain strength (today 0.14 above the low tier). */
  grain: number
  /** Colour grade in display terms; identity is saturation 1, contrast 1, no lift. */
  grade: { saturation: number; contrast: number; lift: [number, number, number] }
  /** Replace what is seen at the far plane (the backdrop beyond the room) with this colour. */
  sky?: Hex
  /** Screen-space reflections on metallic surfaces (a wet floor), on tiers that render normals and velocity. */
  reflect?: { maxDistance: number; thickness: number; resolutionScale: number; strength: number }
  /** Features this look turns off whatever the tier, e.g. 'traa' for a pixel look. */
  veto: string[]
  stages: Stage[]
}

/** Extra post stages, implemented in ./fx. Each one is optional and named by what it does. */
export type Stage =
  | {
    kind: 'pixel'
    /** Rows of art pixels wanted; the cell is a whole number of device pixels, so the real count is near this. */
    height: number
    /** Colours the frame is reduced to, matched by perceived difference (OKLab). */
    palette: Hex[]
    /** Ordered-dither spread in display units (about 1 / colours per ramp). */
    dither: number
    /** Darkening of an object's outline where it stands in front of something (0 to 1). */
    outline?: number
    /** Brightening of convex creases, where two faces of one object meet (0 to 1). */
    crease?: number
    /** MSAA samples on the low-resolution scene; 0 gives the hardest pixel edges. */
    samples?: number
  }
  /** Comic-book halftone dots by tone, in display space. Implemented in ./fx/halftone.ts. */
  | { kind: 'halftone'; cell: number; angle: number; strength: number; ink?: Hex; paper?: Hex }
  /** Ink lines from depth and normal edges. Implemented in ./fx/ink.ts. */
  | { kind: 'ink'; width: number; depth: number; normal: number; color?: Hex }
  /** Mis-registered colour plates (chromatic offset). Implemented in ./fx/chroma.ts. */
  | { kind: 'chroma'; offset: number; angle?: number }
  /** Painterly smoothing (a Kuwahara-style filter): flattens texture into brush patches. Implemented in ./fx/brush.ts. */
  | { kind: 'brush'; radius: number; strength: number }
  /** Paper grain and pigment pooling at edges, for watercolour. Implemented in ./fx/paper.ts. `shadow` cools the darks towards a pigment's hue. */
  | { kind: 'paper'; grain: number; edges: number; tint?: Hex; shadow?: Hex }

export interface Theme {
  /** Stable id, lowercase with dashes; also the ?theme= value. */
  id: string
  /** Named by its look, never by a film, studio or artist. */
  label: string
  /** One plain line, for the swatch book and for a model writing a new one. */
  about: string
  light: Lighting
  surfaces: Surfaces
  /** Fog colour shift; the rooms keep their own distances. */
  fog: Shift
  post: Post
  /**
   * A painted sky the theme stands around the house, like a diorama's curved backdrop card,
   * so the dollhouse view has a sky and a horizon. `paint` names a painter in ../paint.ts. Unset: none.
   */
  sky?: { paint: string }
  /** Character animation: poses per second for villagers (12 is "on twos"); unset keeps each direction's own. */
  motion: { characterFps?: number }
  /** Villagers follow the theme unless they keep their costume (per villager, later). */
  costumes: { follow: boolean; hint: string }
  /** What newly made props should look like, handed to the prop maker's prompt. */
  props: { hint: string }
}
