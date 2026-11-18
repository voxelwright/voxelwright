// Checkbox. A small well; ticked, it is full of light to the level of the surface. The light
// grows cube by cube from the middle, and goes the same way.
// Tool: well (a hole) with the accent's light in it. Not a key: nothing stands up.
// Markup: <label class="vx-check"><input type="checkbox"><span class="vx-box"></span>Label</label>
//         An indeterminate one (input.indeterminate = true) is half full.

import { hole, halo, byTheme, warmth } from '../core/light.js';
import { CALM } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const level = (input) => (input?.indeterminate ? 0.5 : input?.checked ? 1 : 0);

export const checkbox = {
  name: 'checkbox',
  selector: '.vx-box',
  pad: 6,
  glowRadius: 2.8,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H } = live, D = 2;
    const input = live.state.input = live.el.parentElement.querySelector('input');
    const off = !!input?.disabled;
    hole(live, m, { depth: D, wall: off ? 'slate' : 'light-warm', floor: off ? 'slate' : 'floor' });
    // the light: every cube of the hole, born from the middle outwards
    const fill = m.part('fill');
    fill.sunk = true; fill.grounded = false;
    const cx = (W - 1) / 2, cy = (H - 1) / 2, far = Math.hypot(cx, cy) || 1;
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) for (let k = -D; k < 0; k++) fill.plot(i, j, k, off ? 'steel' : 'light', 0.02 + 0.9 * Math.hypot(i - cx, j - cy) / far);
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
    const input = live.el.parentElement.querySelector('input');
    const set = (quiet) => { live.spring('on').to(level(input)); if (!quiet) cue('tick'); live.invalidate(); };
    on(input, 'change', () => set(false));
    // set from code: it follows, without a sound
    on.heed(input, 'checked', () => set(true));
    on.heed(input, 'indeterminate', () => set(true));
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    return on.done;
  },
};
