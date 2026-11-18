// Sidebar. A column of links and groups beside the content. It is part of the window's surface,
// parted from the rest by a standing groove. A key folds it away and brings it back. On a phone
// it is not beside anything: the same key brings it in over the page from the edge, as a surface
// a level above the page, and it goes when a link is followed, on Escape, or on a press outside.
// Tool: none of its own beside the content (its rows are the kit's navs, .vx-nav, with the accent
// groove at the start of the current one; its edge is the kit's groove). Over the page: a surface.
// Markup: <button class="vx-button" type="button" aria-controls="side" aria-expanded="true">Projects</button>
//         …
//         <div class="vx-sidebar" id="side">
//           <nav class="vx-nav" data-vx-mark="groove" data-vx-way="down" aria-label="Workspace">
//             <p class="vx-nav-title">Projects</p>
//             <ul><li><a href="/harbor-api" aria-current="page">harbor-api</a></li> …</ul>
//           </nav>
//           <span class="vx-groove" data-vx-way="down" aria-hidden="true"></span>
//         </div>
//         A long one: wrap the nav in <div class="vx-sidebar-scroll">, which scrolls by itself.
// Its key is any button with aria-controls naming it (there may be several). Whether it is
// folded is aria-expanded on its key and nothing else: the part reads that as the page arrives,
// and follows it when it is set from code. The sidebar itself is hidden with the hidden attribute.
// Where it comes in over the page is CSS's to say (--vx-sidebar-over: 1, set under 768 px by the
// kit's stylesheet). There aria-expanded says whether it is over the page now; it starts away,
// and what it was beside the content is kept in data-vx-folded until the window is wide again.
// With no script the sidebar is always shown, in the page's flow: its links are never lost.

import { listeners } from './util.js';
import { rouse } from './popover.js';

function wire(el, on, live) {
  const keys = () => (el.id ? [...document.querySelectorAll(`[aria-controls~="${CSS.escape(el.id)}"]`)] : []);
  const over = () => getComputedStyle(el).getPropertyValue('--vx-sidebar-over').trim() === '1' && !!el.showPopover;
  let mode = null; // 'beside' the content, or 'over' the page
  const shown = () => (mode === 'over' ? el.matches(':popover-open') : !el.hidden);
  const tell = (yes) => { for (const k of keys()) if (k.getAttribute('aria-expanded') !== String(yes)) k.setAttribute('aria-expanded', String(yes)); };
  const set = (yes) => {
    if (mode === 'over') { if (yes !== el.matches(':popover-open')) { if (yes) el.showPopover(); else el.hidePopover(); } }
    else {
      // folded away with the focus in it: the focus goes to its key, not to nowhere
      if (!yes && el.contains(document.activeElement)) keys()[0]?.focus();
      el.hidden = !yes;
    }
    tell(yes);
  };
  const sync = () => {
    const next = over() ? 'over' : 'beside';
    if (next === mode) return;
    if (next === 'over') {
      // what it was beside the content is kept in the markup; over the page it starts away
      const folded = mode === 'beside' ? el.hidden : keys().some((k) => k.getAttribute('aria-expanded') === 'false');
      el.toggleAttribute('data-vx-folded', folded);
      mode = 'over';
      el.hidden = false;
      el.setAttribute('popover', 'auto');
      // the browser's own way for a key to open and close it: a press on the key while it is open
      // closes it once, where a press "outside" and then a click would close and open it again
      for (const k of keys()) if (k.matches('button')) k.setAttribute('popovertarget', el.id);
      tell(false);
    } else {
      const folded = mode === 'over' ? el.hasAttribute('data-vx-folded') : keys().some((k) => k.getAttribute('aria-expanded') === 'false');
      if (mode === 'over') {
        if (el.matches(':popover-open')) el.hidePopover();
        el.removeAttribute('popover');
        el.removeAttribute('data-vx-folded');
        for (const k of keys()) k.removeAttribute('popovertarget');
      }
      mode = 'beside';
      el.hidden = folded;
      tell(!folded);
    }
    if (live) { live.canvas.hidden = mode !== 'over'; if (live.model) live.rebuild(); }
  };

  on(document, 'click', (e) => {
    const k = e.target.closest?.('[aria-controls]');
    if (!k || !keys().includes(k)) return;
    if (mode === 'over' && k.hasAttribute('popovertarget')) return; // the browser does it
    set(!shown());
  });
  // set from code: it follows
  on.watch(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] }, (list) => {
    for (const r of list) {
      if (!keys().includes(r.target)) continue;
      const want = r.target.getAttribute('aria-expanded') === 'true';
      if (want !== shown()) set(want);
    }
  });
  // over the page: it has no box until it is open, and by then it has been seen (see popover.js)
  on(el, 'beforetoggle', (e) => {
    if (e.newState !== 'open' || !live) return;
    el.setAttribute('data-vx-measure', '');
    rouse(live);
    el.removeAttribute('data-vx-measure');
  });
  on(el, 'toggle', (e) => {
    if (mode !== 'over') return;
    const open = e.newState === 'open';
    tell(open);
    // the focus goes into it: to the current link, or the first thing in it
    if (open) (el.querySelector('a[aria-current]:not([aria-current="false"])') ?? el.querySelector('a[href], button:not(:disabled)'))?.focus({ preventScroll: true });
  });
  // it has come to rest: its voxels are put on whole pixels where it now lies
  on(el, 'transitionend', (e) => { if (e.target === el) live?.stage.resnapSoon(); });
  // a link that is followed sends it away: it must not lie over where the link led
  on(el, 'click', (e) => { if (mode === 'over' && e.target.closest?.('a[href]') && el.matches(':popover-open')) el.hidePopover(); });
  on(window, 'resize', sync);

  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() {
    // given back to the page as the markup had it: in the flow, with its key saying what shows
    if (mode === 'over') {
      const folded = el.hasAttribute('data-vx-folded');
      if (el.matches(':popover-open')) el.hidePopover();
      el.removeAttribute('popover'); el.removeAttribute('data-vx-folded');
      for (const k of keys()) k.removeAttribute('popovertarget');
      el.hidden = false;
      tell(!folded);
    }
    el.removeAttribute('data-vx-on');
  } }, 'end', sync);
  sync();
}

export const sidebar = {
  name: 'sidebar',
  selector: '.vx-sidebar',
  pad: 12,

  build(live, m) {
    // beside the content it is part of the window's surface, and nothing is drawn. Over the page
    // it is a surface of its own.
    if (!live.el.hasAttribute('popover')) return;
    const { W, H } = live, d = live.look.slab;
    m.part('body').slab(0, 0, 0, W, H, d, 'chalk', live.look.round);
    live.faceZ = d;
  },

  bind(live) {
    live.canvas.hidden = true;
    const on = listeners();
    wire(live.el, on, live);
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
