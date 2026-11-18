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
 * A hole in the surface: walls round it and a floor under it, `depth` voxels down. The walls
 * carry the light if `wall` is a light. The floor runs under the walls, so every cell of it that
 * shows is the middle of a face, and stays plain. Sets live.well and live.faceZ. Anything else
 * you put in the hole must be a part with sunk = true (and grounded = false if it moves).
 */
export function hole(live, m, { x = 0, y = 0, w = live.W, h = live.H, depth = live.look.well, wall = 'slate', floor = 'floor' } = {}) {
  const walls = m.part('walls');
  walls.sunk = true;
  walls.box(x - 1, y - 1, -depth, w + 2, h + 2, depth, wall).carve(x, y, -depth, w, h, depth);
  walls.tz = UNDER;
  const bed = m.part('floor');
  bed.sunk = true;
  bed.box(x - 1, y - 1, -depth - 1, w + 2, h + 2, 1, floor);
  live.well = [x, y, x + w, y + h];
  live.faceZ = 0;
  return { walls, floor: bed };
}
