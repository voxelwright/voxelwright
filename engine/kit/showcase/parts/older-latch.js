// The native summary owns activation. Its thumb key bottoms on contact and
// returns to a lower detent while the archive is visible.
import { button } from '../../src/components/button.js';
import { listeners } from '../../src/components/util.js';
import { hole } from '../../src/core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';

export const olderLatch = {
  name: 'older-latch',
  selector: '#older > summary > .older-latch',
  pad: 4,

  build(live, model) {
    const { W, H } = live;
    const width = W - 11;
    const { floor } = hole(live, model, { x: 2, y: 2, w: width, h: H - 4, depth: 5, wall: 'gasket', floor: 'slate' });
    model.part('bezel').slab(0, 0, 0, W, H, 1, 'warm-metal', 2)
      .carve(2, 2, 0, width, H - 4, 1)
      .carve(W - 7, H / 2 - 2, 0, 5, 4, 1);
    // The plunger slides through a bore in the socket floor.
    const shaftX = 2 + Math.floor(width / 2) - 2;
    floor.carve(shaftX - 1, 5, -6, 6, 6, 1);
    const stem = model.part('stem');
    stem.grounded = false;
    stem.box(shaftX, 6, -7, 4, 4, 6, 'steel');
    const cap = model.part('cap');
    cap.grounded = false;
    cap.slab(3, 3, -1, width - 2, H - 6, 4, 'gasket', 2);
    cap.slab(4, 4, 3, width - 4, H - 8, 1, 'key', 1);
    const cx = Math.floor(width / 2) + 1, cy = Math.floor(H / 2);
    for (const [name, direction] of [['closed-mark', 1], ['open-mark', -1]]) {
      const mark = model.part(name);
      mark.grounded = false;
      for (let x = -3; x <= 3; x++) mark.plot(cx + x, cy - direction * (Math.abs(x) - 1), 4, 'ink');
    }
    model.part('socket').slab(W - 7, H / 2 - 2, 0, 5, 4, 1, 'gasket', 1);
    model.part('lens').box(W - 6, H / 2 - 1, 1, 3, 2, 1, 'ivory');
    live.glowStrength = 0;
    live.state.lit = undefined;
  },

  pose(live) {
    const { cap, stem, lens, bezel } = live.model.byName;
    stem.tz = cap.tz = Math.max(-4, Math.min(0, live.spring('stroke').x));
    const open = live.el.closest('details').open;
    const closedMark = live.model.byName['closed-mark'], openMark = live.model.byName['open-mark'];
    closedMark.tz = openMark.tz = cap.tz;
    closedMark.hidden = open;
    openMark.hidden = !open;
    if (open === live.state.lit && live.tintRevision === live.state.tint) return;
    live.state.lit = open;
    live.state.tint = live.tintRevision;
    // Smoked amber lens. Only the neighbouring metal receives its reflection.
    const amber = [1, .66, .25];
    const glass = open ? [...amber, .8] : [.33, .28, .18, 0];
    for (let i = 0; i < lens.count; i++) lens.col.set(glass, i * 4);
    bezel.tint(live.theme, live.look);
    if (open) for (let i = 0; i < bezel.count; i++) {
      const x = bezel.rest[i * 3], y = bezel.rest[i * 3 + 1];
      const distance = Math.hypot(x - (live.W - 4.5), y - live.H / 2);
      const spill = Math.max(0, 1 - distance / 5) * .35;
      for (let c = 0; c < 3; c++) bezel.col[4 * i + c] += (amber[c] - bezel.col[4 * i + c]) * spill;
    }
  },

  bind(live) {
    const summary = live.el.parentElement, details = summary.parentElement;
    const on = listeners();
    const stroke = live.spring('stroke', details.open ? -2 : 0);
    let held = false;
    const seat = () => {
      const target = held ? -4 : details.open ? -2 : 0;
      const spring = target < stroke.x ? PRESS : RELEASE;
      if (reducedMotion() || summary.matches(':focus-visible')) stroke.snap(target);
      else stroke.to(target, spring.k, spring.c);
      live.invalidate();
    };
    button.plain(summary, on, {
      momentary: true,
      push() {
        held = true;
        stroke.x = Math.min(stroke.x, details.open ? -3 : -1);
        seat();
      },
      lift() { held = false; seat(); },
    });
    on.watch(details, { attributes: true, attributeFilter: ['open'] }, seat);
    return on.done;
  },

  plain(el, on) {
    return button.plain(el.parentElement, on, { momentary: true });
  },
};
