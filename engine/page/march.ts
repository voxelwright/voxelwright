// The drawer (#140, #165): split into a 1/4-res conservative cone beam pre-pass (march-trace.ts),
// a compute primary-geometry + glass visibility pass (vis0/vis1, march-trace.ts), and a deferred
// GGX Metallic/Roughness PBR shading pass (march-shade.ts) that writes linear HDR color, frag_depth,
// rg16float analytic motion vectors (prevUV - curUV), rgba16float world normals, and rgba16float panes.
import { FAR, NEAR, shader, viewProjection, type Target } from '../probe/gpu.ts'
import { SUN_SIDE, SUN_TILE, SunMaps } from './sun.ts'
import { createComputeSunUpdater, MAX_SUN_TILES, prepareSunTiles, type ComputeSunUpdater, type SunComputeStats } from './sun-compute.ts'
import { createGtao, type GtaoPass, type GtaoStats, type GtaoTimestampWrites } from './gtao.ts'
import type { DynamicShadows } from './dynamic-shadows.ts'
import type { SkyLut } from './sky-lut.ts'
import type { VoxelGIPass, VoxelGISky } from './gi.ts'
import { createWorldVoxelizer, type WorldVoxelizer } from './gi-world.ts'
import type { RestirDIPass } from './restir.ts'
import { SIDE, type World } from './world.ts'
import { grid as marksGrid } from './marks.ts'
import { createLocalLights, type LocalLights } from './lights.ts'
import { beamCode, halfGbufCode, patchVelocityCode, restirOcclusionWgsl, sunCode, sunTraceWgsl, visCode, visDepthCode, type TraceCodeDeps } from './march-trace.ts'
import { shadeCode, type ShadeCodeDeps } from './march-shade.ts'

/**
 * A number an address asks for (#81: the measuring knobs, `?workers=`, `?pool=`, `?farfaces=` and the like), kept
 * between `least` and `most`, and whole where `whole`. Where the address says nothing, or nothing that is a finite
 * number, the fallback: a crafted link cannot ask for a billion workers, a pool past the device, or a shader with NaN in it.
 */
export function bounded(said: string | null | undefined, fallback: number, least: number, most: number, whole = false): number {
  const n = said === null || said === undefined || said.trim() === '' ? NaN : Number(said)
  if (!Number.isFinite(n)) return fallback
  const kept = Math.min(most, Math.max(least, n))
  return whole ? Math.round(kept) : kept
}
/** `?fine=` (#259): 0, 1 or 2 more boxes of finer cells. */
export const FINE_ASKED = bounded(new URLSearchParams(globalThis.location?.search ?? '').get('fine'), 0, 0, 2, true)
export const MAX_LEVELS = 10 + Math.max(0, FINE_ASKED - 1)
/** Diagnostic override: `?beam=0` disables the 1/4-res conservative beam pre-pass. */
const BEAM_ON = new URLSearchParams(globalThis.location?.search ?? '').get('beam') !== '0'
/** Diagnostic override: `?sun_compute=0` falls back to legacy per-tile `fs_sun` render passes. */
const SUN_COMPUTE_ON = new URLSearchParams(globalThis.location?.search ?? '').get('sun_compute') !== '0'
/** Diagnostic override: `?gtao=0` falls back to legacy 4-tree-walk `openness()` AO. */
const GTAO_ON = new URLSearchParams(globalThis.location?.search ?? '').get('gtao') !== '0'
/** Diagnostic override: `?gi=0` disables voxel-native 3D clipmap GI + SVGF allocation and warmup. */
const GI_ON = new URLSearchParams(globalThis.location?.search ?? '').get('gi') !== '0'

/** The colours every thing in the world shares: 0 is the material's own, 1 to 15 white to black, then 24 hues in ten tones (kinds.rs). */
export function palette(): Float32Array<ArrayBuffer> {
  const out = new Float32Array(256 * 4)
  const set = (i: number, r: number, g: number, b: number) => { out[i * 4] = r ** 2.2; out[i * 4 + 1] = g ** 2.2; out[i * 4 + 2] = b ** 2.2; out[i * 4 + 3] = 1 }
  // Nothing painted is brighter than white paint is: a wall as bright as paper comes out of the sun as white, whatever is on it.
  for (let i = 1; i < 16; i++) { const v = 0.86 - ((i - 1) / 14) * 0.8; set(i, v, v, v * 0.99) }
  // Saturation and value of the ten tones.
  const TONES: [number, number][] = [[0.14, 0.97], [0.26, 0.94], [0.4, 0.88], [0.55, 0.8], [0.78, 0.86], [0.7, 0.55], [0.6, 0.32], [0.16, 0.8], [0.26, 0.62], [0.3, 0.42]]
  // The pale tones are what walls are painted: paint holds less colour in green, blue and pink than in cream, ochre
  // and brick red, and a wall at full strength in those reads as plastic.
  const HOLDS = [0.95, 0.95, 0.55, 0.55, 0.7, 0.5]
  const PAINTED: Record<number, [number, number]> = { 0: [0.14, 0.93], 1: [0.26, 0.88], 2: [0.4, 0.8], 7: [0.16, 0.76] }
  for (let hue = 0; hue < 24; hue++) for (let tone = 0; tone < 10; tone++) {
    const h = hue / 4, at = Math.floor(h), holds = HOLDS[at] + (HOLDS[(at + 1) % 6] - HOLDS[at]) * (h - at)
    const [s, bright] = PAINTED[tone] ? [PAINTED[tone][0] * holds, PAINTED[tone][1]] : TONES[tone], v = bright * 0.84
    const f = (n: number) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
    set(16 + hue * 10 + tone, f(5), f(3), f(1))
  }
  return out
}

/** How bright a lit window's pane is, for the march's windows and the far model's (see PANE_LIGHT in the shader). */
export const PANE_LIGHT = 1.25
/** How many lettering boards' letters have a light of their own (letterlight.ts, Looks.letters). */
export const LIT_LETTERS = 32
/** Where `Looks.edits` begins in the looks buffer, bytes: after the palette, materials, far, cover, wedge, bear, keep and letters. */
const EDITS_AT = 256 * 16 + 16 * 32 + 16 + 512 + 64 + (2 + 2 * LIT_LETTERS) * 16
/**
 * The landmarks' own lights by night (#450, heroes.rs `night`): the crown of lamps on Salesforce Tower, the Pyramid's
 * lit spire and its beacon. Whatever is drawn inside a landmark's lit part, cells or the far model's faces, gives
 * off its light: one rule for both, so a landmark is lit one way from across the city and from under it, and no
 * tile is baked again for it. Needs `g`. `p` is a point measured as the eye is (cells), `wide` how many metres a
 * pixel covers there. The answer is light to add, before the weather's share of the dark is taken.
 */
export const LANDMARK_LIGHT = /* wgsl */ `
// Radius of the illuminated envelope at a fraction of its height. The corners
// of its square plan and projecting skin also receive light.
fn beaconRadius(h: Beacon, t: f32) -> f32 {
  return mix(h.at.w, h.span.z, t) * 1.45 + 3.0;
}
fn landmarkLight(p: vec3f, wide: f32) -> vec3f {
  var out = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let h = g.beacon[i];
    if (h.colour.a <= 0.0) { break; }
    let q = (p - h.at.xyz) * 0.1;
    if (q.y < h.span.x - 0.5 || q.y > h.span.y + 1.0) { continue; }
    let t = clamp((q.y - h.span.x) / max(h.span.y - h.span.x, 1.0), 0.0, 1.0);
    if (length(q.xz) > beaconRadius(h, t)) { continue; }
    var light = h.colour.a;
    if (h.span.w > 0.0) {
      // A screen of lamps behind a grid: dark rings across it while they are wider than a pixel, and a slow tide of
      // brighter and dimmer going up it, as what the screen shows moves.
      let ring = smoothstep(0.0, 0.5, abs(fract(q.y / h.span.w) - 0.5) * 2.0);
      light *= mix(0.5 + 0.5 * ring, 0.75, smoothstep(0.25, 0.6, wide / h.span.w));
      light *= 0.8 + 0.2 * sin(q.y * 0.21 - g.time * 0.45) + 0.12 * sin(q.y * 0.07 + g.time * 0.17);
    } else {
      // Lit from within, brighter towards its point.
      light *= 0.3 + 0.7 * t;
    }
    out += h.colour.rgb * light;
  }
  return out;
}
// The lamp at a landmark's very top: far brighter than a wall, a point from across the city.
fn landmarkLamp(p: vec3f) -> vec3f {
  for (var i = 0u; i < 8u; i++) {
    let h = g.beacon[i];
    if (h.colour.a <= 0.0) { break; }
    let q = (p - h.at.xyz) * 0.1;
    if (h.more.x > 0.0 && q.y > h.span.y - h.more.x && q.y <= h.span.y + 1.0 && length(q.xz) < h.span.z * 1.45 + 3.0) { return h.colour.rgb * 7.5; }
  }
  return vec3f(0.0);
}
`

/**
 * A tree's crown by night (#450). A crown in a city is lit from under and from the side by the sky's glow and the
 * street's lamps, clump by clump.
 */
export const LEAF_NIGHT = /* wgsl */ `
fn leafNight(albedo: vec3f, n: vec3f, at: vec3f) -> vec3f {
  let c = floor(at / 30.0);
  let clump = fract(sin(dot(c, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
  let glow = vec3f(0.62, 0.5, 0.46) * (0.35 + 0.3 * max(n.y, 0.0));
  let lamps = vec3f(1.0, 0.72, 0.4) * (0.2 + 0.5 * max(-n.y, 0.0) + 0.3 * (1.0 - abs(n.y))) * (0.25 + 1.1 * clump * clump);
  return albedo * (glow + lamps) * 0.95;
}
`

/**
 * A wall's windows by night from where its panes are too small to be cells (#450): one rule for the far model's faces
 * (far.ts) and for the march's own coarse cells.
 */
export const NIGHT_WALL = /* wgsl */ `
fn within(at: f32, lo: f32, hi: f32, wide: f32) -> f32 {
  return clamp((at - lo) / wide + 0.5, 0.0, 1.0) * clamp((hi - at) / wide + 0.5, 0.0, 1.0);
}
fn wallHash(p: vec2f, k: u32) -> f32 {
  var h = (u32(i32(p.x)) * 73856093u) ^ (u32(i32(p.y)) * 83492791u) ^ (k * 2654435761u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
const WALL_RUN = 6.0;
fn nightWall(fx: f32, fy: f32, ax: f32, ay: f32, pw: f32, y0: f32, ph: f32, seed: u32, least: f32) -> vec4f {
  let storey = floor(fy);
  let whole = wallHash(vec2f(0.0, 0.0), seed);
  let busy = max(0.16 + 0.34 * whole, least);
  let hf = wallHash(vec2f(7.0, storey), seed);
  let floorShare = min(busy * (0.2 + 2.4 * hf * hf), 0.96);
  let run = floor(fx / WALL_RUN + hf * WALL_RUN);
  let on = step(1.0 - floorShare, wallHash(vec2f(run, storey), seed + 31u));
  let hp = wallHash(vec2f(floor(fx), storey), seed + 77u);
  let own = step(0.14, hp) * (0.55 + 0.45 * fract(hp * 13.0));
  let bx = smoothstep(0.3, 0.8, ax);
  let by = smoothstep(0.3, 0.8, ay);
  let brun = max(smoothstep(0.3, 0.8, ax / WALL_RUN), by);
  let share = mix(mix(on, floorShare, brun), busy, by);
  let along = mix(within(fract(fx), 0.5 - pw * 0.5, 0.5 + pw * 0.5, ax) * own, pw * 0.67, bx);
  let up = mix(within(fract(fy), y0, y0 + ph, ay), ph, by);
  let cold = step(0.92, wallHash(vec2f(3.0, storey), seed + 5u)) * (1.0 - by);
  let tint = mix(mix(vec3f(1.0, 0.64, 0.32), vec3f(1.0, 0.82, 0.56), fract(whole * 7.0)), vec3f(0.78, 0.9, 1.0), cold);
  return vec4f(tint, along * up * share);
}
`

/**
 * Each material's own colour and how its cells differ from one another (wander), then roughness, mirror, glow,
 * and metallic (#165: steel/chrome/vehicles use GGX metallic Fresnel). Sixteen of each (32 bytes per material).
 */
export function materials(): Float32Array<ArrayBuffer> {
  const M: [string, number, number, number, number, number][] = [
    ['#000000', 0, 1, 0, 0, 0],
    ['#6b5440', 0.9, 0.95, 0, 0, 0], // earth
    ['#7d7a76', 0.8, 0.9, 0, 0, 0], // rock
    ['#5f8a3c', 0.7, 0.95, 0, 0, 0], // grass
    ['#d9c79a', 0.6, 0.95, 0, 0, 0], // sand
    ['#2f6f86', 0.15, 0.06, 0.9, 0, 0], // water
    ['#4c4e54', 0.35, 0.92, 0, 0, 0], // asphalt
    ['#a9a69f', 0.5, 0.85, 0, 0, 0], // concrete
    ['#a4553d', 0.9, 0.9, 0, 0, 0], // brick
    ['#cfc6b4', 0.3, 0.9, 0, 0, 0], // plaster
    ['#b98a5a', 0.7, 0.75, 0, 0, 0], // wood
    ['#9fc3d6', 0.1, 0.05, 0.75, 0, 0], // glass
    ['#8f959c', 0.25, 0.38, 0, 0, 0.24], // steel: painted/structural steel keeps diffuse fill; bare/polished chrome boosts in march-shade.ts
    ['#4f8a3a', 1.2, 0.95, 0, 0, 0], // leaves
    ['#4a4744', 0.6, 0.95, 0, 0, 0], // roofing
    ['#ffe2a8', 0.05, 0.45, 0, 1, 0.15], // lamp
  ]
  const out = new Float32Array(16 * 8)
  M.forEach(([hex, wander, rough, mirror, glow, metallic], i) => {
    for (let c = 0; c < 3; c++) out[i * 8 + c] = (parseInt(hex.slice(1 + c * 2, 3 + c * 2), 16) / 255) ** 2.2
    out.set([wander, rough, mirror, glow, metallic], i * 8 + 3)
  })
  return out
}

/** The view, the boxes and the sun's maps as the shaders are told them. */
export const GLOBALS = /* wgsl */ `
struct Level {
  boxMin: vec3f, scale: f32,
  boxSize: vec3f, roof: f32,
  wrap: vec3u, pad1: u32,
  cells: vec3i, pad2: i32,
  roofs: vec4f,
}
struct Globals {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, time: f32,
  forward: vec3f, levels: u32,
  sun: vec3f, flags: u32,
  res: vec2f, most: u32, sea: f32,
  pixel: f32, detail: f32, day: f32, low: f32,
  sunU: vec3f, sunFar: f32,
  sunV: vec3f, sunMaps: u32,
  level: array<Level, ${MAX_LEVELS}>,
  sunLevel: array<SunLevel, ${MAX_LEVELS}>,
  lightSun: vec4f, lightFill: vec4f, skyZenith: vec4f, skyHorizon: vec4f, skyHorizonSun: vec4f, cloudTint: vec4f, cloudTintSun: vec4f,
  weather: vec4f,
  starts: vec4f,
  air: vec4f,
  fog: vec4f,
  fogTint: vec4f,
  beacon: array<Beacon, 8>,
  moon: vec4f,
}
struct Beacon { at: vec4f, span: vec4f, colour: vec4f, more: vec4f }
struct SunLevel { base: vec2f, pad: vec2f, drawn0: vec4u, drawn1: vec4u }
`

/**
 * The window screen (#450, eggs.ts): a small picture the city's lit windows show, as if every pane were a pixel of
 * one screen the size of the view.
 */
export const SCREEN = /* wgsl */ `
fn screenAt(uv: vec2f) -> vec4f {
  if (g.air.z <= 0.0 || any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0))) { return vec4f(0.0); }
  return textureLoad(screen, vec2i(uv * vec2f(textureDimensions(screen))), 0) * g.air.z;
}
`
/** The window screen's size, texels. */
export const SCREEN_SIZE = [256, 144] as const

const THIN = (1 / 280).toFixed(6)
/** A quick number for a place on a plane, and a smooth noise of them: the clouds', the fog's (FOG) and the far model's fog. */
export const NOISE = /* wgsl */ `
fn hash2i(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn noise2(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2i(i), hash2i(i + vec2i(1, 0)), u.x), mix(hash2i(i + vec2i(0, 1)), hash2i(i + vec2i(1, 1)), u.x), u.y);
}
`
export const FOG = /* wgsl */ `
fn fogged(rd: vec3f, dist: f32) -> vec2f {
  var t0 = 0.0;
  var t1 = dist;
  let ax = vec2f(g.fog.w, g.fogTint.a);
  if (abs(rd.x) > 1e-5) {
    var meet = (g.fog.z - g.eye.x) / rd.x;
    let z = (g.eye.z + rd.z * meet + ax.y) * 0.00035;
    meet = (g.fog.z + (noise2(vec2f(z, g.time * 0.01)) - 0.5) * 2400.0 - g.eye.x) / rd.x;
    if (rd.x > 0.0) { t1 = min(t1, meet); } else { t0 = max(t0, meet); }
  } else if (g.eye.x > g.fog.z) { return vec2f(0.0); }
  if (t1 <= t0) { return vec2f(0.0); }
  var top = g.sea + g.fog.y;
  var lump = 0.5;
  if (abs(rd.y) > 1e-4) {
    let at = (g.eye.xz + rd.xz * clamp((top - g.eye.y) / rd.y, 0.0, 2e5) + ax) * 0.0006 + vec2f(g.time * 0.006, g.time * 0.002);
    lump = noise2(at) * 0.7 + noise2(at * 3.1) * 0.3;
    top += (lump - 0.5) * 700.0;
  }
  let ya = g.eye.y + rd.y * t0;
  let yb = g.eye.y + rd.y * t1;
  let span = t1 - t0;
  var under = 0.0;
  if (abs(yb - ya) < 0.01) { under = select(0.0, span, ya < top); }
  else {
    let c = clamp((top - ya) / (yb - ya), 0.0, 1.0);
    under = span * select(1.0 - c, c, yb > ya);
    if (ya < top && yb < top) { under = span; }
    if (ya >= top && yb >= top) { under = 0.0; }
  }
  let y1 = max(ya, top) - top;
  let y2 = max(yb, top) - top;
  let e1 = exp(-y1 * ${THIN});
  var over = (span - under) * e1;
  if (abs(y2 - y1) > 0.5) { over = (span - under) * (e1 - exp(-y2 * ${THIN})) / ((y2 - y1) * ${THIN}); }
  return vec2f(1.0 - exp(-min(g.fog.x * (under + over), 30.0)), lump);
}
fn inFog(col: vec3f, rd: vec3f, dist: f32) -> vec3f {
  let fog = fogged(rd, dist);
  let over = smoothstep(0.0, 600.0, g.eye.y - g.sea - g.fog.y);
  return mix(col, g.fogTint.rgb * (1.0 + over * (0.08 + 0.36 * (fog.y - 0.35))), fog.x);
}
`

const sunlitText = (marks: boolean) => /* wgsl */ `
fn sunlit(p: vec3f, n: vec3f, level: u32) -> f32 {
  for (var L = level; L < g.levels; L++) {
    let texel = 1.0 / g.level[L].scale;
    let q = p + n * (0.6 * texel);
    let uv = vec2f(dot(q, g.sunU), dot(q, g.sunV)) / texel;
    let eye = vec2f(dot(g.eye, g.sunU), dot(g.eye, g.sunV)) / texel;
    if (any(abs(uv - eye) > vec2f(${7 * SUN_TILE - 2}.0))) { continue; }
    let sl = g.sunLevel[L];
    let wrap = vec2i(${SUN_SIDE - 1});
    let at = (vec2i(floor(uv + sl.base)) + ${SUN_SIDE}) & wrap;
    let tile = u32(at.x >> ${Math.log2(SUN_TILE)}u) + ${SUN_SIDE / SUN_TILE}u * u32(at.y >> ${Math.log2(SUN_TILE)}u);
    let word = select(sl.drawn0, sl.drawn1, (tile >> 5u) >= 4u)[(tile >> 5u) & 3u];
    if (((word >> (tile & 31u)) & 1u) == 0u) { continue; }
    let d = dot(q, g.sun) + g.sunFar + 0.35 * texel;
    let between = uv + sl.base - 0.5;
    let low = vec2i(floor(between)) + ${SUN_SIDE};
    let f = fract(between);
${marks ? `    let r00 = textureLoad(sunMap, low & wrap, L, 0).r;
    let r10 = textureLoad(sunMap, (low + vec2i(1, 0)) & wrap, L, 0).r;
    let r01 = textureLoad(sunMap, (low + vec2i(0, 1)) & wrap, L, 0).r;
    let r11 = textureLoad(sunMap, (low + vec2i(1, 1)) & wrap, L, 0).r;
    if (((((bitcast<u32>(r00) & u32(d < r00)) | (bitcast<u32>(r10) & u32(d < r10)) | (bitcast<u32>(r01) & u32(d < r01)) | (bitcast<u32>(r11) & u32(d < r11)))) & 1u) != 0u) { return -2.0; }
    let s00 = step(r00, d);
    let s10 = step(r10, d);
    let s01 = step(r01, d);
    let s11 = step(r11, d);
` : `    let s00 = step(textureLoad(sunMap, low & wrap, L, 0).r, d);
    let s10 = step(textureLoad(sunMap, (low + vec2i(1, 0)) & wrap, L, 0).r, d);
    let s01 = step(textureLoad(sunMap, (low + vec2i(0, 1)) & wrap, L, 0).r, d);
    let s11 = step(textureLoad(sunMap, (low + vec2i(1, 1)) & wrap, L, 0).r, d);
`}    return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
  }
  return -1.0;
}
`
export const SUNLIT = sunlitText(false)

/** Glass (#163), for the world and for bodies: transmission tint and grazing reflection strength. */
export const GLASS = /* wgsl */ `
fn glassTint(kind: u32, thick: f32) -> vec3f {
  let ci = (kind >> 8u) & 255u;
  var base = looks.material[11].colour;
  if (ci != 0u) { base = looks.palette[ci].rgb; }
  let hue = base / max(max(base.r, base.g), max(base.b, 0.001));
  return pow(mix(vec3f(1.0), hue, 0.25), vec3f(thick));
}
fn glassMirror(rd: vec3f, n: vec3f) -> f32 {
  let facing = 1.0 - clamp(dot(-rd, n), 0.0, 1.0);
  return looks.material[11].mirror * (0.08 + 0.92 * pow(facing, 5.0));
}
`

/** Where the far model takes over from the cells at a point p (far.ts), the same for both. */
export const HANDOVER = /* wgsl */ `
fn inWedge(p: vec3f, wedge: vec4f, bear: vec4f) -> bool {
  let d = p.xz - wedge.xy;
  let b = atan2(d.x, -d.y);
  let bearing = select(b, b + 6.2831853, b < 0.0);
  return wedge.z > 0.0 && bearing > bear.x && bearing < bear.y && dot(d, d) < wedge.z * wedge.z;
}
fn kept(p: vec3f, k0: vec4f, k1: vec4f) -> bool {
  return k1.w > 0.0 && all(p >= k0.xyz) && all(p <= k1.xyz);
}
fn reachAt(p: vec3f, reach: f32, wedge: vec4f, bear: vec4f, k0: vec4f, k1: vec4f) -> f32 {
  return select(reach, min(reach, wedge.w), inWedge(p, wedge, bear) && !kept(p, k0, k1));
}
`

/** Boxes the world was changed in that stay the cells' at any distance (far.ts `edited`): at most this many. */
export const EDITS = 8
export const EDITED = (boxes: string) => /* wgsl */ `
fn edited(p: vec3f) -> bool {
  var hit = false;
  for (var i = 0u; i < ${EDITS}u; i++) {
    let lo = ${boxes}[2u * i];
    let hi = ${boxes}[2u * i + 1u];
    hit = hit || (hi.w > 0.0 && all(p >= lo.xyz) && all(p < hi.xyz));
  }
  return hit;
}
`

/** The sky's own colour along a look, and what the air between does to a thing seen far off. */
export const AIR = /* wgsl */ `
fn skyBase(rd: vec3f) -> vec3f {
  let up = clamp(rd.y, 0.0, 1.0);
  var horizon = g.skyHorizon.rgb;
  if (g.low > 0.0) {
    let sunward = max(dot(normalize(rd.xz + vec2f(0.0001, 0.0)), vec2f(g.skyHorizonSun.a, g.cloudTint.a)), 0.0);
    horizon = mix(horizon, g.skyHorizonSun.rgb, sunward * sunward);
  }
  var col = mix(horizon, g.skyZenith.rgb, pow(up, g.skyZenith.a));
  let toward = max(dot(rd, g.sun), 0.0);
  col += g.lightSun.rgb * vec3f(1.0, 0.8, 0.56) * (pow(toward, 6.0) * 0.22 + pow(toward, 3.0) * g.skyHorizon.a);
  return mix(col, horizon * 0.94, clamp(-rd.y * 6.0, 0.0, 1.0));
}
fn haze(rd: vec3f, dist: f32) -> f32 {
  let low = (g.eye.y - g.sea) / 12000.0;
  let rise = rd.y * dist / 12000.0;
  var thick = exp(-max(low, 0.0));
  if (abs(rise) > 0.01) { thick *= (1.0 - exp(-rise)) / rise; }
  return 1.0 - exp(-dist * 0.00003 * g.air.x * thick);
}
fn hazeColour(rd: vec3f) -> vec3f { return skyBase(vec3f(rd.x, max(rd.y, 0.02) * 0.3, rd.z)) * 1.6; }
fn air(col: vec3f, rd: vec3f, dist: f32) -> vec3f { return mix(col, hazeColour(rd), haze(rd, dist)); }
`

/**
 * Energy-Conserving GGX Metallic/Roughness PBR lighting model (#165), shared by the world, bodies, people, and far model.
 * Keeps the exact 8-argument `shade(...)` signature (metallic = 0) and exposes `shadePbr(..., metallic)` for metallic materials.
 */
const lightWgsl = (useF16: boolean) => /* wgsl */ `
const ROOM_LIGHT = 1.6;
var<private> roomLit: f32 = 1.0;
var<private> skyLit: f32 = 1.0;
var<private> giOverride: vec4f = vec4f(0.0);
fn shadePbrAo(albedo: vec3f, n: vec3f, rd: vec3f, sun: vec3f, direct: f32, directOpen: f32, ambientAo: vec3f, specAo: f32, rough: f32, glow: f32, metallic: f32) -> vec3f {
  let r = clamp(rough, 0.045, 1.0);
  let a = r * r;
  let a2 = a * a;
  let v = -rd;
  let ndv = max(dot(n, v), 0.001);
  let hv = normalize(sun + v);
  let ndh = max(dot(n, hv), 0.0);
  let vdh = max(dot(v, hv), 0.0);
  let ndl = max(dot(n, sun), 0.001);
  // Trowbridge-Reitz GGX NDF + Height-Correlated Smith-GGX Visibility (f32 for denominator precision).
  let dDen = ndh * ndh * (a2 - 1.0) + 1.0;
  let D = a2 / max(3.14159265 * dDen * dDen, 1e-5);
  let gv = ndl * sqrt(ndv * ndv * (1.0 - a2) + a2);
  let gl = ndv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  let Vis = 0.5 / max(gv + gl, 1e-4);
  let dv = min(D * Vis, 16.0);
  let omVdh = 1.0 - vdh;
  let omVdh2 = omVdh * omVdh;
  let omVdh5 = omVdh2 * omVdh2 * omVdh;
  let omNdv = 1.0 - ndv;
  let omNdv2 = omNdv * omNdv;
  let omNdv5 = omNdv2 * omNdv2 * omNdv;
  let above = 0.5 + 0.5 * n.y;
  let refl = reflect(rd, n);
  let envSky = mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(max(refl.y, 0.0), max(g.skyZenith.a, 0.25)));
  let envUp = smoothstep(-0.65, 0.65, refl.y);
  let roomMask = 1.0 - smoothstep(0.0, 0.15, direct);
  let bounceW = (0.6 - 0.4 * n.y) * (0.5 + 0.5 * max(-dot(n, sun), 0.0)) * g.lightSun.a;
  // Rough dielectrics (earth, sand, grass, brick) scatter ambient via skylight/bounce rather than mirror IBL;
  // metallics and smooth dielectrics retain full GGX specular & hemisphere environment reflection.
  let specEnergy = mix(1.0 - 0.78 * r * r, 1.0, metallic);
  let envWeight = mix((1.0 - r) * (1.0 - r), 0.35 + 0.65 * (1.0 - r), metallic) * skyLit;
  ${useF16 ? `let alb = vec3<f16>(min(max(albedo, vec3f(0.0)), vec3f(60000.0)));
  let met = f16(clamp(metallic, 0.0, 1.0));
  let f0 = mix(vec3<f16>(0.04h), alb, met);
  let F = f0 + (vec3<f16>(1.0h) - f0) * f16(omVdh5);
  let kD = (vec3<f16>(1.0h) - F * f16(specEnergy)) * (1.0h - met);
  let sunCol = vec3<f16>(min(max(g.lightSun.rgb, vec3f(0.0)), vec3f(60000.0)));
  let fillCol = vec3<f16>(min(max(g.lightFill.rgb, vec3f(0.0)), vec3f(60000.0)));
  let openH = f16(directOpen);
  let directLit = sunCol * f16(direct * 3.6) * (kD * alb * (0.75h + 0.25h * openH) + F * f16(dv * 3.14159265 * specEnergy) * (0.65h + 0.35h * openH));
  let skylight = mix(vec3<f16>(0.12h, 0.118h, 0.115h) * f16(g.lightFill.a), fillCol, f16(above));
  let bounce = vec3<f16>(0.24h, 0.2h, 0.15h) * f16(bounceW);
  let room = sunCol * f16(g.lightSun.a * g.weather.w * roomLit * ROOM_LIGHT * roomMask);
  let baseAmb = (skylight + bounce) * f16(skyLit) + room;
  let giRgbH = vec3<f16>(min(max(giOverride.rgb, vec3f(0.0)), vec3f(60000.0)));
  let ambIrrad = select(baseAmb, mix(baseAmb, giRgbH, f16(giOverride.a)), giOverride.a > 0.001);
  let fEnv = f0 + (max(vec3<f16>(f16(1.0 - r)), f0) - f0) * f16(omNdv5);
  let kDEnv = (vec3<f16>(1.0h) - fEnv * f16(mix(1.0 - r, 1.0, metallic))) * (1.0h - met);
  let envGround = fillCol * 0.55h + vec3<f16>(0.14h, 0.145h, 0.155h) * f16(g.lightFill.a * 0.35 + g.lightSun.a * 0.95);
  let envSkyH = vec3<f16>(min(max(envSky, vec3f(0.0)), vec3f(60000.0)));
  let envSpec = mix(envGround, mix(fillCol, envSkyH, f16(1.0 - r * 0.75)), f16(envUp)) * fEnv * f16(envWeight);
  let ambientLit = alb * kDEnv * ambIrrad * vec3<f16>(min(max(ambientAo, vec3f(0.0)), vec3f(60000.0))) + envSpec * f16(specAo);
  return vec3f(directLit + ambientLit + alb * f16(glow * 3.2));` : `let f0 = mix(vec3f(0.04), albedo, metallic);
  let F = f0 + (vec3f(1.0) - f0) * omVdh5;
  let kD = (vec3f(1.0) - F * specEnergy) * (1.0 - metallic);
  let SUN_LIGHT = g.lightSun.rgb;
  let directLit = SUN_LIGHT * direct * 3.6 * (kD * albedo * (0.75 + 0.25 * directOpen) + F * (dv * 3.14159265 * specEnergy) * (0.65 + 0.35 * directOpen));
  let skylight = mix(vec3f(0.12, 0.118, 0.115) * g.lightFill.a, g.lightFill.rgb, above);
  let bounce = vec3f(0.24, 0.2, 0.15) * bounceW;
  let room = SUN_LIGHT * g.lightSun.a * g.weather.w * roomLit * ROOM_LIGHT * roomMask;
  let baseAmb = (skylight + bounce) * skyLit + room;
  let ambIrrad = select(baseAmb, mix(baseAmb, max(giOverride.rgb, vec3f(0.0)), giOverride.a), giOverride.a > 0.001);
  let fEnv = f0 + (max(vec3f(1.0 - r), f0) - f0) * omNdv5;
  let kDEnv = (vec3f(1.0) - fEnv * mix(1.0 - r, 1.0, metallic)) * (1.0 - metallic);
  let envGround = g.lightFill.rgb * 0.55 + vec3f(0.14, 0.145, 0.155) * (g.lightFill.a * 0.35 + g.lightSun.a * 0.95);
  let envSpec = mix(envGround, mix(g.lightFill.rgb, envSky, 1.0 - r * 0.75), envUp) * fEnv * envWeight;
  let ambientLit = albedo * kDEnv * ambIrrad * ambientAo + envSpec * specAo;
  return directLit + ambientLit + albedo * glow * 3.2;`}
}
fn shadePbr(albedo: vec3f, n: vec3f, rd: vec3f, sun: vec3f, direct: f32, open: f32, rough: f32, glow: f32, metallic: f32) -> vec3f {
  return shadePbrAo(albedo, n, rd, sun, direct, open, vec3f(open), open, rough, glow, metallic);
}
fn shade(albedo: vec3f, n: vec3f, rd: vec3f, sun: vec3f, direct: f32, open: f32, rough: f32, glow: f32) -> vec3f {
  return shadePbr(albedo, n, rd, sun, direct, open, rough, glow, 0.0);
}
`
export const LIGHT = lightWgsl(false)

/** What a face of a cell looks like: bricks, stucco, wood planks, concrete slabs, shingles, grass, and wear. */
export const PAINT = /* wgsl */ `
fn hash3i(c: vec3i, seed: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (u32(c.z) * 83492791u) ^ (seed * 2654435761u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn soft(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash3i(vec3i(i.x, i.y, 0), seed), hash3i(vec3i(i.x + 1, i.y, 0), seed), u.x), mix(hash3i(vec3i(i.x, i.y + 1, 0), seed), hash3i(vec3i(i.x + 1, i.y + 1, 0), seed), u.x), u.y);
}
fn paint(kind: u32, cell: vec3i, n: vec3f, fine: f32, q: vec3f, sharp: f32) -> vec3f {
  let stuff = kind & 15u;
  let m = looks.material[stuff];
  let ci = (kind >> 8u) & 255u;
  var base = m.colour;
  if (ci != 0u) { base = looks.palette[ci].rgb; }
  let own = hash3i(cell, 1u);
  let blot = hash3i(cell >> vec3u(2u), 2u);
  var v = 1.0 + ((own - 0.5) * 0.4 * fine + (blot - 0.5) * 0.16) * m.wander;
  let wall = abs(n.y) < 0.5;
  var along = cell.x;
  var across = cell.z;
  if (abs(n.x) > 0.5) { along = cell.z; across = cell.x; }
  var up = cell.y;
  if (!wall) { up = cell.z; across = cell.y; }
  if (wall && min(abs(n.x), abs(n.z)) > 0.02) { across = 0; }
  var fa = q.x;
  var fu = q.y;
  if (abs(n.x) > 0.5) { fa = q.z; }
  if (!wall) { fu = q.z; }
  let on = vec2f(f32(along), f32(up)) + vec2f(fa, fu) * fine;
  let worn = (soft(on / 16.0 + vec2f(f32(across >> 3u) * 7.3, 0.0), 3u) - 0.5) * 1.5;
  let lines = clamp((sharp - 2.0) / 4.0, 0.0, 1.0) * fine;
  let grain = clamp((sharp - 4.0) / 6.0, 0.0, 1.0) * fine;
  let sub = vec2u(clamp(vec2f(fa, fu) * 4.0, vec2f(0.0), vec2f(3.0)));
  let speck = hash3i(cell, 40u + sub.x + 4u * sub.y) - 0.5;
  var over = vec4f(0.0);
  if ((kind & 16u) != 0u) { return base * max(0.88 + (own - 0.5) * 0.34 * fine + (blot - 0.5) * 0.2 + speck * 0.24 * grain, 0.2); }
  if (stuff == 8u) {
    let brick = vec3i((along + (up & 1)) >> 1u, up, across);
    let shade = hash3i(brick, 4u);
    v = 1.0 + ((shade - 0.5) * 0.44 - select(0.0, 0.22, shade > 0.9)) * fine + (own - 0.5) * 0.08 * fine + worn * 0.12 + speck * 0.1 * grain;
    if (wall) {
      let starts = ((along + (up & 1)) & 1) == 0;
      over = vec4f(0.56, 0.54, 0.5, max(step(fu, 0.17), select(0.0, step(fa, 0.11), starts)) * lines * 0.85);
    }
  } else if (stuff == 9u) {
    if (wall) {
      let lower = (up & 1) == 0;
      let course = select(0.0, 1.0, !lower && fu > 0.78);
      let fine_band = clamp((sharp - 2.0) / 2.0, 0.0, 1.0);
      v -= mix(mix(0.025, select(0.0, 0.055, lower), fine_band) * fine, course * 0.13 + ((f32(up & 1) + fu) * 0.5 - 0.5) * 0.03, lines);
    }
    v += worn * 0.11 + speck * 0.055 * grain;
  } else if (stuff == 10u) {
    var plank = vec3i(along >> 1u, across, 0);
    var run = up;
    if (!wall) { plank = vec3i(cell.z >> 1u, cell.y, 1); run = cell.x; }
    v = 1.0 + ((hash3i(plank, 5u) - 0.5) * 0.3 + (hash3i(vec3i(plank.x, plank.y, run >> 2u), 6u) - 0.5) * 0.12) * fine + (own - 0.5) * 0.06 * fine;
    var pa = fa;
    var first = (along & 1) == 0;
    if (!wall) { pa = q.z; first = (cell.z & 1) == 0; }
    if (first && pa < 0.1) { v -= 0.4 * lines; }
    v += (hash3i(vec3i(plank.x * 8 + i32(pa * 4.0) + select(4, 0, first), plank.y, run >> 3u), 12u) - 0.5) * 0.12 * grain;
  } else if (stuff == 7u) {
    if (((along & 15) == 0 || (up & 15) == 0)) {
      let joint = max(select(0.0, step(fa, 0.16), (along & 15) == 0), select(0.0, step(fu, 0.16), (up & 15) == 0));
      v -= mix(0.14 * fine, joint * 0.32, lines);
    }
    v += worn * 0.14 + speck * 0.08 * grain;
  } else if (stuff == 14u) {
    let shingle = vec3i((cell.x + (cell.z & 1)) >> 1u, cell.y, cell.z);
    v = 1.0 + (hash3i(shingle, 7u) - 0.5) * 0.3 * fine + worn * 0.1 + speck * 0.1 * grain;
  } else if (stuff == 6u || stuff == 1u || stuff == 3u) {
    if (stuff == 6u) {
      v += worn * 0.18 + speck * 0.09 * grain + select(0.0, 0.12, speck > 0.46) * grain;
    } else if (stuff == 1u) {
      v += worn * 0.14 + speck * 0.16 * grain;
    } else {
      let tuft = soft(on / 5.0, 31u) - 0.5;
      base = mix(base, vec3f(0.42, 0.4, 0.12), clamp(worn * 0.55 + tuft * 0.25 + 0.14, 0.0, 0.4));
      v += tuft * 0.22 + speck * 0.24 * grain;
      if (speck > 0.3) { base = mix(base, vec3f(0.5, 0.52, 0.16), grain * 0.5); }
    }
  }
  if (stuff == 13u) { v += speck * 0.24 * grain; }
  if (stuff == 2u || stuff == 4u) { v += speck * 0.1 * grain; }
  return mix(base * max(v, 0.2), over.rgb, over.a);
}
`

const TRIES = bounded(new URLSearchParams(globalThis.location?.search ?? '').get('tries'), 16, 1, 64, true)
const THROUGH = bounded(new URLSearchParams(globalThis.location?.search ?? '').get('through'), 2, 0.1, 64).toFixed(2)
const PANES = bounded(new URLSearchParams(globalThis.location?.search ?? '').get('panes'), 2, 1, 8, true)
const INLOOP = new URLSearchParams(globalThis.location?.search ?? '').get('walk') === 'loop'

export interface View {
  /** Where the eye is, in the finest cells of the world. */
  eye: readonly [number, number, number]
  forward: readonly [number, number, number]
  right: readonly [number, number, number]
  up: readonly [number, number, number]
  tanHalf: number
}

/** FLAT leaves corners as bright as the open: for seeing what the darkening costs. */
/** PLAIN: no skip over empty air but from node to node. Slower and never wrong: what the skips are checked against. */
/** UNDER: the eye is under the sea. The marcher sets it itself, from `under`. */
export const SHADOWS = 1, MIRRORS = 2, HEAT = 4, COUNT = 8, PICK = 16, FLAT = 32, PLAIN = 64, UNDER = 128
/** A tool's aim (`pick`): the far model takes it over only past its reach, not its wedge's (HANDOVER), so that an edit there finds the cells it changes. */
export const CELLS = 256
const FOG_THICK = 1 / 2400, FOG_TOP = 1400
export const PANES_FORMAT: GPUTextureFormat = 'rgba16float'
export const VELOCITY_FORMAT: GPUTextureFormat = 'rg16float'
export const VIS_NORMAL_FORMAT: GPUTextureFormat = 'rgba16float'
/** Tiles of the sun's maps drawn each frame. */
export const SUN_TILES_A_FRAME = 8

export interface MarcherDrawExtra {
  /** Halton(2, 3) sub-pixel jitter in render-res pixels ([-0.5, 0.5]). Defaults to [0, 0]. */
  readonly jitter?: readonly [number, number]
  /** Invalidate previous camera pose so motion vectors output exact (0, 0) on cuts/teleports. */
  readonly resetHistory?: boolean
  /** Monotonic frame counter seeding GTAO's spatio-temporal Hilbert + R2 noise (0 for deterministic checks). */
  readonly gtaoFrame?: number
  /** Optional GPU timestamp writes spanning the compute GTAO passes. */
  readonly gtaoTiming?: GtaoTimestampWrites
  /** Physically based Sky-View / Aerial Perspective LUT blend weight in [0, 1] (0 = legacy analytic sky). */
  readonly skyLutBlend?: number
  /** Unclamped physical sun unit direction for Sky-View LUT sampling. */
  readonly skySunDir?: readonly [number, number, number]
  /** Linear exposure multiplier applied to Sky-View & Aerial Perspective radiance. */
  readonly skyExposure?: number
  /** Weather overcast desaturation amount in [0, 1] for Sky-View LUT. */
  readonly skyOvercast?: number
  /** Physical aerial perspective blend strength in [0, 1]. */
  readonly aerialStrength?: number
  /** Camera altitude above sea level in km. */
  readonly camAltKm?: number
  /** Smooth daylight factor in [0, 1] (0 at night, 1 in full day). */
  readonly dayFade?: number
  /** Suppresses legacy 2D cloud plane on open sky pixels when volumetric 3D clouds composite after `farModel.draw`. */
  readonly volCloudsActive?: boolean
  /** Enables dynamic-object directional sun shadow sampling (`@group(3)`) in `march-shade.ts`. */
  readonly dynShadowActive?: boolean
  /** Enables 512-light 3D frustum-clustered local-light shading (`@group(2)`) in `march-shade.ts`. */
  readonly clusterActive?: boolean
  /** Suppresses legacy `inFog()` in `march-shade.ts` when 3D froxel volumetric fog composites after overlays. */
  readonly froxelFogActive?: boolean
  /** Enables live Voxel-Native 3D Clipmap GI + SVGF (`gi.ts` + `gi-world.ts`). */
  readonly giActive?: boolean
  /** Hard temporal reset for GI clipmap + SVGF history on teleports/cuts/hour jumps. */
  readonly giReset?: boolean
  /** Resets only SVGF screen-space temporal history (preserving the 3D multi-bounce clipmap cache) on blasts/edits. */
  readonly giSvgfReset?: boolean
  /** Forces full clipmap voxelization + injection (no slice amortization) e.g. right after a blast/edit. */
  readonly giForceFull?: boolean
  /** Steady-state Z-slice amortization stride for clipmap updates (`1..8`, default `4`). */
  readonly giAmortizeStride?: number
  /** Active world flames `[x, y, z, ...]` (cells) injected into GI clipmap emissive cache. */
  readonly giFlames?: Float32Array
  /** Indirect diffuse GI gain calibrated against PR #213 daylight contrast (default `0.88`). */
  readonly giGain?: number
  /** Optional GPU timestamp writes for GI cascade, trace, and SVGF (strictly matched begin/end pairs per phase). */
  readonly giTiming?: {
    readonly cascadeBegin?: GPUComputePassTimestampWrites
    readonly cascadeEnd?: GPUComputePassTimestampWrites
    readonly trace?: GPUComputePassTimestampWrites
    readonly svgfBegin?: GPUComputePassTimestampWrites
    readonly svgfEnd?: GPUComputePassTimestampWrites
  }
  /** Enables live ReSTIR-DI shadowed local-light resampling (`restir.ts`) when local lights > 0. */
  readonly restirActive?: boolean
  /** Hard temporal reset for ReSTIR-DI reservoirs on teleports/cuts/hour jumps. */
  readonly restirReset?: boolean
  /** Monotonic frame counter seeding ReSTIR-DI RNG & Vogel disk jitter. */
  readonly restirFrame?: number
  /** Optional GPU timestamp writes spanning ReSTIR-DI (RIS start -> Spatial+Shade end). */
  readonly restirTiming?: {
    readonly begin?: GPUComputePassTimestampWrites
    readonly end?: GPUComputePassTimestampWrites
  }
}

export interface MarcherExternalPasses {
  readonly dynShadows?: DynamicShadows | null
  readonly skyLut?: SkyLut | null
  readonly gi?: VoxelGIPass | null
  readonly restir?: RestirDIPass | null
}

export interface Marcher {
  /** The last draw used the requested glass pipeline, including any reflections. */
  readonly glassReady: boolean
  /** Draws the world into `to`, and how far off each pixel's thing is into its depth. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, flags: number, time: number, timing?: GPURenderPassTimestampWrites, /** Only these pixels of `to` are drawn: x, y, width, height. */ only?: readonly [number, number, number, number], /** Looks begin at this plane and not at the eye: its normal (pointing the way the looks go) and how far along it the plane is, in the world's finest cells. */ starts?: readonly [number, number, number, number], extra?: MarcherDrawExtra): void
  /** Patches `velocityView` after overlay/banner/car/far passes so dynamic objects get zero TAA smearing and far towers get exact 3D reprojection. */
  patchVelocity(encoder: GPUCommandEncoder, to: Target, farDepth?: GPUTextureView | null): void
  /** Attaches external Wave 1-3 passes (`dynShadows`, `skyLut`) to `@group(3)` of Pass 2 deferred shading (zero per-frame allocs). */
  setExternalPasses(ext: MarcherExternalPasses): void
  /** Whether compute GTAO ran on the most recent `draw()`. */
  readonly gtaoRan: boolean
  /** Whether live Voxel-Native GI + SVGF ran on the most recent `draw()`. */
  readonly giRan: boolean
  /** Whether live ReSTIR-DI shadowed local-light resampling ran on the most recent `draw()`. */
  readonly restirRan: boolean
  /** Shared compute `@group(1)` bind group layout (`g`, `pool`, `top`) for ReSTIR-DI voxel shadow traversal. */
  readonly worldBindGroupLayout: GPUBindGroupLayout
  /** 64-tree voxel occlusion WGSL (`traceShadowRay`) wired into `createRestirDI({ occlusionWgsl })`. */
  readonly restirOcclusionWgsl: string
  /** Latest compute GTAO pass statistics (null when `?gtao=0` or unavailable). */
  readonly gtaoStats: GtaoStats | null
  /** Latest single-dispatch compute sun-tile updater statistics (null when `?sun_compute=0` or unavailable). */
  readonly sunComputeStats: SunComputeStats | null
  /** The world's buffers on the GPU are others than they were (world.ts `trade`): they are bound again. */
  rebind(): void
  /** The road's paint and rails (#450, marks.ts `grid`), drawn by a Bay world's march from now on. */
  marks(bytes: ArrayBuffer): number
  /** Where the far model (far.ts) takes over from the cells. */
  farCover(corner: readonly [number, number], size: number, reach: number, held: Uint32Array<ArrayBuffer>, wedge?: readonly number[] | null, keep?: readonly number[] | null, edits?: readonly (readonly number[])[]): void
  /** Rebuilds the marcher's shaders while the page runs (#264, workshop). */
  reshade(change: (wgsl: string) => string): Promise<{ compiled: number; ms: number }>
  /** Draws a few tiles of the sun's maps as they stand for this view. */
  tend(encoder: GPUCommandEncoder, view: View, ready: boolean | number, most?: number, timing?: { querySet: GPUQuerySet; begin: number; end: number }): number
  /** The sun's maps: an edit must spoil the tiles it touches. */
  readonly sun: SunMaps
  /** The colours and materials as the GPU holds them, for whatever else is drawn into the picture. */
  readonly looks: GPUBuffer
  /** What the shaders are told of the view, the boxes and the sun's maps (GLOBALS), for whatever else is lit by them. */
  readonly globals: GPUBuffer
  /** Dynamic local lights shared across march, pieces, people and wheels. */
  readonly localLights: LocalLights
  /** Glass pane transmittance & distance target for downstream passes. */
  panes(size: readonly [number, number]): GPUTextureView
  /** Analytic screen-space motion vectors (rg16float: prevUV - curUV, active sub-rect to.size inside allocSize). */
  readonly velocityView: GPUTextureView
  /** World-space surface normals (rgba16float: xyz normal, w roughness; 0 on sky). */
  readonly visNormalView: GPUTextureView
  /** Primary geometry visibility buffer 0 (rgba32uint: cell xyz, packed kind/level/face/flags w). */
  readonly vis0View: GPUTextureView
  /** Primary geometry visibility buffer 1 (rgba32float: hitT, pane1T, pane1Meta, workSteps). */
  readonly vis1View: GPUTextureView
  /** Whether the maps are used for shadows (they are, unless a check wants every shadow traced). */
  maps: boolean
  /** What is straight ahead: how far (finest cells), of what, what colour. `plain` asks without the skips over empty air. */
  pick(view: View, plain?: boolean): Promise<{ t: number; material: number; colour: number } | null>
  /** How many pixels wide a thing must be to be drawn as itself: 1 is every cell that can be seen, 2 is half as fine. */
  detail: number
  /** How hard it rains, 0 to 1. */
  rain: number
  /** How overcast the sky is, 0 to 1. */
  cloud: number
  /** How far the sea's fog has come in (#450), 0 to 1. */
  fog: number
  /** Where the fog's front stands (finest cells east). */
  front: number
  /** Whether the eye is under the sea. */
  under: boolean
  /** How far the eye is in a room, 0 to 1. */
  roofed: number
  /** How far windows, lamps and signs are lit, 0 to 1. */
  readonly lights: number
  /** The lettering boards' own light (letterlight.ts). */
  letters(data: Float32Array | null): void
  /** Where the light comes from, how much of the day it is (1 day, 0 night) and how low the sun (1 at the horizon). */
  light(sun: readonly [number, number, number], day: number, low: number): void
  readonly day: number
  /** The air (#450): haze and cloud against the town's own (1), and a sky of its own by day. */
  air: Air
  /** The landmarks as the night knows them (heroes.rs `night`). Eight at most. */
  beacons: readonly Beacon[]
  /** The window screen (#450, eggs.ts). */
  readonly screen: { readonly texture: GPUTexture; readonly view: GPUTextureView; up: number; moon: number; sky: boolean; rect: [number, number, number, number] }
  /** The moon (#524). */
  moon: Moon
}

export interface Moon { readonly sun: readonly [number, number, number]; readonly disc: -1 | 0 | 1; readonly light: number }
export const WHOLE_MOON: Moon = { sun: [0, -1, 0], disc: 0, light: 1 }
export interface Beacon { at: readonly [number, number, number]; night: readonly number[]; /** How far from its middle it reaches, m. */ reach: number }
export interface Air { haze: number; clouds: number; sky?: { zenith: readonly [number, number, number]; horizon: readonly [number, number, number] } }

interface TargetAux {
  panes: GPUTexture
  panesView: GPUTextureView
  velocity: GPUTexture
  velocityView: GPUTextureView
  visNormal: GPUTexture
  visNormalView: GPUTextureView
}

/** `behind` allows a look to begin at a window plane. A released city's first view can draw while Metal compiles its mirrors. */
export async function marcher(device: GPUDevice, format: GPUTextureFormat, world: World, behind = false, deferMirrors = false, maxSize?: readonly [number, number]): Promise<Marcher> {
  const grid = world.options.grid
  const hasCompute = typeof device.createComputePipelineAsync === 'function'
  const canF16 = device.features?.has?.('shader-f16') ?? false

  const traceDeps: TraceCodeDeps = { GLOBALS, HANDOVER, EDITED, GLASS, LIT_LETTERS, EDITS, TRIES, THROUGH, PANES, INLOOP }
  const shadeDepsFor = (useF16: boolean): ShadeCodeDeps => ({
    GLOBALS, SCREEN, LIGHT: lightWgsl(useF16), GLASS, PAINT, AIR, NOISE,
    NIGHT_WALL, LANDMARK_LIGHT, LEAF_NIGHT, FOG, sunlitText,
    PANE_LIGHT, LIT_LETTERS, EDITS, TRIES, THROUGH, INLOOP,
  })

  const buildModules = async (change?: (wgsl: string) => string) => {
    const shadeSrc = shadeCode(world, shadeDepsFor(canF16), canF16)
    const [shadeMod, sunMod, beamMod, visMod, visDepthMod, halfGbufMod, patchVelMod] = await Promise.all([
      shader(device, 'march-shade', change ? change(shadeSrc) : shadeSrc),
      shader(device, 'march-sun', sunCode(world, traceDeps)),
      hasCompute ? shader(device, 'march-beam', beamCode(world, traceDeps, behind)) : Promise.resolve(null),
      hasCompute ? shader(device, 'march-vis', visCode(world, traceDeps, behind)) : Promise.resolve(null),
      hasCompute ? shader(device, 'march-vis-depth', visDepthCode(traceDeps)) : Promise.resolve(null),
      hasCompute && !behind ? shader(device, 'march-half-gbuf', halfGbufCode(traceDeps)) : Promise.resolve(null),
      hasCompute ? shader(device, 'march-patch-vel', patchVelocityCode(traceDeps)) : Promise.resolve(null),
    ])
    return { shadeMod, sunMod, beamMod, visMod, visDepthMod, halfGbufMod, patchVelMod }
  }

  const initMods = await buildModules()
  const sunMaps = new SunMaps(device, world.levels.length, [0.52, 0.62, 0.59])
  let maps = true
  const globals = device.createBuffer({ size: 144 + MAX_LEVELS * 128 + 192 + 512 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const looks = device.createBuffer({ size: EDITS_AT + EDITS * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(looks, 0, palette())
  device.queue.writeBuffer(looks, 256 * 16, materials())

  const F = GPUShaderStage.FRAGMENT
  const C = GPUShaderStage.COMPUTE

  // Explicit layouts so dead-code elimination from override constants never invalidates shared bind groups.
  const beamLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
    ],
  })
  const beamLayout1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    ],
  })
  const beamLayout = device.createPipelineLayout({ bindGroupLayouts: [beamLayout0, beamLayout1] })

  const visLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: C, buffer: {} },
    ],
  })
  const visLayout1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32uint' } },
      { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
    ],
  })
  const visLayout = device.createPipelineLayout({ bindGroupLayouts: [visLayout0, visLayout1] })

  const visDepthLayout0 = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: F, buffer: {} }],
  })
  const visDepthLayout1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, texture: { sampleType: 'uint' } },
      { binding: 2, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    ],
  })
  const visDepthLayout = device.createPipelineLayout({ bindGroupLayouts: [visDepthLayout0, visDepthLayout1] })

  const halfGbufLayout0 = device.createBindGroupLayout({
    label: 'march-half-gbuf-bgl0',
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, buffer: {} },
    ],
  })
  const halfGbufLayout1 = device.createBindGroupLayout({
    label: 'march-half-gbuf-bgl1',
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, texture: { sampleType: 'uint' } },
      { binding: 2, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    ],
  })
  const halfGbufLayout = device.createPipelineLayout({ bindGroupLayouts: [halfGbufLayout0, halfGbufLayout1] })

  const patchVelLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, buffer: {} },
      { binding: 2, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 3, visibility: F, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: F, texture: { sampleType: 'depth' } },
    ],
  })
  const patchVelLayout = device.createPipelineLayout({ bindGroupLayouts: [patchVelLayout0] })

  const shadeLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: F, buffer: {} },
      { binding: 4, visibility: F, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      { binding: 5, visibility: F, texture: {} },
      { binding: 6, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: F, buffer: {} },
    ],
  })
  const shadeLayout1 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: F, buffer: {} },
      { binding: 3, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 4, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 5, visibility: F, texture: { sampleType: 'unfilterable-float' } },
      { binding: 6, visibility: F, texture: { sampleType: 'unfilterable-float' } },
    ],
  })
  // @group(2): 512-light 3D frustum-clustered light buffers (matches lights.ts `clusterBindGroupLayout`).
  const shadeLayout2 = device.createBindGroupLayout({
    label: 'march-shade-cluster-bgl',
    entries: [
      { binding: 0, visibility: F | C, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F | C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F | C, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: F | C, buffer: { type: 'read-only-storage' } },
    ],
  })
  // @group(3): Dynamic-object directional shadows (bindings 0..2) + physically based Sky LUTs (bindings 3..7).
  const shadeLayout3 = device.createBindGroupLayout({
    label: 'march-shade-atmo-shadow-bgl',
    entries: [
      { binding: 0, visibility: F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 2, visibility: F, sampler: { type: 'comparison' } },
      { binding: 3, visibility: F, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 4, visibility: F, sampler: { type: 'filtering' } },
      { binding: 5, visibility: F, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 6, visibility: F, sampler: { type: 'filtering' } },
      { binding: 7, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const shadeLayout = device.createPipelineLayout({ bindGroupLayouts: [shadeLayout0, shadeLayout1, shadeLayout2, shadeLayout3] })

  const sunLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: F, buffer: {} },
      { binding: 1, visibility: F, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: F, buffer: { type: 'read-only-storage' } },
    ],
  })
  const sunLayout1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, buffer: {} }] })
  const sunLayout = device.createPipelineLayout({ bindGroupLayouts: [sunLayout0, sunLayout1] })

  // ── Compute pipeline caches (Pass 0 beam & Pass 1 vis) ──
  const visKeyOf = (mirrors: boolean, far: boolean, isUnder: boolean) =>
    `${(mirrors ? 1 : 0) | (far ? 2 : 0) | (isUnder ? 4 : 0)}`
  const visDesc = (mod: GPUShaderModule, mirrors: boolean, far: boolean, isUnder: boolean): GPUComputePipelineDescriptor => ({
    label: `march-vis${mirrors ? '' : ' plain'}${far ? ' far' : ''}${isUnder ? ' under' : ''}`,
    layout: visLayout,
    compute: {
      module: mod,
      entryPoint: 'cs_vis',
      constants: { MIRRORS: mirrors ? 1 : 0, FAR_MODEL: far ? 1 : 0, UNDERWATER: isUnder ? 1 : 0 },
    },
  })
  const makeBeamPipeline = (mod: GPUShaderModule | null) =>
    mod && hasCompute ? device.createComputePipelineAsync({ label: 'march-beam', layout: beamLayout, compute: { module: mod, entryPoint: 'cs_beam' } }) : Promise.resolve(null)
  const makeVisPipeline = (mod: GPUShaderModule | null, mirrors: boolean, far = false, isUnder = false) =>
    mod && hasCompute ? device.createComputePipelineAsync(visDesc(mod, mirrors, far, isUnder)) : Promise.resolve(null)
  const makeVisDepthPipeline = (mod: GPUShaderModule | null) =>
    mod && hasCompute
      ? device.createRenderPipelineAsync({
          label: 'march-vis-depth',
          layout: visDepthLayout,
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: { module: mod, entryPoint: 'fs_depth', targets: [{ format: VIS_NORMAL_FORMAT }] },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
        })
      : Promise.resolve(null)
  const makeHalfGbufPipeline = (mod: GPUShaderModule | null) =>
    mod && hasCompute
      ? device.createRenderPipelineAsync({
          label: 'march-half-gbuf',
          layout: halfGbufLayout,
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: {
            module: mod,
            entryPoint: 'fs_half_gbuf',
            targets: [
              { format: VIS_NORMAL_FORMAT },
              { format: VELOCITY_FORMAT },
              { format: 'rgba8unorm' },
            ],
          },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
        })
      : Promise.resolve(null)
  const makePatchVelPipeline = (mod: GPUShaderModule | null) =>
    mod && hasCompute
      ? device.createRenderPipelineAsync({
          label: 'march-patch-vel',
          layout: patchVelLayout,
          vertex: { module: mod, entryPoint: 'vs' },
          fragment: { module: mod, entryPoint: 'fs_patch_vel', targets: [{ format: VELOCITY_FORMAT }] },
        })
      : Promise.resolve(null)
  const makeSunUpdater = () =>
    hasCompute && SUN_COMPUTE_ON
      ? createComputeSunUpdater(device, {
          worldLayout: beamLayout0,
          traceWgsl: sunTraceWgsl(world, traceDeps),
          fineSun: !!world.options.fineSun,
          label: 'march-sun-compute',
        })
      : Promise.resolve<ComputeSunUpdater | null>(null)
  const makeVoxelizer = () =>
    hasCompute && !behind && GI_ON
      ? createWorldVoxelizer(
          device,
          world,
          { GLOBALS, sunlitText, LIT_LETTERS, EDITS },
          { globals, looks, sunMap: sunMaps.all },
        )
      : Promise.resolve<WorldVoxelizer | null>(null)

  const gtaoWanted = hasCompute && GTAO_ON && !behind
  let gtaoMax: [number, number] = [
    Math.max(16, Math.round(maxSize?.[0] ?? 1920)),
    Math.max(16, Math.round(maxSize?.[1] ?? 1080)),
  ]

  // ── Deferred Shade pipeline cache (Pass 2: no FAR_MODEL permutation needed!) ──
  const shadeKeyOf = (mirrors: boolean, foggy: boolean, night: boolean, isUnder: boolean, occ = false, targetFormat: GPUTextureFormat = format, readback = false, useGtao = false, useCluster = false, useGi = false, useRestir = false) =>
    `${targetFormat}:${readback ? 'rb:' : ''}${(mirrors ? 1 : 0) | (foggy ? 2 : 0) | (night ? 4 : 0) | (isUnder ? 8 : 0) | (occ ? 16 : 0) | (useGtao ? 32 : 0) | (useCluster ? 64 : 0) | (useGi ? 128 : 0) | (useRestir ? 256 : 0)}`
  const shadeLabel = (mirrors: boolean, foggy: boolean, night: boolean, isUnder: boolean, occ: boolean, targetFormat: GPUTextureFormat, readback: boolean, useGtao: boolean, useCluster: boolean, useGi: boolean, useRestir: boolean) => {
    if (!foggy && !night && !isUnder && !occ && !readback && !useCluster && !useGi && !useRestir && targetFormat === format) return `${mirrors ? 'march' : 'march without mirrors'}${useGtao ? ' gtao' : ''}`
    return `march${mirrors ? '' : ' without mirrors'}${foggy ? ' in fog' : ''}${night ? ' night' : ''}${isUnder ? ' under' : ''}${occ ? ' occ' : ''}${useGtao ? ' gtao' : ''}${useCluster ? ' cluster' : ''}${useGi ? ' gi' : ''}${useRestir ? ' restir' : ''}${readback ? ' readback' : ''} (${targetFormat})`
  }
  const shadeTargets = (mirrors: boolean, targetFormat: GPUTextureFormat, readback: boolean): GPUColorTargetState[] => {
    if (readback) return [{ format: targetFormat }]
    if (!hasCompute) return mirrors ? [{ format: targetFormat }, { format: PANES_FORMAT }] : [{ format: targetFormat }]
    return mirrors
      ? [{ format: targetFormat }, { format: VELOCITY_FORMAT }, { format: VIS_NORMAL_FORMAT }, { format: PANES_FORMAT }]
      : [{ format: targetFormat }, { format: VELOCITY_FORMAT }, { format: VIS_NORMAL_FORMAT }]
  }
  const shadeDesc = (mod: GPUShaderModule, mirrors: boolean, foggy = false, night = false, isUnder = false, occ = false, targetFormat: GPUTextureFormat = format, readback = false, useGtao = false, useCluster = false, useGi = false, useRestir = false): GPURenderPipelineDescriptor => ({
    label: shadeLabel(mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir),
    layout: shadeLayout,
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: {
      module: mod,
      entryPoint: 'fs',
      constants: {
        MIRRORS: mirrors && !isUnder ? 1 : 0,
        FOGGY: foggy ? 1 : 0,
        NIGHT: night ? 1 : 0,
        UNDERWATER: isUnder ? 1 : 0,
        LOCAL_OCCLUDE: occ ? 1 : 0,
        USE_GTAO: useGtao && !isUnder && !readback ? 1 : 0,
        USE_CLUSTER_LIGHTS: useCluster && night && !isUnder && !readback ? 1 : 0,
        USE_GI: useGi && !isUnder && !readback ? 1 : 0,
        USE_RESTIR: useRestir && night && !isUnder && !readback ? 1 : 0,
      },
      targets: shadeTargets(mirrors, targetFormat, readback),
    },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'always' },
  })
  const shadingAs = (mod: GPUShaderModule, mirrors: boolean, foggy = false, night = false, isUnder = false, occ = false, targetFormat: GPUTextureFormat = format, readback = false, useGtao = false, useCluster = false, useGi = false, useRestir = false) =>
    device.createRenderPipelineAsync(shadeDesc(mod, mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir))
  const shading = (mod: GPUShaderModule, defer = false, useGtao = gtaoWanted) => Promise.all([defer ? null : shadingAs(mod, true, false, false, false, false, format, false, useGtao), shadingAs(mod, false, false, false, false, false, format, false, useGtao)])
  const sunning = (mod: GPUShaderModule) => device.createRenderPipelineAsync({
    label: 'sun map',
    layout: sunLayout,
    vertex: { module: mod, entryPoint: 'vs' },
    fragment: { module: mod, entryPoint: 'fs_sun', targets: [{ format: 'r32float' }] },
  })

  const [[initMirrors, initPlain], initSun, initBeam, initVisPlain, initVisMirrors, initVisDepth, initHalfGbuf, initPatchVel, initSunUpdater, initGtao, initVoxelizer] = await Promise.all([
    shading(initMods.shadeMod, deferMirrors, gtaoWanted),
    sunning(initMods.sunMod),
    makeBeamPipeline(initMods.beamMod),
    makeVisPipeline(initMods.visMod, false, false, false),
    deferMirrors ? Promise.resolve(null) : makeVisPipeline(initMods.visMod, true, false, false),
    makeVisDepthPipeline(initMods.visDepthMod),
    makeHalfGbufPipeline(initMods.halfGbufMod),
    makePatchVelPipeline(initMods.patchVelMod),
    makeSunUpdater(),
    gtaoWanted ? createGtao(device, gtaoMax) : Promise.resolve<GtaoPass | null>(null),
    makeVoxelizer(),
  ])

  let shadeModNow = initMods.shadeMod
  let visModNow = initMods.visMod
  let beamPipeline = initBeam
  let sunPipeline = initSun
  const visDepthPipeline = initVisDepth
  const halfGbufPipeline = initHalfGbuf
  const patchVelPipeline = initPatchVel
  let sunUpdater: ComputeSunUpdater | null = initSunUpdater
  let gtaoPass: GtaoPass | null = initGtao
  let gtaoGrowing: Promise<void> | null = null
  const voxelizer: WorldVoxelizer | null = initVoxelizer
  let lastGtaoRan = false
  let lastGiRan = false
  let lastRestirRan = false

  // 1x1 fallbacks bound when GTAO, GI, or ReSTIR-DI are disabled or unavailable.
  const gtaoFallbackTex = device.createTexture({ label: 'march-gtao-fallback', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: gtaoFallbackTex }, new Uint16Array([0x3c00, 0x7bff, 0, 0]), { bytesPerRow: 8 }, [1, 1])
  const gtaoFallbackView = gtaoFallbackTex.createView()

  const zeroHalfTex = device.createTexture({ label: 'march-moonshot-fallback', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: zeroHalfTex }, new Uint16Array([0, 0, 0, 0]), { bytesPerRow: 8 }, [1, 1])
  const zeroHalfView = zeroHalfTex.createView()

  const whiteAlbedoTex = device.createTexture({ label: 'march-restir-white-albedo', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
  device.queue.writeTexture({ texture: whiteAlbedoTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1])
  const whiteAlbedoView = whiteAlbedoTex.createView()

  // 1x1 zero depth32float fallback bound when farModel has no depth texture (e.g. Town).
  const emptyFarDepthTex = device.createTexture({ label: 'march-far-depth-empty', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
  const emptyFarDepthView = emptyFarDepthTex.createView()
  {
    const clearEnc = device.createCommandEncoder()
    clearEnc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: emptyFarDepthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end()
    device.queue.submit([clearEnc.finish()])
  }
  let patchVelBind: GPUBindGroup | null = null
  let patchVelVis1: GPUTextureView | null = null
  let patchVelDepth: GPUTextureView | null = null
  let patchVelFar: GPUTextureView | null = null

  const visPipelines = new Map<string, GPUComputePipeline>()
  if (initVisPlain) visPipelines.set(visKeyOf(false, false, false), initVisPlain)
  if (initVisMirrors) visPipelines.set(visKeyOf(true, false, false), initVisMirrors)
  const visMaking = new Map<string, Promise<unknown>>()

  const shadePipelines = new Map<string, GPURenderPipeline>([[shadeKeyOf(false, false, false, false, false, format, false, gtaoWanted), initPlain]])
  if (initMirrors) shadePipelines.set(shadeKeyOf(true, false, false, false, false, format, false, gtaoWanted), initMirrors)
  const shadeMaking = new Map<string, Promise<unknown>>()
  let mirrorsStarted = !deferMirrors
  let mirrorsReady = !deferMirrors

  const warmVis = (mirrors: boolean, far: boolean, isUnder: boolean) => {
    if (!hasCompute || !visModNow) return
    const k = visKeyOf(mirrors, far, isUnder)
    if (visPipelines.has(k) || visMaking.has(k)) return
    const of = visModNow
    const p = makeVisPipeline(of, mirrors, far, isUnder).then(
      (ready) => { if (ready && of === visModNow) visPipelines.set(k, ready) },
      (error: unknown) => { console.error('The vis compute pipeline could not be compiled', error) },
    ).finally(() => { if (visMaking.get(k) === p) visMaking.delete(k) })
    visMaking.set(k, p)
  }
  const requireVisPipeline = (mirrors: boolean, far: boolean, isUnder: boolean) => {
    const k = visKeyOf(mirrors, far, isUnder)
    let p = visPipelines.get(k)
    if (!p && visModNow) {
      p = device.createComputePipeline(visDesc(visModNow, mirrors, far, isUnder))
      visPipelines.set(k, p)
    }
    return p!
  }

  const warmShade = (mirrors: boolean, foggy: boolean, night: boolean, isUnder: boolean, occ = false, onReady?: () => void, targetFormat: GPUTextureFormat = format, readback = false, useGtao = gtaoPass !== null, useCluster = false, useGi = false, useRestir = false) => {
    const k = shadeKeyOf(mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir)
    if (shadePipelines.has(k) || shadeMaking.has(k)) return
    const of = shadeModNow
    const p = shadingAs(of, mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir).then(
      (ready) => { if (of === shadeModNow) { shadePipelines.set(k, ready); onReady?.() } },
      (error: unknown) => { console.error('The march pipeline could not be compiled', error) },
    ).finally(() => { if (shadeMaking.get(k) === p) shadeMaking.delete(k) })
    shadeMaking.set(k, p)
  }
  // Background-warm the daytime blast/local-light and daytime GI mirrors variants so boot and explosions never hitch.
  if (initMirrors && !behind) {
    warmShade(true, false, true, false, true, undefined, format, false, gtaoWanted, false, false, false)
    if (GI_ON) warmShade(true, false, false, false, false, undefined, format, false, gtaoWanted, false, true, false)
  }
  const requireShadePipeline = (mirrors: boolean, foggy: boolean, night: boolean, isUnder: boolean, occ = false, targetFormat: GPUTextureFormat = format, readback = false, useGtao = false, useCluster = false, useGi = false, useRestir = false) => {
    const k = shadeKeyOf(mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir)
    let p = shadePipelines.get(k)
    if (!p) {
      p = device.createRenderPipeline(shadeDesc(shadeModNow, mirrors, foggy, night, isUnder, occ, targetFormat, readback, useGtao, useCluster, useGi, useRestir))
      shadePipelines.set(k, p)
    }
    return p
  }

  // ── Persistent grow-only Visibility, Beam & Half-Res G-Buffer textures (0 reallocs across steer scale changes!) ──
  const traceParams = device.createBuffer({ label: 'march-trace-params', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const shadeExtra = device.createBuffer({ label: 'march-shade-extra', size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const traceParamsRaw = new ArrayBuffer(64)
  const traceParamsU32 = new Uint32Array(traceParamsRaw)
  const traceParamsF32 = new Float32Array(traceParamsRaw)
  const shadeExtraBuf = new Float32Array(48)

  let visAllocW = 0, visAllocH = 0
  let halfAllocW = 0, halfAllocH = 0
  let beamTex: GPUTexture | null = null, beamView: GPUTextureView
  let vis0Tex: GPUTexture | null = null, vis0View: GPUTextureView
  let vis1Tex: GPUTexture | null = null, vis1View: GPUTextureView
  let halfDepthTex: GPUTexture | null = null, halfDepthView: GPUTextureView
  let halfGeomTex: GPUTexture | null = null, halfGeomView: GPUTextureView
  let halfVelTex: GPUTexture | null = null, halfVelView: GPUTextureView
  let halfMatTex: GPUTexture | null = null, halfMatView: GPUTextureView
  let beamBind1: GPUBindGroup | null = null
  let visBind1: GPUBindGroup | null = null
  let visDepthBind1: GPUBindGroup | null = null
  let halfGbufBind1: GPUBindGroup | null = null
  let shadeBind1: GPUBindGroup | null = null
  let boundGiView: GPUTextureView = zeroHalfView
  let boundRestirView: GPUTextureView = zeroHalfView

  const rebuildShadeBind1 = () => {
    if (!vis0View || !vis1View) return
    shadeBind1 = device.createBindGroup({
      layout: shadeLayout1,
      entries: [
        { binding: 0, resource: vis0View },
        { binding: 1, resource: vis1View },
        { binding: 2, resource: { buffer: shadeExtra } },
        { binding: 3, resource: gtaoPass?.view ?? gtaoFallbackView },
        { binding: 4, resource: boundGiView },
        { binding: 5, resource: boundRestirView },
        { binding: 6, resource: halfGeomView ?? zeroHalfView },
      ],
    })
  }

  const ensureGtaoSize = (needW: number, needH: number) => {
    if (!gtaoWanted || gtaoGrowing || (needW <= gtaoMax[0] && needH <= gtaoMax[1])) return
    const nextMax: [number, number] = [Math.max(gtaoMax[0], needW), Math.max(gtaoMax[1], needH)]
    gtaoGrowing = createGtao(device, nextMax).then(
      (nextPass) => {
        gtaoPass?.destroy()
        gtaoPass = nextPass
        gtaoMax = nextMax
        rebuildShadeBind1()
      },
      (error: unknown) => { console.error('GTAO resize failed', error) },
    ).finally(() => { gtaoGrowing = null })
  }

  const ensureVisTextures = (w: number, h: number) => {
    const needW = Math.max(1, w), needH = Math.max(1, h)
    if (needW <= visAllocW && needH <= visAllocH && beamTex && vis0Tex && vis1Tex && halfDepthTex && halfGeomTex && halfVelTex && halfMatTex) return
    visAllocW = Math.max(visAllocW, needW)
    visAllocH = Math.max(visAllocH, needH)
    const bw = Math.max(1, Math.ceil(visAllocW / 4))
    const bh = Math.max(1, Math.ceil(visAllocH / 4))
    halfAllocW = Math.max(1, (visAllocW + 1) >> 1)
    halfAllocH = Math.max(1, (visAllocH + 1) >> 1)
    beamTex?.destroy()
    vis0Tex?.destroy()
    vis1Tex?.destroy()
    halfDepthTex?.destroy()
    halfGeomTex?.destroy()
    halfVelTex?.destroy()
    halfMatTex?.destroy()
    beamTex = device.createTexture({ label: 'march-beam', size: [bw, bh], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    vis0Tex = device.createTexture({ label: 'march-vis0', size: [visAllocW, visAllocH], format: 'rgba32uint', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    vis1Tex = device.createTexture({ label: 'march-vis1', size: [visAllocW, visAllocH], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
    halfDepthTex = device.createTexture({ label: 'march-half-depth', size: [halfAllocW, halfAllocH], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    halfGeomTex = device.createTexture({ label: 'march-half-geom', size: [halfAllocW, halfAllocH], format: VIS_NORMAL_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    halfVelTex = device.createTexture({ label: 'march-half-vel', size: [halfAllocW, halfAllocH], format: VELOCITY_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    halfMatTex = device.createTexture({ label: 'march-half-mat', size: [halfAllocW, halfAllocH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    beamView = beamTex.createView()
    vis0View = vis0Tex.createView()
    vis1View = vis1Tex.createView()
    halfDepthView = halfDepthTex.createView()
    halfGeomView = halfGeomTex.createView()
    halfVelView = halfVelTex.createView()
    halfMatView = halfMatTex.createView()
    beamBind1 = device.createBindGroup({
      layout: beamLayout1,
      entries: [{ binding: 0, resource: { buffer: traceParams } }, { binding: 1, resource: beamView }],
    })
    visBind1 = device.createBindGroup({
      layout: visLayout1,
      entries: [
        { binding: 0, resource: { buffer: traceParams } },
        { binding: 1, resource: beamView },
        { binding: 2, resource: vis0View },
        { binding: 3, resource: vis1View },
      ],
    })
    visDepthBind1 = device.createBindGroup({
      layout: visDepthLayout1,
      entries: [
        { binding: 0, resource: { buffer: traceParams } },
        { binding: 1, resource: vis0View },
        { binding: 2, resource: vis1View },
      ],
    })
    halfGbufBind1 = device.createBindGroup({
      layout: halfGbufLayout1,
      entries: [
        { binding: 0, resource: { buffer: shadeExtra } },
        { binding: 1, resource: vis0View },
        { binding: 2, resource: vis1View },
      ],
    })
    rebuildShadeBind1()
  }
  ensureVisTextures(1, 1)

  // Per-allocSize MRT auxiliary cache (panes + velocity + visNormal): matches exact target attachment dimensions
  // while causing 0 reallocs on dynamic resolution scaling (`steer`), since `to.allocSize` is grow-only.
  const auxKept = new Map<string, TargetAux>()
  const auxFor = (size: readonly [number, number]): TargetAux => {
    const w = Math.max(1, size[0]), h = Math.max(1, size[1])
    const key = `${w}x${h}`
    let a = auxKept.get(key)
    if (!a) {
      if (auxKept.size >= 4) {
        const [oldest, gone] = auxKept.entries().next().value!
        gone.panes.destroy()
        gone.velocity.destroy()
        gone.visNormal.destroy()
        auxKept.delete(oldest)
      }
      const panes = device.createTexture({ label: 'march-panes', size: [w, h], format: PANES_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      const velocity = device.createTexture({ label: 'march-velocity', size: [w, h], format: VELOCITY_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      const visNormal = device.createTexture({ label: 'march-vis-normal', size: [w, h], format: VIS_NORMAL_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      a = { panes, panesView: panes.createView(), velocity, velocityView: velocity.createView(), visNormal, visNormalView: visNormal.createView() }
      auxKept.set(key, a)
    }
    return a
  }
  let lastAux = auxFor([1, 1])
  let glassReady = true
  const panesWritten = new WeakSet<GPUTexture>()
  const panesView = (size: readonly [number, number]) => auxFor(size).panesView

  // ── Shared Buffers & Bind Groups ──
  const screenTexture = device.createTexture({ label: 'window screen', size: [...SCREEN_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT })
  const screen = { texture: screenTexture, view: screenTexture.createView(), up: 0, moon: 0, sky: false, rect: [0, 0, 1, 1] as [number, number, number, number] }
  let marksBuffer = device.createBuffer({ label: 'marks', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const localLights = createLocalLights(device)

  // Lightweight fallback bindings for @group(2) (clustered lights) and @group(3) (dynamic shadows + sky LUTs)
  // so standalone marchers (portal / ?flag=0) validate cleanly with zero per-frame allocations.
  const clusterFallbackParams = device.createBuffer({ label: 'march-cluster-fallback-params', size: 112, usage: GPUBufferUsage.UNIFORM })
  const clusterFallbackLights = device.createBuffer({ label: 'march-cluster-fallback-lights', size: 64, usage: GPUBufferUsage.STORAGE })
  const clusterFallbackGrid = device.createBuffer({ label: 'march-cluster-fallback-grid', size: 16, usage: GPUBufferUsage.STORAGE })
  const clusterFallbackIndices = device.createBuffer({ label: 'march-cluster-fallback-indices', size: 16, usage: GPUBufferUsage.STORAGE })
  const clusterFallbackBind = device.createBindGroup({
    label: 'march-cluster-fallback-bg',
    layout: shadeLayout2,
    entries: [
      { binding: 0, resource: { buffer: clusterFallbackParams } },
      { binding: 1, resource: { buffer: clusterFallbackLights } },
      { binding: 2, resource: { buffer: clusterFallbackGrid } },
      { binding: 3, resource: { buffer: clusterFallbackIndices } },
    ],
  })

  const dynShadowFallbackUniform = device.createBuffer({ label: 'march-dynshadow-fallback-u', size: 176, usage: GPUBufferUsage.UNIFORM })
  const dynShadowFallbackTex = device.createTexture({
    label: 'march-dynshadow-fallback-tex',
    size: [1, 1, 2],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const dynShadowFallbackView = dynShadowFallbackTex.createView({ dimension: '2d-array', arrayLayerCount: 2 })
  {
    const enc = device.createCommandEncoder({ label: 'march-dynshadow-fallback-clear' })
    for (let layer = 0; layer < 2; layer++) {
      enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: {
          view: dynShadowFallbackTex.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      }).end()
    }
    device.queue.submit([enc.finish()])
  }
  const dynShadowFallbackCmp = device.createSampler({ label: 'march-dynshadow-fallback-cmp', compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' })
  const skyViewFallbackTex = device.createTexture({ label: 'march-skyview-fallback', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING })
  const skyViewFallbackView = skyViewFallbackTex.createView()
  const skyAerialFallbackTex = device.createTexture({ label: 'march-skyaerial-fallback', dimension: '3d', size: [1, 1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING })
  const skyAerialFallbackView = skyAerialFallbackTex.createView({ dimension: '3d' })
  const skyFallbackLinear = device.createSampler({ label: 'march-sky-fallback-samp', magFilter: 'linear', minFilter: 'linear' })
  const skyShFallbackBuf = device.createBuffer({ label: 'march-skysh-fallback', size: 9 * 16, usage: GPUBufferUsage.STORAGE })

  let extDynShadows: DynamicShadows | null = null
  let extSkyLut: SkyLut | null = null
  let extGi: VoxelGIPass | null = null
  let extRestir: RestirDIPass | null = null
  const giSunIrrBuf: [number, number, number] = [0, 0, 0]
  const giSkyZenithBuf: [number, number, number] = [0, 0, 0]
  const giSkyHorizonBuf: [number, number, number] = [0, 0, 0]
  const giSkyGroundBuf: [number, number, number] = [0, 0, 0]
  const giSkyObj: { zenith: [number, number, number]; horizon: [number, number, number]; ground: [number, number, number]; sunGlow: number } = {
    zenith: giSkyZenithBuf,
    horizon: giSkyHorizonBuf,
    ground: giSkyGroundBuf,
    sunGlow: 0,
  }
  const restirJitterBuf: [number, number] = [0, 0]
  const makeShadeBind3 = () => device.createBindGroup({
    label: 'march-shade-atmo-shadow-bg',
    layout: shadeLayout3,
    entries: [
      { binding: 0, resource: { buffer: extDynShadows?.uniformBuffer ?? dynShadowFallbackUniform } },
      { binding: 1, resource: extDynShadows?.shadowTextureView ?? dynShadowFallbackView },
      { binding: 2, resource: extDynShadows?.compareSampler ?? dynShadowFallbackCmp },
      { binding: 3, resource: extSkyLut?.skyView ?? skyViewFallbackView },
      { binding: 4, resource: extSkyLut?.skyViewSampler ?? skyFallbackLinear },
      { binding: 5, resource: extSkyLut?.aerialView ?? skyAerialFallbackView },
      { binding: 6, resource: extSkyLut?.clampSampler ?? skyFallbackLinear },
      { binding: 7, resource: { buffer: extSkyLut?.shBuffer ?? skyShFallbackBuf } },
    ],
  })
  let shadeBind3 = makeShadeBind3()
  let cachedClusterBg: GPUBindGroup | null = null
  let cachedClusterRef: GPUBuffer | null = null
  const resolveShadeBind2 = () => {
    const c = localLights.clustered
    if (!c) return clusterFallbackBind
    if (cachedClusterRef !== c.paramsBuffer || !cachedClusterBg) {
      cachedClusterRef = c.paramsBuffer
      cachedClusterBg = device.createBindGroup({
        label: 'march-shade-cluster-bg',
        layout: shadeLayout2,
        entries: [
          { binding: 0, resource: { buffer: c.paramsBuffer } },
          { binding: 1, resource: { buffer: c.lightsBuffer } },
          { binding: 2, resource: { buffer: c.clusterGridBuffer } },
          { binding: 3, resource: { buffer: c.lightIndexBuffer } },
        ],
      })
    }
    return cachedClusterBg
  }

  const makeBeamBind0 = () => device.createBindGroup({
    layout: beamLayout0,
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }],
  })
  const makeVisBind0 = () => device.createBindGroup({
    layout: visLayout0,
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }, { binding: 3, resource: { buffer: looks } }],
  })
  const makeShadeBind0 = () => device.createBindGroup({
    layout: shadeLayout0,
    entries: [
      { binding: 0, resource: { buffer: globals } },
      { binding: 1, resource: { buffer: world.poolBuffer } },
      { binding: 2, resource: { buffer: world.topBuffer } },
      { binding: 3, resource: { buffer: looks } },
      { binding: 4, resource: sunMaps.all },
      { binding: 5, resource: screen.view },
      { binding: 6, resource: { buffer: marksBuffer } },
      { binding: 7, resource: { buffer: localLights.buffer } },
    ],
  })
  const makeSunBind0 = () => device.createBindGroup({
    layout: sunLayout0,
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: world.poolBuffer } }, { binding: 2, resource: { buffer: world.topBuffer } }],
  })

  let beamBind0 = makeBeamBind0()
  let visBind0 = makeVisBind0()
  let shadeBind0 = makeShadeBind0()
  let sunBind0 = makeSunBind0()
  const visDepthBind0 = device.createBindGroup({
    layout: visDepthLayout0,
    entries: [{ binding: 0, resource: { buffer: globals } }],
  })
  const halfGbufBind0 = device.createBindGroup({
    label: 'march-half-gbuf-bg0',
    layout: halfGbufLayout0,
    entries: [{ binding: 0, resource: { buffer: globals } }, { binding: 1, resource: { buffer: looks } }],
  })
  const sunTiles = Array.from({ length: SUN_TILES_A_FRAME + 1 }, () => {
    const buffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    return { buffer, bind: device.createBindGroup({ layout: sunLayout1, entries: [{ binding: 0, resource: { buffer } }] }) }
  })

  const block = new ArrayBuffer(144 + MAX_LEVELS * 128 + 192 + 512 + 16), f = new Float32Array(block), u = new Uint32Array(block), i32 = new Int32Array(block)
  const lightsNow = () => Math.max(1 - ((t) => t * t * (3 - 2 * t))(Math.max(0, Math.min(1, (day - 0.55) / 0.4))), 0.7 * rain, 0.45 * fog, 0.25 * cloud)
  const colours = () => {
    type Colour = readonly [number, number, number]
    const mix = (a: Colour, b: Colour, t: number): Colour => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
    const times = (c: Colour, k: number): Colour => [c[0] * k, c[1] * k, c[2] * k]
    const hour = (night: Colour, noon: Colour, dusk: Colour) => mix(night, mix(noon, dusk, low), day)
    const [sx, , sz] = sunMaps.s, flat = Math.hypot(sx, sz) || 1, white: Colour = [1, 1, 1], dark: Colour = [0.03, 0.045, 0.085], cloudy: Colour = [0.035, 0.045, 0.075]
    const overcast = Math.max(rain, cloud, 0.2 * fog)
    const some = 0.42 + 0.58 * day, grey = times([0.4, 0.43, 0.48], some), wet = (c: Colour, by = 0.85) => mix(c, grey, overcast * by)
    const fill = (c: Colour): Colour => world.options.surveyedWalls ? mix(c, times(white, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]), 0.55) : c
    f.set([
      ...times(mix(times([0.45, 0.58, 0.9], 0.26 * moon.light), times(mix([0.8, 0.74, 0.64], [1, 0.52, 0.26], low), 1 - 0.45 * low), day), 1 - 0.8 * overcast), day * (1 - 0.5 * low) * (1 - 0.6 * overcast),
      ...fill(wet(times(mix([0.19, 0.28, 0.5], [0.3, 0.26, 0.4], low), some), 0.7)), some,
      ...wet(hour([0.006, 0.01, 0.03], [0.07, 0.22, 0.62], [0.07, 0.11, 0.36])), 0.42 + 0.18 * low,
      ...wet(hour(dark, [0.5, 0.66, 0.88], [0.62, 0.4, 0.46])), 1.1 * low * day * (1 - overcast),
      ...wet(hour(dark, [0.5, 0.66, 0.88], [1.25, 0.5, 0.1])), sx / flat,
      ...times(hour(cloudy, white, [0.4, 0.26, 0.4]), 1 - 0.5 * overcast), sz / flat,
      ...times(hour(cloudy, white, [1.5, 0.66, 0.22]), 1 - 0.5 * overcast), (30 - 18 * low) * (1 - overcast),
      rain, rain, lightsNow(), roofed,
    ], 36 + MAX_LEVELS * 32)
    const s = (144 + MAX_LEVELS * 128 + 128) / 4
    const lit = mix(mix([0.8, 0.82, 0.85], [0.95, 0.72, 0.6], low), [0.6, 0.62, 0.66], Math.max(rain, cloud) * 0.8)
    f.set(mix([0.07, 0.065, 0.075], times(lit, 0.9), Math.min(1, day * 1.15)), s + 12)
    if (air.sky && day > 0.5 && !rain) {
      const own = Math.min(1, (day - 0.5) / 0.4)
      for (const [at, colour] of [[44, air.sky.zenith], [48, air.sky.horizon], [52, air.sky.horizon]] as const) { const i = at + MAX_LEVELS * 32; for (let k = 0; k < 3; k++) f[i + k] += (colour[k] - f[i + k]) * own }
    }
  }

  let farMap = [0, 0, 1, 0]
  let farWedge: readonly number[] | null = null
  let farKeep: readonly number[] | null = null
  let farEdits: readonly (readonly number[])[] = []
  let lit: Float32Array | null = new Float32Array((2 + 2 * LIT_LETTERS) * 4)
  const farBuf = new Float32Array(4), wedgeBuf = new Float32Array(8), keepBuf = new Float32Array(8), editsBuf = new Float32Array(EDITS * 8)
  const litBuf = new Float32Array((2 + 2 * LIT_LETTERS) * 4)

  // Zero-GC previous frame camera pose for analytic motion vectors (prevViewProj relative to current anchor).
  let hasPrevView = false
  const prevEye: [number, number, number] = [0, 0, 0]
  const prevFwd: [number, number, number] = [0, 0, -1]
  const prevRight: [number, number, number] = [1, 0, 0]
  const prevUp: [number, number, number] = [0, 1, 0]
  const prevEyeRel: [number, number, number] = [0, 0, 0]
  const prevCam = { eye: prevEyeRel, forward: prevFwd, right: prevRight, up: prevUp, tanHalf: 1 }
  let prevAspect = 1

  const tell = (view: View, size: readonly [number, number], flags: number, time: number, starts?: readonly [number, number, number, number]) => {
    const anchor = view.eye.map((v) => Math.floor(v / SIDE) * SIDE)
    if (farMap[3] > 0) {
      farBuf[0] = farMap[0] - anchor[0]; farBuf[1] = farMap[1] - anchor[2]; farBuf[2] = farMap[2]; farBuf[3] = farMap[3]
      device.queue.writeBuffer(looks, 256 * 16 + 16 * 32, farBuf)
    }
    if (farWedge) {
      wedgeBuf[0] = farWedge[0] - anchor[0]; wedgeBuf[1] = farWedge[1] - anchor[2]
      wedgeBuf[2] = farWedge[2]; wedgeBuf[3] = farWedge[3]; wedgeBuf[4] = farWedge[4]; wedgeBuf[5] = farWedge[5]
      wedgeBuf[6] = 0; wedgeBuf[7] = 0
    } else wedgeBuf.fill(0)
    device.queue.writeBuffer(looks, 256 * 16 + 16 * 32 + 16 + 512, wedgeBuf)
    if (lit) {
      for (let i = 0; i < lit.length; i += 4) {
        litBuf[i] = lit[i] - anchor[0]; litBuf[i + 1] = lit[i + 1] - anchor[1]; litBuf[i + 2] = lit[i + 2] - anchor[2]; litBuf[i + 3] = lit[i + 3]
      }
      device.queue.writeBuffer(looks, 256 * 16 + 16 * 32 + 16 + 512 + 64, litBuf.subarray(0, lit.length))
    }
    if (farKeep) {
      keepBuf[0] = farKeep[0] - anchor[0]; keepBuf[1] = farKeep[1] - anchor[1]; keepBuf[2] = farKeep[2] - anchor[2]; keepBuf[3] = 0
      keepBuf[4] = farKeep[3] - anchor[0]; keepBuf[5] = farKeep[4] - anchor[1]; keepBuf[6] = farKeep[5] - anchor[2]; keepBuf[7] = 1
    } else keepBuf.fill(0)
    device.queue.writeBuffer(looks, 256 * 16 + 16 * 32 + 16 + 512 + 32, keepBuf)
    editsBuf.fill(0)
    const nEdits = Math.min(farEdits.length, EDITS)
    for (let i = 0; i < nEdits; i++) {
      const b = farEdits[i], o = i * 8
      editsBuf[o] = b[0] - anchor[0]; editsBuf[o + 1] = b[1] - anchor[1]; editsBuf[o + 2] = b[2] - anchor[2]; editsBuf[o + 3] = 0
      editsBuf[o + 4] = b[3] - anchor[0]; editsBuf[o + 5] = b[4] - anchor[1]; editsBuf[o + 6] = b[5] - anchor[2]; editsBuf[o + 7] = 1
    }
    device.queue.writeBuffer(looks, EDITS_AT, editsBuf)
    f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf], 0)
    f.set([...view.right, size[0] / size[1]], 4)
    f.set([...view.up, time], 8)
    f.set(view.forward, 12)
    u[15] = world.levels.length
    f.set(sunMaps.s, 16)
    u[19] = flags | (under ? UNDER : 0)
    f.set(size, 20)
    u[22] = 384
    f[23] = -anchor[1]
    f[24] = (2 * view.tanHalf) / size[1]
    f[25] = detail
    f[26] = day
    f[27] = low
    f.set(sunMaps.u, 28)
    f[31] = sunMaps.s[0] * anchor[0] + sunMaps.s[1] * anchor[1] + sunMaps.s[2] * anchor[2]
    f.set(sunMaps.v, 32)
    u[35] = maps ? 1 : 0
    world.levels.forEach((level, k) => {
      const told = sunMaps.tell(k, anchor as [number, number, number]), sunAt = 36 + MAX_LEVELS * 20 + k * 12
      f.set(told.base, sunAt)
      u.set(told.drawn, sunAt + 4)
      const at = 36 + k * 20, cell = 1 << k, { low, high } = level.whole
      for (let a = 0; a < 3; a++) {
        f[at + a] = low[a] * SIDE * cell - anchor[a]
        f[at + 4 + a] = (high[a] - low[a]) * SIDE
        u[at + 8 + a] = ((low[a] % grid[a]) + grid[a]) % grid[a]
        i32[at + 12 + a] = low[a] * SIDE
      }
      f[at + 3] = 1 / cell
      f[at + 7] = level.roof - anchor[1]
      for (let q = 0; q < 4; q++) f[at + 16 + q] = level.roofs[q] - anchor[1]
    })
    const s = (144 + MAX_LEVELS * 128 + 128) / 4
    if (starts) f.set([starts[0], starts[1], starts[2], starts[3] - starts[0] * anchor[0] - starts[1] * anchor[1] - starts[2] * anchor[2]], s); else f.fill(0, s, s + 4)
    f.set([air.haze, air.clouds, screen.up, screen.moon], s + 4)
    f.set([fog * FOG_THICK, FOG_TOP, front - anchor[0], anchor[0]], s + 8)
    f[s + 15] = anchor[2]
    for (let i = 0; i < 8; i++) {
      const b = beacons[i], at = s + 16 + i * 16
      if (!b) { f.fill(0, at, at + 16); continue }
      f.set([b.at[0] - anchor[0], b.at[1] - anchor[1], b.at[2] - anchor[2], b.night[2], b.night[0], b.night[1], b.night[3], b.night[8], b.night[4], b.night[5], b.night[6], b.night[7], b.night[9], b.night[10], b.night[11], b.reach], at)
    }
    f.set([...moon.sun, moon.disc], s + 16 + 8 * 16)
    device.queue.writeBuffer(globals, 0, block)
    return anchor as [number, number, number]
  }

  let detail = 1, day = 1, low = 0, under = false, rain = 0, roofed = 0, cloud = 0, fog = 0, front = 0
  let air: Air = { haze: 1, clouds: 1 }
  let beacons: readonly Beacon[] = []
  let moon: Moon = WHOLE_MOON
  colours()

  // One pixel to ask what is under a point (always 4-byte rgba8unorm for exact integer bit-packing readback).
  const pickFormat: GPUTextureFormat = 'rgba8unorm'
  const pointTexture = device.createTexture({ size: [1, 1], format: pickFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
  const point: Target = { color: pointTexture.createView(), depth: device.createTexture({ size: [1, 1], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView(), size: [1, 1], format: pickFormat }
  const pointRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const once = async (view: View, plain: boolean) => {
    const encoder = device.createCommandEncoder()
    self.draw(encoder, point, { ...view, tanHalf: 0.0001 }, PICK | CELLS | (plain ? PLAIN : 0), 0)
    encoder.copyTextureToBuffer({ texture: pointTexture }, { buffer: pointRead }, [1, 1])
    device.queue.submit([encoder.finish()])
    await pointRead.mapAsync(GPUMapMode.READ)
    const b = new Uint8Array(pointRead.getMappedRange().slice(0, 4))
    pointRead.unmap()
    const v = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)
    const material = (v >>> 20) & 15
    return material ? { t: (v & 0xfffff) / 8, material, colour: v >>> 24 } : null
  }
  let picking: Promise<unknown> = Promise.resolve()

  const self: Marcher = {
    get rain() { return rain },
    set rain(v: number) { rain = Math.max(0, Math.min(1, v)); colours() },
    get cloud() { return cloud },
    set cloud(v: number) { cloud = Math.max(0, Math.min(1, v)); colours() },
    get fog() { return fog },
    set fog(v: number) { fog = Math.max(0, Math.min(1, v)); colours() },
    get front() { return front },
    set front(v: number) { front = v },
    get under() { return under },
    set under(v: boolean) { under = v },
    get roofed() { return roofed },
    set roofed(v: number) { if (v !== roofed) { roofed = v; colours() } },
    get detail() { return detail },
    set detail(v: number) { detail = v },
    get day() { return day },
    get moon() { return moon },
    set moon(m: Moon) { if (m.disc !== moon.disc || m.light !== moon.light || m.sun.some((v, i) => v !== moon.sun[i])) { moon = m; colours() } },
    light(sun, isDay, isLow) {
      sunMaps.turn(sun); day = isDay; low = isLow; colours()
      if (lightsNow() > 0) {
        const wantOcc = localLights.count > 0 && localLights.stats.quality === 'high'
        warmShade(false, false, true, under, false)
        if (wantOcc) warmShade(false, false, true, under, true)
        if (mirrorsStarted || mirrorsReady) {
          warmShade(true, false, true, under, false, () => { mirrorsReady = true })
          if (wantOcc) warmShade(true, false, true, under, true, () => { mirrorsReady = true })
        }
        if (extGi && voxelizer) {
          warmShade(true, false, true, under, wantOcc, undefined, format, false, gtaoPass !== null, true, true, extRestir !== null)
        }
      }
    },
    get air() { return air },
    set air(a: Air) { air = a; colours() },
    get beacons() { return beacons },
    set beacons(b: readonly Beacon[]) { beacons = [...b].sort((p, q) => (q.night[7] > 0 ? 1 : 0) - (p.night[7] > 0 ? 1 : 0)).slice(0, 8) },
    screen,
    pick(view, plain = false) {
      const next = picking.then(() => once(view, plain))
      picking = next.catch(() => {})
      return next
    },
    get glassReady() { return glassReady },
    get gtaoRan() { return lastGtaoRan },
    get giRan() { return lastGiRan },
    get restirRan() { return lastRestirRan },
    get worldBindGroupLayout() { return beamLayout0 },
    get restirOcclusionWgsl() { return restirOcclusionWgsl(world, traceDeps) },
    get gtaoStats() { return gtaoPass?.stats() ?? null },
    get sunComputeStats() { return sunUpdater?.stats() ?? null },
    get sun() { return sunMaps },
    get looks() { return looks },
    get globals() { return globals },
    get localLights() { return localLights },
    panes: panesView,
    get velocityView() { return lastAux.velocityView },
    get visNormalView() { return lastAux.visNormalView },
    get vis0View() { return vis0View },
    get vis1View() { return vis1View },
    get maps() { return maps },
    set maps(v: boolean) { maps = v },
    setExternalPasses(ext) {
      let changedBind3 = false
      if (ext.dynShadows !== undefined && ext.dynShadows !== extDynShadows) {
        extDynShadows = ext.dynShadows ?? null
        changedBind3 = true
      }
      if (ext.skyLut !== undefined && ext.skyLut !== extSkyLut) {
        extSkyLut = ext.skyLut ?? null
        changedBind3 = true
      }
      if (changedBind3) shadeBind3 = makeShadeBind3()
      let changedBind1 = false
      if (ext.gi !== undefined && ext.gi !== extGi) {
        extGi = ext.gi ?? null
        boundGiView = extGi?.giView ?? zeroHalfView
        changedBind1 = true
        if (extGi && voxelizer && !behind) {
          warmShade(true, false, false, under, false, undefined, format, false, gtaoPass !== null, false, true, false)
        }
      }
      if (ext.restir !== undefined && ext.restir !== extRestir) {
        extRestir = ext.restir ?? null
        boundRestirView = extRestir?.outputView ?? zeroHalfView
        changedBind1 = true
        if (extRestir && !behind && lightsNow() > 0) {
          warmShade(true, false, true, under, true, undefined, format, false, gtaoPass !== null, true, Boolean(extGi && voxelizer), true)
        }
      }
      if (changedBind1) rebuildShadeBind1()
    },
    patchVelocity(encoder, to, farDepth = null) {
      if (!patchVelPipeline || !vis1View) return
      const [w, h] = to.size
      if (w < 1 || h < 1) return
      const farV = farDepth ?? emptyFarDepthView
      if (!patchVelBind || patchVelVis1 !== vis1View || patchVelDepth !== to.depth || patchVelFar !== farV) {
        patchVelVis1 = vis1View
        patchVelDepth = to.depth
        patchVelFar = farV
        patchVelBind = device.createBindGroup({
          label: 'march-patch-vel',
          layout: patchVelLayout0,
          entries: [
            { binding: 0, resource: { buffer: globals } },
            { binding: 1, resource: { buffer: shadeExtra } },
            { binding: 2, resource: vis1View },
            { binding: 3, resource: to.depth },
            { binding: 4, resource: farV },
          ],
        })
      }
      const pass = encoder.beginRenderPass({
        label: 'march-patch-vel',
        colorAttachments: [{ view: lastAux.velocityView, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setViewport?.(0, 0, w, h, 0, 1)
      pass.setScissorRect?.(0, 0, w, h)
      pass.setPipeline(patchVelPipeline)
      pass.setBindGroup(0, patchVelBind)
      pass.draw(3)
      pass.end()
    },
    tend(encoder, view, ready, most = SUN_TILES_A_FRAME, timing) {
      const useCompute = sunUpdater !== null && typeof encoder.beginComputePass === 'function'
      const anchor = tell(view, [1, 1], 0, 0), tiles = sunMaps.plan(view.eye, Math.min(useCompute ? MAX_SUN_TILES : SUN_TILES_A_FRAME, most), ready)
      if (!tiles.length) return 0
      if (useCompute) {
        return sunUpdater!.dispatch(encoder, prepareSunTiles(tiles, sunMaps, anchor), sunMaps.all, beamBind0, timing)
      }
      tiles.forEach((tile, i) => {
        const { buffer, bind: tileBind } = sunTiles[i], corner = sunMaps.corner(tile, anchor), tileBlock = new ArrayBuffer(32)
        new Float32Array(tileBlock).set([corner[0], corner[1], 1 << tile.level, 0, tile.slotX * SUN_TILE, tile.slotY * SUN_TILE])
        new Uint32Array(tileBlock)[3] = tile.level
        device.queue.writeBuffer(buffer, 0, tileBlock)
        const first = timing && i === 0, last = timing && i === tiles.length - 1
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: sunMaps.layers[tile.level], loadOp: 'load', storeOp: 'store' }], ...(first || last ? { timestampWrites: { querySet: timing!.querySet, ...(first ? { beginningOfPassWriteIndex: timing!.begin } : {}), ...(last ? { endOfPassWriteIndex: timing!.end } : {}) } } : {}) })
        pass.setPipeline(sunPipeline)
        pass.setBindGroup(0, sunBind0)
        pass.setBindGroup(1, tileBind)
        pass.setViewport(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE, 0, 1)
        pass.setScissorRect(tile.slotX * SUN_TILE, tile.slotY * SUN_TILE, SUN_TILE, SUN_TILE)
        pass.draw(3)
        pass.end()
      })
      return tiles.length
    },
    rebind() {
      beamBind0 = makeBeamBind0()
      visBind0 = makeVisBind0()
      shadeBind0 = makeShadeBind0()
      sunBind0 = makeSunBind0()
      voxelizer?.rebind()
    },
    marks(bytes) {
      const words = marksGrid(bytes)
      if (!words) return -1
      marksBuffer.destroy()
      marksBuffer = device.createBuffer({ label: 'marks', size: Math.max(32, words.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(marksBuffer, 0, words)
      shadeBind0 = makeShadeBind0()
      return words.length > 8 ? words[7] : 0
    },
    letters(data) { lit = data ?? new Float32Array((2 + 2 * LIT_LETTERS) * 4) },
    get lights() { return lightsNow() },
    farCover(corner, size, reach, held, wedge = null, keep = null, edits = []) {
      farMap = [corner[0] * size, corner[1] * size, size, reach]
      farWedge = wedge
      farKeep = keep
      farEdits = edits
      device.queue.writeBuffer(looks, 256 * 16 + 16 * 32 + 16, held.subarray(0, 128))
      if (reach > 0) {
        warmVis(false, true, under)
        if (mirrorsStarted || mirrorsReady) warmVis(true, true, under)
        const hasLocal = localLights.count > 0
        const wantNight = lightsNow() > 0 || screen.up > 0 || hasLocal
        const wantOcc = wantNight && hasLocal && localLights.stats.quality === 'high'
        warmShade(false, false, wantNight, under, wantOcc)
        if (mirrorsStarted || mirrorsReady) warmShade(true, false, wantNight, under, wantOcc, () => { mirrorsReady = true })
      }
    },
    async reshade(change) {
      const began = performance.now()
      const nextMods = await buildModules(change)
      const compiled = performance.now() - began
      const useGtaoDefault = gtaoPass !== null
      const [[nextMirrors, nextPlain], nextSun, nextBeam, nextVisPlain, nextVisMirrors, nextSunUpdater] = await Promise.all([
        shading(nextMods.shadeMod, false, useGtaoDefault),
        sunning(nextMods.sunMod),
        makeBeamPipeline(nextMods.beamMod),
        makeVisPipeline(nextMods.visMod, false, false, false),
        makeVisPipeline(nextMods.visMod, true, false, false),
        makeSunUpdater(),
      ])
      shadeModNow = nextMods.shadeMod
      visModNow = nextMods.visMod
      beamPipeline = nextBeam
      sunPipeline = nextSun
      if (nextSunUpdater) { sunUpdater?.destroy(); sunUpdater = nextSunUpdater }
      visPipelines.clear()
      visMaking.clear()
      if (nextVisPlain) visPipelines.set(visKeyOf(false, false, false), nextVisPlain)
      if (nextVisMirrors) visPipelines.set(visKeyOf(true, false, false), nextVisMirrors)
      shadePipelines.clear()
      shadeMaking.clear()
      shadePipelines.set(shadeKeyOf(false, false, false, false, false, format, false, useGtaoDefault), nextPlain)
      if (nextMirrors) shadePipelines.set(shadeKeyOf(true, false, false, false, false, format, false, useGtaoDefault), nextMirrors)
      mirrorsStarted = true
      mirrorsReady = true
      beamBind0 = makeBeamBind0()
      visBind0 = makeVisBind0()
      shadeBind0 = makeShadeBind0()
      sunBind0 = makeSunBind0()
      return { compiled, ms: performance.now() - began }
    },
    draw(encoder, to, view, flags, time, timing, only, starts, extra) {
      const anchor = tell(view, to.size, flags, time, starts)
      const isReadback = (flags & (PICK | COUNT)) !== 0
      const targetFormat: GPUTextureFormat = to.format ?? (isReadback ? pickFormat : format)
      const wantsMirrors = !isReadback && (flags & MIRRORS) !== 0
      const wantsCluster = !isReadback && Boolean(extra?.clusterActive) && localLights.clustered !== null
      const hasLocal = localLights.count > 0 || (wantsCluster && localLights.clusterCount > 0)
      const wantNight = !isReadback && (lightsNow() > 0 || screen.up > 0 || hasLocal)
      const wantUnder = !isReadback && (under || (flags & UNDER) !== 0)
      const wantFar = !wantUnder && farMap[3] > 0
      const wantFog = !isReadback && !wantUnder && fog > 0 && !extra?.froxelFogActive
      const wantOcc = !wantUnder && wantNight && hasLocal && localLights.stats.quality === 'high'
      const wantClusterShade = wantNight && !wantUnder && wantsCluster

      // Async pre-warm underwater vis + shade pipelines when approaching sea level (< 12 m) so splashing in never stalls.
      if (!isReadback && !wantUnder && view.eye[1] < 120) {
        warmVis(false, false, true)
        warmShade(false, false, wantNight, true, false, undefined, targetFormat, false, false, false)
      }

      const allocSize = to.allocSize ?? to.size
      const w = Math.max(1, to.size[0]), h = Math.max(1, to.size[1])
      const runCompute = hasCompute && typeof encoder.beginComputePass === 'function'

      let runGtao = false
      if (runCompute && gtaoPass && visDepthPipeline && !isReadback && !wantUnder && !only && (flags & SHADOWS) !== 0 && (flags & (FLAT | HEAT | COUNT | PICK)) === 0 && w >= 16 && h >= 16) {
        if (allocSize[0] <= gtaoMax[0] && allocSize[1] <= gtaoMax[1]) runGtao = true
        else ensureGtaoSize(allocSize[0], allocSize[1])
      }
      // Reuse the leaner USE_GTAO=1 pipeline (which dead-code-eliminates openness()) when shadows are off or FLAT is set.
      const shadeUseGtao = !isReadback && !wantUnder && (runGtao || (gtaoPass !== null && !only && ((flags & SHADOWS) === 0 || (flags & FLAT) !== 0)))

      const runGi = Boolean(
        runCompute && extGi && voxelizer && halfGbufPipeline
        && extra?.giActive
        && !isReadback && !wantUnder && !only
        && (flags & SHADOWS) !== 0
        && (flags & (FLAT | HEAT | COUNT | PICK | PLAIN)) === 0
        && w >= 16 && h >= 16,
      )
      const runRestir = Boolean(
        runCompute && extRestir && halfGbufPipeline
        && extra?.restirActive
        && wantNight && wantsCluster && localLights.clusterCount > 0
        && !isReadback && !wantUnder && !only
        && (flags & (HEAT | COUNT | PICK | PLAIN)) === 0
        && w >= 16 && h >= 16,
      )

      // Select active vis + shade pipelines with non-blocking async warming so FAR_MODEL / MIRRORS / NIGHT / LOCAL_OCCLUDE / CLUSTER / GI / RESTIR
      // transitions never stall the main thread with synchronous Metal compilation.
      let useFar = wantFar
      if (runCompute && wantFar && !visPipelines.has(visKeyOf(false, true, wantUnder)) && !visPipelines.has(visKeyOf(true, true, wantUnder))) {
        warmVis(false, true, wantUnder)
        if (wantsMirrors) warmVis(true, true, wantUnder)
        if (visPipelines.has(visKeyOf(false, false, wantUnder))) useFar = false
      }

      let mirrors = false
      let useNight = wantNight
      let useOcc = wantOcc
      let useCluster = wantClusterShade
      let useGi = runGi
      let useRestir = runRestir
      if (wantsMirrors && !wantUnder) {
        const visMirrorsReady = !runCompute || visPipelines.has(visKeyOf(true, useFar, wantUnder))
        if (!visMirrorsReady) warmVis(true, useFar, wantUnder)
        const wantMirrorFog = wantFog && shadePipelines.has(shadeKeyOf(true, true, wantNight, wantUnder, wantOcc, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir))
        if (visMirrorsReady && shadePipelines.has(shadeKeyOf(true, wantMirrorFog, wantNight, wantUnder, wantOcc, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir))) {
          mirrors = true
          mirrorsReady = true
        } else if (visMirrorsReady && wantOcc && shadePipelines.has(shadeKeyOf(true, false, wantNight, wantUnder, false, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir))) {
          mirrors = true
          useOcc = false
          warmShade(true, false, wantNight, wantUnder, true, undefined, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir)
        } else if (visMirrorsReady && (runGi || runRestir) && shadePipelines.has(shadeKeyOf(true, false, wantNight, wantUnder, wantOcc, targetFormat, false, shadeUseGtao, wantClusterShade, false, false))) {
          // Keep transparent glass alive while the GI/ReSTIR mirrors permutation warms in the background.
          mirrors = true
          useGi = false
          useRestir = false
          warmShade(true, false, wantNight, wantUnder, wantOcc, () => { mirrorsReady = true }, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir)
        } else if (visMirrorsReady && wantNight && lightsNow() === 0 && screen.up === 0 && shadePipelines.has(shadeKeyOf(true, false, false, wantUnder, false, targetFormat, false, shadeUseGtao, false, runGi, false))) {
          // Transient daytime local light (e.g. a blast): keep transparent glass alive while the night+mirrors variant warms in the background.
          mirrors = true
          useNight = false
          useOcc = false
          useCluster = false
          useRestir = false
          warmShade(true, false, true, wantUnder, wantOcc, () => { mirrorsReady = true }, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir)
        } else {
          mirrorsStarted = true
          warmShade(true, false, wantNight, wantUnder, wantOcc, () => { mirrorsReady = true }, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir)
          if (wantFog) warmShade(true, true, wantNight, wantUnder, wantOcc, () => { mirrorsReady = true }, targetFormat, false, shadeUseGtao, wantClusterShade, runGi, runRestir)
        }
      }
      if (!mirrors && useOcc && !shadePipelines.has(shadeKeyOf(false, false, useNight, wantUnder, true, targetFormat, false, shadeUseGtao, useCluster, useGi, useRestir))) {
        warmShade(false, false, useNight, wantUnder, true, undefined, targetFormat, false, shadeUseGtao, useCluster, useGi, useRestir)
        if (shadePipelines.has(shadeKeyOf(false, false, useNight, wantUnder, false, targetFormat, false, shadeUseGtao, useCluster, useGi, useRestir))) {
          useOcc = false
        }
      }
      let useFog = false
      if (wantFog) {
        if (shadePipelines.has(shadeKeyOf(mirrors, true, useNight, wantUnder, useOcc, targetFormat, false, shadeUseGtao, useCluster, useGi, useRestir))) useFog = true
        else warmShade(mirrors, true, useNight, wantUnder, useOcc, undefined, targetFormat, false, shadeUseGtao, useCluster, useGi, useRestir)
      }
      const activeShade = requireShadePipeline(mirrors, useFog, useNight, wantUnder, useOcc, targetFormat, isReadback, shadeUseGtao, useCluster, useGi, useRestir)

      const aux = isReadback ? lastAux : auxFor(allocSize)
      if (!isReadback) lastAux = aux
      const jx = isReadback ? 0 : (extra?.jitter?.[0] ?? 0)
      const jy = isReadback ? 0 : (extra?.jitter?.[1] ?? 0)
      const aoW = runGtao ? Math.max(1, (w + 1) >> 1) : 1
      const aoH = runGtao ? Math.max(1, (h + 1) >> 1) : 1
      const halfW = Math.max(1, (w + 1) >> 1)
      const halfH = Math.max(1, (h + 1) >> 1)

      if (extra?.resetHistory) hasPrevView = false

      // Upload previous-frame unjittered viewProjection relative to CURRENT anchor + jitter + GTAO + GI/ReSTIR metadata
      // BEFORE Pass 1.5 so both `fs_half_gbuf` and Pass 2 `march-shade` share one exact upload with zero extra copies.
      if (!isReadback && hasPrevView) {
        prevEyeRel[0] = prevEye[0] - anchor[0]
        prevEyeRel[1] = prevEye[1] - anchor[1]
        prevEyeRel[2] = prevEye[2] - anchor[2]
        const vp = viewProjection(prevCam, prevAspect, NEAR, FAR)
        shadeExtraBuf.set(vp, 0)
        shadeExtraBuf[16] = 1
        shadeExtraBuf[17] = w
        shadeExtraBuf[18] = h
        shadeExtraBuf[19] = 0
      } else {
        shadeExtraBuf.fill(0)
        shadeExtraBuf[17] = w
        shadeExtraBuf[18] = h
      }
      shadeExtraBuf[20] = jx
      shadeExtraBuf[21] = jy
      shadeExtraBuf[22] = 0
      shadeExtraBuf[23] = 0
      shadeExtraBuf[24] = aoW
      shadeExtraBuf[25] = aoH
      shadeExtraBuf[26] = runGtao ? 1 : 0
      shadeExtraBuf[27] = 0
      // Atmosphere, volumetric clouds, dynamic shadows, cluster shading & anchor metadata (floats 28..43).
      const physSun = extra?.skySunDir ?? sunMaps.s
      const skyLutBlend = !isReadback && extSkyLut ? Math.max(0, Math.min(1, extra?.skyLutBlend ?? 0)) : 0
      shadeExtraBuf[28] = skyLutBlend
      shadeExtraBuf[29] = !isReadback && extra?.volCloudsActive ? 1 : 0
      shadeExtraBuf[30] = !isReadback && extDynShadows && extra?.dynShadowActive ? 1 : 0
      shadeExtraBuf[31] = useCluster ? 1 : 0
      shadeExtraBuf[32] = physSun[0]
      shadeExtraBuf[33] = physSun[1]
      shadeExtraBuf[34] = physSun[2]
      shadeExtraBuf[35] = extra?.skyExposure ?? 0.68
      shadeExtraBuf[36] = extra?.skyOvercast ?? 0
      shadeExtraBuf[37] = extra?.aerialStrength ?? 0
      shadeExtraBuf[38] = extra?.camAltKm ?? Math.max(0.005, view.eye[1] * 0.0001)
      shadeExtraBuf[39] = extra?.dayFade ?? day
      shadeExtraBuf[40] = anchor[0]
      shadeExtraBuf[41] = anchor[1]
      shadeExtraBuf[42] = anchor[2]
      shadeExtraBuf[43] = 0
      // Moonshot half-res G-Buffer dims, GI gain, and ReSTIR-DI active flag (floats 44..47).
      shadeExtraBuf[44] = halfW
      shadeExtraBuf[45] = halfH
      shadeExtraBuf[46] = useGi ? (extra?.giGain ?? 0.88) : 0
      shadeExtraBuf[47] = useRestir ? 1 : 0
      device.queue.writeBuffer(shadeExtra, 0, shadeExtraBuf)

      lastGiRan = false
      lastRestirRan = false

      if (runCompute) {
        ensureVisTextures(allocSize[0], allocSize[1])
        const ox = only ? only[0] : 0
        const oy = only ? only[1] : 0
        const ow = only ? only[2] : w
        const oh = only ? only[3] : h
        const beamW = Math.max(1, Math.ceil(w / 4))
        const beamH = Math.max(1, Math.ceil(h / 4))
        const useBeam = BEAM_ON
          && (flags & (PLAIN | PICK | HEAT | COUNT | UNDER)) === 0
          && !under
          && w >= 16 && h >= 16
          && beamPipeline !== null
        const bx0 = Math.max(0, Math.floor(ox / 4) - 1)
        const by0 = Math.max(0, Math.floor(oy / 4) - 1)
        const bx1 = Math.min(beamW, Math.ceil((ox + ow) / 4) + 1)
        const by1 = Math.min(beamH, Math.ceil((oy + oh) / 4) + 1)

        traceParamsU32[0] = ox; traceParamsU32[1] = oy; traceParamsU32[2] = ow; traceParamsU32[3] = oh
        traceParamsU32[4] = bx0; traceParamsU32[5] = by0; traceParamsU32[6] = bx1; traceParamsU32[7] = by1
        traceParamsU32[8] = beamW; traceParamsU32[9] = beamH; traceParamsU32[10] = useBeam ? 1 : 0; traceParamsU32[11] = 0
        traceParamsF32[12] = jx; traceParamsF32[13] = jy; traceParamsF32[14] = 0; traceParamsF32[15] = 0
        device.queue.writeBuffer(traceParams, 0, traceParamsRaw)

        // Pass 0: 1/4-res conservative cone beam pre-pass.
        if (useBeam && beamPipeline && beamBind1) {
          const beamPass = encoder.beginComputePass({
            label: 'march-beam',
            ...(timing?.beginningOfPassWriteIndex !== undefined ? { timestampWrites: { querySet: timing.querySet, beginningOfPassWriteIndex: timing.beginningOfPassWriteIndex } } : {}),
          })
          beamPass.setPipeline(beamPipeline)
          beamPass.setBindGroup(0, beamBind0)
          beamPass.setBindGroup(1, beamBind1)
          beamPass.dispatchWorkgroups(Math.ceil((bx1 - bx0) / 8), Math.ceil((by1 - by0) / 8), 1)
          beamPass.end()
        }

        // Pass 1: Full-res compute primary geometry + glass visibility pass (vis0/vis1).
        const visMirrors = mirrors && !wantUnder
        const activeVis = requireVisPipeline(visMirrors, useFar, wantUnder)
        if (visBind1) {
          const visPass = encoder.beginComputePass({
            label: 'march-vis',
            ...(!useBeam && timing?.beginningOfPassWriteIndex !== undefined ? { timestampWrites: { querySet: timing.querySet, beginningOfPassWriteIndex: timing.beginningOfPassWriteIndex } } : {}),
          })
          visPass.setPipeline(activeVis)
          visPass.setBindGroup(0, visBind0)
          visPass.setBindGroup(1, visBind1)
          visPass.dispatchWorkgroups(Math.ceil(ow / 8), Math.ceil(oh / 8), 1)
          visPass.end()
        }

        // Pass 1.5a: Lightweight depth + normal pre-pass -> half-res compute GTAO between Pass 1 and Pass 2 (retires ~3 ms openness()).
        if (runGtao && gtaoPass && visDepthPipeline && visDepthBind1) {
          const depthPass = encoder.beginRenderPass({
            label: 'march-vis-depth',
            colorAttachments: [{ view: aux.visNormalView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
            depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
          })
          depthPass.setViewport?.(0, 0, w, h, 0, 1)
          depthPass.setScissorRect?.(0, 0, w, h)
          depthPass.setPipeline(visDepthPipeline)
          depthPass.setBindGroup(0, visDepthBind0)
          depthPass.setBindGroup(1, visDepthBind1)
          depthPass.draw(3)
          depthPass.end()

          gtaoPass.dispatch(encoder, {
            depth: to.depth,
            normal: aux.visNormalView,
            normalSpace: 'world',
            normalEncoding: 'snorm',
            renderSize: [w, h],
            allocSize,
            projParams: {
              tanHalfFovY: view.tanHalf,
              aspect: w / h,
              near: NEAR,
              far: FAR,
              right: view.right,
              up: view.up,
              forward: view.forward,
            },
            radius: 12.0,
            power: 1.35,
            falloffRange: 0.55,
            maxScreenRadius: 96,
            slices: 2,
            steps: 3,
            frameIndex: extra?.gtaoFrame ?? 0,
            halfRes: true,
            timestampWrites: extra?.gtaoTiming,
          })
          lastGtaoRan = true
        } else {
          lastGtaoRan = false
        }

        // Pass 1.5b: Shared half-res G-Buffer (depth24plus, normal+linZ, velocity, rough/metal/wet) for live GI & ReSTIR-DI.
        if ((runGi || runRestir) && halfGbufPipeline && halfGbufBind1) {
          const hgPass = encoder.beginRenderPass({
            label: 'march-half-gbuf',
            colorAttachments: [
              { view: halfGeomView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
              { view: halfVelView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
              { view: halfMatView, loadOp: 'clear', storeOp: 'store', clearValue: [0.9, 0, 0, 0] },
            ],
            depthStencilAttachment: { view: halfDepthView, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
          })
          hgPass.setViewport?.(0, 0, halfW, halfH, 0, 1)
          hgPass.setScissorRect?.(0, 0, halfW, halfH)
          hgPass.setPipeline(halfGbufPipeline)
          hgPass.setBindGroup(0, halfGbufBind0)
          hgPass.setBindGroup(1, halfGbufBind1)
          hgPass.draw(3)
          hgPass.end()

          let bind1Dirty = false

          // Pass 1.5c: Live Voxel-Native 3D Clipmap Radiance Cache GI + SVGF Denoiser.
          if (runGi && extGi && voxelizer) {
            const lb = 36 + MAX_LEVELS * 32
            // Physically balanced sun-to-sky cache ratio so sunlit streets, brick, and blasted rubble
            // flood warm multi-bounce GI indoors & into shaded facades while sealed rooms stay dark (0 * 7.4 = 0).
            giSunIrrBuf[0] = f[lb] * 7.4
            giSunIrrBuf[1] = f[lb + 1] * 7.4
            giSunIrrBuf[2] = f[lb + 2] * 7.4
            giSkyZenithBuf[0] = f[lb + 4] * 1.10
            giSkyZenithBuf[1] = f[lb + 5] * 1.10
            giSkyZenithBuf[2] = f[lb + 6] * 1.10
            const hDay = day
            giSkyHorizonBuf[0] = ((f[lb + 4] * 0.65 + f[lb + 12] * 0.35 * 1.08) * hDay + f[lb + 4] * (1 - hDay)) * 1.04
            giSkyHorizonBuf[1] = ((f[lb + 5] * 0.65 + f[lb + 13] * 0.35 * 0.98) * hDay + f[lb + 5] * (1 - hDay)) * 1.04
            giSkyHorizonBuf[2] = ((f[lb + 6] * 0.65 + f[lb + 14] * 0.35 * 0.84) * hDay + f[lb + 6] * (1 - hDay)) * 1.04
            giSkyGroundBuf[0] = 0.28 * 1.08 * f[lb + 7]
            giSkyGroundBuf[1] = 0.28 * 0.98 * f[lb + 7]
            giSkyGroundBuf[2] = 0.28 * 0.86 * f[lb + 7]
            giSkyObj.sunGlow = 0.14 * hDay * (1 - Math.max(rain, cloud))

            const giForceFull = Boolean(extra?.giForceFull || extra?.giReset)
            const giStride = giForceFull ? 1 : (extra?.giAmortizeStride ?? 8)
            const sources = voxelizer.voxelize(encoder, {
              cameraPosCells: view.eye,
              anchor,
              dark: lightsNow(),
              day,
              flames: extra?.giFlames,
              amortizeStride: giStride,
              forceFull: giForceFull,
              beginTimestamp: extra?.giTiming?.cascadeBegin,
            })
            extGi.inject(
              encoder,
              {
                cameraPosCells: view.eye,
                cascadeSources: sources,
                sunDir: sunMaps.s,
                sunIrradiance: giSunIrrBuf,
                sky: giSkyObj,
                bounceFeedback: 0.85,
                amortizeStride: giStride,
                gatherRays: giForceFull ? 8 : 6,
                reset: Boolean(extra?.giReset),
              },
              extra?.giTiming?.cascadeEnd ? { all: extra.giTiming.cascadeEnd } : undefined,
            )
            const giOut = extGi.traceAndDenoise(
              encoder,
              {
                depth: halfDepthView,
                normal: halfGeomView,
                velocity: halfVelView,
                renderSize: [halfW, halfH],
                allocSize: [halfAllocW, halfAllocH],
                camera: {
                  eye: view.eye,
                  forward: view.forward,
                  right: view.right,
                  up: view.up,
                  tanHalf: view.tanHalf,
                  aspect: w / h,
                  near: NEAR,
                  far: FAR,
                },
                sunDir: sunMaps.s,
                sky: giSkyObj,
                spp: 1,
                atrousPasses: 3,
                reset: Boolean(extra?.giReset || extra?.giSvgfReset),
              },
              extra?.giTiming && (extra.giTiming.trace || extra.giTiming.svgfBegin || extra.giTiming.svgfEnd)
                ? {
                    trace: extra.giTiming.trace,
                    temporal: extra.giTiming.svgfBegin,
                    atrous: extra.giTiming.svgfEnd,
                  }
                : undefined,
            )
            if (giOut !== boundGiView) {
              boundGiView = giOut
              bind1Dirty = true
            }
            lastGiRan = true
          }

          // Pass 1.5d: Live ReSTIR-DI Stochastic Local-Light Shadow Resampling with 64-tree voxel occlusion.
          if (runRestir && extRestir && localLights.clustered) {
            const c = localLights.clustered
            restirJitterBuf[0] = jx * 0.5 - 0.25
            restirJitterBuf[1] = jy * 0.5 - 0.25
            const restirOut = extRestir.dispatch(
              encoder,
              {
                depth: halfDepthView,
                normal: halfGeomView,
                albedo: whiteAlbedoView,
                material: halfMatView,
                velocity: halfVelView,
                lightsBuffer: c.lightsBuffer,
                lightCount: localLights.clusterCount,
                cluster: {
                  gridBuffer: c.clusterGridBuffer,
                  indexBuffer: c.lightIndexBuffer,
                  indexPoolCapacity: c.indexPoolCapacity,
                },
                occlusionBindGroup: beamBind0,
                camera: {
                  eye: view.eye,
                  forward: view.forward,
                  right: view.right,
                  up: view.up,
                  tanHalf: view.tanHalf,
                  aspect: w / h,
                  near: NEAR,
                  far: FAR,
                  jitter: restirJitterBuf,
                },
                renderSize: [halfW, halfH],
                anchor,
                wetness: rain,
                shadowBias: 3.0,
                initialCandidates: 12,
                maxTemporalM: 20,
                spatialNeighbors: 3,
                spatialRadius: 10,
                reset: Boolean(extra?.restirReset),
                frameIndex: extra?.restirFrame,
              },
              extra?.restirTiming
                ? {
                    ris: extra.restirTiming.begin,
                    spatialShade: extra.restirTiming.end,
                  }
                : undefined,
            )
            if (restirOut !== boundRestirView) {
              boundRestirView = restirOut
              bind1Dirty = true
            }
            lastRestirRan = true
          }

          if (bind1Dirty) rebuildShadeBind1()
        }
      } else {
        lastGtaoRan = false
      }

      glassReady = !wantsMirrors || mirrors
      if (!isReadback) {
        if (mirrors) panesWritten.add(aux.panes)
        else if (panesWritten.has(aux.panes)) {
          encoder.beginRenderPass({ colorAttachments: [{ view: aux.panesView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end()
          panesWritten.delete(aux.panes)
        }
      }

      const colorAttachments: GPURenderPassColorAttachment[] = isReadback
        ? [{ view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }]
        : !hasCompute
          ? [
              { view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
              ...(mirrors ? [{ view: aux.panesView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const] : []),
            ]
          : [
              { view: to.color, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
              { view: aux.velocityView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
              { view: aux.visNormalView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
              ...(mirrors ? [{ view: aux.panesView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const] : []),
            ]

      // Pass 2: Deferred shading, reflections, sky, depth, world normals, and analytic motion vectors.
      const passTiming: GPURenderPassTimestampWrites | undefined = timing
        ? runCompute
          ? timing.endOfPassWriteIndex !== undefined
            ? { querySet: timing.querySet, endOfPassWriteIndex: timing.endOfPassWriteIndex }
            : undefined
          : timing
        : undefined
      const pass = encoder.beginRenderPass({
        colorAttachments,
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
        ...(passTiming ? { timestampWrites: passTiming } : {}),
      })
      pass.setViewport?.(0, 0, w, h, 0, 1)
      if (only) pass.setScissorRect?.(only[0], only[1], only[2], only[3])
      else pass.setScissorRect?.(0, 0, w, h)
      pass.setPipeline(activeShade)
      pass.setBindGroup(0, shadeBind0)
      if (shadeBind1) pass.setBindGroup(1, shadeBind1)
      pass.setBindGroup(2, resolveShadeBind2())
      pass.setBindGroup(3, shadeBind3)
      pass.draw(3)
      pass.end()

      if (!isReadback) {
        prevEye[0] = view.eye[0]; prevEye[1] = view.eye[1]; prevEye[2] = view.eye[2]
        prevFwd[0] = view.forward[0]; prevFwd[1] = view.forward[1]; prevFwd[2] = view.forward[2]
        prevRight[0] = view.right[0]; prevRight[1] = view.right[1]; prevRight[2] = view.right[2]
        prevUp[0] = view.up[0]; prevUp[1] = view.up[1]; prevUp[2] = view.up[2]
        prevCam.tanHalf = view.tanHalf
        prevAspect = w / h
        hasPrevView = true
      }
    },
  }
  return self
}
