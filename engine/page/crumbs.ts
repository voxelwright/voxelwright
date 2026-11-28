// What a blast throws (#140, #165, #166): small cubes, paint shards, matte wood splinters, and
// incandescent metallic/plasma sparks. Up to 16,384 particles simulate, frustum-cull, and compact
// directly on the GPU in a single WebGPU compute pass (`cs_step_crumbs`, `@workgroup_size(64)`)
// with automatic `subgroups` ballot/prefix-sum fast path + workgroup shared-memory fallback, and
// render via a single `pass.drawIndirect()` inside PR #209's shared TBDR overlay render pass.
import { depthFor, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { writeFrustumPlanesFromCamera, type GpuCamera } from './gpu-particles.ts'
import type { View } from './march.ts'

/** Maximum concurrent GPU-simulated debris crumbs and sparks (power of 2 for 256 x 64 workgroups). */
const MOST = 16384
/** Maximum carried cubes (gather.ts) drawn alongside GPU crumbs. */
const CARRIED_MOST = 4096
/** Floats per particle in the unified 64-byte GPU storage buffer. */
const STRIDE_FLOATS = 16
const STRIDE_BYTES = STRIDE_FLOATS * 4
/** Compute uniform buffer size in bytes (72 words = 288 bytes). */
const PARAMS_BYTES = 288
/** Indirect draw argument struct size in bytes (`[vertexCount, instanceCount, firstVertex, firstInstance]`). */
const DRAW_INDIRECT_BYTES = 16
/** Local heightfield grid sampled for GPU floor bounce fallback (16 x 16 = 256 samples). */
const FLOOR_N = 16
const FLOOR_STEP = 16 // 16 world cells (1.6 m) between samples -> covers 256 x 256 cells (25.6 m)

// Particle kind enum values (plain constants for erasableSyntaxOnly).
const KIND_BLOCK = 0
const KIND_SHARD = 1
const KIND_SPLINTER = 2
const KIND_SPARK = 3
const KIND_PLASMA = 4

// Particle flag bits.
const FLAG_EMISSIVE = 1
const FLAG_DEPTH_COLLIDE = 2
const FLAG_STREAK = 4

function hasDeviceSubgroups(device: GPUDevice): boolean {
  return (device.features as ReadonlySet<string>).has('subgroups')
}

const PARTICLE_STRUCT_WGSL = /* wgsl */ `
struct Particle {
  at: vec4f,      // xyz: pos relative to anchor, w: render edge (0 when dead)
  colour: vec4f,  // rgb: linear colour, a: spin angle (-1 block, >=0 shard, <=-2 splinter)
  vel: vec3f,     // cells/s
  life: f32,      // remaining seconds (<= 0 dead)
  baseEdge: f32,  // unshrunk edge
  rot: f32,       // spin scale / initial life
  kind: u32,      // 0 block, 1 shard, 2 splinter, 3 spark, 4 plasma
  flags: u32,     // bit 0 emissive, bit 1 depth-collide, bit 2 velocity-streak
}
`

// Build GPU compute shader: integrates pos, vel, rot, life, bounces off screen-space depth or
// local heightfield, performs 6-plane view-frustum culling, and compacts visible particle indices
// directly into `visibleIndices` + `drawArgs.instanceCount` (`vertexCount = 36` for 3D voxel cubes).
function buildComputeWgsl(useSubgroups: boolean): string {
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
${PARTICLE_STRUCT_WGSL}

struct Params {
  anchorShift: vec3f,
  dt: f32,
  anchor: vec3f,
  hasDepth: u32,
  floorOrigin: vec2f,
  floorStep: f32,
  defaultFloor: f32,
  useWorldMat: u32,
  count: u32,
  cullOn: u32,
  pad1: u32,
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  planes: array<vec4f, 6>,
}

struct DrawIndirectArgs {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var<storage, read> floorHeights: array<f32>;
@group(0) @binding(4) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> drawArgs: DrawIndirectArgs;
${sharedDecl}

fn sampleFloor(rx: f32, rz: f32) -> f32 {
  let wx = rx + params.anchor.x;
  let wz = rz + params.anchor.z;
  let gx = (wx - params.floorOrigin.x) / params.floorStep;
  let gz = (wz - params.floorOrigin.y) / params.floorStep;
  if (gx < 0.0 || gz < 0.0 || gx >= 15.0 || gz >= 15.0) {
    return params.defaultFloor - params.anchor.y;
  }
  let x0 = u32(floor(gx));
  let z0 = u32(floor(gz));
  let fx = fract(gx);
  let fz = fract(gz);
  let i00 = x0 + z0 * 16u;
  let h00 = floorHeights[i00];
  let h10 = floorHeights[i00 + 1u];
  let h01 = floorHeights[i00 + 16u];
  let h11 = floorHeights[i00 + 17u];
  let h0 = mix(h00, h10, fx);
  let h1 = mix(h01, h11, fx);
  return mix(h0, h1, fz) - params.anchor.y;
}

fn unproject(uv: vec2f, depth: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depth, 1.0);
  let worldH = params.invViewProj * ndc;
  let invW = 1.0 / max(abs(worldH.w), 1e-6) * select(-1.0, 1.0, worldH.w >= 0.0);
  var p = worldH.xyz * invW;
  if (params.useWorldMat != 0u) {
    p -= params.anchor;
  }
  return p;
}

fn inFrustumSphere(center: vec3f, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let pl = params.planes[i];
    if (dot(pl.xyz, center) + pl.w < -radius) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64, 1, 1)
fn cs_step_crumbs(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
) {
  let idx = gid.x;
  var visible = false;

  if (idx < params.count) {
    var pt = particles[idx];
    if (pt.life > 0.0) {
      let dt = params.dt;
      let prevPos = pt.at.xyz - params.anchorShift;
      let hasShift = any(params.anchorShift != vec3f(0.0));

      if (dt > 0.0) {
        pt.life -= dt;
        if (pt.life <= 0.0) {
          pt.at = vec4f(prevPos, 0.0);
          particles[idx] = pt;
        } else {
          let isSpark = (pt.kind == 3u) || (pt.kind == 4u);
          let gravity = select(98.0, 72.0, pt.kind == 4u);
          pt.vel.y -= gravity * dt;
          if (isSpark) {
            let airDrag = max(0.0, 1.0 - 0.65 * dt);
            pt.vel *= airDrag;
          }
          var nextPos = prevPos + pt.vel * dt;
          var collided = false;

          // Screen-space depth-buffer collision when a depth texture is bound.
          if (params.hasDepth != 0u && (pt.flags & 2u) != 0u) {
            let matOffset = select(vec3f(0.0), params.anchor, params.useWorldMat != 0u);
            let clip = params.viewProj * vec4f(nextPos + matOffset, 1.0);
            if (clip.w > 0.5) {
              let ndc = clip.xyz / clip.w;
              if (abs(ndc.x) <= 0.995 && abs(ndc.y) <= 0.995 && ndc.z > 0.0 && ndc.z < 0.999) {
                let dims = textureDimensions(depthTex);
                let fdims = vec2f(dims);
                let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
                let maxPx = vec2i(dims) - vec2i(1, 1);
                let px = clamp(vec2i(uv * fdims), vec2i(0, 0), maxPx);
                let dC = textureLoad(depthTex, px, 0);
                if (dC > 0.0001 && dC < 0.9995 && ndc.z > dC) {
                  let surfPos = unproject(uv, dC);
                  let thickness = max(4.0, length(pt.vel) * dt * 2.0 + 1.8);
                  let prevClip = params.viewProj * vec4f(prevPos + matOffset, 1.0);
                  let prevInFront = prevClip.w > 0.5 && (prevClip.z / prevClip.w) <= dC + 0.0005;
                  if (prevInFront || length(nextPos - surfPos) < thickness) {
                    let dR = textureLoad(depthTex, clamp(px + vec2i(1, 0), vec2i(0), maxPx), 0);
                    let dL = textureLoad(depthTex, clamp(px - vec2i(1, 0), vec2i(0), maxPx), 0);
                    let dD = textureLoad(depthTex, clamp(px + vec2i(0, 1), vec2i(0), maxPx), 0);
                    let dU = textureLoad(depthTex, clamp(px - vec2i(0, 1), vec2i(0), maxPx), 0);
                    let invDim = 1.0 / max(fdims, vec2f(1.0));
                    let useR = abs(dR - dC) <= abs(dL - dC);
                    let useD = abs(dD - dC) <= abs(dU - dC);
                    let pX = select(unproject(uv - vec2f(invDim.x, 0.0), dL), unproject(uv + vec2f(invDim.x, 0.0), dR), useR);
                    let pY = select(unproject(uv - vec2f(0.0, invDim.y), dU), unproject(uv + vec2f(0.0, invDim.y), dD), useD);
                    let tX = select(surfPos - pX, pX - surfPos, useR);
                    let tY = select(surfPos - pY, pY - surfPos, useD);
                    let rawN = cross(tY, tX);
                    let nLen = length(rawN);
                    var n = select(vec3f(0.0, 1.0, 0.0), rawN / max(nLen, 1e-6), nLen > 1e-5);
                    if (dot(n, pt.vel) > 0.0) { n = -n; }
                    let restitution = select(0.42, 0.62, isSpark);
                    pt.vel = reflect(pt.vel, n) * restitution;
                    nextPos = prevPos + n * 0.18;
                    collided = true;
                  }
                }
              }
            }
          }

          // Heightfield floor fallback (always protects against falling under the terrain).
          let floorPad = 1.0 + pt.baseEdge * select(0.14, 0.5, pt.kind == 0u);
          let floorY = sampleFloor(nextPos.x, nextPos.z) + floorPad;
          if (nextPos.y < floorY) {
            nextPos.y = floorY;
            let bounce = select(0.25, 0.52, isSpark);
            let dampXZ = select(0.5, 0.78, isSpark);
            pt.vel.y = abs(pt.vel.y) * bounce;
            pt.vel.x *= dampXZ;
            pt.vel.z *= dampXZ;
            collided = true;
          }

          // Spin shards and splinters while airborne.
          if (!collided && !isSpark && pt.colour.a != -1.0) {
            let dir = select(-1.0, 1.0, pt.colour.a >= 0.0);
            pt.colour.a += dir * dt * (6.0 + 0.14 * abs(pt.vel.y));
          }

          let shrinkSpan = select(0.35, 0.22, isSpark);
          let renderEdge = pt.baseEdge * min(1.0, pt.life / shrinkSpan);
          pt.at = vec4f(nextPos, renderEdge);
          particles[idx] = pt;

          if (renderEdge > 0.0001) {
            let cullRadius = renderEdge * select(1.25, 4.2, (pt.flags & 4u) != 0u);
            visible = (params.cullOn == 0u) || inFrustumSphere(nextPos, cullRadius);
          }
        }
      } else {
        if (hasShift) {
          pt.at = vec4f(prevPos, pt.at.w);
          particles[idx] = pt;
        }
        let renderEdge = pt.at.w;
        if (renderEdge > 0.0001) {
          let cullRadius = renderEdge * select(1.25, 4.2, (pt.flags & 4u) != 0u);
          visible = (params.cullOn == 0u) || inFrustumSphere(prevPos, cullRadius);
        }
      }
    } else if (pt.at.w != 0.0) {
      pt.at.w = 0.0;
      particles[idx] = pt;
    }
  }
${compactBlock}
}
`
}

const RENDER_COMMON_WGSL = /* wgsl */ `
${PARTICLE_STRUCT_WGSL}

struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, pad0: f32, forward: vec3f, pad1: f32, sun: vec3f, day: f32 }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) colour: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) seen: vec3f,
  @location(3) @interpolate(flat) glossy: f32,
  @location(4) @interpolate(flat) emissive: f32,
}
const NEAR = 1.0;
const FAR = 100000.0;

fn buildVertex(v: u32, pt: Particle) -> Out {
  var out: Out;
  let at = pt.at;
  if (at.w <= 0.0001) {
    out.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    out.colour = vec3f(0.0);
    out.n = vec3f(0.0, 1.0, 0.0);
    out.seen = vec3f(0.0);
    out.glossy = 0.0;
    out.emissive = 0.0;
    return out;
  }
  // Six faces of two triangles: which face, which corner.
  let face = v / 6u;
  let corner = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(1, 1), vec2f(0, 0), vec2f(1, 1), vec2f(0, 1))[v % 6u] - 0.5;
  let axis = face >> 1u;
  let side = f32(face & 1u) * 2.0 - 1.0;
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  if (axis == 0u) { p = vec3f(side * 0.5, corner.x, corner.y * side); n = vec3f(side, 0.0, 0.0); }
  else if (axis == 1u) { p = vec3f(corner.x * side, side * 0.5, corner.y); n = vec3f(0.0, side, 0.0); }
  else { p = vec3f(corner.x, corner.y * side, side * 0.5); n = vec3f(0.0, 0.0, side); }

  let colour = pt.colour;
  let isEmissive = (pt.flags & 1u) != 0u;
  let isStreak = (pt.flags & 4u) != 0u;
  var shard = 0.0;

  if (isStreak) {
    // Stretch metallic/plasma sparks along their velocity vector into crisp glowing streaks.
    let spd = length(pt.vel);
    let stretch = clamp(spd * 0.032, 1.2, 7.5);
    let q = vec3f(p.x * 0.48, p.y * 0.48, p.z * stretch);
    let dir = select(vec3f(0.0, 1.0, 0.0), pt.vel / max(spd, 1e-4), spd > 0.1);
    let upRef = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.92);
    let sRight = normalize(cross(upRef, dir));
    let sUp = cross(dir, sRight);
    p = sRight * q.x + sUp * q.y + dir * q.z;
    n = normalize(sRight * n.x + sUp * n.y + dir * n.z);
  } else {
    // Paint has a positive spin angle. Matte splinters count down from -2. Block debris uses -1.
    shard = step(0.0, colour.a);
    if (colour.a != -1.0) {
      p *= select(vec3f(1.90, 0.23, 0.43), vec3f(1.45, 0.24, 0.95), shard > 0.5);
      let a = select(-2.0 - colour.a, colour.a, shard > 0.5);
      let ca = cos(a); let sa = sin(a);
      let cb = cos(a * 0.63 + 0.7); let sb = sin(a * 0.63 + 0.7);
      p = vec3f(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca);
      p = vec3f(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
      n = vec3f(n.x * ca - n.z * sa, n.y, n.x * sa + n.z * ca);
      n = normalize(vec3f(n.x, n.y * cb - n.z * sb, n.y * sb + n.z * cb));
    }
  }
  let world = at.xyz + p * at.w - u.eye;
  let d = dot(world, u.forward);
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.colour = colour.rgb;
  out.n = n;
  out.seen = world;
  out.glossy = shard;
  out.emissive = select(0.0, clamp(0.65 + pt.life * 1.6, 0.55, 2.2), isEmissive);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  if (in.emissive > 0.0) {
    // Incandescent sparks & molten plasma droplets sit above glow.ts's bloom threshold.
    let hot = in.colour * in.emissive;
    let tone = hot / (hot + 0.55) * 1.48;
    return vec4f(clamp(tone, vec3f(0.0), vec3f(1.0)), 1.0);
  }
  let above = 0.5 + 0.5 * in.n.y;
  var col = in.colour * (vec3f(1.0, 0.94, 0.84) * max(dot(in.n, u.sun), 0.0) * 2.4 * u.day + mix(vec3f(0.1, 0.095, 0.09), vec3f(0.3, 0.38, 0.5), above) * mix(0.06, 1.0, u.day));
  if (in.glossy > 0.5) {
    let rd = normalize(in.seen);
    let hv = normalize(u.sun - rd);
    col += vec3f(1.0, 0.96, 0.88) * pow(max(dot(in.n, hv), 0.0), 42.0) * 1.4 * u.day;
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

const RENDER_INDIRECT_WGSL = /* wgsl */ `
${RENDER_COMMON_WGSL}
@group(0) @binding(2) var<storage, read> visibleIndices: array<u32>;

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) instIdx: u32) -> Out {
  let pIdx = visibleIndices[instIdx];
  return buildVertex(v, particles[pIdx]);
}
`

const RENDER_DIRECT_WGSL = /* wgsl */ `
${RENDER_COMMON_WGSL}

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) instIdx: u32) -> Out {
  return buildVertex(v, particles[instIdx]);
}
`

export interface SparkOptions {
  /** Preferred spray direction (normalized internally). If omitted, sprays in an upward-biased burst. */
  dir?: readonly [number, number, number]
  /** Cone spread around `dir` (default 0.85). */
  spread?: number
  /** Launch speed in finest world cells/s (default 110). */
  speed?: number
  /** Base linear RGB colour (defaults to incandescent yellow-orange or molten plasma amber). */
  colour?: readonly [number, number, number]
  /** Nominal lifetime in seconds (default 0.55, or 0.75 for molten plasma). */
  lasts?: number
  /** Base spark edge size in finest cells (default 0.16). */
  size?: number
  /** Molten plasma droplet mode: slower gravity, richer amber-orange glow, slightly longer life. */
  plasma?: boolean
}

export interface Crumbs {
  /** Throws `count` crumbs of one colour (linear red, green, blue) out of a ball at `at` (finest cells, the world's), `radius` cells across. */
  /** `lasts` is how many seconds they are there for (a few, unless said); `fast` how hard they are thrown, 1 as a blast throws. */
  burst(at: readonly [number, number, number], radius: number, count: number, colour: readonly [number, number, number], edge: number, lasts?: number, fast?: number, shard?: boolean | 'splinter'): void
  /** Small bits released by the core. Wood and foliage break into matte slivers. */
  dust(at: readonly [number, number, number], kind: number, amount: number, colour: readonly [number, number, number]): void
  /** Throws bright incandescent sparks (metallic parry sparks, ricochet sparks, molten plasma droplets) with GPU depth-bounce physics (#166). */
  spark(at: readonly [number, number, number], count?: number, options?: SparkOptions): void
  /**
   * Binds (or clears) a scene depth texture for GPU screen-space collision bounce.
   * When `viewProj` / `invViewProj` are omitted, they are built automatically from the frame's `View`.
   */
  setDepthSource(
    depthTex: GPUTexture | GPUTextureView | null,
    viewProj?: Float32Array | readonly number[],
    invViewProj?: Float32Array | readonly number[],
  ): void
  /** Moves them `dt` seconds on. `ground` says how high the land is at a column. */
  step(dt: number, ground: (x: number, z: number) => number): void
  /** Uploads spawns/uniforms and dispatches the GPU compute integration + frustum-cull compaction pass BEFORE a render pass begins; returns true when crumbs/sparks/carried cubes will draw. */
  prepare(encoder: GPUCommandEncoder, to: Target, view: View): boolean
  /** Tells the next `draw()` call to run `prepare()` (including any wrappers on `draw`) and skip opening its own render pass so the caller can invoke `record(sharedPass)` inside a merged TBDR pass. */
  defer(): void
  /** True when the most recent `prepare()` / deferred `draw()` has geometry ready for `record(pass)`. */
  readonly ready: boolean
  /** Records the prepared crumbs, sparks (`drawIndirect`) and carried cubes into an active `(to.color, to.depth)` render pass. */
  record(pass: GPURenderPassEncoder): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Where the light comes from and how much of the day it is. */
  light(sun: readonly number[], day: number): void
  readonly live: number
  /** True when integration and frustum compaction run in the WebGPU compute pipeline (0 ms main-thread particle stepping). */
  readonly gpuCompute: boolean
  /** Maximum concurrent particle slots (`16384`). */
  readonly capacity: number
  /** True when WebGPU `subgroups` ballot/prefix compaction is active (else workgroup shared-memory fallback). */
  readonly usesSubgroups: boolean
  /** GPU indirect draw arguments buffer (`[36, visibleCount, 0, 0]`) when compute is active, else null. */
  readonly indirectBuffer: GPUBuffer | null
  /**
   * Cubes that something else moves (the gathering at a place where a thing is being made, gather.ts): each of these
   * is asked every frame to `put` its cubes where they are now, and they are drawn with the crumbs, lit the same.
   */
  readonly carried: Set<(put: (x: number, y: number, z: number, edge: number, r: number, g: number, b: number) => void) => void>
}

/** Builds column-major `viewProj` and `invViewProj` matrices matching `march.ts` / `crumbs.ts` projection relative to `anchor`. */
function viewMatrices(view: View, aspect: number, anchor: readonly [number, number, number], vpOut: Float32Array, invOut: Float32Array): void {
  const ex = view.eye[0] - anchor[0]
  const ey = view.eye[1] - anchor[1]
  const ez = view.eye[2] - anchor[2]
  const rx = view.right[0], ry = view.right[1], rz = view.right[2]
  const ux = view.up[0], uy = view.up[1], uz = view.up[2]
  const fx = view.forward[0], fy = view.forward[1], fz = view.forward[2]
  const sx = 1 / (view.tanHalf * aspect)
  const sy = 1 / view.tanHalf
  const A = FAR / (FAR - NEAR)
  const B = -(FAR * NEAR) / (FAR - NEAR)
  const er = ex * rx + ey * ry + ez * rz
  const eu = ex * ux + ey * uy + ez * uz
  const ef = ex * fx + ey * fy + ez * fz

  // Column-major viewProj
  vpOut[0] = rx * sx; vpOut[1] = ux * sy; vpOut[2] = fx * A; vpOut[3] = fx
  vpOut[4] = ry * sx; vpOut[5] = uy * sy; vpOut[6] = fy * A; vpOut[7] = fy
  vpOut[8] = rz * sx; vpOut[9] = uz * sy; vpOut[10] = fz * A; vpOut[11] = fz
  vpOut[12] = -er * sx; vpOut[13] = -eu * sy; vpOut[14] = -ef * A + B; vpOut[15] = -ef

  // Exact analytical inverse invViewProj (unprojects WebGPU NDC x,y in [-1,1], z in [0,1] -> anchor-relative pos)
  const tx = view.tanHalf * aspect
  const ty = view.tanHalf
  const invB = 1 / B
  const negAOverB = -A * invB
  invOut[0] = rx * tx; invOut[1] = ry * tx; invOut[2] = rz * tx; invOut[3] = 0
  invOut[4] = ux * ty; invOut[5] = uy * ty; invOut[6] = uz * ty; invOut[7] = 0
  invOut[8] = ex * invB; invOut[9] = ey * invB; invOut[10] = ez * invB; invOut[11] = invB
  invOut[12] = fx + ex * negAOverB; invOut[13] = fy + ey * negAOverB; invOut[14] = fz + ez * negAOverB; invOut[15] = negAOverB
}

export async function crumbs(device: GPUDevice, format: GPUTextureFormat): Promise<Crumbs> {
  const usesSubgroups = hasDeviceSubgroups(device)

  // Explicit bind group layouts so storage bindings stay deterministic across drivers.
  const directRenderBGL = device.createBindGroupLayout({
    label: 'crumbs-direct-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const indirectRenderBGL = device.createBindGroupLayout({
    label: 'crumbs-indirect-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const computeBGL = device.createBindGroupLayout({
    label: 'crumbs-compute-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })

  const directRenderLayout = device.createPipelineLayout({ label: 'crumbs-direct-layout', bindGroupLayouts: [directRenderBGL] })
  const indirectRenderLayout = device.createPipelineLayout({ label: 'crumbs-indirect-layout', bindGroupLayouts: [indirectRenderBGL] })
  const computeLayout = device.createPipelineLayout({ label: 'crumbs-compute-layout', bindGroupLayouts: [computeBGL] })

  const [directModule, indirectModule, computeModule] = await Promise.all([
    shader(device, 'crumbs-direct', RENDER_DIRECT_WGSL),
    shader(device, 'crumbs-indirect', RENDER_INDIRECT_WGSL),
    typeof device.createComputePipelineAsync === 'function'
      ? shader(device, `crumbs-compute${usesSubgroups ? '-sg' : '-wg'}`, buildComputeWgsl(usesSubgroups)).catch(() => null)
      : Promise.resolve(null),
  ])

  const [pipelineDirect, pipelineIndirect, computePipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'crumbs-direct',
      layout: directRenderLayout,
      vertex: { module: directModule, entryPoint: 'vs' },
      fragment: { module: directModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    }),
    device.createRenderPipelineAsync({
      label: 'crumbs-indirect',
      layout: indirectRenderLayout,
      vertex: { module: indirectModule, entryPoint: 'vs' },
      fragment: { module: indirectModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    }),
    computeModule
      ? device.createComputePipelineAsync({
          label: 'crumbs-compute',
          layout: computeLayout,
          compute: { module: computeModule, entryPoint: 'cs_step_crumbs' },
        }).catch(() => null)
      : Promise.resolve(null),
  ])

  const useGpu = computePipeline !== null

  const uniforms = device.createBuffer({ label: 'crumbs uniforms', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const instances = device.createBuffer({
    label: 'crumb instances',
    size: MOST * STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const carriedInstances = device.createBuffer({
    label: 'carried crumbs',
    size: CARRIED_MOST * STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const visibleIndicesBuf = device.createBuffer({
    label: 'crumb visible indices',
    size: MOST * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const indirectBuf = device.createBuffer({
    label: 'crumb draw indirect',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const indirectResetBuf = device.createBuffer({
    label: 'crumb draw indirect reset',
    size: DRAW_INDIRECT_BYTES,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  // Reset template: 36 vertices per 3D voxel cube, 0 visible instances initially.
  device.queue.writeBuffer(indirectResetBuf, 0, new Uint32Array([36, 0, 0, 0]))
  device.queue.writeBuffer(indirectBuf, 0, new Uint32Array([36, 0, 0, 0]))

  const indirectBind = device.createBindGroup({
    label: 'crumbs-indirect-bg',
    layout: indirectRenderBGL,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: instances } },
      { binding: 2, resource: { buffer: visibleIndicesBuf } },
    ],
  })
  const cpuDirectBind = device.createBindGroup({
    label: 'crumbs-cpu-direct-bg',
    layout: directRenderBGL,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: instances } },
    ],
  })
  const carriedDirectBind = device.createBindGroup({
    label: 'crumbs-carried-direct-bg',
    layout: directRenderBGL,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: carriedInstances } },
    ],
  })

  // Compute pipeline resources (when compute is available).
  let computeUniforms: GPUBuffer | null = null
  let floorBuf: GPUBuffer | null = null
  let dummyDepthTex: GPUTexture | null = null
  let dummyDepthView: GPUTextureView | null = null
  let computeBind: GPUBindGroup | null = null
  let boundDepthView: GPUTextureView | null = null

  if (useGpu) {
    computeUniforms = device.createBuffer({ label: 'crumbs-compute-uniforms', size: PARAMS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    floorBuf = device.createBuffer({ label: 'crumbs-floor-heights', size: FLOOR_N * FLOOR_N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    dummyDepthTex = depthFor(device, [1, 1])
    dummyDepthView = dummyDepthTex.createView({ aspect: 'depth-only' })
    boundDepthView = dummyDepthView
    computeBind = device.createBindGroup({
      label: 'crumbs-compute-bg',
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: instances } },
        { binding: 1, resource: { buffer: computeUniforms } },
        { binding: 2, resource: dummyDepthView },
        { binding: 3, resource: { buffer: floorBuf } },
        { binding: 4, resource: { buffer: visibleIndicesBuf } },
        { binding: 5, resource: { buffer: indirectBuf } },
      ],
    })
  }

  // Depth collision source state.
  let depthSourceTex: GPUTexture | null = null
  let depthSourceView: GPUTextureView | null = null
  let customViewProj: Float32Array | null = null
  let customInvViewProj: Float32Array | null = null
  const autoViewProj = new Float32Array(16)
  const autoInvViewProj = new Float32Array(16)

  // Pre-allocated zero-GC staging buffers.
  const paramsRaw = new ArrayBuffer(PARAMS_BYTES)
  const paramsF32 = new Float32Array(paramsRaw)
  const paramsU32 = new Uint32Array(paramsRaw)
  const renderUniformF32 = new Float32Array(new ArrayBuffer(80))
  const floorHeights = new Float32Array(FLOOR_N * FLOOR_N)
  let floorOriginX = Infinity, floorOriginZ = Infinity, defaultFloor = 0

  // Reusable anchor/camera structs for zero-GC frustum plane extraction.
  const curAnchor: [number, number, number] = [0, 0, 0]
  const prevAnchorBuf: [number, number, number] = [0, 0, 0]
  const anchorEye: [number, number, number] = [0, 0, 0]
  const anchorCam: GpuCamera = {
    eye: anchorEye,
    forward: [0, 0, -1],
    right: [1, 0, 0],
    up: [0, 1, 0],
    tanHalf: 1,
  }

  // Pending-spawn ring (only newly spawned particles are uploaded via writeBuffer!).
  const spawnBuf = new ArrayBuffer(MOST * STRIDE_BYTES)
  const spawnF32 = new Float32Array(spawnBuf)
  const spawnU32 = new Uint32Array(spawnBuf)
  const pendingX = new Float64Array(MOST), pendingY = new Float64Array(MOST), pendingZ = new Float64Array(MOST)
  const pendingVx = new Float32Array(MOST), pendingVy = new Float32Array(MOST), pendingVz = new Float32Array(MOST)
  const pendingLife = new Float32Array(MOST), pendingEdge = new Float32Array(MOST), pendingSpin = new Float32Array(MOST)
  const pendingR = new Float32Array(MOST), pendingG = new Float32Array(MOST), pendingB = new Float32Array(MOST)
  const pendingKind = new Uint8Array(MOST), pendingFlags = new Uint8Array(MOST)
  let pendingStart = 0
  let pendingCount = 0

  // CPU fallback simulation state (allocated only when compute is unavailable).
  const cpuP = useGpu ? null : new Float64Array(MOST * 3)
  const cpuV = useGpu ? null : new Float32Array(MOST * 3)
  const cpuLife = useGpu ? null : new Float32Array(MOST)
  const cpuEdge = useGpu ? null : new Float32Array(MOST)
  const cpuTone = useGpu ? null : new Float32Array(MOST * 3)
  const cpuSpin = useGpu ? null : new Float32Array(MOST)
  const cpuKind = useGpu ? null : new Uint8Array(MOST)
  const cpuFlags = useGpu ? null : new Uint8Array(MOST)

  // Carried cubes staging buffer (64 bytes per cube matching storage stride).
  const carriedRaw = new ArrayBuffer(CARRIED_MOST * STRIDE_BYTES)
  const carriedF32 = new Float32Array(carriedRaw)
  const carriedU32 = new Uint32Array(carriedRaw)

  // O(1) expiry tracking for `live` on GPU path (no per-particle CPU loop in step()).
  let simTime = 0
  let maxExpire = 0
  let gpuAliveHint = 0
  let pendingDt = 0
  let lastAnchorX = 0, lastAnchorY = 0, lastAnchorZ = 0, hasAnchor = false
  let lastRefX = 0, lastRefZ = 0, hasRef = false
  let next = 0, cpuLive = 0
  let sun: readonly number[] = [0.52, 0.62, 0.59], sunLength = Math.hypot(sun[0], sun[1], sun[2]), day = 1
  const carried: Crumbs['carried'] = new Set()

  const emitParticle = (
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    l: number, sz: number,
    r: number, g: number, b: number,
    spinVal: number, kind: number, flags: number,
  ) => {
    const i = (next++) & (MOST - 1)
    lastRefX = x; lastRefZ = z; hasRef = true
    if (!useGpu && cpuP && cpuV && cpuLife && cpuEdge && cpuTone && cpuSpin && cpuKind && cpuFlags) {
      cpuP[i * 3] = x; cpuP[i * 3 + 1] = y; cpuP[i * 3 + 2] = z
      cpuV[i * 3] = vx; cpuV[i * 3 + 1] = vy; cpuV[i * 3 + 2] = vz
      cpuLife[i] = l; cpuEdge[i] = sz; cpuSpin[i] = spinVal
      cpuTone[i * 3] = r; cpuTone[i * 3 + 1] = g; cpuTone[i * 3 + 2] = b
      cpuKind[i] = kind; cpuFlags[i] = flags
      return
    }
    if (pendingCount === 0) pendingStart = i
    if (pendingCount < MOST) pendingCount++
    else pendingStart = (i + 1) & (MOST - 1)
    pendingX[i] = x; pendingY[i] = y; pendingZ[i] = z
    pendingVx[i] = vx; pendingVy[i] = vy; pendingVz[i] = vz
    pendingLife[i] = l; pendingEdge[i] = sz; pendingSpin[i] = spinVal
    pendingR[i] = r; pendingG[i] = g; pendingB[i] = b
    pendingKind[i] = kind; pendingFlags[i] = flags
    const expire = simTime + l
    if (expire > maxExpire) maxExpire = expire
    gpuAliveHint = Math.min(MOST, gpuAliveHint + 1)
  }

  const refreshFloorPatch = (cx: number, cz: number, ground: (x: number, z: number) => number) => {
    const ox = Math.floor((cx - (FLOOR_N * FLOOR_STEP) / 2) / FLOOR_STEP) * FLOOR_STEP
    const oz = Math.floor((cz - (FLOOR_N * FLOOR_STEP) / 2) / FLOOR_STEP) * FLOOR_STEP
    defaultFloor = ground(cx, cz)
    if (ox === floorOriginX && oz === floorOriginZ) return
    floorOriginX = ox
    floorOriginZ = oz
    for (let iz = 0; iz < FLOOR_N; iz++) {
      const wz = oz + iz * FLOOR_STEP
      const row = iz * FLOOR_N
      for (let ix = 0; ix < FLOOR_N; ix++) {
        floorHeights[row + ix] = ground(ox + ix * FLOOR_STEP, wz)
      }
    }
    if (floorBuf) device.queue.writeBuffer(floorBuf, 0, floorHeights)
  }

  const ensureComputeBind = () => {
    if (!computePipeline || !computeUniforms || !floorBuf || !dummyDepthView) return
    const targetView = depthSourceView ?? dummyDepthView
    if (targetView === boundDepthView && computeBind) return
    boundDepthView = targetView
    computeBind = device.createBindGroup({
      label: 'crumbs-compute-bg',
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: instances } },
        { binding: 1, resource: { buffer: computeUniforms } },
        { binding: 2, resource: targetView },
        { binding: 3, resource: { buffer: floorBuf } },
        { binding: 4, resource: { buffer: visibleIndicesBuf } },
        { binding: 5, resource: { buffer: indirectBuf } },
      ],
    })
  }

  const flushPendingSpawns = (anchor: readonly [number, number, number]) => {
    if (pendingCount === 0) return
    const ax = anchor[0], ay = anchor[1], az = anchor[2]
    const uploadSlice = (slotStart: number, count: number) => {
      for (let k = 0; k < count; k++) {
        const i = slotStart + k
        const o = k * STRIDE_FLOATS
        spawnF32[o] = pendingX[i] - ax
        spawnF32[o + 1] = pendingY[i] - ay
        spawnF32[o + 2] = pendingZ[i] - az
        spawnF32[o + 3] = pendingEdge[i]
        spawnF32[o + 4] = pendingR[i]
        spawnF32[o + 5] = pendingG[i]
        spawnF32[o + 6] = pendingB[i]
        spawnF32[o + 7] = pendingSpin[i]
        spawnF32[o + 8] = pendingVx[i]
        spawnF32[o + 9] = pendingVy[i]
        spawnF32[o + 10] = pendingVz[i]
        spawnF32[o + 11] = pendingLife[i]
        spawnF32[o + 12] = pendingEdge[i]
        spawnF32[o + 13] = pendingLife[i]
        spawnU32[o + 14] = pendingKind[i]
        spawnU32[o + 15] = pendingFlags[i]
      }
      device.queue.writeBuffer(instances, slotStart * STRIDE_BYTES, spawnF32, 0, count * STRIDE_FLOATS)
    }

    const firstCount = Math.min(pendingCount, MOST - pendingStart)
    uploadSlice(pendingStart, firstCount)
    const wrapped = pendingCount - firstCount
    if (wrapped > 0) uploadSlice(0, wrapped)
    pendingCount = 0
  }

  let preparedGpu = false, preparedCpu = 0, preparedCarried = 0, deferred = false
  const self: Crumbs = {
    carried,
    get ready() { return preparedGpu || preparedCpu > 0 || preparedCarried > 0 },
    defer() { deferred = true },
    get gpuCompute() { return useGpu },
    get capacity() { return MOST },
    get usesSubgroups() { return useGpu && usesSubgroups },
    get indirectBuffer() { return useGpu ? indirectBuf : null },
    light(from, isDay) { sun = from; sunLength = Math.hypot(sun[0], sun[1], sun[2]) || 1; day = isDay },
    get live() {
      if (!useGpu) return cpuLive
      return simTime < maxExpire ? gpuAliveHint : 0
    },
    setDepthSource(depthTex, viewProj, invViewProj) {
      if (!depthTex) {
        depthSourceTex = null
        depthSourceView = null
        customViewProj = null
        customInvViewProj = null
        return
      }
      if ('createView' in depthTex) {
        if (depthTex !== depthSourceTex) {
          depthSourceTex = depthTex
          depthSourceView = depthTex.createView({ aspect: 'depth-only' })
        }
      } else {
        depthSourceTex = null
        depthSourceView = depthTex
      }
      customViewProj = viewProj ? Float32Array.from(viewProj) : null
      customInvViewProj = invViewProj ? Float32Array.from(invViewProj) : null
    },
    dust(this: Crumbs, at, kind, amount, colour) {
      const material = kind & 15
      if (material === 10 || material === 13) {
        this.burst(at, 1.3, Math.min(28, amount), colour, 0.24, 2.5, 0.38, 'splinter')
      } else {
        this.burst(at, 2, amount * 3, colour, 0.8)
      }
    },
    burst(at, radius, count, colour, size, lasts = 2.5, fast = 1, shard = false) {
      const kind = shard === 'splinter' ? KIND_SPLINTER : shard ? KIND_SHARD : KIND_BLOCK
      const flags = FLAG_DEPTH_COLLIDE
      for (let k = 0; k < count; k++) {
        // Somewhere in the ball, thrown outwards and up.
        let dx = 0, dy = 0, dz = 0
        do { dx = Math.random() * 2 - 1; dy = Math.random() * 2 - 1; dz = Math.random() * 2 - 1 } while (dx * dx + dy * dy + dz * dz > 1)
        const speed = (25 + Math.random() * 60) * fast
        const l = lasts * (0.65 + Math.random() * 0.7)
        const edge = size * (0.6 + Math.random() * 0.8)
        let spinVal = shard ? Math.random() * 2 * Math.PI : -1
        if (shard === 'splinter') spinVal = -2 - spinVal
        const shade = 0.75 + Math.random() * 0.4
        emitParticle(
          at[0] + dx * radius, at[1] + dy * radius, at[2] + dz * radius,
          dx * speed, dy * speed + (20 + Math.random() * 30) * fast, dz * speed,
          l, edge,
          colour[0] * shade, colour[1] * shade, colour[2] * shade,
          spinVal, kind, flags,
        )
      }
    },
    spark(at, count = 24, options = {}) {
      const plasma = !!options.plasma
      const baseSpeed = options.speed ?? (plasma ? 85 : 115)
      const spread = options.spread ?? 0.85
      const lasts = options.lasts ?? (plasma ? 0.75 : 0.55)
      const baseSize = options.size ?? (plasma ? 0.20 : 0.16)
      const baseCol = options.colour ?? (plasma ? [1.0, 0.52, 0.12] : [1.0, 0.78, 0.28])
      const dir = options.dir
      const hasDir = !!dir && Math.hypot(dir[0], dir[1], dir[2]) > 1e-4
      const dLen = hasDir ? Math.hypot(dir[0], dir[1], dir[2]) : 1
      const dx0 = hasDir ? dir[0] / dLen : 0
      const dy0 = hasDir ? dir[1] / dLen : 0.45
      const dz0 = hasDir ? dir[2] / dLen : 0
      const kind = plasma ? KIND_PLASMA : KIND_SPARK
      const flags = FLAG_EMISSIVE | FLAG_DEPTH_COLLIDE | FLAG_STREAK

      for (let k = 0; k < count; k++) {
        let rx = 0, ry = 0, rz = 0
        do { rx = Math.random() * 2 - 1; ry = Math.random() * 2 - 1; rz = Math.random() * 2 - 1 } while (rx * rx + ry * ry + rz * rz > 1)
        let vx: number, vy: number, vz: number
        const spd = baseSpeed * (0.45 + Math.random() * 0.95)
        if (hasDir) {
          let sx = dx0 + rx * spread
          let sy = dy0 + ry * spread + 0.12
          let sz = dz0 + rz * spread
          const sl = Math.hypot(sx, sy, sz) || 1
          vx = (sx / sl) * spd
          vy = (sy / sl) * spd
          vz = (sz / sl) * spd
        } else {
          vx = rx * spd
          vy = Math.abs(ry) * spd * 0.75 + spd * 0.25
          vz = rz * spd
        }
        // Per-spark thermal shift: hotter sparks lean white-gold, cooler sparks lean deep amber.
        const hot = Math.random()
        const r = Math.min(1.0, baseCol[0] * (0.85 + 0.35 * hot))
        const g = Math.min(1.0, baseCol[1] * (0.65 + 0.55 * hot) + 0.15 * hot * hot)
        const b = Math.min(1.0, baseCol[2] * (0.5 + 0.7 * hot) + 0.35 * hot * hot * hot)
        emitParticle(
          at[0] + rx * 0.35, at[1] + ry * 0.35, at[2] + rz * 0.35,
          vx, vy, vz,
          lasts * (0.55 + Math.random() * 0.85),
          baseSize * (0.7 + Math.random() * 0.65),
          r, g, b,
          0, kind, flags,
        )
      }
    },
    step(dt, ground) {
      if (useGpu) {
        // Near-0 ms main-thread integration: accumulate dt for the GPU compute pass and keep floor patch warm.
        simTime += dt
        if (simTime >= maxExpire) {
          gpuAliveHint = 0
          pendingDt = 0
          return
        }
        pendingDt = Math.min(0.1, pendingDt + dt)
        if (hasAnchor) refreshFloorPatch(lastAnchorX + 32, lastAnchorZ + 32, ground)
        else if (hasRef) refreshFloorPatch(lastRefX, lastRefZ, ground)
        return
      }
      // Clean CPU fallback when compute shaders are unavailable.
      if (!cpuP || !cpuV || !cpuLife || !cpuEdge || !cpuTone || !cpuSpin || !cpuKind) return
      cpuLive = 0
      for (let i = 0; i < MOST; i++) {
        if (cpuLife[i] <= 0) continue
        cpuLife[i] -= dt
        cpuLive++
        const isSpark = cpuKind[i] === KIND_SPARK || cpuKind[i] === KIND_PLASMA
        cpuV[i * 3 + 1] -= (cpuKind[i] === KIND_PLASMA ? 72 : 98) * dt
        if (isSpark) {
          const drag = Math.max(0, 1 - 0.65 * dt)
          cpuV[i * 3] *= drag; cpuV[i * 3 + 1] *= drag; cpuV[i * 3 + 2] *= drag
        }
        for (let a = 0; a < 3; a++) cpuP[i * 3 + a] += cpuV[i * 3 + a] * dt
        const floor = ground(cpuP[i * 3], cpuP[i * 3 + 2]) + 1 + cpuEdge[i] * (cpuKind[i] === KIND_BLOCK ? 0.5 : 0.14)
        if (cpuP[i * 3 + 1] < floor) {
          cpuP[i * 3 + 1] = floor
          cpuV[i * 3 + 1] = Math.abs(cpuV[i * 3 + 1]) * (isSpark ? 0.52 : 0.25)
          const damp = isSpark ? 0.78 : 0.5
          cpuV[i * 3] *= damp; cpuV[i * 3 + 2] *= damp
        } else if (!isSpark && cpuSpin[i] !== -1) {
          cpuSpin[i] += Math.sign(cpuSpin[i] || 1) * dt * (6 + 0.14 * Math.abs(cpuV[i * 3 + 1]))
        }
      }
    },
    prepare(encoder, to, view) {
      const ax = Math.floor(view.eye[0] / 64) * 64
      const ay = Math.floor(view.eye[1] / 64) * 64
      const az = Math.floor(view.eye[2] / 64) * 64
      curAnchor[0] = ax; curAnchor[1] = ay; curAnchor[2] = az

      let carriedCount = 0
      if (carried.size > 0) {
        for (const each of carried) each((x, y, z, size, r, g, b) => {
          if (carriedCount >= CARRIED_MOST) return
          const o = carriedCount++ * STRIDE_FLOATS
          carriedF32[o] = x - ax; carriedF32[o + 1] = y - ay; carriedF32[o + 2] = z - az; carriedF32[o + 3] = size
          carriedF32[o + 4] = r; carriedF32[o + 5] = g; carriedF32[o + 6] = b; carriedF32[o + 7] = -1
          carriedF32[o + 8] = 0; carriedF32[o + 9] = 0; carriedF32[o + 10] = 0; carriedF32[o + 11] = 1
          carriedF32[o + 12] = size; carriedF32[o + 13] = 1
          carriedU32[o + 14] = KIND_BLOCK; carriedU32[o + 15] = 0
        })
      }

      const gpuActive = useGpu && (pendingCount > 0 || (simTime < maxExpire && gpuAliveHint > 0))
      const cpuActive = !useGpu && cpuLive > 0
      if (!gpuActive && !cpuActive && carriedCount === 0) {
        preparedGpu = false; preparedCpu = 0; preparedCarried = 0
        return false
      }

      const aspect = to.size[0] / to.size[1]
      if (useGpu && gpuActive && computePipeline && computeUniforms) {
        if (hasAnchor) {
          prevAnchorBuf[0] = lastAnchorX; prevAnchorBuf[1] = lastAnchorY; prevAnchorBuf[2] = lastAnchorZ
        } else {
          prevAnchorBuf[0] = ax; prevAnchorBuf[1] = ay; prevAnchorBuf[2] = az
        }
        const shiftX = ax - prevAnchorBuf[0]
        const shiftY = ay - prevAnchorBuf[1]
        const shiftZ = az - prevAnchorBuf[2]
        lastAnchorX = ax; lastAnchorY = ay; lastAnchorZ = az
        hasAnchor = true

        // 1. Upload only the dirty newly spawned ring slice(s) in `prevAnchor` space so
        //    subtracting `anchorShift` in the compute pass lands every particle in `anchor` space.
        if (pendingCount > 0) flushPendingSpawns(prevAnchorBuf)

        // 2. Always run GPU compute step + 6-plane frustum culling + compaction into `indirectBuf`
        //    so `visibleIndices` and `drawArgs.instanceCount` track the active camera every frame.
        ensureComputeBind()
        if (computeBind) {
          const hasDepth = depthSourceView !== null ? 1 : 0
          const useWorldMat = customViewProj && customInvViewProj ? 1 : 0
          let vp = customViewProj
          let inv = customInvViewProj
          if (!vp || !inv) {
            viewMatrices(view, aspect, curAnchor, autoViewProj, autoInvViewProj)
            vp = autoViewProj
            inv = autoInvViewProj
          }
          paramsF32[0] = shiftX; paramsF32[1] = shiftY; paramsF32[2] = shiftZ; paramsF32[3] = pendingDt
          paramsF32[4] = ax; paramsF32[5] = ay; paramsF32[6] = az; paramsU32[7] = hasDepth
          paramsF32[8] = Number.isFinite(floorOriginX) ? floorOriginX : ax - 128
          paramsF32[9] = Number.isFinite(floorOriginZ) ? floorOriginZ : az - 128
          paramsF32[10] = FLOOR_STEP; paramsF32[11] = defaultFloor
          paramsU32[12] = useWorldMat; paramsU32[13] = MOST; paramsU32[14] = 1; paramsU32[15] = 0
          paramsF32.set(vp, 16)
          paramsF32.set(inv, 32)

          // Extract 6 inward-pointing frustum planes in anchor-relative coordinates (zero float32 cancellation).
          anchorEye[0] = view.eye[0] - ax
          anchorEye[1] = view.eye[1] - ay
          anchorEye[2] = view.eye[2] - az
          anchorCam.forward = view.forward
          anchorCam.right = view.right
          anchorCam.up = view.up
          anchorCam.tanHalf = view.tanHalf
          writeFrustumPlanesFromCamera(paramsF32, 48, anchorCam, aspect, NEAR, FAR)

          device.queue.writeBuffer(computeUniforms, 0, paramsRaw)
          pendingDt = 0

          // Reset indirect draw args (`[36, 0, 0, 0]`) on the GPU timeline before compaction.
          encoder.copyBufferToBuffer(indirectResetBuf, 0, indirectBuf, 0, DRAW_INDIRECT_BYTES)

          const cpass = encoder.beginComputePass({ label: 'crumbs-compute' })
          cpass.setPipeline(computePipeline)
          cpass.setBindGroup(0, computeBind)
          cpass.dispatchWorkgroups(MOST >>> 6)
          cpass.end()
        }
      } else if (!useGpu && cpuActive && cpuP && cpuV && cpuLife && cpuEdge && cpuTone && cpuSpin && cpuKind && cpuFlags) {
        let n = 0
        for (let i = 0; i < MOST; i++) {
          if (cpuLife[i] <= 0) continue
          const o = n++ * STRIDE_FLOATS
          const isSpark = cpuKind[i] === KIND_SPARK || cpuKind[i] === KIND_PLASMA
          spawnF32[o] = cpuP[i * 3] - ax
          spawnF32[o + 1] = cpuP[i * 3 + 1] - ay
          spawnF32[o + 2] = cpuP[i * 3 + 2] - az
          spawnF32[o + 3] = cpuEdge[i] * Math.min(1, cpuLife[i] / (isSpark ? 0.22 : 0.35))
          spawnF32[o + 4] = cpuTone[i * 3]
          spawnF32[o + 5] = cpuTone[i * 3 + 1]
          spawnF32[o + 6] = cpuTone[i * 3 + 2]
          spawnF32[o + 7] = cpuSpin[i]
          spawnF32[o + 8] = cpuV[i * 3]
          spawnF32[o + 9] = cpuV[i * 3 + 1]
          spawnF32[o + 10] = cpuV[i * 3 + 2]
          spawnF32[o + 11] = cpuLife[i]
          spawnF32[o + 12] = cpuEdge[i]
          spawnF32[o + 13] = cpuLife[i]
          spawnU32[o + 14] = cpuKind[i]
          spawnU32[o + 15] = cpuFlags[i]
        }
        if (n > 0) device.queue.writeBuffer(instances, 0, spawnF32, 0, n * STRIDE_FLOATS)
        cpuLive = n
      }

      preparedGpu = gpuActive
      preparedCpu = cpuActive ? cpuLive : 0
      preparedCarried = carriedCount
      if (!preparedGpu && preparedCpu === 0 && preparedCarried === 0) return false

      if (carriedCount > 0) {
        device.queue.writeBuffer(carriedInstances, 0, carriedF32, 0, carriedCount * STRIDE_FLOATS)
      }

      const invSun = 1 / sunLength
      renderUniformF32[0] = view.eye[0] - ax
      renderUniformF32[1] = view.eye[1] - ay
      renderUniformF32[2] = view.eye[2] - az
      renderUniformF32[3] = view.tanHalf
      renderUniformF32[4] = view.right[0]
      renderUniformF32[5] = view.right[1]
      renderUniformF32[6] = view.right[2]
      renderUniformF32[7] = aspect
      renderUniformF32[8] = view.up[0]
      renderUniformF32[9] = view.up[1]
      renderUniformF32[10] = view.up[2]
      renderUniformF32[11] = 0
      renderUniformF32[12] = view.forward[0]
      renderUniformF32[13] = view.forward[1]
      renderUniformF32[14] = view.forward[2]
      renderUniformF32[15] = 0
      renderUniformF32[16] = sun[0] * invSun
      renderUniformF32[17] = sun[1] * invSun
      renderUniformF32[18] = sun[2] * invSun
      renderUniformF32[19] = day
      device.queue.writeBuffer(uniforms, 0, renderUniformF32)
      return true
    },
    record(pass) {
      if (!preparedGpu && preparedCpu === 0 && preparedCarried === 0) return
      if (preparedGpu) {
        pass.setPipeline(pipelineIndirect)
        pass.setBindGroup(0, indirectBind)
        pass.drawIndirect(indirectBuf, 0)
      } else if (preparedCpu > 0) {
        pass.setPipeline(pipelineDirect)
        pass.setBindGroup(0, cpuDirectBind)
        pass.draw(36, preparedCpu)
      }
      if (preparedCarried > 0) {
        pass.setPipeline(pipelineDirect)
        pass.setBindGroup(0, carriedDirectBind)
        pass.draw(36, preparedCarried)
      }
    },
    draw(encoder, to, view) {
      const skipPass = deferred
      deferred = false
      if (!self.prepare(encoder, to, view) || skipPass) return
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      self.record(pass)
      pass.end()
    },
  }
  return self
}
