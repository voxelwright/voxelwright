// Standard W3C Gamepad API support for Xbox & PlayStation DualSense controllers (#34):
// progressive analog triggers, cubic precision steering curve, right-stick camera orbit,
// vehicle & on-foot bindings, and dual-motor haptic rumble.
//
// Zero overhead when no gamepad is connected: `navigator.getGamepads()` is never called
// until a `gamepadconnected` event fires, and stops again once the last pad disconnects.

/** Left-stick radial/axial deadzone for standard console controllers. */
export const STICK_DEADZONE = 0.12
/** Analog trigger resting deadzone (RT/LT). */
export const TRIGGER_DEADZONE = 0.04
/** Touch thumbstick deadzone (px/60 normalized). */
export const TOUCH_DEADZONE = 0.08
/** Right-stick camera orbit speeds (radians per second at full deflection). */
const LOOK_YAW_RATE = 2.45
const LOOK_PITCH_RATE = 1.75
/** Minimum interval between continuous dual-rumble refreshes (ms). */
const RUMBLE_STEP_MS = 50

const ZERO_TURN: readonly [number, number] = [0, 0]

export interface DriveAxes {
  /** Progressive analog throttle (+1) minus brake/reverse (-1), in [-1, 1]. */
  go: number
  /** Precision-curved steering (-1 left, +1 right), in [-1, 1]. */
  turn: number
  /** Handbrake / drift intensity (A/Cross), in [0, 1]. */
  handbrake: number
  /** Boost intensity (B/Circle), in [0, 1]. */
  boost: number
  /** Rear-view look-back held (LB/L1). */
  lookBack: boolean
}

export interface RumbleTelemetry {
  /** Normalized engine RPM (0..1). */
  rpm: number
  /** Tire slip during drifts, burnouts, or brake lockups (0..1). */
  slip: number
  /** Surface roughness (0..1; ~0.05 smooth asphalt, ~0.9 off-road gravel/grass). */
  rough: number
  /** Horizontal vehicle speed (cells/s, 10 cells = 1 m). */
  speed: number
  /** Whether the vehicle's wheels are grounded. */
  grounded: boolean
  /** Whether the vehicle is actively drifting. */
  drifting: boolean
  /** Active boost intensity (0..1). */
  boost?: number
}

export type RumbleImpact = 'land' | 'shift' | 'crash'

export interface DualRumbleParams {
  startDelay?: number
  duration: number
  weakMagnitude: number
  strongMagnitude: number
}

export interface HapticActuator {
  playEffect?(type: string, params: DualRumbleParams): Promise<unknown> | unknown
  reset?(): Promise<unknown> | unknown
}

export interface GamepadLike {
  readonly index: number
  readonly connected: boolean
  readonly mapping?: string
  readonly axes: readonly number[]
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[]
  readonly vibrationActuator?: HapticActuator | null
}

export interface GamepadOptions {
  /** Dispatches a single key-down press through `input`'s mode stack. */
  key?(code: string): void
  /** Triggers tool use (`input.use()`). */
  use?(): void
  /** Whether the player is currently riding/driving a vehicle (`mounted` mode). */
  isMounted?(): boolean
  /** Whether a text input mode is active (suppresses gamepad actions). */
  isText?(): boolean
  /** Event target for `gamepadconnected` / `gamepaddisconnected` (defaults to `globalThis`). */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
  /** Override for `navigator.getGamepads()` (for tests). */
  getGamepads?: () => readonly (GamepadLike | null)[]
  /** Override for `prefers-reduced-motion: reduce` (for tests). */
  reducedMotion?: () => boolean
  /** Clock in ms (defaults to `performance.now`). */
  now?: () => number
}

export interface GamepadController {
  /** True once a gamepad has connected and until all gamepads disconnect. */
  readonly connected: boolean
  /** True when a connected gamepad was polled with a live reading. */
  readonly active: boolean
  /** Left stick [right, back] in [-1, 1] for on-foot walking / general movement. */
  readonly stick: readonly [number, number]
  /** Full analog driving axes when a gamepad is active, or null when disconnected. */
  readonly driveAxes: DriveAxes | null
  /** Polls the connected gamepad once per frame. Returns [right, up] camera turn delta (rad). */
  poll(dt: number): readonly [number, number]
  /** Whether the gamepad is currently holding a virtual keyboard code (e.g. KeyH, Space, ShiftLeft). */
  held(code: string): boolean
  /** Continuous dual-motor haptic feedback synced to driving telemetry; null silences motors. */
  rumble(telemetry: RumbleTelemetry | null): void
  /** One-shot strong-motor impact thump (hill landings, gear upshifts, crash impacts). */
  pulse(kind: RumbleImpact, intensity?: number): void
  /** Immediately silences active vibration. */
  stopRumble(): void
  /** Removes event listeners and silences rumble. */
  dispose(): void
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Axial deadzone with linear rescaling past `zone` so output starts cleanly at 0 and reaches +-1. */
export function deadzone(raw: number, zone = STICK_DEADZONE): number {
  const a = Math.abs(raw)
  if (a <= zone) return 0
  return Math.sign(raw) * Math.min(1, (a - zone) / (1 - zone))
}

/** Radial 2D deadzone: eliminates center drift without cross-axis snapping on diagonals. */
export function radialDeadzone(x: number, y: number, zone = STICK_DEADZONE): [number, number] {
  const r = Math.hypot(x, y)
  if (r <= zone) return [0, 0]
  const s = Math.min(1, (r - zone) / (1 - zone)) / r
  return [x * s, y * s]
}

/**
 * Precision cubic steering curve for Left Stick X:
 * gentle around center for highway stability, full lock at the rim for Lombard Street hairpins.
 */
export function steerCurve(raw: number, zone = STICK_DEADZONE): number {
  const n = deadzone(raw, zone)
  const a = Math.abs(n)
  return Math.sign(n) * (0.3 * a + 0.7 * a * a * a)
}

/**
 * Smooth progressive steering curve for mobile touch thumbsticks:
 * softens small thumb jitter while reaching full lock cleanly at the stick rim.
 */
export function touchSteerCurve(raw: number, zone = TOUCH_DEADZONE): number {
  const n = zone > 0 ? deadzone(raw, zone) : clamp(raw, -1, 1)
  const a = Math.abs(n)
  return Math.sign(n) * (0.35 * a + 0.65 * Math.pow(a, 2.2))
}

/** Progressive analog trigger curve for RT throttle / LT brake modulation. */
export function triggerCurve(raw: number, zone = TRIGGER_DEADZONE): number {
  const c = clamp(raw, 0, 1)
  if (c <= zone) return 0
  const t = (c - zone) / (1 - zone)
  return 0.45 * t + 0.55 * t * t
}

/** Quadratic camera look curve for smooth right-stick orbit framing and fast snaps. */
export function lookCurve(x: number, y: number, zone = 0.14): [number, number] {
  const [nx, ny] = radialDeadzone(x, y, zone)
  const m = Math.hypot(nx, ny)
  if (m === 0) return [0, 0]
  const gain = (0.3 * m + 0.7 * m * m) / m
  return [nx * gain, ny * gain]
}

const defaultGetGamepads = (): readonly (GamepadLike | null)[] => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return []
  try { return navigator.getGamepads() as unknown as readonly (GamepadLike | null)[] } catch { return [] }
}

const defaultReducedMotion = (): () => boolean => {
  if (typeof matchMedia !== 'function') return () => false
  const mq = matchMedia('(prefers-reduced-motion: reduce)')
  return () => mq.matches
}

const btnValue = (pad: GamepadLike, index: number): number => {
  const b = pad.buttons[index]
  if (!b) return 0
  if (typeof b.value === 'number' && Number.isFinite(b.value)) return clamp(b.value, 0, 1)
  return b.pressed ? 1 : 0
}

const btnPressed = (pad: GamepadLike, index: number, threshold = 0.5): boolean => {
  const b = pad.buttons[index]
  if (!b) return false
  return Boolean(b.pressed || (typeof b.value === 'number' && b.value >= threshold))
}

function sendDualRumble(pad: GamepadLike | null, duration: number, weak: number, strong: number): void {
  const actuator = pad?.vibrationActuator
  if (!actuator || typeof actuator.playEffect !== 'function') return
  try {
    const res = actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: Math.max(0, Math.round(duration)),
      weakMagnitude: clamp(weak, 0, 1),
      strongMagnitude: clamp(strong, 0, 1),
    })
    if (res && typeof (res as Promise<unknown>).catch === 'function') {
      void (res as Promise<unknown>).catch(() => {})
    }
  } catch {
    // Ignore unsupported effect or blocked haptic permission in Safari / Firefox / restricted frames.
  }
}

function resetActuator(pad: GamepadLike | null): void {
  const actuator = pad?.vibrationActuator
  if (!actuator) return
  try {
    if (typeof actuator.reset === 'function') {
      const res = actuator.reset()
      if (res && typeof (res as Promise<unknown>).catch === 'function') void (res as Promise<unknown>).catch(() => {})
      return
    }
    if (typeof actuator.playEffect === 'function') sendDualRumble(pad, 0, 0, 0)
  } catch {
    // Ignore unsupported reset.
  }
}

export function gamepad(options: GamepadOptions = {}): GamepadController {
  const target = options.target === undefined ? (typeof globalThis.addEventListener === 'function' ? globalThis : null) : options.target
  const getPads = options.getGamepads ?? defaultGetGamepads
  const isReducedMotion = options.reducedMotion ?? defaultReducedMotion()
  const now = options.now ?? (() => performance.now())

  let armed = false
  let active = false
  let preferredIndex = -1
  let lastPad: GamepadLike | null = null

  const stick: [number, number] = [0, 0]
  const axes: DriveAxes = { go: 0, turn: 0, handbrake: 0, boost: 0, lookBack: false }
  const heldCodes = new Set<string>()
  const prev = new Uint8Array(18)

  let lastRumbleAt = -Infinity
  let pulseUntil = -Infinity
  let rumbleOn = false
  let gravelPhase = 0

  const resetInputs = () => {
    active = false
    stick[0] = 0; stick[1] = 0
    axes.go = 0; axes.turn = 0; axes.handbrake = 0; axes.boost = 0; axes.lookBack = false
    heldCodes.clear()
    prev.fill(0)
  }

  const pickPad = (): GamepadLike | null => {
    const pads = getPads()
    if (!pads || !pads.length) return null
    if (preferredIndex >= 0 && preferredIndex < pads.length) {
      const p = pads[preferredIndex]
      if (p && p.connected) return p
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i]
      if (p && p.connected) { preferredIndex = p.index ?? i; return p }
    }
    return null
  }

  const stopRumble = () => {
    if (!rumbleOn && pulseUntil <= now()) return
    rumbleOn = false
    pulseUntil = -Infinity
    resetActuator(lastPad)
  }

  const onConnect = (e: Event) => {
    const gp = (e as Event & { gamepad?: GamepadLike }).gamepad
    if (gp && typeof gp.index === 'number') preferredIndex = gp.index
    armed = true
  }

  const onDisconnect = (e: Event) => {
    const gp = (e as Event & { gamepad?: GamepadLike }).gamepad
    if (gp && gp.index === preferredIndex) preferredIndex = -1
    stopRumble()
    const remaining = pickPad()
    if (!remaining) {
      armed = false
      lastPad = null
      resetInputs()
    } else {
      lastPad = remaining
    }
  }

  target?.addEventListener('gamepadconnected', onConnect)
  target?.addEventListener('gamepaddisconnected', onDisconnect)

  return {
    get connected() { return armed },
    get active() { return armed && active },
    get stick() { return stick },
    get driveAxes() { return armed && active ? axes : null },

    poll(dt) {
      if (!armed) return ZERO_TURN
      const pad = pickPad()
      if (!pad) {
        if (active) { stopRumble(); resetInputs() }
        lastPad = null
        return ZERO_TURN
      }
      lastPad = pad
      active = true

      const step = clamp(dt, 0, 0.1)
      gravelPhase += step
      const text = options.isText?.() ?? false
      const mounted = options.isMounted?.() ?? false

      // Left stick: smooth radial deadzone for on-foot walking, cubic precision curve for vehicle steering.
      const lxRaw = pad.axes[0] ?? 0
      const lyRaw = pad.axes[1] ?? 0
      const [lx, ly] = radialDeadzone(lxRaw, lyRaw, STICK_DEADZONE)
      if (text) {
        stick[0] = 0; stick[1] = 0
      } else {
        stick[0] = lx
        stick[1] = ly
      }

      // Analog triggers (RT = 7 throttle, LT = 6 brake/reverse) & steering curve.
      const rt = triggerCurve(btnValue(pad, 7))
      const lt = triggerCurve(btnValue(pad, 6))
      const handbrake = btnValue(pad, 0) > 0.08 ? btnValue(pad, 0) : (btnPressed(pad, 0) ? 1 : 0)
      const boost = btnValue(pad, 1) > 0.08 ? btnValue(pad, 1) : (btnPressed(pad, 1) ? 1 : 0)
      const lookBack = btnPressed(pad, 4)

      if (text) {
        axes.go = 0; axes.turn = 0; axes.handbrake = 0; axes.boost = 0; axes.lookBack = false
      } else {
        axes.go = clamp(rt - lt, -1, 1)
        axes.turn = steerCurve(lxRaw, STICK_DEADZONE)
        axes.handbrake = handbrake
        axes.boost = boost
        axes.lookBack = lookBack
      }

      // Held virtual keys (cleared and recomputed cleanly each poll).
      heldCodes.clear()
      if (!text) {
        if (mounted) {
          if (btnPressed(pad, 10)) heldCodes.add('KeyH')        // L3: horn
          if (btnPressed(pad, 1)) heldCodes.add('ShiftLeft')    // B/Circle: boost
        } else {
          if (btnPressed(pad, 0)) heldCodes.add('Space')        // A/Cross: jump / fly up
          if (btnPressed(pad, 1) || btnPressed(pad, 6)) heldCodes.add('KeyC') // B/Circle or LT: fly down
          if (btnPressed(pad, 4) || btnPressed(pad, 10)) heldCodes.add('ShiftLeft') // LB or L3: sprint
        }
      }

      // Rising-edge button triggers.
      const pressedNow = (idx: number) => btnPressed(pad, idx)
      const edge = (idx: number): boolean => {
        const down = pressedNow(idx) ? 1 : 0
        const fired = down === 1 && prev[idx] === 0
        prev[idx] = down
        return fired && !text
      }

      const fireKey = (code: string) => options.key?.(code)
      const fireUse = () => options.use?.()

      const eA = edge(0)
      edge(1)
      const eX = edge(2)
      const eY = edge(3)
      edge(4)
      const eRB = edge(5)
      edge(6)
      const eRT = edge(7)
      const eSelect = edge(8)
      edge(9)
      edge(10)
      const eR3 = edge(11)
      const eUp = edge(12)
      const eDown = edge(13)
      edge(14)
      const eRight = edge(15)

      // Enter/exit vehicle (Y/Triangle -> KeyE)
      if (eY) fireKey('KeyE')
      // Driver seat / first-person view (R3 or D-pad Up -> KeyV)
      if (eR3 || eUp) fireKey('KeyV')
      // Map (View/Share -> KeyM)
      if (eSelect) fireKey('KeyM')

      if (mounted) {
        // Cycle chase camera (RB/R1 or D-pad Down -> KeyC)
        if (eRB || eDown) fireKey('KeyC')
        // Repair vehicle (D-pad Right -> KeyF)
        if (eRight) fireKey('KeyF')
        // Hover/special roll (X/Square -> KeyQ)
        if (eX) fireKey('KeyQ')
      } else {
        // On-foot jump / canopy (A/Cross -> Space)
        if (eA) fireKey('Space')
        // Tool use (RT/R2, X/Square, or RB/R1)
        if (eRT || eX || eRB) fireUse()
        // Walk/fly toggle (D-pad Down -> KeyB)
        if (eDown) fireKey('KeyB')
      }

      // Right stick camera orbit.
      if (text) return ZERO_TURN
      const [rx, ry] = lookCurve(pad.axes[2] ?? 0, pad.axes[3] ?? 0)
      if (rx === 0 && ry === 0) return ZERO_TURN
      return [rx * LOOK_YAW_RATE * step, -ry * LOOK_PITCH_RATE * step]
    },

    held(code) {
      return armed && heldCodes.has(code)
    },

    rumble(t) {
      if (!armed) return
      if (!t || isReducedMotion()) {
        stopRumble()
        return
      }
      const pad = lastPad
      if (!pad?.vibrationActuator?.playEffect) return
      const ts = now()
      if (ts < pulseUntil) return
      if (ts - lastRumbleAt < RUMBLE_STEP_MS) return

      // Subtle high-frequency engine purr scaling with RPM.
      const speedNorm = clamp(t.speed / 180, 0, 1)
      const rpmPurr = (t.speed > 4 || t.rpm > 0.35) ? clamp((t.rpm - 0.22) * 0.16, 0, 0.14) : 0
      // Tire slip scrub during drifts, burnouts, and hard lockups.
      const slipWeak = t.grounded ? clamp(t.slip * (t.drifting ? 0.52 : 0.34), 0, 0.58) : 0
      const slipStrong = t.grounded && t.drifting ? clamp(t.slip * 0.22, 0, 0.24) : 0
      // Crisp off-road gravel / dirt texture buzz when driving off asphalt.
      const offroad = t.grounded && t.rough > 0.5 && t.speed > 10
      const gravelFactor = offroad ? clamp((t.rough - 0.4) * 1.4, 0, 1) * clamp(t.speed / 95, 0.2, 1) : 0
      const gravelWeak = gravelFactor * (0.24 + 0.10 * Math.sin(gravelPhase * 34))
      const gravelStrong = gravelFactor * (0.14 + 0.08 * Math.sin(gravelPhase * 19))
      // Subtle high-energy boost hum.
      const boostHum = clamp((t.boost ?? 0) * 0.16, 0, 0.16)

      const weak = clamp(rpmPurr + slipWeak + gravelWeak + boostHum, 0, 1)
      const strong = clamp(slipStrong + gravelStrong + speedNorm * (t.rough > 0.25 && t.grounded ? 0.04 : 0), 0, 1)

      if (weak < 0.015 && strong < 0.015) {
        if (rumbleOn) {
          rumbleOn = false
          lastRumbleAt = ts
          resetActuator(pad)
        }
        return
      }

      rumbleOn = true
      lastRumbleAt = ts
      sendDualRumble(pad, 90, weak, strong)
    },

    pulse(kind, intensity = 0.7) {
      if (!armed || isReducedMotion()) return
      const pad = lastPad
      if (!pad?.vibrationActuator?.playEffect) return
      const k = clamp(intensity, 0.1, 1)
      let duration: number, weak: number, strong: number
      if (kind === 'crash') {
        duration = 180 + k * 120
        strong = 0.45 + k * 0.55
        weak = 0.30 + k * 0.40
      } else if (kind === 'land') {
        duration = 130 + k * 80
        strong = 0.35 + k * 0.55
        weak = 0.15 + k * 0.25
      } else {
        // 'shift': crisp gear upshift kick
        duration = 70
        strong = 0.22 + k * 0.20
        weak = 0.12 + k * 0.12
      }
      const ts = now()
      rumbleOn = true
      lastRumbleAt = ts
      pulseUntil = ts + duration * 0.85
      sendDualRumble(pad, duration, weak, strong)
    },

    stopRumble,

    dispose() {
      stopRumble()
      target?.removeEventListener('gamepadconnected', onConnect)
      target?.removeEventListener('gamepaddisconnected', onDisconnect)
      armed = false
      lastPad = null
      resetInputs()
    },
  }
}
