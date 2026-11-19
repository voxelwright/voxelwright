// Sheet. A panel that comes in from an edge of the window and lies a level above the page, over
// a scrim. It is the browser's own <dialog>, shown with showModal(): focus stays inside it,
// Escape closes it, focus goes back to what opened it, and the page behind does not scroll.
// Tool: surface (one slab, look.slab thick). It is not bolted down, because it moves. A groove of
// the room's light parts its header from what is below. No light of its own: it is a surface,
// not a float. It reaches past the window on the sides it came from, so what shows is its one
// inner edge, with its thickness.
// Markup: <button class="vx-button" commandfor="filters" command="show-modal">Filters</button>
//         <dialog class="vx-sheet" id="filters" data-vx-side="end" aria-labelledby="filters-h">
//           <header><h2 id="filters-h">Filters</h2>
//             <button class="vx-button vx-close" type="button" data-vx-close aria-label="Close filters">×</button></header>
//           <div class="vx-sheet-body">…</div>
//           <footer><button class="vx-button" data-vx-kind="main" data-vx-close="apply">Apply</button></footer>
//         </dialog>
//         data-vx-side: "end" (the default), "start", "top", "bottom". A key with data-vx-close
//         closes it with that word as the dialog's returnValue; a form with method="dialog" does
//         too. Escape and a press on the scrim close it with "cancel" (closedby="none" on the
//         dialog keeps a press on the scrim from closing it). From the page: el.showModal(),
//         el.close(value).
// The slide is CSS (css/sheet.css): it is the same with no script, and there is none where
// motion is not wanted. The drawer (drawer.js) is this with a handle, and uses what this exports.

import { halo, warmth, UNDER } from '../core/light.js';
import { listeners } from './util.js';
import { rouse, nativeRelease } from './popover.js';

const OVER = 4;  // voxels the panel reaches past the window on the sides it does not show
const INSET = 4; // voxels the groove stops short of the panel's edges

/** The edge of the window it is on: 'left', 'right', 'top' or 'bottom'. CSS decides (--_side). */
export function edgeOf(el) {
  const cs = getComputedStyle(el), side = cs.getPropertyValue('--_side').trim() || 'end';
  if (side === 'top' || side === 'bottom') return side;
  return (side === 'end') !== (cs.direction === 'rtl') ? 'right' : 'left';
}

/** The panel: a slab on the page, with a groove under its header. */
export function panel(live, m) {
  const { W, H, el, vx } = live, d = live.look.slab, g = live.look.groove ?? 1;
  const edge = live.state.edge = edgeOf(el);
  const x0 = edge === 'right' ? 0 : -OVER, x1 = edge === 'left' ? W : W + OVER;
  const y0 = edge === 'bottom' ? 0 : -OVER, y1 = edge === 'top' ? H : H + OVER;
  const body = m.part('panel');
  body.box(x0, y0, 0, x1 - x0, y1 - y0, d, live.look.readingPlate ?? 'chalk');
  const head = el.querySelector(':scope > header');
  const y = head ? Math.round((head.offsetTop + head.offsetHeight) / vx) - 1 : 0;
  if (y > 1 && y < H - 2 && W > INSET * 2 + 2 && d > g + 1) {
    // The groove: the last row of the header, cut into the face. Its floor is light, and so is
    // the wall that is seen from here (the lower one), which lies in the slab's own cells, a
    // hair inside the channel and under the face, so that only its lit side shows.
    const x = INSET, w = W - INSET * 2;
    body.carve(x, y, d - g - 1, w, 1, g + 1);
    const groove = m.part('groove');
    groove.grounded = false;
    groove.box(x, y, d - g - 1, w, 1, 1, 'light-warm').box(x, y + 1, d - g, w, 1, g, 'light-warm');
    groove.ty = UNDER; groove.tz = UNDER;
  }
  live.faceZ = d;
}

/**
 * What a sheet does, with voxels or without: its keys close it, a press on the scrim closes it,
 * the page keeps still behind it, and its voxels are there on the first frame.
 */
export function wire(el, on, live, { parts = ['panel', 'groove'], surface = 'rim' } = {}) {
  const root = document.documentElement;
  nativeRelease(live, on, parts, 0.16, surface);
  let opener = null, bar = 0;
  // A key that names it opens it: <button commandfor="id" command="show-modal">. Where the
  // browser does not know these yet, the part does what they say.
  if (!('command' in HTMLButtonElement.prototype)) {
    on(document, 'click', (e) => {
      const b = e.target.closest?.('button[commandfor]');
      if (!b || !el.id || b.getAttribute('commandfor') !== el.id || b.disabled) return;
      const c = b.getAttribute('command');
      if (c === 'show-modal' && !el.open) el.showModal();
      else if (c === 'close' && el.open) el.close(b.value || '');
    });
  }
  // before it opens: what has the focus, and whether the page has a scrollbar to keep room for
  on(el, 'beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    opener = document.activeElement;
    bar = window.innerWidth - root.clientWidth;
  });
  const opened = () => {
    // closed, it had no box: it and what is in it are measured and drawn now, on the first frame
    if (live) {
      const resume = rouse(live);
      const edge = live.state.edge;
      const from = [edge === 'right' ? live.W : 0, edge === 'bottom' ? live.H : 0];
      live.play('assemble', parts, { duration: 0.24, surface, from, resume });
    }
    // the page behind does not scroll (CSS), and does not shift for want of its scrollbar
    if (el.matches(':modal') && bar > 0) root.style.scrollbarGutter = 'stable';
  };
  const closed = () => { if (!document.querySelector('dialog:modal')) root.style.scrollbarGutter = ''; };
  on.watch(el, { attributes: true, attributeFilter: ['open'] }, () => (el.open ? opened() : closed()));
  on.watch(el, { attributes: true, attributeFilter: ['data-vx-side', 'dir'] }, () => live?.rebuild());
  // the browser gives the focus back to what opened it; where it did not, the part does
  on(el, 'close', () => {
    const a = document.activeElement;
    if (opener?.isConnected && (!a || a === document.body || el.contains(a))) opener.focus();
    opener = null;
  });
  on(el, 'cancel', (e) => { if (e.cancelable) { e.preventDefault(); el.close('cancel'); } });
  // A press on the scrim. A click on the dialog itself is either that or a click on its own
  // padding, so the point is what tells; and it must have gone down on the scrim too, so that a
  // drag out of a field does not close anything.
  const out = (e) => { const r = el.getBoundingClientRect(); return e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom; };
  let downOut = false;
  on(el, 'pointerdown', (e) => { downOut = e.target === el && out(e); });
  on(el, 'click', (e) => {
    const b = e.target.closest?.('[data-vx-close]');
    if (b && el.contains(b)) { e.preventDefault(); el.close(b.value || b.dataset.vxClose || ''); return; }
    const stays = el.getAttribute('closedby') === 'none' || el.getAttribute('closedby') === 'closerequest';
    if (e.target === el && downOut && out(e) && el.open && el.matches(':modal') && !stays) el.close('cancel');
    downOut = false;
  });
  // it has stopped: its canvas and its words go onto whole pixels where it now is
  on(el, 'transitionend', (e) => { if (e.target === el && e.propertyName === 'translate') live?.stage.resnapSoon(); });
  if (el.open) queueMicrotask(opened);
}

export const sheet = {
  name: 'sheet',
  selector: 'dialog.vx-sheet',
  pad: 10,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) { panel(live, m); },

  // the only light in it is the groove's, which is the room's own
  pose(live) { live.glowStrength = halo(0.05) * warmth(live); },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
