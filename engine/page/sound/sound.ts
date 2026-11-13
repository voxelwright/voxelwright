// The page's end of sound (#247): one audio context, the synthesiser on its thread (dsp.ts), and where things are
// heard from. Whoever has something to be heard gives a patch, a place and a force; this says how loud, how late,
// how dull and on which side it arrives, and sends it on. Nothing here makes a sample.
//
// Sound may only start after a touch or a key. The context is made at once (that costs nothing to hear) and resumed
// by the first pointer-up, touch-end, click or key anywhere: a touch going down is not enough for a browser, its
// coming up is. On an iPhone the ringer switch silences a page's sound unless the page says it is playing something
// (navigator.audioSession), so it says so.
import { NOTE, SET, BUS } from './dsp.ts'
import { compile, type Patch } from './patch.ts'

export { SET, BUS }
/** Metres a second. */
const SPEED = 343
/** Cells in a metre. */
const M = 10

export interface Play {
  /** Where, in the world's finest cells; left out, it is heard in the head (music, an instrument in the hand). */
  at?: readonly [number, number, number]
  /** 0 to 1: how hard. */
  force?: number
  /** How big against the patch's own size (1). */
  size?: number
  /** Hz, in place of the patch's own pitch. */
  pitch?: number
  /** Seconds held, for what is held. */
  dur?: number
  /** Seconds from now. */
  after?: number
  /** Or the moment itself, on the context's clock (music keeps time by it). */
  when?: number
  /** How loud against its own loudness (1), for what is heard in the head. */
  gain?: number
  /** How much of it goes to the room, for what is heard in the head. */
  room?: number
  /** Metres at which it is half as loud as close to: a hammer blow 4, a charge 40. */
  reach?: number
  bus?: number
  /** -1 to 1, for what is heard in the head. */
  pan?: number
  /** Whether it waits for sound to cross the distance (a blast does; default yes). */
  travels?: boolean
}
export interface Told { voices: number; stolen: number; peak: number; held: number; dropped: number; reset: number; ms: number; worst: number; blocks: number; frame: number }

export interface Sound {
  readonly context: AudioContext
  /** Whether it can be heard yet: a touch or a key has started it. */
  readonly running: boolean
  /** Plays a patch. Returns false if it was too far off to hear. */
  play(patch: Patch, how?: Play): boolean
  /** Where the ears are (cells) and which way they face (radians from north towards east), once a frame. Sends what was asked since. */
  listen(eye: readonly [number, number, number], yaw: number): void
  /** Sets a bed's level, the room or a bus (SET). */
  set(which: number, value: number): void
  /** A place as the ears have it: how loud (0 to 1), which side (-1 to 1), how dull (Hz), how late (s). */
  hear(at: readonly [number, number, number], reach?: number): { gain: number; pan: number; lp: number; late: number; far: number }
  /** Stops what is held on a bus. */
  hush(bus: number): void
  /** What the audio thread last said of itself, once a second. */
  readonly told: Told | null
  /** What this thread has spent on sound, ms a frame, smoothed. */
  readonly spent: number
  /** A node everything passes, for a meter or a recorder. */
  readonly out: AudioNode
  flush(): void
}

export async function sound(): Promise<Sound> {
  // The page says it plays sound, as a player would: otherwise an iPhone's ringer switch silences it (WebKit bug 237322).
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) try { session.type = 'playback' } catch { /* an older Safari: the switch decides */ }
  const context = new AudioContext({ latencyHint: 'interactive' })
  await context.audioWorklet.addModule('/page/sound/dsp.ts')
  const node = new AudioWorkletNode(context, 'village-voice', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
  node.connect(context.destination)
  let told: Told | null = null
  node.port.onmessage = (e: MessageEvent<Told>) => { told = e.data }

  // Any touch or key starts it, and starts it again after a call, a lock or a switch of apps has stopped it.
  let hidden = false
  const wake = () => { if (context.state !== 'running' && !hidden) void context.resume().catch(() => {}) }
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) addEventListener(type, wake, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; if (hidden) void context.suspend().catch(() => {}); else if (navigator.userActivation?.hasBeenActive ?? true) wake() })

  const ids = new Map<Patch, number>()
  const id = (p: Patch) => {
    let n = ids.get(p)
    if (n === undefined) { n = ids.size + 1; ids.set(p, n); node.port.postMessage({ define: [n, compile(p)] }) }
    return n
  }
  const ear = { at: [0, 0, 0] as [number, number, number], right: [1, 0] as [number, number], ahead: [0, -1] as [number, number] }
  let notes: number[] = [], sets: number[] = [], spent = 0

  const hear = (at: readonly [number, number, number], reach = 4) => {
    const dx = (at[0] - ear.at[0]) / M, dy = (at[1] - ear.at[1]) / M, dz = (at[2] - ear.at[2]) / M, far = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz) || 1
    // Half as loud at its reach, and so on outward; nothing at all past sixty times that, faded so that nothing switches off.
    const most = reach * 60, gain = far >= most ? 0 : (reach / (reach + far)) * Math.min(1, (most - far) / (most * 0.2))
    // A thing close by is all round the head: it goes to one side only as it gets some way off. Behind is a little duller.
    const side = ((dx * ear.right[0] + dz * ear.right[1]) / flat) * Math.min(1, far / 1.5) * 0.9, front = (dx * ear.ahead[0] + dz * ear.ahead[1]) / flat
    // Air and the ground between take the top off what is far: half of it by 60 m, nearly all by half a kilometre.
    return { gain, pan: side, lp: (400 + 19600 * Math.exp(-far / 90)) * (front < 0 ? 0.75 + 0.25 * (1 + front) : 1), late: far / SPEED, far }
  }
  const flush = () => {
    if (notes.length) { node.port.postMessage({ notes: Float64Array.from(notes) }); notes = [] }
    if (sets.length) { node.port.postMessage({ set: sets }); sets = [] }
  }
  return {
    context, out: node,
    get running() { return context.state === 'running' },
    get told() { return told },
    get spent() { return spent },
    hear, flush,
    play(patch, how = {}) {
      if (context.state !== 'running') return false
      const t0 = performance.now()
      let gain = how.gain ?? 1, pan = how.pan ?? 0, lp = 0, late = 0, send = how.room ?? 0
      if (how.at) {
        const h = hear(how.at, how.reach)
        if (h.gain < 0.002) return false
        gain = h.gain; pan = h.pan; lp = h.lp; late = how.travels === false ? 0 : h.late
        // What is far is heard more off the town than straight.
        send = Math.min(0.5, 0.08 + h.far / 120)
      }
      const when = ((how.when ?? context.currentTime + (how.after ?? 0)) + late) * context.sampleRate
      notes.push(when, id(patch), how.pitch ?? 0, how.size ?? 1, how.force ?? 0.7, how.dur ?? 0, gain * Math.sqrt(0.5 * (1 - pan)) * 1.25, gain * Math.sqrt(0.5 * (1 + pan)) * 1.25, lp, send, how.bus ?? BUS.world, 0)
      if (notes.length !== NOTE * Math.round(notes.length / NOTE)) throw new Error('a note is twelve numbers')
      // What is played by hand does not wait for the frame.
      if (how.bus === BUS.play) flush()
      spent += (performance.now() - t0 - spent) * 0.05
      return true
    },
    listen(eye, yaw) {
      ear.at = [eye[0], eye[1], eye[2]]
      ear.right = [Math.cos(yaw), Math.sin(yaw)]
      ear.ahead = [Math.sin(yaw), -Math.cos(yaw)]
      flush()
    },
    set(which, value) { sets.push(which, value) },
    hush(bus) { node.port.postMessage({ hush: bus }) },
  }
}
