// Accordion. Rows of words with a chevron, parted by grooves; what opens is on the same surface.
// Tool: none. The rows are the browser's own <details>, the grooves are .vx-groove, and there is
// nothing here to draw: this file only adds what <details> does not do by itself.
//   Down and Up move between the rows' summaries, Home and End go to the first and the last.
//   (Enter and Space open and close a row: that is the browser's.)
//   Where a browser does not know `name` on <details>, opening one row closes the others of its name.
//   With voxels, the surface the rows are on is made once as a row opens, not on every frame
//   (see steady).
// Markup: <div class="vx-accordion">
//           <details name="faq" open><summary>What a deploy does</summary><p>…</p></details>
//           <div class="vx-groove"></div>
//           <details name="faq"><summary>…</summary><p>…</p></details>
//         </div>
//         Leave `name` out and any number of rows can be open.

import { listeners } from './util.js';
import { keyTarget } from '../plain.js';

// A box that is exactly as tall as what is in it: if what is in it grows, so does the box.
function snug(box) {
  const cs = getComputedStyle(box);
  if (!/visible|clip/.test(cs.overflowY)) return false;
  let low = -Infinity;
  for (const c of box.children) {
    const s = getComputedStyle(c);
    if (s.position === 'absolute' || s.position === 'fixed' || s.display === 'none') continue;
    low = Math.max(low, c.getBoundingClientRect().bottom + (parseFloat(s.marginBottom) || 0));
  }
  return Math.abs(box.getBoundingClientRect().bottom - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.borderBottomWidth) || 0) - low) < 1.5;
}

/**
 * A row opens over a fifth of a second, and the surface it is on grows with it. A surface is made
 * of voxels and is made again whenever its size changes: for a large one that is a tenth of a
 * second each time, so a row that opened over twelve frames would be three slow ones. This keeps
 * the surface still instead: it takes its new size once (as the row starts to open; when a row
 * has finished closing), and what is on it slides as before. Where the surface's height is not
 * simply that of what is in it, nothing is done.
 * root: what holds the rows; rows(): the <details> under it. Listeners go to `on`.
 */
export function steady(root, on, live, rows) {
  let held = null, asked = false;
  const release = () => {
    if (!held) return;
    held.el.style.minBlockSize = held.min;
    held.el.style.alignContent = held.align;
    held = null;
  };
  const surface = () => {
    for (let n = root.parentElement; n; n = n.parentElement) {
      if (!snug(n)) return null;
      if (live.stage.lives.has(n)) return n;
    }
    return null;
  };
  // how much of a row's inside shows now, and how much will once it has come to rest
  const reach = (d) => {
    const sum = d.querySelector(':scope > summary'), inside = [...d.children].filter((c) => c !== sum);
    const shown = d.getBoundingClientRect().height - (sum?.getBoundingClientRect().height ?? 0);
    const whole = inside.length ? inside.at(-1).getBoundingClientRect().bottom - inside[0].getBoundingClientRect().top : 0;
    return (d.open ? whole : 0) - shown;
  };
  // each frame while it is held: let go once every row is at rest (or has stopped moving)
  const watch = () => {
    if (!held) return;
    const left = rows().reduce((n, d) => n + Math.abs(reach(d)), 0);
    held.calm = Math.abs(left - held.left) < 0.05 ? held.calm + 1 : 0;
    held.left = left;
    if (left < 0.5 || held.calm > 6) release(); else requestAnimationFrame(watch);
  };
  const begin = () => {
    asked = false;
    const all = rows(), turned = all.map((d) => (d.open ? 1 : 0)).join('');
    if (held && held.turned === turned) return; // already held for this
    release(); // another row, or the same one pressed again half way: start from where things are now
    const gaps = all.map(reach).filter((g) => Math.abs(g) > 0.5);
    if (!gaps.length) return; // nothing is on its way: it opened at once (reduced motion, an older browser)
    const el = surface();
    if (!el) return;
    const cs = getComputedStyle(el);
    let size = el.getBoundingClientRect().height + Math.max(0, gaps.reduce((n, g) => n + g, 0));
    if (cs.boxSizing !== 'border-box') size -= ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + (parseFloat(cs[k]) || 0), 0);
    held = { el, turned, left: Infinity, calm: 0, min: el.style.minBlockSize, align: el.style.alignContent };
    el.style.alignContent = 'start'; // the room it is given is under what is in it, not shared out between its rows
    el.style.minBlockSize = size + 'px';
    requestAnimationFrame(watch);
  };
  const soon = () => { if (!asked) { asked = true; requestAnimationFrame(begin); } };
  // a press or a key on a summary turns the row once that event is over; anything else that
  // turns one (code, find-in-page) is heard from the attribute
  on(root, 'click', (e) => { if (e.target.closest?.('summary')) soon(); });
  on.watch(root, { attributes: true, attributeFilter: ['open'], subtree: true }, soon);
  return release;
}

function wire(el, on) {
  const rows = () => [...el.querySelectorAll(':scope > details > summary')];
  on(el, 'keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = rows(), at = all.indexOf(e.target);
    if (at < 0) return;
    const to = keyTarget(e.key, at, all.length, ['ArrowDown', 'ArrowUp']);
    if (to < 0) return;
    e.preventDefault(); // the page does not scroll under the arrows
    all[to].focus();
  });
  if (!('name' in HTMLDetailsElement.prototype)) {
    // toggle does not bubble: it is heard on its way down
    on(el, 'toggle', (e) => {
      const d = e.target, name = d.getAttribute?.('name');
      if (!name || !d.open) return;
      for (const other of el.querySelectorAll(':scope > details[open]')) if (other !== d && other.getAttribute('name') === name) other.open = false;
    }, true);
  }
}

export const accordion = {
  name: 'accordion',
  selector: '.vx-accordion',
  pad: 0,

  build() {}, // nothing stands up and nothing is cut: the rows are words

  bind(live) {
    const on = listeners(), el = live.el;
    wire(el, on);
    const release = steady(el, on, live, () => [...el.querySelectorAll(':scope > details')]);
    return () => { release(); on.done(); };
  },

  plain(el, on) { wire(el, on); },
};
