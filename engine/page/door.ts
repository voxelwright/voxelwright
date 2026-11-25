// A page's way into a world it was not served by (#526): a dedicated server on someone's own machine, found through a
// master server (`?master=<address>&lobby=<id or code>`) and reached straight over WebRTC data channels. The door on
// the other end (engine/door.mjs, which says what goes over each channel) carries the world's HTTP over them; here it
// is a `fetch` that link.ts uses in place of the browser's.
//
// The host is a stranger. What comes through this door is data: replies and the world's stream, bounded in size,
// never code, markup or styles, never an address to send anything to. link.ts takes no plugin's page side through a
// door, and this page draws its own release's tiles (bay.ts), never a host's. Who this page is to a server is a key
// it keeps and never sends: it signs the one connection it is on, so no host can be it anywhere else.
import { where } from './bay.ts'
import { FRAME_MOST } from './link.ts'
import { CHUNK, CHUNK_LEAST, PROTO, fingerprintOf, gathered, signed } from './wire.ts'

export interface Door {
  /** Who this page is in that world (its `by`), as the server says: made there from this page's key. */
  readonly you: string
  /** The name others see over this page's person (the server makes two that look alike differ). */
  readonly name: string
  /** The release this page draws (the world must stand on it), or null for the generated town. */
  readonly pin: string | null
  /** What the server said of itself as it let this page in. Text someone typed: to be shown as text. */
  readonly server: { name: string; about: string; most: number; build: string; admins: boolean }
  /** A request to the world, as `fetch` makes one, through the door. A stream is a Response whose body comes as the world says it. */
  fetch(path: string, init?: RequestInit): Promise<Response>
  /** Whether this page may make a thing now, as the server says (only admins build there, or too many made this minute): why not, or null. Asked before any model is. */
  may(): Promise<string | null>
  /** The stream to the world broke and will not mend: the door is closed, and `ongone` told why. */
  lost(why: string): void
  /** The lobby from the console (`engine.lobby`): an admin's password, then what an admin may do. */
  readonly lobby: Lobby
  /** Told once when the door closes for good: the server is gone, or sent this page away. */
  ongone: ((why: string) => void) | null
  /** Told when the server says something to everyone. */
  ontold: ((text: string) => void) | null
}
export interface Lobby {
  readonly you: string
  readonly name: string
  readonly server: Door['server']
  /** Becomes an admin until this page leaves. */
  admin(password: string): Promise<Answer>
  who(): Promise<Answer>
  kick(you: string): Promise<Answer>
  /** By someone's id; with `address`, by the address they came from too. */
  ban(you: string, o?: { address?: boolean }): Promise<Answer>
  unban(you: string): Promise<Answer>
  bans(): Promise<Answer>
  /** Sets the server's password, or none with null. */
  lock(password: string | null): Promise<Answer>
  most(n: number): Promise<Answer>
  /** Who may build: everyone, or admins only (walking and talking stay everyone's). */
  build(who: 'everyone' | 'admins'): Promise<Answer>
  say(text: string): Promise<Answer>
  rename(name: string, about?: string): Promise<Answer>
  /** A request through the door, for the console and the checks: the same the page's own modules make. */
  fetch(path: string, init?: RequestInit): Promise<Response>
}
type Answer = { ok?: true; why?: string; [k: string]: unknown }

/** How long the page waits on the host: a channel to open, a hello's answer, a reply; and silence before the door is taken for gone. */
const OPEN_WAIT = 20_000, HELLO_WAIT = 10_000, REPLY_WAIT = 30_000, SILENT = 8_000

/** The key this browser keeps for servers (IndexedDB; its private half cannot be read out): who it is to them, across reloads and tabs. Where nothing can be kept, a new one each time. */
async function keyPair(): Promise<CryptoKeyPair> {
  const make = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  try {
    const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open('village-door', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
    const had = await new Promise<CryptoKeyPair | undefined>((ok, no) => { const r = db.transaction('keys').objectStore('keys').get('me'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
    if (had?.privateKey && had.publicKey) return had
    const pair = await make()
    await new Promise<void>((ok, no) => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(pair, 'me'); t.oncomplete = () => ok(); t.onerror = () => no(t.error) })
    return pair
  } catch { return make() }
}
const base64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))

/** Reads a small JSON answer of the master, at most a megabyte of it, or says why not in plain words. */
async function asked(r: Response): Promise<Record<string, unknown>> {
  const reader = r.body?.getReader(), parts: Uint8Array[] = []
  let size = 0
  for (;;) { const got = await reader?.read(); if (!got || got.done) break; size += got.value.length; if (size > 1 << 20) { void reader!.cancel(); throw new Error('the master said too much') } parts.push(got.value) }
  let v: unknown = null
  try { v = JSON.parse(await new Blob(parts as BlobPart[]).text()) } catch { /* said below */ }
  if (!v || typeof v !== 'object') throw new Error(`the master did not answer (${r.status})`)
  return v as Record<string, unknown>
}
const why = (v: Record<string, unknown>, fallback: string) => (typeof v.why === 'string' ? v.why.slice(0, 200) : fallback)

/** A plain notice of what the door did (a join that failed, a server gone), as text; null takes it away. */
export function notice(words: string | null): void {
  const say = document.getElementById('door-notice') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'door-notice' }))
  say.style.cssText = 'position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:12px;font:500 18px/1.4 system-ui,sans-serif;color:#e8ecf1;background:#10141acc;border-radius:8px;z-index:99;text-align:center;pointer-events:none'
  say.textContent = words ?? ''
  say.hidden = !words
}

/**
 * Joins the lobby: asks the master for it and for the ICE servers, sends this page's whole offer, opens the channels
 * and says hello. Resolves with the door once the server has let this page in; rejects with why it did not, in plain
 * words. A server that asks for a password asks for it in the browser's own prompt: it is never put in an address.
 */
export async function enter(o: { master: string; lobby: string; name: string | null }): Promise<Door> {
  const master = URL.parse(o.master)
  if (!master || !['http:', 'https:'].includes(master.protocol) || master.username || master.password) throw new Error('Could not join: ?master= is the address of a master server')
  const base = master.href.replace(/\/$/, '')
  const id = encodeURIComponent(o.lobby)
  const pin = (await where()).release
  const record = await fetch(`${base}/lobbies/${id}`, { credentials: 'omit' }).then(asked).catch((e: Error) => { throw new Error(e instanceof TypeError ? 'Could not join: the master did not answer' : `Could not join: ${e.message}`) })
  if (typeof record.pin !== 'string') throw new Error(`Could not join: ${why(record, 'no server of that lobby is listed')}`)
  if (record.pin !== (pin ?? 'town')) throw new Error(`That server holds ${record.pin === 'town' ? 'the generated town' : `San Francisco release ${record.pin.slice(0, 12)}`}, and this page draws ${pin ? `release ${pin.slice(0, 12)}` : 'the town'}: it has not joined.`)
  const ice = await fetch(`${base}/ice`, { credentials: 'omit' }).then(asked).catch(() => ({ iceServers: [] }))
  const iceServers = Array.isArray(ice.iceServers) ? (ice.iceServers as RTCIceServer[]).filter((s) => [].concat(s.urls as never).every((u: string) => typeof u === 'string' && /^(stun|stuns|turn|turns):/.test(u))) : []
  const keys = await keyPair()
  let password: string | undefined
  // A locked server is asked again with a password once one is given.
  for (;;) {
    const tried = await knock({ base, id, iceServers, pin, name: o.name, keys, password })
    if ('door' in tried) return tried.door
    if (!tried.refused) throw new Error(`Could not join: ${tried.why}`)
    if (tried.why !== 'this server asks for a password' && tried.why !== 'wrong password') throw new Error(`The server did not let this page in: ${tried.why}`)
    const given = prompt(tried.why === 'wrong password' ? 'That password was wrong. The server’s password:' : 'This server asks for a password:')
    if (!given) throw new Error('This server asks for a password, and none was given.')
    password = given
  }
}

/** One try at the server's door: a peer connection through the master, then hello. `refused` when the server itself said no. */
async function knock(o: { base: string; id: string; iceServers: RTCIceServer[]; pin: string | null; name: string | null; keys: CryptoKeyPair; password?: string }): Promise<{ door: Door } | { why: string; refused: boolean }> {
  const pc = new RTCPeerConnection({ iceServers: o.iceServers })
  const ch = { ctl: pc.createDataChannel('ctl'), down: pc.createDataChannel('down'), up: pc.createDataChannel('up') }
  for (const c of Object.values(ch)) c.binaryType = 'arraybuffer'
  const fail = (why: string, refused = false) => { pc.close(); return { why, refused } }
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc, o.iceServers.length > 0)
  // No preflight: the master reads the body as JSON whatever its type.
  const r = await fetch(`${o.base}/lobbies/${o.id}/join`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ sdp: pc.localDescription!.sdp }) }).catch(() => null)
  if (!r) return fail('the master did not answer')
  const v: Record<string, unknown> = await asked(r).catch((e: Error) => ({ why: e.message }))
  if (r.status === 404) return fail('that server is gone')
  if (r.status === 409) return fail(why(v, 'the server refused'), true)
  if (!r.ok || typeof v.sdp !== 'string') return fail(why(v, `the master said ${r.status}`))
  const fingerprint = fingerprintOf(v.sdp)
  if (!fingerprint) return fail('the server\'s answer has no fingerprint')
  await pc.setRemoteDescription({ type: 'answer', sdp: v.sdp })
  const open = (c: RTCDataChannel) => new Promise<void>((done, no) => { if (c.readyState === 'open') done(); c.addEventListener('open', () => done(), { once: true }); c.addEventListener('close', () => no(new Error('closed')), { once: true }) })
  const opened = await Promise.race([Promise.all(Object.values(ch).map(open)).then(() => true, () => false), new Promise<boolean>((done) => setTimeout(() => done(false), OPEN_WAIT))])
  if (!opened) return fail('no line to the server opened: it may be behind a network that lets nobody in')
  if (!((pc.sctp?.maxMessageSize ?? 0) >= CHUNK_LEAST)) return fail('the server\'s channels take messages too small for this page')
  // Who this page is: its key, and its signature over this connection's fingerprint alone.
  const key = base64(await crypto.subtle.exportKey('spki', o.keys.publicKey))
  const sig = base64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, o.keys.privateKey, new TextEncoder().encode(signed(fingerprint))))
  const said = await new Promise<Record<string, unknown> | null>((done) => {
    const t = setTimeout(() => done(null), HELLO_WAIT)
    ch.ctl.addEventListener('message', (e) => { clearTimeout(t); try { done(JSON.parse(String(e.data).slice(0, 4096))) } catch { done(null) } }, { once: true })
    ch.ctl.send(JSON.stringify({ hello: { proto: PROTO, pin: o.pin ?? 'town', name: o.name, key, sig, ...(o.password ? { password: o.password } : {}) } }))
  })
  const w = said?.welcome as Record<string, unknown> | undefined
  const refusal = (said?.refuse as { why?: unknown } | undefined)?.why
  if (!w || typeof w.you !== 'string' || !/^[a-z0-9]{1,24}$/.test(w.you)) return typeof refusal === 'string' ? fail(refusal.slice(0, 200), true) : fail('the server did not answer the hello')
  return { door: admitted(pc, ch, w, o.pin) }
}

/** The door of a connection the server has let in. */
function admitted(pc: RTCPeerConnection, ch: { ctl: RTCDataChannel; down: RTCDataChannel; up: RTCDataChannel }, w: Record<string, unknown>, pin: string | null): Door {
  const s = (w.server ?? {}) as Record<string, unknown>
  const server = { name: String(s.name ?? '').slice(0, 48), about: String(s.about ?? '').slice(0, 200), most: Number(s.most) || 0, build: s.build === 'admins' ? 'admins' : 'everyone', admins: s.admins === true }
  const you = w.you as string, name = String(w.name ?? '').slice(0, 30)
  const chunk = Math.min(CHUNK, pc.sctp?.maxMessageSize ?? CHUNK)
  let n = 0, gone = false, heard = Date.now()
  /** Replies awaited, by request: their head once it comes and the parts so far. */
  const waiting = new Map<number, { done(r: Response): void; no(e: Error): void; head?: { s: number; t: string; k: number }; parts: ArrayBuffer[]; size: number; timer: ReturnType<typeof setTimeout> }>()
  /** Streams open, by request: where their bytes go. */
  const streams = new Map<number, ReadableStreamDefaultController<Uint8Array>>()
  const asking = new Map<number, (v: Answer) => void>()
  let current: number | null = null
  const send = (c: RTCDataChannel, m: unknown) => { try { c.send(JSON.stringify(m)) } catch { /* closing */ } }
  const fetch = async (path: string, init?: RequestInit): Promise<Response> => {
    if (gone) throw new TypeError('the server is gone')
    const body = new Uint8Array(await new Response(init?.body).arrayBuffer())
    const m = (init?.method ?? 'GET').toUpperCase(), k = n++
    return new Promise<Response>((done, no) => {
      const timer = setTimeout(() => { if (waiting.delete(k)) no(new TypeError('the server did not answer')) }, REPLY_WAIT)
      waiting.set(k, { done, no, parts: [], size: 0, timer })
      init?.signal?.addEventListener('abort', () => { if (waiting.delete(k)) { clearTimeout(timer); no(new DOMException('aborted', 'AbortError')) } const c = streams.get(k); if (c) { streams.delete(k); send(ch.ctl, { unstream: k }); try { c.error(new DOMException('aborted', 'AbortError')) } catch { /* closed */ } } })
      const parts = Math.ceil(body.length / chunk)
      try {
        // The head and every part in one go: the door takes a request's parts as the messages that follow its head.
        ch.up.send(JSON.stringify({ n: k, m, p: path, k: parts }))
        for (let i = 0; i < parts; i++) ch.up.send(body.subarray(i * chunk, (i + 1) * chunk))
      } catch { waiting.delete(k); clearTimeout(timer); no(new TypeError('the server is gone')) }
    })
  }
  const ask = (m: Record<string, unknown>) => new Promise<Answer>((done) => { const k = n++; asking.set(k, done); send(ch.ctl, { n: k, ...m }); setTimeout(() => { if (asking.delete(k)) done({ why: 'the server did not answer' }) }, REPLY_WAIT) })
  const op = (lobby: Record<string, unknown>) => ask({ lobby })
  const lobby: Lobby = {
    you, name, server,
    admin: (password) => ask({ admin: password }),
    who: () => op({ op: 'who' }), kick: (you) => op({ op: 'kick', you }), ban: (you, b) => op({ op: 'ban', you, address: !!b?.address }), unban: (you) => op({ op: 'unban', you }), bans: () => op({ op: 'bans' }),
    lock: (password) => op({ op: 'password', password }), most: (most) => op({ op: 'most', most }), build: (who) => op({ op: 'build', who }), say: (text) => op({ op: 'say', text }), rename: (name, about) => op({ op: 'rename', name, about }),
    fetch,
  }
  const end = (why: string) => {
    if (gone) return
    gone = true
    clearInterval(beat)
    for (const [, w] of waiting) { clearTimeout(w.timer); w.no(new TypeError(why)) }
    waiting.clear()
    for (const [, c] of streams) { try { c.error(new TypeError(why)) } catch { /* closed */ } }
    streams.clear()
    for (const [, a] of asking) a({ why })
    asking.clear()
    try { pc.close() } catch { /* already */ }
    self.ongone?.(why)
  }
  // Not known is not allowed: a page that cannot ask makes nothing.
  const may = async () => { const a = await ask({ may: 'make' }); return a.ok === true ? null : String(a.why ?? 'the server did not say').slice(0, 200) }
  const self: Door = { you, name, pin, server, fetch, may, lobby, ongone: null, ontold: null, lost: (why) => end(`The world's stream broke: ${why}`) }
  // A ping every two seconds; nothing back for eight and the server is taken for gone (a killed host says nothing).
  const beat = setInterval(() => { if (Date.now() - heard > SILENT) return end('The server is gone: nothing has been heard from it for a while.'); send(ch.ctl, { ping: Date.now() }) }, 2000)
  ch.ctl.addEventListener('message', (e) => {
    heard = Date.now()
    if (typeof e.data !== 'string' || e.data.length > 1 << 20) return
    let m: Record<string, unknown>
    try { m = JSON.parse(e.data) } catch { return }
    if (!m || typeof m !== 'object') return
    if (m.gone) return end(`The server sent this page away: ${String((m.gone as { why?: unknown }).why ?? '').slice(0, 200)}`)
    if (m.told) return self.ontold?.(String((m.told as { text?: unknown }).text ?? '').slice(0, 200))
    if (m.end) { const k = Number((m.end as { n?: unknown }).n), c = streams.get(k); if (c) { streams.delete(k); try { c.error(new TypeError(String((m.end as { why?: unknown }).why ?? 'the world hung up').slice(0, 200))) } catch { /* closed */ } } return }
    if (Number.isInteger(m.n) && asking.has(m.n as number)) { const a = asking.get(m.n as number)!; asking.delete(m.n as number); a(m as Answer) }
  })
  ch.up.addEventListener('message', (e) => {
    heard = Date.now()
    if (typeof e.data === 'string') {
      let h: { n?: unknown; s?: unknown; t?: unknown; k?: unknown; stream?: unknown }
      try { h = JSON.parse(e.data.slice(0, 4096)) } catch { return end('The server said something this page does not read.') }
      const k = Number(h.n), w = waiting.get(k)
      if (!w) { current = null; return }
      const status = Number(h.s)
      if (!(status >= 200 && status <= 599)) { waiting.delete(k); clearTimeout(w.timer); return w.no(new TypeError('the server said something this page does not read')) }
      if (h.stream === true && status === 200) {
        waiting.delete(k); clearTimeout(w.timer)
        return w.done(new Response(new ReadableStream<Uint8Array>({ start: (c) => { streams.set(k, c) }, cancel: () => { streams.delete(k); send(ch.ctl, { unstream: k }) } }), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }))
      }
      const parts = Number(h.k)
      if (!(Number.isInteger(parts) && parts >= 0 && parts <= FRAME_MOST / 1024)) return end('The server sent a reply too big for this page.')
      // Only a type of data: whatever the host says, a reply is never markup to this page.
      w.head = { s: status, t: /^application\/(json|octet-stream)\b/.test(String(h.t)) ? String(h.t).split(';')[0] : 'text/plain', k: parts }
      current = k
      if (!parts) finish(k)
      return
    }
    // A part of the reply under way.
    const w = current === null ? null : waiting.get(current)
    if (!w?.head) return
    const part = e.data as ArrayBuffer
    w.size += part.byteLength
    if (w.size > FRAME_MOST) return end('The server sent a reply too big for this page.')
    w.parts.push(part)
    if (w.parts.length === w.head.k) finish(current!)
  })
  const finish = (k: number) => {
    const w = waiting.get(k)!
    waiting.delete(k); clearTimeout(w.timer); current = null
    w.done(new Response(w.head!.s === 204 || w.head!.s === 304 ? null : new Blob(w.parts), { status: w.head!.s, headers: { 'Content-Type': w.head!.t } }))
  }
  ch.down.addEventListener('message', (e) => {
    heard = Date.now()
    const b = e.data as ArrayBuffer
    if (!(b instanceof ArrayBuffer) || b.byteLength < 4) return
    const c = streams.get(new DataView(b).getUint32(0, true))
    try { c?.enqueue(new Uint8Array(b, 4)) } catch { /* closed */ }
  })
  for (const c of Object.values(ch)) c.addEventListener('close', () => end('The server is gone: the line to it closed.'))
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end('The server is gone: the line to it broke.') })
  return self
}
