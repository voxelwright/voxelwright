// The Signal Desk's turned brass dimmer. Both the index and the knurl are cut
// into the stock, so they share its axle and cast one silhouette.
import { defineLook, MATERIALS } from '../src/index.js';
import { rotary } from '../src/components/rotary.js';

function build(live, model) {
  const cx = live.W / 2, cy = live.H / 2;
  const radius = Math.floor(Math.min(cx, cy)) - 5;
  const collar = model.part('collar'), drum = model.part('drum');
  drum.tx = cx;
  drum.ty = cy;
  drum.axle = { x: 0, y: 0, angle: 0 };
  drum.mouldRadius = 2;
  for (let y = -radius; y < radius; y++) {
    for (let x = -radius; x < radius; x++) {
      const dx = x + .5, dy = y + .5;
      const r = Math.hypot(dx, dy);
      if (r > radius) continue;
      if (r <= radius - 3) collar.box(x + cx, y + cy, 0, 1, 1, 2, 'gasket');
      if (r <= radius - 5) collar.box(x + cx, y + cy, 2, 1, 1, 2, 'steel');
      // Straight flutes stop under the polished shoulder. One dark enamel
      // inlay continues over the rim so the setting reads from the side.
      const groove = r > radius - 1.5 && Math.cos(20 * Math.atan2(dx, -dy)) < -.25;
      if (!groove) drum.box(x, y, 4, 1, 1, 6, 'warm-metal');
      const index = dy < -radius * .33 && Math.abs(dx) < 1.5;
      const metal = index ? 'gasket' : 'spun-brass';
      drum.plot(x, y, 10, metal);
      if (r <= radius - 1) drum.plot(x, y, 11, metal);
      if (r <= radius - 3) drum.plot(x, y, 12, metal);
    }
  }
  live.faceZ = 13;
}

// The lathe cuts circular grooves. Their outer walls tip the local normal
// radially, giving the crown a directional reflection under the room light.
function pose(live) {
  const drum = live.model.byName.drum;
  if (!drum.brushed) {
    for (let i = 0; i < drum.count; i++) {
      if (!drum.flat[i] || drum.mats[i] !== MATERIALS['spun-brass'].id) continue;
      const x = drum.rest[3 * i], y = drum.rest[3 * i + 1];
      const r = Math.hypot(x, y);
      drum.normals.set([Math.round(55 * x / r), Math.round(55 * y / r), 114, 100], 4 * i);
    }
    drum.brushed = true;
  }
  rotary.pose(live);
}

defineLook('desk-dimmer', {
  from: 'lit',
  quiet: false,
  seam: .12,
  finishes: {
    'spun-brass': { chamfer: 12, specular: 95 },
    'warm-metal': { chamfer: 36, specular: 105 },
    gasket: { chamfer: 10, specular: 4 },
  },
  materials: {
    'spun-brass': { day: '#dcb779', night: '#d7b274', jitter: .002,
      grain: (x, y) => .006 * Math.cos(2.6 * Math.hypot(x + .5, y + .5)) },
    'warm-metal': { day: '#8d6836', night: '#886636', jitter: .003 },
    gasket: { day: '#292521', night: '#24231f', jitter: .002 },
  },
  parts: { rotary: { build, pose } },
});
