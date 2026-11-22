import { globals } from "./shaders.js";
import { atlasSize, areas } from "./sign-paint.js";
import { dot, project } from "./survey.js";

const corners = [0, 1, 2, 0, 2, 3];
const uv = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
function normal([a, b, , d]) {
  const u = d.map((v, i) => v - a[i]),
    v = b.map((x, i) => x - a[i]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n);
  return n.map((x) => x / length);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const shader =
  globals +
  `
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var paint: texture_2d<f32>;
@group(0) @binding(2) var smoothPaint: sampler;
struct Camera {
  eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32,
  up: vec3f, near: f32, forward: vec3f, far: f32
}
@group(0) @binding(3) var<uniform> v: Camera;
// Mains for the Blog marquee, the Voxelmorphism lightbox and the park directory.
@group(0) @binding(5) var<uniform> mains: vec4f;
struct Out {
  @builtin(position) clip: vec4f, @location(0) rgb: vec3f, @location(1) uv:vec2f,
  @location(2) normal:vec3f, @location(3) glow:f32, @location(4) power:f32
}
@vertex fn vs(@location(0) point:vec3f,@location(1) colour:vec3f,@location(2) uv:vec2f,
              @location(3) n:vec3f,@location(4) glow:f32,@location(5) fixture:f32) -> Out {
  let rel=point-v.eye;
  let d=dot(rel,v.forward);
  var o:Out;
  o.clip=vec4f(dot(rel,v.right)/(v.tanHalf*v.aspect),dot(rel,v.up)/v.tanHalf,
               v.far/(v.far-v.near)*(d-v.near),d);
  o.rgb=colour; o.uv=uv; o.normal=n; o.glow=glow; o.power=mains[min(u32(fixture),3u)];
  return o;
}
@fragment fn fs(vtx:Out)->@location(0) vec4f {
  let texel=textureSample(paint,smoothPaint,vtx.uv).rgb;
  let printed=vtx.uv.x>=0.0;
  let pigment=select(vtx.rgb,texel,printed);
  let direct=max(dot(vtx.normal,g.sun),0.0);
  let lit=mix(0.28,0.85,g.day)+direct*(0.10+g.day*0.15);
  let lightbox=select(vtx.glow,0.62,printed)*vtx.power;
  let radiance=pigment*(lit+lightbox*(1.0-g.day)*0.98);
  return vec4f(radiance,1.0);
}`;

// Add the halos after the cached city colour copy. Their depth test uses the
// same, still-populated depth buffer as the aircraft. A chase never rebakes SF.
const marquee = `
struct Clock { seconds: f32, boot: f32 }
@group(0) @binding(4) var<uniform> clock:Clock;
struct Bulb {
  @builtin(position) clip:vec4f, @location(0) uv:vec2f, @location(1) power:f32
}
@vertex fn bulb(@builtin(vertex_index) i:u32,@location(0) lamp:vec4f,@location(1) energy:vec2f)->Bulb {
  let uv=vec2f(f32(i&1u),f32(i>>1u))*2.0-1.0;
  let rel=lamp.xyz-v.eye;
  let d=dot(rel,v.forward);
  let xy=vec2f(dot(rel,v.right),dot(rel,v.up))+uv*lamp.w;
  var o:Bulb;
  o.clip=vec4f(xy/(v.tanHalf*vec2f(v.aspect,1)),v.far/(v.far-v.near)*(d-v.near),d);
  o.uv=uv;
  let sweep=0.5+0.5*cos(clock.seconds*2.0-energy.y);
  // On arrival the bulbs strike one after another along the marquee, each with
  // a short stutter, before the usual chase takes over.
  let strike=0.42+energy.y*0.16;
  let since=clock.boot-strike;
  let stutter=select(1.0,0.35+0.65*step(0.5,fract(sin(energy.y*91.7+floor(clock.boot*30.0))*43758.5)),since<0.18);
  o.power=energy.x*mix(0.87,0.22,g.day)*(0.50+0.50*sweep*sweep)*step(0.0,since)*stutter;
  return o;
}
@fragment fn halo(in:Bulb)->@location(0) vec4f {
  let r=dot(in.uv,in.uv);
  let glow=max(0.0,exp(-4.5*r)-0.011)+0.7*exp(-42.0*r);
  return vec4f(vec3f(1.0,0.60,0.24)*in.power*glow,0.0);
}`;

// Geometry is relative to the very same block origin and uses the city pass's
// view buffer, depth attachment, bloom and antialiasing.
export async function signPass(device, format, global, view, anchor, scene) {
  const module = device.createShaderModule({ label: "Rooftop signs", code: shader + marquee });
  const pipeline = await device.createRenderPipelineAsync({
    label: "Surveyed sign fixtures",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 52,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x2" },
            { shaderLocation: 3, offset: 32, format: "float32x3" },
            { shaderLocation: 4, offset: 44, format: "float32" },
            { shaderLocation: 5, offset: 48, format: "float32" },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
    depthStencil: { format: "depth24plus", depthCompare: "less-equal", depthWriteEnabled: true },
  });
  const lights = await device.createRenderPipelineAsync({
    label: "Marquee bulbs",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "bulb",
      buffers: [
        {
          arrayStride: 24,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "halo",
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
  const seconds = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM });
  const mains = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM });
  device.queue.writeBuffer(mains, 0, new Float32Array([1, 1, 1, 1]));
  const lampBind = device.createBindGroup({
    layout: lights.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: global } },
      { binding: 3, resource: { buffer: view } },
      { binding: 4, resource: { buffer: seconds } },
    ],
  });
  const paint = device.createTexture({
    size: atlasSize,
    format: "rgba8unorm",
    mipLevelCount: 4,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const sampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    maxAnisotropy: 4,
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: global } },
      { binding: 1, resource: paint.createView() },
      { binding: 2, resource: sampler },
      { binding: 3, resource: { buffer: view } },
      { binding: 5, resource: { buffer: mains } },
    ],
  });
  const mips = [scene.atlas];
  for (let level = 1; level < 4; level++) {
    const c = document.createElement("canvas");
    c.width = atlasSize[0] >> level;
    c.height = atlasSize[1] >> level;
    mips.push(c);
  }
  let revision = -1,
    buffer,
    bulbs,
    count;
  // Fixture 1 is the marquee, 2 the lightbox and 3 the directory; slot 0 is unused.
  function power(blog, voxel, station) {
    device.queue.writeBuffer(mains, 0, new Float32Array([1, blog, voxel, station]));
  }
  function solids(pass) {
    if (revision !== scene.revision) {
      revision = scene.revision;
      mips.forEach((c, level) => {
        if (level) c.getContext("2d").drawImage(mips[level - 1], 0, 0, c.width, c.height);
        device.queue.copyExternalImageToTexture({ source: c }, { texture: paint, mipLevel: level }, [
          c.width,
          c.height,
        ]);
      });
      count = scene.faces.length * 6;
      const data = new Float32Array(count * 13);
      let at = 0;
      for (const face of scene.faces) {
        const n = normal(face.points),
          colour = rgb(face.colour),
          rect = areas[face.area];
        for (const i of corners) {
          const tex = rect
            ? uv[i].map((t, k) => (rect[k] + 0.5 + t * (rect[k + 2] - 1)) / atlasSize[k])
            : [-1, -1];
          data.set([...face.points[i].map((v, k) => v - anchor[k]), ...colour, ...tex, ...n, face.emit, face.fixture], at);
          at += 13;
        }
      }
      buffer = upload(buffer, data);
      const lampVertices = new Float32Array(
        scene.lamps.flatMap((lamp, i) => [
          ...lamp.at.map((v, k) => v - anchor[k]),
          lamp.radius,
          lamp.gain,
          i * 0.105,
        ]),
      );
      bulbs = upload(bulbs, lampVertices);
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.setVertexBuffer(0, buffer);
    pass.draw(count);
  }
  function upload(previous, data) {
    if (!previous || previous.size < data.byteLength) {
      previous?.destroy();
      previous = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(previous, 0, data);
    return previous;
  }
  function glow(encoder, screen, depth, time, boot = 1e3) {
    device.queue.writeBuffer(seconds, 0, new Float32Array([time, boot]));
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: screen, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: depth, depthReadOnly: true },
    });
    pass.setPipeline(lights);
    pass.setBindGroup(0, lampBind);
    pass.setVertexBuffer(0, bulbs);
    pass.draw(4, scene.lamps.length);
    pass.end();
  }
  return { solids, glow, power };
}

// The still view draws only the small fixtures. Its backdrop is the published
// render from the survey camera, so it works without a device or city download.
export function drawStill(canvas, scene, frame, w, h, sun) {
  const ratio = Math.min(devicePixelRatio, 2);
  const width = Math.round(w * ratio),
    height = Math.round(h * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const c = canvas.getContext("2d");
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, w, h);
  const sorted = [];
  for (const face of scene.faces) {
    const n = normal(face.points);
    if (
      dot(
        n,
        frame.eye.map((v, i) => v - face.points[0][i]),
      ) <= 0
    )
      continue;
    const p = face.points.map((point) => project(point, frame, w, h));
    if (
      p.some((v) => v[2] <= 0) ||
      p.every((v) => v[0] < 0) ||
      p.every((v) => v[0] > w) ||
      p.every((v) => v[1] < 0) ||
      p.every((v) => v[1] > h)
    )
      continue;
    sorted.push({ face, p, n, depth: p.reduce((s, v) => s + v[2], 0) / 4 });
  }
  sorted.sort(
    (a, b) =>
      a.face.fixture - b.face.fixture || Number(!!a.face.area) - Number(!!b.face.area) || b.depth - a.depth,
  );
  for (const { face, p, n } of sorted) {
    if (face.area) {
      const [x, y, tw, th] = areas[face.area];
      // Subdivide along the oblique roofline to preserve perspective in the lettering.
      const mix = (a, b, t) =>
        a.map((v, i) => (v * a[2] * (1 - t) + b[i] * b[2] * t) / (a[2] * (1 - t) + b[2] * t));
      for (let i = 0; i < 12; i++) {
        const a = mix(p[0], p[1], i / 12),
          b = mix(p[0], p[1], (i + 1) / 12),
          d = mix(p[3], p[2], i / 12);
        c.save();
        c.transform(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1], a[0], a[1]);
        c.drawImage(scene.atlas, x + (i * tw) / 12, y, tw / 12, th, 0, 0, 1.012, 1);
        c.restore();
      }
    } else {
      const shade = 0.83 + 0.19 * Math.max(0, dot(n, sun));
      const colour = rgb(face.colour).map((v) => Math.min(255, Math.round(v * shade * 255)));
      c.fillStyle = "rgb(" + colour.join(",") + ")";
      c.beginPath();
      p.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    }
  }
}
