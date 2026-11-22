// A turn of the weather over the park for an egg on the window screen. 'mood' runs
// from 0 (the ordinary sky) to 1, and a palette says what 1 looks like: how much of an
// overcast deck closes over the sky, how flat the sun goes, whether the city's lamps
// stay lit, the marine layer's thickness and tone, and a final grade over the whole
// view (a tint, saturation, a vignette and faint scan lines). Every palette reduces
// to the ordinary scene at 0.
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// The Matrix: a green overcast night, the city's lights out.
export const MOOD = {
  zenith: [0.006, 0.014, 0.01],
  horizon: [0.03, 0.055, 0.042],
  fill: [0.05, 0.075, 0.06],
  clouds: [0.22, 0.3, 0.25],
  sun: 0.1, // What is left of direct sunlight under the deck.
  day: 0.25, // What is left of daylight in the sky, fog and fixtures.
  deck: 1, // How much of the overcast deck replaces the sky.
  lamps: 0, // How much of the city's lamps and lit windows stay on.
  fog: 1.4, // The marine layer's thickness, as a multiple (fog.js also lifts it).
  tone: [0.3, 0.37, 0.33], // The marine layer's colour under the mood.
  tint: [0.62, 1.0, 0.68], // The final multiply over the whole view.
  saturation: 1, // 0 is black and white.
  vignette: 0.9,
  scan: 0, // Scan lines, as how much every other row darkens.
};
export const PALETTES = {
  matrix: MOOD,
  // Bad Apple!!: shadow art. A black, starless overcast night in black and white,
  // the marine layer a pale grey wall, and only the windows lit, in white.
  apple: {
    zenith: [0.002, 0.002, 0.002],
    horizon: [0.01, 0.01, 0.01],
    fill: [0.012, 0.012, 0.012],
    clouds: [0.06, 0.06, 0.06],
    sun: 0,
    day: 0.04,
    deck: 1,
    lamps: 0,
    fog: 1.25,
    tone: [0.16, 0.16, 0.16],
    tint: [0.94, 0.94, 0.94],
    saturation: 0,
    vignette: 1.1,
    scan: 0,
  },
  // Never Gonna Give You Up: a 1987 dusk. A magenta horizon under a violet sky with a
  // thin high deck, the marine layer thinned to a rose stage haze so the windows stay
  // legible, half the city's lamps left on, a warm tint and the faint lines of a tape.
  rick: {
    zenith: [0.02, 0.014, 0.06],
    horizon: [0.3, 0.11, 0.24],
    fill: [0.12, 0.08, 0.16],
    clouds: [0.42, 0.22, 0.4],
    sun: 0.25,
    day: 0.3,
    deck: 0.3,
    lamps: 0.5,
    fog: 0.75,
    tone: [0.42, 0.26, 0.46],
    tint: [1.0, 0.88, 0.97],
    saturation: 1.12,
    vignette: 0.75,
    scan: 0.06,
  },
};
// Seconds to roll in and to clear.
export const ROLL_IN = 2.6;
export const CLEAR = 1.4;

// The Globals block as place.js fills it, adjusted for a mood. 'u' is changed in
// place. Offsets follow the struct in shaders.js.
export function moody(u, m, p = MOOD) {
  if (m <= 0) return u;
  const day = u[15] * (1 - (1 - p.day) * m);
  u[15] = day;
  u.set(mix(u.subarray(24, 27), [...u.subarray(24, 27)].map((v) => v * p.sun), m), 24);
  u[27] = day;
  u.set(mix(u.subarray(28, 31), p.fill, m), 28);
  u[31] = day * 0.88 + 0.12;
  u.set(mix(u.subarray(32, 35), p.zenith, m), 32);
  u.set(mix(u.subarray(36, 39), p.horizon, m), 36);
  u.set(mix(u.subarray(40, 43), p.horizon, m), 40);
  u.set(mix(u.subarray(44, 47), p.clouds, m), 44);
  u.set(mix(u.subarray(48, 51), p.clouds, m), 48);
  u[52] = m * p.deck; // weather.x: the overcast deck in the sky shader.
  u[54] *= 1 - m * (1 - p.lamps); // weather.z: the city's lamps and lit windows.
  return u;
}
// How lit the city's lamps stay under a mood.
export const lampsUnder = (m, p = MOOD) => 1 - m * (1 - p.lamps);
// The marine layer's thickness under a mood.
export const fogUnder = (m, p = MOOD) => 1 + (p.fog - 1) * m;

// The sky shader's last line, so the deck replaces the whole sky (sun, moon glow,
// stars and the high clouds) as the mood rolls in.
const END = "  return col;\n}";
export function moodSky(code) {
  const at = code.lastIndexOf(END);
  if (at < 0 || !code.includes("fn sky(rd: vec3f)")) throw Error("The sky shader's ending moved");
  return (
    code.slice(0, at) +
    "  if (g.weather.x > 0.0) { col = mix(col, overcast(rd), g.weather.x); }\n" +
    code.slice(at) +
    `
// A low deck about 600 m up, lit faintly from below, drifting in from the Pacific.
fn overcast(rd: vec3f) -> vec3f {
  var col = mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(clamp(rd.y, 0.0, 1.0), 0.5));
  if (rd.y > 0.0) {
    let far = (6000.0 - g.eye.y) / max(rd.y, 0.015);
    let at = (g.eye.xz + rd.xz * far) / 5200.0 + vec2f(g.time * 0.006, g.time * 0.0015);
    let deck = cloud(at) * 0.65 + cloud(at * 2.7 + vec2f(5.2, 1.3)) * 0.35;
    col *= mix(0.45, 1.7, smoothstep(0.3, 0.72, deck)) * mix(1.0, 0.8, smoothstep(0.0, 0.5, rd.y));
  }
  return col;
}`
  );
}

// The grade. A palette in full colour is a multiply over everything drawn, with a
// soft vignette: two triangles' worth of fill and no texture reads. A palette that
// changes saturation or draws scan lines reads a copy of the view instead.
const fullscreen = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const grade = `
struct Grade { tint: vec4f, size: vec2f, vignette: f32, saturation: f32, scan: f32, pad: f32, pad2: vec2f }
@group(0) @binding(0) var<uniform> u: Grade;
${fullscreen}
fn shade(p: vec2f) -> vec3f {
  let d = p / u.size - 0.5;
  let lines = 1.0 - u.scan * f32(u32(p.y) % 3u == 0u);
  return u.tint.rgb * (1.0 - dot(d, d) * u.vignette) * lines;
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(shade(p.xy), 1.0);
}`;
const regrade = grade + `
@group(0) @binding(1) var view: texture_2d<f32>;
@fragment fn read(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = textureLoad(view, vec2i(p.xy), 0).rgb;
  let grey = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  return vec4f(max(mix(vec3f(grey), c, u.saturation), vec3f(0.0)) * shade(p.xy), 1.0);
}`;
// Whether a palette's grade needs to read the view.
export const reads = (p) => p.saturation !== 1 || p.scan > 0;

export async function gradePass(device, format) {
  const module = device.createShaderModule({ label: "Mood grade", code: grade });
  const readModule = device.createShaderModule({ label: "Mood grade", code: regrade });
  const [pipeline, reader] = await Promise.all([
    device.createRenderPipelineAsync({
      label: "Mood grade",
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format, blend: { color: { srcFactor: "dst", dstFactor: "zero" }, alpha: { srcFactor: "zero", dstFactor: "one" } } }],
      },
    }),
    device.createRenderPipelineAsync({
      label: "Mood grade",
      layout: "auto",
      vertex: { module: readModule, entryPoint: "vs" },
      fragment: { module: readModule, entryPoint: "read", targets: [{ format }] },
    }),
  ]);
  const uniforms = device.createBuffer({ label: "Mood grade", size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] });
  let copy, readBind;
  return function draw(encoder, screen, size, m, p = MOOD) {
    if (m <= 0) {
      copy = copy?.destroy();
      return;
    }
    const read = reads(p);
    device.queue.writeBuffer(uniforms, 0, new Float32Array([
      ...mix([1, 1, 1], p.tint, m), 1, size[0], size[1], p.vignette * m, 1 + (p.saturation - 1) * m, p.scan * m, 0, 0, 0,
    ]));
    if (read) {
      if (!copy || copy.width !== size[0] || copy.height !== size[1]) {
        copy?.destroy();
        copy = device.createTexture({ label: "Mood grade copy", size, format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
        readBind = device.createBindGroup({
          layout: reader.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: copy.createView() }],
        });
      }
      encoder.copyTextureToTexture({ texture: screen.texture }, { texture: copy }, size);
    }
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen.view, loadOp: "load", storeOp: "store" }] });
    pass.setPipeline(read ? reader : pipeline);
    pass.setBindGroup(0, read ? readBind : bind);
    pass.draw(3);
    pass.end();
  };
}
