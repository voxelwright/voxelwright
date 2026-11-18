// A look is the set of numbers the parts are drawn from: how high things stand, how loud the
// surface is, what each material's colour is, and, where a look needs it, another model for a
// part. CSS chooses the look, as it chooses the theme: `--vx-look: name` on any element holds for
// everything inside it, so two looks can stand side by side on one page.
//
//   defineLook('quiet', { quiet: true, materials: { chalk: { night: '#3b3f52' } } });
//   .that-corner { --vx-look: quiet; }

import { MATERIALS, LIGHTS, revision } from './materials.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export const BASE = {
  rise: 4,       // how far a thing you press stands above the page, in voxels
  travel: 3,     // how far a press pushes it down
  step: 1,       // the keycap step: the top is this much smaller all round (0 for none)
  slab: 2,       // things that hold content: a card, a list tile
  float: 4,      // things that float for a moment: a menu, a toast
  dialog: 6,
  well: 2,       // how deep a field is cut
  groove: 1,     // how deep a groove is cut
  round: 2,      // the corner step of a slab that holds content (controls step by one)
  icons: null,   // name -> rows: icons drawn for this look's voxel, where the kit's are too large
  inlay: false,  // true: an icon is set into the face, not stood on it (a relief one voxel high is too much at 8 px)
  seam: 1,       // times the light's seam: 0 for no grid at all
  grain: 1,      // times each material's grain
  quiet: false,  // true: a voxel that shows only its front face has no seam and no grain,
                 // so a face you read from is plain and the grid is left to edges and sides
  materials: {}, // name -> { day, night, jitter, glow }: colours this look changes
  light: null,   // { day: {...}, night: {...} }: what this look changes in each theme's light (materials.js LIGHTS);
                 // glow above 0 by day lets its lit parts shine in daylight too
  parts: {},     // part name -> { build, pose, pad }: another model for that part
};

export const LOOKS = { default: BASE };

/** Name a look. What it leaves out comes from the look named in `from`, or from the default. */
export function defineLook(name, look = {}) {
  const from = LOOKS[look.from] ?? BASE;
  const made = { ...from, ...look, materials: { ...from.materials, ...look.materials }, parts: { ...from.parts, ...look.parts } };
  delete made.from; delete made._table; delete made._rev; delete made._lights;
  LOOKS[name] = made;
  return made;
}

/** The look an element stands in, from its computed style. */
export function lookOf(cs) {
  return LOOKS[cs.getPropertyValue('--vx-look').trim()] ?? BASE;
}

/** A look's materials by id: the kit's own, with this look's colours laid over them. */
export function tableOf(look) {
  if (look._table && look._rev === revision.n) return look._table;
  const names = Object.keys(MATERIALS);
  const table = [];
  for (const name of names) {
    const m = MATERIALS[name], o = look.materials[name];
    table[m.id] = o ? { ...m, day: o.day ? hex(o.day) : m.day, night: o.night ? hex(o.night) : m.night, jitter: o.jitter ?? m.jitter, glow: o.glow ?? m.glow } : m;
  }
  look._table = table; look._rev = revision.n;
  return table;
}

/** The light for a theme as this look wants it. */
export function lightOf(look, theme) {
  const own = look.light?.[theme];
  if (look.seam === 1 && !own) return LIGHTS[theme];
  return ((look._lights ??= {})[theme] ??= { ...LIGHTS[theme], ...own, seam: (own?.seam ?? LIGHTS[theme].seam) * look.seam });
}
