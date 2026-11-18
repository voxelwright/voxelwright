// Button. A cap standing on the page. Height is the affordance: it stands proud because it can
// be pressed, and it goes down into the page when you press it. A disabled button sits low.

import { inlineX, watchDirection } from '../plain.js';
import { PRESS, RELEASE, CALM, reducedMotion } from '../core/motion.js';
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
    let held = null;
    const travel = () => live.model.keyTravel ?? Math.min(live.look.travel, Math.max(0, (live.state.top ?? live.look.rise) - 1));
    const holds = () => el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-pressed') === 'true';
    const move = (target, spring) => {
      if (reducedMotion()) press.snap(target);
      else press.to(target, spring.k, spring.c);
      live.invalidate();
    };
    const down = source => {
      if (held !== null || el.matches(':disabled, [aria-disabled="true"]')) return;
      held = source;
      const stop = -travel();
      // Take up the first part of the stroke at contact. A tap that fits between
      // two paint frames still releases from a displaced cap.
      press.x = Math.min(press.x, stop * 0.36);
      move(stop, PRESS);
      cue('press');
    };
    const up = (source, returned) => {
      if (held === null || held !== source) return;
      held = null;
      if (holds()) return;
      move(0, RELEASE);
      if (returned) cue('release');
    };
    on(el, 'pointerdown', e => { if (e.button === 0) down(e.pointerId); });
    on(el, 'pointerup', e => { if (e.button === 0) up(e.pointerId, true); });
    on(el, 'pointercancel', e => up(e.pointerId, false));
    on(el, 'pointerenter', e => {
      if (e.pointerType === 'mouse' && !live.state.off && !reducedMotion()) {
        hover.to(0.5, CALM.k * 2, CALM.c * 1.4);
        live.invalidate();
      }
    });
    on(el, 'pointerleave', e => {
      hover.to(0, CALM.k * 2, CALM.c * 1.4);
      up(e.pointerId, false);
      live.invalidate();
    });
    on(el, 'keydown', e => { if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) down(e.key); });
    on(el, 'keyup', e => up(e.key, true));
    on(el, 'blur', () => up(held, false));
    on.watch(el, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'data-vx-material', 'data-vx-kind', 'data-vx-light', 'data-vx-icon', 'aria-expanded', 'aria-pressed'] }, (list) => {
      if (list.some((r) => r.attributeName !== 'aria-expanded' && r.attributeName !== 'aria-pressed')) {
        if (el.matches(':disabled, [aria-disabled="true"]')) {
          held = null;
          press.snap(0);
          hover.snap(0);
        }
        return live.rebuild();
      }
      // a trigger stays down while what it opened is open
      const open = holds();
      held = null;
      move(open ? -travel() : 0, open ? PRESS : RELEASE);
    });
    return on.done;
  },
};
