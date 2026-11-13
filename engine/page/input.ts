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

export interface Mode {
  readonly name: string
  /** Stops what is under it: keys and clicks go no further down, and the modes below are not live. */
  readonly solid?: boolean
  /** Keys are letters here: none is held, and the pointer is let go as it starts. */
  readonly text?: boolean
  /** Every key is this mode's while it is on top, those that mean the same everywhere too (#247: an instrument's keys are notes, and Q is one). */
  readonly every?: boolean
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
  /** Adds a mode on top. Returns what takes it off again (and whatever was put over it since). */
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
}

/** Whether keys typed there are letters of the page's own DOM (a line someone is writing on). */
const written = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)

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

  addEventListener('keydown', (e) => {
    if (written(e.target) || top()?.text) return
    down.add(e.code)
    if (!top()?.every && everywhere.get(e.code)?.(e) === true) return
    each((m) => m.key?.(e.code, e))
  })
  addEventListener('keyup', (e) => down.delete(e.code))
  // A window that is left never hears the keys come up.
  addEventListener('blur', () => down.clear())
  canvas.addEventListener('click', () => {
    if (phone) return
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
    held: (code) => down.has(code),
    turn() { const t: [number, number] = [right, up]; right = 0; up = 0; return t },
    get stick() {
      stick[0] = touch.move ? Math.max(-1, Math.min(1, touch.move.dx)) : 0
      stick[1] = touch.move ? Math.max(-1, Math.min(1, touch.move.dy)) : 0
      return stick
    },
    push(mode) {
      stack.push(mode)
      empty()
      if (mode.text) document.exitPointerLock?.()
      return () => {
        const at = stack.indexOf(mode)
        if (at < 0) return
        stack.length = at
        empty()
      }
    },
    live(name) {
      for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].name === name) return true; if (stack[i].solid) return false }
      return false
    },
    get top() { return top()?.name ?? '' },
    get locked() { return document.pointerLockElement === canvas },
    always(code, act) { everywhere.set(code, act) },
    use,
  }
}
