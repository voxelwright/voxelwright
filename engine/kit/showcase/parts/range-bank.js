// Three interlocked mode keys in one oxblood faceplate. The existing radio
// group owns input, selection and springs; this look supplies its moving solids.
import '../../src/looks/lit.js';
import { defineInstrumentLook } from '../build-settings.js';
import { clamp } from '../../src/components/util.js';

const face = { chamfer: 38, specular: 16 };
defineInstrumentLook('range-bank', {
  travel: 3,
  step: 2,
  seam: .25,
  materials: {
    steel: { day: '#754147', night: '#784850', jitter: .008 },
    gasket: { day: '#201d20', night: '#241f21' },
    lens: { day: '#6a5f54', night: '#615953' },
  },
  finishes: { steel: { chamfer: 75, specular: 76 }, gasket: face,
    lens: { chamfer: 105, specular: 106 } },
  parts: { 'toggle-group': { build, pose, recordedReturn: true, instantKeyboardChoice: true } },
});

function build(live, model) {
  const { W, H, vx, el, state } = live;
  const seats = state.seats = [...el.querySelectorAll(':scope > label')];
  state.inputs = seats.map(seat => seat.querySelector('input'));
  live.faceZ = 4;
  live.well = [-2, -2, W + 2, H + 2];
  const plate = model.part('plate');
  plate.slab(-2, -2, 0, W + 4, H + 4, 4, 'steel', 2);
  state.at = [];
  state.caps = seats.map((seat, i) => {
    const x = Math.round(seat.offsetLeft / vx);
    const w = Math.round((seat.offsetLeft + seat.offsetWidth) / vx) - x;
    state.at.push([x, 0, w, H]);
    // The plate captures each moving skirt through its entire stroke.
    plate.carve(x + 1, 4, 0, w - 2, H - 5, 4);
    const bed = model.part('bed' + i);
    bed.sunk = true;
    bed.box(x, 3, -3, w, H - 3, 3, 'gasket')
      .carve(x + 1, 4, -3, w - 2, H - 5, 3);
    const stemX = Math.floor(w / 2) - 3, stemY = Math.floor(H / 2);
    bed.box(x, 3, -5, w, H - 3, 2, 'gasket')
      .carve(x + stemX + 1, stemY + 1, -5, 5, 5, 2);

    const cap = model.part('cap' + i);
    cap.grounded = false;
    cap.tx = x + 1;
    cap.ty = 1;
    cap.mouldRadius = 2;
    cap.box(stemX, stemY, -5, 5, 5, 7, 'gasket');
    const width = w - 4;
    cap.slab(1, 4, 2, width, H - 7, 4, 'key', 2);
    cap.slab(2, 5, 6, width - 2, H - 9, 1, 'key', 2);
    cap.slab(3, 6, 7, width - 4, H - 11, 1, 'key', 2);
    // A shallow cylindrical dish: the two cheeks are a course higher.
    for (const end of [3, width - 3]) cap.slab(end, 7, 8, 2, H - 13, 1, 'key', 1);

    const left = x + Math.floor(w / 2) - 4;
    plate.carve(left - 1, -1, 2, 10, 4, 2);
    model.part('collar' + i).box(left - 1, -1, 2, 10, 4, 2, 'gasket')
      .carve(left, 0, 3, 8, 2, 1);
    model.part('lens' + i).box(left, 0, 3, 8, 2, 1, 'lens');
    live.spring('on' + i).snap(+state.inputs[i].checked);
    live.spring('hold' + i, 0);
    live.label(seat.querySelector('.vx-label'), () => 8 + cap.tz);
    return cap;
  });
  state.index = state.inputs.findIndex(input => input.checked);
  state.lamps = [];
}

function pose(live) {
  const { state, model, look } = live;
  state.caps.forEach((cap, i) => {
    const latch = live.spring('on' + i).x;
    const hold = live.spring('hold' + i).x;
    cap.tz = clamp(-look.travel * latch + hold, -look.travel - look.step, .35);

    const lit = state.inputs[i].matches(':disabled') ? 0 : clamp(latch, 0, 1);
    if (state.lamps[i] === lit && state.tint === live.tintRevision) return;
    state.lamps[i] = lit;
    // Two amber dies behind a fixed smoked bar. Its rubber seal picks up
    // only the reflected light along the aperture and never emits.
    const lens = model.byName['lens' + i], collar = model.byName['collar' + i];
    lens.tint(live.theme, look);
    collar.tint(live.theme, look);
    if (!lit) return;
    const [seatX, , width] = state.at[i];
    const left = seatX + Math.floor(width / 2) - 3.5;
    for (const part of [lens, collar]) {
      for (let j = 0; j < part.count; j++) {
        const x = part.rest[j * 3] - left, y = part.rest[j * 3 + 1] - 1;
        const distance = Math.hypot(Math.min(Math.abs(x - 2), Math.abs(x - 5)), y);
        const glass = part === lens;
        const power = lit * (glass ? .98 : .24) / (1 + .09 * distance ** 2);
        for (const [channel, amber] of [1, .69, .26].entries()) {
          const n = j * 4 + channel;
          part.col[n] += (amber - part.col[n]) * power;
        }
        if (glass) part.col[j * 4 + 3] = power;
      }
    }
  });
  state.tint = live.tintRevision;
  live.glows = state.lamps.some(Boolean);
  live.glowStrength = .012;
  live.glowRadius = 1.4;
}
