// Depth and light: what the lit look's parts are drawn with. A part of your own uses the same.
//
// The look has four tools, each for one job:
//   key      what you press stands on the surface on a ring of light (ring). The light lies on
//            the surface round its foot, and flares when the key goes down.
//   surface  one slab a region. What is on it stays on one level.
//   groove   a thin channel cut into the surface with light in it: it parts what is on one level.
//   well     a level below the surface (hole), lit from its rim: where you put something in, and
//            what you read as set apart.
// Most of what a page holds is none of these: it is words on the surface.

// The renderer takes a glowing cube 36% of the way to its own colour for each unit of the
// light's glow. This much makes it wholly its own colour, in shadow and in a hole alike. The
// look sets its light's glow to this, by day and at night.
export const FULL = 1 / 0.36;

/** A halo's strength, given as if the light's glow were 1. Use for glowStrength. */
export const halo = (s) => s / FULL;

// Walls round a hole sit a hair under the surface: the surface hides their tops, so no rim is
// drawn, and what is seen is their inner faces through the hole and their light on the surface.
export const UNDER = -0.02;

/** By day a halo has a bright surface to show on, and needs this much more to be seen at all. */
export const byTheme = (live) => (live.theme === 'day' ? 2.6 : 1);

/** The room's own warm light (grooves, wells at rest) is quieter by day and carries further at night. */
export const warmth = (live) => (live.theme === 'day' ? 1.5 : 2.1);

/**
 * The light an element asks for with data-vx-light ("accent", "warm", "go", "stop"), as a
 * material's name; or the fallback.
 */
export function lightName(el, fallback = 'light') {
  const k = el.dataset.vxLight;
  return k === 'go' ? 'light-go' : k === 'stop' ? 'light-stop' : k === 'warm' ? 'light-warm' : k === 'accent' ? 'light' : fallback;
}

/**
 * What kind of thing a control is, from data-vx-kind: "main" (the one main action of a group)
 * or "danger" (it destroys something); anything else is ordinary. The older data-vx-material
 * words still read: enamel is main, brick is danger.
 */
export function kindOf(el) {
  const k = el.dataset.vxKind, m = el.dataset.vxMaterial;
  return k === 'main' || m === 'enamel' ? 'main' : k === 'danger' || m === 'brick' ? 'danger' : 'plain';
}

/**
 * A ring of light one voxel high, to stand something on: x, y, z is its corner, w and h its
 * size, r its corner step. Flush with the edge of what stands on it, it shows as a lit line at
 * its foot (left and top, in this projection) and as light on the surface round it. One voxel in
 * from that edge it is hidden, and only its light on the surface shows.
 */
export function ring(part, x, y, z, w, h, mat, r = 0) {
  part.slab(x, y, z, w, h, 1, mat, r).carve(x + 1, y + 1, z, w - 2, h - 2, 1);
  return part;
}

/**
 * A cap: the solid of a key, a knob, anything a finger lands on. Two voxels high or more, and
 * big enough, its top is one voxel smaller all round, as a keycap's is. Every part that stands a
 * cap up draws it with this, so that all of them are the same object.
 */
export function cap(part, x, y, z, w, h, d, mat, r = 1) {
  if (d >= 2 && w >= 5 && h >= 5) {
    part.slab(x, y, z, w, h, d - 1, mat, r);
    // A narrow key has a full-width reading face and a one-course front bevel.
    const inset = mat === 'key' && Math.min(w, h) <= 9 ? 0 : 1;
    part.slab(x + inset, y + 1, z + d - 1, w - 2 * inset, h - 2, 1, mat, r);
  } else part.slab(x, y, z, w, h, d, mat, r);
  return part;
}

/** The slit stays fixed. The linked sheet-metal tongue slides back under the cap. */
export function seatIndicator(live, id, x, y, w, h, light = 'light', z = -1) {
  const m = live.model;
  const width = Math.max(1, Math.min(w - 2, Math.max(3, Math.round(w / 2))));
  const left = x + Math.floor((w - width) / 2);
  const front = y + h - 2;
  const row = z < 0 ? front + 1 : front;
  const socket = m.part('guide' + id);
  socket.slab(left - 1, front - 1, z - 1, width + 2, 3, 1, 'gasket', 1);
  const lens = m.part('lens' + id);
  // An opal diffuser spreads the two end lamps along the slit.
  lens.box(left, row, z, width, 1, 1, 'ivory');
  lens.plot(left, row, z, light);
  lens.plot(left + width - 1, row, z, light);
  const tongue = m.part('tongue' + id);
  // One cell of overlap on each side covers the light at this projection.
  tongue.slab(left - 1, row - 1, z + 1, width + 2, 2, 1, 'slate', 1);
  let lastTravel, lastTheme;
  return (amount) => {
    const travel = Math.max(0, Math.min(1, amount));
    if (travel === lastTravel && live.theme === lastTheme) return;
    lastTravel = travel;
    lastTheme = live.theme;
    tongue.ty = -2 * travel;
    tongue.tz = -2 * travel;
    // The two end lamps share the shutter's travel. In a closed slit even
    // the edge of the diffuser exposed by the chamfer is neutral and unlit.
    lens.tint(live.theme, live.look);
    for (let i = 0; i < lens.col.length; i += 4) {
      for (let c = i; c < i + 3; c++) lens.col[c] = 0.12 + (lens.col[c] - 0.12) * travel;
      lens.col[i + 3] *= travel;
    }
  };
}

/** The same moulded cap, socket and travel for momentary and latching keys. */
export function seatedKey(live, m, disabled, material, lamp) {
  const { W, H, look } = live;
  const small = Math.min(W, H) < 9;
  const depth = disabled || small ? 1 : look.rise + (material === 'enamel' ? 2 : 0);
  m.keyTravel = Math.min(look.travel, Math.max(0, depth - 1));
  const key = m.part('cap');
  if (disabled) key.slab(0, 0, 0, W, H, 1, 'steel', 1);
  else if (small) {
    // A low thumb plate travels a course into its socket. The wider rim stays fixed.
    const inset = H > 2 ? 1 : 0;
    const height = H - 2 * inset;
    hole(live, m, { y: inset, h: height, depth: 2, wall: 'gasket', floor: 'slate' });
    ring(m.part('socket'), -1, 0, 0, W + 2, H, 'steel');
    const light = m.part('light');
    light.sunk = true;
    ring(light, 0, inset, -1, W, height, lamp);
    key.grounded = false;
    key.sunk = true;
    key.slab(0, inset, 0, W, height, 1, material, Math.min(W, height) > 2 ? 1 : 0);
    m.keyTravel = 1;
  } else {
    ring(m.part('socket'), -1, -1, 0, W + 2, H + 2, 'gasket', 2);
    ring(m.part('light'), 0, 0, 0, W, H, look.tooling && lamp === 'light' ? 'backlight' : lamp, 1);
    key.grounded = false;
    if (look.tooling && material === 'key' && W >= 10 && H >= 10 && depth >= 3) {
      // Stepped skirt, shoulders and a shallow cylindrical dish. The art is
      // sampled in the bank's coordinates so its horizon crosses the gaps.
      const sculpt = depth >= 5;
      const lip = sculpt ? 2 : 1;
      const shoulder = depth - 2;
      key.slab(0, 0, 1, W, H, Math.max(1, shoulder - 1), material, 2);
      key.slab(1, 1, shoulder, W - 2, H - 2, 1, material, 2);
      const origin = live.el.offsetLeft / live.vx;
      for (let x = lip; x < W - lip; x++) {
        const rim = sculpt && (x < lip + 2 || x >= W - lip - 2);
        const u = (origin + x) * live.vx;
        const horizon = H * (.74 + .072 * Math.sin(u * .025) + .038 * Math.sin(u * .066));
        for (let y = 2; y < H - 2; y++) {
          const art = look.artwork && y >= horizon;
          key.plot(x, y, depth - 1, art ? (y > horizon + 2 ? 'cap-ridge' : 'cap-inlay') : material);
          if (rim) key.plot(x, y, depth, art ? 'cap-ridge' : material);
        }
      }
    } else cap(key, 0, 0, 1, W, H, depth - 1, material);
  }
  live.state.top = live.faceZ = depth;
  return key;
}

/** Light stays close to the socket. A latched key keeps its lens lit after release. */
export function keyLight(live, hover, flare, held = 0) {
  live.glowStrength = halo(0.026) * byTheme(live) * (1 + hover * 1.2 + flare * 2.6 + held * 1.3);
  live.glowRadius = 2.3 + flare * 0.8;
}

/**
 * A row lens: a strip of smoked glass set flush in the surface, one course proud of it so its
 * glass catches the light. Every row of a list carries one, so the choice moving is a lens going
 * dark and another lighting, and nothing appears from nowhere. `on` lights it with `light`.
 */
export function rowLens(part, x, y, w, h, on, light = 'light') {
  part.box(x, y, 0, w, h, 1, on ? light : 'lens');
  return part;
}

/** A pilot lamp has a steel socket, a raised lens and one pale facet facing the light. */
export function pilot(m, w, h, material) {
  m.part('collar').slab(-1, -1, 0, w + 2, h + 2, 2, 'steel', 1).carve(0, 0, 0, w, h, 2);
  const lens = m.part('lamp');
  lens.box(0, 0, 0, w, h, 3, material);
  lens.plot(0, 0, 2, 'ivory');
}

/**
 * A bezel: a frame one voxel high standing on the surface round a slot (x, y, w, h), `by` voxels
 * wide. For what slides in a slot: a switch, a fader. It reaches `by` voxels past the element's
 * box, into the part's pad.
 */
export function bezel(m, x, y, w, h, { by = h <= 8 || w <= 8 ? 1 : 2, mat = 'steel', name = 'bezel' } = {}) {
  const b = m.part(name);
  b.slab(x - by, y - by, 0, w + by * 2, h + by * 2, 2, mat, 1).carve(x, y, 0, w, h, 2);
  ring(b, x - 1, y - 1, 1, w + 2, h + 2, 'slate');
  return b;
}

/**
 * A hole in the surface: walls round it and a floor under it, `depth` voxels down. The walls
 * carry the light if `wall` is a light. The floor runs under the walls, so every cell of it that
 * shows is the middle of a face, and stays plain. Sets live.well and live.faceZ. Anything else
 * you put in the hole must be a part with sunk = true (and grounded = false if it moves).
 */
export function hole(live, m, { x = 0, y = 0, w = live.W, h = live.H, depth = live.look.well, wall = 'slate', floor = 'floor' } = {}) {
  const walls = m.part('walls');
  walls.sunk = true;
  // An idle well reflects the room along a cast wall. Thin lit grooves and active rims
  // keep their own light source.
  const lining = wall === 'light-warm' && floor === 'floor' && w > 2 && h > 2 ? 'slate' : wall;
  walls.box(x - 1, y - 1, -depth, w + 2, h + 2, depth, lining).carve(x, y, -depth, w, h, depth);
  walls.tz = UNDER;
  const bed = m.part('floor');
  bed.sunk = true;
  bed.box(x - 1, y - 1, -depth - 1, w + 2, h + 2, 1, floor);
  live.well = [x, y, x + w, y + h];
  live.faceZ = 0;
  return { walls, floor: bed };
}
