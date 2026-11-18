// Navigation menu. A site's top links, some of which open a float of more links under them (a
// product's pages, the docs), each with a line saying where it leads. It is navigation, not a
// menu of commands: real links in a <nav>, and words that open and close what is under them
// (the WAI-ARIA disclosure navigation pattern).
// Tool: none for the words; what opens is a float (a ring of light and a plate, look.float high).
// The current page is marked as everywhere: an accent groove under its word on the bar (under the
// word whose float holds it, if it is in one), and at its start in the float.
// Markup: <nav class="vx-navigation-menu" aria-label="fogline">
//           <ul>
//             <li><button type="button" aria-expanded="false" popovertarget="nm-product">Product</button>
//               <div class="vx-navigation-menu-float" id="nm-product" popover>
//                 <ul>
//                   <li><a href="/deploys"><span class="vx-nm-name">Deploys</span>
//                       <span class="vx-nm-about">Ship a branch to a region in one press.</span></a></li> …
//                 </ul>
//               </div></li>
//             <li><a href="/pricing" aria-current="page">Pricing</a></li>
//           </ul>
//         </nav>
//         popover="manual" keeps one open until it is told to go (for a page that shows one).
// Press: a word opens its float, and a second press closes it. The pointer resting on a word
// opens it too, and leaving the word and its float closes it again; a press just after it opened
// that way keeps it open instead of closing it. A finger has no hover: it presses.
// Keys: Tab goes through the words and into a float that is open, as the page's order has it;
// Enter and Space open and close; Left and Right go between the words of the bar, Home and End to
// the first and the last; Down on a word opens its float on its first link; Up and Down go
// between the links in it; Escape closes it and gives the focus back to its word; Tab out of it,
// a press outside, or a link followed closes it.
// The page (or its router) says which page is current with aria-current="page"; the part reads
// that and draws again when it changes.

import { halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';
import { anchored, slabOnLight } from './popover.js';
import { mark, currentOf } from './navs.js';

const OPEN = 120;  // ms the pointer rests on a word before its float opens
const CLOSE = 260; // ms after it leaves: time to travel from the word into the float

const floatOf = (b) => (b?.getAttribute('popovertarget') && document.getElementById(b.getAttribute('popovertarget'))) || null;
/** The words of the bar: its links and its buttons, not what is in a float. */
const topOf = (el) => [...el.querySelectorAll('a[href], button[popovertarget], a[aria-disabled]')].filter((n) => !n.closest('.vx-navigation-menu-float'));
const linksOf = (f) => [...f.querySelectorAll('a[href]')];
/** The word of the bar that is current: a link with aria-current, or the word whose float holds one. */
function currentWord(el) {
  for (const n of topOf(el)) {
    if (n.matches('a') && n.hasAttribute('aria-current') && n.getAttribute('aria-current') !== 'false') return n;
    const f = n.matches('button') && floatOf(n);
    if (f && currentOf(f)) return n;
  }
  return null;
}

function wire(el, on) {
  const words = () => topOf(el);
  const buttons = () => words().filter((n) => n.matches('button[popovertarget]'));
  const isOpen = (f) => !!f && f.matches(':popover-open');
  const rtl = () => getComputedStyle(el).direction === 'rtl';
  const state = new Map(); // button -> { timer, hover, byHover, at }
  const of = (b) => { let s = state.get(b); if (!s) state.set(b, (s = { timer: 0, hover: false, byHover: false, at: 0 })); return s; };
  const open = (b, how) => {
    const f = floatOf(b);
    if (!f) return;
    for (const o of buttons()) if (o !== b && isOpen(floatOf(o))) floatOf(o).hidePopover();
    const s = of(b);
    clearTimeout(s.timer);
    if (isOpen(f)) return; // already out: how it came out stays as it was
    s.byHover = how === 'hover'; s.at = performance.now();
    f.showPopover();
  };
  const close = (b, back) => {
    const f = floatOf(b);
    clearTimeout(of(b).timer);
    if (!isOpen(f)) return;
    const inside = f.contains(document.activeElement);
    f.hidePopover();
    if (back || inside) b.focus({ preventScroll: true });
  };

  for (const b of buttons()) {
    const f = floatOf(b);
    if (!f) continue;
    if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', String(isOpen(f)));
    on(f, 'toggle', (e) => {
      const yes = e.newState === 'open';
      b.setAttribute('aria-expanded', String(yes));
      if (!yes) of(b).byHover = false;
    });
    // a press just after it opened under the pointer keeps it open (it would toggle it shut)
    on(b, 'click', (e) => {
      const s = of(b);
      clearTimeout(s.timer); // a press is the answer: the pointer's wait is over
      if (isOpen(f) && s.byHover) { e.preventDefault(); s.byHover = false; return; }
      if (f.popover === 'manual' || !b.hasAttribute('popovertarget')) { e.preventDefault(); if (isOpen(f)) close(b); else open(b, 'press'); }
      else if (!isOpen(f)) { of(b).byHover = false; for (const o of buttons()) if (o !== b && isOpen(floatOf(o))) floatOf(o).hidePopover(); }
    });
    // the pointer: rest on the word to open; leave the word and the float to close (only one
    // that opened this way: one that was pressed open stays until it is sent away)
    const sync = () => {
      const s = of(b);
      clearTimeout(s.timer);
      if (s.hover && !isOpen(f)) s.timer = setTimeout(() => open(b, 'hover'), OPEN);
      else if (!s.hover && isOpen(f) && s.byHover) s.timer = setTimeout(() => { if (!of(b).hover) close(b); }, CLOSE);
    };
    for (const n of [b, f]) {
      on(n, 'pointerenter', (e) => { if (e.pointerType === 'touch') return; of(b).hover = true; sync(); });
      on(n, 'pointerleave', (e) => { if (e.pointerType === 'touch') return; of(b).hover = false; sync(); });
    }
    // keys in the float
    on(f, 'keydown', (e) => {
      const links = linksOf(f), i = links.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(b, true); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && links.length) {
        e.preventDefault();
        links[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus();
      } else if ((e.key === 'Home' || e.key === 'End') && links.length) { e.preventDefault(); (e.key === 'Home' ? links[0] : links.at(-1)).focus(); }
    });
    // the focus gone out of the word and the float: it closes
    for (const n of [b, f]) on(n, 'focusout', (e) => { const to = e.relatedTarget; if (to && to !== b && !f.contains(to) && isOpen(f)) close(b); });
    // a link followed: it closes (on a page that stays, it would lie over where the link led)
    on(f, 'click', (e) => { if (e.target.closest?.('a[href]')) close(b); });
  }

  // keys on the bar
  on(el, 'keydown', (e) => {
    const n = e.target;
    const all = words(), i = all.indexOf(n);
    if (i < 0) return;
    const fwd = rtl() ? 'ArrowLeft' : 'ArrowRight', back = rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd || e.key === back) { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, i + (e.key === fwd ? 1 : -1)))].focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); (e.key === 'Home' ? all[0] : all.at(-1)).focus(); }
    else if (e.key === 'ArrowDown' && n.matches('button[popovertarget]')) {
      e.preventDefault();
      open(n, 'key');
      linksOf(floatOf(n))[0]?.focus();
    } else if (e.key === 'Escape' && n.matches('button[popovertarget]') && isOpen(floatOf(n))) { e.preventDefault(); close(n, true); }
  });
  // the word whose float holds the current page says so, for the plain version's painted groove
  const current = () => { const w = currentWord(el); for (const b of buttons()) if (b.hasAttribute('data-vx-current') !== (b === w)) b.toggleAttribute('data-vx-current', b === w); };
  current();
  on.watch(el, { subtree: true, attributes: true, attributeFilter: ['aria-current'] }, current);
  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { for (const s of state.values()) clearTimeout(s.timer); el.removeAttribute('data-vx-on'); } }, 'end', () => {});
}

// the float: placed by its word, built out of the corner nearest it
function wireFloat(el, on, live) {
  if (!el.showPopover || !el.id) return;
  const word = () => document.querySelector(`[popovertarget="${CSS.escape(el.id)}"]`);
  anchored(el, on, live, { trigger: word, gap: 2 });
}

export const navigationMenu = {
  name: 'navigation-menu',
  selector: '.vx-navigation-menu',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  // the groove under the current word of the bar
  build(live, m) {
    const w = currentWord(live.el);
    if (w) mark(live, m, w, { way: 'under' });
  },

  pose(live) { live.glowStrength = halo(0.05) * byTheme(live); },

  bind(live) {
    const on = listeners(), el = live.el;
    wire(el, on);
    on.watch(el, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'dir', 'hidden'] }, () => live.rebuild());
    // a face that arrives late moves the words: the groove is measured again
    document.fonts?.ready.then(() => { if (live.canvas.isConnected) live.rebuild(); });
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};

const MARK_X = 2;

export const navigationMenuFloat = {
  name: 'navigation-menu-float',
  selector: '.vx-navigation-menu-float',
  pad: 11,
  glowRadius: 6,
  glowStrength: halo(0.15),

  build(live, m) {
    slabOnLight(live, m);
    // the current page in it: light in the plate's top layer at the start of its link, where a
    // groove would be cut
    const { el, vx, W } = live, d = live.look.float, G = live.look.groove;
    const cur = currentOf(el);
    if (!cur) return;
    const r = cur.getBoundingClientRect(), b = el.getBoundingClientRect();
    const y = Math.round((r.top - b.top) / vx), h = Math.round(r.height / vx);
    const rtl = getComputedStyle(el).direction === 'rtl';
    const x = Math.round(((rtl ? r.right : r.left) - b.left) / vx) + (rtl ? -1 - MARK_X : MARK_X);
    const inset = h > 6 ? 2 : 0;
    const part = m.part('mark');
    part.grounded = false;
    part.box(Math.max(1, Math.min(W - 2, x)), y + inset, d - G, 1, Math.max(1, h - inset * 2), G, 'light');
    part.tz = 0.03;
  },

  pose(live) { live.glowStrength = halo(live.theme === 'day' ? 0.18 : 0.15); },

  bind(live) {
    const on = listeners();
    wireFloat(live.el, on, live);
    on.watch(live.el, { subtree: true, attributes: true, attributeFilter: ['aria-current'] }, () => live.rebuild());
    return on.done;
  },

  plain(el, on) { wireFloat(el, on, null); },
};
