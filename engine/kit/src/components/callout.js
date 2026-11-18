// Callout (alert). Words on the surface, with a standing groove at their start in the light of
// its kind: a note is the accent, done is green, a warning is the room's warm light, failed is red.
// Tool: groove (a channel one voxel deep with light in it). Not a card: nothing stands up.
// Markup: <div class="vx-callout" data-vx-kind="failed" role="alert">
//           <p class="vx-callout-title">The build failed</p><p>Step 3 of 5 ran out of memory.</p>
//         </div>
// The words are the page's own; the part draws only the groove, from data-vx-kind.

import { hole, halo, byTheme, warmth } from '../core/light.js';
import { listeners } from './util.js';

const LIGHT = { note: 'light', done: 'light-go', warning: 'light-warm', failed: 'light-stop' };

export const callout = {
  name: 'callout',
  selector: '.vx-callout',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, el } = live;
    const mat = live.state.mat = LIGHT[el.dataset.vxKind] ?? LIGHT.note;
    // at the start of the line: the left, or the right where the page reads right to left
    const x = getComputedStyle(el).direction === 'rtl' ? W - 1 : 0;
    hole(live, m, { x, w: 1, depth: live.look.groove, wall: mat, floor: mat });
  },

  // the warm light is the room's own and stays as quiet as any groove; the others say something
  pose(live) { live.glowStrength = halo(0.05) * (live.state.mat === 'light-warm' ? warmth(live) : byTheme(live)); },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-kind', 'dir'] }, () => live.rebuild());
    return on.done;
  },
};
