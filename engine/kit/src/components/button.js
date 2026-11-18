// Button. A cap standing on the page. Height is the affordance: it stands proud because it can
// be pressed, and it goes down into the page when you press it. A disabled button sits low.

import { inlineX, watchDirection } from '../plain.js';
import { PRESS, RELEASE, CALM } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { ICONS } from '../core/icons.js';
import { listeners, wrapLabel } from './util.js';

/** Draw a key's glyph in the space reserved by padding-inline-end. */
export function capIcon(live, cap, z, mat) {
  const { W, H, el, look } = live;
  const glyph = (look.icons ?? ICONS)[el.dataset.vxIcon];
  if (!glyph) return;
  const x = inlineX(live);
  const gx = W - glyph[0].length - (look.icons ? 2 : 5), gy = Math.round((H - glyph.length) / 2);
  for (let j = 0; j < glyph.length; j++) for (let i = 0; i < glyph[j].length; i++) {
    if (glyph[j][i] === '#') cap.plot(x(gx + i), gy + j, z, mat);
  }
}

export const button = {
  name: 'button',
  selector: '.vx-button',
  pad: 7,

  build(live, m) {
    const { W, H, el } = live;
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const mat = off ? 'steel' : el.dataset.vxMaterial || 'enamel';
    const look = live.look, depth = off ? 1 : look.rise, step = Math.min(look.step, depth - 1);
    // A keycap: a body, and a top one voxel smaller all round. The step is what says "block".
    const cap = m.part('cap');
    if (off) cap.slab(0, 0, 0, W, H, 1, mat, 1);
    else if (!step) cap.slab(0, 0, 0, W, H, depth, mat, 1);
    else { cap.slab(0, 0, 0, W, H, depth - 1, mat, 1); cap.slab(step, step, depth - 1, W - step * 2, H - step * 2, 1, mat, 1); }
    const night = live.theme === 'night';
    const ink = mat === 'enamel' || mat === 'walnut' || (mat === 'brick' && !night) ? 'ivory' : mat === 'brick' ? 'slate' : 'ink';
    capIcon(live, cap, look.inlay ? depth - 1 : depth, off ? 'slate' : ink);
    live.state.off = off;
    live.state.top = depth;
    live.faceZ = depth;
    live.label(el.querySelector(':scope > .vx-label'), () => live.state.top + cap.tz);
  },

  pose(live) {
    const cap = live.model.byName.cap;
    cap.tz = live.state.off ? 0 : live.spring('press').x + live.spring('hover').x;
  },

  bind(live) {
    const el = live.el;
    const on = listeners();
    watchDirection(live, on);
    wrapLabel(el);
    const press = live.spring('press'), hover = live.spring('hover');
    let held = false;
    const travel = () => Math.min(live.look.travel, Math.max(0, (live.state.top ?? live.look.rise) - 1));
    const down = () => { if (live.state.off) return; held = true; press.to(-travel(), PRESS.k, PRESS.c); cue('press'); live.invalidate(); };
    const holds = () => el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true';
    const up = () => { if (!held) return; held = false; if (holds()) return; press.to(0, RELEASE.k, RELEASE.c); cue('release'); live.invalidate(); };
    const key = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(); };
    const enter = (e) => { if (e.pointerType === 'mouse' && !live.state.off) { hover.to(0.5, CALM.k * 2, CALM.c * 1.4); live.invalidate(); } };
    const leave = () => { hover.to(0, CALM.k * 2, CALM.c * 1.4); up(); live.invalidate(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('keydown', key);
    el.addEventListener('keyup', up);
    el.addEventListener('blur', up);
    on.watch(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-vx-material', 'data-vx-kind', 'data-vx-light', 'data-vx-icon', 'aria-expanded', 'aria-pressed'] }, (list) => {
      if (list.some((r) => r.attributeName !== 'aria-expanded' && r.attributeName !== 'aria-pressed')) return live.rebuild();
      // a trigger stays down while what it opened is open
      const open = holds();
      held = false;
      press.to(open ? -travel() : 0, open ? PRESS.k : RELEASE.k, open ? PRESS.c : RELEASE.c);
      live.invalidate();
    });
    return () => {
      on.done();
      for (const [t, f] of [['pointerdown', down], ['pointerup', up], ['pointercancel', up], ['pointerenter', enter], ['pointerleave', leave], ['keydown', key], ['keyup', up], ['blur', up]]) el.removeEventListener(t, f);
    };
  },
};
