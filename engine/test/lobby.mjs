// A client on a lobby's wire (#526), for checks: node-datachannel speaking the protocol a page speaks (page/door.ts,
// door.mjs), for steps that need no picture. It can say anything a hostile page could.
import { generateKeyPairSync, sign } from 'node:crypto'
import { PROTO, fingerprintOf, signed } from '../page/wire.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const { RTCPeerConnection } = await import('node-datachannel/polyfill')

/** The JSON frames of the kinds asked for in a stream's bytes. */
export function framesOf(bytes, kinds = [3, 5, 6, 11]) {
  const out = []
  for (let at = 0; bytes.length - at >= 12;) {
    const kind = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 8)
    if (bytes.length - at < 12 + size) break
    if (kinds.includes(kind)) { try { out.push({ kind, data: JSON.parse(bytes.subarray(at + 12, at + 12 + size).toString('utf8')) }) } catch { /* not JSON */ } }
    at += 12 + size
  }
  return out
}

/**
 * Joins a lobby as a page does: `master` (address), `lobby` (id or code), `pin` (the world's release). Answers {you,
 * name, fetch, ctl, close, gone, frames} once welcomed, or {why}. `hello` overrides fields of the hello; `stops` is
 * told how to close it.
 */
export async function wire(name, { master, lobby, pin, stops = [], keys = generateKeyPairSync('ec', { namedCurve: 'P-256' }), password, hello = {}, munge = (sdp) => sdp, silent = false } = {}) {
  const pc = new RTCPeerConnection({ iceServers: [] })
  const ch = { ctl: pc.createDataChannel('ctl'), down: pc.createDataChannel('down'), up: pc.createDataChannel('up') }
  await pc.setLocalDescription(await pc.createOffer())
  await wait(300)
  const r = await fetch(`${master}/lobbies/${lobby}/join`, { method: 'POST', body: JSON.stringify({ sdp: munge(pc.localDescription.sdp) }) })
  const v = await r.json()
  if (!r.ok) { pc.close(); return { why: v.why ?? String(r.status), status: r.status } }
  await pc.setRemoteDescription({ type: 'answer', sdp: v.sdp })
  const opened = await Promise.race([Promise.all(Object.values(ch).map((c) => (c.readyState === 'open' ? null : new Promise((done) => c.addEventListener('open', done, { once: true }))))).then(() => true), wait(10_000).then(() => false)])
  if (!opened) { pc.close(); return { why: 'no channel opened' } }
  // Joined and saying nothing: holding a place at the door.
  if (silent) { stops.push(() => pc.close()); return { pc } }
  const said = []
  const { promise: gone, resolve: went } = Promise.withResolvers()
  ch.ctl.addEventListener('message', (e) => { const m = JSON.parse(e.data); said.push(m); if (m.gone) went(m.gone.why) })
  // Who this client is: its key, and its signature over this connection's fingerprint, as a page says it (page/wire.ts).
  const key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const sig = sign('sha256', Buffer.from(signed(fingerprintOf(v.sdp))), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64')
  try { ch.ctl.send(JSON.stringify({ hello: { proto: PROTO, pin, name, key, sig, ...(password ? { password } : {}), ...hello } })) } catch { /* closed already */ }
  for (let i = 0; i < 100 && !said.length; i++) await wait(50)
  const first = said.shift()
  if (!first?.welcome) { pc.close(); return { why: first?.refuse?.why ?? 'no answer' } }
  let n = 0
  const replies = new Map()
  let current = null
  ch.up.addEventListener('message', (e) => {
    if (typeof e.data === 'string') { const h = JSON.parse(e.data), w = replies.get(h.n); if (!w) return; w.head = h; w.parts = []; current = h.n; if (!h.k) { replies.delete(h.n); w.done({ status: h.s, text: '' }) } return }
    const w = replies.get(current); if (!w) return
    w.parts.push(Buffer.from(e.data))
    if (w.parts.length === w.head.k) { replies.delete(current); w.done({ status: w.head.s, text: Buffer.concat(w.parts).toString('utf8') }) }
  })
  // What comes down a stream, as bytes in order (one stream at a time here).
  let down = Buffer.alloc(0)
  ch.down.addEventListener('message', (e) => { down = Buffer.concat([down, Buffer.from(e.data, 4)]) })
  const request = (path, { method = 'GET', body } = {}) => new Promise((done) => {
    const k = n++, bytes = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)), parts = Math.ceil(bytes.length / 16384)
    replies.set(k, { done })
    setTimeout(() => { if (replies.delete(k)) done({ status: 0, text: 'no reply' }) }, 30_000)
    ch.up.send(JSON.stringify({ n: k, m: method, p: path, k: parts }))
    for (let i = 0; i < parts; i++) ch.up.send(bytes.subarray(i * 16384, (i + 1) * 16384))
  })
  const ctl = (m) => new Promise((done) => { const k = 1e6 + n++; const on = (e) => { const r = JSON.parse(e.data); if (r.n === k) { ch.ctl.removeEventListener('message', on); done(r) } }; ch.ctl.addEventListener('message', on); ch.ctl.send(JSON.stringify({ n: k, ...m })) })
  const beat = setInterval(() => { try { ch.ctl.send(JSON.stringify({ ping: 1 })) } catch { clearInterval(beat) } }, 2000)
  const w = { ...first.welcome, pc, fetch: request, ctl, gone, frames: () => framesOf(down), close: () => { clearInterval(beat); pc.close() } }
  stops.push(w.close)
  return w
}
