// Combobox. A field you type in, and under it a float of rows that holds what matches what you
// have typed. The focus never leaves the field: the arrow keys move a mark down the rows, Enter
// takes the marked one into the field.
// Tool: well (the kit's .vx-well) and float (a ring of light and a plate, look.float high). The
// marked row has the accent groove at its start, as the menu marks its active row.
// Markup: <div class="vx-combobox">
//           <label class="vx-field-label" for="p">Project</label>
//           <span class="vx-well"><input id="p" type="text" role="combobox" aria-autocomplete="list"
//                  aria-expanded="false" aria-controls="p-list" autocomplete="off"></span>
//           <div class="vx-combobox-float" popover="manual">
//             <div role="listbox" id="p-list" aria-labelledby="p-label">
//               <div role="option">harbor-api <span class="vx-option-trail">Frankfurt</span></div> …
//             </div>
//             <p class="vx-combobox-empty" hidden>No project is called “{q}”.</p>
//           </div>
//         </div>
//         An option's words are what goes into the field; data-vx-value says otherwise, and
//         data-vx-keywords adds words it is found by. Options may stand in groups
//         (<div role="group" aria-label="…">); a group with none left is hidden.
// Keys (the WAI-ARIA list autocomplete): typing opens the rows and marks the first that matches;
// Down and Up move the mark (and open the rows, on the first or the last); Alt+Down opens them
// and marks nothing; Enter takes the marked row; Escape closes the rows, and a second Escape
// empties the field; Tab goes on and closes them. A press on a row takes it.
// Whether the rows are out is aria-expanded on the field, and which row is marked is its
// aria-activedescendant: set either from code and the part follows. A row taken is told with a
// `vx-choose` event on the field (detail: { option, value }) and a `change`.
// With no script it is a plain field you type in.
//
// The command palette uses the same rows and the same keys: sift, optionsOf, valueOf.

import { halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';
import { anchored, slabOnLight } from './popover.js';

let made = 0;
/** Every option under a listbox, in order. */
export const optionsOf = (list) => [...list.querySelectorAll('[role="option"]')];
/** The options that can be marked now: not filtered out, not in a hidden group, not off. */
export const shownOf = (list) => optionsOf(list).filter((o) => !o.closest('[hidden]') && o.getAttribute('aria-disabled') !== 'true');
/** What an option puts into the field: data-vx-value, or its own words without its trailing note. */
export function valueOf(o) {
  if (o.dataset.vxValue) return o.dataset.vxValue;
  let s = '';
  for (const n of o.childNodes) if (n.nodeType === 3 || (n.nodeType === 1 && !n.matches('.vx-option-trail, kbd, .vx-keys'))) s += n.textContent;
  return s.replace(/\s+/g, ' ').trim();
}
const fold = (s) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/**
 * Keep only the options whose words hold what is typed (any case, any accent): the words that go
 * into the field and data-vx-keywords, not a trailing note. Hide a group that has none left.
 * Returns how many are left.
 */
export function sift(list, q) {
  const k = fold(q.trim());
  let n = 0;
  for (const o of optionsOf(list)) {
    const hit = !k || fold(`${valueOf(o)} ${o.dataset.vxKeywords ?? ''}`).includes(k);
    o.hidden = !hit;
    if (hit) n++;
  }
  for (const g of list.querySelectorAll('[role="group"]')) g.hidden = !g.querySelector('[role="option"]:not([hidden])');
  return n;
}

/** Give every option an id, so the field can point at it. */
export function nameOptions(list) {
  for (const o of optionsOf(list)) if (!o.id) o.id = `vx-option-${++made}`;
}

/** The empty result in words: the element's template ({q} is what was typed), kept the first time. */
export function sayEmpty(node, q, n) {
  if (!node) return;
  node.dataset.vxSay ??= node.textContent;
  node.textContent = node.dataset.vxSay.replace('{q}', q.trim());
  node.hidden = n > 0 || !q.trim();
}

const MARK_X = 2;

function wire(el, on, live) {
  const list = el.querySelector('[role="listbox"]') ?? el;
  if (!list.id || !el.showPopover) return;
  const input = document.querySelector(`[aria-controls~="${CSS.escape(list.id)}"]`);
  if (!input) return;
  const well = input.closest('.vx-well') ?? input;
  const empty = el.querySelector('.vx-combobox-empty');
  nameOptions(list);
  const isOpen = () => el.matches(':popover-open');
  const active = () => { const id = input.getAttribute('aria-activedescendant'); return (id && document.getElementById(id)) || null; };

  // where the mark is drawn: the marked row's place in the float, in voxels; null if none shows
  const measure = () => {
    const a = active();
    if (!live) return;
    if (!a || !isOpen() || a.closest('[hidden]')) { live.state.at = null; live.invalidate(); return; }
    const r = a.getBoundingClientRect(), b = el.getBoundingClientRect(), box = list.getBoundingClientRect();
    // a row scrolled half out of sight is not marked: the mark would hang over the edge
    live.state.rowCenter = (r.top + r.height / 2 - b.top) / live.vx;
    live.state.at = r.top >= box.top - 1 && r.bottom <= box.bottom + 1 ? Math.round((r.top - b.top) / live.vx) : null;
    live.invalidate();
  };
  // the state in the markup, drawn: which row is marked, and whether the rows are out
  const sync = () => {
    const want = input.getAttribute('aria-expanded') === 'true';
    if (want !== isOpen()) { if (want) el.showPopover(); else el.hidePopover(); }
    const a = active();
    for (const o of optionsOf(list)) {
      const yes = o === a;
      if (o.hasAttribute('data-vx-active') !== yes) o.toggleAttribute('data-vx-active', yes);
      if (o.getAttribute('aria-selected') !== String(yes)) o.setAttribute('aria-selected', String(yes));
    }
    measure();
  };
  const mark = (o, scroll = true) => {
    if (o) input.setAttribute('aria-activedescendant', o.id); else input.removeAttribute('aria-activedescendant');
    if (o && scroll) o.scrollIntoView({ block: 'nearest' });
    sync();
  };
  const open = () => { if (input.getAttribute('aria-expanded') !== 'true') input.setAttribute('aria-expanded', 'true'); sync(); };
  const close = () => { input.setAttribute('aria-expanded', 'false'); mark(null, false); };
  // the rows hold what matches; the float is placed again, as its height has changed
  let put = () => {};
  const filter = () => {
    const n = sift(list, input.value);
    sayEmpty(empty, input.value, n);
    if (isOpen()) { put(); live?.rebuild(); }
    return n;
  };
  const choose = (o) => {
    if (!o || o.getAttribute('aria-disabled') === 'true') return;
    const value = valueOf(o);
    input.value = value;
    input.setSelectionRange?.(value.length, value.length);
    close();
    filter();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new CustomEvent('vx-choose', { bubbles: true, detail: { option: o, value } }));
  };
  const step = (by) => {
    const all = shownOf(list);
    if (!all.length) return;
    const i = all.indexOf(active());
    mark(all[i < 0 ? (by > 0 ? 0 : all.length - 1) : (i + by + all.length) % all.length]);
  };

  // as wide as its field: set before it is measured and placed
  const sizeToField = () => {
    const vx = live?.vx ?? (parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4);
    el.style.inlineSize = Math.max(1, Math.round(well.offsetWidth / vx)) * vx + 'px';
  };
  on(el, 'beforetoggle', e => { if (e.newState === 'open') sizeToField(); });
  put = anchored(el, on, live, { trigger: () => well, gap: 2, duration: 0.16 });
  on(el, 'toggle', (e) => {
    const yes = e.newState === 'open';
    if ((input.getAttribute('aria-expanded') === 'true') !== yes) input.setAttribute('aria-expanded', String(yes));
    if (!yes && input.hasAttribute('aria-activedescendant')) input.removeAttribute('aria-activedescendant');
    sync();
  });

  const fit = () => { if (isOpen()) { sizeToField(); put(); measure(); } };
  on(window, 'resize', fit);
  on(input, 'input', () => {
    const n = filter();
    open();
    // the first that matches is marked, so Enter takes it; with nothing typed, nothing is
    mark(input.value.trim() && n ? shownOf(list)[0] : null);
  });
  on(input, 'keydown', (e) => {
    if (e.isComposing) return;
    const out = isOpen();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!out) {
        filter(); open();
        if (e.altKey) return; // open, and nothing marked
        const all = shownOf(list);
        mark(e.key === 'ArrowDown' ? all[0] : all.at(-1));
        return;
      }
      if (e.altKey && e.key === 'ArrowUp') { const a = active(); if (a) choose(a); else close(); return; }
      step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const a = out && active();
      if (a) { e.preventDefault(); choose(a); }
    } else if (e.key === 'Escape') {
      if (out) { e.preventDefault(); e.stopPropagation(); close(); }
      else if (input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; filter(); input.dispatchEvent(new Event('input', { bubbles: true })); close(); }
    } else if (e.key === 'Tab') { if (out) close(); }
  });
  // a press in the field opens the rows; a focus by Tab does not
  on(input, 'pointerdown', (e) => { if (e.button === 0 && !isOpen() && !input.disabled && !input.readOnly) { filter(); open(); } });
  // a press on a row must not take the focus from the field
  on(el, 'pointerdown', (e) => e.preventDefault());
  on(list, 'pointermove', (e) => { const o = e.target.closest?.('[role="option"]'); if (o && o !== active() && o.getAttribute('aria-disabled') !== 'true') mark(o, false); });
  on(list, 'click', (e) => { const o = e.target.closest?.('[role="option"]'); if (o) choose(o); });
  on(list, 'scroll', measure, { passive: true });
  on(input, 'focusout', (e) => { if (isOpen() && !el.contains(e.relatedTarget)) close(); });
  // a press anywhere else closes them (a manual popover is not closed by the browser)
  on(document, 'pointerdown', (e) => { if (isOpen() && !el.contains(e.target) && !well.contains(e.target)) close(); }, true);
  on.watch(input, { attributes: true, attributeFilter: ['aria-expanded', 'aria-activedescendant'] }, sync);
  on.watch(list, { childList: true, subtree: true }, () => { nameOptions(list); if (isOpen()) { filter(); sync(); } });
  sift(list, input.value);
  sync();
  const resize = new ResizeObserver(entries => {
    if (entries.some(entry => entry.target === well)) fit();
    else measure();
  });
  resize.observe(well);
  if (live) resize.observe(list);
  return () => resize.disconnect();
}

export const combobox = {
  name: 'combobox',
  selector: '.vx-combobox-float',
  pad: 11,
  glowRadius: 2.2,
  glowStrength: halo(0.15),

  build(live, m) {
    slabOnLight(live, m);
    const { W, el, vx } = live, d = live.look.float, G = live.look.groove;
    const first = el.querySelector('[role="option"]:not([hidden])') ?? el.querySelector('[role="option"]');
    const h = first ? Math.max(3, Math.round(first.offsetHeight / vx)) : 11;
    // the mark: light in the plate's top layer where a groove would be cut, moved from row to row
    const pick = m.part('pick');
    pick.grounded = false;
    const rtl = getComputedStyle(el).direction === 'rtl';
    pick.box(rtl ? W - 1 - MARK_X : MARK_X, 2, d - G, 1, Math.max(1, h - 4), G, 'light');
    pick.tz = 0.03;
  },

  pose(live) {
    const { pick } = live.model.byName, at = live.state.at;
    pick.hidden = at == null;
    if (at != null) pick.ty = at;
    live.glowStrength = halo(live.theme === 'day' ? 0.04 : 0.025);
  },

  bind(live) {
    const on = listeners();
    const stopResize = wire(live.el, on, live);
    return () => { stopResize?.(); on.done(); };
  },

  plain(el, on) { return wire(el, on, null); },
};
