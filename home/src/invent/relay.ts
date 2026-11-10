// The mechanic sandbox's relay (#106): the document the sealed frame loads. Its text and its
// policy live here; the home's servers (vite.config.ts) serve them at BOX_PATH with this policy
// in place of the home's, so the home's own policy needs no exception for it. It is a separate
// document from the prop box's (src/props/relay.ts) because its policy also allows WebAssembly.
//
// The relay never runs mechanic code. It starts the worker from the script text the page hands
// it, passes the page's calls on, and passes back one answer per call, rebuilt field by field.
// A message it did not ask for, or one that is not shaped like an answer, ends the worker: the
// page hears `dead` once and nothing after.
import { sealedDocument, sealedPolicy } from '../sealed'
import { LIMITS } from './limits'

/** Where the home's servers serve the relay document. */
export const BOX_PATH = '/mechanic-box.html'

const RELAY = `
'use strict'
const ANSWER = ${LIMITS.answer}, REASON = ${LIMITS.reason}
let port = null, worker = null, owed = 0, dead = false
function die(reason) {
  if (dead) return
  dead = true
  if (worker) worker.terminate()
  port.postMessage({ type: 'dead', reason })
}
const text = (v, max) => typeof v === 'string' && v.length <= max
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
function answer(m) {
  if (dead) return
  if (!m || typeof m !== 'object') return die('the sandbox sent something that is not an answer')
  if (m.type === 'ready' && !owed) return port.postMessage({ type: 'ready' })
  if (owed < 1) return die('the sandbox spoke without being asked')
  owed--
  if (m.type === 'loaded' && text(m.hooks, 200)) return port.postMessage({ type: 'loaded', hooks: m.hooks })
  if (m.type === 'refused' && text(m.reason, REASON)) return port.postMessage({ type: 'refused', reason: m.reason })
  if (m.type === 'broken' && text(m.reason, REASON)) return die(m.reason)
  if (m.type === 'tock' && text(m.out, ANSWER)) return port.postMessage({ type: 'tock', out: m.out, asks: count(m.asks), ms: count(m.ms) })
  if (m.type === 'tock' && text(m.error, REASON)) return port.postMessage({ type: 'tock', error: m.error, asks: count(m.asks), ms: count(m.ms) })
  die('the sandbox sent something that is not an answer')
}
addEventListener('message', function init(e) {
  if (!e.data || e.data.type !== 'init' || typeof e.data.source !== 'string' || !e.ports[0]) return
  removeEventListener('message', init)
  port = e.ports[0]
  worker = new Worker(URL.createObjectURL(new Blob([e.data.source], { type: 'text/javascript' })))
  worker.onmessage = (m) => answer(m.data)
  worker.onerror = (m) => { m.preventDefault(); die('the sandbox crashed') }
  worker.onmessageerror = () => die('the sandbox sent something that could not be read')
  port.onmessage = (m) => {
    const d = m.data
    if (dead || !d || (d.type !== 'load' && d.type !== 'tick')) return
    owed++
    worker.postMessage(d, d.wasm instanceof ArrayBuffer ? [d.wasm] : [])
  }
})
`

/** The relay document's policy: the sealed frame's, with WebAssembly allowed in its worker (the interpreter). */
export const boxPolicy = (nonce: string) => sealedPolicy(nonce, " 'wasm-unsafe-eval'")
/** The relay document, its script carrying this response's nonce. */
export const boxDocument = (nonce: string) => sealedDocument(nonce, RELAY)
