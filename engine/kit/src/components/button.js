// Button. A cap standing on the page. Height is the affordance: it stands proud because it can
// be pressed, and it goes down into the page when you press it. A disabled button sits low.

import { PRESS, RELEASE, CALM } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { wrapLabel } from './util.js';

const CAP = 3;       // voxels the cap stands above its socket
const TRAVEL = 2;    // how far a press pushes it down

export const button = {
  name: 'button',
  selector: '.vx-button',
  pad: 7,

  build(live, m) {
    const { W, H, el } = live;
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const mat = off ? 'steel' : el.dataset.vxMaterial || 'enamel';
    const depth = off ? 1 : CAP;
    const cap = m.part('cap');
    cap.slab(0, 0, 0, W, H, depth, mat, 1);
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
    wrapLabel(el);
    const press = live.spring('press'), hover = live.spring('hover');
    let held = false;
    const down = () => { if (live.state.off) return; held = true; press.to(-TRAVEL, PRESS.k, PRESS.c); cue('press'); live.invalidate(); };
    const up = () => { if (!held) return; held = false; press.to(0, RELEASE.k, RELEASE.c); cue('release'); live.invalidate(); };
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
    const watch = new MutationObserver(() => live.rebuild());
    watch.observe(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-vx-material'] });
    return () => {
      watch.disconnect();
      for (const [t, f] of [['pointerdown', down], ['pointerup', up], ['pointercancel', up], ['pointerenter', enter], ['pointerleave', leave], ['keydown', key], ['keyup', up], ['blur', up]]) el.removeEventListener(t, f);
    };
  },
};
