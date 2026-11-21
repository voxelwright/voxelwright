// A short-travel selector. A pressed-in ferrule guides the skirt and a small
// crowned light pipe carries the signal through the finger face. All dimensions are in cells.
import { MATERIALS } from '../core/materials.js';
import { tableOf } from '../core/look.js';
import { halo } from '../core/light.js';

export function pilotRadio(live, model, { off }) {
  const { W, H, look } = live;
  const radius = Math.min(W, H) / 2;
  const top = look.travel + 5;
  const socket = model.part('socket');
  const cap = model.part('cap');
  const lens = model.part('lens');
  const diode = model.part('diode');
  cap.grounded = lens.grounded = false;
  cap.mouldRadius = 2;
  const body = off ? 'steel' : 'key';

  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const r = Math.hypot(x + .5 - W / 2, y + .5 - H / 2);
    if (r > radius) continue;
    if (r > radius - 2) {
      socket.box(x, y, 0, 1, 1, 3, 'steel');
      continue;
    }
    if (r > radius - 4) {
      socket.box(x, y, 0, 1, 1, 2, 'gasket');
      continue;
    }
    // The cylindrical skirt passes through the bore at full stroke. The
    // single shoulder breaks the edge of the face without stacked bevels.
    const face = r > radius - 5 ? top - 1 : top;
    const skirt = look.travel + 1;
    // The diode is fixed to the seat, under the bore of the hollow plunger.
    if (r < 2) diode.plot(x, y, 0, 'lens');
    else socket.plot(x, y, 0, 'gasket');
    if (r > radius * .27) {
      cap.box(x, y, skirt + 1, 1, 1, face - skirt - 1, body);
      // A hollow plunger keeps the crown guided when the skirt lifts.
      if (r > radius * .39 && r < radius * .6) {
        socket.carve(x, y, 0, 1, 1, 1);
        cap.box(x, y, -1, 1, 1, skirt + 2, 'slate');
      }
    } else {
      const crown = r < radius * .21 ? 1 : 0;
      lens.box(x, y, skirt + 1, 1, 1, face + crown - skirt - 1, 'lens');
    }
  }
  live.faceZ = 3;
  live.state.off = off;
  if (off) {
    live.state.held = null;
    live.spring('press').snap(0);
  }
  live.state.tintPilot = pilotLight(live, cap, lens, diode);
}

function pilotLight(live, cap, lens, diode) {
  let revision, powered;
  return (on) => {
    if (revision === live.tintRevision && powered === on) return;
    revision = live.tintRevision;
    powered = on;
    cap.tint(live.theme, live.look);
    lens.tint(live.theme, live.look);
    diode.tint(live.theme, live.look);
    if (!on) return;
    const palette = tableOf(live.look);
    const light = palette[MATERIALS.light.id][live.theme];
    for (let i = 0; i < diode.count; i++) {
      diode.col.set(light, 4 * i);
      diode.col[4 * i + 3] = 1;
    }
    const through = live.look.materials.key?.transmission ?? 0;
    for (const part of through ? [lens, cap] : [lens]) for (let i = 0; i < part.count; i++) {
      const [x, y, z] = part.rest.subarray(3 * i, 3 * i + 3);
      const r = Math.hypot(x - live.W / 2, y - live.H / 2);
      // The face of the pipe has a brighter core. Light in opal decays
      // outwards from the pipe wall; an opaque key admits none of it.
      const mix = part === lens ? .95 - .23 * (r / (live.W * .135)) ** 2
        : through * Math.exp(-Math.max(0, r - live.W * .135) / 2.6);
      for (let c = 0; c < 3; c++) {
        const k = 4 * i + c;
        part.col[k] += (light[c] - part.col[k]) * mix;
      }
      if (part === lens) part.col[4 * i + 3] = z > live.look.travel + 4 ? mix : .25;
    }
  };
}

export function posePilot(live) {
  const { cap, lens } = live.model.byName;
  const travel = live.look.travel;
  // Press to the hard stop, then return one cell to the selected detent.
  const on = live.spring('on').x;
  const pressed = -live.spring('press').x / live.look.step;
  const depth = travel * on + pressed * (travel + 1 - travel * on);
  cap.tz = lens.tz = -Math.max(0, Math.min(travel + 1, depth));
  const powered = !live.state.off && live.state.input.checked;
  live.state.tintPilot(powered);
  live.glows = powered;
  live.glowStrength = powered ? halo(.06) : 0;
}
