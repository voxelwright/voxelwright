// A four-key command pad for the first log. The popover and its menu navigation
// stay native to the kit; the other invocations borrow the ordinary menu plate.
import { parts } from '../../src/looks/lit-existing.js';
import { live as liveOf, halo, cue, wrapLabel, PRESS, RELEASE } from '../../src/index.js';

export const logMenu = {
  ...parts.menu,
  build(live, model) {
    const { el, vx, W, H } = live;
    // In a scrolling menu the rows move over a fixed plate.
    const rows = el.querySelector('.vx-menu-rows');
    const useKeys = el.hasAttribute('data-log-actions') && W >= 12 && !(rows && rows.scrollHeight > rows.clientHeight);
    el.toggleAttribute('data-log-keys', useKeys);
    if (!useKeys) {
      parts.menu.build(live, model);
      return;
    }
    const origin = (el.dataset.vxFrom ?? '0 0').split(' ').map(Number);
    model.menuMotion = { parts: null, surface: 'courses', openDuration: .26, closeDuration: .20, from: origin };
    const base = model.part('panel');
    base.slab(0, 0, 0, W, H, 2, 'gasket', 2);
    base.slab(0, 0, 2, W, H, 2, 'chalk', 2);
    // The switch carrier backs a translucent enclosure. Transmission is visible
    // at its outer lip, while the text underneath cannot shine through a seat.
    if (live.look.materials.chalk?.transmission) {
      base.slab(1, 1, 3, W - 2, H - 2, 1, 'panel', 1);
    }
    // A brass corner cleat marks the point from which the tray was built.
    const right = origin[0] > W / 2, bottom = origin[1] > H / 2;
    const x = right ? W - 7 : 1, y = bottom ? H - 2 : 1;
    base.box(x, y, 3, 6, 1, 2, 'spun-brass');
    base.box(right ? x + 5 : x, bottom ? y - 2 : y, 3, 1, 3, 2, 'spun-brass');

    const items = live.state.items = [...el.querySelectorAll('[role="menuitem"]')];
    live.faceZ = 6;
    items.forEach((item, i) => {
      const top = Math.round(item.offsetTop / vx);
      const height = Math.round(item.offsetHeight / vx);
      const center = top + Math.floor(height / 2);
      // A fixed smoked window sits beside each switch, in a metal ferrule.
      base.box(2, center - 1, 3, 4, 2, 1, 'steel');
      base.box(3, center - 1, 3, 2, 2, 1, 'lens');
      const lamp = model.part('lamp' + i);
      lamp.box(3, center - 1, 3, 2, 2, 1, item.dataset.vxKind === 'danger' ? 'light-stop' : 'light');
      lamp.tz = .03;
      base.slab(7, top + 1, 3, W - 9, height - 1, 1, 'slate', 1);
      const key = model.part('key' + i);
      key.grounded = false;
      key.slab(8, top + 1, 4, W - 11, height - 2, 2, 'key', 1);
      live.label(wrapLabel(item), () => live.faceZ + key.tz);
    });
  },
  pose(live) {
    const { model, state } = live;
    if (!model.menuMotion) return parts.menu.pose(live);
    state.items.forEach((_, i) => {
      model.byName['lamp' + i].hidden = state.active !== i;
      model.byName['key' + i].tz = live.spring('stroke' + i).x;
    });
    live.glowStrength = halo(.045);
  },
};

export function connectLogActions(menu, row) {
  const owned = () => menu.hasAttribute('data-log-actions');
  let held;
  function move(index, pressed) {
    const live = liveOf(menu);
    if (!live?.model.menuMotion) return;
    const spring = live.spring('stroke' + index);
    const { k, c } = pressed ? PRESS : RELEASE;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) spring.snap(pressed ? -1 : 0);
    else spring.to(pressed ? -1 : 0, k, c);
    live.invalidate();
  }
  function press(event, source) {
    const item = event.target.closest('[role="menuitem"]');
    if (held || !owned() || !item || item.disabled) return;
    const index = [...menu.querySelectorAll('[role="menuitem"]')].indexOf(item);
    held = { source, index };
    move(index, true);
    cue('press');
  }
  function release(source, audible) {
    if (!held || held.source !== source) return;
    move(held.index, false);
    held = null;
    if (audible) cue('release');
  }
  menu.addEventListener('pointerdown', e => { if (e.button === 0) press(e, e.pointerId); });
  window.addEventListener('pointerup', e => release(e.pointerId, true));
  window.addEventListener('pointercancel', e => release(e.pointerId, false));
  menu.addEventListener('keydown', e => {
    if (owned() && e.key === 'Tab') {
      // Continue the document's tab sequence from the log that owns the menu.
      menu.hidePopover();
      row.focus({ preventScroll: true });
    }
    if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) press(e, e.key);
  });
  window.addEventListener('keyup', e => release(e.key, true));
  window.addEventListener('blur', () => release(held?.source, false));
  // Releasing a long hold is never a second activation, even when the
  // finger rests on the link longer than the browser's synthetic click delay.
  row.addEventListener('touchend', e => {
    if (owned() && menu.matches(':popover-open')) e.preventDefault();
  }, { passive: false });
}
