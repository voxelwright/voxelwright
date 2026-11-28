// Solid toroidal-roll explosion billows & close-range 3D flame tongues (#226).
//
// Ported from Small Magic (MIT) `src/billows.js` and `src/flames.js` into Voxelwright's raw
// WebGPU pipeline (1 cell = 0.1 m, Y-up, standard [0, 1] depth matching `to.depth`).
//
// Explosion billows are depth-tested solid subdivided icospheres arranged in three parts:
//   - cap   (46 instances): rising, flattening mushroom head
//   - stem  (14 instances): ascending column beneath the cap
//   - skirt (24 instances): expanding ground shock ring, first to dissipate
// Every billow's pose, overturning rotation, crust cooling, and eat-away dissolution is a pure
// function of `age = clock - born`, so Time Rewind (`setClock`) runs explosions backward cleanly.
//
// Close-range burning cells (< 240 cells = 24 m) spawn depth-tested instanced 3D tapered flame
// tubes (10x8 rings) with rising swellings, snaking bends, neck pinch-off, and view-angle
// temperature shading (white-gold core to orange-red rim).
import { DEPTH, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

const CAP = 46
const STEM = 14
const SKIRT = 24
const PER_BLAST = CAP + STEM + SKIRT // 84 billows per blast
const MAX_BLASTS = 8
const MAX_BILLOW_INSTANCES = MAX_BLASTS * PER_BLAST // 672
const MAX_BLAST_AGE = 11.5

const FLAME_RINGS = 10
const FLAME_SIDES = 8
const MAX_FLAME_SITES = 512
const MAX_TONGUES = 2048
const FLAME_MAX_DIST = 240 // 24 m in 10 cm cells
const FLAME_TTL = 0.18 // seconds a reported flame site remains active without refresh

/** Deterministic Mulberry32 PRNG for reproducible billow shapes per blast seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Subdivided unit icosphere (detail 3 => 642 vertices, 1280 triangles, indexed uint16). */
function buildIcosphere(detail = 3): { positions: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const phi = (1 + Math.sqrt(5)) * 0.5
  const rawVerts: number[] = [
    -1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi, 0,
    0, -1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi,
    phi, 0, -1, phi, 0, 1, -phi, 0, -1, -phi, 0, 1,
  ]
  const verts: number[] = []
  for (let i = 0; i < rawVerts.length; i += 3) {
    const x = rawVerts[i], y = rawVerts[i + 1], z = rawVerts[i + 2]
    const inv = 1 / Math.hypot(x, y, z)
    verts.push(x * inv, y * inv, z * inv)
  }
  let tris: number[] = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]
  const midpointCache = new Map<number, number>()
  const midpoint = (a: number, b: number): number => {
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = lo * 65536 + hi
    const hit = midpointCache.get(key)
    if (hit !== undefined) return hit
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2]
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2]
    const mx = ax + bx, my = ay + by, mz = az + bz
    const inv = 1 / Math.hypot(mx, my, mz)
    const idx = verts.length / 3
    verts.push(mx * inv, my * inv, mz * inv)
    midpointCache.set(key, idx)
    return idx
  }
  for (let d = 0; d < detail; d++) {
    const next: number[] = []
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i], b = tris[i + 1], c = tris[i + 2]
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
    }
    tris = next
  }
  const posBuf = new ArrayBuffer(verts.length * 4)
  const positions = new Float32Array(posBuf)
  positions.set(verts)
  const idxBuf = new ArrayBuffer(tris.length * 2)
  const indices = new Uint16Array(idxBuf)
  indices.set(tris)
  return { positions, indices }
}

/** Tapered 3D flame tube geometry: `FLAME_RINGS` x `FLAME_SIDES` (10x8 rings). */
function buildFlameTube(): { positions: Float32Array<ArrayBuffer>; indices: Uint16Array<ArrayBuffer> } {
  const vertCount = (FLAME_RINGS + 1) * FLAME_SIDES
  const posBuf = new ArrayBuffer(vertCount * 3 * 4)
  const positions = new Float32Array(posBuf)
  let o = 0
  for (let i = 0; i <= FLAME_RINGS; i++) {
    const v = i / FLAME_RINGS
    for (let s = 0; s < FLAME_SIDES; s++) {
      const a = (s / FLAME_SIDES) * Math.PI * 2
      positions[o++] = Math.cos(a)
      positions[o++] = v
      positions[o++] = Math.sin(a)
    }
  }
  const idxCount = FLAME_RINGS * FLAME_SIDES * 6
  const idxBuf = new ArrayBuffer(idxCount * 2)
  const indices = new Uint16Array(idxBuf)
  let k = 0
  for (let i = 0; i < FLAME_RINGS; i++) {
    for (let s = 0; s < FLAME_SIDES; s++) {
      const a = i * FLAME_SIDES + s
      const b = i * FLAME_SIDES + ((s + 1) % FLAME_SIDES)
      indices[k++] = a
      indices[k++] = b
      indices[k++] = b + FLAME_SIDES
      indices[k++] = a
      indices[k++] = b + FLAME_SIDES
      indices[k++] = a + FLAME_SIDES
    }
  }
  return { positions, indices }
}

const COMMON_NOISE_FIRE_WGSL = /* wgsl */ `
fn bHash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn bNoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(bHash2(i), bHash2(i + vec2f(1.0, 0.0)), e.x),
    mix(bHash2(i + vec2f(0.0, 1.0)), bHash2(i + vec2f(1.0, 1.0)), e.x),
    e.y
  );
}
fn bHash3(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}
fn bNoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(bHash3(i), bHash3(i + vec3f(1.0, 0.0, 0.0)), e.x),
      mix(bHash3(i + vec3f(0.0, 1.0, 0.0)), bHash3(i + vec3f(1.0, 1.0, 0.0)), e.x),
      e.y
    ),
    mix(
      mix(bHash3(i + vec3f(0.0, 0.0, 1.0)), bHash3(i + vec3f(1.0, 0.0, 1.0)), e.x),
      mix(bHash3(i + vec3f(0.0, 1.0, 1.0)), bHash3(i + vec3f(1.0, 1.0, 1.0)), e.x),
      e.y
    ),
    e.z
  );
}
// Linear HDR fire colour ramp: deep red at cooling crust edges, orange-gold, incandescent white-gold core.
fn fireCol(hot: f32) -> vec3f {
  var c = mix(vec3f(0.55, 0.025, 0.002), vec3f(1.2, 0.22, 0.015), smoothstep(0.0, 0.32, hot));
  c = mix(c, vec3f(1.5, 0.62, 0.08), smoothstep(0.28, 0.62, hot));
  c = mix(c, vec3f(1.8, 1.45, 0.78), smoothstep(0.62, 0.98, hot));
  return c * (1.0 + 2.4 * hot * hot);
}
`

const BILLOW_CODE = /* wgsl */ `
struct ViewU {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, clock: f32,
  forward: vec3f, day: f32,
  sun: vec3f, pad0: f32,
}
@group(0) @binding(0) var<uniform> u: ViewU;

const NEAR_Z = ${NEAR.toFixed(1)};
const FAR_Z = ${FAR.toFixed(1)};

${COMMON_NOISE_FIRE_WGSL}

fn lumps(q: vec3f, seed: f32) -> f32 {
  return bNoise3(q * 2.1 + vec3f(seed * 31.0)) * 0.62 + bNoise3(q * 4.6 + vec3f(seed * 17.0 + 4.0)) * 0.38;
}

struct BillowOut {
  @builtin(position) clipPos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) qRot: vec3f,
  @location(3) @interpolate(flat) bInfo: vec4f,     // heat, seed, kind, mineAge
  @location(4) @interpolate(flat) centerAge: vec4f, // blastCenter.xyz, age
  @location(5) @interpolate(flat) ballH: f32,       // climb height H (cells)
}

@vertex fn vs(
  @location(0) localPos: vec3f,
  @location(1) iA: vec4f,      // dir.xyz, kind (0 cap, 1 stem, 2 skirt)
  @location(2) iB: vec4f,      // radFrac, delay, seed, heightFrac
  @location(3) iCenter: vec4f, // anchor-relative blast center xyz, radius R (cells)
  @location(4) iBall: vec4f,   // H (cells), age (sec), unused, unused
) -> BillowOut {
  let R = iCenter.w;
  let H = iBall.x;
  let age = iBall.y;
  let kind = iA.w;
  let seed = iB.z;
  let forth = smoothstep(iB.y, iB.y + 0.4, age);

  var centre = iCenter.xyz;
  if (kind < 0.5) {
    centre = iCenter.xyz + vec3f(0.0, H, 0.0) + vec3f(iA.x, iA.y * 0.6, iA.z) * (R * 0.66 * forth);
  } else if (kind < 1.5) {
    centre = iCenter.xyz + vec3f(iA.x * R * 0.13, H * iB.w * forth, iA.z * R * 0.13);
  } else {
    // Ground skirt expands outward and lifts gently as it rolls.
    let horiz = R * (0.5 + 0.62 * iB.w) * forth + age * 16.0;
    centre = iCenter.xyz + vec3f(iA.x, 0.0, iA.z) * horiz + vec3f(0.0, 7.0 + R * 0.06 + iB.w * 10.0 + age * 5.0, 0.0);
  }

  let rad = R * iB.x * (0.3 + 0.7 * forth);
  let n = normalize(localPos);
  var way = normalize(vec3f(iA.x, 0.0, iA.z) + vec3f(1e-3, 0.0, 0.0));
  if (kind > 0.5 && kind < 1.5) {
    way = vec3f(cos(seed * 40.0), 0.0, sin(seed * 40.0));
  }
  let axis = vec3f(-way.z, 0.0, way.x);
  let ang = -age * (0.75 + 0.5 * fract(seed * 5.1));
  let ca = cos(ang);
  let sa = sin(ang);
  let q = n * ca + cross(axis, n) * sa + axis * dot(axis, n) * (1.0 - ca);
  let w = centre + n * (rad * (0.72 + 0.56 * lumps(q, seed)));

  let mineAge = max(age - iB.y, 0.0);
  let coolMult = select(select(1.0, 1.25, kind > 0.5), 1.7, kind > 1.5);
  let heat = exp(-mineAge * (0.42 + 0.4 * fract(seed * 3.3)) * coolMult);

  let rel = w - u.eye;
  let depthZ = dot(rel, u.forward);
  var out: BillowOut;
  out.clipPos = vec4f(
    dot(rel, u.right) / (u.tanHalf * u.aspect),
    dot(rel, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.worldPos = w;
  out.norm = n;
  out.qRot = q;
  out.bInfo = vec4f(heat, seed, kind, mineAge);
  out.centerAge = vec4f(iCenter.xyz, age);
  out.ballH = H;
  return out;
}

@fragment fn fs(in: BillowOut) -> @location(0) vec4f {
  let age = in.centerAge.w;
  let heat = in.bInfo.x;
  let seed = in.bInfo.y;
  let kind = in.bInfo.z;
  let mine = in.bInfo.w;
  let N = normalize(in.norm);

  // World position in metres (10 cells = 1 m) for physical noise & tear-open frequencies.
  let wm = in.worldPos * 0.1;
  let eyeDistM = distance(u.eye, in.worldPos) * 0.1;

  // Swellings and finer folds on the overturning billow surface.
  let lump = lumps(in.qRot, seed) + (bNoise3(in.qRot * 9.5 + vec3f(seed * 7.0)) - 0.5) * 0.16;

  // Upward-drifting turbulence that eats the smoke away as it dissipates.
  let drift = bNoise3(wm * 0.45 + vec3f(0.0, -age * 0.8, 0.0) + vec3f(seed * 9.0)) * 0.6
            + bNoise3(wm * 1.25 + vec3f(0.0, -age * 1.3, 0.0)) * 0.4;

  let startAge = select(select(4.2, 3.2, kind > 0.5), 1.3, kind > 1.5);
  let endAge = select(select(9.4, 7.4, kind > 0.5), 3.6, kind > 1.5);
  let gone = smoothstep(startAge, endAge, age + (seed - 0.5) * 1.6);
  if (drift * 0.75 + lump * 0.25 < gone * 1.08) { discard; }

  // World-space cracked crust and camera-proximity tear-open so walking inside never clips hollow.
  let w1 = bNoise3(wm * 0.8 + vec3f(0.0, -age * 0.35, 0.0) + vec3f(seed * 5.0));
  let w2 = bNoise3(wm * 2.1 + vec3f(0.0, -age * 0.5, 0.0) + vec3f(seed * 3.0));
  let w3 = bNoise3(wm * 5.0 + vec3f(seed * 11.0));
  let tearThreshold = 0.1 + 0.98 * smoothstep(1.5, 10.0, eyeDistM);
  if (w2 * 0.65 + w3 * 0.35 > tearThreshold) { discard; }

  // Side facing the blast heart stays hotter.
  let heartPos = vec3f(in.centerAge.x, in.centerAge.y + in.ballH * 0.7, in.centerAge.z);
  let toHeart = heartPos - in.worldPos;
  let heartLen = max(length(toHeart), 1e-4);
  let inner = max(dot(N, toHeart / heartLen), 0.0);

  // Outward swellings cool first into a dark soot crust while crevices stay incandescent.
  var temp = heat * 1.2 + 0.7 * exp(-mine * 2.6) + 0.55 * inner * heat
           - (lump - 0.4) * 1.5 * (1.0 - 0.75 * heat) * step(0.0, lump - 0.4);
  temp += (0.4 - lump) * 0.9 * heat * step(0.0, 0.4 - lump);

  let seen = 1.0 - smoothstep(22.0, 55.0, eyeDistM);
  let crackLong = 1.0 - smoothstep(0.012, 0.05, abs(w1 - 0.5));
  let crackShort = 0.75 * (1.0 - smoothstep(0.02, 0.07, abs(w2 - 0.5)));
  let crack = max(crackLong, crackShort) * seen;
  temp += crack * heat * 0.95 + ((w2 - 0.5) * 0.45 + (w3 - 0.5) * 0.25 * seen) * heat;

  let aa = fwidth(temp) * 1.2 + 0.006;
  let tone = 0.17 + 0.33 * smoothstep(0.52 - aa, 0.52 + aa, temp) + 0.36 * smoothstep(0.86 - aa, 0.86 + aa, temp);

  // Cooled soot crust lit by sun + daylight ambient so dark smoke never glows unnaturally at night.
  let sunLit = max(dot(N, u.sun), 0.0) * 0.45 + N.y * 0.35;
  let litTerm = smoothstep(0.46, 0.56, sunLit + 0.3 * drift + 0.3 * lump + 0.12 + (w2 - 0.5) * 0.35 + (w3 - 0.5) * 0.2 * seen);
  let dayScale = mix(0.08, 1.0, u.day);
  var smoke = mix(vec3f(0.018, 0.016, 0.018), mix(vec3f(0.14, 0.13, 0.135), vec3f(0.32, 0.31, 0.33), gone), litTerm) * dayScale;
  smoke = mix(smoke, vec3f(0.65, 0.12, 0.025), smoothstep(0.04, 0.12, heat) * smoothstep(0.38, 0.62, inner));

  let col = mix(smoke, fireCol(tone), smoothstep(0.24 - aa, 0.24 + aa, temp));
  return vec4f(col, 1.0);
}
`

const TONGUE_CODE = /* wgsl */ `
struct ViewU {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, clock: f32,
  forward: vec3f, day: f32,
  sun: vec3f, pad0: f32,
}
@group(0) @binding(0) var<uniform> u: ViewU;

const NEAR_Z = ${NEAR.toFixed(1)};
const FAR_Z = ${FAR.toFixed(1)};

${COMMON_NOISE_FIRE_WGSL}

struct TongueOut {
  @builtin(position) clipPos: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) norm: vec3f,
  @location(2) tInfo: vec3f, // seed, detachedFlag, v
}

@vertex fn vs(
  @location(0) localPos: vec3f, // (cosA, v in 0..1, sinA)
  @location(1) iP: vec4f,       // anchor-relative base xyz (cells), heat (0..1)
  @location(2) iS: vec4f,       // seed, height (cells), radius (cells), windBias
) -> TongueOut {
  let seed = iS.x;
  let v = localPos.y;
  let heat = clamp(iP.w, 0.0, 1.0);
  let rise = pow(heat, 0.6) * smoothstep(0.0, 0.1, heat);

  // Stand-up cycle driven strictly by u.clock (reversible under Time Rewind).
  let period = 0.75 + 0.85 * fract(seed * 7.13);
  let tt = u.clock / period + seed * 13.7;
  let ph = fract(tt);
  let cycleId = floor(tt);
  let r1 = bHash2(vec2f(cycleId, seed * 91.0));
  let r2 = bHash2(vec2f(seed * 17.0, cycleId + 3.0));

  let H = iS.y * rise * (0.45 + 0.75 * r1);
  let grow = smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.82, 1.0, ph));

  // Neck pinch-off detaches upper flame lick which rises and dwindles.
  let neck = 0.5 + 0.2 * r2;
  let parted = smoothstep(0.5, 0.72, ph);
  let above = smoothstep(neck - 0.04, neck + 0.04, v);

  // Tapered girth: full low down, climbing swellings, pinched at neck, tapered to tip.
  var girth = (0.62 + 0.38 * smoothstep(0.0, 0.2, v)) * pow(max(1.0 - v, 0.0), 0.9);
  girth *= 1.0 + 0.32 * v * sin(v * 8.0 - u.clock * (6.0 + 3.0 * r1) + seed * 9.0);
  let neckDelta = (v - neck) / 0.11;
  girth *= 1.0 - parted * exp(-neckDelta * neckDelta);
  girth *= mix(1.0, 1.0 - smoothstep(0.68, 1.0, ph), above);

  let horizDist = distance(u.eye.xz, iP.xz);
  let distFade = 1.0 - smoothstep(180.0, ${FLAME_MAX_DIST.toFixed(1)}, horizDist);
  let R = iS.z * (0.8 + 0.035 * H) * girth * sqrt(max(grow, 0.0)) * distFade * step(0.02, rise);

  let yOff = (v * grow + above * parted * (ph - 0.5) * 0.8) * H;
  let upCurve = pow(v, 1.4) * H;
  // Snaking middle line with bends climbing upward.
  let bx = bNoise2(vec2f(seed * 40.0, v * 2.2 - u.clock * 2.4)) - 0.5;
  let bz = bNoise2(vec2f(seed * 23.0 + 9.0, v * 2.2 - u.clock * 2.4)) - 0.5;
  var w = iP.xyz + vec3f(bx * 0.9 * upCurve, yOff, bz * 0.9 * upCurve);
  // Subtle light ambient breeze along +X matching puffs.ts wind.
  w.x += 0.22 * upCurve * iS.w;
  w.x += localPos.x * R;
  w.z += localPos.z * R;

  let rel = w - u.eye;
  let depthZ = dot(rel, u.forward);
  var out: TongueOut;
  out.clipPos = vec4f(
    dot(rel, u.right) / (u.tanHalf * u.aspect),
    dot(rel, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.worldPos = w;
  out.norm = normalize(vec3f(localPos.x, 0.4 + 0.5 * v, localPos.z));
  out.tInfo = vec3f(seed, above * parted, v);
  return out;
}

@fragment fn fs(in: TongueOut) -> @location(0) vec4f {
  let v = in.tInfo.z;
  let wm = in.worldPos * 0.1;

  // Upward-climbing turbulence eats the upper tip ragged.
  let eat = bNoise3(vec3f(wm.x * 6.0 + 3.0, wm.y * 4.5 - u.clock * 6.0, wm.z * 6.0));
  if (eat * smoothstep(0.5, 1.0, v) > 0.58) { discard; }

  // Fade out when walking right through a flame tongue.
  let eyeDistM = distance(u.eye, in.worldPos) * 0.1;
  let prox = smoothstep(0.4, 1.5, eyeDistM);
  if (prox < 0.05) { discard; }

  let flow = bNoise3(vec3f(wm.x * 4.0, wm.y * 3.2 - u.clock * 4.2, wm.z * 4.0));
  let toEye = normalize(u.eye - in.worldPos);
  let facing = abs(dot(normalize(in.norm), toEye));

  // View-angle temperature shading: white-gold core when looked into, orange-red at rim and detached tips.
  let hot = clamp(pow(facing, 1.25) * 1.35 * (1.0 - 0.8 * pow(v, 0.85)) + (flow - 0.5) * 0.45 - 0.3 * in.tInfo.y, 0.0, 1.0);
  let aa = fwidth(hot) * 1.2 + 0.008;
  let tone = 0.17 + 0.33 * smoothstep(0.32 - aa, 0.32 + aa, hot) + 0.36 * smoothstep(0.62 - aa, 0.62 + aa, hot);
  return vec4f(fireCol(tone) * prox, 1.0);
}
`

interface BlastEvent {
  x: number
  y: number
  z: number
  radius: number
  born: number
  /** Pre-generated deterministic per-billow (iA, iB) data for this blast's 84 billows. */
  iA: Float32Array<ArrayBuffer>
  iB: Float32Array<ArrayBuffer>
}

interface FlameSite {
  x: number
  y: number
  z: number
  heat: number
  height: number
  seed: number
  seenAt: number
}

export interface BillowsStats {
  activeBlasts: number
  billowInstances: number
  flameSites: number
  tongueInstances: number
  clock: number
}

export interface Billows {
  /** Spawn a stateless toroidal-roll explosion billow cluster at `at` (world cells) with `radius` (cells). */
  spawnBlast(at: readonly [number, number, number], radius: number): void
  /** Register a close-range burning cell (world cells) to emit 3D tapered flame tongues when within 24 m. */
  addFlame(at: readonly [number, number, number], heat?: number, height?: number): void
  /** Advance simulation clock by `dt` seconds. */
  step(dt: number): void
  /** Set absolute clock (seconds) for Time Rewind; blasts evaluate purely from `age = clock - born`. */
  setClock(t: number): void
  readonly clock: number
  /** Returns true when at least one billow blast or close-range flame tongue is active for `eye`. */
  hasWork(eye: readonly [number, number, number]): boolean
  /** Render depth-tested solid billows and close-range 3D flame tongues into `(to.color, to.depth)`. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, sun?: readonly number[], day?: number): void
  /** Clear all active blasts and flame sites. */
  clear(): void
  readonly stats: BillowsStats
  dispose(): void
}

function makeBlastAttrs(seed: number): { iA: Float32Array<ArrayBuffer>; iB: Float32Array<ArrayBuffer> } {
  const R = mulberry32(seed)
  const iA = new Float32Array(new ArrayBuffer(PER_BLAST * 4 * 4))
  const iB = new Float32Array(new ArrayBuffer(PER_BLAST * 4 * 4))
  for (let i = 0; i < PER_BLAST; i++) {
    const kind = i < CAP ? 0 : i < CAP + STEM ? 1 : 2
    const a = R() * Math.PI * 2
    if (kind === 0) {
      const y = -0.3 + 1.3 * R()
      const h = Math.sqrt(Math.max(0, 1 - Math.min(1, y) ** 2))
      iA.set([Math.cos(a) * h, y, Math.sin(a) * h, 0], i * 4)
      iB.set([0.26 + 0.17 * R(), 0.34 * R(), R(), R()], i * 4)
    } else if (kind === 1) {
      iA.set([R() * 2 - 1, 0, R() * 2 - 1, 1], i * 4)
      iB.set([0.15 + 0.09 * R(), 0.05 + 0.25 * R(), R(), 0.06 + 0.78 * ((i - CAP) / STEM)], i * 4)
    } else {
      iA.set([Math.cos(a), 0, Math.sin(a), 2], i * 4)
      iB.set([0.11 + 0.1 * R(), 0.24 * R(), R(), R()], i * 4)
    }
  }
  return { iA, iB }
}

const frac = (v: number) => v - Math.floor(v)

export async function createBillows(device: GPUDevice, format: GPUTextureFormat): Promise<Billows> {
  const [billowMod, tongueMod] = await Promise.all([
    shader(device, 'billows', BILLOW_CODE),
    shader(device, 'flame-tongues', TONGUE_CODE),
  ])

  const viewLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  })
  const pipeLayout = device.createPipelineLayout({ bindGroupLayouts: [viewLayout] })

  // Instance buffer stride for billows: 4 x vec4f = 64 bytes per instance (iA, iB, iCenter, iBall).
  const BILLOW_INST_FLOATS = 16
  // Instance buffer stride for tongues: 2 x vec4f = 32 bytes per instance (iP, iS).
  const TONGUE_INST_FLOATS = 8

  const [billowPipe, tonguePipe] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'billows-solid',
      layout: pipeLayout,
      vertex: {
        module: billowMod,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 12,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
          {
            arrayStride: BILLOW_INST_FLOATS * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
              { shaderLocation: 3, offset: 32, format: 'float32x4' },
              { shaderLocation: 4, offset: 48, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: billowMod,
        entryPoint: 'fs',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    }),
    device.createRenderPipelineAsync({
      label: 'flame-tongues-solid',
      layout: pipeLayout,
      vertex: {
        module: tongueMod,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 12,
            stepMode: 'vertex',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
          {
            arrayStride: TONGUE_INST_FLOATS * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: tongueMod,
        entryPoint: 'fs',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    }),
  ])

  const ico = buildIcosphere(3)
  const icoVB = device.createBuffer({ label: 'billow-ico-vb', size: ico.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const icoIB = device.createBuffer({ label: 'billow-ico-ib', size: ico.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(icoVB, 0, ico.positions)
  device.queue.writeBuffer(icoIB, 0, ico.indices)

  const tube = buildFlameTube()
  const tubeVB = device.createBuffer({ label: 'tongue-tube-vb', size: tube.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const tubeIB = device.createBuffer({ label: 'tongue-tube-ib', size: tube.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(tubeVB, 0, tube.positions)
  device.queue.writeBuffer(tubeIB, 0, tube.indices)

  const viewBuf = device.createBuffer({ label: 'billows-view-u', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const viewBind = device.createBindGroup({ layout: viewLayout, entries: [{ binding: 0, resource: { buffer: viewBuf } }] })

  const billowInstBuf = device.createBuffer({
    label: 'billows-instances',
    size: MAX_BILLOW_INSTANCES * BILLOW_INST_FLOATS * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const tongueInstBuf = device.createBuffer({
    label: 'tongues-instances',
    size: MAX_TONGUES * TONGUE_INST_FLOATS * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })

  const viewF32 = new Float32Array(new ArrayBuffer(80))
  const billowCpu = new Float32Array(new ArrayBuffer(MAX_BILLOW_INSTANCES * BILLOW_INST_FLOATS * 4))
  const tongueCpu = new Float32Array(new ArrayBuffer(MAX_TONGUES * TONGUE_INST_FLOATS * 4))

  const blasts: BlastEvent[] = []
  const flameSites = new Map<number, FlameSite>()
  let blastSeq = 1
  let clock = 0
  let lastBillowInstances = 0
  let lastTongueInstances = 0
  let lastActiveBlasts = 0

  const siteKey = (x: number, y: number, z: number): number => {
    const qx = Math.floor(x * 0.25) & 0x3ffff
    const qy = Math.floor(y * 0.25) & 0xfff
    const qz = Math.floor(z * 0.25) & 0x3ffff
    return qx * 0x40000000 + qy * 0x40000 + qz
  }

  const pruneFlames = () => {
    for (const [k, s] of flameSites) {
      const age = clock - s.seenAt
      if (age > FLAME_TTL || age < -FLAME_TTL * 4) flameSites.delete(k)
    }
  }

  const activeBlastCount = (): number => {
    let n = 0
    for (let i = 0; i < blasts.length; i++) {
      const age = clock - blasts[i].born
      if (age >= 0 && age <= MAX_BLAST_AGE) n++
    }
    return n
  }

  return {
    get clock() { return clock },
    get stats(): BillowsStats {
      return {
        activeBlasts: lastActiveBlasts,
        billowInstances: lastBillowInstances,
        flameSites: flameSites.size,
        tongueInstances: lastTongueInstances,
        clock,
      }
    },
    spawnBlast(at, radius) {
      const r = Math.max(4, radius)
      const seed = (Math.imul(blastSeq++, 2654435761) ^ Math.imul(Math.round(at[0] * 10), 73856093) ^ Math.imul(Math.round(at[2] * 10), 83492791)) >>> 0
      const attrs = makeBlastAttrs(seed || 1)
      const ev: BlastEvent = { x: at[0], y: at[1], z: at[2], radius: r, born: clock, iA: attrs.iA, iB: attrs.iB }
      if (blasts.length >= MAX_BLASTS) blasts.shift()
      blasts.push(ev)
    },
    addFlame(at, heat = 0.85, height = 14) {
      const key = siteKey(at[0], at[1], at[2])
      const existing = flameSites.get(key)
      if (existing) {
        existing.seenAt = clock
        existing.heat = Math.max(existing.heat, heat)
        return
      }
      if (flameSites.size >= MAX_FLAME_SITES) {
        const firstKey = flameSites.keys().next().value
        if (firstKey !== undefined) flameSites.delete(firstKey)
      }
      const sd = frac(Math.sin(at[0] * 12.9898 + at[1] * 78.233 + at[2] * 37.719) * 43758.5453) * 100
      flameSites.set(key, { x: at[0], y: at[1], z: at[2], heat, height, seed: sd, seenAt: clock })
    },
    step(dt) {
      clock += dt
      pruneFlames()
    },
    setClock(t) {
      clock = t
    },
    hasWork(eye) {
      if (activeBlastCount() > 0) return true
      if (flameSites.size === 0) return false
      const maxD2 = FLAME_MAX_DIST * FLAME_MAX_DIST
      for (const s of flameSites.values()) {
        const dx = s.x - eye[0], dz = s.z - eye[2]
        if (dx * dx + dz * dz <= maxD2) return true
      }
      return false
    },
    clear() {
      blasts.length = 0
      flameSites.clear()
      lastBillowInstances = 0
      lastTongueInstances = 0
      lastActiveBlasts = 0
    },
    draw(encoder, to, view, sun = [0.52, 0.62, 0.59], day = 1) {
      const anchorX = Math.floor(view.eye[0] / 64) * 64
      const anchorY = Math.floor(view.eye[1] / 64) * 64
      const anchorZ = Math.floor(view.eye[2] / 64) * 64

      // 1. Pack stateless explosion billow instances from active blasts at current `clock`.
      let bCount = 0
      let liveBlasts = 0
      for (let bi = 0; bi < blasts.length; bi++) {
        const ev = blasts[bi]
        const age = clock - ev.born
        if (age < 0 || age > MAX_BLAST_AGE) continue
        liveBlasts++
        // Expanding fireball width R and buoyant climb height H (in cells).
        const R = ev.radius * (0.45 + 1.15 * (1 - Math.exp(-age * 2.2)) + 0.14 * age)
        const H = ev.radius * (0.25 + 1.55 * (1 - Math.exp(-age * 0.72)) + 0.28 * age)
        const cx = ev.x - anchorX
        const cy = ev.y - anchorY
        const cz = ev.z - anchorZ
        for (let i = 0; i < PER_BLAST && bCount < MAX_BILLOW_INSTANCES; i++) {
          const o = bCount * BILLOW_INST_FLOATS
          const i4 = i * 4
          billowCpu[o] = ev.iA[i4]
          billowCpu[o + 1] = ev.iA[i4 + 1]
          billowCpu[o + 2] = ev.iA[i4 + 2]
          billowCpu[o + 3] = ev.iA[i4 + 3]
          billowCpu[o + 4] = ev.iB[i4]
          billowCpu[o + 5] = ev.iB[i4 + 1]
          billowCpu[o + 6] = ev.iB[i4 + 2]
          billowCpu[o + 7] = ev.iB[i4 + 3]
          billowCpu[o + 8] = cx
          billowCpu[o + 9] = cy
          billowCpu[o + 10] = cz
          billowCpu[o + 11] = R
          billowCpu[o + 12] = H
          billowCpu[o + 13] = age
          billowCpu[o + 14] = 0
          billowCpu[o + 15] = 0
          bCount++
        }
      }
      lastActiveBlasts = liveBlasts
      lastBillowInstances = bCount

      // 2. Pack close-range 3D flame tongue instances (< 240 cells = 24 m from eye).
      let tCount = 0
      for (const s of flameSites.values()) {
        if (tCount >= MAX_TONGUES) break
        const d = Math.hypot(s.x - view.eye[0], s.z - view.eye[2])
        if (d > FLAME_MAX_DIST) continue
        const kCount = Math.max(1, Math.ceil(3 * (d < 90 ? 1 : 1 - (d - 90) / (FLAME_MAX_DIST - 90))))
        const sd = s.seed
        const spread = 3.2 // 0.32 m scatter around burning cell
        for (let j = 0; j < kCount && tCount < MAX_TONGUES; j++) {
          const h1 = frac(Math.sin(sd * 127.1 + j * 311.7) * 43758.5453)
          const h2 = frac(Math.sin(sd * 269.5 + j * 183.3) * 43758.5453)
          const h3 = frac(Math.sin(sd * 419.2 + j * 71.9) * 43758.5453)
          const o = tCount * TONGUE_INST_FLOATS
          tongueCpu[o] = s.x - anchorX + (h1 - 0.5) * 2 * spread
          tongueCpu[o + 1] = s.y - anchorY + 0.5
          tongueCpu[o + 2] = s.z - anchorZ + (h2 - 0.5) * 2 * spread
          tongueCpu[o + 3] = s.heat
          tongueCpu[o + 4] = h1 * 7.3 + h2 + j
          tongueCpu[o + 5] = s.height * (0.75 + 0.45 * h3)
          tongueCpu[o + 6] = 1.1 + 1.5 * h3 * h3 // radius in cells (11..26 cm)
          tongueCpu[o + 7] = 0.6 + 0.8 * h2
          tCount++
        }
      }
      lastTongueInstances = tCount

      if (bCount === 0 && tCount === 0) return

      const sLen = Math.hypot(sun[0], sun[1], sun[2]) || 1
      viewF32.set([
        view.eye[0] - anchorX, view.eye[1] - anchorY, view.eye[2] - anchorZ, view.tanHalf,
        view.right[0], view.right[1], view.right[2], to.size[0] / to.size[1],
        view.up[0], view.up[1], view.up[2], clock,
        view.forward[0], view.forward[1], view.forward[2], day,
        sun[0] / sLen, sun[1] / sLen, sun[2] / sLen, 0,
      ], 0)
      device.queue.writeBuffer(viewBuf, 0, viewF32)
      if (bCount > 0) device.queue.writeBuffer(billowInstBuf, 0, billowCpu, 0, bCount * BILLOW_INST_FLOATS)
      if (tCount > 0) device.queue.writeBuffer(tongueInstBuf, 0, tongueCpu, 0, tCount * TONGUE_INST_FLOATS)

      const pass = encoder.beginRenderPass({
        label: 'billows-and-tongues',
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setBindGroup(0, viewBind)

      if (bCount > 0) {
        pass.setPipeline(billowPipe)
        pass.setVertexBuffer(0, icoVB)
        pass.setVertexBuffer(1, billowInstBuf)
        pass.setIndexBuffer(icoIB, 'uint16')
        pass.drawIndexed(ico.indices.length, bCount)
      }
      if (tCount > 0) {
        pass.setPipeline(tonguePipe)
        pass.setVertexBuffer(0, tubeVB)
        pass.setVertexBuffer(1, tongueInstBuf)
        pass.setIndexBuffer(tubeIB, 'uint16')
        pass.drawIndexed(tube.indices.length, tCount)
      }
      pass.end()
    },
    dispose() {
      icoVB.destroy()
      icoIB.destroy()
      tubeVB.destroy()
      tubeIB.destroy()
      viewBuf.destroy()
      billowInstBuf.destroy()
      tongueInstBuf.destroy()
    },
  }
}
