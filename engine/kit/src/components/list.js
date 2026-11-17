// List. Tiles in a slate tray, one per row, with a voxel of gap between them. The current row
// stands a voxel higher and carries a signal marker. Rows that hold a link or a button press down.
// Markup: <ul class="vx-list"><li aria-current="true"><a href>…</a></li><li>…</li></ul>

import { PRESS, RELEASE } from '../core/motion.js';
import { listeners, wrapLabel } from './util.js';

export const list = {
  name: 'list',
  selector: '.vx-list',
  pad: 6,

  build(live, m) {
    const { W, H, el, vx } = live;
    m.part('tray').slab(0, 0, 0, W, H, 1, 'slate', 1);
    const rows = live.state.rows = [];
    const items = [...el.children].filter((n) => n.tagName === 'LI');
    items.forEach((li, i) => {
      const top = Math.round(li.offsetTop / vx), h = Math.max(2, Math.round(li.offsetHeight / vx));
      const current = li.getAttribute('aria-current') === 'true' || li.getAttribute('aria-selected') === 'true';
      const part = m.part('row' + i);
      part.grounded = false;
      // a tile stands on the tray; the current one stands a voxel higher and carries the marker
      const d = Math.max(1, live.look.slab - 1), mw = live.look.round;
      part.box(1, top, 1, W - 2, h, d, 'chalk');
      if (current) { part.box(1, top, 1 + d, W - 2, h, 1, 'chalk'); part.box(1, top, 1 + d, mw, h, 2, 'signal'); }
      const row = { li, part, current, press: live.spring('row' + i) };
      rows.push(row);
      live.label(wrapLabel(li, 'vx-row'), () => (current ? 2 + d : 1 + d) + part.tz);
    });
    live.faceZ = 1 + Math.max(1, live.look.slab - 1);
  },

  pose(live) {
    for (const r of live.state.rows) r.part.tz = r.press.x;
  },

  bind(live) {
    const on = listeners();
    const rowOf = (e) => live.state.rows.find((r) => r.li.contains(e.target) && r.li.querySelector('a, button'));
    let held = null;
    on(live.el, 'pointerdown', (e) => { held = rowOf(e); if (held) { held.press.to(-0.75, PRESS.k, PRESS.c); live.invalidate(); } });
    on(window, 'pointerup', () => { if (held) { held.press.to(0, RELEASE.k, RELEASE.c); held = null; live.invalidate(); } });
    on.watch(live.el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected'] }, () => {
      if (live.building) return;
      live.building = true;
      queueMicrotask(() => { live.rebuild(); live.building = false; });
    });
    return on.done;
  },
};
