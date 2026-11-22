const CODE = `@group(0) @binding(0) var picture: texture_2d<f32>;
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
@fragment fn bright(in: Out) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let c = textureSampleLevel(picture, smooth_, in.uv + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, 0.0);
    let most = max(c.r, max(c.g, c.b));
    sum += c.rgb * (smoothstep(0.8, 1.0, most) + (1.0 - c.a) * u.strength * 10.0);
  }
  return vec4f(sum * 0.25, 1.0);
}
@fragment fn down(in: Out) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var k = 0; k < 4; k++) { sum += textureSampleLevel(picture, smooth_, in.uv + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, 0.0).rgb; }
  return vec4f(sum * 0.25, 1.0);
}
@fragment fn plain(in: Out) -> @location(0) vec4f { return vec4f(textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb * u.strength, 1.0); }
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
  var c = textureSampleLevel(picture, smooth_, in.uv, 0.0).rgb + textureSampleLevel(spread, smooth_, in.uv, 0.0).rgb * u.strength;
  let d = in.uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.42;
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  c = mix(vec3f(dot(c, vec3f(0.3, 0.59, 0.11))), c, u.step.x);
  c = mix(c, c * c * (3.0 - 2.0 * c), u.step.y);
  return vec4f(c * u.tint.rgb, 1.0);
}`;
async function glow(gpu) {
  const { device } = gpu;
  const module = device.createShaderModule({ code: CODE });
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} }
    ]
  });
  const make = (entryPoint, format) => device.createRenderPipelineAsync({ label: `glow ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint, targets: [{ format }] } });
  const small = "rgba16float";
  const [bright, blur, last, down] = await Promise.all([make("bright", small), make("blur", small), make("last", gpu.format), make("down", small)]);
  const add = await device.createRenderPipelineAsync({ label: "glow add", layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "plain", targets: [{ format: small, blend: { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "zero", dstFactor: "one" } } }] }, primitive: { topology: "triangle-list" } });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const block = (step, strength = 0) => {
    const b = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Float32Array([step[0], step[1], strength, 0, 1, 1, 1, 1]));
    return b;
  };
  let kept = null;
  const keep = (from) => {
    if (kept?.from === from) return kept;
    for (const t of kept?.textures ?? []) t.destroy();
    for (const b of kept?.blocks ?? []) b.destroy();
    const quarter = [Math.max(1, from.size[0] >> 2), Math.max(1, from.size[1] >> 2)], sixteenth = [Math.max(1, quarter[0] >> 2), Math.max(1, quarter[1] >> 2)];
    const texture = (size) => device.createTexture({ size, format: small, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const textures = [texture(quarter), texture(quarter), texture(sixteenth), texture(sixteenth)], views = textures.map((t) => t.createView());
    const blocks = [block([1 / from.size[0], 1 / from.size[1]]), block([1 / quarter[0], 0]), block([0, 1 / quarter[1]]), block([0, 0], 1), block([1 / quarter[0], 1 / quarter[1]]), block([1 / sixteenth[0], 0]), block([0, 1 / sixteenth[1]]), block([0, 0], 0.8)];
    const bind = (picture, spread, uniforms) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: picture }, { binding: 1, resource: sampler }, { binding: 2, resource: spread }, { binding: 3, resource: { buffer: uniforms } }] });
    kept = { from, textures, blocks, views, binds: [bind(from.color, views[1], blocks[0]), bind(views[0], views[0], blocks[1]), bind(views[1], views[1], blocks[2]), bind(from.color, views[0], blocks[3]), bind(views[0], views[0], blocks[4]), bind(views[2], views[2], blocks[5]), bind(views[3], views[3], blocks[6]), bind(views[2], views[2], blocks[7])] };
    return kept;
  };
  const pass = (encoder, pipeline, bind, to, onto = false) => {
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: onto ? "load" : "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    p.setPipeline(pipeline);
    p.setBindGroup(0, bind);
    p.draw(3);
    p.end();
  };
  return (encoder, from, to, rain = 0, time = 0, grade = [1.25, 0.35], night = 0, tint = [1, 1, 1]) => {
    const k = keep(from);
    device.queue.writeBuffer(k.blocks[0], 0, new Float32Array([1 / from.size[0], 1 / from.size[1], night, 0]));
    device.queue.writeBuffer(k.blocks[3], 0, new Float32Array([grade[0], grade[1], 1, 0, tint[0], tint[1], tint[2], 1]));
    pass(encoder, bright, k.binds[0], k.views[0]);
    for (let twice = 0; twice < 2; twice++) {
      pass(encoder, blur, k.binds[1], k.views[1]);
      pass(encoder, blur, k.binds[2], k.views[0]);
    }
    if (night > 0) {
      pass(encoder, down, k.binds[4], k.views[2]);
      pass(encoder, blur, k.binds[5], k.views[3]);
      pass(encoder, blur, k.binds[6], k.views[2]);
      pass(encoder, add, k.binds[7], k.views[0], true);
    }
    pass(encoder, last, k.binds[3], to);
  };
}
export {
  glow
};
