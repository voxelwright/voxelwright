// Rays: what drawing a city by marching through its cells costs (#140). A made-up town in a
// box of 256 x 96 x 256 cells, held as two textures: every cell's kind, and one number for
// each block of 8 x 8 x 8 cells that says whether anything is in it. A ray crosses an empty
// block in one step and a full one cell by cell. Each pixel sends one ray, and with `shadow`
// a second from what it hit towards the sun.
import { SHADE, camera, chance, shader, type Camera, type Draw, type Gpu, type Offscreen } from './gpu.ts'

const NX = 256, NY = 96, NZ = 256, BLOCK = 8

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, shadow: f32,
  forward: vec3f, count: f32,
  res: vec2f, pad: vec2f,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var cells: texture_3d<u32>;
@group(0) @binding(2) var blocks: texture_3d<u32>;
${SHADE}
const SIZE = vec3f(${NX}.0, ${NY}.0, ${NZ}.0);
const LAST = vec3i(${NX - 1}, ${NY - 1}, ${NZ - 1});
struct Hit { t: f32, kind: u32, n: vec3f, steps: u32 }

fn march(ro: vec3f, rd: vec3f, most: u32) -> Hit {
  var hit = Hit(-1.0, 0u, vec3f(0.0), 0u);
  let inv = 1.0 / rd;
  let t0 = (vec3f(0.0) - ro) * inv;
  let t1 = (SIZE - ro) * inv;
  let lo = min(t0, t1);
  let hi = max(t0, t1);
  let enter = max(max(lo.x, lo.y), max(lo.z, 0.0));
  let leave = min(hi.x, min(hi.y, hi.z));
  if (enter >= leave) { return hit; }
  let ahead = max(sign(rd), vec3f(0.0));
  var n = -sign(rd) * vec3f(lo >= vec3f(enter));
  var t = enter + 0.001;
  for (var i = 0u; i < most; i++) {
    if (t >= leave) { break; }
    let c = clamp(vec3i(floor(ro + rd * t)), vec3i(0), LAST);
    hit.steps = i + 1u;
    let b = c >> vec3u(3u);
    var edge = 1.0;
    var low = vec3f(c);
    if (textureLoad(blocks, b, 0).r == 0u) {
      edge = ${BLOCK}.0;
      low = vec3f(b << vec3u(3u));
    } else {
      let kind = textureLoad(cells, c, 0).r;
      if (kind != 0u) { hit.t = t; hit.kind = kind; hit.n = normalize(n); return hit; }
    }
    let out = (low + ahead * edge - ro) * inv;
    let next = min(out.x, min(out.y, out.z));
    n = -sign(rd) * vec3f(out <= vec3f(next));
    t = next + 0.001;
  }
  return hit;
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  var rd = normalize(u.forward + u.right * (uv.x * u.tanHalf * u.aspect) - u.up * (uv.y * u.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  let hit = march(u.eye, rd, 512u);
  var steps = hit.steps;
  var col = sky(rd);
  if (hit.t >= 0.0) {
    let p = u.eye + rd * hit.t;
    let cell = floor(p - hit.n * 0.5);
    var paint = vec3f(0.36, 0.5, 0.3);
    if (hit.kind == 2u) { paint = vec3f(0.3, 0.3, 0.32); }
    if (hit.kind == 3u) { paint = vec3f(0.55, 0.7, 0.85); }
    if (hit.kind >= 4u) { paint = 0.45 + 0.4 * vec3f(hash3(vec3f(f32(hit.kind), 1.0, 2.0)), hash3(vec3f(f32(hit.kind), 5.0, 3.0)), hash3(vec3f(f32(hit.kind), 9.0, 4.0))); }
    var light = 1.0;
    if (u.shadow > 0.5 && dot(hit.n, SUN) > 0.0) {
      let s = march(p + hit.n * 0.01, SUN, 256u);
      steps += s.steps;
      if (s.t >= 0.0) { light = 0.0; }
    }
    col = lit(paint, cell, hit.n, rd, light, hit.t);
  }
  if (u.count > 0.5) { return vec4f(f32(steps & 255u) / 255.0, f32(steps >> 8u) / 255.0, 0.0, 1.0); }
  return vec4f(tone(col), 1.0);
}
`

/** The town as cells, x + NX * (y + NY * z), and which blocks of 8 hold anything. */
function town(): { cells: Uint8Array<ArrayBuffer>; blocks: Uint8Array<ArrayBuffer> } {
  const cells = new Uint8Array(NX * NY * NZ), bx = NX / BLOCK, by = NY / BLOCK, bz = NZ / BLOCK, blocks = new Uint8Array(bx * by * bz)
  const LOT = 40
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const ground = 3 + Math.round(1.5 + 1.5 * Math.sin(x * 0.03) * Math.cos(z * 0.04))
    const lx = Math.floor(x / LOT), lz = Math.floor(z / LOT), ix = x - lx * LOT, iz = z - lz * LOT
    const built = ix >= 6 && ix < 34 && iz >= 6 && iz < 34 && chance(lx, lz, 1) >= 0.2
    const top = built ? ground + 12 + Math.floor(68 * chance(lx, lz, 2) ** 2) : ground
    const wall = 4 + Math.floor(chance(lx, lz, 3) * 12)
    for (let y = 0; y < Math.min(NY, top); y++) {
      let kind = y < ground ? (built ? 4 : ix < 6 || ix >= 34 || iz < 6 || iz >= 34 ? 2 : 1) : wall
      // Panes on the faces of a house: two cells in every four, each way.
      if (y >= ground + 2 && (y - ground) % 4 >= 2 && (ix === 6 || ix === 33 ? iz % 4 >= 2 : (iz === 6 || iz === 33) && ix % 4 >= 2)) kind = 3
      cells[x + NX * (y + NY * z)] = kind
      blocks[(x >> 3) + bx * ((y >> 3) + by * (z >> 3))] = 1
    }
  }
  return { cells, blocks }
}

export interface Rays {
  /** `view` is 'street' (between the houses) or 'hill' (above the edge, the whole town in view). */
  draw(view: 'street' | 'hill', shadow: boolean): Draw
  /** The mean number of steps a pixel's rays took, counted on a small picture. */
  steps(view: 'street' | 'hill', shadow: boolean): Promise<number>
}

export async function rays(gpu: Gpu): Promise<Rays> {
  const { device } = gpu
  const module = await shader(device, 'rays', CODE)
  const targets = (format: GPUTextureFormat) => ({ module, entryPoint: 'fs', targets: [{ format }] })
  const pipeline = await device.createRenderPipelineAsync({ label: 'rays', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: targets(gpu.format) })
  const counter = await device.createRenderPipelineAsync({ label: 'rays counted', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: targets('rgba8unorm') })
  const { cells, blocks } = town()
  const texture = (data: Uint8Array<ArrayBuffer>, size: [number, number, number]) => {
    const t = device.createTexture({ size, dimension: '3d', format: 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: t }, data, { bytesPerRow: size[0], rowsPerImage: size[1] }, size)
    return t.createView()
  }
  const cellsView = texture(cells, [NX, NY, NZ]), blocksView = texture(blocks, [NX / BLOCK, NY / BLOCK, NZ / BLOCK])
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bindFor = (p: GPURenderPipeline) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: cellsView }, { binding: 2, resource: blocksView }] })
  const bind = bindFor(pipeline), bindCounter = bindFor(counter)
  const views: Record<'street' | 'hill', Camera> = {
    street: camera([120.5, 14.5, 3.5], [121.5, 13, 200], 70),
    hill: camera([128, 150, -110], [128, 10, 140], 60),
  }
  const write = (view: 'street' | 'hill', shadow: boolean, count: boolean, size: readonly [number, number]) => {
    const c = views[view]
    device.queue.writeBuffer(uniforms, 0, new Float32Array([...c.eye, c.tanHalf, ...c.right, size[0] / size[1], ...c.up, shadow ? 1 : 0, ...c.forward, count ? 1 : 0, size[0], size[1], 0, 0]))
  }
  const run = (encoder: GPUCommandEncoder, p: GPURenderPipeline, b: GPUBindGroup, color: GPUTextureView, timing?: GPURenderPassTimestampWrites) => {
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], ...(timing ? { timestampWrites: timing } : {}) })
    pass.setPipeline(p)
    pass.setBindGroup(0, b)
    pass.draw(3)
    pass.end()
  }
  return {
    draw: (view, shadow) => (encoder, to, timing) => {
      write(view, shadow, false, to.size)
      run(encoder, pipeline, bind, to.color, timing)
    },
    async steps(view, shadow) {
      const size: [number, number] = [256, 144]
      const picture = device.createTexture({ size, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
      const read = device.createBuffer({ size: size[0] * size[1] * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const encoder = device.createCommandEncoder()
      write(view, shadow, true, size)
      run(encoder, counter, bindCounter, picture.createView())
      encoder.copyTextureToBuffer({ texture: picture }, { buffer: read, bytesPerRow: size[0] * 4 }, size)
      device.queue.submit([encoder.finish()])
      await read.mapAsync(GPUMapMode.READ)
      const bytes = new Uint8Array(read.getMappedRange())
      let sum = 0
      for (let i = 0; i < bytes.length; i += 4) sum += bytes[i] + bytes[i + 1] * 256
      read.unmap(); read.destroy(); picture.destroy()
      return sum / (size[0] * size[1])
    },
  }
}

/** A picture drawn at one size, shown at another: what a frame costs when it is marched small and stretched. */
export async function stretch(gpu: Gpu): Promise<(encoder: GPUCommandEncoder, from: Offscreen, to: GPUTextureView) => void> {
  const { device } = gpu
  const module = await shader(device, 'stretch', /* wgsl */ `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f { return textureSampleLevel(picture, smooth_, in.uv, 0.0); }
`)
  const pipeline = await device.createRenderPipelineAsync({ label: 'stretch', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format }] } })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const binds = new WeakMap<Offscreen, GPUBindGroup>()
  return (encoder, from, to) => {
    let bind = binds.get(from)
    if (!bind) binds.set(from, bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: from.color }, { binding: 1, resource: sampler }] }))
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bind)
    pass.draw(3)
    pass.end()
  }
}
