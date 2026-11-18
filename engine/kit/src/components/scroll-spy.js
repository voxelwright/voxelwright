// Scroll spy. Links to the sections of a page; as the page is scrolled, the link of the section
// being read is marked, and an accent groove moves to it.
// Tool: none for the words; the mark is the kit's groove (.vx-groove) in the accent's light.
// Markup: <nav class="vx-spy" aria-label="On this page">
//           <span class="vx-groove vx-spy-mark" data-vx-light="accent" aria-hidden="true"></span>
//           <a href="#install" aria-current="location">Install</a>
//           <a href="#use">Use</a>
//         </nav>
//         The links may stand in a list. In a column the groove stands at the start of the current
//         link; in a row (data-vx-way="across") it lies under it. data-vx-offset is how far below
//         the top of what scrolls a section's top may be and still count as reached (px, 64).
// It only watches: it marks the current link with aria-current and never scrolls anything. A
// link pressed is the browser's own jump. With no script the link marked in the markup shows.

import { listeners } from './util.js';

/** What scrolls a section: the nearest ancestor that scrolls up and down, or null for the page. */
function scrollerOf(node) {
  for (let p = node?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

function wire(el, on) {
  const mark = el.querySelector('.vx-spy-mark');
  const links = () => [...el.querySelectorAll('a[href*="#"]')].filter((a) => a.hash.length > 1 && a.pathname === location.pathname && a.host === location.host);
  const section = (a) => document.getElementById(decodeURIComponent(a.hash.slice(1)));
  // the word the markup uses for "current" ("location" for a place in a page), kept as written
  const word = links().map((a) => a.getAttribute('aria-current')).find((v) => v && v !== 'false') || 'location';
  let held = null;   // a link the person pressed: it stays current until they scroll by themselves
  let asked = 0;     // a frame is asked for

  /** The link of the section being read: the last one whose top has reached the line. Null if none is in sight yet. */
  const reading = () => {
    const all = links();
    if (held && all.includes(held)) return held;
    const first = all.map(section).find(Boolean);
    if (!first) return null;
    const box = scrollerOf(first), page = document.scrollingElement ?? document.documentElement;
    const top = box ? box.getBoundingClientRect().top + box.clientTop : 0;
    const pad = parseFloat(getComputedStyle(box ?? page).scrollPaddingTop) || 0;
    const line = top + pad + (Number(el.dataset.vxOffset) || 64);
    let best = null, bestTop = -Infinity, last = null, lastTop = -Infinity, head = null, headTop = Infinity;
    for (const a of all) {
      const s = section(a);
      if (!s) continue;
      const y = s.getBoundingClientRect().top - (parseFloat(getComputedStyle(s).scrollMarginTop) || 0);
      if (y <= line && y > bestTop) { best = a; bestTop = y; }
      if (y > lastTop) { last = a; lastTop = y; }
      if (y < headTop) { head = a; headTop = y; }
    }
    // none has reached the line yet: the first one is being read as soon as it can be seen
    if (!best && headTop < top + (box ? box.clientHeight : page.clientHeight)) best = head;
    // at the very end the last section may never reach the line: it is the one being read
    const sc = box ?? page;
    if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) best = last;
    return best;
  };

  /** Put the groove at a link: beside it in a column, under it in a row. Whole voxels. */
  const place = (a, jump) => {
    if (!mark) return;
    el.toggleAttribute('data-vx-none', !a);
    if (!a) return;
    const all = links();
    const k = parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4, snap = (v) => Math.round(v / k) * k;
    const n = el.getBoundingClientRect(), r = a.getBoundingClientRect();
    const across = all.length > 1 && Math.abs(all[0].getBoundingClientRect().top - all[1].getBoundingClientRect().top) < 2;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const [x, y, w, h] = across
      ? [snap(r.left - n.left), snap(r.bottom - n.top) - k, snap(r.width), k]
      : [rtl ? n.width - k : 0, snap(r.top - n.top) + k * 2, k, Math.max(k, snap(r.height) - k * 4)];
    if (jump) mark.style.transition = 'none'; // the first time, and when the layout changed: it is there, it does not travel
    mark.style.setProperty('--_x', x + 'px'); mark.style.setProperty('--_y', y + 'px');
    mark.style.setProperty('--_w', w + 'px'); mark.style.setProperty('--_h', h + 'px');
    if (jump) { void mark.offsetWidth; mark.style.transition = ''; }
  };

  let current;
  const update = (jump = false) => {
    asked = 0;
    const a = reading();
    if (a !== current) {
      for (const l of links()) if (l === a) l.setAttribute('aria-current', word); else l.removeAttribute('aria-current');
      el.dispatchEvent(new CustomEvent('vx-change', { bubbles: true, detail: { link: a, section: a ? section(a) : null } }));
    }
    place(a, jump || current === undefined);
    current = a;
  };
  // while a pressed link is held nothing is read from the scroll: its own jump is on its way
  const soon = () => { if (!held) asked ||= requestAnimationFrame(() => update()); };

  // scroll events do not bubble, but they can be caught on their way down: one listener hears
  // the page and any box inside it
  on(document, 'scroll', soon, { capture: true, passive: true });
  on(window, 'resize', () => update(true));
  // a link pressed is the person's choice: it is current at once, and stays so until they scroll
  // by themselves (a short last section may never reach the line). It is let go when its jump
  // has ended, and by anything the person does next, wherever the pointer is: a press comes
  // before its click, so pressing another link lets go of this one and then holds that one.
  on(el, 'click', (e) => { const a = e.target.closest?.('a'); if (a && links().includes(a) && section(a)) { held = a; update(); } });
  const free = () => { held = null; };
  for (const type of ['scrollend', 'wheel', 'touchstart', 'keydown', 'pointerdown']) on(document, type, free, { capture: true, passive: true });
  const sizes = new ResizeObserver(() => update(true));
  sizes.observe(el);
  on.watch(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] }, () => update(true));

  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { sizes.disconnect(); if (asked) cancelAnimationFrame(asked); el.removeAttribute('data-vx-on'); } }, 'end', update);
  update(true);
}

export const scrollSpy = {
  name: 'scroll-spy',
  selector: '.vx-spy',
  pad: 0,

  // no voxels of its own: the words are words, and the mark is a groove, which is a part already
  build() {},

  bind(live) {
    live.canvas.hidden = true; // nothing is drawn on it
    const on = listeners();
    wire(live.el, on);
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
