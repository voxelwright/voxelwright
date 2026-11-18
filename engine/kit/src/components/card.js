// Note card. A chalk slab two voxels proud of the page. data-vx-edge names a material for a spine
// along its inline-start edge, which says what kind of note it is.
// Markup: <article class="vx-card" data-vx-edge="leaf">...</article>

import { inlineX, watchDirection } from '../plain.js';
import { listeners } from './util.js';

export const card = {
  name: 'card',
  selector: '.vx-card',
  pad: 7,

  build(live, m) {
    const { W, H, el } = live;
    const body = m.part('body');
    const d = live.look.slab;
    body.slab(0, 0, 0, W, H, d, 'chalk', live.look.round);
    const edge = el.dataset.vxEdge;
    if (edge) {
      const spine = m.part('spine');
      spine.grounded = false;
      const sw = live.look.round, sy = live.look.round; // the spine is as wide as the corner step, and starts below it
      const x = inlineX(live);
      spine.box(x(0, sw), sy, d, sw, H - sy * 2, 1, edge);
    }
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-edge'] }, () => live.rebuild());
    return on.done;
  },
};
