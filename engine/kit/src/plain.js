// Behaviour for the plain version. Most parts are native controls and need none. Three have
// behaviour HTML does not give them: tabs (choosing, arrow keys), a dialog's close buttons, and a
// menu (arrow keys, closing on a choice, telling its trigger it is open). With voxels each part
// does this itself; without them adopt() wires the same behaviour here, and draws nothing.

import { wireDialog } from './components/dialog.js';
import { place } from './components/popover.js';
import { listeners } from './components/util.js';

const wired = new WeakMap(); // element -> wiring functions and their cleanups

/** Convert a distance from inline start to a model x. Use width 0 for a point, 1 for a cell. */
export function inlineX({ el, W }) {
  if (getComputedStyle(el).direction === 'rtl') return (start, width = 1) => W - start - width;
  return (start) => start;
}

/** A dir change can move a part's features without resizing its box. */
export function watchDirection(live, on) {
  let direction = getComputedStyle(live.el).direction;
  on.watch(live.el.getRootNode(), { attributes: true, subtree: true, attributeFilter: ['dir'] }, (changes) => {
    if (!changes.some(({ target }) => target.contains(live.el))) return;
    const next = getComputedStyle(live.el).direction;
    if (next === direction) return;
    direction = next;
    live.rebuild();
  });
}

export function tabKeys(el) {
  return getComputedStyle(el).direction === 'rtl' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
}

/** Position a menu at the inline start of the key that opened it. */
export function menuAnchor(el, on, gap) {
  let source;
  const invoker = () => source ?? (el.id ? document.querySelector(`[popovertarget="${CSS.escape(el.id)}"]`) : null);
  const put = () => {
    // Only a menu taller than the window needs a scrollport. Leave the plate fixed
    // and scroll its rows, so End, pointer selection and the rim share one coordinate system.
    if (el.offsetHeight > innerHeight - 24 && !el.querySelector(':scope > .vx-menu-rows')) {
      const rows = document.createElement('div');
      rows.className = 'vx-menu-rows';
      const children = [...el.childNodes].filter(child => !child.classList?.contains('vx-canvas'));
      const focused = el.contains(document.activeElement) ? document.activeElement : null;
      el.append(rows);
      for (const child of children) rows.append(child);
      focused?.focus({ preventScroll: true });
      if (focused) rows.scrollTop = Math.max(0, focused.offsetTop + focused.offsetHeight - rows.clientHeight);
    }
    const t = invoker();
    return t ? place(el, t, { gap: gap() }) : [0, 0];
  };
  on(el, 'beforetoggle', (e) => { if (e.newState === 'open') source = e.source; });
  on.watch(el.getRootNode(), { attributes: true, subtree: true, attributeFilter: ['dir'] }, (changes) => {
    if (!el.matches(':popover-open')) return;
    const t = invoker();
    if (t && changes.some(({ target }) => target.contains(t))) put();
  });
  on(window, 'resize', () => { if (el.matches(':popover-open') && invoker()) put(); });
  return { invoker, put };
}

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

export const menuEnabled = (item) => item && !item.matches(':disabled, [aria-disabled="true"]');

export function menuTarget(key, items, from) {
  if (!['Home', 'End', 'ArrowDown', 'ArrowUp'].includes(key)) return null;
  const count = items.length, backwards = key === 'End' || key === 'ArrowUp';
  let index = key === 'Home' || key === 'End' ? -1 : items.indexOf(from);
  if (index < 0 && backwards) index = 0;
  for (let tried = 0; tried < count; tried++) {
    index = (index + (backwards ? -1 : 1) + count) % count;
    if (menuEnabled(items[index])) return items[index];
  }
  return null;
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
      const to = keyTarget(e.key, current(), all().length, tabKeys(el));
      if (to < 0) return;
      e.preventDefault();
      choose(to);
      all()[to].focus();
    });
  }],
  ['dialog.vx-dialog', wireDialog],
  ['.vx-menu', (el, on) => {
    const items = () => [...el.querySelectorAll('[role^="menuitem"]')];
    const { invoker, put } = menuAnchor(el, on, () => 12);
    on(el, 'toggle', (e) => {
      const t = invoker();
      t?.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open' || !t) return;
      put();
      if (t.matches(':focus-visible')) items().find(menuEnabled)?.focus();
    });
    on(el, 'keydown', (e) => {
      const to = menuTarget(e.key, items(), document.activeElement);
      if (!to) return;
      e.preventDefault();
      to.focus();
    });
    on(el, 'click', (e) => {
      if (!menuEnabled(e.target.closest('[role^="menuitem"]'))) return;
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
export function behave(root = document, deep = true) {
  for (const part of parts) {
    const [selector, wire] = part;
    const found = deep && root.querySelectorAll ? [...root.querySelectorAll(selector)] : [];
    if (root.matches?.(selector)) found.unshift(root);
    for (const el of found) {
      if (el.hasAttribute('data-vx-live')) continue;
      let bindings = wired.get(el);
      if (!bindings) wired.set(el, bindings = new Map());
      if (bindings.has(part)) continue;
      const on = listeners();
      const undo = wire(el, on);
      bindings.set(part, () => { if (typeof undo === 'function') undo(); on.done(); });
    }
  }
}

/** Take the plain behaviour off one element (it is about to get voxels, which bring their own). */
export function unbehave(el) {
  for (const undo of wired.get(el)?.values() ?? []) undo();
  wired.delete(el);
}
