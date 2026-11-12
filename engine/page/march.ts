// The drawer (#140): every pixel sends a ray through the world's boxes of sectors and their
// trees. Empty space is crossed a block at a time (4 x 4 x 4 sectors, a sector, 16 cells,
// 4 cells, a cell), and a ray that leaves a box carries on in the next, coarser one. What it
// hits is lit by one sun, with a second ray towards the sun for the shadow.
import { shader, type Target } from '../probe/gpu.ts'
import { SUN_SIDE, SUN_TILE, SunMaps } from './sun.ts'
import { SIDE, type World } from './world.ts'

export const MAX_LEVELS = 10

/** The colours every thing in the world shares: 0 is the material's own, 1 to 15 white to black, then 24 hues in ten tones (kinds.rs). */
export function palette(): Float32Array<ArrayBuffer> {
  const out = new Float32Array(256 * 4)
  const set = (i: number, r: number, g: number, b: number) => { out[i * 4] = r ** 2.2; out[i * 4 + 1] = g ** 2.2; out[i * 4 + 2] = b ** 2.2; out[i * 4 + 3] = 1 }
  // Nothing painted is brighter than white paint is: a wall as bright as paper comes out of the sun as white, whatever is on it.
  for (let i = 1; i < 16; i++) { const v = 0.86 - ((i - 1) / 14) * 0.8; set(i, v, v, v * 0.99) }
  // Saturation and value of the ten tones.
  const TONES: [number, number][] = [[0.14, 0.97], [0.26, 0.94], [0.4, 0.88], [0.55, 0.8], [0.78, 0.86], [0.7, 0.55], [0.6, 0.32], [0.16, 0.8], [0.26, 0.62], [0.3, 0.42]]
  for (let hue = 0; hue < 24; hue++) for (let tone = 0; tone < 10; tone++) {
    const [s, bright] = TONES[tone], v = bright * 0.84, h = hue / 4
    const f = (n: number) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
    set(16 + hue * 10 + tone, f(5), f(3), f(1))
  }
  return out
}

/** Each material's own colour and how its cells differ from one another (a fifth either way at 1), then how rough it is, how much it mirrors, how much it glows. Sixteen of each. */
export function materials(): Float32Array<ArrayBuffer> {
  const M: [string, number, number, number, number][] = [
    ['#000000', 0, 1, 0, 0],
    ['#6b5440', 0.9, 0.95, 0, 0], // earth
    ['#7d7a76', 0.8, 0.9, 0, 0], // rock
    ['#5f8a3c', 1.0, 0.95, 0, 0], // grass
    ['#d9c79a', 0.6, 0.95, 0, 0], // sand
    ['#2f6f86', 0.15, 0.06, 0.9, 0], // water
    ['#5a5b60', 0.7, 0.92, 0, 0], // asphalt
    ['#a9a69f', 0.5, 0.85, 0, 0], // concrete
    ['#a4553d', 0.9, 0.9, 0, 0], // brick
    ['#cfc6b4', 0.3, 0.9, 0, 0], // plaster
    ['#b98a5a', 0.7, 0.75, 0, 0], // wood
    ['#9fc3d6', 0.1, 0.05, 0.75, 0], // glass
    ['#8f959c', 0.25, 0.4, 0, 0], // steel: most of it here is painted. It glints (rough 0.4) and mirrors nothing: a street of parked cars each asking what is across from it cost 9 ms
    ['#4f8a3a', 1.2, 0.95, 0, 0], // leaves
    ['#4a4744', 0.6, 0.95, 0, 0], // roofing
    ['#ffe2a8', 0.05, 0.5, 0, 1], // lamp
  ]
  const out = new Float32Array(16 * 8)
  M.forEach(([hex, wander, rough, mirror, glow], i) => {
    for (let c = 0; c < 3; c++) out[i * 8 + c] = (parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255) ** 2.2
    out.set([wander, rough, mirror, glow, 0], i * 8 + 3)
  })
  return out
}

/** The view, the boxes and the sun's maps as the shaders are told them. */
export const GLOBALS = /* wgsl */ `
struct Level {
  boxMin: vec3f, scale: f32,
  // roof: the height nothing in this box stands above.
  boxSize: vec3f, roof: f32,
  wrap: vec3u, pad1: u32,
  cells: vec3i, pad2: i32,
}
struct Globals {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, levels: u32,
  sun: vec3f, flags: u32,
  // sea: how high the top of the sea is.
  res: vec2f, most: u32, sea: f32,
  // How wide a pixel is one cell away, and how many pixels wide a thing must be to be drawn as itself.
  // And the hour: day is 1 by day and 0 at night; low is how near the horizon the sun is, 1 at sunrise and sunset.
  pixel: f32, detail: f32, day: f32, low: f32,
  // The sun's maps: their across and up, how far towards the sun the anchor is, whether to use them.
  sunU: vec3f, sunFar: f32,
  sunV: vec3f, sunMaps: u32,
  level: array<Level, ${MAX_LEVELS}>,
  sunLevel: array<SunLevel, ${MAX_LEVELS}>,
  // The hour's colours, worked out once when the hour is set (Marcher.light) so that no pixel works them out:
  // the light that comes straight (the sun's or the moon's) with how much of it the ground throws back; the sky's
  // fill from above with how much comes from under; the sky overhead with the power its blend to the horizon goes
  // by; the horizon away from the sun with how strong a low sun's wide glow is; the horizon towards the sun; the
  // clouds' tint away from the sun and towards it. The last three carry where the sun is on the horizon (x, z) and
  // how bright the sun's own disc is.
  lightSun: vec4f, lightFill: vec4f, skyZenith: vec4f, skyHorizon: vec4f, skyHorizonSun: vec4f, cloudTint: vec4f, cloudTintSun: vec4f,
}
// A box's map of the sun: where its texels are counted from, and which of its 16 x 16 tiles are drawn.
struct SunLevel { base: vec2f, pad: vec2f, drawn0: vec4u, drawn1: vec4u }
`

/** The sun's shadow at a point, from its maps: needs `g` (the globals) and `sunMap`. */
export const SUNLIT = /* wgsl */ `
// Whether the sun reaches a point: 1 where it does, 0 where it does not, between the two across a shadow's edge,
// and -1 where the maps cannot say. p is on a face whose normal is n, in box level. The map asked is the finest one
// that holds the point's line to the sun and has that tile drawn; four of its texels are weighed, so an edge is soft.
fn sunlit(p: vec3f, n: vec3f, level: u32) -> f32 {
  for (var L = level; L < g.levels; L++) {
    let texel = 1.0 / g.level[L].scale;
    // Asked a little off the face, so a face does not shadow itself across a texel.
    let q = p + n * (0.6 * texel);
    let uv = vec2f(dot(q, g.sunU), dot(q, g.sunV)) / texel;
    let eye = vec2f(dot(g.eye, g.sunU), dot(g.eye, g.sunV)) / texel;
    if (any(abs(uv - eye) > vec2f(${7 * SUN_TILE - 2}.0))) { continue; }
    let sl = g.sunLevel[L];
    let wrap = vec2i(${SUN_SIDE - 1});
    let at = (vec2i(floor(uv + sl.base)) + ${SUN_SIDE}) & wrap;
    let tile = u32(at.x >> ${Math.log2(SUN_TILE)}u) + ${SUN_SIDE / SUN_TILE}u * u32(at.y >> ${Math.log2(SUN_TILE)}u);
    let word = select(sl.drawn0, sl.drawn1, (tile >> 5u) >= 4u)[(tile >> 5u) & 3u];
    if (((word >> (tile & 31u)) & 1u) == 0u) { continue; }
    let d = dot(q, g.sun) + g.sunFar + 0.35 * texel;
    let between = uv + sl.base - 0.5;
    let low = vec2i(floor(between)) + ${SUN_SIDE};
    let f = fract(between);
    let s00 = step(textureLoad(sunMap, low & wrap, L, 0).r, d);
    let s10 = step(textureLoad(sunMap, (low + vec2i(1, 0)) & wrap, L, 0).r, d);
    let s01 = step(textureLoad(sunMap, (low + vec2i(0, 1)) & wrap, L, 0).r, d);
    let s11 = step(textureLoad(sunMap, (low + vec2i(1, 1)) & wrap, L, 0).r, d);
    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
  }
  return -1.0;
}
`

/** How a face is lit and how light becomes a picture: the same for the world and for bodies. */
export const LIGHT = /* wgsl */ `
// The light on a face: the sun where it reaches, the sky from above, what the lit ground throws back from below
// and from the side away from the sun; less of the last two in corners (open: 1 in the open, 0 shut in).
fn shade(albedo: vec3f, n: vec3f, rd: vec3f, sun: vec3f, direct: f32, open: f32, rough: f32, glow: f32) -> vec3f {
  let above = 0.5 + 0.5 * n.y;
  let skylight = mix(vec3f(0.12, 0.118, 0.115) * g.lightFill.a, g.lightFill.rgb, above);
  let bounce = vec3f(0.24, 0.2, 0.15) * (0.6 - 0.4 * n.y) * (0.5 + 0.5 * max(-dot(n, sun), 0.0)) * g.lightSun.a;
  let SUN_LIGHT = g.lightSun.rgb;
  var col = albedo * (SUN_LIGHT * direct * 3.1 * (0.75 + 0.25 * open) + (skylight + bounce) * open);
  let hv = normalize(sun - rd);
  col += SUN_LIGHT * pow(max(dot(n, hv), 0.0), 2.0 / max(rough * rough, 0.002)) * direct * (1.0 - rough) * 0.6;
  col += albedo * glow * 6.0;
  return col;
}
// From light to what a screen shows: bright things keep their colour and do not clip.
fn tone(c: vec3f) -> vec3f {
  let x = c * 0.43;
  let y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(y, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
`

/**
 * What a face of a cell looks like: its material's colour or its own from the palette, then what the material is made
 * as. Bricks two cells long in courses, each its own shade; boards across a painted wall; planks; slabs with joints.
 * Nothing is finer than a cell, and all of it is from where the cell is, so a wall keeps its courses as a body. In the
 * coarser copies a cell is many cells, and only the shade of a patch is kept. For the world and for bodies.
 */
export const PAINT = /* wgsl */ `
fn hash3i(c: vec3i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
// cell: the finest cell the face is of. n: which way the face looks. fine: 1 where a cell is drawn as a cell, 0 in the coarse copies.
fn paint(kind: u32, cell: vec3i, n: vec3f, fine: f32) -> vec3f {
  let stuff = kind & 15u;
  let m = looks.material[stuff];
  let ci = (kind >> 8u) & 255u;
  var base = m.colour;
  if (ci != 0u) { base = looks.palette[ci].rgb; }
  let own = hash3i(cell, 1u);
  let blot = hash3i(cell >> vec3u(2u), 2u);
  var v = 1.0 + ((own - 0.5) * 0.4 * fine + (blot - 0.5) * 0.16) * m.wander;
  // Along the face and up it: a wall's two ways, or a floor's.
  let wall = abs(n.y) < 0.5;
  var along = cell.x;
  var across = cell.z;
  if (abs(n.x) > 0.5) { along = cell.z; across = cell.x; }
  var up = cell.y;
  if (!wall) { up = cell.z; across = cell.y; }
  // Stains and wear, the size of a door.
  let worn = hash3i(vec3i(cell.x >> 4u, cell.y >> 4u, cell.z >> 4u), 3u) - 0.5;
  if (stuff == 8u) {
    // Brick: courses a cell high, bricks two long, every other course half a brick along.
    let brick = vec3i((along + (up & 1)) >> 1u, up, across);
    let shade = hash3i(brick, 4u);
    v = 1.0 + ((shade - 0.5) * 0.44 - select(0.0, 0.22, shade > 0.9)) * fine + (own - 0.5) * 0.08 * fine + worn * 0.12;
  } else if (stuff == 9u) {
    // A painted wall of boards two cells high, each lapped over the one below: the lower cell is in its shade.
    if (wall && (up & 1) == 0) { v -= 0.17 * fine; }
    v += worn * 0.14;
  } else if (stuff == 10u) {
    // Wood: planks two cells wide, upright on a wall and along a floor, each its own shade, with a grain along it.
    var plank = vec3i(along >> 1u, across, 0);
    var run = up;
    if (!wall) { plank = vec3i(cell.z >> 1u, cell.y, 1); run = cell.x; }
    v = 1.0 + ((hash3i(plank, 5u) - 0.5) * 0.3 + (hash3i(vec3i(plank.x, plank.y, run >> 2u), 6u) - 0.5) * 0.12) * fine + (own - 0.5) * 0.06 * fine;
  } else if (stuff == 7u) {
    // Concrete: slabs sixteen cells across with a joint between, and stains.
    if (((along & 15) == 0 || (up & 15) == 0)) { v -= 0.14 * fine; }
    v += worn * 0.14;
  } else if (stuff == 14u) {
    // Roofing: rows of shingles two cells long, every other row half a shingle along.
    let shingle = vec3i((cell.x + (cell.z & 1)) >> 1u, cell.y, cell.z);
    v = 1.0 + (hash3i(shingle, 7u) - 0.5) * 0.3 * fine + worn * 0.1;
  } else if (stuff == 6u || stuff == 1u || stuff == 3u) {
    // Road, earth and grass: patches.
    v += worn * 0.12;
    if (stuff == 3u) { base = mix(base, vec3f(0.42, 0.4, 0.12), clamp(worn + 0.2, 0.0, 0.35)); }
  }
  return base * max(v, 0.2);
}
`

const code = (world: World, grid = world.options.grid) => /* wgsl */ `
${GLOBALS}
// One tile of a map being drawn: where its first texel's middle is (across and up from the anchor), a texel's width, the box, the tile's corner in the map.
struct SunTile { corner: vec2f, texel: f32, level: u32, origin: vec2f, pad: vec2f }
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, pad: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16> }

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(0) @binding(3) var<uniform> looks: Looks;
@group(0) @binding(4) var sunMap: texture_2d_array<f32>;
@group(1) @binding(0) var<uniform> sunTile: SunTile;

const GRID = vec3u(${grid[0]}u, ${grid[1]}u, ${grid[2]}u);
const SLOTS = ${grid[0] * grid[1] * grid[2]}u;
const STRIDE = ${world.stride}u;
// Where, in a level's words, the height of each column of slots is, and of each 4 x 4 columns.
const ROOFS = ${grid[0] * grid[1] * grid[2] + (grid[0] * grid[1] * grid[2] / 64) * 2}u;
const BLOCK_ROOFS = ${grid[0] * grid[1] * grid[2] + (grid[0] * grid[1] * grid[2] / 64) * 2 + grid[0] * grid[2]}u;
const UNIFORM = 0x80000000u;

// left: the ray went out through the far side of the last box (it did not run out of steps).
struct Hit { t: f32, kind: u32, n: vec3f, level: u32, cell: vec3i, left: bool }
// How many steps this pixel's rays have taken, all told.
var<private> work: u32;

fn has(lo: u32, hi: u32, i: u32) -> bool {
  return ((select(lo, hi, i >= 32u) >> (i & 31u)) & 1u) != 0u;
}
// How many children come before child i.
fn before(lo: u32, hi: u32, i: u32) -> u32 {
  if (i >= 32u) { return countOneBits(lo) + countOneBits(hi & ((1u << (i - 32u)) - 1u)); }
  return countOneBits(lo & ((1u << i) - 1u));
}

// Where a ray meets a box: how far along it comes through each pair of sides, and how far along it leaves.
// q0 is the ray's start and k how far along the ray one cell is, each way.
struct Met { near: vec3f, leave: f32 }
fn meet(lo: vec3f, hi: vec3f, q0: vec3f, k: vec3f) -> Met {
  let a = (lo - q0) * k;
  let b = (hi - q0) * k;
  let far = max(a, b);
  return Met(min(a, b), min(far.x, min(far.y, far.z)));
}

// A ray from ro along rd (both in the finest cells from the anchor), starting t0 along it in box level0.
// It need not see anything smaller than its own width, which is wide at its start and grows by spread a cell:
// a node narrower than the ray is taken whole, as the kind most of it is. A rough ray (one towards the sun)
// also takes the boxes two at a time once it has left the one it began in. A ray sent through does not stop
// at what it meets: it goes on to the end and says where it last left something solid.
fn march(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool) -> Hit {
  var hit: Hit;
  hit.t = -1.0;
  let inv = 1.0 / rd;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  var t = t0;
  var n = vec3f(0.0);
  var L = level0;
  let plain = (g.flags & 64u) != 0u;
  // The nodes the ray is inside, kept from step to step: how deep they go (1 a sector, 2 a mid, 3 a leaf), a cell in them, their masks.
  var have = 0u;
  var held = vec3i(0);
  var supAt = 0xffffffffu;
  var supLo = 0u; var supHi = 0u;
  var entry = 0u; var rootLo = 0u; var rootHi = 0u; var rootChild = 0u;
  var midLo = 0u; var midHi = 0u; var midChild = 0u;
  var leafLo = 0u; var leafHi = 0u; var leafChild = 0u;
  // What is the same for every step in one box.
  var lv: Level;
  var q0 = vec3f(0.0);
  var k = vec3f(0.0);
  var eps = 0.0;
  var leaveAt = 0.0;
  var last = vec3i(0);
  var fresh = true;
  for (var i = 0u; i < most; i++) {
    work++;
    if (fresh) {
      if (L >= g.levels) { break; }
      lv = g.level[L];
      q0 = (ro - lv.boxMin) * lv.scale;
      k = inv / lv.scale;
      eps = 0.002 / lv.scale;
      last = vec3i(lv.boxSize) - 1;
      // Where the ray comes into this box and where it leaves it: through a side, or, rising, over its roofs.
      let a = -q0 * k;
      let b = (lv.boxSize - q0) * k;
      let near = min(a, b);
      let far = max(a, b);
      let comeAt = max(near.x, max(near.y, near.z));
      leaveAt = min(far.x, min(far.y, far.z));
      if (rd.y > 0.0) { leaveAt = min(leaveAt, (lv.roof - ro.y) * inv.y); }
      have = 0u;
      supAt = 0xffffffffu;
      fresh = false;
      // A ray is only ever in a box it is inside of now: it never goes back to finer cells.
      if (comeAt > t || leaveAt <= t) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
      // Over everything in this box and coming down: skip to where the roofs begin.
      // No further than to where the ray leaves the box: a box with nothing in it has its roofs at the bottom of
      // everything, and a ray sent there was past every box. From 100 m up the town was not drawn at all.
      if (rd.y < 0.0 && ro.y + rd.y * t > lv.roof && !plain) { t = min((lv.roof - ro.y) * inv.y, leaveAt) + eps; }
    }
    if (t >= leaveAt) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
    let q = q0 + rd * (t * lv.scale);
    let c = clamp(vec3i(floor(q)), vec3i(0), last);
    // Which of the kept nodes still hold this cell: the highest bit in which it differs from the last one says.
    let moved = c ^ held;
    let apart = u32(moved.x | moved.y | moved.z);
    if (apart >= 64u) { have = 0u; } else if (apart >= 16u) { have = min(have, 1u); } else if (apart >= 4u) { have = min(have, 2u); }
    held = c;
    let width = (wide + spread * t) * lv.scale;
    var size = 0;
    var low = c;
    var kind = 0u;
    // A node's contents are met further on: the ray skips to them and looks again.
    var skip = -1.0;
    var face = vec3f(0.0);
    if (have == 0u) {
      let kSec = c >> vec3u(6u);
      let w = (vec3u(kSec) + lv.wrap) & (GRID - 1u);
      let base = L * STRIDE;
      let sup = w >> vec3u(2u);
      // The air over the roofs: a ray that stays above everything in these 4 x 4 columns of sectors, or in
      // this one, crosses them in a step; one that comes down to the roofs inside them skips to there.
      var roofTop = f32(bitcast<i32>(top[base + BLOCK_ROOFS + sup.x + (GRID.x >> 2u) * sup.z]) - lv.cells.y);
      var across = 256.0;
      var corner = vec2f((kSec.xz - vec2i(w.xz & vec2u(3u))) * 64);
      if (q.y <= roofTop) {
        roofTop = f32(bitcast<i32>(top[base + ROOFS + w.x + GRID.x * w.z]) - lv.cells.y);
        across = 64.0;
        corner = vec2f(kSec.xz * 64);
      }
      if (q.y > roofTop && !plain) {
        let o = ((corner + ahead.xz * across) - q0.xz) * k.xz;
        let leave = min(o.x, o.y);
        if (q0.y + rd.y * (leave * lv.scale) > roofTop) {
          n = -sign(rd) * vec3f(f32(o.x <= leave), 0.0, f32(o.y <= leave));
          // Not past where the ray leaves the box: a box whose floor is over the ground is left through its floor,
          // before these columns' far side, and the ray would be under the ground of the coarser copy when it got there.
          t = min(max(leave, t), leaveAt) + eps;
          continue;
        }
        let down = (roofTop - q0.y) * k.y;
        if (down > t) {
          n = vec3f(0.0, 1.0, 0.0);
          t = down + eps;
          continue;
        }
      }
      let at = base + SLOTS + 2u * (sup.x + (GRID.x >> 2u) * (sup.z + (GRID.z >> 2u) * sup.y));
      if (at != supAt) { supAt = at; supLo = top[at]; supHi = top[at + 1u]; }
      if ((supLo | supHi) == 0u && !plain) {
        size = 256;
        low = (kSec - vec3i(w & vec3u(3u))) * 64;
      } else if (!has(supLo, supHi, (w.x & 3u) + 4u * (w.z & 3u) + 16u * (w.y & 3u))) {
        size = 64;
        low = kSec * 64;
      } else {
        entry = top[base + w.x + GRID.x * (w.z + GRID.z * w.y)];
        if ((entry & UNIFORM) != 0u) {
          kind = (entry & 0xffffu) | 0x10000u;
          size = 64;
          low = kSec * 64;
        } else {
          let info = pool[entry + 3u];
          let child = pool[entry + 2u];
          // The box round what the sector holds, in leaves.
          let m = meet(vec3f(kSec * 64 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u)) * 4), vec3f(kSec * 64 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u) * 4), q0, k);
          let enter = max(m.near.x, max(m.near.y, m.near.z));
          if (m.leave <= max(enter, t)) {
            size = 64;
            low = kSec * 64;
          } else if (width > 64.0) {
            kind = (info & 0xffffu) | 0x10000u;
            size = 64;
            low = kSec * 64;
          } else {
            rootLo = pool[entry]; rootHi = pool[entry + 1u]; rootChild = entry + (child & 0xfffffu);
            have = 1u;
            if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
          }
        }
      }
    }
    if (have == 1u && skip < 0.0) {
      let kMid = c >> vec3u(4u);
      let cc = vec3u(kMid) & vec3u(3u);
      let bit = cc.x + 4u * cc.z + 16u * cc.y;
      if (!has(rootLo, rootHi, bit)) {
        size = 16;
        low = kMid * 16;
      } else {
        let node = rootChild + 4u * before(rootLo, rootHi, bit);
        let info = pool[node + 3u];
        let child = pool[node + 2u];
        let m = meet(vec3f(kMid * 16 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u))), vec3f(kMid * 16 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u)), q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 16;
          low = kMid * 16;
        } else if ((info & UNIFORM) != 0u || width > 16.0) {
          kind = (info & 0xffffu) | 0x10000u;
          size = 16;
          low = kMid * 16;
        } else {
          midLo = pool[node]; midHi = pool[node + 1u]; midChild = entry + (child & 0xfffffu);
          have = 2u;
          if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
        }
      }
    }
    if (have == 2u && skip < 0.0 && size == 0 && kind == 0u) {
      let kLeaf = c >> vec3u(2u);
      let cc = vec3u(kLeaf) & vec3u(3u);
      let bit = cc.x + 4u * cc.z + 16u * cc.y;
      if (!has(midLo, midHi, bit)) {
        size = 4;
        low = kLeaf * 4;
      } else {
        let node = midChild + 4u * before(midLo, midHi, bit);
        let info = pool[node + 3u];
        let m = meet(vec3f(kLeaf * 4 + vec3i((vec3u(info) >> vec3u(16u, 18u, 20u)) & vec3u(3u))), vec3f(kLeaf * 4 + vec3i(((vec3u(info) >> vec3u(22u, 24u, 26u)) & vec3u(3u)) + 1u)), q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 4;
          low = kLeaf * 4;
        } else if ((info & UNIFORM) != 0u || width > 4.0) {
          kind = (info & 0xffffu) | 0x10000u;
          size = 4;
          low = kLeaf * 4;
        } else {
          leafLo = pool[node]; leafHi = pool[node + 1u]; leafChild = entry + pool[node + 2u];
          have = 3u;
          if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
        }
      }
    }
    if (skip >= 0.0) {
      n = -sign(rd) * face;
      t = skip + eps;
      continue;
    }
    var cell = c;
    if (have == 3u && size == 0 && kind == 0u) {
      // Inside a leaf: from cell to cell across whichever side comes first, until one is solid or the ray is out.
      let leaf = c >> vec3u(2u);
      var side = ((vec3f(cell) + ahead) - q0) * k;
      let each = abs(k);
      loop {
        let cc = vec3u(cell) & vec3u(3u);
        let bit = cc.x + 4u * cc.z + 16u * cc.y;
        let full = has(leafLo, leafHi, bit);
        if (full && !through) {
          let nth = before(leafLo, leafHi, bit);
          kind = ((pool[leafChild + (nth >> 1u)] >> (16u * (nth & 1u))) & 0xffffu) | 0x10000u;
          break;
        }
        if (side.x <= side.y && side.x <= side.z) {
          t = side.x; side.x += each.x; cell.x += toward.x; n = vec3f(-f32(toward.x), 0.0, 0.0);
        } else if (side.y <= side.z) {
          t = side.y; side.y += each.y; cell.y += toward.y; n = vec3f(0.0, -f32(toward.y), 0.0);
        } else {
          t = side.z; side.z += each.z; cell.z += toward.z; n = vec3f(0.0, 0.0, -f32(toward.z));
        }
        if (full) { hit.t = t; hit.kind = 1u; }
        if (any((cell >> vec3u(2u)) != leaf)) { break; }
        work++;
      }
      if (kind == 0u) { t += eps; continue; }
    }
    if (kind != 0u && !through) {
      hit.t = t;
      hit.kind = kind & 0xffffu;
      hit.n = n;
      hit.level = L;
      hit.cell = cell + lv.cells;
      return hit;
    }
    let out = ((vec3f(low) + ahead * f32(size)) - q0) * k;
    let next = min(out.x, min(out.y, out.z));
    if (kind != 0u) { hit.t = max(next, t); hit.kind = kind & 0xffffu; }
    n = -sign(rd) * vec3f(out <= vec3f(next));
    // Not past where the ray leaves the box: 4 x 4 x 4 sectors with nothing in them are stepped over as one, and
    // they are counted from the box's own slots, so the step can reach outside it.
    t = min(max(next, t), leaveAt) + eps;
  }
  hit.level = min(L, g.levels - 1u);
  hit.left = L >= g.levels;
  return hit;
}
// What a ray meets: what is in the world's cells (march), or the sea. The still sea is not cells: it is all that
// lies under its top with nothing else in it. A look that comes down from over it meets the top where it crosses
// that level, if it has met nothing before, or has gone out through the far side of the last box by then. Past the
// last box there is no sea, as there is no land. This is asked once, after the march and not in it. The march is
// left as it was, and a ray over deep water is walked on down to the floor (the far view is 8% dearer for it):
// one more test a pass in there, or even one more number kept and one more min() a box, made every look a tenth
// dearer, sea in it or not.
fn trace(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool) -> Hit {
  var hit = march(ro, rd, t0, level0, most, wide, spread, rough, through);
  if (through || rd.y >= 0.0 || ro.y <= g.sea) { return hit; }
  let t = (g.sea - ro.y) / rd.y;
  if (hit.t >= 0.0 && hit.t <= t) { return hit; }
  let p = ro + rd * t;
  // The finest box the place is in.
  var L = g.levels;
  for (var k = level0; k < g.levels; k++) {
    let q = (p.xz - g.level[k].boxMin.xz) * g.level[k].scale;
    if (all(q >= vec2f(0.0)) && all(q < g.level[k].boxSize.xz)) { L = k; break; }
  }
  if (L == g.levels || (hit.t < 0.0 && !hit.left)) { return hit; }
  let lv = g.level[L];
  hit.t = t;
  hit.kind = 5u;
  hit.n = vec3f(0.0, 1.0, 0.0);
  hit.level = L;
  hit.cell = vec3i(floor((p - lv.boxMin) * lv.scale - vec3f(0.0, 0.5, 0.0))) + lv.cells;
  return hit;
}

${LIGHT}
${PAINT}
// The sky without sun or cloud: what the air between is the colour of.
fn skyBase(rd: vec3f) -> vec3f {
  let up = clamp(rd.y, 0.0, 1.0);
  var horizon = g.skyHorizon.rgb;
  if (g.low > 0.0) {
    // A low sun reddens the side of the sky it is on.
    let sunward = max(dot(normalize(rd.xz + vec2f(0.0001, 0.0)), vec2f(g.skyHorizonSun.a, g.cloudTint.a)), 0.0);
    horizon = mix(horizon, g.skyHorizonSun.rgb, sunward * sunward);
  }
  var col = mix(horizon, g.skyZenith.rgb, pow(up, g.skyZenith.a));
  let toward = max(dot(rd, g.sun), 0.0);
  col += g.lightSun.rgb * vec3f(1.0, 0.8, 0.56) * (pow(toward, 6.0) * 0.22 + pow(toward, 3.0) * g.skyHorizon.a);
  // Below the horizon the sky is the haze the far ground fades into.
  return mix(col, horizon * 0.94, clamp(-rd.y * 6.0, 0.0, 1.0));
}
// A quick number for a place on a plane: clouds need many and need them only to look unruly.
fn hash2i(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise2(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2i(i), hash2i(i + vec2i(1, 0)), u.x), mix(hash2i(i + vec2i(0, 1)), hash2i(i + vec2i(1, 1)), u.x), u.y);
}
fn cloud(p: vec2f) -> f32 {
  var q = p;
  var sum = 0.0;
  var weight = 0.5;
  for (var o = 0; o < 4; o++) {
    sum += noise2(q) * weight;
    q = q * 2.03 + vec2f(17.3, 9.1);
    weight *= 0.5;
  }
  return sum;
}
// The sky as it is seen: the sun, and clouds on a level 1.5 km up that drift with the wind.
fn sky(rd: vec3f) -> vec3f {
  var col = skyBase(rd);
  let toward = max(dot(rd, g.sun), 0.0);
  // The sun, or at night the moon: a disc and the brightness round it.
  if (g.day > 0.0) { col += g.lightSun.rgb * (pow(toward, 900.0) * g.cloudTintSun.a + pow(toward, 60.0) * 0.35) * g.day; }
  if (g.day < 1.0) { col += vec3f(0.8, 0.86, 1.0) * (smoothstep(0.99975, 0.9998, toward) * 0.9 + pow(toward, 400.0) * 0.06) * (1.0 - g.day); }
  if (g.day < 0.98 && rd.y > 0.0) {
    // Stars: one in some of the small squares the sky is cut into, the brighter the fewer.
    let square = vec3i(floor(rd * 220.0));
    let star = hash3i(square, 19u);
    col += vec3f(0.9, 0.93, 1.0) * smoothstep(0.9965, 1.0, star) * (1.0 - g.day) * smoothstep(0.02, 0.3, rd.y) * 0.9;
  }
  if (rd.y > 0.015) {
    let far = (15000.0 - g.eye.y) / rd.y;
    let at = (g.eye.xz + rd.xz * far) / 9000.0 + vec2f(g.time * 0.004, g.time * 0.0015);
    let thick = cloud(at);
    let cover = smoothstep(0.45, 0.64, thick) * smoothstep(0.015, 0.16, rd.y);
    if (cover > 0.0) {
      // Bright where it is thin, at its edges; grey in its thick middle.
      var body = mix(vec3f(1.0, 0.98, 0.94), vec3f(0.6, 0.65, 0.76), smoothstep(0.54, 0.78, thick));
      // Lit by whatever lights the day: gold and rose under a low sun, on the side towards it most; dark at night.
      if (g.low > 0.0 || g.day < 1.0) { body *= mix(g.cloudTint.rgb, g.cloudTintSun.rgb, toward); }
      col = mix(col, body * 1.25, cover * 0.92);
    }
  }
  return col;
}

${SUNLIT}
// A box's sector that holds a cell: where its tree is (or, with UNIFORM, the one kind it is), 0 for none. Outside the box there is none.
fn sectorOf(c: vec3i, L: u32) -> u32 {
  let lv = g.level[L];
  if (any(c < vec3i(0)) || any(c >= vec3i(lv.boxSize))) { return 0u; }
  let w = (vec3u(c >> vec3u(6u)) + lv.wrap) & (GRID - 1u);
  let base = L * STRIDE;
  let sup = w >> vec3u(2u);
  let at = base + SLOTS + 2u * (sup.x + (GRID.x >> 2u) * (sup.z + (GRID.z >> 2u) * sup.y));
  if (!has(top[at], top[at + 1u], (w.x & 3u) + 4u * (w.z & 3u) + 16u * (w.y & 3u))) { return 0u; }
  return top[base + w.x + GRID.x * (w.z + GRID.z * w.y)];
}
// The part of a sector 16 cells across that holds a cell: where its node is in the pool, 0 where it is empty, 1 where it is all one solid kind.
fn midOf(entry: u32, rootLo: u32, rootHi: u32, rootChild: u32, c: vec3i) -> u32 {
  let cm = vec3u(c >> vec3u(4u)) & vec3u(3u);
  let bit = cm.x + 4u * cm.z + 16u * cm.y;
  if (!has(rootLo, rootHi, bit)) { return 0u; }
  let mid = entry + (rootChild & 0xfffffu) + 4u * before(rootLo, rootHi, bit);
  let info = pool[mid + 3u];
  if ((info & UNIFORM) != 0u) { return select(0u, 1u, (info & 0xffffu) != 0u); }
  return mid;
}
// Whether a cell is solid, given its sector and the part of it that holds the cell (from midOf).
fn solidInMid(entry: u32, mid: u32, c: vec3i) -> bool {
  if (mid < 2u) { return mid == 1u; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  let midLo = pool[mid];
  let midHi = pool[mid + 1u];
  if (!has(midLo, midHi, bit)) { return false; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return (pool[leaf + 3u] & 0xffffu) != 0u; }
  let cc = vec3u(c) & vec3u(3u);
  return has(pool[leaf], pool[leaf + 1u], cc.x + 4u * cc.z + 16u * cc.y);
}
// Whether a cell is solid, given its sector (from sectorOf) and that sector's first three words.
fn solidIn(entry: u32, rootLo: u32, rootHi: u32, rootChild: u32, c: vec3i) -> bool {
  if ((entry & UNIFORM) != 0u) { return (entry & 0xffffu) != 0u; }
  return solidInMid(entry, midOf(entry, rootLo, rootHi, rootChild, c), c);
}

// Whether a cell of box L is solid, from nothing.
fn solidAt(c: vec3i, L: u32) -> bool {
  let entry = sectorOf(c, L);
  if (entry == 0u) { return false; }
  if ((entry & UNIFORM) != 0u) { return (entry & 0xffffu) != 0u; }
  return solidIn(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
}

// How open a point on a face is to the sky round it: 1 in the open, less where the cells beside the face stand
// up round it. The four cells beside the one in front of the face are asked, and the four corners of the face are
// weighed by where on it the point is: so a corner darkens smoothly into the wall. (Asking the four diagonal ones
// too cost twice as much for a difference nobody would see.)
fn openness(p: vec3f, n: vec3f, hit: Hit, ground: bool) -> f32 {
  let lv = g.level[hit.level];
  let front = hit.cell - lv.cells + vec3i(n);
  var u = vec3i(1, 0, 0);
  var v = vec3i(0, 0, 1);
  if (abs(n.x) > 0.5) { u = vec3i(0, 1, 0); } else if (abs(n.z) > 0.5) { v = vec3i(0, 1, 0); }
  let q = (p - lv.boxMin) * lv.scale - vec3f(hit.cell - lv.cells);
  let fu = clamp(dot(q, vec3f(u)), 0.0, 1.0);
  let fv = clamp(dot(q, vec3f(v)), 0.0, 1.0);
  // The four are nearly always in one sector, and in one part of it 16 cells across: those are found once.
  let entry = sectorOf(front, hit.level);
  let whole = entry == 0u || (entry & UNIFORM) != 0u;
  var rootLo = 0u; var rootHi = 0u; var rootChild = 0u;
  var mid = 0u;
  if (!whole) { rootLo = pool[entry]; rootHi = pool[entry + 1u]; rootChild = pool[entry + 2u]; mid = midOf(entry, rootLo, rootHi, rootChild, front); }
  var side = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var i = 0; i < 4; i++) {
    let c = front + select(u, v, i >= 2) * select(-1, 1, (i & 1) == 1);
    if (all((c >> vec3u(6u)) == (front >> vec3u(6u)))) {
      if (entry != 0u) {
        if (!whole && all((c >> vec3u(4u)) == (front >> vec3u(4u)))) { side[i] = f32(solidInMid(entry, mid, c)); } else { side[i] = f32(solidIn(entry, rootLo, rootHi, rootChild, c)); }
      }
      // A street climbs a hill a cell at a time: a step one cell high beside a tread is the slope, not a corner.
      if (ground && side[i] > 0.5 && !solidAt(c + vec3i(0, 1, 0), hit.level)) { side[i] = 0.0; }
    } else {
      let other = sectorOf(c, hit.level);
      if (other != 0u) {
        if ((other & UNIFORM) != 0u) { side[i] = f32((other & 0xffffu) != 0u); } else { side[i] = f32(solidIn(other, pool[other], pool[other + 1u], pool[other + 2u], c)); }
      }
    }
  }
  let w = side[0]; let e = side[1]; let s = side[2]; let nn = side[3];
  // A corner of the face with one side standing is a little dark; with both, as dark as it gets.
  let c00 = 3.0 - (w + s + w * s);
  let c10 = 3.0 - (e + s + e * s);
  let c01 = 3.0 - (w + nn + w * nn);
  let c11 = 3.0 - (e + nn + e * nn);
  return mix(mix(c00, c10, fu), mix(c01, c11, fu), fv) / 3.0;
}

// Whether a pane of glass is a window with a light on behind it at night, and how bright: by the window, a storey
// of a house or a bay of a tower, about two in five of them.
fn litWindow(fine: vec3i) -> f32 {
  let w = hash3i(vec3i(fine.x >> 4u, fine.y / 30, fine.z >> 4u), 23u);
  return smoothstep(0.7, 0.72, w) * (0.35 + 0.65 * fract(w * 17.0));
}
// Where a cell is in its block of the town (city.rs: a block is 1280 cells by 800, its streets along its low sides).
fn inBlock(fine: vec3i) -> vec2f {
  return vec2f(f32(fine.x - i32(floor(f32(fine.x) / 1280.0)) * 1280), f32(fine.z - i32(floor(f32(fine.z) / 800.0)) * 800));
}

// What a ray sees, lit: the colour before the air between is added. shadows: 0 none, 1 from the maps or else a ray,
// 2 from the maps only (and corners are not asked about: this is something seen in a mirror).
fn lit(ro: vec3f, rd: vec3f, hit: Hit, shadows: u32) -> vec3f {
  let m = looks.material[hit.kind & 15u];
  let p = ro + rd * hit.t;
  // Where the sun is asked about: the point itself, but for a step's riser.
  var at = p;
  var n = hit.n;
  let faced = dot(n, n) >= 0.5;
  if (!faced) { n = -rd; }
  // The finest cell the hit's cell begins at; its pattern only where it is drawn as itself.
  let albedo = paint(hit.kind, hit.cell * i32(1u << hit.level), n, select(0.0, 1.0, hit.level == 0u && faced));
  // Earth, grass, sand, asphalt and paving lie on the hills in steps a cell high. A step's riser is lit as the tread
  // is, so a street reads as a slope: a riser is a side face with air over its cell and ground under the cell before it.
  let stuff = hit.kind & 15u;
  let ground = stuff == 1u || stuff == 3u || stuff == 4u || stuff == 6u || stuff == 7u;
  if (ground && faced && shadows == 1u && abs(n.y) < 0.5) {
    let c = hit.cell - g.level[hit.level].cells;
    if (!solidAt(c + vec3i(0, 1, 0), hit.level) && solidAt(c + vec3i(n) - vec3i(0, 1, 0), hit.level)) {
      // And it is in the sun when the tread above it is: the sun is asked about from the middle of the cell's top.
      let lv = g.level[hit.level];
      at = (vec3f(c) + vec3f(0.5, 1.0, 0.5)) / lv.scale + lv.boxMin;
      n = vec3f(0.0, 1.0, 0.0);
    }
  }
  var direct = max(dot(n, g.sun), 0.0);
  if (shadows > 0u && direct > 0.0) {
    var sunny = -1.0;
    if (g.sunMaps != 0u) { sunny = sunlit(at, n, hit.level); }
    if (sunny < 0.0 && shadows == 1u) {
      // No map drawn here yet: ask the world itself.
      let lift = 0.05 / g.level[hit.level].scale;
      let s = trace(at + n * lift, g.sun, 0.0, hit.level, 96u, hit.t * g.pixel * 2.0, 0.04, true, false);
      sunny = select(1.0, 0.0, s.t >= 0.0);
    }
    direct *= max(sunny, 0.0);
  }
  var open = 1.0;
  // Corners are asked about where a cell is more than a pixel or so wide, and fade out before that.
  let wide = 1.0 / (g.level[hit.level].scale * max(hit.t, 1.0) * g.pixel);
  if (shadows == 1u && faced && (g.flags & 32u) == 0u && wide > 1.5) { let o = openness(p, hit.n, hit, ground && hit.n.y > 0.5); open = mix(1.0, 0.1 + 0.9 * o * o, clamp(wide - 1.5, 0.0, 1.0)); }
  var col = shade(albedo, n, rd, g.sun, direct, open, m.rough, m.glow);
  if (g.day < 0.98) {
    // Windows and lamps are lit well before the day has gone.
    let dark = 1.0 - smoothstep(0.55, 0.95, g.day);
    let fine = hit.cell * i32(1u << hit.level);
    let block = inBlock(fine);
    // A window with someone home: the glass is lit from within, most of them warm, a few the blue of a screen,
    // brighter low in the room than at the ceiling. Glass out in the street is a car's and stays dark.
    let lot = block.x >= 140.0 && block.y >= 140.0;
    if (stuff == 11u && lot) {
      let w = litWindow(fine);
      let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(w * 91.0)));
      col += warm * w * dark * (1.5 - 0.5 * f32(fine.y % 30) / 30.0);
    }
    // The lamps at each crossing: their light falls on what is under and round them. Where the lamps are is the
    // town's rule (city.rs), so the light is worked out from the place; a lamp knocked down still casts it. No lamp
    // stands in the sea.
    var pool = 0.0;
    for (var k = 0; k < 4 && stuff != 5u; k++) {
      let lamp = array<vec2f, 4>(vec2f(23.0, 9.0), vec2f(131.0, 23.0), vec2f(9.0, 117.0), vec2f(117.0, 131.0))[k];
      // The same lamps stand at the next crossings along: the nearest of them is the one that counts.
      var d = abs(block - lamp);
      d = min(d, vec2f(1280.0, 800.0) - d);
      pool += 1.0 / (1.0 + dot(d, d) / 6400.0);
    }
    col += albedo * vec3f(1.0, 0.78, 0.48) * pool * pool * dark * (0.35 + 0.65 * max(n.y, 0.0)) * 2.4;
  }
  return col;
}

// The net of light that waves throw on what is under them: bright lines where two slow patterns agree. at is a
// place on the top of the sea, in cells.
fn net(at: vec2f) -> f32 {
  let a = noise2(at * 0.034 + vec2f(g.time * 0.21, g.time * 0.13));
  let b = noise2(at * 0.047 - vec2f(g.time * 0.17, g.time * 0.24) + vec2f(7.3, 1.9));
  return pow(clamp(1.0 - abs(a - b) * 3.2, 0.0, 1.0), 5.0);
}
// Under the sea. What is looked at is lit through the water over it, in the moving net of light the waves throw;
// water takes the red out of light on its way down and back, and with distance everything goes to the water's
// own colour. Looking up, the sky shows through a round window overhead and the rest of the top mirrors the deep.
// Where the waves gather the light, shafts of it stand in the water. grain is a number that differs from pixel to
// pixel.
fn deep(rd: vec3f, hit: Hit, shadows: u32, grain: f32) -> vec3f {
  let M = 0.1;
  let down = (g.sea - g.eye.y) * M;
  // Where the look leaves the water through its top, if it is rising.
  var out = 1e9;
  if (rd.y > 0.0) { out = (g.sea - g.eye.y) / rd.y; }
  // The sun as it stands under water: bent towards overhead.
  let sun = normalize(vec3f(g.sun.x * 0.75, sqrt(1.0 - dot(g.sun.xz, g.sun.xz) * 0.5625), g.sun.z * 0.75));
  let strength = max(g.lightSun.r, max(g.lightSun.g, g.lightSun.b));
  // The water's own light: brighter looking up, dimmer the deeper the eye.
  let glow = mix(vec3f(0.01, 0.13, 0.19), vec3f(0.1, 0.6, 0.64), smoothstep(-0.7, 0.8, rd.y)) * exp(-down * 0.03) * (0.25 + 0.75 * strength);
  var col: vec3f;
  var far = min(out, 6000.0);
  if (hit.t >= 0.0) {
    far = hit.t;
    let p = g.eye + rd * hit.t;
    let under = max(g.sea - p.y, 0.0);
    col = lit(g.eye, rd, hit, shadows) * (0.75 + 1.5 * net(p.xz + sun.xz * (under / sun.y)));
    col *= exp(-vec3f(0.2, 0.035, 0.02) * (under * M + hit.t * M * 0.4));
  } else {
    let at = g.eye.xz + rd.xz * out;
    let ripple = vec2f(noise2(at * 0.09 + vec2f(g.time * 0.5, g.time * 0.3)), noise2(at.yx * 0.11 - vec2f(g.time * 0.4, g.time * 0.27))) - 0.5;
    // Through the window the sky, bent as water bends it; outside it the top is a mirror of the deep.
    let window = smoothstep(0.6, 0.74, rd.y + (ripple.x + ripple.y) * 0.22);
    let flat = vec2f(rd.x, rd.z) * 1.33 + ripple * 0.35;
    let bent = normalize(vec3f(flat.x, sqrt(max(1.0 - dot(flat, flat), 0.01)), flat.y));
    col = mix(glow * 0.55, sky(bent) * vec3f(0.5, 0.72, 0.78) + g.lightSun.rgb * net(at) * 0.4, window);
  }
  col = mix(col, glow, 1.0 - exp(-far * M * 0.036));
  // Shafts: at ten places along the look, how much light the waves send down through each.
  let reach = min(far, 450.0);
  var shafts = 0.0;
  for (var i = 0; i < 10; i++) {
    let s = g.eye + rd * (reach * (f32(i) + grain) * 0.1);
    let under = g.sea - s.y;
    if (under > 0.0) {
      let at = s.xz + sun.xz * (under / sun.y);
      let gathered = noise2(at * 0.021 + vec2f(g.time * 0.06, g.time * 0.045)) * noise2(at * 0.057 - vec2f(g.time * 0.05, g.time * 0.08));
      shafts += smoothstep(0.22, 0.6, gathered) * exp(-under * M * 0.09);
    }
  }
  // They show most looking towards where the light comes from.
  let facing = 0.35 + 0.65 * pow(max(dot(rd, sun), 0.0), 3.0);
  col += g.lightSun.rgb * vec3f(0.45, 0.95, 0.85) * shafts * 0.1 * (reach / 450.0) * facing * 2.2;
  return col;
}

fn air(col: vec3f, rd: vec3f, dist: f32) -> vec3f {
  // dist is in the finest cells: the air thickens over kilometres.
  let f = 1.0 - exp(-dist * 0.00003);
  return mix(col, skyBase(vec3f(rd.x, max(rd.y, 0.02) * 0.3, rd.z)) * 1.6, f);
}

// One texel of a sun map: along the line to the sun through it, how far towards the sun the last solid thing is.
@fragment fn fs_sun(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = sunTile.corner + (at.xy - sunTile.origin - 0.5) * sunTile.texel;
  // A point on the line, level with the eye along the sun.
  let o = g.sunU * uv.x + g.sunV * uv.y + g.sun * dot(g.eye, g.sun);
  // The line is followed from where it comes into this box, on the side away from the sun.
  let lv = g.level[sunTile.level];
  let a = (lv.boxMin - o) / g.sun;
  let b = (lv.boxMin + lv.boxSize / lv.scale - o) / g.sun;
  let near = min(a, b);
  let far = max(a, b);
  let come = max(near.x, max(near.y, near.z));
  if (come >= min(far.x, min(far.y, far.z))) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  let hit = trace(o, g.sun, come + 0.01 * sunTile.texel, sunTile.level, 768u, 0.0, 0.0, false, true);
  // The line starts wherever the eye is level with, so what it last left may well be behind that: only its kind says it met nothing.
  if (hit.kind == 0u) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  return vec4f(dot(o, g.sun) + hit.t + g.sunFar, 0.0, 0.0, 1.0);
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

// How far off a thing is, as the depth other drawing is tested against: nearer than a cell is 0, further than 10 km is 1.
const NEAR = 1.0;
const FAR = 100000.0;
struct Drawn { @location(0) colour: vec4f, @builtin(frag_depth) depth: f32 }

@fragment fn fs(@builtin(position) at: vec4f) -> Drawn {
  let uv = (at.xy / g.res) * 2.0 - 1.0;
  var rd = normalize(g.forward + g.right * (uv.x * g.tanHalf * g.aspect) - g.up * (uv.y * g.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  let shadows = g.flags & 1u;
  var hit = trace(g.eye, rd, 0.0, 0u, g.most, 0.0, g.pixel * g.detail, false, false);
  // From under the sea nothing over its top is seen: what a look met after it went out through the top is not met.
  if ((g.flags & 128u) != 0u && rd.y > 0.0 && hit.t > (g.sea - g.eye.y) / rd.y) { hit.t = -1.0; }
  var depth = 1.0;
  if (hit.t >= 0.0) { depth = clamp(FAR / (FAR - NEAR) * (1.0 - NEAR / max(hit.t * dot(rd, g.forward), NEAR)), 0.0, 1.0); }
  if ((g.flags & 16u) != 0u) {
    // Asked what is under one point: how far (in eighths of a cell), what it is made of, what colour.
    var v = 0u;
    if (hit.t >= 0.0) { v = (u32(clamp(hit.t, 0.0, 131071.0) * 8.0) & 0xfffffu) | ((hit.kind & 15u) << 20u) | (((hit.kind >> 8u) & 255u) << 24u); }
    return Drawn(vec4f(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u), f32(v >> 24u)) / 255.0, depth);
  }
  var col: vec3f;
  if ((g.flags & 128u) != 0u) { col = deep(rd, hit, shadows, hash3i(vec3i(vec2i(at.xy), i32(g.time * 60.0)), 31u)); }
  else if (hit.t < 0.0) { col = sky(rd); } else {
    let m = looks.material[hit.kind & 15u];
    col = lit(g.eye, rd, hit, shadows);
    // A window lit from within at night shows its light, not what is across from it.
    let lot = inBlock(hit.cell * i32(1u << hit.level));
    let glows = g.day < 0.98 && (hit.kind & 15u) == 11u && lot.x >= 140.0 && lot.y >= 140.0 && litWindow(hit.cell * i32(1u << hit.level)) > 0.0;
    if (m.mirror > 0.0 && (g.flags & 2u) != 0u && !glows) {
      // Water and glass show what is across from them.
      var n = hit.n;
      if (dot(n, n) < 0.5) { n = -rd; }
      let p = g.eye + rd * hit.t;
      if ((hit.kind & 15u) == 5u) {
        // Small waves, drawn as themselves only near: further off there are many to a pixel and they are noise.
        let ripple = vec2f(noise2(p.xz * 0.11 + vec2f(g.time * 0.5, g.time * 0.31)), noise2(p.zx * 0.13 - vec2f(g.time * 0.43, g.time * 0.27))) - 0.5
          + (vec2f(noise2(p.xz * 0.37 - vec2f(g.time * 0.9, 0.0)), noise2(p.zx * 0.41 + vec2f(0.0, g.time * 0.8))) - 0.5) * 0.5;
        n = normalize(n + vec3f(ripple.x, 0.0, ripple.y) * 0.16 * clamp(600.0 / hit.t, 0.0, 1.0));
      }
      var back = reflect(rd, n);
      // A wave tilted towards the eye would send the look down into the water it came off, a dark speck: seen
      // from low over water the waves hide those sides of each other, and what shows is sky.
      if ((hit.kind & 15u) == 5u && back.y < 0.02) { back = normalize(vec3f(back.x, 0.02, back.z)); }
      let safe = select(back, vec3f(0.00001), abs(back) < vec3f(0.00001));
      let lift = 0.05 / g.level[hit.level].scale;
      // What is across is asked of the world only where it can be made out: glass a pane of which is two pixels or
      // more, water within 600 m. Further off it shows the sky. From high up every window of the town is a mirror a
      // pixel wide, and asking for each was a third of the picture's cost there.
      let across = 1.0 / (g.level[hit.level].scale * max(hit.t, 1.0) * g.pixel);
      // Unasked, it is the sky a little darker: half of what is across from a far window is town.
      var seen = sky(safe) * 0.8;
      if (((hit.kind & 15u) == 5u && hit.t < 6000.0) || ((hit.kind & 15u) != 5u && across >= 2.0)) {
        let far = trace(p + n * lift, safe, 0.0, hit.level, 64u, hit.t * g.pixel * 2.0, g.pixel * 2.0, false, false);
        seen = sky(safe);
        if (far.t >= 0.0) { seen = air(lit(p, safe, far, shadows * 2u), safe, far.t); }
      }
      // The sun's path on water, or the moon's: all the small waves together smear its image into a streak that runs
      // over the water towards it, narrow across and long, glinting. It is light thrown back, not a picture in a
      // mirror, so it shows however steeply the water is looked at.
      var path = 0.0;
      if ((hit.kind & 15u) == 5u) {
        let flat = reflect(rd, vec3f(0.0, 1.0, 0.0));
        let across = dot(normalize(flat.xz + vec2f(0.0001, 0.0)), vec2f(g.skyHorizonSun.a, g.cloudTint.a));
        let rise = flat.y - g.sun.y;
        let glint = 0.35 + 1.3 * noise2(p.xz * 0.05 + vec2f(g.time * 1.1, g.time * 0.8)) * noise2(p.zx * 0.21 - vec2f(g.time * 0.7, g.time * 1.3));
        path = pow(max(across, 0.0), 300.0) * exp(-rise * rise * 5.0) * glint;
      }
      let facing = 1.0 - max(dot(-rd, n), 0.0);
      let fresnel = 0.04 + 0.96 * pow(facing, 5.0);
      col = mix(col, seen, clamp(m.mirror * (0.25 + 0.75 * fresnel), 0.0, 1.0));
      col += mix(vec3f(0.8, 0.86, 1.0) * 0.25, g.lightSun.rgb * 2.2, g.day) * path;
    }
    col = air(col, rd, hit.t);
  }
  if ((g.flags & 4u) != 0u) {
    // How hard each pixel was: steps as heat.
    let h = f32(work) / 128.0;
    return Drawn(vec4f(h, h * h, pow(h, 4.0), 1.0), depth);
  }
  if ((g.flags & 8u) != 0u) { return Drawn(vec4f(f32(work & 255u) / 255.0, f32(work >> 8u) / 255.0, 0.0, 1.0), depth); }
  return Drawn(vec4f(tone(col), 1.0), depth);
}
`

export interface View {
  /** Where the eye is, in the finest cells of the world. */
  eye: readonly [number, number, number]
  forward: readonly [number, number, number]
  right: readonly [number, number, number]
  up: readonly [number, number, number]
  tanHalf: number
}

/** FLAT leaves corners as bright as the open: for seeing what the darkening costs. */
/** PLAIN: no skip over empty air but from node to node. Slower and never wrong: what the skips are checked against. */
/** UNDER: the eye is under the sea. The marcher sets it itself, from `under`. */
export const SHADOWS = 1, MIRRORS = 2, HEAT = 4, COUNT = 8, PICK = 16, FLAT = 32, PLAIN = 64, UNDER = 128
/** Tiles of the sun's maps drawn each frame. */
const SUN_TILES_A_FRAME = 8

export interface Marcher {
  /** Draws the world into `to`, and how far off each pixel's thing is into its depth. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, flags: number, time: number, timing?: GPURenderPassTimestampWrites): void
  /** Draws a few tiles of the sun's maps as they stand for this view. Once a frame, before `draw`, in the same commands. `ready` is whether the world is made enough to draw them from. */
  tend(encoder: GPUCommandEncoder, view: View, ready: boolean): void
  /** The sun's maps: an edit must spoil the tiles it touches. */
  readonly sun: SunMaps
  /** The colours and materials as the GPU holds them, for whatever else is drawn into the picture. */
  readonly looks: GPUBuffer
  /** What the shaders are told of the view, the boxes and the sun's maps (GLOBALS), for whatever else is lit by them. */
  readonly globals: GPUBuffer
  /** Whether the maps are used for shadows (they are, unless a check wants every shadow traced). */
  maps: boolean
  /** What is straight ahead of a view: how far in the finest cells, what it is made of, its colour in the palette. Null for sky. */
  /** What is straight ahead: how far (finest cells), of what, what colour. `plain` asks without the skips over empty air. */
  pick(view: View, plain?: boolean): Promise<{ t: number; material: number; colour: number } | null>
  /** How many pixels wide a thing must be to be drawn as itself: 1 is every cell that can be seen, 2 is half as fine. */
  detail: number
  /** Whether the eye is under the sea: what is in it is then lit as under water. */
  under: boolean
  /** Where the light comes from, how much of the day it is (1 day, 0 night) and how low the sun (1 at the horizon). */
  light(sun: readonly [number, number, number], day: number, low: number): void
  readonly day: number
}

export async function marcher(device: GPUDevice, format: GPUTextureFormat, world: World): Promise<Marcher> {
  const grid = world.options.grid
  const module = await shader(device, 'march', code(world))
  // The sun stands in the south-west, two fifths of the way up.
  const sunMaps = new SunMaps(device, world.levels.length, [0.52, 0.62, 0.59])
  let maps = true
  const pipeline = await device.createRenderPipelineAsync({ label: 'march', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' } })
  const globals = device.createBuffer({ size: 144 + MAX_LEVELS * 112 + 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const looks = device.createBuffer({ size: 256 * 16 + 16 * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(looks, 0, palette())
  device.queue.writeBuffer(looks, 256 * 16, materials())
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }, { binding: 3, resource: { buffer: looks } }, { binding: 4, resource: sunMaps.all }],
  })
  // The pass that draws a tile of a sun map: the same rays, sent through, into one layer.
  const sunPipeline = await device.createRenderPipelineAsync({ label: 'sun map', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs_sun', targets: [{ format: 'r32float' }] } })
  const sunBind = device.createBindGroup({ layout: sunPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }] })
  const sunTiles = Array.from({ length: SUN_TILES_A_FRAME + 1 }, () => {
    const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    return { buffer, bind: device.createBindGroup({ layout: sunPipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer } }] }) }
  })
  const block = new ArrayBuffer(144 + MAX_LEVELS * 112 + 112), f = new Float32Array(block), u = new Uint32Array(block), i32 = new Int32Array(block)
  /**
   * The hour's colours (see Globals): by day white-gold light and a blue sky; with the sun low, orange light at
   * half strength, a mauve fill, the horizon red towards the sun, clouds gold and rose; at night the moon's blue
   * light at a tenth, a night to see by, as films light it.
   */
  const colours = () => {
    type Colour = readonly [number, number, number]
    const mix = (a: Colour, b: Colour, t: number): Colour => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    const times = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k]
    const hour = (night: Colour, noon: Colour, dusk: Colour) => mix(night, mix(noon, dusk, low), day)
    const [sx, , sz] = sunMaps.s, flat = Math.hypot(sx, sz) || 1, white: Colour = [1, 1, 1], dark: Colour = [0.03, 0.045, 0.085], cloudy: Colour = [0.035, 0.045, 0.075]
    f.set([
      ...mix(times([0.45, 0.58, 0.9], 0.11), times(mix([1, 0.93, 0.82], [1, 0.52, 0.26], low), 1 - 0.45 * low), day), day * (1 - 0.5 * low),
      ...times(mix([0.3, 0.4, 0.58], [0.34, 0.3, 0.42], low), 0.1 + 0.9 * day), 0.1 + 0.9 * day,
      ...hour([0.006, 0.01, 0.03], [0.11, 0.3, 0.7], [0.07, 0.11, 0.36]), 0.42 + 0.18 * low,
      ...hour(dark, [0.66, 0.79, 0.93], [0.6, 0.44, 0.5]), 0.6 * low * day,
      ...hour(dark, [0.66, 0.79, 0.93], [1, 0.45, 0.12]), sx / flat,
      ...hour(cloudy, white, [0.55, 0.36, 0.48]), sz / flat,
      ...hour(cloudy, white, [1, 0.5, 0.2]), 30 - 18 * low,
    ], 36 + MAX_LEVELS * 28)
  }
  /** Tells the shader the view, the boxes and the sun's maps. Returns the corner near the eye that everything is measured from. */
  const tell = (view: View, size: readonly [number, number], flags: number, time: number) => {
      // Everything the shader is told is measured from a corner near the eye, so its numbers stay small enough to be exact.
      const anchor = view.eye.map((v) => Math.floor(v / SIDE) * SIDE)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf], 0)
      f.set([...view.right, size[0] / size[1]], 4)
      f.set([...view.up, time], 8)
      f.set(view.forward, 12)
      u[15] = world.levels.length
      f.set(sunMaps.s, 16)
      u[19] = flags | (under ? UNDER : 0)
      f.set(size, 20)
      u[22] = 384
      // The top of the sea is the world's zero (city.rs SEA).
      f[23] = -anchor[1]
      f[24] = (2 * view.tanHalf) / size[1]
      f[25] = detail
      f[26] = day
      f[27] = low
      f.set(sunMaps.u, 28)
      f[31] = sunMaps.s[0] * anchor[0] + sunMaps.s[1] * anchor[1] + sunMaps.s[2] * anchor[2]
      f.set(sunMaps.v, 32)
      u[35] = maps ? 1 : 0
      world.levels.forEach((level, k) => {
        const told = sunMaps.tell(k, anchor as [number, number, number]), sunAt = 36 + MAX_LEVELS * 16 + k * 12
        f.set(told.base, sunAt)
        u.set(told.drawn, sunAt + 4)
        const at = 36 + k * 16, cell = 1 << k, { low, high } = level.whole
        for (let a = 0; a < 3; a++) {
          f[at + a] = low[a] * SIDE * cell - anchor[a]
          f[at + 4 + a] = (high[a] - low[a]) * SIDE
          u[at + 8 + a] = ((low[a] % grid[a]) + grid[a]) % grid[a]
          i32[at + 12 + a] = low[a] * SIDE
        }
        f[at + 3] = 1 / cell
        f[at + 7] = level.roof - anchor[1]
      })
      device.queue.writeBuffer(globals, 0, block)
      return anchor as [number, number, number]
  }
  let detail = 1, day = 1, low = 0, under = false
  colours()
  // One pixel to ask what is under a point.
  const pointTexture = device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
  const point: Target = { color: pointTexture.createView(), depth: device.createTexture({ size: [1, 1], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView(), size: [1, 1] }
  const pointRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const self: Marcher = {
    get under() { return under },
    set under(v: boolean) { under = v },
    get detail() { return detail },
    set detail(v: number) { detail = v },
    get day() { return day },
    light(sun, isDay, isLow) { sunMaps.turn(sun); day = isDay; low = isLow; colours() },
    async pick(view, plain = false) {
      const encoder = device.createCommandEncoder()
      self.draw(encoder, point, { ...view, tanHalf: 0.0001 }, PICK | (plain ? PLAIN : 0), 0)
      encoder.copyTextureToBuffer({ texture: pointTexture }, { buffer: pointRead }, [1, 1])
      device.queue.submit([encoder.finish()])
      await pointRead.mapAsync(GPUMapMode.READ)
      const b = new Uint8Array(pointRead.getMappedRange().slice(0, 4))
      pointRead.unmap()
      // The canvas's format may keep blue first.
      const v = (format.startsWith('bgra') ? b[2] | (b[1] << 8) | (b[0] << 16) : b[0] | (b[1] << 8) | (b[2] << 16)) | (b[3] << 24)
      const material = (v >>> 20) & 15
      return material ? { t: (v & 0xfffff) / 8, material, colour: v >>> 24 } : null
    },
    get sun() { return sunMaps },
    get looks() { return looks },
    get globals() { return globals },
    get maps() { return maps },
    set maps(v: boolean) { maps = v },
    tend(encoder, view, ready) {
      const anchor = tell(view, [1, 1], 0, 0)
      sunMaps.plan(view.eye, SUN_TILES_A_FRAME, ready).forEach((tile, i) => {
        const { buffer, bind: tileBind } = sunTiles[i], corner = sunMaps.corner(tile, anchor), block = new ArrayBuffer(32)
        new Float32Array(block).set([corner[0], corner[1], 1 << tile.level, 0, tile.slotX * SUN_TILE, tile.slotY * SUN_TILE])
        new Uint32Array(block)[3] = tile.level
        device.queue.writeBuffer(buffer, 0, block)
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: sunMaps.layers[tile.level], loadOp: 'load', storeOp: 'store' }] })
        pass.setPipeline(sunPipeline)
        pass.setBindGroup(0, sunBind)
        pass.setBindGroup(1, tileBind)
        pass.setViewport(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE, 0, 1)
        pass.setScissorRect(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE)
        pass.draw(3)
        pass.end()
      })
    },
    draw(encoder, to, view, flags, time, timing) {
      tell(view, to.size, flags, time)
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        ...(timing ? { timestampWrites: timing } : {}),
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.draw(3)
      pass.end()
    },
  }
  return self
}
