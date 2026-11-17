// A model is a few rigid parts; a part is a set of voxels on the integer grid.
// Axes: x right, y down, z toward the viewer. z = 0 is the page; nothing goes below it.

import { MATERIALS, MATERIAL_IDS, hash3 } from './materials.js';
import { layout } from './font.js';

const OFF = 512;
const key = (x, y, z) => ((x + OFF) << 20) | ((y + OFF) << 10) | (z + OFF);

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

  /** Show the voxels born by g (0 to 1). Each one pops in over a short window. */
  grow(g, window = 0.05) {
    const sc = this.scales, b = this.birth;
    if (!sc || !b) return;
    for (let i = 0; i < this.count; i++) {
      const p = (g - b[i]) / window;
      sc[i] = p <= 0 ? 0 : p >= 1 ? 1 : 1 + 2.1 * Math.pow(p - 1, 3) + 1.1 * Math.pow(p - 1, 2);
    }
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

  /** Lettering in Vox Sign. scale is voxels per glyph cell. Returns the width used. */
  text(str, x, y, z, d, mat, scale = 1) {
    const { cells, width } = layout(str);
    for (const [cx, cy] of cells) this.box(x + cx * scale, y + cy * scale, z, scale, scale, d, mat);
    return width * scale;
  }

  has(x, y, z) {
    return this.cells.has(key(x, y, z));
  }

  /** Turn the cells into flat arrays the renderer can draw. Hidden interior voxels are dropped. */
  bake(theme) {
    const cells = this.cells;
    const grounded = this.grounded;
    const occ = (x, y, z) => (grounded && z < 0) || cells.has(key(x, y, z));
    const pos = [], col = [], ao = [], mats = [], births = [];
    for (const [k, id] of cells) {
      const x = (k >>> 20) - OFF, y = ((k >>> 10) & 1023) - OFF, z = (k & 1023) - OFF;
      // exposed at all?
      if (occ(x + 1, y, z) && occ(x - 1, y, z) && occ(x, y + 1, z) && occ(x, y - 1, z) && occ(x, y, z + 1) && occ(x, y, z - 1)) continue;
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
      pos.push(x + 0.5, y + 0.5, z + 0.5); // a voxel at layer z spans z to z + 1
      ao.push(lo >>> 0, hi >>> 0);
      mats.push(id);
      births.push(this.births?.get(k) ?? 0);
    }
    this.count = mats.length;
    this.rest = new Float32Array(pos);
    this.ao = new Uint32Array(ao);
    this.mats = new Uint8Array(mats);
    this.birth = new Float32Array(births);
    this.col = new Float32Array(this.count * 4);
    this.scales = this.masked ? new Float32Array(this.count).fill(1) : null; // per-voxel size, for fills and growth
    this.tint(theme);
    return this;
  }

  /** Recolour for a theme without rebuilding the shape. */
  tint(theme) {
    const { rest, mats, col } = this;
    for (let i = 0; i < this.count; i++) {
      const m = MATERIAL_IDS[mats[i]];
      const base = theme === 'night' ? m.night : m.day;
      const x = Math.floor(rest[i * 3]), y = Math.floor(rest[i * 3 + 1]), z = Math.floor(rest[i * 3 + 2]);
      let j = (hash3(x, y, z) - 0.5) * 2 * m.jitter;
      if (m.grain) j += m.grain(x, y, z);
      col[i * 4] = clamp01(base[0] + j);
      col[i * 4 + 1] = clamp01(base[1] + j);
      col[i * 4 + 2] = clamp01(base[2] + j);
      col[i * 4 + 3] = m.glow;
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

  bake(theme) {
    for (const p of this.parts) p.bake(theme);
    return this;
  }

  tint(theme) {
    for (const p of this.parts) p.tint(theme);
  }

  get count() {
    let n = 0;
    for (const p of this.parts) if (!p.hidden) n += p.count;
    return n;
  }
}
