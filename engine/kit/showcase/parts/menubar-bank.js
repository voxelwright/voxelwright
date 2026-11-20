// One fitted program bank. Each menu retains its native trigger and popover.
import { menubar } from '../../src/components/menubar.js';
import { boxOf } from '../../src/components/navs.js';
import { button } from '../../src/components/button.js';
import { listeners } from '../../src/components/util.js';
import { cap, halo } from '../../src/core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';

const keys = el => el.querySelectorAll(':scope > li > [popovertarget]');
const open = key => key.getAttribute('aria-expanded') === 'true';

export const programBank = {
  ...menubar,
  name: 'program-bank',
  selector: '.program-bank',
  glowRadius: 1.4,
  glowStrength: halo(.08),

  build(live, model) {
    const { W, H } = live;
    const rail = model.part('mount');
    rail.slab(0, 0, 0, W, H, 2, 'slate', 1);
    for (const x of [1, W - 2]) {
      rail.plot(x, Math.floor(H / 2), 1, 'warm-metal');
    }
    const fit = model.part('sockets');
    for (const key of keys(live.el)) {
      const [x, y, w, h] = boxOf(live, key);
      const face = model.part(key.id);
      const capHeight = live.look.travel > 2 ? 3 : 2;
      rail.carve(x, y, 1, w - 1, h - 4, 1);
      fit.slab(x, y, 1, w - 1, h - 4, 1, 'gasket', 1)
        .carve(x + 1, y + 1, 1, w - 3, h - 6, 1);
      cap(face, x + 1, y + 1, 1, w - 3, h - 6, capHeight, 'key');
      live.label(key.firstElementChild, () => face.tz + 1);
      // Fixed smoked window in the lower rail, lit from inside the aperture.
      const width = Math.max(3, Math.floor(w / 3));
      const left = x + Math.floor((w - width) / 2), front = y + h - 2;
      rail.carve(left, front, 0, width, 1, 2);
      fit.box(left, front, 1, width, 1, 1, open(key) ? 'signal' : 'lens');
    }
  },

  pose(live) {
    for (const key of keys(live.el)) {
      const stroke = live.spring(key.id).x;
      live.model.byName[key.id].tz = Math.max(-2, Math.min(0, open(key) ? Math.min(-1, stroke) : stroke));
    }
  },

  bind(live) {
    const unwire = menubar.bind(live);
    const on = listeners();
    for (const key of keys(live.el)) {
      const move = (depth, settings) => {
        const spring = live.spring(key.id);
        if (reducedMotion()) spring.snap(depth);
        else spring.to(depth, settings.k, settings.c);
        live.invalidate();
      };
      button.plain(key, on, { momentary: true, push: () => move(-2, PRESS), lift: () => move(0, RELEASE) });
    }
    return () => { on.done(); unwire(); };
  },

  plain(el, on) {
    menubar.plain(el, on);
    for (const key of keys(el)) button.plain(key, on, { momentary: true });
  },
};
