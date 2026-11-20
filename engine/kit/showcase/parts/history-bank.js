// The two command switches share an oxblood anodized plate. The exposed
// housings sit on its face. Only the stem, cap and printed legend travel.
import { defineInstrumentLook } from '../build-settings.js';
import { halo } from '../../src/core/light.js';

const historyKey = {
  pad: 9,
  soft: 0.28,
  build(live, model) {
    const { el, W, H } = live;
    const off = el.matches(':disabled');
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    model.keyTravel = 3;
    const guide = model.part('guide');
    guide.slab(3, 3, 0, W - 6, H - 6, 4, 'gasket', 2)
      .carve(cx - 2, cy - 2, 0, 4, 4, 4);

    const stem = model.part('stem');
    stem.box(cx - 2, cy - 2, 3, 4, 4, 4, 'slate');
    const cap = model.part('cap');
    cap.grounded = stem.grounded = false;
    cap.mouldRadius = 2;
    // Broad skirt with a single tapered shoulder. The centre of the
    // thumb surface is one course lower than its leading and trailing lips.
    cap.slab(1, 1, 7, W - 2, H - 2, 2, 'key', 2);
    cap.slab(2, 2, 9, W - 4, H - 4, 1, 'key', 2);
    cap.slab(3, 2, 10, W - 6, H - 4, 1, 'key', 1);
    for (const y of [2, H - 3]) cap.box(5, y, 11, W - 10, 1, 1, 'key');

    // A smoked availability window in a fixed metal ferrule at the back
    // of each switch. The nearby lip picks up amber only from a live lens.
    const fitting = model.part('ferrule');
    fitting.slab(7, 0, 0, 6, 3, 1, 'steel');
    fitting.box(8, 1, 0, 4, 1, 1, off ? 'lens' : 'light-warm');
    fitting.box(8, 2, 0, 4, 1, 1, off ? 'steel' : 'warm-metal');
    live.glowStrength = off ? 0 : halo(0.035);
    live.glowRadius = 1.4;
    live.faceZ = 10;
    live.state.off = off;
    live.label(el.querySelector('.vx-label'), () => 11 + cap.tz);
  },
  pose(live) {
    const { cap, stem } = live.model.byName;
    // The stop meets the switch housing. Unlocking a command lifts the
    // same moulding and exposes more of the stem.
    cap.tz = stem.tz = live.state.off ? -live.model.keyTravel :
      Math.max(-live.model.keyTravel, Math.min(0.4, live.spring('press').x));
  },
};

defineInstrumentLook('history-bank', {
  materials: {
    chalk: { day: '#793f46', night: '#723d47', jitter: 0.005 },
    gasket: { day: '#262727', night: '#222425' },
    lens: { day: '#393035', night: '#332c30' },
    steel: { day: '#594a4a', night: '#534448' },
    'light-warm': { day: '#ffba61', night: '#ffb25b', glow: 0.75 },
    'warm-metal': { day: '#a26c46', night: '#895d42' },
  },
  finishes: { chalk: { chamfer: 48, specular: 82 },
    steel: { chamfer: 80, specular: 75 }, lens: { chamfer: 42, specular: 110 } },
  parts: { button: historyKey },
});

export const historyPlate = {
  name: 'history-plate',
  selector: '#history.vx-button-group',
  pad: 5,
  build(live, model) {
    const { W, H } = live;
    model.part('foot').slab(1, 1, 0, W - 2, H - 2, 1, 'gasket', 2);
    model.part('plate').slab(0, 0, 1, W, H, 2, 'chalk', 2);
    live.faceZ = 3;
  },
};
