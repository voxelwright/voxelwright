// Kbd. The name of a key, in a line of words or at the end of a menu's row. A small low cap with
// no light under it: it names a key, it is not one, so it does not stand up like one and nothing
// in it answers a press.
// Tool: a cap, as low as a key that is held down, and no ring of light.
// Markup: <kbd class="vx-kbd">K</kbd>
//         Keys held together: <kbd class="vx-keys"><kbd class="vx-kbd">Ctrl</kbd>+<kbd class="vx-kbd">K</kbd></kbd>

import { wrapLabel } from './util.js';

import { cap as capOf } from '../core/light.js';

export const kbd = {
  name: 'kbd',
  selector: '.vx-kbd',
  pad: 4,

  build(live, m) {
    const { W, H } = live, look = live.look;
    // as high as a key at the bottom of its travel: what is left of a key that cannot be pressed
    const d = Math.max(1, look.rise - look.travel);
    capOf(m.part('cap'), 0, 0, 0, W, H, d, 'key'); // it names a key, so it is the same cap, low and with no light
    live.faceZ = d;
    // the legend is cut from half-voxel cells: the stage keeps it on whole pixels, wherever a
    // line of words has left the cap
    live.label(live.el.querySelector(':scope > .vx-label'), () => live.faceZ);
  },

  bind(live) { wrapLabel(live.el); },
};
