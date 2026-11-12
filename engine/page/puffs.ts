// Fire, smoke and dust (#151): soft lumps that face the eye, drawn over the picture and tested
// against its depth. A puff is hot or it is not: hot, it glows and adds its light; as it cools
// it turns to smoke, which covers what is behind it, swells, rises and thins. They are only
// for the eye. What burns, and what that does to the world, is the core's (fire.rs).
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const MOST = 3072
/** Numbers a puff as the GPU is told it: where (finest cells from the anchor) and how big; its colour and how much it covers; how hot, its own number, how far through its life. */
const EACH = 12

const CODE = /* wgsl */ `
struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, pad0: f32, forward: vec3f, pad1: f32, sun: vec3f, pad2: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) colour: vec4f,
  @location(2) @interpolate(flat) more: vec4f,
}
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) at: vec4f, @location(1) colour: vec4f, @location(2) more: vec4f) -> Out {
  let corner = vec2f(f32(v & 1u), f32((v >> 1u) & 1u)) * 2.0 - 1.0;
  let world = at.xyz - u.eye + (u.right * corner.x + u.up * corner.y) * at.w;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = corner;
  out.colour = colour;
  out.more = more;
  return out;
}
fn lump(c: vec2i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let heat = in.more.x;
  let age = in.more.z;
  // A puff is lumps about two cells across (in.more.w is half of how many fit across it): its edge is ragged in
  // steps, as everything here is made of cells.
  let fine = in.more.w;
  let cell = vec2i(floor(in.uv * fine + 64.0));
  let rag = lump(cell, u32(in.more.y));
  let r = length((vec2f(cell) - 63.5) / fine);
  let body = 1.0 - smoothstep(0.5, 1.0, r + (rag - 0.5) * 0.5);
  if (body <= 0.0) { discard; }
  let fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.55, 1.0, age));
  let cover = in.colour.a * body * fade * (1.0 - heat * 0.8);
  // Smoke is lit from above and on the sun's side; the lumps differ a little.
  let lit = 0.55 + 0.3 * in.uv.y * -1.0 + 0.25 * dot(in.uv, vec2f(dot(u.sun, u.right), -dot(u.sun, u.up))) + (rag - 0.5) * 0.25;
  let smoke = in.colour.rgb * clamp(lit, 0.2, 1.3);
  // Fire: white-yellow when hottest, orange, then a dull red as it goes out.
  let glow = mix(vec3f(1.0, 0.22, 0.03), vec3f(1.0, 0.86, 0.45), heat * heat) * (heat * (0.5 + rag)) * body * fade * 1.6;
  return vec4f(smoke * cover + glow, cover);
}
`

export interface Puffs {
  /** A blast `radius` cells across at `at` (the world's finest cells): a flash, a ball of fire, the smoke it leaves. */
  blast(at: readonly [number, number, number], radius: number): void
  /** Dust thrown up where something came down: `count` puffs of a colour (as the screen shows it) round `at`, spreading `radius` cells. */
  dust(at: readonly [number, number, number], radius: number, count: number, colour: readonly [number, number, number]): void
  /** A burning cell, for one frame of `dt` seconds: flames, and now and then smoke. */
  flame(at: readonly [number, number, number], dt: number): void
  step(dt: number): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  readonly live: number
}

export async function puffs(device: GPUDevice, format: GPUTextureFormat): Promise<Puffs> {
  const module = await shader(device, 'puffs', CODE)
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const pipeline = await device.createRenderPipelineAsync({
    label: 'puffs', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: EACH * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const instances = device.createBuffer({ size: MOST * EACH * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  // Where each is in the world (as doubles: the world is big), how it moves, and how it changes as it ages.
  const p = new Float64Array(MOST * 3), v = new Float32Array(MOST * 3)
  const size = new Float32Array(MOST), grow = new Float32Array(MOST), life = new Float32Array(MOST), span = new Float32Array(MOST)
  const heat = new Float32Array(MOST), cool = new Float32Array(MOST), rise = new Float32Array(MOST), drag = new Float32Array(MOST)
  const tone = new Float32Array(MOST * 4), seed = new Float32Array(MOST)
  const packed = new Float32Array(MOST * EACH), order = new Uint16Array(MOST), far = new Float32Array(MOST)
  let next = 0, live = 0
  const sun = [0.52, 0.62, 0.59], sunLength = Math.hypot(sun[0], sun[1], sun[2])
  const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
  /** One puff. `out` is how fast it leaves `at`, in a direction of its own. */
  const puff = (at: readonly [number, number, number], spread: number, out: number, up: number, o: { size: number; grow: number; life: number; heat: number; cool: number; rise: number; drag: number; colour: readonly [number, number, number]; cover: number }) => {
    const i = next++ % MOST
    let dx = 0, dy = 0, dz = 0
    do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1 } while (dx * dx + dy * dy + dz * dz > 1)
    p[i * 3] = at[0] + dx * spread; p[i * 3 + 1] = at[1] + dy * spread; p[i * 3 + 2] = at[2] + dz * spread
    v[i * 3] = dx * out; v[i * 3 + 1] = dy * out + up; v[i * 3 + 2] = dz * out
    size[i] = o.size; grow[i] = o.grow; life[i] = span[i] = o.life; heat[i] = o.heat; cool[i] = o.cool; rise[i] = o.rise; drag[i] = o.drag
    tone.set([o.colour[0], o.colour[1], o.colour[2], o.cover], i * 4)
    seed[i] = Math.floor(Math.random() * 65536)
  }
  return {
    get live() { return live },
    blast(at, r) {
      // The flash: one puff of light, gone in a tenth of a second.
      puff(at, 0, 0, 0, { size: r * 2.6, grow: r * 6, life: 0.12, heat: 1, cool: 0, rise: 0, drag: 0, colour: [0, 0, 0], cover: 0 })
      // The ball of fire: hot lumps thrown out, cooling to black smoke in under a second.
      // A big blast's puffs are bigger, not many more: they are drawn over one another, and that is what costs.
      for (let k = Math.min(16, Math.max(6, Math.round(r * 0.8))); k > 0; k--) {
        puff(at, r * 0.5, rnd(20, 70), 30, { size: r * rnd(0.45, 0.9), grow: r * 1.3, life: rnd(0.55, 1.0), heat: 1, cool: rnd(1.3, 2.0), rise: 70, drag: 3.2, colour: [0.13, 0.12, 0.11], cover: 0.7 })
      }
      // The smoke it leaves: grey, slow, rising for seconds.
      for (let k = Math.min(12, Math.max(5, Math.round(r * 0.5))); k > 0; k--) {
        const grey = rnd(0.3, 0.55)
        puff(at, r * 0.7, rnd(8, 30), rnd(15, 40), { size: r * rnd(0.6, 1.0), grow: r * 0.55, life: rnd(2.6, 5.2), heat: 0, cool: 0, rise: 22, drag: 1.1, colour: [grey, grey, grey * 1.04], cover: 0.5 })
      }
    },
    dust(at, radius, count, colour) {
      for (let k = count; k > 0; k--) {
        puff(at, radius * 0.6, rnd(6, 26), rnd(2, 12), { size: rnd(3, 7) + radius * 0.3, grow: rnd(4, 9), life: rnd(1.2, 2.6), heat: 0, cool: 0, rise: 3, drag: 2.2, colour, cover: 0.34 })
      }
    },
    flame(at, dt) {
      if (Math.random() < dt * 9) puff(at, 0.8, rnd(1, 5), rnd(18, 40), { size: rnd(1.6, 3.4), grow: rnd(1, 3), life: rnd(0.35, 0.7), heat: 1, cool: rnd(1.4, 2.4), rise: 60, drag: 1.5, colour: [0.05, 0.045, 0.04], cover: 0.25 })
      if (Math.random() < dt * 1.2) {
        const grey = rnd(0.2, 0.36)
        puff(at, 1.5, rnd(2, 8), rnd(25, 45), { size: rnd(3, 6), grow: rnd(3, 6), life: rnd(3, 6), heat: 0, cool: 0, rise: 30, drag: 0.9, colour: [grey, grey, grey], cover: 0.42 })
      }
    },
    step(dt) {
      live = 0
      for (let i = 0; i < MOST; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        live++
        const slow = Math.max(0, 1 - drag[i] * dt)
        v[i * 3] = v[i * 3] * slow + 6 * dt // a light wind along x
        v[i * 3 + 1] = v[i * 3 + 1] * slow + rise[i] * dt
        v[i * 3 + 2] *= slow
        for (let a = 0; a < 3; a++) p[i * 3 + a] += v[i * 3 + a] * dt
        size[i] += grow[i] * dt
        heat[i] = Math.max(0, heat[i] - cool[i] * dt)
      }
    },
    draw(encoder, to, view) {
      if (!live) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      // The furthest first: each covers what is behind it.
      let n = 0
      for (let i = 0; i < MOST; i++) {
        if (life[i] <= 0) continue
        far[i] = (p[i * 3] - view.eye[0]) * view.forward[0] + (p[i * 3 + 1] - view.eye[1]) * view.forward[1] + (p[i * 3 + 2] - view.eye[2]) * view.forward[2]
        order[n++] = i
      }
      const sorted = order.subarray(0, n).sort((a, b) => far[b] - far[a])
      for (let k = 0; k < n; k++) {
        const i = sorted[k], o = k * EACH
        packed[o] = p[i * 3] - anchor[0]; packed[o + 1] = p[i * 3 + 1] - anchor[1]; packed[o + 2] = p[i * 3 + 2] - anchor[2]; packed[o + 3] = size[i]
        packed[o + 4] = tone[i * 4]; packed[o + 5] = tone[i * 4 + 1]; packed[o + 6] = tone[i * 4 + 2]; packed[o + 7] = tone[i * 4 + 3]
        packed[o + 8] = heat[i]; packed[o + 9] = seed[i]; packed[o + 10] = 1 - life[i] / span[i]; packed[o + 11] = Math.min(12, Math.max(3, size[i] / 2))
      }
      device.queue.writeBuffer(instances, 0, packed, 0, n * EACH)
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf,
        ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun.map((s) => s / sunLength), 0,
      ]))
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, instances)
      pass.draw(4, n)
      pass.end()
    },
  }
}
