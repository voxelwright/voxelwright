// Tooltip. A few words about a control, on a small low plate with no light (a plate: its top has
// no step): it says something, it
// does nothing. It comes when the pointer rests on its trigger or the keyboard's focus lands on
// it, and goes when they leave, on Escape, and when the trigger is pressed. The first one waits a
// moment; with one just shown, its neighbours come at once.
// Tool: float, low (look.slab high) and unlit. Never put anything you can press in one.
// Markup: <button class="vx-button" aria-describedby="t">Roll back</button>
//         <span class="vx-tooltip" id="t" role="tooltip" popover="manual">To build 213, from yesterday</span>
//         data-vx-side="bottom" puts it under its trigger. With no script it stays hidden, and
//         its words still reach a screen reader through aria-describedby.
// Uses anchored() from popover.js (placing, building, following its trigger).

import { listeners } from './util.js';
import { anchored } from './popover.js';

const WAIT = 500;  // ms the pointer rests before the first one
const WARM = 300;  // ms after one has gone in which the next comes at once
const GRACE = 100; // ms to cross from the trigger onto the words (they can be pointed at and read)

let shown = null;          // the one the hand opened: { el, hide }
let lastGone = -Infinity;  // when it went
const up = new Set();      // every tooltip that is open, for Escape: each one's dismiss()
const escape = (e) => { if (e.key === 'Escape') for (const dismiss of [...up]) dismiss(); };

let made = 0;
function triggerOf(el) {
  if (el.id) {
    const id = CSS.escape(el.id);
    const t = document.querySelector(`[aria-describedby~="${id}"], [aria-labelledby~="${id}"]`);
    if (t) return t;
  }
  // not tied to anything: it belongs to what it follows, and says so from here on
  const t = el.previousElementSibling;
  if (!t) return null;
  if (!el.id) el.id = `vx-tooltip-${++made}`;
  t.setAttribute('aria-describedby', [t.getAttribute('aria-describedby'), el.id].filter(Boolean).join(' '));
  return t;
}

function wire(el, on, live) {
  const t = triggerOf(el);
  if (!t || !el.showPopover) return;
  if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
  if (!el.hasAttribute('role')) el.setAttribute('role', 'tooltip');
  let timer = 0, hover = false, focus = false, atOnce = false;
  const isOpen = () => el.matches(':popover-open');
  const hide = () => { clearTimeout(timer); if (isOpen()) el.hidePopover(); };
  // sent away (Escape, a press): it stays away until the pointer or the focus comes again
  const dismiss = () => { hover = false; focus = false; hide(); };
  const show = (now) => {
    clearTimeout(timer);
    if (isOpen() || !t.isConnected) return;
    if (shown && shown.el !== el) shown.hide(); // one at a time
    shown = { el, hide };
    atOnce = now;
    el.showPopover();
    atOnce = false;
  };
  // wanted while the pointer is on the trigger or the words, or the keyboard's focus is on the trigger
  const sync = () => {
    clearTimeout(timer);
    const want = hover || focus;
    if (want === isOpen()) return;
    if (!want) { if (shown?.el === el) timer = setTimeout(hide, GRACE); return; }
    if (focus || shown || performance.now() - lastGone < WARM) show(true);
    else timer = setTimeout(() => show(false), WAIT);
  };
  anchored(el, on, live, { trigger: () => t, side: 'top', align: 'center', gap: 1.5, duration: 0.14, still: () => atOnce });
  on(el, 'toggle', (e) => {
    if (e.newState === 'open') { if (!up.size) document.addEventListener('keydown', escape, true); up.add(dismiss); return; }
    up.delete(dismiss);
    if (!up.size) document.removeEventListener('keydown', escape, true);
    if (shown?.el === el) { shown = null; lastGone = performance.now(); }
  });
  const mouse = (e) => e.pointerType !== 'touch'; // a finger has no hover: the press is the answer
  on(t, 'pointerenter', (e) => { if (mouse(e)) { hover = true; sync(); } });
  on(t, 'pointerleave', (e) => { if (mouse(e)) { hover = false; sync(); } });
  on(el, 'pointerenter', (e) => { if (mouse(e) && shown?.el === el) { hover = true; sync(); } });
  on(el, 'pointerleave', (e) => { if (mouse(e)) { hover = false; sync(); } });
  on(t, 'focus', () => { if (t.matches(':focus-visible')) { focus = true; sync(); } });
  on(t, 'blur', () => { focus = false; hide(); });
  // pressing it is the answer: the words go
  on(t, 'pointerdown', dismiss);
  on(t, 'click', dismiss);
  if (isOpen()) { up.add(dismiss); document.addEventListener('keydown', escape, true); }
}

export const tooltip = {
  name: 'tooltip',
  selector: '.vx-tooltip',
  pad: 6,

  build(live, m) {
    const { W, H } = live, d = live.look.slab;
    m.part('body').slab(0, 0, 0, W, H, d, live.look.readingPlate ?? 'key', 1);
    live.faceZ = d;
  },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
