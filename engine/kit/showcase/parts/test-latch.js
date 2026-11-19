// The test interlock has a captive stem and a smoked, backprinted window.
// All distances are cells of the specimen's 1 px grid.
import { halo } from '../../src/core/light.js';
import { defineMaterial } from '../../src/core/materials.js';
import { PRESS, RELEASE, reducedMotion } from '../../src/core/motion.js';
import { cue } from '../../src/core/sound.js';
import { listeners, watchFieldsets } from '../../src/components/util.js';

defineMaterial('test-latch-core', { day: '#b5ffcf', night: '#9cf5bc', glow: 1, jitter: 0 });
defineMaterial('test-latch-diffuser', { day: '#63d48c', night: '#55ce82', glow: .55, jitter: .005 });
defineMaterial('test-latch-glass-edge', { day: '#405c4c', night: '#354d40', jitter: .006 });

const latched = -5, stop = -7;
const rest = input => input.indeterminate ? latched / 2 : input.checked ? latched : 0;

export const testLatch = {
  name: 'test-latch',
  selector: '#tests + .test-latch',
  pad: 15,
  glowRadius: 2,
  glowStrength: halo(.017),

  build(live, model) {
    const socket = model.part('socket');
    // A thin steel lip, black liner and a central bore for the stem.
    socket.slab(-2, -2, 0, 32, 32, 3, 'steel', 3)
      .carve(0, 0, 0, 28, 28, 3)
      .slab(0, 0, 0, 28, 28, 2, 'gasket', 1)
      .carve(2, 2, 1, 24, 24, 1)
      .carve(10, 10, 0, 8, 8, 2);
    const cap = model.part('cap');
    cap.grounded = false;
    cap.box(10, 10, 0, 8, 8, 8, 'steel')
      .slab(2, 2, 8, 24, 24, 3, 'key', 2)
      .slab(3, 3, 11, 22, 22, 1, 'key', 2);
    // The dark pane stays bonded into the cap. Power travels through only the
    // clear check-shaped stencil. The opaque shoulder retains the cap finish.
    cap.carve(5, 6, 11, 18, 16, 1);
    const disabled = live.el.previousElementSibling.matches(':disabled');
    const core = disabled ? 'steel' : 'test-latch-core';
    const diffuser = disabled ? 'test-latch-glass-edge' : 'test-latch-diffuser';
    for (const name of ['glass', 'tick', 'bar']) {
      const pane = model.part(name);
      pane.grounded = false;
      pane.box(5, 6, 11, 18, 16, 1, 'key-plate');
      if (name === 'tick') {
        for (let x = 7; x <= 20; x++) {
          const y = 15 - Math.abs(x - 12);
          pane.box(x, y - 1, 11, 1, 6, 1, 'test-latch-glass-edge')
            .box(x, y, 11, 1, 4, 1, diffuser)
            .box(x, y + 1, 11, 1, 2, 1, core);
        }
      } else if (name === 'bar') pane.box(9, 13, 11, 10, 2, 1, core);
    }
    live.faceZ = 3;
    live.spring('height').snap(rest(live.el.previousElementSibling));
  },

  pose(live) {
    const { cap, glass, tick, bar } = live.model.byName;
    const input = live.el.previousElementSibling;
    const z = Math.max(stop, Math.min(0, live.spring('height').x));
    cap.tz = glass.tz = tick.tz = bar.tz = z;
    glass.hidden = input.indeterminate || input.checked;
    tick.hidden = input.indeterminate || !input.checked;
    bar.hidden = !input.indeterminate;
  },

  bind(live) {
    const input = live.el.previousElementSibling, label = input.closest('label');
    const on = listeners();
    let held = null;
    function move(to, instant = false) {
      const spring = live.spring('height');
      if (instant || reducedMotion()) spring.snap(to);
      else {
        const { k, c } = to < spring.x ? PRESS : RELEASE;
        spring.to(to, k, c);
      }
      live.invalidate();
    }
    function down(source) {
      if (held !== null || input.matches(':disabled')) return;
      held = source;
      move(stop, source === 'Space');
      cue('press');
    }
    function up(source) {
      if (held !== source) return;
      held = null;
      move(rest(input), source === 'Space');
      cue('release');
    }
    on(label, 'pointerdown', e => { if (e.button === 0 && e.isPrimary) down(e.pointerId); });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave'])
      on(label, event, e => up(e.pointerId));
    on(input, 'keydown', e => { if (e.key === ' ' && !e.repeat) down('Space'); });
    on(input, 'keyup', e => { if (e.key === ' ') up('Space'); });
    on(input, 'blur', () => up('Space'));
    on(window, 'blur', () => { if (held !== null) up(held); });
    on(input, 'change', () => move(rest(input), input.matches(':focus-visible')));
    on(input.ownerDocument, 'reset', e => {
      if (e.target === input.form) setTimeout(() => { if (!e.defaultPrevented && live.el.isConnected) move(rest(input), true); });
    }, true);
    function availability() {
      if (input.matches(':disabled')) held = null;
      live.rebuild();
    }
    on.watch(input, { attributes: true, attributeFilter: ['disabled'] }, availability);
    watchFieldsets(input, on, availability);
    for (const prop of ['checked', 'indeterminate'])
      on.heed(input, prop, () => move(held === null ? rest(input) : stop, true));
    return on.done;
  },
};
