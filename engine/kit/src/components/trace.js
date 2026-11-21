// Trace. What an agent did, step by step: a standing groove with a lamp at each step. Green is
// done, the accent is in progress, red has failed; a step that has not begun is a dark lamp.
// Each step is a line of words, and one that has more to show opens (the kit's collapsible).
// Tool: groove (the rail, in the room's own warm light: it is structure) and the kit's lamp at
// each step. This part draws the rail from the first lamp to the last, and the dark lamps.
// Markup: <ol class="vx-trace" aria-label="What the agent did" aria-live="off">
//           <li data-vx-state="done">
//             <span class="vx-lamp" data-vx-light="go" aria-hidden="true"></span>
//             <details class="vx-collapsible">
//               <summary><span class="vx-trace-what">Read build-214.log</span><span class="vx-trace-state">Done, 2 s</span></summary>
//               <p>…what it found…</p>
//             </details>
//           </li>
//           <li data-vx-state="failed">
//             <span class="vx-lamp" data-vx-light="stop" aria-hidden="true"></span>
//             <p class="vx-trace-line"><span class="vx-trace-what">Ran the tests</span><span class="vx-trace-state">Failed: 2 of 58</span></p>
//           </li>
//         </ol>
//         data-vx-state on a step: done, running, failed, or waiting (not begun; also when it is
//         left out). Every step says its state in words (.vx-trace-state): the lamp only repeats
//         it, and is hidden from a screen reader.
// Behaviour: set data-vx-state on a step and its lamp takes the light of that state. A screen
// reader is told once when a step changes state ("Ran the tests: Failed: 2 of 58"), through a
// line of its own after the list (.vx-trace-status, role="status"; made here if the page has
// not written one). The list itself is aria-live="off", so a step in progress whose seconds or
// output change on every tick is not read out again and again, even inside a thread that is a
// log. Opening a step is the browser's own <details>: Enter, Space, a press, find-in-page.

import { hole, halo, warmth } from '../core/light.js';
import { listeners } from './util.js';

const LIGHT = { done: 'go', running: 'accent', failed: 'stop' };
const WORDS = { done: 'done', running: 'in progress', failed: 'failed', waiting: 'waiting' };
const stepsOf = (el) => [...el.querySelectorAll(':scope > li')];
const lampOf = (li) => li.querySelector(':scope > .vx-lamp');
const stateOf = (li) => (li.dataset.vxState in WORDS ? li.dataset.vxState : 'waiting');
const text = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');

// What is said of a step when its state changes: its own words, then its state's own words.
function sentence(li, state) {
  const what = text(li.querySelector('.vx-trace-what')) || text(li.querySelector('summary, .vx-trace-line'));
  return `${what}: ${text(li.querySelector('.vx-trace-state')) || WORDS[state]}`;
}

/** What a trace does with voxels or without. changed() is called after a step is added, taken away or changes state. */
function wire(el, on, changed = () => {}) {
  if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'off');
  let status = el.nextElementSibling?.matches('.vx-trace-status') ? el.nextElementSibling : null;
  if (!status) {
    status = document.createElement('p');
    status.className = 'vx-trace-status vx-aloud';
    status.setAttribute('role', 'status');
    el.after(status);
  }
  const known = new WeakMap(); // step -> the state it was last seen in
  const sync = (aloud) => {
    const said = [];
    for (const li of stepsOf(el)) {
      const state = stateOf(li), lamp = lampOf(li), light = LIGHT[state];
      if (lamp && light && lamp.dataset.vxLight !== light) lamp.dataset.vxLight = light;
      if (known.get(li) === state) continue;
      if (aloud && state !== 'waiting') said.push(sentence(li, state));
      known.set(li, state);
    }
    if (said.length) status.textContent = said.join('. ') + '.';
  };
  sync(false);
  const heard = () => { sync(true); changed(); };
  on.watch(el, { childList: true }, heard);
  on.watch(el, { attributes: true, attributeFilter: ['data-vx-state'], subtree: true }, heard);
}

export const trace = {
  name: 'trace',
  selector: '.vx-trace',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { el, vx } = live, G = live.look.groove ?? 1;
    const r = el.getBoundingClientRect();
    const remX = (live.cssW - live.W * vx) / 2, remY = (live.cssH - live.H * vx) / 2;
    const lamps = stepsOf(el).map((li) => {
      const lamp = lampOf(li);
      if (!lamp) return null;
      const b = lamp.getBoundingClientRect();
      return { x: (b.left - r.left - remX) / vx, y: (b.top - r.top - remY) / vx, w: Math.max(1, Math.round(b.width / vx)), h: Math.max(1, Math.round(b.height / vx)), light: LIGHT[stateOf(li)] };
    }).filter(Boolean);
    if (!lamps.length) return;
    // A lamp is a part of its own, put on whole pixels by the stage; the rail is cut on this
    // part's grid. What is left over between the two is given to the rail as a shift, to the
    // pixel, so that it runs exactly under its lamps.
    const px = (v) => Math.round(v * vx) / vx;
    const first = lamps[0], last = lamps.at(-1);
    const x = Math.floor(first.x), fx = px(first.x - x);
    const y0 = Math.floor(first.y), fy = px(first.y - y0), y1 = Math.round(last.y - fy) + last.h;
    const strip = el.dataset.vxRail === 'pilot-strip';
    if (strip) {
      // One milled opening. Each fixed lens sits on the same dark bed, even before
      // its step begins. Only the core emits; the gasket and steel ends stay passive.
      const { walls, floor } = hole(live, m, {
        x: x - 1, y: y0 - 1, w: first.w + 2, h: y1 - y0 + 2, depth: 1, wall: 'steel', floor: 'gasket',
      });
      const windows = m.part('windows');
      windows.sunk = true;
      for (const s of lamps) {
        const y = Math.round(s.y - fy);
        const face = s.light === 'accent' ? 'light' : s.light ? 'light-' + s.light : 'lens';
        windows.box(x, y, -1, s.w, s.h, 1, face);
        windows.plot(x, y, -1, 'lens');
      }
      const ends = m.part('retainers');
      for (const y of [y0 - 3, y1 + 1]) {
        ends.slab(x - 2, y, 0, first.w + 3, 2, 1, 'steel', 1);
      }
      for (const part of [walls, floor, windows, ends]) { part.tx = fx; part.ty = fy; }
      live.well = [x - 1 + fx, y0 - 1 + fy, x + first.w + 1 + fx, y1 + 1 + fy];
      live.glowRadius = 1.5;
      return;
    }
    if (lamps.length > 1) {
      const { walls, floor } = hole(live, m, { x, y: y0, w: first.w, h: y1 - y0, depth: G, wall: 'light-warm', floor: 'light-warm' });
      walls.tx = floor.tx = fx; walls.ty = floor.ty = fy;
      live.well = [x + fx, y0 + fy, x + fx + first.w, y1 + fy];
    }
    // a step that has not begun: the same lamp in its collar, with no light in it
    lamps.forEach((s, i) => {
      if (s.light) return;
      const sx = Math.floor(s.x), sy = Math.floor(s.y);
      const stud = m.part('dark' + i);
      stud.grounded = false;
      stud.slab(sx - 1, sy - 1, 0, s.w + 2, s.h + 2, 1, 'steel', 1);
      stud.box(sx, sy, 0, s.w, s.h, 2, 'steel');
      stud.tx = px(s.x - sx); stud.ty = px(s.y - sy);
    });
  },

  pose(live) { live.glowStrength = halo(0.05) * warmth(live); },

  bind(live) {
    const on = listeners(), el = live.el;
    wire(el, on, () => live.rebuild());
    // A step that opens makes the list taller over a fifth of a second, and the rail with it.
    // The stage builds the rail again each time and draws it on the next frame, by when it has
    // grown again: left to that, the rail would not be seen until the step had finished opening.
    // So it is drawn here in the same frame it was built in. (The stage's own observer is older
    // than this one and is heard first; if it has not been, the rail is built here.)
    const sizes = new ResizeObserver(() => {
      if (!live.model) return;
      if (el.offsetWidth !== live.cssW || el.offsetHeight !== live.cssH) live.rebuild();
      live.draw();
    });
    sizes.observe(el);
    return () => { sizes.disconnect(); on.done(); };
  },

  plain(el, on) { wire(el, on); },
};
