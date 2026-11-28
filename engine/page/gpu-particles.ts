// Standalone WebGPU GPU Compute Particle Simulation & Indirect Draw Frustum Culler (#165 — Wave 3D).
//
// Provides two zero-GC, GPU-driven systems with automatic WebGPU `subgroups` fast-path detection
// (`subgroupBallot` + `subgroupAdd` single atomic per subgroup) and workgroup-shared-memory
// atomic batching fallback so both run identically on Chrome and Safari macOS/iOS:
//
//   1. `createGpuParticles` — scales cleanly to 65,536 particles (< 0.5 ms on Apple Silicon):
//      - 64-byte `Particle` storage buffer (`posAge`, `velLife`, `colorSize`, `meta`) for fire,
//        embers, smoke puffs, and solid debris crumbs.
//      - Pre-allocated ring-buffer CPU->GPU spawn staging queue (single `writeBuffer` upload/frame,
//        zero per-frame JS simulation or sort).
//      - Single compute pass: `cs_spawn` (atomic ring cursor) + `cs_spawn_and_step` (`@workgroup_size(64)`)
//        integrating gravity, drag, upward thermal buoyancy, 3D curl-like wind turbulence, ground &
//        optional screen-space depth bounce, 6-plane view-frustum culling, and visible index compaction
//        directly into `drawIndirectArgs.instanceCount` (`vertexCount = 6`).
//      - Indirect HDR render pipeline (`pass.drawIndirect(indirectBuffer, 0)`) with depth-buffer
//        soft-particle fade (`textureLoad(depthTex)`) and linear HDR emissive fire/smoke shading.
//
//   2. `createIndirectCuller` — up to 4,096 dynamic rigid-body instances for debris collapses:
//      - 64-byte `CullInstance` (`centerRadius`, `aabbMin`, `aabbMax`, `meshDrawArgs`).
//      - Compute 6-plane sphere + AABB frustum culling with compacted `visibleInstanceIds`,
//        global `drawIndirectBuffer`, per-instance `multiDrawIndirectBuffer`, and per-bucket
//        `bucketIndirectBuffer` counts with zero CPU culling overhead.

import { FAR, NEAR, shader } from '../probe/gpu.ts'

// ── Shared Types & Constants ────────────────────────────────────────────────

export type Vec3 = readonly [number, number, number]
/** Inward-pointing normalized frustum plane `[nx, ny, nz, d]` where `dot(n, p) + d >= 0` is inside. */
export type FrustumPlane = readonly [number, number, number, number]

export interface GpuCamera {
  eye: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
  /** Tangent of half the vertical field of view (`tan(fovY / 2)`). */
  tanHalf: number
}

/** Particle archetypes encoded in `meta.w` (exact 24-bit integer stored as f32). */
export const PARTICLE_SMOKE = 0 as const
export const PARTICLE_FIRE = 1 as const
export const PARTICLE_CRUMB = 2 as const
export const PARTICLE_EMBER = 3 as const
export type ParticleKind = 0 | 1 | 2 | 3

export const DEFAULT_PARTICLE_CAPACITY = 65536
export const DEFAULT_CULLER_MAX_INSTANCES = 4096
export const DEFAULT_CULLER_MAX_BUCKETS = 64

/** Bit flag in `CullInstance.meshDrawArgs[3]` marking a slot inactive without zeroing bounds. */
export const CULL_FLAG_DISABLED = 0x80000000

const PARTICLE_STRIDE_FLOATS = 16
const PARTICLE_STRIDE_BYTES = 64
const PARTICLE_UNIFORM_BYTES = 240

const CULL_INSTANCE_STRIDE_WORDS = 16
const CULL_INSTANCE_STRIDE_BYTES = 64
const CULL_UNIFORM_BYTES = 128

const DRAW_INDIRECT_BYTES = 16

/** Pack particle kind (2b), alpha (8b), restitution (6b), seed (8b) into an exact 24-bit f32 integer. */
export function packParticleMetaW(kind: ParticleKind, alpha: number, restitution: number, seed: number): number {
  const k = kind & 3
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
  const r = Math.max(0, Math.min(63, Math.round(restitution * 63)))
  const s = (seed >>> 0) & 255
  return k | (a << 2) | (r << 10) | (s << 16)
}

function nextPow2(n: number, minVal: number, maxVal: number): number {
  const clamped = Math.max(minVal, Math.min(maxVal, Math.floor(n)))
  let p = 1
  while (p < clamped) p <<= 1
  return p
}

function hasDeviceSubgroups(device: GPUDevice): boolean {
  return (device.features as ReadonlySet<string>).has('subgroups')
}

/**
 * Write 6 inward-pointing unit frustum planes (Left, Right, Bottom, Top, Near, Far) directly into
 * `out` at `offset` (24 floats) from a Voxelwright camera basis. Zero allocations.
 */
export function writeFrustumPlanesFromCamera(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  cam: GpuCamera,
  aspect: number,
  near = NEAR,
  far = FAR,
): void {
  const [ex, ey, ez] = cam.eye
  const [fx, fy, fz] = cam.forward
  const [rx, ry, rz] = cam.right
  const [ux, uy, uz] = cam.up
  const ty = cam.tanHalf
  const tx = ty * aspect

  // 0: Left: normalize(right + tx * forward)
  let nx = rx + tx * fx, ny = ry + tx * fy, nz = rz + tx * fz
  let inv = 1 / (Math.hypot(nx, ny, nz) || 1)
  nx *= inv; ny *= inv; nz *= inv
  out[offset + 0] = nx; out[offset + 1] = ny; out[offset + 2] = nz
  out[offset + 3] = -(nx * ex + ny * ey + nz * ez)

  // 1: Right: normalize(-right + tx * forward)
  nx = -rx + tx * fx; ny = -ry + tx * fy; nz = -rz + tx * fz
  inv = 1 / (Math.hypot(nx, ny, nz) || 1)
  nx *= inv; ny *= inv; nz *= inv
  out[offset + 4] = nx; out[offset + 5] = ny; out[offset + 6] = nz
  out[offset + 7] = -(nx * ex + ny * ey + nz * ez)

  // 2: Bottom: normalize(up + ty * forward)
  nx = ux + ty * fx; ny = uy + ty * fy; nz = uz + ty * fz
  inv = 1 / (Math.hypot(nx, ny, nz) || 1)
  nx *= inv; ny *= inv; nz *= inv
  out[offset + 8] = nx; out[offset + 9] = ny; out[offset + 10] = nz
  out[offset + 11] = -(nx * ex + ny * ey + nz * ez)

  // 3: Top: normalize(-up + ty * forward)
  nx = -ux + ty * fx; ny = -uy + ty * fy; nz = -uz + ty * fz
  inv = 1 / (Math.hypot(nx, ny, nz) || 1)
  nx *= inv; ny *= inv; nz *= inv
  out[offset + 12] = nx; out[offset + 13] = ny; out[offset + 14] = nz
  out[offset + 15] = -(nx * ex + ny * ey + nz * ez)

  // 4: Near: dot(forward, p - eye) >= near
  out[offset + 16] = fx; out[offset + 17] = fy; out[offset + 18] = fz
  out[offset + 19] = -(fx * ex + fy * ey + fz * ez) - near

  // 5: Far: dot(-forward, p - eye) + far >= 0
  out[offset + 20] = -fx; out[offset + 21] = -fy; out[offset + 22] = -fz
  out[offset + 23] = (fx * ex + fy * ey + fz * ez) + far
}

/**
 * Extract 6 inward-pointing unit frustum planes from a column-major WebGPU (0..1 depth) view-projection
 * matrix via Gribb-Hartmann into `out` at `offset` (24 floats). Zero allocations.
 */
export function writeFrustumPlanesFromViewProj(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  vp: Float32Array,
): void {
  // Row i of column-major 4x4 matrix: [vp[i], vp[4 + i], vp[8 + i], vp[12 + i]].
  const setPlane = (slot: number, a: number, b: number, c: number, d: number) => {
    const inv = 1 / (Math.hypot(a, b, c) || 1)
    out[offset + slot * 4 + 0] = a * inv
    out[offset + slot * 4 + 1] = b * inv
    out[offset + slot * 4 + 2] = c * inv
    out[offset + slot * 4 + 3] = d * inv
  }
  const r00 = vp[0], r01 = vp[4], r02 = vp[8], r03 = vp[12]
  const r10 = vp[1], r11 = vp[5], r12 = vp[9], r13 = vp[13]
  const r20 = vp[2], r21 = vp[6], r22 = vp[10], r23 = vp[14]
  const r30 = vp[3], r31 = vp[7], r32 = vp[11], r33 = vp[15]
  setPlane(0, r30 + r00, r31 + r01, r32 + r02, r33 + r03) // Left
  setPlane(1, r30 - r00, r31 - r01, r32 - r02, r33 - r03) // Right
  setPlane(2, r30 + r10, r31 + r11, r32 + r12, r33 + r13) // Bottom
  setPlane(3, r30 - r10, r31 - r11, r32 - r12, r33 - r13) // Top
  setPlane(4, r20, r21, r22, r23)                         // Near (z >= 0)
  setPlane(5, r30 - r20, r31 - r21, r32 - r22, r33 - r23) // Far  (z <= w)
}

/** Convenience helper returning 6 frustum planes as tuples (for tests/debugging). */
export function extractFrustumPlanes(cam: GpuCamera, aspect: number, near = NEAR, far = FAR): FrustumPlane[] {
  const buf = new Float32Array(new ArrayBuffer(24 * 4))
  writeFrustumPlanesFromCamera(buf, 0, cam, aspect, near, far)
  const planes: FrustumPlane[] = []
  for (let i = 0; i < 6; i++) {
    planes.push([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]])
  }
  return planes
}

// ── 1. GPU Compute Particle System ──────────────────────────────────────────

export interface GpuParticlesOptions {
  /** Maximum live particles (rounded up to power of 2, default 65,536). */
  capacity?: number
  /** Maximum staged CPU->GPU spawns per frame (default `capacity`). */
  maxSpawnsPerFrame?: number
  /** Render target color format (default `'rgba16float'` for linear HDR). */
  colorFormat?: GPUTextureFormat
  /** Optional depth attachment format if drawing inside a read-only depth pass; omit for manual soft-depth testing. */
  depthAttachmentFormat?: GPUTextureFormat
  /** Force disabling WebGPU `subgroups` even when the device supports it (useful for A/B & fallback tests). */
  forceNoSubgroups?: boolean
}

export interface ParticleEmitOptions {
  pos: Vec3
  vel?: Vec3
  life: number
  color?: Vec3
  size?: number
  heat?: number
  buoyancy?: number
  drag?: number
  kind?: ParticleKind
  alpha?: number
  restitution?: number
  seed?: number
}

export interface GpuParticlesStepOptions {
  /** Frame delta time in seconds. */
  dt: number
  /** Active camera basis for 6-plane frustum culling and billboard rendering. */
  camera: GpuCamera
  /** Viewport size `[width, height]` in pixels. */
  viewport: readonly [number, number]
  /** Near clip plane in world cells (default `NEAR = 1`). */
  near?: number
  /** Far clip plane in world cells (default `FAR = 100000`). */
  far?: number
  /** Global downward gravity acceleration in cells/s² (default `-98`). */
  gravity?: number
  /** World ground plane height in cells for bounce collisions (default `0`). */
  groundY?: number
  /** Enable ground height collision bounce (default `true`). */
  groundBounce?: boolean
  /** Optional scene depth view (`depth24plus`) to enable screen-space depth collision bounce in compute. */
  collisionDepth?: GPUTextureView
  /** Enable screen-space depth collision bounce when `collisionDepth` is provided (default `false`). */
  screenBounce?: boolean
  /** World wind velocity `[wx, wy, wz]` in cells/s (default `[4, 0, 1]`). */
  wind?: Vec3
  /** 3D curl-like wind turbulence strength in cells/s² (default `12`). */
  turbulence?: number
  /** Soft-particle depth fade distance in world cells (default `6`). */
  softDepthRange?: number
  /** Smoke/fire radial growth rate in cells/s (default `1.2`). */
  smokeGrowRate?: number
  /** Sun direction vector for smoke/crumb lighting (default `[0.51, 0.76, 0.40]`). */
  sun?: Vec3
  /** Daylight factor `0..1` (default `1`). */
  day?: number
  /** Enable 6-plane frustum culling (default `true`). */
  frustumCull?: boolean
  /** Optional compute pass timestamp writes. */
  timestampWrites?: GPUComputePassTimestampWrites
}

export interface GpuParticlesDrawOptions {
  /** Scene depth texture view (`depth24plus`, `TEXTURE_BINDING`) for soft-particle depth fade and occlusion. */
  depth: GPUTextureView
}

export interface GpuParticles {
  readonly capacity: number
  readonly maxSpawnsPerFrame: number
  readonly usesSubgroups: boolean
  /** Storage buffer holding all `capacity` 64-byte `Particle` records. */
  readonly particleBuffer: GPUBuffer
  /** Storage buffer holding compacted visible particle indices for the current frame. */
  readonly visibleIndicesBuffer: GPUBuffer
  /** 16-byte `DrawIndirectArgs` buffer (`[6, visibleCount, 0, 0]`). */
  readonly indirectBuffer: GPUBuffer
  /** Number of spawns currently staged on CPU waiting for the next `step()`. */
  readonly pendingSpawns: number
  /** Stage one particle into the CPU->GPU ring staging buffer (zero GPU calls). */
  emit(opts: ParticleEmitOptions): boolean
  /** Zero-allocation primitive emit for tight spawn loops. */
  emitRaw(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    life: number,
    r: number, g: number, b: number,
    size: number,
    heat: number, buoyancy: number, drag: number,
    kind: ParticleKind, alpha: number, restitution: number, seed: number,
  ): boolean
  /** Upload staged spawns, reset `indirectBuffer`, and encode compute spawn + step + frustum cull + compaction. */
  step(encoder: GPUCommandEncoder, options: GpuParticlesStepOptions): void
  /** Encode `pass.drawIndirect(indirectBuffer, 0)` with soft-particle depth fade and linear HDR shading. */
  draw(renderPass: GPURenderPassEncoder, options: GpuParticlesDrawOptions): void
  /** Reset all GPU particle slots to dead and clear pending CPU spawns. */
  clear(encoder: GPUCommandEncoder): void
  /** Destroy all GPU resources owned by this particle system. */
  destroy(): void
}

const PARTICLE_STRUCTS_WGSL = /* wgsl */ `
struct Particle {
  posAge: vec4f,    // xyz = world position (cells), w = age (seconds)
  velLife: vec4f,   // xyz = velocity (cells/s), w = total lifetime (seconds; <= 0 => dead)
  colorSize: vec4f, // rgb = linear HDR color, w = radius/size (cells)
  props: vec4f,     // x = heat, y = buoyancy, z = drag, w = packed24(kind, alpha, restitution, seed)
}

struct ParticleUniforms {
  eyeDt: vec4f,        // xyz = eye, w = dt
  rightAspect: vec4f,  // xyz = right, w = aspect
  upTanHalf: vec4f,    // xyz = up, w = tanHalfY
  forwardNear: vec4f,  // xyz = forward, w = clipNear
  windFar: vec4f,      // xyz = wind, w = clipFar
  sunDay: vec4f,       // xyz = sunDir, w = day
  simParams: vec4f,    // x = gravity, y = groundY, z = turbulence, w = time
  renderParams: vec4f, // x = softDepthRange, y = smokeGrowRate, z = viewportW, w = viewportH
  counts: vec4u,       // x = capacity, y = capacityMask, z = spawnCount, w = flags
  planes: array<vec4f, 6>,
}

fn linearizeParticleDepth(rawD: f32, nearZ: f32, farZ: f32) -> f32 {
  let ratio = (farZ - nearZ) / farZ;
  let denom = max(1.0 - clamp(rawD, 0.0, 1.0) * ratio, nearZ / farZ);
  return min(nearZ / denom, farZ);
}
`

function buildParticleComputeWgsl(useSubgroups: boolean): string {
  const header = useSubgroups ? 'enable subgroups;\n' : ''
  const sharedDecl = useSubgroups
    ? ''
    : `
var<workgroup> wgVisibleCount: atomic<u32>;
var<workgroup> wgBaseSlot: u32;
`

  const compactBlock = useSubgroups
    ? /* wgsl */ `
  // WebGPU subgroups fast path: single global atomic per subgroup via subgroupBallot + subgroupAdd.
  let ballot = subgroupBallot(visible);
  let sgCount = subgroupAdd(select(0u, 1u, visible));
  let sgOffset = subgroupExclusiveAdd(select(0u, 1u, visible));
  let isLeader = subgroupElect();
  var sgBase = 0u;
  if (isLeader && any(ballot != vec4u(0u))) {
    sgBase = atomicAdd(&drawArgs.instanceCount, sgCount);
  }
  let baseSlot = subgroupBroadcastFirst(sgBase);
  if (visible) {
    visibleIndices[baseSlot + sgOffset] = idx;
  }
`
    : /* wgsl */ `
  // Workgroup shared-memory atomic batching fallback: at most 1 global atomic per 64-thread workgroup.
  if (lid.x == 0u) {
    atomicStore(&wgVisibleCount, 0u);
  }
  workgroupBarrier();

  var localOffset = 0u;
  if (visible) {
    localOffset = atomicAdd(&wgVisibleCount, 1u);
  }
  workgroupBarrier();

  if (lid.x == 0u) {
    let total = atomicLoad(&wgVisibleCount);
    if (total > 0u) {
      wgBaseSlot = atomicAdd(&drawArgs.instanceCount, total);
    }
  }
  workgroupBarrier();

  if (visible) {
    visibleIndices[wgBaseSlot + localOffset] = idx;
  }
`

  return /* wgsl */ `${header}
${PARTICLE_STRUCTS_WGSL}

struct SimState {
  spawnCursor: atomic<u32>,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

struct DrawIndirectArgs {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
}

@group(0) @binding(0) var<uniform> u: ParticleUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> spawns: array<Particle>;
@group(0) @binding(3) var<storage, read_write> simState: SimState;
@group(0) @binding(4) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> drawArgs: DrawIndirectArgs;
@group(0) @binding(6) var depthTex: texture_depth_2d;
${sharedDecl}

// Smooth, divergence-free-like 3D trigonometric curl turbulence (zero texture reads, bounded).
fn curlTurbulence(p: vec3f, t: f32, seedPhase: f32) -> vec3f {
  let q = p * 0.075 + vec3f(t * 0.42 + seedPhase, t * 0.29 - seedPhase * 0.7, -t * 0.35 + seedPhase * 0.5);
  let sx = sin(q.y + cos(q.z * 1.31 + t * 0.5));
  let sy = sin(q.z + cos(q.x * 1.27 - t * 0.4));
  let sz = sin(q.x + cos(q.y * 1.37 + t * 0.6));
  return vec3f(sx - sy * 0.5, sy * 0.35 + sz * 0.25, sz - sx * 0.5);
}

fn inFrustumSphere(center: vec3f, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let pl = u.planes[i];
    if (dot(pl.xyz, center) + pl.w < -radius) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64, 1, 1)
fn cs_spawn(@builtin(global_invocation_id) gid: vec3u) {
  let sIdx = gid.x;
  if (sIdx >= u.counts.z) { return; }
  let slot = atomicAdd(&simState.spawnCursor, 1u) & u.counts.y;
  particles[slot] = spawns[sIdx];
}

@compute @workgroup_size(64, 1, 1)
fn cs_spawn_and_step(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
) {
  let idx = gid.x;
  var visible = false;

  if (idx < u.counts.x) {
    var p = particles[idx];
    let life = p.velLife.w;
    if (life > 0.0) {
      let dt = max(u.eyeDt.w, 0.0);
      let newAge = p.posAge.w + dt;
      if (newAge >= life) {
        // Expire cleanly.
        p.posAge.w = life;
        p.velLife.w = 0.0;
        particles[idx] = p;
      } else {
        let packed = u32(max(p.props.w, 0.0));
        let kind = packed & 3u;
        let restitution = f32((packed >> 10u) & 63u) / 63.0;
        let seedPhase = f32((packed >> 16u) & 255u) * 0.02454369;

        let oldPos = p.posAge.xyz;
        var pos = oldPos;
        var vel = p.velLife.xyz;
        var size = p.colorSize.w;
        var heat = p.props.x;
        let buoyancy = p.props.y;
        let drag = max(p.props.z, 0.0);
        let gravity = u.simParams.x;

        // Drag + forces by archetype:
        //   0 = smoke (thermal buoyancy + wind + curl turbulence, no heavy gravity)
        //   1 = fire  (strong thermal rise + turbulence, cools over life)
        //   2 = crumb (full gravity + ground/screen bounce)
        //   3 = ember (gravity + updraft buoyancy + turbulence + bounce)
        let slow = max(0.0, 1.0 - drag * dt);
        vel *= slow;

        let gravScale = select(select(0.0, 0.35, kind == 3u), 1.0, kind == 2u);
        vel.y += (gravity * gravScale + buoyancy) * dt;

        if (kind != 2u) {
          let windWeight = select(0.55, 1.0, kind == 0u);
          vel += (u.windFar.xyz * windWeight) * (min(drag, 1.5) * 0.35 + 0.15) * dt;
          if (u.simParams.z > 0.0) {
            let turb = curlTurbulence(pos, u.simParams.w, seedPhase);
            vel += turb * (u.simParams.z * windWeight) * dt;
          }
        }

        pos += vel * dt;

        // Size & heat evolution.
        if (kind == 0u || kind == 1u) {
          size = max(0.05, size + u.renderParams.y * dt);
        }
        if (heat > 0.0) {
          let coolRate = select(1.4, 0.85, kind == 3u);
          heat = max(0.0, heat * max(0.0, 1.0 - coolRate * (dt / max(life, 0.05))));
        }

        // Ground height collision bounce.
        if ((u.counts.w & 1u) != 0u) {
          let floorY = u.simParams.y + max(size * 0.5, 0.05);
          if (pos.y < floorY && vel.y < 0.0) {
            pos.y = floorY;
            vel.y = abs(vel.y) * restitution;
            vel.x *= 0.65;
            vel.z *= 0.65;
          }
        }

        // Optional screen-space depth collision bounce.
        if ((u.counts.w & 2u) != 0u && dt > 0.0) {
          let relOld = oldPos - u.eyeDt.xyz;
          let relNew = pos - u.eyeDt.xyz;
          let oldZ = dot(relOld, u.forwardNear.xyz);
          let newZ = dot(relNew, u.forwardNear.xyz);
          let clipNear = u.forwardNear.w;
          let clipFar = u.windFar.w;
          if (newZ > clipNear && newZ < clipFar) {
            let ndcX = dot(relNew, u.rightAspect.xyz) / (newZ * u.upTanHalf.w * u.rightAspect.w);
            let ndcY = dot(relNew, u.upTanHalf.xyz) / (newZ * u.upTanHalf.w);
            if (abs(ndcX) <= 1.0 && abs(ndcY) <= 1.0) {
              let dims = vec2i(textureDimensions(depthTex));
              let px = clamp(
                vec2i(i32((ndcX * 0.5 + 0.5) * f32(dims.x)), i32((0.5 - ndcY * 0.5) * f32(dims.y))),
                vec2i(0),
                dims - vec2i(1),
              );
              let sceneZ = linearizeParticleDepth(textureLoad(depthTex, px, 0), clipNear, clipFar);
              let thickness = max(size, 1.5);
              if (oldZ <= sceneZ + thickness && newZ > sceneZ && newZ < sceneZ + thickness * 4.0) {
                // Reconstruct approximate surface normal from adjacent depth pixels.
                let pxR = min(px + vec2i(1, 0), dims - vec2i(1));
                let pxD = min(px + vec2i(0, 1), dims - vec2i(1));
                let zR = linearizeParticleDepth(textureLoad(depthTex, pxR, 0), clipNear, clipFar);
                let zD = linearizeParticleDepth(textureLoad(depthTex, pxD, 0), clipNear, clipFar);
                let stepX = (2.0 * sceneZ * u.upTanHalf.w * u.rightAspect.w) / max(f32(dims.x), 1.0);
                let stepY = (2.0 * sceneZ * u.upTanHalf.w) / max(f32(dims.y), 1.0);
                let dPx = u.rightAspect.xyz * stepX + u.forwardNear.xyz * (zR - sceneZ);
                let dPy = -u.upTanHalf.xyz * stepY + u.forwardNear.xyz * (zD - sceneZ);
                var nrm = normalize(cross(dPy, dPx));
                if (dot(nrm, u.forwardNear.xyz) > 0.0) { nrm = -nrm; }
                let vn = dot(vel, nrm);
                if (vn < 0.0) {
                  vel = vel - (1.0 + restitution) * vn * nrm;
                  vel *= 0.82;
                  pos = oldPos + nrm * max(size * 0.25, 0.1);
                }
              }
            }
          }
        }

        p.posAge = vec4f(pos, newAge);
        p.velLife = vec4f(vel, life);
        p.colorSize.w = size;
        p.props.x = heat;
        particles[idx] = p;

        // 6-plane view-frustum culling (with particle radius).
        let cullOn = (u.counts.w & 4u) != 0u;
        visible = !cullOn || inFrustumSphere(pos, max(size, 0.05));
      }
    }
  }
${compactBlock}
}
`
}

const PARTICLE_RENDER_WGSL = /* wgsl */ `
${PARTICLE_STRUCTS_WGSL}

@group(0) @binding(0) var<uniform> u: ParticleUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> visibleIndices: array<u32>;
@group(0) @binding(3) var depthTex: texture_depth_2d;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f, // rgb = linear color, a = alpha
  @location(2) @interpolate(flat) info: vec4f,  // x = heat, y = ageFrac, z = kindF, w = seedF
  @location(3) @interpolate(flat) linearZ: f32,
}

const QUAD_CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
  vec2f(-1.0, -1.0), vec2f( 1.0,  1.0), vec2f(-1.0,  1.0),
);

@vertex
fn vs(
  @builtin(vertex_index) vIdx: u32,
  @builtin(instance_index) instIdx: u32,
) -> VOut {
  var out: VOut;
  let pIdx = visibleIndices[instIdx];
  let p = particles[pIdx];
  let life = p.velLife.w;
  let size = max(p.colorSize.w, 0.0);
  let centerWorld = p.posAge.xyz - u.eyeDt.xyz;
  let centerD = dot(centerWorld, u.forwardNear.xyz);
  let clipNear = u.forwardNear.w;
  let clipFar = u.windFar.w;

  if (life <= 0.0 || size <= 1e-5 || centerD <= clipNear * 0.25) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec4f(0.0);
    out.info = vec4f(0.0);
    out.linearZ = clipFar;
    return out;
  }

  let corner = QUAD_CORNERS[vIdx];
  let ageFrac = clamp(p.posAge.w / max(life, 1e-4), 0.0, 1.0);
  let packed = u32(max(p.props.w, 0.0));
  let kind = packed & 3u;
  let alpha = f32((packed >> 2u) & 255u) / 255.0;
  let seed = f32((packed >> 16u) & 255u);

  // Shrink crumbs smoothly in the final 25% of life.
  let shrink = select(1.0, clamp((1.0 - ageFrac) * 4.0, 0.0, 1.0), kind == 2u);
  let effSize = size * shrink;

  let world = centerWorld + (u.rightAspect.xyz * corner.x + u.upTanHalf.xyz * corner.y) * effSize;
  let d = dot(world, u.forwardNear.xyz);
  let clipZ = clipFar / (clipFar - clipNear) * (d - clipNear);

  out.pos = vec4f(
    dot(world, u.rightAspect.xyz) / (u.upTanHalf.w * u.rightAspect.w),
    dot(world, u.upTanHalf.xyz) / u.upTanHalf.w,
    clipZ,
    d,
  );
  out.uv = corner;
  out.color = vec4f(p.colorSize.rgb, alpha);
  out.info = vec4f(p.props.x, ageFrac, f32(kind), seed);
  out.linearZ = centerD;
  return out;
}

fn hash21(c: vec2i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}

fn softCloud(p: vec2f, seed: u32) -> f32 {
  let c = vec2i(floor(p));
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  let a = mix(hash21(c, seed), hash21(c + vec2i(1, 0), seed), e.x);
  let b = mix(hash21(c + vec2i(0, 1), seed), hash21(c + vec2i(1, 1), seed), e.x);
  return mix(a, b, e.y);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r = length(in.uv);
  let kind = u32(in.info.z + 0.5);
  if (kind != 2u && r >= 1.0) { discard; }

  // Depth-buffer soft-particle fade (reads scene depth24plus via textureLoad).
  let dims = vec2i(textureDimensions(depthTex));
  let px = clamp(vec2i(in.pos.xy), vec2i(0), max(dims - vec2i(1), vec2i(0)));
  let rawSceneDepth = textureLoad(depthTex, px, 0);
  let sceneLinearZ = linearizeParticleDepth(rawSceneDepth, u.forwardNear.w, u.windFar.w);
  let depthDelta = sceneLinearZ - in.linearZ;
  if (depthDelta <= 0.0) { discard; }
  let softFade = smoothstep(0.0, max(u.renderParams.x, 1e-4), depthDelta);
  if (softFade <= 0.001) { discard; }

  let heat = max(in.info.x, 0.0);
  let ageFrac = in.info.y;
  let seed = u32(in.info.w + 0.5);
  let lifeFade = smoothstep(0.0, 0.08, ageFrac) * (1.0 - smoothstep(0.65, 1.0, ageFrac));
  // Ensure fresh frames (ageFrac == 0 on spawn frame) stay visible immediately.
  let envFade = max(lifeFade, 1.0 - smoothstep(0.0, 0.12, ageFrac));
  let fade = envFade * (1.0 - smoothstep(0.70, 1.0, ageFrac));

  // Solid debris crumb archetype (kind == 2).
  if (kind == 2u) {
    let boxDist = max(abs(in.uv.x), abs(in.uv.y));
    if (boxDist > 0.92) { discard; }
    let n = normalize(vec3f(in.uv.x * 0.6, in.uv.y * 0.6, 0.8));
    let sunDir = normalize(u.sunDay.xyz);
    let sunView = vec3f(dot(sunDir, u.rightAspect.xyz), dot(sunDir, u.upTanHalf.xyz), -dot(sunDir, u.forwardNear.xyz));
    let ndl = max(dot(n, sunView), 0.0);
    let lit = in.color.rgb * (0.28 + ndl * 1.45) * mix(0.12, 1.0, u.sunDay.w);
    let cov = in.color.a * softFade;
    return vec4f(lit * cov, cov);
  }

  // Soft billowing cloud profile for smoke/fire/embers.
  let drift = vec2f(f32(seed & 15u), ageFrac * 2.2 + f32((seed >> 4u) & 15u));
  let billow = softCloud(in.uv * 2.2 + drift, seed) * 0.62 + softCloud(in.uv * 4.6 + drift * 1.6, seed + 13u) * 0.38;
  let shape = select(
    (1.0 - smoothstep(0.35, 0.96, r + (billow - 0.5) * 0.55)) * (1.0 - r * r),
    pow(max(1.0 - r, 0.0), 1.8),
    kind == 3u,
  );
  if (shape <= 0.004) { discard; }

  // Directional sun-lit smoke shading in linear HDR.
  let roundN = vec3f(in.uv.x, in.uv.y, sqrt(max(1.0 - r * r, 0.0)));
  let sunDir = normalize(u.sunDay.xyz);
  let towards = vec3f(dot(sunDir, u.rightAspect.xyz), dot(sunDir, u.upTanHalf.xyz), -dot(sunDir, u.forwardNear.xyz));
  let sunFace = clamp(dot(roundN, towards) * 0.6 + 0.4, 0.0, 1.2);
  let skyFill = mix(vec3f(0.16, 0.20, 0.28), vec3f(0.32, 0.40, 0.52), 0.5 + 0.5 * roundN.y);
  let lightCol = (skyFill + vec3f(0.85, 0.80, 0.72) * sunFace) * mix(0.10, 1.0, u.sunDay.w);
  let smokeRgb = in.color.rgb * lightCol;

  // Linear HDR emissive fire/ember blackbody curve (exceeds 1.0 for HDR bloom).
  let hot = clamp(heat * (0.55 + shape * 0.85), 0.0, 2.5);
  let flameRamp = mix(
    mix(vec3f(0.95, 0.14, 0.02), vec3f(1.8, 0.68, 0.08), smoothstep(0.05, 0.45, hot)),
    vec3f(3.2, 2.75, 1.85),
    smoothstep(0.50, 1.40, hot),
  );
  let emissiveMask = smoothstep(0.0, 0.18, heat) * (0.45 + billow * 0.85) * shape * fade;
  let emissiveRgb = flameRamp * max(in.color.rgb, vec3f(0.35)) * emissiveMask * (1.0 + heat * 0.65);

  let cover = in.color.a * shape * fade * (1.0 - 0.85 * smoothstep(0.08, 0.65, heat)) * softFade;
  let outRgb = smokeRgb * cover + emissiveRgb * softFade;
  return vec4f(outRgb, cover);
}
`

export async function createGpuParticles(
  device: GPUDevice,
  options: GpuParticlesOptions = {},
): Promise<GpuParticles> {
  const capacity = nextPow2(options.capacity ?? DEFAULT_PARTICLE_CAPACITY, 64, 262144)
  const capacityMask = capacity - 1
  const maxSpawnsPerFrame = Math.max(64, Math.min(capacity, Math.floor(options.maxSpawnsPerFrame ?? capacity)))
  const colorFormat = options.colorFormat ?? 'rgba16float'
  const usesSubgroups = !options.forceNoSubgroups && hasDeviceSubgroups(device)

  const [computeMod, renderMod] = await Promise.all([
    shader(device, `gpu-particles-compute${usesSubgroups ? '-sg' : '-wg'}`, buildParticleComputeWgsl(usesSubgroups)),
    shader(device, 'gpu-particles-render', PARTICLE_RENDER_WGSL),
  ])

  // Explicit compute bind group layout shared by cs_spawn and cs_spawn_and_step.
  const computeBGL = device.createBindGroupLayout({
    label: 'gpu-particles-compute-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
    ],
  })
  const computeLayout = device.createPipelineLayout({
    label: 'gpu-particles-compute-layout',
    bindGroupLayouts: [computeBGL],
  })

  const renderBGL = device.createBindGroupLayout({
    label: 'gpu-particles-render-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const renderLayout = device.createPipelineLayout({
    label: 'gpu-particles-render-layout',
    bindGroupLayouts: [renderBGL],
  })

  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const [spawnPipe, stepPipe, renderPipe] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'gpu-particles-spawn',
      layout: computeLayout,
      compute: { module: computeMod, entryPoint: 'cs_spawn' },
    }),
    device.createComputePipelineAsync({
      label: 'gpu-particles-step',
      layout: computeLayout,
      compute: { module: computeMod, entryPoint: 'cs_spawn_and_step' },
    }),
    device.createRenderPipelineAsync({
      label: 'gpu-particles-render',
      layout: renderLayout,
      vertex: { module: renderMod, entryPoint: 'vs' },
      fragment: {
        module: renderMod,
        entryPoint: 'fs',
        targets: [{ format: colorFormat, blend: { color: blend, alpha: blend } }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      ...(options.depthAttachmentFormat
        ? { depthStencil: { format: options.depthAttachmentFormat, depthWriteEnabled: false, depthCompare: 'less' } }
        : {}),
    }),
  ])

  // Persistent GPU buffers (zero per-frame allocations).
  const uniformBuffer = device.createBuffer({
    label: 'gpu-particles-uniforms',
    size: PARTICLE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const particleBuffer = device.createBuffer({
    label: 'gpu-particles-pool',
    size: capacity * PARTICLE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const spawnBuffer = device.createBuffer({
    label: 'gpu-particles-spawns',
    size: maxSpawnsPerFrame * PARTICLE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const simStateBuffer = device.createBuffer({
    label: 'gpu-particles-state',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const visibleIndicesBuffer = device.createBuffer({
    label: 'gpu-particles-visible-indices',
    size: capacity * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const indirectBuffer = device.createBuffer({
    label: 'gpu-particles-indirect',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const indirectResetBuffer = device.createBuffer({
    label: 'gpu-particles-indirect-reset',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  // Initialize indirect reset template: vertexCount = 6, instanceCount = 0, firstVertex = 0, firstInstance = 0.
  device.queue.writeBuffer(indirectResetBuffer, 0, new Uint32Array([6, 0, 0, 0]))
  device.queue.writeBuffer(indirectBuffer, 0, new Uint32Array([6, 0, 0, 0]))

  // 1x1 dummy depth texture for compute when caller does not supply collisionDepth.
  const dummyDepthTex = device.createTexture({
    label: 'gpu-particles-dummy-depth',
    size: [1, 1],
    format: 'depth24plus',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const dummyDepthView = dummyDepthTex.createView()

  // Pre-allocated CPU staging arrays (zero GC).
  const uniformAb = new ArrayBuffer(PARTICLE_UNIFORM_BYTES)
  const uniformF32 = new Float32Array(uniformAb)
  const uniformU32 = new Uint32Array(uniformAb)
  const spawnStagingAb = new ArrayBuffer(maxSpawnsPerFrame * PARTICLE_STRIDE_BYTES)
  const spawnStagingF32 = new Float32Array(spawnStagingAb)

  let pendingSpawns = 0
  let simTime = 0
  let cachedComputeDepth: GPUTextureView | null = null
  let cachedComputeBG: GPUBindGroup | null = null
  let cachedRenderDepth: GPUTextureView | null = null
  let cachedRenderBG: GPUBindGroup | null = null

  function getComputeBG(depthView: GPUTextureView): GPUBindGroup {
    if (cachedComputeBG && cachedComputeDepth === depthView) return cachedComputeBG
    cachedComputeDepth = depthView
    cachedComputeBG = device.createBindGroup({
      label: 'gpu-particles-compute-bg',
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: { buffer: spawnBuffer } },
        { binding: 3, resource: { buffer: simStateBuffer } },
        { binding: 4, resource: { buffer: visibleIndicesBuffer } },
        { binding: 5, resource: { buffer: indirectBuffer } },
        { binding: 6, resource: depthView },
      ],
    })
    return cachedComputeBG
  }

  function getRenderBG(depthView: GPUTextureView): GPUBindGroup {
    if (cachedRenderBG && cachedRenderDepth === depthView) return cachedRenderBG
    cachedRenderDepth = depthView
    cachedRenderBG = device.createBindGroup({
      label: 'gpu-particles-render-bg',
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: { buffer: visibleIndicesBuffer } },
        { binding: 3, resource: depthView },
      ],
    })
    return cachedRenderBG
  }

  function emitRaw(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    life: number,
    r: number, g: number, b: number,
    size: number,
    heat: number, buoyancy: number, drag: number,
    kind: ParticleKind, alpha: number, restitution: number, seed: number,
  ): boolean {
    if (pendingSpawns >= maxSpawnsPerFrame || life <= 0) return false
    const o = pendingSpawns * PARTICLE_STRIDE_FLOATS
    spawnStagingF32[o + 0] = px
    spawnStagingF32[o + 1] = py
    spawnStagingF32[o + 2] = pz
    spawnStagingF32[o + 3] = 0 // age
    spawnStagingF32[o + 4] = vx
    spawnStagingF32[o + 5] = vy
    spawnStagingF32[o + 6] = vz
    spawnStagingF32[o + 7] = life
    spawnStagingF32[o + 8] = r
    spawnStagingF32[o + 9] = g
    spawnStagingF32[o + 10] = b
    spawnStagingF32[o + 11] = size
    spawnStagingF32[o + 12] = heat
    spawnStagingF32[o + 13] = buoyancy
    spawnStagingF32[o + 14] = drag
    spawnStagingF32[o + 15] = packParticleMetaW(kind, alpha, restitution, seed)
    pendingSpawns++
    return true
  }

  function emit(opts: ParticleEmitOptions): boolean {
    const v = opts.vel
    const c = opts.color
    return emitRaw(
      opts.pos[0], opts.pos[1], opts.pos[2],
      v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0,
      opts.life,
      c ? c[0] : 0.85, c ? c[1] : 0.85, c ? c[2] : 0.85,
      opts.size ?? 1.5,
      opts.heat ?? 0,
      opts.buoyancy ?? 0,
      opts.drag ?? 0.5,
      opts.kind ?? PARTICLE_SMOKE,
      opts.alpha ?? 0.75,
      opts.restitution ?? 0.35,
      opts.seed ?? ((pendingSpawns * 73) & 255),
    )
  }

  function step(encoder: GPUCommandEncoder, opts: GpuParticlesStepOptions): void {
    const dt = Math.max(0, opts.dt)
    simTime += dt

    const vw = Math.max(1, opts.viewport[0])
    const vh = Math.max(1, opts.viewport[1])
    const aspect = vw / vh
    const near = opts.near ?? NEAR
    const far = opts.far ?? FAR
    const cam = opts.camera
    const wind = opts.wind ?? [4, 0, 1]
    const sun = opts.sun ?? [0.5088, 0.7632, 0.3976]
    const sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1

    const spawnCount = pendingSpawns
    if (spawnCount > 0) {
      device.queue.writeBuffer(spawnBuffer, 0, spawnStagingF32, 0, spawnCount * PARTICLE_STRIDE_FLOATS)
      pendingSpawns = 0
    }

    const groundBounce = opts.groundBounce !== false
    const screenBounce = Boolean(opts.screenBounce && opts.collisionDepth)
    const frustumCull = opts.frustumCull !== false
    const flags = (groundBounce ? 1 : 0) | (screenBounce ? 2 : 0) | (frustumCull ? 4 : 0)

    // Pack uniforms (240 bytes, 16-byte aligned vec4 fields).
    uniformF32[0] = cam.eye[0]; uniformF32[1] = cam.eye[1]; uniformF32[2] = cam.eye[2]; uniformF32[3] = dt
    uniformF32[4] = cam.right[0]; uniformF32[5] = cam.right[1]; uniformF32[6] = cam.right[2]; uniformF32[7] = aspect
    uniformF32[8] = cam.up[0]; uniformF32[9] = cam.up[1]; uniformF32[10] = cam.up[2]; uniformF32[11] = cam.tanHalf
    uniformF32[12] = cam.forward[0]; uniformF32[13] = cam.forward[1]; uniformF32[14] = cam.forward[2]; uniformF32[15] = near
    uniformF32[16] = wind[0]; uniformF32[17] = wind[1]; uniformF32[18] = wind[2]; uniformF32[19] = far
    uniformF32[20] = sun[0] / sunLen; uniformF32[21] = sun[1] / sunLen; uniformF32[22] = sun[2] / sunLen; uniformF32[23] = opts.day ?? 1
    uniformF32[24] = opts.gravity ?? -98
    uniformF32[25] = opts.groundY ?? 0
    uniformF32[26] = opts.turbulence ?? 12
    uniformF32[27] = simTime
    uniformF32[28] = opts.softDepthRange ?? 6
    uniformF32[29] = opts.smokeGrowRate ?? 1.2
    uniformF32[30] = vw
    uniformF32[31] = vh
    uniformU32[32] = capacity
    uniformU32[33] = capacityMask
    uniformU32[34] = spawnCount
    uniformU32[35] = flags
    writeFrustumPlanesFromCamera(uniformF32, 36, cam, aspect, near, far)

    device.queue.writeBuffer(uniformBuffer, 0, uniformU32)

    // Reset indirect draw args on GPU timeline: vertexCount = 6, instanceCount = 0.
    encoder.copyBufferToBuffer(indirectResetBuffer, 0, indirectBuffer, 0, DRAW_INDIRECT_BYTES)

    const depthView = screenBounce && opts.collisionDepth ? opts.collisionDepth : dummyDepthView
    const computeBG = getComputeBG(depthView)

    const pass = encoder.beginComputePass(
      opts.timestampWrites ? { label: 'gpu-particles-step', timestampWrites: opts.timestampWrites } : { label: 'gpu-particles-step' },
    )
    pass.setBindGroup(0, computeBG)
    if (spawnCount > 0) {
      pass.setPipeline(spawnPipe)
      pass.dispatchWorkgroups(Math.ceil(spawnCount / 64))
    }
    pass.setPipeline(stepPipe)
    pass.dispatchWorkgroups(capacity >>> 6)
    pass.end()
  }

  function draw(renderPass: GPURenderPassEncoder, opts: GpuParticlesDrawOptions): void {
    const bg = getRenderBG(opts.depth)
    renderPass.setPipeline(renderPipe)
    renderPass.setBindGroup(0, bg)
    renderPass.drawIndirect(indirectBuffer, 0)
  }

  function clear(encoder: GPUCommandEncoder): void {
    pendingSpawns = 0
    encoder.clearBuffer(particleBuffer, 0, capacity * PARTICLE_STRIDE_BYTES)
    encoder.clearBuffer(simStateBuffer, 0, 16)
    encoder.copyBufferToBuffer(indirectResetBuffer, 0, indirectBuffer, 0, DRAW_INDIRECT_BYTES)
  }

  function destroy(): void {
    uniformBuffer.destroy()
    particleBuffer.destroy()
    spawnBuffer.destroy()
    simStateBuffer.destroy()
    visibleIndicesBuffer.destroy()
    indirectBuffer.destroy()
    indirectResetBuffer.destroy()
    dummyDepthTex.destroy()
    cachedComputeBG = null
    cachedComputeDepth = null
    cachedRenderBG = null
    cachedRenderDepth = null
  }

  return {
    capacity,
    maxSpawnsPerFrame,
    usesSubgroups,
    particleBuffer,
    visibleIndicesBuffer,
    indirectBuffer,
    get pendingSpawns() { return pendingSpawns },
    emit,
    emitRaw,
    step,
    draw,
    clear,
    destroy,
  }
}

// ── 2. GPU Compute Frustum Culler & Indirect Draw Batcher ───────────────────

export interface IndirectCullerOptions {
  /** Maximum rigid-body instances supported (default 4,096). */
  maxInstances?: number
  /** Number of per-bucket indirect draw slots (default 64). */
  maxBuckets?: number
  /** Default vertex count written into the global `drawIndirectBuffer` (default 36). */
  defaultVertexCount?: number
  /** Default firstVertex written into the global `drawIndirectBuffer` (default 0). */
  defaultFirstVertex?: number
  /** Force disabling WebGPU `subgroups` even when the device supports it. */
  forceNoSubgroups?: boolean
}

export interface IndirectCullDispatchOptions {
  /** Number of active instances in `instanceBuffer` to test (`0..maxInstances`). */
  instanceCount: number
  /** Camera basis for extracting 6 frustum planes (mutually exclusive with `viewProj` / `frustumPlanes`). */
  camera?: GpuCamera
  /** Viewport aspect ratio (`width / height`), used with `camera`. */
  aspect?: number
  /** Near clip plane (default `NEAR = 1`), used with `camera`. */
  near?: number
  /** Far clip plane (default `FAR = 100000`), used with `camera`. */
  far?: number
  /** Alternative column-major WebGPU view-projection matrix (16 floats). */
  viewProj?: Float32Array
  /** Alternative 6 pre-extracted inward-pointing unit frustum planes. */
  frustumPlanes?: readonly FrustumPlane[]
  /** Enable tight AABB test after fast sphere test (default `true`). */
  testAabb?: boolean
  /** Write per-visible-instance `DrawIndirectArgs` entries into `multiDrawIndirectBuffer` (default `true`). */
  writeMultiDraw?: boolean
  /** Accumulate per-bucket counts into `bucketIndirectBuffer` (default `true`). */
  updateBuckets?: boolean
  /** Optional compute pass timestamp writes. */
  timestampWrites?: GPUComputePassTimestampWrites
}

export interface IndirectCuller {
  readonly maxInstances: number
  readonly maxBuckets: number
  readonly usesSubgroups: boolean
  /** Input 64-byte `CullInstance` storage buffer. */
  readonly instanceBuffer: GPUBuffer
  /** Compacted visible `instanceId` (`u32`) storage buffer. */
  readonly visibleInstanceIdsBuffer: GPUBuffer
  /** Global 16-byte `DrawIndirectArgs` buffer (`[vertexCount, visibleCount, firstVertex, 0]`). */
  readonly drawIndirectBuffer: GPUBuffer
  /** Per-visible-instance compacted `DrawIndirectArgs` array (`maxInstances * 16` bytes). */
  readonly multiDrawIndirectBuffer: GPUBuffer
  /** Per-bucket `DrawIndirectArgs` array (`maxBuckets * 16` bytes). */
  readonly bucketIndirectBuffer: GPUBuffer
  /** Write one rigid-body instance into CPU staging memory (zero allocations). */
  setInstance(
    slot: number,
    cx: number, cy: number, cz: number, radius: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    vertexCount: number, firstVertex: number, instanceId: number, flags?: number,
  ): void
  /** Configure a bucket's static `(vertexCount, firstVertex, firstInstance)` template for `bucketIndirectBuffer`. */
  configureBucket(bucket: number, vertexCount: number, firstVertex?: number, firstInstance?: number): void
  /** Upload `count` staged instances (`0..maxInstances`) to GPU via a single `writeBuffer`. */
  upload(count: number): void
  /** Reset indirect counters on GPU and dispatch 6-plane sphere + AABB compute frustum culling. */
  dispatch(encoder: GPUCommandEncoder, options: IndirectCullDispatchOptions): void
  /** Destroy all GPU resources owned by this culler. */
  destroy(): void
}

function buildCullerComputeWgsl(useSubgroups: boolean): string {
  const header = useSubgroups ? 'enable subgroups;\n' : ''
  const sharedDecl = useSubgroups
    ? ''
    : `
var<workgroup> wgCount: atomic<u32>;
var<workgroup> wgBase: u32;
`

  const compactBlock = useSubgroups
    ? /* wgsl */ `
  let ballot = subgroupBallot(visible);
  let sgCount = subgroupAdd(select(0u, 1u, visible));
  let sgOffset = subgroupExclusiveAdd(select(0u, 1u, visible));
  let isLeader = subgroupElect();
  var sgBase = 0u;
  if (isLeader && any(ballot != vec4u(0u))) {
    sgBase = atomicAdd(&drawArgs.instanceCount, sgCount);
  }
  let baseSlot = subgroupBroadcastFirst(sgBase);
  let outSlot = baseSlot + sgOffset;
`
    : /* wgsl */ `
  if (lid.x == 0u) {
    atomicStore(&wgCount, 0u);
  }
  workgroupBarrier();

  var localOffset = 0u;
  if (visible) {
    localOffset = atomicAdd(&wgCount, 1u);
  }
  workgroupBarrier();

  if (lid.x == 0u) {
    let total = atomicLoad(&wgCount);
    if (total > 0u) {
      wgBase = atomicAdd(&drawArgs.instanceCount, total);
    }
  }
  workgroupBarrier();

  let outSlot = wgBase + localOffset;
`

  return /* wgsl */ `${header}
struct CullInstance {
  centerRadius: vec4f, // xyz = sphere center, w = radius (< 0 => inactive)
  aabbMin: vec4f,      // xyz = world AABB min, w = unused
  aabbMax: vec4f,      // xyz = world AABB max, w = unused
  meshDrawArgs: vec4u, // x = vertexCount, y = firstVertex, z = instanceId, w = flags (low 16b = bucket, bit 31 = disabled)
}

struct CullUniforms {
  counts: vec4u,   // x = instanceCount, y = maxInstances, z = maxBuckets, w = flags
  defaults: vec4u, // x = defaultVertexCount, y = defaultFirstVertex, z = 0, w = 0
  planes: array<vec4f, 6>,
}

struct DrawIndirectArgsAtomic {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
}

struct DrawIndirectArgsPlain {
  vertexCount: u32,
  instanceCount: u32,
  firstVertex: u32,
  firstInstance: u32,
}

@group(0) @binding(0) var<uniform> u: CullUniforms;
@group(0) @binding(1) var<storage, read> instances: array<CullInstance>;
@group(0) @binding(2) var<storage, read_write> visibleInstanceIds: array<u32>;
@group(0) @binding(3) var<storage, read_write> drawArgs: DrawIndirectArgsAtomic;
@group(0) @binding(4) var<storage, read_write> multiDrawArgs: array<DrawIndirectArgsPlain>;
@group(0) @binding(5) var<storage, read_write> bucketDrawArgs: array<DrawIndirectArgsAtomic>;
${sharedDecl}

fn testFrustumSphereAabb(center: vec3f, radius: f32, bMin: vec3f, bMax: vec3f, useAabb: bool) -> bool {
  // 1. Fast bounding sphere rejection against all 6 planes.
  for (var i = 0u; i < 6u; i++) {
    let pl = u.planes[i];
    if (dot(pl.xyz, center) + pl.w < -radius) {
      return false;
    }
  }
  // 2. Tight world AABB p-vertex rejection against all 6 planes.
  if (useAabb && bMax.x >= bMin.x && bMax.y >= bMin.y && bMax.z >= bMin.z) {
    for (var i = 0u; i < 6u; i++) {
      let pl = u.planes[i];
      let pVertex = select(bMin, bMax, pl.xyz >= vec3f(0.0));
      if (dot(pl.xyz, pVertex) + pl.w < 0.0) {
        return false;
      }
    }
  }
  return true;
}

@compute @workgroup_size(64, 1, 1)
fn cs_cull(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
) {
  let idx = gid.x;
  var visible = false;
  var meshArgs = vec4u(0u);

  if (idx < u.counts.x) {
    let inst = instances[idx];
    let disabled = (inst.meshDrawArgs.w & 0x80000000u) != 0u;
    if (!disabled && inst.centerRadius.w >= 0.0) {
      let useAabb = (u.counts.w & 1u) != 0u;
      visible = testFrustumSphereAabb(
        inst.centerRadius.xyz,
        inst.centerRadius.w,
        inst.aabbMin.xyz,
        inst.aabbMax.xyz,
        useAabb,
      );
      if (visible) {
        meshArgs = inst.meshDrawArgs;
      }
    }
  }
${compactBlock}
  if (visible) {
    visibleInstanceIds[outSlot] = meshArgs.z;
    if ((u.counts.w & 2u) != 0u) {
      multiDrawArgs[outSlot] = DrawIndirectArgsPlain(meshArgs.x, 1u, meshArgs.y, meshArgs.z);
    }
    if ((u.counts.w & 4u) != 0u) {
      let bucket = meshArgs.w & 0xffffu;
      if (bucket < u.counts.z) {
        atomicAdd(&bucketDrawArgs[bucket].instanceCount, 1u);
      }
    }
  }
}
`
}

export async function createIndirectCuller(
  device: GPUDevice,
  options: IndirectCullerOptions = {},
): Promise<IndirectCuller> {
  const maxInstances = Math.max(64, Math.floor(options.maxInstances ?? DEFAULT_CULLER_MAX_INSTANCES))
  const maxBuckets = Math.max(1, Math.floor(options.maxBuckets ?? DEFAULT_CULLER_MAX_BUCKETS))
  const defaultVertexCount = Math.max(0, Math.floor(options.defaultVertexCount ?? 36))
  const defaultFirstVertex = Math.max(0, Math.floor(options.defaultFirstVertex ?? 0))
  const usesSubgroups = !options.forceNoSubgroups && hasDeviceSubgroups(device)

  const mod = await shader(
    device,
    `gpu-indirect-culler${usesSubgroups ? '-sg' : '-wg'}`,
    buildCullerComputeWgsl(usesSubgroups),
  )

  const bgl = device.createBindGroupLayout({
    label: 'gpu-culler-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const pipeline = await device.createComputePipelineAsync({
    label: 'gpu-culler-pipeline',
    layout: device.createPipelineLayout({ label: 'gpu-culler-layout', bindGroupLayouts: [bgl] }),
    compute: { module: mod, entryPoint: 'cs_cull' },
  })

  const uniformBuffer = device.createBuffer({
    label: 'gpu-culler-uniforms',
    size: CULL_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const instanceBuffer = device.createBuffer({
    label: 'gpu-culler-instances',
    size: maxInstances * CULL_INSTANCE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const visibleInstanceIdsBuffer = device.createBuffer({
    label: 'gpu-culler-visible-ids',
    size: maxInstances * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const drawIndirectBuffer = device.createBuffer({
    label: 'gpu-culler-draw-indirect',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const drawResetBuffer = device.createBuffer({
    label: 'gpu-culler-draw-reset',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const multiDrawIndirectBuffer = device.createBuffer({
    label: 'gpu-culler-multi-draw-indirect',
    size: maxInstances * DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const bucketIndirectBuffer = device.createBuffer({
    label: 'gpu-culler-bucket-indirect',
    size: maxBuckets * DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const bucketResetBuffer = device.createBuffer({
    label: 'gpu-culler-bucket-reset',
    size: maxBuckets * DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })

  // Initialize reset templates.
  device.queue.writeBuffer(drawResetBuffer, 0, new Uint32Array([defaultVertexCount, 0, defaultFirstVertex, 0]))
  const bucketTemplate = new Uint32Array(new ArrayBuffer(maxBuckets * DRAW_INDIRECT_BYTES))
  for (let b = 0; b < maxBuckets; b++) {
    bucketTemplate[b * 4 + 0] = defaultVertexCount
    bucketTemplate[b * 4 + 1] = 0
    bucketTemplate[b * 4 + 2] = defaultFirstVertex
    bucketTemplate[b * 4 + 3] = 0
  }
  device.queue.writeBuffer(bucketResetBuffer, 0, bucketTemplate)
  let bucketTemplateDirty = false

  const bindGroup = device.createBindGroup({
    label: 'gpu-culler-bg',
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: instanceBuffer } },
      { binding: 2, resource: { buffer: visibleInstanceIdsBuffer } },
      { binding: 3, resource: { buffer: drawIndirectBuffer } },
      { binding: 4, resource: { buffer: multiDrawIndirectBuffer } },
      { binding: 5, resource: { buffer: bucketIndirectBuffer } },
    ],
  })

  // Pre-allocated CPU staging views (zero GC).
  const stagingAb = new ArrayBuffer(maxInstances * CULL_INSTANCE_STRIDE_BYTES)
  const stagingF32 = new Float32Array(stagingAb)
  const stagingU32 = new Uint32Array(stagingAb)
  const uniformAb = new ArrayBuffer(CULL_UNIFORM_BYTES)
  const uniformF32 = new Float32Array(uniformAb)
  const uniformU32 = new Uint32Array(uniformAb)

  function setInstance(
    slot: number,
    cx: number, cy: number, cz: number, radius: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    vertexCount: number, firstVertex: number, instanceId: number, flags = 0,
  ): void {
    if (slot < 0 || slot >= maxInstances) return
    const o = slot * CULL_INSTANCE_STRIDE_WORDS
    stagingF32[o + 0] = cx
    stagingF32[o + 1] = cy
    stagingF32[o + 2] = cz
    stagingF32[o + 3] = radius
    stagingF32[o + 4] = minX
    stagingF32[o + 5] = minY
    stagingF32[o + 6] = minZ
    stagingF32[o + 7] = 0
    stagingF32[o + 8] = maxX
    stagingF32[o + 9] = maxY
    stagingF32[o + 10] = maxZ
    stagingF32[o + 11] = 0
    stagingU32[o + 12] = vertexCount >>> 0
    stagingU32[o + 13] = firstVertex >>> 0
    stagingU32[o + 14] = instanceId >>> 0
    stagingU32[o + 15] = flags >>> 0
  }

  function configureBucket(bucket: number, vertexCount: number, firstVertex = 0, firstInstance = 0): void {
    if (bucket < 0 || bucket >= maxBuckets) return
    const o = bucket * 4
    bucketTemplate[o + 0] = vertexCount >>> 0
    bucketTemplate[o + 1] = 0
    bucketTemplate[o + 2] = firstVertex >>> 0
    bucketTemplate[o + 3] = firstInstance >>> 0
    bucketTemplateDirty = true
  }

  function upload(count: number): void {
    const n = Math.max(0, Math.min(maxInstances, Math.floor(count)))
    if (n === 0) return
    device.queue.writeBuffer(instanceBuffer, 0, stagingU32, 0, n * CULL_INSTANCE_STRIDE_WORDS)
  }

  function dispatch(encoder: GPUCommandEncoder, opts: IndirectCullDispatchOptions): void {
    const instanceCount = Math.max(0, Math.min(maxInstances, Math.floor(opts.instanceCount)))
    const testAabb = opts.testAabb !== false
    const writeMultiDraw = opts.writeMultiDraw !== false
    const updateBuckets = opts.updateBuckets !== false
    const flags = (testAabb ? 1 : 0) | (writeMultiDraw ? 2 : 0) | (updateBuckets ? 4 : 0)

    uniformU32[0] = instanceCount
    uniformU32[1] = maxInstances
    uniformU32[2] = maxBuckets
    uniformU32[3] = flags
    uniformU32[4] = defaultVertexCount
    uniformU32[5] = defaultFirstVertex
    uniformU32[6] = 0
    uniformU32[7] = 0

    if (opts.frustumPlanes) {
      for (let i = 0; i < 6; i++) {
        const pl = opts.frustumPlanes[i]
        uniformF32[8 + i * 4 + 0] = pl[0]
        uniformF32[8 + i * 4 + 1] = pl[1]
        uniformF32[8 + i * 4 + 2] = pl[2]
        uniformF32[8 + i * 4 + 3] = pl[3]
      }
    } else if (opts.viewProj) {
      writeFrustumPlanesFromViewProj(uniformF32, 8, opts.viewProj)
    } else if (opts.camera) {
      writeFrustumPlanesFromCamera(uniformF32, 8, opts.camera, opts.aspect ?? 16 / 9, opts.near ?? NEAR, opts.far ?? FAR)
    } else {
      throw new Error('createIndirectCuller.dispatch requires camera, viewProj, or frustumPlanes')
    }

    if (bucketTemplateDirty) {
      device.queue.writeBuffer(bucketResetBuffer, 0, bucketTemplate)
      bucketTemplateDirty = false
    }
    device.queue.writeBuffer(uniformBuffer, 0, uniformU32)

    // Reset indirect draw buffers on GPU timeline.
    encoder.copyBufferToBuffer(drawResetBuffer, 0, drawIndirectBuffer, 0, DRAW_INDIRECT_BYTES)
    if (updateBuckets) {
      encoder.copyBufferToBuffer(bucketResetBuffer, 0, bucketIndirectBuffer, 0, maxBuckets * DRAW_INDIRECT_BYTES)
    }

    if (instanceCount === 0) return

    const pass = encoder.beginComputePass(
      opts.timestampWrites ? { label: 'gpu-indirect-cull', timestampWrites: opts.timestampWrites } : { label: 'gpu-indirect-cull' },
    )
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(Math.ceil(instanceCount / 64))
    pass.end()
  }

  function destroy(): void {
    uniformBuffer.destroy()
    instanceBuffer.destroy()
    visibleInstanceIdsBuffer.destroy()
    drawIndirectBuffer.destroy()
    drawResetBuffer.destroy()
    multiDrawIndirectBuffer.destroy()
    bucketIndirectBuffer.destroy()
    bucketResetBuffer.destroy()
  }

  return {
    maxInstances,
    maxBuckets,
    usesSubgroups,
    instanceBuffer,
    visibleInstanceIdsBuffer,
    drawIndirectBuffer,
    multiDrawIndirectBuffer,
    bucketIndirectBuffer,
    setInstance,
    configureBucket,
    upload,
    dispatch,
    destroy,
  }
}
