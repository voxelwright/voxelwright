// Callout (alert). Words on the surface, with a standing groove at their start in the light of
// its kind: a note is the accent, done is green, a warning is the room's warm light, failed is red.
// Tool: groove (a channel one voxel deep with light in it). Not a card: nothing stands up.
// Markup: <div class="vx-callout" data-vx-kind="failed" role="alert">
//           <p class="vx-callout-title">The build failed</p><p>Step 3 of 5 ran out of memory.</p>
//         </div>
// The words are the page's own; the part draws only the groove, from data-vx-kind.

import { hole, halo, byTheme } from '../core/light.js';
import { MATERIALS } from '../core/materials.js';
import { listeners } from './util.js';

const LIGHT = { note: 'light', done: 'light-go', warning: 'caution', failed: 'light-stop' };

function buildPilot(live, m, left, mat) {
  // Fixed window beside the printed legend. Only its centre emits;
  // the smoked ends and the steel reveal catch light at the opening.
  const { walls, floor } = hole(live, m, { x: left, y: 1, w: 5, h: 3, depth: 2, wall: 'steel', floor: 'gasket' });
  floor.box(left + 1, 2, -2, 3, 1, 1, 'gasket');
  const lens = m.part('lens');
  lens.sunk = true;
  lens.box(left + 1, 2, -1, 3, 1, 1, 'lens');
  lens.plot(left + 2, 2, -1, mat);

  // The end cells transmit the centre cell’s colour. Only a small
  // fraction reflects from the metal immediately around the window.
  let revision;
  return () => {
    if (revision === live.tintRevision) return;
    revision = live.tintRevision;
    const core = lens.mats.indexOf(MATERIALS[mat].id);
    if (core < 0) return;
    const rgb = lens.col.subarray(core * 4, core * 4 + 3);
    for (const part of [lens, walls]) {
      for (let i = 0; i < part.count; i++) {
        if (part === lens && i === core) continue;
        const dx = part.rest[i * 3] - (left + 2.5);
        const dy = part.rest[i * 3 + 1] - 2.5;
        const weight = (part === lens ? .8 : .22) / (1 + dx * dx + dy * dy);
        for (let c = 0; c < 3; c++) {
          const k = i * 4 + c;
          part.col[k] += (rgb[c] - part.col[k]) * weight;
        }
      }
    }
  };
}

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
    if (el.dataset.vxFitting === 'pilot') {
      live.state.lightPilot = buildPilot(live, m, x === 0 ? 0 : W - 5, mat);
      return;
    }
    live.state.lightPilot = null;
    hole(live, m, { x, w: 1, depth: live.look.groove, wall: mat, floor: mat });
  },

  pose(live) {
    live.state.lightPilot?.();
    live.glowStrength = halo(0.05) * byTheme(live);
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-kind', 'dir'] }, () => live.rebuild());
    return on.done;
  },
};
