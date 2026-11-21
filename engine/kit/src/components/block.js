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
    if (el.dataset.vxProfile === 'depth-sample') {
      // Keep the steel datum fixed against the grid as courses are added above it.
      const sample = m.part('body');
      sample.slab(-1, -1, 0, W + 2, H + 2, 1, 'steel');
      for (const x of [-4, W]) {
        const y = Math.floor(H / 2) - 2;
        sample.slab(x, y, 0, 4, 5, 1, 'steel');
        sample.carve(x + 1, y + 2, 0, 2, 1, 1);
      }
      sample.slab(0, 0, 1, W, H, d, el.dataset.vxMaterial || 'chalk');
      // An inlaid scale on the exposed edge, with a longer mark every fourth course.
      for (let z = 2; z <= d; z += 2) {
        sample.box(3, 0, z, z % 4 === 0 ? 3 : 1, 1, 1, 'steel');
      }
      live.faceZ = 9; // fixed origin leaves room on the gridded bench for the longest shadow
      live.pad = 16; // room for the twelve-course cast shadow
      return;
    }
    m.part('body').slab(0, 0, 0, W, H, d, el.dataset.vxMaterial || 'chalk', Number(el.dataset.vxRound ?? 1));
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-material', 'data-vx-depth', 'data-vx-round', 'data-vx-profile'] }, () => live.rebuild());
    return on.done;
  },
};
