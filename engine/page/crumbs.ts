// What a blast throws (#140): small cubes of what was broken, that fly, fall to the ground and
// are gone. They are drawn as faces over the marched picture, tested against its depth, and
// are only for the eye: nothing collides with them.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const MOST = 4096
/** Numbers a crumb: where it is (finest cells from the anchor), its edge, its colour. */
const EACH = 8

const CODE = /* wgsl */ `
struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, pad0: f32, forward: vec3f, pad1: f32, sun: vec3f, day: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) colour: vec3f, @location(1) @interpolate(flat) n: vec3f, @location(2) seen: vec3f, @location(3) @interpolate(flat) glossy: f32 }
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) at: vec4f, @location(1) colour: vec4f) -> Out {
  // Six faces of two triangles: which face, which corner.
  let face = v / 6u;
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u] - 0.5;
  let axis = face >> 1u;
  let side = f32(face & 1u) * 2.0 - 1.0;
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  if (axis == 0u) { p = vec3f(side * 0.5, corner.x, corner.y * side); n = vec3f(side, 0.0, 0.0); }
  else if (axis == 1u) { p = vec3f(corner.x * side, side * 0.5, corner.y); n = vec3f(0.0, side, 0.0); }
  else { p = vec3f(corner.x, corner.y * side, side * 0.5); n = vec3f(0.0, 0.0, side); }
  // Small crash shards (edge < 0.48) are thin tumbling chips/splinters that catch the sun (#62).
  let shard = step(at.w, 0.48);
  if (shard > 0.5) {
    p = vec3f(p.x * 1.45, p.y * 0.24, p.z * 0.95);
    let a = colour.a;
    let ca = cos(a); let sa = sin(a);
    let cb = cos(a * 0.63 + 0.7); let sb = sin(a * 0.63 + 0.7);
    p = vec3f(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
    p = vec3f(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
    n = vec3f(n.x * ca - n.z * sa, n.y, n.x * sa + n.z * ca);
    n = normalize(vec3f(n.x, n.y * cb - n.z * sb, n.y * sb + n.z * cb));
  }
  let world = at.xyz + p * at.w - u.eye;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.colour = colour.rgb;
  out.n = n;
  out.seen = world;
  out.glossy = shard;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let above = 0.5 + 0.5 * in.n.y;
  var col = in.colour * (vec3f(1.0, 0.94, 0.84) * max(dot(in.n, u.sun), 0.0) * 2.4 * u.day + mix(vec3f(0.1, 0.095, 0.09), vec3f(0.3, 0.38, 0.5), above) * mix(0.06, 1.0, u.day));
  if (in.glossy > 0.5) {
    let rd = normalize(in.seen);
    let hv = normalize(u.sun - rd);
    col += vec3f(1.0, 0.96, 0.88) * pow(max(dot(in.n, hv), 0.0), 42.0) * 1.4 * u.day;
  }
  col = col / (col + 0.75) * 1.45;
  return vec4f(pow(clamp(col, vec3f(0.0), vec3f(1.0)), vec3f(0.4545)), 1.0);
}
`

export interface Crumbs {
  /** Throws `count` crumbs of one colour (linear red, green, blue) out of a ball at `at` (finest cells, the world's), `radius` cells across. */
  /** `lasts` is how many seconds they are there for (a few, unless said); `fast` how hard they are thrown, 1 as a blast throws. */
  burst(at: readonly [number, number, number], radius: number, count: number, colour: readonly [number, number, number], edge: number, lasts?: number, fast?: number): void
  /** Moves them `dt` seconds on. `ground` says how high the land is at a column. */
  step(dt: number, ground: (x: number, z: number) => number): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Where the light comes from and how much of the day it is. */
  light(sun: readonly number[], day: number): void
  readonly live: number
  /**
   * Cubes that something else moves (the gathering at a place where a thing is being made, gather.ts): each of these
   * is asked every frame to `put` its cubes where they are now, and they are drawn with the crumbs, lit the same.
   */
  readonly carried: Set<(put: (x: number, y: number, z: number, edge: number, r: number, g: number, b: number) => void) => void>
}

export async function crumbs(device: GPUDevice, format: GPUTextureFormat): Promise<Crumbs> {
  const module = await shader(device, 'crumbs', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'crumbs', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: EACH * 4, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const instances = device.createBuffer({ size: MOST * EACH * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  // Where each is in the world (cells, as doubles: the world is big), how it moves, how long it has left.
  const p = new Float64Array(MOST * 3), v = new Float32Array(MOST * 3), life = new Float32Array(MOST), edge = new Float32Array(MOST), tone = new Float32Array(MOST * 3), spin = new Float32Array(MOST)
  const packed = new Float32Array(MOST * EACH)
  let next = 0, live = 0
  let sun: readonly number[] = [0.52, 0.62, 0.59], sunLength = Math.hypot(sun[0], sun[1], sun[2]), day = 1
  const carried: Crumbs['carried'] = new Set()
  return {
    carried,
    light(from, isDay) { sun = from; sunLength = Math.hypot(sun[0], sun[1], sun[2]); day = isDay },
    get live() { return live },
    burst(at, radius, count, colour, size, lasts = 2.5, fast = 1) {
      for (let k = 0; k < count; k++) {
        const i = next++ % MOST
        // Somewhere in the ball, thrown outwards and up.
        let dx = 0, dy = 0, dz = 0
        do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1 } while (dx * dx + dy * dy + dz * dz > 1)
        p[i * 3] = at[0] + dx * radius; p[i * 3 + 1] = at[1] + dy * radius; p[i * 3 + 2] = at[2] + dz * radius
        const speed = (25 + Math.random() * 60) * fast
        v[i * 3] = dx * speed; v[i * 3 + 1] = dy * speed + (20 + Math.random() * 30) * fast; v[i * 3 + 2] = dz * speed
        life[i] = lasts * (0.65 + Math.random() * 0.7)
        edge[i] = size * (0.6 + Math.random() * 0.8)
        spin[i] = Math.random() * 6.283
        const shade = 0.75 + Math.random() * 0.4
        tone[i * 3] = colour[0] * shade; tone[i * 3 + 1] = colour[1] * shade; tone[i * 3 + 2] = colour[2] * shade
      }
    },
    step(dt, ground) {
      live = 0
      for (let i = 0; i < MOST; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        live++
        v[i * 3 + 1] -= 98 * dt
        for (let a = 0; a < 3; a++) p[i * 3 + a] += v[i * 3 + a] * dt
        const speed = Math.hypot(v[i * 3], v[i * 3 + 1], v[i * 3 + 2])
        if (speed > 2) spin[i] += (6 + speed * 0.14) * dt
        const floor = ground(p[i * 3], p[i * 3 + 2]) + 1 + edge[i] * (edge[i] < 0.48 ? 0.14 : 0.5)
        if (p[i * 3 + 1] < floor) {
          p[i * 3 + 1] = floor
          v[i * 3 + 1] = Math.abs(v[i * 3 + 1]) * 0.25
          v[i * 3] *= 0.5; v[i * 3 + 2] *= 0.5
        }
      }
    },
    draw(encoder, to, view) {
      if (!live && !carried.size) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      let n = 0
      for (const each of carried) each((x, y, z, size, r, g, b) => {
        if (n >= MOST) return
        const o = n++ * EACH
        packed[o] = x - anchor[0]; packed[o + 1] = y - anchor[1]; packed[o + 2] = z - anchor[2]; packed[o + 3] = size
        packed[o + 4] = r; packed[o + 5] = g; packed[o + 6] = b; packed[o + 7] = 1
      })
      if (!n && !live) return
      for (let i = 0; i < MOST && n < MOST; i++) {
        if (life[i] <= 0) continue
        const o = n++ * EACH
        packed[o] = p[i * 3] - anchor[0]; packed[o + 1] = p[i * 3 + 1] - anchor[1]; packed[o + 2] = p[i * 3 + 2] - anchor[2]
        // A crumb shrinks to nothing in its last third of a second.
        packed[o + 3] = edge[i] * Math.min(1, life[i] / 0.35)
        packed[o + 4] = tone[i * 3]; packed[o + 5] = tone[i * 3 + 1]; packed[o + 6] = tone[i * 3 + 2]; packed[o + 7] = spin[i]
      }
      device.queue.writeBuffer(instances, 0, packed, 0, n * EACH)
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf,
        ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun.map((s) => s / sunLength), day,
      ]))
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, instances)
      pass.draw(36, n)
      pass.end()
    },
  }
}
