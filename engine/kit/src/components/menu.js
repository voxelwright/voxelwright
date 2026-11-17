// Menu. A slab that is built out of its trigger's corner. The item under the pointer or the
// focus gets an enamel tile; the tile moves at once, because moving through a menu is frequent.
// Markup: <button class="vx-button" popovertarget="m">More</button>
//         <div class="vx-menu" id="m" popover role="menu"><button role="menuitem">…</button>…</div>

import { listeners, wrapLabel } from './util.js';

export const menu = {
  name: 'menu',
  selector: '.vx-menu',
  pad: 9,

  build(live, m) {
    const { W, H, el, vx } = live;
    m.part('panel').slab(0, 0, 0, W, H, 3, 'chalk', 2);
    const items = live.state.items = [...el.querySelectorAll('[role^="menuitem"]')];
    const first = items[0];
    const h = first ? Math.max(2, Math.round(first.offsetHeight / vx)) : 2;
    const pick = m.part('pick');
    pick.grounded = false;
    pick.slab(2, 0, 3, Math.max(1, W - 4), h, 1, 'enamel', 1);
    live.state.ys = items.map((it) => Math.round(it.offsetTop / vx));
    live.faceZ = 3;
    items.forEach((it, i) => live.label(wrapLabel(it), () => (live.state.active === i ? 4 : 3)));
  },

  pose(live) {
    const pick = live.model.byName.pick, a = live.state.active;
    pick.hidden = !(a >= 0) || pick.fx != null && false;
    if (a >= 0) pick.ty = live.state.ys[a] ?? 0;
  },

  bind(live) {
    const on = listeners();
    const el = live.el;
    live.state.active = -1;
    const setActive = (i) => {
      if (live.state.active === i) return;
      live.state.active = i;
      live.state.items?.forEach((it, j) => it.toggleAttribute('data-vx-active', j === i));
      live.invalidate();
    };
    const invoker = () => document.querySelector(`[popovertarget="${el.id}"]`);
    const place = () => {
      const t = invoker();
      if (!t) return [0, 0];
      const r = t.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = live.vx * 3;
      let left = r.left, top = r.bottom + gap, fromX = 0, fromY = 0;
      if (left + w > innerWidth - 12) { left = Math.max(12, r.right - w); fromX = w; }
      if (top + h > innerHeight - 12 && r.top - gap - h > 12) { top = r.top - gap - h; fromY = h; }
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
      return [fromX / live.vx, fromY / live.vx];
    };
    on(el, 'toggle', (e) => {
      if (e.newState !== 'open') { setActive(-1); return; }
      const from = place();
      live.rebuild();
      live.model.byName.pick.hidden = true;
      live.play('assemble', ['panel'], { from, duration: 0.2, each: 0.14 });
      const viaKey = invoker()?.matches(':focus-visible');
      if (viaKey) { live.state.items[0]?.focus(); setActive(0); }
    });
    on(el, 'pointermove', (e) => { const it = e.target.closest('[role^="menuitem"]'); setActive(it ? live.state.items.indexOf(it) : -1); });
    on(el, 'pointerleave', () => setActive(-1));
    on(el, 'focusin', (e) => { const i = live.state.items.indexOf(e.target); if (i >= 0) setActive(i); });
    on(el, 'keydown', (e) => {
      const items = live.state.items, n = items.length;
      if (!n) return;
      const i = live.state.active;
      const to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      items[to].focus();
    });
    on(el, 'click', (e) => {
      if (!e.target.closest('[role^="menuitem"]')) return;
      const t = invoker();
      el.hidePopover();
      t?.focus();
    });
    return on.done;
  },
};
