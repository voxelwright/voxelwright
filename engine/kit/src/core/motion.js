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
const RETURN_DAMPING = 0.51;
export const RELEASE = { k: 1000, c: 2 * Math.sqrt(1000) * RETURN_DAMPING };
export const SLIDE = { k: 420, c: 30 };    // toggles, tabs: about 220 ms with a little carry
export const CALM = { k: 170, c: 26 };

const easeOutBack = (p, s = 1.25) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
const easeOut = (p) => 1 - Math.pow(1 - p, 4);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function quat(out, o, ax, ay, az, angle) {
  const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(angle / 2) / l;
  out[o] = ax * s; out[o + 1] = ay * s; out[o + 2] = az * s; out[o + 3] = Math.cos(angle / 2);
}

// Things are built and broken in bricks, not in dust: voxels are grouped into bricks laid in a
// running bond, and every voxel of a brick moves as one piece. Returns the brick of each voxel
// and each brick's centre.
function bricks(part, size) {
  const n = part.count, rest = part.rest;
  const of = new Int32Array(n), index = new Map();
  const sum = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(rest[i * 3 + 1] / size);
    const col = Math.floor((rest[i * 3] + (row & 1 ? size / 2 : 0)) / size);
    const k = row * 4096 + col;
    let b = index.get(k);
    if (b === undefined) { b = sum.length; index.set(k, b); sum.push([0, 0, 0, 0, col, row]); }
    of[i] = b;
    const t = sum[b];
    t[0] += rest[i * 3]; t[1] += rest[i * 3 + 1]; t[2] += rest[i * 3 + 2]; t[3]++;
  }
  const centre = new Float32Array(sum.length * 3), cell = new Int32Array(sum.length * 2);
  sum.forEach((t, b) => { centre[b * 3] = t[0] / t[3]; centre[b * 3 + 1] = t[1] / t[3]; centre[b * 3 + 2] = t[2] / t[3]; cell[b * 2] = t[4]; cell[b * 2 + 1] = t[5]; });
  return { of, centre, cell, count: sum.length };
}

const brickSize = (w, h) => Math.max(2, Math.min(7, Math.round(Math.min(w, h) / 2.6)));

/**
 * Assembly: the thing rises out of the page, brick by brick, in courses. The page hides whatever
 * is below it, so nothing is ever suddenly there: each brick grows up through the surface, goes a
 * little too far, and settles. It marks the moment a thing is made, never arrival on screen.
 * opts: { duration (s, whole build), each (s, one brick), from: [x, y] where the build starts
 *         (default: the bottom-left corner, so courses are laid upward), W, H, top (the model's
 *         size in voxels, so several parts build as one), brick (voxels), delay (s) }
 */
export function assemble(part, opts = {}) {
  const n = part.count, rest = part.rest;
  let w = opts.W, h = opts.H, top = opts.top;
  if (w === undefined || top === undefined) {
    w = 1; h = 1; top = 1;
    for (let i = 0; i < n; i++) { w = Math.max(w, rest[i * 3] + 0.5); h = Math.max(h, rest[i * 3 + 1] + 0.5); top = Math.max(top, rest[i * 3 + 2] + 0.5); }
  }
  const size = opts.brick ?? brickSize(w, h);
  const B = bricks(part, size);
  const each = opts.each ?? 0.17;
  const total = Math.max(each, opts.duration ?? 0.4);
  const from = opts.from ?? [0, h];
  const delay = new Float32Array(B.count);
  let dmax = 0;
  const far = Math.max(Math.hypot(from[0], from[1]), Math.hypot(w - from[0], from[1]), Math.hypot(from[0], h - from[1]), Math.hypot(w - from[0], h - from[1])) || 1;
  for (let b = 0; b < B.count; b++) {
    // courses first (rows count for more than columns), then along the course
    const dx = (B.centre[b * 3] - from[0]) / far, dy = (B.centre[b * 3 + 1] - from[1]) / far;
    delay[b] = Math.hypot(dx * 0.55, dy);
    dmax = Math.max(dmax, delay[b]);
  }
  let dmin = Infinity;
  for (let b = 0; b < B.count; b++) dmin = Math.min(dmin, delay[b]);
  const spread = total - each;
  for (let b = 0; b < B.count; b++) delay[b] = (opts.delay ?? 0) + spread * Math.pow(dmax > dmin ? (delay[b] - dmin) / (dmax - dmin) : 0, 0.8);
  const rise = top + 0.5;
  return {
    kind: 'assemble', t: 0, end: (opts.delay ?? 0) + total,
    write(pos, o, part) {
      const t = this.t;
      for (let i = 0; i < n; i++, o += 8) {
        const p = clamp01((t - delay[B.of[i]]) / each);
        const e = p <= 0 ? 0 : easeOutBack(p, 1.35);
        pos[o] = rest[i * 3] + part.tx;
        pos[o + 1] = rest[i * 3 + 1] + part.ty;
        pos[o + 2] = rest[i * 3 + 2] + part.tz - rise * (1 - e);
        pos[o + 3] = 1; pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
      }
      return t >= this.end;
    },
  };
}

/**
 * Crumble: the thing breaks into its bricks, which fall off the page turning as they go.
 * Exits are shorter than entrances.
 * opts: { duration (s), from: [x, y] where the break starts, W, H, brick, seed }
 */
export function crumble(part, opts = {}) {
  const n = part.count, rest = part.rest;
  let w = opts.W, h = opts.H;
  if (w === undefined) { w = 1; h = 1; for (let i = 0; i < n; i++) { w = Math.max(w, rest[i * 3] + 0.5); h = Math.max(h, rest[i * 3 + 1] + 0.5); } }
  const B = bricks(part, opts.brick ?? brickSize(w, h));
  const total = opts.duration ?? 0.34;
  const seed = opts.seed ?? 7;
  const from = opts.from ?? [w / 2, 0];
  const vel = new Float32Array(B.count * 3), axis = new Float32Array(B.count * 3), delay = new Float32Array(B.count), spin = new Float32Array(B.count);
  const far = Math.hypot(w, h) || 1;
  for (let b = 0; b < B.count; b++) {
    const cx = B.cell[b * 2], cy = B.cell[b * 2 + 1];
    const r = hash3(cx + seed, cy, 1), r2 = hash3(cx, cy + seed, 2), r3 = hash3(cx, cy, 3 + seed);
    vel[b * 3] = (r - 0.5) * 26;
    vel[b * 3 + 1] = -4 - r2 * 14;
    vel[b * 3 + 2] = 5 + r3 * 14;
    axis[b * 3] = r2 - 0.5; axis[b * 3 + 1] = r3 - 0.5; axis[b * 3 + 2] = (r - 0.5) * 0.6;
    spin[b] = (r3 - 0.5) * 11;
    delay[b] = 0.1 * Math.hypot(B.centre[b * 3] - from[0], B.centre[b * 3 + 1] - from[1]) / far + r2 * 0.02;
  }
  let first = Infinity;
  for (let b = 0; b < B.count; b++) first = Math.min(first, delay[b]);
  for (let b = 0; b < B.count; b++) delay[b] -= first; // the first brick lets go on the frame of the input
  const G = 300; // voxels per second squared, down the page
  const q = [0, 0, 0, 1];
  return {
    kind: 'crumble', t: 0, end: total + 0.1,
    write(pos, o, part) {
      const t = this.t;
      for (let i = 0; i < n; i++, o += 8) {
        const b = B.of[i];
        const s = Math.max(0, t - delay[b]);
        const p = clamp01(s / total);
        quat(q, 0, axis[b * 3], axis[b * 3 + 1], axis[b * 3 + 2], spin[b] * s);
        // the voxel keeps its place in its brick while the brick turns
        const vx = rest[i * 3] - B.centre[b * 3], vy = rest[i * 3 + 1] - B.centre[b * 3 + 1], vz = rest[i * 3 + 2] - B.centre[b * 3 + 2];
        const tx = q[1] * vz - q[2] * vy + q[3] * vx, ty = q[2] * vx - q[0] * vz + q[3] * vy, tz = q[0] * vy - q[1] * vx + q[3] * vz;
        const shrink = 1 - easeOut(clamp01((p - 0.7) / 0.3));
        pos[o] = B.centre[b * 3] + part.tx + vel[b * 3] * s + (vx + 2 * (q[1] * tz - q[2] * ty)) * shrink;
        pos[o + 1] = B.centre[b * 3 + 1] + part.ty + vel[b * 3 + 1] * s + 0.5 * G * s * s + (vy + 2 * (q[2] * tx - q[0] * tz)) * shrink;
        pos[o + 2] = Math.max(0.5, B.centre[b * 3 + 2] + part.tz + vel[b * 3 + 2] * s + (vz + 2 * (q[0] * ty - q[1] * tx)) * shrink);
        pos[o + 3] = shrink;
        pos[o + 4] = q[0]; pos[o + 5] = q[1]; pos[o + 6] = q[2]; pos[o + 7] = q[3];
      }
      return t >= this.end;
    },
  };
}

/** The plate carries its front face, lettering and controls throughout its travel. */
export function plateMotion(part, { duration = 0.4, top, out, still, start = out ? 1 : 0 }) {
  const end = still ? 0.16 : duration;
  return {
    kind: out ? 'lower' : 'assemble', t: 0, end,
    get progress() {
      const t = clamp01(this.t / end);
      if (out) return start * (1 - t) ** 2;
      if (still) return start + (1 - start) * t;
      // The return spring has the same damping as a released key. A heavier plate
      // takes longer to reach its stop, where its first return to level ends the travel.
      const ratio = RETURN_DAMPING / Math.sqrt(1 - RETURN_DAMPING ** 2);
      const phase = t * (1.5 * Math.PI + Math.atan(ratio));
      return 1 - (1 - start) * Math.exp(-ratio * phase) * (Math.cos(phase) + ratio * Math.sin(phase));
    },
    get dz() { return still ? 0 : (this.progress - 1) * (top - 0.5); },
    write(pos, o) {
      const dz = this.dz;
      for (let i = 0; i < part.count; i++, o += 8) {
        pos[o] = part.rest[i * 3] + part.tx;
        pos[o + 1] = part.rest[i * 3 + 1] + part.ty;
        pos[o + 2] = part.rest[i * 3 + 2] + part.tz + dz;
        pos[o + 3] = 1; pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1;
      }
      return this.t >= end;
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
