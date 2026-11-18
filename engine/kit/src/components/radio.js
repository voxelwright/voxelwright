// Radio group. Each choice is a small well with a one-voxel corner step; the chosen one is full of
// light to the level of the surface. The light grows cube by cube from the middle, and goes the
// same way.
// Tool: well (a hole) with the accent's light in it. Not a key: nothing stands up.
// Markup: <fieldset class="vx-radios" role="radiogroup">
//           <legend>Deploy to</legend>
//           <label class="vx-radio"><input type="radio" name="where" value="fra" checked><span class="vx-dot"></span>Frankfurt</label>
//           <label class="vx-radio"><input type="radio" name="where" value="iad"><span class="vx-dot"></span>Virginia</label>
//         </fieldset>
// The inputs are real radios of one name, so the browser gives the group its keys: one tab stop
// (the chosen one, or the first), arrow keys that move the choice and go round at the ends, Space
// to choose the one in focus. This part only draws what the inputs say.

import { hole, halo, byTheme, warmth } from '../core/light.js';
import { CALM, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const level = (input) => (input?.checked ? 1 : 0);
const inputOf = (el) => el.parentElement.querySelector('input[type="radio"]');
/** The radios an input is one of: the same name, in the same form (or in none). */
const group = (input) => (input.name
  ? [...input.getRootNode().querySelectorAll('input[type="radio"]')].filter((r) => r.name === input.name && r.form === input.form)
  : [input]);

export const radio = {
  name: 'radio',
  selector: '.vx-dot',
  pad: 6,
  glowRadius: 2.8,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H } = live, D = live.look.well;
    const input = live.state.input = inputOf(live.el);
    const off = !!input?.matches(':disabled');
    const { walls } = hole(live, m, { depth: D, wall: off ? 'slate' : 'light-warm', floor: off ? 'slate' : 'floor' });
    // The corner step. A hole is cut square, so the wall comes in to fill each corner, and the
    // surface is laid back over it: one voxel of chalk that belongs to the page, not to the hole.
    // It sits a hair in from the wall's faces, so what shows in the hole is the wall and its light.
    const lid = m.part('lid');
    const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
    for (const [x, y] of corners) { walls.box(x, y, -D, 1, 1, D, off ? 'slate' : 'light-warm'); lid.box(x, y, -1, 1, 1, 1, 'chalk'); }
    lid.tx = lid.ty = 0.02;
    // the light: every cube of the hole, born from the middle outwards
    const fill = m.part('fill');
    fill.sunk = true; fill.grounded = false;
    const cx = (W - 1) / 2, cy = (H - 1) / 2, far = Math.hypot(cx, cy) || 1;
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      if ((i === 0 || i === W - 1) && (j === 0 || j === H - 1)) continue;
      for (let k = -D; k < 0; k++) fill.plot(i, j, k, off ? 'steel' : 'light', 0.02 + 0.9 * Math.hypot(i - cx, j - cy) / far);
    }
    const s = live.spring('on', level(input), CALM.k * 2.2, CALM.c * 1.5);
    if (live.state.built === undefined) s.snap(level(input));
    live.state.built = true;
    live.state.posed = false;
  },

  pose(live) {
    // first drawing: as it is, with no growing in
    if (!live.state.posed) { live.state.posed = true; live.model.byName.fill.grow(live.spring('on').x, 0); }
    const on = Math.max(0, Math.min(1, live.spring('on').x));
    // empty, it is a well like any other; full, its light is the accent's and lies on the surface
    live.glowStrength = halo(0.05) * (warmth(live) * (1 - on) + byTheme(live) * 1.3 * on);
  },

  step(live, dt) {
    return live.model.byName.fill.grow(live.spring('on').x, dt);
  },

  bind(live) {
    const on = listeners();
    const input = inputOf(live.el);
    if (!input) return on.done;
    const set = () => {
      const s = live.spring('on'), to = level(input);
      if (s.target === to) return;
      // with less motion asked for the light does not grow: it is there, or it is not
      if (reducedMotion()) { s.snap(to); live.state.posed = false; } else s.to(to);
      live.invalidate();
    };
    live.state.sync = set;
    // Choosing one radio empties another, and the one that is emptied is told nothing: no event,
    // no property set. So each listens for a choice anywhere in its group.
    const mine = (e) => e.target?.type === 'radio' && e.target.name === input.name && e.target.form === input.form;
    on(input.getRootNode(), 'change', (e) => { if (!mine(e)) return; if (e.target === input) cue('tick'); set(); });
    // set from code: the whole group follows, without a sound
    on.heed(input, 'checked', () => { for (const r of group(input)) live.stage.lives.get(r.parentElement?.querySelector('.vx-dot'))?.state.sync?.(); });
    // a form put back to how it began: the inputs change after the event, so look a moment later
    if (input.form) on(input.form, 'reset', () => setTimeout(set));
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    const set_ = input.closest('fieldset');
    if (set_) on.watch(set_, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    return on.done;
  },
};
