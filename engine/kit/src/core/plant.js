// A plant, grown from a number. Every voxel has a birth between 0 and 1, so the same plant can be
// shown at any moment of its life by calling part.grow(g): seed, sprout, sapling, bud, bloom.
// Up is toward the top of the page (smaller y). The plant stands on y = base.

import { hash3 } from './materials.js';

export const STAGES = [
  { name: 'seed', at: 0.0 },
  { name: 'sprout', at: 0.14 },
  { name: 'sapling', at: 0.38 },
  { name: 'bud', at: 0.68 },
  { name: 'bloom', at: 0.88 },
];

export function stageOf(g) {
  let s = STAGES[0];
  for (const st of STAGES) if (g >= st.at) s = st;
  return s.name;
}

const FLOWER = [
  '..PPP..',
  '.PPPPP.',
  'PPPCPPP',
  'PPCCCPP',
  'PPPCPPP',
  '.PPPPP.',
  '..PPP..',
];
const PETALS = ['petal', 'signal', 'chalk', 'enamel', 'brick'];

/**
 * Fill a part with a plant. opts: { x, base, z, seed, height (voxels, default 17), petal }
 * Returns { top: [x, y, z], height }.
 */
export function plant(part, opts = {}) {
  const x0 = opts.x ?? 0, base = opts.base ?? 0, z0 = opts.z ?? 2, seed = opts.seed ?? 1;
  const H = opts.height ?? 17;
  const r = (n) => hash3(seed * 13 + n, seed * 7 - n, n * 3 + seed);
  part.masked = true;

  // the seed itself, half buried; it is there from the start
  part.plot(x0, base - 1, z0, 'walnut', 0);
  part.plot(x0 + 1, base - 1, z0, 'walnut', 0);

  // stem: wanders a little, never more than one voxel per step
  const sway = (r(1) - 0.5) * 2.2, phase = r(2) * 6.28;
  const stemX = (h) => x0 + Math.round(Math.sin(h * 0.33 + phase) * sway * Math.min(1, h / 6));
  const born = (h) => 0.1 + 0.62 * (h / H);
  let px = x0;
  for (let h = 0; h < H; h++) {
    const x = stemX(h);
    const y = base - 1 - h;
    part.plot(x, y, z0, 'stem', born(h));
    if (x !== px) part.plot(px, y, z0, 'stem', born(h)); // keep the stem connected through a bend
    px = x;
  }

  // leaves: one every two or three voxels, alternating sides, each growing out from the stem
  let side = r(3) > 0.5 ? 1 : -1;
  for (let h = 2, n = 0; h < H - 2; h += 2 + (n % 3 === 2 ? 1 : 0), n++) {
    const len = 3 + Math.floor(r(10 + n) * 2.6) + (h > H * 0.55 ? 0 : 2);
    const lz = z0 + (n % 2 ? 1 : -1) * (r(20 + n) > 0.3 ? 1 : 0);
    const sx = stemX(h), sy = base - 1 - h;
    for (let i = 1; i <= len; i++) {
      const rise = Math.round(i * (0.45 + r(30 + n) * 0.3));
      const b = born(h) + 0.04 + 0.13 * (i / len);
      part.plot(sx + side * i, sy - rise, lz, 'leaf', b);
      if (i > 1 && i < len) part.plot(sx + side * i, sy - rise - 1, lz, 'leaf', b + 0.015);
      if (i > 1 && i < len - 1) part.plot(sx + side * i, sy - rise, lz + 1, 'leaf', b + 0.03);
      if (len > 4 && i > 2 && i < len - 1) part.plot(sx + side * i, sy - rise + 1, lz, 'leaf', b + 0.045);
    }
    side = -side;
  }

  // bud, then bloom
  const tx = stemX(H - 1), ty = base - H;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = 0; k <= 1; k++) {
    if (i && j) continue;
    part.plot(tx + i, ty - 1 + j, z0 + k, 'stem', 0.7 + 0.08 * (1 - j) / 2);
  }
  const petal = opts.petal ?? PETALS[Math.floor(r(40) * PETALS.length)];
  const core = petal === 'signal' ? 'walnut' : 'signal';
  // a disc of petals, a raised inner ring, and a core standing proud of both; it opens outward
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
    const c = FLOWER[j][i];
    if (c === '.') continue;
    const d = Math.hypot(i - 3, j - 3);
    const x = tx - 3 + i, y = ty - 4 + j;
    const b = 0.875 + 0.075 * (d / 3.2);
    part.plot(x, y, z0 + 2, petal, b);
    if (d < 2.3) part.plot(x, y, z0 + 3, petal, b + 0.01);
    if (c === 'C') part.plot(x, y, z0 + 4, core, 0.9);
  }
  return { top: [tx, ty - 4, z0 + 2], height: H + 4 };
}

/** A pot with soil. Its rim is at y = base; it is `w` wide and stands 5 tall. */
export function pot(part, x, base, z, w = 7, mat = 'brick') {
  const d = 5;
  part.box(x - 1, base, z, w + 2, 2, d, mat);          // rim
  part.box(x, base + 2, z, w, 4, d, mat);              // body
  part.carve(x, base, z + 1, w, 1, d - 2);              // hollow
  part.box(x, base, z + 1, w, 1, d - 2, 'soil');        // soil, level with the rim
  return part;
}
