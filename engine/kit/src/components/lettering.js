// Lettering: words built from voxels, on an enamel board (a sign) or bare as a heading.
//   <h1 class="vx-sign">Voxelmorphism</h1>                     a board
//   <h2 class="vx-sign" data-vx-board="none">The rules</h2>    a heading
// data-vx-font names glyph sets from core/fonts/, first that fits wins (default "block sign":
// Vox Block, and Vox Sign where the column is too narrow for it). data-vx-scale fixes the voxels
// per glyph cell; otherwise a board takes the largest of data-vx-max (default 2) that fits, and
// a heading is one voxel per cell. Spacing, kerning and line gaps are the glyph set's own, in
// whole cells; depth follows scale; at two or more voxels per cell diagonals are redrawn, not
// enlarged. Poke it and the letters under the pointer break off, fall, and mend themselves.

import { FONTS, measure, layout, voxels } from '../core/fonts/index.js';
import '../core/fonts/sign.js';
import '../core/fonts/sentence.js';
import '../core/fonts/block.js';
import { reducedMotion } from '../core/motion.js';
import { hash3 } from '../core/materials.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const margin = (font) => Math.round(font.cap * 0.42); // cells of board around the lettering

// Choose a glyph set and a scale, and break the text into balanced lines that fit.
export function fit(el, vx) {
  const text = (el.dataset.vxText || el.textContent).trim().replace(/\s+/g, ' ');
  const bare = el.dataset.vxBoard === 'none';
  const room = (el.parentElement?.clientWidth || innerWidth) / vx;
  const words = text.split(' ');
  const fixed = Number(el.dataset.vxScale);
  const want = fixed || Number(el.dataset.vxMax || (bare ? 1 : 2));
  const fonts = (el.dataset.vxFont || 'block sign').split(/\s+/).map((id) => FONTS[id]).filter(Boolean);
  let last = null;
  for (const font of fonts) {
    const m = bare ? 0 : margin(font);
    for (let scale = want; scale >= 1; scale--) {
      const max = Math.floor((room - (bare ? 0 : 2)) / scale) - m * 2;
      const wrap = (limit) => {
        const out = [];
        let line = '';
        for (const w of words) {
          const next = line ? line + ' ' + w : w;
          if (measure(font, next) <= limit || !line) line = next; else { out.push(line); line = w; }
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
      const laid = lines.map((l) => layout(font, l));
      const width = Math.max(...laid.map((l) => l.width));
      const rows = lines.length * font.cap + (lines.length - 1) * font.lineGap;
      // The box runs from the cap line of the first line to the baseline of the last, as a trimmed
      // text box does. Tails and accents hang outside it, in the bleed, so the plain version and
      // the voxels have the same footprint. On a board they are given room.
      const over = bare ? 0 : -laid[0].top, under = bare ? 0 : laid[laid.length - 1].bottom - font.cap;
      last = { text, font, lines, laid, width, rows, over, under, scale, margin: m, bare };
      if (width > max) continue;
      // a board keeps to one line while any glyph set and scale can manage it
      if (!fixed && !bare && lines.length > 1 && (scale > 1 || font !== fonts[fonts.length - 1])) continue;
      return last;
    }
  }
  return last;
}

// The element's size in voxels for a fit.
function box(f) {
  const pad = f.bare ? 0 : f.margin * 2 * f.scale + 2;
  return { w: f.width * f.scale + pad, h: (f.rows + f.over + f.under) * f.scale + pad };
}

// Break and mend, unchanged from sign.js.
function physics(part) {
  const n = part.count, rest = part.rest;
  const off = new Float32Array(n * 3), vel = new Float32Array(n * 3), ang = new Float32Array(n), spin = new Float32Array(n), free = new Float32Array(n), axis = new Float32Array(n * 3);
  return {
    kind: 'physics', t: 0, last: 0, end: Infinity, busy: false,
    poke(x, y, radius, force) {
      for (let i = 0; i < n; i++) {
        const dx = rest[i * 3] - x, dy = rest[i * 3 + 1] - y, d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const k = 1 - d / radius, r = hash3(i, Math.round(x * 7), Math.round(y * 5)), r2 = hash3(Math.round(y * 3), i, 9);
        vel[i * 3] += (dx / (d + 0.5)) * force * k * (0.5 + r) + (r2 - 0.5) * 8;
        vel[i * 3 + 1] += (dy / (d + 0.5)) * force * k * (0.5 + r2) - force * 0.45 * k;
        vel[i * 3 + 2] += force * (0.5 + r) * k;
        spin[i] = (r - 0.5) * 26;
        axis[i * 3] = r - 0.5; axis[i * 3 + 1] = r2 - 0.5; axis[i * 3 + 2] = 0.3;
        free[i] = 0.55 + r2 * 0.5 + (1 - k) * 0.2; // seconds in the air before it mends
      }
      this.busy = true;
    },
    write(pos, o, part) {
      const dt = Math.min(0.04, Math.max(0, this.t - this.last));
      this.last = this.t;
      let busy = false;
      for (let i = 0; i < n; i++, o += 8) {
        let ox = off[i * 3], oy = off[i * 3 + 1], oz = off[i * 3 + 2];
        if (free[i] > 0) {
          free[i] -= dt;
          vel[i * 3 + 1] += 95 * dt;
          ox += vel[i * 3] * dt; oy += vel[i * 3 + 1] * dt; oz += vel[i * 3 + 2] * dt;
          vel[i * 3 + 2] -= 30 * dt;
          if (oz < 0.2) { oz = 0.2; vel[i * 3 + 2] *= -0.3; }
          ang[i] += spin[i] * dt;
          busy = true;
        } else if (ox || oy || oz || ang[i]) {
          // mend: a critically damped pull home
          const k = 150, c = 24;
          for (let a = 0; a < 3; a++) {
            const x = a === 0 ? ox : a === 1 ? oy : oz;
            vel[i * 3 + a] += (-k * x - c * vel[i * 3 + a]) * dt;
          }
          ox += vel[i * 3] * dt; oy += vel[i * 3 + 1] * dt; oz += vel[i * 3 + 2] * dt;
          ang[i] *= Math.exp(-9 * dt);
          if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) < 0.02 && Math.abs(vel[i * 3]) + Math.abs(vel[i * 3 + 1]) + Math.abs(vel[i * 3 + 2]) < 0.3) {
            ox = oy = oz = 0; ang[i] = 0; vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
          } else busy = true;
        }
        off[i * 3] = ox; off[i * 3 + 1] = oy; off[i * 3 + 2] = oz;
        pos[o] = rest[i * 3] + part.tx + ox; pos[o + 1] = rest[i * 3 + 1] + part.ty + oy; pos[o + 2] = rest[i * 3 + 2] + part.tz + oz;
        pos[o + 3] = 1;
        const a = ang[i];
        if (a) {
          const l = Math.hypot(axis[i * 3], axis[i * 3 + 1], axis[i * 3 + 2]) || 1, s = Math.sin(a / 2) / l;
          pos[o + 4] = axis[i * 3] * s; pos[o + 5] = axis[i * 3 + 1] * s; pos[o + 6] = axis[i * 3 + 2] * s; pos[o + 7] = Math.cos(a / 2);
        } else { pos[o + 4] = 0; pos[o + 5] = 0; pos[o + 6] = 0; pos[o + 7] = 1; }
      }
      this.busy = busy;
      return !busy;
    },
  };
}

export const lettering = {
  name: 'lettering',
  selector: '.vx-sign, .vx-lettering',
  pad: 14,

  build(live, m) {
    const { W, H, el } = live;
    const f = fit(el, live.vx);
    const { scale, font, bare } = f;
    const z = bare ? 0 : 2;
    if (!bare) {
      m.part('board').slab(0, 0, 0, W, H, 2, el.dataset.vxMaterial || 'enamel', 2);
      const frame = m.part('frame');
      frame.grounded = false;
      frame.box(1, 1, 2, W - 2, H - 2, 1, 'signal').carve(2, 2, 2, W - 4, H - 4, 1).notch(1, 1, 2, W - 2, H - 2, 1, 1);
    }
    const letters = m.part('letters');
    letters.grounded = bare;
    const depth = Number(el.dataset.vxDepth) || (font.depth ? font.depth(scale) : scale);
    const refine = el.dataset.vxRefine !== 'off';
    const mat = el.dataset.vxInk || (bare ? 'ink' : 'signal');
    const b = box(f);
    let y = Math.round((H - b.h) / 2) + (bare ? 0 : f.margin * scale + 1) + f.over * scale;
    for (const line of f.laid) {
      const x0 = bare ? 0 : Math.round((W - line.width * scale) / 2);
      for (const { g, x } of line.glyphs) for (const [vx, vy] of voxels(g, scale, refine)) letters.box(x0 + x * scale + vx, y + vy, z, 1, 1, depth, mat);
      y += (font.cap + font.lineGap) * scale;
    }
    live.faceZ = z;
    live.state.scale = scale;
    live.state.fit = f;
  },

  bind(live) {
    const on = listeners();
    const el = live.el;
    const size = () => {
      const vx = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4;
      const b = box(fit(el, vx));
      el.style.inlineSize = b.w * vx + 'px';
      el.style.blockSize = b.h * vx + 'px';
    };
    size();
    on(window, 'resize', size);
    const poke = (e) => {
      if (reducedMotion()) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / live.vx, y = (e.clientY - r.top) / live.vx;
      const letters = live.model.byName.letters;
      if (!letters.fx || letters.fx.kind !== 'physics') letters.fx = physics(letters);
      letters.fx.poke(x, y, 5 + live.state.scale * 2.2, 34);
      cue('poke');
      live.invalidate();
      el.dispatchEvent(new CustomEvent('vx-poke', { bubbles: true }));
    };
    on(el, 'pointerdown', poke);
    return () => { on.done(); el.style.inlineSize = ''; el.style.blockSize = ''; };
  },
};
