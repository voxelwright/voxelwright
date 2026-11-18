// Resizable panels. Regions of one surface, parted by a groove that can be dragged. At rest the
// groove holds the room's own warm light, as any groove does; while it is held, by a pointer or
// by an arrow key, it turns to the accent.
// Tool: groove (a channel one voxel wide, look.groove deep). The regions are none: words on the
// one surface, with no box round them.
// Markup: <div class="vx-resizable" style="--vx-split: 32%">
//           <div class="vx-resizable-pane" id="files" data-vx-min="20">…</div>
//           <div class="vx-resizable-groove" role="separator" aria-controls="files"
//                aria-label="Width of the file list" aria-valuenow="32"></div>
//           <div class="vx-resizable-pane" data-vx-min="24">…</div>
//         </div>
//         --vx-split is the size of a pane that has a groove after it (halves without it; a pane
//         may carry its own). data-vx-min is a pane's least size in voxels (12 without it).
//         data-vx-way="down" on the container stacks the panes, with a lying groove; it then
//         needs a height (15rem without one). More panes: pane, groove, pane, groove, pane; each
//         groove moves the pane before it against the pane after it. aria-disabled="true" on a
//         groove fixes it where it is.
// With no script it is a still divider at --vx-split, and takes no focus. The script makes the
// groove a window splitter: it takes focus (tabindex="0"), says which way it stands
// (aria-orientation), and keeps aria-valuenow, aria-valuemin and aria-valuemax true: the share of
// the room the pane before it has, has at its least, and has at its most, 0 to 100. Sizes are
// written in px on whole voxels (flex-basis on each pane but the last, which takes the rest).
// Each change sends `vx-resize` from the groove (bubbles; detail.value, detail.size in px).
//   pointer   drag to resize; a double press goes back to the split the page began with
//   arrows    Left and Right (Up and Down when stacked) move it two voxels, with Shift ten
//   Home End  the pane before it at its least, at its most
//   Enter     the pane before it to its least; again, back to where it was

import { hole, halo, byTheme, warmth } from '../core/light.js';
import { CALM, reducedMotion } from '../core/motion.js';
import { listeners, clamp } from './util.js';

const LEAST = 12;          // voxels: a pane's least size where it names none
const STEP = 2, LEAP = 10; // voxels an arrow key moves the groove, and with Shift
const GLOW = 0.05, REACH = 2.6;

const sum = (a) => a.reduce((x, y) => x + y, 0);
const set = (el, name, v) => { if (el.getAttribute(name) !== v) el.setAttribute(name, v); };
let ids = 0;

/**
 * One container's split, shared by its grooves: the size of each pane but the last, in px on
 * whole voxels, and the share of the room each stands for. The shares are what is kept when the
 * container changes size; the least sizes win over them.
 */
function makeSplit(root) {
  const s = { sizes: [], shares: [], start: [], ready: false, users: 0 };
  const kids = (cls) => [...root.children].filter((n) => n.classList.contains(cls));
  const panes = () => kids('vx-resizable-pane'), grooves = () => kids('vx-resizable-groove');
  s.down = () => root.dataset.vxWay === 'down';
  s.flip = () => !s.down() && getComputedStyle(root).direction === 'rtl';
  s.k = () => parseFloat(getComputedStyle(root).getPropertyValue('--vx')) || 4;
  const len = (n) => n.getBoundingClientRect()[s.down() ? 'height' : 'width'];
  const snap = (px) => { const k = s.k(); return Math.round(px / k) * k; };
  const least = (p) => { const v = parseFloat(p.dataset.vxMin); return (v >= 0 ? v : LEAST) * s.k(); };
  /** The room the panes share: the container's inside, less its grooves and any gaps. */
  s.room = () => {
    const cs = getComputedStyle(root), down = s.down();
    const inner = down ? root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(down ? cs.rowGap : cs.columnGap) || 0;
    return Math.max(0, inner - sum(grooves().map(len)) - gap * Math.max(0, root.children.length - 1));
  };
  /** Which pane a groove moves: the one before it. -1 if it has none, or none after it. */
  s.at = (g) => {
    let p = g.previousElementSibling;
    while (p && !p.classList.contains('vx-resizable-pane')) p = p.previousElementSibling;
    const i = panes().indexOf(p);
    return i >= 0 && i < s.sizes.length ? i : -1;
  };

  // the split as the page wrote it: read once, from the panes as they lie
  const init = () => {
    const ps = panes(), R = s.room();
    if (ps.length < 2 || R <= 0) return false;
    s.shares = ps.slice(0, -1).map((p) => len(p) / R);
    s.start = [...s.shares];
    s.ready = true;
    return true;
  };
  // the sizes for the room as it is now: each pane its share, none below its least
  const fit = () => {
    const ps = panes(), n = ps.length - 1;
    if (s.ready && s.shares.length !== n) { for (const p of ps) p.style.flexBasis = ''; s.ready = false; } // panes came or went: read again
    if (!s.ready && !init()) return false;
    const R = s.room(), k = s.k();
    if (R <= 0) return false;
    const mins = ps.map(least);
    const sizes = s.shares.map((share, i) => Math.max(mins[i], snap(share * R)));
    // the last pane keeps its least too: what it lacks comes from the panes before it, the nearest first
    let lack = mins[n] - (R - sum(sizes));
    for (let i = n - 1; i >= 0 && lack > 0; i--) {
      const give = Math.min(Math.ceil(lack / k) * k, sizes[i] - mins[i]);
      sizes[i] -= give; lack -= give;
    }
    s.sizes = sizes;
    return true;
  };
  /** How small and how large groove i may make the pane before it, in px. */
  s.limits = (i) => {
    const ps = panes(), n = s.sizes.length, R = s.room(), k = s.k();
    const next = i + 1 < n ? s.sizes[i + 1] : R - sum(s.sizes);
    const lo = least(ps[i]);
    return [lo, Math.max(lo, Math.floor((s.sizes[i] + next - least(ps[i + 1])) / k + 0.001) * k)];
  };
  // put the sizes on the panes, and what each groove says about itself
  const write = () => {
    const ps = panes(), R = s.room();
    s.sizes.forEach((v, i) => { const b = v + 'px'; if (ps[i].style.flexBasis !== b) ps[i].style.flexBasis = b; });
    const pct = (v) => String(Math.round(100 * v / R));
    for (const g of grooves()) {
      const i = s.at(g);
      if (i < 0) continue;
      const [lo, hi] = s.limits(i);
      set(g, 'aria-orientation', s.down() ? 'horizontal' : 'vertical'); // a groove that parts left from right stands
      set(g, 'aria-valuemin', pct(lo)); set(g, 'aria-valuemax', pct(hi)); set(g, 'aria-valuenow', pct(s.sizes[i]));
      if (!g.hasAttribute('aria-controls')) { ps[i].id ||= `vx-pane-${++ids}`; g.setAttribute('aria-controls', ps[i].id); }
    }
  };
  s.refit = () => { if (fit()) write(); };
  /** Make the pane before groove i this many px, within its limits. True if it changed. */
  s.move = (i, to) => {
    if (!s.ready || i < 0) return false;
    const [lo, hi] = s.limits(i), R = s.room();
    const v = clamp(snap(to), lo, hi), d = v - s.sizes[i];
    if (!d) return false;
    s.sizes[i] = v; s.shares[i] = v / R;
    if (i + 1 < s.sizes.length) { s.sizes[i + 1] -= d; s.shares[i + 1] = s.sizes[i + 1] / R; }
    write();
    return true;
  };

  // the container may change size (a window, a phone turned), way, or panes
  const sized = new ResizeObserver(s.refit);
  const changed = new MutationObserver(() => { watch(); s.refit(); });
  const watch = () => {
    changed.disconnect();
    changed.observe(root, { childList: true, attributes: true, attributeFilter: ['data-vx-way', 'dir'] });
    for (const p of panes()) changed.observe(p, { attributes: true, attributeFilter: ['data-vx-min'] });
  };
  s.use = () => { if (!s.users++) { sized.observe(root); watch(); root.setAttribute('data-vx-on', ''); } s.refit(); };
  s.drop = () => { if (!--s.users) { sized.disconnect(); changed.disconnect(); root.removeAttribute('data-vx-on'); } };
  return s;
}

const splits = new WeakMap();
function splitOf(root) {
  let s = splits.get(root);
  if (!s) splits.set(root, s = makeSplit(root));
  return s;
}

/**
 * A groove's behaviour, with voxels or without. Keeps `st` (aimed: a mouse is over it; focus) and
 * the data-vx-held attribute true, and calls changed() after each change of either.
 */
function wire(el, on, changed = () => {}) {
  const st = { aimed: false, focus: false };
  const root = el.closest('.vx-resizable');
  if (!root) return st;
  const split = splitOf(root);
  const off = () => el.getAttribute('aria-disabled') === 'true';
  // it takes focus, unless the page fixed it where it is
  let mine = false;
  const stop = () => { const want = !off(); if (want && !el.hasAttribute('tabindex')) { el.tabIndex = 0; mine = true; } else if (!want && mine) { el.removeAttribute('tabindex'); mine = false; } };
  stop();
  split.use();

  const hold = (held) => { if (el.hasAttribute('data-vx-held') !== held) { el.toggleAttribute('data-vx-held', held); changed(); } };
  const tell = (i) => el.dispatchEvent(new CustomEvent('vx-resize', { bubbles: true, detail: { value: Number(el.getAttribute('aria-valuenow')), size: split.sizes[i] } }));
  const go = (i, to) => { if (split.move(i, to)) tell(i); };

  // a pointer takes the groove: the pane before it follows, a voxel at a time
  let grab = null;
  const along = (e) => (split.down() ? e.clientY : e.clientX);
  on(el, 'pointerdown', (e) => {
    const i = split.at(el);
    if (e.button !== 0 || off() || i < 0) return;
    e.preventDefault(); // it starts no selection
    el.focus({ preventScroll: true, focusVisible: false }); // the arrow keys go on from where the hand left it; no ring for a hand
    grab = { i, at: along(e), size: split.sizes[i] };
    try { el.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still drags while it is over the groove */ }
    hold(true);
  });
  on(el, 'pointermove', (e) => { if (grab) go(grab.i, grab.size + (along(e) - grab.at) * (split.flip() ? -1 : 1)); });
  const drop = () => { if (grab) { grab = null; hold(false); } };
  on(el, 'pointerup', drop);
  on(el, 'pointercancel', drop);
  on(el, 'lostpointercapture', drop);
  // a double press: back to the split the page began with
  on(el, 'dblclick', () => { const i = split.at(el); if (i >= 0 && !off()) go(i, split.start[i] * split.room()); });

  // the keys of a window splitter
  let before; // the share it had when Enter took it to its least
  on(el, 'keydown', (e) => {
    const i = split.at(el);
    if (off() || i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const down = split.down(), flip = split.flip();
    const more = down ? 'ArrowDown' : flip ? 'ArrowLeft' : 'ArrowRight', less = down ? 'ArrowUp' : flip ? 'ArrowRight' : 'ArrowLeft';
    const [lo, hi] = split.limits(i);
    let to;
    if (e.key === more || e.key === less) { to = split.sizes[i] + (e.key === more ? 1 : -1) * (e.shiftKey ? LEAP : STEP) * split.k(); hold(true); }
    else if (e.key === 'Home') to = lo;
    else if (e.key === 'End') to = hi;
    else if (e.key === 'Enter') {
      if (split.sizes[i] > lo) { before = split.shares[i]; to = lo; } else to = (before ?? split.start[i]) * split.room();
    } else return;
    e.preventDefault();
    go(i, to);
  });
  on(el, 'keyup', (e) => { if (e.key.startsWith('Arrow') && !grab) hold(false); });

  on(el, 'pointerenter', (e) => { if (e.pointerType === 'mouse' && !off()) { st.aimed = true; changed(); } });
  on(el, 'pointerleave', () => { if (st.aimed) { st.aimed = false; changed(); } });
  on(el, 'focus', () => { st.focus = true; changed(); });
  on(el, 'blur', () => { st.focus = false; if (!grab) hold(false); changed(); });
  on.watch(el, { attributes: true, attributeFilter: ['aria-disabled'] }, () => { stop(); if (off()) { drop(); hold(false); } changed(); });

  // when these listeners go, so does what they added: it is a still divider again
  on({ addEventListener() {}, removeEventListener() { grab = null; el.removeAttribute('data-vx-held'); if (mine) el.removeAttribute('tabindex'); split.drop(); } }, 'end', drop);
  return st;
}

export const resizable = {
  name: 'resizable',
  selector: '.vx-resizable-groove',
  pad: 6,
  glowRadius: REACH,
  glowStrength: halo(GLOW),

  build(live, m) {
    const { W, H, el } = live, D = live.look.groove;
    const lying = el.closest('.vx-resizable')?.dataset.vxWay === 'down';
    // the channel is the middle voxel of the groove's box; the rest of the box is clear surface
    // to take hold of. Held, its light is the accent's; at rest, the room's own.
    const mat = el.hasAttribute('data-vx-held') ? 'light' : 'light-warm';
    hole(live, m, lying
      ? { x: 0, y: Math.floor((H - 1) / 2), w: W, h: 1, depth: D, wall: mat, floor: mat }
      : { x: Math.floor((W - 1) / 2), y: 0, w: 1, h: H, depth: D, wall: mat, floor: mat });
    live.state.held = mat === 'light';
  },

  pose(live) {
    // brighter while it is aimed at or has the focus; held, it is the accent at its full strength
    const lit = live.spring('lit').x, held = live.state.held;
    live.glowStrength = halo(GLOW) * (held ? byTheme(live) * 1.8 : warmth(live) * (1 + lit * 1.1));
    live.glowRadius = REACH + (held ? 1.2 : lit * 0.8);
  },

  bind(live) {
    const on = listeners(), el = live.el;
    const st = wire(el, on, () => {
      if (!live.model) return; // a change heard before the first model
      const to = (st.aimed || st.focus) && el.getAttribute('aria-disabled') !== 'true' ? 1 : 0;
      const lit = live.spring('lit', 0, CALM.k * 2, CALM.c * 1.4);
      if (reducedMotion()) lit.snap(to); else lit.to(to);
      if (el.hasAttribute('data-vx-held') !== live.state.held) live.rebuild(); else live.invalidate();
    });
    // held from code (the attribute set or taken off): it is drawn again
    on.watch(el, { attributes: true, attributeFilter: ['data-vx-held'] }, () => { if (el.hasAttribute('data-vx-held') !== live.state.held) live.rebuild(); });
    const root = el.closest('.vx-resizable');
    if (root) on.watch(root, { attributes: true, attributeFilter: ['data-vx-way'] }, () => live.rebuild());
    return on.done;
  },

  plain(el, on) { wire(el, on); },
};
