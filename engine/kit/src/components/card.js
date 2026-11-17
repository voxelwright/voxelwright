// Note card. A chalk slab two voxels proud of the page. data-vx-edge names a material for a spine
// down its left side, which says what kind of note it is.
// Markup: <article class="vx-card" data-vx-edge="leaf">...</article>

import { listeners } from './util.js';

export const card = {
  name: 'card',
  selector: '.vx-card',
  pad: 7,

  build(live, m) {
    const { W, H, el } = live;
    const body = m.part('body');
    body.slab(0, 0, 0, W, H, 2, 'chalk', 2);
    const edge = el.dataset.vxEdge;
    if (edge) {
      const spine = m.part('spine');
      spine.grounded = false;
      spine.box(0, 2, 2, 2, H - 4, 1, edge);
    }
    live.faceZ = 2;
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-edge'] }, () => live.rebuild());
    return on.done;
  },
};
