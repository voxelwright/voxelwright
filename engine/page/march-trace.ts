// Pass 0 (1/4-res conservative beam pre-pass), Pass 1 (compute primary geometry + glass visibility pass),
// and sun-map tile pass for Voxelwright's deferred visibility-buffer marcher (#165).
//
// Splitting pure octree traversal out of lighting/shading cuts register pressure dramatically on Apple Silicon
// Metal, eliminates 2x2 fragment helper-quad waste on silhouette edges, skips empty sky/air at 1/16th pixel cost,
// and keeps Metal shader compilation well under 1 s across every mode permutation.
import type { World } from './world.ts'

export interface TraceCodeDeps {
  GLOBALS: string
  HANDOVER: string
  EDITED: (boxes: string) => string
  GLASS: string
  LIT_LETTERS: number
  EDITS: number
  TRIES: number
  THROUGH: string
  PANES: number
  INLOOP: boolean
}

/** Shared WGSL helpers for packing/unpacking cardinal face normals and visibility-buffer metadata. */
export const VIS_PACK_WGSL = /* wgsl */ `
fn packFace(n: vec3f) -> u32 {
  let a = abs(n);
  if (a.x + a.y + a.z < 0.5) { return 0u; }
  if (a.x >= a.y && a.x >= a.z) { return select(2u, 1u, n.x > 0.0); }
  if (a.y >= a.z) { return select(4u, 3u, n.y > 0.0); }
  return select(6u, 5u, n.z > 0.0);
}
fn unpackFace(idx: u32) -> vec3f {
  switch idx {
    case 1u: { return vec3f(1.0, 0.0, 0.0); }
    case 2u: { return vec3f(-1.0, 0.0, 0.0); }
    case 3u: { return vec3f(0.0, 1.0, 0.0); }
    case 4u: { return vec3f(0.0, -1.0, 0.0); }
    case 5u: { return vec3f(0.0, 0.0, 1.0); }
    case 6u: { return vec3f(0.0, 0.0, -1.0); }
    default: { return vec3f(0.0); }
  }
}
fn packVis0W(kind: u32, level: u32, faceIdx: u32, hitValid: bool, hasPane: bool, paneLevel: u32) -> u32 {
  return (kind & 0xffffu)
    | ((level & 15u) << 16u)
    | ((faceIdx & 7u) << 20u)
    | (u32(hitValid) << 23u)
    | (u32(hasPane) << 24u)
    | ((paneLevel & 15u) << 25u);
}
// Packs first-pane metadata into 23 exact integer bits stored safely in f32 (never NaN/Inf).
fn packPaneMeta(kind: u32, faceIdx: u32, thickCells: f32) -> f32 {
  let ci = (kind >> 8u) & 255u;
  let kf = (kind >> 4u) & 15u;
  let th = u32(clamp(round(thickCells * 8.0), 0.0, 255.0));
  return f32(ci | (kf << 8u) | ((faceIdx & 7u) << 12u) | (th << 15u));
}
`

const TRACE_PARAMS_WGSL = /* wgsl */ `
struct TraceParams {
  // Active full-res pixel rect: x=ox, y=oy, z=ow, w=oh
  onlyRect: vec4u,
  // Active 1/4-res beam rect: x=bx0, y=by0, z=bx1, w=by1
  beamRect: vec4u,
  // x=beamW, y=beamH, z=useBeam (0 or 1), w=pad
  beamFull: vec4u,
}
`

/** Shared 64-tree constants, bit helpers, and node lookup routines (used by trace, beam, sun, and shade). */
export const treeCommonWgsl = (world: World) => {
  const grid = world.options.grid
  const slots = grid[0] * grid[1] * grid[2]
  const roofs = slots + (slots / 64) * 2
  const blockRoofs = roofs + grid[0] * grid[2]
  return /* wgsl */ `
const GRID = vec3u(${grid[0]}u, ${grid[1]}u, ${grid[2]}u);
const SLOTS = ${slots}u;
const STRIDE = ${world.stride}u;
const ROOFS = ${roofs}u;
const BLOCK_ROOFS = ${blockRoofs}u;
const UNIFORM = 0x80000000u;

struct Hit { t: f32, kind: u32, n: vec3f, level: u32, cell: vec3i, left: bool, out: f32 }
var<private> work: u32;

fn has(lo: u32, hi: u32, i: u32) -> bool {
  return ((select(lo, hi, i >= 32u) >> (i & 31u)) & 1u) != 0u;
}
fn before(lo: u32, hi: u32, i: u32) -> u32 {
  if (i >= 32u) { return countOneBits(lo) + countOneBits(hi & ((1u << (i - 32u)) - 1u)); }
  return countOneBits(lo & ((1u << i) - 1u));
}
struct Met { near: vec3f, leave: f32 }
fn meet(lo: vec3f, hi: vec3f, q0: vec3f, k: vec3f) -> Met {
  let a = (lo - q0) * k;
  let b = (hi - q0) * k;
  let far = max(a, b);
  return Met(min(a, b), min(far.x, min(far.y, far.z)));
}
fn sectorOf(c: vec3i, L: u32) -> u32 {
  let lv = g.level[L];
  if (any(c < vec3i(0)) || any(c >= vec3i(lv.boxSize))) { return 0u; }
  let w = (vec3u(c >> vec3u(6u)) + lv.wrap) & (GRID - 1u);
  let base = L * STRIDE;
  let sup = w >> vec3u(2u);
  let at = base + SLOTS + 2u * (sup.x + (GRID.x >> 2u) * (sup.z + (GRID.z >> 2u) * sup.y));
  if (!has(top[at], top[at + 1u], (w.x & 3u) + 4u * (w.z & 3u) + 16u * (w.y & 3u))) { return 0u; }
  return top[base + w.x + GRID.x * (w.z + GRID.z * w.y)];
}
fn midOf(entry: u32, rootLo: u32, rootHi: u32, rootChild: u32, c: vec3i) -> u32 {
  let cm = vec3u(c >> vec3u(4u)) & vec3u(3u);
  let bit = cm.x + 4u * cm.z + 16u * cm.y;
  if (!has(rootLo, rootHi, bit)) { return 0u; }
  let mid = entry + (rootChild & 0xfffffu) + 4u * before(rootLo, rootHi, bit);
  let info = pool[mid + 3u];
  if ((info & UNIFORM) != 0u) { return select(0u, 1u, (info & 0xffffu) != 0u); }
  return mid;
}
fn solidInMid(entry: u32, mid: u32, c: vec3i) -> bool {
  if (mid < 2u) { return mid == 1u; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  let midLo = pool[mid]; let midHi = pool[mid + 1u];
  if (!has(midLo, midHi, bit)) { return false; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return (pool[leaf + 3u] & 0xffffu) != 0u; }
  let cc = vec3u(c) & vec3u(3u);
  return has(pool[leaf], pool[leaf + 1u], cc.x + 4u * cc.z + 16u * cc.y);
}
fn solidIn(entry: u32, rootLo: u32, rootHi: u32, rootChild: u32, c: vec3i) -> bool {
  if ((entry & UNIFORM) != 0u) { return (entry & 0xffffu) != 0u; }
  return solidInMid(entry, midOf(entry, rootLo, rootHi, rootChild, c), c);
}
fn solidAt(c: vec3i, L: u32) -> bool {
  let entry = sectorOf(c, L);
  if (entry == 0u) { return false; }
  if ((entry & UNIFORM) != 0u) { return (entry & 0xffffu) != 0u; }
  return solidIn(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
}
fn kindAt(c: vec3i, L: u32) -> u32 {
  let entry = sectorOf(c, L);
  if (entry == 0u) { return 0u; }
  if ((entry & UNIFORM) != 0u) { return entry & 0xffffu; }
  let mid = midOf(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
  if (mid < 2u) { return mid; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let midLo = pool[mid]; let midHi = pool[mid + 1u];
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  if (!has(midLo, midHi, bit)) { return 0u; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return pool[leaf + 3u] & 0xffffu; }
  let leafLo = pool[leaf]; let leafHi = pool[leaf + 1u];
  let cc = vec3u(c) & vec3u(3u);
  let cell = cc.x + 4u * cc.z + 16u * cc.y;
  if (!has(leafLo, leafHi, cell)) { return 0u; }
  let nth = before(leafLo, leafHi, cell);
  return (pool[entry + pool[leaf + 2u] + (nth >> 1u)] >> (16u * (nth & 1u))) & 0xffffu;
}
`
}

/** Fine-cell (4x4x4 / 8x8x8 sub-cell) traversal WGSL shared between primary trace, sun maps, and shadow/reflection trace. */
export const fineCellWgsl = (tries: number) => ({
  FINER: /* wgsl */ `
fn fineWord(entry: u32, c: vec3i) -> u32 {
  if (entry == 0u || (entry & UNIFORM) != 0u) { return 0u; }
  let mid = midOf(entry, pool[entry], pool[entry + 1u], pool[entry + 2u], c);
  if (mid < 2u) { return 0u; }
  let cl = vec3u(c >> vec3u(2u)) & vec3u(3u);
  let midLo = pool[mid]; let midHi = pool[mid + 1u];
  let bit = cl.x + 4u * cl.z + 16u * cl.y;
  if (!has(midLo, midHi, bit)) { return 0u; }
  let leaf = entry + (pool[mid + 2u] & 0xfffffu) + 4u * before(midLo, midHi, bit);
  if ((pool[leaf + 3u] & UNIFORM) != 0u) { return 0u; }
  let leafLo = pool[leaf]; let leafHi = pool[leaf + 1u];
  let cc = vec3u(c) & vec3u(3u);
  let cell = cc.x + 4u * cc.z + 16u * cc.y;
  if (!has(leafLo, leafHi, cell)) { return 0u; }
  let nth = before(leafLo, leafHi, cell);
  let kinds = entry + pool[leaf + 2u];
  if (((pool[kinds + (nth >> 1u)] >> (16u * (nth & 1u))) & 64u) == 0u) { return 0u; }
  return pool[kinds + ((countOneBits(leafLo) + countOneBits(leafHi) + 1u) >> 1u) + nth];
}
`,
  REFINE: /* wgsl */ `
struct Fine { t: f32, kind: u32, n: vec3f, leave: f32, out: f32, side: vec3f }
fn finer(ro: vec3f, rd: vec3f, hit: Hit) -> Fine {
  let lv = g.level[hit.level];
  let c = hit.cell - lv.cells;
  let q0 = (ro - lv.boxMin) * lv.scale;
  let k = (1.0 / rd) / lv.scale;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  let out = ((vec3f(c) + ahead) - q0) * k;
  var r: Fine;
  r.kind = 0u;
  r.leave = min(out.x, min(out.y, out.z)) + 0.002 / lv.scale;
  r.side = select(select(vec3f(0.0, 0.0, -f32(toward.z)), vec3f(0.0, -f32(toward.y), 0.0), out.y <= out.z), vec3f(-f32(toward.x), 0.0, 0.0), out.x <= out.y && out.x <= out.z);
  let entry = sectorOf(c, hit.level);
  let word = fineWord(entry, c);
  if (word == 0u) { return r; }
  let block = entry + (word & 0x7fffffffu);
  let side = select(4, 8, (word >> 31u) != 0u);
  let fs = f32(side);
  let words = u32(side * side * side) >> 5u;
  var sub = clamp(vec3i(floor((q0 + rd * (hit.t * lv.scale) - vec3f(c)) * fs)), vec3i(0), vec3i(side - 1));
  var next = ((vec3f(c) + (vec3f(sub) + ahead) / fs) - q0) * k;
  let each = abs(k) / fs;
  r.t = hit.t;
  r.n = hit.n;
  for (var j = 0; j < 24; j++) {
    let bit = u32(sub.x + side * (sub.z + side * sub.y));
    if (((pool[block + (bit >> 5u)] >> (bit & 31u)) & 1u) != 0u) {
      r.out = min(next.x, min(next.y, next.z));
      let one = pool[block + words];
      if ((one & UNIFORM) != 0u) { r.kind = (one & 0xffffu) | 64u; return r; }
      var i = countOneBits(pool[block + (bit >> 5u)] & ((1u << (bit & 31u)) - 1u));
      for (var w = 0u; w < (bit >> 5u); w++) { i += countOneBits(pool[block + w]); }
      r.kind = ((pool[block + words + 1u + (i >> 1u)] >> (16u * (i & 1u))) & 0xffffu) | 64u;
      return r;
    }
    if (next.x <= next.y && next.x <= next.z) {
      r.t = next.x; next.x += each.x; sub.x += toward.x; r.n = vec3f(-f32(toward.x), 0.0, 0.0);
    } else if (next.y <= next.z) {
      r.t = next.y; next.y += each.y; sub.y += toward.y; r.n = vec3f(0.0, -f32(toward.y), 0.0);
    } else {
      r.t = next.z; next.z += each.z; sub.z += toward.z; r.n = vec3f(0.0, 0.0, -f32(toward.z));
    }
    if (any(sub < vec3i(0)) || any(sub >= vec3i(side))) { break; }
    work++;
  }
  return r;
}
fn refine(ro: vec3f, rd: vec3f, met: Hit, most: u32, wide: f32, spread: f32, rough: bool, eyed: bool) -> Hit {
  var hit = met;
  for (var tries = 0u; tries < ${tries}u; tries++) {
    if ((wide + spread * hit.t) * g.level[hit.level].scale >= 1.0) { break; }
    let f = finer(ro, rd, hit);
    if (f.kind != 0u) { hit.t = f.t; hit.kind = f.kind; hit.n = f.n; hit.out = f.out; break; }
    let leave = f.leave;
    hit = march(ro, rd, leave, hit.level, most, wide, spread, rough, false, eyed);
    if (hit.t >= 0.0 && hit.t <= leave + 0.5 / g.level[hit.level].scale && dot(hit.n, hit.n) < 0.5) { hit.n = f.side; }
    if ((hit.kind & 64u) == 0u) { break; }
  }
  return hit;
}
`,
  BLOCK: /* wgsl */ `
          if ((kind & 64u) == 0u || width >= 1.0) { break; }
          let word = pool[leafChild + ((countOneBits(leafLo) + countOneBits(leafHi) + 1u) >> 1u) + nth];
          let block = entry + (word & 0x7fffffffu);
          let fside = select(4, 8, (word >> 31u) != 0u);
          let ff = f32(fside);
          let fwords = u32(fside * fside * fside) >> 5u;
          var sub = clamp(vec3i(floor((q0 + rd * (t * lv.scale) - vec3f(cell)) * ff)), vec3i(0), vec3i(fside - 1));
          var fnext = ((vec3f(cell) + (vec3f(sub) + ahead) / ff) - q0) * k;
          var ft = t;
          var fnorm = n;
          var found = false;
          var fbit = 0u;
          for (var j = 0; j < 24; j++) {
            fbit = u32(sub.x + fside * (sub.z + fside * sub.y));
            if (((pool[block + (fbit >> 5u)] >> (fbit & 31u)) & 1u) != 0u) { found = true; break; }
            if (fnext.x <= fnext.y && fnext.x <= fnext.z) {
              ft = fnext.x; fnext.x += each.x / ff; sub.x += toward.x; fnorm = vec3f(-f32(toward.x), 0.0, 0.0);
            } else if (fnext.y <= fnext.z) {
              ft = fnext.y; fnext.y += each.y / ff; sub.y += toward.y; fnorm = vec3f(0.0, -f32(toward.y), 0.0);
            } else {
              ft = fnext.z; fnext.z += each.z / ff; sub.z += toward.z; fnorm = vec3f(0.0, 0.0, -f32(toward.z));
            }
            if (any(sub < vec3i(0)) || any(sub >= vec3i(fside))) { break; }
            work++;
          }
          if (found) {
            let one = pool[block + fwords];
            if ((one & UNIFORM) != 0u) { kind = (one & 0xffffu) | 0x10040u; } else {
              var fi = countOneBits(pool[block + (fbit >> 5u)] & ((1u << (fbit & 31u)) - 1u));
              for (var w = 0u; w < (fbit >> 5u); w++) { fi += countOneBits(pool[block + w]); }
              kind = ((pool[block + fwords + 1u + (fi >> 1u)] >> (16u * (fi & 1u))) & 0xffffu) | 0x10040u;
            }
            t = ft;
            n = fnorm;
            break;
          }
          kind = 0u;`,
})

/**
 * Generates Pass 0 — 1/4-Res Conservative Cone Beam Pre-Pass WGSL.
 * Marches at ceil(w/4) x ceil(h/4) into a persistent r32float beamDepth texture.
 * Conservative guarantees (zero clipping of thin wires, poles, roofs, or building corners):
 *  - Treats FINE sub-cell voxels as full cells (never calls refine()).
 *  - Stops immediately on non-empty 4/16/64/256-cell hierarchy nodes whenever cone spacing reaches their tier.
 *  - Inflates tight AABBs by conservative cone margin so a narrow pole inside a larger node cannot slip past.
 *  - Pulls back by max(2.0 / lv.scale, 6.0 * g.pixel * t) cells so Pass 1 always begins strictly in empty air.
 */
export function beamCode(world: World, deps: TraceCodeDeps, behind = false): string {
  return /* wgsl */ `
${deps.GLOBALS}
${TRACE_PARAMS_WGSL}

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(1) @binding(0) var<uniform> tp: TraceParams;
@group(1) @binding(1) var beamOut: texture_storage_2d<r32float, write>;

${treeCommonWgsl(world)}

fn beamMarch(ro: vec3f, rd: vec3f, t0: f32, most: u32) -> f32 {
  let inv = 1.0 / rd;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  let beamSpread = g.pixel * 4.0 * max(g.detail, 1.0);
  var t = t0;
  var L = 0u;
  var have = 0u;
  var held = vec3i(0);
  var supAt = 0xffffffffu;
  var supLo = 0u; var supHi = 0u;
  var entry = 0u; var rootLo = 0u; var rootHi = 0u; var rootChild = 0u;
  var midLo = 0u; var midHi = 0u; var midChild = 0u;
  var leafLo = 0u; var leafHi = 0u;
  var lv: Level;
  var q0 = vec3f(0.0);
  var k = vec3f(0.0);
  var eps = 0.0;
  var leaveAt = 0.0;
  var last = vec3i(0);
  var fresh = true;
  for (var i = 0u; i < most; i++) {
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
      let roof = lv.roofs[u32(rd.x > 0.0) + 2u * u32(rd.z > 0.0)];
      if (rd.y > 0.0) {
        let tRoof = (roof - ro.y) * inv.y;
        let rPad = max(2.0 / lv.scale, beamSpread * max(tRoof, 0.0) * 1.25);
        leaveAt = min(leaveAt, (roof + rPad - ro.y) * inv.y);
      }
      if (rd.y < 0.0 && ro.y > g.sea) { leaveAt = min(leaveAt, (g.sea - ro.y) * inv.y); }
      have = 0u;
      supAt = 0xffffffffu;
      fresh = false;
      if (comeAt > t || leaveAt <= t) { L += 1u; fresh = true; continue; }
      if (rd.y < 0.0) {
        let tRoof = (roof - ro.y) * inv.y;
        let rPad = max(2.0 / lv.scale, beamSpread * max(tRoof, 0.0) * 1.25);
        if (ro.y + rd.y * t > roof + rPad) {
          let drop = min((roof + rPad - ro.y) * inv.y, leaveAt);
          if (drop > t) { t = drop + eps; }
        }
      }
    }
    if (t >= leaveAt) { L += 1u; fresh = true; continue; }
    let q = q0 + rd * (t * lv.scale);
    let c = clamp(vec3i(floor(q)), vec3i(0), last);
    let moved = c ^ held;
    let apart = u32(moved.x | moved.y | moved.z);
    if (apart >= 64u) { have = 0u; } else if (apart >= 16u) { have = min(have, 1u); } else if (apart >= 4u) { have = min(have, 2u); }
    held = c;
    // Conservative beam spacing in level-L cells (1.25x safety margin covers diagonal pixel offsets).
    let cw = beamSpread * t * lv.scale * 1.25;
    var size = 0;
    var low = c;
    var skip = -1.0;
    if (have == 0u) {
      let kSec = c >> vec3u(6u);
      let w = (vec3u(kSec) + lv.wrap) & (GRID - 1u);
      let base = L * STRIDE;
      let sup = w >> vec3u(2u);
      // Cone-conservative column/block roof skip: keep cone strictly above roofTop + cw.
      var roofTop = f32(bitcast<i32>(top[base + BLOCK_ROOFS + sup.x + (GRID.x >> 2u) * sup.z]) - lv.cells.y);
      var across = 256.0;
      var corner = vec2f((kSec.xz - vec2i(w.xz & vec2u(3u))) * 64);
      var roofOk = cw < 48.0;
      if (!roofOk || q.y <= roofTop + cw) {
        roofTop = f32(bitcast<i32>(top[base + ROOFS + w.x + GRID.x * w.z]) - lv.cells.y);
        across = 64.0;
        corner = vec2f(kSec.xz * 64);
        roofOk = cw < 12.0;
      }
      if (roofOk && q.y > roofTop + cw) {
        let o = ((corner + ahead.xz * across) - q0.xz) * k.xz;
        let leave = min(o.x, o.y);
        if (q0.y + rd.y * (leave * lv.scale) > roofTop + cw) {
          t = min(max(leave, t), leaveAt) + eps;
          continue;
        }
        let down = (roofTop + cw - q0.y) * k.y;
        if (down > t) {
          t = down + eps;
          continue;
        }
      }
      let at = base + SLOTS + 2u * (sup.x + (GRID.x >> 2u) * (sup.z + (GRID.z >> 2u) * sup.y));
      if (at != supAt) { supAt = at; supLo = top[at]; supHi = top[at + 1u]; }
      if ((supLo | supHi) == 0u) {
        size = 256;
        low = (kSec - vec3i(w & vec3u(3u))) * 64;
      } else if (cw >= 48.0) {
        return max(t0, t - max(2.0 / lv.scale, beamSpread * t * 1.5));
      } else if (!has(supLo, supHi, (w.x & 3u) + 4u * (w.z & 3u) + 16u * (w.y & 3u))) {
        size = 64;
        low = kSec * 64;
      } else {
        entry = top[base + w.x + GRID.x * (w.z + GRID.z * w.y)];
        if ((entry & UNIFORM) != 0u || cw >= 12.0) {
          return max(t0, t - max(2.0 / lv.scale, beamSpread * t * 1.5));
        } else {
          let info = pool[entry + 3u];
          let child = pool[entry + 2u];
          let pad = vec3f(max(cw, select(0.0, select(4.0, 16.0, cw >= 3.0), cw >= 0.75)));
          let sMin = vec3f(kSec * 64);
          let sMax = sMin + vec3f(64.0);
          let bLo = max(sMin, vec3f(kSec * 64 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u)) * 4) - pad);
          let bHi = min(sMax, vec3f(kSec * 64 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u) * 4) + pad);
          let m = meet(bLo, bHi, q0, k);
          let enter = max(m.near.x, max(m.near.y, m.near.z));
          if (m.leave <= max(enter, t)) {
            size = 64;
            low = kSec * 64;
          } else {
            rootLo = pool[entry]; rootHi = pool[entry + 1u]; rootChild = entry + (child & 0xfffffu);
            have = 1u;
            if (enter > t) { skip = enter; }
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
        if ((info & UNIFORM) != 0u || cw >= 3.0) {
          return max(t0, t - max(2.0 / lv.scale, beamSpread * t * 1.5));
        }
        let child = pool[node + 2u];
        let pad = vec3f(max(cw, select(0.0, 4.0, cw >= 0.75)));
        let mMin = vec3f(kMid * 16);
        let mMax = mMin + vec3f(16.0);
        let bLo = max(mMin, vec3f(kMid * 16 + vec3i((vec3u(info) >> vec3u(16u, 20u, 24u)) & vec3u(15u))) - pad);
        let bHi = min(mMax, vec3f(kMid * 16 + vec3i(((vec3u(child) >> vec3u(20u, 24u, 28u)) & vec3u(15u)) + 1u)) + pad);
        let m = meet(bLo, bHi, q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 16;
          low = kMid * 16;
        } else {
          midLo = pool[node]; midHi = pool[node + 1u]; midChild = entry + (child & 0xfffffu);
          have = 2u;
          if (enter > t) { skip = enter; }
        }
      }
    }
    if (have == 2u && skip < 0.0 && size == 0) {
      let kLeaf = c >> vec3u(2u);
      let cc = vec3u(kLeaf) & vec3u(3u);
      let bit = cc.x + 4u * cc.z + 16u * cc.y;
      if (!has(midLo, midHi, bit)) {
        size = 4;
        low = kLeaf * 4;
      } else {
        let node = midChild + 4u * before(midLo, midHi, bit);
        let info = pool[node + 3u];
        if ((info & UNIFORM) != 0u || cw >= 0.75) {
          return max(t0, t - max(2.0 / lv.scale, beamSpread * t * 1.5));
        }
        let pad = vec3f(cw);
        let lMin = vec3f(kLeaf * 4);
        let lMax = lMin + vec3f(4.0);
        let bLo = max(lMin, vec3f(kLeaf * 4 + vec3i((vec3u(info) >> vec3u(16u, 18u, 20u)) & vec3u(3u))) - pad);
        let bHi = min(lMax, vec3f(kLeaf * 4 + vec3i(((vec3u(info) >> vec3u(22u, 24u, 26u)) & vec3u(3u)) + 1u)) + pad);
        let m = meet(bLo, bHi, q0, k);
        let enter = max(m.near.x, max(m.near.y, m.near.z));
        if (m.leave <= max(enter, t)) {
          size = 4;
          low = kLeaf * 4;
        } else {
          leafLo = pool[node]; leafHi = pool[node + 1u];
          have = 3u;
          if (enter > t) { skip = enter; }
        }
      }
    }
    if (skip >= 0.0) {
      t = skip + eps;
      continue;
    }
    if (have == 3u && size == 0) {
      var cell = c;
      let leaf = c >> vec3u(2u);
      var side = ((vec3f(cell) + ahead) - q0) * k;
      let each = abs(k);
      loop {
        let cc = vec3u(cell) & vec3u(3u);
        let bit = cc.x + 4u * cc.z + 16u * cc.y;
        if (has(leafLo, leafHi, bit)) {
          return max(t0, t - max(2.0 / lv.scale, beamSpread * t * 1.5));
        }
        if (side.x <= side.y && side.x <= side.z) {
          t = side.x; side.x += each.x; cell.x += toward.x;
        } else if (side.y <= side.z) {
          t = side.y; side.y += each.y; cell.y += toward.y;
        } else {
          t = side.z; side.z += each.z; cell.z += toward.z;
        }
        if (any((cell >> vec3u(2u)) != leaf)) { break; }
      }
      t += eps;
      continue;
    }
    let out = ((vec3f(low) + ahead * f32(size)) - q0) * k;
    let next = min(out.x, min(out.y, out.z));
    t = min(max(next, t), leaveAt) + eps;
  }
  // Exited all boxes cleanly: check sea plane before emitting sky sentinel (1e30).
  if (L >= g.levels) {
    if (rd.y < 0.0 && ro.y > g.sea) {
      let tSea = (g.sea - ro.y) / rd.y;
      let p = ro + rd * tSea;
      for (var k2 = 0u; k2 < g.levels; k2++) {
        let q = (p.xz - g.level[k2].boxMin.xz) * g.level[k2].scale;
        if (all(q >= vec2f(0.0)) && all(q < g.level[k2].boxSize.xz)) {
          return max(t0, tSea - max(2.0 / g.level[k2].scale, beamSpread * tSea * 1.5));
        }
      }
    }
    return 1e30;
  }
  // Ran out of steps: conservatively return current distance minus pullback (never sky).
  let sL = g.level[min(L, g.levels - 1u)].scale;
  return max(t0, t - max(2.0 / sL, beamSpread * t * 1.5));
}

@compute @workgroup_size(8, 8)
fn cs_beam(@builtin(global_invocation_id) gid: vec3u) {
  let bpx = tp.beamRect.xy + gid.xy;
  if (bpx.x >= tp.beamRect.z || bpx.y >= tp.beamRect.w) { return; }
  let at = vec2f(bpx) * 4.0 + vec2f(2.0);
  let uv = (at / g.res) * 2.0 - 1.0;
  var rd = normalize(g.forward + g.right * (uv.x * g.tanHalf * g.aspect) - g.up * (uv.y * g.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  ${behind ? `let toward = dot(rd, g.starts.xyz);
  let begins = select(0.0, max(0.0, (g.starts.w - dot(g.eye, g.starts.xyz)) / toward), toward != 0.0);` : 'let begins = 0.0;'}
  let d = beamMarch(g.eye, rd, begins, g.most);
  textureStore(beamOut, vec2i(bpx), vec4f(d, 0.0, 0.0, 0.0));
}
`
}

/** Shared core octree `march()` + `trace()` WGSL used by both Pass 1 (`cs_vis`) and `fs_sun`. */
function marchTraceCoreWgsl(world: World, deps: TraceCodeDeps, withFarModel: boolean, withThrough: boolean): string {
  const fine = fineCellWgsl(deps.TRIES)
  const marched = `var hit = march(ro, rd, t0, level0, most, wide, spread, rough, through, eyed);${
    world.options.bricks && !deps.INLOOP ? `\n  if ((hit.kind & 64u) != 0u && !through) { hit = refine(ro, rd, hit, most, wide, spread, rough, eyed); }` : ''
  }`
  return /* wgsl */ `
${withFarModel ? `
${deps.HANDOVER}
${deps.EDITED('looks.edits')}
fn farHeld(p: vec3f) -> bool {
  let t = vec2i(floor((p.xz - looks.far.xy) / looks.far.z));
  if (any(t < vec2i(0)) || any(t >= vec2i(64))) { return false; }
  let bit = u32(t.y * 64 + t.x);
  let word = bit >> 5u;
  return ((looks.cover[word >> 2u][word & 3u] >> (bit & 31u)) & 1u) != 0u;
}
fn beforeBox(next: f32, lo: vec4f, hi: vec4f, ro: vec3f, inv: vec3f, t: f32) -> f32 {
  if (hi.w <= 0.0) { return next; }
  let m = meet(lo.xyz, hi.xyz, ro, inv);
  let enter = max(m.near.x, max(m.near.y, m.near.z));
  return select(next, enter, enter > t && enter < min(next, m.leave));
}
fn farExit(ro: vec3f, rd: vec3f, inv: vec3f, p: vec3f, t: f32) -> f32 {
  let tile = floor((p.xz - looks.far.xy) / looks.far.z);
  let sides = looks.far.xy + (tile + vec2f(rd.xz > vec2f(0.0))) * looks.far.z;
  let ends = (sides - ro.xz) * inv.xz;
  var next = min(ends.x, ends.y);
  for (var i = 0u; i < ${deps.EDITS}u; i++) {
    next = beforeBox(next, looks.edits[2u * i], looks.edits[2u * i + 1u], ro, inv, t);
  }
  if (t < looks.far.w) {
    let d = ro.xz - looks.wedge.xy;
    for (var i = 0u; i < 2u; i++) {
      let normal = vec2f(cos(looks.bear[i]), sin(looks.bear[i]));
      let along = dot(rd.xz, normal);
      if (abs(along) > 1e-8) {
        let cross = -dot(d, normal) / along;
        if (cross > t) { next = min(next, cross); }
      }
    }
    let a = dot(rd.xz, rd.xz);
    let b = dot(d, rd.xz);
    let c = dot(d, d) - looks.wedge.z * looks.wedge.z;
    let leave = (-b + sqrt(max(0.0, b * b - a * c))) / a;
    next = min(next, max(t, leave));
    next = beforeBox(next, looks.keep0, looks.keep1, ro, inv, t);
  }
  return next;
}
` : ''}
fn march(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool, eyed: bool) -> Hit {
  var hit: Hit;
  hit.t = -1.0;
  let inv = 1.0 / rd;
  let ahead = max(sign(rd), vec3f(0.0));
  let toward = vec3i(sign(rd));
  var t = t0;
  var n = vec3f(0.0);
  var L = level0;
  let plain = (g.flags & 64u) != 0u;
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
  ${withFarModel ? 'var skipping = false;' : ''}
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
      if (rd.y > 0.0 && !plain) { leaveAt = min(leaveAt, (roof - ro.y) * inv.y); }
      if (rd.y < 0.0 && ro.y > g.sea && !through) { leaveAt = min(leaveAt, (g.sea - ro.y) * inv.y); }
      have = 0u;
      supAt = 0xffffffffu;
      fresh = false;
      if (comeAt > t || leaveAt <= t) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
      if (rd.y < 0.0 && ro.y + rd.y * t > roof && !plain) { t = min((roof - ro.y) * inv.y, leaveAt) + eps; }
    }
    if (t >= leaveAt) { L += select(1u, 2u, rough && L > level0); fresh = true; continue; }
    var size = 0;
    var low = vec3i(0);
    var kind = 0u;
    var cell = vec3i(0);
    ${withFarModel ? 'if (!FAR_MODEL || !skipping) {' : ''}
    let q = q0 + rd * (t * lv.scale);
    let c = clamp(vec3i(floor(q)), vec3i(0), last);
    let moved = c ^ held;
    let apart = u32(moved.x | moved.y | moved.z);
    if (apart >= 64u) { have = 0u; } else if (apart >= 16u) { have = min(have, 1u); } else if (apart >= 4u) { have = min(have, 2u); }
    held = c;
    let width = (wide + spread * t) * lv.scale;
    low = c;
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
      if (q.y > roofTop && !plain) {
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
      if ((supLo | supHi) == 0u && !plain) {
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
    cell = c;
    if (have == 3u && size == 0 && kind == 0u) {
      let leaf = c >> vec3u(2u);
      var side = ((vec3f(cell) + ahead) - q0) * k;
      let each = abs(k);
      loop {
        let cc = vec3u(cell) & vec3u(3u);
        let bit = cc.x + 4u * cc.z + 16u * cc.y;
        let full = has(leafLo, leafHi, bit);
        if (full && !through) {
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
        ${withThrough ? `if (full${world.options.bricks && deps.INLOOP ? ' && through' : ''}) {
          let nth = before(leafLo, leafHi, bit);
          let kv = (pool[leafChild + (nth >> 1u)] >> (16u * (nth & 1u))) & 0xffffu;
          if (((kv & 15u) != 11u || L > 1u) && ((kv & 79u) != 76u || L > 2u)) { hit.t = t; hit.kind = 1u; }
        }` : ''}
        if (any((cell >> vec3u(2u)) != leaf)) { break; }
        work++;
      }
      if (kind == 0u) { t += eps; continue; }
    }
    ${withFarModel ? '}' : ''}
    if (${withFarModel ? '((FAR_MODEL && skipping) || kind != 0u)' : 'kind != 0u'} && !through) {
      ${withFarModel ? `if (FAR_MODEL && eyed && looks.far.w > 0.0 && all(ro == g.eye)) {
        let p = ro + rd * (t + 0.25 * eps);
        let reach = select(reachAt(p, looks.far.w, looks.wedge, looks.bear, looks.keep0, looks.keep1), looks.far.w, (g.flags & 256u) != 0u);
        if (t > reach && farHeld(p) && !edited(p)) {
          let next = farExit(ro, rd, inv, p, t);
          if (next <= t) { hit.t = -1.0; hit.left = true; return hit; }
          t = next + eps;
          skipping = true;
          have = 0u;
          continue;
        }
      }
      if (FAR_MODEL && skipping) { skipping = false; continue; }` : ''}
      hit.t = t;
      hit.kind = kind & 0xffffu;
      hit.n = n;
      hit.level = L;
      hit.cell = cell + lv.cells;
      return hit;
    }
    let out = ((vec3f(low) + ahead * f32(size)) - q0) * k;
    let next = min(out.x, min(out.y, out.z));
    ${withThrough ? `if (kind != 0u && (((kind & 15u) != 11u || L > 1u) && ((kind & 79u) != 76u || L > 2u))) { hit.t = max(next, t); hit.kind = kind & 0xffffu; }` : ''}
    n = -sign(rd) * vec3f(out <= vec3f(next));
    t = min(max(next, t), leaveAt) + eps;
  }
  hit.level = min(L, g.levels - 1u);
  hit.left = L >= g.levels;
  return hit;
}
${world.options.bricks || world.options.fineSun ? fine.FINER + (world.options.bricks && !deps.INLOOP ? fine.REFINE : '') : ''}
fn trace(ro: vec3f, rd: vec3f, t0: f32, level0: u32, most: u32, wide: f32, spread: f32, rough: bool, through: bool, eyed: bool) -> Hit {
  ${marched}
  if (through || rd.y >= 0.0 || ro.y <= g.sea) { return hit; }
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
`
}

/**
 * Generates Pass 1 — Pure Primary Geometry & Glass Visibility Compute Shader WGSL.
 * Reads min of 2x2 beamDepth neighborhood as t0, runs ONLY trace() + optional glass pane discovery,
 * and writes compact vis0 (rgba32uint) + vis1 (rgba32float) with ZERO lighting/paint/localLights registers.
 */
export function visCode(world: World, deps: TraceCodeDeps, behind = false): string {
  return /* wgsl */ `
${deps.GLOBALS}
${TRACE_PARAMS_WGSL}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, metallic: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16>, far: vec4f, cover: array<vec4u, 32>, wedge: vec4f, bear: vec4f, keep0: vec4f, keep1: vec4f, letters: array<vec4f, ${2 + 2 * deps.LIT_LETTERS}>, edits: array<vec4f, ${2 * deps.EDITS}> }

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(0) @binding(3) var<uniform> looks: Looks;
@group(1) @binding(0) var<uniform> tp: TraceParams;
@group(1) @binding(1) var beamIn: texture_2d<f32>;
@group(1) @binding(2) var vis0Out: texture_storage_2d<rgba32uint, write>;
@group(1) @binding(3) var vis1Out: texture_storage_2d<rgba32float, write>;

override MIRRORS: bool = true;
override FAR_MODEL: bool = false;
override UNDERWATER: bool = false;

${treeCommonWgsl(world)}
${VIS_PACK_WGSL}
${deps.GLASS}
${marchTraceCoreWgsl(world, deps, true, false)}

fn leaving(ro: vec3f, rd: vec3f, hit: Hit, whole: bool) -> f32 {
  let lv = g.level[hit.level];
  let fine = (hit.kind & 64u) != 0u && !whole;
  if (fine && hit.out > hit.t) { return hit.out + 0.0003 / lv.scale; }
  let size = select(1.0, 0.125, fine);
  let q0 = (ro - lv.boxMin) * lv.scale / size;
  let c = floor(q0 + rd * (hit.t * lv.scale / size) + rd * 0.001);
  let out = ((c + max(sign(rd), vec3f(0.0))) - q0) * ((size / rd) / lv.scale);
  return max(min(out.x, min(out.y, out.z)), hit.t) + 0.002 * size / lv.scale;
}
fn paneEnd(rd: vec3f, hit: Hit, leave: f32) -> f32 {
  let lv = g.level[hit.level];
  let q0 = (g.eye - lv.boxMin) * lv.scale;
  let k = (1.0 / rd) / lv.scale;
  let ahead = max(sign(rd), vec3f(0.0));
  var out = leave;
  for (var j = 0; j < 3; j++) {
    let c = vec3i(floor(q0 + rd * (out * lv.scale)));
    if (any(c < vec3i(0)) || any(c >= vec3i(lv.boxSize)) || (kindAt(c, hit.level) & 15u) != 11u) { break; }
    let side = ((vec3f(c) + ahead) - q0) * k;
    out = max(min(side.x, min(side.y, side.z)), out) + 0.002 / lv.scale;
  }
  return out;
}

@compute @workgroup_size(8, 8)
fn cs_vis(@builtin(global_invocation_id) gid: vec3u) {
  let px = tp.onlyRect.xy + gid.xy;
  if (px.x >= tp.onlyRect.x + tp.onlyRect.z || px.y >= tp.onlyRect.y + tp.onlyRect.w) { return; }
  work = 0u;
  let at = vec2f(px) + vec2f(0.5);
  let uv = (at / g.res) * 2.0 - 1.0;
  var rd = normalize(g.forward + g.right * (uv.x * g.tanHalf * g.aspect) - g.up * (uv.y * g.tanHalf));
  rd = select(rd, vec3f(0.00001), abs(rd) < vec3f(0.00001));
  ${behind ? `let toward = dot(rd, g.starts.xyz);
  let begins = select(0.0, max(0.0, (g.starts.w - dot(g.eye, g.starts.xyz)) / toward), toward != 0.0);` : 'let begins = 0.0;'}
  var t0 = begins;
  if (tp.beamFull.z != 0u) {
    let bDim = vec2i(tp.beamFull.xy);
    let f = (at * 0.25) - vec2f(0.5);
    let b0 = clamp(vec2i(floor(f)), vec2i(0), bDim - vec2i(1));
    let b1 = min(b0 + vec2i(1), bDim - vec2i(1));
    let d00 = textureLoad(beamIn, b0, 0).r;
    let d10 = textureLoad(beamIn, vec2i(b1.x, b0.y), 0).r;
    let d01 = textureLoad(beamIn, vec2i(b0.x, b1.y), 0).r;
    let d11 = textureLoad(beamIn, b1, 0).r;
    let bMin = min(min(d00, d10), min(d01, d11));
    if (bMin >= 1e29) {
      textureStore(vis0Out, vec2i(px), vec4u(0u, 0u, 0u, 0u));
      textureStore(vis1Out, vec2i(px), vec4f(-1.0, -1.0, 0.0, 0.0));
      return;
    }
    t0 = max(begins, bMin);
  }
  var hit = trace(g.eye, rd, t0, 0u, g.most, 0.0, g.pixel * g.detail, false, false, true);
  if (UNDERWATER && (g.flags & 128u) != 0u && rd.y > 0.0 && hit.t > (g.sea - g.eye.y) / rd.y) {
    hit.t = -1.0;
  }
  if (hit.t < 0.0) {
    textureStore(vis0Out, vec2i(px), vec4u(0u, 0u, 0u, 0u));
    textureStore(vis1Out, vec2i(px), vec4f(-1.0, -1.0, 0.0, f32(work)));
    return;
  }
  // When MIRRORS is active and the primary ray meets face-on glass at L0..L1, walk past the pane and trace
  // the surface behind it so Pass 2 shades both layers with zero primary ray-march registers.
  if (MIRRORS && (!UNDERWATER || (g.flags & 128u) == 0u) && (g.flags & 16u) == 0u && (hit.kind & 15u) == 11u && hit.level <= 1u) {
    let scale = g.level[hit.level].scale;
    let across = 1.0 / (scale * max(hit.t, 1.0) * g.pixel);
    var n1 = hit.n;
    if (dot(n1, n1) < 0.5) { n1 = -rd; }
    let polished = (hit.kind & 128u) != 0u;
    var mir1 = glassMirror(rd, n1);
    if (polished) { mir1 = max(mir1, 0.62); }
    let goes = across >= ${deps.THROUGH} && ${deps.PANES}u > 1u && mir1 < 0.33;
    if (goes) {
      let whole = (hit.kind & 64u) != 0u && hit.t * g.pixel * max(g.detail, 2.0) * 2.0 * scale >= 1.0;
      var leave = leaving(g.eye, rd, hit, whole);
      if ((hit.kind & 64u) == 0u || whole) { leave = paneEnd(rd, hit, leave); }
      let pane1T = hit.t;
      let pane1Kind = hit.kind;
      let pane1Face = packFace(hit.n);
      let pane1Level = hit.level;
      var totalThick = max(leave - pane1T, 0.0);
      var tNext = leave;
      var lvlNext = hit.level;
      var lastLeave = leave;
      let spread2 = g.pixel * max(g.detail, 2.0);
      let most2 = min(g.most, 128u);
      var hit2: Hit;
      hit2.t = -1.0;
      for (var k = 0u; k < 4u; k++) {
        hit2 = trace(g.eye, rd, tNext, lvlNext, most2, tNext * spread2, spread2, false, false, true);
        if (hit2.t < 0.0) { break; }
        let sc2 = g.level[hit2.level].scale;
        if ((hit2.kind & 15u) == 11u && hit2.t <= lastLeave + 0.01 / sc2 && k < 3u) {
          let whole2 = (hit2.kind & 64u) != 0u && hit2.t * g.pixel * max(g.detail, 2.0) * 2.0 * sc2 >= 1.0;
          var lv2 = leaving(g.eye, rd, hit2, whole2);
          if ((hit2.kind & 64u) == 0u || whole2) { lv2 = paneEnd(rd, hit2, lv2); }
          totalThick += max(lv2 - hit2.t, 0.0);
          lastLeave = lv2; tNext = lv2; lvlNext = hit2.level;
          continue;
        }
        break;
      }
      let valid2 = hit2.t >= 0.0;
      let cell2 = select(vec3u(0u), bitcast<vec3u>(hit2.cell), valid2);
      let w2 = packVis0W(select(0u, hit2.kind, valid2), select(0u, hit2.level, valid2), select(0u, packFace(hit2.n), valid2), valid2, true, pane1Level);
      textureStore(vis0Out, vec2i(px), vec4u(cell2, w2));
      textureStore(vis1Out, vec2i(px), vec4f(hit2.t, pane1T, packPaneMeta(pane1Kind, pane1Face, totalThick), f32(work)));
      return;
    }
  }
  let face = packFace(hit.n);
  textureStore(vis0Out, vec2i(px), vec4u(bitcast<vec3u>(hit.cell), packVis0W(hit.kind, hit.level, face, true, false, 0u)));
  textureStore(vis1Out, vec2i(px), vec4f(hit.t, -1.0, 0.0, f32(work)));
}
`
}

/**
 * Generates the dedicated Sun-Map Tile shader module (`vs` + `fs_sun`).
 * Kept separate from shading/lighting/far-model so it compiles in a few milliseconds.
 */
export function sunCode(world: World, deps: TraceCodeDeps): string {
  return /* wgsl */ `
${deps.GLOBALS}
struct SunTile { corner: vec2f, texel: f32, level: u32, origin: vec2f, pad: vec2f }

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> pool: array<u32>;
@group(0) @binding(2) var<storage, read> top: array<u32>;
@group(1) @binding(0) var<uniform> sunTile: SunTile;

${treeCommonWgsl(world)}
${marchTraceCoreWgsl(world, deps, false, true)}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}

@fragment fn fs_sun(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = sunTile.corner + (at.xy - sunTile.origin - 0.5) * sunTile.texel;
  let o = g.sunU * uv.x + g.sunV * uv.y + g.sun * dot(g.eye, g.sun);
  let lv = g.level[sunTile.level];
  let a = (lv.boxMin - o) / g.sun;
  let b = (lv.boxMin + lv.boxSize / lv.scale - o) / g.sun;
  let near = min(a, b);
  let far = max(a, b);
  let come = max(near.x, max(near.y, near.z));
  if (come >= min(far.x, min(far.y, far.z))) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  let hit = trace(o, g.sun, come + 0.01 * sunTile.texel, sunTile.level, 768u, 0.0, 0.0, false, true, false);
  if (hit.kind == 0u) { return vec4f(-1e30, 0.0, 0.0, 1.0); }
  ${world.options.fineSun ? `let inside = vec3i(floor((o + g.sun * (hit.t - 0.01 / lv.scale) - lv.boxMin) * lv.scale));
  let marked = fineWord(sectorOf(inside, sunTile.level), inside) != 0u;
  return vec4f(bitcast<f32>((bitcast<u32>(dot(o, g.sun) + hit.t + g.sunFar) & 0xfffffffeu) | u32(marked)), 0.0, 0.0, 1.0);` : 'return vec4f(dot(o, g.sun) + hit.t + g.sunFar, 0.0, 0.0, 1.0);'}
}
`
}
