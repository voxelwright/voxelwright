// Motion. Springs for anything a hand can touch; per-voxel effects for building and breaking.
// Curves and durations follow the site-craft rules: no ease-in, press feedback 100 to 160 ms,
// exits shorter than entrances, stagger that never blocks input.

import { hash3 } from './materials.js';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A damped spring. k = 170, c = 26 is the calm settle; lower c for bounce. */
export class Spring {
  constructor(x = 0, k = 170, c = 26) {
    this.x = x; this.v = 0; this.target = x; this.k = k; this.c = c;
  }
  to(target, k, c) {
    this.target = target;
    if (k !== undefined) this.k = k;
    if (c !== undefined) this.c = c;
    return this;
  }
  snap(x) { this.x = x; this.target = x; this.v = 0; return this; }
  /** Advance by dt seconds. Returns true while still moving. */
  step(dt) {
    let left = Math.min(dt, 0.064);
    while (left > 0) {
      const h = Math.min(left, 0.004);
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
      left -= h;
    }
    if (Math.abs(this.x - this.target) < 0.002 && Math.abs(this.v) < 0.02) { this.x = this.target; this.v = 0; return false; }
    return true;
  }
  get moving() { return this.x !== this.target || this.v !== 0; }
}

// Press: quick and firm on the way down, a small overshoot on the way back.
export const PRESS = { k: 1500, c: 76 };   // settles in about 110 ms
export const RELEASE = { k: 620, c: 34 };  // about 190 ms, one soft overshoot
export const SLIDE = { k: 420, c: 30 };    // toggles, tabs: about 220 ms with a little carry
export const CALM = { k: 170, c: 26 };

const easeOutBack = (p, s = 1.25) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
const easeOut = (p) => 1 - Math.pow(1 - p, 4);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function quat(out, o, ax, ay, az, angle) {
  const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(angle / 2) / l;
  out[o] = ax * s; out[o + 1] = ay * s; out[o + 2] = az * s; out[o + 3] = Math.cos(angle / 2);
}

/**
 * Assembly: voxels are set in place, lowest layer first, each arriving from the viewer's side.
 * It marks the moment a thing is made. It is not for things scrolling into view.
 * opts: { duration (s, whole build), each (s, one voxel), from: [x, y] build origin in voxels,
 *         delay (s), seed }
 */
export function assemble(part, opts = {}) {
  const n = part.count, rest = part.rest;
  const each = opts.each ?? 0.2;
  const total = Math.max(each, opts.duration ?? 0.52);
  const spread = total - each;
  const from = opts.from ?? null;
  const seed = opts.seed ?? 1;
  // rank: layer first, then distance from the origin, then a little noise so it is not a wipe
  let zmin = Infinity, zmax = -Infinity, dmax = 0;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    d[i] = from ? Math.hypot(x - from[0], y - from[1]) : x + y * 0.6;
    dmax = Math.max(dmax, d[i]);
  }
  const delay = new Float32Array(n), start = new Float32Array(n * 3), rank = new Float32Array(n);
  let dmin = Infinity, rmin = Infinity, rmax = -Infinity;
  for (let i = 0; i < n; i++) dmin = Math.min(dmin, d[i]);
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    const r = hash3(x + seed, y, z), r2 = hash3(x, y + seed, z), r3 = hash3(x, y, z + seed);
    const layer = zmax > zmin ? (z - zmin) / (zmax - zmin) : 0;
    const dist = dmax > dmin ? (d[i] - dmin) / (dmax - dmin) : 0;
    rank[i] = layer * 0.38 + dist * 0.57 + r * 0.05; // a front, with just enough noise not to be a wipe
    rmin = Math.min(rmin, rank[i]); rmax = Math.max(rmax, rank[i]);
    start[i * 3] = (r2 - 0.5) * 1.2;
    start[i * 3 + 1] = (r3 - 0.5) * 1.2 - 0.6;
    start[i * 3 + 2] = 3 + r * 4;
  }
  // the first block lands on the frame of the input: nothing waits for a slot that no voxel fills
  for (let i = 0; i < n; i++) delay[i] = (opts.delay ?? 0) + spread * Math.pow(rmax > rmin ? (rank[i] - rmin) / (rmax - rmin) : 0, 0.75);
  return {
    kind: 'assemble', t: 0, end: (opts.delay ?? 0) + total,
    write(pos, o, part) {
      const t = this.t;
      for (let i = 0; i < n; i++, o += 8) {
        const p = clamp01((t - delay[i]) / each);
        if (p <= 0) { pos[o + 3] = 0; continue; }
        const e = easeOutBack(p, 1.1), k = 1 - e;
        pos[o] = rest[i * 3] + part.tx + start[i * 3] * k;
        pos[o + 1] = rest[i * 3 + 1] + part.ty + start[i * 3 + 1] * k;
        pos[o + 2] = rest[i * 3 + 2] + part.tz + start[i * 3 + 2] * k;
        pos[o + 3] = clamp01((t - delay[i]) / 0.075); // grows from nothing over 75 ms: a block is never suddenly there
        pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
      }
      return t >= this.end;
    },
  };
}

/**
 * Crumble: the thing comes apart and falls off the page. Exits are shorter than entrances.
 * opts: { duration (s), from: [x, y] where the break starts, seed }
 */
export function crumble(part, opts = {}) {
  const n = part.count, rest = part.rest;
  const total = opts.duration ?? 0.34;
  const seed = opts.seed ?? 7;
  const from = opts.from ?? null;
  const vel = new Float32Array(n * 3), axis = new Float32Array(n * 3), delay = new Float32Array(n), spin = new Float32Array(n);
  let dmax = 1;
  if (from) for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.hypot(rest[i * 3] - from[0], rest[i * 3 + 1] - from[1]));
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    const r = hash3(x + seed, y, z), r2 = hash3(x, y + seed, z), r3 = hash3(x, y, z + seed);
    vel[i * 3] = (r - 0.5) * 22;
    vel[i * 3 + 1] = -6 - r2 * 16;
    vel[i * 3 + 2] = 4 + r3 * 18;
    axis[i * 3] = r2 - 0.5; axis[i * 3 + 1] = r3 - 0.5; axis[i * 3 + 2] = r - 0.5;
    spin[i] = (r3 - 0.5) * 18;
    delay[i] = from ? 0.09 * (Math.hypot(x - from[0], y - from[1]) / dmax) : r2 * 0.05;
  }
  const G = 150; // voxels per second squared, down the page
  return {
    kind: 'crumble', t: 0, end: total + 0.09,
    write(pos, o, part) {
      const t = this.t;
      for (let i = 0; i < n; i++, o += 8) {
        const s = Math.max(0, t - delay[i]);
        const p = clamp01(s / total);
        pos[o] = rest[i * 3] + part.tx + vel[i * 3] * s;
        pos[o + 1] = rest[i * 3 + 1] + part.ty + vel[i * 3 + 1] * s + 0.5 * G * s * s;
        pos[o + 2] = rest[i * 3 + 2] + part.tz + vel[i * 3 + 2] * s;
        pos[o + 3] = 1 - easeOut(clamp01((p - 0.35) / 0.65)) ;
        quat(pos, o + 4, axis[i * 3], axis[i * 3 + 1], axis[i * 3 + 2], spin[i] * s);
      }
      return t >= this.end;
    },
  };
}

/** Under reduced motion a build or a break is a short fade of scale only: nothing travels. */
export function settle(part, opts = {}) {
  const n = part.count, rest = part.rest, total = opts.duration ?? 0.16, out = !!opts.out;
  return {
    kind: out ? 'crumble' : 'assemble', t: 0, end: total,
    write(pos, o, part) {
      const p = clamp01(this.t / total), s = out ? 1 - p : p;
      for (let i = 0; i < n; i++, o += 8) {
        pos[o] = rest[i * 3] + part.tx; pos[o + 1] = rest[i * 3 + 1] + part.ty; pos[o + 2] = rest[i * 3 + 2] + part.tz;
        pos[o + 3] = s; pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
      }
      return this.t >= this.end;
    },
  };
}
