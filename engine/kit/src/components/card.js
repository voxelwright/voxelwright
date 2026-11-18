// Note card. A chalk slab two voxels proud of the page. data-vx-edge names a material for a spine
// along its inline-start edge, which says what kind of note it is.
// Markup: <article class="vx-card" data-vx-edge="leaf">...</article>

import { inlineX, watchDirection } from '../plain.js';
import { listeners } from './util.js';

export function cardSpine(live, m, depth, height = live.H) {
  const edge = live.el.dataset.vxEdge;
  if (!edge) return;
  const width = live.look.round;
  const spine = m.part('spine');
  spine.grounded = false;
  spine.box(inlineX(live)(0, width), width, depth, width, height - width * 2, 1, edge);
}

export const card = {
  name: 'card',
  selector: '.vx-card',
  pad: 7,

  build(live, m) {
    const { W, H } = live;
    const body = m.part('body');
    const d = live.look.slab;
    body.slab(0, 0, 0, W, H, d, 'chalk', live.look.round);
    cardSpine(live, m, d);
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-edge'] }, () => live.rebuild());
    return on.done;
  },
};
