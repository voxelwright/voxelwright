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
}
@group(0) @binding(0) var<uniform> u: U;
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
// What the ground is at a place (km east and south of the start), as colour before light: and how high, km.
struct Land { colour: vec3f, high: f32, sea: f32 }
fn land(p: vec2f) -> Land {
  var out: Land;
  let far = length(p);
  // Land where this is over 0: big lands and seas, with the start well inside one.
  // West of the start, from 60 km out, is open sea: the town stands near a coast.
  let c = folds(p, 5200.0, 61u) - 0.5 + 0.2 * exp(-far * far / (1100.0 * 1100.0)) - 0.4 * smoothstep(60.0, 260.0, -p.x + (noise(p, 90.0, 62u) - 0.5) * 120.0) * exp(-far * far / (1500.0 * 1500.0));
  let ridge = 1.0 - abs(noise(p, 520.0, 68u) * 2.0 - 1.0);
  let range = smoothstep(0.5, 0.66, folds(p, 1700.0, 64u)) * smoothstep(0.0, 0.05, c);
  out.high = max(c, 0.0) * 2.5 + range * ridge * ridge * 5.0;
  let lat = NORTH - p.y / R;
  let cold = smoothstep(0.95, 1.25, abs(lat));
  let dry = smoothstep(0.5, 0.64, folds(p + vec2f(900.0, 0.0), 3100.0, 71u)) * (1.0 - cold);
  // The grain of the land: woods and fields, darker and paler, down to a few kilometres.
  let grain = wisps(p, 60.0, 75u);
  // And finer, from lower down: a patchwork of fields a kilometre or two across, each its own shade.
  let field = vec2i(floor(vec2f(p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8) / 1.6));
  let patch_ = (unit(field.x, field.y, 76u) - 0.5) * (1.0 - smoothstep(150.0, 900.0, u.high)) + (wisps(p, 7.0, 79u) - 0.5) * 0.8 * (1.0 - smoothstep(300.0, 2000.0, u.high));
  let green = mix(vec3f(0.05, 0.13, 0.04), vec3f(0.17, 0.22, 0.08), smoothstep(0.3, 0.7, grain)) * (1.0 + patch_ * 0.55);
  var col = mix(green, vec3f(0.42, 0.34, 0.22) * (0.8 + 0.4 * grain), dry);
  col = mix(col, vec3f(0.24, 0.23, 0.22), smoothstep(1.4, 2.6, out.high));
  col = mix(col, vec3f(0.62, 0.64, 0.67), max(smoothstep(2.6 - cold * 3.0, 3.4 - cold * 3.0, out.high), smoothstep(0.75, 1.0, cold)));
  // Near the start it is the land the town stands in (land.rs): mountains to the north, a dry plain to the east.
  let near = 1.0 - smoothstep(40.0, 120.0, far);
  let open = smoothstep(3.0, 4.0, far);
  let peaks = open * smoothstep(4.5, 8.5, -p.y) * near;
  let plain = open * smoothstep(3.8, 6.0, p.x) * (1.0 - smoothstep(2.5, 5.0, -p.y)) * near;
  col = mix(col, vec3f(0.4, 0.33, 0.22), plain);
  // Ridges, lit from the sun's side: rock, with snow along the tops.
  let crest = 1.0 - abs(wisps(p, 26.0, 31u) * 2.0 - 1.0);
  let sunward = 1.0 - abs(wisps(p + normalize(u.sun.xz + vec2f(1e-5, 0.0)) * 0.8, 26.0, 31u) * 2.0 - 1.0);
  let rock = vec3f(0.2, 0.19, 0.18) * clamp(1.0 + (crest - sunward) * 9.0, 0.45, 1.6);
  col = mix(col, mix(rock, vec3f(0.6, 0.62, 0.65), smoothstep(0.8, 0.93, crest)), peaks);
  // The town: grey, three kilometres out from the start.
  col = mix(col, vec3f(0.26, 0.255, 0.25) * (0.85 + 0.3 * noise(p, 0.5, 77u)), 1.0 - smoothstep(2.6, 3.4, far));
  out.sea = 1.0 - smoothstep(-0.006, 0.0, c);
  // The sea: dark and blue far out, green-blue over the shallows by the land; ice on it where it is coldest.
  let water = mix(vec3f(0.03, 0.2, 0.24), vec3f(0.012, 0.05, 0.13), smoothstep(0.0, 0.035, -c));
  col = mix(col, mix(water, vec3f(0.6, 0.64, 0.68), smoothstep(0.85, 1.0, cold)), out.sea);
  out.colour = col;
  return out;
}
fn tone(c: vec3f) -> vec3f {
  let x = c * 0.43;
  let y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(y, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  let rd = normalize(u.forward + u.right * (uv.x * u.tanHalf * u.aspect) - u.up * (uv.y * u.tanHalf));
  // The ball's middle is straight down from the eye.
  let b = rd.y * (R + u.high);
  let c = u.high * (2.0 * R + u.high);
  let disc = b * b - c;
  let air = vec3f(0.3, 0.52, 0.95);
  var col = vec3f(0.0);
  if (b < 0.0 && disc > 0.0) {
    let t = -b - sqrt(disc);
    // The place it meets, from the ball's middle: how far round from straight down, and on which bearing.
    let out = vec3f(t * rd.x, t * rd.y + R + u.high, t * rd.z) / R;
    let arc = atan2(length(out.xz), out.y);
    let p = u.over + normalize(rd.xz + vec2f(1e-9, 0.0)) * (arc * R);
    let l = land(p);
    let day = dot(out, u.sun);
    let lit = smoothstep(-0.08, 0.25, day);
    // Cloud: sheets and broken fields, drifting, and its shadow is not drawn.
    let drift = vec2f(u.time * 0.02, 0.0);
    let cover = smoothstep(0.54, 0.74, wisps(p + drift, 1400.0, 81u) * 0.6 + wisps(p * 1.0 + drift * 3.0, 130.0, 85u) * 0.4) * smoothstep(8.0, 60.0, u.high);
    var ground = l.colour * (0.05 + 3.0 * max(day, 0.0) * lit);
    // The sun on the sea: a bright patch where the water throws it at the eye.
    let glint = pow(max(dot(reflect(rd, out), u.sun), 0.0), 60.0) * l.sea * 1.6;
    ground += vec3f(1.0, 0.92, 0.8) * glint * lit;
    // Lights where the town is, on the night side.
    ground += vec3f(1.0, 0.75, 0.4) * (1.0 - smoothstep(2.0, 3.4, length(p))) * (1.0 - lit) * 0.6 * noise(p, 0.12, 78u);
    ground = mix(ground, vec3f(0.8, 0.82, 0.84) * (0.05 + 3.0 * max(day, 0.0) * lit), cover * 0.9);
    // The air between: thicker the more aslant the look goes through it, blue by day.
    let slant = max(dot(out, -rd), 0.03);
    let thick = 1.0 - exp(-0.13 / slant);
    // Blue through a little air, pale through a lot: the planet's edge is a bright band.
    col = mix(ground, mix(air, vec3f(0.75, 0.86, 1.0), thick * thick) * (0.02 + 1.9 * lit), thick * 0.85);
  } else {
    // Past the ball's edge: the thin bright line of its air, then the dark, and stars.
    let miss = sqrt(max((R + u.high) * (R + u.high) - b * b, 0.0)) - R;
    let towards = select(0.0, 1.0, b < 0.0);
    let glow = exp(-max(miss, 0.0) / 14.0) * towards;
    let s = hash2(i32(floor(rd.x * 420.0 + 2000.0)) + i32(floor(rd.z * 420.0 + 2000.0)) * 4096, i32(floor(rd.y * 420.0 + 2000.0)), 91u);
    let star = select(0.0, f32(s >> 24u) / 255.0, (s & 1023u) < 2u);
    col = mix(air, vec3f(0.8, 0.9, 1.0), glow * glow) * glow * 2.6 * smoothstep(-0.3, 0.3, dot(normalize(vec3f(rd.x, 0.2, rd.z)), u.sun) + 0.6) + vec3f(star) * (1.0 - glow);
    // The sun itself.
    col += vec3f(1.0, 0.95, 0.85) * (smoothstep(0.9994, 0.9998, dot(rd, u.sun)) * 6.0 + pow(max(dot(rd, u.sun), 0.0), 600.0) * 0.8);
  }
  return vec4f(tone(col), 1.0);
}
`

export interface Space {
  /** Draws the planet as seen from `high` km over a place `over` km east and south of where the page starts. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, high: number, over: readonly [number, number], sun: readonly number[], time: number, timing?: GPURenderPassTimestampWrites): void
}

export async function space(device: GPUDevice, format: GPUTextureFormat): Promise<Space> {
  const module = await shader(device, 'space', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'space', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  return {
    draw(encoder, to, view, high, over, sun, time, timing) {
      const length = Math.hypot(sun[0], sun[1], sun[2])
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        ...view.right, to.size[0] / to.size[1], ...view.up, view.tanHalf, ...view.forward, high, sun[0] / length, sun[1] / length, sun[2] / length, time,
        over[0], over[1], to.size[0], to.size[1],
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
