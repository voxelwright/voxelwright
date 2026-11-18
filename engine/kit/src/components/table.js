// Table. Words on the surface: no voxels, but for one thing. Between the head and the body there
// is one groove, cut where the head ends, so a table is written as a table and nothing else.
// Tool: none; the groove between head and body. Rows are parted by a hairline (css/table.css).
// Markup: <div class="vx-table"><div class="vx-table-scroll" tabindex="0" role="region" aria-labelledby="id-of-the-caption">
//           <table><caption id="…">…</caption><thead>…</thead><tbody>…</tbody></table></div></div>
//         The outer element holds still and carries the groove; the inner one scrolls a wide
//         table inside itself. With no script the groove is the head's own bottom border.

import { hole, halo, warmth } from '../core/light.js';

export const table = {
  name: 'table',
  selector: '.vx-table',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { el, W, vx } = live;
    const head = el.querySelector('thead');
    if (!head) return;
    // where the head ends, in voxels from the top of the model (the stage centres what is left
    // over when the element is not a whole number of voxels tall)
    const slack = (live.cssH - live.H * vx) / 2;
    const at = (head.getBoundingClientRect().bottom - el.getBoundingClientRect().top - slack) / vx - 1;
    const y = Math.round(at), off = Math.abs(at - y) < 0.01 ? 0 : at - y;
    // a groove's depth is the look's (the lit look names none yet: a groove is one voxel down)
    const { walls, floor } = hole(live, m, { x: 0, y, w: W, h: 1, depth: live.look.groove ?? 1, wall: 'light-warm', floor: 'light-warm' });
    // a caption or a head that is not a whole number of voxels tall: the groove goes where the
    // head really ends, not to the nearest voxel
    if (off) { walls.ty = off; floor.ty = off; live.well = [0, y + off, W, y + 1 + off]; }
  },

  pose(live) { live.glowStrength = halo(0.05) * warmth(live); },

  bind(live) {
    // the head grows or shrinks (a heading wraps) without the table's own box changing: the
    // groove follows
    const head = live.el.querySelector('thead');
    if (!head) return null;
    let first = true;
    const watch = new ResizeObserver(() => { if (first) first = false; else live.rebuild(); });
    watch.observe(head);
    return () => watch.disconnect();
  },
};
