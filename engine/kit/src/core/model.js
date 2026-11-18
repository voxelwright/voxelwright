// A model is a few rigid parts; a part is a set of voxels on the integer grid.
// Axes: x right, y down, z toward the viewer. z = 0 is the page; nothing goes below it.

import { MATERIALS, hash3 } from './materials.js';
import { BASE, tableOf } from './look.js';
import { FONTS, raster } from './fonts/index.js';

// x: 11 bits (-1024..1023), y: 13 bits (-4096..4095, so a long list fits), z: 8 bits (-128..127)
const key = (x, y, z) => ((x + 1024) << 21) | ((y + 4096) << 8) | (z + 128);

// Face order must match the cube geometry in gl.js: +x, -x, +y, -y, +z, -z.
// For each face: its normal and the two in-plane axes used for corner occlusion.
const FACES = [
  { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  { n: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
];
// Corner order per face: (-a,-b), (+a,-b), (+a,+b), (-a,+b). Matches gl.js.
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

function neighborhoodKey(cells, ground) {
  if (cells.size < 1024) return null;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (const cell of cells.keys()) {
    const x = cell >>> 21, y = cell >>> 8 & 8191, z = cell & 255;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
  }
  const width = xmax - xmin + 3, height = ymax - ymin + 3, depth = zmax - zmin + 3;
  if (depth > 32 || width * height > cells.size * 2 || xmin === 0 || xmax === 2047 || ymin === 0 || ymax === 8191 || zmin === 0 || zmax === 255) return null;
  const columns = new Uint32Array(width * height);
  if (ground && zmin <= 128) columns.fill(2 ** Math.min(depth, 129 - zmin) - 1);
  const index = (cell) => ((cell >>> 8 & 8191) - ymin + 1) * width + (cell >>> 21) - xmin + 1;
  for (const cell of cells.keys()) columns[index(cell)] |= 1 << ((cell & 255) - zmin + 1);
  const row = (at, shift) => (columns[at - 1] >>> shift & 7) | (columns[at] >>> shift & 7) << 3 | (columns[at + 1] >>> shift & 7) << 6;
  return (cell) => {
    const at = index(cell), shift = (cell & 255) - zmin;
    return row(at - width, shift) | row(at, shift) << 9 | row(at + width, shift) << 18;
  };
}

export class Part {
  constructor(name) {
    this.name = name;
    this.cells = new Map(); // key -> material id
    this.tx = 0; this.ty = 0; this.tz = 0; // pose, in voxels
    this.fx = null; // per-voxel effect (see motion.js)
    this.hidden = false;
    this.count = 0;
    this.grounded = true; // rests on the page: the page occludes its underside
    this.masked = false;  // true if voxels show and hide one by one (see scales)
  }

  /** One voxel. birth (0 to 1) is when it appears as the part grows; see grow(). */
  plot(x, y, z, mat, birth) {
    const k = key(x, y, z);
    this.cells.set(k, MATERIALS[mat].id);
    if (birth !== undefined) { (this.births ??= new Map()).set(k, birth); this.masked = true; }
    return this;
  }

  /**
   * Show the voxels born by g (0 to 1). Each takes about 140 ms to appear once its moment has come
   * (and to go, if g falls back), however fast g moves. Pass dt in seconds; dt of 0 sets it at once.
   * Returns true while any voxel is still on its way.
   */
  grow(g, dt = 0) {
    const sc = this.scales, b = this.birth;
    if (!sc || !b) return false;
    const shown = (this.shown ??= new Float32Array(this.count));
    const rate = dt > 0 ? dt / 0.14 : 1;
    let busy = false;
    for (let i = 0; i < this.count; i++) {
      const want = g >= b[i] ? 1 : 0;
      let p = shown[i];
      if (p !== want) {
        p = want > p ? Math.min(1, p + rate) : Math.max(0, p - rate * 1.6);
        shown[i] = p;
        if (p !== want) busy = true;
      }
      // a gentle start, a small overshoot as it lands
      sc[i] = p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p) * (1 + 1.2 * p) + 0.1 * Math.sin(Math.PI * p) * p * p;
    }
    return busy;
  }

  /** Fill a box. x, y, z is its top-left-back corner; w, h, d its size. */
  box(x, y, z, w, h, d, mat) {
    const id = MATERIALS[mat].id;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.cells.set(key(x + i, y + j, z + k), id);
    return this;
  }

  /** A box with stepped corners. r = 1 drops the four corner columns; r = 2 steps twice. */
  slab(x, y, z, w, h, d, mat, r = 1) {
    this.box(x, y, z, w, h, d, mat);
    if (r > 0) this.notch(x, y, z, w, h, d, r);
    return this;
  }

  notch(x, y, z, w, h, d, r = 1) {
    // quarter-circle steps: for r = 1 one voxel; r = 2: 2 + 1; r = 3: 3 + 2 + 1 (minus the diagonal).
    const cut = r === 1 ? [[0, 0]] : r === 2 ? [[0, 0], [1, 0], [0, 1]] : [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2], [1, 1]];
    for (const [cx, cy] of cut) {
      for (let k = 0; k < d; k++) {
        this.cells.delete(key(x + cx, y + cy, z + k));
        this.cells.delete(key(x + w - 1 - cx, y + cy, z + k));
        this.cells.delete(key(x + cx, y + h - 1 - cy, z + k));
        this.cells.delete(key(x + w - 1 - cx, y + h - 1 - cy, z + k));
      }
    }
    return this;
  }

  carve(x, y, z, w, h, d) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.cells.delete(key(x + i, y + j, z + k));
    return this;
  }

  /**
   * Lettering. y is the cap line; scale is voxels per glyph cell; font is a glyph set's id
   * ("block", "sign", "sentence"). Returns the width used, in voxels.
   */
  text(str, x, y, z, d, mat, scale = 1, font = 'sign') {
    const { cells, width } = raster(FONTS[font], str, scale);
    for (const [cx, cy] of cells) this.box(x + cx, y + cy, z, 1, 1, d, mat);
    return width;
  }

  has(x, y, z) {
    return this.cells.has(key(x, y, z));
  }

  /** Turn the cells into flat arrays the renderer can draw. Hidden interior voxels are dropped. */
  bake(theme, look) {
    const cells = this.cells;
    const grounded = this.grounded;
    const occ = (x, y, z) => (grounded && z < 0 && !this.sunk) || cells.has(key(x, y, z));
    const signature = neighborhoodKey(cells, grounded && !this.sunk), cache = new Map();
    const surface = (x, y, z) => {
      // exposed at all?
      if (occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z) && occ(x, y, z + 1) && occ(x, y, z - 1)) return null;
      let lo = 0, hi = 0;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        let bits = 0;
        for (let c = 0; c < 4; c++) {
          const [sa, sb] = CORNERS[c];
          const s1 = occ(x + F.n[0] + F.a[0] * sa, y + F.n[1] + F.a[1] * sa, z + F.n[2] + F.a[2] * sa);
          const s2 = occ(x + F.n[0] + F.b[0] * sb, y + F.n[1] + F.b[1] * sb, z + F.n[2] + F.b[2] * sb);
          const cr = occ(x + F.n[0] + F.a[0] * sa + F.b[0] * sb, y + F.n[1] + F.a[1] * sa + F.b[1] * sb, z + F.n[2] + F.a[2] * sa + F.b[2] * sb);
          const level = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (cr ? 1 : 0);
          bits |= level << (c * 2);
        }
        if (f < 4) lo |= bits << (f * 8); else hi |= bits << ((f - 4) * 8);
      }
      const frontOnly = !occ(x, y, z + 1) && occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z);
      return [lo, hi, +frontOnly];
    };
    const pos = [], ao = [], mats = [], births = [], flat = [];
    for (const [k, id] of cells) {
      const x = (k >>> 21) - 1024, y = ((k >>> 8) & 8191) - 4096, z = (k & 255) - 128;
      const hash = signature?.(k);
      let face = signature ? cache.get(hash) : undefined;
      if (face === undefined) {
        face = surface(x, y, z);
        if (signature && cache.size < 4096) cache.set(hash, face);
      }
      if (!face) continue;
      pos.push(x + 0.5, y + 0.5, z + 0.5); // a voxel at layer z spans z to z + 1
      ao.push(face[0], face[1]);
      mats.push(id);
      births.push(this.births?.get(k) ?? 0);
      // shows its front face and nothing else: the middle of a face, where a look may keep the surface plain
      flat.push(face[2]);
    }
    this.count = mats.length;
    this.rest = new Float32Array(pos);
    this.ao = new Uint32Array(ao);
    this.mats = new Uint8Array(mats);
    this.birth = new Float32Array(births);
    this.flat = new Uint8Array(flat);
    this.col = new Float32Array(this.count * 4);
    this.scales = this.masked ? new Float32Array(this.count).fill(1) : null; // per-voxel size, for fills and growth
    this.tint(theme, look);
    return this;
  }

  /** Recolour for a theme, in a look's colours, without rebuilding the shape. */
  tint(theme, look = BASE) {
    const { rest, mats, col, flat } = this;
    const table = tableOf(look);
    for (let i = 0; i < this.count; i++) {
      const m = table[mats[i]];
      if (look.finishes) {
        const finish = look.finishes[m.name];
        const chamfer = finish?.chamfer ?? 255;
        const specular = finish?.specular ?? 0;
        const word = i * 2 + 1;
        this.ao[word] = (this.ao[word] & 0xffff) | (chamfer << 16) | (specular << 24);
      }
      const base = theme === 'night' ? m.night : m.day;
      const x = Math.floor(rest[i * 3]), y = Math.floor(rest[i * 3 + 1]), z = Math.floor(rest[i * 3 + 2]);
      // a quiet look keeps the middle of a face plain; what glows keeps its grid, or it would lose its glow
      const still = look.quiet && flat[i] && !(m.glow > 0);
      let j = 0;
      if (!still) { j = (hash3(x, y, z) - 0.5) * 2 * m.jitter; if (m.grain) j += m.grain(x, y, z); j *= look.grain; }
      col[i * 4] = clamp01(base[0] + j);
      col[i * 4 + 1] = clamp01(base[1] + j);
      col[i * 4 + 2] = clamp01(base[2] + j);
      // Values below -1 carry thin-sheet transmission through both block passes.
      col[i * 4 + 3] = m.transmission ? -1 - m.transmission : m.seamless || still ? -1 : m.glow; // the fourth value is glow; -1 means no seams
    }
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Model {
  constructor() {
    this.parts = [];
    this.byName = {};
  }

  part(name) {
    if (this.byName[name]) return this.byName[name];
    const p = new Part(name);
    this.parts.push(p);
    this.byName[name] = p;
    return p;
  }

  bake(theme, look) {
    for (const p of this.parts) p.bake(theme, look);
    return this;
  }

  tint(theme, look) {
    for (const p of this.parts) p.tint(theme, look);
  }

  get count() {
    let n = 0;
    for (const p of this.parts) if (!p.hidden) n += p.count;
    return n;
  }
}
