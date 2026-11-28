// The last pass (#163, #165): Linear HDR bloom (Karis-averaged luminance extraction into persistent
// quarter/sixteenth float targets) + Troy Sobotka AgX post-tonemapping + lens vignette, grade, tint, and rain.
// Backing bloom targets grow-only so dynamic resolution (`steer`) causes zero GPU texture reallocations.
import { shader, type Gpu, type Offscreen, GLOWS_OVER } from '../probe/gpu.ts'

/** Diagnostic tonemap override: `?tonemap=aces` selects Narkowicz ACES; default is AgX. */
const TONEMAP_ACES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tonemap') === 'aces'
/** Base scene exposure before AgX tonemapping: lifts sunlit daytime whites above 1.0 while keeping dusk/night depth. */
const DAY_EXPOSURE = 1.14
const NIGHT_EXPOSURE = 0.64

const codeOf = (useF16: boolean) => /* wgsl */ `${useF16 ? 'enable f16;\n' : ''}
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
@group(0) @binding(2) var spread: texture_2d<f32>;
struct U {
  step: vec2f,      // texel step (in bright/blur/down), or grade (sat, contrast) in last
  strength: f32,    // night factor in bright, bloom gain in plain/last
  pad: f32,         // drive energy (0..1) in last
  tint: vec4f,      // rgb realm tint, a = drift (-1..1) in last
  uvMax: vec2f,     // active sub-rect UV extent of picture
  uvClamp: vec2f,   // max safe sample UV inside picture's active sub-rect
  spreadMax: vec2f, // active sub-rect UV extent of spread (last)
  extra: vec2f,     // x = tonemap mode (0=AgX, 1=ACES), y = exposure
}
@group(0) @binding(3) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// Soft-knee bloom extraction in exposed linear HDR space.
fn softBloom(c: vec3f, threshold: f32, knee: f32) -> vec3f {
  let br = max(c.r, max(c.g, c.b));
  let soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  let rq = (soft * soft) / max(4.0 * knee, 1e-5);
  let contrib = max(rq, br - threshold) / max(br, 1e-5);
  return c * contrib;
}

// Karis-averaged 4-tap downsample from Linear HDR scene: extracts luminance > threshold with 1 / (1 + luma)
// weighting to suppress sub-pixel specular/lamp firefly flicker.
@fragment fn bright(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = u.step * 0.5;
  let hi = max(lo, u.uvClamp);
  let exposure = u.extra.y;
  let nightMask = min(u.strength * 1.45, 1.0);
  let threshold = mix(${GLOWS_OVER.toFixed(2)} * 2.35, 1.10, nightMask);
  let knee = 0.35;
  var sum = vec3f(0.0);
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let suv = clamp(base + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, lo, hi);
    let raw = max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0));
    let exposed = min(raw * exposure, vec3f(20.0));
    let rawBloom = softBloom(exposed, threshold, knee);
    let b = rawBloom / (1.0 + luma(rawBloom) * 0.05);
    let w = 1.0 / (1.0 + luma(b) * 0.08);
    sum += b * w;
    wSum += w;
  }
  return vec4f(sum / max(wSum, 1e-5), 1.0);
}

// Quarter-size downsample of the bloom pyramid (clamped inside active sub-rect).
@fragment fn down(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = u.step * 0.5;
  let hi = max(lo, u.uvClamp);
  ${useF16 ? 'var sum = vec3<f16>(0.0h);' : 'var sum = vec3f(0.0);'}
  for (var k = 0; k < 4; k++) {
    let suv = clamp(base + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, lo, hi);
    let c = min(max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0)), vec3f(60000.0));
    ${useF16 ? 'sum += vec3<f16>(c);' : 'sum += c;'}
  }
  return vec4f(vec3f(sum) * 0.25, 1.0);
}

// Upsample/add wide bloom onto near bloom.
@fragment fn plain(in: Out) -> @location(0) vec4f {
  let suv = clamp(in.uv * u.uvMax, vec2f(0.0), u.uvClamp);
  return vec4f(textureSampleLevel(picture, smooth_, suv, 0.0).rgb * u.strength, 1.0);
}

// Separable 9-tap Gaussian blur (5 bilinear taps), clamped inside the active sub-rect so unused texels never bleed.
@fragment fn blur(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = abs(u.step) * 0.5;
  let hi = max(lo, u.uvClamp);
  ${useF16
    ? `var sum = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0))) * 0.227h;
  for (var k = 1; k < 3; k++) {
    let off = u.step * select(3.2308, 1.3846, k == 1);
    let w = select(0.07h, 0.316h, k == 1);
    let a = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base + off, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0)));
    let b = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base - off, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0)));
    sum += (a + b) * w;
  }
  return vec4f(vec3f(sum), 1.0);`
    : `var sum = textureSampleLevel(picture, smooth_, clamp(base, lo, hi), 0.0).rgb * 0.227;
  for (var k = 1; k < 3; k++) {
    let off = u.step * select(3.2308, 1.3846, k == 1);
    let w = select(0.07, 0.316, k == 1);
    sum += (textureSampleLevel(picture, smooth_, clamp(base + off, lo, hi), 0.0).rgb + textureSampleLevel(picture, smooth_, clamp(base - off, lo, hi), 0.0).rgb) * w;
  }
  return vec4f(sum, 1.0);`}
}

// Troy Sobotka's AgX (fast 6th-order polynomial sigmoid with inset/outset matrices and subtle punchy look).
// Output is already sRGB display-encoded [0..1] (ready for bgra8unorm swapchain).
const AGX_INSET = mat3x3f(
  vec3f(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
  vec3f(0.0784335999999992, 0.878468636469772,  0.0784336),
  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);
const AGX_OUTSET = mat3x3f(
  vec3f( 1.19687900512017,   -0.0528968517574562, -0.0529716355144438),
  vec3f(-0.0980208811401368,  1.15190312990417,   -0.0980434501171241),
  vec3f(-0.0990297440797205, -0.0989611768448433,  1.15107367264116)
);
fn agxDefaultContrastApprox(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}
fn agxLook(val: vec3f) -> vec3f {
  // AgX Punchy CDL look (power 1.34, saturation 1.23): crisp sunlit contrast, airy sky hue, and deep night shadows without highlight hue skew.
  let v = pow(max(val, vec3f(0.0)), vec3f(1.34));
  let l = luma(v);
  return vec3f(l) + 1.23 * (v - vec3f(l));
}
fn tonemapAgX(color: vec3f) -> vec3f {
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var val = AGX_INSET * max(color, vec3f(0.0));
  val = clamp(log2(max(val, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  val = (val - minEv) / (maxEv - minEv);
  val = agxDefaultContrastApprox(val);
  val = agxLook(val);
  val = AGX_OUTSET * val;
  return clamp(val, vec3f(0.0), vec3f(1.0));
}
fn tonemapAces(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  let y = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(y, vec3f(0.4545));
}

@fragment fn last(in: Out) -> @location(0) vec4f {
  let d = in.uv - 0.5;
  let srcLo = vec2f(0.0005);
  let srcHi = max(srcLo, u.uvClamp);
  let sprHi = max(srcLo, u.spreadMax - vec2f(0.001));
  let baseUv = clamp(in.uv * u.uvMax, srcLo, srcHi);
  var c = max(textureSampleLevel(picture, smooth_, baseUv, 0.0).rgb, vec3f(0.0));

  // High-speed driving lens energy (u.pad = 0..1) and rotational/lateral drift blur (u.tint.a = -1..1).
  let energy = u.pad;
  let drift = u.tint.a;
  let driftMag = abs(drift);
  var blurVec = vec2f(0.0);
  if (energy > 0.001 || driftMag > 0.001) {
    let vp = vec2f(0.5, 0.44);
    let rd = in.uv - vp;
    let carD = (in.uv - vec2f(0.5, 0.72)) / vec2f(0.18, 0.20);
    let carMask = smoothstep(0.52, 1.38, dot(carD, carD));
    let sideRoad = smoothstep(0.45, 0.96, in.uv.y) * smoothstep(0.09, 0.28, abs(in.uv.x - 0.5));
    let radAmt = clamp((smoothstep(0.022, 0.34, dot(rd, rd)) + sideRoad * 0.72) * carMask * energy, 0.0, 1.35);
    let radVec = rd * radAmt * 0.052;
    let driftSign = select(-1.0, 1.0, drift >= 0.0);
    let driftBg = mix(0.65, 1.22, smoothstep(0.84, 0.18, in.uv.y)) * carMask * driftMag;
    let driftDir = vec2f(driftSign, rd.x * 0.14 * driftSign);
    let driftVec = driftDir * driftBg * 0.030;
    blurVec = radVec + driftVec;
    if (dot(blurVec, blurVec) > 1e-7) {
      var acc = c * 0.22;
      var wSum = 0.22;
      for (var k = 1; k <= 8; k++) {
        let t = f32(k) / 8.0;
        let w = (1.0 - t * 0.65) * 0.20;
        let off = blurVec * (t * 1.25 - 0.14);
        let suv = clamp((in.uv - off) * u.uvMax, srcLo, srcHi);
        acc += max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0)) * w;
        wSum += w;
      }
      c = acc / wSum;
      let ca = rd * radAmt * (1.0 - driftMag * 0.85) * 0.0022;
      c.r = mix(c.r, max(textureSampleLevel(picture, smooth_, clamp((in.uv + ca) * u.uvMax, srcLo, srcHi), 0.0).r, 0.0), 0.35);
      c.b = mix(c.b, max(textureSampleLevel(picture, smooth_, clamp((in.uv - ca) * u.uvMax, srcLo, srcHi), 0.0).b, 0.0), 0.35);
    }
  }

  // Expose scene into working HDR space, add linear HDR bloom, then vignette before tonemapping.
  var exposed = c * u.extra.y;
  var bloom = max(textureSampleLevel(spread, smooth_, clamp(in.uv * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
  if (driftMag > 0.04 || energy > 0.15) {
    let b1 = max(textureSampleLevel(spread, smooth_, clamp((in.uv - blurVec * 0.55) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    let b2 = max(textureSampleLevel(spread, smooth_, clamp((in.uv - blurVec * 1.10) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    bloom = bloom * 0.50 + b1 * 0.32 + b2 * 0.18;
  }
  exposed += bloom * u.strength;
  // Lens vignette in linear space (tightens subtly at high speed/drift).
  exposed *= max(0.0, 1.0 - dot(d, d) * (0.42 + max(energy, driftMag * 0.85) * 0.20));

  // Tonemap linear HDR -> sRGB display space (AgX default, ACES optional via ?tonemap=aces).
  var outCol = select(tonemapAgX(exposed), tonemapAces(exposed), u.extra.x > 0.5);

  // Hour-dependent subtle colour/contrast grade and realm tint.
  outCol = mix(vec3f(dot(outCol, vec3f(0.3, 0.59, 0.11))), outCol, u.step.x);
  outCol = mix(outCol, outCol * outCol * (3.0 - 2.0 * outCol), u.step.y);
  return vec4f(clamp(outCol * u.tint.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
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

const UNIFORM_BYTES = 64

/** Draws Linear HDR `from` to swapchain `to` with Karis-averaged luminance bloom, AgX tonemapping, and optional rain. */
export async function glow(gpu: Gpu): Promise<(encoder: GPUCommandEncoder, from: Offscreen, to: GPUTextureView, rain?: number, time?: number, grade?: readonly [number, number], night?: number, tint?: readonly [number, number, number], drive?: number, drift?: number) => void> {
  const { device } = gpu
  const module = await shader(device, 'glow', codeOf(gpu.canF16)), rainModule = await shader(device, 'rain', RAIN)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const make = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ label: `glow ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] } })
  const small: GPUTextureFormat = 'rgba16float'
  const [bright, blur, last, down] = await Promise.all([make('bright', small), make('blur', small), make('last', gpu.format), make('down', small)])
  const add = await device.createRenderPipelineAsync({ label: 'glow add', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'plain', targets: [{ format: small, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] }, primitive: { topology: 'triangle-list' } })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  const wet = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }] })
  const falling = await device.createRenderPipelineAsync({
    label: 'rain', layout: device.createPipelineLayout({ bindGroupLayouts: [wet] }), vertex: { module: rainModule, entryPoint: 'vs' },
    fragment: { module: rainModule, entryPoint: 'falling', targets: [{ format: gpu.format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  })
  const rainBlock = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const rainBind = device.createBindGroup({ layout: wet, entries: [{ binding: 0, resource: { buffer: rainBlock } }] })

  const blocks = Array.from({ length: 8 }, () => device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }))
  const scratch = new Float32Array(16)
  const writeU = (
    idx: number,
    stepX: number, stepY: number, strength: number, pad: number,
    tr: number, tg: number, tb: number, ta: number,
    uvMaxX: number, uvMaxY: number, uvClampX: number, uvClampY: number,
    spreadMaxX = 1, spreadMaxY = 1, extraX = 0, extraY = DAY_EXPOSURE,
  ) => {
    scratch[0] = stepX; scratch[1] = stepY; scratch[2] = strength; scratch[3] = pad
    scratch[4] = tr; scratch[5] = tg; scratch[6] = tb; scratch[7] = ta
    scratch[8] = uvMaxX; scratch[9] = uvMaxY; scratch[10] = uvClampX; scratch[11] = uvClampY
    scratch[12] = spreadMaxX; scratch[13] = spreadMaxY; scratch[14] = extraX; scratch[15] = extraY
    device.queue.writeBuffer(blocks[idx], 0, scratch)
  }

  // Persistent grow-only bloom pyramid: keyed on the source backing texture and its allocated size, so dynamic
  // resolution `steer` updates active sub-rect viewports & UVs with zero GPU texture or bind group churn.
  interface Kept {
    srcTexture: GPUTexture
    alloc: readonly [number, number]
    quarter: readonly [number, number]
    sixteenth: readonly [number, number]
    textures: GPUTexture[]
    views: GPUTextureView[]
    binds: GPUBindGroup[]
  }
  let kept: Kept | null = null
  const bind = (picture: GPUTextureView, spread: GPUTextureView, uniforms: GPUBuffer) =>
    device.createBindGroup({ layout, entries: [{ binding: 0, resource: picture }, { binding: 1, resource: sampler }, { binding: 2, resource: spread }, { binding: 3, resource: { buffer: uniforms } }] })

  const keep = (from: Offscreen): Kept => {
    const alloc = from.allocSize ?? from.size
    if (kept && kept.srcTexture === from.texture && alloc[0] <= kept.alloc[0] && alloc[1] <= kept.alloc[1]) return kept
    const needGrow = !kept || alloc[0] > kept.alloc[0] || alloc[1] > kept.alloc[1]
    const quarter: readonly [number, number] = needGrow
      ? [Math.max(1, Math.ceil(alloc[0] / 4)), Math.max(1, Math.ceil(alloc[1] / 4))]
      : kept!.quarter
    const sixteenth: readonly [number, number] = needGrow
      ? [Math.max(1, Math.ceil(quarter[0] / 4)), Math.max(1, Math.ceil(quarter[1] / 4))]
      : kept!.sixteenth
    let textures: GPUTexture[], views: GPUTextureView[]
    if (needGrow) {
      for (const t of kept?.textures ?? []) t.destroy()
      const makeTex = (size: readonly [number, number]) =>
        device.createTexture({ size: [size[0], size[1]], format: small, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      textures = [makeTex(quarter), makeTex(quarter), makeTex(sixteenth), makeTex(sixteenth)]
      views = textures.map((t) => t.createView())
    } else {
      textures = kept!.textures
      views = kept!.views
    }
    const binds = [
      bind(from.color, views[1], blocks[0]),
      bind(views[0], views[0], blocks[1]),
      bind(views[1], views[1], blocks[2]),
      bind(from.color, views[0], blocks[3]),
      bind(views[0], views[0], blocks[4]),
      bind(views[2], views[2], blocks[5]),
      bind(views[3], views[3], blocks[6]),
      bind(views[2], views[2], blocks[7]),
    ]
    kept = { srcTexture: from.texture, alloc: needGrow ? [alloc[0], alloc[1]] : kept!.alloc, quarter, sixteenth, textures, views, binds }
    return kept
  }

  const pass = (encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bg: GPUBindGroup, to: GPUTextureView, onto = false, viewport?: readonly [number, number]) => {
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: onto ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    if (viewport) {
      p.setViewport(0, 0, viewport[0], viewport[1], 0, 1)
      p.setScissorRect(0, 0, viewport[0], viewport[1])
    }
    p.setPipeline(pipeline)
    p.setBindGroup(0, bg)
    p.draw(3)
    p.end()
  }

  return (encoder, from, to, rain = 0, time = 0, grade = [1.25, 0.35], night = 0, tint = [1, 1, 1], drive = 0, drift = 0) => {
    const k = keep(from)
    const alloc = from.allocSize ?? from.size
    const srcW = from.size[0], srcH = from.size[1]
    const srcUvX = srcW / alloc[0], srcUvY = srcH / alloc[1]
    const srcStepX = 1 / alloc[0], srcStepY = 1 / alloc[1]

    const qW = Math.max(1, Math.min(k.quarter[0], Math.ceil(srcW / 4)))
    const qH = Math.max(1, Math.min(k.quarter[1], Math.ceil(srcH / 4)))
    const qUvX = qW / k.quarter[0], qUvY = qH / k.quarter[1]
    const qStepX = 1 / k.quarter[0], qStepY = 1 / k.quarter[1]
    const qActive: readonly [number, number] = [qW, qH]

    const dayCurve = Math.pow(Math.max(0, 1 - night), 1.8)
    const exposure = TONEMAP_ACES ? 0.43 : NIGHT_EXPOSURE + (DAY_EXPOSURE - NIGHT_EXPOSURE) * dayCurve
    const nightBloom = Math.min(1, night * 1.45)
    const bloomGain = 0.42 + nightBloom * 1.45

    // 0: bright extraction (Karis average) from active HDR scene sub-rect -> quarter[0]
    writeU(0, srcStepX, srcStepY, night, 0, 1, 1, 1, 1, srcUvX, srcUvY, Math.max(srcStepX * 0.5, srcUvX - srcStepX * 0.5), Math.max(srcStepY * 0.5, srcUvY - srcStepY * 0.5), 1, 1, 0, exposure)
    // 1, 2: separable blur on quarter[0] <-> quarter[1]
    writeU(1, qStepX, 0, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
    writeU(2, 0, qStepY, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
    // 3: final composite + AgX tonemap -> swapchain
    writeU(3, grade[0], grade[1], bloomGain, Math.max(0, Math.min(1, drive)), tint[0], tint[1], tint[2], Math.max(-1, Math.min(1, drift)), srcUvX, srcUvY, Math.max(srcStepX * 0.5, srcUvX - srcStepX * 0.5), Math.max(srcStepY * 0.5, srcUvY - srcStepY * 0.5), qUvX, qUvY, TONEMAP_ACES ? 1 : 0, exposure)

    pass(encoder, bright, k.binds[0], k.views[0], false, qActive)
    for (let twice = 0; twice < 2; twice++) {
      pass(encoder, blur, k.binds[1], k.views[1], false, qActive)
      pass(encoder, blur, k.binds[2], k.views[0], false, qActive)
    }
    if (night > 0) {
      const sW = Math.max(1, Math.min(k.sixteenth[0], Math.ceil(qW / 4)))
      const sH = Math.max(1, Math.min(k.sixteenth[1], Math.ceil(qH / 4)))
      const sUvX = sW / k.sixteenth[0], sUvY = sH / k.sixteenth[1]
      const sStepX = 1 / k.sixteenth[0], sStepY = 1 / k.sixteenth[1]
      const sActive: readonly [number, number] = [sW, sH]
      writeU(4, qStepX, qStepY, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
      writeU(5, sStepX, 0, 0, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      writeU(6, 0, sStepY, 0, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      writeU(7, 0, 0, 0.85, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      pass(encoder, down, k.binds[4], k.views[2], false, sActive)
      pass(encoder, blur, k.binds[5], k.views[3], false, sActive)
      pass(encoder, blur, k.binds[6], k.views[2], false, sActive)
      pass(encoder, add, k.binds[7], k.views[0], true, qActive)
    }
    pass(encoder, last, k.binds[3], to)
    if (rain > 0) {
      device.queue.writeBuffer(rainBlock, 0, new Float32Array([srcW, srcH, time, rain * 0.4]))
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'load', storeOp: 'store' }] })
      p.setPipeline(falling)
      p.setBindGroup(0, rainBind)
      p.draw(3)
      p.end()
    }
  }
}
