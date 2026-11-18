// Menu. A slab that is built out of its trigger's corner. The item under the pointer or the
// focus gets an enamel tile; the tile moves at once, because moving through a menu is frequent.
// Markup: <button class="vx-button" popovertarget="m">More</button>
//         <div class="vx-menu" id="m" popover role="menu"><button role="menuitem">…</button>…</div>

import { listeners, wrapLabel } from './util.js';
import { menuAnchor, menuEnabled, menuTarget, watchDirection } from '../plain.js';

export const menu = {
  name: 'menu',
  selector: '.vx-menu',
  pad: 9,

  build(live, m) {
    const { W, H, el, vx } = live;
    const d = live.look.float;
    m.part('panel').slab(0, 0, 0, W, H, d, 'chalk', live.look.round);
    const items = live.state.items = [...el.querySelectorAll('[role^="menuitem"]')];
    const first = items[0];
    const h = first ? Math.max(2, Math.round(first.offsetHeight / vx)) : 2;
    const pick = m.part('pick');
    pick.grounded = false;
    const inset = live.look.round;
    pick.slab(inset, 0, d, Math.max(1, W - inset * 2), h, 1, 'enamel', 1);
    live.state.ys = items.map((it) => Math.round(it.offsetTop / vx));
    live.faceZ = d;
    items.forEach((it, i) => live.label(wrapLabel(it), () => (live.state.active === i ? d + 1 : d)));
  },

  pose(live) {
    const pick = live.model.byName.pick, a = live.state.active;
    pick.hidden = !(a >= 0) || pick.fx != null && false;
    if (a >= 0) pick.ty = live.state.ys[a] ?? 0;
  },

  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    const el = live.el;
    live.state.active = -1;
    const setActive = (i) => {
      if (live.state.active === i) return;
      live.state.active = i;
      live.state.items?.forEach((it, j) => it.toggleAttribute('data-vx-active', j === i));
      live.invalidate();
    };
    const { invoker, put } = menuAnchor(el, on, () => live.vx * 3);
    on(el, 'toggle', (e) => {
      invoker()?.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open') { setActive(-1); return; }
      // opened at a point (a context menu sets data-vx-from, in voxels), or by its trigger
      const [x, y] = el.dataset.vxFrom && !invoker() ? el.dataset.vxFrom.split(' ').map((n) => Number(n) * live.vx) : put();
      live.rebuild();
      live.model.byName.pick.hidden = true;
      live.play('assemble', ['panel'], { from: [x / live.vx, y / live.vx], duration: 0.2, each: 0.14 });
      const viaKey = invoker()?.matches(':focus-visible');
      if (viaKey) live.state.items.find(menuEnabled)?.focus();
    });
    on(el, 'pointermove', (e) => { const it = e.target.closest('[role^="menuitem"]'); setActive(menuEnabled(it) ? live.state.items.indexOf(it) : -1); });
    on(el, 'pointerleave', () => setActive(-1));
    on(el, 'focusin', (e) => { const i = live.state.items.indexOf(e.target); if (i >= 0) setActive(i); });
    on(el, 'keydown', (e) => {
      const items = live.state.items;
      // from the item that has focus; the pointer may be resting somewhere else
      const from = items.includes(document.activeElement) ? document.activeElement : items[live.state.active];
      const to = menuTarget(e.key, items, from);
      if (!to) return;
      e.preventDefault();
      to.focus();
    });
    on(el, 'click', (e) => {
      if (!menuEnabled(e.target.closest('[role^="menuitem"]'))) return;
      const t = invoker();
      el.hidePopover();
      t?.focus();
    });
    return on.done;
  },
};
