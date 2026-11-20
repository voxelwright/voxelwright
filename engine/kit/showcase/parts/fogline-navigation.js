// The two disclosure switches sit above the current-page strip. The other two
// destinations share the strip, but have no moving hardware.
import { button } from '../../src/components/button.js';
import { tableOf } from '../../src/core/look.js';
import { MATERIALS } from '../../src/core/materials.js';
import { listeners } from '../../src/components/util.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';
import { boxOf } from '../../src/components/navs.js';

export const pageLenses = {
  name: 'fogline-page-lenses',
  selector: '#site > ul',
  pad: 1,
  build(live, model) {
    // The navigation recipe lights the current channel on its own canvas.
    // Keep a smoked insert under each position, including the unpowered ones.
    live.state.fittings = [];
    const lens = model.part('inserts');
    lens.sunk = true;
    live.well = [0, 0, live.W, live.H];
    for (const word of live.el.querySelectorAll(':scope > li > :is(button, a)')) {
      const bounds = boxOf(live, word, true);
      if (!bounds) continue;
      const [x, y, w, h] = bounds;
      const row = y + h - 2;
      lens.box(x, row, -1, w, 1, 1, 'lens');
      const ferrules = model.part('ends-' + live.state.fittings.length);
      ferrules.sunk = true;
      ferrules.plot(x - 1, row, -1, 'steel');
      ferrules.plot(x + w, row, -1, 'steel');
      live.state.fittings.push({ word, ferrules });
    }
  },
  pose(live) {
    const rgb = tableOf(live.look)[MATERIALS.light.id][live.theme];
    for (const { word, ferrules } of live.state.fittings) {
      ferrules.tint(live.theme, live.look);
      if (!word.matches('button[data-vx-current], a[aria-current="page"]')) continue;
      // Only the metal touching the powered lens picks up its colour.
      for (let i = 0; i < ferrules.col.length; i += 4)
        for (let c = 0; c < 3; c++)
          ferrules.col[i + c] += 0.2 * (rgb[c] - ferrules.col[i + c]);
    }
  },
  bind(live) {
    const on = listeners();
    on.watch(live.el, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'data-vx-current'] }, () => live.invalidate());
    document.fonts.ready.then(() => { if (!live.destroyed) live.rebuild(); });
    return on.done;
  },
};

export const disclosureKey = {
  ...button,
  name: 'fogline-disclosure',
  selector: '#site > ul > li > button',
  momentary: true,
  pad: 3,
  plain(el, on) { return button.plain(el, on, { momentary: true }); },
  bind(live) {
    const unbind = button.bind(live);
    const on = listeners();
    const latch = live.spring('latch');
    const target = () => Number(live.el.getAttribute('aria-expanded') === 'true');
    latch.snap(target());
    on.watch(live.el, { attributes: true, attributeFilter: ['aria-expanded'] }, () => {
      const open = target();
      const spring = open ? PRESS : RELEASE;
      if (reducedMotion()) latch.snap(open);
      else latch.to(open, spring.k, spring.c);
      live.invalidate();
    });
    return () => { on.done(); unbind(); };
  },
  build(live, model) {
    const { W, H } = live;
    const rise = live.look.rise >= 6 ? 4 : 3;
    const top = rise + 2;
    // Leave the front of the hit target clear for the fixed page indicator.
    const height = H - 10;
    const mount = model.part('mount');
    mount.slab(2, 2, 0, W - 4, height + 2, 1, 'slate', 1);
    mount.slab(5, 4, 1, W - 10, height - 4, 2, 'gasket', 1);
    const pinX = Math.floor(W / 2) - 2;
    const pinY = Math.floor(height / 2);
    mount.carve(pinX, pinY, 0, 4, 4, 3);
    const cap = model.part('cap');
    cap.grounded = false;
    // An exposed skirt slides over the smaller switch housing.
    cap.slab(3, 2, 3, W - 6, height, rise - 1, 'key', 2);
    cap.carve(4, 3, 3, W - 8, height - 2, rise - 2);
    cap.slab(4, 3, top, W - 8, height - 2, 1, 'key', 1);
    cap.box(pinX, pinY, rise - 2, 4, 4, 3, 'steel');
    model.keyTravel = rise - 2;
    live.faceZ = live.state.top = top + 1;
    live.label(live.el.querySelector('.vx-label'), () => live.faceZ + cap.tz);
  },
  pose(live) {
    const press = live.spring('press').x;
    const stroke = live.model.keyTravel;
    // The switch returns from contact to its latch while the panel is open.
    const latch = -Math.min(1, Math.max(0, live.spring('latch').x));
    live.model.byName.cap.tz = Math.max(-stroke, Math.min(latch, press));
  },
};
