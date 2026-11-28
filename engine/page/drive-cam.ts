// Cinematic driving camera suite (#32): encapsulates all external vehicle cameras (close chase,
// far chase, hood, bumper, and dynamic GTA-style cinema mode), instant 180-degree look-back (X),
// smooth exponential mode-switch interpolation, SF hill stunt air-cam, and multi-ray anti-clipping.
// The driver's seat is one of its views too (#74): C goes round them all, the seat among them. In the seat the
// eye is living.ts's own (cockpit.ts heaves it) and only `frameSeat` is asked of the camera.
import { AHEAD, clearWay, roomAfter } from './eye.ts'

export const DRIVE_CAM_MODES = ['close', 'far', 'hood', 'bumper', 'seat', 'cinema'] as const
export type DriveCamMode = (typeof DRIVE_CAM_MODES)[number]

export const DRIVE_CAM_LABELS: Record<DriveCamMode, string> = {
  close: 'Close',
  far: 'Far',
  hood: 'Hood',
  bumper: 'Bumper',
  seat: 'Seat',
  cinema: 'Cinema',
}

/** The view C goes to after `mode`. */
export const nextDriveCam = (mode: DriveCamMode): DriveCamMode => DRIVE_CAM_MODES[(DRIVE_CAM_MODES.indexOf(mode) + 1) % DRIVE_CAM_MODES.length]

export interface DriveCamDeps {
  pose: { x: number; y: number; z: number; yaw: number; pitch: number; tilt?: [number, number, number, number] }
  /** Ground height at world metres (x, z), in metres. */
  ground(x: number, z: number): number
  /** Whether a world cell (x, y, z) blocks the camera. */
  stands(x: number, y: number, z: number): boolean
  /** Dynamic camera lens offsets: extra FOV (degrees), roll (radians), speed-energy (0..1), and signed drift/yaw lateral blur (-1..1). */
  lens?(fovAdd: number, rollAdd: number, energy: number, driftBlur?: number): void
}

export interface DriveCamInput {
  dt: number
  /** Vehicle center of mass (cells), orientation quaternion, and unit horizontal forward vector. */
  at: readonly [number, number, number]
  rot: readonly [number, number, number, number]
  front: readonly [number, number, number]
  /** Vehicle body size (cells) and visual bounds [minX, minY, minZ, maxX, maxY, maxZ] in body-local cells. */
  size: readonly [number, number, number]
  visualBox: readonly [number, number, number, number, number, number]
  /** Forward axis in body-local cells (0:+x, 1:-x, 2:+z, 3:-z). */
  frontAxis: number
  /** Vehicle motor top speed (cells/s). */
  topSpeed: number
  /** Maps body-local cell coordinates to current world cell coordinates. */
  place(local: readonly [number, number, number]): [number, number, number] | null
  /** Smoothed world velocity (cells/s). */
  vel: readonly [number, number, number]
  fwdSpeed: number
  latSpeed: number
  horizSpeed: number
  longAcc: number
  steer: number
  drifting: boolean
  /** Number of wheels currently grounded (0 = airborne). */
  feet: number
  /** Mouse/touch look delta [right, up] radians. */
  turn: readonly [number, number]
  /** Whether Look-Back (KeyX) is currently held. */
  lookBack: boolean
  /** Whether prefers-reduced-motion: reduce is active. */
  reducedMotion: boolean
}

export interface DriveCam {
  readonly mode: DriveCamMode
  readonly label: string
  readonly fovAdd: number
  /** Selects a camera mode (C goes to `nextDriveCam` of the one it is in). */
  setMode(mode: DriveCamMode): void
  /** Resets transient camera dynamics when mounting/unmounting. */
  reset(): void
  /** Synchronizes yaw/blend to a vehicle heading (on mount or leaving the seat). */
  sync(facing: number, orbitOffset?: number, snapBlend?: boolean): void
  /** Injects an impact/landing camera shake impulse. */
  shake(amp: number): void
  /** Updates `pose` and `lens` for one external driving frame (in 'seat', when the seat cannot be placed, it frames as 'close'). */
  frame(ctx: DriveCamInput): void
  /** Updates dynamic FOV and speed-energy while in the seat ('seat': C round to it, or V). */
  frameSeat(dt: number, fwdSpeed: number, topSpeed: number, reducedMotion: boolean): void
}

const M = 10
const FRONTS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const
const RIGHTS = [[0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0]] as const
/** Exponential time constant for smooth mode switches (~0.25s to 95%). */
const MODE_TAU = 0.082
/** The widest screen (width over height) the chase cameras are framed for; wider ones bring the chase in. */
const WIDE_ASPECT = 16 / 9
/** Horizontal shoulder half-width (cells) for multi-ray anti-clipping. */
const SHOULDER = 4.5
/** Cinema shot kinds cycled dynamically. */
type CinemaKind = 'hero' | 'fender' | 'flyby' | 'heli'
const CINEMA_ORDER: readonly CinemaKind[] = ['hero', 'fender', 'flyby', 'heli']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const smoothstep01 = (v: number, lo: number, hi: number) => { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t) }
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a }
const turned = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}

/** Converts normalized car coordinates (fwdFrac: -0.5 rear..+0.5 front, upFrac: 0..1 visual height, rightFrac: -0.5..+0.5) to body-local cells. */
function localPoint(box: readonly [number, number, number, number, number, number], frontAxis: number, fwdFrac: number, upFrac: number, rightFrac: number): [number, number, number] {
  const [x0, y0, z0, x1, y1, z1] = box
  const midX = (x0 + x1) * 0.5, midZ = (z0 + z1) * 0.5
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0
  const len = frontAxis < 2 ? sx : sz
  const wide = frontAxis < 2 ? sz : sx
  const ly = y0 + upFrac * sy
  if (frontAxis === 0) return [midX + fwdFrac * len, ly, midZ + rightFrac * wide]
  if (frontAxis === 1) return [midX - fwdFrac * len, ly, midZ - rightFrac * wide]
  if (frontAxis === 2) return [midX - rightFrac * wide, ly, midZ + fwdFrac * len]
  return [midX + rightFrac * wide, ly, midZ - fwdFrac * len]
}

export function createDriveCam(deps: DriveCamDeps): DriveCam {
  let mode: DriveCamMode = 'close'
  let chaseYaw = 0, orbitYaw = 0, orbitPitch = 0, lookIdle = 99
  let camFov = 0, camRoll = 0, camPull = 0, camHill = 0, camEnergy = 0, camSideOff = 0, camDriftBlur = 0
  let prevFinalYaw: number | null = null
  let shakeAmp = 0, shakeT = 0, roadBuzzT = 0
  // Multi-ray anti-clipping state.
  let room = 1, wasHead: [number, number, number] | null = null
  // Smooth mode-switch blended parameters (metres & radians).
  let blendReady = false
  let curFwdOff = -6.45, curUpOff = 1.70, curPitch = -0.105, curFovBias = 0, curMountMix = 0
  // Instant look-back (X) state: 1 while held, decays smoothly to 0 on release.
  let lookBackBlend = 0
  // SF hill stunt air-cam state.
  let airTime = 0, airBlend = 0
  // Dynamic GTA Cinematic Mode state.
  let cineKind: CinemaKind = 'hero'
  let cineIdx = 0
  let cineSide = 1
  let cineAge = 0
  let cineDur = 4.5
  let cineOccluded = 0
  let cineFlyAnchor: [number, number, number] | null = null
  let cineTransition = 0
  let cineFromPos: [number, number, number] | null = null
  let cineFromYaw = 0, cineFromPitch = -0.14
  let exitTransition = 0
  let exitFromPos: [number, number, number] | null = null
  let exitFromYaw = 0, exitFromPitch = -0.14
  let wasCineLookBack = false

  /** Multi-ray probe: center + fanned left/right shoulder rays from `head` to `head + off`. */
  const clearMulti = (head: readonly [number, number, number], off: readonly [number, number, number], dt: number): number => {
    const horiz = Math.hypot(off[0], off[2])
    const freeC = clearWay(deps.stands, head, off)
    let free = freeC
    if (horiz > 2) {
      const rx = (-off[2] / horiz) * SHOULDER, rz = (off[0] / horiz) * SHOULDER
      const freeL = clearWay(deps.stands, head, [off[0] - rx, off[1], off[2] - rz])
      const freeR = clearWay(deps.stands, head, [off[0] + rx, off[1], off[2] + rz])
      const shoulder = Math.min(freeL, freeR)
      // Center hit pulls in immediately; shoulder graze pulls in fast without violent snap-jitter.
      if (freeC < room) room = freeC
      else if (shoulder < room) room += (shoulder - room) * (1 - Math.exp(-dt * 24))
      free = Math.min(freeC, shoulder)
    } else if (freeC < room) {
      room = freeC
    }
    const going = wasHead && dt > 0 ? [(head[0] - wasHead[0]) / dt * AHEAD, (head[2] - wasHead[2]) / dt * AHEAD] : [0, 0]
    const far = Math.hypot(going[0], going[1])
    wasHead = [head[0], head[1], head[2]]
    const ahead = far > 0.5 && far < 60 ? clearWay(deps.stands, [head[0] + going[0], head[1], head[2] + going[1]], off) : 1
    room = roomAfter(room, free, ahead, dt)
    return room
  }

  /** Evaluates a candidate cinema camera world position (cells) and returns clearance score (0..1). */
  const scorePos = (carHead: readonly [number, number, number], pos: readonly [number, number, number]): number => {
    if (deps.stands(pos[0], pos[1], pos[2])) return 0
    const off = [pos[0] - carHead[0], pos[1] - carHead[1], pos[2] - carHead[2]] as const
    const c = clearWay(deps.stands, carHead, off)
    if (c < 0.78) return c * 0.4
    // Also check a slight vertical clearance around the lens.
    if (deps.stands(pos[0], pos[1] + 2, pos[2]) || deps.stands(pos[0], pos[1] - 2, pos[2])) return c * 0.5
    return c
  }

  /** Picks a fresh, unobstructed cinema shot (never repeating the same kind back-to-back). */
  const pickCinemaShot = (ctx: DriveCamInput, forceNext = true) => {
    const carHead: [number, number, number] = [ctx.at[0], ctx.at[1] + ctx.size[1] * 0.5 + 4, ctx.at[2]]
    const moving = ctx.horizSpeed > 18
    const len = ctx.frontAxis < 2 ? ctx.visualBox[3] - ctx.visualBox[0] : ctx.visualBox[5] - ctx.visualBox[2]
    const wide = ctx.frontAxis < 2 ? ctx.visualBox[5] - ctx.visualBox[2] : ctx.visualBox[3] - ctx.visualBox[0]
    const startIdx = forceNext ? (cineIdx + 1) % CINEMA_ORDER.length : cineIdx
    cineSide = -cineSide
    cineAge = 0
    cineOccluded = 0
    cineDur = ctx.reducedMotion ? 6.5 : 4.5
    cineFlyAnchor = null

    for (let step = 0; step < CINEMA_ORDER.length; step++) {
      const idx = (startIdx + step) % CINEMA_ORDER.length
      const kind = CINEMA_ORDER[idx]
      if (kind === 'flyby' && !moving) continue
      for (const side of [cineSide, -cineSide]) {
        const probe = computeCinemaPos(kind, side, 0, ctx, len, wide, null)
        if (probe && scorePos(carHead, probe.pos) >= 0.82) {
          cineIdx = idx
          cineKind = kind
          cineSide = side
          if (kind === 'flyby') cineFlyAnchor = probe.pos
          return
        }
      }
    }
    // Fallback: helicopter high chase (almost always clear in open SF sky).
    cineKind = 'heli'
    cineIdx = CINEMA_ORDER.indexOf('heli')
  }

  /** Computes world camera position (cells) + aim target (cells) + roll/fovBias for a cinema shot at progress t (0..1). */
  const computeCinemaPos = (
    kind: CinemaKind,
    side: number,
    t: number,
    ctx: DriveCamInput,
    len: number,
    wide: number,
    flyAnchor: [number, number, number] | null,
  ): { pos: [number, number, number]; target: [number, number, number]; fovBias: number; roll: number } | null => {
    const sweep = ctx.reducedMotion ? 0.5 : t
    const fx = ctx.front[0], fz = ctx.front[2]
    const rx = -fz, rz = fx
    const tall = ctx.visualBox[4] - ctx.visualBox[1]
    const target: [number, number, number] = [ctx.at[0] + fx * len * 0.08, ctx.at[1] + tall * 0.28, ctx.at[2] + fz * len * 0.08]

    if (kind === 'fender') {
      // Low 3/4 front-fender tracking: hugs beside front wheel looking back-inward across the car's flank & skyline.
      const fwdDist = len * (0.68 - sweep * 0.24) + 12
      const sideDist = (wide * 0.85 + 13) * side
      const x = ctx.at[0] + fx * fwdDist + rx * sideDist
      const z = ctx.at[2] + fz * fwdDist + rz * sideDist
      const g = deps.ground(x / M, z / M) * M
      const y = Math.max(ctx.at[1] - tall * 0.06 + 4.5, g + 4.5)
      return { pos: [x, y, z], target: [ctx.at[0] - fx * len * 0.08, ctx.at[1] + tall * 0.24, ctx.at[2] - fz * len * 0.08], fovBias: 2, roll: -0.024 * side }
    }

    if (kind === 'flyby') {
      // Roadside flyby: anchored ahead along travel vector, panning smoothly as the car streaks past.
      if (flyAnchor) {
        return { pos: flyAnchor, target, fovBias: -4, roll: 0 }
      }
      const vh = Math.hypot(ctx.vel[0], ctx.vel[2])
      const vx = vh > 10 ? ctx.vel[0] / vh : fx
      const vz = vh > 10 ? ctx.vel[2] / vh : fz
      const vrx = -vz, vrz = vx
      const lead = clamp(vh * 2.4, 140, 420)
      const curb = (wide * 0.7 + 34) * side
      const x = ctx.at[0] + vx * lead + vrx * curb
      const z = ctx.at[2] + vz * lead + vrz * curb
      const g = deps.ground(x / M, z / M) * M
      const y = Math.max(ctx.at[1] + 8, g + 14)
      return { pos: [x, y, z], target, fovBias: -4, roll: 0 }
    }

    if (kind === 'heli') {
      // Sweeping helicopter chase: elevated aerial orbit framing car + SF hills/skyline.
      const angle = side * (0.42 + (sweep - 0.5) * 0.58)
      const dist = 165 + len * 1.15
      const backX = -fx * Math.cos(angle) + rx * Math.sin(angle)
      const backZ = -fz * Math.cos(angle) + rz * Math.sin(angle)
      const x = ctx.at[0] + backX * dist
      const z = ctx.at[2] + backZ * dist
      const g = deps.ground(x / M, z / M) * M
      const y = Math.max(ctx.at[1] + 95 + Math.sin(sweep * Math.PI) * 20, g + 65)
      return { pos: [x, y, z], target: [ctx.at[0] + fx * len * 0.35, ctx.at[1] + tall * 0.2, ctx.at[2] + fz * len * 0.35], fovBias: -6, roll: 0.015 * side }
    }

    // 'hero': Low, tight rear-quarter sweeping chase framing exhaust, flank, and SF skyline ahead.
    const angle = side * (0.58 - sweep * 0.34)
    const dist = len * 1.12 + 16
    const backX = -fx * Math.cos(angle) + rx * Math.sin(angle)
    const backZ = -fz * Math.cos(angle) + rz * Math.sin(angle)
    const x = ctx.at[0] + backX * dist
    const z = ctx.at[2] + backZ * dist
    const g = deps.ground(x / M, z / M) * M
    const y = Math.max(ctx.at[1] + tall * 0.36 + 3.2, g + 4.8)
    return { pos: [x, y, z], target: [ctx.at[0] + fx * len * 0.22, ctx.at[1] + tall * 0.32, ctx.at[2] + fz * len * 0.22], fovBias: 0, roll: 0.022 * side }
  }

  const startCinema = (fromPose: boolean) => {
    cineAge = 0
    cineOccluded = 0
    cineFlyAnchor = null
    if (fromPose) {
      cineFromPos = [deps.pose.x * M, deps.pose.y * M, deps.pose.z * M]
      cineFromYaw = deps.pose.yaw
      cineFromPitch = deps.pose.pitch
      cineTransition = 1
    } else {
      cineFromPos = null
      cineTransition = 0
    }
  }

  const leaveCinema = () => {
    exitFromPos = [deps.pose.x * M, deps.pose.y * M, deps.pose.z * M]
    exitFromYaw = deps.pose.yaw
    exitFromPitch = deps.pose.pitch
    exitTransition = 1
    blendReady = false
  }

  return {
    get mode() { return mode },
    get label() { return DRIVE_CAM_LABELS[mode] },
    get fovAdd() { return camFov },
    setMode(next) {
      if (next === mode) return
      const prev = mode
      mode = next
      if (next === 'cinema') { exitTransition = 0; startCinema(true) }
      else if (prev === 'cinema') leaveCinema()
    },
    reset() {
      camFov = 0; camRoll = 0; camPull = 0; camHill = 0; camEnergy = 0; camSideOff = 0; camDriftBlur = 0
      prevFinalYaw = null
      shakeAmp = 0; shakeT = 0; roadBuzzT = 0
      room = 1; wasHead = null
      lookBackBlend = 0
      airTime = 0; airBlend = 0
      cineAge = 0; cineOccluded = 0; cineFlyAnchor = null; cineTransition = 0; cineFromPos = null
      exitTransition = 0; exitFromPos = null; wasCineLookBack = false
      blendReady = false
    },
    sync(facing, orbitOffset = 0, snapBlend = true) {
      chaseYaw = facing
      orbitYaw = orbitOffset
      orbitPitch = 0
      lookIdle = orbitOffset ? 0 : 99
      room = 1
      wasHead = null
      camSideOff = 0
      camDriftBlur = 0
      prevFinalYaw = null
      lookBackBlend = 0
      exitTransition = 0; exitFromPos = null; wasCineLookBack = false
      if (snapBlend) blendReady = false
      if (mode === 'cinema') startCinema(false)
    },
    shake(amp) {
      shakeAmp = Math.max(shakeAmp, amp)
    },
    frameSeat(dt, fwdSpeed, topSpeed, reducedMotion) {
      const motion = reducedMotion ? 0 : 1
      const top = Math.max(120, topSpeed), speedFrac = Math.min(1.2, Math.abs(fwdSpeed) / Math.max(160, top))
      const targetFov = motion * Math.min(10, speedFrac * speedFrac * 8 + speedFrac * 2)
      camFov += (targetFov - camFov) * Math.min(1, dt * 6)
      camEnergy += (motion * Math.max(0, Math.min(0.75, (Math.abs(fwdSpeed) * 0.36 - 42) / 120)) - camEnergy) * Math.min(1, dt * 5)
      camDriftBlur *= Math.exp(-dt * 8)
      deps.lens?.(camFov, 0, camEnergy, 0)
    },
    frame(ctx) {
      const { dt, at, rot, front, size, visualBox, frontAxis, topSpeed, vel, fwdSpeed, latSpeed, horizSpeed, longAcc, steer, drifting, feet, turn, lookBack, reducedMotion } = ctx
      const motion = reducedMotion ? 0 : 1
      const carYaw = Math.atan2(front[0], -front[2])
      const len = Math.max(...size)
      const visLen = frontAxis < 2 ? visualBox[3] - visualBox[0] : visualBox[5] - visualBox[2]
      const visTall = visualBox[4] - visualBox[1]
      const tallScreen = innerHeight > innerWidth

      // 3D car pitch & roll from orientation quaternion.
      const front3d = turned(rot, FRONTS[frontAxis])
      const right3d = turned(rot, RIGHTS[frontAxis])
      const carPitch = Math.asin(clamp(front3d[1], -0.85, 0.85))
      const carRoll = Math.asin(clamp(right3d[1], -0.45, 0.45))

      // Free-look orbit input with gentle auto-recenter while moving.
      if (Math.abs(turn[0]) > 0.0005 || Math.abs(turn[1]) > 0.0005) {
        orbitYaw = wrap(orbitYaw + turn[0])
        orbitPitch = clamp(orbitPitch + turn[1], -0.55, 0.65)
        lookIdle = 0
      } else {
        lookIdle += dt
        if (lookIdle > 1.5 && horizSpeed > 14) {
          const recenter = Math.exp(-dt * 3.4)
          orbitYaw *= recenter
          orbitPitch *= recenter
        }
      }

      // Instant Look-Back (KeyX held): snaps 180 deg immediately, returns smoothly on release.
      if (lookBack) {
        lookBackBlend = 1
      } else if (lookBackBlend > 0) {
        lookBackBlend = reducedMotion ? 0 : lookBackBlend * Math.exp(-dt * 12)
        if (lookBackBlend < 0.002) lookBackBlend = 0
      }

      // SF Hill Stunt Air-Cam: airborne (feet === 0) for > 0.35s at speed.
      const airborne = feet === 0 && horizSpeed > 35
      if (airborne) airTime += dt
      else airTime = 0
      const wantAir = airTime > 0.35 ? Math.min(1, (airTime - 0.35) / 0.45) * Math.min(1, horizSpeed / 90) : 0
      const airRate = wantAir > airBlend ? 4.5 : 3.8
      airBlend += (wantAir - airBlend) * (reducedMotion ? 1 : 1 - Math.exp(-dt * airRate))
      if (airBlend < 0.001) airBlend = 0

      // Velocity-blended spring-damped chase yaw: swings smoothly toward the outside rear-quarter during drifts.
      const top = Math.max(120, topSpeed)
      const speedFrac = Math.min(1.25, Math.abs(fwdSpeed) / Math.max(160, top))
      let targetYaw = carYaw
      let slipRad = 0
      if (fwdSpeed > 18 && horizSpeed > 20 && mode !== 'hood' && mode !== 'bumper') {
        const velYaw = Math.atan2(vel[0], -vel[2])
        slipRad = wrap(velYaw - carYaw)
        targetYaw = wrap(carYaw + slipRad * (drifting ? 0.72 : 0.38))
      }
      const yawStiff = mode === 'hood' || mode === 'bumper' ? 18 : drifting ? 2.4 : 5.2 + speedFrac * 3.8
      chaseYaw = wrap(chaseYaw + wrap(targetYaw - chaseYaw) * Math.min(1, dt * yawStiff))

      // Impact / landing shake + subtle bumper road micro-vibration.
      let shakeYaw = 0, shakePitch = 0, shakeRoll = 0
      if (shakeAmp > 0.0005 && motion > 0) {
        shakeT += dt * 46
        shakeYaw = Math.sin(shakeT * 1.13) * shakeAmp * 0.65
        shakePitch = Math.cos(shakeT * 1.47) * shakeAmp * 0.75
        shakeRoll = Math.sin(shakeT * 1.83) * shakeAmp * 0.55
        shakeAmp *= Math.exp(-dt * 8.5)
      } else {
        shakeAmp = 0
      }
      if (mode === 'bumper' && feet >= 2 && horizSpeed > 30 && motion > 0) {
        roadBuzzT += dt * (28 + speedFrac * 36)
        const buzz = Math.min(0.0028, speedFrac * 0.0024)
        shakePitch += Math.sin(roadBuzzT * 1.37) * buzz
        shakeRoll += Math.cos(roadBuzzT * 1.91) * buzz * 0.8
      }

      // Dynamic elastic pull-back under hard accel/boost, subtle lean-in on braking, hill pitch tracking, and drift shoulder swing.
      const speedPull = Math.max(0, speedFrac - 0.35) * 0.52
      const targetPull = motion * clamp(longAcc * 0.0046 + speedPull + (drifting ? 0.36 : 0), -0.38, 0.92)
      camPull += (targetPull - camPull) * Math.min(1, dt * 4.8)
      const targetHill = clamp(front3d[1] * 0.65, -0.18, 0.18)
      camHill += (targetHill - camHill) * Math.min(1, dt * 5.0)
      // Lateral rear-quarter offset during hard drifts & cornering so the car's flank & turn ahead frame dramatically.
      const driftSlide = clamp(-latSpeed / 75, -1, 1)
      const wantSide = motion * (mode === 'far' ? 0.85 : 0.68) * (drifting ? clamp(driftSlide * 1.15 - steer * 0.25, -1, 1) : clamp(driftSlide * 0.35, -0.35, 0.35)) * (1 - lookBackBlend)
      camSideOff += (wantSide - camSideOff) * Math.min(1, dt * (drifting ? 4.2 : 5.5))

      // ── Mode 5: Dynamic GTA Cinematic Mode (unless Look-Back X is held) ──
      if (mode === 'cinema' && lookBackBlend < 0.01) {
        if (wasCineLookBack) { wasCineLookBack = false; startCinema(true) }
        const carHead: [number, number, number] = [at[0], at[1] + size[1] * 0.5 + 4, at[2]]
        if (cineAge === 0 && !cineFlyAnchor) pickCinemaShot(ctx, false)
        cineAge += dt
        const progress = clamp(cineAge / cineDur, 0, 1)
        const shot = computeCinemaPos(cineKind, cineSide, progress, ctx, visLen, frontAxis < 2 ? visualBox[5] - visualBox[2] : visualBox[3] - visualBox[0], cineFlyAnchor)
        let needCut = cineAge >= cineDur
        if (shot) {
          if (cineKind === 'flyby' && cineFlyAnchor) {
            // Cut cleanly once the car has streaked past the roadside camera.
            const toCarX = at[0] - cineFlyAnchor[0], toCarZ = at[2] - cineFlyAnchor[2]
            const past = toCarX * front[0] + toCarZ * front[2]
            if (past > 220) needCut = true
          }
          const clear = scorePos(carHead, shot.pos)
          if (clear < 0.72) {
            cineOccluded += dt
            if (cineOccluded > 0.28 || clear < 0.15) needCut = true
          } else {
            cineOccluded = 0
          }
        } else {
          needCut = true
        }
        if (needCut) {
          pickCinemaShot(ctx, true)
          cineTransition = 0
          cineFromPos = null
        }
        const active = computeCinemaPos(cineKind, cineSide, clamp(cineAge / cineDur, 0, 1), ctx, visLen, frontAxis < 2 ? visualBox[5] - visualBox[2] : visualBox[3] - visualBox[0], cineFlyAnchor)!
        let pos = active.pos
        // Guarantee the chosen camera is never inside geometry.
        const offFromCar = [pos[0] - carHead[0], pos[1] - carHead[1], pos[2] - carHead[2]] as const
        const cClear = clearWay(deps.stands, carHead, offFromCar)
        if (cClear < 0.98) {
          pos = [carHead[0] + offFromCar[0] * cClear, carHead[1] + offFromCar[1] * cClear, carHead[2] + offFromCar[2] * cClear]
        }
        const dx = active.target[0] - pos[0], dy = active.target[1] - pos[1], dz = active.target[2] - pos[2]
        const distXZ = Math.hypot(dx, dz) || 1
        let yaw = Math.atan2(dx, -dz)
        let pitch = clamp(Math.atan2(dy, distXZ), -1.1, 0.75)

        // Smooth ~0.25s entry blend when first cycling into cinema mode.
        if (cineTransition > 0.005 && cineFromPos && !reducedMotion) {
          cineTransition *= Math.exp(-dt / MODE_TAU)
          const w = cineTransition
          pos = [pos[0] + (cineFromPos[0] - pos[0]) * w, pos[1] + (cineFromPos[1] - pos[1]) * w, pos[2] + (cineFromPos[2] - pos[2]) * w]
          yaw = wrap(yaw + wrap(cineFromYaw - yaw) * w)
          pitch = pitch + (cineFromPitch - pitch) * w
        } else {
          cineTransition = 0
        }

        const targetFov = active.fovBias + motion * Math.min(8, speedFrac * speedFrac * 6)
        camFov += (targetFov - camFov) * Math.min(1, dt * 6)
        const targetRoll = motion * active.roll
        camRoll += (targetRoll - camRoll) * Math.min(1, dt * 6)
        const targetEnergy = motion * clamp((Math.abs(fwdSpeed) * 0.36 - 48) / 120, 0, 0.8)
        camEnergy += (targetEnergy - camEnergy) * Math.min(1, dt * 5)
        const cineDrift = motion * (drifting ? clamp(-latSpeed / 70, -0.85, 0.85) : 0)
        camDriftBlur += (cineDrift - camDriftBlur) * Math.min(1, dt * 5)

        deps.pose.tilt = undefined
        deps.pose.x = pos[0] / M
        deps.pose.y = pos[1] / M
        deps.pose.z = pos[2] / M
        deps.pose.yaw = wrap(yaw + shakeYaw * 0.5)
        deps.pose.pitch = clamp(pitch + shakePitch * 0.5, -1.2, 0.85)
        deps.lens?.(camFov, camRoll + shakeRoll * 0.5, camEnergy, camDriftBlur)
        return
      }

      // ── Modes 1–4: Close, Far, Hood, Bumper (plus Look-Back override for Cinema) ──
      // Measure vehicle bounds in metres so every car from low GT coupe to tall SUV sits heroically
      // right above the roofline without pitch-compounded drone elevation.
      const halfLenM = Math.max(visLen, len) * 0.5 / M
      const visTallM = Math.max(visTall, size[1]) / M
      const roofAboveComM = Math.max(size[1] * 0.5, visualBox[4] - size[1] * 0.5) / M
      // The lens is vertical, so a screen wider than 16:9 (a phone on its side, ~2.17:1) shows more road at each
      // side and the car shrinks across it: bring the chase in so the car keeps a 16:9 desktop's share of the width.
      const screenBack = tallScreen ? 1.28 : clamp(WIDE_ASPECT * innerHeight / innerWidth, 0.8, 1)
      const closeBack = (halfLenM + 3.63 + visTallM * 0.55) * screenBack
      const farBack = (halfLenM + 4.35 + visTallM * 0.72) * screenBack
      const closeHigh = roofAboveComM + (tallScreen ? 1.12 : 0.90)
      const farHigh = roofAboveComM + (tallScreen ? 1.28 : 1.08)

      // Air-cam framing adjustments for chase cameras: widen back, tilt slightly lower/wider over SF skyline.
      const airScale = (mode === 'close' || mode === 'far' || mode === 'cinema') ? airBlend * (1 - lookBackBlend) : 0
      const airBack = airScale * 2.4
      const airDrop = airScale * 0.45 * (motion ? 1 : 0.4)
      const airPitch = airScale * 0.09
      const airFov = airScale * 5.5

      // Target mode parameters in car-relative metres: fwdOff < 0 behind car, fwdOff > 0 forward of car center.
      let targetFwdOff: number, targetUpOff: number, targetBasePitch: number, targetFovBias: number, targetMountMix: number
      if (mode === 'far') {
        targetFwdOff = -(farBack + camPull + airBack)
        targetUpOff = farHigh - airDrop
        targetBasePitch = (tallScreen ? -0.165 : -0.115) + camHill + airPitch
        targetFovBias = 4.0 + airFov
        targetMountMix = 0
      } else if (mode === 'hood') {
        targetFwdOff = (visLen * 0.22) / M
        targetUpOff = (visTall * 0.74 - size[1] * 0.5) / M
        targetBasePitch = (lookBackBlend > 0.5 ? -carPitch : carPitch) - 0.045
        targetFovBias = 5.5
        targetMountMix = 1
      } else if (mode === 'bumper') {
        targetFwdOff = (visLen * 0.55) / M
        targetUpOff = (visTall * 0.30 - size[1] * 0.5) / M
        targetBasePitch = (lookBackBlend > 0.5 ? -carPitch : carPitch) - 0.012
        targetFovBias = 10.5
        targetMountMix = 1
      } else {
        // 'close' (and cinema look-back fallback, and a seat that cannot be placed)
        targetFwdOff = -(closeBack + camPull + airBack)
        targetUpOff = closeHigh - airDrop
        targetBasePitch = (tallScreen ? -0.145 : -0.105) + camHill + airPitch
        targetFovBias = airFov
        targetMountMix = 0
      }

      // Exponentially blend mode distance, height, pitch, and FOV over ~0.25s (instant under reduced-motion or initial sync).
      const blendK = !blendReady || reducedMotion ? 1 : 1 - Math.exp(-dt / MODE_TAU)
      blendReady = true
      curFwdOff += (targetFwdOff - curFwdOff) * blendK
      curUpOff += (targetUpOff - curUpOff) * blendK
      curPitch += (targetBasePitch - curPitch) * blendK
      curFovBias += (targetFovBias - curFovBias) * blendK
      curMountMix += (targetMountMix - curMountMix) * blendK

      // Dynamic speed FOV, corner roll, radial speed-energy, and rotational/lateral drift blur.
      const speedFovBoost = mode === 'bumper' ? 1.25 : mode === 'hood' ? 1.12 : 1
      const dynFov = motion * (Math.min(15, speedFrac * speedFrac * 12.5 + speedFrac * 2.8) * speedFovBoost + clamp(longAcc * 0.016, -2.2, 2.5))
      const targetFov = curFovBias + dynFov
      camFov += (targetFov - camFov) * Math.min(1, dt * 6.5)

      const chassisRoll = (mode === 'hood' || mode === 'bumper') ? (lookBackBlend > 0.5 ? -carRoll : carRoll) * (mode === 'bumper' ? 0.85 : 0.72) : 0
      const cornerRoll = motion * clamp(-latSpeed * 0.0006 - steer * speedFrac * 0.014, -0.032, 0.032) * (1 - lookBackBlend)
      const targetRoll = motion * (chassisRoll + cornerRoll)
      camRoll += (targetRoll - camRoll) * Math.min(1, dt * 7)

      const energyThresh = mode === 'bumper' ? 22 : mode === 'hood' ? 30 : 35
      const energyBoost = mode === 'bumper' ? 1.3 : mode === 'hood' ? 1.15 : 1.05
      const targetEnergy = motion * clamp(((Math.abs(fwdSpeed) * 0.36 - energyThresh) / 110) * energyBoost, 0, 1)
      camEnergy += (targetEnergy - camEnergy) * Math.min(1, dt * 5.5)

      if (mode === 'cinema') {
        wasCineLookBack = true
        curMountMix = 0
      }

      // Compute final yaw & pitch, applying instant 180-deg Look-Back (X) and smooth return.
      const orbitClamped = curMountMix > 0.5 ? clamp(orbitYaw, -1.15, 1.15) : orbitYaw
      const orbitPitchClamped = curMountMix > 0.5 ? clamp(orbitPitch, -0.22, 0.35) : orbitPitch
      const baseYaw = wrap(chaseYaw + wrap(carYaw - chaseYaw) * lookBackBlend)
      const lookBackYaw = Math.PI * lookBackBlend
      let finalYaw = wrap(baseYaw + orbitClamped * (1 - lookBackBlend) + lookBackYaw + shakeYaw)
      let finalPitch = clamp(curPitch + orbitPitchClamped * (1 - lookBackBlend) + shakePitch, -1.2, 0.85)

      // Signed lateral/rotational drift motion blur from camera yaw swing + slide angle (zero under reduced-motion).
      const yawRate = prevFinalYaw !== null && dt > 1e-4 ? wrap(finalYaw - prevFinalYaw) / dt : 0
      prevFinalYaw = finalYaw
      const slipDrive = drifting ? clamp(-latSpeed / 58, -1, 1) : clamp(-latSpeed / 120, -0.35, 0.35) * smoothstep01(horizSpeed, 40, 90)
      const yawDrive = clamp(yawRate * 0.55, -1, 1) * smoothstep01(horizSpeed, 25, 70)
      const targetDriftBlur = motion * (1 - lookBackBlend) * (1 - curMountMix * 0.5) * clamp(slipDrive * 0.72 + yawDrive * 0.58, -1, 1)
      camDriftBlur += (targetDriftBlur - camDriftBlur) * Math.min(1, dt * (Math.abs(targetDriftBlur) > Math.abs(camDriftBlur) ? 7.5 : 5.0))
      if (Math.abs(camDriftBlur) < 0.002) camDriftBlur = 0

      deps.pose.tilt = undefined
      deps.pose.yaw = finalYaw
      deps.pose.pitch = finalPitch
      deps.lens?.(camFov, camRoll + shakeRoll, camEnergy, camDriftBlur)

      // Compute chase camera position (when behind the car): direct eye height above car center with
      // no -look[1]*backM pitch compounding; only user free-look orbitPitch pivots vertically.
      const cp = Math.cos(finalPitch)
      const look = [Math.sin(finalYaw) * cp, Math.sin(finalPitch), -Math.cos(finalYaw) * cp] as const
      const sideX = Math.cos(finalYaw), sideZ = Math.sin(finalYaw)
      const backM = Math.max(0.1, -curFwdOff)
      // Smooth roof-clearance arc while transitioning between chase and hood/bumper so the lens glides over the roof.
      const roofClear = Math.abs(curFwdOff) < halfLenM * 1.15 && curMountMix > 0.02 && curMountMix < 0.98
        ? Math.sin(clamp((curFwdOff + halfLenM * 1.15) / (halfLenM * 2.3), 0, 1) * Math.PI) * ((visTall * 0.72) / M)
        : 0
      const orbitVertM = -Math.sin(orbitPitchClamped * (1 - lookBackBlend)) * backM
      const chaseSideM = camSideOff * (1 - curMountMix)
      const headPos: [number, number, number] = [at[0], at[1] + size[1] / 2 + 5, at[2]]
      const eyeWantX = at[0] - look[0] * backM * M + sideX * chaseSideM * M
      const eyeWantZ = at[2] - look[2] * backM * M + sideZ * chaseSideM * M
      const chaseWantY = Math.max(
        at[1] + (curUpOff + roofClear + orbitVertM) * M,
        deps.ground(eyeWantX / M, eyeWantZ / M) * M + 4.5,
      )
      const chaseOff: [number, number, number] = [eyeWantX - headPos[0], chaseWantY - headPos[1], eyeWantZ - headPos[2]]
      const chaseRoom = curMountMix < 0.99 ? clearMulti(headPos, chaseOff, dt) : 1
      const chasePos: [number, number, number] = [
        headPos[0] + chaseOff[0] * chaseRoom,
        headPos[1] + chaseOff[1] * chaseRoom,
        headPos[2] + chaseOff[2] * chaseRoom,
      ]

      // Compute exact car-mounted 3D position for hood / bumper (and their clean rear-facing look-back anchors).
      let finalPos = chasePos
      if (curMountMix > 0.005) {
        const isHood = mode === 'hood'
        const fwdF = lookBackBlend > 0.5 ? (isHood ? -0.34 : -0.55) : (isHood ? 0.22 : 0.55)
        const upF = lookBackBlend > 0.5 ? (isHood ? 0.88 : 0.40) : (isHood ? 0.74 : 0.30)
        const local = localPoint(visualBox, frontAxis, fwdF, upF, 0)
        const mounted = ctx.place(local)
        if (mounted) {
          const minGround = deps.ground(mounted[0] / M, mounted[2] / M) * M + 3.2
          const mx = mounted[0], my = Math.max(mounted[1], minGround), mz = mounted[2]
          if (curMountMix >= 0.995) {
            finalPos = [mx, my, mz]
          } else {
            // Smooth arc over the roofline during the ~0.25s mode transition.
            const t = curMountMix
            const arcY = Math.sin(t * Math.PI) * (visTall * 0.48)
            finalPos = [
              chasePos[0] + (mx - chasePos[0]) * t,
              chasePos[1] + (my - chasePos[1]) * t + arcY,
              chasePos[2] + (mz - chasePos[2]) * t,
            ]
          }
        }
      }

      // Smooth ~0.25s exit blend when cycling out of cinema into close chase.
      if (exitTransition > 0.005 && exitFromPos && !reducedMotion) {
        exitTransition *= Math.exp(-dt / MODE_TAU)
        const w = exitTransition
        finalPos = [
          finalPos[0] + (exitFromPos[0] - finalPos[0]) * w,
          finalPos[1] + (exitFromPos[1] - finalPos[1]) * w,
          finalPos[2] + (exitFromPos[2] - finalPos[2]) * w,
        ]
        finalYaw = wrap(finalYaw + wrap(exitFromYaw - finalYaw) * w)
        finalPitch = finalPitch + (exitFromPitch - finalPitch) * w
        deps.pose.yaw = finalYaw
        deps.pose.pitch = finalPitch
      } else {
        exitTransition = 0
      }

      deps.pose.x = finalPos[0] / M
      deps.pose.y = finalPos[1] / M
      deps.pose.z = finalPos[2] / M
    },
  }
}
