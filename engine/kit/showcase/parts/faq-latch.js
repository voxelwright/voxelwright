// A sprung disclosure key at the left of each FAQ legend. The reading plate
// stays still. A separate lens in the mount shows which answer is exposed.
import { cue } from '../../src/core/sound.js';
import { halo } from '../../src/core/light.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';
import { listeners } from '../../src/components/util.js';

function depth(live) {
  if (live.state.held) return -3;
  return live.el.closest('details').open ? -2 : 0;
}

export const faqLatch = {
  name: 'faq-latch',
  selector: '#faq > details > summary > .faq-latch',
  pad: 6,
  glowRadius: 1.6,
  glowStrength: halo(.08),

  build(live, model) {
    // A 24 × 14 cell mounting plate. The key's skirt clears the metal lip
    // for its whole three-course stroke and bottoms on the gasket.
    const plate = model.part('mount');
    plate.slab(0, 0, 0, 24, 14, 2, 'warm-metal', 1);
    plate.carve(2, 2, 1, 15, 10, 1);
    plate.box(2, 2, 0, 15, 10, 1, 'gasket');
    plate.carve(6, 4, 0, 5, 4, 1);
    // The narrow stem slides through a guide in the floor of the seat.
    const skirt = model.part('skirt');
    skirt.box(6, 4, 0, 5, 4, 4, 'gasket');
    skirt.slab(3, 2, 4, 12, 8, 2, 'key', 1);
    const legend = live.el.closest('[data-caps]')?.dataset.caps === 'carbon' ? 'ivory' : 'gasket';
    for (const open of [false, true]) {
      const face = model.part(open ? 'down' : 'right');
      face.slab(3, 2, 6, 11, 7, 1, 'key', 1);
      for (let i = -2; i <= 2; i++) {
        const reach = 1 - Math.abs(i);
        face.plot(8 + (open ? i : reach), 5 + (open ? reach : i), 6, legend);
      }
    }

    plate.box(18, 4, 2, 4, 6, 1, 'gasket');
    model.part('glass').box(19, 5, 3, 2, 4, 1, 'lens');
    const diffuser = model.part('diffuser');
    diffuser.box(19, 5, 3, 2, 4, 1, 'light-warm');
    diffuser.box(19, 6, 3, 2, 2, 1, 'lamp');
    live.spring('stem').snap(depth(live));
  },

  pose(live) {
    const { skirt, right, down, glass, diffuser } = live.model.byName;
    const open = live.el.closest('details').open;
    skirt.tz = right.tz = down.tz = live.spring('stem').x;
    right.hidden = open;
    down.hidden = !open;
    glass.hidden = open;
    diffuser.hidden = !open;
  },

  bind(live) {
    const summary = live.el.parentElement, row = summary.parentElement;
    const on = listeners();
    const move = () => {
      const stem = live.spring('stem'), target = depth(live);
      const spring = target < stem.x ? PRESS : RELEASE;
      if (reducedMotion() || summary.matches(':focus-visible')) stem.snap(target);
      else stem.to(target, spring.k, spring.c);
      live.invalidate();
    };
    let owner = null;
    const down = source => {
      if (owner !== null) return;
      owner = source;
      live.state.held = true;
      move();
      cue('press');
    };
    const up = source => {
      if (owner !== source || owner === null) return;
      owner = null;
      live.state.held = false;
      move();
      cue('release');
    };
    on(summary, 'pointerdown', e => { if (e.isPrimary && e.button === 0) down(e.pointerId); });
    on(window, 'pointerup', e => up(e.pointerId));
    on(window, 'pointercancel', e => up(e.pointerId));
    on(summary, 'keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.repeat) e.preventDefault();
      else down(e.key);
    });
    on(summary, 'keyup', e => up(e.key));
    on(summary, 'blur', () => up(owner));
    on(window, 'blur', () => up(owner));
    on(row, 'toggle', move);
    return on.done;
  },
};
