// Menubar. The row of words across the top of an app (File, Edit, View) that each open a menu of
// commands. Words on the surface; what opens is the kit's menu, a float. The word whose menu is
// out has the accent groove under it.
// Tool: none for the words; the kit's menu (.vx-menu) for what opens; a groove for "this is out".
// Markup: <ul class="vx-menubar" role="menubar" aria-label="harbor-api">
//           <li role="none">
//             <button type="button" role="menuitem" id="m-file-k" aria-haspopup="menu" aria-expanded="false" popovertarget="m-file">File</button>
//             <div class="vx-menu" id="m-file" popover role="menu" aria-labelledby="m-file-k">
//               <button role="menuitem">New project</button> …
//             </div>
//           </li> …
//         </ul>
// Keys (the WAI-ARIA menubar): one word is a tab stop; Left and Right go between the words (and
// if a menu is out, the next one comes out in its place, also from inside a menu); Home and End
// go to the first and the last; Down, Enter and Space open a word's menu on its first command, Up
// on its last; in a menu Up and Down go between its commands (the menu's own), Escape puts it
// away and gives the focus back to its word, Tab puts it away and goes on. With a menu out, the
// pointer over another word brings that word's menu out instead.
// Whether a menu is out is the browser's own popover; its word says so with aria-expanded.

import { halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';
import { mark } from './navs.js';

const wordsOf = (el) => [...el.querySelectorAll('[role="menuitem"][popovertarget], :scope > li > [role="menuitem"], :scope > [role="menuitem"]')].filter((b, i, all) => all.indexOf(b) === i && !b.closest('[role="menu"]'));
const menuOf = (b) => (b?.getAttribute('popovertarget') && document.getElementById(b.getAttribute('popovertarget'))) || null;
const itemsOf = (menu) => [...menu.querySelectorAll('[role^="menuitem"]')].filter((i) => !i.disabled && i.getAttribute('aria-disabled') !== 'true');

function wire(el, on, live) {
  const words = () => wordsOf(el);
  const isOut = (m) => !!m && m.matches(':popover-open');
  const outWord = () => words().find((b) => isOut(menuOf(b))) ?? null;
  const rtl = () => getComputedStyle(el).direction === 'rtl';
  // one word is the tab stop: the one last in focus, or the first
  const rove = (b) => { for (const w of words()) w.tabIndex = w === b ? 0 : -1; };
  rove(words().find((w) => w.tabIndex === 0 && w.hasAttribute('tabindex')) ?? words()[0]);

  // after the menu's own toggle has run (it puts the focus on its first command when it is opened
  // from the keyboard), the focus goes where it was asked for
  const later = (fn) => setTimeout(fn, 0);
  const show = (b, focus) => {
    const m = menuOf(b);
    if (!m) return;
    for (const w of words()) if (w !== b && isOut(menuOf(w))) menuOf(w).hidePopover();
    rove(b);
    if (!isOut(m)) m.showPopover();
    if (focus === 'first' || focus === 'last') later(() => { const it = itemsOf(m); (focus === 'first' ? it[0] : it.at(-1))?.focus(); });
    else if (focus === 'word') b.focus();
  };
  const hide = (b) => { const m = menuOf(b); if (isOut(m)) m.hidePopover(); };
  const next = (b, by) => { const all = words(), i = all.indexOf(b); return all[(i + by + all.length) % all.length]; };

  // keys on the words
  on(el, 'keydown', (e) => {
    const b = e.target.closest?.('[role="menuitem"]');
    if (!b || !words().includes(b)) return;
    const back = rtl() ? 'ArrowRight' : 'ArrowLeft', fwd = rtl() ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === fwd || e.key === back || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const all = words();
      const to = e.key === 'Home' ? all[0] : e.key === 'End' ? all.at(-1) : next(b, e.key === fwd ? 1 : -1);
      const was = isOut(menuOf(b));
      if (was) { hide(b); show(to, 'first'); }
      rove(to); to.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show(b, e.key === 'ArrowDown' ? 'first' : 'last');
    } else if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      // the button would toggle it: out it comes, on its first command, as Down does
      e.preventDefault();
      if (isOut(menuOf(b))) { hide(b); b.focus(); } else show(b, 'first');
    }
  });
  on(el, 'focusin', (e) => { const b = e.target.closest?.('[role="menuitem"]'); if (b && words().includes(b)) rove(b); });

  // with a menu out, the pointer over another word brings that one out instead
  on(el, 'pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest?.('[role="menuitem"]');
    if (!b || !words().includes(b)) return;
    const out = outWord();
    if (out && out !== b) show(b, 'word');
  });

  // keys and focus inside each menu
  for (const b of words()) {
    const m = menuOf(b);
    if (!m) continue;
    on(m, 'keydown', (e) => {
      if (!e.target.closest?.('[role^="menuitem"]')) return;
      const back = rtl() ? 'ArrowRight' : 'ArrowLeft', fwd = rtl() ? 'ArrowLeft' : 'ArrowRight';
      if (e.key === fwd || e.key === back) {
        e.preventDefault();
        const to = next(b, e.key === fwd ? 1 : -1);
        hide(b); show(to, 'first'); to.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide(b); b.focus();
      } else if (e.key === 'Tab') hide(b);
    });
    // Tab or a press elsewhere takes the focus out of it: it goes
    on(m, 'focusout', (e) => { const to = e.relatedTarget; if (to && !m.contains(to) && to !== b && isOut(m) && !words().includes(to)) hide(b); });
    // a menu put away with the focus in it gives the focus back to its word
    on(m, 'toggle', (e) => {
      b.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState === 'closed' && (m.contains(document.activeElement) || document.activeElement === document.body)) {
        if (!words().some((w) => w !== b && isOut(menuOf(w)))) b.focus({ preventScroll: true });
      }
    });
    if (!b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', String(isOut(m)));
  }
  // the groove under the word whose menu is out
  if (live) {
    on.watch(el, { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'dir'] }, () => live.rebuild());
    // a face that arrives late moves the words: the groove is measured again
    document.fonts?.ready.then(() => { if (live.canvas.isConnected) live.rebuild(); });
  }
  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { el.removeAttribute('data-vx-on'); } }, 'end', () => {});
}

export const menubar = {
  name: 'menubar',
  selector: '.vx-menubar',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const b = wordsOf(live.el).find((w) => w.getAttribute('aria-expanded') === 'true');
    if (b) mark(live, m, b, { way: 'under' });
  },

  pose(live) { live.glowStrength = halo(0.05) * byTheme(live); },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
