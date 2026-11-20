// Code input. A row of small windows cut into the panel, one a character; the one the next
// character goes into has the accent's light in its rim.
// Tool: well (a hole a window, lit from its rim).
// Markup: <span class="vx-otp" style="--vx-otp-n: 6">
//           <input autocomplete="one-time-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" aria-label="Code from the email">
//         </span>
//         --vx-otp-n is the number of windows (the same as maxlength), so the row has its width
//         before any script runs. inputmode="text" takes letters and digits (made capitals).
// It is one real input lying over the row: its letter spacing puts each character in its own
// window, so the caret, typing, paste, a screen reader and a phone's offer of the code that just
// came are all the browser's own. With no script the windows are painted under it. The script
// adds a window a character (aria-hidden), keeps only what the code may hold, and marks the
// window the next character goes into:
//   typing        fills the window and goes on to the next; on a window that holds one, replaces it
//   Backspace     empties the window before and goes back to it (the browser's own)
//   arrows, Home, End, a press on a window   go to that window
// `vx-complete` comes from the input once every window holds a character (detail.value).

import { hole, halo, warmth, lightName } from '../core/light.js';
import { CALM } from '../core/motion.js';
import { listeners } from './util.js';

const GLOW = 0.05;

function wire(el, on) {
  const input = el.querySelector(':scope > input');
  const st = { cells: [] };
  if (!input) return st;
  const n = Math.max(1, Number(input.getAttribute('maxlength')) || Number(getComputedStyle(el).getPropertyValue('--vx-otp-n')) || 6);
  const letters = input.inputMode === 'text';

  // a window a character, under the input
  let cells = [...el.querySelectorAll(':scope > .vx-otp-cell')];
  const made = !cells.length;
  if (made) {
    for (let i = 0; i < n; i++) { const c = document.createElement('span'); c.className = 'vx-otp-cell'; c.setAttribute('aria-hidden', 'true'); el.insertBefore(c, input); cells.push(c); }
  }
  st.cells = cells;
  el.setAttribute('data-vx-on', '');
  // the script keeps the length itself: the browser's maxlength would cut a pasted "123 456"
  // to "123 45" before the space could be taken out
  const max = input.getAttribute('maxlength');
  if (max !== null) input.removeAttribute('maxlength');

  // which window the next character goes into: where the caret is, while the input has the focus
  const mark = () => {
    const at = document.activeElement === input ? Math.min(n - 1, input.selectionStart ?? input.value.length) : -1;
    cells.forEach((c, i) => {
      if ((i === at) !== c.hasAttribute('data-vx-active')) c.toggleAttribute('data-vx-active', i === at);
      const full = i < input.value.length;
      if (full !== c.hasAttribute('data-vx-full')) c.toggleAttribute('data-vx-full', full);
    });
  };

  // only what a code may hold, and no more of it than there are windows
  let told = false;
  const clean = () => {
    const v = input.value, at = input.selectionStart ?? v.length;
    const keep = (s) => (letters ? s.toUpperCase().replace(/[^0-9A-Z]/g, '') : s.replace(/\D/g, ''));
    const w = keep(v).slice(0, n);
    if (w !== v) { input.value = w; const c = Math.min(w.length, keep(v.slice(0, at)).length); input.setSelectionRange(c, c); }
    mark();
    if (w.length === n && !told) { told = true; input.dispatchEvent(new CustomEvent('vx-complete', { bubbles: true, detail: { value: w } })); }
    if (w.length < n) told = false;
  };

  // typing on a window that holds a character replaces it, as it would on a form on paper
  on(input, 'beforeinput', (e) => {
    if (e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
    const a = input.selectionStart, b = input.selectionEnd;
    if (a === b && a < input.value.length) input.setSelectionRange(a, a + 1);
    else if (a === b && input.value.length >= n) e.preventDefault(); // every window is full
  });
  on(input, 'input', clean);
  on(input, 'focus', mark);
  on(input, 'blur', mark);
  on(document, 'selectionchange', () => { if (document.activeElement === input) mark(); });
  on(input, 'keyup', mark);
  // a press on a window goes to it: the caret goes before its character (or after the last)
  on(input, 'pointerup', (e) => {
    if (e.button !== 0 || input.selectionStart !== input.selectionEnd) return;
    const r = cells[0].getBoundingClientRect(), pitch = cells.length > 1 ? cells[1].getBoundingClientRect().left - r.left : r.width;
    const i = Math.max(0, Math.min(input.value.length, Math.floor((e.clientX - r.left) / pitch)));
    input.setSelectionRange(i, i);
    mark();
  });
  on.heed(input, 'value', clean); // set from code
  on({ addEventListener() {}, removeEventListener() { el.removeAttribute('data-vx-on'); if (max !== null) input.setAttribute('maxlength', max); if (made) for (const c of cells) c.remove(); } }, 'end', mark);
  clean();
  return st;
}

// A window: a well a character wide. Its rim is warm at rest, the accent where the next
// character goes, red when the code is wrong; switched off, it is a slate hole with no light.
export const codeCell = {
  name: 'code-cell',
  selector: '.vx-otp-cell',
  pad: 6,
  glowRadius: 3,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { el } = live, input = el.parentElement?.querySelector(':scope > input');
    const bad = input?.getAttribute('aria-invalid') === 'true', off = !!input?.disabled, active = el.hasAttribute('data-vx-active');
    const wall = off ? 'slate' : bad ? 'light-stop' : active ? 'light' : lightName(el.parentElement ?? el, 'light-warm');
    hole(live, m, { depth: live.look.well, wall, floor: off ? 'slate' : 'floor' });
    live.state.off = off;
    live.spring('lit', 0, CALM.k * 2, CALM.c * 1.4).snap(active || bad ? 1 : 0);
  },

  pose(live) {
    const lit = live.spring('lit').x;
    live.glowStrength = live.state.off ? 0 : halo(GLOW) * (warmth(live) + lit * (live.theme === 'day' ? 2.2 : 1.6));
    live.glowRadius = 3 + lit;
  },

  bind(live) {
    const on = listeners(), input = live.el.parentElement?.querySelector(':scope > input');
    // the mark moves many times a second while typing: the window swaps its light, it does not animate
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-active'] }, () => live.rebuild());
    if (input) on.watch(input, { attributes: true, attributeFilter: ['disabled', 'aria-invalid'] }, () => live.rebuild());
    return on.done;
  },
};

// Six adjacent pockets in a shallow metal receiver. Each pitch includes one
// course of the common rail on either side of the window.
const readoutCell = {
  name: 'code-readout-cell',
  bind: codeCell.bind,
  pad: 3,
  glowRadius: 1.5,
  glowStrength: halo(0.021),

  build(live, m) {
    const { W, H, el } = live;
    const input = el.parentElement.querySelector('input');
    const on = !input.disabled && (input.getAttribute('aria-invalid') === 'true' || el.hasAttribute('data-vx-active'));
    const lens = on ? (input.getAttribute('aria-invalid') === 'true' ? 'light-stop' : 'light') : 'lens';
    const { floor } = hole(live, m, { y: 1, h: H - 2, depth: 1, wall: 'slate', floor: 'gasket' });

    const rail = m.part('carrier');
    rail.box(-1, 0, 0, W + 2, H, 1, 'slate').carve(0, 1, 0, W, H - 2, 1);
    const pilot = m.part('pilot');
    pilot.sunk = true;
    const x = Math.floor((W - 3) / 2), y = H - 3;
    floor.carve(x, y, -2, 3, 1, 1);
    pilot.box(x, y, -2, 3, 1, 1, lens);
    live.state.tint = undefined;
  },

  pose(live) {
    if (live.state.tint === live.tintRevision) return;
    live.state.tint = live.tintRevision;
    const { pilot, floor } = live.model.byName;
    if (pilot.col[3] <= 0) return;
    // The centre diode feeds two smoked end facets. The matte pocket
    // picks up a short reflection below the glass, inside this window.
    const x = Math.floor((live.W - 3) / 2) + 1.5, y = live.H - 2.5;
    const rgb = pilot.col.slice(0, 3);
    for (let i = 0; i < pilot.count; i++) {
      if (pilot.rest[i * 3] === x) continue;
      for (let c = 0; c < 4; c++) pilot.col[i * 4 + c] *= 0.65;
    }
    for (let i = 0; i < floor.count; i++) {
      const dx = floor.rest[i * 3] - x, dy = floor.rest[i * 3 + 1] - y;
      const amount = 0.28 * Math.max(0, 1 - (dx * dx + dy * dy) / 10);
      for (let c = 0; c < 3; c++) {
        const k = i * 4 + c;
        floor.col[k] += (rgb[c] - floor.col[k]) * amount;
      }
    }
  },
};

export const codeInput = {
  name: 'code-input',
  selector: '.vx-otp',
  pad: 0,

  bind(live) {
    const on = listeners(), st = wire(live.el, on), added = [];
    // the windows were made just now, after the page was adopted: they are added here
    const cell = live.el.hasAttribute('data-vx-readout') ? readoutCell : codeCell;
    for (const c of st.cells) if (!live.stage.lives.has(c)) { live.stage.add(c, cell); added.push(c); }
    return () => { for (const c of added) live.stage.remove(c); on.done(); };
  },

  plain(el, on) { wire(el, on); },
};
