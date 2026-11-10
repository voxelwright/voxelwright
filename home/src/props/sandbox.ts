// #42 prop sandbox, page side (dev only). Model-written prop code runs in a
// dedicated worker inside a sealed iframe and only data comes back:
//
//   page ──MessagePort──▶ iframe relay (sandbox="allow-scripts", opaque origin,
//                         CSP default-src 'none') ──postMessage──▶ blob Worker
//                         (inherits the CSP; runs the module; serializes)
//
// The page listens on one MessagePort, transferred once at startup, and never on
// window "message". Every reply is untrusted until rebuild.ts has validated it.
// The README section "Prop sandbox (#42)" lists what this relies on.
import workerSource from 'virtual:prop-box'
import { sealedFrame } from '../sealed'
import { BOX_PATH } from './relay'

export { MAX_RESULT_BYTES } from './relay'

export interface BoxTiming {
  /** Iframe and worker start: cold includes the iframe; warm is a pre-started worker. */
  startMs: number
  cold: boolean
  runMs: number
  serializeMs: number
  transferMs: number
}

export type BoxResult = { ok: true; data: unknown; timing: BoxTiming } | { ok: false; reason: string }


const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

export class PropBox {
  private frame: HTMLIFrameElement | null = null
  private port: MessagePort | null = null
  private started: Promise<number> | null = null
  private next = 1
  private pending = new Map<number, (result: BoxResult) => void>()

  /** Starts the iframe and its first worker; resolves with the milliseconds that took. */
  start(): Promise<number> {
    if (this.started) return this.started
    const t0 = performance.now()
    const { frame, port } = sealedFrame(BOX_PATH, workerSource)
    this.frame = frame
    this.port = port
    const started = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the prop sandbox did not start')), 10000)
      port.onmessage = (event) => {
        const m = event.data as { type?: unknown; id?: unknown }
        if (m?.type === 'ready') {
          clearTimeout(timer)
          return resolve(performance.now() - t0)
        }
        if (typeof m?.id !== 'number') return
        const settle = this.pending.get(m.id)
        if (settle) settle(this.read(m))
      }
    })
    // A start that failed is not kept: the dead frame goes, and the next run starts afresh.
    started.catch(() => {
      if (this.started === started) this.dispose()
    })
    this.started = started
    return started
  }

  /** Runs one module in a fresh worker. The page's own limit is the box's plus 3 s; past it the box is torn down. */
  async run(code: string, timeoutMs = 5000): Promise<BoxResult> {
    const cold = !this.started
    let startMs: number
    try {
      startMs = await this.start()
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    const id = this.next++
    return new Promise<BoxResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.dispose()
        resolve({ ok: false, reason: 'the sandbox stopped answering and was closed' })
      }, timeoutMs + 3000)
      this.pending.set(id, (result) => {
        clearTimeout(timer)
        this.pending.delete(id)
        if (result.ok && cold) result.timing = { ...result.timing, startMs, cold: true }
        resolve(result)
      })
      this.port!.postMessage({ type: 'run', id, code, timeoutMs })
    })
  }

  /** Reads a reply into a fresh object: only known fields, numbers checked. */
  private read(m: { type?: unknown; data?: unknown; reason?: unknown; timing?: unknown }): BoxResult {
    if (m.type === 'error') return { ok: false, reason: String(m.reason).slice(0, 500) }
    if (m.type !== 'result') return { ok: false, reason: 'the sandbox sent something that is not a result' }
    const t = (m.timing && typeof m.timing === 'object' ? m.timing : {}) as Record<string, unknown>
    const sentAt = num(t.sentAt)
    return {
      ok: true,
      data: m.data,
      timing: {
        startMs: num(t.startMs),
        cold: t.cold === true,
        runMs: num(t.runMs),
        serializeMs: num(t.serializeMs),
        transferMs: performance.timeOrigin + performance.now() - sentAt,
      },
    }
  }

  dispose() {
    this.port?.close()
    this.frame?.remove()
    for (const settle of this.pending.values()) settle({ ok: false, reason: 'the sandbox was closed' })
    this.pending.clear()
    this.frame = this.port = this.started = null
  }
}
