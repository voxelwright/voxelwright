// People (#218). Everyone in the world, person, agent or resident, is one figure: boxes of cells
// half the world's size (5 cm: a face and a hand need them), jointed at hip, knee, shoulder, elbow
// and neck. A figure is never cells of the world, so the rays do not see it: all the figures in
// sight are drawn in one call over the marched picture, tested against its depth, lit as the world
// is lit (the sun through the sun's maps, the sky, the street lamps by the town's rule) and each
// with its shadow laid on the ground under it. `figure` is the one place that says what a person
// looks like and how one moves.
import { shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, LIGHT, SUNLIT, type Marcher, type View } from './march.ts'
import { chance, residents, type Land, type Resident, type Shock } from './residents.ts'

/** One person, as whoever draws them is told. Lengths are the world's finest cells (10 cm). */
export interface Person {
  /** Where the feet are. */
  at: readonly [number, number, number]
  /** Which way they face: 0 is north (-z), a quarter turn is east. */
  yaw: number
  /** Who they are to look at: build, clothes and colours all come of this number. */
  seed: number
  /** How far through a pair of steps they are, in turns. Left alone they stand. */
  stride?: number
  /** How much of a walk it is, 0 standing to 1 walking: the legs and arms swing by it. */
  walking?: number
  /** Whether an umbrella is up over them. */
  umbrella?: boolean
  /** Which way the head is turned from the body, radians to the right. */
  glance?: number
  /** 0 to 1: shrunk from something, arms over the head. */
  flinch?: number
  /** 0 standing to 1 lying on the ground. */
  down?: number
  /** What they hold up before them and look at (a phone), 0 to 1. */
  reading?: number
  /** Seconds, for what a body does while it stands: it shifts and breathes. */
  time?: number
  /** Their name, shown over their head, and what they are saying now, under it. Both are text someone typed: drawn as letters, nothing more. */
  name?: string
  says?: string
}

/** Floats a box: where its middle is, a number of its own; half its size, how big its cells are; two of its three axes with the height of the feet and what it is made as; its colour. */
const EACH = 20
const MOST = 12_000
/** What a box is made as: cloth is knit, skin is smooth, leather shines a little. */
const CLOTH = 0, SKIN = 1, LEATHER = 2, HAIR = 3

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
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
${SUNLIT}
${LIGHT}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) q: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) facing: vec3f,
  @location(3) seen: vec3f,
  @location(4) @interpolate(flat) colour: vec4f,
  @location(5) @interpolate(flat) more: vec4f,
}
const NEAR = 1.0;
const FAR = 100000.0;
fn project(world: vec3f) -> vec4f {
  let d = dot(world, u.forward);
  return vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
}
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) mid: vec4f, @location(1) half: vec4f, @location(2) c0: vec4f, @location(3) c1: vec4f, @location(4) colour: vec4f) -> Out {
  let face = v / 6u;
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u] * 2.0 - 1.0;
  let axis = face >> 1u;
  let side = f32(face & 1u) * 2.0 - 1.0;
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  if (axis == 0u) { p = vec3f(side, corner.x, corner.y * side); n = vec3f(side, 0.0, 0.0); }
  else if (axis == 1u) { p = vec3f(corner.x * side, side, corner.y); n = vec3f(0.0, side, 0.0); }
  else { p = vec3f(corner.x, corner.y * side, side); n = vec3f(0.0, 0.0, side); }
  let turned = mat3x3f(c0.xyz, c1.xyz, cross(c0.xyz, c1.xyz));
  let world = mid.xyz + turned * (p * half.xyz) - u.eye;
  var out: Out;
  out.pos = project(world);
  out.q = (p + 1.0) * half.xyz;
  out.n = n;
  out.facing = turned * n;
  out.seen = world;
  out.colour = colour;
  // The cells' size, a number of the box's own, how high the feet are, what it is made as.
  out.more = vec4f(half.w, mid.w, c0.w, c1.w);
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
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let size = in.more.x;
  let made = u32(in.more.w);
  let far = max(length(in.seen), 1.0);
  // How many pixels wide one of its cells is: under a few, the cells are not drawn, only their colour.
  let sharp = size / (far * g.pixel);
  let inside = in.q - in.n * (0.5 * size);
  let cell = floor(inside / size);
  let own = hash3(cell + vec3f(in.more.y * 91.0, in.more.y * 17.0, 3.0));
  var albedo = in.colour.rgb;
  // Each cell a shade of its own, and a seam between it and the next: knit. Skin is one piece.
  let wander = select(0.16, 0.05, made == ${SKIN}u);
  albedo *= 1.0 + wander * (own - 0.5) * clamp(sharp * 0.6, 0.0, 1.0);
  let f = fract(in.q / size);
  let edge = min(f, 1.0 - f) + abs(in.n);
  let seam = 1.0 - smoothstep(0.0, 0.1, min(edge.x, min(edge.y, edge.z)));
  albedo *= 1.0 - seam * select(0.22, 0.07, made == ${SKIN}u) * clamp(sharp / 5.0 - 0.4, 0.0, 1.0);
  let n = normalize(in.facing);
  let rd = in.seen / far;
  var direct = max(dot(n, g.sun), 0.0);
  if (direct > 0.0) {
    let sunny = sunlit(in.seen + u.eye, n, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  // A body shades itself a little towards the feet and where it faces down.
  let open = clamp(0.62 + 0.03 * (in.seen.y + u.eye.y - in.more.z) + 0.2 * n.y, 0.45, 1.0);
  let rough = select(0.95, 0.5, made == ${LEATHER}u);
  var col = shade(albedo, n, rd, g.sun, direct, open, rough, 0.0);
  if (g.weather.z > 0.0 && u.lamps > 0.0) {
    let at = in.seen + u.eye;
    col += albedo * vec3f(1.0, 0.78, 0.48) * min(lamplight(at, n, in.more.z), 1.3) * g.weather.z * 1.5;
    // And what comes from windows and signs all round: without it a street at night is cut-outs.
    col += albedo * vec3f(0.9, 0.8, 0.7) * 0.06 * g.weather.z;
  }
  // Wet cloth is darker, and shines a little towards the light.
  col *= 1.0 - 0.18 * g.weather.y * select(1.0, 0.0, made == ${SKIN}u);
  return vec4f(tone(col), 1.0);
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
  return vec4f(0.0, 0.0, 0.0, dark);
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
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = mix(uv.xy, uv.zw, vec2f(corner.x, 1.0 - corner.y));
  out.show = at.w;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  return textureSampleLevel(sheet, smooth_, in.uv, 0.0) * in.show;
}
`
/** The sheet of letters: slots of 512 by 128, four across and eight down. */
const SLOT = [512, 128], SLOTS = [4, 8]

type V3 = readonly [number, number, number]
/** A joint's frame: its three axes in the world (right, up, back) and where it is. */
type Frame = Float64Array

/** Colours as light, not as a screen shows them. */
const tint = (hex: string): V3 => [0, 1, 2].map((c) => (parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255) ** 2.2) as unknown as V3
// What real people wear in a town in autumn: dark and muted, with now and then a colour.
const COATS = ['#2b2d33', '#1f2a3d', '#3b3f45', '#5a4632', '#8a6a44', '#4a5240', '#6b2f2c', '#56585c', '#23262b', '#3a4a5c', '#7a7468', '#2f4a44', '#b9b2a2', '#a8452f', '#c9a23a', '#8fa3b5', '#d8d4c8'].map(tint)
const LEGS = ['#22242a', '#2c3444', '#1b1c20', '#4b4a44', '#3a3128', '#59605f', '#8a8272', '#3f5878'].map(tint)
// Skin is given darker than it is: in full sun a pale face came out as white paper.
const SKINS = ['#c9a084', '#bd8f6e', '#a87552', '#8a5a3a', '#684228', '#4a2e1e'].map(tint)
const HAIRS = ['#17130f', '#2e2016', '#4a3222', '#7a5a34', '#b0926a', '#8a8a88', '#c8c6c0', '#5c2a18'].map(tint)
const BRIGHT = ['#b8862a', '#a03a2e', '#2a6f78', '#c2bfb4', '#44608c', '#7c8a3a'].map(tint)
const EYE: V3 = [0.012, 0.01, 0.01]
const SHOES = ['#141416', '#2a1d14', '#3c3c3e', '#d8d6d0'].map(tint)

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

const ROOT = new Float64Array(12), HIP = new Float64Array(12), LEG = new Float64Array(12), SHIN = new Float64Array(12), FOOT = new Float64Array(12)
const CHEST = new Float64Array(12), HEAD = new Float64Array(12), ARM = new Float64Array(12), FORE = new Float64Array(12), HELD = new Float64Array(12)
/** How long a pair of steps is, in cells: the feet then stay where they are put. */
export const STRIDE = 14.4
/** The cells a figure is made of: half the world's. */
const CELL = 0.5
const THIGH = 4.5, CALF = 4, SOLE = 0.5

/**
 * Writes a person's boxes into `out` from float `at`, places taken from `anchor`. Returns the float after the last.
 * `far` leaves out what cannot be seen from a way off (hands, neck, feet's own boxes).
 */
export function figure(p: Person, out: Float32Array, at: number, anchor: V3, far = false): number {
  const s = p.seed
  // Build: how tall, how broad.
  const tall = 0.93 + 0.12 * chance(s, 1), broad = 0.9 + 0.22 * chance(s, 2)
  const coat = pick(COATS, s, 3), legs = pick(LEGS, s, 4), skin = pick(SKINS, s, 5), hair = pick(HAIRS, s, 6), shoe = pick(SHOES, s, 7)
  const bright = pick(BRIGHT, s, 8)
  const long = chance(s, 9) < 0.45, hairstyle = Math.floor(chance(s, 10) * 5), scarf = chance(s, 11) < 0.3, bag = Math.floor(chance(s, 12) * 4)
  const walking = p.walking ?? 0, flinch = p.flinch ?? 0, down = p.down ?? 0, reading = p.reading ?? 0, time = p.time ?? 0
  const stride = (p.stride ?? 0) * Math.PI * 2
  const feet = p.at[1]
  let n = at
  const box = (f: Frame, x: number, y: number, z: number, w: number, h: number, d: number, colour: V3, made: number) => {
    if (n + EACH > out.length) return
    for (let a = 0; a < 3; a++) out[n + a] = f[9 + a] + f[a] * x + f[3 + a] * y + f[6 + a] * z - anchor[a]
    out[n + 3] = (s % 9973) / 9973
    out[n + 4] = w / 2; out[n + 5] = h / 2; out[n + 6] = d / 2; out[n + 7] = CELL
    out[n + 8] = f[0]; out[n + 9] = f[1]; out[n + 10] = f[2]; out[n + 11] = feet - anchor[1]
    out[n + 12] = f[3]; out[n + 13] = f[4]; out[n + 14] = f[5]; out[n + 15] = made
    out[n + 16] = colour[0]; out[n + 17] = colour[1]; out[n + 18] = colour[2]; out[n + 19] = 1
    n += EACH
  }
  // The legs first, as angles: how far each foot is under the hip says how high the hip is, so a foot is always
  // on the ground and the body rises and falls as it walks.
  // Going down and getting up, the body folds at knee and hip: it is not a board tipped over on its heels.
  const fold = 4 * down * (1 - down)
  const crouch = flinch * 0.55 + fold * 0.6
  const legOf = (side: number) => {
    const ph = stride + (side < 0 ? 0 : Math.PI)
    const swing = walking * (0.4 * Math.sin(ph) + 0.04) + crouch * 0.9
    const knee = 0.06 + walking * 0.95 * Math.max(0, Math.cos(ph + 0.3)) ** 2 + crouch * 1.7
    return { swing, knee, drop: THIGH * tall * Math.cos(swing) + CALF * tall * Math.cos(swing - knee) + SOLE }
  }
  const left = legOf(-1), right = legOf(1)
  const hipHigh = Math.max(left.drop, right.drop)
  ROOT.fill(0)
  ROOT[0] = Math.cos(p.yaw); ROOT[2] = Math.sin(p.yaw); ROOT[4] = 1; ROOT[6] = -Math.sin(p.yaw); ROOT[8] = Math.cos(p.yaw)
  ROOT[9] = p.at[0]; ROOT[10] = p.at[1]; ROOT[11] = p.at[2]
  if (down > 0) {
    // Onto the back, about the heels; lying, the back is on the ground.
    pitch(ROOT, -down * Math.PI / 2)
    ROOT[10] += down * 1.3
  }
  const sway = walking * Math.sin(stride) * 0.035 + (1 - walking) * Math.sin(time * 0.6 + s) * 0.012
  child(HIP, ROOT, 0, hipHigh, 0)
  roll(HIP, sway)
  // Legs.
  for (const side of [-1, 1]) {
    const leg = side < 0 ? left : right
    child(LEG, HIP, side * 1.0 * broad, 0, 0)
    pitch(LEG, leg.swing)
    box(LEG, 0, -THIGH * tall / 2, 0, 1.5, THIGH * tall + 0.3, 1.75, legs, CLOTH)
    child(SHIN, LEG, 0, -THIGH * tall, 0)
    pitch(SHIN, -leg.knee)
    box(SHIN, 0, -CALF * tall / 2, 0.1, 1.25, CALF * tall, 1.4, legs, CLOTH)
    child(FOOT, SHIN, 0, -CALF * tall, 0)
    // The foot lies level on the ground, and points down a little as it leaves it.
    pitch(FOOT, leg.knee - leg.swing - walking * 0.35 * Math.max(0, Math.cos(stride + (side < 0 ? 0 : Math.PI) + 1.5)))
    box(FOOT, 0, -SOLE / 2 + 0.05, -0.6, 1.25, 0.75, 2.75, shoe, LEATHER)
  }
  // The trunk: hips, then the chest leaning as it walks or shrinks.
  box(HIP, 0, 0.5, 0, 3.5 * broad, 1.75, 2, long ? coat : legs, CLOTH)
  child(CHEST, HIP, 0, 1.2, 0)
  pitch(CHEST, walking * 0.06 + flinch * 0.55 + fold * 0.7)
  roll(CHEST, -sway * 1.6)
  turn(CHEST, walking * Math.sin(stride) * -0.1)
  const breath = Math.sin(time * 1.3 + s) * 0.05
  box(CHEST, 0, 2.3, 0, 3.75 * broad, 4.75, 2.25 + breath, coat, CLOTH)
  box(CHEST, 0, 4.3, 0, 4.5 * broad, 1.25, 2.4, coat, CLOTH)
  if (long) {
    // A long coat hangs to the knee and opens a little as the legs move.
    box(HIP, 0, -1.9, 0.1, 3.75 * broad, 4.25, 2.4 + walking * 0.5, coat, CLOTH)
  }
  if (scarf) box(CHEST, 0, 5.1, -0.1, 2.5, 1, 2.6, bright, CLOTH)
  if (bag === 1) {
    // A pack on the back.
    box(CHEST, 0, 2.6, 1.8, 2.75, 3.75, 1.4, pick(LEGS, s, 13), CLOTH)
  } else if (bag === 2 && !far) {
    // A bag at the hip, its strap across the chest.
    box(HIP, 2.1 * broad, 0.2, 0.1, 0.9, 2.5, 3, pick(BRIGHT, s, 14), LEATHER)
  }
  // The head: a neck, a face, hair.
  child(HEAD, CHEST, 0, 4.9, 0)
  turn(HEAD, (p.glance ?? 0) + (1 - walking) * Math.sin(time * 0.23 + s * 1.7) * 0.25 * (1 - reading))
  pitch(HEAD, reading * 0.45 + flinch * 0.4)
  if (!far) box(HEAD, 0, 0.3, 0, 1.2, 0.9, 1.2, skin, SKIN)
  box(HEAD, 0, 1.75, -0.05, 1.75, 2.25, 2, skin, SKIN)
  if (!far) {
    // Eyes and a nose: two dark cells and a ridge are what make it a face from across a street.
    const shadow: V3 = [skin[0] * 0.55, skin[1] * 0.5, skin[2] * 0.48]
    box(HEAD, 0.42, 1.95, -1.06, 0.3, 0.25, 0.1, EYE, LEATHER)
    box(HEAD, -0.42, 1.95, -1.06, 0.3, 0.25, 0.1, EYE, LEATHER)
    box(HEAD, 0, 1.6, -1.12, 0.3, 0.6, 0.25, shadow, SKIN)
    box(HEAD, 0, 1.05, -1.06, 0.7, 0.12, 0.1, shadow, SKIN)
  }
  if (hairstyle === 0) {
    // A hat: a knitted cap pulled down.
    box(HEAD, 0, 2.55, 0, 2, 1, 2.25, bright, CLOTH)
  } else {
    box(HEAD, 0, 2.75, 0.1, 2, 0.6, 2.25, hair, HAIR)
    box(HEAD, 0, 2.55, -0.95, 2, 0.5, 0.3, hair, HAIR)
    box(HEAD, 0, 1.95, 0.95, 2, 1.75, 0.5, hair, HAIR)
    if (hairstyle >= 3) box(HEAD, 0, 0.9, 1.0, 2, 2.4, 0.6, hair, HAIR)
    if (hairstyle === 2 && !far) { box(HEAD, 0.95, 2.1, 0.2, 0.3, 1.2, 1.4, hair, HAIR); box(HEAD, -0.95, 2.1, 0.2, 0.3, 1.2, 1.4, hair, HAIR) }
  }
  // Arms: they swing against the legs; one holds an umbrella or a phone; both go over the head in a flinch.
  for (const side of [-1, 1]) {
    const ph = stride + (side < 0 ? Math.PI : 0)
    const holds = side > 0 && (p.umbrella || reading > 0)
    let lift = walking * 0.4 * Math.sin(ph) + flinch * 2.5
    let bend = 0.12 + walking * (0.22 + 0.2 * Math.max(0, Math.sin(ph))) + flinch * 1.9
    if (holds && p.umbrella) { lift = 0.25 + flinch * 1.5; bend = 1.75 }
    else if (holds) { lift = lift * (1 - reading) + reading * 0.35; bend = bend * (1 - reading) + reading * 1.85 }
    child(ARM, CHEST, side * (2.25 * broad + 0.5), 4.6, 0)
    roll(ARM, side * (0.05 + flinch * 0.25))
    pitch(ARM, lift)
    box(ARM, 0, -1.7, 0, 1.25, 3.6, 1.4, coat, CLOTH)
    child(FORE, ARM, 0, -3.4, 0)
    pitch(FORE, bend)
    box(FORE, 0, -1.5, 0, 1.1, 3.2, 1.2, coat, CLOTH)
    if (!far) box(FORE, 0, -3.5, 0, 0.9, 1, 1, skin, SKIN)
    if (holds && p.umbrella) {
      // The shaft stands upright whatever the arm does, and the canopy is eight-sided as near as boxes go.
      child(HELD, FORE, 0, -3.5, 0)
      for (let a = 0; a < 3; a++) { HELD[a] = ROOT[a]; HELD[3 + a] = a === 1 ? 1 : 0; HELD[6 + a] = ROOT[6 + a] }
      const dark = pick(COATS, s, 15), top = chance(s, 16) < 0.35 ? bright : dark
      box(HELD, 0, 4.2, 0, 0.3, 10, 0.3, SHOES[0], LEATHER)
      box(HELD, 0, 8.6, 0, 11, 0.5, 5, top, CLOTH)
      box(HELD, 0, 8.6, 0, 5, 0.5, 11, top, CLOTH)
      box(HELD, 0, 8.9, 0, 8.5, 0.6, 8.5, top, CLOTH)
      box(HELD, 0, 9.3, 0, 4.5, 0.5, 4.5, top, CLOTH)
      box(HELD, 0, 9.8, 0, 0.3, 0.8, 0.3, SHOES[0], LEATHER)
    } else if (holds && !far) {
      box(FORE, 0, -3.9, -0.5, 0.75, 1.5, 0.2, SHOES[0], LEATHER)
    }
  }
  return n
}

export interface People {
  /** Who is drawn, until told otherwise. Asked afresh each frame, with the view, so that whoever gives them can leave out those out of sight. */
  from: ((view: View, seconds: number) => readonly Person[])[]
  draw(encoder: GPUCommandEncoder, to: Target, view: View, seconds: number): void
  /** How many people and boxes the last frame drew, and what working them out cost this thread (ms, smoothed). */
  readonly drawn: { people: number; boxes: number; ms: number }
}

export async function people(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<People> {
  const module = await shader(device, 'people', CODE)
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] }),
      device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }] }),
    ],
  })
  const floats = (n: number, from: number): GPUVertexAttribute[] => Array.from({ length: n }, (_, i) => ({ shaderLocation: i, offset: from + i * 16, format: 'float32x4' as const }))
  const bodies = await device.createRenderPipelineAsync({
    label: 'people', layout,
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: EACH * 4, stepMode: 'instance', attributes: floats(5, 0) }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
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
  const lit = device.createBindGroup({ layout: bodies.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }] })
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
      // The words in at most two lines, cut with an ellipsis where they are longer.
      pen.font = '500 30px -apple-system, system-ui, sans-serif'
      const lines: string[] = []
      for (const word of says.split(/\s+/).filter(Boolean)) {
        const last = lines.length - 1
        if (last >= 0 && pen.measureText(`${lines[last]} ${word}`).width <= SLOT[0] - 40) lines[last] += ` ${word}`
        else if (lines.length < 2) lines.push(word)
        else { lines[1] = `${lines[1].replace(/.{0,2}$/, '')}…`; break }
      }
      for (let i = 0; i < lines.length; i++) while (lines[i].length > 4 && pen.measureText(lines[i]).width > SLOT[0] - 40) lines[i] = `${lines[i].slice(0, -3)}…`
      pen.font = '600 30px -apple-system, system-ui, sans-serif'
      const nameWide = pen.measureText(name).width
      pen.font = '500 30px -apple-system, system-ui, sans-serif'
      const wide = Math.min(SLOT[0], Math.ceil(Math.max(nameWide, ...lines.map((l) => pen.measureText(l).width)) + 36)), tall = 44 + lines.length * 38
      const left = (SLOT[0] - wide) / 2, top = SLOT[1] - tall
      // A dark plate with pale letters: a white one came out of the last pass as a lamp, and glowed at night.
      pen.fillStyle = lines.length ? 'rgba(14, 18, 24, 0.84)' : 'rgba(14, 18, 24, 0.62)'
      pen.beginPath(); pen.roundRect(left, top, wide, tall, 14); pen.fill()
      pen.fillStyle = lines.length ? '#9aa6b4' : '#d9dee5'
      pen.font = '600 30px -apple-system, system-ui, sans-serif'
      pen.fillText(name, SLOT[0] / 2, top + 23)
      pen.fillStyle = '#d9dee5'
      pen.font = '500 30px -apple-system, system-ui, sans-serif'
      lines.forEach((l, i) => pen.fillText(l, SLOT[0] / 2, top + 60 + i * 38))
      device.queue.copyExternalImageToTexture({ source: paper }, { texture: sheet, origin: [(slot % SLOTS[0]) * SLOT[0], Math.floor(slot / SLOTS[0]) * SLOT[1]], premultipliedAlpha: true }, SLOT)
      w = { slot, wide, tall, used: frames }
      written.set(key, w)
    }
    w.used = frames
    return w
  }
  const drawn = { people: 0, boxes: 0, ms: 0 }
  const self: People = {
    from: [],
    drawn,
    draw(encoder, to, view, seconds) {
      const began = performance.now()
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
        n = figure(p, packed, n, anchor, off > 450)
        count++
        if (p.name && off < 900 && off > 6 && named < SLOTS[0] * SLOTS[1]) {
          // Over the head, the size letters should be on the screen: no smaller than can be read, no bigger than a hand.
          const w = write(p.name, p.says ?? ''), o = named++ * 12
          const high = to.size[1] / (2 * view.tanHalf * Math.max(ahead, 1)), tall = Math.max(to.size[1] * 0.034, Math.min(to.size[1] * 0.05, 2.4 * high)) * (w.tall / 44) / high
          board[o] = p.at[0] - anchor[0]; board[o + 1] = p.at[1] + (p.umbrella ? 29 : 19.5) * (1 - (p.down ?? 0) * 0.8) - anchor[1]; board[o + 2] = p.at[2] - anchor[2]
          board[o + 3] = Math.min(1, (900 - off) / 200)
          board[o + 4] = tall * w.wide / w.tall; board[o + 5] = tall
          const sx = (w.slot % SLOTS[0]) * SLOT[0], sy = Math.floor(w.slot / SLOTS[0]) * SLOT[1], W = SLOT[0] * SLOTS[0], H = SLOT[1] * SLOTS[1]
          board[o + 8] = (sx + (SLOT[0] - w.wide) / 2) / W; board[o + 9] = (sy + SLOT[1] - w.tall) / H; board[o + 10] = (sx + (SLOT[0] + w.wide) / 2) / W; board[o + 11] = (sy + SLOT[1]) / H
        }
        if (lies < 1024 && off < 1500) {
          const o = lies++ * 8, lying = p.down ?? 0
          shade[o] = p.at[0] - anchor[0]; shade[o + 1] = p.at[1] - anchor[1]; shade[o + 2] = p.at[2] - anchor[2]; shade[o + 3] = (p.umbrella ? 5 : 2.6) + lying * 2
          shade[o + 4] = -sun[0] / flat; shade[o + 5] = -sun[2] / flat; shade[o + 6] = reach * (1 - lying * 0.8); shade[o + 7] = 0
        }
      }
      drawn.people = count; drawn.boxes = n / EACH
      if (!count) { drawn.ms += (performance.now() - began - drawn.ms) * 0.05; return }
      device.queue.writeBuffer(boxes, 0, packed, 0, n)
      device.queue.writeBuffer(lain, 0, shade, 0, lies * 8)
      const wrap = (v: number, by: number) => ((v % by) + by) % by
      // No lamp stands in open country: a block whose middle is more than 3.5 km from where the page starts (march.ts lit).
      const town = Math.hypot((Math.floor(view.eye[0] / 1280) + 0.5) * 1280 - 700, (Math.floor(view.eye[2] / 800) + 0.5) * 800 - 4070) < 35000
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf,
        ...view.right, to.size[0] / to.size[1], ...view.up, town ? 1 : 0, ...view.forward, 0,
        wrap(anchor[0], 1280), wrap(anchor[2], 800), 0, 0,
      ]))
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setBindGroup(0, view0)
      pass.setBindGroup(1, lit)
      if (lies) {
        pass.setPipeline(shadows)
        pass.setVertexBuffer(0, lain)
        pass.draw(6, lies)
      }
      pass.setPipeline(bodies)
      pass.setVertexBuffer(0, boxes)
      pass.draw(36, n / EACH)
      if (named) {
        device.queue.writeBuffer(boards, 0, board, 0, named * 12)
        pass.setPipeline(signed)
        pass.setBindGroup(0, signView)
        pass.setBindGroup(1, signSheet)
        pass.setVertexBuffer(0, boards)
        pass.draw(6, named)
      }
      pass.end()
      drawn.ms += (performance.now() - began - drawn.ms) * 0.05
    },
  }
  return self
}

/** How far off residents are worked out and drawn, in cells. */
export const REACH = 1400

/**
 * The town's residents as people to draw: the rule's (residents.ts), with what is this page's own: whether it
 * rains here, so umbrellas are up. `clock` is seconds on the clock every page of a world shares;
 * `shocks` is what has gone off lately, for whoever makes a blast to add to.
 */
export function townsfolk(land: Land, hour: () => number, rain: () => number, clock: () => number, shocks: Shock[]): (view: View, seconds: number) => readonly Person[] {
  const found: Resident[] = [], shown: Person[] = []
  return (view, seconds) => {
    const now = clock()
    // A bang is forgotten once everyone it moved is back where they would have been.
    while (shocks.length && now - shocks[0].t > 60) shocks.shift()
    const n = residents(land, [view.eye[0], view.eye[2]], REACH, now, hour(), found, shocks), wet = rain() > 0.3
    shown.length = n
    for (let i = 0; i < n; i++) {
      const r = found[i], p = (shown[i] ??= { at: r.at, yaw: 0, seed: 0 }) as { -readonly [K in keyof Person]: Person[K] }
      p.at = r.at; p.yaw = r.yaw; p.seed = r.seed; p.stride = r.stride; p.walking = r.walking; p.reading = r.reading
      p.umbrella = r.carries && wet; p.time = seconds; p.flinch = r.flinch; p.down = r.down
    }
    return shown
  }
}
