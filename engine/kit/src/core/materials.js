// Materials. A material is what a voxel is made of, and it says what the voxel is for.
// Each has a designed colour for day (light) and night (dark): the colour of its front face.
// The renderer derives the top, side and shadowed tones from it.

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// jitter: how much one voxel may differ in lightness from its neighbour (the material's grain).
// glow: how much the voxel emits at night (0 to 1). Glowing voxels also ignore shadow.
// grain: optional (x, y, z) => lightness offset, for materials with a pattern.
const defs = {
  // Enamel blue: things you act on.
  enamel: { day: '#0e22ff', night: '#2b3dff', jitter: 0.018 },
  // Signal yellow: where you are, what is on, what wants attention. It glows at night.
  signal: { day: '#fff600', night: '#fff600', jitter: 0.025, glow: 1 },
  // Chalk: surfaces that hold content.
  chalk: { day: '#fbfcff', night: '#3a4692', jitter: 0.006 },
  // Floor: what you type on, at the bottom of a field. Chalk by default; a look may darken it.
  floor: { day: '#fbfcff', night: '#3a4692', jitter: 0.006 },
  // Slate: the recessed floor of a well, a track, a socket.
  slate: { day: '#c3c9de', night: '#222963', jitter: 0.012 },
  // Steel: neutral parts and anything switched off.
  steel: { day: '#aab1c9', night: '#33375a', jitter: 0.018 },
  // Ivory: the knob of a switch. It stays light at night so the knob can always be found.
  ivory: { day: '#fbfcff', night: '#ccd1f2', jitter: 0.006 },
  // Walnut: structure that carries other things (shelves, frames, trays).
  walnut: {
    day: '#7c4a29', night: '#5a3520', jitter: 0.03,
    grain: (x, y, z) => 0.05 * Math.sin(y * 2.4 + Math.sin(x * 0.35 + z) * 1.7),
  },
  // Leaf, stem, soil, petal: the garden.
  leaf: { day: '#23a84b', night: '#2ec25c', jitter: 0.06 },
  stem: { day: '#5c8f2f', night: '#6aa53a', jitter: 0.04 },
  soil: { day: '#3d2a20', night: '#2a1c15', jitter: 0.07 },
  petal: { day: '#ff5c8a', night: '#ff6f98', jitter: 0.04 },
  // Brick: destructive actions and failures.
  brick: { day: '#d42c18', night: '#ff5340', jitter: 0.025 },
  // Lamp: a light source. Warm, always on at night.
  lamp: { day: '#fff3c4', night: '#ffe9a0', jitter: 0.01, glow: 1 },
  // Ink: lettering set into a surface.
  ink: { day: '#0a0f3d', night: '#eceefb', jitter: 0.0, seamless: true },
};

export const MATERIALS = {};
export const revision = { n: 0 }; // goes up when a material is added or replaced
export const MATERIAL_IDS = {};
let n = 0;
for (const [name, d] of Object.entries(defs)) {
  MATERIALS[name] = { name, id: n, day: hex(d.day), night: hex(d.night), jitter: d.jitter ?? 0.02, glow: d.glow ?? 0, grain: d.grain ?? null, seamless: !!d.seamless, hex: d };
  MATERIAL_IDS[n] = MATERIALS[name];
  n++;
}

/** Add a material, or replace one, at runtime. */
export function defineMaterial(name, d) {
  const prev = MATERIALS[name];
  const id = prev ? prev.id : Object.keys(MATERIALS).length;
  MATERIALS[name] = { name, id, day: hex(d.day), night: hex(d.night ?? d.day), jitter: d.jitter ?? 0.02, glow: d.glow ?? 0, grain: d.grain ?? null, seamless: !!d.seamless, hex: d };
  MATERIAL_IDS[id] = MATERIALS[name];
  revision.n++;
  return MATERIALS[name];
}

// The light. Directions are in voxel space: x right, y down, z toward the viewer.
export const LIGHTS = {
  day: {
    toLight: norm([-0.5, -0.7, 0.6]),
    sun: 0.9,
    // ambient by face: top, front, side, under
    ambient: { top: 0.64, front: 0.485, side: 0.33, under: 0.26 },
    ambientTint: [0.9, 0.93, 1.0], // shadowed faces lean cool
    highlight: [1.0, 1.0, 0.98],
    shadow: [0.04, 0.07, 0.38, 0.3], // colour and strength of shadow on the page
    seam: 0.05,
    glow: 0.0,
  },
  night: {
    toLight: norm([-0.5, -0.7, 0.6]),
    sun: 0.62,
    ambient: { top: 0.78, front: 0.646, side: 0.36, under: 0.3 },
    ambientTint: [0.82, 0.86, 1.0],
    highlight: [0.8, 0.85, 1.0],
    shadow: [0.0, 0.0, 0.05, 0.55],
    seam: 0.08,
    glow: 1.0,
  },
};

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// A small, stable hash so a voxel's grain never changes between frames or page loads.
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
