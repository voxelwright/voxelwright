// The query window and its result tray share a casting and a smoked index channel.
// The combobox component owns placement, native input, selection and the tray's rim motion.
import { defineLook, LOOKS } from '../../src/core/look.js';
import { halo } from '../../src/core/light.js';
import { cue } from '../../src/core/sound.js';
import { live as liveFor } from '../../src/index.js';

const side = (el, width, inset) => getComputedStyle(el).direction === 'rtl' ? width - inset - 1 : inset;

defineLook('project-register', {
  from: 'lit',
  float: 3,
  seam: .32,
  materials: {
    slate: { day: '#46534e', night: '#37423e', jitter: .007 },
    steel: { day: '#a29679', night: '#95896e', jitter: .009 },
    gasket: { day: '#262e29', night: '#202823' },
    floor: { day: '#25352f', night: '#22302b', jitter: .003 },
    panel: { day: '#e2e2cf', night: '#d4d9c5', jitter: .003 },
    lens: { day: '#65533b', night: '#60503b' },
    'light-warm': { day: '#d79850', night: '#be864b', glow: .17, transmission: .12 },
    light: { day: '#ffc265', night: '#ffc265', glow: .78 },
  },
  finishes: { ...LOOKS.lit.finishes, floor: { chamfer: 0, specular: 30 }, panel: { chamfer: 12 } },
  parts: {
    field: {
      build(live, model) {
        const { W, H, el } = live;
        const rtl = getComputedStyle(el).direction === 'rtl';
        const x = rtl ? 2 : 7;
        const body = model.part('housing');
        body.slab(0, 0, 0, W, H, 3, 'slate', 1);
        body.box(x, 2, 1, W - 9, H - 4, 2, 'gasket');
        body.carve(x, 2, 2, W - 9, H - 4, 1);
        body.box(x + 1, 3, 1, W - 11, H - 6, 1, 'floor');
        // A captive amber window lies on the same axis as the results cursor.
        const index = side(el, W, 3);
        body.box(index - 1, 3, 2, 3, H - 6, 1, 'gasket');
        body.box(index, 4, 2, 1, H - 8, 1, 'lens');
        const lamp = model.part('lamp');
        lamp.box(index, 4, 2, 1, H - 8, 1, 'light-warm');
        lamp.box(index, 5, 2, 1, H - 10, 1, 'light');
        lamp.tz = .03;
        for (const foot of [3, W - 5]) {
          for (const edge of [0, H - 1]) body.box(foot, edge, 2, 3, 1, 1, 'steel');
        }
        live.faceZ = 3;
      },
      pose(live) {
        live.model.byName.lamp.hidden = live.el.querySelector('input').getAttribute('aria-expanded') !== 'true';
        live.glowStrength = halo(.06);
      },
    },
    combobox: {
      build(live, model) {
        const { W, H, el } = live;
        const index = side(el, W, 3);
        const body = model.part('body');
        body.slab(0, 0, 0, W, H, 3, 'slate', 1);
        body.box(1, 1, 2, W - 2, H - 2, 1, 'panel');
        body.box(index, 2, 2, 1, H - 4, 1, 'lens');
        const pick = model.part('pick');
        pick.box(index, 3, 2, 1, 5, 1, 'light');
        pick.tz = .03;

        // The shallow steel slides emerge from the edge nearest the field.
        // Both pieces stay behind the reading face and move with its rim.
        const slides = model.part('panel');
        for (const foot of [3, W - 5]) slides.box(foot + 1, -3, 0, 3, 5, 1, 'steel');
        live.faceZ = 3;
      },
      pose(live) {
        const { pick, panel } = live.model.byName;
        const at = live.state.at;
        pick.hidden = at == null;
        if (at != null) pick.ty = at;
        panel.ty = live.state.above ? live.H + 2 : 0;
        live.glowStrength = halo(.055);
      },
    },
  },
});

export function connectRegister(root) {
  const well = root.querySelector('.vx-well');
  const popup = root.querySelector('.vx-combobox-float');
  const input = root.querySelector('#use-q');
  // place() may flip a running tray when scrolling or filtering changes its space.
  let lastTop;
  const align = () => {
    const tray = liveFor(popup);
    if (!tray || !popup.matches(':popover-open') || popup.style.top === lastTop) return;
    lastTop = popup.style.top;
    tray.state.above = popup.getBoundingClientRect().top < well.getBoundingClientRect().top;
    tray.invalidate();
  };
  new MutationObserver(align).observe(popup, { attributes: true, attributeFilter: ['style'] });
  popup.addEventListener('beforetoggle', () => liveFor(well)?.invalidate());
  popup.addEventListener('toggle', () => {
    lastTop = null;
    align();
    liveFor(well)?.invalidate();
  });
  // One recorded detent when a project seats. Typing and moving the cursor stay quiet.
  input.addEventListener('vx-choose', () => cue('release'));
}
