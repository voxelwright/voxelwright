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
      const plate = m.part('plate'), face = look.readingPlate ?? 'key';
      plate.slab(0, 0, 0, W, H, up, face, 1);
      live.faceZ = up;
      if (el.dataset.vxMount === 'clips') {
        // Each folded steel end sits in a gasket at the edge of the insert.
        // Its return overlaps the reading face by one cell, clear of the text.
        const clips = m.part('retainers');
        const y = Math.floor((H - 5) / 2);
        for (const [edge, lip] of [[0, 0], [W - 1, W - 2]]) {
          plate.box(edge, y - 1, 0, 1, 7, up, 'gasket');
          plate.carve(edge, y, 0, 1, 5, up);
          clips.box(edge, y, 0, 1, 5, up, 'steel');
          clips.box(lip, y + 1, up, 2, 3, 1, 'steel');
        }
      }
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
