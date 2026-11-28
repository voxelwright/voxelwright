// Temporally filtered 3D froxel volumetric fog compute engine (#165).
//
// Builds a camera-aligned 3D frustum volume (default 160 x 90 x 64 rgba16float) with exponential
// depth slicing from `nearDist` (2 m) to `maxDist` (600 m) in Voxelwright world cells (1 cell = 0.1 m):
//   Pass 1 (`cs_inject`, @workgroup_size(8, 8, 1)):
//     Evaluates SF height-layered marine fog + animated 3D FBM wisps + ambient haze, directional
//     sun/moon in-scattering with Henyey-Greenstein phase (plus optional 2D shadow/visibility map),
//     and local point/spot volumetric light cones (headlights, street lamps, fires). Reprojects
//     each froxel's unjittered center into the previous frame's scatter-extinction volume via a
//     ping-pong pair with Halton/IGN Z-slice jitter and exponential moving average.
//   Pass 2 (`cs_integrate`, @workgroup_size(8, 8, 1)):
//     Front-to-back analytical Beer-Lambert integration per (x, y) froxel column, storing
//     accumulated `(inScatter.rgb, transmittance)` in `integratedVolume`.
//   Composite (`apply`) + reusable WGSL snippet (`FROXEL_FOG_WGSL`):
//     Blends volumetric fog cleanly in linear HDR: `color = color * transmittance + inScatter`.
import { FAR, NEAR, shader, type V3 } from '../probe/gpu.ts'
import type { View } from './march.ts'

/** Default froxel grid dimensions (width x height x depth slices). */
export const DEFAULT_FROXEL_DIMS: readonly [number, number, number] = [160, 90, 64]
/** Default near slice depth in world cells (20 cells = 2 m). */
export const DEFAULT_NEAR_DIST = 20
/** Default far slice depth in world cells (6000 cells = 600 m). */
export const DEFAULT_MAX_DIST = 6000
/** Maximum simultaneous local volumetric lights evaluated per frame. */
export const MAX_FROXEL_LIGHTS = 64

const METERS_PER_CELL = 0.1
const INV_4PI = 1 / (4 * Math.PI)
const GOLDEN_RATIO_CONJ = 0.6180339887498949
const INJECT_UNIFORM_BYTES = 384
const SAMPLING_UNIFORM_BYTES = 32
const LIGHTS_BUFFER_BYTES = 16 + MAX_FROXEL_LIGHTS * 64

/** Exponential depth slice -> linear view depth (cells). Matches WGSL `froxelSliceToDepth`. */
export function sliceToDepth(
  slice: number,
  slices: number,
  nearDist = DEFAULT_NEAR_DIST,
  maxDist = DEFAULT_MAX_DIST,
): number {
  const s = Math.max(0, Math.min(slices, slice))
  return nearDist * Math.pow(maxDist / nearDist, s / slices)
}

/** Linear view depth (cells) -> continuous slice index in `[0, slices]`. Matches WGSL `froxelDepthToSlice`. */
export function depthToSlice(
  depth: number,
  slices: number,
  nearDist = DEFAULT_NEAR_DIST,
  maxDist = DEFAULT_MAX_DIST,
): number {
  const d = Math.max(nearDist, Math.min(maxDist, depth))
  return (slices * Math.log(d / nearDist)) / Math.log(maxDist / nearDist)
}

/** Single-lobe Henyey-Greenstein phase function (energy-normalized over the sphere). */
export function henyeyGreenstein(cosTheta: number, g: number): number {
  const gc = Math.max(-0.95, Math.min(0.95, g))
  const g2 = gc * gc
  const denom = Math.max(1e-4, 1 + g2 - 2 * gc * cosTheta)
  return ((1 - g2) * INV_4PI) / (denom * Math.sqrt(denom))
}

/**
 * Reusable WGSL sampling snippet for `march-shade.ts` or any fullscreen linear-HDR pass.
 * Expects bindings `froxelFogVolume: texture_3d<f32>`, `froxelFogSampler: sampler`,
 * and `froxelFogParams: FroxelFogParams` in scope.
 */
export const FROXEL_FOG_WGSL = /* wgsl */ `
struct FroxelFogParams {
  // x: nearDist (cells), y: maxDist (cells), z: slices (f32), w: invLogRatio (1 / log(maxDist / nearDist))
  depth: vec4f,
  // x: enabled (> 0), y: march NEAR (cells), z: march FAR (cells), w: strength (1.0)
  flags: vec4f,
}

fn froxelDepthToSlice(linearDepth: f32, slices: f32, nearDist: f32, invLogRatio: f32) -> f32 {
  let d = max(linearDepth, nearDist);
  return clamp(slices * log(d / nearDist) * invLogRatio, 0.0, slices);
}

fn froxelSliceToDepth(sliceIdx: f32, invSlices: f32, nearDist: f32, maxDist: f32) -> f32 {
  return nearDist * pow(maxDist / nearDist, clamp(sliceIdx * invSlices, 0.0, 1.0));
}

// Samples accumulated (inScatter.rgb, transmittance) at screen UV [0, 1]^2 and linear view depth (cells).
fn sampleFroxelFog(uv: vec2f, linearDepth: f32) -> vec4f {
  if (froxelFogParams.flags.x <= 0.0 || linearDepth <= froxelFogParams.depth.x) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let slices = froxelFogParams.depth.z;
  let invSlices = 1.0 / slices;
  let s = froxelDepthToSlice(linearDepth, slices, froxelFogParams.depth.x, froxelFogParams.depth.w);
  let w = clamp((s - 0.5) * invSlices, 0.5 * invSlices, 1.0 - 0.5 * invSlices);
  var res = textureSampleLevel(froxelFogVolume, froxelFogSampler, vec3f(clamp(uv, vec2f(0.0), vec2f(1.0)), w), 0.0);
  if (s < 1.0) {
    res = mix(vec4f(0.0, 0.0, 0.0, 1.0), res, clamp(s, 0.0, 1.0));
  }
  let strength = froxelFogParams.flags.w;
  if (strength < 0.9999) {
    res = mix(vec4f(0.0, 0.0, 0.0, 1.0), res, clamp(strength, 0.0, 1.0));
  }
  return res;
}

// Applies volumetric fog in linear HDR: color = color * transmittance + inScatter.
fn applyFroxelFog(color: vec3f, uv: vec2f, linearDepth: f32) -> vec3f {
  let fog = sampleFroxelFog(uv, linearDepth);
  return color * fog.a + fog.rgb;
}
`

const COMPUTE_COMMON_WGSL = /* wgsl */ `
const INV_4PI: f32 = 0.07957747154594767;
const METERS_PER_CELL: f32 = ${METERS_PER_CELL};

struct InjectUniforms {
  // 0: eye.xyz (cells), tanHalf
  eyeTan: vec4f,
  // 1: right.xyz, aspect
  rightAspect: vec4f,
  // 2: up.xyz, time (s)
  upTime: vec4f,
  // 3: forward.xyz, extinctionScale
  fwdScale: vec4f,
  // 4: dims.xyz (f32), invSlices
  dimsInfo: vec4f,
  // 5: nearDist, maxDist, log2Ratio (log2(maxDist / nearDist)), baseDensity (m^-1)
  depthBase: vec4f,
  // 6: heightDensity (m^-1), heightBase (cells), heightTop (cells), invHeightFalloff (1 / cells)
  heightFog: vec4f,
  // 7: wind.xyz (cells/s), noiseScale (1 / cells)
  windScale: vec4f,
  // 8: albedo.rgb, noiseAmount (0..1)
  albedoNoise: vec4f,
  // 9: sunDir.xyz (unit), sunAnisotropy (g)
  sunDirG: vec4f,
  // 10: sunColor.rgb, sunVisibility (0..1)
  sunColVis: vec4f,
  // 11: ambientSky.rgb, sunShadowMode (0=none, 1=depth, 2=visibility)
  ambSkyMode: vec4f,
  // 12: ambientGround.rgb, shadowBias
  ambGroundBias: vec4f,
  // 13: temporalAlpha, jitterPhase ([0, 1)), hasHistory (0/1), jitterEnabled (0/1)
  temporal: vec4f,
  // 14: prevNearDist, prevMaxDist, prevInvLog2Ratio, frameIndex
  prevDepth: vec4f,
  // 15: lightCount (f32), pad, pad, pad
  counts: vec4f,
  // 16..19: camera-relative world -> previous clip space
  prevRelViewProj: mat4x4f,
  // 20..23: camera-relative world -> optional sun shadow clip space
  sunShadowProj: mat4x4f,
}
`

const INJECT_WGSL = /* wgsl */ `
${COMPUTE_COMMON_WGSL}

struct FroxelLight {
  // xyz: camera-relative position (cells); w: 1 / (range * range)
  posRange: vec4f,
  // xyz: unit spotlight direction (out of emitter); w: cosOuter (< -1.5 for point light)
  dirCone: vec4f,
  // rgb: linear HDR colour/intensity; w: 1 / max(cosInner - cosOuter, 1e-4)
  colSpot: vec4f,
  // x: 1 / (halfDist * halfDist); y: anisotropy g; z: volumetricScale; w: pad
  params: vec4f,
}

struct FroxelLightBuffer {
  info: vec4u,
  items: array<FroxelLight, ${MAX_FROXEL_LIGHTS}>,
}

@group(0) @binding(0) var<uniform> u: InjectUniforms;
@group(0) @binding(1) var<storage, read> lights: FroxelLightBuffer;
@group(0) @binding(2) var prevScatter: texture_3d<f32>;
@group(0) @binding(3) var linearSamp: sampler;
@group(0) @binding(4) var sunShadowTex: texture_2d<f32>;
@group(0) @binding(5) var currScatter: texture_storage_3d<rgba16float, write>;

fn sliceToDepthLocal(sliceIdx: f32, invSlices: f32, nearDist: f32, log2Ratio: f32) -> f32 {
  return nearDist * exp2(clamp(sliceIdx * invSlices, 0.0, 1.0) * log2Ratio);
}

fn depthToSliceLocal(linearDepth: f32, slices: f32, nearDist: f32, invLog2Ratio: f32) -> f32 {
  let d = max(linearDepth, nearDist);
  return clamp(slices * log2(d / nearDist) * invLog2Ratio, 0.0, slices);
}

fn hgPhase(cosTheta: f32, g: f32) -> f32 {
  let gc = clamp(g, -0.95, 0.95);
  let g2 = gc * gc;
  let denom = max(1e-4, 1.0 + g2 - 2.0 * gc * cosTheta);
  return (1.0 - g2) * INV_4PI / (denom * sqrt(denom));
}

// Dual-lobe Mie approximation: strong HG forward lobe + 15% isotropic multi-scatter floor
// so both oncoming/sun shafts peak sharply and player-forward beams stay rich in fog.
fn dualPhase(cosTheta: f32, g: f32) -> f32 {
  return 0.85 * hgPhase(cosTheta, g) + 0.15 * INV_4PI;
}

fn finishHash(h0: u32) -> f32 {
  var h = (h0 ^ (h0 >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) * (1.0 / 16777216.0);
}

fn valueNoise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p));
  let t = fract(p);
  let f = t * t * (3.0 - 2.0 * t);
  let x0 = u32(i.x) * 73856093u;
  let x1 = x0 + 73856093u;
  let y0 = u32(i.y) * 19349663u;
  let y1 = y0 + 19349663u;
  let z0 = u32(i.z) * 83492791u;
  let z1 = z0 + 83492791u;
  let y0z0 = y0 ^ z0;
  let y1z0 = y1 ^ z0;
  let y0z1 = y0 ^ z1;
  let y1z1 = y1 ^ z1;
  let nx00 = mix(finishHash(x0 ^ y0z0), finishHash(x1 ^ y0z0), f.x);
  let nx10 = mix(finishHash(x0 ^ y1z0), finishHash(x1 ^ y1z0), f.x);
  let nx01 = mix(finishHash(x0 ^ y0z1), finishHash(x1 ^ y0z1), f.x);
  let nx11 = mix(finishHash(x0 ^ y1z1), finishHash(x1 ^ y1z1), f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

fn fbm3(worldPos: vec3f, nearDetail: bool) -> f32 {
  // Wrap large SF coordinates cleanly before scaling so float32 noise stays crisp everywhere.
  let wrapped = worldPos - floor(worldPos * (1.0 / 65536.0)) * 65536.0;
  let drift = u.windScale.xyz * u.upTime.w;
  let q = (wrapped - drift) * u.windScale.w;
  if (nearDetail) {
    var acc = valueNoise3(q) * 0.57;
    acc += valueNoise3(q * 2.07 + vec3f(13.7, 5.3, 9.1)) * 0.29;
    acc += valueNoise3(q * 4.19 + vec3f(3.1, 17.9, 21.4)) * 0.14;
    return acc;
  }
  return valueNoise3(q) * 0.66 + valueNoise3(q * 2.07 + vec3f(13.7, 5.3, 9.1)) * 0.34;
}

fn ign(xy: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(xy, vec2f(0.06711056, 0.00583715))));
}

@compute @workgroup_size(8, 8, 1)
fn cs_inject(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec3u(u32(u.dimsInfo.x), u32(u.dimsInfo.y), u32(u.dimsInfo.z));
  if (gid.x >= dims.x || gid.y >= dims.y || gid.z >= dims.z) {
    return;
  }

  let uv = (vec2f(f32(gid.x), f32(gid.y)) + 0.5) / u.dimsInfo.xy;
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let rayOffset = u.fwdScale.xyz
    + u.rightAspect.xyz * (ndcX * u.eyeTan.w * u.rightAspect.w)
    + u.upTime.xyz * (ndcY * u.eyeTan.w);
  let rd = normalize(rayOffset);

  let nearDist = u.depthBase.x;
  let log2Ratio = u.depthBase.z;
  let invSlices = u.dimsInfo.w;

  // Spatial IGN + temporal golden-ratio Z-slice jitter to eliminate Z-banding.
  let jitterZ = select(0.5, fract(ign(vec2f(f32(gid.x), f32(gid.y))) + u.temporal.y), u.temporal.w > 0.5);
  let dSample = sliceToDepthLocal(f32(gid.z) + jitterZ, invSlices, nearDist, log2Ratio);
  let relPos = rayOffset * dSample;
  let worldPos = u.eyeTan.xyz + relPos;

  // 1. Procedural SF marine-layer height fog + animated 3D FBM wisps + uniform ambient haze.
  var sigmaT = max(u.depthBase.w, 0.0);
  var crestFactor = 0.5;
  let hDens = u.heightFog.x;
  if (hDens > 0.0) {
    let y = worldPos.y;
    let yBase = u.heightFog.y;
    let yTop = u.heightFog.z;
    let noiseAmt = u.albedoNoise.w;
    // Skip 3D FBM completely for sky froxels strictly above the maximum wavy ceiling.
    if (y < yTop + noiseAmt * 140.0) {
      let invFalloff = u.heightFog.w;
      var wisp = 0.5;
      if (noiseAmt > 0.001) {
        wisp = fbm3(worldPos, gid.z < 28u);
      }
      // Wavy marine-layer ceiling modulated by Pacific-drifted FBM.
      let topMod = yTop + (wisp - 0.5) * noiseAmt * 260.0;
      let span = max(1.0 / max(invFalloff, 1e-6), 1.0);
      let belowCeiling = 1.0 - smoothstep(topMod - span, topMod, y);
      let expDecay = exp(-max(y - yBase, 0.0) * invFalloff * 0.45);
      let wispMod = mix(1.0, 0.35 + 1.3 * wisp, noiseAmt);
      sigmaT += hDens * belowCeiling * expDecay * wispMod;
      crestFactor = smoothstep(topMod - span * 1.4, topMod, y);
    } else {
      crestFactor = 1.0;
    }
  }
  sigmaT *= max(u.fwdScale.w, 0.0);

  // 2. In-scattering from directional sun/moon, ambient sky/city glow, and local volumetric lights.
  var inScatter = vec3f(0.0);
  if (sigmaT > 1e-6) {
    let albedo = u.albedoNoise.xyz;
    var lightAccum = vec3f(0.0);

    // Directional sun/moon with Henyey-Greenstein phase and optional shadow/visibility map.
    let sunBaseVis = u.sunColVis.w;
    if (sunBaseVis > 0.0 && any(u.sunColVis.xyz > vec3f(0.0))) {
      var sunVis = sunBaseVis;
      // Analytical vertical self-shadowing inside the marine layer bank (brighter near crest).
      if (u.heightFog.x > 0.0) {
        let depthIntoBank = max(u.heightFog.z - worldPos.y, 0.0) * METERS_PER_CELL;
        let bankAtten = exp(-depthIntoBank * u.heightFog.x * 0.18);
        sunVis *= mix(0.45, 1.0, bankAtten);
      }
      if (u.ambSkyMode.w > 0.5) {
        let sc = u.sunShadowProj * vec4f(relPos, 1.0);
        if (sc.w > 1e-4) {
          let sndc = sc.xyz / sc.w;
          let suv = vec2f(sndc.x * 0.5 + 0.5, 0.5 - sndc.y * 0.5);
          if (all(suv >= vec2f(0.0)) && all(suv <= vec2f(1.0)) && sndc.z >= 0.0 && sndc.z <= 1.0) {
            let mapVal = textureSampleLevel(sunShadowTex, linearSamp, suv, 0.0).r;
            if (u.ambSkyMode.w < 1.5) {
              sunVis *= select(0.0, 1.0, sndc.z - u.ambGroundBias.w <= mapVal);
            } else {
              sunVis *= clamp(mapVal, 0.0, 1.0);
            }
          }
        }
      }
      let cosSun = dot(rd, u.sunDirG.xyz);
      let sunPhase = dualPhase(cosSun, u.sunDirG.w);
      lightAccum += u.sunColVis.xyz * (sunVis * sunPhase);
    }

    // Ambient sky overhead + warm city/ground under-glow.
    let amb = mix(u.ambGroundBias.xyz, u.ambSkyMode.xyz, clamp(crestFactor, 0.0, 1.0));
    lightAccum += amb * INV_4PI;

    // Local point & spot lights (car headlights, SF street lamps, fires).
    let lightCount = min(lights.info.x, ${MAX_FROXEL_LIGHTS}u);
    for (var i = 0u; i < lightCount; i++) {
      let l = lights.items[i];
      let toFroxel = relPos - l.posRange.xyz;
      let distSq = dot(toFroxel, toFroxel);
      let rNorm = distSq * l.posRange.w;
      if (rNorm >= 1.0) {
        continue;
      }
      let win = 1.0 - rNorm * rNorm;
      let falloff = (win * win) / (1.0 + distSq * l.params.x);
      let invDist = inverseSqrt(max(distSq, 1e-6));
      let lightToFroxel = toFroxel * invDist;

      var cone = 1.0;
      if (l.dirCone.w > -1.5) {
        let cosAng = dot(lightToFroxel, l.dirCone.xyz);
        cone = clamp((cosAng - l.dirCone.w) * l.colSpot.w, 0.0, 1.0);
        cone = cone * cone * (3.0 - 2.0 * cone);
        if (cone <= 0.0) {
          continue;
        }
      }

      // Incoming photon direction is lightToFroxel; scattered direction to eye is -rd.
      let cosLight = dot(lightToFroxel, -rd);
      let lPhase = dualPhase(cosLight, l.params.y);
      lightAccum += l.colSpot.xyz * (falloff * cone * lPhase * l.params.z);
    }

    inScatter = albedo * lightAccum * sigmaT;
  }

  var result = vec4f(inScatter, sigmaT);

  // 3. Temporal reprojection against previous frame's unjittered froxel volume.
  if (u.temporal.z > 0.5) {
    let dCenter = sliceToDepthLocal(f32(gid.z) + 0.5, invSlices, nearDist, log2Ratio);
    let relCenter = rayOffset * dCenter;
    let prevClip = u.prevRelViewProj * vec4f(relCenter, 1.0);
    let prevNear = u.prevDepth.x;
    let prevMax = u.prevDepth.y;
    if (prevClip.w > prevNear && prevClip.w < prevMax) {
      let prevNdc = prevClip.xy / prevClip.w;
      let prevUv = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
      if (all(prevUv >= vec2f(0.0)) && all(prevUv <= vec2f(1.0))) {
        let prevW = depthToSliceLocal(prevClip.w, u.dimsInfo.z, prevNear, u.prevDepth.z) * invSlices;
        let prevVal = textureSampleLevel(prevScatter, linearSamp, vec3f(prevUv, prevW), 0.0);
        // Clamp to non-negative finite values before EMA blending.
        let safePrev = max(prevVal, vec4f(0.0));
        result = mix(safePrev, result, clamp(u.temporal.x, 0.01, 1.0));
      }
    }
  }

  textureStore(currScatter, vec3i(gid), result);
}
`

const INTEGRATE_WGSL = /* wgsl */ `
${COMPUTE_COMMON_WGSL}

@group(0) @binding(0) var<uniform> iu: InjectUniforms;
@group(0) @binding(1) var scatterIn: texture_3d<f32>;
@group(0) @binding(2) var integratedOut: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn cs_integrate(@builtin(global_invocation_id) gid: vec3u) {
  let dims = vec3u(u32(iu.dimsInfo.x), u32(iu.dimsInfo.y), u32(iu.dimsInfo.z));
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let uv = (vec2f(f32(gid.x), f32(gid.y)) + 0.5) / iu.dimsInfo.xy;
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = 1.0 - uv.y * 2.0;
  let rayOffset = iu.fwdScale.xyz
    + iu.rightAspect.xyz * (ndcX * iu.eyeTan.w * iu.rightAspect.w)
    + iu.upTime.xyz * (ndcY * iu.eyeTan.w);
  let rayLen = length(rayOffset);

  let nearDist = iu.depthBase.x;
  let invSlices = iu.dimsInfo.w;
  let sliceRatio = exp2(iu.depthBase.z * invSlices);

  var accScatter = vec3f(0.0);
  var accTrans = 1.0;
  var d0 = nearDist;

  for (var z = 0u; z < dims.z; z++) {
    let d1 = d0 * sliceRatio;
    let dsMeters = (d1 - d0) * rayLen * METERS_PER_CELL;
    d0 = d1;

    let cell = textureLoad(scatterIn, vec3i(i32(gid.x), i32(gid.y), i32(z)), 0);
    let inScatter = max(cell.rgb, vec3f(0.0));
    let sigmaT = max(cell.a, 0.0);
    let tau = sigmaT * dsMeters;
    let sliceTrans = exp(-tau);

    // Analytical constant-medium Beer-Lambert integration with Taylor guard for small optical depth.
    var integFactor: f32;
    if (tau > 1e-3) {
      integFactor = (1.0 - sliceTrans) / max(sigmaT, 1e-6);
    } else {
      integFactor = dsMeters * (1.0 - 0.5 * tau + 0.16666667 * tau * tau);
    }

    accScatter += accTrans * (inScatter * integFactor);
    accTrans *= sliceTrans;
    textureStore(integratedOut, vec3i(i32(gid.x), i32(gid.y), i32(z)), vec4f(accScatter, accTrans));
  }
}
`

const COMPOSITE_WGSL = /* wgsl */ `
struct FroxelCompositeView {
  // xy: active viewport size (0 => fall back to sceneDepth dimensions), z: hasFarDepth (0/1), w: skyWeight (0..1)
  viewport: vec4f,
}

@group(0) @binding(0) var froxelFogVolume: texture_3d<f32>;
@group(0) @binding(1) var froxelFogSampler: sampler;
@group(0) @binding(2) var<uniform> froxelFogParams: FroxelFogParams;
@group(0) @binding(3) var sceneDepth: texture_depth_2d;
@group(0) @binding(4) var farDepth: texture_depth_2d;
@group(0) @binding(5) var<uniform> compView: FroxelCompositeView;

${FROXEL_FOG_WGSL}
@group(0) @binding(8) var<storage, read> lightInfo: vec4u;
@group(0) @binding(6) var<storage, read> edgeBits: array<u32>;
@group(0) @binding(7) var<storage, read_write> discontinuityMask: array<atomic<u32>>;

fn sceneSurface(px: vec2i) -> vec2f {
  let z = textureLoad(sceneDepth, px, 0);
  let nearD = froxelFogParams.flags.y;
  let farD = froxelFogParams.flags.z;
  var linearDepth = froxelFogParams.depth.y;
  var isSky = z >= 0.999999;
  if (!isSky) {
    linearDepth = nearD / max(1.0 - z * (farD - nearD) / farD, 1e-6);
  }
  if (compView.viewport.z > 0.5) {
    let fDims = vec2i(textureDimensions(farDepth));
    let fpx = clamp(px, vec2i(0), max(fDims - vec2i(1), vec2i(0)));
    let w = textureLoad(farDepth, fpx, 0);
    if (w > 0.0) {
      linearDepth = min(linearDepth, 1.0 / w);
      isSky = false;
    }
  }

  return vec2f(linearDepth, f32(isSky));
}

fn maskIndex(col: vec2u, layer: u32, dims: vec3u) -> u32 {
  return (col.x + col.y * dims.x) * ((dims.z + 31u) / 32u) + layer / 32u;
}

@compute @workgroup_size(8, 8, 1)
fn cs_discontinuity(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(froxelFogVolume);
  if (any(gid.xy >= dims.xy)) { return; }
  let screen = vec2i(select(vec2f(textureDimensions(sceneDepth)), compView.viewport.xy, compView.viewport.x > 0.5));
  let tile = vec2f(screen) / vec2f(dims.xy);
  // Cover the full bilinear footprint, including sub-froxel-width geometry.
  let lo = max(vec2i(floor((vec2f(gid.xy) - 0.5) * tile)), vec2i(0));
  let hi = min(vec2i(ceil((vec2f(gid.xy) + 1.5) * tile)), screen);
  var dMin = 1e30;
  var dMax = 0.0;
  for (var y = lo.y; y < hi.y; y++) {
    for (var x = lo.x; x < hi.x; x++) {
      let d = sceneSurface(vec2i(x,y)).x;
      dMin = min(dMin, d);
      dMax = max(dMax, d);
    }
  }
  let silhouette = dMax > dMin * 1.10;
  if (silhouette) {
    for (var z = 0u; z < dims.z; z += 32u) {
      atomicOr(&discontinuityMask[maskIndex(gid.xy, z, dims)], 0xffffffffu);
    }
    return;
  }
  if (lightInfo.x == 0u) { return; }
  let pt = vec2i(gid.xy);
  let last = vec2i(dims.xy) - 1;
  let right = min(pt + vec2i(1,0), last);
  let below = min(pt + vec2i(0,1), last);
  for (var z = 0u; z < dims.z; z++) {
    let rgb = textureLoad(froxelFogVolume, vec3i(pt,i32(z)), 0).rgb;
    let rx = textureLoad(froxelFogVolume, vec3i(right,i32(z)), 0).rgb;
    let ry = textureLoad(froxelFogVolume, vec3i(below,i32(z)), 0).rgb;
    let bit = 1u << (z & 31u);
    let xEdge = length(rgb-rx) > 0.05 + 0.25 * min(length(rgb), length(rx));
    let yEdge = length(rgb-ry) > 0.05 + 0.25 * min(length(rgb), length(ry));
    if (xEdge || yEdge) { atomicOr(&discontinuityMask[maskIndex(gid.xy, z, dims)], bit); }
    if (xEdge) { atomicOr(&discontinuityMask[maskIndex(vec2u(right), z, dims)], bit); }
    if (yEdge) { atomicOr(&discontinuityMask[maskIndex(vec2u(below), z, dims)], bit); }
  }
}

@vertex fn vs(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((idx << 1u) & 2u), f32(idx & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let depthDims = vec2f(textureDimensions(sceneDepth));
  let activeDims = select(depthDims, compView.viewport.xy, compView.viewport.x > 0.5 && compView.viewport.y > 0.5);
  let uv = pos.xy / max(activeDims, vec2f(1.0));
  let px = clamp(vec2i(pos.xy), vec2i(0), vec2i(depthDims) - vec2i(1));
  let surface = sceneSurface(px);
  let linearDepth = surface.x;
  let isSky = surface.y > 0.5;
  var fog = sampleFroxelFog(uv, linearDepth);
  let dims = textureDimensions(froxelFogVolume);
  let col = min(vec2u(uv * vec2f(dims.xy)), dims.xy - 1u);
  let slice = froxelDepthToSlice(linearDepth, f32(dims.z), froxelFogParams.depth.x, froxelFogParams.depth.w);
  let layer = min(u32(max(slice - 0.5, 0.0)), dims.z - 1u);
  let word = maskIndex(col, layer, dims);
  if ((edgeBits[word] & (1u << (layer & 31u))) != 0u) {
    let grid = uv * vec2f(dims.xy) - 0.5;
    let base = vec2i(floor(grid));
    let f = fract(grid);
    let centreUv = (vec2f(col) + 0.5) / vec2f(dims.xy);
    let refDepth = sceneSurface(min(vec2i(centreUv * activeDims), vec2i(activeDims)-1)).x;
    let sameSurface = abs(refDepth - linearDepth) <= 0.10 * min(refDepth, linearDepth);
    let refFog = sampleFroxelFog(centreUv, linearDepth);
    var sum = vec4f(0.0);
    var weight = 0.0;
    for (var j = 0; j < 4; j++) {
      let offset = vec2i(j & 1, j >> 1);
      let tap = clamp(base + offset, vec2i(0), vec2i(dims.xy)-1);
      let tapUv = (vec2f(tap) + 0.5) / vec2f(dims.xy);
      let d = sceneSurface(min(vec2i(tapUv * activeDims), vec2i(activeDims)-1)).x;
      let delta = abs(d - linearDepth) / max(min(d, linearDepth), 0.001);
      let value = sampleFroxelFog(tapUv, linearDepth);
      let spatial = select(1.0 - f, f, offset != vec2i(0));
      let lightDelta = select(0.0, length(value.rgb - refFog.rgb) / (0.1 + length(refFog.rgb)), sameSurface);
      let w = spatial.x * spatial.y * exp2(-16.0 * delta - 2.0 * lightDelta);
      sum += value * w;
      weight += w;
    }
    if (weight > 0.00001) { fog = sum / weight; }
  }
  if (isSky) {
    let sw = clamp(compView.viewport.w, 0.0, 1.0);
    if (sw <= 0.001) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    fog = vec4f(fog.rgb * sw, mix(1.0, fog.a, sw));
  }
  // Blended with srcFactor: 'one', dstFactor: 'src-alpha' -> dst = dst * fog.a + fog.rgb.
  return vec4f(fog.rgb, fog.a);
}
`

export interface FroxelLightInput {
  kind: 'point' | 'spot'
  /** World-space position in cells (1 cell = 0.1 m). */
  position: V3
  /** Linear HDR colour / luminous intensity. */
  color: V3
  /** Effective maximum reach in cells. */
  range: number
  /** Distance (cells) where attenuation reaches 0.5 (default `range * 0.25`). */
  halfDist?: number
  /** Unit direction for spotlights (pointing out of the lamp). */
  direction?: V3
  /** Cosine of outer cone half-angle (spotlights only). */
  cosOuter?: number
  /** Cosine of inner cone half-angle (spotlights only). */
  cosInner?: number
  /** Henyey-Greenstein anisotropy g in `[-0.95, 0.95]` (default `0.62`). */
  anisotropy?: number
  /** Volumetric scattering multiplier (default `1.0`). */
  volumetricScale?: number
}

export interface FroxelFogUpdateParams {
  /** Scene depth for discontinuity detection, retained for this frame’s composite. */
  depthTex?: GPUTextureView | GPUTexture
  view: View
  aspect: number
  time?: number
  nearDist?: number
  maxDist?: number
  /** Uniform ambient haze extinction in m^-1 (default `0.0004`). */
  baseDensity?: number
  /** Marine-layer height fog extinction in m^-1 (default `0.012`). */
  heightDensity?: number
  /** Altitude of peak marine fog in cells (default `0`). */
  heightBase?: number
  /** Marine-layer ceiling altitude in cells (default `1100` = 110 m). */
  heightTop?: number
  /** Height falloff span in cells (default `300` = 30 m). */
  heightFalloff?: number
  /** 3D FBM wisp modulation amount in `[0, 1]` (default `0.65`). */
  noiseAmount?: number
  /** Spatial frequency of 3D wisps in `1 / cells` (default `1 / 1800`). */
  noiseScale?: number
  /** Wind drift velocity in cells/s (default `[18, 0, 5]`). */
  wind?: V3
  /** Single-scattering fog albedo RGB (default `[0.92, 0.94, 0.97]`). */
  albedo?: V3
  /** Global extinction multiplier (default `1.0`; `0` = clear air). */
  extinctionScale?: number
  /** Unit direction toward sun/moon (default `[0.5088, 0.7632, 0.3976]`). */
  sunDir?: V3
  /** Linear HDR sun/moon radiance (default `[1.4, 1.32, 1.18]`). */
  sunColor?: V3
  /** Sun Henyey-Greenstein forward anisotropy g (default `0.65`). */
  sunAnisotropy?: number
  /** Analytical sun visibility multiplier `[0, 1]` (default `1.0`). */
  sunVisibility?: number
  /** Optional 2D sun shadow or visibility map (`rgba8unorm` / `rgba16float`). */
  sunShadowMap?: GPUTextureView | null
  /** Optional 4x4 column-major matrix mapping camera-relative world position to shadow clip space. */
  sunShadowProj?: Float32Array | readonly number[] | null
  /** How to interpret `sunShadowMap`: `'depth'` compares `z <= r`, `'visibility'` uses `r` directly. */
  sunShadowMode?: 'none' | 'depth' | 'visibility'
  /** Depth bias when `sunShadowMode === 'depth'` (default `0.002`). */
  sunShadowBias?: number
  /** Ambient overhead sky radiance (default `[0.22, 0.27, 0.36]`). */
  ambientSky?: V3
  /** Ambient city/ground under-glow radiance (default `[0.12, 0.11, 0.10]`). */
  ambientGround?: V3
  /** Local point & spot lights. If omitted, uses lights staged via `beginLights()` / `addPoint()` / `addSpot()`. */
  localLights?: readonly FroxelLightInput[]
  /** Temporal EMA blend factor (default `0.10`). */
  temporalAlpha?: number
  /** Enable per-frame Z-slice jitter (default `true`). */
  temporalJitter?: boolean
  /** Discard temporal history immediately for this frame (default `false`). */
  reset?: boolean
  /** Optional GPU timestamp writes for `cs_inject`. */
  injectTimestampWrites?: GPUComputePassTimestampWrites
  /** Optional GPU timestamp writes for `cs_integrate`. */
  integrateTimestampWrites?: GPUComputePassTimestampWrites
}

export interface FroxelFogApplyParams {
  target: GPUTextureView
  format: GPUTextureFormat
  depth: GPUTextureView
  depthTex?: GPUTextureView | GPUTexture
  /** Optional far-model reciprocal-depth texture (`farModel.depth`, `depth32float`). */
  farDepth?: GPUTextureView | null
  /** Optional active dynamic-resolution viewport `[width, height]` inside a larger grow-only target. */
  viewportSize?: readonly [number, number]
  /** Scene depth NEAR in cells (default `NEAR = 1`). */
  near?: number
  /** Scene depth FAR in cells (default `FAR = 100000`). */
  far?: number
  /** Composite strength multiplier `[0, 1]` (default `1.0`). */
  strength?: number
  /** Open-sky composite weight `[0, 1]` for pixels with `z >= 0.999999` and no far geometry (default `1.0`). */
  skyWeight?: number
  timestampWrites?: GPURenderPassTimestampWrites
}

export interface FroxelFogStats {
  dims: readonly [number, number, number]
  froxels: number
  frame: number
  activeLights: number
  nearDist: number
  maxDist: number
  historyValid: boolean
  vramBytes: number
}

export interface FroxelFogPass {
  readonly dims: readonly [number, number, number]
  /** Per-column slice flags from the last depth-aware update or composite, low slice first. */
  readonly discontinuityMask: GPUBuffer
  readonly integratedTexture: GPUTexture
  readonly integratedView: GPUTextureView
  readonly sampler: GPUSampler
  readonly samplingUniforms: GPUBuffer
  /** Clears staged zero-GC local lights before adding points/spots for the current frame. */
  beginLights(): void
  /** Zero-GC point light registration (world-space coordinates in cells). */
  addPoint(
    px: number, py: number, pz: number,
    cr: number, cg: number, cb: number,
    range: number, halfDist?: number, anisotropy?: number, volumetricScale?: number,
  ): void
  /** Zero-GC spotlight cone registration (world-space coordinates in cells). */
  addSpot(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, cosOuter: number, cosInner: number,
    halfDist?: number, anisotropy?: number, volumetricScale?: number,
  ): void
  /** Runs `cs_inject` + `cs_integrate` and returns the integrated 3D volume view. */
  update(encoder: GPUCommandEncoder, params: FroxelFogUpdateParams): GPUTextureView
  /** Fullscreen linear-HDR composite pass: `color = color * transmittance + inScatter`. */
  apply(encoder: GPUCommandEncoder, params: FroxelFogApplyParams | Omit<FroxelFogApplyParams, 'depth'>): void
  /** Marks temporal history invalid so the next `update()` starts cleanly with zero lag. */
  reset(): void
  /** Current volume dimensions, counters, and VRAM footprint. */
  stats(): FroxelFogStats
  /** Destroys all owned GPU textures and buffers. */
  destroy(): void
}

/** Writes camera-relative previous view-projection matrix (column-major) into `out` at `offset` in float64 precision. */
function writePrevRelViewProj(
  out: Float32Array<ArrayBuffer>,
  offset: number,
  currEye: V3,
  prevEye: V3,
  prevRight: V3,
  prevUp: V3,
  prevForward: V3,
  prevTanHalf: number,
  prevAspect: number,
  prevNear: number,
  prevMax: number,
): void {
  const dx = currEye[0] - prevEye[0]
  const dy = currEye[1] - prevEye[1]
  const dz = currEye[2] - prevEye[2]
  const f = 1 / prevTanHalf
  const fx = f / prevAspect
  const bx = -prevForward[0], by = -prevForward[1], bz = -prevForward[2]
  const a = prevMax / (prevNear - prevMax)
  const b = (prevMax * prevNear) / (prevNear - prevMax)

  // Translation of currEye in previous camera view space: dot(axis, currEye - prevEye).
  const tx = prevRight[0] * dx + prevRight[1] * dy + prevRight[2] * dz
  const ty = prevUp[0] * dx + prevUp[1] * dy + prevUp[2] * dz
  const tz = bx * dx + by * dy + bz * dz

  // Column 0
  out[offset + 0] = fx * prevRight[0]
  out[offset + 1] = f * prevUp[0]
  out[offset + 2] = a * bx
  out[offset + 3] = -bx
  // Column 1
  out[offset + 4] = fx * prevRight[1]
  out[offset + 5] = f * prevUp[1]
  out[offset + 6] = a * by
  out[offset + 7] = -by
  // Column 2
  out[offset + 8] = fx * prevRight[2]
  out[offset + 9] = f * prevUp[2]
  out[offset + 10] = a * bz
  out[offset + 11] = -bz
  // Column 3
  out[offset + 12] = fx * tx
  out[offset + 13] = f * ty
  out[offset + 14] = a * tz + b
  out[offset + 15] = -tz
}

/** Creates a standalone, zero-GC WebGPU 3D froxel volumetric fog engine. */
export async function createFroxelFog(
  device: GPUDevice,
  dims: readonly [number, number, number] = DEFAULT_FROXEL_DIMS,
): Promise<FroxelFogPass> {
  const width = Math.max(1, Math.floor(dims[0]))
  const height = Math.max(1, Math.floor(dims[1]))
  const slices = Math.max(2, Math.floor(dims[2]))
  const resolvedDims: readonly [number, number, number] = [width, height, slices]
  const froxels = width * height * slices
  const maskBytes = width * height * Math.ceil(slices / 32) * 4
  const vramBytes = maskBytes + froxels * 8 * 3 // 2 ping-pong scatter + 1 integrated rgba16float 3D textures

  const [injectModule, integrateModule, compositeModule] = await Promise.all([
    shader(device, 'froxel-fog-inject', INJECT_WGSL),
    shader(device, 'froxel-fog-integrate', INTEGRATE_WGSL),
    shader(device, 'froxel-fog-composite', COMPOSITE_WGSL),
  ])

  const edgePipeline = await device.createComputePipelineAsync({
    layout: 'auto', compute: { module: compositeModule, entryPoint: 'cs_discontinuity' },
  })
  const edgeMask = device.createBuffer({
    label: 'froxel-discontinuity', size: maskBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const injectLayout = device.createBindGroupLayout({
    label: 'froxel-inject-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    ],
  })

  const integrateLayout = device.createBindGroupLayout({
    label: 'froxel-integrate-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
    ],
  })

  const compositeLayout = device.createBindGroupLayout({
    label: 'froxel-composite-bgl',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  })

  const [injectPipeline, integratePipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: 'froxel-inject',
      layout: device.createPipelineLayout({ bindGroupLayouts: [injectLayout] }),
      compute: { module: injectModule, entryPoint: 'cs_inject' },
    }),
    device.createComputePipelineAsync({
      label: 'froxel-integrate',
      layout: device.createPipelineLayout({ bindGroupLayouts: [integrateLayout] }),
      compute: { module: integrateModule, entryPoint: 'cs_integrate' },
    }),
  ])

  const compositePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] })
  const compositePipelines = new Map<GPUTextureFormat, GPURenderPipeline>()
  const getCompositePipeline = (format: GPUTextureFormat): GPURenderPipeline => {
    let pipe = compositePipelines.get(format)
    if (!pipe) {
      pipe = device.createRenderPipeline({
        label: `froxel-composite-${format}`,
        layout: compositePipelineLayout,
        vertex: { module: compositeModule, entryPoint: 'vs' },
        fragment: {
          module: compositeModule,
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              // Linear HDR blend: dst = dst * transmittance + inScatter (preserving dst alpha).
              color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
            },
          }],
        },
      })
      compositePipelines.set(format, pipe)
    }
    return pipe
  }

  const volumeUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
  const makeVolume = (label: string) => device.createTexture({
    label,
    size: [width, height, slices],
    dimension: '3d',
    format: 'rgba16float',
    usage: volumeUsage,
  })
  const scatterTex0 = makeVolume('froxel-scatter-0')
  const scatterTex1 = makeVolume('froxel-scatter-1')
  const integratedTexture = makeVolume('froxel-integrated')
  const scatterViews: readonly [GPUTextureView, GPUTextureView] = [scatterTex0.createView(), scatterTex1.createView()]
  const integratedView = integratedTexture.createView()

  // Default 1x1 white 2D texture when no external sun shadow/visibility map is bound.
  const dummyShadowTex = device.createTexture({
    label: 'froxel-shadow-dummy',
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: dummyShadowTex },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4 },
    [1, 1],
  )
  const dummyShadowView = dummyShadowTex.createView()

  // Default 1x1 zero depth32float texture when no external far-model depth is bound.
  const dummyFarDepthTex = device.createTexture({
    label: 'froxel-far-depth-dummy',
    size: [1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const dummyFarDepthView = dummyFarDepthTex.createView()
  {
    const clearEnc = device.createCommandEncoder()
    clearEnc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: dummyFarDepthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    }).end()
    device.queue.submit([clearEnc.finish()])
  }
  const compViewUniforms = device.createBuffer({
    label: 'froxel-composite-view-u',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const compViewF32 = new Float32Array(new ArrayBuffer(16))

  const sampler = device.createSampler({
    label: 'froxel-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  })

  const injectUniforms = device.createBuffer({
    label: 'froxel-inject-u',
    size: INJECT_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const lightsBuffer = device.createBuffer({
    label: 'froxel-lights',
    size: LIGHTS_BUFFER_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const samplingUniforms = device.createBuffer({
    label: 'froxel-sampling-u',
    size: SAMPLING_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  // Pre-allocated zero-GC CPU staging buffers.
  const injectBuf = new ArrayBuffer(INJECT_UNIFORM_BYTES)
  const injectF32 = new Float32Array(injectBuf)
  const samplingBuf = new ArrayBuffer(SAMPLING_UNIFORM_BYTES)
  const samplingF32 = new Float32Array(samplingBuf)
  const lightsBuf = new ArrayBuffer(LIGHTS_BUFFER_BYTES)
  const lightsU32 = new Uint32Array(lightsBuf)
  const lightsF32 = new Float32Array(lightsBuf)

  // Staged world-space local lights (float64 for lossless eye-relative subtraction anywhere in SF).
  // Stride 16 doubles per light: pos(3), range(1), dir(3), cosOuter(1), col(3), cosInner(1), halfDist(1), g(1), scale(1), pad(1)
  const stagedLights = new Float64Array(MAX_FROXEL_LIGHTS * 16)
  let stagedCount = 0

  const makeInjectBinds = (shadowView: GPUTextureView): readonly [GPUBindGroup, GPUBindGroup] => [
    device.createBindGroup({
      label: 'froxel-inject-bg-0',
      layout: injectLayout,
      entries: [
        { binding: 0, resource: { buffer: injectUniforms } },
        { binding: 1, resource: { buffer: lightsBuffer } },
        { binding: 2, resource: scatterViews[1] },
        { binding: 3, resource: sampler },
        { binding: 4, resource: shadowView },
        { binding: 5, resource: scatterViews[0] },
      ],
    }),
    device.createBindGroup({
      label: 'froxel-inject-bg-1',
      layout: injectLayout,
      entries: [
        { binding: 0, resource: { buffer: injectUniforms } },
        { binding: 1, resource: { buffer: lightsBuffer } },
        { binding: 2, resource: scatterViews[0] },
        { binding: 3, resource: sampler },
        { binding: 4, resource: shadowView },
        { binding: 5, resource: scatterViews[1] },
      ],
    }),
  ]

  let cachedShadowView: GPUTextureView = dummyShadowView
  let injectBinds: readonly [GPUBindGroup, GPUBindGroup] = makeInjectBinds(dummyShadowView)

  const integrateBinds: readonly [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      label: 'froxel-integrate-bg-0',
      layout: integrateLayout,
      entries: [
        { binding: 0, resource: { buffer: injectUniforms } },
        { binding: 1, resource: scatterViews[0] },
        { binding: 2, resource: integratedView },
      ],
    }),
    device.createBindGroup({
      label: 'froxel-integrate-bg-1',
      layout: integrateLayout,
      entries: [
        { binding: 0, resource: { buffer: injectUniforms } },
        { binding: 1, resource: scatterViews[1] },
        { binding: 2, resource: integratedView },
      ],
    }),
  ]

  let cachedDepthView: GPUTextureView | null = null
  let cachedFarDepthView: GPUTextureView | null = null
  let cachedCompositeBind: GPUBindGroup | null = null

  const textureViews = new WeakMap<GPUTexture, GPUTextureView>()
  function depthView(source?: GPUTextureView | GPUTexture) {
    if (!source || !('createView' in source)) return source
    let view = textureViews.get(source)
    if (!view) {
      view = source.createView()
      textureViews.set(source, view)
    }
    return view
  }
  let updateDepth: GPUTextureView | undefined
  let edgeBind: GPUBindGroup
  let edgeDepth: GPUTextureView | undefined
  const fullViewport = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM })
  let edgeViewport: GPUBuffer | undefined
  let edgeFar: GPUTextureView | undefined
  const detectEdges = (encoder: GPUCommandEncoder, depth: GPUTextureView, farView: GPUTextureView, viewport = compViewUniforms) => {
    if (edgeDepth !== depth || edgeFar !== farView || edgeViewport !== viewport) {
      edgeViewport = viewport
      edgeDepth = depth
      edgeFar = farView
      edgeBind = device.createBindGroup({
        layout: edgePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: integratedView },
          { binding: 2, resource: { buffer: samplingUniforms } },
          { binding: 3, resource: depth },
          { binding: 4, resource: farView },
          { binding: 5, resource: { buffer: viewport } },
          { binding: 7, resource: { buffer: edgeMask } },
          { binding: 8, resource: { buffer: lightsBuffer } },
        ],
      })
    }
    encoder.clearBuffer(edgeMask)
    const pass = encoder.beginComputePass({ label: 'froxel-discontinuity' })
    pass.setPipeline(edgePipeline)
    pass.setBindGroup(0, edgeBind)
    pass.dispatchWorkgroups(wgX, wgY)
    pass.end()
  }

  // Mutable previous-frame camera state (pre-allocated arrays, zero GC).
  const prevEye: [number, number, number] = [0, 0, 0]
  const prevRight: [number, number, number] = [1, 0, 0]
  const prevUp: [number, number, number] = [0, 1, 0]
  const prevForward: [number, number, number] = [0, 0, 1]
  let prevTanHalf = 0.577350269
  let prevAspect = 16 / 9
  let prevNearDist = DEFAULT_NEAR_DIST
  let prevMaxDist = DEFAULT_MAX_DIST
  let curNearDist = DEFAULT_NEAR_DIST
  let curMaxDist = DEFAULT_MAX_DIST
  let historyValid = false
  let ping = 0
  let frame = 0
  let activeLights = 0
  let destroyed = false

  const wgX = Math.ceil(width / 8)
  const wgY = Math.ceil(height / 8)

  const packOneLight = (
    slot: number,
    eyeX: number, eyeY: number, eyeZ: number,
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    cr: number, cg: number, cb: number,
    range: number, cosOuter: number, cosInner: number,
    halfDist: number, anisotropy: number, volumetricScale: number,
  ): void => {
    const o = 4 + slot * 16
    const safeRange = Math.max(range, 1)
    const safeHalf = Math.max(halfDist, 0.5)
    lightsF32[o + 0] = px - eyeX
    lightsF32[o + 1] = py - eyeY
    lightsF32[o + 2] = pz - eyeZ
    lightsF32[o + 3] = 1 / (safeRange * safeRange)
    lightsF32[o + 4] = dx
    lightsF32[o + 5] = dy
    lightsF32[o + 6] = dz
    lightsF32[o + 7] = cosOuter
    lightsF32[o + 8] = cr
    lightsF32[o + 9] = cg
    lightsF32[o + 10] = cb
    lightsF32[o + 11] = cosOuter > -1.5 ? 1 / Math.max(cosInner - cosOuter, 1e-4) : 0
    lightsF32[o + 12] = 1 / (safeHalf * safeHalf)
    lightsF32[o + 13] = Math.max(-0.95, Math.min(0.95, anisotropy))
    lightsF32[o + 14] = volumetricScale
    lightsF32[o + 15] = 0
  }

  const self: FroxelFogPass = {
    dims: resolvedDims,
    discontinuityMask: edgeMask,
    integratedTexture,
    integratedView,
    sampler,
    samplingUniforms,

    beginLights() {
      stagedCount = 0
    },

    addPoint(px, py, pz, cr, cg, cb, range, halfDist, anisotropy = 0.62, volumetricScale = 1) {
      if (stagedCount >= MAX_FROXEL_LIGHTS || range <= 0) return
      const o = stagedCount * 16
      stagedLights[o + 0] = px
      stagedLights[o + 1] = py
      stagedLights[o + 2] = pz
      stagedLights[o + 3] = range
      stagedLights[o + 4] = 0
      stagedLights[o + 5] = -1
      stagedLights[o + 6] = 0
      stagedLights[o + 7] = -2 // < -1.5 marks omnidirectional point light
      stagedLights[o + 8] = cr
      stagedLights[o + 9] = cg
      stagedLights[o + 10] = cb
      stagedLights[o + 11] = -2
      stagedLights[o + 12] = halfDist ?? range * 0.25
      stagedLights[o + 13] = anisotropy
      stagedLights[o + 14] = volumetricScale
      stagedLights[o + 15] = 0
      stagedCount++
    },

    addSpot(px, py, pz, dx, dy, dz, cr, cg, cb, range, cosOuter, cosInner, halfDist, anisotropy = 0.62, volumetricScale = 1) {
      if (stagedCount >= MAX_FROXEL_LIGHTS || range <= 0) return
      const dl = Math.hypot(dx, dy, dz) || 1
      const o = stagedCount * 16
      stagedLights[o + 0] = px
      stagedLights[o + 1] = py
      stagedLights[o + 2] = pz
      stagedLights[o + 3] = range
      stagedLights[o + 4] = dx / dl
      stagedLights[o + 5] = dy / dl
      stagedLights[o + 6] = dz / dl
      stagedLights[o + 7] = cosOuter
      stagedLights[o + 8] = cr
      stagedLights[o + 9] = cg
      stagedLights[o + 10] = cb
      stagedLights[o + 11] = cosInner
      stagedLights[o + 12] = halfDist ?? range * 0.25
      stagedLights[o + 13] = anisotropy
      stagedLights[o + 14] = volumetricScale
      stagedLights[o + 15] = 0
      stagedCount++
    },

    update(encoder, params) {
      if (destroyed) throw new Error('froxel-fog: cannot update after destroy()')
      const { view } = params
      const aspect = Math.max(params.aspect, 1e-3)
      const time = params.time ?? 0
      const nearDist = Math.max(params.nearDist ?? DEFAULT_NEAR_DIST, 0.5)
      const maxDist = Math.max(params.maxDist ?? DEFAULT_MAX_DIST, nearDist + 1)
      const invLogRatio = 1 / Math.log(maxDist / nearDist)
      const log2Ratio = Math.log2(maxDist / nearDist)
      const prevInvLog2Ratio = 1 / Math.log2(prevMaxDist / prevNearDist)
      curNearDist = nearDist
      curMaxDist = maxDist

      const baseDensity = params.baseDensity ?? 0.0004
      const heightDensity = params.heightDensity ?? 0.012
      const heightBase = params.heightBase ?? 0
      const heightTop = params.heightTop ?? 1100
      const heightFalloff = Math.max(params.heightFalloff ?? 300, 1)
      const noiseAmount = Math.max(0, Math.min(1, params.noiseAmount ?? 0.65))
      const noiseScale = params.noiseScale ?? 1 / 1800
      const wind = params.wind ?? [18, 0, 5]
      const albedo = params.albedo ?? [0.92, 0.94, 0.97]
      const extinctionScale = params.extinctionScale ?? 1.0

      const sDir = params.sunDir ?? [0.5088, 0.7632, 0.3976]
      const sLen = Math.hypot(sDir[0], sDir[1], sDir[2]) || 1
      const sunCol = params.sunColor ?? [1.4, 1.32, 1.18]
      const sunAniso = params.sunAnisotropy ?? 0.65
      const sunVis = Math.max(0, Math.min(1, params.sunVisibility ?? 1.0))

      const shadowView = params.sunShadowMap ?? dummyShadowView
      if (shadowView !== cachedShadowView) {
        cachedShadowView = shadowView
        injectBinds = makeInjectBinds(shadowView)
      }
      let shadowModeNum = 0
      if (params.sunShadowMap && params.sunShadowProj) {
        shadowModeNum = params.sunShadowMode === 'visibility' ? 2 : params.sunShadowMode === 'none' ? 0 : 1
      }

      const ambSky = params.ambientSky ?? [0.22, 0.27, 0.36]
      const ambGround = params.ambientGround ?? [0.12, 0.11, 0.10]
      const temporalAlpha = Math.max(0.01, Math.min(1, params.temporalAlpha ?? 0.1))
      const temporalJitter = params.temporalJitter ?? true
      const useHistory = historyValid && !params.reset

      // Pack local lights relative to current eye (in float64) for full precision anywhere in SF.
      const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
      let count = 0
      if (params.localLights !== undefined) {
        const list = params.localLights
        const n = Math.min(list.length, MAX_FROXEL_LIGHTS)
        for (let i = 0; i < n; i++) {
          const l = list[i]
          if (l.range <= 0) continue
          if (l.kind === 'spot') {
            const d = l.direction ?? [0, -1, 0]
            const dl = Math.hypot(d[0], d[1], d[2]) || 1
            const cosOuter = l.cosOuter ?? 0.85
            const cosInner = l.cosInner ?? Math.min(0.999, cosOuter + 0.08)
            packOneLight(
              count++, ex, ey, ez,
              l.position[0], l.position[1], l.position[2],
              d[0] / dl, d[1] / dl, d[2] / dl,
              l.color[0], l.color[1], l.color[2],
              l.range, cosOuter, cosInner,
              l.halfDist ?? l.range * 0.25, l.anisotropy ?? 0.62, l.volumetricScale ?? 1,
            )
          } else {
            packOneLight(
              count++, ex, ey, ez,
              l.position[0], l.position[1], l.position[2],
              0, -1, 0,
              l.color[0], l.color[1], l.color[2],
              l.range, -2, -2,
              l.halfDist ?? l.range * 0.25, l.anisotropy ?? 0.62, l.volumetricScale ?? 1,
            )
          }
        }
      } else {
        for (let i = 0; i < stagedCount; i++) {
          const o = i * 16
          packOneLight(
            count++, ex, ey, ez,
            stagedLights[o + 0], stagedLights[o + 1], stagedLights[o + 2],
            stagedLights[o + 4], stagedLights[o + 5], stagedLights[o + 6],
            stagedLights[o + 8], stagedLights[o + 9], stagedLights[o + 10],
            stagedLights[o + 3], stagedLights[o + 7], stagedLights[o + 11],
            stagedLights[o + 12], stagedLights[o + 13], stagedLights[o + 14],
          )
        }
      }
      activeLights = count
      lightsU32[0] = count
      lightsU32[1] = 0
      lightsU32[2] = 0
      lightsU32[3] = 0
      device.queue.writeBuffer(lightsBuffer, 0, lightsBuf, 0, 16 + count * 64)

      // Pack compute uniform block (384 bytes).
      const jitterPhase = (frame * GOLDEN_RATIO_CONJ) % 1
      injectF32[0] = ex; injectF32[1] = ey; injectF32[2] = ez; injectF32[3] = view.tanHalf
      injectF32[4] = view.right[0]; injectF32[5] = view.right[1]; injectF32[6] = view.right[2]; injectF32[7] = aspect
      injectF32[8] = view.up[0]; injectF32[9] = view.up[1]; injectF32[10] = view.up[2]; injectF32[11] = time
      injectF32[12] = view.forward[0]; injectF32[13] = view.forward[1]; injectF32[14] = view.forward[2]; injectF32[15] = extinctionScale
      injectF32[16] = width; injectF32[17] = height; injectF32[18] = slices; injectF32[19] = 1 / slices
      injectF32[20] = nearDist; injectF32[21] = maxDist; injectF32[22] = log2Ratio; injectF32[23] = baseDensity
      injectF32[24] = heightDensity; injectF32[25] = heightBase; injectF32[26] = heightTop; injectF32[27] = 1 / heightFalloff
      injectF32[28] = wind[0]; injectF32[29] = wind[1]; injectF32[30] = wind[2]; injectF32[31] = noiseScale
      injectF32[32] = albedo[0]; injectF32[33] = albedo[1]; injectF32[34] = albedo[2]; injectF32[35] = noiseAmount
      injectF32[36] = sDir[0] / sLen; injectF32[37] = sDir[1] / sLen; injectF32[38] = sDir[2] / sLen; injectF32[39] = sunAniso
      injectF32[40] = sunCol[0]; injectF32[41] = sunCol[1]; injectF32[42] = sunCol[2]; injectF32[43] = sunVis
      injectF32[44] = ambSky[0]; injectF32[45] = ambSky[1]; injectF32[46] = ambSky[2]; injectF32[47] = shadowModeNum
      injectF32[48] = ambGround[0]; injectF32[49] = ambGround[1]; injectF32[50] = ambGround[2]; injectF32[51] = params.sunShadowBias ?? 0.002
      injectF32[52] = temporalAlpha; injectF32[53] = jitterPhase; injectF32[54] = useHistory ? 1 : 0; injectF32[55] = temporalJitter ? 1 : 0
      injectF32[56] = prevNearDist; injectF32[57] = prevMaxDist; injectF32[58] = prevInvLog2Ratio; injectF32[59] = frame
      injectF32[60] = count; injectF32[61] = 0; injectF32[62] = 0; injectF32[63] = 0

      if (useHistory) {
        writePrevRelViewProj(
          injectF32, 64,
          view.eye, prevEye, prevRight, prevUp, prevForward,
          prevTanHalf, prevAspect, prevNearDist, prevMaxDist,
        )
      } else {
        injectF32.fill(0, 64, 80)
      }

      if (shadowModeNum > 0 && params.sunShadowProj) {
        for (let i = 0; i < 16; i++) injectF32[80 + i] = params.sunShadowProj[i] ?? 0
      } else {
        injectF32.fill(0, 80, 96)
      }
      device.queue.writeBuffer(injectUniforms, 0, injectBuf)

      // Keep sampling uniform block in sync for `FROXEL_FOG_WGSL` consumers.
      samplingF32[0] = nearDist
      samplingF32[1] = maxDist
      samplingF32[2] = slices
      samplingF32[3] = invLogRatio
      samplingF32[4] = 1
      samplingF32[5] = NEAR
      samplingF32[6] = FAR
      samplingF32[7] = 1
      device.queue.writeBuffer(samplingUniforms, 0, samplingBuf)

      const writeIdx = ping
      const injectPass = encoder.beginComputePass({
        label: 'froxel-inject',
        ...(params.injectTimestampWrites ? { timestampWrites: params.injectTimestampWrites } : {}),
      })
      injectPass.setPipeline(injectPipeline)
      injectPass.setBindGroup(0, injectBinds[writeIdx])
      injectPass.dispatchWorkgroups(wgX, wgY, slices)
      injectPass.end()

      const integratePass = encoder.beginComputePass({
        label: 'froxel-integrate',
        ...(params.integrateTimestampWrites ? { timestampWrites: params.integrateTimestampWrites } : {}),
      })
      integratePass.setPipeline(integratePipeline)
      integratePass.setBindGroup(0, integrateBinds[writeIdx])
      integratePass.dispatchWorkgroups(wgX, wgY, 1)
      integratePass.end()

      updateDepth = depthView(params.depthTex)
      if (updateDepth) detectEdges(encoder, updateDepth, dummyFarDepthView, fullViewport)
      // Save camera state for next frame's reprojection.
      prevEye[0] = ex; prevEye[1] = ey; prevEye[2] = ez
      prevRight[0] = view.right[0]; prevRight[1] = view.right[1]; prevRight[2] = view.right[2]
      prevUp[0] = view.up[0]; prevUp[1] = view.up[1]; prevUp[2] = view.up[2]
      prevForward[0] = view.forward[0]; prevForward[1] = view.forward[1]; prevForward[2] = view.forward[2]
      prevTanHalf = view.tanHalf
      prevAspect = aspect
      prevNearDist = nearDist
      prevMaxDist = maxDist
      historyValid = true
      ping = 1 - writeIdx
      frame++

      return integratedView
    },

    apply(encoder, params) {
      if (destroyed) throw new Error('froxel-fog: cannot apply after destroy()')
      const depth = depthView(params.depthTex) ?? ('depth' in params ? params.depth : updateDepth)
      if (!depth) return
      const near = params.near ?? NEAR
      const far = params.far ?? FAR
      const strength = params.strength ?? 1
      if (near !== samplingF32[5] || far !== samplingF32[6] || strength !== samplingF32[7]) {
        samplingF32[5] = near
        samplingF32[6] = far
        samplingF32[7] = strength
        device.queue.writeBuffer(samplingUniforms, 0, samplingBuf)
      }
      const vw = params.viewportSize ? Math.max(1, params.viewportSize[0]) : 0
      const vh = params.viewportSize ? Math.max(1, params.viewportSize[1]) : 0
      const hasFar = params.farDepth ? 1 : 0
      const skyWeight = Math.max(0, Math.min(1, params.skyWeight ?? 1))
      if (vw !== compViewF32[0] || vh !== compViewF32[1] || hasFar !== compViewF32[2] || skyWeight !== compViewF32[3]) {
        compViewF32[0] = vw
        compViewF32[1] = vh
        compViewF32[2] = hasFar
        compViewF32[3] = skyWeight
        device.queue.writeBuffer(compViewUniforms, 0, compViewF32)
      }
      const farView = params.farDepth ?? dummyFarDepthView
      detectEdges(encoder, depth, farView)
      if (cachedDepthView !== depth || cachedFarDepthView !== farView || !cachedCompositeBind) {
        cachedDepthView = depth
        cachedFarDepthView = farView
        cachedCompositeBind = device.createBindGroup({
          label: 'froxel-composite-bg',
          layout: compositeLayout,
          entries: [
            { binding: 0, resource: integratedView },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: samplingUniforms } },
            { binding: 3, resource: depth },
            { binding: 4, resource: farView },
            { binding: 5, resource: { buffer: compViewUniforms } },
            { binding: 6, resource: { buffer: edgeMask } },
          ],
        })
      }
      const pipe = getCompositePipeline(params.format)
      const renderPass = encoder.beginRenderPass({
        label: 'froxel-composite',
        colorAttachments: [{ view: params.target, loadOp: 'load', storeOp: 'store' }],
        ...(params.timestampWrites ? { timestampWrites: params.timestampWrites } : {}),
      })
      if (vw > 0 && vh > 0) {
        renderPass.setViewport?.(0, 0, vw, vh, 0, 1)
        renderPass.setScissorRect?.(0, 0, vw, vh)
      }
      renderPass.setPipeline(pipe)
      renderPass.setBindGroup(0, cachedCompositeBind)
      renderPass.draw(3)
      renderPass.end()
    },

    reset() {
      historyValid = false
    },

    stats() {
      return {
        dims: resolvedDims,
        froxels,
        frame,
        activeLights,
        nearDist: curNearDist,
        maxDist: curMaxDist,
        historyValid,
        vramBytes,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      scatterTex0.destroy()
      scatterTex1.destroy()
      integratedTexture.destroy()
      dummyShadowTex.destroy()
      dummyFarDepthTex.destroy()
      injectUniforms.destroy()
      lightsBuffer.destroy()
      samplingUniforms.destroy()
      compViewUniforms.destroy()
      fullViewport.destroy()
      edgeMask.destroy()
      compositePipelines.clear()
      cachedCompositeBind = null
      cachedDepthView = null
      cachedFarDepthView = null
    },
  }

  return self
}
