// A reciprocating light behind five fixed windows. Only the optical output changes.
import { halo } from '../../src/core/light.js';
import { MATERIALS } from '../../src/core/materials.js';
import { tableOf } from '../../src/core/look.js';
import { reducedMotion } from '../../src/core/motion.js';
import { listeners } from '../../src/components/util.js';

export const buildActivity = {
  name: 'build-activity',
  selector: '#spin',
  pad: 3,
  glowRadius: 1.4,
  glowStrength: halo(.045),

  build(live, model) {
    const carrier = model.part('carrier');
    carrier.slab(0, 0, 0, 16, 4, 1, 'gasket', 1);
    const rim = model.part('rim');
    rim.slab(0, 0, 1, 16, 4, 1, 'steel', 1);
    const lenses = model.part('lenses');
    for (let x = 1; x < 15; x += 3) {
      rim.carve(x, 1, 1, 2, 2, 1);
      lenses.box(x, 1, 1, 2, 2, 1, 'lens');
    }
    live.faceZ = 2;
  },

  pose(live) {
    const lenses = live.model.byName.lenses;
    const palette = tableOf(live.look);
    const smoked = palette[MATERIALS.lens.id][live.theme];
    const backing = palette[MATERIALS.gasket.id][live.theme];
    const lamp = palette[MATERIALS.light.id][live.theme];
    const busy = !live.el.parentElement.hasAttribute('data-done');
    // Sweep there and back: no filling bar or implied fraction complete.
    const head = reducedMotion() ? 2 : 2 - 2 * Math.cos(performance.now() * Math.PI / 850);
    for (let i = 0; i < lenses.count; i++) {
      const seat = Math.floor((lenses.rest[i * 3] - 1) / 3);
      const power = busy ? Math.max(0, 1 - Math.abs(head - seat) / 1.5) : 0;
      // The upper facet catches the brightest core, the lower row scatters it.
      const core = lenses.rest[i * 3 + 1] < 2 ? 1 : .72;
      for (let c = 0; c < 3; c++) {
        const unlit = .54 * smoked[c] + .46 * backing[c];
        const opal = lamp[c] + (1 - lamp[c]) * (.28 + .38 * power * core);
        lenses.col[i * 4 + c] = unlit + (opal - unlit) * power * core;
      }
      lenses.col[i * 4 + 3] = power * core;
    }
    live.glows = busy;
  },

  step(live) {
    if (!live.visible) live.dirty = true;
    return live.visible && live.el.isConnected && !live.el.parentElement.hasAttribute('data-done') && !reducedMotion();
  },

  bind(live) {
    const on = listeners();
    on.watch(live.el.parentElement, { attributes: true, attributeFilter: ['data-done'] }, () => live.invalidate());
    on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', () => live.invalidate());
    return on.done;
  },
};
