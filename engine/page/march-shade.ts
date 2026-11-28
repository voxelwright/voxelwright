// Pass 2 — Deferred Shading, Reflections, Sky, Depth, World Normals & Analytic Motion Vectors (#165).
//
// Reads the compact visibility buffer (vis0 rgba32uint + vis1 rgba32float) produced by Pass 1 (march-trace.ts),
// evaluates material paint, slope/diagonal normals, openness, sun shadows, GGX Metallic/Roughness PBR,
// night windows/landmarks/local lights (with optional LOCAL_OCCLUDE), reflections (MIRRORS), sky/clouds/fog,
// and writes linear HDR color, frag_depth, rg16float analytic motion vectors (prevUV - curUV),
// rgba16float world normals, and optional rgba16float glass panes MRT.
//
// Enables WGSL shader-f16 when gpu.canF16 is supported to cut VGPR footprint on Apple Silicon Metal.
import type { World } from './world.ts'
import { MARKS } from './marks.ts'
import { CLUSTER_LIGHTS_WGSL, LOCAL_LIGHTS_STRUCT, clusterLightsBindings, localLightsEval } from './lights.ts'
import { DYNAMIC_SHADOW_WGSL, dynamicShadowBindings } from './dynamic-shadows.ts'
import { SKY_LUT_WGSL, skyLutBindings } from './sky-lut.ts'
import { GTAO_WGSL } from './gtao.ts'
import { fineCellWgsl, treeCommonWgsl, VIS_PACK_WGSL } from './march-trace.ts'

export interface ShadeCodeDeps {
  GLOBALS: string
  SCREEN: string
  LIGHT: string
  GLASS: string
  PAINT: string
  AIR: string
  NOISE: string
  NIGHT_WALL: string
  LANDMARK_LIGHT: string
  LEAF_NIGHT: string
  FOG: string
  sunlitText: (marks: boolean) => string
  PANE_LIGHT: number
  LIT_LETTERS: number
  EDITS: number
  TRIES: number
  THROUGH: string
  INLOOP: boolean
}

/**
 * Generates Pass 2 — Deferred Shading WGSL.
 * Keeps `litPrimary`, `litPane`, and `litReflect` separated so Metal never duplicates the 200-line primary
 * shading + localLights + worldClear body across reflection/pane loops, preventing the >60 s compile cliff.
 */
export function shadeCode(world: World, deps: ShadeCodeDeps, useF16: boolean): string {
  const fine = fineCellWgsl(deps.TRIES)
  const marchedShade = `var hit = shadeMarch(ro, rd, t0, level0, most, wide, spread, rough, eyed);${
    world.options.bricks && !deps.INLOOP ? `\n  if ((hit.kind & 64u) != 0u) { hit = refine(ro, rd, hit, most, wide, spread, rough, eyed); }` : ''
  }`
  return /* wgsl */ `${useF16 ? 'enable f16;\n' : ''}${deps.GLOBALS}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, metallic: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16>, far: vec4f, cover: array<vec4u, 32>, wedge: vec4f, bear: vec4f, keep0: vec4f, keep1: vec4f, letters: array<vec4f, ${2 + 2 * deps.LIT_LETTERS}>, edits: array<vec4f, ${2 * deps.EDITS}> }
struct ShadeExtra {
  // Previous frame view-projection matrix evaluated relative to the CURRENT frame's anchor.
  prevViewProj: mat4x4f,
  // x: 1.0 if prevViewProj is valid (0.0 on frame 0), y: resX, z: resY, w: pad
  info: vec4f,
  // xy: Halton(2, 3) sub-pixel jitter in render-res pixels ([-0.5, 0.5]), zw: pad
  jitter: vec4f,
  // xy: active GTAO texture size (aoW, aoH), z: 1.0 if halfRes else 0.0, w: pad
  gtaoInfo: vec4f,
  // x: skyLutBlend (0..1), y: volCloudsActive (0/1), z: dynShadowActive (0/1), w: clusterActive (0/1)
  atmoInfo: vec4f,
  // xyz: physical unclamped unit sun direction, w: skyExposure
  skySunDir: vec4f,
  // x: overcast (0..1), y: aerialStrength (0..1), z: camAltKm, w: dayFade (0..1)
  skyOvercast: vec4f,
  // xyz: world anchor in cells (floor(eye / SIDE) * SIDE), w: pad
  anchorInfo: vec4f,
}

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(0) @binding(3) var<uniform> looks: Looks;
@group(0) @binding(4) var sunMap: texture_2d_array<f32>;
@group(0) @binding(5) var screen: texture_2d<f32>;
${world.options.surveyedWalls ? MARKS : ''}
${LOCAL_LIGHTS_STRUCT}
@group(0) @binding(7) var<uniform> localLights: LocalLights;
@group(1) @binding(0) var vis0Tex: texture_2d<u32>;
@group(1) @binding(1) var vis1Tex: texture_2d<f32>;
@group(1) @binding(2) var<uniform> shadeExtra: ShadeExtra;
@group(1) @binding(3) var gtaoTex: texture_2d<f32>;
${CLUSTER_LIGHTS_WGSL}
${clusterLightsBindings(2, 0)}
${DYNAMIC_SHADOW_WGSL}
${dynamicShadowBindings(3, 0)}
${SKY_LUT_WGSL}
${skyLutBindings(3, 3)}

override MIRRORS: bool = true;
override FOGGY: bool = false;
override NIGHT: bool = false;
override UNDERWATER: bool = false;
override LOCAL_OCCLUDE: bool = false;
override USE_GTAO: bool = false;
override USE_CLUSTER_LIGHTS: bool = false;

const INDOORS = 0.45;
const NEAR = 1.0;
const FAR = 100000.0;

${deps.SCREEN}
fn screenOf(at: vec3f) -> vec4f {
  if (g.air.z <= 0.0) { return vec4f(0.0); }
  let v = at - g.eye;
  let z = max(dot(v, g.forward), 1e-3);
  return screenAt(vec2f(dot(v, g.right) / (z * g.tanHalf * g.aspect), -dot(v, g.up) / (z * g.tanHalf)) * 0.5 + 0.5);
}

${treeCommonWgsl(world)}
${VIS_PACK_WGSL}

// Lean octree ray-march used ONLY by shadow fallback (sunMap miss / K mode) and MIRRORS reflection rays.
// Strips FAR_MODEL, through, and plain checks so Pass 2 stays tiny and fast to compile on Metal.
fn shadeMarch(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, eyed: bool) -> Hit {
  var hit: Hit;
  hit.t = -1.0;
  let inv = 1.0 / rd;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  var t = t0;
  var n = vec3f(0.0);
  var L = level0;
  var have = 0u;
  var held = vec3i(0);
  var supAt = 0xffffffffu;
  var supLo = 0u; var supHi = 0u;
  var entry = 0u; var rootLo = 0u; var rootHi = 0u; var rootChild = 0u;
  var midLo = 0u; var midHi = 0u; var midChild = 0u;
  var leafLo = 0u; var leafHi = 0u; var leafChild = 0u;
  var lv: Level;
  var q0 = vec3f(0.0);
  var k = vec3f(0.0);
  var eps = 0.0;
  var leaveAt = 0.0;
  var last = vec3i(0);
  var fresh = true;
  for (var i = 0u; i < most; i++) {
    work++;
    if (fresh) {
      if (L >= g.levels) { break; }
      lv = g.level[L];
      q0 = (ro - lv.boxMin) * lv.scale;
      k = inv / lv.scale;
      eps = 0.002 / lv.scale;
      last = vec3i(lv.boxSize) - 1;
      let a = -q0 * k;
      let b = (lv.boxSize - q0) * k;
      let near = min(a, b);
      let far = max(a, b);
      let comeAt = max(near.x, max(near.y, near.z));
      leaveAt = min(far.x, min(far.y, far.z));
      var roof = lv.roof;
      if (eyed) { roof = lv.roofs[u32(rd.x > 0.0) + 2u * u32(rd.z > 0.0)]; }
      if (rd.y > 0.0) { leaveAt = min(leaveAt, (roof - ro.y) * inv.y); }
      if (rd.y < 0.0 && ro.y > g.sea) { leaveAt = min(leaveAt, (g.sea - ro.y) * inv.y); }
      have = 0u;
      supAt = 0xffffffffu;
      fresh = false;
      if (comeAt > t || leaveAt <= t) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
      if (rd.y < 0.0 && ro.y + rd.y * t > roof) { t = min((roof - ro.y) * inv.y, leaveAt) + eps; }
    }
    if (t >= leaveAt) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
    let q = q0 + rd * (t * lv.scale);
    let c = clamp(vec3i(floor(q)), vec3i(0), last);
    let moved = c ^ held;
    let apart = u32(moved.x | moved.y | moved.z);
    if (apart >= 64u) { have = 0u; } else if (apart >= 16u) { have = min(have, 1u); } else if (apart >= 4u) { have = min(have, 2u); }
    held = c;
    let width = (wide + spread * t) * lv.scale;
    var size = 0;
    var low = c;
    var kind = 0u;
    var skip = -1.0;
    var face = vec3f(0.0);
    if (have == 0u) {
      let kSec = c >> vec3u(6u);
      let w = (vec3u(kSec) + lv.wrap) & (GRID - 1u);
      let base = L * STRIDE;
      let sup = w >> vec3u(2u);
      var roofTop = f32(bitcast<i32>(top[base + BLOCK_ROOFS + sup.x + (GRID.x >> 2u) * sup.z]) - lv.cells.y);
      var across = 256.0;
      var corner = vec2f((kSec.xz - vec2i(w.xz & vec2u(3u))) * 64);
      if (q.y <= roofTop) {
        roofTop = f32(bitcast<i32>(top[base + ROOFS + w.x + GRID.x * w.z]) - lv.cells.y);
        across = 64.0;
        corner = vec2f(kSec.xz * 64);
      }
      if (q.y > roofTop) {
        let o = ((corner + ahead.xz * across) - q0.xz) * k.xz;
        let leave = min(o.x, o.y);
        if (q0.y + rd.y * (leave * lv.scale) > roofTop) {
          n = -sign(rd) * vec3f(f32(o.x <= leave), 0.0, f32(o.y <= leave));
          t = min(max(leave, t), leaveAt) + eps;
          continue;
        }
        let down = (roofTop - q0.y) * k.y;
        if (down > t) {
          n = vec3f(0.0, 1.0, 0.0);
          t = down + eps;
          continue;
        }
      }
      let at = base + SLOTS + 2u * (sup.x + (GRID.x >> 2u) * (sup.z + (GRID.z >> 2u) * sup.y));
      if (at != supAt) { supAt = at; supLo = top[at]; supHi = top[at + 1u]; }
      if ((supLo | supHi) == 0u) {
        size = 256;
        low = (kSec - vec3i(w & vec3u(3u))) * 64;
      } else if (!has(supLo, supHi, (w.x & 3u) + 4u * (w.z & 3u) + 16u * (w.y & 3u))) {
        size = 64;
        low = kSec * 64;
      } else {
        entry = top[base + w.x + GRID.x * (w.z + GRID.z * w.y)];
        if ((entry & UNIFORM) != 0u) {
          kind = (entry & 0xffffu) | 0x10000u;
          size = 64;
          low = kSec * 64;
        } else {
          let info = pool[entry + 3u];
          let child = pool[entry + 2u];
          let m = meet(vec3f(kSec * 64 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u)) * 4), vec3f(kSec * 64 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u) * 4), q0, k);
          let enter = max(m.near.x, max(m.near.y, m.near.z));
          if (m.leave <= max(enter, t)) {
            size = 64;
            low = kSec * 64;
          } else if (width > 64.0) {
            kind = (info & 0xffffu) | 0x10000u;
            size = 64;
            low = kSec * 64;
          } else {
            rootLo = pool[entry]; rootHi = pool[entry + 1u]; rootChild = entry + (child & 0xfffffu);
            have = 1u;
            if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
          }
        }
      }
    }
    if (have == 1u && skip < 0.0) {
      let kMid = c >> vec3u(4u);
      let cc = vec3u(kMid) & vec3u(3u);
      let bit = cc.x + 4u * cc.z + 16u * cc.y;
      if (!has(rootLo, rootHi, bit)) {
        size = 16;
        low = kMid * 16;
      } else {
        let node = rootChild + 4u * before(rootLo, rootHi, bit);
        let info = pool[node + 3u];
        let child = pool[node + 2u];
        let m = meet(vec3f(kMid * 16 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u))), vec3f(kMid * 16 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u)), q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 16;
          low = kMid * 16;
        } else if ((info & UNIFORM) != 0u || width > 16.0) {
          kind = (info & 0xffffu) | 0x10000u;
          size = 16;
          low = kMid * 16;
        } else {
          midLo = pool[node]; midHi = pool[node + 1u]; midChild = entry + (child & 0xfffffu);
          have = 2u;
          if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
        }
      }
    }
    if (have == 2u && skip < 0.0 && size == 0 && kind == 0u) {
      let kLeaf = c >> vec3u(2u);
      let cc = vec3u(kLeaf) & vec3u(3u);
      let bit = cc.x + 4u * cc.z + 16u * cc.y;
      if (!has(midLo, midHi, bit)) {
        size = 4;
        low = kLeaf * 4;
      } else {
        let node = midChild + 4u * before(midLo, midHi, bit);
        let info = pool[node + 3u];
        let m = meet(vec3f(kLeaf * 4 + vec3i((vec3u(info) >> vec3u(16u, 18u, 20u)) & vec3u(3u))), vec3f(kLeaf * 4 + vec3i(((vec3u(info) >> vec3u(22u, 24u, 26u)) & vec3u(3u)) + 1u)), q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 4;
          low = kLeaf * 4;
        } else if ((info & UNIFORM) != 0u || width > 4.0) {
          kind = (info & 0xffffu) | 0x10000u;
          size = 4;
          low = kLeaf * 4;
        } else {
          leafLo = pool[node]; leafHi = pool[node + 1u]; leafChild = entry + pool[node + 2u];
          have = 3u;
          if (enter > t) { skip = enter; face = vec3f(m.near >= vec3f(enter)); }
        }
      }
    }
    if (skip >= 0.0) {
      n = -sign(rd) * face;
      t = skip + eps;
      continue;
    }
    var cell = c;
    if (have == 3u && size == 0 && kind == 0u) {
      let leaf = c >> vec3u(2u);
      var side = ((vec3f(cell) + ahead) - q0) * k;
      let each = abs(k);
      loop {
        let cc = vec3u(cell) & vec3u(3u);
        let bit = cc.x + 4u * cc.z + 16u * cc.y;
        if (has(leafLo, leafHi, bit)) {
          let nth = before(leafLo, leafHi, bit);
          kind = ((pool[leafChild + (nth >> 1u)] >> (16u * (nth & 1u))) & 0xffffu) | 0x10000u;
          ${world.options.bricks && deps.INLOOP ? fine.BLOCK : 'break;'}
        }
        if (side.x <= side.y && side.x <= side.z) {
          t = side.x; side.x += each.x; cell.x += toward.x; n = vec3f(-f32(toward.x), 0.0, 0.0);
        } else if (side.y <= side.z) {
          t = side.y; side.y += each.y; cell.y += toward.y; n = vec3f(0.0, -f32(toward.y), 0.0);
        } else {
          t = side.z; side.z += each.z; cell.z += toward.z; n = vec3f(0.0, 0.0, -f32(toward.z));
        }
        if (any((cell >> vec3u(2u)) != leaf)) { break; }
        work++;
      }
      if (kind == 0u) { t += eps; continue; }
    }
    if (kind != 0u) {
      hit.t = t;
      hit.kind = kind & 0xffffu;
      hit.n = n;
      hit.level = L;
      hit.cell = cell + lv.cells;
      return hit;
    }
    let out = ((vec3f(low) + ahead * f32(size)) - q0) * k;
    let next = min(out.x, min(out.y, out.z));
    n = -sign(rd) * vec3f(out <= vec3f(next));
    t = min(max(next, t), leaveAt) + eps;
  }
  hit.level = min(L, g.levels - 1u);
  hit.left = L >= g.levels;
  return hit;
}
${world.options.bricks ? fine.FINER + (deps.INLOOP ? '' : fine.REFINE.replace('march(ro, rd, leave, hit.level, most, wide, spread, rough, false, eyed)', 'shadeMarch(ro, rd, leave, hit.level, most, wide, spread, rough, eyed)')) : ''}
fn shadeTrace(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, eyed: bool) -> Hit {
  ${marchedShade}
  if (rd.y >= 0.0 || ro.y <= g.sea) { return hit; }
  let t = (g.sea - ro.y) / rd.y;
  if (hit.t >= 0.0 && hit.t <= t) { return hit; }
  let p = ro + rd * t;
  var L = g.levels;
  for (var k = level0; k < g.levels; k++) {
    let q = (p.xz - g.level[k].boxMin.xz) * g.level[k].scale;
    if (all(q >= vec2f(0.0)) && all(q < g.level[k].boxSize.xz)) { L = k; break; }
  }
  if (L == g.levels || (hit.t < 0.0 && !hit.left)) { return hit; }
  let lv = g.level[L];
  hit.t = t;
  hit.kind = 5u;
  hit.n = vec3f(0.0, 1.0, 0.0);
  hit.level = L;
  hit.cell = vec3i(floor((p - lv.boxMin) * lv.scale - vec3f(0.0, 0.5, 0.0))) + lv.cells;
  return hit;
}

${deps.LIGHT}
${deps.GLASS}
${deps.PAINT}
${deps.AIR}
${deps.NOISE}
${deps.NIGHT_WALL}
${deps.LANDMARK_LIGHT}
${deps.LEAF_NIGHT}
${deps.sunlitText(!!world.options.fineSun)}
${deps.FOG}
${GTAO_WGSL}

fn sampleGtao(px: vec2i, linearZ: f32) -> f32 {
  let aoDim = vec2i(shadeExtra.gtaoInfo.xy);
  let maxAo = max(aoDim - vec2i(1), vec2i(0));
  if (shadeExtra.gtaoInfo.z < 0.5) {
    return clamp(textureLoad(gtaoTex, clamp(px, vec2i(0), maxAo), 0).r, 0.0, 1.0);
  }
  // Half-res texel (ax, ay) sits at full-res pixel (2*ax, 2*ay); 4-tap depth-aware bilateral upsample.
  let f = vec2f(px) * 0.5;
  let b0 = clamp(vec2i(floor(f)), vec2i(0), maxAo);
  let b1 = min(b0 + vec2i(1), maxAo);
  let frac = clamp(f - vec2f(b0), vec2f(0.0), vec2f(1.0));
  let t00 = textureLoad(gtaoTex, b0, 0);
  let t10 = textureLoad(gtaoTex, vec2i(b1.x, b0.y), 0);
  let t01 = textureLoad(gtaoTex, vec2i(b0.x, b1.y), 0);
  let t11 = textureLoad(gtaoTex, b1, 0);
  let invSig = 1.0 / max(linearZ * 0.06, 0.5);
  let w00 = (1.0 - frac.x) * (1.0 - frac.y) * exp(-abs(t00.g - linearZ) * invSig);
  let w10 = frac.x * (1.0 - frac.y) * exp(-abs(t10.g - linearZ) * invSig);
  let w01 = (1.0 - frac.x) * frac.y * exp(-abs(t01.g - linearZ) * invSig);
  let w11 = frac.x * frac.y * exp(-abs(t11.g - linearZ) * invSig);
  let wSum = w00 + w10 + w01 + w11;
  if (wSum <= 1e-5) { return clamp(t00.r, 0.0, 1.0); }
  return clamp((t00.r * w00 + t10.r * w10 + t01.r * w01 + t11.r * w11) / wSum, 0.0, 1.0);
}

fn cloud(p: vec2f) -> f32 {
  var q = p;
  var sum = 0.0;
  var weight = 0.5;
  for (var o = 0; o < 4; o++) {
    sum += noise2(q) * weight;
    q = q * 2.03 + vec2f(17.3, 9.1);
    weight *= 0.5;
  }
  return sum;
}
fn skyBasePhys(rd: vec3f) -> vec3f {
  let analytic = skyBase(rd);
  let lutBlend = shadeExtra.atmoInfo.x;
  if (lutBlend <= 0.001) { return analytic; }
  let physSun = shadeExtra.skySunDir.xyz;
  let expo = shadeExtra.skySunDir.w;
  var phys = sampleSkyView(rd, physSun) * expo;
  if (rd.y < 0.0) {
    let horiz = sampleSkyView(normalize(vec3f(rd.x, 0.015, rd.z)), physSun) * expo;
    phys = mix(phys, horiz * 0.72, clamp(-rd.y * 6.0, 0.0, 1.0));
  }
  let dayFade = shadeExtra.skyOvercast.w;
  let ov = shadeExtra.skyOvercast.x;
  if (ov > 0.001) {
    let lum = dot(phys, vec3f(0.2126, 0.7152, 0.0722));
    let grey = mix(vec3f(0.022, 0.028, 0.044), vec3f(0.56, 0.60, 0.66), dayFade);
    phys = mix(phys, mix(vec3f(lum), grey, 0.70), ov * 0.88);
  }
  let up = clamp(rd.y, 0.0, 1.0);
  let nightFloor = mix(vec3f(0.020, 0.030, 0.054), vec3f(0.004, 0.007, 0.020), pow(up, 0.55));
  phys = max(phys, nightFloor * (1.0 - dayFade * 0.92));
  return mix(analytic, phys, lutBlend);
}

fn sky(rd: vec3f, drawLegacyClouds: bool) -> vec3f {
  ${useF16 ? 'var col = vec3<f16>(min(max(skyBasePhys(rd), vec3f(0.0)), vec3f(60000.0)));' : 'var col = skyBasePhys(rd);'}
  let toward = max(dot(rd, g.sun), 0.0);
  if (g.day > 0.0) {
    let haloScale = mix(1.0, 0.32, shadeExtra.atmoInfo.x);
    let sunGlow = min(g.lightSun.rgb * (pow(toward, 900.0) * g.cloudTintSun.a + pow(toward, 60.0) * 0.35 * haloScale) * g.day, vec3f(60000.0));
    ${useF16 ? 'col += vec3<f16>(sunGlow);' : 'col += sunGlow;'}
  }
  if (g.day < 1.0 && g.moon.w >= 0.0) {
    let r = (1.0 + g.air.w) * (1.0 + g.air.w);
    var disc = smoothstep(1.0 - 0.00025 * r, 1.0 - 0.0002 * r, toward);
    var halo = pow(toward, 400.0 / r) * 0.06;
    if (g.moon.w > 0.0) {
      let across = (rd - g.sun * toward) / (0.02 * (1.0 + g.air.w));
      let n = across - g.sun * sqrt(max(0.0, 1.0 - dot(across, across)));
      disc *= mix(0.05, 1.0, smoothstep(-0.04, 0.04, dot(n, g.moon.xyz)));
      halo *= 0.5 - 0.5 * dot(g.sun, g.moon.xyz);
    }
    let moonAdd = vec3f(0.8, 0.86, 1.0) * (disc * 0.9 + halo) * (1.0 - g.day);
    ${useF16 ? 'col += vec3<f16>(moonAdd);' : 'col += moonAdd;'}
  }
  if (g.day < 0.98 && rd.y > 0.0) {
    let cell = rd * 220.0;
    let square = vec3i(floor(cell));
    var star = hash3i(square, 19u);
    if (star > 0.9965) { star *= 1.0 - smoothstep(0.6, 1.4, length(cell - normalize(vec3f(square) + 0.5) * 220.0) / (220.0 * g.pixel)); }
    let starAdd = vec3f(0.9, 0.93, 1.0) * smoothstep(0.9965, 1.0, star) * (1.0 - g.day) * smoothstep(0.02, 0.3, rd.y) * 0.9 * clamp(1.0 - (g.skyZenith.g - 0.012) * 40.0, 0.0, 1.0);
    ${useF16 ? 'col += vec3<f16>(starAdd);' : 'col += starAdd;'}
  }
  if (drawLegacyClouds && rd.y > 0.015) {
    let far = (15000.0 - g.eye.y) / rd.y;
    let at = (g.eye.xz + rd.xz * far) / 9000.0 + vec2f(g.time * 0.004, g.time * 0.0015);
    let thick = cloud(at);
    let cover = smoothstep(0.45, 0.64, thick) * smoothstep(0.015, 0.16, rd.y) * g.air.y;
    if (cover > 0.0) {
      var body = mix(vec3f(1.0, 0.98, 0.94), vec3f(0.6, 0.65, 0.76), smoothstep(0.54, 0.78, thick));
      if (g.low > 0.0 || g.day < 1.0) { body *= mix(g.cloudTint.rgb, g.cloudTintSun.rgb, toward); }
      let cloudCol = min(body * mix(1.25, 1.85, g.day), vec3f(60000.0));
      ${useF16 ? 'col = mix(col, vec3<f16>(cloudCol), f16(cover * 0.92));' : 'col = mix(col, cloudCol, cover * 0.92);'}
    }
  }
  return vec3f(col);
}

fn worldSolid(q: vec3f) -> bool {
  let lv1 = g.level[1];
  let rel1 = (q - lv1.boxMin) * lv1.scale;
  if (all(rel1 >= vec3f(0.0)) && all(rel1 < lv1.boxSize)) { return solidAt(vec3i(floor(rel1)), 1u); }
  return false;
}
fn worldClear(p: vec3f, n: vec3f, lPos: vec3f) -> f32 {
  let a = p + n * 2.5 + vec3f(0.0, 2.5, 0.0);
  let b = lPos + vec3f(0.0, 1.5, 0.0);
  var vis = 1.0;
  if (worldSolid(mix(a, b, 0.36))) { vis -= 0.7; }
  if (worldSolid(mix(a, b, 0.68))) { vis -= 0.7; }
  return max(vis, 0.0);
}
${localLightsEval({ withOcclusion: true, withWet: true })}

// 512-light 3D frustum-clustered local-light evaluator calibrated identically to PR #192/#208 HDR GGX
// (lights.ts scales cluster radiance by dHalf^2 and stores dHalf in extra.x, shadow in extra.y, focus in extra.w).
fn evalClusteredLocalLights(
  p: vec3f,
  n: vec3f,
  rd: vec3f,
  albedo: vec3f,
  rough: f32,
  clearcoat: f32,
  wetSurface: f32,
  allowOcclude: bool,
  viewDist: f32,
  screenUv: vec2f,
  linDepth: f32,
) -> vec3f {
  if (clusterParams.counts.x == 0u || linDepth >= clusterParams.upFar.w) { return vec3f(0.0); }
  let cIdx = clusterIndexFor(screenUv, linDepth);
  if (cIdx >= clusterParams.counts.w) { return vec3f(0.0); }
  let cell = clusterGrid[cIdx];
  if (cell.count == 0u) { return vec3f(0.0); }
  let quality = localLights.info.y;
  let occOn = LOCAL_OCCLUDE && allowOcclude && viewDist < 600.0 && (localLights.info.z & 1u) != 0u;
  let wet = localLights.grid.w * wetSurface;
  let back = reflect(rd, vec3f(0.0, 1.0, 0.0));
  let side = normalize(vec2f(-rd.z, rd.x) + vec2f(0.00001, 0.0));
  var sum = vec3f(0.0);
  let lim = min(cell.count, clusterParams.counts.y);
  let poolCap = clusterParams.counts.z;
  for (var i = 0u; i < lim; i = i + 1u) {
    let slot = cell.offset + i;
    if (slot >= poolCap) { break; }
    let li = clusterLightIndices[slot];
    if (li >= clusterParams.counts.x) { continue; }
    let l = clusterLights[li];
    let toL = l.posRange.xyz - p;
    let d2 = dot(toL, toL);
    let range = max(l.posRange.w, 1e-4);
    let r2 = range * range;
    if (d2 >= r2 || d2 <= 1e-6) { continue; }
    let invD = inverseSqrt(d2);
    let L = toL * invD;
    var spot = 1.0;
    if (l.colorType.w > -1.5) {
      let cosA = dot(-L, l.dirInner.xyz);
      if (cosA <= l.colorType.w) { continue; }
      let invSpan = 1.0 / max(l.dirInner.w - l.colorType.w, 0.001);
      let u = clamp((cosA - l.colorType.w) * invSpan, 0.0, 1.0);
      let cone = u * u * (3.0 - 2.0 * u);
      spot = mix(cone, cone * (0.38 + 0.62 * cone * cone), l.extra.w);
    }
    let norm2 = d2 / r2;
    let win = 1.0 - norm2 * norm2;
    let srcR = max(l.extra.x, 1.0);
    let att = (win * win) / (srcR * srcR + d2);
    let ndl = dot(n, L);
    if (ndl <= -0.04) { continue; }
    let diff = pow(max(ndl, 0.0), 0.72);
    var rad = l.colorType.rgb * (att * spot);
    if (occOn && l.extra.y > 0.5 && (abs(n.y) < 0.5 || d2 > 10000.0) && d2 > 900.0 && (rad.r + rad.g + rad.b) * max(diff, 0.12) > 0.10) {
      let vis = worldClear(p, n, l.posRange.xyz);
      if (vis <= 0.01) { continue; }
      rad *= vis;
    }
    sum += albedo * rad * diff;
    if (quality >= 1u && ndl > 0.0) {
      let hv = normalize(L - rd);
      let ndh = max(dot(n, hv), 0.0);
      let specBoost = select(1.0, 1.15, l.extra.w > 0.5);
      if (clearcoat > 0.05) {
        let fres = 0.06 + 0.94 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 4.0);
        let sharp = pow(ndh, 64.0) * 0.28 + pow(ndh, 16.0) * 0.055;
        sum += rad * sharp * (0.35 + 0.75 * fres) * clearcoat * specBoost;
      } else {
        let smoothness = max(1.0 - rough, 0.0);
        let shininess = mix(8.0, 64.0, smoothness);
        let spec = pow(ndh, shininess) * smoothness * smoothness * 0.38;
        sum += rad * spec * specBoost;
      }
      if (wet > 0.02) {
        let off = back - L;
        let across = dot(off.xz, side);
        let streak = exp(-across * across * 420.0 - max(dot(off, off) - across * across, 0.0) * 6.5);
        let sheen = pow(ndh, 24.0) * 0.22 + streak * 0.52;
        sum += rad * sheen * wet * specBoost * 0.65;
      }
    }
  }
  let peak = max(sum.r, max(sum.g, sum.b));
  return sum / (1.0 + max(peak - 0.12, 0.0) * 1.55);
}

fn openness(p: vec3f, n: vec3f, hit: Hit, ground: bool) -> f32 {
  let lv = g.level[hit.level];
  let front = hit.cell - lv.cells + vec3i(n);
  var u = vec3i(1, 0, 0);
  var v = vec3i(0, 0, 1);
  if (abs(n.x) > 0.5) { u = vec3i(0, 1, 0); } else if (abs(n.z) > 0.5) { v = vec3i(0, 1, 0); }
  let q = (p - lv.boxMin) * lv.scale - vec3f(hit.cell - lv.cells);
  let fu = clamp(dot(q, vec3f(u)), 0.0, 1.0);
  let fv = clamp(dot(q, vec3f(v)), 0.0, 1.0);
  let entry = sectorOf(front, hit.level);
  let whole = entry == 0u || (entry & UNIFORM) != 0u;
  var rootLo = 0u; var rootHi = 0u; var rootChild = 0u;
  var mid = 0u;
  if (!whole) { rootLo = pool[entry]; rootHi = pool[entry + 1u]; rootChild = pool[entry + 2u]; mid = midOf(entry, rootLo, rootHi, rootChild, front); }
  var side = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var i = 0; i < 4; i++) {
    let c = front + select(u, v, i >= 2) * select(-1, 1, (i & 1) == 1);
    if (all((c >> vec3u(6u)) == (front >> vec3u(6u)))) {
      if (entry != 0u) {
        if (!whole && all((c >> vec3u(4u)) == (front >> vec3u(4u)))) { side[i] = f32(solidInMid(entry, mid, c)); } else { side[i] = f32(solidIn(entry, rootLo, rootHi, rootChild, c)); }
      }
      if (ground && side[i] > 0.5) {
        let over = kindAt(c + vec3i(0, 1, 0), hit.level);
        if (over == 0u || (over & 79u) == 71u) { side[i] = 0.0; }
      }
    } else {
      let other = sectorOf(c, hit.level);
      if (other != 0u) {
        if ((other & UNIFORM) != 0u) { side[i] = f32((other & 0xffffu) != 0u); } else { side[i] = f32(solidIn(other, pool[other], pool[other + 1u], pool[other + 2u], c)); }
      }
    }
  }
  let w = side[0]; let e = side[1]; let s = side[2]; let nn = side[3];
  let c00 = 3.0 - (w + s + w * s);
  let c10 = 3.0 - (e + s + e * s);
  let c01 = 3.0 - (w + nn + w * nn);
  let c11 = 3.0 - (e + nn + e * nn);
  return mix(mix(c00, c10, fu), mix(c01, c11, fu), fv) / 3.0;
}

struct Lettered { light: vec3f, own: bool, board: bool }
fn lettered(p: vec3f, n: vec3f, lamp: bool) -> Lettered {
  var out = Lettered(vec3f(0.0), false, false);
  let count = u32(looks.letters[0].w);
  if (count == 0u || any(p < looks.letters[0].xyz) || any(p > looks.letters[1].xyz)) { return out; }
  for (var i = 0u; i < min(count, ${deps.LIT_LETTERS}u); i++) {
    let a = looks.letters[2u + 2u * i];
    let b = looks.letters[3u + 2u * i];
    let facing = u32(floor(b.w));
    let hue = (fract(b.w) - 0.5) * 2.0;
    let out_ = array<vec3f, 4>(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, 0.0, -1.0), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0))[min(facing, 3u)];
    let colour = vec3f(1.0, 0.74 + 0.06 * hue, 0.46 + 0.12 * hue);
    let inside = all(p >= a.xyz - vec3f(0.5)) && all(p <= b.xyz + vec3f(0.5));
    if (inside) {
      out.board = true;
      if (lamp) {
        out.own = true;
        out.light = min(mix(colour, vec3f(1.0, 0.95, 0.84), 0.4) * 1.15 * select(0.35, 1.0, dot(n, out_) > 0.5) * a.w, vec3f(1.19));
        return out;
      }
    }
    if (a.w <= 0.0) { continue; }
    let size = max(b.y - a.y, 1.0);
    let to = (a.xyz + b.xyz) * 0.5 + out_ * size * 0.25 - p;
    let falls = 1.0 / (1.0 + dot(to, to) / (size * size * 0.3));
    out.light += colour * a.w * falls * max(dot(n, normalize(to)), 0.0);
  }
  out.light *= 0.6;
  return out;
}

const PANE_LIGHT = ${deps.PANE_LIGHT};
fn litWindow(fine: vec3i) -> f32 {
  let w = hash3i(vec3i(fine.x >> 4u, fine.y / 30, fine.z >> 4u), 23u);
  return smoothstep(0.7, 0.72, w) * (0.35 + 0.65 * fract(w * 17.0));
}
fn inBlock(fine: vec3i) -> vec2f {
  return vec2f(f32(fine.x - i32(floor(f32(fine.x) / 1280.0)) * 1280), f32(fine.z - i32(floor(f32(fine.z) / 800.0)) * 800));
}
fn leavingShadow(ro: vec3f, rd: vec3f, hit: Hit) -> f32 {
  let lv = g.level[hit.level];
  let fine = (hit.kind & 64u) != 0u;
  if (fine && hit.out > hit.t) { return hit.out + 0.0003 / lv.scale; }
  let size = select(1.0, 0.125, fine);
  let q0 = (ro - lv.boxMin) * lv.scale / size;
  let c = floor(q0 + rd * (hit.t * lv.scale / size) + rd * 0.001);
  let out = ((c + max(sign(rd), vec3f(0.0))) - q0) * ((size / rd) / lv.scale);
  return max(min(out.x, min(out.y, out.z)), hit.t) + 0.002 * size / lv.scale;
}

struct PrimaryLit { col: vec3f, n: vec3f, rough: f32 }

// Single-site primary surface shading: evaluates paint, slope/diagonal normals, compute GTAO or legacy openness,
// shadows, GGX Metallic/Roughness PBR, night windows/landmarks, and local lights (with LOCAL_OCCLUDE / 3D clustering).
fn litPrimary(ro: vec3f, rd: vec3f, hit: Hit, shadows: u32, px: vec2i, screenUv: vec2f) -> PrimaryLit {
  let stuff = hit.kind & 15u;
  let m = looks.material[stuff];
  let p = ro + rd * hit.t;
  var at = p;
  var n = hit.n;
  let faced = dot(n, n) >= 0.5;
  if (!faced) { n = -rd; }
  let lvh = g.level[hit.level];
  let qc = clamp((p - lvh.boxMin) * lvh.scale - vec3f(hit.cell - lvh.cells), vec3f(0.0), vec3f(0.999));
  var face = n;
  let ground = stuff == 1u || stuff == 3u || stuff == 4u || stuff == 6u || stuff == 7u;
  var slope = false;
  if (ground && faced && shadows == 1u && abs(n.y) < 0.5) {
    let c = hit.cell - lvh.cells;
    let kerb = ${world.options.surveyedWalls ? 'stuff == 7u && ((kindAt(c + vec3i(n) - vec3i(0, 1, 0), hit.level) & 15u) == 6u || (kindAt(c + vec3i(n) * 2 - vec3i(0, 1, 0), hit.level) & 15u) == 6u)' : 'false'};
    if (!kerb && !solidAt(c + vec3i(0, 1, 0), hit.level) && solidAt(c + vec3i(n) - vec3i(0, 1, 0), hit.level)) {
      at = (vec3f(c) + vec3f(0.5, 1.0, 0.5)) / lvh.scale + lvh.boxMin;
      n = vec3f(0.0, 1.0, 0.0);
      face = n;
      slope = true;
    }
  }
  ${world.options.surveyedWalls ? `if (ground && faced && hit.level <= 1u && (hit.kind & 64u) == 0u) {
    let c = hit.cell - lvh.cells;
    let up = vec3i(0, 1, 0);
    var step = false;
    if (abs(hit.n.y) < 0.5) {
      let back = -vec3i(hit.n);
      step = solidAt(c + back + up, hit.level) && solidAt(c + back * 2 + up * 2, hit.level);
    } else if (!solidAt(c + up, hit.level)) {
      let beside = array<vec3i, 4>(vec3i(1, 0, 0), vec3i(-1, 0, 0), vec3i(0, 0, 1), vec3i(0, 0, -1));
      for (var i = 0u; i < 4u && !step; i++) {
        step = solidAt(c + beside[i] + up, hit.level) && solidAt(c + beside[i] * 2 + up * 2, hit.level)
          && !solidAt(c + beside[i] + up * 4, hit.level);
      }
    }
    if (step) {
      let around = array<vec3i, 13>(vec3i(3,0,0), vec3i(0,3,0), vec3i(0,0,3), vec3i(2,2,0), vec3i(2,-2,0), vec3i(2,0,2),
        vec3i(2,0,-2), vec3i(0,2,2), vec3i(0,2,-2), vec3i(2,2,2), vec3i(2,2,-2), vec3i(2,-2,2), vec3i(2,-2,-2));
      var grad = vec3f(0.0);
      for (var i = 0u; i < 13u; i++) {
        grad += vec3f(around[i]) * (f32(solidAt(c - around[i], hit.level)) - f32(solidAt(c + around[i], hit.level)));
      }
      if (grad.y > 0.0) {
        n = normalize(grad);
        at = p + n * (1.0 / lvh.scale);
        slope = true;
      }
    }
  }` : ''}
  ${world.options.surveyedWalls ? `if (faced && abs(n.y) < 0.5 && (stuff == 8u || stuff == 9u || (stuff == 7u && !slope)) && hit.level <= 2u) {
    let c = hit.cell - lvh.cells;
    let ring = array<vec2i, 8>(vec2i(5,0),vec2i(4,2),vec2i(3,3),vec2i(2,4),
                                vec2i(0,5),vec2i(-2,4),vec2i(-3,3),vec2i(-4,2));
    var outward = vec2f(0.0);
    for (var i = 0u; i < 8u; i++) {
      let d = vec3i(ring[i].x, 0, ring[i].y);
      let delta = i32(solidAt(c-d,hit.level)) - i32(solidAt(c+d,hit.level));
      outward += normalize(vec2f(ring[i])) * f32(delta);
    }
    if (length(outward) > 3.3 && dot(outward,n.xz) > 0.0) {
      let plan = normalize(outward);
      n = vec3f(plan.x,0.0,plan.y);
      face = n;
      at += n * (0.85/lvh.scale);
      slope = true;
    }
  }` : ''}
  var albedo = paint(hit.kind, hit.cell * i32(1u << hit.level), face, select(0.0, 1.0, hit.level == 0u && faced), qc, select(0.0, 1.0 / (max(hit.t, 1.0) * g.pixel), hit.level == 0u && faced));
  ${world.options.surveyedWalls ? 'if (stuff == 6u) { albedo = marked(albedo, ro, rd, hit.t); }' : ''}
  var direct = max(dot(n, g.sun), 0.0);
  if (shadows > 0u && direct > 0.0) {
    var sunny = -1.0;
    ${world.options.bricks && !world.options.fineSun ? 'at += g.sun * (1.8 * f32((hit.kind >> 6u) & 1u));' : ''}
    if (g.sunMaps != 0u) { sunny = sunlit(at, n, hit.level); }
    if (sunny < 0.0 && (shadows == 1u || g.sunMaps == 0u)) {
      let o = at + n * (0.05 / lvh.scale);
      var past = 0.0;
      var level = hit.level;
      sunny = 1.0;
      for (var k = 0; k < 24; k++) {
        let s = shadeTrace(o, g.sun, past, level, 96u, hit.t * g.pixel * 2.0, 0.04, true, false);
        if (s.t < 0.0) { break; }
        if ((((s.kind & 15u) != 11u || s.level > 1u) && ((s.kind & 79u) != 76u || s.level > 2u)) || k == 23) { sunny = 0.0; break; }
        past = leavingShadow(o, g.sun, s);
        level = s.level;
      }
    }
    var sunVis = max(sunny, 0.0);
    if (sunVis > 0.001 && shadeExtra.atmoInfo.z > 0.5) {
      let dynVis = sampleDynamicSunShadow(p + shadeExtra.anchorInfo.xyz, n);
      sunVis = min(sunVis, dynVis);
    }
    direct *= sunVis;
  }
  var directOpen = 1.0;
  var ambientAo = vec3f(1.0);
  var specAo = 1.0;
  let wide = 1.0 / (lvh.scale * max(hit.t, 1.0) * g.pixel);
  if (USE_GTAO) {
    if (shadows == 1u && (g.flags & 32u) == 0u && stuff != 5u && stuff != 15u) {
      let linZ = max(hit.t * dot(rd, g.forward), NEAR);
      let ao = sampleGtao(px, linZ);
      ambientAo = gtaoMultiBounce(ao, albedo);
      specAo = mix(ao, 1.0, 0.25);
    }
  } else {
    if (shadows == 1u && faced && !slope && (g.flags & 32u) == 0u && wide > 1.5${world.options.bricks ? ' && (hit.kind & 64u) == 0u' : ''}) {
      let o = openness(p, hit.n, hit, ground && hit.n.y > 0.5);
      directOpen = mix(1.0, 0.1 + 0.9 * o * o, clamp(wide - 1.5, 0.0, 1.0));
    }
    ambientAo = vec3f(directOpen);
    specAo = directOpen;
  }
  let ci = (hit.kind >> 8u) & 255u;
  let sign = stuff == 15u && ci != 46u;
  let surfRough = select(m.rough, min(m.rough, 0.22), (hit.kind & 128u) != 0u);
  let surfMet = select(m.metallic, max(m.metallic, 0.65), stuff == 12u && (((hit.kind & 128u) != 0u) || ci == 0u));
  ${useF16 ? 'var col = vec3<f16>(min(max(shadePbrAo(albedo, n, rd, g.sun, direct, directOpen, ambientAo, specAo, surfRough, select(m.glow, 0.0, sign), surfMet), vec3f(0.0)), vec3f(60000.0)));' : 'var col = shadePbrAo(albedo, n, rd, g.sun, direct, directOpen, ambientAo, specAo, surfRough, select(m.glow, 0.0, sign), surfMet);'}
  if (NIGHT && g.weather.z > 0.0) {
    let dark = g.weather.z;
    let letters = lettered(p, n, stuff == 15u && ci == 6u);
    let board = letters.board;
    var nightAdd = vec3f(0.0);
    if (sign && !letters.own) { nightAdd += max(albedo + (albedo - vec3f(dot(albedo, vec3f(0.333)))) * 5.0, vec3f(0.0)) * 3.2 * dark; }
    if (letters.own) {
      let c32 = mix(vec3f(col), letters.light, clamp(dot(letters.light, vec3f(1.0)), 0.0, 1.0));
      ${useF16 ? 'col = vec3<f16>(min(max(c32, vec3f(0.0)), vec3f(60000.0)));' : 'col = c32;'}
    } else { nightAdd += albedo * letters.light; }
    if (board && !letters.own && n.y > -0.5 && looks.letters[1].w > 0.0) {
      let up = clamp((p.y - looks.keep0.y) / max(looks.keep1.y - looks.keep0.y, 1.0), 0.0, 1.0);
      nightAdd += albedo * vec3f(1.0, 0.92, 0.78) * (1.5 + 1.5 * up) * clamp(dark * 3.0, 0.0, 1.0);
    }
    let boardsOff = looks.letters[1].w < 0.0 && looks.keep1.w > 0.0 && all(p >= looks.keep0.xyz) && all(p <= looks.keep1.xyz);
    if (stuff == 15u && !sign && !boardsOff) { nightAdd += vec3f(1.0, 0.85, 0.60) * 10.5 * dark; }
    let fine = hit.cell * i32(1u << hit.level);
    let block = inBlock(fine);
    let lot = (block.x >= 140.0 && block.y >= 140.0) || ${world.options.surveyedWalls ? 'true' : 'false'};
    if (stuff == 11u && lot) {
      let w = max(litWindow(fine), select(0.0, 0.8, ci == 146u));
      let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(w * 91.0)));
      let pic = screenOf(p);
      nightAdd += warm * w * dark * mix(1.5, PANE_LIGHT, smoothstep(1.5, 5.0, wide)) * (1.0 - 0.33 * f32(fine.y % 30) / 30.0) * (1.0 - pic.a) + pic.rgb * 0.8;
    }${world.options.surveyedWalls ? `
    if (faced && abs(n.y) < 0.5 && !slope && !board && hit.level >= 2u && (stuff == 7u || stuff == 8u || stuff == 9u || stuff == 10u)) {
      let s = f32(1u << hit.level);
      let q = (vec3f(fine) + qc * s) * 0.1;
      let fx = select(q.x, q.z, abs(n.x) > abs(n.z)) / 1.6;
      let fy = q.y / 3.1;
      let wBay = max(hit.t, 1.0) * g.pixel * 0.1 / 1.6;
      let inPane = smoothstep(0.24, 0.26, fract(fx)) * (1.0 - smoothstep(0.74, 0.76, fract(fx))) * smoothstep(0.24, 0.26, fract(fy)) * (1.0 - smoothstep(0.76, 0.78, fract(fy)));
      let blur = smoothstep(0.3, 0.8, wBay);
      let seed = u32(hash2i(vec2i(floor(q.xz / 40.0)) + vec2i(i32(n.x * 7.0), i32(n.z * 13.0))) * 65535.0);
      let wall = nightWall(fx, fy, wBay, wBay * 1.6 / 3.1, 0.5, 0.25, 0.52, seed, 0.0);
      var pic = vec4f(0.0);
      if (g.air.z > 0.0) {
        let mid = (floor(vec2f(fx, fy)) + 0.5 - vec2f(fx, fy)) * vec2f(16.0, 31.0);
        pic = screenOf(p + select(vec3f(mid.x, mid.y, 0.0), vec3f(0.0, mid.y, mid.x), abs(n.x) > abs(n.z)));
      }
      nightAdd += wall.rgb * wall.a * clamp(dark * 3.0, 0.0, 1.0) * mix(mix(2.4, PANE_LIGHT, smoothstep(1.5, 4.0, 0.5 / max(wBay, 0.001))), 1.5, blur) * (1.0 - pic.a) + pic.rgb * mix(inPane * 1.6, 0.26 * 2.4, blur);
    }` : `
    let out = (floor(vec2f(fine.xz) / vec2f(1280.0, 800.0)) + 0.5) * vec2f(1280.0, 800.0) - vec2f(700.0, 4070.0);
    let lamps = stuff != 5u && fine.y >= 0 && dot(out, out) < 35000.0 * 35000.0;
    var poolL = 0.0;
    let wet = select(0.0, g.weather.y, (stuff == 6u || stuff == 7u) && n.y > 0.5);
    let back = reflect(rd, vec3f(0.0, 1.0, 0.0));
    let side = normalize(vec2f(-rd.z, rd.x) + vec2f(0.00001, 0.0));
    var streak = 0.0;
    for (var k = 0; k < 9 && lamps; k++) {
      let lamp = array<vec2f, 9>(vec2f(23.0, 9.0), vec2f(131.0, 23.0), vec2f(9.0, 117.0), vec2f(117.0, 131.0), vec2f(369.0, 35.0), vec2f(673.0, 105.0), vec2f(977.0, 35.0), vec2f(35.0, 361.0), vec2f(105.0, 581.0))[k];
      var d = abs(block - lamp);
      d = min(d, vec2f(1280.0, 800.0) - d);
      poolL += 1.0 / (1.0 + dot(d, d) / 6400.0);
      if (wet > 0.0) {
        var to = lamp - block;
        to -= round(to / vec2f(1280.0, 800.0)) * vec2f(1280.0, 800.0);
        let off = back - normalize(vec3f(to.x, 68.0, to.y));
        let across = dot(off.xz, side);
        streak += exp(-across * across * 700.0 - max(dot(off, off) - across * across, 0.0) * 9.0) / (1.0 + dot(d, d) / 90000.0);
      }
    }
    if (streak > 0.0) {
      let rgh = 0.45 + 1.1 * noise2(vec2f(fine.xz) * 0.31) * noise2(vec2f(fine.zx) * 0.07);
      nightAdd += vec3f(1.0, 0.72, 0.4) * streak * rgh * wet * dark * 2.6;
    }
    nightAdd += albedo * vec3f(1.0, 0.78, 0.48) * min(poolL * poolL, 1.2) * dark * (0.12 + 0.88 * max(n.y, 0.0)) * 1.5;`}
    if (stuff == 13u) { nightAdd += leafNight(albedo, n, p) * clamp(dark * 3.0, 0.0, 1.0) * 0.6; }
    let own = landmarkLight(p, max(hit.t, 1.0) * g.pixel * 0.1);
    if (own.r + own.g + own.b > 0.0) {
      let shown = screenOf(p);
      nightAdd += own * clamp(dark * 3.0, 0.0, 1.0) * (1.0 - shown.a) + shown.rgb * min(own.g, 1.0) * 0.5;
    }
    nightAdd += landmarkLamp(p) * clamp(dark * 3.0, 0.0, 1.0);
    ${useF16 ? 'col += vec3<f16>(min(max(nightAdd, vec3f(0.0)), vec3f(60000.0)));' : 'col += nightAdd;'}
  }
  if (NIGHT && stuff != 5u) {
    if (USE_CLUSTER_LIGHTS) {
      if (clusterParams.counts.x > 0u && hit.t < 4000.0) {
        let wetSurf = select(0.0, 1.0, (stuff == 6u || stuff == 7u) && n.y > 0.5);
        let linZ = max(hit.t * dot(rd, g.forward), NEAR);
        let localAdd = evalClusteredLocalLights(p, n, rd, albedo, surfRough, 0.0, wetSurf, shadows == 1u, hit.t, screenUv, linZ);
        ${useF16 ? 'col += vec3<f16>(min(max(localAdd, vec3f(0.0)), vec3f(60000.0)));' : 'col += localAdd;'}
      }
    } else if (localLights.info.x > 0u && hit.t < 1600.0) {
      let wetSurf = select(0.0, 1.0, (stuff == 6u || stuff == 7u) && n.y > 0.5);
      let localAdd = evalLocalLights(p, n, rd, albedo, surfRough, 0.0, wetSurf, shadows == 1u, hit.t);
      ${useF16 ? 'col += vec3<f16>(min(max(localAdd, vec3f(0.0)), vec3f(60000.0)));' : 'col += localAdd;'}
    }
  }
  return PrimaryLit(vec3f(col), n, surfRough);
}

// Lightweight glass-pane own-light evaluator (avoids duplicating litPrimary for the front pane of transparent glass).
fn litPane(rd: vec3f, p: vec3f, n: vec3f, kind: u32, level: u32, cell: vec3i, t: f32, shadows: u32, screenUv: vec2f) -> vec3f {
  let m = looks.material[11u];
  let ci = (kind >> 8u) & 255u;
  let lvh = g.level[level];
  let qc = clamp((p - lvh.boxMin) * lvh.scale - vec3f(cell - lvh.cells), vec3f(0.0), vec3f(0.999));
  let albedo = paint(kind, cell * i32(1u << level), n, select(0.0, 1.0, level == 0u), qc, select(0.0, 1.0 / (max(t, 1.0) * g.pixel), level == 0u));
  var direct = max(dot(n, g.sun), 0.0);
  if (shadows > 0u && direct > 0.0 && g.sunMaps != 0u) {
    let sunny = sunlit(p, n, level);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  var col = shadePbr(albedo, n, rd, g.sun, direct, 1.0, m.rough, 0.0, 0.0);
  if (NIGHT && g.weather.z > 0.0) {
    let dark = g.weather.z;
    let fine = cell * i32(1u << level);
    let block = inBlock(fine);
    let lot = (block.x >= 140.0 && block.y >= 140.0) || ${world.options.surveyedWalls ? 'true' : 'false'};
    if (lot) {
      let scale = g.level[level].scale;
      let wide = 1.0 / (scale * max(t, 1.0) * g.pixel);
      let w = max(litWindow(fine), select(0.0, 0.8, ci == 146u));
      let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(w * 91.0)));
      let pic = screenOf(p);
      col += warm * w * dark * mix(1.5, PANE_LIGHT, smoothstep(1.5, 5.0, wide)) * (1.0 - 0.33 * f32(fine.y % 30) / 30.0) * (1.0 - pic.a) + pic.rgb * 0.8;
    }
  }
  if (NIGHT) {
    if (USE_CLUSTER_LIGHTS) {
      if (clusterParams.counts.x > 0u && t < 4000.0) {
        let linZ = max(t * dot(rd, g.forward), NEAR);
        col += evalClusteredLocalLights(p, n, rd, albedo, m.rough, 0.0, 0.0, shadows == 1u, t, screenUv, linZ);
      }
    } else if (localLights.info.x > 0u && t < 1600.0) {
      col += evalLocalLights(p, n, rd, albedo, m.rough, 0.0, 0.0, shadows == 1u, t);
    }
  }
  return col;
}

// Lean reflection hit evaluator: no openness(), no diagonal/slope normal search, no road marks, no LOCAL_OCCLUDE,
// keeping MIRRORS x NIGHT shader IR small and compilation fast on Apple Silicon Metal.
fn litReflect(ro: vec3f, rd: vec3f, hit: Hit, shadows: u32) -> vec3f {
  let stuff = hit.kind & 15u;
  let m = looks.material[stuff];
  let p = ro + rd * hit.t;
  var n = hit.n;
  if (dot(n, n) < 0.5) { n = -rd; }
  let ci = (hit.kind >> 8u) & 255u;
  var albedo = m.colour;
  if (ci != 0u) { albedo = looks.palette[ci].rgb; }
  var direct = max(dot(n, g.sun), 0.0);
  if (shadows > 0u && direct > 0.0 && g.sunMaps != 0u) {
    let sunny = sunlit(p, n, hit.level);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  let sign = stuff == 15u && ci != 46u;
  let surfRough = select(m.rough, min(m.rough, 0.22), (hit.kind & 128u) != 0u);
  let surfMet = select(m.metallic, max(m.metallic, 0.65), stuff == 12u && (((hit.kind & 128u) != 0u) || ci == 0u));
  var col = shadePbr(albedo, n, rd, g.sun, direct, 1.0, surfRough, select(m.glow, 0.0, sign), surfMet);
  if (NIGHT && g.weather.z > 0.0) {
    let dark = g.weather.z;
    if (sign) { col += max(albedo + (albedo - vec3f(dot(albedo, vec3f(0.333)))) * 5.0, vec3f(0.0)) * 3.2 * dark; }
    if (stuff == 15u && !sign) { col += vec3f(1.0, 0.85, 0.60) * 10.5 * dark; }
    let fine = hit.cell * i32(1u << hit.level);
    let block = inBlock(fine);
    let lot = (block.x >= 140.0 && block.y >= 140.0) || ${world.options.surveyedWalls ? 'true' : 'false'};
    if (stuff == 11u && lot) {
      let w = max(litWindow(fine), select(0.0, 0.8, ci == 146u));
      let warm = mix(vec3f(1.0, 0.66, 0.34), vec3f(0.62, 0.78, 1.0), step(0.93, fract(w * 91.0)));
      col += warm * w * dark * PANE_LIGHT;
    }
    let own = landmarkLight(p, max(hit.t, 1.0) * g.pixel * 0.1);
    col += (own + landmarkLamp(p)) * clamp(dark * 3.0, 0.0, 1.0);
  }
  return col;
}

fn net(at: vec2f) -> f32 {
  let a = noise2(at * 0.034 + vec2f(g.time * 0.21, g.time * 0.13));
  let b = noise2(at * 0.047 - vec2f(g.time * 0.17, g.time * 0.24) + vec2f(7.3, 1.9));
  return pow(clamp(1.0 - abs(a - b) * 3.2, 0.0, 1.0), 5.0);
}
fn deep(rd: vec3f, hit: Hit, shadows: u32, px: vec2i, screenUv: vec2f) -> PrimaryLit {
  let M = 0.1;
  let down = (g.sea - g.eye.y) * M;
  var out = 1e9;
  if (rd.y > 0.0) { out = (g.sea - g.eye.y) / rd.y; }
  let sun = normalize(vec3f(g.sun.x * 0.75, sqrt(1.0 - dot(g.sun.xz, g.sun.xz) * 0.5625), g.sun.z * 0.75));
  let strength = max(g.lightSun.r, max(g.lightSun.g, g.lightSun.b));
  let glow = mix(vec3f(0.0, 0.1, 0.19), vec3f(0.02, 0.66, 0.8), pow(smoothstep(-0.55, 1.0, rd.y), 1.6)) * exp(-down * 0.02) * (0.3 + 0.7 * strength);
  var col: vec3f;
  var outN = vec3f(0.0);
  var outR = 0.9;
  var far = min(out, 6000.0);
  if (hit.t >= 0.0) {
    far = hit.t;
    let p = g.eye + rd * hit.t;
    let under = max(g.sea - p.y, 0.0);
    let lp = litPrimary(g.eye, rd, hit, shadows, px, screenUv);
    outN = lp.n;
    outR = lp.rough;
    col = lp.col * (1.05 + 1.1 * net(p.xz + sun.xz * (under / sun.y)) * (0.15 + 0.85 * max(hit.n.y, 0.0)));
    col *= exp(-vec3f(0.075, 0.024, 0.02) * (under * M + hit.t * M * 0.4));
    col += vec3f(0.01, 0.3, 0.36) * exp(-down * 0.02) * (0.3 + 0.7 * strength) * select(0.2, 0.36, abs(hit.n.y) < 0.5);
  } else {
    let at = g.eye.xz + rd.xz * out;
    let ripple = vec2f(noise2(at * 0.09 + vec2f(g.time * 0.5, g.time * 0.3)), noise2(at.yx * 0.11 - vec2f(g.time * 0.4, g.time * 0.27))) - 0.5;
    let window = smoothstep(0.6, 0.74, rd.y + (ripple.x + ripple.y) * 0.22);
    let flat = vec2f(rd.x, rd.z) * 1.33 + ripple * 0.35;
    let bent = normalize(vec3f(flat.x, sqrt(max(1.0 - dot(flat, flat), 0.01)), flat.y));
    let wa = noise2(at * 0.13 + vec2f(g.time * 0.4, g.time * 0.23));
    let wb = noise2(at * 0.19 - vec2f(g.time * 0.31, g.time * 0.37) + vec2f(3.1, 8.7));
    let waves = pow(clamp(1.0 - abs(wa - wb) * 2.6, 0.0, 1.0), 2.0) * (0.45 + 0.55 * noise2(at * 0.023 + vec2f(g.time * 0.05, 0.0)));
    let glint = sqrt(waves) * smoothstep(0.35, 0.7, noise2(at * 0.045 + vec2f(g.time * 0.11, g.time * 0.07)));
    let mirror = glow * 0.7 + vec3f(0.3, 0.85, 0.82) * strength * waves * 0.5 + vec3f(0.55, 0.95, 0.95) * strength * glint * 0.8;
    col = mix(mirror, sky(bent, true) * vec3f(0.5, 0.72, 0.78) + g.lightSun.rgb * (net(at) * 0.4 + waves * 0.22), window);
  }
  col = mix(col, glow, 1.0 - exp(-far * M * 0.021));
  col *= 0.8;
  let towards = dot(rd, sun);
  let across = rd - sun * towards;
  let u = normalize(cross(sun, vec3f(1.0, 0.0, 0.0)));
  let round = normalize(vec2f(dot(across, u), dot(across, cross(sun, u))) + vec2f(1e-5, 0.0));
  let gathered = (noise2(round * 9.0 + g.eye.xz * 0.006 + vec2f(g.time * 0.05, g.time * 0.035)) * 0.7 + noise2(round * 23.0 - vec2f(g.time * 0.04, g.time * 0.06)) * 0.3) * (0.55 + 0.9 * noise2(round * 2.3 - vec2f(g.time * 0.03, 0.0) + vec2f(4.1, 9.2)));
  let shafts = smoothstep(0.42, 0.68, gathered) * (1.0 - exp(-far * M * 0.05)) * smoothstep(-0.35, 0.25, towards) * exp(-down * 0.03) * smoothstep(-0.55, 0.35, rd.y);
  col += g.lightSun.rgb * vec3f(0.25, 0.88, 0.95) * (shafts * 0.62 + pow(max(towards, 0.0), 6.0) * 0.25);
  return PrimaryLit(col, outN, outR);
}

// Analytic screen-space motion vector (prevUV - jitUV) from anchor-relative world position (or sky direction when visT < 0).
// Because rd passes through the jittered screen coordinate jitUV while prevViewProj is unjittered,
// subtracting jitUV cancels Halton(2, 3) jitter exactly so static world/sky pixels produce velocity == (0, 0).
fn motionVector(rd: vec3f, visT: f32, jitUV: vec2f) -> vec2f {
  if (shadeExtra.info.x < 0.5) { return vec2f(0.0); }
  let prevClip = select(shadeExtra.prevViewProj * vec4f(rd, 0.0), shadeExtra.prevViewProj * vec4f(g.eye + rd * visT, 1.0), visT >= 0.0);
  if (prevClip.w <= 1e-4) { return vec2f(2.0, 2.0); }
  let prevNdc = prevClip.xy / prevClip.w;
  let prevUV = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
  return prevUV - jitUV;
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

// MRT layout stays <= 32 bytes/sample (24 B with rg11b10ufloat color):
//   @location(0) colour    : sceneFormat (rg11b10ufloat / rgba16float / rgba8unorm)
//   @location(1) velocity  : rg16float (analytic prevUV - jitUV motion vectors)
//   @location(2) visNormal : rgba16float (world-space normal xyz, roughness w; 0 for sky)
//   @location(3) panes     : rgba16float (attached only when MIRRORS is true)
struct Drawn {
  @location(0) colour: vec4f,
  @location(1) velocity: vec2f,
  @location(2) visNormal: vec4f,
  @location(3) panes: vec4f,
  @builtin(frag_depth) depth: f32,
}

fn depthOf(t: f32, rd: vec3f) -> f32 {
  if (t < 0.0) { return 1.0; }
  return clamp(FAR / (FAR - NEAR) * (1.0 - NEAR / max(t * dot(rd, g.forward), NEAR)), 0.0, 1.0);
}

@fragment fn fs(@builtin(position) at: vec4f) -> Drawn {
  let px = vec2i(at.xy);
  let jitUV = (at.xy + shadeExtra.jitter.xy) / g.res;
  let uv = jitUV * 2.0 - 1.0;
  var rd = normalize(g.forward + g.right * (uv.x * g.tanHalf * g.aspect) - g.up * (uv.y * g.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  let shadows = g.flags & 1u;

  let v0 = textureLoad(vis0Tex, px, 0);
  let v1 = textureLoad(vis1Tex, px, 0);
  let packed = v0.w;
  let hitValid = ((packed >> 23u) & 1u) != 0u;
  let hasPane = MIRRORS && (((packed >> 24u) & 1u) != 0u) && v1.y >= 0.0;
  work = u32(max(v1.w, 0.0));

  var hit: Hit;
  hit.t = select(-1.0, v1.x, hitValid);
  hit.kind = packed & 0xffffu;
  hit.level = (packed >> 16u) & 15u;
  hit.n = unpackFace((packed >> 20u) & 7u);
  hit.cell = bitcast<vec3i>(v0.xyz);
  hit.left = !hitValid;
  hit.out = 0.0;

  if ((g.flags & 16u) != 0u) {
    var v = 0u;
    if (hit.t >= 0.0) { v = (u32(clamp(hit.t, 0.0, 131071.0) * 8.0) & 0xfffffu) | ((hit.kind & 15u) << 20u) | (((hit.kind >> 8u) & 255u) << 24u); }
    let d = depthOf(hit.t, rd);
    return Drawn(vec4f(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u), f32(v >> 24u)) / 255.0, vec2f(0.0), vec4f(0.0), vec4f(0.0), d);
  }

  if (UNDERWATER && (g.flags & 128u) != 0u) {
    let d = depthOf(hit.t, rd);
    let dp = deep(rd, hit, shadows, px, jitUV);
    let vel = motionVector(rd, hit.t, jitUV);
    if ((g.flags & 4u) != 0u) {
      let h = f32(work) / 128.0;
      return Drawn(vec4f(h * 2.0, h * h * 2.0, pow(h, 4.0) * 2.0, 1.0), vel, vec4f(dp.n, dp.rough), vec4f(0.0), d);
    }
    if ((g.flags & 8u) != 0u) { return Drawn(vec4f(f32(work & 255u) / 255.0, f32(work >> 8u) / 255.0, 0.0, 1.0), vel, vec4f(dp.n, dp.rough), vec4f(0.0), d); }
    return Drawn(vec4f(max(dp.col, vec3f(0.0)), 1.0), vel, vec4f(dp.n, dp.rough), vec4f(0.0), d);
  }

  // Fast pure-sky early exit (zero material/lighting/reflection work).
  if (!hasPane && hit.t < 0.0) {
    var col = sky(rd, shadeExtra.atmoInfo.y < 0.5);
    if (FOGGY) { col = inFog(col, rd, 1e7); }
    let vel = motionVector(rd, -1.0, jitUV);
    if ((g.flags & 4u) != 0u) {
      let h = f32(work) / 128.0;
      return Drawn(vec4f(h * 2.0, h * h * 2.0, pow(h, 4.0) * 2.0, 1.0), vel, vec4f(0.0), vec4f(0.0), 1.0);
    }
    if ((g.flags & 8u) != 0u) { return Drawn(vec4f(f32(work & 255u) / 255.0, f32(work >> 8u) / 255.0, 0.0, 1.0), vel, vec4f(0.0), vec4f(0.0), 1.0); }
    return Drawn(vec4f(max(col, vec3f(0.0)), 1.0), vel, vec4f(0.0), vec4f(0.0), 1.0);
  }

  let airColour = hazeColour(rd);
  var col = vec3f(0.0);
  var keep = vec3f(1.0);
  var seenThrough = vec4f(0.0);
  var first = hit.t;
  var visT = hit.t;
  var outN = vec3f(0.0);
  var outRough = 0.9;
  var lights = shadows;
  roomLit = 1.0;
  skyLit = 1.0;

  // Optional front glass pane looked through (discovered in Pass 1 when MIRRORS is active).
  var shadeBehind = true;
  if (hasPane) {
    let pane1T = v1.y;
    first = pane1T;
    let pMeta = u32(v1.z);
    let pCi = pMeta & 255u;
    let pKf = (pMeta >> 8u) & 15u;
    let pFace = (pMeta >> 12u) & 7u;
    let pThick = f32((pMeta >> 15u) & 255u) * 0.125;
    let pane1Kind = 11u | (pKf << 4u) | (pCi << 8u);
    let pane1Level = (packed >> 25u) & 15u;
    let lv1 = g.level[pane1Level];
    let p1 = g.eye + rd * pane1T;
    let pane1Cell = vec3i(floor((g.eye + rd * (pane1T + 0.001 / lv1.scale) - lv1.boxMin) * lv1.scale)) + lv1.cells;
    var n1 = unpackFace(pFace);
    if (dot(n1, n1) < 0.5) { n1 = -rd; }
    var own1 = litPane(rd, p1, n1, pane1Kind, pane1Level, pane1Cell, pane1T, shadows, jitUV);
    var lamp1 = 0.0;
    if (NIGHT && g.weather.z > 0.0) {
      let fine1 = pane1Cell * i32(1u << pane1Level);
      let lot1 = inBlock(fine1);
      if (((lot1.x >= 140.0 && lot1.y >= 140.0) || ${world.options.surveyedWalls ? 'true' : 'false'}) && (litWindow(fine1) > 0.0 || pCi == 146u)) {
        lamp1 = clamp(g.weather.z * 3.0, 0.0, 1.0);
      }
      if (g.air.z > 0.0) { lamp1 = max(lamp1, screenOf(p1).a); }
    }
    var mir1 = glassMirror(rd, n1) * (1.0 - lamp1);
    own1 *= mix(0.1, 1.0, lamp1);
    var add1 = own1;
    if (mir1 > 0.0) {
      let back1 = reflect(rd, n1);
      let safe1 = select(back1, vec3f(0.00001), abs(back1) < vec3f(0.00001));
      add1 += sky(safe1, true) * 0.8 * mir1;
    }
    var through1 = glassTint(pane1Kind, pThick + 0.5) * 0.94 * (1.0 - mir1) * (1.0 - lamp1);
    let across1 = 1.0 / (lv1.scale * max(pane1T, 1.0) * g.pixel);
    let q1 = (p1 - lv1.boxMin) * lv1.scale;
    let side1 = min(q1, lv1.boxSize - q1);
    let edge1 = select(1e9, min(side1.x, min(side1.y, side1.z)), pane1Level == 1u);
    let fade1 = smoothstep(${deps.THROUGH}, ${deps.THROUGH} * 1.5, across1) * smoothstep(0.0, 48.0, edge1) * smoothstep(0.33, 0.26, mir1);
    if (fade1 < 1.0) {
      let room1 = (g.lightFill.rgb * 0.3 + g.lightSun.rgb * g.lightSun.a * 0.12) * 0.35 * INDOORS;
      add1 += through1 * (1.0 - fade1) * room1;
      through1 *= fade1;
    }
    col += add1;
    keep = through1;
    if (fade1 > 0.0 && max(keep.r, max(keep.g, keep.b)) >= 0.02) {
      seenThrough = vec4f(keep, pane1T);
      lights = shadows * 2u;
      roomLit = 0.0;
      skyLit = mix(INDOORS, 1.0, g.weather.w);
    } else {
      shadeBehind = false;
      visT = pane1T;
      outN = n1;
      outRough = looks.material[11u].rough;
    }
  }

  // Primary opaque surface (or surface behind the first transparent glass pane).
  if (shadeBehind) {
    if (hit.t < 0.0) {
      col += keep * sky(rd, true);
      visT = -1.0;
      outN = vec3f(0.0);
    } else {
      let stuff = hit.kind & 15u;
      let glass = stuff == 11u && MIRRORS;
      let scale = g.level[hit.level].scale;
      let m = looks.material[stuff];
      let lp = litPrimary(g.eye, rd, hit, select(lights, lights * 2u, glass), px, jitUV);
      var own = lp.col;
      var n = lp.n;
      outN = n;
      outRough = lp.rough;
      let p = g.eye + rd * hit.t;
      let across = 1.0 / (scale * max(hit.t, 1.0) * g.pixel);
      var mirror = m.mirror;
      var ask = false;
      var lamp = 0.0;
      let polished = (hit.kind & 128u) != 0u;
      if (glass) {
        let fine = hit.cell * i32(1u << hit.level);
        let lot = inBlock(fine);
        if (NIGHT && g.weather.z > 0.0 && ((lot.x >= 140.0 && lot.y >= 140.0) || ${world.options.surveyedWalls ? 'true' : 'false'}) && (litWindow(fine) > 0.0 || ((hit.kind >> 8u) & 255u) == 146u)) {
          lamp = clamp(g.weather.z * 3.0, 0.0, 1.0);
        }
        if (NIGHT && g.air.z > 0.0) { lamp = max(lamp, screenOf(p).a); }
        mirror = glassMirror(rd, n);
        if (polished) { mirror = max(mirror, 0.62); }
        mirror *= 1.0 - lamp;
        own *= mix(0.1, 1.0, lamp);
        ask = across >= 2.0 && mirror * max(keep.r, max(keep.g, keep.b)) > 0.12;
      } else {
        if (polished) { mirror = max(mirror, 0.62); }
        if (g.weather.y > 0.0 && (stuff == 6u || stuff == 7u) && hit.n.y > 0.5) {
          let place = vec2f((hit.cell * i32(1u << hit.level)).xz);
          mirror = g.weather.y * (0.45 + 0.5 * smoothstep(0.42, 0.6, noise2(place * 0.023)));
          own *= 1.0 - 0.35 * g.weather.y;
          n = normalize(n + vec3f(noise2(p.xz * 0.23) - 0.5, 0.0, noise2(p.zx * 0.29) - 0.5) * 0.022);
        }
        if (stuff == 5u) {
          let ripple = vec2f(noise2(p.xz * 0.11 + vec2f(g.time * 0.5, g.time * 0.31)), noise2(p.zx * 0.13 - vec2f(g.time * 0.43, g.time * 0.27))) - 0.5
            + (vec2f(noise2(p.xz * 0.37 - vec2f(g.time * 0.9, 0.0)), noise2(p.zx * 0.41 + vec2f(0.0, g.time * 0.8))) - 0.5) * 0.5;
          n = normalize(n + vec3f(ripple.x, 0.0, ripple.y) * 0.16 * clamp(600.0 / hit.t, 0.0, 1.0));
          outN = n;
        }
        let fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
        mirror = clamp(mirror * (0.25 + 0.75 * fresnel), 0.0, 1.0);
        ask = (stuff == 5u && hit.t < 6000.0) || (stuff != 5u && across >= 2.0);
      }
      var add = own;
      if (mirror > 0.0 && MIRRORS) {
        var back = reflect(rd, n);
        if (stuff == 5u && back.y < 0.02) { back = normalize(vec3f(back.x, 0.02, back.z)); }
        var safe = select(back, vec3f(0.00001), abs(back) < vec3f(0.00001));
        if (stuff == 5u) { safe = vec3f(abs(safe.x) * select(-1.0, 1.0, rd.x > 0.0), safe.y, abs(safe.z) * select(-1.0, 1.0, rd.z > 0.0)); }
        var seen = sky(safe, true) * 0.8;
        if (ask) {
          let coarse = select(2.0, 6.0, stuff == 5u);
          let far = shadeTrace(p + n * (0.05 / scale), safe, 0.0, hit.level, 64u, hit.t * g.pixel * coarse, g.pixel * coarse, stuff == 5u, stuff == 5u);
          seen = sky(safe, true);
          if (far.t >= 0.0) { seen = air(litReflect(p, safe, far, shadows * 2u), safe, far.t); }
        }
        if (glass) { add += seen * mirror; } else { add = mix(own, seen, mirror); }
        if (stuff == 5u) {
          let flat = reflect(rd, vec3f(0.0, 1.0, 0.0));
          let toward = dot(normalize(flat.xz + vec2f(0.0001, 0.0)), vec2f(g.skyHorizonSun.a, g.cloudTint.a));
          let rise = flat.y - g.sun.y;
          let glint = 0.35 + 1.3 * noise2(p.xz * 0.05 + vec2f(g.time * 1.1, g.time * 0.8)) * noise2(p.zx * 0.21 - vec2f(g.time * 0.7, g.time * 1.3));
          add += mix(vec3f(0.8, 0.86, 1.0) * 0.25, g.lightSun.rgb * 3.6, g.day) * pow(max(toward, 0.0), 300.0) * exp(-rise * rise * 5.0) * glint;
        }
      }
      if (glass) {
        let through2 = glassTint(hit.kind, 1.5) * 0.94 * (1.0 - mirror) * (1.0 - lamp);
        let room2 = (g.lightFill.rgb * 0.3 + g.lightSun.rgb * g.lightSun.a * 0.12) * 0.35 * INDOORS;
        add += through2 * select(room2, skyBasePhys(vec3f(rd.x, max(rd.y, 0.02) * 0.3, rd.z)) * 0.7, hasPane);
      }
      if (hasPane) {
        add = mix(add, airColour, 1.0 - (1.0 - haze(rd, hit.t)) / max(1.0 - haze(rd, first), 0.0001));
      }
      col += keep * add;
      visT = hit.t;
    }
  }

  if (first >= 0.0) {
    let hazed = mix(col, airColour, haze(rd, first));
    let apBlend = shadeExtra.atmoInfo.x * shadeExtra.skyOvercast.y;
    if (apBlend > 0.001) {
      let ap = sampleAerialPerspective(jitUV, first * 0.0001);
      let apScatter = ap.rgb * shadeExtra.skySunDir.w * shadeExtra.skyOvercast.w;
      let phys = col * clamp(ap.a, 0.0, 1.0) + apScatter;
      col = mix(hazed, phys, apBlend);
    } else {
      col = hazed;
    }
  }
  if (FOGGY) { col = inFog(col, rd, select(1e7, first, first >= 0.0)); }
  let depth = depthOf(visT, rd);
  let vel = motionVector(rd, visT, jitUV);
  let visN = select(vec4f(0.0), vec4f(outN, outRough), visT >= 0.0);

  if ((g.flags & 4u) != 0u) {
    let h = f32(work) / 128.0;
    return Drawn(vec4f(h * 2.0, h * h * 2.0, pow(h, 4.0) * 2.0, 1.0), vel, visN, seenThrough, depth);
  }
  if ((g.flags & 8u) != 0u) {
    return Drawn(vec4f(f32(work & 255u) / 255.0, f32(work >> 8u) / 255.0, 0.0, 1.0), vel, visN, seenThrough, depth);
  }
  return Drawn(vec4f(max(col, vec3f(0.0)), 1.0), vel, visN, seenThrough, depth);
}
`
}
