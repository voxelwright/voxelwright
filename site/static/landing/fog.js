// The marine layer. A post-copy pass that marches each view ray through a drifting
// slab of fog, reading the city's depth so towers rise out of it. The cached city
// is never rebaked: the fog moves on its own clock over the same picture.
import { globals } from "./shaders.js";

const NEAR = 80,
  FAR = 100000;
const code =
  globals +
  `
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var depth: texture_depth_2d;
struct Fog {
  eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, time: f32,
  ray: vec3f, strength: f32, forward: vec3f, steps: f32, size: vec2f, mood: f32, pad: f32,
  tone: vec4f,
}
@group(0) @binding(2) var<uniform> f: Fog;
const NEAR = ${NEAR}.0;
const FAR = ${FAR}.0;
// Survey cells are 10 cm. The eye stands at 87 m and downtown's footings sit
// about 2 km out, so the bank tops out between 70 and 125 m to wrap the towers.
const LOW = 700.0;
const HIGH = 1250.0;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
fn hash(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let t = fract(p);
  let u = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash(i), hash(i + vec2i(1, 0)), u.x), mix(hash(i + vec2i(0, 1)), hash(i + vec2i(1, 1)), u.x), u.y);
}
// Banks roll in from the Pacific, so the pattern drifts east and slightly south.
fn cover(xz: vec2f) -> f32 {
  let p = xz / 7200.0;
  let wind = vec2f(0.016, 0.004) * f.time;
  let warp = noise(p * 0.7 - wind * 0.6 + vec2f(3.1, 7.7));
  var c = noise(p - wind + warp * 0.9) * 0.62;
  c += noise(p * 2.3 - wind * 1.7 + vec2f(9.2, 1.3)) * 0.38;
  return c;
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / f.size * 2.0 - 1.0;
  let rd = normalize(f.ray + f.tanHalf * (f.right * uv.x * f.aspect - f.up * uv.y));
  // Only a raised bank (a mood) is above the eye, so only then do rising rays cross it.
  if (rd.y > -0.0005 && f.mood <= 0.0) { return vec4f(0.0); }
  let z = textureLoad(depth, vec2i(at.xy), 0);
  var reach = 60000.0;
  if (z < 1.0) {
    let ahead = NEAR / max(1.0 - z * (FAR - NEAR) / FAR, 1e-6);
    reach = min(reach, ahead / max(dot(rd, f.forward), 1e-3));
  }
  // Under a mood (mood.js) the bank rises 60 m, comes in to 120 m from the eye,
  // fills its gaps and takes the mood's tone (pale grey-green in the Matrix). At mood 0 every term is the ordinary bank.
  let lift = 600.0 * f.mood;
  var enter = 0.0;
  if (rd.y < -0.0005) { enter = max(0.0, (HIGH + lift - f.eye.y) / rd.y); }
  else if (rd.y > 0.0005) { reach = min(reach, max(0.0, (HIGH + lift - f.eye.y) / rd.y)); }
  if (enter >= reach) { return vec4f(0.0); }
  // Keep the near roofs and both signs clear. The bank begins past the park slope.
  let near = mix(4200.0, 1200.0, f.mood);
  let start = max(enter, near);
  if (start >= reach) { return vec4f(0.0); }
  let n = i32(f.steps);
  let dt = (reach - start) / f32(n);
  let jitter = hash(vec2i(at.xy));
  let night = 1.0 - g.day;
  let dayTone = mix(vec3f(0.80, 0.83, 0.87), vec3f(0.98, 0.86, 0.76), g.low * 0.6);
  var col = vec3f(0.0);
  var clear = 1.0;
  for (var k = 0; k < n; k++) {
    let t = start + (f32(k) + jitter) * dt;
    let q = f.eye + rd * t;
    let c = cover(q.xz);
    let top = mix(LOW, HIGH, smoothstep(0.3, 0.75, c)) + lift;
    let body = (1.0 - smoothstep(top - 420.0 - lift, top, q.y)) * mix(smoothstep(0.26, 0.5, c), 0.55 + 0.45 * smoothstep(0.1, 0.5, c), f.mood);
    let fade = smoothstep(near, mix(10000.0, 5200.0, f.mood), t);
    let thick = body * fade * f.strength;
    if (thick <= 0.0) { continue; }
    let a = 1.0 - exp(-thick * dt / 3400.0);
    // Daylight catches the top of the bank; at night the city lights it from below.
    let crest = smoothstep(top - 520.0, top, q.y);
    let day = dayTone * mix(0.78, 1.04, crest);
    let glow = mix(vec3f(0.07, 0.085, 0.13), vec3f(0.36, 0.23, 0.14), g.weather.z * (1.0 - crest) * 0.75);
    col += clear * a * mix(mix(day, glow, night), f.tone.rgb * mix(0.8, 1.05, crest), f.mood);
    clear *= 1.0 - a;
    if (clear < 0.04) { break; }
  }
  let alpha = (1.0 - clear) * 0.86;
  return vec4f(col * 0.86, alpha);
}`;

export async function fogPass(device, format, global) {
  const module = device.createShaderModule({ label: "Marine layer", code });
  const pipeline = await device.createRenderPipelineAsync({
    label: "Marine layer",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "zero", dstFactor: "one" },
          },
        },
      ],
    },
  });
  const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(28);
  let bound, bind;
  return function draw(encoder, screen, depth, frame, size, time, strength, steps, mood = 0, tone = [0.3, 0.37, 0.33]) {
    if (strength <= 0 || !steps) return;
    if (bound !== depth) {
      bound = depth;
      bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: global } },
          { binding: 1, resource: depth.createView() },
          { binding: 2, resource: { buffer: uniforms } },
        ],
      });
    }
    data.set([...frame.eye, frame.tanHalf, ...frame.skyRight, size[0] / size[1], ...frame.skyUp, time]);
    data.set([...frame.skyForward, strength, ...frame.forward, steps, size[0], size[1], mood, 0, ...tone, 1], 12);
    device.queue.writeBuffer(uniforms, 0, data);
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: "load", storeOp: "store" }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  };
}
