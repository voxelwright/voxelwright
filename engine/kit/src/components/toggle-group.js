// Toggle group. Two kinds, told apart by the role on the group.
//
// One of many (role="radiogroup"): a trench of seats, as tabs are; the chosen seat is a key
// level with the surface, standing on its light. Underneath it is real radio buttons, so the
// browser gives it one tab stop, the arrow keys and a form's value, with no script.
//   <div class="vx-toggle-group" role="radiogroup" aria-label="View">
//     <label><input type="radio" name="view" value="list" checked>List</label>
//     <label><input type="radio" name="view" value="board">Board</label>
//   </div>
//   data-vx-way="down" stacks the seats. `change` comes from the radio that was chosen.
//
// Several of many (role="toolbar"): toggle buttons side by side (toggle-button.js draws them).
// The group adds what a toolbar is: one tab stop, and arrow keys, Home and End to move in it.
//   <div class="vx-toggle-group" role="toolbar" aria-label="Text style">
//     <button class="vx-toggle-button" type="button" aria-pressed="true">Bold</button> ...
//   </div>
// Tool: trench with a key in it (one of many); none of its own (several of many).

import { ring, hole, halo, byTheme, lightName, cap as capOf } from '../core/light.js';
import { reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';
import { keyTarget } from '../plain.js';

const one = (el) => el.getAttribute('role') !== 'toolbar';
const seatsOf = (el) => [...el.querySelectorAll(':scope > label')];

// A seat's words go in a span of their own, so the stage can keep them on whole pixels.
function wrapSeat(seat) {
  let label = seat.querySelector(':scope > .vx-label');
  if (label) return label;
  label = document.createElement('span');
  label.className = 'vx-label';
  for (const n of [...seat.childNodes]) if (!(n.nodeType === 1 && n.matches('input, .vx-canvas'))) label.append(n);
  seat.append(label);
  return label;
}

// A toolbar: one of its keys is the tab stop, and the arrow keys move among them. Space and
// Enter still press the key in focus; an arrow only moves.
function roving(el, on) {
  const keys = () => [...el.querySelectorAll('button, [role="button"]')].filter((b) => !b.disabled);
  const stop = (key) => { for (const k of keys()) k.tabIndex = k === key ? 0 : -1; };
  stop(keys().find((k) => k.getAttribute('tabindex') === '0') ?? keys()[0]);
  on(el, 'focusin', (e) => { const k = e.target.closest('button, [role="button"]'); if (k && el.contains(k)) stop(k); });
  on(el, 'keydown', (e) => {
    const all = keys(), i = all.indexOf(document.activeElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const way = el.dataset.vxWay === 'down' ? ['ArrowDown', 'ArrowUp'] : rtl ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    const to = keyTarget(e.key, i, all.length, way);
    if (to < 0) return;
    e.preventDefault();
    stop(all[to]);
    all[to].focus();
  });
}

export const toggleGroup = {
  name: 'toggle-group',
  selector: '.vx-toggle-group',
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.07),

  build(live, m) {
    const { el, vx } = live, s = live.state;
    if (!one(el)) return; // several of many: its keys are parts of their own, and it draws nothing
    const D = live.look.well;
    const seats = s.seats = seatsOf(el);
    const inputs = s.inputs = seats.map((seat) => seat.querySelector('input'));
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // Each seat as it lies: its size in whole voxels, and where a key of that size sits with its
    // middle on the seat's middle. Words make a seat any width, so a seat is seldom on the voxel
    // grid; the key is put to the nearest pixel, not the nearest voxel, and stays under its words.
    const remX = (live.cssW - live.W * vx) / 2, remY = (live.cssH - live.H * vx) / 2, px = (v) => Math.round(v * vx) / vx;
    const at = s.at = seats.map((seat) => {
      const w = Math.round(seat.offsetWidth / vx), h = Math.round(seat.offsetHeight / vx);
      return [px((seat.offsetLeft + seat.offsetWidth / 2 - remX) / vx - w / 2), px((seat.offsetTop + seat.offsetHeight / 2 - remY) / vx - h / 2), w, h];
    });
    const index = s.index = inputs.findIndex((i) => i?.checked);
    const [x, y, w, h] = at[index] ?? at[0] ?? [0, 0, live.W, live.H];
    const off = index >= 0 && inputs[index].disabled;
    // the chosen seat: a key standing on the floor of the trench, on its light, its face level
    // with the surface. Nothing is chosen: no key. The choice cannot be changed: no light.
    const block = m.part('block');
    block.grounded = false;
    if (!off) ring(block, 1, 1, -D, w - 2, h - 2, lightName(el, 'light'));
    capOf(block, 1, 1, 1 - D, w - 2, h - 2, D - 1, off ? 'steel' : 'key');
    block.hidden = index < 0;
    s.shape = [w, h, off, index < 0].join();
    live.spring('x', x, 260, 30).snap(x);
    live.spring('y', y, 260, 30).snap(y);
    seats.forEach((seat) => live.label(wrapSeat(seat), () => live.faceZ)); // they do not move; registered so their words are kept on whole pixels
  },

  pose(live) {
    const block = live.model.byName.block;
    if (!block) return;
    block.tx = live.spring('x').x;
    block.ty = live.spring('y').x;
    live.glowStrength = halo(0.07) * byTheme(live);
  },

  bind(live) {
    const el = live.el, on = listeners(), s = live.state;
    if (!one(el)) { roving(el, on); return on.done; }
    // the key goes to the seat that is chosen now: sliding under a pointer, at once under a key
    const move = (glide) => {
      const index = s.inputs.findIndex((i) => i?.checked);
      if (index === s.index) return;
      const [x, y, w, h] = s.at[index] ?? [];
      // another shape (none chosen before or now, a seat of another size, one that is off): built again
      if (index < 0 || s.shape !== [w, h, s.inputs[index].disabled, false].join()) return live.rebuild();
      s.index = index;
      const sx = live.spring('x'), sy = live.spring('y');
      if (glide && !reducedMotion()) { sx.to(x); sy.to(y); cue('slide'); } else { sx.snap(x); sy.snap(y); }
      live.invalidate();
    };
    let glide = true;
    on(el, 'keydown', (e) => { if (e.key.startsWith('Arrow')) glide = false; });
    on(el, 'pointerdown', () => { glide = true; });
    on(el, 'change', () => move(glide));
    // chosen from code (input.checked = true): it follows at once, without a sound
    for (const input of el.querySelectorAll(':scope > label > input')) on.heed(input, 'checked', () => move(false));
    on.watch(el, { attributes: true, attributeFilter: ['disabled'], subtree: true }, () => live.rebuild());
    on.watch(el, { attributes: true, attributeFilter: ['data-vx-light', 'data-vx-way'] }, () => live.rebuild());
    return on.done;
  },

  // with no voxels a radio group needs nothing; a toolbar still wants its one tab stop
  plain(el, on) { if (!one(el)) roving(el, on); },
};
