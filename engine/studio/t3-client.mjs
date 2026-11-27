// Native T3 Code protocol client & multi-environment connection manager (#98).
// Implements T3 Code's actual wire contracts from pingdotgg/t3code:
// - Discovery of local running T3 Code server (~/.t3/userdata/server-runtime.json)
// - Environment descriptor probe (GET /.well-known/t3/environment)
// - RFC 9449 DPoP & Bearer token exchange (POST /oauth/token) + automatic in-place renewal
// - Short-lived WebSocket tickets (POST /api/auth/websocket-ticket/rpc)
// - Effect RPC over WebSocket (/ws?orchestrationProtocol=2&frameParts=1) with chunked frame reassembly,
//   stream backpressure Ack, Ping/Pong heartbeat, and exponential-backoff reconnect supervisor
// - Full EnvironmentHttpApi helpers: shell/thread snapshots, history pages, PR diff, attachments upload,
//   CORP-safe asset fetching, and voice transcription (/api/voice/transcribe & cloud transcribe)
// - OrchestrationMessageContext builder supporting T3's UnknownContextRecord (`game-*`) envelopes
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDpopProof, generateDpopKeyPair, importDpopKeyPair } from './dpop.mjs'

export const ORCHESTRATION_PROTOCOL_VERSION = '2'
export const ORCHESTRATION_PROTOCOL_HEADER = 'x-t3-orchestration-protocol'
export const SOCKET_FRAME_PART_PREFIX = '\u001e'
export const AUTH_TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const AUTH_ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
export const AUTH_BOOTSTRAP_TOKEN_TYPE = 'urn:t3:params:oauth:token-type:environment-bootstrap'

export const DEFAULT_STUDIO_DIR = join(homedir(), '.village', 'engine', 'studio')
export const DEFAULT_T3_STATE_DIR = join(homedir(), '.t3', 'userdata')

/** Standard scopes requested when pairing an in-game Studio client with T3 Code. */
export const STUDIO_DEFAULT_SCOPES = [
  'orchestration:read',
  'orchestration:operate',
  'settings:write',
  'providers:manage',
  'environment:maintain',
  'preview:operate',
  'diagnostics:read',
  'terminal:read',
  'terminal:operate',
  'source-control:write',
  'filesystem:read',
  'filesystem:write',
  'relay:read',
  'access:read',
  'access:write',
  'relay:write',
]

function normalizeHttpBase(raw) {
  const u = new URL(String(raw).trim())
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Unsupported protocol: ${u.protocol}`)
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

function deriveWsBase(httpBase) {
  const u = new URL(httpBase)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/** Parses a T3 pairing URL (`https://host/pair?host=...#token=...` or `http://127.0.0.1:3773#token=...`) or host + code. */
export function parsePairingInput({ pairingUrl, host, pairingCode }) {
  if (pairingUrl) {
    const u = new URL(pairingUrl.trim())
    const hashParams = new URLSearchParams(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash)
    const targetHost = u.searchParams.get('host')?.trim() || u.origin
    const token =
      hashParams.get('token')?.trim() ||
      hashParams.get('pairingToken')?.trim() ||
      u.searchParams.get('token')?.trim() ||
      pairingCode?.trim() ||
      ''
    const label = u.searchParams.get('label')?.trim() || ''
    if (!token) throw new Error('Pairing URL did not contain a pairing token.')
    return { httpBaseUrl: normalizeHttpBase(targetHost), pairingCode: token, label }
  }
  if (!host || !pairingCode) throw new Error('Provide either pairingUrl or both host and pairingCode.')
  return { httpBaseUrl: normalizeHttpBase(host), pairingCode: pairingCode.trim(), label: '' }
}

/** Builds a T3 Code `OrchestrationMessageContext` with custom `game-*` UnknownContextRecords + image/file chips. */
export function buildGameMessageContext({ text, records = [] }) {
  const cleanRecords = []
  const refs = []
  const seenIds = new Set()
  for (let i = 0; i < records.length && cleanRecords.length < 200; i++) {
    const r = records[i]
    if (!r || typeof r !== 'object') continue
    const kind = String(r.kind ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(kind)) continue
    let contextId = String(r.contextId ?? `ctx_${i + 1}_${randomUUID().slice(0, 8)}`).replace(/[^a-z0-9_-]/gi, '_').slice(0, 128)
    while (seenIds.has(contextId)) contextId = `${contextId}_x`
    seenIds.add(contextId)
    const label = String(r.label ?? kind).slice(0, 200)
    const known = ['image', 'file', 'terminal', 'element', 'preview-annotation', 'review-comment', 'mention', 'skill', 'thread', 'environment', 'response'].includes(kind)
    let entry
    if (known) {
      entry = { version: 1, contextId, label, ...r, kind }
    } else {
      let payload = r.payload ?? {}
      const encoded = JSON.stringify(payload)
      if (encoded.length > 62_000) {
        payload = { truncated: true, preview: encoded.slice(0, 60_000) }
      }
      entry = { version: 1, contextId, label, kind, payload }
    }
    cleanRecords.push(entry)
    const safeLabel = label.replace(/[\[\]]/g, '')
    refs.push(`[${safeLabel}](t3-context://v1/${kind}/${contextId})`)
  }
  const baseText = String(text ?? '').trim()
  const finalText = refs.length ? `${baseText}${baseText ? '\n\n' : ''}${refs.join(' ')}` : baseText
  return {
    text: finalText,
    context: cleanRecords.length ? { version: 1, records: cleanRecords } : undefined,
  }
}

/** Inspects ~/.t3/userdata/server-runtime.json to find a locally running T3 Code server. */
export async function discoverLocalT3Server(stateDir = DEFAULT_T3_STATE_DIR) {
  const runtimePath = join(stateDir, 'server-runtime.json')
  if (!existsSync(runtimePath)) return null
  let raw
  try { raw = JSON.parse(await readFile(runtimePath, 'utf8')) } catch { return null }
  if (!raw || typeof raw.origin !== 'string' || !Number.isInteger(raw.pid)) return null
  try { process.kill(raw.pid, 0) } catch (e) { if (e?.code !== 'EPERM') return null }
  try {
    const res = await fetch(`${raw.origin.replace(/\/$/, '')}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const descriptor = await res.json()
    return {
      origin: raw.origin.replace(/\/$/, ''),
      pid: raw.pid,
      port: raw.port,
      serverVersion: raw.serverVersion ?? descriptor.serverVersion ?? null,
      descriptor,
    }
  } catch {
    return null
  }
}

/** Uses the local owner's installed `t3` CLI to mint a one-time pairing credential for local Studio auto-connect. */
export function mintLocalPairingViaCli({ t3Bin = join(homedir(), '.t3', 'bin', 't3'), label = 'Voxelwright Studio' } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      t3Bin,
      ['auth', 'pairing', 'create', '--json', '--label', label],
      { timeout: 15_000, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).slice(0, 300)))
        try {
          const parsed = JSON.parse(stdout)
          const code = parsed.credential ?? parsed.token ?? parsed.pairingCode ?? parsed.code
          const url = parsed.url ?? parsed.pairingUrl ?? null
          if (!code && !url) return reject(new Error('t3 auth pairing create returned no credential'))
          resolve({ pairingCode: code, pairingUrl: url, raw: parsed })
        } catch {
          const m = /([A-Za-z0-9_-]{20,})/.exec(stdout)
          if (m) resolve({ pairingCode: m[1], pairingUrl: null, raw: stdout.trim() })
          else reject(new Error(`Could not parse t3 auth pairing output: ${stdout.slice(0, 160)}`))
        }
      },
    )
  })
}

/**
 * One live connection to a single T3 Code environment server.
 * Owns DPoP/Bearer credentials, HTTP API calls, Effect-RPC WebSocket framing, stream subscriptions,
 * backpressure Acks, heartbeats, and jittered exponential-backoff reconnection.
 */
export class T3EnvironmentClient {
  #envId
  #label
  #httpBaseUrl
  #wsBaseUrl
  #tokenType // 'DPoP' | 'Bearer'
  #accessToken
  #expiresAtMs
  #scopes
  #dpopKeyPair = null
  #descriptor = null
  #serverConfig = null
  #ws = null
  #state = 'disconnected' // disconnected | connecting | connected | blocked | error
  #lastError = null
  #nextReqId = 1
  #pending = new Map() // reqId -> { resolve, reject, onChunk, onEnd, stream, method, payload }
  #activeSubs = new Map() // subKey -> { method, payload, listeners: Set<fn>, reqId }
  #listeners = new Set()
  #reconnectTimer = null
  #pingTimer = null
  #renewTimer = null
  #reconnectAttempt = 0
  #disposed = false
  #framePartBuf = ''
  #inboundFrames = 0
  #onCredentialUpdate

  constructor({
    environmentId,
    label,
    httpBaseUrl,
    wsBaseUrl,
    tokenType = 'Bearer',
    accessToken,
    expiresAtMs = Date.now() + 24 * 3600_000,
    scopes = [],
    dpopKeyPair = null,
    descriptor = null,
    onCredentialUpdate = () => {},
  }) {
    this.#envId = environmentId
    this.#label = label || httpBaseUrl
    this.#httpBaseUrl = normalizeHttpBase(httpBaseUrl)
    this.#wsBaseUrl = wsBaseUrl ? wsBaseUrl.replace(/\/+$/, '') : deriveWsBase(this.#httpBaseUrl)
    this.#tokenType = tokenType
    this.#accessToken = accessToken
    this.#expiresAtMs = expiresAtMs
    this.#scopes = [...scopes]
    this.#dpopKeyPair = dpopKeyPair
    this.#descriptor = descriptor
    this.#onCredentialUpdate = onCredentialUpdate
  }

  get environmentId() { return this.#envId }
  get label() { return this.#label }
  get httpBaseUrl() { return this.#httpBaseUrl }
  get state() { return this.#state }
  get serverConfig() { return this.#serverConfig }
  get descriptor() { return this.#descriptor }

  summary() {
    return {
      environmentId: this.#envId,
      label: this.#label,
      httpBaseUrl: this.#httpBaseUrl,
      tokenType: this.#tokenType,
      scopes: this.#scopes,
      state: this.#state,
      lastError: this.#lastError,
      serverVersion: this.#descriptor?.serverVersion ?? this.#serverConfig?.environment?.serverVersion ?? null,
      capabilities: this.#descriptor?.capabilities ?? this.#serverConfig?.environment?.capabilities ?? {},
      expiresAt: new Date(this.#expiresAtMs).toISOString(),
      inboundFrames: this.#inboundFrames,
    }
  }

  serialize() {
    return {
      environmentId: this.#envId,
      label: this.#label,
      httpBaseUrl: this.#httpBaseUrl,
      wsBaseUrl: this.#wsBaseUrl,
      tokenType: this.#tokenType,
      accessToken: this.#accessToken,
      expiresAtMs: this.#expiresAtMs,
      scopes: this.#scopes,
      dpopPrivateJwk: this.#dpopKeyPair?.privateJwk ?? null,
      descriptor: this.#descriptor,
    }
  }

  onEvent(fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #emit(event) {
    for (const fn of this.#listeners) {
      try { fn({ environmentId: this.#envId, ...event }) } catch { /* listener error isolated */ }
    }
  }

  #setState(state, lastError = null) {
    this.#state = state
    this.#lastError = lastError
    this.#emit({ type: 'connection.state', state, lastError, summary: this.summary() })
  }

  async #authHeaders(method, url, extra = {}) {
    const headers = { ...extra }
    if (this.#accessToken) {
      if (this.#tokenType === 'DPoP' && this.#dpopKeyPair) {
        headers.authorization = `DPoP ${this.#accessToken}`
        headers.dpop = await createDpopProof(this.#dpopKeyPair, {
          method,
          url,
          accessToken: this.#accessToken,
        })
      } else {
        headers.authorization = `Bearer ${this.#accessToken}`
      }
    }
    return headers
  }

  async httpJson(method, path, { body, headers = {}, timeoutMs = 15_000, orchestration = false } = {}) {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${this.#httpBaseUrl}${path}`
    const extra = { ...headers }
    if (orchestration) extra[ORCHESTRATION_PROTOCOL_HEADER] = ORCHESTRATION_PROTOCOL_VERSION
    let reqBody
    if (body !== undefined) {
      if (body instanceof URLSearchParams) {
        extra['content-type'] = 'application/x-www-form-urlencoded'
        reqBody = body.toString()
      } else if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
        reqBody = body
      } else {
        extra['content-type'] = 'application/json'
        reqBody = JSON.stringify(body)
      }
    }
    const authHeaders = await this.#authHeaders(method, url, extra)
    const res = await fetch(url, {
      method,
      headers: authHeaders,
      body: reqBody,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let parsed = null
    if (text) {
      try { parsed = JSON.parse(text) } catch { parsed = text }
    }
    if (!res.ok) {
      const msg = typeof parsed === 'object' && parsed?.message ? parsed.message : `HTTP ${res.status} on ${path}`
      throw Object.assign(new Error(msg), { status: res.status, body: parsed })
    }
    return parsed
  }

  async httpRaw(method, path, { body, headers = {}, timeoutMs = 30_000 } = {}) {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${this.#httpBaseUrl}${path}`
    const authHeaders = await this.#authHeaders(method, url, headers)
    return fetch(url, {
      method,
      headers: authHeaders,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  /** Renews a DPoP-bound access token in place per T3 Code's /oauth/token contract. */
  async renewAccessToken() {
    if (this.#tokenType !== 'DPoP' || !this.#dpopKeyPair || !this.#accessToken) return false
    const url = `${this.#httpBaseUrl}/oauth/token`
    const form = new URLSearchParams({
      grant_type: AUTH_TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: this.#accessToken,
      subject_token_type: AUTH_ACCESS_TOKEN_TYPE,
      requested_token_type: AUTH_ACCESS_TOKEN_TYPE,
    })
    const proof = await createDpopProof(this.#dpopKeyPair, { method: 'POST', url })
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', dpop: proof },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return false
    const tok = await res.json()
    if (tok?.access_token) {
      this.#accessToken = tok.access_token
      this.#expiresAtMs = Date.now() + Number(tok.expires_in ?? 3600) * 1000
      this.#onCredentialUpdate(this.serialize())
      this.#scheduleRenewal()
      return true
    }
    return false
  }

  #scheduleRenewal() {
    if (this.#renewTimer) { clearTimeout(this.#renewTimer); this.#renewTimer = null }
    if (this.#disposed || this.#tokenType !== 'DPoP' || !this.#dpopKeyPair) return
    const delay = Math.max(30_000, this.#expiresAtMs - Date.now() - 5 * 60_000)
    this.#renewTimer = setTimeout(() => { void this.renewAccessToken().catch(() => {}) }, Math.min(delay, 12 * 3600_000))
    this.#renewTimer.unref?.()
  }

  /** Mints a short-lived WS ticket and constructs the full /ws upgrade URL. */
  async #resolveWebSocketUrl() {
    let ticketRes
    try {
      ticketRes = await this.httpJson('POST', '/api/auth/websocket-ticket/rpc')
    } catch (e) {
      if (e?.status === 404) {
        ticketRes = await this.httpJson('POST', '/api/auth/websocket-ticket')
      } else {
        throw e
      }
    }
    const ticket = typeof ticketRes === 'string' ? ticketRes : ticketRes?.ticket
    if (!ticket) throw new Error('Server did not return a WebSocket ticket.')
    const wsUrl = new URL(`${this.#wsBaseUrl}/ws`)
    wsUrl.searchParams.set('orchestrationProtocol', ORCHESTRATION_PROTOCOL_VERSION)
    wsUrl.searchParams.set('frameParts', '1')
    wsUrl.searchParams.set('wsTicket', ticket)
    wsUrl.searchParams.set('clientSurface', 'web')
    wsUrl.searchParams.set('clientDeviceType', 'desktop')
    wsUrl.searchParams.set('clientAppVersion', 'voxelwright-studio-1')
    if (this.#tokenType === 'DPoP' && this.#dpopKeyPair) {
      const proof = await createDpopProof(this.#dpopKeyPair, {
        method: 'GET',
        url: `${this.#httpBaseUrl}/ws`,
        accessToken: ticket,
      })
      wsUrl.searchParams.set('dpop', proof)
    }
    return wsUrl.toString()
  }

  async connect() {
    if (this.#disposed) return
    if (this.#state === 'connecting' || this.#state === 'connected') return
    if (this.#reconnectTimer) { clearTimeout(this.#reconnectTimer); this.#reconnectTimer = null }
    this.#setState('connecting', null)
    try {
      // Refresh descriptor before opening WS so capability flags are current.
      try {
        this.#descriptor = await this.httpJson('GET', '/.well-known/t3/environment', { timeoutMs: 6000 })
        if (this.#descriptor?.environmentId && !this.#envId) this.#envId = this.#descriptor.environmentId
        if (this.#descriptor?.label && this.#label === this.#httpBaseUrl) this.#label = this.#descriptor.label
      } catch { /* older/mock servers may omit descriptor */ }

      const wsUrl = await this.#resolveWebSocketUrl()
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        let settled = false
        const timer = setTimeout(() => {
          if (!settled) { settled = true; try { ws.close() } catch { /* ignore */ }; reject(new Error('WebSocket open timeout')) }
        }, 15_000)

        ws.addEventListener('open', () => {
          clearTimeout(timer)
          this.#ws = ws
          this.#framePartBuf = ''
          this.#reconnectAttempt = 0
          this.#startHeartbeat()
          this.#scheduleRenewal()
          this.#setState('connected', null)
          this.#resubscribeAll()
          if (!settled) { settled = true; resolve() }
        })

        ws.addEventListener('message', (ev) => {
          this.#inboundFrames++
          this.#handleSocketFrame(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
        })

        ws.addEventListener('error', () => {
          if (!settled) {
            clearTimeout(timer)
            settled = true
            reject(new Error(`WebSocket failed to connect to ${this.#label}`))
          }
        })

        ws.addEventListener('close', (ev) => {
          clearTimeout(timer)
          if (this.#ws === ws) this.#ws = null
          this.#stopHeartbeat()
          this.#failInFlight(`WebSocket closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ''})`)
          if (!settled) {
            settled = true
            reject(new Error(`WebSocket closed during handshake (${ev.code})`))
          } else if (!this.#disposed) {
            this.#setState('disconnected', ev.reason || `Closed (${ev.code})`)
            this.#scheduleReconnect()
          }
        })
      })

      // Subscribe server config automatically (mirrors packages/client-runtime/src/rpc/session.ts)
      this.subscribe('subscribeServerConfig', { workspaceSnapshotsOnDemand: true }, (event) => {
        if (event?.type === 'snapshot' && event.config) {
          this.#serverConfig = event.config
          this.#emit({ type: 'server.config', config: event.config })
        } else if (event) {
          this.#emit({ type: 'server.config.event', event })
        }
      })
    } catch (err) {
      const authBlocked = err?.status === 401 || err?.status === 403
      this.#setState(authBlocked ? 'blocked' : 'error', err?.message ?? String(err))
      if (!authBlocked && !this.#disposed) this.#scheduleReconnect()
      throw err
    }
  }

  #startHeartbeat() {
    this.#stopHeartbeat()
    this.#pingTimer = setInterval(() => {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#sendRaw({ _tag: 'Ping' })
      }
    }, 10_000)
    this.#pingTimer.unref?.()
  }

  #stopHeartbeat() {
    if (this.#pingTimer) { clearInterval(this.#pingTimer); this.#pingTimer = null }
  }

  #scheduleReconnect() {
    if (this.#disposed || this.#reconnectTimer) return
    const attempt = Math.min(this.#reconnectAttempt++, 6)
    const base = Math.min(30_000, 750 * 2 ** attempt)
    const jitter = Math.round(base * (0.75 + Math.random() * 0.5))
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      void this.connect().catch(() => {})
    }, jitter)
    this.#reconnectTimer.unref?.()
  }

  #sendRaw(msg) {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false
    this.#ws.send(JSON.stringify(msg))
    return true
  }

  #handleSocketFrame(raw) {
    if (raw.startsWith(SOCKET_FRAME_PART_PREFIX)) {
      this.#framePartBuf += raw.slice(SOCKET_FRAME_PART_PREFIX.length)
      return
    }
    const whole = this.#framePartBuf ? this.#framePartBuf + raw : raw
    this.#framePartBuf = ''
    let msg
    try { msg = JSON.parse(whole) } catch { return }
    const frames = Array.isArray(msg) ? msg : [msg]
    for (const frame of frames) this.#dispatchRpcFrame(frame)
  }

  #dispatchRpcFrame(frame) {
    if (!frame || typeof frame !== 'object') return
    if (frame._tag === 'Pong' || frame._tag === 'Ping') {
      if (frame._tag === 'Ping') this.#sendRaw({ _tag: 'Pong' })
      return
    }
    const id = String(frame.requestId ?? frame.id ?? '')
    const entry = this.#pending.get(id)
    if (!entry) return

    if (frame._tag === 'Chunk') {
      const values = Array.isArray(frame.values) ? frame.values : []
      for (const v of values) {
        try { entry.onChunk?.(v) } catch { /* isolate subscriber error */ }
      }
      // Send backpressure Ack so Effect RpcServer keeps pushing stream items.
      this.#sendRaw({ _tag: 'Ack', requestId: entry.wireId })
      return
    }

    if (frame._tag === 'Exit') {
      this.#pending.delete(id)
      const exit = frame.exit
      if (exit?._tag === 'Success') {
        entry.resolve?.(exit.value)
        entry.onEnd?.(null)
      } else {
        const errMsg = extractRpcFailureMessage(exit?.cause ?? exit)
        const err = Object.assign(new Error(errMsg), { cause: exit?.cause ?? exit })
        entry.reject?.(err)
        entry.onEnd?.(err)
      }
      return
    }

    if (frame._tag === 'Defect') {
      this.#pending.delete(id)
      const err = new Error(extractRpcFailureMessage(frame.defect))
      entry.reject?.(err)
      entry.onEnd?.(err)
    }
  }

  #failInFlight(reason) {
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id)
      const err = new Error(reason)
      entry.reject?.(err)
      entry.onEnd?.(err)
    }
    for (const sub of this.#activeSubs.values()) sub.reqId = null
  }

  #resubscribeAll() {
    for (const [key, sub] of this.#activeSubs) {
      if (sub.listeners.size === 0) { this.#activeSubs.delete(key); continue }
      this.#openStream(sub)
    }
  }

  #openStream(sub) {
    if (this.#ws?.readyState !== WebSocket.OPEN) return
    const wireId = String(this.#nextReqId++)
    sub.reqId = wireId
    this.#pending.set(wireId, {
      wireId,
      stream: true,
      method: sub.method,
      payload: sub.payload,
      onChunk: (val) => {
        for (const fn of sub.listeners) {
          try { fn(val) } catch { /* isolate */ }
        }
      },
      onEnd: (err) => {
        if (sub.reqId === wireId) sub.reqId = null
        if (err) {
          for (const fn of sub.listeners) {
            try { fn({ _streamError: err.message }) } catch { /* isolate */ }
          }
        }
      },
    })
    this.#sendRaw({
      _tag: 'Request',
      id: wireId,
      tag: sub.method,
      payload: sub.payload ?? {},
      headers: [],
    })
  }

  /** Executes any unary Effect RPC method on WsRpcGroup. */
  call(method, payload = {}, { timeoutMs = 30_000 } = {}) {
    if (this.#ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`T3 environment "${this.#label}" is not connected (${this.#state}).`))
    }
    const wireId = String(this.#nextReqId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.has(wireId)) {
          this.#pending.delete(wireId)
          this.#sendRaw({ _tag: 'Interrupt', requestId: wireId })
          reject(new Error(`RPC ${method} timed out after ${timeoutMs} ms`))
        }
      }, timeoutMs)
      this.#pending.set(wireId, {
        wireId,
        stream: false,
        method,
        payload,
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.#sendRaw({
        _tag: 'Request',
        id: wireId,
        tag: method,
        payload: payload ?? {},
        headers: [],
      })
    })
  }

  /** Opens a durable subscription on any streaming Effect RPC method (auto-resubscribes on reconnect). */
  subscribe(method, payload = {}, onEvent) {
    const key = `${method}:${JSON.stringify(payload ?? {})}`
    let sub = this.#activeSubs.get(key)
    if (!sub) {
      sub = { key, method, payload, listeners: new Set(), reqId: null }
      this.#activeSubs.set(key, sub)
    }
    sub.listeners.add(onEvent)
    if (sub.reqId === null && this.#ws?.readyState === WebSocket.OPEN) {
      this.#openStream(sub)
    }
    return () => {
      sub.listeners.delete(onEvent)
      if (sub.listeners.size === 0) {
        this.#activeSubs.delete(key)
        if (sub.reqId !== null) {
          this.#pending.delete(sub.reqId)
          this.#sendRaw({ _tag: 'Interrupt', requestId: sub.reqId })
          sub.reqId = null
        }
      }
    }
  }

  /** Uploads a binary attachment (PNG/WebM/JSON) through T3's signed upload URL flow. */
  async uploadAttachment({ name, mimeType, bytes, type }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const kind = type ?? (mimeType.startsWith('image/') ? 'image' : 'file')
    const prepared = await this.call('attachments.createUploadUrl', {
      type: kind,
      name,
      mimeType,
      sizeBytes: buf.byteLength,
    })
    const uploadUrl = prepared.uploadUrl
      ? prepared.uploadUrl
      : prepared.relativeUrl
        ? `${this.#httpBaseUrl}${prepared.relativeUrl}`
        : null
    if (!uploadUrl) throw new Error('attachments.createUploadUrl returned no uploadUrl')
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': mimeType, 'content-length': String(buf.byteLength) },
      body: buf,
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Attachment upload failed (${res.status})`)
    return {
      attachmentId: prepared.attachmentId ?? prepared.id,
      name,
      mimeType,
      sizeBytes: buf.byteLength,
      type: kind,
    }
  }

  /** Launches a new T3 thread (with optional worktree, attachments, and structured game-* context). */
  async launchThread({
    projectId,
    title,
    text,
    contextRecords = [],
    attachments = [],
    modelSelection,
    runtimeMode = 'auto',
    interactionMode = 'default',
    workspaceStrategy,
  }) {
    const built = buildGameMessageContext({ text, records: contextRecords })
    const threadId = randomUUID()
    const commandId = randomUUID()
    const messageId = randomUUID()
    return this.call('orchestration.launchThread', {
      commandId,
      threadId,
      projectId,
      title: title || undefined,
      modelSelection,
      runtimeMode,
      interactionMode,
      workspaceStrategy,
      createdBy: 'user',
      creationSource: 'web',
      initialMessage: {
        messageId,
        text: built.text,
        ...(built.context ? { context: built.context } : {}),
        attachments,
      },
    })
  }

  /** Sends a follow-up message (or steer/queue/restart) into an existing thread. */
  async dispatchMessage({
    threadId,
    text,
    contextRecords = [],
    attachments = [],
    modelSelection,
    dispatchMode = { type: 'start_immediately' },
    deliveryIntent = 'auto',
    freshContext = false,
  }) {
    const built = buildGameMessageContext({ text, records: contextRecords })
    return this.call('orchestration.dispatchCommand', {
      type: 'message.dispatch',
      commandId: randomUUID(),
      threadId,
      messageId: randomUUID(),
      text: built.text,
      ...(built.context ? { context: built.context } : {}),
      attachments,
      ...(modelSelection ? { modelSelection } : {}),
      createdBy: 'user',
      creationSource: 'web',
      deliveryIntent,
      dispatchMode,
      ...(freshContext ? { freshContext: true } : {}),
    })
  }

  /** Transcribes audio bytes using T3 Code's built-in voice API (/api/voice/transcribe). */
  async transcribeVoice(audioBytes, { contentType = 'audio/webm', cloudProvider, model } = {}) {
    const path = cloudProvider
      ? `/api/voice/cloud/${encodeURIComponent(cloudProvider)}/transcribe${model ? `?model=${encodeURIComponent(model)}` : ''}`
      : '/api/voice/transcribe'
    return this.httpJson('POST', path, {
      body: Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes),
      headers: { 'content-type': contentType },
      timeoutMs: 45_000,
    })
  }

  dispose() {
    this.#disposed = true
    if (this.#reconnectTimer) { clearTimeout(this.#reconnectTimer); this.#reconnectTimer = null }
    if (this.#renewTimer) { clearTimeout(this.#renewTimer); this.#renewTimer = null }
    this.#stopHeartbeat()
    this.#failInFlight('Client disposed')
    this.#activeSubs.clear()
    try { this.#ws?.close(1000, 'dispose') } catch { /* ignore */ }
    this.#ws = null
    this.#setState('disconnected', null)
  }
}

function extractRpcFailureMessage(cause) {
  if (!cause) return 'RPC failed'
  if (typeof cause === 'string') return cause
  if (typeof cause.message === 'string') return cause.message
  if (Array.isArray(cause.reasons) && cause.reasons.length) {
    const first = cause.reasons[0]
    if (first?.error?.message) return first.error.message
    if (first?.defect?.message) return first.defect.message
    return JSON.stringify(first).slice(0, 240)
  }
  if (cause.error?.message) return cause.error.message
  return JSON.stringify(cause).slice(0, 240)
}

/**
 * Manages multiple paired T3 Code environments (local Mac, remote Linux/VPS, T3 Connect, Tailscale)
 * with persisted DPoP credentials and unified event broadcasting to the in-game Studio UI.
 */
export class T3ConnectionManager {
  #storePath
  #clients = new Map() // environmentId -> T3EnvironmentClient
  #listeners = new Set()
  #activeEnvId = null

  constructor({ storePath = join(DEFAULT_STUDIO_DIR, 'environments.json') } = {}) {
    this.#storePath = storePath
  }

  get activeEnvironmentId() { return this.#activeEnvId }

  list() {
    return [...this.#clients.values()].map((c) => ({
      ...c.summary(),
      active: c.environmentId === this.#activeEnvId,
    }))
  }

  get(environmentId) {
    const id = environmentId || this.#activeEnvId
    if (!id) return [...this.#clients.values()][0] ?? null
    return this.#clients.get(id) ?? null
  }

  setActive(environmentId) {
    if (!this.#clients.has(environmentId)) throw new Error(`Unknown environment: ${environmentId}`)
    this.#activeEnvId = environmentId
    this.#broadcast({ type: 'environments.changed', environments: this.list() })
  }

  onEvent(fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #broadcast(ev) {
    for (const fn of this.#listeners) {
      try { fn(ev) } catch { /* isolate */ }
    }
  }

  async load() {
    if (!existsSync(this.#storePath)) return
    let saved
    try { saved = JSON.parse(await readFile(this.#storePath, 'utf8')) } catch { return }
    const entries = Array.isArray(saved?.environments) ? saved.environments : []
    for (const entry of entries) {
      try {
        const dpopKeyPair = entry.dpopPrivateJwk ? await importDpopKeyPair(entry.dpopPrivateJwk) : null
        const client = this.#attachClient(new T3EnvironmentClient({
          ...entry,
          dpopKeyPair,
          onCredentialUpdate: () => void this.save(),
        }))
        if (!this.#activeEnvId || saved.activeEnvironmentId === client.environmentId) {
          this.#activeEnvId = client.environmentId
        }
        void client.connect().catch(() => {})
      } catch { /* skip corrupt record */ }
    }
  }

  async save() {
    await mkdir(dirname(this.#storePath), { recursive: true })
    const data = {
      version: 1,
      activeEnvironmentId: this.#activeEnvId,
      environments: [...this.#clients.values()].map((c) => c.serialize()),
    }
    await writeFile(this.#storePath, JSON.stringify(data, null, 2), { mode: 0o600 })
    try { await chmod(this.#storePath, 0o600) } catch { /* ignore */ }
  }

  #attachClient(client) {
    const prev = this.#clients.get(client.environmentId)
    if (prev && prev !== client) prev.dispose()
    this.#clients.set(client.environmentId, client)
    client.onEvent((ev) => this.#broadcast(ev))
    if (!this.#activeEnvId) this.#activeEnvId = client.environmentId
    this.#broadcast({ type: 'environments.changed', environments: this.list() })
    return client
  }

  /**
   * Pairs a new T3 Code environment via pairingUrl or host + pairingCode.
   * Prefers DPoP-bound tokens when advertised by the server's descriptor; falls back cleanly to Bearer.
   */
  async pair({ pairingUrl, host, pairingCode, label, scopes = STUDIO_DEFAULT_SCOPES, useDpop = true }) {
    const target = parsePairingInput({ pairingUrl, host, pairingCode })
    const descriptorRes = await fetch(`${target.httpBaseUrl}/.well-known/t3/environment`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!descriptorRes.ok) throw new Error(`Could not read T3 environment descriptor (${descriptorRes.status})`)
    const descriptor = await descriptorRes.json()
    const envId = descriptor.environmentId ?? `env:${new URL(target.httpBaseUrl).host}`
    const supportsDpop =
      useDpop &&
      (!Array.isArray(descriptor?.auth?.sessionMethods) || descriptor.auth.sessionMethods.includes('dpop-access-token'))

    const dpopKeyPair = supportsDpop ? await generateDpopKeyPair() : null
    const tokenUrl = `${target.httpBaseUrl}/oauth/token`
    const form = new URLSearchParams({
      grant_type: AUTH_TOKEN_EXCHANGE_GRANT_TYPE,
      subject_token: target.pairingCode,
      subject_token_type: AUTH_BOOTSTRAP_TOKEN_TYPE,
      requested_token_type: AUTH_ACCESS_TOKEN_TYPE,
      scope: scopes.join(' '),
      client_label: label || target.label || 'Voxelwright Studio',
      client_device_type: 'desktop',
      client_os: process.platform === 'darwin' ? 'macOS' : process.platform,
    })
    const headers = { 'content-type': 'application/x-www-form-urlencoded' }
    if (dpopKeyPair) {
      headers.dpop = await createDpopProof(dpopKeyPair, { method: 'POST', url: tokenUrl })
    }
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => '')
      throw new Error(`T3 token exchange failed (${tokenRes.status}): ${body.slice(0, 200)}`)
    }
    const tok = await tokenRes.json()
    const client = new T3EnvironmentClient({
      environmentId: envId,
      label: label || target.label || descriptor.label || new URL(target.httpBaseUrl).host,
      httpBaseUrl: target.httpBaseUrl,
      tokenType: tok.token_type === 'DPoP' && dpopKeyPair ? 'DPoP' : 'Bearer',
      accessToken: tok.access_token,
      expiresAtMs: Date.now() + Number(tok.expires_in ?? 86400) * 1000,
      scopes: typeof tok.scope === 'string' ? tok.scope.split(/\s+/).filter(Boolean) : scopes,
      dpopKeyPair: tok.token_type === 'DPoP' ? dpopKeyPair : null,
      descriptor,
      onCredentialUpdate: () => void this.save(),
    })
    this.#attachClient(client)
    this.#activeEnvId = client.environmentId
    await this.save()
    await client.connect()
    return client.summary()
  }

  /** Connects directly using an already-minted Bearer token (useful for local CLI / test fixtures). */
  async connectDirect({ httpBaseUrl, accessToken, label, environmentId, scopes = STUDIO_DEFAULT_SCOPES }) {
    const base = normalizeHttpBase(httpBaseUrl)
    let descriptor = null
    try {
      const r = await fetch(`${base}/.well-known/t3/environment`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) descriptor = await r.json()
    } catch { /* optional */ }
    const envId = environmentId || descriptor?.environmentId || `direct:${new URL(base).host}`
    const client = new T3EnvironmentClient({
      environmentId: envId,
      label: label || descriptor?.label || new URL(base).host,
      httpBaseUrl: base,
      tokenType: 'Bearer',
      accessToken,
      scopes,
      descriptor,
      onCredentialUpdate: () => void this.save(),
    })
    this.#attachClient(client)
    this.#activeEnvId = client.environmentId
    await this.save()
    await client.connect()
    return client.summary()
  }

  /** Discovers a running local T3 Code server and auto-pairs via `t3 auth pairing create`. */
  async autoConnectLocal({ stateDir = DEFAULT_T3_STATE_DIR, t3Bin } = {}) {
    const local = await discoverLocalT3Server(stateDir)
    if (!local) throw new Error('No running local T3 Code server found in ~/.t3/userdata/server-runtime.json')
    const existing = this.#clients.get(local.descriptor?.environmentId)
    if (existing && existing.state === 'connected') return existing.summary()
    const minted = await mintLocalPairingViaCli({ t3Bin })
    return this.pair({
      pairingUrl: minted.pairingUrl ?? undefined,
      host: minted.pairingUrl ? undefined : local.origin,
      pairingCode: minted.pairingCode,
      label: local.descriptor?.label || 'Local Mac (T3 Code)',
    })
  }

  async remove(environmentId) {
    const client = this.#clients.get(environmentId)
    if (!client) return false
    client.dispose()
    this.#clients.delete(environmentId)
    if (this.#activeEnvId === environmentId) {
      this.#activeEnvId = this.#clients.keys().next().value ?? null
    }
    await this.save()
    this.#broadcast({ type: 'environments.changed', environments: this.list() })
    return true
  }

  dispose() {
    for (const c of this.#clients.values()) c.dispose()
    this.#clients.clear()
  }
}
