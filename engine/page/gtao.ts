// Standalone WebGPU compute Ground-Truth Ambient Occlusion (GTAO, Jimenez 2016 / XeGTAO) (#165).
//
// Three-pass compute pipeline designed for zero per-frame allocations and zero reallocations across
// dynamic resolution scale changes (steer):
//   Pass 1: Depth Prefilter / 5-mip Hi-Z linear depth pyramid (r32float, depth-weighted downsample)
//           split across 1A (mips 0..3 in shared memory, 4 storage bindings) and 1B (mip 4) so it
//           stays within WebGPU's baseline maxStorageTexturesPerShaderStage = 4 limit.
//   Pass 2: Horizon-Based GTAO compute with spatio-temporal Hilbert + R2 blue-noise slice rotation,
//           exact cosine-weighted horizon integration (IntegrateArc) normalized by the analytic
//           open-hemisphere integral, thin-occluder falloff, and optional depth-derived normals.
//   Pass 3: Edge-preserving 3x3 depth + normal bilateral spatial denoiser into a persistent
//           rgba16float target (.r = AO, .g = linear depth edge key, .ba = view normal XY).
import { FAR, NEAR, shader } from '../probe/gpu.ts'

/** Jimenez 2016 multi-bounce ambient occlusion approximation for downstream lighting shaders. */
export const GTAO_WGSL = /* wgsl */ `
fn gtaoMultiBounce(visibility: f32, albedo: vec3f) -> vec3f {
  let a = 2.0404 * albedo - vec3f(0.3324);
  let b = -4.7951 * albedo + vec3f(0.6417);
  let c = 2.7552 * albedo + vec3f(0.6903);
  let x = clamp(visibility, 0.0, 1.0);
  return max(vec3f(x), ((x * a + b) * x + c) * x);
}
`

export interface GtaoProjParams {
  /** Tangent of half the vertical field of view (`camera.tanHalf`). */
  tanHalfFovY: number
  /** Active viewport aspect ratio (`width / height`). Defaults to `renderSize[0] / renderSize[1]`. */
  aspect?: number
  /** Near clip distance in world units (cells). Defaults to `NEAR` (1). */
  near?: number
  /** Far clip distance in world units (cells). Defaults to `FAR` (100000). */
  far?: number
  /** World-space camera right vector, used when `normalSpace === 'world'`. */
  right?: readonly [number, number, number]
  /** World-space camera up vector, used when `normalSpace === 'world'`. */
  up?: readonly [number, number, number]
  /** World-space camera forward vector, used when `normalSpace === 'world'`. */
  forward?: readonly [number, number, number]
}

export interface GtaoTimestampWrites {
  prefilter0?: GPUComputePassTimestampWrites
  prefilter4?: GPUComputePassTimestampWrites
  gtao?: GPUComputePassTimestampWrites
  denoise?: GPUComputePassTimestampWrites
}

export interface GtaoDispatchOptions {
  /** Scene depth texture view (`depth24plus` or compatible `texture_depth_2d`). */
  depth: GPUTextureView
  /** Optional scene normal texture view (`rgba8snorm`, `rgba16float`, or `rgba8unorm`). Reconstructed from depth when omitted. */
  normal?: GPUTextureView
  /** Coordinate space of `normal`. Default `'view'` (right-handed: +X right, +Y up, +Z toward eye). */
  normalSpace?: 'view' | 'world'
  /** Channel encoding of `normal`. Default `'snorm'` (values already in `[-1, 1]`, e.g. `rgba8snorm`/`rgba16float`). */
  normalEncoding?: 'snorm' | 'unorm'
  /** Active sub-viewport size `[width, height]` rendered inside the depth texture. */
  renderSize: readonly [number, number]
  /** Physical allocation size `[width, height]` of the input depth/normal textures. */
  allocSize: readonly [number, number]
  /** Camera projection and optional basis parameters. */
  projParams: GtaoProjParams
  /** World-space occlusion radius (cells; 1 cell = 0.1 m). Default `12.0`. */
  radius?: number
  /** Final AO contrast exponent (`pow(ao, power)`). Default `1.0`. */
  power?: number
  /** Fraction of `radius` over which thin/distant occluders fade out (`[0.05, 1.0]`). Default `0.5`. */
  falloffRange?: number
  /** Maximum horizon search radius in full-res pixels. Default `128`. */
  maxScreenRadius?: number
  /** Number of horizon slice pairs per pixel. Default `2`. */
  slices?: number
  /** Number of horizon steps per side per slice. Default `3`. */
  steps?: number
  /** Monotonic frame counter seeding spatio-temporal Hilbert + R2 rotation. Default `0`. */
  frameIndex?: number
  /** When `true`, computes and denoises AO at half resolution (`ceil(renderSize / 2)`). Default `false`. */
  halfRes?: boolean
  /** Optional per-pass WebGPU timestamp query writes. */
  timestampWrites?: GtaoTimestampWrites
}

export interface GtaoStats {
  maxSize: readonly [number, number]
  renderSize: readonly [number, number]
  aoSize: readonly [number, number]
  halfRes: boolean
  reallocs: number
  dispatches: number
  mips: number
}

export interface GtaoPass {
  /** Persistent denoised AO texture (`rgba16float`: `.r` = AO, `.g` = linear depth, `.ba` = view normal XY). */
  readonly texture: GPUTexture
  /** Default view of `texture`. */
  readonly view: GPUTextureView
  /** Persistent pre-denoise GTAO texture (`rgba16float`). */
  readonly rawTexture: GPUTexture
  /** Persistent 5-mip linear depth pyramid (`r32float`). */
  readonly depthPyramid: GPUTexture
  /** Encodes the 3-stage GTAO compute pipeline and returns the denoised AO `GPUTextureView`. */
  dispatch(encoder: GPUCommandEncoder, options: GtaoDispatchOptions): GPUTextureView
  /** Reports active dimensions, half-res mode, dispatch count, and reallocation count. */
  stats(): GtaoStats
  /** Releases all GPU resources owned by this pass. */
  destroy(): void
}

const UNIFORM_BYTES = 144
const MIP_COUNT = 5

const UNIFORMS_WGSL = /* wgsl */ `
struct GtaoUniforms {
  renderSize: vec2f,
  allocSize: vec2f,
  aoSize: vec2f,
  invRenderSize: vec2f,
  tanHalf: vec2f,
  clipRange: vec2f,
  params0: vec4f, // x=radius, y=power, z=falloffRange, w=maxScreenRadius
  params1: vec4u, // x=frameIndex, y=isHalfRes, z=normalFlags (bit0=world, bit1=unorm), w=sliceCount
  params2: vec4u, // x=stepsPerSide, y=maxMip, z=mip4W, w=mip4H
  camRight: vec4f,
  camUp: vec4f,
  camForward: vec4f,
}
`

const PREFILTER_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: GtaoUniforms;
@group(0) @binding(1) var rawDepth: texture_depth_2d;
@group(0) @binding(2) var outMip0: texture_storage_2d<r32float, write>;
@group(0) @binding(3) var outMip1: texture_storage_2d<r32float, write>;
@group(0) @binding(4) var outMip2: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var outMip3: texture_storage_2d<r32float, write>;

var<workgroup> scratch: array<f32, 64>;

fn linearizeDepth(d: f32) -> f32 {
  let nearZ = u.clipRange.x;
  let farZ = u.clipRange.y;
  let ratio = (farZ - nearZ) / farZ;
  let denom = max(1.0 - clamp(d, 0.0, 1.0) * ratio, nearZ / farZ);
  return min(nearZ / denom, farZ);
}

fn loadLinearRaw(coord: vec2i) -> f32 {
  let maxCoord = max(vec2i(u.renderSize) - vec2i(1), vec2i(0));
  let c = clamp(coord, vec2i(0), maxCoord);
  return linearizeDepth(textureLoad(rawDepth, c, 0));
}

// XeGTAO-style depth-weighted 2x2 downsample: anchors weights to the farthest depth in the quad so
// foreground silhouettes never blend with distant backgrounds into phantom mid-air depths.
fn blendDepth4(d0: f32, d1: f32, d2: f32, d3: f32) -> f32 {
  let maxD = max(max(d0, d1), max(d2, d3));
  let span = max(u.params0.x * 0.65, maxD * 0.08);
  let invSpan = 1.0 / max(span, 1e-4);
  let w0 = clamp(1.0 - (maxD - d0) * invSpan, 0.0001, 1.0);
  let w1 = clamp(1.0 - (maxD - d1) * invSpan, 0.0001, 1.0);
  let w2 = clamp(1.0 - (maxD - d2) * invSpan, 0.0001, 1.0);
  let w3 = clamp(1.0 - (maxD - d3) * invSpan, 0.0001, 1.0);
  return (d0 * w0 + d1 * w1 + d2 * w2 + d3 * w3) / (w0 + w1 + w2 + w3);
}

@compute @workgroup_size(8, 8, 1)
fn prefilter0to3(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
) {
  let lx = lid.x;
  let ly = lid.y;
  let m1 = vec2u(wg.x * 8u + lx, wg.y * 8u + ly);
  let base0 = vec2i(m1 * 2u);

  let d00 = loadLinearRaw(base0 + vec2i(0, 0));
  let d10 = loadLinearRaw(base0 + vec2i(1, 0));
  let d01 = loadLinearRaw(base0 + vec2i(0, 1));
  let d11 = loadLinearRaw(base0 + vec2i(1, 1));

  let dim0 = vec2i(textureDimensions(outMip0));
  let lim0 = min(vec2i(u.renderSize), dim0);
  if (base0.x < lim0.x && base0.y < lim0.y) { textureStore(outMip0, base0, vec4f(d00, 0.0, 0.0, 0.0)); }
  if (base0.x + 1 < lim0.x && base0.y < lim0.y) { textureStore(outMip0, base0 + vec2i(1, 0), vec4f(d10, 0.0, 0.0, 0.0)); }
  if (base0.x < lim0.x && base0.y + 1 < lim0.y) { textureStore(outMip0, base0 + vec2i(0, 1), vec4f(d01, 0.0, 0.0, 0.0)); }
  if (base0.x + 1 < lim0.x && base0.y + 1 < lim0.y) { textureStore(outMip0, base0 + vec2i(1, 1), vec4f(d11, 0.0, 0.0, 0.0)); }

  let dm1 = blendDepth4(d00, d10, d01, d11);
  let dim1 = vec2i(textureDimensions(outMip1));
  let lim1 = min(vec2i(vec2u((u32(u.renderSize.x) + 1u) >> 1u, (u32(u.renderSize.y) + 1u) >> 1u)), dim1);
  if (i32(m1.x) < lim1.x && i32(m1.y) < lim1.y) {
    textureStore(outMip1, vec2i(m1), vec4f(dm1, 0.0, 0.0, 0.0));
  }
  scratch[ly * 8u + lx] = dm1;
  workgroupBarrier();

  if ((lx & 1u) == 0u && (ly & 1u) == 0u) {
    let a00 = scratch[ly * 8u + lx];
    let a10 = scratch[ly * 8u + lx + 1u];
    let a01 = scratch[(ly + 1u) * 8u + lx];
    let a11 = scratch[(ly + 1u) * 8u + lx + 1u];
    let dm2 = blendDepth4(a00, a10, a01, a11);
    let m2 = vec2i(m1 >> vec2u(1u));
    let dim2 = vec2i(textureDimensions(outMip2));
    let lim2 = min(vec2i(vec2u((u32(u.renderSize.x) + 3u) >> 2u, (u32(u.renderSize.y) + 3u) >> 2u)), dim2);
    if (m2.x < lim2.x && m2.y < lim2.y) {
      textureStore(outMip2, m2, vec4f(dm2, 0.0, 0.0, 0.0));
    }
    scratch[ly * 8u + lx] = dm2;
  }
  workgroupBarrier();

  if ((lx & 3u) == 0u && (ly & 3u) == 0u) {
    let b00 = scratch[ly * 8u + lx];
    let b10 = scratch[ly * 8u + lx + 2u];
    let b01 = scratch[(ly + 2u) * 8u + lx];
    let b11 = scratch[(ly + 2u) * 8u + lx + 2u];
    let dm3 = blendDepth4(b00, b10, b01, b11);
    let m3 = vec2i(m1 >> vec2u(2u));
    let dim3 = vec2i(textureDimensions(outMip3));
    let lim3 = min(vec2i(vec2u((u32(u.renderSize.x) + 7u) >> 3u, (u32(u.renderSize.y) + 7u) >> 3u)), dim3);
    if (m3.x < lim3.x && m3.y < lim3.y) {
      textureStore(outMip3, m3, vec4f(dm3, 0.0, 0.0, 0.0));
    }
  }
}
`

const PREFILTER4_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: GtaoUniforms;
@group(0) @binding(1) var inMip3: texture_2d<f32>;
@group(0) @binding(2) var outMip4: texture_storage_2d<r32float, write>;

fn blendDepth4(d0: f32, d1: f32, d2: f32, d3: f32) -> f32 {
  let maxD = max(max(d0, d1), max(d2, d3));
  let span = max(u.params0.x * 0.65, maxD * 0.08);
  let invSpan = 1.0 / max(span, 1e-4);
  let w0 = clamp(1.0 - (maxD - d0) * invSpan, 0.0001, 1.0);
  let w1 = clamp(1.0 - (maxD - d1) * invSpan, 0.0001, 1.0);
  let w2 = clamp(1.0 - (maxD - d2) * invSpan, 0.0001, 1.0);
  let w3 = clamp(1.0 - (maxD - d3) * invSpan, 0.0001, 1.0);
  return (d0 * w0 + d1 * w1 + d2 * w2 + d3 * w3) / (w0 + w1 + w2 + w3);
}

@compute @workgroup_size(8, 8, 1)
fn prefilter4(@builtin(global_invocation_id) gid: vec3u) {
  let m4 = vec2i(gid.xy);
  let dim4 = vec2i(textureDimensions(outMip4));
  let lim4 = min(vec2i(i32(u.params2.z), i32(u.params2.w)), dim4);
  if (m4.x >= lim4.x || m4.y >= lim4.y) { return; }

  let dim3 = vec2i(textureDimensions(inMip3));
  let lim3 = min(vec2i(vec2u((u32(u.renderSize.x) + 7u) >> 3u, (u32(u.renderSize.y) + 7u) >> 3u)), dim3);
  let max3 = max(lim3 - vec2i(1), vec2i(0));
  let base3 = m4 * 2;
  let d00 = textureLoad(inMip3, clamp(base3 + vec2i(0, 0), vec2i(0), max3), 0).x;
  let d10 = textureLoad(inMip3, clamp(base3 + vec2i(1, 0), vec2i(0), max3), 0).x;
  let d01 = textureLoad(inMip3, clamp(base3 + vec2i(0, 1), vec2i(0), max3), 0).x;
  let d11 = textureLoad(inMip3, clamp(base3 + vec2i(1, 1), vec2i(0), max3), 0).x;
  let dm4 = blendDepth4(d00, d10, d01, d11);
  textureStore(outMip4, m4, vec4f(dm4, 0.0, 0.0, 0.0));
}
`

const HORIZON_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}

override HAS_NORMAL: bool = false;

@group(0) @binding(0) var<uniform> u: GtaoUniforms;
@group(0) @binding(1) var depthPyr: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var outRawAo: texture_storage_2d<rgba16float, write>;

const PI: f32 = 3.14159265359;
const HALF_PI: f32 = 1.57079632679;

// Fast XeGTAO acos approximation (exact at 0 and +-1, max error < 0.00007 rad).
fn fastAcos(inX: f32) -> f32 {
  let x = clamp(inX, -1.0, 1.0);
  let ax = abs(x);
  var res = -0.156583 * ax + HALF_PI;
  res *= sqrt(max(1.0 - ax, 0.0));
  return select(PI - res, res, x >= 0.0);
}

fn viewPosFast(px: vec2f, linearZ: f32, ndcScale: vec2f, ndcBias: vec2f) -> vec3f {
  return vec3f((px * ndcScale + ndcBias) * linearZ, -linearZ);
}

fn loadDepthMip0(coord: vec2i) -> f32 {
  let maxC = max(vec2i(u.renderSize) - vec2i(1), vec2i(0));
  return textureLoad(depthPyr, clamp(coord, vec2i(0), maxC), 0).x;
}

// 6-level (64x64) Hilbert curve index for spatial blue-noise stratification (XeGTAO).
fn hilbertIndex(posX: u32, posY: u32) -> u32 {
  var x = posX & 63u;
  var y = posY & 63u;
  var idx = 0u;
  for (var lvl = 5i; lvl >= 0i; lvl--) {
    let mask = 1u << u32(lvl);
    let rx = select(0u, 1u, (x & mask) != 0u);
    let ry = select(0u, 1u, (y & mask) != 0u);
    idx += ((3u * rx) ^ ry) << u32(lvl * 2);
    if (ry == 0u) {
      if (rx == 1u) {
        x = 63u - x;
        y = 63u - y;
      }
      let tmp = x;
      x = y;
      y = tmp;
    }
  }
  return idx;
}

fn spatioTemporalNoise(pix: vec2u, frameIndex: u32) -> vec2f {
  let h = hilbertIndex(pix.x, pix.y);
  let idx = f32(h + 288u * (frameIndex & 63u));
  return fract(vec2f(0.5) + idx * vec2f(0.75487766624669276, 0.56984029099805322));
}

fn reconstructNormal(cPx: vec2i, zC: f32, pC: vec3f, viewVec: vec3f, ndcScale: vec2f, ndcBias: vec2f) -> vec3f {
  let lim = vec2i(u.renderSize) - vec2i(1);
  let lPx = vec2i(max(cPx.x - 1, 0), cPx.y);
  let rPx = vec2i(min(cPx.x + 1, lim.x), cPx.y);
  let tPx = vec2i(cPx.x, max(cPx.y - 1, 0));
  let bPx = vec2i(cPx.x, min(cPx.y + 1, lim.y));

  let zL = loadDepthMip0(lPx);
  let zR = loadDepthMip0(rPx);
  let zT = loadDepthMip0(tPx);
  let zB = loadDepthMip0(bPx);

  let pL = viewPosFast(vec2f(lPx) + vec2f(0.5), zL, ndcScale, ndcBias);
  let pR = viewPosFast(vec2f(rPx) + vec2f(0.5), zR, ndcScale, ndcBias);
  let pT = viewPosFast(vec2f(tPx) + vec2f(0.5), zT, ndcScale, ndcBias);
  let pB = viewPosFast(vec2f(bPx) + vec2f(0.5), zB, ndcScale, ndcBias);

  let useLeft = (cPx.x > 0) && (cPx.x == lim.x || abs(zC - zL) < abs(zR - zC));
  let useTop = (cPx.y > 0) && (cPx.y == lim.y || abs(zC - zT) < abs(zB - zC));
  let dX = select(pR - pC, pC - pL, useLeft);
  let dY = select(pB - pC, pC - pT, useTop);

  // dX points +X (right), dY points -Y (down in screen -> -Y in view), so cross(dY, dX) points +Z (toward eye).
  var n = cross(dY, dX);
  let nLenSq = dot(n, n);
  if (nLenSq <= 1e-16) { return viewVec; }
  n = n * inverseSqrt(nLenSq);
  if (dot(n, viewVec) < 0.0) { n = -n; }
  return n;
}

fn integrateArc(h: f32, n: f32, cosN: f32, sinN: f32) -> f32 {
  return 0.25 * (cosN + 2.0 * h * sinN - cos(2.0 * h - n));
}

@compute @workgroup_size(8, 8, 1)
fn gtaoMain(@builtin(global_invocation_id) gid: vec3u) {
  let aoPx = vec2i(gid.xy);
  let aoLim = vec2i(u.aoSize);
  if (aoPx.x >= aoLim.x || aoPx.y >= aoLim.y) { return; }

  let renderLim = vec2i(u.renderSize) - vec2i(1);
  let fullPx = select(aoPx, min(aoPx * 2, renderLim), u.params1.y != 0u);
  let zC = loadDepthMip0(fullPx);
  let farZ = u.clipRange.y;

  // Sky / far-plane pixels are always unoccluded.
  if (zC >= farZ * 0.999) {
    textureStore(outRawAo, aoPx, vec4f(1.0, min(zC, 65500.0), 0.0, 0.0));
    return;
  }

  let ndcScale = vec2f(2.0 * u.invRenderSize.x * u.tanHalf.x, -2.0 * u.invRenderSize.y * u.tanHalf.y);
  let ndcBias = vec2f(-u.tanHalf.x, u.tanHalf.y);

  let centerPx = vec2f(fullPx) + vec2f(0.5);
  let pC = viewPosFast(centerPx, zC, ndcScale, ndcBias);
  let viewVec = normalize(-pC);

  var viewN: vec3f;
  if (HAS_NORMAL) {
    var rawN = textureLoad(normalTex, clamp(fullPx, vec2i(0), renderLim), 0).xyz;
    if ((u.params1.z & 2u) != 0u) {
      rawN = rawN * 2.0 - vec3f(1.0);
    }
    if ((u.params1.z & 1u) != 0u) {
      viewN = vec3f(
        dot(rawN, u.camRight.xyz),
        dot(rawN, u.camUp.xyz),
        -dot(rawN, u.camForward.xyz),
      );
    } else {
      viewN = rawN;
    }
    let nLenSq = dot(viewN, viewN);
    viewN = select(viewVec, viewN * inverseSqrt(max(nLenSq, 1e-12)), nLenSq > 1e-8);
    if (dot(viewN, viewVec) < 0.0) { viewN = -viewN; }
  } else {
    viewN = reconstructNormal(fullPx, zC, pC, viewVec, ndcScale, ndcBias);
  }

  let effectRadius = max(u.params0.x, 1e-3);
  let effectRadiusSq = effectRadius * effectRadius;
  let falloffFrac = clamp(u.params0.z, 0.05, 1.0);
  let maxScreenRadius = max(u.params0.w, 4.0);
  let rawScreenRadius = (effectRadius * u.renderSize.y) / max(2.0 * zC * u.tanHalf.y, 1e-4);

  // Fade smoothly to 1.0 when the effect radius shrinks below 1.5 pixels.
  let subPixelFade = smoothstep(0.6, 2.0, rawScreenRadius);
  if (subPixelFade <= 0.001) {
    textureStore(outRawAo, aoPx, vec4f(1.0, min(zC, 65500.0), viewN.x, viewN.y));
    return;
  }

  let screenRadius = min(rawScreenRadius, maxScreenRadius);
  let falloffStart = effectRadius * (1.0 - falloffFrac);
  let invFalloffSpan = 1.0 / max(effectRadius - falloffStart, 1e-4);

  // Tiny normal bias eliminates depth24plus quantization self-occlusion on flat planes at all angles.
  let pOrigin = pC + viewN * (zC * 0.002 + 0.012);

  let noise = spatioTemporalNoise(gid.xy, u.params1.x);
  let sliceCount = max(u.params1.w, 1u);
  let stepsPerSide = max(u.params2.x, 1u);
  let invSteps = 1.0 / f32(stepsPerSide);
  let maxMip = i32(u.params2.y);
  let renderMaxPx = u.renderSize - vec2f(0.5);
  let renderMaxI = vec2i(u.renderSize) - vec2i(1);
  let farLimit = farZ * 0.999;

  var visSum = 0.0;
  var weightSum = 0.0;

  for (var slice = 0u; slice < sliceCount; slice++) {
    let phi = (f32(slice) + noise.x) * (PI / f32(sliceCount));
    let cosPhi = cos(phi);
    let sinPhi = sin(phi);
    // Screen-space (+x right, +y down) paired with view-space (+X right, +Y up).
    let dirScreen = vec2f(cosPhi, -sinPhi);
    let dirView = vec3f(cosPhi, sinPhi, 0.0);

    let orthoDir = dirView - dot(dirView, viewVec) * viewVec;
    let axisRaw = cross(orthoDir, viewVec);
    let axisLenSq = dot(axisRaw, axisRaw);
    let axisVec = select(vec3f(0.0, 1.0, 0.0), axisRaw * inverseSqrt(max(axisLenSq, 1e-12)), axisLenSq > 1e-12);

    let projN = viewN - axisVec * dot(viewN, axisVec);
    let projNLen = length(projN);
    let cosN = clamp(dot(projN, viewVec) / max(projNLen, 1e-6), 0.0, 1.0);
    let signN = select(-1.0, 1.0, dot(projN, orthoDir) >= 0.0);
    let nAngle = signN * fastAcos(cosN);
    let sinN = sin(nAngle);

    // Tangent-plane horizon cosines on side 1 (-dirScreen, angle n - pi/2) and side 2 (+dirScreen, angle n + pi/2).
    let lowCos1 = sinN;
    let lowCos2 = -sinN;
    var maxCos1 = lowCos1;
    var maxCos2 = lowCos2;

    let sliceJitter = fract(noise.y + f32(slice) * 0.61803399);

    for (var stepIdx = 0u; stepIdx < stepsPerSide; stepIdx++) {
      let t = (f32(stepIdx) + sliceJitter) * invSteps;
      let sNorm = t * sqrt(t);
      let stepPx = max(sNorm * screenRadius, 1.0);
      let mip = clamp(i32(31u - countLeadingZeros(max(u32(stepPx), 1u))) - 1, 0, maxMip);
      let mipShift = u32(mip);
      let mipScale = f32(1u << mipShift);
      let invMipScale = 1.0 / mipScale;
      let mipMax = vec2i(max(0, renderMaxI.x >> mipShift), max(0, renderMaxI.y >> mipShift));
      let offsetPx = dirScreen * stepPx;

      // Side 1: -dirScreen (negative angle toward -orthoDir)
      let rawPx1 = centerPx - offsetPx;
      if (rawPx1.x >= 0.0 && rawPx1.y >= 0.0 && rawPx1.x < u.renderSize.x && rawPx1.y < u.renderSize.y) {
        let mipCoord1 = clamp(vec2i(floor(rawPx1 * invMipScale)), vec2i(0), mipMax);
        let tapZ1 = textureLoad(depthPyr, mipCoord1, mip).x;
        if (tapZ1 < farLimit) {
          let snappedPx1 = min((vec2f(mipCoord1) + vec2f(0.5)) * mipScale, renderMaxPx);
          let hVec1 = viewPosFast(snappedPx1, tapZ1, ndcScale, ndcBias) - pOrigin;
          let hDistSq1 = dot(hVec1, hVec1);
          if (hDistSq1 > 1e-8 && hDistSq1 < effectRadiusSq) {
            let invDist1 = inverseSqrt(hDistSq1);
            let hDist1 = hDistSq1 * invDist1;
            let falloff1 = clamp((effectRadius - hDist1) * invFalloffSpan, 0.0, 1.0);
            let shc1 = dot(hVec1, viewVec) * invDist1;
            maxCos1 = max(maxCos1, mix(lowCos1, shc1, falloff1));
          }
        }
      }

      // Side 2: +dirScreen (positive angle toward +orthoDir)
      let rawPx2 = centerPx + offsetPx;
      if (rawPx2.x >= 0.0 && rawPx2.y >= 0.0 && rawPx2.x < u.renderSize.x && rawPx2.y < u.renderSize.y) {
        let mipCoord2 = clamp(vec2i(floor(rawPx2 * invMipScale)), vec2i(0), mipMax);
        let tapZ2 = textureLoad(depthPyr, mipCoord2, mip).x;
        if (tapZ2 < farLimit) {
          let snappedPx2 = min((vec2f(mipCoord2) + vec2f(0.5)) * mipScale, renderMaxPx);
          let hVec2 = viewPosFast(snappedPx2, tapZ2, ndcScale, ndcBias) - pOrigin;
          let hDistSq2 = dot(hVec2, hVec2);
          if (hDistSq2 > 1e-8 && hDistSq2 < effectRadiusSq) {
            let invDist2 = inverseSqrt(hDistSq2);
            let hDist2 = hDistSq2 * invDist2;
            let falloff2 = clamp((effectRadius - hDist2) * invFalloffSpan, 0.0, 1.0);
            let shc2 = dot(hVec2, viewVec) * invDist2;
            maxCos2 = max(maxCos2, mix(lowCos2, shc2, falloff2));
          }
        }
      }
    }

    var h1 = -fastAcos(maxCos1);
    var h2 = fastAcos(maxCos2);
    h1 = nAngle + max(h1 - nAngle, -HALF_PI);
    h2 = nAngle + min(h2 - nAngle, HALF_PI);

    let openArc = max(cosN + nAngle * sinN, 1e-4);
    let iarc1 = clamp(integrateArc(h1, nAngle, cosN, sinN), 0.0, openArc);
    let iarc2 = clamp(integrateArc(h2, nAngle, cosN, sinN), 0.0, openArc);
    let sliceVis = clamp(iarc1 + iarc2, 0.0, openArc);

    visSum += projNLen * sliceVis;
    weightSum += projNLen * openArc;
  }

  let rawVis = clamp(visSum / max(weightSum, 1e-5), 0.0, 1.0);
  let ao = mix(1.0, rawVis, subPixelFade);
  textureStore(outRawAo, aoPx, vec4f(ao, min(zC, 65500.0), viewN.x, viewN.y));
}
`

const DENOISE_WGSL = /* wgsl */ `
${UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: GtaoUniforms;
@group(0) @binding(1) var inRawAo: texture_2d<f32>;
@group(0) @binding(2) var outDenoisedAo: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn denoiseMain(@builtin(global_invocation_id) gid: vec3u) {
  let aoPx = vec2i(gid.xy);
  let aoLim = vec2i(u.aoSize);
  if (aoPx.x >= aoLim.x || aoPx.y >= aoLim.y) { return; }

  let center = textureLoad(inRawAo, aoPx, 0);
  let zC = center.y;
  let farZ = u.clipRange.y;
  if (zC >= min(farZ * 0.999, 65400.0)) {
    textureStore(outDenoisedAo, aoPx, vec4f(1.0, zC, 0.0, 0.0));
    return;
  }

  let nCxy = center.zw;
  let nCz = sqrt(max(0.0, 1.0 - dot(nCxy, nCxy)));
  let nC = vec3f(nCxy, nCz);

  // Tight depth threshold on front-facing walls, wider on grazing floors so flat slopes smooth cleanly
  // while silhouettes and depth jumps remain razor sharp.
  let depthSigma = max(zC * (0.015 + 0.055 * (1.0 - nCz)), 0.2);
  let invDepthSigma = 1.0 / depthSigma;

  var aoAcc = center.x;
  var wAcc = 1.0;
  let maxAo = aoLim - vec2i(1);

  for (var dy = -1i; dy <= 1i; dy++) {
    for (var dx = -1i; dx <= 1i; dx++) {
      if (dx == 0i && dy == 0i) { continue; }
      let tapPx = clamp(aoPx + vec2i(dx, dy), vec2i(0), maxAo);
      let tap = textureLoad(inRawAo, tapPx, 0);
      let zT = tap.y;
      let dz = (zT - zC) * invDepthSigma;
      let wDepth = exp(-dz * dz * 2.5);

      let nTxy = tap.zw;
      let nTz = sqrt(max(0.0, 1.0 - dot(nTxy, nTxy)));
      let nDot = max(dot(nC, vec3f(nTxy, nTz)), 0.0);
      let nDot2 = nDot * nDot;
      let nDot4 = nDot2 * nDot2;
      let wNormal = nDot4 * nDot4;

      let wSpatial = select(0.25, 0.5, dx == 0i || dy == 0i);
      let w = wSpatial * wDepth * wNormal;
      aoAcc += tap.x * w;
      wAcc += w;
    }
  }

  let aoSmooth = clamp(aoAcc / max(wAcc, 1e-5), 0.0, 1.0);
  let aoOut = pow(aoSmooth, max(u.params0.y, 0.01));
  textureStore(outDenoisedAo, aoPx, vec4f(aoOut, zC, nCxy.x, nCxy.y));
}
`

const ceilDiv = (n: number, d: number) => Math.max(1, Math.ceil(n / d))

/** Creates a persistent, zero-GC WebGPU compute GTAO pass allocated once at `maxSize`. */
export async function createGtao(device: GPUDevice, maxSize: readonly [number, number]): Promise<GtaoPass> {
  const maxW = Math.max(16, Math.floor(maxSize[0]))
  const maxH = Math.max(16, Math.floor(maxSize[1]))
  const reportedMax: readonly [number, number] = [Math.max(1, Math.floor(maxSize[0])), Math.max(1, Math.floor(maxSize[1]))]

  const [prefilterModule, prefilter4Module, horizonModule, denoiseModule] = await Promise.all([
    shader(device, 'gtao-prefilter', PREFILTER_WGSL),
    shader(device, 'gtao-prefilter4', PREFILTER4_WGSL),
    shader(device, 'gtao-horizon', HORIZON_WGSL),
    shader(device, 'gtao-denoise', DENOISE_WGSL),
  ])

  const prefilterLayout = device.createBindGroupLayout({
    label: 'gtao-prefilter-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
    ],
  })

  const prefilter4Layout = device.createBindGroupLayout({
    label: 'gtao-prefilter4-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
    ],
  })

  const horizonLayout = device.createBindGroupLayout({
    label: 'gtao-horizon-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    ],
  })

  const denoiseLayout = device.createBindGroupLayout({
    label: 'gtao-denoise-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    ],
  })

  const horizonPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [horizonLayout] })

  const [prefilterPipeline, prefilter4Pipeline, horizonNoNormalPipeline, horizonWithNormalPipeline, denoisePipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'gtao-prefilter-0-3',
      layout: device.createPipelineLayout({ bindGroupLayouts: [prefilterLayout] }),
      compute: { module: prefilterModule, entryPoint: 'prefilter0to3' },
    }),
    device.createComputePipelineAsync({
      label: 'gtao-prefilter-4',
      layout: device.createPipelineLayout({ bindGroupLayouts: [prefilter4Layout] }),
      compute: { module: prefilter4Module, entryPoint: 'prefilter4' },
    }),
    device.createComputePipelineAsync({
      label: 'gtao-horizon-depth-normal',
      layout: horizonPipelineLayout,
      compute: { module: horizonModule, entryPoint: 'gtaoMain', constants: { HAS_NORMAL: 0 } },
    }),
    device.createComputePipelineAsync({
      label: 'gtao-horizon-tex-normal',
      layout: horizonPipelineLayout,
      compute: { module: horizonModule, entryPoint: 'gtaoMain', constants: { HAS_NORMAL: 1 } },
    }),
    device.createComputePipelineAsync({
      label: 'gtao-denoise',
      layout: device.createPipelineLayout({ bindGroupLayouts: [denoiseLayout] }),
      compute: { module: denoiseModule, entryPoint: 'denoiseMain' },
    }),
  ])

  const uniformBuffer = device.createBuffer({
    label: 'gtao-uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const uniformBacking = new ArrayBuffer(UNIFORM_BYTES)
  const uf = new Float32Array(uniformBacking)
  const uu = new Uint32Array(uniformBacking)

  const depthPyramid = device.createTexture({
    label: 'gtao-depth-pyramid',
    size: [maxW, maxH, 1],
    mipLevelCount: MIP_COUNT,
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const depthPyrAllView = depthPyramid.createView({ baseMipLevel: 0, mipLevelCount: MIP_COUNT })
  const depthMipViews: GPUTextureView[] = []
  for (let m = 0; m < MIP_COUNT; m++) {
    depthMipViews.push(depthPyramid.createView({ baseMipLevel: m, mipLevelCount: 1 }))
  }

  const rawTexture = device.createTexture({
    label: 'gtao-raw-ao',
    size: [maxW, maxH, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const rawView = rawTexture.createView()

  const denoisedTexture = device.createTexture({
    label: 'gtao-denoised-ao',
    size: [maxW, maxH, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const denoisedView = denoisedTexture.createView()

  // 1x1 dummy normal bound when caller omits `normal`, keeping the explicit pipeline layout valid.
  const dummyNormal = device.createTexture({
    label: 'gtao-dummy-normal',
    size: [1, 1, 1],
    format: 'rgba8snorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const dummyNormalView = dummyNormal.createView()

  const prefilter4BindGroup = device.createBindGroup({
    label: 'gtao-prefilter4-bg',
    layout: prefilter4Layout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: depthMipViews[3] },
      { binding: 2, resource: depthMipViews[4] },
    ],
  })

  const denoiseBindGroup = device.createBindGroup({
    label: 'gtao-denoise-bg',
    layout: denoiseLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: rawView },
      { binding: 2, resource: denoisedView },
    ],
  })

  const defaultHorizonBindGroup = device.createBindGroup({
    label: 'gtao-horizon-default-bg',
    layout: horizonLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: depthPyrAllView },
      { binding: 2, resource: dummyNormalView },
      { binding: 3, resource: rawView },
    ],
  })

  // WeakMap caches avoid recreating bind groups for persistent depth/normal views across frames/steer.
  const prefilterCache = new WeakMap<GPUTextureView, GPUBindGroup>()
  const horizonCache = new WeakMap<GPUTextureView, GPUBindGroup>()

  let lastRenderW = reportedMax[0]
  let lastRenderH = reportedMax[1]
  let lastAoW = reportedMax[0]
  let lastAoH = reportedMax[1]
  let lastHalfRes = false
  let dispatches = 0
  const reallocs = 0
  let destroyed = false

  function getPrefilterBindGroup(depthView: GPUTextureView): GPUBindGroup {
    let bg = prefilterCache.get(depthView)
    if (!bg) {
      bg = device.createBindGroup({
        label: 'gtao-prefilter-bg',
        layout: prefilterLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: depthView },
          { binding: 2, resource: depthMipViews[0] },
          { binding: 3, resource: depthMipViews[1] },
          { binding: 4, resource: depthMipViews[2] },
          { binding: 5, resource: depthMipViews[3] },
        ],
      })
      prefilterCache.set(depthView, bg)
    }
    return bg
  }

  function getHorizonBindGroup(normalView?: GPUTextureView): GPUBindGroup {
    if (!normalView) return defaultHorizonBindGroup
    let bg = horizonCache.get(normalView)
    if (!bg) {
      bg = device.createBindGroup({
        label: 'gtao-horizon-bg',
        layout: horizonLayout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: depthPyrAllView },
          { binding: 2, resource: normalView },
          { binding: 3, resource: rawView },
        ],
      })
      horizonCache.set(normalView, bg)
    }
    return bg
  }

  return {
    texture: denoisedTexture,
    view: denoisedView,
    rawTexture,
    depthPyramid,

    dispatch(encoder: GPUCommandEncoder, options: GtaoDispatchOptions): GPUTextureView {
      if (destroyed) throw new Error('gtao: dispatch called after destroy()')
      const allocW = Math.max(1, Math.min(maxW, Math.floor(options.allocSize[0])))
      const allocH = Math.max(1, Math.min(maxH, Math.floor(options.allocSize[1])))
      const renderW = Math.max(1, Math.min(allocW, Math.floor(options.renderSize[0])))
      const renderH = Math.max(1, Math.min(allocH, Math.floor(options.renderSize[1])))
      const halfRes = options.halfRes === true
      const aoW = halfRes ? Math.max(1, (renderW + 1) >> 1) : renderW
      const aoH = halfRes ? Math.max(1, (renderH + 1) >> 1) : renderH

      const { projParams } = options
      const nearZ = Math.max(1e-4, projParams.near ?? NEAR)
      const farZ = Math.max(nearZ + 1e-3, projParams.far ?? FAR)
      const tanHalfY = Math.max(1e-4, projParams.tanHalfFovY)
      const aspect = projParams.aspect ?? renderW / renderH
      const tanHalfX = tanHalfY * aspect

      const radius = options.radius ?? 12.0
      const power = options.power ?? 1.0
      const falloffRange = options.falloffRange ?? 0.5
      const maxScreenRadius = options.maxScreenRadius ?? 128.0
      const frameIndex = (options.frameIndex ?? 0) >>> 0
      const slices = Math.max(1, Math.min(8, Math.floor(options.slices ?? 2)))
      const steps = Math.max(1, Math.min(8, Math.floor(options.steps ?? 3)))
      const normalFlags = (options.normalSpace === 'world' ? 1 : 0) | (options.normalEncoding === 'unorm' ? 2 : 0)
      const mip4W = Math.max(1, (renderW + 15) >> 4)
      const mip4H = Math.max(1, (renderH + 15) >> 4)

      const right = projParams.right ?? [1, 0, 0]
      const up = projParams.up ?? [0, 1, 0]
      const forward = projParams.forward ?? [0, 0, -1]

      // Pack uniforms into the pre-allocated staging buffer (zero GC).
      uf[0] = renderW; uf[1] = renderH
      uf[2] = allocW; uf[3] = allocH
      uf[4] = aoW; uf[5] = aoH
      uf[6] = 1 / renderW; uf[7] = 1 / renderH
      uf[8] = tanHalfX; uf[9] = tanHalfY
      uf[10] = nearZ; uf[11] = farZ
      uf[12] = radius; uf[13] = power; uf[14] = falloffRange; uf[15] = maxScreenRadius
      uu[16] = frameIndex; uu[17] = halfRes ? 1 : 0; uu[18] = normalFlags; uu[19] = slices
      uu[20] = steps; uu[21] = MIP_COUNT - 1; uu[22] = mip4W; uu[23] = mip4H
      uf[24] = right[0]; uf[25] = right[1]; uf[26] = right[2]; uf[27] = 0
      uf[28] = up[0]; uf[29] = up[1]; uf[30] = up[2]; uf[31] = 0
      uf[32] = forward[0]; uf[33] = forward[1]; uf[34] = forward[2]; uf[35] = 0

      device.queue.writeBuffer(uniformBuffer, 0, uu)

      const ts = options.timestampWrites

      // Pass 1A: Linearize raw depth to mip 0 and downsample mips 1..3 in shared memory.
      {
        const p = encoder.beginComputePass({ label: 'gtao-prefilter-0-3', timestampWrites: ts?.prefilter0 })
        p.setPipeline(prefilterPipeline)
        p.setBindGroup(0, getPrefilterBindGroup(options.depth))
        p.dispatchWorkgroups(ceilDiv(renderW, 16), ceilDiv(renderH, 16))
        p.end()
      }

      // Pass 1B: Downsample mip 3 -> mip 4.
      {
        const p = encoder.beginComputePass({ label: 'gtao-prefilter-4', timestampWrites: ts?.prefilter4 })
        p.setPipeline(prefilter4Pipeline)
        p.setBindGroup(0, prefilter4BindGroup)
        p.dispatchWorkgroups(ceilDiv(mip4W, 8), ceilDiv(mip4H, 8))
        p.end()
      }

      // Pass 2: Horizon-based GTAO compute.
      {
        const p = encoder.beginComputePass({ label: 'gtao-horizon', timestampWrites: ts?.gtao })
        p.setPipeline(options.normal ? horizonWithNormalPipeline : horizonNoNormalPipeline)
        p.setBindGroup(0, getHorizonBindGroup(options.normal))
        p.dispatchWorkgroups(ceilDiv(aoW, 8), ceilDiv(aoH, 8))
        p.end()
      }

      // Pass 3: Edge-preserving 3x3 depth + normal bilateral spatial denoiser.
      {
        const p = encoder.beginComputePass({ label: 'gtao-denoise', timestampWrites: ts?.denoise })
        p.setPipeline(denoisePipeline)
        p.setBindGroup(0, denoiseBindGroup)
        p.dispatchWorkgroups(ceilDiv(aoW, 8), ceilDiv(aoH, 8))
        p.end()
      }

      lastRenderW = renderW
      lastRenderH = renderH
      lastAoW = aoW
      lastAoH = aoH
      lastHalfRes = halfRes
      dispatches++
      return denoisedView
    },

    stats(): GtaoStats {
      return {
        maxSize: reportedMax,
        renderSize: [lastRenderW, lastRenderH],
        aoSize: [lastAoW, lastAoH],
        halfRes: lastHalfRes,
        reallocs,
        dispatches,
        mips: MIP_COUNT,
      }
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      uniformBuffer.destroy()
      depthPyramid.destroy()
      rawTexture.destroy()
      denoisedTexture.destroy()
      dummyNormal.destroy()
    },
  }
}
