// Select, the native one. A key with a chevron: a cap standing on a ring of light, which goes down
// when it is pressed and opens the browser's own picker. The words on it are the select's own.
// Tool: key.
// Markup: <span class="vx-select"><select id="region">…</select></span>
//         with a real <label for="region"> beside or above it.
// The <select> is the control and stays one: it lies over the whole key, so every press, key and
// touch goes to the browser, and the picker that opens is the browser's, on a phone as on a desk.

import { ring, halo, byTheme, lightName } from '../core/light.js';
import { PRESS, RELEASE, CALM, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { ICONS } from '../core/icons.js';
import { listeners, wrapLabel } from './util.js';

const GLOW = 0.075, REACH = 4.2; // a key's light, as the look's other keys have it
const EDGE = 4;                  // voxels from the chevron to the end of the cap
const OPENS = [' ', 'Enter', 'ArrowDown', 'ArrowUp']; // the keys that open a picker, on one system or another
const SHOWN = 0.14;              // seconds a press is shown for, however soon it is let go
/** Is the select's picker open? null where the browser has no way to say (no select:open). */
function isOpen(control) {
  try { return control.matches(':open'); } catch { return null; }
}

export const select = {
  name: 'select',
  selector: '.vx-select',
  pad: 9,
  glowRadius: REACH,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { W, H, el } = live, look = live.look;
    const control = el.querySelector('select');
    const off = !control || control.matches(':disabled');
    const depth = off ? 1 : look.rise;
    const cap = m.part('cap');
    if (off) cap.slab(0, 0, 0, W, H, 1, 'steel', 1);
    else {
      // the light is a ring one voxel high under the cap's edge: a lit line at the foot of the
      // key, and its halo on the surface round it
      ring(m.part('light'), 0, 0, 0, W, H, lightName(el, 'light'), 1);
      cap.grounded = false;
      cap.slab(0, 0, 1, W, H, depth - 1, 'key', 1);
    }
    // the chevron is set into the face at its far end, level with it: the face stays plain
    const g = ICONS.chevron, rtl = getComputedStyle(el).direction === 'rtl';
    const gx = rtl ? EDGE : W - g[0].length - EDGE, gy = Math.round((H - g.length) / 2);
    if (W >= g[0].length + EDGE * 2) for (let j = 0; j < g.length; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '#') cap.plot(gx + i, gy + j, depth - 1, off ? 'slate' : 'ink');
    if (off) { live.state.held = false; live.spring('press').snap(0); } // switched off while down: it is not left down
    live.state.off = off;
    live.state.top = depth;
    live.faceZ = depth;
    // the words go down with the cap
    live.label(el.querySelector(':scope > .vx-select-face'), () => live.state.top + cap.tz);
  },

  pose(live) {
    const cap = live.model.byName.cap;
    const press = live.spring('press').x, hover = live.spring('hover').x;
    cap.tz = live.state.off ? 0 : press + hover;
    // the light answers: brighter while aimed at, a flare as the key goes down, a slow fall after
    const f = live.state.flare ?? 0;
    live.glowStrength = halo(GLOW) * byTheme(live) * (1 + hover * 1.2 + f * 2.6);
    live.glowRadius = REACH + f * 2.2;
    live.el.style.setProperty('--lit', f.toFixed(3));
  },

  step(live, dt) {
    const s = live.state;
    if (s.off) return false;
    // The key stays down for as long as the picker is open, and at least long enough to be seen.
    // Where the browser can say whether the picker is open (select:open), that is asked each
    // frame while the key is down. Where it cannot, the key comes up when a release is heard.
    let waiting = false;
    if (s.held) {
      s.t += dt;
      const open = isOpen(s.control);
      if (s.t >= SHOWN && (open === null ? s.heard : !open)) s.up();
      else waiting = true;
    }
    const down = live.spring('press').x < -0.4;
    const was = s.flare ?? 0;
    const f = down ? Math.min(1, was + dt / 0.06) : Math.max(0, was - dt / 0.55);
    s.flare = f;
    return waiting || (f > 0 && f !== was);
  },

  bind(live) {
    const on = listeners();
    const el = live.el, control = el.querySelector('select'), s = live.state;
    // the select is wrapped in a span the stage can move with the cap and keep on whole pixels
    wrapLabel(el, 'vx-select-face');
    if (!control) return on.done;
    s.control = control;
    const press = live.spring('press'), hover = live.spring('hover');
    // with less motion asked for the cap does not travel: it is down, or it is up
    const move = (to, { k, c }) => (reducedMotion() ? press.snap(to) : press.to(to, k, c));
    const down = () => { if (s.off || s.held) return; s.held = true; s.t = 0; s.heard = false; move(-live.look.travel, PRESS); cue('press'); live.invalidate(); };
    s.up = () => { if (!s.held) return; s.held = false; move(0, RELEASE); cue('release'); live.invalidate(); };
    const hear = () => { if (s.held) { s.heard = true; live.invalidate(); } };
    on(control, 'pointerdown', (e) => { if (e.button === 0) down(); });
    on(control, 'keydown', (e) => { if (OPENS.includes(e.key) && !e.repeat) down(); });
    // The picker is the browser's, and while it is open the page may hear nothing: the pointer's
    // release and the key's may never come, or come at once. What counts as a release, for a
    // browser that cannot say whether its picker is open: the release itself, a choice, the
    // focus going, or the pointer or a key seen again anywhere else on the page, which can only
    // be after the picker has closed.
    for (const type of ['pointerup', 'pointercancel', 'keyup', 'blur', 'change']) on(control, type, hear);
    for (const type of ['pointerup', 'pointermove', 'pointerdown', 'keydown', 'wheel']) on(window, type, (e) => { if (e.target !== control) hear(); }, { passive: true, capture: true });
    on(control, 'change', () => cue('tick'));
    on(el, 'pointerenter', (e) => { if (e.pointerType === 'mouse' && !s.off && !reducedMotion()) { hover.to(0.5, CALM.k * 2, CALM.c * 1.4); live.invalidate(); } });
    on(el, 'pointerleave', () => { hover.to(0, CALM.k * 2, CALM.c * 1.4); live.invalidate(); });
    // switched off or on, or its choices changed (the key is as wide as its longest one)
    on.watch(control, { attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true, characterData: true }, () => live.rebuild());
    const set = control.closest('fieldset');
    if (set) on.watch(set, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    return on.done;
  },
};
