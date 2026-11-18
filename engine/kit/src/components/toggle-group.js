// Toggle group. Two kinds, told apart by the role on the group.
//
// One of many (role="radiogroup"): a bank of latching keys in a slot, as the band buttons of an
// old radio are. The slot is cut into the surface in a steel bezel; each seat holds a keycap that
// stands up out of it. The chosen one is latched down, its face level with the bezel, on its
// light; choosing another lets it up again. The checkbox and the radio are the same latch, one
// key to a collar. Underneath it is real radio buttons, so the browser gives it one tab stop, the
// arrow keys and a form's value, with no script.
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
// Tool: keys (cap() on ring()) in a slot with a bezel (one of many); none of its own (several of many).

import { ring, hole, bezel, halo, byTheme, lightName, cap as capOf } from '../core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../core/motion.js';
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
  draws: one,
  pad: 7,
  glowRadius: 3.4,
  glowStrength: halo(0.07),

  build(live, m) {
    const { el, vx } = live, s = live.state, look = live.look;
    const D = look.well;
    const seats = s.seats = seatsOf(el);
    const inputs = s.inputs = seats.map((seat) => seat.querySelector('input'));
    // the slot, in a bezel a voxel proud of the surface, as the switch's and the slider's are
    bezel(m, 0, 0, live.W, live.H);
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // Each seat as it lies: its size in whole voxels, and where a key of that size sits with its
    // middle on the seat's middle. Words make a seat any width, so a seat is seldom on the voxel
    // grid; the key is put to the nearest pixel, not the nearest voxel, and stays under its words.
    const remX = (live.cssW - live.W * vx) / 2, remY = (live.cssH - live.H * vx) / 2, px = (v) => Math.round(v * vx) / vx;
    const at = s.at = seats.map((seat) => {
      const w = Math.round(seat.offsetWidth / vx), h = Math.round(seat.offsetHeight / vx);
      return [px((seat.offsetLeft + seat.offsetWidth / 2 - remX) / vx - w / 2), px((seat.offsetTop + seat.offsetHeight / 2 - remY) / vx - h / 2), w, h];
    });
    // A key in every seat, a voxel in from its edges, so two keys side by side have two voxels of
    // slot between them. Each stands on the floor of the slot on a ring: steel, or the light for
    // the one that is chosen. Up, its top stands the look's travel above the bezel; latched down,
    // it is level with it.
    const top = s.top = 1 + look.travel;
    const mat = lightName(el, 'light');
    s.caps = []; s.lamps = []; s.studs = [];
    at.forEach(([x, y, w, h], i) => {
      const off = !!inputs[i]?.disabled;
      // The key stands on a steel ring. Chosen, the ring is light, and so is the floor of its seat
      // round it: the voxel of slot about a latched key is full of its light, as the slot behind
      // the switch's knob is.
      const [stud, lamp] = ['ring', 'lamp'].map((name, j) => {
        const p = m.part(name + i);
        p.sunk = true; p.grounded = false;
        if (j) p.box(-1, -1, -D, w, h, 1, mat);
        else ring(p, 0, 0, -D, w - 2, h - 2, 'steel');
        p.tx = x + 1; p.ty = y + 1;
        return p;
      });
      s.studs.push(stud);
      const cap = m.part('cap' + i);
      cap.grounded = false;
      capOf(cap, 0, 0, 1 - D, w - 2, h - 2, D + look.travel, off ? 'steel' : 'key');
      cap.tx = x + 1; cap.ty = y + 1;
      s.caps.push(cap); s.lamps.push(lamp);
      // the first drawing is as it is, with nothing moving
      const on = inputs[i]?.checked ? 1 : 0, spring = live.spring('on' + i, on);
      if (!s.built || reducedMotion()) spring.snap(on);
      else if (spring.target !== on) spring.to(on, on ? PRESS.k : RELEASE.k, on ? PRESS.c : RELEASE.c);
      live.spring('hold' + i, 0);
      // the words lie on their key's face, and go down with it
      live.label(wrapSeat(seats[i]), () => top + cap.tz);
    });
    s.index = inputs.findIndex((i) => i?.checked);
    s.built = true;
  },

  pose(live) {
    const s = live.state;
    if (!s.caps) return;
    const travel = live.look.travel;
    let lit = 0;
    s.caps.forEach((cap, i) => {
      const on = live.spring('on' + i).x;
      cap.tz = -travel * on + live.spring('hold' + i).x;
      // its light comes on as it passes half way down, and only on one that can be changed
      const shown = on > 0.5 && !s.inputs[i]?.disabled;
      s.lamps[i].hidden = !shown;
      s.studs[i].hidden = shown;
      if (shown) lit = 1;
    });
    live.glowStrength = halo(0.07) * byTheme(live) * lit;
  },

  bind(live) {
    const el = live.el, on = listeners(), s = live.state;
    if (!one(el)) { roving(el, on); return on.done; }
    const go = (spring, x, { k, c }) => { if (reducedMotion()) spring.snap(x); else spring.to(x, k, c); };
    // every key goes where its radio says: the chosen one down fast, as a press is; the one let go
    // up with one soft overshoot
    const sync = (quiet) => {
      let moved = false;
      (s.inputs ?? []).forEach((input, i) => {
        const want = input?.checked ? 1 : 0, spring = live.spring('on' + i);
        if (spring.target === want) return;
        go(spring, want, want ? PRESS : RELEASE);
        moved = true;
      });
      s.index = (s.inputs ?? []).findIndex((i) => i?.checked);
      if (moved) { if (!quiet) cue('tick'); live.invalidate(); }
    };
    // A hand on a key: while the pointer or Space holds it, it goes a step further down than where
    // it rests, so the first frame answers. What holds it is remembered, as the checkbox's latch does.
    let held = null;
    const hold = (i, by) => {
      if (held || i < 0 || s.inputs[i]?.disabled) return;
      held = { i, by };
      go(live.spring('hold' + i), -live.look.step, PRESS);
      cue('press');
      live.invalidate();
    };
    const let_go = (by) => {
      if (!held || held.by !== by) return;
      go(live.spring('hold' + held.i), 0, RELEASE);
      held = null;
      live.invalidate();
    };
    const seatOf = (t) => (s.seats ?? []).findIndex((seat) => seat.contains(t));
    on(el, 'pointerdown', (e) => { if (e.button === 0) hold(seatOf(e.target), 'pointer'); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) on(el, type, () => let_go('pointer'));
    on(el, 'keydown', (e) => { if (e.key === ' ' && !e.repeat) hold(seatOf(e.target), 'key'); });
    for (const type of ['keyup', 'focusout']) on(el, type, () => let_go('key'));
    on(el, 'change', () => sync(false));
    // chosen from code (input.checked = true): it follows, without a sound
    for (const input of el.querySelectorAll(':scope > label > input')) on.heed(input, 'checked', () => sync(true));
    // a form put back to how it began: the inputs change after the event, so look a moment later
    const form = el.querySelector('input')?.form;
    if (form) on(form, 'reset', () => setTimeout(() => sync(true)));
    on.watch(el, { attributes: true, attributeFilter: ['disabled'], subtree: true }, () => live.rebuild());
    on.watch(el, { attributes: true, attributeFilter: ['data-vx-light', 'data-vx-way'] }, () => live.rebuild());
    // chosen between the drawing and now (by the page's own script): it is so already
    if ((s.inputs ?? []).some((input, i) => live.spring('on' + i).target !== (input?.checked ? 1 : 0))) {
      s.inputs.forEach((input, i) => live.spring('on' + i).snap(input?.checked ? 1 : 0));
      s.index = s.inputs.findIndex((i) => i?.checked);
      live.invalidate();
    }
    return on.done;
  },

  // with no voxels a radio group needs nothing; a toolbar still wants its one tab stop
  plain(el, on) { if (!one(el)) roving(el, on); },
};
