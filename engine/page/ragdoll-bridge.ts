// Active ragdoll wire codec & character-pose bridge (#166):
// Decodes the exact 67-byte smallest-three 13-bone wire packet from `engine/core/src/ragdoll.rs`
// (`pack_pose` / `unpack_pose`), maps `missingLimbs` bitmasks to `people.ts` segment visibility
// and exposed stump caps, and converts 13-bone world/local quaternions into `people.ts`-compatible
// 12-float joint frames (`[right(3), up(3), back(3), origin(3)]`).

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

/** Number of bones in Voxelwright's humanoid active ragdoll skeleton (`ragdoll.rs::BONE_COUNT`). */
export const BONE_COUNT = 13

/** Packed 67-byte pose wire size (`12 B pelvis + 52 B 13x u32 quats + 2 B missing_limbs + 1 B mode`). */
export const POSE_WIRE_BYTES = 12 + BONE_COUNT * 4 + 2 + 1

/** Number of `u32` words storing the 67-byte pose payload (68 B with trailing zero pad byte). */
export const POSE_PACKED_WORDS = 17

/** Words per `POSE = 14` record entry in `told.ts`: `ragdollId: u32` + 17 packed words. */
export const POSE_RECORD_WORDS = 1 + POSE_PACKED_WORDS

/** `told.ts` / `bodies.rs` wire record tag for active ragdoll pose packets. */
export const POSE_TAG = 14

/** Bone identifiers matching `engine/core/src/ragdoll.rs::BoneId` in topological parent-before-child order. */
export const BONE = {
  Pelvis: 0,
  Chest: 1,
  Head: 2,
  UpperArmL: 3,
  ForearmL: 4,
  UpperArmR: 5,
  ForearmR: 6,
  ThighL: 7,
  ShinL: 8,
  FootL: 9,
  ThighR: 10,
  ShinR: 11,
  FootR: 12,
} as const

export type BoneId = (typeof BONE)[keyof typeof BONE]

export const BONE_NAMES = [
  'pelvis',
  'chest',
  'head',
  'upperArmL',
  'forearmL',
  'upperArmR',
  'forearmR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const

export type BoneName = (typeof BONE_NAMES)[number]

/** Active ragdoll blending mode matching `engine/core/src/ragdoll.rs::RagdollMode`. */
export const RAGDOLL_MODE = {
  Locomotion: 0,
  HitReaction: 1,
  FullRagdoll: 2,
  GetUp: 3,
} as const

export type RagdollMode = (typeof RAGDOLL_MODE)[keyof typeof RAGDOLL_MODE]

/** Parent bone index in the 13-bone skeletal tree (`-1` for Pelvis root). */
export const BONE_PARENT: readonly number[] = [
  -1, // 0: Pelvis
  0,  // 1: Chest -> Pelvis
  1,  // 2: Head -> Chest
  1,  // 3: UpperArmL -> Chest
  3,  // 4: ForearmL -> UpperArmL
  1,  // 5: UpperArmR -> Chest
  5,  // 6: ForearmR -> UpperArmR
  0,  // 7: ThighL -> Pelvis
  7,  // 8: ShinL -> ThighL
  8,  // 9: FootL -> ShinL
  0,  // 10: ThighR -> Pelvis
  10, // 11: ShinR -> ThighR
  11, // 12: FootR -> ShinR
]

/** Unpacked active ragdoll pose record decoded from `POSE = 14` or a raw 67-byte `ragdoll.rs` packet. */
export interface RagdollPoseRecord {
  /** Ragdoll / actor identifier (`u32`). */
  id: number
  /** World-space Pelvis center-of-mass position in finest cells (`[x, y, z]`). */
  pelvisPos: Vec3
  /** 13 unit quaternions `[x, y, z, w]` ordered by `BONE` (`0..12`). */
  bones: Quat[]
  /** 13-bit dismemberment mask (`1 << boneId` set for each severed bone). */
  missingLimbs: number
  /** Active ragdoll mode (`0` Locomotion, `1` HitReaction, `2` FullRagdoll, `3` GetUp). */
  mode: RagdollMode
}

/** Joint stump descriptor in parent bone COM-local space for capping severed limbs. */
export interface StumpCap {
  /** Intact proximal parent bone carrying the stump cap. */
  parentBone: BoneId
  /** Severed distal child bone whose joint is exposed. */
  severedBone: BoneId
  /** Human-readable joint name at the severing plane. */
  joint: string
  /** Joint pivot position in parent bone COM-local coordinates (cells). */
  localAnchor: Vec3
  /** Outward unit normal in parent bone COM-local coordinates pointing toward the severed child. */
  localNormal: Vec3
  /** Suggested cap radius matching the joint cross-section (cells). */
  radius: number
}

/** World-space stump cap ready for rendering as a closed cap on the intact parent segment. */
export interface WorldStumpCap extends StumpCap {
  /** World-space cap center (cells). */
  pos: Vec3
  /** World-space outward unit normal. */
  normal: Vec3
  /** 12-float `people.ts`-compatible Frame `[right(3), up(3), back(3), pos(3)]` whose `+Y` axis aligns with `normal`. */
  frame: Float64Array
}

/** Segment visibility flags aligned with `people.ts` body parts plus exposed stump caps. */
export interface LimbVisibility {
  /** Effective 13-bit mask after propagating severed parents to every descendant bone. */
  effectiveMissing: number
  /** Per-bone visibility indexed by `BoneId` (`0..12`). */
  bones: readonly boolean[]
  /** Named `people.ts` segment visibility flags (severed limbs and their hands/feet are hidden). */
  segments: {
    pelvis: boolean
    chest: boolean
    head: boolean
    upperArmL: boolean
    forearmL: boolean
    handL: boolean
    upperArmR: boolean
    forearmR: boolean
    handR: boolean
    thighL: boolean
    shinL: boolean
    footL: boolean
    thighR: boolean
    shinR: boolean
    footR: boolean
  }
  /** Exposed joints where an intact parent meets a severed child (for stump capping). */
  stumps: StumpCap[]
}

/** Renderable transform for a single bone compatible with `people.ts` 12-float joint frames. */
export interface LimbTransform {
  bone: BoneId
  name: BoneName
  visible: boolean
  /** World-space bone center-of-mass position (cells). */
  com: Vec3
  /** World-space proximal joint pivot (or `HIP` origin for Pelvis) matching `people.ts` Frame origin (cells). */
  origin: Vec3
  /** World-space orientation unit quaternion `[x, y, z, w]`. */
  worldRot: Quat
  /** Parent-relative local unit quaternion `[x, y, z, w]` (equals `worldRot` for Pelvis). */
  localRot: Quat
  /** 12-float `people.ts` Frame: `[right(3), up(3), back(3), origin(3)]`. */
  frame: Float64Array
}

/** Complete render-ready pose output produced by `poseToLimbTransforms`. */
export interface RagdollRenderPose {
  id: number
  mode: RagdollMode
  pelvisPos: Vec3
  /** Estimated world feet anchor (`HIP origin - hipHeight * pelvisUp`) for `people.ts` shadow/LOD/sign placement. */
  feetPos: Vec3
  /** Pelvis heading yaw in radians (`0 = -Z`, positive clockwise from above, matching `people.ts`). */
  yaw: number
  /** Raw severed-bone bits from the solver, before hiding descendants. */
  missingLimbs: number
  visibility: LimbVisibility
  limbs: LimbTransform[]
  stumpCaps: WorldStumpCap[]
}

export interface PoseBridgeOptions {
  /** Character height scale matching `people.ts` `tall` (default `1.0`, clamped to `[0.75, 1.35]`). */
  tall?: number
  /** Character breadth scale matching `people.ts` `broad` (default `1.0`, clamped to `[0.75, 1.35]`). */
  broad?: number
  /** Interpretation of `pose.bones`: `'world'` (default, matches `ragdoll.rs::pack_pose`) or `'local'` (parent-relative `1..12`). */
  space?: 'world' | 'local'
}

// ── Quaternion Math (matching `engine/core/src/ragdoll.rs`) ─────────────────

const f32 = Math.fround
const FRAC_1_SQRT_2 = f32(Math.SQRT1_2)
const HALF_RANGE = 511
const INV_HALF_RANGE = f32(1 / HALF_RANGE)
const PACK_SCALE = f32(HALF_RANGE / FRAC_1_SQRT_2)
const UNPACK_SCALE = f32(FRAC_1_SQRT_2 / HALF_RANGE)

export const QUAT_IDENTITY: readonly [number, number, number, number] = [0, 0, 0, 1]

export function quatNorm(q: readonly [number, number, number, number]): Quat {
  const l2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]
  if (l2 > 1e-12 && Number.isFinite(l2)) {
    const inv = 1 / Math.sqrt(l2)
    return [q[0] * inv, q[1] * inv, q[2] * inv, q[3] * inv]
  }
  return [0, 0, 0, 1]
}

export function quatConj(q: readonly [number, number, number, number]): Quat {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function quatMul(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function quatRotate(q: readonly [number, number, number, number], v: readonly [number, number, number]): Vec3 {
  const ux = q[0], uy = q[1], uz = q[2], w = q[3]
  const tx = 2 * (uy * v[2] - uz * v[1])
  const ty = 2 * (uz * v[0] - ux * v[2])
  const tz = 2 * (ux * v[1] - uy * v[0])
  return [
    v[0] + w * tx + (uy * tz - uz * ty),
    v[1] + w * ty + (uz * tx - ux * tz),
    v[2] + w * tz + (ux * ty - uy * tx),
  ]
}

/** Shortest geodesic angular distance in radians `[0, pi]` between two unit quaternions. */
export function quatAngleBetween(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): number {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))
  return 2 * Math.acos(dot)
}

/** Converts a unit quaternion into right/up/back orthonormal basis vectors matching `people.ts` Frame axes. */
export function quatToAxes(q: readonly [number, number, number, number]): { right: Vec3; up: Vec3; back: Vec3 } {
  const x = q[0], y = q[1], z = q[2], w = q[3]
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  return {
    right: [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy)],
    up: [2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx)],
    back: [2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)],
  }
}

/** Converts 13 world-space bone quaternions into `[pelvisWorld, ...parentRelativeLocals]`. */
export function worldToLocalQuats(worldRots: readonly (readonly [number, number, number, number])[]): Quat[] {
  const out: Quat[] = new Array(BONE_COUNT)
  out[0] = quatNorm(worldRots[0] ?? QUAT_IDENTITY)
  for (let i = 1; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i]
    const qp = quatNorm(worldRots[p] ?? QUAT_IDENTITY)
    const qc = quatNorm(worldRots[i] ?? QUAT_IDENTITY)
    out[i] = quatNorm(quatMul(quatConj(qp), qc))
  }
  return out
}

/** Converts `[pelvisWorld, ...parentRelativeLocals]` into 13 world-space bone quaternions via FK. */
export function localToWorldQuats(localRots: readonly (readonly [number, number, number, number])[]): Quat[] {
  const out: Quat[] = new Array(BONE_COUNT)
  out[0] = quatNorm(localRots[0] ?? QUAT_IDENTITY)
  for (let i = 1; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i]
    out[i] = quatNorm(quatMul(out[p], quatNorm(localRots[i] ?? QUAT_IDENTITY)))
  }
  return out
}

// ── Smallest-Three Wire Codec (bit-exact with `engine/core/src/ragdoll.rs`) ──

function quatNormF32(q: readonly [number, number, number, number]): Quat {
  const q0 = f32(q[0]), q1 = f32(q[1]), q2 = f32(q[2]), q3 = f32(q[3])
  const l2 = f32(f32(q0 * q0) + f32(q1 * q1) + f32(q2 * q2) + f32(q3 * q3))
  if (l2 > 1e-12 && Number.isFinite(l2)) {
    const inv = f32(1 / f32(Math.sqrt(l2)))
    return [f32(q0 * inv), f32(q1 * inv), f32(q2 * inv), f32(q3 * inv)]
  }
  return [0, 0, 0, 1]
}

/**
 * Packs a unit quaternion `[x, y, z, w]` into a smallest-three `u32`, matching
 * `engine/core/src/ragdoll.rs::pack_quat_smallest_three` bit-for-bit:
 * - bits `0..1`: index of largest-magnitude component (`0..3`), enforced positive
 * - bits `2..11`, `12..21`, `22..31`: remaining 3 components quantized to `0..=1022` (`-511..=+511` over `[-1/sqrt(2), +1/sqrt(2)]`).
 */
export function packQuatSmallestThree(qIn: readonly [number, number, number, number]): number {
  let q = quatNormF32(qIn)
  let largest = 0
  let bestAbs = Math.abs(q[0])
  for (let i = 1; i < 4; i++) {
    const a = Math.abs(q[i])
    if (a > bestAbs) {
      bestAbs = a
      largest = i
    }
  }
  if (q[largest] < 0) q = [f32(-q[0]), f32(-q[1]), f32(-q[2]), f32(-q[3])]

  const rem0 = q[largest === 0 ? 1 : 0]
  const rem1 = q[largest <= 1 ? 2 : 1]
  const rem2 = q[largest <= 2 ? 3 : 2]
  const qLargest = q[largest]

  const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
  const b0 = clampI(Math.floor(f32(rem0 * PACK_SCALE)), -HALF_RANGE, HALF_RANGE - 1)
  const b1 = clampI(Math.floor(f32(rem1 * PACK_SCALE)), -HALF_RANGE, HALF_RANGE - 1)
  const b2 = clampI(Math.floor(f32(rem2 * PACK_SCALE)), -HALF_RANGE, HALF_RANGE - 1)

  let bestDot = -1
  let bestU0 = HALF_RANGE
  let bestU1 = HALF_RANGE
  let bestU2 = HALF_RANGE

  for (let mask = 0; mask < 8; mask++) {
    const i0 = clampI(b0 + (mask & 1), -HALF_RANGE, HALF_RANGE)
    const i1 = clampI(b1 + ((mask >>> 1) & 1), -HALF_RANGE, HALF_RANGE)
    const i2 = clampI(b2 + ((mask >>> 2) & 1), -HALF_RANGE, HALF_RANGE)
    const c0 = f32(f32(i0 * INV_HALF_RANGE) * FRAC_1_SQRT_2)
    const c1 = f32(f32(i1 * INV_HALF_RANGE) * FRAC_1_SQRT_2)
    const c2 = f32(f32(i2 * INV_HALF_RANGE) * FRAC_1_SQRT_2)
    const sumSq = f32(f32(c0 * c0) + f32(c1 * c1) + f32(c2 * c2))
    if (sumSq > f32(1.0001)) continue
    const w = f32(Math.sqrt(Math.max(0, f32(1 - sumSq))))
    const dot = Math.abs(f32(f32(c0 * rem0) + f32(c1 * rem1) + f32(c2 * rem2) + f32(w * qLargest)))
    if (dot > bestDot) {
      bestDot = dot
      bestU0 = i0 + HALF_RANGE
      bestU1 = i1 + HALF_RANGE
      bestU2 = i2 + HALF_RANGE
    }
  }

  return (largest | (bestU0 << 2) | (bestU1 << 12) | (bestU2 << 22)) >>> 0
}

/**
 * Unpacks a smallest-three `u32` back into a normalized unit quaternion `[x, y, z, w]`,
 * matching `engine/core/src/ragdoll.rs::unpack_quat_smallest_three` bit-for-bit.
 */
export function unpackQuatSmallestThree(bits: number): Quat {
  const b = bits >>> 0
  const largest = b & 0x3
  const u0 = Math.min((b >>> 2) & 0x3ff, 1022) - HALF_RANGE
  const u1 = Math.min((b >>> 12) & 0x3ff, 1022) - HALF_RANGE
  const u2 = Math.min((b >>> 22) & 0x3ff, 1022) - HALF_RANGE
  const c0 = f32(u0 * UNPACK_SCALE)
  const c1 = f32(u1 * UNPACK_SCALE)
  const c2 = f32(u2 * UNPACK_SCALE)
  const sumSq = f32(f32(c0 * c0) + f32(c1 * c1) + f32(c2 * c2))
  const w = f32(Math.sqrt(Math.max(0, f32(1 - sumSq))))

  const q: Quat = [0, 0, 0, 0]
  let k = 0
  for (let i = 0; i < 4; i++) {
    if (i === largest) q[i] = w
    else {
      q[i] = k === 0 ? c0 : k === 1 ? c1 : c2
      k++
    }
  }
  return quatNormF32(q)
}

/** Converts raw wire mode byte to `RagdollMode` matching `ragdoll.rs::RagdollMode::from_u8`. */
export function modeFromU8(v: number): RagdollMode {
  const b = v & 0xff
  if (b === 0) return RAGDOLL_MODE.Locomotion
  if (b === 1) return RAGDOLL_MODE.HitReaction
  if (b === 2) return RAGDOLL_MODE.FullRagdoll
  return RAGDOLL_MODE.GetUp
}

/**
 * Decodes an exact 67-byte `ragdoll.rs` wire packet into a `RagdollPoseRecord`:
 * - bytes `0..12`: `pelvisPos` (`3 x f32` LE)
 * - bytes `12..64`: 13 smallest-three unit quaternions (`13 x u32` LE)
 * - bytes `64..66`: `missingLimbs` (`u16` LE)
 * - byte `66`: `mode` (`u8`)
 */
export function unpackPose(bytes: Uint8Array, id = 0, byteOffset = 0): RagdollPoseRecord {
  if (byteOffset < 0 || bytes.byteLength - byteOffset < POSE_WIRE_BYTES) {
    throw new RangeError(`unpackPose needs ${POSE_WIRE_BYTES} bytes, got ${bytes.byteLength - byteOffset}`)
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset + byteOffset, POSE_WIRE_BYTES)
  const pelvisPos: Vec3 = [dv.getFloat32(0, true), dv.getFloat32(4, true), dv.getFloat32(8, true)]
  const bones: Quat[] = new Array(BONE_COUNT)
  for (let i = 0; i < BONE_COUNT; i++) {
    bones[i] = unpackQuatSmallestThree(dv.getUint32(12 + i * 4, true))
  }
  const missingLimbs = dv.getUint16(64, true)
  const mode = modeFromU8(dv.getUint8(66))
  return { id: id >>> 0, pelvisPos, bones, missingLimbs, mode }
}

/** Encodes a ragdoll pose into the exact 67-byte `ragdoll.rs::pack_pose` wire layout. */
export function packPose(pose: Omit<RagdollPoseRecord, 'id'> | RagdollPoseRecord): Uint8Array<ArrayBuffer> {
  if (pose.bones.length !== BONE_COUNT) {
    throw new RangeError(`packPose requires ${BONE_COUNT} bone quaternions, got ${pose.bones.length}`)
  }
  const out = new Uint8Array(new ArrayBuffer(POSE_WIRE_BYTES))
  const dv = new DataView(out.buffer)
  dv.setFloat32(0, pose.pelvisPos[0], true)
  dv.setFloat32(4, pose.pelvisPos[1], true)
  dv.setFloat32(8, pose.pelvisPos[2], true)
  for (let i = 0; i < BONE_COUNT; i++) {
    dv.setUint32(12 + i * 4, packQuatSmallestThree(pose.bones[i]), true)
  }
  dv.setUint16(64, pose.missingLimbs & 0xffff, true)
  dv.setUint8(66, pose.mode & 0xff)
  return out
}

/** Decodes one 18-word `POSE = 14` entry (`ragdollId: u32` + 17 packed `u32` words) from `words` starting at `at`. */
export function unpackPoseWords(words: Uint32Array, at = 0): RagdollPoseRecord {
  if (at < 0 || words.length - at < POSE_RECORD_WORDS) {
    throw new RangeError(`unpackPoseWords needs ${POSE_RECORD_WORDS} words, got ${words.length - at}`)
  }
  const id = words[at] >>> 0
  const bytes = new Uint8Array(words.buffer, words.byteOffset + (at + 1) * 4, POSE_WIRE_BYTES)
  return unpackPose(bytes, id, 0)
}

/** Encodes a `RagdollPoseRecord` into 18 `u32` words (`[ragdollId, ...17 packed words]`, byte 67 zero-padded). */
export function packPoseWords(pose: RagdollPoseRecord): Uint32Array<ArrayBuffer> {
  const words = new Uint32Array(new ArrayBuffer(POSE_RECORD_WORDS * 4))
  words[0] = pose.id >>> 0
  new Uint8Array(words.buffer, 4, POSE_WIRE_BYTES).set(packPose(pose))
  return words
}

// ── Skeleton Proportions & Dismemberment Visibility ─────────────────────────

interface JointGeom {
  parent: BoneId
  child: BoneId
  joint: string
  parentAnchor: Vec3
  childAnchor: Vec3
  stumpNormal: Vec3
  stumpRadius: number
}

function clampScale(v: number | undefined): number {
  const n = v ?? 1
  if (!Number.isFinite(n)) return 1
  return Math.min(1.35, Math.max(0.75, n))
}

function vSub(a: readonly [number, number, number], b: readonly [number, number, number]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vAdd(a: readonly [number, number, number], b: readonly [number, number, number]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function vUnit(v: readonly [number, number, number], fallback: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-8 ? [v[0] / l, v[1] / l, v[2] / l] : fallback
}

/**
 * Computes exact COM-relative joint anchors matching `engine/core/src/ragdoll.rs::standing_scaled`
 * and `engine/page/people.ts`.
 */
function buildJoints(tall: number, broad: number): { hipY: number; joints: JointGeom[] } {
  const thighLen = 4.5 * tall
  const calfLen = 4.0 * tall
  const sole = 0.5
  const hipY = thighLen + calfLen + sole
  const hipHalfX = 1.02 * broad
  const shoulderHalfX = 2.55 * broad
  const upperArmLen = 3.4 * tall
  const neckYFromChest = 4.9 * tall
  const shoulderYFromChest = 4.4 * tall

  const pelvisCom: Vec3 = [0, hipY + 0.45, 0]
  const spinePiv: Vec3 = [0, hipY + 1.2, 0]
  const chestCom: Vec3 = [0, spinePiv[1] + 2.4 * tall, 0]
  const neckPiv: Vec3 = [0, spinePiv[1] + neckYFromChest, 0]
  const headCom: Vec3 = [0, neckPiv[1] + 1.55 * tall, 0]

  const shLPiv: Vec3 = [-shoulderHalfX, spinePiv[1] + shoulderYFromChest, 0]
  const uarmLCom: Vec3 = [-shoulderHalfX, shLPiv[1] - 0.5 * upperArmLen, 0]
  const elbLPiv: Vec3 = [-shoulderHalfX, shLPiv[1] - upperArmLen, 0]
  const farmLCom: Vec3 = [-shoulderHalfX, elbLPiv[1] - 1.9 * tall, 0]

  const shRPiv: Vec3 = [shoulderHalfX, spinePiv[1] + shoulderYFromChest, 0]
  const uarmRCom: Vec3 = [shoulderHalfX, shRPiv[1] - 0.5 * upperArmLen, 0]
  const elbRPiv: Vec3 = [shoulderHalfX, shRPiv[1] - upperArmLen, 0]
  const farmRCom: Vec3 = [shoulderHalfX, elbRPiv[1] - 1.9 * tall, 0]

  const hipLPiv: Vec3 = [-hipHalfX, hipY, 0]
  const thighLCom: Vec3 = [-hipHalfX, hipY - 0.5 * thighLen, 0]
  const kneeLPiv: Vec3 = [-hipHalfX, hipY - thighLen, 0]
  const shinLCom: Vec3 = [-hipHalfX, kneeLPiv[1] - 0.5 * calfLen, 0]
  const ankleLPiv: Vec3 = [-hipHalfX, sole, 0]
  const footLCom: Vec3 = [-hipHalfX, sole, -0.55]

  const hipRPiv: Vec3 = [hipHalfX, hipY, 0]
  const thighRCom: Vec3 = [hipHalfX, hipY - 0.5 * thighLen, 0]
  const kneeRPiv: Vec3 = [hipHalfX, hipY - thighLen, 0]
  const shinRCom: Vec3 = [hipHalfX, kneeRPiv[1] - 0.5 * calfLen, 0]
  const ankleRPiv: Vec3 = [hipHalfX, sole, 0]
  const footRCom: Vec3 = [hipHalfX, sole, -0.55]

  const joints: JointGeom[] = [
    { parent: BONE.Pelvis, child: BONE.Chest, joint: 'spine', parentAnchor: vSub(spinePiv, pelvisCom), childAnchor: vSub(spinePiv, chestCom), stumpNormal: [0, 1, 0], stumpRadius: 1.15 * broad },
    { parent: BONE.Chest, child: BONE.Head, joint: 'neck', parentAnchor: vSub(neckPiv, chestCom), childAnchor: vSub(neckPiv, headCom), stumpNormal: [0, 1, 0], stumpRadius: 0.62 },
    { parent: BONE.Chest, child: BONE.UpperArmL, joint: 'shoulderL', parentAnchor: vSub(shLPiv, chestCom), childAnchor: vSub(shLPiv, uarmLCom), stumpNormal: [-1, 0, 0], stumpRadius: 0.7 },
    { parent: BONE.UpperArmL, child: BONE.ForearmL, joint: 'elbowL', parentAnchor: vSub(elbLPiv, uarmLCom), childAnchor: vSub(elbLPiv, farmLCom), stumpNormal: [0, -1, 0], stumpRadius: 0.62 },
    { parent: BONE.Chest, child: BONE.UpperArmR, joint: 'shoulderR', parentAnchor: vSub(shRPiv, chestCom), childAnchor: vSub(shRPiv, uarmRCom), stumpNormal: [1, 0, 0], stumpRadius: 0.7 },
    { parent: BONE.UpperArmR, child: BONE.ForearmR, joint: 'elbowR', parentAnchor: vSub(elbRPiv, uarmRCom), childAnchor: vSub(elbRPiv, farmRCom), stumpNormal: [0, -1, 0], stumpRadius: 0.62 },
    { parent: BONE.Pelvis, child: BONE.ThighL, joint: 'hipL', parentAnchor: vSub(hipLPiv, pelvisCom), childAnchor: vSub(hipLPiv, thighLCom), stumpNormal: [0, -1, 0], stumpRadius: 0.85 },
    { parent: BONE.ThighL, child: BONE.ShinL, joint: 'kneeL', parentAnchor: vSub(kneeLPiv, thighLCom), childAnchor: vSub(kneeLPiv, shinLCom), stumpNormal: [0, -1, 0], stumpRadius: 0.72 },
    { parent: BONE.ShinL, child: BONE.FootL, joint: 'ankleL', parentAnchor: vSub(ankleLPiv, shinLCom), childAnchor: vSub(ankleLPiv, footLCom), stumpNormal: [0, -1, 0], stumpRadius: 0.56 },
    { parent: BONE.Pelvis, child: BONE.ThighR, joint: 'hipR', parentAnchor: vSub(hipRPiv, pelvisCom), childAnchor: vSub(hipRPiv, thighRCom), stumpNormal: [0, -1, 0], stumpRadius: 0.85 },
    { parent: BONE.ThighR, child: BONE.ShinR, joint: 'kneeR', parentAnchor: vSub(kneeRPiv, thighRCom), childAnchor: vSub(kneeRPiv, shinRCom), stumpNormal: [0, -1, 0], stumpRadius: 0.72 },
    { parent: BONE.ShinR, child: BONE.FootR, joint: 'ankleR', parentAnchor: vSub(ankleRPiv, shinRCom), childAnchor: vSub(ankleRPiv, footRCom), stumpNormal: [0, -1, 0], stumpRadius: 0.56 },
  ]
  return { hipY, joints }
}

/** Returns the 13-bit mask covering `bone` and all of its descendants (matches `ragdoll.rs::BoneId::subtree_mask`). */
export function boneSubtreeMask(bone: BoneId): number {
  let mask = 1 << bone
  for (let i = bone + 1; i < BONE_COUNT; i++) {
    if ((mask & (1 << BONE_PARENT[i])) !== 0) mask |= 1 << i
  }
  return mask
}

/** Propagates any severed parent bit in `missingLimbs` to all of its descendant bones. */
export function expandMissingLimbs(missingLimbs: number): number {
  let mask = missingLimbs & ((1 << BONE_COUNT) - 1)
  for (let i = 1; i < BONE_COUNT; i++) {
    if ((mask & (1 << BONE_PARENT[i])) !== 0) mask |= 1 << i
  }
  return mask
}

/**
 * Maps a `missingLimbs` bitmask to `people.ts` segment visibility flags (hiding severed limbs
 * and their distal hands/feet) and returns exposed joint stumps for stump capping.
 */
export function limbVisibility(missingLimbs: number, opts: Pick<PoseBridgeOptions, 'tall' | 'broad'> = {}): LimbVisibility {
  const tall = clampScale(opts.tall)
  const broad = clampScale(opts.broad)
  const effectiveMissing = expandMissingLimbs(missingLimbs)
  const bones: boolean[] = new Array(BONE_COUNT)
  for (let i = 0; i < BONE_COUNT; i++) bones[i] = (effectiveMissing & (1 << i)) === 0

  const { joints } = buildJoints(tall, broad)
  const stumps: StumpCap[] = []
  for (const j of joints) {
    if (bones[j.parent] && !bones[j.child]) {
      stumps.push({
        parentBone: j.parent,
        severedBone: j.child,
        joint: j.joint,
        localAnchor: [...j.parentAnchor],
        localNormal: [...j.stumpNormal],
        radius: j.stumpRadius,
      })
    }
  }

  return {
    effectiveMissing,
    bones,
    segments: {
      pelvis: bones[BONE.Pelvis],
      chest: bones[BONE.Chest],
      head: bones[BONE.Head],
      upperArmL: bones[BONE.UpperArmL],
      forearmL: bones[BONE.ForearmL],
      handL: bones[BONE.ForearmL],
      upperArmR: bones[BONE.UpperArmR],
      forearmR: bones[BONE.ForearmR],
      handR: bones[BONE.ForearmR],
      thighL: bones[BONE.ThighL],
      shinL: bones[BONE.ShinL],
      footL: bones[BONE.FootL],
      thighR: bones[BONE.ThighR],
      shinR: bones[BONE.ShinR],
      footR: bones[BONE.FootR],
    },
    stumps,
  }
}

function makeFrame(right: Vec3, up: Vec3, back: Vec3, origin: Vec3): Float64Array {
  const f = new Float64Array(12)
  f[0] = right[0]; f[1] = right[1]; f[2] = right[2]
  f[3] = up[0]; f[4] = up[1]; f[5] = up[2]
  f[6] = back[0]; f[7] = back[1]; f[8] = back[2]
  f[9] = origin[0]; f[10] = origin[1]; f[11] = origin[2]
  return f
}

function frameFromNormal(normal: Vec3, pos: Vec3): Float64Array {
  const up = vUnit(normal, [0, 1, 0])
  const ref: Vec3 = Math.abs(up[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1]
  // right = normalize(up x ref), back = right x up (right-handed basis with +Y = normal)
  const rx = up[1] * ref[2] - up[2] * ref[1]
  const ry = up[2] * ref[0] - up[0] * ref[2]
  const rz = up[0] * ref[1] - up[1] * ref[0]
  const right = vUnit([rx, ry, rz], [1, 0, 0])
  const back: Vec3 = [
    right[1] * up[2] - right[2] * up[1],
    right[2] * up[0] - right[0] * up[2],
    right[0] * up[1] - right[1] * up[0],
  ]
  return makeFrame(right, up, back, pos)
}

/**
 * Converts a decoded 13-bone `RagdollPoseRecord` (with world or parent-relative local quaternions)
 * into renderable `people.ts`-compatible limb transforms, segment visibility flags, and world-space
 * stump caps for any severed joints.
 */
export function poseToLimbTransforms(pose: RagdollPoseRecord, opts: PoseBridgeOptions = {}): RagdollRenderPose {
  if (pose.bones.length !== BONE_COUNT) {
    throw new RangeError(`poseToLimbTransforms requires ${BONE_COUNT} bone quaternions, got ${pose.bones.length}`)
  }
  const tall = clampScale(opts.tall)
  const broad = clampScale(opts.broad)
  const space = opts.space ?? 'world'

  const worldRots = space === 'local' ? localToWorldQuats(pose.bones) : pose.bones.map((q) => quatNorm(q))
  const localRots = space === 'local' ? pose.bones.map((q) => quatNorm(q)) : worldToLocalQuats(worldRots)

  const visibility = limbVisibility(pose.missingLimbs, { tall, broad })
  const { hipY, joints } = buildJoints(tall, broad)

  const coms: Vec3[] = new Array(BONE_COUNT)
  const origins: Vec3[] = new Array(BONE_COUNT)
  const pelvisPos: Vec3 = [pose.pelvisPos[0], pose.pelvisPos[1], pose.pelvisPos[2]]
  coms[0] = pelvisPos
  // In `people.ts`, the `HIP` frame sits 0.45 cells below pelvis COM along pelvis -Y.
  origins[0] = vAdd(pelvisPos, quatRotate(worldRots[0], [0, -0.45, 0]))

  for (const j of joints) {
    const pCom = coms[j.parent]
    const jointWorld = vAdd(pCom, quatRotate(worldRots[j.parent], j.parentAnchor))
    const childAnchorWorld = quatRotate(worldRots[j.child], j.childAnchor)
    origins[j.child] = jointWorld
    coms[j.child] = vSub(jointWorld, childAnchorWorld)
  }

  const limbs: LimbTransform[] = new Array(BONE_COUNT)
  for (let i = 0; i < BONE_COUNT; i++) {
    const axes = quatToAxes(worldRots[i])
    limbs[i] = {
      bone: i as BoneId,
      name: BONE_NAMES[i],
      visible: visibility.bones[i],
      com: coms[i],
      origin: origins[i],
      worldRot: worldRots[i],
      localRot: localRots[i],
      frame: makeFrame(axes.right, axes.up, axes.back, origins[i]),
    }
  }

  const pelvisAxes = quatToAxes(worldRots[0])
  // Pelvis forward is -back; yaw = 0 faces -Z, positive yaw turns right (+X) matching `people.ts`.
  const fwdX = -pelvisAxes.back[0]
  const fwdZ = -pelvisAxes.back[2]
  const yaw = Math.hypot(fwdX, fwdZ) > 1e-6 ? Math.atan2(fwdX, -fwdZ) : 0
  const feetPos: Vec3 = [
    origins[0][0] - pelvisAxes.up[0] * hipY,
    origins[0][1] - pelvisAxes.up[1] * hipY,
    origins[0][2] - pelvisAxes.up[2] * hipY,
  ]

  const stumpCaps: WorldStumpCap[] = visibility.stumps.map((stump) => {
    const pRot = worldRots[stump.parentBone]
    const pos = vAdd(coms[stump.parentBone], quatRotate(pRot, stump.localAnchor))
    const normal = vUnit(quatRotate(pRot, stump.localNormal), [0, 1, 0])
    return {
      ...stump,
      pos,
      normal,
      frame: frameFromNormal(normal, pos),
    }
  })

  return {
    id: pose.id >>> 0,
    mode: pose.mode,
    pelvisPos,
    feetPos,
    yaw,
    missingLimbs: pose.missingLimbs,
    visibility,
    limbs,
    stumpCaps,
  }
}
