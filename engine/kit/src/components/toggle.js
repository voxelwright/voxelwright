// Toggle. A knob in a channel. Behind the knob the channel floor lights up: signal means on.
// Markup: <label class="vx-toggle"><input type="checkbox" role="switch"><span class="vx-switch"></span>Label</label>

import { SLIDE } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const KNOB = 7;

export const toggle = {
  name: 'toggle',
  selector: '.vx-switch',
  pad: 6,

  build(live, m) {
    const { W, H } = live;
    const input = live.state.input = live.el.parentElement.querySelector('input');
    const off = input?.disabled;
    m.part('tray').slab(0, 0, 0, W, H, 1, off ? 'steel' : 'slate', 2);
    const lit = m.part('lit');
    lit.masked = true; lit.grounded = false;
    lit.slab(1, 1, 1, W - 2, H - 2, 1, 'signal', 1);
    const knob = m.part('knob');
    knob.grounded = false;
    knob.slab(0, 0, 1, KNOB, H - 2, 3, off ? 'steel' : 'chalk', 1);
    knob.ty = 1;
    live.faceZ = 1;
    live.state.travel = W - 2 - KNOB;
    const s = live.spring('at', input?.checked ? 1 : 0, SLIDE.k, SLIDE.c);
    if (!s.moving) s.snap(input?.checked ? 1 : 0);
  },

  pose(live) {
    const { knob, lit } = live.model.byName;
    const t = live.spring('at').x;
    const x = 1 + t * live.state.travel;
    knob.tx = x;
    knob.tz = live.spring('press').x;
    // the floor is lit from the left wall up to the middle of the knob
    const edge = x + KNOB / 2;
    for (let i = 0; i < lit.count; i++) {
      const cx = lit.rest[i * 3];
      lit.scales[i] = t <= 0.001 ? 0 : cx < edge ? 1 : 0;
    }
  },

  bind(live) {
    const on = listeners();
    const input = live.el.parentElement.querySelector('input');
    const at = live.spring('at', input.checked ? 1 : 0, SLIDE.k, SLIDE.c);
    const press = live.spring('press');
    let byKey = false;
    on(input, 'keydown', () => { byKey = true; });
    on(input, 'pointerdown', () => { byKey = false; press.to(-1, 1500, 76); live.invalidate(); });
    on(live.el.parentElement, 'pointerdown', () => { byKey = false; press.to(-1, 1500, 76); live.invalidate(); });
    on(window, 'pointerup', () => { if (press.target !== 0) { press.to(0, 620, 34); live.invalidate(); } });
    on(input, 'change', () => {
      // a key press moves it at once; a pointer slides it
      if (byKey) at.snap(input.checked ? 1 : 0); else at.to(input.checked ? 1 : 0);
      cue('slide');
      live.invalidate();
    });
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    return on.done;
  },
};
