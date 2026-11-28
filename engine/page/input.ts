// The page's primary owner of keys, pointer and touch (#243, #244). `main.ts` and most lanes read what is
// held and what was turned from here (a few overlays such as the minimap and radial HUD add their own key
// listeners), and add a mode to say what a key or a click means for the time being.
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
  /** The picture's button going down with the pointer held (#226: the Cleave draws while it is held). True if this mode took it: the click that ends the press is then this mode's, and no `use`. */
  pointerDown?(): boolean | void
  /** That button coming up again, wherever the pointer is by then. True if this mode took it. */
  pointerUp?(): boolean | void
  /** The second button (a right click) with the pointer held. True if this mode took it. */
  rightClick?(): boolean | void
  /** The head about to be turned, by mouse, thumb or stick (radians: right, up). True if this mode took it: the view stays where it is (the Cleave's brush is steered instead). */
  move?(dx: number, dy: number): boolean | void
  /** Whatever this mode was in the middle of is called off: Escape, the pointer let go of, the window left. */
  cancel?(): void
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
  /** Does what the picture's button going down (true) or coming up does, and what a right click does: for the checks and for buttons a lane adds. */
  press?(down: boolean): void
  secondary?(): void
  /** Turns the head by so much (radians: right, up), as the mouse would: a live mode's `move` may take it. For the checks. */
  turnBy?(dx: number, dy: number): void
  /** Holds a key down or lets it up, as a key on the keyboard would be (an on-screen key for a thumb: up and down in flight). Nothing in a text mode. */
  hold(code: string, down: boolean): void
  /** Where the left thumb went down to steer, and where it is now (client px), while it is down: for what shows the stick. */
  readonly thumb: { readonly from: readonly [number, number]; readonly at: readonly [number, number] } | null
  /** Which half of the screen a touch on the picture is the move stick in (the other turns the head), or null for none:
   * every touch on the picture turns the head. 'left' unless a lane says otherwise (drive-touch.ts while driving). */
  stickSide: 'left' | 'right' | null
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
  let stickSide: 'left' | 'right' | null = 'left'
  const empty = () => { down.clear(); right = 0; up = 0 }
  const top = () => stack[stack.length - 1]
  /** From the top down, until one takes it or a solid one has been asked. */
  const each = (ask: (mode: Mode) => boolean | void) => { for (let i = stack.length - 1; i >= 0; i--) { if (ask(stack[i]) === true || stack[i].solid) return } }
  const use = () => each((m) => m.use?.())
  /** The head turned by so much: a live mode may take it for itself (`move`), else the view turns. */
  const turned = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return
    let took = false
    each((m) => { if (m.move?.(dx, dy) === true) took = true; return took })
    if (!took) { right += dx; up += dy }
  }
  /** A press and its release (#226). Whether a mode took the press that is down now: the click that ends it is then not a `use`. */
  let pressTaken = false
  const press = (isDown: boolean) => {
    if (!isDown) { each((m) => m.pointerUp?.()); return }
    pressTaken = false
    each((m) => { if (m.pointerDown?.() === true) pressTaken = true; return pressTaken })
  }
  const secondary = () => each((m) => m.rightClick?.())
  /** Every live mode that was in the middle of something calls it off. */
  const cancel = () => { for (let i = stack.length - 1; i >= 0; i--) { stack[i].cancel?.(); if (stack[i].solid) return } }
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
    if (e.code === 'Escape') cancel()
    if (!top()?.every && !still() && everywhere.get(e.code)?.(e) === true) return
    each((m) => m.key?.(e.code, e))
  })
  addEventListener('keyup', (e) => down.delete(e.code))
  // A window that is left never hears the keys come up.
  addEventListener('blur', () => { down.clear(); cancel() })
  // Escape with the pointer held lets the pointer go, and a browser may not say the key was pressed: the pointer let go calls off the same.
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) cancel() })
  canvas.addEventListener('mousedown', (e) => {
    pressTaken = false
    if (phone || still() || document.pointerLockElement !== canvas) return
    if (e.button === 0) press(true)
    else if (e.button === 2) secondary()
  })
  // The button comes up wherever the pointer is: a press a mode took must always end.
  addEventListener('mouseup', (e) => { if (e.button === 0 && !phone) press(false) })
  canvas.addEventListener('click', () => {
    if (phone || still()) return
    if (document.pointerLockElement === canvas) { if (pressTaken) pressTaken = false; else use() }
    else void Promise.resolve(canvas.requestPointerLock()).catch(() => {})
  })
  useButton?.addEventListener('click', use)
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return
    turned(e.movementX * 0.0022, -e.movementY * 0.0022)
  })
  addEventListener('wheel', (e) => { if (!written(e.target)) each((m) => m.wheel?.(e.deltaY)) }, { passive: true })
  // A phone: the left half of the screen is a stick to move by, the right half turns the head.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    // A browser may only keep the screen on once it has been touched.
    void (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {})
    canvas.setPointerCapture(e.pointerId)
    const left = e.clientX < innerWidth / 2
    if (stickSide && left === (stickSide === 'left')) touch.move = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
    else touch.turn = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (touch.move?.id === e.pointerId) { touch.move.dx = (e.clientX - touch.move.x) / 60; touch.move.dy = (e.clientY - touch.move.y) / 60 }
    if (touch.turn?.id === e.pointerId) {
      turned((e.clientX - touch.turn.x) * 0.005, -(e.clientY - touch.turn.y) * 0.005)
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
      turned(gr, gu)
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
    press,
    secondary,
    turnBy: turned,
    hold(code, on) {
      if (!on) { down.delete(code); return }
      if (top()?.text) return
      down.add(code)
    },
    get thumb() { const m = touch.move; return m ? { from: [m.x, m.y] as const, at: [m.x + m.dx * 60, m.y + m.dy * 60] as const } : null },
    get stickSide() { return stickSide },
    set stickSide(side) { if (side === stickSide) return; stickSide = side; touch.move = null },
  }
}
