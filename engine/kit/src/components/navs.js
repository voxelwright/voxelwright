// Navs. A row or a column of links to places. Three ways to say which is the current one:
//   plain    the current link is heavier and darker, and nothing is drawn
//   groove   an accent groove lies under the current link (in a row) or stands at its start (in a column)
//   seats    a trench of seats; the current link is a key in it, level with the surface, on its light
// Tool: none for the words; a groove, or a trench with a key in it.
// Markup: <nav class="vx-nav" data-vx-mark="groove" aria-label="harbor-api">
//           <a href="/overview">Overview</a>
//           <a href="/deploys" aria-current="page">Deploys</a>
//           <a role="link" aria-disabled="true">Billing</a>      one that leads nowhere yet: no href
//         </nav>
//         data-vx-mark="seats" for the trench; leave it out for plain. data-vx-way="down" stacks
//         the links. They may stand in a list (ul > li > a), under titles (.vx-nav-title), and a
//         deeper one says so with data-vx-level="2". Something at the end of a row of a column
//         (a count) is <span class="vx-nav-trail">.
// The links are real links: Tab reaches each, Enter follows it. The page (or the app's router)
// says which is current with aria-current="page"; the part reads that and nothing else, and
// draws again when it changes.
//
// The navbar, the navigation menu, the menubar and the sidebar mark their current thing the same
// way, and use what this file exports: currentOf and mark.

import { hole, ring, halo, byTheme, cap as capOf } from '../core/light.js';
import { SLIDE, reducedMotion } from '../core/motion.js';
import { cue } from '../core/sound.js';
import { listeners } from './util.js';

const isOn = (n, attr) => n.hasAttribute(attr) && n.getAttribute(attr) !== 'false';

/** The current link under el: the first with aria-current that is not "false". */
export function currentOf(el, selector = 'a') {
  return [...el.querySelectorAll(selector)].find((a) => isOn(a, 'aria-current')) ?? null;
}

/** A node's box in voxels from the corner of the part's own box: [x, y, w, h], whole voxels. */
export function boxOf(live, node, inset = false) {
  const { el, vx } = live;
  const b = el.getBoundingClientRect(), r = node.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const remX = (live.cssW - live.W * vx) / 2, remY = (live.cssH - live.H * vx) / 2;
  let l = r.left, t = r.right;
  if (inset) { const cs = getComputedStyle(node); l += parseFloat(cs.paddingLeft) || 0; t -= parseFloat(cs.paddingRight) || 0; }
  const x = Math.round((l - b.left - remX) / vx), y = Math.round((r.top - b.top - remY) / vx);
  return [x, y, Math.max(1, Math.round((t - b.left - remX) / vx) - x), Math.max(1, Math.round((r.bottom - b.top - remY) / vx) - y)];
}

/**
 * The mark of the current thing: an accent groove, one voxel deep and full of light, cut into
 * the surface the part lies on. way 'under': it lies under the node's words, a voxel above the
 * node's lower edge. way 'beside': it stands at the start of the part's box, as tall as the node
 * less two voxels at each end. clip: [top, bottom] in voxels, for a node in a box that scrolls;
 * what is outside it is not drawn. Returns true if it drew one. One mark a part: the stage knows
 * one hole a part.
 */
export function mark(live, m, node, { way = 'under', light = 'light', clip } = {}) {
  const b = node && boxOf(live, node, way === 'under');
  if (!b) return false;
  let [x, y, w, h] = b;
  if (way === 'under') { y = y + h - 2; h = 1; }
  else {
    const inset = h > 4 ? 2 : 0;
    x = getComputedStyle(live.el).direction === 'rtl' ? live.W - 2 : 1; w = 1; y += inset; h -= inset * 2;
  }
  if (clip) { const top = Math.max(y, clip[0]), end = Math.min(y + h, clip[1]); y = top; h = end - top; }
  if (h < 1 || w < 1) return false;
  hole(live, m, { x, y, w, h, depth: live.look.groove, wall: light, floor: light });
  return true;
}

// A shallow index rail sits under each line of project destinations. Every
// window is fitted at rest. Routing changes only which lens receives power.
function indexRail(live, model, current) {
  const rail = model.part('rail'), rows = new Map();
  for (const a of live.el.querySelectorAll('a')) {
    const box = boxOf(live, a);
    if (!box) continue;
    const [x, y, w, h] = box, bottom = y + h;
    const row = rows.get(bottom) ?? [];
    row.push({ x, w, on: a === current });
    rows.set(bottom, row);
  }
  for (const [bottom, stops] of rows) {
    const left = Math.min(...stops.map(stop => stop.x));
    const right = Math.max(...stops.map(stop => stop.x + stop.w));
    rail.slab(left, bottom - 3, 0, right - left, 3, 1, 'steel', 1);
    for (const { x, w, on } of stops) {
      const width = Math.min(5, w), start = x + Math.floor((w - width) / 2);
      rail.box(start, bottom - 2, 0, width, 1, 1, 'lens');
      if (on) {
        const rim = width >= 3 ? 1 : 0;
        rail.box(start + rim, bottom - 2, 0, width - 2 * rim, 1, 1, 'light');
      }
    }
  }
  live.faceZ = 1;
}

const MARK_GLOW = 0.05, SEAT_GLOW = 0.07;
const kindOf = (el) => ['index', 'seats', 'groove'].includes(el.dataset.vxMark) ? el.dataset.vxMark : 'plain';
function layoutSignature(live, cur) {
  if (live.el.dataset.vxMark === 'index') return [...live.el.querySelectorAll('a')].map(a => boxOf(live, a)?.join()).join('|');
  return cur ? boxOf(live, cur)?.join() : '';
}
const down = (el) => /^column/.test(getComputedStyle(el).flexDirection);

export const navs = {
  name: 'navs',
  selector: '.vx-nav',
  pad: 7,
  glowRadius: 3,
  glowStrength: halo(MARK_GLOW),

  build(live, m) {
    const { el } = live, s = live.state;
    const kind = s.kind = kindOf(el);
    const cur = currentOf(el);
    s.has = false;
    s.sig = layoutSignature(live, cur);
    if (kind === 'index') { indexRail(live, m, cur); return; }
    if (kind === 'plain') return; // words alone
    if (kind === 'groove') { mark(live, m, cur, { way: down(el) ? 'beside' : 'under' }); return; }
    // seats: the trench is the part's whole box
    const D = live.look.well;
    hole(live, m, { depth: D, wall: 'slate', floor: 'slate' });
    // the legends do not move; they are registered so that they are kept on whole pixels. A word
    // nudged for the last model is put back first (see pagination.js).
    for (const a of el.querySelectorAll('a')) { a.style.transform = ''; live.label(a, () => live.faceZ); }
    const glide = s.glide && !reducedMotion();
    s.glide = false;
    const b = cur && cur.getAttribute('aria-disabled') !== 'true' ? boxOf(live, cur) : null;
    if (!b) return; // no current link: an empty trench
    const [x, y, w, h] = b;
    // the key: a ring of light on the floor of the trench and a cap on it, its top level with the
    // surface, a voxel clear of the trench's walls and of the seats beside it
    const block = m.part('block');
    block.grounded = false;
    ring(block, 1, 1, -D, w - 2, h - 2, 'light');
    capOf(block, 1, 1, 1 - D, w - 2, h - 2, Math.max(1, D - 1), 'key');
    s.has = true;
    const sx = live.spring('x', x, SLIDE.k * 1.25, SLIDE.c * 1.12), sy = live.spring('y', y, SLIDE.k * 1.25, SLIDE.c * 1.12);
    const same = s.shape === `${w},${h}`;
    if (glide && same && s.was) { sx.to(x); sy.to(y); if (s.was !== `${x},${y}`) cue('slide'); } else { sx.snap(x); sy.snap(y); }
    s.was = `${x},${y}`; s.shape = `${w},${h}`;
  },

  pose(live) {
    const s = live.state;
    if (s.has) { const block = live.model.byName.block; block.tx = live.spring('x').x; block.ty = live.spring('y').x; }
    live.glowStrength = halo(s.kind === 'seats' ? SEAT_GLOW : MARK_GLOW) * byTheme(live);
  },

  bind(live) {
    const on = listeners(), el = live.el;
    on.watch(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'aria-disabled', 'data-vx-mark', 'data-vx-way', 'dir', 'hidden'] }, (list) => {
      const real = list.filter((r) => r.target !== live.canvas && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n === live.canvas)));
      if (!real.length) return;
      if (!live.canvas.isConnected) el.prepend(live.canvas); // an app that writes the links again takes the canvas out with them
      // only which link is current changed: the key slides to it. Anything else: it is put there.
      live.state.glide = real.every((r) => r.type === 'attributes' && r.attributeName === 'aria-current');
      live.rebuild();
    });
    // A link can move with the part's own box staying as it is (a font arrives, a neighbour's
    // words change, a row turns into a column): the mark is measured again whenever a link's box
    // changes, and drawn again only if the current one is somewhere else.
    const again = () => { const cur = currentOf(el); if (layoutSignature(live, cur) !== live.state.sig) live.rebuild(); };
    const sizes = new ResizeObserver(again);
    for (const a of el.querySelectorAll('a')) sizes.observe(a);
    on(window, 'resize', again);
    document.fonts?.ready.then(() => { if (live.canvas.isConnected) again(); });
    on({ addEventListener() {}, removeEventListener() { sizes.disconnect(); } }, 'end', again);
    return on.done;
  },
};
