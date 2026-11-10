// The mechanic sandbox, page side (#106). A mechanic's code is model output, so it runs three
// walls away from the page and its session:
//
//   page ──MessagePort──▶ frame (sandbox="allow-scripts": an opaque origin with its own
//          policy, no network; ./relay.ts) ──▶ worker (./box/worker.ts) ──▶ QuickJS interpreter
//          (WebAssembly; no host functions bound) ──▶ the mechanic's code
//
// The page listens on one MessagePort, handed over once, and never on window "message". One
// frame holds one mechanic. Everything that comes back is text or a count; the text is JSON the
// engine checks field by field (src/engine/invent.ts). Closing is the page's alone: dispose()
// removes the frame, which ends the worker whatever it is doing, and asks it nothing.
// .agents/skills/quickjs-sandbox records why this shape (a native worker's memory is the page's).
import source from 'virtual:mechanic-box'
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import { LIMITS } from './limits'
import { BOX_PATH } from './relay'

export interface Tock { out?: string; error?: string; asks: number; ms: number }
export type Opened = { ok: true; box: MechanicBox; hooks: string[]; ms: number } | { ok: false; reason: string }

let wasm: Promise<ArrayBuffer> | undefined
/** The interpreter's bytes, fetched once from this origin; each box gets its own copy. */
const interpreter = () => (wasm ??= fetch(wasmUrl).then((r) => {
  if (!r.ok) throw new Error('the interpreter could not be fetched')
  return r.arrayBuffer()
}).catch((error) => {
  wasm = undefined
  throw error
}))

export class MechanicBox {
  /** One answer per tick, in order. */
  onTock: (reply: Tock) => void = () => {}
  /** The sandbox is gone (stuck, crashed, or it broke the protocol) and will not answer again. Called once. */
  onDead: (reason: string) => void = () => {}
  private frame: HTMLIFrameElement | null = null
  private port: MessagePort | null = null
  private sentAt = 0
  private warned = false
  private watch: ReturnType<typeof setInterval> | undefined
  private loaded: ((m: { type: string; hooks?: string; reason?: string; ms?: number }) => void) | null = null

  /** Starts a frame and loads `code` into a fresh interpreter. Refused (and closed) when the code does not load. */
  static async open(code: string): Promise<Opened> {
    const t0 = performance.now()
    if (code.length > LIMITS.code) return { ok: false, reason: 'its code is too long' }
    const box = new MechanicBox()
    try {
      const [bytes] = await Promise.all([interpreter(), box.start()])
      const m = await box.load(code, bytes.slice(0))
      if (m.type !== 'loaded') throw new Error(m.reason || 'its code did not load')
      const hooks: unknown = JSON.parse(m.hooks ?? '[]')
      return { ok: true, box, hooks: Array.isArray(hooks) ? hooks.filter((h): h is string => typeof h === 'string') : [], ms: performance.now() - t0 }
    } catch (error) {
      box.dispose()
      return { ok: false, reason: String(error instanceof Error ? error.message : error).slice(0, LIMITS.reason) }
    }
  }

  private start() {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.display = 'none'
    frame.src = BOX_PATH
    const channel = new MessageChannel()
    this.frame = frame
    this.port = channel.port1
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the sandbox did not start')), LIMITS.start)
      channel.port1.onmessage = (event) => {
        const m = event.data as { type?: unknown; out?: unknown; error?: unknown; asks?: unknown; ms?: unknown; hooks?: unknown; reason?: unknown }
        this.warned = false
        if (m?.type === 'ready') {
          clearTimeout(timer)
          resolve()
        } else if (m?.type === 'loaded' || m?.type === 'refused') {
          this.loaded?.({ type: m.type, hooks: typeof m.hooks === 'string' ? m.hooks : undefined, reason: typeof m.reason === 'string' ? m.reason : undefined, ms: Number(m.ms) })
        } else if (m?.type === 'tock') {
          this.sentAt = 0
          this.onTock({ ...(typeof m.out === 'string' ? { out: m.out } : { error: typeof m.error === 'string' ? m.error : 'it failed' }), asks: Number(m.asks) || 0, ms: Number(m.ms) || 0 })
        } else {
          // `dead` from the relay, or anything else at all: either way this box is over.
          this.die(m?.type === 'dead' && typeof m.reason === 'string' ? m.reason.slice(0, LIMITS.reason) : 'the sandbox sent something that is not an answer')
        }
      }
      frame.addEventListener('load', () => {
        // The frame's origin is opaque, so there is no origin to name; the message carries only the port and the public worker script.
        frame.contentWindow?.postMessage({ type: 'init', source }, '*', [channel.port2])
      }, { once: true })
      document.body.append(frame)
    })
  }

  private load(code: string, bytes: ArrayBuffer) {
    return new Promise<{ type: string; hooks?: string; reason?: string; ms?: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('its code took too long to load')), LIMITS.start)
      const done = (m: { type: string; hooks?: string; reason?: string }) => {
        clearTimeout(timer)
        this.loaded = null
        resolve(m)
      }
      this.loaded = done
      const dead = this.onDead
      this.onDead = (reason) => {
        this.onDead = dead
        done({ type: 'refused', reason })
      }
      this.port!.postMessage({ type: 'load', n: 0, code, wasm: bytes, budget: LIMITS.budget }, [bytes])
    }).finally(() => {
      // Loaded: from here a call that goes unanswered closes the box.
      this.watch = setInterval(() => {
        if (!this.sentAt || performance.now() - this.sentAt < LIMITS.late) return
        // A page that was itself held up has the answer waiting behind this timer: give it one more turn.
        if (this.warned) this.die('it stopped answering')
        else this.warned = true
      }, 250)
    })
  }

  /** Whether a tick is out and unanswered. */
  get waiting() {
    return this.sentAt > 0
  }

  /** Sends one view. The answer comes to onTock; send the next only after it. */
  tick(view: string) {
    if (!this.port) return
    this.sentAt = performance.now()
    this.port.postMessage({ type: 'tick', n: 0, view })
  }

  private die(reason: string) {
    const said = this.onDead
    this.dispose()
    said(reason)
  }

  /** Ends the frame and its worker. Nothing is asked of them, so nothing they do can stop it. */
  dispose() {
    clearInterval(this.watch)
    this.port?.close()
    this.frame?.remove()
    this.frame = this.port = null
    this.sentAt = 0
    this.onTock = this.onDead = () => {}
  }
}
