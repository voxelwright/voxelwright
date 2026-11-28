// Standalone GPU Compute 3D Frustum Light Clustering (#165).
//
// Bins up to 512+ dynamic point & spot lights on the GPU into a 16 x 9 x 24 (3,456 clusters)
// 3D view-frustum grid with logarithmic Z-slices, zero CPU binning overhead, and zero per-frame
// JS heap allocations:
//   Pass 1 (cs_cluster_bounds): builds view-space AABBs for all 3,456 frustum clusters (dirty-cached
//          on projection changes: tanHalf, aspect, zNear, zFar).
//   Pass 2 (cs_cluster_cull): cooperatively batches lights into workgroup shared memory, transforms
//          into positive-forward view space (+X right, +Y up, +Z forward), performs exact
//          sphere-vs-AABB + tight spherical-sector spot culling, and compacts matching light indices
//          into a global atomic index pool with strict overflow guards.
//
// Units: 1 cell = 0.1 m (10 cells = 1 m), matching engine/page/lights.ts, march.ts, and probe/gpu.ts.
// Screen UV: (0, 0) top-left -> (1, 1) bottom-right, matching march.ts, fog.ts, and sky-lut.ts.
import { shader } from '../probe/gpu.ts'

export type ClusterVec3 = readonly [number, number, number]

export const CLUSTER_X = 16
export const CLUSTER_Y = 9
export const CLUSTER_Z = 24
export const CLUSTER_COUNT = CLUSTER_X * CLUSTER_Y * CLUSTER_Z

export const MAX_CLUSTER_LIGHTS = 512
export const MAX_SUPPORTED_CLUSTER_LIGHTS = 1024
export const MAX_LIGHTS_PER_CLUSTER = 64
export const CLUSTER_INDEX_POOL_SIZE = CLUSTER_COUNT * 32
export const CLUSTER_LIGHT_BYTES = 64

/** Default clustered depth bounds in cells (5 cells = 0.5 m, 4000 cells = 400 m). */
export const DEFAULT_CLUSTER_Z_NEAR = 5.0
export const DEFAULT_CLUSTER_Z_FAR = 4000.0

/** Light category codes matching engine/page/lights.ts. */
export const CLUSTER_LIGHT_CAR = 0
export const CLUSTER_LIGHT_STREET = 1
export const CLUSTER_LIGHT_EXTRA = 2
export type ClusterLightKind =
  | typeof CLUSTER_LIGHT_CAR
  | typeof CLUSTER_LIGHT_STREET
  | typeof CLUSTER_LIGHT_EXTRA

/** Sentinel `spotCosOuter` value for omnidirectional point lights (matches lights.ts `< -1.5`). */
const POINT_COS_OUTER = -2.0
const POINT_COS_INNER = -1.0

const PARAMS_BYTES = 28 * 4 // 7 x vec4 (112 bytes)
const LIGHT_FLOATS = 16 // 4 x vec4f (64 bytes)
const AABB_BYTES = 32 // 2 x vec4f (minPoint, maxPoint)
const CELL_BYTES = 8 // 2 x u32 (offset, count)
const COUNTER_BYTES = 16 // 4 x atomic<u32> (globalOffset, overflows, maxPerCluster, activeClusters)

const WG_X = 4
const WG_Y = 4
const WG_Z = 4
const DISPATCH_X = Math.ceil(CLUSTER_X / WG_X)
const DISPATCH_Y = Math.ceil(CLUSTER_Y / WG_Y)
const DISPATCH_Z = Math.ceil(CLUSTER_Z / WG_Z)

/**
 * Exact logarithmic depth-to-Z-slice mapping (matching WGSL `depthToClusterZ`).
 * `linearDepth` is positive forward distance along the camera view axis in cells.
 */
export function depthToClusterZ(
  linearDepth: number,
  zNear = DEFAULT_CLUSTER_Z_NEAR,
  zFar = DEFAULT_CLUSTER_Z_FAR,
): number {
  if (linearDepth <= zNear) return 0
  if (linearDepth >= zFar) return CLUSTER_Z - 1
  const scale = CLUSTER_Z / Math.log(zFar / zNear)
  const slice = Math.floor(Math.log(linearDepth / zNear) * scale)
  return Math.max(0, Math.min(CLUSTER_Z - 1, slice))
}

/**
 * Exact inverse of `depthToClusterZ`: returns the near-plane depth (cells) of slice boundary `slice`
 * in `[0, CLUSTER_Z]`, matching WGSL `clusterZToDepth`.
 */
export function clusterZToDepth(
  slice: number,
  zNear = DEFAULT_CLUSTER_Z_NEAR,
  zFar = DEFAULT_CLUSTER_Z_FAR,
): number {
  return zNear * Math.pow(zFar / zNear, slice / CLUSTER_Z)
}

export interface ClusterCameraParams {
  /** Camera eye position in world space (cells). Anchor passed to `beginFrame()` is subtracted automatically. */
  readonly eye: ClusterVec3
  /** Unit camera forward direction (Y-up world space). */
  readonly forward: ClusterVec3
  /** Unit camera right direction (Y-up world space). */
  readonly right: ClusterVec3
  /** Unit camera up direction (Y-up world space). */
  readonly up: ClusterVec3
  /** Tangent of half vertical field of view (`Math.tan(fovY / 2)`). */
  readonly tanHalf: number
  /** Viewport aspect ratio (`width / height`). */
  readonly aspect: number
  /** Near depth of cluster slice 0 in cells (default: 5.0 = 0.5 m). */
  readonly zNear?: number
  /** Far depth of cluster slice CLUSTER_Z in cells (default: 4000.0 = 400 m). */
  readonly zFar?: number
}

export interface ClusterTimingWrites {
  readonly bounds?: GPUComputePassTimestampWrites
  readonly cull?: GPUComputePassTimestampWrites
}

export interface ClusteredLightsStats {
  readonly lightCount: number
  readonly pointCount: number
  readonly spotCount: number
  readonly maxLights: number
  readonly clusterCount: number
  readonly indexPoolCapacity: number
  readonly boundsDispatches: number
  readonly cullDispatches: number
}

export interface ClusteredLights {
  readonly maxLights: number
  readonly indexPoolCapacity: number
  readonly paramsBuffer: GPUBuffer
  readonly lightsBuffer: GPUBuffer
  readonly clusterBoundsBuffer: GPUBuffer
  readonly clusterGridBuffer: GPUBuffer
  readonly lightIndexBuffer: GPUBuffer
  readonly counterBuffer: GPUBuffer
  /** Begins a zero-GC frame of light staging. Optional `anchor` matches march.ts chunk anchoring. */
  beginFrame(anchorX?: number, anchorY?: number, anchorZ?: number): void
  /** Stages an omnidirectional point light. Returns its slot index, or -1 if full. */
  addPoint(
    px: number, py: number, pz: number,
    r: number, g: number, b: number,
    radius: number,
    sourceRadius?: number,
    shadowId?: number,
    kind?: ClusterLightKind,
    flags?: number,
  ): number
  /** Stages a directional spot light. Returns its slot index, or -1 if full. */
  addSpot(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    r: number, g: number, b: number,
    radius: number,
    cosOuter: number,
    cosInner: number,
    sourceRadius?: number,
    shadowId?: number,
    kind?: ClusterLightKind,
    flags?: number,
  ): number
  /** Uploads staged lights to `lightsBuffer` (called automatically by `dispatch()` if not already called). */
  upload(queue?: GPUQueue): void
  /** Runs dirty-cached `cs_cluster_bounds` (if projection changed) and `cs_cluster_cull` on `encoder`. */
  dispatch(encoder: GPUCommandEncoder, cameraParams: ClusterCameraParams, timing?: ClusterTimingWrites): void
  /** Forces `cs_cluster_bounds` to recompute on the next `dispatch()`. */
  invalidateBounds(): void
  /** Returns current frame light counts and cumulative compute dispatch counts. */
  stats(): ClusteredLightsStats
  /** Releases all GPU buffers owned by this clustering module. */
  destroy(): void
}

/**
 * Generates standard WGSL resource bindings for `CLUSTER_LIGHTS_WGSL` in the chosen bind group.
 * Consumers (`march-shade.ts`, etc.) may call this or declare the four identifiers
 * (`clusterParams`, `clusterLights`, `clusterGrid`, `clusterLightIndices`) at custom slots.
 */
export function clusterLightsBindings(group = 1, baseBinding = 0): string {
  return /* wgsl */ `
@group(${group}) @binding(${baseBinding}) var<uniform> clusterParams: ClusterParams;
@group(${group}) @binding(${baseBinding + 1}) var<storage, read> clusterLights: array<ClusterLight>;
@group(${group}) @binding(${baseBinding + 2}) var<storage, read> clusterGrid: array<ClusterCell>;
@group(${group}) @binding(${baseBinding + 3}) var<storage, read> clusterLightIndices: array<u32>;
`
}

const SHARED_STRUCTS_WGSL = /* wgsl */ `
struct ClusterParams {
  // xyz: anchor-relative camera eye (cells), w: tanHalf
  eyeTanHalf: vec4f,
  // xyz: unit camera forward, w: aspect
  fwdAspect: vec4f,
  // xyz: unit camera right, w: zNear (cells)
  rightNear: vec4f,
  // xyz: unit camera up, w: zFar (cells)
  upFar: vec4f,
  // x: zScale = CLUSTER_Z / log(zFar / zNear), y: 1 / CLUSTER_X, z: 1 / CLUSTER_Y, w: f32(CLUSTER_Z)
  sliceParams: vec4f,
  // x: active lightCount, y: maxLightsPerCluster, z: indexPoolCapacity, w: clusterCount
  counts: vec4u,
  // x: CLUSTER_X, y: CLUSTER_Y, z: CLUSTER_Z, w: pad
  dims: vec4u,
}

struct ClusterLight {
  // xyz: anchor-relative world position (cells), w: radius (cells)
  posRange: vec4f,
  // rgb: linear HDR radiance, w: spotCosOuter (< -1.5 for omnidirectional point light)
  colorType: vec4f,
  // xyz: unit spot direction (world space), w: spotCosInner
  dirInner: vec4f,
  // x: sourceRadius (cells), y: shadowId / occludeFlag, z: kind, w: flags / pad
  extra: vec4f,
}

struct ClusterCell {
  offset: u32,
  count: u32,
}
`

/**
 * Reusable WGSL 3D clustered light lookup & energy-conserving GGX PBR evaluation library
 * ready for drop-in integration into `march-shade.ts` (Wave 2C).
 *
 * Expects bindings `clusterParams`, `clusterLights`, `clusterGrid`, and `clusterLightIndices`
 * (see `clusterLightsBindings()`).
 */
export const CLUSTER_LIGHTS_WGSL = /* wgsl */ `
${SHARED_STRUCTS_WGSL}

const CLUSTER_PI: f32 = 3.14159265359;
const CLUSTER_INV_PI: f32 = 0.31830988618;

// Logarithmic depth -> Z-slice index in [0, CLUSTER_Z - 1]. Exact match with TS depthToClusterZ.
fn depthToClusterZ(linearDepth: f32) -> u32 {
  let zNear = clusterParams.rightNear.w;
  let zFar = clusterParams.upFar.w;
  if (linearDepth <= zNear) { return 0u; }
  if (linearDepth >= zFar) { return clusterParams.dims.z - 1u; }
  let slice = floor(log(linearDepth / zNear) * clusterParams.sliceParams.x);
  return u32(clamp(slice, 0.0, f32(clusterParams.dims.z - 1u)));
}

// Exact inverse of depthToClusterZ: depth (cells) of slice boundary in [0, CLUSTER_Z].
fn clusterZToDepth(slice: f32) -> f32 {
  let zNear = clusterParams.rightNear.w;
  let zFar = clusterParams.upFar.w;
  return zNear * pow(zFar / zNear, slice / clusterParams.sliceParams.w);
}

// Screen UV in [0, 1]^2 (top-left origin) and positive linear depth -> (cx, cy, cz).
fn clusterCoordFor(uv: vec2f, linearDepth: f32) -> vec3u {
  let cx = u32(clamp(floor(uv.x * f32(clusterParams.dims.x)), 0.0, f32(clusterParams.dims.x - 1u)));
  let cy = u32(clamp(floor(uv.y * f32(clusterParams.dims.y)), 0.0, f32(clusterParams.dims.y - 1u)));
  let cz = depthToClusterZ(linearDepth);
  return vec3u(cx, cy, cz);
}

// Flat 3D cluster index for screen UV in [0, 1]^2 and positive linear depth (cells).
fn clusterIndexFor(uv: vec2f, linearDepth: f32) -> u32 {
  let c = clusterCoordFor(uv, linearDepth);
  return (c.z * clusterParams.dims.y + c.y) * clusterParams.dims.x + c.x;
}

// Single-light energy-conserving GGX + Schlick Fresnel + smooth distance windowing:
//   att = pow(saturate(1 - (d/r)^4), 2) / (d^2 + 1)
fn evalClusterLightGGX(
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
  let D = a2 / max(CLUSTER_PI * denomD * denomD, 1e-7);

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

  // Energy-conserving Lambertian diffuse + microfacet specular
  let kD = (vec3f(1.0) - F) * (1.0 - m);
  let diffuse = kD * albedo * CLUSTER_INV_PI;
  let specular = (D * Vis) * F;

  let radiance = light.colorType.rgb * (att * spot);
  return (diffuse + specular) * radiance * NdotL;
}

// Evaluates all clustered lights affecting the 3D frustum cluster at (uv, linearDepth).
fn evalClusteredLightsGGX(
  worldPos: vec3f,
  normal: vec3f,
  viewDir: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
  uv: vec2f,
  linearDepth: f32,
) -> vec3f {
  if (clusterParams.counts.x == 0u || linearDepth <= 0.0 || linearDepth > clusterParams.upFar.w) {
    return vec3f(0.0);
  }
  let idx = clusterIndexFor(uv, linearDepth);
  let cell = clusterGrid[idx];
  if (cell.count == 0u) {
    return vec3f(0.0);
  }
  let N = normalize(normal);
  let V = normalize(viewDir);
  var sum = vec3f(0.0);
  let endIdx = min(cell.offset + cell.count, clusterParams.counts.z);
  for (var i = cell.offset; i < endIdx; i++) {
    let lightIdx = clusterLightIndices[i];
    sum += evalClusterLightGGX(clusterLights[lightIdx], worldPos, N, V, albedo, roughness, metallic);
  }
  return sum;
}
`

const CLUSTER_BOUNDS_WGSL = /* wgsl */ `
${SHARED_STRUCTS_WGSL}

struct ClusterAabb {
  minPoint: vec4f,
  maxPoint: vec4f,
}

@group(0) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(1) var<storage, read_write> clusterBounds: array<ClusterAabb>;

@compute @workgroup_size(${WG_X}, ${WG_Y}, ${WG_Z})
fn cs_cluster_bounds(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= clusterParams.dims.x || gid.y >= clusterParams.dims.y || gid.z >= clusterParams.dims.z) {
    return;
  }

  let tanHalf = clusterParams.eyeTanHalf.w;
  let aspect = clusterParams.fwdAspect.w;
  let zNear = clusterParams.rightNear.w;
  let zFar = clusterParams.upFar.w;
  let invX = clusterParams.sliceParams.y;
  let invY = clusterParams.sliceParams.z;
  let slices = clusterParams.sliceParams.w;

  // Screen UV bounds (top-left origin): u in [0, 1] -> ndcX in [-1, 1], v in [0, 1] -> ndcY in [1, -1].
  let u0 = f32(gid.x) * invX;
  let u1 = f32(gid.x + 1u) * invX;
  let v0 = f32(gid.y) * invY;
  let v1 = f32(gid.y + 1u) * invY;

  let ndcX0 = u0 * 2.0 - 1.0;
  let ndcX1 = u1 * 2.0 - 1.0;
  let ndcYTop = 1.0 - v0 * 2.0;
  let ndcYBot = 1.0 - v1 * 2.0;

  let ratio = zFar / zNear;
  let z0 = zNear * pow(ratio, f32(gid.z) / slices);
  let z1 = zNear * pow(ratio, f32(gid.z + 1u) / slices);

  let scaleX = tanHalf * aspect;
  let minX = min(ndcX0 * z0, ndcX0 * z1) * scaleX;
  let maxX = max(ndcX1 * z0, ndcX1 * z1) * scaleX;
  let minY = min(ndcYBot * z0, ndcYBot * z1) * tanHalf;
  let maxY = max(ndcYTop * z0, ndcYTop * z1) * tanHalf;

  let idx = (gid.z * clusterParams.dims.y + gid.y) * clusterParams.dims.x + gid.x;
  clusterBounds[idx] = ClusterAabb(
    vec4f(minX, minY, z0, 0.0),
    vec4f(maxX, maxY, z1, 0.0),
  );
}
`

const CLUSTER_CULL_WGSL = /* wgsl */ `
${SHARED_STRUCTS_WGSL}

struct ClusterAabb {
  minPoint: vec4f,
  maxPoint: vec4f,
}

@group(0) @binding(0) var<uniform> clusterParams: ClusterParams;
@group(0) @binding(1) var<storage, read> clusterBounds: array<ClusterAabb>;
@group(0) @binding(2) var<storage, read> clusterLights: array<ClusterLight>;
@group(0) @binding(3) var<storage, read_write> clusterGrid: array<ClusterCell>;
@group(0) @binding(4) var<storage, read_write> clusterLightIndices: array<u32>;
// [0] globalAllocatedIndices, [1] overflowClusters, [2] maxLightsPerClusterSeen, [3] nonEmptyClusters
@group(0) @binding(5) var<storage, read_write> clusterCounters: array<atomic<u32>, 4>;

const BATCH_SIZE: u32 = 64u;
const MAX_LOCAL: u32 = ${MAX_LIGHTS_PER_CLUSTER}u;
const BOUND_EPS: f32 = 1e-3;

// 3 * 64 * 16 B = 3,072 B workgroup storage (well below 16 KB guaranteed WebGPU limit).
var<workgroup> sharedSphere: array<vec4f, 64>;
var<workgroup> sharedApex: array<vec4f, 64>;
var<workgroup> sharedDir: array<vec4f, 64>;

@compute @workgroup_size(${WG_X}, ${WG_Y}, ${WG_Z})
fn cs_cluster_cull(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) lid: u32,
) {
  let inBounds = gid.x < clusterParams.dims.x
    && gid.y < clusterParams.dims.y
    && gid.z < clusterParams.dims.z;
  let clusterIdx = (gid.z * clusterParams.dims.y + gid.y) * clusterParams.dims.x + gid.x;

  var aabbMin = vec3f(0.0);
  var aabbMax = vec3f(0.0);
  var boxCenter = vec3f(0.0);
  var boxRadius = 0.0;
  if (inBounds) {
    let b = clusterBounds[clusterIdx];
    aabbMin = b.minPoint.xyz;
    aabbMax = b.maxPoint.xyz;
    boxCenter = (aabbMin + aabbMax) * 0.5;
    boxRadius = length(aabbMax - boxCenter);
  }

  let lightCount = clusterParams.counts.x;
  let maxPerCluster = min(clusterParams.counts.y, MAX_LOCAL);

  var localIndices: array<u32, ${MAX_LIGHTS_PER_CLUSTER}>;
  var count: u32 = 0u;
  var overflowed: bool = false;

  let eye = clusterParams.eyeTanHalf.xyz;
  let fwd = clusterParams.fwdAspect.xyz;
  let right = clusterParams.rightNear.xyz;
  let up = clusterParams.upFar.xyz;

  // Uniform batch loop: every invocation in the workgroup participates in loads and barriers.
  for (var batchStart = 0u; batchStart < lightCount; batchStart += BATCH_SIZE) {
    let batchCount = min(BATCH_SIZE, lightCount - batchStart);
    if (lid < batchCount) {
      let l = clusterLights[batchStart + lid];
      let rel = l.posRange.xyz - eye;
      let apexView = vec3f(dot(rel, right), dot(rel, up), dot(rel, fwd));
      let radius = max(l.posRange.w, 0.0);
      let cosOuter = l.colorType.w;

      var centerView = apexView;
      var boundR = radius;
      var dirView = vec3f(0.0, 0.0, 1.0);
      var sinOuter = 0.0;

      // Exact minimal bounding sphere of the spherical-sector spotlight volume (zero false negatives).
      if (cosOuter > 0.0) {
        let dWorld = l.dirInner.xyz;
        dirView = vec3f(dot(dWorld, right), dot(dWorld, up), dot(dWorld, fwd));
        sinOuter = sqrt(max(1.0 - cosOuter * cosOuter, 0.0));
        if (cosOuter >= 0.70710678) {
          let dist = radius / (2.0 * cosOuter);
          centerView = apexView + dirView * dist;
          boundR = dist;
        } else {
          centerView = apexView + dirView * (radius * cosOuter);
          boundR = radius * sinOuter;
        }
      }

      sharedSphere[lid] = vec4f(centerView, boundR + BOUND_EPS);
      sharedApex[lid] = vec4f(apexView, cosOuter);
      sharedDir[lid] = vec4f(dirView, sinOuter);
    }
    workgroupBarrier();

    if (inBounds) {
      for (var i = 0u; i < batchCount; i++) {
        let sph = sharedSphere[i];
        let center = sph.xyz;
        let r = sph.w;
        // Fast Z-slab rejection
        if (center.z + r < aabbMin.z || center.z - r > aabbMax.z) { continue; }
        // Exact sphere-vs-AABB squared distance test
        let closest = clamp(center, aabbMin, aabbMax);
        let diff = center - closest;
        if (dot(diff, diff) > r * r) { continue; }

        // Conservative cone-vs-cluster-circumsphere test for forward spotlights (cosOuter > 0)
        let apex = sharedApex[i];
        let cosOuter = apex.w;
        if (cosOuter > 0.0) {
          let dirSin = sharedDir[i];
          let v = boxCenter - apex.xyz;
          let vLenSq = dot(v, v);
          let v1 = dot(v, dirSin.xyz);
          if (v1 < -(boxRadius + BOUND_EPS)) { continue; }
          let perp = sqrt(max(vLenSq - v1 * v1, 0.0));
          let distToCone = cosOuter * perp - v1 * dirSin.w;
          if (distToCone > boxRadius + BOUND_EPS) { continue; }
        }

        if (count < maxPerCluster) {
          localIndices[count] = batchStart + i;
          count += 1u;
        } else {
          overflowed = true;
        }
      }
    }
    workgroupBarrier();
  }

  if (!inBounds) { return; }

  var offset: u32 = 0u;
  var writeCount: u32 = 0u;
  if (count > 0u) {
    let poolCap = clusterParams.counts.z;
    offset = atomicAdd(&clusterCounters[0], count);
    if (offset < poolCap) {
      writeCount = min(count, poolCap - offset);
      for (var j = 0u; j < writeCount; j++) {
        clusterLightIndices[offset + j] = localIndices[j];
      }
      if (writeCount < count) {
        overflowed = true;
      }
    } else {
      offset = poolCap;
      writeCount = 0u;
      overflowed = true;
    }
    atomicMax(&clusterCounters[2], writeCount);
    atomicAdd(&clusterCounters[3], 1u);
  }
  if (overflowed) {
    atomicAdd(&clusterCounters[1], 1u);
  }
  clusterGrid[clusterIdx] = ClusterCell(offset, writeCount);
}
`

export async function createClusteredLights(
  device: GPUDevice,
  maxLights = MAX_CLUSTER_LIGHTS,
): Promise<ClusteredLights> {
  const clampedMaxLights = Math.max(1, Math.min(MAX_SUPPORTED_CLUSTER_LIGHTS, Math.floor(maxLights)))
  const indexPoolCapacity = clampedMaxLights > MAX_CLUSTER_LIGHTS
    ? CLUSTER_COUNT * MAX_LIGHTS_PER_CLUSTER
    : CLUSTER_INDEX_POOL_SIZE

  const [boundsMod, cullMod] = await Promise.all([
    shader(device, 'lights-cluster-bounds', CLUSTER_BOUNDS_WGSL),
    shader(device, 'lights-cluster-cull', CLUSTER_CULL_WGSL),
  ])

  const boundsLayout = device.createBindGroupLayout({
    label: 'lights-cluster-bounds-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const cullLayout = device.createBindGroupLayout({
    label: 'lights-cluster-cull-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })

  const [boundsPipe, cullPipe] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'lights-cluster-bounds',
      layout: device.createPipelineLayout({ bindGroupLayouts: [boundsLayout] }),
      compute: { module: boundsMod, entryPoint: 'cs_cluster_bounds' },
    }),
    device.createComputePipelineAsync({
      label: 'lights-cluster-cull',
      layout: device.createPipelineLayout({ bindGroupLayouts: [cullLayout] }),
      compute: { module: cullMod, entryPoint: 'cs_cluster_cull' },
    }),
  ])

  const paramsBuffer = device.createBuffer({
    label: 'lights-cluster-params',
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const lightsBuffer = device.createBuffer({
    label: 'lights-cluster-lights',
    size: clampedMaxLights * CLUSTER_LIGHT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const clusterBoundsBuffer = device.createBuffer({
    label: 'lights-cluster-bounds-aabbs',
    size: CLUSTER_COUNT * AABB_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const clusterGridBuffer = device.createBuffer({
    label: 'lights-cluster-grid',
    size: CLUSTER_COUNT * CELL_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const lightIndexBuffer = device.createBuffer({
    label: 'lights-cluster-indices',
    size: indexPoolCapacity * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const counterBuffer = device.createBuffer({
    label: 'lights-cluster-counters',
    size: COUNTER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })

  const boundsBindGroup = device.createBindGroup({
    label: 'lights-cluster-bounds-bg',
    layout: boundsLayout,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: clusterBoundsBuffer } },
    ],
  })
  const cullBindGroup = device.createBindGroup({
    label: 'lights-cluster-cull-bg',
    layout: cullLayout,
    entries: [
      { binding: 0, resource: { buffer: paramsBuffer } },
      { binding: 1, resource: { buffer: clusterBoundsBuffer } },
      { binding: 2, resource: { buffer: lightsBuffer } },
      { binding: 3, resource: { buffer: clusterGridBuffer } },
      { binding: 4, resource: { buffer: lightIndexBuffer } },
      { binding: 5, resource: { buffer: counterBuffer } },
    ],
  })

  // Zero-GC pre-allocated CPU staging buffers.
  const stagedRaw = new ArrayBuffer(clampedMaxLights * CLUSTER_LIGHT_BYTES)
  const stagedF32 = new Float32Array(stagedRaw)
  const paramsRaw = new ArrayBuffer(PARAMS_BYTES)
  const paramsF32 = new Float32Array(paramsRaw)
  const paramsU32 = new Uint32Array(paramsRaw)

  let stagedCount = 0
  let pointCount = 0
  let spotCount = 0
  let anchorX = 0
  let anchorY = 0
  let anchorZ = 0
  let lightsDirty = true

  let boundsDirty = true
  let cachedTanHalf = NaN
  let cachedAspect = NaN
  let cachedZNear = NaN
  let cachedZFar = NaN
  let boundsDispatches = 0
  let cullDispatches = 0
  let destroyed = false

  const upload = (queue: GPUQueue = device.queue): void => {
    if (destroyed) return
    if (stagedCount > 0) {
      queue.writeBuffer(lightsBuffer, 0, stagedF32, 0, stagedCount * LIGHT_FLOATS)
    }
    lightsDirty = false
  }

  return {
    maxLights: clampedMaxLights,
    indexPoolCapacity,
    paramsBuffer,
    lightsBuffer,
    clusterBoundsBuffer,
    clusterGridBuffer,
    lightIndexBuffer,
    counterBuffer,

    beginFrame(ax = 0, ay = 0, az = 0) {
      stagedCount = 0
      pointCount = 0
      spotCount = 0
      anchorX = ax
      anchorY = ay
      anchorZ = az
      lightsDirty = true
    },

    addPoint(
      px, py, pz,
      r, g, b,
      radius,
      sourceRadius = 0,
      shadowId = 0,
      kind = CLUSTER_LIGHT_EXTRA,
      flags = 0,
    ) {
      if (stagedCount >= clampedMaxLights || !(radius > 0)) return -1
      const idx = stagedCount++
      pointCount++
      const o = idx * LIGHT_FLOATS
      stagedF32[o + 0] = px - anchorX
      stagedF32[o + 1] = py - anchorY
      stagedF32[o + 2] = pz - anchorZ
      stagedF32[o + 3] = radius
      stagedF32[o + 4] = r
      stagedF32[o + 5] = g
      stagedF32[o + 6] = b
      stagedF32[o + 7] = POINT_COS_OUTER
      stagedF32[o + 8] = 0
      stagedF32[o + 9] = -1
      stagedF32[o + 10] = 0
      stagedF32[o + 11] = POINT_COS_INNER
      stagedF32[o + 12] = sourceRadius
      stagedF32[o + 13] = shadowId
      stagedF32[o + 14] = kind
      stagedF32[o + 15] = flags
      lightsDirty = true
      return idx
    },

    addSpot(
      px, py, pz,
      dx, dy, dz,
      r, g, b,
      radius,
      cosOuter,
      cosInner,
      sourceRadius = 0,
      shadowId = 0,
      kind = CLUSTER_LIGHT_EXTRA,
      flags = 0,
    ) {
      if (stagedCount >= clampedMaxLights || !(radius > 0)) return -1
      const invLen = 1 / (Math.hypot(dx, dy, dz) || 1)
      const cOut = Math.max(-1.0, Math.min(0.9999, cosOuter))
      const cIn = Math.max(cOut + 1e-4, Math.min(1.0, cosInner))
      const idx = stagedCount++
      spotCount++
      const o = idx * LIGHT_FLOATS
      stagedF32[o + 0] = px - anchorX
      stagedF32[o + 1] = py - anchorY
      stagedF32[o + 2] = pz - anchorZ
      stagedF32[o + 3] = radius
      stagedF32[o + 4] = r
      stagedF32[o + 5] = g
      stagedF32[o + 6] = b
      stagedF32[o + 7] = cOut
      stagedF32[o + 8] = dx * invLen
      stagedF32[o + 9] = dy * invLen
      stagedF32[o + 10] = dz * invLen
      stagedF32[o + 11] = cIn
      stagedF32[o + 12] = sourceRadius
      stagedF32[o + 13] = shadowId
      stagedF32[o + 14] = kind
      stagedF32[o + 15] = flags
      lightsDirty = true
      return idx
    },

    upload,

    dispatch(encoder, cameraParams, timing) {
      if (destroyed) return
      if (lightsDirty) upload(device.queue)

      const zNear = Math.max(1e-3, cameraParams.zNear ?? DEFAULT_CLUSTER_Z_NEAR)
      const zFar = Math.max(zNear + 1.0, cameraParams.zFar ?? DEFAULT_CLUSTER_Z_FAR)
      const tanHalf = cameraParams.tanHalf
      const aspect = cameraParams.aspect
      const zScale = CLUSTER_Z / Math.log(zFar / zNear)

      // Orthonormalize / normalize camera basis defensively.
      const fl = Math.hypot(cameraParams.forward[0], cameraParams.forward[1], cameraParams.forward[2]) || 1
      const rl = Math.hypot(cameraParams.right[0], cameraParams.right[1], cameraParams.right[2]) || 1
      const ul = Math.hypot(cameraParams.up[0], cameraParams.up[1], cameraParams.up[2]) || 1

      paramsF32[0] = cameraParams.eye[0] - anchorX
      paramsF32[1] = cameraParams.eye[1] - anchorY
      paramsF32[2] = cameraParams.eye[2] - anchorZ
      paramsF32[3] = tanHalf
      paramsF32[4] = cameraParams.forward[0] / fl
      paramsF32[5] = cameraParams.forward[1] / fl
      paramsF32[6] = cameraParams.forward[2] / fl
      paramsF32[7] = aspect
      paramsF32[8] = cameraParams.right[0] / rl
      paramsF32[9] = cameraParams.right[1] / rl
      paramsF32[10] = cameraParams.right[2] / rl
      paramsF32[11] = zNear
      paramsF32[12] = cameraParams.up[0] / ul
      paramsF32[13] = cameraParams.up[1] / ul
      paramsF32[14] = cameraParams.up[2] / ul
      paramsF32[15] = zFar
      paramsF32[16] = zScale
      paramsF32[17] = 1 / CLUSTER_X
      paramsF32[18] = 1 / CLUSTER_Y
      paramsF32[19] = CLUSTER_Z
      paramsU32[20] = stagedCount
      paramsU32[21] = MAX_LIGHTS_PER_CLUSTER
      paramsU32[22] = indexPoolCapacity
      paramsU32[23] = CLUSTER_COUNT
      paramsU32[24] = CLUSTER_X
      paramsU32[25] = CLUSTER_Y
      paramsU32[26] = CLUSTER_Z
      paramsU32[27] = 0

      device.queue.writeBuffer(paramsBuffer, 0, paramsRaw)

      const projChanged =
        boundsDirty
        || Math.abs(tanHalf - cachedTanHalf) > 1e-6
        || Math.abs(aspect - cachedAspect) > 1e-6
        || Math.abs(zNear - cachedZNear) > 1e-6
        || Math.abs(zFar - cachedZFar) > 1e-6

      if (projChanged) {
        const bPass = encoder.beginComputePass(
          timing?.bounds ? { label: 'lights-cluster-bounds', timestampWrites: timing.bounds } : { label: 'lights-cluster-bounds' },
        )
        bPass.setPipeline(boundsPipe)
        bPass.setBindGroup(0, boundsBindGroup)
        bPass.dispatchWorkgroups(DISPATCH_X, DISPATCH_Y, DISPATCH_Z)
        bPass.end()
        cachedTanHalf = tanHalf
        cachedAspect = aspect
        cachedZNear = zNear
        cachedZFar = zFar
        boundsDirty = false
        boundsDispatches++
      }

      // Reset atomic counters in-order on the GPU command stream right before culling.
      encoder.clearBuffer(counterBuffer, 0, COUNTER_BYTES)

      const cPass = encoder.beginComputePass(
        timing?.cull ? { label: 'lights-cluster-cull', timestampWrites: timing.cull } : { label: 'lights-cluster-cull' },
      )
      cPass.setPipeline(cullPipe)
      cPass.setBindGroup(0, cullBindGroup)
      cPass.dispatchWorkgroups(DISPATCH_X, DISPATCH_Y, DISPATCH_Z)
      cPass.end()
      cullDispatches++
    },

    invalidateBounds() {
      boundsDirty = true
    },

    stats() {
      return {
        lightCount: stagedCount,
        pointCount,
        spotCount,
        maxLights: clampedMaxLights,
        clusterCount: CLUSTER_COUNT,
        indexPoolCapacity,
        boundsDispatches,
        cullDispatches,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      paramsBuffer.destroy()
      lightsBuffer.destroy()
      clusterBoundsBuffer.destroy()
      clusterGridBuffer.destroy()
      lightIndexBuffer.destroy()
      counterBuffer.destroy()
    },
  }
}
