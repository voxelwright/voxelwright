// A five-window progress ladder fitted only to the lab's determinate readout.
import { define, defineLook, listeners } from '../src/index.js';
import { inlineX, watchDirection } from '../src/plain.js';

defineLook('lab-ladder', {
  seam: .28,
  materials: {
    steel: { day: '#585e63', night: '#656c75', jitter: .015 },
    gasket: { day: '#252b2d', night: '#202526' },
    lens: { day: '#777e78', night: '#747a76' },
    ivory: { day: '#d4ceba', night: '#c1bca9' },
    'light-go': { day: '#a6ffd1', night: '#94efbb', glow: 1 },
    slate: { day: '#9baba2', night: '#95a69e', jitter: .006 },
  },
  finishes: {
    steel: { chamfer: 80, specular: 76 },
    lens: { chamfer: 100, specular: 52 },
  },
  light: { day: { glow: .6 } },
});

function followReading(el, on, redraw) {
  const progress = el.querySelector('progress');
  const count = el.nextElementSibling;
  function update() {
    const determinate = progress.position >= 0;
    count.textContent = determinate ? `${progress.value} / ${progress.max}` : '…';
    if (determinate) progress.setAttribute('aria-valuetext', `${progress.value} of ${progress.max}`);
    else progress.removeAttribute('aria-valuetext');
    redraw?.();
  }
  update();
  on.watch(progress, { attributes: true, attributeFilter: ['value', 'max'] }, update);
}

define({
  name: 'lab-ladder', selector: '#lab-meter', pad: 4, glowRadius: 1.5, glowStrength: .24,
  plain: followReading,
  bind(live) {
    const on = listeners();
    watchDirection(live, on);
    followReading(live.el, on, () => live.invalidate());
    return on.done;
  },
  build(live, model) {
    const x = inlineX(live);
    const housing = model.part('housing');
    housing.slab(0, 0, 0, 80, 12, 3, 'steel', 2);
    // The moulded insert fits under a single metal lip. Its webs block light
    // between adjacent windows. The pale inlay marks full scale even at zero.
    housing.box(x(3, 72), 2, 2, 72, 8, 1, 'gasket');
    housing.box(x(77), 3, 2, 1, 6, 1, 'ivory');
    for (let i = 0; i < 5; i++) {
      const left = x(5 + i * 14, 12);
      housing.carve(left, 3, 1, 12, 6, 2);
      const lens = model.part('lens' + i);
      lens.box(left, 3, 1, 12, 6, 1, 'lens');
      lens.slab(left, 3, 2, 12, 6, 1, 'lens', 1);
      lens.box(left + 1, 3, 2, 10, 1, 1, 'slate');
      // A short die bonded under the window. Its centre line determines the
      // falloff on the diffusing surface above it.
      lens.carve(left + 3, 5, 1, 6, 2, 1);
      model.part('die' + i).box(left + 3, 5, 1, 6, 2, 1, 'light-go');
      lens.sourceX = left + 6;
    }
    live.faceZ = 3;
    live.state.level = undefined;
  },
  pose(live) {
    const level = 5 * live.el.querySelector('progress').position;
    if (level === live.state.level && live.tintRevision === live.state.tint) return;
    live.state.level = level;
    live.state.tint = live.tintRevision;
    for (let i = 0; i < 5; i++) {
      const lens = live.model.byName['lens' + i];
      lens.tint(live.theme, live.look);
      const power = Math.min(1, Math.max(0, level - i));
      const die = live.model.byName['die' + i];
      die.tint(live.theme, live.look);
      for (let n = 0; n < die.count; n++) die.col[n * 4 + 3] *= power;
      if (!power) continue;
      // A short LED bar scatters through frosted resin. Leave the shoulders
      // less saturated so the optical edge survives at full brightness.
      for (let n = 0; n < lens.count; n++) {
        const x = lens.rest[n * 3], y = lens.rest[n * 3 + 1];
        const dx = Math.max(0, Math.abs(x - lens.sourceX) - 2.5);
        const scatter = 1 / (1 + .09 * dx * dx + .23 * (y - 6) ** 2);
        // The frost passes more green at its edges; the centre takes the
        // die's full colour. Both follow the emitter's day/night temperature.
        const tint = [
          die.col[0] * (.25 + .75 * scatter),
          die.col[1] * (.78 + .22 * scatter),
          die.col[2] * (.54 + .46 * scatter),
        ];
        for (let c = 0; c < 3; c++) {
          const k = n * 4 + c;
          lens.col[k] += (tint[c] - lens.col[k]) * power;
        }
        lens.col[n * 4 + 3] = power * (.35 + .9 * scatter);
      }
    }
    live.glows = level > 0;
  },
});
