// Touch driving (#140): how a phone steers and drives a car. One owner for the touch scheme: what steers (arrows, a
// wheel, a slide, or tilting the phone), what drives (pedals, or gas that is always on), which hand has the pedals, and
// how big and how see-through the keys are. living.ts asks `read()` once a frame and adds what a keyboard or a pad says.
//
// Each scheme is one way of doing each job, never two at once (#75 had a stick that steered and, with no pedal held,
// drove too): the steering hand steers and the other drives.
//
//   steer   arrows   two keys under the steering thumb, left and right (the core eases a key's turn in and out)
//           wheel    a wheel under the steering thumb, turned round its middle; let go, it comes back to the middle
//           slide    a slide that comes where the steering thumb goes down on that half of the picture: across only
//           tilt     the phone turned like a wheel, read from the gravity it feels (DeviceOrientation); both thumbs
//                    are then for the pedals, brake under the left and gas under the right
//   gas     pedals   gas and brake (brake held when stopped reverses)
//           auto     gas always on once a key or the picture is first touched; brake slows, and held when stopped reverses
//
// The keys of a cluster are one pad: a thumb that slides from one key to the next lets go of the first and holds the
// second, as on a phone racing game, without lifting. Every key is let go when its touch ends or is cancelled, the
// page is hidden or loses focus, the keys are put away, or anything is opened over them.
//
// The settings are kept in this browser (`localStorage`, key `vw.drive-touch.v1`), read defensively: anything out of
// range is brought back in range and anything unknown is the default. The Controls sheet (Settings → Controls…) sets
// them, and the keys behind it change as it is used.

import { touchSteerCurve } from './gamepad.ts'
import type { Input } from './input.ts'

export type Steer = 'arrows' | 'wheel' | 'slide' | 'tilt'
export type Gas = 'pedals' | 'auto'
export interface DriveTouchSettings {
  steer: Steer
  gas: Gas
  /** Which side the pedals are on: 'right' (steer with the left thumb) or 'left'. */
  hand: 'right' | 'left'
  /** How big the keys are: 0.8 to 1.25. */
  size: number
  /** How solid the keys are when not pressed: 0.3 to 1. */
  opacity: number
  /** How quickly the steering answers the thumb or the tilt: 0.5 to 2 (1 is the default). */
  sens: number
  /** The tilt that is straight ahead, radians (Center tilt sets it to how the phone is held). */
  tiltZero: number
}

/** The scheme a phone starts with: arrows under the left thumb, gas and brake under the right. */
export const DEFAULTS: Readonly<DriveTouchSettings> = Object.freeze({ steer: 'arrows', gas: 'pedals', hand: 'right', size: 1, opacity: 0.82, sens: 1, tiltZero: 0 })
export const STEERS: readonly Steer[] = ['arrows', 'wheel', 'slide', 'tilt']
export const GASES: readonly Gas[] = ['pedals', 'auto']
const KEY = 'vw.drive-touch.v1'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const num = (v: unknown, lo: number, hi: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback

/** Settings from whatever was kept (or nothing): each field in range, anything unknown the default. */
export function parseSettings(raw: unknown): DriveTouchSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    steer: STEERS.includes(r.steer as Steer) ? r.steer as Steer : DEFAULTS.steer,
    gas: GASES.includes(r.gas as Gas) ? r.gas as Gas : DEFAULTS.gas,
    hand: r.hand === 'left' ? 'left' : 'right',
    size: num(r.size, 0.8, 1.25, DEFAULTS.size),
    opacity: num(r.opacity, 0.3, 1, DEFAULTS.opacity),
    sens: num(r.sens, 0.5, 2, DEFAULTS.sens),
    tiltZero: num(r.tiltZero, -0.6, 0.6, DEFAULTS.tiltZero),
  }
}

// ── Tilt ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Which way is up in the phone's own frame (x to its right edge, y to its top, z out of its screen), from the beta and
 * gamma of a DeviceOrientation event (degrees). It is the third row of the spec's rotation matrix (Z-X'-Y'', W3C
 * Device Orientation, "Worked example"), so it is the same whichever of the two equal sets of angles a browser gives
 * near gamma = ±90, as on a phone held on its side.
 */
export function upOfPhone(beta: number, gamma: number): [number, number, number] {
  const b = beta * Math.PI / 180, g = gamma * Math.PI / 180
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]
}

/**
 * Up in the screen's frame (x to the right of the picture, y to its top), from up in the phone's: turned by how far the
 * screen is turned from the phone's own upright (`screen.orientation.angle`, degrees; 90 with the phone's top to the
 * left, as `window.orientation` says on iOS). The one place where the sign of that turn is decided.
 */
export function upOnScreen(up: readonly number[], angle: number): [number, number] {
  const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return [up[0] * c - up[1] * s, up[0] * s + up[1] * c]
}

/**
 * How far the phone is turned like a wheel (radians; to the right is positive, clockwise as the player sees the
 * screen), and how upright it is (0 lying flat, where the turn means nothing, to 1 held up facing the player).
 */
export function tiltOf(beta: number, gamma: number, angle: number): { turn: number; upright: number } {
  const [x, y] = upOnScreen(upOfPhone(beta, gamma), angle)
  // Turned clockwise by t, the world's up is seen turned the other way on the screen: (-sin t, cos t).
  return { turn: Math.atan2(-x, y), upright: Math.hypot(x, y) }
}

/** Full lock is this many degrees of tilt at sensitivity 1. */
export const TILT_LOCK = 24
/** Steering from a tilt (radians), the tilt that is straight ahead and the sensitivity: -1 to 1. */
export function tiltSteer(turn: number, zero: number, sens: number): number {
  const lock = (TILT_LOCK / sens) * Math.PI / 180, dead = 1.5 * Math.PI / 180
  let d = turn - zero
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  const a = Math.max(0, Math.abs(d) - dead) / (lock - dead)
  const n = Math.min(1, a)
  return Math.sign(d) * (0.6 * n + 0.4 * n * n)
}

// ── Wheel ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Full lock is this many degrees of the wheel's turn at sensitivity 1. */
export const WHEEL_LOCK = 110
/** The wheel's turn kept within lock (degrees), from where it was and how far the thumb went round its middle. */
export function wheelTurn(was: number, swept: number, sens: number): number {
  const lock = WHEEL_LOCK / sens
  return clamp(was + swept, -lock, lock)
}
/** How far the thumb went round (degrees, clockwise positive) from one angle about the middle to the next. */
export function swept(from: number, to: number): number {
  let d = (to - from) * 180 / Math.PI
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}
export function wheelSteer(turn: number, sens: number): number {
  const lock = WHEEL_LOCK / sens
  const n = clamp(turn / lock, -1, 1)
  return Math.abs(n) < 0.03 ? 0 : n
}

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A key's place: from the screen's corner on its side (`x` in from the side, `y` up from the bottom), and its size; px. */
export interface Placed { act: string; x: number; y: number; w: number; h: number; side: 'left' | 'right' }

/**
 * Where each key stands for a scheme, a hand and a screen (before the safe area and the 14 px margin, which CSS adds).
 * The steering thumb's keys are on one side, the driving thumb's on the other. Upright, the keys are a little smaller;
 * on any screen they shrink until the two thumbs' clusters are 24 px apart or more (allowing an iPhone's 59 px safe area
 * at each side when it is on its side) and the driving cluster is in the lower half, and no key is under 44 px a side.
 */
export function layout(s: DriveTouchSettings, steer: Steer, view: { width: number; height: number; portrait: boolean }, tiltAsk = false): Placed[] {
  const brakeAcross = s.gas === 'pedals' && steer === 'tilt'
  const widths = (k: number) => {
    const gap = 10 * k, pedals = 80 * k + gap + 74 * k
    const steering = steer === 'arrows' ? 2 * 84 * k + gap * 1.4 : steer === 'wheel' ? 150 * k : brakeAcross ? 92 * k : 0
    return pedals + steering
  }
  const room = view.width - 28 - (view.portrait ? 0 : 118) - 24
  let k = s.size * (view.portrait ? 0.84 : 1)
  if (widths(k) > room) k *= room / widths(k)
  // And low: the driving thumb's cluster (main pedal, a gap, boost) within the lower half at Medium, a little lower at
  // Small and a little higher at Large (or on a short screen the sizes would all be one), allowing 35 px of safe area
  // and margin.
  const tall = (108 + 10 + 56) * k, low = view.height * (0.5 + (s.size - 1) * 0.4) - 35 - 4
  if (tall > low) k *= low / tall
  const px = (v: number) => Math.max(44, Math.round(v * k))
  const gap = Math.round(10 * k)
  const drive: 'left' | 'right' = s.hand, steerSide: 'left' | 'right' = s.hand === 'right' ? 'left' : 'right'
  const out: Placed[] = []
  const put = (act: string, side: 'left' | 'right', x: number, y: number, w: number, h: number) => out.push({ act, side, x: Math.round(x), y: Math.round(y), w, h })
  // The driving thumb's cluster: the main pedal tall at the edge; drift beside it (brake below drift with pedals);
  // boost over the main pedal. With tilt and pedals, brake goes under the steering thumb, which has nothing else to do.
  const mainW = px(80), mainH = px(108), sideW = px(74), smallH = px(56)
  put(s.gas === 'auto' ? 'brake' : 'gas', drive, 0, 0, mainW, mainH)
  if (s.gas === 'pedals' && !brakeAcross) {
    // Four keys, two by two: Boost over Gas, Drift over Brake.
    const brakeH = px(76)
    put('boost', drive, 0, mainH + gap, mainW, smallH)
    put('brake', drive, mainW + gap, 0, sideW, brakeH)
    put('drift', drive, mainW + gap, brakeH + gap, sideW, smallH)
  } else {
    // Three: Drift as tall as the main pedal beside it, Boost the width of both over them.
    put('drift', drive, mainW + gap, 0, sideW, mainH)
    put('boost', drive, 0, mainH + gap, mainW + gap + sideW, smallH)
  }
  // The steering thumb's.
  if (steer === 'arrows') {
    const a = px(84), between = Math.round(gap * 1.4)
    put('left', steerSide, steerSide === 'left' ? 0 : a + between, 0, a, a)
    put('right', steerSide, steerSide === 'left' ? a + between : 0, 0, a, a)
    if (tiltAsk) put('tilt-on', steerSide, 0, a + gap, a * 2 + between, 48)
  } else if (steer === 'wheel') {
    const d = px(150)
    put('wheel', steerSide, 0, 0, d, d)
  } else if (brakeAcross) {
    put('brake', steerSide, 0, 0, mainW, mainH)
  }
  return out
}

// ── The keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const STYLE = /* css */ `
[data-panel="living"] .dt-cluster { position: fixed; inset: 0; pointer-events: none; }
[data-panel="living"] .dt-cluster > * { position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
[data-panel="living"] .dt-cluster .vx-button { min-inline-size: 0; min-block-size: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; opacity: var(--dt-alpha, 0.82); transition: opacity 0.15s ease-out; }
[data-panel="living"] .dt-cluster .vx-button[aria-pressed="true"] { opacity: 1; transition: none; }
[data-panel="living"] .dt-cluster [data-act="tilt-on"] { font: 600 12px/1 var(--hud-font, -apple-system, system-ui, sans-serif); letter-spacing: 0.02em; }
[data-panel="living"] .dt-cluster [data-act="tilt-on"] .hud-lbl { display: inline !important; }
/* The wheel: a recess the thumb turns, and the cap on its rim where the wheel's top is. */
[data-panel="living"] .dt-cluster .dt-wheel { border-radius: 50%; opacity: var(--dt-alpha, 0.82); }
[data-panel="living"] .dt-cluster .dt-wheel[aria-pressed="true"] { opacity: 1; }
/* Where the slide comes, before the thumb has found it this time in the car. */
[data-panel="living"] .dt-cluster .dt-ghost { pointer-events: none; display: flex; align-items: center; justify-content: center; gap: 8px; inline-size: 168px; block-size: 52px; border-radius: 26px; border: 1.5px dashed rgba(232, 236, 241, 0.5); background: rgba(12, 16, 22, 0.42); color: rgba(242, 245, 249, 0.9); font: 600 11px/1 var(--hud-font, -apple-system, system-ui, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; transition: opacity 0.3s ease-out; }
html.thumb-down [data-panel="living"] .dt-cluster .dt-ghost { opacity: 0; }
@media (pointer: fine) { [data-panel="living"] .dt-cluster { display: none; } }

/* The Controls sheet. */
#drive-controls { box-sizing: border-box; inline-size: min(560px, calc(100vw - 24px)); max-block-size: calc(100dvh - 24px - env(safe-area-inset-bottom, 0px)); margin: 12px auto auto; padding: 0; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 14px; background: rgba(14, 18, 26, 0.9); color: #f2f5f9; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); font: 400 13px/1.35 -apple-system, system-ui, sans-serif; overflow: auto; overscroll-behavior: contain; }
#drive-controls::backdrop { background: rgba(4, 6, 10, 0.42); }
/* A fade at the foot while there is more to scroll to. */
#drive-controls .dc-body::after { content: ''; position: sticky; bottom: -14px; grid-column: 1 / -1; block-size: 18px; margin-block-start: -18px; background: linear-gradient(transparent, rgba(14, 18, 26, 0.95)); pointer-events: none; }
#drive-controls[open] { display: grid; }
#drive-controls * { box-sizing: border-box; }
#drive-controls [hidden] { display: none !important; }
#drive-controls .dc-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 16px; background: rgba(14, 18, 26, 0.96); border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
#drive-controls h2 { margin: 0 auto 0 0; font: 700 15px/1.1 -apple-system, system-ui, sans-serif; letter-spacing: -0.01em; }
#drive-controls .dc-head button { min-inline-size: 44px; block-size: 44px; padding: 0 14px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; background: rgba(255, 255, 255, 0.08); color: inherit; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
#drive-controls .dc-head .dc-reset { border-color: transparent; background: none; color: rgba(232, 236, 241, 0.7); font-weight: 500; }
#drive-controls .dc-head .dc-done { background: rgba(56, 120, 255, 0.34); border-color: rgba(120, 170, 255, 0.85); }
#drive-controls .dc-body { display: grid; gap: 10px; padding: 10px 16px 14px; }
#drive-controls .dc-row { display: grid; gap: 6px; }
#drive-controls .dc-row > .dc-name { font: 600 11px/1 -apple-system, system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(232, 236, 241, 0.62); }
#drive-controls .dc-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
#drive-controls .dc-seg label { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-block-size: 44px; padding: 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); border: 1.5px solid rgba(255, 255, 255, 0.1); text-align: center; font: 600 13px/1.1 -apple-system, system-ui, sans-serif; cursor: pointer; }
#drive-controls .dc-seg label small { font: 500 10.5px/1.15 -apple-system, system-ui, sans-serif; color: rgba(232, 236, 241, 0.6); }
#drive-controls .dc-seg input { position: absolute; opacity: 0; pointer-events: none; }
#drive-controls .dc-seg label:has(input:checked) { background: rgba(56, 120, 255, 0.28); border-color: rgba(120, 170, 255, 0.85); }
#drive-controls .dc-seg label:has(input:disabled) { opacity: 0.4; }
#drive-controls .dc-seg label[data-warn] { border-color: #ffc46b; }
#drive-controls .dc-seg label[data-warn] small { color: #ffc46b; }
#drive-controls .dc-seg label:has(input:focus-visible) { outline: 2px solid #8fb6ff; outline-offset: 2px; }
#drive-controls input[type="range"] { inline-size: 100%; block-size: 44px; margin: -6px 0; accent-color: #5b8cff; }
#drive-controls .dc-note { margin: 0; min-block-size: 1.35em; color: rgba(232, 236, 241, 0.74); font-size: 12px; }
#drive-controls .dc-note[data-tone="warn"] { color: #ffc46b; }
#drive-controls .dc-acts { display: flex; flex-wrap: wrap; gap: 8px; }
#drive-controls .dc-tilt { grid-template-columns: 1fr auto; align-items: center; }
#drive-controls .dc-acts button { flex: 1 1 auto; min-block-size: 44px; padding: 0 14px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; background: rgba(255, 255, 255, 0.08); color: inherit; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
#drive-controls .dc-acts button:disabled { opacity: 0.4; }
@media (orientation: landscape) and (max-height: 500px) {
  #drive-controls .dc-body { grid-template-columns: 1fr 1fr; column-gap: 16px; }
  #drive-controls .dc-row.wide { grid-column: 1 / -1; }
}
`

export type TiltState = 'off' | 'ask' | 'waiting' | 'live' | 'denied' | 'none' | 'insecure'

export interface DriveTouch {
  readonly settings: Readonly<DriveTouchSettings>
  /** Changes some settings, keeps them, and lays the keys out again. */
  set(patch: Partial<DriveTouchSettings>): void
  /** The keys of the scheme, laid out (while a car is driven by touch), or put away (null). */
  show(on: boolean): HTMLElement[]
  /** What the touch keys say this frame. Zero while the keys are put away or anything is over them. */
  read(): { go: number; turn: number; rise: number; boost: boolean }
  /** Lets every key go. */
  release(): void
  /** Opens the Controls sheet. */
  open(): void
  /** A short word for the driving panel: what to do to start, or that tilt is waiting. Empty when there is nothing to say. */
  note(): string
  readonly tilt: TiltState
  /** The steering that is in use (tilt falls back to arrows until it is live). */
  readonly steer: Steer
}

type Orientation = { beta: number | null; gamma: number | null }
type Asking = { requestPermission?: () => Promise<'granted' | 'denied' | 'default'> }

export function driveTouch(o: {
  input: Input
  /** Where the settings are kept: the page's localStorage unless given (null keeps them for this page only). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}): DriveTouch {
  const store = o.storage === undefined ? (() => { try { return globalThis.localStorage ?? null } catch { return null } })() : o.storage
  let settings: DriveTouchSettings = (() => { try { return parseSettings(JSON.parse(store?.getItem(KEY) ?? 'null')) } catch { return parseSettings(null) } })()
  const save = () => { try { store?.setItem(KEY, JSON.stringify(settings)) } catch { /* private mode, or full: kept for this page */ } }
  if (typeof document !== 'undefined' && !document.getElementById('drive-touch-style')) {
    const style = Object.assign(document.createElement('style'), { id: 'drive-touch-style', textContent: STYLE })
    document.head.append(style)
  }
  const html = document.documentElement
  const portrait = matchMedia('(orientation: portrait)')
  let shown = false
  // What is held now, by act; and by which pointer each key is held (a pointer holds one key at a time).
  const held = new Set<string>()
  const by = new Map<number, string>()
  let wheelTurnNow = 0, wheelBack = false, wheelPointer: number | null = null, wheelFrom = 0, wheelWas = 0
  let autoGo = false
  let cluster: HTMLElement | null = null
  const keyEl = new Map<string, HTMLElement>()

  // ── Tilt: listened to only while it is the scheme and the keys are out ──
  const DOE = (globalThis as { DeviceOrientationEvent?: Asking }).DeviceOrientationEvent
  let tilt: TiltState = 'off', tiltTurn = 0, tiltUpright = 0, tiltSeen = 0, tiltListening = false, tiltAsked = false, tiltGranted = false, tiltWait: ReturnType<typeof setTimeout> | undefined
  const screenAngle = () => {
    const a = (globalThis.screen as Screen | undefined)?.orientation?.angle
    if (typeof a === 'number') return a
    const w = (globalThis as { orientation?: number }).orientation
    return typeof w === 'number' ? w : 0
  }
  const onOrient = (e: Event) => {
    const { beta, gamma } = e as unknown as Orientation
    if (beta == null || gamma == null) return
    const t = tiltOf(beta, gamma, screenAngle()), now = performance.now()
    // Eased over about 60 ms, so the steering is steady in a shaking hand but follows a turn.
    const k = tiltSeen ? Math.min(1, (now - tiltSeen) / 60) : 1
    let d = t.turn - tiltTurn
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    tiltTurn += d * k
    tiltUpright += (t.upright - tiltUpright) * k
    tiltSeen = now
    if (tilt !== 'live') { tilt = 'live'; clearTimeout(tiltWait); relay() }
  }
  const listen = (on: boolean) => {
    if (on === tiltListening) return
    tiltListening = on
    if (on) {
      addEventListener('deviceorientation', onOrient)
      clearTimeout(tiltWait)
      // A browser with the event but no sensor sends nothing, or nothing but nulls.
      tiltWait = setTimeout(() => { if (tilt === 'waiting') { tilt = 'none'; relay() } }, 1500)
    } else { removeEventListener('deviceorientation', onOrient); clearTimeout(tiltWait) }
  }
  /** Starts tilt: asks for the sensor where the browser asks (iOS, from a touch), else listens. */
  const startTilt = (fromTouch: boolean) => {
    if (!globalThis.isSecureContext) { tilt = 'insecure'; return }
    if (!DOE) { tilt = 'none'; return }
    if (typeof DOE.requestPermission === 'function' && !tiltGranted) {
      if (!fromTouch) { if (tilt !== 'live' && tilt !== 'denied') tilt = 'ask'; return }
      tiltAsked = true
      tilt = 'waiting'
      DOE.requestPermission().then((r) => {
        if (r === 'granted') { tiltGranted = true; if (wantTilt()) listen(true); else tilt = 'off' }
        else tilt = 'denied'
        relay()
      }, () => { tilt = 'ask'; relay() })
      return
    }
    if (tilt !== 'live') tilt = 'waiting'
    listen(true)
  }
  const wantTilt = () => shown && settings.steer === 'tilt'
  const syncTilt = (fromTouch = false) => {
    if (!wantTilt()) { listen(false); if (tilt === 'live' || tilt === 'waiting') tilt = 'off'; return }
    if (tilt === 'live' || (tilt === 'waiting' && tiltListening)) return
    if (tilt === 'denied' || tilt === 'none' || tilt === 'insecure') return
    startTilt(fromTouch)
  }
  // iOS asks for the sensor only from a touch's end (a press does not count as the hand's own): the first touch after
  // the car is got into, if tilt is the scheme. A touch on the picture while auto gas waits starts it.
  addEventListener('pointerup', () => { if (wantTilt() && tilt === 'ask' && !tiltAsked) syncTilt(true) }, true)
  addEventListener('pointerdown', (e) => { if (shown && e.pointerType === 'touch' && e.target instanceof HTMLCanvasElement && !e.target.closest('.vx-button, .vx-recess, dialog')) autoGo = true }, true)

  const steerNow = (): Steer => settings.steer === 'tilt' && tilt !== 'live' ? 'arrows' : settings.steer

  // ── The keys ──
  const key = (act: string, label: string) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'vx-button', textContent: label })
    b.dataset.act = act
    b.setAttribute('aria-pressed', 'false')
    b.tabIndex = -1
    return b
  }
  const LABELS: Record<string, [string, string]> = {
    gas: ['Gas', 'Accelerate'], brake: ['Brake', 'Brake or reverse'], drift: ['Drift', 'Handbrake drift'], boost: ['Boost', 'Nitrous boost'],
    left: ['Left', 'Steer left'], right: ['Right', 'Steer right'], 'tilt-on': ['Tap to steer by tilt', 'Turn on tilt steering'],
  }
  const press = (act: string, on: boolean) => {
    const was = held.has(act)
    if (on === was) return
    if (on) held.add(act); else held.delete(act)
    keyEl.get(act)?.setAttribute('aria-pressed', String(on))
    if (on && act !== 'tilt-on') autoGo = true
  }
  const recount = () => {
    const now = new Set(by.values())
    for (const act of [...held]) if (!now.has(act)) press(act, false)
    for (const act of now) press(act, true)
  }
  /** The act of the key under a point, among this cluster's keys (the wheel is its own). */
  const under = (x: number, y: number) => {
    for (const [act, el] of keyEl) {
      if (act === 'wheel' || act === 'tilt-on') continue
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return act
    }
    return null
  }
  const releaseAll = () => {
    by.clear()
    for (const act of [...held]) press(act, false)
    wheelPointer = null
    wheelBack = true
    keyEl.get('wheel')?.setAttribute('aria-pressed', 'false')
  }
  addEventListener('blur', releaseAll)
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll() })

  const wheelAngle = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
    return { a: Math.atan2(x - cx, cy - y), far: Math.hypot(x - cx, y - cy) / (r.width / 2) }
  }
  // The wheel is turned as a whole, its lit top stripe showing where its top is.
  const drawWheel = () => { const el = keyEl.get('wheel'); if (el) el.style.rotate = `${wheelTurnNow.toFixed(1)}deg` }

  const build = (): HTMLElement[] => {
    keyEl.clear()
    const steer = steerNow()
    const tiltAsk = settings.steer === 'tilt' && tilt === 'ask'
    const c = Object.assign(document.createElement('div'), { className: 'dt-cluster' })
    c.style.setProperty('--dt-alpha', String(settings.opacity))
    for (const p of layout(settings, steer, { width: innerWidth, height: innerHeight, portrait: portrait.matches }, tiltAsk)) {
      let el: HTMLElement
      if (p.act === 'wheel') {
        el = Object.assign(document.createElement('div'), { className: 'vx-recess dt-wheel' })
        el.dataset.act = 'wheel'
        el.setAttribute('data-vx-ring', '')
        el.setAttribute('role', 'slider')
        el.setAttribute('aria-label', 'Steering wheel')
        el.setAttribute('aria-valuemin', '-1'); el.setAttribute('aria-valuemax', '1'); el.setAttribute('aria-valuenow', '0')
        el.setAttribute('aria-pressed', 'false')
      } else {
        const [label, aria] = LABELS[p.act] ?? [p.act, p.act]
        el = key(p.act, label)
        el.setAttribute('aria-label', aria)
        if (p.act === 'drift') el.dataset.vxKind = 'main'
        if (p.act === 'tilt-on') { el.innerHTML = `<span class="hud-lbl">${label}</span>`; el.dataset.vxKind = 'main' }
      }
      el.style.inlineSize = `${p.w}px`
      el.style.blockSize = `${p.h}px`
      el.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${14 + p.y}px)`
      el.style[p.side] = `calc(env(safe-area-inset-${p.side}, 0px) + ${14 + p.x}px)`
      keyEl.set(p.act, el)
      c.append(el)
    }
    if (steer === 'slide') {
      const ghost = Object.assign(document.createElement('div'), { className: 'dt-ghost', textContent: '‹  slide to steer  ›' })
      const side = settings.hand === 'right' ? 'left' : 'right'
      ghost.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 30px)'
      ghost.style[side] = `calc(env(safe-area-inset-${side}, 0px) + 28px)`
      c.append(ghost)
    }
    // One pad for the cluster: a touch holds the key under it, and as it slides, the key it comes onto instead.
    c.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-act="tilt-on"]')) { e.preventDefault(); e.stopPropagation(); return }
      const wheel = t.closest<HTMLElement>('[data-act="wheel"]')
      if (wheel) {
        e.preventDefault(); e.stopPropagation()
        try { wheel.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
        wheelPointer = e.pointerId
        wheelBack = false
        const w = wheelAngle(wheel, e.clientX, e.clientY)
        wheelFrom = w.a
        wheelWas = wheelTurnNow
        wheel.setAttribute('aria-pressed', 'true')
        autoGo = true
        return
      }
      const act = under(e.clientX, e.clientY)
      if (!act) return
      e.preventDefault(); e.stopPropagation()
      try { c.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
      by.set(e.pointerId, act)
      recount()
    })
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId === wheelPointer) {
        const wheel = keyEl.get('wheel')!
        const w = wheelAngle(wheel, e.clientX, e.clientY)
        // Near the middle the angle round it means little: hold the wheel where it is until the thumb is out again.
        if (w.far < 0.18) { wheelFrom = w.a; wheelWas = wheelTurnNow; return }
        wheelTurnNow = wheelTurn(wheelWas, swept(wheelFrom, w.a), settings.sens)
        wheel.setAttribute('aria-valuenow', wheelSteer(wheelTurnNow, settings.sens).toFixed(2))
        drawWheel()
        return
      }
      if (!by.has(e.pointerId)) return
      // Off every key, the last one stays held (a thumb rolls past an edge); onto another, that one is held instead.
      const act = under(e.clientX, e.clientY)
      if (act && act !== by.get(e.pointerId)) { by.set(e.pointerId, act); recount() }
    })
    const lift = (e: PointerEvent) => {
      if (e.pointerId === wheelPointer) { wheelPointer = null; wheelBack = true; keyEl.get('wheel')?.setAttribute('aria-pressed', 'false'); return }
      if (by.delete(e.pointerId)) recount()
    }
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) c.addEventListener(ev, lift)
    // A tap's own click after it (the key did what it does on the way down). Tilt is asked for on the click, as iOS
    // wants: a touch's start is not the hand's own there.
    c.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      if ((e.target as HTMLElement).closest('[data-act="tilt-on"]')) { tiltAsked = false; syncTilt(true); relay() }
    })
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    cluster = c
    drawWheel()
    return [c]
  }

  // Laid out again: when the scheme, the hand, the size or the orientation changes, or tilt comes or goes.
  const relay = () => {
    if (sheet?.open) fill()
    if (!shown || !cluster) return
    releaseAll()
    const old = cluster
    const els = build()
    old.replaceWith(...els)
  }
  portrait.addEventListener('change', relay)

  // ── The sheet ──
  let sheet: HTMLDialogElement | null = null
  const seg = (name: string, label: string, options: [string, string, string?][]) =>
    `<div class="dc-row${options.length > 3 ? ' wide' : ''}"><span class="dc-name" id="dc-${name}">${label}</span><div class="dc-seg" role="radiogroup" aria-labelledby="dc-${name}">${options.map(([v, t, sub]) => `<label><input type="radio" name="dc-${name}" value="${v}"><span>${t}</span>${sub ? `<small>${sub}</small>` : ''}</label>`).join('')}</div></div>`
  const tiltWords = (): [string, 'warn' | ''] => {
    switch (tilt) {
      case 'live': return ['Tilt is on. Hold the phone the way you like and press Center tilt.', '']
      case 'ask': return ['Touch the screen to let this page read the tilt.', '']
      case 'waiting': return ['Waiting for the tilt sensor…', '']
      case 'denied': return ['Motion access was refused. Allow Motion & Orientation Access for this site in your browser settings, then choose Tilt again.', 'warn']
      case 'none': return ['This device has no tilt sensor, so the arrows steer.', 'warn']
      case 'insecure': return ['Tilt needs the page over https, so the arrows steer.', 'warn']
      default: return ['', '']
    }
  }
  const fill = () => {
    if (!sheet) return
    for (const [name, value] of [['steer', settings.steer], ['gas', settings.gas], ['hand', settings.hand], ['size', String(settings.size)]] as const) {
      for (const r of sheet.querySelectorAll<HTMLInputElement>(`input[name="dc-${name}"]`)) r.checked = r.value === value
    }
    sheet.querySelector<HTMLInputElement>('input[name="dc-opacity"]')!.value = String(Math.round(settings.opacity * 100))
    sheet.querySelector<HTMLInputElement>('input[name="dc-sens"]')!.value = String(Math.round(settings.sens * 100))
    sheet.querySelector<HTMLElement>('.dc-sens')!.hidden = settings.steer === 'arrows'
    const tiltRow = sheet.querySelector<HTMLElement>('.dc-tilt')!
    tiltRow.hidden = settings.steer !== 'tilt'
    const [words, tone] = tiltWords()
    const note = sheet.querySelector<HTMLElement>('.dc-tilt .dc-note')!
    note.textContent = words
    note.dataset.tone = tone
    sheet.querySelector<HTMLButtonElement>('.dc-center')!.disabled = tilt !== 'live'
    // Tilt chosen but not to be had: said on its choice too, where the arrows are seen to steer instead.
    const tiltOption = sheet.querySelector<HTMLInputElement>('input[name="dc-steer"][value="tilt"]')!.closest('label')!
    const off = settings.steer === 'tilt' && (tilt === 'denied' || tilt === 'none' || tilt === 'insecure')
    tiltOption.toggleAttribute('data-warn', off)
    tiltOption.querySelector('small')!.textContent = off ? 'arrows for now' : 'turn the phone'
  }
  const makeSheet = () => {
    const d = document.createElement('dialog')
    d.id = 'drive-controls'
    d.setAttribute('aria-labelledby', 'dc-title')
    d.innerHTML = `<div class="dc-head"><h2 id="dc-title">Driving controls</h2><button class="dc-reset" type="button">Reset</button><button class="dc-done" type="button">Done</button></div>
<div class="dc-body">
${seg('steer', 'Steer with', [['arrows', 'Arrows', 'left & right'], ['wheel', 'Wheel', 'turn it'], ['slide', 'Slide', 'thumb across'], ['tilt', 'Tilt', 'turn the phone']])}
<div class="dc-row dc-tilt wide"><p class="dc-note" role="status"></p><div class="dc-acts"><button class="dc-center" type="button">Center tilt</button></div></div>
${seg('gas', 'Gas', [['pedals', 'Pedals', 'gas & brake'], ['auto', 'Auto', 'brake only']])}
${seg('hand', 'Driving keys on the', [['right', 'Right'], ['left', 'Left']])}
${seg('size', 'Key size', [['0.85', 'Small'], ['1', 'Medium'], ['1.2', 'Large']])}
<div class="dc-row"><label class="dc-name" for="dc-opacity">Key opacity</label><input id="dc-opacity" name="dc-opacity" type="range" min="30" max="100" step="5"></div>
<div class="dc-row dc-sens"><label class="dc-name" for="dc-sens">Steering sensitivity</label><input id="dc-sens" name="dc-sens" type="range" min="50" max="200" step="5"></div>
</div>`
    document.body.append(d)
    d.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement
      const name = t.name.replace(/^dc-/, '')
      if (name === 'steer') {
        const steer = t.value as Steer
        // Chosen by a touch: the moment to ask for the sensor where the browser asks.
        if (steer === 'tilt' && (tilt === 'denied' || tilt === 'ask' || tilt === 'off')) { tilt = 'off'; tiltAsked = false }
        set({ steer })
        if (steer === 'tilt') syncTilt(true)
      } else if (name === 'gas') set({ gas: t.value as Gas })
      else if (name === 'hand') set({ hand: t.value === 'left' ? 'left' : 'right' })
      else if (name === 'size') set({ size: Number(t.value) })
      fill()
    })
    d.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement
      if (t.name === 'dc-opacity') { settings = parseSettings({ ...settings, opacity: Number(t.value) / 100 }); save(); cluster?.style.setProperty('--dt-alpha', String(settings.opacity)) }
      if (t.name === 'dc-sens') { settings = parseSettings({ ...settings, sens: Number(t.value) / 100 }); save() }
    })
    d.querySelector('.dc-done')!.addEventListener('click', () => d.close())
    d.querySelector('.dc-center')!.addEventListener('click', () => { if (tilt === 'live') { set({ tiltZero: clamp(tiltTurn, -0.6, 0.6) }); fill() } })
    d.querySelector('.dc-reset')!.addEventListener('click', () => { set({ ...DEFAULTS }); fill() })
    // A press on the backdrop (outside the sheet) puts it away.
    d.addEventListener('click', (e) => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close() } })
    d.addEventListener('close', () => releaseAll())
    return d
  }

  const set = (patch: Partial<DriveTouchSettings>) => {
    const was = settings
    settings = parseSettings({ ...settings, ...patch })
    save()
    syncTilt()
    if (was.steer !== settings.steer || was.gas !== settings.gas || was.hand !== settings.hand || was.size !== settings.size) {
      applyStick()
      relay()
    }
  }
  const applyStick = () => {
    o.input.stickSide = shown ? (steerNow() === 'slide' ? (settings.hand === 'right' ? 'left' : 'right') : null) : 'left'
    html.classList.toggle('steer-slide', shown && steerNow() === 'slide')
  }

  let lastFrame = 0
  return {
    get settings() { return settings },
    set,
    show(on) {
      if (on === shown && (!on || cluster)) return cluster ? [cluster] : []
      shown = on
      releaseAll()
      autoGo = false
      wheelTurnNow = 0
      if (!on) { cluster = null; keyEl.clear(); syncTilt(); applyStick(); return [] }
      syncTilt()
      applyStick()
      return build()
    },
    read() {
      const zero = { go: 0, turn: 0, rise: 0, boost: false }
      const now = performance.now(), dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0
      lastFrame = now
      // The wheel comes back to the middle when let go, at a hand's pace.
      if (wheelBack && wheelTurnNow !== 0) {
        const step = 720 * dt
        wheelTurnNow = Math.abs(wheelTurnNow) <= step ? 0 : wheelTurnNow - Math.sign(wheelTurnNow) * step
        drawWheel()
        if (wheelTurnNow === 0) wheelBack = false
      }
      if (!shown || !cluster) return zero
      // Nothing under the thumbs while something is over the keys, or the page is away: auto gas stops too, until touched again.
      const over = document.hidden || !!sheet?.open || !cluster.isConnected || html.matches('.map-open, .drawer, .choosing')
        || !!document.querySelector('#ask.open, #radio-picker[open], #realm.open') || !cluster.checkVisibility()
      if (over) { if (held.size || autoGo) { releaseAll(); autoGo = false } return zero }
      const steer = steerNow()
      let turn = 0
      if (steer === 'arrows') turn = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
      else if (steer === 'slide') turn = o.input.thumb ? touchSteerCurve(clamp(o.input.stick[0] * settings.sens, -1, 1), 0) : 0
      else if (steer === 'wheel') turn = wheelSteer(wheelTurnNow, settings.sens)
      else if (steer === 'tilt') turn = tiltUpright < 0.25 ? 0 : tiltSteer(tiltTurn, settings.tiltZero, settings.sens) * Math.min(1, (tiltUpright - 0.25) / 0.2)
      if (o.input.thumb) autoGo = true
      const brake = held.has('brake') ? 1 : 0
      const go = settings.gas === 'auto' ? (brake ? -1 : autoGo ? 1 : 0) : (held.has('gas') ? 1 : 0) - brake
      return { go, turn, rise: held.has('drift') ? 1 : 0, boost: held.has('boost') }
    },
    release: releaseAll,
    open() {
      sheet ??= makeSheet()
      fill()
      if (!sheet.open) sheet.showModal()
    },
    note() {
      if (!shown) return ''
      if (settings.steer === 'tilt' && tilt === 'ask') return 'Tap for tilt'
      if (settings.steer === 'tilt' && tilt === 'waiting') return 'Tilt: waiting'
      if (settings.gas === 'auto' && !autoGo) return 'Tap to drive'
      return ''
    },
    get tilt() { return tilt },
    get steer() { return steerNow() },
  }
}
