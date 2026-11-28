// Standalone Temporally Amortized Volumetric 3D Cloud Raymarching Engine (#165).
//
// Physically lit Schneider / Wrenninge (Horizon Zero Dawn / Nubis) 3D cumulus & stratus cloud
// layer over a curved Earth shell (default 1.2 km - 3.8 km altitude over R = 6360 km), supporting
// cameras below (SF streets), inside (flight), and above (orbit / SPACE) at < 0.5 ms per frame:
//
//   Init (generated ONCE on GPU compute):
//     - Base Shape 3D LUT (64x64x64 rgba8unorm, tileable): Perlin-Worley FBM (.r) + 3 Worley octaves (.gba)
//     - Detail Erosion 3D LUT (32x32x32 rgba8unorm, tileable): 3 high-freq Worley octaves (.rgb) + FBM (.a)
//     - Weather Map 2D LUT (128x128 rgba8unorm, tileable): macro coverage (.r), density (.g), type (.b), height (.a)
//
//   Per-frame compute pipeline (zero GC, zero reallocs across dynamic renderSize changes):
//     - Pass 1 (`cs_trace_clouds`, @workgroup_size(8, 8)):
//         Quarter-res (half-W x half-H) volumetric raymarch with 4x4 (16-frame) Bayer sub-pixel
//         scheduling (1 thread per 4x4 block for 100% SIMD occupancy; full-quarter-res on `reset`).
//         Dual-lobe Henyey-Greenstein phase (g1 = 0.80 silver lining, g2 = -0.30 back-scatter),
//         3-octave Wrenninge multi-scattering + Beer-Powder sugar-powder lighting, 6-step cone
//         light march toward `sunDir`, and ambient sky-top / ground-bounce gradient.
//     - Pass 2 (`cs_reproject_clouds`, @workgroup_size(8, 8)):
//         Reprojects previous frame's cloud history using cloud-layer world-space hit distance and
//         `prevViewProj` with 3x3 block-neighborhood clamping to prevent ghosting, plus instant
//         spatial fill when out-of-frustum and instant full-frame copy on `reset`.
//
//   Composite (`VOLUMETRIC_CLOUDS_WGSL` / `volumetricCloudsBindings`):
//     Provides `sampleVolumetricClouds(uv)` and `compositeVolumetricClouds(sky, uv)` for linear
//     HDR compositing behind terrain / over sky (`sky = sky * cloud.a + cloud.rgb`).
import { shader, type V3 } from '../probe/gpu.ts'

/** Dimensions of the precomputed tileable cloud noise LUTs. */
export const CLOUD_LUT_DIMS = {
  shapeSize: 64,
  detailSize: 32,
  weatherSize: 128,
} as const

/** Default curved-Earth cloud shell and lighting parameters. */
export const DEFAULT_CLOUD_SHELL = {
  planetRadiusKm: 6360.0,
  cloudMinAltKm: 1.2,
  cloudMaxAltKm: 3.8,
  maxRayDistKm: 110.0,
  coverage: 0.55,
  densityScale: 4.8,
  cloudType: 0.68,
  detailErosion: 0.34,
  weatherTileKm: 30.0,
  shapeTileKm: 8.0,
  detailTileKm: 0.95,
  silverLiningG: 0.80,
  backScatterG: -0.30,
} as const

export interface VolumetricCloudsTimestampWrites {
  trace?: GPUComputePassTimestampWrites
  reproject?: GPUComputePassTimestampWrites
}

export interface VolumetricCloudsParams {
  /** Active full-res viewport size `[width, height]`. Clamped to `maxSize`; quarter-res is `ceil(renderSize / 2)`. */
  renderSize: readonly [number, number]
  /** Camera position in world kilometers `[xKm, altitudeKm, zKm]`. Default `[0, 0.05, 0]`. */
  cameraPosKm?: V3
  /** Unit camera forward direction (Y-up). */
  cameraForward: V3
  /** Unit camera right direction (Y-up). */
  cameraRight: V3
  /** Unit camera up direction (Y-up). */
  cameraUp: V3
  /** Tangent of half vertical field of view (`Math.tan(fovY / 2)`). */
  tanHalfFovY: number
  /** Viewport aspect ratio (`width / height`). Defaults to `renderSize[0] / renderSize[1]`. */
  aspect?: number
  /** Unit direction toward the sun (Y-up). Default `[0.5088, 0.7632, 0.3976]`. */
  sunDir?: V3
  /** Linear HDR top-of-atmosphere or direct sun radiance RGB. Default `[3.4, 3.25, 3.05]`. */
  sunColor?: V3
  /** Apply physical airmass Rayleigh/Mie/Ozone transmittance tinting to `sunColor` from `sunDir.y`. Default `true`. */
  applySunTransmittance?: boolean
  /** Optional override for zenith sky ambient light RGB (auto-derived from `sunDir.y` when omitted). */
  ambientSky?: V3
  /** Optional override for ground/horizon bounce ambient light RGB (auto-derived from `sunDir.y` when omitted). */
  ambientGround?: V3
  /** Cloud coverage in `[0, 1]` (`0` = clear sky, `0.65` = broken cumulus, `1` = overcast). Default `0.55`. */
  coverage?: number
  /** Optical extinction multiplier (`1/km`). Default `4.5`. */
  densityScale?: number
  /** Cloud type blend in `[0, 1]` (`0` = low flat stratus, `0.5` = stratocumulus, `1` = tall cumulus). Default `0.65`. */
  cloudType?: number
  /** High-frequency detail erosion strength in `[0, 0.6]`. Default `0.22`. */
  detailErosion?: number
  /** Wind velocity vector in km/s `[vx, vy, vz]`. Default `[0.018, 0, 0.006]`. */
  windKmPerSec?: V3
  /** Elapsed simulation time in seconds for wind drift and cloud evolution. Default `0`. */
  time?: number
  /** Planet radius in km. Default `6360`. */
  planetRadiusKm?: number
  /** Lower cloud shell altitude above sea level in km. Default `1.2`. */
  cloudMinAltKm?: number
  /** Upper cloud shell altitude above sea level in km. Default `3.8`. */
  cloudMaxAltKm?: number
  /** Maximum raymarch integration distance in km. Default `110`. */
  maxRayDistKm?: number
  /** Maximum primary march steps per ray (clamped `[16, 96]`). Default `48`. */
  maxSteps?: number
  /** Forward-scatter Henyey-Greenstein anisotropy `g1` (silver lining). Default `0.80`. */
  silverLiningG?: number
  /** Back-scatter Henyey-Greenstein anisotropy `g2`. Default `-0.30`. */
  backScatterG?: number
  /** Composite strength multiplier written to `compositeUniforms`. Default `1.0`. */
  strength?: number
  /** Forces an immediate full-quarter-res trace and history reset on this frame (teleport, camera cut, sky preset jump). */
  reset?: boolean
  /** Optional GPU timestamp query writes for Pass 1 (`trace`) and Pass 2 (`reproject`). */
  timestampWrites?: VolumetricCloudsTimestampWrites
}

export interface VolumetricCloudsStats {
  /** Maximum supported full-res viewport size `[width, height]`. */
  readonly maxSize: readonly [number, number]
  /** Persistent allocated quarter-res cloud texture size `[width, height]`. */
  readonly maxCloudSize: readonly [number, number]
  /** Active full-res viewport size from the last `update()`. */
  readonly renderSize: readonly [number, number]
  /** Active quarter-res cloud viewport size from the last `update()`. */
  readonly cloudSize: readonly [number, number]
  /** Number of GPU texture reallocations after init (always `0` across `renderSize` changes). */
  readonly reallocs: number
  /** Total frames updated via `update()`. */
  readonly frames: number
  /** Total full-quarter-res reset frames traced. */
  readonly fullFrames: number
  /** Total 4x4 temporally amortized frames traced. */
  readonly amortizedFrames: number
  /** Current 4x4 Bayer sub-pixel schedule index `[0, 15]` used on the most recent frame. */
  readonly bayerIndex: number
  /** Whether temporal history is valid for the next frame. */
  readonly historyValid: boolean
  /** Estimated persistent GPU VRAM footprint in bytes. */
  readonly vramBytes: number
}

export interface VolumetricCloudsCompositeParams {
  target: GPUTextureView
  format: GPUTextureFormat
  /** Primary marched scene depth texture (`depth24plus`, 1.0 = open sky). */
  depth: GPUTextureView
  /** Optional far-model reciprocal-depth texture (`depth32float`, 0.0 = open sky). */
  farDepth?: GPUTextureView | null
  /** Optional marcher glass panes texture (`rgba16float`, `.a == 0.0` = no glass pane in front). */
  panes?: GPUTextureView | null
  /** Active full-res viewport size `[width, height]` inside a grow-only target. */
  viewportSize: readonly [number, number]
  /** Camera altitude in km (used for horizon fade when below the cloud shell). */
  camAltKm?: number
  /** Unit camera forward direction (Y-up). */
  cameraForward: V3
  /** Unit camera right direction (Y-up). */
  cameraRight: V3
  /** Unit camera up direction (Y-up). */
  cameraUp: V3
  /** Tangent of half vertical FOV (`Math.tan(fovY / 2)`). */
  tanHalfFovY: number
  /** Viewport aspect ratio (defaults to `viewportSize[0] / viewportSize[1]`). */
  aspect?: number
  /** Optional GPU timestamp writes for the sky composite render pass. */
  timestampWrites?: GPURenderPassTimestampWrites
}

export interface VolumetricClouds {
  /** Underlying persistent `rgba16float` output texture of the most recent `update()`. */
  readonly texture: GPUTexture
  /** View of the most recently resolved quarter-res linear HDR cloud texture (`rgb = inScatter`, `a = transmittance`). */
  readonly view: GPUTextureView
  /** Linear clamp-to-edge sampler for `VOLUMETRIC_CLOUDS_WGSL`. */
  readonly sampler: GPUSampler
  /** Uniform buffer kept in sync with active `uvScale`, `invAlloc`, and `strength` for `VOLUMETRIC_CLOUDS_WGSL`. */
  readonly compositeUniforms: GPUBuffer
  /** Precomputed tileable 64x64x64 `rgba8unorm` base shape 3D texture. */
  readonly shapeNoiseTexture: GPUTexture
  /** Precomputed tileable 32x32x32 `rgba8unorm` detail erosion 3D texture. */
  readonly detailNoiseTexture: GPUTexture
  /** Precomputed tileable 128x128 `rgba8unorm` procedural weather 2D texture. */
  readonly weatherTexture: GPUTexture
  /** Encodes Pass 1 (raymarch) + Pass 2 (temporal reprojection) and returns the resolved cloud `GPUTextureView`. */
  update(encoder: GPUCommandEncoder, params: VolumetricCloudsParams): GPUTextureView
  /** Composites the resolved volumetric clouds strictly onto open sky pixels behind marched geometry, far skyscrapers, and glass panes. */
  compositeSky(encoder: GPUCommandEncoder, params: VolumetricCloudsCompositeParams): void
  /** Invalidates temporal history so the next `update()` performs a full-quarter-res trace. */
  reset(): void
  /** Reports active dimensions, temporal scheduling counters, realloc count, and VRAM footprint. */
  stats(): VolumetricCloudsStats
  /** Releases all GPU textures, buffers, and internal resources. */
  destroy(): void
}

/**
 * Generates standard WGSL resource bindings for `VOLUMETRIC_CLOUDS_WGSL` in the chosen bind group.
 * Consumers (`march-shade.ts`) may call this or declare `volCloudsTex`, `volCloudsSampler`, and
 * `volCloudsParams` at custom binding slots.
 */
export function volumetricCloudsBindings(group = 1, baseBinding = 0): string {
  return /* wgsl */ `
@group(${group}) @binding(${baseBinding}) var volCloudsTex: texture_2d<f32>;
@group(${group}) @binding(${baseBinding + 1}) var volCloudsSampler: sampler;
@group(${group}) @binding(${baseBinding + 2}) var<uniform> volCloudsParams: VolumetricCloudsParams;
`
}

/**
 * Reusable WGSL compositing snippet for `march-shade.ts` or any fullscreen linear-HDR sky pass.
 * Expects bindings `volCloudsTex: texture_2d<f32>`, `volCloudsSampler: sampler`, and
 * `volCloudsParams: VolumetricCloudsParams` (see `volumetricCloudsBindings()`).
 */
export const VOLUMETRIC_CLOUDS_WGSL = /* wgsl */ `
struct VolumetricCloudsParams {
  // xy: activeCloudSize / maxCloudSize, zw: 1.0 / maxCloudSize
  uvScaleInvAlloc: vec4f,
  // x: enabled (> 0), y: strength (default 1.0), zw: activeCloudSize
  flags: vec4f,
}

// Samples linear HDR (inScatteredRadiance.rgb, transmittance.a) at full-screen UV in [0, 1]^2,
// safely clamped inside the active dynamic-resolution sub-rect of the persistent cloud texture.
fn sampleVolumetricClouds(uv: vec2f) -> vec4f {
  if (volCloudsParams.flags.x <= 0.0) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let uvScale = volCloudsParams.uvScaleInvAlloc.xy;
  let halfTexel = volCloudsParams.uvScaleInvAlloc.zw * 0.5;
  let maxUv = max(uvScale - halfTexel, halfTexel);
  let clampedUv = clamp(uv * uvScale, halfTexel, maxUv);
  var cloud = textureSampleLevel(volCloudsTex, volCloudsSampler, clampedUv, 0.0);
  let strength = clamp(volCloudsParams.flags.y, 0.0, 1.0);
  if (strength < 0.9999) {
    cloud = vec4f(cloud.rgb * strength, mix(1.0, cloud.a, strength));
  }
  return cloud;
}

// Composites volumetric 3D clouds over sky radiance in linear HDR: sky = sky * cloud.a + cloud.rgb.
fn compositeVolumetricClouds(sky: vec3f, uv: vec2f) -> vec3f {
  let cloud = sampleVolumetricClouds(uv);
  return sky * cloud.a + cloud.rgb;
}
`

// 4x4 Bayer sub-pixel order (0..15) so all 16 sub-pixels visit evenly across 16 frames.
const BAYER_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0], [2, 2], [2, 0], [0, 2],
  [1, 1], [3, 3], [3, 1], [1, 3],
  [1, 0], [3, 2], [3, 0], [1, 2],
  [0, 1], [2, 3], [2, 1], [0, 3],
]

// Uniform layout sizes (16-byte aligned).
const CLOUD_UNIFORM_BYTES = 352
const COMPOSITE_UNIFORM_BYTES = 32

function ceilDiv(a: number, b: number): number {
  return Math.max(1, Math.ceil(a / b))
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function unit3(v: V3, fallback: V3): readonly [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : [fallback[0], fallback[1], fallback[2]]
}

// Physical solar transmittance at cloud altitude (~2.5 km) using Kasten-Young airmass +
// Rayleigh + Mie + Chappuis Ozone extinction so sunset/sunrise automatically shift warm.
function computeSunTransmittance(sunY: number, out: [number, number, number]): void {
  if (sunY <= -0.06) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return
  }
  const elevDeg = Math.asin(clamp(sunY, -1, 1)) * (180 / Math.PI)
  const sinE = Math.max(sunY, 0.002)
  const airmass = 1.0 / (sinE + 0.15 * Math.pow(Math.max(elevDeg + 3.885, 0.2), -1.253))
  const m = Math.min(airmass, 26.0)
  // Extinction per airmass at ~2.5 km altitude (Rayleigh R/G/B + Mie + Ozone)
  const tr = Math.exp(-(0.044 + 0.022 + 0.008) * m)
  const tg = Math.exp(-(0.106 + 0.026 + 0.024) * m)
  const tb = Math.exp(-(0.258 + 0.032 + 0.003) * m)
  // Smooth twilight fade below the geometric horizon (-0.06 .. +0.015)
  const horizonFade = clamp((sunY + 0.06) / 0.075, 0, 1)
  const smoothFade = horizonFade * horizonFade * (3 - 2 * horizonFade)
  out[0] = tr * smoothFade
  out[1] = tg * smoothFade
  out[2] = tb * smoothFade
}

// Writes camera-relative previous view-projection matrix (column-major, 16 floats) into `out`
// starting at `offset`. Transforms a point relative to the PREVIOUS camera eye in km into
// previous clip space (ndcX in [-1, 1], ndcY in [-1, 1], clip.w = view forward depth).
function writePrevViewProj(
  out: Float32Array,
  offset: number,
  prevRight: readonly [number, number, number],
  prevUp: readonly [number, number, number],
  prevForward: readonly [number, number, number],
  prevTanHalf: number,
  prevAspect: number,
): void {
  const fy = 1 / Math.max(prevTanHalf, 1e-4)
  const fx = fy / Math.max(prevAspect, 1e-4)
  // Column 0 (x axis)
  out[offset + 0] = prevRight[0] * fx
  out[offset + 1] = prevUp[0] * fy
  out[offset + 2] = prevForward[0]
  out[offset + 3] = prevForward[0]
  // Column 1 (y axis)
  out[offset + 4] = prevRight[1] * fx
  out[offset + 5] = prevUp[1] * fy
  out[offset + 6] = prevForward[1]
  out[offset + 7] = prevForward[1]
  // Column 2 (z axis)
  out[offset + 8] = prevRight[2] * fx
  out[offset + 9] = prevUp[2] * fy
  out[offset + 10] = prevForward[2]
  out[offset + 11] = prevForward[2]
  // Column 3 (translation = 0 because input vector already includes curCam - prevCam)
  out[offset + 12] = 0
  out[offset + 13] = 0
  out[offset + 14] = 0
  out[offset + 15] = 0
}

// ── Init Compute Shaders (Tileable 3D Shape, 3D Detail, 2D Weather LUTs) ────

const NOISE_COMMON_WGSL = /* wgsl */ `
fn remapVal(v: f32, lo: f32, hi: f32, outLo: f32, outHi: f32) -> f32 {
  return outLo + ((v - lo) / max(hi - lo, 1e-5)) * (outHi - outLo);
}

fn wrap3(p: vec3i, period: i32) -> vec3u {
  return vec3u(((p % period) + period) % period);
}

fn hash3to3(p: vec3i, period: i32, seed: u32) -> vec3f {
  let q = wrap3(p, period);
  var h = q.x * 374761393u + q.y * 668265263u + q.z * 2147483647u + seed * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  let h1 = h ^ (h >> 16u);
  let h2 = ((h1 * 2246822519u) ^ (h1 >> 13u)) * 3266489917u;
  let h3 = ((h2 * 668265263u) ^ (h2 >> 15u)) * 374761393u;
  return vec3f(
    f32(h1 & 0x00ffffffu) * (1.0 / 16777216.0),
    f32(h2 & 0x00ffffffu) * (1.0 / 16777216.0),
    f32(h3 & 0x00ffffffu) * (1.0 / 16777216.0),
  );
}

fn worley3(uvw: vec3f, freq: f32, seed: u32) -> f32 {
  let period = i32(freq);
  let p = uvw * freq;
  let cell = vec3i(floor(p));
  let frac = fract(p);
  var minDistSq = 4.0;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let offset = vec3i(dx, dy, dz);
        let rnd = hash3to3(cell + offset, period, seed);
        let diff = vec3f(f32(dx), f32(dy), f32(dz)) + rnd - frac;
        minDistSq = min(minDistSq, dot(diff, diff));
      }
    }
  }
  return clamp(1.0 - sqrt(minDistSq), 0.0, 1.0);
}

fn worleyFbm3(uvw: vec3f, baseFreq: f32, seed: u32) -> f32 {
  let w0 = worley3(uvw, baseFreq, seed);
  let w1 = worley3(uvw, baseFreq * 2.0, seed + 17u);
  let w2 = worley3(uvw, baseFreq * 4.0, seed + 37u);
  return w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
}

fn gradDot3(cell: vec3i, frac: vec3f, corner: vec3i, period: i32, seed: u32) -> f32 {
  let g = normalize(hash3to3(cell + corner, period, seed) * 2.0 - 1.0 + vec3f(1e-5, -1e-5, 1e-5));
  return dot(g, frac - vec3f(corner));
}

fn perlin3(uvw: vec3f, freq: f32, seed: u32) -> f32 {
  let period = i32(freq);
  let p = uvw * freq;
  let cell = vec3i(floor(p));
  let f = fract(p);
  let t = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  let n000 = gradDot3(cell, f, vec3i(0, 0, 0), period, seed);
  let n100 = gradDot3(cell, f, vec3i(1, 0, 0), period, seed);
  let n010 = gradDot3(cell, f, vec3i(0, 1, 0), period, seed);
  let n110 = gradDot3(cell, f, vec3i(1, 1, 0), period, seed);
  let n001 = gradDot3(cell, f, vec3i(0, 0, 1), period, seed);
  let n101 = gradDot3(cell, f, vec3i(1, 0, 1), period, seed);
  let n011 = gradDot3(cell, f, vec3i(0, 1, 1), period, seed);
  let n111 = gradDot3(cell, f, vec3i(1, 1, 1), period, seed);

  let nx00 = mix(n000, n100, t.x);
  let nx10 = mix(n010, n110, t.x);
  let nx01 = mix(n001, n101, t.x);
  let nx11 = mix(n011, n111, t.x);
  let nxy0 = mix(nx00, nx10, t.y);
  let nxy1 = mix(nx01, nx11, t.y);
  return clamp(mix(nxy0, nxy1, t.z) * 0.68 + 0.5, 0.0, 1.0);
}

fn perlinFbm3(uvw: vec3f, baseFreq: f32, seed: u32) -> f32 {
  let p0 = perlin3(uvw, baseFreq, seed);
  let p1 = perlin3(uvw, baseFreq * 2.0, seed + 13u);
  let p2 = perlin3(uvw, baseFreq * 4.0, seed + 29u);
  let p3 = perlin3(uvw, baseFreq * 8.0, seed + 53u);
  return p0 * 0.5333 + p1 * 0.2667 + p2 * 0.1333 + p3 * 0.0667;
}
`

const GEN_SHAPE_WGSL = /* wgsl */ `
${NOISE_COMMON_WGSL}

@group(0) @binding(0) var shapeOut: texture_storage_3d<rgba8unorm, write>;

@compute @workgroup_size(4, 4, 4)
fn cs_gen_shape(@builtin(global_invocation_id) gid: vec3u) {
  let size = ${CLOUD_LUT_DIMS.shapeSize}u;
  if (gid.x >= size || gid.y >= size || gid.z >= size) {
    return;
  }
  let uvw = (vec3f(gid) + 0.5) / f32(size);
  let perlin = perlinFbm3(uvw, 4.0, 11u);
  let w0 = worleyFbm3(uvw, 4.0, 23u);
  let w1 = worleyFbm3(uvw, 8.0, 41u);
  let w2 = worleyFbm3(uvw, 16.0, 67u);
  // Nubis-style Perlin-Worley billowy base shape in .r with crisp Worley ridges, 3 Worley octaves in .gba
  let perlinWorley = clamp(remapVal(perlin, 0.0, 1.0, w0 * 0.46, 1.0) * 1.08, 0.0, 1.0);
  textureStore(shapeOut, vec3i(gid), vec4f(perlinWorley, w0, w1, w2));
}
`

const GEN_DETAIL_WGSL = /* wgsl */ `
${NOISE_COMMON_WGSL}

@group(0) @binding(0) var detailOut: texture_storage_3d<rgba8unorm, write>;

@compute @workgroup_size(4, 4, 4)
fn cs_gen_detail(@builtin(global_invocation_id) gid: vec3u) {
  let size = ${CLOUD_LUT_DIMS.detailSize}u;
  if (gid.x >= size || gid.y >= size || gid.z >= size) {
    return;
  }
  let uvw = (vec3f(gid) + 0.5) / f32(size);
  let w0 = worley3(uvw, 4.0, 101u);
  let w1 = worley3(uvw, 8.0, 131u);
  let w2 = worley3(uvw, 16.0, 163u);
  let fbm = w0 * 0.625 + w1 * 0.25 + w2 * 0.125;
  textureStore(detailOut, vec3i(gid), vec4f(w0, w1, w2, fbm));
}
`

const GEN_WEATHER_WGSL = /* wgsl */ `
${NOISE_COMMON_WGSL}

@group(0) @binding(0) var weatherOut: texture_storage_2d<rgba8unorm, write>;

fn wrap2(p: vec2i, period: i32) -> vec2u {
  return vec2u(((p % period) + period) % period);
}

fn hash2to2(p: vec2i, period: i32, seed: u32) -> vec2f {
  let q = wrap2(p, period);
  var h = q.x * 374761393u + q.y * 668265263u + seed * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  let h1 = h ^ (h >> 16u);
  let h2 = ((h1 * 2246822519u) ^ (h1 >> 13u)) * 3266489917u;
  return vec2f(
    f32(h1 & 0x00ffffffu) * (1.0 / 16777216.0),
    f32(h2 & 0x00ffffffu) * (1.0 / 16777216.0),
  );
}

fn perlin2(uv: vec2f, freq: f32, seed: u32) -> f32 {
  let period = i32(freq);
  let p = uv * freq;
  let cell = vec2i(floor(p));
  let f = fract(p);
  let t = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  let g00 = normalize(hash2to2(cell + vec2i(0, 0), period, seed) * 2.0 - 1.0 + vec2f(1e-5));
  let g10 = normalize(hash2to2(cell + vec2i(1, 0), period, seed) * 2.0 - 1.0 + vec2f(1e-5));
  let g01 = normalize(hash2to2(cell + vec2i(0, 1), period, seed) * 2.0 - 1.0 + vec2f(1e-5));
  let g11 = normalize(hash2to2(cell + vec2i(1, 1), period, seed) * 2.0 - 1.0 + vec2f(1e-5));

  let n00 = dot(g00, f - vec2f(0.0, 0.0));
  let n10 = dot(g10, f - vec2f(1.0, 0.0));
  let n01 = dot(g01, f - vec2f(0.0, 1.0));
  let n11 = dot(g11, f - vec2f(1.0, 1.0));

  let nx0 = mix(n00, n10, t.x);
  let nx1 = mix(n01, n11, t.x);
  return clamp(mix(nx0, nx1, t.y) * 0.72 + 0.5, 0.0, 1.0);
}

fn worley2(uv: vec2f, freq: f32, seed: u32) -> f32 {
  let period = i32(freq);
  let p = uv * freq;
  let cell = vec2i(floor(p));
  let frac = fract(p);
  var minDistSq = 4.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let off = vec2i(dx, dy);
      let rnd = hash2to2(cell + off, period, seed);
      let diff = vec2f(f32(dx), f32(dy)) + rnd - frac;
      minDistSq = min(minDistSq, dot(diff, diff));
    }
  }
  return clamp(1.0 - sqrt(minDistSq), 0.0, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn cs_gen_weather(@builtin(global_invocation_id) gid: vec3u) {
  let size = ${CLOUD_LUT_DIMS.weatherSize}u;
  if (gid.x >= size || gid.y >= size) {
    return;
  }
  let uv = (vec2f(gid.xy) + 0.5) / f32(size);
  // Macro coverage: multi-octave Perlin + Worley banks with crisp open blue sky gaps & dense cumulus clusters
  let pCov = perlin2(uv, 3.0, 211u) * 0.55 + perlin2(uv, 6.0, 227u) * 0.30 + perlin2(uv, 12.0, 241u) * 0.15;
  let wCov = worley2(uv, 4.0, 257u) * 0.65 + worley2(uv, 8.0, 271u) * 0.35;
  let cov = clamp((mix(pCov, wCov, 0.42) - 0.12) * 1.36, 0.08, 0.98);

  // Precipitation / optical density variation
  let prec = clamp(0.55 + 0.45 * (perlin2(uv, 4.0, 307u) * 0.65 + perlin2(uv, 8.0, 317u) * 0.35), 0.45, 1.0);

  // Cloud type (stratus -> stratocumulus -> tall cumulus)
  let cType = clamp(perlin2(uv, 2.0, 353u) * 0.70 + perlin2(uv, 4.0, 367u) * 0.30, 0.15, 0.95);

  // Macro height modulation
  let hVar = clamp(perlin2(uv, 3.0, 401u), 0.0, 1.0);

  textureStore(weatherOut, vec2i(gid.xy), vec4f(cov, prec, cType, hVar));
}
`

// ── Shared Runtime Uniforms & Raymarch / Reprojection Shaders ───────────────

const RUNTIME_UNIFORMS_WGSL = /* wgsl */ `
const CLOUD_PI: f32 = 3.14159265359;
const CLOUD_INV_4PI: f32 = 0.07957747155;
const F16_MAX_VAL: f32 = 65000.0;

struct CloudUniforms {
  // 0: activeCloudSize.xy, maxCloudSize.xy
  cloudDims: vec4f,
  // 1: prevCloudSize.xy, invActiveCloudSize.xy
  prevAndInvDims: vec4f,
  // 2: camPosKm.xyz (wrapped XZ for float32 precision, exact Y altitude), tanHalfFovY
  camPosTan: vec4f,
  // 3: camRight.xyz, aspect
  camRightAspect: vec4f,
  // 4: camUp.xyz, time
  camUpTime: vec4f,
  // 5: camForward.xyz, maxRayDistKm
  camFwdMaxDist: vec4f,
  // 6: planetRadiusKm, cloudMinAltKm, cloudMaxAltKm, invCloudThicknessKm
  shell: vec4f,
  // 7: sunDir.xyz (unit), sunElevFactor
  sunDirInfo: vec4f,
  // 8: effectiveSunColor.rgb, silverLiningG (g1 = 0.80)
  sunColG1: vec4f,
  // 9: ambientSky.rgb, backScatterG (g2 = -0.30)
  ambSkyG2: vec4f,
  // 10: ambientGround.rgb, maxSteps (f32)
  ambGroundSteps: vec4f,
  // 11: coverage, densityScale, cloudType, detailErosion
  weather: vec4f,
  // 12: windKmPerSec.xyz, timeSec
  windTime: vec4f,
  // 13: invWeatherTileKm, invShapeTileKm, invDetailTileKm, detailErosion
  scales: vec4f,
  // 14: camDeltaKm.xyz (curCamPosKm - prevCamPosKm), prevUvScaleX
  camDeltaScaleX: vec4f,
  // 15: bayerOffX (u32), bayerOffY (u32), fullFrame (0/1), historyValid (0/1)
  sched: vec4u,
  // 16: frameIndex (u32), blockW (u32), blockH (u32), pad
  counts: vec4u,
  // 17: prevUvScale.xy, invMaxCloudSize.xy
  prevScaleInvMax: vec4f,
  // 18..21: camera-relative prevViewProj (maps curCamDeltaKm + rd * hitDistKm -> prev clip)
  prevViewProj: mat4x4f,
}

fn remapClamp(v: f32, lo: f32, hi: f32) -> f32 {
  return clamp((v - lo) / max(hi - lo, 1e-5), 0.0, 1.0);
}

// Numerically stable ray-sphere intersection with planet center at (0, 0, 0) and
// camera at (0, r0, 0). Uses (r0 - R)*(r0 + R) + Vieta's formula to avoid float32
// catastrophic cancellation at R = 6360 km.
fn intersectPlanetSphere(r0: f32, rdY: f32, radius: f32) -> vec2f {
  let b = r0 * rdY;
  let c = (r0 - radius) * (r0 + radius);
  let disc = b * b - c;
  if (disc < 0.0) {
    return vec2f(-1.0, -1.0);
  }
  let s = sqrt(disc);
  if (b >= 0.0) {
    let t0 = -b - s;
    let t1 = select(-b + s, c / t0, abs(t0) > 1e-5);
    return vec2f(t0, t1);
  }
  let t1 = -b + s;
  let t0 = select(-b - s, c / t1, abs(t1) > 1e-5);
  return vec2f(t0, t1);
}

// Computes the volumetric raymarch interval (tStart, tEnd) in km through the curved
// [cloudMinAltKm, cloudMaxAltKm] shell for cameras below, inside, or above the layer.
fn cloudShellInterval(camAltKm: f32, rdY: f32) -> vec2f {
  let rEarth = u.shell.x;
  let minAlt = u.shell.y;
  let maxAlt = u.shell.z;
  let maxDist = u.camFwdMaxDist.w;
  let r0 = rEarth + camAltKm;
  let rInner = rEarth + minAlt;
  let rOuter = rEarth + maxAlt;

  let hitGround = intersectPlanetSphere(r0, rdY, rEarth);
  let hitInner = intersectPlanetSphere(r0, rdY, rInner);
  let hitOuter = intersectPlanetSphere(r0, rdY, rOuter);

  if (camAltKm < minAlt) {
    // Camera below cloud layer (e.g. SF street at 0.05 km)
    if (hitGround.x > 0.0) {
      return vec2f(0.0, 0.0);
    }
    let tStart = max(hitInner.y, 0.0);
    let tEnd = min(hitOuter.y, tStart + maxDist);
    return vec2f(tStart, max(tEnd, tStart));
  }
  if (camAltKm <= maxAlt) {
    // Camera inside cloud layer (e.g. flight at 2.2 km)
    let tStart = 0.0;
    let rawEnd = select(hitOuter.y, hitInner.x, hitInner.x > 0.0);
    let tEnd = min(max(rawEnd, 0.0), maxDist);
    return vec2f(tStart, tEnd);
  }
  // Camera above cloud layer (e.g. 12 km jet / 250 km SPACE)
  if (hitOuter.y <= 0.0 || hitOuter.x < 0.0) {
    return vec2f(0.0, 0.0);
  }
  let tStart = max(hitOuter.x, 0.0);
  let rawEnd = select(hitOuter.y, hitInner.x, hitInner.x > 0.0);
  let tEnd = min(rawEnd, tStart + maxDist);
  return vec2f(tStart, max(tEnd, tStart));
}

fn rayDirForUv(uv: vec2f) -> vec3f {
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let raw = u.camFwdMaxDist.xyz
    + u.camRightAspect.xyz * (ndcX * u.camPosTan.w * u.camRightAspect.w)
    + u.camUpTime.xyz * (ndcY * u.camPosTan.w);
  return normalize(raw);
}
`

// One word per 8x8 weather texels, one bit per radial altitude band.
const MACRO_DIM = CLOUD_LUT_DIMS.weatherSize / 8
const MACRO_WGSL = /* wgsl */ `
${RUNTIME_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> u: CloudUniforms;
@group(0) @binding(1) var weatherTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> occupancy: array<atomic<u32>>;

@compute @workgroup_size(8, 8)
fn cs_cloud_occupancy(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= vec2u(${MACRO_DIM}))) { return; }
  var bounds = vec2f(0.0);
  // Bilinear support crosses the repeat seam on both sides of this tile.
  for (var y = -1; y <= 8; y++) {
    for (var x = -1; x <= 8; x++) {
      let texel = (vec2i(gid.xy) * 8 + vec2i(x,y)) & vec2i(${CLOUD_LUT_DIMS.weatherSize - 1});
      bounds = max(bounds, textureLoad(weatherTex, texel, 0).rb);
    }
  }
  let cov = clamp(mix(bounds.x * u.weather.x * 1.56, 1.0, u.weather.x * u.weather.x * 0.38), 0.0, 1.0);
  let kind = mix(bounds.y, u.weather.z, 0.55);
  var bits = 0u;
  for (var i = 0u; i < 32u; i++) {
    let lo = f32(i) / 32.0;
    let hi = f32(i + 1u) / 32.0;
    let grad = smoothstep(0.0, 0.10, hi) *
      (1.0 - smoothstep(mix(0.22, 0.72, kind), mix(0.44, 0.98, kind), lo));
    // Base shape <= 1 and detail erosion only reduces it. Final smoothstep
    // removes densities up to 0.03. Round outward near the cutoff.
    if (grad + cov - 1.0 >= 0.02999) { bits |= 1u << i; }
  }
  atomicOr(&occupancy[gid.x + gid.y * ${MACRO_DIM}u], bits);
}
`

const TRACE_CLOUDS_WGSL = /* wgsl */ `
${RUNTIME_UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: CloudUniforms;
@group(0) @binding(1) var shapeNoiseTex: texture_3d<f32>;
@group(0) @binding(2) var detailNoiseTex: texture_3d<f32>;
@group(0) @binding(3) var weatherTex: texture_2d<f32>;
@group(0) @binding(4) var repeatSamp: sampler;
@group(0) @binding(5) var traceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var distOut: texture_storage_2d<r32float, write>;

// 6-step cone light-march kernel (Fibonacci-distributed offsets in tangent plane + distance progression)
const LIGHT_STEP_FRACS = array<f32, 6>(0.08, 0.18, 0.34, 0.56, 0.88, 1.45);
const LIGHT_CONE_XY = array<vec2f, 6>(
  vec2f(0.00, 0.00),
  vec2f(0.32, 0.14),
  vec2f(-0.22, 0.38),
  vec2f(0.10, -0.48),
  vec2f(-0.52, -0.18),
  vec2f(0.28, 0.44),
);

@group(0) @binding(7) var<storage, read> cloudBits: array<u32>;

// Walk horizontal columns and clip their occupied radial bands against the curved
// shell. Return the envelope of all hits. Very long user-specified rays retain
// their unvisited tail when the DDA budget runs out.
fn cloudOccupiedInterval(rd: vec3f, shellSpan: vec2f) -> vec2f {
  let scale = u.scales.x * ${MACRO_DIM}.0;
  let origin = (u.camPosTan.xz + u.windTime.xz * u.windTime.w * 0.45) * scale;
  let v = rd.xz * scale;
  var cell = vec2i(floor(origin + v * shellSpan.x));
  var t = shellSpan.x;
  var hits = shellSpan.yx;
  let radius = u.shell.x + u.camPosTan.y;
  let thickness = u.shell.z - u.shell.y;
  // Margin covers the f32 rounding in length(pPlanet)-rEarth in the marcher.
  let pad = 4e-7 * (radius + shellSpan.y + u.shell.z);
  for (var n = 0; n < 64 && t < shellSpan.y; n++) {
    let faces = vec2f(cell) + select(vec2f(0), vec2f(1), v > vec2f(0));
    let crossing = select(vec2f(1e30), (faces - origin) / v, v != vec2f(0));
    let end = max(t, min(shellSpan.y, min(crossing.x, crossing.y)));
    let wrapped = vec2u(cell) & vec2u(${MACRO_DIM - 1}u);
    let bits = cloudBits[wrapped.x + wrapped.y * ${MACRO_DIM}u];
    if (bits != 0u) {
      let bottom = u.shell.x + u.shell.y + thickness * f32(firstTrailingBit(bits)) / 32.0 - pad;
      let top = u.shell.x + u.shell.y + thickness * f32(firstLeadingBit(bits) + 1u) / 32.0 + pad;
      let outer = intersectPlanetSphere(radius, rd.y, top);
      let inner = intersectPlanetSphere(radius, rd.y, bottom);
      var a = max(t, outer.x);
      var b = min(end, outer.y);
      if (a >= inner.x && a < inner.y) { a = inner.y; }
      if (b > inner.x && b <= inner.y) { b = inner.x; }
      if (b > a) { hits = vec2f(min(hits.x, a), max(hits.y, b)); }
    }
    cell += select(vec2i(0), vec2i(sign(v)), crossing <= vec2f(end));
    t = end;
  }
  if (t < shellSpan.y) { hits = vec2f(min(hits.x,t), shellSpan.y); }
  return hits;
}

fn ignNoise(xy: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(xy, vec2f(0.06711056, 0.00583715))));
}

fn hgPhase(cosTheta: f32, g: f32) -> f32 {
  let gc = clamp(g, -0.92, 0.92);
  let g2 = gc * gc;
  let denom = max(1e-4, 1.0 + g2 - 2.0 * gc * cosTheta);
  return (1.0 - g2) * CLOUD_INV_4PI / (denom * sqrt(denom));
}

fn heightGradient(h: f32, cloudType: f32) -> f32 {
  let topStart = mix(0.22, 0.72, cloudType);
  let topEnd = mix(0.44, 0.98, cloudType);
  let bot = smoothstep(0.0, 0.10, h);
  let top = 1.0 - smoothstep(topStart, topEnd, h);
  return bot * top;
}

// Evaluates cloud extinction (1/km) at world position (km) and normalized layer height h in [0, 1].
fn sampleCloudDensity(posKm: vec3f, h: f32, useDetail: bool) -> f32 {
  if (h <= 0.001 || h >= 0.999 || u.weather.x <= 0.0001) {
    return 0.0;
  }
  let windShift = u.windTime.xyz * u.windTime.w;
  let weatherUv = (posKm.xz + windShift.xz * 0.45) * u.scales.x;
  let weather = textureSampleLevel(weatherTex, repeatSamp, weatherUv, 0.0);

  let cov = clamp(u.weather.x, 0.0, 1.0);
  let localCov = clamp(mix(weather.r * cov * 1.56, 1.0, cov * cov * 0.38), 0.0, 1.0);
  let cType = clamp(mix(weather.b, u.weather.z, 0.55), 0.0, 1.0);
  let hGrad = heightGradient(h, cType);
  if (localCov * hGrad <= 0.01) {
    return 0.0;
  }

  let shapeUvw = (posKm + windShift + vec3f(0.0, h * 0.65, 0.0)) * u.scales.y;
  let shape = textureSampleLevel(shapeNoiseTex, repeatSamp, shapeUvw, 0.0);
  let lowFreqFbm = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
  var baseCloud = remapClamp(shape.r, (1.0 - lowFreqFbm) * 0.70, 1.0);
  baseCloud *= hGrad;

  let baseWithCov = remapClamp(baseCloud, 1.0 - localCov, 1.0) * localCov;
  if (baseWithCov <= 0.002) {
    return 0.0;
  }

  var dens = baseWithCov;
  if (useDetail && u.scales.w > 0.001) {
    let detailUvw = (posKm + windShift * 1.35) * u.scales.z;
    let detail = textureSampleLevel(detailNoiseTex, repeatSamp, detailUvw, 0.0);
    let detailFbm = detail.r * 0.625 + detail.g * 0.25 + detail.b * 0.125;
    let detailContrast = clamp((detailFbm - 0.18) * 1.38, 0.0, 1.0);
    let detailMod = mix(detailContrast, 1.0 - detailContrast, clamp(h * 3.8, 0.0, 1.0));
    dens = remapClamp(baseWithCov, detailMod * u.scales.w, 1.0);
  }
  dens = smoothstep(0.03, 0.42, dens) * (0.60 + 0.40 * dens);

  return dens * u.weather.y * weather.g;
}

// 6-step cone light march toward sunDir returning accumulated optical depth tau along the sun ray.
fn marchLightCone(posKm: vec3f, pPlanet: vec3f, sunDir: vec3f) -> f32 {
  let rEarth = u.shell.x;
  let minAlt = u.shell.y;
  let thickness = max(u.shell.z - minAlt, 0.1);
  let invThick = u.shell.w;
  let stepScale = thickness * 0.42;

  // Orthonormal tangent frame around sunDir for cone offsets
  let refAxis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(sunDir.y) > 0.92);
  let t1 = normalize(cross(refAxis, sunDir));
  let t2 = cross(sunDir, t1);

  var tau = 0.0;
  var prevFrac = 0.0;
  for (var i = 0; i < 6; i++) {
    let frac = LIGHT_STEP_FRACS[i];
    let dist = frac * stepScale;
    let ds = (frac - prevFrac) * stepScale;
    prevFrac = frac;
    let coneOff = (t1 * LIGHT_CONE_XY[i].x + t2 * LIGHT_CONE_XY[i].y) * (dist * 0.28);
    let lpPlanet = pPlanet + sunDir * dist + coneOff;
    let lAlt = length(lpPlanet) - rEarth;
    let lh = (lAlt - minAlt) * invThick;
    if (lh > 0.001 && lh < 0.999) {
      let lPosKm = vec3f(posKm.x + sunDir.x * dist + coneOff.x, lAlt, posKm.z + sunDir.z * dist + coneOff.z);
      // Use detail erosion on the 2 nearest light steps and fast base shape on distant cone steps
      let d = sampleCloudDensity(lPosKm, lh, i < 2);
      tau += d * ds;
    }
  }
  return tau;
}

// Multi-octave Wrenninge Beer-Powder + dual-lobe Henyey-Greenstein sun scattering energy.
fn evalSunEnergy(tau: f32, cosTheta: f32) -> f32 {
  let g1 = u.sunColG1.w;
  let g2 = u.ambSkyG2.w;

  var scatter = 0.0;
  var atten = 1.0;
  var contrib = 1.0;
  var phaseAtten = 1.0;
  for (var oct = 0; oct < 3; oct++) {
    let beer = exp(-tau * atten);
    let rawFwd = hgPhase(cosTheta, g1 * phaseAtten);
    // Soft-knee compress the extreme on-axis HG needle spike so backlit sunset clouds show a smooth
    // golden silver lining without harsh concentric ring banding or highlight clipping.
    let fwd = rawFwd / (1.0 + rawFwd * 0.35);
    let ph = mix(hgPhase(cosTheta, g2 * phaseAtten), fwd, 0.72);
    scatter += contrib * beer * ph;
    atten *= 0.42;
    contrib *= 0.55;
    phaseAtten *= 0.52;
  }

  // Sugar-powder darkening on dense shadowed undersides, blended away toward forward silver lining
  let powder = 1.0 - exp(-tau * 2.0);
  let powderBlend = mix(0.32 + 0.68 * powder, 1.0, smoothstep(-0.1, 0.75, cosTheta));
  return scatter * powderBlend * (4.0 * CLOUD_PI);
}

@compute @workgroup_size(8, 8, 1)
fn cs_trace_clouds(@builtin(global_invocation_id) gid: vec3u) {
  let cloudW = u32(u.cloudDims.x);
  let cloudH = u32(u.cloudDims.y);
  let fullFrame = u.sched.z != 0u;

  var coord: vec2u;
  if (fullFrame) {
    if (gid.x >= cloudW || gid.y >= cloudH) {
      return;
    }
    coord = gid.xy;
  } else {
    if (gid.x >= u.counts.y || gid.y >= u.counts.z) {
      return;
    }
    coord = min(gid.xy * 4u + u.sched.xy, vec2u(cloudW - 1u, cloudH - 1u));
  }

  let uv = (vec2f(coord) + 0.5) * u.prevAndInvDims.zw;
  let rd = rayDirForUv(uv);
  let camAltKm = u.camPosTan.y;
  let interval = cloudShellInterval(camAltKm, rd.y);
  let tStart = interval.x;
  let tEnd = interval.y;
  let span = tEnd - tStart;

  if (span <= 0.001 || u.weather.x <= 0.0001) {
    textureStore(traceOut, vec2i(coord), vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(distOut, vec2i(coord), vec4f(max(tStart, 10.0), 0.0, 0.0, 0.0));
    return;
  }

  let rEarth = u.shell.x;
  let minAlt = u.shell.y;
  let invThick = u.shell.w;
  let roPlanet = vec3f(0.0, rEarth + camAltKm, 0.0);
  let sunDir = u.sunDirInfo.xyz;
  let sunColor = u.sunColG1.rgb;
  let ambSky = u.ambSkyG2.rgb;
  let ambGround = u.ambGroundSteps.rgb;
  let cosTheta = dot(rd, sunDir);

  let maxSteps = i32(u.ambGroundSteps.w);
  let baseDt = span / f32(maxSteps);
  let jitter = fract(ignNoise(vec2f(coord)) + f32(u.counts.x & 255u) * 0.61803399);

  var t = tStart + jitter * baseDt;
  var transmittance = 1.0;
  var radiance = vec3f(0.0);
  var weightedDist = 0.0;
  var distWeight = 0.0;
  var zeroStreak = 0;

  let occupied = cloudOccupiedInterval(rd, interval);
  // Preserve the baseline three fine empty steps and subsequent two-step stride.
  // Entry refinement and distance fading still use the original shell origin.
  var firstStep = 0;
  if (occupied.x > t + 3.0 * baseDt) {
    let pairs = floor((occupied.x - t - 3.0 * baseDt) / (2.0 * baseDt));
    t += (3.0 + 2.0 * pairs) * baseDt;
    zeroStreak = 3;
    firstStep = 3 + i32(pairs);
  }
  let maxRayDist = u.camFwdMaxDist.w;
  let sunActive = dot(sunColor, vec3f(1.0)) > 1e-5;

  for (var step = firstStep; step < 96; step++) {
    if (step >= maxSteps || t > occupied.y || t >= tEnd || transmittance < 0.01) {
      break;
    }

    // Adaptive stride: march 2x faster through empty air, refine back 1 step upon entering a cloud
    let stride = select(1.0, 2.0, zeroStreak >= 3);
    let dt = min(baseDt * stride, tEnd - t);
    let pPlanet = roPlanet + rd * t;
    let altKm = length(pPlanet) - rEarth;
    let h = (altKm - minAlt) * invThick;
    let worldPosKm = vec3f(u.camPosTan.x + rd.x * t, altKm, u.camPosTan.z + rd.z * t);

    let sigmaT = sampleCloudDensity(worldPosKm, h, zeroStreak < 3);
    if (sigmaT > 0.0005) {
      if (zeroStreak >= 3) {
        // Refine back half a coarse stride on cloud entry so thin wisps are never skipped
        t = max(tStart, t - baseDt);
        zeroStreak = 0;
        continue;
      }
      zeroStreak = 0;

      // Smooth horizon distance attenuation so distant cloud edges dissolve cleanly into sky
      let distFade = 1.0 - smoothstep(maxRayDist * 0.60, maxRayDist, t - tStart);
      let effSigma = sigmaT * distFade;
      if (effSigma > 0.0002) {
        var direct = vec3f(0.0);
        var lightTau = 0.0;
        if (sunActive) {
          lightTau = marchLightCone(worldPosKm, pPlanet, sunDir);
          direct = sunColor * evalSunEnergy(lightTau, cosTheta);
        }
        // Ambient sky-top & ground-bounce gradient with sculpted cumulus underside shadowing
        let ambGrad = mix(ambGround, ambSky, clamp(h * 0.85 + 0.15, 0.0, 1.0));
        let ambOcc = mix(0.28, 1.0, clamp(h * 1.10, 0.0, 1.0)) * mix(0.55, 1.0, exp(-lightTau * 0.40));
        let luminance = (direct + ambGrad * ambOcc) * effSigma;

        // Analytical Beer-Lambert step integration (Hillaire 2016)
        let stepTrans = exp(-effSigma * dt);
        let integScatter = (luminance - luminance * stepTrans) / max(effSigma, 1e-6);
        let weight = transmittance * (1.0 - stepTrans);
        radiance += transmittance * integScatter;
        weightedDist += t * weight;
        distWeight += weight;
        transmittance *= stepTrans;
      }
    } else {
      zeroStreak += 1;
    }

    t += dt;
  }

  if (transmittance < 0.01) {
    transmittance = 0.0;
  }

  // Clamp finite linear HDR output so NaN/Inf can never enter temporal history
  let okRgb = (radiance >= vec3f(0.0)) & (radiance <= vec3f(F16_MAX_VAL));
  let safeRgb = clamp(select(vec3f(0.0), radiance, okRgb), vec3f(0.0), vec3f(F16_MAX_VAL));
  let safeTrans = clamp(select(1.0, transmittance, transmittance >= 0.0 && transmittance <= 1.0), 0.0, 1.0);
  let hitDistKm = select(0.5 * (tStart + tEnd), weightedDist / max(distWeight, 1e-5), distWeight > 1e-4);

  textureStore(traceOut, vec2i(coord), vec4f(safeRgb, safeTrans));
  textureStore(distOut, vec2i(coord), vec4f(hitDistKm, 0.0, 0.0, 0.0));
}
`

const REPROJECT_CLOUDS_WGSL = /* wgsl */ `
${RUNTIME_UNIFORMS_WGSL}

@group(0) @binding(0) var<uniform> u: CloudUniforms;
@group(0) @binding(1) var traceTex: texture_2d<f32>;
@group(0) @binding(2) var distTex: texture_2d<f32>;
@group(0) @binding(3) var historyIn: texture_2d<f32>;
@group(0) @binding(4) var linearSamp: sampler;
@group(0) @binding(5) var historyOut: texture_storage_2d<rgba16float, write>;

fn sanitizeCloud(c: vec4f) -> vec4f {
  let okRgb = (c.rgb >= vec3f(0.0)) & (c.rgb <= vec3f(F16_MAX_VAL));
  let rgb = clamp(select(vec3f(0.0), c.rgb, okRgb), vec3f(0.0), vec3f(F16_MAX_VAL));
  let okA = c.a >= 0.0 && c.a <= 1.0;
  let a = clamp(select(1.0, c.a, okA), 0.0, 1.0);
  return vec4f(rgb, a);
}

@compute @workgroup_size(8, 8, 1)
fn cs_reproject_clouds(@builtin(global_invocation_id) gid: vec3u) {
  let cloudW = u32(u.cloudDims.x);
  let cloudH = u32(u.cloudDims.y);
  if (gid.x >= cloudW || gid.y >= cloudH) {
    return;
  }

  let coord = gid.xy;
  let fullFrame = u.sched.z != 0u;
  if (fullFrame) {
    let direct = sanitizeCloud(textureLoad(traceTex, vec2i(coord), 0));
    textureStore(historyOut, vec2i(coord), direct);
    return;
  }

  let bayerOff = u.sched.xy;
  let maxCoord = vec2u(cloudW - 1u, cloudH - 1u);
  let block = coord >> vec2u(2u);
  let maxBlock = vec2i(i32(u.counts.y) - 1, i32(u.counts.z) - 1);
  let ownTraced = min(block * 4u + bayerOff, maxCoord);
  let isTraced = all(coord == ownTraced);

  // Gather 3x3 neighborhood of newly traced block samples for ghost-free clamping & spatial fallback
  var nMin = vec4f(F16_MAX_VAL, F16_MAX_VAL, F16_MAX_VAL, 1.0);
  var nMax = vec4f(0.0, 0.0, 0.0, 0.0);
  var spatialSum = vec4f(0.0);
  var spatialW = 0.0;
  let pF = vec2f(coord);

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let nb = clamp(vec2i(block) + vec2i(dx, dy), vec2i(0), maxBlock);
      let nbCoord = min(vec2u(nb) * 4u + bayerOff, maxCoord);
      let s = sanitizeCloud(textureLoad(traceTex, vec2i(nbCoord), 0));
      nMin = min(nMin, s);
      nMax = max(nMax, s);
      let dVec = vec2f(nbCoord) - pF;
      let w = 1.0 / (1.0 + dot(dVec, dVec) * 0.12);
      spatialSum += s * w;
      spatialW += w;
    }
  }
  let spatialFill = spatialSum / max(spatialW, 1e-5);

  // Reproject current pixel's cloud-shell point into previous frame via prevViewProj
  let historyValid = u.sched.w != 0u;
  var hasPrev = false;
  var histVal = spatialFill;

  if (historyValid) {
    let uv = (vec2f(coord) + 0.5) * u.prevAndInvDims.zw;
    let rd = rayDirForUv(uv);
    let hitDistKm = max(textureLoad(distTex, vec2i(ownTraced), 0).r, 0.5);
    let relFromPrevKm = u.camDeltaScaleX.xyz + rd * hitDistKm;
    let prevClip = u.prevViewProj * vec4f(relFromPrevKm, 1.0);
    if (prevClip.w > 1e-4) {
      let prevNdc = prevClip.xy / prevClip.w;
      let prevUv = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
      if (prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0) {
        let prevScale = u.prevScaleInvMax.xy;
        let halfTexel = u.prevScaleInvMax.zw * 0.5;
        let maxTexUv = max(prevScale - halfTexel, halfTexel);
        let sampleUv = clamp(prevUv * prevScale, halfTexel, maxTexUv);
        histVal = sanitizeCloud(textureSampleLevel(historyIn, linearSamp, sampleUv, 0.0));
        hasPrev = true;
      }
    }
  }

  var outVal: vec4f;
  if (isTraced) {
    let fresh = sanitizeCloud(textureLoad(traceTex, vec2i(coord), 0));
    if (hasPrev) {
      let clampedHist = clamp(histVal, nMin, nMax);
      // Strong fresh weight ensures 16-frame convergence while gently damping IGN jitter
      outVal = mix(clampedHist, fresh, 0.90);
    } else {
      outVal = fresh;
    }
  } else if (hasPrev) {
    // 3x3 neighborhood clamp around newly traced pixels prevents ghosting while preserving detail
    let margin = (nMax - nMin) * 0.02 + vec4f(0.002, 0.002, 0.002, 0.005);
    outVal = clamp(histVal, max(nMin - margin, vec4f(0.0)), min(nMax + margin, vec4f(F16_MAX_VAL, F16_MAX_VAL, F16_MAX_VAL, 1.0)));
  } else {
    // Instant spatial fill for out-of-frustum / disoccluded pixels
    outVal = spatialFill;
  }

  textureStore(historyOut, vec2i(coord), sanitizeCloud(outVal));
}
`

const COMPOSITE_SKY_UNIFORM_BYTES = 80

const COMPOSITE_SKY_WGSL = /* wgsl */ `
${VOLUMETRIC_CLOUDS_WGSL}

struct CloudSkyCompositeUniforms {
  // xy: active viewport size, z: hasFarDepth (0/1), w: hasPanes (0/1)
  viewportFlags: vec4f,
  // xyz: cameraForward, w: camAltKm
  camFwdAlt: vec4f,
  // xyz: cameraRight, w: aspect
  camRightAspect: vec4f,
  // xyz: cameraUp, w: tanHalfFovY
  camUpTan: vec4f,
  // x: cloudMinAltKm, y..w: pad
  fadeInfo: vec4f,
}

@group(0) @binding(0) var volCloudsTex: texture_2d<f32>;
@group(0) @binding(1) var volCloudsSampler: sampler;
@group(0) @binding(2) var<uniform> volCloudsParams: VolumetricCloudsParams;
@group(0) @binding(3) var sceneDepth: texture_depth_2d;
@group(0) @binding(4) var farDepthTex: texture_depth_2d;
@group(0) @binding(5) var panesTex: texture_2d<f32>;
@group(0) @binding(6) var<uniform> skyComp: CloudSkyCompositeUniforms;

@vertex fn vs(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((idx << 1u) & 2u), f32(idx & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dDims = vec2i(textureDimensions(sceneDepth));
  let px = clamp(vec2i(pos.xy), vec2i(0), max(dDims - vec2i(1), vec2i(0)));
  if (textureLoad(sceneDepth, px, 0) < 0.999999) {
    discard;
  }
  if (skyComp.viewportFlags.z > 0.5) {
    let fDims = vec2i(textureDimensions(farDepthTex));
    let fpx = clamp(px, vec2i(0), max(fDims - vec2i(1), vec2i(0)));
    if (textureLoad(farDepthTex, fpx, 0) > 0.0) {
      discard;
    }
  }
  if (skyComp.viewportFlags.w > 0.5) {
    let pDims = vec2i(textureDimensions(panesTex));
    let ppx = clamp(px, vec2i(0), max(pDims - vec2i(1), vec2i(0)));
    if (textureLoad(panesTex, ppx, 0).a > 0.0) {
      discard;
    }
  }

  let uv = pos.xy / max(skyComp.viewportFlags.xy, vec2f(1.0));
  var cloud = sampleVolumetricClouds(uv);
  if (skyComp.camFwdAlt.w < skyComp.fadeInfo.x) {
    let ndcX = uv.x * 2.0 - 1.0;
    let ndcY = 1.0 - uv.y * 2.0;
    let rd = normalize(
      skyComp.camFwdAlt.xyz
      + skyComp.camRightAspect.xyz * (ndcX * skyComp.camUpTan.w * skyComp.camRightAspect.w)
      + skyComp.camUpTan.xyz * (ndcY * skyComp.camUpTan.w)
    );
    let elevFade = smoothstep(0.004, 0.065, rd.y);
    cloud = vec4f(cloud.rgb * elevFade, mix(1.0, cloud.a, elevFade));
  }
  let trans = clamp(cloud.a, 0.0, 1.0);
  let scatter = max(cloud.rgb, vec3f(0.0));
  if (trans >= 0.9998 && max(scatter.r, max(scatter.g, scatter.b)) <= 1e-5) {
    discard;
  }
  // Linear HDR blend: dst = dst * trans + scatter.
  return vec4f(scatter, trans);
}
`

/**
 * Creates a standalone, zero-GC WebGPU volumetric 3D cloud engine sized up to `maxSize`.
 * Precomputes the tileable 3D shape, 3D detail, and 2D weather noise LUTs once on the GPU.
 */
export async function createVolumetricClouds(
  device: GPUDevice,
  maxSize: readonly [number, number] = [1920, 1080],
): Promise<VolumetricClouds> {
  const maxW = Math.max(2, Math.floor(maxSize[0]))
  const maxH = Math.max(2, Math.floor(maxSize[1]))
  const maxCloudW = ceilDiv(maxW, 2)
  const maxCloudH = ceilDiv(maxH, 2)
  const reportedMax: readonly [number, number] = [maxW, maxH]
  const reportedMaxCloud: readonly [number, number] = [maxCloudW, maxCloudH]

  // Compile init + runtime compute shaders and sky composite shader in parallel.
  const [genShapeMod, genDetailMod, genWeatherMod, traceMod, reprojectMod, compSkyMod, macroMod] = await Promise.all([
    shader(device, 'vol-clouds-gen-shape', GEN_SHAPE_WGSL),
    shader(device, 'vol-clouds-gen-detail', GEN_DETAIL_WGSL),
    shader(device, 'vol-clouds-gen-weather', GEN_WEATHER_WGSL),
    shader(device, 'vol-clouds-trace', TRACE_CLOUDS_WGSL),
    shader(device, 'vol-clouds-reproject', REPROJECT_CLOUDS_WGSL),
    shader(device, 'vol-clouds-composite-sky', COMPOSITE_SKY_WGSL),
    shader(device, 'vol-clouds-occupancy', MACRO_WGSL),
  ])

  // Explicit bind group layouts (zero layout:'auto' surprises).
  const genShapeBgl = device.createBindGroupLayout({
    label: 'vol-clouds-gen-shape-bgl',
    entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } }],
  })
  const genDetailBgl = device.createBindGroupLayout({
    label: 'vol-clouds-gen-detail-bgl',
    entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } }],
  })
  const genWeatherBgl = device.createBindGroupLayout({
    label: 'vol-clouds-gen-weather-bgl',
    entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' } }],
  })
  const traceBgl = device.createBindGroupLayout({
    label: 'vol-clouds-trace-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' } },
    ],
  })
  const reprojectBgl = device.createBindGroupLayout({
    label: 'vol-clouds-reproject-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
    ],
  })

  const [genShapePipe, genDetailPipe, genWeatherPipe, tracePipe, reprojectPipe] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'vol-clouds-gen-shape',
      layout: device.createPipelineLayout({ bindGroupLayouts: [genShapeBgl] }),
      compute: { module: genShapeMod, entryPoint: 'cs_gen_shape' },
    }),
    device.createComputePipelineAsync({
      label: 'vol-clouds-gen-detail',
      layout: device.createPipelineLayout({ bindGroupLayouts: [genDetailBgl] }),
      compute: { module: genDetailMod, entryPoint: 'cs_gen_detail' },
    }),
    device.createComputePipelineAsync({
      label: 'vol-clouds-gen-weather',
      layout: device.createPipelineLayout({ bindGroupLayouts: [genWeatherBgl] }),
      compute: { module: genWeatherMod, entryPoint: 'cs_gen_weather' },
    }),
    device.createComputePipelineAsync({
      label: 'vol-clouds-trace',
      layout: device.createPipelineLayout({ bindGroupLayouts: [traceBgl] }),
      compute: { module: traceMod, entryPoint: 'cs_trace_clouds' },
    }),
    device.createComputePipelineAsync({
      label: 'vol-clouds-reproject',
      layout: device.createPipelineLayout({ bindGroupLayouts: [reprojectBgl] }),
      compute: { module: reprojectMod, entryPoint: 'cs_reproject_clouds' },
    }),
  ])

  // Persistent precomputed LUT textures (generated ONCE at init).
  const shapeNoiseTexture = device.createTexture({
    label: 'vol-clouds-shape-3d',
    dimension: '3d',
    size: [CLOUD_LUT_DIMS.shapeSize, CLOUD_LUT_DIMS.shapeSize, CLOUD_LUT_DIMS.shapeSize],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const detailNoiseTexture = device.createTexture({
    label: 'vol-clouds-detail-3d',
    dimension: '3d',
    size: [CLOUD_LUT_DIMS.detailSize, CLOUD_LUT_DIMS.detailSize, CLOUD_LUT_DIMS.detailSize],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const weatherTexture = device.createTexture({
    label: 'vol-clouds-weather-2d',
    dimension: '2d',
    size: [CLOUD_LUT_DIMS.weatherSize, CLOUD_LUT_DIMS.weatherSize, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })

  const shapeView = shapeNoiseTexture.createView({ dimension: '3d' })
  const detailView = detailNoiseTexture.createView({ dimension: '3d' })
  const weatherView = weatherTexture.createView()

  // Populate the 3 tileable noise volumes ONCE on the GPU right now.
  {
    const initEnc = device.createCommandEncoder({ label: 'vol-clouds-init-luts' })

    const shapeBg = device.createBindGroup({
      layout: genShapeBgl,
      entries: [{ binding: 0, resource: shapeView }],
    })
    const pShape = initEnc.beginComputePass({ label: 'vol-clouds-gen-shape' })
    pShape.setPipeline(genShapePipe)
    pShape.setBindGroup(0, shapeBg)
    pShape.dispatchWorkgroups(
      ceilDiv(CLOUD_LUT_DIMS.shapeSize, 4),
      ceilDiv(CLOUD_LUT_DIMS.shapeSize, 4),
      ceilDiv(CLOUD_LUT_DIMS.shapeSize, 4),
    )
    pShape.end()

    const detailBg = device.createBindGroup({
      layout: genDetailBgl,
      entries: [{ binding: 0, resource: detailView }],
    })
    const pDetail = initEnc.beginComputePass({ label: 'vol-clouds-gen-detail' })
    pDetail.setPipeline(genDetailPipe)
    pDetail.setBindGroup(0, detailBg)
    pDetail.dispatchWorkgroups(
      ceilDiv(CLOUD_LUT_DIMS.detailSize, 4),
      ceilDiv(CLOUD_LUT_DIMS.detailSize, 4),
      ceilDiv(CLOUD_LUT_DIMS.detailSize, 4),
    )
    pDetail.end()

    const weatherBg = device.createBindGroup({
      layout: genWeatherBgl,
      entries: [{ binding: 0, resource: weatherView }],
    })
    const pWeather = initEnc.beginComputePass({ label: 'vol-clouds-gen-weather' })
    pWeather.setPipeline(genWeatherPipe)
    pWeather.setBindGroup(0, weatherBg)
    pWeather.dispatchWorkgroups(
      ceilDiv(CLOUD_LUT_DIMS.weatherSize, 8),
      ceilDiv(CLOUD_LUT_DIMS.weatherSize, 8),
    )
    pWeather.end()

    device.queue.submit([initEnc.finish()])
  }

  // Persistent quarter-res trace, hit-distance, and ping-pong temporal history textures (0 reallocs).
  const traceTex = device.createTexture({
    label: 'vol-clouds-trace',
    size: [maxCloudW, maxCloudH, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const distTex = device.createTexture({
    label: 'vol-clouds-dist',
    size: [maxCloudW, maxCloudH, 1],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  })
  const historyTextures: readonly [GPUTexture, GPUTexture] = [
    device.createTexture({
      label: 'vol-clouds-history-0',
      size: [maxCloudW, maxCloudH, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    }),
    device.createTexture({
      label: 'vol-clouds-history-1',
      size: [maxCloudW, maxCloudH, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    }),
  ]

  const traceView = traceTex.createView()
  const distView = distTex.createView()
  const historyViews: readonly [GPUTextureView, GPUTextureView] = [
    historyTextures[0].createView(),
    historyTextures[1].createView(),
  ]

  const repeatSampler = device.createSampler({
    label: 'vol-clouds-repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    addressModeW: 'repeat',
  })
  const clampSampler = device.createSampler({
    label: 'vol-clouds-clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const uniformBuffer = device.createBuffer({
    label: 'vol-clouds-uniforms',
    size: CLOUD_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const compositeUniforms = device.createBuffer({
    label: 'vol-clouds-composite-u',
    size: COMPOSITE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  // Pre-allocated zero-GC CPU staging buffers.
  const uniformBacking = new ArrayBuffer(CLOUD_UNIFORM_BYTES)
  const uf = new Float32Array(uniformBacking)
  const uu = new Uint32Array(uniformBacking)
  const compositeBacking = new ArrayBuffer(COMPOSITE_UNIFORM_BYTES)
  const cf = new Float32Array(compositeBacking)
  const sunTransScratch: [number, number, number] = [1, 1, 1]

  const macroBuffer = device.createBuffer({
    size: MACRO_DIM * MACRO_DIM * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const macroPipe = await device.createComputePipelineAsync({
    layout: 'auto', compute: { module: macroMod, entryPoint: 'cs_cloud_occupancy' },
  })
  const macroBind = device.createBindGroup({
    layout: macroPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: weatherView },
      { binding: 2, resource: { buffer: macroBuffer } },
    ],
  })
  const traceBindGroup = device.createBindGroup({
    label: 'vol-clouds-trace-bg',
    layout: traceBgl,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: shapeView },
      { binding: 2, resource: detailView },
      { binding: 3, resource: weatherView },
      { binding: 4, resource: repeatSampler },
      { binding: 5, resource: traceView },
      { binding: 6, resource: distView },
      { binding: 7, resource: { buffer: macroBuffer } },
    ],
  })

  // Ping-pong reprojection bind groups: index 0 reads history[1] -> writes history[0]; index 1 reverses.
  const reprojectBindGroups: readonly [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      label: 'vol-clouds-reproject-bg-0',
      layout: reprojectBgl,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: traceView },
        { binding: 2, resource: distView },
        { binding: 3, resource: historyViews[1] },
        { binding: 4, resource: clampSampler },
        { binding: 5, resource: historyViews[0] },
      ],
    }),
    device.createBindGroup({
      label: 'vol-clouds-reproject-bg-1',
      layout: reprojectBgl,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: traceView },
        { binding: 2, resource: distView },
        { binding: 3, resource: historyViews[0] },
        { binding: 4, resource: clampSampler },
        { binding: 5, resource: historyViews[1] },
      ],
    }),
  ]

  // Estimated persistent GPU VRAM footprint (bytes).
  const vramBytes = macroBuffer.size +
    CLOUD_LUT_DIMS.shapeSize ** 3 * 4 +
    CLOUD_LUT_DIMS.detailSize ** 3 * 4 +
    CLOUD_LUT_DIMS.weatherSize ** 2 * 4 +
    maxCloudW * maxCloudH * (8 + 4 + 8 + 8) +
    CLOUD_UNIFORM_BYTES +
    COMPOSITE_UNIFORM_BYTES

  // Mutable zero-GC temporal state.
  const prevCamPosKm: [number, number, number] = [0, 0.05, 0]
  const prevRight: [number, number, number] = [1, 0, 0]
  const prevUp: [number, number, number] = [0, 1, 0]
  const prevForward: [number, number, number] = [0, 0, -1]
  let prevTanHalf = Math.tan(Math.PI / 6)
  let prevAspect = 16 / 9
  let prevCloudW = maxCloudW
  let prevCloudH = maxCloudH
  let lastRenderW = maxW
  let lastRenderH = maxH
  let lastCloudW = maxCloudW
  let lastCloudH = maxCloudH

  let ping = 0
  let lastOutIdx = 0
  let frames = 0
  let fullFrames = 0
  let amortizedFrames = 0
  let lastBayerIndex = 0
  let historyValid = false
  const reallocs = 0
  let destroyed = false

  // Reusable pass descriptors (avoid per-frame object churn when no timestampWrites).
  const tracePassDesc: GPUComputePassDescriptor = { label: 'vol-clouds-trace' }
  const reprojectPassDesc: GPUComputePassDescriptor = { label: 'vol-clouds-reproject' }

  // Lazy fullscreen sky composite resources (strictly sky pixels behind marched & far geometry).
  let lastCloudMinAltKm: number = DEFAULT_CLOUD_SHELL.cloudMinAltKm
  const compSkyBgl = device.createBindGroupLayout({
    label: 'vol-clouds-comp-sky-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const compSkyPl = device.createPipelineLayout({ label: 'vol-clouds-comp-sky-pl', bindGroupLayouts: [compSkyBgl] })
  const compSkyPipelines = new Map<GPUTextureFormat, GPURenderPipeline>()
  let compSkyUniformBuf: GPUBuffer | null = null
  const compSkyStaging = new Float32Array(new ArrayBuffer(COMPOSITE_SKY_UNIFORM_BYTES))
  let dummyFarDepthTex: GPUTexture | null = null
  let dummyFarDepthView: GPUTextureView | null = null
  let dummyPanesTex: GPUTexture | null = null
  let dummyPanesView: GPUTextureView | null = null
  let compCachedDepth: GPUTextureView | null = null
  let compCachedFarDepth: GPUTextureView | null = null
  let compCachedPanes: GPUTextureView | null = null
  const compSkyBinds: [GPUBindGroup | null, GPUBindGroup | null] = [null, null]

  const ensureCompSkyResources = () => {
    if (!compSkyUniformBuf) {
      compSkyUniformBuf = device.createBuffer({
        label: 'vol-clouds-comp-sky-u',
        size: COMPOSITE_SKY_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    }
    if (!dummyFarDepthTex) {
      dummyFarDepthTex = device.createTexture({
        label: 'vol-clouds-dummy-fardepth',
        size: [1, 1, 1],
        format: 'depth32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      dummyFarDepthView = dummyFarDepthTex.createView()
      const enc = device.createCommandEncoder({ label: 'vol-clouds-clear-dummy-fardepth' })
      enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: dummyFarDepthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      }).end()
      device.queue.submit([enc.finish()])
    }
    if (!dummyPanesTex) {
      dummyPanesTex = device.createTexture({
        label: 'vol-clouds-dummy-panes',
        size: [1, 1, 1],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      device.queue.writeTexture({ texture: dummyPanesTex }, new Uint16Array(4), { bytesPerRow: 8 }, [1, 1, 1])
      dummyPanesView = dummyPanesTex.createView()
    }
  }

  const getCompSkyPipeline = (format: GPUTextureFormat): GPURenderPipeline => {
    let pipe = compSkyPipelines.get(format)
    if (!pipe) {
      pipe = device.createRenderPipeline({
        label: `vol-clouds-comp-sky-${format}`,
        layout: compSkyPl,
        vertex: { module: compSkyMod, entryPoint: 'vs' },
        fragment: {
          module: compSkyMod,
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      })
      compSkyPipelines.set(format, pipe)
    }
    return pipe
  }

  const self: VolumetricClouds = {
    get texture() {
      return historyTextures[lastOutIdx]
    },
    get view() {
      return historyViews[lastOutIdx]
    },
    sampler: clampSampler,
    compositeUniforms,
    shapeNoiseTexture,
    detailNoiseTexture,
    weatherTexture,

    update(encoder: GPUCommandEncoder, params: VolumetricCloudsParams): GPUTextureView {
      if (destroyed) throw new Error('volumetric-clouds: update() called after destroy()')

      const renderW = clamp(Math.floor(params.renderSize[0]), 2, maxW)
      const renderH = clamp(Math.floor(params.renderSize[1]), 2, maxH)
      const cloudW = Math.min(maxCloudW, ceilDiv(renderW, 2))
      const cloudH = Math.min(maxCloudH, ceilDiv(renderH, 2))
      const aspect = Math.max(params.aspect ?? renderW / renderH, 1e-3)
      const tanHalf = Math.max(params.tanHalfFovY, 1e-4)

      const camPos = params.cameraPosKm ?? [0, 0.05, 0]
      const camX = camPos[0]
      const camAlt = Math.max(camPos[1], 0.0)
      const camZ = camPos[2]

      const fwd = unit3(params.cameraForward, [0, 0, -1])
      const right = unit3(params.cameraRight, [1, 0, 0])
      const up = unit3(params.cameraUp, [0, 1, 0])

      const sunDir = unit3(params.sunDir ?? [0.5088, 0.7632, 0.3976], [0, 1, 0])
      const sunBase = params.sunColor ?? [3.4, 3.25, 3.05]
      const applyTrans = params.applySunTransmittance ?? true
      if (applyTrans) {
        computeSunTransmittance(sunDir[1], sunTransScratch)
      } else {
        sunTransScratch[0] = 1
        sunTransScratch[1] = 1
        sunTransScratch[2] = 1
      }
      const effSunR = sunBase[0] * sunTransScratch[0]
      const effSunG = sunBase[1] * sunTransScratch[1]
      const effSunB = sunBase[2] * sunTransScratch[2]

      // Physical day / golden-hour / twilight / night sky-top and ground-bounce ambient terms.
      const dayT = clamp((sunDir[1] + 0.04) / 0.35, 0, 1)
      const duskT = clamp(1 - Math.abs(sunDir[1] - 0.05) / 0.22, 0, 1) * clamp((sunDir[1] + 0.08) / 0.10, 0, 1)
      let ambSkyR: number, ambSkyG: number, ambSkyB: number
      if (params.ambientSky) {
        ambSkyR = params.ambientSky[0]
        ambSkyG = params.ambientSky[1]
        ambSkyB = params.ambientSky[2]
      } else {
        ambSkyR = 0.015 + dayT * 0.26 + duskT * 0.14
        ambSkyG = 0.022 + dayT * 0.36 + duskT * 0.06
        ambSkyB = 0.045 + dayT * 0.56 - duskT * 0.08
      }
      let ambGndR: number, ambGndG: number, ambGndB: number
      if (params.ambientGround) {
        ambGndR = params.ambientGround[0]
        ambGndG = params.ambientGround[1]
        ambGndB = params.ambientGround[2]
      } else {
        ambGndR = 0.008 + dayT * 0.14 + duskT * 0.16
        ambGndG = 0.009 + dayT * 0.13 + duskT * 0.06
        ambGndB = 0.014 + dayT * 0.14 - duskT * 0.02
      }

      const planetRadiusKm = Math.max(params.planetRadiusKm ?? DEFAULT_CLOUD_SHELL.planetRadiusKm, 100)
      const cloudMinAltKm = Math.max(params.cloudMinAltKm ?? DEFAULT_CLOUD_SHELL.cloudMinAltKm, 0.05)
      lastCloudMinAltKm = cloudMinAltKm
      const cloudMaxAltKm = Math.max(params.cloudMaxAltKm ?? DEFAULT_CLOUD_SHELL.cloudMaxAltKm, cloudMinAltKm + 0.2)
      const maxRayDistKm = Math.max(params.maxRayDistKm ?? DEFAULT_CLOUD_SHELL.maxRayDistKm, 5)
      const coverage = clamp(params.coverage ?? DEFAULT_CLOUD_SHELL.coverage, 0, 1)
      const densityScale = Math.max(params.densityScale ?? DEFAULT_CLOUD_SHELL.densityScale, 0)
      const cloudType = clamp(params.cloudType ?? DEFAULT_CLOUD_SHELL.cloudType, 0, 1)
      const detailErosion = clamp(params.detailErosion ?? DEFAULT_CLOUD_SHELL.detailErosion, 0, 0.65)
      const wind = params.windKmPerSec ?? [0.018, 0, 0.006]
      const time = params.time ?? 0
      const maxSteps = clamp(Math.floor(params.maxSteps ?? 48), 16, 96)
      const g1 = clamp(params.silverLiningG ?? DEFAULT_CLOUD_SHELL.silverLiningG, 0.0, 0.92)
      const g2 = clamp(params.backScatterG ?? DEFAULT_CLOUD_SHELL.backScatterG, -0.92, 0.0)
      const strength = clamp(params.strength ?? 1.0, 0, 1)

      const fullFrame = params.reset === true || !historyValid
      const useHistory = historyValid && !fullFrame
      const bayerIndex = frames & 15
      const bayer = BAYER_OFFSETS[bayerIndex]
      const blockW = ceilDiv(cloudW, 4)
      const blockH = ceilDiv(cloudH, 4)

      // Wrap XZ modulo the weather tile LCM (48 km) in float64 so float32 noise stays crisp anywhere on Earth.
      const wrapSpan = DEFAULT_CLOUD_SHELL.weatherTileKm * 4
      const wrappedX = ((camX % wrapSpan) + wrapSpan) % wrapSpan
      const wrappedZ = ((camZ % wrapSpan) + wrapSpan) % wrapSpan

      // Camera translation delta computed in float64 before writing to float32 uniform.
      const deltaX = useHistory ? camX - prevCamPosKm[0] : 0
      const deltaY = useHistory ? camAlt - prevCamPosKm[1] : 0
      const deltaZ = useHistory ? camZ - prevCamPosKm[2] : 0

      // Pack 352-byte uniform block (zero GC).
      // 0: cloudDims
      uf[0] = cloudW; uf[1] = cloudH; uf[2] = maxCloudW; uf[3] = maxCloudH
      // 1: prevAndInvDims
      uf[4] = prevCloudW; uf[5] = prevCloudH; uf[6] = 1 / cloudW; uf[7] = 1 / cloudH
      // 2: camPosTan
      uf[8] = wrappedX; uf[9] = camAlt; uf[10] = wrappedZ; uf[11] = tanHalf
      // 3: camRightAspect
      uf[12] = right[0]; uf[13] = right[1]; uf[14] = right[2]; uf[15] = aspect
      // 4: camUpTime
      uf[16] = up[0]; uf[17] = up[1]; uf[18] = up[2]; uf[19] = time
      // 5: camFwdMaxDist
      uf[20] = fwd[0]; uf[21] = fwd[1]; uf[22] = fwd[2]; uf[23] = maxRayDistKm
      // 6: shell
      uf[24] = planetRadiusKm; uf[25] = cloudMinAltKm; uf[26] = cloudMaxAltKm; uf[27] = 1 / (cloudMaxAltKm - cloudMinAltKm)
      // 7: sunDirInfo
      uf[28] = sunDir[0]; uf[29] = sunDir[1]; uf[30] = sunDir[2]; uf[31] = dayT
      // 8: sunColG1
      uf[32] = effSunR; uf[33] = effSunG; uf[34] = effSunB; uf[35] = g1
      // 9: ambSkyG2
      uf[36] = ambSkyR; uf[37] = ambSkyG; uf[38] = ambSkyB; uf[39] = g2
      // 10: ambGroundSteps
      uf[40] = ambGndR; uf[41] = ambGndG; uf[42] = ambGndB; uf[43] = maxSteps
      // 11: weather
      uf[44] = coverage; uf[45] = densityScale; uf[46] = cloudType; uf[47] = detailErosion
      // 12: windTime
      uf[48] = wind[0]; uf[49] = wind[1]; uf[50] = wind[2]; uf[51] = time
      // 13: scales
      uf[52] = 1 / DEFAULT_CLOUD_SHELL.weatherTileKm
      uf[53] = 1 / DEFAULT_CLOUD_SHELL.shapeTileKm
      uf[54] = 1 / DEFAULT_CLOUD_SHELL.detailTileKm
      uf[55] = detailErosion
      // 14: camDeltaScaleX
      uf[56] = deltaX; uf[57] = deltaY; uf[58] = deltaZ; uf[59] = prevCloudW / maxCloudW
      // 15: sched (vec4u)
      uu[60] = bayer[0]; uu[61] = bayer[1]; uu[62] = fullFrame ? 1 : 0; uu[63] = useHistory ? 1 : 0
      // 16: counts (vec4u)
      uu[64] = frames >>> 0; uu[65] = blockW >>> 0; uu[66] = blockH >>> 0; uu[67] = 0
      // 17: prevScaleInvMax
      uf[68] = prevCloudW / maxCloudW; uf[69] = prevCloudH / maxCloudH; uf[70] = 1 / maxCloudW; uf[71] = 1 / maxCloudH
      // 18..21: prevViewProj (16 floats, offsets 72..87)
      if (useHistory) {
        writePrevViewProj(uf, 72, prevRight, prevUp, prevForward, prevTanHalf, prevAspect)
      } else {
        uf.fill(0, 72, 88)
      }
      device.queue.writeBuffer(uniformBuffer, 0, uniformBacking)

      // Sync composite uniform block for VOLUMETRIC_CLOUDS_WGSL consumers.
      cf[0] = cloudW / maxCloudW
      cf[1] = cloudH / maxCloudH
      cf[2] = 1 / maxCloudW
      cf[3] = 1 / maxCloudH
      cf[4] = coverage > 0.0001 ? 1 : 0
      cf[5] = strength
      cf[6] = cloudW
      cf[7] = cloudH
      device.queue.writeBuffer(compositeUniforms, 0, compositeBacking)

      encoder.clearBuffer(macroBuffer)
      const macro = encoder.beginComputePass({ label: 'vol-clouds-occupancy' })
      macro.setPipeline(macroPipe)
      macro.setBindGroup(0, macroBind)
      macro.dispatchWorkgroups(Math.ceil(MACRO_DIM / 8), Math.ceil(MACRO_DIM / 8))
      macro.end()

      const ts = params.timestampWrites

      // Pass 1: Volumetric cloud raymarch (full quarter-res on reset, 4x4 Bayer block dispatch otherwise).
      {
        const p = encoder.beginComputePass(
          ts?.trace ? { label: 'vol-clouds-trace', timestampWrites: ts.trace } : tracePassDesc,
        )
        p.setPipeline(tracePipe)
        p.setBindGroup(0, traceBindGroup)
        if (fullFrame) {
          p.dispatchWorkgroups(ceilDiv(cloudW, 8), ceilDiv(cloudH, 8))
        } else {
          p.dispatchWorkgroups(ceilDiv(blockW, 8), ceilDiv(blockH, 8))
        }
        p.end()
      }

      // Pass 2: Temporal reprojection & 3x3 neighborhood clamping into ping-pong history output.
      const writeIdx = ping
      {
        const p = encoder.beginComputePass(
          ts?.reproject ? { label: 'vol-clouds-reproject', timestampWrites: ts.reproject } : reprojectPassDesc,
        )
        p.setPipeline(reprojectPipe)
        p.setBindGroup(0, reprojectBindGroups[writeIdx])
        p.dispatchWorkgroups(ceilDiv(cloudW, 8), ceilDiv(cloudH, 8))
        p.end()
      }

      // Update temporal state for next frame.
      prevCamPosKm[0] = camX; prevCamPosKm[1] = camAlt; prevCamPosKm[2] = camZ
      prevRight[0] = right[0]; prevRight[1] = right[1]; prevRight[2] = right[2]
      prevUp[0] = up[0]; prevUp[1] = up[1]; prevUp[2] = up[2]
      prevForward[0] = fwd[0]; prevForward[1] = fwd[1]; prevForward[2] = fwd[2]
      prevTanHalf = tanHalf
      prevAspect = aspect
      prevCloudW = cloudW
      prevCloudH = cloudH
      lastRenderW = renderW
      lastRenderH = renderH
      lastCloudW = cloudW
      lastCloudH = cloudH
      lastOutIdx = writeIdx
      lastBayerIndex = bayerIndex
      ping = 1 - writeIdx
      historyValid = true
      frames++
      if (fullFrame) fullFrames++
      else amortizedFrames++

      return historyViews[writeIdx]
    },

    compositeSky(encoder: GPUCommandEncoder, params: VolumetricCloudsCompositeParams) {
      if (destroyed || frames === 0) return
      const vw = Math.max(1, Math.floor(params.viewportSize[0]))
      const vh = Math.max(1, Math.floor(params.viewportSize[1]))
      ensureCompSkyResources()

      const farView = params.farDepth ?? dummyFarDepthView!
      const panesView = params.panes ?? dummyPanesView!
      if (compCachedDepth !== params.depth || compCachedFarDepth !== farView || compCachedPanes !== panesView) {
        compCachedDepth = params.depth
        compCachedFarDepth = farView
        compCachedPanes = panesView
        compSkyBinds[0] = null
        compSkyBinds[1] = null
      }
      let bg = compSkyBinds[lastOutIdx]
      if (!bg) {
        bg = device.createBindGroup({
          label: `vol-clouds-comp-sky-bg-${lastOutIdx}`,
          layout: compSkyBgl,
          entries: [
            { binding: 0, resource: historyViews[lastOutIdx] },
            { binding: 1, resource: clampSampler },
            { binding: 2, resource: { buffer: compositeUniforms } },
            { binding: 3, resource: params.depth },
            { binding: 4, resource: farView },
            { binding: 5, resource: panesView },
            { binding: 6, resource: { buffer: compSkyUniformBuf! } },
          ],
        })
        compSkyBinds[lastOutIdx] = bg
      }

      const fwd = unit3(params.cameraForward, [0, 0, -1])
      const right = unit3(params.cameraRight, [1, 0, 0])
      const up = unit3(params.cameraUp, [0, 1, 0])
      const aspect = Math.max(params.aspect ?? vw / vh, 1e-3)
      const tanHalf = Math.max(params.tanHalfFovY, 1e-4)

      compSkyStaging[0] = vw
      compSkyStaging[1] = vh
      compSkyStaging[2] = params.farDepth ? 1 : 0
      compSkyStaging[3] = params.panes ? 1 : 0
      compSkyStaging[4] = fwd[0]; compSkyStaging[5] = fwd[1]; compSkyStaging[6] = fwd[2]
      compSkyStaging[7] = Math.max(params.camAltKm ?? 0.05, 0)
      compSkyStaging[8] = right[0]; compSkyStaging[9] = right[1]; compSkyStaging[10] = right[2]
      compSkyStaging[11] = aspect
      compSkyStaging[12] = up[0]; compSkyStaging[13] = up[1]; compSkyStaging[14] = up[2]
      compSkyStaging[15] = tanHalf
      compSkyStaging[16] = lastCloudMinAltKm
      compSkyStaging[17] = 0; compSkyStaging[18] = 0; compSkyStaging[19] = 0
      device.queue.writeBuffer(compSkyUniformBuf!, 0, compSkyStaging)

      const pass = encoder.beginRenderPass({
        label: 'vol-clouds-composite-sky',
        colorAttachments: [{ view: params.target, loadOp: 'load', storeOp: 'store' }],
        ...(params.timestampWrites ? { timestampWrites: params.timestampWrites } : {}),
      })
      pass.setViewport(0, 0, vw, vh, 0, 1)
      pass.setScissorRect(0, 0, vw, vh)
      pass.setPipeline(getCompSkyPipeline(params.format))
      pass.setBindGroup(0, bg)
      pass.draw(3)
      pass.end()
    },

    reset() {
      historyValid = false
    },

    stats(): VolumetricCloudsStats {
      return {
        maxSize: reportedMax,
        maxCloudSize: reportedMaxCloud,
        renderSize: [lastRenderW, lastRenderH],
        cloudSize: [lastCloudW, lastCloudH],
        reallocs,
        frames,
        fullFrames,
        amortizedFrames,
        bayerIndex: lastBayerIndex,
        historyValid,
        vramBytes,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      shapeNoiseTexture.destroy()
      detailNoiseTexture.destroy()
      weatherTexture.destroy()
      traceTex.destroy()
      distTex.destroy()
      historyTextures[0].destroy()
      historyTextures[1].destroy()
      macroBuffer.destroy()
      uniformBuffer.destroy()
      compositeUniforms.destroy()
      compSkyUniformBuf?.destroy()
      dummyFarDepthTex?.destroy()
      dummyPanesTex?.destroy()
    },
  }

  return self
}
