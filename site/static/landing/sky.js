import { globals as GLOBALS, light as LIGHT } from "./shaders.js";
const CODE = `struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, words: f32,
  origin: vec3f, wave: f32,
  along: vec3f, pad1: f32,
  side: vec3f, pad2: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var cloth: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;
${GLOBALS}
@group(1) @binding(0) var<uniform> g: Globals;
${LIGHT}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) n: vec3f,
  @location(2) seen: vec3f,
  @location(3) colour: vec3f,
  @location(4) @interpolate(flat) what: u32,
}
const NEAR = 80.0;
const FAR = 100000.0;
@vertex fn vs(@location(0) at: vec3f, @location(1) n: vec3f, @location(2) colour: vec3f, @location(3) uv: vec2f, @location(4) what: u32) -> Out {
  var p = at;
  var nn = n;
  if (what == 1u) {
    let far = uv.x;
    let phase = far * 9.0 - u.time * 2.6;
    p.z += u.wave * far * (sin(phase) + 0.4 * sin(phase * 2.3 + 1.0));
    p.y += u.wave * 0.25 * far * sin(phase * 0.7 + 2.0);
    nn = normalize(vec3f(-u.wave * far * 0.012 * cos(phase), 0.0, 1.0));
  }
  let spin = mat2x2f(cos(u.pad1), sin(u.pad1), -sin(u.pad1), cos(u.pad1));
  p = vec3f(p.x, spin * p.yz);
  nn = vec3f(nn.x, spin * nn.yz);
  let world = u.origin + u.along * p.x + vec3f(0.0, 1.0, 0.0) * p.y + u.side * p.z - u.eye;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = uv;
  out.n = u.along * nn.x + vec3f(0.0, 1.0, 0.0) * nn.y + u.side * nn.z;
  out.seen = world;
  out.colour = colour;
  out.what = what;
  return out;
}
@fragment fn fs(in: Out, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let dist = length(in.seen);
  let rd = in.seen / dist;
  var n = normalize(in.n);
  if (!front) { n = -n; }
  let dark = g.weather.z;
  var albedo = in.colour;
  var glow = vec3f(0.0);
  var cover = 1.0;
  let c = textureSample(cloth, smooth_, in.uv);
  if (in.what == 1u) {
    if (u.words > 0.5) {
      let ink = 1.0 - c.r;
      albedo = mix(vec3f(0.86, 0.86, 0.84), in.colour * vec3f(1.0, 1.0, 0.72), ink);
      glow = vec3f(1.0, 0.93, 0.0) * ink * 1.5 * dark;
    } else {
      albedo = pow(c.rgb, vec3f(2.2));
      glow = albedo * 0.9 * dark;
    }
  } else if (in.what == 2u) {
    let on = select(1.0, step(0.9, fract(u.time * in.uv.x + 0.3)), in.uv.x > 0.0);
    glow = in.colour * 5.0 * dark * on;
    albedo = in.colour * 0.3;
  } else if (in.what == 3u) {
    cover = 0.28;
  }
  let direct = max(dot(n, g.sun), 0.0);
  var col = shade(albedo, n, rd, g.sun, direct, 1.0, 0.7, 0.0) + glow;
  let haze = 1.0 - exp(-dist * 0.00003 * exp(-max(g.eye.y - g.sea, 0.0) / 12000.0));
  col = mix(col, g.skyHorizon.rgb * 1.5, haze * select(0.8, 0.35, in.what == 1u));
  return vec4f(tone(col) * cover, cover);
}`;
async function plane(device, format, march, flight, banner, still) {
  const module = await device.createShaderModule({ code: CODE }), pipeline = await device.createRenderPipelineAsync({
    label: "plane",
    layout: "auto",
    vertex: { module, entryPoint: "vs", buffers: [{ arrayStride: 48, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }, { shaderLocation: 2, offset: 24, format: "float32x3" }, { shaderLocation: 3, offset: 36, format: "float32x2" }, { shaderLocation: 4, offset: 44, format: "uint32" }] }] },
    // Premultiplied, as the stage's other passes blend (the picture's fourth number is the glow's, and stays 1 here).
    fragment: { module, entryPoint: "fs", targets: [{ format, blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: !1, depthCompare: "less" }
  }), k = flight.span / 10.7, YELLOW = [1, 0.92, 0], BLUE = [44e-4, 0.0156, 1], DARK = [0.02, 0.02, 0.03], GLASS = [0.05, 0.09, 0.2], STEEL = [0.35, 0.36, 0.38], data = [], whats = [], vertex = (p, n, c, uv, what) => {
    data.push(p[0] * k, p[1] * k, p[2] * k, n[0], n[1], n[2], c[0], c[1], c[2], uv[0], uv[1]), whats.push(what);
  }, quad = (a, b, c, d, n, colour, what = 0, uvs = [[0, 0], [0, 0], [0, 0], [0, 0]]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) vertex([a, b, c, d][i], n, colour, uvs[i], what);
  }, box = (x0, y0, z0, x1, y1, z1, colour, what = 0, uv = [0, 0]) => {
    const u4 = [uv, uv, uv, uv];
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], colour, what, u4), quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], colour, what, u4), quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], colour, what, u4), quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], colour, what, u4), quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], colour, what, u4), quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], colour, what, u4);
  };
  box(1.55, -0.38, -0.36, 2.25, 0.3, 0.36, BLUE), box(2.25, -0.16, -0.14, 2.42, 0.12, 0.14, DARK), box(0, -0.5, -0.42, 1.55, 0.52, 0.42, YELLOW), box(-1.3, -0.42, -0.34, 0, 0.4, 0.34, YELLOW), box(-2.6, -0.3, -0.24, -1.3, 0.3, 0.24, YELLOW), box(-3.9, -0.16, -0.14, -2.6, 0.22, 0.14, YELLOW), box(0.25, 0.08, -0.44, 1.35, 0.46, 0.44, GLASS), box(1.4, 0.1, -0.34, 1.58, 0.46, 0.34, GLASS), box(-3.6, -0.06, -0.26, 1.5, 0.04, 0.26, BLUE), box(-1.3, -0.06, -0.36, 1.5, 0.04, 0.36, BLUE), box(0, -0.06, -0.44, 1.5, 0.04, 0.44, BLUE), box(0.2, 0.52, -5.35, 1.65, 0.68, 5.35, YELLOW), box(0.2, 0.5, -5.36, 1.65, 0.7, -4.7, BLUE), box(0.2, 0.5, 4.7, 1.65, 0.7, 5.36, BLUE);
  for (const z of [-1, 1]) for (let s2 = 0; s2 < 6; s2++) box(0.75, -0.42 + s2 * 0.16, z * (0.45 + s2 * 0.4), 0.9, -0.3 + s2 * 0.16, z * (0.45 + s2 * 0.4) + z * 0.42, STEEL);
  box(-3.95, 0.02, -1.7, -3.05, 0.1, 1.7, YELLOW), box(-3.98, 0.1, -0.05, -3.1, 1.25, 0.05, YELLOW), box(-3.98, 0.85, -0.06, -3.3, 1.26, 0.06, BLUE);
  for (const z of [-1, 1])
    box(0.95, -1.25, z * 1 - 0.09, 1.45, -0.75, z * 1 + 0.09, DARK), box(1.12, -0.85, z * 0.72 - 0.05, 1.28, -0.45, z * 0.72 + 0.05, STEEL), box(1.12, -0.9, Math.min(z * 0.72, z * 1), 1.28, -0.8, Math.max(z * 0.72, z * 1), STEEL);
  box(-3.75, -0.42, -0.05, -3.55, -0.16, 0.05, DARK), quad([2.45, -1, -1], [2.45, -1, 1], [2.45, 1, 1], [2.45, 1, -1], [1, 0, 0], DARK, 3), box(0.7, 0.55, 5.34, 1, 0.72, 5.48, [1, 0.03, 0.02], 2), box(0.7, 0.55, -5.48, 1, 0.72, -5.34, [0.05, 1, 0.2], 2), box(-4.08, 0.2, -0.07, -3.94, 0.36, 0.07, [1, 1, 1], 2, [1.1, 0]);
  const planeVerts = whats.length, CAP = 0.56, LONGEST = 16, tall = flight.letter / CAP / k, LINE = 8, head = -4 - LINE;
  let shape = 6, buffer = null, count = 0;
  const build = () => {
    data.length = planeVerts * 11, whats.length = planeVerts;
    const wide = tall * shape;
    box(head - 0.12, -tall / 2 - 0.25, -0.08, head + 0.12, tall / 2 + 0.25, 0.08, DARK);
    for (const end of [-1, 1]) {
      const y1 = end * tall / 2, t = 0.05;
      quad([-4, 0, 0], [head, y1 - t, 0], [head, y1 + t, 0], [-4, 0.1, 0], [0, 0, 1], DARK, 4);
    }
    const strips = 40;
    for (let s2 = 0; s2 < strips; s2++) {
      const u0 = s2 / strips, u1 = (s2 + 1) / strips, x0 = head - u0 * wide, x1 = head - u1 * wide;
      quad([x0, -tall / 2, 0], [x1, -tall / 2, 0], [x1, tall / 2, 0], [x0, tall / 2, 0], [0, 0, 1], BLUE, 1, [[u0, 1], [u1, 1], [u1, 0], [u0, 0]]);
    }
    const bytes = new ArrayBuffer(whats.length * 48), f = new Float32Array(bytes), u32 = new Uint32Array(bytes);
    for (let i = 0; i < whats.length; i++)
      f.set(data.slice(i * 11, i * 11 + 11), i * 12), u32[i * 12 + 11] = whats[i];
    buffer?.destroy(), buffer = device.createBuffer({ size: bytes.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }), device.queue.writeBuffer(buffer, 0, bytes), count = whats.length;
  }, sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 4 }), uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), lit = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: march.globals } }] });
  let texture = null, bind = null, words = 1, carried = {}, face = null;
  const carry = async (next) => {
    let picture = null;
    next.image && (picture = await fetch(next.image).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    }).then((b) => createImageBitmap(b)).catch(() => null));
    const text = (next.text ?? "").toUpperCase().slice(0, 60);
    if (!picture && next.font && face === null) {
      face = "banner";
      try {
        const f = new FontFace("banner", `url(${new URL(next.font, location.href).href})`, { weight: "100 900" });
        await f.load(), document.fonts.add(f);
      } catch {
        face = "";
      }
    }
    const font = `800 ${Math.round(128 * CAP / 0.7)}px ${face ? "banner, " : ""}"Arial Black", "Helvetica Neue", Arial, sans-serif`, measure = new OffscreenCanvas(8, 8).getContext("2d");
    measure.font = font;
    const lettered = picture ? 0 : measure.measureText(text).width;
    shape = Math.max(2, Math.min(LONGEST, picture ? picture.width / picture.height : (lettered + 128 * 0.9) / 128));
    const W = Math.round(128 * shape), canvas = new OffscreenCanvas(W, 128), c = canvas.getContext("2d");
    if (picture) {
      const s2 = Math.max(W / picture.width, 128 / picture.height);
      c.drawImage(picture, (W - picture.width * s2) / 2, (128 - picture.height * s2) / 2, picture.width * s2, picture.height * s2);
    } else {
      c.fillStyle = "#fff", c.fillRect(0, 0, W, 128), c.fillStyle = "#000", c.fillRect(0, 0, W, 128 * 0.05), c.fillRect(0, 128 * 0.95, W, 128 * 0.05), c.fillRect(W - 128 * 0.05, 0, 128 * 0.05, 128), c.fillRect(0, 0, 128 * 0.05, 128), c.font = font, c.textBaseline = "alphabetic", c.textAlign = "center";
      const room = W - 128 * 0.9;
      c.save(), c.translate(W / 2, 128 * (0.5 + CAP / 2)), c.scale(Math.min(1, room / lettered), 1), c.fillText(text, 0, 0), c.restore();
    }
    const levels = Math.floor(Math.log2(Math.max(W, 128))) + 1, made = device.createTexture({ size: [W, 128], format: "rgba8unorm", mipLevelCount: levels, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    for (let level = 0; level < levels; level++) {
      const w = Math.max(1, W >> level), h = Math.max(1, 128 >> level), small = new OffscreenCanvas(w, h), sc = small.getContext("2d");
      sc.imageSmoothingEnabled = !0, sc.imageSmoothingQuality = "high", sc.drawImage(canvas, 0, 0, w, h), device.queue.copyExternalImageToTexture({ source: small }, { texture: made, mipLevel: level }, [w, h]);
    }
    texture?.destroy(), texture = made, words = picture ? 0 : 1, carried = next, bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler }] }), build();
  };
  await carry(banner);
  let right = [1, 0, 0], along = [-1, 0, 0], side = [0, 0, 1], mid = null, s = still ? -0.12 * flight.reach : flight.reach * 0.55;
  const place = () => {
    const m = mid ?? [0, 0, 0];
    return [m[0] + right[0] * s, m[1], m[2] + right[2] * s];
  }, block = new Float32Array(28);
  return {
    draw(encoder, to, v, time, roll = 0) {
      if (!bind || !buffer || !mid) return;
      const at = place();
      block.set([...v.eye, v.tanHalf, ...v.right, to.size[0] / to.size[1], ...v.up, still ? 0 : time, ...v.forward, words, ...at, still ? 0 : tall * k * 0.035, ...along, roll, ...side, 0]), device.queue.writeBuffer(uniforms, 0, block);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: "load", storeOp: "store" }], depthStencilAttachment: { view: to.depth, depthLoadOp: "load", depthStoreOp: "store" } });
      pass.setPipeline(pipeline), pass.setBindGroup(0, bind), pass.setBindGroup(1, lit), pass.setVertexBuffer(0, buffer), pass.draw(count), pass.end();
    },
    step(dt) {
      still || (s -= flight.speed * dt, s < -flight.reach - (LINE + 4 + tall * shape) * k && (s = flight.reach));
    },
    carry,
    put(to) {
      s = to * flight.reach;
    },
    over(m, toward) {
      const l = Math.hypot(toward[0], toward[1]) || 1, t = [toward[0] / l, 0, toward[1] / l];
      right = [-t[2], 0, t[0]], along = [-right[0], 0, -right[2]], side = [-t[0], 0, -t[2]], mid = [m[0], m[1], m[2]];
    },
    get at() {
      return place();
    },
    get along() {
      return s / flight.reach;
    },
    get carries() {
      return carried;
    },
    get cloth() {
      const at = place(), x0 = head * k, x1 = (head - tall * shape) * k, h = tall * k / 2;
      return { from: [at[0] + along[0] * x0, at[1] + h, at[2] + along[2] * x0], to: [at[0] + along[0] * x1, at[1] - h, at[2] + along[2] * x1] };
    }
  };
}
const FAST = 5.5, SLOW = 0.24, DUSK = 17.9, DAWN = 6.1, WIDE = 0.5, EASE = 6;
function clock(on, hours, begin, calm, fixed) {
  let where = begin, hour = fixed ?? hours[begin], goal = hour, speed = 0, moving = !1;
  const told = () => ({ hour: (hour % 24 + 24) % 24, night: 1 - on.light.day, lights: on.light.lights, moving, to: where });
  on.hour(hour);
  const self = {
    to(next, instant = !1) {
      if (!(next === where && !instant)) {
        for (where = next, goal = hours[next] + 24 * Math.floor(hour / 24); goal < hour + 1e-3; ) goal += 24;
        if (instant || calm) {
          hour = goal, speed = 0, moving = !1, on.turning = !1, on.hour(hour), self.changed?.(told());
          return;
        }
        moving = !0, on.turning = !0;
      }
    },
    step(dt) {
      if (!moving) return !1;
      const left = goal - hour, slow = (h) => {
        const m = (h % 24 + 24) % 24;
        return Math.max(Math.exp(-(((m - DUSK) / WIDE) ** 2)), Math.exp(-(((m - DAWN) / WIDE) ** 2)));
      }, dusk = left < 12.5 ? Math.max(slow(hour), slow(hour + speed * 0.33)) : 0, wanted = Math.min(FAST + (SLOW - FAST) * dusk, left * 2.4 + 0.12);
      return speed += (wanted - speed) * (1 - Math.exp(-dt * EASE)), hour = Math.min(goal, hour + speed * dt), goal - hour < 4e-3 && (hour = goal, speed = 0, moving = !1, on.turning = !1), on.hour(hour), self.changed?.(told()), moving;
    },
    get told() {
      return told();
    },
    changed: null
  };
  return self;
}
const PRESETS = ["low", "medium", "high", "ultra"], TARGETS = [30, 60, 120], SCALE = { least: 0.3, most: 1 }, LEVELS = {
  low: { shadows: !0, corners: !1, mirrors: !1, smooth: !1, over: 1, detail: 2 },
  medium: { shadows: !0, corners: !0, mirrors: !1, smooth: !0, over: 1, detail: 1.5 },
  high: { shadows: !0, corners: !0, mirrors: !0, smooth: !0, over: 1, detail: 1 },
  ultra: { shadows: !0, corners: !0, mirrors: !0, smooth: !0, over: 1.4, detail: 1 }
}, KEY = "village.graphics", whole = (v) => typeof v == "object" && v !== null;
function sound(from) {
  if (!whole(from)) return {};
  const out = {};
  return PRESETS.includes(from.preset) && (out.preset = from.preset), typeof from.scale == "number" && Number.isFinite(from.scale) && (out.scale = Math.round(Math.max(SCALE.least, Math.min(SCALE.most, from.scale)) * 20) / 20), typeof from.dynamic == "boolean" && (out.dynamic = from.dynamic), TARGETS.includes(from.target) && (out.target = from.target), out;
}
function fitted() {
  return { preset: (navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches) && Math.min(screen.width, screen.height) < 820 ? "medium" : "high", scale: 1, dynamic: !0, target: 60 };
}
function kept() {
  try {
    return sound(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return {};
  }
}
function keep(chosen) {
  try {
    localStorage.setItem(KEY, JSON.stringify(chosen));
  } catch {
  }
}
function forget() {
  try {
    localStorage.removeItem(KEY);
  } catch {
  }
}
export {
  LEVELS,
  PRESETS,
  SCALE,
  TARGETS,
  clock,
  fitted,
  forget,
  keep,
  kept,
  plane,
  sound
};
