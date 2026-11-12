// The last pass (#163): the picture stretched to the screen, with a glow round what is bright in
// it (fire, the sun's edge, lamps, a white wall in the sun) and its corners a little darker.
// The glow is the bright part of the picture at a quarter of its size, spread twice, added back.
// Three small passes and the stretch: under half a millisecond at the sizes the page holds.
import { shader, type Gpu, type Offscreen } from '../probe/gpu.ts'

const CODE = /* wgsl */ `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
@group(0) @binding(2) var spread: texture_2d<f32>;
struct U { step: vec2f, strength: f32, pad: f32 }
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
@fragment fn bright(in: Out) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let c = textureSampleLevel(picture, smooth_, in.uv + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, 0.0).rgb;
    let most = max(c.r, max(c.g, c.b));
    sum += c * smoothstep(0.8, 1.0, most);
  }
  return vec4f(sum * 0.25, 1.0);
}
// Spread along one way: nine texels' worth in five looks.
@fragment fn blur(in: Out) -> @location(0) vec4f {
  var sum = textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb * 0.227;
  for (var k = 1; k < 3; k++) {
    let off = u.step * (f32(k) * 2.0 - 0.6);
    let w = select(0.07, 0.316, k == 1);
    sum += (textureSampleLevel(picture, smooth_, in.uv + off, 0.0).rgb + textureSampleLevel(picture, smooth_, in.uv - off, 0.0).rgb) * w;
  }
  return vec4f(sum, 1.0);
}
@fragment fn last(in: Out) -> @location(0) vec4f {
  var c = textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb + textureSampleLevel(spread, smooth_, in.uv, 0.0).rgb * u.strength;
  // The corners of the picture a little darker, as a lens leaves them.
  let d = in.uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.42;
  return vec4f(c, 1.0);
}
`

/** Draws `from` to the screen with its glow. Returns the pass to call each frame. */
export async function glow(gpu: Gpu): Promise<(encoder: GPUCommandEncoder, from: Offscreen, to: GPUTextureView) => void> {
  const { device } = gpu
  const module = await shader(device, 'glow', CODE)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const make = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ label: `glow ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] } })
  const small: GPUTextureFormat = 'rgba8unorm'
  const [bright, blur, last] = await Promise.all([make('bright', small), make('blur', small), make('last', gpu.format)])
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const block = (step: readonly [number, number], strength = 0) => {
    const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(b, 0, new Float32Array([step[0], step[1], strength, 0]))
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
    const quarter = [Math.max(1, from.size[0] >> 2), Math.max(1, from.size[1] >> 2)]
    const texture = () => device.createTexture({ size: quarter, format: small, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const textures = [texture(), texture()], views = textures.map((t) => t.createView())
    const blocks = [block([1 / from.size[0], 1 / from.size[1]]), block([1 / quarter[0], 0]), block([0, 1 / quarter[1]]), block([0, 0], 0.85)]
    const bind = (picture: GPUTextureView, spread: GPUTextureView, uniforms: GPUBuffer) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: picture }, { binding: 1, resource: sampler }, { binding: 2, resource: spread }, { binding: 3, resource: { buffer: uniforms } }] })
    kept = { from, textures, blocks, views, binds: [bind(from.color, views[1], blocks[0]), bind(views[0], views[0], blocks[1]), bind(views[1], views[1], blocks[2]), bind(from.color, views[0], blocks[3])] }
    return kept
  }
  const pass = (encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bind: GPUBindGroup, to: GPUTextureView) => {
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    p.setPipeline(pipeline)
    p.setBindGroup(0, bind)
    p.draw(3)
    p.end()
  }
  return (encoder, from, to) => {
    const k = keep(from)
    pass(encoder, bright, k.binds[0], k.views[0])
    pass(encoder, blur, k.binds[1], k.views[1])
    pass(encoder, blur, k.binds[2], k.views[0])
    pass(encoder, last, k.binds[3], to)
  }
}
