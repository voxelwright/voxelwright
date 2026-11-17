// Text field. A well cut into a slab: you type on the floor of it. The rim changes material
// when the field has focus (enamel) or holds something invalid (brick).
// Markup: <label class="vx-field"><span class="vx-field-label">Idea</span><span class="vx-well"><input></span></label>

import { listeners } from './util.js';

export const field = {
  name: 'field',
  selector: '.vx-well',
  pad: 5,

  build(live, m) {
    const { W, H, el } = live;
    const input = el.querySelector('input, textarea');
    const rim = input?.matches(':focus') ? 'enamel' : input?.getAttribute('aria-invalid') === 'true' ? 'brick' : input?.disabled ? 'steel' : 'slate';
    m.part('rim').slab(0, 0, 0, W, H, 2, rim, 1).carve(1, 1, 0, W - 2, H - 2, 2);
    m.part('floor').box(1, 1, 0, W - 2, H - 2, 1, input?.disabled ? 'slate' : 'chalk');
    live.faceZ = 1;
  },

  bind(live) {
    const on = listeners();
    const input = live.el.querySelector('input, textarea');
    // focus changes many times a minute while tabbing through a form: it swaps, it does not animate
    on(input, 'focus', () => live.rebuild());
    on(input, 'blur', () => live.rebuild());
    on.watch(input, { attributes: true, attributeFilter: ['disabled', 'aria-invalid'] }, () => live.rebuild());
    return on.done;
  },
};
