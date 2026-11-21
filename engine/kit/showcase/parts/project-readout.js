// A panel-mounted light pipe for the project list. Its ferrule grips the two
// ends of the smoked window. Only the source down its centre changes state.
import { wrapLabel } from '../../src/components/util.js';
import { MATERIALS } from '../../src/core/materials.js';
import { tableOf } from '../../src/core/look.js';
import { inlineX } from '../../src/plain.js';

export function buildProjectReadout(live, model) {
  const { el, vx } = live;
  const socket = model.part('socket');
  const lens = model.part('lens');
  const diode = model.part('diode');
  const x = inlineX(live)(2, 6);
  live.faceZ = 2;
  live.glowRadius = 2.4;
  live.state.emitter = null;
  live.state.litRevision = -1;
  const rows = live.state.rows = [];
  for (const li of el.querySelectorAll(':scope > li')) {
    wrapLabel(li, 'vx-row');
    const y = Math.round((li.offsetTop + li.offsetHeight / 2) / vx) - 6;
    const current = li.getAttribute('aria-current') === 'true';
    rows.push({ li, current, press: live.spring('row' + rows.length) });

    socket.slab(x, y, 0, 6, 12, 1, 'gasket', 1)
      .carve(x + 2, y + 3, 0, 2, 6, 1);
    socket.slab(x, y, 1, 6, 12, 1, 'steel', 1)
      .carve(x + 1, y + 1, 1, 4, 10, 1);
    lens.slab(x + 1, y + 1, 1, 4, 10, 1, 'lens', 1);
    diode.box(x + 2, y + 3, 0, 2, 6, 1, current ? 'light' : 'slate');
    if (current) live.state.emitter = { x: x + 2, y: y + 3 };
  }
}

// The die is one course below the window. Resin spreads its light to the
// ends, the ferrule catches a smaller reflection, and the gasket stays dark.
export function lightProjectReadout(live) {
  const { emitter } = live.state;
  if (!emitter || live.state.litRevision === live.tintRevision) return;
  live.state.litRevision = live.tintRevision;
  const { lens, socket } = live.model.byName;
  const light = tableOf(live.look)[MATERIALS.light.id];
  const rgb = light[live.theme];
  for (const part of [lens, socket]) {
    for (let i = 0; i < part.count; i++) {
      const x = part.rest[3 * i], y = part.rest[3 * i + 1], z = part.rest[3 * i + 2];
      if (z < 1) continue;
      const dx = Math.max(emitter.x + .5 - x, 0, x - emitter.x - 1.5);
      const dy = Math.max(emitter.y + .5 - y, 0, y - emitter.y - 5.5);
      const distance = Math.hypot(dx, dy);
      if (distance > 4) continue;
      const amount = (part === lens ? .96 : .24) / (1 + .58 * distance * distance);
      for (let c = 0; c < 3; c++) {
        const j = 4 * i + c;
        part.col[j] += (rgb[c] - part.col[j]) * amount;
      }
      if (part === lens) part.col[4 * i + 3] = amount * light.glow;
    }
  }
}
