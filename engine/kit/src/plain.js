// Behaviour for the plain version. Most parts are native controls and need none. Three have
// behaviour HTML does not give them: tabs (choosing, arrow keys), a dialog's close buttons, and a
// menu (arrow keys, closing on a choice, telling its trigger it is open). With voxels each part
// does this itself; without them adopt() wires the same behaviour here, and draws nothing.

import { listeners } from './components/util.js';

const wired = new WeakMap(); // element -> undo

/** Mark tab i chosen: aria-selected, roving tabindex, and the panels named by aria-controls. */
export function chooseTab(tabs, i) {
  tabs.forEach((t, j) => {
    t.setAttribute('aria-selected', j === i ? 'true' : 'false');
    t.tabIndex = j === i ? 0 : -1;
    const panel = document.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = j !== i;
  });
}

/** Where an arrow, Home or End key leads from item i of n, or -1. keys: [next, previous]. */
export function keyTarget(key, i, n, [next, prev]) {
  return key === next ? (i + 1) % n : key === prev ? (i - 1 + n) % n : key === 'Home' ? 0 : key === 'End' ? n - 1 : -1;
}

const parts = [
  ['.vx-tabs', (el, on) => {
    const all = () => [...el.querySelectorAll(':scope > [role="tab"]')];
    const current = () => Math.max(0, all().findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    const choose = (i) => {
      if (i === current() && all()[i]?.getAttribute('aria-selected') === 'true') return;
      chooseTab(all(), i);
      el.dispatchEvent(new CustomEvent('vx-change', { bubbles: true, detail: { index: i } }));
    };
    chooseTab(all(), current());
    on(el, 'click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) choose(all().indexOf(t)); });
    on(el, 'keydown', (e) => {
      const to = keyTarget(e.key, current(), all().length, ['ArrowRight', 'ArrowLeft']);
      if (to < 0) return;
      e.preventDefault();
      choose(to);
      all()[to].focus();
    });
  }],
  ['dialog.vx-dialog', (el, on) => {
    on(el, 'click', (e) => {
      const b = e.target.closest('[data-vx-close]');
      if (b) { e.preventDefault(); el.close(b.value || b.dataset.vxClose || ''); }
      else if (e.target === el && el.hasAttribute('data-vx-light-dismiss')) el.close('cancel');
    });
  }],
  ['.vx-menu', (el, on) => {
    const items = () => [...el.querySelectorAll('[role^="menuitem"]')];
    const invoker = () => (el.id ? document.querySelector(`[popovertarget="${el.id}"]`) : null);
    on(el, 'toggle', (e) => {
      const t = invoker();
      t?.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open' || !t) return;
      const r = t.getBoundingClientRect(), gap = 12;
      el.style.left = Math.round(Math.min(r.left, Math.max(12, innerWidth - 12 - el.offsetWidth))) + 'px';
      el.style.top = Math.round(r.bottom + gap + el.offsetHeight > innerHeight - 12 && r.top - gap - el.offsetHeight > 12 ? r.top - gap - el.offsetHeight : r.bottom + gap) + 'px';
      if (t.matches(':focus-visible')) items()[0]?.focus();
    });
    on(el, 'keydown', (e) => {
      const all = items();
      const to = keyTarget(e.key, all.indexOf(document.activeElement), all.length, ['ArrowDown', 'ArrowUp']);
      if (to < 0) return;
      e.preventDefault();
      all[to].focus();
    });
    on(el, 'click', (e) => {
      if (!e.target.closest('[role^="menuitem"]')) return;
      const t = invoker();
      el.hidePopover?.();
      t?.focus();
    });
  }],
];

/**
 * A part of your own that needs behaviour without voxels: wire(el, on) is called for each element
 * that matches when the page is plain; `on` collects listeners (on(target, type, fn),
 * on.watch(...)), which are dropped if the element later gets voxels. index.js define() calls
 * this for a part that has a `plain` function.
 */
export function plainPart(selector, wire) {
  parts.push([selector, wire]);
}

/** Give the plain parts under root their behaviour. Safe to call again. */
export function behave(root = document) {
  for (const [selector, wire] of parts) {
    const found = root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    if (root.matches?.(selector)) found.unshift(root);
    for (const el of found) {
      if (wired.has(el) || el.hasAttribute('data-vx-live')) continue;
      const on = listeners();
      wire(el, on);
      wired.set(el, on.done);
    }
  }
}

/** Take the plain behaviour off one element (it is about to get voxels, which bring their own). */
export function unbehave(el) {
  wired.get(el)?.();
  wired.delete(el);
}
