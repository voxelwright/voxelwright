// The page's one owner of keys, pointer and touch (#243, #244). Nothing else listens for them: `main.ts`
// and every lane read what is held and what was turned from here, and add a mode to say what a key or a
// click means for the time being.
//
// Modes are a stack. The page's own (`moving`) is at the bottom; a lane pushes one over it:
//
//   typing    solid, text     the ask bar is open: keys are letters, nothing is held, the pointer is let go
//   aiming    (not solid)     the wand's: a click is its own, the keys and the look still move you
//   mounted   solid           in a seat: the keys and the look are the vehicle's, read from here by whoever drives it
//
// A key pressed or a click goes to the top mode first and on down until one takes it (returns true) or a
// solid mode has had its turn. What is held (`held`), what the head was turned by (`turn`) and the touch
// stick (`stick`) are the same for everyone: a mode acts on them only while it is `live`, which is until a
// solid mode is pushed over it. They are emptied whenever a mode comes or goes, so a key held as the ask
// bar opens is not still held when it shuts.
//
// Taking a mode off takes only that mode, wherever it is in the stack. A mode is there exactly until its own
// owner takes it off: one lane taking its mode off (the feet's, as a ride starts or B is pressed) must never take
// another lane's with it, since that lane would go on thinking its mode is there and its keys would do nothing.

import { gamepad, radialDeadzone, TOUCH_DEADZONE, type DriveAxes, type RumbleImpact, type RumbleTelemetry } from './gamepad.ts'

export type { DriveAxes, RumbleImpact, RumbleTelemetry }

export interface Mode {
  readonly name: string
  /** Stops what is under it: keys and clicks go no further down, and the modes below are not live. */
  readonly solid?: boolean
  /** Keys are letters here: none is held, and the pointer is let go as it starts. */
  readonly text?: boolean
  /** Every key is this mode's while it is on top, those that mean the same everywhere too (#247: an instrument's keys are notes, and Q is one). */
  readonly every?: boolean
  /** While this mode is live the picture does not take the pointer (a click on it is only a click) and no key means what it means everywhere (#450: a realm's first view, a still picture). Whatever a lane lays over it that is not solid leaves it so. */
  readonly still?: boolean
  /** A key going down (its `code`). True if this mode took it. */
  key?(code: string, e: KeyboardEvent): boolean | void
  /** A click with the pointer held, or a tap on the use button. True if this mode took it. */
  use?(): boolean | void
  /** The wheel, by the event's `deltaY`. True if this mode took it. */
  wheel?(deltaY: number): boolean | void
}

export interface Input {
  /** Whether a key is down now, by its `code`. Never true in a text mode. */
  held(code: string): boolean
  /** How far the head was turned since this was last asked: [right, up] in radians. Asking takes it. */
  turn(): [number, number]
  /** The left thumb's stick on a phone: [right, back], each -1 to 1; [0, 0] with no thumb down. */
  readonly stick: readonly [number, number]
  /** Adds a mode on top. Returns what takes that mode off again, and only it: what was put over it since stays where it is. */
  push(mode: Mode): () => void
  /** Whether a mode of that name is in the stack with no solid mode over it. */
  live(name: string): boolean
  /** The name of the top mode. */
  readonly top: string
  /** Whether the picture holds the pointer. */
  readonly locked: boolean
  /** A key that means the same in every mode but a text one (Enter opens the ask bar). It is asked before the modes. */
  always(code: string, act: (e: KeyboardEvent) => boolean | void): void
  /** Does what a click with the pointer held does: for the checks and for buttons a lane adds. */
  use(): void
  /** Holds a key down or lets it up, as a key on the keyboard would be (an on-screen key for a thumb: up and down in flight). Nothing in a text mode. */
  hold(code: string, down: boolean): void
  /** Where the left thumb went down to steer, and where it is now (client px), while it is down: for what shows the stick. */
  readonly thumb: { readonly from: readonly [number, number]; readonly at: readonly [number, number] } | null
  /** Full analog driving axes from a connected gamepad, or null when no gamepad is active. */
  readonly driveAxes?: DriveAxes | null
  /** Polls connected gamepads once per frame (zero overhead when no gamepad is connected). */
  poll?(dt: number): void
  /** Continuous dual-motor haptic feedback while driving; pass null to silence motors. */
  rumble?(telemetry: RumbleTelemetry | null): void
  /** One-shot strong-motor haptic pulse for hill landings, gear upshifts, and crash impacts. */
  pulse?(kind: RumbleImpact, intensity?: number): void
}

/** Whether keys typed there are letters of the page's own DOM (a line someone is writing on). A key, a fader or a radio in focus takes no letters: W still walks (#450). */
const PRESSED = new Set(['radio', 'checkbox', 'range', 'button'])
const written = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || (target instanceof HTMLInputElement && !PRESSED.has(target.type)) || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)

export function input(canvas: HTMLCanvasElement, { phone = false, useButton = null as Element | null } = {}): Input {
  const stack: Mode[] = [], down = new Set<string>(), everywhere = new Map<string, (e: KeyboardEvent) => boolean | void>()
  let right = 0, up = 0
  const touch = { move: null as null | { id: number; x: number; y: number; dx: number; dy: number }, turn: null as null | { id: number; x: number; y: number } }
  const stick: [number, number] = [0, 0]
  const empty = () => { down.clear(); right = 0; up = 0 }
  const top = () => stack[stack.length - 1]
  /** From the top down, until one takes it or a solid one has been asked. */
  const each = (ask: (mode: Mode) => boolean | void) => { for (let i = stack.length - 1; i >= 0; i--) { if (ask(stack[i]) === true || stack[i].solid) return } }
  const use = () => each((m) => m.use?.())
  const live = (name: string) => {
    for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].name === name) return true; if (stack[i].solid) return false }
    return false
  }
  /** Whether a still mode is live: from the top down to the first solid one. */
  const still = () => { for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].still) return true; if (stack[i].solid) return false } return false }
  const dispatchKey = (code: string) => {
    if (top()?.text) return
    const synth = typeof KeyboardEvent === 'function' ? new KeyboardEvent('keydown', { code }) : ({ code, preventDefault() {} } as unknown as KeyboardEvent)
    if (!top()?.every && !still() && everywhere.get(code)?.(synth) === true) return
    each((m) => m.key?.(code, synth))
  }
  const pad = gamepad({ key: dispatchKey, use, isMounted: () => live('mounted'), isText: () => !!top()?.text })

  addEventListener('keydown', (e) => {
    if (written(e.target) || top()?.text) return
    down.add(e.code)
    if (!top()?.every && !still() && everywhere.get(e.code)?.(e) === true) return
    each((m) => m.key?.(e.code, e))
  })
  addEventListener('keyup', (e) => down.delete(e.code))
  // A window that is left never hears the keys come up.
  addEventListener('blur', () => down.clear())
  canvas.addEventListener('click', () => {
    if (phone || still()) return
    if (document.pointerLockElement === canvas) use()
    else void canvas.requestPointerLock()
  })
  useButton?.addEventListener('click', use)
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return
    right += e.movementX * 0.0022
    up -= e.movementY * 0.0022
  })
  addEventListener('wheel', (e) => { if (!written(e.target)) each((m) => m.wheel?.(e.deltaY)) }, { passive: true })
  // A phone: the left half of the screen is a stick to move by, the right half turns the head.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    // A browser may only keep the screen on once it has been touched.
    void (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {})
    canvas.setPointerCapture(e.pointerId)
    if (e.clientX < innerWidth / 2) touch.move = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
    else touch.turn = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (touch.move?.id === e.pointerId) { touch.move.dx = (e.clientX - touch.move.x) / 60; touch.move.dy = (e.clientY - touch.move.y) / 60 }
    if (touch.turn?.id === e.pointerId) {
      right += (e.clientX - touch.turn.x) * 0.005
      up -= (e.clientY - touch.turn.y) * 0.005
      touch.turn.x = e.clientX
      touch.turn.y = e.clientY
    }
  })
  const lift = (e: PointerEvent) => { if (touch.move?.id === e.pointerId) touch.move = null; if (touch.turn?.id === e.pointerId) touch.turn = null }
  canvas.addEventListener('pointerup', lift)
  canvas.addEventListener('pointercancel', lift)

  return {
    held: (code) => down.has(code) || (!top()?.text && pad.held(code)),
    turn() { const t: [number, number] = [right, up]; right = 0; up = 0; return t },
    get stick() {
      if (touch.move) {
        const [sx, sy] = radialDeadzone(touch.move.dx, touch.move.dy, TOUCH_DEADZONE)
        stick[0] = sx
        stick[1] = sy
      } else if (pad.active) {
        stick[0] = pad.stick[0]
        stick[1] = pad.stick[1]
      } else {
        stick[0] = 0
        stick[1] = 0
      }
      return stick
    },
    get driveAxes() { return pad.driveAxes },
    poll(dt: number) {
      const [gr, gu] = pad.poll(dt)
      if (gr !== 0 || gu !== 0) { right += gr; up += gu }
    },
    rumble(telemetry: RumbleTelemetry | null) { pad.rumble(telemetry) },
    pulse(kind: RumbleImpact, intensity?: number) { pad.pulse(kind, intensity) },
    push(mode) {
      stack.push(mode)
      empty()
      if (mode.text) { document.exitPointerLock?.(); pad.stopRumble() }
      return () => {
        const at = stack.indexOf(mode)
        if (at < 0) return
        stack.splice(at, 1)
        empty()
      }
    },
    live,
    get top() { return top()?.name ?? '' },
    get locked() { return document.pointerLockElement === canvas },
    always(code, act) { everywhere.set(code, act) },
    use,
    hold(code, on) {
      if (!on) { down.delete(code); return }
      if (top()?.text) return
      down.add(code)
    },
    get thumb() { const m = touch.move; return m ? { from: [m.x, m.y] as const, at: [m.x + m.dx * 60, m.y + m.dy * 60] as const } : null },
  }
}
