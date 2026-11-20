// The drawer (#140): every pixel sends a ray through the world's boxes of sectors and their
// trees. Empty space is crossed a block at a time (4 x 4 x 4 sectors, a sector, 16 cells,
// 4 cells, a cell), and a ray that leaves a box carries on in the next, coarser one. What it
// hits is lit by one sun, with a second ray towards the sun for the shadow.
import { shader, type Target } from '../probe/gpu.ts'
import { SUN_SIDE, SUN_TILE, SunMaps } from './sun.ts'
import { SIDE, type World } from './world.ts'

// One more than as things are only where `?fine=2` (#259, finer boxes round the eye) asks for an eleventh box.
export const MAX_LEVELS = 10 + Math.max(0, Number(new URLSearchParams(globalThis.location?.search ?? '').get('fine') ?? 0) - 1)

/** The colours every thing in the world shares: 0 is the material's own, 1 to 15 white to black, then 24 hues in ten tones (kinds.rs). */
export function palette(): Float32Array<ArrayBuffer> {
  const out = new Float32Array(256 * 4)
  const set = (i: number, r: number, g: number, b: number) => { out[i * 4] = r ** 2.2; out[i * 4 + 1] = g ** 2.2; out[i * 4 + 2] = b ** 2.2; out[i * 4 + 3] = 1 }
  // Nothing painted is brighter than white paint is: a wall as bright as paper comes out of the sun as white, whatever is on it.
  for (let i = 1; i < 16; i++) { const v = 0.86 - ((i - 1) / 14) * 0.8; set(i, v, v, v * 0.99) }
  // Saturation and value of the ten tones.
  const TONES: [number, number][] = [[0.14, 0.97], [0.26, 0.94], [0.4, 0.88], [0.55, 0.8], [0.78, 0.86], [0.7, 0.55], [0.6, 0.32], [0.16, 0.8], [0.26, 0.62], [0.3, 0.42]]
  // The pale tones are what walls are painted: paint holds less colour in green, blue and pink than in cream, ochre
  // and brick red, and a wall at full strength in those reads as plastic.
  const HOLDS = [0.95, 0.95, 0.55, 0.55, 0.7, 0.5]
  const PAINTED: Record<number, [number, number]> = { 0: [0.14, 0.93], 1: [0.26, 0.88], 2: [0.4, 0.8], 7: [0.16, 0.76] }
  for (let hue = 0; hue < 24; hue++) for (let tone = 0; tone < 10; tone++) {
    const h = hue / 4, at = Math.floor(h), holds = HOLDS[at] + (HOLDS[(at + 1) % 6] - HOLDS[at]) * (h - at)
    const [s, bright] = PAINTED[tone] ? [PAINTED[tone][0] * holds, PAINTED[tone][1]] : TONES[tone], v = bright * 0.84
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
    ['#5f8a3c', 0.7, 0.95, 0, 0], // grass
    ['#d9c79a', 0.6, 0.95, 0, 0], // sand
    ['#2f6f86', 0.15, 0.06, 0.9, 0], // water
    ['#4c4e54', 0.35, 0.92, 0, 0], // asphalt
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
  // The same for each quarter of the box as seen from the eye's own sector: towards -x and -z, +x and -z, -x and +z,
  // +x and +z. A look from the eye stays in one quarter, and need not be held up by a mountain that is behind it.
  roofs: vec4f,
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
  // The weather: how hard it rains (0 to 1), how wet the ground is, and how far windows, lamps and signs are lit.
  // Its last is how far the eye is in a room (Marcher.roofed), not the weather's: kept here for want of a slot.
  // Not to be read in sky(): each of three tries at it there (the clouds' cover, the stars twice) made the dry day
  // 8 to 10% dearer, though none of them runs by day.
  weather: vec4f,
  // Where a look begins (#264, a window into another world): a plane, its normal and how far along it, measured as
  // the eye is. Nothing nearer the eye than that plane is met. All zero: a look begins at the eye.
  starts: vec4f,
  // The fog (#450): a low bank in from the sea, what is lost in it worked out after the march (fogged), never in sky().
  // x how thick it is a cell (0: no fog, and nothing of it is worked out); y the height of its top over the sea; z where
  // its front is, measured east as the eye is (west of it is fog); w and fogTint's a, the corner everything is measured
  // from (x, z), so that the lumps of its top stay where they are as the eye goes.
  fog: vec4f,
  // The colour of the fog as the hour lights it.
  fogTint: vec4f,
}
// A box's map of the sun: where its texels are counted from, and which of its 16 x 16 tiles are drawn.
struct SunLevel { base: vec2f, pad: vec2f, drawn0: vec4u, drawn1: vec4u }
`

/** How fast the fog thins over its top, a finest cell: to a third in 30 m. */
const THIN = (1 / 280).toFixed(6)
/**
 * How much of what is `dist` along a look is lost in the fog (#450), 0 to 1, and how high its top stands where the look
 * crosses it (0 to 1, a half is its middle): needs `g` (the globals) and `noise2`.
 * The bank is even below its top and thins above it, a cell in THIN at a time; only what is west of its front is in it.
 * Its top is lumpy where the look crosses it, and its front wavy, by a slow noise that drifts with the time.
 */
export const FOG = /* wgsl */ `
fn fogged(rd: vec3f, dist: f32) -> vec2f {
  // The part of the look west of the front: from t0 to t1.
  var t0 = 0.0;
  var t1 = dist;
  let ax = vec2f(g.fog.w, g.fogTint.a);
  if (abs(rd.x) > 1e-5) {
    var meet = (g.fog.z - g.eye.x) / rd.x;
    // The front is wavy: where the look crosses it, it stands a little east or west.
    let z = (g.eye.z + rd.z * meet + ax.y) * 0.00035;
    meet = (g.fog.z + (noise2(vec2f(z, g.time * 0.01)) - 0.5) * 2400.0 - g.eye.x) / rd.x;
    if (rd.x > 0.0) { t1 = min(t1, meet); } else { t0 = max(t0, meet); }
  } else if (g.eye.x > g.fog.z) { return vec2f(0.0); }
  if (t1 <= t0) { return vec2f(0.0); }
  // The top, lumpy where the look crosses it.
  var top = g.sea + g.fog.y;
  var lump = 0.5;
  if (abs(rd.y) > 1e-4) {
    let at = (g.eye.xz + rd.xz * clamp((top - g.eye.y) / rd.y, 0.0, 2e5) + ax) * 0.0006 + vec2f(g.time * 0.006, g.time * 0.002);
    lump = noise2(at) * 0.7 + noise2(at * 3.1) * 0.3;
    top += (lump - 0.5) * 700.0;
  }
  let ya = g.eye.y + rd.y * t0;
  let yb = g.eye.y + rd.y * t1;
  let span = t1 - t0;
  // How much of it is under the top, and what the rest above it comes to as it thins.
  var under = 0.0;
  if (abs(yb - ya) < 0.01) { under = select(0.0, span, ya < top); }
  else {
    let c = clamp((top - ya) / (yb - ya), 0.0, 1.0);
    under = span * select(1.0 - c, c, yb > ya);
    if (ya < top && yb < top) { under = span; }
    if (ya >= top && yb >= top) { under = 0.0; }
  }
  let y1 = max(ya, top) - top;
  let y2 = max(yb, top) - top;
  let e1 = exp(-y1 * ${THIN});
  var over = (span - under) * e1;
  if (abs(y2 - y1) > 0.5) { over = (span - under) * (e1 - exp(-y2 * ${THIN})) / ((y2 - y1) * ${THIN}); }
  return vec2f(1.0 - exp(-min(g.fog.x * (under + over), 30.0)), lump);
}
`

/** The sun's shadow at a point, from its maps: needs `g` (the globals) and `sunMap`. */
/** `sunlit`; with `marks` (#259, `bricks=1` unless `finesun=0`) it also says where a cell of finer cells could shade the point. */
const sunlitText = (marks: boolean) => /* wgsl */ `
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
${marks ? `    let r00 = textureLoad(sunMap, low & wrap, L, 0).r;
    let r10 = textureLoad(sunMap, (low + vec2i(1, 0)) & wrap, L, 0).r;
    let r01 = textureLoad(sunMap, (low + vec2i(0, 1)) & wrap, L, 0).r;
    let r11 = textureLoad(sunMap, (low + vec2i(1, 1)) & wrap, L, 0).r;
    // What a texel's line last left may be a cell of finer cells (#259): the number's lowest bit says so (fs_sun). A
    // point such a cell could shade is not answered from the map, which holds the whole cell as solid: -2, ask the world.
    if (((((bitcast<u32>(r00) & u32(d < r00)) | (bitcast<u32>(r10) & u32(d < r10)) | (bitcast<u32>(r01) & u32(d < r01)) | (bitcast<u32>(r11) & u32(d < r11)))) & 1u) != 0u) { return -2.0; }
    let s00 = step(r00, d);
    let s10 = step(r10, d);
    let s01 = step(r01, d);
    let s11 = step(r11, d);
` : `    let s00 = step(textureLoad(sunMap, low & wrap, L, 0).r, d);
    let s10 = step(textureLoad(sunMap, (low + vec2i(1, 0)) & wrap, L, 0).r, d);
    let s01 = step(textureLoad(sunMap, (low + vec2i(0, 1)) & wrap, L, 0).r, d);
    let s11 = step(textureLoad(sunMap, (low + vec2i(1, 1)) & wrap, L, 0).r, d);
`}    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
  }
  return -1.0;
}
`
export const SUNLIT = sunlitText(false)

/**
 * Glass (#163), for the world and for bodies: how much of what is behind a pane comes through it, and how much of
 * what is across from it the pane throws back. Needs `looks`.
 */
export const GLASS = /* wgsl */ `
// What comes through glass: tinted a little by its colour (its hue, not how dark its paint is), the more the more
// glass the look crosses (thick, in the world's cells). A pane also loses a little at its faces (pane, below).
fn glassTint(kind: u32, thick: f32) -> vec3f {
  let ci = (kind >> 8u) & 255u;
  var base = looks.material[11].colour;
  if (ci != 0u) { base = looks.palette[ci].rgb; }
  let hue = base / max(max(base.r, base.g), max(base.b, 0.001));
  return pow(mix(vec3f(1.0), hue, 0.25), vec3f(thick));
}
// How much a pane mirrors: a little face on (its two sides), most of all along it.
fn glassMirror(rd: vec3f, n: vec3f) -> f32 {
  let facing = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
  return looks.material[11].mirror * (0.08 + 0.92 * pow(facing, 5.0));
}
`

/** How a face is lit and how light becomes a picture: the same for the world and for bodies. */
export const LIGHT = /* wgsl */ `
// The light on a face: the sun where it reaches, the sky from above, what the lit ground throws back from below
// and from the side away from the sun; less of the last two in corners (open: 1 in the open, 0 shut in).
// With the eye in a room (g.weather.w, #163), the daylight the room is lit by too: let in at its doorway and windows
// and thrown about off its sunlit floor and walls: warm as the sun is, weaker as it goes down, none at night.
// Without it a room was lit as any shadow is, and a room of dark wood came out black by day.
// How strong that is, against the sun straight on: dark wood reads at about 40 of 255 with it (10 without).
const ROOM_LIGHT = 1.6;
// Once a look has gone through glass (#163) it sees the other side of a wall: from a room, the outside, which is not
// lit as the room is (roomLit 0); from outside, a room or a cabin, which less of the sky reaches (skyLit under 1).
var<private> roomLit: f32 = 1.0;
var<private> skyLit: f32 = 1.0;
fn shade(albedo: vec3f, n: vec3f, rd: vec3f, sun: vec3f, direct: f32, open: f32, rough: f32, glow: f32) -> vec3f {
  let above = 0.5 + 0.5 * n.y;
  let skylight = mix(vec3f(0.12, 0.118, 0.115) * g.lightFill.a, g.lightFill.rgb, above);
  let bounce = vec3f(0.24, 0.2, 0.15) * (0.6 - 0.4 * n.y) * (0.5 + 0.5 * max(-dot(n, sun), 0.0)) * g.lightSun.a;
  let SUN_LIGHT = g.lightSun.rgb;
  // (Only where the sun does not fall: a street seen out of the doorway keeps its sunlit fronts as they were.)
  let room = SUN_LIGHT * g.lightSun.a * g.weather.w * roomLit * ROOM_LIGHT * (1.0 - smoothstep(0.0, 0.15, direct));
  var col = albedo * (SUN_LIGHT * direct * 3.6 * (0.75 + 0.25 * open) + ((skylight + bounce) * skyLit + room) * open);
  let hv = normalize(sun - rd);
  col += SUN_LIGHT * pow(max(dot(n, hv), 0.0), 2.0 / max(rough * rough, 0.002)) * direct * (1.0 - rough) * 0.6;
  col += albedo * glow * 3.2;
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
 * All of it is from where the cell is, so a wall keeps its courses as a body. Where a cell is some pixels wide it
 * is drawn finer than a cell (`q` is where on it, `sharp` how many pixels wide it is): mortar between bricks, a line
 * of shadow under each board's lap, seams between planks, joints between slabs, a grain. Further off those fade to
 * the cell's own shade. In the coarser copies a cell is many cells, and only the shade of a patch is kept. For the
 * world and for bodies.
 */
export const PAINT = /* wgsl */ `
fn hash3i(c: vec3i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
// A number for a place on a face that changes smoothly from one whole place to the next.
fn soft(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash3i(vec3i(i.x, i.y, 0), seed), hash3i(vec3i(i.x + 1, i.y, 0), seed), u.x), mix(hash3i(vec3i(i.x, i.y + 1, 0), seed), hash3i(vec3i(i.x + 1, i.y + 1, 0), seed), u.x), u.y);
}
// cell: the finest cell the face is of. n: which way the face looks. fine: 1 where a cell is drawn as a cell, 0 in the coarse copies.
fn paint(kind: u32, cell: vec3i, n: vec3f, fine: f32, q: vec3f, sharp: f32) -> vec3f {
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
  // Where on the face, 0 to 1 across the cell: along it and up it.
  var fa = q.x;
  var fu = q.y;
  if (abs(n.x) > 0.5) { fa = q.z; }
  if (!wall) { fu = q.z; }
  // Stains and wear, the size of a door, with no edge to them: squares of it read as a chessboard on grass and
  // as patched paint on a wall. Each wall has its own, by how deep in the block it stands.
  let on = vec2f(f32(along), f32(up)) + vec2f(fa, fu) * fine;
  let worn = (soft(on / 16.0 + vec2f(f32(across >> 3u) * 7.3, 0.0), 3u) - 0.5) * 1.5;
  // Lines finer than a cell show where a cell is some pixels wide, and grain where it is more.
  let lines = clamp((sharp - 2.0) / 4.0, 0.0, 1.0) * fine;
  let grain = clamp((sharp - 4.0) / 6.0, 0.0, 1.0) * fine;
  let sub = vec2u(clamp(vec2f(fa, fu) * 4.0, vec2f(0.0), vec2f(3.0)));
  let speck = hash3i(cell, 40u + sub.x + 4u * sub.y) - 0.5;
  var over = vec4f(0.0);
  // Rubble (kinds.rs RUBBLE) is its stuff broken small: no courses, boards or joints, each bit its own shade, rough.
  if ((kind & 16u) != 0u) { return base * max(0.88 + (own - 0.5) * 0.34 * fine + (blot - 0.5) * 0.2 + speck * 0.24 * grain, 0.2); }
  if (stuff == 8u) {
    // Brick: courses a cell high, bricks two long, every other course half a brick along.
    let brick = vec3i((along + (up & 1)) >> 1u, up, across);
    let shade = hash3i(brick, 4u);
    v = 1.0 + ((shade - 0.5) * 0.44 - select(0.0, 0.22, shade > 0.9)) * fine + (own - 0.5) * 0.08 * fine + worn * 0.12 + speck * 0.1 * grain;
    // Mortar: a bed under each course and a joint at each brick's end.
    if (wall) {
      let starts = ((along + (up & 1)) & 1) == 0;
      over = vec4f(0.56, 0.54, 0.5, max(step(fu, 0.17), select(0.0, step(fa, 0.11), starts)) * lines * 0.85);
    }
  } else if (stuff == 9u) {
    // A painted wall of boards two cells high, each lapped over the one below: the lower cell is in its shade.
    if (wall) {
      // Far off the lower cell of a board is in the shade of the one above; near, it is a line of shadow under the lap.
      let lower = (up & 1) == 0;
      let lap = select(0.0, 1.0, !lower && fu > 0.7);
      v -= mix(select(0.0, 0.17 * fine, lower), lap * 0.42 + ((f32(up & 1) + fu) * 0.5 - 0.5) * 0.07, lines);
    }
    v += worn * 0.14 + speck * 0.03 * grain;
  } else if (stuff == 10u) {
    // Wood: planks two cells wide, upright on a wall and along a floor, each its own shade, with a grain along it.
    var plank = vec3i(along >> 1u, across, 0);
    var run = up;
    if (!wall) { plank = vec3i(cell.z >> 1u, cell.y, 1); run = cell.x; }
    v = 1.0 + ((hash3i(plank, 5u) - 0.5) * 0.3 + (hash3i(vec3i(plank.x, plank.y, run >> 2u), 6u) - 0.5) * 0.12) * fine + (own - 0.5) * 0.06 * fine;
    // A seam between planks, and a grain along each.
    var pa = fa;
    var first = (along & 1) == 0;
    if (!wall) { pa = q.z; first = (cell.z & 1) == 0; }
    if (first && pa < 0.1) { v -= 0.4 * lines; }
    v += (hash3i(vec3i(plank.x * 8 + i32(pa * 4.0) + select(4, 0, first), plank.y, run >> 3u), 12u) - 0.5) * 0.12 * grain;
  } else if (stuff == 7u) {
    // Concrete: slabs sixteen cells across with a joint between, and stains.
    if (((along & 15) == 0 || (up & 15) == 0)) {
      let joint = max(select(0.0, step(fa, 0.16), (along & 15) == 0), select(0.0, step(fu, 0.16), (up & 15) == 0));
      v -= mix(0.14 * fine, joint * 0.32, lines);
    }
    v += worn * 0.14 + speck * 0.08 * grain;
  } else if (stuff == 14u) {
    // Roofing: rows of shingles two cells long, every other row half a shingle along.
    let shingle = vec3i((cell.x + (cell.z & 1)) >> 1u, cell.y, cell.z);
    v = 1.0 + (hash3i(shingle, 7u) - 0.5) * 0.3 * fine + worn * 0.1 + speck * 0.1 * grain;
  } else if (stuff == 6u || stuff == 1u || stuff == 3u) {
    if (stuff == 6u) {
      // Road: rolled flat and dark, a fine grit in it with a pale stone here and there, worn paler in long patches.
      v += worn * 0.18 + speck * 0.09 * grain + select(0.0, 0.12, speck > 0.46) * grain;
    } else if (stuff == 1u) {
      v += worn * 0.14 + speck * 0.16 * grain;
    } else {
      // Grass: swells of it gone dry and yellow, hollows of it deep, each drifting into the next; near, blades in
      // tufts, some of them pale and some dark.
      let tuft = soft(on / 5.0, 31u) - 0.5;
      base = mix(base, vec3f(0.42, 0.4, 0.12), clamp(worn * 0.55 + tuft * 0.25 + 0.14, 0.0, 0.4));
      v += tuft * 0.22 + speck * 0.24 * grain;
      if (speck > 0.3) { base = mix(base, vec3f(0.5, 0.52, 0.16), grain * 0.5); }
    }
  }
  if (stuff == 13u) { v += speck * 0.24 * grain; }
  if (stuff == 2u || stuff == 4u) { v += speck * 0.1 * grain; }
  return mix(base * max(v, 0.2), over.rgb, over.a);
}
`

/**
 * A cell that holds finer cells (#259, `?bricks=1`; the core's tree.rs `encode_fine`). The march knows nothing of
 * them: it stops at such a cell as at any other, and its text is the same with the switch on or off (a walk of the
 * block inside the leaf's loop made every look 5% dearer with nothing fine in the world). What the march met is
 * looked at after it, here: a cell whose kind has the mark (64) has a block of 4 x 4 x 4 or 8 x 8 x 8 cells, found
 * again from the cell's place and walked. Where the ray meets one of them that is what it has met; where it passes
 * between them it is marched on from the cell's far side.
 */
/** How many cells of finer cells a ray may pass through between their cells before one is taken whole (`tries`, for measuring). */
const TRIES = Number(new URLSearchParams(globalThis.location?.search ?? '').get('tries') ?? 16)
const FINER = /* wgsl */ `
// Where a cell's block of finer cells is in its sector's tree (and, in the top bit, whether it is 8 a side and not
// 4): 0 where the cell holds none. The cell's leaf is found from the top: this is asked of a ray that met such a
// cell, and of a texel of the sun's maps.
fn fineWord(entry: u32, c: vec3i) -> u32 {
  if (entry == 0u || (entry & UNIFORM) != 0u) { return 0u; }
  let mid = midOf(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
  if (mid < 2u) { return 0u; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let midLo = pool[mid]; let midHi = pool[mid + 1u];
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  if (!has(midLo, midHi, bit)) { return 0u; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return 0u; }
  let leafLo = pool[leaf]; let leafHi = pool[leaf + 1u];
  let cc = vec3u(c) & vec3u(3u);
  let cell = cc.x + 4u * cc.z + 16u * cc.y;
  if (!has(leafLo, leafHi, cell)) { return 0u; }
  let nth = before(leafLo, leafHi, cell);
  let kinds = entry + pool[leaf + 2u];
  if (((pool[kinds + (nth >> 1u)] >> (16u * (nth & 1u))) & 64u) == 0u) { return 0u; }
  return pool[kinds + ((countOneBits(leafLo) + countOneBits(leafHi) + 1u) >> 1u) + nth];
}
`

const REFINE = /* wgsl */ `
// What a ray met inside a cell of finer cells: kind 0 where it passed between them, and where it leaves the cell.
struct Fine { t: f32, kind: u32, n: vec3f, leave: f32, out: f32 }
fn finer(ro: vec3f, rd: vec3f, hit: Hit) -> Fine {
  let lv = g.level[hit.level];
  let c = hit.cell - lv.cells;
  let q0 = (ro - lv.boxMin) * lv.scale;
  let k = (1.0 / rd) / lv.scale;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  let out = ((vec3f(c) + ahead) - q0) * k;
  var r: Fine;
  r.kind = 0u;
  r.leave = min(out.x, min(out.y, out.z)) + 0.002 / lv.scale;
  let entry = sectorOf(c, hit.level);
  let word = fineWord(entry, c);
  if (word == 0u) { return r; }
  // The block: 4 or 8 cells a side, a mask of them, then their kinds.
  let block = entry + (word & 0x7fffffffu);
  let side = select(4, 8, (word >> 31u) != 0u);
  let fs = f32(side);
  let words = u32(side * side * side) >> 5u;
  var sub = clamp(vec3i(floor((q0 + rd * (hit.t * lv.scale) - vec3f(c)) * fs)), vec3i(0), vec3i(side - 1));
  var next = ((vec3f(c) + (vec3f(sub) + ahead) / fs) - q0) * k;
  let each = abs(k) / fs;
  r.t = hit.t;
  r.n = hit.n;
  for (var j = 0; j < 24; j++) {
    let bit = u32(sub.x + side * (sub.z + side * sub.y));
    if (((pool[block + (bit >> 5u)] >> (bit & 31u)) & 1u) != 0u) {
      r.out = min(next.x, min(next.y, next.z));
      let one = pool[block + words];
      if ((one & UNIFORM) != 0u) { r.kind = (one & 0xffffu) | 64u; return r; }
      // Its kind is as far along as there are cells before it.
      var i = countOneBits(pool[block + (bit >> 5u)] & ((1u << (bit & 31u)) - 1u));
      for (var w = 0u; w < (bit >> 5u); w++) { i += countOneBits(pool[block + w]); }
      r.kind = ((pool[block + words + 1u + (i >> 1u)] >> (16u * (i & 1u))) & 0xffffu) | 64u;
      return r;
    }
    if (next.x <= next.y && next.x <= next.z) {
      r.t = next.x; next.x += each.x; sub.x += toward.x; r.n = vec3f(-f32(toward.x), 0.0, 0.0);
    } else if (next.y <= next.z) {
      r.t = next.y; next.y += each.y; sub.y += toward.y; r.n = vec3f(0.0, -f32(toward.y), 0.0);
    } else {
      r.t = next.z; next.z += each.z; sub.z += toward.z; r.n = vec3f(0.0, 0.0, -f32(toward.z));
    }
    if (any(sub < vec3i(0)) || any(sub >= vec3i(side))) { break; }
    work++;
  }
  return r;
}
// A ray that met a cell of finer cells: what it meets in it, or in what lies past it.
fn refine(ro: vec3f, rd: vec3f, met: Hit, most: u32, wide: f32, spread: f32, rough: bool, eyed: bool) -> Hit {
  var hit = met;
  for (var tries = 0u; tries < ${TRIES}u; tries++) {
    // A cell of finer cells narrower than the ray is taken whole, as any node is.
    if ((wide + spread * hit.t) * g.level[hit.level].scale >= 1.0) { break; }
    let f = finer(ro, rd, hit);
    if (f.kind != 0u) { hit.t = f.t; hit.kind = f.kind; hit.n = f.n; hit.out = f.out; break; }
    // Between them: on from the cell's far side. The last of many such cells is taken whole.
    hit = march(ro, rd, f.leave, hit.level, most, wide, spread, rough, false, eyed);
    if ((hit.kind & 64u) == 0u) { break; }
  }
  return hit;
}
`

/**
 * What `trace` does with what the march met, where cells may hold finer cells. The first call of the march is the one
 * there always was, with the same things handed to it: one call in a loop, begun from wherever the last ended, was 2%
 * dearer at the street with nothing fine in the world. Only a ray that met a cell of finer cells goes on to `refine`.
 */
const MARCHED = (bricks: boolean | undefined) => /* wgsl */ `var hit = march(ro, rd, t0, level0, most, wide, spread, rough, through, eyed);${!bricks ? '' : `
  if ((hit.kind & 64u) != 0u && !through) { hit = refine(ro, rd, hit, most, wide, spread, rough, eyed); }`}`

/** How many pixels wide a cell of a pane must be for the look to go through it (`through`, for measuring). */
const THROUGH = Number(new URLSearchParams(globalThis.location?.search ?? '').get('through') ?? 2).toFixed(2)
/**
 * How many panes of glass a look may meet (#163, `panes` for measuring): it goes through all but the last, which is
 * drawn with what is likely behind it (a dim room, or from inside, the day outside). 1 is none. Past one pane, a
 * look out of a tower to the next one cost three quarters of the frame again, and the far side of a car or a room
 * is seldom made out through two tints.
 */
const PANES = Number(new URLSearchParams(globalThis.location?.search ?? '').get('panes') ?? 2)

const INLOOP = new URLSearchParams(globalThis.location?.search ?? '').get('walk') === 'loop'

/** The walk of a cell's block inside the leaf's loop (the other way, `walk=loop`): nothing is read for a cell without the mark. */
const BLOCK = /* wgsl */ `
          if ((kind & 64u) == 0u || width >= 1.0) { break; }
          let word = pool[leafChild + ((countOneBits(leafLo) + countOneBits(leafHi) + 1u) >> 1u) + nth];
          let block = entry + (word & 0x7fffffffu);
          let fside = select(4, 8, (word >> 31u) != 0u);
          let ff = f32(fside);
          let fwords = u32(fside * fside * fside) >> 5u;
          var sub = clamp(vec3i(floor((q0 + rd * (t * lv.scale) - vec3f(cell)) * ff)), vec3i(0), vec3i(fside - 1));
          var fnext = ((vec3f(cell) + (vec3f(sub) + ahead) / ff) - q0) * k;
          var ft = t;
          var fnorm = n;
          var found = false;
          var fbit = 0u;
          for (var j = 0; j < 24; j++) {
            fbit = u32(sub.x + fside * (sub.z + fside * sub.y));
            if (((pool[block + (fbit >> 5u)] >> (fbit & 31u)) & 1u) != 0u) { found = true; break; }
            if (fnext.x <= fnext.y && fnext.x <= fnext.z) {
              ft = fnext.x; fnext.x += each.x / ff; sub.x += toward.x; fnorm = vec3f(-f32(toward.x), 0.0, 0.0);
            } else if (fnext.y <= fnext.z) {
              ft = fnext.y; fnext.y += each.y / ff; sub.y += toward.y; fnorm = vec3f(0.0, -f32(toward.y), 0.0);
            } else {
              ft = fnext.z; fnext.z += each.z / ff; sub.z += toward.z; fnorm = vec3f(0.0, 0.0, -f32(toward.z));
            }
            if (any(sub < vec3i(0)) || any(sub >= vec3i(fside))) { break; }
            work++;
          }
          if (found) {
            let one = pool[block + fwords];
            if ((one & UNIFORM) != 0u) { kind = (one & 0xffffu) | 0x10040u; } else {
              var fi = countOneBits(pool[block + (fbit >> 5u)] & ((1u << (fbit & 31u)) - 1u));
              for (var w = 0u; w < (fbit >> 5u); w++) { fi += countOneBits(pool[block + w]); }
              kind = ((pool[block + fwords + 1u + (fi >> 1u)] >> (16u * (fi & 1u))) & 0xffffu) | 0x10040u;
            }
            t = ft;
            n = fnorm;
            break;
          }
          kind = 0u;`

const code = (world: World, behind = false, grid = world.options.grid) => /* wgsl */ `
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

// left: the ray went out through the far side of the last box (it did not run out of steps). out: where it leaves
// what it met when that is a finer cell (refine says; 0 otherwise), so a look can go on through glass (#163).
struct Hit { t: f32, kind: u32, n: vec3f, level: u32, cell: vec3i, left: bool, out: f32 }
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
// eyed: the ray lies in the quarter of each box, as seen from the eye, that it points into. So do looks from the
// eye, and what the sea mirrors of them (a level mirror turns a look up, not aside).
fn march(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool, eyed: bool) -> Hit {
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
      // The roof that counts: for a ray that keeps to one quarter, that quarter's.
      var roof = lv.roof;
      if (eyed) { roof = lv.roofs[u32(rd.x > 0.0) + 2u * u32(rd.z > 0.0)]; }
      if (rd.y > 0.0 && !plain) { leaveAt = min(leaveAt, (roof - ro.y) * inv.y); }
      // A ray that comes down from over the sea is taken no further than its top (trace says what it met there):
      // under it is the floor and what grows on it, a long walk for nothing.
      if (rd.y < 0.0 && ro.y > g.sea && !through) { leaveAt = min(leaveAt, (g.sea - ro.y) * inv.y); }
      have = 0u;
      supAt = 0xffffffffu;
      fresh = false;
      // A ray is only ever in a box it is inside of now: it never goes back to finer cells.
      if (comeAt > t || leaveAt <= t) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
      // Over everything in this box and coming down: skip to where the roofs begin.
      // No further than to where the ray leaves the box: a box with nothing in it has its roofs at the bottom of
      // everything, and a ray sent there was past every box. From 100 m up the town was not drawn at all.
      if (rd.y < 0.0 && ro.y + rd.y * t > roof && !plain) { t = min((roof - ro.y) * inv.y, leaveAt) + eps; }
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
          ${world.options.bricks && INLOOP ? BLOCK : 'break;'}
        }
        if (side.x <= side.y && side.x <= side.z) {
          t = side.x; side.x += each.x; cell.x += toward.x; n = vec3f(-f32(toward.x), 0.0, 0.0);
        } else if (side.y <= side.z) {
          t = side.y; side.y += each.y; cell.y += toward.y; n = vec3f(0.0, -f32(toward.y), 0.0);
        } else {
          t = side.z; side.z += each.z; cell.z += toward.z; n = vec3f(0.0, 0.0, -f32(toward.z));
        }
        if (full${world.options.bricks && INLOOP ? ' && through' : ''}) {
          // Glass lets the sun through (#163): a ray sent through (a line of a sun map) does not stop at it, so a window
          // lights the room behind it and casts no wall's shadow. Only in the two finest boxes, the copies with rooms in
          // them: further off a house or a tower of glass is solid, and its glass stands for all of it.
          let nth = before(leafLo, leafHi, bit);
          if (((pool[leafChild + (nth >> 1u)] >> (16u * (nth & 1u))) & 15u) != 11u || L > 1u) { hit.t = t; hit.kind = 1u; }
        }
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
    if (kind != 0u && ((kind & 15u) != 11u || L > 1u)) { hit.t = max(next, t); hit.kind = kind & 0xffffu; }
    n = -sign(rd) * vec3f(out <= vec3f(next));
    // Not past where the ray leaves the box: 4 x 4 x 4 sectors with nothing in them are stepped over as one, and
    // they are counted from the box's own slots, so the step can reach outside it.
    t = min(max(next, t), leaveAt) + eps;
  }
  hit.level = min(L, g.levels - 1u);
  hit.left = L >= g.levels;
  return hit;
}
${world.options.bricks ? FINER + (INLOOP ? '' : REFINE) : ''}
// What a ray meets: what is in the world's cells (march), or the sea. The still sea is not cells: it is all that
// lies under its top with nothing else in it. A look that comes down from over it meets the top where it crosses
// that level, if it has met nothing before, or has gone out through the far side of the last box by then. Past the
// last box there is no sea, as there is no land. This is asked once, after the march and not in it. The march is
// left as it was, and a ray over deep water is walked on down to the floor (the far view is 8% dearer for it):
// one more test a pass in there, or even one more number kept and one more min() a box, made every look a tenth
// dearer, sea in it or not.
fn trace(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool, eyed: bool) -> Hit {
  ${MARCHED(world.options.bricks && !INLOOP)}
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
${GLASS}
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
    // Fewer the brighter the sky overhead is, and none under a sky of rain (which is told by that brightness: the
    // weather itself is not read here, see the globals).
    col += vec3f(0.9, 0.93, 1.0) * smoothstep(0.9965, 1.0, star) * (1.0 - g.day) * smoothstep(0.02, 0.3, rd.y) * 0.9 * clamp(1.0 - (g.skyZenith.g - 0.012) * 40.0, 0.0, 1.0);
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

${sunlitText(!!world.options.fineSun)}
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

// What a cell of box L is (its kind; 1 for a part of a sector that is all one solid kind, which midOf does not say).
fn kindAt(c: vec3i, L: u32) -> u32 {
  let entry = sectorOf(c, L);
  if (entry == 0u) { return 0u; }
  if ((entry & UNIFORM) != 0u) { return entry & 0xffffu; }
  let mid = midOf(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
  if (mid < 2u) { return mid; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let midLo = pool[mid]; let midHi = pool[mid + 1u];
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  if (!has(midLo, midHi, bit)) { return 0u; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return pool[leaf + 3u] & 0xffffu; }
  let leafLo = pool[leaf]; let leafHi = pool[leaf + 1u];
  let cc = vec3u(c) & vec3u(3u);
  let cell = cc.x + 4u * cc.z + 16u * cc.y;
  if (!has(leafLo, leafHi, cell)) { return 0u; }
  let nth = before(leafLo, leafHi, cell);
  return (pool[entry + pool[leaf + 2u] + (nth >> 1u)] >> (16u * (nth & 1u))) & 0xffffu;
}
// Where a look leaves a pane it came into at a cell of glass (#163): a pane crossed aslant is two or three cells of
// glass one after another, walked here cell by cell (a march begun again for each cost a fifth of the street).
fn paneEnd(rd: vec3f, hit: Hit, leave: f32) -> f32 {
  let lv = g.level[hit.level];
  let q0 = (g.eye - lv.boxMin) * lv.scale;
  let k = (1.0 / rd) / lv.scale;
  let ahead = max(sign(rd), vec3f(0.0));
  var out = leave;
  for (var j = 0; j < 3; j++) {
    let c = vec3i(floor(q0 + rd * (out * lv.scale)));
    if (any(c < vec3i(0)) || any(c >= vec3i(lv.boxSize)) || (kindAt(c, hit.level) & 15u) != 11u) { break; }
    let side = ((vec3f(c) + ahead) - q0) * k;
    out = max(min(side.x, min(side.y, side.z)), out) + 0.002 / lv.scale;
  }
  return out;
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

// How far along a ray it leaves the cell it met (or the finer cell, for a cell of finer cells): where a look through
// glass goes on from (#163). whole: the way out of the whole cell, for a cell of finer cells too.
fn leaving(ro: vec3f, rd: vec3f, hit: Hit, whole: bool) -> f32 {
  let lv = g.level[hit.level];
  let fine = (hit.kind & 64u) != 0u && !whole;
  if (fine && hit.out > hit.t) { return hit.out + 0.0003 / lv.scale; }
  // A finer cell whose way out was not said: the way out of the eighth of the cell it is in.
  let size = select(1.0, 0.125, fine);
  let q0 = (ro - lv.boxMin) * lv.scale / size;
  let c = floor(q0 + rd * (hit.t * lv.scale / size) + rd * 0.001);
  let out = ((c + max(sign(rd), vec3f(0.0))) - q0) * ((size / rd) / lv.scale);
  return max(min(out.x, min(out.y, out.z)), hit.t) + 0.002 * size / lv.scale;
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
  let lvh = g.level[hit.level];
  let qc = clamp((p - lvh.boxMin) * lvh.scale - vec3f(hit.cell - lvh.cells), vec3f(0.0), vec3f(0.999));
  let albedo = paint(hit.kind, hit.cell * i32(1u << hit.level), n, select(0.0, 1.0, hit.level == 0u && faced), qc, select(0.0, 1.0 / (max(hit.t, 1.0) * g.pixel), hit.level == 0u && faced));
  // Earth, grass, sand, asphalt and paving lie on the hills in steps a cell high. A step's riser is lit as the tread
  // is, so a street reads as a slope: a riser is a side face with air over its cell and ground under the cell before it.
  let stuff = hit.kind & 15u;
  let ground = stuff == 1u || stuff == 3u || stuff == 4u || stuff == 6u || stuff == 7u;
  var slope = false;
  if (ground && faced && shadows == 1u && abs(n.y) < 0.5) {
    let c = hit.cell - g.level[hit.level].cells;
    if (!solidAt(c + vec3i(0, 1, 0), hit.level) && solidAt(c + vec3i(n) - vec3i(0, 1, 0), hit.level)) {
      // And it is in the sun when the tread above it is: the sun is asked about from the middle of the cell's top.
      let lv = g.level[hit.level];
      at = (vec3f(c) + vec3f(0.5, 1.0, 0.5)) / lv.scale + lv.boxMin;
      n = vec3f(0.0, 1.0, 0.0);
      slope = true;
    }
  }
  var direct = max(dot(n, g.sun), 0.0);
  if (shadows > 0u && direct > 0.0) {
    var sunny = -1.0;
    ${world.options.bricks && !world.options.fineSun ? `// A face finer than its cell: the sun's maps hold its whole cell as solid, so it is asked about from past the cell, towards the sun.
    // (Without a branch: one here made every lit pixel a hundredth dearer.)
    at += g.sun * (1.8 * f32((hit.kind >> 6u) & 1u));` : ''}
    if (g.sunMaps != 0u) { sunny = sunlit(at, n, hit.level); }
    // (Past a pane and in a mirror, only the maps are asked: but with the maps off, K, the world is asked there too, or
    // everything seen through glass was in shadow.)
    if (sunny < 0.0 && (shadows == 1u || g.sunMaps == 0u)) {
      // No map drawn here yet (or K: every shadow traced): ask the world itself. Through glass in the two finest boxes,
      // as the maps let the sun through it: up to 23 cells of it, a cell at a time (a pane crossed aslant is two to
      // four, a lump of glass a metre across twenty). Walked a pane at a time (paneEnd) it was a second copy of that
      // walk in the shader, and every picture was a percent or two dearer.
      let o = at + n * (0.05 / g.level[hit.level].scale);
      var past = 0.0;
      var level = hit.level;
      sunny = 1.0;
      for (var k = 0; k < 24; k++) {
        let s = trace(o, g.sun, past, level, 96u, hit.t * g.pixel * 2.0, 0.04, true, false, false);
        if (s.t < 0.0) { break; }
        if ((s.kind & 15u) != 11u || s.level > 1u || k == 23) { sunny = 0.0; break; }
        past = leaving(o, g.sun, s, false);
        level = s.level;
      }
    }
    direct *= max(sunny, 0.0);
  }
  var open = 1.0;
  // Corners are asked about where a cell is more than a pixel or so wide, and fade out before that.
  let wide = 1.0 / (g.level[hit.level].scale * max(hit.t, 1.0) * g.pixel);
  if (shadows == 1u && faced && !slope && (g.flags & 32u) == 0u && wide > 1.5${world.options.bricks ? ' && (hit.kind & 64u) == 0u' : ''}) { let o = openness(p, hit.n, hit, ground && hit.n.y > 0.5); open = mix(1.0, 0.1 + 0.9 * o * o, clamp(wide - 1.5, 0.0, 1.0)); }
  // A sign is lamp in any colour but a street lamp's own: it is lit only when the lights are.
  let ci = (hit.kind >> 8u) & 255u;
  let sign = stuff == 15u && ci != 46u;
  var col = shade(albedo, n, rd, g.sun, direct, open, m.rough, select(m.glow, 0.0, sign));
  if (g.weather.z > 0.0) {
    // Windows, lamps and signs are lit well before the day has gone, and in rain.
    let dark = g.weather.z;
    // Its light is its colour made strong: a pale tint by day is a coloured tube by night.
    if (sign) { col += max(albedo + (albedo - vec3f(dot(albedo, vec3f(0.333)))) * 5.0, vec3f(0.0)) * 3.2 * dark; }
    // A street lamp's own light is far brighter than anything it falls on: the last pass spreads it into a glow.
    if (stuff == 15u && !sign) { col += vec3f(1.0, 0.76, 0.46) * 4.6 * dark; }
    let fine = hit.cell * i32(1u << hit.level);
    let block = inBlock(fine);
    // A window with someone home: the glass is lit from within, most of them warm, a few the blue of a screen,
    // brighter low in the room than at the ceiling. Glass out in the street is a car's and stays dark.
    let lot = block.x >= 140.0 && block.y >= 140.0;
    if (stuff == 11u && lot) {
      // A shop's window (its own pale glass) is always lit.
      let w = max(litWindow(fine), select(0.0, 0.8, ci == 146u));
      let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(w * 91.0)));
      col += warm * w * dark * (1.5 - 0.5 * f32(fine.y % 30) / 30.0);
    }
    // The street lamps: their light falls on what is under and round them. Where the lamps are is the town's rule
    // (city.rs), so the light is worked out from the place; a lamp knocked down still casts it. No lamp stands in
    // the sea or under it, nor in open country: a block whose middle is more than 3.5 km from where the page starts
    // (land.rs HOME and open).
    let out = (floor(vec2f(fine.xz) / vec2f(1280.0, 800.0)) + 0.5) * vec2f(1280.0, 800.0) - vec2f(700.0, 4070.0);
    let lamps = stuff != 5u && fine.y >= 0 && dot(out, out) < 35000.0 * 35000.0;
    var pool = 0.0;
    // On wet road and paving each lamp also shows as itself, thrown back: a warm streak drawn out towards the eye.
    let wet = select(0.0, g.weather.y, (stuff == 6u || stuff == 7u) && n.y > 0.5);
    let back = reflect(rd, vec3f(0.0, 1.0, 0.0));
    let side = normalize(vec2f(-rd.z, rd.x) + vec2f(0.00001, 0.0));
    var streak = 0.0;
    for (var k = 0; k < 9 && lamps; k++) {
      // Each lamp's light, by where it hangs in its block: four at the crossing, three down the street along x,
      // two down the one along z.
      let lamp = array<vec2f, 9>(vec2f(23.0, 9.0), vec2f(131.0, 23.0), vec2f(9.0, 117.0), vec2f(117.0, 131.0), vec2f(369.0, 35.0), vec2f(673.0, 105.0), vec2f(977.0, 35.0), vec2f(35.0, 361.0), vec2f(105.0, 581.0))[k];
      // The same lamps stand in the next blocks along: the nearest of them is the one that counts.
      var d = abs(block - lamp);
      d = min(d, vec2f(1280.0, 800.0) - d);
      pool += 1.0 / (1.0 + dot(d, d) / 6400.0);
      if (wet > 0.0) {
        // Which way the nearest of them is, and how far the look thrown back passes from it: narrow across, long along.
        var to = lamp - block;
        to -= round(to / vec2f(1280.0, 800.0)) * vec2f(1280.0, 800.0);
        let off = back - normalize(vec3f(to.x, 68.0, to.y));
        let across = dot(off.xz, side);
        streak += exp(-across * across * 700.0 - max(dot(off, off) - across * across, 0.0) * 9.0) / (1.0 + dot(d, d) / 90000.0);
      }
    }
    if (streak > 0.0) {
      // Broken by the ripples of the film of water it lies on.
      let rough = 0.45 + 1.1 * noise2(vec2f(fine.xz) * 0.31) * noise2(vec2f(fine.zx) * 0.07);
      col += vec3f(1.0, 0.72, 0.4) * streak * rough * wet * dark * 2.6;
    }
    col += albedo * vec3f(1.0, 0.78, 0.48) * min(pool * pool, 1.2) * dark * (0.12 + 0.88 * max(n.y, 0.0)) * 1.5;
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
// pixel (not used now: see the shafts).
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
  // (Dark below and bright above: with one colour from top to bottom the water was a veil, and shafts stripes on it.)
  let glow = mix(vec3f(0.0, 0.1, 0.19), vec3f(0.02, 0.66, 0.8), pow(smoothstep(-0.55, 1.0, rd.y), 1.6)) * exp(-down * 0.02) * (0.3 + 0.7 * strength);
  var col: vec3f;
  var far = min(out, 6000.0);
  if (hit.t >= 0.0) {
    far = hit.t;
    let p = g.eye + rd * hit.t;
    let under = max(g.sea - p.y, 0.0);
    // The net lies on what faces up; on a wall it was a mesh drawn down the face.
    col = lit(g.eye, rd, hit, shadows) * (1.05 + 1.1 * net(p.xz + sun.xz * (under / sun.y)) * (0.15 + 0.85 * max(hit.n.y, 0.0)));
    col *= exp(-vec3f(0.075, 0.024, 0.02) * (under * M + hit.t * M * 0.4));
    // Light comes from every side under water: what the sun does not reach is not black.
    col += vec3f(0.01, 0.3, 0.36) * exp(-down * 0.02) * (0.3 + 0.7 * strength) * select(0.2, 0.36, abs(hit.n.y) < 0.5);
  } else {
    let at = g.eye.xz + rd.xz * out;
    let ripple = vec2f(noise2(at * 0.09 + vec2f(g.time * 0.5, g.time * 0.3)), noise2(at.yx * 0.11 - vec2f(g.time * 0.4, g.time * 0.27))) - 0.5;
    // Through the window the sky, bent as water bends it; outside it the top is a mirror of the deep.
    let window = smoothstep(0.6, 0.74, rd.y + (ripple.x + ripple.y) * 0.22);
    let flat = vec2f(rd.x, rd.z) * 1.33 + ripple * 0.35;
    let bent = normalize(vec3f(flat.x, sqrt(max(1.0 - dot(flat, flat), 0.01)), flat.y));
    // The waves seen from under them: lines of light all over the top, fine near and running together far off.
    let wa = noise2(at * 0.13 + vec2f(g.time * 0.4, g.time * 0.23));
    let wb = noise2(at * 0.19 - vec2f(g.time * 0.31, g.time * 0.37) + vec2f(3.1, 8.7));
    let waves = pow(clamp(1.0 - abs(wa - wb) * 2.6, 0.0, 1.0), 2.0) * (0.45 + 0.55 * noise2(at * 0.023 + vec2f(g.time * 0.05, 0.0)));
    // And where a wave's face turns the sky down to the eye, a patch of it bright: many and small far off.
    let glint = sqrt(waves) * smoothstep(0.35, 0.7, noise2(at * 0.045 + vec2f(g.time * 0.11, g.time * 0.07)));
    let mirror = glow * 0.7 + vec3f(0.3, 0.85, 0.82) * strength * waves * 0.5 + vec3f(0.55, 0.95, 0.95) * strength * glint * 0.8;
    col = mix(mirror, sky(bent) * vec3f(0.5, 0.72, 0.78) + g.lightSun.rgb * (net(at) * 0.4 + waves * 0.22), window);
  }
  col = mix(col, glow, 1.0 - exp(-far * M * 0.021));
  // Water out of the beams is in shade: the beams are light added to dark, not a veil over everything.
  col *= 0.8;
  // Shafts: beams that stand out from where the sun is overhead, as beams of one sun do to an eye among them. Which
  // are lit goes by the way round the sun's own line that the look lies, and drifts: a few broad beams with hard
  // sides and dark water between, more of them the more water the look goes through. (Samples along the look added
  // every beam it crossed into an even veil of faint streaks, cost fourteen times the noise, and their grain was a
  // screen of dots at the size the page holds here; sheets at set distances were round blots.) They go by the
  // look's direction alone, so they pass by as the eye moves only because where the eye is shifts which are lit.
  let towards = dot(rd, sun);
  let across = rd - sun * towards;
  let u = normalize(cross(sun, vec3f(1.0, 0.0, 0.0)));
  let round = normalize(vec2f(dot(across, u), dot(across, cross(sun, u))) + vec2f(1e-5, 0.0));
  let gathered = (noise2(round * 9.0 + g.eye.xz * 0.006 + vec2f(g.time * 0.05, g.time * 0.035)) * 0.7 + noise2(round * 23.0 - vec2f(g.time * 0.04, g.time * 0.06)) * 0.3) * (0.55 + 0.9 * noise2(round * 2.3 - vec2f(g.time * 0.03, 0.0) + vec2f(4.1, 9.2)));
  // (Soft at their sides and fading as they go down: with hard sides all the way to the floor they were slabs.)
  let shafts = smoothstep(0.42, 0.68, gathered) * (1.0 - exp(-far * M * 0.05)) * smoothstep(-0.35, 0.25, towards) * exp(-down * 0.03) * smoothstep(-0.55, 0.35, rd.y);
  // Looking towards where the light comes from the water itself is bright.
  col += g.lightSun.rgb * vec3f(0.25, 0.88, 0.95) * (shafts * 0.62 + pow(max(towards, 0.0), 6.0) * 0.25);
  return col;
}

// How much of what is dist along a look from the eye is lost in the air: dist is in the finest cells, and the air
// thickens over kilometres. It is thickest by the sea and thins upward (to a third in 1.3 km), so a mountain stands
// clear over the haze its foot is lost in: what counts is the air along the look, from the eye's height to the
// height of what is seen.
fn haze(rd: vec3f, dist: f32) -> f32 {
  let low = (g.eye.y - g.sea) / 12000.0;
  let rise = rd.y * dist / 12000.0;
  var thick = exp(-max(low, 0.0));
  if (abs(rise) > 0.01) { thick *= (1.0 - exp(-rise)) / rise; }
  return 1.0 - exp(-dist * 0.00003 * thick);
}
// The colour of that air.
fn hazeColour(rd: vec3f) -> vec3f { return skyBase(vec3f(rd.x, max(rd.y, 0.02) * 0.3, rd.z)) * 1.6; }
fn air(col: vec3f, rd: vec3f, dist: f32) -> vec3f { return mix(col, hazeColour(rd), haze(rd, dist)); }
${FOG}

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
  let hit = trace(o, g.sun, come + 0.01 * sunTile.texel, sunTile.level, 768u, 0.0, 0.0, false, true, false);
  // The line starts wherever the eye is level with, so what it last left may well be behind that: only its kind says it met nothing.
  if (hit.kind == 0u) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  ${world.options.fineSun ? `// Whether what the line last left is a cell of finer cells goes in the number's lowest bit (sunlit).
  let inside = vec3i(floor((o + g.sun * (hit.t - 0.01 / lv.scale) - lv.boxMin) * lv.scale));
  let marked = fineWord(sectorOf(inside, sunTile.level), inside) != 0u;
  return vec4f(bitcast<f32>((bitcast<u32>(dot(o, g.sun) + hit.t + g.sunFar) & 0xfffffffeu) | u32(marked)), 0.0, 0.0, 1.0);` : 'return vec4f(dot(o, g.sun) + hit.t + g.sunFar, 0.0, 0.0, 1.0);'}
}

// How much of the sky's light a room or a cabin looked into from outside gets (#163): a room is darker than the street.
const INDOORS = 0.45;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

// How far off a thing is, as the depth other drawing is tested against: nearer than a cell is 0, further than 10 km is 1.
const NEAR = 1.0;
const FAR = 100000.0;
// What a pixel draws: its colour; how far off the first pane it looks through is with what that pane lets through of
// what is behind it (panes, #163: for what is drawn after the march, the wand among them; all 0 where no pane is
// looked through); and the depth of what it sees, behind any pane.
struct Drawn { @location(0) colour: vec4f, @location(1) panes: vec4f, @builtin(frag_depth) depth: f32 }
// Mirrors on (the M key, ?mirrors=0 turns them off). The march with mirrors off is a pipeline of its own with this
// false: none of what looks past what is met (a mirror, a pane) is in it, and with mirrors off it costs what it did
// before glass was seen through (the same text with only a test of a flag made those pictures 5 to 17% dearer).
override MIRRORS: bool = true;
// Fog in the air (#450). The march without fog is the pipeline it always was, with this false and none of the fog's
// text: a dry clear day costs what it did (the same text behind a test of the fog's thickness read 8 to 12% dearer).
// The pipelines with fog are made the first time there is any.
override FOGGY: bool = false;

@fragment fn fs(@builtin(position) at: vec4f) -> Drawn {
  let uv = (at.xy / g.res) * 2.0 - 1.0;
  var rd = normalize(g.forward + g.right * (uv.x * g.tanHalf * g.aspect) - g.up * (uv.y * g.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  let shadows = g.flags & 1u;
  ${behind ? `// A marcher for a world behind a window (#264): its looks begin at a plane, not at the eye. Only that marcher's
  // shader has these lines: measured by swapping them in and out of one page, they cost a far view 1 ms in 43.
  let toward = dot(rd, g.starts.xyz);
  let begins = select(0.0, max(0.0, (g.starts.w - dot(g.eye, g.starts.xyz)) / toward), toward != 0.0);` : 'let begins = 0.0;'}
  // Glass is seen through (#163): a look that meets a pane goes on through it, tinted a little, and shows what it
  // meets beyond (past one pane, what is likely there); the pane adds what it mirrors (a little face on, most along it) and, at
  // night, the light of a room with someone home. What is seen through glass is the other side of a wall.
  // One march, one lit() and one look across in the loop, each written once: every call of trace or lit is a copy
  // of it in the compiled shader, and with a copy for each pane the street cost 40% more whether glass was in view or not.
  var col = vec3f(0.0);
  var keep = vec3f(1.0);
  var depth = 1.0;
  var first = -1.0;
  var t0 = begins;
  var level0 = 0u;
  var panes = 0u;
  var last = -1.0;
  var seenThrough = vec4f(0.0);
  // The air's colour along this look (worked out once: inside the loop as well as after it, it was 2% dearer).
  let airColour = hazeColour(rd);
  // Past a pane the look is marched more coarsely (what is two pixels wide is taken whole), for fewer steps, and
  // what it meets is lit without its corners darkened or a shadow traced where the sun's maps cannot say (as what is
  // seen in a mirror is): it is seen through a tint, and a room's back wall had cost as much as the front of the house.
  var spread = g.pixel * g.detail;
  var most = g.most;
  var lights = shadows;
  for (var i = 0u; i < select(1u, ${PANES * 2}u, MIRRORS); i++) {
    var hit = trace(g.eye, rd, t0, level0, most, select(0.0, t0 * spread, i > 0u), spread, false, false, true);
    if (i == 0u) {
      // From under the sea nothing over its top is seen: what a look met after it went out through the top is not met.
      if ((g.flags & 128u) != 0u && rd.y > 0.0 && hit.t > (g.sea - g.eye.y) / rd.y) { hit.t = -1.0; }
      first = hit.t;
      if ((g.flags & 16u) != 0u) {
        // Asked what is under one point: how far (in eighths of a cell), what it is made of, what colour.
        var v = 0u;
        if (hit.t >= 0.0) { v = (u32(clamp(hit.t, 0.0, 131071.0) * 8.0) & 0xfffffu) | ((hit.kind & 15u) << 20u) | (((hit.kind >> 8u) & 255u) << 24u); }
        if (hit.t >= 0.0) { depth = clamp(FAR / (FAR - NEAR) * (1.0 - NEAR / max(hit.t * dot(rd, g.forward), NEAR)), 0.0, 1.0); }
        return Drawn(vec4f(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u), f32(v >> 24u)) / 255.0, vec4f(0.0), depth);
      }
      if ((g.flags & 128u) != 0u) {
        if (hit.t >= 0.0) { depth = clamp(FAR / (FAR - NEAR) * (1.0 - NEAR / max(hit.t * dot(rd, g.forward), NEAR)), 0.0, 1.0); }
        col = deep(rd, hit, shadows, fract(52.9829189 * fract(dot(at.xy, vec2f(0.06711056, 0.00583715)))));
        break;
      }
    }
    if (hit.t < 0.0) { col += keep * sky(rd); depth = 1.0; break; }
    depth = clamp(FAR / (FAR - NEAR) * (1.0 - NEAR / max(hit.t * dot(rd, g.forward), NEAR)), 0.0, 1.0);
    let stuff = hit.kind & 15u;
    // With mirrors off (the M key, ?mirrors=0: no look beyond what is met) glass is a face as any other, as it was.
    let glass = stuff == 11u && MIRRORS;
    let scale = g.level[hit.level].scale;
    var leave = 0.0;
    if (glass) {
      // A pane of finer cells (#259) that the look past it would take whole, as it takes any cell narrower than it:
      // left whole, or the look met the pane's own cell again and drew it, or the frame in it, for the room.
      let whole = (hit.kind & 64u) != 0u && hit.t * g.pixel * max(g.detail, 2.0) * 2.0 * scale >= 1.0;
      leave = leaving(g.eye, rd, hit, whole);
      if ((hit.kind & 64u) == 0u || whole) { leave = paneEnd(rd, hit, leave); }
      // A pane a look crosses aslant is two or three cells of glass one after another: one pane, thicker.
      if (hit.t <= last + 0.01 / scale && i + 1u < ${PANES * 2}u) {
        keep *= glassTint(hit.kind, max(leave - hit.t, 0.0));
        last = leave; t0 = leave; level0 = hit.level;
        continue;
      }
    }
    let m = looks.material[stuff];
    // A pane's own light is a tenth of what it shows: it is lit from the sun's maps alone, as what a mirror shows is.
    // (Not lit at all for a pane seen through another, a branch round this call, the street was 3% dearer.)
    var own = lit(g.eye, rd, hit, select(lights, lights * 2u, glass));
    var n = hit.n;
    if (dot(n, n) < 0.5) { n = -rd; }
    let p = g.eye + rd * hit.t;
    let across = 1.0 / (scale * max(hit.t, 1.0) * g.pixel);
    // How much of what is across from it the face shows, and whether that is asked of the world.
    var mirror = m.mirror;
    var ask = false;
    var goes = false;
    var lamp = 0.0;
    // Polished by a spell (kinds.rs POLISHED, bit 7): it mirrors, whatever it is made of. Bit 6 is the mark of a
    // finer cell (the march sets it itself): read here, every finer cell was a mirror.
    let polished = (hit.kind & 128u) != 0u;
    if (glass) {
      panes++;
      // A window with someone home at night is lit from within: its blind is drawn and its light shows, not the room.
      let fine = hit.cell * i32(1u << hit.level);
      let lot = inBlock(fine);
      if (g.weather.z > 0.0 && lot.x >= 140.0 && lot.y >= 140.0 && (litWindow(fine) > 0.0 || ((hit.kind >> 8u) & 255u) == 146u)) { lamp = clamp(g.weather.z * 3.0, 0.0, 1.0); }
      mirror = glassMirror(rd, n);
      // Polished glass is a mirror (more than a third: not looked through), what is behind it a dim room.
      if (polished) { mirror = max(mirror, 0.62); }
      mirror *= 1.0 - lamp;
      // Its own faint film, or a lit room's light.
      own *= mix(0.1, 1.0, lamp);
      // Looked through in the two finest boxes, which have rooms (further off a house is solid), where a cell is
      // two pixels or more (as what a pane mirrors is asked only there), and not past the last pane a look may cross.
      // A pane asks the world one thing: what is behind it while it lets most through, what is across from it once
      // it mirrors more than a third (looked at along it), with a dim room behind. Up the side of a tower of glass
      // asking both cost half as much again as the old mirror did.
      goes = hit.level <= 1u && across >= ${THROUGH} && panes < ${PANES}u && i + 1u < ${PANES * 2}u && mirror < 0.33;
      // Face on a pane mirrors a tenth, and the sky a little darker stands in for what is across.
      ask = !goes && across >= 2.0 && mirror * max(keep.r, max(keep.g, keep.b)) > 0.12;
    } else {
      if (polished) { mirror = max(mirror, 0.62); }
      // Road and paving that are wet mirror too: a film of water everywhere, puddles where it gathers.
      if (g.weather.y > 0.0 && (stuff == 6u || stuff == 7u) && hit.n.y > 0.5) {
        let place = vec2f((hit.cell * i32(1u << hit.level)).xz);
        mirror = g.weather.y * (0.45 + 0.5 * smoothstep(0.42, 0.6, noise2(place * 0.023)));
        own *= 1.0 - 0.35 * g.weather.y;
        // Wet road is not flat: what it mirrors is drawn out into streaks towards the eye.
        n = normalize(n + vec3f(noise2(p.xz * 0.23) - 0.5, 0.0, noise2(p.zx * 0.29) - 0.5) * 0.022);
      }
      if (stuff == 5u) {
        // Small waves, drawn as themselves only near: further off there are many to a pixel and they are noise.
        let ripple = vec2f(noise2(p.xz * 0.11 + vec2f(g.time * 0.5, g.time * 0.31)), noise2(p.zx * 0.13 - vec2f(g.time * 0.43, g.time * 0.27))) - 0.5
          + (vec2f(noise2(p.xz * 0.37 - vec2f(g.time * 0.9, 0.0)), noise2(p.zx * 0.41 + vec2f(0.0, g.time * 0.8))) - 0.5) * 0.5;
        n = normalize(n + vec3f(ripple.x, 0.0, ripple.y) * 0.16 * clamp(600.0 / hit.t, 0.0, 1.0));
      }
      let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
      mirror = clamp(mirror * (0.25 + 0.75 * fresnel), 0.0, 1.0);
      // What is across is asked of the world only where it can be made out: a face two pixels or more, water within
      // 600 m. From high up every window of the town was a mirror a pixel wide, and asking for each was a third of
      // the picture's cost there.
      ask = (stuff == 5u && hit.t < 6000.0) || (stuff != 5u && across >= 2.0);
    }
    var add = own;
    if (mirror > 0.0 && MIRRORS) {
      var back = reflect(rd, n);
      // A wave tilted towards the eye would send the look down into the water it came off, a dark speck: seen
      // from low over water the waves hide those sides of each other, and what shows is sky.
      if (stuff == 5u && back.y < 0.02) { back = normalize(vec3f(back.x, 0.02, back.z)); }
      var safe = select(back, vec3f(0.00001), abs(back) < vec3f(0.00001));
      // What the sea mirrors is kept on the look's own side of both ways across: a wave can tip it a little over,
      // and it is then marched with the roofs of the quarter the look is in.
      if (stuff == 5u) { safe = vec3f(abs(safe.x) * select(-1.0, 1.0, rd.x > 0.0), safe.y, abs(safe.z) * select(-1.0, 1.0, rd.z > 0.0)); }
      // Unasked, it is the sky a little darker: half of what is across from a far window is town.
      var seen = sky(safe) * 0.8;
      if (ask) {
        // What water mirrors is seen through its ripples, so it is asked for coarsely: three times as coarse as
        // what a pane of glass mirrors, and every other box.
        let coarse = select(2.0, 6.0, stuff == 5u);
        let far = trace(p + n * (0.05 / scale), safe, 0.0, hit.level, 64u, hit.t * g.pixel * coarse, g.pixel * coarse, stuff == 5u, false, stuff == 5u);
        seen = sky(safe);
        if (far.t >= 0.0) { seen = air(lit(p, safe, far, shadows * 2u), safe, far.t); }
      }
      if (glass) { add += seen * mirror; } else { add = mix(own, seen, mirror); }
      if (stuff == 5u) {
        // The sun's path on water, or the moon's: all the small waves together smear its image into a streak that
        // runs over the water towards it, narrow across and long, glinting. It is light thrown back, not a picture
        // in a mirror, so it shows however steeply the water is looked at.
        let flat = reflect(rd, vec3f(0.0, 1.0, 0.0));
        let toward = dot(normalize(flat.xz + vec2f(0.0001, 0.0)), vec2f(g.skyHorizonSun.a, g.cloudTint.a));
        let rise = flat.y - g.sun.y;
        let glint = 0.35 + 1.3 * noise2(p.xz * 0.05 + vec2f(g.time * 1.1, g.time * 0.8)) * noise2(p.zx * 0.21 - vec2f(g.time * 0.7, g.time * 1.3));
        add += mix(vec3f(0.8, 0.86, 1.0) * 0.25, g.lightSun.rgb * 3.6, g.day) * pow(max(toward, 0.0), 300.0) * exp(-rise * rise * 5.0) * glint;
      }
    }
    // The air: everything is lost in it by its own distance, what is seen through a pane too (a hill far off seen out
    // of a window is as hazy as beside it). The whole picture is given the air as far as the first thing met, after
    // the loop; what is past a pane is given here what more it loses beyond that. (Kept through the loop instead, as
    // how much air each thing adds, it made every picture 2 to 5% dearer.)
    if (i > 0u) { add = mix(add, airColour, 1.0 - (1.0 - haze(rd, hit.t)) / max(1.0 - haze(rd, first), 0.0001)); }
    if (!glass) { col += keep * add; break; }
    var through = glassTint(hit.kind, max(leave - hit.t, 0.0) + 0.5) * 0.94 * (1.0 - mirror) * (1.0 - lamp);
    // How much of what is behind is looked through: none where the pane is not, and less towards each edge of where it
    // is (as near as two pixels a cell, the far side of the second box, a mirror of a third), so that a face of windows
    // straddling one of them has no line across it and none comes and goes as the eye moves: the rest is what is
    // likely there. (Hard edges showed as a line across a tower at each, and the tower's look jumped as the eye passed.)
    var fade = 0.0;
    if (goes) {
      let lv = g.level[hit.level];
      let q = (p - lv.boxMin) * lv.scale;
      let side = min(q, lv.boxSize - q);
      let edge = select(1e9, min(side.x, min(side.y, side.z)), hit.level == 1u);
      fade = smoothstep(${THROUGH}, ${THROUGH} * 1.5, across) * smoothstep(0.0, 48.0, edge) * smoothstep(0.33, 0.26, mirror);
    }
    if (fade < 1.0) {
      // What is likely behind a pane not looked through: from outside, a room about as bright as near rooms come out
      // by day; seen through another pane, the day outside, a little darker than the haze.
      let room = (g.lightFill.rgb * 0.3 + g.lightSun.rgb * g.lightSun.a * 0.12) * 0.35 * INDOORS;
      add += through * (1.0 - fade) * select(room, skyBase(vec3f(rd.x, max(rd.y, 0.02) * 0.3, rd.z)) * 0.7, panes > 1u);
      through *= fade;
    }
    col += keep * add;
    keep *= through;
    // The first pane looked through: how far off, and what it lets through (what is drawn after the march tints by it).
    if (fade > 0.0 && panes == 1u) { seenThrough = vec4f(keep, hit.t); }
    if (max(keep.r, max(keep.g, keep.b)) < 0.02) { break; }
    last = leave; t0 = leave; level0 = hit.level;
    spread = g.pixel * max(g.detail, 2.0);
    most = min(g.most, 128u);
    lights = shadows * 2u;
    roomLit = 0.0;
    skyLit = mix(INDOORS, 1.0, g.weather.w);
  }
  if ((g.flags & 128u) == 0u && first >= 0.0) { col = mix(col, airColour, haze(rd, first)); }
  // The fog, over everything as far as the first thing met, and over the sky (a look that met nothing goes on for ever).
  if (FOGGY && (g.flags & 128u) == 0u) {
    // Seen from over it, its sunlit top is brighter than the fog one is in, and its billows are lit on their tops.
    let fog = fogged(rd, select(1e7, first, first >= 0.0));
    let over = smoothstep(0.0, 600.0, g.eye.y - g.sea - g.fog.y);
    col = mix(col, g.fogTint.rgb * (1.0 + over * (0.08 + 0.36 * (fog.y - 0.35))), fog.x);
  }
  if ((g.flags & 4u) != 0u) {
    // How hard each pixel was: steps as heat.
    let h = f32(work) / 128.0;
    return Drawn(vec4f(h, h * h, pow(h, 4.0), 1.0), seenThrough, depth);
  }
  if ((g.flags & 8u) != 0u) { return Drawn(vec4f(f32(work & 255u) / 255.0, f32(work >> 8u) / 255.0, 0.0, 1.0), seenThrough, depth); }
  // Beside the colour, how far brighter than any lit surface the pixel is (a lamp, a sign, a fire), as one less
  // that: the last pass spreads those into a glow at night, which the colour alone, cut off at white, cannot say.
  return Drawn(vec4f(tone(col), 1.0 - clamp((max(col.r, max(col.g, col.b)) - 1.2) / 3.0, 0.0, 1.0)), seenThrough, depth);
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
/** What the march leaves for what is drawn after it (Marcher.panes). */
/** The fog bank (#450) when it is all in: how thick a finest cell (a third left in 260 m), and its top over the sea, 140 m. */
const FOG_THICK = 1 / 2400, FOG_TOP = 1400
export const PANES_FORMAT: GPUTextureFormat = 'rgba16float'
/** Tiles of the sun's maps drawn each frame. */
const SUN_TILES_A_FRAME = 8

export interface Marcher {
  /** Draws the world into `to`, and how far off each pixel's thing is into its depth. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, flags: number, time: number, timing?: GPURenderPassTimestampWrites, /** Only these pixels of `to` are drawn: x, y, width, height. */ only?: readonly [number, number, number, number], /** Looks begin at this plane and not at the eye: its normal (pointing the way the looks go) and how far along it the plane is, in the world's finest cells. */ starts?: readonly [number, number, number, number]): void
  /** The world's buffers on the GPU are others than they were (world.ts `trade`): they are bound again. */
  rebind(): void
  /**
   * The shader made again from its text as `change` returns it, while the page draws (#264, the workshop): the new
   * pipelines are built in the background and take over between two frames. A shader that does not compile throws,
   * and the one that was drawing goes on. Answers how long the text took to compile and how long it all took, ms.
   * What it does to a frame's cost is not known until it is measured: `node test/bench.mjs` before and after.
   */
  reshade(change: (wgsl: string) => string): Promise<{ compiled: number; ms: number }>
  /** Draws a few tiles of the sun's maps as they stand for this view. Once a frame, before `draw`, in the same commands. `ready` is whether the world is made enough to draw them from. */
  tend(encoder: GPUCommandEncoder, view: View, ready: boolean): void
  /** The sun's maps: an edit must spoil the tiles it touches. */
  readonly sun: SunMaps
  /** The colours and materials as the GPU holds them, for whatever else is drawn into the picture. */
  readonly looks: GPUBuffer
  /** What the shaders are told of the view, the boxes and the sun's maps (GLOBALS), for whatever else is lit by them. */
  readonly globals: GPUBuffer
  /**
   * What the march leaves beside its picture for what is drawn after it (#163), for a picture of this size: where a
   * pane is looked through, what it lets through (rgb) and how far off it is along the look (a, finest cells); all 0
   * elsewhere. The depth the march writes is of what is behind the pane, so that what stands in a room is drawn
   * there; what aims at what is met (the wand) and what is tinted by the pane read this.
   */
  panes(size: readonly [number, number]): GPUTextureView
  /** Whether the maps are used for shadows (they are, unless a check wants every shadow traced). */
  maps: boolean
  /** What is straight ahead of a view: how far in the finest cells, what it is made of, its colour in the palette. Null for sky. */
  /** What is straight ahead: how far (finest cells), of what, what colour. `plain` asks without the skips over empty air. */
  pick(view: View, plain?: boolean): Promise<{ t: number; material: number; colour: number } | null>
  /** How many pixels wide a thing must be to be drawn as itself: 1 is every cell that can be seen, 2 is half as fine. */
  detail: number
  /** How hard it rains, 0 to 1: the sky greys, the ground is wet and mirrors, lights come on. */
  rain: number
  /** How overcast the sky is, 0 to 1: grey as rain greys it, with the ground dry. */
  cloud: number
  /** How far the sea's fog has come in (#450), 0 to 1: how thick the bank is west of its front (`front`). */
  fog: number
  /** Where the fog's front stands (finest cells east, as the world counts them): west of it is fog. */
  front: number
  /** Whether the eye is under the sea: what is in it is then lit as under water. */
  under: boolean
  /** How far the eye is in a room, 0 to 1 (main.ts says): what is shaded is lit by the daylight a room lets in (shade). */
  roofed: number
  /** Where the light comes from, how much of the day it is (1 day, 0 night) and how low the sun (1 at the horizon). */
  light(sun: readonly [number, number, number], day: number, low: number): void
  readonly day: number
}

/** `behind`: a marcher for a world seen through a window, whose looks may begin at a plane (`draw`'s `starts`). */
export async function marcher(device: GPUDevice, format: GPUTextureFormat, world: World, behind = false): Promise<Marcher> {
  const grid = world.options.grid
  const module = await shader(device, 'march', code(world, behind))
  // The sun stands in the south-west, two fifths of the way up.
  const sunMaps = new SunMaps(device, world.levels.length, [0.52, 0.62, 0.59])
  let maps = true
  // The pipelines of a shader module: the march with mirrors and without (MIRRORS), and the sun's maps. Made in the background: nothing waits on them but whoever asked (`reshade` makes them again while the old ones go on drawing).
  // One layout for both, so that one binding serves either.
  const F = GPUShaderStage.FRAGMENT
  const marchLayout = device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, buffer: {} }, { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: F, buffer: {} }, { binding: 4, visibility: F, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }] })] })
  const marchingAs = (module: GPUShaderModule, mirrors: boolean, foggy = false) => device.createRenderPipelineAsync({ label: `march${mirrors ? '' : ' without mirrors'}${foggy ? ' in fog' : ''}`, layout: marchLayout, vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', constants: { MIRRORS: mirrors ? 1 : 0, FOGGY: foggy ? 1 : 0 }, targets: mirrors ? [{ format }, { format: PANES_FORMAT }] : [{ format }] }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' } })
  const marching = (module: GPUShaderModule) => Promise.all([marchingAs(module, true), marchingAs(module, false)])
  const sunning = (module: GPUShaderModule) => device.createRenderPipelineAsync({ label: 'sun map', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs_sun', targets: [{ format: 'r32float' }] } })
  let [pipeline, plainPipeline] = await marching(module)
  // The same in fog (FOGGY), made the first time there is fog, and made again with the shader: until they are made a
  // look is drawn as without it, which is the fog's first moment as it comes in (it comes in over seconds).
  let shaderNow = module, foggy: GPURenderPipeline[] | null = null, makingFoggy: Promise<unknown> | null = null
  const fogPipelines = () => {
    if (foggy || makingFoggy) return foggy
    const of = shaderNow
    makingFoggy = Promise.all([marchingAs(of, true, true), marchingAs(of, false, true)]).then((made) => { if (of === shaderNow) foggy = made }).finally(() => { makingFoggy = null })
    return null
  }
  // The panes beside each size of picture the march draws (a few: the page's, a measure's, the one pixel a pick asks).
  const panesKept = new Map<string, GPUTexture>()
  const panesFor = (size: readonly [number, number]) => {
    const key = `${size[0]}x${size[1]}`
    let t = panesKept.get(key)
    if (!t) {
      if (panesKept.size >= 4) { const [oldest, gone] = panesKept.entries().next().value!; gone.destroy(); panesKept.delete(oldest) }
      t = device.createTexture({ size: [size[0], size[1]], format: PANES_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      panesKept.set(key, t)
    }
    return t
  }
  const panesViews = new WeakMap<GPUTexture, GPUTextureView>()
  // Those a march with mirrors has written: one without them (which writes none) clears them first.
  const panesWritten = new WeakSet<GPUTexture>()
  const panesView = (size: readonly [number, number]) => { const t = panesFor(size); let v = panesViews.get(t); if (!v) { v = t.createView(); panesViews.set(t, v) } return v }
  const globals = device.createBuffer({ size: 144 + MAX_LEVELS * 128 + 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const looks = device.createBuffer({ size: 256 * 16 + 16 * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(looks, 0, palette())
  device.queue.writeBuffer(looks, 256 * 16, materials())
  const binding = () => device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }, { binding: 3, resource: { buffer: looks } }, { binding: 4, resource: sunMaps.all }],
  })
  let bind = binding()
  // The pass that draws a tile of a sun map: the same rays, sent through, into one layer.
  let sunPipeline = await sunning(module)
  const sunBinding = () => device.createBindGroup({ layout: sunPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }] })
  let sunBind = sunBinding()
  const sunTiles = Array.from({ length: SUN_TILES_A_FRAME + 1 }, () => {
    const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    return { buffer, bind: device.createBindGroup({ layout: sunPipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer } }] }) }
  })
  const block = new ArrayBuffer(144 + MAX_LEVELS * 128 + 176), f = new Float32Array(block), u = new Uint32Array(block), i32 = new Int32Array(block)
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
    // Rain and an overcast sky: the sun is behind cloud, the sky and its fill go grey, the clouds darken. A sky of fog
    // is a little of that: over the bank the sky stays blue, as over the Golden Gate it does. (Rain was the only grey: it still is
    // where the others are clear, so a dry clear day is told exactly what it was told before.)
    const overcast = Math.max(rain, cloud, 0.2 * fog)
    const some = 0.42 + 0.58 * day, grey = times([0.4, 0.43, 0.48], some), wet = (c: Colour, by = 0.85) => mix(c, grey, overcast * by)
    f.set([
      ...times(mix(times([0.45, 0.58, 0.9], 0.26), times(mix([0.8, 0.74, 0.64], [1, 0.52, 0.26], low), 1 - 0.45 * low), day), 1 - 0.8 * overcast), day * (1 - 0.5 * low) * (1 - 0.6 * overcast),
      ...wet(times(mix([0.19, 0.28, 0.5], [0.3, 0.26, 0.4], low), some), 0.7), some,
      ...wet(hour([0.006, 0.01, 0.03], [0.07, 0.22, 0.62], [0.07, 0.11, 0.36])), 0.42 + 0.18 * low,
      ...wet(hour(dark, [0.5, 0.66, 0.88], [0.62, 0.4, 0.46])), 1.1 * low * day * (1 - overcast),
      ...wet(hour(dark, [0.5, 0.66, 0.88], [1.25, 0.5, 0.1])), sx / flat,
      ...times(hour(cloudy, white, [0.4, 0.26, 0.4]), 1 - 0.5 * overcast), sz / flat,
      ...times(hour(cloudy, white, [1.5, 0.66, 0.22]), 1 - 0.5 * overcast), (30 - 18 * low) * (1 - overcast),
      // Lights come on as the day goes (the same ease as a shader's smoothstep), in rain, and a little in fog and under cloud.
      rain, rain, Math.max(1 - ((t) => t * t * (3 - 2 * t))(Math.max(0, Math.min(1, (day - 0.55) / 0.4))), 0.7 * rain, 0.45 * fog, 0.25 * cloud), roofed,
    ], 36 + MAX_LEVELS * 32)
    // The fog's colour: by day white lit through, grey under cloud, warm under a low sun; at night the city's lamps
    // light it from under, a dull amber over a dark blue.
    const s = (144 + MAX_LEVELS * 128 + 128) / 4
    const lit = mix(mix([0.8, 0.82, 0.85], [0.95, 0.72, 0.6], low), [0.6, 0.62, 0.66], Math.max(rain, cloud) * 0.8)
    f.set(mix([0.07, 0.065, 0.075], times(lit, 0.9), Math.min(1, day * 1.15)), s + 8)
  }
  /** Tells the shader the view, the boxes and the sun's maps. Returns the corner near the eye that everything is measured from. */
  const tell = (view: View, size: readonly [number, number], flags: number, time: number, starts?: readonly [number, number, number, number]) => {
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
        const told = sunMaps.tell(k, anchor as [number, number, number]), sunAt = 36 + MAX_LEVELS * 20 + k * 12
        f.set(told.base, sunAt)
        u.set(told.drawn, sunAt + 4)
        const at = 36 + k * 20, cell = 1 << k, { low, high } = level.whole
        for (let a = 0; a < 3; a++) {
          f[at + a] = low[a] * SIDE * cell - anchor[a]
          f[at + 4 + a] = (high[a] - low[a]) * SIDE
          u[at + 8 + a] = ((low[a] % grid[a]) + grid[a]) % grid[a]
          i32[at + 12 + a] = low[a] * SIDE
        }
        f[at + 3] = 1 / cell
        f[at + 7] = level.roof - anchor[1]
        for (let q = 0; q < 4; q++) f[at + 16 + q] = level.roofs[q] - anchor[1]
      })
      // Where looks begin: the plane's normal, and how far along it the plane is from the corner everything is measured from.
      const s = (144 + MAX_LEVELS * 128 + 128) / 4
      if (starts) f.set([starts[0], starts[1], starts[2], starts[3] - starts[0] * anchor[0] - starts[1] * anchor[1] - starts[2] * anchor[2]], s); else f.fill(0, s, s + 4)
      // The fog (#450): how thick, its top, its front and the corner, measured as the eye is; its colour is the hour's (colours).
      f.set([fog * FOG_THICK, FOG_TOP, front - anchor[0], anchor[0]], s + 4)
      f[s + 11] = anchor[2]
      device.queue.writeBuffer(globals, 0, block)
      return anchor as [number, number, number]
  }
  let detail = 1, day = 1, low = 0, under = false, rain = 0, roofed = 0, cloud = 0, fog = 0, front = 0
  colours()
  // One pixel to ask what is under a point.
  const pointTexture = device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
  const point: Target = { color: pointTexture.createView(), depth: device.createTexture({ size: [1, 1], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView(), size: [1, 1] }
  const pointRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const once = async (view: View, plain: boolean) => {
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
  }
  let picking: Promise<unknown> = Promise.resolve()
  const self: Marcher = {
    get rain() { return rain },
    set rain(v: number) { rain = Math.max(0, Math.min(1, v)); colours() },
    get cloud() { return cloud },
    set cloud(v: number) { cloud = Math.max(0, Math.min(1, v)); colours() },
    get fog() { return fog },
    set fog(v: number) { fog = Math.max(0, Math.min(1, v)); colours() },
    get front() { return front },
    set front(v: number) { front = v },
    get under() { return under },
    set under(v: boolean) { under = v },
    get roofed() { return roofed },
    set roofed(v: number) { if (v !== roofed) { roofed = v; colours() } },
    get detail() { return detail },
    set detail(v: number) { detail = v },
    get day() { return day },
    light(sun, isDay, isLow) { sunMaps.turn(sun); day = isDay; low = isLow; colours() },
    pick(view, plain = false) {
      // One at a time: there is one buffer to read the answer from, and a tool and the wand may both be asking.
      const next = picking.then(() => once(view, plain))
      picking = next.catch(() => {})
      return next
    },
    get sun() { return sunMaps },
    get looks() { return looks },
    get globals() { return globals },
    panes: panesView,
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
    rebind() { bind = binding(); sunBind = sunBinding() },
    async reshade(change) {
      const began = performance.now(), next = await shader(device, 'march', change(code(world, behind)))
      const compiled = performance.now() - began, [[a, plain], b] = await Promise.all([marching(next), sunning(next)])
      // Between two frames: the pipelines, and everything bound by their layouts.
      pipeline = a; plainPipeline = plain; sunPipeline = b; bind = binding(); sunBind = sunBinding()
      shaderNow = next; foggy = null
      for (const t of sunTiles) t.bind = device.createBindGroup({ layout: sunPipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: t.buffer } }] })
      return { compiled, ms: performance.now() - began }
    },
    draw(encoder, to, view, flags, time, timing, only, starts) {
      tell(view, to.size, flags, time, starts)
      // With mirrors off no pane is looked through, and the march writes no panes (writing them was 1 to 2% of its time with mirrors off).
      const mirrors = (flags & MIRRORS) !== 0, panes = panesFor(to.size)
      if (mirrors) panesWritten.add(panes)
      else if (panesWritten.has(panes)) { encoder.beginRenderPass({ colorAttachments: [{ view: panesView(to.size), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end(); panesWritten.delete(panes) }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }, ...(mirrors ? [{ view: panesView(to.size), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const] : [])],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        ...(timing ? { timestampWrites: timing } : {}),
      })
      // With mirrors off, the pipeline that has none of their text (MIRRORS): its bindings are the same.
      const inFog = fog > 0 ? fogPipelines() : null
      pass.setPipeline(inFog ? inFog[mirrors ? 0 : 1] : mirrors ? pipeline : plainPipeline)
      pass.setBindGroup(0, bind)
      if (only) pass.setScissorRect(only[0], only[1], only[2], only[3])
      pass.draw(3)
      pass.end()
    },
  }
  return self
}
