// Hover card. A look ahead at what a link leads to: the same float as a popover, on the accent's
// light, that opens by itself when the pointer rests on the link or the keyboard's focus lands on
// it, after a short wait. It stays while the pointer travels into it, and Tab goes on into it.
// It is never the only way to what it shows: the link itself leads there, and a finger, which has
// no hover, simply follows the link.
// Tool: float (a ring of light and a slab, look.float high).
// Markup: <a href="/people/mina" data-vx-card="c">Mina Okafor</a>
//         <div class="vx-hover-card" id="c" popover="manual">…</div>
//         Put the card straight after its link, so Tab goes from one into the other.
//         data-vx-side="top" and data-vx-align="end" as for a popover.
// Uses anchored() and slabOnLight() from popover.js.

import { halo } from '../core/light.js';
import { listeners } from './util.js';
import { anchored, slabOnLight } from './popover.js';

const OPEN = 400;  // ms the pointer rests, or the focus stays, before it opens
const CLOSE = 250; // ms it waits after they leave: time to travel from the link into the card

let shown = null;     // the one that is open: { el, hide }
const up = new Set(); // every open card's dismiss(), for Escape
const escape = (e) => { if (e.key === 'Escape') for (const dismiss of [...up]) dismiss(); };

const triggerOf = (el) => (el.id ? document.querySelector(`[data-vx-card="${CSS.escape(el.id)}"]`) : null);

function wire(el, on, live) {
  const t = triggerOf(el);
  if (!t || !el.showPopover) return;
  if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
  let timer = 0, hover = false, focus = false, mute = false;
  const isOpen = () => el.matches(':popover-open');
  const hide = () => {
    clearTimeout(timer);
    if (!isOpen()) return;
    // the focus was in the card: it goes back to the link, which does not open the card again
    if (el.contains(document.activeElement)) { mute = true; t.focus(); mute = false; focus = false; }
    el.hidePopover();
  };
  // sent away (Escape, a press on the link): it stays away until the pointer or the focus comes again
  const dismiss = () => { hover = false; hide(); focus = false; };
  const show = () => {
    clearTimeout(timer);
    if (isOpen() || !t.isConnected) return;
    if (shown && shown.el !== el) shown.hide(); // one at a time
    shown = { el, hide };
    el.showPopover();
  };
  // wanted while the pointer is on the link or the card, or the focus is in either
  const sync = () => {
    clearTimeout(timer);
    const want = hover || focus;
    if (want !== isOpen()) timer = setTimeout(want ? show : hide, want ? OPEN : CLOSE);
  };
  anchored(el, on, live, { trigger: () => t });
  on(el, 'toggle', (e) => {
    if (e.newState === 'open') { if (!up.size) document.addEventListener('keydown', escape, true); up.add(dismiss); return; }
    up.delete(dismiss);
    if (!up.size) document.removeEventListener('keydown', escape, true);
    if (shown?.el === el) shown = null;
  });
  const mouse = (e) => e.pointerType !== 'touch'; // a finger has no hover: it follows the link
  for (const node of [t, el]) {
    on(node, 'pointerenter', (e) => { if (mouse(e)) { hover = true; sync(); } });
    on(node, 'pointerleave', (e) => { if (mouse(e)) { hover = false; sync(); } });
    on(node, 'focusout', (e) => { const to = e.relatedTarget; focus = !!to && (to === t || el.contains(to)); sync(); });
  }
  on(t, 'focus', () => { if (!mute && t.matches(':focus-visible')) { focus = true; sync(); } });
  on(el, 'focusin', () => { focus = true; sync(); });
  // following the link is the answer: the card goes
  on(t, 'pointerdown', dismiss);
  on(t, 'click', dismiss);
  if (isOpen()) { up.add(dismiss); document.addEventListener('keydown', escape, true); }
}

export const hoverCard = {
  name: 'hover-card',
  selector: '.vx-hover-card',
  pad: 11,
  glowRadius: 2.2,
  glowStrength: halo(0.15),

  build(live, m) { slabOnLight(live, m); },

  pose(live) { live.glowStrength = halo(live.theme === 'day' ? 0.04 : 0.025); },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
