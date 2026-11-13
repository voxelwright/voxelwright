// The world from high up (#140). The boxes of cells reach 13 km; from over 25 km the eye sees more than they hold,
// and what it sees is the planet: a ball as big as the Earth, its land and sea by a rule of the same kind as the
// ground's (noise that is the same everywhere it is asked), under cloud and air. It is one pass of its own, drawn in
// place of the marcher, so nothing here costs a street anything.
//
// The flat world is laid on the ball from under the eye: a place at an angle from straight down, on a bearing, is
// that far along the ground on that bearing. Straight down is exact, so coming down from space ends where it began.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const CODE = /* wgsl */ `
struct U {
  right: vec3f, aspect: f32, up: vec3f, tanHalf: f32, forward: vec3f, high: f32, sun: vec3f, time: f32,
  // Where the eye is over the ground, km from where the page starts (east, south), and the size of the picture.
  over: vec2f, res: vec2f,
  // How much of the day it is where the eye is (1 day, 0 night).
  day: f32, pad0: f32, pad1: f32, pad2: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var chance: texture_2d<f32>;
@group(0) @binding(2) var between: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
// The ball's radius, km, and how far north of its middle line the page starts (San Francisco's).
const R = 6371.0;
const NORTH = 0.66;
fn hash2(x: i32, z: i32, seed: u32) -> u32 {
  var h = (u32(x) * 73856093u) ^ (u32(z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}
fn unit(x: i32, z: i32, seed: u32) -> f32 { return f32(hash2(x, z, seed) >> 8u) / 16777216.0; }
// Smooth noise from 0 to 1 whose lumps are period km across: the core's own (hash.rs), asked in km.
fn noise(p: vec2f, period: f32, seed: u32) -> f32 {
  let q = p / period;
  let c = vec2i(floor(q));
  let f = fract(q);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(unit(c.x, c.y, seed), unit(c.x + 1, c.y, seed), e.x), mix(unit(c.x, c.y + 1, seed), unit(c.x + 1, c.y + 1, seed), e.x), e.y);
}
fn folds(p: vec2f, period: f32, seed: u32) -> f32 {
  return noise(p, period, seed) * 0.5 + noise(p, period / 2.3, seed + 1u) * 0.27 + noise(p, period / 5.1, seed + 2u) * 0.15 + noise(p, period / 11.0, seed + 3u) * 0.08;
}
// Finer and softer, for what is only looked at (cloud, the grain of the land): each fold is turned a little from
// the last, so the squares the noise is made on do not line up and show.
fn wisps(p: vec2f, period: f32, seed: u32) -> f32 {
  var q = p;
  var size = period;
  var sum = 0.0;
  var weight = 0.5;
  for (var k = 0u; k < 5u; k++) {
    sum += noise(q + vec2f(f32(k) * 37.0, f32(k) * 91.0), size, seed + k) * weight;
    q = vec2f(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8);
    size *= 0.47;
    weight *= 0.5;
  }
  return sum / 0.97;
}
// The core's noise as it asks it: whole cells, whole-cell periods (hash.rs noise).
fn cells(x: f32, z: f32, period: f32, seed: u32) -> f32 {
  let c = vec2i(floor(vec2f(x, z) / period));
  let f = fract(vec2f(x, z) / period);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(unit(c.x, c.y, seed), unit(c.x + 1, c.y, seed), e.x), mix(unit(c.x, c.y + 1, seed), unit(c.x + 1, c.y + 1, seed), e.x), e.y);
}
// How high the town's own ground is at a column, in cells (land.rs ground, where the land is the town's).
fn townGround(x: f32, z: f32) -> f32 {
  return cells(x, z, 9000.0, 11u) * 1200.0 + cells(x, z, 2600.0, 12u) * 300.0 + cells(x, z, 700.0, 13u) * 50.0 - 560.0;
}
// How far a place is out to sea, in cells: the coast west of the town (land.rs offshore). Over 0 is sea.
fn offshore(x: f32, z: f32) -> f32 {
  let cape = 1.0 - abs(cells(x, z, 7300.0, 52u) * 2.0 - 1.0);
  return 700.0 - x - 66000.0 + (cells(x, z, 23000.0, 51u) - 0.5) * 20000.0 + (0.5 - cape) * 10000.0 + (cells(x, z, 1500.0, 53u) - 0.5) * 1800.0;
}
// The town and the country round it as the cells have them, seen from over it: its lakes where its ground is under
// the sea's level, its blocks 128 m by 80 m with a street along two sides, and each block what city.rs block says
// it is. p is km east and south of the start; the answer is colour before light, and in a how much of it is water.
fn town(p: vec2f) -> vec4f {
  let x = 700.0 + p.x * 10000.0;
  let z = 4070.0 + p.y * 10000.0;
  let far = length(p) * 10000.0;
  let open = select(smoothstep(30000.0, 40000.0, far), 0.0, abs(p.x) < 2.1 && abs(p.y) < 2.1);
  let grass = vec3f(0.11, 0.25, 0.045) * (0.8 + 0.4 * cells(x, z, 160.0, 14u));
  var col = grass;
  let b = vec2i(floor(vec2f(x / 1280.0, z / 800.0)));
  let mid = (vec2f(b) + 0.5) * vec2f(1280.0, 800.0);
  let out = length(mid - vec2f(700.0, 4070.0));
  let country = smoothstep(30000.0, 40000.0, out) > 0.5 && !(abs(mid.x - 700.0) < 21000.0 && abs(mid.y - 4070.0) < 21000.0);
  if (!country) {
    let within = vec2f(x, z) - vec2f(b) * vec2f(1280.0, 800.0);
    let lot = hash2(i32(floor(within.x / 76.0)) + b.x * 31, i32(floor(within.y / 160.0)) + b.y * 57, 15u);
    if (townGround(mid.x, mid.y) < 15.0) {
      // The shore: sand and grass.
      col = mix(grass, vec3f(0.55, 0.47, 0.3), 0.5);
    } else if (all(b == vec2i(0, 5)) || hash2(b.x, b.y, 23u) % 17u == 0u) {
      col = vec3f(0.07, 0.07, 0.075);
    } else if (cells(f32(b.x), f32(b.y), 7.0, 21u) > 0.64) {
      // Towers of glass on paving.
      col = mix(vec3f(0.12, 0.12, 0.125), vec3f(0.085, 0.1, 0.125), f32(lot & 1u));
    } else if (hash2(b.x, b.y, 22u) % 14u == 0u) {
      col = grass * mix(0.55, 1.0, f32(lot & 1u));
    } else {
      // Homes: roofs, each its own dark shade, and the gardens behind them.
      col = mix(vec3f(0.075, 0.07, 0.065) * (0.7 + 0.6 * f32(lot >> 24u) / 255.0), grass * 0.8, select(0.3, 1.0, abs(within.y - 470.0) < 60.0));
    }
    // Its streets: one along each low side of every block.
    if (within.x < 140.0 || within.y < 140.0) { col = vec3f(0.1, 0.103, 0.115); }
  }
  let wet = select(0.0, 1.0, townGround(x, z) < 0.0) * (1.0 - open * 0.0);
  return vec4f(col, wet);
}
// Four smooth noises at once, 0 to 1, lumps period km across: a picture of chance numbers asked between its
// points. For what is only looked at; what the cells must agree with is asked of the core's own noise above.
fn four(p: vec2f, period: f32) -> vec4f {
  let q = p / period;
  let c = floor(q);
  let f = q - c;
  return textureSampleLevel(chance, between, (c + f * f * (3.0 - 2.0 * f) + 0.5) / 256.0, 0.0);
}
// Four chance numbers for the square a place is in, the same all over it.
fn lot(c: vec2f) -> vec4f { return textureSampleLevel(chance, between, (c + 0.5) / 256.0, 0.0); }
fn turn(q: vec2f) -> vec2f { return vec2f(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8); }
// Folds of it, each turned from the last and half as strong. A fold finer than a few pixels (px is km a pixel) is
// left as its middle value: it would only glitter.
fn weave(p: vec2f, period: f32, count: u32, px: f32) -> vec4f {
  var q = p;
  var size = period;
  var sum = vec4f(0.0);
  var weight = 0.5;
  var all = 0.0;
  for (var k = 0u; k < count; k++) {
    let see = smoothstep(1.0, 3.0, size / px);
    sum += mix(vec4f(0.5), four(q + vec2f(f32(k) * 37.3, f32(k) * 91.7), size), see) * weight;
    all += weight;
    q = turn(q);
    size *= 0.47;
    weight *= 0.5;
  }
  return sum / all;
}
// How high the mountains stand at a column, 0 to 1: land.rs high, its two big ridges and its massifs, as the cells
// have them (the finer ridges are under a pixel from here and are their mean).
fn slanted(x: f32, z: f32, c: f32, s: f32) -> vec2f { return trunc(vec2f(x * c - z * s, x * s + z * c) / 16.0); }
fn ridged(at: vec2f, period: f32, seed: u32) -> f32 {
  let r = 1.0 - abs(cells(at.x, at.y, period, seed) * 2.0 - 1.0);
  return r * r;
}
fn mountain(x: f32, z: f32, px: f32) -> f32 {
  let a = slanted(x, z, 14.0, 8.0);
  let b = slanted(x, z, 7.0, -14.0);
  let bend = trunc((cells(x, z, 30000.0, 39u) - 0.5) * 22000.0);
  let twist = trunc((cells(x, z, 21000.0, 71u) - 0.5) * 16000.0);
  let home = 1.0 - smoothstep(45000.0, 110000.0, length(vec2f(x - 700.0, z - 4070.0 + 105000.0)));
  let mass = 0.3 + 0.7 * max(smoothstep(0.3, 0.62, cells(a.x, a.y, 95000.0, 38u)), home);
  let first = ridged(a + vec2f(bend, -twist), 46000.0, 31u);
  let second = ridged(b + vec2f(-trunc(twist / 2.0), trunc(bend / 2.0)), 19000.0, 32u);
  let body = first * 0.62 + second * 0.38 * (0.35 + 0.65 * first);
  // The finer ridges, the spurs and gullies and the small faces, each from where a pixel is small enough to show
  // it (px is in cells here); from higher it is its mean.
  let c = slanted(x, z, 16.0, 3.0);
  let d = slanted(x, z, -9.0, 13.0);
  var third = 0.333;
  var fourth = 0.333;
  var spur = 0.5;
  var face = 0.5;
  if (px < 3600.0) { third = mix(third, ridged(c + vec2f(trunc(twist / 4.0), 0.0), 7200.0, 33u), 1.0 - smoothstep(1200.0, 3600.0, px)); }
  if (px < 1300.0) { fourth = mix(fourth, ridged(d, 2600.0, 34u), 1.0 - smoothstep(430.0, 1300.0, px)); }
  if (px < 480.0) { spur = mix(spur, 1.0 - abs(cells(a.x, a.y, 950.0, 72u) * 2.0 - 1.0), 1.0 - smoothstep(160.0, 480.0, px)); }
  if (px < 160.0) { face = mix(face, 1.0 - abs(cells(b.x, b.y, 330.0, 73u) * 2.0 - 1.0), 1.0 - smoothstep(55.0, 160.0, px)); }
  let flank = min(0.25 + body * 1.5, 1.0);
  return mass * (body * 0.84 + (third * 0.1 + fourth * 0.04) * flank + (spur * 0.016 + face * 0.005) * flank * (0.3 + body));
}
// What a field grows, by its lot: straw, young green, deep green, turned earth.
fn crop(v: f32) -> vec3f {
  return select(select(select(vec3f(0.27, 0.2, 0.12), vec3f(0.1, 0.2, 0.06), v < 0.82), vec3f(0.2, 0.31, 0.095), v < 0.58), vec3f(0.44, 0.39, 0.19), v < 0.3);
}
// Fields in rows, each row set off from the next, each field its own lot.
fn fields(p: vec2f, size: vec2f) -> vec4f {
  let row = floor(p.y / size.y);
  let jog = lot(vec2f(row, 113.0)).x;
  return lot(vec2f(floor(p.x / size.x + jog * 3.0), row));
}
// How much cloud is over a place, 0 to 1: weather hundreds of kilometres across, broken into banks and small heaps.
fn cloud(p: vec2f, px: f32) -> f32 {
  let drift = vec2f(u.time * 0.02, 0.0);
  let slow = weave(p + drift, 1500.0, 3u, px);
  let fine = weave(p + drift * 3.0, 120.0, 5u, px);
  // Broken finer still at its edges, so a bank ends in heaps and not in a line.
  let heaps = weave(p + drift * 3.0, 14.0, 3u, px).z;
  return smoothstep(0.62, 0.7, slow.x * 0.45 + fine.x * 0.43 + heaps * 0.12 + 0.015) * smoothstep(8.0, 60.0, u.high);
}
// What the ground is at a place (km east and south of the start), as colour before light: and how much of it is
// sea. px is how many km a pixel covers there.
struct Land { colour: vec3f, sea: f32 }
fn land(p: vec2f, px: f32) -> Land {
  var out: Land;
  let far = length(p);
  // Land where this is over 0: big lands and seas, with the start well inside one.
  // West of the start is open sea, from the coast the cells have 6.6 km out (land.rs offshore): near the start
  // its line is the cells' own, drawn below, and further off it wanders.
  let c0 = folds(p, 5200.0, 61u) - 0.5 + 0.2 * exp(-far * far / (1100.0 * 1100.0)) - 0.7 * smoothstep(5.0, 45.0, -p.x + ((noise(p, 90.0, 62u) - 0.5) * 120.0 + (wisps(p, 380.0, 98u) - 0.5) * 520.0) * smoothstep(40.0, 160.0, far)) * exp(-far * far / (1500.0 * 1500.0));
  // The coast in detail: bays, capes and islands down to a few kilometres, away from the start (whose own
  // coast the cells have).
  let fine = ((wisps(p, 420.0, 91u) - 0.5) * 0.1 + (wisps(p, 60.0, 92u) - 0.5) * 0.024) * smoothstep(40.0, 160.0, far);
  let c = c0 + fine;
  out.sea = 1.0 - smoothstep(-0.006, 0.0, c);
  let lat = NORTH - p.y / R;
  let cold = smoothstep(0.95, 1.25, abs(lat));
  let toSun = normalize(u.sun.xz + vec2f(1e-5, 0.0));
  // How much of the ground is the planet's and not the town's country (land.rs far), and the town's own mountains
  // and plain (land.rs peaks, dry).
  let w = smoothstep(22.0, 60.0, far + (cells(700.0 + p.x * 10000.0, 4070.0 + p.y * 10000.0, 150000.0, 76u) - 0.5) * 10.0);
  let open = smoothstep(3.0, 4.0, far);
  let peaks = open * smoothstep(4.5, 8.5, -p.y) * (1.0 - w);
  let plain = open * smoothstep(3.8, 6.0, p.x) * (1.0 - smoothstep(2.5, 5.0, -p.y)) * (1.0 - w);
  var col = vec3f(0.0);
  var stream = 0.0;
  if (out.sea < 1.0) {
    let slow = weave(p, 420.0, 3u, px);
    let mid = weave(p, 55.0, 5u, px);
    // Dry lands (land.rs arid): one begins east of the town, where the town's own dry plain ends.
    let east = 1.0 - smoothstep(0.6, 1.2, length(p - vec2f(130.0, 40.0)) / (150.0 * (0.6 + 0.55 * noise(p, 120.0, 66u) + 0.3 * noise(p, 31.0, 68u))));
    let dry = smoothstep(0.5, 0.64, folds(p + vec2f(900.0, 0.0), 3100.0, 71u) + 0.8 * east) * (1.0 - cold);
    // The lie of the low land: creased hills, and the same a little way towards the sun.
    let reach = max(px * 1.5, 1.2);
    let lie = 1.0 - abs(weave(p, 38.0, 4u, px).x * 2.0 - 1.0);
    let sunward = 1.0 - abs(weave(p + toSun * reach, 38.0, 4u, px).x * 2.0 - 1.0);
    // Rivers: lines of water winding to the sea where a bent noise crosses its middle, broad in some country and
    // thin in other; a green valley along each.
    // (land.rs river: the cells have the same water, in valleys that come down to it.)
    let bent = vec2f(noise(p, 90.0, 96u), noise(p, 90.0, 97u));
    let wind = abs(wisps(p + bent * 40.0, 330.0, 95u) - 0.5);
    let broad = 0.0004 + 0.0012 * bent.x;
    let soft = px * 0.0013;
    let valley = 1.0 - smoothstep(0.0, 0.03, wind);
    let sunk = smoothstep(broad, broad + 0.012, wind);
    // Woods: dark, with edges, thick in some country and cleared in other, and more of them on the hills.
    let edge = clamp(px * 0.012, 0.006, 0.08);
    // Their edges are the edges of fields; there are copses among the fields and clearings in the woods.
    let near = weave(p, 9.0, 3u, px);
    let way = select(turn(p), vec2f(p.x * 0.96 + p.y * 0.28, p.y * 0.96 - p.x * 0.28), slow.z > 0.5);
    let small = fields(way, vec2f(1.9, 1.1));
    let cut = (small.z - 0.5) * 0.07 * (1.0 - smoothstep(0.35, 1.1, px));
    let wooded = mid.x - 0.56 + (slow.x - 0.5) * 0.45 + (lie - 0.5) * 0.12 - valley * 0.06 + cut;
    let wood = smoothstep(-edge, edge, wooded + (near.x - 0.5) * 0.5 * (1.0 - smoothstep(0.0, 0.12, abs(wooded) - 0.02)) + (near.x - 0.5) * 0.16);
    let trees = mix(vec3f(0.035, 0.085, 0.035), vec3f(0.07, 0.125, 0.035), smoothstep(0.35, 0.65, mid.y + (near.y - 0.5) * 0.4)) * (0.8 + 0.4 * near.z) * (0.72 + 0.56 * weave(p, 2.2, 3u, px).x);
    // Farmland: fields a kilometre or so across in rows, in districts of their own shade, lying one way in one
    // country and another way in the next.
    let large = fields(way + vec2f(31.0, 17.0), vec2f(7.3, 4.6));
    let lush = (slow.y - 0.5) * 0.9 + valley * 0.25;
    let mean = mix(vec3f(0.33, 0.31, 0.14), vec3f(0.17, 0.27, 0.085), clamp(0.5 + lush, 0.0, 1.0));
    var farm = mix(mean, mix(mean, crop(clamp(small.x - lush * 0.5, 0.0, 1.0)), 0.6) * (0.85 + 0.3 * small.y), 1.0 - smoothstep(0.35, 1.1, px));
    farm = mix(mean, farm * (0.8 + 0.4 * large.y) + (crop(large.x) - mean) * 0.18, 1.0 - smoothstep(2.0, 5.0, px)) * (0.9 + 0.2 * mid.w);
    // Between the two, rough pasture and heath with trees scattered on it.
    let heath = mix(vec3f(0.13, 0.2, 0.07), vec3f(0.2, 0.21, 0.1), mid.w) * (0.8 + 0.4 * near.y);
    let rough = smoothstep(-0.16, -0.1, wooded + (near.w - 0.5) * 0.12) * (1.0 - wood);
    col = mix(mix(farm, heath, rough), trees, wood * (0.55 + 0.45 * smoothstep(0.0, 0.07, wooded + (near.z - 0.5) * 0.1)));
    // Towns: pale, on low ground, bigger by the rivers; their streets show from low down.
    let built = smoothstep(0.74, 0.77, mid.z + (slow.y - 0.5) * 0.2 + valley * 0.06);
    let streets = lot(floor(way / 0.22));
    let towns = vec3f(0.38, 0.36, 0.33) * mix(1.0, 0.7 + 0.6 * streets.x, 1.0 - smoothstep(0.1, 0.4, px));
    col = mix(col, towns, built * 0.85);
    // Dry lands: sand and bare earth, red in some country, with dark rock standing out of it and pale pans.
    let sand = mix(vec3f(0.5, 0.4, 0.24), vec3f(0.4, 0.2, 0.115), smoothstep(0.49, 0.51, noise(p, 420.0, 77u) + 0.4 * exp(-far * far / (600.0 * 600.0)))) * (0.8 + 0.4 * mid.y);
    let streak = four(turn(way) * vec2f(1.0, 4.0), 9.0).x;
    var waste = mix(sand, vec3f(0.3, 0.2, 0.15), smoothstep(0.66, 0.72, mid.x + lie * 0.1) * 0.5) * (0.9 + 0.25 * streak);
    waste = mix(waste, vec3f(0.62, 0.56, 0.44), smoothstep(0.7, 0.74, mid.z));
    // Between green and dry, steppe: thin grass, no fields.
    col = mix(mix(col, vec3f(0.24, 0.22, 0.11) * (0.8 + 0.4 * mid.y), smoothstep(0.0, 0.5, dry)), waste, smoothstep(0.35, 0.9, dry));
    // Cold lands: brown moor, then snow.
    col = mix(col, vec3f(0.17, 0.16, 0.1) * (0.8 + 0.4 * mid.y), smoothstep(0.1, 0.6, cold) * (1.0 - dry));
    // Lit from the sun's side, and from low down the smaller folds of it too.
    let fold = weave(p, 5.0, 3u, px).y - weave(p + toSun * max(px, 0.3), 5.0, 3u, px).y;
    col *= clamp(1.0 - ((sunward - lie) * 2.6 - fold * 1.6) / max(u.sun.y, 0.3), 0.5, 1.5) * (0.82 + 0.36 * lie);
    let river = (1.0 - smoothstep(broad - soft, broad + soft, wind)) * min(1.0, broad * 1100.0 / max(px, 0.01)) * smoothstep(0.8, 0.95, w);
    col = mix(col, vec3f(0.03, 0.11, 0.17), river * 0.9);
    stream = river * 0.9;
    // The town's own dry plain, east of it.
    if (plain > 0.0) {
      // Red earth in drifts, and the tables of rock that stand on it away from the road (land.rs ground), dark
      // with their own shadows.
      let x = 700.0 + p.x * 10000.0;
      let z = 4070.0 + p.y * 10000.0;

      let tables = cells(x, z, 6400.0, 37u) * 0.75 + cells(x, z, 17000.0, 70u) * 0.25 - (1.0 - smoothstep(1500.0, 9000.0, abs(z - 4070.0))) * 0.3;

      let stands = smoothstep(0.585, 0.615, tables);
      var earth = mix(vec3f(0.4, 0.19, 0.11), vec3f(0.29, 0.135, 0.085), smoothstep(0.3, 0.7, cells(x, z, 2400.0, 44u)));
      earth = mix(earth, vec3f(0.2, 0.105, 0.075), stands * 0.8);
      col = mix(col, earth, plain);
    }
    // Mountains: where the planet has its ranges, and north of the town; as high as the cells have them, with
    // woods on the feet, rock above and snow from where the cells have it. Lit from the sun's side.
    var mount = peaks;
    if (w > 0.0) {
      // (land.rs ranges: one range runs off north from the town's own massif.)
      let north = 1.0 - smoothstep(0.6, 1.2, length(p - vec2f(15.0, -140.0)) / (150.0 * (0.6 + 0.55 * noise(p, 120.0, 65u) + 0.3 * noise(p, 31.0, 67u))));
      mount += smoothstep(0.5, 0.66, folds(p, 1700.0, 64u) + 0.8 * north) * w;
    }
    // Far out every river has its valley, and the mountains come down to it.
    mount *= mix(1.0, sunk, w);
    var white = smoothstep(0.865, 0.875, cold + (cells(700.0 + p.x * 10000.0, 4070.0 + p.y * 10000.0, 30000.0, 75u) - 0.5) * 0.06);
    if (mount > 0.002) {
      let x = 700.0 + p.x * 10000.0;
      let z = 4070.0 + p.y * 10000.0;
      let step = max(px * 1.5, 0.03);
      let here = mount * mountain(x, z, px * 10000.0) * 3600.0;
      let there = mount * mountain(x + toSun.x * step * 10000.0, z + toSun.y * step * 10000.0, px * 10000.0) * 3600.0;
      let rise = (there - here) / (step * 1000.0);
      let rock = mix(vec3f(0.11, 0.105, 0.1), vec3f(0.2, 0.185, 0.17), mid.y * smoothstep(0.05, 0.6, px) + smoothstep(0.3, 2.0, px) * 0.5);
      let cover = mix(mix(col, trees * 0.9, smoothstep(40.0, 200.0, here) * (1.0 - dry)), rock, smoothstep(300.0, 520.0, here));
      let line = 530.0 - cold * 700.0;
      let snow = smoothstep(line - 70.0, line + 90.0, here) * (1.0 - smoothstep(0.45, 0.95, abs(rise)) * (1.0 - smoothstep(0.3, 1.5, px)));
      white = max(white, snow);
      let shade = clamp(1.0 - rise * mix(1.6, 1.0, smoothstep(0.1, 1.0, px)) / max(u.sun.y, 0.3), 0.15, 1.6);
      // Snow out of the sun is blue with the sky's light.
      let detailed = mix(col, mix(cover * shade, vec3f(0.63, 0.65, 0.69) * mix(vec3f(0.5, 0.6, 0.85), vec3f(1.0), smoothstep(0.3, 1.0, shade)) * min(shade, 1.2), snow), smoothstep(20.0, 120.0, here));
      // From so high that a ridge is under a pixel: rock and snow run together, lighter where the range is whole.
      let whole = mix(col, mix(rock * 0.8, vec3f(0.6, 0.62, 0.66), 0.35 + 0.3 * lie), smoothstep(0.1, 0.8, mount) * 0.9);
      col = mix(detailed, whole, smoothstep(1.2, 3.5, px));
    }
    col = mix(col, vec3f(0.62, 0.64, 0.67) * (0.9 + 0.2 * lie), smoothstep(0.865, 0.875, cold + (cells(700.0 + p.x * 10000.0, 4070.0 + p.y * 10000.0, 30000.0, 75u) - 0.5) * 0.06));
  }
  if (out.sea > 0.0) {
    // The sea: green-blue and clear over the shallows, which are broad in some bays and narrow off other shores;
    // then blue, then dark over the deep. Ice on it where it is coldest.
    let lay = weave(p, 260.0, 4u, px);
    let deep = max(-c, 0.0);
    // (Off the start's own coast the land's rule falls away steeply: the shallows there are as broad as elsewhere.)
    let shelf = (0.02 + 0.22 * lay.x * lay.x) * (1.0 + 5.0 * exp(-far * far / (1300.0 * 1300.0)));
    let shallow = 1.0 - smoothstep(0.0, shelf, deep + (lay.y - 0.5) * 0.01);
    var water = mix(vec3f(0.03, 0.2, 0.31), vec3f(0.015, 0.075, 0.17), smoothstep(0.05, 0.3, deep));
    water = mix(water, vec3f(0.04, 0.36, 0.4), shallow);
    water = mix(water, vec3f(0.16, 0.46, 0.42), (1.0 - smoothstep(0.0, 0.004, deep)) * 0.7);
    // Currents: paler and darker in long turns.
    water *= 0.8 + 0.25 * lay.z + 0.15 * weave(p + vec2f(lay.w, lay.z) * 60.0, 70.0, 3u, px).x;
    // (land.rs: floes at the edge of the ice, then a sheet.)
    col = mix(col, mix(water, vec3f(0.62, 0.66, 0.7), smoothstep(0.895, 0.905, cold + (cells(700.0 + p.x * 10000.0, 4070.0 + p.y * 10000.0, 30000.0, 75u) - 0.5) * 0.06)), out.sea);
  }
  // Within 30 km of the start it is the town and its country as the cells have them, where the mountains and the
  // plain have not changed them; from far up it runs together into grey.
  out.sea = max(out.sea, stream);
  // From just over the cells water shows the sky, as theirs does.
  let sheen = 0.6 * exp(-(u.high - 6.0) / 10.0);
  let close = 1.0 - smoothstep(22.0, 30.0, far);
  if (close > 0.0) {
    let t = town(p);
    let lake = t.a * (1.0 - max(peaks, plain));
    let made = mix(t.rgb, mix(vec3f(0.03, 0.16, 0.24), vec3f(0.2, 0.27, 0.32), sheen), lake);
    let keep = close * (1.0 - smoothstep(0.2, 0.6, max(peaks, plain)) * (1.0 - lake));
    col = mix(col, made, keep);
    out.sea = mix(out.sea, lake, keep);
  }
  // The sea west of the town, as land.rs has it: its coast with its coves and capes, pale over the shelf.
  if (p.x < -4.2 && far < 120.0) {
    let s = offshore(700.0 + p.x * 10000.0, 4070.0 + p.y * 10000.0);
    let wet = smoothstep(-160.0, -60.0, s) * (1.0 - w);
    col = mix(col, mix(mix(vec3f(0.05, 0.27, 0.3), vec3f(0.012, 0.05, 0.13), smoothstep(0.0, 9000.0, s)), vec3f(0.2, 0.27, 0.32), sheen), wet);
    out.sea = max(out.sea, wet);
  }
  out.colour = col;
  return out;
}
fn tone(c: vec3f) -> vec3f {
  let x = c * 0.43;
  let y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(y, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
// What the air does to light that crosses it: blue is thrown about most, red least.
const AIR = vec3f(0.03, 0.065, 0.16);
const BLUE = vec3f(0.3, 0.52, 1.0);
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  let rd = normalize(u.forward + u.right * (uv.x * u.tanHalf * u.aspect) - u.up * (uv.y * u.tanHalf));
  // The ball's middle is straight down from the eye.
  let b = rd.y * (R + u.high);
  let c = u.high * (2.0 * R + u.high);
  let disc = b * b - c;
  var col = vec3f(0.0);
  if (b < 0.0 && disc > 0.0) {
    let t = -b - sqrt(disc);
    // The place it meets, from the ball's middle: how far round from straight down, and on which bearing.
    let out = vec3f(t * rd.x, t * rd.y + R + u.high, t * rd.z) / R;
    let arc = atan2(length(out.xz), out.y);
    let p = u.over + normalize(rd.xz + vec2f(1e-9, 0.0)) * (arc * R);
    let slant = max(dot(out, -rd), 0.02);
    // How many km of ground a pixel covers there, the long way.
    let px = t * 2.0 * u.tanHalf / u.res.y / sqrt(slant);
    let l = land(p, px);
    let day = dot(out, u.sun);
    // At night the light the page keeps is the moon's: the ball under the eye is dark then, but for its towns.
    let lit = smoothstep(-0.08, 0.25, day) * u.day;
    let sunlight = 0.05 + 3.0 * max(day, 0.0) * lit;
    // Cloud, lit on the side towards the sun, and its shadow on the ground a little way from under it.
    let toSun = normalize(u.sun.xz + vec2f(1e-5, 0.0));
    let cover = cloud(p, px);
    let shadow = cloud(p + toSun * 5.0, px);
    let lee = cloud(p + toSun * max(2.0, px * 2.0), px);
    var ground = l.colour * sunlight * (1.0 - 0.62 * shadow * (1.0 - cover));
    // The sun on the sea: a small bright patch where the water throws it at the eye, and a wide dull one round it.
    let thrown = max(dot(reflect(rd, out), u.sun), 0.0);
    ground += vec3f(1.0, 0.93, 0.82) * (pow(thrown, 1500.0) * 1.6 + pow(thrown, 90.0) * 0.07) * l.sea * lit * (1.0 - shadow);
    // Lights where the town is, on the night side.
    ground += vec3f(1.0, 0.75, 0.4) * (1.0 - smoothstep(2.0, 3.4, length(p))) * (1.0 - lit) * 0.6 * noise(p, 0.12, 78u);
    ground = mix(ground, vec3f(0.84, 0.86, 0.9) * sunlight * clamp(0.72 + (cover - lee) * 0.9, 0.5, 1.1), smoothstep(0.0, 0.5, cover) * 0.95);
    // The air between: the more aslant the look goes through it the more of the ground's light it takes and the
    // more of its own it gives, blue first: a blue veil, and pale at the planet's edge.
    let through = exp(-AIR / slant);
    col = ground * through + mix(BLUE, vec3f(0.75, 0.88, 1.0), 1.0 - through.r) * (0.02 + 1.5 * lit) * (1.0 - through);
    // Just over where the cells are drawn, the same pale air that lies between the eye and the town from 6 km up.
    col = mix(col, vec3f(0.62, 0.65, 0.68) * (0.03 + 1.25 * lit), 0.4 * exp(-(u.high - 6.0) / 14.0));
  } else {
    // Past the ball's edge: its air, thinner the higher the look passes over the ground: pale, then blue, then
    // the dark, and stars.
    let miss = sqrt(max((R + u.high) * (R + u.high) - b * b, 0.0)) - R;
    let towards = select(0.0, 1.0, b < 0.0);
    let thin = exp(-max(miss, 0.0) / 11.0) * towards;
    let s = hash2(i32(floor(rd.x * 420.0 + 2000.0)) + i32(floor(rd.z * 420.0 + 2000.0)) * 4096, i32(floor(rd.y * 420.0 + 2000.0)), 91u);
    let star = select(0.0, f32(s >> 24u) / 255.0, (s & 1023u) < 2u);
    let glow = 1.0 - exp(-AIR * 50.0 * thin);
    col = mix(BLUE, vec3f(0.75, 0.88, 1.0), glow.r) * 1.5 * glow * smoothstep(-0.3, 0.3, dot(normalize(vec3f(rd.x, 0.2, rd.z)), u.sun) + 0.6) * max(u.day, 0.02) + vec3f(star) * (1.0 - glow.b);
    // The sun itself.
    col += vec3f(1.0, 0.95, 0.85) * (smoothstep(0.9994, 0.9998, dot(rd, u.sun)) * 6.0 + pow(max(dot(rd, u.sun), 0.0), 600.0) * 0.8);
  }
  return vec4f(tone(col), 1.0);
}
`

export interface Space {
  /** Draws the planet as seen from `high` km over a place `over` km east and south of where the page starts. `day` is how much of the day it is there. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, high: number, over: readonly [number, number], sun: readonly number[], day: number, time: number, timing?: GPURenderPassTimestampWrites): void
}

export async function space(device: GPUDevice, format: GPUTextureFormat): Promise<Space> {
  const module = await shader(device, 'space', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'space', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
  })
  const uniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  // Chance numbers, four to a point, 256 points a side and the same every time: the pass asks between them for
  // the noise of what is only looked at (a hash for each was most of its cost).
  const SIDE = 256, numbers = new Uint16Array(SIDE * SIDE * 4), single = new Float32Array(1), bits = new Uint32Array(single.buffer)
  let state = 0x2f6e2b1
  for (let i = 0; i < numbers.length; i++) {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    single[0] = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    // A half float, as the texture holds it.
    const power = (bits[0] >> 23) & 0xff
    numbers[i] = power < 113 ? 0 : ((power - 112) << 10) | ((bits[0] >> 13) & 0x3ff)
  }
  const chance = device.createTexture({ label: 'space chance', size: [SIDE, SIDE], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: chance }, numbers, { bytesPerRow: SIDE * 8 }, [SIDE, SIDE])
  const between = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: chance.createView() }, { binding: 2, resource: between }] })
  return {
    draw(encoder, to, view, high, over, sun, day, time, timing) {
      const length = Math.hypot(sun[0], sun[1], sun[2])
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        ...view.right, to.size[0] / to.size[1], ...view.up, view.tanHalf, ...view.forward, high, sun[0] / length, sun[1] / length, sun[2] / length, time,
        over[0], over[1], to.size[0], to.size[1], day, 0, 0, 0,
      ]))
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
}
