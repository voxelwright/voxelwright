// Drawer. The sheet (sheet.js), made for where the window is: on a phone it comes up from the
// bottom, on a wide screen in from the end; data-vx-side fixes one edge. It has a handle at its
// inner edge, and on a phone it may be dragged shut by it: let go past a third of the way (or
// thrown), it goes the rest of the way and closes; let go short of that, it springs back. It
// never rests in between.
// Tool: surface (the sheet's slab), and a pull on it: a bar of steel standing a voxel proud,
// which turns to the accent's light while a hand holds it. Steel is for hardware.
// It is the browser's own <dialog>, shown with showModal(), as the sheet is: focus stays inside,
// Escape closes it, focus goes back to what opened it, the page behind does not scroll.
// Markup: <button class="vx-button" commandfor="cart" command="show-modal">Cart</button>
//         <dialog class="vx-drawer" id="cart" aria-labelledby="cart-h">
//           <header><h2 id="cart-h">Cart</h2></header>
//           <div class="vx-drawer-body">…</div>
//           <footer><button class="vx-button" data-vx-kind="main" data-vx-close="pay">Pay</button></footer>
//           <button class="vx-drawer-handle" type="button" data-vx-close="cancel" aria-label="Close the cart" tabindex="-1"></button>
//         </dialog>
//         The handle is a real key: pressed it closes the drawer; dragged along the way the
//         drawer came in, it carries the drawer with it. It is out of the Tab order (tabindex
//         -1), and last in the markup (CSS shows it at the inner edge), so that the focus does
//         not land on it as the drawer opens: from the keys, Escape and the drawer's own keys
//         close it. It shows where the drawer comes from the bottom (or the top); at the side
//         it is not needed and is hidden.
//         Everything else is the sheet's: data-vx-close, closedby, a form with method="dialog".
//         It needs css/sheet.css and css/drawer.css.

import { halo, warmth } from '../core/light.js';
import { listeners, clamp } from './util.js';
import { panel, edgeOf, wire as sheetWire } from './sheet.js';

const PULL = 12;       // the pull's length in voxels
const SHUT = 1 / 3;    // let go past this much of its size, it closes
const THROW = 0.45;    // px a ms: let go this fast toward its edge, it closes however far it went

/** Which way is "shut" for a drawer at this edge: the axis and its sign. */
const way = (edge) => (edge === 'bottom' ? ['y', 1] : edge === 'top' ? ['y', -1] : edge === 'right' ? ['x', 1] : ['x', -1]);

/** What the drawer does with a hand on its handle, voxels or not. */
function drag(el, on, live) {
  const handle = el.querySelector(':scope > .vx-drawer-handle');
  if (!handle) return;
  let id = null, start = 0, size = 1, d = 0, moved = false, last = [0, 0], speed = 0, axis = 'y', sign = 1;
  const hold = (yes) => {
    el.toggleAttribute('data-vx-dragging', yes);
    if (live) { live.state.held = yes; live.invalidate(); }
  };
  const put = (px) => {
    // pulled the other way it gives a little, as a thing at the end of its runners does
    const shown = px >= 0 ? px : -Math.sqrt(-px) * 2;
    el.style.translate = axis === 'y' ? `0 ${shown * sign}px` : `${shown * sign}px 0`;
    el.style.setProperty('--_drag', clamp(px / size, 0, 1).toFixed(3));
  };
  // Let go: no inline place and no inline transition, so the CSS takes it from where it is, to
  // its place (springs back) or out of the window (closes), with its own easing; at once where
  // motion is not wanted.
  const free = () => {
    el.style.removeProperty('translate');
    el.style.removeProperty('transition');
    el.style.removeProperty('--_drag');
  };
  on(handle, 'pointerdown', (e) => {
    if (id !== null || !el.open || (e.pointerType === 'mouse' && e.button !== 0)) return;
    [axis, sign] = way(edgeOf(el));
    id = e.pointerId; d = 0; moved = false; speed = 0;
    start = axis === 'y' ? e.clientY : e.clientX;
    last = [start, e.timeStamp];
    const r = el.getBoundingClientRect();
    size = Math.max(1, axis === 'y' ? r.height : r.width);
    handle.setPointerCapture?.(e.pointerId);
    el.style.transition = 'none';
    hold(true);
  });
  on(handle, 'pointermove', (e) => {
    if (e.pointerId !== id) return;
    const at = axis === 'y' ? e.clientY : e.clientX;
    d = (at - start) * sign;
    if (Math.abs(d) > 4) moved = true;
    const dt = e.timeStamp - last[1];
    if (dt > 0) speed = speed * 0.4 + (((at - last[0]) * sign) / dt) * 0.6;
    last = [at, e.timeStamp];
    if (moved) put(d);
  });
  const end = (e, cancelled) => {
    if (e.pointerId !== id) return;
    id = null;
    hold(false);
    const shut = !cancelled && moved && (d > size * SHUT || (speed > THROW && d > 16));
    free();
    if (shut) el.close('cancel');
  };
  on(handle, 'pointerup', (e) => end(e, false));
  on(handle, 'pointercancel', (e) => end(e, true));
  // the click that follows a drag is not a press: the drag said what it meant
  on(handle, 'click', (e) => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } }, { capture: true });
  // closed in some other way while held: let go
  on(el, 'close', () => { if (id !== null) { id = null; hold(false); free(); } });
}

function wire(el, on, live) {
  drag(el, on, live);
  sheetWire(el, on, live);
}

export const drawer = {
  name: 'drawer',
  selector: 'dialog.vx-drawer',
  pad: 10,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    panel(live, m);
    // the pull: a bar of steel on the face, at the middle of the handle, a voxel proud. Held, it
    // is the same bar in the accent's light.
    const h = live.el.querySelector(':scope > .vx-drawer-handle');
    live.state.pull = false;
    if (!h || !h.offsetWidth) return;
    const { vx } = live, top = live.look.slab;
    const x = Math.round((h.offsetLeft + h.offsetWidth / 2) / vx - PULL / 2), y = Math.round((h.offsetTop + h.offsetHeight / 2) / vx - 1);
    for (const [name, mat] of [['pull', 'steel'], ['pull-held', 'light']]) {
      const p = m.part(name);
      p.grounded = false;
      p.slab(x, y, top, PULL, 2, 1, mat, 1);
    }
    live.state.pull = true;
  },

  pose(live) {
    const held = !!live.state.held;
    const { pull, 'pull-held': lit } = live.model.byName;
    if (pull) { pull.hidden = held; lit.hidden = !held; }
    // the groove's light is the room's own; the pull, held, is the accent's and a little brighter
    live.glowStrength = halo(0.05) * warmth(live) * (held ? 1.6 : 1);
  },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    // a phone turned on its side may move it to another edge: draw it for the edge it is on
    const mq = matchMedia('(max-width: 639.98px)');
    on(mq, 'change', () => { if (live.el.open) live.rebuild(); });
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
