// Live 64-tree GPU Voxelizer for Voxelwright's 3-cascade toroidal clipmap GI (#165).
//
// Samples the active 64-tree (`Globals`, `pool`, `top`, `looks`, `sunMap`) directly on the GPU
// into three persistent 64x32x64 3D texture pairs (`albedoOpacity: rgba8unorm`, `emissiveSun: rgba16float`)
// aligned 1:1 with `gi.ts`'s 3 cascades (`[8, 32, 128]` cells = octree levels `[3, 5, 7]`).
// Zero per-frame allocations; supports incremental Z-slice amortization in steady state and full-volume
// refresh on camera anchor shifts or world edits/blasts.
import { shader } from '../probe/gpu.ts'
import { GI_CASCADE_COUNT, GI_DEFAULT_CASCADE_SIZE, GI_DEFAULT_VOXEL_CELLS, type Vec3, type VoxelGridSource } from './gi.ts'
import { treeCommonWgsl } from './march-trace.ts'
import type { World } from './world.ts'

const MAX_FLAMES = 32
// 5 header vec4s + 32 flame vec4s = 37 * 16 = 592 bytes.
const VOX_PARAMS_BYTES = (5 + MAX_FLAMES) * 16

export interface WorldVoxelizerDeps {
  readonly GLOBALS: string
  readonly sunlitText: (marks: boolean) => string
  readonly LIT_LETTERS: number
  readonly EDITS: number
}

export interface WorldVoxelizerInput {
  /** Camera position in world cells (used with the exact same `snapAnchor` rule as `gi.ts`). */
  readonly cameraPosCells: Vec3
  /** Current frame march anchor in world cells (multiple of SIDE). */
  readonly anchor: readonly [number, number, number]
  /** Night / lamp darkness factor in `[0, 1]`. */
  readonly dark: number
  /** Daylight factor in `[0, 1]`. */
  readonly day: number
  /** Optional flat `[x, y, z, ...]` active fire positions in world cells. */
  readonly flames?: Float32Array
  /** Incremental Z-slice amortization stride (`1` = full refresh, `2`/`4` = steady-state amortized). */
  readonly amortizeStride?: number
  /** Force full refresh of all slices (e.g. after a blast, edit, or hour jump). */
  readonly forceFull?: boolean
  /** Optional GPU timestamp write on Cascade 0's beginning (paired with GI inject end). */
  readonly beginTimestamp?: GPUComputePassTimestampWrites
}

export interface WorldVoxelizer {
  /** Dispatches 3 compute passes (`64x32x64` each) and returns the 3 aligned `VoxelGridSource` records. */
  voxelize(encoder: GPUCommandEncoder, input: WorldVoxelizerInput): readonly [VoxelGridSource, VoxelGridSource, VoxelGridSource]
  /** Rebinds `@group(0)` after `world.trade()` swaps `poolBuffer` / `topBuffer`. */
  rebind(): void
  /** Forces full re-voxelization on the next frame (e.g. on reset/realm swap). */
  reset(): void
  /** Destroys owned GPU textures and buffers. */
  destroy(): void
}

/** Matches `gi.ts`'s `snapAnchor()` identically so source voxel `(0,0,0)` aligns 1:1 with `gi.ts` `curOrigin`. */
function snapAnchor(camCoord: number, voxelCells: number, dim: number): number {
  const half = dim * 0.5
  const raw = camCoord / voxelCells - half
  return Math.floor(raw / 4) * 4
}

function buildVoxelizerWgsl(world: World, deps: WorldVoxelizerDeps): string {
  return /* wgsl */ `
${deps.GLOBALS}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, metallic: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16>, far: vec4f, cover: array<vec4u, 32>, wedge: vec4f, bear: vec4f, keep0: vec4f, keep1: vec4f, letters: array<vec4f, ${2 + 2 * deps.LIT_LETTERS}>, edits: array<vec4f, ${2 * deps.EDITS}> }

struct VoxParams {
  // xyz: snapped world-voxel origin for this cascade, w: casVoxel (cells, power of 2: 8, 32, 128)
  originVox: vec4i,
  // xyz: cascade dim (64, 32, 64), w: targetLevel (3, 5, 7)
  dimsLevel: vec4u,
  // xyz: march anchor in world cells (i32), w: flameCount (0..32)
  anchorFlames: vec4i,
  // x: dark (0..1), y: day (0..1), z: amortizeStride, w: frameIndex
  misc: vec4f,
  // xyz: previous snapped originVox, w: flags (bit0=prevValid, bit1=forceFull)
  prevOriginFlags: vec4i,
  // xyz: anchor-relative flame position (cells), w: influence radius (cells)
  flames: array<vec4f, ${MAX_FLAMES}>,
}

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(0) @binding(3) var<uniform> looks: Looks;
@group(0) @binding(4) var sunMap: texture_2d_array<f32>;

@group(1) @binding(0) var<uniform> vp: VoxParams;
@group(1) @binding(1) var outAlbedoOpacity: texture_storage_3d<rgba8unorm, write>;
@group(1) @binding(2) var outEmissiveSun: texture_storage_3d<rgba16float, write>;

${treeCommonWgsl(world)}
${deps.sunlitText(false)}

fn voxHash3i(c: vec3i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}

fn voxLitWindow(fine: vec3i) -> f32 {
  let w = voxHash3i(vec3i(fine.x >> 4u, fine.y / 30, fine.z >> 4u), 23u);
  return smoothstep(0.7, 0.72, w) * (0.35 + 0.65 * fract(w * 17.0));
}

fn isAirKind(k: u32) -> bool {
  let st = k & 15u;
  return st == 0u || st == 11u;
}

fn sampleWorldKind(wVox: vec3i, casVoxel: i32, startL: u32) -> vec2u {
  let maxL = g.levels - 1u;
  let fineCenter = wVox * casVoxel + vec3i(casVoxel >> 1);
  var L = min(startL, maxL);
  for (var tries = 0u; tries < 6u; tries++) {
    let lv = g.level[L];
    let cWorld = fineCenter >> vec3u(L);
    let cLoc = cWorld - lv.cells;
    if (all(cLoc >= vec3i(0)) && all(cLoc < vec3i(lv.boxSize))) {
      return vec2u(kindAt(cLoc, L), L);
    }
    if (L >= maxL) { break; }
    L += 1u;
  }
  return vec2u(0u, L);
}

// Matches Cascade 0's 2x2x2 L=1 opacity rule (solidN >= 3 -> solid) so sun tests only run on
// exposed air-facing voxel boundaries and never poke across thin walls into dark sealed interiors.
fn isCascade0Air(wVox: vec3i) -> bool {
  if (isAirKind(sampleWorldKind(wVox, 8, 3u).x)) {
    return true;
  }
  if (g.levels > 1u) {
    let lv1 = g.level[1u];
    let cBase1 = (wVox * 4) - lv1.cells;
    if (all(cBase1 >= vec3i(0)) && all(cBase1 + vec3i(3) < vec3i(lv1.boxSize))) {
      var solidN = 0u;
      for (var sz = 0; sz < 2; sz++) {
        for (var sy = 0; sy < 2; sy++) {
          for (var sx = 0; sx < 2; sx++) {
            let sk = kindAt(cBase1 + vec3i(sx * 2 + 1, sy * 2 + 1, sz * 2 + 1), 1u);
            if (!isAirKind(sk)) {
              solidN += 1u;
              if (solidN >= 3u) { return false; }
            }
          }
        }
      }
      return true;
    }
  }
  return false;
}

@compute @workgroup_size(4, 4, 4)
fn cs_voxelize_world(@builtin(global_invocation_id) gid: vec3u) {
  let dimU = vp.dimsLevel.xyz;
  if (any(gid >= dimU)) { return; }

  let curOrigin = vp.originVox.xyz;
  let prevOrigin = vp.prevOriginFlags.xyz;
  let flags = u32(vp.prevOriginFlags.w);
  let prevValid = (flags & 1u) != 0u;
  let forceFull = (flags & 2u) != 0u;
  let stride = max(u32(vp.misc.z), 1u);
  let frameIdx = u32(vp.misc.w);

  // When the cascade origin did not move and no edit/reset occurred, only re-voxelize the active
  // amortized Z-slices that cs_inject_radiance will read this frame; other slices remain valid in-place.
  let originSame = prevValid && all(curOrigin == prevOrigin);
  let w = curOrigin + vec3i(gid);
  if (!forceFull && originSame && stride > 1u) {
    let sliceIdx = u32(bitcast<u32>(w.z) + frameIdx) % stride;
    if (sliceIdx != 0u) { return; }
  }

  let casVoxel = vp.originVox.w;
  let casVoxelF = f32(casVoxel);
  let targetL = vp.dimsLevel.w;
  let anchorI = vp.anchorFlames.xyz;
  let flameCount = u32(max(vp.anchorFlames.w, 0));
  let dark = vp.misc.x;
  let day = vp.misc.y;

  let kind_used = sampleWorldKind(w, casVoxel, targetL);
  var kind = kind_used.x;
  var usedL = kind_used.y;

  // Anchor-relative voxel min corner & center in cells (integer subtraction first preserves full float32 precision at SF coords).
  let pMin = vec3f(w * casVoxel - anchorI);
  let pRel = pMin + vec3f(casVoxelF * 0.5);

  var albedo = vec3f(0.0);
  var opacity = 0.0;
  var emissive = vec3f(0.0);
  var sunHint = -1.0;

  // For Cascade 0 (80 cm = 8 fine cells), sample a 2x2x2 sub-grid at L=1 (20 cm) when inside L1's box
  // so thin 10 cm trim / protruding bay-window lips do not dilate into full 80 cm solid blocks,
  // while real building walls, floors, and roofs (>= 20-30 cm) stay 100% solid with zero light leak.
  var handledSub = false;
  var hasLoX = false;
  var hasHiX = false;
  var hasLoY = false;
  var hasHiY = false;
  var hasLoZ = false;
  var hasHiZ = false;
  if (casVoxel == 8 && g.levels > 1u) {
    let lv1 = g.level[1u];
    let cBase1 = (w * 4) - lv1.cells;
    if (all(cBase1 >= vec3i(0)) && all(cBase1 + vec3i(3) < vec3i(lv1.boxSize))) {
      handledSub = true;
      var solidN = 0u;
      var albSum = vec3f(0.0);
      var emSum = vec3f(0.0);
      var glassWin = 0.0;
      var glassWarm = vec3f(0.0);
      for (var sz = 0; sz < 2; sz++) {
        for (var sy = 0; sy < 2; sy++) {
          for (var sx = 0; sx < 2; sx++) {
            let subC = cBase1 + vec3i(sx * 2 + 1, sy * 2 + 1, sz * 2 + 1);
            let sk = kindAt(subC, 1u);
            let st = sk & 15u;
            if (st == 0u) { continue; }
            let sci = (sk >> 8u) & 255u;
            let sm = looks.material[st];
            let sAlb = select(sm.colour, looks.palette[sci].rgb, sci != 0u);
            if (st == 11u) {
              if (dark > 0.08) {
                let sfine = (w * 8) + vec3i(sx * 4 + 2, sy * 4 + 2, sz * 4 + 2);
                let win = max(voxLitWindow(sfine), select(0.0, 0.8, sci == 146u));
                if (win > 0.05) {
                  let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(win * 91.0)));
                  glassWin = max(glassWin, win);
                  glassWarm = warm;
                }
              }
            } else {
              if (sx == 0) { hasLoX = true; } else { hasHiX = true; }
              if (sy == 0) { hasLoY = true; } else { hasHiY = true; }
              if (sz == 0) { hasLoZ = true; } else { hasHiZ = true; }
              if (st == 15u) {
                solidN += 1u;
                albSum += sAlb;
                if (dark > 0.02) {
                  if (sci != 46u) {
                    let sat = max(sAlb + (sAlb - vec3f(dot(sAlb, vec3f(0.333)))) * 3.0, vec3f(0.0));
                    emSum += sat * (2.6 * dark);
                  } else {
                    emSum += vec3f(1.0, 0.85, 0.60) * (4.2 * dark);
                  }
                }
              } else if (st == 5u) {
                solidN += 1u;
                albSum += vec3f(0.06, 0.16, 0.24);
              } else {
                solidN += 1u;
                albSum += sAlb;
              }
            }
          }
        }
      }
      if (solidN >= 3u) {
        opacity = 1.0;
        albedo = albSum / f32(solidN);
        emissive = emSum / f32(solidN);
        usedL = 1u;
      } else if (glassWin > 0.05) {
        opacity = 0.9;
        emissive = glassWarm * (glassWin * dark * 1.35);
        usedL = 1u;
      }
    }
  }

  let stuff = kind & 15u;
  if (!handledSub && stuff != 0u) {
    let ci = (kind >> 8u) & 255u;
    let m = looks.material[stuff];
    albedo = select(m.colour, looks.palette[ci].rgb, ci != 0u);
    if (stuff == 11u) {
      // Glass: transparent in daytime so sunlit windows pass daylight indoors; warm emissive on lit panes at night.
      if (dark > 0.08) {
        let fine = w * casVoxel;
        let win = max(voxLitWindow(fine), select(0.0, 0.8, ci == 146u));
        if (win > 0.05) {
          let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(win * 91.0)));
          opacity = 0.9;
          emissive = warm * (win * dark * 1.35);
        }
      }
    } else if (stuff == 15u) {
      opacity = 1.0;
      if (dark > 0.02) {
        if (ci != 46u) {
          let sat = max(albedo + (albedo - vec3f(dot(albedo, vec3f(0.333)))) * 3.0, vec3f(0.0));
          emissive = sat * (2.6 * dark);
        } else {
          emissive = vec3f(1.0, 0.85, 0.60) * (4.2 * dark);
        }
      }
    } else if (stuff == 5u) {
      opacity = 1.0;
      albedo = vec3f(0.06, 0.16, 0.24);
    } else {
      opacity = 1.0;
    }
  }

  // Inject active world flames / fires as warm flickering HDR emissive bounce sources.
  if (flameCount > 0u) {
    for (var fi = 0u; fi < flameCount; fi++) {
      let fl = vp.flames[fi];
      let diff = pRel - fl.xyz;
      let reach = fl.w + casVoxelF * 0.75;
      let d2 = dot(diff, diff);
      if (d2 < reach * reach) {
        let fall = 1.0 - sqrt(d2) / reach;
        let fireRad = vec3f(7.5, 2.6, 0.55) * (fall * fall);
        emissive += fireRad;
        if (opacity < 0.5 && d2 < casVoxelF * casVoxelF * 0.9) {
          opacity = 0.85;
          albedo = vec3f(0.0);
        }
      }
    }
  }

  if (opacity > 0.5 && day > 0.01 && g.sunMaps != 0u) {
    // Evaluate sun visibility on exposed sunward voxel faces (pushed just outside the surface along the
    // face normal) instead of from the voxel center pRel, eliminating self-shadowing on Cascade 0/1/2
    // floors, rubble, sidewalks, and grazing vertical walls while keeping sealed interiors at 0.0.
    let sunL = select(min(usedL, select(5u, 3u, casVoxel <= 32)), 1u, casVoxel == 8);
    let halfOff = casVoxelF * 0.52;
    var visSum = 0.0;
    var visW = 0.0;
    var anyExposed = false;

    let ax = abs(g.sun.x);
    if (ax > 0.02) {
      let sxDir = select(-1, 1, g.sun.x > 0.0);
      let wNx = w + vec3i(sxDir, 0, 0);
      let expX = select(isAirKind(sampleWorldKind(wNx, casVoxel, targetL).x), isCascade0Air(wNx), handledSub);
      if (expX) {
        anyExposed = true;
        let nX = vec3f(f32(sxDir), 0.0, 0.0);
        var fPx = pRel + nX * halfOff;
        if (handledSub && (hasLoX || hasHiX)) {
          let loX = select(4.0, 0.0, hasLoX);
          let hiX = select(6.0, 8.0, hasHiX);
          fPx.x = select(pMin.x + loX - 0.16, pMin.x + hiX + 0.16, sxDir > 0);
        }
        let vx = sunlit(fPx, nX, sunL);
        if (vx >= 0.0) {
          visSum += clamp(vx, 0.0, 1.0) * ax;
          visW += ax;
        }
      }
    }

    let ay = abs(g.sun.y);
    if (ay > 0.02) {
      let syDir = select(-1, 1, g.sun.y > 0.0);
      let wNy = w + vec3i(0, syDir, 0);
      let expY = select(isAirKind(sampleWorldKind(wNy, casVoxel, targetL).x), isCascade0Air(wNy), handledSub);
      if (expY) {
        anyExposed = true;
        let nY = vec3f(0.0, f32(syDir), 0.0);
        var fPy = pRel + nY * halfOff;
        if (handledSub && (hasLoY || hasHiY)) {
          let loY = select(4.0, 0.0, hasLoY);
          let hiY = select(6.0, 8.0, hasHiY);
          fPy.y = select(pMin.y + loY - 0.16, pMin.y + hiY + 0.16, syDir > 0);
        }
        let vy = sunlit(fPy, nY, sunL);
        if (vy >= 0.0) {
          visSum += clamp(vy, 0.0, 1.0) * ay;
          visW += ay;
        }
      }
    }

    let az = abs(g.sun.z);
    if (az > 0.02) {
      let szDir = select(-1, 1, g.sun.z > 0.0);
      let wNz = w + vec3i(0, 0, szDir);
      let expZ = select(isAirKind(sampleWorldKind(wNz, casVoxel, targetL).x), isCascade0Air(wNz), handledSub);
      if (expZ) {
        anyExposed = true;
        let nZ = vec3f(0.0, 0.0, f32(szDir));
        var fPz = pRel + nZ * halfOff;
        if (handledSub && (hasLoZ || hasHiZ)) {
          let loZ = select(4.0, 0.0, hasLoZ);
          let hiZ = select(6.0, 8.0, hasHiZ);
          fPz.z = select(pMin.z + loZ - 0.16, pMin.z + hiZ + 0.16, szDir > 0);
        }
        let vz = sunlit(fPz, nZ, sunL);
        if (vz >= 0.0) {
          visSum += clamp(vz, 0.0, 1.0) * az;
          visW += az;
        }
      }
    }

    if (visW > 0.0) {
      sunHint = clamp(visSum / visW, 0.0, 1.0);
    } else if (!anyExposed) {
      sunHint = 0.0;
    }
  }

  // Lift heavily gamma-linearized Voxelwright albedos gently for multi-bounce radiosity transport
  // (preserving hue & keeping sealed interiors at 0.0) so 2nd/3rd indoor sun bounce survives AgX's shadow toe.
  var outAlb = clamp(albedo, vec3f(0.0), vec3f(1.0));
  if (opacity > 0.5 && max(outAlb.r, max(outAlb.g, outAlb.b)) > 1e-4) {
    outAlb = min(mix(outAlb, sqrt(outAlb), 0.50), vec3f(0.85));
  }

  let coord = vec3i(gid);
  textureStore(outAlbedoOpacity, coord, vec4f(outAlb, opacity));
  textureStore(outEmissiveSun, coord, vec4f(min(max(emissive, vec3f(0.0)), vec3f(65000.0)), sunHint));
}
`
}

export async function createWorldVoxelizer(
  device: GPUDevice,
  world: World,
  deps: WorldVoxelizerDeps,
  resources: {
    readonly globals: GPUBuffer
    readonly looks: GPUBuffer
    readonly sunMap: GPUTextureView
  },
  cascadeSize: readonly [number, number, number] = GI_DEFAULT_CASCADE_SIZE,
  cascadeVoxelCells: readonly [number, number, number] = GI_DEFAULT_VOXEL_CELLS,
): Promise<WorldVoxelizer> {
  const [dimX, dimY, dimZ] = cascadeSize
  const mod = await shader(device, 'gi-world-voxelize', buildVoxelizerWgsl(world, deps))

  const C = GPUShaderStage.COMPUTE
  const layout0 = device.createBindGroupLayout({
    label: 'gi-vox-world-bgl',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: C, buffer: { type: 'uniform' } },
      { binding: 4, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
    ],
  })
  const layout1 = device.createBindGroupLayout({
    label: 'gi-vox-out-bgl',
    entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
      { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    ],
  })
  const pipeline = await device.createComputePipelineAsync({
    label: 'gi-world-voxelize',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout0, layout1] }),
    compute: { module: mod, entryPoint: 'cs_voxelize_world' },
  })

  const makeBind0 = () => device.createBindGroup({
    label: 'gi-vox-world-bg',
    layout: layout0,
    entries: [
      { binding: 0, resource: { buffer: resources.globals } },
      { binding: 1, resource: { buffer: world.poolBuffer } },
      { binding: 2, resource: { buffer: world.topBuffer } },
      { binding: 3, resource: { buffer: resources.looks } },
      { binding: 4, resource: resources.sunMap },
    ],
  })
  let bind0 = makeBind0()

  const texUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const albedoTex: GPUTexture[] = []
  const albedoView: GPUTextureView[] = []
  const emissiveTex: GPUTexture[] = []
  const emissiveView: GPUTextureView[] = []
  const voxUbos: GPUBuffer[] = []
  const bind1s: GPUBindGroup[] = []
  const originsMut: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]

  for (let c = 0; c < GI_CASCADE_COUNT; c++) {
    const aTex = device.createTexture({
      label: `gi-vox-albedo-c${c}`,
      dimension: '3d',
      size: [dimX, dimY, dimZ],
      format: 'rgba8unorm',
      usage: texUsage,
    })
    const eTex = device.createTexture({
      label: `gi-vox-emissive-c${c}`,
      dimension: '3d',
      size: [dimX, dimY, dimZ],
      format: 'rgba16float',
      usage: texUsage,
    })
    const aView = aTex.createView({ dimension: '3d' })
    const eView = eTex.createView({ dimension: '3d' })
    const ubo = device.createBuffer({
      label: `gi-vox-ubo-c${c}`,
      size: VOX_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    albedoTex.push(aTex)
    albedoView.push(aView)
    emissiveTex.push(eTex)
    emissiveView.push(eView)
    voxUbos.push(ubo)
    bind1s.push(device.createBindGroup({
      label: `gi-vox-out-bg-c${c}`,
      layout: layout1,
      entries: [
        { binding: 0, resource: { buffer: ubo } },
        { binding: 1, resource: aView },
        { binding: 2, resource: eView },
      ],
    }))
  }

  const sources: readonly [VoxelGridSource, VoxelGridSource, VoxelGridSource] = [
    { albedoOpacity: albedoView[0], emissiveSun: emissiveView[0], size: [dimX, dimY, dimZ], originCells: originsMut[0], voxelCells: cascadeVoxelCells[0] },
    { albedoOpacity: albedoView[1], emissiveSun: emissiveView[1], size: [dimX, dimY, dimZ], originCells: originsMut[1], voxelCells: cascadeVoxelCells[1] },
    { albedoOpacity: albedoView[2], emissiveSun: emissiveView[2], size: [dimX, dimY, dimZ], originCells: originsMut[2], voxelCells: cascadeVoxelCells[2] },
  ]

  const targetLevels: [number, number, number] = [
    Math.max(0, Math.round(Math.log2(cascadeVoxelCells[0]))),
    Math.max(0, Math.round(Math.log2(cascadeVoxelCells[1]))),
    Math.max(0, Math.round(Math.log2(cascadeVoxelCells[2]))),
  ]

  const paramsRaw = new ArrayBuffer(VOX_PARAMS_BYTES)
  const paramsI32 = new Int32Array(paramsRaw)
  const paramsU32 = new Uint32Array(paramsRaw)
  const paramsF32 = new Float32Array(paramsRaw)

  const prevOrigins: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  let prevValid = false
  let frameCount = 0
  let destroyed = false

  const gx = (dimX + 3) >> 2
  const gy = (dimY + 3) >> 2
  const gz = (dimZ + 3) >> 2

  return {
    voxelize(encoder, input) {
      if (destroyed) throw new Error('WorldVoxelizer was destroyed')
      const [cx, cy, cz] = input.cameraPosCells
      const [ax, ay, az] = input.anchor
      const stride = Math.max(1, Math.min(8, Math.round(input.amortizeStride ?? 1)))
      const forceFull = !prevValid || !!input.forceFull

      // Pack up to MAX_FLAMES active world flames once (anchor-relative cells).
      let flameCount = 0
      const fl = input.flames
      if (fl && fl.length >= 3) {
        const total = Math.min(MAX_FLAMES, Math.floor(fl.length / 3))
        for (let i = 0; i < total; i++) {
          const base = 20 + i * 4
          paramsF32[base] = fl[i * 3] - ax
          paramsF32[base + 1] = fl[i * 3 + 1] - ay
          paramsF32[base + 2] = fl[i * 3 + 2] - az
          paramsF32[base + 3] = 14.0
        }
        flameCount = total
      }

      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        const vox = cascadeVoxelCells[c]
        const ox = snapAnchor(cx, vox, dimX)
        const oy = snapAnchor(cy, vox, dimY)
        const oz = snapAnchor(cz, vox, dimZ)
        originsMut[c][0] = ox * vox
        originsMut[c][1] = oy * vox
        originsMut[c][2] = oz * vox

        paramsI32[0] = ox
        paramsI32[1] = oy
        paramsI32[2] = oz
        paramsI32[3] = vox

        paramsU32[4] = dimX
        paramsU32[5] = dimY
        paramsU32[6] = dimZ
        paramsU32[7] = targetLevels[c]

        paramsI32[8] = ax | 0
        paramsI32[9] = ay | 0
        paramsI32[10] = az | 0
        paramsI32[11] = flameCount

        paramsF32[12] = input.dark
        paramsF32[13] = input.day
        paramsF32[14] = stride
        paramsF32[15] = frameCount

        paramsI32[16] = prevOrigins[c][0]
        paramsI32[17] = prevOrigins[c][1]
        paramsI32[18] = prevOrigins[c][2]
        paramsI32[19] = (prevValid ? 1 : 0) | (forceFull ? 2 : 0)

        device.queue.writeBuffer(voxUbos[c], 0, paramsRaw)

        const ts = c === 0 && input.beginTimestamp ? input.beginTimestamp : undefined
        const pass = encoder.beginComputePass(ts ? { label: `gi-vox-c${c}`, timestampWrites: ts } : { label: `gi-vox-c${c}` })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bind0)
        pass.setBindGroup(1, bind1s[c])
        pass.dispatchWorkgroups(gx, gy, gz)
        pass.end()

        prevOrigins[c][0] = ox
        prevOrigins[c][1] = oy
        prevOrigins[c][2] = oz
      }

      prevValid = true
      frameCount++
      return sources
    },
    rebind() {
      if (destroyed) return
      bind0 = makeBind0()
      prevValid = false
    },
    reset() {
      prevValid = false
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (let c = 0; c < GI_CASCADE_COUNT; c++) {
        albedoTex[c].destroy()
        emissiveTex[c].destroy()
        voxUbos[c].destroy()
      }
    },
  }
}
