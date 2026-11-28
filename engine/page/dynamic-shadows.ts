// Standalone, zero-GC WebGPU Dynamic-Object Directional Shadow Map Engine (#165).
//
// Renders moving bodies — vehicles (`pieces.ts`), pedestrians (`people.ts`), wheels,
// falling chunks, and debris — into a 2-cascade texel-snapped orthographic directional
// shadow map (`1024 x 1024 x 2`, `depth32float`) so dynamic objects cast crisp, shimmer-free
// sun shadows onto the static world and onto each other:
//   - Cascade 0 (near): 480 cells (48 m) radius around the eye
//   - Cascade 1 (mid):  1600 cells (160 m) radius around the eye
//   - Texel snapping in light-space (U, V, S) prevents edge crawl & shimmer during smooth driving
//   - Depth-only instanced OBB/proxy box caster pipeline (up to 2,048 boxes in 1 draw call)
//   - Depth-only rigid triangle-list mesh caster (`drawMesh`) + `pieces.ts` merged-face caster (`drawPieceFaces`)
//   - Safari-safe `DYNAMIC_SHADOW_WGSL` sampling library using `textureSampleCompareLevel`
//     (safe inside branches & loops per `raw-webgpu/SKILL.md`), 4-tap rotated PCF with
//     hardware bilinear comparison filtering, normal-offset receiver bias, and smooth cascade cross-fade
//
// Units: 1 cell = 0.1 m (10 cells = 1 m), Y-up world space, `sunDir` pointing toward the sun
// (matching `sun.ts`, `pieces.ts`, `march.ts`).
import { shader } from '../probe/gpu.ts'

export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number]

export const DEFAULT_SHADOW_RESOLUTION = 1024
export const SHADOW_CASCADE_COUNT = 2 as const
export const DEFAULT_CASCADE_RADII: readonly [number, number] = [480, 1600]
export const DEFAULT_CASCADE_DEPTH_HALVES: readonly [number, number] = [2400, 4800]
export const MAX_BOX_CASTERS = 2048
export const MAX_MESH_DRAWS = 1024

/** Float stride per OBB caster in the GPU storage buffer (`center`, `halfExtents`, `quat`). */
const BOX_FLOATS = 12
const BOX_BYTES = BOX_FLOATS * 4 // 48 bytes
/** Uniform block size for `DynShadowUniforms` (3 header vec4 + 2 cascades * 4 vec4 = 176 bytes). */
const UNIFORM_FLOATS = 44
const UNIFORM_BYTES = UNIFORM_FLOATS * 4
/** Per-mesh transform uniform payload (`posScaleX`, `quat`, `comScaleY`, `scaleZPad` = 64 bytes). */
const MESH_PAYLOAD_FLOATS = 16
const MESH_PAYLOAD_BYTES = MESH_PAYLOAD_FLOATS * 4

export interface DynamicShadowOptions {
  /** Half-width/height of Cascade 0 and Cascade 1 in world cells (default `[480, 1600]`, i.e. 48 m and 160 m). */
  readonly cascadeRadii?: readonly [number, number]
  /** Half-depth span along the sun ray for each cascade in world cells (default `[2400, 4800]`). */
  readonly cascadeDepthHalves?: readonly [number, number]
  /** Maximum instanced OBB box casters per frame (default `2048`). */
  readonly maxBoxCasters?: number
  /** Maximum rigid mesh / piece draws across both cascades per frame (default `1024`). */
  readonly maxMeshDraws?: number
  /** PCF kernel radius in shadow-map texels (default `1.25`). */
  readonly pcfRadiusTexels?: number
  /** Fraction of Cascade 0's outer radius used to smoothly cross-fade into Cascade 1 (default `0.15`). */
  readonly cascadeBlendFraction?: number
  /** Fraction of Cascade 1's outer radius used to smoothly fade to lit `1.0` (default `0.12`). */
  readonly outerFadeFraction?: number
  /** Base normal-offset receiver bias in texels (default `0.25`). */
  readonly normalBiasBase?: number
  /** Grazing-angle normal-offset receiver bias in texels (default `0.65`). */
  readonly normalBiasSlope?: number
  /** Light-space constant depth bias in texels (default `0.35`). */
  readonly depthBiasTexels?: number
}

export interface DynamicShadowStats {
  readonly resolution: number
  readonly cascades: 2
  readonly active: boolean
  readonly boxCasters: number
  readonly meshDraws: number
  readonly texelSizes: readonly [number, number]
  readonly cascadeRadii: readonly [number, number]
  readonly snappedOrigins: readonly [readonly [number, number, number], readonly [number, number, number]]
  readonly sunDir: readonly [number, number, number]
}

export type DynamicMeshDrawCallback = (pass: GPURenderPassEncoder, cascade: 0 | 1) => void

export interface DynamicShadows {
  readonly resolution: number
  readonly cascadeCount: 2
  readonly cascadeRadii: readonly [number, number]
  readonly maxBoxCasters: number
  readonly maxMeshDraws: number
  readonly shadowTexture: GPUTexture
  /** 2D array depth view (`depth32float`, 2 layers) for binding in receiver shaders. */
  readonly shadowTextureView: GPUTextureView
  /** Individual 2D layer views for Cascade 0 and Cascade 1 render targets. */
  readonly cascadeViews: readonly [GPUTextureView, GPUTextureView]
  /** Hardware linear comparison sampler (`less-equal`) for `textureSampleCompareLevel` PCF. */
  readonly compareSampler: GPUSampler
  /** Uniform buffer matching `DynShadowUniforms` in `DYNAMIC_SHADOW_WGSL`. */
  readonly uniformBuffer: GPUBuffer
  /** Updates texel-snapped orthographic cascade transforms from the camera eye and sun direction (pointing toward sun). */
  updateView(eye: Vec3, sunDir: Vec3): void
  /** Resets per-frame dynamic caster counts with zero allocations. */
  beginFrame(): void
  /** Queues an oriented bounding box caster (world cells, unit quaternion `[x, y, z, w]`). Returns false if capacity is full. */
  addBoxCaster(center: Vec3, halfExtents: Vec3, quat?: Quat): boolean
  /** Zero-allocation scalar overload for queuing an oriented box caster in hot simulation loops. */
  addBoxCasterRaw(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    qx?: number, qy?: number, qz?: number, qw?: number,
  ): boolean
  /** Begins a depth-only shadow render pass for one cascade (clears depth to `1.0`). */
  beginCascadePass(
    encoder: GPUCommandEncoder,
    cascade: 0 | 1,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): GPURenderPassEncoder
  /** Draws all queued OBB box casters into the active cascade pass in 1 instanced draw call. */
  drawBoxCasters(pass: GPURenderPassEncoder, cascade: 0 | 1): void
  /**
   * Draws a rigid triangle-list mesh (`float32x3` local vertex positions, stride 12 bytes)
   * into the active cascade pass using a dynamic-offset transform slot.
   */
  drawMesh(
    pass: GPURenderPassEncoder,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
    worldPos: Vec3,
    quat?: Quat,
    scale?: number | Vec3,
  ): void
  /**
   * Draws a `pieces.ts` merged-face buffer (`arrayStride: 24`, instanced triangle-strip quads)
   * directly into the active cascade pass without repacking vertex data.
   */
  drawPieceFaces(
    pass: GPURenderPassEncoder,
    faceBuffer: GPUBuffer,
    faceCount: number,
    worldPos: Vec3,
    quat: Quat,
    com: Vec3,
    cell?: number,
  ): void
  /**
   * Uploads active casters and renders both cascades into the shadow map array.
   * When no box casters are queued and `drawMeshes` is omitted, skips both passes and marks the
   * shadow map inactive so `sampleDynamicSunShadow` early-outs to `1.0`.
   */
  render(
    encoder: GPUCommandEncoder,
    drawMeshes?: DynamicMeshDrawCallback,
    timestampWrites?: GPURenderPassTimestampWrites | readonly (GPURenderPassTimestampWrites | undefined)[],
  ): void
  /** Current frame statistics and snapped cascade metadata. */
  stats(): DynamicShadowStats
  /** Releases all GPU textures and buffers owned by this shadow map instance. */
  destroy(): void
}

/**
 * Generates WGSL bindings for `DYNAMIC_SHADOW_WGSL`:
 *   - `@binding(start + 0)` `dynShadow`: `var<uniform> DynShadowUniforms`
 *   - `@binding(start + 1)` `dynShadowTex`: `texture_depth_2d_array`
 *   - `@binding(start + 2)` `dynShadowCmp`: `sampler_comparison`
 */
export function dynamicShadowBindings(group: number, startBinding = 0): string {
  return /* wgsl */ `
@group(${group}) @binding(${startBinding}) var<uniform> dynShadow: DynShadowUniforms;
@group(${group}) @binding(${startBinding + 1}) var dynShadowTex: texture_depth_2d_array;
@group(${group}) @binding(${startBinding + 2}) var dynShadowCmp: sampler_comparison;
`
}

/**
 * Shared WGSL struct definitions for cascade projection (used by caster & receiver shaders).
 */
const DYN_SHADOW_STRUCTS_WGSL = /* wgsl */ `
struct DynShadowCascade {
  // xyz: texel-snapped world origin (cells), w: 1.0 / radius
  originInvR: vec4f,
  // xyz: light-space right axis U, w: texelSize (cells)
  axisUTexel: vec4f,
  // xyz: light-space up axis V, w: 1.0 / (2.0 * depthHalf)
  axisVInvDepth: vec4f,
  // xyz: light-space toward-sun axis S, w: depthHalf (cells)
  axisSDepthHalf: vec4f,
}

struct DynShadowUniforms {
  // x: active (1.0 active, 0.0 empty), y: resolution, z: invResolution, w: cascadeBlendFraction
  params: vec4f,
  // xyz: unit sun direction (toward sun), w: pcfRadiusTexels
  sunPcf: vec4f,
  // x: normalBiasBase (texels), y: normalBiasSlope (texels), z: depthBiasTexels, w: outerFadeFraction
  biasParams: vec4f,
  cascades: array<DynShadowCascade, 2>,
}
`

/**
 * Reusable Safari-safe WGSL sampling library for dynamic-object directional shadows.
 *
 * Requires `dynamicShadowBindings(group, startBinding)` in the host shader module.
 * Uses `textureSampleCompareLevel` (explicitly verified Safari-safe inside branches & loops)
 * with a deterministic 4-tap rotated-grid PCF kernel (each tap hardware 2x2 bilinear PCF),
 * normal-offset receiver bias, and smooth Cascade 0 -> Cascade 1 cross-fade.
 *
 * Exports:
 *   - `sampleDynamicSunShadow(worldPos: vec3f, worldNormal: vec3f) -> f32`
 *     Returns `1.0` (fully lit) to `0.0` (in dynamic shadow); combine with static sun shadows
 *     as `min(staticSunShadow, sampleDynamicSunShadow(worldPos, worldNormal))`.
 */
export const DYNAMIC_SHADOW_WGSL = /* wgsl */ `
${DYN_SHADOW_STRUCTS_WGSL}

// Deterministic 4-tap rotated-grid PCF offsets (N-Queens pattern; world-stable across camera moves).
const DYN_SHADOW_PCF = array<vec2f, 4>(
  vec2f(-0.375, -0.875),
  vec2f( 0.875, -0.375),
  vec2f(-0.875,  0.375),
  vec2f( 0.375,  0.875),
);

fn dynShadowProject(c: DynShadowCascade, worldPos: vec3f) -> vec3f {
  let rel = worldPos - c.originInvR.xyz;
  let ndcX = dot(rel, c.axisUTexel.xyz) * c.originInvR.w;
  let ndcY = dot(rel, c.axisVInvDepth.xyz) * c.originInvR.w;
  let depth = (c.axisSDepthHalf.w - dot(rel, c.axisSDepthHalf.xyz)) * c.axisVInvDepth.w;
  return vec3f(ndcX * 0.5 + 0.5, 0.5 - ndcY * 0.5, depth);
}

fn dynShadowSampleCascade(layer: i32, worldPos: vec3f, worldNormal: vec3f) -> f32 {
  let c = dynShadow.cascades[layer];
  let ndotl = clamp(dot(worldNormal, dynShadow.sunPcf.xyz), 0.0, 1.0);
  let sinTheta = sqrt(max(1.0 - ndotl * ndotl, 0.0));
  let texelSize = c.axisUTexel.w;
  let nOffset = texelSize * (dynShadow.biasParams.x + dynShadow.biasParams.y * sinTheta);
  let biasedPos = worldPos + worldNormal * nOffset;
  let proj = dynShadowProject(c, biasedPos);
  let depthBias = texelSize * dynShadow.biasParams.z * c.axisVInvDepth.w;
  let refDepth = proj.z - depthBias;
  if (refDepth <= 0.0 || refDepth >= 1.0) {
    return 1.0;
  }
  let invRes = dynShadow.params.z;
  let pcfStep = dynShadow.sunPcf.w * invRes;
  let uvMin = vec2f(invRes * 0.5);
  let uvMax = vec2f(1.0 - invRes * 0.5);
  var sum = 0.0;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let uv = clamp(proj.xy + DYN_SHADOW_PCF[i] * pcfStep, uvMin, uvMax);
    sum += textureSampleCompareLevel(dynShadowTex, dynShadowCmp, uv, layer, refDepth);
  }
  return sum * 0.25;
}

fn sampleDynamicSunShadow(worldPos: vec3f, worldNormal: vec3f) -> f32 {
  if (dynShadow.params.x < 0.5 || dynShadow.sunPcf.y <= 0.005) {
    return 1.0;
  }
  let c0 = dynShadow.cascades[0];
  let rel0 = worldPos - c0.originInvR.xyz;
  let ext0 = max(abs(dot(rel0, c0.axisUTexel.xyz)), abs(dot(rel0, c0.axisVInvDepth.xyz))) * c0.originInvR.w;

  let c1 = dynShadow.cascades[1];
  let rel1 = worldPos - c1.originInvR.xyz;
  let ext1 = max(abs(dot(rel1, c1.axisUTexel.xyz)), abs(dot(rel1, c1.axisVInvDepth.xyz))) * c1.originInvR.w;

  let margin = max(dynShadow.sunPcf.w + 1.0, 2.0) * dynShadow.params.z;
  let edge1 = 1.0 - margin;
  if (ext1 >= edge1) {
    return 1.0;
  }

  let edge0 = 1.0 - margin;
  let blendStart = max(0.0, edge0 - dynShadow.params.w);

  var vis = 1.0;
  if (ext0 <= blendStart) {
    vis = dynShadowSampleCascade(0, worldPos, worldNormal);
  } else if (ext0 < edge0) {
    let s0 = dynShadowSampleCascade(0, worldPos, worldNormal);
    let s1 = dynShadowSampleCascade(1, worldPos, worldNormal);
    let blend = smoothstep(blendStart, edge0, ext0);
    vis = mix(s0, s1, blend);
  } else {
    vis = dynShadowSampleCascade(1, worldPos, worldNormal);
  }

  let fadeStart = max(0.0, edge1 - dynShadow.biasParams.w);
  if (ext1 > fadeStart) {
    let fade = smoothstep(fadeStart, edge1, ext1);
    vis = mix(vis, 1.0, fade);
  }
  return vis;
}
`

const CASTER_WGSL = /* wgsl */ `
${DYN_SHADOW_STRUCTS_WGSL}

struct CascadeSelect {
  index: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

struct BoxCaster {
  centerPad: vec4f,
  halfExtentsPad: vec4f,
  quat: vec4f,
}

struct MeshTransform {
  // xyz: worldPos (cells), w: scaleX (or piece cell size)
  posScaleX: vec4f,
  // xyzw: unit quaternion (x, y, z, w)
  quat: vec4f,
  // xyz: piece center-of-mass (com), w: scaleY
  comScaleY: vec4f,
  // x: scaleZ, yzw: pad
  scaleZPad: vec4f,
}

@group(0) @binding(0) var<uniform> dynShadow: DynShadowUniforms;
@group(0) @binding(1) var<uniform> cascadeSel: CascadeSelect;

@group(1) @binding(0) var<storage, read> boxes: array<BoxCaster>;
@group(1) @binding(1) var<uniform> meshTx: MeshTransform;

fn quatRotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn projectLightClip(worldPos: vec3f) -> vec4f {
  let c = dynShadow.cascades[cascadeSel.index];
  let rel = worldPos - c.originInvR.xyz;
  let ndcX = dot(rel, c.axisUTexel.xyz) * c.originInvR.w;
  let ndcY = dot(rel, c.axisVInvDepth.xyz) * c.originInvR.w;
  // Shadow pancaking: clamp near-plane casters to depth >= 0 so tall overhead debris never clips out.
  let depth = max((c.axisSDepthHalf.w - dot(rel, c.axisSDepthHalf.xyz)) * c.axisVInvDepth.w, 0.0);
  return vec4f(ndcX, ndcY, depth, 1.0);
}

// Instanced OBB / proxy box depth-only vertex shader (36 unit-cube vertices x boxCount).
@vertex fn vs_box(
  @location(0) localVert: vec3f,
  @builtin(instance_index) instIdx: u32,
) -> @builtin(position) vec4f {
  let b = boxes[instIdx];
  let worldPos = b.centerPad.xyz + quatRotate(b.quat, localVert * b.halfExtentsPad.xyz);
  return projectLightClip(worldPos);
}

// Rigid triangle-list mesh depth-only vertex shader (float32x3 positions).
@vertex fn vs_mesh(
  @location(0) localVert: vec3f,
) -> @builtin(position) vec4f {
  let scaled = localVert * vec3f(meshTx.posScaleX.w, meshTx.comScaleY.w, meshTx.scaleZPad.x);
  let worldPos = meshTx.posScaleX.xyz + quatRotate(meshTx.quat, scaled);
  return projectLightClip(worldPos);
}

// Merged-face pieces.ts depth-only vertex shader (24-byte instanced quads, 4 triangle-strip verts each).
@vertex fn vs_piece(
  @builtin(vertex_index) v: u32,
  @location(0) a: u32,
  @location(1) b: u32,
) -> @builtin(position) vec4f {
  let start = vec3f(f32(a & 1023u), f32((a >> 10u) & 1023u), f32((a >> 20u) & 1023u));
  let span = f32(b & 255u);
  let axis = (b >> 8u) & 3u;
  let side = f32((b >> 10u) & 1u);
  let flip = select(side > 0.5, side < 0.5, axis == 2u);
  let vi = select(v, v ^ 1u, flip);
  let cu = f32(vi & 1u);
  let cv = f32((vi >> 1u) & 1u);
  var p = start;
  if (axis == 1u) { p += vec3f(cu * span, side, cv); }
  else if (axis == 2u) { p += vec3f(cu * span, cv, side); }
  else { p += vec3f(side, cv, cu * span); }
  let localPos = (p - meshTx.comScaleY.xyz) * meshTx.posScaleX.w;
  let worldPos = meshTx.posScaleX.xyz + quatRotate(meshTx.quat, localPos);
  return projectLightClip(worldPos);
}
`

// Unit cube [-1, +1]^3, 36 vertices (12 triangles), outward CCW winding.
const UNIT_CUBE_VERTS = new Float32Array([
  // +X
   1, -1, -1,   1,  1, -1,   1,  1,  1,
   1, -1, -1,   1,  1,  1,   1, -1,  1,
  // -X
  -1, -1,  1,  -1,  1,  1,  -1,  1, -1,
  -1, -1,  1,  -1,  1, -1,  -1, -1, -1,
  // +Y
  -1,  1,  1,   1,  1,  1,   1,  1, -1,
  -1,  1,  1,   1,  1, -1,  -1,  1, -1,
  // -Y
  -1, -1, -1,   1, -1, -1,   1, -1,  1,
  -1, -1, -1,   1, -1,  1,  -1, -1,  1,
  // +Z
  -1, -1,  1,   1, -1,  1,   1,  1,  1,
  -1, -1,  1,   1,  1,  1,  -1,  1,  1,
  // -Z
   1, -1, -1,  -1, -1, -1,  -1,  1, -1,
   1, -1, -1,  -1,  1, -1,   1,  1, -1,
])

function normalizeQuat(
  qx: number, qy: number, qz: number, qw: number,
  out: Float32Array, offset: number,
): void {
  const len = Math.hypot(qx, qy, qz, qw)
  if (len > 1e-6) {
    const inv = 1 / len
    out[offset] = qx * inv
    out[offset + 1] = qy * inv
    out[offset + 2] = qz * inv
    out[offset + 3] = qw * inv
  } else {
    out[offset] = 0
    out[offset + 1] = 0
    out[offset + 2] = 0
    out[offset + 3] = 1
  }
}

export async function createDynamicShadows(
  device: GPUDevice,
  resolution = DEFAULT_SHADOW_RESOLUTION,
  options: DynamicShadowOptions = {},
): Promise<DynamicShadows> {
  const res = Math.max(64, Math.floor(resolution))
  const cascadeRadii: readonly [number, number] = options.cascadeRadii ?? DEFAULT_CASCADE_RADII
  const cascadeDepthHalves: readonly [number, number] = options.cascadeDepthHalves ?? DEFAULT_CASCADE_DEPTH_HALVES
  const maxBoxCasters = Math.max(1, Math.floor(options.maxBoxCasters ?? MAX_BOX_CASTERS))
  const maxMeshDraws = Math.max(1, Math.floor(options.maxMeshDraws ?? MAX_MESH_DRAWS))
  const pcfRadiusTexels = options.pcfRadiusTexels ?? 1.25
  const cascadeBlendFraction = options.cascadeBlendFraction ?? 0.15
  const outerFadeFraction = options.outerFadeFraction ?? 0.12
  const normalBiasBase = options.normalBiasBase ?? 0.25
  const normalBiasSlope = options.normalBiasSlope ?? 0.65
  const depthBiasTexels = options.depthBiasTexels ?? 0.35

  const shadowTexture = device.createTexture({
    label: 'dynamic-shadows-depth-array',
    size: [res, res, SHADOW_CASCADE_COUNT],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const shadowTextureView = shadowTexture.createView({
    label: 'dynamic-shadows-array-view',
    dimension: '2d-array',
    aspect: 'depth-only',
    baseArrayLayer: 0,
    arrayLayerCount: SHADOW_CASCADE_COUNT,
  })
  const cascadeViews: readonly [GPUTextureView, GPUTextureView] = [
    shadowTexture.createView({
      label: 'dynamic-shadows-cascade-0',
      dimension: '2d',
      aspect: 'depth-only',
      baseArrayLayer: 0,
      arrayLayerCount: 1,
    }),
    shadowTexture.createView({
      label: 'dynamic-shadows-cascade-1',
      dimension: '2d',
      aspect: 'depth-only',
      baseArrayLayer: 1,
      arrayLayerCount: 1,
    }),
  ]

  const compareSampler = device.createSampler({
    label: 'dynamic-shadows-compare-sampler',
    compare: 'less-equal',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const uniformBuffer = device.createBuffer({
    label: 'dynamic-shadows-uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  // Two tiny static cascade-selector uniform buffers so Cascade 0 and Cascade 1 never alias on queue.writeBuffer.
  const cascadeSelBufs: readonly [GPUBuffer, GPUBuffer] = [
    device.createBuffer({ label: 'dynamic-shadows-cascade-sel-0', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    device.createBuffer({ label: 'dynamic-shadows-cascade-sel-1', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
  ]
  device.queue.writeBuffer(cascadeSelBufs[0], 0, new Uint32Array([0, 0, 0, 0]))
  device.queue.writeBuffer(cascadeSelBufs[1], 0, new Uint32Array([1, 0, 0, 0]))

  const cubeVertexBuffer = device.createBuffer({
    label: 'dynamic-shadows-unit-cube',
    size: UNIT_CUBE_VERTS.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(cubeVertexBuffer, 0, UNIT_CUBE_VERTS)

  const boxBuffer = device.createBuffer({
    label: 'dynamic-shadows-box-casters',
    size: maxBoxCasters * BOX_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const meshSlotStride = Math.max(256, device.limits.minUniformBufferOffsetAlignment || 256)
  const meshUniformBuffer = device.createBuffer({
    label: 'dynamic-shadows-mesh-transforms',
    size: maxMeshDraws * meshSlotStride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  // Compile depth-only caster shader module (box + rigid mesh + pieces merged-face).
  const casterModule = await shader(device, 'dynamic-shadows-casters', CASTER_WGSL)

  const sharedGroupLayout = device.createBindGroupLayout({
    label: 'dynamic-shadows-shared-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  })
  const boxGroupLayout = device.createBindGroupLayout({
    label: 'dynamic-shadows-box-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const meshGroupLayout = device.createBindGroupLayout({
    label: 'dynamic-shadows-mesh-bgl',
    entries: [
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: MESH_PAYLOAD_BYTES },
      },
    ],
  })

  const boxPipelineLayout = device.createPipelineLayout({
    label: 'dynamic-shadows-box-pl',
    bindGroupLayouts: [sharedGroupLayout, boxGroupLayout],
  })
  const meshPipelineLayout = device.createPipelineLayout({
    label: 'dynamic-shadows-mesh-pl',
    bindGroupLayouts: [sharedGroupLayout, meshGroupLayout],
  })

  const depthStencil: GPUDepthStencilState = {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'less',
    depthBias: 1,
    depthBiasSlopeScale: 1.5,
  }

  const [boxPipeline, meshPipeline, piecePipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'dynamic-shadows-box-pipeline',
      layout: boxPipelineLayout,
      vertex: {
        module: casterModule,
        entryPoint: 'vs_box',
        buffers: [{
          arrayStride: 12,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil,
    }),
    device.createRenderPipelineAsync({
      label: 'dynamic-shadows-mesh-pipeline',
      layout: meshPipelineLayout,
      vertex: {
        module: casterModule,
        entryPoint: 'vs_mesh',
        buffers: [{
          arrayStride: 12,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    }),
    device.createRenderPipelineAsync({
      label: 'dynamic-shadows-piece-pipeline',
      layout: meshPipelineLayout,
      vertex: {
        module: casterModule,
        entryPoint: 'vs_piece',
        buffers: [{
          arrayStride: 24,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'uint32' },
            { shaderLocation: 1, offset: 4, format: 'uint32' },
          ],
        }],
      },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil,
    }),
  ])

  const cascadeSharedBindGroups: readonly [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      label: 'dynamic-shadows-shared-bg-0',
      layout: sharedGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: cascadeSelBufs[0] } },
      ],
    }),
    device.createBindGroup({
      label: 'dynamic-shadows-shared-bg-1',
      layout: sharedGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: cascadeSelBufs[1] } },
      ],
    }),
  ]
  const boxBindGroup = device.createBindGroup({
    label: 'dynamic-shadows-box-bg',
    layout: boxGroupLayout,
    entries: [{ binding: 0, resource: { buffer: boxBuffer } }],
  })
  const meshBindGroup = device.createBindGroup({
    label: 'dynamic-shadows-mesh-bg',
    layout: meshGroupLayout,
    entries: [{ binding: 1, resource: { buffer: meshUniformBuffer, offset: 0, size: MESH_PAYLOAD_BYTES } }],
  })

  // Pre-allocated CPU backing buffers (zero GC per frame).
  const uniformData = new Float32Array(new ArrayBuffer(UNIFORM_BYTES))
  const boxData = new Float32Array(new ArrayBuffer(maxBoxCasters * BOX_BYTES))
  const meshScratch = new Float32Array(new ArrayBuffer(MESH_PAYLOAD_BYTES))

  // Reusable per-cascade render pass descriptors (zero GC per frame).
  const passDescs: readonly [GPURenderPassDescriptor, GPURenderPassDescriptor] = [
    {
      label: 'dynamic-shadows-pass-c0',
      colorAttachments: [],
      depthStencilAttachment: {
        view: cascadeViews[0],
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    },
    {
      label: 'dynamic-shadows-pass-c1',
      colorAttachments: [],
      depthStencilAttachment: {
        view: cascadeViews[1],
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    },
  ]

  const texelSizes: [number, number] = [
    (2 * cascadeRadii[0]) / res,
    (2 * cascadeRadii[1]) / res,
  ]
  const origins: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
  ]
  const sunUnit: [number, number, number] = [0, 0.70710678, 0.70710678]

  let boxCount = 0
  let meshDraws = 0
  let active = false
  let uploadedUniforms = false
  let uploadedBoxes = false
  let activeCascade: 0 | 1 = 0
  let destroyed = false

  // Static header constants in uniformData.
  uniformData[0] = 0 // active
  uniformData[1] = res
  uniformData[2] = 1 / res
  uniformData[3] = cascadeBlendFraction
  uniformData[7] = pcfRadiusTexels
  uniformData[8] = normalBiasBase
  uniformData[9] = normalBiasSlope
  uniformData[10] = depthBiasTexels
  uniformData[11] = outerFadeFraction

  function updateView(eye: Vec3, sunDir: Vec3): void {
    const len = Math.hypot(sunDir[0], sunDir[1], sunDir[2])
    const sx = len > 1e-6 ? sunDir[0] / len : 0
    const sy = len > 1e-6 ? sunDir[1] / len : 1
    const sz = len > 1e-6 ? sunDir[2] / len : 0
    sunUnit[0] = sx
    sunUnit[1] = sy
    sunUnit[2] = sz

    // Orthonormal right-handed light basis (u, v, s) with u x v = s, matching sun.ts.
    const across = Math.hypot(sz, sx)
    let ux: number, uy: number, uz: number
    if (across > 1e-4) {
      ux = sz / across
      uy = 0
      uz = -sx / across
    } else {
      ux = 1
      uy = 0
      uz = 0
    }
    const vx = sy * uz - sz * uy
    const vy = sz * ux - sx * uz
    const vz = sx * uy - sy * ux

    uniformData[4] = sx
    uniformData[5] = sy
    uniformData[6] = sz

    const ex = eye[0], ey = eye[1], ez = eye[2]
    const eyeU = ex * ux + ey * uy + ez * uz
    const eyeV = ex * vx + ey * vy + ez * vz
    const eyeS = ex * sx + ey * sy + ez * sz

    for (let c = 0; c < SHADOW_CASCADE_COUNT; c++) {
      const radius = cascadeRadii[c]
      const depthHalf = cascadeDepthHalves[c]
      const texelSize = texelSizes[c]
      const depthSnap = texelSize * 16

      // Snap cascade center in light space to exact texel increments to eliminate shadow crawl/shimmer.
      const cu = Math.floor(eyeU / texelSize) * texelSize
      const cv = Math.floor(eyeV / texelSize) * texelSize
      const cs = Math.floor(eyeS / depthSnap) * depthSnap

      const ox = ux * cu + vx * cv + sx * cs
      const oy = uy * cu + vy * cv + sy * cs
      const oz = uz * cu + vz * cv + sz * cs
      origins[c][0] = ox
      origins[c][1] = oy
      origins[c][2] = oz

      const base = 12 + c * 16
      // originInvR
      uniformData[base + 0] = ox
      uniformData[base + 1] = oy
      uniformData[base + 2] = oz
      uniformData[base + 3] = 1 / radius
      // axisUTexel
      uniformData[base + 4] = ux
      uniformData[base + 5] = uy
      uniformData[base + 6] = uz
      uniformData[base + 7] = texelSize
      // axisVInvDepth
      uniformData[base + 8] = vx
      uniformData[base + 9] = vy
      uniformData[base + 10] = vz
      uniformData[base + 11] = 1 / (2 * depthHalf)
      // axisSDepthHalf
      uniformData[base + 12] = sx
      uniformData[base + 13] = sy
      uniformData[base + 14] = sz
      uniformData[base + 15] = depthHalf
    }
    uploadedUniforms = false
  }

  function beginFrame(): void {
    boxCount = 0
    meshDraws = 0
    active = false
    uploadedUniforms = false
    uploadedBoxes = false
  }

  function addBoxCasterRaw(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    qx = 0, qy = 0, qz = 0, qw = 1,
  ): boolean {
    if (boxCount >= maxBoxCasters) return false
    const o = boxCount * BOX_FLOATS
    boxData[o + 0] = cx
    boxData[o + 1] = cy
    boxData[o + 2] = cz
    boxData[o + 3] = 0
    boxData[o + 4] = Math.abs(hx)
    boxData[o + 5] = Math.abs(hy)
    boxData[o + 6] = Math.abs(hz)
    boxData[o + 7] = 0
    normalizeQuat(qx, qy, qz, qw, boxData, o + 8)
    boxCount++
    uploadedBoxes = false
    return true
  }

  function addBoxCaster(center: Vec3, halfExtents: Vec3, quat?: Quat): boolean {
    return addBoxCasterRaw(
      center[0], center[1], center[2],
      halfExtents[0], halfExtents[1], halfExtents[2],
      quat ? quat[0] : 0,
      quat ? quat[1] : 0,
      quat ? quat[2] : 0,
      quat ? quat[3] : 1,
    )
  }

  function flushFrameUploads(markActive: boolean): void {
    const nextActive = markActive ? 1 : 0
    if (!uploadedUniforms || uniformData[0] !== nextActive) {
      uniformData[0] = nextActive
      device.queue.writeBuffer(uniformBuffer, 0, uniformData)
      uploadedUniforms = true
    }
    if (!uploadedBoxes && boxCount > 0) {
      device.queue.writeBuffer(boxBuffer, 0, boxData, 0, boxCount * BOX_FLOATS)
      uploadedBoxes = true
    }
    active = markActive
  }

  function beginCascadePass(
    encoder: GPUCommandEncoder,
    cascade: 0 | 1,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): GPURenderPassEncoder {
    flushFrameUploads(true)
    activeCascade = cascade
    const baseDesc = passDescs[cascade]
    return encoder.beginRenderPass(
      timestampWrites
        ? {
            label: baseDesc.label,
            colorAttachments: baseDesc.colorAttachments,
            depthStencilAttachment: baseDesc.depthStencilAttachment,
            timestampWrites,
          }
        : baseDesc,
    )
  }

  function drawBoxCasters(pass: GPURenderPassEncoder, cascade: 0 | 1): void {
    if (boxCount <= 0) return
    pass.setPipeline(boxPipeline)
    pass.setBindGroup(0, cascadeSharedBindGroups[cascade])
    pass.setBindGroup(1, boxBindGroup)
    pass.setVertexBuffer(0, cubeVertexBuffer)
    pass.draw(36, boxCount)
  }

  function writeMeshSlot(): number {
    if (meshDraws >= maxMeshDraws) return -1
    const slot = meshDraws++
    const byteOffset = slot * meshSlotStride
    device.queue.writeBuffer(meshUniformBuffer, byteOffset, meshScratch)
    return byteOffset
  }

  function drawMesh(
    pass: GPURenderPassEncoder,
    vertexBuffer: GPUBuffer,
    vertexCount: number,
    worldPos: Vec3,
    quat?: Quat,
    scale: number | Vec3 = 1,
  ): void {
    if (vertexCount <= 0) return
    const sx = typeof scale === 'number' ? scale : scale[0]
    const sy = typeof scale === 'number' ? scale : scale[1]
    const sz = typeof scale === 'number' ? scale : scale[2]
    meshScratch[0] = worldPos[0]
    meshScratch[1] = worldPos[1]
    meshScratch[2] = worldPos[2]
    meshScratch[3] = sx
    normalizeQuat(
      quat ? quat[0] : 0,
      quat ? quat[1] : 0,
      quat ? quat[2] : 0,
      quat ? quat[3] : 1,
      meshScratch,
      4,
    )
    meshScratch[8] = 0
    meshScratch[9] = 0
    meshScratch[10] = 0
    meshScratch[11] = sy
    meshScratch[12] = sz
    meshScratch[13] = 0
    meshScratch[14] = 0
    meshScratch[15] = 0

    const byteOffset = writeMeshSlot()
    if (byteOffset < 0) return
    pass.setPipeline(meshPipeline)
    pass.setBindGroup(0, cascadeSharedBindGroups[activeCascade])
    pass.setBindGroup(1, meshBindGroup, [byteOffset])
    pass.setVertexBuffer(0, vertexBuffer)
    pass.draw(vertexCount)
  }

  function drawPieceFaces(
    pass: GPURenderPassEncoder,
    faceBuffer: GPUBuffer,
    faceCount: number,
    worldPos: Vec3,
    quat: Quat,
    com: Vec3,
    cell = 1,
  ): void {
    if (faceCount <= 0 || cell === 0) return
    meshScratch[0] = worldPos[0]
    meshScratch[1] = worldPos[1]
    meshScratch[2] = worldPos[2]
    meshScratch[3] = cell
    normalizeQuat(quat[0], quat[1], quat[2], quat[3], meshScratch, 4)
    meshScratch[8] = com[0]
    meshScratch[9] = com[1]
    meshScratch[10] = com[2]
    meshScratch[11] = 1
    meshScratch[12] = 1
    meshScratch[13] = 0
    meshScratch[14] = 0
    meshScratch[15] = 0

    const byteOffset = writeMeshSlot()
    if (byteOffset < 0) return
    pass.setPipeline(piecePipeline)
    pass.setBindGroup(0, cascadeSharedBindGroups[activeCascade])
    pass.setBindGroup(1, meshBindGroup, [byteOffset])
    pass.setVertexBuffer(0, faceBuffer)
    pass.draw(4, faceCount)
  }

  function render(
    encoder: GPUCommandEncoder,
    drawMeshes?: DynamicMeshDrawCallback,
    timestampWrites?: GPURenderPassTimestampWrites | readonly (GPURenderPassTimestampWrites | undefined)[],
  ): void {
    if (destroyed) return
    if (boxCount === 0 && !drawMeshes) {
      // Zero casters active: mark uniform inactive so sampleDynamicSunShadow early-outs to 1.0.
      flushFrameUploads(false)
      return
    }
    flushFrameUploads(true)
    const tsList = Array.isArray(timestampWrites) ? timestampWrites : [timestampWrites, undefined]
    for (let c = 0; c < SHADOW_CASCADE_COUNT; c++) {
      const cascade = c as 0 | 1
      const pass = beginCascadePass(encoder, cascade, tsList[c])
      if (boxCount > 0) drawBoxCasters(pass, cascade)
      if (drawMeshes) drawMeshes(pass, cascade)
      pass.end()
    }
  }

  function stats(): DynamicShadowStats {
    return {
      resolution: res,
      cascades: SHADOW_CASCADE_COUNT,
      active,
      boxCasters: boxCount,
      meshDraws,
      texelSizes: [texelSizes[0], texelSizes[1]],
      cascadeRadii,
      snappedOrigins: [
        [origins[0][0], origins[0][1], origins[0][2]],
        [origins[1][0], origins[1][1], origins[1][2]],
      ],
      sunDir: [sunUnit[0], sunUnit[1], sunUnit[2]],
    }
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    shadowTexture.destroy()
    uniformBuffer.destroy()
    cascadeSelBufs[0].destroy()
    cascadeSelBufs[1].destroy()
    cubeVertexBuffer.destroy()
    boxBuffer.destroy()
    meshUniformBuffer.destroy()
  }

  // Initialize default view so uniform buffer is valid immediately after creation.
  updateView([0, 0, 0], [0, 0.70710678, 0.70710678])

  return {
    resolution: res,
    cascadeCount: SHADOW_CASCADE_COUNT,
    cascadeRadii,
    maxBoxCasters,
    maxMeshDraws,
    shadowTexture,
    shadowTextureView,
    cascadeViews,
    compareSampler,
    uniformBuffer,
    updateView,
    beginFrame,
    addBoxCaster,
    addBoxCasterRaw,
    beginCascadePass,
    drawBoxCasters,
    drawMesh,
    drawPieceFaces,
    render,
    stats,
    destroy,
  }
}
