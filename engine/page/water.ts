// Water that flows (#140, #165), as the core tells it (water.rs): how high its top stands over each
// column of a window of the world. Drawn in two passes using a persistent front-most water depth
// buffer (`waterDepth`) while reading opaque scene depth (`to.depth`) for smoothed Beer-Lambert
// depth absorption, clean shoreline/obstacle/plunge foam, dual-layer normal ripples, Schlick
// Fresnel (F0 = 0.02), crisp GGX sun specular glints, and sky/horizon reflection in linear HDR.
import { DEPTH, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { AIR, GLOBALS, MAX_LEVELS, SUNLIT, type Marcher, type View } from './march.ts'
import { LIGHTS_BYTES, LOCAL_LIGHTS_STRUCT, localLightsEval } from './lights.ts'

const GLOBALS_BYTES = 144 + MAX_LEVELS * 128 + 192 + 512 + 16

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, day: f32,
  sun: vec3f, col: f32,
  // Where the window's low corner is from the anchor the eye is measured from (its height is the base the tops are over).
  origin: vec3f, resX: f32,
  // The box round the wet columns: its low corner, how many across.
  box: vec4u,
  sky: vec3f, resY: f32,
  hasWorld: u32, pad0: u32, pad1: u32, pad2: u32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var heights: texture_2d<u32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
${GLOBALS}
${LOCAL_LIGHTS_STRUCT}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
@group(1) @binding(2) var<uniform> localLights: LocalLights;
${SUNLIT}
${AIR}
${localLightsEval()}

struct Out {
  @invariant @builtin(position) pos: vec4f,
  @location(0) seen: vec3f,
  @location(1) plan: vec2f,
  // x: smooth heightfield column depth h (cells), y: flow speed, z: boundary edge (0 outer, 1 interior), w: radial wet coverage (0..1).
  @location(2) more: vec4f,
  // x: surface height over base, y: plunge-pool proximity (0..1), z: height above nearby pool floor (cells).
  @location(3) fallInfo: vec3f,
}
const NEAR = ${NEAR.toFixed(1)};
const FAR = ${FAR.toFixed(1)};
fn word(c: vec2i) -> u32 {
  let size = vec2i(textureDimensions(heights));
  if (any(c < vec2i(0)) || any(c >= size)) { return 0u; }
  return textureLoad(heights, c, 0).r;
}
fn linearDepth(d: f32) -> f32 {
  return select(FAR, NEAR / max(1.0 - d * ((FAR - NEAR) / FAR), 1e-6), d < 1.0);
}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let column = vec2i(i32(u.box.x + i % u.box.z), i32(u.box.y + i / u.box.z));
  let corner = vec2i(i32(v & 1u), i32((v >> 1u) & 1u));
  var out: Out;
  if ((word(column) >> 18u) == 0u) {
    // A dry column: nothing of it is drawn.
    out.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  // The corner's height, depth and speed: the mean of the wet columns round it.
  let vtx = column + corner;
  var top = 0.0; var deep = 0.0; var fast = 0.0; var n = 0.0; var dry = 0.0;
  for (var k = 0; k < 4; k++) {
    let w = word(vtx - vec2i(k & 1, k >> 1u));
    if ((w >> 18u) == 0u) { dry += 1.0; continue; }
    top += f32(w & 0x3ffffu) / 8.0;
    deep += f32((w >> 18u) & 255u) / 16.0;
    fast += f32(w >> 26u) * 2.0;
    n += 1.0;
  }
  top /= n;
  // At outer boundary vertices (dry >= 2) both edge and column depth h reach 0 cleanly.
  let edge = clamp((2.0 - dry) * 0.5, 0.0, 1.0);
  deep = (deep / n) * edge;

  // Radial column neighborhood around the corner vertex:
  // - wetCov blurs out grid-aligned shoreline stair-steps into smooth organic contours;
  // - minFallDist / minLocalTop detect where falling waterfall sheets plunge into the pool.
  var wetSum = 0.0;
  var wtSum = 0.0;
  var minFallDist = 6.5;
  var minLocalTop = top;
  for (var oz = -6; oz <= 5; oz++) {
    for (var ox = -6; ox <= 5; ox++) {
      let dist = length(vec2f(f32(ox) + 0.5, f32(oz) + 0.5));
      if (dist > 6.2) { continue; }
      let nw = word(vtx + vec2i(ox, oz));
      let isWet = (nw >> 18u) != 0u;
      if (dist <= 3.5) {
        let wt = 1.0 - dist / 3.5;
        wtSum += wt;
        if (isWet) { wetSum += wt; }
      }
      if (isWet) {
        let nt = f32(nw & 0x3ffffu) / 8.0;
        if (nt > top + 14.0) {
          minFallDist = min(minFallDist, dist);
        }
        if (dist <= 2.8) {
          minLocalTop = min(minLocalTop, nt);
        }
      }
    }
  }
  let wetCov = wetSum / max(wtSum, 1e-4);
  let plunge = smoothstep(6.0, 0.9, minFallDist);
  let heightAbovePool = max(top - minLocalTop, 0.0);

  let at = vec2f(vtx) * u.col;
  // Drawn a little over where it is: thin water an inch over a road would fight the road for each pixel.
  let world = u.origin + vec3f(at.x, top + 0.25, at.y) - u.eye;
  let d = dot(world, u.forward);
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.seen = world;
  out.plan = at;
  out.more = vec4f(deep, fast / n, edge, wetCov);
  out.fallInfo = vec3f(top, plunge, heightAbovePool);
  return out;
}
fn lump(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise1(p: vec2f) -> f32 {
  let c = vec2i(floor(p));
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(mix(lump(c), lump(c + vec2i(1, 0)), e.x), mix(lump(c + vec2i(0, 1)), lump(c + vec2i(1, 1)), e.x), e.y);
}
// Smooth, coherent, Nyquist-filtered liquid wave heightfield (broad directional swells + cross waves + gentle wavelets).
fn waveHeight(p: vec2f, run: f32, midFade: f32, detailFade: f32) -> f32 {
  let a = noise1(p * 0.34 + vec2f(run * 0.72, run * 0.44));
  let rot = vec2f(p.x * 0.80 - p.y * 0.60, p.x * 0.60 + p.y * 0.80);
  let b = noise1(rot * 0.62 + vec2f(-run * 0.92, run * 0.70) + vec2f(a * 0.36, -a * 0.28));
  let rot2 = vec2f(p.x * 0.42 + p.y * 0.91, -p.x * 0.91 + p.y * 0.42);
  let c = noise1(rot2 * 0.92 - vec2f(run * 1.10, -run * 0.84));
  return a * 0.68 + b * 0.42 * midFade + c * 0.22 * detailFade;
}
// Multi-scale cellular/FBM lacy foam field animated with surface flow and footprint-filtered fine detail.
fn foamField(p: vec2f, run: f32, detailFade: f32) -> f32 {
  let n1 = noise1(p * 0.78 - vec2f(run * 1.35, run * 0.92));
  let warp = vec2f(n1 - 0.5, noise1(p.yx * 0.88 + vec2f(run * 1.05, -run * 0.78)) - 0.5);
  let n2 = noise1(p * 1.75 + warp * 1.15 + vec2f(run * 1.15, -run * 0.68));
  let n3 = mix(0.5, noise1(p * 3.10 - warp * 0.95 + vec2f(-run * 1.65, run * 1.20)), detailFade);
  return n1 * 0.44 + n2 * 0.38 + n3 * 0.18;
}
fn ggxLobe(NdotH: f32, NdotV: f32, NdotL: f32, VdotH: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  let D = a2 / max(3.14159265 * denom * denom, 1e-6);
  let k = (rough + 1.0) * (rough + 1.0) * 0.125;
  let G = (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));
  let F = 0.02 + 0.98 * pow(1.0 - VdotH, 5.0);
  return (D * G * F) / max(4.0 * NdotV * NdotL, 1e-4) * NdotL;
}

// Pass 1 (depth-only pre-pass): discards water fragments occluded by opaque world geometry (to.depth)
// via direct raw-Z comparison and writes the front-most visible water surface depth into waterDepth
// so water-vs-water self-overlap (waterfall sheets vs pool surface) is resolved cleanly before shading.
@fragment fn fsDepth(in: Out) {
  let maxCoord = vec2i(max(i32(u.resX) - 1, 0), max(i32(u.resY) - 1, 0));
  let px = clamp(vec2i(in.pos.xy), vec2i(0), maxCoord);
  let sceneD = textureLoad(depthTex, px, 0);
  if (in.pos.z >= sceneD) { discard; }
}

// Pass 2 (front-most water shade pass): @invariant position + depthCompare == 'less-equal' against
// waterDepth guarantees each pixel shades only the single front-most water surface with zero zipper
// holes while reading to.depth for smoothed Beer-Lambert depth absorption.
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let maxCoord = vec2i(max(i32(u.resX) - 1, 0), max(i32(u.resY) - 1, 0));
  let px = clamp(vec2i(in.pos.xy), vec2i(0), maxCoord);
  let sceneD = textureLoad(depthTex, px, 0);
  if (in.pos.z >= sceneD) { discard; }
  let sceneLinearZ = linearDepth(sceneD);
  let waterLinearZ = dot(in.seen, u.forward);

  let h = in.more.x;
  let fast = in.more.y;
  let edge = in.more.z;
  let wetCov = in.more.w;
  let surfHigh = in.fallInfo.x;
  let plunge = in.fallInfo.y;
  let heightAbovePool = in.fallInfo.z;

  let dist = length(in.seen);
  let rd = in.seen / max(dist, 1e-4);
  let look = -rd;
  let cosEye = max(dot(rd, u.forward), 0.12);
  let absRdY = abs(rd.y);

  // 5-tap cross filter on scene depth (rejecting discontinuities > 2 cells) plus vertical-obstacle
  // contact detection (tower legs, walls, floating debris piercing or rising sharply at the waterline).
  var zSum = sceneLinearZ;
  var zWeight = 1.0;
  var obsHit = 0.0;
  let cross1 = array<vec2i, 4>(vec2i(3, 0), vec2i(-3, 0), vec2i(0, 3), vec2i(0, -3));
  for (var k = 0; k < 4; k++) {
    let np = clamp(px + cross1[k], vec2i(0), maxCoord);
    let nz = linearDepth(textureLoad(depthTex, np, 0));
    if (nz > waterLinearZ && abs(nz - sceneLinearZ) <= 2.0) {
      zSum += nz;
      zWeight += 1.0;
    }
    // Obstacle piercing the water surface nearby (depth-bounded so foreground silhouettes never halo distant water).
    if (nz <= waterLinearZ + 0.08 && (waterLinearZ - nz) < 4.0) {
      obsHit += 0.36;
    } else if ((sceneLinearZ - nz) * absRdY > 1.8 && (nz - waterLinearZ) * absRdY < 0.65) {
      obsHit += 0.22;
    }
  }
  let cross2 = array<vec2i, 4>(vec2i(6, 0), vec2i(-6, 0), vec2i(0, 6), vec2i(0, -6));
  for (var k = 0; k < 4; k++) {
    let np = clamp(px + cross2[k], vec2i(0), maxCoord);
    let nz = linearDepth(textureLoad(depthTex, np, 0));
    if (nz <= waterLinearZ + 0.08 && (waterLinearZ - nz) < 4.0) {
      obsHit += 0.16;
    }
  }
  let filteredLinearZ = zSum / zWeight;
  // Combine filtered scene vertical depth (minus the 0.25-cell mesh lift) with the heightfield's
  // smooth interpolated column depth h so 10 cm sloping street steps never cause interior depth bands.
  let sceneRayDepth = max(filteredLinearZ - waterLinearZ, 0.0) / cosEye;
  let sceneVert = max(sceneRayDepth * absRdY - 0.25, 0.0);
  let smoothVert = mix(h, clamp(sceneVert, max(h - 0.4, 0.0), h + 3.5), 0.16);
  let waterDepth = smoothVert / max(absRdY, 0.36);

  // Geometric surface normal from screen derivatives, perturbed by smooth Nyquist-filtered liquid waves.
  var geomN = normalize(cross(dpdx(in.seen), dpdy(in.seen)));
  if (geomN.y < 0.0) { geomN = -geomN; }
  let steep = 1.0 - geomN.y;
  let fall = clamp(steep * 2.4 - 0.3, 0.0, 1.0);
  let run = u.time * (1.1 + fast * 0.16);
  let fw = max(length(fwidth(in.plan)), 1e-4);
  let detailFade = 1.0 - smoothstep(0.18, 0.75, fw);
  let midFade = 1.0 - smoothstep(0.35, 1.15, fw);
  let swellFade = 1.0 - smoothstep(0.75, 2.40, fw);
  let eps = clamp(0.28 + fw * 0.32, 0.28, 0.85);
  let h0 = waveHeight(in.plan, run, midFade, detailFade);
  let hx = waveHeight(in.plan + vec2f(eps, 0.0), run, midFade, detailFade);
  let hz = waveHeight(in.plan + vec2f(0.0, eps), run, midFade, detailFade);
  let rippleAmp = mix(0.36, 0.46, clamp(fast * 0.08 + plunge * 0.40, 0.0, 1.0)) * (0.40 + 0.60 * swellFade);
  let waveGrad = vec3f((h0 - hx) / eps, 0.0, (h0 - hz) / eps);
  let n = normalize(geomN + waveGrad * rippleAmp);

  let NdotV = max(dot(n, look), 0.001);
  // Schlick Fresnel with physical water F0 = 0.02.
  let fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  // World lighting: sun radiance, sky fill, sky/horizon reflection, directional shadow reception, and local lights.
  let worldP = in.seen + u.eye;
  var worldSun = 1.0;
  var sunCol = vec3f(1.0, 0.94, 0.82) * mix(0.05, 1.45, u.day);
  var skyFill = u.sky * mix(0.05, 1.0, u.day);
  let reflDir = reflect(rd, n);
  var envRefl = mix(u.sky * 0.72, u.sky * 1.15, pow(clamp(reflDir.y, 0.0, 1.0), 0.55)) * mix(0.05, 1.0, u.day);
  if (u.hasWorld != 0u && g.levels > 0u) {
    let sunny = sunlit(worldP, geomN, 0u);
    if (sunny >= 0.0) { worldSun = sunny; }
    sunCol = g.lightSun.rgb * 2.6;
    skyFill = g.lightFill.rgb * 1.45;
    let skyDir = vec3f(reflDir.x, max(reflDir.y, 0.015), reflDir.z);
    let skySample = skyBase(skyDir);
    let horizonBand = g.skyHorizon.rgb * 0.65;
    // Open sky still reflects brightly on shaded water; sunlight adds a subtle boost.
    envRefl = mix(horizonBand * 0.48, skySample * 1.18, smoothstep(-0.10, 0.18, reflDir.y)) * mix(0.95, 1.10, worldSun);
  }

  // Beer-Lambert exponential depth absorption: shallow rims stay crystal clear, deeper pools shift to rich teal-blue.
  let absorb = exp(-waterDepth * vec3f(0.28, 0.11, 0.060));
  let bgKeep = dot(absorb, vec3f(0.299, 0.587, 0.114));
  let bodyAlpha = clamp(1.0 - bgKeep, 0.0, 0.92);
  let NdotL = max(dot(n, u.sun), 0.001);
  let waterLight = skyFill * 1.45 + vec3f(0.16, 0.20, 0.23) * mix(0.04, 1.0, u.day) + sunCol * (NdotL * worldSun * 0.42 + 0.08 * worldSun);
  let shallowCol = vec3f(0.036, 0.30, 0.36);
  let deepCol = vec3f(0.008, 0.105, 0.195);
  let bodyTint = mix(deepCol, shallowCol, absorb);
  let waterBody = bodyTint * waterLight;

  // Smooth, footprint-filtered dual-lobe GGX sun specular highlights on coherent liquid waves.
  let H = normalize(u.sun + look);
  let NdotH = max(dot(n, H), 0.0);
  let VdotH = max(dot(look, H), 0.0);
  let roughTightBase = mix(0.11, 0.15, clamp(fast * 0.06, 0.0, 1.0));
  let roughSheenBase = mix(0.22, 0.30, clamp(fast * 0.08, 0.0, 1.0));
  let roughTight = min(sqrt(roughTightBase * roughTightBase + fw * 0.12), 0.50);
  let roughSheen = min(sqrt(roughSheenBase * roughSheenBase + fw * 0.12), 0.62);
  let ggxTight = min(ggxLobe(NdotH, NdotV, NdotL, VdotH, roughTight), 6.0);
  let ggxSheen = min(ggxLobe(NdotH, NdotV, NdotL, VdotH, roughSheen), 2.5);
  var specCol = sunCol * ((ggxTight * 1.75 + ggxSheen * 1.25) * worldSun);

  if (u.hasWorld != 0u && localLights.info.x > 0u) {
    specCol += evalLocalLights(worldP, n, rd, bodyTint * 0.8, 0.14, 0.0, 0.0);
  }

  // Premultiplied liquid layer: energy-conserving refracted body + Fresnel sky reflection + GGX sun highlight.
  var premulRgb = waterBody * (bodyAlpha * (1.0 - fresnel)) + envRefl * fresnel + specCol;
  var outAlpha = clamp(1.0 - bgKeep * (1.0 - fresnel), 0.0, 0.96);

  // Clean shoreline fade, vertical obstacle collars, and turbulent plunge-pool splash foam.
  let foamTex = foamField(in.plan, run, detailFade);
  let shoreMask = wetCov + (foamTex - 0.5) * 0.24;
  // Outer rim ramps smoothly to 0.0 at h -> 0 and outer wet boundary BEFORE the shoreline foam ring peaks.
  let shoreAlpha = smoothstep(0.40, 0.80, shoreMask) * smoothstep(0.0, 0.24, edge) * smoothstep(0.0, 0.14, h);
  let shoreInner = smoothstep(0.58, 0.75, shoreMask);
  let shoreOuter = 1.0 - smoothstep(0.76, 0.90, shoreMask);
  let shoreBand = shoreInner * shoreOuter * smoothstep(0.90, 0.16, h) * smoothstep(0.10, 0.30, h) * (1.0 - fall);
  let shoreFoam = shoreBand * smoothstep(0.56, 0.84, foamTex) * 0.38;

  // Vertical obstacle contact foam (tower legs, walls, floating debris) only in real standing pool water.
  let obsBand = clamp(obsHit, 0.0, 1.0) * smoothstep(0.60, 0.86, wetCov) * smoothstep(0.28, 0.65, h) * (1.0 - fall);
  let obsFoam = obsBand * smoothstep(0.40, 0.76, foamTex + obsBand * 0.28) * 0.82;

  // Irregular frothy plunge-pool splash breakup where vertical falling waterfall sheets meet the horizontal pool.
  let splashLobe = noise1(in.plan * 0.36 - vec2f(run * 0.72, run * 0.52)) * 0.62 + noise1(in.plan * 0.80 + vec2f(run * 1.10, -run * 0.82)) * 0.38;
  let plungeTex = foamField(in.plan * 1.28, run * 1.50, detailFade);
  let plungeWarp = clamp(plunge * 1.15 + (splashLobe - 0.45) * 0.88 * smoothstep(0.02, 0.38, plunge), 0.0, 1.0);
  let plungePoolFoam = (1.0 - fall) * smoothstep(0.16, 0.68, plungeWarp) * smoothstep(0.16, 0.64, plungeTex + plungeWarp * 0.56);
  let churn = clamp((fast - 4.4) / 7.5, 0.0, 1.0) * (1.0 - fall);
  let churnFoam = churn * smoothstep(0.62 - 0.26 * churn, 0.86, foamTex) * 0.52;

  let foam = clamp(max(max(shoreFoam, obsFoam), max(plungePoolFoam, churnFoam)), 0.0, 1.0);
  let foamLight = skyFill * 1.15 + vec3f(0.18, 0.20, 0.22) * mix(0.04, 1.0, u.day) + sunCol * (0.14 + 0.52 * NdotL) * worldSun;
  let foamCol = vec3f(0.90, 0.96, 1.02) * foamLight;
  let foamAlpha = clamp(foam * 0.82 + plungePoolFoam * 0.14, 0.0, 0.95);
  premulRgb = foamCol * foamAlpha + premulRgb * (1.0 - foamAlpha);
  outAlpha = foamAlpha + outAlpha * (1.0 - foamAlpha);

  // Waterfall sheet: steep drops break into aerated whitewater streaks with irregular frothy plunge-base breakup.
  if (fall > 0.001) {
    let streak = noise1(vec2f((in.plan.x + in.plan.y) * 1.1, surfHigh * 0.16 + u.time * 9.0)) * 0.6 + noise1(vec2f((in.plan.x - in.plan.y) * 2.4, surfHigh * 0.42 + u.time * 14.0)) * 0.4;
    let splashReach = 6.0 + splashLobe * 22.0;
    let baseSplash = smoothstep(splashReach, 0.0, heightAbovePool) * smoothstep(0.18, 0.66, plungeTex + smoothstep(7.0, 0.0, heightAbovePool) * 0.52);
    let white = clamp(smoothstep(0.28, 0.68, streak) + baseSplash * 0.78, 0.0, 1.0);
    let fallCol = mix(vec3f(0.12, 0.42, 0.52), vec3f(0.92, 0.98, 1.04), white) * foamLight;
    let fallAlpha = clamp(0.32 + 0.62 * white + baseSplash * 0.16, 0.0, 0.96);
    premulRgb = mix(premulRgb, fallCol * fallAlpha, fall);
    outAlpha = mix(outAlpha, fallAlpha, fall);
  }

  let finalMask = mix(shoreAlpha, 1.0, fall);
  premulRgb *= finalMask;
  outAlpha *= finalMask;
  return vec4f(max(premulRgb, vec3f(0.0)), clamp(outAlpha, 0.0, 1.0));
}
`

export interface Flowing {
  /** What the core told of the water (the words of a FLOW record). */
  set(words: Uint32Array<ArrayBuffer>): void
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number): void
  /** Where the light comes from, how much of the day it is, and the colour of the sky it mirrors (as the screen shows it). */
  light(sun: readonly number[], day: number): void
  /** How many columns the last word of it covered: for the checks. */
  readonly columns: number
  /** Places where it lands after a fall (the world's finest cells), a few of them: mist rises there. */
  readonly landings: readonly [number, number, number][]
}

export async function flowing(device: GPUDevice, format: GPUTextureFormat, march?: Marcher): Promise<Flowing> {
  const module = await shader(device, 'water', CODE)
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const ownLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: both, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'uint' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const worldLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const depthLayout = device.createPipelineLayout({ bindGroupLayouts: [ownLayout] })
  const shadeLayout = device.createPipelineLayout({ bindGroupLayouts: [ownLayout, worldLayout] })
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const [depthPipeline, shadePipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'water-depth-prepass', layout: depthLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fsDepth', targets: [] },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
    }),
    device.createRenderPipelineAsync({
      label: 'water-shade', layout: shadeLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less-equal' },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
    }),
  ])
  const uniforms = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const dummyGlobals = device.createBuffer({ size: GLOBALS_BYTES, usage: GPUBufferUsage.UNIFORM })
  const dummySun = device.createTexture({ size: [1, 1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING })
  const dummyLights = device.createBuffer({ size: LIGHTS_BYTES, usage: GPUBufferUsage.UNIFORM })
  const fallbackWorldBind = device.createBindGroup({
    layout: worldLayout,
    entries: [
      { binding: 0, resource: { buffer: dummyGlobals } },
      { binding: 1, resource: dummySun.createView({ dimension: '2d-array' }) },
      { binding: 2, resource: { buffer: dummyLights } },
    ],
  })
  let texture: GPUTexture | null = null, heightsView: GPUTextureView | null = null
  let waterDepthTex: GPUTexture | null = null, waterDepthView: GPUTextureView | null = null
  let waterDepthSize: readonly [number, number] = [0, 0]
  const waterDepthFor = (to: Target) => {
    const alloc = to.allocSize ?? to.size
    if (!waterDepthTex || waterDepthSize[0] !== alloc[0] || waterDepthSize[1] !== alloc[1]) {
      waterDepthTex?.destroy()
      waterDepthTex = device.createTexture({
        label: 'water-depth',
        size: [alloc[0], alloc[1]],
        format: DEPTH,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      })
      waterDepthView = waterDepthTex.createView()
      waterDepthSize = [alloc[0], alloc[1]]
    }
    return waterDepthView!
  }
  let ownBind: { heights: GPUTextureView; depth: GPUTextureView; group: GPUBindGroup } | null = null
  const ownFor = (depth: GPUTextureView) => {
    if (!heightsView) return null
    if (ownBind?.heights !== heightsView || ownBind?.depth !== depth) {
      ownBind = {
        heights: heightsView,
        depth,
        group: device.createBindGroup({
          layout: ownLayout,
          entries: [
            { binding: 0, resource: { buffer: uniforms } },
            { binding: 1, resource: heightsView },
            { binding: 2, resource: depth },
          ],
        }),
      }
    }
    return ownBind.group
  }
  let worldBind: { march: Marcher; group: GPUBindGroup } | null = null
  const worldFor = () => {
    const active = march ?? (globalThis as { engine?: { march?: Marcher } }).engine?.march
    if (!active) return { group: fallbackWorldBind, hasWorld: 0 }
    if (worldBind?.march !== active) {
      worldBind = {
        march: active,
        group: device.createBindGroup({
          layout: worldLayout,
          entries: [
            { binding: 0, resource: { buffer: active.globals } },
            { binding: 1, resource: active.sun.all },
            { binding: 2, resource: { buffer: active.localLights.buffer } },
          ],
        }),
      }
    }
    return { group: worldBind.group, hasWorld: 1 }
  }
  let cells = new Uint32Array(0), side = 0
  // The window as last told: its low corner in the world, the base its tops are over, a column's width, the box of wet ones.
  let low = [0, 0], base = 0, col = 2, box = [0, 0, 0, 0], wet = 0
  let landings: [number, number, number][] = []
  let sun: readonly number[] = [0.52, 0.62, 0.59], day = 1
  const block = new ArrayBuffer(144), f = new Float32Array(block), u = new Uint32Array(block)
  return {
    get columns() { return wet },
    get landings() { return landings },
    light(from, isDay) { sun = from; day = isDay },
    set(words) {
      const i32 = new Int32Array(words.buffer, words.byteOffset, words.length), n = words[3]
      if (n !== side) {
        texture?.destroy()
        side = n
        cells = new Uint32Array(n * n)
        texture = device.createTexture({ size: [n, n], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
        heightsView = texture.createView()
        ownBind = null
      }
      // What was wet is dry unless told again.
      for (let z = box[1]; z < box[1] + box[3]; z++) cells.fill(0, box[0] + side * z, box[0] + box[2] + side * z)
      low = [i32[0], i32[1]]; col = words[2]; base = i32[4]
      box = [words[5], words[6], words[7], words[8]]
      wet = 0
      for (let z = 0; z < box[3]; z++) {
        const row = words.subarray(9 + z * box[2], 9 + (z + 1) * box[2])
        cells.set(row, box[0] + side * (box[1] + z))
        for (const w of row) if (w) wet++
      }
      device.queue.writeTexture({ texture: texture! }, cells, { bytesPerRow: side * 4 }, [side, side])
      // Where it lands: a wet column three metres or more under a wet one beside it. Every seventh, two dozen at most.
      landings = []
      for (let z = box[1] + 1, k = 0; z < box[1] + box[3] - 1 && landings.length < 40; z++) for (let x = box[0] + 1; x < box[0] + box[2] - 1; x++) {
        const w = cells[x + side * z]
        if (!w) continue
        const top = (w & 0x3ffff) / 8, over = Math.max(...[cells[x + 1 + side * z], cells[x - 1 + side * z], cells[x + side * (z + 1)], cells[x + side * (z - 1)]].map((n) => (n ? (n & 0x3ffff) / 8 : 0)))
        if (over - top > 30 && k++ % 7 === 0 && landings.length < 24) landings.push([low[0] + x * col, base + top, low[1] + z * col])
      }
    },
    draw(encoder, to, view, time) {
      if (!wet) return
      const oGroup = ownFor(to.depth)
      if (!oGroup) return
      const wDepth = waterDepthFor(to)
      const { group: wGroup, hasWorld } = worldFor()
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const sunLength = Math.hypot(sun[0], sun[1], sun[2])
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf], 0)
      f.set([view.right[0], view.right[1], view.right[2], to.size[0] / to.size[1]], 4)
      f.set([view.up[0], view.up[1], view.up[2], time], 8)
      f.set([view.forward[0], view.forward[1], view.forward[2], day], 12)
      f.set([sun[0] / sunLength, sun[1] / sunLength, sun[2] / sunLength, col], 16)
      f.set([low[0] - anchor[0], base - anchor[1], low[1] - anchor[2], to.size[0]], 20)
      u.set(box, 24)
      // Fallback sky colour (linear HDR by day) when no Marcher is bound.
      f.set([0.38, 0.56, 0.82, to.size[1]], 28)
      u[32] = hasWorld; u[33] = 0; u[34] = 0; u[35] = 0
      device.queue.writeBuffer(uniforms, 0, block)
      const count = box[2] * box[3]
      // Pass 1: depth-only pre-pass into persistent `waterDepth` while testing against `to.depth`.
      const prepass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: wDepth,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      })
      prepass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      prepass.setScissorRect(0, 0, to.size[0], to.size[1])
      prepass.setPipeline(depthPipeline)
      prepass.setBindGroup(0, oGroup)
      prepass.draw(4, count)
      prepass.end()
      // Pass 2: shade only the single front-most water surface per pixel (depthCompare: 'less-equal'),
      // keeping `to.depth` bound as texture_depth_2d for smoothed Beer-Lambert depth absorption.
      const shadePass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: wDepth,
          depthLoadOp: 'load',
          depthStoreOp: 'discard',
        },
      })
      shadePass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      shadePass.setScissorRect(0, 0, to.size[0], to.size[1])
      shadePass.setPipeline(shadePipeline)
      shadePass.setBindGroup(0, oGroup)
      shadePass.setBindGroup(1, wGroup)
      shadePass.draw(4, count)
      shadePass.end()
    },
  }
}
