// A captive display and its key deck are one casting. Keeping the screen,
// retaining lip and fasteners on its grid lets them share each moving brick.
import { defineLook, LOOKS } from '../../src/index.js';

function build(live, model) {
  const { W, H, vx, el } = live;
  const panel = model.part('panel');
  if (W < 12 || H < 12) return; // closed native dialogs have no layout box
  const z = live.look.dialog - 1; // upper course of the casting
  const inset = 4;
  const deck = Math.round(el.querySelector('footer').offsetTop / vx);
  const screenW = W - 2 * inset;
  const screenH = deck - inset;
  panel.slab(1, 1, 0, W - 2, H - 2, 2, 'gasket', 2);
  panel.slab(0, 0, 2, W, H, 1, 'steel', 2);
  panel.slab(0, 0, 3, W, H, z - 2, 'slate', 2);

  // Cut the top course away over the glass. Its black gasket is flush
  // with the casting and shields the edge of the illuminated surface.
  panel.box(inset, inset, z, screenW, screenH, 1, 'gasket');
  panel.carve(inset + 1, inset + 1, z, screenW - 2, screenH - 2, 1);
  panel.box(inset + 1, inset + 1, z - 1, screenW - 2, screenH - 2, 1, 'panel');
  for (const x of [2, W - 5]) for (const y of [2, H - 5]) {
    panel.slab(x, y, z, 3, 3, 1, 'steel', 1);
    panel.plot(x + 1, y + 1, z, 'gasket');
  }
  live.faceZ = z + 1;
}

defineLook('rename-display', {
  from: 'lit',
  tooling: 'rename-display', // use the field’s fixed bezel and short focus lens
  well: 2,
  materials: {
    slate: { day: '#393e40', night: '#34393c', jitter: .012 },
    steel: { day: '#989d99', night: '#989d99' },
    gasket: { day: '#151a1c', night: '#13171a' },
    panel: { day: '#19363a', night: '#173338', glow: .045 },
    floor: { day: '#bbdcd5', night: '#a6cbc4' },
    light: { day: '#71c9bb', night: '#71c9bb', glow: .45 },
  },
  finishes: {
    ...LOOKS.lit.finishes,
    slate: { chamfer: 45, specular: 48 },
    panel: { chamfer: 0, specular: 30 },
    steel: { chamfer: 100, specular: 140 },
  },
  parts: { dialog: { build } },
});
