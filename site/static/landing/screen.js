// The city's windows as one screen, seen from the park. Every glazed pane is a pixel:
// it shows the colour of a small picture at the spot where the pane's centre lands
// on the view. Anything that can fill a few thousand RGBA pixels at a time t can
// play on it: a test card, code rain, a still image, video frames or an equalizer.
//
// The cost follows the city's own cache. When the city rebakes, a second pass over
// the same geometry writes the window map: for each screen pixel on glass, the
// screen position of its pane's centre and how much of the pixel is glass. Each
// frame one full-screen pass reads that map and the picture. With nothing showing,
// neither pass runs and the city is exactly as it was.

// The window map holds the pane centre's view position (0 to 1, top left origin)
// in red and green and the pane's glass coverage in blue.
export const PANES = "rgba16float";

const POSITION = "@builtin(position) pos: vec4f,";
const FRAGMENT = "@fragment fn fs(in: Out)";
export function screenShader(code) {
  if (!code.includes(POSITION) || !code.includes(FRAGMENT)) throw Error("The city shader's output moved");
  // The map pass reruns the city's vertex shader against the city's depth, so both
  // must land on identical depths.
  return (
    code.replace(POSITION, "@builtin(position) @invariant pos: vec4f,") +
    `
// The window map. The pane test is the city fragment's own. A pane's centre is
// found in world space from the facade's axes: along a wall, 'along' grows by 0.1
// per unit on b.c2 (axis 1) or b.c0 (axis 2), and 'high' is the world height.
@fragment fn panes(in: Out) -> @location(0) vec4f {
  let st = styles.s[min(in.style, 15u)];
  let fx = in.along / max(st.size.y, 0.01);
  let fy = in.high * 0.1 / max(st.size.x, 0.01);
  let ax = max(fwidth(fx), 0.0001);
  let ay = max(fwidth(fy), 0.0001);
  var pane = within(fract(fx), 0.5 - st.size.z * 0.5, 0.5 + st.size.z * 0.5, ax) * within(fract(fy), 0.26, 0.26 + st.size.w, ay);
  pane = mix(pane, st.size.z * st.size.w, smoothstep(0.3, 0.8, max(ax, ay)));
  pane *= f32(in.style != 0u && in.style < 14u && in.way >= 2u);
  let along = select(b.c0, b.c2, in.way < 4u) * 10.0 * st.size.y;
  let centre = in.seen + along * (floor(fx) + 0.5 - fx) + vec3f(0.0, 10.0 * st.size.x, 0.0) * (floor(fy) + 0.26 + st.size.w * 0.5 - fy);
  let d = max(dot(centre, v.forward), 1.0);
  let at = vec2f(dot(centre, v.right) / (v.tanHalf * v.aspect), dot(centre, v.up) / v.tanHalf) / d;
  return vec4f(at.x * 0.5 + 0.5, 0.5 - at.y * 0.5, pane, 1.0);
}`
  );
}

const composite = `
@group(0) @binding(0) var panes: texture_2d<f32>;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;
struct Show { strength: f32, gain: f32, pad: vec2f }
@group(0) @binding(3) var<uniform> u: Show;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
// Premultiplied: the picture's alpha is how much of the pane's own look it covers,
// and its colour is the light the pane gives off. Colour above alpha glows.
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let m = textureLoad(panes, vec2i(p.xy), 0);
  let cover = m.b * u.strength;
  let c = textureSampleLevel(picture, smooth_, m.xy, 0.0);
  return vec4f(c.rgb * cover * u.gain, c.a * cover);
}`;

// A program fills RGBA bytes for a time in seconds. 'rows' sets the picture's
// height; its width follows the view's aspect so a pixel stays square on screen.
// Programs without 'moving' are drawn once, and 'gain' brightens what they emit.
// A moving program with its own clock gives 'key()', which changes when it has a
// new picture (video.js); the picture is drawn and uploaded only then.
export const ROWS = 90;
export function pictureSize(aspect, rows = ROWS) {
  return [Math.max(8, Math.min(512, Math.round(rows * aspect))), rows];
}

export async function screenPass(device, format) {
  const module = device.createShaderModule({ label: "Window screen", code: composite });
  const pipeline = await device.createRenderPipelineAsync({
    label: "Window screen",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format, blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "zero", dstFactor: "one" } } }],
    },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const uniforms = device.createBuffer({ label: "Window screen strength", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let picture, pixels, bind, boundMap, drawn;
  return {
    // Fill the picture for this time. Returns false while nothing needs uploading.
    paint(program, time, aspect) {
      const [w, h] = pictureSize(aspect, program.rows);
      if (!picture || picture.width !== w || picture.height !== h) {
        picture?.destroy();
        picture = device.createTexture({ label: "Window screen picture", size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        pixels = new Uint8ClampedArray(w * h * 4);
        bind = null;
        drawn = null;
      }
      // A program with its own clock (a video) says when it has a new frame.
      const key = program.moving ? (program.key ? program.key() : time) : 0;
      if (drawn?.program === program && drawn.key === key) return;
      drawn = { program, key };
      program.draw(pixels, w, h, time);
      device.queue.writeTexture({ texture: picture }, pixels, { bytesPerRow: w * 4 }, [w, h]);
    },
    draw(encoder, screen, map, strength, gain = 1) {
      if (strength <= 0 || !picture) return;
      if (!bind || boundMap !== map) {
        boundMap = map;
        bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: map.createView() },
            { binding: 1, resource: picture.createView() },
            { binding: 2, resource: sampler },
            { binding: 3, resource: { buffer: uniforms } },
          ],
        });
      }
      device.queue.writeBuffer(uniforms, 0, new Float32Array([strength, gain, 0, 0]));
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: screen, loadOp: "load", storeOp: "store" }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    },
  };
}

// A calibration card: a hue sweep across, brightness down, and a white grid every
// eight pixels. It shows what a picture looks like at the windows' real density.
export function testCard() {
  return {
    moving: false,
    draw(px, w, h) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const grid = x % 8 === 0 || y % 8 === 0;
          const hue = (x / w) * 6, k = 1 - y / h;
          const c = [Math.abs(hue - 3) - 1, 2 - Math.abs(hue - 2), 2 - Math.abs(hue - 4)].map((v) => Math.max(0, Math.min(1, v)) * k);
          px.set(grid ? [255, 255, 255, 255] : c.map((v) => v * 255).concat(255), i);
        }
    },
  };
}
