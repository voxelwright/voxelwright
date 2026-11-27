// Black-box gameplay flight recorder & passive anomaly detector (#64).
// Keeps a bounded in-memory ring buffer (~30 s of 5 Hz keyframes, ~300 discrete events, ~100 replayable edits,
// and deduplicated anomalies) with zero network traffic during play. Exposes a clean API on `engine.recorder`
// for human feedback (feedback.ts), local session flushes (POST /api/session), deterministic replay (replay.mjs),
// and GTA-style automated / AI playtest runners (playtest.mjs).
import type { Input } from './input.ts'
import type { Living } from './living.ts'
import type { Marcher, View } from './march.ts'
import type { Me } from './person.ts'
import type { Street } from './street.ts'
import { FRAME, latLon, ON as BAY_ON, tileOf } from './bay.ts'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type AnomalyKind =
  | 'runtime_error'
  | 'gpu_fault'
  | 'worker_lost'
  | 'nan_state'
  | 'player_stuck'
  | 'fell_under_ground'
  | 'inside_solid'
  | 'vehicle_overlap'
  | 'vehicle_stuck'
  | 'vehicle_in_solid'
  | 'vehicle_flipped'
  | 'vehicle_ground_glitch'
  | 'physics_explosion'
  | 'pool_exhausted'
  | 'tile_load_failure'
  | 'frame_stall'

export interface GeoRef {
  cell: [number, number, number]
  latLon?: [number, number]
  tile?: string
  square?: string
  street?: string
}

export interface VehicleSnap {
  id: number
  kind: 'parked' | 'traffic' | 'cable' | 'tram' | 'living'
  model: string
  name: string
  x: number
  y: number
  z: number
  heading: number
  v: number
  long: number
  wide: number
  road: string
  lane: number
  s: number
  wait: string
  stuck: number
  blocked: boolean
  living: boolean
}

export interface Keyframe {
  t: number
  dt: number
  clock: number
  mode: 'flying' | 'foot' | 'riding'
  inputTop: string
  pose: [number, number, number, number, number, number]
  input: {
    held: string[]
    stick: [number, number]
  }
  foot: {
    at: [number, number, number]
    yaw: number
    speed: number
    aloft: boolean
    canopy: boolean
  } | null
  ride: {
    id: number
    name: string
    ref?: string
    at: [number, number, number]
    rot: [number, number, number, number]
    front: [number, number, number]
    kmh: number
    gear: number
    rpm: number
    slip: number
    drifting: boolean
    surface: string
    dents: number
  } | null
  perf: {
    frameMs: number
    gpuMs: number
    cpuMs: number
    scale: number
    wanted: number
    stale: number
    poolPct: number
    poolFull: number
    bodies: number
    loose: number
    burning: number
  }
  cars: VehicleSnap[]
  streetRng: number | null
}

export interface TraceEvent {
  t: number
  kind: string
  data?: Record<string, unknown>
}

export interface ReplayEdit {
  t: number
  op: 'strike' | 'ignite' | 'shoot' | 'cut' | 'place' | 'set' | 'reset'
  at?: [number, number, number]
  radius?: number
  spark?: boolean
  kind?: number
  from?: [number, number, number]
  speed?: [number, number, number]
}

export interface Anomaly {
  id: string
  t: number
  at: string
  kind: AnomalyKind
  severity: Severity
  summary: string
  where?: GeoRef
  detail: Record<string, unknown>
}

export interface PickInfo {
  distanceM: number
  cell: [number, number, number]
  material: number
  colour: number
  geo?: GeoRef
  nearVehicle?: { id: number; kind: string; name: string; distanceM: number }
}

export interface SessionSummary {
  sessionId: string
  durationS: number
  frames: number
  fpsP50: number
  fpsP95: number
  worstGapMs: number
  stalls: number
  distanceM: number
  blasts: number
  crashes: number
  nearMisses: number
  vehiclesDriven: number
  anomalyCount: number
  anomaliesByKind: Record<string, number>
  criticalCount: number
  highCount: number
}

export interface SessionTrace {
  version: 1
  kind: 'session' | 'feedback'
  sessionId: string
  startedAt: string
  capturedAt: string
  reason: string
  meta: {
    url: string
    pathname: string
    search: string
    build: string
    release: string | null
    frame: string | null
    bay: boolean
    localRealm: string | null
    viewport: [number, number]
    dpr: number
    env: Record<string, unknown>
    settings: {
      hour: number | null
      rain: number
      fog: number
      graphics: string
      scale: number
      fov: number
      hud: string | null
    }
    /** Exact rendered camera eye (metres) and look angles (radians) at snapshot time, including third-person / driving cam offset. */
    camera?: [number, number, number, number, number, number]
  }
  summary: SessionSummary
  pick?: PickInfo | null
  voxelAround?: {
    origin: [number, number, number]
    solid: number
    below: number
    above: number
    ahead: number
  } | null
  keyframes: Keyframe[]
  events: TraceEvent[]
  edits: ReplayEdit[]
  anomalies: Anomaly[]
  diagnostics?: {
    tiles?: { fetched: number; failed: number; retried: number; timedOut: number; shared: number; water: number; held: number; bytes: number }
    mover?: { ticking: boolean; waitMs: number; bodies: number; waiting: number }
    workers?: { busy: number[]; maxAskMs: number; crashed: number; lacking: number }
    notes?: string[]
  }
}

export interface FeedbackPayload extends SessionTrace {
  kind: 'feedback'
  feedback: {
    message: string
    category?: string
    pin?: [number, number] | null
  }
  screenshot?: string | null
}

/** Gameplay keys polled for black-box replay. Only keys already owned/yielded in keys.ts or non-letter controls. */
const TRACKED_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyB', 'KeyV', 'KeyR', 'KeyQ', 'KeyX',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
] as const

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const

/** Solid architectural materials (not air=0, leaves=5, road=6, grass/earth=7, water=13). */
const BUILDING_MATERIALS = new Set([1, 2, 3, 4, 8, 9, 10, 11, 12])

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Exact 2D Separating Axis Theorem penetration depth between two oriented rectangles (in cells). Positive means overlapping. */
export function obbPenetration(
  ax: number, az: number, aHeading: number, aHalfL: number, aHalfW: number,
  bx: number, bz: number, bHeading: number, bHalfL: number, bHalfW: number,
): number {
  const afx = Math.cos(aHeading), afz = Math.sin(aHeading), arx = -afz, arz = afx
  const bfx = Math.cos(bHeading), bfz = Math.sin(bHeading), brx = -bfz, brz = bfx
  const dx = bx - ax, dz = bz - az
  let maxGap = -Infinity
  const axes: [number, number][] = [[afx, afz], [arx, arz], [bfx, bfz], [brx, brz]]
  for (const [ux, uz] of axes) {
    const d = Math.abs(dx * ux + dz * uz)
    const pA = aHalfL * Math.abs(afx * ux + afz * uz) + aHalfW * Math.abs(arx * ux + arz * uz)
    const pB = bHalfL * Math.abs(bfx * ux + bfz * uz) + bHalfW * Math.abs(brx * ux + brz * uz)
    const g = d - (pA + pB)
    if (g > maxGap) maxGap = g
  }
  return -maxGap
}

/** Converts a cell position to a GeoRef (adding SF lat/lon, level-0 tile key, and 1 km square when in Bay mode). */
export function cellToGeo(cell: readonly [number, number, number], bay = BAY_ON, street?: string): GeoRef {
  const c: [number, number, number] = [Math.round(cell[0]), Math.round(cell[1]), Math.round(cell[2])]
  const out: GeoRef = { cell: c }
  if (bay) {
    const ll = latLon(c[0], c[2], FRAME)
    if (ll) out.latLon = [ll.lat, ll.lon]
    const t = tileOf(c[0], c[2])
    out.tile = t.tile
    out.square = t.square
  }
  if (street) out.street = street
  return out
}

export interface RecorderDeps {
  build: string
  localRealm: string | null
  bay: boolean
  env: () => Record<string, unknown>
  release: () => Promise<string | null>
  gpuFaults: () => readonly string[]
  input: Input
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  fov: () => number
  view: () => View
  march: Marcher
  me: Me
  alive: Living
  street: () => Street | null
  worldStats: () => { wanted: number; stale: number; ready: number; poolUsed: number; poolWords: number; full: number; crashed: number }
  mended: () => { movers: number; makers: number }
  tileFails: () => number
  perf: () => { frameMs: number; gpuMs: number; cpuMs: number; scale: number; bodies: number; loose: number; burning: number; resting: boolean; paused: boolean; mapOpen: boolean; firstStill: boolean }
  settings: () => { hour: number | null; rain: number; fog: number; graphics: string; hud: string | null }
  clock: () => number
  groundAt: (x: number, z: number) => number
  topAt: (x: number, z: number) => number
  worldKind: (x: number, y: number, z: number) => number
  whereLabel: () => string
  diagnostics?: () => NonNullable<SessionTrace['diagnostics']>
  endpointBase: string | null
}

export interface Recorder {
  readonly sessionId: string
  readonly anomalies: readonly Anomaly[]
  readonly events: readonly TraceEvent[]
  readonly keyframes: readonly Keyframe[]
  readonly edits: readonly ReplayEdit[]
  enabled: boolean
  /** Called once per animation frame in main.ts. */
  frame(dt: number, gapMs: number, now: number): void
  /** Called immediately after `device.queue.submit()` inside main.ts's frame loop so canvas captures are never blank. */
  onPresented(canvas: HTMLCanvasElement): void
  /** Records a discrete gameplay/system event into the rolling log. */
  event(kind: string, data?: Record<string, unknown>): void
  /** Records a replayable world edit/action (blast, cut, ignite, shoot, place, set, reset). */
  edit(edit: Omit<ReplayEdit, 't'>): void
  /** Records a structured checkpoint/annotation (used by automated & AI playtesters). */
  mark(name: string, data?: Record<string, unknown>): void
  /** Captures only the WebGPU `<canvas>` on the next presented frame as a WebP/PNG data URL (never captures HTML DOM). */
  captureCanvas(maxWidth?: number): Promise<string | null>
  /** Raycasts from the current view (or normalized viewport pin [u, v] in 0..1) and resolves material + geo + nearest vehicle. */
  pickAt(pin?: readonly [number, number] | null): Promise<PickInfo | null>
  /** Builds a self-contained SessionTrace snapshot of the current rolling black box. */
  snapshot(options?: { reason?: string; pick?: boolean; pin?: readonly [number, number] | null; voxelBox?: boolean }): Promise<SessionTrace>
  /** Captures a full FeedbackPayload (canvas screenshot + pick + frozen 30 s black-box trace) and optionally POSTs it to `/api/feedback`. */
  report(message: string, options?: { category?: string; pin?: readonly [number, number] | null; screenshot?: boolean; submit?: boolean; endpoint?: string }): Promise<{ payload: FeedbackPayload; sent: boolean; id?: string; error?: string }>
  /** Flushes the current session summary & trace to `/api/session`. */
  flush(reason?: string, beacon?: boolean): Promise<boolean>
  /** Concise health summary for playtests and dashboards. */
  summary(): SessionSummary
  /** Clears buffered keyframes, events, edits, anomalies, and stats (e.g. between playtest scenarios). */
  clear(): void
}

const KEYFRAME_MS = 200 // 5 Hz
const FAST_WATCH_MS = 100 // 10 Hz fast vehicle overlap / tunneling / solid check
const KEYFRAMES_MAX = 150 // 30 seconds at 5 Hz
const EVENTS_MAX = 300
const EDITS_MAX = 100
const ANOMALIES_MAX = 120
const GAPS_MAX = 600
const STUCK_SECONDS = 2.5
const STUCK_CELLS = 3.5 // 0.35 m
const OVERLAP_MIN_CELLS = 4.0 // 40 cm overlap threshold
const OVERLAP_DEEP_CELLS = 8.0 // 80 cm instant overlap / high-speed tunneling threshold
const STALL_MS = 150

export function createRecorder(deps: RecorderDeps): Recorder {
  const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const startedAt = new Date().toISOString()
  const startedMs = performance.now()

  let enabled = true
  let releaseSha: string | null = null
  void deps.release().then((r) => { releaseSha = r }, () => {})

  const keyframes: Keyframe[] = []
  const events: TraceEvent[] = []
  const edits: ReplayEdit[] = []
  const anomalies: Anomaly[] = []
  const gaps: number[] = []
  const cooldowns = new Map<string, number>()

  // Counters & state trackers
  let frames = 0
  let lastFlushedFrames = -1000
  let stalls = 0
  let worstGapMs = 0
  let distanceCells = 0
  let lastDistAt: [number, number] | null = null
  let blasts = 0
  let crashes = 0
  let nearMisses = 0
  const drivenIds = new Set<number>()
  let lastRidingId = 0

  let seenGpuFaults = 0
  let seenMoversLost = 0
  let seenMakersLost = 0
  let seenTileFails = 0
  let seenPoolFull = 0
  const seenStruck = new WeakSet<object>()

  let lastKeyMs = -Infinity
  let lastFastMs = -Infinity
  let lastWatchMs = -Infinity
  let hiddenUntil = 0

  // Stuck / solid / overlap / flip / explosion persistence trackers
  let stuckOrigin: [number, number] | null = null
  let stuckElapsed = 0
  let solidElapsed = 0
  let flippedElapsed = 0
  let lastRidePos: { id: number; at: [number, number, number] } | null = null
  const overlapStreak = new Map<string, number>()

  // Pending one-shot canvas capture callbacks resolved synchronously inside `onPresented()`
  const pendingShots: { maxWidth: number; resolve: (dataUrl: string | null) => void; timer: ReturnType<typeof setTimeout> }[] = []

  const nowT = () => Math.round(performance.now() - startedMs)

  const pushEvent = (kind: string, data?: Record<string, unknown>) => {
    if (!enabled) return
    events.push(data ? { t: nowT(), kind, data } : { t: nowT(), kind })
    if (events.length > EVENTS_MAX) events.shift()
  }

  const pushAnomaly = (
    kind: AnomalyKind,
    severity: Severity,
    summary: string,
    detail: Record<string, unknown>,
    whereCell?: readonly [number, number, number],
    cooldownKey: string = kind,
    cooldownMs = 4000,
  ) => {
    if (!enabled) return
    const t = nowT()
    const prev = cooldowns.get(cooldownKey)
    if (prev !== undefined && t - prev < cooldownMs) return
    cooldowns.set(cooldownKey, t)
    const street = deps.whereLabel() || undefined
    const a: Anomaly = {
      id: `a-${anomalies.length + 1}-${t.toString(36)}`,
      t,
      at: new Date().toISOString(),
      kind,
      severity,
      summary,
      ...(whereCell ? { where: cellToGeo(whereCell, deps.bay, street) } : {}),
      detail,
    }
    anomalies.push(a)
    if (anomalies.length > ANOMALIES_MAX) anomalies.shift()
    pushEvent('anomaly', { kind, severity, summary })
  }

  const playerCell = (): [number, number, number] => {
    const r = deps.alive.rider
    if (r) return [r.at[0], r.at[1], r.at[2]]
    const f = deps.me.feet
    if (f) return [f.at[0], f.at[1], f.at[2]]
    return [deps.pose.x * 10, deps.pose.y * 10, deps.pose.z * 10]
  }

  const sampleVoxelAround = (center: readonly [number, number, number]) => {
    const cx = Math.floor(center[0]), cy = Math.floor(center[1]), cz = Math.floor(center[2])
    let solid = 0, below = 0, above = 0, ahead = 0
    for (let dy = -3; dy <= 18; dy += 3) {
      for (let dz = -6; dz <= 6; dz += 3) {
        for (let dx = -6; dx <= 6; dx += 3) {
          const mat = deps.worldKind(cx + dx, cy + dy, cz + dz) & 15
          if (mat !== 0 && mat !== 13) solid++
        }
      }
    }
    for (let dy = 1; dy <= 10; dy++) {
      const m = deps.worldKind(cx, cy - dy, cz) & 15
      if (m !== 0 && m !== 13) below++
    }
    for (let dy = 14; dy <= 24; dy++) {
      const m = deps.worldKind(cx, cy + dy, cz) & 15
      if (m !== 0 && m !== 13) above++
    }
    const v = deps.view()
    for (let step = 4; step <= 20; step += 2) {
      const m = deps.worldKind(Math.floor(cx + v.forward[0] * step), cy + 10, Math.floor(cz + v.forward[2] * step)) & 15
      if (m !== 0 && m !== 13) ahead++
    }
    return { origin: [cx, cy, cz] as [number, number, number], solid, below, above, ahead }
  }

  const nearbyVehicles = (center: readonly [number, number, number], radius = 900): VehicleSnap[] => {
    const out: VehicleSnap[] = []
    // Always include active living bodies first so player/crashed cars are never dropped by the 24-car cap.
    for (const t of deps.alive.things) {
      if (!t.alive) continue
      const w = deps.alive.where(t)
      if (!w || Math.hypot(w.at[0] - center[0], w.at[2] - center[2]) >= radius) continue
      const heading = Math.atan2(w.front[2], w.front[0])
      const long = t.motor.front < 2 ? t.size[0] : t.size[2]
      const wide = t.motor.front < 2 ? t.size[2] : t.size[0]
      out.push({
        id: -t.id, // negative IDs distinguish core living bodies from street.ts vehicles
        kind: 'living',
        model: t.controls ?? 'drive',
        name: t.name,
        x: r1(w.at[0]), y: r1(w.at[1]), z: r1(w.at[2]),
        heading: r3(heading),
        v: r1(Math.abs(t.state?.speed ?? 0)),
        long, wide,
        road: '', lane: 0, s: 0, wait: '', stuck: 0, blocked: false, living: true,
      })
    }
    const st = deps.street()
    if (st) {
      const snaps = st.snapshot(center[0], center[2], radius)
      snaps.sort((a, b) => Math.hypot(a.x - center[0], a.z - center[2]) - Math.hypot(b.x - center[0], b.z - center[2]))
      for (const s of snaps) {
        if (out.length >= 24) break
        out.push(s)
      }
    }
    return out
  }

  // Global browser error & gameplay event listeners
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
      const msg = e.message || String(e.error || 'script error')
      const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ''
      pushEvent('error', { message: msg.slice(0, 300), source: where.slice(0, 200) })
      pushAnomaly('runtime_error', 'critical', `Runtime error: ${msg.slice(0, 140)}`, { message: msg.slice(0, 500), source: where, stack: String(e.error?.stack ?? '').slice(0, 800) }, playerCell(), `runtime_error:${msg.slice(0, 80)}`, 3000)
    })
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'unhandled rejection')
      const stack = e.reason instanceof Error ? String(e.reason.stack ?? '') : ''
      pushEvent('unhandledrejection', { message: reason.slice(0, 300) })
      pushAnomaly('runtime_error', 'critical', `Unhandled rejection: ${reason.slice(0, 140)}`, { message: reason.slice(0, 500), stack: stack.slice(0, 800) }, playerCell(), `rejection:${reason.slice(0, 80)}`, 3000)
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenUntil = performance.now() + 2000
      else hiddenUntil = performance.now() + 1500
      pushEvent('visibility', { state: document.visibilityState })
    })
    window.addEventListener('voxelwright:crash', (e) => {
      crashes++
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined
      pushEvent('crash', detail ?? {})
    })
    window.addEventListener('voxelwright:nearmiss', (e) => {
      nearMisses++
      const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined
      pushEvent('nearmiss', detail ?? {})
    })
    window.addEventListener('pagehide', () => {
      if (enabled && deps.endpointBase !== null && frames - lastFlushedFrames >= 30 && (frames > 60 || anomalies.length > 0)) {
        void self.flush('pagehide', true)
      }
    })
  }

  const checkAnomalies = (dt: number, now: number, cars: VehicleSnap[]) => {
    const p = deps.perf()
    const stats = deps.worldStats()
    const mend = deps.mended()
    const center = playerCell()

    // 1. GPU faults
    const gFaults = deps.gpuFaults()
    if (gFaults.length > seenGpuFaults) {
      for (let i = seenGpuFaults; i < gFaults.length; i++) {
        const msg = gFaults[i]
        pushEvent('gpu_fault', { message: msg })
        pushAnomaly('gpu_fault', 'critical', `WebGPU fault: ${msg.slice(0, 140)}`, { message: msg }, center, `gpu_fault:${msg.slice(0, 60)}`, 2000)
      }
      seenGpuFaults = gFaults.length
    }

    // 2. Worker crashes / restarts
    if (mend.movers > seenMoversLost) {
      seenMoversLost = mend.movers
      pushEvent('worker_lost', { which: 'mover', count: mend.movers })
      pushAnomaly('worker_lost', 'high', `Mover physics worker crashed (${mend.movers})`, { which: 'mover', count: mend.movers }, center, 'worker_lost:mover', 2000)
    }
    if (mend.makers > seenMakersLost) {
      seenMakersLost = mend.makers
      pushEvent('worker_lost', { which: 'maker', count: mend.makers })
      pushAnomaly('worker_lost', 'high', `Sector maker worker crashed (${mend.makers})`, { which: 'maker', count: mend.makers }, center, 'worker_lost:maker', 2000)
    }

    // 3. GPU tree pool exhaustion
    if (stats.full > seenPoolFull) {
      const delta = stats.full - seenPoolFull
      seenPoolFull = stats.full
      pushAnomaly('pool_exhausted', 'high', `GPU sector pool full (${stats.full} sectors did not fit)`, { full: stats.full, delta, poolUsed: stats.poolUsed, poolWords: stats.poolWords }, center, 'pool_exhausted', 8000)
    }

    // 4. Tile load failures
    const tFails = deps.tileFails()
    if (tFails > seenTileFails) {
      const delta = tFails - seenTileFails
      seenTileFails = tFails
      pushAnomaly('tile_load_failure', 'medium', `Tile load failed (${tFails} total)`, { failed: tFails, delta }, center, 'tile_load_failure', 8000)
    }

    // 5. NaN / non-finite state check
    const riding = deps.alive.riding
    const rw = riding ? deps.alive.where(riding) : null
    const f = deps.me.feet
    const badPose = ![deps.pose.x, deps.pose.y, deps.pose.z, deps.pose.yaw, deps.pose.pitch].every(Number.isFinite)
    const badFoot = !!f && !f.at.every(Number.isFinite)
    const badRide = !!rw && (!rw.at.every(Number.isFinite) || !rw.rot.every(Number.isFinite))
    if (badPose || badFoot || badRide) {
      pushAnomaly('nan_state', 'critical', 'Non-finite (NaN/Infinity) world state detected', { badPose, badFoot, badRide, pose: { ...deps.pose }, foot: f?.at, ride: rw?.at }, undefined, 'nan_state', 3000)
      return
    }

    // 6. Fell through ground / out of world
    if (f || rw) {
      const cx = Math.round(center[0]), cz = Math.round(center[2])
      const ground = deps.groundAt(cx, cz)
      const topMat = deps.topAt(cx, cz) & 15
      const isWater = topMat === 13 || ground <= 2
      if (center[1] < -500 || (!isWater && Number.isFinite(ground) && center[1] < ground - 30)) {
        pushAnomaly(
          'fell_under_ground',
          'critical',
          `${rw ? 'Vehicle' : 'Player'} fell ${(Math.round(ground - center[1]) / 10).toFixed(1)} m below ground`,
          { y: r1(center[1]), ground: r1(ground), topMat, riding: !!rw, vehicle: riding?.name ?? null },
          center,
          'fell_under_ground',
          4000,
        )
      }
    }

    // 7. On-foot inside solid voxel
    if (deps.me.on && f && !riding && !p.paused && !p.firstStill) {
      const fx = Math.floor(f.at[0]), fy = Math.floor(f.at[1]), fz = Math.floor(f.at[2])
      const chest = deps.worldKind(fx, fy + 10, fz) & 15
      const head = deps.worldKind(fx, fy + 15, fz) & 15
      const buried = chest !== 0 && chest !== 13 && head !== 0 && head !== 13
      solidElapsed = buried ? solidElapsed + dt : 0
      if (solidElapsed >= 0.6) {
        pushAnomaly(
          'inside_solid',
          'high',
          `Player body embedded inside solid voxels (chest mat ${chest}, head mat ${head})`,
          { feet: f.at.map(r1), chestMat: chest, headMat: head, around: sampleVoxelAround(f.at) },
          f.at,
          'inside_solid',
          5000,
        )
      }
    } else {
      solidElapsed = 0
    }

    // 8. Player stuck detector (holding movement input while going nowhere)
    const activePlay = !p.paused && !p.resting && !p.mapOpen && !p.firstStill && (deps.me.on || !!riding) && !['typing', 'feedback', 'choosing', 'connect', 'lobbies'].includes(deps.input.top)
    if (activePlay) {
      const stick = deps.input.stick
      const holdingMove = MOVE_KEYS.some((k) => deps.input.held(k)) || Math.hypot(stick[0], stick[1]) > 0.4
      const handbraking = !!riding && (deps.input.held('Space') || (deps.alive.telemetry?.burnout ?? 0) > 0.1)
      if (holdingMove && !handbraking) {
        if (!stuckOrigin) {
          stuckOrigin = [center[0], center[2]]
          stuckElapsed = 0
        } else {
          const moved = Math.hypot(center[0] - stuckOrigin[0], center[2] - stuckOrigin[1])
          if (moved >= STUCK_CELLS) {
            stuckOrigin = [center[0], center[2]]
            stuckElapsed = 0
          } else {
            stuckElapsed += dt
            if (stuckElapsed >= STUCK_SECONDS) {
              pushAnomaly(
                'player_stuck',
                'high',
                `${riding ? `Vehicle "${riding.name}"` : 'Player'} stuck for ${stuckElapsed.toFixed(1)} s while holding movement input`,
                {
                  seconds: r1(stuckElapsed),
                  movedCells: r1(moved),
                  riding: !!riding,
                  vehicle: riding?.name ?? null,
                  held: TRACKED_KEYS.filter((k) => deps.input.held(k)),
                  around: sampleVoxelAround(center),
                },
                center,
                'player_stuck',
                6000,
              )
              stuckElapsed = 0
              stuckOrigin = [center[0], center[2]]
            }
          }
        }
      } else {
        stuckOrigin = null
        stuckElapsed = 0
      }
    } else {
      stuckOrigin = null
      stuckElapsed = 0
    }

    // 10. Record high-impulse solver impacts from `alive.struck`
    for (const s of deps.alive.struck) {
      if (seenStruck.has(s)) continue
      seenStruck.add(s)
      if (s.speed >= 25) {
        pushEvent('impact', { a: s.a, b: s.b, speed: r1(s.speed), push: r1(s.push), flags: s.flags, at: s.at.map(r1) })
        if (riding && s.speed >= 35 && (s.a === riding.id || s.b === riding.id)) {
          crashes++
        }
      }
    }
  }

  // Fast 10 Hz vehicle invariants (overlap / tunneling, 5-point building clipping, floating/sunk, flipped, explosion)
  const checkVehiclesFast = (fastDt: number, cars: VehicleSnap[]) => {
      const riding = deps.alive.riding
      const rw = riding ? deps.alive.where(riding) : null

      // 9a. Ridden vehicle flipped upside-down or physics explosion
      if (riding && rw && rw.at.every(Number.isFinite) && rw.rot.every(Number.isFinite)) {
        const upY = 1 - 2 * (rw.rot[0] * rw.rot[0] + rw.rot[2] * rw.rot[2])
        const speed = Math.abs(riding.state?.speed ?? 0)
        if (upY < -0.35 && speed < 8) {
          flippedElapsed += fastDt
          if (flippedElapsed >= 2.0) {
            pushAnomaly(
              'vehicle_flipped',
              'medium',
              `Vehicle "${riding.name}" rolled over / upside down for ${flippedElapsed.toFixed(1)} s`,
              { id: riding.id, name: riding.name, upY: r2(upY), speed: r1(speed), at: rw.at.map(r1) },
              rw.at,
              `vehicle_flipped:${riding.id}`,
              8000,
            )
            flippedElapsed = 0
          }
        } else {
          flippedElapsed = 0
        }

        if (speed > 1100) {
          pushAnomaly(
            'physics_explosion',
            'critical',
            `Vehicle "${riding.name}" hit impossible speed ${Math.round(speed * 0.36)} km/h`,
            { id: riding.id, name: riding.name, speedCells: r1(speed), kmh: Math.round(speed * 0.36), at: rw.at.map(r1) },
            rw.at,
            `physics_explosion:speed:${riding.id}`,
            4000,
          )
        }
        if (lastRidePos && lastRidePos.id === riding.id && fastDt > 0 && fastDt < 0.25) {
          const jump = Math.hypot(rw.at[0] - lastRidePos.at[0], rw.at[1] - lastRidePos.at[1], rw.at[2] - lastRidePos.at[2])
          if (jump > 200) { // > 20 m in <= 0.1 s = > 720 km/h instantaneous teleport/launch
            pushAnomaly(
              'physics_explosion',
              'critical',
              `Vehicle "${riding.name}" jumped ${(jump / 10).toFixed(1)} m in ${Math.round(fastDt * 1000)} ms`,
              { id: riding.id, name: riding.name, jumpCells: r1(jump), dtMs: Math.round(fastDt * 1000), from: lastRidePos.at.map(r1), to: rw.at.map(r1) },
              rw.at,
              `physics_explosion:jump:${riding.id}`,
              4000,
            )
          }
        }
        lastRidePos = { id: riding.id, at: [rw.at[0], rw.at[1], rw.at[2]] }
      } else {
        flippedElapsed = 0
        lastRidePos = null
      }

      // 9b. Vehicle-vehicle overlap / high-speed tunneling, 5-point building clipping, floating/sunk
      const activePairs = new Set<string>()
      const checkable = cars.filter((c) => !(c.kind !== 'living' && c.living))
      for (let i = 0; i < checkable.length; i++) {
        const a = checkable[i]
        // Traffic car stuck / gridlocked on unblocked road
        if (a.kind === 'traffic' && a.stuck > 12 && !a.blocked && !['lights', 'stop sign', 'bus stop', 'blast', 'person', 'queue'].includes(a.wait)) {
          pushAnomaly(
            'vehicle_stuck',
            'medium',
            `Traffic ${a.name} stuck ${a.stuck.toFixed(1)} s on road ${a.road || '?'} (wait: ${a.wait || 'none'})`,
            { id: a.id, name: a.name, model: a.model, road: a.road, lane: a.lane, s: a.s, stuck: a.stuck, wait: a.wait },
            [a.x, a.y, a.z],
            `vehicle_stuck:${a.id}`,
            15000,
          )
        }

        // 5-point solid building intrusion check (living cars at any speed + moving traffic cars)
        if (a.kind === 'living' || (a.kind === 'traffic' && a.v > 2)) {
          const fx = Math.cos(a.heading), fz = Math.sin(a.heading)
          const rx = -fz, rz = fx
          const hl = a.long * 0.38, hw = a.wide * 0.38
          const by = Math.floor(a.kind === 'living' ? a.y : a.y + 8)
          const pts: [number, number][] = [
            [a.x, a.z],
            [a.x + fx * hl + rx * hw, a.z + fz * hl + rz * hw],
            [a.x + fx * hl - rx * hw, a.z + fz * hl - rz * hw],
            [a.x - fx * hl + rx * hw, a.z - fz * hl + rz * hw],
            [a.x - fx * hl - rx * hw, a.z - fz * hl - rz * hw],
          ]
          let hitMat = 0, hitPts = 0
          for (const [px, pz] of pts) {
            const m = deps.worldKind(Math.floor(px), by, Math.floor(pz)) & 15
            if (BUILDING_MATERIALS.has(m)) { hitMat = m; hitPts++ }
          }
          // Require >= 2 sample points inside building voxels (or center embedded) so grazing a kerb never false-positives
          const centerMat = deps.worldKind(Math.floor(a.x), by, Math.floor(a.z)) & 15
          if (BUILDING_MATERIALS.has(centerMat) || hitPts >= 2) {
            pushAnomaly(
              'vehicle_in_solid',
              'high',
              `Vehicle ${a.name} [${a.kind}] embedded in solid building (mat ${hitMat}, ${hitPts}/5 pts)`,
              { id: a.id, kind: a.kind, name: a.name, model: a.model, road: a.road, v: a.v, material: hitMat, hitPts },
              [a.x, a.y, a.z],
              `vehicle_in_solid:${a.id}`,
              6000,
            )
          }
        }

        // Street vehicle floating in mid-air or sunk deep into terrain
        if (a.kind === 'traffic' || a.kind === 'parked') {
          const g = deps.groundAt(Math.round(a.x), Math.round(a.z))
          const topMat = deps.topAt(Math.round(a.x), Math.round(a.z)) & 15
          if (Number.isFinite(g) && topMat !== 13) {
            const dy = a.y - g
            if (dy < -8) {
              pushAnomaly(
                'vehicle_ground_glitch',
                'medium',
                `${a.kind} ${a.name} sunk ${(Math.abs(dy) / 10).toFixed(1)} m into ground`,
                { id: a.id, kind: a.kind, name: a.name, model: a.model, road: a.road, y: a.y, ground: r1(g), deltaCells: r1(dy) },
                [a.x, a.y, a.z],
                `vehicle_ground_glitch:${a.id}`,
                15000,
              )
            } else if (dy > 12) {
              // Confirm empty air below wheels (not standing on a bridge/overpass deck)
              let support = false
              for (let k = 1; k <= 8; k++) {
                if ((deps.worldKind(Math.floor(a.x), Math.floor(a.y) - k, Math.floor(a.z)) & 15) !== 0) { support = true; break }
              }
              if (!support) {
                pushAnomaly(
                  'vehicle_ground_glitch',
                  'medium',
                  `${a.kind} ${a.name} floating ${(dy / 10).toFixed(1)} m above ground`,
                  { id: a.id, kind: a.kind, name: a.name, model: a.model, road: a.road, y: a.y, ground: r1(g), deltaCells: r1(dy) },
                  [a.x, a.y, a.z],
                  `vehicle_ground_glitch:${a.id}`,
                  15000,
                )
              }
            }
          }
        }

        // Pairwise 2D SAT overlap / high-speed pass-through detection
        for (let j = i + 1; j < checkable.length; j++) {
          const b = checkable[j]
          if (Math.abs(a.x - b.x) > 120 || Math.abs(a.z - b.z) > 120 || Math.abs(a.y - b.y) > 25) continue
          if (a.kind === 'parked' && b.kind === 'parked') continue
          const pen = obbPenetration(a.x, a.z, a.heading, a.long * 0.5, a.wide * 0.5, b.x, b.z, b.heading, b.long * 0.5, b.wide * 0.5)
          if (pen >= OVERLAP_MIN_CELLS) {
            const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
            activePairs.add(pairKey)
            const streak = (overlapStreak.get(pairKey) ?? 0) + 1
            overlapStreak.set(pairKey, streak)
            // Deep overlap (>= 0.8 m) fires immediately to catch high-speed tunneling; >= 0.4 m requires 2 ticks (0.2 s)
            if (pen >= OVERLAP_DEEP_CELLS || streak >= 2) {
              const mid: [number, number, number] = [(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5]
              pushAnomaly(
                'vehicle_overlap',
                'high',
                `Vehicles overlapping (${a.name} [${a.kind}] & ${b.name} [${b.kind}], depth ${(pen / 10).toFixed(2)} m)`,
                {
                  penetrationCells: r1(pen),
                  streak,
                  a: { id: a.id, kind: a.kind, model: a.model, name: a.name, x: a.x, y: a.y, z: a.z, heading: a.heading, v: a.v, road: a.road, lane: a.lane, s: a.s },
                  b: { id: b.id, kind: b.kind, model: b.model, name: b.name, x: b.x, y: b.y, z: b.z, heading: b.heading, v: b.v, road: b.road, lane: b.lane, s: b.s },
                },
                mid,
                `vehicle_overlap:${pairKey}`,
                5000,
              )
            }
          }
        }
      }
      for (const k of overlapStreak.keys()) if (!activePairs.has(k)) overlapStreak.delete(k)
  }

  const self: Recorder = {
    sessionId,
    get anomalies() { return anomalies },
    get events() { return events },
    get keyframes() { return keyframes },
    get edits() { return edits },
    get enabled() { return enabled },
    set enabled(v: boolean) { enabled = v },

    frame(dt, gapMs, now) {
      if (!enabled) return
      frames++
      const p = deps.perf()
      const active = !p.paused && !p.resting && !p.mapOpen && now > hiddenUntil
      if (active) {
        gaps.push(gapMs)
        if (gaps.length > GAPS_MAX) gaps.shift()
        if (gapMs > worstGapMs) worstGapMs = gapMs
        if (gapMs > STALL_MS && now - startedMs > 3000) {
          stalls++
          pushAnomaly(
            'frame_stall',
            'medium',
            `Frame stall ${Math.round(gapMs)} ms (gpu ${p.gpuMs.toFixed(1)} ms, bodies ${p.bodies})`,
            { gapMs: r1(gapMs), gpuMs: r1(p.gpuMs), cpuMs: r1(p.cpuMs), scale: r2(p.scale), bodies: p.bodies, loose: p.loose },
            playerCell(),
            'frame_stall',
            5000,
          )
        }
      }

      // Track vehicle mount / dismount transitions
      const riding = deps.alive.riding
      const rid = riding?.id ?? 0
      if (rid !== lastRidingId) {
        if (rid && riding) {
          drivenIds.add(rid)
          const w = deps.alive.where(riding)
          pushEvent('mount', { id: rid, name: riding.name, ref: riding.ref, at: w?.at.map(r1) })
        } else if (lastRidingId) {
          pushEvent('dismount', { id: lastRidingId, at: playerCell().map(r1) })
        }
        lastRidingId = rid
      }

      // Distance traveled
      const c = playerCell()
      if (Number.isFinite(c[0]) && Number.isFinite(c[2])) {
        if (lastDistAt) {
          const step = Math.hypot(c[0] - lastDistAt[0], c[2] - lastDistAt[1])
          if (step < 500) distanceCells += step
        }
        lastDistAt = [c[0], c[2]]
      }

      // 10 Hz fast vehicle overlap / tunneling / solid check, sharing `cars` on 5 Hz keyframe ticks
      const wantKey = now - lastKeyMs >= KEYFRAME_MS
      const wantFast = now - lastFastMs >= FAST_WATCH_MS
      if (wantKey || wantFast) {
        const cars = nearbyVehicles(c, 900)
        if (wantFast) {
          const fastDt = lastFastMs > 0 ? Math.min(0.5, (now - lastFastMs) / 1000) : dt
          lastFastMs = now
          checkVehiclesFast(fastDt, cars)
        }
        if (wantKey) {
          const watchDt = lastWatchMs > 0 ? Math.min(1, (now - lastWatchMs) / 1000) : dt
          lastKeyMs = now
          lastWatchMs = now
          const stats = deps.worldStats()
          const f = deps.me.feet
          const rw = riding ? deps.alive.where(riding) : null
          const tel = deps.alive.telemetry
          const dmg = riding ? deps.alive.damage(riding) : null
          const held = ['typing', 'feedback'].includes(deps.input.top) ? [] : TRACKED_KEYS.filter((k) => deps.input.held(k))
          const st = deps.street()

          keyframes.push({
            t: nowT(),
            dt: r1(dt * 1000),
            clock: r2(deps.clock()),
            mode: riding ? 'riding' : deps.me.on ? 'foot' : 'flying',
            inputTop: deps.input.top,
            pose: [r2(deps.pose.x), r2(deps.pose.y), r2(deps.pose.z), r3(deps.pose.yaw), r3(deps.pose.pitch), r1(deps.fov())],
            input: { held, stick: [r2(deps.input.stick[0]), r2(deps.input.stick[1])] },
            foot: f ? { at: [r1(f.at[0]), r1(f.at[1]), r1(f.at[2])], yaw: r3(f.yaw), speed: r1(f.speed), aloft: deps.me.aloft, canopy: deps.me.canopy } : null,
            ride: riding && rw ? {
              id: riding.id, name: riding.name, ...(riding.ref ? { ref: riding.ref } : {}),
              at: [r1(rw.at[0]), r1(rw.at[1]), r1(rw.at[2])],
              rot: [r3(rw.rot[0]), r3(rw.rot[1]), r3(rw.rot[2]), r3(rw.rot[3])],
              front: [r3(rw.front[0]), r3(rw.front[1]), r3(rw.front[2])],
              kmh: r1(tel?.kmh ?? Math.abs(riding.state?.speed ?? 0) * 0.36),
              gear: tel?.gear ?? 0, rpm: r2(tel?.rpm ?? 0), slip: r2(tel?.slip ?? 0),
              drifting: !!tel?.drifting, surface: tel?.surface ?? 'paved',
              dents: dmg?.dentCount ?? 0,
            } : null,
            perf: {
              frameMs: r1(p.frameMs), gpuMs: r1(p.gpuMs), cpuMs: r1(p.cpuMs), scale: r2(p.scale),
              wanted: stats.wanted, stale: stats.stale,
              poolPct: stats.poolWords ? Math.round((stats.poolUsed / stats.poolWords) * 100) : 0,
              poolFull: stats.full, bodies: p.bodies, loose: p.loose, burning: p.burning,
            },
            cars,
            streetRng: st ? st.rng : null,
          })
          if (keyframes.length > KEYFRAMES_MAX) keyframes.shift()

          checkAnomalies(watchDt, now, cars)
        }
      }
    },

    onPresented(canvas) {
      if (!pendingShots.length) return
      const todo = pendingShots.splice(0)
      for (const req of todo) {
        clearTimeout(req.timer)
        try {
          const sw = canvas.width, sh = canvas.height
          if (sw < 2 || sh < 2) { req.resolve(null); continue }
          const scale = sw > req.maxWidth ? req.maxWidth / sw : 1
          const dw = Math.max(2, Math.round(sw * scale)), dh = Math.max(2, Math.round(sh * scale))
          const out = document.createElement('canvas')
          out.width = dw; out.height = dh
          const ctx = out.getContext('2d')
          if (!ctx) { req.resolve(null); continue }
          ctx.drawImage(canvas, 0, 0, dw, dh)
          let url = out.toDataURL('image/webp', 0.82)
          if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/png')
          req.resolve(url)
        } catch {
          req.resolve(null)
        }
      }
    },

    event(kind, data) {
      pushEvent(kind, data)
    },

    edit(e) {
      if (!enabled) return
      if (e.op === 'strike') blasts++
      const rec: ReplayEdit = { t: nowT(), ...e }
      edits.push(rec)
      if (edits.length > EDITS_MAX) edits.shift()
      pushEvent(`edit:${e.op}`, { at: e.at, radius: e.radius })
    },

    mark(name, data) {
      pushEvent('marker', { name, ...(data ?? {}) })
    },

    captureCanvas(maxWidth = 960) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const i = pendingShots.findIndex((p) => p.resolve === resolve)
          if (i >= 0) pendingShots.splice(i, 1)
          resolve(null)
        }, 2500)
        pendingShots.push({ maxWidth, resolve, timer })
      })
    },

    async pickAt(pin = null) {
      const base = deps.view()
      let v = base
      if (pin && Number.isFinite(pin[0]) && Number.isFinite(pin[1])) {
        const aspect = innerWidth / Math.max(1, innerHeight)
        const nx = (pin[0] * 2 - 1) * base.tanHalf * aspect
        const ny = (1 - pin[1] * 2) * base.tanHalf
        const fx = base.forward[0] + base.right[0] * nx + base.up[0] * ny
        const fy = base.forward[1] + base.right[1] * nx + base.up[1] * ny
        const fz = base.forward[2] + base.right[2] * nx + base.up[2] * ny
        const len = Math.hypot(fx, fy, fz) || 1
        v = { ...base, forward: [fx / len, fy / len, fz / len] }
      }
      const hit = await deps.march.pick(v).catch(() => null)
      if (!hit) return null
      const cell: [number, number, number] = [
        Math.floor(v.eye[0] + v.forward[0] * (hit.t + 0.3)),
        Math.floor(v.eye[1] + v.forward[1] * (hit.t + 0.3)),
        Math.floor(v.eye[2] + v.forward[2] * (hit.t + 0.3)),
      ]
      const cars = nearbyVehicles(cell, 200)
      let nearVehicle: PickInfo['nearVehicle']
      let bestD = Infinity
      for (const c of cars) {
        const d = Math.hypot(c.x - cell[0], c.z - cell[2])
        if (d < bestD && d < 120) {
          bestD = d
          nearVehicle = { id: c.id, kind: c.kind, name: c.name, distanceM: r1(d / 10) }
        }
      }
      return {
        distanceM: r1(hit.t / 10),
        cell,
        material: hit.material,
        colour: hit.colour,
        geo: cellToGeo(cell, deps.bay, deps.whereLabel() || undefined),
        ...(nearVehicle ? { nearVehicle } : {}),
      }
    },

    summary() {
      const sorted = [...gaps].sort((a, b) => a - b)
      const p50Gap = sorted.length ? sorted[sorted.length >> 1] : 16.7
      const p95Gap = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 16.7
      const byKind: Record<string, number> = {}
      let criticalCount = 0, highCount = 0
      for (const a of anomalies) {
        byKind[a.kind] = (byKind[a.kind] ?? 0) + 1
        if (a.severity === 'critical') criticalCount++
        if (a.severity === 'high') highCount++
      }
      return {
        sessionId,
        durationS: r1((performance.now() - startedMs) / 1000),
        frames,
        fpsP50: p50Gap > 0 ? Math.round(1000 / p50Gap) : 0,
        fpsP95: p95Gap > 0 ? Math.round(1000 / p95Gap) : 0,
        worstGapMs: r1(worstGapMs),
        stalls,
        distanceM: r1(distanceCells / 10),
        blasts,
        crashes,
        nearMisses,
        vehiclesDriven: drivenIds.size,
        anomalyCount: anomalies.length,
        anomaliesByKind: byKind,
        criticalCount,
        highCount,
      }
    },

    async snapshot(options = {}) {
      const p = deps.perf()
      const s = deps.settings()
      const v = deps.view()
      const camYaw = Math.atan2(v.forward[0], -v.forward[2])
      const camPitch = Math.asin(Math.max(-1, Math.min(1, v.forward[1])))
      const pick = options.pick ? await self.pickAt(options.pin ?? null) : null
      const voxelAround = options.voxelBox ? sampleVoxelAround(playerCell()) : null
      return {
        version: 1,
        kind: 'session',
        sessionId,
        startedAt,
        capturedAt: new Date().toISOString(),
        reason: options.reason ?? 'snapshot',
        meta: {
          url: location.href,
          pathname: location.pathname,
          search: location.search,
          build: deps.build,
          release: releaseSha,
          frame: deps.bay ? FRAME : null,
          bay: deps.bay,
          localRealm: deps.localRealm,
          viewport: [innerWidth, innerHeight],
          dpr: devicePixelRatio,
          env: deps.env(),
          settings: {
            hour: s.hour,
            rain: r2(s.rain),
            fog: r2(s.fog),
            graphics: s.graphics,
            scale: r2(p.scale),
            fov: r1(deps.fov()),
            hud: s.hud,
          },
          camera: [r2(v.eye[0] / 10), r2(v.eye[1] / 10), r2(v.eye[2] / 10), r3(camYaw), r3(camPitch), r1(deps.fov())],
        },
        summary: self.summary(),
        pick,
        voxelAround,
        keyframes: [...keyframes],
        events: [...events],
        edits: [...edits],
        anomalies: [...anomalies],
        ...(deps.diagnostics ? { diagnostics: deps.diagnostics() } : {}),
      }
    },

    async report(message, options = {}) {
      const wantShot = options.screenshot !== false
      const [trace, shot] = await Promise.all([
        self.snapshot({ reason: 'feedback', pick: true, pin: options.pin ?? null, voxelBox: true }),
        wantShot ? self.captureCanvas(960) : Promise.resolve(null),
      ])
      const payload: FeedbackPayload = {
        ...trace,
        kind: 'feedback',
        feedback: {
          message: String(message ?? '').trim().slice(0, 2000),
          ...(options.category ? { category: options.category } : {}),
          ...(options.pin ? { pin: [r3(options.pin[0]), r3(options.pin[1])] } : {}),
        },
        screenshot: shot,
      }
      pushEvent('feedback', { message: payload.feedback.message.slice(0, 140), category: payload.feedback.category })
      const endpoint = options.endpoint ?? (deps.endpointBase !== null ? `${deps.endpointBase}/api/feedback` : null)
      if (options.submit === false || !endpoint) return { payload, sent: false }
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) return { payload, sent: false, error: `server answered ${res.status}` }
        const body = await res.json().catch(() => ({})) as { id?: string }
        return { payload, sent: true, id: body.id }
      } catch (e) {
        return { payload, sent: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async flush(reason = 'manual', beacon = false) {
      if (deps.endpointBase === null) return false
      const trace = await self.snapshot({ reason, pick: false, voxelBox: false })
      const url = `${deps.endpointBase}/api/session`
      let body = JSON.stringify(trace)
      // Browser sendBeacon / keepalive has a strict 64 KiB body limit: trim older keyframes on unload beacons only.
      if (beacon && body.length > 58_000) {
        const compact = { ...trace, keyframes: trace.keyframes.slice(-25), events: trace.events.slice(-60) }
        body = JSON.stringify(compact)
        if (body.length > 58_000) body = JSON.stringify({ ...compact, keyframes: compact.keyframes.slice(-8) })
      }
      if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
          if (ok) lastFlushedFrames = frames
          return ok
        } catch { return false }
      }
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, ...(beacon ? { keepalive: true } : {}) })
        if (res.ok) lastFlushedFrames = frames
        return res.ok
      } catch {
        return false
      }
    },

    clear() {
      keyframes.length = 0
      events.length = 0
      edits.length = 0
      anomalies.length = 0
      gaps.length = 0
      cooldowns.clear()
      overlapStreak.clear()
      frames = 0
      stalls = 0
      worstGapMs = 0
      distanceCells = 0
      lastDistAt = null
      blasts = 0
      crashes = 0
      nearMisses = 0
      drivenIds.clear()
      stuckOrigin = null
      stuckElapsed = 0
      solidElapsed = 0
      flippedElapsed = 0
      lastRidePos = null
      lastFastMs = -Infinity
    },
  }

  return self
}
