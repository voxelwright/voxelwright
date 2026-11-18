// Accordion. Rows of words with a chevron, parted by grooves; what opens is on the same surface.
// Tool: none. The rows are the browser's own <details>, the grooves are .vx-groove, and there is
// nothing here to draw: this file only adds what <details> does not do by itself.
//   Down and Up move between the rows' summaries, Home and End go to the first and the last.
//   (Enter and Space open and close a row: that is the browser's.)
//   Where a browser does not know `name` on <details>, opening one row closes the others of its name.
// Markup: <div class="vx-accordion">
//           <details name="faq" open><summary>What a deploy does</summary><p>…</p></details>
//           <div class="vx-groove"></div>
//           <details name="faq"><summary>…</summary><p>…</p></details>
//         </div>
//         Leave `name` out and any number of rows can be open.

import { keyTarget } from '../plain.js';

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
  plain: wire,
};
