// Data table. The kit's table, with column heads you can press to sort, a checkbox a row and one
// for all of them, and the kit's pagination under it.
// Tool: none of its own. The table is words (table.js cuts its one groove), a sortable head is
// words you can press, the checkboxes are the kit's small wells (.vx-check) and the pages the
// kit's trench of seats (.vx-pagination). This part is the behaviour that makes them one thing.
// Markup: <div class="vx-data-table" id="deploys" data-vx-rows="5">
//           <div class="vx-table"><div class="vx-table-scroll" tabindex="0" role="region" aria-labelledby="cap"><table>
//             <caption id="cap">Deploys</caption>
//             <thead><tr>
//               <th scope="col" class="vx-data-table-pick"><label class="vx-check"><input type="checkbox" aria-label="Choose every row on this page"><span class="vx-box"></span></label></th>
//               <th scope="col" aria-sort="ascending"><button type="button" class="vx-data-table-sort">Service</button></th>
//               <th scope="col" class="vx-num"><button type="button" class="vx-data-table-sort">Builds</button></th>
//               <th scope="col">State</th>
//             </tr></thead>
//             <tbody><tr>
//               <td class="vx-data-table-pick"><label class="vx-check"><input type="checkbox" aria-label="Choose harbor-api"><span class="vx-box"></span></label></td>
//               <th scope="row">harbor-api</th><td class="vx-num">14</td><td>Live</td>
//             </tr>…</tbody>
//           </table></div></div>
//           <div class="vx-data-table-foot">
//             <p class="vx-data-table-count" role="status"></p>
//             <nav class="vx-pagination" aria-label="Pages of deploys" hidden>
//               <a class="vx-button" rel="prev" role="link" aria-disabled="true" aria-label="Previous page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//               <ol class="vx-pagination-pages"></ol>
//               <a class="vx-button" rel="next" role="link" aria-disabled="true" aria-label="Next page"><span class="vx-pagination-chevron" aria-hidden="true"></span></a>
//             </nav>
//           </div>
//         </div>
//   With no script every row is there to be read, in the order it was written, and the
//   pagination (written hidden) stays hidden: nothing offers what it cannot do.
//
// Sorting. A head with a <button> in it sorts by its column: ascending first, then descending.
//   The <th> carries aria-sort, and only the column sorted by has it. A column is sorted as
//   numbers if its head has data-vx-sort="number" or is a .vx-num, otherwise as words in the
//   page's language (Intl.Collator, so 10 follows 9 and é sits with e). A cell's value is its
//   data-vx-value, or its text: give data-vx-value where the text is not the value ("3 min 40 s",
//   a date). An empty cell is last either way. Rows that are equal keep the order they had.
// Choosing. The head's checkbox is for the rows on the page shown: ticked when all are, empty
//   when none, indeterminate when some.
// Pages. data-vx-rows on the root is how many rows a page holds; the part writes the seats.
// Keys: Tab to a head, Enter or Space sorts; Space ticks a checkbox; Tab and Enter on the pages.
// It tells: `vx-sort` (detail { column, direction }; preventDefault() and the part leaves the
//   rows to you, for a table sorted on a server), `vx-select` (detail { rows, count }), `vx-page`
//   (detail { page, pages }). After changing rows or ticks from code, refresh(el).
// The count's words are yours: data-vx-words="Rows {from} to {to} of {all}" and
//   data-vx-chosen="{chosen} chosen" on .vx-data-table-count.

import { listeners } from './util.js';

const NEXT = { ascending: 'descending', descending: 'ascending' };

/** A cell's value for sorting: as a number (NaN if it is not one), or as its words. */
function valueOf(cell, number) {
  const raw = (cell?.dataset.vxValue ?? cell?.textContent ?? '').trim();
  if (!number) return raw;
  return raw === '' ? NaN : Number(raw.replace(/[\s  ,]/g, '').replace('−', '-').replace(/^(-?[\d.]+).*$/, '$1'));
}

// The seats for page p of n: all of them when they fit, otherwise the first, the last, the
// current one and its neighbours, with a gap (0) where pages are passed over.
function seatsFor(p, n, narrow) {
  const k = narrow ? 5 : 7, side = (k - 5) / 2;
  const run = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  if (n <= k) return run(1, n);
  if (p <= k - 3) return [...run(1, k - 2), 0, n];
  if (p > n - (k - 3)) return [1, 0, ...run(n - (k - 3), n)];
  return [1, 0, ...run(p - side, p + side), 0, n];
}

function wire(el, on, moved = () => {}) {
  const body = () => el.querySelector('tbody');
  const rows = () => [...(body()?.rows ?? [])];
  const heads = () => [...el.querySelectorAll('thead th')];
  const all = () => el.querySelector('thead .vx-data-table-pick input[type="checkbox"]');
  const boxOf = (row) => row.querySelector('.vx-data-table-pick input[type="checkbox"]');
  const pager = el.querySelector('.vx-pagination'), list = pager?.querySelector('.vx-pagination-pages');
  const count = el.querySelector('.vx-data-table-count');
  const narrow = matchMedia('(max-width: 600px)');
  const tell = (type, detail, cancelable = false) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable, detail }));
  let page = 1, mine = false;
  // what the part writes itself is not news to it
  const quietly = (fn) => { mine = true; try { fn(); } finally { queueMicrotask(() => { mine = false; }); } };

  const size = () => Math.max(0, Math.floor(Number(el.dataset.vxRows) || 0));
  const pages = () => (size() && pager ? Math.max(1, Math.ceil(rows().length / size())) : 1);
  const shown = () => rows().filter((r) => !r.hidden);

  // ---- sorting
  function sortBy(th, direction) {
    const i = th.cellIndex, number = th.dataset.vxSort ? th.dataset.vxSort === 'number' : th.classList.contains('vx-num');
    const lang = el.closest('[lang]')?.lang || document.documentElement.lang || undefined;
    const words = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
    const way = direction === 'descending' ? -1 : 1;
    const keyed = rows().map((row, at) => ({ row, at, v: valueOf(row.cells[i], number) }));
    const empty = (v) => (number ? Number.isNaN(v) : v === '');
    keyed.sort((a, b) => {
      const ea = empty(a.v), eb = empty(b.v);
      if (ea || eb) return ea === eb ? a.at - b.at : ea ? 1 : -1; // what is empty is last, whichever way
      return (number ? a.v - b.v : words.compare(a.v, b.v)) * way || a.at - b.at;
    });
    quietly(() => body().append(...keyed.map((k) => k.row)));
  }
  function press(th) {
    const direction = NEXT[th.getAttribute('aria-sort')] ?? 'ascending';
    for (const h of heads()) if (h !== th) h.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', direction);
    // a table sorted somewhere else (a server) says so, and the rows are left to it
    if (tell('vx-sort', { column: th.cellIndex, direction, head: th }, true)) sortBy(th, direction);
    page = 1;
    draw();
    moved();
  }

  // ---- choosing
  function mark() {
    const box = all();
    if (!box) return;
    const here = shown().map(boxOf).filter((b) => b && !b.disabled), ticked = here.filter((b) => b.checked).length;
    const some = ticked > 0 && ticked < here.length, every = here.length > 0 && ticked === here.length;
    if (box.indeterminate !== some) box.indeterminate = some;
    if (box.checked !== every) box.checked = every;
  }
  const chosen = () => rows().filter((r) => boxOf(r)?.checked);
  function words() {
    if (!count) return;
    const n = rows().length, here = shown(), from = n ? rows().indexOf(here[0]) + 1 : 0, picked = chosen().length;
    const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => ({ from, to: from + here.length - (n ? 1 : 0), all: n, chosen: picked, page, pages: pages() })[k] ?? '');
    const text = fill(count.dataset.vxWords ?? 'Rows {from} to {to} of {all}') + (picked ? ' · ' + fill(count.dataset.vxChosen ?? '{chosen} chosen') : '');
    if (count.textContent !== text) count.textContent = text;
  }

  // ---- pages
  const step = (a, to) => {
    if (!a) return;
    if (to) { a.setAttribute('href', el.id ? '#' + el.id : '#'); a.dataset.vxPage = to; a.removeAttribute('aria-disabled'); a.removeAttribute('role'); }
    else { a.removeAttribute('href'); delete a.dataset.vxPage; a.setAttribute('aria-disabled', 'true'); a.setAttribute('role', 'link'); }
  };
  function seats() {
    if (!pager || !list) return;
    const n = pages();
    pager.hidden = !size() || n < 2;
    const want = seatsFor(page, n, narrow.matches), have = [...list.querySelectorAll(':scope > li')];
    const same = have.length === want.length && want.every((q, i) => (q === 0) === have[i].classList.contains('vx-pagination-gap'));
    const dress = (a, q) => {
      if (a.textContent !== String(q)) a.textContent = q;
      a.setAttribute('href', el.id ? '#' + el.id : '#'); a.dataset.vxPage = q; a.setAttribute('aria-label', (pager.dataset.vxPageWord ?? 'Page') + ' ' + q);
      if (q === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    };
    if (same) want.forEach((q, i) => { if (q) dress(have[i].firstElementChild, q); }); // the same seats: the key can slide
    else {
      for (const li of have) li.remove(); // the trench keeps its canvas
      list.append(...want.map((q) => {
        const li = document.createElement('li');
        if (!q) { li.className = 'vx-pagination-gap'; li.innerHTML = '<span aria-hidden="true">…</span><span class="vx-pagination-aloud"></span>'; li.lastChild.textContent = pager.dataset.vxGapWord ?? 'More pages'; return li; }
        const a = document.createElement('a');
        dress(a, q);
        li.append(a);
        return li;
      }));
    }
    step(pager.querySelector('[rel~="prev"]'), page > 1 ? page - 1 : 0);
    step(pager.querySelector('[rel~="next"]'), page < n ? page + 1 : 0);
  }

  // the rows of the page shown, the seats, the head's checkbox, the count
  function draw() {
    const n = pages(), s = size();
    page = Math.max(1, Math.min(n, page));
    rows().forEach((row, i) => { const off = !!s && !!pager && Math.floor(i / s) + 1 !== page; if (row.hidden !== off) row.hidden = off; });
    seats();
    mark();
    words();
  }
  function go(to, focus) {
    const was = page;
    page = to;
    draw();
    if (focus) list?.querySelector('[aria-current]')?.focus({ preventScroll: true }); // the seat pressed may now hold another number
    if (page !== was) tell('vx-page', { page, pages: pages() });
    moved();
  }

  on(el, 'click', (e) => {
    const sorter = e.target.closest?.('thead th button');
    if (sorter && el.contains(sorter)) return press(sorter.closest('th'));
    const a = e.target.closest?.('.vx-pagination a');
    if (!a || !pager?.contains(a)) return;
    e.preventDefault();
    if (a.dataset.vxPage) go(Number(a.dataset.vxPage), !!list?.contains(a));
  });
  on(el, 'change', (e) => {
    const box = e.target;
    if (!box.matches?.('.vx-data-table-pick input[type="checkbox"]')) return;
    if (box === all()) for (const b of shown().map(boxOf)) if (b && !b.disabled && b.checked !== box.checked) b.checked = box.checked;
    mark();
    words();
    tell('vx-select', { rows: chosen(), count: chosen().length });
  });
  on(narrow, 'change', () => seats());
  // rows that an app adds or takes away
  on.watch(el, { childList: true, subtree: true }, (list) => { if (!mine && list.some((r) => r.target.nodeName === 'TBODY')) draw(); });

  // as the page arrives: the column the markup says it is sorted by is sorted, if it is not yet
  const sorted = heads().find((h) => NEXT[h.getAttribute('aria-sort')]);
  if (sorted && el.dataset.vxSorted !== 'as-written') sortBy(sorted, sorted.getAttribute('aria-sort'));
  el.setAttribute('data-vx-table', '');
  draw();
  return draw;
}

export const dataTable = {
  name: 'data-table',
  selector: '.vx-data-table',
  refresh(live) { live.state.draw(); },

  bind(live) {
    const on = listeners();
    live.state.draw = wire(live.el, on, () => live.stage.resnapSoon());
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
