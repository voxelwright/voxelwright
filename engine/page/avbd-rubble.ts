// Zero-copy WebGPU compute AVBD rigid-body rubble solver & instanced box renderer (#226).
//
// Inspired by Small Magic's vendored `three-avbd` (Augmented Vertex Block Descent, Giles et al.
// SIGGRAPH 2025) adapted for Voxelwright's 10 cm cell coordinates (1 m = 10 cells, Y-up, gravity
// -98.1 cells/s^2, standard [0, 1] depth matching `to.depth`).
//
// All 4,096 dynamic rubble boxes live permanently on the GPU in `bodies: array<AvbdBody>` with
// ZERO CPU readback:
//   (a) predictPass     — gravity + inertial pose prediction + ground warm-start decay
//   (b) broadphase      — spatial-hash grid clear + AABB cell insertion (8192 buckets x 16)
//   (c) buildNeighbors  — per-body candidate gather + in-place heap-sort truncation at >32
//                         (Small Magic's O(n log n) siftDown safeguard so dense piles never hang)
//   (d) avbdSolvePass   — 4 ping-pong primal-dual AVBD iterations with 8-corner ground OBB contact,
//                         full 15-axis OBB-OBB SAT narrowphase, and Coulomb friction
//   (e) finalizePass    — AVBD velocity derivation, air/angular damping, rest-sleep stabilization
//
// The render pipeline reads directly from `bodies` storage buffer with zero-copy instancing,
// depth-tested against `to.depth`, lit via Voxelwright's `LIGHT`/`SUNLIT` plus hot ember tint.
import { DEPTH, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, LIGHT, MAX_LEVELS, SUNLIT, type Marcher, type View } from './march.ts'

export const MAX_RUBBLE_BODIES = 4096
/** Stride in f32s per AvbdBody struct (10 x vec4f = 40 floats = 160 bytes). */
export const AVBD_BODY_FLOATS = 40
export const AVBD_BODY_BYTES = AVBD_BODY_FLOATS * 4
const HASH_BUCKETS = 8192
const HASH_BUCKET_CAP = 16
const MAX_CANDIDATES = 128
const MAX_NEIGHBORS = 32
const AVBD_ITERATIONS = 4 // even count so ping-pong ends back in bodiesA
const GLOBALS_BYTES = 144 + MAX_LEVELS * 128 + 192 + 512 + 16

const AVBD_STRUCT_WGSL = /* wgsl */ `
struct AvbdBody {
  pos: vec4f,       // xyz = world pos (cells), w = invMass (0 = inactive)
  quat: vec4f,      // xyzw = unit orientation quaternion
  vel: vec4f,       // xyz = linear velocity (cells/s), w = age (seconds)
  spin: vec4f,      // xyz = angular velocity (rad/s), w = sleepTimer (seconds)
  halfExt: vec4f,   // xyz = box half-extents (cells), w = emberHeat (0..1)
  colorMat: vec4f,  // rgb = linear albedo, w = friction coefficient
  prevPos: vec4f,   // xyz = start-of-step position, w = restFlag
  prevQuat: vec4f,  // xyzw = start-of-step orientation
  inertPos: vec4f,  // xyz = inertial predicted position, w = groundLambda
  inertQuat: vec4f, // xyzw = inertial predicted orientation
}
`

const COMPUTE_WGSL = /* wgsl */ `
${AVBD_STRUCT_WGSL}

struct StepParams {
  dt: f32,
  invDt: f32,
  gravity: f32,
  groundY: f32,
  cellSize: f32,
  bodyCount: u32,
  betaGround: f32,
  betaBox: f32,
}

struct IterParams {
  iterIndex: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<uniform> sp: StepParams;
@group(0) @binding(1) var<storage, read> bodiesIn: array<AvbdBody>;
@group(0) @binding(2) var<storage, read_write> bodiesOut: array<AvbdBody>;
@group(0) @binding(3) var<storage, read_write> bucketCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bucketItems: array<u32>;
@group(0) @binding(5) var<storage, read_write> candIds: array<u32>;
@group(0) @binding(6) var<storage, read_write> candKeys: array<f32>;
@group(0) @binding(7) var<storage, read_write> neighbors: array<u32>;
@group(0) @binding(8) var<storage, read_write> neighborCounts: array<u32>;
@group(1) @binding(0) var<uniform> ip: IterParams;

const MAX_BODIES = ${MAX_RUBBLE_BODIES}u;
const HASH_SIZE = ${HASH_BUCKETS}u;
const HASH_MASK = ${HASH_BUCKETS - 1}u;
const BUCKET_CAP = ${HASH_BUCKET_CAP}u;
const CAND_CAP = ${MAX_CANDIDATES}u;
const MAX_NEIGH = ${MAX_NEIGHBORS}u;

fn quatNormalize(q: vec4f) -> vec4f {
  let l2 = dot(q, q);
  if (l2 < 1e-10 || !(l2 == l2)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return q * inverseSqrt(l2);
}

fn quatMul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  );
}

fn quatConj(q: vec4f) -> vec4f {
  return vec4f(-q.x, -q.y, -q.z, q.w);
}

fn quatMat(q: vec4f) -> mat3x3f {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  let xx = x * x;
  let yy = y * y;
  let zz = z * z;
  let xy = x * y;
  let xz = x * z;
  let yz = y * z;
  let wx = w * x;
  let wy = w * y;
  let wz = w * z;
  return mat3x3f(
    vec3f(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy)),
    vec3f(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx)),
    vec3f(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy))
  );
}

fn integrateQuat(q: vec4f, omega: vec3f, dt: f32) -> vec4f {
  let dq = quatMul(vec4f(omega * (0.5 * dt), 0.0), q);
  return quatNormalize(q + dq);
}

// Small-angle rotation vector taking qFrom to qTo: qTo ~ exp(0.5 * dtheta) * qFrom.
fn deltaTheta(qFrom: vec4f, qTo: vec4f) -> vec3f {
  var dq = quatMul(qTo, quatConj(qFrom));
  if (dq.w < 0.0) { dq = -dq; }
  return dq.xyz * 2.0;
}

fn clampVec3(v: vec3f, maxLen: f32) -> vec3f {
  let l2 = dot(v, v);
  if (!(l2 == l2)) { return vec3f(0.0); }
  if (l2 > maxLen * maxLen) { return v * (maxLen * inverseSqrt(l2)); }
  return v;
}

fn isFiniteVec3(v: vec3f) -> bool {
  return (v.x == v.x) && (v.y == v.y) && (v.z == v.z) && abs(v.x) < 1e7 && abs(v.y) < 1e7 && abs(v.z) < 1e7;
}

fn hashCell(cx: i32, cy: i32, cz: i32) -> u32 {
  var h = (u32(cx) * 73856093u) ^ (u32(cy) * 19349663u) ^ (u32(cz) * 83492791u);
  h ^= h >> 16u;
  h *= 0x45d9f3bu;
  h ^= h >> 16u;
  return h & HASH_MASK;
}

fn aabbHalfExt(R: mat3x3f, h: vec3f) -> vec3f {
  return vec3f(
    abs(R[0].x) * h.x + abs(R[1].x) * h.y + abs(R[2].x) * h.z,
    abs(R[0].y) * h.x + abs(R[1].y) * h.y + abs(R[2].y) * h.z,
    abs(R[0].z) * h.x + abs(R[1].z) * h.y + abs(R[2].z) * h.z
  );
}

// Solve symmetric positive-definite 3x3 system A * x = b via Cramer / cofactor with SPD guard.
fn solveSpd3(a00: f32, a01: f32, a02: f32, a11: f32, a12: f32, a22: f32, b: vec3f) -> vec3f {
  let c00 = a11 * a22 - a12 * a12;
  let c01 = -(a01 * a22 - a12 * a02);
  let c02 = a01 * a12 - a11 * a02;
  let c11 = a00 * a22 - a02 * a02;
  let c12 = -(a00 * a12 - a01 * a02);
  let c22 = a00 * a11 - a01 * a01;
  let det = a00 * c00 + a01 * c01 + a02 * c02;
  if (abs(det) < 1e-12 || !(det == det)) {
    return vec3f(b.x / max(a00, 1e-4), b.y / max(a11, 1e-4), b.z / max(a22, 1e-4));
  }
  let invDet = 1.0 / det;
  return vec3f(
    (c00 * b.x + c01 * b.y + c02 * b.z) * invDet,
    (c01 * b.x + c11 * b.y + c12 * b.z) * invDet,
    (c02 * b.x + c12 * b.y + c22 * b.z) * invDet
  );
}

// ── Pass A: Gravity + Inertial Prediction ──────────────────────────────────
@compute @workgroup_size(64)
fn predictPass(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= sp.bodyCount || id >= MAX_BODIES) { return; }
  var body = bodiesOut[id];
  if (body.pos.w <= 0.0) { return; }

  let dt = sp.dt;
  let q0 = quatNormalize(body.quat);
  var vel = clampVec3(body.vel.xyz, 1200.0);
  var spin = clampVec3(body.spin.xyz, 36.0);

  body.prevPos = vec4f(body.pos.xyz, body.prevPos.w);
  body.prevQuat = q0;

  let sleeping = body.spin.w > 0.35;
  var inertP = body.pos.xyz;
  var inertQ = q0;

  if (!sleeping) {
    vel.y += sp.gravity * dt;
    inertP = body.pos.xyz + vel * dt;
    inertQ = integrateQuat(q0, spin, dt);
    body.pos = vec4f(inertP, body.pos.w);
    body.quat = inertQ;
  } else {
    // Sleeping bodies stay pinned unless awakened by an active neighbor impact or ground drop.
    let R = quatMat(q0);
    let ah = aabbHalfExt(R, body.halfExt.xyz);
    if (body.pos.y - ah.y > sp.groundY + 0.6) {
      body.spin.w = 0.0;
      vel.y += sp.gravity * dt;
      inertP = body.pos.xyz + vel * dt;
      body.pos = vec4f(inertP, body.pos.w);
    }
  }

  body.inertPos = vec4f(inertP, body.inertPos.w * 0.82);
  body.inertQuat = inertQ;
  body.vel = vec4f(vel, body.vel.w + dt);
  body.spin = vec4f(spin, body.spin.w);
  body.halfExt.w = max(0.0, body.halfExt.w - dt * 0.24);
  bodiesOut[id] = body;
}

// ── Pass B1: Clear Spatial Hash Buckets ────────────────────────────────────
@compute @workgroup_size(64)
fn broadphaseClear(@builtin(global_invocation_id) gid: vec3u) {
  let h = gid.x;
  if (h >= HASH_SIZE) { return; }
  atomicStore(&bucketCounts[h], 0u);
}

// ── Pass B2: Insert Active Bodies into Spatial Hash Grid ───────────────────
@compute @workgroup_size(64)
fn broadphaseInsert(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= sp.bodyCount || id >= MAX_BODIES) { return; }
  let body = bodiesIn[id];
  if (body.pos.w <= 0.0) { return; }

  let R = quatMat(body.quat);
  let ah = aabbHalfExt(R, body.halfExt.xyz) + vec3f(0.4);
  let invCell = 1.0 / sp.cellSize;
  let lo = vec3i(floor((body.pos.xyz - ah) * invCell));
  let hi = min(vec3i(floor((body.pos.xyz + ah) * invCell)), lo + vec3i(2, 2, 2));

  for (var cz = lo.z; cz <= hi.z; cz++) {
    for (var cy = lo.y; cy <= hi.y; cy++) {
      for (var cx = lo.x; cx <= hi.x; cx++) {
        let h = hashCell(cx, cy, cz);
        let slot = atomicAdd(&bucketCounts[h], 1u);
        if (slot < BUCKET_CAP) {
          bucketItems[h * BUCKET_CAP + slot] = id;
        }
      }
    }
  }
}

// ── Pass C: Per-Body Neighbor List with O(n log n) Heap-Sort Truncation (>32)
fn candLess(base: u32, a: u32, b: u32) -> bool {
  let ka = candKeys[base + a];
  let kb = candKeys[base + b];
  if (ka != kb) { return ka < kb; }
  return candIds[base + a] < candIds[base + b];
}

fn candSiftDown(base: u32, start: u32, count: u32) {
  var root = start;
  loop {
    var child = 2u * root + 1u;
    if (child >= count) { break; }
    if (child + 1u < count && candLess(base, child, child + 1u)) {
      child = child + 1u;
    }
    if (!candLess(base, root, child)) { break; }
    let tmpId = candIds[base + root];
    let tmpKey = candKeys[base + root];
    candIds[base + root] = candIds[base + child];
    candKeys[base + root] = candKeys[base + child];
    candIds[base + child] = tmpId;
    candKeys[base + child] = tmpKey;
    root = child;
  }
}

@compute @workgroup_size(64)
fn buildNeighbors(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= sp.bodyCount || id >= MAX_BODIES) { return; }
  let body = bodiesIn[id];
  if (body.pos.w <= 0.0) {
    neighborCounts[id] = 0u;
    return;
  }

  let R = quatMat(body.quat);
  let ah = aabbHalfExt(R, body.halfExt.xyz) + vec3f(0.4);
  let pMin = body.pos.xyz - ah;
  let pMax = body.pos.xyz + ah;
  let invCell = 1.0 / sp.cellSize;
  let lo = vec3i(floor(pMin * invCell));
  let hi = min(vec3i(floor(pMax * invCell)), lo + vec3i(2, 2, 2));

  let base = id * CAND_CAP;
  var n = 0u;

  for (var cz = lo.z; cz <= hi.z; cz++) {
    for (var cy = lo.y; cy <= hi.y; cy++) {
      for (var cx = lo.x; cx <= hi.x; cx++) {
        let h = hashCell(cx, cy, cz);
        let bCount = min(atomicLoad(&bucketCounts[h]), BUCKET_CAP);
        for (var k = 0u; k < bCount; k++) {
          let other = bucketItems[h * BUCKET_CAP + k];
          if (other == id || other >= sp.bodyCount) { continue; }
          let ob = bodiesIn[other];
          if (ob.pos.w <= 0.0) { continue; }
          // Fast sphere + AABB overlap filter.
          let d = ob.pos.xyz - body.pos.xyz;
          let d2 = dot(d, d);
          let rSum = length(body.halfExt.xyz) + length(ob.halfExt.xyz) + 0.5;
          if (d2 > rSum * rSum) { continue; }
          // Deduplicate against already collected candidates.
          var dup = false;
          for (var j = 0u; j < n; j++) {
            if (candIds[base + j] == other) { dup = true; break; }
          }
          if (dup) { continue; }
          if (n < CAND_CAP) {
            candIds[base + n] = other;
            candKeys[base + n] = d2;
            n++;
          }
        }
      }
    }
  }

  // Deterministic sort: insertion sort up to 32; O(n log n) heap sort + truncation past 32
  // (Small Magic's safeguard so dense rubble heaps never hit O(n^2) GPU timeouts).
  if (n > MAX_NEIGH) {
    var start = n / 2u;
    loop {
      if (start == 0u) { break; }
      start = start - 1u;
      candSiftDown(base, start, n);
    }
    var end = n;
    loop {
      if (end <= 1u) { break; }
      end = end - 1u;
      let topId = candIds[base];
      let topKey = candKeys[base];
      candIds[base] = candIds[base + end];
      candKeys[base] = candKeys[base + end];
      candIds[base + end] = topId;
      candKeys[base + end] = topKey;
      candSiftDown(base, 0u, end);
    }
  } else if (n > 1u) {
    for (var i = 1u; i < n; i++) {
      let curId = candIds[base + i];
      let curKey = candKeys[base + i];
      var j = i;
      loop {
        if (j == 0u) { break; }
        let prevKey = candKeys[base + j - 1u];
        let prevId = candIds[base + j - 1u];
        if (prevKey < curKey || (prevKey == curKey && prevId <= curId)) { break; }
        candIds[base + j] = prevId;
        candKeys[base + j] = prevKey;
        j--;
      }
      candIds[base + j] = curId;
      candKeys[base + j] = curKey;
    }
  }

  let kept = min(n, MAX_NEIGH);
  let outBase = id * MAX_NEIGH;
  for (var i = 0u; i < kept; i++) {
    neighbors[outBase + i] = candIds[base + i];
  }
  neighborCounts[id] = kept;
}

// ── OBB-OBB SAT Narrowphase (15 Separating Axes) ───────────────────────────
struct ObbContact {
  hit: bool,
  pen: f32,
  normal: vec3f, // points from B to A (pushing A out of B)
  point: vec3f,  // world-space contact point
}

fn supportBox(pos: vec3f, R: mat3x3f, h: vec3f, dir: vec3f) -> vec3f {
  let sx = select(-h.x, h.x, dot(R[0], dir) >= 0.0);
  let sy = select(-h.y, h.y, dot(R[1], dir) >= 0.0);
  let sz = select(-h.z, h.z, dot(R[2], dir) >= 0.0);
  return pos + R[0] * sx + R[1] * sy + R[2] * sz;
}

fn obbOverlap(pA: vec3f, RA: mat3x3f, hA: vec3f, pB: vec3f, RB: mat3x3f, hB: vec3f) -> ObbContact {
  var res: ObbContact;
  res.hit = false;
  res.pen = 0.0;
  res.normal = vec3f(0.0, 1.0, 0.0);
  res.point = (pA + pB) * 0.5;

  let toA = pA - pB;
  var minPen = 1e9;
  var bestAxis = vec3f(0.0, 1.0, 0.0);

  // Test 6 face axes (3 from A, 3 from B).
  for (var i = 0; i < 6; i++) {
    var axis = RA[0];
    if (i == 1) { axis = RA[1]; }
    else if (i == 2) { axis = RA[2]; }
    else if (i == 3) { axis = RB[0]; }
    else if (i == 4) { axis = RB[1]; }
    else if (i == 5) { axis = RB[2]; }

    let projA = abs(dot(RA[0], axis)) * hA.x + abs(dot(RA[1], axis)) * hA.y + abs(dot(RA[2], axis)) * hA.z;
    let projB = abs(dot(RB[0], axis)) * hB.x + abs(dot(RB[1], axis)) * hB.y + abs(dot(RB[2], axis)) * hB.z;
    let dist = abs(dot(toA, axis));
    let pen = projA + projB - dist;
    if (pen <= 0.0) { return res; }
    if (pen < minPen) {
      minPen = pen;
      bestAxis = select(-axis, axis, dot(toA, axis) >= 0.0);
    }
  }

  // Test 9 edge-edge cross axes with slight preference for face axes (stability on stacks).
  for (var i = 0; i < 3; i++) {
    let axA = RA[i];
    for (var j = 0; j < 3; j++) {
      let axB = RB[j];
      let raw = cross(axA, axB);
      let l2 = dot(raw, raw);
      if (l2 < 1e-4) { continue; }
      let axis = raw * inverseSqrt(l2);
      let projA = abs(dot(RA[0], axis)) * hA.x + abs(dot(RA[1], axis)) * hA.y + abs(dot(RA[2], axis)) * hA.z;
      let projB = abs(dot(RB[0], axis)) * hB.x + abs(dot(RB[1], axis)) * hB.y + abs(dot(RB[2], axis)) * hB.z;
      let dist = abs(dot(toA, axis));
      let pen = projA + projB - dist;
      if (pen <= 0.0) { return res; }
      if (pen * 1.04 < minPen) {
        minPen = pen;
        bestAxis = select(-axis, axis, dot(toA, axis) >= 0.0);
      }
    }
  }

  // Deepest support point pair midpoint along the minimum penetration axis.
  let supA = supportBox(pA, RA, hA, -bestAxis);
  let supB = supportBox(pB, RB, hB, bestAxis);
  res.hit = true;
  res.pen = minPen;
  res.normal = bestAxis;
  res.point = (supA + supB) * 0.5;
  return res;
}

// ── Pass D: AVBD Primal-Dual Contact + Coulomb Friction Iteration ──────────
@compute @workgroup_size(64)
fn avbdSolvePass(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= sp.bodyCount || id >= MAX_BODIES) { return; }
  var body = bodiesIn[id];
  if (body.pos.w <= 0.0) {
    bodiesOut[id] = body;
    return;
  }

  let dt = sp.dt;
  let invDt2 = sp.invDt * sp.invDt;
  let invMass = body.pos.w;
  let mass = 1.0 / invMass;
  let h = body.halfExt.xyz;
  let mu = max(body.colorMat.w, 0.1);

  let R = quatMat(body.quat);
  let Rprev = quatMat(body.prevQuat);

  // Box principal inertia tensor in world frame: I_k = m * (a^2 + b^2) / 3.
  let ix = mass * (h.y * h.y + h.z * h.z) / 3.0;
  let iy = mass * (h.x * h.x + h.z * h.z) / 3.0;
  let iz = mass * (h.x * h.x + h.y * h.y) / 3.0;
  let Iw0 = R[0] * (R[0].x * ix) + R[1] * (R[1].x * iy) + R[2] * (R[2].x * iz);
  let Iw1 = R[0] * (R[0].y * ix) + R[1] * (R[1].y * iy) + R[2] * (R[2].y * iz);
  let Iw2 = R[0] * (R[0].z * ix) + R[1] * (R[1].z * iy) + R[2] * (R[2].z * iz);

  // Inertial regularization (M / h^2) * (x_tilde - x).
  let mScale = mass * invDt2;
  var hL00 = mScale; var hL01 = 0.0; var hL02 = 0.0;
  var hL11 = mScale; var hL12 = 0.0; var hL22 = mScale;
  var gLin = (body.inertPos.xyz - body.pos.xyz) * mScale;

  var hA00 = Iw0.x * invDt2; var hA01 = Iw0.y * invDt2; var hA02 = Iw0.z * invDt2;
  var hA11 = Iw1.y * invDt2; var hA12 = Iw1.z * invDt2; var hA22 = Iw2.z * invDt2;
  let dThetaInert = deltaTheta(body.quat, body.inertQuat);
  var gAng = vec3f(
    hA00 * dThetaInert.x + hA01 * dThetaInert.y + hA02 * dThetaInert.z,
    hA01 * dThetaInert.x + hA11 * dThetaInert.y + hA12 * dThetaInert.z,
    hA02 * dThetaInert.x + hA12 * dThetaInert.y + hA22 * dThetaInert.z
  );

  // 1. Ground plane contact across all 8 OBB corners (y = sp.groundY) + Coulomb friction.
  let kGround = sp.betaGround * mScale;
  var groundDual = body.inertPos.w;
  var maxGroundPen = 0.0;
  var groundHits = 0.0;
  for (var ci = 0u; ci < 8u; ci++) {
    let sx = select(-h.x, h.x, (ci & 1u) != 0u);
    let sy = select(-h.y, h.y, (ci & 2u) != 0u);
    let sz = select(-h.z, h.z, (ci & 4u) != 0u);
    let localC = vec3f(sx, sy, sz);
    let r = R * localC;
    let worldY = body.pos.y + r.y;
    let pen = sp.groundY - worldY;
    if (pen > 0.0) {
      groundHits += 1.0;
      maxGroundPen = max(maxGroundPen, pen);
      let fnMag = min(groundDual * 0.25 + kGround * pen, kGround * 4.0);
      // Normal force along +Y.
      gLin.y += fnMag;
      hL11 += kGround;
      // Torque r x (0, fnMag, 0) = (-r.z * fnMag, 0, r.x * fnMag); j_ang = (-r.z, 0, r.x).
      gAng += vec3f(-r.z * fnMag, 0.0, r.x * fnMag);
      hA00 += kGround * r.z * r.z;
      hA02 -= kGround * r.z * r.x;
      hA22 += kGround * r.x * r.x;

      // Coulomb friction opposing horizontal corner slip since start of step.
      let prevCorner = body.prevPos.xyz + Rprev * localC;
      let slipXZ = (body.pos.xz + r.xz) - prevCorner.xz;
      let slipLen = length(slipXZ);
      if (slipLen > 1e-5) {
        let kT = kGround * 0.65;
        let ftMag = min(kT * slipLen, mu * fnMag);
        let ft = -slipXZ * (ftMag / slipLen);
        gLin.x += ft.x;
        gLin.z += ft.y;
        let f3 = vec3f(ft.x, 0.0, ft.y);
        gAng += cross(r, f3);
        let kEff = min(kT, (mu * fnMag) / max(slipLen, 1e-3));
        hL00 += kEff;
        hL22 += kEff;
        hA00 += kEff * r.y * r.y;
        hA11 += kEff * (r.x * r.x + r.z * r.z);
        hA22 += kEff * r.y * r.y;
      }
    }
  }
  if (groundHits > 0.0) {
    groundDual = clamp(groundDual + kGround * maxGroundPen * 0.35, 0.0, kGround * 3.0);
  } else {
    groundDual = 0.0;
  }

  // 2. Box-box OBB contacts from the heap-truncated neighbor list (<= 32 neighbors).
  let nCount = min(neighborCounts[id], MAX_NEIGH);
  let nBase = id * MAX_NEIGH;
  var woke = false;
  for (var ni = 0u; ni < nCount; ni++) {
    let oid = neighbors[nBase + ni];
    if (oid >= sp.bodyCount) { continue; }
    let ob = bodiesIn[oid];
    if (ob.pos.w <= 0.0) { continue; }
    let Ro = quatMat(ob.quat);
    let c = obbOverlap(body.pos.xyz, R, h, ob.pos.xyz, Ro, ob.halfExt.xyz);
    if (!c.hit) { continue; }

    let mEff = 1.0 / (invMass + ob.pos.w);
    let kBox = sp.betaBox * mEff * invDt2;
    let pen = min(c.pen, min(h.x, min(h.y, h.z)) * 1.6);
    let fnMag = kBox * pen;
    let n = c.normal;
    let r = c.point - body.pos.xyz;

    // Wake sleeping body when hit by a moving neighbor.
    if (ob.spin.w < 0.2 && dot(ob.vel.xyz, ob.vel.xyz) > 4.0) { woke = true; }

    gLin += n * fnMag;
    hL00 += kBox * n.x * n.x;
    hL01 += kBox * n.x * n.y;
    hL02 += kBox * n.x * n.z;
    hL11 += kBox * n.y * n.y;
    hL12 += kBox * n.y * n.z;
    hL22 += kBox * n.z * n.z;

    let rxn = cross(r, n);
    gAng += rxn * fnMag;
    hA00 += kBox * rxn.x * rxn.x;
    hA01 += kBox * rxn.x * rxn.y;
    hA02 += kBox * rxn.x * rxn.z;
    hA11 += kBox * rxn.y * rxn.y;
    hA12 += kBox * rxn.y * rxn.z;
    hA22 += kBox * rxn.z * rxn.z;

    // Relative tangential Coulomb friction between box pair.
    let dA = body.pos.xyz - body.prevPos.xyz;
    let dB = ob.pos.xyz - ob.prevPos.xyz;
    let relDisp = dA - dB;
    let tang = relDisp - n * dot(relDisp, n);
    let tangLen = length(tang);
    if (tangLen > 1e-5) {
      let muPair = min(mu, max(ob.colorMat.w, 0.1));
      let kT = kBox * 0.45;
      let ftMag = min(kT * tangLen, muPair * fnMag);
      let ft = -tang * (ftMag / tangLen);
      gLin += ft;
      gAng += cross(r, ft);
      let kEff = min(kT, (muPair * fnMag) / max(tangLen, 1e-3));
      hL00 += kEff * (1.0 - n.x * n.x);
      hL11 += kEff * (1.0 - n.y * n.y);
      hL22 += kEff * (1.0 - n.z * n.z);
    }
  }

  // Primal block step with relaxation for rock-solid Jacobi AVBD convergence.
  let relax = select(0.72, 0.62, ip.iterIndex > 0u);
  let maxStep = max(min(h.x, min(h.y, h.z)) * 0.85, 0.75);
  let dx = clampVec3(solveSpd3(hL00, hL01, hL02, hL11, hL12, hL22, gLin) * relax, maxStep);
  let dth = clampVec3(solveSpd3(hA00, hA01, hA02, hA11, hA12, hA22, gAng) * (relax * 0.85), 0.32);

  let nextPos = body.pos.xyz + dx;
  let nextQuat = integrateQuat(body.quat, dth, 1.0);
  if (isFiniteVec3(nextPos)) {
    body.pos = vec4f(nextPos, invMass);
    body.quat = nextQuat;
  }
  body.inertPos.w = groundDual;
  if (woke) { body.spin.w = 0.0; }
  bodiesOut[id] = body;
}

// ── Pass E: Finalize Velocities, Ground Clamp & Sleep Stabilization ────────
@compute @workgroup_size(64)
fn finalizePass(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x;
  if (id >= sp.bodyCount || id >= MAX_BODIES) { return; }
  var body = bodiesOut[id];
  if (body.pos.w <= 0.0) { return; }

  let dt = sp.dt;
  let R = quatMat(body.quat);
  let ah = aabbHalfExt(R, body.halfExt.xyz);

  // Hard ground floor guarantee so no corner can tunnel below groundY.
  let minY = body.pos.y - ah.y;
  if (minY < sp.groundY) {
    body.pos.y += (sp.groundY - minY);
  }

  let vPred = body.vel.xyz;
  var vel = (body.pos.xyz - body.prevPos.xyz) * sp.invDt;
  // Split-impulse depenetration guard: prevent deep-overlap position projection from injecting
  // spurious launch energy while preserving natural ballistic arcs and low-restitution stone bounce.
  let dv = vel - vPred;
  let dvLen = length(dv);
  if (dvLen > 32.0) {
    vel = vPred + dv * (32.0 / dvLen);
  }
  var spin = deltaTheta(body.prevQuat, body.quat) * sp.invDt;

  let nearGround = (body.pos.y - ah.y) <= (sp.groundY + 0.45);
  if (nearGround) {
    // Low-restitution concrete/stone floor rebound (e ~ 0.18) + contact rolling/sliding friction.
    let maxBounceY = max(0.0, -vPred.y * 0.18);
    vel.y = clamp(vel.y, -2.0, maxBounceY);
    let slideDamp = exp(-5.0 * dt);
    vel.x *= slideDamp;
    vel.z *= slideDamp;
    spin *= exp(-6.0 * dt);
  }

  // Mild aerodynamic + angular damping.
  let linDamp = exp(-0.45 * dt);
  let angDamp = exp(-1.6 * dt);
  vel = clampVec3(vel * linDamp, 1200.0);
  spin = clampVec3(spin * angDamp, 36.0);

  let speed2 = dot(vel, vel);
  let spin2 = dot(spin, spin);
  if (nearGround && speed2 < 9.0 && spin2 < 0.85) {
    body.spin.w += dt;
    if (body.spin.w > 0.25) {
      vel *= 0.25;
      spin *= 0.25;
    }
    if (body.spin.w > 0.40) {
      vel = vec3f(0.0);
      spin = vec3f(0.0);
    }
  } else {
    body.spin.w = max(0.0, body.spin.w - dt * 3.0);
  }

  if (!isFiniteVec3(body.pos.xyz)) {
    body.pos = vec4f(0.0, sp.groundY + 10.0, 0.0, 0.0);
    vel = vec3f(0.0);
    spin = vec3f(0.0);
  }

  body.vel = vec4f(vel, body.vel.w);
  body.spin = vec4f(spin, body.spin.w);
  bodiesOut[id] = body;
}
`

const RENDER_WGSL = /* wgsl */ `
${AVBD_STRUCT_WGSL}

struct DrawU {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, day: f32,
  forward: vec3f, hasWorld: f32,
  sun: vec3f, anchorX: f32,
  anchorY: f32, anchorZ: f32, pad0: f32, pad1: f32,
}
@group(0) @binding(0) var<uniform> u: DrawU;
@group(0) @binding(1) var<storage, read> bodies: array<AvbdBody>;
${GLOBALS}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
${SUNLIT}
${LIGHT}

const NEAR_Z = ${NEAR.toFixed(1)};
const FAR_Z = ${FAR.toFixed(1)};

fn quatMat(q: vec4f) -> mat3x3f {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  let xx = x * x;
  let yy = y * y;
  let zz = z * z;
  let xy = x * y;
  let xz = x * z;
  let yz = y * z;
  let wx = w * x;
  let wy = w * y;
  let wz = w * z;
  return mat3x3f(
    vec3f(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy)),
    vec3f(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx)),
    vec3f(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy))
  );
}

struct RubbleOut {
  @builtin(position) clipPos: vec4f,
  @location(0) worldRel: vec3f,
  @location(1) norm: vec3f,
  @location(2) localUvw: vec3f,
  @location(3) @interpolate(flat) albedo: vec3f,
  @location(4) @interpolate(flat) ember: f32,
}

@vertex fn vs(
  @location(0) localPos: vec3f,
  @location(1) localNorm: vec3f,
  @builtin(instance_index) inst: u32,
) -> RubbleOut {
  let body = bodies[inst];
  var out: RubbleOut;
  if (body.pos.w <= 0.0) {
    out.clipPos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.worldRel = vec3f(0.0);
    out.norm = vec3f(0.0, 1.0, 0.0);
    out.localUvw = vec3f(0.0);
    out.albedo = vec3f(0.0);
    out.ember = 0.0;
    return out;
  }

  let R = quatMat(body.quat);
  let worldPos = body.pos.xyz + R * (localPos * body.halfExt.xyz);
  let anchor = vec3f(u.anchorX, u.anchorY, u.anchorZ);
  let worldRel = worldPos - anchor;
  let seen = worldRel - u.eye;
  let depthZ = dot(seen, u.forward);

  out.clipPos = vec4f(
    dot(seen, u.right) / (u.tanHalf * u.aspect),
    dot(seen, u.up) / u.tanHalf,
    FAR_Z / (FAR_Z - NEAR_Z) * (depthZ - NEAR_Z),
    depthZ
  );
  out.worldRel = seen;
  out.norm = normalize(R * localNorm);
  out.localUvw = localPos;
  out.albedo = body.colorMat.rgb;
  out.ember = body.halfExt.w;
  return out;
}

@fragment fn fs(in: RubbleOut) -> @location(0) vec4f {
  let n = normalize(in.norm);
  let rd = normalize(in.worldRel);
  // Subtle edge wear darkening along box corners so rubble reads crisply as dressed stone/concrete chunks.
  let e = vec3f(1.0) - abs(in.localUvw);
  let edgeDist = max(min(e.x, e.y), min(max(e.x, e.y), e.z));
  let bevel = 0.78 + 0.22 * smoothstep(0.0, 0.14, edgeDist);
  let albedo = in.albedo * bevel;

  var col = vec3f(0.0);
  if (u.hasWorld > 0.5 && g.levels > 0u) {
    var direct = max(dot(n, u.sun), 0.0);
    if (direct > 0.0) {
      let sunny = sunlit(in.worldRel + u.eye, n, 0u);
      if (sunny >= 0.0) { direct *= sunny; }
    }
    col = shade(albedo, n, rd, u.sun, direct, 1.0, 0.88, 0.0);
  } else {
    let direct = max(dot(n, u.sun), 0.0);
    let above = 0.5 + 0.5 * n.y;
    let sunCol = vec3f(1.35, 1.24, 1.08) * mix(0.05, 1.0, u.day);
    let skyCol = mix(vec3f(0.10, 0.10, 0.11), vec3f(0.24, 0.30, 0.42), above) * mix(0.08, 1.0, u.day);
    col = albedo * (sunCol * direct * 1.45 + skyCol);
  }

  // Optional hot ember glow concentrated along edges of freshly blasted chunks.
  if (in.ember > 0.005) {
    let edgeGlow = 1.0 - smoothstep(0.0, 0.26, edgeDist);
    let emberCol = mix(vec3f(2.4, 0.42, 0.03), vec3f(4.2, 1.7, 0.25), edgeGlow);
    col += emberCol * (in.ember * (0.28 + 0.72 * edgeGlow));
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

/** Unit cube [-1, 1]^3 with 36 vertices (position vec3f + outward normal vec3f, CCW outward). */
function buildUnitCube(): Float32Array<ArrayBuffer> {
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ]
  const out = new Float32Array(new ArrayBuffer(36 * 6 * 4))
  let o = 0
  const push = (p: [number, number, number], n: [number, number, number]) => {
    out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]
    out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2]
  }
  for (const f of faces) {
    push(f.v[0], f.n); push(f.v[1], f.n); push(f.v[2], f.n)
    push(f.v[0], f.n); push(f.v[2], f.n); push(f.v[3], f.n)
  }
  return out
}

export interface RubbleBurstOptions {
  /** Initial ember glow intensity in `[0, 1]` (default 0.35). */
  emberHeat?: number
  /** Outward launch speed multiplier (default 1). */
  speedScale?: number
  /** Box half-extent range `[min, max]` in cells (default `[1.6, 3.4]`). */
  halfExtentRange?: readonly [number, number]
  /** Friction coefficient (default 0.72). */
  friction?: number
  /** Optional deterministic seed. */
  seed?: number
}

export interface AvbdRubbleStats {
  capacity: number
  active: number
  steps: number
  groundY: number
  iterations: number
}

export interface AvbdRubble {
  /** Spawns a burst of `count` dynamic rubble boxes around `center` (cells), returning number spawned. */
  spawnBurst(
    center: readonly [number, number, number],
    radius: number,
    count: number,
    groundY: number,
    color?: readonly [number, number, number],
    options?: RubbleBurstOptions,
  ): number
  /** Steps GPU compute AVBD solver (`dt` seconds) with ZERO CPU readback. */
  step(encoder: GPUCommandEncoder, dt: number, groundY?: number): void
  /** Records zero-copy instanced rubble boxes into an active `(to.color, to.depth)` render pass. */
  draw(pass: GPURenderPassEncoder, view: View, sunBindGroup?: GPUBindGroup, aspect?: number): void
  /** Convenience helper: opens a load/store render pass on `(to.color, to.depth)` and draws rubble. */
  drawTo(encoder: GPUCommandEncoder, to: Target, view: View, sunBindGroup?: GPUBindGroup): void
  /** Updates fallback viewport aspect ratio when `draw()` is called without explicit `aspect`. */
  setViewport(width: number, height: number): void
  /** Updates fallback sun direction and daylight factor. */
  light(sun: readonly number[], day?: number): void
  /** Clears all rubble slots on the GPU. */
  clear(): void
  readonly count: number
  readonly stats: AvbdRubbleStats
  /** Primary GPU-resident `bodies: array<AvbdBody>` storage buffer (zero-copy render source). */
  readonly bodiesBuffer: GPUBuffer
  /** Per-body truncated neighbor count buffer (`array<u32, 4096>`, each <= 32). */
  readonly neighborCountsBuffer: GPUBuffer
  readonly sunBindGroupLayout: GPUBindGroupLayout
  dispose(): void
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export async function createAvbdRubble(
  device: GPUDevice,
  format: GPUTextureFormat,
  march?: Marcher,
): Promise<AvbdRubble> {
  const [compMod, rendMod] = await Promise.all([
    shader(device, 'avbd-rubble-compute', COMPUTE_WGSL),
    shader(device, 'avbd-rubble-render', RENDER_WGSL),
  ])

  const C = GPUShaderStage.COMPUTE
  const compLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: C, buffer: {} },
      { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
      { binding: 3, visibility: C, buffer: { type: 'storage' } },
      { binding: 4, visibility: C, buffer: { type: 'storage' } },
      { binding: 5, visibility: C, buffer: { type: 'storage' } },
      { binding: 6, visibility: C, buffer: { type: 'storage' } },
      { binding: 7, visibility: C, buffer: { type: 'storage' } },
      { binding: 8, visibility: C, buffer: { type: 'storage' } },
    ],
  })
  const compLayout1 = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: C, buffer: {} }],
  })
  const compPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [compLayout0, compLayout1] })

  const rendLayout0 = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  })
  const sunLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
    ],
  })
  const rendPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [rendLayout0, sunLayout] })

  const [predictPipe, clearPipe, insertPipe, neighPipe, solvePipe, finalizePipe, renderPipe] = await Promise.all([
    device.createComputePipelineAsync({ label: 'avbd-predict', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'predictPass' } }),
    device.createComputePipelineAsync({ label: 'avbd-bp-clear', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'broadphaseClear' } }),
    device.createComputePipelineAsync({ label: 'avbd-bp-insert', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'broadphaseInsert' } }),
    device.createComputePipelineAsync({ label: 'avbd-neighbors', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'buildNeighbors' } }),
    device.createComputePipelineAsync({ label: 'avbd-solve', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'avbdSolvePass' } }),
    device.createComputePipelineAsync({ label: 'avbd-finalize', layout: compPipeLayout, compute: { module: compMod, entryPoint: 'finalizePass' } }),
    device.createRenderPipelineAsync({
      label: 'avbd-rubble-draw',
      layout: rendPipeLayout,
      vertex: {
        module: rendMod,
        entryPoint: 'vs',
        buffers: [{
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        }],
      },
      fragment: { module: rendMod, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
    }),
  ])

  const bodyBytes = MAX_RUBBLE_BODIES * AVBD_BODY_BYTES
  const bodiesA = device.createBuffer({
    label: 'avbd-bodies-A',
    size: bodyBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const bodiesB = device.createBuffer({
    label: 'avbd-bodies-B',
    size: bodyBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const bucketCounts = device.createBuffer({ label: 'avbd-bp-counts', size: HASH_BUCKETS * 4, usage: GPUBufferUsage.STORAGE })
  const bucketItems = device.createBuffer({ label: 'avbd-bp-items', size: HASH_BUCKETS * HASH_BUCKET_CAP * 4, usage: GPUBufferUsage.STORAGE })
  const candIds = device.createBuffer({ label: 'avbd-cand-ids', size: MAX_RUBBLE_BODIES * MAX_CANDIDATES * 4, usage: GPUBufferUsage.STORAGE })
  const candKeys = device.createBuffer({ label: 'avbd-cand-keys', size: MAX_RUBBLE_BODIES * MAX_CANDIDATES * 4, usage: GPUBufferUsage.STORAGE })
  const neighbors = device.createBuffer({ label: 'avbd-neighbors', size: MAX_RUBBLE_BODIES * MAX_NEIGHBORS * 4, usage: GPUBufferUsage.STORAGE })
  const neighborCounts = device.createBuffer({
    label: 'avbd-neighbor-counts',
    size: MAX_RUBBLE_BODIES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  const stepUniformBuf = device.createBuffer({ label: 'avbd-step-u', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const stepBufAb = new ArrayBuffer(32)
  const stepF32 = new Float32Array(stepBufAb)
  const stepU32 = new Uint32Array(stepBufAb)

  // Separate pre-baked uniform buffers for each AVBD iteration to avoid writeBuffer clobbering.
  const iterBinds: GPUBindGroup[] = []
  const iterBufs: GPUBuffer[] = []
  for (let i = 0; i < AVBD_ITERATIONS; i++) {
    const buf = device.createBuffer({ label: `avbd-iter-${i}`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(buf, 0, new Uint32Array([i, 0, 0, 0]))
    iterBufs.push(buf)
    iterBinds.push(device.createBindGroup({ layout: compLayout1, entries: [{ binding: 0, resource: { buffer: buf } }] }))
  }

  // Ping-pong bind groups: A->B reads bodiesA / writes bodiesB; B->A reads bodiesB / writes bodiesA.
  const makeCompBind = (src: GPUBuffer, dst: GPUBuffer) =>
    device.createBindGroup({
      layout: compLayout0,
      entries: [
        { binding: 0, resource: { buffer: stepUniformBuf } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: dst } },
        { binding: 3, resource: { buffer: bucketCounts } },
        { binding: 4, resource: { buffer: bucketItems } },
        { binding: 5, resource: { buffer: candIds } },
        { binding: 6, resource: { buffer: candKeys } },
        { binding: 7, resource: { buffer: neighbors } },
        { binding: 8, resource: { buffer: neighborCounts } },
      ],
    })
  const compAtoB = makeCompBind(bodiesA, bodiesB)
  const compBtoA = makeCompBind(bodiesB, bodiesA)

  const cubeData = buildUnitCube()
  const cubeVB = device.createBuffer({ label: 'avbd-cube-vb', size: cubeData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(cubeVB, 0, cubeData)

  const drawUniformBuf = device.createBuffer({ label: 'avbd-draw-u', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const drawF32 = new Float32Array(new ArrayBuffer(96))
  const drawBind = device.createBindGroup({
    layout: rendLayout0,
    entries: [
      { binding: 0, resource: { buffer: drawUniformBuf } },
      { binding: 1, resource: { buffer: bodiesA } },
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

  // Zero-initialize bodiesA/B on creation.
  const zeroBuf = new Float32Array(new ArrayBuffer(bodyBytes))
  device.queue.writeBuffer(bodiesA, 0, zeroBuf)
  device.queue.writeBuffer(bodiesB, 0, zeroBuf)

  let cursor = 0
  let highWater = 0
  let defaultGroundY = 0
  let stepCount = 0
  let burstSeq = 1
  let defaultAspect = 16 / 9
  let sunDir: [number, number, number] = [0.52, 0.62, 0.59]
  let dayLevel = 1

  const uploadScratch = new Float32Array(new ArrayBuffer(MAX_RUBBLE_BODIES * AVBD_BODY_BYTES))

  const draw = (pass: GPURenderPassEncoder, view: View, sunBindGroup?: GPUBindGroup, aspect?: number) => {
    if (highWater === 0) return
    const anchorX = Math.floor(view.eye[0] / 64) * 64
    const anchorY = Math.floor(view.eye[1] / 64) * 64
    const anchorZ = Math.floor(view.eye[2] / 64) * 64
    const { group: sunGroup, hasWorld } = resolveSun(sunBindGroup)
    const useAspect = aspect ?? defaultAspect

    drawF32.set([
      view.eye[0] - anchorX, view.eye[1] - anchorY, view.eye[2] - anchorZ, view.tanHalf,
      view.right[0], view.right[1], view.right[2], useAspect,
      view.up[0], view.up[1], view.up[2], dayLevel,
      view.forward[0], view.forward[1], view.forward[2], hasWorld,
      sunDir[0], sunDir[1], sunDir[2], anchorX,
      anchorY, anchorZ, 0, 0,
    ], 0)
    device.queue.writeBuffer(drawUniformBuf, 0, drawF32)

    pass.setPipeline(renderPipe)
    pass.setBindGroup(0, drawBind)
    pass.setBindGroup(1, sunGroup)
    pass.setVertexBuffer(0, cubeVB)
    pass.draw(36, highWater)
  }

  return {
    bodiesBuffer: bodiesA,
    neighborCountsBuffer: neighborCounts,
    sunBindGroupLayout: sunLayout,
    get count() { return highWater },
    get stats(): AvbdRubbleStats {
      return {
        capacity: MAX_RUBBLE_BODIES,
        active: highWater,
        steps: stepCount,
        groundY: defaultGroundY,
        iterations: AVBD_ITERATIONS,
      }
    },
    setViewport(width, height) {
      if (width > 0 && height > 0) defaultAspect = width / height
    },
    light(sun, day = 1) {
      const len = Math.hypot(sun[0], sun[1], sun[2]) || 1
      sunDir = [sun[0] / len, sun[1] / len, sun[2] / len]
      dayLevel = day
    },
    clear() {
      cursor = 0
      highWater = 0
      device.queue.writeBuffer(bodiesA, 0, zeroBuf)
      device.queue.writeBuffer(bodiesB, 0, zeroBuf)
    },
    spawnBurst(center, radius, count, groundY, color, options) {
      const n = Math.max(0, Math.min(MAX_RUBBLE_BODIES, Math.floor(count)))
      if (n === 0) return 0
      defaultGroundY = groundY
      const seed = options?.seed ?? ((Math.imul(burstSeq++, 2654435761) ^ Math.imul(Math.round(center[0] * 10), 73856093)) >>> 0)
      const R = mulberry32(seed || 1)
      const baseCol: readonly [number, number, number] = color ?? [0.42, 0.39, 0.36]
      const ember = options?.emberHeat ?? 0.35
      const speedScale = options?.speedScale ?? 1
      const minH = options?.halfExtentRange?.[0] ?? 1.6
      const maxH = options?.halfExtentRange?.[1] ?? 3.4
      const friction = options?.friction ?? 0.72
      const spanR = Math.max(2, radius)

      // Fill contiguous slices (wrapping once at MAX_RUBBLE_BODIES if needed).
      const firstLen = Math.min(n, MAX_RUBBLE_BODIES - cursor)
      const secondLen = n - firstLen

      const fillRange = (startSlot: number, len: number) => {
        for (let i = 0; i < len; i++) {
          const o = i * AVBD_BODY_FLOATS
          const hx = minH + R() * (maxH - minH)
          const hy = minH * 0.75 + R() * (maxH - minH) * 0.85
          const hz = minH + R() * (maxH - minH)
          const maxExt = Math.hypot(hx, hy, hz)

          // Distribute uniformly inside sphere/hemisphere above groundY.
          let dx = 0, dy = 0, dz = 0
          do {
            dx = R() * 2 - 1
            dy = R() * 2 - 1
            dz = R() * 2 - 1
          } while (dx * dx + dy * dy + dz * dz > 1)
          const px = center[0] + dx * spanR
          const py = Math.max(groundY + maxExt + 0.5, center[1] + Math.abs(dy) * spanR)
          const pz = center[2] + dz * spanR

          // Random unit quaternion.
          let qx = R() * 2 - 1, qy = R() * 2 - 1, qz = R() * 2 - 1, qw = R() * 2 - 1
          const ql = Math.hypot(qx, qy, qz, qw) || 1
          qx /= ql; qy /= ql; qz /= ql; qw /= ql

          // Outward + upward burst velocity (in cells/s).
          const radialLen = Math.hypot(dx, dz) || 1
          const outSpeed = (18 + R() * 44) * speedScale
          const vx = (dx / radialLen) * outSpeed
          const vy = (24 + R() * 48) * speedScale
          const vz = (dz / radialLen) * outSpeed

          const sx = (R() - 0.5) * 14 * speedScale
          const sy = (R() - 0.5) * 14 * speedScale
          const sz = (R() - 0.5) * 14 * speedScale

          const vol = Math.max(1, 8 * hx * hy * hz)
          const invMass = 1 / (vol * 0.08)
          const shade = 0.78 + 0.38 * R()

          // pos + invMass
          uploadScratch[o] = px; uploadScratch[o + 1] = py; uploadScratch[o + 2] = pz; uploadScratch[o + 3] = invMass
          // quat
          uploadScratch[o + 4] = qx; uploadScratch[o + 5] = qy; uploadScratch[o + 6] = qz; uploadScratch[o + 7] = qw
          // vel + age
          uploadScratch[o + 8] = vx; uploadScratch[o + 9] = vy; uploadScratch[o + 10] = vz; uploadScratch[o + 11] = 0
          // spin + sleepTimer
          uploadScratch[o + 12] = sx; uploadScratch[o + 13] = sy; uploadScratch[o + 14] = sz; uploadScratch[o + 15] = 0
          // halfExt + emberHeat
          uploadScratch[o + 16] = hx; uploadScratch[o + 17] = hy; uploadScratch[o + 18] = hz; uploadScratch[o + 19] = ember * (0.5 + 0.5 * R())
          // colorMat + friction
          uploadScratch[o + 20] = baseCol[0] * shade
          uploadScratch[o + 21] = baseCol[1] * shade
          uploadScratch[o + 22] = baseCol[2] * shade
          uploadScratch[o + 23] = friction
          // prevPos
          uploadScratch[o + 24] = px; uploadScratch[o + 25] = py; uploadScratch[o + 26] = pz; uploadScratch[o + 27] = 0
          // prevQuat
          uploadScratch[o + 28] = qx; uploadScratch[o + 29] = qy; uploadScratch[o + 30] = qz; uploadScratch[o + 31] = qw
          // inertPos + groundLambda
          uploadScratch[o + 32] = px; uploadScratch[o + 33] = py; uploadScratch[o + 34] = pz; uploadScratch[o + 35] = 0
          // inertQuat
          uploadScratch[o + 36] = qx; uploadScratch[o + 37] = qy; uploadScratch[o + 38] = qz; uploadScratch[o + 39] = qw
        }
        device.queue.writeBuffer(bodiesA, startSlot * AVBD_BODY_BYTES, uploadScratch, 0, len * AVBD_BODY_FLOATS)
      }

      if (firstLen > 0) fillRange(cursor, firstLen)
      if (secondLen > 0) fillRange(0, secondLen)
      cursor = (cursor + n) % MAX_RUBBLE_BODIES
      highWater = Math.min(MAX_RUBBLE_BODIES, Math.max(highWater, firstLen > 0 && secondLen > 0 ? MAX_RUBBLE_BODIES : cursor))
      if (secondLen > 0 || cursor === 0) highWater = MAX_RUBBLE_BODIES
      return n
    },
    step(encoder, dt, groundY) {
      if (highWater === 0) return
      const clampedDt = Math.max(1 / 240, Math.min(1 / 30, dt))
      const gY = groundY !== undefined ? groundY : defaultGroundY
      defaultGroundY = gY

      stepF32[0] = clampedDt
      stepF32[1] = 1 / clampedDt
      stepF32[2] = -98.1 // -9.81 m/s^2 in 10 cm cells
      stepF32[3] = gY
      stepF32[4] = 12.0 // spatial hash cell size (1.2 m)
      stepU32[5] = highWater
      stepF32[6] = 1.65 // betaGround
      stepF32[7] = 1.15 // betaBox
      device.queue.writeBuffer(stepUniformBuf, 0, stepBufAb)

      const bodyGroups = Math.ceil(highWater / 64)
      const hashGroups = Math.ceil(HASH_BUCKETS / 64)

      const pass = encoder.beginComputePass({ label: 'avbd-rubble-step' })
      // (a) Predict in-place on bodiesA (compBtoA writes bodiesA).
      pass.setPipeline(predictPipe)
      pass.setBindGroup(0, compBtoA)
      pass.setBindGroup(1, iterBinds[0])
      pass.dispatchWorkgroups(bodyGroups)

      // (b) Spatial-hash broadphase clear + insert (compAtoB reads bodiesA).
      pass.setPipeline(clearPipe)
      pass.setBindGroup(0, compAtoB)
      pass.dispatchWorkgroups(hashGroups)

      pass.setPipeline(insertPipe)
      pass.dispatchWorkgroups(bodyGroups)

      // (c) Per-body neighbor adjacency list with O(n log n) heap-sort truncation (>32).
      pass.setPipeline(neighPipe)
      pass.dispatchWorkgroups(bodyGroups)

      // (d) 4 AVBD primal-dual iterations ping-ponging A -> B -> A -> B -> A.
      pass.setPipeline(solvePipe)
      for (let it = 0; it < AVBD_ITERATIONS; it++) {
        pass.setBindGroup(0, (it & 1) === 0 ? compAtoB : compBtoA)
        pass.setBindGroup(1, iterBinds[it])
        pass.dispatchWorkgroups(bodyGroups)
      }

      // (e) Finalize velocities, floor clamp & rest-sleep stabilization in bodiesA.
      pass.setPipeline(finalizePipe)
      pass.setBindGroup(0, compBtoA)
      pass.setBindGroup(1, iterBinds[0])
      pass.dispatchWorkgroups(bodyGroups)
      pass.end()

      stepCount++
    },
    draw,
    drawTo(encoder, to, view, sunBindGroup) {
      if (highWater === 0) return
      const pass = encoder.beginRenderPass({
        label: 'avbd-rubble-draw',
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      draw(pass, view, sunBindGroup, to.size[0] / to.size[1])
      pass.end()
    },
    dispose() {
      bodiesA.destroy(); bodiesB.destroy()
      bucketCounts.destroy(); bucketItems.destroy()
      candIds.destroy(); candKeys.destroy()
      neighbors.destroy(); neighborCounts.destroy()
      stepUniformBuf.destroy()
      for (const b of iterBufs) b.destroy()
      cubeVB.destroy()
      drawUniformBuf.destroy()
      dummyGlobals.destroy(); dummySun.destroy()
    },
  }
}
