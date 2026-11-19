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
import { cue } from '../core/sound.js';
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

// A metal runner captures the stepped edge of the cartridge. The readout sits
// two courses below the cover, inside the actual scroll viewport of the facts.
function carriage(live, m) {
  const { el, W, H, vx } = live;
  live.state.edge = edgeOf(el);
  const d = live.faceZ = live.look.slab;
  if (!el.offsetWidth) return;
  const body = el.querySelector('.vx-drawer-body');
  const x = Math.round(body.offsetLeft / vx), y = Math.round(body.offsetTop / vx);
  const w = Math.round(body.offsetWidth / vx), h = Math.round(body.offsetHeight / vx);
  const metal = m.part('chassis');
  const bottom = live.state.edge === 'bottom';
  const left = live.state.edge === 'left' ? 3 : 0;
  const width = W - (bottom ? 0 : 3), height = H - (bottom ? 2 : 0);
  // Two runners stay attached to the sled and extend through the window edge.
  if (bottom) {
    for (const cx of [6, W - 12]) metal.box(cx, height - 2, 0, 6, 8, 2, 'steel');
  } else {
    for (const cy of [6, H - 12]) metal.box(left ? -4 : width - 2, cy, 0, 9, 6, 2, 'steel');
  }
  metal.slab(left, 0, 0, width, height, d - 2, 'steel', 2);
  metal.slab(left + 1, 1, d - 2, width - 2, height - 2, 1, 'gasket', 1);
  const cover = m.part('panel');
  cover.slab(left + 2, 2, d - 1, width - 4, height - 4, 1, live.look.readingPlate ?? 'chalk', 1);
  cover.carve(x, y, d - 1, w, h, 1);
  metal.slab(x, y, d - 2, w, h, 1, 'slate', 1);
  metal.carve(x + 1, y + 1, d - 2, w - 2, h - 2, 1);
  metal.box(x + 1, y + 1, d - 3, w - 2, h - 2, 1, 'gasket');
  for (const cx of [left + 4, left + width - 5]) for (const cy of [4, height - 5]) {
    cover.carve(cx - 1, cy - 1, d - 1, 3, 3, 1);
    metal.slab(cx - 1, cy - 1, d - 1, 3, 3, 1, 'steel', 1);
    metal.plot(cx, cy, d - 1, 'slate');
  }
}

function wire(el, on, live) {
  drag(el, on, live);
  if (el.hasAttribute('data-vx-carriage')) {
    sheetWire(el, on, live, { surface: 'courses', parts: ['panel', 'chassis', 'pull'] });
    on(el, 'transitionend', e => {
      if (e.target === el && !e.pseudoElement && e.propertyName === 'translate') cue(el.open ? 'press' : 'release');
    });
  } else sheetWire(el, on, live);
}

export const drawer = {
  name: 'drawer',
  selector: 'dialog.vx-drawer',
  pad: 10,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const mounted = live.el.hasAttribute('data-vx-carriage');
    if (mounted) carriage(live, m);
    else panel(live, m);
    // the pull: a bar of steel on the face, at the middle of the handle, a voxel proud. Held, it
    // is the same bar in the accent's light.
    const h = live.el.querySelector(':scope > .vx-drawer-handle');
    live.state.pull = false;
    if (!h || !h.offsetWidth) return;
    const { vx } = live, top = live.look.slab;
    const x = Math.round((h.offsetLeft + h.offsetWidth / 2) / vx - PULL / 2), y = Math.round((h.offsetTop + h.offsetHeight / 2) / vx - 1);
    if (mounted) {
      const metal = m.part('chassis');
      metal.slab(x - 2, y - 1, top, PULL + 4, 4, 1, 'gasket', 1);
      metal.box(x - 1, y, top, PULL + 2, 2, 1, 'steel');
    }
    for (const [name, mat] of [['pull', 'steel'], ['pull-held', 'light']]) {
      const p = m.part(name);
      p.grounded = false;
      p.slab(x, y, top + (mounted ? 1 : 0), PULL, 2, 1, mounted ? 'steel' : mat, 1);
      if (mounted && name === 'pull-held') p.tz = -0.75;
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
