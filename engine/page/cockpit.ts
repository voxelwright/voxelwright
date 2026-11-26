// First-person Driver Seat cockpit immersion (#33): active ONLY while sitting inside a vehicle (`alive.inside`).
// Provides spring-damped head G-force inertia (launch, braking, cornering, suspension bumps, landings, gearshifts),
// a lightweight transparent windshield overlay with beaded/streaking raindrops cleared by twin synchronized wipers
// whose cadence adapts to rain intensity, and a minimal backlit interior dash vignette at night.
// Outside the seat, or in dry daylight for the overlay, it allocates nothing and performs zero DOM/canvas work.
import type { Hud } from './hud.ts'

export interface CockpitInput {
  dt: number
  /** Longitudinal acceleration (cells/s^2, positive accelerating, negative braking). */
  longAcc: number
  /** Lateral velocity (cells/s, positive rightward). */
  latSpeed: number
  /** Forward velocity (cells/s). */
  fwdSpeed: number
  /** Vertical velocity (cells/s, positive upward). */
  vertVel: number
  /** Steering input (-1..1). */
  steer: number
  /** Surface roughness (0..1; ~0.05 dry asphalt, ~0.32 wet, ~0.9 off-road). */
  rough: number
  /** Rain intensity (0..1). */
  rain: number
  /** Daylight factor (0..1; 1 bright day, 0 night). */
  day: number
  /** Normalized engine RPM (0..1). */
  rpm: number
  /** Whether the vehicle is currently drifting. */
  drifting: boolean
  /** True when prefers-reduced-motion: reduce is active. */
  reducedMotion: boolean
  /** True for wheeled vehicles with a windshield and dashboard (`drive` scheme). */
  isDrive: boolean
  /** Vehicle top speed (cells/s). */
  topSpeed: number
}

export interface CockpitPose {
  /** Local forward head offset (cells, clamped inside cabin envelope). */
  fwd: number
  /** Local lateral head offset (cells, clamped inside cabin envelope). */
  lat: number
  /** Local vertical head offset (cells, clamped inside cabin envelope). */
  up: number
  /** Head pitch offset (radians). */
  pitch: number
  /** Head roll offset (radians). */
  roll: number
  /** Subtle corner apex look-ahead yaw offset (radians). */
  yaw: number
}

export interface CockpitState {
  active: boolean
  canvasVisible: boolean
  drops: number
  wiperAngle: number
  wiperSweeping: boolean
  nightGlow: number
  pose: CockpitPose
}

export interface Cockpit {
  frame(input: CockpitInput): CockpitPose
  jolt(kind: 'land' | 'hit' | 'shift', strength: number): void
  reset(): void
  readonly state: CockpitState
}

interface Spring { p: number; v: number }
interface Drop {
  alive: boolean
  x: number
  y: number
  r: number
  vx: number
  vy: number
  alpha: number
  age: number
  life: number
  run: boolean
  warm: boolean
  seed: number
}

const ZERO_POSE: CockpitPose = { fwd: 0, lat: 0, up: 0, pitch: 0, roll: 0, yaw: 0 }
const MAX_DROPS = 220
const WIPER_PARK = -0.10
const WIPER_PEAK = -2.14
const RAIN_ON = 0.1
const NIGHT_ON = 0.06

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

const stepSpring = (s: Spring, target: number, omega: number, zeta: number, dt: number): number => {
  const steps = dt > 0.025 ? Math.ceil(dt / 0.016) : 1
  const h = dt / steps
  const k = omega * omega
  const c = 2 * zeta * omega
  for (let i = 0; i < steps; i++) {
    const a = (target - s.p) * k - c * s.v
    s.v += a * h
    s.p += s.v * h
  }
  return s.p
}

const resetSpring = (s: Spring) => { s.p = 0; s.v = 0 }

export function cockpit(hud: Hud): Cockpit {
  // Spring-damped driver head axes (all zeroed when outside or reduced-motion).
  const sFwd: Spring = { p: 0, v: 0 }
  const sLat: Spring = { p: 0, v: 0 }
  const sUp: Spring = { p: 0, v: 0 }
  const sPitch: Spring = { p: 0, v: 0 }
  const sRoll: Spring = { p: 0, v: 0 }
  const sYaw: Spring = { p: 0, v: 0 }

  let active = false
  let prevVert = 0
  let hasPrev = false
  let vibPhase = 0
  let lastPose: CockpitPose = { ...ZERO_POSE }

  // Lazy DOM/canvas overlay: never created until actually sitting inside in rain or at night.
  let panel: HTMLElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let canvasVisible = false
  let backingW = 0, backingH = 0, backingDpr = 0

  // Rain & twin synchronized wiper state (allocated lazily on first rainy cockpit frame).
  let drops: Drop[] | null = null
  let dropCount = 0
  let spawnAcc = 0
  let wiperTimer = 0
  let wiperAngle = WIPER_PARK
  let prevWiperAngle = WIPER_PARK
  let wiperSweeping = false
  let nightGlowNow = 0
  let rng = 0x51a7c3d1

  const rand = () => {
    let s = rng
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    rng = s
    return (s >>> 0) / 4294967296
  }

  const ensureCanvas = (): CanvasRenderingContext2D | null => {
    if (ctx) return ctx
    if (typeof document === 'undefined') return null
    panel = hud.panel('cockpit')
    // Keep the cockpit glass layer behind all HUD cards, drive cluster, touch keys, and minimap.
    panel.parentElement?.prepend(panel)
    panel.hidden = true
    canvas = document.createElement('canvas')
    canvas.className = 'cockpit-glass'
    canvas.setAttribute('aria-hidden', 'true')
    panel.append(canvas)
    ctx = canvas.getContext('2d')
    return ctx
  }

  const ensureDrops = (): Drop[] => {
    if (drops) return drops
    drops = Array.from({ length: MAX_DROPS }, () => ({
      alive: false, x: 0, y: 0, r: 2, vx: 0, vy: 0, alpha: 0, age: 0, life: 4, run: false, warm: false, seed: 0,
    }))
    return drops
  }

  const clearDrops = () => {
    if (!drops) return
    for (let i = 0; i < MAX_DROPS; i++) drops[i].alive = false
    dropCount = 0
    spawnAcc = 0
  }

  const hideCanvas = () => {
    if (panel && !panel.hidden) panel.hidden = true
    if (ctx && canvasVisible) ctx.clearRect(0, 0, backingW, backingH)
    canvasVisible = false
    nightGlowNow = 0
    wiperSweeping = false
    wiperAngle = WIPER_PARK
    prevWiperAngle = WIPER_PARK
  }

  // Windshield glass aperture (between roof header and dashboard cowl so drops/wipers stay cleanly on the glass).
  const headY = (h: number) => h * 0.105
  const cowlY = (h: number) => h * 0.58

  const spawnDrop = (pool: Drop[], rain: number, night: number, prefill: boolean) => {
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = pool[i]
      if (d.alive) continue
      const big = rand() < 0.28 + 0.18 * rain
      const x = 0.04 + rand() * 0.92
      const y = 0.115 + rand() * 0.455
      d.alive = true
      d.x = x; d.y = y
      d.r = big ? 2.9 + rand() * 2.5 : 1.4 + rand() * 1.6
      d.vx = 0; d.vy = 0
      d.alpha = prefill ? 0.65 + rand() * 0.35 : 0.35 + rand() * 0.4
      d.age = prefill ? rand() * 1.4 : 0
      d.life = 3.4 + rand() * 4.4
      d.run = big && rand() < 0.72
      d.warm = night > 0.2 && rand() < 0.36
      d.seed = rand() * Math.PI * 2
      dropCount++
      return
    }
  }

  const wiperGeometry = (w: number, h: number) => {
    const cy = cowlY(h)
    const pivotY = cy + h * 0.035
    const lenL = Math.min(h * 0.48, Math.max(w * 0.30, h * 0.36))
    const lenR = Math.min(h * 0.45, Math.max(w * 0.27, h * 0.33))
    return [
      { px: w * 0.47, py: pivotY, len: lenL },
      { px: w * 0.80, py: pivotY, len: lenR },
    ] as const
  }

  const drawNightDash = (g: CanvasRenderingContext2D, w: number, h: number, night: number, rpm: number) => {
    // Subtle dark interior brow and lower dash framing vignette at night.
    const topGrad = g.createLinearGradient(0, 0, 0, h * 0.12)
    topGrad.addColorStop(0, `rgba(4, 7, 13, ${(0.34 * night).toFixed(3)})`)
    topGrad.addColorStop(1, 'rgba(4, 7, 13, 0)')
    g.fillStyle = topGrad
    g.fillRect(0, 0, w, h * 0.12)

    const botH = Math.max(90, h * 0.28)
    const botY = h - botH
    const botGrad = g.createLinearGradient(0, botY, 0, h)
    botGrad.addColorStop(0, 'rgba(4, 7, 13, 0)')
    botGrad.addColorStop(0.55, `rgba(5, 8, 15, ${(0.24 * night).toFixed(3)})`)
    botGrad.addColorStop(1, `rgba(3, 6, 12, ${(0.52 * night).toFixed(3)})`)
    g.fillStyle = botGrad
    g.fillRect(0, botY, w, botH)

    // Warm backlit instrument-cluster ambient bounce glow rising over the driver's dash binnacle (warms toward redline).
    const hot = clamp((rpm - 0.65) / 0.32, 0, 1)
    const dashR = 255
    const dashG = Math.round(156 - 78 * hot)
    const dashB = Math.round(62 - 26 * hot)
    const binnacleAlpha = night * (0.24 + 0.12 * rpm)

    g.save()
    g.translate(w * 0.48, h * 0.99)
    g.scale(1, 0.36)
    const radL = Math.max(210, w * 0.34)
    const glowL = g.createRadialGradient(0, 0, 0, 0, 0, radL)
    glowL.addColorStop(0, `rgba(${dashR}, ${dashG}, ${dashB}, ${binnacleAlpha.toFixed(3)})`)
    glowL.addColorStop(0.45, `rgba(${dashR}, ${dashG}, ${dashB}, ${(binnacleAlpha * 0.42).toFixed(3)})`)
    glowL.addColorStop(1, `rgba(${dashR}, ${dashG}, ${dashB}, 0)`)
    g.fillStyle = glowL
    g.beginPath()
    g.arc(0, 0, radL, 0, Math.PI * 2)
    g.fill()
    g.restore()

    // Secondary cool ice-cyan console ambient accent along the lower-right dash contour.
    g.save()
    g.translate(w * 0.66, h * 1.0)
    g.scale(1, 0.34)
    const radR = Math.max(160, w * 0.25)
    const glowR = g.createRadialGradient(0, 0, 0, 0, 0, radR)
    const iceAlpha = night * 0.17
    glowR.addColorStop(0, `rgba(82, 198, 255, ${iceAlpha.toFixed(3)})`)
    glowR.addColorStop(0.55, `rgba(82, 198, 255, ${(iceAlpha * 0.32).toFixed(3)})`)
    glowR.addColorStop(1, 'rgba(82, 198, 255, 0)')
    g.fillStyle = glowR
    g.beginPath()
    g.arc(0, 0, radR, 0, Math.PI * 2)
    g.fill()
    g.restore()

    // Crisp backlit dash ambient strip along the lower cockpit edge (fades clear of minimap & drive-hud).
    const x0 = w * 0.24, x1 = w * 0.76
    const stripGrad = g.createLinearGradient(x0, 0, x1, 0)
    stripGrad.addColorStop(0, 'rgba(255, 160, 70, 0)')
    stripGrad.addColorStop(0.30, `rgba(${dashR}, ${dashG}, ${dashB}, ${(0.48 * night).toFixed(3)})`)
    stripGrad.addColorStop(0.64, `rgba(96, 202, 255, ${(0.36 * night).toFixed(3)})`)
    stripGrad.addColorStop(1, 'rgba(96, 202, 255, 0)')
    g.fillStyle = stripGrad
    g.fillRect(x0, h - 3, x1 - x0, 2.5)
  }

  const drawRainAndWipers = (
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    input: CockpitInput,
    night: number,
  ) => {
    const pool = ensureDrops()
    const rain = clamp(input.rain, 0, 1)
    const rainNorm = clamp((rain - RAIN_ON) / (1 - RAIN_ON), 0, 1)
    const kmh = Math.abs(input.fwdSpeed) * 0.36
    const cy = cowlY(h)
    const wipers = wiperGeometry(w, h)

    // Pre-populate lightly on the very first rainy inside frame so the glass immediately feels wet.
    if (dropCount === 0) {
      const initial = Math.round(48 + 100 * rainNorm)
      for (let i = 0; i < initial; i++) spawnDrop(pool, rainNorm, night, true)
    }

    // Advance twin synchronized wiper sweep cadence (parked calmly under reduced-motion).
    prevWiperAngle = wiperAngle
    if (input.reducedMotion) {
      wiperAngle = WIPER_PARK
      wiperSweeping = false
    } else {
      const sweepDur = 1.15 - 0.42 * rainNorm
      const dwell = (1 - rainNorm) * (1 - rainNorm) * 1.85
      const period = sweepDur + dwell
      wiperTimer = (wiperTimer + input.dt) % period
      if (wiperTimer < sweepDur) {
        wiperSweeping = true
        const u = wiperTimer / sweepDur
        let sweep: number
        if (u < 0.48) {
          sweep = 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.48)
        } else if (u < 0.54) {
          sweep = 1
        } else {
          sweep = 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.54)) / 0.46)
        }
        wiperAngle = WIPER_PARK + (WIPER_PEAK - WIPER_PARK) * sweep
      } else {
        wiperSweeping = false
        wiperAngle = WIPER_PARK
      }
    }

    // Spawn fresh raindrops proportional to intensity.
    const cap = Math.round(70 + (MAX_DROPS - 70) * rainNorm)
    spawnAcc += (46 + 150 * rainNorm) * input.dt
    while (spawnAcc >= 1 && dropCount < cap) {
      spawnAcc -= 1
      spawnDrop(pool, rainNorm, night, false)
    }
    if (spawnAcc > 5) spawnAcc = 5

    // Angular interval swept by the wiper blades this frame for physical drop clearing.
    const swept = Math.abs(wiperAngle - prevWiperAngle) > 0.002
    const aLo = Math.min(wiperAngle, prevWiperAngle) - 0.05
    const aHi = Math.max(wiperAngle, prevWiperAngle) + 0.05

    const airflow = kmh > 36 ? clamp((kmh - 36) / 110, 0, 1) : 0
    const latPush = clamp(-input.latSpeed * 0.0018, -0.18, 0.18)
    const scale = Math.max(0.75, Math.min(1.35, h / 720))

    // Clip windshield rain and wipers strictly to the glass aperture between roof header and dashboard cowl.
    const hy = headY(h)
    g.save()
    g.beginPath()
    g.moveTo(0, hy)
    g.quadraticCurveTo(w * 0.5, hy - h * 0.012, w, hy)
    g.lineTo(w, cy + h * 0.02)
    g.quadraticCurveTo(w * 0.5, cy - h * 0.02, 0, cy + h * 0.02)
    g.closePath()
    g.clip()

    // Subtle damp edge mist outside the central swept glass during heavier storms.
    if (rainNorm > 0.25) {
      const mistAlpha = (rainNorm - 0.25) * 0.09 * (1 - 0.25 * night)
      const mist = g.createRadialGradient(w * 0.54, cy * 0.72, Math.min(w, h) * 0.22, w * 0.54, cy * 0.65, Math.max(w, h) * 0.68)
      mist.addColorStop(0, 'rgba(185, 208, 228, 0)')
      mist.addColorStop(1, `rgba(170, 202, 232, ${mistAlpha.toFixed(3)})`)
      g.fillStyle = mist
      g.fillRect(0, 0, w, cy + h * 0.04)
    }

    for (let i = 0; i < MAX_DROPS; i++) {
      const d = pool[i]
      if (!d.alive) continue
      d.age += input.dt
      if (d.age >= d.life) {
        d.alive = false
        dropCount--
        continue
      }
      const fadeIn = clamp(d.age / 0.14, 0, 1)
      const fadeOut = clamp((d.life - d.age) / 0.45, 0, 1)
      const a = d.alpha * fadeIn * fadeOut

      if (!input.reducedMotion && d.run) {
        // Low speed: gravity streaks down; highway speed: airflow blows streaks upward and outward.
        const downY = (0.055 + d.r * 0.026) * (1 - airflow * 1.45)
        const upY = -airflow * (0.16 + d.r * 0.032)
        const targetVy = downY + upY
        const meander = Math.sin(d.age * 4.5 + d.seed) * 0.012
        const outX = (d.x - 0.5) * airflow * 0.16 + latPush + meander
        d.vx += (outX - d.vx) * Math.min(1, input.dt * 6)
        d.vy += (targetVy - d.vy) * Math.min(1, input.dt * 5)
        d.x += d.vx * input.dt
        d.y += d.vy * input.dt
      } else if (!input.reducedMotion) {
        // Clinging beads slowly swell and occasionally break free into a running streak.
        d.r = Math.min(4.2, d.r + input.dt * 0.15 * rainNorm)
        if (d.r > 3.2 && rand() < input.dt * 0.5) d.run = true
      }

      if (d.x < -0.02 || d.x > 1.02 || d.y < 0.05 || d.y > 0.64) {
        d.alive = false
        dropCount--
        continue
      }

      const sx = d.x * w
      const sy = d.y * h

      // Physical wiper blade clearing test.
      if (swept) {
        let wiped = false
        for (let b = 0; b < 2; b++) {
          const wp = wipers[b]
          const dx = sx - wp.px
          const dy = sy - wp.py
          const dist = Math.hypot(dx, dy)
          if (dist >= wp.len * 0.22 && dist <= wp.len * 1.03) {
            const ang = Math.atan2(dy, dx)
            if (ang >= aLo && ang <= aHi) {
              wiped = true
              break
            }
          }
        }
        if (wiped) {
          d.alive = false
          dropCount--
          continue
        }
      }

      const rr = d.r * scale
      const speedPx = Math.hypot(d.vx * w, d.vy * h)
      const stretch = d.run && !input.reducedMotion ? clamp(speedPx * 0.03, 0, 5.0) : 0

      // Glossy wet streak trail behind running raindrops.
      if (stretch > 0.35) {
        const tx = sx - d.vx * w * 0.16
        const ty = sy - d.vy * h * 0.16
        g.strokeStyle = d.warm
          ? `rgba(255, 224, 178, ${(0.22 * a).toFixed(3)})`
          : `rgba(205, 228, 252, ${(0.24 * a).toFixed(3)})`
        g.lineWidth = Math.max(1.2, rr * 0.55)
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(tx, ty)
        g.lineTo(sx, sy)
        g.stroke()
      }

      // Refracted water bead: dark meniscus rim, translucent dome, lower caustic glint, crisp top specular dot.
      const ry = rr * (1 + stretch * 0.24)
      g.fillStyle = `rgba(6, 12, 22, ${(0.44 * a).toFixed(3)})`
      g.beginPath()
      g.ellipse(sx, sy + rr * 0.26, rr * 1.08, ry * 1.04, 0, 0, Math.PI * 2)
      g.fill()

      g.fillStyle = night > 0.25
        ? `rgba(182, 214, 248, ${(0.36 * a).toFixed(3)})`
        : `rgba(218, 236, 252, ${(0.34 * a).toFixed(3)})`
      g.beginPath()
      g.ellipse(sx, sy, rr, ry, 0, 0, Math.PI * 2)
      g.fill()

      // Lower refracted caustic arc (catches sodium streetlights or bright sky).
      g.fillStyle = d.warm
        ? `rgba(255, 210, 140, ${(0.52 * a).toFixed(3)})`
        : `rgba(220, 240, 255, ${(0.42 * a).toFixed(3)})`
      g.beginPath()
      g.ellipse(sx + rr * 0.1, sy + ry * 0.38, rr * 0.55, ry * 0.28, 0, 0, Math.PI * 2)
      g.fill()

      // Sharp upper-left specular highlight pinpoint.
      const glintR = Math.max(0.8, rr * 0.34)
      g.fillStyle = d.warm
        ? `rgba(255, 232, 188, ${(0.82 * a).toFixed(3)})`
        : `rgba(255, 255, 255, ${(0.82 * a).toFixed(3)})`
      g.beginPath()
      g.arc(sx - rr * 0.30, sy - ry * 0.30, glintR, 0, Math.PI * 2)
      g.fill()
    }

    // Draw twin synchronized dark wiper arms, articulated blades, and leading-edge water sheen.
    const cosA = Math.cos(wiperAngle)
    const sinA = Math.sin(wiperAngle)
    const nx = -sinA
    const ny = cosA
    const sweepDir = wiperAngle >= prevWiperAngle ? 1 : -1

    for (let b = 0; b < 2; b++) {
      const wp = wipers[b]
      const r0 = wp.len * 0.24
      const rMid = wp.len * 0.62
      const r1 = wp.len

      // Subtle outer swept arc film line in heavy rain.
      if (rainNorm > 0.2) {
        g.strokeStyle = `rgba(195, 222, 248, ${(0.11 * rainNorm).toFixed(3)})`
        g.lineWidth = 1.6 * scale
        g.beginPath()
        g.arc(wp.px, wp.py, r1, WIPER_PEAK, WIPER_PARK)
        g.stroke()
      }

      const x0 = wp.px + cosA * r0, y0 = wp.py + sinA * r0
      const xm = wp.px + cosA * rMid, ym = wp.py + sinA * rMid
      const x1 = wp.px + cosA * r1, y1 = wp.py + sinA * r1

      // Leading-edge water film pushed by the sweeping rubber blade.
      if (wiperSweeping) {
        const lx = nx * sweepDir * 3.8 * scale
        const ly = ny * sweepDir * 3.8 * scale
        g.strokeStyle = `rgba(215, 236, 255, ${(0.30 * (0.5 + 0.5 * rainNorm)).toFixed(3)})`
        g.lineWidth = 2.6 * scale
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(x0 + lx, y0 + ly)
        g.lineTo(x1 + lx, y1 + ly)
        g.stroke()
      }

      // Soft shadow cast on the glass behind the blade.
      g.strokeStyle = 'rgba(0, 0, 0, 0.42)'
      g.lineWidth = 9.0 * scale
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(x0 + 2, y0 + 3)
      g.lineTo(x1 + 2, y1 + 3)
      g.stroke()

      // Lower wiper arm from cowl pivot to blade mount.
      g.strokeStyle = 'rgba(18, 22, 28, 0.94)'
      g.lineWidth = 6.2 * scale
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(wp.px, wp.py)
      g.lineTo(xm, ym)
      g.stroke()

      // Articulated dark rubber wiper blade.
      g.strokeStyle = 'rgba(12, 15, 21, 0.96)'
      g.lineWidth = 5.4 * scale
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()

      // Crisp specular spine along the blade so it reads cleanly even against a dark night sky.
      g.strokeStyle = `rgba(180, 202, 228, ${(0.32 + 0.12 * (1 - night)).toFixed(3)})`
      g.lineWidth = 1.4 * scale
      g.beginPath()
      g.moveTo(x0 - nx * 1.5, y0 - ny * 1.5)
      g.lineTo(x1 - nx * 1.5, y1 - ny * 1.5)
      g.stroke()
    }

    g.restore()
  }

  return {
    jolt(kind, strength) {
      if (!active) return
      const s = clamp(strength, 0, 1.5)
      if (kind === 'land') {
        sUp.v -= s * 5.0
        sPitch.v -= s * 0.40
        sFwd.v += s * 1.3
      } else if (kind === 'hit') {
        sFwd.v += s * 6.2
        sPitch.v -= s * 0.52
        sRoll.v += (rand() < 0.5 ? -1 : 1) * s * 0.44
        sUp.v -= s * 2.4
      } else if (kind === 'shift') {
        sFwd.v += s * 1.85
        sPitch.v -= s * 0.11
      }
    },

    reset() {
      active = false
      hasPrev = false
      prevVert = 0
      vibPhase = 0
      resetSpring(sFwd); resetSpring(sLat); resetSpring(sUp)
      resetSpring(sPitch); resetSpring(sRoll); resetSpring(sYaw)
      lastPose = { ...ZERO_POSE }
      clearDrops()
      wiperTimer = 0
      hideCanvas()
    },

    frame(input) {
      active = true
      const dt = Math.min(0.05, Math.max(0.001, input.dt))

      // 1. Head G-Force Inertia (attenuated cleanly to zero under prefers-reduced-motion).
      if (input.reducedMotion) {
        resetSpring(sFwd); resetSpring(sLat); resetSpring(sUp)
        resetSpring(sPitch); resetSpring(sRoll); resetSpring(sYaw)
        lastPose = { ...ZERO_POSE }
      } else {
        const vertAcc = hasPrev ? clamp((input.vertVel - prevVert) / dt, -260, 260) : 0
        prevVert = input.vertVel
        hasPrev = true

        const top = Math.max(120, input.topSpeed)
        const speedFrac = Math.min(1.25, Math.abs(input.fwdSpeed) / Math.max(160, top))
        const kmh = Math.abs(input.fwdSpeed) * 0.36

        // Longitudinal G: pushed gently back into seat on hard launch, forward under hard braking.
        const targetFwd = clamp(-input.longAcc * 0.0042, -0.60, 0.85)
        // Lateral cornering G: leans subtly against turn direction, amplified slightly while drifting.
        const driftScale = input.drifting ? 1.22 : 1
        const targetLat = clamp((-input.latSpeed * 0.008 - input.steer * speedFrac * 0.46) * driftScale, -0.78, 0.78)
        // Vertical suspension dip / cresting float.
        const targetUp = clamp(-vertAcc * 0.0022, -0.52, 0.46)

        // Subtle head pitch nod, corner roll, and natural apex anticipation yaw.
        const targetPitch = clamp(input.longAcc * 0.00022 - vertAcc * 0.00012, -0.042, 0.036)
        const targetRoll = clamp((-input.latSpeed * 0.00072 - input.steer * speedFrac * 0.022) * driftScale, -0.044, 0.044)
        const targetYaw = clamp(input.steer * speedFrac * 0.055, -0.06, 0.06)

        // Micro road-surface texture vibration scaled by speed and roughness.
        vibPhase += dt * (26 + kmh * 0.34)
        const vibAmp = Math.min(1, kmh / 55) * (0.016 + input.rough * 0.07)
        const vibY = (Math.sin(vibPhase) * 0.65 + Math.sin(vibPhase * 2.31) * 0.35) * vibAmp
        const vibRoll = Math.sin(vibPhase * 1.63) * vibAmp * 0.05

        const fwd = clamp(stepSpring(sFwd, targetFwd, 11.0, 0.72, dt), -0.65, 0.90)
        const lat = clamp(stepSpring(sLat, targetLat, 10.0, 0.70, dt), -0.85, 0.85)
        const up = clamp(stepSpring(sUp, targetUp, 14.0, 0.62, dt) + vibY, -0.65, 0.55)
        const pitch = clamp(stepSpring(sPitch, targetPitch, 10.5, 0.68, dt), -0.065, 0.055)
        const roll = clamp(stepSpring(sRoll, targetRoll, 9.5, 0.68, dt) + vibRoll, -0.055, 0.055)
        const yaw = clamp(stepSpring(sYaw, targetYaw, 6.5, 0.85, dt), -0.065, 0.065)

        lastPose = { fwd, lat, up, pitch, roll, yaw }
      }

      // 2. Windshield Rain & Wipers + Interior Night Dash Glow (only when driving & wet or dark).
      const rainy = input.isDrive && input.rain > RAIN_ON
      const night = input.isDrive ? clamp(1 - input.day * 1.15, 0, 1) : 0
      const dark = night > NIGHT_ON
      nightGlowNow = dark ? night : 0

      if (!rainy && dropCount > 0) {
        clearDrops()
        wiperTimer = 0
        wiperAngle = WIPER_PARK
        prevWiperAngle = WIPER_PARK
        wiperSweeping = false
      }

      if (!rainy && !dark) {
        if (canvasVisible) hideCanvas()
        return lastPose
      }

      const g = ensureCanvas()
      if (!g || !panel || !canvas) return lastPose
      if (panel.hidden) panel.hidden = false
      canvasVisible = true

      const vw = Math.max(1, innerWidth)
      const vh = Math.max(1, innerHeight)
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      const bw = Math.round(vw * dpr)
      const bh = Math.round(vh * dpr)
      if (bw !== backingW || bh !== backingH || dpr !== backingDpr) {
        backingW = bw; backingH = bh; backingDpr = dpr
        canvas.width = bw; canvas.height = bh
      }

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, vw, vh)

      if (rainy) drawRainAndWipers(g, vw, vh, { ...input, dt }, night)
      if (dark) drawNightDash(g, vw, vh, night, input.rpm)

      return lastPose
    },

    get state(): CockpitState {
      return {
        active,
        canvasVisible,
        drops: dropCount,
        wiperAngle,
        wiperSweeping,
        nightGlow: nightGlowNow,
        pose: { ...lastPose },
      }
    },
  }
}
