// Tire skidmarks and ground vehicle light pools (headlights, red brake splash) drawn over the marched ground.
// Depth-tested against the scene without writing depth, with zero GPU work when no marks or pools are active.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const SKID_CODE = /* wgsl */ `
struct U { right: vec3f, tanHalf: f32, up: vec3f, aspect: f32, forward: vec3f, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f }
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@location(0) at: vec3f, @location(1) uv: vec2f, @location(2) col: vec4f) -> Out {
  let d = dot(at, u.forward);
  var out: Out;
  out.pos = vec4f(dot(at, u.right) / (u.tanHalf * u.aspect), dot(at, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = uv;
  out.col = col;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // Twin subtle tread ribs across the tire width, soft feathered edges.
  let edge = 1.0 - smoothstep(0.62, 1.0, abs(in.uv.x));
  let rib = 0.86 + 0.14 * cos(in.uv.x * 12.566);
  let a = in.col.a * edge * rib;
  if (a < 0.005) { discard; }
  return vec4f(in.col.rgb, a);
}
`

const SPILL_CODE = /* wgsl */ `
struct U { right: vec3f, tanHalf: f32, up: vec3f, aspect: f32, forward: vec3f, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f }
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@location(0) at: vec3f, @location(1) uv: vec2f, @location(2) col: vec4f) -> Out {
  let d = dot(at, u.forward);
  var out: Out;
  out.pos = vec4f(dot(at, u.right) / (u.tanHalf * u.aspect), dot(at, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = uv;
  out.col = col;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // Soft elongated beam/pool falloff on the road surface.
  let r = length(in.uv);
  let fall = (1.0 - smoothstep(0.05, 1.0, r));
  let glow = fall * fall * in.col.a;
  if (glow < 0.003) { discard; }
  return vec4f(in.col.rgb * glow, 0.0);
}
`

export interface Spill {
  /** Center on the road (cells). */
  at: readonly [number, number, number]
  /** Forward unit direction on the XZ plane [fx, fz]. */
  dir: readonly [number, number]
  /** Half-length along dir and half-width across dir (cells). */
  size: readonly [number, number]
  /** Linear RGB colour and intensity. */
  colour: readonly [number, number, number]
  alpha: number
}

export interface Tracks {
  /** Extends a continuous tire mark ribbon for `wheel` (0..7) at world position `at` (cells). */
  mark(wheel: number, at: readonly [number, number, number], strength: number, colour?: readonly [number, number, number], width?: number): void
  /** Lifts a wheel ribbon so the next mark starts a fresh stroke. */
  lift(wheel?: number): void
  /** Queues a ground light pool (headlight cone or brake-light road splash) for the current frame. */
  spill(s: Spill): void
  /** Advances mark lifetimes and clears expired marks. */
  step(dt: number): void
  /** Clears all marks and pools (e.g. on world reset). */
  clear(): void
  /** Draws active skidmarks and ground light pools. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, ground: (x: number, y: number, z: number) => number): void
  readonly count: number
}

const MAX_SEGS = 1024
const MAX_SPILLS = 24
const FLOATS = 9 // x, y, z, u, v, r, g, b, a
const LIFE = 18

interface Seg {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  nx: number; nz: number
  half: number
  r: number; g: number; b: number
  a0: number; a1: number
  age: number
}

export async function tracks(device: GPUDevice, format: GPUTextureFormat): Promise<Tracks> {
  const [skidMod, spillMod] = await Promise.all([shader(device, 'tracks-skid', SKID_CODE), shader(device, 'tracks-spill', SPILL_CODE)])
  const attrs: GPUVertexAttribute[] = [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x2' },
    { shaderLocation: 2, offset: 20, format: 'float32x4' },
  ]
  const skidPipe = await device.createRenderPipelineAsync({
    label: 'tracks-skid', layout: 'auto',
    vertex: { module: skidMod, entryPoint: 'vs', buffers: [{ arrayStride: FLOATS * 4, attributes: attrs }] },
    fragment: { module: skidMod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const spillPipe = await device.createRenderPipelineAsync({
    label: 'tracks-spill', layout: 'auto',
    vertex: { module: spillMod, entryPoint: 'vs', buffers: [{ arrayStride: FLOATS * 4, attributes: attrs }] },
    fragment: { module: spillMod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const skidBuf = device.createBuffer({ size: MAX_SEGS * 6 * FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const spillBuf = device.createBuffer({ size: MAX_SPILLS * 6 * FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const skidBind = device.createBindGroup({ layout: skidPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  const spillBind = device.createBindGroup({ layout: spillPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })

  const segs: Seg[] = []
  let writeAt = 0
  const tails = new Map<number, { x: number; y: number; z: number; a: number }>()
  const spills: Spill[] = []
  const skidData = new Float32Array(MAX_SEGS * 6 * FLOATS)
  const spillData = new Float32Array(MAX_SPILLS * 6 * FLOATS)

  return {
    get count() { return segs.length },
    mark(wheel, at, strength, colour = [0.04, 0.04, 0.045], width = 3.0) {
      const a = Math.max(0, Math.min(0.75, strength * 0.72))
      if (a < 0.03) { tails.delete(wheel); return }
      const prev = tails.get(wheel)
      if (!prev) { tails.set(wheel, { x: at[0], y: at[1], z: at[2], a }); return }
      const dx = at[0] - prev.x, dz = at[2] - prev.z, dist = Math.hypot(dx, dz)
      if (dist < 1.4) return
      if (dist > 45) { tails.set(wheel, { x: at[0], y: at[1], z: at[2], a }); return }
      const nx = -dz / dist, nz = dx / dist
      const seg: Seg = {
        ax: prev.x, ay: prev.y, az: prev.z,
        bx: at[0], by: at[1], bz: at[2],
        nx, nz, half: width * 0.5,
        r: colour[0], g: colour[1], b: colour[2],
        a0: prev.a, a1: a, age: 0,
      }
      if (segs.length < MAX_SEGS) segs.push(seg)
      else { segs[writeAt] = seg; writeAt = (writeAt + 1) % MAX_SEGS }
      tails.set(wheel, { x: at[0], y: at[1], z: at[2], a })
    },
    lift(wheel) {
      if (wheel === undefined) tails.clear()
      else tails.delete(wheel)
    },
    spill(s) {
      if (spills.length < MAX_SPILLS && s.alpha > 0.01) spills.push(s)
    },
    step(dt) {
      for (let i = segs.length - 1; i >= 0; i--) {
        segs[i].age += dt
        if (segs[i].age >= LIFE) {
          segs.splice(i, 1)
          if (writeAt > i) writeAt--
          if (writeAt >= segs.length) writeAt = 0
        }
      }
    },
    clear() {
      segs.length = 0
      writeAt = 0
      tails.clear()
      spills.length = 0
    },
    draw(encoder, to, view, ground) {
      let nSkid = 0
      const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]
        const fade = s.age > LIFE - 5 ? Math.max(0, (LIFE - s.age) / 5) : 1
        const a0 = s.a0 * fade, a1 = s.a1 * fade
        if (a0 < 0.01 && a1 < 0.01) continue
        const ox = s.nx * s.half, oz = s.nz * s.half
        const p0x = s.ax - ox - ex, p0y = s.ay + 0.35 - ey, p0z = s.az - oz - ez
        const p1x = s.ax + ox - ex, p1y = s.ay + 0.35 - ey, p1z = s.az + oz - ez
        const p2x = s.bx + ox - ex, p2y = s.by + 0.35 - ey, p2z = s.bz + oz - ez
        const p3x = s.bx - ox - ex, p3y = s.by + 0.35 - ey, p3z = s.bz - oz - ez
        const o = nSkid * 6 * FLOATS
        skidData[o + 0] = p0x; skidData[o + 1] = p0y; skidData[o + 2] = p0z; skidData[o + 3] = -1; skidData[o + 4] = 0; skidData[o + 5] = s.r; skidData[o + 6] = s.g; skidData[o + 7] = s.b; skidData[o + 8] = a0
        skidData[o + 9] = p1x; skidData[o + 10] = p1y; skidData[o + 11] = p1z; skidData[o + 12] = 1; skidData[o + 13] = 0; skidData[o + 14] = s.r; skidData[o + 15] = s.g; skidData[o + 16] = s.b; skidData[o + 17] = a0
        skidData[o + 18] = p2x; skidData[o + 19] = p2y; skidData[o + 20] = p2z; skidData[o + 21] = 1; skidData[o + 22] = 1; skidData[o + 23] = s.r; skidData[o + 24] = s.g; skidData[o + 25] = s.b; skidData[o + 26] = a1
        skidData[o + 27] = p0x; skidData[o + 28] = p0y; skidData[o + 29] = p0z; skidData[o + 30] = -1; skidData[o + 31] = 0; skidData[o + 32] = s.r; skidData[o + 33] = s.g; skidData[o + 34] = s.b; skidData[o + 35] = a0
        skidData[o + 36] = p2x; skidData[o + 37] = p2y; skidData[o + 38] = p2z; skidData[o + 39] = 1; skidData[o + 40] = 1; skidData[o + 41] = s.r; skidData[o + 42] = s.g; skidData[o + 43] = s.b; skidData[o + 44] = a1
        skidData[o + 45] = p3x; skidData[o + 46] = p3y; skidData[o + 47] = p3z; skidData[o + 48] = -1; skidData[o + 49] = 1; skidData[o + 50] = s.r; skidData[o + 51] = s.g; skidData[o + 52] = s.b; skidData[o + 53] = a1
        nSkid++
      }

      let nSpill = 0
      for (let i = 0; i < spills.length; i++) {
        const s = spills[i]
        const [fx, fz] = s.dir, rx = -fz, rz = fx
        const [hl, hw] = s.size, [cr, cg, cb] = s.colour, a = s.alpha
        const corner = (u: number, v: number) => {
          const x = s.at[0] + fx * v * hl + rx * u * hw
          const z = s.at[2] + fz * v * hl + rz * u * hw
          const y = ground(x, s.at[1] + 12, z) + 1.15
          return [x - ex, y - ey, z - ez, u, v, cr, cg, cb, a]
        }
        const [c0, c1, c2, c3] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
        spillData.set([...c0, ...c1, ...c2, ...c0, ...c2, ...c3], nSpill * 6 * FLOATS)
        nSpill++
      }
      spills.length = 0

      if (!nSkid && !nSpill) return
      device.queue.writeBuffer(uniforms, 0, Float32Array.from([...view.right, view.tanHalf, ...view.up, to.size[0] / to.size[1], ...view.forward, 0]))
      if (nSkid) device.queue.writeBuffer(skidBuf, 0, skidData, 0, nSkid * 6 * FLOATS)
      if (nSpill) device.queue.writeBuffer(spillBuf, 0, spillData, 0, nSpill * 6 * FLOATS)

      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
      if (nSkid) {
        pass.setPipeline(skidPipe)
        pass.setBindGroup(0, skidBind)
        pass.setVertexBuffer(0, skidBuf)
        pass.draw(nSkid * 6)
      }
      if (nSpill) {
        pass.setPipeline(spillPipe)
        pass.setBindGroup(0, spillBind)
        pass.setVertexBuffer(0, spillBuf)
        pass.draw(nSpill * 6)
      }
      pass.end()
    },
  }
}
