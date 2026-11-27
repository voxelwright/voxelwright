// Dual-driver T3 Code Transport for the in-game Studio UI (#98):
//   1. BridgeTransport (local Mac dev): talks to Studio Bridge over loopback WS/HTTP — zero bundling,
//      auto-discovers local T3 Code, CORP-safe asset proxy, worktree hot-reload, headless + MCP parity.
//   2. DirectT3Transport (standalone browser / iPad / Tailscale without a local bridge): uses browser
//      WebCrypto ES256 DPoP directly against T3 Code's CORS-enabled EnvironmentHttpApi + Effect RPC /ws!
import type {
  GameContextRecord,
  T3EnvironmentSummary,
  T3Transport,
  ThreadLaunchDraft,
  UploadedFileDraft,
} from './types.ts'

const b64urlBytes = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
const b64urlJson = (obj: unknown): string => b64urlBytes(new TextEncoder().encode(JSON.stringify(obj)))

async function sha256B64Url(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return b64urlBytes(new Uint8Array(hash))
}

function normalizeHtu(rawUrl: string): string {
  const u = new URL(rawUrl)
  const proto = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol
  return `${proto}//${u.host}${u.pathname}`
}

async function createBrowserDpopProof(
  privateKey: CryptoKey,
  publicJwk: Record<string, string>,
  opts: { method: string; url: string; accessToken?: string },
): Promise<string> {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk }
  const payload: Record<string, unknown> = {
    htm: opts.method.toUpperCase(),
    htu: normalizeHtu(opts.url),
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  }
  if (opts.accessToken) payload.ath = await sha256B64Url(opts.accessToken)
  const input = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(input),
  )
  return `${input}.${b64urlBytes(new Uint8Array(sig))}`
}

function buildContextRecordsForWire(text: string, records: GameContextRecord[] = []) {
  const clean: Record<string, unknown>[] = []
  const refs: string[] = []
  const known = new Set([
    'image', 'file', 'terminal', 'element', 'preview-annotation', 'review-comment',
    'mention', 'skill', 'thread', 'environment', 'response',
  ])
  for (let i = 0; i < records.length && clean.length < 200; i++) {
    const r = records[i]
    const kind = String(r.kind || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(kind)) continue
    const contextId = (r.contextId || `ctx_${i + 1}_${crypto.randomUUID().slice(0, 8)}`).replace(/[^a-z0-9_-]/gi, '_')
    const label = String(r.label || kind).slice(0, 200)
    if (known.has(kind)) {
      clean.push({ ...r, version: 1, contextId, label, kind })
    } else {
      let payload: Record<string, unknown> = r.payload ?? {}
      const str = JSON.stringify(payload)
      if (str.length > 62_000) payload = { truncated: true, preview: str.slice(0, 60_000) }
      clean.push({ version: 1, contextId, label, kind, payload })
    }
    refs.push(`[${label.replace(/[\[\]]/g, '')}](t3-context://v1/${kind}/${contextId})`)
  }
  const trimmed = text.trim()
  return {
    text: refs.length ? `${trimmed}${trimmed ? '\n\n' : ''}${refs.join(' ')}` : trimmed,
    context: clean.length ? { version: 1 as const, records: clean } : undefined,
  }
}

/** Local Studio Bridge transport (zero bundling, CORP-safe assets, worktree hot-reload, MCP/headless parity). */
export function createBridgeTransport(bridgeUrl: string, secret: string): T3Transport {
  const base = bridgeUrl.replace(/\/+$/, '')
  const wsBase = base.replace(/^http/, 'ws')
  let ws: WebSocket | null = null
  let nextRpcId = 1
  let nextSubId = 1
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const pendingRpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const subs = new Map<string, { method: string; payload: Record<string, unknown>; environmentId?: string; onEvent: (ev: unknown) => void }>()
  const listeners = new Set<(ev: Record<string, unknown>) => void>()

  const headers = (extra: Record<string, string> = {}) => ({
    'X-Studio-Secret': secret,
    ...extra,
  })

  async function bridgeJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? headers({ 'Content-Type': 'application/json' }) : headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Bridge HTTP ${res.status}`)
    return data as T
  }

  const openSocket = (): Promise<void> => new Promise((resolve) => {
    if (disposed) { resolve(); return }
    if (ws && ws.readyState === WebSocket.OPEN) { resolve(); return }
    const sock = new WebSocket(`${wsBase}/studio/ws/t3?secret=${encodeURIComponent(secret)}`)
    let settled = false
    sock.addEventListener('open', () => {
      ws = sock
      for (const [subId, sub] of subs) {
        sock.send(JSON.stringify({ type: 'subscribe', subId, method: sub.method, payload: sub.payload, environmentId: sub.environmentId }))
      }
      if (!settled) { settled = true; resolve() }
    })
    sock.addEventListener('message', (ev) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(String(ev.data)) as Record<string, unknown> } catch { return }
      if (msg.type === 'rpc.result' && msg.id !== undefined) {
        const p = pendingRpc.get(String(msg.id))
        if (!p) return
        pendingRpc.delete(String(msg.id))
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(String(msg.error ?? 'RPC error')))
        return
      }
      if (msg.type === 'sub.event' && typeof msg.subId === 'string') {
        subs.get(msg.subId)?.onEvent(msg.event)
        return
      }
      for (const fn of listeners) {
        try { fn(msg) } catch { /* isolate */ }
      }
    })
    sock.addEventListener('close', () => {
      if (ws === sock) ws = null
      for (const [id, p] of pendingRpc) {
        pendingRpc.delete(id)
        p.reject(new Error('Studio Bridge socket closed'))
      }
      if (!settled) { settled = true; resolve() }
      if (!disposed && !reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; void openSocket() }, 1500)
      }
    })
    sock.addEventListener('error', () => {
      if (!settled) { settled = true; resolve() }
    })
  })

  return {
    mode: 'bridge',
    bridgeUrl: base,
    secret,
    connect: openSocket,
    dispose() {
      disposed = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      try { ws?.close(1000) } catch { /* ignore */ }
      ws = null
      subs.clear()
    },
    async status() {
      return bridgeJson('GET', '/studio/status')
    },
    async autoConnectLocal() {
      const r = await bridgeJson<{ environment: T3EnvironmentSummary }>('POST', '/studio/api/t3/auto-connect', {})
      return r.environment
    },
    async pair(input) {
      const r = await bridgeJson<{ environment: T3EnvironmentSummary }>('POST', '/studio/api/t3/pair', input)
      return r.environment
    },
    async setActiveEnvironment(environmentId) {
      await bridgeJson('POST', '/studio/api/t3/active', { environmentId })
    },
    async removeEnvironment(environmentId) {
      await bridgeJson('DELETE', `/studio/api/t3/environment?environmentId=${encodeURIComponent(environmentId)}`)
    },
    async rpc<T = unknown>(method: string, payload: Record<string, unknown> = {}, environmentId?: string): Promise<T> {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const id = String(nextRpcId++)
        return new Promise<T>((resolve, reject) => {
          pendingRpc.set(id, { resolve: resolve as (v: unknown) => void, reject })
          ws!.send(JSON.stringify({ type: 'rpc', id, method, payload, environmentId }))
        })
      }
      const r = await bridgeJson<{ result: T }>('POST', '/studio/api/t3/rpc', { method, payload, environmentId })
      return r.result
    },
    async http<T = unknown>(method: string, path: string, body?: unknown, environmentId?: string): Promise<T> {
      const r = await bridgeJson<{ result: T }>('POST', '/studio/api/t3/http', { method, path, body, environmentId })
      return r.result
    },
    subscribe(method, payload, onEvent, environmentId) {
      const subId = `sub_${nextSubId++}`
      subs.set(subId, { method, payload, environmentId, onEvent })
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', subId, method, payload, environmentId }))
      }
      return () => {
        subs.delete(subId)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unsubscribe', subId }))
        }
      }
    },
    async launchThread(draft) {
      return bridgeJson('POST', '/studio/api/t3/launch-thread', draft)
    },
    async sendMessage(input) {
      return bridgeJson('POST', '/studio/api/t3/send-message', input)
    },
    async uploadAttachment(file, name, mimeType, environmentId) {
      const qs = new URLSearchParams({ name, mimeType, ...(environmentId ? { environmentId } : {}) })
      const body = file instanceof Blob ? await file.arrayBuffer() : new Uint8Array(file).buffer
      const res = await fetch(`${base}/studio/api/t3/upload?${qs.toString()}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': mimeType }),
        body,
      })
      const data = await res.json() as { attachment?: { attachmentId: string; name: string; mimeType: string; sizeBytes: number; type: string }; error?: string }
      if (!res.ok || !data.attachment) throw new Error(data.error || `Upload failed (${res.status})`)
      return data.attachment
    },
    assetUrl(path, environmentId) {
      const qs = new URLSearchParams({ path, secret, ...(environmentId ? { environmentId } : {}) })
      return `${base}/studio/api/t3/asset?${qs.toString()}`
    },
    async transcribeVoice(audio, opts = {}) {
      const qs = new URLSearchParams({
        ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      })
      const res = await fetch(`${base}/studio/api/t3/voice/transcribe?${qs.toString()}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': audio.type || 'audio/webm' }),
        body: audio,
      })
      const data = await res.json() as { result?: { text?: string; transcript?: string }; error?: string }
      if (!res.ok) throw new Error(data.error || `Voice transcribe failed (${res.status})`)
      return data.result ?? {}
    },
    async listWorktrees() {
      const r = await bridgeJson<{ worktrees: Array<{ path: string; head?: string; branch?: string; previewUrl?: string | null }> }>('GET', '/studio/api/worktree/list')
      return r.worktrees ?? []
    },
    async verifyWorktree(input) {
      const r = await bridgeJson<{ result: Record<string, unknown> }>('POST', '/studio/api/worktree/verify', input)
      return r.result
    },
    async generateRegressionTest(input) {
      return bridgeJson('POST', '/studio/api/game/regression-test', input)
    },
    onEvent(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/**
 * Direct Browser-to-T3 Transport (no local Bridge needed — ideal for mobile/iPad over Tailscale or direct LAN).
 * Implements RFC 9449 ES256 DPoP + Effect RPC JSON over WebSocket directly from the browser page!
 */
interface DirectEnvRecord {
  summary: T3EnvironmentSummary
  httpBaseUrl: string
  accessToken: string
  tokenType: 'DPoP' | 'Bearer'
  privateKey: CryptoKey | null
  publicJwk: Record<string, string> | null
  ws: WebSocket | null
  pending: Map<string, { resolve?: (v: unknown) => void; reject?: (e: Error) => void; onChunk?: (v: unknown) => void }>
  nextId: number
  partBuf: string
}

const DIRECT_STORAGE_KEY = 'voxelwright.studio.directEnvs.v1'

export function createDirectT3Transport(): T3Transport {
  const envs = new Map<string, DirectEnvRecord>()
  let activeId: string | null = null
  const listeners = new Set<(ev: Record<string, unknown>) => void>()

  const emit = (ev: Record<string, unknown>) => {
    for (const fn of listeners) {
      try { fn(ev) } catch { /* isolate */ }
    }
  }

  const getEnv = (id?: string) => (id ? envs.get(id) : activeId ? envs.get(activeId) : [...envs.values()][0]) ?? null

  async function authHeaders(env: DirectEnvRecord, method: string, url: string, extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra }
    if (env.tokenType === 'DPoP' && env.privateKey && env.publicJwk) {
      h.Authorization = `DPoP ${env.accessToken}`
      h.DPoP = await createBrowserDpopProof(env.privateKey, env.publicJwk, { method, url, accessToken: env.accessToken })
    } else {
      h.Authorization = `Bearer ${env.accessToken}`
    }
    return h
  }

  async function openEnvSocket(env: DirectEnvRecord): Promise<void> {
    if (env.ws && env.ws.readyState === WebSocket.OPEN) return
    env.summary.state = 'connecting'
    emit({ channel: 't3', type: 'connection.state', environmentId: env.summary.environmentId, state: 'connecting' })
    let ticketUrl = `${env.httpBaseUrl}/api/auth/websocket-ticket/rpc`
    let ticketRes = await fetch(ticketUrl, { method: 'POST', headers: await authHeaders(env, 'POST', ticketUrl) })
    if (ticketRes.status === 404) {
      ticketUrl = `${env.httpBaseUrl}/api/auth/websocket-ticket`
      ticketRes = await fetch(ticketUrl, { method: 'POST', headers: await authHeaders(env, 'POST', ticketUrl) })
    }
    if (!ticketRes.ok) throw new Error(`WebSocket ticket failed (${ticketRes.status})`)
    const ticketJson = await ticketRes.json() as { ticket?: string }
    const ticket = ticketJson.ticket
    if (!ticket) throw new Error('No wsTicket returned')
    const wsUrl = new URL(`${env.httpBaseUrl.replace(/^http/, 'ws')}/ws`)
    wsUrl.searchParams.set('orchestrationProtocol', '2')
    wsUrl.searchParams.set('frameParts', '1')
    wsUrl.searchParams.set('wsTicket', ticket)
    if (env.tokenType === 'DPoP' && env.privateKey && env.publicJwk) {
      const proof = await createBrowserDpopProof(env.privateKey, env.publicJwk, {
        method: 'GET',
        url: `${env.httpBaseUrl}/ws`,
        accessToken: ticket,
      })
      wsUrl.searchParams.set('dpop', proof)
    }
    await new Promise<void>((resolve, reject) => {
      const sock = new WebSocket(wsUrl.toString())
      sock.addEventListener('open', () => {
        env.ws = sock
        env.summary.state = 'connected'
        emit({ channel: 't3', type: 'connection.state', environmentId: env.summary.environmentId, state: 'connected' })
        resolve()
      })
      sock.addEventListener('message', (ev) => {
        const raw = String(ev.data)
        if (raw.startsWith('\u001e')) { env.partBuf += raw.slice(1); return }
        const full = env.partBuf ? env.partBuf + raw : raw
        env.partBuf = ''
        let parsed: unknown
        try { parsed = JSON.parse(full) } catch { return }
        const frames = Array.isArray(parsed) ? parsed : [parsed]
        for (const f of frames as Array<Record<string, unknown>>) {
          if (f._tag === 'Ping') { sock.send(JSON.stringify({ _tag: 'Pong' })); continue }
          if (f._tag === 'Pong') continue
          const id = String(f.requestId ?? '')
          const p = env.pending.get(id)
          if (!p) continue
          if (f._tag === 'Chunk') {
            for (const v of (Array.isArray(f.values) ? f.values : [])) p.onChunk?.(v)
            sock.send(JSON.stringify({ _tag: 'Ack', requestId: id }))
          } else if (f._tag === 'Exit') {
            env.pending.delete(id)
            const exit = f.exit as Record<string, unknown> | undefined
            if (exit?._tag === 'Success') p.resolve?.(exit.value)
            else p.reject?.(new Error(JSON.stringify(exit?.cause ?? 'RPC failed').slice(0, 240)))
          }
        }
      })
      sock.addEventListener('close', () => {
        if (env.ws === sock) env.ws = null
        env.summary.state = 'disconnected'
        emit({ channel: 't3', type: 'connection.state', environmentId: env.summary.environmentId, state: 'disconnected' })
      })
      sock.addEventListener('error', () => reject(new Error('Direct T3 WebSocket error')))
    })
  }

  async function saveDirect() {
    const entries = []
    for (const env of envs.values()) {
      const privateJwk = env.privateKey ? await crypto.subtle.exportKey('jwk', env.privateKey).catch(() => null) : null
      entries.push({ summary: env.summary, httpBaseUrl: env.httpBaseUrl, accessToken: env.accessToken, tokenType: env.tokenType, privateJwk, publicJwk: env.publicJwk })
    }
    try { localStorage.setItem(DIRECT_STORAGE_KEY, JSON.stringify({ activeId, entries })) } catch { /* ignore */ }
  }

  return {
    mode: 'direct',
    bridgeUrl: null,
    secret: null,
    async connect() {
      try {
        const raw = localStorage.getItem(DIRECT_STORAGE_KEY)
        if (!raw) return
        const saved = JSON.parse(raw) as { activeId?: string; entries?: Array<{ summary: T3EnvironmentSummary; httpBaseUrl: string; accessToken: string; tokenType: 'DPoP' | 'Bearer'; privateJwk: JsonWebKey | null; publicJwk: Record<string, string> | null }> }
        for (const e of saved.entries ?? []) {
          const privateKey = e.privateJwk ? await crypto.subtle.importKey('jwk', e.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']).catch(() => null) : null
          const rec: DirectEnvRecord = { summary: { ...e.summary, state: 'disconnected' }, httpBaseUrl: e.httpBaseUrl, accessToken: e.accessToken, tokenType: e.tokenType, privateKey, publicJwk: e.publicJwk, ws: null, pending: new Map(), nextId: 1, partBuf: '' }
          envs.set(rec.summary.environmentId, rec)
          void openEnvSocket(rec).catch(() => {})
        }
        activeId = saved.activeId ?? [...envs.keys()][0] ?? null
      } catch { /* ignore */ }
    },
    dispose() {
      for (const env of envs.values()) { try { env.ws?.close(1000) } catch { /* ignore */ } }
      envs.clear()
    },
    async status() {
      return {
        environments: [...envs.values()].map((e) => ({ ...e.summary, active: e.summary.environmentId === activeId })),
        activeEnvironmentId: activeId,
      }
    },
    async autoConnectLocal() {
      throw new Error('Auto-connect requires the local Studio Bridge. Paste a T3 pairing URL or code instead.')
    },
    async pair(input) {
      let httpBaseUrl = (input.httpBaseUrl || input.host || '').replace(/\/+$/, '')
      let code = input.pairingCode || ''
      if (input.pairingUrl) {
        const u = new URL(input.pairingUrl.trim())
        const hp = new URLSearchParams(u.hash.slice(1))
        httpBaseUrl = (u.searchParams.get('host') || u.origin).replace(/\/+$/, '')
        code = hp.get('token') || u.searchParams.get('token') || code
      }
      const desc = await fetch(`${httpBaseUrl}/.well-known/t3/environment`).then((r) => r.json()) as Record<string, unknown>
      const envId = String(desc.environmentId || `direct:${new URL(httpBaseUrl).host}`)
      let accessToken = input.accessToken || ''
      let tokenType: 'DPoP' | 'Bearer' = 'Bearer'
      let privateKey: CryptoKey | null = null
      let publicJwk: Record<string, string> | null = null
      if (!accessToken) {
        const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        privateKey = kp.privateKey
        const fullPub = await crypto.subtle.exportKey('jwk', kp.publicKey)
        publicJwk = { kty: 'EC', crv: 'P-256', x: String(fullPub.x), y: String(fullPub.y) }
        const tokenUrl = `${httpBaseUrl}/oauth/token`
        const dpop = await createBrowserDpopProof(privateKey, publicJwk, { method: 'POST', url: tokenUrl })
        const form = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: code,
          subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          client_label: input.label || 'Voxelwright Studio (Direct)',
          client_device_type: 'desktop',
        })
        const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpop }, body: form.toString() })
        if (!res.ok) throw new Error(`Direct pairing failed (${res.status})`)
        const tok = await res.json() as { access_token: string; token_type?: string }
        accessToken = tok.access_token
        tokenType = tok.token_type === 'DPoP' ? 'DPoP' : 'Bearer'
      }
      const rec: DirectEnvRecord = {
        summary: {
          environmentId: envId,
          label: input.label || String(desc.label || new URL(httpBaseUrl).host),
          httpBaseUrl,
          tokenType,
          scopes: [],
          state: 'disconnected',
          lastError: null,
          serverVersion: typeof desc.serverVersion === 'string' ? desc.serverVersion : null,
          capabilities: (desc.capabilities as Record<string, unknown>) ?? {},
        },
        httpBaseUrl,
        accessToken,
        tokenType,
        privateKey: tokenType === 'DPoP' ? privateKey : null,
        publicJwk: tokenType === 'DPoP' ? publicJwk : null,
        ws: null,
        pending: new Map(),
        nextId: 1,
        partBuf: '',
      }
      envs.set(envId, rec)
      activeId = envId
      await saveDirect()
      await openEnvSocket(rec)
      return rec.summary
    },
    async setActiveEnvironment(id) { activeId = id; await saveDirect() },
    async removeEnvironment(id) { envs.get(id)?.ws?.close(); envs.delete(id); if (activeId === id) activeId = [...envs.keys()][0] ?? null; await saveDirect() },
    async rpc<T = unknown>(method: string, payload: Record<string, unknown> = {}, environmentId?: string): Promise<T> {
      const env = getEnv(environmentId)
      if (!env || !env.ws || env.ws.readyState !== WebSocket.OPEN) throw new Error('Direct T3 environment not connected')
      const id = String(env.nextId++)
      return new Promise<T>((resolve, reject) => {
        env.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        env.ws!.send(JSON.stringify({ _tag: 'Request', id, tag: method, payload, headers: [] }))
      })
    },
    async http<T = unknown>(method: string, path: string, body?: unknown, environmentId?: string): Promise<T> {
      const env = getEnv(environmentId)
      if (!env) throw new Error('Direct T3 environment not connected')
      const url = `${env.httpBaseUrl}${path}`
      const extra: Record<string, string> = path.startsWith('/api/orchestration') ? { 'x-t3-orchestration-protocol': '2' } : {}
      if (body !== undefined) extra['Content-Type'] = 'application/json'
      const res = await fetch(url, { method, headers: await authHeaders(env, method, url, extra), body: body !== undefined ? JSON.stringify(body) : undefined })
      if (!res.ok) throw new Error(`T3 HTTP ${res.status}`)
      return (await res.json()) as T
    },
    subscribe(method, payload, onEvent, environmentId) {
      const env = getEnv(environmentId)
      if (!env || !env.ws || env.ws.readyState !== WebSocket.OPEN) return () => {}
      const id = String(env.nextId++)
      env.pending.set(id, { onChunk: onEvent })
      env.ws.send(JSON.stringify({ _tag: 'Request', id, tag: method, payload, headers: [] }))
      return () => {
        env.pending.delete(id)
        if (env.ws?.readyState === WebSocket.OPEN) env.ws.send(JSON.stringify({ _tag: 'Interrupt', requestId: id }))
      }
    },
    async launchThread(draft) {
      const uploaded: Array<{ id: string; type: string; name: string; mimeType: string; sizeBytes: number }> = []
      const records: GameContextRecord[] = [...(draft.contextRecords ?? [])]
      for (const f of draft.files ?? []) {
        const bin = Uint8Array.from(atob(f.dataBase64.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0))
        const att = await this.uploadAttachment(bin, f.name, f.mimeType, draft.environmentId)
        uploaded.push({ id: att.attachmentId, type: att.type, name: att.name, mimeType: att.mimeType, sizeBytes: att.sizeBytes })
        records.push({ kind: att.type === 'image' ? 'image' : 'file', label: f.label || att.name, attachmentId: att.attachmentId, name: att.name, mimeType: att.mimeType, sizeBytes: att.sizeBytes })
      }
      const built = buildContextRecordsForWire(draft.text, records)
      const result = await this.rpc('orchestration.launchThread', {
        commandId: crypto.randomUUID(),
        threadId: crypto.randomUUID(),
        projectId: draft.projectId,
        title: draft.title,
        modelSelection: draft.modelSelection,
        runtimeMode: draft.runtimeMode ?? 'auto',
        interactionMode: draft.interactionMode ?? 'default',
        workspaceStrategy: draft.workspaceStrategy,
        createdBy: 'user',
        creationSource: 'web',
        initialMessage: { messageId: crypto.randomUUID(), text: built.text, ...(built.context ? { context: built.context } : {}), attachments: uploaded },
      }, draft.environmentId)
      return { result, attachments: uploaded }
    },
    async sendMessage(input) {
      const built = buildContextRecordsForWire(input.text, input.contextRecords ?? [])
      const result = await this.rpc('orchestration.dispatchCommand', {
        type: 'message.dispatch',
        commandId: crypto.randomUUID(),
        threadId: input.threadId,
        messageId: crypto.randomUUID(),
        text: built.text,
        ...(built.context ? { context: built.context } : {}),
        attachments: [],
        modelSelection: input.modelSelection,
        createdBy: 'user',
        creationSource: 'web',
        deliveryIntent: input.deliveryIntent ?? 'auto',
        dispatchMode: input.dispatchMode ?? { type: 'start_immediately' },
        ...(input.freshContext ? { freshContext: true } : {}),
      }, input.environmentId)
      return { result }
    },
    async uploadAttachment(file, name, mimeType, environmentId) {
      const env = getEnv(environmentId)
      if (!env) throw new Error('Not connected')
      const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file)
      const kind = mimeType.startsWith('image/') ? 'image' : 'file'
      const prep = await this.rpc<{ uploadUrl?: string; relativeUrl?: string; attachmentId?: string; id?: string }>('attachments.createUploadUrl', {
        type: kind, name, mimeType, sizeBytes: bytes.byteLength,
      }, environmentId)
      const url = prep.uploadUrl || `${env.httpBaseUrl}${prep.relativeUrl}`
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': mimeType }, body: bytes })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      return { attachmentId: String(prep.attachmentId ?? prep.id), name, mimeType, sizeBytes: bytes.byteLength, type: kind }
    },
    assetUrl(path, environmentId) {
      const env = getEnv(environmentId)
      return env ? (path.startsWith('http') ? path : `${env.httpBaseUrl}${path}`) : path
    },
    async transcribeVoice(audio, opts = {}) {
      const env = getEnv(opts.environmentId)
      if (!env) throw new Error('Not connected')
      const url = `${env.httpBaseUrl}/api/voice/transcribe`
      const res = await fetch(url, { method: 'POST', headers: await authHeaders(env, 'POST', url, { 'Content-Type': audio.type || 'audio/webm' }), body: audio })
      if (!res.ok) throw new Error(`Voice transcription failed (${res.status})`)
      return (await res.json()) as { text?: string; transcript?: string }
    },
    async listWorktrees() { return [] },
    async verifyWorktree() { throw new Error('Worktree hot-reload requires the local Studio Bridge.') },
    async generateRegressionTest() { throw new Error('Regression test export requires the local Studio Bridge.') },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}
