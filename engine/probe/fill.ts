// Fill: what a lit pixel costs (#140). Whole-screen layers of the shading every drawer would
// do, added together so that a GPU which throws hidden layers away must still shade each one.
import { SHADE, shader, type Draw, type Gpu } from './gpu.ts'

const CODE = /* wgsl */ `
struct U { res: vec2f, layers: f32, pad: f32 }
@group(0) @binding(0) var<uniform> u: U;
${SHADE}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  let rd = normalize(vec3f(uv.x * u.res.x / u.res.y, -uv.y - 0.3, 1.5));
  let eye = vec3f(0.0, 3.0, 0.0);
  var col = sky(rd);
  if (rd.y < -0.001) {
    let t = -eye.y / rd.y;
    let p = eye + rd * t;
    let cell = floor(p * 10.0);
    let n = normalize(vec3f((hash3(cell + 1.0) - 0.5) * 0.2, 1.0, (hash3(cell + 2.0) - 0.5) * 0.2));
    col = lit(vec3f(0.62, 0.6, 0.56), cell, n, rd, 1.0, t);
  }
  return vec4f(tone(col) / u.layers, 1.0);
}
`

export async function fill(gpu: Gpu): Promise<{ draw(layers: number): Draw }> {
  const { device } = gpu
  const module = await shader(device, 'fill', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'fill', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }] },
  })
  const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
  return {
    draw: (layers) => (encoder, to, timing) => {
      device.queue.writeBuffer(uniforms, 0, new Float32Array([to.size[0], to.size[1], layers, 0]))
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], ...(timing ? { timestampWrites: timing } : {}) })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.draw(3, layers)
      pass.end()
    },
  }
}
