// Playable tennis court controller, typed core.wasm sports bridge, and deterministic
// 120 Hz / 480 Hz client-server rollback synchronization (#166).
//
// Wraps `engine/core/src/sports.rs`'s `sports_*` exports with safe post-call WASM memory
// reads (never caching `memory.buffer` across calls), drives an ITF-proportioned court
// (`hard`, `clay`, `grass`) coupled to `combatSound`'s modal tennis foley, and reconciles
// compact 32-byte authoritative snapshots across 4–16+ frame (33–133+ ms) RTT delays.
import type { CombatSound, CourtSurface } from './sound/combat.ts'

export type { CourtSurface }
export type Vec3 = readonly [number, number, number]
export type MutableVec3 = [number, number, number]
/** Unit quaternion stored as `[x, y, z, w]` matching `engine/core/src/sports.rs`. */
export type Quat = readonly [number, number, number, number]
export type CourtSide = 'near' | 'far'

// ── Units, Physics & ITF Court Constants (1 cell = 0.1 m = 10 cm) ───────────

export const CELL_M = 0.1
export const CELLS_PER_M = 10.0
export const GRAVITY_CELLS = 98.0
export const TICK_HZ = 120
export const TICK_DT = 1 / TICK_HZ
export const SUBSTEPS = 4
export const SUBSTEP_DT = TICK_DT / SUBSTEPS
export const BALL_RADIUS_CELLS = 0.335
export const SNAPSHOT_BYTES = 32
/** Number of tick slots stored inside `core.wasm`'s `RollbackRing<16>`. */
export const WASM_ROLLBACK_SLOTS = 16

export const COURT_SURFACE_CODE: Readonly<Record<CourtSurface, 0 | 1 | 2>> = {
  hard: 0,
  clay: 1,
  grass: 2,
}

export interface CourtSurfaceParams {
  /** Normal coefficient of restitution (`e_n`). */
  readonly eN: number
  /** Sliding Coulomb friction coefficient (`mu`). */
  readonly mu: number
}

export const COURT_SURFACE_PARAMS: Readonly<Record<CourtSurface, CourtSurfaceParams>> = {
  hard: { eN: 0.75, mu: 0.65 },
  clay: { eN: 0.80, mu: 0.85 },
  grass: { eN: 0.68, mu: 0.45 },
}

/** Regulation ITF tennis court dimensions in Voxelwright 10 cm cells. */
export const ITF_COURT = {
  length: 237.7,
  halfLength: 118.85,
  singlesWidth: 82.3,
  singlesHalfWidth: 41.15,
  doublesWidth: 109.7,
  doublesHalfWidth: 54.85,
  serviceLineDist: 64.0,
  netHalfSpan: 64.0,
  netCenterHeight: 9.14,
  netPostHeight: 10.7,
  netTapeRadius: 0.25,
  netMeshHalfThick: 0.05,
} as const

/** Regulation tennis racket head geometry & stringbed response in 10 cm cells. */
export const RACKET_SPEC = {
  semiA: 1.6,
  semiB: 1.25,
  halfThick: 0.08,
  eCenter: 0.45,
  eRim: 0.15,
  muString: 0.35,
} as const

// ── Unit Conversions & Pure Algebraic Vector/Quaternion Helpers ─────────────

export function metersToCells(m: number): number {
  return m * CELLS_PER_M
}

export function cellsToMeters(c: number): number {
  return c * CELL_M
}

export function kmhToCellsPerSec(kmh: number): number {
  return kmh * (CELLS_PER_M / 3.6)
}

export function cellsPerSecToKmh(cps: number): number {
  return cps * (3.6 / CELLS_PER_M)
}

export function rpmToRadSec(rpm: number): number {
  return rpm * ((2 * Math.PI) / 60)
}

export function radSecToRpm(radSec: number): number {
  return radSec * (60 / (2 * Math.PI))
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

function vecSub(a: Vec3, b: Vec3): MutableVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vecCross(a: Vec3, b: Vec3): MutableVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function vecLen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

function vecNormalizeOr(a: Vec3, fallback: Vec3): MutableVec3 {
  const l = Math.hypot(a[0], a[1], a[2])
  if (l > 1e-6) return [a[0] / l, a[1] / l, a[2] / l]
  return [fallback[0], fallback[1], fallback[2]]
}

export function quatNormalize(q: Quat): [number, number, number, number] {
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  if (l > 1e-6) return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
  return [0, 0, 0, 1]
}

function quatInvRotate(q: Quat, v: Vec3): MutableVec3 {
  const ux = -q[0]
  const uy = -q[1]
  const uz = -q[2]
  const qw = q[3]
  const tx = 2 * (uy * v[2] - uz * v[1])
  const ty = 2 * (uz * v[0] - ux * v[2])
  const tz = 2 * (ux * v[1] - uy * v[0])
  return [
    v[0] + qw * tx + (uy * tz - uz * ty),
    v[1] + qw * ty + (uz * tx - ux * tz),
    v[2] + qw * tz + (ux * ty - uy * tx),
  ]
}

function quatNlerp(q0: Quat, q1: Quat, t: number): [number, number, number, number] {
  const d = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3]
  const s = d < 0 ? -1 : 1
  const omt = 1 - t
  return quatNormalize([
    omt * q0[0] + t * s * q1[0],
    omt * q0[1] + t * s * q1[1],
    omt * q0[2] + t * s * q1[2],
    omt * q0[3] + t * s * q1[3],
  ])
}

/**
 * Purely algebraic Shepperd's method matching `sports.rs::quat_from_normal`.
 * Local +Z points along `normal`, with local +Y aligned toward `upHint`.
 */
export function quatFromNormal(normal: Vec3, upHint: Vec3 = [0, 1, 0]): [number, number, number, number] {
  const z = vecNormalizeOr(normal, [0, 0, 1])
  let x = vecCross(upHint, z)
  if (vecDot(x, x) < 1e-8) {
    const alt: Vec3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    x = vecCross(alt, z)
  }
  x = vecNormalizeOr(x, [1, 0, 0])
  const y = vecCross(z, x)
  const m00 = x[0], m01 = y[0], m02 = z[0]
  const m10 = x[1], m11 = y[1], m12 = z[1]
  const m20 = x[2], m21 = y[2], m22 = z[2]
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return quatNormalize([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s])
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    return quatNormalize([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s])
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    return quatNormalize([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s])
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2
  return quatNormalize([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s])
}

export interface RacketPose {
  readonly center: Vec3
  readonly quat: Quat
}

export interface RacketSwing {
  readonly prev: RacketPose
  readonly curr: RacketPose
}

export function racketPoseFromNormal(center: Vec3, normal: Vec3, upHint: Vec3 = [0, 1, 0]): RacketPose {
  return { center: [center[0], center[1], center[2]], quat: quatFromNormal(normal, upHint) }
}

export interface BallState {
  pos: MutableVec3
  vel: MutableVec3
  spin: MutableVec3
}

export interface BallSnapshot extends BallState {
  tick: number
}

// ── 32-Byte Deterministic Wire Snapshot Codec (Bit-Exact with sports.rs) ────

const f32Scratch = new ArrayBuffer(4)
const f32View = new Float32Array(f32Scratch)
const u32View = new Uint32Array(f32Scratch)

function f32ToBits(v: number): number {
  f32View[0] = v
  return u32View[0]
}

function bitsToF32(bits: number): number {
  u32View[0] = bits >>> 0
  return f32View[0]
}

/**
 * Encodes an `f32` into `sports.rs`'s 21-bit deterministic float:
 * 1 sign bit + 6 exponent bits (bias 31) + 14 mantissa bits (round-to-nearest-even).
 */
export function encodeF21(v: number): number {
  if (!Number.isFinite(v)) return 0
  const bits = f32ToBits(Math.fround(v))
  const sign = (bits >>> 31) & 1
  const exp32 = (bits >>> 23) & 0xff
  const mant32 = bits & 0x7fffff

  if (exp32 === 0) return sign << 20
  const exp21 = exp32 - 96
  if (exp21 <= 0) return sign << 20
  if (exp21 >= 63) return (sign << 20) | (62 << 14) | 0x3fff

  const roundBit = (mant32 >>> 8) & 1
  const sticky = (mant32 & 0xff) !== 0 ? 1 : 0
  const lsb = (mant32 >>> 9) & 1
  let mant21 = (mant32 >>> 9) + (roundBit !== 0 && (sticky !== 0 || lsb !== 0) ? 1 : 0)
  let e = exp21
  if (mant21 >= 1 << 14) {
    mant21 = 0
    e += 1
    if (e >= 63) return (sign << 20) | (62 << 14) | 0x3fff
  }
  return ((sign << 20) | (e << 14) | mant21) >>> 0
}

/** Decodes a 21-bit deterministic float back to IEEE-754 `f32`. */
export function decodeF21(bits: number): number {
  const b = bits >>> 0
  const sign = (b >>> 20) & 1
  const exp21 = (b >>> 14) & 0x3f
  const mant21 = b & 0x3fff
  if (exp21 === 0) return bitsToF32(sign << 31)
  const exp32 = exp21 + 96
  const mant32 = mant21 << 9
  return bitsToF32(((sign << 31) | (exp32 << 23) | mant32) >>> 0)
}

/**
 * Encodes a `BallSnapshot` into the exact 32-byte little-endian wire layout used by `sports.rs`:
 * - bytes `0..4`: `tick` (`u32`)
 * - bytes `4..16`: `pos[0..3]` (`f32`, lossless)
 * - bytes `16..24`: `vel[0..3]` (3 × 21-bit floats packed into one `u64`)
 * - bytes `24..32`: `spin[0..3]` (3 × 21-bit floats packed into one `u64`)
 */
export function encodeBallSnapshot(snap: BallSnapshot): Uint8Array {
  const out = new Uint8Array(SNAPSHOT_BYTES)
  const dv = new DataView(out.buffer, out.byteOffset, SNAPSHOT_BYTES)
  dv.setUint32(0, snap.tick >>> 0, true)
  dv.setFloat32(4, snap.pos[0], true)
  dv.setFloat32(8, snap.pos[1], true)
  dv.setFloat32(12, snap.pos[2], true)

  const vPack =
    BigInt(encodeF21(snap.vel[0])) |
    (BigInt(encodeF21(snap.vel[1])) << 21n) |
    (BigInt(encodeF21(snap.vel[2])) << 42n)
  const wPack =
    BigInt(encodeF21(snap.spin[0])) |
    (BigInt(encodeF21(snap.spin[1])) << 21n) |
    (BigInt(encodeF21(snap.spin[2])) << 42n)

  dv.setBigUint64(16, vPack, true)
  dv.setBigUint64(24, wPack, true)
  return out
}

/** Decodes a 32-byte `sports.rs` authoritative wire snapshot. */
export function decodeBallSnapshot(bytes: Uint8Array): BallSnapshot {
  if (bytes.byteLength !== SNAPSHOT_BYTES) {
    throw new RangeError(`Expected ${SNAPSHOT_BYTES}-byte sports snapshot, got ${bytes.byteLength}`)
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, SNAPSHOT_BYTES)
  const tick = dv.getUint32(0, true)
  const px = dv.getFloat32(4, true)
  const py = dv.getFloat32(8, true)
  const pz = dv.getFloat32(12, true)
  const vPack = dv.getBigUint64(16, true)
  const wPack = dv.getBigUint64(24, true)
  const mask21 = (1n << 21n) - 1n
  return {
    tick,
    pos: [px, py, pz],
    vel: [
      decodeF21(Number(vPack & mask21)),
      decodeF21(Number((vPack >> 21n) & mask21)),
      decodeF21(Number((vPack >> 42n) & mask21)),
    ],
    spin: [
      decodeF21(Number(wPack & mask21)),
      decodeF21(Number((wPack >> 21n) & mask21)),
      decodeF21(Number((wPack >> 42n) & mask21)),
    ],
  }
}

function snapshotIsFinite(snap: BallSnapshot): boolean {
  return (
    Number.isFinite(snap.pos[0]) &&
    Number.isFinite(snap.pos[1]) &&
    Number.isFinite(snap.pos[2]) &&
    Number.isFinite(snap.vel[0]) &&
    Number.isFinite(snap.vel[1]) &&
    Number.isFinite(snap.vel[2]) &&
    Number.isFinite(snap.spin[0]) &&
    Number.isFinite(snap.spin[1]) &&
    Number.isFinite(snap.spin[2])
  )
}

// ── Typed WASM Bridge (`SportsWasm`) ────────────────────────────────────────

export interface SportsWasmExports {
  readonly memory: WebAssembly.Memory
  sports_reset(): void
  sports_set_court(surface: number, groundY: number, netZ: number, enabled: number): void
  sports_spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    wx: number,
    wy: number,
    wz: number,
  ): number
  sports_remove(id: number): number
  sports_count(): number
  sports_racket_swing(
    p0x: number,
    p0y: number,
    p0z: number,
    q0x: number,
    q0y: number,
    q0z: number,
    q0w: number,
    p1x: number,
    p1y: number,
    p1z: number,
    q1x: number,
    q1y: number,
    q1z: number,
    q1w: number,
  ): void
  sports_step(ticks: number, useWorld: number): number
  sports_ball_read(id: number): number
  sports_snapshot_write(id: number): number
  sports_snapshot_room(): number
  sports_rollback(id: number, useWorld: number): number
}

export function hasSportsExports(x: unknown): x is SportsWasmExports {
  const e = x as Partial<SportsWasmExports> | null | undefined
  return (
    !!e &&
    e.memory instanceof WebAssembly.Memory &&
    typeof e.sports_reset === 'function' &&
    typeof e.sports_set_court === 'function' &&
    typeof e.sports_spawn === 'function' &&
    typeof e.sports_remove === 'function' &&
    typeof e.sports_count === 'function' &&
    typeof e.sports_racket_swing === 'function' &&
    typeof e.sports_step === 'function' &&
    typeof e.sports_ball_read === 'function' &&
    typeof e.sports_snapshot_write === 'function' &&
    typeof e.sports_snapshot_room === 'function' &&
    typeof e.sports_rollback === 'function'
  )
}

/**
 * Typed wrapper around `core.wasm`'s `sports_*` exports.
 * Always reads `memory.buffer` AFTER every WASM call so memory growth never detaches views.
 */
export class SportsWasm {
  readonly raw: SportsWasmExports
  private currentTick = 0

  constructor(source: SportsWasmExports | WebAssembly.Instance) {
    const exportsObj = source instanceof WebAssembly.Instance ? source.exports : source
    if (!hasSportsExports(exportsObj)) {
      throw new Error('WASM instance is missing required sports_* exports from core.wasm')
    }
    this.raw = exportsObj
  }

  /** Instantiates a fresh independent `SportsWasm` instance from raw `core.wasm` bytes. */
  static async fromBytes(bytes: BufferSource): Promise<SportsWasm> {
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new SportsWasm(instance)
  }

  /** Wraps an already-instantiated `WebAssembly.Instance`. */
  static fromInstance(instance: WebAssembly.Instance): SportsWasm {
    return new SportsWasm(instance)
  }

  /**
   * Loads a fresh `SportsWasm` instance from `./core.wasm` (works in browsers via `fetch`
   * and in Node via `process.getBuiltinModule('node:fs')` without static Node imports).
   */
  static async load(url: URL | string = new URL('./core.wasm', import.meta.url)): Promise<SportsWasm> {
    const resolved = typeof url === 'string' ? new URL(url, import.meta.url) : url
    const proc = (
      globalThis as unknown as {
        process?: { getBuiltinModule?: (id: string) => Record<string, unknown> }
      }
    ).process
    if (resolved.protocol === 'file:' && typeof proc?.getBuiltinModule === 'function') {
      const fs = proc.getBuiltinModule('node:fs') as { readFileSync(p: URL): Uint8Array }
      const bytes = fs.readFileSync(resolved)
      return SportsWasm.fromBytes(bytes as BufferSource)
    }
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        const { instance } = await WebAssembly.instantiateStreaming(fetch(resolved), {})
        return new SportsWasm(instance)
      } catch {
        // Fallback when MIME type is not application/wasm.
      }
    }
    const bytes = await (await fetch(resolved)).arrayBuffer()
    return SportsWasm.fromBytes(bytes)
  }

  get tick(): number {
    return this.currentTick
  }

  reset(): void {
    this.raw.sports_reset()
    this.currentTick = 0
  }

  setCourt(surface: CourtSurface | number, groundY: number, netZ: number, enabled = true): void {
    const code = typeof surface === 'number' ? surface : COURT_SURFACE_CODE[surface]
    this.raw.sports_set_court(code >>> 0, groundY, netZ, enabled ? 1 : 0)
  }

  spawn(pos: Vec3, vel: Vec3, spin: Vec3 = [0, 0, 0]): number {
    return this.raw.sports_spawn(
      pos[0],
      pos[1],
      pos[2],
      vel[0],
      vel[1],
      vel[2],
      spin[0],
      spin[1],
      spin[2],
    ) >>> 0
  }

  remove(id: number): boolean {
    return this.raw.sports_remove(id >>> 0) !== 0
  }

  count(): number {
    return this.raw.sports_count()
  }

  racketSwing(prev: RacketPose, curr: RacketPose): void {
    this.raw.sports_racket_swing(
      prev.center[0],
      prev.center[1],
      prev.center[2],
      prev.quat[0],
      prev.quat[1],
      prev.quat[2],
      prev.quat[3],
      curr.center[0],
      curr.center[1],
      curr.center[2],
      curr.quat[0],
      curr.quat[1],
      curr.quat[2],
      curr.quat[3],
    )
  }

  step(ticks = 1, useWorld = false): number {
    const nextTick = this.raw.sports_step(ticks >>> 0, useWorld ? 1 : 0) >>> 0
    this.currentTick = nextTick
    return nextTick
  }

  /** Reads `[pos, vel, spin]` for `id`, reading `memory.buffer` strictly AFTER the WASM call. */
  readBall(id: number): BallState | null {
    const ptr = this.raw.sports_ball_read(id >>> 0)
    if (!ptr) return null
    const f = new Float32Array(this.raw.memory.buffer, ptr, 9)
    return {
      pos: [f[0], f[1], f[2]],
      vel: [f[3], f[4], f[5]],
      spin: [f[6], f[7], f[8]],
    }
  }

  /** Encodes ball `id`'s current state into a newly copied 32-byte deterministic wire snapshot. */
  writeSnapshot(id: number): Uint8Array | null {
    const ptr = this.raw.sports_snapshot_write(id >>> 0)
    if (!ptr) return null
    return new Uint8Array(this.raw.memory.buffer, ptr, SNAPSHOT_BYTES).slice()
  }

  /**
   * Copies an incoming 32-byte authoritative snapshot into `sports_snapshot_room()` and calls
   * `sports_rollback`. Returns `0` (matched), `> 0` (replayed ticks), or `-1` (missing/out of window).
   */
  rollback(id: number, snapshotBytes: Uint8Array, useWorld = false): number {
    if (snapshotBytes.byteLength !== SNAPSHOT_BYTES) {
      throw new RangeError(`Expected ${SNAPSHOT_BYTES}-byte snapshot, got ${snapshotBytes.byteLength}`)
    }
    const ptr = this.raw.sports_snapshot_room()
    new Uint8Array(this.raw.memory.buffer, ptr, SNAPSHOT_BYTES).set(snapshotBytes)
    return this.raw.sports_rollback(id >>> 0, useWorld ? 1 : 0)
  }
}

// ── Tennis Audio Hook & Events ──────────────────────────────────────────────

/** Minimal audio interface satisfied directly by `combatSound(...)` from `./sound/combat.ts`. */
export type TennisAudioSink = Pick<CombatSound, 'tennisPop' | 'tennisBounce'> &
  Partial<Pick<CombatSound, 'tennisNet'>>

export type RallyPhase = 'idle' | 'serve' | 'rally' | 'point-over'
export type PointReason = 'double-bounce' | 'out' | 'double-fault' | 'net-fault' | 'own-side' | 'manual'

export interface TennisRacketEvent {
  readonly type: 'racket'
  readonly tick: number
  readonly side: CourtSide
  readonly pos: MutableVec3
  readonly vel: MutableVec3
  readonly spin: MutableVec3
  /** Magnitude of impact velocity change in cells/s. */
  readonly speedCellsPerSec: number
  /** Normalized impact velocity in `[0.08, 1]` passed to `combatSound.tennisPop`. */
  readonly impactVelocity: number
  /** Normalized elliptical radial offset from center (`0` = dead center, `1` = rim). */
  readonly sweetSpotOffset: number
  /** Sweet-spot quality (`1 - sweetSpotOffset`, `1` = dead center, `0` = rim) for `tennisPop`. */
  readonly sweetSpot: number
}

export interface TennisBounceEvent {
  readonly type: 'bounce'
  readonly tick: number
  readonly side: CourtSide
  readonly pos: MutableVec3
  readonly surface: CourtSurface
  /** Incoming downward impact speed in cells/s. */
  readonly speedCellsPerSec: number
  /** Normalized bounce velocity in `[0.08, 1]` passed to `combatSound.tennisBounce`. */
  readonly impactVelocity: number
  readonly inBounds: boolean
  readonly bounceCount: number
}

export interface TennisNetEvent {
  readonly type: 'net'
  readonly tick: number
  readonly part: 'tape' | 'mesh'
  readonly pos: MutableVec3
  readonly speedCellsPerSec: number
  readonly impactVelocity: number
}

export interface TennisFaultEvent {
  readonly type: 'fault'
  readonly tick: number
  readonly server: CourtSide
  readonly faultNumber: 1 | 2
  readonly reason: 'out' | 'net' | 'own-side'
  readonly pos: MutableVec3
}

export interface TennisOutEvent {
  readonly type: 'out'
  readonly tick: number
  readonly side: CourtSide
  readonly pos: MutableVec3
  readonly reason: 'wide' | 'long' | 'short-service'
}

export interface TennisPointEvent {
  readonly type: 'point'
  readonly tick: number
  readonly winner: CourtSide
  readonly reason: PointReason
  readonly gameWon: boolean
  readonly score: TennisScoreSnapshot
}

export type TennisCourtEvent =
  | TennisRacketEvent
  | TennisBounceEvent
  | TennisNetEvent
  | TennisFaultEvent
  | TennisOutEvent
  | TennisPointEvent

export interface TennisScoreSnapshot {
  readonly nearPoints: number
  readonly farPoints: number
  readonly nearGames: number
  readonly farGames: number
  readonly server: CourtSide
  readonly nearDisplay: string
  readonly farDisplay: string
  readonly call: string
  readonly isDeuce: boolean
  readonly advantage: CourtSide | null
  readonly lastGameWinner: CourtSide | null
}

const POINT_LABELS = ['0', '15', '30', '40'] as const

function oppositeSide(side: CourtSide): CourtSide {
  return side === 'near' ? 'far' : 'near'
}

function formatTennisScore(
  nearPoints: number,
  farPoints: number,
  nearGames: number,
  farGames: number,
  server: CourtSide,
  lastGameWinner: CourtSide | null,
): TennisScoreSnapshot {
  let nearDisplay: string
  let farDisplay: string
  let call: string
  let isDeuce = false
  let advantage: CourtSide | null = null

  if (nearPoints >= 3 && farPoints >= 3) {
    if (nearPoints === farPoints) {
      nearDisplay = '40'
      farDisplay = '40'
      call = 'Deuce'
      isDeuce = true
    } else if (nearPoints > farPoints) {
      nearDisplay = 'Ad'
      farDisplay = '40'
      call = 'Ad Near'
      advantage = 'near'
    } else {
      nearDisplay = '40'
      farDisplay = 'Ad'
      call = 'Ad Far'
      advantage = 'far'
    }
  } else {
    nearDisplay = POINT_LABELS[Math.min(3, nearPoints)]
    farDisplay = POINT_LABELS[Math.min(3, farPoints)]
    if (nearPoints === farPoints && nearPoints > 0) {
      call = `${nearDisplay}-All`
    } else {
      call = server === 'near' ? `${nearDisplay}-${farDisplay}` : `${farDisplay}-${nearDisplay}`
    }
  }

  return {
    nearPoints,
    farPoints,
    nearGames,
    farGames,
    server,
    nearDisplay,
    farDisplay,
    call,
    isDeuce,
    advantage,
    lastGameWinner,
  }
}

export interface TennisCourtConfig {
  readonly surface?: CourtSurface
  /** World-space origin `[centerX, groundY, netZ]` in 10 cm cells (default `[0, 0, 0]`). */
  readonly origin?: Vec3
  /** Use doubles sideline width (`109.7` cells) instead of singles (`82.3` cells). Default `false`. */
  readonly doubles?: boolean
  /** Enable swept-sphere collision against `core.wasm`'s 10 cm voxel world. Default `false`. */
  readonly useWorld?: boolean
  /** Optional modal audio controller (`combatSound(...)`) for racket, bounce, and net foley. */
  readonly sound?: TennisAudioSink | null
  /** Optional event listener invoked for every racket, bounce, net, out, fault, and point event. */
  readonly onEvent?: (event: TennisCourtEvent) => void
}

export interface ServeOptions {
  readonly server?: CourtSide
  /** Serve speed in km/h (default `180`). Ignored when explicit `vel` is supplied. */
  readonly speedKmh?: number
  /** Topspin/kick angular velocity in RPM (default `1400`). Ignored when explicit `spin` is supplied. */
  readonly spinRpm?: number
  /** Target lateral coordinate relative to court center in cells (default `0`, down the T). */
  readonly targetX?: number
  /** Target depth past the net inside the service box in cells (default `48`, 4.8 m). */
  readonly targetDepth?: number
  /** Explicit world-space launch position override (cells). */
  readonly pos?: Vec3
  /** Explicit launch velocity override (cells/s). */
  readonly vel?: Vec3
  /** Explicit launch spin override (rad/s). */
  readonly spin?: Vec3
  /** Sweet-spot quality `[0..1]` for the serve contact pop sound (default `0.95`). */
  readonly sweetSpot?: number
}

interface PendingSwing {
  readonly side: CourtSide
  readonly swing: RacketSwing
}

/**
 * Manages an ITF-proportioned in-world tennis court backed by `core.wasm`'s 480 Hz physics:
 * `hard` / `clay` / `grass` presets, player & opponent swept-ellipse rackets, serves,
 * rally scoring (`0/15/30/40/Deuce/Ad/Game`), bounce/net/out detection, and modal foley.
 */
export class TennisCourtController {
  readonly wasm: SportsWasm
  readonly origin: MutableVec3
  readonly doubles: boolean
  readonly useWorld: boolean

  private currentSurface: CourtSurface
  private sound: TennisAudioSink | null
  private onEvent: ((event: TennisCourtEvent) => void) | null

  private activeBallId = 0
  private prevState: BallState | null = null
  private pendingSwings: PendingSwing[] = []
  private currentPhase: RallyPhase = 'idle'
  private lastHitter: CourtSide = 'near'
  private crossedNet = false
  private bouncesOnSide = 0
  private serveFaults = 0

  private nearPoints = 0
  private farPoints = 0
  private nearGames = 0
  private farGames = 0
  private currentServer: CourtSide = 'near'
  private lastGameWinner: CourtSide | null = null

  constructor(wasm: SportsWasm, config: TennisCourtConfig = {}) {
    this.wasm = wasm
    this.origin = config.origin ? [config.origin[0], config.origin[1], config.origin[2]] : [0, 0, 0]
    this.doubles = config.doubles ?? false
    this.useWorld = config.useWorld ?? false
    this.currentSurface = config.surface ?? 'hard'
    this.sound = config.sound ?? null
    this.onEvent = config.onEvent ?? null

    this.wasm.setCourt(this.currentSurface, this.origin[1], this.origin[2], true)
  }

  get surface(): CourtSurface {
    return this.currentSurface
  }

  get surfaceParams(): CourtSurfaceParams {
    return COURT_SURFACE_PARAMS[this.currentSurface]
  }

  get ballId(): number {
    return this.activeBallId
  }

  get phase(): RallyPhase {
    return this.currentPhase
  }

  get tick(): number {
    return this.wasm.tick
  }

  get activeHalfWidth(): number {
    return this.doubles ? ITF_COURT.doublesHalfWidth : ITF_COURT.singlesHalfWidth
  }

  setSurface(surface: CourtSurface): void {
    this.currentSurface = surface
    this.wasm.setCourt(surface, this.origin[1], this.origin[2], true)
  }

  setSound(sound: TennisAudioSink | null): void {
    this.sound = sound
  }

  setEventListener(listener: ((event: TennisCourtEvent) => void) | null): void {
    this.onEvent = listener
  }

  getScore(): TennisScoreSnapshot {
    return formatTennisScore(
      this.nearPoints,
      this.farPoints,
      this.nearGames,
      this.farGames,
      this.currentServer,
      this.lastGameWinner,
    )
  }

  resetMatch(server: CourtSide = 'near'): void {
    this.wasm.reset()
    this.wasm.setCourt(this.currentSurface, this.origin[1], this.origin[2], true)
    this.activeBallId = 0
    this.prevState = null
    this.pendingSwings.length = 0
    this.currentPhase = 'idle'
    this.lastHitter = server
    this.crossedNet = false
    this.bouncesOnSide = 0
    this.serveFaults = 0
    this.nearPoints = 0
    this.farPoints = 0
    this.nearGames = 0
    this.farGames = 0
    this.currentServer = server
    this.lastGameWinner = null
  }

  /** Converts a world-space coordinate into `core.wasm`'s court-centered X frame. */
  private toLocalPos(worldPos: Vec3): MutableVec3 {
    return [worldPos[0] - this.origin[0], worldPos[1], worldPos[2]]
  }

  /** Converts a `core.wasm` court-centered coordinate back to world space. */
  private toWorldPos(localPos: Vec3): MutableVec3 {
    return [localPos[0] + this.origin[0], localPos[1], localPos[2]]
  }

  /** Reads the active tennis ball in world coordinates, or `null` if no ball is live. */
  readBall(): BallState | null {
    if (!this.activeBallId) return null
    const local = this.wasm.readBall(this.activeBallId)
    if (!local) return null
    return {
      pos: this.toWorldPos(local.pos),
      vel: local.vel,
      spin: local.spin,
    }
  }

  /** Spawns a custom ball directly onto the court in world coordinates. */
  spawnBall(pos: Vec3, vel: Vec3, spin: Vec3 = [0, 0, 0], hitter: CourtSide = this.currentServer, phase: RallyPhase = 'rally'): number {
    if (this.activeBallId) {
      this.wasm.remove(this.activeBallId)
    }
    const localPos = this.toLocalPos(pos)
    const id = this.wasm.spawn(localPos, vel, spin)
    this.activeBallId = id
    this.prevState = this.wasm.readBall(id)
    this.pendingSwings.length = 0
    this.lastHitter = hitter
    this.currentPhase = phase
    this.crossedNet = false
    this.bouncesOnSide = 0
    return id
  }

  /**
   * Launches a serve from `near` or `far` baseline across the net into the opponent's service box,
   * automatically computing initial elevation velocity for speeds from 80 to 240+ km/h unless
   * explicit `vel` is provided.
   */
  serve(opts: ServeOptions = {}): number {
    const server = opts.server ?? this.currentServer
    const dirZ = server === 'near' ? 1 : -1
    const speedKmh = opts.speedKmh ?? 180
    const speedCps = kmhToCellsPerSec(speedKmh)

    const defaultPos: MutableVec3 = [
      this.origin[0],
      this.origin[1] + 26.5, // 2.65 m pro serve strike height
      this.origin[2] - dirZ * (ITF_COURT.halfLength - 2.0),
    ]
    const pos: Vec3 = opts.pos ?? defaultPos

    let vel: MutableVec3
    let spin: MutableVec3

    if (opts.vel) {
      vel = [opts.vel[0], opts.vel[1], opts.vel[2]]
      spin = opts.spin ? [opts.spin[0], opts.spin[1], opts.spin[2]] : [0, 0, 0]
    } else {
      const targetX = this.origin[0] + clamp(opts.targetX ?? 0, -ITF_COURT.singlesHalfWidth + 4, ITF_COURT.singlesHalfWidth - 4)
      const targetDepth = clamp(opts.targetDepth ?? 48.0, 20.0, ITF_COURT.serviceLineDist - 4.0)
      const targetZ = this.origin[2] + dirZ * targetDepth
      const dx = targetX - pos[0]
      const dz = targetZ - pos[2]
      const horizDist = Math.hypot(dx, dz)

      // Account for Cross aerodynamic drag (exact 1D drag flight time t(d) = (exp(k*d) - 1) / (k*v0))
      // and Magnus topspin downward dip so serves from 100–240 km/h clear the net and land in the box.
      const spinRad = rpmToRadSec(opts.spinRpm ?? 1400)
      // Moving along +Z, topspin has +X angular velocity so (w x v).y = -wx * vz < 0 (downward).
      // Moving along -Z, topspin has -X angular velocity so (w x v).y = -wx * vz < 0 (downward).
      const defaultSpinX = dirZ * spinRad
      spin = opts.spin ? [opts.spin[0], opts.spin[1], opts.spin[2]] : [defaultSpinX, 0, 0]

      const aeroK = (0.5 * 1.225 * CELL_M * CELL_M * CELL_M * Math.PI * BALL_RADIUS_CELLS * BALL_RADIUS_CELLS) / 0.057
      const spinMag = Math.abs(spin[0])
      const spinRatio = (BALL_RADIUS_CELLS * spinMag) / Math.max(40, speedCps)
      const cd = 0.55 + (0.35 * spinRatio) / (1 + spinRatio)
      const cl = spinRatio > 1e-4 ? 1 / (2.02 + 0.98 / spinRatio) : 0
      const dragK = aeroK * cd
      const flightTime = (dist: number) =>
        dragK > 1e-6 ? (Math.exp(dragK * dist) - 1) / (dragK * Math.max(40, speedCps)) : dist / Math.max(40, speedCps)

      const tLand = flightTime(horizDist)
      const startH = pos[1] - (this.origin[1] + BALL_RADIUS_CELLS)
      // Average Magnus downward acceleration over the serve flight (topspin pulls down when spin[0] * dirZ > 0).
      const topspinSign = spin[0] * dirZ >= 0 ? 1 : -1
      const magnusDropAccel = topspinSign * 0.72 * aeroK * cl * speedCps * speedCps
      const gEff = Math.max(20, GRAVITY_CELLS + magnusDropAccel)
      const vyLand = (0.5 * gEff * tLand * tLand - startH) / tLand

      // Ensure net clearance above center tape (9.14 + 0.25 + 0.335 + 1.3 margin ≈ 11.0 cells).
      const distToNet = Math.abs(this.origin[2] - pos[2])
      const tNet = flightTime(distToNet)
      const minNetY = ITF_COURT.netCenterHeight + ITF_COURT.netTapeRadius + BALL_RADIUS_CELLS + 1.3
      const vyClearNet = (minNetY - startH + 0.5 * gEff * tNet * tNet) / tNet
      const vy = Math.max(vyLand, vyClearNet)

      const horizSpeed = Math.sqrt(Math.max(100, speedCps * speedCps - vy * vy))
      const invDist = horizDist > 1e-4 ? 1 / horizDist : 0
      vel = [dx * invDist * horizSpeed, vy, dz * invDist * horizSpeed]
    }

    const id = this.spawnBall(pos, vel, spin, server, 'serve')

    const sweetSpot = clamp(opts.sweetSpot ?? 0.95, 0, 1)
    const impactVelocity = clamp(vecLen(vel) / 600, 0.08, 1)
    this.sound?.tennisPop({ at: pos, velocity: impactVelocity, sweetSpot })
    this.emit({
      type: 'racket',
      tick: this.wasm.tick,
      side: server,
      pos: [pos[0], pos[1], pos[2]],
      vel: [vel[0], vel[1], vel[2]],
      spin: [spin[0], spin[1], spin[2]],
      speedCellsPerSec: vecLen(vel),
      impactVelocity,
      sweetSpotOffset: 1 - sweetSpot,
      sweetSpot,
    })
    return id
  }

  /**
   * Queues a swept-ellipse racket swing (`prevPose` -> `currPose` in world space) for `side`
   * on the next simulation tick.
   */
  swingRacket(side: CourtSide, prevPose: RacketPose, currPose: RacketPose): void {
    const localPrev: RacketPose = {
      center: this.toLocalPos(prevPose.center),
      quat: quatNormalize(prevPose.quat),
    }
    const localCurr: RacketPose = {
      center: this.toLocalPos(currPose.center),
      quat: quatNormalize(currPose.quat),
    }
    this.wasm.racketSwing(localPrev, localCurr)
    this.pendingSwings.push({ side, swing: { prev: localPrev, curr: localCurr } })
  }

  /**
   * Advances the tennis simulation by `ticks` fixed `1/120 s` ticks (`4` × 480 Hz substeps each),
   * detecting racket strikes, court bounces, net contacts, faults, and scoring transitions.
   */
  step(ticks = 1): TennisCourtEvent[] {
    const events: TennisCourtEvent[] = []
    const count = Math.max(0, ticks | 0)

    for (let i = 0; i < count; i++) {
      const swingsThisTick = i === 0 ? this.pendingSwings.splice(0) : []
      const before = this.activeBallId ? (this.prevState ?? this.wasm.readBall(this.activeBallId)) : null
      const tick = this.wasm.step(1, this.useWorld)

      if (!this.activeBallId || !before) continue
      const after = this.wasm.readBall(this.activeBallId)
      if (!after) {
        this.activeBallId = 0
        this.prevState = null
        continue
      }

      const tickEvents = this.inspectTickTransition(tick, before, after, swingsThisTick)
      for (const ev of tickEvents) {
        events.push(ev)
        this.emit(ev)
      }
      this.prevState = after
    }

    return events
  }

  /** Manually awards a point to `winner`, advancing `0/15/30/40/Deuce/Ad/Game` state. */
  awardPoint(winner: CourtSide, reason: PointReason = 'manual'): TennisPointEvent {
    let gameWon = false
    if (winner === 'near') {
      this.nearPoints += 1
      if (this.nearPoints >= 4 && this.nearPoints - this.farPoints >= 2) {
        this.nearGames += 1
        this.nearPoints = 0
        this.farPoints = 0
        this.lastGameWinner = 'near'
        this.currentServer = oppositeSide(this.currentServer)
        gameWon = true
      }
    } else {
      this.farPoints += 1
      if (this.farPoints >= 4 && this.farPoints - this.nearPoints >= 2) {
        this.farGames += 1
        this.nearPoints = 0
        this.farPoints = 0
        this.lastGameWinner = 'far'
        this.currentServer = oppositeSide(this.currentServer)
        gameWon = true
      }
    }

    this.serveFaults = 0
    this.currentPhase = 'point-over'
    const ev: TennisPointEvent = {
      type: 'point',
      tick: this.wasm.tick,
      winner,
      reason,
      gameWon,
      score: this.getScore(),
    }
    this.emit(ev)
    return ev
  }

  private emit(ev: TennisCourtEvent): void {
    this.onEvent?.(ev)
  }

  private netHeightAt(localX: number): number {
    const frac = Math.min(1, Math.abs(localX) / ITF_COURT.netHalfSpan)
    return this.origin[1] + ITF_COURT.netCenterHeight + (ITF_COURT.netPostHeight - ITF_COURT.netCenterHeight) * frac
  }

  private inspectTickTransition(
    tick: number,
    before: BallState,
    after: BallState,
    swings: readonly PendingSwing[],
  ): TennisCourtEvent[] {
    const out: TennisCourtEvent[] = []
    const groundY = this.origin[1]
    const netZ = this.origin[2]

    // 1. Check whether a queued swept racket struck the ball this tick.
    const dv = vecSub(after.vel, before.vel)
    // Subtract gravity contribution over 1 tick (~0.82 cells/s) for clean impulse detection.
    const dvNonGrav: MutableVec3 = [dv[0], dv[1] + GRAVITY_CELLS * TICK_DT, dv[2]]
    const dvMag = vecLen(dvNonGrav)
    let hitRacket = false

    if (swings.length > 0 && dvMag > 20) {
      let bestSwing: PendingSwing | null = null
      let bestDist = Infinity
      let bestOffset = 0

      for (const entry of swings) {
        const { dist, offset } = measureRacketContact(before.pos, after.pos, entry.swing)
        if (dist < bestDist) {
          bestDist = dist
          bestOffset = offset
          bestSwing = entry
        }
      }

      // Swept racket bounding radius is ~1.6 cells + ball radius 0.335 + 1-tick sweep travel.
      const maxContactDist = RACKET_SPEC.semiA + BALL_RADIUS_CELLS + vecLen(before.vel) * TICK_DT + 1.5
      if (bestSwing && bestDist <= maxContactDist) {
        hitRacket = true
        const sweetSpotOffset = clamp(bestOffset, 0, 1)
        const sweetSpot = 1 - sweetSpotOffset
        const impactVelocity = clamp(dvMag / 600, 0.08, 1)
        const worldPos = this.toWorldPos(after.pos)
        this.sound?.tennisPop({ at: worldPos, velocity: impactVelocity, sweetSpot })
        out.push({
          type: 'racket',
          tick,
          side: bestSwing.side,
          pos: worldPos,
          vel: [after.vel[0], after.vel[1], after.vel[2]],
          spin: [after.spin[0], after.spin[1], after.spin[2]],
          speedCellsPerSec: dvMag,
          impactVelocity,
          sweetSpotOffset,
          sweetSpot,
        })
        this.lastHitter = bestSwing.side
        this.crossedNet = false
        this.bouncesOnSide = 0
        if (this.currentPhase === 'serve' || this.currentPhase === 'idle') {
          this.currentPhase = 'rally'
        }
      }
    }

    // Track net crossing when the ball clears from hitter's half to opponent's half.
    const beforeDz = before.pos[2] - netZ
    const afterDz = after.pos[2] - netZ
    if (
      (this.lastHitter === 'near' && beforeDz <= 0 && afterDz > 0) ||
      (this.lastHitter === 'far' && beforeDz >= 0 && afterDz < 0)
    ) {
      this.crossedNet = true
    }

    // 2. Check net tape / mesh collision.
    if (!hitRacket) {
      const minNetDist = Math.min(Math.abs(beforeDz), Math.abs(afterDz))
      const crossedOrNearNet = beforeDz * afterDz <= 0 || minNetDist <= Math.abs(before.vel[2]) * TICK_DT + 1.2
      const withinNetSpan =
        Math.abs(after.pos[0]) <= ITF_COURT.netHalfSpan + BALL_RADIUS_CELLS + 1.0 &&
        Math.min(before.pos[1], after.pos[1]) <= groundY + ITF_COURT.netPostHeight + 1.5
      const zVelDelta = Math.abs(after.vel[2] - before.vel[2])
      const zReversed = before.vel[2] * after.vel[2] < 0
      if (crossedOrNearNet && withinNetSpan && (zReversed || zVelDelta > 35)) {
        const netTop = this.netHeightAt(after.pos[0])
        const part: 'tape' | 'mesh' = after.pos[1] >= netTop - 0.85 ? 'tape' : 'mesh'
        const speed = Math.abs(before.vel[2])
        const impactVelocity = clamp(speed / 400, 0.08, 1)
        const worldPos = this.toWorldPos(after.pos)
        this.sound?.tennisNet?.({ at: worldPos, velocity: impactVelocity })
        out.push({
          type: 'net',
          tick,
          part,
          pos: worldPos,
          speedCellsPerSec: speed,
          impactVelocity,
        })
      }
    }

    // 3. Check court ground bounce (downward vy flipped to upward near groundY + radius).
    const nearGround =
      Math.min(before.pos[1], after.pos[1]) <=
      groundY + BALL_RADIUS_CELLS + Math.abs(before.vel[1]) * TICK_DT + 0.6
    if (!hitRacket && nearGround && before.vel[1] < -0.5 && after.vel[1] > 0.1) {
      const targetY = groundY + BALL_RADIUS_CELLS
      const dy = before.pos[1] - targetY
      const frac = before.vel[1] < -1e-4 ? clamp(dy / (-before.vel[1] * TICK_DT), 0, 1) : 0.5
      const bounceLocal: MutableVec3 = [
        before.pos[0] + (after.pos[0] - before.pos[0]) * frac,
        targetY,
        before.pos[2] + (after.pos[2] - before.pos[2]) * frac,
      ]
      const bounceWorld = this.toWorldPos(bounceLocal)
      const bounceSide: CourtSide = bounceLocal[2] < netZ ? 'near' : 'far'
      const speedIn = Math.abs(before.vel[1])
      const impactVelocity = clamp(speedIn / 180, 0.08, 1)

      const distFromNet = Math.abs(bounceLocal[2] - netZ)
      const absX = Math.abs(bounceLocal[0])
      const onOpponentSide = bounceSide !== this.lastHitter

      let inBounds = false
      let outReason: 'wide' | 'long' | 'short-service' = 'long'
      if (this.currentPhase === 'serve') {
        const withinW = absX <= ITF_COURT.singlesHalfWidth + BALL_RADIUS_CELLS
        const withinD = distFromNet <= ITF_COURT.serviceLineDist + BALL_RADIUS_CELLS
        inBounds = onOpponentSide && withinW && withinD
        if (!withinW) outReason = 'wide'
        else if (!withinD) outReason = 'long'
        else outReason = 'short-service'
      } else {
        const withinW = absX <= this.activeHalfWidth + BALL_RADIUS_CELLS
        const withinD = distFromNet <= ITF_COURT.halfLength + BALL_RADIUS_CELLS
        inBounds = onOpponentSide && withinW && withinD
        if (!withinW) outReason = 'wide'
      }

      if (onOpponentSide) {
        this.bouncesOnSide += 1
      }
      const bounceCount = onOpponentSide ? this.bouncesOnSide : 1

      this.sound?.tennisBounce({
        at: bounceWorld,
        surface: this.currentSurface,
        velocity: impactVelocity,
      })
      out.push({
        type: 'bounce',
        tick,
        side: bounceSide,
        pos: bounceWorld,
        surface: this.currentSurface,
        speedCellsPerSec: speedIn,
        impactVelocity,
        inBounds,
        bounceCount,
      })

      // Apply tennis scoring rules if point is still live.
      if (this.currentPhase === 'serve' || this.currentPhase === 'rally') {
        if (!onOpponentSide && !this.crossedNet) {
          if (this.currentPhase === 'serve') {
            this.handleServeFault(tick, 'own-side', bounceWorld, out)
          } else {
            out.push(this.recordPointInternal(tick, oppositeSide(this.lastHitter), 'own-side'))
          }
        } else if (bounceCount === 1 && !inBounds) {
          out.push({ type: 'out', tick, side: bounceSide, pos: bounceWorld, reason: outReason })
          if (this.currentPhase === 'serve') {
            this.handleServeFault(tick, 'out', bounceWorld, out)
          } else {
            out.push(this.recordPointInternal(tick, oppositeSide(this.lastHitter), 'out'))
          }
        } else if (bounceCount === 1 && inBounds) {
          if (this.currentPhase === 'serve') {
            this.currentPhase = 'rally'
            this.serveFaults = 0
          }
        } else if (bounceCount >= 2) {
          out.push(this.recordPointInternal(tick, this.lastHitter, 'double-bounce'))
        }
      }
    }

    // 4. Out-of-bounds flight escape check.
    //    - Before the first bounce (`bouncesOnSide === 0`), sailing past the court fence is Out.
    //    - After a legal in-bounds first bounce (`bouncesOnSide >= 1`), letting the ball fly past
    //      the back fence unreturned is a winner (ace / unreturned) for `lastHitter`.
    if (this.currentPhase === 'serve' || this.currentPhase === 'rally') {
      const farLong = Math.abs(after.pos[2] - netZ) > ITF_COURT.halfLength + 60
      const farWide = Math.abs(after.pos[0]) > ITF_COURT.doublesHalfWidth + 60
      if (this.bouncesOnSide === 0 && (farLong || farWide)) {
        const worldPos = this.toWorldPos(after.pos)
        const side: CourtSide = after.pos[2] < netZ ? 'near' : 'far'
        out.push({
          type: 'out',
          tick,
          side,
          pos: worldPos,
          reason: farWide ? 'wide' : 'long',
        })
        if (this.currentPhase === 'serve') {
          this.handleServeFault(tick, 'out', worldPos, out)
        } else {
          out.push(this.recordPointInternal(tick, oppositeSide(this.lastHitter), 'out'))
        }
      }
    }

    return out
  }

  private handleServeFault(
    tick: number,
    reason: 'out' | 'net' | 'own-side',
    pos: MutableVec3,
    out: TennisCourtEvent[],
  ): void {
    this.serveFaults += 1
    const faultNumber: 1 | 2 = this.serveFaults >= 2 ? 2 : 1
    out.push({
      type: 'fault',
      tick,
      server: this.currentServer,
      faultNumber,
      reason,
      pos,
    })
    if (faultNumber === 2) {
      out.push(this.recordPointInternal(tick, oppositeSide(this.currentServer), 'double-fault'))
    } else {
      this.currentPhase = 'idle'
    }
  }

  private recordPointInternal(tick: number, winner: CourtSide, reason: PointReason): TennisPointEvent {
    let gameWon = false
    if (winner === 'near') {
      this.nearPoints += 1
      if (this.nearPoints >= 4 && this.nearPoints - this.farPoints >= 2) {
        this.nearGames += 1
        this.nearPoints = 0
        this.farPoints = 0
        this.lastGameWinner = 'near'
        this.currentServer = oppositeSide(this.currentServer)
        gameWon = true
      }
    } else {
      this.farPoints += 1
      if (this.farPoints >= 4 && this.farPoints - this.nearPoints >= 2) {
        this.farGames += 1
        this.nearPoints = 0
        this.farPoints = 0
        this.lastGameWinner = 'far'
        this.currentServer = oppositeSide(this.currentServer)
        gameWon = true
      }
    }
    this.serveFaults = 0
    this.currentPhase = 'point-over'
    return {
      type: 'point',
      tick,
      winner,
      reason,
      gameWon,
      score: this.getScore(),
    }
  }
}

/**
 * Samples the swept racket motion across the 4 substeps of a tick to estimate closest ball-to-racket
 * distance and normalized elliptical sweet-spot offset (`0` = center, `1` = rim).
 */
function measureRacketContact(
  ballBefore: Vec3,
  ballAfter: Vec3,
  swing: RacketSwing,
): { dist: number; offset: number } {
  let bestDist = Infinity
  let bestOffset = 0
  for (let s = 0; s <= SUBSTEPS; s++) {
    const u = s / SUBSTEPS
    const bx = ballBefore[0] + (ballAfter[0] - ballBefore[0]) * u
    const by = ballBefore[1] + (ballAfter[1] - ballBefore[1]) * u
    const bz = ballBefore[2] + (ballAfter[2] - ballBefore[2]) * u
    const cx = swing.prev.center[0] + (swing.curr.center[0] - swing.prev.center[0]) * u
    const cy = swing.prev.center[1] + (swing.curr.center[1] - swing.prev.center[1]) * u
    const cz = swing.prev.center[2] + (swing.curr.center[2] - swing.prev.center[2]) * u
    const q = quatNlerp(swing.prev.quat, swing.curr.quat, u)
    const local = quatInvRotate(q, [bx - cx, by - cy, bz - cz])
    const dist = Math.hypot(local[0], local[1], local[2])
    if (dist < bestDist) {
      bestDist = dist
      bestOffset = Math.min(1, Math.hypot(local[0] / RACKET_SPEC.semiA, local[1] / RACKET_SPEC.semiB))
    }
  }
  return { dist: bestDist, offset: bestOffset }
}

// ── Deterministic 120 Hz Client Prediction & Rollback Reconciliation ────────

export interface StampedRacketInput {
  readonly tick: number
  readonly swing: RacketSwing
}

export interface RollbackClientConfig {
  readonly surface?: CourtSurface
  readonly groundY?: number
  readonly netZ?: number
  readonly courtEnabled?: boolean
  readonly useWorld?: boolean
  /** Maximum local ticks of input history retained for extended >15-tick RTT fallbacks (default `64`). */
  readonly maxHistoryTicks?: number
}

export type RollbackStatus = 'matched' | 'replayed' | 'out-of-window' | 'invalid-snapshot'

export interface RollbackReconcileResult {
  readonly status: RollbackStatus
  readonly serverTick: number
  readonly clientTick: number
  readonly replayedTicks: number
  /** Used the native in-WASM `sports_rollback` path (`true`) vs extended history rewind (`false`). */
  readonly usedWasmRollback: boolean
  readonly posCorrection: number
  readonly state: BallState | null
}

export interface RollbackStats {
  readonly reconciliations: number
  readonly matches: number
  readonly replays: number
  readonly outOfWindow: number
  readonly lastReplayedTicks: number
  readonly lastPosCorrection: number
  readonly maxPosCorrection: number
}

/**
 * Deterministic 120 Hz client-prediction & rollback bridge running on its own `core.wasm` instance.
 *
 * - Steps local physics at fixed `1/120 s` ticks (`4 × 480 Hz` substeps per tick).
 * - Stamps outgoing racket swings with the exact prediction `tick` and buffers them locally.
 * - Reconciles late 32-byte authoritative server snapshots (`4–16+` frames / `33–133+` ms RTT)
 *   via `core.wasm`'s `sports_rollback` (for `0..15` tick RTT) with seamless deterministic replay
 *   fallback for `16..maxHistoryTicks` RTT spikes.
 */
export class DeterministicRollbackClient {
  readonly wasm: SportsWasm
  readonly maxHistoryTicks: number

  private surface: CourtSurface
  private groundY: number
  private netZ: number
  private courtEnabled: boolean
  private useWorld: boolean

  private activeBallId = 0
  private logicalTick = 0
  private tickOffset = 0
  private accumulator = 0
  private readonly inputHistory = new Map<number, RacketSwing>()

  private reconciliations = 0
  private matches = 0
  private replays = 0
  private outOfWindow = 0
  private lastReplayedTicks = 0
  private lastPosCorrection = 0
  private maxPosCorrection = 0

  constructor(wasm: SportsWasm, config: RollbackClientConfig = {}) {
    this.wasm = wasm
    this.surface = config.surface ?? 'hard'
    this.groundY = config.groundY ?? 0
    this.netZ = config.netZ ?? 0
    this.courtEnabled = config.courtEnabled ?? true
    this.useWorld = config.useWorld ?? false
    this.maxHistoryTicks = Math.max(WASM_ROLLBACK_SLOTS, config.maxHistoryTicks ?? 64)

    this.wasm.setCourt(this.surface, this.groundY, this.netZ, this.courtEnabled)
  }

  get tick(): number {
    return this.logicalTick
  }

  get ballId(): number {
    return this.activeBallId
  }

  configureCourt(surface: CourtSurface, groundY: number, netZ: number, enabled = true): void {
    this.surface = surface
    this.groundY = groundY
    this.netZ = netZ
    this.courtEnabled = enabled
    this.wasm.setCourt(surface, groundY, netZ, enabled)
  }

  /**
   * Initializes/resets the local prediction world and spawns the tracked tennis ball at `startTick`.
   */
  spawnBall(pos: Vec3, vel: Vec3, spin: Vec3 = [0, 0, 0], startTick = 0): number {
    this.wasm.reset()
    this.wasm.setCourt(this.surface, this.groundY, this.netZ, this.courtEnabled)
    this.activeBallId = this.wasm.spawn(pos, vel, spin)
    this.logicalTick = startTick >>> 0
    this.tickOffset = this.logicalTick
    this.accumulator = 0
    this.inputHistory.clear()
    return this.activeBallId
  }

  /**
   * Steps local prediction forward by exactly one `1/120 s` tick (`4 × 480 Hz` substeps).
   * When `localSwing` is provided, stamps it with the resulting `tick`, records it in the
   * local rollback buffer, and returns it as `outgoingInput` for transmission to the server.
   */
  predictTick(localSwing?: RacketSwing | null): {
    readonly tick: number
    readonly state: BallState | null
    readonly outgoingInput: StampedRacketInput | null
  } {
    const nextTick = (this.logicalTick + 1) >>> 0
    let outgoingInput: StampedRacketInput | null = null

    if (localSwing) {
      const normalized: RacketSwing = {
        prev: {
          center: [localSwing.prev.center[0], localSwing.prev.center[1], localSwing.prev.center[2]],
          quat: quatNormalize(localSwing.prev.quat),
        },
        curr: {
          center: [localSwing.curr.center[0], localSwing.curr.center[1], localSwing.curr.center[2]],
          quat: quatNormalize(localSwing.curr.quat),
        },
      }
      this.wasm.racketSwing(normalized.prev, normalized.curr)
      this.inputHistory.set(nextTick, normalized)
      outgoingInput = { tick: nextTick, swing: normalized }
    }

    const wasmTick = this.wasm.step(1, this.useWorld)
    this.logicalTick = (this.tickOffset + wasmTick) >>> 0
    this.pruneHistory()

    return {
      tick: this.logicalTick,
      state: this.readBall(),
      outgoingInput,
    }
  }

  /**
   * Fixed-timestep `120 Hz` accumulator for real-time browser frame loops.
   * Applies `pendingSwing` on the first stepped tick (if any) and returns all stamped outgoing inputs.
   */
  advanceTime(
    dtSeconds: number,
    pendingSwing?: RacketSwing | null,
  ): {
    readonly ticksStepped: number
    readonly tick: number
    readonly state: BallState | null
    readonly outgoingInputs: StampedRacketInput[]
  } {
    const dt = clamp(dtSeconds, 0, 0.25)
    this.accumulator += dt
    const outgoingInputs: StampedRacketInput[] = []
    let ticksStepped = 0
    let swingToSend = pendingSwing ?? null

    while (this.accumulator + 1e-9 >= TICK_DT) {
      this.accumulator -= TICK_DT
      const stepRes = this.predictTick(swingToSend)
      swingToSend = null
      ticksStepped += 1
      if (stepRes.outgoingInput) outgoingInputs.push(stepRes.outgoingInput)
    }

    return {
      ticksStepped,
      tick: this.logicalTick,
      state: this.readBall(),
      outgoingInputs,
    }
  }

  /** Reads current locally predicted ball state. */
  readBall(): BallState | null {
    if (!this.activeBallId) return null
    return this.wasm.readBall(this.activeBallId)
  }

  /** Encodes the current ball state into a 32-byte `sports.rs` wire snapshot with logical `tick`. */
  encodeSnapshot(): Uint8Array | null {
    if (!this.activeBallId) return null
    const bytes = this.wasm.writeSnapshot(this.activeBallId)
    if (!bytes) return null
    if (this.tickOffset !== 0) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, SNAPSHOT_BYTES)
      dv.setUint32(0, this.logicalTick >>> 0, true)
    }
    return bytes
  }

  /**
   * Reconciles a late 32-byte authoritative server snapshot against local prediction history.
   * Uses `core.wasm`'s native `sports_rollback` for `0..15` tick RTTs (0–125 ms) and falls back
   * seamlessly to deterministic re-simulation from `inputHistory` for `16..maxHistoryTicks` RTTs.
   */
  reconcile(serverSnapshotBytes: Uint8Array): RollbackReconcileResult {
    this.reconciliations += 1
    if (!this.activeBallId || serverSnapshotBytes.byteLength !== SNAPSHOT_BYTES) {
      return {
        status: 'invalid-snapshot',
        serverTick: 0,
        clientTick: this.logicalTick,
        replayedTicks: 0,
        usedWasmRollback: false,
        posCorrection: 0,
        state: this.readBall(),
      }
    }

    const serverSnap = decodeBallSnapshot(serverSnapshotBytes)
    if (!snapshotIsFinite(serverSnap)) {
      return {
        status: 'invalid-snapshot',
        serverTick: serverSnap.tick,
        clientTick: this.logicalTick,
        replayedTicks: 0,
        usedWasmRollback: false,
        posCorrection: 0,
        state: this.readBall(),
      }
    }

    const serverTick = serverSnap.tick
    if (serverTick > this.logicalTick) {
      this.outOfWindow += 1
      return {
        status: 'out-of-window',
        serverTick,
        clientTick: this.logicalTick,
        replayedTicks: 0,
        usedWasmRollback: false,
        posCorrection: 0,
        state: this.readBall(),
      }
    }

    const span = this.logicalTick - serverTick
    const before = this.readBall()

    // Fast path: inside `core.wasm`'s native 16-slot RollbackRing (`0 <= span < 16`, up to 125 ms RTT).
    if (span < WASM_ROLLBACK_SLOTS && serverTick >= this.tickOffset) {
      let wire = serverSnapshotBytes
      if (this.tickOffset !== 0) {
        wire = serverSnapshotBytes.slice()
        const dv = new DataView(wire.buffer, wire.byteOffset, SNAPSHOT_BYTES)
        dv.setUint32(0, (serverTick - this.tickOffset) >>> 0, true)
      }
      const rc = this.wasm.rollback(this.activeBallId, wire, this.useWorld)
      if (rc >= 0) {
        const after = this.readBall()
        const posCorrection = before && after ? vecLen(vecSub(after.pos, before.pos)) : 0
        this.lastReplayedTicks = rc
        this.lastPosCorrection = posCorrection
        if (posCorrection > this.maxPosCorrection) this.maxPosCorrection = posCorrection
        if (rc === 0) this.matches += 1
        else this.replays += 1
        return {
          status: rc === 0 ? 'matched' : 'replayed',
          serverTick,
          clientTick: this.logicalTick,
          replayedTicks: rc,
          usedWasmRollback: true,
          posCorrection,
          state: after,
        }
      }
    }

    // Extended RTT fallback (`16 <= span <= maxHistoryTicks`, e.g. 133 ms+ RTT spikes):
    // rewind WASM cleanly to `serverSnap` and deterministically replay buffered local inputs.
    if (span <= this.maxHistoryTicks) {
      const targetTick = this.logicalTick
      this.wasm.reset()
      this.wasm.setCourt(this.surface, this.groundY, this.netZ, this.courtEnabled)
      this.activeBallId = this.wasm.spawn(serverSnap.pos, serverSnap.vel, serverSnap.spin)
      this.tickOffset = serverTick

      for (let t = serverTick + 1; t <= targetTick; t++) {
        const swing = this.inputHistory.get(t)
        if (swing) {
          this.wasm.racketSwing(swing.prev, swing.curr)
        }
        this.wasm.step(1, this.useWorld)
      }
      this.logicalTick = targetTick
      const after = this.readBall()
      const posCorrection = before && after ? vecLen(vecSub(after.pos, before.pos)) : 0
      this.replays += 1
      this.lastReplayedTicks = span
      this.lastPosCorrection = posCorrection
      if (posCorrection > this.maxPosCorrection) this.maxPosCorrection = posCorrection
      return {
        status: 'replayed',
        serverTick,
        clientTick: this.logicalTick,
        replayedTicks: span,
        usedWasmRollback: false,
        posCorrection,
        state: after,
      }
    }

    this.outOfWindow += 1
    return {
      status: 'out-of-window',
      serverTick,
      clientTick: this.logicalTick,
      replayedTicks: 0,
      usedWasmRollback: false,
      posCorrection: 0,
      state: before,
    }
  }

  getStats(): RollbackStats {
    return {
      reconciliations: this.reconciliations,
      matches: this.matches,
      replays: this.replays,
      outOfWindow: this.outOfWindow,
      lastReplayedTicks: this.lastReplayedTicks,
      lastPosCorrection: this.lastPosCorrection,
      maxPosCorrection: this.maxPosCorrection,
    }
  }

  private pruneHistory(): void {
    const oldestKeep = this.logicalTick - this.maxHistoryTicks
    if (oldestKeep <= 0) return
    for (const k of this.inputHistory.keys()) {
      if (k < oldestKeep) this.inputHistory.delete(k)
    }
  }
}
