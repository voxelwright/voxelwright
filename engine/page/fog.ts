// The marine layer (#450): a bank of fog that rolls in off the Pacific and lies over the city, its top between 70
// and 125 m, so that the towers rise out of it. After the march and the far model (far.ts), each pixel's look is
// walked through the bank as far as the nearest thing either drew, and the fog met on the way is laid over it. By
// day the bank's top catches the light; at night the city's lights glow up into it from below. The owner's site's
// landing has the same bank (static/landing/fog.js on the site); this is it in the engine's frame and light.
//
//   ?fog=0.8      how thick, 0 (none, the default) to 1; `engine.fog` sets it while the page runs
import { shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, type Marcher, type View } from './march.ts'

const CODE = /* wgsl */ `
${GLOBALS}
@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var marched: texture_depth_2d;
@group(0) @binding(2) var faced: texture_depth_2d;
struct Fog { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, time: f32, forward: vec3f, strength: f32, size: vec2f, steps: f32, pad: f32 }
@group(0) @binding(3) var<uniform> f: Fog;
// The march's depth (march.ts fs), and the far model's: one over the distance along the look (far.ts vs).
const NEAR = 1.0;
const FAR = 100000.0;
// The bank's top, in the world's cells of 10 cm over the sea: 70 m where it is thin, 125 m where it is thick.
const LOW = 700.0;
const HIGH = 1250.0;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
fn hash(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let t = fract(p);
  let u = t * t * (3.0 - 2.0 * t);
  return mix(mix(hash(i), hash(i + vec2i(1, 0)), u.x), mix(hash(i + vec2i(0, 1)), hash(i + vec2i(1, 1)), u.x), u.y);
}
// Banks roll in from the Pacific: the pattern drifts east and a little south.
fn cover(xz: vec2f) -> f32 {
  let p = xz / 7200.0;
  let wind = vec2f(0.016, 0.004) * f.time;
  let warp = noise(p * 0.7 - wind * 0.6 + vec2f(3.1, 7.7));
  var c = noise(p - wind + warp * 0.9) * 0.62;
  c += noise(p * 2.3 - wind * 1.7 + vec2f(9.2, 1.3)) * 0.38;
  return c;
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = at.xy / f.size * 2.0 - 1.0;
  let rd = normalize(f.forward + f.tanHalf * (f.right * uv.x * f.aspect - f.up * uv.y));
  if (rd.y > -0.0005 && f.eye.y > HIGH) { return vec4f(0.0); }
  // How far the look goes: to the nearer of what the march met and what the far model drew.
  var reach = 60000.0;
  let z = textureLoad(marched, vec2i(at.xy), 0);
  if (z < 1.0) { reach = min(reach, NEAR / max(1.0 - z * (FAR - NEAR) / FAR, 1e-6) / max(dot(rd, f.forward), 1e-3)); }
  let w = textureLoad(faced, vec2i(at.xy), 0);
  if (w > 0.0) { reach = min(reach, 1.0 / w / max(dot(rd, f.forward), 1e-3)); }
  // Into the bank from above, or from where the eye is in it.
  let enter = select(0.0, max(0.0, (HIGH - f.eye.y) / rd.y), f.eye.y > HIGH);
  // The near streets stay clear: the bank begins 420 m out.
  let start = max(enter, 4200.0);
  if (start >= reach) { return vec4f(0.0); }
  let n = i32(f.steps);
  let dt = (reach - start) / f32(n);
  let jitter = hash(vec2i(at.xy));
  let night = 1.0 - g.day;
  let dayTone = mix(vec3f(0.80, 0.83, 0.87), vec3f(0.98, 0.86, 0.76), g.low * 0.6);
  var col = vec3f(0.0);
  var clear = 1.0;
  for (var k = 0; k < n; k++) {
    let t = start + (f32(k) + jitter) * dt;
    let q = f.eye + rd * t;
    let c = cover(q.xz);
    let top = mix(LOW, HIGH, smoothstep(0.3, 0.75, c));
    let body = (1.0 - smoothstep(top - 420.0, top, q.y)) * smoothstep(0.26, 0.5, c);
    let fade = smoothstep(4200.0, 10000.0, t);
    let thick = body * fade * f.strength;
    if (thick <= 0.0) { continue; }
    let a = 1.0 - exp(-thick * dt / 3400.0);
    // Daylight catches the top of the bank; at night the city lights it from below.
    let crest = smoothstep(top - 520.0, top, q.y);
    let day = dayTone * mix(0.78, 1.04, crest);
    let glow = mix(vec3f(0.07, 0.085, 0.13), vec3f(0.36, 0.23, 0.14), g.weather.z * (1.0 - crest) * 0.75);
    col += clear * a * mix(day, glow, night);
    clear *= 1.0 - a;
    if (clear < 0.04) { break; }
  }
  let alpha = (1.0 - clear) * 0.86;
  return vec4f(col * 0.86, alpha);
}
`

export interface Fog {
  /** How thick, 0 to 1 (0 draws nothing). */
  strength: number
  /** Lays the bank over `to`: after the march (whose depth `to` holds) and the far model (whose depth is `faced`, or none). */
  draw(encoder: GPUCommandEncoder, to: Target, faced: GPUTextureView | null, view: View, time: number): void
}

export async function fog(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<Fog> {
  const module = await shader(device, 'fog', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'fog', layout: 'auto', vertex: { module, entryPoint: 'vs' },
    // Over the picture; the march's glow in alpha (glow.ts) is kept as it was.
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  // Where there is no far model: a depth that says nothing was drawn.
  const nothing = device.createTexture({ size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
  const enc = device.createCommandEncoder()
  enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: nothing.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end()
  device.queue.submit([enc.finish()])
  const none = nothing.createView()
  const binds = new Map<string, { a: GPUTextureView; b: GPUTextureView; bind: GPUBindGroup }>()
  const self: Fog = {
    strength: Math.max(0, Math.min(1, Number(new URLSearchParams(globalThis.location?.search ?? '').get('fog') ?? 0))),
    draw(encoder, to, faced, view, time) {
      if (self.strength <= 0) return
      const b = faced ?? none
      let held = binds.get('last')
      if (!held || held.a !== to.depth || held.b !== b) {
        held = { a: to.depth, b, bind: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: to.depth }, { binding: 2, resource: b }, { binding: 3, resource: { buffer: uniforms } }] }) }
        binds.set('last', held)
      }
      // The faced depth must be the picture's size: where it is not (none), the 1 x 1 is read at its corner only.
      device.queue.writeBuffer(uniforms, 0, new Float32Array([...view.eye, view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, time, ...view.forward, self.strength, to.size[0], to.size[1], 10, 0]))
      const pass = encoder.beginRenderPass({ label: 'fog', colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, held.bind)
      pass.draw(3)
      pass.end()
    },
  }
  return self
}
