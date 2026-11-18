// List group. Rows of words parted by hairlines; the current row is marked by an accent groove
// at its start. The rows and the hairlines are plain HTML and CSS: the part draws only the mark.
// Tool: groove (a channel one voxel deep, full of the accent's light). Nothing stands up.
// Markup: <ul class="vx-list-group">
//           <li><a href="/harbor-api" aria-current="page">harbor-api</a></li>
//           <li><a href="/fog-site">fog-site</a></li>
//         </ul>
// The current row is the first with aria-current on it, or on the link or button in it. The mark
// is drawn from that and from nothing else: set it from code and the mark is drawn again.

import { hole, halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';

const rowsOf = (el) => [...el.children].filter((n) => n.tagName === 'LI');
const on = (n) => !!n && n.hasAttribute('aria-current') && n.getAttribute('aria-current') !== 'false';
const isCurrent = (li) => on(li) || [...li.children].some(on);

export const listGroup = {
  name: 'list-group',
  selector: '.vx-list-group',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, el, vx } = live;
    const li = rowsOf(el).find(isCurrent);
    if (!li) return; // no current row: nothing to draw
    const top = Math.round(li.offsetTop / vx), h = Math.max(1, Math.round(li.offsetHeight / vx));
    // two voxels short of the row at each end, one voxel in from the start of the line
    const inset = h > 4 ? 2 : 0;
    const x = getComputedStyle(el).direction === 'rtl' ? W - 2 : 1;
    // the look has no number for a groove's depth yet (the kit's own groove is one voxel down);
    // if it gets one, this follows it
    hole(live, m, { x, y: top + inset, w: 1, h: h - inset * 2, depth: live.look.groove ?? 1, wall: 'light', floor: 'light' });
  },

  pose(live) { live.glowStrength = halo(0.05) * byTheme(live); },

  bind(live) {
    const hear = listeners();
    // which row is current, rows coming and going, words that make a row taller
    hear.watch(live.el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'dir'] }, (list) => {
      const real = list.filter((r) => r.target !== live.canvas && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n === live.canvas)));
      if (!real.length) return;
      // an app that writes the whole list again takes the canvas out with the old rows
      if (!live.canvas.isConnected) live.el.prepend(live.canvas);
      live.rebuild();
    });
    return hear.done;
  },
};
