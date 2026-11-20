// The name of a keyboard key is a small keycap standing in the line of words: a sidewall one
// course high and a top one voxel smaller all round, with the legend on the top, as on a key.
import { wrapLabel } from './util.js';

export const kbd = {
  name: 'kbd',
  selector: '.vx-kbd',
  pad: 4,

  build(live, m) {
    const { W, H } = live;
    const cap = m.part('cap');
    // the skirt: the cap's sidewall, its full size, one course
    cap.slab(0, 0, 0, W, H, 1, 'key', 1);
    // the top, sculpted in: a voxel smaller all round where the cap is big enough
    const inset = W >= 5 && H >= 5 ? 1 : 0;
    cap.slab(inset, inset, 1, W - 2 * inset, H - 2 * inset, 1, 'key', 1);
    live.faceZ = 2;
    live.label(live.el.querySelector(':scope > .vx-label'), () => live.faceZ);
  },

  bind(live) { wrapLabel(live.el); },
};
