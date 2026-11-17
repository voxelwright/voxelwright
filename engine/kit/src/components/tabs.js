// Tabs. A slate tray with equal seats; a signal block sits under the chosen one and slides to
// the next when you pick with a pointer. Arrow keys move it at once.
// Markup: <div class="vx-tabs" role="tablist"><button role="tab" aria-selected="true" aria-controls="p1">…</button>…</div>

import { SLIDE } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners, wrapLabel } from './util.js';
import { chooseTab, keyTarget } from '../plain.js';

export const tabs = {
  name: 'tabs',
  selector: '.vx-tabs',
  pad: 6,

  build(live, m) {
    const { W, H, el, vx } = live;
    const tabsEl = live.state.tabs = [...el.querySelectorAll(':scope > [role="tab"]')];
    m.part('tray').slab(0, 0, 0, W, H, 1, 'slate', 2);
    const seat = live.state.seat = tabsEl.length ? Math.round(tabsEl[0].offsetWidth / vx) : W;
    const block = m.part('block');
    block.grounded = false;
    block.slab(0, 1, 1, seat - 2, H - 2, 2, 'chalk', 1);
    block.box(1, 1, 3, seat - 4, 2, 1, 'signal');
    live.faceZ = 1;
    const index = Math.max(0, tabsEl.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
    live.state.index = index;
    const xs = live.state.xs = tabsEl.map((t) => Math.round(t.offsetLeft / vx) + 1);
    // a little stiffer than a switch: a seat is wider than a knob's travel, and the block must
    // still land inside 420 ms
    const s = live.spring('x', xs[index] ?? 1, SLIDE.k * 1.25, SLIDE.c * 1.12);
    s.snap(xs[index] ?? 1);
    // Labels keep one baseline. The block is set back by its own height, so its face lands
    // exactly on the seat it marks.
    tabsEl.forEach((t) => wrapLabel(t));
    block.ty = -1;
  },

  pose(live) {
    live.model.byName.block.tx = live.spring('x').x - 1;
  },

  bind(live) {
    const on = listeners();
    const el = live.el;
    // tell: false when nobody chose anything (the first pose, or the same tab again)
    const select = (i, glide, tell = true) => {
      const all = live.state.tabs;
      if (!all[i]) return;
      if (tell && i === live.state.index) tell = false;
      chooseTab(all, i);
      live.state.index = i;
      const s = live.spring('x');
      if (glide) { s.to(live.state.xs[i]); cue('slide'); } else s.snap(live.state.xs[i]);
      live.invalidate();
      if (tell) el.dispatchEvent(new CustomEvent('vx-change', { bubbles: true, detail: { index: i } }));
    };
    on(el, 'click', (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) select(live.state.tabs.indexOf(t), true);
    });
    on(el, 'keydown', (e) => {
      const to = keyTarget(e.key, live.state.index, live.state.tabs.length, ['ArrowRight', 'ArrowLeft']);
      if (to < 0) return;
      e.preventDefault();
      select(to, false);
      live.state.tabs[to].focus();
    });
    queueMicrotask(() => select(live.state.index, false, false));
    return on.done;
  },
};
