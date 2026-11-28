// Toroidal camera-wrapped instanced grass blades & wildflowers (#226).
//
// Ported from Small Magic (MIT) `src/grass.js` into Voxelwright's 10 cm voxel world (`M = 10`).
// Maintains a rolling 128x128 local terrain patch (5 cells = 0.5 m per texel, 64 m x 64 m window
// centered on the camera) with toroidal texel addressing:
//   - heightTex (`r32float`): ground surface height Y in world cells
//   - maskTex   (`rgba8unorm`):
//       R = grass presence (`(worldKind(x, y - 1, z) & 15) === 3`)
//       G = burnt / ash (0..1, written by `scorch`)
//       B = ember heat  (0..1, written by `scorch`, cools over time)
//       A = flattened   (0..1, written by `flatten`)
//
// Renders a fixed instanced pool of 24,000 3-segment tapered grass blades and 3,000 multi-petal
// wildflowers wrapped toroidally around `view.eye.xz` in the WGSL vertex shader, reading sun-map
// shadows (`SUNLIT`), wind gusts, blast/cleave shockwave flattening rings, player push, burnt-to-ash
// glowing ember tips, and backlit sun translucency.
import { DEPTH, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, MAX_LEVELS, SUNLIT, type Marcher, type View } from './march.ts'

export const PATCH_TEXELS = 128
export const CELLS_PER_TEXEL = 5 // 0.5 m per texel
export const PATCH_CELLS = PATCH_TEXELS * CELLS_PER_TEXEL // 640 cells = 64 m
export const TILE_CELLS = 512 // 51.2 m toroidal blade tile (strictly inside 64 m terrain patch)
export const GRASS_COUNT = 24000
export const FLOWER_COUNT = 3000
const GRASS_SEGS = 3
const GLOBALS_BYTES = 144 + MAX_LEVELS * 128 + 192 + 512 + 16

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeSeeds(count: number, seed: number): Float32Array<ArrayBuffer> {
  const R = mulberry32(seed)
  const out = new Float32Array(new ArrayBuffer(count * 4 * 4))
  for (let i = 0; i < count * 4; i++) out[i] = R()
  return out
}

function buildBladeMesh(segs: number): { positions: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const verts: number[] = []
  for (let j = 0; j < segs; j++) {
    const t = j / segs
    verts.push(-1, t, 0, 1, t, 0)
  }
  verts.push(0, 1, 0)
  const idx: number[] = []
  for (let j = 0; j < segs - 1; j++) {
    const a = j * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const topBase = (segs - 1) * 2
  idx.push(topBase, topBase + 1, topBase + 2)
  const positions = new Float32Array(new ArrayBuffer(verts.length * 4))
  positions.set(verts)
  const indices = new Uint16Array(new ArrayBuffer(idx.length * 2))
  indices.set(idx)
  return { positions, indices }
}

function buildStemMesh(): { positions: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const positions = new Float32Array(new ArrayBuffer(15 * 4))
  positions.set([-1, 0, 0, 1, 0, 0, -1, 0.5, 0, 1, 0.5, 0, 0, 1, 0])
  const indices = new Uint16Array(new ArrayBuffer(9 * 2))
  indices.set([0, 1, 2, 1, 3, 2, 2, 3, 4])
  return { positions, indices }
}

function buildQuadMesh(): { positions: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const positions = new Float32Array(new ArrayBuffer(12 * 4))
  positions.set([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
  const indices = new Uint16Array(new ArrayBuffer(6 * 2))
  indices.set([0, 1, 2, 0, 2, 3])
  return { positions, indices }
}

const GRASS_COMMON_WGSL = /* wgsl */ `
struct GrassU {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, clock: f32,
  forward: vec3f, day: f32,
  sun: vec3f, hasWorld: f32,
  wind: vec4f,         // dirX, dirZ, strength, pad
  shock: vec4f,        // centerX (anchor-rel), centerZ (anchor-rel), radius (cells), strength
  pushPos: vec4f,      // posX (anchor-rel), posZ (anchor-rel), radius (cells), strength
  patchInfo: vec4f,    // originRelX (cells), originRelZ (cells), anchorModX (texels), anchorModZ (texels)
  patchTex: vec4f,     // originTx (i32 as f32), originTz (i32 as f32), anchorY (cells), pad
}
@group(0) @binding(0) var<uniform> u: GrassU;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var maskTex: texture_2d<f32>;
${GLOBALS}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
${SUNLIT}

const NEAR_Z = ${NEAR.toFixed(1)};
const FAR_Z = ${FAR.toFixed(1)};
const TILE_SIZE = ${TILE_CELLS.toFixed(1)};
const TEXEL_CELLS = ${CELLS_PER_TEXEL.toFixed(1)};
const PATCH_DIM = ${PATCH_TEXELS};
const PATCH_MASK = ${PATCH_TEXELS - 1};
const PATCH_SPAN = ${PATCH_CELLS.toFixed(1)};

fn gHash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn gNoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(gHash2(i), gHash2(i + vec2f(1.0, 0.0)), e.x),
    mix(gHash2(i + vec2f(0.0, 1.0)), gHash2(i + vec2f(1.0, 1.0)), e.x),
    e.y
  );
}

struct GroundTap {
  heightY: f32,
  mask: vec4f,
  inside: f32,
}

fn wrapTexel(tc: vec2i) -> vec2i {
  return vec2i(tc.x & PATCH_MASK, tc.y & PATCH_MASK);
}

// Bilinear toroidal tap into the rolling 128x128 local terrain patch (r32float height + rgba8unorm mask).
fn samplePatch(relXZ: vec2f) -> GroundTap {
  let local = relXZ - u.patchInfo.xy;
  var out: GroundTap;
  if (local.x < TEXEL_CELLS * 0.5 || local.y < TEXEL_CELLS * 0.5 || local.x >= PATCH_SPAN - TEXEL_CELLS * 0.5 || local.y >= PATCH_SPAN - TEXEL_CELLS * 0.5) {
    out.heightY = 0.0;
    out.mask = vec4f(0.0);
    out.inside = 0.0;
    return out;
  }
  let texF = local / TEXEL_CELLS - vec2f(0.5);
  let baseLocal = clamp(vec2i(floor(texF)), vec2i(0), vec2i(PATCH_DIM - 2));
  let f = fract(texF);
  let originT = vec2i(i32(u.patchTex.x), i32(u.patchTex.y));
  let t00 = wrapTexel(originT + baseLocal);
  let t10 = wrapTexel(originT + baseLocal + vec2i(1, 0));
  let t01 = wrapTexel(originT + baseLocal + vec2i(0, 1));
  let t11 = wrapTexel(originT + baseLocal + vec2i(1, 1));

  let h00 = textureLoad(heightTex, t00, 0).r;
  let h10 = textureLoad(heightTex, t10, 0).r;
  let h01 = textureLoad(heightTex, t01, 0).r;
  let h11 = textureLoad(heightTex, t11, 0).r;
  let h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);

  let m00 = textureLoad(maskTex, t00, 0);
  let m10 = textureLoad(maskTex, t10, 0);
  let m01 = textureLoad(maskTex, t01, 0);
  let m11 = textureLoad(maskTex, t11, 0);
  let m = mix(mix(m00, m10, f.x), mix(m01, m11, f.x), f.y);

  out.heightY = h - u.patchTex.z;
  out.mask = m;
  out.inside = 1.0;
  return out;
}

struct MeadowTone {
  root: vec3f,
  tip: vec3f,
}

fn meadowPalette(wmXZ: vec2f) -> MeadowTone {
  let g1 = vec3f(0.095, 0.295, 0.042); // fresh grass (linear, harmonized with march.ts #5f8a3c)
  let g2 = vec3f(0.225, 0.385, 0.055); // sun-warmed yellow-green
  let g3 = vec3f(0.460, 0.440, 0.095); // dry golden straw accents
  let g4 = vec3f(0.036, 0.195, 0.052); // lush shaded emerald
  let a = gNoise2(wmXZ * 0.03 + vec2f(3.0)) * 0.65 + gNoise2(wmXZ * 0.09 + vec2f(31.0)) * 0.35;
  let lush = gNoise2(wmXZ * 0.07 + vec2f(17.0));
  let dry = gNoise2(wmXZ * 0.016 + vec2f(40.0));
  var tip = mix(g1, g2, smoothstep(0.3, 0.72, a));
  tip = mix(tip, g3, smoothstep(0.6, 0.86, dry) * 0.45);
  tip = mix(tip, g4, smoothstep(0.58, 0.9, lush) * 0.6);
  var out: MeadowTone;
  out.tip = tip;
  out.root = tip * vec3f(0.22, 0.44, 0.48);
  return out;
}

struct LeanResult {
  lean: vec2f,
  leanLen: f32,
  gust: f32,
  ownSide: vec2f,
}

fn evalLean(gW: vec2f, wmXZ: vec2f, seed: vec4f, flattened: f32) -> LeanResult {
  let ang = seed.z * 18.85;
  let face = vec2f(cos(ang), sin(ang));
  let own = vec2f(-face.y, face.x);

  // Rolling wind gusts across the meadow.
  let gustRaw = gNoise2(wmXZ * 0.055 - u.wind.xy * (u.clock * 0.85));
  let gust = gustRaw * gustRaw;
  let flutter = sin(u.clock * (2.3 + seed.w * 1.7) + seed.z * 40.0 + wmXZ.x * 0.7);
  var lean = face * (0.16 + 0.26 * seed.w) + u.wind.xy * (u.wind.z * (0.24 + 0.95 * gust)) + own * (flutter * 0.06 * u.wind.z);

  // Player / entity push bending blades outward.
  if (u.pushPos.w > 0.001) {
    let dv = gW - u.pushPos.xy;
    let dl = length(dv);
    let pushW = (1.0 - smoothstep(0.0, max(u.pushPos.z, 1.0), dl)) * u.pushPos.w;
    lean += (dv / max(dl, 0.5)) * pushW;
  }

  // Blast / cleave shockwave flattening ring.
  if (u.shock.w > 0.001) {
    let sv = gW - u.shock.xy;
    let sl = length(sv);
    let ringR = u.shock.z;
    let behind = smoothstep(ringR - 180.0, ringR, sl);
    let aheadDist = (sl - ringR) / 25.0;
    let ahead = exp(-aheadDist * aheadDist);
    let ring = select(ahead, behind, sl < ringR);
    lean += (sv / max(sl, 0.5)) * (u.shock.w * ring);
  }

  // Persistent flattened footprint lays blades down along their natural face.
  lean += face * (flattened * 1.15);

  var ll = length(lean);
  if (ll > 1.55) {
    lean *= 1.55 / ll;
    ll = 1.55;
  }
  var out: LeanResult;
  out.lean = lean;
  out.leanLen = ll;
  out.gust = gust;
  out.ownSide = own;
  return out;
}

fn evalSunShadow(worldPos: vec3f) -> f32 {
  if (u.hasWorld > 0.5 && g.levels > 0u) {
    let sunny = sunlit(worldPos, vec3f(0.0, 1.0, 0.0), 0u);
    if (sunny >= 0.0) { return sunny; }
  }
  return 1.0;
}

fn sunLighting(albedo: vec3f, sunVis: f32, skyOpen: f32) -> vec3f {
  var sunCol = vec3f(1.45, 1.32, 1.12) * mix(0.04, 1.0, u.day);
  var skyCol = vec3f(0.22, 0.30, 0.44) * mix(0.06, 1.0, u.day);
  if (u.hasWorld > 0.5 && g.levels > 0u) {
    sunCol = g.lightSun.rgb * 2.2;
    skyCol = g.lightFill.rgb * 0.85;
  }
  return albedo * (sunCol * sunVis + skyCol * (0.38 + 0.62 * skyOpen));
}
`

const GRASS_BLADE_CODE = /* wgsl */ `
${GRASS_COMMON_WGSL}

struct BladeOut {
  @builtin(position) clipPos: vec4f,
  @location(0) tHeight: f32,
  @location(1) rootCol: vec3f,
  @location(2) tipCol: vec3f,
  @location(3) worldPos: vec3f,
  @location(4) gustEmber: vec2f, // gust, emberGlow
}

@vertex fn vs(
  @location(0) localPos: vec3f,
  @location(1) seed: vec4f,
) -> BladeOut {
  let gCell = seed.xy * TILE_SIZE;
  let gW = gCell + floor((u.eye.xz - gCell) / TILE_SIZE + 0.5) * TILE_SIZE;
  let gDist = distance(gW, u.eye.xz);
  let wmXZ = gW * 0.1 + u.patchInfo.zw * 0.5;

  let tap = samplePatch(gW);
  let grassMask = tap.mask.r * tap.inside;
  let burnt = tap.mask.g;
  let ember = tap.mask.b;
  let flattened = tap.mask.a;

  // Ragged circular fade toward tile edge so grass thins organically without a hard square edge.
  let gKeep = 1.0 - smoothstep(175.0, 248.0, gDist + (seed.z - 0.5) * 48.0);
  let grow = smoothstep(0.18, 0.55, grassMask) * (1.0 - 0.78 * burnt) * (1.0 - 0.55 * flattened);
  let hNoise = 0.75 + 0.6 * gNoise2(wmXZ * 0.06 + vec2f(9.0));
  // 2.6..6.2 cells (26..62 cm) lush blades.
  let gH = 3.8 * (0.52 + 0.78 * seed.w * seed.w + 0.25 * seed.z) * grow * gKeep * hNoise;

  var out: BladeOut;
  if (gH < 0.08) {
    out.clipPos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.tHeight = 0.0;
    out.rootCol = vec3f(0.0);
    out.tipCol = vec3f(0.0);
    out.worldPos = vec3f(0.0);
    out.gustEmber = vec2f(0.0);
    return out;
  }

  let leanInfo = evalLean(gW, wmXZ, seed, flattened);
  let gWd = 0.24 * (0.7 + 0.6 * seed.z) * (1.0 + gDist * 0.0045);
  let gT = localPos.y;

  let toEyeXZ = normalize(u.eye.xz - gW + vec2f(1e-4, 0.0));
  let sq = vec2f(-toEyeXZ.y, toEyeXZ.x);
  let sideSign = select(-1.0, 1.0, dot(leanInfo.ownSide, sq) >= 0.0);
  let across = normalize(mix(leanInfo.ownSide * sideSign, sq, 0.6));

  var w = vec3f(gW.x, tap.heightY - 0.25, gW.y);
  let leanDisp = leanInfo.lean * (gT * gT * gH);
  let widthDisp = across * (localPos.x * gWd * pow(max(1.0 - gT, 0.0), 0.7));
  w.x += leanDisp.x + widthDisp.x;
  w.z += leanDisp.y + widthDisp.y;
  w.y += gH * gT * (1.0 - 0.3 * leanInfo.leanLen * leanInfo.leanLen * gT);

  let pal = meadowPalette(wmXZ);
  var tip = pal.tip * (0.82 + 0.36 * seed.w);
  tip = mix(tip, vec3f(0.50, 0.48, 0.11), step(0.94, seed.z) * 0.65);
  var root = pal.root;

  // Scorched grass turns to dark charcoal ash with glowing ember tips.
  let ash = vec3f(0.025, 0.022, 0.018);
  let charred = max(burnt, min(1.0, ember * 1.6));
  tip = mix(tip, ash, charred);
  root = mix(root, ash * 0.6, charred);

  let emberFlicker = ember * (0.55 + 0.45 * sin(u.clock * 16.0 + seed.z * 40.0)) * step(0.45, fract(seed.z * 7.0 + seed.w * 3.0));

  let rel = w - u.eye;
  let depthZ = dot(rel, u.forward);
  out.clipPos = vec4f(
    dot(rel, u.right) / (u.tanHalf * u.aspect),
    dot(rel, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.tHeight = gT;
  out.rootCol = root;
  out.tipCol = tip;
  out.worldPos = w;
  out.gustEmber = vec2f(leanInfo.gust, emberFlicker);
  return out;
}

@fragment fn fs(in: BladeOut) -> @location(0) vec4f {
  let gSh = evalSunShadow(in.worldPos);
  let alb = mix(in.rootCol, in.tipCol, smoothstep(0.0, 0.85, in.tHeight));
  let toEye = normalize(u.eye - in.worldPos);
  let backLit = pow(max(dot(-toEye, u.sun), 0.0), 2.0);

  var col = sunLighting(alb, gSh * (0.5 + 0.5 * in.tHeight), 0.3 + 0.7 * in.tHeight);
  // Backlit sun translucency through thin blades + wind gust specular sheen.
  let sunCol = select(vec3f(1.4, 1.28, 1.08) * mix(0.04, 1.0, u.day), g.lightSun.rgb * 2.0, u.hasWorld > 0.5 && g.levels > 0u);
  col += alb * sunCol * vec3f(0.85, 1.0, 0.3) * (backLit * gSh * in.tHeight * 0.35);
  col += sunCol * (0.06 * gSh * in.gustEmber.x * in.tHeight * in.tHeight);
  // Glowing ember tips in linear HDR (blooms cleanly under glow.ts).
  col += vec3f(2.6, 0.55, 0.05) * (in.gustEmber.y * in.tHeight * in.tHeight * in.tHeight);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

const FLOWER_STEM_CODE = /* wgsl */ `
${GRASS_COMMON_WGSL}

struct StemOut {
  @builtin(position) clipPos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) tHeight: f32,
}

@vertex fn vs(
  @location(0) localPos: vec3f,
  @location(1) seed: vec4f,
) -> StemOut {
  let gCell = seed.xy * TILE_SIZE;
  let gW = gCell + floor((u.eye.xz - gCell) / TILE_SIZE + 0.5) * TILE_SIZE;
  let gDist = distance(gW, u.eye.xz);
  let wmXZ = gW * 0.1 + u.patchInfo.zw * 0.5;

  let tap = samplePatch(gW);
  let gKeep = 1.0 - smoothstep(160.0, 235.0, gDist + (seed.z - 0.5) * 40.0);
  let driftMask = smoothstep(0.32, 0.72, gNoise2(wmXZ * 0.08 + vec2f(53.0)));
  let fThere = step(seed.w, driftMask * 0.85) * tap.mask.r * tap.inside * gKeep
             * (1.0 - smoothstep(0.1, 0.45, tap.mask.g + tap.mask.b)) * (1.0 - 0.75 * tap.mask.a);

  let fZone = gNoise2(wmXZ * 0.045 + vec2f(70.0));
  let fPick = fract(seed.z * 7.13 + seed.w * 3.7);
  var fKind = 0.0;
  if (fZone < 0.34) { fKind = select(3.0, 0.0, fPick < 0.7); }
  else if (fZone < 0.52) { fKind = select(2.0, 1.0, fPick < 0.75); }
  else if (fZone < 0.70) { fKind = select(4.0, 2.0, fPick < 0.65); }
  else { fKind = select(1.0, 3.0, fPick < 0.6); }

  let baseTall = select(select(select(select(3.8, 3.0, fKind < 3.5), 3.4, fKind < 2.5), 4.2, fKind < 1.5), 4.6, fKind < 0.5);
  let fTall = baseTall * (0.75 + 0.5 * seed.z) * fThere;

  var out: StemOut;
  if (fTall < 0.1) {
    out.clipPos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.worldPos = vec3f(0.0);
    out.tHeight = 0.0;
    return out;
  }

  let leanInfo = evalLean(gW, wmXZ, seed, tap.mask.a);
  let toEyeXZ = normalize(u.eye.xz - gW + vec2f(1e-4, 0.0));
  let sq = vec2f(-toEyeXZ.y, toEyeXZ.x);
  let fT = localPos.y;
  var w = vec3f(gW.x, tap.heightY - 0.15, gW.y);
  let disp = leanInfo.lean * (0.42 * fTall * fT * fT) + sq * (localPos.x * 0.09);
  w.x += disp.x;
  w.z += disp.y;
  w.y += fTall * (1.0 - 0.12 * leanInfo.leanLen * leanInfo.leanLen) * fT;

  let rel = w - u.eye;
  let depthZ = dot(rel, u.forward);
  out.clipPos = vec4f(
    dot(rel, u.right) / (u.tanHalf * u.aspect),
    dot(rel, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.worldPos = w;
  out.tHeight = fT;
  return out;
}

@fragment fn fs(in: StemOut) -> @location(0) vec4f {
  let gSh = evalSunShadow(in.worldPos);
  let stemAlb = vec3f(0.042, 0.21, 0.055) * (0.55 + 0.5 * in.tHeight);
  let col = sunLighting(stemAlb, gSh * (0.5 + 0.5 * in.tHeight), 0.4 + 0.6 * in.tHeight);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

const FLOWER_HEAD_CODE = /* wgsl */ `
${GRASS_COMMON_WGSL}

struct HeadOut {
  @builtin(position) clipPos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kindMeta: vec3f, // petalCount, rotSeed, size
  @location(2) @interpolate(flat) petalCol: vec3f,
  @location(3) worldPos: vec3f,
}

fn petalPalette(k: u32) -> vec3f {
  // Linear RGB wildflower species: red poppy, blue cornflower, cream daisy, golden buttercup, pink clover.
  let cols = array<vec3f, 5>(
    vec3f(0.81, 0.06, 0.03),
    vec3f(0.05, 0.16, 0.80),
    vec3f(0.98, 0.92, 0.78),
    vec3f(0.93, 0.62, 0.025),
    vec3f(0.87, 0.32, 0.58),
  );
  return cols[min(k, 4u)];
}

@vertex fn vs(
  @location(0) localPos: vec3f,
  @location(1) seed: vec4f,
) -> HeadOut {
  let gCell = seed.xy * TILE_SIZE;
  let gW = gCell + floor((u.eye.xz - gCell) / TILE_SIZE + 0.5) * TILE_SIZE;
  let gDist = distance(gW, u.eye.xz);
  let wmXZ = gW * 0.1 + u.patchInfo.zw * 0.5;

  let tap = samplePatch(gW);
  let gKeep = 1.0 - smoothstep(160.0, 235.0, gDist + (seed.z - 0.5) * 40.0);
  let driftMask = smoothstep(0.32, 0.72, gNoise2(wmXZ * 0.08 + vec2f(53.0)));
  let fThere = step(seed.w, driftMask * 0.85) * tap.mask.r * tap.inside * gKeep
             * (1.0 - smoothstep(0.1, 0.45, tap.mask.g + tap.mask.b)) * (1.0 - 0.75 * tap.mask.a);

  let fZone = gNoise2(wmXZ * 0.045 + vec2f(70.0));
  let fPick = fract(seed.z * 7.13 + seed.w * 3.7);
  var fKind = 0u;
  if (fZone < 0.34) { fKind = select(3u, 0u, fPick < 0.7); }
  else if (fZone < 0.52) { fKind = select(2u, 1u, fPick < 0.75); }
  else if (fZone < 0.70) { fKind = select(4u, 2u, fPick < 0.65); }
  else { fKind = select(1u, 3u, fPick < 0.6); }

  let baseTall = array<f32, 5>(4.6, 4.2, 3.4, 3.0, 3.8)[fKind];
  let fTall = baseTall * (0.75 + 0.5 * seed.z) * fThere;

  var out: HeadOut;
  if (fTall < 0.1) {
    out.clipPos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.uv = vec2f(0.0);
    out.kindMeta = vec3f(0.0);
    out.petalCol = vec3f(0.0);
    out.worldPos = vec3f(0.0);
    return out;
  }

  let leanInfo = evalLean(gW, wmXZ, seed, tap.mask.a);
  var fTop = vec3f(gW.x, tap.heightY, gW.y);
  fTop.x += leanInfo.lean.x * 0.42 * fTall;
  fTop.z += leanInfo.lean.y * 0.42 * fTall;
  fTop.y += fTall * (1.0 - 0.12 * leanInfo.leanLen * leanInfo.leanLen);

  let baseSize = array<f32, 5>(0.92, 0.68, 0.62, 0.48, 0.78)[fKind];
  let fSize = baseSize * (0.8 + 0.4 * seed.w);
  let petalN = array<f32, 5>(4.0, 8.0, 13.0, 5.0, 1.0)[fKind];

  // Camera-facing billboard quad centered on the tip of the flower stem.
  let w = fTop + (u.right * localPos.x + u.up * localPos.y) * fSize;
  let rel = w - u.eye;
  let depthZ = dot(rel, u.forward);
  out.clipPos = vec4f(
    dot(rel, u.right) / (u.tanHalf * u.aspect),
    dot(rel, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.uv = localPos.xy;
  out.kindMeta = vec3f(petalN, seed.z, fSize);
  out.petalCol = petalPalette(fKind) * (0.82 + 0.36 * seed.w);
  out.worldPos = fTop;
  return out;
}

@fragment fn fs(in: HeadOut) -> @location(0) vec4f {
  let fN = in.kindMeta.x;
  let fRad = length(in.uv);
  let fAng = atan2(in.uv.y, in.uv.x);
  var fR = 2.0;
  var fEye = 0.0;
  var fTone = 0.0;

  if (fN < 1.5) {
    // Tuft of six small florets.
    for (var i = 0; i < 6; i++) {
      let fi = f32(i);
      let h = fract(sin(vec2f(fi * 12.9898 + in.kindMeta.y * 91.7, fi * 78.233 + in.kindMeta.y * 47.3)) * 43758.5453);
      let r = length(in.uv - (h - vec2f(0.5)) * 1.1) / 0.42;
      if (r < fR) { fR = r; fTone = h.x * 2.0 - 1.0; }
    }
  } else {
    let turn = fAng / 6.2831853 * fN + in.kindMeta.y;
    let k = abs(fract(turn) - 0.5) * 2.0;
    let L = select(0.72 + 0.26 * sqrt(max(1.0 - k * k, 0.0)), 0.78 + 0.2 * fract(sin(floor(turn) * 91.3 + in.kindMeta.y * 7.0) * 437.5), fN > 9.5);
    let wide = select(2.0, 0.7 * sin(3.14159265 * clamp(fRad / max(L, 0.01), 0.0, 1.0)) + 0.1, fN > 9.5);
    fR = max(fRad / max(L, 0.01), k / max(wide, 0.01));
    fTone = k * 2.0 - 1.0;
    fEye = step(fRad, select(0.2, 0.3, fN > 9.5));
    if (fEye > 0.5) { fR = fRad; }
  }

  let aa = fwidth(fR) + 1e-4;
  let alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, fR);
  if (alpha < 0.25) { discard; }

  var alb = in.petalCol * (1.0 + 0.16 * fTone);
  let eyeCol = select(
    select(
      select(vec3f(0.02, 0.015, 0.03), vec3f(0.75, 0.38, 0.02), fN > 4.5),
      vec3f(0.03, 0.03, 0.22),
      fN > 6.5
    ),
    vec3f(0.90, 0.50, 0.03),
    fN > 9.5
  );
  alb = mix(alb, eyeCol, fEye);

  let gSh = evalSunShadow(in.worldPos);
  let toEye = normalize(u.eye - in.worldPos);
  let backLit = pow(max(dot(-toEye, u.sun), 0.0), 2.0);
  let sunCol = select(vec3f(1.4, 1.28, 1.08) * mix(0.04, 1.0, u.day), g.lightSun.rgb * 2.0, u.hasWorld > 0.5 && g.levels > 0u);
  let col = sunLighting(alb, gSh, 1.0) + alb * sunCol * (0.45 * backLit * gSh);
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

export interface GroundSample {
  /** Ground surface Y in world cells. */
  y: number
  /** Voxel kind at `(x, y - 1, z)`: `(kind & 15) === 3` is grass. */
  kind: number
  /** Optional explicit grass presence in `[0, 1]` overriding `(kind & 15) === 3`. */
  grass?: number
}

export type SampleGround = (wx: number, wz: number) => GroundSample | null

export interface GrassUpdateOptions {
  /** Frame delta seconds (advances wind animation and ember cooling). */
  dt?: number
  /** Player or vehicle push position in world cells. */
  pushPos?: readonly [number, number, number] | null
  /** Push radius in cells (default 14 = 1.4 m). */
  pushRadius?: number
  /** Push bend strength (default 1.2). */
  pushStrength?: number
  /** Force full 128x128 patch resample (e.g. after terrain crater edit). */
  forceRefresh?: boolean
}

export interface GrassStats {
  patchOriginTx: number
  patchOriginTz: number
  grassInstances: number
  flowerInstances: number
  grassTexels: number
  scorchedTexels: number
  updates: number
}

export interface Grass {
  /** Incrementally updates the rolling 128x128 terrain patch around `eye` on camera tile shift and ticks wind/embers. */
  update(eye: readonly [number, number, number], sampleGround: SampleGround, options?: GrassUpdateOptions): void
  /** Scorches grass to dark ash (`G`) and ignites glowing ember tips (`B`) within `radius` cells of `pos`. */
  scorch(pos: readonly [number, number, number], radius: number, heat?: number): void
  /** Flattens grass & wildflowers (`A`) within `radius` cells of `pos`. */
  flatten(pos: readonly [number, number, number], radius: number, amount?: number): void
  /** Sets the expanding blast/cleave shockwave flattening ring (`center` in world cells, `radius` in cells, `strength` 0..2). */
  setShock(center: readonly [number, number, number], radius: number, strength: number): void
  /** Sets ambient wind direction and strength. */
  setWind(dirX: number, dirZ: number, strength: number): void
  /** Updates sun direction and daylight factor (0 night .. 1 day) for fallback lighting. */
  light(sun: readonly number[], day: number): void
  /** Draws depth-tested instanced grass blades and wildflowers into `(to.color, to.depth)`. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, sunBindGroup?: GPUBindGroup): void
  /** Bind group layout expected for optional `@group(1)` sun shadow override (`Globals`, `sunMap`). */
  readonly sunBindGroupLayout: GPUBindGroupLayout
  readonly stats: GrassStats
  dispose(): void
}

export async function createGrass(device: GPUDevice, format: GPUTextureFormat, march?: Marcher): Promise<Grass> {
  const [bladeMod, stemMod, headMod] = await Promise.all([
    shader(device, 'grass-blades', GRASS_BLADE_CODE),
    shader(device, 'flower-stems', FLOWER_STEM_CODE),
    shader(device, 'flower-heads', FLOWER_HEAD_CODE),
  ])

  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const ownLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: both, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float' } },
    ],
  })
  const sunLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
    ],
  })
  const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [ownLayout, sunLayout] })

  const makePipe = (label: string, module: GPUShaderModule) =>
    device.createRenderPipelineAsync({
      label,
      layout: pipeLayout,
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
        ],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    })

  const [bladePipe, stemPipe, headPipe] = await Promise.all([
    makePipe('grass-blades', bladeMod),
    makePipe('flower-stems', stemMod),
    makePipe('flower-heads', headMod),
  ])

  // Static geometry & seed instance buffers.
  const blade = buildBladeMesh(GRASS_SEGS)
  const stem = buildStemMesh()
  const quad = buildQuadMesh()

  const makeBuf = (label: string, data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, usage: GPUBufferUsageFlags) => {
    const aligned = (data.byteLength + 3) & ~3
    const buf = device.createBuffer({ label, size: aligned, usage: usage | GPUBufferUsage.COPY_DST })
    if (aligned === data.byteLength) {
      device.queue.writeBuffer(buf, 0, data)
    } else {
      const padded = new Uint8Array(new ArrayBuffer(aligned))
      padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      device.queue.writeBuffer(buf, 0, padded)
    }
    return buf
  }

  const bladeVB = makeBuf('grass-blade-vb', blade.positions, GPUBufferUsage.VERTEX)
  const bladeIB = makeBuf('grass-blade-ib', blade.indices, GPUBufferUsage.INDEX)
  const bladeSeeds = makeBuf('grass-blade-seeds', makeSeeds(GRASS_COUNT, 0x517cc1b7), GPUBufferUsage.VERTEX)

  const stemVB = makeBuf('flower-stem-vb', stem.positions, GPUBufferUsage.VERTEX)
  const stemIB = makeBuf('flower-stem-ib', stem.indices, GPUBufferUsage.INDEX)
  const quadVB = makeBuf('flower-head-vb', quad.positions, GPUBufferUsage.VERTEX)
  const quadIB = makeBuf('flower-head-ib', quad.indices, GPUBufferUsage.INDEX)
  const flowerSeeds = makeBuf('flower-seeds', makeSeeds(FLOWER_COUNT, 0x9e3779b9), GPUBufferUsage.VERTEX)

  // Rolling 128x128 local terrain patch textures.
  const heightTex = device.createTexture({
    label: 'grass-height-patch',
    size: [PATCH_TEXELS, PATCH_TEXELS],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const maskTex = device.createTexture({
    label: 'grass-mask-patch',
    size: [PATCH_TEXELS, PATCH_TEXELS],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const heightCpu = new Float32Array(new ArrayBuffer(PATCH_TEXELS * PATCH_TEXELS * 4))
  const maskCpu = new Uint8Array(new ArrayBuffer(PATCH_TEXELS * PATCH_TEXELS * 4))

  const uniformBytes = 160 // 10 x vec4f
  const uniformBuf = device.createBuffer({ label: 'grass-u', size: uniformBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const uF32 = new Float32Array(new ArrayBuffer(uniformBytes))

  const ownBind = device.createBindGroup({
    layout: ownLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: heightTex.createView() },
      { binding: 2, resource: maskTex.createView() },
    ],
  })

  // Fallback sun bind group for standalone usage without a bound Marcher.
  const dummyGlobals = device.createBuffer({ size: GLOBALS_BYTES, usage: GPUBufferUsage.UNIFORM })
  const dummySun = device.createTexture({ size: [1, 1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING })
  const fallbackSunBind = device.createBindGroup({
    layout: sunLayout,
    entries: [
      { binding: 0, resource: { buffer: dummyGlobals } },
      { binding: 1, resource: dummySun.createView({ dimension: '2d-array' }) },
    ],
  })

  let cachedSun: { march: Marcher; group: GPUBindGroup } | null = null
  const resolveSun = (override?: GPUBindGroup): { group: GPUBindGroup; hasWorld: number } => {
    if (override) return { group: override, hasWorld: 1 }
    const active = march ?? (globalThis as { engine?: { march?: Marcher } }).engine?.march
    if (!active) return { group: fallbackSunBind, hasWorld: 0 }
    if (cachedSun?.march !== active) {
      cachedSun = {
        march: active,
        group: device.createBindGroup({
          layout: sunLayout,
          entries: [
            { binding: 0, resource: { buffer: active.globals } },
            { binding: 1, resource: active.sun.all },
          ],
        }),
      }
    }
    return { group: cachedSun.group, hasWorld: 1 }
  }

  let initialized = false
  let originTx = 0
  let originTz = 0
  let heightDirty = false
  let maskDirty = false
  let grassTexels = 0
  let scorchedTexels = 0
  let updateCount = 0

  let clock = 0
  let windX = 0.86, windZ = 0.50, windStr = 0.55
  let sunDir: [number, number, number] = [0.52, 0.62, 0.59]
  let dayLevel = 1
  let shockX = 0, shockZ = 0, shockR = 0, shockStr = 0
  let pushX = 0, pushZ = 0, pushR = 14, pushStr = 0
  let emberCoolAcc = 0

  const sampleTexel = (tx: number, tz: number, sampleGround: SampleGround) => {
    const ux = tx & (PATCH_TEXELS - 1)
    const uz = tz & (PATCH_TEXELS - 1)
    const idx = uz * PATCH_TEXELS + ux
    const wx = (tx + 0.5) * CELLS_PER_TEXEL
    const wz = (tz + 0.5) * CELLS_PER_TEXEL
    const hit = sampleGround(wx, wz)
    const m4 = idx * 4
    const wasGrass = maskCpu[m4] > 0
    const wasScorched = maskCpu[m4 + 1] > 0
    if (hit) {
      heightCpu[idx] = hit.y
      const gPresence = hit.grass !== undefined ? hit.grass : ((hit.kind & 15) === 3 ? 1 : 0)
      maskCpu[m4] = Math.max(0, Math.min(255, Math.round(gPresence * 255)))
    } else {
      heightCpu[idx] = -1e4
      maskCpu[m4] = 0
    }
    // Freshly shifted-in texels start unburnt, cool, and unflattened.
    maskCpu[m4 + 1] = 0
    maskCpu[m4 + 2] = 0
    maskCpu[m4 + 3] = 0
    const isGrass = maskCpu[m4] > 0
    if (isGrass && !wasGrass) grassTexels++
    else if (!isGrass && wasGrass) grassTexels--
    if (wasScorched) scorchedTexels--
  }

  const uploadPatch = () => {
    if (heightDirty) {
      device.queue.writeTexture(
        { texture: heightTex },
        heightCpu,
        { bytesPerRow: PATCH_TEXELS * 4 },
        { width: PATCH_TEXELS, height: PATCH_TEXELS },
      )
      heightDirty = false
    }
    if (maskDirty) {
      device.queue.writeTexture(
        { texture: maskTex },
        maskCpu,
        { bytesPerRow: PATCH_TEXELS * 4 },
        { width: PATCH_TEXELS, height: PATCH_TEXELS },
      )
      maskDirty = false
    }
  }

  const paintRadial = (pos: readonly [number, number, number], radius: number, fn: (m4: number, falloff: number) => void) => {
    if (!initialized || radius <= 0) return
    const minTx = Math.max(originTx, Math.floor((pos[0] - radius) / CELLS_PER_TEXEL))
    const maxTx = Math.min(originTx + PATCH_TEXELS - 1, Math.floor((pos[0] + radius) / CELLS_PER_TEXEL))
    const minTz = Math.max(originTz, Math.floor((pos[2] - radius) / CELLS_PER_TEXEL))
    const maxTz = Math.min(originTz + PATCH_TEXELS - 1, Math.floor((pos[2] + radius) / CELLS_PER_TEXEL))
    if (minTx > maxTx || minTz > maxTz) return
    const invR = 1 / Math.max(radius, 0.01)
    for (let tz = minTz; tz <= maxTz; tz++) {
      const wz = (tz + 0.5) * CELLS_PER_TEXEL
      const dz = wz - pos[2]
      const uz = tz & (PATCH_TEXELS - 1)
      for (let tx = minTx; tx <= maxTx; tx++) {
        const wx = (tx + 0.5) * CELLS_PER_TEXEL
        const dx = wx - pos[0]
        const dist = Math.hypot(dx, dz)
        if (dist > radius) continue
        const u0 = 1 - dist * invR
        const falloff = u0 * u0 * (3 - 2 * u0)
        const ux = tx & (PATCH_TEXELS - 1)
        fn((uz * PATCH_TEXELS + ux) * 4, falloff)
      }
    }
    maskDirty = true
  }

  return {
    sunBindGroupLayout: sunLayout,
    get stats(): GrassStats {
      return {
        patchOriginTx: originTx,
        patchOriginTz: originTz,
        grassInstances: GRASS_COUNT,
        flowerInstances: FLOWER_COUNT,
        grassTexels,
        scorchedTexels,
        updates: updateCount,
      }
    },
    update(eye, sampleGround, options) {
      const dt = options?.dt ?? 1 / 60
      clock += dt
      if (options?.pushPos) {
        pushX = options.pushPos[0]
        pushZ = options.pushPos[2]
        pushR = options.pushRadius ?? 14
        pushStr = options.pushStrength ?? 1.2
      } else if (options?.pushPos === null) {
        pushStr = 0
      }

      const targetTx = Math.floor(eye[0] / CELLS_PER_TEXEL) - (PATCH_TEXELS >> 1)
      const targetTz = Math.floor(eye[2] / CELLS_PER_TEXEL) - (PATCH_TEXELS >> 1)

      if (!initialized || options?.forceRefresh) {
        originTx = targetTx
        originTz = targetTz
        grassTexels = 0
        scorchedTexels = 0
        maskCpu.fill(0)
        for (let dz = 0; dz < PATCH_TEXELS; dz++) {
          for (let dx = 0; dx < PATCH_TEXELS; dx++) {
            sampleTexel(originTx + dx, originTz + dz, sampleGround)
          }
        }
        initialized = true
        heightDirty = true
        maskDirty = true
        updateCount++
      } else {
        const shiftX = targetTx - originTx
        const shiftZ = targetTz - originTz
        if (shiftX !== 0 || shiftZ !== 0) {
          if (Math.abs(shiftX) >= PATCH_TEXELS || Math.abs(shiftZ) >= PATCH_TEXELS) {
            originTx = targetTx
            originTz = targetTz
            grassTexels = 0
            scorchedTexels = 0
            maskCpu.fill(0)
            for (let dz = 0; dz < PATCH_TEXELS; dz++) {
              for (let dx = 0; dx < PATCH_TEXELS; dx++) {
                sampleTexel(originTx + dx, originTz + dz, sampleGround)
              }
            }
          } else {
            // Incrementally resample only newly entered columns and rows in toroidal storage.
            if (shiftX > 0) {
              const startX = originTx + PATCH_TEXELS
              for (let tz = originTz; tz < originTz + PATCH_TEXELS; tz++) {
                for (let tx = startX; tx < startX + shiftX; tx++) sampleTexel(tx, tz, sampleGround)
              }
            } else if (shiftX < 0) {
              for (let tz = originTz; tz < originTz + PATCH_TEXELS; tz++) {
                for (let tx = targetTx; tx < originTx; tx++) sampleTexel(tx, tz, sampleGround)
              }
            }
            originTx = targetTx

            if (shiftZ > 0) {
              const startZ = originTz + PATCH_TEXELS
              for (let tz = startZ; tz < startZ + shiftZ; tz++) {
                for (let tx = originTx; tx < originTx + PATCH_TEXELS; tx++) sampleTexel(tx, tz, sampleGround)
              }
            } else if (shiftZ < 0) {
              for (let tz = targetTz; tz < originTz; tz++) {
                for (let tx = originTx; tx < originTx + PATCH_TEXELS; tx++) sampleTexel(tx, tz, sampleGround)
              }
            }
            originTz = targetTz
          }
          heightDirty = true
          maskDirty = true
          updateCount++
        }
      }

      // Gently cool glowing embers over time.
      if (scorchedTexels > 0 && dt > 0) {
        emberCoolAcc += dt * 42
        const dec = Math.floor(emberCoolAcc)
        if (dec > 0) {
          emberCoolAcc -= dec
          let cooled = false
          for (let i = 2; i < maskCpu.length; i += 4) {
            const v = maskCpu[i]
            if (v > 0) {
              maskCpu[i] = v > dec ? v - dec : 0
              cooled = true
            }
          }
          if (cooled) maskDirty = true
        }
      }

      uploadPatch()
    },
    scorch(pos, radius, heat = 1) {
      const h = Math.max(0, Math.min(1, heat))
      paintRadial(pos, radius, (m4, falloff) => {
        const was = maskCpu[m4 + 1] > 0
        const nextBurn = Math.min(255, Math.max(maskCpu[m4 + 1], Math.round(falloff * 255)))
        maskCpu[m4 + 1] = nextBurn
        if (!was && nextBurn > 0) scorchedTexels++
        const edgeBoost = Math.min(1, falloff * 1.4)
        maskCpu[m4 + 2] = Math.min(255, Math.max(maskCpu[m4 + 2], Math.round(edgeBoost * h * 255)))
      })
    },
    flatten(pos, radius, amount = 1) {
      const a = Math.max(0, Math.min(1, amount))
      paintRadial(pos, radius, (m4, falloff) => {
        maskCpu[m4 + 3] = Math.min(255, Math.max(maskCpu[m4 + 3], Math.round(falloff * a * 255)))
      })
    },
    setShock(center, radius, strength) {
      shockX = center[0]
      shockZ = center[2]
      shockR = Math.max(0, radius)
      shockStr = Math.max(0, strength)
    },
    setWind(dirX, dirZ, strength) {
      const len = Math.hypot(dirX, dirZ) || 1
      windX = dirX / len
      windZ = dirZ / len
      windStr = Math.max(0, strength)
    },
    light(sun, day) {
      const len = Math.hypot(sun[0], sun[1], sun[2]) || 1
      sunDir = [sun[0] / len, sun[1] / len, sun[2] / len]
      dayLevel = day
    },
    draw(encoder, to, view, sunBindGroup) {
      if (!initialized || grassTexels === 0) return
      uploadPatch()

      // Anchor X/Z at multiples of TILE_CELLS (512) so toroidal blade wrapping is seamless at any world coord.
      const anchorX = Math.floor(view.eye[0] / TILE_CELLS) * TILE_CELLS
      const anchorY = Math.floor(view.eye[1] / 64) * 64
      const anchorZ = Math.floor(view.eye[2] / TILE_CELLS) * TILE_CELLS
      const { group: sunGroup, hasWorld } = resolveSun(sunBindGroup)

      const originWorldX = originTx * CELLS_PER_TEXEL
      const originWorldZ = originTz * CELLS_PER_TEXEL

      uF32.set([
        view.eye[0] - anchorX, view.eye[1] - anchorY, view.eye[2] - anchorZ, view.tanHalf,
        view.right[0], view.right[1], view.right[2], to.size[0] / to.size[1],
        view.up[0], view.up[1], view.up[2], clock,
        view.forward[0], view.forward[1], view.forward[2], dayLevel,
        sunDir[0], sunDir[1], sunDir[2], hasWorld,
        windX, windZ, windStr, 0,
        shockX - anchorX, shockZ - anchorZ, shockR, shockStr,
        pushX - anchorX, pushZ - anchorZ, pushR, pushStr,
        originWorldX - anchorX, originWorldZ - anchorZ, (anchorX / CELLS_PER_TEXEL) % 1024, (anchorZ / CELLS_PER_TEXEL) % 1024,
        originTx, originTz, anchorY, 0,
      ], 0)
      device.queue.writeBuffer(uniformBuf, 0, uF32)

      const pass = encoder.beginRenderPass({
        label: 'grass-and-wildflowers',
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setBindGroup(0, ownBind)
      pass.setBindGroup(1, sunGroup)

      // 1. Instanced 3-segment tapered grass blades (24,000).
      pass.setPipeline(bladePipe)
      pass.setVertexBuffer(0, bladeVB)
      pass.setVertexBuffer(1, bladeSeeds)
      pass.setIndexBuffer(bladeIB, 'uint16')
      pass.drawIndexed(blade.indices.length, GRASS_COUNT)

      // 2. Instanced wildflower stems (3,000).
      pass.setPipeline(stemPipe)
      pass.setVertexBuffer(0, stemVB)
      pass.setVertexBuffer(1, flowerSeeds)
      pass.setIndexBuffer(stemIB, 'uint16')
      pass.drawIndexed(stem.indices.length, FLOWER_COUNT)

      // 3. Instanced multi-petal wildflower heads (3,000).
      pass.setPipeline(headPipe)
      pass.setVertexBuffer(0, quadVB)
      pass.setVertexBuffer(1, flowerSeeds)
      pass.setIndexBuffer(quadIB, 'uint16')
      pass.drawIndexed(quad.indices.length, FLOWER_COUNT)

      pass.end()
    },
    dispose() {
      bladeVB.destroy(); bladeIB.destroy(); bladeSeeds.destroy()
      stemVB.destroy(); stemIB.destroy()
      quadVB.destroy(); quadIB.destroy(); flowerSeeds.destroy()
      heightTex.destroy(); maskTex.destroy()
      uniformBuf.destroy()
      dummyGlobals.destroy(); dummySun.destroy()
    },
  }
}
