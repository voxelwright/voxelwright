// Context menu. The kit's menu (menu.js), opened where the hand is: at the pointer by a right
// press, at the thing in focus by the menu key or Shift+F10, and at the finger by a long press.
// It closes on Escape, a press outside it, a scroll, a change of the window's size, a choice, or
// Tab out of it; the focus goes back to what had it.
// Tool: the menu (a float on the accent's light). This part draws nothing of its own: it is the
// behaviour of the region a right press opens the menu on.
// Markup: <div class="vx-context" data-vx-contextmenu="file-menu" aria-describedby="hint">
//           … rows, ideally ones that take the focus (tabindex="0", or links and buttons) …
//         </div>
//         <div class="vx-menu" id="file-menu" popover="manual" role="menu" aria-label="deploy-213.log">
//           <button role="menuitem">Open</button> … <button role="menuitem" data-vx-kind="danger">Delete</button>
//         </div>
//         The menu is popover="manual" (set so if it is not): the part closes it itself, so that
//         the press that opens it cannot also close it. A text field in the region keeps the
//         browser's own menu (its copy and paste). Before it opens, the element under the hand
//         (or in focus) hears a `vx-contextmenu` event, bubbling, with detail { menu, x, y }: a
//         page sets the menu's rows for that element there, or cancels it to keep the browser's.
//         Say somewhere near the region that it has a menu (the hint above): nothing else shows it.

import { listeners, clamp } from './util.js';

const EDGE = 12;   // px kept clear between the menu and the window's edge, as every float keeps
const HOLD = 500;  // ms a finger is held still for its menu
const SLOP = 10;   // px a finger may wander and still be held still

/** A text field, which keeps the browser's own menu. */
const editable = (n) => !!n?.closest?.('input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"])');

// which region opened each menu that is open now, so that one menu can serve many regions
const owner = new WeakMap();

function wire(area, on, live) {
  const menuOf = () => document.getElementById(area.dataset.vxContextmenu || '');
  let back = null;      // what had the focus
  let lastKey = -1e9;   // when a key opened it: the browser may then say the same in a contextmenu event
  let swallow = 0;      // until when the click after a long press is not a click
  let hold = null;      // a finger held down: [x, y, id, timer]
  let off = null;       // the listeners that live while it is open

  const close = () => { const m = menuOf(); if (m?.matches(':popover-open') && owner.get(m) === area) m.hidePopover(); };

  function openAt(x, y, from, { viaKey = false } = {}) {
    const m = menuOf();
    if (!m?.showPopover) return false;
    if (m.popover !== 'manual') m.popover = 'manual';
    const asked = new CustomEvent('vx-contextmenu', { bubbles: true, cancelable: true, detail: { menu: m, x, y } });
    if (!from.dispatchEvent(asked)) return false;
    if (m.matches(':popover-open')) m.hidePopover();
    const a = document.activeElement;
    back = a && a !== document.body && !m.contains(a) ? a : from.closest('[tabindex], a[href], button') ?? area;
    owner.set(m, area);
    if (viaKey) lastKey = performance.now();
    m.setAttribute('data-vx-at', '');
    if (!m.hasAttribute('tabindex')) m.tabIndex = -1;
    m.showPopover();
    // Its corner at the point; turned over where there is no room; inside the window. A slab's
    // sides show past its box, right and down, by half its height (a float's, from the look).
    const vx = live?.vx ?? (parseFloat(getComputedStyle(m).getPropertyValue('--vx')) || 4);
    const lift = (live?.stage?.lives.get(m)?.faceZ ?? 0) * vx / 2;
    const w = m.offsetWidth, h = m.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const rtl = getComputedStyle(from).direction === 'rtl';
    let left = rtl ? x - w : x, top = y;
    if (left + w + lift > vw - EDGE) left = x - w;
    if (left < EDGE) left = x;
    if (top + h + lift > vh - EDGE) top = y - h;
    left = Math.round(clamp(left, EDGE, Math.max(EDGE, vw - EDGE - lift - w)));
    top = Math.round(clamp(top, EDGE, Math.max(EDGE, vh - EDGE - lift - h)));
    m.style.margin = '0';
    m.style.inset = `${top}px auto auto ${left}px`;
    // the corner it grows from is the one at the point, in voxels (menu.js may read it; see the report)
    m.dataset.vxFrom = `${Math.round(clamp(x - left, 0, w) / vx)} ${Math.round(clamp(y - top, 0, h) / vx)}`;
    // from the keys, the first row has the focus; from a hand, the menu does, and the arrows go
    // to its rows from there
    const first = m.querySelector('[role^="menuitem"]:not(:disabled, [aria-disabled="true"])');
    if (viaKey && first) first.focus({ preventScroll: true }); else m.focus({ preventScroll: true });
    heed(m);
    return true;
  }

  // While it is open: it closes on a press outside it, Escape, a scroll, the window changing,
  // and the focus going somewhere else.
  function heed(m) {
    off?.();
    const o = listeners();
    off = o.done;
    o(document, 'pointerdown', (e) => { if (!m.contains(e.target)) close(); }, { capture: true });
    o(document, 'keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }, { capture: true });
    o(window, 'scroll', (e) => { if (!(e.target instanceof Node && m.contains(e.target))) close(); }, { capture: true, passive: true });
    o(window, 'resize', close);
    o(window, 'blur', close);
    o(m, 'focusout', (e) => { const to = e.relatedTarget; if (to && !m.contains(to)) close(); });
    o(m, 'toggle', (e) => {
      if (e.newState === 'open') return;
      off?.(); off = null;
      m.removeAttribute('data-vx-at');
      m.removeAttribute('data-vx-from');
      owner.delete(m);
      // the focus goes back, unless the hand has put it somewhere else
      const a = document.activeElement;
      if (back?.isConnected && (!a || a === document.body || m.contains(a))) back.focus({ preventScroll: true });
      back = null;
    });
  }

  // a right press, or the browser's own word for the menu key
  on(area, 'contextmenu', (e) => {
    const m = menuOf();
    if (!m || m.contains(e.target) || editable(e.target)) return;
    e.preventDefault();
    if (performance.now() < swallow) return; // a long press has opened it already
    const kb = e.pointerType === '' || (e.clientX === 0 && e.clientY === 0);
    if (kb && performance.now() - lastKey < 400) return; // the key that opened it, said again by the browser
    if (kb) { const at = pointOf(document.activeElement); openAt(at[0], at[1], document.activeElement, { viaKey: true }); }
    else openAt(e.clientX, e.clientY, e.target);
  });
  // the menu key, and Shift+F10, on the thing in focus
  on(area, 'keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) || editable(e.target)) return;
    e.preventDefault();
    const t = e.target instanceof Element ? e.target : area, at = pointOf(t);
    openAt(at[0], at[1], t, { viaKey: true });
  });
  // a long press of a finger; a finger that moves is scrolling, and is let be
  const drop = () => { if (hold) { clearTimeout(hold[3]); hold = null; } };
  on(area, 'pointerdown', (e) => {
    drop();
    if (e.pointerType !== 'touch' || !e.isPrimary || editable(e.target)) return;
    const { clientX: x, clientY: y, target } = e;
    hold = [x, y, e.pointerId, setTimeout(() => {
      hold = null;
      if (openAt(x, y, target)) { swallow = performance.now() + 900; navigator.vibrate?.(8); }
    }, HOLD)];
  });
  on(area, 'pointermove', (e) => { if (hold && e.pointerId === hold[2] && Math.hypot(e.clientX - hold[0], e.clientY - hold[1]) > SLOP) drop(); });
  for (const t of ['pointerup', 'pointercancel']) on(area, t, (e) => { if (hold && e.pointerId === hold[2]) drop(); });
  // The finger let go after a long press is not a tap on what is under it: no mouse events, no
  // focus taken from the menu, no click (a browser that sends them anyway is stopped too).
  const after = (e) => { if (performance.now() < swallow) { e.preventDefault(); if (e.type === 'click') e.stopPropagation(); } };
  on(area, 'touchend', after, { passive: false });
  for (const t of ['mousedown', 'click']) on(area, t, after, { capture: true });
  return () => { drop(); off?.(); };
}

/** Where a menu opened from the keys goes: a little in from the start of the thing in focus, at its middle. */
function pointOf(el) {
  const r = (el instanceof Element ? el : document.body).getBoundingClientRect();
  const rtl = el instanceof Element && getComputedStyle(el).direction === 'rtl';
  const x = rtl ? r.right - Math.min(r.width / 2, 24) : r.left + Math.min(r.width / 2, 24);
  return [x, r.top + Math.min(r.height / 2, 22)];
}

export const contextMenu = {
  name: 'context-menu',
  selector: '[data-vx-contextmenu]',

  bind(live) {
    const on = listeners();
    const undo = wire(live.el, on, live);
    return () => { undo(); on.done(); };
  },

  plain(el, on) { return wire(el, on, null); },
};
