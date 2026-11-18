// Bubble. A message set as a bubble. Theirs is set a level into the surface: a window cut into
// the panel, with no light in its rim. Yours stands a voxel above the surface: a plate, not a
// key, so its top has no step and it stands on no light.
// Tool: well (theirs, a hole with plain walls) and a low plate (yours). No light on either.
// Markup: <div class="vx-bubble"><p>The words.</p></div>                      theirs
//         <div class="vx-bubble" data-vx-from="me"><p>The words.</p></div>    yours
//         Inside a message it takes its side from the message (.vx-message[data-vx-from="me"]);
//         data-vx-from on the bubble itself wins.
// The words are the page's own text: they select, copy and wrap as any words do. Nothing in a
// bubble answers a press, so this file has no behaviour: it draws, and draws again when the
// side changes.

import { hole } from '../core/light.js';
import { listeners } from './util.js';

const mine = (el) => (el.dataset.vxFrom ?? el.closest('.vx-message')?.dataset.vxFrom) === 'me';

export const bubble = {
  name: 'bubble',
  selector: '.vx-bubble',
  pad: 5,

  build(live, m) {
    const { W, H, el } = live, look = live.look;
    if (mine(el)) {
      // one voxel: the look's own step, the one depth it has for "a voxel"
      const up = look.step;
      m.part('plate').slab(0, 0, 0, W, H, up, live.look.readingPlate ?? 'key', 1);
      live.faceZ = up;
    } else {
      const D = look.well;
      hole(live, m, { depth: D, wall: 'slate', floor: 'floor' });
      // the CSS keeps the words clear of the wall, and must know how deep the hole is
      if (live.state.deep !== D) el.style.setProperty('--vx-bubble-deep', live.state.deep = D);
    }
  },

  bind(live) {
    const on = listeners(), el = live.el, msg = el.closest('.vx-message');
    on.watch(el, { attributes: true, attributeFilter: ['data-vx-from'] }, () => live.rebuild());
    if (msg) on.watch(msg, { attributes: true, attributeFilter: ['data-vx-from'] }, () => live.rebuild());
    return on.done;
  },
};
