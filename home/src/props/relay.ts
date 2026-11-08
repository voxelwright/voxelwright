// #42 prop sandbox: the relay document the sealed iframe loads. Its text and its
// policy live here; the dev server (vite.config.ts) serves them, the page only frames BOX_PATH.
// It is served from BOX_PATH with its own CSP, so the home's CSP needs no exception
// for it (a srcdoc frame would inherit the home's policy instead).

/** The most bytes (typed-array buffers plus bitmap pixels) one result may carry. Checked in the relay and again by the page. */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024

/** Where the dev server serves the relay document. */
export const BOX_PATH = '/prop-box.html'

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

/** The relay document's policy: nothing but its own nonced script and the blob worker it starts. */
export const boxPolicy = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; frame-ancestors 'self'`
/** The relay document, its script carrying this response's nonce. */
export const boxDocument = (nonce: string) => `<!doctype html><meta charset="utf-8"><script nonce="${nonce}">${RELAY}</script>`
