// Skeleton. Shallow trenches the size of what is coming, with one soft light passing along them:
// a band of light cubes that crosses the whole skeleton, so every trench is lit in its turn.
// Tool: well (a trench a level shallower than a field), with the room's warm light in it. The
// light is structure, not an action, so it is never the accent.
// Markup: <p class="vx-skeleton-word" role="status">Loading the deploys</p>
//         <div class="vx-skeleton" aria-busy="true">
//           <span class="vx-bone" data-vx-bone="title" style="--vx-bone-w: 40"></span>
//           <span class="vx-bone"></span>
//           <span class="vx-bone" data-vx-bone="box" style="--vx-bone-w: 10; --vx-bone-h: 10"></span>
//         </div>
//         The words that say it is loading stand outside the busy region, so a screen reader is
//         not asked to wait for them. When what was coming is here: take the bones out, set
//         aria-busy="false", and change the words ("Deploys loaded").
// It runs only while it is loading and can be seen. Out of sight, removed, hidden, with
// aria-busy="false" or under prefers-reduced-motion it draws the trenches once and stops.
// Taking a trench out of the page stops it, but the kit goes on holding its model: call
// release(el) first (index.js), as for any part that is removed.

import { hole, halo, warmth } from '../core/light.js';
import { reducedMotion } from '../core/motion.js';
import { listeners } from './util.js';

const CROSS = 1.5;  // seconds for the light to cross the skeleton
const REST = 0.6;   // seconds of dark between two passes
const BAND = 7;     // half the light's length, in voxels

/** The region that is loading: the nearest element that says so, or the skeleton itself. */
const regionOf = (el) => el.closest('[aria-busy]') ?? el.closest('.vx-skeleton') ?? el.parentElement ?? el;

/** True while the light should pass: something is loading, and the person has not asked for stillness. */
const loading = (live) => live.el.isConnected && regionOf(live.el).getAttribute('aria-busy') !== 'false' && !reducedMotion();

export const skeleton = {
  name: 'skeleton',
  selector: '.vx-bone',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.04),

  build(live, m) {
    const { W, H, el, vx } = live;
    const D = Math.max(1, live.look.well - 1); // shallow: a level less than a field
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    const light = m.part('light');
    light.sunk = true; light.grounded = false; light.masked = true;
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) for (let k = -D; k < 0; k++) light.plot(i, j, k, 'light-warm');
    // where this trench lies in the skeleton, so one light crosses them all together
    // (from the first trench's edge to the last one's, not the region's: the light is not kept
    // waiting over empty surface)
    const box = el.getBoundingClientRect();
    let left = box.left, right = box.right;
    for (const b of (el.closest('.vx-skeleton') ?? el).querySelectorAll('.vx-bone')) { const r = b.getBoundingClientRect(); if (r.width) { left = Math.min(left, r.left); right = Math.max(right, r.right); } }
    live.state.left = (box.left - left) / vx;
    live.state.across = Math.max(W, (right - left) / vx);
    live.state.rtl = getComputedStyle(el).direction === 'rtl';
  },

  pose(live) {
    const light = live.model.byName.light, sc = light.scales, rest = light.rest, st = live.state;
    let head = NaN;
    if (loading(live)) {
      const t = (performance.now() / 1000) % (CROSS + REST);
      const at = -BAND + (st.across + BAND * 2) * Math.min(1, t / CROSS);
      head = (st.rtl ? st.across - at : at) - st.left; // in this trench's own voxels
    }
    for (let i = 0; i < light.count; i++) {
      const d = Math.abs(rest[i * 3] - head);
      sc[i] = d < BAND ? 0.5 + 0.5 * Math.cos(Math.PI * d / BAND) : 0; // NaN (not loading) is dark
    }
    live.glowStrength = halo(0.04) * warmth(live);
  },

  step(live) {
    if (!loading(live)) return false;
    // out of sight: stop the frames, and stay marked for drawing so the stage wakes it on return
    if (!live.visible) { live.dirty = true; return false; }
    return true;
  },

  bind(live) {
    const on = listeners();
    on.watch(regionOf(live.el), { attributes: true, attributeFilter: ['aria-busy'] }, () => live.invalidate());
    if (typeof matchMedia === 'function') on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', () => live.invalidate());
    return on.done;
  },
};
