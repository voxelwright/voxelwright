// Live combat and sports tools for San Francisco (#166): a lightsaber driven through `core.wasm`'s
// melee arena (`melee_*`, engine/core/src/melee_ffi.rs), a rifle, a rocket launcher, a thermal
// laser, a grapple / tow cable and a tennis court, each a small state machine, drawn together in one
// depth-tested pass of glowing capsules in linear HDR.
//
// Nothing here reaches into main.ts: the world is met through `CombatToolCallbacks`, so wiring it is
// creating the tools, forwarding input, calling `update` each frame and `draw` after the scene.
// The state machines run without a device (Node tests pass `null`), and an idle `draw` begins no pass.
import { FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'
import type { CombatSound } from './sound/combat.ts'
import {
  ITF_COURT,
  TennisCourtController,
  racketPoseFromNormal,
  type CourtSurface,
  type SportsWasm,
  type TennisCourtEvent,
  type TennisScoreSnapshot,
  type RallyPhase,
} from './sports-court.ts'

export type Vec3 = readonly [number, number, number]
type V3 = [number, number, number]
type Q = [number, number, number, number]

export type ToolName = 'saber' | 'rifle' | 'rocket' | 'laser' | 'grapple' | 'tennis'
export const TOOLS: readonly ToolName[] = ['saber', 'rifle', 'rocket', 'laser', 'grapple', 'tennis']

// ── Melee arena bridge (core.wasm `melee_*`) ────────────────────────────────

export const MELEE_KIND = { fist: 0, sledgehammer: 1, knife: 2, longsword: 3, battleAxe: 4, shield: 5, lightsaber: 6 } as const
export type MeleeKindName = keyof typeof MELEE_KIND
export const MELEE_GROUND = { none: 0, plane: 1, world: 2 } as const
export type MeleeGround = keyof typeof MELEE_GROUND

export interface MeleeExports {
  readonly memory: WebAssembly.Memory
  melee_reset(): void
  melee_set_ground(mode: number, y: number): number
  melee_spawn(kind: number, px: number, py: number, pz: number, rx: number, ry: number, rz: number, rw: number): number
  melee_remove(id: number): number
  melee_count(): number
  melee_ignite(id: number, on: number): number
  melee_set_color(id: number, r: number, g: number, b: number): number
  melee_set_hand(id: number, tx: number, ty: number, tz: number, qx: number, qy: number, qz: number, qw: number, dt: number): number
  melee_step(dt: number): number
  melee_drive_hand(id: number, tx: number, ty: number, tz: number, qx: number, qy: number, qz: number, qw: number, dt: number): number
  melee_events_ptr(): number
  melee_events_len(): number
  melee_glow_ptr(): number
  melee_glow_count(): number
  melee_pose_room(): number
  melee_pose(id: number, outPtr: number): number
  melee_blade(id: number): number
}

const MELEE_NAMES: readonly (keyof MeleeExports)[] = [
  'melee_reset', 'melee_set_ground', 'melee_spawn', 'melee_remove', 'melee_count', 'melee_ignite', 'melee_set_color',
  'melee_set_hand', 'melee_step', 'melee_drive_hand', 'melee_events_ptr', 'melee_events_len', 'melee_glow_ptr',
  'melee_glow_count', 'melee_pose_room', 'melee_pose', 'melee_blade',
]

export function hasMeleeExports(x: unknown): x is MeleeExports {
  const e = x as Record<string, unknown> | null | undefined
  return !!e && e.memory instanceof WebAssembly.Memory && MELEE_NAMES.every((n) => typeof e[n] === 'function')
}

export type MeleeEvent =
  | { type: 'blunt'; weaponId: number; targetId: number | null; pos: V3; normal: V3; impulse: number; shock: number }
  | { type: 'crush'; cell: V3; push: V3 }
  | { type: 'parry'; pos: V3; normal: V3; impulse: number; sparks: number }
  | { type: 'slice'; targetId: number | null; point: V3; normal: V3; energy: number; plasma: boolean }
  | { type: 'stab-in'; weaponId: number; targetId: number | null; entry: V3; axis: V3; depth: number }
  | { type: 'stab-out'; weaponId: number; targetId: number | null }
  | { type: 'kerf'; point: V3; normal: V3; energy: number; cells: Int32Array; heated: Int32Array }
  | { type: 'ignite'; cell: V3 }
  | { type: 'plasma-clash'; pos: V3; intensity: number; pitchShift: number }

export interface MeleePose { pos: V3; rot: Q; extension: number; tipSpeed: number }
export interface MeleeBlade { emitter: V3; tip: V3; radius: number; color: V3; lit: boolean }

/** Decodes the arena's packed records (layout in melee_ffi.rs). Unknown types are skipped by their length. */
export function decodeMeleeEvents(words: Uint32Array): MeleeEvent[] {
  const f = new Float32Array(words.buffer, words.byteOffset, words.length)
  const i32 = new Int32Array(words.buffer, words.byteOffset, words.length)
  const v = (at: number): V3 => [f[at], f[at + 1], f[at + 2]]
  const c = (at: number): V3 => [i32[at], i32[at + 1], i32[at + 2]]
  const id = (w: number) => (w === 0xffffffff ? null : w)
  const out: MeleeEvent[] = []
  let i = 0
  while (i < words.length) {
    const ty = words[i] & 0xff, n = words[i] >>> 8, p = i + 1
    if (p + n > words.length) break
    switch (ty) {
      case 1: out.push({ type: 'blunt', weaponId: words[p], targetId: id(words[p + 1]), pos: v(p + 2), normal: v(p + 5), impulse: f[p + 8], shock: f[p + 9] }); break
      case 2: out.push({ type: 'crush', cell: c(p), push: v(p + 3) }); break
      case 3: out.push({ type: 'parry', pos: v(p), normal: v(p + 3), impulse: f[p + 6], sparks: words[p + 7] }); break
      case 4: out.push({ type: 'slice', targetId: id(words[p]), point: v(p + 1), normal: v(p + 4), energy: f[p + 7], plasma: words[p + 8] !== 0 }); break
      case 5: out.push({ type: 'stab-in', weaponId: words[p], targetId: id(words[p + 1]), entry: v(p + 2), axis: v(p + 5), depth: f[p + 8] }); break
      case 6: out.push({ type: 'stab-out', weaponId: words[p], targetId: id(words[p + 1]) }); break
      case 7: {
        const cells = words[p + 7], heated = words[p + 8], at = p + 9
        out.push({
          type: 'kerf', point: v(p), normal: v(p + 3), energy: f[p + 6],
          cells: i32.slice(at, at + cells * 3), heated: i32.slice(at + cells * 3, at + (cells + heated) * 3),
        })
        break
      }
      case 8: out.push({ type: 'ignite', cell: c(p) }); break
      case 9: out.push({ type: 'plasma-clash', pos: v(p), intensity: f[p + 3], pitchShift: f[p + 4] }); break
    }
    i = p + n
  }
  return out
}

/** Typed wrapper over the arena: reads `memory.buffer` only after each call and copies out what it reads. */
export class MeleeWasm {
  readonly raw: MeleeExports
  constructor(source: MeleeExports | WebAssembly.Instance) {
    const e = source instanceof WebAssembly.Instance ? source.exports : source
    if (!hasMeleeExports(e)) throw new Error('core.wasm is missing the melee_* exports (engine/core/src/melee_ffi.rs)')
    this.raw = e
  }
  reset(): void { this.raw.melee_reset() }
  setGround(mode: MeleeGround, y = 0): void { this.raw.melee_set_ground(MELEE_GROUND[mode], Math.floor(y)) }
  spawn(kind: MeleeKindName, pos: Vec3, rot: readonly number[] = [0, 0, 0, 1]): number {
    return this.raw.melee_spawn(MELEE_KIND[kind], pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3]) >>> 0
  }
  remove(id: number): boolean { return this.raw.melee_remove(id) === 1 }
  count(): number { return this.raw.melee_count() }
  /** Returns the blade's extension now (0..1), or -1 for no such weapon. */
  ignite(id: number, on: boolean): number { return this.raw.melee_ignite(id, on ? 1 : 0) }
  setColor(id: number, rgb: Vec3): boolean { return this.raw.melee_set_color(id, rgb[0], rgb[1], rgb[2]) === 1 }
  setHand(id: number, pos: Vec3, rot: readonly number[], dt: number): boolean {
    return this.raw.melee_set_hand(id, pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3], dt) === 1
  }
  step(dt: number): MeleeEvent[] {
    const n = this.raw.melee_step(dt)
    return n > 0 ? this.events() : []
  }
  /** One weapon's frame: hand moved and the arena stepped. Null if the weapon is gone. */
  driveHand(id: number, pos: Vec3, rot: readonly number[], dt: number): MeleeEvent[] | null {
    const n = this.raw.melee_drive_hand(id, pos[0], pos[1], pos[2], rot[0], rot[1], rot[2], rot[3], dt)
    if (n < 0) return null
    return n > 0 ? this.events() : []
  }
  private events(): MeleeEvent[] {
    const len = this.raw.melee_events_len(), ptr = this.raw.melee_events_ptr() >>> 0
    return decodeMeleeEvents(new Uint32Array(this.raw.memory.buffer, ptr, len).slice())
  }
  /** Glowing kerf cells after the last step: `(x, y, z, heat)` each, a copy. */
  glow(): Float32Array {
    const n = this.raw.melee_glow_count(), ptr = this.raw.melee_glow_ptr() >>> 0
    return n > 0 ? new Float32Array(this.raw.memory.buffer, ptr, n * 4).slice() : new Float32Array(0)
  }
  pose(id: number): MeleePose | null {
    // A null pointer asks the arena to keep the pose in its own room (`melee_pose_room`).
    if (this.raw.melee_pose(id, 0) !== 1) return null
    const room = new Float32Array(this.raw.memory.buffer, this.raw.melee_pose_room() >>> 0, 9)
    return { pos: [room[0], room[1], room[2]], rot: [room[3], room[4], room[5], room[6]], extension: room[7], tipSpeed: room[8] }
  }
  blade(id: number): MeleeBlade | null {
    const ptr = this.raw.melee_blade(id) >>> 0
    if (!ptr) return null
    const b = new Float32Array(this.raw.memory.buffer, ptr, 11)
    return { emitter: [b[0], b[1], b[2]], tip: [b[3], b[4], b[5]], radius: b[6], color: [b[7], b[8], b[9]], lit: b[10] > 0.5 }
  }
}

// ── What the tools ask of the world ─────────────────────────────────────────

export interface RayHit {
  /** Where the ray met something, in cells. */
  pos: Vec3
  /** The surface's unit normal there. */
  normal: Vec3
  dist: number
  /** A body's id if it met a loose body (`0` or absent: the world's own cells). */
  bodyId?: number
  /** Glass or a mirror: a laser reflects off it. */
  mirror?: boolean
  /** Steel, stone or glass: a grazing bullet ricochets off it. */
  hard?: boolean
}

export interface BeamSegment { a: Vec3; b: Vec3; reflected?: boolean }

/** One end of a cable: a point in the world, on a loose body (`bodyId`) or on the static world (`0`). */
export interface CableAnchor { pos: Vec3; bodyId: number }

export interface CombatToolCallbacks {
  /** The core instance that hosts the melee arena (the page's or a worker's). Without it the saber is drawn but cuts nothing. */
  melee?: MeleeWasm | MeleeExports | WebAssembly.Instance | null
  /** Where the arena's blades meet the world (default `world`: the solver's cells in that instance). `plane` asks `groundAt`. */
  meleeGround?: MeleeGround
  /** The sports core for the tennis court (`SportsWasm` over core.wasm). */
  sports?: SportsWasm | null
  combatAudio?: Partial<CombatSound> | null
  emitSparks?(at: Vec3, dir: Vec3, count: number, color: Vec3): void
  /** First thing along a ray within `maxDist` cells. Without it shots fly to their range and lasers go straight. */
  raycast?(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null
  /** Height of the ground's top (cells) at a column, for `meleeGround: 'plane'` and the tennis court. */
  groundAt?(x: number, z: number): number
  /** Cells a blade carved out of the world (x, y, z triplets): the page edits them out. */
  carveCells?(cells: Int32Array): void
  /** The swept blade this frame, for loose bodies it passes through (core `bodies_carve_capsule`). */
  carveCapsule?(a: Vec3, b: Vec3, radius: number): void
  igniteCell?(cell: Vec3): void
  /** core `ballistics_fire`: caliber 0 9 mm, 1 5.56 mm, 2 .50, 3 shrapnel, 4 rocket. Returns its projectile id. */
  ballisticsFire?(caliber: number, origin: Vec3, dir: Vec3): number
  /** core `shockwave_blast`. */
  shockwaveBlast?(at: Vec3, radius: number, pressure: number, shrapnel: number): number
  /** core `beams_fire`: its segment count, or the segments themselves when the host can read them. */
  beamsFire?(origin: Vec3, dir: Vec3, power: number, dt: number): number | readonly BeamSegment[] | void
  /** core `joints_add_rope`. Returns the joint id, `0` if refused. */
  jointsAddRope?(a: CableAnchor, b: CableAnchor, maxLen: number, breakForce: number): number
  /** core `joints_set_winch` (cells/s, positive reels in). */
  jointsSetWinch?(jointId: number, speed: number): number | boolean
  /** Where an anchor is now (it moves with its body). Without it an anchor stays where it was set. */
  anchorAt?(anchor: CableAnchor): Vec3 | null
}

export interface CombatToolsOptions {
  /** Plasma colour of the saber (linear RGB; brightness is added by the renderer). */
  saberColor?: Vec3
  courtSurface?: CourtSurface
}

export interface CombatToolsState {
  tool: ToolName | null
  saber: { id: number; physics: boolean; ignited: boolean; extension: number; tipSpeed: number; swinging: boolean; carved: number; clashes: number }
  rifle: { shots: number; tracers: number; ricochets: number }
  rocket: { fired: number; inFlight: number; blasts: number }
  laser: { firing: boolean; segments: number; reflections: number }
  grapple: { phase: 'idle' | 'anchored' ; cables: number; refused: number; pending: Vec3 | null; winch: number }
  tennis: { ready: boolean; phase: RallyPhase | 'off'; ballId: number; score: TennisScoreSnapshot | null; hits: number; bounces: number }
  glowCells: number
}

export interface CombatTools {
  readonly tool: ToolName | null
  select(tool: ToolName | null): void
  /** Primary input: a click (down) and its release (up). What it does depends on the tool. */
  primary(eye: Vec3, dir: Vec3, down: boolean): void
  /** Secondary input: saber on/off, grapple cancel, tennis new match. */
  secondary(eye: Vec3, dir: Vec3): void
  /** Scroll or keys: reels the newest cable in (positive) or out. */
  reel(amount: number): void
  ignite(on?: boolean): void
  swing(): void
  fireRifle(eye: Vec3, dir: Vec3): void
  fireRocket(eye: Vec3, dir: Vec3): void
  fireLaser(eye: Vec3, dir: Vec3, dt: number): void
  stopLaser(): void
  grappleClick(eye: Vec3, dir: Vec3): 'anchored' | 'linked' | 'missed' | 'refused'
  tennisSetup(at: Vec3): boolean
  tennisClick(eye: Vec3, dir: Vec3): 'serve' | 'swing' | 'off'
  /** Advances every tool by `dt` seconds with the eye where it is now. */
  update(dt: number, eye: Vec3, dir: Vec3): void
  /** What would be drawn now: `count` primitives of `PRIM_FLOATS` each, relative to `eye`. */
  drawList(eye: Vec3, forward: Vec3): { data: Float32Array; count: number }
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time?: number): void
  state(): CombatToolsState
  destroy(): void
}

// ── Small vector and quaternion helpers ─────────────────────────────────────

const add = (a: Vec3, b: Vec3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Vec3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const unit = (a: Vec3, fallback: Vec3 = [0, 0, -1]): V3 => {
  const l = len(a)
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [fallback[0], fallback[1], fallback[2]]
}
const lerp = (a: Vec3, b: Vec3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const reflect = (d: Vec3, n: Vec3): V3 => sub(d, mul(n, 2 * dot(d, n)))

/** The eye's frame from where it looks: right and up with the world's up kept up. */
export function eyeFrame(dir: Vec3): { fwd: V3; right: V3; up: V3 } {
  const fwd = unit(dir)
  let right = cross(fwd, [0, 1, 0])
  if (len(right) < 1e-4) right = [1, 0, 0]
  right = unit(right)
  return { fwd, right, up: cross(right, fwd) }
}

/** A rotation taking local +Y to `y` and local +Z as near `z` as it can be. */
export function quatFromYZ(y: Vec3, z: Vec3): Q {
  const Y = unit(y, [0, 1, 0])
  let Z = sub(z, mul(Y, dot(z, Y)))
  if (len(Z) < 1e-5) Z = Math.abs(Y[0]) < 0.9 ? cross([1, 0, 0], Y) : cross([0, 0, 1], Y)
  Z = unit(Z)
  const X = cross(Y, Z)
  // Columns X, Y, Z form the rotation matrix.
  const m00 = X[0], m01 = Y[0], m02 = Z[0], m10 = X[1], m11 = Y[1], m12 = Z[1], m20 = X[2], m21 = Y[2], m22 = Z[2]
  const tr = m00 + m11 + m22
  let q: Q
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

export function quatTurn(q: readonly number[], v: Vec3): V3 {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]
}

// ── Tuning (cells: 10 cm; seconds) ──────────────────────────────────────────

/** How long a saber swing takes, and how long the blade comes back to ready after it. */
export const SWING_TIME = 0.26, RECOVER_TIME = 0.22
/** A 5.56 mm round's speed, the tracer streak's length and how far a shot is traced. */
export const BULLET_SPEED = 9400, TRACER_LENGTH = 70, RIFLE_RANGE = 4000
/** A rocket's speed, its longest flight and the blast it makes. */
export const ROCKET_SPEED = 650, ROCKET_FLIGHT = 6, ROCKET_RADIUS = 40, ROCKET_PRESSURE = 8
export const LASER_RANGE = 512, LASER_BOUNCES = 6, LASER_POWER = 150
export const CABLE_MAX = 8, WINCH_SPEED = 30
const RETURN_DELAY = 0.12

/** Floats per drawn primitive: a (xyz, radius), b (xyz, radius), premultiplied colour (rgb, alpha), look (core, falloff, depth softness, 0). */
export const PRIM_FLOATS = 16
const MOST_PRIMS = 8192

const STEEL: Vec3 = [0.42, 0.44, 0.47]
const BALL_YELLOW: Vec3 = [0.75, 1.0, 0.08]
const HOT: Vec3 = [1.0, 0.36, 0.06]

interface Tracer { a: V3; b: V3; born: number; speed: number; life: number; ricochet: boolean }
interface Rocket { pos: V3; dir: V3; born: number; hitAt: number; hit: RayHit | null; trail: V3[] }
interface Spark { pos: V3; vel: V3; born: number; life: number; color: V3 }
interface Flash { at: V3; born: number; life: number; radius: number; color: V3 }
interface Cable { a: CableAnchor; b: CableAnchor; id: number; rest: number; winch: number }

// ── The tools ───────────────────────────────────────────────────────────────

export async function createCombatTools(
  device: GPUDevice | null,
  format: GPUTextureFormat,
  callbacks: CombatToolCallbacks = {},
  options: CombatToolsOptions = {},
): Promise<CombatTools> {
  const cb = callbacks
  const audio = cb.combatAudio ?? null
  const renderer = device ? await createCombatRenderer(device, format) : null

  let melee: MeleeWasm | null = null
  if (cb.melee) melee = cb.melee instanceof MeleeWasm ? cb.melee : new MeleeWasm(cb.melee)
  const groundMode: MeleeGround = cb.meleeGround ?? 'world'

  let tool: ToolName | null = null
  let now = 0
  let eye: V3 = [0, 0, 0]
  let aim: V3 = [0, 0, -1]

  // Saber
  const saberColor: V3 = [...(options.saberColor ?? [0.18, 0.72, 1.0])] as V3
  let saberId = 0
  let saberIgnited = false
  let saberExt = 0
  let saberTip = 0
  let swingAt = -1
  let swingSide = 1
  let lastBlade: { emitter: V3; tip: V3; radius: number } | null = null
  let carvedCount = 0
  let clashes = 0
  let glow: Float32Array = new Float32Array(0)
  let lastTipPos: V3 | null = null

  // Ranged
  const tracers: Tracer[] = []
  const rockets: Rocket[] = []
  const sparks: Spark[] = []
  const flashes: Flash[] = []
  let shots = 0, ricochets = 0, rocketsFired = 0, blasts = 0
  let laserHeld = false
  let laserSegs: { a: V3; b: V3 }[] = []
  let laserReflections = 0
  let lastLaserSpark = -1

  // Grapple
  const cables: Cable[] = []
  let pending: CableAnchor | null = null
  let refused = 0
  let reelSpeed = 0

  // Tennis
  let court: TennisCourtController | null = null
  const ballTrail: V3[] = []
  let tennisHits = 0, tennisBounces = 0
  let tickAcc = 0
  let farReturnAt = -1

  const sparksOf = (at: Vec3, dir: Vec3, count: number, color: Vec3, speed = 60) => {
    cb.emitSparks?.(at, dir, count, color)
    const n = Math.min(count, 24)
    for (let i = 0; i < n; i++) {
      const r: V3 = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]
      const v = unit(add(mul(unit(dir, [0, 1, 0]), 1.2), r))
      sparks.push({ pos: [at[0], at[1], at[2]], vel: mul(v, speed * (0.4 + Math.random())), born: now, life: 0.18 + Math.random() * 0.25, color: [color[0], color[1], color[2]] })
    }
    if (sparks.length > 512) sparks.splice(0, sparks.length - 512)
  }

  // ── Saber ──
  const ensureSaber = () => {
    if (saberId || !melee) return
    melee.setGround(groundMode, cb.groundAt ? cb.groundAt(eye[0], eye[2]) : 0)
    const { pos, rot } = saberPose()
    saberId = melee.spawn('lightsaber', pos, rot)
    if (saberId) melee.setColor(saberId, saberColor)
  }
  const dropSaber = () => {
    if (saberId && melee) melee.remove(saberId)
    saberId = 0
    if (saberIgnited) audio?.saberRetract?.({ at: eye })
    saberIgnited = false
    saberExt = 0
    lastBlade = null
    lastTipPos = null
  }

  /** Where the hand holds the hilt and which way the blade points, from the eye and the swing's phase. */
  const saberPose = (): { pos: V3; rot: Q; bladeDir: V3 } => {
    const { fwd, right, up } = eyeFrame(aim)
    const s = swingSide
    const ready = unit(add(add(mul(up, 0.85), mul(fwd, 0.45)), mul(right, 0.25 * s)))
    let bladeDir = ready
    let edge = fwd
    let hand = add(add(add(eye, mul(fwd, 4)), mul(right, 2.4 * s)), mul(up, -3))
    if (swingAt >= 0) {
      const t = now - swingAt
      // Ready (high, one side) → along the aim → low on the other side, then back to ready.
      const from = unit(add(add(mul(up, 0.75), mul(right, 0.6 * s)), mul(fwd, 0.3)))
      const mid = unit(add(fwd, mul(up, -0.08)))
      const to = unit(add(add(mul(up, -0.55), mul(right, -0.7 * s)), mul(fwd, 0.45)))
      let p: number
      let a: V3, b: V3, c: V3
      if (t < SWING_TIME) {
        p = t / SWING_TIME
        p = p * p * (3 - 2 * p)
        a = from; b = mid; c = to
      } else {
        p = clamp((t - SWING_TIME) / RECOVER_TIME, 0, 1)
        a = to; b = unit(add(to, ready)); c = ready
      }
      // A quadratic arc through the middle direction, kept unit.
      const q1 = lerp(a, b, p), q2 = lerp(b, c, p)
      bladeDir = unit(lerp(q1, q2, p))
      const ahead = unit(lerp(lerp(a, b, Math.min(1, p + 0.05)), lerp(b, c, Math.min(1, p + 0.05)), Math.min(1, p + 0.05)))
      edge = len(sub(ahead, bladeDir)) > 1e-4 ? unit(sub(ahead, bladeDir)) : fwd
      hand = add(add(add(eye, mul(fwd, 4.5)), mul(right, (t < SWING_TIME ? 1.6 - 3.2 * p : -1.6 + 4 * p) * s)), mul(up, -2.4))
      if (t >= SWING_TIME + RECOVER_TIME) {
        swingAt = -1
        swingSide = -swingSide
      }
    }
    return { pos: hand, rot: quatFromYZ(bladeDir, edge), bladeDir }
  }

  const handleMelee = (events: MeleeEvent[]) => {
    for (const e of events) {
      switch (e.type) {
        case 'kerf':
          carvedCount += e.cells.length / 3
          if (e.cells.length) cb.carveCells?.(e.cells)
          sparksOf(e.point, e.normal, 6, add(mul(saberColor, 0.4), HOT), 40)
          break
        case 'crush': {
          const cell = new Int32Array(e.cell)
          cb.carveCells?.(cell)
          break
        }
        case 'plasma-clash':
          clashes++
          audio?.saberClash?.({ at: e.pos, impulse: e.intensity, force: clamp(e.intensity, 0.2, 1) })
          sparksOf(e.pos, [0, 1, 0], 18, [1, 0.95, 0.8], 90)
          flashes.push({ at: e.pos, born: now, life: 0.12, radius: 6, color: mul(add(saberColor, [1, 1, 1]), 3) })
          break
        case 'parry':
          clashes++
          audio?.parryClash?.({ at: e.pos, impulse: e.impulse })
          sparksOf(e.pos, e.normal, Math.max(6, e.sparks), [1, 0.8, 0.45], 80)
          break
        case 'blunt':
          audio?.bluntHit?.({ at: e.pos, force: clamp(e.impulse / 400, 0.1, 1) })
          break
        case 'ignite':
          cb.igniteCell?.(e.cell)
          break
        default:
          break
      }
    }
  }

  const updateSaber = (dt: number) => {
    if (tool !== 'saber') return
    ensureSaber()
    const { pos, rot, bladeDir } = saberPose()
    if (melee && saberId) {
      if (groundMode === 'plane' && cb.groundAt) melee.setGround('plane', cb.groundAt(pos[0], pos[2]))
      const events = melee.driveHand(saberId, pos, rot, dt)
      if (events === null) {
        saberId = 0
        return
      }
      handleMelee(events)
      const pose = melee.pose(saberId)
      const blade = melee.blade(saberId)
      glow = melee.glow()
      if (pose) {
        saberExt = pose.extension
        saberTip = pose.tipSpeed
      }
      lastBlade = blade && blade.lit ? { emitter: blade.emitter, tip: blade.tip, radius: blade.radius } : null
      if (blade && blade.lit && saberTip > 20 && cb.carveCapsule) cb.carveCapsule(blade.emitter, blade.tip, blade.radius)
    } else {
      // No core: the blade is drawn where the hand holds it, and touches nothing.
      const target = saberIgnited ? 1 : 0
      saberExt = target > saberExt ? Math.min(1, saberExt + 4 * dt) : Math.max(0, saberExt - 4 * dt)
      const emitter = add(pos, mul(bladeDir, 0.5))
      const tip = add(pos, mul(bladeDir, 0.5 + 10 * saberExt))
      saberTip = lastTipPos && dt > 0 ? len(sub(tip, lastTipPos)) / dt : 0
      lastTipPos = tip
      lastBlade = saberExt > 0.05 ? { emitter, tip, radius: 0.32 } : null
    }
    if (saberIgnited) audio?.saberUpdate?.(saberTip / 10, 0, false, pos)
  }

  // ── Ranged ──
  const muzzleOf = (from: Vec3, dir: Vec3): V3 => {
    const { fwd, right, up } = eyeFrame(dir)
    return add(add(add(from, mul(fwd, 2.5)), mul(right, 1.2)), mul(up, -1.0))
  }

  const fireRifle = (from: Vec3, dir: Vec3) => {
    const d = unit(dir)
    const muzzle = muzzleOf(from, d)
    shots++
    cb.ballisticsFire?.(1, muzzle, d)
    audio?.bulletCrack?.({ at: muzzle, speed: BULLET_SPEED / 10 })
    flashes.push({ at: muzzle, born: now, life: 0.04, radius: 0.45, color: [3, 2.1, 0.8] })
    // The eye's ray finds what the crosshair is on; the round flies from the muzzle to it.
    const hit = cb.raycast?.(from, d, RIFLE_RANGE) ?? null
    const end = hit ? [...hit.pos] as V3 : add(from, mul(d, RIFLE_RANGE))
    const path = sub(end, muzzle)
    tracers.push({ a: muzzle, b: end, born: now, speed: BULLET_SPEED, life: len(path) / BULLET_SPEED + 0.09, ricochet: false })
    if (!hit) return
    sparksOf(hit.pos, hit.normal, 10, [1, 0.75, 0.4], 50)
    const along = unit(path)
    const grazing = Math.abs(dot(along, hit.normal)) < 0.35
    if (hit.hard && grazing) {
      ricochets++
      const out = unit(add(reflect(along, hit.normal), mul(hit.normal, 0.08)))
      const again = cb.raycast?.(add(hit.pos, mul(hit.normal, 0.2)), out, 600) ?? null
      const rEnd = again ? [...again.pos] as V3 : add(hit.pos, mul(out, 600))
      tracers.push({ a: [...hit.pos] as V3, b: rEnd, born: now + len(path) / BULLET_SPEED, speed: BULLET_SPEED * 0.7, life: len(sub(rEnd, hit.pos)) / (BULLET_SPEED * 0.7) + 0.09, ricochet: true })
      audio?.ricochet?.({ at: hit.pos })
    }
  }

  const fireRocket = (from: Vec3, dir: Vec3) => {
    const d = unit(dir)
    const muzzle = muzzleOf(from, d)
    rocketsFired++
    const hit = cb.raycast?.(muzzle, d, ROCKET_SPEED * ROCKET_FLIGHT) ?? null
    const hitAt = now + (hit ? hit.dist : ROCKET_SPEED * ROCKET_FLIGHT) / ROCKET_SPEED
    rockets.push({ pos: muzzle, dir: d, born: now, hitAt, hit, trail: [muzzle] })
    flashes.push({ at: muzzle, born: now, life: 0.07, radius: 0.8, color: [3, 1.8, 0.6] })
  }

  const detonate = (r: Rocket, at: V3) => {
    blasts++
    cb.shockwaveBlast?.(at, ROCKET_RADIUS, ROCKET_PRESSURE, 24)
    audio?.shockwaveBoom?.({ at, radius: ROCKET_RADIUS / 10, force: 1 })
    flashes.push({ at, born: now, life: 0.35, radius: ROCKET_RADIUS * 0.6, color: [9, 5, 1.2] })
    sparksOf(at, r.hit ? r.hit.normal : [0, 1, 0], 24, [1, 0.6, 0.2], 140)
  }

  const traceLaser = (origin: V3, dir: V3): { a: V3; b: V3 }[] => {
    const segs: { a: V3; b: V3 }[] = []
    let o = origin, d = dir, left = LASER_RANGE
    for (let bounce = 0; bounce <= LASER_BOUNCES && left > 0.5; bounce++) {
      const hit = cb.raycast?.(o, d, left) ?? null
      if (!hit) {
        segs.push({ a: o, b: add(o, mul(d, left)) })
        break
      }
      const p: V3 = [...hit.pos] as V3
      segs.push({ a: o, b: p })
      left -= hit.dist
      if (!hit.mirror) break
      d = unit(reflect(d, hit.normal))
      o = add(p, mul(hit.normal, 0.05))
    }
    return segs
  }

  const fireLaser = (from: Vec3, dir: Vec3, dt: number) => {
    const d = unit(dir)
    const muzzle = muzzleOf(from, d)
    const told = cb.beamsFire?.(muzzle, d, LASER_POWER, Math.max(dt, 1 / 240))
    const segs = Array.isArray(told) ? (told as readonly BeamSegment[]).map((s) => ({ a: [...s.a] as V3, b: [...s.b] as V3 })) : traceLaser(muzzle, d)
    laserSegs = segs
    laserReflections = Math.max(0, segs.length - 1)
    const end = segs.length ? segs[segs.length - 1].b : muzzle
    audio?.laserSizzle?.({ active: true, at: end, heat: 0.7 })
    laserHeld = true
    if (now - lastLaserSpark > 0.05) {
      lastLaserSpark = now
      const back = unit(sub(segs.length ? segs[segs.length - 1].a : muzzle, end), [0, 1, 0])
      sparksOf(end, back, 3, [1, 0.5, 0.15], 30)
    }
  }

  const stopLaser = () => {
    if (laserHeld) {
      audio?.laserSizzle?.({ active: false })
      audio?.laserStop?.()
    }
    laserHeld = false
    laserSegs = []
  }

  // ── Grapple ──
  const grappleClick = (from: Vec3, dir: Vec3): 'anchored' | 'linked' | 'missed' | 'refused' => {
    const hit = cb.raycast?.(from, unit(dir), 600) ?? null
    if (!hit) return 'missed'
    const anchor: CableAnchor = { pos: [...hit.pos] as V3, bodyId: hit.bodyId ?? 0 }
    if (!pending) {
      pending = anchor
      return 'anchored'
    }
    const a = pending
    pending = null
    const span = len(sub(anchor.pos, a.pos))
    if (span < 0.5 || (a.bodyId === anchor.bodyId && a.bodyId !== 0 && span < 1)) {
      refused++
      return 'refused'
    }
    const id = cb.jointsAddRope ? cb.jointsAddRope(a, anchor, span, 0) : 0
    if (!id) {
      // The solver did not make the cable: nothing is drawn as if it had.
      refused++
      return 'refused'
    }
    cables.push({ a, b: anchor, id, rest: span, winch: 0 })
    if (cables.length > CABLE_MAX) cables.shift()
    return 'linked'
  }

  const reel = (amount: number) => {
    const c = cables[cables.length - 1]
    if (!c) return
    reelSpeed = clamp(amount, -1, 1) * WINCH_SPEED
    c.winch = reelSpeed
    cb.jointsSetWinch?.(c.id, reelSpeed)
  }

  // ── Tennis ──
  const tennisSetup = (at: Vec3): boolean => {
    if (!cb.sports) return false
    const ground = cb.groundAt ? cb.groundAt(at[0], at[2]) : at[1]
    // The player stands on the near baseline facing +Z; the net is half a court ahead.
    const origin: V3 = [at[0], ground, at[2] + ITF_COURT.halfLength]
    const sound = audio?.tennisPop && audio.tennisBounce ? { tennisPop: audio.tennisPop.bind(audio), tennisBounce: audio.tennisBounce.bind(audio), tennisNet: audio.tennisNet?.bind(audio) } : null
    court = new TennisCourtController(cb.sports, { origin, surface: options.courtSurface ?? 'hard', sound })
    court.resetMatch('near')
    ballTrail.length = 0
    farReturnAt = -1
    return true
  }

  const tennisClick = (from: Vec3, dir: Vec3): 'serve' | 'swing' | 'off' => {
    if (!court && !tennisSetup([from[0], from[1] - 16, from[2]])) return 'off'
    const c = court!
    const phase = c.phase
    if (phase === 'idle' || phase === 'point-over' || !c.ballId) {
      c.serve({ server: 'near' })
      ballTrail.length = 0
      return 'serve'
    }
    // An assisted swing: the strings sweep through the ball if it is in reach, towards the far court.
    const ball = c.readBall()
    const d = unit(dir)
    const reachPoint = add(from, mul(d, 8))
    const centre: V3 = ball && len(sub(ball.pos, from)) < 30 ? [...ball.pos] as V3 : reachPoint
    const toFar = unit([0, 0.35, 1])
    const across: V3 = unit(cross([0, 1, 0], toFar), [1, 0, 0])
    const prev = racketPoseFromNormal(sub(centre, add(mul(toFar, 3), mul(across, 3))), toFar)
    const curr = racketPoseFromNormal(add(centre, add(mul(toFar, 3), mul(across, 3))), toFar)
    c.swingRacket('near', prev, curr)
    return 'swing'
  }

  const farReturn = () => {
    const c = court
    if (!c) return
    const ball = c.readBall()
    if (!ball) return
    // The far side's player sends it back deep into the near court with topspin.
    const o = c.origin
    const target: V3 = [o[0] + (Math.random() * 2 - 1) * 25, o[1], o[2] - ITF_COURT.halfLength * 0.6]
    const flat = [target[0] - ball.pos[0], target[2] - ball.pos[2]]
    const dist = Math.hypot(flat[0], flat[1])
    const horiz = 260
    const t = dist / horiz
    const h = ball.pos[1] - o[1]
    const vy = (0.5 * 98 * t * t - h) / t + 12
    const vel: V3 = [flat[0] / dist * horiz, vy, flat[1] / dist * horiz]
    c.spawnBall([ball.pos[0], Math.max(ball.pos[1], o[1] + 8), ball.pos[2]], vel, [-120, 0, 0], 'far', 'rally')
  }

  const handleTennis = (events: TennisCourtEvent[]) => {
    for (const e of events) {
      if (e.type === 'racket') tennisHits++
      if (e.type === 'bounce') {
        tennisBounces++
        if (e.side === 'far' && e.inBounds && e.bounceCount === 1) farReturnAt = now + RETURN_DELAY
      }
      if (e.type === 'point') farReturnAt = -1
    }
  }

  const updateTennis = (dt: number) => {
    if (!court) return
    tickAcc += dt
    const ticks = Math.min(8, Math.floor(tickAcc * 120))
    tickAcc -= ticks / 120
    if (tickAcc > 1 / 30) tickAcc = 0
    if (ticks > 0) handleTennis(court.step(ticks))
    if (farReturnAt >= 0 && now >= farReturnAt) {
      farReturnAt = -1
      farReturn()
    }
    const ball = court.readBall()
    if (ball) {
      ballTrail.push([...ball.pos] as V3)
      if (ballTrail.length > 14) ballTrail.shift()
    } else ballTrail.length = 0
  }

  // ── Frame ──
  const update = (dt: number, at: Vec3, dir: Vec3) => {
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1)
    now += step
    eye = [at[0], at[1], at[2]]
    aim = unit(dir)
    updateSaber(step)
    if (tool !== 'saber' && melee && saberId) {
      // A put-away saber still cools its kerfs.
      melee.step(step)
      glow = melee.glow()
    }
    if (laserHeld && tool === 'laser') fireLaser(eye, aim, step)
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]
      const t = Math.min(now, r.hitAt) - r.born
      r.pos = add(r.trail[0], mul(r.dir, ROCKET_SPEED * t))
      const last = r.trail[r.trail.length - 1]
      if (len(sub(r.pos, last)) > 6) r.trail.push([...r.pos] as V3)
      if (r.trail.length > 48) r.trail.splice(1, 1)
      if (now >= r.hitAt) {
        if (r.hit) detonate(r, [...r.hit.pos] as V3)
        rockets.splice(i, 1)
      }
    }
    for (let i = tracers.length - 1; i >= 0; i--) if (now - tracers[i].born > tracers[i].life) tracers.splice(i, 1)
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]
      if (now - s.born > s.life) { sparks.splice(i, 1); continue }
      s.vel[1] -= 98 * step
      s.pos = add(s.pos, mul(s.vel, step))
    }
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].born > flashes[i].life) flashes.splice(i, 1)
    for (const c of cables) {
      if (c.winch) c.rest = Math.max(1, c.rest - c.winch * step)
    }
    updateTennis(step)
  }

  // ── Draw list ──
  let list = new Float32Array(1024 * PRIM_FLOATS)
  let count = 0
  let base: V3 = [0, 0, 0]
  let look: V3 = [0, 0, -1]
  /** One capsule from `a` to `b` (a == b: a sprite), clipped to in front of the eye. */
  const prim = (a: Vec3, b: Vec3, ra: number, rb: number, rgb: Vec3, alpha: number, core: number, falloff: number, soft = 0.5) => {
    if (count >= MOST_PRIMS) return
    let pa = sub(a, base), pb = sub(b, base)
    const minZ = NEAR * 1.5
    const za = dot(pa, look), zb = dot(pb, look)
    if (za < minZ && zb < minZ) return
    if (za < minZ) pa = lerp(pb, pa, (zb - minZ) / (zb - za))
    else if (zb < minZ) pb = lerp(pa, pb, (za - minZ) / (za - zb))
    if (count * PRIM_FLOATS + PRIM_FLOATS > list.length) {
      const grown = new Float32Array(list.length * 2)
      grown.set(list)
      list = grown
    }
    list.set([pa[0], pa[1], pa[2], ra, pb[0], pb[1], pb[2], rb, rgb[0], rgb[1], rgb[2], alpha, core, falloff, soft, 0], count * PRIM_FLOATS)
    count++
  }
  const sprite = (at: Vec3, r: number, rgb: Vec3, alpha: number, core: number, falloff: number) => prim(at, at, r, r, rgb, alpha, core, falloff)

  const drawList = (at: Vec3, forward: Vec3) => {
    count = 0
    base = [at[0], at[1], at[2]]
    look = unit(forward)
    // Saber: an HDR plasma halo round a white-hot core, with a soft outer bloom.
    if (lastBlade) {
      const { emitter, tip, radius } = lastBlade
      const c = saberColor
      prim(emitter, tip, radius * 2.4, radius * 2.0, mul(c, 1.1), 0, 0, 2.4, 0.3)
      prim(emitter, tip, radius * 1.0, radius * 0.85, mul(c, 4), 0, 5, 0.9, 0.2)
      const hilt = sub(emitter, mul(unit(sub(tip, emitter)), 2.7))
      prim(hilt, emitter, 0.38, 0.38, [0.32, 0.33, 0.35], 1, 0, 0.12, 0.05)
    }
    // Kerf: cooling molten cells, white-orange to dull red.
    for (let i = 0; i + 3 < glow.length; i += 4) {
      const h = glow[i + 3]
      if (h <= 0.01) continue
      const hot = Math.pow(h, 1.6)
      sprite([glow[i], glow[i + 1], glow[i + 2]], 0.55 + 0.3 * h, [HOT[0] * 5 * hot + saberColor[0] * 0.6 * hot, HOT[1] * 5 * hot * h, HOT[2] * 3 * hot * h], 0, 0.6 * hot * h, 1.4)
    }
    // Tracers: a bright streak running along the path, and a faint line left behind it.
    for (const t of tracers) {
      const age = now - t.born
      if (age < 0) continue
      const full = len(sub(t.b, t.a))
      const dir = unit(sub(t.b, t.a))
      const head = Math.min(full, age * t.speed)
      const tail = Math.max(0, head - TRACER_LENGTH)
      if (head < full) prim(add(t.a, mul(dir, tail)), add(t.a, mul(dir, head)), 0.05, 0.1, t.ricochet ? [5, 3, 1.2] : [7, 5, 2.2], 0, 1.5, 1.2, 0.2)
      const fade = clamp(1 - (age - full / t.speed) / 0.09, 0, 1) * 0.5
      if (fade > 0) prim(t.a, add(t.a, mul(dir, head)), 0.03, 0.03, [fade * 1.5, fade * 1.1, fade * 0.6], 0, 0, 1, 0.2)
    }
    // Rockets: a hot exhaust, a white-hot nozzle, and grey smoke left along the way.
    for (const r of rockets) {
      for (let i = 1; i < r.trail.length; i++) {
        const k = i / r.trail.length
        prim(r.trail[i - 1], r.trail[i], 1.2 + 1.8 * (1 - k), 1.2 + 1.8 * (1 - k), mul([0.5, 0.5, 0.52], 0.35 * k), 0.35 * k, 0, 1.5, 1)
      }
      prim(r.pos, sub(r.pos, mul(r.dir, 3)), 0.35, 0.35, [0.25, 0.27, 0.22], 1, 0, 0.1, 0.05)
      sprite(sub(r.pos, mul(r.dir, 3.4)), 1.6, [9, 4.5, 1.2], 0, 3, 1.6)
    }
    // Laser: each bounce a red-hot beam with a white core.
    for (let i = 0; i < laserSegs.length; i++) {
      const s = laserSegs[i]
      const flicker = 0.85 + 0.15 * Math.sin(now * 90 + i)
      prim(s.a, s.b, 0.55, 0.55, mul([4, 0.5, 0.25], flicker), 0, 0, 2.4, 0.3)
      prim(s.a, s.b, 0.14, 0.14, [8, 1.6, 0.8], 0, 6, 0.8, 0.2)
      sprite(s.b, 1.4, [6, 1.6, 0.6], 0, 3, 1.8)
    }
    // Sparks and flashes.
    for (const s of sparks) {
      const k = 1 - (now - s.born) / s.life
      const tail = sub(s.pos, mul(s.vel, 0.012))
      prim(tail, s.pos, 0.04, 0.07, mul(s.color, 6 * k), 0, 1.5 * k, 1, 0.2)
    }
    for (const f of flashes) {
      const k = 1 - (now - f.born) / f.life
      sprite(f.at, f.radius * (0.6 + 0.4 * (1 - k)), mul(f.color, k * k), 0, k, 2)
    }
    // Cables: steel lines that sag when slack (a parabola standing in for the catenary).
    const anchorNow = (a: CableAnchor): V3 => {
      const p = cb.anchorAt?.(a)
      return p ? [p[0], p[1], p[2]] : [a.pos[0], a.pos[1], a.pos[2]]
    }
    for (const c of cables) {
      const pa = anchorNow(c.a), pb = anchorNow(c.b)
      const span = len(sub(pb, pa))
      const slack = Math.max(0, c.rest - span)
      const sag = span > 0.01 ? Math.sqrt((3 * span * slack) / 8) : 0
      let prev = pa
      const n = 16
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const p = lerp(pa, pb, t)
        p[1] -= sag * 4 * t * (1 - t)
        prim(prev, p, 0.12, 0.12, STEEL, 1, 0, 0.15, 0.05)
        prev = p
      }
    }
    if (pending) {
      sprite(pending.pos, 0.6, [2.2, 1.6, 0.3], 0, 1, 1.5)
      if (tool === 'grapple') prim(pending.pos, add(base, mul(aim, 12)), 0.05, 0.05, [0.5, 0.45, 0.3], 0, 0, 1, 0.2)
    }
    // Tennis: the court's lines and net, an optic-yellow ball and its spin trail.
    if (court) {
      const o = court.origin
      const y = o[1] + 0.06
      const hw = court.activeHalfWidth, hl = ITF_COURT.halfLength, sl = ITF_COURT.serviceLineDist
      const line = (x0: number, z0: number, x1: number, z1: number) => prim([o[0] + x0, y, o[2] + z0], [o[0] + x1, y, o[2] + z1], 0.25, 0.25, [0.85, 0.85, 0.82], 0.9, 0, 0.2, 0.05)
      line(-hw, -hl, hw, -hl); line(-hw, hl, hw, hl)
      line(-hw, -hl, -hw, hl); line(hw, -hl, hw, hl)
      line(-ITF_COURT.singlesHalfWidth, -sl, ITF_COURT.singlesHalfWidth, -sl)
      line(-ITF_COURT.singlesHalfWidth, sl, ITF_COURT.singlesHalfWidth, sl)
      line(0, -sl, 0, sl)
      const nh = ITF_COURT.netCenterHeight, ns = ITF_COURT.netHalfSpan
      prim([o[0] - ns, o[1] + nh, o[2]], [o[0] + ns, o[1] + nh, o[2]], 0.25, 0.25, [0.9, 0.9, 0.9], 1, 0, 0.15, 0.05)
      for (const k of [0.33, 0.66]) prim([o[0] - ns, o[1] + nh * k, o[2]], [o[0] + ns, o[1] + nh * k, o[2]], 0.06, 0.06, [0.08, 0.08, 0.08], 0.5, 0, 0.2, 0.05)
      for (let x = -ns; x <= ns + 0.01; x += 8) prim([o[0] + x, o[1], o[2]], [o[0] + x, o[1] + nh, o[2]], 0.08, 0.08, [0.08, 0.08, 0.08], 0.6, 0, 0.2, 0.05)
      prim([o[0] - ns, o[1], o[2]], [o[0] - ns, o[1] + nh + 0.5, o[2]], 0.4, 0.4, [0.12, 0.2, 0.14], 1, 0, 0.1, 0.05)
      prim([o[0] + ns, o[1], o[2]], [o[0] + ns, o[1] + nh + 0.5, o[2]], 0.4, 0.4, [0.12, 0.2, 0.14], 1, 0, 0.1, 0.05)
      for (let i = 1; i < ballTrail.length; i++) {
        const k = i / ballTrail.length
        prim(ballTrail[i - 1], ballTrail[i], 0.12 * k, 0.2 * k, mul(BALL_YELLOW, 0.6 * k), 0, 0, 1.2, 0.2)
      }
      const ball = ballTrail[ballTrail.length - 1]
      if (ball) {
        // A real ball is a pixel across at rally distance: a soft optic-yellow glow keeps it in sight.
        sprite(ball, 1.2, mul(BALL_YELLOW, 0.9), 0, 0.25, 2.5)
        sprite(ball, 0.335, BALL_YELLOW, 1, 0, 0.12)
      }
    }
    return { data: list, count }
  }

  const state = (): CombatToolsState => ({
    tool,
    saber: { id: saberId, physics: !!melee, ignited: saberIgnited, extension: saberExt, tipSpeed: saberTip, swinging: swingAt >= 0, carved: carvedCount, clashes },
    rifle: { shots, tracers: tracers.filter((t) => !t.ricochet).length, ricochets },
    rocket: { fired: rocketsFired, inFlight: rockets.length, blasts },
    laser: { firing: laserHeld, segments: laserSegs.length, reflections: laserReflections },
    grapple: { phase: pending ? 'anchored' : 'idle', cables: cables.length, refused, pending: pending ? pending.pos : null, winch: reelSpeed },
    tennis: { ready: !!court, phase: court ? court.phase : 'off', ballId: court ? court.ballId : 0, score: court ? court.getScore() : null, hits: tennisHits, bounces: tennisBounces },
    glowCells: glow.length / 4,
  })

  const ignite = (on?: boolean) => {
    const want = on ?? !saberIgnited
    if (want === saberIgnited) return
    ensureSaber()
    saberIgnited = want
    if (melee && saberId) melee.ignite(saberId, want)
    const at = lastBlade ? lastBlade.emitter : eye
    if (want) audio?.saberIgnite?.({ at })
    else audio?.saberRetract?.({ at })
  }

  return {
    get tool() { return tool },
    select(next) {
      if (next === tool) return
      if (tool === 'laser') stopLaser()
      if (tool === 'saber' && next !== 'saber') {
        if (saberIgnited) ignite(false)
        lastBlade = null
      }
      if (tool === 'grapple') pending = null
      tool = next
    },
    primary(at, dir, down) {
      if (!tool) return
      switch (tool) {
        case 'saber':
          if (!down) return
          if (!saberIgnited) ignite(true)
          if (swingAt < 0) swingAt = now
          return
        case 'rifle': if (down) fireRifle(at, dir); return
        case 'rocket': if (down) fireRocket(at, dir); return
        case 'laser': if (down) fireLaser(at, dir, 1 / 60); else stopLaser(); return
        case 'grapple': if (down) grappleClick(at, dir); return
        case 'tennis': if (down) tennisClick(at, dir); return
      }
    },
    secondary(at, dir) {
      void at; void dir
      if (tool === 'saber') ignite()
      else if (tool === 'grapple') pending = null
      else if (tool === 'tennis' && court) court.resetMatch('near')
    },
    reel,
    ignite,
    swing() { if (swingAt < 0) swingAt = now },
    fireRifle,
    fireRocket,
    fireLaser,
    stopLaser,
    grappleClick,
    tennisSetup,
    tennisClick,
    update,
    drawList,
    draw(encoder, to, view, time) {
      void time
      if (!renderer) return
      const { data, count: n } = drawList(view.eye, view.forward)
      renderer.draw(encoder, to, view, data, n, now)
    },
    state,
    destroy() {
      stopLaser()
      dropSaber()
      renderer?.destroy()
    },
  }
}

// ── The renderer: capsules facing the eye, depth-tested against the scene ───

const CODE = /* wgsl */ `
struct U {
  right: vec3f, tanHalf: f32,
  up: vec3f, aspect: f32,
  forward: vec3f, resX: f32,
  resY: f32, time: f32, pad0: f32, pad1: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var depthTex: texture_depth_2d;
const NEAR_Z = ${NEAR.toFixed(1)};
const FAR_Z = ${FAR.toFixed(1)};

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) seen: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) colour: vec4f,
  @location(3) @interpolate(flat) look: vec4f,
  @location(4) @interpolate(flat) span: vec4f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) colour: vec4f, @location(3) look: vec4f) -> VOut {
  let ab = b.xyz - a.xyz;
  let lenAB = length(ab);
  var dir = u.right;
  var side = u.up;
  if (lenAB > 1e-4) {
    dir = ab / lenAB;
    let mid = (a.xyz + b.xyz) * 0.5;
    let toEye = -mid / max(length(mid), 1e-4);
    let c = cross(dir, toEye);
    let cl = length(c);
    if (cl > 1e-3) { side = c / cl; } else { side = normalize(cross(dir, u.forward + u.up * 0.01)); }
  }
  // Never thinner than about one and a half pixels, however far.
  let pix = 2.0 * u.tanHalf / max(u.resY, 1.0);
  let da = max(dot(a.xyz, u.forward), NEAR_Z);
  let db = max(dot(b.xyz, u.forward), NEAR_Z);
  let ra = max(a.w, da * pix * 0.75);
  let rb = max(b.w, db * pix * 0.75);
  let rq = max(ra, rb);
  let s = f32(vi & 1u) * 2.0 - 1.0;
  let atEnd = (vi & 2u) != 0u;
  let t = select(-rq, lenAB + rq, atEnd);
  let world = a.xyz + dir * t + side * (s * rq);
  let d = dot(world, u.forward);
  var out: VOut;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR_Z / (FAR_Z - NEAR_Z) * (d - NEAR_Z), d);
  out.seen = world;
  out.uv = vec2f(t, s * rq);
  out.colour = colour;
  out.look = look;
  out.span = vec4f(lenAB, ra, rb, rq);
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let maxCoord = vec2i(max(i32(u.resX) - 1, 0), max(i32(u.resY) - 1, 0));
  let px = clamp(vec2i(in.pos.xy), vec2i(0), maxCoord);
  let sceneD = textureLoad(depthTex, px, 0);
  let sceneZ = select(FAR_Z, NEAR_Z / max(1.0 - sceneD * ((FAR_Z - NEAR_Z) / FAR_Z), 1e-6), sceneD < 1.0);
  let fragZ = dot(in.seen, u.forward);
  if (fragZ <= NEAR_Z || fragZ >= sceneZ) { discard; }
  let lenAB = in.span.x;
  let along = clamp(in.uv.x, 0.0, lenAB);
  let f = select(along / max(lenAB, 1e-4), 0.0, lenAB <= 1e-4);
  let r = max(mix(in.span.y, in.span.z, f), 1e-4);
  let dist = length(vec2f(in.uv.x - along, in.uv.y)) / r;
  if (dist >= 1.0) { discard; }
  let halo = pow(1.0 - dist, max(in.look.y, 0.05));
  let coreMask = 1.0 - smoothstep(0.0, 0.34, dist);
  // Soft where it meets a surface, over a little of its own size.
  let fade = saturate((sceneZ - fragZ) / max(r * 4.0 * in.look.z, 0.05));
  let rgb = in.colour.rgb * halo + vec3f(in.look.x * coreMask);
  return vec4f(rgb, in.colour.a * halo) * fade;
}
`

interface CombatRenderer {
  draw(encoder: GPUCommandEncoder, to: Target, view: View, data: Float32Array, count: number, time: number): void
  destroy(): void
}

export const COMBAT_TOOLS_WGSL = CODE

async function createCombatRenderer(device: GPUDevice, format: GPUTextureFormat): Promise<CombatRenderer> {
  const module = await shader(device, 'combat-tools', CODE)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  // Premultiplied: alpha 0 adds light (plasma, tracers, beams), alpha 1 covers (hilt, cable, ball).
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
  const pipeline = await device.createRenderPipelineAsync({
    label: 'combat-tools',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{
        arrayStride: PRIM_FLOATS * 4, stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x4' },
          { shaderLocation: 2, offset: 32, format: 'float32x4' },
          { shaderLocation: 3, offset: 48, format: 'float32x4' },
        ],
      }],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
  })
  const uniforms = device.createBuffer({ label: 'combat-tools uniforms', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const u = new Float32Array(16)
  let instances: GPUBuffer | null = null
  let capacity = 0
  let bound: { depth: GPUTextureView; group: GPUBindGroup } | null = null
  return {
    draw(encoder, to, view, data, count, time) {
      if (count <= 0) return
      if (count > capacity) {
        instances?.destroy()
        capacity = Math.max(256, 1 << Math.ceil(Math.log2(count)))
        instances = device.createBuffer({ label: 'combat-tools prims', size: capacity * PRIM_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      }
      device.queue.writeBuffer(instances!, 0, data.buffer as ArrayBuffer, data.byteOffset, count * PRIM_FLOATS * 4)
      u.set([
        view.right[0], view.right[1], view.right[2], view.tanHalf,
        view.up[0], view.up[1], view.up[2], to.size[0] / to.size[1],
        view.forward[0], view.forward[1], view.forward[2], to.size[0],
        to.size[1], time, 0, 0,
      ])
      device.queue.writeBuffer(uniforms, 0, u)
      if (bound?.depth !== to.depth) {
        bound = { depth: to.depth, group: device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: to.depth }] }) }
      }
      // No depth attachment: the scene's depth is read as a texture, as puffs.ts does.
      const pass = encoder.beginRenderPass({ label: 'combat-tools', colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bound.group)
      pass.setVertexBuffer(0, instances!)
      pass.draw(4, count)
      pass.end()
    },
    destroy() {
      instances?.destroy()
      uniforms.destroy()
    },
  }
}
