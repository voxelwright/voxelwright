// Driving Stunt & Combo System (#30): rewards drifts, San Francisco hill jumps, 180/360 J-turns,
// traffic near-misses (`voxelwright:nearmiss`), and sustained high-speed runs with a Forza Horizon /
// Burnout-style x1..x5 combo chain, 2.8s grace timer, crisp banking chime, bust on hard crashes,
// and localStorage personal bests. Zero CPU/DOM overhead when parked or not driving.
import type { Hud } from './hud.ts'
import type { Living } from './living.ts'
import type { Struck } from './told.ts'
import { BUS, type Sound } from './sound/sound.ts'
import type { Patch } from './sound/patch.ts'

export type StuntKind = 'drift' | 'air' | 'spin' | 'nearmiss' | 'speed'
export type StuntPhase = 'idle' | 'active' | 'banked' | 'busted'

export interface StuntEvent {
  kind: StuntKind
  label: string
  points: number
}

export interface StuntRecords {
  bestCombo: number
  longestDrift: number
  biggestJump: number
  totalBanked: number
}

export interface StuntState {
  phase: StuntPhase
  score: number
  basePoints: number
  multiplier: number
  grace: number
  graceMax: number
  label: string
  chain: readonly StuntEvent[]
  drifting: boolean
  driftPoints: number
  driftDistance: number
  airborne: boolean
  airTime: number
  airDistance: number
  lastBanked: number
  lastBusted: number
  newBest: boolean
  records: StuntRecords
}

export interface StuntSample {
  driving: boolean
  dt: number
  kmh: number
  slip: number
  drifting: boolean
  feet: number
  at: readonly [number, number, number]
  rot: readonly [number, number, number, number]
  front: readonly [number, number, number]
  impacts?: readonly number[]
}

export interface NearMissDetail {
  speedKmh?: number
  kmh?: number
  speed?: number
  distance?: number
  clearance?: number
  label?: string
}

export type StuntFeedback = (
  kind: 'stunt' | 'tier' | 'bank' | 'bust',
  meta?: { score?: number; multiplier?: number; newBest?: boolean },
) => void

export interface StuntEngine {
  step(sample: StuntSample): void
  stepIdle(dt: number, dismounted?: boolean): void
  nearMiss(detail?: NearMissDetail): boolean
  bust(): boolean
  bank(): number
  resetSession(): void
  readonly phase: StuntPhase
  readonly state: StuntState
  readonly records: StuntRecords
  onFeedback: StuntFeedback | null
}

export interface Stunts {
  frame(dt: number): void
  nearMiss(detail?: NearMissDetail): boolean
  bust(): boolean
  bank(): number
  reset(): void
  destroy(): void
  readonly state: StuntState
  readonly records: StuntRecords
  readonly panel: HTMLElement
  readonly engine: StuntEngine
}

const STORAGE_KEY = 'voxelwright.stunts.v1'
const GRACE_SECONDS = 2.8
const MAX_MULTIPLIER = 5
const BUST_IMPACT_SPEED = 45 // cells/s (4.5 m/s hard wall/car impact)
const BANK_BANNER_SECONDS = 1.65
const BUST_BANNER_SECONDS = 1.5
const FADE_TAIL_SECONDS = 0.32
const DRIFT_MIN_TIME = 0.22
const DRIFT_MIN_POINTS = 25
const DRIFT_BREAK_GRACE = 0.18
const AIR_MIN_TIME = 0.35
const SPEED_DEMON_KMH = 130
const SPEED_RESET_KMH = 118
const NEARMISS_COOLDOWN = 0.35

// Subtle, musical sound patches in D major (matching Voxelwright's music key in sound/music)
// played through the engine's AudioWorklet ceiling limiter — never loud or harsh.
const BANK_CHIME: Patch = {
  how: 'struck', hard: 0.32, rough: 0.04, shape: 'bar',
  pitch: 587.33, ring: 0.52, damp: 0.45, where: 0.35, gain: 0.26,
}
const TIER_TICK: Patch = {
  how: 'struck', hard: 0.28, rough: 0.05, shape: 'bar',
  pitch: 659.25, ring: 0.24, damp: 0.55, where: 0.35, gain: 0.16,
}
const BUST_TONE: Patch = {
  how: 'struck', hard: 0.18, rough: 0.25, shape: 'lump',
  pitch: 128, ring: 0.22, damp: 0.85, gain: 0.22,
}
const TIER_PITCHES = [587.33, 659.25, 739.99, 880, 987.77] // D5, E5, F#5, A5, B5

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

const fmtScore = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('en-US')

const readRecords = (storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string): StuntRecords => {
  const empty: StuntRecords = { bestCombo: 0, longestDrift: 0, biggestJump: 0, totalBanked: 0 }
  if (!storage) return empty
  try {
    const raw = storage.getItem(key)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StuntRecords> | null
    if (!parsed || typeof parsed !== 'object') return empty
    const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
    return {
      bestCombo: Math.round(finite(parsed.bestCombo)),
      longestDrift: Math.round(finite(parsed.longestDrift) * 10) / 10,
      biggestJump: Math.round(finite(parsed.biggestJump) * 10) / 10,
      totalBanked: Math.round(finite(parsed.totalBanked)),
    }
  } catch {
    return empty
  }
}

const saveRecords = (storage: Pick<Storage, 'getItem' | 'setItem'> | null, key: string, rec: StuntRecords): void => {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(rec))
  } catch {
    /* private browsing or storage disabled */
  }
}

/** Pure stunt state machine: tracks drifts, jumps, J-turns, near-misses, speed runs, combos, banking, and busts. */
export function createStuntEngine(o: {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  key?: string
} = {}): StuntEngine {
  const storage = o.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : o.storage
  const key = o.key ?? STORAGE_KEY
  const records: StuntRecords = readRecords(storage, key)

  let phase: StuntPhase = 'idle'
  let basePoints = 0
  let multiplier = 1
  let grace = 0
  let bannerTimer = 0
  let label = ''
  let chain: StuntEvent[] = []
  let lastKind: StuntKind | null = null
  let lastBanked = 0
  let lastBusted = 0
  let newBest = false

  // Pending personal-best candidates committed when the combo banks cleanly.
  let pendingDriftM = 0
  let pendingJumpM = 0

  // Continuous drift tracking
  let driftActive = false
  let driftTime = 0
  let driftOffTime = 0
  let driftPts = 0
  let driftDistM = 0
  let driftTier = 0

  // Big Air tracking
  let inAir = false
  let airShown = false
  let airTime = 0
  let airDistM = 0
  let airStart: [number, number, number] = [0, 0, 0]
  let airPeakY = 0

  // 180 / 360 J-Turn spin tracking
  let prevYaw: number | null = null
  let prevAt: [number, number, number] | null = null
  let spinRad = 0
  let spinIdle = 0
  let spin180 = false
  let spin360 = false

  // Speed Demon & Near Miss tracking
  let speedTime = 0
  let speedAwarded = false
  let speedNext = 0
  let simTime = 0
  let lastNearMissAt = -99
  let isDrivingNow = false
  let lastKmh = 0

  let onFeedback: StuntFeedback | null = null

  const driftLabelFor = (pts: number): string =>
    pts >= 1200 ? 'Ultimate Drift' : pts >= 450 ? 'Great Drift' : 'Drift'

  const driftTierFor = (pts: number): number =>
    pts >= 1200 ? 3 : pts >= 450 ? 2 : 1

  const liveAirPoints = (): number =>
    airShown ? Math.round(80 + airDistM * 20 + airTime * 120) : 0

  const currentBase = (): number =>
    basePoints + (driftActive ? Math.round(driftPts) : 0) + liveAirPoints()

  const currentTotal = (): number => Math.round(currentBase() * multiplier)

  const clearRun = () => {
    basePoints = 0
    multiplier = 1
    grace = 0
    chain = []
    lastKind = null
    pendingDriftM = 0
    pendingJumpM = 0
    driftActive = false
    driftTime = 0
    driftOffTime = 0
    driftPts = 0
    driftDistM = 0
    driftTier = 0
    inAir = false
    airShown = false
    airTime = 0
    airDistM = 0
    spinRad = 0
    spinIdle = 0
    spin180 = false
    spin360 = false
    speedTime = 0
    speedAwarded = false
    speedNext = 0
  }

  const ensureActive = (kind: StuntKind): boolean => {
    let bumped = false
    if (phase !== 'active') {
      phase = 'active'
      basePoints = 0
      multiplier = 1
      chain = []
      lastKind = null
      pendingDriftM = 0
      pendingJumpM = 0
      bannerTimer = 0
      newBest = false
    } else if (lastKind !== null && lastKind !== kind && multiplier < MAX_MULTIPLIER) {
      multiplier++
      bumped = true
    }
    grace = GRACE_SECONDS
    return bumped
  }

  const awardInstant = (kind: StuntKind, stuntLabel: string, points: number) => {
    const pts = Math.max(10, Math.round(points))
    const bumped = ensureActive(kind)
    basePoints += pts
    lastKind = kind
    label = stuntLabel
    chain.push({ kind, label: stuntLabel, points: pts })
    if (chain.length > 16) chain.shift()
    onFeedback?.(bumped ? 'tier' : 'stunt', { score: currentTotal(), multiplier })
  }

  const commitDrift = () => {
    if (!driftActive) {
      driftTime = 0
      driftOffTime = 0
      driftPts = 0
      driftDistM = 0
      driftTier = 0
      return
    }
    const pts = Math.round(driftPts)
    const dLabel = driftLabelFor(pts)
    if (pts >= DRIFT_MIN_POINTS) {
      basePoints += pts
      lastKind = 'drift'
      label = dLabel
      chain.push({ kind: 'drift', label: dLabel, points: pts })
      if (chain.length > 16) chain.shift()
      pendingDriftM = Math.max(pendingDriftM, driftDistM)
      grace = GRACE_SECONDS
    }
    driftActive = false
    driftTime = 0
    driftOffTime = 0
    driftPts = 0
    driftDistM = 0
    driftTier = 0
  }

  const bank = (): number => {
    if (phase !== 'active') return 0
    if (driftActive) commitDrift()
    const total = Math.round(basePoints * multiplier)
    const bankedMult = multiplier
    const bestDrift = pendingDriftM
    const bestJump = pendingJumpM
    clearRun()
    if (total <= 0) {
      phase = 'idle'
      label = ''
      return 0
    }
    const beatCombo = records.bestCombo > 0 && total > records.bestCombo
    const beatDrift = records.longestDrift > 0 && bestDrift > records.longestDrift + 0.5
    const beatJump = records.biggestJump > 0 && bestJump > records.biggestJump + 0.5
    newBest = beatCombo || beatDrift || beatJump
    records.bestCombo = Math.max(records.bestCombo, total)
    records.longestDrift = Math.max(records.longestDrift, Math.round(bestDrift * 10) / 10)
    records.biggestJump = Math.max(records.biggestJump, Math.round(bestJump * 10) / 10)
    records.totalBanked += total
    saveRecords(storage, key, records)
    lastBanked = total
    phase = 'banked'
    bannerTimer = BANK_BANNER_SECONDS
    label = newBest ? 'NEW BEST · BANKED' : 'BANKED'
    onFeedback?.('bank', { score: total, multiplier: bankedMult, newBest })
    return total
  }

  const bust = (): boolean => {
    const active = phase === 'active' && currentBase() > 0
    const lost = active ? currentTotal() : 0
    clearRun()
    if (!active) return false
    lastBusted = lost
    newBest = false
    phase = 'busted'
    bannerTimer = BUST_BANNER_SECONDS
    label = 'COMBO BUSTED'
    onFeedback?.('bust', { score: lost })
    return true
  }

  const nearMiss = (detail?: NearMissDetail): boolean => {
    if (!isDrivingNow) return false
    if (simTime - lastNearMissAt < NEARMISS_COOLDOWN) return false
    lastNearMissAt = simTime
    const detailKmh = typeof detail?.speedKmh === 'number' && Number.isFinite(detail.speedKmh)
      ? detail.speedKmh
      : typeof detail?.kmh === 'number' && Number.isFinite(detail.kmh)
        ? detail.kmh
        : typeof detail?.speed === 'number' && Number.isFinite(detail.speed)
          ? detail.speed
          : 0
    const spd = Math.max(lastKmh, detailKmh)
    const tight = typeof detail?.clearance === 'number' && Number.isFinite(detail.clearance) && detail.clearance < 1.0
    const pts = Math.min(750, Math.round(200 + Math.max(0, spd - 40) * 3 + (tight ? 80 : 0)))
    const tag = detail?.label?.trim() || (spd >= 125 || tight ? 'Close Near Miss!' : 'Near Miss')
    awardInstant('nearmiss', tag, pts)
    return true
  }

  const stepIdle = (dt: number, dismounted = false) => {
    isDrivingNow = false
    prevYaw = null
    prevAt = null
    lastKmh = 0
    if (dismounted) {
      if (phase === 'active' && currentBase() > 0) bank()
      else clearRun()
    }
    if (phase === 'banked' || phase === 'busted') {
      bannerTimer = Math.max(0, bannerTimer - dt)
      if (bannerTimer <= 0) {
        phase = 'idle'
        label = ''
        newBest = false
      }
    }
  }

  const step = (sample: StuntSample) => {
    const dt = Math.max(0, Math.min(0.1, sample.dt))
    if (dt <= 0) return
    simTime += dt

    if (!sample.driving) {
      stepIdle(dt, isDrivingNow)
      return
    }
    isDrivingNow = true
    lastKmh = Math.max(0, sample.kmh)

    // Compute ground velocity & yaw rate directly from body pose for sideways slides and spins.
    let horizCellsPerSec = sample.kmh / 0.36
    if (prevAt) {
      const dx = sample.at[0] - prevAt[0]
      const dz = sample.at[2] - prevAt[2]
      const dist = Math.hypot(dx, dz)
      if (dist < 2500 * dt) horizCellsPerSec = Math.max(horizCellsPerSec, dist / dt)
    }
    prevAt = [sample.at[0], sample.at[1], sample.at[2]]
    const horizKmh = horizCellsPerSec * 0.36

    const yaw = Math.atan2(sample.front[0], -sample.front[2])
    const dyaw = prevYaw !== null ? wrap(yaw - prevYaw) : 0
    prevYaw = yaw
    const yawRate = dyaw / Math.max(dt, 0.004)
    const up = 1 - 2 * (sample.rot[0] * sample.rot[0] + sample.rot[2] * sample.rot[2])

    // 1. Check hard wall/vehicle collisions (> 45 cells/s) first — busts an active combo!
    if (sample.impacts && sample.impacts.length > 0) {
      let hardHit = false
      for (let i = 0; i < sample.impacts.length; i++) {
        if (sample.impacts[i] > BUST_IMPACT_SPEED) { hardHit = true; break }
      }
      if (hardHit) {
        speedTime = 0
        speedAwarded = false
        if (phase === 'active' && currentBase() > 0) {
          bust()
          return
        }
        // Clear partial air/drift accumulator on a hard crash even if combo hadn't crossed threshold.
        driftTime = 0; driftPts = 0; driftDistM = 0; driftActive = false
        inAir = false; airShown = false; airTime = 0; airDistM = 0
      }
    }

    const grounded = sample.feet >= 2

    // 2. Big Air (all wheels off the ground: feet === 0)
    if (sample.feet === 0) {
      if (!inAir) {
        inAir = true
        airShown = false
        airTime = 0
        airDistM = 0
        airStart = [sample.at[0], sample.at[1], sample.at[2]]
        airPeakY = sample.at[1]
      }
      airTime += dt
      if (sample.at[1] > airPeakY) airPeakY = sample.at[1]
      airDistM = Math.hypot(sample.at[0] - airStart[0], sample.at[2] - airStart[2]) / 10
      if (airTime >= AIR_MIN_TIME) {
        if (!airShown) {
          if (driftActive) commitDrift()
          airShown = true
          if (phase !== 'active') ensureActive('air')
        }
        grace = GRACE_SECONDS
        const m = Math.max(1, Math.round(airDistM))
        label = airDistM >= 20 ? `Big Air ${m}m` : airDistM >= 8 ? `Airborne ${m}m` : 'Airborne'
      }
    } else if (grounded && inAir) {
      const landedAirTime = airTime
      const landedDistM = Math.hypot(sample.at[0] - airStart[0], sample.at[2] - airStart[2]) / 10
      const peakRiseM = Math.max(0, (airPeakY - airStart[1]) / 10)
      const wasShown = airShown
      inAir = false
      airShown = false
      airTime = 0
      airDistM = 0
      if (landedAirTime >= AIR_MIN_TIME) {
        if (up > 0.65 && (landedDistM >= 4 || landedAirTime >= 0.45)) {
          const pts = Math.round(120 + landedDistM * 24 + landedAirTime * 140 + peakRiseM * 18)
          const m = Math.max(1, Math.round(landedDistM))
          const airLabel = landedDistM >= 20
            ? `Big Air ${m}m!`
            : landedDistM >= 10
              ? `Great Air ${m}m!`
              : `Airborne ${m}m`
          pendingJumpM = Math.max(pendingJumpM, landedDistM)
          awardInstant('air', airLabel, pts)
        } else if (up <= 0.55 && (phase === 'active' || wasShown)) {
          bust()
          return
        } else if (wasShown && basePoints === 0 && !driftActive) {
          phase = 'idle'
          label = ''
        }
      }
    }

    // 3. Drift scoring (continuous speed × slip angle while grounded & sliding)
    const driftingNow = sample.drifting && grounded && horizKmh >= 22
    if (driftingNow) {
      driftOffTime = 0
      driftTime += dt
      driftDistM += (horizCellsPerSec * dt) / 10
      const slipFactor = Math.max(0.28, Math.min(1.3, sample.slip))
      driftPts += horizKmh * slipFactor * 4.2 * dt
      if (driftTime >= DRIFT_MIN_TIME || driftPts >= DRIFT_MIN_POINTS) {
        const tier = driftTierFor(driftPts)
        if (!driftActive) {
          driftActive = true
          driftTier = tier
          const bumped = ensureActive('drift')
          lastKind = 'drift'
          label = driftLabelFor(driftPts)
          onFeedback?.(bumped ? 'tier' : 'stunt', { score: currentTotal(), multiplier })
        } else {
          if (tier > driftTier) {
            driftTier = tier
            onFeedback?.('stunt', { score: currentTotal(), multiplier })
          }
          label = driftLabelFor(driftPts)
          grace = GRACE_SECONDS
        }
      }
    } else if (driftActive) {
      driftOffTime += dt
      if (driftOffTime >= DRIFT_BREAK_GRACE || !grounded) commitDrift()
    } else if (driftTime > 0) {
      driftOffTime += dt
      if (driftOffTime >= DRIFT_BREAK_GRACE) {
        driftTime = 0
        driftPts = 0
        driftDistM = 0
        driftOffTime = 0
      }
    }

    // 4. J-Turn / 180° / 360° rapid yaw spin during a slide (awarded at 150° / 320° so slides feel generous)
    const slidingSpin = (sample.drifting || sample.slip > 0.2 || Math.abs(yawRate) > 1.7) && horizKmh > 12
    if (slidingSpin && Math.abs(yawRate) > 0.9) {
      if (spinRad !== 0 && Math.sign(dyaw) !== Math.sign(spinRad) && Math.abs(dyaw) > 0.08) {
        spinRad = dyaw
        spin180 = false
        spin360 = false
      } else {
        spinRad += dyaw
      }
      spinIdle = 0
      const deg = Math.abs(spinRad) * (180 / Math.PI)
      if (!spin180 && deg >= 150) {
        spin180 = true
        awardInstant('spin', '180° J-Turn', 350)
      }
      if (!spin360 && deg >= 320) {
        spin360 = true
        awardInstant('spin', '360° Spin!', 550)
      }
    } else {
      spinIdle += dt
      if (spinIdle > 0.35 || horizKmh < 8) {
        spinRad = 0
        spinIdle = 0
        spin180 = false
        spin360 = false
      }
    }

    // 5. Speed Demon (sustained clean run > 130 km/h)
    if (grounded && sample.kmh > SPEED_DEMON_KMH) {
      speedTime += dt
      if (!speedAwarded && speedTime >= 2.5) {
        speedAwarded = true
        speedNext = speedTime + 3.0
        awardInstant('speed', sample.kmh >= 170 ? 'Ultimate Speed!' : 'Speed Demon', sample.kmh >= 170 ? 450 : 300)
      } else if (speedAwarded && speedTime >= speedNext) {
        speedNext = speedTime + 3.0
        awardInstant('speed', sample.kmh >= 170 ? 'Ultimate Speed!' : 'Speed Demon', sample.kmh >= 170 ? 450 : 350)
      }
    } else if (sample.kmh < SPEED_RESET_KMH) {
      speedTime = 0
      speedAwarded = false
      speedNext = 0
    }

    // 6. Combo grace timer countdown & bank, or banked/busted banner fade-out
    if (phase === 'active') {
      if (!driftActive && !airShown) {
        grace = Math.max(0, grace - dt)
        if (grace <= 0) bank()
      }
    } else if (phase === 'banked' || phase === 'busted') {
      bannerTimer = Math.max(0, bannerTimer - dt)
      if (bannerTimer <= 0) {
        phase = 'idle'
        label = ''
        newBest = false
      }
    }
  }

  return {
    step,
    stepIdle,
    nearMiss,
    bust,
    bank,
    resetSession() {
      clearRun()
      phase = 'idle'
      bannerTimer = 0
      label = ''
      lastBanked = 0
      lastBusted = 0
      newBest = false
      prevYaw = null
      prevAt = null
      lastNearMissAt = -99
    },
    get phase() { return phase },
    get records() { return { ...records } },
    get onFeedback() { return onFeedback },
    set onFeedback(fn: StuntFeedback | null) { onFeedback = fn },
    get state(): StuntState {
      return {
        phase,
        score: phase === 'banked' ? lastBanked : phase === 'busted' ? lastBusted : currentTotal(),
        basePoints: currentBase(),
        multiplier,
        grace,
        graceMax: GRACE_SECONDS,
        label,
        chain: chain.slice(),
        drifting: driftActive,
        driftPoints: Math.round(driftPts),
        driftDistance: Math.round(driftDistM * 10) / 10,
        airborne: airShown,
        airTime: Math.round(airTime * 100) / 100,
        airDistance: Math.round(airDistM * 10) / 10,
        lastBanked,
        lastBusted,
        newBest,
        records: { ...records },
      }
    },
  }
}

/** Browser-mounted stunt controller wired to `living`, `hud`, `sound`, and `window` `voxelwright:nearmiss`. */
export function stunts(o: {
  alive: Living
  hud: Hud
  sound?: () => Sound | null
}): Stunts {
  const core = createStuntEngine()
  const panel = o.hud.panel('stunts')
  panel.setAttribute('aria-live', 'polite')
  panel.setAttribute('aria-atomic', 'true')

  // Build crisp minimal DOM once; zero innerHTML churn during driving frames.
  const row = document.createElement('div')
  row.className = 'st-row'
  const labelEl = document.createElement('span')
  labelEl.className = 'st-label'
  const scoreEl = document.createElement('span')
  scoreEl.className = 'st-score'
  const multEl = document.createElement('span')
  multEl.className = 'st-mult'
  row.append(labelEl, scoreEl, multEl)

  const chainEl = document.createElement('div')
  chainEl.className = 'st-chain'
  chainEl.hidden = true

  const barWrap = document.createElement('div')
  barWrap.className = 'st-bar'
  const barFill = document.createElement('i')
  barWrap.append(barFill)

  panel.replaceChildren(row, chainEl, barWrap)

  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
  let popPending = false

  const playChime = (kind: 'stunt' | 'tier' | 'bank' | 'bust', meta?: { score?: number; multiplier?: number; newBest?: boolean }) => {
    const voice = o.sound?.()
    if (!voice || !voice.running) return
    if (kind === 'bank') {
      const big = (meta?.score ?? 0) >= 1000 || (meta?.multiplier ?? 1) >= 3 || meta?.newBest
      voice.play(BANK_CHIME, { pitch: 587.33, force: 0.55, gain: 0.42, bus: BUS.play })
      voice.play(BANK_CHIME, { pitch: 880, force: 0.62, gain: 0.45, after: 0.085, bus: BUS.play })
      if (big) voice.play(BANK_CHIME, { pitch: 1174.66, force: 0.68, gain: 0.44, after: 0.17, bus: BUS.play })
    } else if (kind === 'tier') {
      const idx = Math.max(0, Math.min(TIER_PITCHES.length - 1, (meta?.multiplier ?? 2) - 1))
      voice.play(TIER_TICK, { pitch: TIER_PITCHES[idx], force: 0.45, gain: 0.34, bus: BUS.play })
    } else if (kind === 'bust') {
      voice.play(BUST_TONE, { pitch: 128, force: 0.48, gain: 0.38, bus: BUS.play })
    }
  }

  core.onFeedback = (kind, meta) => {
    if (!reducedMotion.matches && (kind === 'stunt' || kind === 'tier' || kind === 'bank')) popPending = true
    playChime(kind, meta)
  }

  // Listen to traffic near-miss and hard crash custom events from reactive SF traffic (#29).
  const onNearMiss = (e: Event) => {
    const detail = (e as CustomEvent<NearMissDetail | undefined>).detail
    if (core.nearMiss(detail)) render()
  }
  const onCrash = (e: Event) => {
    const detail = (e as CustomEvent<{ speed?: number } | undefined>).detail
    if (typeof detail?.speed === 'number' && detail.speed > BUST_IMPACT_SPEED && core.bust()) render()
  }
  addEventListener('voxelwright:nearmiss', onNearMiss)
  addEventListener('voxelwright:crash', onCrash)

  let wasRidingId = 0
  let lastStruck: Struck | null = o.alive.struck[o.alive.struck.length - 1] ?? null
  let lastPhase: StuntPhase = 'idle'
  let lastLabel = ''
  let lastScoreText = ''
  let lastMult = 0
  let lastChainText = ''
  let lastBar = -1
  let lastFading = false
  let bannerFadeLeft = 0
  const impactsBuf: number[] = []

  const triggerPop = () => {
    if (!popPending) return
    popPending = false
    panel.classList.remove('pop')
    void panel.offsetWidth
    panel.classList.add('pop')
  }

  const render = () => {
    const s = core.state
    if (s.phase === 'idle') {
      if (lastPhase !== 'idle') {
        panel.removeAttribute('data-state')
        panel.classList.remove('fading', 'pop')
        lastPhase = 'idle'
        lastFading = false
      }
      return
    }
    if (s.phase !== lastPhase) {
      panel.dataset.state = s.phase
      lastPhase = s.phase
      if (s.phase === 'banked') bannerFadeLeft = BANK_BANNER_SECONDS
      else if (s.phase === 'busted') bannerFadeLeft = BUST_BANNER_SECONDS
      else bannerFadeLeft = 0
    }
    const fading = (s.phase === 'banked' || s.phase === 'busted') && bannerFadeLeft <= FADE_TAIL_SECONDS
    if (fading !== lastFading) {
      panel.classList.toggle('fading', fading)
      lastFading = fading
    }
    if (s.label !== lastLabel) {
      labelEl.textContent = s.label
      lastLabel = s.label
    }
    const scoreText = s.phase === 'banked' ? `+${fmtScore(s.score)}` : fmtScore(s.score)
    if (scoreText !== lastScoreText) {
      scoreEl.textContent = scoreText
      lastScoreText = scoreText
    }
    const showMult = s.phase === 'active'
    const multKey = showMult ? s.multiplier : 0
    if (multKey !== lastMult) {
      multEl.hidden = !showMult
      if (showMult) {
        multEl.textContent = `×${s.multiplier}`
        multEl.dataset.tier = String(s.multiplier)
      }
      lastMult = multKey
    }
    const trail = s.chain.map((c) => c.label)
    if (s.drifting) trail.push(s.driftPoints >= 1200 ? 'Ultimate Drift' : s.driftPoints >= 450 ? 'Great Drift' : 'Drift')
    else if (s.airborne) trail.push(s.airDistance >= 20 ? `Big Air ${Math.round(s.airDistance)}m` : 'Airborne')
    const chainText = s.phase === 'active' && trail.length >= 2
      ? trail.slice(-4).join(' · ')
      : ''
    if (chainText !== lastChainText) {
      chainEl.hidden = !chainText
      chainEl.textContent = chainText
      lastChainText = chainText
    }
    if (s.phase === 'active') {
      const frac = Math.round(Math.max(0, Math.min(1, s.grace / s.graceMax)) * 1000) / 1000
      if (frac !== lastBar) {
        barFill.style.transform = `scaleX(${frac})`
        lastBar = frac
      }
    }
    triggerPop()
  }

  const collectImpacts = (ridingId: number): number[] => {
    impactsBuf.length = 0
    const list = o.alive.struck
    if (!list.length) { lastStruck = null; return impactsBuf }
    const idx = lastStruck ? list.lastIndexOf(lastStruck) : -1
    for (let i = idx + 1; i < list.length; i++) {
      const s = list[i]
      if ((s.a === ridingId || s.b === ridingId) && (s.flags & 3) !== 0) impactsBuf.push(s.speed)
    }
    lastStruck = list[list.length - 1]
    return impactsBuf
  }

  return {
    frame(dt: number) {
      const riding = o.alive.riding
      const isDrive = !!riding && (riding.controls ?? 'drive') === 'drive'
      if (!isDrive) {
        if (wasRidingId !== 0) {
          wasRidingId = 0
          lastStruck = o.alive.struck[o.alive.struck.length - 1] ?? null
          core.stepIdle(dt, true)
          if (bannerFadeLeft > 0) bannerFadeLeft = Math.max(0, bannerFadeLeft - dt)
          render()
        } else if (core.phase !== 'idle') {
          core.stepIdle(dt, false)
          if (bannerFadeLeft > 0) bannerFadeLeft = Math.max(0, bannerFadeLeft - dt)
          render()
        }
        return
      }
      if (riding.id !== wasRidingId) {
        wasRidingId = riding.id
        // Snapshot existing impacts on mount so pre-mount collisions never bust a fresh run.
        lastStruck = o.alive.struck[o.alive.struck.length - 1] ?? null
      }
      const tel = o.alive.telemetry
      const at = o.alive.where(riding)
      if (!tel || !at) return
      const feet = riding.state ? riding.state.feet : riding.motor.feet.length
      if (bannerFadeLeft > 0) bannerFadeLeft = Math.max(0, bannerFadeLeft - dt)
      core.step({
        driving: true,
        dt,
        kmh: tel.kmh,
        slip: tel.slip,
        drifting: tel.drifting,
        feet,
        at: at.at,
        rot: at.rot,
        front: at.front,
        impacts: collectImpacts(riding.id),
      })
      render()
    },
    nearMiss(detail) {
      const ok = core.nearMiss(detail)
      if (ok) render()
      return ok
    },
    bust() {
      const ok = core.bust()
      if (ok) render()
      return ok
    },
    bank() {
      const n = core.bank()
      render()
      return n
    },
    reset() {
      core.resetSession()
      bannerFadeLeft = 0
      render()
    },
    destroy() {
      removeEventListener('voxelwright:nearmiss', onNearMiss)
      removeEventListener('voxelwright:crash', onCrash)
      panel.remove()
    },
    get state() { return core.state },
    get records() { return core.records },
    panel,
    engine: core,
  }
}
