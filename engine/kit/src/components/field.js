// Text field. A well cut into the page: you type on the floor of it, two voxels down. The page's
// own edge throws a shadow onto the floor along the top and left, which is what says "sunk".
// The walls change material when the field has focus (enamel) or holds something invalid (brick).
// Markup: <label class="vx-field"><span class="vx-field-label">Idea</span><span class="vx-well"><input></span></label>

import { listeners } from './util.js';


export const field = {
  name: 'field',
  selector: '.vx-well',
  pad: 5,

  build(live, m) {
    const { W, H, el } = live;
    const DEPTH = live.look.well;
    const input = el.querySelector('input, textarea');
    const wall = input?.matches(':focus') ? 'enamel' : input?.getAttribute('aria-invalid') === 'true' ? 'brick' : 'slate';
    // walls stand around the hole, below the page; only their inner faces can be seen through it
    const walls = m.part('walls');
    walls.sunk = true;
    walls.box(-1, -1, -DEPTH, W + 2, H + 2, DEPTH, wall).carve(0, 0, -DEPTH, W, H, DEPTH);
    const floor = m.part('floor');
    floor.sunk = true;
    floor.box(0, 0, -DEPTH - 1, W, H, 1, input?.disabled ? 'slate' : 'floor');
    live.well = [0, 0, W, H];
    live.faceZ = 0; // the hole is where the element is; the floor shows through it, a voxel up and left
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
