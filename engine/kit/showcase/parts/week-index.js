// The window and keys use the configured instrument. Only its position strip has this tooling.
import { defineLook, hole, halo } from '../../src/index.js';
import { lookOf, tableOf } from '../../src/core/look.js';
import { MATERIALS } from '../../src/core/materials.js';

defineLook('week-index', {
  from: 'lit',
  parts: {
    carousel: {
      glowRadius: 1.6,
      glowStrength: halo(.075),

      build(live, model) {
        const { W, H, state } = live;
        const n = state.n = Math.max(1, state.c.count);
        const pitch = Math.floor((W - 1) / n);
        const rtl = getComputedStyle(live.el).direction === 'rtl';
        hole(live, model, { depth: 1, wall: 'steel', floor: 'gasket' });
        state.level = new Float32Array(n);
        state.level[state.c.index] = 1;
        state.lenses = Array.from({ length: n }, (_, i) => {
          const x = 1 + pitch * (rtl ? n - 1 - i : i);
          const lens = model.part('lens-' + i);
          lens.sunk = true;
          lens.box(x, 1, -1, pitch - 2, H - 2, 1, 'lens');
          lens.center = x + Math.floor((pitch - 2) / 2);
          lens.plot(lens.center, 1, -1, 'light');
          return lens;
        });
      },

      pose(live) {
        const { lenses, level } = live.state;
        const palette = tableOf(lookOf(getComputedStyle(live.el.parentElement)));
        const signal = palette[MATERIALS.light.id][live.theme];
        const smoke = palette[MATERIALS.lens.id][live.theme];
        lenses.forEach((lens, index) => {
          const power = level[index];
          if (lens.power === power && lens.revision === live.tintRevision) return;
          lens.power = power;
          lens.revision = live.tintRevision;
          lens.tint(live.theme, live.look);
          for (let i = 0; i < lens.count; i++) {
            // The die sits in the middle. The smoked ends take less of its light.
            const die = lens.mats[i] === MATERIALS.light.id;
            const distance = Math.abs(Math.floor(lens.rest[i * 3]) - lens.center);
            const light = power / (1 + .24 * distance);
            const cell = i * 4;
            for (let c = 0; c < 3; c++) {
              const dark = die ? smoke[c] : lens.col[cell + c];
              const lit = die ? .62 + .38 * signal[c] : signal[c];
              lens.col[cell + c] = dark + (lit - dark) * light;
            }
            lens.col[cell + 3] = die ? power : light * .4;
          }
        });
      },
    },
  },
});
