// Prose. Words on the surface: no voxels, but for one thing. A quote's rule is a standing groove,
// cut where the quote's border is, so an article needs no markup of the kit's to get it.
// Tool: none; the groove for a quote's rule.
// Markup: <article class="vx-prose"> … <blockquote><p>Words.</p><footer>Who said them</footer></blockquote> … </article>
//         With no script the rule is the quote's own border, in the same place (css/prose.css).

import { hole, halo, warmth } from '../core/light.js';

export const prose = {
  name: 'prose-quote',
  selector: '.vx-prose blockquote',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H, el } = live;
    // one voxel wide, the height of the quote, at the side the words start from
    const rtl = getComputedStyle(el).direction === 'rtl';
    // a groove's depth is the look's (the lit look names none yet: a groove is one voxel down)
    hole(live, m, { x: rtl ? W - 1 : 0, y: 0, w: 1, h: H, depth: live.look.groove ?? 1, wall: 'light-warm', floor: 'light-warm' });
  },

  pose(live) { live.glowStrength = halo(0.05) * warmth(live); },
};
