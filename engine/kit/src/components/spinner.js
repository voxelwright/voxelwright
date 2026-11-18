// Spinner. A small ring of light cubes that take turns: one is full, the ones behind it are
// going out, the rest wait small.
// Tool: light (the accent: something is in progress), as cubes standing on the surface like a
// lamp. Not a key: nothing in it can be pressed.
// Markup, alone:        <span class="vx-spinner" role="status"><span class="vx-spinner-word">Loading the deploys</span></span>
//         beside words: <p role="status"><span class="vx-spinner" aria-hidden="true"></span> Building harbor-api</p>
//         data-vx-size="large" is a ring of sixteen. The region being waited for takes
//         aria-busy="true"; the status stands outside it.
// It runs only while it can be seen. Out of sight, removed or hidden it stops; under
// prefers-reduced-motion it is a still ring, and the words carry the news.
// Taking a spinner out of the page stops it, but the kit goes on holding its model: call
// release(el) first (index.js), as for any part that is removed.

import { halo, byTheme, lightName } from '../core/light.js';
import { reducedMotion } from '../core/motion.js';
import { listeners } from './util.js';

const TURN = 0.8;   // seconds for the light to go once round
const WAIT = 0.45;  // the size of a cube that is waiting
const STILL = 0.75; // the size of every cube when nothing may move
const TAIL = 0.6;   // how much of the ring is still going out behind the full cube

const running = (live) => live.el.isConnected && !reducedMotion();

export const spinner = {
  name: 'spinner',
  selector: '.vx-spinner',
  pad: 5,
  glowRadius: 2.4,
  glowStrength: halo(0.1),

  build(live, m) {
    const { W, H, el } = live;
    // cubes two voxels apart round the edge of the box, clockwise from the top left
    const seats = [];
    for (let i = 0; i < W - 1; i += 2) seats.push([i, 0]);
    for (let j = 0; j < H - 1; j += 2) seats.push([W - 1, j]);
    for (let i = W - 1; i > 0; i -= 2) seats.push([i, H - 1]);
    for (let j = H - 1; j > 0; j -= 2) seats.push([0, j]);
    const cubes = m.part('cubes');
    cubes.grounded = false; cubes.masked = true;
    const mat = lightName(el, 'light');
    for (const [x, y] of seats) cubes.plot(x, y, 0, mat); // a cube: one voxel each way
    live.state.seats = seats;
    live.state.turn = null; // which seat each drawn cube is: found once the model is baked
    live.faceZ = 1; // the cubes' tops lie on the element's box, as a lamp's does
  },

  pose(live) {
    const cubes = live.model.byName.cubes, sc = cubes.scales, st = live.state, n = st.seats.length;
    st.turn ??= Array.from({ length: cubes.count }, (_, i) => st.seats.findIndex(([x, y]) => x === Math.floor(cubes.rest[i * 3]) && y === Math.floor(cubes.rest[i * 3 + 1])));
    if (!running(live)) { sc.fill(STILL); }
    else {
      const head = (performance.now() / 1000 / TURN) * n; // the seat whose turn it is, and how far into it
      for (let i = 0; i < cubes.count; i++) {
        const since = (((head - st.turn[i]) % n) + n) % n; // seats since this cube's turn
        const left = Math.max(0, 1 - since / (n * TAIL));
        sc[i] = WAIT + (1 - WAIT) * left * left;
      }
    }
    live.glowStrength = halo(0.1) * byTheme(live);
  },

  step(live) {
    if (!running(live)) return false;
    // out of sight: stop the frames, and stay marked for drawing so the stage wakes it on return
    if (!live.visible) { live.dirty = true; return false; }
    return true;
  },

  bind(live) {
    const on = listeners();
    if (typeof matchMedia === 'function') on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', () => live.invalidate());
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-light', 'data-vx-size'] }, () => live.rebuild());
    return on.done;
  },
};
