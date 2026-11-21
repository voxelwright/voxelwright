// Popover. A slab that floats above everything on the accent's light, built out of the corner of
// the key that opened it. It is the browser's own popover: the key opens and closes it, Escape
// and a press outside close it, and focus goes back to the key.
// Tool: float (a ring of light and a slab, look.float high).
// Markup: <button class="vx-button" popovertarget="p" aria-expanded="false">Rename</button>
//         <div class="vx-popover" id="p" popover role="dialog" aria-labelledby="p-title">
//           <h3 id="p-title">Rename the service</h3> …
//           <button class="vx-button" popovertarget="p" popovertargetaction="hide">Cancel</button>
//         </div>
//         popover="manual" stays until its key is pressed again. data-vx-side="top" puts it above
//         its key, data-vx-align="end" lines up their far edges; it turns over by itself where
//         there is no room. `autofocus` on something inside takes the focus as it opens.
//
// The tooltip and the hover card are floats too, and use what this file exports: place, rouse,
// slabOnLight and anchored.

import { ring, halo, lightName } from '../core/light.js';
import { listeners } from './util.js';

const EDGE = 12; // px kept clear between a float and the window's edge

/**
 * Put a float by its trigger, inside the window. side: 'bottom' or 'top' (it turns over where
 * there is no room); align: 'start', 'end' or 'center'; gap in px; lift: how far its sides show
 * above its box, in px (a slab's top side is seen over its face, so under a trigger it needs
 * that much more room). Returns the point of the float nearest the trigger, in px from the
 * float's corner: where it is built from.
 */
export function place(el, trigger, { side = 'bottom', align = 'start', gap = 8, lift = 0 } = {}) {
  const r = trigger.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const fromLeft = (align === 'start') !== (getComputedStyle(trigger).direction === 'rtl');
  let left = align === 'center' ? r.left + r.width / 2 - w / 2 : fromLeft ? r.left : r.right - w;
  if (align !== 'center' && (left < EDGE || left + w > vw - EDGE)) {
    const other = fromLeft ? r.right - w : r.left; // the other edge, if it fits there whole
    if (other >= EDGE && other + w <= vw - EDGE) left = other;
  }
  left = Math.round(Math.max(EDGE, Math.min(left, vw - EDGE - w)));
  const below = r.bottom + gap + lift, above = r.top - gap - h;
  const belowFits = below + h <= vh - EDGE, aboveFits = above >= EDGE;
  const preferred = side === 'top' ? (aboveFits || !belowFits ? above : below) : belowFits || !aboveFits ? below : above;
  const top = Math.round(el.matches('.vx-menu, [data-vx-fitting="service"]') ? Math.max(EDGE, Math.min(preferred, vh - EDGE - h)) : preferred);
  el.style.margin = '0';
  el.style.inset = `${top}px auto auto ${left}px`;
  const x = Math.abs(left - r.left) < 1 ? 0 : Math.abs(left + w - r.right) < 1 ? w : Math.max(0, Math.min(w, r.left + r.width / 2 - left));
  return [x, top < r.top ? h : 0];
}

/**
 * A float is not laid out while it is closed, so neither it nor the parts inside it could be
 * measured, and the stage has stopped drawing them. Call this once it has a box: it and
 * everything in it is measured and drawn on the first frame.
 */
export function rouse(live) {
  live.visible = true;
  const resume = live.rebuild();
  for (const [node, l] of live.stage.lives) {
    if (node === live.el || !live.el.contains(node)) continue;
    l.visible = true;
    if (node.offsetWidth !== l.cssW || node.offsetHeight !== l.cssH) l.rebuild(); else l.invalidate();
  }
  return resume;
}

/** The float's model: a ring of light on the surface and a slab standing on it. */
export function slabOnLight(live, m) {
  const { W, H, el } = live, d = live.look.float;
  ring(m.part('light'), 0, 0, 0, W, H, lightName(el, 'light'), 1);
  const body = m.part('body');
  body.grounded = false;
  body.slab(0, 0, 1, W, H, d - 1, live.look.readingPlate ?? 'key', 1);
  live.faceZ = d;
}

// The service editor sits on a thin insulating foot. A short diffuser is let
// into its near edge; the rest of the enclosure carries no emission.
function servicePlate(live, model) {
  const { W, H } = live;
  const body = model.part('body');
  body.slab(1, 1, 0, W - 2, H - 2, 1, 'gasket', 2);
  body.slab(0, 0, 1, W, H, 2, 'chalk', 2);
  body.slab(1, 1, 3, W - 2, H - 2, 1, live.look.readingPlate ?? 'key', 1);
  if (W >= 24) {
    const x = getComputedStyle(live.el).direction === 'rtl' ? W - 17 : 5;
    body.box(x, 0, 2, 12, 1, 1, 'gasket');
    live.state.pipeX = x + 1;
    body.box(x + 1, 0, 2, 10, 1, 1, 'backlight');
  }
  live.state.litRevision = null;
  live.faceZ = 4;
}

// The edge beside the pipe reflects a little of its light. A translucent
// case also carries it through the shoulder under the reading plate.
function lightServiceEdge(live) {
  if (live.state.litRevision === live.tintRevision) return;
  live.state.litRevision = live.tintRevision;
  const start = live.state.pipeX;
  if (start == null || !live.look.dimmer) return;
  const shell = live.look.materials.chalk;
  const reach = 2 + 4 * (shell?.transmission ?? 0);
  const rgb = [1, 3, 5].map(i => parseInt(live.look.illuminant.slice(i, i + 2), 16) / 255);
  const body = live.model.byName.body;
  for (let i = 0; i < body.count; i++) {
    const x = body.rest[i * 3], y = body.rest[i * 3 + 1], z = body.rest[i * 3 + 2];
    if (y > reach || z < 1 || body.col[i * 4 + 3] > 0) continue;
    const distance = Math.hypot(Math.max(start - x, 0, x - start - 10), y, z - 2.5);
    if (distance >= reach) continue;
    const spill = live.look.dimmer * 0.34 * (1 - distance / reach) ** 2;
    for (let c = 0; c < 3; c++) {
      const at = i * 4 + c;
      body.col[at] += (rgb[c] - body.col[at]) * spill;
    }
  }
}

// The floats that are open, and how each is put by its trigger again when the page moves under it.
const open = new Map();
const again = () => { for (const [el, put] of open) if (el.isConnected && el.matches(':popover-open')) put(); else open.delete(el); if (!open.size) heed(false); };
function heed(yes) {
  const f = yes ? 'addEventListener' : 'removeEventListener';
  window[f]('resize', again);
  window[f]('scroll', again, { capture: true, passive: true });
}

// The browser closes the control immediately. Keeping its box through the overlay transition
// keeps the painted rim available for its short release, with no hit target or tab stop.
export function nativeRelease(live, on, parts, duration = 0.12, surface = 'rim', origin) {
  if (!live) return;
  const el = live.el;
  let request;
  const clear = () => {
    delete el.dataset.vxNativeExit;
    for (const key of ['display', 'x', 'y', 'w', 'h']) el.style.removeProperty('--vx-exit-' + key);
  };
  on(el, 'beforetoggle', e => {
    const current = request = Symbol();
    clear();
    if (e.newState === 'open' || !live.model) return;
    if (el.matches('[popover], .vx-dialog')) el.style.setProperty('--vx-exit-display', getComputedStyle(el).display);
    if (el.matches('dialog.vx-dialog')) {
      // Closing drops :modal and [open] positioning before the last course has left.
      const rect = el.getBoundingClientRect();
      for (const [key, px] of Object.entries({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })) {
        el.style.setProperty('--vx-exit-' + key, px + 'px');
      }
    }
    el.dataset.vxNativeExit = '';
    // A reused menu can acquire a different model and opening point on each invocation.
    const motion = typeof parts === 'function' ? parts() : { parts, surface, from: origin?.() };
    live.play('crumble', motion.parts, { duration: motion.closeDuration ?? duration, surface: motion.surface, from: motion.from }).then(() => {
      if (current !== request) return;
      clear();
      live.clearSurface();
    });
  });
}

/**
 * What every float does when it opens, whoever opened it (its key, a timer, the page's own code):
 * it is placed by its trigger before it is seen, built from the corner nearest the trigger, and
 * kept by the trigger while the page scrolls or the window changes.
 * opts: trigger() the element it belongs to; side, align (see place); gap: the clear space between
 *       the two, in voxels; duration: seconds to assemble; surface: rim or full courses; still(): true to
 *       appear with no building.
 */
export function anchored(el, on, live, { trigger, side = 'bottom', align = 'start', gap = 2, duration = 0.18, surface = 'rim', release = 0.12, still } = {}) {
  const vx = () => live?.vx ?? (parseFloat(getComputedStyle(el).getPropertyValue('--vx')) || 4);
  let origin;
  const put = () => {
    const t = trigger();
    // a voxel of height shows half a voxel of side above the face
    if (!t) return null;
    const from = place(el, t, { side: el.dataset.vxSide || side, align: el.dataset.vxAlign || align, gap: gap * vx(), lift: live ? live.faceZ * vx() / 2 : 0 });
    const above = from[1] > 0;
    if (live && live.state.above !== above) {
      live.state.above = above;
      live.invalidate();
    }
    origin = from.map(px => px / vx());
    return from;
  };
  const parts = ['body', 'panel', 'light'];
  nativeRelease(live, on, parts, release, surface, surface === 'courses' ? () => origin : undefined);
  on(el, 'beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    // it has no box until it is open, and by then it has been seen: give it one for a moment
    el.setAttribute('data-vx-measure', '');
    const from = put();
    if (live) {
      const resume = rouse(live);
      if (from && !still?.()) live.play('assemble', parts, { surface, resume, from: origin, duration });
    }
    el.removeAttribute('data-vx-measure');
  });
  on(el, 'toggle', (e) => {
    if (e.newState !== 'open') { open.delete(el); if (!open.size) heed(false); return; }
    if (!open.size) heed(true);
    open.set(el, put);
  });
  if (el.matches(':popover-open')) { put(); if (!open.size) heed(true); open.set(el, put); }
  return put;
}

// The keys that open this popover (not the ones inside it that only close it).
const openers = (el) => (el.id ? [...document.querySelectorAll(`[popovertarget="${CSS.escape(el.id)}"]:not([popovertargetaction="hide"])`)] : []);

function wire(el, on, live) {
  if (!el.showPopover) return; // a browser with no popovers: it stays as the page wrote it
  let source = null;
  for (const t of openers(el)) if (!t.hasAttribute('aria-expanded')) t.setAttribute('aria-expanded', String(el.matches(':popover-open')));
  // the key says it is open (the button part reads this, and stays down). This is heard before
  // it is placed, so it is placed by the key that opened it.
  on(el, 'beforetoggle', (e) => {
    const all = openers(el);
    if (e.newState === 'open') source = all.includes(e.source) ? e.source : all[0] ?? null;
    for (const t of all) t.setAttribute('aria-expanded', String(e.newState === 'open' && t === source));
  });
  const fitting = el.dataset.vxFitting === 'service' ? { gap: 1, surface: 'courses', duration: 0.24, release: 0.16 } : {};
  anchored(el, on, live, { trigger: () => source ?? openers(el)[0], ...fitting });
  on(el, 'toggle', (e) => { for (const t of openers(el)) t.setAttribute('aria-expanded', String(e.newState === 'open' && t === source)); });
  // Tab out of it and it closes: it must not lie over what has the focus now. Focus that goes to
  // its own key, or into another float it opened, leaves it open; and popover="manual" stays
  // until it is told to go.
  on(el, 'focusout', (e) => {
    const to = e.relatedTarget;
    if (el.popover === 'manual' || !to || el.contains(to) || openers(el).includes(to) || to.closest(':popover-open')) return;
    if (el.matches(':popover-open')) el.hidePopover();
  });
}

export const popover = {
  name: 'popover',
  selector: '.vx-popover',
  pad: 11,
  glowRadius: 2.2,
  glowStrength: halo(0.15),

  build(live, m) {
    if (live.el.dataset.vxFitting === 'service') servicePlate(live, m);
    else slabOnLight(live, m);
  },

  pose(live) {
    live.glowStrength = halo(live.theme === 'day' ? 0.04 : 0.025);
    if (live.el.dataset.vxFitting === 'service') lightServiceEdge(live);
  },

  bind(live) {
    const on = listeners();
    wire(live.el, on, live);
    on.watch(live.el, { attributes: true, attributeFilter: ['data-vx-light'] }, () => live.rebuild());
    return on.done;
  },

  plain(el, on) { wire(el, on, null); },
};
