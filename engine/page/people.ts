// People (#218). Everyone in the world, person, agent or resident, is one figure: boxes of cells
// half the world's size (5 cm: a face and a hand need them), jointed at hip, knee, shoulder, elbow
// and neck. A figure is never cells of the world, so the rays do not see it: all the figures in
// sight are drawn in one call over the marched picture, tested against its depth, lit as the world
// is lit (the sun through the sun's maps, the sky, the street lamps by the town's rule) and each
// with its shadow laid on the ground under it. `figure` is the one place that says what a person
// looks like and how one moves.
import { shader, type Target } from '../probe/gpu.ts'
import type { DynamicShadows } from './dynamic-shadows.ts'
import { GLOBALS, LIGHT, SUNLIT, type Marcher, type View } from './march.ts'
import { LOCAL_LIGHTS_STRUCT, localLightsEval } from './lights.ts'
import { CHANNELS, play, type Channel, type Move } from './moves.ts'
import { CARRIED, OWN, WORN, named, type Extra, type Look, type Part } from './wear.ts'
import { chance, residents, type Land, type Resident, type Shock } from './residents.ts'

/** One person, as whoever draws them is told. Lengths are the world's finest cells (10 cm). */
export interface Person {
  /** Where the feet are. */
  at: readonly [number, number, number]
  /** Which way they face: 0 is north (-z), a quarter turn is east. */
  yaw: number
  /** The turn from their own upright to the world's (x, y, z, w), about the feet: someone whose down is not the world's stands on a wall by it. Left alone they stand as the world does. */
  frame?: readonly [number, number, number, number]
  /** Who they are to look at: build, clothes and colours all come of this number. */
  seed: number
  /** What was chosen for them in place of what the number gives (a rule's actor, #264). */
  look?: Look
  /** How far through a pair of steps they are, in turns. Left alone they stand. */
  stride?: number
  /** How much of a walk it is, 0 standing to 1 walking: the legs and arms swing by it. */
  walking?: number
  /** How much of that walk is a run, 0 to 1 (`runningAt` of its pace): a runner's stride is longer (`strideAt`). */
  running?: number
  /** How fast it is going, cells a second: the feet stay where they are put at that pace. Left out, it is taken from `running`, which cannot tell a fast run from a faster one. */
  pace?: number
  /** What it is doing with its limbs (moves.ts): the move, how many seconds into it, and where it is aimed (the world's cells), if it is aimed. Laid over the walk or the standing. */
  move?: Doing
  /** The move it was in before this one, still running: this one takes over from it without a jump. */
  was?: Doing
  /** Whether an umbrella is up over them. */
  umbrella?: boolean
  /** Which way the head is turned from the body, radians to the right. */
  glance?: number
  /** 0 to 1: shrunk from something, arms over the head. */
  flinch?: number
  /** 0 standing to 1 lying on the ground. */
  down?: number
  /** Something struck them: how many seconds ago, and the way it pushed them (the world's axes). They reel that way and come upright again. */
  struck?: { t: number; way: readonly [number, number, number] }
  /** What they hold up before them and look at (a phone), 0 to 1. */
  reading?: number
  /** Holding up a phone forward at eye/chest level to film something ahead, 0 to 1. */
  filming?: number
  /** The stopped taxi this pedestrian is watching or addressing. */
  robotaxiId?: number
  /** Seconds, for what a body does while it stands: it shifts and breathes. */
  time?: number
  /** Their name, shown over their head, and what they are saying now, under it. Both are text someone typed: drawn as letters, nothing more. */
  name?: string
  says?: string
}

/** A move under way: how far in (seconds), and what it is aimed at. */
export interface Doing { move: Move; t: number; aim?: readonly [number, number, number] }

/** Floats a box: where its middle is, a number of its own; half its size, how big its cells are; two of its three axes with the height of the feet and what it is made as; its colour. */
export const EACH = 24
const MOST = 24_000
/** What a box is made as: cloth is knit, skin is smooth, leather shines a little, screen glows cleanly at night. */
const CLOTH = 0, SKIN = 1, LEATHER = 2, HAIR = 3, SCREEN = 4

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, lamps: f32,
  forward: vec3f, pad1: f32,
  // Where the anchor is in its block of the town (city.rs: 1280 cells by 800), for the street lamps.
  block: vec2f, pad2: vec2f,
}
@group(0) @binding(0) var<uniform> u: U;
${GLOBALS}
${LOCAL_LIGHTS_STRUCT}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
// Where the march looked through a pane of glass: what it lets through, and how far off it is (march.ts panes, #163).
@group(1) @binding(2) var panes: texture_2d<f32>;
@group(1) @binding(3) var<uniform> localLights: LocalLights;
${SUNLIT}
${LIGHT}
${localLightsEval()}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) q: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) c0: vec3f,
  @location(3) seen: vec3f,
  @location(4) @interpolate(flat) colour: vec4f,
  @location(5) @interpolate(flat) more: vec4f,
  @location(6) @interpolate(flat) c1: vec3f,
  @location(7) @interpolate(flat) half: vec3f,
  @location(8) @interpolate(flat) form: vec4f,
}
const NEAR = 1.0;
const FAR = 100000.0;
fn project(world: vec3f) -> vec4f {
  let d = dot(world, u.forward);
  return vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
}
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) mid: vec4f, @location(1) half: vec4f, @location(2) c0: vec4f, @location(3) c1: vec4f, @location(4) colour: vec4f, @location(5) form: vec4f) -> Out {
  let face = v / 6u;
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u] * 2.0 - 1.0;
  let axis = face >> 1u;
  let side = f32(face & 1u) * 2.0 - 1.0;
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  if (axis == 0u) { p = vec3f(side, corner.x, corner.y * side); n = vec3f(side, 0.0, 0.0); }
  else if (axis == 1u) { p = vec3f(corner.x, side, -corner.y * side); n = vec3f(0.0, side, 0.0); }
  else { p = vec3f(corner.x, corner.y * side, side); n = vec3f(0.0, 0.0, side); }
  // What is drawn is the hull of the shape: a box narrowed at whichever end the shape is.
  let narrow = select(form.y, form.x, p.y > 0.0);
  // A shape's hull is half a cell bigger each way, so that no cell of it is cut by the hull.
  // How many pixels wide one of its cells is from here: under one, a shape is drawn as its hull alone.
  let sharp = half.w / (max(length(mid.xyz - u.eye), 1.0) * g.pixel);
  let carved = colour.a > 0.0 && sharp > 0.9;
  let hull = vec3f(p.x * narrow, p.y, p.z * narrow) * half.xyz + p * select(0.0, half.w * 0.5, carved);
  let c2 = cross(c0.xyz, c1.xyz);
  let world = mid.xyz + c0.xyz * hull.x + c1.xyz * hull.y + c2 * hull.z - u.eye;
  var out: Out;
  out.pos = project(world);
  out.q = hull;
  out.n = n;
  out.seen = world;
  out.colour = vec4f(colour.rgb, select(0.0, colour.a, carved));
  // The cells' size, a number of the box's own, how high the feet are, what it is made as.
  out.more = vec4f(half.w, mid.w, c0.w, c1.w);
  out.c0 = c0.xyz;
  out.c1 = c1.xyz;
  out.half = half.xyz;
  out.form = form;
  return out;
}
fn hash3(c: vec3f) -> f32 {
  return fract(sin(dot(c, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}
// The street lamps' light on a face: the same nine places a block as the town's rule and the marcher's (city.rs,
// march.ts lit), each lamp's head 68 cells over the ground.
fn lamplight(at: vec3f, n: vec3f, feet: f32) -> f32 {
  let block = u.block + at.xz;
  var pool = 0.0;
  for (var k = 0; k < 9; k++) {
    let lamp = array<vec2f, 9>(vec2f(23.0, 9.0), vec2f(131.0, 23.0), vec2f(9.0, 117.0), vec2f(117.0, 131.0), vec2f(369.0, 35.0), vec2f(673.0, 105.0), vec2f(977.0, 35.0), vec2f(35.0, 361.0), vec2f(105.0, 581.0))[k];
    var to = lamp - block;
    to -= round(to / vec2f(1280.0, 800.0)) * vec2f(1280.0, 800.0);
    let line = vec3f(to.x, 68.0 - (at.y - feet), to.y);
    pool += (0.25 + 0.75 * max(dot(n, normalize(line)), 0.0)) / (1.0 + dot(to, to) / 6400.0);
  }
  return pool;
}
// Whether a cell (its middle, from the shape's middle) is of the shape: a box whose cross-section is rounded by
// \`e\` (2 an ellipse, 4 a soft square, more a box), narrowed towards an end (top, bottom) and rounded off at
// each end over a share of its length (caps).
fn field(c: vec3f, half: vec3f, form: vec4f, e: f32) -> f32 {
  let v = clamp(c.y / half.y, -1.0, 1.0);
  var r = mix(form.y, form.x, v * 0.5 + 0.5);
  let top = form.z;
  let low = form.w;
  if (v > 1.0 - top) { let k = (v - 1.0 + top) / top; r *= sqrt(max(1.0 - k * k, 0.0)); }
  if (v < low - 1.0) { let k = (low - 1.0 - v) / low; r *= sqrt(max(1.0 - k * k, 0.0)); }
  let a = abs(c.xz) / max(half.xz * r, vec2f(0.0001));
  return pow(a.x, e) + pow(a.y, e);
}
struct Lit { @location(0) colour: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fs(in: Out) -> Lit {
  let made = u32(in.more.w);
  let far = max(length(in.seen), 1.0);
  let rd = in.seen / far;
  let e = in.colour.a;
  let c2 = cross(in.c0, in.c1);
  var size = in.more.x;
  // How many pixels wide one of its cells is: under a few, the cells are not drawn, only their colour.
  let sharp = size / (far * g.pixel);
  var n = in.n;
  var at = in.q;
  var gone = 0.0;
  var round = vec3f(0.0);
  if (e > 0.0) {
    // A shape: the ray goes start cell to cell through the box until it meets one that is of the shape.
    let ld = vec3f(dot(rd, in.c0), dot(rd, in.c1), dot(rd, c2));
    let dir = select(ld, vec3f(0.00001), abs(ld) < vec3f(0.00001));
    let start = in.q + dir * (size * 0.002);
    // The cells are counted from the box's corner: a shape so many cells across ends on a cell's face.
    let low = start + in.half;
    var cell = floor(low / size);
    let way = sign(dir);
    let each = size / abs(dir);
    var next = ((cell + max(way, vec3f(0.0))) * size - low) / dir;
    var met = false;
    for (var k = 0; k < 72; k++) {
      let mid = (cell + 0.5) * size - in.half;
      if (any(abs(mid) > in.half + size)) { break; }
      if (field(mid, in.half, in.form, e) <= 1.0) { met = true; break; }
      if (next.x < next.y && next.x < next.z) { gone = next.x; next.x += each.x; cell.x += way.x; n = vec3f(-way.x, 0.0, 0.0); }
      else if (next.y < next.z) { gone = next.y; next.y += each.y; cell.y += way.y; n = vec3f(0.0, -way.y, 0.0); }
      else { gone = next.z; next.z += each.z; cell.z += way.z; n = vec3f(0.0, 0.0, -way.z); }
    }
    if (!met) { discard; }
    at = start + dir * gone;
    // Lit a little as the shape itself would be, not only as the cell's face is: the steps of a round limb then
    // read as one limb.
    let mid = (cell + 0.5) * size - in.half;
    let d = size * 0.5;
    let slope = vec3f(
      field(mid + vec3f(d, 0.0, 0.0), in.half, in.form, e) - field(mid - vec3f(d, 0.0, 0.0), in.half, in.form, e),
      field(mid + vec3f(0.0, d, 0.0), in.half, in.form, e) - field(mid - vec3f(0.0, d, 0.0), in.half, in.form, e),
      field(mid + vec3f(0.0, 0.0, d), in.half, in.form, e) - field(mid - vec3f(0.0, 0.0, d), in.half, in.form, e));
    let long = length(slope);
    if (long > 0.0001 && long < 1000.0) { round = slope / long; }
  }
  let seen = in.seen + rd * gone;
  let inside = at + in.half - n * (0.5 * size);
  let cell = floor(inside / size);
  let own = hash3(cell + vec3f(in.more.y * 91.0, in.more.y * 17.0, 3.0));
  var albedo = in.colour.rgb;
  // Each cell a shade of its own, and a seam between it and the next: knit. Skin is one piece.
  let wander = select(0.13, 0.04, made == ${SKIN}u);
  albedo *= 1.0 + wander * (own - 0.5) * clamp(sharp * 0.6, 0.0, 1.0);
  let f = fract((at + in.half) / size);
  let edge = min(f, 1.0 - f) + abs(n);
  let seam = 1.0 - smoothstep(0.0, 0.1, min(edge.x, min(edge.y, edge.z)));
  albedo *= 1.0 - seam * select(0.1, 0.04, made == ${SKIN}u) * clamp(sharp / 5.0 - 0.4, 0.0, 1.0);
  let soft = normalize(n + round * 1.2);
  let facing = normalize(in.c0 * soft.x + in.c1 * soft.y + c2 * soft.z);
  var direct = max(dot(facing, g.sun), 0.0);
  if (direct > 0.0) {
    let sunny = sunlit(seen + u.eye, facing, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  // A body shades itself a little towards the feet and where it faces down.
  let open = clamp(0.62 + 0.03 * (seen.y + u.eye.y - in.more.z) + 0.2 * facing.y, 0.45, 1.0);
  let rough = select(0.95, 0.5, made == ${LEATHER}u);
  var col = shade(albedo, facing, rd, g.sun, direct, open, rough, select(0.0, 2.2, made == ${SCREEN}u));
  if (g.weather.z > 0.0 && u.lamps > 0.0) {
    let lampAt = seen + u.eye;
    col += albedo * vec3f(1.0, 0.78, 0.48) * min(lamplight(lampAt, facing, in.more.z), 1.3) * g.weather.z * 1.5;
    // And what comes start windows and signs all round: without it a street at night is cut-outs.
    col += albedo * vec3f(0.9, 0.8, 0.7) * 0.06 * g.weather.z;
  }
  if (localLights.info.x > 0u) {
    col += evalLocalLights(seen + u.eye, facing, rd, albedo, rough, 0.0, 0.0);
  }
  // Wet cloth is darker, and shines a little towards the light.
  col *= 1.0 - 0.18 * g.weather.y * select(1.0, 0.0, made == ${SKIN}u);
  var lit: Lit;
  // Seen through a pane of the world's glass (someone in a room, from the street), tinted in linear space.
  let pane = textureLoad(panes, vec2i(in.pos.xy), 0);
  lit.colour = vec4f(max(col, vec3f(0.0)) * select(vec3f(1.0), pane.rgb, pane.a > 0.0 && length(seen) > pane.a), 1.0);
  let deep = max(dot(seen, u.forward), NEAR);
  lit.depth = FAR / (FAR - NEAR) * (1.0 - NEAR / deep);
  return lit;
}

// The shadow a figure lays on the ground: a patch from the feet away from the sun, as long as the sun is low,
// and a small dark round where the feet are that is there in any light.
struct Shade {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) at: vec3f,
  @location(2) @interpolate(flat) long: f32,
}
@vertex fn shadowVs(@builtin(vertex_index) v: u32, @location(0) feet: vec4f, @location(1) lie: vec4f) -> Shade {
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u];
  // Along: from a little behind the feet to the shadow's end. Across: the body's width.
  let along = lie.xy;
  let across = vec2f(-along.y, along.x);
  let reach = lie.z;
  let wide = feet.w;
  let a = mix(-wide, reach + wide, corner.x);
  let b = (corner.y * 2.0 - 1.0) * wide;
  let lay = along * a + across * b;
  let world = vec3f(feet.x + lay.x, feet.y + 0.12, feet.z + lay.y) - u.eye;
  var out: Shade;
  out.pos = project(world);
  out.uv = vec2f(a, b) / wide;
  out.at = world + u.eye;
  out.long = reach / wide;
  return out;
}
@fragment fn shadowFs(in: Shade) -> @location(0) vec4f {
  // The round under the feet.
  let near = 1.0 - smoothstep(0.3, 1.0, length(in.uv));
  // The long one: a strip with round ends, soft at its edges and softer the further from the feet.
  let x = clamp(in.uv.x, 0.0, in.long);
  let off = length(in.uv - vec2f(x, 0.0));
  let soft = 0.25 + 0.5 * x / max(in.long, 0.001);
  let thrown = (1.0 - smoothstep(1.0 - soft, 1.0, off / 0.85)) * (1.0 - 0.35 * x / max(in.long, 0.001));
  var sunny = 0.0;
  if (g.sun.y > 0.02 && in.long > 0.0) {
    sunny = sunlit(in.at, vec3f(0.0, 1.0, 0.0), 0u);
    if (sunny < 0.0) { sunny = 1.0; }
  }
  let day = g.lightSun.a;
  let dark = max(near * 0.38, thrown * sunny * 0.5 * clamp(day * 4.0, 0.0, 1.0) * (1.0 - g.weather.x));
  let linDark = 1.0 - pow(1.0 - clamp(dark, 0.0, 0.95), 2.0);
  return vec4f(0.0, 0.0, 0.0, linDark);
}
`

/** A name and what is said, over a head: letters drawn once on a sheet, shown on a board that faces the eye. */
const SIGN = /* wgsl */ `
struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, lamps: f32, forward: vec3f, pad1: f32, block: vec2f, pad2: vec2f }
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var sheet: texture_2d<f32>;
@group(1) @binding(1) var smooth_: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) show: f32 }
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) at: vec4f, @location(1) size: vec4f, @location(2) uv: vec4f) -> Out {
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u];
  // Its foot is over the head; it stands up from there, as wide and tall as it is told.
  let world = at.xyz - u.eye + u.right * ((corner.x - 0.5) * size.x) + u.up * (corner.y * size.y);
  let d = dot(world, u.forward);
  // Depth-bias speech/name pills forward by 2.8 m (28 cells) without altering screen position or scale so awnings & trees beside the speaker never slice text!
  let dz = max(NEAR + 0.5, d - 28.0);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (1.0 - NEAR / dz) * d, d);
  out.uv = mix(uv.xy, uv.zw, vec2f(corner.x, 1.0 - corner.y));
  out.show = at.w;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let s = textureSampleLevel(sheet, smooth_, in.uv, 0.0);
  let a = s.a * in.show;
  if (a <= 0.001) { return vec4f(0.0); }
  let unpre = clamp(s.rgb / max(s.a, 1e-4), vec3f(0.0), vec3f(1.0));
  return vec4f(pow(unpre, vec3f(2.2)) * 1.5 * a, a);
}
`
/** The sheet of letters: slots of 512 by 128, four across and eight down. */
const SLOT = [512, 128], SLOTS = [4, 8]

type V3 = readonly [number, number, number]
/** A joint's frame: its three axes in the world (right, up, back) and where it is. */
type Frame = Float64Array

/** Colours as light, not as a screen shows them. */
const tint = (hex: string): V3 => [0, 1, 2].map((c) => (parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255) ** 2.2) as unknown as V3
// The colours a figure's own number picks from are in wear.ts (OWN), where a rule can be told them.
const COATS = OWN.coats.map(tint), LEGS = OWN.legs.map(tint), SKINS = OWN.skins.map(tint), HAIRS = OWN.hairs.map(tint), BRIGHT = OWN.bright.map(tint)
const EYE: V3 = [0.012, 0.01, 0.01]
const SHOES = OWN.shoes.map(tint)
/** What shows under an open jacket or at a coat's neck, a belt and its buckle. */
const UNDER = ['#d8d4c8', '#b9b2a2', '#8fa3b5', '#3b3f45', '#6b2f2c', '#2f4a44', '#c2bfb4'].map(tint), BELT: V3 = tint('#241a12'), BUCKLE: V3 = tint('#b8a468')

const pick = <T>(from: readonly T[], seed: number, ask: number): T => from[Math.floor(chance(seed, ask) * from.length)]

const child = (out: Frame, of: Frame, x: number, y: number, z: number): Frame => {
  out.set(of)
  for (let a = 0; a < 3; a++) out[9 + a] = of[9 + a] + of[a] * x + of[3 + a] * y + of[6 + a] * z
  return out
}
/** Turns a frame about its own right: a limb that hangs swings forward. */
const pitch = (f: Frame, by: number) => {
  const c = Math.cos(by), s = Math.sin(by)
  for (let a = 0; a < 3; a++) { const y = f[3 + a], z = f[6 + a]; f[3 + a] = y * c + z * s; f[6 + a] = z * c - y * s }
}
/** About its own up: to the right. */
const turn = (f: Frame, by: number) => {
  const c = Math.cos(by), s = Math.sin(by)
  for (let a = 0; a < 3; a++) { const x = f[a], z = f[6 + a]; f[a] = x * c + z * s; f[6 + a] = z * c - x * s }
}
/** About its own back: leaning to the right. */
const roll = (f: Frame, by: number) => {
  const c = Math.cos(by), s = Math.sin(by)
  for (let a = 0; a < 3; a++) { const x = f[a], y = f[3 + a]; f[a] = x * c - y * s; f[3 + a] = y * c + x * s }
}

const T = new Float64Array(12), AX = new Float64Array(12), TOES = [0, 0]
const ROOT = new Float64Array(12), HIP = new Float64Array(12), LEG = new Float64Array(12), SHIN = new Float64Array(12), FOOT = new Float64Array(12)
const CHEST = new Float64Array(12), HEAD = new Float64Array(12), ARM = new Float64Array(12), FORE = new Float64Array(12), HELD = new Float64Array(12)
/** How long a pair of steps is, in cells: the feet then stay where they are put. */
export const STRIDE = 14.4
/** The cells a figure is made of: a quarter of the world's (2.5 cm). */
const CELL = 0.25
const THIGH = 4.5, CALF = 4, SOLE = 0.5

/** Where each joint is in a pose (moves.ts CHANNELS). */
const J = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>
const POSE = new Float64Array(CHANNELS.length), POSE_WAS = new Float64Array(CHANNELS.length)
/** How long one move takes to give way to the next (seconds): no joint jumps. */
const GIVE = 0.16
const smooth = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c) }
/** What `smooth` was given, from what it gave (0 to 1). */
const unsmooth = (v: number) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, v))) / 3)
/** How long a pair of steps is at a pace (cells a second): a walker's 14.4 cells, a runner's up to seven metres. Whoever moves a figure gives distance over this as `stride`. */
export const strideAt = (pace: number) => STRIDE + Math.max(0, Math.min(56, (pace - 16) * 0.5))
/** How much of a run a pace is, 0 a walk to 1 a run. */
export const runningAt = (pace: number) => smooth((pace - 18) / 16)
const NO_EXTRAS: Extra[] = []

/**
 * Writes a person's boxes into `out` from float `at`, places taken from `anchor`. Returns the float after the last.
 * `far` leaves out what cannot be seen from where it is looked at: 1 what is lost across a room (the whites of the eyes), 2 what is lost across a street (a thumb, buttons, ears), 3 or true what is lost from far off (hands, a face, a neck).
 */
export function figure(p: Person, out: Float32Array, at: number, anchor: V3, far: boolean | number = false): number {
  const level = far === true ? 3 : far === false ? 0 : far
  const s = p.seed
  // Build: how tall, how broad.
  const chosen = p.look, tinted = (hex: string | undefined, or: V3): V3 => (hex ? tint(hex) : or)
  const tall = (0.93 + 0.12 * chance(s, 1)) * (chosen?.tall ?? 1), broad = (0.9 + 0.22 * chance(s, 2)) * (chosen?.broad ?? 1)
  const coat = tinted(chosen?.coat, pick(COATS, s, 3)), skin = tinted(chosen?.skin, pick(SKINS, s, 5)), hair = tinted(chosen?.hair, pick(HAIRS, s, 6)), shoe = tinted(chosen?.shoes, pick(SHOES, s, 7))
  let legs = tinted(chosen?.legs, pick(LEGS, s, 4)), hands = skin
  const bright = pick(BRIGHT, s, 8)
  let long = chance(s, 9) < 0.45, hairstyle = Math.floor(chance(s, 10) * 5), scarf = chance(s, 11) < 0.3, bag = Math.floor(chance(s, 12) * 4), plain = false, suit = false
  const beard = chance(s, 43) < 0.16 && (hairstyle === 1 || hairstyle === 2)
  // What is worn and carried by name is boxes on parts of the body, and now and then a change to the figure itself.
  let extras = NO_EXTRAS
  const roles: Record<string, V3> = { coat, legs, skin, hair, shoes: shoe }
  const put = (thing: { thing: { boxes: Extra[] }; own: string }) => { for (const b of thing.thing.boxes) (extras === NO_EXTRAS ? (extras = []) : extras).push(b.colour === 'own' ? { ...b, colour: thing.own } : b) }
  if (chosen?.wear) for (const sent of chosen.wear) {
    const w = named(WORN, sent)
    if (!w) continue
    const set = w.thing.set
    if (set?.long !== undefined) long = set.long
    if (set?.legs === 'coat') legs = coat
    if (set?.hands === 'own') hands = tint(w.own)
    if (set?.hair) hairstyle = set.hair === 'bald' ? -1 : set.hair === 'short' ? 1 : 3
    if (set?.plain) { scarf = false; bag = 0; plain = true; if (hairstyle === 0) hairstyle = 1 }
    if (set?.lapels) suit = true
    put(w)
  }
  if (typeof chosen?.carry === 'string') { const c = named(CARRIED, chosen.carry); if (c) put(c) } else if (chosen?.carry) for (const b of chosen.carry) (extras === NO_EXTRAS ? (extras = []) : extras).push(b)
  if (chosen?.extra) for (const b of chosen.extra) (extras === NO_EXTRAS ? (extras = []) : extras).push(b)
  // A hat of any kind goes over the hair, not through a knitted cap of the figure's own.
  if (hairstyle === 0 && extras.some((b) => b.on === 'head' && b.at[1] > 2.4)) hairstyle = 1
  const walking = p.walking ?? 0, running = walking * (p.running ?? 0), flinch = p.flinch ?? 0, down = p.down ?? 0, reading = p.reading ?? 0, filming = p.filming ?? 0, time = p.time ?? 0
  const stride = (p.stride ?? 0) * Math.PI * 2
  const feet = p.at[1]
  let n = at
  /**
   * A shape in a part's frame: a box of cells, its cross-section rounded by `e` (2 an ellipse, 4 a soft square; 0 a
   * plain box), narrowed to `top` or `low` of its width at that end, and rounded off over `capT` and `capB` of
   * its length at each end. A limb is two of these that end round on the joint between them.
   */
  const shape = (f: Frame, x: number, y: number, z: number, w: number, h: number, d: number, colour: V3, made: number, e = 0, top = 1, low = 1, capT = 0, capB = 0) => {
    if (n + EACH > out.length) return
    for (let a = 0; a < 3; a++) out[n + a] = f[9 + a] + f[a] * x + f[3 + a] * y + f[6 + a] * z - anchor[a]
    out[n + 3] = (s % 9973) / 9973
    out[n + 4] = w / 2; out[n + 5] = h / 2; out[n + 6] = d / 2; out[n + 7] = CELL
    out[n + 8] = f[0]; out[n + 9] = f[1]; out[n + 10] = f[2]; out[n + 11] = feet - anchor[1]
    out[n + 12] = f[3]; out[n + 13] = f[4]; out[n + 14] = f[5]; out[n + 15] = made
    out[n + 16] = colour[0]; out[n + 17] = colour[1]; out[n + 18] = colour[2]; out[n + 19] = e
    out[n + 20] = top; out[n + 21] = low; out[n + 22] = capT; out[n + 23] = capB
    n += EACH
  }
  const box = (f: Frame, x: number, y: number, z: number, w: number, h: number, d: number, colour: V3, made: number) => shape(f, x, y, z, w, h, d, colour, made)
  /** The boxes worn or carried on a part, drawn in that part's frame (a hand's from the hand, down the forearm). */
  const wornOn = (part: Part, f: Frame, dy = 0, wider = 1) => { for (const b of extras) if (b.on === part) { const r = b.form; shape(f, b.at[0] * wider, b.at[1] + dy, b.at[2], b.size[0] * (b.size[0] > 2 ? wider : 1), b.size[1], b.size[2], roles[b.colour] ?? tint(b.colour), b.shiny ? LEATHER : CLOTH, r?.[0], r?.[1], r?.[2], r?.[3], r?.[4]) } }

  // ── The pose: what each joint would be doing anyway, then whatever move is laid over it. ──
  const P = POSE
  P.fill(0)
  // Going down and getting up is by way of sitting: from lying the chest comes up first, then the feet come under
  // and the body stands. (Tipped over stiff on its heels it was a board.)
  const sat = smooth((1 - down) / 0.5) * (1 - smooth((0.5 - down) / 0.5)), fold = sat
  P[J.crouch] = flinch * 0.55 + sat * 0.75
  P[J.lie] = smooth((down - 0.3) / 0.7)
  // A walk, and a run. Each foot is put down ahead and stays where it is put while the body goes over it, then is
  // lifted and brought forward; the leg's two angles are whatever reaches it. A walker has both feet down between
  // steps, a runner neither, and the faster the run the longer it is in the air.
  const pace = p.pace ?? (p.running ? 18 + 16 * unsmooth(p.running) : 16), pair = strideAt(pace)
  const thigh = THIGH * tall, calf = CALF * tall, most = thigh + calf
  const planted = Math.min(0.62 - 0.27 * running, 1.15 * most / pair), travel = planted * pair
  // How high the hips ride: so that the leg is all but straight as the foot comes down, a little higher as the body
  // passes over it.
  const turns = (p.stride ?? 0) - 0.25, stood = thigh + calf * Math.cos(0.06)
  // Which leg someone standing has their weight off (-1 to 1): it changes every ten seconds or so, each at their own time.
  const shift = Math.max(-1, Math.min(1, 2.5 * Math.sin(time * 0.31 + s * 2.3) + 0.8 * Math.sin(time * 0.13 + s)))
  // The foot comes down a little ahead of the hips and leaves the ground further behind them: the hips need drop
  // only so far that the leg reaches the foot in front, and behind, the heel lifts for what the leg lacks.
  const front = travel * 0.38, behind = travel - front
  const lowest = Math.sqrt(Math.max(1, (most * 0.992) ** 2 - front * front))
  const heel = Math.max(0, Math.min(stood, lowest) - Math.sqrt(Math.max(0, (most * 0.992) ** 2 - behind * behind))) + 0.15
  for (const side of [-1, 1]) {
    let at = turns + (side < 0 ? 0 : 0.5)
    at -= Math.floor(at)
    let ahead: number, up: number, toe: number
    if (at < planted) {
      const on = at / planted, off = smooth((on - 0.6) / 0.4)
      ahead = front - travel * on; up = heel * off
      // It lands on the heel with the toes up, lies flat, and leaves from the toes.
      toe = Math.asin(Math.min(0.9, up / 2.2)) - 0.22 * (1 - smooth(on / 0.18))
    } else {
      const back = (at - planted) / (1 - planted)
      ahead = -behind + travel * (1 - Math.cos(back * Math.PI)) / 2
      up = heel * (1 - back) ** 2 + (0.7 + 2.6 * running) * Math.sin(back * Math.PI) ** 1.5 * (1 + 0.6 * running * (1 - back))
      toe = Math.asin(Math.min(0.9, heel / 2.2)) * (1 - smooth(back / 0.5)) + (0.5 * running) * Math.sin(back * Math.PI) - 0.22 * smooth((back - 0.6) / 0.4)
    }
    TOES[side < 0 ? 0 : 1] = toe * walking
    // The hips are lowest as a foot comes down and all but as high as standing as the body passes over it: twice a
    // pair of steps, the same for both legs. (Kept low all the way, the walk was on bent knees.)
    const high = lowest + Math.max(0, stood * 0.985 - lowest) * (1 - 0.6 * running) * Math.sin(at * Math.PI * 2) ** 2
    const down = stood + walking * (Math.min(high, stood) - up - stood), reach = Math.min(Math.hypot(ahead * walking, down), most - 0.01), fore = ahead * walking
    const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + calf * calf - reach * reach) / (2 * thigh * calf))))
    P[side < 0 ? J.swingL : J.swingR] = Math.atan2(fore, down) + Math.acos(Math.max(-1, Math.min(1, (thigh * thigh + reach * reach - calf * calf) / (2 * thigh * reach))))
    // Standing, the weight is on one leg and then the other: the knee of the leg it is off is eased, that foot a little ahead.
    const eased = (1 - walking) * Math.max(0, side * shift)
    P[side < 0 ? J.swingL : J.swingR] += eased * 0.16
    P[side < 0 ? J.kneeL : J.kneeR] = bend + eased * 0.3
    const arm = stride + (side < 0 ? Math.PI : 0)
    P[side < 0 ? J.liftL : J.liftR] = walking * (0.4 + 0.55 * running) * Math.sin(arm) + flinch * 2.5
    P[side < 0 ? J.bendL : J.bendR] = 0.12 + (1 - walking) * (0.14 + 0.1 * chance(s, side < 0 ? 46 : 47)) + walking * (0.22 + 0.2 * Math.max(0, Math.sin(arm))) + running * 1.3 + flinch * 1.9
    P[side < 0 ? J.outL : J.outR] = flinch * 0.25
  }
  // Between a runner's steps both feet are off the ground.
  const flight = planted < 0.5 ? Math.max(0, Math.sin(((((turns % 0.5) + 0.5) % 0.5) - planted) / (0.5 - planted) * Math.PI)) : 0
  P[J.rise] = walking * flight * Math.min(2.2, 0.5 + pair * 0.03)
  P[J.lean] = walking * 0.06 + running * 0.24 + flinch * 0.55 + fold * 1.25
  P[J.twist] = walking * Math.sin(stride) * -0.1 * (1 + running * 1.4)
  P[J.turn] = (p.glance ?? 0) + (1 - walking) * Math.sin(time * 0.23 + s * 1.7) * 0.25 * (1 - Math.max(reading, filming))
  P[J.nod] = reading * 0.45 - filming * 0.06 + flinch * 0.4
  // One arm holds an umbrella up, films ahead with a raised phone, or holds a phone down while reading.
  if (p.umbrella) { P[J.liftR] = 0.25 + flinch * 1.5; P[J.bendR] = 1.75 }
  // A hand that grips a thing picked up (held.ts) carries it up: the elbow bent, the forearm level, so the thing stands out of the fist where it is seen.
  else if (extras.some((b) => b.on === 'gripR')) { P[J.liftR] = 0.12 + P[J.liftR] * 0.25; P[J.bendR] = 1.45 + running * 0.2 + flinch * 0.4 }
  else if (filming > 0) {
    // Arm extended cleanly forward toward the street incident (not folded back into the face!), left arm relaxed.
    const sway = Math.sin(time * 1.7 + s * 3.1) * 0.04
    P[J.liftR] = P[J.liftR] * (1 - filming) + filming * (1.08 + sway)
    P[J.bendR] = P[J.bendR] * (1 - filming) + filming * 0.48
    P[J.outR] = P[J.outR] * (1 - filming) + filming * 0.06
    P[J.liftL] = P[J.liftL] * (1 - filming) + filming * 0.10
    P[J.bendL] = P[J.bendL] * (1 - filming) + filming * 0.24
    P[J.outL] = P[J.outL] * (1 - filming) + filming * 0.04
  }
  else if (reading > 0) { P[J.liftR] = P[J.liftR] * (1 - reading) + reading * 0.35; P[J.bendR] = P[J.bendR] * (1 - reading) + reading * 1.85 }
  // Struck, the body goes the way the blow pushed it: the chest over that way at once, the head a moment behind it,
  // the arms flung out, a knee giving; and upright again inside a second.
  if (p.struck && p.struck.t >= 0 && p.struck.t < 1 && down < 0.5) {
    const t = p.struck.t, hard = smooth(t / 0.07) * (1 - smooth((t - 0.22) / 0.7)), late = smooth((t - 0.05) / 0.1) * (1 - smooth((t - 0.3) / 0.6))
    // The way, as the body has it: ahead of it, and to its right.
    const ahead = p.struck.way[0] * Math.sin(p.yaw) - p.struck.way[2] * Math.cos(p.yaw), right = p.struck.way[0] * Math.cos(p.yaw) + p.struck.way[2] * Math.sin(p.yaw)
    P[J.lean] += ahead * 0.55 * hard; P[J.tilt] += right * 0.42 * hard; P[J.twist] += right * 0.25 * hard
    P[J.nod] += -ahead * 0.35 * (hard - late) + ahead * 0.3 * late
    P[J.crouch] += 0.2 * hard
    // The leg on the side it goes to takes a step that way to hold it up.
    P[ahead < 0 ? J.swingR : J.swingL] += -ahead * 0.35 * hard
    for (const side of [-1, 1]) {
      P[side < 0 ? J.liftL : J.liftR] += (0.3 - ahead * 0.3) * hard
      P[side < 0 ? J.outL : J.outR] += (0.45 + side * right * 0.35) * hard
      P[side < 0 ? J.bendL : J.bendR] += 0.6 * hard
    }
  }
  let aim = p.move?.aim, going = false
  if (p.move) {
    const was = p.was, give = was ? smooth(p.move.t / GIVE) : 1
    if (was && give < 1) {
      // The move before gives way to this one: each joint goes from where that had it to where this has it.
      POSE_WAS.set(P)
      play(was.move, was.t, POSE_WAS)
      going = play(p.move.move, p.move.t, P)
      for (let c = 0; c < P.length; c++) P[c] = POSE_WAS[c] + (P[c] - POSE_WAS[c]) * give
      aim ??= was.aim
    } else going = play(p.move.move, p.move.t, P)
  }
  // A move that is aimed turns the body to what it is aimed at: the chest as far as a chest turns, the head the rest.
  // (Whoever moves the body turns its feet when it stands; walking, it faces where it goes and this is all of it.)
  if (aim && going) {
    const dx = aim[0] - p.at[0], dz = aim[2] - p.at[2]
    if (Math.hypot(dx, dz) > 3) {
      let by = Math.atan2(dx, -dz) - p.yaw
      by -= Math.round(by / (Math.PI * 2)) * Math.PI * 2
      const w = smooth(p.move!.t / 0.2), chest = Math.max(-1, Math.min(1, by))
      P[J.twist] += chest * w
      P[J.turn] = Math.max(-0.9, Math.min(0.9, by - chest)) * w
    }
  }

  // ── The body, built from the pose. ──
  // The legs first: how far each foot is under the hip says how high the hip is, so a foot is always on the
  // ground, the body rises and falls as it walks, and someone who sits is at the height of a seat.
  const crouch = P[J.crouch], sit = P[J.sit], lie = P[J.lie]
  const legOf = (side: number) => {
    let swing = P[side < 0 ? J.swingL : J.swingR] + crouch * 0.9, knee = P[side < 0 ? J.kneeL : J.kneeR] + crouch * 1.7
    swing += (1.5 - swing) * sit; knee += (1.5 - knee) * sit
    return { swing, knee, drop: THIGH * tall * Math.cos(swing) + CALF * tall * Math.cos(swing - knee) + SOLE }
  }
  const left = legOf(-1), right = legOf(1)
  const hipHigh = Math.max(left.drop, right.drop, 1.2) + P[J.rise]
  ROOT.fill(0)
  ROOT[0] = Math.cos(p.yaw); ROOT[2] = Math.sin(p.yaw); ROOT[4] = 1; ROOT[6] = -Math.sin(p.yaw); ROOT[8] = Math.cos(p.yaw)
  ROOT[9] = p.at[0]; ROOT[10] = p.at[1]; ROOT[11] = p.at[2]
  // By its own up: the whole figure is turned about the feet, and all that hangs from the root turns with it.
  if (p.frame && Math.abs(p.frame[3]) < 0.99999) { const [x, y, z, w] = p.frame; for (let a = 0; a < 9; a += 3) { const vx = ROOT[a], vy = ROOT[a + 1], vz = ROOT[a + 2], tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx); ROOT[a] = vx + w * tx + (y * tz - z * ty); ROOT[a + 1] = vy + w * ty + (z * tx - x * tz); ROOT[a + 2] = vz + w * tz + (x * ty - y * tx) } }
  if (lie !== 0) {
    // Onto the back (or the front), about the heels; lying, the body is on what it stands on.
    const rise = Math.abs(lie) * 1.3
    ROOT[9] += ROOT[3] * rise; ROOT[10] += ROOT[4] * rise; ROOT[11] += ROOT[5] * rise
    pitch(ROOT, lie * Math.PI / 2)
  }
  const sway = walking * Math.sin(stride) * 0.035 + (1 - walking) * (Math.sin(time * 0.6 + s) * 0.008 - shift * 0.035)
  child(HIP, ROOT, 0, hipHigh, 0)
  roll(HIP, sway)
  // How much of it is drawn: all of it near, less across a street, the least from far off.
  const close = level === 0, near = level <= 1, fine = level <= 2
  const shade = (c: V3, by: number): V3 => [c[0] * by, c[1] * by, c[2] * by]
  // What the figure's own number says of its build and how it is dressed besides: broad in the shoulder or the hip,
  // a jacket open over something, a jumper, or a shirt tucked in.
  const wide = chance(s, 41), shoulders = 1.05 - 0.1 * wide, hips = 0.95 + 0.12 * wide
  const waist = 0.8 + 0.16 * chance(s, 42) ** 2
  const top = long ? 0 : suit ? 5 : plain ? 1 : 2 + Math.floor(chance(s, 40) * 3)
  const under = pick(UNDER, s, 44)
  for (const side of [-1, 1]) {
    const leg = side < 0 ? left : right
    child(LEG, HIP, side * 1.02 * broad * hips, 0, 0)
    pitch(LEG, leg.swing)
    // A thigh ends round at the hip and at the knee, and a shin begins round there: bent, the knee is whole.
    shape(LEG, 0, -THIGH * tall / 2 + 0.05, 0, 1.65, THIGH * tall + 1.1, 1.9, legs, CLOTH, 2.6, 1, 0.82, 0.2, 0.2)
    child(SHIN, LEG, 0, -THIGH * tall, 0)
    pitch(SHIN, -leg.knee)
    shape(SHIN, 0, -CALF * tall / 2 + 0.3, 0.08, 1.45, CALF * tall + 0.6, 1.55, legs, CLOTH, 2.6, 1, 0.8, 0.3, 0)
    child(FOOT, SHIN, 0, -CALF * tall, 0)
    // The foot lies level on the ground but as the walk has it: toes up as it lands, down as it leaves.
    pitch(FOOT, leg.knee - leg.swing - TOES[side < 0 ? 0 : 1])
    // A shoe is long the way the foot points: its shape is told along that (right, ahead, up).
    AX.set(FOOT)
    for (let a = 0; a < 3; a++) { AX[3 + a] = -FOOT[6 + a]; AX[6 + a] = FOOT[3 + a] }
    shape(AX, 0, 0.62, -0.08, 1.3, 2.8, 0.85, shoe, LEATHER, 3, 0.8, 0.95, 0.3, 0.12)
    if (fine) box(FOOT, 0, -0.5, -0.62, 1.36, 0.14, 2.84, shade(shoe, 0.5), LEATHER)
  }
  // The trunk: hips, then the chest, narrower at the waist and round over the shoulders.
  shape(HIP, 0, 0.45, 0, 3.55 * broad * hips, 2, 2, long ? coat : legs, CLOTH, 3.5, 0.94, 1, 0, 0.3)
  child(CHEST, HIP, 0, 1.2, 0)
  // (A frame turned about its right by a positive angle tips its top back: a hanging limb swings forward, a chest leans back.)
  pitch(CHEST, -P[J.lean])
  roll(CHEST, -sway * 1.6 + P[J.tilt])
  turn(CHEST, P[J.twist])
  const across = 3.8 * broad * shoulders
  shape(CHEST, 0, 2.4, 0, across, 5, 2.25, coat, CLOTH, 4, 1, waist, 0.16, 0)
  if (long) {
    // A long coat hangs to the knee and opens a little as the legs move; its collar stands, its front is buttoned.
    shape(HIP, 0, -1.9, 0.08, 4.05 * broad * hips, 4.3 * (1 - sit * 0.6), 2.6 + walking * 0.5, coat, CLOTH, 6, 0.92, 1, 0, 0)
    if (fine) {
      box(HIP, 0, -1.7, -1.36 - walking * 0.25, 0.12, 3.6 * (1 - sit * 0.6), 0.1, shade(coat, 0.55), CLOTH)
      for (const lapel of [-1, 1]) { child(T, CHEST, lapel * 0.62, 4.0, -1.24); roll(T, lapel * 0.42); box(T, 0, 0, 0, 0.7, 1.9, 0.14, shade(coat, 0.82), CLOTH) }
      box(CHEST, 0, 4.55, -1.16, 0.75, 0.9, 0.1, under, CLOTH)
      if (near) for (let k = 0; k < 3; k++) box(CHEST, 0.45, 2.7 - k * 1.05, -1.25, 0.25, 0.25, 0.1, shade(coat, 0.45), LEATHER)
      box(HIP, 0, 1.15, 0, 3.6 * broad * waist + 0.25, 0.4, 2.5, shade(coat, 0.7), CLOTH)
    }
  } else if (top === 2) {
    // A jacket open over what is under it, its hem below the belt.
    shape(HIP, 0, 0.75, 0, 3.7 * broad * hips, 1.5, 2.25, coat, CLOTH, 4, 0.96, 1, 0, 0)
    if (fine) {
      box(CHEST, 0, 2.3, -1.16, 1.0, 4.7, 0.1, under, CLOTH)
      box(HIP, 0, 0.75, -1.16, 1.0, 1.5, 0.1, under, CLOTH)
      for (const lapel of [-1, 1]) { child(T, CHEST, lapel * 0.78, 4.25, -1.24); roll(T, lapel * 0.3); box(T, 0, 0, 0, 0.6, 1.3, 0.12, shade(coat, 0.8), CLOTH) }
    }
  } else if (top === 5) {
    // A suit's jacket: its hem over the hips, lapels down to the button, the shirt between them.
    shape(HIP, 0, 0.75, 0, 3.7 * broad * hips, 1.5, 2.25, coat, CLOTH, 4, 0.96, 1, 0, 0)
    if (fine) {
      for (const lapel of [-1, 1]) { child(T, CHEST, lapel * 0.66, 3.95, -1.2); roll(T, lapel * 0.36); box(T, 0, 0, 0, 0.55, 2.1, 0.14, shade(coat, 1.35), CLOTH) }
      if (near) for (let k = 0; k < 2; k++) box(CHEST, 0, 2.3 - k * 0.9, -1.2, 0.25, 0.25, 0.1, shade(coat, 0.5), LEATHER)
      box(HIP, 0, 0.5, -1.16, 0.1, 1, 0.1, shade(coat, 0.5), CLOTH)
    }
  } else if (top === 3) {
    // A jumper: a band at the hem, another at the neck.
    shape(HIP, 0, 0.95, 0, 3.65 * broad * hips, 1.1, 2.25, coat, CLOTH, 4, 1, 1, 0, 0)
    if (fine) { box(HIP, 0, 0.55, 0, 3.7 * broad * hips, 0.4, 2.36, shade(coat, 0.78), CLOTH); shape(CHEST, 0, 4.95, 0, 1.7, 0.5, 1.7, shade(coat, 0.78), CLOTH, 2.2) }
  } else if (top === 4 && fine) {
    // A shirt tucked in: a belt and its buckle, a collar, buttons.
    box(HIP, 0, 1.2, 0, 3.5 * broad * waist + 0.3, 0.4, 2.3, BELT, LEATHER)
    if (near) box(HIP, 0, 1.2, -1.18, 0.5, 0.4, 0.1, BUCKLE, LEATHER)
    for (const wing of [-1, 1]) { child(T, CHEST, wing * 0.5, 4.75, -1.15); roll(T, wing * -0.5); box(T, 0, 0, 0, 0.8, 0.45, 0.14, shade(coat, 1.15), CLOTH) }
    if (near) for (let k = 0; k < 4; k++) box(CHEST, 0, 3.9 - k * 0.95, -1.22, 0.2, 0.2, 0.08, shade(coat, 0.6), LEATHER)
  }
  if (scarf) {
    shape(CHEST, 0, 5.1, -0.05, 2.55, 1.05, 2.6, bright, CLOTH, 3, 1, 1, 0.4, 0.4)
    if (fine) box(CHEST, 0.6, 3.75, -1.3, 0.75, 2.4, 0.3, bright, CLOTH)
  }
  if (bag === 1) {
    // A pack on the back, its straps over the shoulders.
    shape(CHEST, 0, 2.6, 1.85, 2.75, 3.75, 1.5, pick(LEGS, s, 13), CLOTH, 4, 0.9, 1, 0.25, 0.1)
    if (fine) {
      box(CHEST, 0, 1.9, 2.62, 1.9, 1.5, 0.2, shade(pick(LEGS, s, 13), 0.7), CLOTH)
      for (const strap of [-1, 1]) { box(CHEST, strap * 1.15 * broad, 3.3, -1.24, 0.4, 3.2, 0.1, shade(pick(LEGS, s, 13), 0.7), CLOTH); box(CHEST, strap * 1.15 * broad, 4.98, 0.2, 0.4, 0.12, 2.9, shade(pick(LEGS, s, 13), 0.7), CLOTH) }
    }
  } else if (bag === 2 && fine) {
    // A bag at the hip, its strap across the chest.
    shape(HIP, 2.15 * broad * hips, 0.2, 0.1, 0.95, 2.5, 3, pick(BRIGHT, s, 14), LEATHER, 5, 1, 1, 0, 0.2)
    box(HIP, 2.68 * broad * hips, 0.9, 0.1, 0.1, 1.1, 3.05, shade(pick(BRIGHT, s, 14), 0.7), LEATHER)
    for (const face of [-1, 1]) { child(T, CHEST, 0.15, 2.9, face * 1.24); roll(T, -0.62 * face); box(T, 0, 0, 0, 0.35, 5.9, 0.1, shade(pick(BRIGHT, s, 14), 0.6), LEATHER) }
  }
  // What is worn on the trunk is as broad as the trunk is (it was told for a body of the usual breadth).
  if (extras !== NO_EXTRAS) { wornOn('hip', HIP, 0, Math.max(1, broad * hips)); wornOn('chest', CHEST, 0, Math.max(1, across / 3.7)) }
  // The head: a neck, a skull narrower at the jaw, a face, ears, hair.
  child(HEAD, CHEST, 0, 4.9, 0)
  turn(HEAD, P[J.turn])
  pitch(HEAD, -P[J.nod])
  if (fine) shape(HEAD, 0, 0.3, 0.05, 1.15, 1.1, 1.2, skin, SKIN, 2)
  shape(HEAD, 0, 1.75, -0.05, 1.75, 2.25, 2, skin, SKIN, 4, 1, 0.86, 0.3, 0)
  if (fine) {
    // Brows, eyes with their whites, a nose that stands out, a mouth: what makes it a face from across a street.
    const shadow: V3 = [skin[0] * 0.62, skin[1] * 0.55, skin[2] * 0.52], brow = hairstyle < 0 ? shade(hair, 0.6) : shade(hair, 0.75)
    for (const eye of [-1, 1]) {
      box(HEAD, eye * 0.42, 1.95, -1.08, 0.25, 0.25, 0.1, EYE, LEATHER)
      if (near) box(HEAD, eye * 0.47, 2.2, -1.08, 0.6, 0.1, 0.12, brow, HAIR)
      if (near) box(HEAD, eye * 0.93, 1.75, 0, 0.16, 0.6, 0.45, skin, SKIN)
    }
    box(HEAD, 0, 1.58, -1.17, 0.3, 0.7, 0.26, shade(skin, 0.9), SKIN)
    box(HEAD, 0, 1.08, -1.04, 0.75, 0.12, 0.1, shadow, SKIN)
    
  }
  if (beard && hairstyle !== 0 && fine) {
    shape(HEAD, 0, 0.98, -0.2, 1.85, 0.95, 1.8, hair, HAIR, 3.2, 1, 0.82, 0, 0.3)
    box(HEAD, 0, 1.25, -1.06, 0.95, 0.16, 0.1, hair, HAIR)
  }
  if (hairstyle === 0) {
    // A knitted cap pulled down: a dome, and its band turned up.
    shape(HEAD, 0, 2.75, 0, 2, 1, 2.25, bright, CLOTH, 3, 1, 1, 0.8, 0)
    if (fine) shape(HEAD, 0, 2.5, 0, 2.25, 0.5, 2.5, shade(bright, 0.8), CLOTH, 3.2)
  } else if (hairstyle > 0) {
    // Hair: a cap of it over the crown and down the back of the head, and what each cut adds.
    shape(HEAD, 0, 2.7, 0.1, 2, 0.75, 2.25, hair, HAIR, 3, 1, 1, 0.65, 0)
    shape(HEAD, 0, 1.75, 0.75, 2, 1.75, 1, hair, HAIR, 3.4, 1, 0.9, 0.2, 0.3)
    if (fine) for (const lock of [-1, 1]) box(HEAD, lock * 0.93, 2.15, 0.25, 0.2, 0.5, 1.1, hair, HAIR)
    if (hairstyle === 2 && fine) { box(HEAD, 0.35, 2.5, -1.0, 1.2, 0.3, 0.25, hair, HAIR); for (const lock of [-1, 1]) box(HEAD, lock * 0.94, 1.9, 0.3, 0.25, 1, 1.25, hair, HAIR) }
    if (hairstyle === 3) {
      // Long, to the shoulders, and down beside the face.
      shape(HEAD, 0, 0.75, 0.9, 2.1, 2.7, 0.8, hair, HAIR, 3.4, 1, 0.85, 0.1, 0.35)
      if (fine) for (const lock of [-1, 1]) shape(HEAD, lock * 0.95, 1.45, 0.1, 0.4, 2.3, 1.3, hair, HAIR, 3, 1, 0.7, 0.1, 0.4)
    } else if (hairstyle === 4) {
      // Tied back: a knot behind the crown, a fringe.
      shape(HEAD, 0, 2.35, 1.35, 1.05, 1.05, 1.05, hair, HAIR, 2, 1, 1, 0.5, 0.5)
      if (fine) box(HEAD, 0.3, 2.5, -1.0, 1.3, 0.3, 0.25, hair, HAIR)
    }
  }
  if (extras !== NO_EXTRAS) wornOn('head', HEAD)
  // Arms: each lifts, goes out from the body and bends as the pose says; one that aims lies straight along the
  // line from its shoulder to what is aimed at.
  for (const side of [-1, 1]) {
    const holds = side > 0 && (p.umbrella || reading > 0 || filming > 0)
    let lift = P[side < 0 ? J.liftL : J.liftR], bend = P[side < 0 ? J.bendL : J.bendR], out = P[side < 0 ? J.outL : J.outR], round = 0
    const aims = P[side < 0 ? J.aimL : J.aimR]
    child(ARM, CHEST, side * (2.05 * broad * shoulders + 0.5), 4.4, 0)
    if (aims > 0) {
      // Which way the thing is from this shoulder, in the chest's own frame: to the right, up, ahead. With nothing to aim at, straight ahead.
      let rightward = -side * 0.12, up = 0, ahead = 1
      if (aim) { const dx = aim[0] - ARM[9], dy = aim[1] - ARM[10], dz = aim[2] - ARM[11]; rightward = dx * CHEST[0] + dy * CHEST[1] + dz * CHEST[2]; up = dx * CHEST[3] + dy * CHEST[4] + dz * CHEST[5]; ahead = -(dx * CHEST[6] + dy * CHEST[7] + dz * CHEST[8]) }
      round = Math.max(-1.5, Math.min(1.5, Math.atan2(rightward, Math.max(ahead, 0.01)))) * aims
      lift += (Math.PI / 2 + Math.atan2(up, Math.hypot(rightward, ahead)) - lift) * aims
      bend += (0.05 - bend) * aims; out *= 1 - aims
    }
    turn(ARM, round)
    roll(ARM, side * (0.06 + out))
    pitch(ARM, lift)
    // An upper arm is round at the shoulder and the elbow, a forearm narrows to the wrist.
    shape(ARM, 0, -1.75, 0, 1.32, 3.8, 1.5, coat, CLOTH, 2.6, 1, 0.88, 0.36, 0.18)
    child(FORE, ARM, 0, -3.4, 0)
    pitch(FORE, bend)
    shape(FORE, 0, -1.3, 0, 1.24, 3.7, 1.34, coat, CLOTH, 2.6, 1, 0.8, 0.28, 0)
    if (fine) {
      // A hand: a palm that narrows to the fingers, and a thumb.
      shape(FORE, 0, -3.6, -0.05, 0.55, 1.2, 0.95, hands, SKIN, 3, 1, 0.8, 0, 0.4)
      if (near) box(FORE, -side * 0.05, -3.45, -0.6, 0.3, 0.55, 0.3, hands, SKIN)
    }
    if (extras !== NO_EXTRAS) wornOn(side > 0 ? 'handR' : 'handL', FORE, -3.5)
    if (side > 0 && extras !== NO_EXTRAS) wornOn('gripR', FORE, -3.5)
    if (holds && p.umbrella) {
      // The shaft stands upright whatever the arm does, and the canopy is a shallow dome with its ribs' ends.
      child(HELD, FORE, 0, -3.5, 0)
      for (let a = 0; a < 3; a++) { HELD[a] = ROOT[a]; HELD[3 + a] = a === 1 ? 1 : 0; HELD[6 + a] = ROOT[6 + a] }
      const dark = pick(COATS, s, 15), canopy = chance(s, 16) < 0.35 ? bright : dark
      box(HELD, 0, 4.2, 0, 0.3, 10, 0.3, SHOES[0], LEATHER)
      shape(HELD, 0, 9.1, 0, 11.5, 1.6, 11.5, canopy, CLOTH, 2, 0.35, 1, 0.5, 0)
      box(HELD, 0, 10.1, 0, 0.3, 0.8, 0.3, SHOES[0], LEATHER)
    } else if (holds && filming > 0 && fine) {
      // Upright smartphone held out in front of the extended hand: dark chassis, emissive bright screen facing the filmer (+z), glowing red REC lens facing the street (-z).
      child(HELD, FORE, 0, -3.55, 0)
      for (let a = 0; a < 3; a++) { HELD[a] = ROOT[a]; HELD[3 + a] = a === 1 ? 1 : 0; HELD[6 + a] = ROOT[6 + a] }
      pitch(HELD, -0.10)
      box(HELD, 0, 0.72, -0.20, 0.96, 1.82, 0.22, SHOES[0], LEATHER)
      box(HELD, 0, 0.74, -0.06, 0.78, 1.54, 0.08, [0.72, 0.94, 1.0], SCREEN)
      box(HELD, 0.22, 1.32, -0.34, 0.26, 0.26, 0.08, [1.0, 0.18, 0.10], SCREEN)
    } else if (holds && fine) {
      box(FORE, 0, -3.9, -0.5, 0.75, 1.5, 0.2, SHOES[0], LEATHER)
    }
  }
  return n
}

export interface People {
  /** Who is drawn, until told otherwise. Asked afresh each frame, with the view, so that whoever gives them can leave out those out of sight. */
  from: ((view: View, seconds: number) => readonly Person[])[]
  /** Packs visible figures, shadows and speech boards and uploads buffers before a render pass begins; returns true when at least one person will draw. */
  prepare(to: Target, view: View, seconds: number, skipGroundDecal?: boolean): boolean
  /** Records the prepared shadows, bodies and speech boards into an active `(to.color, to.depth)` render pass. */
  record(pass: GPURenderPassEncoder): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View, seconds: number, sharedPass?: GPURenderPassEncoder): void
  /** Queues nearby prepared people as OBB shadow casters into `DynamicShadows` (zero GC). Call after `prepare()`. */
  castShadows(shadows: DynamicShadows): number
  /** How many people and boxes the last frame drew, and what working them out cost this thread (ms, smoothed). */
  readonly drawn: { people: number; boxes: number; ms: number }
}

export async function people(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<People> {
  const module = await shader(device, 'people', CODE)
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] }),
      device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} }] }),
    ],
  })
  const floats = (n: number, from: number): GPUVertexAttribute[] => Array.from({ length: n }, (_, i) => ({ shaderLocation: i, offset: from + i * 16, format: 'float32x4' as const }))
  const bodies = await device.createRenderPipelineAsync({
    label: 'people', layout,
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: EACH * 4, stepMode: 'instance', attributes: floats(6, 0) }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const shadows = await device.createRenderPipelineAsync({
    label: 'people shadows', layout,
    vertex: { module, entryPoint: 'shadowVs', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: floats(2, 0) }] },
    fragment: { module, entryPoint: 'shadowFs', targets: [{ format, blend: { color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const boxes = device.createBuffer({ size: MOST * EACH * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const lain = device.createBuffer({ size: 1024 * 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const view0 = device.createBindGroup({ layout: bodies.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  // Bound again whenever the picture is another size: the march's panes are of the picture's size.
  let lit: { panes: GPUTextureView; group: GPUBindGroup } | null = null
  const litFor = (panes: GPUTextureView) => {
    if (lit?.panes !== panes) lit = { panes, group: device.createBindGroup({ layout: bodies.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }, { binding: 2, resource: panes }, { binding: 3, resource: { buffer: march.localLights.buffer } }] }) }
    return lit.group
  }
  const packed = new Float32Array(MOST * EACH), shade = new Float32Array(1024 * 8)
  // Names and words: each is drawn once into a slot of the sheet, and the slot longest unused is the next to go.
  const signs = await shader(device, 'people signs', SIGN)
  const signed = await device.createRenderPipelineAsync({
    label: 'people signs', layout: 'auto',
    vertex: { module: signs, entryPoint: 'vs', buffers: [{ arrayStride: 48, stepMode: 'instance', attributes: floats(3, 0) }] },
    fragment: { module: signs, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const sheet = device.createTexture({ label: 'people signs', size: [SLOT[0] * SLOTS[0], SLOT[1] * SLOTS[1]], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
  const paper = new OffscreenCanvas(SLOT[0], SLOT[1]), pen = paper.getContext('2d')!
  const signView = device.createBindGroup({ layout: signed.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  const signSheet = device.createBindGroup({ layout: signed.getBindGroupLayout(1), entries: [{ binding: 0, resource: sheet.createView() }, { binding: 1, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }] })
  const boards = device.createBuffer({ size: SLOTS[0] * SLOTS[1] * 48, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const board = new Float32Array(SLOTS[0] * SLOTS[1] * 12)
  const written = new Map<string, { slot: number; wide: number; tall: number; used: number }>()
  let frames = 0
  /** The slot a name and its words are written in: written now, if they were not there. Sizes are the sheet's pixels. */
  const write = (name: string, says: string) => {
    const key = `${name}\n${says}`
    let w = written.get(key)
    if (!w) {
      let slot = written.size
      if (slot >= SLOTS[0] * SLOTS[1]) {
        let oldest = ''
        for (const [k, v] of written) if (!oldest || v.used < written.get(oldest)!.used) oldest = k
        slot = written.get(oldest)!.slot
        written.delete(oldest)
      }
      pen.clearRect(0, 0, SLOT[0], SLOT[1])
      pen.textBaseline = 'middle'; pen.textAlign = 'center'
      // The words in at most two lines, cut with an ellipsis where they are longer (measured in the exact font used to draw).
      const sayFont = name ? '500 30px -apple-system, system-ui, sans-serif' : '600 28px -apple-system, system-ui, sans-serif'
      pen.font = sayFont
      const lines: string[] = []
      for (const word of says.split(/\s+/).filter(Boolean)) {
        const last = lines.length - 1
        if (last >= 0 && pen.measureText(`${lines[last]} ${word}`).width <= SLOT[0] - 48) lines[last] += ` ${word}`
        else if (lines.length < 2) lines.push(word)
        else { lines[1] = `${lines[1].replace(/.{0,2}$/, '')}…`; break }
      }
      for (let i = 0; i < lines.length; i++) while (lines[i].length > 4 && pen.measureText(lines[i]).width > SLOT[0] - 48) lines[i] = `${lines[i].slice(0, -3)}…`
      pen.font = '600 30px -apple-system, system-ui, sans-serif'
      const nameWide = name ? pen.measureText(name).width : 0
      pen.font = sayFont
      const wide = Math.min(SLOT[0], Math.ceil(Math.max(nameWide, ...lines.map((l) => pen.measureText(l).width)) + 40))
      const tall = name ? 44 + lines.length * 38 : Math.max(46, 18 + lines.length * 36)
      const left = (SLOT[0] - wide) / 2, top = SLOT[1] - tall
      // A dark plate with pale letters: a white one came out of the last pass as a lamp, and glowed at night.
      const shouted = !name && says.includes('!')
      pen.fillStyle = lines.length ? 'rgba(14, 18, 24, 0.88)' : 'rgba(14, 18, 24, 0.62)'
      pen.beginPath(); pen.roundRect(left, top, wide, tall, 14); pen.fill()
      if (name) {
        pen.fillStyle = lines.length ? '#9aa6b4' : '#d9dee5'
        pen.font = '600 30px -apple-system, system-ui, sans-serif'
        pen.fillText(name, SLOT[0] / 2, top + 23)
        pen.fillStyle = '#d9dee5'
        pen.font = sayFont
        lines.forEach((l, i) => pen.fillText(l, SLOT[0] / 2, top + 60 + i * 38))
      } else {
        pen.fillStyle = shouted ? '#f6d27a' : '#e5edf5'
        pen.font = sayFont
        lines.forEach((l, i) => pen.fillText(l, SLOT[0] / 2, top + 27 + i * 36))
      }
      device.queue.copyExternalImageToTexture({ source: paper }, { texture: sheet, origin: [(slot % SLOTS[0]) * SLOT[0], Math.floor(slot / SLOTS[0]) * SLOT[1]], premultipliedAlpha: true }, SLOT)
      w = { slot, wide, tall, used: frames }
      written.set(key, w)
    }
    w.used = frames
    return w
  }
  const drawn = { people: 0, boxes: 0, ms: 0 }
  let preparedBoxes = 0, preparedLies = 0, preparedNamed = 0
  let preparedPanes: GPUTextureView | null = null
  const MAX_SHADOW_PEOPLE = 256
  const shadowPeople = new Float32Array(MAX_SHADOW_PEOPLE * 6)
  let shadowPeopleCount = 0
  const self: People = {
    from: [],
    drawn,
    prepare(to, view, seconds, skipGroundDecal = false) {
      const began = performance.now()
      shadowPeopleCount = 0
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64) as unknown as V3
      const sun = march.sun.s
      // Which way a shadow lies on the ground, and how long a figure's is: no longer than six of its heights.
      const flat = Math.hypot(sun[0], sun[2]) || 1, reach = sun[1] > 0.02 ? Math.min(100, 17 * flat / sun[1]) : 0
      let n = 0, count = 0, lies = 0, named = 0
      frames++
      for (const source of self.from) for (const p of source(view, seconds)) {
        const dx = p.at[0] - view.eye[0], dy = p.at[1] + 9 - view.eye[1], dz = p.at[2] - view.eye[2]
        const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2], off = Math.hypot(dx, dy, dz)
        // Out of sight behind the eye, or too far to be a pixel.
        if (ahead < -30 || off > 4000) continue
        n = figure(p, packed, n, anchor, off > 450 ? 3 : off > 220 ? 2 : off > 60 ? 1 : 0)
        count++
        if ((p.name || p.says) && off < 900 && off > 6 && named < SLOTS[0] * SLOTS[1]) {
          // Over the head, the size letters should be on the screen: no smaller than can be read, no bigger than a hand.
          const w = write(p.name ?? '', p.says ?? ''), o = named++ * 12
          const high = to.size[1] / (2 * view.tanHalf * Math.max(ahead, 1)), tall = Math.max(to.size[1] * 0.034, Math.min(to.size[1] * 0.05, 2.4 * high)) * (w.tall / 44) / high
          const lift = (p.umbrella ? 29 : 19.5) * (1 - (p.down ?? 0) * 0.8), q = p.frame, ux = q ? 2 * (q[0] * q[1] - q[3] * q[2]) : 0, uy = q ? 1 - 2 * (q[0] * q[0] + q[2] * q[2]) : 1, uz = q ? 2 * (q[1] * q[2] + q[3] * q[0]) : 0
          board[o] = p.at[0] + ux * lift - anchor[0]; board[o + 1] = p.at[1] + uy * lift - anchor[1]; board[o + 2] = p.at[2] + uz * lift - anchor[2]
          board[o + 3] = Math.min(1, (900 - off) / 200)
          board[o + 4] = tall * w.wide / w.tall; board[o + 5] = tall
          const sx = (w.slot % SLOTS[0]) * SLOT[0], sy = Math.floor(w.slot / SLOTS[0]) * SLOT[1], W = SLOT[0] * SLOTS[0], H = SLOT[1] * SLOTS[1]
          board[o + 8] = (sx + (SLOT[0] - w.wide) / 2) / W; board[o + 9] = (sy + SLOT[1] - w.tall) / H; board[o + 10] = (sx + (SLOT[0] + w.wide) / 2) / W; board[o + 11] = (sy + SLOT[1]) / H
        }
        if (!skipGroundDecal && lies < 1024 && off < 1500) {
          const o = lies++ * 8, lying = p.down ?? 0
          shade[o] = p.at[0] - anchor[0]; shade[o + 1] = p.at[1] - anchor[1]; shade[o + 2] = p.at[2] - anchor[2]; shade[o + 3] = (p.umbrella ? 5 : 2.6) + lying * 2
          shade[o + 4] = -sun[0] / flat; shade[o + 5] = -sun[2] / flat; shade[o + 6] = reach * (1 - lying * 0.8); shade[o + 7] = 0
        }
        if (shadowPeopleCount < MAX_SHADOW_PEOPLE && off < 1400) {
          const so = shadowPeopleCount++ * 6
          shadowPeople[so] = p.at[0]
          shadowPeople[so + 1] = p.at[1]
          shadowPeople[so + 2] = p.at[2]
          shadowPeople[so + 3] = p.yaw
          shadowPeople[so + 4] = p.down ?? 0
          shadowPeople[so + 5] = p.umbrella ? 1 : 0
        }
      }
      drawn.people = count; drawn.boxes = n / EACH
      if (!count) {
        preparedBoxes = 0; preparedLies = 0; preparedNamed = 0
        drawn.ms += (performance.now() - began - drawn.ms) * 0.05
        return false
      }
      device.queue.writeBuffer(boxes, 0, packed, 0, n)
      if (lies) device.queue.writeBuffer(lain, 0, shade, 0, lies * 8)
      if (named) device.queue.writeBuffer(boards, 0, board, 0, named * 12)
      const wrap = (v: number, by: number) => ((v % by) + by) % by
      // No lamp stands in open country: a block whose middle is more than 3.5 km from where the page starts (march.ts lit).
      const town = Math.hypot((Math.floor(view.eye[0] / 1280) + 0.5) * 1280 - 700, (Math.floor(view.eye[2] / 800) + 0.5) * 800 - 4070) < 35000
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf,
        ...view.right, to.size[0] / to.size[1], ...view.up, town ? 1 : 0, ...view.forward, 0,
        wrap(anchor[0], 1280), wrap(anchor[2], 800), 0, 0,
      ]))
      preparedBoxes = n / EACH
      preparedLies = lies
      preparedNamed = named
      preparedPanes = march.panes(to.allocSize ?? to.size)
      drawn.ms += (performance.now() - began - drawn.ms) * 0.05
      return true
    },
    record(pass) {
      if (!preparedBoxes || !preparedPanes) return
      pass.setBindGroup(0, view0)
      pass.setBindGroup(1, litFor(preparedPanes))
      if (preparedLies) {
        pass.setPipeline(shadows)
        pass.setVertexBuffer(0, lain)
        pass.draw(6, preparedLies)
      }
      pass.setPipeline(bodies)
      pass.setVertexBuffer(0, boxes)
      pass.draw(36, preparedBoxes)
      if (preparedNamed) {
        pass.setPipeline(signed)
        pass.setBindGroup(0, signView)
        pass.setBindGroup(1, signSheet)
        pass.setVertexBuffer(0, boards)
        pass.draw(6, preparedNamed)
      }
    },
    draw(encoder, to, view, seconds, sharedPass) {
      if (!self.prepare(to, view, seconds)) return
      if (sharedPass) { self.record(sharedPass); return }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      self.record(pass)
      pass.end()
    },
    castShadows(shadows) {
      let added = 0
      for (let i = 0; i < shadowPeopleCount; i++) {
        const o = i * 6
        const px = shadowPeople[o], py = shadowPeople[o + 1], pz = shadowPeople[o + 2]
        const yaw = shadowPeople[o + 3], down = shadowPeople[o + 4], umbrella = shadowPeople[o + 5]
        const qy = Math.sin(-yaw * 0.5), qw = Math.cos(-yaw * 0.5)
        if (down > 0.5) {
          if (shadows.addBoxCasterRaw(px, py + 1.4, pz, 1.8, 1.4, 7.5, 0, qy, 0, qw)) added++
        } else {
          if (shadows.addBoxCasterRaw(px, py + 8.4, pz, 1.65, 8.4, 1.35, 0, qy, 0, qw)) added++
          if (umbrella > 0.5 && shadows.addBoxCasterRaw(px, py + 19.2, pz, 5.2, 0.8, 5.2, 0, 0, 0, 1)) added++
        }
      }
      return added
    },
  }
  return self
}

/** How far off residents are worked out and drawn, in cells. */
export const REACH = 1400

/**
 * The town's residents as people to draw: the rule's (residents.ts), with what is this page's own: whether it
 * rains here, so umbrellas are up. `clock` is seconds on the clock every page of a world shares;
 * `shocks` is what has gone off lately, for whoever makes a blast to add to; `taken` is who a rule of the world
 * has taken off their round (presence.ts keeps it).
 */
export function townsfolk(land: Land, hour: () => number, rain: () => number, clock: () => number, shocks: Shock[], taken?: ReadonlySet<number>, bodies?: () => readonly (readonly [number, number, number])[]): (view: View, seconds: number) => readonly Person[] {
  const found: Resident[] = [], shown: Person[] = []
  // How far aside each is shown, going round somebody: brought in at no more than a brisk step, so that nobody is
  // seen to jump when the rule's answer changes in a moment (somebody crosses in front of them).
  const aside = new Map<number, { x: number; z: number; yaw: number; at: number }>()
  let last = 0
  return (view, seconds) => {
    const now = clock(), dt = Math.max(0, Math.min(0.1, seconds - last))
    last = seconds
    // A bang is forgotten once everyone it moved is back where they would have been.
    while (shocks.length && now - shocks[0].t > 60) shocks.shift()
    const n = residents(land, [view.eye[0], view.eye[2]], REACH, now, hour(), found, shocks, taken, bodies?.()), wet = rain() > 0.3
    shown.length = n
    const near = 1 - Math.exp(-dt * 9), most = 11 * dt
    for (let i = 0; i < n; i++) {
      const r = found[i], p = (shown[i] ??= { at: r.at, yaw: 0, seed: 0 }) as { -readonly [K in keyof Person]: Person[K] }
      let yaw = r.yaw
      const was = aside.get(r.seed)
      if (was || r.aside[0] || r.aside[1] || r.aside[2]) {
        const a = was ?? { x: 0, z: 0, yaw: 0, at: 0 }
        if (!was) aside.set(r.seed, a)
        // After a gap (out of reach and back) they are where the rule has them.
        if (seconds - a.at > 1) { a.x = r.aside[0]; a.z = r.aside[1]; a.yaw = r.aside[2] }
        const dx = (r.aside[0] - a.x) * near, dz = (r.aside[1] - a.z) * near, far = Math.hypot(dx, dz), slow = far > most ? most / far : 1
        a.x += dx * slow; a.z += dz * slow; a.yaw += (r.aside[2] - a.yaw) * Math.min(1, dt * 5); a.at = seconds
        r.at[0] += a.x - r.aside[0]; r.at[2] += a.z - r.aside[1]; yaw += a.yaw - r.aside[2]
        if (!r.aside[0] && !r.aside[1] && Math.abs(a.x) + Math.abs(a.z) + Math.abs(a.yaw) < 0.01) aside.delete(r.seed)
      }
      p.at = r.at; p.yaw = yaw; p.seed = r.seed; p.stride = r.stride; p.walking = r.walking; p.reading = r.reading
      p.umbrella = r.carries && wet; p.time = seconds; p.flinch = r.flinch; p.down = r.down; p.glance = r.glance
    }
    if (aside.size > 400) for (const [seed, a] of aside) if (seconds - a.at > 5) aside.delete(seed)
    return shown
  }
}
