// The last pass (#163): the picture stretched to the screen, with a glow round what is bright in
// it (fire, the sun's edge, lamps, a white wall in the sun) and its corners a little darker.
// The glow is the bright part of the picture at a quarter of its size, spread twice, added back.
// Three small passes and the stretch: under half a millisecond at the sizes the page holds.
import { shader, type Gpu, type Offscreen, GLOWS_OVER } from '../probe/gpu.ts'

const CODE = /* wgsl */ `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
@group(0) @binding(2) var spread: texture_2d<f32>;
struct U { step: vec2f, strength: f32, pad: f32, tint: vec4f }
@group(0) @binding(3) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
// What is bright enough to glow: over 0.8 of full, and the more the brighter. Four looks, each the mean of four texels.
// At night (u.strength here is how far it is night) a lamp, a sign or a fire glows by how far brighter than a lit
// surface it is, which the marcher left in the picture's alpha as one less that.
@fragment fn bright(in: Out) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let c = textureSampleLevel(picture, smooth_, in.uv + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, 0.0);
    let most = max(c.r, max(c.g, c.b));
    sum += c.rgb * (smoothstep(${GLOWS_OVER}, 1.0, most) + (1.0 - c.a) * u.strength * 10.0);
  }
  return vec4f(sum * 0.25, 1.0);
}
// A quarter of the size again: four looks, each the mean of four texels, so no texel is passed over.
@fragment fn down(in: Out) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) { sum += textureSampleLevel(picture, smooth_, in.uv + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, 0.0).rgb; }
  return vec4f(sum * 0.25, 1.0);
}
// As it is, times a strength: for adding the wide spread onto the near one.
@fragment fn plain(in: Out) -> @location(0) vec4f { return vec4f(textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb * u.strength, 1.0); }
// Spread along one way: nine texels' worth in five looks, each between two texels so that none is passed over (a
// lamp is a few texels far brighter than white: with looks further apart it came out as a grid of its own ghosts).
@fragment fn blur(in: Out) -> @location(0) vec4f {
  var sum = textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb * 0.227;
  for (var k = 1; k < 3; k++) {
    let off = u.step * select(3.2308, 1.3846, k == 1);
    let w = select(0.07, 0.316, k == 1);
    sum += (textureSampleLevel(picture, smooth_, in.uv + off, 0.0).rgb + textureSampleLevel(picture, smooth_, in.uv - off, 0.0).rgb) * w;
  }
  return vec4f(sum, 1.0);
}
@fragment fn last(in: Out) -> @location(0) vec4f {
  let d = in.uv - 0.5;
  var c = textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb;
  // High-speed driving lens energy (u.pad = 0..1): subtle peripheral radial streak + edge chroma while keeping center crisp.
  if (u.pad > 0.001) {
    let r2 = dot(d, d);
    let edge = smoothstep(0.05, 0.42, r2) * u.pad;
    let streak = d * edge * 0.036;
    let s1 = textureSampleLevel(picture, smooth_, clamp(in.uv - streak * 0.5, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
    let s2 = textureSampleLevel(picture, smooth_, clamp(in.uv - streak, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
    let s3 = textureSampleLevel(picture, smooth_, clamp(in.uv - streak * 1.5, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
    c = c * 0.46 + s1 * 0.27 + s2 * 0.17 + s3 * 0.10;
    let ca = d * edge * 0.008;
    c.r = mix(c.r, textureSampleLevel(picture, smooth_, clamp(in.uv + ca, vec2f(0.001), vec2f(0.999)), 0.0).r, 0.55);
    c.b = mix(c.b, textureSampleLevel(picture, smooth_, clamp(in.uv - ca, vec2f(0.001), vec2f(0.999)), 0.0).b, 0.55);
  }
  c += textureSampleLevel(spread, smooth_, in.uv, 0.0).rgb * u.strength;
  // The corners of the picture a little darker, as a lens leaves them (tightening subtly at high speed).
  c *= 1.0 - dot(d, d) * (0.42 + u.pad * 0.16);
  // The grade, which follows the hour (u.step here is how much colour, how much contrast). With the sun low and at
  // night, more of both than the tone curve leaves: that is what made the sunset. By day, a little less colour and
  // nearly no more contrast: with the evening's grade a street by day was called bright and toy-coloured by every
  // judge who saw it, and the same pictures with the grade undone sat beside the films' far better.
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  c = mix(vec3f(dot(c, vec3f(0.3, 0.59, 0.11))), c, u.step.x);
  c = mix(c, c * c * (3.0 - 2.0 * c), u.step.y);
  // A realm's own tint (#264), over the graded picture: white leaves it as it is.
  return vec4f(c * u.tint.rgb, 1.0);
}
`

const RAIN = /* wgsl */ `
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
// Rain: streaks falling down the picture, two sizes of them, a little aslant. Drawn over the finished picture, and
// only while it rains: in the marcher's own shader, behind a test of whether it rains, it cost every dry frame
// 2 ms (the test was done away with and the streaks worked out for every pixel).
struct Rain { size: vec2f, time: f32, strength: f32 }
@group(0) @binding(0) var<uniform> rain: Rain;
fn chance(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
@fragment fn falling(in: Out) -> @location(0) vec4f {
  let uv = in.uv * vec2f(rain.size.x / rain.size.y, 1.0);
  var fall = 0.0;
  for (var layer = 0; layer < 2; layer++) {
    let across = (uv.x + uv.y * 0.07) * (110.0 + 90.0 * f32(layer));
    let h = chance(vec2i(i32(floor(across)), layer + 3));
    let along = fract(uv.y * (1.1 + 0.6 * h) - rain.time * (2.4 + 1.6 * h) + h * 9.0);
    fall += step(0.55, fract(h * 13.0)) * smoothstep(0.1, 0.0, along) * smoothstep(0.5, 0.2, abs(fract(across) - 0.5));
  }
  return vec4f(vec3f(0.55, 0.62, 0.72) * fall * rain.strength, 0.0);
}
`

/** Draws `from` to the screen with its glow, and rain over it when `rain` (0 to 1, times how light it is) is not 0. `grade` is how much colour and how much contrast the hour asks for; `tint` is what the finished picture is multiplied by; `drive` (0 to 1) adds high-speed radial lens energy while driving. Returns the pass to call each frame. */
export async function glow(gpu: Gpu): Promise<(encoder: GPUCommandEncoder, from: Offscreen, to: GPUTextureView, rain?: number, time?: number, grade?: readonly [number, number], night?: number, tint?: readonly [number, number, number], drive?: number) => void> {
  const { device } = gpu
  const module = await shader(device, 'glow', CODE), rainModule = await shader(device, 'rain', RAIN)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const make = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ label: `glow ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] } })
  // Kept as floats: a lamp is a few texels many times brighter than white, and spread wide it must still show.
  const small: GPUTextureFormat = 'rgba16float'
  const [bright, blur, last, down] = await Promise.all([make('bright', small), make('blur', small), make('last', gpu.format), make('down', small)])
  const add = await device.createRenderPipelineAsync({ label: 'glow add', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'plain', targets: [{ format: small, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] }, primitive: { topology: 'triangle-list' } })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  // The rain has a pipeline of its own, added onto the picture; its module is the same code with only its own binding used.
  const wet = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }] })
  const falling = await device.createRenderPipelineAsync({
    label: 'rain', layout: device.createPipelineLayout({ bindGroupLayouts: [wet] }), vertex: { module: rainModule, entryPoint: 'vs' },
    fragment: { module: rainModule, entryPoint: 'falling', targets: [{ format: gpu.format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  })
  const rainBlock = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const rainBind = device.createBindGroup({ layout: wet, entries: [{ binding: 0, resource: { buffer: rainBlock } }] })
  const block = (step: readonly [number, number], strength = 0) => {
    const b = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(b, 0, new Float32Array([step[0], step[1], strength, 0, 1, 1, 1, 1]))
    return b
  }
  // What is kept for the picture as it now is: two quarter-size textures and the four passes' bindings. The picture
  // is a new one whenever its size changes, and that is often: what was kept for the last is thrown away then.
  interface Kept { from: Offscreen; textures: GPUTexture[]; blocks: GPUBuffer[]; binds: GPUBindGroup[]; views: GPUTextureView[] }
  let kept: Kept | null = null
  const keep = (from: Offscreen): Kept => {
    if (kept?.from === from) return kept
    for (const t of kept?.textures ?? []) t.destroy()
    for (const b of kept?.blocks ?? []) b.destroy()
    const quarter = [Math.max(1, from.size[0] >> 2), Math.max(1, from.size[1] >> 2)], sixteenth = [Math.max(1, quarter[0] >> 2), Math.max(1, quarter[1] >> 2)]
    const texture = (size: number[]) => device.createTexture({ size, format: small, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    // Two at a quarter of the picture's size for the near glow; two at a sixteenth for the night's wide one: a lamp
    // in wet air has a halo many times its own size.
    const textures = [texture(quarter), texture(quarter), texture(sixteenth), texture(sixteenth)], views = textures.map((t) => t.createView())
    const blocks = [block([1 / from.size[0], 1 / from.size[1]]), block([1 / quarter[0], 0]), block([0, 1 / quarter[1]]), block([0, 0], 1.0), block([1 / quarter[0], 1 / quarter[1]]), block([1 / sixteenth[0], 0]), block([0, 1 / sixteenth[1]]), block([0, 0], 0.8)]
    const bind = (picture: GPUTextureView, spread: GPUTextureView, uniforms: GPUBuffer) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: picture }, { binding: 1, resource: sampler }, { binding: 2, resource: spread }, { binding: 3, resource: { buffer: uniforms } }] })
    kept = { from, textures, blocks, views, binds: [bind(from.color, views[1], blocks[0]), bind(views[0], views[0], blocks[1]), bind(views[1], views[1], blocks[2]), bind(from.color, views[0], blocks[3]), bind(views[0], views[0], blocks[4]), bind(views[2], views[2], blocks[5]), bind(views[3], views[3], blocks[6]), bind(views[2], views[2], blocks[7])] }
    return kept
  }
  const pass = (encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bind: GPUBindGroup, to: GPUTextureView, onto = false) => {
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: onto ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    p.setPipeline(pipeline)
    p.setBindGroup(0, bind)
    p.draw(3)
    p.end()
  }
  return (encoder, from, to, rain = 0, time = 0, grade = [1.25, 0.35], night = 0, tint = [1, 1, 1], drive = 0) => {
    const k = keep(from)
    device.queue.writeBuffer(k.blocks[0], 0, new Float32Array([1 / from.size[0], 1 / from.size[1], night, 0]))
    device.queue.writeBuffer(k.blocks[3], 0, new Float32Array([grade[0], grade[1], 1.0, Math.max(0, Math.min(1, drive)), tint[0], tint[1], tint[2], 1]))
    pass(encoder, bright, k.binds[0], k.views[0])
    // Twice over: the looks are close together, and once is too narrow a glow.
    for (let twice = 0; twice < 2; twice++) {
      pass(encoder, blur, k.binds[1], k.views[1])
      pass(encoder, blur, k.binds[2], k.views[0])
    }
    if (night > 0) {
      // The wide glow: the near one made a quarter of its size again, spread there, and added back onto it.
      pass(encoder, down, k.binds[4], k.views[2])
      pass(encoder, blur, k.binds[5], k.views[3])
      pass(encoder, blur, k.binds[6], k.views[2])
      pass(encoder, add, k.binds[7], k.views[0], true)
    }
    pass(encoder, last, k.binds[3], to)
    if (rain > 0) {
      device.queue.writeBuffer(rainBlock, 0, new Float32Array([from.size[0], from.size[1], time, rain * 0.4]))
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'load', storeOp: 'store' }] })
      p.setPipeline(falling)
      p.setBindGroup(0, rainBind)
      p.draw(3)
      p.end()
    }
  }
}
