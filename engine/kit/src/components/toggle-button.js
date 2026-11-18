// Toggle button. A key that stays down while it is on, with its light held bright.
// The cap shares the ordinary key’s socket and travel. When latched, it uncovers a fixed light.
// Markup: <button class="vx-toggle-button" type="button" aria-pressed="false">Mute</button>
//         A press flips aria-pressed and sends vx-change ({ pressed }) from the button. Setting
//         aria-pressed from code moves the key too. Off and on: a steel dent, a voxel deep.

import { PRESS, RELEASE, CALM, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { hole, lightName, seatIndicator, seatedKey, keyLight } from '../core/light.js';
import { watchFieldsets, listeners, wrapLabel } from './util.js';

const isOff = (el) => el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
const isOn = (el) => el.getAttribute('aria-pressed') === 'true';

// What a toggle button does with or without voxels: a press flips it and tells the page.
function wire(el, on) {
  if (!el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
  on(el, 'click', () => {
    if (isOff(el)) return;
    const pressed = !isOn(el);
    el.setAttribute('aria-pressed', String(pressed));
    el.dispatchEvent(new CustomEvent('vx-change', { bubbles: true, detail: { pressed } }));
  });
}

export const toggleButton = {
  name: 'toggle-button',
  selector: '.vx-toggle-button',
  pad: 9,
  soft: 0.65,

  build(live, m) {
    const { W, H, el } = live, look = live.look;
    const off = isOff(el), on = isOn(el);
    const label = wrapLabel(el);
    const s = live.state;
    s.off = off;
    // a key that is off sits low: one voxel, the height of the ring of light it no longer has
    // (as key in looks/lit.js; the look has no number for it). Every other depth is the look's.
    const LOW = 1;
    if (off && on) {
      // switched off while on: it is still down, with no light. The low cap has gone down by
      // the key's travel, and what is seen is the dent it left.
      const dent = Math.max(1, look.travel - LOW);
      hole(live, m, { depth: dent, wall: 'slate', floor: 'steel' });
      s.top = -dent;
      live.label(label, () => -dent);
    } else {
      const cap = seatedKey(live, m, off, 'key', lightName(el));
      const depth = s.top;
      if (!off) {
        cap.carve(0, H - 3, 1, W, 3, depth);
        m.byName.light.carve(0, H - 3, 0, W, 3, 1);
        s.indicator = seatIndicator(live, '', 0, 0, W, H, lightName(el), 0);
      }
      live.label(label, () => s.top + cap.tz);
    }
    // where it rests: down while on. The first drawing is as it is, with nothing moving.
    const rest = on && !off ? -live.model.keyTravel : 0, press = live.spring('press');
    if (!s.built || reducedMotion()) { press.snap(rest); s.flare = 0; s.lit = rest ? 1 : 0; }
    else if (!s.held) press.to(rest, rest ? PRESS.k : RELEASE.k, rest ? PRESS.c : RELEASE.c);
    s.built = true;
  },

  pose(live) {
    const cap = live.model.byName.cap;
    if (live.state.off || !cap) {
      if (cap) cap.tz = 0;
      live.el.style.setProperty('--lit', '0');
      return;
    }
    const press = live.spring('press').x, hover = live.spring('hover').x;
    cap.tz = press + hover;
    live.state.indicator(-press / Math.max(1, live.model.keyTravel));
    // the light answers as the key's does: brighter while aimed at, a flare as it goes down and
    // a slow fall after. On, it does not fall back to where it was: it is held bright.
    const f = live.state.flare ?? 0, lit = live.state.lit ?? 0;
    keyLight(live, hover, f, lit);
    live.el.style.setProperty('--lit', Math.max(f, lit * 0.5).toFixed(3));
  },

  step(live, dt) {
    const s = live.state;
    if (s.off) return false;
    const still = reducedMotion();
    // the flare: up while a hand holds the key down, and a slow fall after, as the key's
    const down = s.held && live.spring('press').x < -0.4;
    const was = s.flare ?? 0;
    const f = still ? 0 : down ? Math.min(1, was + dt / 0.06) : Math.max(0, was - dt / 0.55);
    s.flare = f;
    // the held light: on with the key, off with it
    const want = isOn(live.el) ? 1 : 0, had = s.lit ?? 0;
    const lit = still ? want : had < want ? Math.min(want, had + dt / 0.12) : Math.max(want, had - dt / 0.3);
    s.lit = lit;
    return f !== was || lit !== had;
  },

  bind(live) {
    const el = live.el, on = listeners(), s = live.state;
    wire(el, on);
    const press = live.spring('press'), hover = live.spring('hover');
    const go = (spring, x, k, c) => { if (reducedMotion()) spring.snap(x); else spring.to(x, k, c); live.invalidate(); };
    const rest = () => (isOn(el) && !s.off ? -live.model.keyTravel : 0);
    // back to where it rests: up if it is off, down if it is on
    const settle = () => { s.held = false; const r = rest(); go(press, r, r ? PRESS.k : RELEASE.k, r ? PRESS.c : RELEASE.c); };
    // it went on with no hand on it long enough to be seen (the Enter key, or code): the light
    // still says so, with the flare of a press
    const flash = () => { if (isOn(el) && !s.off && !reducedMotion()) s.flare = Math.max(s.flare ?? 0, 1); };
    const down = () => { if (s.off) return; s.held = true; go(press, -live.model.keyTravel - (isOn(el) ? live.look.step : 0), PRESS.k, PRESS.c); cue('press'); };
    const drop = () => { if (s.held) settle(); };
    on(el, 'pointerdown', (e) => { if (e.button === 0) down(); });
    on(el, 'pointerup', drop);
    on(el, 'pointercancel', drop);
    on(el, 'pointerenter', (e) => { if (e.pointerType === 'mouse' && !s.off && !reducedMotion()) go(hover, 0.5, CALM.k * 2, CALM.c * 1.4); });
    on(el, 'pointerleave', () => { go(hover, 0, CALM.k * 2, CALM.c * 1.4); drop(); });
    on(el, 'keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(); });
    on(el, 'blur', drop);
    // the press that flips it is the click (wire, above, has already flipped it): the key then
    // goes where its new state rests
    on(el, 'click', () => { if (s.off) return; if (!isOn(el)) cue('release'); flash(); settle(); });
    watchFieldsets(el, on, () => {
      if (isOff(el)) { s.held = false; hover.snap(0); press.snap(0); }
      live.rebuild();
    });
    on.watch(el, { attributes: true, attributeFilter: ['aria-pressed', 'disabled', 'aria-disabled', 'data-vx-light'] }, (list) => {
      // set from code: it follows. Anything but aria-pressed, or a key that is off, is another shape.
      if (isOff(el)) {
        s.held = false;
        press.snap(0);
        hover.snap(0);
      }
      if (s.off || isOff(el) || list.some((r) => r.attributeName !== 'aria-pressed')) return live.rebuild();
      if (!s.held) { flash(); settle(); }
    });
    return on.done;
  },

  plain: wire,
};
