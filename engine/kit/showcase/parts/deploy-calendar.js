// The deployment scheduler has a fixed reading plate and two short-travel month keys.
// Date navigation and input still belong to the kit calendar.
import { behave } from '../../src/plain.js';
import { defineLook, hole, ring, halo } from '../../src/index.js';

const graphite = { day: '#343d39', night: '#303936', jitter: .006 };
const paper = { day: '#f1ead8', night: '#f1ead8', jitter: .002 };

defineLook('deploy-calendar', {
  from: 'lit',
  materials: {
    key: graphite, floor: paper, slate: graphite,
    gasket: { day: '#252d29', night: '#242a27' },
    steel: { day: '#948a78', night: '#928978' },
    lens: { day: '#c8beab', night: '#c8beab', jitter: .002 },
    'light-warm': { day: '#ffb93f', night: '#ffc461', glow: 1.8 },
  },
  parts: {
    button: {
      build(live, model) {
        const { W, H, el } = live;
        const off = el.matches('[aria-disabled="true"]');
        const w = W - 4, h = H - 5;
        const seat = model.part('seat');
        seat.slab(1, 2, 0, w + 2, h + 2, 1, 'gasket', 1);
        const cap = model.part('cap');
        cap.grounded = false;
        const base = off ? 1 : 3;
        if (!off) {
          seat.carve(3, 4, 0, w - 2, h - 2, 1);
          cap.box(3, 4, 1, w - 2, h - 2, 2, 'slate');
        }
        cap.slab(2, 3, base, w, h, 1, 'key', 1);
        cap.slab(2, 3, base + 1, w, h - 1, 1, 'key', 1);
        live.state.off = off;
        live.state.top = base + 2;
        live.faceZ = 5;
        model.keyTravel = 2;
        live.label(el.querySelector('.vx-label'), () => live.state.top + cap.tz);
      },
      pose(live) {
        live.model.byName.cap.tz = live.state.off ? 0 : live.spring('press').x;
      },
    },
    'calendar-week': {
      build(live, model) {
        const { el, vx, H } = live;
        const block = model.part('block');
        block.grounded = false;
        for (const cell of el.querySelectorAll('.vx-calendar-cell')) {
          const x = Math.round(cell.offsetLeft / vx);
          const w = Math.round(cell.offsetWidth / vx);
          const button = cell.firstElementChild;
          const selected = cell.getAttribute('aria-selected') === 'true';
          if (selected) {
            hole(live, model, { x: x + 1, y: 1, w: w - 2, h: H - 2, depth: 2 });
            block.slab(x + 1, 1, -1, w - 2, H - 2, 1, 'key', 1);
          }
          const center = x + Math.floor(w / 2);
          if (button.getAttribute('aria-current') === 'date') {
            const z = selected ? -1 : 0;
            const lamp = model.part('lamp');
            lamp.box(center - 1, H - 2, z, 3, 1, 1, 'warm-metal');
            lamp.plot(center, H - 2, z, 'light-warm');
          }
        }
      },
      pose(live) { live.glowRadius = 1.5; live.glowStrength = halo(.065); },
    },
  },
});

export const deployPlate = {
  name: 'deploy-calendar-plate',
  selector: '#deploy.vx-calendar',
  pad: 3,
  plain(el) {
    for (const key of el.querySelectorAll('.vx-calendar-head .vx-button')) behave(key, false);
  },
  build(live, model) {
    const { W, H, el, vx } = live;
    const head = el.querySelector('.vx-calendar-head');
    if (!head) return;
    const header = Math.round((head.offsetTop + head.offsetHeight) / vx);
    const plate = model.part('plate');
    ring(plate, 0, 0, 0, W, H, 'steel', 1);
    plate.box(1, 1, 0, W - 2, header - 1, 1, 'gasket');
    plate.box(1, header, 0, W - 2, H - header - 1, 1, 'floor');
    // Press the unlit lenses into the same face as the date field, so only
    // the case edge casts a shadow. The week model overlays the current lamp.
    const origin = el.getBoundingClientRect();
    for (const cell of el.querySelectorAll('.vx-calendar-cell')) {
      const rect = cell.getBoundingClientRect();
      const x = Math.floor((rect.left + rect.width / 2 - origin.left) / vx);
      const y = Math.round((rect.bottom - origin.top) / vx) - 2;
      plate.plot(x, y, 0, 'lens');
    }
    live.faceZ = 1;
  },
};
