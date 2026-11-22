// The Ina matte pass and its cached city view. The plane shares its depth buffer.
import { globals, light, air, hash, cloud, city } from "./shaders.js";
import { glow } from "./glow.js";
import { surveyCamera, project } from "./survey.js";
import { signPass } from "./sign-renderer.js";
import { fogPass } from "./fog.js";
import { findBeacons, beaconPass } from "./beacons.js";
import { lifePass, gulls, windowsShader, windowClock } from "./life.js";
import { screenShader, screenPass, PANES } from "./screen.js";
import { moody, moodSky, gradePass, lampsUnder, fogUnder, MOOD, PALETTES, ROLL_IN, CLEAR } from "./mood.js";
import { pacing } from "./pacing.js";
import { smooth } from "./smooth.js";
import { plane, clock, LEVELS, PRESETS, fitted, kept, keep, sound } from "./sky.js";

const vertex = `
@vertex fn horizon(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
 let uv = vec2f(f32((i<<1u)&2u),f32(i&2u));
 return vec4f(uv*2.0-1.0,0.0,1.0);
}
@fragment fn atmosphere(@builtin(position) p:vec4f) -> @location(0) vec4f {
 let uv = p.xy / dims * 2.0 - 1.0;
 let rd = normalize(g.forward + g.tanHalf*(g.right*uv.x*g.aspect-g.up*uv.y));
 var col = sky(rd);
 // The disc is drawn into the sky pass, behind the city and the tow plane.
 let offset = (p.xy / dims - vec2f(0.70, 0.14)) * vec2f(g.aspect, 1);
 let radius = g.pad0;
 if (g.day < 1.0 && length(offset) < radius) {
   let disc = 1.0 - smoothstep(radius - 1.0 / dims.y, radius, length(offset));
   let maria = smoothstep(0.05, 0.65, noise2(offset / radius * 3.0));
   col += vec3f(1.6, 1.7, 1.9) * (0.62 + 0.38 * maria) * disc * (1.0 - g.day) * (1.0 - g.weather.x);
 }
 if (rd.y < -0.015) {
   col = mix(col,vec3f(0.12,0.34,0.48)*(g.day*0.9+0.1),smoothstep(0.015,0.06,-rd.y));
 }
 return vec4f(tone(col),1);
}`;
const FOG_STEPS = { low: 0, medium: 6, high: 9, ultra: 12 };
// The first visit of a session switches the fixtures on. Times are seconds after
// the first live frame; a lamp stutters for a moment as it strikes.
const ARRIVAL = 2.4;
const strike = (t, at, stutter = 0.16) =>
  t < at ? 0 : t > at + stutter ? 1 : Math.sin(t * 157) > -0.2 ? 1 : 0.25;
function mainsAt(t) {
  // The lightbox's tubes catch twice before they hold.
  const tube = t < 1.55 ? 0 : t < 1.6 ? 1 : t < 1.74 ? 0.12 : t < 1.79 ? 0.9 : t < 1.86 ? 0.3 : 1;
  return [ease(0.42, 1.5, t) * strike(t, 0.42, 0.3), tube, strike(t, 0.12)];
}
const entries = (buffers) => buffers.map((buffer, binding) => ({ binding, resource: { buffer } }));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const radians = (degrees) => (degrees * Math.PI) / 180;
const ease = (lo, hi, v) => {
  const x = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
};

async function readModel(index, signal) {
  const response = await fetch("/landing/ina.faces.gz", { signal });
  if (!response.ok) throw Error("City unavailable");
  const packed = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const bytes = new Uint8Array(packed),
    faces = new Uint8Array(bytes.length);
  if (index.faces * 20 !== bytes.length) throw Error("Incomplete city");
  for (let j = 0; j < 20; j++)
    for (let i = 0; i < index.faces; i++) faces[i * 20 + j] = bytes[j * index.faces + i];
  return faces;
}

export async function place(canvas, device, night, signal, index, signs, arrive = false) {
  const buffer = (size, usage = GPUBufferUsage.UNIFORM) =>
    device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
  const context = canvas.getContext("webgpu"),
    format = navigator.gpu.getPreferredCanvasFormat();
  const skyShader = device.createShaderModule({
    code:
      globals +
      "\n@group(0) @binding(0) var<uniform> g:Globals; @group(0) @binding(1) var<uniform> dims:vec2f;\n" +
      [light, air, hash, moodSky(cloud), vertex].join("\n"),
  });
  const cityShader = device.createShaderModule({
    code: globals + "\n" + screenShader(windowsShader(city)).replace("struct Out", light + "\n" + air + "\nstruct Out"),
  });
  // One layout for the city and its window map, so both draw with the same binds.
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const uniformsAt = (n) => device.createBindGroupLayout({ entries: Array.from({ length: n }, (_, binding) => ({ binding, visibility: VF, buffer: {} })) });
  const cityLayout = device.createPipelineLayout({ bindGroupLayouts: [uniformsAt(3), uniformsAt(1)] });
  const cityVertex = {
    module: cityShader,
    entryPoint: "vs",
    buffers: [
      {
        arrayStride: 20,
        stepMode: "instance",
        attributes: Array.from({ length: 5 }, (_, i) => ({ shaderLocation: i, offset: i * 4, format: "uint32" })),
      },
    ],
  };
  const global = buffer(224),
    dims = buffer(16),
    view = buffer(96),
    styles = buffer(512);
  const [faces, backdrop, buildings, aircraft, finish, antialias, drawSigns, drawFog, stockLife, windowScreen, drawGrade] = await Promise.all([
    readModel(index, signal),
    device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: skyShader, entryPoint: "horizon" },
      fragment: { module: skyShader, entryPoint: "atmosphere", targets: [{ format }] },
    }),
    device.createRenderPipelineAsync({
      layout: cityLayout,
      vertex: cityVertex,
      fragment: { module: cityShader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-strip" },
      depthStencil: { format: "depth24plus", depthCompare: "less", depthWriteEnabled: true },
    }),
    plane(
      device,
      format,
      { globals: global },
      { span: 500, letter: 94, speed: 190, reach: 14000 },
      { text: "Hello, San Francisco", font: "/vendor/village/kit/fonts/vox-text/vox-text-700-normal.woff2" },
      false,
    ),
    glow({ device, format }),
    smooth({ device, format }),
    signPass(device, format, global, view, index.blocks[0].pos, signs),
    fogPass(device, format, global),
    lifePass(device, format, global, view),
    screenPass(device, format),
    gradePass(device, format),
  ]);
  // The window map's pipeline compiles the first time something is shown.
  let mapper = null;
  const windowMap = () =>
    (mapper ??= device
      .createRenderPipelineAsync({
        label: "Window map",
        layout: cityLayout,
        vertex: cityVertex,
        fragment: { module: cityShader, entryPoint: "panes", targets: [{ format: PANES }] },
        primitive: { topology: "triangle-strip" },
        depthStencil: { format: "depth24plus", depthCompare: "less-equal", depthWriteEnabled: false },
      })
      .then((pipeline) => {
        mapper = pipeline;
        dirty = true;
      }));
  const beacons = findBeacons(faces, index);
  const drawBeacons = await beaconPass(device, format, global, view, index.blocks[0].pos, beacons);
  const drawLife = stockLife(gulls(index, index.blocks[0].pos));
  const skyBind = device.createBindGroup({
    layout: backdrop.getBindGroupLayout(0),
    entries: entries([global, dims]),
  });
  const cityBind = device.createBindGroup({
    layout: buildings.getBindGroupLayout(0),
    entries: entries([view, global, styles]),
  });
  const geometry = buffer(faces.length, GPUBufferUsage.VERTEX);
  device.queue.writeBuffer(geometry, 0, faces);
  const windows = new Float32Array(128);
  index.styles.forEach((s, i) =>
    windows.set([s.storey, s.bay, s.wide, s.tall, ...s.glass.map((c) => (c / 255) ** 2.2), 0], i * 8),
  );
  device.queue.writeBuffer(styles, 0, windows);

  const turn = radians(index.turn),
    anchor = index.blocks[0].pos;
  let first = 0;
  const blocks = index.blocks.map((b) => {
    const own = buffer(64),
      data = new Float32Array(16);
    data.set(b.pos.map((v, i) => v - anchor[i]));
    data[3] = b.cell;
    data.set(b.uw ?? [0, 0], 5);
    data.set(b.c0 ?? [Math.cos(turn), 0, -Math.sin(turn)], 8);
    data.set(b.c2 ?? [Math.sin(turn), 0, Math.cos(turn)], 12);
    device.queue.writeBuffer(own, 0, data);
    const start = first;
    first += b.faces;
    return {
      start,
      count: b.faces,
      bind: device.createBindGroup({ layout: buildings.getBindGroupLayout(1), entries: entries([own]) }),
    };
  });

  const home = surveyCamera(index),
    distance = 18000;
  const mid = home.eye.map((v, i) => v + home.forward[i] * distance + home.up[i] * distance * 0.145);
  aircraft.over(mid, [home.forward[0], home.forward[2]]);
  aircraft.put(-0.43);
  const saved = kept();
  let chosen = Object.keys(saved).length > 0;
  const settings = { ...fitted(), ...saved };
  const cadence = pacing(settings, () => !chosen && settings.preset !== "low");
  let signRevision = -1;
  let dirty = true,
    hour = 0,
    bg,
    raw,
    source,
    filtered,
    filteredSource,
    depth,
    frame = home,
    travel = 0,
    seconds = 0,
    moonlit = false,
    rollProgress = 1,
    moonRadius = 0.017,
    // Seconds since the first live frame. The marine layer rolls in and the
    // beacons come on after it, so nothing pops over the matching still.
    boot = 0,
    // Arrival seconds for the fixtures. A return visit starts with them lit.
    strikeAt = arrive && settings.preset !== "low" ? 0 : 1e3,
    dusk = true,
    mains = "",
    // The windows' clock as last baked into the city.
    windowsAt = 0,
    // The weather's mood (0 ordinary, 1 the palette in full) and where it is going.
    // A new palette waits for the old one to clear.
    mood = 0,
    moodTo = 0,
    palette = MOOD,
    paletteTo = MOOD,
    // The window map, at the city's size, while something is or was just showing.
    panes,
    // Whether the last frame moved the paused clock.
    running = true,
    // Whether the tow plane's start has been checked against the view.
    placed = false;
  // What the windows show: a program, its own clock and how strongly it shows.
  const showing = { program: null, clock: 0, strength: 0 };
  // A head's lean around the park directory, driven by the pointer through a
  // critically damped spring. It rebakes the city only while it is moving.
  const head = { side: 0, rise: 0, vs: 0, vr: 0, to: [0, 0], moving: false };
  function sway(dt) {
    if (!head.moving || !dt) return;
    const k = 34,
      c = 2 * Math.sqrt(k);
    const [ts, tr] = settings.preset === "low" ? [0, 0] : head.to;
    const was = [head.side, head.rise];
    head.vs += (-k * (head.side - ts) - c * head.vs) * dt;
    head.vr += (-k * (head.rise - tr) - c * head.vr) * dt;
    head.side += head.vs * dt;
    head.rise += head.vr * dt;
    if (Math.hypot(head.side - ts, head.rise - tr) < 0.0008 && Math.hypot(head.vs, head.vr) < 0.004) {
      head.side = ts;
      head.rise = tr;
      head.vs = head.vr = 0;
      head.moving = false;
    }
    if (head.side !== was[0] || head.rise !== was[1]) dirty = true;
  }
  const time = clock(
    {
      light: { day: 1, lights: 0 },
      hour(value) {
        hour = value;
        dirty = true;
      },
    },
    { day: 15.625, night: 22 },
    night ? "night" : "day",
    false,
  );
  function draw(dt, moving) {
    if (moving) seconds += dt;
    running = moving;
    // The mood rolls on real time, so it settles under Pause too; home.js keeps
    // frames coming while it changes. The sky and light are baked, so it rebakes.
    const target = paletteTo === palette ? moodTo : 0;
    if (mood !== target) {
      mood = target > mood ? Math.min(target, mood + dt / ROLL_IN) : Math.max(target, mood - dt / CLEAR);
      dirty = true;
    }
    if (!mood && paletteTo !== palette) palette = paletteTo;
    const m = ease(0, 1, mood);
    const ready = mapper instanceof GPURenderPipeline;
    if (showing.program && !ready) windowMap();
    const wasShown = showing.strength > 0;
    showing.strength = showing.program && ready ? Math.min(1, showing.strength + dt / 0.6) : Math.max(0, showing.strength - dt / 0.5);
    if (moving && showing.program) showing.clock += dt;
    if (!showing.strength && wasShown && !showing.program) panes = panes?.destroy();
    const screenOn = ready && (!!showing.program || showing.strength > 0);
    boot += dt;
    strikeAt += dt;
    if (dusk && strikeAt < ARRIVAL + 0.1) dirty = true;
    sway(dt);
    time.step(dt);
    // Lit windows change on whole steps of the paused clock, after dusk only.
    const alive = settings.preset !== "low";
    const windows = alive ? windowClock(seconds) : 0;
    if (windows !== windowsAt && (dusk || !windows)) dirty = true;
    // The cached city costs one colour copy at rest (after dusk it also rebakes once a
    // second for the windows; see life.js). The animated sky component
    // depth-tests against the same buildings, so the banner disappears behind towers.
    if (moving) {
      aircraft.step(dt);
      rollProgress = Math.min(1, rollProgress + dt / 0.85);
    }
    signs.size(canvas.clientWidth, canvas.clientHeight);
    if (signRevision !== signs.revision) {
      signRevision = signs.revision;
      dirty = true;
    }
    const level = LEVELS[settings.preset];
    const pixelRatio = Math.min(
      Math.min(devicePixelRatio || 1, 2) * cadence.scale * level.over,
      device.limits.maxTextureDimension2D / Math.max(canvas.clientWidth, canvas.clientHeight),
    );
    const size = [
      Math.max(1, Math.round(canvas.clientWidth * pixelRatio)),
      Math.max(1, Math.round(canvas.clientHeight * pixelRatio)),
    ];
    if (!bg || size[0] !== canvas.width || size[1] !== canvas.height) {
      [canvas.width, canvas.height] = size;
      context.configure({
        device,
        format,
        // COPY_SRC lets a mood that changes saturation read the view (mood.js).
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        alphaMode: "opaque",
      });
      bg?.destroy();
      raw?.destroy();
      depth?.destroy();
      panes = panes?.destroy();
      filtered?.destroy();
      filtered = null;
      bg = device.createTexture({
        size,
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      raw = device.createTexture({
        size,
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      source = { size, color: raw.createView() };
      depth = device.createTexture({
        size,
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      device.queue.writeBuffer(dims, 0, new Float32Array(size));
      dirty = true;
    }
    if (screenOn && !panes) {
      panes = device.createTexture({ label: "Window map", size, format: PANES, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      dirty = true;
    }
    const aspect = size[0] / size[1],
      encoder = device.createCommandEncoder(),
      screen = context.getCurrentTexture();
    if (dirty) {
      frame = signs.camera(travel, head.side, head.rise);
      // A narrow view (a phone) would first see the tow banner minutes in: it starts
      // mostly beyond the left edge. Start it where tuning puts it, in view. Wide views,
      // which see it from the start, keep theirs.
      if (!placed) {
        placed = true;
        const ends = [aircraft.cloth.from, aircraft.cloth.to].map((p) => project(p, frame, size[0], size[1]));
        const [left, right] = [Math.min(ends[0][0], ends[1][0]), Math.max(ends[0][0], ends[1][0])];
        const shown = Math.min(right, size[0]) - Math.max(left, 0);
        if (ends.some(([, , z]) => z <= 0) || shown < (right - left) * 0.5) aircraft.put(-0.1);
      }
      const angle = ((hour - 6) * Math.PI) / 12,
        altitude = Math.sin(angle) * 0.9;
      const day = ease(-0.1, 0.12, altitude),
        low = 1 - ease(0.03, 0.5, altitude),
        lamps = 1 - ease(0.55, 0.95, day);
      moonlit = day < 0.5;
      // Emission only reads after dusk, so a daylight arrival never rebakes for it.
      dusk = day <= 0.999;
      const power = dusk ? mainsAt(strikeAt) : [1, 1, 1];
      if (power.join() !== mains) {
        mains = power.join();
        drawSigns.power(...power);
      }
      const sun =
        day === 0
          ? [0.45, 0.7, -0.55]
          : mix(index.sun.vector, [Math.cos(angle) * 0.8, Math.max(0.06, altitude), 0.6 * Math.cos(angle)], low);
      const zenith = mix([0.005, 0.012, 0.038], mix(index.sky.zenith, [0.18, 0.15, 0.42], low), day);
      const horizon = mix([0.033, 0.052, 0.11], mix(index.sky.horizon, [1.1, 0.51, 0.33], low), day);
      const uniforms = new Float32Array([
        ...frame.eye,
        frame.tanHalf,
        ...frame.skyRight,
        aspect,
        ...frame.skyUp,
        seconds,
        ...frame.skyForward,
        day,
        ...sun,
        low,
        0,
        moonRadius,
        windows,
        0,
        ...mix([0.045, 0.062, 0.11], mix([0.8, 0.74, 0.64], [0.65, 0.3, 0.16], low), day),
        day,
        ...mix([0.035, 0.05, 0.1], [0.19, 0.28, 0.5], day),
        day * 0.88 + 0.12,
        ...zenith,
        0.42,
        ...horizon,
        low * day,
        ...horizon,
        sun[0],
        ...mix([0.055, 0.075, 0.12], [1, 1, 1], day),
        sun[2],
        ...mix([0.08, 0.09, 0.14], [1, 0.9, 0.8], day),
        30,
        0,
        0,
        lamps,
        0,
      ]);
      device.queue.writeBuffer(global, 0, moody(uniforms, m, palette));
      device.queue.writeBuffer(
        view,
        0,
        new Float32Array([
          ...frame.eye.map((v, i) => v - anchor[i]),
          frame.tanHalf,
          ...frame.right,
          aspect,
          ...frame.up,
          80,
          ...frame.forward,
          100000,
          ...sun,
          0,
          index.light.fill,
          index.light.gain,
          Number(settings.preset !== "low"),
          Number(level.mirrors),
        ]),
      );
      const color = { view: source.color, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] };
      const skyPass = encoder.beginRenderPass({ colorAttachments: [color] });
      skyPass.setPipeline(backdrop);
      skyPass.setBindGroup(0, skyBind);
      skyPass.draw(3);
      skyPass.end();
      const cityPass = encoder.beginRenderPass({
        colorAttachments: [{ ...color, loadOp: "load" }],
        depthStencilAttachment: {
          view: depth.createView(),
          depthLoadOp: "clear",
          depthStoreOp: "store",
          depthClearValue: 1,
        },
      });
      cityPass.setPipeline(buildings);
      cityPass.setBindGroup(0, cityBind);
      cityPass.setVertexBuffer(0, geometry);
      for (const b of blocks) {
        cityPass.setBindGroup(1, b.bind);
        cityPass.draw(4, b.count, 0, b.start);
      }
      drawSigns.solids(cityPass);
      cityPass.end();
      // The window map: the city again, depth-tested against itself and the signs.
      if (screenOn && panes) {
        const mapPass = encoder.beginRenderPass({
          colorAttachments: [{ view: panes.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
          depthStencilAttachment: { view: depth.createView(), depthReadOnly: true },
        });
        mapPass.setPipeline(mapper);
        mapPass.setBindGroup(0, cityBind);
        mapPass.setVertexBuffer(0, geometry);
        for (const b of blocks) {
          mapPass.setBindGroup(1, b.bind);
          mapPass.draw(4, b.count, 0, b.start);
        }
        mapPass.end();
      }
      if (level.smooth) {
        if (!filtered) {
          filtered = device.createTexture({ size, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
          filteredSource = { size, color: filtered.createView() };
        }
        antialias(encoder, source, filteredSource);
      }
      windowsAt = windows;
      const glowing = lamps * lampsUnder(m, palette);
      finish(encoder, level.smooth ? filteredSource : source, bg.createView(), 0, seconds, [0.96, 0.13 + glowing * 0.08], glowing);
      dirty = false;
    }
    encoder.copyTextureToTexture({ texture: bg }, { texture: screen }, size);
    const colourView = screen.createView(), depthView = depth.createView();
    // The windows first, so the marine layer veils the far ones.
    if (screenOn && panes) {
      windowScreen.paint(showing.program ?? showing.last, showing.clock, size[0] / size[1]);
      windowScreen.draw(encoder, colourView, panes, showing.strength, (showing.program ?? showing.last).gain);
    }
    // Low has no marine layer, except a light one while a mood is up.
    const fogSteps = Math.max(FOG_STEPS[settings.preset], m > 0 ? 4 : 0);
    drawFog(encoder, colourView, depth, frame, size, seconds, ease(0.3, 3.5, boot) * fogUnder(m, palette), fogSteps, m, palette.tone);
    drawBeacons(encoder, colourView, depthView, size, seconds, ease(2.0, 2.4, boot));
    drawSigns.glow(encoder, colourView, depthView, seconds, strikeAt);
    aircraft.draw(encoder, { size, color: colourView, depth: depthView }, frame, seconds, 2 * Math.PI * ease(0, 1, rollProgress));
    // After the tow plane: the gulls are nearer than its banner and write no depth.
    // No fade-in: a fade would keep moving under Pause, which holds the gulls where they are.
    drawLife(encoder, colourView, depthView, size, seconds, Number(alive));
    drawGrade(encoder, { texture: screen, view: colourView }, size, m, palette);
    device.queue.submit([encoder.finish()]);
  }
  return {
    draw,
    time,
    home,
    get frame() {
      return frame;
    },
    flight(value) {
      travel = value;
      dirty = true;
    },
    // x and y run from -1 to 1 across the view. Up to 25 cm aside and 10 cm up.
    aim(x, y) {
      if (settings.preset === "low") x = y = 0;
      const to = [x * 0.25, -y * 0.1];
      if (to[0] === head.to[0] && to[1] === head.to[1]) return;
      head.to = to;
      head.moving = true;
    },
    get leaning() {
      return head.moving;
    },
    get arriving() {
      return strikeAt < ARRIVAL || boot < 3.5;
    },
    cadence,
    lowerQuality() {
      settings.preset = PRESETS[PRESETS.indexOf(settings.preset) - 1];
      cadence.configure(cadence.scale);
      dirty = true;
    },
    configure(change) {
      chosen = true;
      Object.assign(settings, sound(change));
      keep(settings);
      cadence.configure();
      dirty = true;
    },
    settings,
    roll() {
      aircraft.put(-0.1);
      rollProgress = 0;
    },
    get cloth() {
      return aircraft.cloth;
    },
    get moonlit() {
      return moonlit;
    },
    resizeMoon(radius) {
      moonRadius = radius;
      dirty = true;
    },
    banner(text) {
      aircraft.put(-0.10);
      return aircraft.carry({ text });
    },
    // Show a program on the city's windows (see screen.js), or null to fade it out.
    // Under Pause a moving program holds a frame a few seconds in, so it isn't blank.
    show(program) {
      if (program && program !== showing.program) showing.clock = running ? 0 : (program.still ?? 6);
      if (program) showing.last = program;
      showing.program = program;
    },
    get showing() {
      return showing.program;
    },
    // Roll the weather toward a mood from 0 (ordinary) to 1, in a palette from
    // mood.js, by name or in full (the last one asked for by default).
    mood(value, to = paletteTo) {
      moodTo = Math.max(0, Math.min(1, value));
      paletteTo = typeof to === "string" ? PALETTES[to] : to;
    },
    // True while the mood or the windows are still fading, so Pause keeps drawing.
    get changing() {
      const ready = mapper instanceof GPURenderPipeline;
      return mood !== moodTo || palette !== paletteTo || (!!showing.program && (!ready || showing.strength < 1)) || (!showing.program && showing.strength > 0);
    },
    // The red tower lights, in the pack's frame (decimetres), for hit tests.
    beacons,
  };
}
