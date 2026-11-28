// The shade under a living thing (#245). A body is drawn as pieces (pieces.ts) and casts nothing into the sun's
// maps, so a car stood on the road as if pasted on it. This is the cheap honest part of its shadow: the ground under
// its footprint darkened, softly at the edges, as the sky's light is kept from under a thing whatever the sun does,
// fading as it rises off the ground and at night. One quad a thing, laid on the ground at its corners, tested
// against the depth of what is marched, darkening what is drawn there. Its shadow cast across the street by a low sun
// is not this: that is the body's cells in the sun's maps.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const CODE = /* wgsl */ `
struct U { right: vec3f, tanHalf: f32, up: vec3f, aspect: f32, forward: vec3f, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) dark: f32 }
const NEAR = 1.0;
const FAR = 100000.0;
// A corner: where it is from the eye (the world's cells), where it is across the quad (-1 to 1), and how dark the middle is.
@vertex fn vs(@location(0) at: vec3f, @location(1) uv: vec2f, @location(2) dark: f32) -> Out {
  let d = dot(at, u.forward);
  var out: Out;
  out.pos = vec4f(dot(at, u.right) / (u.tanHalf * u.aspect), dot(at, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = uv;
  out.dark = dark;
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // A rounded box: nearly its footprint, softening to nothing at the quad's edge.
  let q = abs(in.uv);
  let r = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25);
  let a = in.dark * (1.0 - smoothstep(0.45, 1.0, r));
  let linA = 1.0 - pow(1.0 - clamp(a, 0.0, 0.95), 2.0);
  return vec4f(0.0, 0.0, 0.0, linA);
}
`

/** What lies under a thing: its middle (the world's cells), its turn about y, half its width along its own x and z, how high it is and how high its underside is over the ground there (cells). */
export interface Shade { at: readonly [number, number, number]; yaw: number; half: readonly [number, number]; high: number; lift: number }

export interface Under {
  /** Darkens the ground under each thing; `ground(x, y, z)` is the height of what is under a place (cells), looked for down from `y`; `light` how much of the sky's light there is to keep out (0 to 1). */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, shades: readonly Shade[], ground: (x: number, y: number, z: number) => number, light: number, sun: readonly [number, number, number]): void
}

const MOST = 16, FLOATS = 6

export async function under(device: GPUDevice, format: GPUTextureFormat): Promise<Under> {
  const module = await shader(device, 'under', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'under', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: FLOATS * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }, { shaderLocation: 2, offset: 20, format: 'float32' }] }] },
    // What is there is kept by one less what is drawn: darkened, never lit.
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  })
  const uniforms = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const corners = device.createBuffer({ size: MOST * 6 * FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  const data = new Float32Array(MOST * 6 * FLOATS)
  return {
    draw(encoder, to, view, shades, ground, light, sun) {
      let n = 0
      for (const s of shades) {
        if (n === MOST) break
        // Dark under a thing on the ground, none for one a couple of metres up; a little wider than the thing.
        const dark = 0.6 * light * Math.max(0, 1 - s.lift / 20)
        if (dark <= 0.01) continue
        // Moved a little the way the sun's shadow falls (`sun` is towards the sun), as far as half its height would throw it.
        const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), hx = s.half[0] + 5, hz = s.half[1] + 5, throw_ = Math.min(8, s.high / 2 / Math.max(sun[1], 0.25))
        const flat = Math.hypot(sun[0], sun[2]) || 1, mx = s.at[0] - (sun[0] / flat) * throw_ * Math.min(1, flat * 2), mz = s.at[2] - (sun[2] / flat) * throw_ * Math.min(1, flat * 2)
        // Laid a cell over the ground at each corner: a road climbs in steps of a cell, and lower it was cut by each step.
        const corner = (u: number, v: number) => {
          const x = mx + c * u * hx + sn * v * hz, z = mz - sn * u * hx + c * v * hz
          return [x - view.eye[0], ground(x, s.at[1], z) + 1.05 - view.eye[1], z - view.eye[2], u, v, dark]
        }
        const [a, b, cc, d] = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
        data.set([...a, ...b, ...cc, ...a, ...cc, ...d], n * 6 * FLOATS)
        n++
      }
      if (!n) return
      device.queue.writeBuffer(uniforms, 0, Float32Array.from([...view.right, view.tanHalf, ...view.up, to.size[0] / to.size[1], ...view.forward, 0]))
      device.queue.writeBuffer(corners, 0, data, 0, n * 6 * FLOATS)
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, corners)
      pass.draw(n * 6)
      pass.end()
    },
  }
}
