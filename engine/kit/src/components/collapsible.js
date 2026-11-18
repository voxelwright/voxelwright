// Collapsible. One row of words with a chevron that shows and hides what is under it, on the
// same surface.
// Tool: none. It is the browser's own <details>, and everything it does is the browser's: Enter
// and Space on the row, a press, find-in-page. With no script, and on a plain page, this file is
// not needed at all. It does one thing, and only where there are voxels: the surface the row is
// on is made once as the row opens, not on every frame (see steady in accordion.js).
// Markup: <details class="vx-collapsible"><summary>Older deploys</summary> … </details>
//         Words that change with it:
//         <summary><span data-vx-when="closed">Show older deploys</span><span data-vx-when="open">Hide them</span></summary>

import { listeners } from './util.js';
import { steady } from './accordion.js';

export const collapsible = {
  name: 'collapsible',
  selector: '.vx-collapsible > summary', // the row; the stage's own canvas must not be a child of <details>
  pad: 0,

  build() {}, // nothing stands up and nothing is cut: the row is words

  bind(live) {
    const on = listeners(), d = live.el.parentElement;
    const release = steady(d, on, live, () => [d]);
    return () => { release(); on.done(); };
  },
};
