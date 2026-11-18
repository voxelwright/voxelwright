// The name of a keyboard key is an inscription in a shallow recess.
import { wrapLabel } from './util.js';
import { hole } from '../core/light.js';

export const kbd = {
  name: 'kbd',
  selector: '.vx-kbd',
  pad: 4,

  build(live, m) {
    hole(live, m, { depth: live.look.groove, wall: 'steel', floor: 'slate' });
    live.label(live.el.querySelector(':scope > .vx-label'), () => live.faceZ);
  },

  bind(live) { wrapLabel(live.el); },
};
