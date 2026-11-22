// Aviation obstruction lights on the tallest roofs, found in the decoded city
// itself rather than from remembered landmark positions. Their halos are drawn
// after the cached city copy and depth-test against it, like the marquee bulbs.
import { globals } from "./shaders.js";

const TALL = (140 - 1) * 10; // Survey cells for 140 m over NAVD88.
const SPACING = 300; // Merge roof pieces within 30 m into one beacon.
const MOST = 14;
const REACH = 60000; // Towers within 6 km. The East Bay hills are terrain, not roofs.

// Faces are five little-endian words. Top faces (axis 0) carry the roof height.
export function findBeacons(faces, index) {
  const words = new Uint32Array(faces.buffer, faces.byteOffset, faces.byteLength / 4);
  const turn = (index.turn * Math.PI) / 180;
  const tops = new Map();
  const eye = index.camera.at.map((v) => v * 10);
  let first = 0;
  index.blocks.forEach((b, nth) => {
    const c0 = b.c0 ?? [Math.cos(turn), 0, -Math.sin(turn)],
      c2 = b.c2 ?? [Math.sin(turn), 0, Math.cos(turn)];
    for (let i = first; i < first + b.faces; i++) {
      const w0 = words[i * 5],
        w1 = words[i * 5 + 1],
        w2 = words[i * 5 + 2];
      if (((w2 >> 10) & 3) !== 0) continue;
      const x = (w0 & 0x7ff) + (w0 >>> 22) / 2,
        z = ((w0 >> 11) & 0x7ff) + (w2 & 0x3ff) / 2;
      // The same transform as the city vertex shader, at the middle of the roof face.
      const y = b.pos[1] + (c0[1] * x + c2[1] * z) * b.cell + (w1 >>> 16);
      if (y < TALL) continue;
      const at = [b.pos[0] + (c0[0] * x + c2[0] * z) * b.cell, y, b.pos[2] + (c0[2] * x + c2[2] * z) * b.cell];
      if (Math.hypot(at[0] - eye[0], at[2] - eye[2]) > REACH) continue;
      const id = nth + ":" + words[i * 5 + 4];
      if ((tops.get(id)?.[1] ?? -Infinity) < at[1]) tops.set(id, at);
    }
    first += b.faces;
  });
  const chosen = [];
  for (const top of [...tops.values()].sort((a, b) => b[1] - a[1])) {
    if (chosen.some((c) => Math.hypot(c[0] - top[0], c[2] - top[2]) < SPACING)) continue;
    chosen.push(top);
    if (chosen.length === MOST) break;
  }
  // Lift each lamp half a metre off its roof so the roof never hides it.
  return chosen.map(([x, y, z]) => [x, y + 5, z]);
}

const code =
  globals +
  `
@group(0) @binding(0) var<uniform> g: Globals;
struct Camera {
  eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32,
  up: vec3f, near: f32, forward: vec3f, far: f32
}
@group(0) @binding(1) var<uniform> v: Camera;
struct Clock { time: f32, power: f32, size: vec2f }
@group(0) @binding(2) var<uniform> k: Clock;
struct Lamp { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) power: f32 }
@vertex fn vs(@builtin(vertex_index) i: u32, @location(0) at: vec4f) -> Lamp {
  let uv = vec2f(f32(i & 1u), f32(i >> 1u)) * 2.0 - 1.0;
  let rel = at.xyz - v.eye;
  let d = dot(rel, v.forward);
  // A constant on-screen size keeps a lamp 3 km out legible without a giant halo nearby.
  let radius = max(k.size.y * 0.011, 5.0);
  var o: Lamp;
  o.clip = vec4f(
    dot(rel, v.right) / (v.tanHalf * v.aspect) + uv.x * radius * 2.0 / k.size.x * d,
    dot(rel, v.up) / v.tanHalf + uv.y * radius * 2.0 / k.size.y * d,
    v.far / (v.far - v.near) * (d - v.near), d);
  o.uv = uv;
  // FAA red flashers pulse together, about thirty times a minute.
  let phase = fract(k.time * 0.5);
  let flash = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.22, 0.5, phase));
  o.power = k.power * (flash + 0.05) * mix(1.0, 0.32, g.day);
  return o;
}
@fragment fn fs(in: Lamp) -> @location(0) vec4f {
  let r = dot(in.uv, in.uv);
  let core = exp(-30.0 * r);
  let halo = max(exp(-5.0 * r) - 0.007, 0.0) * 0.55;
  return vec4f(vec3f(1.0, 0.13, 0.07) * (halo + core) * in.power + vec3f(1.0, 0.75, 0.6) * core * in.power * 0.7, 0.0);
}`;

export async function beaconPass(device, format, global, view, anchor, lamps) {
  const module = device.createShaderModule({ label: "Tower beacons", code });
  const pipeline = await device.createRenderPipelineAsync({
    label: "Tower beacons",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [{ arrayStride: 16, stepMode: "instance", attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
    },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one" },
            alpha: { srcFactor: "zero", dstFactor: "one" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
    depthStencil: { format: "depth24plus", depthCompare: "less-equal", depthWriteEnabled: false },
  });
  const points = new Float32Array(lamps.flatMap((p, i) => [...p.map((v, k) => v - anchor[k]), i]));
  const buffer = device.createBuffer({
    size: Math.max(16, points.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, points);
  const clock = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: global } },
      { binding: 1, resource: { buffer: view } },
      { binding: 2, resource: { buffer: clock } },
    ],
  });
  return function draw(encoder, screen, depth, size, time, power) {
    if (!lamps.length || power <= 0) return;
    device.queue.writeBuffer(clock, 0, new Float32Array([time, power, size[0], size[1]]));
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: screen, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: depth, depthReadOnly: true },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, buffer);
    pass.draw(4, lamps.length);
    pass.end();
  };
}
