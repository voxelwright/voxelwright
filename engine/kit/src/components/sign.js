// Sign. Lettering in voxels on an enamel board: the rooftop billboard, brought indoors.
// Poke it and the letters under the pointer break off, fall, and mend themselves.
// Markup: <h1 class="vx-sign" data-vx-scale="auto">Voxelmorphism</h1>   (the text stays in the DOM for readers)

import { measure } from '../core/font.js';
import { reducedMotion } from '../core/motion.js';
import { hash3 } from '../core/materials.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const MARGIN = 3; // voxels of board around the lettering, in glyph cells

// Break the text into lines that fit, at the largest whole scale that fits.
function fit(el, vx) {
  const text = (el.dataset.vxText || el.textContent).trim().replace(/\s+/g, ' ');
  const bare = el.dataset.vxBoard === 'none';
  const margin = bare ? 0 : MARGIN;
  const room = (el.parentElement?.clientWidth || innerWidth) / vx;
  const words = text.split(' ');
  const want = Number(el.dataset.vxScale) || Number(el.dataset.vxMax || 4);
  for (let scale = want; scale >= 1; scale--) {
    const max = Math.floor((room - (bare ? 0 : 2)) / scale) - margin * 2;
    const wrap = (limit) => {
      const out = [];
      let line = '';
      for (const w of words) {
        const next = line ? line + ' ' + w : w;
        if (measure(next) <= limit || !line) line = next; else { out.push(line); line = w; }
      }
      if (line) out.push(line);
      return out;
    };
    let lines = wrap(max);
    // balance: the narrowest limit that still gives the same number of lines, so no word is left alone
    for (let limit = max - 1; limit > 0 && lines.length > 1; limit--) {
      const t = wrap(limit);
      if (t.length > lines.length) break;
      lines = t;
    }
    const width = Math.max(...lines.map((l) => measure(l)));
    if (width <= max || scale === 1) {
      const fixed = Number(el.dataset.vxScale);
      // a sign told its scale keeps it if one line fits; otherwise it wraps, then shrinks
      if (!fixed && lines.length > 1 && scale > 1 && !bare) continue;
      return { text, lines, width, scale, margin, bare, gap: 3 };
    }
  }
}

// The lettering breaks into its glyph cells: each cell is one block of scale x scale voxels, and
// a block flies, turns and comes home as one piece.
function physics(part, scale) {
  const n = part.count, rest = part.rest;
  const of = new Int32Array(n), index = new Map(), sums = [];
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rest[i * 3 + 1] / scale) * 4096 + Math.floor(rest[i * 3] / scale);
    let c = index.get(k);
    if (c === undefined) { c = sums.length; index.set(k, c); sums.push([0, 0, 0, 0]); }
    of[i] = c;
    const t = sums[c];
    t[0] += rest[i * 3]; t[1] += rest[i * 3 + 1]; t[2] += rest[i * 3 + 2]; t[3]++;
  }
  const m = sums.length;
  const centre = new Float32Array(m * 3);
  sums.forEach((t, c) => { centre[c * 3] = t[0] / t[3]; centre[c * 3 + 1] = t[1] / t[3]; centre[c * 3 + 2] = t[2] / t[3]; });
  const off = new Float32Array(m * 3), vel = new Float32Array(m * 3), ang = new Float32Array(m), spin = new Float32Array(m), free = new Float32Array(m), axis = new Float32Array(m * 3), quat = new Float32Array(m * 4);
  return {
    kind: 'physics', t: 0, last: 0, end: Infinity,
    poke(x, y, radius, force) {
      for (let c = 0; c < m; c++) {
        const dx = centre[c * 3] - x, dy = centre[c * 3 + 1] - y, d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const k = 1 - d / radius, r = hash3(c, Math.round(x * 7), Math.round(y * 5)), r2 = hash3(Math.round(y * 3), c, 9);
        vel[c * 3] += (dx / (d + 0.5)) * force * k * (0.5 + r) + (r2 - 0.5) * 8;
        vel[c * 3 + 1] += (dy / (d + 0.5)) * force * k * (0.5 + r2) - force * 0.45 * k;
        vel[c * 3 + 2] += force * (0.5 + r) * k;
        spin[c] = (r - 0.5) * 16;
        axis[c * 3] = r - 0.5; axis[c * 3 + 1] = r2 - 0.5; axis[c * 3 + 2] = 0.3;
        free[c] = 0.5 + r2 * 0.45 + (1 - k) * 0.2; // seconds in the air before it mends
      }
    },
    write(pos, o, part) {
      const dt = Math.min(0.04, Math.max(0, this.t - this.last));
      this.last = this.t;
      let busy = false;
      for (let c = 0; c < m; c++) {
        let ox = off[c * 3], oy = off[c * 3 + 1], oz = off[c * 3 + 2];
        if (free[c] > 0) {
          free[c] -= dt;
          vel[c * 3 + 1] += 95 * dt;
          ox += vel[c * 3] * dt; oy += vel[c * 3 + 1] * dt; oz += vel[c * 3 + 2] * dt;
          vel[c * 3 + 2] -= 30 * dt;
          if (oz < 0.2) { oz = 0.2; vel[c * 3 + 2] *= -0.3; }
          ang[c] += spin[c] * dt;
          busy = true;
        } else if (ox || oy || oz || ang[c]) {
          // mend: a critically damped pull home
          const k = 150, d = 24;
          vel[c * 3] += (-k * ox - d * vel[c * 3]) * dt;
          vel[c * 3 + 1] += (-k * oy - d * vel[c * 3 + 1]) * dt;
          vel[c * 3 + 2] += (-k * oz - d * vel[c * 3 + 2]) * dt;
          ox += vel[c * 3] * dt; oy += vel[c * 3 + 1] * dt; oz += vel[c * 3 + 2] * dt;
          ang[c] *= Math.exp(-9 * dt);
          if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) < 0.02 && Math.abs(vel[c * 3]) + Math.abs(vel[c * 3 + 1]) + Math.abs(vel[c * 3 + 2]) < 0.3 && Math.abs(ang[c]) < 0.01) {
            ox = oy = oz = 0; ang[c] = 0; vel[c * 3] = vel[c * 3 + 1] = vel[c * 3 + 2] = 0;
          } else busy = true;
        }
        off[c * 3] = ox; off[c * 3 + 1] = oy; off[c * 3 + 2] = oz;
        const a = ang[c], l = Math.hypot(axis[c * 3], axis[c * 3 + 1], axis[c * 3 + 2]) || 1, sn = a ? Math.sin(a / 2) / l : 0;
        quat[c * 4] = axis[c * 3] * sn; quat[c * 4 + 1] = axis[c * 3 + 1] * sn; quat[c * 4 + 2] = axis[c * 3 + 2] * sn; quat[c * 4 + 3] = a ? Math.cos(a / 2) : 1;
      }
      for (let i = 0; i < n; i++, o += 8) {
        const c = of[i], qx = quat[c * 4], qy = quat[c * 4 + 1], qz = quat[c * 4 + 2], qw = quat[c * 4 + 3];
        const vx = rest[i * 3] - centre[c * 3], vy = rest[i * 3 + 1] - centre[c * 3 + 1], vz = rest[i * 3 + 2] - centre[c * 3 + 2];
        const tx = qy * vz - qz * vy + qw * vx, ty = qz * vx - qx * vz + qw * vy, tz = qx * vy - qy * vx + qw * vz;
        pos[o] = centre[c * 3] + part.tx + off[c * 3] + vx + 2 * (qy * tz - qz * ty);
        pos[o + 1] = centre[c * 3 + 1] + part.ty + off[c * 3 + 1] + vy + 2 * (qz * tx - qx * tz);
        pos[o + 2] = centre[c * 3 + 2] + part.tz + off[c * 3 + 2] + vz + 2 * (qx * ty - qy * tx);
        pos[o + 3] = 1; pos[o + 4] = qx; pos[o + 5] = qy; pos[o + 6] = qz; pos[o + 7] = qw;
      }
      return !busy;
    },
  };
}

export const sign = {
  name: 'sign',
  selector: '.vx-sign',
  pad: 14,

  build(live, m) {
    const { W, H, el } = live;
    const f = fit(el, live.vx);
    const { scale, lines, bare } = f;
    const z = bare ? 0 : 2;
    if (!bare) {
      m.part('board').slab(0, 0, 0, W, H, 2, el.dataset.vxMaterial || 'enamel', 2);
      const frame = m.part('frame');
      frame.grounded = false;
      frame.box(1, 1, 2, W - 2, H - 2, 1, 'signal').carve(2, 2, 2, W - 4, H - 4, 1).notch(1, 1, 2, W - 2, H - 2, 1, 1);
    }
    const letters = m.part('letters');
    letters.grounded = bare;
    const block = (lines.length * 7 + (lines.length - 1) * f.gap) * scale;
    let y = Math.round((H - block) / 2 / scale) * scale;
    for (const line of lines) {
      // letters sit on a grid of whole glyph cells, so a poke breaks them along their own joints
      const x = bare ? 0 : Math.round((W - measure(line) * scale) / 2 / scale) * scale;
      letters.text(line, x, y, z, bare ? 2 : Math.max(2, scale), el.dataset.vxInk || (bare ? 'ink' : 'signal'), scale);
      y += (7 + f.gap) * scale;
    }
    live.faceZ = z;
    live.state.scale = scale;
  },

  bind(live) {
    const on = listeners();
    const el = live.el;
    const size = () => {
      const vx = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4;
      const f = fit(el, vx);
      const pad = f.bare ? 0 : f.margin * 2 * f.scale + 2;
      el.style.inlineSize = (f.width * f.scale + pad) * vx + 'px';
      el.style.blockSize = ((f.lines.length * 7 + (f.lines.length - 1) * f.gap) * f.scale + pad) * vx + 'px';
    };
    size();
    on(window, 'resize', size);
    const poke = (e) => {
      if (reducedMotion()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / live.vx, y = (e.clientY - r.top) / live.vx;
      const letters = live.model.byName.letters;
      if (!letters.fx || letters.fx.kind !== 'physics') letters.fx = physics(letters, live.state.scale);
      letters.fx.poke(x, y, 5 + live.state.scale * 2.2, 34);
      cue('poke');
      live.invalidate();
      el.dispatchEvent(new CustomEvent('vx-poke', { bubbles: true }));
    };
    on(el, 'pointerdown', poke);
    return on.done;
  },
};
