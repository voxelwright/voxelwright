// A piece on its way down (#140). While it falls it is not cells of the world, so the rays do
// not see it: it is drawn as its outside faces, rows of them merged in the core, over the
// marched picture and tested against its depth. The faces are sent to the GPU once; each frame
// only says how far the piece has fallen. It is lit as the world is, without a shadow of its
// own or on it.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'
import type { Fall } from './settler.ts'

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, pad0: f32,
  forward: vec3f, pad1: f32,
  sun: vec3f, pad2: f32,
  // The piece's low corner from the anchor as it is now, and in the world where it began (its cells keep their shades).
  low: vec3f, pad3: f32,
  cells: vec3i, pad4: i32,
}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, pad: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<uniform> looks: Looks;
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) at: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) kind: u32,
}
const NEAR = 1.0;
const FAR = 100000.0;
// A face is two words: where its row starts in the piece, then how long it is, which way it looks and its kind.
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) a: u32, @location(1) b: u32) -> Out {
  let start = vec3f(f32(a & 1023u), f32((a >> 10u) & 1023u), f32((a >> 20u) & 1023u));
  let long = f32(b & 255u);
  let axis = (b >> 8u) & 3u;
  let side = f32((b >> 10u) & 1u);
  let cu = f32(v & 1u);
  let cv = f32((v >> 1u) & 1u);
  var p = start;
  var n = vec3f(0.0);
  if (axis == 1u) { p += vec3f(cu * long, side, cv); n = vec3f(0.0, side * 2.0 - 1.0, 0.0); }
  else if (axis == 2u) { p += vec3f(cu * long, cv, side); n = vec3f(0.0, 0.0, side * 2.0 - 1.0); }
  else { p += vec3f(side, cv, cu * long); n = vec3f(side * 2.0 - 1.0, 0.0, 0.0); }
  let world = u.low + p - u.eye;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.at = p;
  out.n = n;
  out.kind = b >> 16u;
  return out;
}
fn hash3i(c: vec3i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let m = looks.material[in.kind & 15u];
  let ci = (in.kind >> 8u) & 255u;
  var paint = m.colour;
  if (ci != 0u) { paint = looks.palette[ci].rgb; }
  let cell = vec3i(floor(in.at - in.n * 0.5)) + u.cells;
  let own = hash3i(cell, 1u);
  let blot = hash3i(cell >> vec3u(2u), 2u);
  paint *= 1.0 + (own - 0.5) * 0.4 * m.wander + (blot - 0.5) * 0.16 * m.wander;
  let above = 0.5 + 0.5 * in.n.y;
  var col = paint * (vec3f(1.0, 0.94, 0.84) * max(dot(in.n, u.sun), 0.0) * 2.4 + mix(vec3f(0.1, 0.095, 0.09), vec3f(0.3, 0.38, 0.5), above));
  col = col / (col + 0.75) * 1.45;
  return vec4f(pow(clamp(col, vec3f(0.0), vec3f(1.0)), vec3f(0.4545)), 1.0);
}
`

/** One piece as the GPU holds it. */
export interface Piece {
  fall: Fall
  /** How many cells it has fallen so far. */
  down: number
  destroy(): void
}

export interface Pieces {
  add(fall: Fall): Piece
  draw(encoder: GPUCommandEncoder, to: Target, view: View, sun: readonly [number, number, number]): void
  readonly count: number
}

export async function pieces(device: GPUDevice, format: GPUTextureFormat, looks: GPUBuffer): Promise<Pieces> {
  const module = await shader(device, 'pieces', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'pieces', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }, { shaderLocation: 1, offset: 4, format: 'uint32' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  interface Held extends Piece { faces: GPUBuffer; uniforms: GPUBuffer; bind: GPUBindGroup; count: number }
  const live = new Set<Held>()
  return {
    get count() { return live.size },
    add(fall) {
      const faces = device.createBuffer({ size: Math.max(8, fall.faces.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(faces, 0, fall.faces)
      const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: looks } }] })
      const piece: Held = { fall, down: 0, faces, uniforms, bind, count: fall.faces.length / 2, destroy() { live.delete(piece); faces.destroy(); uniforms.destroy() } }
      live.add(piece)
      return piece
    },
    draw(encoder, to, view, sun) {
      if (!live.size) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const block = new ArrayBuffer(112), f = new Float32Array(block), i32 = new Int32Array(block)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun, 0])
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setPipeline(pipeline)
      for (const piece of live) {
        const b = piece.fall.box
        f.set([b[0] - anchor[0], b[1] - piece.down - anchor[1], b[2] - anchor[2]], 20)
        i32.set([b[0], b[1], b[2]], 24)
        device.queue.writeBuffer(piece.uniforms, 0, block.slice(0))
        pass.setBindGroup(0, piece.bind)
        pass.setVertexBuffer(0, piece.faces)
        pass.draw(4, piece.count)
      }
      pass.end()
    },
  }
}
