// Checkbox. A latching push-button with its lamp in its cap, standing in a steel collar: the
// square lit button of a console. Not ticked, the cap stands up and is dark. Ticked, it is
// latched down, level with its collar, and its lamp is on. Its light is what says "on".
// Tool: key (a cap, drawn by cap()) and lamp (a light in a collar). The radio is the same object
// with its corners stepped (radio.js draws it with `latch` and `latchPose` from here).
// Markup: <label class="vx-check"><input type="checkbox"><span class="vx-box"></span>Label</label>
//         An indeterminate one (input.indeterminate = true) is half way down, with a bar of light.

import { halo, byTheme, cap as capOf } from '../core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const GLOW = 0.06, REACH = 3;

const level = (input) => (input?.indeterminate ? 0.5 : input?.checked ? 1 : 0);

/**
 * The button and its collar. `r` is the corner step of the cap: 0 for a square one (a checkbox),
 * 1 for a stepped one (a radio). `off`: it cannot be changed, so it is steel and has no light.
 * Three parts hold the same cap in its three states (`cap` dark, `lit` with its lamp on, `some`
 * with a bar of light); latchPose shows one of them and sets how far down it is.
 */
export function latch(live, m, { r = 0, off = false } = {}) {
  const { W, H } = live, look = live.look;
  // the collar: a voxel wide, a voxel high, round the element's box (it reaches into the pad).
  // Round a stepped cap it is stepped too, and keeps the corners the cap leaves.
  const collar = m.part('collar');
  collar.slab(-1, -1, 0, W + 2, H + 2, 1, 'steel', r > 0 ? 2 : 1);
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    const corner = r > 0 && (i === 0 || i === W - 1) && (j === 0 || j === H - 1);
    if (!corner) collar.carve(i, j, 0, 1, 1, 1);
  }
  // the cap: up, its top stands the look's travel above the collar; latched, it is level with it
  const d = 1 + look.travel, body = off ? 'steel' : 'ivory';
  const lamp = (name, lens) => {
    const p = m.part(name);
    p.grounded = false;
    capOf(p, 0, 0, 0, W, H, d, body, r);
    // The lamp is the top of the cap, the part that is a voxel smaller all round. On a cap this
    // small a stepped top would be a plus sign, and read as one: its corners are put back.
    for (let i = 1; i < W - 1; i++) for (let j = 1; j < H - 1; j++) p.plot(i, j, d - 1, lens?.(i, j) ?? body);
    return p;
  };
  const mid = (H - 1) / 2;
  lamp('cap');
  lamp('lit', () => (off ? 'slate' : 'light'));                       // switched off while on: the lens shows, with no light in it
  lamp('some', (i, j) => (Math.abs(j - mid) < 1 ? (off ? 'slate' : 'light') : null)); // some of them: a bar of light across it
  live.state.off = off;
  live.faceZ = 1; // the collar's face, and the face of a cap that is latched, lie on the element's box
}

/** Put the cap where it is now: `on` is 0 (up), 0.5 (half way) or 1 (latched); `press` is how far a hand holds it under that. */
export function latchPose(live) {
  const { cap, lit, some } = live.model.byName, s = live.spring('on');
  const on = s.x, at = Math.max(0, Math.min(1, on));
  const z = -live.look.travel * on + live.spring('press').x;
  // which of the three it shows: the lamp comes on as the cap passes half way
  const half = s.target === 0.5 && Math.abs(at - 0.5) < 0.25;
  const show = half ? some : at > 0.5 ? lit : cap;
  for (const p of [cap, lit, some]) { p.hidden = p !== show; p.tz = z; }
  live.glowStrength = live.state.off ? 0 : halo(GLOW) * byTheme(live) * (show === lit ? 1 : show === some ? 0.6 : 0);
}

/** Send the cap to where its input says it is. Down fast, as a press is; up with one soft overshoot. */
export function latchTo(live, to) {
  const s = live.spring('on');
  if (s.target === to) return false;
  if (reducedMotion()) s.snap(to);
  else if (to > s.x) s.to(to, PRESS.k, PRESS.c); else s.to(to, RELEASE.k, RELEASE.c);
  live.invalidate();
  return true;
}

/**
 * A hand on it: while the pointer or Space holds it, the cap goes a step further down than
 * where it rests, so the first frame answers whether it is up or latched. The press is heard on
 * the input's label, which is the whole target: its words, the button, and the input over them.
 */
export function latchHold(live, input, on) {
  const target = input.closest('label') ?? input;
  const press = live.spring('press');
  const go = (x, { k, c }) => { if (reducedMotion()) press.snap(x); else press.to(x, k, c); live.invalidate(); };
  // what holds it is remembered: a press of the mouse on a label takes the focus from its input
  // for a moment, and that must not let go of a cap the mouse still holds
  const down = (by) => { if (live.state.off || input.matches(':disabled') || live.state.held) return; live.state.held = by; go(-live.look.step, PRESS); cue('press'); };
  const up = (by) => { if (live.state.held !== by) return; live.state.held = null; go(0, RELEASE); };
  on(target, 'pointerdown', (e) => { if (e.button === 0) down('pointer'); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) on(target, type, () => up('pointer'));
  on(target, 'keydown', (e) => { if (e.key === ' ' && !e.repeat) down('key'); });
  for (const type of ['keyup', 'focusout']) on(target, type, () => up('key'));
}

export const checkbox = {
  name: 'checkbox',
  selector: '.vx-box',
  pad: 7,
  glowRadius: REACH,
  glowStrength: halo(GLOW),

  build(live, m) {
    const input = live.state.input = live.el.parentElement.querySelector('input');
    latch(live, m, { r: 0, off: !!input?.matches(':disabled') });
    // the first drawing is as it is, with nothing moving
    const s = live.spring('on', level(input));
    if (live.state.built === undefined) s.snap(level(input));
    live.state.built = true;
  },

  pose: latchPose,

  bind(live) {
    const on = listeners();
    const input = live.el.parentElement.querySelector('input');
    if (!input) return on.done;
    const set = (quiet) => { if (latchTo(live, level(input)) && !quiet) cue('tick'); };
    latchHold(live, input, on);
    on(input, 'change', () => set(false));
    // set from code: it follows, without a sound
    on.heed(input, 'checked', () => set(true));
    on.heed(input, 'indeterminate', () => set(true));
    // a form put back to how it began: the inputs change after the event, so look a moment later
    if (input.form) on(input.form, 'reset', () => setTimeout(() => set(true)));
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    const set_ = input.closest('fieldset');
    if (set_) on.watch(set_, { attributes: true, attributeFilter: ['disabled'] }, () => live.rebuild());
    return on.done;
  },
};
