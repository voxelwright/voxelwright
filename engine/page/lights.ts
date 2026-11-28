// Unified dynamic local lights (vehicles, spinning robotaxi LiDAR domes, traffic signals, charging depots,
// fire/explosions/flames, portals, placed LAMP voxels, and real San Francisco street lamps) shared across
// march.ts, pieces.ts, people.ts, and wheels.ts.
//
// Performance design:
// - Dual-backend zero-GC architecture:
//   1. Compact 4,640-byte uniform buffer (fits in L1 constant cache) with an 8x8 horizontal XZ spatial tile
//      bitmask (64 bits per cell) holding the top 12 / 28 / 48 priority lights for pieces.ts, people.ts,
//      wheels.ts, puffs.ts, water.ts, and Low preset / fallback shading.
//   2. Optional 512-light GPU Compute 3D Frustum-Clustered backend (`lights-cluster.ts`, 16 x 9 x 24 = 3,456
//      clusters with logarithmic Z-slices) initialized via `initClustered()` and dispatched via `dispatchCluster()`,
//      separating skyscraper floors vertically and near/far streets in depth without CPU binning.
// - Zero-GC CPU frame packing using pre-allocated flat typed-array pools (zero per-frame JS object allocations).
// - Zero daytime GPU cost via WGSL `override NIGHT` + `override LOCAL_OCCLUDE` pipeline specialization in march.ts.
// - Scales across graphics presets:
//     low    (0): up to 12 lights (max 5 street, 3 extra), combined front beam, diffuse only.
//     medium (1): up to 28 lights (max 12 street, 8 extra), combined front beam, diffuse + clearcoat/wet specular.
//     high   (2): up to 48 lights (max 20 street, 14 extra), twin left+right headlights on nearby cars,
//                 diffuse + clearcoat specular + wet asphalt streaks + 2-tap level-1 world occlusion in march.ts
//                 (compiled only on High via LOCAL_OCCLUDE, skipped on mirror/through-pane rays and past 60 m).
import type { View } from './march.ts'
import type { FroxelFogPass } from './froxel-fog.ts'
import {
  CLUSTER_COUNT,
  CLUSTER_LIGHTS_WGSL,
  CLUSTER_X,
  CLUSTER_Y,
  CLUSTER_Z,
  DEFAULT_CLUSTER_Z_FAR,
  DEFAULT_CLUSTER_Z_NEAR,
  MAX_CLUSTER_LIGHTS,
  clusterLightsBindings,
  clusterZToDepth,
  createClusteredLights,
  depthToClusterZ,
  type ClusterCameraParams,
  type ClusterLightKind,
  type ClusterTimingWrites,
  type ClusteredLights,
  type ClusteredLightsStats,
} from './lights-cluster.ts'

export {
  CLUSTER_COUNT,
  CLUSTER_LIGHTS_WGSL,
  CLUSTER_X,
  CLUSTER_Y,
  CLUSTER_Z,
  DEFAULT_CLUSTER_Z_FAR,
  DEFAULT_CLUSTER_Z_NEAR,
  MAX_CLUSTER_LIGHTS,
  clusterLightsBindings,
  clusterZToDepth,
  depthToClusterZ,
}
export type { ClusterCameraParams, ClusterTimingWrites, ClusteredLights, ClusteredLightsStats }

export type LightQuality = 'low' | 'medium' | 'high'

export const MAX_LOCAL_LIGHTS = 64
const GRID_DIM = 8
const HEADER_FLOATS = 8 // grid(4) + info(4)
const CELLS_U32 = (GRID_DIM * GRID_DIM) * 2 // 64 cells * 2 u32 (64-bit mask each) = 128 u32 = 512 bytes
const LIGHT_FLOATS = 16 // 4 vec4f = 64 bytes per light
export const LIGHTS_BYTES = (HEADER_FLOATS + CELLS_U32 + MAX_LOCAL_LIGHTS * LIGHT_FLOATS) * 4

/** Light category codes for fair budget sharing across vehicles, street lamps, and world/FX emitters. */
export const LIGHT_CAR = 0
export const LIGHT_STREET = 1
export const LIGHT_EXTRA = 2
export type LightKind = typeof LIGHT_CAR | typeof LIGHT_STREET | typeof LIGHT_EXTRA

export interface LocalLightsStats {
  total: number
  car: number
  street: number
  extra: number
  quality: LightQuality
  budget: number
  /** Total lights staged into the 512-light GPU 3D frustum-clustered backend (0 when uninitialized). */
  clustered: number
}

/** Zero-GC per-frame sink passed to vehicles, pieces, puffs, portals, world edits, and SF street lamps. */
export interface LocalLightSink {
  readonly quality: LightQuality
  readonly dark: number
  readonly eyeX: number
  readonly eyeY: number
  readonly eyeZ: number
  readonly fwdX: number
  readonly fwdY: number
  readonly fwdZ: number
  /** Emits an omnidirectional point light (fire, LiDAR ring, portal, charging halo, placed lamp voxel). */
  addPoint(
    px: number, py: number, pz: number,
    cr: number, cg: number, cb: number,
    range: number, dHalf: number, spec: number,
    priority: number, kind?: LightKind,
  ): void
  /** Emits a directional cone/spot light (traffic signals, canopy downlights, rotating LiDAR aperture, backlit signs). */
  addSpot(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, dHalf: number, cosOuter: number, cosInner: number,
    focus: number, shadow: number, spec: number,
    priority: number, kind?: LightKind,
  ): void
  /** Emits headlights (low/high, twin on High), taillights/brakes, reverse, hazards, and boost glow for one vehicle. */
  addVehicle(
    bx: number, by: number, bz: number,
    fx: number, fy: number, fz: number,
    rx: number, ry: number, rz: number,
    ux: number, uy: number, uz: number,
    halfLen: number, halfWide: number, height: number,
    head: number, brake: number, rev: number, hazard: number, boost: number,
    player: boolean,
  ): void
  /** Emits nearby San Francisco street lamps `[x, y, z, ...]` extracted from `.bay` `SFST` trailers. */
  addStreetLamps(lamps: readonly number[], count?: number): void
}

export interface LocalLights extends LocalLightSink {
  readonly buffer: GPUBuffer
  readonly count: number
  readonly stats: LocalLightsStats
  /** Active 512-light GPU compute 3D frustum clustering backend, or `null` until `initClustered()` completes. */
  readonly clustered: ClusteredLights | null
  /** Total lights staged into the 3D clustered backend this frame (up to 512). */
  readonly clusterCount: number
  /** Fragment/compute bind group layout matching `clusterLightsBindings()` (0=params, 1=lights, 2=grid, 3=indices). */
  readonly clusterBindGroupLayout: GPUBindGroupLayout | null
  /** Bind group for `CLUSTER_LIGHTS_WGSL` evaluation in render or compute passes, or `null` until initialized. */
  readonly clusterBindGroup: GPUBindGroup | null
  /** Lazily creates (or returns the existing) 512-light GPU compute 3D frustum-clustered backend. */
  initClustered(maxLights?: number): Promise<ClusteredLights>
  /** Uploads staged lights (<= 512) and dispatches `cs_cluster_bounds` (dirty-cached) + `cs_cluster_cull`. */
  dispatchCluster(
    encoder: GPUCommandEncoder,
    view: View,
    aspect: number,
    zNear?: number,
    zFar?: number,
    timing?: ClusterTimingWrites,
  ): void
  /** Releases GPU buffers owned by the 3D clustered backend (no-op if uninitialized). */
  destroyClustered(): void
  /** Begins a frame of light collection. `anchor` must match march.ts (`Math.floor(eye / 64) * 64`). */
  beginFrame(
    view: View,
    anchorX: number, anchorY: number, anchorZ: number,
    quality: LightQuality,
    dark: number,
    wet: number,
  ): void
  /** Prioritizes collected lights into the preset budget, builds the 8x8 XZ tile bitmask, and uploads to the GPU. */
  finishFrame(): void
  /** Feeds up to `maxLights` (default 64) nearest prioritized local lights into a 3D froxel fog volume with zero GC. */
  feedFroxel(froxel: FroxelFogPass, maxLights?: number): void
  /** Clears all active lights (e.g. daytime with nothing active, space view, or `off.has('lights')`). */
  clear(): void
}

/** WGSL uniform struct definitions shared by march.ts, pieces.ts, people.ts, and wheels.ts. */
export const LOCAL_LIGHTS_STRUCT = /* wgsl */ `
struct LocalLight {
  // xyz: anchor-relative position (cells); w: 1 / (range * range)
  posRange: vec4f,
  // xyz: unit direction; w: cosOuter (< -1.5 for omnidirectional)
  dirCone: vec4f,
  // rgb: pre-multiplied linear colour/intensity; w: 1 / max(cosInner - cosOuter, 0.001)
  colSpot: vec4f,
  // x: 1 / (dHalf * dHalf), y: beam focus (0 smooth, 1 shaped dual-lobe headlight), z: shadowable (1 yes), w: specular boost
  shape: vec4f,
}
struct LocalLights {
  // xy: XZ origin of the 8x8 spatial grid (anchor-relative cells); z: 1 / gridCellSize; w: wet (0..1)
  grid: vec4f,
  // x: active light count; y: quality (0=low, 1=medium, 2=high); z: flags (bit 0 = occlusion); w: pad
  info: vec4u,
  // 8x8 spatial grid of 64-bit masks (two cells packed per vec4u -> 32 vec4u)
  cells: array<vec4u, 32>,
  items: array<LocalLight, ${MAX_LOCAL_LIGHTS}>,
}
`

/**
 * Generates the shared WGSL local-lighting evaluation helper.
 * When `withOcclusion` is true (march.ts), `worldClear(p, n, lPos)` is guarded by the WGSL `override LOCAL_OCCLUDE`
 * constant plus `allowOcc` (skipping mirror/through-pane rays where `shadows == 2u`) and `hitDist < 600.0` (60 m),
 * so Daytime, Low, and Medium pipelines compile out 100% of octree-probe code.
 * When `withWet` is true (march.ts), wet roads reflect elongated specular streaks from car lights and street lamps.
 */
export const localLightsEval = (opts: { withOcclusion?: boolean; withWet?: boolean } = {}) => /* wgsl */ `
fn localLightMask(p: vec3f) -> vec2u {
  let gxy = vec2i(floor((p.xz - localLights.grid.xy) * localLights.grid.z));
  if (gxy.x < 0 || gxy.x >= ${GRID_DIM} || gxy.y < 0 || gxy.y >= ${GRID_DIM}) { return vec2u(0u, 0u); }
  let idx = u32(gxy.y * ${GRID_DIM} + gxy.x);
  let packed = localLights.cells[idx >> 1u];
  return select(packed.xy, packed.zw, (idx & 1u) != 0u);
}

// Evaluates all local lights (vehicles, spinning LiDAR domes, traffic signals, depots, fire, portals, street lamps)
// overlapping the spatial tile containing anchor-relative point \`p\`.
// \`clearcoat\`: 0 for matte world/people, 1 for glossy car paint (adds sharp Blinn-Phong + Fresnel clearcoat sheen).
// \`wetGround\`: 0..1 on horizontal asphalt/paving in rain (adds shimmering specular road reflections).
fn evalLocalLights(p: vec3f, n: vec3f, rd: vec3f, albedo: vec3f, rough: f32, clearcoat: f32, wetGround: f32${opts.withOcclusion ? ', allowOcc: bool, hitDist: f32' : ''}) -> vec3f {
  if (localLights.info.x == 0u) { return vec3f(0.0); }
  let masks = localLightMask(p);
  if ((masks.x | masks.y) == 0u) { return vec3f(0.0); }
  let quality = localLights.info.y;
  ${opts.withOcclusion ? 'let occOn = LOCAL_OCCLUDE && allowOcc && hitDist < 600.0 && (localLights.info.z & 1u) != 0u;' : ''}
  var sum = vec3f(0.0);
  ${opts.withWet ? `let wet = wetGround * localLights.grid.w;
  let back = reflect(rd, vec3f(0.0, 1.0, 0.0));
  let side = normalize(vec2f(-rd.z, rd.x) + vec2f(0.00001, 0.0));` : ''}
  for (var word = 0u; word < 2u; word++) {
    var mask = select(masks.x, masks.y, word == 1u);
    let baseIdx = word * 32u;
    while (mask != 0u) {
      let bit = countTrailingZeros(mask);
      mask &= mask - 1u;
      let l = localLights.items[baseIdx + bit];
      let toL = l.posRange.xyz - p;
      let d2 = dot(toL, toL);
      let norm2 = d2 * l.posRange.w;
      if (norm2 >= 1.0) { continue; }
      let invD = inverseSqrt(max(d2, 4.0));
      let L = toL * invD;
      var spot = 1.0;
      if (l.dirCone.w > -1.5) {
        let cosA = dot(-L, l.dirCone.xyz);
        if (cosA <= l.dirCone.w) { continue; }
        let u = clamp((cosA - l.dirCone.w) * l.colSpot.w, 0.0, 1.0);
        let cone = u * u * (3.0 - 2.0 * u);
        // Dual-lobe automotive beam shaping: soft wide near-bumper scatter + crisp focused central headlight cone.
        spot = mix(cone, cone * (0.38 + 0.62 * cone * cone), l.shape.y);
      }
      // Smooth windowed inverse-square falloff (reaches exact 0 at range -> no boundary pop).
      let win = 1.0 - norm2 * norm2;
      let att = (win * win) / (1.0 + d2 * l.shape.x);
      let ndl = dot(n, L);
      if (ndl <= -0.04) { continue; }
      // Slight grazing retro-scatter exponent (0.72) so headlights 0.75 m above flat asphalt realistically light
      // aggregate road texture and crosswalk paint 10-30 m ahead while back-facing surfaces remain cleanly unlit.
      let diff = pow(max(ndl, 0.0), 0.72);
      var rad = l.colSpot.rgb * (att * spot);
      ${opts.withOcclusion ? `if (occOn && l.shape.z > 0.5 && (abs(n.y) < 0.5 || d2 > 10000.0) && d2 > 900.0 && (rad.r + rad.g + rad.b) * max(diff, 0.12) > 0.10) {
        let vis = worldClear(p, n, l.posRange.xyz);
        if (vis <= 0.01) { continue; }
        rad *= vis;
      }` : ''}
      sum += albedo * rad * diff;
      // Specular & clearcoat reflections on Medium/High: car paint, wet asphalt, metallic rims, leather.
      if (quality >= 1u && ndl > 0.0) {
        let hv = normalize(L - rd);
        let ndh = max(dot(n, hv), 0.0);
        if (clearcoat > 0.05) {
          let fres = 0.06 + 0.94 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 4.0);
          let sharp = pow(ndh, 64.0) * 0.28 + pow(ndh, 16.0) * 0.055;
          sum += rad * sharp * (0.35 + 0.75 * fres) * clearcoat * l.shape.w;
        } else {
          let smoothness = max(1.0 - rough, 0.0);
          let shininess = mix(8.0, 64.0, smoothness);
          let spec = pow(ndh, shininess) * smoothness * smoothness * 0.38;
          sum += rad * spec * l.shape.w;
        }
        ${opts.withWet ? `if (wet > 0.02) {
          // Elongated wet-asphalt reflection streak toward the eye for car lights, signals, and street lamps.
          let off = back - L;
          let across = dot(off.xz, side);
          let streak = exp(-across * across * 420.0 - max(dot(off, off) - across * across, 0.0) * 6.5);
          let sheen = pow(ndh, 24.0) * 0.22 + streak * 0.52;
          sum += rad * sheen * wet * l.shape.w * 0.65;
        }` : ''}
      }
    }
  }
  // Smooth highlight shoulder: zero loss on dark asphalt & red taillight pools (<= 0.12 linear), while compressing
  // close-range overlapping beams on high-albedo white vehicle paint so cars never blow out or glow neon coral-red.
  let peak = max(sum.r, max(sum.g, sum.b));
  return sum / (1.0 + max(peak - 0.12, 0.0) * 1.55);
}
`

const QUALITY_LEVEL: Record<LightQuality, number> = { low: 0, medium: 1, high: 2 }

/** Per-preset lighting budgets, guaranteed reserves, & ranges (cells; 10 cells = 1 m). */
const TIER: Record<LightQuality, {
  maxLights: number
  maxStreet: number
  maxExtra: number
  carReserve: number
  streetReserve: number
  extraReserve: number
  carReach: number
  streetReach: number
  extraReach: number
  twinReach: number
  gridCell: number
}> = {
  low: { maxLights: 12, maxStreet: 5, maxExtra: 3, carReserve: 6, streetReserve: 3, extraReserve: 2, carReach: 550, streetReach: 580, extraReach: 420, twinReach: 0, gridCell: 150 },
  medium: { maxLights: 28, maxStreet: 12, maxExtra: 8, carReserve: 14, streetReserve: 7, extraReserve: 6, carReach: 950, streetReach: 900, extraReach: 750, twinReach: 0, gridCell: 190 },
  high: { maxLights: 48, maxStreet: 20, maxExtra: 14, carReserve: 24, streetReserve: 12, extraReserve: 10, carReach: 1300, streetReach: 1150, extraReach: 1050, twinReach: 240, gridCell: 220 },
}

// Pre-allocated flat candidate pool (zero per-frame JS heap allocations).
const MAX_CANDIDATES = 512
const MAX_CLUSTER_CANDIDATES = 2048
const CAND_STRIDE = 16 // px,py,pz, dx,dy,dz, cr,cg,cb, range, dHalf, cosOuter, cosInner, focus, shadow, spec
const CLUSTER_CAND_STRIDE = 15 // px,py,pz, dx,dy,dz, cr,cg,cb, range, dHalf, cosOuter, cosInner, focus, shadow
/** World-space reach (cells) for the 512-light 3D frustum-clustered backend (400 m = DEFAULT_CLUSTER_Z_FAR). */
const CLUSTER_REACH = DEFAULT_CLUSTER_Z_FAR

/** Partial insertion/selection of top-K candidate indices by descending score (zero allocations). */
function selectTop(indices: Int32Array, count: number, scores: Float32Array, k: number): number {
  const n = Math.min(count, k)
  for (let i = 0; i < n; i++) {
    let best = i
    let bestS = scores[indices[i]]
    for (let j = i + 1; j < count; j++) {
      const s = scores[indices[j]]
      if (s > bestS) { bestS = s; best = j }
    }
    if (best !== i) {
      const tmp = indices[i]
      indices[i] = indices[best]
      indices[best] = tmp
    }
  }
  return n
}

/** O(N) average-time in-place quickselect placing the top-K highest-scoring indices in `indices[0..k)` (zero allocations). */
function partitionTopK(indices: Int32Array, count: number, scores: Float32Array, k: number): number {
  if (count <= k) return count
  let lo = 0, hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const pivot = scores[indices[mid]]
    let i = lo, j = hi
    while (i <= j) {
      while (scores[indices[i]] > pivot) i++
      while (scores[indices[j]] < pivot) j--
      if (i <= j) {
        const tmp = indices[i]
        indices[i] = indices[j]
        indices[j] = tmp
        i++; j--
      }
    }
    if (j >= k - 1) hi = j
    else if (i <= k - 1) lo = i
    else break
  }
  return k
}

export function createLocalLights(device: GPUDevice): LocalLights {
  const buffer = device.createBuffer({
    label: 'local lights',
    size: LIGHTS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const raw = new ArrayBuffer(LIGHTS_BYTES)
  const f32 = new Float32Array(raw)
  const u32 = new Uint32Array(raw)

  // Flat candidate storage reused every frame.
  const candF32 = new Float32Array(MAX_CANDIDATES * CAND_STRIDE)
  const candScore = new Float32Array(MAX_CANDIDATES)
  const candKind = new Uint8Array(MAX_CANDIDATES)
  const carIdx = new Int32Array(MAX_CANDIDATES)
  const streetIdx = new Int32Array(MAX_CANDIDATES)
  const extraIdx = new Int32Array(MAX_CANDIDATES)
  const mergedIdx = new Int32Array(MAX_CANDIDATES)

  let candCount = 0
  let carCandCount = 0
  let streetCandCount = 0
  let extraCandCount = 0

  let activeCount = 0
  let frameEyeX = 0, frameEyeY = 0, frameEyeZ = 0
  let frameFwdX = 0, frameFwdY = 0, frameFwdZ = -1
  let frameAncX = 0, frameAncY = 0, frameAncZ = 0
  let frameQuality: LightQuality = 'high'
  let frameTier = TIER.high
  let frameDark = 0
  let frameWet = 0
  let frameDayScale = 0.48

  // Optional 512-light GPU compute 3D frustum-clustered backend (lazily initialized via initClustered()).
  // Staged into a priority-scored candidate pool and top-K selected in finishFrame() so nearby/in-view lights
  // never pop or drop out in dense neighborhoods when >512 street lamps fall within CLUSTER_REACH.
  let clustered: ClusteredLights | null = null
  let clusterInitPromise: Promise<ClusteredLights> | null = null
  let clusterBindGroupLayout: GPUBindGroupLayout | null = null
  let clusterBindGroup: GPUBindGroup | null = null
  let clusterStagedCount = 0
  const clCandF32 = new Float32Array(MAX_CLUSTER_CANDIDATES * CLUSTER_CAND_STRIDE)
  const clCandScore = new Float32Array(MAX_CLUSTER_CANDIDATES)
  const clCandKind = new Uint8Array(MAX_CLUSTER_CANDIDATES)
  const clCandIdx = new Int32Array(MAX_CLUSTER_CANDIDATES)
  let clCandCount = 0

  // Pre-allocated mutable camera parameter struct reused every frame in dispatchCluster() (zero GC).
  const camEye: [number, number, number] = [0, 0, 0]
  const camFwd: [number, number, number] = [0, 0, -1]
  const camRight: [number, number, number] = [1, 0, 0]
  const camUp: [number, number, number] = [0, 1, 0]
  const clusterCam = {
    eye: camEye,
    forward: camFwd,
    right: camRight,
    up: camUp,
    tanHalf: 0.577350269,
    aspect: 16 / 9,
    zNear: DEFAULT_CLUSTER_Z_NEAR,
    zFar: DEFAULT_CLUSTER_Z_FAR,
  }

  const stats: LocalLightsStats = {
    total: 0,
    car: 0,
    street: 0,
    extra: 0,
    quality: 'high',
    budget: TIER.high.maxLights,
    clustered: 0,
  }

  const pushUniform = (
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, dHalf: number, cosOuter: number, cosInner: number,
    focus: number, shadow: number, spec: number,
    score: number, kind: LightKind,
  ) => {
    if (candCount >= MAX_CANDIDATES) return
    const i = candCount++
    const o = i * CAND_STRIDE
    candF32[o] = px; candF32[o + 1] = py; candF32[o + 2] = pz
    candF32[o + 3] = dx; candF32[o + 4] = dy; candF32[o + 5] = dz
    candF32[o + 6] = cr; candF32[o + 7] = cg; candF32[o + 8] = cb
    candF32[o + 9] = range; candF32[o + 10] = dHalf
    candF32[o + 11] = cosOuter; candF32[o + 12] = cosInner
    candF32[o + 13] = focus; candF32[o + 14] = shadow; candF32[o + 15] = spec
    candScore[i] = score
    candKind[i] = kind
    if (kind === LIGHT_CAR) carIdx[carCandCount++] = i
    else if (kind === LIGHT_STREET) streetIdx[streetCandCount++] = i
    else extraIdx[extraCandCount++] = i
  }

  // Stages a candidate for the 512-light 3D frustum-clustered backend with priority scoring so finishFrame()
  // selects the highest-priority lights (matching uniform-tier priority instead of arbitrary insertion order).
  const pushCluster = (
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, dHalf: number, cosOuter: number, cosInner: number,
    focus: number, shadow: number,
    score: number, kind: LightKind,
  ) => {
    if (clustered === null || clCandCount >= MAX_CLUSTER_CANDIDATES) return
    const i = clCandCount++
    const o = i * CLUSTER_CAND_STRIDE
    clCandF32[o + 0] = px; clCandF32[o + 1] = py; clCandF32[o + 2] = pz
    clCandF32[o + 3] = dx; clCandF32[o + 4] = dy; clCandF32[o + 5] = dz
    clCandF32[o + 6] = cr; clCandF32[o + 7] = cg; clCandF32[o + 8] = cb
    clCandF32[o + 9] = range; clCandF32[o + 10] = dHalf
    clCandF32[o + 11] = cosOuter; clCandF32[o + 12] = cosInner
    clCandF32[o + 13] = focus; clCandF32[o + 14] = shadow
    clCandScore[i] = score
    clCandKind[i] = kind
    clCandIdx[i] = i
  }

  const flushClusterCandidates = () => {
    if (clustered === null) { clusterStagedCount = 0; stats.clustered = 0; return }
    const count = clCandCount
    if (count === 0) { clusterStagedCount = 0; stats.clustered = 0; return }
    const take = partitionTopK(clCandIdx, count, clCandScore, clustered.maxLights)
    let staged = 0
    for (let i = 0; i < take; i++) {
      const ci = clCandIdx[i]
      const o = ci * CLUSTER_CAND_STRIDE
      const dHalf = clCandF32[o + 10]
      const scale = dHalf > 1 ? dHalf * dHalf : 1
      const r = clCandF32[o + 6] * scale
      const g = clCandF32[o + 7] * scale
      const b = clCandF32[o + 8] * scale
      const cosOuter = clCandF32[o + 11]
      const kind = clCandKind[ci] as ClusterLightKind
      const idx = cosOuter < -1.5
        ? clustered.addPoint(
            clCandF32[o + 0], clCandF32[o + 1], clCandF32[o + 2],
            r, g, b, clCandF32[o + 9], dHalf, clCandF32[o + 14], kind, clCandF32[o + 13],
          )
        : clustered.addSpot(
            clCandF32[o + 0], clCandF32[o + 1], clCandF32[o + 2],
            clCandF32[o + 3], clCandF32[o + 4], clCandF32[o + 5],
            r, g, b, clCandF32[o + 9], cosOuter, clCandF32[o + 12], dHalf, clCandF32[o + 14], kind, clCandF32[o + 13],
          )
      if (idx >= 0) staged++
    }
    clusterStagedCount = staged
    stats.clustered = staged
  }

  const pushEmit = (
    inUniform: boolean, inCluster: boolean,
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, dHalf: number, cosOuter: number, cosInner: number,
    focus: number, shadow: number, spec: number,
    score: number, kind: LightKind,
  ) => {
    if (inUniform) {
      pushUniform(px, py, pz, dx, dy, dz, cr, cg, cb, range, dHalf, cosOuter, cosInner, focus, shadow, spec, score, kind)
    }
    if (inCluster) {
      pushCluster(px, py, pz, dx, dy, dz, cr, cg, cb, range, dHalf, cosOuter, cosInner, focus, shadow, score, kind)
    }
  }

  const clearUniform = () => {
    if (activeCount === 0 && stats.total === 0) return
    activeCount = 0
    stats.total = 0; stats.car = 0; stats.street = 0; stats.extra = 0
    u32[4] = 0
    device.queue.writeBuffer(buffer, 0, raw, 0, 32)
  }

  const clear = () => {
    clearUniform()
    clCandCount = 0
    if (clustered !== null) {
      clustered.beginFrame(frameAncX, frameAncY, frameAncZ)
      clusterStagedCount = 0
      stats.clustered = 0
    }
  }

  const self: LocalLights = {
    buffer,
    get count() { return activeCount },
    stats,
    get clustered() { return clustered },
    get clusterCount() { return clusterStagedCount },
    get clusterBindGroupLayout() { return clusterBindGroupLayout },
    get clusterBindGroup() { return clusterBindGroup },
    get quality() { return frameQuality },
    get dark() { return frameDark },
    get eyeX() { return frameEyeX },
    get eyeY() { return frameEyeY },
    get eyeZ() { return frameEyeZ },
    get fwdX() { return frameFwdX },
    get fwdY() { return frameFwdY },
    get fwdZ() { return frameFwdZ },
    initClustered(maxLights = MAX_CLUSTER_LIGHTS) {
      if (clustered !== null) return Promise.resolve(clustered)
      if (clusterInitPromise !== null) return clusterInitPromise
      clusterInitPromise = createClusteredLights(device, maxLights).then((c) => {
        const bgl = device.createBindGroupLayout({
          label: 'local-lights-cluster-bgl',
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          ],
        })
        const bg = device.createBindGroup({
          label: 'local-lights-cluster-bg',
          layout: bgl,
          entries: [
            { binding: 0, resource: { buffer: c.paramsBuffer } },
            { binding: 1, resource: { buffer: c.lightsBuffer } },
            { binding: 2, resource: { buffer: c.clusterGridBuffer } },
            { binding: 3, resource: { buffer: c.lightIndexBuffer } },
          ],
        })
        c.beginFrame(frameAncX, frameAncY, frameAncZ)
        clustered = c
        clusterBindGroupLayout = bgl
        clusterBindGroup = bg
        clusterStagedCount = 0
        stats.clustered = 0
        return c
      }, (err) => {
        clusterInitPromise = null
        throw err
      })
      return clusterInitPromise
    },
    dispatchCluster(encoder, view, aspect, zNear = DEFAULT_CLUSTER_Z_NEAR, zFar = DEFAULT_CLUSTER_Z_FAR, timing) {
      if (clustered === null) return
      camEye[0] = view.eye[0]; camEye[1] = view.eye[1]; camEye[2] = view.eye[2]
      camFwd[0] = view.forward[0]; camFwd[1] = view.forward[1]; camFwd[2] = view.forward[2]
      camRight[0] = view.right[0]; camRight[1] = view.right[1]; camRight[2] = view.right[2]
      camUp[0] = view.up[0]; camUp[1] = view.up[1]; camUp[2] = view.up[2]
      clusterCam.tanHalf = view.tanHalf
      clusterCam.aspect = aspect
      clusterCam.zNear = zNear
      clusterCam.zFar = zFar
      clustered.dispatch(encoder, clusterCam, timing)
    },
    destroyClustered() {
      if (clustered !== null) {
        clustered.destroy()
        clustered = null
      }
      clusterInitPromise = null
      clusterBindGroupLayout = null
      clusterBindGroup = null
      clusterStagedCount = 0
      stats.clustered = 0
    },
    clear,
    beginFrame(view, anchorX, anchorY, anchorZ, quality, dark, wet) {
      candCount = 0
      carCandCount = 0
      streetCandCount = 0
      extraCandCount = 0
      clCandCount = 0
      clusterStagedCount = 0
      frameEyeX = view.eye[0]; frameEyeY = view.eye[1]; frameEyeZ = view.eye[2]
      frameFwdX = view.forward[0]; frameFwdY = view.forward[1]; frameFwdZ = view.forward[2]
      frameAncX = anchorX; frameAncY = anchorY; frameAncZ = anchorZ
      frameQuality = quality
      frameTier = TIER[quality]
      frameDark = dark
      frameWet = wet
      // Brake, hazard, flame & high-energy lights remain visible in daylight (0.48x), full strength at dusk/night.
      frameDayScale = 0.48 + 0.52 * Math.min(1, dark * 1.4)
      stats.quality = quality
      stats.budget = frameTier.maxLights
      stats.clustered = 0
      if (clustered !== null) {
        clustered.beginFrame(anchorX, anchorY, anchorZ)
      }
    },
    addPoint(px, py, pz, cr, cg, cb, range, dHalf, spec, priority, kind = LIGHT_EXTRA) {
      const vx = px - frameEyeX, vy = py - frameEyeY, vz = pz - frameEyeZ
      const dist = Math.hypot(vx, vy, vz)
      const reach = kind === LIGHT_CAR ? frameTier.carReach : kind === LIGHT_STREET ? frameTier.streetReach : frameTier.extraReach
      const inUniform = dist <= reach + range
      const inCluster = clustered !== null && dist <= CLUSTER_REACH + range
      if (!inUniform && !inCluster) return
      const ahead = vx * frameFwdX + vy * frameFwdY + vz * frameFwdZ
      if (ahead < -(range + 40)) return
      const inView = ahead > -30 ? 1.0 : 0.45
      const score = (priority / (1 + dist * 0.008)) * inView
      if (inUniform) {
        pushUniform(px, py, pz, 0, -1, 0, cr, cg, cb, range, dHalf, -2.0, -1.0, 0.0, 0.0, spec, score, kind)
      }
      if (inCluster) {
        pushCluster(px, py, pz, 0, -1, 0, cr, cg, cb, range, dHalf, -2.0, -1.0, 0.0, 0.0, score, kind)
      }
    },
    addSpot(px, py, pz, dx, dy, dz, cr, cg, cb, range, dHalf, cosOuter, cosInner, focus, shadow, spec, priority, kind = LIGHT_EXTRA) {
      const vx = px - frameEyeX, vy = py - frameEyeY, vz = pz - frameEyeZ
      const dist = Math.hypot(vx, vy, vz)
      const reach = kind === LIGHT_CAR ? frameTier.carReach : kind === LIGHT_STREET ? frameTier.streetReach : frameTier.extraReach
      const inUniform = dist <= reach + range
      const inCluster = clustered !== null && dist <= CLUSTER_REACH + range
      if (!inUniform && !inCluster) return
      const ahead = vx * frameFwdX + vy * frameFwdY + vz * frameFwdZ
      const facing = dx * frameFwdX + dy * frameFwdY + dz * frameFwdZ
      // Allow lights behind the camera if their cone points forward into the view.
      if (ahead < -50 && (dist > range + 60 || facing < 0.2)) return
      const inv = 1 / (Math.hypot(dx, dy, dz) || 1)
      const ndx = dx * inv, ndy = dy * inv, ndz = dz * inv
      const inView = ahead > -40 ? 1.0 : 0.45
      const score = (priority / (1 + dist * 0.008)) * inView
      if (inUniform) {
        pushUniform(px, py, pz, ndx, ndy, ndz, cr, cg, cb, range, dHalf, cosOuter, cosInner, focus, shadow, spec, score, kind)
      }
      if (inCluster) {
        pushCluster(px, py, pz, ndx, ndy, ndz, cr, cg, cb, range, dHalf, cosOuter, cosInner, focus, shadow, score, kind)
      }
    },
    addVehicle(
      bx, by, bz,
      fx, fy, fz,
      rx, ry, rz,
      ux, uy, uz,
      halfLen, halfWide, height,
      head, brake, rev, hazard, boost,
      player,
    ) {
      const vx = bx - frameEyeX, vy = by - frameEyeY, vz = bz - frameEyeZ
      const dist = Math.hypot(vx, vy, vz)
      const inUniform = player || dist <= frameTier.carReach
      const inCluster = clustered !== null && (player || dist <= CLUSTER_REACH)
      if (!Number.isFinite(dist) || (!inUniform && !inCluster)) return
      const ahead = vx * frameFwdX + vy * frameFwdY + vz * frameFwdZ
      const behind = ahead < -60
      const facingView = fx * frameFwdX + fz * frameFwdZ
      // Skip cars far behind the camera unless their forward beam shines into the view.
      if (!player && behind && (dist > 340 || facingView < 0.25)) return

      const lampY = Math.min(height * 0.44, 8.8)
      const tailY = Math.min(height * 0.50, 10.2)
      const baseScore = (player ? 1000 : 120) / (1 + dist * 0.008) * (behind ? 0.45 : 1.0)

      // 1. Headlights (low beam & high beam).
      if (head > 0.02) {
        const hi = Math.max(0, Math.min(1, head - 1.0))
        const low = Math.min(head, 1.0)
        const range = hi > 0.2 ? 480 : 300
        const dHalf = hi > 0.2 ? 96 : 68
        const pitchDown = hi > 0.2 ? 0.075 : 0.145
        const d0x = fx - ux * pitchDown, d0y = fy - uy * pitchDown, d0z = fz - uz * pitchDown
        const inv0 = 1 / (Math.hypot(d0x, d0y, d0z) || 1)
        const dx = d0x * inv0, dy = d0y * inv0, dz = d0z * inv0
        const fwdOff = halfLen + 1.4
        const useTwin = frameQuality === 'high' && (player || dist < frameTier.twinReach)
        const power = (low * 4.8 + hi * 3.8) * (useTwin ? 0.56 : 1.0)
        const cr = 1.0 * power
        const cg = (0.92 + 0.05 * hi) * power
        const cb = (0.76 + 0.15 * hi) * power
        const cosOuter = hi > 0.2 ? 0.50 : 0.46
        const cosInner = hi > 0.2 ? 0.93 : 0.90
        const spec = hi > 0.2 ? 1.45 : 1.15
        const basePx = bx + fx * fwdOff + ux * lampY
        const basePy = by + fy * fwdOff + uy * lampY
        const basePz = bz + fz * fwdOff + uz * lampY

        if (useTwin) {
          const latOff = Math.max(3.5, halfWide * 0.68)
          const sc = baseScore * (1.35 + hi * 0.35)
          for (let side = -1; side <= 1; side += 2) {
            const toe = side * 0.04
            const sx = dx + rx * toe, sy = dy + ry * toe, sz = dz + rz * toe
            const invS = 1 / (Math.hypot(sx, sy, sz) || 1)
            pushEmit(
              inUniform, inCluster,
              basePx + rx * (latOff * side), basePy + ry * (latOff * side), basePz + rz * (latOff * side),
              sx * invS, sy * invS, sz * invS,
              cr, cg, cb, range, dHalf, cosOuter, cosInner,
              1.0, 1.0, spec, sc, LIGHT_CAR,
            )
          }
        } else {
          pushEmit(
            inUniform, inCluster,
            basePx, basePy, basePz, dx, dy, dz,
            cr, cg, cb, range, dHalf, cosOuter, cosInner,
            1.0, 1.0, spec, baseScore * (1.3 + hi * 0.3), LIGHT_CAR,
          )
        }
      }

      // 2. Taillights & brake lights (rear crimson glow).
      const tailUniform = inUniform && (player || dist < Math.min(frameTier.carReach, 850))
      const tailCluster = inCluster && (player || dist < Math.min(CLUSTER_REACH, 2200))
      if ((head > 0.02 || brake > 0.04) && (tailUniform || tailCluster)) {
        const stop = Math.min(brake, 1.35)
        const tail = Math.min(head, 1.0)
        const braking = stop > 0.05
        const power = Math.max(tail * 2.2, stop * 4.6 * frameDayScale)
        if (power > 0.12) {
          const backOff = halfLen + 1.4
          const d0x = -fx - ux * 0.20, d0y = -fy - uy * 0.20, d0z = -fz - uz * 0.20
          const inv0 = 1 / (Math.hypot(d0x, d0y, d0z) || 1)
          pushEmit(
            tailUniform, tailCluster,
            bx - fx * backOff + ux * tailY, by - fy * backOff + uy * tailY, bz - fz * backOff + uz * tailY,
            d0x * inv0, d0y * inv0, d0z * inv0,
            1.0 * power, (braking ? 0.045 : 0.035) * power, 0.012 * power,
            braking ? 165 : 120, braking ? 44 : 34, 0.0, 0.68,
            0.0, 0.0, braking ? 1.25 : 1.0, baseScore * (braking ? 1.15 : 0.85), LIGHT_CAR,
          )
        }
      }

      // 3. Reverse lights (crisp cool white behind rear bumper).
      const revUniform = inUniform && (player || dist < 550)
      const revCluster = inCluster && (player || dist < 1200)
      if (rev > 0.05 && (revUniform || revCluster)) {
        const backOff = halfLen + 1.4
        const d0x = -fx - ux * 0.16, d0y = -fy - uy * 0.16, d0z = -fz - uz * 0.16
        const inv0 = 1 / (Math.hypot(d0x, d0y, d0z) || 1)
        const power = rev * 3.6
        pushEmit(
          revUniform, revCluster,
          bx - fx * backOff + ux * (tailY - 0.8), by - fy * backOff + uy * (tailY - 0.8), bz - fz * backOff + uz * (tailY - 0.8),
          d0x * inv0, d0y * inv0, d0z * inv0,
          0.92 * power, 0.96 * power, 1.0 * power,
          150, 42, 0.22, 0.80, 0.3, 0.0, 1.1, baseScore * 1.0, LIGHT_CAR,
        )
      }

      // 4. 4-way amber hazard blinkers (complements stuck robotaxi's amber roof LiDAR dome).
      const hazUniform = inUniform && (player || dist < 600)
      const hazCluster = inCluster && (player || dist < 1400)
      if (hazard > 0.05 && (hazUniform || hazCluster)) {
        const power = hazard * 1.25 * frameDayScale
        pushEmit(
          hazUniform, hazCluster,
          bx + ux * lampY, by + uy * lampY, bz + uz * lampY,
          0, -1, 0,
          1.0 * power, 0.28 * power, 0.01 * power,
          105, 34, -2.0, -1.0, 0.0, 0.0, 0.85, baseScore * 0.90, LIGHT_CAR,
        )
      }

      // 5. Nitrous boost exhaust glow (player boost).
      if (boost > 0.05) {
        const backOff = halfLen + 2.5
        const power = boost * 5.0
        pushEmit(
          inUniform, inCluster,
          bx - fx * backOff + ux * 4.5, by - fy * backOff + uy * 4.5, bz - fz * backOff + uz * 4.5,
          0, -1, 0,
          0.16 * power, 0.74 * power, 1.0 * power,
          155, 44, -2.0, -1.0, 0.0, 0.0, 1.2, baseScore * 1.4, LIGHT_CAR,
        )
      }
    },
    addStreetLamps(lamps, count = lamps.length) {
      if (frameDark <= 0.02 || count < 3) return
      const uniformReach = frameTier.streetReach
      const uniformReach2 = uniformReach * uniformReach
      const hasCluster = clustered !== null
      const maxReach = hasCluster ? Math.max(uniformReach, CLUSTER_REACH) : uniformReach
      const maxReach2 = maxReach * maxReach
      const power = 2.6 * Math.min(1, frameDark * 1.25)
      const cr = 1.0 * power, cg = 0.78 * power, cb = 0.48 * power
      for (let i = 0; i < count; i += 3) {
        const lx = lamps[i], ly = lamps[i + 1], lz = lamps[i + 2]
        const dx = lx - frameEyeX, dy = ly - frameEyeY, dz = lz - frameEyeZ
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > maxReach2) continue
        const ahead = dx * frameFwdX + dy * frameFwdY + dz * frameFwdZ
        if (ahead < -220) continue
        const dist = Math.sqrt(d2)
        const inView = ahead > -40 ? 1.0 : 0.4
        const score = (65 / (1 + dist * 0.008)) * inView
        if (d2 <= uniformReach2) {
          pushUniform(
            lx, ly - 1.5, lz, // just beneath the glowing luminaire hood
            0, -1, 0, cr, cg, cb,
            215, 82, -0.05, 0.58, 0.0, 0.0, 1.0,
            score, LIGHT_STREET,
          )
        }
        if (hasCluster) {
          pushCluster(
            lx, ly - 1.5, lz,
            0, -1, 0, cr, cg, cb,
            215, 82, -0.05, 0.58, 0.0, 0.0,
            score, LIGHT_STREET,
          )
        }
      }
    },
    finishFrame() {
      flushClusterCandidates()
      if (candCount === 0) { clearUniform(); return }

      // Fair per-category reservations so dense traffic/depots never starve street lamps, signals, canopies, or LiDAR domes,
      // while redistributing any unused reserve slots to the highest-scoring remaining lights across all categories.
      const capCar = selectTop(carIdx, carCandCount, candScore, frameTier.maxLights)
      const capStreet = selectTop(streetIdx, streetCandCount, candScore, frameTier.maxStreet)
      const capExtra = selectTop(extraIdx, extraCandCount, candScore, frameTier.maxExtra)
      const takeCar = Math.min(capCar, frameTier.carReserve)
      const takeStreet = Math.min(capStreet, frameTier.streetReserve)
      const takeExtra = Math.min(capExtra, frameTier.extraReserve)

      let n = 0
      for (let i = 0; i < takeCar; i++) mergedIdx[n++] = carIdx[i]
      for (let i = 0; i < takeStreet; i++) mergedIdx[n++] = streetIdx[i]
      for (let i = 0; i < takeExtra; i++) mergedIdx[n++] = extraIdx[i]

      let spare = 0
      const overflowBase = n
      for (let i = takeCar; i < capCar; i++) mergedIdx[overflowBase + spare++] = carIdx[i]
      for (let i = takeStreet; i < capStreet; i++) mergedIdx[overflowBase + spare++] = streetIdx[i]
      for (let i = takeExtra; i < capExtra; i++) mergedIdx[overflowBase + spare++] = extraIdx[i]

      const room = frameTier.maxLights - n
      if (room > 0 && spare > 0) {
        const extraTake = Math.min(room, spare)
        for (let i = 0; i < extraTake; i++) {
          let best = overflowBase + i
          let bestS = candScore[mergedIdx[best]]
          for (let j = i + 1; j < spare; j++) {
            const s = candScore[mergedIdx[overflowBase + j]]
            if (s > bestS) { bestS = s; best = overflowBase + j }
          }
          if (best !== overflowBase + i) {
            const tmp = mergedIdx[overflowBase + i]
            mergedIdx[overflowBase + i] = mergedIdx[best]
            mergedIdx[best] = tmp
          }
        }
        n += extraTake
      }

      if (n === 0) { clearUniform(); return }
      activeCount = n

      // 8x8 XZ spatial grid centered ahead of the camera so visible street space gets full grid coverage.
      const cellSize = frameTier.gridCell
      const halfSpan = (GRID_DIM * cellSize) * 0.5
      const fl = Math.hypot(frameFwdX, frameFwdZ) || 1
      const bias = cellSize * 1.15
      const gridOrigX = (frameEyeX - frameAncX) + (frameFwdX / fl) * bias - halfSpan
      const gridOrigZ = (frameEyeZ - frameAncZ) + (frameFwdZ / fl) * bias - halfSpan
      const invCell = 1 / cellSize

      f32[0] = gridOrigX
      f32[1] = gridOrigZ
      f32[2] = invCell
      f32[3] = frameWet
      u32[4] = n
      u32[5] = QUALITY_LEVEL[frameQuality]
      u32[6] = frameQuality === 'high' ? 1 : 0
      u32[7] = 0

      // Clear 8x8 spatial tile 64-bit masks.
      u32.fill(0, HEADER_FLOATS, HEADER_FLOATS + CELLS_U32)

      let carN = 0, streetN = 0, extraN = 0
      const itemsBase = HEADER_FLOATS + CELLS_U32
      for (let i = 0; i < n; i++) {
        const ci = mergedIdx[i]
        const o = ci * CAND_STRIDE
        const k = candKind[ci]
        if (k === LIGHT_CAR) carN++
        else if (k === LIGHT_STREET) streetN++
        else extraN++

        const px = candF32[o] - frameAncX
        const py = candF32[o + 1] - frameAncY
        const pz = candF32[o + 2] - frameAncZ
        const dx = candF32[o + 3], dy = candF32[o + 4], dz = candF32[o + 5]
        const range = candF32[o + 9]
        const dHalf = candF32[o + 10]
        const cosOuter = candF32[o + 11]
        const cosInner = candF32[o + 12]

        const dst = itemsBase + i * LIGHT_FLOATS
        f32[dst + 0] = px; f32[dst + 1] = py; f32[dst + 2] = pz; f32[dst + 3] = 1 / Math.max(range * range, 1)
        f32[dst + 4] = dx; f32[dst + 5] = dy; f32[dst + 6] = dz; f32[dst + 7] = cosOuter
        f32[dst + 8] = candF32[o + 6]; f32[dst + 9] = candF32[o + 7]; f32[dst + 10] = candF32[o + 8]
        f32[dst + 11] = 1 / Math.max(cosInner - cosOuter, 0.001)
        f32[dst + 12] = 1 / Math.max(dHalf * dHalf, 1)
        f32[dst + 13] = candF32[o + 13]
        f32[dst + 14] = candF32[o + 14]
        f32[dst + 15] = candF32[o + 15]

        // Tight horizontal XZ footprint for directional spotlights (avoids wasting tile bits behind headlights).
        let minX = px - range, maxX = px + range, minZ = pz - range, maxZ = pz + range
        if (cosOuter > 0.15) {
          const sinA = Math.sqrt(Math.max(0, 1 - cosOuter * cosOuter))
          const tipX = px + dx * range, tipZ = pz + dz * range
          const pad = range * sinA + 18
          minX = Math.min(px - 18, tipX - pad)
          maxX = Math.max(px + 18, tipX + pad)
          minZ = Math.min(pz - 18, tipZ - pad)
          maxZ = Math.max(pz + 18, tipZ + pad)
        }
        const gx0 = Math.max(0, Math.floor((minX - gridOrigX) * invCell))
        const gx1 = Math.min(GRID_DIM - 1, Math.floor((maxX - gridOrigX) * invCell))
        const gz0 = Math.max(0, Math.floor((minZ - gridOrigZ) * invCell))
        const gz1 = Math.min(GRID_DIM - 1, Math.floor((maxZ - gridOrigZ) * invCell))
        const word = i >>> 5
        const bit = (1 << (i & 31)) >>> 0
        for (let gz = gz0; gz <= gz1; gz++) {
          let cellOff = HEADER_FLOATS + (gz * GRID_DIM + gx0) * 2 + word
          for (let gx = gx0; gx <= gx1; gx++, cellOff += 2) {
            u32[cellOff] = (u32[cellOff] | bit) >>> 0
          }
        }
      }

      stats.total = n; stats.car = carN; stats.street = streetN; stats.extra = extraN
      // Upload header + 8x8 tile masks + active lights only (never copies unused tail slots).
      device.queue.writeBuffer(buffer, 0, raw, 0, (itemsBase + n * LIGHT_FLOATS) * 4)
    },
    feedFroxel(froxel, maxLights = 64) {
      froxel.beginLights()
      if (activeCount <= 0) return
      const limit = Math.min(activeCount, Math.max(0, maxLights))
      for (let i = 0; i < limit; i++) {
        const ci = mergedIdx[i]
        const o = ci * CAND_STRIDE
        const kind = candKind[ci]
        const px = candF32[o], py = candF32[o + 1], pz = candF32[o + 2]
        const dx = candF32[o + 3], dy = candF32[o + 4], dz = candF32[o + 5]
        const cr = candF32[o + 6], cg = candF32[o + 7], cb = candF32[o + 8]
        const range = candF32[o + 9]
        const dHalf = candF32[o + 10]
        const cosOuter = candF32[o + 11]
        const cosInner = candF32[o + 12]
        const isHeadlight = kind === LIGHT_CAR && cosOuter > 0.3
        const aniso = isHeadlight ? 0.72 : kind === LIGHT_CAR ? 0.56 : kind === LIGHT_STREET ? 0.50 : 0.45
        const volScale = isHeadlight ? 1.45 : kind === LIGHT_CAR ? 0.72 : kind === LIGHT_STREET ? 0.85 : 0.95
        if (cosOuter < -1.5) {
          froxel.addPoint(px, py, pz, cr, cg, cb, range, dHalf, aniso, volScale)
        } else {
          froxel.addSpot(px, py, pz, dx, dy, dz, cr, cg, cb, range, cosOuter, cosInner, dHalf, aniso, volScale)
        }
      }
    },
  }
  return self
}
