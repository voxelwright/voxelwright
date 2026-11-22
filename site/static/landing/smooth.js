const CODE = `@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(picture));
  let m = textureSampleLevel(picture, smooth_, in.uv, 0.0);
  let nw = luma(textureSampleLevel(picture, smooth_, in.uv + vec2f(-0.5, -0.5) * texel, 0.0).rgb);
  let ne = luma(textureSampleLevel(picture, smooth_, in.uv + vec2f(0.5, -0.5) * texel, 0.0).rgb);
  let sw = luma(textureSampleLevel(picture, smooth_, in.uv + vec2f(-0.5, 0.5) * texel, 0.0).rgb);
  let se = luma(textureSampleLevel(picture, smooth_, in.uv + vec2f(0.5, 0.5) * texel, 0.0).rgb);
  let mid = luma(m.rgb);
  let least = min(mid, min(min(nw, ne), min(sw, se)));
  let most = max(mid, max(max(nw, ne), max(sw, se)));
  if (most - least < max(0.04, most * 0.1)) { return m; }
  var dir = vec2f(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), vec2f(-8.0), vec2f(8.0)) * texel;
  let a = 0.5 * (textureSampleLevel(picture, smooth_, in.uv + dir * (1.0 / 3.0 - 0.5), 0.0) + textureSampleLevel(picture, smooth_, in.uv + dir * (2.0 / 3.0 - 0.5), 0.0));
  let b = a * 0.5 + 0.25 * (textureSampleLevel(picture, smooth_, in.uv - dir * 0.5, 0.0) + textureSampleLevel(picture, smooth_, in.uv + dir * 0.5, 0.0));
  let wide = luma(b.rgb);
  if (wide < least || wide > most) { return a; }
  return b;
}`;
async function smooth(gpu) {
  const { device } = gpu;
  const module = device.createShaderModule({ code: CODE });
  const pipeline = await device.createRenderPipelineAsync({ label: "smooth", layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format: gpu.format }] } });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  let kept = null;
  return (encoder, from, to, timing) => {
    if (kept?.from !== from) kept = { from, bind: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: from.color }, { binding: 1, resource: sampler }] }) };
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], ...timing ? { timestampWrites: timing } : {} });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, kept.bind);
    pass.draw(3);
    pass.end();
  };
}
export {
  smooth
};
