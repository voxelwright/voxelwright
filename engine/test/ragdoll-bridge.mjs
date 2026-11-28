// Unit tests for Lane 2's active ragdoll wire codec, `told.ts` POSE=14 record decoding,
// `missingLimbs` -> `people.ts` segment visibility & stump capping, and 13-bone limb transform
// bridge (#166). Pure Node, zero GPU contention.
//
//   node engine/test/ragdoll-bridge.mjs
import assert from 'node:assert/strict'
import {
  BONE,
  BONE_COUNT,
  BONE_PARENT,
  POSE_RECORD_WORDS,
  POSE_TAG,
  POSE_WIRE_BYTES,
  QUAT_IDENTITY,
  RAGDOLL_MODE,
  boneSubtreeMask,
  expandMissingLimbs,
  limbVisibility,
  localToWorldQuats,
  packPose,
  packPoseWords,
  packQuatSmallestThree,
  poseToLimbTransforms,
  quatAngleBetween,
  quatNorm,
  quatRotate,
  unpackPose,
  unpackPoseWords,
  unpackQuatSmallestThree,
  worldToLocalQuats,
} from '../page/ragdoll-bridge.ts'
import { fits, read } from '../page/told.ts'
import { hearing } from '../page/sound/world.ts'

const f32 = Math.fround
const FRAC_1_SQRT_2 = f32(Math.SQRT1_2)

function axisAngle(axis, angle) {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const h = 0.5 * angle
  const s = Math.sin(h) / l
  return quatNorm([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)])
}

function assertVecNear(a, b, eps, label) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(a[i] - b[i]) <= eps, `${label}[${i}]: got ${a[i]}, expected ${b[i]} (eps=${eps})`)
  }
}

function assertOrthonormalFrame(frame, label) {
  assert.equal(frame.length, 12, `${label}: frame must have 12 floats`)
  const rx = frame[0], ry = frame[1], rz = frame[2]
  const ux = frame[3], uy = frame[4], uz = frame[5]
  const bx = frame[6], by = frame[7], bz = frame[8]
  assert.ok(Math.abs(Math.hypot(rx, ry, rz) - 1) < 1e-5, `${label}: right unit length`)
  assert.ok(Math.abs(Math.hypot(ux, uy, uz) - 1) < 1e-5, `${label}: up unit length`)
  assert.ok(Math.abs(Math.hypot(bx, by, bz) - 1) < 1e-5, `${label}: back unit length`)
  assert.ok(Math.abs(rx * ux + ry * uy + rz * uz) < 1e-5, `${label}: right . up = 0`)
  assert.ok(Math.abs(rx * bx + ry * by + rz * bz) < 1e-5, `${label}: right . back = 0`)
  assert.ok(Math.abs(ux * bx + uy * by + uz * bz) < 1e-5, `${label}: up . back = 0`)
  // Right-handed: right x up == back
  assertVecNear([ry * uz - rz * uy, rz * ux - rx * uz, rx * uy - ry * ux], [bx, by, bz], 1e-5, `${label}: right x up == back`)
}

// ── 1. Exact bit-level parity with `engine/core/src/ragdoll.rs` smallest-three codec ──
{
  // Known exact bit patterns from `ragdoll.rs::pack_quat_smallest_three`:
  // Identity [0, 0, 0, 1]: largest=3, u=[511, 511, 511] -> 3 | (511<<2) | (511<<12) | (511<<22) = 0x7fdff7ff
  assert.equal(packQuatSmallestThree([0, 0, 0, 1]), 0x7fdff7ff)
  assert.equal(packQuatSmallestThree([0, 0, 0, -1]), 0x7fdff7ff, 'negative sign must canonicalize identically')
  const idUnpacked = unpackQuatSmallestThree(0x7fdff7ff)
  assert.ok(quatAngleBetween(QUAT_IDENTITY, idUnpacked) < 1e-6)

  // 90 deg about +Y: [0, 1/sqrt(2), 0, 1/sqrt(2)] -> largest=1 (strict >), rem=[0, 0, 1/sqrt(2)] -> u=[511, 511, 1022]
  // Bit 31 is SET (0xff9ff7fd): explicitly guards unsigned >>> 22 unpacking!
  const q90y = [0, FRAC_1_SQRT_2, 0, FRAC_1_SQRT_2]
  const bits90y = packQuatSmallestThree(q90y)
  assert.equal(bits90y, 0xff9ff7fd, 'bit-31-set smallest-three word must match ragdoll.rs bit-for-bit')
  assert.ok(quatAngleBetween(q90y, unpackQuatSmallestThree(bits90y)) < 1e-5)

  // All 4 largest-component slots (x=0, y=1, z=2, w=3) and corners from `ragdoll.rs` tests.
  const corners = [
    QUAT_IDENTITY,
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0.5, 0.5, 0.5, 0.5],
    [-0.5, 0.5, -0.5, 0.5],
    [FRAC_1_SQRT_2, FRAC_1_SQRT_2, 0, 0],
    [0, -FRAC_1_SQRT_2, 0, FRAC_1_SQRT_2],
    [0.57735026, -0.57735026, 0.57735026, 0],
    [-0.57735026, 0.57735026, -0.57735026, 0],
  ]
  let maxErr = 0
  for (const q of corners) {
    const bits = packQuatSmallestThree(q)
    const u = unpackQuatSmallestThree(bits)
    const err = quatAngleBetween(quatNorm(q), u)
    maxErr = Math.max(maxErr, err)
  }

  // Deterministic 5,000-sample SO(3) sweep mirroring `ragdoll.rs::smallest_three_wire_packing_round_trip_under_0_003_rad`.
  let seed = 0x16600166n
  const mask64 = (1n << 64n) - 1n
  const nextF = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & mask64
    const u = Number(seed >> 40n) / (1 << 24)
    return u * 2 - 1
  }
  for (let i = 0; i < 5000; i++) {
    const q = quatNorm([nextF(), nextF(), nextF(), nextF()])
    const bits = packQuatSmallestThree(q)
    const u = unpackQuatSmallestThree(bits)
    const err = quatAngleBetween(q, u)
    maxErr = Math.max(maxErr, err)
  }
  assert.ok(maxErr < 0.003, `smallest-three worst-case error ${maxErr.toFixed(6)} >= 0.003 rad`)
  console.log(`ok  smallest-three codec: 5,010 SO(3) quats maxErr=${maxErr.toFixed(6)} rad (< 0.003), bit-31 exact`)
}

// ── 2. Exact 67-byte `ragdoll.rs::pack_pose` binary layout & `told.ts` POSE=14 stream decoding ──
{
  assert.equal(POSE_TAG, 14)
  assert.equal(POSE_WIRE_BYTES, 67)
  assert.equal(POSE_RECORD_WORDS, 18)

  const pelvisPos = [12.5, 9.45, -33.75]
  const localRots = [
    axisAngle([0, 1, 0], -1.1),       // Pelvis (yaw = 1.1)
    axisAngle([1, 0, 0], -0.25),      // Chest (lean)
    axisAngle([0, 1, 0], 0.3),        // Head (turn)
    axisAngle([0, 0, 1], -0.2),       // UpperArmL
    axisAngle([1, 0, 0], 0.6),        // ForearmL
    axisAngle([1, 0, 0], 1.4),        // UpperArmR
    axisAngle([1, 0, 0], 0.9),        // ForearmR
    axisAngle([1, 0, 0], 0.4),        // ThighL
    axisAngle([-1, 0, 0], 0.8),       // ShinL
    axisAngle([-1, 0, 0], -0.2),      // FootL
    axisAngle([1, 0, 0], -0.25),      // ThighR
    axisAngle([-1, 0, 0], 0.35),      // ShinR
    axisAngle([-1, 0, 0], 0.1),       // FootR
  ]
  const worldRots = localToWorldQuats(localRots)
  const missingLimbs = 1 << BONE.ForearmR
  const mode = RAGDOLL_MODE.HitReaction

  // Hand-assemble the exact 67-byte `ragdoll.rs` wire buffer directly from LE primitives.
  const raw67 = new Uint8Array(new ArrayBuffer(67))
  const dv = new DataView(raw67.buffer)
  dv.setFloat32(0, pelvisPos[0], true)
  dv.setFloat32(4, pelvisPos[1], true)
  dv.setFloat32(8, pelvisPos[2], true)
  for (let i = 0; i < BONE_COUNT; i++) {
    dv.setUint32(12 + i * 4, packQuatSmallestThree(worldRots[i]), true)
  }
  dv.setUint16(64, missingLimbs, true)
  dv.setUint8(66, mode)

  // Verify `packPose` matches the hand-assembled 67-byte buffer byte-for-byte.
  const packed = packPose({ pelvisPos, bones: worldRots, missingLimbs, mode })
  assert.equal(packed.byteLength, 67)
  assert.deepEqual(packed, raw67, 'packPose must match exact 67-byte ragdoll.rs layout')

  // Verify `unpackPose` round-trip.
  const decoded = unpackPose(raw67, 777)
  assert.equal(decoded.id, 777)
  assertVecNear(decoded.pelvisPos, pelvisPos, 1e-5, 'pelvisPos')
  assert.equal(decoded.missingLimbs, missingLimbs)
  assert.equal(decoded.mode, mode)
  let poseMaxErr = 0
  for (let i = 0; i < BONE_COUNT; i++) {
    poseMaxErr = Math.max(poseMaxErr, quatAngleBetween(worldRots[i], decoded.bones[i]))
  }
  assert.ok(poseMaxErr < 0.003, `13-bone pose round-trip error ${poseMaxErr} >= 0.003 rad`)

  // Verify `told.ts` decodes single & batched `POSE = 14` records mixed with other solver records,
  // including when `words` has a non-zero `byteOffset`!
  const pose1 = { id: 101, pelvisPos, bones: worldRots, missingLimbs, mode }
  const pose2 = {
    id: 202,
    pelvisPos: [-4.25, 1.5, 88.0],
    bones: Array.from({ length: BONE_COUNT }, (_, i) => axisAngle([0, 1, 0], i * 0.17)),
    missingLimbs: (1 << BONE.UpperArmL) | (1 << BONE.FootR),
    mode: RAGDOLL_MODE.FullRagdoll,
  }
  const w1 = packPoseWords(pose1)
  const w2 = packPoseWords(pose2)
  assert.equal(w1.length, 18)
  assert.equal(w2.length, 18)

  // Build stream with leading padding words so we can slice with a non-zero byteOffset:
  // [pad, pad, BROKE(6,1,42), POSE(14,18,...w1), POSE(14,36,...w1,...w2), BROKE(6,1,99)]
  const backing = new Uint32Array(new ArrayBuffer((2 + 3 + 20 + 38 + 3) * 4))
  let o = 2
  backing.set([6, 1, 42], o); o += 3
  backing.set([14, 18, ...w1], o); o += 20
  backing.set([14, 36, ...w1, ...w2], o); o += 38
  backing.set([6, 1, 99], o); o += 3

  const stream = new Uint32Array(backing.buffer, 8, backing.length - 2)
  assert.equal(stream.byteOffset, 8)
  const told = read(stream)
  assert.deepEqual(told.broke, [42, 99])
  assert.equal(told.poses.length, 3, '1 single POSE + 2 batched POSE = 3 records')
  assert.equal(told.poses[0].id, 101)
  assert.equal(told.poses[1].id, 101)
  assert.equal(told.poses[2].id, 202)
  assertVecNear(told.poses[0].pelvisPos, pelvisPos, 1e-5, 'told pose0 pelvis')
  assert.equal(told.poses[0].missingLimbs, missingLimbs)
  assert.equal(told.poses[0].mode, RAGDOLL_MODE.HitReaction)
  assertVecNear(told.poses[2].pelvisPos, pose2.pelvisPos, 1e-5, 'told pose2 pelvis')
  assert.equal(told.poses[2].missingLimbs, pose2.missingLimbs)
  assert.equal(told.poses[2].mode, RAGDOLL_MODE.FullRagdoll)
  for (let i = 0; i < BONE_COUNT; i++) {
    assert.ok(quatAngleBetween(worldRots[i], told.poses[0].bones[i]) < 0.003)
    assert.ok(quatAngleBetween(pose2.bones[i], told.poses[2].bones[i]) < 0.003)
  }

  // Verify `unpackPoseWords` directly and security guards in `fits()` / `read()`.
  assert.deepEqual(unpackPoseWords(w1, 0), told.poses[0])
  assert.equal(fits(14, 18, 2, 20), true)
  assert.equal(fits(14, 36, 2, 38), true)
  assert.equal(fits(14, 0, 2, 2), false, 'empty POSE record refused')
  assert.equal(fits(14, 17, 2, 19), false, 'truncated POSE record refused')
  assert.equal(fits(14, 19, 2, 21), false, 'misaligned POSE record refused')
  assert.equal(fits(14, 0xffff_fff0, 2, 20), false, 'overflow POSE record refused')
  const truncated = read(new Uint32Array([6, 1, 7, 14, 17, ...new Array(17).fill(0), 6, 1, 8]))
  assert.deepEqual(truncated.broke, [7], 'stops cleanly at malformed POSE')
  assert.equal(truncated.poses.length, 0)

  console.log(`ok  67-byte wire & told.ts POSE=14: single+batched+offset parity verified, poseMaxErr=${poseMaxErr.toFixed(6)} rad`)
}

// ── 3. `missingLimbs` -> `people.ts` segment visibility & stump capping ──
{
  const intact = limbVisibility(0)
  assert.equal(intact.effectiveMissing, 0)
  assert.ok(intact.bones.every(Boolean))
  assert.ok(Object.values(intact.segments).every(Boolean))
  assert.equal(intact.stumps.length, 0)

  // Severing UpperArmL alone must hide UpperArmL, ForearmL, and handL, and emit 1 shoulderL stump on Chest.
  const leftArm = limbVisibility(1 << BONE.UpperArmL)
  assert.equal(leftArm.effectiveMissing, boneSubtreeMask(BONE.UpperArmL))
  assert.equal(leftArm.segments.upperArmL, false)
  assert.equal(leftArm.segments.forearmL, false)
  assert.equal(leftArm.segments.handL, false)
  assert.equal(leftArm.segments.chest, true)
  assert.equal(leftArm.segments.upperArmR, true)
  assert.equal(leftArm.stumps.length, 1)
  assert.equal(leftArm.stumps[0].parentBone, BONE.Chest)
  assert.equal(leftArm.stumps[0].severedBone, BONE.UpperArmL)
  assert.equal(leftArm.stumps[0].joint, 'shoulderL')

  // Severing ForearmR + ShinL + Head emits 3 distinct stumps on intact parents.
  const multi = limbVisibility((1 << BONE.ForearmR) | (1 << BONE.ShinL) | (1 << BONE.Head))
  assert.equal(multi.segments.forearmR, false)
  assert.equal(multi.segments.handR, false)
  assert.equal(multi.segments.upperArmR, true)
  assert.equal(multi.segments.shinL, false)
  assert.equal(multi.segments.footL, false)
  assert.equal(multi.segments.thighL, true)
  assert.equal(multi.segments.head, false)
  assert.deepEqual(
    multi.stumps.map((s) => s.joint).sort(),
    ['elbowR', 'kneeL', 'neck'],
  )

  // Subtree expansion check for Chest.
  assert.equal(
    expandMissingLimbs(1 << BONE.Chest),
    (1 << BONE.Chest) | (1 << BONE.Head) | (1 << BONE.UpperArmL) | (1 << BONE.ForearmL) | (1 << BONE.UpperArmR) | (1 << BONE.ForearmR),
  )

  console.log('ok  missingLimbs visibility & stump capping: subtree propagation and exposed joints verified')
}

// ── 4. 13-bone world/local quaternion -> `people.ts` limb transforms bridge ──
{
  // Standing rest pose at feet = [10, 0, -20], yaw = 0 -> pelvis COM = [10, 9.45, -20].
  const restPose = {
    id: 1,
    pelvisPos: [10, 9.45, -20],
    bones: Array.from({ length: BONE_COUNT }, () => [...QUAT_IDENTITY]),
    missingLimbs: 0,
    mode: RAGDOLL_MODE.Locomotion,
  }
  const restRender = poseToLimbTransforms(restPose)
  assertVecNear(restRender.feetPos, [10, 0, -20], 1e-5, 'standing feetPos')
  assert.ok(Math.abs(restRender.yaw) < 1e-6, 'standing yaw = 0')
  assert.equal(restRender.limbs.length, BONE_COUNT)
  for (const limb of restRender.limbs) {
    assert.equal(limb.visible, true)
    assertOrthonormalFrame(limb.frame, `rest.${limb.name}`)
  }
  // Verify ankle origins match `people.ts` sole height (y = 0.5) and neck sits at y = 9.0 + 1.2 + 4.9 = 15.1.
  assertVecNear(restRender.limbs[BONE.FootL].origin, [10 - 1.02, 0.5, -20], 1e-5, 'rest ankleL')
  assertVecNear(restRender.limbs[BONE.FootR].origin, [10 + 1.02, 0.5, -20], 1e-5, 'rest ankleR')
  assertVecNear(restRender.limbs[BONE.Head].origin, [10, 15.1, -20], 1e-5, 'rest neck')

  // Articulated pose: compare `'world'` vs `'local'` input parity + stump world placement.
  const yaw = 0.75
  const localBones = [
    axisAngle([0, 1, 0], -yaw),
    axisAngle([1, 0, 0], -0.2),
    axisAngle([0, 1, 0], -0.35),
    axisAngle([0, 0, 1], -0.3),
    axisAngle([1, 0, 0], 1.1),
    axisAngle([1, 0, 0], 1.25),
    axisAngle([1, 0, 0], 0.8),
    axisAngle([1, 0, 0], 0.5),
    axisAngle([-1, 0, 0], 1.0),
    axisAngle([-1, 0, 0], -0.3),
    axisAngle([1, 0, 0], -0.3),
    axisAngle([-1, 0, 0], 0.4),
    axisAngle([-1, 0, 0], 0.15),
  ]
  const worldBones = localToWorldQuats(localBones)
  const backToLocal = worldToLocalQuats(worldBones)
  for (let i = 0; i < BONE_COUNT; i++) {
    assert.ok(quatAngleBetween(localBones[i], backToLocal[i]) < 1e-5, `worldToLocal round-trip bone ${i}`)
  }

  const fromWorld = poseToLimbTransforms(
    { id: 9, pelvisPos: [5, 11.2, -7], bones: worldBones, missingLimbs: 1 << BONE.ForearmR, mode: RAGDOLL_MODE.HitReaction },
    { space: 'world' },
  )
  const fromLocal = poseToLimbTransforms(
    { id: 9, pelvisPos: [5, 11.2, -7], bones: localBones, missingLimbs: 1 << BONE.ForearmR, mode: RAGDOLL_MODE.HitReaction },
    { space: 'local' },
  )
  assert.ok(Math.abs(fromWorld.yaw - yaw) < 1e-5, `yaw recovered: ${fromWorld.yaw} vs ${yaw}`)
  for (let i = 0; i < BONE_COUNT; i++) {
    assertVecNear(fromWorld.limbs[i].origin, fromLocal.limbs[i].origin, 1e-5, `world/local origin[${i}]`)
    assertVecNear(fromWorld.limbs[i].com, fromLocal.limbs[i].com, 1e-5, `world/local com[${i}]`)
    assert.ok(quatAngleBetween(fromWorld.limbs[i].worldRot, fromLocal.limbs[i].worldRot) < 1e-5)
    assertOrthonormalFrame(fromWorld.limbs[i].frame, `art.${fromWorld.limbs[i].name}`)
  }
  assert.equal(fromWorld.limbs[BONE.ForearmR].visible, false)
  assert.equal(fromWorld.stumpCaps.length, 1)
  assert.equal(fromWorld.stumpCaps[0].joint, 'elbowR')
  // World stump cap center must coincide with the severed ForearmR's elbow joint origin!
  assertVecNear(fromWorld.stumpCaps[0].pos, fromWorld.limbs[BONE.ForearmR].origin, 1e-5, 'elbowR stump world pos')
  assertOrthonormalFrame(fromWorld.stumpCaps[0].frame, 'elbowR stump frame')
  // Outward normal of elbowR points along UpperArmR's local -Y in world space.
  const expectedNormal = quatRotate(worldBones[BONE.UpperArmR], [0, -1, 0])
  assertVecNear(fromWorld.stumpCaps[0].normal, expectedNormal, 1e-5, 'elbowR stump normal')

  console.log('ok  limb transform bridge: rest pose, world/local parity, orthonormal frames, and world stump cap verified')
}

// ── 5. Verify `sound/world.ts` exposes `.combat` controller surface ──
{
  const noopVoice = {
    context: { currentTime: 0 },
    play: () => true,
    hold: () => 1,
    release: () => {},
    glide: () => {},
    place: () => 1,
    set: () => {},
    hear: () => ({ gain: 1, pan: 0, lp: 20000, late: 0 }),
    listen: () => {},
    forget: () => {},
    told: null,
  }
  const noopScene = {
    ground: () => 0,
    paving: () => 0,
    rain: () => 0,
    under: () => false,
    flames: () => new Float32Array(0),
    bodies: () => 0,
    hour: () => 12,
    making: () => false,
    kind: () => 0,
  }
  const worldSound = hearing(noopVoice, noopScene, { music: false })
  for (const fn of [
    'parryClash',
    'bluntHit',
    'bladeStab',
    'saberIgnite',
    'saberUpdate',
    'saberClash',
    'bulletCrack',
    'ricochet',
    'shockwaveBoom',
    'laserSizzle',
    'tennisPop',
    'tennisBounce',
  ]) {
    assert.equal(typeof worldSound.combat[fn], 'function', `worldSound.combat.${fn} must be wired`)
  }
  assert.equal(worldSound.combat.parryClash({ impulse: 0.8 }), true)
  assert.equal(worldSound.combat.tennisPop({ velocity: 0.9, sweetSpot: 1 }), true)
  worldSound.combat.stopAll()
  console.log('ok  sound/world.ts: .combat controller exposes all 12 required combat/sports methods')
}

console.log('ragdoll-bridge: ok')
