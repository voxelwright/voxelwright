// Block. The plain solid everything else is made from: one material, a height in voxels.
// Use it for swatches, dividers, plinths, or as the base of a component of your own.
// Markup: <span class="vx-block" data-vx-material="walnut" data-vx-depth="3"></span>

import { listeners } from './util.js';

export const block = {
  name: 'block',
  selector: '.vx-block',
  pad: 8,

  build(live, m) {
    const { W, H, el } = live;
    const d = Math.max(1, Number(el.dataset.vxDepth || 2));
    m.part('body').slab(0, 0, 0, W, H, d, el.dataset.vxMaterial || 'chalk', Number(el.dataset.vxRound ?? 1));
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-material', 'data-vx-depth', 'data-vx-round'] }, () => live.rebuild());
    return on.done;
  },
};
