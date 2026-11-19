// Menu. An engraved plate rises beside its trigger. The item under the pointer or the
// focus gets an enamel tile; the tile moves at once, because moving through a menu is frequent.
// Markup: <button class="vx-button" popovertarget="m">More</button>
//         <div class="vx-menu" id="m" popover role="menu"><button role="menuitem">…</button>…</div>

import { listeners, wrapLabel } from './util.js';
import { nativeRelease } from './popover.js';
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
    pick.hidden = !(a >= 0);
    if (a >= 0) pick.ty = (live.state.ys[a] ?? 0) - (live.state.scrollY ?? 0);
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
    const motion = () => live.model.menuMotion ?? { parts: ['panel'], surface: 'rim' };
    nativeRelease(live, on, motion);
    let initialFocus;
    on(el, 'beforetoggle', e => {
      initialFocus?.removeAttribute('autofocus');
      initialFocus = null;
      if (e.newState !== 'open') { setActive(-1); return; }
      el.setAttribute('data-vx-cover-legends', '');
      if (invoker()?.matches(':focus-visible') && !el.querySelector('[autofocus]')) {
        initialFocus = [...el.querySelectorAll('[role^="menuitem"]')].find(menuEnabled);
        initialFocus?.setAttribute('autofocus', '');
      }
    });
    on(el, 'toggle', e => {
      initialFocus?.removeAttribute('autofocus');
      initialFocus = null;
      invoker()?.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open') { el.removeAttribute('data-vx-cover-legends'); return; }
      const anchor = put();
      const origin = el.dataset.vxFrom && !invoker() ? el.dataset.vxFrom.trim().split(/\s+/).map(Number) : anchor.map(px => px / live.vx);
      live.visible = true;
      live.state.scrollY = (el.querySelector(':scope > .vx-menu-rows')?.scrollTop ?? 0) / live.vx;
      const resume = live.rebuild();
      const { parts, surface, openDuration = 0.17, from } = motion();
      // A fresh context point supplies its own origin even during a reversed exit.
      if (resume && from) resume.from = from;
      live.play('assemble', parts, { resume, duration: openDuration, surface, from: origin });
      if (invoker()?.matches(':focus-visible')) live.state.items.find(menuEnabled)?.focus();
      live.draw();
      el.removeAttribute('data-vx-cover-legends');
    });
    on(el, 'scroll', e => {
      if (!e.target.classList?.contains('vx-menu-rows')) return;
      live.state.scrollY = e.target.scrollTop / live.vx;
      live.invalidate();
    }, true);
    on(el, 'pointermove', (e) => { const it = e.target.closest('[role^="menuitem"]'); setActive(menuEnabled(it) ? live.state.items.indexOf(it) : -1); });
    on(el, 'pointerleave', () => setActive(-1));
    on(el, 'focusin', (e) => { const i = live.state.items.indexOf(e.target); if (i >= 0) setActive(i); });
    on(el, 'keydown', (e) => {
      const items = [...el.querySelectorAll('[role^="menuitem"]')];
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
