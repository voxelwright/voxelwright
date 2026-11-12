// Quads: what drawing a city as faces costs (#140). A made-up town on a hill, 400 m a side,
// seen from above its edge so the whole of it is in view. Every column of cells gives its top
// as a face of its own (nothing merged, as on rubble) and a face for each side that stands
// above its neighbour. A finer grid is more and smaller faces over the same ground.
import { SHADE, camera, chance, shader, viewProjection, type Draw, type Gpu } from './gpu.ts'

/** The ground the town stands on, metres a side. */
export const EXTENT = 400

const CODE = /* wgsl */ `
struct U { viewProj: mat4x4f, eye: vec3f, cell: f32 }
@group(0) @binding(0) var<uniform> u: U;
${SHADE}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) face: u32,
}
// A face is two whole numbers: where its column is, then how high, how tall, which way it looks and what it is made of.
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) a: u32, @location(1) b: u32) -> Out {
  let x = f32(a & 0xfffu);
  let z = f32((a >> 12u) & 0xfffu);
  let y = f32(b & 0x3ffu);
  let tall = f32((b >> 10u) & 0x3ffu);
  let axis = (b >> 20u) & 3u;
  let side = f32((b >> 22u) & 1u);
  let cu = f32(v & 1u);
  let cv = f32((v >> 1u) & 1u);
  var p = vec3f(x, y, z);
  if (axis == 1u) { p += vec3f(cu, 0.0, cv); }
  else if (axis == 0u) { p += vec3f(side, -cv * tall, cu); }
  else { p += vec3f(cu, -cv * tall, side); }
  var out: Out;
  out.world = p * u.cell;
  out.pos = u.viewProj * vec4f(out.world, 1.0);
  out.face = b >> 20u;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let axis = in.face & 3u;
  let side = f32((in.face >> 2u) & 1u) * 2.0 - 1.0;
  let kind = (in.face >> 4u) & 0xffu;
  var n = vec3f(0.0, 1.0, 0.0);
  if (axis == 0u) { n = vec3f(side, 0.0, 0.0); }
  if (axis == 2u) { n = vec3f(0.0, 0.0, side); }
  let cell = floor(in.world / u.cell - n * 0.5);
  var paint = vec3f(0.36, 0.5, 0.3);
  if (kind == 1u) { paint = vec3f(0.3, 0.3, 0.32); }
  if (kind >= 2u) { paint = 0.45 + 0.4 * vec3f(hash3(vec3f(f32(kind), 1.0, 2.0)), hash3(vec3f(f32(kind), 5.0, 3.0)), hash3(vec3f(f32(kind), 9.0, 4.0))); }
  let rd = normalize(in.world - u.eye);
  return vec4f(tone(lit(paint, cell, n, rd, 1.0, distance(in.world, u.eye))), 1.0);
}
`

/** How high the town is at each column of a `grid` by `grid` lattice, in cells, and what the top is made of. */
function town(grid: number): { height: Uint16Array; kind: Uint8Array; cell: number } {
  const cell = EXTENT / grid, height = new Uint16Array(grid * grid), kind = new Uint8Array(grid * grid)
  const LOT = 32
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    const wx = (x + 0.5) * cell, wz = (z + 0.5) * cell
    const hill = 14 + 10 * Math.sin(wx * 0.011) * Math.cos(wz * 0.013) + 5 * Math.sin(wx * 0.031 + 1.3) * Math.sin(wz * 0.027)
    const lx = Math.floor(wx / LOT), lz = Math.floor(wz / LOT), ix = wx - lx * LOT, iz = wz - lz * LOT
    let h = hill, k = 1
    if (ix >= 5 && ix < 27 && iz >= 5 && iz < 27) {
      const what = chance(lx, lz, 1)
      if (what < 0.25) k = 0
      else {
        // Two or three houses to a lot, each its own height, with a gap between.
        const half = ix < 16 ? 0 : 1, tall = 6 + 34 * chance(lx * 2 + half, lz, 2) ** 2
        if (Math.abs(ix - 16) > 0.6) { h += tall; k = 2 + Math.floor(chance(lx * 2 + half, lz, 3) * 12) }
      }
    }
    height[x + grid * z] = Math.min(1023, Math.max(1, Math.round(h / cell)))
    kind[x + grid * z] = k
  }
  return { height, kind, cell }
}

/** Every face of the town: two whole numbers each. */
function faces(grid: number): { data: Uint32Array<ArrayBuffer>; count: number; cell: number } {
  const { height, kind, cell } = town(grid)
  let data: Uint32Array<ArrayBuffer> = new Uint32Array(grid * grid * 3)
  let n = 0
  const put = (x: number, z: number, y: number, tall: number, axis: number, side: number, k: number) => {
    if (n + 2 > data.length) { const more = new Uint32Array(data.length * 2); more.set(data); data = more }
    data[n++] = x | (z << 12)
    data[n++] = y | (Math.min(1023, tall) << 10) | (axis << 20) | (side << 22) | (k << 24)
  }
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    const i = x + grid * z, y = height[i], k = kind[i]
    put(x, z, y, 0, 1, 0, k)
    if (x > 0 && height[i - 1] < y) put(x, z, y, y - height[i - 1], 0, 0, k)
    if (x < grid - 1 && height[i + 1] < y) put(x, z, y, y - height[i + 1], 0, 1, k)
    if (z > 0 && height[i - grid] < y) put(x, z, y, y - height[i - grid], 2, 0, k)
    if (z < grid - 1 && height[i + grid] < y) put(x, z, y, y - height[i + grid], 2, 1, k)
  }
  return { data: data.subarray(0, n), count: n / 2, cell }
}

export interface Quads {
  /** The town on a lattice of `grid` columns a side: how many faces, and how to draw them. Frees the lattice before it. */
  build(grid: number): { count: number; cell: number; draw: Draw }
  /** The finest lattice this device's buffers hold. */
  most: number
  destroy(): void
}

export async function quads(gpu: Gpu): Promise<Quads> {
  const { device } = gpu
  const module = await shader(device, 'quads', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'quads', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }, { shaderLocation: 1, offset: 4, format: 'uint32' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  const view = camera([EXTENT / 2, 95, -70], [EXTENT / 2, 5, EXTENT * 0.45], 60)
  let held: GPUBuffer | null = null
  // A face is 8 bytes, and a lattice has a little over one face a column.
  const most = Math.min(4095, Math.floor(Math.sqrt(Math.min(device.limits.maxBufferSize, 256 << 20) / 8 / 1.25)))
  return {
    most,
    build(grid) {
      held?.destroy()
      const { data, count, cell } = faces(grid)
      const buffer = held = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(buffer, 0, data)
      const draw: Draw = (encoder, to, timing) => {
        const block = new Float32Array(20)
        block.set(viewProjection(view, to.size[0] / to.size[1], 0.5, 2000))
        block.set(view.eye, 16)
        block[19] = cell
        device.queue.writeBuffer(uniforms, 0, block)
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0.6, 0.72, 0.9, 1] }],
          depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1 },
          ...(timing ? { timestampWrites: timing } : {}),
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bind)
        pass.setVertexBuffer(0, buffer)
        pass.draw(4, count)
        pass.end()
      }
      return { count, cell, draw }
    },
    destroy() { held?.destroy(); held = null },
  }
}
