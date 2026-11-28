// Standalone Voxel-Native Global Illumination Engine (#165 — Moonshot 3A).
//
// Combines a 3-cascade nested toroidal 3D clipmap radiance cache (with 6-face directional
// mip-0 radiance for zero thin-wall light leaking + 3-level mip pyramids for empty-space
// skipping and Voxel Cone Tracing) with a full Temporal + 3-pass Edge-Stopping A-trous
// Wavelet SVGF denoiser.
//
// Pipeline:
//   1. `cs_inject_radiance` (@workgroup_size(4, 4, 4)):
//      Injects direct sunlit surface radiance (explicit sun visibility or voxel shadow DDA),
//      HDR emissives, and energy-conserving previous-frame multi-bounce indirect radiance
//      (feedback <= 0.65, clamped) into each toroidal clipmap cascade.
//   2. `cs_mip_radiance` (@workgroup_size(4, 4, 4)):
//      Builds 2x2x2 volumetric mip chains (64x32x64 -> 32x16x32 -> 16x8x16) of premultiplied
//      radiance (.rgb) and opacity (.a) for hierarchical DDA skipping and Voxel Cone Tracing.
//   3. `cs_trace_gi` (@workgroup_size(8, 8)):
//      Screen-space 1-spp/2-spp cosine-weighted hemisphere bounce (R2 + IGN blue noise,
//      hierarchical 3-cascade mip-skip DDA) OR 5-cone diffuse Voxel Cone Tracing, operating
//      strictly inside the active `renderSize` sub-rect of persistent `maxSize` buffers.
//   4. `cs_svgf_temporal` + 3x `cs_svgf_atrous` (@workgroup_size(8, 8)):
//      Bilateral 2x2 velocity reprojection with normal & linear-depth disocclusion rejection,
//      1st/2nd luminance moments + spatial 3x3 variance fallback (N < 4), and 5x5 B3-spline
//      edge-stopping wavelet filtering (step = 1, 2, 4) preserving 90-degree voxel corners.
import { FAR, NEAR, shader } from '../probe/gpu.ts'

export type Vec3 = readonly [number, number, number]

/** Number of nested toroidal clipmap cascades (fine, medium, coarse). */
export const GI_CASCADE_COUNT = 3
/** Number of mip levels per cascade (e.g. 64x32x64 -> 32x16x32 -> 16x8x16). */
export const GI_MIP_COUNT = 3
/** Default toroidal voxel grid dimensions per cascade. */
export const GI_DEFAULT_CASCADE_SIZE = [64, 32, 64] as const
/** Default cascade voxel sizes in Voxelwright cells (1 cell = 0.1 m): 0.8 m, 3.2 m, 12.8 m. */
export const GI_DEFAULT_VOXEL_CELLS = [8, 32, 128] as const

/** Trace mode 0: stochastic cosine-weighted hemisphere bounce + SVGF denoiser. */
export const GI_MODE_STOCHASTIC = 0
/** Trace mode 1: 5-cone diffuse Voxel Cone Tracing. */
export const GI_MODE_VCT = 1

/** Normal texture encoding: 0 = signed world-space normals in [-1, 1] (rgba16float). */
export const GI_NORMAL_SIGNED = 0
/** Normal texture encoding: 1 = unorm-packed world normals in [0, 1] (n * 2 - 1). */
export const GI_NORMAL_UNORM = 1

export type GiTraceMode = 0 | 1
export type GiNormalEncoding = 0 | 1

/** Pluggable 3D voxel occupancy, albedo, and emissive source for `inject()`. */
export interface VoxelGridSource {
  /** 3D texture (rgba8unorm or rgba16float): rgb = linear albedo [0,1], a = opacity [0,1]. */
  albedoOpacity: GPUTextureView
  /**
   * 3D texture (rgba16float): rgb = linear HDR emissive radiance;
   * a >= 0 = explicit direct sun visibility [0,1] (e.g. from SunMaps),
   * a < 0 = trace direct sun shadow ray automatically through `albedoOpacity`.
   */
  emissiveSun: GPUTextureView
  /** Grid dimensions `[nx, ny, nz]` of the source 3D textures. */
  size: readonly [number, number, number]
  /** Minimum world-space corner `[x, y, z]` of texel `(0,0,0)` in Voxelwright cells (1 cell = 0.1 m). */
  originCells: Vec3
  /** Size of one source voxel in Voxelwright cells (e.g. `8` for `0.8 m`). */
  voxelCells: number
}

/** Camera pose and projection matching `engine/probe/gpu.ts` and `engine/page/march.ts`. */
export interface VoxelGICamera {
  eye: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
  tanHalf: number
  aspect: number
  /** Near plane in Voxelwright cells (default `NEAR = 1.0`). */
  near?: number
  /** Far plane in Voxelwright cells (default `FAR = 100000.0`). */
  far?: number
}

/** Analytical sky / ambient hemisphere colors for rays escaping Cascade 2. */
export interface VoxelGISky {
  /** Sky radiance at zenith (linear HDR). */
  zenith: Vec3
  /** Sky radiance at horizon (linear HDR). */
  horizon: Vec3
  /** Lower-hemisphere ground bounce radiance (linear HDR). */
  ground?: Vec3
  /** Optional subtle solar aureole strength along `sunDir` (default `0.0`). */
  sunGlow?: number
}

export interface VoxelGIInjectInput {
  /** Camera position in Voxelwright cells (anchors the 3 nested toroidal clipmaps). */
  cameraPosCells: Vec3
  /** Shared world-space voxel source (used for all cascades unless `cascadeSources` is provided). */
  source?: VoxelGridSource
  /** Optional per-cascade voxel sources `[cascade0, cascade1, cascade2]` (e.g. Wave 3 64-tree voxelizer). */
  cascadeSources?: readonly [VoxelGridSource, VoxelGridSource, VoxelGridSource]
  /** Unit direction toward the sun (Y-up world space). */
  sunDir: Vec3
  /** Direct sun light color/strength (linear HDR, pre-normalized by 1/PI matching march.ts). */
  sunIrradiance: Vec3
  /** Sky radiance used when multi-bounce gather rays escape all 3 cascades. */
  sky: VoxelGISky
  /** Optional multi-bounce feedback factor override (default from options, `0.65`, clamped `[0, 0.85]`). */
  bounceFeedback?: number
  /** Optional incremental toroidal slice stride (`1` = update all voxels every call, `2`/`4` = amortize existing slices). */
  amortizeStride?: number
  /** Optional temporal EMA blend for multi-bounce gather in `(0, 1]` (default `0.55`). */
  gatherTemporalAlpha?: number
  /** Number of multi-bounce gather rays per exposed face (`4..16`, default `12`). */
  gatherRays?: number
  /** Force full cascade refresh without reading previous radiance history. */
  reset?: boolean
}

export interface VoxelGITraceInput {
  /** Current frame depth (`depth24plus`, 0 = near, 1 = far; active `renderSize` sub-rect). */
  depth: GPUTextureView
  /** Current frame world-space normal texture (active `renderSize` sub-rect). */
  normal: GPUTextureView
  /** Current frame screen-space UV motion vectors (`rg16float`, `prevUV - curUV`, matching `taa.ts`). */
  velocity: GPUTextureView
  /** Active rendered pixels `[width, height]` inside `depth` / `normal` / `velocity`. */
  renderSize: readonly [number, number]
  /** Allocated dimensions `[width, height]` of `depth` / `normal` / `velocity` (defaults to `renderSize`). */
  allocSize?: readonly [number, number]
  /** Current camera pose & projection. */
  camera: VoxelGICamera
  /** Unit direction toward the sun (for sky evaluation on escaped rays). */
  sunDir: Vec3
  /** Sky colors for rays escaping Cascade 2. */
  sky: VoxelGISky
  /** Trace mode: `0` = stochastic cosine bounce + SVGF (default), `1` = 5-cone diffuse VCT. */
  mode?: GiTraceMode
  /** Samples per pixel in stochastic mode (`1` or `2`, default `1`). */
  spp?: 1 | 2
  /** Normal texture encoding (`0` = signed `[-1, 1]`, `1` = unorm `[0, 1]`, default `0`). */
  normalEncoding?: GiNormalEncoding
  /** Override number of à-trous wavelet passes (`0..3`, default from options = `3`). */
  atrousPasses?: number
  /** Indirect output multiplier (default `1.0`). */
  indirectScale?: number
  /** Hard temporal history reset on teleport, camera cut, or scene switch. */
  reset?: boolean
}

export interface VoxelGIOptions {
  /** Persistent screen-space texture capacity `[width, height]` (default `[1280, 720]`). */
  maxSize?: readonly [number, number]
  /** Power-of-two toroidal voxel grid size per cascade `[x, y, z]` (default `[64, 32, 64]`). */
  cascadeSize?: readonly [number, number, number]
  /** Voxel size in Voxelwright cells (1 cell = 0.1 m) per cascade (default `[8, 32, 128]`). */
  cascadeVoxelCells?: readonly [number, number, number]
  /** Multi-bounce indirect feedback factor in `[0, 0.85]` (default `0.65`). */
  bounceFeedback?: number
  /** Maximum finite radiance clamped in the clipmap cache (default `64.0`). */
  maxRadiance?: number
  /** Maximum physical diffuse albedo clamped during injection (default `0.90`). */
  maxAlbedo?: number
  /** Number of à-trous edge-stopping wavelet iterations (`0..3`, default `3` with steps `1, 2, 4`). */
  atrousPasses?: number
  /** SVGF depth edge-stopping sigma (default `1.5`). */
  sigmaZ?: number
  /** SVGF luminance-variance edge-stopping sigma (default `4.0`). */
  sigmaL?: number
  /** SVGF normal edge-stopping exponent (default `64.0`). */
  normalPower?: number
  /** Maximum SVGF temporal history length in frames (default `32.0`). */
  maxHistory?: number
}

export interface VoxelGIInjectTiming {
  /** Timestamp writes spanning Pass 1 (`cs_inject_radiance`) across all 3 cascades. */
  inject?: GPUComputePassTimestampWrites
  /** Timestamp writes spanning Pass 2 (`cs_mip_radiance`) across all 3 cascades. */
  mip?: GPUComputePassTimestampWrites
  /** Timestamp writes spanning both Pass 1 + Pass 2 end-to-end. */
  all?: GPUComputePassTimestampWrites
}

export interface VoxelGITraceTiming {
  /** Timestamp writes for Pass 3 (`cs_trace_gi`). */
  trace?: GPUComputePassTimestampWrites
  /** Timestamp writes for Pass 4a (`cs_svgf_temporal`). */
  temporal?: GPUComputePassTimestampWrites
  /** Timestamp writes spanning all Pass 4b (`cs_svgf_atrous`) iterations. */
  atrous?: GPUComputePassTimestampWrites
}

export interface VoxelGIStats {
  /** Number of screen-space texture reallocations (always 0 while `renderSize <= maxSize`). */
  readonly reallocs: number
  /** Total `traceAndDenoise()` calls since creation. */
  readonly frames: number
  /** Total `inject()` calls since creation. */
  readonly injectCalls: number
  /** Total temporal history resets. */
  readonly resets: number
  /** Whether SVGF temporal history is currently valid. */
  readonly historyValid: boolean
  /** Persistent screen-space texture capacity `[width, height]`. */
  readonly capacity: readonly [number, number]
  /** Most recent active `renderSize` `[width, height]`. */
  readonly renderSize: readonly [number, number]
  /** Toroidal voxel grid dimensions `[x, y, z]` per cascade. */
  readonly cascadeSize: readonly [number, number, number]
  /** Cascade voxel sizes `[c0, c1, c2]` in Voxelwright cells. */
  readonly cascadeVoxelCells: readonly [number, number, number]
  /** Current world-voxel anchor origin for each cascade. */
  readonly cascadeOrigins: readonly [Vec3, Vec3, Vec3]
  /** Most recent trace mode (`0` = stochastic, `1` = 5-cone VCT). */
  readonly mode: GiTraceMode
}

export interface VoxelGIPass {
  /** Runs Pass 1 (`cs_inject_radiance`) and Pass 2 (`cs_mip_radiance`) on all 3 cascades. */
  inject(encoder: GPUCommandEncoder, input: VoxelGIInjectInput, timing?: VoxelGIInjectTiming): void
  /** Runs Pass 3 (`cs_trace_gi`) and Pass 4 (`cs_svgf_temporal` + `cs_svgf_atrous`), returning `giView`. */
  traceAndDenoise(encoder: GPUCommandEncoder, input: VoxelGITraceInput, timing?: VoxelGITraceTiming): GPUTextureView
  /** Invalidates both clipmap multi-bounce history and SVGF temporal history. */
  reset(): void
  /** Returns allocation, frame, and cascade anchor diagnostics. */
  stats(): VoxelGIStats
  /** Destroys all GPU resources owned by this GI pass. */
  destroy(): void
  /** Latest denoised indirect GI output view (`rgba16float`, `.rgb` = indirect light, `.a` = variance/skyVis). */
  readonly giView: GPUTextureView
  /** Underlying `GPUTexture` of `giView`. */
  readonly giTexture: GPUTexture
  /** Latest raw pre-SVGF traced GI view (`rgba16float`, `.rgb` = noisy indirect, `.a` = hitDist/skyVis). */
  readonly rawGiView: GPUTextureView
  /** Underlying `GPUTexture` of `rawGiView`. */
  readonly rawGiTexture: GPUTexture
  /** Current 3D clipmap radiance pyramid views `[cascade0, cascade1, cascade2]` (3 mips each). */
  readonly cascadeViews: readonly [GPUTextureView, GPUTextureView, GPUTextureView]
  /** Underlying 3D `GPUTexture`s of `cascadeViews`. */
  readonly cascadeTextures: readonly [GPUTexture, GPUTexture, GPUTexture]
  /** Linear clamp-to-edge sampler paired with `GI_WGSL`. */
  readonly linearSampler: GPUSampler
}

/**
 * Generates standard WGSL resource bindings for `GI_WGSL` in a consumer shading pass.
 */
export function giBindings(group = 1, baseBinding = 0): string {
  return /* wgsl */ `
@group(${group}) @binding(${baseBinding}) var giTex: texture_2d<f32>;
@group(${group}) @binding(${baseBinding + 1}) var giSampler: sampler;
`
}

/**
 * Reusable WGSL snippet for Wave 3 integration (`march-shade.ts` / deferred visibility lighting).
 * Expects `giTex` (`texture_2d<f32>`) and `giSampler` (`sampler`) — see `giBindings()`.
 */
export const GI_WGSL = /* wgsl */ `
// Clamps screen UV inside the active renderSize sub-rect of persistent maxSize GI textures so
// dynamic resolution steering never samples stale texels beyond the active viewport border.
fn sampleIndirectGI(uv: vec2f, uvScale: vec2f, invCapacity: vec2f) -> vec4f {
  let halfTexel = invCapacity * 0.5;
  let maxUv = max(uvScale - halfTexel, halfTexel);
  let clampedUv = clamp(uv * uvScale, halfTexel, maxUv);
  let raw = textureSampleLevel(giTex, giSampler, clampedUv, 0.0);
  let safeRgb = select(vec3f(0.0), raw.rgb, raw.rgb >= vec3f(0.0));
  return vec4f(min(safeRgb, vec3f(65000.0)), max(raw.a, 0.0));
}

// Energy-conserving diffuse multi-bounce combine: indirect irradiance (pre-divided by PI) * albedo.
fn combineIndirectGI(albedo: vec3f, indirectLight: vec3f, strength: f32) -> vec3f {
  let clampedAlb = clamp(albedo, vec3f(0.0), vec3f(0.95));
  return clampedAlb * max(indirectLight, vec3f(0.0)) * max(strength, 0.0);
}

// Full surface combine helper replacing the legacy ROOM_LIGHT heuristic with voxel-native GI.
fn applyVoxelGI(
  directColor: vec3f,
  albedo: vec3f,
  emissive: vec3f,
  giSample: vec4f,
  indirectStrength: f32,
) -> vec3f {
  return max(directColor, vec3f(0.0)) + combineIndirectGI(albedo, giSample.rgb, indirectStrength) + max(emissive, vec3f(0.0));
}
`

// ── Shared WGSL building blocks ──────────────────────────────────────────────

const COMMON_GI_WGSL = /* wgsl */ `
const GI_PI: f32 = 3.14159265359;
const GI_F16_MAX: f32 = 65000.0;
const GI_FACE_WORDS: u32 = 9u;

// Six canonical voxel face outward normals: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z.
fn faceDir(f: u32) -> vec3i {
  switch (f) {
    case 0u: { return vec3i(1, 0, 0); }
    case 1u: { return vec3i(-1, 0, 0); }
    case 2u: { return vec3i(0, 1, 0); }
    case 3u: { return vec3i(0, -1, 0); }
    case 4u: { return vec3i(0, 0, 1); }
    default: { return vec3i(0, 0, -1); }
  }
}

fn faceNormalF(f: u32) -> vec3f {
  return vec3f(faceDir(f));
}

fn dominantFace(n: vec3f) -> u32 {
  let a = abs(n);
  if (a.x >= a.y && a.x >= a.z) {
    return select(1u, 0u, n.x >= 0.0);
  }
  if (a.y >= a.z) {
    return select(3u, 2u, n.y >= 0.0);
  }
  return select(5u, 4u, n.z >= 0.0);
}

fn cleanRgb(c: vec3f) -> vec3f {
  let nonNeg = select(vec3f(0.0), c, c >= vec3f(0.0));
  return select(vec3f(GI_F16_MAX), nonNeg, nonNeg <= vec3f(GI_F16_MAX));
}

fn giLuma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn toroidalCoord(w: vec3i, dimU: vec3u) -> vec3u {
  return bitcast<vec3u>(w) & (dimU - vec3u(1u));
}

fn voxelLinearIndex(cascadeIdx: u32, tc: vec3u, dimU: vec3u) -> u32 {
  let perCascade = dimU.x * dimU.y * dimU.z;
  return cascadeIdx * perCascade + tc.x + dimU.x * (tc.z + dimU.z * tc.y);
}

// Branchless orthonormal tangent basis (Duff et al. 2017) with zero pole singularities.
fn makeBasis(n: vec3f) -> mat3x3<f32> {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3<f32>(t, bt, n);
}

fn evalSky(rd: vec3f, sunDir: vec3f, zenith: vec3f, horizon: vec3f, ground: vec3f, sunGlow: f32) -> vec3f {
  let d = normalize(rd);
  let up = clamp(d.y, 0.0, 1.0);
  let down = clamp(-d.y, 0.0, 1.0);
  var col = mix(horizon, zenith, pow(up, 0.55));
  col = mix(col, ground, smoothstep(0.0, 0.35, down));
  if (sunGlow > 0.0) {
    let g = pow(max(dot(d, sunDir), 0.0), 48.0) * sunGlow;
    col += vec3f(1.0, 0.92, 0.80) * g;
  }
  return max(col, vec3f(0.0));
}

fn linearDepth(d: f32, nearDist: f32, farDist: f32) -> f32 {
  let denom = max(1.0 - d * ((farDist - nearDist) / farDist), 1e-6);
  return nearDist / denom;
}

fn hash31(p: vec3u) -> f32 {
  var h = (p.x * 73856093u) ^ (p.y * 19349663u) ^ (p.z * 83492791u);
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  return f32((h ^ (h >> 16u)) >> 8u) * (1.0 / 16777216.0);
}

// Interleaved Gradient Noise (Jimenez 2014): high-frequency blue-noise-like spatial spectrum.
fn ign(px: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(px, vec2f(0.06711056, 0.00583715))));
}

fn safeInvDir(rd: vec3f) -> vec3f {
  let eps = select(vec3f(-1e-6), vec3f(1e-6), rd >= vec3f(0.0));
  let safe = select(rd, eps, abs(rd) < vec3f(1e-6));
  return 1.0 / safe;
}
`

// Helper WGSL functions for reading from the 3 cascades + 6-face directional radiance storage buffer.
// Expects bindings: `prevCas0`, `prevCas1`, `prevCas2`, `facesIn`, `repeatSamp`.
const CLIPMAP_TRACE_WGSL = /* wgsl */ `
fn readFaceRad(cascadeIdx: u32, tc: vec3u, faceIdx: u32, dimU: vec3u) -> vec3f {
  let base = voxelLinearIndex(cascadeIdx, tc, dimU) * GI_FACE_WORDS + (faceIdx >> 1u) * 3u;
  if ((faceIdx & 1u) == 0u) {
    let rg = unpack2x16float(facesIn[base]);
    let b0 = unpack2x16float(facesIn[base + 1u]);
    return cleanRgb(vec3f(rg.x, rg.y, b0.x));
  }
  let b1 = unpack2x16float(facesIn[base + 1u]);
  let gb = unpack2x16float(facesIn[base + 2u]);
  return cleanRgb(vec3f(b1.y, gb.x, gb.y));
}

fn readDirectionalBlend(cascadeIdx: u32, tc: vec3u, rayDir: vec3f, dimU: vec3u) -> vec3f {
  let w = rayDir * rayDir;
  let wSum = max(w.x + w.y + w.z, 1e-5);
  let fx = select(0u, 1u, rayDir.x > 0.0);
  let fy = select(2u, 3u, rayDir.y > 0.0);
  let fz = select(4u, 5u, rayDir.z > 0.0);
  let rx = readFaceRad(cascadeIdx, tc, fx, dimU);
  let ry = readFaceRad(cascadeIdx, tc, fy, dimU);
  let rz = readFaceRad(cascadeIdx, tc, fz, dimU);
  return (rx * w.x + ry * w.y + rz * w.z) / wSum;
}

fn loadCascadeMip(cascadeIdx: u32, coord: vec3i, mip: i32) -> vec4f {
  if (cascadeIdx == 0u) {
    return textureLoad(prevCas0, coord, mip);
  }
  if (cascadeIdx == 1u) {
    return textureLoad(prevCas1, coord, mip);
  }
  return textureLoad(prevCas2, coord, mip);
}

fn sampleCascadeLod(cascadeIdx: u32, uvw: vec3f, lod: f32) -> vec4f {
  if (cascadeIdx == 0u) {
    return textureSampleLevel(prevCas0, repeatSamp, uvw, lod);
  }
  if (cascadeIdx == 1u) {
    return textureSampleLevel(prevCas1, repeatSamp, uvw, lod);
  }
  return textureSampleLevel(prevCas2, repeatSamp, uvw, lod);
}

fn cascadeUvw(worldPos: vec3f, origin: vec3i, voxelCells: f32, dimF: vec3f, dimU: vec3u) -> vec3f {
  let rel = worldPos / voxelCells - vec3f(origin);
  let wrapOff = vec3f(bitcast<vec3u>(origin) & (dimU - vec3u(1u)));
  return (rel + wrapOff) / dimF;
}

// Hierarchical 3-cascade DDA ray trace with mip-2 (4x4x4) and mip-1 (2x2x2) empty-space skipping.
// On hit, returns exact 6-face directional radiance (zero thin-wall light leaking) and hit distance in .a.
// On miss (escaped Cascade 2), returns sky radiance and .a = -1.0.
fn traceClipmapDDA(
  ro: vec3f,
  rd: vec3f,
  maxSteps: u32,
  dimU: vec3u,
  origins: array<vec4i, 3>,
  voxels: vec4f,
  sunDir: vec3f,
  skyZenith: vec3f,
  skyHorizon: vec3f,
  skyGround: vec3f,
  sunGlow: f32,
) -> vec4f {
  let invRd = safeInvDir(rd);
  let stepSign = select(vec3i(-1), vec3i(1), rd >= vec3f(0.0));
  let ahead = select(vec3f(0.0), vec3f(1.0), rd >= vec3f(0.0));
  let dimI = vec3i(dimU);
  let voxSizes = array<f32, 3>(voxels.x, voxels.y, voxels.z);

  var t = 0.0;
  var curC = 0u;
  var entryFace = dominantFace(-rd);
  var totalSteps = 0u;

  for (var iter = 0u; iter < 64u; iter++) {
    if (totalSteps >= maxSteps || curC >= 3u) {
      break;
    }
    let orig = origins[curC];
    if (orig.w == 0) {
      curC += 1u;
      continue;
    }
    let s = voxSizes[curC];
    let p = ro + rd * t;
    let pf = p / s;
    let v = vec3i(floor(pf));
    let rel = v - orig.xyz;
    // Stay 1 voxel inside the outer toroidal wrap seam before handing off to the coarser cascade.
    if (any(rel < vec3i(1)) || any(rel >= dimI - vec3i(1))) {
      curC += 1u;
      continue;
    }

    let tc = toroidalCoord(v, dimU);
    var skipSize = 1;

    // Hierarchical empty-space skipping: check mip-2 (4x4x4), then mip-1 (2x2x2), then mip-0 (1x1x1).
    let m2 = loadCascadeMip(curC, vec3i(tc >> vec3u(2u)), 2);
    if (m2.a <= 0.001) {
      skipSize = 4;
    } else {
      let m1 = loadCascadeMip(curC, vec3i(tc >> vec3u(1u)), 1);
      if (m1.a <= 0.001) {
        skipSize = 2;
      } else {
        let m0 = loadCascadeMip(curC, vec3i(tc), 0);
        if (m0.a >= 0.5) {
          let rad = readFaceRad(curC, tc, entryFace, dimU);
          return vec4f(rad, t);
        }
      }
    }

    // Advance ray to the exit plane of the skipped 1x1x1, 2x2x2, or 4x4x4 block.
    let mask = ~(skipSize - 1);
    let blockMin = vec3f(v & vec3i(mask));
    let exitBoundary = (blockMin + ahead * f32(skipSize)) * s;
    let rawExit = (exitBoundary - ro) * invRd;
    let tExit = select(vec3f(1e20), rawExit, abs(rd) >= vec3f(1e-6));

    var tNext = tExit.x;
    var nextFace = select(0u, 1u, stepSign.x > 0);
    if (tExit.y < tNext) {
      tNext = tExit.y;
      nextFace = select(2u, 3u, stepSign.y > 0);
    }
    if (tExit.z < tNext) {
      tNext = tExit.z;
      nextFace = select(4u, 5u, stepSign.z > 0);
    }

    t = max(tNext, t) + s * 0.002;
    entryFace = nextFace;
    totalSteps += 1u;
  }

  let sky = evalSky(rd, sunDir, skyZenith, skyHorizon, skyGround, sunGlow);
  return vec4f(sky, -1.0);
}

// 5-cone diffuse Voxel Cone Tracing across all 3 cascades + mip levels (mode = 1).
fn traceSingleCone(
  ro: vec3f,
  dir: vec3f,
  tanHalfAngle: f32,
  dimU: vec3u,
  origins: array<vec4i, 3>,
  voxels: vec4f,
  sunDir: vec3f,
  skyZenith: vec3f,
  skyHorizon: vec3f,
  skyGround: vec3f,
  sunGlow: f32,
) -> vec4f {
  let dimF = vec3f(dimU);
  let dimI = vec3i(dimU);
  let voxSizes = array<f32, 3>(voxels.x, voxels.y, voxels.z);
  let s0 = voxSizes[0];

  var t = s0 * 0.75;
  var accRgb = vec3f(0.0);
  var accA = 0.0;

  for (var stepIdx = 0u; stepIdx < 18u; stepIdx++) {
    if (accA >= 0.96) {
      break;
    }
    let p = ro + dir * t;
    let diam = max(s0, 2.0 * t * tanHalfAngle);

    // Choose finest cascade whose safe interior bounds hold p and whose mip-2 covers diam.
    var chosenC = 3u;
    for (var c = 0u; c < 3u; c++) {
      let orig = origins[c];
      if (orig.w == 0) { continue; }
      let s = voxSizes[c];
      if (diam > s * 5.0 && c < 2u) { continue; }
      let rel = p / s - vec3f(orig.xyz);
      if (all(rel >= vec3f(1.5)) && all(rel <= dimF - vec3f(1.5))) {
        chosenC = c;
        break;
      }
    }
    if (chosenC >= 3u) {
      break;
    }

    let s = voxSizes[chosenC];
    let lod = clamp(log2(max(1.0, diam / s)), 0.0, 2.0);
    let stepLen = max(diam * 0.55, s * 0.75);

    var tapRgb = vec3f(0.0);
    var tapA = 0.0;

    if (lod < 0.65) {
      let v = vec3i(floor(p / s));
      let relI = v - origins[chosenC].xyz;
      if (all(relI >= vec3i(0)) && all(relI < dimI)) {
        let tc = toroidalCoord(v, dimU);
        let m0 = loadCascadeMip(chosenC, vec3i(tc), 0);
        if (m0.a > 0.01) {
          let dirRad = readDirectionalBlend(chosenC, tc, dir, dimU);
          tapA = m0.a;
          tapRgb = dirRad * tapA;
        }
      }
    } else {
      let uvw = cascadeUvw(p, origins[chosenC].xyz, s, dimF, dimU);
      let mipTap = sampleCascadeLod(chosenC, uvw, lod);
      tapRgb = cleanRgb(mipTap.rgb);
      tapA = clamp(mipTap.a, 0.0, 1.0);
    }

    if (tapA > 1e-4) {
      let weight = clamp(stepLen / max(diam, s), 0.35, 1.0);
      let corrA = 1.0 - pow(max(0.0, 1.0 - tapA), weight);
      let corrRgb = tapRgb * (corrA / max(tapA, 1e-4));
      accRgb += (1.0 - accA) * corrRgb;
      accA += (1.0 - accA) * corrA;
    }

    t += stepLen;
  }

  let skyVis = clamp(1.0 - accA, 0.0, 1.0);
  if (skyVis > 1e-4) {
    accRgb += skyVis * evalSky(dir, sunDir, skyZenith, skyHorizon, skyGround, sunGlow);
  }
  return vec4f(cleanRgb(accRgb), skyVis);
}
`

// ── Pass 1: cs_inject_radiance ───────────────────────────────────────────────

const INJECT_WGSL = /* wgsl */ `
${COMMON_GI_WGSL}

struct InjectParams {
  // x: cascadeIdx, yzw: cascadeDim
  cascadeDims: vec4u,
  // xyz: curOrigin, w: frameIndex
  curOriginFrame: vec4i,
  // xyz: prevOrigin, w: flags (bit0=prevValid, bit1=forceFull, bits8..15=amortizeStride)
  prevOriginFlags: vec4i,
  // xyz: srcOriginCells, w: srcVoxelCells
  srcOriginVoxel: vec4f,
  // xyz: srcSize, w: cascadeVoxelCells
  srcSizeCasVoxel: vec4f,
  // xyz: sunDir, w: bounceFeedback
  sunDirFeedback: vec4f,
  // xyz: sunIrradiance, w: maxRadiance
  sunIrrMaxRad: vec4f,
  // xyz: skyZenith, w: maxAlbedo
  skyZenithMaxAlb: vec4f,
  // xyz: skyHorizon, w: gatherTemporalAlpha
  skyHorizonAlpha: vec4f,
  // xyz: skyGround, w: gatherRays
  skyGroundRays: vec4f,
  // xyz: prevOrigin[c], w: prevValid[c]
  prevCascadeOrigins: array<vec4i, 3>,
  // x: vox0, y: vox1, z: vox2, w: sunGlow
  cascadeVoxelsGlow: vec4f,
}

@group(0) @binding(0) var srcAlbedoTex: texture_3d<f32>;
@group(0) @binding(1) var srcEmissiveTex: texture_3d<f32>;
@group(0) @binding(2) var prevCas0: texture_3d<f32>;
@group(0) @binding(3) var prevCas1: texture_3d<f32>;
@group(0) @binding(4) var prevCas2: texture_3d<f32>;
@group(0) @binding(5) var<storage, read> facesIn: array<u32>;
@group(0) @binding(6) var cascadeOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var<storage, read_write> facesOut: array<u32>;
@group(0) @binding(8) var repeatSamp: sampler;
@group(0) @binding(9) var<uniform> params: InjectParams;

${CLIPMAP_TRACE_WGSL}

fn writeSixFaces(cascadeIdx: u32, tc: vec3u, dimU: vec3u, fRad: array<vec3f, 6>) {
  let base = voxelLinearIndex(cascadeIdx, tc, dimU) * GI_FACE_WORDS;
  for (var pair = 0u; pair < 3u; pair++) {
    let a = cleanRgb(fRad[pair * 2u]);
    let b = cleanRgb(fRad[pair * 2u + 1u]);
    facesOut[base + pair * 3u]      = pack2x16float(vec2f(a.r, a.g));
    facesOut[base + pair * 3u + 1u] = pack2x16float(vec2f(a.b, b.r));
    facesOut[base + pair * 3u + 2u] = pack2x16float(vec2f(b.g, b.b));
  }
}

fn copySixFaces(cascadeIdx: u32, tc: vec3u, dimU: vec3u) {
  let base = voxelLinearIndex(cascadeIdx, tc, dimU) * GI_FACE_WORDS;
  for (var w = 0u; w < GI_FACE_WORDS; w++) {
    facesOut[base + w] = facesIn[base + w];
  }
}

struct SrcSample {
  albedo: vec3f,
  opacity: f32,
  emissive: vec3f,
  sunHint: f32,
}

fn sampleSourceVoxel(worldCenter: vec3f, casVoxel: f32) -> SrcSample {
  let srcOrigin = params.srcOriginVoxel.xyz;
  let srcVoxel = max(params.srcOriginVoxel.w, 1e-4);
  let srcSizeF = params.srcSizeCasVoxel.xyz;
  let srcSizeI = vec3i(srcSizeF);
  let ratio = casVoxel / srcVoxel;

  let scF = (worldCenter - srcOrigin) / srcVoxel;
  if (ratio <= 1.25) {
    let sc = vec3i(floor(scF));
    if (any(sc < vec3i(0)) || any(sc >= srcSizeI)) {
      return SrcSample(vec3f(0.0), 0.0, vec3f(0.0), -1.0);
    }
    let ao = textureLoad(srcAlbedoTex, sc, 0);
    let es = textureLoad(srcEmissiveTex, sc, 0);
    return SrcSample(cleanRgb(ao.rgb), clamp(ao.a, 0.0, 1.0), cleanRgb(es.rgb), es.a);
  }

  // Coarser cascade: fast AABB reject before 2x2x2 stratified footprint across source space.
  let halfSpan = 0.25 * ratio;
  if (any(scF + vec3f(halfSpan) < vec3f(0.0)) || any(scF - vec3f(halfSpan) >= srcSizeF)) {
    return SrcSample(vec3f(0.0), 0.0, vec3f(0.0), -1.0);
  }
  var sumAlb = vec3f(0.0);
  var sumEmi = vec3f(0.0);
  var sumA = 0.0;
  var maxA = 0.0;
  var hintSum = 0.0;
  var hintCount = 0.0;

  for (var dz = -1; dz <= 1; dz += 2) {
    for (var dy = -1; dy <= 1; dy += 2) {
      for (var dx = -1; dx <= 1; dx += 2) {
        let p = scF + vec3f(f32(dx), f32(dy), f32(dz)) * halfSpan;
        let sc = vec3i(floor(p));
        if (any(sc < vec3i(0)) || any(sc >= srcSizeI)) { continue; }
        let ao = textureLoad(srcAlbedoTex, sc, 0);
        let a = clamp(ao.a, 0.0, 1.0);
        if (a > 0.01) {
          let es = textureLoad(srcEmissiveTex, sc, 0);
          sumAlb += cleanRgb(ao.rgb) * a;
          sumEmi += cleanRgb(es.rgb) * a;
          sumA += a;
          maxA = max(maxA, a);
          if (es.a >= 0.0) {
            hintSum += es.a;
            hintCount += 1.0;
          }
        }
      }
    }
  }
  if (sumA <= 1e-4) {
    return SrcSample(vec3f(0.0), 0.0, vec3f(0.0), -1.0);
  }
  let invSumA = 1.0 / sumA;
  let avgHint = select(-1.0, hintSum / hintCount, hintCount > 0.0);
  return SrcSample(sumAlb * invSumA, maxA, sumEmi * invSumA, avgHint);
}

fn sourceOpacityAt(worldPos: vec3f) -> f32 {
  let srcOrigin = params.srcOriginVoxel.xyz;
  let srcVoxel = max(params.srcOriginVoxel.w, 1e-4);
  let srcSizeI = vec3i(params.srcSizeCasVoxel.xyz);
  let sc = vec3i(floor((worldPos - srcOrigin) / srcVoxel));
  if (any(sc < vec3i(0)) || any(sc >= srcSizeI)) {
    return 0.0;
  }
  return clamp(textureLoad(srcAlbedoTex, sc, 0).a, 0.0, 1.0);
}

// Exact 3D DDA direct sun shadow trace through the source voxel occupancy grid.
fn traceSourceSunVis(startWorld: vec3f, sunDir: vec3f) -> f32 {
  let srcOrigin = params.srcOriginVoxel.xyz;
  let srcVoxel = max(params.srcOriginVoxel.w, 1e-4);
  let srcSizeI = vec3i(params.srcSizeCasVoxel.xyz);

  let ro = (startWorld - srcOrigin) / srcVoxel;
  var cell = vec3i(floor(ro));
  if (any(cell < vec3i(0)) || any(cell >= srcSizeI)) {
    return 1.0;
  }

  let invRd = safeInvDir(sunDir);
  let stepDir = select(vec3i(-1), vec3i(1), sunDir >= vec3f(0.0));
  let ahead = select(vec3f(0.0), vec3f(1.0), sunDir >= vec3f(0.0));
  let axisActive = abs(sunDir) >= vec3f(1e-6);
  var sideDist = select(vec3f(1e20), (vec3f(cell) + ahead - ro) * invRd, axisActive);
  let deltaDist = select(vec3f(1e20), abs(invRd), axisActive);

  for (var s = 0u; s < 96u; s++) {
    if (any(cell < vec3i(0)) || any(cell >= srcSizeI)) {
      return 1.0;
    }
    if (textureLoad(srcAlbedoTex, cell, 0).a >= 0.5) {
      return 0.0;
    }
    if (sideDist.x <= sideDist.y && sideDist.x <= sideDist.z) {
      sideDist.x += deltaDist.x;
      cell.x += stepDir.x;
    } else if (sideDist.y <= sideDist.z) {
      sideDist.y += deltaDist.y;
      cell.y += stepDir.y;
    } else {
      sideDist.z += deltaDist.z;
      cell.z += stepDir.z;
    }
  }
  return 1.0;
}

@compute @workgroup_size(4, 4, 4)
fn cs_inject_radiance(@builtin(global_invocation_id) gid: vec3u) {
  let cascadeIdx = params.cascadeDims.x;
  let dimU = params.cascadeDims.yzw;
  if (any(gid >= dimU)) {
    return;
  }

  let curOrigin = params.curOriginFrame.xyz;
  let frameIdx = u32(max(params.curOriginFrame.w, 0));
  let prevOrigin = params.prevOriginFlags.xyz;
  let flags = u32(params.prevOriginFlags.w);
  let prevValid = (flags & 1u) != 0u;
  let forceFull = (flags & 2u) != 0u;
  let amortizeStride = max((flags >> 8u) & 0xffu, 1u);

  let w = curOrigin + vec3i(gid);
  let tc = toroidalCoord(w, dimU);
  let dimI = vec3i(dimU);

  // Detect whether this world voxel just entered the toroidal clipmap window on camera movement.
  let isNewSlab = !prevValid || any(w < prevOrigin) || any(w >= prevOrigin + dimI);

  // Incremental amortization: existing slabs not selected this frame preserve previous radiance.
  if (!forceFull && !isNewSlab && amortizeStride > 1u) {
    let sliceIdx = u32(bitcast<u32>(w.z) + frameIdx) % amortizeStride;
    if (sliceIdx != 0u) {
      let prevIso = loadCascadeMip(cascadeIdx, vec3i(tc), 0);
      textureStore(cascadeOut, vec3i(tc), prevIso);
      copySixFaces(cascadeIdx, tc, dimU);
      return;
    }
  }

  let casVoxel = params.srcSizeCasVoxel.w;
  let worldCenter = (vec3f(w) + 0.5) * casVoxel;
  let src = sampleSourceVoxel(worldCenter, casVoxel);

  var faceRad = array<vec3f, 6>(
    vec3f(0.0), vec3f(0.0), vec3f(0.0),
    vec3f(0.0), vec3f(0.0), vec3f(0.0),
  );

  if (src.opacity <= 0.001) {
    // Empty air voxels have m0.a == 0 so facesOut is never read; skip 36-byte DRAM write.
    textureStore(cascadeOut, vec3i(tc), vec4f(0.0));
    return;
  }

  let maxAlb = params.skyZenithMaxAlb.w;
  let albedo = clamp(src.albedo, vec3f(0.0), vec3f(maxAlb));
  let emissive = src.emissive;
  let sunDir = params.sunDirFeedback.xyz;
  let feedback = params.sunDirFeedback.w;
  let sunIrr = params.sunIrrMaxRad.xyz;
  let maxRad = params.sunIrrMaxRad.w;
  let skyZenith = params.skyZenithMaxAlb.xyz;
  let skyHorizon = params.skyHorizonAlpha.xyz;
  let tempAlpha = params.skyHorizonAlpha.w;
  let skyGround = params.skyGroundRays.xyz;
  let gatherCount = clamp(u32(params.skyGroundRays.w), 4u, 16u);
  let sunGlow = params.cascadeVoxelsGlow.w;
  let hasSun = max(sunIrr.r, max(sunIrr.g, sunIrr.b)) > 1e-5;

  var exposedSum = vec3f(0.0);
  var exposedCount = 0.0;
  let baseSeed = hash31(bitcast<vec3u>(w) ^ vec3u(frameIdx * 1664525u + 1013904223u));
  let temporalRot = fract(f32(frameIdx) * 0.61803398875 + baseSeed) * 2.0 * GI_PI;

  for (var f = 0u; f < 6u; f++) {
    let fNorm = faceNormalF(f);
    let neighborWorld = worldCenter + fNorm * casVoxel;
    let neighOpp = sourceOpacityAt(neighborWorld);
    if (neighOpp >= 0.5) {
      // Buried internal face between two solid voxels: zero outgoing radiance.
      continue;
    }

    // 1. Direct sunlit surface radiance.
    var directRad = vec3f(0.0);
    if (hasSun) {
      let ndotl = max(dot(fNorm, sunDir), 0.0);
      if (ndotl > 1e-4) {
        var sunVis = 1.0;
        if (src.sunHint >= 0.0) {
          sunVis = clamp(src.sunHint, 0.0, 1.0);
        } else {
          sunVis = traceSourceSunVis(neighborWorld, sunDir);
        }
        directRad = albedo * sunIrr * (ndotl * sunVis);
      }
    }

    let directPlusEmissive = directRad + emissive;

    // 2. Multi-bounce indirect radiance gathered from previous frame's 3D clipmap.
    var indirectRad = vec3f(0.0);
    if (prevValid && !isNewSlab && feedback > 1e-4) {
      let basis = makeBasis(fNorm);
      var skyGather = vec3f(0.0);
      var bounceGather = vec3f(0.0);
      let invCount = 1.0 / f32(gatherCount);
      for (var r = 0u; r < 16u; r++) {
        if (r >= gatherCount) { break; }
        // Fibonacci / stratified cosine-weighted hemisphere directions rotated per voxel & frame.
        let u1 = (f32(r) + 0.5) * invCount;
        let phi = temporalRot + f32(r) * 2.39996323 + f32(f) * 1.04719755;
        let rad = sqrt(clamp(u1, 0.0, 0.999));
        let localDir = vec3f(rad * cos(phi), rad * sin(phi), sqrt(max(0.0, 1.0 - u1)));
        let rayDir = normalize(basis * localDir);
        let hit = traceClipmapDDA(
          neighborWorld,
          rayDir,
          20u,
          dimU,
          params.prevCascadeOrigins,
          params.cascadeVoxelsGlow,
          sunDir,
          skyZenith,
          skyHorizon,
          skyGround,
          sunGlow,
        );
        if (hit.a < 0.0) {
          skyGather += hit.rgb;
        } else {
          bounceGather += hit.rgb;
        }
      }
      // Keep direct-sunlit faces and outdoor sky-bounce physically conservative (raw albedo) so
      // bright outdoor facades and street-facing recesses do not glow; apply smooth hue-preserving
      // multi-bounce compensation only to shadowed surface-to-surface bounce so 2nd/3rd indoor sun
      // bounce survives AgX's shadow toe (strictly <= maxAlb; sealed rooms stay exact 0.00000).
      let isShadowed = max(directRad.r, max(directRad.g, directRad.b)) < 1e-4;
      var bounceAlb = albedo;
      if (isShadowed) {
        let peak = max(albedo.r, max(albedo.g, albedo.b));
        if (peak > 1e-4) {
          let liftedPeak = min(min(mix(peak, pow(peak, 0.35), 0.72), peak * 1.8), maxAlb);
          bounceAlb = albedo * (liftedPeak / peak);
        }
      }
      let newIndirect = (albedo * skyGather + bounceAlb * bounceGather) * (feedback * invCount);
      let prevTotal = readFaceRad(cascadeIdx, tc, f, dimU);
      let prevIndirect = max(prevTotal - directPlusEmissive, vec3f(0.0));
      indirectRad = mix(prevIndirect, newIndirect, tempAlpha);
    }

    let finalRad = min(cleanRgb(directPlusEmissive + indirectRad), vec3f(maxRad));
    faceRad[f] = finalRad;
    exposedSum += finalRad;
    exposedCount += 1.0;
  }

  let avgRad = select(vec3f(0.0), exposedSum / exposedCount, exposedCount > 0.0);
  // Store premultiplied radiance (.rgb = L * opacity) and opacity (.a) in mip 0.
  textureStore(cascadeOut, vec3i(tc), vec4f(min(avgRad, vec3f(maxRad)) * src.opacity, src.opacity));
  writeSixFaces(cascadeIdx, tc, dimU, faceRad);
}
`

// ── Pass 2: cs_mip_radiance ──────────────────────────────────────────────────

const MIP_WGSL = /* wgsl */ `
struct MipParams {
  dstDims: vec4u,
  srcDims: vec4u,
}

@group(0) @binding(0) var srcMip: texture_3d<f32>;
@group(0) @binding(1) var dstMip: texture_storage_3d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: MipParams;

@compute @workgroup_size(4, 4, 4)
fn cs_mip_radiance(@builtin(global_invocation_id) gid: vec3u) {
  let dst = params.dstDims.xyz;
  if (any(gid >= dst)) {
    return;
  }

  let base = vec3i(gid * 2u);
  let srcMax = vec3i(params.srcDims.xyz) - vec3i(1);

  var c = array<vec4f, 8>();
  var sumRgb = vec3f(0.0);
  var sumA = 0.0;

  var idx = 0u;
  for (var dz = 0; dz <= 1; dz++) {
    for (var dy = 0; dy <= 1; dy++) {
      for (var dx = 0; dx <= 1; dx++) {
        let p = min(base + vec3i(dx, dy, dz), srcMax);
        let v = textureLoad(srcMip, p, 0);
        let a = clamp(v.a, 0.0, 1.0);
        let rgb = select(vec3f(0.0), v.rgb, v.rgb >= vec3f(0.0));
        c[idx] = vec4f(min(rgb, vec3f(65000.0)), a);
        sumRgb += c[idx].rgb;
        sumA += a;
        idx += 1u;
      }
    }
  }

  if (sumA <= 1e-5) {
    textureStore(dstMip, vec3i(gid), vec4f(0.0));
    return;
  }

  // Directional-average volumetric opacity (preserves thin-wall blocking without darkening color).
  let aX = 0.25 * (
    (c[0].a + c[1].a - c[0].a * c[1].a) +
    (c[2].a + c[3].a - c[2].a * c[3].a) +
    (c[4].a + c[5].a - c[4].a * c[5].a) +
    (c[6].a + c[7].a - c[6].a * c[7].a)
  );
  let aY = 0.25 * (
    (c[0].a + c[2].a - c[0].a * c[2].a) +
    (c[1].a + c[3].a - c[1].a * c[3].a) +
    (c[4].a + c[6].a - c[4].a * c[6].a) +
    (c[5].a + c[7].a - c[5].a * c[7].a)
  );
  let aZ = 0.25 * (
    (c[0].a + c[4].a - c[0].a * c[4].a) +
    (c[1].a + c[5].a - c[1].a * c[5].a) +
    (c[2].a + c[6].a - c[2].a * c[6].a) +
    (c[3].a + c[7].a - c[3].a * c[7].a)
  );
  let mipA = clamp((aX + aY + aZ) * (1.0 / 3.0), 0.0, 1.0);
  let avgSurfaceL = sumRgb / sumA;
  textureStore(dstMip, vec3i(gid), vec4f(min(avgSurfaceL * mipA, vec3f(65000.0)), mipA));
}
`

// ── Pass 3: cs_trace_gi ──────────────────────────────────────────────────────

const TRACE_WGSL = /* wgsl */ `
${COMMON_GI_WGSL}

struct TraceParams {
  // xy: active renderSize, zw: 1 / renderSize
  renderInfo: vec4f,
  // xy: allocated input size, zw: 1 / allocSize
  allocInfo: vec4f,
  // xyz: camera eye (cells), w: nearDist (cells)
  camEyeNear: vec4f,
  // xyz: camera forward, w: farDist (cells)
  camFwdFar: vec4f,
  // xyz: camera right, w: tanHalf
  camRightTan: vec4f,
  // xyz: camera up, w: aspect
  camUpAspect: vec4f,
  // xyz: cascadeDim, w: frameIndex
  cascadeDimFrame: vec4u,
  // x: mode (0=stochastic, 1=5-cone VCT), y: spp (1..2), z: maxSteps, w: normalEncoding
  traceFlags: vec4u,
  // xyz: cascade origin, w: valid
  cascadeOrigins: array<vec4i, 3>,
  // x: vox0, y: vox1, z: vox2, w: maxRayDist
  cascadeVoxels: vec4f,
  // xyz: skyZenith, w: sunGlow
  skyZenithGlow: vec4f,
  // xyz: skyHorizon, w: indirectScale
  skyHorizonScale: vec4f,
  // xyz: skyGround, w: pad
  skyGroundPad: vec4f,
  // xyz: sunDir, w: pad
  sunDirPad: vec4f,
}

@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var normalTex: texture_2d<f32>;
@group(0) @binding(2) var prevCas0: texture_3d<f32>;
@group(0) @binding(3) var prevCas1: texture_3d<f32>;
@group(0) @binding(4) var prevCas2: texture_3d<f32>;
@group(0) @binding(5) var<storage, read> facesIn: array<u32>;
@group(0) @binding(6) var rawGiOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var repeatSamp: sampler;
@group(0) @binding(8) var<uniform> params: TraceParams;

${CLIPMAP_TRACE_WGSL}

fn decodeNormal(raw: vec3f, encoding: u32) -> vec3f {
  let n = select(raw, raw * 2.0 - 1.0, encoding != 0u);
  let l2 = dot(n, n);
  if (l2 < 1e-4) {
    return vec3f(0.0);
  }
  return n * inverseSqrt(l2);
}

@compute @workgroup_size(8, 8)
fn cs_trace_gi(@builtin(global_invocation_id) gid: vec3u) {
  let renderSizeI = vec2i(params.renderInfo.xy);
  let px = vec2i(gid.xy);
  if (px.x >= renderSizeI.x || px.y >= renderSizeI.y) {
    return;
  }

  let depth = textureLoad(depthTex, px, 0);
  let n = decodeNormal(textureLoad(normalTex, px, 0).xyz, params.traceFlags.w);
  if (depth >= 0.99995 || dot(n, n) < 0.25) {
    textureStore(rawGiOut, px, vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  // Reconstruct world-space position (in cells) matching gpu.ts viewProjection & march.ts.
  let uv = (vec2f(px) + 0.5) * params.renderInfo.zw;
  let sx = (uv.x * 2.0 - 1.0) * params.camRightTan.w * params.camUpAspect.w;
  let sy = (1.0 - uv.y * 2.0) * params.camRightTan.w;
  let rayStep = params.camFwdFar.xyz + params.camRightTan.xyz * sx + params.camUpAspect.xyz * sy;
  let linZ = linearDepth(depth, params.camEyeNear.w, params.camFwdFar.w);
  let worldPos = params.camEyeNear.xyz + rayStep * linZ;

  let dimU = params.cascadeDimFrame.xyz;
  let frameIdx = params.cascadeDimFrame.w;
  let mode = params.traceFlags.x;
  let spp = clamp(params.traceFlags.y, 1u, 2u);
  let maxSteps = clamp(params.traceFlags.z, 8u, 64u);
  let vox0 = params.cascadeVoxels.x;
  let maxRayDist = max(params.cascadeVoxels.w, 1.0);
  let sunDir = params.sunDirPad.xyz;
  let skyZenith = params.skyZenithGlow.xyz;
  let sunGlow = params.skyZenithGlow.w;
  let skyHorizon = params.skyHorizonScale.xyz;
  let indScale = params.skyHorizonScale.w;
  let skyGround = params.skyGroundPad.xyz;

  // Offset cleanly into the adjacent air voxel along the surface normal to avoid self-intersection.
  // Pick the active cascade (0, 1, or 2) whose safe interior holds worldPos + n * 0.52 * s so both
  // near-field (Cascade 0) and mid-field recesses (~35 m, Cascade 1) escape their own coarse voxel:
  //   - If c0 = worldPos + n * 0.52 * activeVox is STILL inside the surface's own voxel
  //     (sameCell == true — e.g. grazing interior walls, far ceiling corners, or recessed alcoves),
  //     try normal-clearing candidates past our own voxel's front face before nearest-face / view escape.
  //   - If c0 already stepped across a narrow gap into a DIFFERENT opposing wall voxel (!sameCell —
  //     e.g. a narrow bay-window reveal facing an adjacent building, or a back-wall corner inside a
  //     perpendicular wall's dilated voxel), never step further along +n; use view-biased escape
  //     first, then nearest-tangent-face escape (<= 0.56 * activeVox, strictly exiting the half-voxel
  //     c0 is already in so it can never punch through a 1-voxel wall).
  // Sealed interior rooms (whose c0 is already interior air) keep 0.00000 light leak.
  let toEye = params.camEyeNear.xyz - worldPos;
  let toEyeLen = length(toEye);
  let V = select(n, toEye / max(toEyeLen, 1e-4), toEyeLen > 1e-4);
  let maxDistV = max(toEyeLen - 0.5, 0.0);
  let voxSizes = array<f32, 3>(params.cascadeVoxels.x, params.cascadeVoxels.y, params.cascadeVoxels.z);
  let dimI = vec3i(dimU);
  // Start with a tight fine-cascade normal offset (0.52 * vox0 = 42 cm) so mid-field Cascade-1
  // alcoves do not overshoot 1.7 m out into sunlit streets when already in Cascade-1 air.
  var startPos = worldPos + n * (vox0 * 0.52);
  var startC = 3u;
  for (var ciC = 0u; ciC < 3u; ciC++) {
    let origC = params.cascadeOrigins[ciC];
    if (origC.w == 0) { continue; }
    let sC = voxSizes[ciC];
    let relTest = vec3i(floor(startPos / sC)) - origC.xyz;
    if (all(relTest >= vec3i(1)) && all(relTest < dimI - vec3i(1))) {
      startC = ciC;
      break;
    }
  }
  if (startC < 3u) {
    let activeVox = voxSizes[startC];
    let origA = params.cascadeOrigins[startC];
    let activeOrigin = vec3f(origA.xyz) * activeVox;
    let surfCell = vec3i(floor((worldPos - n * (vox0 * 0.05) - activeOrigin) / activeVox));
    let c0Cell = vec3i(floor((startPos - activeOrigin) / activeVox));
    let v0 = origA.xyz + c0Cell;
    if (loadCascadeMip(startC, vec3i(toroidalCoord(v0, dimU)), 0).a >= 0.5) {
      let sameCell = all(c0Cell == surfCell);
      let blendSum = n + V * 1.2;
      let dBlend = select(V, normalize(blendSum), dot(blendSum, blendSum) > 1e-4);
      let an = abs(n);
      // Exact face-clearing step along +n past our own solid voxel's front face (avoids overshooting
      // 3.3 m in Cascade 1 while clearing grazing 80 cm Cascade-0 walls cleanly).
      let fC0 = (startPos - activeOrigin) / activeVox - vec3f(c0Cell);
      var fN = fC0.z;
      var nDom = n.z;
      if (an.x >= an.y && an.x >= an.z) {
        fN = fC0.x; nDom = n.x;
      } else if (an.y >= an.z) {
        fN = fC0.y; nDom = n.y;
      }
      let distN = select(fN + 0.06, 1.06 - fN, nDom > 0.0) * activeVox;
      let nClearPos = startPos + n * distN;
      let basePos = select(startPos, nClearPos, sameCell);
      let baseCell = vec3i(floor((basePos - activeOrigin) / activeVox));
      let fBase = (basePos - activeOrigin) / activeVox - vec3f(baseCell);
      var axA = vec3f(1.0, 0.0, 0.0);
      var axB = vec3f(0.0, 1.0, 0.0);
      var fA = fBase.x;
      var fB = fBase.y;
      if (an.x >= an.y && an.x >= an.z) {
        axA = vec3f(0.0, 1.0, 0.0); fA = fBase.y;
        axB = vec3f(0.0, 0.0, 1.0); fB = fBase.z;
      } else if (an.y >= an.z) {
        axA = vec3f(1.0, 0.0, 0.0); fA = fBase.x;
        axB = vec3f(0.0, 0.0, 1.0); fB = fBase.z;
      }
      // On axes where the camera strongly sees one side (|dot(V, ax)| > 0.35, e.g. back wall seen from +Z),
      // step strictly toward the camera side (never behind a wall). On grazing axes (<= 0.35, e.g. X at a
      // side-wall corner), step across the nearest voxel face (<= 0.56 * activeVox, never crossing a wall).
      let vA = dot(V, axA);
      let dirA = select(select(1.0, -1.0, fA < 0.5), select(-1.0, 1.0, vA > 0.0), abs(vA) > 0.35);
      let distA = select(fA + 0.06, 1.06 - fA, dirA > 0.0) * activeVox;
      let vB = dot(V, axB);
      let dirB = select(select(1.0, -1.0, fB < 0.5), select(-1.0, 1.0, vB > 0.0), abs(vB) > 0.35);
      let distB = select(fB + 0.06, 1.06 - fB, dirB > 0.0) * activeVox;
      let stepNear = select(axB * (dirB * distB), axA * (dirA * distA), distA <= distB);
      let stepFar = select(axA * (dirA * distA), axB * (dirB * distB), distA <= distB);
      let stepBoth = stepNear + stepFar;
      var escaped = false;
      if (sameCell) {
        let sameCands = array<vec3f, 9>(
          nClearPos,
          nClearPos + V * min(activeVox * 0.30, maxDistV),
          nClearPos + stepNear,
          nClearPos + stepFar,
          nClearPos + stepBoth,
          worldPos + dBlend * min(activeVox * 0.65, maxDistV),
          worldPos + V * min(activeVox * 0.75, maxDistV),
          worldPos + V * min(activeVox * 1.35, maxDistV),
          worldPos + V * min(activeVox * 1.95, maxDistV),
        );
        for (var ci = 0u; ci < 9u; ci++) {
          let candPos = sameCands[ci];
          let relCand = vec3i(floor((candPos - activeOrigin) / activeVox));
          if (any(relCand < vec3i(1)) || any(relCand >= dimI - vec3i(1))) { continue; }
          let vCand = origA.xyz + relCand;
          if (loadCascadeMip(startC, vec3i(toroidalCoord(vCand, dimU)), 0).a < 0.5) {
            startPos = candPos;
            escaped = true;
            break;
          }
        }
        if (!escaped) {
          startPos = sameCands[6];
        }
      } else {
        let diffCands = array<vec3f, 7>(
          worldPos + dBlend * min(activeVox * 0.55, maxDistV),
          worldPos + V * min(activeVox * 0.75, maxDistV),
          startPos + stepNear,
          startPos + stepFar,
          startPos + stepBoth,
          worldPos + V * min(activeVox * 1.35, maxDistV),
          worldPos + V * min(activeVox * 1.95, maxDistV),
        );
        for (var ci = 0u; ci < 7u; ci++) {
          let candPos = diffCands[ci];
          let relCand = vec3i(floor((candPos - activeOrigin) / activeVox));
          if (any(relCand < vec3i(1)) || any(relCand >= dimI - vec3i(1))) { continue; }
          let vCand = origA.xyz + relCand;
          if (loadCascadeMip(startC, vec3i(toroidalCoord(vCand, dimU)), 0).a < 0.5) {
            startPos = candPos;
            escaped = true;
            break;
          }
        }
        if (!escaped) {
          startPos = diffCands[1];
        }
      }
    }
  }
  let basis = makeBasis(n);

  if (mode == 1u) {
    // Mode 1: 5-cone diffuse Voxel Cone Tracing (1 axial cone + 4 cones at 60 deg off normal).
    let baseAngle = ign(vec2f(px)) * (0.5 * GI_PI);
    let tan30 = 0.57735027;
    var accCol = vec3f(0.0);
    var accSky = 0.0;

    let c0 = traceSingleCone(
      startPos, n, tan30, dimU, params.cascadeOrigins, params.cascadeVoxels,
      sunDir, skyZenith, skyHorizon, skyGround, sunGlow,
    );
    accCol += c0.rgb * 0.28;
    accSky += c0.a * 0.28;

    let sin60 = 0.86602540;
    let cos60 = 0.5;
    for (var k = 0u; k < 4u; k++) {
      let phi = baseAngle + f32(k) * (0.5 * GI_PI);
      let cDir = normalize(basis * vec3f(sin60 * cos(phi), sin60 * sin(phi), cos60));
      let ck = traceSingleCone(
        startPos, cDir, tan30, dimU, params.cascadeOrigins, params.cascadeVoxels,
        sunDir, skyZenith, skyHorizon, skyGround, sunGlow,
      );
      accCol += ck.rgb * 0.18;
      accSky += ck.a * 0.18;
    }
    textureStore(rawGiOut, px, vec4f(cleanRgb(accCol * indScale), clamp(accSky, 0.0, 1.0)));
    return;
  }

  // Mode 0: Stochastic 1-spp (or 2-spp) cosine-weighted hemisphere bounce via R2 + IGN blue noise.
  let pxF = vec2f(px);
  let blue = ign(pxF + vec2f(f32(frameIdx & 63u) * 5.588238, f32((frameIdx >> 6u) & 63u) * 3.719283));
  let r2Shift = vec2f(
    fract(f32(frameIdx) * 0.7548776662),
    fract(f32(frameIdx) * 0.5698402910),
  );
  let blue2 = ign(pxF.yx + vec2f(17.13, 31.47));

  var sumCol = vec3f(0.0);
  var sumMetric = 0.0;

  for (var s = 0u; s < 2u; s++) {
    if (s >= spp) { break; }
    let sOff = f32(s) * 0.5;
    let u1 = fract(blue + r2Shift.x + sOff);
    let u2 = fract(blue2 + r2Shift.y + sOff * 0.75487766);

    let phi = 2.0 * GI_PI * u1;
    let rad = sqrt(clamp(u2, 0.0, 0.9995));
    let localDir = vec3f(rad * cos(phi), rad * sin(phi), sqrt(max(0.0, 1.0 - u2)));
    let rd = normalize(basis * localDir);

    let hit = traceClipmapDDA(
      startPos,
      rd,
      maxSteps,
      dimU,
      params.cascadeOrigins,
      params.cascadeVoxels,
      sunDir,
      skyZenith,
      skyHorizon,
      skyGround,
      sunGlow,
    );
    sumCol += hit.rgb;
    let metric = select(clamp(hit.a / maxRayDist, 0.0, 0.99), 1.0, hit.a < 0.0);
    sumMetric += metric;
  }

  let invSpp = 1.0 / f32(spp);
  textureStore(rawGiOut, px, vec4f(cleanRgb(sumCol * (invSpp * indScale)), sumMetric * invSpp));
}
`

// ── Pass 4a: cs_svgf_temporal ────────────────────────────────────────────────

const TEMPORAL_WGSL = /* wgsl */ `
${COMMON_GI_WGSL}

struct TemporalParams {
  // xy: active renderSize, zw: 1 / renderSize
  renderInfo: vec4f,
  // xy: previous frame active renderSize, zw: 1 / prevRenderSize
  prevRenderInfo: vec4f,
  // x: nearDist, y: farDist, z: normalEncoding, w: resetFlag (1 = reset)
  camProj: vec4f,
  // x: maxHistory, y: minAlpha, z: depthRelThresh (0.05), w: normalDotThresh (0.85)
  svgfCfg: vec4f,
}

@group(0) @binding(0) var rawGiTex: texture_2d<f32>;
@group(0) @binding(1) var depthTex: texture_depth_2d;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var velTex: texture_2d<f32>;
@group(0) @binding(4) var histGiIn: texture_2d<f32>;
@group(0) @binding(5) var histMomIn: texture_2d<f32>;
@group(0) @binding(6) var prevGeomIn: texture_2d<f32>;
@group(0) @binding(7) var histGiOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var histMomOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var prevGeomOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var<uniform> params: TemporalParams;

fn decodeNorm(raw: vec3f, encoding: f32) -> vec3f {
  let n = select(raw, raw * 2.0 - 1.0, encoding > 0.5);
  let l2 = dot(n, n);
  if (l2 < 1e-4) {
    return vec3f(0.0);
  }
  return n * inverseSqrt(l2);
}

@compute @workgroup_size(8, 8)
fn cs_svgf_temporal(@builtin(global_invocation_id) gid: vec3u) {
  let renderSizeF = params.renderInfo.xy;
  let renderSizeI = vec2i(renderSizeF);
  let px = vec2i(gid.xy);
  if (px.x >= renderSizeI.x || px.y >= renderSizeI.y) {
    return;
  }

  let nearDist = params.camProj.x;
  let farDist = params.camProj.y;
  let normEnc = params.camProj.z;
  let resetFlag = params.camProj.w > 0.5;

  let curDepth = textureLoad(depthTex, px, 0);
  let curN = decodeNorm(textureLoad(normalTex, px, 0).xyz, normEnc);
  let curZ = linearDepth(curDepth, nearDist, farDist);
  let curZClamped = min(curZ, GI_F16_MAX);

  // Store current frame geometry for next frame's disocclusion test.
  textureStore(prevGeomOut, px, vec4f(curN, curZClamped));

  if (curDepth >= 0.99995 || dot(curN, curN) < 0.25) {
    textureStore(histGiOut, px, vec4f(0.0));
    textureStore(histMomOut, px, vec4f(0.0));
    return;
  }

  let curGi = cleanRgb(textureLoad(rawGiTex, px, 0).rgb);
  let curLum = giLuma(curGi);

  let maxHistory = params.svgfCfg.x;
  let minAlpha = params.svgfCfg.y;
  let depthRelThresh = params.svgfCfg.z;
  let normalDotThresh = params.svgfCfg.w;

  var outGi = curGi;
  var m1 = curLum;
  var m2 = curLum * curLum;
  var histLen = 1.0;

  // Bilateral 2x2 temporal reprojection matching taa.ts velocity convention (prevUV = curUV + vel).
  if (!resetFlag && params.prevRenderInfo.x > 0.5 && params.prevRenderInfo.y > 0.5) {
    let curUV = (vec2f(px) + 0.5) * params.renderInfo.zw;
    let velRaw = textureLoad(velTex, px, 0).xy;
    let velFinite = all(velRaw >= vec2f(-100.0)) && all(velRaw <= vec2f(100.0));
    let vel = select(vec2f(0.0), velRaw, velFinite);
    let prevUV = curUV + vel;

    if (all(prevUV >= vec2f(0.0)) && all(prevUV < vec2f(1.0))) {
      let prevSizeF = params.prevRenderInfo.xy;
      let prevSizeI = vec2i(prevSizeF);
      let prevPos = prevUV * prevSizeF - 0.5;
      let baseI = vec2i(floor(prevPos));
      let frac = clamp(prevPos - vec2f(baseI), vec2f(0.0), vec2f(1.0));

      let bW = array<f32, 4>(
        (1.0 - frac.x) * (1.0 - frac.y),
        frac.x * (1.0 - frac.y),
        (1.0 - frac.x) * frac.y,
        frac.x * frac.y,
      );
      let offs = array<vec2i, 4>(
        vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1),
      );

      var sumGi = vec3f(0.0);
      var sumMom = vec3f(0.0);
      var sumW = 0.0;

      for (var i = 0u; i < 4u; i++) {
        let tc = baseI + offs[i];
        if (tc.x < 0 || tc.y < 0 || tc.x >= prevSizeI.x || tc.y >= prevSizeI.y) {
          continue;
        }
        let prevGeom = textureLoad(prevGeomIn, tc, 0);
        let prevN = prevGeom.xyz;
        let prevZ = prevGeom.w;
        if (dot(prevN, prevN) < 0.25) {
          continue;
        }
        let nDot = dot(curN, prevN);
        let relDz = abs(curZClamped - prevZ) / max(curZClamped, 1e-3);
        if (nDot > normalDotThresh && relDz < depthRelThresh) {
          let w = bW[i];
          sumGi += cleanRgb(textureLoad(histGiIn, tc, 0).rgb) * w;
          sumMom += textureLoad(histMomIn, tc, 0).xyz * w;
          sumW += w;
        }
      }

      if (sumW > 0.01) {
        let invW = 1.0 / sumW;
        let prevGi = sumGi * invW;
        let prevMom = sumMom * invW;
        histLen = min(max(prevMom.z, 0.0) + 1.0, maxHistory);
        let alpha = max(1.0 / histLen, minAlpha);

        outGi = mix(prevGi, curGi, alpha);
        m1 = mix(max(prevMom.x, 0.0), curLum, alpha);
        m2 = mix(max(prevMom.y, 0.0), curLum * curLum, alpha);
      }
    }
  }

  var variance = max(0.0, m2 - m1 * m1);

  // Spatial 3x3 bilateral variance fallback when N < 4 (frame 0 or right after disocclusion).
  if (histLen < 4.0) {
    var sM1 = curLum;
    var sM2 = curLum * curLum;
    var sW = 1.0;

    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) { continue; }
        let q = px + vec2i(dx, dy);
        if (q.x < 0 || q.y < 0 || q.x >= renderSizeI.x || q.y >= renderSizeI.y) {
          continue;
        }
        let qDepth = textureLoad(depthTex, q, 0);
        if (qDepth >= 0.99995) { continue; }
        let qN = decodeNorm(textureLoad(normalTex, q, 0).xyz, normEnc);
        if (dot(qN, qN) < 0.25) { continue; }
        let qZ = min(linearDepth(qDepth, nearDist, farDist), GI_F16_MAX);

        let wN = pow(max(0.0, dot(curN, qN)), 64.0);
        let wZ = exp(-abs(curZClamped - qZ) / max(0.02 * curZClamped, 0.25));
        let w = wN * wZ;
        if (w > 1e-4) {
          let qLum = giLuma(cleanRgb(textureLoad(rawGiTex, q, 0).rgb));
          sM1 += qLum * w;
          sM2 += qLum * qLum * w;
          sW += w;
        }
      }
    }
    let mean1 = sM1 / sW;
    let mean2 = sM2 / sW;
    let spatialVar = max(0.0, mean2 - mean1 * mean1);
    let boost = 4.0 / max(histLen, 1.0);
    variance = max(variance, spatialVar * boost);
  }

  textureStore(histGiOut, px, vec4f(cleanRgb(outGi), clamp(variance, 0.0, 1000.0)));
  textureStore(histMomOut, px, vec4f(clamp(m1, 0.0, GI_F16_MAX), clamp(m2, 0.0, GI_F16_MAX), histLen, 0.0));
}
`

// ── Pass 4b: cs_svgf_atrous ──────────────────────────────────────────────────

const ATROUS_WGSL = /* wgsl */ `
${COMMON_GI_WGSL}

struct AtrousParams {
  // xy: active renderSize, zw: 1 / renderSize
  renderInfo: vec4f,
  // x: nearDist, y: farDist, z: normalEncoding, w: pad
  camProj: vec4f,
  // x: stepSize (1, 2, 4), y: sigmaZ, z: sigmaL, w: normalPower (64)
  filtCfg: vec4f,
}

@group(0) @binding(0) var srcGiTex: texture_2d<f32>;
// Packed current-frame geometry from cs_svgf_temporal: xyz = unit world normal, w = linearZ (clamped f16).
@group(0) @binding(1) var geomTex: texture_2d<f32>;
@group(0) @binding(2) var dstGiOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: AtrousParams;

fn fastNormalWeight(nDot: f32, normalPow: f32) -> f32 {
  if (abs(normalPow - 64.0) < 0.01) {
    let d2 = nDot * nDot;
    let d4 = d2 * d2;
    let d8 = d4 * d4;
    let d16 = d8 * d8;
    let d32 = d16 * d16;
    return d32 * d32;
  }
  return pow(nDot, normalPow);
}

fn samePlaneGradZ(px: vec2i, nP: vec3f, zP: f32, delta: vec2i, maxI: vec2i) -> f32 {
  let qA = clamp(px + delta, vec2i(0), maxI);
  let qB = clamp(px - delta, vec2i(0), maxI);
  let gA = textureLoad(geomTex, qA, 0);
  let gB = textureLoad(geomTex, qB, 0);
  let okA = gA.w < 64000.0 && dot(nP, gA.xyz) > 0.85;
  let okB = gB.w < 64000.0 && dot(nP, gB.xyz) > 0.85;
  let dA = abs(gA.w - zP);
  let dB = abs(zP - gB.w);
  if (okA && okB) { return min(dA, dB); }
  if (okA) { return dA; }
  if (okB) { return dB; }
  return 0.0;
}

@compute @workgroup_size(8, 8)
fn cs_svgf_atrous(@builtin(global_invocation_id) gid: vec3u) {
  let renderSizeI = vec2i(params.renderInfo.xy);
  let px = vec2i(gid.xy);
  if (px.x >= renderSizeI.x || px.y >= renderSizeI.y) {
    return;
  }
  let maxI = renderSizeI - vec2i(1);

  let centerGeom = textureLoad(geomTex, px, 0);
  let nP = centerGeom.xyz;
  let zP = centerGeom.w;
  if (zP >= 64000.0 || dot(nP, nP) < 0.25) {
    textureStore(dstGiOut, px, vec4f(0.0));
    return;
  }

  let centerData = textureLoad(srcGiTex, px, 0);
  let cP = cleanRgb(centerData.rgb);
  let lP = giLuma(cP);

  // 3x3 Gaussian pre-filtered variance estimate (Schied et al. 2017, Sec. 4.3).
  var filtVar = 0.0;
  var filtVarW = 0.0;
  for (var vy = -1; vy <= 1; vy++) {
    for (var vx = -1; vx <= 1; vx++) {
      let q = px + vec2i(vx, vy);
      if (q.x < 0 || q.y < 0 || q.x >= renderSizeI.x || q.y >= renderSizeI.y) {
        continue;
      }
      let gw = select(select(0.25, 0.125, vx != 0 || vy != 0), 0.0625, vx != 0 && vy != 0);
      let v = max(textureLoad(srcGiTex, q, 0).a, 0.0);
      filtVar += v * gw;
      filtVarW += gw;
    }
  }
  let varCenter = filtVar / max(filtVarW, 1e-5);

  // Same-plane depth gradient prevents 90-deg corner neighbors from corrupting floor/wall depth slope.
  let gradZ = vec2f(
    samePlaneGradZ(px, nP, zP, vec2i(1, 0), maxI),
    samePlaneGradZ(px, nP, zP, vec2i(0, 1), maxI),
  );

  let stepSize = i32(params.filtCfg.x);
  let sigmaZ = params.filtCfg.y;
  let sigmaL = params.filtCfg.z;
  let normalPow = params.filtCfg.w;
  let baseZ = 0.005 * zP + 1e-4;
  let centerVar = max(varCenter, 0.0);
  let invCenterDenomL = 1.0 / (sigmaL * sqrt(centerVar) + 1e-4);

  // Separable 5x5 B3-spline wavelet weights: [1/16, 1/4, 3/8, 1/4, 1/16].
  let k1d = array<f32, 3>(0.375, 0.25, 0.0625);

  var sumCol = cP * (k1d[0] * k1d[0]);
  var sumVar = max(centerData.a, 0.0) * (k1d[0] * k1d[0]) * (k1d[0] * k1d[0]);
  var sumW = k1d[0] * k1d[0];

  for (var dy = -2; dy <= 2; dy++) {
    let ky = k1d[abs(dy)];
    let absDyStep = abs(f32(dy * stepSize)) * gradZ.y;
    for (var dx = -2; dx <= 2; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = px + vec2i(dx * stepSize, dy * stepSize);
      if (q.x < 0 || q.y < 0 || q.x >= renderSizeI.x || q.y >= renderSizeI.y) {
        continue;
      }

      let qGeom = textureLoad(geomTex, q, 0);
      let zQ = qGeom.w;
      if (zQ >= 64000.0) { continue; }
      let nDot = dot(nP, qGeom.xyz);
      if (nDot <= 0.0) { continue; }

      let wN = fastNormalWeight(nDot, normalPow);
      if (wN < 1e-5) { continue; }

      let expectedDz = abs(f32(dx * stepSize)) * gradZ.x + absDyStep;
      let termZ = abs(zP - zQ) / (sigmaZ * expectedDz + baseZ);

      let qData = textureLoad(srcGiTex, q, 0);
      let cQ = cleanRgb(qData.rgb);
      let lQ = giLuma(cQ);
      // Symmetric pair variance prevents asymmetric firefly energy loss while keeping low-variance shadow edges sharp.
      let qVar = max(qData.a, 0.0);
      var termL = abs(lP - lQ) * invCenterDenomL;
      if (qVar > centerVar) {
        termL = abs(lP - lQ) / (sigmaL * sqrt(qVar) + 1e-4);
      }

      let w = k1d[abs(dx)] * ky * wN * exp(-(termZ + termL));
      sumCol += cQ * w;
      sumVar += qVar * (w * w);
      sumW += w;
    }
  }

  let invW = 1.0 / max(sumW, 1e-6);
  let outCol = cleanRgb(sumCol * invW);
  let outVar = clamp(sumVar * (invW * invW), 0.0, 1000.0);
  textureStore(dstGiOut, px, vec4f(outCol, outVar));
}
`

// ── Uniform sizes & helpers ──────────────────────────────────────────────────

const INJECT_UBO_BYTES = 224
const MIP_UBO_BYTES = 32
const TRACE_UBO_BYTES = 256
const TEMPORAL_UBO_BYTES = 64
const ATROUS_UBO_BYTES = 48
const FACE_WORDS_PER_VOXEL = 9
const ATROUS_STEPS = [1, 2, 4] as const

function isPow2(n: number): boolean {
  return Number.isInteger(n) && n >= 8 && (n & (n - 1)) === 0
}

function unitVec3(v: Vec3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2])
  if (l < 1e-8) return [0, 1, 0]
  return [v[0] / l, v[1] / l, v[2] / l]
}

function snapAnchor(camCoord: number, voxelCells: number, dim: number): number {
  const half = dim * 0.5
  const raw = camCoord / voxelCells - half
  return Math.floor(raw / 4) * 4
}

/**
 * Creates Voxelwright's standalone Voxel-Native Global Illumination & SVGF denoiser pipeline.
 *
 * Pre-allocates all 3D toroidal clipmap textures (3 cascades x 3 mips, ping-ponged for
 * hazard-free multi-bounce feedback), 6-face directional radiance buffers, and screen-space
 * SVGF textures up to `maxSize` so dynamic resolution changes (`renderSize <= maxSize`)
 * perform zero GPU reallocations and zero per-frame JS heap allocations.
 */
export async function createVoxelGI(
  device: GPUDevice,
  options: VoxelGIOptions = {},
): Promise<VoxelGIPass> {
  const SCREEN_TEX_USAGE =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_SRC
  const CASCADE_TEX_USAGE =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.COPY_DST
  const cascadeSize: readonly [number, number, number] = options.cascadeSize ?? GI_DEFAULT_CASCADE_SIZE
  const cascadeVoxelCells: readonly [number, number, number] = options.cascadeVoxelCells ?? GI_DEFAULT_VOXEL_CELLS
  if (!isPow2(cascadeSize[0]) || !isPow2(cascadeSize[1]) || !isPow2(cascadeSize[2])) {
    throw new Error(`createVoxelGI: cascadeSize must be powers of two >= 8, got [${cascadeSize.join(', ')}]`)
  }
  const [dimX, dimY, dimZ] = cascadeSize
  const defaultFeedback = Math.max(0, Math.min(0.85, options.bounceFeedback ?? 0.65))
  const maxRadiance = Math.max(1, Math.min(65000, options.maxRadiance ?? 64))
  const maxAlbedo = Math.max(0.05, Math.min(0.95, options.maxAlbedo ?? 0.90))
  const defaultAtrousPasses = Math.max(0, Math.min(3, Math.round(options.atrousPasses ?? 3)))
  const sigmaZ = Math.max(0.05, options.sigmaZ ?? 1.5)
  const sigmaL = Math.max(0.1, options.sigmaL ?? 4.0)
  const normalPower = Math.max(1, options.normalPower ?? 64.0)
  const maxHistory = Math.max(1, Math.min(64, options.maxHistory ?? 32.0))

  const [injectMod, mipMod, traceMod, temporalMod, atrousMod] = await Promise.all([
    shader(device, 'gi-inject', INJECT_WGSL),
    shader(device, 'gi-mip', MIP_WGSL),
    shader(device, 'gi-trace', TRACE_WGSL),
    shader(device, 'gi-svgf-temporal', TEMPORAL_WGSL),
    shader(device, 'gi-svgf-atrous', ATROUS_WGSL),
  ])

  // ── Explicit BindGroupLayouts ─────────────────────────────────────────────

  const injectLayout = device.createBindGroupLayout({
    label: 'gi-inject-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const mipLayout = device.createBindGroupLayout({
    label: 'gi-mip-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const traceLayout = device.createBindGroupLayout({
    label: 'gi-trace-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const temporalLayout = device.createBindGroupLayout({
    label: 'gi-svgf-temporal-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const atrousLayout = device.createBindGroupLayout({
    label: 'gi-svgf-atrous-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  })

  const [injectPipe, mipPipe, tracePipe, temporalPipe, atrousPipe] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'gi-inject',
      layout: device.createPipelineLayout({ bindGroupLayouts: [injectLayout] }),
      compute: { module: injectMod, entryPoint: 'cs_inject_radiance' },
    }),
    device.createComputePipelineAsync({
      label: 'gi-mip',
      layout: device.createPipelineLayout({ bindGroupLayouts: [mipLayout] }),
      compute: { module: mipMod, entryPoint: 'cs_mip_radiance' },
    }),
    device.createComputePipelineAsync({
      label: 'gi-trace',
      layout: device.createPipelineLayout({ bindGroupLayouts: [traceLayout] }),
      compute: { module: traceMod, entryPoint: 'cs_trace_gi' },
    }),
    device.createComputePipelineAsync({
      label: 'gi-svgf-temporal',
      layout: device.createPipelineLayout({ bindGroupLayouts: [temporalLayout] }),
      compute: { module: temporalMod, entryPoint: 'cs_svgf_temporal' },
    }),
    device.createComputePipelineAsync({
      label: 'gi-svgf-atrous',
      layout: device.createPipelineLayout({ bindGroupLayouts: [atrousLayout] }),
      compute: { module: atrousMod, entryPoint: 'cs_svgf_atrous' },
    }),
  ])

  const repeatSampler = device.createSampler({
    label: 'gi-cascade-repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    addressModeW: 'repeat',
  })

  const linearSampler = device.createSampler({
    label: 'gi-screen-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  // ── 3D Toroidal Clipmap Textures (2 ping-pong sets x 3 cascades x 3 mips) ─

  const makeCascadeSet = (setIdx: number): [GPUTexture, GPUTexture, GPUTexture] => [
    device.createTexture({ label: `gi-cas-${setIdx}-0`, size: [dimX, dimY, dimZ], dimension: '3d', mipLevelCount: GI_MIP_COUNT, format: 'rgba16float', usage: CASCADE_TEX_USAGE }),
    device.createTexture({ label: `gi-cas-${setIdx}-1`, size: [dimX, dimY, dimZ], dimension: '3d', mipLevelCount: GI_MIP_COUNT, format: 'rgba16float', usage: CASCADE_TEX_USAGE }),
    device.createTexture({ label: `gi-cas-${setIdx}-2`, size: [dimX, dimY, dimZ], dimension: '3d', mipLevelCount: GI_MIP_COUNT, format: 'rgba16float', usage: CASCADE_TEX_USAGE }),
  ]

  const casTex: [[GPUTexture, GPUTexture, GPUTexture], [GPUTexture, GPUTexture, GPUTexture]] = [
    makeCascadeSet(0),
    makeCascadeSet(1),
  ]

  const casFullViews: [[GPUTextureView, GPUTextureView, GPUTextureView], [GPUTextureView, GPUTextureView, GPUTextureView]] = [
    [casTex[0][0].createView({ dimension: '3d' }), casTex[0][1].createView({ dimension: '3d' }), casTex[0][2].createView({ dimension: '3d' })],
    [casTex[1][0].createView({ dimension: '3d' }), casTex[1][1].createView({ dimension: '3d' }), casTex[1][2].createView({ dimension: '3d' })],
  ]

  // Per-mip single-level views [setIdx][cascadeIdx][mipLevel] for cs_inject_radiance & cs_mip_radiance.
  const casMipViews: GPUTextureView[][][] = [0, 1].map((s) =>
    [0, 1, 2].map((c) =>
      [0, 1, 2].map((m) =>
        casTex[s][c].createView({ dimension: '3d', baseMipLevel: m, mipLevelCount: 1 }),
      ),
    ),
  )

  const voxelsPerCascade = dimX * dimY * dimZ
  const faceBufBytes = GI_CASCADE_COUNT * voxelsPerCascade * FACE_WORDS_PER_VOXEL * 4
  const facesBuf: [GPUBuffer, GPUBuffer] = [
    device.createBuffer({ label: 'gi-faces-0', size: faceBufBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
    device.createBuffer({ label: 'gi-faces-1', size: faceBufBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
  ]

  // ── Uniform Buffers (separate per-pass buffers to avoid queue.writeBuffer clobber) ──

  const injectUbos: [GPUBuffer, GPUBuffer, GPUBuffer] = [0, 1, 2].map((c) =>
    device.createBuffer({ label: `gi-inject-ubo-${c}`, size: INJECT_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
  ) as [GPUBuffer, GPUBuffer, GPUBuffer]
  const injectRaw = new ArrayBuffer(INJECT_UBO_BYTES)
  const injectU32 = new Uint32Array(injectRaw)
  const injectI32 = new Int32Array(injectRaw)
  const injectF32 = new Float32Array(injectRaw)

  // Constant mip uniforms for mip 0->1 and mip 1->2 (same dims across all 3 cascades).
  const mipUbos: [GPUBuffer, GPUBuffer] = [0, 1].map((m) => {
    const buf = device.createBuffer({ label: `gi-mip-ubo-${m + 1}`, size: MIP_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const raw = new ArrayBuffer(MIP_UBO_BYTES)
    const u32 = new Uint32Array(raw)
    const srcW = dimX >> m
    const srcH = dimY >> m
    const srcD = dimZ >> m
    u32[0] = Math.max(1, srcW >> 1)
    u32[1] = Math.max(1, srcH >> 1)
    u32[2] = Math.max(1, srcD >> 1)
    u32[3] = 0
    u32[4] = srcW
    u32[5] = srcH
    u32[6] = srcD
    u32[7] = 0
    device.queue.writeBuffer(buf, 0, raw)
    return buf
  }) as [GPUBuffer, GPUBuffer]

  // Pre-built static mip bind groups: mipBinds[setIdx][cascadeIdx][mipIdx (0 => 0->1, 1 => 1->2)].
  const mipBinds: GPUBindGroup[][][] = [0, 1].map((s) =>
    [0, 1, 2].map((c) =>
      [0, 1].map((m) =>
        device.createBindGroup({
          label: `gi-mip-bg-${s}-${c}-${m + 1}`,
          layout: mipLayout,
          entries: [
            { binding: 0, resource: casMipViews[s][c][m] },
            { binding: 1, resource: casMipViews[s][c][m + 1] },
            { binding: 2, resource: { buffer: mipUbos[m] } },
          ],
        }),
      ),
    ),
  )

  const traceUbo = device.createBuffer({ label: 'gi-trace-ubo', size: TRACE_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const traceRaw = new ArrayBuffer(TRACE_UBO_BYTES)
  const traceF32 = new Float32Array(traceRaw)
  const traceU32 = new Uint32Array(traceRaw)
  const traceI32 = new Int32Array(traceRaw)

  const temporalUbo = device.createBuffer({ label: 'gi-temporal-ubo', size: TEMPORAL_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const temporalRaw = new ArrayBuffer(TEMPORAL_UBO_BYTES)
  const temporalF32 = new Float32Array(temporalRaw)

  const atrousUbos: [GPUBuffer, GPUBuffer, GPUBuffer] = [0, 1, 2].map((i) =>
    device.createBuffer({ label: `gi-atrous-ubo-${i}`, size: ATROUS_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
  ) as [GPUBuffer, GPUBuffer, GPUBuffer]
  const atrousRaw = new ArrayBuffer(ATROUS_UBO_BYTES)
  const atrousF32 = new Float32Array(atrousRaw)

  // ── Persistent Screen-Space Textures (0 reallocs while renderSize <= maxSize) ──

  const initMax = options.maxSize ?? [1280, 720]
  let capW = Math.max(1, Math.round(initMax[0]))
  let capH = Math.max(1, Math.round(initMax[1]))

  const makeScreenTex = (label: string, w: number, h: number) =>
    device.createTexture({ label, size: [w, h], format: 'rgba16float', usage: SCREEN_TEX_USAGE })

  let rawGiTex = makeScreenTex('gi-raw', capW, capH)
  let rawGiView = rawGiTex.createView()
  let histGiTex: [GPUTexture, GPUTexture] = [makeScreenTex('gi-hist-0', capW, capH), makeScreenTex('gi-hist-1', capW, capH)]
  let histGiView: [GPUTextureView, GPUTextureView] = [histGiTex[0].createView(), histGiTex[1].createView()]
  let histMomTex: [GPUTexture, GPUTexture] = [makeScreenTex('gi-mom-0', capW, capH), makeScreenTex('gi-mom-1', capW, capH)]
  let histMomView: [GPUTextureView, GPUTextureView] = [histMomTex[0].createView(), histMomTex[1].createView()]
  let prevGeomTex: [GPUTexture, GPUTexture] = [makeScreenTex('gi-geom-0', capW, capH), makeScreenTex('gi-geom-1', capW, capH)]
  let prevGeomView: [GPUTextureView, GPUTextureView] = [prevGeomTex[0].createView(), prevGeomTex[1].createView()]
  let atrousTex: [GPUTexture, GPUTexture] = [makeScreenTex('gi-atrous-0', capW, capH), makeScreenTex('gi-atrous-1', capW, capH)]
  let atrousView: [GPUTextureView, GPUTextureView] = [atrousTex[0].createView(), atrousTex[1].createView()]

  // ── Cached Bind Groups (zero steady-state per-frame allocations) ──────────

  interface InjectBindCache {
    albedo: GPUTextureView | null
    emissive: GPUTextureView | null
    // binds[readSetIdx] -> reads readSetIdx, writes 1 - readSetIdx
    binds: [GPUBindGroup, GPUBindGroup] | null
  }
  const injectCache: [InjectBindCache, InjectBindCache, InjectBindCache] = [
    { albedo: null, emissive: null, binds: null },
    { albedo: null, emissive: null, binds: null },
    { albedo: null, emissive: null, binds: null },
  ]

  let cachedDepth: GPUTextureView | null = null
  let cachedNormal: GPUTextureView | null = null
  let cachedVelocity: GPUTextureView | null = null
  let traceBinds: [GPUBindGroup, GPUBindGroup] | null = null
  let temporalBinds: [GPUBindGroup, GPUBindGroup] | null = null
  // atrousFirstBinds[histWriteIdx]: reads histGiView[histWriteIdx] + prevGeomView[histWriteIdx] -> writes atrousView[0] (step 1)
  let atrousFirstBinds: [GPUBindGroup, GPUBindGroup] | null = null
  // atrousStep1Binds[histWriteIdx]: reads atrousView[0] + prevGeomView[histWriteIdx] -> writes atrousView[1] (step 2)
  let atrousStep1Binds: [GPUBindGroup, GPUBindGroup] | null = null
  // atrousStep2Binds[histWriteIdx]: reads atrousView[1] + prevGeomView[histWriteIdx] -> writes atrousView[0] (step 4)
  let atrousStep2Binds: [GPUBindGroup, GPUBindGroup] | null = null

  const invalidateScreenCaches = () => {
    cachedDepth = null
    cachedNormal = null
    cachedVelocity = null
    traceBinds = null
    temporalBinds = null
    atrousFirstBinds = null
    atrousStep1Binds = null
    atrousStep2Binds = null
  }

  const getInjectBind = (cascadeIdx: 0 | 1 | 2, src: VoxelGridSource, readSet: 0 | 1): GPUBindGroup => {
    const slot = injectCache[cascadeIdx]
    if (slot.binds && slot.albedo === src.albedoOpacity && slot.emissive === src.emissiveSun) {
      return slot.binds[readSet]
    }
    slot.albedo = src.albedoOpacity
    slot.emissive = src.emissiveSun
    const makeBg = (r: 0 | 1): GPUBindGroup => {
      const w: 0 | 1 = r === 0 ? 1 : 0
      return device.createBindGroup({
        label: `gi-inject-bg-c${cascadeIdx}-r${r}`,
        layout: injectLayout,
        entries: [
          { binding: 0, resource: src.albedoOpacity },
          { binding: 1, resource: src.emissiveSun },
          { binding: 2, resource: casFullViews[r][0] },
          { binding: 3, resource: casFullViews[r][1] },
          { binding: 4, resource: casFullViews[r][2] },
          { binding: 5, resource: { buffer: facesBuf[r] } },
          { binding: 6, resource: casMipViews[w][cascadeIdx][0] },
          { binding: 7, resource: { buffer: facesBuf[w] } },
          { binding: 8, resource: repeatSampler },
          { binding: 9, resource: { buffer: injectUbos[cascadeIdx] } },
        ],
      })
    }
    slot.binds = [makeBg(0), makeBg(1)]
    return slot.binds[readSet]
  }

  const ensureScreenBinds = (depth: GPUTextureView, normal: GPUTextureView, velocity: GPUTextureView) => {
    if (
      traceBinds &&
      temporalBinds &&
      atrousFirstBinds &&
      atrousStep1Binds &&
      atrousStep2Binds &&
      cachedDepth === depth &&
      cachedNormal === normal &&
      cachedVelocity === velocity
    ) {
      return
    }
    cachedDepth = depth
    cachedNormal = normal
    cachedVelocity = velocity

    traceBinds = [0, 1].map((casIdx) =>
      device.createBindGroup({
        label: `gi-trace-bg-${casIdx}`,
        layout: traceLayout,
        entries: [
          { binding: 0, resource: depth },
          { binding: 1, resource: normal },
          { binding: 2, resource: casFullViews[casIdx][0] },
          { binding: 3, resource: casFullViews[casIdx][1] },
          { binding: 4, resource: casFullViews[casIdx][2] },
          { binding: 5, resource: { buffer: facesBuf[casIdx] } },
          { binding: 6, resource: rawGiView },
          { binding: 7, resource: repeatSampler },
          { binding: 8, resource: { buffer: traceUbo } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup]

    temporalBinds = [0, 1].map((r) => {
      const w: 0 | 1 = r === 0 ? 1 : 0
      return device.createBindGroup({
        label: `gi-temporal-bg-${r}to${w}`,
        layout: temporalLayout,
        entries: [
          { binding: 0, resource: rawGiView },
          { binding: 1, resource: depth },
          { binding: 2, resource: normal },
          { binding: 3, resource: velocity },
          { binding: 4, resource: histGiView[r] },
          { binding: 5, resource: histMomView[r] },
          { binding: 6, resource: prevGeomView[r] },
          { binding: 7, resource: histGiView[w] },
          { binding: 8, resource: histMomView[w] },
          { binding: 9, resource: prevGeomView[w] },
          { binding: 10, resource: { buffer: temporalUbo } },
        ],
      })
    }) as [GPUBindGroup, GPUBindGroup]

    atrousFirstBinds = [0, 1].map((histIdx) =>
      device.createBindGroup({
        label: `gi-atrous-0-h${histIdx}`,
        layout: atrousLayout,
        entries: [
          { binding: 0, resource: histGiView[histIdx] },
          { binding: 1, resource: prevGeomView[histIdx] },
          { binding: 2, resource: atrousView[0] },
          { binding: 3, resource: { buffer: atrousUbos[0] } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup]

    atrousStep1Binds = [0, 1].map((histIdx) =>
      device.createBindGroup({
        label: `gi-atrous-1-h${histIdx}`,
        layout: atrousLayout,
        entries: [
          { binding: 0, resource: atrousView[0] },
          { binding: 1, resource: prevGeomView[histIdx] },
          { binding: 2, resource: atrousView[1] },
          { binding: 3, resource: { buffer: atrousUbos[1] } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup]

    atrousStep2Binds = [0, 1].map((histIdx) =>
      device.createBindGroup({
        label: `gi-atrous-2-h${histIdx}`,
        layout: atrousLayout,
        entries: [
          { binding: 0, resource: atrousView[1] },
          { binding: 1, resource: prevGeomView[histIdx] },
          { binding: 2, resource: atrousView[0] },
          { binding: 3, resource: { buffer: atrousUbos[2] } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup]
  }

  // ── Runtime State ─────────────────────────────────────────────────────────

  let casCurIdx: 0 | 1 = 0
  let casValid = false
  let curOrigins: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  let prevOrigins: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]

  let histReadIdx: 0 | 1 = 0
  let historyValid = false
  let prevRenderW = 0
  let prevRenderH = 0
  let lastRenderW = 0
  let lastRenderH = 0
  let lastMode: GiTraceMode = GI_MODE_STOCHASTIC
  let reallocs = 0
  let frames = 0
  let injectCalls = 0
  let resets = 0
  let lastOutTex: GPUTexture = atrousTex[0]
  let lastOutView: GPUTextureView = atrousView[0]
  let destroyed = false

  const ensureCapacity = (w: number, h: number) => {
    if (w <= capW && h <= capH) return
    capW = Math.max(capW, w)
    capH = Math.max(capH, h)
    rawGiTex.destroy()
    histGiTex[0].destroy(); histGiTex[1].destroy()
    histMomTex[0].destroy(); histMomTex[1].destroy()
    prevGeomTex[0].destroy(); prevGeomTex[1].destroy()
    atrousTex[0].destroy(); atrousTex[1].destroy()

    rawGiTex = makeScreenTex('gi-raw', capW, capH)
    rawGiView = rawGiTex.createView()
    histGiTex = [makeScreenTex('gi-hist-0', capW, capH), makeScreenTex('gi-hist-1', capW, capH)]
    histGiView = [histGiTex[0].createView(), histGiTex[1].createView()]
    histMomTex = [makeScreenTex('gi-mom-0', capW, capH), makeScreenTex('gi-mom-1', capW, capH)]
    histMomView = [histMomTex[0].createView(), histMomTex[1].createView()]
    prevGeomTex = [makeScreenTex('gi-geom-0', capW, capH), makeScreenTex('gi-geom-1', capW, capH)]
    prevGeomView = [prevGeomTex[0].createView(), prevGeomTex[1].createView()]
    atrousTex = [makeScreenTex('gi-atrous-0', capW, capH), makeScreenTex('gi-atrous-1', capW, capH)]
    atrousView = [atrousTex[0].createView(), atrousTex[1].createView()]

    lastOutTex = atrousTex[0]
    lastOutView = atrousView[0]
    invalidateScreenCaches()
    historyValid = false
    reallocs++
  }

  const self: VoxelGIPass = {
    get giView() {
      return lastOutView
    },
    get giTexture() {
      return lastOutTex
    },
    get rawGiView() {
      return rawGiView
    },
    get rawGiTexture() {
      return rawGiTex
    },
    get cascadeViews() {
      return casFullViews[casCurIdx]
    },
    get cascadeTextures() {
      return casTex[casCurIdx]
    },
    get linearSampler() {
      return linearSampler
    },

    inject(encoder, input, timing) {
      if (destroyed) throw new Error('VoxelGIPass was destroyed')
      const sources: readonly [VoxelGridSource, VoxelGridSource, VoxelGridSource] | null =
        input.cascadeSources ?? (input.source ? [input.source, input.source, input.source] : null)
      if (!sources) throw new Error('VoxelGIPass.inject requires either `source` or `cascadeSources`')

      const readSet = casCurIdx
      const writeSet: 0 | 1 = readSet === 0 ? 1 : 0
      const doReset = !casValid || !!input.reset
      const feedback = Math.max(0, Math.min(0.85, input.bounceFeedback ?? defaultFeedback))
      const amortizeStride = Math.max(1, Math.min(8, Math.round(input.amortizeStride ?? 1)))
      const gatherAlpha = Math.max(0.1, Math.min(1.0, input.gatherTemporalAlpha ?? 0.55))
      const gatherRaysBase = Math.max(4, Math.min(16, Math.round(input.gatherRays ?? 12)))
      const sunDir = unitVec3(input.sunDir)
      const skyGround: Vec3 = input.sky.ground ?? [
        input.sky.horizon[0] * 0.22,
        input.sky.horizon[1] * 0.22,
        input.sky.horizon[2] * 0.22,
      ]
      const sunGlow = Math.max(0, input.sky.sunGlow ?? 0)

      // Compute updated snapped toroidal anchors for all 3 cascades.
      const nextOrigins: [[number, number, number], [number, number, number], [number, number, number]] = [
        [
          snapAnchor(input.cameraPosCells[0], cascadeVoxelCells[0], dimX),
          snapAnchor(input.cameraPosCells[1], cascadeVoxelCells[0], dimY),
          snapAnchor(input.cameraPosCells[2], cascadeVoxelCells[0], dimZ),
        ],
        [
          snapAnchor(input.cameraPosCells[0], cascadeVoxelCells[1], dimX),
          snapAnchor(input.cameraPosCells[1], cascadeVoxelCells[1], dimY),
          snapAnchor(input.cameraPosCells[2], cascadeVoxelCells[1], dimZ),
        ],
        [
          snapAnchor(input.cameraPosCells[0], cascadeVoxelCells[2], dimX),
          snapAnchor(input.cameraPosCells[1], cascadeVoxelCells[2], dimY),
          snapAnchor(input.cameraPosCells[2], cascadeVoxelCells[2], dimZ),
        ],
      ]

      // Write separate uniform buffer for each cascade before encoding compute passes.
      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        const src = sources[c]
        const prevValidBit = doReset ? 0 : 1
        const forceFullBit = doReset ? 2 : 0
        const flags = prevValidBit | forceFullBit | ((amortizeStride & 0xff) << 8)

        injectU32[0] = c
        injectU32[1] = dimX
        injectU32[2] = dimY
        injectU32[3] = dimZ

        injectI32[4] = nextOrigins[c][0]
        injectI32[5] = nextOrigins[c][1]
        injectI32[6] = nextOrigins[c][2]
        injectI32[7] = injectCalls

        injectI32[8] = curOrigins[c][0]
        injectI32[9] = curOrigins[c][1]
        injectI32[10] = curOrigins[c][2]
        injectI32[11] = flags

        injectF32[12] = src.originCells[0]
        injectF32[13] = src.originCells[1]
        injectF32[14] = src.originCells[2]
        injectF32[15] = src.voxelCells

        injectF32[16] = src.size[0]
        injectF32[17] = src.size[1]
        injectF32[18] = src.size[2]
        injectF32[19] = cascadeVoxelCells[c]

        injectF32[20] = sunDir[0]
        injectF32[21] = sunDir[1]
        injectF32[22] = sunDir[2]
        injectF32[23] = feedback

        injectF32[24] = input.sunIrradiance[0]
        injectF32[25] = input.sunIrradiance[1]
        injectF32[26] = input.sunIrradiance[2]
        injectF32[27] = maxRadiance

        injectF32[28] = input.sky.zenith[0]
        injectF32[29] = input.sky.zenith[1]
        injectF32[30] = input.sky.zenith[2]
        injectF32[31] = maxAlbedo

        injectF32[32] = input.sky.horizon[0]
        injectF32[33] = input.sky.horizon[1]
        injectF32[34] = input.sky.horizon[2]
        injectF32[35] = gatherAlpha

        injectF32[36] = skyGround[0]
        injectF32[37] = skyGround[1]
        injectF32[38] = skyGround[2]
        // Cascade 0 gets full gather ray budget; coarser outer cascades amortize naturally.
        injectF32[39] = c === 0 ? gatherRaysBase : Math.max(4, gatherRaysBase >> 1)

        for (let pc = 0; pc < GI_CASCADE_COUNT; pc++) {
          const base = 40 + pc * 4
          injectI32[base] = curOrigins[pc][0]
          injectI32[base + 1] = curOrigins[pc][1]
          injectI32[base + 2] = curOrigins[pc][2]
          injectI32[base + 3] = doReset ? 0 : 1
        }

        injectF32[52] = cascadeVoxelCells[0]
        injectF32[53] = cascadeVoxelCells[1]
        injectF32[54] = cascadeVoxelCells[2]
        injectF32[55] = sunGlow

        device.queue.writeBuffer(injectUbos[c], 0, injectRaw)
      }

      // Pass 1: cs_inject_radiance across all 3 cascades.
      const gx0 = (dimX + 3) >> 2
      const gy0 = (dimY + 3) >> 2
      const gz0 = (dimZ + 3) >> 2

      const injectStartTs = timing?.all?.beginningOfPassWriteIndex !== undefined
        ? { querySet: timing.all.querySet, beginningOfPassWriteIndex: timing.all.beginningOfPassWriteIndex }
        : timing?.inject?.beginningOfPassWriteIndex !== undefined
          ? { querySet: timing.inject.querySet, beginningOfPassWriteIndex: timing.inject.beginningOfPassWriteIndex }
          : undefined
      const injectEndTs = timing?.inject?.endOfPassWriteIndex !== undefined
        ? { querySet: timing.inject.querySet, endOfPassWriteIndex: timing.inject.endOfPassWriteIndex }
        : undefined

      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        let ts: GPUComputePassTimestampWrites | undefined
        if (c === 0 && injectStartTs) ts = injectStartTs
        if (c === GI_CASCADE_COUNT - 1 && injectEndTs) {
          ts = ts ? { ...ts, endOfPassWriteIndex: injectEndTs.endOfPassWriteIndex } : injectEndTs
        }
        const pass = encoder.beginComputePass(ts ? { label: `gi-inject-c${c}`, timestampWrites: ts } : { label: `gi-inject-c${c}` })
        pass.setPipeline(injectPipe)
        pass.setBindGroup(0, getInjectBind(c as 0 | 1 | 2, sources[c], readSet))
        pass.dispatchWorkgroups(gx0, gy0, gz0)
        pass.end()
      }

      // Pass 2: cs_mip_radiance (mip 0->1 and mip 1->2 for all 3 cascades).
      const mipStartTs = timing?.mip?.beginningOfPassWriteIndex !== undefined
        ? { querySet: timing.mip.querySet, beginningOfPassWriteIndex: timing.mip.beginningOfPassWriteIndex }
        : undefined
      const mipEndTs = timing?.all?.endOfPassWriteIndex !== undefined
        ? { querySet: timing.all.querySet, endOfPassWriteIndex: timing.all.endOfPassWriteIndex }
        : timing?.mip?.endOfPassWriteIndex !== undefined
          ? { querySet: timing.mip.querySet, endOfPassWriteIndex: timing.mip.endOfPassWriteIndex }
          : undefined

      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        for (let m = 0; m < GI_MIP_COUNT - 1; m++) {
          const isFirstMip = c === 0 && m === 0
          const isLastMip = c === GI_CASCADE_COUNT - 1 && m === GI_MIP_COUNT - 2
          let ts: GPUComputePassTimestampWrites | undefined
          if (isFirstMip && mipStartTs) ts = mipStartTs
          if (isLastMip && mipEndTs) {
            ts = ts ? { ...ts, endOfPassWriteIndex: mipEndTs.endOfPassWriteIndex } : mipEndTs
          }
          const dstW = Math.max(1, dimX >> (m + 1))
          const dstH = Math.max(1, dimY >> (m + 1))
          const dstD = Math.max(1, dimZ >> (m + 1))
          const pass = encoder.beginComputePass(ts ? { label: `gi-mip-c${c}-m${m + 1}`, timestampWrites: ts } : { label: `gi-mip-c${c}-m${m + 1}` })
          pass.setPipeline(mipPipe)
          pass.setBindGroup(0, mipBinds[writeSet][c][m])
          pass.dispatchWorkgroups((dstW + 3) >> 2, (dstH + 3) >> 2, (dstD + 3) >> 2)
          pass.end()
        }
      }

      prevOrigins = curOrigins
      curOrigins = nextOrigins
      casCurIdx = writeSet
      casValid = true
      injectCalls++
    },

    traceAndDenoise(encoder, input, timing) {
      if (destroyed) throw new Error('VoxelGIPass was destroyed')

      const allocW = Math.max(1, Math.round((input.allocSize ?? input.renderSize)[0]))
      const allocH = Math.max(1, Math.round((input.allocSize ?? input.renderSize)[1]))
      const renderW = Math.max(1, Math.min(allocW, Math.round(input.renderSize[0])))
      const renderH = Math.max(1, Math.min(allocH, Math.round(input.renderSize[1])))

      ensureCapacity(renderW, renderH)
      ensureScreenBinds(input.depth, input.normal, input.velocity)

      const mode: GiTraceMode = input.mode ?? GI_MODE_STOCHASTIC
      const spp: 1 | 2 = input.spp === 2 ? 2 : 1
      const normEnc: GiNormalEncoding = input.normalEncoding ?? GI_NORMAL_SIGNED
      const atrousCount = Math.max(0, Math.min(3, Math.round(input.atrousPasses ?? defaultAtrousPasses)))
      const indScale = Math.max(0, input.indirectScale ?? 1.0)
      const nearDist = input.camera.near ?? NEAR
      const farDist = input.camera.far ?? FAR
      const sunDir = unitVec3(input.sunDir)
      const skyGround: Vec3 = input.sky.ground ?? [
        input.sky.horizon[0] * 0.22,
        input.sky.horizon[1] * 0.22,
        input.sky.horizon[2] * 0.22,
      ]
      const sunGlow = Math.max(0, input.sky.sunGlow ?? 0)
      const maxRayDist = Math.max(dimX, dimY, dimZ) * cascadeVoxelCells[2] * 0.5

      const doReset = !historyValid || !!input.reset
      if (doReset) resets++

      // ── Write Pass 3 (trace) uniforms ──────────────────────────────────────
      traceF32[0] = renderW
      traceF32[1] = renderH
      traceF32[2] = 1 / renderW
      traceF32[3] = 1 / renderH

      traceF32[4] = allocW
      traceF32[5] = allocH
      traceF32[6] = 1 / allocW
      traceF32[7] = 1 / allocH

      traceF32[8] = input.camera.eye[0]
      traceF32[9] = input.camera.eye[1]
      traceF32[10] = input.camera.eye[2]
      traceF32[11] = nearDist

      traceF32[12] = input.camera.forward[0]
      traceF32[13] = input.camera.forward[1]
      traceF32[14] = input.camera.forward[2]
      traceF32[15] = farDist

      traceF32[16] = input.camera.right[0]
      traceF32[17] = input.camera.right[1]
      traceF32[18] = input.camera.right[2]
      traceF32[19] = input.camera.tanHalf

      traceF32[20] = input.camera.up[0]
      traceF32[21] = input.camera.up[1]
      traceF32[22] = input.camera.up[2]
      traceF32[23] = input.camera.aspect

      traceU32[24] = dimX
      traceU32[25] = dimY
      traceU32[26] = dimZ
      traceU32[27] = frames

      traceU32[28] = mode
      traceU32[29] = spp
      traceU32[30] = 48
      traceU32[31] = normEnc

      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        const base = 32 + c * 4
        traceI32[base] = curOrigins[c][0]
        traceI32[base + 1] = curOrigins[c][1]
        traceI32[base + 2] = curOrigins[c][2]
        traceI32[base + 3] = casValid ? 1 : 0
      }

      traceF32[44] = cascadeVoxelCells[0]
      traceF32[45] = cascadeVoxelCells[1]
      traceF32[46] = cascadeVoxelCells[2]
      traceF32[47] = maxRayDist

      traceF32[48] = input.sky.zenith[0]
      traceF32[49] = input.sky.zenith[1]
      traceF32[50] = input.sky.zenith[2]
      traceF32[51] = sunGlow

      traceF32[52] = input.sky.horizon[0]
      traceF32[53] = input.sky.horizon[1]
      traceF32[54] = input.sky.horizon[2]
      traceF32[55] = indScale

      traceF32[56] = skyGround[0]
      traceF32[57] = skyGround[1]
      traceF32[58] = skyGround[2]
      traceF32[59] = 0

      traceF32[60] = sunDir[0]
      traceF32[61] = sunDir[1]
      traceF32[62] = sunDir[2]
      traceF32[63] = 0

      device.queue.writeBuffer(traceUbo, 0, traceRaw)

      // ── Write Pass 4a (SVGF temporal) uniforms ─────────────────────────────
      temporalF32[0] = renderW
      temporalF32[1] = renderH
      temporalF32[2] = 1 / renderW
      temporalF32[3] = 1 / renderH

      temporalF32[4] = prevRenderW
      temporalF32[5] = prevRenderH
      temporalF32[6] = prevRenderW > 0 ? 1 / prevRenderW : 0
      temporalF32[7] = prevRenderH > 0 ? 1 / prevRenderH : 0

      temporalF32[8] = nearDist
      temporalF32[9] = farDist
      temporalF32[10] = normEnc
      temporalF32[11] = doReset ? 1 : 0

      temporalF32[12] = maxHistory
      temporalF32[13] = 0.05
      temporalF32[14] = 0.05
      temporalF32[15] = 0.85

      device.queue.writeBuffer(temporalUbo, 0, temporalRaw)

      // ── Write Pass 4b (3x à-trous) uniforms into 3 separate UBOs ───────────
      for (let i = 0; i < atrousCount; i++) {
        atrousF32[0] = renderW
        atrousF32[1] = renderH
        atrousF32[2] = 1 / renderW
        atrousF32[3] = 1 / renderH

        atrousF32[4] = nearDist
        atrousF32[5] = farDist
        atrousF32[6] = normEnc
        atrousF32[7] = 0

        atrousF32[8] = ATROUS_STEPS[i]
        atrousF32[9] = sigmaZ
        atrousF32[10] = sigmaL
        atrousF32[11] = normalPower

        device.queue.writeBuffer(atrousUbos[i], 0, atrousRaw)
      }

      const gx = (renderW + 7) >> 3
      const gy = (renderH + 7) >> 3

      // Pass 3: cs_trace_gi
      const tracePass = encoder.beginComputePass(
        timing?.trace ? { label: 'gi-trace', timestampWrites: timing.trace } : { label: 'gi-trace' },
      )
      tracePass.setPipeline(tracePipe)
      tracePass.setBindGroup(0, traceBinds![casCurIdx])
      tracePass.dispatchWorkgroups(gx, gy)
      tracePass.end()

      // Pass 4a: cs_svgf_temporal
      const histWriteIdx: 0 | 1 = histReadIdx === 0 ? 1 : 0
      const tempPass = encoder.beginComputePass(
        timing?.temporal ? { label: 'gi-svgf-temporal', timestampWrites: timing.temporal } : { label: 'gi-svgf-temporal' },
      )
      tempPass.setPipeline(temporalPipe)
      tempPass.setBindGroup(0, temporalBinds![histReadIdx])
      tempPass.dispatchWorkgroups(gx, gy)
      tempPass.end()

      // Pass 4b: 3-pass Edge-Stopping À-trous Wavelet Filter (step = 1, 2, 4)
      let outTex: GPUTexture = histGiTex[histWriteIdx]
      let outView: GPUTextureView = histGiView[histWriteIdx]

      if (atrousCount > 0) {
        const atrousList: [GPUBindGroup, GPUTexture, GPUTextureView][] = [
          [atrousFirstBinds![histWriteIdx], atrousTex[0], atrousView[0]],
          [atrousStep1Binds![histWriteIdx], atrousTex[1], atrousView[1]],
          [atrousStep2Binds![histWriteIdx], atrousTex[0], atrousView[0]],
        ]
        for (let i = 0; i < atrousCount; i++) {
          let ts: GPUComputePassTimestampWrites | undefined
          if (timing?.atrous) {
            if (atrousCount === 1) {
              ts = timing.atrous
            } else if (i === 0 && timing.atrous.beginningOfPassWriteIndex !== undefined) {
              ts = { querySet: timing.atrous.querySet, beginningOfPassWriteIndex: timing.atrous.beginningOfPassWriteIndex }
            } else if (i === atrousCount - 1 && timing.atrous.endOfPassWriteIndex !== undefined) {
              ts = { querySet: timing.atrous.querySet, endOfPassWriteIndex: timing.atrous.endOfPassWriteIndex }
            }
          }
          const aPass = encoder.beginComputePass(
            ts ? { label: `gi-svgf-atrous-${ATROUS_STEPS[i]}`, timestampWrites: ts } : { label: `gi-svgf-atrous-${ATROUS_STEPS[i]}` },
          )
          aPass.setPipeline(atrousPipe)
          aPass.setBindGroup(0, atrousList[i][0])
          aPass.dispatchWorkgroups(gx, gy)
          aPass.end()
          outTex = atrousList[i][1]
          outView = atrousList[i][2]
        }
      }

      histReadIdx = histWriteIdx
      historyValid = true
      prevRenderW = renderW
      prevRenderH = renderH
      lastRenderW = renderW
      lastRenderH = renderH
      lastMode = mode
      frames++
      lastOutTex = outTex
      lastOutView = outView
      return outView
    },

    reset() {
      historyValid = false
      casValid = false
      prevRenderW = 0
      prevRenderH = 0
      prevOrigins = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    },

    stats() {
      return {
        reallocs,
        frames,
        injectCalls,
        resets,
        historyValid,
        capacity: [capW, capH],
        renderSize: [lastRenderW, lastRenderH],
        cascadeSize,
        cascadeVoxelCells,
        cascadeOrigins: [
          [curOrigins[0][0], curOrigins[0][1], curOrigins[0][2]],
          [curOrigins[1][0], curOrigins[1][1], curOrigins[1][2]],
          [curOrigins[2][0], curOrigins[2][1], curOrigins[2][2]],
        ],
        mode: lastMode,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      for (let s = 0; s < 2; s++) {
        for (let c = 0; c < GI_CASCADE_COUNT; c++) {
          casTex[s][c].destroy()
        }
        facesBuf[s].destroy()
      }
      for (const b of injectUbos) b.destroy()
      for (const b of mipUbos) b.destroy()
      traceUbo.destroy()
      temporalUbo.destroy()
      for (const b of atrousUbos) b.destroy()
      rawGiTex.destroy()
      histGiTex[0].destroy(); histGiTex[1].destroy()
      histMomTex[0].destroy(); histMomTex[1].destroy()
      prevGeomTex[0].destroy(); prevGeomTex[1].destroy()
      atrousTex[0].destroy(); atrousTex[1].destroy()
      invalidateScreenCaches()
      for (const slot of injectCache) {
        slot.albedo = null
        slot.emissive = null
        slot.binds = null
      }
    },
  }

  return self
}
