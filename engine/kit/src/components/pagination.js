// Pagination. A bank of latching buttons in a slot, as on a radio: every page is a keycap standing
// in the slot, and the current page is the one that is latched down, level with the surface, with
// the accent's light round its foot. Pressing another lets the first one up. A gap ("…") is an
// fixed spacer in the slot. Previous and next are the kit's own keys (.vx-button) beside it, and
// are not drawn here.
// Tool: what you press (the keycap), in a slot cut in the surface. Nothing slides, so no bezel.
// Markup: <nav class="vx-pagination" aria-label="Pages of deploys">
//           <a class="vx-button" rel="prev" href="?page=4" aria-label="Previous page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//           <ol class="vx-pagination-pages">
//             <li><a href="?page=4" aria-label="Page 4">4</a></li>
//             <li><a href="?page=5" aria-label="Page 5" aria-current="page">5</a></li>
//             <li class="vx-pagination-gap"><span aria-hidden="true">…</span><span class="vx-pagination-aloud">More pages</span></li>
//           </ol>
//           <a class="vx-button" rel="next" href="?page=6" aria-label="Next page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//         </nav>
// The buttons are real links: Tab reaches each, Enter follows it, and the page (or the app's
// router) says which is current with aria-current="page". The part reads that and nothing else:
// when it moves from one button to another, the one comes up and the other goes down; when the
// buttons themselves are written again, the current one is simply down.

import { seatIndicator, hole, ring, halo, byTheme, cap as capOf } from '../core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners, wrapLabel } from './util.js';

const currentOf = (el) => el.querySelector(':scope > li > a[aria-current]:not([aria-current="false"])');
const linksOf = (el) => [...el.querySelectorAll(':scope > li > a')].filter((a) => a.offsetParent);

export const pagination = {
  name: 'pagination',
  selector: '.vx-pagination-pages',
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.07),

  build(live, m) {
    const { H, el, vx } = live, look = live.look, D = look.well;
    // a button stands as far above the surface as a key travels: latched, it is level with it
    const up = live.state.up = look.travel;
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // Align the raised faces with their links on either side of the slot.
    live.faceZ = up;
    // The buttons are measured where the page laid them, not where their caps had carried them:
    // Live.rebuild() takes the last model's nudges off its labels before it calls this.
    const gaps = [...el.querySelectorAll(':scope > li.vx-pagination-gap > [aria-hidden]')], links = linksOf(el);

    const cur = currentOf(el);
    const glide = live.state.glide && !reducedMotion();
    live.state.glide = false;
    live.state.has = !!cur;
    const box = el.getBoundingClientRect();
    // A fixed spacer carries each ellipsis between the projecting keys.
    const spacer = m.part('spacers');
    for (const g of gaps) {
      const r = g.parentElement.getBoundingClientRect();
      if (!r.width) continue;
      const x = Math.round((r.left - box.left) / vx);
      const w = Math.round(r.width / vx);
      spacer.slab(x + 1, 1, -D, Math.max(1, w - 2), H - 2, D + up - 1, 'slate', 1);
      live.label(g, () => up - 1);
    }
    const was = live.state.latched;
    const seats = live.state.seats = links.map((a, i) => {
      // where the button is, in voxels from the slot's own edge
      const r = a.getBoundingClientRect();
      const x = Math.round((r.left - box.left) / vx), w = Math.max(3, Math.round((r.right - box.left) / vx) - x);
      // the cap: from the floor of the slot to above the surface, a voxel clear of the slot's
      // walls and of the buttons beside it
      const part = m.part('seat' + i);
      part.grounded = false;
      capOf(part, x + 1, 1, -D, w - 2, H - 4, D + up, 'key');
      const current = a === cur, spring = live.spring('seat' + i, 0, RELEASE.k, RELEASE.c);
      // only which button is current changed: they move. Buttons written again: they are put there.
      if (glide) spring.to(current ? -up : 0, current ? PRESS.k : RELEASE.k, current ? PRESS.c : RELEASE.c); else spring.snap(current ? -up : 0);
      const indicator = seatIndicator(live, i, x + 1, 1, w - 2, H - 2);
      const seat = { a, x, w, part, current, spring, indicator };
      // the legend rides on the cap's top
      live.label(wrapLabel(a), () => up + spring.x);
      return seat;
    });
    const latched = live.state.latched = seats.findIndex((q) => q.current);
    if (glide && was !== latched) cue('tick');
    if (latched < 0) return; // no current page: no button is down, and no light
    // the light: on the floor of the slot, round the foot of the button that is down
    const on = seats[latched], light = m.part('light');
    light.sunk = true;
    ring(light, on.x, 0, -D, on.w, H - 2, 'light', 0);
  },

  pose(live) {
    for (const q of live.state.seats ?? []) {
      q.part.tz = q.spring.x;
      q.indicator(-q.spring.x / live.state.up);
    }
    live.glowStrength = halo(0.07) * byTheme(live);
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'data-vx-when'] }, (list) => {
      const real = list.filter((r) => r.target !== live.canvas && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n === live.canvas)));
      if (!real.length) return;
      // an app that writes the whole list again takes the canvas out with the old buttons
      if (!live.canvas.isConnected) live.el.prepend(live.canvas);
      // only which button is current changed: one comes up and one goes down. Written again: they are put there.
      live.state.glide = real.every((r) => r.type === 'attributes' && r.attributeName === 'aria-current');
      live.rebuild();
    });
    // a button answers the hand before the page answers the link: it goes down under the press,
    // and comes back if the press is taken away
    let held = null;
    const seatOf = (e) => { const a = e.target.closest?.('a'); return a ? live.state.seats?.find((q) => q.a === a) : null; };
    const let_go = () => {
      const q = held;
      held = null;
      // the buttons may have been written again while it was held: only one still in the bank is let up
      if (!q || q.current || !live.state.seats?.includes(q)) return;
      q.spring.to(0, RELEASE.k, RELEASE.c); cue('release'); live.invalidate();
    };
    on(live.el, 'pointerdown', (e) => {
      const q = seatOf(e);
      if (!q || q.current || e.button > 0) return;
      held = q;
      q.spring.to(-live.state.up, PRESS.k, PRESS.c); cue('press'); live.invalidate();
    });
    on(live.el, 'pointerup', let_go);
    on(live.el, 'pointercancel', let_go);
    on(live.el, 'pointerleave', let_go);
    return on.done;
  },
};
