// Procedural combat, plasma, ballistics, and sports foley (#166):
// Physically-informed AudioWorklet patches (strict data, checked by patch.ts) and a thin controller
// (`combatSound`) that routes melee clashes, blade friction, dual-oscillator lightsabers, ranged
// ballistics/lasers, and tennis acoustics through Voxelwright's existing `Sound` interface.
//
// Nothing here generates samples directly or touches the audio thread; `dsp.ts` synthesizes every
// voice and enforces the hard `CEILING` (-1 dBFS) after mixing.
import { BUS, type Play, type Sound } from './sound.ts'
import type { Patch } from './patch.ts'

export type Vec3 = readonly [number, number, number]
export type CourtSurface = 'hard' | 'clay' | 'grass'
export type ImpactMaterial = 'flesh' | 'wood' | 'stone' | 'metal'

/** Minimal `Sound` surface required by `combatSound` (satisfied by `Sound` and offline `Synth` harnesses). */
export type CombatVoice = Pick<Sound, 'play' | 'hold' | 'release' | 'glide' | 'place'> & {
  readonly context?: { readonly currentTime: number }
}

export interface CombatPlayOpts {
  /** World position in cells; omit for head-centered playback. */
  at?: Vec3
  /** Metres at which loudness halves. */
  reach?: number
  /** Stereo pan (-1..1) when head-centered. */
  pan?: number
  /** Relative loudness (0..1) when head-centered. */
  gain?: number
  /** Delay by speed of sound when spatialized. */
  travels?: boolean
}

export type CombatPatchName =
  | 'parryClash'
  | 'parrySparks'
  | 'bluntHit'
  | 'bladeStab'
  | 'bladeScrape'
  | 'saberIgnite'
  | 'saberRetract'
  | 'saberHum'
  | 'saberHumHarmonic'
  | 'saberSwing'
  | 'saberClash'
  | 'bulletCrack'
  | 'ricochet'
  | 'shockwaveBoom'
  | 'shockwaveCrack'
  | 'shockwaveOccluded'
  | 'laserSizzle'
  | 'laserHum'
  | 'tennisPop'
  | 'tennisFrame'
  | 'tennisBounce'
  | 'tennisNet'

/**
 * Pure-data patches for Lane 2 combat, plasma blades, ranged ballistics, and tennis.
 * Every entry conforms strictly to `patch.ts` (`patch()` accepts its JSON round-trip) and compiles
 * cleanly for `dsp.ts` (`Synth`).
 */
export const COMBAT_PATCHES: Readonly<Record<CombatPatchName, Patch>> = {
  // ── 1. Melee Clash & Parry ────────────────────────────────────────────────
  // Inharmonic steel-blade flexural + torsional modes with low metal loss factor and spark-crackle air burst.
  parryClash: {
    how: 'struck',
    hard: 1,
    rough: 0.24,
    modes: [
      [1, 0.65],
      [2.41, 0.92],
      [3.87, 1],
      [5.63, 0.92],
      [7.91, 0.78],
      [10.42, 0.62],
      [13.7, 0.48],
      [17.3, 0.34],
    ],
    pitch: 740,
    ring: 1.35,
    damp: 0.08,
    air: { from: 9800, to: 2800, for: 0.14, gain: 0.78, q: 1.5 },
    gain: 0.82,
  },
  // High-impulse steel spark scatter layered atop heavy parries.
  parrySparks: {
    how: 'struck',
    hard: 1,
    rough: 0.88,
    modes: [
      [1, 0.45],
      [2.17, 0.8],
      [3.62, 1],
      [5.84, 0.7],
    ],
    pitch: 2400,
    ring: 0.055,
    damp: 0.25,
    pieces: { count: 14, over: 0.24, spread: 0.85 },
    air: { from: 11200, to: 4200, for: 0.18, gain: 0.72, q: 2.2 },
    gain: 0.56,
  },

  // ── 2. Blade Scrape, Stab & Blunt Impact ─────────────────────────────────
  // Damped low-mid thud for blunt hammers, fists, and heavy body/wood strikes.
  bluntHit: {
    how: 'struck',
    hard: 0.16,
    rough: 0.45,
    shape: 'lump',
    pitch: 76,
    ring: 0.11,
    damp: 0.94,
    bend: 0.5,
    air: { from: 360, to: 85, for: 0.11, gain: 0.48, q: 0.9 },
    gain: 0.88,
  },
  // Filtered friction noise exciting damped blade-binding modes for prismatic stab / pull-out.
  bladeStab: {
    how: 'rubbed',
    hard: 0.78,
    rough: 0.92,
    modes: [
      [1, 0.85],
      [1.73, 0.65],
      [2.91, 0.9],
      [4.45, 0.55],
      [6.8, 0.35],
    ],
    pitch: 310,
    ring: 0.14,
    damp: 0.62,
    bend: -0.25,
    air: { from: 3600, to: 950, for: 0.22, gain: 0.75, q: 1.8 },
    gain: 0.76,
  },
  // Continuous metallic blade-on-blade or blade-on-stone friction scrape.
  bladeScrape: {
    how: 'rubbed',
    hard: 0.95,
    rough: 0.88,
    shape: 'plate',
    pitch: 920,
    ring: 0.22,
    damp: 0.28,
    air: { from: 6200, to: 2400, for: 0.28, gain: 0.45, q: 2.8 },
    gain: 0.62,
  },

  // ── 3. Lightsaber / Plasma Blade ─────────────────────────────────────────
  // Snap-hiss ignition: fast electrical snap, broad plasma hiss, and upward core lock-in.
  saberIgnite: {
    how: 'struck',
    hard: 0.96,
    rough: 0.92,
    modes: [
      [1, 0.95],
      [1.98, 0.7],
      [3.12, 0.55],
      [5.4, 0.42],
      [8.7, 0.28],
    ],
    pitch: 145,
    ring: 0.42,
    damp: 0.35,
    bend: -0.75,
    air: { from: 9400, to: 1400, for: 0.34, gain: 0.95, q: 0.85 },
    gain: 0.84,
  },
  // Retraction whine: descending containment-field collapse and downward air sweep.
  saberRetract: {
    how: 'struck',
    hard: 0.65,
    rough: 0.72,
    modes: [
      [1, 1],
      [2.02, 0.65],
      [3.05, 0.4],
      [5.1, 0.2],
    ],
    pitch: 64,
    ring: 0.36,
    damp: 0.55,
    bend: 1.55,
    air: { from: 3200, to: 220, for: 0.34, gain: 0.82, q: 1.25 },
    gain: 0.76,
  },
  // Primary warm plasma hum oscillator (rich saw+sine fundamental through warm low-pass).
  saberHum: {
    how: 'rubbed',
    hard: 0.82,
    rough: 0.26,
    shape: 'string',
    pitch: 92,
    ring: 0.28,
    damp: 0.72,
    waver: 0.38,
    gain: 0.68,
  },
  // Secondary detuned harmonic oscillator for dual-oscillator beating and Doppler brightness sweep.
  saberHumHarmonic: {
    how: 'rubbed',
    hard: 0.78,
    rough: 0.36,
    shape: 'string',
    pitch: 96.5,
    ring: 0.25,
    damp: 0.24,
    waver: 0.52,
    gain: 0.48,
  },
  // Velocity-driven plasma air-sweep burst during rapid swings.
  saberSwing: {
    how: 'struck',
    hard: 0.15,
    rough: 0.95,
    modes: [
      [1, 0.08],
      [2.05, 0.05],
    ],
    pitch: 140,
    ring: 0.08,
    damp: 0.85,
    bend: 0.45,
    air: { from: 1900, to: 380, for: 0.26, gain: 0.88, q: 1.9 },
    gain: 0.62,
  },
  // High-voltage plasma arc clash crackle for blade locks and impacts.
  saberClash: {
    how: 'struck',
    hard: 1,
    rough: 1,
    modes: [
      [1, 0.7],
      [1.62, 0.85],
      [2.83, 1],
      [4.31, 0.82],
      [6.75, 0.68],
      [9.9, 0.52],
    ],
    pitch: 420,
    ring: 0.32,
    damp: 0.26,
    bend: 0.4,
    pieces: { count: 16, over: 0.28, spread: 0.9 },
    air: { from: 9600, to: 1800, for: 0.26, gain: 0.95, q: 1.3 },
    gain: 0.84,
  },

  // ── 4. Ranged Combat ─────────────────────────────────────────────────────
  // Supersonic ballistic N-wave crack and close-pass air whiz.
  bulletCrack: {
    how: 'struck',
    hard: 1,
    rough: 1,
    modes: [
      [1, 0.35],
      [2.6, 0.7],
      [4.9, 1],
      [8.3, 0.65],
    ],
    pitch: 920,
    ring: 0.025,
    damp: 0.88,
    bend: 0.8,
    air: { from: 10800, to: 1100, for: 0.13, gain: 1, q: 0.75 },
    gain: 0.88,
  },
  // Metallic grazing ricochet zing: fast downward pitch chirp with narrow resonant whistle.
  ricochet: {
    how: 'struck',
    hard: 1,
    rough: 0.3,
    modes: [
      [1, 1],
      [1.62, 0.55],
      [2.48, 0.42],
      [3.85, 0.25],
    ],
    pitch: 840,
    ring: 0.42,
    damp: 0.18,
    bend: 1.75,
    air: { from: 7600, to: 1400, for: 0.18, gain: 0.52, q: 4.5 },
    gain: 0.78,
  },
  // Concussive shockwave low-end boom with downward pressure-wave pitch sweep.
  shockwaveBoom: {
    how: 'struck',
    hard: 0.18,
    rough: 0.42,
    shape: 'skin',
    pitch: 44,
    ring: 1.25,
    damp: 0.88,
    bend: 1.1,
    air: { from: 380, to: 48, for: 1.35, gain: 0.88, q: 0.8 },
    gain: 0.92,
  },
  // Crisp open-air shock front layered with shockwaveBoom when unoccluded.
  shockwaveCrack: {
    how: 'struck',
    hard: 1,
    rough: 1,
    shape: 'lump',
    pitch: 960,
    ring: 0.035,
    damp: 0.85,
    air: { from: 6400, to: 650, for: 0.22, gain: 0.95, q: 0.55 },
    gain: 0.86,
  },
  // Low-pass muffled sub-thump when a shockwave is occluded behind walls or terrain.
  shockwaveOccluded: {
    how: 'struck',
    hard: 0.06,
    rough: 0.3,
    shape: 'skin',
    pitch: 38,
    ring: 0.95,
    damp: 0.98,
    bend: 0.65,
    air: { from: 260, to: 45, for: 0.95, gain: 0.72, q: 0.45 },
    gain: 0.86,
  },
  // Continuous thermal laser surface ablation sizzle (high-frequency noise-excited modal bank).
  laserSizzle: {
    how: 'rubbed',
    hard: 0.95,
    rough: 1,
    modes: [
      [1, 0.35],
      [1.85, 0.65],
      [3.12, 0.9],
      [4.95, 1],
      [7.4, 0.8],
      [10.8, 0.55],
    ],
    pitch: 520,
    ring: 0.08,
    damp: 0.22,
    air: { from: 10500, to: 4800, for: 0.35, gain: 0.65, q: 2.4 },
    gain: 0.64,
  },
  // Focused thermal laser beam hum paired with laserSizzle.
  laserHum: {
    how: 'blown',
    hard: 0.9,
    rough: 0.42,
    shape: 'tube',
    pitch: 215,
    ring: 0.14,
    damp: 0.25,
    waver: 0.65,
    gain: 0.52,
  },

  // ── 5. Tennis Mini-Game ──────────────────────────────────────────────────
  // Tight stringbed racket pop on sweet-spot contact.
  tennisPop: {
    how: 'struck',
    hard: 0.84,
    rough: 0.22,
    modes: [
      [1, 1],
      [1.58, 0.68],
      [2.14, 0.52],
      [3.08, 0.36],
      [4.35, 0.22],
    ],
    pitch: 540,
    ring: 0.14,
    damp: 0.58,
    bend: 0.24,
    air: { from: 3800, to: 1200, for: 0.055, gain: 0.45, q: 1.4 },
    gain: 0.82,
  },
  // Duller off-center graphite/alloy frame-hit clank when striking the rim.
  tennisFrame: {
    how: 'struck',
    hard: 0.34,
    rough: 0.48,
    modes: [
      [1, 1],
      [1.44, 0.75],
      [2.67, 0.35],
      [4.18, 0.15],
    ],
    pitch: 195,
    ring: 0.085,
    damp: 0.84,
    bend: -0.15,
    air: { from: 1100, to: 320, for: 0.05, gain: 0.42, q: 0.9 },
    gain: 0.76,
  },
  // Crisp hollow-sphere pressurized rubber ball court bounce thump.
  tennisBounce: {
    how: 'struck',
    hard: 0.68,
    rough: 0.32,
    modes: [
      [1, 1],
      [2.38, 0.42],
      [3.85, 0.18],
      [5.4, 0.08],
    ],
    pitch: 240,
    ring: 0.095,
    damp: 0.78,
    bend: 0.32,
    air: { from: 1600, to: 420, for: 0.045, gain: 0.36, q: 1.1 },
    gain: 0.78,
  },
  // Taut net-cord and canvas headband snap.
  tennisNet: {
    how: 'struck',
    hard: 0.76,
    rough: 0.62,
    modes: [
      [1, 0.9],
      [2.08, 0.65],
      [3.32, 0.42],
      [5.1, 0.22],
    ],
    pitch: 330,
    ring: 0.13,
    damp: 0.68,
    bend: 0.48,
    air: { from: 4200, to: 1150, for: 0.065, gain: 0.72, q: 1.3 },
    gain: 0.72,
  },
}

const COURT_TUNING: Readonly<Record<CourtSurface, { pitch: number; forceMul: number; size: number }>> = {
  hard: { pitch: 268, forceMul: 1, size: 0.96 },
  clay: { pitch: 226, forceMul: 0.9, size: 1.04 },
  grass: { pitch: 192, forceMul: 0.76, size: 1.12 },
}

const BLUNT_PITCH: Readonly<Record<ImpactMaterial, number>> = {
  flesh: 78,
  wood: 145,
  stone: 112,
  metal: 130,
}

const clamp = (v: number, lo: number, hi: number, fallback = lo): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

export interface CombatSoundOptions {
  /** Subtle per-hit pitch/force jitter so repeated blows never sound identical (default true). */
  jitter?: boolean
}

export interface CombatSound {
  /** Steel-blade modal parry clash + spark crackle burst, scaled by solver impact impulse (0..1). */
  parryClash(opts?: CombatPlayOpts & { impulse?: number; size?: number }): boolean
  /** Damped low-mid thud for blunt hammers, fists, and flesh/wood impacts. */
  bluntHit(opts?: CombatPlayOpts & { force?: number; material?: ImpactMaterial; size?: number }): boolean
  /** Filtered friction noise for prismatic stab binding or pull-out. */
  bladeStab(opts?: CombatPlayOpts & { force?: number; dur?: number; pullOut?: boolean; material?: ImpactMaterial }): boolean
  /** Continuous metallic blade friction scrape. */
  bladeScrape(opts?: CombatPlayOpts & { force?: number; dur?: number; speed?: number }): boolean
  /** Plays ignition snap-hiss and starts the continuous dual-oscillator plasma hum. */
  saberIgnite(opts?: CombatPlayOpts & { pitch?: number; force?: number }): boolean
  /** Releases the continuous plasma hum and plays the retraction whine. */
  saberRetract(opts?: CombatPlayOpts & { force?: number }): void
  /** Modulates the active dual-oscillator plasma hum with Doppler pitch, filter brightness, swing air, and clash crackle. */
  saberUpdate(speed: number, angularSpeed?: number, clashing?: boolean, at?: Vec3): void
  /** Alias for `saberUpdate(speed, angularSpeed, clashing, at)`. */
  updateSaber(speed: number, angularSpeed?: number, clashing?: boolean, at?: Vec3): void
  /** High-voltage plasma clash crackle burst. */
  saberClash(opts?: CombatPlayOpts & { impulse?: number; force?: number; size?: number }): boolean
  /** Supersonic bullet crack and close-pass air whiz. */
  bulletCrack(opts?: CombatPlayOpts & { speed?: number; force?: number }): boolean
  /** Metallic grazing ricochet zing with fast downward pitch chirp. */
  ricochet(opts?: CombatPlayOpts & { force?: number; pitch?: number; size?: number }): boolean
  /** Concussive shockwave boom: crisp crack + boom when open, low-pass muffled sub-thump when occluded (boolean or 0..1). */
  shockwaveBoom(opts?: CombatPlayOpts & { force?: number; radius?: number; occluded?: boolean | number }): boolean
  /** Continuous (`active: true/false`) or timed thermal laser hum and ablation sizzle. */
  laserSizzle(opts?: CombatPlayOpts & { active?: boolean; force?: number; dur?: number; heat?: number }): boolean
  /** Stops any active continuous thermal laser hum/sizzle. */
  laserStop(): void
  /** Tennis racket hit: resonant stringbed pop on sweet-spot (`sweetSpot -> 1`), duller frame-hit clank off-center (`sweetSpot -> 0`). */
  tennisPop(opts?: CombatPlayOpts & { velocity?: number; force?: number; sweetSpot?: number }): boolean
  /** Hollow-sphere tennis ball court bounce pitched by Hard / Clay / Grass. */
  tennisBounce(opts?: CombatPlayOpts & { surface?: CourtSurface; velocity?: number; force?: number }): boolean
  /** Tennis net-cord and tape snap. */
  tennisNet(opts?: CombatPlayOpts & { velocity?: number; force?: number }): boolean
  /** Releases all held continuous combat voices (saber hum and thermal laser). */
  stopAll(): void
  readonly saberActive: boolean
  readonly laserActive: boolean
}

/** Creates a combat, plasma, ballistics, and sports foley controller backed by Voxelwright's `Sound` engine. */
export function combatSound(voice: CombatVoice, options: CombatSoundOptions = {}): CombatSound {
  const jitter = options.jitter ?? true
  const vary = (span = 0.06) => (jitter ? 1 - span + Math.random() * span * 2 : 1)
  const clock = () => voice.context?.currentTime ?? performance.now() / 1000

  let saberId1 = 0
  let saberId2 = 0
  let saberBasePitch = COMBAT_PATCHES.saberHum.pitch
  let saberWasClashing = false
  let saberLastSwingAt = -10
  let saberLastClashAt = -10

  let laserHumId = 0
  let laserSizzleId = 0

  const spatial = (opts: CombatPlayOpts | undefined, defaultReach: number, defaultTravels = true): Play => {
    const out: Play = { bus: BUS.world, reach: opts?.reach ?? defaultReach, travels: opts?.travels ?? defaultTravels }
    if (opts?.at) out.at = opts.at
    if (opts?.pan !== undefined) out.pan = clamp(opts.pan, -1, 1, 0)
    if (opts?.gain !== undefined) out.gain = clamp(opts.gain, 0, 1, 1)
    return out
  }

  const releaseSaber = () => {
    if (saberId1) voice.release(saberId1)
    if (saberId2) voice.release(saberId2)
    saberId1 = 0
    saberId2 = 0
    saberWasClashing = false
  }

  const laserStop = () => {
    if (laserHumId) voice.release(laserHumId)
    if (laserSizzleId) voice.release(laserSizzleId)
    laserHumId = 0
    laserSizzleId = 0
  }

  const saberClash = (opts?: CombatPlayOpts & { impulse?: number; force?: number; size?: number }): boolean => {
    const force = clamp(opts?.impulse ?? opts?.force ?? 0.88, 0.08, 1, 0.88)
    const size = clamp(opts?.size ?? 1, 0.45, 2.2, 1) * vary(0.05)
    return voice.play(COMBAT_PATCHES.saberClash, {
      ...spatial(opts, 22, false),
      force,
      size,
    })
  }

  const saberUpdate = (speed: number, angularSpeed = 0, clashing = false, at?: Vec3): void => {
    if (!saberId1 && !saberId2) return
    const spd = clamp(speed, 0, 40, 0)
    const ang = clamp(angularSpeed, 0, 30, 0)
    const motion = Math.min(1, Math.hypot(spd / 10, ang / 7))

    // Velocity-driven Doppler pitch bend + filter-sweep brightening across both oscillators.
    // Because `dsp.ts` tracks the tone SVF cutoff as `pitch * tBright`, raising the brighter
    // harmonic oscillator (`saberHumHarmonic`) in both pitch and level sweeps spectral brightness cleanly.
    const hz1 = saberBasePitch * (1 + 0.62 * motion + (clashing ? 0.16 : 0))
    const hz2 = saberBasePitch * (1.048 + 1.55 * motion + (clashing ? 0.48 : 0))
    const lvl1 = clamp(0.28 + 0.11 * motion + (clashing ? 0.04 : 0), 0.1, 0.46, 0.28)
    const lvl2 = clamp(0.12 + 0.28 * motion + (clashing ? 0.1 : 0), 0.06, 0.5, 0.12)

    if (at) {
      if (saberId1) voice.place(saberId1, at, 16, -1)
      if (saberId2) voice.place(saberId2, at, 16, -1)
    }
    if (saberId1) voice.glide(saberId1, hz1, lvl1)
    if (saberId2) voice.glide(saberId2, hz2, lvl2)

    const now = clock()
    if (motion >= 0.5 && now - saberLastSwingAt >= 0.22) {
      saberLastSwingAt = now
      voice.play(COMBAT_PATCHES.saberSwing, {
        ...spatial(at ? { at } : undefined, 16, false),
        force: clamp(0.35 + 0.65 * motion, 0.2, 1, 0.65),
        size: clamp(1.15 - 0.38 * motion, 0.65, 1.3, 0.9),
      })
    }

    if (clashing) {
      if (!saberWasClashing || now - saberLastClashAt >= 0.18) {
        saberLastClashAt = now
        saberClash({ at, impulse: clamp(0.65 + 0.35 * motion, 0.4, 1, 0.8) })
      }
    }
    saberWasClashing = !!clashing
  }

  return {
    get saberActive() { return saberId1 !== 0 || saberId2 !== 0 },
    get laserActive() { return laserHumId !== 0 || laserSizzleId !== 0 },

    parryClash(opts) {
      const impulse = clamp(opts?.impulse ?? 0.85, 0.05, 1, 0.85)
      const size = clamp(opts?.size ?? 1, 0.35, 3, 1) * vary(0.06)
      const force = clamp(0.25 + 0.75 * impulse, 0.08, 1, 0.85) * vary(0.04)
      const played = voice.play(COMBAT_PATCHES.parryClash, {
        ...spatial(opts, 24, false),
        force: Math.min(1, force),
        size,
      })
      if (played && impulse >= 0.32) {
        voice.play(COMBAT_PATCHES.parrySparks, {
          ...spatial(opts, 20, false),
          force: clamp(impulse * 0.92, 0.15, 1, 0.75),
          size: size * 0.95,
        })
      }
      return played
    },

    bluntHit(opts) {
      const force = clamp(opts?.force ?? 0.8, 0.05, 1, 0.8) * vary(0.05)
      const mat = opts?.material ?? 'flesh'
      const base = BLUNT_PITCH[mat] ?? BLUNT_PITCH.flesh
      const size = clamp(opts?.size ?? 1, 0.4, 3, 1) * vary(0.05)
      return voice.play(COMBAT_PATCHES.bluntHit, {
        ...spatial(opts, 14, false),
        force: Math.min(1, force),
        pitch: clamp(base / size, 32, 420, base),
        size,
      })
    },

    bladeStab(opts) {
      const force = clamp(opts?.force ?? 0.78, 0.05, 1, 0.78)
      const dur = clamp(opts?.dur ?? 0.28, 0.05, 2.5, 0.28)
      const pullOut = !!opts?.pullOut
      const mat = opts?.material ?? 'flesh'
      const basePitch = (pullOut ? 380 : 295) * (mat === 'wood' ? 1.18 : mat === 'metal' ? 1.45 : 1) * vary(0.05)
      const played = voice.play(COMBAT_PATCHES.bladeStab, {
        ...spatial(opts, 12, false),
        force,
        dur,
        pitch: clamp(basePitch, 140, 1200, 310),
      })
      if (played && !pullOut) {
        voice.play(COMBAT_PATCHES.bluntHit, {
          ...spatial(opts, 10, false),
          force: clamp(force * 0.48, 0.08, 0.75, 0.4),
          pitch: BLUNT_PITCH[mat] ?? BLUNT_PITCH.flesh,
        })
      }
      return played
    },

    bladeScrape(opts) {
      const force = clamp(opts?.force ?? 0.65, 0.05, 1, 0.65)
      const dur = clamp(opts?.dur ?? 0.35, 0.05, 3, 0.35)
      const speed = clamp(opts?.speed ?? 1, 0.2, 4, 1)
      return voice.play(COMBAT_PATCHES.bladeScrape, {
        ...spatial(opts, 16, false),
        force,
        dur,
        pitch: clamp(760 * (0.7 + 0.3 * speed) * vary(0.04), 320, 2600, 920),
      })
    },

    saberIgnite(opts) {
      releaseSaber()
      saberBasePitch = clamp(opts?.pitch ?? COMBAT_PATCHES.saberHum.pitch, 45, 220, 92)
      const force = clamp(opts?.force ?? 0.86, 0.15, 1, 0.86)
      const base = spatial(opts, 18, false)
      voice.play(COMBAT_PATCHES.saberIgnite, { ...base, force, pitch: saberBasePitch * 1.55 })
      saberId1 = voice.hold(COMBAT_PATCHES.saberHum, { ...base, bus: BUS.world, pitch: saberBasePitch, force: 0.72 })
      saberId2 = voice.hold(COMBAT_PATCHES.saberHumHarmonic, { ...base, bus: BUS.world, pitch: saberBasePitch * 1.048, force: 0.44 })
      saberLastSwingAt = clock() - 1
      saberLastClashAt = clock() - 1
      return saberId1 !== 0 || saberId2 !== 0
    },

    saberRetract(opts) {
      releaseSaber()
      const force = clamp(opts?.force ?? 0.8, 0.15, 1, 0.8)
      voice.play(COMBAT_PATCHES.saberRetract, {
        ...spatial(opts, 16, false),
        force,
        pitch: clamp(saberBasePitch * 0.7, 36, 180, 64),
      })
    },

    saberUpdate,
    updateSaber: saberUpdate,
    saberClash,

    bulletCrack(opts) {
      const speed = clamp(opts?.speed ?? 780, 340, 1600, 780)
      const machBoost = clamp((speed - 340) / 800, 0, 1, 0.55)
      const force = clamp(opts?.force ?? 0.65 + 0.35 * machBoost, 0.08, 1, 0.85)
      const size = clamp(1.14 - 0.34 * machBoost, 0.7, 1.25, 0.95) * vary(0.05)
      return voice.play(COMBAT_PATCHES.bulletCrack, {
        ...spatial(opts, 48, true),
        force,
        size,
      })
    },

    ricochet(opts) {
      const force = clamp(opts?.force ?? 0.82, 0.08, 1, 0.82)
      const size = clamp(opts?.size ?? 1, 0.45, 2.2, 1) * vary(0.08)
      return voice.play(COMBAT_PATCHES.ricochet, {
        ...spatial(opts, 34, true),
        force,
        pitch: opts?.pitch !== undefined ? clamp(opts.pitch, 260, 3200, 840) : undefined,
        size,
      })
    },

    shockwaveBoom(opts) {
      const force = clamp(opts?.force ?? 0.92, 0.08, 1, 0.92)
      const radius = clamp(opts?.radius ?? 14, 2, 80, 14)
      const occ = typeof opts?.occluded === 'boolean'
        ? (opts.occluded ? 1 : 0)
        : clamp(opts?.occluded ?? 0, 0, 1, 0)
      const reach = opts?.reach ?? Math.max(24, radius * 5)
      const size = clamp(0.75 + radius / 20, 0.6, 3.5, 1.2)
      let ok = false

      if (occ < 0.85) {
        const crackForce = clamp(force * (1 - occ) ** 1.4, 0.05, 1, force)
        ok = voice.play(COMBAT_PATCHES.shockwaveCrack, {
          ...spatial(opts, reach * 0.5, true),
          force: crackForce,
          size: size * 0.85,
        }) || ok
      }
      if (occ < 0.7) {
        const boomForce = clamp(force * (1 - occ * 0.65), 0.08, 1, force)
        ok = voice.play(COMBAT_PATCHES.shockwaveBoom, {
          ...spatial(opts, reach, true),
          force: boomForce,
          size,
        }) || ok
      }
      if (occ >= 0.3) {
        const muffledForce = clamp(force * (0.45 + 0.55 * occ) * 0.88, 0.08, 0.92, 0.75)
        ok = voice.play(COMBAT_PATCHES.shockwaveOccluded, {
          ...spatial(opts, reach * 0.75, true),
          force: muffledForce,
          size: size * (1 + 0.15 * occ),
        }) || ok
      }
      return ok
    },

    laserSizzle(opts) {
      if (opts?.active === false) {
        laserStop()
        return false
      }
      const force = clamp(opts?.force ?? 0.76, 0.08, 1, 0.76)
      const heat = clamp(opts?.heat ?? 0.5, 0, 1, 0.5)
      const humPitch = 200 + 135 * heat
      const sizzlePitch = 470 + 240 * heat
      const base = spatial(opts, 22, false)

      if (opts?.active === true) {
        if (!laserHumId) {
          laserHumId = voice.hold(COMBAT_PATCHES.laserHum, { ...base, bus: BUS.world, pitch: humPitch, force: force * 0.78 })
        } else {
          if (opts.at) voice.place(laserHumId, opts.at, opts.reach ?? 22, -1)
          voice.glide(laserHumId, humPitch, clamp(0.18 + 0.18 * force, 0.08, 0.42, 0.28))
        }
        if (!laserSizzleId) {
          laserSizzleId = voice.hold(COMBAT_PATCHES.laserSizzle, { ...base, bus: BUS.world, pitch: sizzlePitch, force })
        }
        return laserHumId !== 0 || laserSizzleId !== 0
      }

      const dur = clamp(opts?.dur ?? 0.35, 0.05, 4, 0.35)
      const a = voice.play(COMBAT_PATCHES.laserSizzle, { ...base, force, dur, pitch: sizzlePitch })
      const b = voice.play(COMBAT_PATCHES.laserHum, { ...base, force: force * 0.78, dur, pitch: humPitch })
      return a || b
    },

    laserStop,

    tennisPop(opts) {
      const vel = clamp(opts?.velocity ?? opts?.force ?? 0.8, 0.08, 1, 0.8)
      const sweet = clamp(opts?.sweetSpot ?? 1, 0, 1, 1)
      const base = spatial(opts, 18, false)
      let ok = false

      if (sweet > 0.18) {
        const stringForce = clamp(vel * (0.25 + 0.75 * sweet), 0.06, 1, vel)
        const stringPitch = (470 + 125 * sweet + 48 * vel) * vary(0.03)
        ok = voice.play(COMBAT_PATCHES.tennisPop, { ...base, force: stringForce, pitch: stringPitch }) || ok
      }
      if (sweet < 0.82) {
        const frameForce = clamp(vel * (1 - sweet * 0.85), 0.08, 0.95, vel)
        const framePitch = (178 + 44 * (1 - sweet)) * vary(0.04)
        ok = voice.play(COMBAT_PATCHES.tennisFrame, { ...base, force: frameForce, pitch: framePitch }) || ok
      }
      return ok
    },

    tennisBounce(opts) {
      const surface = opts?.surface ?? 'hard'
      const tune = COURT_TUNING[surface] ?? COURT_TUNING.hard
      const vel = clamp(opts?.velocity ?? opts?.force ?? 0.75, 0.08, 1, 0.75)
      return voice.play(COMBAT_PATCHES.tennisBounce, {
        ...spatial(opts, 16, false),
        force: clamp(vel * tune.forceMul, 0.06, 1, vel),
        pitch: tune.pitch * vary(0.035),
        size: tune.size,
      })
    },

    tennisNet(opts) {
      const vel = clamp(opts?.velocity ?? opts?.force ?? 0.75, 0.08, 1, 0.75)
      return voice.play(COMBAT_PATCHES.tennisNet, {
        ...spatial(opts, 14, false),
        force: vel,
        size: vary(0.04),
      })
    },

    stopAll() {
      releaseSaber()
      laserStop()
    },
  }
}
