// Command palette. A dialog with a well at its top and rows of words under it: type, and the rows
// hold what matches; the arrow keys move the mark; Enter does the marked one. A chord (Ctrl+K, or
// Command+K on a Mac) brings it from anywhere on the page.
// Tool: the kit's dialog (a float at dialog height), the kit's well for what you type, and words.
// The marked row has the accent groove at its start, cut into the dialog's face as the list group
// marks its current row.
// Markup: <dialog class="vx-dialog vx-command-dialog" aria-label="Commands">
//           <div class="vx-command-head">
//             <label class="vx-aloud" for="q">Find a command or a project</label>
//             <span class="vx-well"><input id="q" type="text" role="combobox" aria-expanded="true"
//                    aria-controls="cmds" aria-autocomplete="list" autocomplete="off" autofocus></span>
//           </div>
//           <div class="vx-command-scroll">
//             <div class="vx-command" id="cmds" role="listbox" aria-label="Commands" data-vx-chord="mod+k">
//               <div role="group" aria-label="Projects">
//                 <div class="vx-command-title" aria-hidden="true">Projects</div>
//                 <div role="option" data-vx-value="open harbor-api">harbor-api <span class="vx-option-trail">Open</span></div> …
//               </div>
//             </div>
//           </div>
//           <p class="vx-command-empty" role="status" hidden>Nothing is called “{q}”.</p>
//         </dialog>
//         data-vx-chord: "mod+k" is Command+K on a Mac and Ctrl+K elsewhere; leave it out for none.
//         A key on the page that opens it: <button … commandfor="palette" command="show-modal"
//         data-vx-command="cmds"> (the browser's own invoker, which works with no script; the
//         part opens it where a browser does not know commandfor).
// Keys: typing keeps what matches and marks the first; Down and Up move the mark (round at the
// ends); Enter does the marked one; Escape closes it (the dialog's own). The focus stays in the
// field. A press on a row does it. What is done is told with a `vx-choose` event on the list
// (detail: { option, value }); the page does it, and the palette closes.
// Which row is marked is aria-activedescendant on the field: set it from code and the mark follows.
// With no script the dialog is the browser's own: its key opens it (commandfor), Escape closes
// it, and the rows are all there; nothing filters or marks them.
// Rows, filtering and their words are the combobox's: see combobox.js.

import { halo, byTheme } from '../core/light.js';
import { listeners } from './util.js';
import { optionsOf, shownOf, valueOf, sift, nameOptions, sayEmpty } from './combobox.js';
import { boxOf, mark as markOf } from './navs.js';

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Does a key event match a chord such as "mod+k" or "shift+mod+p"? */
export function chord(e, words) {
  const parts = words.toLowerCase().split('+').map((s) => s.trim());
  const key = parts.pop(), has = (k) => parts.includes(k);
  const mod = mac() ? e.metaKey : e.ctrlKey;
  if (has('mod') !== mod || has('shift') !== e.shiftKey || has('alt') !== e.altKey) return false;
  if (!has('mod') && (e.metaKey || e.ctrlKey)) return false;
  return e.key.toLowerCase() === key || e.code === `Key${key.toUpperCase()}`;
}

function wire(el, on, live) {
  const input = el.id && document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"]`);
  if (!input) return;
  const dialog = el.closest('dialog');
  const empty = dialog?.querySelector('.vx-command-empty') ?? null;
  nameOptions(el);
  const active = () => { const id = input.getAttribute('aria-activedescendant'); return (id && el.contains(document.getElementById(id)) && document.getElementById(id)) || null; };
  const sync = () => {
    const a = active();
    for (const o of optionsOf(el)) {
      const yes = o === a;
      if (o.hasAttribute('data-vx-active') !== yes) o.toggleAttribute('data-vx-active', yes);
      if (o.getAttribute('aria-selected') !== String(yes)) o.setAttribute('aria-selected', String(yes));
    }
    // the mark is a groove cut where the row is: drawn again only if it is at another row
    if (live && live.state.at !== a) { live.state.at = a; live.rebuild(); }
  };
  const mark = (o, scroll = true) => {
    if (o) input.setAttribute('aria-activedescendant', o.id); else input.removeAttribute('aria-activedescendant');
    if (o && scroll) o.scrollIntoView({ block: 'nearest' });
    sync();
  };
  const filter = () => {
    const n = sift(el, input.value);
    sayEmpty(empty, input.value, n);
    // Filtering can rearrange the fitted windows while keeping the same active option.
    if (live && dialog?.hasAttribute('data-vx-command-deck')) live.state.at = undefined;
    mark(shownOf(el)[0] ?? null);
    const scroller = el.parentElement;
    if (scroller && !active()) scroller.scrollTop = 0;
  };
  // the dialog's own way out, so that it is taken apart as it is everywhere else
  const close = (value = '') => {
    if (!dialog?.open) return;
    const d = live?.stage.lives.get(dialog);
    if (d?.state.leave) d.state.leave(value); else dialog.close(value);
  };
  const choose = (o) => {
    if (!o || o.getAttribute('aria-disabled') === 'true') return;
    const value = valueOf(o);
    el.dispatchEvent(new CustomEvent('vx-choose', { bubbles: true, detail: { option: o, value } }));
    close(value);
  };
  const step = (by) => {
    const all = shownOf(el);
    if (!all.length) return;
    const i = all.indexOf(active());
    mark(all[i < 0 ? (by > 0 ? 0 : all.length - 1) : (i + by + all.length) % all.length]);
  };
  const begin = () => {
    // it opens empty, with every row and the first marked
    input.value = '';
    filter();
    input.focus({ preventScroll: true });
  };

  on(input, 'input', filter);
  on(input, 'keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { const a = active(); if (a) { e.preventDefault(); choose(a); } }
  });
  // a press on a row must not take the focus from the field
  on(el, 'pointerdown', (e) => { if (e.button === 0) e.preventDefault(); });
  on(el, 'pointermove', (e) => { const o = e.target.closest?.('[role="option"]'); if (o && o !== active() && o.getAttribute('aria-disabled') !== 'true') mark(o, false); });
  on(el, 'click', (e) => { const o = e.target.closest?.('[role="option"]'); if (o) choose(o); });
  on.watch(input, { attributes: true, attributeFilter: ['aria-activedescendant'] }, sync);
  on.watch(el, { childList: true, subtree: true }, (list) => {
    if (live && list.every((r) => [...r.addedNodes, ...r.removedNodes].every((n) => n === live.canvas))) return;
    if (live && !live.canvas.isConnected) el.prepend(live.canvas);
    nameOptions(el); filter();
  });

  if (dialog) {
    // each time it opens it begins again; the dialog's own open is heard, whoever opened it
    on.watch(dialog, { attributes: true, attributeFilter: ['open'] }, () => { if (dialog.open) begin(); });
    // the chord: from anywhere on the page, to open it, and again to close it
    const words = el.dataset.vxChord;
    if (words) on(document, 'keydown', (e) => {
      if (e.repeat || !chord(e, words)) return;
      e.preventDefault();
      if (dialog.open) close('');
      else dialog.showModal();
    });
    // a key on the page that names it
    on(document, 'click', (e) => {
      const k = e.target.closest?.('[data-vx-command]');
      // a browser that knows commandfor opens it itself (and does so with no script at all)
      if (k && k.dataset.vxCommand === el.id && !dialog.open && !('commandForElement' in k && k.getAttribute('commandfor') === dialog.id)) dialog.showModal();
    });
  }
  // the chord, written the way this computer says it, in any .vx-kbd that asks for it
  // (its words only: the kbd's own drawing is in it too)
  for (const k of document.querySelectorAll(`[data-vx-chord-for="${CSS.escape(el.id)}"] [data-vx-mod]`)) {
    const walk = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
    let t; while ((t = walk.nextNode()) && !t.data.trim());
    if (t) t.data = mac() ? '⌘' : 'Ctrl';
  }
  sift(el, input.value);
  if (!active()) mark(shownOf(el)[0] ?? null, false); else sync();
}

export const commandPalette = {
  name: 'command-palette',
  selector: '.vx-command',
  pad: 4,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  // the mark of the marked row: an accent groove at its start
  build(live, m) {
    const a = live.state.at;
    if (live.el.closest('[data-vx-command-deck]')) {
      const sockets = m.part('sockets');
      const x = getComputedStyle(live.el).direction === 'rtl' ? live.W - 4 : 1;
      const glass = m.part('windows');
      for (const option of optionsOf(live.el)) {
        const box = boxOf(live, option);
        if (!box) continue;
        // The frosted face sits in the same stepped collar on every row.
        const y = box[1] + Math.floor((box[3] - 4) / 2);
        sockets.slab(x, y, 0, 3, 4, 1, 'slate', 1).carve(x + 1, y + 1, 0, 1, 2, 1);
        glass.box(x + 1, y + 1, 0, 1, 2, 1, option === a ? 'light' : 'lens');
      }
      return;
    }
    if (a && !a.closest('[hidden]')) markOf(live, m, a, { way: 'beside' });
  },

  pose(live) { live.glowStrength = halo(0.05) * byTheme(live); },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
