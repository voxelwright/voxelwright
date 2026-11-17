// Lettering: words built from voxels, on an enamel board (a sign) or bare as a heading.
//   <h1 class="vx-sign">Voxelmorphism</h1>                     a board
//   <h2 class="vx-sign" data-vx-board="none">The rules</h2>    a heading
// data-vx-font names glyph sets from core/fonts/, first that fits wins (default "block sign":
// Vox Block, and Vox Sign where the column is too narrow for it). data-vx-scale fixes the voxels
// per glyph cell; otherwise a board takes the largest of data-vx-max (default 2) that fits, and
// a heading is one voxel per cell. Spacing, kerning and line gaps are the glyph set's own, in
// whole cells; depth follows scale; at two or more voxels per cell diagonals are redrawn, not
// enlarged.
//
// The words stay text. With voxels the element's own content sits in a transparent box of the
// same glyphs, laid exactly over the voxel letters, so it can be selected, copied and found.
//
// Press it and the letters under the pointer break off, fall, and mend themselves; keep holding
// and they keep breaking under the pointer, so it can be brushed. Selecting comes first: every
// gesture a device already uses to select text still selects, and play takes what is left.
//   mouse   a click breaks; press and hold, and it brushes for as long as it is held.
//           A drag, a double or triple click and a Shift-click select, as in any text.
//   touch   a tap breaks; a thumb moved sideways brushes. Up and down scrolls the page and a
//           resting thumb selects, as in any text, and neither breaks anything.
// data-vx-press="play" gives every mouse press to play (it breaks on the press and brushes at
// once; the text is then selected by dragging in from outside). A board is "play" unless it says
// data-vx-press="text"; a heading is "text". With less motion asked for, nothing breaks and
// lettering is plain text to every gesture. vx-poke fires once for each press that breaks.

import { FONTS, measure, layout, voxels } from '../core/fonts/index.js';
import '../core/fonts/sign.js';
import '../core/fonts/sentence.js';
import '../core/fonts/block.js';
import { reducedMotion } from '../core/motion.js';
import { hash3 } from '../core/materials.js';
import { cue } from '../core/sound.js';
import { listeners, wrapLabel } from './util.js';

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
      // Lines keep the set's own gap. A line opens further only where a tail above (Щ, Ц, a comma)
      // would otherwise meet a mark below (Ї, Й): tail + mark + one clear cell.
      const gaps = laid.slice(1).map((l, i) => Math.max(font.lineGap, laid[i].bottom - font.cap - l.top + 1));
      const rows = lines.length * font.cap + gaps.reduce((a, b) => a + b, 0);
      // The box runs from the cap line of the first line to the baseline of the last, as a trimmed
      // text box does. Tails and accents hang outside it, in the bleed, so the plain version and
      // the voxels have the same footprint. On a board they are given room.
      const over = bare ? 0 : -laid[0].top, under = bare ? 0 : laid[laid.length - 1].bottom - font.cap;
      last = { text, font, lines, laid, gaps, width, rows, over, under, scale, margin: m, bare };
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
    // A held pointer: { x, y, px, py, r, f }. Each frame, whatever rests between where it was and
    // where it is is knocked loose once, and whatever is already loose there stays loose. A kick
    // sets a speed, it never adds to one, so holding still cannot throw anything further.
    brush: null, frame: 0, onkick: null,
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
      const b = this.brush;
      let kicked = 0;
      if (b) {
        this.frame++;
        const sx = b.x - b.px, sy = b.y - b.py, len2 = sx * sx + sy * sy;
        for (let i = 0; i < n; i++) {
          // distance from the voxel's home to the stroke since the last frame
          const hx = rest[i * 3] - b.px, hy = rest[i * 3 + 1] - b.py;
          const u = len2 ? Math.max(0, Math.min(1, (hx * sx + hy * sy) / len2)) : 0;
          const dx = hx - sx * u, dy = hy - sy * u, d = Math.hypot(dx, dy);
          if (d > b.r) continue;
          if (free[i] > 0) { free[i] = Math.max(free[i], 0.3); continue; }
          const k = 1 - d / b.r, r = hash3(i, this.frame, 3), r2 = hash3(this.frame, i, 11);
          vel[i * 3] = (dx / (d + 0.5)) * b.f * (0.4 + k) * (0.5 + r) + (r2 - 0.5) * 6;
          vel[i * 3 + 1] = (dy / (d + 0.5)) * b.f * (0.4 + k) * (0.5 + r2) - b.f * 0.5;
          vel[i * 3 + 2] = b.f * (0.5 + r);
          spin[i] = (r - 0.5) * 26;
          axis[i * 3] = r - 0.5; axis[i * 3 + 1] = r2 - 0.5; axis[i * 3 + 2] = 0.3;
          free[i] = 0.45 + r2 * 0.4;
          kicked++;
        }
        b.px = b.x; b.py = b.y;
        busy = true;
        if (kicked && this.onkick) this.onkick(kicked);
      }
      for (let i = 0; i < n; i++, o += 8) {
        let ox = off[i * 3], oy = off[i * 3 + 1], oz = off[i * 3 + 2];
        if (free[i] > 0) {
          free[i] -= dt;
          vel[i * 3 + 1] += 95 * dt;
          ox += vel[i * 3] * dt; oy += vel[i * 3 + 1] * dt; oz += vel[i * 3 + 2] * dt;
          if (oy > 240) { oy = 240; vel[i * 3 + 1] = 0; } // held loose for long: far enough out of sight
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
    f.laid.forEach((line, i) => {
      const x0 = bare ? 0 : Math.round((W - line.width * scale) / 2);
      for (const { g, x } of line.glyphs) for (const [vx, vy] of voxels(g, scale, refine)) letters.box(x0 + x * scale + vx, y + vy, z, 1, 1, depth, mat);
      y += (font.cap + (f.gaps[i] ?? font.lineGap)) * scale;
    });
    live.faceZ = z;
    live.state.scale = scale;
    live.state.fit = f;
    // The same words as text, in a box laid over the voxel letters: the glyph set and scale that
    // were chosen, the board's margin, and a width that breaks the lines where the voxels break.
    const text = wrapLabel(el, 'vx-lettering-text');
    const top = Math.round((H - b.h) / 2) + (bare ? 0 : f.margin * scale + 1) + f.over * scale;
    text.dataset.vxSet = font.id;
    text.toggleAttribute('data-vx-caps', Boolean(font.upper));
    for (const [name, value] of [['--_s', scale], ['--_gap', font.gap], ['--_lh', (font.cap + font.lineGap) / 10], ['--_pt', top], ['--_pi', bare ? 0 : Math.round((W - f.width * scale) / 2)]]) text.style.setProperty(name, value);
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
    const letters = () => live.model.byName.letters;
    const fx = () => {
      const part = letters();
      if (!part.fx || part.fx.kind !== 'physics') part.fx = physics(part);
      return part.fx;
    };
    const at = (e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / live.vx, (e.clientY - r.top) / live.vx]; };
    const playFirst = () => (el.dataset.vxPress || (el.dataset.vxBoard === 'none' ? 'text' : 'play')) === 'play';
    const told = () => el.dispatchEvent(new CustomEvent('vx-poke', { bubbles: true }));
    // one burst: a click, a tap, or the press itself where presses belong to play
    const burst = (e) => {
      const [x, y] = at(e);
      fx().poke(x, y, 5 + live.state.scale * 2.2, 34);
      cue('poke');
      live.invalidate();
    };

    // One press at a time. It waits until what the hand does says which it is, then it is a
    // brush, or it is left to the page (a selection, a scroll) and nothing here touches it.
    const HOLD = 200, TAP = 300; // ms: a held mouse press starts to brush; a touch longer than a tap is not a tap
    let press = null;
    let heard = 0;
    const brushOn = (e) => {
      const [x, y] = at(e);
      const f = fx();
      f.brush = { x, y, px: x, py: y, r: 3 + live.state.scale * 1.6, f: 20 };
      f.onkick = () => { const now = performance.now(); if (now - heard > 120) { heard = now; cue('poke'); } };
      press.mode = 'brush';
      try { el.setPointerCapture(e.pointerId); } catch {}
      // a selection this press began is taken back, and none can begin while it brushes
      const sel = getSelection();
      if (sel && (sel.isCollapsed || el.contains(sel.anchorNode))) sel.removeAllRanges();
      document.documentElement.setAttribute('data-vx-brushing', '');
      live.invalidate();
    };
    const end = () => {
      if (!press) return;
      clearTimeout(press.timer);
      if (press.mode === 'brush') {
        const part = letters();
        if (part.fx?.kind === 'physics') part.fx.brush = null;
        document.documentElement.removeAttribute('data-vx-brushing');
      }
      press = null;
    };
    on(el, 'pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0 || e.shiftKey || reducedMotion()) return;
      end();
      press = { id: e.pointerId, touch: e.pointerType === 'touch', x: e.clientX, y: e.clientY, t: performance.now(), mode: 'wait', last: e };
      if (press.touch) return; // a touch says what it is by moving, or by lifting
      if (playFirst()) { burst(e); told(); brushOn(e); return; }
      press.timer = setTimeout(() => { if (press?.mode === 'wait') { told(); brushOn(press.last); } }, HOLD);
    });
    // where presses belong to play, a press never starts a selection
    on(el, 'mousedown', (e) => { if (e.button === 0 && !e.shiftKey && !reducedMotion() && playFirst()) e.preventDefault(); });
    on(el, 'pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      press.last = e;
      if (press.mode === 'brush') {
        const b = letters().fx?.brush;
        if (b) { [b.x, b.y] = at(e); live.invalidate(); }
        return;
      }
      if (press.mode !== 'wait') return;
      const dx = e.clientX - press.x, dy = e.clientY - press.y;
      if (press.touch) {
        // the page takes a thumb that moves up or down (touch-action: pan-y); sideways is a brush
        if (Math.hypot(dx, dy) < 10) return;
        if (Math.abs(dx) >= Math.abs(dy)) { told(); brushOn(e); } else press.mode = 'left';
      } else if (Math.hypot(dx, dy) > 4) { clearTimeout(press.timer); press.mode = 'left'; } // a drag: a selection
    });
    on(el, 'pointerup', (e) => {
      if (!press || e.pointerId !== press.id) return;
      // a click, or a tap: it did not move, and it was let go before it became a hold
      if (press.mode === 'wait' && performance.now() - press.t < (press.touch ? TAP : HOLD + 50)) { burst(e); told(); }
      end();
    });
    on(el, 'pointercancel', (e) => { if (press && e.pointerId === press.id) end(); });
    // (a touch is first captured by the text it landed on; that capture ending is not ours ending)
    on(el, 'lostpointercapture', (e) => { if (e.target === el && press && e.pointerId === press.id && press.mode === 'brush') end(); });
    return () => {
      end();
      on.done();
      el.style.inlineSize = ''; el.style.blockSize = '';
      // the words go back to being the element's own content
      const text = el.querySelector(':scope > .vx-lettering-text');
      if (text) text.replaceWith(...text.childNodes);
    };
  },
};
