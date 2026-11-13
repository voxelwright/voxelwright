// Water that flows (#140), as the core tells it (water.rs): how high its top stands over each column of a window
// of the world. It is not cells and is not marched: it is drawn as a surface over the marched picture and tested
// against its depth, as bodies and smoke are. Each wet column is a square of the surface, its corners at the mean
// of the wet columns that share them, so the water is one sheet, steep where it comes off an edge.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, time: f32, forward: vec3f, day: f32, sun: vec3f, col: f32,
  // Where the window's low corner is from the anchor the eye is measured from (its height is the base the tops are over).
  origin: vec3f, pad: f32,
  // The box round the wet columns: its low corner, how many across.
  box: vec4u,
  sky: vec3f, pad1: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var heights: texture_2d<u32>;
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) seen: vec3f,
  @location(1) plan: vec2f,
  // How deep, how fast.
  @location(2) more: vec2f,
}
const NEAR = 1.0;
const FAR = 100000.0;
fn word(c: vec2i) -> u32 {
  let size = vec2i(textureDimensions(heights));
  if (any(c < vec2i(0)) || any(c >= size)) { return 0u; }
  return textureLoad(heights, c, 0).r;
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let column = vec2i(i32(u.box.x + i % u.box.z), i32(u.box.y + i / u.box.z));
  let corner = vec2i(i32(v & 1u), i32((v >> 1u) & 1u));
  var out: Out;
  if ((word(column) >> 18u) == 0u) {
    // A dry column: nothing of it is drawn.
    out.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  // The corner's height, depth and speed: the mean of the wet columns round it.
  var top = 0.0; var deep = 0.0; var fast = 0.0; var n = 0.0; var dry = 0.0;
  for (var k = 0; k < 4; k++) {
    let w = word(column + corner - vec2i(k & 1, k >> 1u));
    if ((w >> 18u) == 0u) { dry += 1.0; continue; }
    top += f32(w & 0x3ffffu) / 8.0;
    deep += f32((w >> 18u) & 255u) / 16.0;
    fast += f32(w >> 26u) * 2.0;
    n += 1.0;
  }
  top /= n;
  // At the water's edge it thins to nothing.
  deep = deep / n * (1.0 - dry / 4.0);
  let at = vec2f(column + corner) * u.col;
  // Drawn a little over where it is: thin water an inch over a road would fight the road for each pixel.
  let world = u.origin + vec3f(at.x, top + 0.25, at.y) - u.eye;
  let d = dot(world, u.forward);
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.seen = world;
  out.plan = at;
  out.more = vec2f(deep, fast / n);
  return out;
}
fn lump(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise1(p: vec2f) -> f32 {
  let c = vec2i(floor(p));
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(lump(c), lump(c + vec2i(1, 0)), e.x), mix(lump(c + vec2i(0, 1)), lump(c + vec2i(1, 1)), e.x), e.y);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let deep = in.more.x;
  let fast = in.more.y;
  // Which way the surface faces, from how it lies in the picture; small waves ride on it, quicker where it runs.
  var n = normalize(cross(dpdx(in.seen), dpdy(in.seen)));
  if (n.y < 0.0) { n = -n; }
  let steep = 1.0 - n.y;
  let run = u.time * (1.0 + fast * 0.15);
  let ripple = vec2f(noise1(in.plan * 0.45 + vec2f(run, run * 0.6)), noise1(in.plan.yx * 0.5 - vec2f(run * 0.7, run))) - 0.5;
  n = normalize(n + vec3f(ripple.x, 0.0, ripple.y) * 0.35);
  let look = normalize(-in.seen);
  let facing = max(dot(n, look), 0.0);
  let fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  // Its own colour: thin water shows what is under it, deep water is green-blue.
  let lit = 0.3 + 0.7 * max(dot(n, u.sun), 0.0);
  var col = mix(vec3f(0.26, 0.58, 0.56), vec3f(0.05, 0.33, 0.37), clamp(deep / 5.0, 0.0, 1.0)) * lit;
  col = mix(col, u.sky, fresnel * 0.75);
  col += vec3f(1.0, 0.95, 0.85) * pow(max(dot(reflect(-look, n), u.sun), 0.0), 90.0) * 1.2;
  // Foam: where it runs fast, where it falls, and along its thin edge, broken up as foam is.
  let churn = clamp((fast - 3.0) / 9.0, 0.0, 1.4) + clamp(steep * 2.2 - 0.15, 0.0, 1.0) + 0.6 * (1.0 - smoothstep(0.1, 0.7, deep));
  let broken = noise1(in.plan * 0.9 - vec2f(run * 2.0, run * 1.3)) * 0.6 + noise1(in.plan * 2.3 + vec2f(run * 1.7, 0.0)) * 0.4;
  let foam = clamp(churn, 0.0, 1.0) * smoothstep(0.62 - 0.4 * clamp(churn, 0.0, 1.0), 0.75, broken + 0.25 * clamp(churn - 1.0, 0.0, 1.0));
  col = mix(col, vec3f(0.9, 0.94, 0.96) * (0.55 + 0.45 * lit), foam);
  col *= mix(0.1, 1.0, u.day);
  let cover = max(clamp(0.2 + deep * 0.16 + fresnel * 0.45, 0.0, 0.92), foam * 0.95) * smoothstep(0.0, 0.12, deep);
  return vec4f(col * cover, cover);
}
`

export interface Flowing {
  /** What the core told of the water (the words of a FLOW record). */
  set(words: Uint32Array<ArrayBuffer>): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number): void
  /** Where the light comes from, how much of the day it is, and the colour of the sky it mirrors (as the screen shows it). */
  light(sun: readonly number[], day: number): void
  /** How many columns the last word of it covered: for the checks. */
  readonly columns: number
}

export async function flowing(device: GPUDevice, format: GPUTextureFormat): Promise<Flowing> {
  const module = await shader(device, 'water', CODE)
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const pipeline = await device.createRenderPipelineAsync({
    label: 'water', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  let texture: GPUTexture | null = null, bind: GPUBindGroup | null = null, cells = new Uint32Array(0), side = 0
  // The window as last told: its low corner in the world, the base its tops are over, a column's width, the box of wet ones.
  let low = [0, 0], base = 0, col = 2, box = [0, 0, 0, 0], wet = 0
  let sun: readonly number[] = [0.52, 0.62, 0.59], day = 1
  return {
    get columns() { return wet },
    light(from, isDay) { sun = from; day = isDay },
    set(words) {
      const i32 = new Int32Array(words.buffer, words.byteOffset, words.length), n = words[3]
      if (n !== side) {
        texture?.destroy()
        side = n
        cells = new Uint32Array(n * n)
        texture = device.createTexture({ size: [n, n], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
        bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: texture.createView() }] })
      }
      // What was wet is dry unless told again.
      for (let z = box[1]; z < box[1] + box[3]; z++) cells.fill(0, box[0] + side * z, box[0] + box[2] + side * z)
      low = [i32[0], i32[1]]; col = words[2]; base = i32[4]
      box = [words[5], words[6], words[7], words[8]]
      wet = 0
      for (let z = 0; z < box[3]; z++) {
        const row = words.subarray(9 + z * box[2], 9 + (z + 1) * box[2])
        cells.set(row, box[0] + side * (box[1] + z))
        for (const w of row) if (w) wet++
      }
      device.queue.writeTexture({ texture: texture! }, cells, { bytesPerRow: side * 4 }, [side, side])
    },
    draw(encoder, to, view, time) {
      if (!wet || !bind) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const sunLength = Math.hypot(sun[0], sun[1], sun[2])
      const block = new ArrayBuffer(144), f = new Float32Array(block), u = new Uint32Array(block)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf], 0)
      f.set([...view.right, to.size[0] / to.size[1]], 4)
      f.set([...view.up, time], 8)
      f.set([...view.forward, day], 12)
      f.set([sun[0] / sunLength, sun[1] / sunLength, sun[2] / sunLength, col], 16)
      f.set([low[0] - anchor[0], base - anchor[1], low[1] - anchor[2], 0], 20)
      u.set(box, 24)
      // The sky it mirrors, as the screen shows it by day.
      f.set([0.6, 0.7, 0.82, 0], 28)
      device.queue.writeBuffer(uniforms, 0, block)
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.draw(4, box[2] * box[3])
      pass.end()
    },
  }
}
