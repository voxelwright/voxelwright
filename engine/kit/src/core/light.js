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
    part.slab(x + 1, y + 1, z + d - 1, w - 2, h - 2, 1, mat, r);
  } else part.slab(x, y, z, w, h, d, mat, r);
  return part;
}

/** The same moulded cap, socket and travel for momentary and latching keys. */
export function seatedKey(live, m, disabled, material, lamp) {
  const { W, H, look } = live;
  const small = Math.min(W, H) < 9;
  const depth = disabled ? 1 : small ? Math.min(3, look.rise) : look.rise + (material === 'enamel' ? 2 : 0);
  live.state.keyTravel = Math.min(look.travel, Math.max(0, depth - 1));
  const key = m.part('cap');
  if (disabled) key.slab(0, 0, 0, W, H, 1, 'steel', 1);
  else {
    if (!small) ring(m.part('socket'), -1, -1, 0, W + 2, H + 2, 'gasket', 2);
    ring(m.part('light'), 0, 0, 0, W, H, lamp, 1);
    key.grounded = false;
    cap(key, 0, 0, 1, W, H, depth - 1, material);
  }
  live.state.top = live.faceZ = depth;
  return key;
}

/** Light stays close to the socket. A latched key keeps its lens lit after release. */
export function keyLight(live, hover, flare, held = 0) {
  live.glowStrength = halo(0.026) * byTheme(live) * (1 + hover * 1.2 + flare * 2.6 + held * 1.3);
  live.glowRadius = 2.3 + flare * 0.8;
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
