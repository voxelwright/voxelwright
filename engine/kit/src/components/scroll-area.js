// Scroll area. A recess that scrolls; beside it, a thin slot with a small knob in it that shows
// where you are and can be dragged: a fader stood on end.
// Tool: what slides. The recess is the kit's own (.vx-recess); this part is the bar: a slot cut in
// the surface at the recess's far edge, in a steel bezel a voxel wide, and a knob standing in it
// on the accent's light, ridged across to grip. The same device as the switch and the slider.
// Markup: <div class="vx-scroll" style="--vx-scroll-h: 48">
//           <div class="vx-recess vx-scroll-well">
//             <div class="vx-scroll-view" tabindex="0" role="region" aria-label="Build log">…</div>
//           </div>
//           <span class="vx-scroll-bar" aria-hidden="true"></span>
//         </div>
// The view is a real scrolling element: the wheel, a finger, and the keys (arrows, Page Up and
// Down, Space, Home, End, once it has focus) are the browser's own, and so is its bar where no
// script runs. The key is an extra for a mouse: drag it, or press the trench above or below it
// to go a page that way. It is hidden from a screen reader and takes no focus, and it goes when
// there is nothing to scroll.

import { hole, ring, bezel, halo, byTheme, cap as capOf } from '../core/light.js';
import { PRESS, RELEASE } from '../core/motion.js';
import { listeners } from './util.js';

const LEAST = 11; // the key's least length in voxels: enough to take hold of

/**
 * The bar's behaviour, with voxels or without. Keeps `st` true to the view, writes --_len and
 * --_at (px) on the bar for the plain version, and calls changed(reshape) after each change:
 * reshape is true when the key's length changed.
 */
function wire(bar, on, changed = () => {}) {
  const root = bar.closest('.vx-scroll'), view = root?.querySelector('.vx-scroll-view');
  const st = { len: 0, at: 0, travel: 0, far: 0, idle: true, held: false };
  if (!view) return st;
  const measure = () => {
    const k = parseFloat(getComputedStyle(bar).getPropertyValue('--vx')) || 4;
    const track = bar.clientHeight - k * 2, seen = view.clientHeight, all = view.scrollHeight; // the key keeps a voxel clear of each end
    const idle = all <= seen + 1 || track < LEAST * k;
    const len = idle ? 0 : Math.min(track, Math.max(LEAST * k, Math.round(track * seen / all / k) * k));
    const reshape = len !== st.len || idle !== st.idle;
    st.len = len; st.idle = idle; st.travel = track - len; st.far = all - seen;
    st.at = k + (idle || st.far <= 0 ? 0 : Math.max(0, Math.min(1, view.scrollTop / st.far)) * st.travel);
    bar.toggleAttribute('data-vx-idle', idle);
    bar.style.setProperty('--_len', len + 'px');
    bar.style.setProperty('--_at', st.at + 'px');
    changed(reshape);
  };
  on(view, 'scroll', measure, { passive: true });
  // what is in the view may grow, shrink or change, and so may the view
  const sizes = new ResizeObserver(measure);
  const watch = () => { sizes.disconnect(); sizes.observe(view); sizes.observe(bar); for (const c of view.children) sizes.observe(c); };
  on.watch(view, { childList: true, subtree: true, characterData: true }, () => { watch(); measure(); });
  watch();

  // a mouse on the bar: the key is dragged; the trench above or below it goes a page that way
  let grab = null;
  const hold = (held) => { st.held = held; bar.toggleAttribute('data-vx-held', held); changed(false); };
  on(bar, 'pointerdown', (e) => {
    if (e.button !== 0 || st.idle) return;
    e.preventDefault(); // it takes no focus and starts no selection
    const y = e.clientY - bar.getBoundingClientRect().top;
    if (y >= st.at && y <= st.at + st.len) {
      grab = { y: e.clientY, top: view.scrollTop };
      try { bar.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still drags while it is over the bar */ }
      hold(true);
    } else view.scrollBy({ top: (y < st.at ? -1 : 1) * view.clientHeight * 0.9, behavior: 'instant' });
  });
  on(bar, 'pointermove', (e) => { if (grab && st.travel > 0) view.scrollTop = grab.top + (e.clientY - grab.y) / st.travel * st.far; });
  const drop = () => { if (grab) { grab = null; hold(false); } };
  on(bar, 'pointerup', drop);
  on(bar, 'pointercancel', drop);
  on(bar, 'lostpointercapture', drop);

  // from here the kit's bar stands in for the browser's; give it back when the listeners go
  root.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { sizes.disconnect(); root.removeAttribute('data-vx-on'); } }, 'end', measure);
  measure();
  return st;
}

export const scrollArea = {
  name: 'scroll-area',
  selector: '.vx-scroll-bar',
  pad: 6,
  glowRadius: 2.6,
  glowStrength: halo(0.05),

  build(live, m) {
    const { W, H, vx } = live, look = live.look, D = look.well, st = live.state.bar;
    // The bezel is a voxel wide, not two: the bar is thin, and it stands two voxels from the recess.
    bezel(m, 0, 0, W, H, { by: 1 });
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    const L = st && !st.idle ? Math.round(st.len / vx) : 0;
    // the knob stands on the floor of the slot, on its own light, a voxel clear of the walls; its
    // top is as far above the surface as a key travels, as the slider's shoulder is, so it stands
    // proud of the bezel
    const top = look.travel;
    if (L && W > 2) {
      const key = m.part('key');
      key.grounded = false;
      ring(key, 1, 0, -D, W - 2, L, 'light');
      capOf(key, 1, 0, 1 - D, W - 2, L, D - 1 + top, 'ivory');
      // ridges across its middle to grip: three, or one on a knob too short for three
      const mid = Math.floor(L / 2);
      for (const y of L >= 9 ? [mid - 2, mid, mid + 2] : [mid]) key.box(1, y, top, W - 2, 1, 1, 'ivory');
    }
    // held, it goes down as far as a key does, and no further than level with the bezel
    live.state.down = Math.max(0, Math.min(look.travel, top - 1));
  },

  pose(live) {
    const key = live.model.byName.key, st = live.state.bar;
    if (key) { key.ty = st.at / live.vx; key.tz = live.spring('press').x; }
    live.glowStrength = halo(0.05) * byTheme(live) * (st?.held ? 2.2 : 1);
  },

  bind(live) {
    const on = listeners();
    live.state.bar = wire(live.el, on, (reshape) => {
      if (!live.model) return; // the first measure comes before the first model
      const st = live.state.bar;
      if (st) live.spring('press').to(st.held ? -live.state.down : 0, st.held ? PRESS.k : RELEASE.k, st.held ? PRESS.c : RELEASE.c);
      if (reshape) live.rebuild(); else live.invalidate();
    });
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
