// Physically Based Sky & Atmosphere Compute LUTs (#165).
//
// Standalone, zero-GC WebGPU implementation of Sebastien Hillaire (EGSR 2020),
// "A Scalable and Production Ready Sky and Atmosphere Rendering Technique":
//   1. Transmittance LUT (256 x 64, rgba16float) — optical depth to top of atmosphere
//   2. Multi-Scattering LUT (32 x 32, rgba16float) — isotropic infinite-bounce Psi_ms
//   3. Sky-View LUT (192 x 108, rgba16float) — horizon-concentrated non-linear latitude
//   4. Aerial Perspective Volume LUT (32 x 32 x 32, rgba16float) — frustum in-scattering + transmittance
//   5. Sky IBL Irradiance Probe (9 x vec4f storage buffer) — L2 Spherical Harmonics from Sky-View LUT
//
// Coordinate convention matches engine/page (almanac.ts, march.ts, fog.ts): Y-up world space.
// Dirty-tracked across 3 tiers so steady-state per-frame GPU cost is near 0 ms.
import { shader } from '../probe/gpu.ts'

export type Vec3 = readonly [number, number, number]

export interface AtmosphereParams {
  /** Planet radius, km (Earth default: 6360). */
  readonly planetRadiusKm: number
  /** Outer atmosphere radius, km (Earth default: 6460, i.e. 100 km thick). */
  readonly atmosphereRadiusKm: number
  /** Sea-level Rayleigh scattering coefficients RGB, 1/km. */
  readonly rayleighScattering: Vec3
  /** Rayleigh exponential scale height, km (Earth default: 8.0). */
  readonly rayleighScaleHeightKm: number
  /** Sea-level Mie scattering coefficient, 1/km (before `haze` multiplier). */
  readonly mieScattering: number
  /** Sea-level Mie extinction coefficient, 1/km (before `haze` multiplier). */
  readonly mieExtinction: number
  /** Mie exponential scale height, km (Earth default: 1.2). */
  readonly mieScaleHeightKm: number
  /** Henyey-Greenstein anisotropy factor g in (-1, 1) (default: 0.8). */
  readonly miePhaseG: number
  /** Peak Ozone (Chappuis band) absorption coefficients RGB, 1/km. */
  readonly ozoneAbsorption: Vec3
  /** Altitude of peak Ozone density, km (Earth default: 25.0). */
  readonly ozoneCenterKm: number
  /** Half-width of triangular Ozone density layer, km (Earth default: 15.0). */
  readonly ozoneHalfWidthKm: number
  /** Weather Mie density multiplier (1.0 = standard clear Earth; >1.0 = SF marine haze). */
  readonly haze: number
  /** Unit direction toward the sun in Y-up world space. */
  readonly sunDir: Vec3
  /** Top-of-atmosphere solar illuminance RGB (linear HDR scale). */
  readonly sunIlluminance: Vec3
  /** Average Lambertian ground albedo RGB for multi-scattering bounce. */
  readonly groundAlbedo: Vec3
  /** Camera altitude above sea level, km (supports 0.001 km street level up to SPACE altitude). */
  readonly cameraAltitudeKm: number
  /** Frustum forward direction (Y-up) for the Aerial Perspective 3D LUT. */
  readonly cameraForward: Vec3
  /** Frustum right direction (Y-up) for the Aerial Perspective 3D LUT. */
  readonly cameraRight: Vec3
  /** Frustum up direction (Y-up) for the Aerial Perspective 3D LUT. */
  readonly cameraUp: Vec3
  /** Tangent of half vertical FOV for the Aerial Perspective 3D LUT. */
  readonly cameraTanHalfFovY: number
  /** Viewport aspect ratio (width / height) for the Aerial Perspective 3D LUT. */
  readonly cameraAspect: number
  /** Far reach of the 32-slice Aerial Perspective Volume LUT, km (default: 32.0). */
  readonly aerialMaxDistanceKm: number
}

/** Earth-scale Hillaire (EGSR 2020) physical defaults. */
export const DEFAULT_ATMOSPHERE: AtmosphereParams = {
  planetRadiusKm: 6360.0,
  atmosphereRadiusKm: 6460.0,
  rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighScaleHeightKm: 8.0,
  mieScattering: 3.996e-3,
  mieExtinction: 4.440e-3,
  mieScaleHeightKm: 1.2,
  miePhaseG: 0.8,
  ozoneAbsorption: [0.650e-3, 1.881e-3, 0.085e-3],
  ozoneCenterKm: 25.0,
  ozoneHalfWidthKm: 15.0,
  haze: 1.0,
  sunDir: [0.0, 0.8660254, 0.5],
  sunIlluminance: [20.0, 20.0, 20.0],
  groundAlbedo: [0.3, 0.3, 0.3],
  cameraAltitudeKm: 0.05,
  cameraForward: [0.0, 0.0, -1.0],
  cameraRight: [1.0, 0.0, 0.0],
  cameraUp: [0.0, 1.0, 0.0],
  cameraTanHalfFovY: Math.tan(Math.PI / 6),
  cameraAspect: 16 / 9,
  aerialMaxDistanceKm: 32.0,
}

export const SKY_LUT_DIMS = {
  transmittanceWidth: 256,
  transmittanceHeight: 64,
  multiScatterSize: 32,
  skyViewWidth: 192,
  skyViewHeight: 108,
  aerialSize: 32,
  shCount: 9,
  shBytes: 9 * 16,
} as const

export interface SkyLutStats {
  readonly transmittanceDispatches: number
  readonly multiScatterDispatches: number
  readonly skyViewDispatches: number
  readonly aerialDispatches: number
  readonly shDispatches: number
  readonly totalDispatches: number
  readonly updates: number
}

export interface SkyLut {
  readonly transmittanceTexture: GPUTexture
  readonly transmittanceView: GPUTextureView
  readonly multiScatterTexture: GPUTexture
  readonly multiScatterView: GPUTextureView
  readonly skyViewTexture: GPUTexture
  readonly skyView: GPUTextureView
  readonly aerialTexture: GPUTexture
  readonly aerialView: GPUTextureView
  readonly shBuffer: GPUBuffer
  /** Linear sampler with repeat-U, clamp-V for seamless azimuth sampling of `skyView`. */
  readonly skyViewSampler: GPUSampler
  /** Linear sampler with clamp-to-edge on all axes for `aerialView` and `transmittanceView`. */
  readonly clampSampler: GPUSampler
  /** Updates only the dirty LUT passes on `encoder`. Zero per-frame heap allocations. */
  update(encoder: GPUCommandEncoder, params?: Partial<AtmosphereParams>): void
  /** Marks all LUT tiers dirty so the next `update()` recomputes every pass. */
  invalidate(): void
  /** Returns cumulative compute dispatch counts across all passes. */
  stats(): SkyLutStats
  /** Releases all GPU textures, buffers, and internal resources. */
  destroy(): void
}

/**
 * Generates standard WGSL resource bindings for `SKY_LUT_WGSL` in the chosen bind group.
 * Consumers (`march-shade.ts`, `froxel-fog.ts`) may call this or declare the five identifiers
 * (`skyViewTex`, `skyViewSampler`, `skyAerialTex`, `skyClampSampler`, `skySh`) at custom slots.
 */
export function skyLutBindings(group = 1, baseBinding = 0): string {
  return /* wgsl */ `
@group(${group}) @binding(${baseBinding}) var skyViewTex: texture_2d<f32>;
@group(${group}) @binding(${baseBinding + 1}) var skyViewSampler: sampler;
@group(${group}) @binding(${baseBinding + 2}) var skyAerialTex: texture_3d<f32>;
@group(${group}) @binding(${baseBinding + 3}) var skyClampSampler: sampler;
@group(${group}) @binding(${baseBinding + 4}) var<storage, read> skySh: array<vec4f, 9>;
`
}

/**
 * Reusable WGSL sampling library for `march-shade.ts` and `froxel-fog.ts`.
 * Expects bindings `skyViewTex`, `skyViewSampler`, `skyAerialTex`, `skyClampSampler`, and `skySh`
 * (see `skyLutBindings()`).
 */
export const SKY_LUT_WGSL = /* wgsl */ `
const SKY_LUT_PI: f32 = 3.14159265359;
const SKY_LUT_INV_2PI: f32 = 0.15915494309;
const SKY_LUT_HALF_PI: f32 = 1.57079632679;
const SKY_AERIAL_SLICES: f32 = 32.0;
const SKY_AERIAL_MAX_KM: f32 = 32.0;

// Non-linear horizon-concentrated Sky-View LUT UV parameterization (Hillaire EGSR 2020):
//   u in [0, 1]: azimuth relative to sun (0.5 = toward sun, 0/1 = anti-solar)
//   v in [0, 1]: 0.5 + 0.5 * sign(lat) * sqrt(|lat| / (pi / 2))
fn skyViewUv(rd: vec3f, sunDir: vec3f) -> vec2f {
  let d = normalize(rd);
  let sunXZ = vec2f(sunDir.x, sunDir.z);
  let sunXZLen = length(sunXZ);
  let sunFwd = select(vec2f(1.0, 0.0), sunXZ / sunXZLen, sunXZLen > 1e-5);
  let sunRight = vec2f(-sunFwd.y, sunFwd.x);
  let dXZ = vec2f(d.x, d.z);
  let dXZLen = length(dXZ);
  let az = select(0.0, atan2(dot(dXZ, sunRight), dot(dXZ, sunFwd)), dXZLen > 1e-6);
  let u = az * SKY_LUT_INV_2PI + 0.5;
  let lat = asin(clamp(d.y, -1.0, 1.0));
  let v = 0.5 + 0.5 * sign(lat) * sqrt(abs(lat) / SKY_LUT_HALF_PI);
  return vec2f(u, clamp(v, 0.0, 1.0));
}

// Samples physically scattered sky radiance from the 192 x 108 Sky-View LUT.
fn sampleSkyView(rd: vec3f, sunDir: vec3f) -> vec3f {
  let uv = skyViewUv(rd, sunDir);
  return textureSampleLevel(skyViewTex, skyViewSampler, uv, 0.0).rgb;
}

// Samples frustum-aligned Aerial Perspective (RGB = in-scattering, A = average transmittance)
// for a custom far range maxDistKm. Smoothly interpolates from (0, 0, 0, 1) within slice 0.
fn sampleAerialPerspectiveRange(uv: vec2f, distKm: f32, maxDistKm: f32) -> vec4f {
  let rangeKm = max(maxDistKm, 1e-4);
  let sliceKm = rangeKm / SKY_AERIAL_SLICES;
  let clampedDist = max(distKm, 0.0);
  if (clampedDist < sliceKm) {
    let s0 = textureSampleLevel(skyAerialTex, skyClampSampler, vec3f(uv, 0.5 / SKY_AERIAL_SLICES), 0.0);
    let w = clampedDist / sliceKm;
    return vec4f(s0.rgb * w, mix(1.0, s0.a, w));
  }
  let sliceCoord = clamp(clampedDist / rangeKm - 0.5 / SKY_AERIAL_SLICES, 0.5 / SKY_AERIAL_SLICES, 1.0 - 0.5 / SKY_AERIAL_SLICES);
  return textureSampleLevel(skyAerialTex, skyClampSampler, vec3f(uv, sliceCoord), 0.0);
}

// Samples frustum-aligned Aerial Perspective over the default 32 km range.
fn sampleAerialPerspective(uv: vec2f, distKm: f32) -> vec4f {
  return sampleAerialPerspectiveRange(uv, distKm, SKY_AERIAL_MAX_KM);
}

// Evaluates cosine-convolved L2 Spherical Harmonics sky irradiance E(normal) from skySh[0..8].
// Multiply by albedo / PI for physically consistent Lambertian ambient diffuse lighting.
fn evalSkyIrradianceSH(normal: vec3f) -> vec3f {
  let n = normalize(normal);
  let x = n.x;
  let y = n.y;
  let z = n.z;
  var irr = skySh[0].rgb * 0.28209479;
  irr += skySh[1].rgb * (0.48860251 * y);
  irr += skySh[2].rgb * (0.48860251 * z);
  irr += skySh[3].rgb * (0.48860251 * x);
  irr += skySh[4].rgb * (1.09254843 * x * y);
  irr += skySh[5].rgb * (1.09254843 * y * z);
  irr += skySh[6].rgb * (0.31539157 * (3.0 * z * z - 1.0));
  irr += skySh[7].rgb * (1.09254843 * x * z);
  irr += skySh[8].rgb * (0.54627422 * (x * x - y * y));
  return max(irr, vec3f(0.0));
}
`

// Shared WGSL atmosphere math used by all 5 compute passes.
const COMMON_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265359;
const INV_4PI: f32 = 0.07957747155;
const HALF_PI: f32 = 1.57079632679;
const TRANSMITTANCE_W: f32 = ${SKY_LUT_DIMS.transmittanceWidth}.0;
const TRANSMITTANCE_H: f32 = ${SKY_LUT_DIMS.transmittanceHeight}.0;
const MULTI_SCATTER_N: f32 = ${SKY_LUT_DIMS.multiScatterSize}.0;
const SKY_VIEW_W: f32 = ${SKY_LUT_DIMS.skyViewWidth}.0;
const SKY_VIEW_H: f32 = ${SKY_LUT_DIMS.skyViewHeight}.0;
const AERIAL_N: f32 = ${SKY_LUT_DIMS.aerialSize}.0;
const F16_CLAMP_MAX: f32 = 65000.0;

struct AtmosphereUniforms {
  // x: planetRadiusKm, y: atmosphereRadiusKm, z: rayleighScaleHeightKm, w: mieScaleHeightKm
  radiiAndHeights: vec4f,
  // xyz: rayleighScattering (1/km), w: haze multiplier
  rayleighAndHaze: vec4f,
  // x: mieScattering, y: mieExtinction, z: miePhaseG, w: ozoneCenterKm
  mieAndOzone: vec4f,
  // xyz: ozoneAbsorption (1/km), w: ozoneHalfWidthKm
  ozoneAbsAndWidth: vec4f,
  // xyz: groundAlbedo, w: cameraAltitudeKm
  groundAndAlt: vec4f,
  // xyz: sunDir (unit), w: aerialMaxDistanceKm
  sunAndAerialMax: vec4f,
  // xyz: sunIlluminance, w: unused
  sunIllum: vec4f,
  // xyz: cameraForward, w: cameraTanHalfFovY
  camFwdAndTan: vec4f,
  // xyz: cameraRight, w: cameraAspect
  camRightAndAspect: vec4f,
  // xyz: cameraUp, w: unused
  camUp: vec4f,
}

struct MediumSample {
  scatR: vec3f,
  scatM: vec3f,
  extinction: vec3f,
}

fn evalMedium(altitudeKm: f32, u: AtmosphereUniforms) -> MediumSample {
  let atmoThickness = u.radiiAndHeights.y - u.radiiAndHeights.x;
  if (altitudeKm > atmoThickness) {
    return MediumSample(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  }
  let h = max(altitudeKm, 0.0);
  let dR = exp(-h / max(u.radiiAndHeights.z, 1e-4));
  let dM = exp(-h / max(u.radiiAndHeights.w, 1e-4)) * max(u.rayleighAndHaze.w, 0.0);
  let dO = max(0.0, 1.0 - abs(h - u.mieAndOzone.w) / max(u.ozoneAbsAndWidth.w, 1e-4));

  let scatR = u.rayleighAndHaze.xyz * dR;
  let scatM = vec3f(u.mieAndOzone.x * dM);
  let extM = vec3f(u.mieAndOzone.y * dM);
  let absO = u.ozoneAbsAndWidth.xyz * dO;
  return MediumSample(scatR, scatM, scatR + extM + absO);
}

// Nearest positive ray-sphere intersection distance, or -1.0 if none.
fn raySphereNearest(ro: vec3f, rd: vec3f, radius: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  let t0 = -b - s;
  let t1 = -b + s;
  if (t1 < 0.0) { return -1.0; }
  if (t0 >= 0.0) { return t0; }
  return t1;
}

// Both ray-sphere intersections (t0, t1), or (-1, -1) on miss.
fn raySphereBoth(ro: vec3f, rd: vec3f, radius: f32) -> vec2f {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// True when a ray from p in direction rd hits the planet sphere ahead (with 0.5 m tolerance).
fn rayHitsPlanet(p: vec3f, rd: vec3f, planetRadius: f32) -> bool {
  let b = dot(p, rd);
  if (b >= 0.0) { return false; }
  let rSafe = planetRadius - 0.0005;
  let c = dot(p, p) - rSafe * rSafe;
  return (b * b - c) > 0.0;
}

fn rayleighPhase(cosTheta: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

fn hgPhase(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let denom = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4);
  return (1.0 - g2) / (4.0 * PI * denom * sqrt(denom));
}

fn unitToSubUv(val: f32, dim: f32) -> f32 {
  return (val * (dim - 1.0) + 0.5) / dim;
}

fn transmittanceUv(r: f32, cosZenith: f32, planetRadius: f32, atmoRadius: f32) -> vec2f {
  let rClamped = clamp(r, planetRadius, atmoRadius);
  let H = sqrt(max(atmoRadius * atmoRadius - planetRadius * planetRadius, 1e-6));
  let rho = sqrt(max(rClamped * rClamped - planetRadius * planetRadius, 0.0));
  let disc = rClamped * rClamped * (cosZenith * cosZenith - 1.0) + atmoRadius * atmoRadius;
  let d = max(0.0, -rClamped * cosZenith + sqrt(max(disc, 0.0)));
  let dMin = atmoRadius - rClamped;
  let dMax = rho + H;
  let uVal = clamp((d - dMin) / max(dMax - dMin, 1e-6), 0.0, 1.0);
  let vVal = clamp(rho / H, 0.0, 1.0);
  return vec2f(unitToSubUv(uVal, TRANSMITTANCE_W), unitToSubUv(vVal, TRANSMITTANCE_H));
}

fn multiScatterUv(r: f32, cosSunZenith: f32, planetRadius: f32, atmoRadius: f32) -> vec2f {
  let uVal = clamp(cosSunZenith * 0.5 + 0.5, 0.0, 1.0);
  let vVal = clamp((r - planetRadius) / max(atmoRadius - planetRadius, 1e-4), 0.0, 1.0);
  return vec2f(unitToSubUv(uVal, MULTI_SCATTER_N), unitToSubUv(vVal, MULTI_SCATTER_N));
}
`

const TRANSMITTANCE_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: AtmosphereUniforms;
@group(0) @binding(1) var transmittanceOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SKY_LUT_DIMS.transmittanceWidth}u || gid.y >= ${SKY_LUT_DIMS.transmittanceHeight}u) { return; }

  let planetRadius = u.radiiAndHeights.x;
  let atmoRadius = u.radiiAndHeights.y;

  let uUnit = f32(gid.x) / (TRANSMITTANCE_W - 1.0);
  let vUnit = f32(gid.y) / (TRANSMITTANCE_H - 1.0);

  let H = sqrt(max(atmoRadius * atmoRadius - planetRadius * planetRadius, 1e-6));
  let rho = H * vUnit;
  let r = sqrt(rho * rho + planetRadius * planetRadius);
  let dMin = atmoRadius - r;
  let dMax = rho + H;
  let d = dMin + uUnit * (dMax - dMin);
  let cosZenith = clamp(select(1.0, (H * H - rho * rho - d * d) / max(2.0 * r * d, 1e-6), d > 1e-5), -1.0, 1.0);
  let sinZenith = sqrt(max(1.0 - cosZenith * cosZenith, 0.0));

  let ro = vec3f(0.0, r, 0.0);
  let rd = vec3f(sinZenith, cosZenith, 0.0);
  let tMax = max(raySphereNearest(ro, rd, atmoRadius), 0.0);

  const STEPS: u32 = 40u;
  let dt = tMax / f32(STEPS);
  var opticalDepth = vec3f(0.0);
  for (var i = 0u; i < STEPS; i++) {
    let t = (f32(i) + 0.5) * dt;
    let p = ro + rd * t;
    let h = length(p) - planetRadius;
    let med = evalMedium(h, u);
    opticalDepth += med.extinction * dt;
  }

  let transmittance = exp(-opticalDepth);
  textureStore(transmittanceOut, vec2u(gid.x, gid.y), vec4f(transmittance, 1.0));
}
`

const MULTI_SCATTER_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: AtmosphereUniforms;
@group(0) @binding(1) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(2) var clampSamp: sampler;
@group(0) @binding(3) var multiScatterOut: texture_storage_2d<rgba16float, write>;

var<workgroup> sharedL: array<vec3f, 64>;
var<workgroup> sharedF: array<vec3f, 64>;

@compute @workgroup_size(64, 1, 1)
fn main(
  @builtin(workgroup_id) wgid: vec3u,
  @builtin(local_invocation_index) lid: u32,
) {
  let planetRadius = u.radiiAndHeights.x;
  let atmoRadius = u.radiiAndHeights.y;

  let uUnit = f32(wgid.x) / (MULTI_SCATTER_N - 1.0);
  let vUnit = f32(wgid.y) / (MULTI_SCATTER_N - 1.0);
  let cosSunZenith = clamp(uUnit * 2.0 - 1.0, -1.0, 1.0);
  let sinSunZenith = sqrt(max(1.0 - cosSunZenith * cosSunZenith, 0.0));
  let sunDir = vec3f(sinSunZenith, cosSunZenith, 0.0);

  let altitude = max(vUnit * (atmoRadius - planetRadius), 0.001);
  let r0 = clamp(planetRadius + altitude, planetRadius + 0.001, atmoRadius - 0.001);
  let ro = vec3f(0.0, r0, 0.0);

  // Uniform 8 x 8 spherical quadrature over 64 directions (equal solid angle 4*PI / 64).
  let ix = lid & 7u;
  let iy = lid >> 3u;
  let phi = ((f32(ix) + 0.5) / 8.0) * 2.0 * PI;
  let cosTheta = ((f32(iy) + 0.5) / 8.0) * 2.0 - 1.0;
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  let rd = vec3f(sinTheta * cos(phi), cosTheta, sinTheta * sin(phi));

  let tAtmo = raySphereNearest(ro, rd, atmoRadius);
  let tGround = raySphereNearest(ro, rd, planetRadius);
  let hitGround = tGround > 0.0 && (tAtmo < 0.0 || tGround < tAtmo);
  let tMax = select(max(tAtmo, 0.0), tGround, hitGround);

  const STEPS: u32 = 20u;
  let dt = tMax / f32(STEPS);
  var lum = vec3f(0.0);
  var fms = vec3f(0.0);
  var throughput = vec3f(1.0);

  for (var i = 0u; i < STEPS; i++) {
    let t = (f32(i) + 0.3) * dt;
    let p = ro + rd * t;
    let r = length(p);
    let h = r - planetRadius;
    let med = evalMedium(h, u);
    let scat = med.scatR + med.scatM;

    let stepT = exp(-med.extinction * dt);
    let safeExt = max(med.extinction, vec3f(1e-7));
    let sint = (vec3f(1.0) - stepT) / safeExt;

    // Multi-scatter transfer factor f_ms integrates unit isotropic radiance (phase integral = 1).
    fms += throughput * scat * sint;

    if (!rayHitsPlanet(p, sunDir, planetRadius)) {
      let cosS = dot(p / r, sunDir);
      let tUv = transmittanceUv(r, cosS, planetRadius, atmoRadius);
      let tSun = textureSampleLevel(transmittanceTex, clampSamp, tUv, 0.0).rgb;
      lum += throughput * tSun * scat * INV_4PI * sint;
    }

    throughput *= stepT;
  }

  // Lambertian ground bounce contribution into 2nd-order scattered light.
  if (hitGround) {
    let pG = ro + rd * tGround;
    let rG = length(pG);
    let nG = pG / rG;
    let nDotL = max(dot(nG, sunDir), 0.0);
    if (nDotL > 0.0) {
      let tUv = transmittanceUv(rG, nDotL, planetRadius, atmoRadius);
      let tSunG = textureSampleLevel(transmittanceTex, clampSamp, tUv, 0.0).rgb;
      lum += throughput * tSunG * nDotL * (u.groundAndAlt.xyz / PI);
    }
  }

  // Average over the 64 equal-area directions (solid angle dOmega / (4*PI) = 1 / 64).
  sharedL[lid] = lum * (1.0 / 64.0);
  sharedF[lid] = fms * (1.0 / 64.0);
  workgroupBarrier();

  for (var stride = 32u; stride > 0u; stride >>= 1u) {
    if (lid < stride) {
      sharedL[lid] += sharedL[lid + stride];
      sharedF[lid] += sharedF[lid + stride];
    }
    workgroupBarrier();
  }

  if (lid == 0u) {
    let fClamped = min(sharedF[0], vec3f(0.95));
    let psiMs = sharedL[0] / (vec3f(1.0) - fClamped);
    textureStore(multiScatterOut, vec2u(wgid.x, wgid.y), vec4f(clamp(psiMs, vec3f(0.0), vec3f(F16_CLAMP_MAX)), 1.0));
  }
}
`

const SKY_VIEW_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: AtmosphereUniforms;
@group(0) @binding(1) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(2) var multiScatterTex: texture_2d<f32>;
@group(0) @binding(3) var clampSamp: sampler;
@group(0) @binding(4) var skyViewOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SKY_LUT_DIMS.skyViewWidth}u || gid.y >= ${SKY_LUT_DIMS.skyViewHeight}u) { return; }

  let planetRadius = u.radiiAndHeights.x;
  let atmoRadius = u.radiiAndHeights.y;
  let sunDir = u.sunAndAerialMax.xyz;
  let sunIllum = u.sunIllum.xyz;
  let mieG = u.mieAndOzone.z;

  // Inverse of non-linear horizon-concentrated latitude parameterization:
  //   v = 0.5 + 0.5 * sign(lat) * sqrt(|lat| / (pi / 2))
  let uCoord = (f32(gid.x) + 0.5) / SKY_VIEW_W;
  let vCoord = (f32(gid.y) + 0.5) / SKY_VIEW_H;
  let az = (uCoord - 0.5) * 2.0 * PI;
  let dv = 2.0 * vCoord - 1.0;
  let lat = sign(dv) * dv * dv * HALF_PI;
  let cosLat = cos(lat);
  let sinLat = sin(lat);

  let sunXZ = vec2f(sunDir.x, sunDir.z);
  let sunXZLen = length(sunXZ);
  let sunFwd = select(vec2f(1.0, 0.0), sunXZ / sunXZLen, sunXZLen > 1e-5);
  let sunRight = vec2f(-sunFwd.y, sunFwd.x);
  let rdXZ = (sunFwd * cos(az) + sunRight * sin(az)) * cosLat;
  let rd = normalize(vec3f(rdXZ.x, sinLat, rdXZ.y));

  let camAlt = max(u.groundAndAlt.w, 0.001);
  let rCam = planetRadius + camAlt;
  let ro = vec3f(0.0, rCam, 0.0);

  // Support both street-level and SPACE-altitude viewpoints.
  let atmoHits = raySphereBoth(ro, rd, atmoRadius);
  if (atmoHits.y <= 0.0) {
    textureStore(skyViewOut, vec2u(gid.x, gid.y), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }
  let tStart = max(atmoHits.x, 0.0);
  var tEnd = atmoHits.y;

  let tGround = raySphereNearest(ro, rd, planetRadius);
  let hitGround = tGround >= tStart && tGround < tEnd;
  if (hitGround) {
    tEnd = tGround;
  }
  let span = max(tEnd - tStart, 0.0);
  if (span <= 1e-5) {
    textureStore(skyViewOut, vec2u(gid.x, gid.y), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let cosTheta = dot(rd, sunDir);
  let pR = rayleighPhase(cosTheta);
  let pM = hgPhase(cosTheta, mieG);

  const STEPS: u32 = 32u;
  var lum = vec3f(0.0);
  var throughput = vec3f(1.0);
  var prevT = tStart;

  for (var i = 1u; i <= STEPS; i++) {
    let frac = f32(i) / f32(STEPS);
    // Quadratic step spacing concentrates samples near the denser lower atmosphere.
    let nextT = tStart + span * frac * frac;
    let dt = nextT - prevT;
    let midT = prevT + 0.5 * dt;
    prevT = nextT;

    let p = ro + rd * midT;
    let r = length(p);
    let h = r - planetRadius;
    let med = evalMedium(h, u);

    let stepT = exp(-med.extinction * dt);
    let safeExt = max(med.extinction, vec3f(1e-7));
    let sint = (vec3f(1.0) - stepT) / safeExt;

    let cosS = dot(p / r, sunDir);
    var single = vec3f(0.0);
    if (!rayHitsPlanet(p, sunDir, planetRadius)) {
      let tUv = transmittanceUv(r, cosS, planetRadius, atmoRadius);
      let tSun = textureSampleLevel(transmittanceTex, clampSamp, tUv, 0.0).rgb;
      single = tSun * (med.scatR * pR + med.scatM * pM);
    }

    let msUv = multiScatterUv(r, cosS, planetRadius, atmoRadius);
    let psiMs = textureSampleLevel(multiScatterTex, clampSamp, msUv, 0.0).rgb;
    let multi = psiMs * (med.scatR + med.scatM);

    lum += throughput * (single + multi) * sunIllum * sint;
    throughput *= stepT;
  }

  // Reflected ground radiance for downward rays (provides grounded lower-hemisphere IBL).
  if (hitGround) {
    let pG = ro + rd * tEnd;
    let rG = length(pG);
    let nG = pG / rG;
    let cosSG = dot(nG, sunDir);
    let nDotL = max(cosSG, 0.0);
    var groundDirect = vec3f(0.0);
    if (nDotL > 0.0) {
      let tUv = transmittanceUv(rG, cosSG, planetRadius, atmoRadius);
      groundDirect = textureSampleLevel(transmittanceTex, clampSamp, tUv, 0.0).rgb * nDotL;
    }
    let msUvG = multiScatterUv(rG, cosSG, planetRadius, atmoRadius);
    let groundIndirect = textureSampleLevel(multiScatterTex, clampSamp, msUvG, 0.0).rgb * PI;
    lum += throughput * (u.groundAndAlt.xyz / PI) * (groundDirect + groundIndirect) * sunIllum;
  }

  let outRgb = clamp(lum, vec3f(0.0), vec3f(F16_CLAMP_MAX));
  textureStore(skyViewOut, vec2u(gid.x, gid.y), vec4f(outRgb, 1.0));
}
`

const AERIAL_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: AtmosphereUniforms;
@group(0) @binding(1) var transmittanceTex: texture_2d<f32>;
@group(0) @binding(2) var multiScatterTex: texture_2d<f32>;
@group(0) @binding(3) var clampSamp: sampler;
@group(0) @binding(4) var aerialOut: texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SKY_LUT_DIMS.aerialSize}u || gid.y >= ${SKY_LUT_DIMS.aerialSize}u) { return; }

  let planetRadius = u.radiiAndHeights.x;
  let atmoRadius = u.radiiAndHeights.y;
  let sunDir = u.sunAndAerialMax.xyz;
  let maxDistKm = max(u.sunAndAerialMax.w, 1e-3);
  let sunIllum = u.sunIllum.xyz;
  let mieG = u.mieAndOzone.z;

  // Screen UV (0, 0) top-left -> (1, 1) bottom-right, matching fog.ts / march.ts.
  let uCoord = (f32(gid.x) + 0.5) / AERIAL_N;
  let vCoord = (f32(gid.y) + 0.5) / AERIAL_N;
  let ndcX = uCoord * 2.0 - 1.0;
  let ndcY = 1.0 - vCoord * 2.0;

  let fwd = u.camFwdAndTan.xyz;
  let tanHalf = u.camFwdAndTan.w;
  let right = u.camRightAndAspect.xyz;
  let aspect = u.camRightAndAspect.w;
  let up = u.camUp.xyz;
  let rd = normalize(fwd + tanHalf * (right * ndcX * aspect + up * ndcY));

  let camAlt = max(u.groundAndAlt.w, 0.001);
  let ro = vec3f(0.0, planetRadius + camAlt, 0.0);

  let cosTheta = dot(rd, sunDir);
  let pR = rayleighPhase(cosTheta);
  let pM = hgPhase(cosTheta, mieG);

  const SUBSTEPS: u32 = 2u;
  let sliceKm = maxDistKm / AERIAL_N;
  let dt = sliceKm / f32(SUBSTEPS);

  // Incremental march across slices 0..31 guarantees exact O(N) cost and monotonic integration.
  var lum = vec3f(0.0);
  var throughput = vec3f(1.0);
  var t = 0.0;

  for (var z = 0u; z < ${SKY_LUT_DIMS.aerialSize}u; z++) {
    for (var s = 0u; s < SUBSTEPS; s++) {
      let midT = t + 0.5 * dt;
      t += dt;
      let p = ro + rd * midT;
      let rRaw = length(p);
      let r = max(rRaw, planetRadius + 0.001);
      let h = rRaw - planetRadius;
      let med = evalMedium(h, u);

      let stepT = exp(-med.extinction * dt);
      let safeExt = max(med.extinction, vec3f(1e-7));
      let sint = (vec3f(1.0) - stepT) / safeExt;

      let upVec = p / max(rRaw, 1e-4);
      let cosS = dot(upVec, sunDir);
      let pSafe = upVec * r;

      var single = vec3f(0.0);
      if (!rayHitsPlanet(pSafe, sunDir, planetRadius)) {
        let tUv = transmittanceUv(r, cosS, planetRadius, atmoRadius);
        let tSun = textureSampleLevel(transmittanceTex, clampSamp, tUv, 0.0).rgb;
        single = tSun * (med.scatR * pR + med.scatM * pM);
      }

      let msUv = multiScatterUv(r, cosS, planetRadius, atmoRadius);
      let psiMs = textureSampleLevel(multiScatterTex, clampSamp, msUv, 0.0).rgb;
      let multi = psiMs * (med.scatR + med.scatM);

      lum += throughput * (single + multi) * sunIllum * sint;
      throughput *= stepT;
    }

    let avgT = clamp((throughput.r + throughput.g + throughput.b) * (1.0 / 3.0), 0.0, 1.0);
    let outRgb = clamp(lum, vec3f(0.0), vec3f(F16_CLAMP_MAX));
    textureStore(aerialOut, vec3u(gid.x, gid.y, z), vec4f(outRgb, avgT));
  }
}
`

const SH_IRRADIANCE_WGSL = /* wgsl */ `
${COMMON_WGSL}

@group(0) @binding(0) var<uniform> u: AtmosphereUniforms;
@group(0) @binding(1) var skyViewTex: texture_2d<f32>;
@group(0) @binding(2) var skyViewSamp: sampler;
@group(0) @binding(3) var<storage, read_write> shOut: array<vec4f, 9>;

// 64 threads * 9 vec3f * 16 B = 9,216 B (< 16 KB guaranteed WebGPU workgroup storage limit).
var<workgroup> shShared: array<array<vec3f, 9>, 64>;

fn sampleSkyWorld(rd: vec3f, sunDir: vec3f) -> vec3f {
  let sunXZ = vec2f(sunDir.x, sunDir.z);
  let sunXZLen = length(sunXZ);
  let sunFwd = select(vec2f(1.0, 0.0), sunXZ / sunXZLen, sunXZLen > 1e-5);
  let sunRight = vec2f(-sunFwd.y, sunFwd.x);
  let dXZ = vec2f(rd.x, rd.z);
  let dXZLen = length(dXZ);
  let az = select(0.0, atan2(dot(dXZ, sunRight), dot(dXZ, sunFwd)), dXZLen > 1e-6);
  let uCoord = az / (2.0 * PI) + 0.5;
  let lat = asin(clamp(rd.y, -1.0, 1.0));
  let vCoord = 0.5 + 0.5 * sign(lat) * sqrt(abs(lat) / HALF_PI);
  return textureSampleLevel(skyViewTex, skyViewSamp, vec2f(uCoord, clamp(vCoord, 0.0, 1.0)), 0.0).rgb;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(local_invocation_index) lid: u32) {
  let sunDir = u.sunAndAerialMax.xyz;

  // 512 equal-area samples on a 32 x 16 (azimuth, sinLat) spherical grid:
  // each of the 64 threads integrates 8 samples with exact equal solid angle dOmega = 4*PI / 512.
  const AZ_N: u32 = 32u;
  const EL_N: u32 = 16u;
  const TOTAL: f32 = 512.0;
  const D_OMEGA: f32 = (4.0 * PI) / TOTAL;

  var acc: array<vec3f, 9>;
  for (var k = 0u; k < 9u; k++) { acc[k] = vec3f(0.0); }

  for (var step = 0u; step < 8u; step++) {
    let idx = lid + step * 64u;
    let ix = idx % AZ_N;
    let iy = idx / AZ_N;
    let phi = ((f32(ix) + 0.5) / f32(AZ_N)) * 2.0 * PI;
    let y = ((f32(iy) + 0.5) / f32(EL_N)) * 2.0 - 1.0;
    let cosLat = sqrt(max(1.0 - y * y, 0.0));
    let x = cosLat * cos(phi);
    let z = cosLat * sin(phi);
    let rd = vec3f(x, y, z);

    let rad = sampleSkyWorld(rd, sunDir) * D_OMEGA;

    acc[0] += rad * 0.28209479;
    acc[1] += rad * (0.48860251 * y);
    acc[2] += rad * (0.48860251 * z);
    acc[3] += rad * (0.48860251 * x);
    acc[4] += rad * (1.09254843 * x * y);
    acc[5] += rad * (1.09254843 * y * z);
    acc[6] += rad * (0.31539157 * (3.0 * z * z - 1.0));
    acc[7] += rad * (1.09254843 * x * z);
    acc[8] += rad * (0.54627422 * (x * x - y * y));
  }

  for (var k = 0u; k < 9u; k++) {
    shShared[lid][k] = acc[k];
  }
  workgroupBarrier();

  for (var stride = 32u; stride > 0u; stride >>= 1u) {
    if (lid < stride) {
      for (var k = 0u; k < 9u; k++) {
        shShared[lid][k] += shShared[lid + stride][k];
      }
    }
    workgroupBarrier();
  }

  // Convolve radiance SH with the clamped cosine lobe (Ramamoorthi & Hanrahan 2001):
  //   A0 = PI, A1 = 2*PI/3, A2 = PI/4.
  if (lid == 0u) {
    const A0: f32 = PI;
    const A1: f32 = (2.0 * PI) / 3.0;
    const A2: f32 = PI * 0.25;
    shOut[0] = vec4f(shShared[0][0] * A0, 0.0);
    shOut[1] = vec4f(shShared[0][1] * A1, 0.0);
    shOut[2] = vec4f(shShared[0][2] * A1, 0.0);
    shOut[3] = vec4f(shShared[0][3] * A1, 0.0);
    shOut[4] = vec4f(shShared[0][4] * A2, 0.0);
    shOut[5] = vec4f(shShared[0][5] * A2, 0.0);
    shOut[6] = vec4f(shShared[0][6] * A2, 0.0);
    shOut[7] = vec4f(shShared[0][7] * A2, 0.0);
    shOut[8] = vec4f(shShared[0][8] * A2, 0.0);
  }
}
`

const UNIFORM_FLOATS = 40 // 10 * vec4f = 160 bytes
const ATMO_EPS = 1e-6
const SKY_EPS = 1e-4

function diffExceeds(a: Float32Array, b: Float32Array, fromIdx: number, toIdx: number, eps: number): boolean {
  for (let i = fromIdx; i < toIdx; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return true
  }
  return false
}

/** Creates the standalone physically based sky & atmosphere compute LUT system on `device`. */
export async function createSkyLut(device: GPUDevice): Promise<SkyLut> {
  const [transMod, msMod, skyMod, aerialMod, shMod] = await Promise.all([
    shader(device, 'sky-lut-transmittance', TRANSMITTANCE_WGSL),
    shader(device, 'sky-lut-multiscatter', MULTI_SCATTER_WGSL),
    shader(device, 'sky-lut-skyview', SKY_VIEW_WGSL),
    shader(device, 'sky-lut-aerial', AERIAL_WGSL),
    shader(device, 'sky-lut-sh', SH_IRRADIANCE_WGSL),
  ])

  const [transPipe, msPipe, skyPipe, aerialPipe, shPipe] = await Promise.all([
    device.createComputePipelineAsync({ label: 'sky-lut-transmittance', layout: 'auto', compute: { module: transMod, entryPoint: 'main' } }),
    device.createComputePipelineAsync({ label: 'sky-lut-multiscatter', layout: 'auto', compute: { module: msMod, entryPoint: 'main' } }),
    device.createComputePipelineAsync({ label: 'sky-lut-skyview', layout: 'auto', compute: { module: skyMod, entryPoint: 'main' } }),
    device.createComputePipelineAsync({ label: 'sky-lut-aerial', layout: 'auto', compute: { module: aerialMod, entryPoint: 'main' } }),
    device.createComputePipelineAsync({ label: 'sky-lut-sh', layout: 'auto', compute: { module: shMod, entryPoint: 'main' } }),
  ])

  const lutUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC

  const transmittanceTexture = device.createTexture({
    label: 'sky-transmittance-lut',
    size: [SKY_LUT_DIMS.transmittanceWidth, SKY_LUT_DIMS.transmittanceHeight],
    format: 'rgba16float',
    usage: lutUsage,
  })
  const multiScatterTexture = device.createTexture({
    label: 'sky-multiscatter-lut',
    size: [SKY_LUT_DIMS.multiScatterSize, SKY_LUT_DIMS.multiScatterSize],
    format: 'rgba16float',
    usage: lutUsage,
  })
  const skyViewTexture = device.createTexture({
    label: 'sky-view-lut',
    size: [SKY_LUT_DIMS.skyViewWidth, SKY_LUT_DIMS.skyViewHeight],
    format: 'rgba16float',
    usage: lutUsage,
  })
  const aerialTexture = device.createTexture({
    label: 'sky-aerial-lut',
    dimension: '3d',
    size: [SKY_LUT_DIMS.aerialSize, SKY_LUT_DIMS.aerialSize, SKY_LUT_DIMS.aerialSize],
    format: 'rgba16float',
    usage: lutUsage,
  })

  const transmittanceView = transmittanceTexture.createView()
  const multiScatterView = multiScatterTexture.createView()
  const skyView = skyViewTexture.createView()
  const aerialView = aerialTexture.createView()

  const uniformBuffer = device.createBuffer({
    label: 'sky-atmosphere-uniforms',
    size: UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const shBuffer = device.createBuffer({
    label: 'sky-ibl-sh',
    size: SKY_LUT_DIMS.shBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC,
  })

  const clampSampler = device.createSampler({
    label: 'sky-clamp-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  })
  const skyViewSampler = device.createSampler({
    label: 'sky-view-linear',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'clamp-to-edge',
  })

  const transBind = device.createBindGroup({
    label: 'sky-transmittance-bg',
    layout: transPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: transmittanceView },
    ],
  })
  const msBind = device.createBindGroup({
    label: 'sky-multiscatter-bg',
    layout: msPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: transmittanceView },
      { binding: 2, resource: clampSampler },
      { binding: 3, resource: multiScatterView },
    ],
  })
  const skyBind = device.createBindGroup({
    label: 'sky-view-bg',
    layout: skyPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: transmittanceView },
      { binding: 2, resource: multiScatterView },
      { binding: 3, resource: clampSampler },
      { binding: 4, resource: skyView },
    ],
  })
  const aerialBind = device.createBindGroup({
    label: 'sky-aerial-bg',
    layout: aerialPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: transmittanceView },
      { binding: 2, resource: multiScatterView },
      { binding: 3, resource: clampSampler },
      { binding: 4, resource: aerialView },
    ],
  })
  const shBind = device.createBindGroup({
    label: 'sky-sh-bg',
    layout: shPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: skyView },
      { binding: 2, resource: skyViewSampler },
      { binding: 3, resource: { buffer: shBuffer } },
    ],
  })

  // Pre-allocated staging & cached state arrays for zero-GC updates.
  const next = new Float32Array(new ArrayBuffer(UNIFORM_FLOATS * 4))
  const prev = new Float32Array(new ArrayBuffer(UNIFORM_FLOATS * 4))
  let initialized = false
  let destroyed = false

  let transmittanceDispatches = 0
  let multiScatterDispatches = 0
  let skyViewDispatches = 0
  let aerialDispatches = 0
  let shDispatches = 0
  let updates = 0

  const transWgX = Math.ceil(SKY_LUT_DIMS.transmittanceWidth / 8)
  const transWgY = Math.ceil(SKY_LUT_DIMS.transmittanceHeight / 8)
  const skyWgX = Math.ceil(SKY_LUT_DIMS.skyViewWidth / 8)
  const skyWgY = Math.ceil(SKY_LUT_DIMS.skyViewHeight / 8)
  const aerialWg = Math.ceil(SKY_LUT_DIMS.aerialSize / 8)

  function packUniforms(p?: Partial<AtmosphereParams>): void {
    const d = DEFAULT_ATMOSPHERE
    const planetR = p?.planetRadiusKm ?? d.planetRadiusKm
    const atmoR = Math.max(p?.atmosphereRadiusKm ?? d.atmosphereRadiusKm, planetR + 1.0)
    const rH = p?.rayleighScaleHeightKm ?? d.rayleighScaleHeightKm
    const mH = p?.mieScaleHeightKm ?? d.mieScaleHeightKm
    const rS = p?.rayleighScattering ?? d.rayleighScattering
    const haze = Math.max(p?.haze ?? d.haze, 0.0)
    const mS = p?.mieScattering ?? d.mieScattering
    const mE = p?.mieExtinction ?? d.mieExtinction
    const mG = Math.max(-0.99, Math.min(0.99, p?.miePhaseG ?? d.miePhaseG))
    const oC = p?.ozoneCenterKm ?? d.ozoneCenterKm
    const oA = p?.ozoneAbsorption ?? d.ozoneAbsorption
    const oW = p?.ozoneHalfWidthKm ?? d.ozoneHalfWidthKm
    const alb = p?.groundAlbedo ?? d.groundAlbedo
    const alt = Math.max(p?.cameraAltitudeKm ?? d.cameraAltitudeKm, 0.001)

    const sd = p?.sunDir ?? d.sunDir
    const sLen = Math.hypot(sd[0], sd[1], sd[2]) || 1.0
    const sx = sd[0] / sLen, sy = sd[1] / sLen, sz = sd[2] / sLen
    const aMax = Math.max(p?.aerialMaxDistanceKm ?? d.aerialMaxDistanceKm, 0.1)
    const ill = p?.sunIlluminance ?? d.sunIlluminance

    const cf = p?.cameraForward ?? d.cameraForward
    const fLen = Math.hypot(cf[0], cf[1], cf[2]) || 1.0
    const cr = p?.cameraRight ?? d.cameraRight
    const rLen = Math.hypot(cr[0], cr[1], cr[2]) || 1.0
    const cu = p?.cameraUp ?? d.cameraUp
    const uLen = Math.hypot(cu[0], cu[1], cu[2]) || 1.0

    // Indices 0..18: atmosphere medium & ground albedo (Tier 1: Transmittance + Multi-Scatter)
    next[0] = planetR
    next[1] = atmoR
    next[2] = rH
    next[3] = mH
    next[4] = rS[0]
    next[5] = rS[1]
    next[6] = rS[2]
    next[7] = haze
    next[8] = mS
    next[9] = mE
    next[10] = mG
    next[11] = oC
    next[12] = oA[0]
    next[13] = oA[1]
    next[14] = oA[2]
    next[15] = oW
    next[16] = alb[0]
    next[17] = alb[1]
    next[18] = alb[2]

    // Indices 19..26 (skip 23 = aerialMax): altitude, sunDir, sunIlluminance (Tier 2: Sky-View + SH)
    next[19] = alt
    next[20] = sx
    next[21] = sy
    next[22] = sz
    next[23] = aMax
    next[24] = ill[0]
    next[25] = ill[1]
    next[26] = ill[2]
    next[27] = 0.0

    // Indices 28..39 (plus index 23 = aerialMax): camera frustum (Tier 3: Aerial Perspective)
    next[28] = cf[0] / fLen
    next[29] = cf[1] / fLen
    next[30] = cf[2] / fLen
    next[31] = p?.cameraTanHalfFovY ?? d.cameraTanHalfFovY
    next[32] = cr[0] / rLen
    next[33] = cr[1] / rLen
    next[34] = cr[2] / rLen
    next[35] = p?.cameraAspect ?? d.cameraAspect
    next[36] = cu[0] / uLen
    next[37] = cu[1] / uLen
    next[38] = cu[2] / uLen
    next[39] = 0.0
  }

  return {
    transmittanceTexture,
    transmittanceView,
    multiScatterTexture,
    multiScatterView,
    skyViewTexture,
    skyView,
    aerialTexture,
    aerialView,
    shBuffer,
    skyViewSampler,
    clampSampler,

    update(encoder, params) {
      if (destroyed) return
      updates++
      packUniforms(params)

      const atmoDirty = !initialized || diffExceeds(next, prev, 0, 19, ATMO_EPS)
      const skyDirty = atmoDirty
        || Math.abs(next[19] - prev[19]) > SKY_EPS
        || diffExceeds(next, prev, 20, 23, SKY_EPS)
        || diffExceeds(next, prev, 24, 27, SKY_EPS)
      const aerialDirty = skyDirty
        || Math.abs(next[23] - prev[23]) > SKY_EPS
        || diffExceeds(next, prev, 28, 39, SKY_EPS)

      if (!aerialDirty) return

      device.queue.writeBuffer(uniformBuffer, 0, next)
      prev.set(next)
      initialized = true

      if (atmoDirty) {
        const pTrans = encoder.beginComputePass({ label: 'sky-transmittance' })
        pTrans.setPipeline(transPipe)
        pTrans.setBindGroup(0, transBind)
        pTrans.dispatchWorkgroups(transWgX, transWgY, 1)
        pTrans.end()
        transmittanceDispatches++

        const pMs = encoder.beginComputePass({ label: 'sky-multiscatter' })
        pMs.setPipeline(msPipe)
        pMs.setBindGroup(0, msBind)
        pMs.dispatchWorkgroups(SKY_LUT_DIMS.multiScatterSize, SKY_LUT_DIMS.multiScatterSize, 1)
        pMs.end()
        multiScatterDispatches++
      }

      if (skyDirty) {
        const pSky = encoder.beginComputePass({ label: 'sky-view' })
        pSky.setPipeline(skyPipe)
        pSky.setBindGroup(0, skyBind)
        pSky.dispatchWorkgroups(skyWgX, skyWgY, 1)
        pSky.end()
        skyViewDispatches++

        const pSh = encoder.beginComputePass({ label: 'sky-sh-irradiance' })
        pSh.setPipeline(shPipe)
        pSh.setBindGroup(0, shBind)
        pSh.dispatchWorkgroups(1, 1, 1)
        pSh.end()
        shDispatches++
      }

      if (aerialDirty) {
        const pAerial = encoder.beginComputePass({ label: 'sky-aerial' })
        pAerial.setPipeline(aerialPipe)
        pAerial.setBindGroup(0, aerialBind)
        pAerial.dispatchWorkgroups(aerialWg, aerialWg, 1)
        pAerial.end()
        aerialDispatches++
      }
    },

    invalidate() {
      initialized = false
    },

    stats() {
      return {
        transmittanceDispatches,
        multiScatterDispatches,
        skyViewDispatches,
        aerialDispatches,
        shDispatches,
        totalDispatches: transmittanceDispatches + multiScatterDispatches + skyViewDispatches + aerialDispatches + shDispatches,
        updates,
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      transmittanceTexture.destroy()
      multiScatterTexture.destroy()
      skyViewTexture.destroy()
      aerialTexture.destroy()
      uniformBuffer.destroy()
      shBuffer.destroy()
    },
  }
}
