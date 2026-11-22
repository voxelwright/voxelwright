// Ambient life over the cached city, as seen from the park over the roofs: windows
// that change their lights through the night and gulls circling over the slope.
// Everything moves on the paused clock and is off on Low. The gulls depth-test
// against the cached city without writing depth, so towers, roofs and the signs
// hide whatever is behind them.
import { globals, light, air } from "./shaders.js";

// ---- Windows --------------------------------------------------------------------
// The city shader picks a fixed lit pattern per pane. Each pane now keeps its state
// for two to eight minutes and then rolls again, all on whole steps of the paused
// clock (Globals.pad1). A zero clock gives back the original pattern exactly, so
// Low and the first frame match the still.
export const WINDOW_STEP = 1;
const LIT = "let window = fract(sin(dot(floor(vec2f(fx,fy)),vec2f(12.31,78.19)) + f32(in.id)) * 437.15);";
export function windowsShader(code) {
  if (!code.includes(LIT)) throw Error("The city shader's window pattern moved");
  return code.replace(
    LIT,
    `let pick = dot(floor(vec2f(fx,fy)),vec2f(12.31,78.19)) + f32(in.id);
  let seed = fract(sin(pick) * 437.15);
  let turn = floor(g.pad1 / (120.0 + 360.0 * fract(seed * 13.7)) + fract(seed * 7.31));
  let window = fract(sin(pick + turn * 1.618) * 437.15);`,
  );
}
export const windowClock = (seconds) => Math.floor(seconds / WINDOW_STEP) * WINDOW_STEP;


// ---- Gulls ----------------------------------------------------------------------
// Western gulls kettle over the slope between the park and downtown. Each flock is
// set by its bearing and range from the survey station in place.json, its height in
// metres over NAVD88 and the radius it circles. The lowest bird stays at least 10 m
// over every roof within its orbit (checked in test/landing-life.test.mjs).
export const FLOCKS = [
  { bearing: 112, range: 170, height: 104, radius: 34, birds: 5, turn: 1 },
  { bearing: 126, range: 240, height: 110, radius: 45, birds: 6, turn: -1 },
  { bearing: 104, range: 310, height: 116, radius: 55, birds: 4, turn: 1 },
  { bearing: 131, range: 100, height: 100, radius: 20, birds: 3, turn: -1 },
];
export const GLIDE = 9; // Metres a second.
export const WANDER = 0.5; // The orbit's centre drifts by up to half its radius.
export const BOB = 2; // Metres up and down on the air.
export const SPREAD = 4; // Metres above or below the flock's height.
const random = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
// Pack cells: X east and Z south of the frame origin, Y above the 1 m datum, 10 a metre.
export function flockCentre(index, f) {
  const t = (f.bearing * Math.PI) / 180;
  return [
    (index.camera.at[0] + Math.sin(t) * f.range) * 10,
    (f.height - 1) * 10,
    (index.camera.at[2] - Math.cos(t) * f.range) * 10,
  ];
}
export function gulls(index, anchor) {
  const out = [];
  let n = 0;
  for (const f of FLOCKS) {
    const centre = flockCentre(index, f).map((v, i) => v - anchor[i]);
    for (let i = 0; i < f.birds; i++, n++) {
      const radius = f.radius + (random(n) - 0.5) * 8;
      out.push(
        ...centre,
        radius * 10,
        (f.turn * GLIDE * (0.92 + random(n + 50) * 0.16)) / radius,
        i * 0.55 + random(n + 90) * 0.3 + f.bearing,
        (random(n + 130) - 0.5) * 2 * SPREAD * 10,
        random(n + 170),
      );
    }
  }
  return new Float32Array(out);
}

// ---- Drawing --------------------------------------------------------------------
const code =
  globals +
  "\n" +
  light +
  "\n" +
  air +
  `
@group(0) @binding(0) var<uniform> g: Globals;
struct View {
  eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32,
  up: vec3f, near: f32, forward: vec3f, far: f32,
  sun: vec3f, pad: f32, light: vec4f,
}
@group(0) @binding(1) var<uniform> v: View;
struct Life { time: f32, power: f32, size: vec2f }
@group(0) @binding(2) var<uniform> k: Life;
struct Bird { centre: vec4f, motion: vec4f }
@group(0) @binding(3) var<storage, read> flock: array<Bird>;

fn clipOf(rel: vec3f) -> vec4f {
  let d = dot(rel, v.forward);
  return vec4f(dot(rel, v.right) / (v.tanHalf * v.aspect), dot(rel, v.up) / v.tanHalf, v.far / (v.far - v.near) * (d - v.near), d);
}
// The city's own light: sun and sky, scaled like the city pass, plus the warm glow
// of the streets and windows on undersides after dark.
fn lit(albedo: vec3f, n: vec3f, rel: vec3f, direct: f32) -> vec3f {
  let dist = max(length(rel), 1.0);
  let rd = rel / dist;
  var col = shade(albedo, n, rd, v.sun, direct, 1.0, 0.8, 0.0);
  col = (col + shade(albedo, n, rd, v.sun, 0.0, 1.0, 1.0, 0.0) * (v.light.x - 1.0)) * v.light.y;
  col += albedo * vec3f(0.95, 0.6, 0.32) * 0.5 * g.weather.z * (0.35 + 0.65 * max(-n.y, 0.0));
  return tone(air(col, rd, dist));
}

struct Solid {
  @builtin(position) clip: vec4f,
  @location(0) rel: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) albedo: vec3f,
}
// One corner of a box's 36 triangle-list vertices, in the box's own axes.
// Faces turned away from the eye collapse, so a box needs no depth writes.
fn box(vi: u32, origin: vec3f, f: vec3f, s: vec3f, u: vec3f, half: vec3f, albedo: vec3f) -> Solid {
  let face = (vi / 6u) % 6u;
  let c = vi % 6u;
  let uv = vec2f(f32(c == 1u || c == 4u || c == 5u), f32(c == 2u || c == 3u || c == 5u)) * 2.0 - 1.0;
  let axis = face / 2u;
  let pole = f32(face % 2u) * 2.0 - 1.0;
  var p = vec3f(pole, uv.x, uv.y);
  var n = vec3f(pole, 0.0, 0.0);
  if (axis == 1u) { p = vec3f(uv.y, pole, uv.x); n = vec3f(0.0, pole, 0.0); }
  if (axis == 2u) { p = vec3f(uv.x, uv.y, pole); n = vec3f(0.0, 0.0, pole); }
  p *= half;
  let world = origin + f * p.x + u * p.y + s * p.z;
  var o: Solid;
  o.n = normalize(f * n.x + u * n.y + s * n.z);
  o.rel = world - v.eye;
  o.albedo = albedo;
  o.clip = select(vec4f(2.0, 2.0, 2.0, 1.0), clipOf(o.rel), dot(o.n, o.rel) < 0.0);
  return o;
}

// A gull: a body and two wings hinged at its shoulders. It circles its flock's
// centre, banks into the turn, and flaps in short bursts between glides.
@vertex fn gull(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Solid {
  let b = flock[ii];
  let t = k.time;
  let seed = b.motion.w;
  let a = b.motion.y + b.motion.x * t;
  let wander = vec3f(sin(t * 0.011 + seed * 6.0), 0.0, cos(t * 0.009 + seed * 4.0)) * b.centre.w * ${WANDER};
  let outward = vec3f(cos(a), 0.0, sin(a));
  let origin = b.centre.xyz + wander + outward * b.centre.w + vec3f(0.0, b.motion.z + sin(t * 0.31 + seed * 9.0) * ${BOB * 10}.0, 0.0);
  let f = vec3f(-sin(a), 0.0, cos(a)) * sign(b.motion.x);
  let u = normalize(vec3f(0.0, 1.0, 0.0) - outward * 0.32);
  let s = normalize(cross(f, u));
  let part = vi / 36u;
  if (part == 0u) {
    return box(vi, origin, f, s, u, vec3f(3.2, 0.8, 0.8), vec3f(0.86, 0.87, 0.86));
  }
  let side = select(-1.0, 1.0, part == 1u);
  let gate = smoothstep(0.45, 0.8, sin(t * 0.45 + seed * 20.0));
  let lift = 0.12 + sin(t * 17.6 + seed * 30.0) * 0.6 * gate;
  let span = normalize(s * side * cos(lift) + u * sin(lift));
  let skin = normalize(cross(span, f)) * side;
  return box(vi, origin + s * side * 0.6 + span * 3.6, f, span, skin, vec3f(1.2, 0.2, 3.6), vec3f(0.56, 0.59, 0.63));
}
@fragment fn paint(in: Solid) -> @location(0) vec4f {
  return vec4f(lit(in.albedo, in.n, in.rel, max(dot(in.n, v.sun), 0.0)), k.power);
}`;

export async function lifePass(device, format, global, view) {
  const module = device.createShaderModule({ label: "City life", code });
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const group = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: VF, buffer: {} },
      { binding: 1, visibility: VF, buffer: {} },
      { binding: 2, visibility: VF, buffer: {} },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
    ],
  });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [group] });
  const depthStencil = { format: "depth24plus", depthCompare: "less-equal", depthWriteEnabled: false };
  const blend = { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "zero", dstFactor: "one" } };
  const birds = await device.createRenderPipelineAsync({
    label: "City life gull",
    layout,
    vertex: { module, entryPoint: "gull" },
    fragment: { module, entryPoint: "paint", targets: [{ format, blend }] },
    depthStencil,
  });
  // Fill in the flocks once the place is known.
  return function stock(flock) {
    const uniforms = new Float32Array(4);
    const life = device.createBuffer({ label: "City life clock", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const birdBuffer = device.createBuffer({ size: Math.max(32, flock.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(birdBuffer, 0, flock);
    const bind = device.createBindGroup({
      layout: group,
      entries: [global, view, life, birdBuffer].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const gullCount = flock.length / 8;
    // Drawn after the fog and the tow plane: the gulls are nearer than either.
    return function draw(encoder, screen, depth, size, time, power) {
      if (power <= 0 || !gullCount) return;
      uniforms.set([time, power, size[0], size[1]]);
      device.queue.writeBuffer(life, 0, uniforms);
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: screen, loadOp: "load", storeOp: "store" }],
        depthStencilAttachment: { view: depth, depthReadOnly: true },
      });
      pass.setBindGroup(0, bind);
      pass.setPipeline(birds);
      pass.draw(108, gullCount);
      pass.end();
    };
  };
}
