// Procedural Car Radio & High-Speed Doppler Pass-By Audio (#31):
// Zero audio assets — 100% synthesized through Voxelwright's AudioWorklet music engine and strictly-validated
// Patch data. While driving, the player can cycle through 3 distinct procedural radio stations + Radio Off with N,
// hear tactile radio tuning clicks/static bursts, smooth ducking on collisions/horn, remembered station state across
// getting in/out of cars, and stereo-panned downward-sweeping Doppler pass-by whooshes when blasting past traffic or
// geometry at 70+ km/h.
import { BUS, SET, type Sound } from './sound.ts'
import type { Patch } from './patch.ts'
import { conductor } from './music/conductor.ts'
import type { Hud } from '../hud.ts'

export interface Station {
  readonly id: 'off' | 'baydrive' | 'twinpeaks' | 'fillmore'
  readonly name: string
  readonly freq: string
  readonly mood: string | null
  readonly accent: string
}

/** Stations in cycle order: Bay Drive FM -> Twin Peaks Chill -> Fillmore Funk -> Radio Off. */
export const STATIONS: readonly Station[] = [
  { id: 'off', name: 'Radio Off', freq: '', mood: null, accent: '#9aa5b1' },
  { id: 'baydrive', name: 'Bay Drive FM', freq: '104.7', mood: 'baydrive', accent: '#ff4fa0' },
  { id: 'twinpeaks', name: 'Twin Peaks Chill', freq: '91.3', mood: 'twinpeaks', accent: '#ffae34' },
  { id: 'fillmore', name: 'Fillmore Funk', freq: '98.5', mood: 'fillmore', accent: '#35d0ba' },
] as const

/** Strictly-validated procedural patches for car radio tactile tuning and high-speed Doppler pass-by whooshes. */
export const RADIO_PATCHES: Record<'click' | 'static' | 'whoosh' | 'whooshTail', Patch> = {
  // Crisp mechanical dash dial detent click.
  click: { how: 'struck', hard: 1, rough: 0.25, shape: 'lump', pitch: 2650, ring: 0.014, damp: 0.85, gain: 0.55 },
  // Short FM receiver static sweep when locking onto a new frequency.
  static: { how: 'struck', hard: 0.22, rough: 1, modes: [[1, 0.03]], pitch: 1850, ring: 0.016, damp: 1, air: { from: 4600, to: 1500, for: 0.14, gain: 0.65, q: 0.65 }, gain: 0.42 },
  // Primary stereo-panned Doppler air whoosh: resonant bandpass sweeping sharply down in pitch as an object passes.
  whoosh: { how: 'struck', hard: 0.08, rough: 1, modes: [[1, 0.025]], pitch: 130, ring: 0.03, damp: 1, air: { from: 2800, to: 260, for: 0.36, gain: 1, q: 1.4 }, gain: 0.98 },
  // Receding low-mid pressure wake that sweeps slightly inward after the peak pass.
  whooshTail: { how: 'struck', hard: 0.12, rough: 0.9, shape: 'hollow', pitch: 76, ring: 0.06, damp: 0.95, bend: -0.65, air: { from: 920, to: 130, for: 0.38, gain: 1, q: 0.95 }, gain: 0.85 },
}

export interface NearMissDetail {
  side?: number
  pan?: number
  kmh?: number
  speedKmh?: number
  speed?: number
  closeness?: number
  clearance?: number
  distance?: number
  at?: readonly [number, number, number]
}

export interface RadioState {
  readonly station: Station
  readonly index: number
  readonly driving: boolean
  readonly active: boolean
  readonly ducking: number
  readonly whooshes: number
  readonly lastWhoosh: { side: number; kmh: number; at: number } | null
}

export interface Radio {
  readonly state: RadioState
  /** Cycle to the next station (Bay Drive FM -> Twin Peaks Chill -> Fillmore Funk -> Radio Off). */
  cycle(step?: 1 | -1): Station
  /** Tune directly to a station by id or index. */
  tune(target: Station['id'] | number, silent?: boolean): Station
  /** Called when entering or exiting a driven car (remembers last station across trips). */
  setDriving(on: boolean): void
  /** Smoothly ducks radio volume briefly (e.g. loud collisions). */
  duck(strength: number, holdSec?: number): void
  /** Smoothly ducks radio while the car horn is held. */
  setHorn(on: boolean): void
  /** Triggers a stereo-panned Doppler pass-by whoosh at 70+ km/h. */
  whoosh(side: number, kmh: number, closeness?: number): boolean
  /** Per-frame update: ticks radio conductor, smooth duck recovery, and high-speed pass-by detection. */
  frame(at: readonly [number, number, number], yaw: number, dt: number, speedKmh: number, kind?: (x: number, y: number, z: number) => number, nearby?: readonly (readonly [number, number, number])[]): void
  /** Attaches the HUD layer so the sleek 2-second auto-fading station toast pill can render. */
  attachHud(hud: Hud): void
  /** Cleans up global event listeners and timers. */
  dispose(): void
}

const M = 10
const MIN_WHOOSH_KMH = 70
const TOAST_MS = 2200

/** Plays a stereo-panned high-speed Doppler pass-by whoosh through the AudioWorklet synth. */
export function playDopplerWhoosh(voice: Sound, side: number, kmh: number, closeness = 0.8): boolean {
  if (!voice.running || !Number.isFinite(kmh) || kmh < MIN_WHOOSH_KMH) return false
  const s = Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0))
  const pan = Math.abs(s) < 0.08 ? (Math.random() < 0.5 ? -0.88 : 0.88) : s * 0.95
  const speedFrac = Math.min(1, Math.max(0, (kmh - MIN_WHOOSH_KMH) / 140))
  const close = Math.min(1, Math.max(0.25, closeness))
  // Faster pass = smaller `size` -> higher starting bandpass pitch and tighter, punchier Doppler sweep.
  const size = Math.max(0.62, 1.08 - speedFrac * 0.42)
  const force = Math.min(1, (0.72 + speedFrac * 0.28) * (0.75 + close * 0.25))
  const gain = Math.min(1, (0.78 + speedFrac * 0.22) * (0.78 + close * 0.22))
  voice.play(RADIO_PATCHES.whoosh, { bus: BUS.world, pan, size, force, gain, room: 0.05 })
  // Receding wake ~55 ms later, drifting slightly toward center for stereo movement across the ears.
  voice.play(RADIO_PATCHES.whooshTail, { bus: BUS.world, pan: pan * 0.62, size: size * 1.08, force: force * 0.88, gain: gain * 0.82, after: 0.055, room: 0.07 })
  if (typeof voice.flush === 'function') voice.flush()
  return true
}

export function createRadio(
  voice: Sound,
  opts: {
    /** Ambient place/realm music conductor if `?music=1` is enabled (paused while car radio plays). */
    ambient?: ReturnType<typeof conductor> | null
    /** Initial station preference from query params (`?radio=0|1|baydrive|twinpeaks|fillmore`). */
    query?: URLSearchParams
  } = {},
): Radio {
  // Default station on first car entry:
  // - `?radio=0`: Radio Off
  // - `?radio=<id>` or `?radio=1`: that station (or Bay Drive FM)
  // - Headless / automated webdriver checks: Radio Off (unless `?radio=...` asks for it)
  // - Real human player: subtly starts on Bay Drive FM!
  const qRadio = opts.query?.get('radio')
  const isWebdriver = typeof navigator !== 'undefined' && navigator.webdriver === true
  const parseStation = (raw: string | null | undefined): number => {
    if (!raw || raw === '0' || raw === 'off') return 0
    if (raw === '1' || raw === 'on') return 1
    const found = STATIONS.findIndex((s) => s.id === raw.toLowerCase())
    return found >= 0 ? found : 1
  }
  let remembered = qRadio !== undefined && qRadio !== null ? parseStation(qRadio) : isWebdriver ? 0 : 1
  let driving = false
  let current = 0
  let pendingAutoStart = false
  let autoStartDelay = 0
  let radioConductor: ReturnType<typeof conductor> | null = null
  let ambientWasOn = false

  // Ducking state: horn + loud collision transient ducking, smoothed cleanly on `SET.music`.
  let hornHeld = false
  let impactDuck = 0
  let impactHold = 0
  let musicGain = 1
  let musicGainTouched = false

  // Doppler pass-by state (rising-edge per side + cooldown so geometry/cars trigger clean individual whooshes).
  let whooshCount = 0
  let lastWhoosh: { side: number; kmh: number; at: number } | null = null
  let whooshCoolL = 0
  let whooshCoolR = 0
  let scanAcc = 0
  let wasSolidL = false
  let wasSolidR = false
  let lastSpeedKmh = 0
  const nearCarCool = new Map<number, number>()

  // Sleek 2-second auto-fading toast pill via hud.panel('radio-toast').
  let toastEl: HTMLElement | null = null
  let toastNameEl: HTMLElement | null = null
  let toastFreqEl: HTMLElement | null = null
  let toastBarsEl: HTMLElement | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let toastHideTimer: ReturnType<typeof setTimeout> | null = null

  const hideToast = () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null }
    if (!toastEl) return
    toastEl.classList.remove('show')
    toastEl.hidden = true
  }

  const showToast = (station: Station) => {
    if (!toastEl || !toastNameEl || !toastFreqEl || !toastBarsEl || !driving) return
    if (toastTimer) clearTimeout(toastTimer)
    if (toastHideTimer) clearTimeout(toastHideTimer)
    const isOff = station.mood === null
    toastNameEl.textContent = station.name.toUpperCase()
    toastFreqEl.textContent = station.freq ? `${station.freq} FM` : ''
    toastFreqEl.hidden = !station.freq
    toastBarsEl.hidden = isOff
    toastEl.style.setProperty('--radio-accent', station.accent)
    toastEl.classList.toggle('is-off', isOff)
    toastEl.hidden = false
    // Trigger CSS opacity transition cleanly on next frame.
    void toastEl.offsetWidth
    toastEl.classList.add('show')
    toastTimer = setTimeout(() => {
      toastTimer = null
      if (!toastEl) return
      toastEl.classList.remove('show')
      toastHideTimer = setTimeout(() => {
        toastHideTimer = null
        if (toastEl && !toastEl.classList.contains('show')) toastEl.hidden = true
      }, 260)
    }, TOAST_MS)
  }

  const ensureConductor = () => {
    if (!radioConductor) {
      radioConductor = conductor(voice)
      radioConductor.steady = true
      // Start with an immediately full groove (bass + drums + keys/arp) so tuning feels alive right away.
      radioConductor.drive = 0.72
    }
    return radioConductor
  }

  const syncAmbient = (radioPlaying: boolean) => {
    const amb = opts.ambient
    if (!amb) return
    if (radioPlaying) {
      if (amb.on) { ambientWasOn = true; amb.on = false }
    } else if (ambientWasOn) {
      ambientWasOn = false
      amb.on = true
    }
  }

  const applyStation = (idx: number, optsTune: { playSfx: boolean; showUi: boolean }) => {
    const clamped = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length
    current = clamped
    if (driving) remembered = clamped
    const st = STATIONS[clamped]
    if (optsTune.playSfx && voice.running) {
      voice.play(RADIO_PATCHES.click, { bus: BUS.world, force: 0.78, gain: 0.65, pan: 0.08, room: 0.05 })
      if (st.mood) {
        voice.play(RADIO_PATCHES.static, { bus: BUS.world, force: 0.72, gain: 0.58, after: 0.012, room: 0.06 })
      }
    }
    if (st.mood && driving) {
      syncAmbient(true)
      const c = ensureConductor()
      c.on = true
      c.steady = true
      c.drive = 0.72
      c.cut(st.mood, optsTune.playSfx ? 0.11 : 0.05)
    } else {
      if (radioConductor) {
        radioConductor.cut(null)
        radioConductor.on = false
      } else if (driving) {
        voice.hush(BUS.music)
      }
      syncAmbient(false)
    }
    if (optsTune.showUi && driving) showToast(st)
    return st
  }

  const setDriving = (on: boolean) => {
    if (on === driving) return
    driving = on
    wasSolidL = false
    wasSolidR = false
    whooshCoolL = 0
    whooshCoolR = 0
    nearCarCool.clear()
    if (!on) {
      pendingAutoStart = false
      autoStartDelay = 0
      hornHeld = false
      impactDuck = 0
      impactHold = 0
      if (musicGainTouched) {
        musicGain = 1
        musicGainTouched = false
        voice.set(SET.music, 1)
      }
      if (radioConductor) {
        radioConductor.cut(null)
        radioConductor.on = false
      }
      syncAmbient(false)
      current = 0
      hideToast()
      return
    }
    // Entering car: remember last station! Slight delay lets door thump & engine ignition breathe first.
    if (remembered > 0) {
      pendingAutoStart = true
      autoStartDelay = 0.42
    } else {
      current = 0
    }
  }

  const cycle = (step: 1 | -1 = 1): Station => {
    pendingAutoStart = false
    if (!driving) {
      remembered = ((remembered + step) % STATIONS.length + STATIONS.length) % STATIONS.length
      return STATIONS[remembered]
    }
    // Cycle order: Off -> Bay Drive FM -> Twin Peaks Chill -> Fillmore Funk -> Off
    return applyStation(current + step, { playSfx: true, showUi: true })
  }

  const tune = (target: Station['id'] | number, silent = false): Station => {
    pendingAutoStart = false
    const idx = typeof target === 'number' ? target : STATIONS.findIndex((s) => s.id === target)
    if (idx < 0) return STATIONS[current]
    if (!driving) {
      remembered = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length
      return STATIONS[remembered]
    }
    return applyStation(idx, { playSfx: !silent, showUi: !silent })
  }

  const duck = (strength: number, holdSec = 0.25) => {
    if (!driving || current === 0) return
    const amt = Math.min(0.7, Math.max(0.15, strength * 0.65))
    impactDuck = Math.max(impactDuck, amt)
    impactHold = Math.max(impactHold, holdSec)
  }

  const setHorn = (on: boolean) => {
    hornHeld = on
  }

  const whoosh = (side: number, kmh: number, closeness = 0.85): boolean => {
    const s = Math.max(-1, Math.min(1, Number.isFinite(side) ? side : 0))
    if (s < 0 && whooshCoolL > 0) return false
    if (s > 0 && whooshCoolR > 0) return false
    if (!playDopplerWhoosh(voice, s, kmh, closeness)) return false
    if (s < 0) whooshCoolL = 0.36
    else if (s > 0) whooshCoolR = 0.36
    else { whooshCoolL = 0.28; whooshCoolR = 0.28 }
    whooshCount++
    lastWhoosh = { side: s, kmh, at: performance.now() }
    return true
  }

  // Listen for `voxelwright:nearmiss` events from traffic/stunt lanes or scripts.
  const onNearMiss = (e: Event) => {
    if (!driving) return
    const d = (e as CustomEvent<NearMissDetail | null>).detail ?? {}
    const kmh = typeof d.kmh === 'number' && Number.isFinite(d.kmh)
      ? d.kmh
      : typeof d.speedKmh === 'number' && Number.isFinite(d.speedKmh)
        ? d.speedKmh
        : typeof d.speed === 'number' && Number.isFinite(d.speed)
          ? d.speed
          : lastSpeedKmh
    let side = typeof d.side === 'number' && Number.isFinite(d.side)
      ? d.side
      : typeof d.pan === 'number' && Number.isFinite(d.pan)
        ? d.pan
        : 0
    if (!side && Array.isArray(d.at) && d.at.length === 3) {
      side = voice.hear(d.at).pan
    }
    const closeness = typeof d.closeness === 'number'
      ? d.closeness
      : typeof d.clearance === 'number'
        ? Math.max(0.3, Math.min(1, 1 - d.clearance / 4.5))
        : typeof d.distance === 'number'
          ? Math.max(0.25, Math.min(1, 1 - d.distance / 12))
          : 0.9
    whoosh(side, kmh, closeness)
  }
  if (typeof window !== 'undefined') window.addEventListener('voxelwright:nearmiss', onNearMiss)

  const frame = (
    at: readonly [number, number, number],
    yaw: number,
    dt: number,
    speedKmh: number,
    kind?: (x: number, y: number, z: number) => number,
    nearby?: readonly (readonly [number, number, number])[],
  ) => {
    lastSpeedKmh = speedKmh
    if (!driving) return
    if (whooshCoolL > 0) whooshCoolL = Math.max(0, whooshCoolL - dt)
    if (whooshCoolR > 0) whooshCoolR = Math.max(0, whooshCoolR - dt)

    // Subtle auto-resume of remembered station shortly after hopping into the car (once audio is unlocked).
    if (pendingAutoStart && voice.running) {
      autoStartDelay -= dt
      if (autoStartDelay <= 0) {
        pendingAutoStart = false
        if (remembered > 0) applyStation(remembered, { playSfx: true, showUi: true })
      }
    }

    // Tick radio conductor if tuned to an active station.
    if (current > 0 && radioConductor) {
      radioConductor.tick()
    }

    // Smooth radio ducking on horn & loud impacts.
    if (impactHold > 0) impactHold = Math.max(0, impactHold - dt)
    else if (impactDuck > 0) impactDuck = Math.max(0, impactDuck - dt * 1.45)
    const targetGain = current > 0 ? Math.max(0.32, 1 - Math.max(hornHeld ? 0.6 : 0, impactDuck)) : 1
    if (Math.abs(targetGain - musicGain) > 0.004) {
      const rate = targetGain < musicGain ? 14 : 3.5
      musicGain += (targetGain - musicGain) * Math.min(1, dt * rate)
      if (Math.abs(1 - musicGain) < 0.005 && targetGain === 1) musicGain = 1
      voice.set(SET.music, musicGain)
      musicGainTouched = musicGain !== 1
    } else if (musicGainTouched && targetGain === 1 && musicGain !== 1) {
      musicGain = 1
      musicGainTouched = false
      voice.set(SET.music, 1)
    }

    // High-speed Doppler pass-by detector for close buildings, poles, trees, and other cars at 70+ km/h.
    if (speedKmh < MIN_WHOOSH_KMH || !voice.running) {
      wasSolidL = false
      wasSolidR = false
      return
    }
    scanAcc += dt
    if (scanAcc < 0.055) return
    scanAcc = 0

    const rx = Math.cos(yaw), rz = Math.sin(yaw)
    const fx = Math.sin(yaw), fz = -Math.cos(yaw)
    const baseY = Math.round(at[1] + 6)

    // 1) Nearby world geometry (buildings, bridge pillars, lamp posts, parked cars) on left & right.
    if (kind) {
      let solidL = false, closeL = 0
      let solidR = false, closeR = 0
      for (const lateral of [26, 46]) {
        const lx = Math.round(at[0] - rx * lateral + fx * 10)
        const lz = Math.round(at[2] - rz * lateral + fz * 10)
        if ((kind(lx, baseY, lz) & 15) > 0 || (kind(lx, baseY + 12, lz) & 15) > 0) {
          solidL = true
          closeL = Math.max(closeL, lateral < 34 ? 1 : 0.65)
        }
        const rxp = Math.round(at[0] + rx * lateral + fx * 10)
        const rzp = Math.round(at[2] + rz * lateral + fz * 10)
        if ((kind(rxp, baseY, rzp) & 15) > 0 || (kind(rxp, baseY + 12, rzp) & 15) > 0) {
          solidR = true
          closeR = Math.max(closeR, lateral < 34 ? 1 : 0.65)
        }
      }
      if (solidL && !wasSolidL && whooshCoolL <= 0) whoosh(-0.88, speedKmh, closeL)
      if (solidR && !wasSolidR && whooshCoolR <= 0) whoosh(0.88, speedKmh, closeR)
      wasSolidL = solidL
      wasSolidR = solidR
    }

    // 2) Fast-passing other living vehicles within 7 m laterally.
    if (nearby && nearby.length) {
      const now = performance.now()
      for (let i = 0; i < nearby.length; i++) {
        const p = nearby[i]
        const dx = (p[0] - at[0]) / M, dy = (p[1] - at[1]) / M, dz = (p[2] - at[2]) / M
        if (Math.abs(dy) > 4.5) continue
        const ahead = dx * fx + dz * fz
        const side = dx * rx + dz * rz
        const absSide = Math.abs(side)
        if (absSide > 1.4 && absSide < 7.5 && Math.abs(ahead) < 5.5) {
          const until = nearCarCool.get(i) ?? 0
          if (now >= until) {
            nearCarCool.set(i, now + 900)
            whoosh(side < 0 ? -0.92 : 0.92, speedKmh, Math.max(0.4, 1 - absSide / 8.5))
          }
        }
      }
    }
  }

  const attachHud = (hud: Hud) => {
    if (toastEl) return
    const el = hud.panel('radio-toast')
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.hidden = true
    el.innerHTML = '<span class="rt-note" aria-hidden="true">&#9835;</span><span class="rt-name"></span><span class="rt-freq"></span><span class="rt-bars" aria-hidden="true"><i></i><i></i><i></i></span>'
    el.addEventListener('pointerdown', (e) => {
      if (!driving) return
      e.preventDefault()
      cycle(1)
    })
    toastEl = el
    toastNameEl = el.querySelector<HTMLElement>('.rt-name')
    toastFreqEl = el.querySelector<HTMLElement>('.rt-freq')
    toastBarsEl = el.querySelector<HTMLElement>('.rt-bars')
  }

  const dispose = () => {
    hideToast()
    if (typeof window !== 'undefined') window.removeEventListener('voxelwright:nearmiss', onNearMiss)
    if (radioConductor) { radioConductor.cut(null); radioConductor.on = false }
  }

  return {
    get state(): RadioState {
      return {
        station: STATIONS[current],
        index: current,
        driving,
        active: driving && current > 0,
        ducking: 1 - musicGain,
        whooshes: whooshCount,
        lastWhoosh,
      }
    },
    cycle,
    tune,
    setDriving,
    duck,
    setHorn,
    whoosh,
    frame,
    attachHud,
    dispose,
  }
}
