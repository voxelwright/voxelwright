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

/** The most bytes (typed-array buffers plus bitmap pixels) one result may carry. Checked in the relay and again by the page. */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024

export interface BoxTiming {
  /** Iframe and worker start: cold includes the iframe; warm is a pre-started worker. */
  startMs: number
  cold: boolean
  runMs: number
  serializeMs: number
  transferMs: number
}

export type BoxResult = { ok: true; data: unknown; timing: BoxTiming } | { ok: false; reason: string }

// The relay runs inside the sealed iframe. It never runs model code: it starts one
// worker per run, enforces the wall-clock limit by terminating it, forwards only the
// first message, and refuses results above the byte or value budget.
const RELAY = `
'use strict'
const MAX_BYTES = ${MAX_RESULT_BYTES}, MAX_VALUES = 200000
let port = null, url = null, spare = null
function spawn() {
  const worker = new Worker(url)
  const t0 = performance.now()
  let started
  const ready = new Promise((resolve) => { started = resolve })
  worker.onmessage = (e) => { if (e.data && e.data.type === 'ready') started(performance.now() - t0) }
  return { worker, ready }
}
function measure(value) {
  const stack = [value], buffers = new Set(), transfer = []
  let values = 0, bytes = 0
  while (stack.length) {
    const v = stack.pop()
    if (++values > MAX_VALUES) return { error: 'the result has too many values' }
    // Strings and keys count too, or a huge string would reach the page unmeasured (Sentinel, #42).
    if (typeof v === 'string') { bytes += v.length * 2; if (bytes > MAX_BYTES) return { error: 'the result is larger than ' + (MAX_BYTES >> 20) + ' MB' }; continue }
    if (v === null || typeof v !== 'object') continue
    if (ArrayBuffer.isView(v)) {
      if (!buffers.has(v.buffer)) { buffers.add(v.buffer); bytes += v.buffer.byteLength; transfer.push(v.buffer) }
    } else if (v instanceof ImageBitmap) { bytes += v.width * v.height * 4; transfer.push(v) }
    else if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) for (const k of Object.keys(v)) { bytes += k.length * 2; stack.push(v[k]) }
    else return { error: 'the result holds a ' + Object.prototype.toString.call(v).slice(8, -1) + ', which is not allowed' }
    if (bytes > MAX_BYTES) return { error: 'the result is larger than ' + (MAX_BYTES >> 20) + ' MB' }
  }
  return { transfer }
}
async function run(id, code, timeoutMs) {
  const t0 = performance.now()
  const cold = !spare
  const box = spare || spawn()
  spare = null
  let done = false
  const finish = (message, transfer) => {
    if (done) return
    done = true
    clearTimeout(timer)
    box.worker.terminate()
    port.postMessage(message, transfer || [])
    spare = spawn()
  }
  const timer = setTimeout(() => finish({ type: 'error', id, reason: 'ran past ' + timeoutMs + ' ms and was stopped' }), timeoutMs)
  await box.ready
  if (done) return
  const startMs = performance.now() - t0
  box.worker.onerror = (e) => { e.preventDefault(); finish({ type: 'error', id, reason: 'the module crashed: ' + String(e.message).slice(0, 300) }) }
  box.worker.onmessageerror = () => finish({ type: 'error', id, reason: 'the module sent a message that could not be read' })
  box.worker.onmessage = (e) => {
    const m = e.data
    if (!m || typeof m !== 'object' || m.id !== id || (m.type !== 'result' && m.type !== 'error'))
      return finish({ type: 'error', id, reason: 'the module sent something that is not a result' })
    if (m.type === 'error') return finish({ type: 'error', id, reason: String(m.reason).slice(0, 500) })
    const t = m.timing || {}
    const checked = measure(m.data)
    if (checked.error) return finish({ type: 'error', id, reason: checked.error })
    finish({ type: 'result', id, data: m.data, timing: { startMs, cold, runMs: +t.runMs, serializeMs: +t.serializeMs, sentAt: +t.sentAt } }, checked.transfer)
  }
  box.worker.postMessage({ id, code })
}
addEventListener('message', function init(e) {
  if (!e.data || e.data.type !== 'init' || !e.ports[0]) return
  removeEventListener('message', init)
  port = e.ports[0]
  url = URL.createObjectURL(new Blob([e.data.source], { type: 'text/javascript' }))
  spare = spawn()
  port.onmessage = (m) => {
    const d = m.data
    if (d && d.type === 'run' && typeof d.code === 'string') run(d.id, d.code, d.timeoutMs)
  }
  spare.ready.then((ms) => port.postMessage({ type: 'ready', ms }))
})
`

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
    const nonce = crypto.randomUUID().replace(/-/g, '')
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.display = 'none'
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:"><script nonce="${nonce}">${RELAY}</script>`
    const channel = new MessageChannel()
    this.frame = frame
    this.port = channel.port1
    this.started = new Promise<number>((resolve, reject) => {
      channel.port1.onmessage = (event) => {
        const m = event.data as { type?: unknown; id?: unknown }
        if (m?.type === 'ready') return resolve(performance.now() - t0)
        if (typeof m?.id !== 'number') return
        const settle = this.pending.get(m.id)
        if (settle) settle(this.read(m))
      }
      frame.addEventListener('load', () => {
        // The frame's origin is opaque, so there is no origin to name; the message carries only the port and the public worker source.
        frame.contentWindow!.postMessage({ type: 'init', source: workerSource }, '*', [channel.port2])
      }, { once: true })
      setTimeout(() => reject(new Error('the prop sandbox did not start')), 10000)
    })
    document.body.append(frame)
    return this.started
  }

  /** Runs one module in a fresh worker. The page's own limit is the box's plus 3 s; past it the box is torn down. */
  async run(code: string, timeoutMs = 5000): Promise<BoxResult> {
    const cold = !this.started
    const startMs = await this.start()
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
