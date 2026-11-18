// Slider. A thumb riding a channel; the channel is lit behind it.
// Markup: <span class="vx-slider"><input type="range" min="0" max="100" value="40"></span>

import { inlineX, watchDirection } from '../plain.js';
import { PRESS, RELEASE } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners, clamp } from './util.js';

const THUMB = 5;

export const slider = {
  name: 'slider',
  selector: '.vx-slider',
  pad: 6,

  build(live, m) {
    const { W, H } = live;
    const y = Math.floor((H - 5) / 2);
    m.part('rail').slab(0, y, 0, W, 5, 2, 'steel', 1).carve(1, y + 1, 1, W - 2, 3, 1);
    m.part('floor').box(1, y + 1, 0, W - 2, 3, 1, 'slate');
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false;
    lit.covered = true; // its voxels appear under the thumb, never in the open
    lit.box(1, y + 1, 0, W - 2, 3, 1, 'signal');
    lit.tz = 0.03;
    const thumb = m.part('thumb');
    thumb.grounded = false;
    thumb.slab(0, 1, 1, THUMB, H - 2, 4, live.el.querySelector('input')?.disabled ? 'steel' : 'enamel', 1);
    live.faceZ = 2;
    live.state.inlineX = inlineX(live);
    live.state.travel = W - THUMB;
  },

  pose(live) {
    const input = live.el.querySelector('input');
    const { thumb, lit } = live.model.byName;
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const t = max > min ? clamp((Number(input.value) - min) / (max - min), 0, 1) : 0;
    const x = t * live.state.travel;
    thumb.tx = live.state.inlineX(x, THUMB);
    thumb.tz = live.spring('press').x;
    const edge = x + THUMB / 2;
    for (let i = 0; i < lit.count; i++) lit.scales[i] = Math.max(0, Math.min(1, edge - live.state.inlineX(lit.rest[i * 3], 0) + 0.5));
  },

  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    const input = live.el.querySelector('input');
    const press = live.spring('press');
    // while the pointer is down the thumb follows the value exactly: no easing
    on(input, 'input', () => { cue('tick'); live.invalidate(); });
    on(input, 'change', () => live.invalidate());
    on.heed(input, 'value', () => live.invalidate()); // set from code
    on(input, 'pointerdown', () => { press.to(-1.5, PRESS.k, PRESS.c); live.invalidate(); });
    const release = () => {
      if (press.target === 0) return;
      press.to(0, RELEASE.k, RELEASE.c);
      live.invalidate();
    };
    for (const type of ['pointerup', 'pointercancel', 'blur']) on(window, type, release);
    on.watch(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max', 'value'] }, () => live.rebuild());
    return on.done;
  },
};
