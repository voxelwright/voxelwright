// Standalone WebGPU ReSTIR-DI (Spatiotemporal Reservoir Resampling for Direct Illumination,
// Bitterli et al. SIGGRAPH 2020 — Voxel MegaLights) compute engine (#165).
//
// Evaluates hundreds of dynamic point & spot lights with 1 shadow ray per pixel per frame,
// zero light bleed through solid occluders, soft area-light penumbras, and zero-GC persistent
// buffers across dynamic resolution scaling:
//
//   Pass 1 (`cs_ris_initial`, @workgroup_size(8, 8)):
//     - Reconstructs world position, normal, and linear depth from the G-Buffer (`depth24plus`,
//       world/view normal, albedo, roughness/metallic) and snapshots `(worldNormal, linearDepth)`
//       into an internal ping-pong `rgba32float` geometry buffer for temporal/spatial validation.
//     - Draws `M_candidates` (default 16) candidate lights from either an optional 3D frustum
//       cluster grid (`lights-cluster.ts` layout), an O(1) power-weighted Vose alias table, or
//       uniform sampling over the 64-byte `ClusterLight` storage array.
//     - Evaluates GGX target PDF `p_hat(x, y) = luma(BRDF_GGX(x, y) * Li(x, y))` with Weighted
//       Reservoir Sampling (WRS), then traces 1 shadow visibility ray (with disk jitter over
//       `sourceRadius` for soft penumbras) and zeros `W` if occluded.
//
//   Pass 2 (`cs_temporal_reuse`, @workgroup_size(8, 8)):
//     - Reprojects via `rg16float` motion vectors (`prevUV = curUV + vel`), validates geometric
//       similarity against the previous frame (`|expectedPrevZ - prevZ|/expectedPrevZ < 0.05`
//       and `dot(n, prevN) > 0.90`), detects moving lights via the 24-bit light hash packed in
//       `ageFlags`, clamps `M_prev <= M_max` (default 20), and combines current + temporal
//       reservoirs with exact unbiased pairwise/Talbot MIS weights.
//
//   Pass 3 (`cs_spatial_reuse_and_shade`, @workgroup_size(8, 8)):
//     - Samples `k` (default 4) stratified disk neighbors within radius `R` (default 18 px)
//       passing plane/depth, normal, and roughness similarity checks.
//     - Combines valid neighbor reservoirs via exact unbiased Pairwise MIS (preventing edge-bleed
//       fireflies), traces 1 visibility validation ray whenever adopting a spatial neighbor's
//       light (eliminating shadow smearing across corners), and outputs linear HDR direct
//       illumination into a persistent `rgba16float` (`STORAGE_BINDING | TEXTURE_BINDING`) target.
//
// Units: 1 cell = 0.1 m (10 cells = 1 m), matching lights.ts, lights-cluster.ts, march.ts, gpu.ts.
// Screen UV: (0, 0) top-left -> (1, 1) bottom-right.
import { FAR, NEAR, shader } from '../probe/gpu.ts'

export type RestirVec3 = readonly [number, number, number]

/** Byte size of each 64-byte `ClusterLight` record (aligned with `lights-cluster.ts`). */
export const RESTIR_LIGHT_BYTES = 64
/** Byte size of each compact GPU `Reservoir` (`vec4<u32>`). */
export const RESTIR_RESERVOIR_BYTES = 16
/** Byte size of each O(1) Vose alias-table entry (`LightAlias`). */
export const RESTIR_ALIAS_BYTES = 16
/** Sentinel light index for an empty reservoir. */
export const RESTIR_INVALID_LIGHT = 0xffffffff

export const DEFAULT_RESTIR_MAX_SIZE: readonly [number, number] = [1280, 720]
export const DEFAULT_RESTIR_CANDIDATES = 16
export const DEFAULT_RESTIR_MAX_TEMPORAL_M = 20
export const DEFAULT_RESTIR_SPATIAL_NEIGHBORS = 4
export const DEFAULT_RESTIR_SPATIAL_RADIUS = 18
export const DEFAULT_RESTIR_SHADOW_BIAS = 0.15

const LIGHT_FLOATS = 16
const PARAMS_BYTES = 17 * 16 // 17 x vec4 (272 bytes)
const POINT_COS_OUTER = -2.0
const POINT_COS_INNER = -1.0

const FLAG_HAS_HISTORY = 1 << 0
const FLAG_ENABLE_TEMPORAL = 1 << 1
const FLAG_ENABLE_SPATIAL = 1 << 2
const FLAG_USE_ALIAS = 1 << 3
const FLAG_USE_CLUSTERS = 1 << 4
const FLAG_VIEW_NORMALS = 1 << 5
const FLAG_SCENE_EVAL = 1 << 6

const RIS_PASS_DESC: GPUComputePassDescriptor = { label: 'restir-ris-initial' }
const TEMPORAL_PASS_DESC: GPUComputePassDescriptor = { label: 'restir-temporal-reuse' }
const SPATIAL_PASS_DESC: GPUComputePassDescriptor = { label: 'restir-spatial-shade' }

/**
 * Reusable WGSL structs & PBR direct-illumination math matching the 64-byte `ClusterLight`
 * layout (`posRange`, `colorType`, `dirInner`, `extra`), 16-byte `Reservoir`, and energy-conserving
 * GGX + Schlick Fresnel target PDF.
 */
export const RESTIR_STRUCTS_WGSL = /* wgsl */ `
const RESTIR_PI: f32 = 3.14159265359;
const RESTIR_INV_PI: f32 = 0.31830988618;
const RESTIR_INVALID_LIGHT: u32 = 0xffffffffu;
const RESTIR_PHAT_EPS: f32 = 1e-7;

struct ClusterLight {
  // xyz: anchor-relative world position (cells), w: range / radius (cells)
  posRange: vec4f,
  // rgb: linear HDR radiance, w: spotCosOuter (< -1.5 for omnidirectional point light)
  colorType: vec4f,
  // xyz: unit spot direction (world space), w: spotCosInner
  dirInner: vec4f,
  // x: sourceRadius (cells) for soft area-light penumbras, y: shadowId, z: kind, w: flags
  extra: vec4f,
}

struct ClusterCell {
  offset: u32,
  count: u32,
}

struct LightAlias {
  // Probability threshold in [0, 1] for selecting this bucket vs aliasIdx.
  prob: f32,
  // Alternate light index when uniform draw >= prob.
  aliasIdx: u32,
  // Exact discrete source sampling PDF P_i / sum(P) for light i.
  pdf: f32,
  pad: u32,
}

// Compact 16-byte (vec4<u32>) ReSTIR-DI reservoir stored per pixel in persistent storage buffers.
struct Reservoir {
  // Selected light index in [0, lightCount), or RESTIR_INVALID_LIGHT if empty.
  y: u32,
  // Bitcast f32: running RIS weight sum during resampling; finalized unbiased weight W in storage.
  wSum: u32,
  // Confidence / sample count M (clamped to M_max for temporal stability and moving lights).
  M: u32,
  // Packed flags: bit 0 = shadow visibility verified, bits [1..7] = frame tag, bits [8..31] = 24-bit light hash.
  ageFlags: u32,
}

fn restirLuma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn restirCleanWeight(w: f32) -> f32 {
  return select(0.0, w, w > 0.0 && w < 1e6);
}

fn restirCleanRgb(c: vec3f) -> vec3f {
  let nonNeg = select(vec3f(0.0), c, c >= vec3f(0.0));
  return select(vec3f(65000.0), nonNeg, nonNeg <= vec3f(65000.0));
}

fn restirPackAgeFlags(visible: bool, frameTag: u32, lightHash24: u32) -> u32 {
  return select(0u, 1u, visible) | ((frameTag & 0x7fu) << 1u) | ((lightHash24 & 0x00ffffffu) << 8u);
}

fn restirUnpackVisible(ageFlags: u32) -> bool {
  return (ageFlags & 1u) != 0u;
}

fn restirUnpackFrameTag(ageFlags: u32) -> u32 {
  return (ageFlags >> 1u) & 0x7fu;
}

fn restirUnpackLightHash24(ageFlags: u32) -> u32 {
  return (ageFlags >> 8u) & 0x00ffffffu;
}

// 24-bit quantized spatial/radiometric light state hash to detect moving or modified lights.
fn restirLightHash24(l: ClusterLight) -> u32 {
  let qPos = vec3i(round(l.posRange.xyz * 2.0));
  let qRng = i32(round(l.posRange.w));
  let qDir = vec3i(round(l.dirInner.xyz * 20.0));
  let qLum = i32(round(restirLuma(l.colorType.rgb) * 20.0));
  var h: u32 = (u32(qPos.x) * 73856093u) ^ (u32(qPos.y) * 19349663u) ^ (u32(qPos.z) * 83492791u);
  h ^= (u32(qRng) * 2654435761u) ^ (u32(qDir.x) * 2246822519u) ^ (u32(qDir.y) * 3266489917u) ^ (u32(qDir.z) * 668265263u);
  h ^= (u32(qLum) * 374761393u);
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return h & 0x00ffffffu;
}

// Energy-conserving GGX + Schlick Fresnel + smooth windowed inverse-square direct illumination.
// Matches lights-cluster.ts evalClusterLightGGX identically.
fn evalRestirLightGGX(
  light: ClusterLight,
  worldPos: vec3f,
  N: vec3f,
  V: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
) -> vec3f {
  let toL = light.posRange.xyz - worldPos;
  let d2 = dot(toL, toL);
  let radius = max(light.posRange.w, 1e-4);
  let r2 = radius * radius;
  if (d2 <= 1e-8 || d2 >= r2) { return vec3f(0.0); }

  let invD = inverseSqrt(d2);
  let L = toL * invD;
  let NdotL = max(dot(N, L), 0.0);
  if (NdotL <= 0.0) { return vec3f(0.0); }

  var spot = 1.0;
  let cosOuter = light.colorType.w;
  if (cosOuter > -1.5) {
    let cosAngle = dot(-L, light.dirInner.xyz);
    if (cosAngle <= cosOuter) { return vec3f(0.0); }
    let cosInner = max(light.dirInner.w, cosOuter + 1e-4);
    let t = clamp((cosAngle - cosOuter) / (cosInner - cosOuter), 0.0, 1.0);
    spot = t * t * (3.0 - 2.0 * t);
  }

  // Smooth windowed inverse-square falloff: pow(saturate(1 - (d/r)^4), 2) / (d^2 + 1)
  let norm2 = d2 / r2;
  let win = clamp(1.0 - norm2 * norm2, 0.0, 1.0);
  let att = (win * win) / (d2 + 1.0);

  let NdotV = max(dot(N, V), 1e-4);
  let hRaw = L + V;
  let hLen = length(hRaw);
  let H = select(N, hRaw / hLen, hLen > 1e-5);
  let NdotH = max(dot(N, H), 0.0);
  let VdotH = max(dot(V, H), 0.0);

  let r = clamp(roughness, 0.045, 1.0);
  let alpha = r * r;
  let a2 = alpha * alpha;

  // Trowbridge-Reitz GGX normal distribution
  let denomD = NdotH * NdotH * (a2 - 1.0) + 1.0;
  let D = a2 / max(RESTIR_PI * denomD * denomD, 1e-7);

  // Height-correlated Smith-GGX visibility (G / (4 * NdotV * NdotL))
  let visV = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
  let visL = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
  let Vis = 0.5 / max(visV + visL, 1e-5);

  // Schlick Fresnel with dielectric F0 = 0.04
  let m = clamp(metallic, 0.0, 1.0);
  let f0 = mix(vec3f(0.04), albedo, m);
  let oneMinusVH = 1.0 - VdotH;
  let f2 = oneMinusVH * oneMinusVH;
  let F = f0 + (vec3f(1.0) - f0) * (f2 * f2 * oneMinusVH);

  let kD = (vec3f(1.0) - F) * (1.0 - m);
  let diffuse = kD * albedo * RESTIR_INV_PI;
  let specular = (D * Vis) * F;

  let radiance = light.colorType.rgb * (att * spot);
  return (diffuse + specular) * radiance * NdotL;
}

// Scalar target PDF p_hat(x, y) = luminance(BRDF_GGX(x, y) * Li(x, y)).
fn restirTargetPdf(
  light: ClusterLight,
  worldPos: vec3f,
  N: vec3f,
  V: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
) -> f32 {
  return restirLuma(evalRestirLightGGX(light, worldPos, N, V, albedo, roughness, metallic));
}

struct RestirSceneEval {
  diffuse: vec3f,
  specLuma: f32,
}

// Scene-calibrated local-light evaluator matching lights.ts / march-shade.ts evalClusteredLocalLights:
//   - lights.ts scales colorType.rgb by dHalf^2 and packs dHalf in extra.x, kind in extra.z, beam focus in extra.w.
//   - Returns albedo-demodulated diffuse irradiance (.diffuse) and specular+wet streak luma (.specLuma) so full-res
//     march-shade.ts preserves razor-sharp procedural paint/road marks after bilateral upsampling.
fn evalRestirLightScene(
  light: ClusterLight,
  worldPos: vec3f,
  N: vec3f,
  V: vec3f,
  roughness: f32,
  wetSurface: f32,
  wetness: f32,
) -> RestirSceneEval {
  let toL = light.posRange.xyz - worldPos;
  let d2 = dot(toL, toL);
  let radius = max(light.posRange.w, 1e-4);
  let r2 = radius * radius;
  if (d2 <= 1e-6 || d2 >= r2) { return RestirSceneEval(vec3f(0.0), 0.0); }

  let invD = inverseSqrt(d2);
  let L = toL * invD;
  var spot = 1.0;
  let cosOuter = light.colorType.w;
  if (cosOuter > -1.5) {
    let cosAngle = dot(-L, light.dirInner.xyz);
    if (cosAngle <= cosOuter) { return RestirSceneEval(vec3f(0.0), 0.0); }
    let invSpan = 1.0 / max(light.dirInner.w - cosOuter, 0.001);
    let u = clamp((cosAngle - cosOuter) * invSpan, 0.0, 1.0);
    let cone = u * u * (3.0 - 2.0 * u);
    spot = mix(cone, cone * (0.38 + 0.62 * cone * cone), light.extra.w);
  }

  let norm2 = d2 / r2;
  let win = clamp(1.0 - norm2 * norm2, 0.0, 1.0);
  let dHalf = max(light.extra.x, 1.0);
  let att = (win * win) / (dHalf * dHalf + d2);
  let ndl = dot(N, L);
  if (ndl <= -0.04) { return RestirSceneEval(vec3f(0.0), 0.0); }

  let diff = pow(max(ndl, 0.0), 0.72);
  let rad = light.colorType.rgb * (att * spot);
  let diffuseIrr = rad * diff;

  var specRgb = vec3f(0.0);
  if (ndl > 0.0) {
    let rd = -V;
    let hRaw = L + V;
    let hLen = length(hRaw);
    let H = select(N, hRaw / hLen, hLen > 1e-5);
    let ndh = max(dot(N, H), 0.0);
    let specBoost = select(1.0, 1.15, light.extra.w > 0.5);
    let smoothness = max(1.0 - roughness, 0.0);
    let shininess = mix(8.0, 64.0, smoothness);
    let spec = pow(ndh, shininess) * smoothness * smoothness * 0.38;
    specRgb += rad * (spec * specBoost);

    let wet = wetness * wetSurface;
    if (wet > 0.02) {
      let back = reflect(rd, vec3f(0.0, 1.0, 0.0));
      let side = normalize(vec2f(-rd.z, rd.x) + vec2f(0.00001, 0.0));
      let off = back - L;
      let across = dot(off.xz, side);
      let streak = exp(-across * across * 420.0 - max(dot(off, off) - across * across, 0.0) * 6.5);
      let sheen = pow(ndh, 24.0) * 0.22 + streak * 0.52;
      specRgb += rad * (sheen * wet * specBoost * 0.65);
    }
  }
  return RestirSceneEval(diffuseIrr, restirLuma(specRgb));
}

fn restirTargetPdfMode(
  light: ClusterLight,
  worldPos: vec3f,
  N: vec3f,
  V: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
  wetSurface: f32,
  wetness: f32,
  isScene: bool,
) -> f32 {
  if (isScene) {
    let ev = evalRestirLightScene(light, worldPos, N, V, roughness, wetSurface, wetness);
    return restirLuma(ev.diffuse) * 0.55 + ev.specLuma;
  }
  return restirTargetPdf(light, worldPos, N, V, albedo, roughness, metallic);
}

fn restirSourceRadius(light: ClusterLight, isScene: bool) -> f32 {
  if (!isScene) { return max(light.extra.x, 0.0); }
  // Scene mode stores dHalf in extra.x and light kind in extra.z (0=car, 1=street, 2=extra).
  if (light.extra.z < 0.5) { return 0.6; }
  if (light.extra.z < 1.5) { return 2.0; }
  return 1.2;
}
`

const DEFAULT_OCCLUSION_WGSL = /* wgsl */ `
fn traceShadowRay(origin: vec3f, dir: vec3f, maxDist: f32) -> f32 {
  let _unused = origin.x + dir.x + maxDist;
  return select(1.0, 1.0, _unused >= -1e30);
}
`

const COMMON_COMPUTE_WGSL = /* wgsl */ `
${RESTIR_STRUCTS_WGSL}

struct RestirParams {
  // 0: current anchor-relative eye.xyz (cells), w: tanHalf
  eyeTanHalf: vec4f,
  // 1: current unit forward.xyz, w: aspect
  fwdAspect: vec4f,
  // 2: current unit right.xyz, w: perspective near (cells)
  rightNear: vec4f,
  // 3: current unit up.xyz, w: perspective far (cells)
  upFar: vec4f,
  // 4: previous anchor-relative eye.xyz (cells), w: prevTanHalf
  prevEyeTanHalf: vec4f,
  // 5: previous unit forward.xyz, w: prevAspect
  prevFwdAspect: vec4f,
  // 6: previous unit right.xyz, w: prevNear
  prevRightNear: vec4f,
  // 7: previous unit up.xyz, w: prevFar
  prevUpFar: vec4f,
  // 8: xy = renderSize (f32), zw = 1 / renderSize
  renderInfo: vec4f,
  // 9: xy = prevRenderSize (f32), zw = 1 / prevRenderSize
  prevRenderInfo: vec4f,
  // 10: xy = current jitter (render px), zw = previous jitter (render px)
  jitterInfo: vec4f,
  // 11: x = shadowBias (cells), y = spatialRadius (px), z = clusterZNear, w = clusterZFar
  tuning: vec4f,
  // 12: x = clusterZScale, yzw = pad
  clusterFloat: vec4f,
  // 13: x = capW, y = capH, z = renderW, w = renderH
  sizeU: vec4u,
  // 14: x = prevRenderW, y = prevRenderH, z = lightCount, w = frameIndex
  frameU: vec4u,
  // 15: x = initialCandidates, y = maxTemporalM, z = spatialNeighbors, w = flags
  configU: vec4u,
  // 16: x = clusterX, y = clusterY, z = clusterZ, w = clusterIndexPoolCap
  clusterU: vec4u,
}

fn pcgInit(px: vec2u, frameIdx: u32, stageTag: u32) -> u32 {
  var s = px.x * 1664525u + px.y * 1013904223u + frameIdx * 374761393u + stageTag * 668265263u;
  s = (s ^ (s >> 15u)) * 2246822519u;
  s = (s ^ (s >> 13u)) * 3266489917u;
  return s ^ (s >> 16u);
}

fn pcgNext(state: ptr<function, u32>) -> u32 {
  let prev = *state;
  *state = prev * 747796405u + 2891336453u;
  let word = ((prev >> ((prev >> 28u) + 4u)) ^ prev) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randF32(state: ptr<function, u32>) -> f32 {
  return f32(pcgNext(state) >> 8u) * (1.0 / 16777216.0);
}

fn ignBlueNoise(coord: vec2f, frameIdx: u32) -> f32 {
  let jittered = coord + vec2f(f32(frameIdx & 63u) * 5.588238, f32(frameIdx & 63u) * 3.178234);
  return fract(52.9829189 * fract(dot(jittered, vec2f(0.06711056, 0.00583715))));
}

fn linearizeDepth(d: f32, zNear: f32, zFar: f32) -> f32 {
  let denom = max(1.0 - d * ((zFar - zNear) / zFar), 1e-7);
  return zNear / denom;
}

fn reconstructWorldPos(
  uv: vec2f,
  linearZ: f32,
  eye: vec3f,
  fwd: vec3f,
  right: vec3f,
  up: vec3f,
  tanHalf: f32,
  aspect: f32,
) -> vec3f {
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  return eye
    + fwd * linearZ
    + right * (ndcX * linearZ * tanHalf * aspect)
    + up * (ndcY * linearZ * tanHalf);
}

// Traces 1 shadow visibility ray from worldPos + N * bias toward light. When light.extra.x
// (sourceRadius) > 0, jitters the target point over a 128-point golden-angle Vogel disk keyed by
// the 7-bit sampleId stored in Reservoir.ageFlags so spatial reuse validates the exact same
// area-light point (unbiased soft penumbras with zero p^2 darkening and zero wall bleed).
fn traceLightVisibility(
  worldPos: vec3f,
  N: vec3f,
  light: ClusterLight,
  shadowBias: f32,
  sampleId: u32,
  isScene: bool,
) -> f32 {
  let origin = worldPos + N * shadowBias;
  let toCenter = light.posRange.xyz - origin;
  let centerDist = length(toCenter);
  if (centerDist <= shadowBias * 0.5) {
    return 1.0;
  }
  var targetPos = light.posRange.xyz;
  let sourceRadius = restirSourceRadius(light, isScene);
  if (sourceRadius > 1e-4 && centerDist > sourceRadius * 1.05) {
    let dirC = toCenter / centerDist;
    let refUp = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dirC.y) > 0.9);
    let tang = normalize(cross(refUp, dirC));
    let bitang = cross(dirC, tang);
    let sid = f32(sampleId & 0x7fu);
    let rDisk = sourceRadius * sqrt((sid + 0.5) * (1.0 / 128.0));
    let phi = sid * 2.399963229728653;
    let diskOff = (tang * cos(phi) + bitang * sin(phi)) * rDisk;
    let candTarget = light.posRange.xyz + diskOff;
    if (dot(candTarget - origin, N) > 0.0) {
      targetPos = candTarget;
    } else if (dot(light.posRange.xyz - diskOff - origin, N) > 0.0) {
      targetPos = light.posRange.xyz - diskOff;
    }
  }
  let toTarget = targetPos - origin;
  let dist = length(toTarget);
  let startNudge = select(0.0, 1.4, isScene);
  let endPullback = select(max(shadowBias * 0.5, 0.02), max(shadowBias * 0.5, 6.5), isScene);
  let maxDist = dist - endPullback - startNudge;
  if (maxDist <= 1e-4) {
    return 1.0;
  }
  let dir = toTarget / dist;
  return clamp(traceShadowRay(origin + dir * startNudge, dir, maxDist), 0.0, 1.0);
}
`

function buildRisInitialWgsl(occlusionWgsl: string): string {
  return /* wgsl */ `
${COMMON_COMPUTE_WGSL}
${occlusionWgsl}

@group(0) @binding(0) var<uniform> params: RestirParams;
@group(0) @binding(1) var<storage, read> lights: array<ClusterLight>;
@group(0) @binding(2) var<storage, read> clusterGrid: array<ClusterCell>;
@group(0) @binding(3) var<storage, read> clusterIndices: array<u32>;
@group(0) @binding(4) var<storage, read> lightAlias: array<LightAlias>;
@group(0) @binding(5) var depthTex: texture_depth_2d;
@group(0) @binding(6) var normalTex: texture_2d<f32>;
@group(0) @binding(7) var albedoTex: texture_2d<f32>;
@group(0) @binding(8) var materialTex: texture_2d<f32>;
@group(0) @binding(9) var<storage, read_write> reservoirOut: array<Reservoir>;
@group(0) @binding(10) var geomOut: texture_storage_2d<rgba32float, write>;

fn depthToClusterZ(linearZ: f32) -> u32 {
  let zNear = params.tuning.z;
  let zFar = params.tuning.w;
  if (linearZ <= zNear) { return 0u; }
  if (linearZ >= zFar) { return params.clusterU.z - 1u; }
  let slice = floor(log(linearZ / zNear) * params.clusterFloat.x);
  return u32(clamp(slice, 0.0, f32(params.clusterU.z - 1u)));
}

@compute @workgroup_size(8, 8, 1)
fn cs_ris_initial(@builtin(global_invocation_id) gid: vec3u) {
  let renderW = params.sizeU.z;
  let renderH = params.sizeU.w;
  if (gid.x >= renderW || gid.y >= renderH) { return; }

  let px = vec2i(i32(gid.x), i32(gid.y));
  let idx = gid.y * params.sizeU.x + gid.x;

  let rawDepth = textureLoad(depthTex, px, 0);
  if (rawDepth >= 0.99999) {
    textureStore(geomOut, px, vec4f(0.0, 0.0, 0.0, 0.0));
    reservoirOut[idx] = Reservoir(RESTIR_INVALID_LIGHT, bitcast<u32>(0.0), 0u, 0u);
    return;
  }

  let zNear = params.rightNear.w;
  let zFar = params.upFar.w;
  let linearZ = linearizeDepth(rawDepth, zNear, zFar);
  let uv = (vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5) + params.jitterInfo.xy) * params.renderInfo.zw;

  let worldPos = reconstructWorldPos(
    uv,
    linearZ,
    params.eyeTanHalf.xyz,
    params.fwdAspect.xyz,
    params.rightNear.xyz,
    params.upFar.xyz,
    params.eyeTanHalf.w,
    params.fwdAspect.w,
  );

  let rawN = textureLoad(normalTex, px, 0).xyz;
  let nLen = length(rawN);
  if (nLen <= 1e-4) {
    textureStore(geomOut, px, vec4f(0.0, 0.0, 0.0, 0.0));
    reservoirOut[idx] = Reservoir(RESTIR_INVALID_LIGHT, bitcast<u32>(0.0), 0u, 0u);
    return;
  }
  var N = rawN / nLen;
  if ((params.configU.w & ${FLAG_VIEW_NORMALS}u) != 0u) {
    // View space (+X right, +Y up, +Z forward) -> world space.
    N = normalize(
      params.rightNear.xyz * N.x
      + params.upFar.xyz * N.y
      + params.fwdAspect.xyz * N.z
    );
  }

  // Persist reconstructed (worldNormal, linearDepth) for Pass 2 & Pass 3 geometric similarity.
  textureStore(geomOut, px, vec4f(N, linearZ));

  let lightCount = params.frameU.z;
  if (lightCount == 0u) {
    reservoirOut[idx] = Reservoir(RESTIR_INVALID_LIGHT, bitcast<u32>(0.0), 1u, 0u);
    return;
  }

  let isScene = (params.configU.w & ${FLAG_SCENE_EVAL}u) != 0u;
  let wetness = params.clusterFloat.y;
  let V = normalize(params.eyeTanHalf.xyz - worldPos);
  let albedo = select(max(textureLoad(albedoTex, px, 0).rgb, vec3f(0.0)), vec3f(1.0), isScene);
  let mat = textureLoad(materialTex, px, 0);
  let roughness = clamp(mat.r, 0.045, 1.0);
  let metallic = clamp(mat.g, 0.0, 1.0);
  let wetSurface = clamp(mat.b, 0.0, 1.0);

  let frameIdx = params.frameU.w;
  var rng = pcgInit(gid.xy, frameIdx, 1u);

  let mCandidates = max(params.configU.x, 1u);
  let useClusters = (params.configU.w & ${FLAG_USE_CLUSTERS}u) != 0u;
  let useAlias = (params.configU.w & ${FLAG_USE_ALIAS}u) != 0u;

  var selectedY: u32 = RESTIR_INVALID_LIGHT;
  var selectedPHat: f32 = 0.0;
  var wSum: f32 = 0.0;
  var normDivisor: f32 = f32(mCandidates);

  if (useClusters) {
    let cx = u32(clamp(floor(uv.x * f32(params.clusterU.x)), 0.0, f32(params.clusterU.x - 1u)));
    let cy = u32(clamp(floor(uv.y * f32(params.clusterU.y)), 0.0, f32(params.clusterU.y - 1u)));
    let cz = depthToClusterZ(linearZ);
    let cIdx = (cz * params.clusterU.y + cy) * params.clusterU.x + cx;
    let cell = clusterGrid[cIdx];
    let safeCount = min(cell.count, params.clusterU.w - min(cell.offset, params.clusterU.w));
    if (safeCount > 0u) {
      if (safeCount <= mCandidates) {
        // Exhaustive cluster RIS: evaluate every overlapping light once with exact weight.
        normDivisor = 1.0;
        for (var i = 0u; i < safeCount; i++) {
          let candIdx = clusterIndices[cell.offset + i];
          if (candIdx >= lightCount) { continue; }
          let pHat = restirTargetPdfMode(lights[candIdx], worldPos, N, V, albedo, roughness, metallic, wetSurface, wetness, isScene);
          if (pHat > RESTIR_PHAT_EPS) {
            wSum += pHat;
            if (randF32(&rng) * wSum < pHat) {
              selectedY = candIdx;
              selectedPHat = pHat;
            }
          }
        }
      } else {
        let invClusterPdf = f32(safeCount);
        for (var k = 0u; k < mCandidates; k++) {
          let slot = min(u32(randF32(&rng) * f32(safeCount)), safeCount - 1u);
          let candIdx = clusterIndices[cell.offset + slot];
          if (candIdx >= lightCount) { continue; }
          let pHat = restirTargetPdfMode(lights[candIdx], worldPos, N, V, albedo, roughness, metallic, wetSurface, wetness, isScene);
          let w = pHat * invClusterPdf;
          if (w > 0.0) {
            wSum += w;
            if (randF32(&rng) * wSum < w) {
              selectedY = candIdx;
              selectedPHat = pHat;
            }
          }
        }
      }
    }
  } else {
    let fCount = f32(lightCount);
    for (var k = 0u; k < mCandidates; k++) {
      var candIdx: u32 = 0u;
      var srcPdf: f32 = 1.0 / fCount;
      if (useAlias) {
        let uScaled = randF32(&rng) * fCount;
        let bucket = min(u32(uScaled), lightCount - 1u);
        let frac = uScaled - f32(bucket);
        let entry = lightAlias[bucket];
        candIdx = select(entry.aliasIdx, bucket, frac < entry.prob);
        candIdx = min(candIdx, lightCount - 1u);
        srcPdf = lightAlias[candIdx].pdf;
      } else {
        candIdx = min(u32(randF32(&rng) * fCount), lightCount - 1u);
      }
      if (srcPdf <= 1e-12) { continue; }
      let pHat = restirTargetPdfMode(lights[candIdx], worldPos, N, V, albedo, roughness, metallic, wetSurface, wetness, isScene);
      let w = pHat / srcPdf;
      if (w > 0.0) {
        wSum += w;
        if (randF32(&rng) * wSum < w) {
          selectedY = candIdx;
          selectedPHat = pHat;
        }
      }
    }
  }

  var W: f32 = 0.0;
  var visOk: bool = false;
  var lightHash: u32 = 0u;
  // Blue-noise + frame stratified 7-bit Vogel disk sample ID packed into ageFlags bits [1..7].
  let sampleId = (frameIdx + u32(ignBlueNoise(vec2f(f32(gid.x), f32(gid.y)), frameIdx) * 128.0)) & 0x7fu;
  if (selectedY != RESTIR_INVALID_LIGHT && selectedPHat > RESTIR_PHAT_EPS) {
    let winLight = lights[selectedY];
    lightHash = restirLightHash24(winLight);
    W = restirCleanWeight(wSum / (normDivisor * selectedPHat));
    if (W > 0.0) {
      // Trace 1 shadow visibility ray toward the winning light (supporting soft penumbra disk jitter).
      let vis = traceLightVisibility(worldPos, N, winLight, params.tuning.x, sampleId, isScene);
      if (vis <= 0.001) {
        W = 0.0;
        visOk = false;
      } else {
        W = restirCleanWeight(W * vis);
        visOk = true;
      }
    }
  }

  // Keep M = 1u even when occluded (W = 0) so temporal/spatial MIS remains strictly unbiased!
  let ageFlags = restirPackAgeFlags(visOk, sampleId, lightHash);
  reservoirOut[idx] = Reservoir(selectedY, bitcast<u32>(W), 1u, ageFlags);
}
`
}

function buildTemporalReuseWgsl(occlusionWgsl: string): string {
  return /* wgsl */ `
${COMMON_COMPUTE_WGSL}
${occlusionWgsl}

@group(0) @binding(0) var<uniform> params: RestirParams;
@group(0) @binding(1) var<storage, read> lights: array<ClusterLight>;
@group(0) @binding(2) var<storage, read> reservoirInitial: array<Reservoir>;
@group(0) @binding(3) var<storage, read> reservoirPrev: array<Reservoir>;
@group(0) @binding(4) var<storage, read_write> reservoirOut: array<Reservoir>;
@group(0) @binding(5) var geomCurrTex: texture_2d<f32>;
@group(0) @binding(6) var geomPrevTex: texture_2d<f32>;
@group(0) @binding(7) var velTex: texture_2d<f32>;
@group(0) @binding(8) var albedoTex: texture_2d<f32>;
@group(0) @binding(9) var materialTex: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn cs_temporal_reuse(@builtin(global_invocation_id) gid: vec3u) {
  let renderW = params.sizeU.z;
  let renderH = params.sizeU.w;
  if (gid.x >= renderW || gid.y >= renderH) { return; }

  let px = vec2i(i32(gid.x), i32(gid.y));
  let idx = gid.y * params.sizeU.x + gid.x;
  let rCur = reservoirInitial[idx];

  let flags = params.configU.w;
  let hasHistory = (flags & ${FLAG_HAS_HISTORY}u) != 0u;
  let enableTemporal = (flags & ${FLAG_ENABLE_TEMPORAL}u) != 0u;
  let lightCount = params.frameU.z;

  if (!hasHistory || !enableTemporal || lightCount == 0u || rCur.M == 0u) {
    reservoirOut[idx] = rCur;
    return;
  }

  let geomCur = textureLoad(geomCurrTex, px, 0);
  let curZ = geomCur.w;
  if (curZ <= 0.0) {
    reservoirOut[idx] = rCur;
    return;
  }
  let curN = geomCur.xyz;

  // Motion vector sign convention (matching taa.ts): prevUV = curUV + vel.
  let curUV = (vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5)) * params.renderInfo.zw;
  let vel = textureLoad(velTex, px, 0).rg;
  let prevUV = curUV + vel;
  if (prevUV.x < 0.0 || prevUV.x >= 1.0 || prevUV.y < 0.0 || prevUV.y >= 1.0) {
    reservoirOut[idx] = rCur;
    return;
  }

  let prevRenderW = params.frameU.x;
  let prevRenderH = params.frameU.y;
  let prevPx = clamp(
    vec2i(floor(prevUV * params.prevRenderInfo.xy)),
    vec2i(0, 0),
    vec2i(i32(prevRenderW) - 1, i32(prevRenderH) - 1),
  );
  let geomPrev = textureLoad(geomPrevTex, prevPx, 0);
  let prevZ = geomPrev.w;
  let prevN = geomPrev.xyz;

  let curJitterUV = (vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5) + params.jitterInfo.xy) * params.renderInfo.zw;
  let curWorldPos = reconstructWorldPos(
    curJitterUV,
    curZ,
    params.eyeTanHalf.xyz,
    params.fwdAspect.xyz,
    params.rightNear.xyz,
    params.upFar.xyz,
    params.eyeTanHalf.w,
    params.fwdAspect.w,
  );

  // Compare previous buffer depth against the current surface point projected into the previous camera,
  // so camera forward/backward motion keeps temporal history while depth edges are strictly rejected.
  let expectedPrevZ = dot(curWorldPos - params.prevEyeTanHalf.xyz, params.prevFwdAspect.xyz);
  let depthRelErr = abs(expectedPrevZ - prevZ) / max(expectedPrevZ, 1e-4);
  if (prevZ <= 0.0 || expectedPrevZ <= 0.0 || depthRelErr >= 0.05 || dot(curN, prevN) <= 0.90) {
    reservoirOut[idx] = rCur;
    return;
  }

  let prevIdx = u32(prevPx.y) * params.sizeU.x + u32(prevPx.x);
  let rPrev = reservoirPrev[prevIdx];
  if (rPrev.M == 0u) {
    reservoirOut[idx] = rCur;
    return;
  }

  let curV = normalize(params.eyeTanHalf.xyz - curWorldPos);
  let prevJitterUV = (vec2f(f32(prevPx.x) + 0.5, f32(prevPx.y) + 0.5) + params.jitterInfo.zw) * params.prevRenderInfo.zw;
  let prevWorldPos = reconstructWorldPos(
    prevJitterUV,
    prevZ,
    params.prevEyeTanHalf.xyz,
    params.prevFwdAspect.xyz,
    params.prevRightNear.xyz,
    params.prevUpFar.xyz,
    params.prevEyeTanHalf.w,
    params.prevFwdAspect.w,
  );
  let prevV = normalize(params.prevEyeTanHalf.xyz - prevWorldPos);

  let isScene = (flags & ${FLAG_SCENE_EVAL}u) != 0u;
  let wetness = params.clusterFloat.y;
  let albedo = select(max(textureLoad(albedoTex, px, 0).rgb, vec3f(0.0)), vec3f(1.0), isScene);
  let mat = textureLoad(materialTex, px, 0);
  let roughness = clamp(mat.r, 0.045, 1.0);
  let metallic = clamp(mat.g, 0.0, 1.0);
  let wetSurface = clamp(mat.b, 0.0, 1.0);

  let maxM = max(params.configU.y, 1u);
  let frameIdx = params.frameU.w;
  var rng = pcgInit(gid.xy, frameIdx, 2u);

  var prevY = rPrev.y;
  var prevW = restirCleanWeight(bitcast<f32>(rPrev.wSum));
  var prevM = min(rPrev.M, maxM);
  var prevVis = restirUnpackVisible(rPrev.ageFlags);
  var prevSampleId = restirUnpackFrameTag(rPrev.ageFlags);
  var prevLightHash = restirUnpackLightHash24(rPrev.ageFlags);

  // Detect moving or altered lights via the 24-bit light hash packed into ageFlags.
  if (prevY != RESTIR_INVALID_LIGHT) {
    if (prevY >= lightCount) {
      reservoirOut[idx] = rCur;
      return;
    }
    let curHash = restirLightHash24(lights[prevY]);
    if (curHash != prevLightHash) {
      // Light moved/changed: re-verify shadow visibility immediately (prevents light bleed) and
      // tighten temporal confidence equally for lit & occluded draws so shadows track with zero ghosts.
      prevLightHash = curHash;
      prevM = min(prevM, 2u);
      if (prevW > 0.0) {
        let vis = traceLightVisibility(curWorldPos, curN, lights[prevY], params.tuning.x, prevSampleId, isScene);
        if (vis <= 0.001) {
          prevW = 0.0;
          prevVis = false;
        } else {
          prevW = restirCleanWeight(prevW * vis);
          prevVis = true;
        }
      }
    }
  }

  let curY = rCur.y;
  let curW = restirCleanWeight(bitcast<f32>(rCur.wSum));
  let curM = max(rCur.M, 1u);
  let cCur = f32(curM);
  let cPrev = f32(prevM);

  // Exact unbiased 2-domain Talbot / Pairwise MIS combination:
  //   m_cur(y)  = (c_cur * p_cur(y))  / (c_cur * p_cur(y)  + c_prev * p_prev(y))
  //   m_prev(y) = (c_prev * p_prev(y)) / (c_cur * p_cur(y) + c_prev * p_prev(y))
  var wSum: f32 = 0.0;
  var outY: u32 = RESTIR_INVALID_LIGHT;
  var outPHat: f32 = 0.0;
  var outVis: bool = false;
  var outSampleId: u32 = restirUnpackFrameTag(rCur.ageFlags);
  var outHash: u32 = 0u;

  if (curY != RESTIR_INVALID_LIGHT && curY < lightCount && curW > 0.0) {
    let lCur = lights[curY];
    let pCurAtCur = restirTargetPdfMode(lCur, curWorldPos, curN, curV, albedo, roughness, metallic, wetSurface, wetness, isScene);
    let pCurAtPrev = restirTargetPdfMode(lCur, prevWorldPos, prevN, prevV, albedo, roughness, metallic, wetSurface, wetness, isScene);
    let denom = cCur * pCurAtCur + cPrev * pCurAtPrev;
    if (pCurAtCur > RESTIR_PHAT_EPS && denom > 1e-12) {
      let misCur = (cCur * pCurAtCur) / denom;
      let wCur = misCur * pCurAtCur * curW;
      if (wCur > 0.0) {
        wSum += wCur;
        outY = curY;
        outPHat = pCurAtCur;
        outVis = restirUnpackVisible(rCur.ageFlags);
        outSampleId = restirUnpackFrameTag(rCur.ageFlags);
        outHash = restirUnpackLightHash24(rCur.ageFlags);
      }
    }
  } else if (curY != RESTIR_INVALID_LIGHT && curY < lightCount) {
    // Preserve light index & hash even when occluded so future frames can detect light motion.
    outY = curY;
    outSampleId = restirUnpackFrameTag(rCur.ageFlags);
    outHash = restirUnpackLightHash24(rCur.ageFlags);
  }

  if (prevY != RESTIR_INVALID_LIGHT && prevY < lightCount && prevW > 0.0) {
    let lPrev = lights[prevY];
    let pPrevAtCur = restirTargetPdfMode(lPrev, curWorldPos, curN, curV, albedo, roughness, metallic, wetSurface, wetness, isScene);
    let pPrevAtPrev = restirTargetPdfMode(lPrev, prevWorldPos, prevN, prevV, albedo, roughness, metallic, wetSurface, wetness, isScene);
    let denom = cCur * pPrevAtCur + cPrev * pPrevAtPrev;
    if (pPrevAtCur > RESTIR_PHAT_EPS && denom > 1e-12) {
      let misPrev = (cPrev * pPrevAtPrev) / denom;
      let wPrev = misPrev * pPrevAtCur * prevW;
      if (wPrev > 0.0) {
        wSum += wPrev;
        if (randF32(&rng) * wSum < wPrev) {
          outY = prevY;
          outPHat = pPrevAtCur;
          outVis = prevVis;
          outSampleId = prevSampleId;
          outHash = prevLightHash;
        }
      }
    }
  } else if (outY == RESTIR_INVALID_LIGHT && prevY != RESTIR_INVALID_LIGHT && prevY < lightCount) {
    outY = prevY;
    outSampleId = prevSampleId;
    outHash = prevLightHash;
  }

  var outW: f32 = 0.0;
  if (outY != RESTIR_INVALID_LIGHT && outPHat > RESTIR_PHAT_EPS && wSum > 0.0) {
    outW = restirCleanWeight(wSum / outPHat);
  }

  let outM = min(curM + prevM, maxM);
  let outFlags = restirPackAgeFlags(outVis && outW > 0.0, outSampleId, outHash);
  reservoirOut[idx] = Reservoir(outY, bitcast<u32>(outW), outM, outFlags);
}
`
}

function buildSpatialShadeWgsl(occlusionWgsl: string): string {
  return /* wgsl */ `
${COMMON_COMPUTE_WGSL}
${occlusionWgsl}

@group(0) @binding(0) var<uniform> params: RestirParams;
@group(0) @binding(1) var<storage, read> lights: array<ClusterLight>;
@group(0) @binding(2) var<storage, read> reservoirIn: array<Reservoir>;
@group(0) @binding(3) var<storage, read_write> reservoirOut: array<Reservoir>;
@group(0) @binding(4) var geomCurrTex: texture_2d<f32>;
@group(0) @binding(5) var albedoTex: texture_2d<f32>;
@group(0) @binding(6) var materialTex: texture_2d<f32>;
@group(0) @binding(7) var outputTex: texture_storage_2d<rgba16float, write>;

const MAX_SPATIAL_K: u32 = 8u;

@compute @workgroup_size(8, 8, 1)
fn cs_spatial_reuse_and_shade(@builtin(global_invocation_id) gid: vec3u) {
  let renderW = params.sizeU.z;
  let renderH = params.sizeU.w;
  if (gid.x >= renderW || gid.y >= renderH) { return; }

  let px = vec2i(i32(gid.x), i32(gid.y));
  let idx = gid.y * params.sizeU.x + gid.x;
  let rCenter = reservoirIn[idx];

  let geomC = textureLoad(geomCurrTex, px, 0);
  let curZ = geomC.w;
  let lightCount = params.frameU.z;
  let flags = params.configU.w;
  let isScene = (flags & ${FLAG_SCENE_EVAL}u) != 0u;
  if (curZ <= 0.0 || lightCount == 0u) {
    reservoirOut[idx] = rCenter;
    textureStore(outputTex, px, vec4f(0.0, 0.0, 0.0, select(1.0, 0.0, isScene)));
    return;
  }

  let curN = geomC.xyz;
  let curUV = (vec2f(f32(gid.x) + 0.5, f32(gid.y) + 0.5) + params.jitterInfo.xy) * params.renderInfo.zw;
  let curWorldPos = reconstructWorldPos(
    curUV,
    curZ,
    params.eyeTanHalf.xyz,
    params.fwdAspect.xyz,
    params.rightNear.xyz,
    params.upFar.xyz,
    params.eyeTanHalf.w,
    params.fwdAspect.w,
  );
  let curV = normalize(params.eyeTanHalf.xyz - curWorldPos);
  let wetness = params.clusterFloat.y;
  let curAlbedo = select(max(textureLoad(albedoTex, px, 0).rgb, vec3f(0.0)), vec3f(1.0), isScene);
  let curMat = textureLoad(materialTex, px, 0);
  let curRough = clamp(curMat.r, 0.045, 1.0);
  let curMetal = clamp(curMat.g, 0.0, 1.0);
  let curWet = clamp(curMat.b, 0.0, 1.0);

  let enableSpatial = (flags & ${FLAG_ENABLE_SPATIAL}u) != 0u;
  let spatialK = select(0u, min(params.configU.z, MAX_SPATIAL_K), enableSpatial);
  let spatialRadius = max(params.tuning.y, 1.0);
  let frameIdx = params.frameU.w;
  var rng = pcgInit(gid.xy, frameIdx, 3u);

  let curY = rCenter.y;
  let curW = restirCleanWeight(bitcast<f32>(rCenter.wSum));
  let curM = max(rCenter.M, 1u);
  let c0 = f32(curM);
  let curVis = restirUnpackVisible(rCenter.ageFlags);
  let curSampleId = restirUnpackFrameTag(rCenter.ageFlags);
  let curHash = restirUnpackLightHash24(rCenter.ageFlags);

  var outY: u32 = RESTIR_INVALID_LIGHT;
  var outW: f32 = 0.0;
  var outM: u32 = curM;
  var outVis: bool = curVis;
  var outSampleId: u32 = curSampleId;
  var outHash: u32 = curHash;
  var fromNeighbor: bool = false;

  if (spatialK == 0u) {
    outY = curY;
    outW = curW;
  } else {
    // Single-pass streaming Pairwise MIS (zero per-thread neighbor array -> zero register spill):
    //   For each slot s in 0..K-1 (K = spatialK):
    //     valid neighbor s:   m_s(y) = (c_s * p_s(y)) / (c_0 * p_0(y) + K * c_s * p_s(y))
    //                         m_0 slot contribution = (1 / K) * (c_0 * p_0(y)) / (c_0 * p_0(y) + K * c_s * p_s(y))
    //     rejected neighbor:  c_s = 0 -> m_s = 0, m_0 slot contribution = 1 / K
    //   Exact partition of unity: m_0(y) + sum_s m_s(y) == 1 identically, with p_0 / p_s bounded.
    let fK = f32(spatialK);
    let invK = 1.0 / fK;
    let baseAngle = ignBlueNoise(vec2f(f32(gid.x), f32(gid.y)), frameIdx) * 6.28318530718;
    let maxPlaneDist = max(1.5, curZ * 0.025);
    let maxRelDepth = 0.05 / max(abs(dot(curN, curV)), 0.2);

    let hasCur = curY != RESTIR_INVALID_LIGHT && curY < lightCount && curW > 0.0;
    var l0: ClusterLight;
    var p0At0: f32 = 0.0;
    if (hasCur) {
      l0 = lights[curY];
      p0At0 = restirTargetPdfMode(l0, curWorldPos, curN, curV, curAlbedo, curRough, curMetal, curWet, wetness, isScene);
    }
    let curEvalOk = hasCur && p0At0 > RESTIR_PHAT_EPS;

    var wSum: f32 = 0.0;
    var winPHat: f32 = 0.0;
    var mis0Accum: f32 = 0.0;
    var totalM: u32 = curM;

    for (var s = 0u; s < spatialK; s++) {
      let theta = baseAngle + (f32(s) + randF32(&rng)) * (6.28318530718 * invK);
      let rFrac = sqrt((f32(s) + randF32(&rng)) * invK);
      let distPx = max(1.0, rFrac * spatialRadius);
      let off = vec2i(i32(round(cos(theta) * distPx)), i32(round(sin(theta) * distPx)));

      var slotValid = !(off.x == 0 && off.y == 0);
      let nPx = px + off;
      if (slotValid) {
        slotValid = nPx.x >= 0 && nPx.x < i32(renderW) && nPx.y >= 0 && nPx.y < i32(renderH);
      }

      var nbZ: f32 = 0.0;
      var nbN = vec3f(0.0);
      if (slotValid) {
        let geomN = textureLoad(geomCurrTex, nPx, 0);
        nbZ = geomN.w;
        nbN = geomN.xyz;
        slotValid = nbZ > 0.0
          && dot(curN, nbN) > 0.90
          && (abs(nbZ - curZ) / max(curZ, 1e-4) < maxRelDepth);
      }

      var nbWorldPos = vec3f(0.0);
      var nbMat = vec4f(0.0);
      var nbRough: f32 = 0.5;
      if (slotValid) {
        let nbUV = (vec2f(f32(nPx.x) + 0.5, f32(nPx.y) + 0.5) + params.jitterInfo.xy) * params.renderInfo.zw;
        nbWorldPos = reconstructWorldPos(
          nbUV,
          nbZ,
          params.eyeTanHalf.xyz,
          params.fwdAspect.xyz,
          params.rightNear.xyz,
          params.upFar.xyz,
          params.eyeTanHalf.w,
          params.fwdAspect.w,
        );
        if (abs(dot(nbWorldPos - curWorldPos, curN)) > maxPlaneDist) {
          slotValid = false;
        } else {
          nbMat = textureLoad(materialTex, nPx, 0);
          nbRough = clamp(nbMat.r, 0.045, 1.0);
          if (abs(nbRough - curRough) > 0.35) {
            slotValid = false;
          }
        }
      }

      var rNb: Reservoir;
      if (slotValid) {
        let nbIdx = u32(nPx.y) * params.sizeU.x + u32(nPx.x);
        rNb = reservoirIn[nbIdx];
        if (rNb.M == 0u) {
          slotValid = false;
        }
      }

      if (!slotValid) {
        mis0Accum += 1.0;
        continue;
      }

      totalM += rNb.M;
      let ci = f32(rNb.M);
      let nbV = normalize(params.eyeTanHalf.xyz - nbWorldPos);
      let nbAlbedo = select(max(textureLoad(albedoTex, nPx, 0).rgb, vec3f(0.0)), vec3f(1.0), isScene);
      let nbMetal = clamp(nbMat.g, 0.0, 1.0);
      let nbWet = clamp(nbMat.b, 0.0, 1.0);

      // Canonical center MIS contribution paired against this neighbor.
      var p0AtI: f32 = 0.0;
      if (curEvalOk) {
        p0AtI = restirTargetPdfMode(l0, nbWorldPos, nbN, nbV, nbAlbedo, nbRough, nbMetal, nbWet, wetness, isScene);
        let denom0 = c0 * p0At0 + fK * ci * p0AtI;
        mis0Accum += select(1.0, (c0 * p0At0) / denom0, denom0 > 1e-12);
      } else {
        mis0Accum += 1.0;
      }

      // Spatial neighbor contribution.
      let nbY = rNb.y;
      let nbW = restirCleanWeight(bitcast<f32>(rNb.wSum));
      if (nbY == RESTIR_INVALID_LIGHT || nbY >= lightCount || nbW <= 0.0) { continue; }

      var pAt0: f32 = 0.0;
      var pAtI: f32 = 0.0;
      if (curEvalOk && nbY == curY) {
        pAt0 = p0At0;
        pAtI = p0AtI;
      } else {
        let lNb = lights[nbY];
        pAt0 = restirTargetPdfMode(lNb, curWorldPos, curN, curV, curAlbedo, curRough, curMetal, curWet, wetness, isScene);
        if (pAt0 > RESTIR_PHAT_EPS) {
          pAtI = restirTargetPdfMode(lNb, nbWorldPos, nbN, nbV, nbAlbedo, nbRough, nbMetal, nbWet, wetness, isScene);
        }
      }
      if (pAt0 <= RESTIR_PHAT_EPS || pAtI <= RESTIR_PHAT_EPS) { continue; }

      let denomI = c0 * pAt0 + fK * ci * pAtI;
      if (denomI <= 1e-12) { continue; }

      let misI = (ci * pAtI) / denomI;
      let wI = misI * pAt0 * nbW;
      if (wI > 0.0) {
        wSum += wI;
        if (randF32(&rng) * wSum < wI) {
          outY = nbY;
          winPHat = pAt0;
          outVis = restirUnpackVisible(rNb.ageFlags);
          outSampleId = restirUnpackFrameTag(rNb.ageFlags);
          outHash = restirUnpackLightHash24(rNb.ageFlags);
          fromNeighbor = true;
        }
      }
    }

    // Stream canonical center sample once its exact Pairwise MIS weight is accumulated.
    if (curEvalOk) {
      let mis0 = mis0Accum * invK;
      let w0 = mis0 * p0At0 * curW;
      if (w0 > 0.0) {
        wSum += w0;
        if (randF32(&rng) * wSum < w0) {
          outY = curY;
          winPHat = p0At0;
          outVis = curVis;
          outSampleId = curSampleId;
          outHash = curHash;
          fromNeighbor = false;
        }
      }
    }

    outM = min(totalM, max(params.configU.y, 1u) * (spatialK + 1u));
    if (outY != RESTIR_INVALID_LIGHT && winPHat > RESTIR_PHAT_EPS && wSum > 0.0) {
      outW = restirCleanWeight(wSum / winPHat);
    }
  }

  // Final visibility validation ray whenever adopting a spatial neighbor's light (eliminates
  // shadow smearing and light bleed across corners and walls while preserving soft penumbras).
  if (outY != RESTIR_INVALID_LIGHT && outY < lightCount && outW > 0.0) {
    let winLight = lights[outY];
    let hasArea = restirSourceRadius(winLight, isScene) > 1e-4;
    let sameVerifiedPoint = !fromNeighbor
      || (curVis && outY == curY && (!hasArea || outSampleId == curSampleId));
    if (!sameVerifiedPoint || !outVis) {
      let vis = traceLightVisibility(curWorldPos, curN, winLight, params.tuning.x, outSampleId, isScene);
      if (vis <= 0.001) {
        outW = 0.0;
        outVis = false;
      } else {
        outW = restirCleanWeight(outW * vis);
        outVis = true;
      }
    }
  }

  let outFlags = restirPackAgeFlags(outVis && outW > 0.0, outSampleId, outHash);
  reservoirOut[idx] = Reservoir(outY, bitcast<u32>(outW), outM, outFlags);

  if (isScene) {
    var diffIrr = vec3f(0.0);
    var specLum = 0.0;
    if (outY != RESTIR_INVALID_LIGHT && outY < lightCount && outW > 0.0) {
      let effW = min(outW, 14.0);
      let ev = evalRestirLightScene(lights[outY], curWorldPos, curN, curV, curRough, curWet, wetness);
      diffIrr = restirCleanRgb(ev.diffuse * effW);
      specLum = min(max(ev.specLuma * effW, 0.0), 65000.0);
    }
    textureStore(outputTex, px, vec4f(diffIrr, specLum));
    return;
  }

  var directRgb = vec3f(0.0);
  if (outY != RESTIR_INVALID_LIGHT && outY < lightCount && outW > 0.0) {
    let shaded = evalRestirLightGGX(lights[outY], curWorldPos, curN, curV, curAlbedo, curRough, curMetal);
    directRgb = restirCleanRgb(shaded * outW);
  }
  textureStore(outputTex, px, vec4f(directRgb, 1.0));
}
`
}

export interface RestirDIOptions {
  /** Persistent maximum render resolution `[width, height]` (default `[1280, 720]`). */
  readonly maxSize?: readonly [number, number]
  /** Initial RIS candidate draws per pixel in Pass 1 (default `16`, clamped `[1, 64]`). */
  readonly initialCandidates?: number
  /** Temporal confidence cap `M_max` (default `20`, clamped `[1, 64]`). */
  readonly maxTemporalM?: number
  /** Number of spatial disk neighbors in Pass 3 (default `4`, clamped `[0, 8]`). */
  readonly spatialNeighbors?: number
  /** Spatial reuse disk radius in pixels (default `18`, clamped `[1, 64]`). */
  readonly spatialRadius?: number
  /** Shadow ray origin normal bias in cells (default `0.15` = 1.5 cm). */
  readonly shadowBias?: number
  /** Coordinate space of `input.normal` (`'world'` default, or `'view'`). */
  readonly normalSpace?: 'world' | 'view'
  /** Shading evaluator: `'physical'` (default standalone GGX) or `'scene'` (calibrated to `lights.ts` + demodulated diffuse/spec output). */
  readonly evalMode?: 'physical' | 'scene'
  /** Custom WGSL snippet providing `fn traceShadowRay(origin: vec3f, dir: vec3f, maxDist: f32) -> f32`. */
  readonly occlusionWgsl?: string
  /** Optional `@group(1)` bind group layout for resources used by `occlusionWgsl`. */
  readonly occlusionBindGroupLayout?: GPUBindGroupLayout
}

export interface RestirCamera {
  readonly eye: RestirVec3
  readonly forward: RestirVec3
  readonly right: RestirVec3
  readonly up: RestirVec3
  readonly tanHalf: number
  readonly aspect: number
  /** Depth near plane in cells matching `depth24plus` (default `NEAR = 1`). */
  readonly near?: number
  /** Depth far plane in cells matching `depth24plus` (default `FAR = 100000`). */
  readonly far?: number
  /** Optional sub-pixel jitter `[jx, jy]` in render pixels (default `[0, 0]`). */
  readonly jitter?: readonly [number, number]
}

export interface RestirClusterInput {
  readonly gridBuffer: GPUBuffer
  readonly indexBuffer: GPUBuffer
  readonly dims?: readonly [number, number, number]
  readonly zNear?: number
  readonly zFar?: number
  readonly indexPoolCapacity?: number
}

export interface RestirDispatchInput {
  readonly depth: GPUTextureView
  readonly normal: GPUTextureView
  readonly albedo: GPUTextureView
  readonly material: GPUTextureView
  readonly velocity: GPUTextureView
  readonly lightsBuffer: GPUBuffer
  readonly lightCount: number
  readonly aliasBuffer?: GPUBuffer
  readonly cluster?: RestirClusterInput
  readonly occlusionBindGroup?: GPUBindGroup
  readonly camera: RestirCamera
  readonly renderSize: readonly [number, number]
  readonly anchor?: RestirVec3
  readonly reset?: boolean
  readonly initialCandidates?: number
  readonly maxTemporalM?: number
  readonly spatialNeighbors?: number
  readonly spatialRadius?: number
  readonly enableTemporal?: boolean
  readonly enableSpatial?: boolean
  readonly shadowBias?: number
  readonly wetness?: number
  readonly frameIndex?: number
}

export interface RestirTimingWrites {
  readonly ris?: GPUComputePassTimestampWrites
  readonly temporal?: GPUComputePassTimestampWrites
  readonly spatialShade?: GPUComputePassTimestampWrites
}

export interface RestirStats {
  readonly reallocs: number
  readonly frames: number
  readonly resets: number
  readonly historyValid: boolean
  readonly capacity: readonly [number, number]
  readonly renderSize: readonly [number, number]
  readonly lightCount: number
  readonly reservoirBytes: number
}

export interface RestirDIPass {
  /** Dispatches Pass 1 (RIS + shadow ray), Pass 2 (Temporal reuse), and Pass 3 (Spatial reuse + shade). */
  dispatch(encoder: GPUCommandEncoder, input: RestirDispatchInput, timing?: RestirTimingWrites): GPUTextureView
  /** Marks temporal history invalid so the next dispatch starts fresh without blending stale history. */
  reset(): void
  /** Returns allocation, dispatch, and buffer statistics. */
  stats(): RestirStats
  /** Persistent linear HDR `rgba16float` output view (`STORAGE_BINDING | TEXTURE_BINDING`). */
  readonly outputView: GPUTextureView
  /** Underlying `GPUTexture` of `outputView`. */
  readonly outputTexture: GPUTexture
  /** Releases all GPU resources owned by this ReSTIR-DI pass. */
  destroy(): void
}

function buildSceneDenoiseTempWgsl(): string {
  return /* wgsl */ `
${COMMON_COMPUTE_WGSL}
${DEFAULT_OCCLUSION_WGSL}

@group(0) @binding(0) var<uniform> params: RestirParams;
@group(0) @binding(1) var rawTex: texture_2d<f32>;
@group(0) @binding(2) var histIn: texture_2d<f32>;
@group(0) @binding(3) var geomCurr: texture_2d<f32>;
@group(0) @binding(4) var geomPrev: texture_2d<f32>;
@group(0) @binding(5) var velTex: texture_2d<f32>;
@group(0) @binding(6) var histOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn cs_restir_denoise_temp(@builtin(global_invocation_id) gid: vec3u) {
  let renderW = i32(params.sizeU.z);
  let renderH = i32(params.sizeU.w);
  let px = vec2i(i32(gid.x), i32(gid.y));
  if (px.x >= renderW || px.y >= renderH) { return; }

  let gC = textureLoad(geomCurr, px, 0);
  let curZ = gC.w;
  if (curZ <= 0.0) {
    textureStore(histOut, px, vec4f(0.0));
    return;
  }
  let curN = gC.xyz;
  let rawC = max(textureLoad(rawTex, px, 0), vec4f(0.0));

  // Fast 3x3 same-plane neighborhood firefly clamp (kills single-pixel high-weight spikes without losing energy).
  var meanV = rawC;
  var wMean = 1.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = px + vec2i(dx, dy);
      if (q.x < 0 || q.y < 0 || q.x >= renderW || q.y >= renderH) { continue; }
      let gQ = textureLoad(geomCurr, q, 0);
      if (gQ.w <= 0.0 || dot(curN, gQ.xyz) < 0.88) { continue; }
      if (abs(gQ.w - curZ) / max(curZ, 1.0) > 0.045) { continue; }
      meanV += max(textureLoad(rawTex, q, 0), vec4f(0.0));
      wMean += 1.0;
    }
  }
  let avgV = meanV / wMean;
  let avgL = restirLuma(avgV.rgb);
  let curL = restirLuma(rawC.rgb);
  let maxL = avgL * 3.2 + 0.25;
  var curV = rawC;
  if (curL > maxL && curL > 1e-4) {
    curV = vec4f(rawC.rgb * (maxL / curL), min(rawC.a, avgV.a * 3.2 + 0.25));
  }

  let hasHistory = (params.configU.w & ${FLAG_HAS_HISTORY}u) != 0u;
  if (!hasHistory || params.prevRenderInfo.x < 0.5 || params.prevRenderInfo.y < 0.5) {
    textureStore(histOut, px, curV);
    return;
  }

  let curUV = (vec2f(px) + 0.5) * params.renderInfo.zw;
  let velRaw = textureLoad(velTex, px, 0).xy;
  let velOk = all(velRaw >= vec2f(-100.0)) && all(velRaw <= vec2f(100.0));
  let prevUV = curUV + select(vec2f(0.0), velRaw, velOk);
  if (any(prevUV < vec2f(0.0)) || any(prevUV >= vec2f(1.0))) {
    textureStore(histOut, px, curV);
    return;
  }

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
  let offs = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));
  var sumH = vec4f(0.0);
  var sumW = 0.0;
  for (var i = 0u; i < 4u; i++) {
    let tc = baseI + offs[i];
    if (tc.x < 0 || tc.y < 0 || tc.x >= prevSizeI.x || tc.y >= prevSizeI.y) { continue; }
    let gP = textureLoad(geomPrev, tc, 0);
    if (gP.w <= 0.0 || dot(curN, gP.xyz) < 0.88) { continue; }
    if (abs(gP.w - curZ) / max(curZ, 1.0) > 0.05) { continue; }
    let w = bW[i];
    sumH += max(textureLoad(histIn, tc, 0), vec4f(0.0)) * w;
    sumW += w;
  }
  if (sumW > 0.01) {
    let prevV = sumH / sumW;
    // Fast 0.24 EMA smooths 1-spp chromatic variance while keeping moving headlights crisp and ghost-free.
    textureStore(histOut, px, mix(prevV, curV, 0.24));
  } else {
    textureStore(histOut, px, curV);
  }
}
`
}

function buildSceneDenoiseAtrousWgsl(): string {
  return /* wgsl */ `
struct DenoiseCfg {
  // x: renderW, y: renderH, z: stepSize (1 or 2), w: pad
  info: vec4i,
}

@group(0) @binding(0) var<uniform> cfg: DenoiseCfg;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var geomCurr: texture_2d<f32>;
@group(0) @binding(3) var dstTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn cs_restir_denoise_atrous(@builtin(global_invocation_id) gid: vec3u) {
  let renderW = cfg.info.x;
  let renderH = cfg.info.y;
  let stepSz = cfg.info.z;
  let px = vec2i(i32(gid.x), i32(gid.y));
  if (px.x >= renderW || px.y >= renderH) { return; }

  let gC = textureLoad(geomCurr, px, 0);
  let curZ = gC.w;
  if (curZ <= 0.0) {
    textureStore(dstTex, px, vec4f(0.0));
    return;
  }
  let curN = gC.xyz;
  let invSigZ = 1.0 / max(curZ * 0.025, 1.2);
  let k1d = array<f32, 3>(0.375, 0.25, 0.0625);

  let c0 = max(textureLoad(srcTex, px, 0), vec4f(0.0));
  var sumV = c0 * (k1d[0] * k1d[0]);
  var sumW = k1d[0] * k1d[0];

  for (var dy = -2; dy <= 2; dy++) {
    let ky = k1d[abs(dy)];
    for (var dx = -2; dx <= 2; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let q = px + vec2i(dx * stepSz, dy * stepSz);
      if (q.x < 0 || q.y < 0 || q.x >= renderW || q.y >= renderH) { continue; }
      let gQ = textureLoad(geomCurr, q, 0);
      if (gQ.w <= 0.0) { continue; }
      let nd = dot(curN, gQ.xyz);
      if (nd < 0.85) { continue; }
      let nd2 = nd * nd;
      let nd4 = nd2 * nd2;
      let nd8 = nd4 * nd4;
      let wN = nd8 * nd8 * nd8 * nd8;
      let dz = abs(gQ.w - curZ);
      let wZ = exp(-dz * invSigZ);
      let w = k1d[abs(dx)] * ky * wN * wZ;
      if (w > 1e-5) {
        sumV += max(textureLoad(srcTex, q, 0), vec4f(0.0)) * w;
        sumW += w;
      }
    }
  }

  let outV = sumV / max(sumW, 1e-6);
  textureStore(dstTex, px, min(max(outV, vec4f(0.0)), vec4f(65000.0)));
}
`
}

/**
 * Zero-GC Vose Alias Table builder for power-weighted O(1) importance sampling of 64-byte
 * `ClusterLight` records. Returns the total radiant power weight sum.
 *
 * Caller provides pre-allocated scratch buffers (`scaled`, `small`, `large`) of length `>= lightCount`
 * and `outF32` / `outU32` views over a `>= lightCount * 16` byte `ArrayBuffer`.
 */
export function buildLightAliasTable(
  lightsF32: Float32Array,
  lightCount: number,
  outF32: Float32Array,
  outU32: Uint32Array,
  scaled: Float32Array,
  small: Int32Array,
  large: Int32Array,
): number {
  const n = Math.max(0, lightCount | 0)
  if (n === 0) return 0

  let totalPower = 0
  for (let i = 0; i < n; i++) {
    const o = i * LIGHT_FLOATS
    const range = Math.max(lightsF32[o + 3], 0)
    const r = Math.max(lightsF32[o + 4], 0)
    const g = Math.max(lightsF32[o + 5], 0)
    const b = Math.max(lightsF32[o + 6], 0)
    const cosOuter = lightsF32[o + 7]
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
    const coneFactor = cosOuter > -1.5 ? Math.max(0.05, 0.5 * (1 - Math.min(1, cosOuter))) : 1.0
    const power = luma * range * range * coneFactor
    scaled[i] = power
    totalPower += power
  }

  if (!(totalPower > 0)) {
    const invN = 1 / n
    for (let i = 0; i < n; i++) {
      const o = i * 4
      outF32[o + 0] = 1.0
      outU32[o + 1] = i
      outF32[o + 2] = invN
      outU32[o + 3] = 0
    }
    return 0
  }

  const invTotal = 1 / totalPower
  let smallTop = 0
  let largeTop = 0
  for (let i = 0; i < n; i++) {
    const pdf = scaled[i] * invTotal
    outF32[i * 4 + 2] = pdf
    outU32[i * 4 + 3] = 0
    const pScaled = pdf * n
    scaled[i] = pScaled
    if (pScaled < 1.0) small[smallTop++] = i
    else large[largeTop++] = i
  }

  while (smallTop > 0 && largeTop > 0) {
    const s = small[--smallTop]
    const l = large[--largeTop]
    outF32[s * 4 + 0] = scaled[s]
    outU32[s * 4 + 1] = l
    const rem = scaled[l] + scaled[s] - 1.0
    scaled[l] = rem
    if (rem < 1.0) small[smallTop++] = l
    else large[largeTop++] = l
  }

  while (largeTop > 0) {
    const l = large[--largeTop]
    outF32[l * 4 + 0] = 1.0
    outU32[l * 4 + 1] = l
  }
  while (smallTop > 0) {
    const s = small[--smallTop]
    outF32[s * 4 + 0] = 1.0
    outU32[s * 4 + 1] = s
  }

  return totalPower
}

export interface RestirLightBuffer {
  readonly maxLights: number
  readonly count: number
  readonly lightsBuffer: GPUBuffer
  readonly aliasBuffer: GPUBuffer
  beginFrame(anchorX?: number, anchorY?: number, anchorZ?: number): void
  addPoint(
    px: number, py: number, pz: number,
    r: number, g: number, b: number,
    range: number,
    sourceRadius?: number,
    shadowId?: number,
    kind?: number,
    flags?: number,
  ): number
  addSpot(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    r: number, g: number, b: number,
    range: number,
    cosOuter: number,
    cosInner: number,
    sourceRadius?: number,
    shadowId?: number,
    kind?: number,
    flags?: number,
  ): number
  upload(queue?: GPUQueue): void
  destroy(): void
}

/**
 * Zero-GC staging helper producing a 64-byte `ClusterLight` storage buffer plus matching O(1)
 * power-weighted Vose alias table for direct ReSTIR-DI use without an external cluster pass.
 */
export function createRestirLightBuffer(device: GPUDevice, maxLights = 512): RestirLightBuffer {
  const cap = Math.max(1, Math.floor(maxLights))
  const lightsRaw = new ArrayBuffer(cap * RESTIR_LIGHT_BYTES)
  const lightsF32 = new Float32Array(lightsRaw)
  const aliasRaw = new ArrayBuffer(cap * RESTIR_ALIAS_BYTES)
  const aliasF32 = new Float32Array(aliasRaw)
  const aliasU32 = new Uint32Array(aliasRaw)
  const scratchScaled = new Float32Array(cap)
  const scratchSmall = new Int32Array(cap)
  const scratchLarge = new Int32Array(cap)

  const lightsBuffer = device.createBuffer({
    label: 'restir-lights',
    size: cap * RESTIR_LIGHT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const aliasBuffer = device.createBuffer({
    label: 'restir-light-alias',
    size: cap * RESTIR_ALIAS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  let count = 0
  let anchorX = 0
  let anchorY = 0
  let anchorZ = 0
  let destroyed = false

  return {
    maxLights: cap,
    get count() { return count },
    lightsBuffer,
    aliasBuffer,
    beginFrame(ax = 0, ay = 0, az = 0) {
      count = 0
      anchorX = ax
      anchorY = ay
      anchorZ = az
    },
    addPoint(px, py, pz, r, g, b, range, sourceRadius = 0, shadowId = 0, kind = 2, flags = 0) {
      if (count >= cap || !(range > 0)) return -1
      const idx = count++
      const o = idx * LIGHT_FLOATS
      lightsF32[o + 0] = px - anchorX
      lightsF32[o + 1] = py - anchorY
      lightsF32[o + 2] = pz - anchorZ
      lightsF32[o + 3] = range
      lightsF32[o + 4] = r
      lightsF32[o + 5] = g
      lightsF32[o + 6] = b
      lightsF32[o + 7] = POINT_COS_OUTER
      lightsF32[o + 8] = 0
      lightsF32[o + 9] = -1
      lightsF32[o + 10] = 0
      lightsF32[o + 11] = POINT_COS_INNER
      lightsF32[o + 12] = sourceRadius
      lightsF32[o + 13] = shadowId
      lightsF32[o + 14] = kind
      lightsF32[o + 15] = flags
      return idx
    },
    addSpot(px, py, pz, dx, dy, dz, r, g, b, range, cosOuter, cosInner, sourceRadius = 0, shadowId = 0, kind = 2, flags = 0) {
      if (count >= cap || !(range > 0)) return -1
      const invL = 1 / (Math.hypot(dx, dy, dz) || 1)
      const cOut = Math.max(-1.0, Math.min(0.9999, cosOuter))
      const cIn = Math.max(cOut + 1e-4, Math.min(1.0, cosInner))
      const idx = count++
      const o = idx * LIGHT_FLOATS
      lightsF32[o + 0] = px - anchorX
      lightsF32[o + 1] = py - anchorY
      lightsF32[o + 2] = pz - anchorZ
      lightsF32[o + 3] = range
      lightsF32[o + 4] = r
      lightsF32[o + 5] = g
      lightsF32[o + 6] = b
      lightsF32[o + 7] = cOut
      lightsF32[o + 8] = dx * invL
      lightsF32[o + 9] = dy * invL
      lightsF32[o + 10] = dz * invL
      lightsF32[o + 11] = cIn
      lightsF32[o + 12] = sourceRadius
      lightsF32[o + 13] = shadowId
      lightsF32[o + 14] = kind
      lightsF32[o + 15] = flags
      return idx
    },
    upload(queue: GPUQueue = device.queue) {
      if (destroyed || count === 0) return
      buildLightAliasTable(lightsF32, count, aliasF32, aliasU32, scratchScaled, scratchSmall, scratchLarge)
      queue.writeBuffer(lightsBuffer, 0, lightsRaw, 0, count * RESTIR_LIGHT_BYTES)
      queue.writeBuffer(aliasBuffer, 0, aliasRaw, 0, count * RESTIR_ALIAS_BYTES)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      lightsBuffer.destroy()
      aliasBuffer.destroy()
    },
  }
}

export async function createRestirDI(
  device: GPUDevice,
  options: RestirDIOptions = {},
): Promise<RestirDIPass> {
  const OUTPUT_USAGE =
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC
  const GEOM_USAGE =
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.TEXTURE_BINDING
  const initMax = options.maxSize ?? DEFAULT_RESTIR_MAX_SIZE
  const defaultCandidates = Math.max(1, Math.min(64, Math.round(options.initialCandidates ?? DEFAULT_RESTIR_CANDIDATES)))
  const defaultMaxM = Math.max(1, Math.min(64, Math.round(options.maxTemporalM ?? DEFAULT_RESTIR_MAX_TEMPORAL_M)))
  const defaultSpatialK = Math.max(0, Math.min(8, Math.round(options.spatialNeighbors ?? DEFAULT_RESTIR_SPATIAL_NEIGHBORS)))
  const defaultSpatialRadius = Math.max(1, Math.min(64, options.spatialRadius ?? DEFAULT_RESTIR_SPATIAL_RADIUS))
  const defaultShadowBias = Math.max(0.001, options.shadowBias ?? DEFAULT_RESTIR_SHADOW_BIAS)
  const viewSpaceNormals = options.normalSpace === 'view'
  const sceneEval = options.evalMode === 'scene'
  const occlusionWgsl = options.occlusionWgsl ?? DEFAULT_OCCLUSION_WGSL
  const hasOcclusionBgl = !!options.occlusionBindGroupLayout

  const [risMod, temporalMod, spatialMod, denoiseTempMod, denoiseAtrousMod] = await Promise.all([
    shader(device, 'restir-ris-initial', buildRisInitialWgsl(occlusionWgsl)),
    shader(device, 'restir-temporal-reuse', buildTemporalReuseWgsl(occlusionWgsl)),
    shader(device, 'restir-spatial-shade', buildSpatialShadeWgsl(occlusionWgsl)),
    sceneEval ? shader(device, 'restir-denoise-temp', buildSceneDenoiseTempWgsl()) : Promise.resolve(null),
    sceneEval ? shader(device, 'restir-denoise-atrous', buildSceneDenoiseAtrousWgsl()) : Promise.resolve(null),
  ])

  const risBgl = device.createBindGroupLayout({
    label: 'restir-ris-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' } },
    ],
  })

  const temporalBgl = device.createBindGroupLayout({
    label: 'restir-temporal-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
    ],
  })

  const spatialBgl = device.createBindGroupLayout({
    label: 'restir-spatial-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
    ],
  })

  const denoiseTempBgl = sceneEval
    ? device.createBindGroupLayout({
        label: 'restir-denoise-temp-bgl',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
        ],
      })
    : null
  const denoiseAtrousBgl = sceneEval
    ? device.createBindGroupLayout({
        label: 'restir-denoise-atrous-bgl',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' } },
        ],
      })
    : null

  const occBgls = options.occlusionBindGroupLayout ? [options.occlusionBindGroupLayout] : []
  const [risPipe, temporalPipe, spatialPipe, denoiseTempPipe, denoiseAtrousPipe] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'restir-ris-initial',
      layout: device.createPipelineLayout({ bindGroupLayouts: [risBgl, ...occBgls] }),
      compute: { module: risMod, entryPoint: 'cs_ris_initial' },
    }),
    device.createComputePipelineAsync({
      label: 'restir-temporal-reuse',
      layout: device.createPipelineLayout({ bindGroupLayouts: [temporalBgl, ...occBgls] }),
      compute: { module: temporalMod, entryPoint: 'cs_temporal_reuse' },
    }),
    device.createComputePipelineAsync({
      label: 'restir-spatial-shade',
      layout: device.createPipelineLayout({ bindGroupLayouts: [spatialBgl, ...occBgls] }),
      compute: { module: spatialMod, entryPoint: 'cs_spatial_reuse_and_shade' },
    }),
    sceneEval && denoiseTempBgl && denoiseTempMod
      ? device.createComputePipelineAsync({
          label: 'restir-denoise-temp',
          layout: device.createPipelineLayout({ bindGroupLayouts: [denoiseTempBgl] }),
          compute: { module: denoiseTempMod, entryPoint: 'cs_restir_denoise_temp' },
        })
      : Promise.resolve(null),
    sceneEval && denoiseAtrousBgl && denoiseAtrousMod
      ? device.createComputePipelineAsync({
          label: 'restir-denoise-atrous',
          layout: device.createPipelineLayout({ bindGroupLayouts: [denoiseAtrousBgl] }),
          compute: { module: denoiseAtrousMod, entryPoint: 'cs_restir_denoise_atrous' },
        })
      : Promise.resolve(null),
  ])

  const denoiseCfgUbos: [GPUBuffer, GPUBuffer] | null = sceneEval
    ? [
        device.createBuffer({ label: 'restir-denoise-cfg-1', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        device.createBuffer({ label: 'restir-denoise-cfg-2', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      ]
    : null
  const denoiseCfgI32 = new Int32Array(4)

  const paramsBuffer = device.createBuffer({
    label: 'restir-params',
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramsRaw = new ArrayBuffer(PARAMS_BYTES)
  const paramsF32 = new Float32Array(paramsRaw)
  const paramsU32 = new Uint32Array(paramsRaw)

  // Tiny dummy storage buffers when optional cluster grid or alias table is omitted.
  const dummyClusterGrid = device.createBuffer({
    label: 'restir-dummy-cluster-grid',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const dummyClusterIndices = device.createBuffer({
    label: 'restir-dummy-cluster-indices',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })
  const dummyAlias = device.createBuffer({
    label: 'restir-dummy-alias',
    size: 16,
    usage: GPUBufferUsage.STORAGE,
  })

  let capW = Math.max(1, Math.round(initMax[0]))
  let capH = Math.max(1, Math.round(initMax[1]))

  const makeReservoirBuf = (label: string, w: number, h: number) =>
    device.createBuffer({
      label,
      size: w * h * RESTIR_RESERVOIR_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  const makeGeomTex = (label: string, w: number, h: number) =>
    device.createTexture({ label, size: [w, h], format: 'rgba32float', usage: GEOM_USAGE })
  const makeOutputTex = (w: number, h: number) =>
    device.createTexture({ label: 'restir-output', size: [w, h], format: 'rgba16float', usage: OUTPUT_USAGE })

  let resInitial = makeReservoirBuf('restir-res-initial', capW, capH)
  let resTemporal: [GPUBuffer, GPUBuffer] = [
    makeReservoirBuf('restir-res-temporal-0', capW, capH),
    makeReservoirBuf('restir-res-temporal-1', capW, capH),
  ]
  let resSpatial = makeReservoirBuf('restir-res-spatial', capW, capH)
  let geomTex: [GPUTexture, GPUTexture] = [makeGeomTex('restir-geom-0', capW, capH), makeGeomTex('restir-geom-1', capW, capH)]
  let geomView: [GPUTextureView, GPUTextureView] = [geomTex[0].createView(), geomTex[1].createView()]
  let outputTex = makeOutputTex(capW, capH)
  let outputView = outputTex.createView()
  const makeDenoiseTex = (label: string, w: number, h: number) =>
    device.createTexture({ label, size: [w, h], format: 'rgba16float', usage: OUTPUT_USAGE })
  let denoiseHistTex: [GPUTexture, GPUTexture] | null = sceneEval
    ? [makeDenoiseTex('restir-denoise-h0', capW, capH), makeDenoiseTex('restir-denoise-h1', capW, capH)]
    : null
  let denoiseHistView: [GPUTextureView, GPUTextureView] | null = denoiseHistTex
    ? [denoiseHistTex[0].createView(), denoiseHistTex[1].createView()]
    : null
  let denoiseTmpTex: GPUTexture | null = sceneEval ? makeDenoiseTex('restir-denoise-tmp', capW, capH) : null
  let denoiseTmpView: GPUTextureView | null = denoiseTmpTex ? denoiseTmpTex.createView() : null
  let denoiseOutTex: GPUTexture | null = sceneEval ? makeDenoiseTex('restir-denoise-out', capW, capH) : null
  let denoiseOutView: GPUTextureView | null = denoiseOutTex ? denoiseOutTex.createView() : null

  // Cached bind groups (ping=0 and ping=1) for zero steady-state allocations.
  let cachedRis: [GPUBindGroup, GPUBindGroup] | null = null
  let cachedRisKeyLights: GPUBuffer | null = null
  let cachedRisKeyGrid: GPUBuffer | null = null
  let cachedRisKeyIdx: GPUBuffer | null = null
  let cachedRisKeyAlias: GPUBuffer | null = null
  let cachedRisKeyDepth: GPUTextureView | null = null
  let cachedRisKeyNormal: GPUTextureView | null = null
  let cachedRisKeyAlbedo: GPUTextureView | null = null
  let cachedRisKeyMat: GPUTextureView | null = null

  let cachedTemporal: [GPUBindGroup, GPUBindGroup] | null = null
  let cachedTempKeyLights: GPUBuffer | null = null
  let cachedTempKeyVel: GPUTextureView | null = null
  let cachedTempKeyAlbedo: GPUTextureView | null = null
  let cachedTempKeyMat: GPUTextureView | null = null

  let cachedSpatial: [GPUBindGroup, GPUBindGroup] | null = null
  let cachedSpatKeyLights: GPUBuffer | null = null
  let cachedSpatKeyAlbedo: GPUTextureView | null = null
  let cachedSpatKeyMat: GPUTextureView | null = null

  let cachedDenoiseTemp: [GPUBindGroup, GPUBindGroup] | null = null
  let cachedDenoiseKeyVel: GPUTextureView | null = null
  let cachedDenoiseA1: [GPUBindGroup, GPUBindGroup] | null = null
  let cachedDenoiseA2: [GPUBindGroup, GPUBindGroup] | null = null

  const invalidateBindGroups = () => {
    cachedRis = null
    cachedTemporal = null
    cachedSpatial = null
    cachedDenoiseTemp = null
    cachedDenoiseA1 = null
    cachedDenoiseA2 = null
  }

  let ping: 0 | 1 = 0
  let historyValid = false
  let reallocs = 0
  let frames = 0
  let resets = 0
  let lastRenderW = 0
  let lastRenderH = 0
  let lastLightCount = 0
  let destroyed = false

  // Previous-frame camera state for exact temporal reprojection.
  let prevEyeX = 0, prevEyeY = 0, prevEyeZ = 0, prevTanHalf = 0.57735027
  let prevFwdX = 0, prevFwdY = 0, prevFwdZ = -1, prevAspect = 16 / 9
  let prevRightX = 1, prevRightY = 0, prevRightZ = 0, prevNear = NEAR
  let prevUpX = 0, prevUpY = 1, prevUpZ = 0, prevFar = FAR
  let prevJitterX = 0, prevJitterY = 0

  const ensureCapacity = (w: number, h: number) => {
    if (w <= capW && h <= capH) return
    capW = Math.max(capW, w)
    capH = Math.max(capH, h)
    resInitial.destroy()
    resTemporal[0].destroy()
    resTemporal[1].destroy()
    resSpatial.destroy()
    geomTex[0].destroy()
    geomTex[1].destroy()
    outputTex.destroy()
    if (denoiseHistTex) { denoiseHistTex[0].destroy(); denoiseHistTex[1].destroy() }
    denoiseTmpTex?.destroy()
    denoiseOutTex?.destroy()
    resInitial = makeReservoirBuf('restir-res-initial', capW, capH)
    resTemporal = [
      makeReservoirBuf('restir-res-temporal-0', capW, capH),
      makeReservoirBuf('restir-res-temporal-1', capW, capH),
    ]
    resSpatial = makeReservoirBuf('restir-res-spatial', capW, capH)
    geomTex = [makeGeomTex('restir-geom-0', capW, capH), makeGeomTex('restir-geom-1', capW, capH)]
    geomView = [geomTex[0].createView(), geomTex[1].createView()]
    outputTex = makeOutputTex(capW, capH)
    outputView = outputTex.createView()
    if (sceneEval) {
      denoiseHistTex = [makeDenoiseTex('restir-denoise-h0', capW, capH), makeDenoiseTex('restir-denoise-h1', capW, capH)]
      denoiseHistView = [denoiseHistTex[0].createView(), denoiseHistTex[1].createView()]
      denoiseTmpTex = makeDenoiseTex('restir-denoise-tmp', capW, capH)
      denoiseTmpView = denoiseTmpTex.createView()
      denoiseOutTex = makeDenoiseTex('restir-denoise-out', capW, capH)
      denoiseOutView = denoiseOutTex.createView()
    }
    invalidateBindGroups()
    historyValid = false
    reallocs++
  }

  const getRisBindGroups = (
    lightsBuf: GPUBuffer,
    gridBuf: GPUBuffer,
    idxBuf: GPUBuffer,
    aliasBuf: GPUBuffer,
    depth: GPUTextureView,
    normal: GPUTextureView,
    albedo: GPUTextureView,
    material: GPUTextureView,
  ): [GPUBindGroup, GPUBindGroup] => {
    if (
      cachedRis
      && cachedRisKeyLights === lightsBuf
      && cachedRisKeyGrid === gridBuf
      && cachedRisKeyIdx === idxBuf
      && cachedRisKeyAlias === aliasBuf
      && cachedRisKeyDepth === depth
      && cachedRisKeyNormal === normal
      && cachedRisKeyAlbedo === albedo
      && cachedRisKeyMat === material
    ) {
      return cachedRis
    }
    cachedRisKeyLights = lightsBuf
    cachedRisKeyGrid = gridBuf
    cachedRisKeyIdx = idxBuf
    cachedRisKeyAlias = aliasBuf
    cachedRisKeyDepth = depth
    cachedRisKeyNormal = normal
    cachedRisKeyAlbedo = albedo
    cachedRisKeyMat = material
    const make = (currIdx: 0 | 1) =>
      device.createBindGroup({
        label: `restir-ris-bg-${currIdx}`,
        layout: risBgl,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: lightsBuf } },
          { binding: 2, resource: { buffer: gridBuf } },
          { binding: 3, resource: { buffer: idxBuf } },
          { binding: 4, resource: { buffer: aliasBuf } },
          { binding: 5, resource: depth },
          { binding: 6, resource: normal },
          { binding: 7, resource: albedo },
          { binding: 8, resource: material },
          { binding: 9, resource: { buffer: resInitial } },
          { binding: 10, resource: geomView[currIdx] },
        ],
      })
    cachedRis = [make(0), make(1)]
    return cachedRis
  }

  const getTemporalBindGroups = (
    lightsBuf: GPUBuffer,
    velocity: GPUTextureView,
    albedo: GPUTextureView,
    material: GPUTextureView,
  ): [GPUBindGroup, GPUBindGroup] => {
    if (
      cachedTemporal
      && cachedTempKeyLights === lightsBuf
      && cachedTempKeyVel === velocity
      && cachedTempKeyAlbedo === albedo
      && cachedTempKeyMat === material
    ) {
      return cachedTemporal
    }
    cachedTempKeyLights = lightsBuf
    cachedTempKeyVel = velocity
    cachedTempKeyAlbedo = albedo
    cachedTempKeyMat = material
    const make = (currIdx: 0 | 1) => {
      const prevIdx: 0 | 1 = currIdx === 0 ? 1 : 0
      return device.createBindGroup({
        label: `restir-temporal-bg-${currIdx}`,
        layout: temporalBgl,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: lightsBuf } },
          { binding: 2, resource: { buffer: resInitial } },
          { binding: 3, resource: { buffer: resTemporal[prevIdx] } },
          { binding: 4, resource: { buffer: resTemporal[currIdx] } },
          { binding: 5, resource: geomView[currIdx] },
          { binding: 6, resource: geomView[prevIdx] },
          { binding: 7, resource: velocity },
          { binding: 8, resource: albedo },
          { binding: 9, resource: material },
        ],
      })
    }
    cachedTemporal = [make(0), make(1)]
    return cachedTemporal
  }

  const getSpatialBindGroups = (
    lightsBuf: GPUBuffer,
    albedo: GPUTextureView,
    material: GPUTextureView,
  ): [GPUBindGroup, GPUBindGroup] => {
    if (
      cachedSpatial
      && cachedSpatKeyLights === lightsBuf
      && cachedSpatKeyAlbedo === albedo
      && cachedSpatKeyMat === material
    ) {
      return cachedSpatial
    }
    cachedSpatKeyLights = lightsBuf
    cachedSpatKeyAlbedo = albedo
    cachedSpatKeyMat = material
    const make = (currIdx: 0 | 1) =>
      device.createBindGroup({
        label: `restir-spatial-bg-${currIdx}`,
        layout: spatialBgl,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: { buffer: lightsBuf } },
          { binding: 2, resource: { buffer: resTemporal[currIdx] } },
          { binding: 3, resource: { buffer: resSpatial } },
          { binding: 4, resource: geomView[currIdx] },
          { binding: 5, resource: albedo },
          { binding: 6, resource: material },
          { binding: 7, resource: outputView },
        ],
      })
    cachedSpatial = [make(0), make(1)]
    return cachedSpatial
  }

  const getDenoiseBindGroups = (velocity: GPUTextureView) => {
    if (!denoiseTempBgl || !denoiseAtrousBgl || !denoiseHistView || !denoiseTmpView || !denoiseOutView || !denoiseCfgUbos) return null
    if (!cachedDenoiseTemp || cachedDenoiseKeyVel !== velocity) {
      cachedDenoiseKeyVel = velocity
      const makeT = (currIdx: 0 | 1) => {
        const prevIdx: 0 | 1 = currIdx === 0 ? 1 : 0
        return device.createBindGroup({
          label: `restir-denoise-temp-bg-${currIdx}`,
          layout: denoiseTempBgl,
          entries: [
            { binding: 0, resource: { buffer: paramsBuffer } },
            { binding: 1, resource: outputView },
            { binding: 2, resource: denoiseHistView![prevIdx] },
            { binding: 3, resource: geomView[currIdx] },
            { binding: 4, resource: geomView[prevIdx] },
            { binding: 5, resource: velocity },
            { binding: 6, resource: denoiseHistView![currIdx] },
          ],
        })
      }
      cachedDenoiseTemp = [makeT(0), makeT(1)]
    }
    if (!cachedDenoiseA1) {
      const makeA1 = (currIdx: 0 | 1) =>
        device.createBindGroup({
          label: `restir-denoise-a1-bg-${currIdx}`,
          layout: denoiseAtrousBgl,
          entries: [
            { binding: 0, resource: { buffer: denoiseCfgUbos[0] } },
            { binding: 1, resource: denoiseHistView![currIdx] },
            { binding: 2, resource: geomView[currIdx] },
            { binding: 3, resource: denoiseTmpView! },
          ],
        })
      cachedDenoiseA1 = [makeA1(0), makeA1(1)]
    }
    if (!cachedDenoiseA2) {
      const makeA2 = (currIdx: 0 | 1) =>
        device.createBindGroup({
          label: `restir-denoise-a2-bg-${currIdx}`,
          layout: denoiseAtrousBgl,
          entries: [
            { binding: 0, resource: { buffer: denoiseCfgUbos[1] } },
            { binding: 1, resource: denoiseTmpView! },
            { binding: 2, resource: geomView[currIdx] },
            { binding: 3, resource: denoiseOutView! },
          ],
        })
      cachedDenoiseA2 = [makeA2(0), makeA2(1)]
    }
    return { temp: cachedDenoiseTemp, a1: cachedDenoiseA1, a2: cachedDenoiseA2 }
  }

  return {
    get outputView() { return denoiseOutView ?? outputView },
    get outputTexture() { return denoiseOutTex ?? outputTex },

    dispatch(encoder, input, timing) {
      if (destroyed) throw new Error('RestirDIPass was destroyed')
      if (hasOcclusionBgl && !input.occlusionBindGroup) {
        throw new Error('RestirDIPass: occlusionBindGroup is required when occlusionBindGroupLayout is configured')
      }

      const renderW = Math.max(1, Math.round(input.renderSize[0]))
      const renderH = Math.max(1, Math.round(input.renderSize[1]))
      ensureCapacity(renderW, renderH)

      const doReset = !historyValid || !!input.reset
      if (doReset) resets++

      const cam = input.camera
      const ax = input.anchor?.[0] ?? 0
      const ay = input.anchor?.[1] ?? 0
      const az = input.anchor?.[2] ?? 0
      const eyeX = cam.eye[0] - ax
      const eyeY = cam.eye[1] - ay
      const eyeZ = cam.eye[2] - az

      const fl = Math.hypot(cam.forward[0], cam.forward[1], cam.forward[2]) || 1
      const rl = Math.hypot(cam.right[0], cam.right[1], cam.right[2]) || 1
      const ul = Math.hypot(cam.up[0], cam.up[1], cam.up[2]) || 1
      const fwdX = cam.forward[0] / fl, fwdY = cam.forward[1] / fl, fwdZ = cam.forward[2] / fl
      const rightX = cam.right[0] / rl, rightY = cam.right[1] / rl, rightZ = cam.right[2] / rl
      const upX = cam.up[0] / ul, upY = cam.up[1] / ul, upZ = cam.up[2] / ul
      const zNear = cam.near ?? NEAR
      const zFar = cam.far ?? FAR
      const jx = cam.jitter?.[0] ?? 0
      const jy = cam.jitter?.[1] ?? 0

      if (doReset) {
        prevEyeX = cam.eye[0]; prevEyeY = cam.eye[1]; prevEyeZ = cam.eye[2]; prevTanHalf = cam.tanHalf
        prevFwdX = fwdX; prevFwdY = fwdY; prevFwdZ = fwdZ; prevAspect = cam.aspect
        prevRightX = rightX; prevRightY = rightY; prevRightZ = rightZ; prevNear = zNear
        prevUpX = upX; prevUpY = upY; prevUpZ = upZ; prevFar = zFar
        prevJitterX = jx; prevJitterY = jy
        lastRenderW = renderW; lastRenderH = renderH
      }

      const candidates = Math.max(1, Math.min(64, Math.round(input.initialCandidates ?? defaultCandidates)))
      const maxTemporalM = Math.max(1, Math.min(64, Math.round(input.maxTemporalM ?? defaultMaxM)))
      const spatialNeighbors = Math.max(0, Math.min(8, Math.round(input.spatialNeighbors ?? defaultSpatialK)))
      const spatialRadius = Math.max(1, Math.min(64, input.spatialRadius ?? defaultSpatialRadius))
      const shadowBias = Math.max(0.001, input.shadowBias ?? defaultShadowBias)
      const wetness = Math.max(0, Math.min(1, input.wetness ?? 0))
      const enableTemporal = input.enableTemporal ?? true
      const enableSpatial = input.enableSpatial ?? true
      const useClusters = !!input.cluster
      const useAlias = !useClusters && !!input.aliasBuffer
      const lightCount = Math.max(0, input.lightCount | 0)
      const frameIdx = (input.frameIndex ?? frames) >>> 0

      const clusterX = input.cluster?.dims?.[0] ?? 16
      const clusterY = input.cluster?.dims?.[1] ?? 9
      const clusterZ = input.cluster?.dims?.[2] ?? 24
      const clusterZNear = Math.max(1e-3, input.cluster?.zNear ?? 5.0)
      const clusterZFar = Math.max(clusterZNear + 1.0, input.cluster?.zFar ?? 4000.0)
      const clusterZScale = clusterZ / Math.log(clusterZFar / clusterZNear)
      const clusterPoolCap = input.cluster?.indexPoolCapacity ?? (clusterX * clusterY * clusterZ * 32)

      let flags = 0
      if (!doReset) flags |= FLAG_HAS_HISTORY
      if (enableTemporal) flags |= FLAG_ENABLE_TEMPORAL
      if (enableSpatial) flags |= FLAG_ENABLE_SPATIAL
      if (useAlias) flags |= FLAG_USE_ALIAS
      if (useClusters) flags |= FLAG_USE_CLUSTERS
      if (viewSpaceNormals) flags |= FLAG_VIEW_NORMALS
      if (sceneEval) flags |= FLAG_SCENE_EVAL

      // Pack 272-byte RestirParams uniform buffer (zero GC).
      // Express previous eye relative to the CURRENT anchor so temporal reprojection never breaks on 64-cell anchor hops.
      paramsF32[0] = eyeX; paramsF32[1] = eyeY; paramsF32[2] = eyeZ; paramsF32[3] = cam.tanHalf
      paramsF32[4] = fwdX; paramsF32[5] = fwdY; paramsF32[6] = fwdZ; paramsF32[7] = cam.aspect
      paramsF32[8] = rightX; paramsF32[9] = rightY; paramsF32[10] = rightZ; paramsF32[11] = zNear
      paramsF32[12] = upX; paramsF32[13] = upY; paramsF32[14] = upZ; paramsF32[15] = zFar

      paramsF32[16] = prevEyeX - ax; paramsF32[17] = prevEyeY - ay; paramsF32[18] = prevEyeZ - az; paramsF32[19] = prevTanHalf
      paramsF32[20] = prevFwdX; paramsF32[21] = prevFwdY; paramsF32[22] = prevFwdZ; paramsF32[23] = prevAspect
      paramsF32[24] = prevRightX; paramsF32[25] = prevRightY; paramsF32[26] = prevRightZ; paramsF32[27] = prevNear
      paramsF32[28] = prevUpX; paramsF32[29] = prevUpY; paramsF32[30] = prevUpZ; paramsF32[31] = prevFar

      paramsF32[32] = renderW; paramsF32[33] = renderH; paramsF32[34] = 1 / renderW; paramsF32[35] = 1 / renderH
      paramsF32[36] = lastRenderW; paramsF32[37] = lastRenderH; paramsF32[38] = 1 / lastRenderW; paramsF32[39] = 1 / lastRenderH
      paramsF32[40] = jx; paramsF32[41] = jy; paramsF32[42] = prevJitterX; paramsF32[43] = prevJitterY
      paramsF32[44] = shadowBias; paramsF32[45] = spatialRadius; paramsF32[46] = clusterZNear; paramsF32[47] = clusterZFar
      paramsF32[48] = clusterZScale; paramsF32[49] = wetness; paramsF32[50] = 0; paramsF32[51] = 0

      paramsU32[52] = capW; paramsU32[53] = capH; paramsU32[54] = renderW; paramsU32[55] = renderH
      paramsU32[56] = lastRenderW; paramsU32[57] = lastRenderH; paramsU32[58] = lightCount; paramsU32[59] = frameIdx
      paramsU32[60] = candidates; paramsU32[61] = maxTemporalM; paramsU32[62] = spatialNeighbors; paramsU32[63] = flags
      paramsU32[64] = clusterX; paramsU32[65] = clusterY; paramsU32[66] = clusterZ; paramsU32[67] = clusterPoolCap

      device.queue.writeBuffer(paramsBuffer, 0, paramsRaw)

      const currIdx = ping
      const gridBuf = input.cluster?.gridBuffer ?? dummyClusterGrid
      const idxBuf = input.cluster?.indexBuffer ?? dummyClusterIndices
      const aliasBuf = input.aliasBuffer ?? dummyAlias

      const risBgs = getRisBindGroups(
        input.lightsBuffer, gridBuf, idxBuf, aliasBuf,
        input.depth, input.normal, input.albedo, input.material,
      )
      const tempBgs = getTemporalBindGroups(input.lightsBuffer, input.velocity, input.albedo, input.material)
      const spatBgs = getSpatialBindGroups(input.lightsBuffer, input.albedo, input.material)

      const gx = (renderW + 7) >> 3
      const gy = (renderH + 7) >> 3

      // Pass 1: Initial RIS Candidate Sampling + 1 Visibility Ray + Geometry Snapshot.
      const p1 = encoder.beginComputePass(
        timing?.ris ? { label: 'restir-ris-initial', timestampWrites: timing.ris } : RIS_PASS_DESC,
      )
      p1.setPipeline(risPipe)
      p1.setBindGroup(0, risBgs[currIdx])
      if (hasOcclusionBgl && input.occlusionBindGroup) p1.setBindGroup(1, input.occlusionBindGroup)
      p1.dispatchWorkgroups(gx, gy)
      p1.end()

      // Pass 2: Temporal Reservoir Reuse (Motion Reprojection + Unbiased MIS).
      const p2 = encoder.beginComputePass(
        timing?.temporal ? { label: 'restir-temporal-reuse', timestampWrites: timing.temporal } : TEMPORAL_PASS_DESC,
      )
      p2.setPipeline(temporalPipe)
      p2.setBindGroup(0, tempBgs[currIdx])
      if (hasOcclusionBgl && input.occlusionBindGroup) p2.setBindGroup(1, input.occlusionBindGroup)
      p2.dispatchWorkgroups(gx, gy)
      p2.end()

      // Pass 3: Spatial Reservoir Reuse (Pairwise MIS + Visibility Check) + Final Linear HDR Shading.
      const runSceneDenoise = Boolean(sceneEval && denoiseTempPipe && denoiseAtrousPipe && denoiseCfgUbos && denoiseOutView)
      const p3Ts = runSceneDenoise
        ? (timing?.spatialShade?.beginningOfPassWriteIndex !== undefined
            ? { querySet: timing.spatialShade.querySet, beginningOfPassWriteIndex: timing.spatialShade.beginningOfPassWriteIndex }
            : undefined)
        : timing?.spatialShade
      const p3 = encoder.beginComputePass(
        p3Ts ? { label: 'restir-spatial-shade', timestampWrites: p3Ts } : SPATIAL_PASS_DESC,
      )
      p3.setPipeline(spatialPipe)
      p3.setBindGroup(0, spatBgs[currIdx])
      if (hasOcclusionBgl && input.occlusionBindGroup) p3.setBindGroup(1, input.occlusionBindGroup)
      p3.dispatchWorkgroups(gx, gy)
      p3.end()

      // Pass 4 (evalMode === 'scene' only): Fast temporal firefly-clamped EMA + 2-pass normal/depth
      // edge-stopping à-trous filter (steps 1, 2) eliminating 1-spp multi-light chromatic speckle
      // while preserving crisp 64-tree voxel shadows and zero wall light bleed.
      if (runSceneDenoise && denoiseTempPipe && denoiseAtrousPipe && denoiseCfgUbos) {
        const dbgs = getDenoiseBindGroups(input.velocity)
        if (dbgs) {
          denoiseCfgI32[0] = renderW; denoiseCfgI32[1] = renderH; denoiseCfgI32[2] = 1; denoiseCfgI32[3] = 0
          device.queue.writeBuffer(denoiseCfgUbos[0], 0, denoiseCfgI32)
          denoiseCfgI32[2] = 2
          device.queue.writeBuffer(denoiseCfgUbos[1], 0, denoiseCfgI32)

          const pt = encoder.beginComputePass({ label: 'restir-denoise-temp' })
          pt.setPipeline(denoiseTempPipe)
          pt.setBindGroup(0, dbgs.temp[currIdx])
          pt.dispatchWorkgroups(gx, gy)
          pt.end()

          const pa1 = encoder.beginComputePass({ label: 'restir-denoise-1' })
          pa1.setPipeline(denoiseAtrousPipe)
          pa1.setBindGroup(0, dbgs.a1[currIdx])
          pa1.dispatchWorkgroups(gx, gy)
          pa1.end()

          const endTs = timing?.spatialShade?.endOfPassWriteIndex !== undefined
            ? { querySet: timing.spatialShade.querySet, endOfPassWriteIndex: timing.spatialShade.endOfPassWriteIndex }
            : undefined
          const pa2 = encoder.beginComputePass(
            endTs ? { label: 'restir-denoise-2', timestampWrites: endTs } : { label: 'restir-denoise-2' },
          )
          pa2.setPipeline(denoiseAtrousPipe)
          pa2.setBindGroup(0, dbgs.a2[currIdx])
          pa2.dispatchWorkgroups(gx, gy)
          pa2.end()
        }
      }

      // Advance ping-pong & store camera state for next frame's temporal reprojection.
      ping = currIdx === 0 ? 1 : 0
      historyValid = true
      frames++
      lastRenderW = renderW
      lastRenderH = renderH
      lastLightCount = lightCount

      prevEyeX = cam.eye[0]; prevEyeY = cam.eye[1]; prevEyeZ = cam.eye[2]; prevTanHalf = cam.tanHalf
      prevFwdX = fwdX; prevFwdY = fwdY; prevFwdZ = fwdZ; prevAspect = cam.aspect
      prevRightX = rightX; prevRightY = rightY; prevRightZ = rightZ; prevNear = zNear
      prevUpX = upX; prevUpY = upY; prevUpZ = upZ; prevFar = zFar
      prevJitterX = jx; prevJitterY = jy

      return denoiseOutView ?? outputView
    },

    reset() {
      historyValid = false
    },

    stats() {
      return {
        reallocs,
        frames,
        resets,
        historyValid,
        capacity: [capW, capH],
        renderSize: [lastRenderW, lastRenderH],
        lightCount: lastLightCount,
        reservoirBytes: capW * capH * RESTIR_RESERVOIR_BYTES * 4,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      resInitial.destroy()
      resTemporal[0].destroy()
      resTemporal[1].destroy()
      resSpatial.destroy()
      geomTex[0].destroy()
      geomTex[1].destroy()
      outputTex.destroy()
      if (denoiseHistTex) { denoiseHistTex[0].destroy(); denoiseHistTex[1].destroy() }
      denoiseTmpTex?.destroy()
      denoiseOutTex?.destroy()
      if (denoiseCfgUbos) { denoiseCfgUbos[0].destroy(); denoiseCfgUbos[1].destroy() }
      paramsBuffer.destroy()
      dummyClusterGrid.destroy()
      dummyClusterIndices.destroy()
      dummyAlias.destroy()
      invalidateBindGroups()
    },
  }
}
