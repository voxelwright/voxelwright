// Pagination. A trench of seats; the current page is the key in it, level with the surface and
// standing on its light. The other pages are words down in the trench. Previous and next are
// the kit's own keys (.vx-button) beside it, and are not drawn here.
// Tool: well (a trench) with a key in it, as tabs are.
// Markup: <nav class="vx-pagination" aria-label="Pages of deploys">
//           <a class="vx-button" rel="prev" href="?page=4" aria-label="Previous page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//           <ol class="vx-pagination-pages">
//             <li><a href="?page=4" aria-label="Page 4">4</a></li>
//             <li><a href="?page=5" aria-label="Page 5" aria-current="page">5</a></li>
//             <li class="vx-pagination-gap"><span aria-hidden="true">…</span><span class="vx-pagination-aloud">More pages</span></li>
//           </ol>
//           <a class="vx-button" rel="next" href="?page=6" aria-label="Next page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//         </nav>
// The seats are real links: Tab reaches each, Enter follows it, and the page (or the app's
// router) says which is current with aria-current="page". The part reads that and nothing else:
// when it moves from one seat to another the key slides there; when the seats themselves are
// written again the key is simply where the current one is.

import { hole, ring, halo, byTheme, cap as capOf } from '../core/light.js';
import { SLIDE, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const currentOf = (el) => el.querySelector(':scope > li > a[aria-current]:not([aria-current="false"])');

export const pagination = {
  name: 'pagination',
  selector: '.vx-pagination-pages',
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.07),

  build(live, m) {
    const { H, el, vx } = live, D = live.look.well;
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // the words do not move; they are registered so that they are kept on whole pixels
    // A word nudged for the last model is put back first. The stage drops its labels on a rebuild
    // without taking their nudges off, measures the words where they then lie (already nudged, so
    // it finds nothing to do), and the next drawing clears the nudge: the words end off the pixel
    // grid. Without this line tools/parts/pagination.mjs fails "every number starts on a whole
    // pixel" after the first press. It can go once Live.rebuild() clears them itself.
    for (const a of el.querySelectorAll(':scope > li > a, :scope > li.vx-pagination-gap > [aria-hidden]')) { a.style.transform = ''; live.label(a, () => live.faceZ); }
    const cur = currentOf(el);
    const glide = live.state.glide && !reducedMotion();
    live.state.glide = false;
    live.state.has = !!cur;
    if (!cur) return; // no current page: an empty trench
    // where the current seat is, in voxels from the trench's own edge
    const box = el.getBoundingClientRect(), seat = cur.getBoundingClientRect();
    const x0 = Math.round((seat.left - box.left) / vx), w = Math.max(3, Math.round((seat.right - box.left) / vx) - x0);
    // the key: a ring of light on the floor of the trench and a cap on it, its top level with the
    // surface, a voxel clear of the trench's walls and of the seats beside it
    const block = m.part('block');
    block.grounded = false;
    ring(block, 1, 1, -D, w - 2, H - 2, 'light');
    capOf(block, 1, 1, 1 - D, w - 2, H - 2, Math.max(1, D - 1), 'key');
    const s = live.spring('x', x0, SLIDE.k * 1.25, SLIDE.c * 1.12);
    if (glide && live.state.was !== undefined) { s.to(x0); if (live.state.was !== x0) cue('slide'); } else s.snap(x0);
    live.state.was = x0;
  },

  pose(live) {
    if (live.state.has) live.model.byName.block.tx = live.spring('x').x;
    live.glowStrength = halo(0.07) * byTheme(live);
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'data-vx-when'] }, (list) => {
      const real = list.filter((r) => r.target !== live.canvas && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n === live.canvas)));
      if (!real.length) return;
      // an app that writes the whole list again takes the canvas out with the old seats
      if (!live.canvas.isConnected) live.el.prepend(live.canvas);
      // only which seat is current changed: the key slides. Seats written again: it is put there.
      live.state.glide = real.every((r) => r.type === 'attributes' && r.attributeName === 'aria-current');
      live.rebuild();
    });
    return on.done;
  },
};
