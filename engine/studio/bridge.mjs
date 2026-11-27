#!/usr/bin/env node
// Voxelwright Studio Bridge (#98): local loopback owner-only daemon connecting:
//   1. The in-game native T3 Code IDE (`engine/page/studio/`) <-> T3 Code server(s) via native Effect RPC / HTTP / DPoP
//   2. Live user browser tabs AND headless Playwright+WebGPU Chrome instances <-> `voxelwright-game` MCP server
//   3. Worktree preview servers & live `core.wasm` / plugin hot-reload for 1-click "Verify Fix Here"
//   4. CORP-safe T3 media/asset proxy + voice transcription + binary attachment upload + regression test export
//
// Security (matches engine/helper.mjs & engine/workshop/route.mjs):
//   - Listens on 127.0.0.1 only
//   - Rejects foreign Host / Origin headers
//   - Requires per-launch secret (X-Studio-Secret header or WS ?secret= query param)
//   - Never bundled into public voxelwright.world deploys
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CAPTURES_DIR, GameSessionHub } from './game-hub.mjs'
import { BRIDGE_STATE_PATH, createMcpHandler } from './mcp.mjs'
import {
  buildGameMessageContext,
  DEFAULT_STUDIO_DIR,
  discoverLocalT3Server,
  T3ConnectionManager,
} from './t3-client.mjs'
import { acceptWebSocket, rejectUpgrade } from './ws-server.mjs'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const MAX_BODY_BYTES = 24 << 20 // 24 MiB (WebM clips / screenshots)

function isLocalOrigin(origin) {
  if (!origin) return true
  try {
    const u = new URL(origin)
    return LOOPBACK_HOSTS.has(u.hostname) || u.hostname.endsWith('.ts.net')
  } catch {
    return false
  }
}

function isLocalHost(host) {
  if (!host) return false
  const hostname = host.replace(/:\d+$/, '').toLowerCase()
  return LOOPBACK_HOSTS.has(hostname)
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req, limit = MAX_BODY_BYTES) {
  const buf = await readBody(req, limit)
  if (!buf.length) return {}
  try { return JSON.parse(buf.toString('utf8')) } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }) }
}

/** Generates a ready-to-run `engine/test/<slug>.mjs` regression check from a captured bug bookmark & assertion. */
export function buildRegressionTestSource({ slug, title, bookmark, assert: assertSpec = {} }) {
  const at = Array.isArray(bookmark?.at) ? bookmark.at.map((n) => Number(n.toFixed(2))) : [0, 40, 0]
  const look = Array.isArray(bookmark?.look) ? bookmark.look.map((n) => Number(n.toFixed(2))) : [0, -10]
  const hour = bookmark?.hour ?? null
  const weather = bookmark?.weather ?? null
  const maxFrameMs = Number(assertSpec.maxFrameMs ?? 33)
  return `// Auto-generated regression check from Voxelwright Studio (#98): ${title || slug}
// Verify this check fails before the fix and passes on the fix branch:
//   cd engine && node test/${slug}.mjs
import { check, open } from './kit.mjs'

const page = await open('/city?fly=0&at=${at.join(',')}&look=${look.join(',')}${hour !== null ? `&hour=${hour}` : ''}${weather ? `&weather=${weather}` : ''}')
try {
  await page.waitForFunction(() => globalThis.engine && !globalThis.engine.settling, null, { timeout: 20_000 })
  const state = await page.evaluate(() => {
    const e = globalThis.engine
    const summary = e.recorder?.summary?.() ?? null
    return {
      gpuFaults: e.gpu?.faults?.length ?? 0,
      criticalAnomalies: summary?.criticalCount ?? 0,
      frameMs: e.frameMs ?? 0,
      pose: [e.pose?.x ?? 0, e.pose?.y ?? 0, e.pose?.z ?? 0],
    }
  })
  check(state.gpuFaults === 0, \`zero WebGPU faults (got \${state.gpuFaults})\`)
  check(state.criticalAnomalies === 0, \`zero critical anomalies (got \${state.criticalAnomalies})\`)
  check(state.frameMs <= ${maxFrameMs} || state.frameMs === 0, \`frame time within ${maxFrameMs} ms (got \${state.frameMs.toFixed(1)} ms)\`)
} finally {
  await page.close()
}
`
}

export async function createStudioBridge({
  port = 5764,
  gameUrl = 'http://127.0.0.1:5740',
  secret = randomBytes(18).toString('base64url'),
  studioDir = DEFAULT_STUDIO_DIR,
  capturesDir = DEFAULT_CAPTURES_DIR,
  writeRuntimeState = true,
  autoConnectT3 = true,
  t3Bin,
  t3StateDir,
  say = () => {},
} = {}) {
  const t3 = new T3ConnectionManager({ storePath: join(studioDir, 'environments.json') })
  const hub = new GameSessionHub({ capturesDir, defaultGameUrl: gameUrl })
  const mcp = createMcpHandler(hub)
  const uiSockets = new Set() // StudioWebSocket instances from in-game Studio UI (/studio/ws/t3)
  const uiSubs = new Map() // ws -> Map<clientSubId, unsubscribeFn>

  const broadcastToUi = (msg) => {
    const frame = JSON.stringify(msg)
    for (const ws of uiSockets) {
      if (ws.open) ws.send(frame)
    }
  }

  t3.onEvent((ev) => broadcastToUi({ channel: 't3', ...ev }))
  hub.onEvent((ev) => broadcastToUi({ channel: 'game', ...ev }))

  const corsHeaders = (req) => {
    const origin = req.headers.origin
    return {
      ...(origin && isLocalOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Studio-Secret, Authorization',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'no-store',
    }
  }

  const sendJson = (req, res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(req) })
    res.end(JSON.stringify(data))
  }

  const authorized = (req, url) => {
    const presented = req.headers['x-studio-secret'] ?? url.searchParams.get('secret') ?? ''
    return safeEqual(String(presented), secret)
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (!isLocalHost(req.headers.host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        return res.end('loopback host only')
      }
      if (!isLocalOrigin(req.headers.origin)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        return res.end('foreign origin refused')
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req))
        return res.end()
      }
      if (url.pathname === '/studio/health' && req.method === 'GET') {
        return sendJson(req, res, 200, { ok: true, bridge: 'voxelwright-studio', version: 1 })
      }
      if (!authorized(req, url)) {
        return sendJson(req, res, 401, { error: 'Missing or invalid X-Studio-Secret' })
      }

      // ── MCP Streamable HTTP endpoint (voxelwright-game) ──
      if (url.pathname === '/mcp' && req.method === 'POST') {
        const body = await readJson(req)
        const reply = await mcp.handleJsonRpc(body)
        if (reply === null) {
          res.writeHead(204, corsHeaders(req))
          return res.end()
        }
        return sendJson(req, res, 200, reply)
      }

      // ── Studio Status ──
      if (url.pathname === '/studio/status' && req.method === 'GET') {
        const localT3 = await discoverLocalT3Server(t3StateDir).catch(() => null)
        return sendJson(req, res, 200, {
          ok: true,
          bridgeUrl: `http://127.0.0.1:${server.address().port}`,
          gameUrl,
          environments: t3.list(),
          activeEnvironmentId: t3.activeEnvironmentId,
          localT3: localT3 ? { origin: localT3.origin, label: localT3.descriptor?.label ?? 'Local T3 Code', environmentId: localT3.descriptor?.environmentId ?? null, serverVersion: localT3.serverVersion } : null,
          sessions: hub.listSessions(),
          extensionTools: hub.listExtensionTools(),
        })
      }

      // ── T3 Code Environments & Pairing ──
      if (url.pathname === '/studio/api/t3/environments' && req.method === 'GET') {
        return sendJson(req, res, 200, { environments: t3.list(), activeEnvironmentId: t3.activeEnvironmentId })
      }
      if (url.pathname === '/studio/api/t3/discover' && req.method === 'GET') {
        const local = await discoverLocalT3Server(t3StateDir)
        return sendJson(req, res, 200, { local })
      }
      if (url.pathname === '/studio/api/t3/auto-connect' && req.method === 'POST') {
        const summary = await t3.autoConnectLocal({ stateDir: t3StateDir, t3Bin })
        return sendJson(req, res, 200, { environment: summary, environments: t3.list() })
      }
      if (url.pathname === '/studio/api/t3/pair' && req.method === 'POST') {
        const body = await readJson(req)
        const summary = body.accessToken && body.httpBaseUrl
          ? await t3.connectDirect(body)
          : await t3.pair(body)
        return sendJson(req, res, 200, { environment: summary, environments: t3.list() })
      }
      if (url.pathname === '/studio/api/t3/active' && req.method === 'POST') {
        const body = await readJson(req)
        t3.setActive(body.environmentId)
        return sendJson(req, res, 200, { activeEnvironmentId: t3.activeEnvironmentId, environments: t3.list() })
      }
      if (url.pathname === '/studio/api/t3/environment' && req.method === 'DELETE') {
        const envId = url.searchParams.get('environmentId')
        const removed = await t3.remove(envId)
        return sendJson(req, res, 200, { removed, environments: t3.list() })
      }

      // ── Generic T3 RPC / HTTP passthroughs (covers 100% of T3 Code iOS endpoints) ──
      if (url.pathname === '/studio/api/t3/rpc' && req.method === 'POST') {
        const body = await readJson(req)
        const client = t3.get(body.environmentId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const result = await client.call(body.method, body.payload ?? {}, { timeoutMs: body.timeoutMs ?? 30_000 })
        return sendJson(req, res, 200, { ok: true, result })
      }
      if (url.pathname === '/studio/api/t3/http' && req.method === 'POST') {
        const body = await readJson(req)
        const client = t3.get(body.environmentId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const result = await client.httpJson(body.method ?? 'GET', body.path, {
          body: body.body,
          orchestration: body.orchestration === true || String(body.path ?? '').startsWith('/api/orchestration'),
        })
        return sendJson(req, res, 200, { ok: true, result })
      }

      // ── High-level T3 Thread Launch & Bug Dispatch (with attachment upload + UnknownContextRecord) ──
      if (url.pathname === '/studio/api/t3/launch-thread' && req.method === 'POST') {
        const body = await readJson(req)
        const client = t3.get(body.environmentId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const uploaded = []
        const contextRecords = [...(Array.isArray(body.contextRecords) ? body.contextRecords : [])]
        for (const file of Array.isArray(body.files) ? body.files : []) {
          const rawBytes = Buffer.from(String(file.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64')
          const att = await client.uploadAttachment({
            name: file.name,
            mimeType: file.mimeType,
            bytes: rawBytes,
            type: file.type,
          })
          uploaded.push({
            id: att.attachmentId,
            type: att.type,
            name: att.name,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
          })
          contextRecords.push({
            kind: att.type === 'image' ? 'image' : 'file',
            label: file.label || att.name,
            attachmentId: att.attachmentId,
            name: att.name,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
          })
        }
        const resLaunch = await client.launchThread({
          projectId: body.projectId,
          title: body.title,
          text: body.text,
          contextRecords,
          attachments: uploaded,
          modelSelection: body.modelSelection,
          runtimeMode: body.runtimeMode ?? 'auto',
          interactionMode: body.interactionMode ?? 'default',
          workspaceStrategy: body.workspaceStrategy,
        })
        return sendJson(req, res, 200, { ok: true, result: resLaunch, attachments: uploaded })
      }

      if (url.pathname === '/studio/api/t3/send-message' && req.method === 'POST') {
        const body = await readJson(req)
        const client = t3.get(body.environmentId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const uploaded = []
        const contextRecords = [...(Array.isArray(body.contextRecords) ? body.contextRecords : [])]
        for (const file of Array.isArray(body.files) ? body.files : []) {
          const rawBytes = Buffer.from(String(file.dataBase64).replace(/^data:[^;]+;base64,/, ''), 'base64')
          const att = await client.uploadAttachment({ name: file.name, mimeType: file.mimeType, bytes: rawBytes, type: file.type })
          uploaded.push({ id: att.attachmentId, type: att.type, name: att.name, mimeType: att.mimeType, sizeBytes: att.sizeBytes })
          contextRecords.push({ kind: att.type === 'image' ? 'image' : 'file', label: file.label || att.name, attachmentId: att.attachmentId, name: att.name, mimeType: att.mimeType, sizeBytes: att.sizeBytes })
        }
        const result = await client.dispatchMessage({
          threadId: body.threadId,
          text: body.text,
          contextRecords,
          attachments: uploaded,
          modelSelection: body.modelSelection,
          dispatchMode: body.dispatchMode,
          deliveryIntent: body.deliveryIntent,
          freshContext: body.freshContext,
        })
        return sendJson(req, res, 200, { ok: true, result, attachments: uploaded })
      }

      // ── Binary attachment upload ──
      if (url.pathname === '/studio/api/t3/upload' && req.method === 'POST') {
        const envId = url.searchParams.get('environmentId')
        const name = url.searchParams.get('name') || 'capture.png'
        const mimeType = req.headers['content-type'] || url.searchParams.get('mimeType') || 'application/octet-stream'
        const client = t3.get(envId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const bytes = await readBody(req)
        const att = await client.uploadAttachment({ name, mimeType, bytes })
        return sendJson(req, res, 200, { ok: true, attachment: att })
      }

      // ── CORP-safe T3 signed asset proxy (solves COEP: require-corp in game page!) ──
      if (url.pathname === '/studio/api/t3/asset' && req.method === 'GET') {
        const envId = url.searchParams.get('environmentId')
        const assetPath = url.searchParams.get('path')
        const client = t3.get(envId)
        if (!client || !assetPath) return sendJson(req, res, 400, { error: 'environmentId and path required' })
        // Only allow relative T3 asset paths or URLs on the paired environment's exact origin
        const target = assetPath.startsWith('/') ? `${client.httpBaseUrl}${assetPath}` : assetPath
        if (new URL(target).origin !== new URL(client.httpBaseUrl).origin) {
          return sendJson(req, res, 403, { error: 'Asset URL origin mismatch' })
        }
        const upstream = await client.httpRaw('GET', target)
        const buf = Buffer.from(await upstream.arrayBuffer())
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'private, max-age=300',
          ...corsHeaders(req),
        })
        return res.end(buf)
      }

      // ── Voice transcription proxy (/api/voice/transcribe) ──
      if (url.pathname === '/studio/api/t3/voice/transcribe' && req.method === 'POST') {
        const envId = url.searchParams.get('environmentId')
        const cloudProvider = url.searchParams.get('provider') || undefined
        const model = url.searchParams.get('model') || undefined
        const client = t3.get(envId)
        if (!client) return sendJson(req, res, 404, { error: 'No T3 environment connected' })
        const bytes = await readBody(req)
        const result = await client.transcribeVoice(bytes, {
          contentType: req.headers['content-type'] || 'audio/webm',
          cloudProvider,
          model,
        })
        return sendJson(req, res, 200, { ok: true, result })
      }

      // ── Game Hub REST API (for scripts, CI, and UI actions) ──
      if (url.pathname === '/studio/api/game/sessions' && req.method === 'GET') {
        return sendJson(req, res, 200, { sessions: hub.listSessions(), extensionTools: hub.listExtensionTools() })
      }
      if (url.pathname === '/studio/api/game/spawn' && req.method === 'POST') {
        const body = await readJson(req)
        const session = await hub.spawnHeadless(body)
        return sendJson(req, res, 200, { ok: true, session })
      }
      if (url.pathname === '/studio/api/game/close' && req.method === 'POST') {
        const body = await readJson(req)
        const result = await hub.closeSession(body.sessionId, { agentId: body.agentId ?? '*' })
        return sendJson(req, res, 200, { ok: true, result })
      }
      if (url.pathname === '/studio/api/game/invoke' && req.method === 'POST') {
        const body = await readJson(req)
        const result = await hub.invoke(body)
        return sendJson(req, res, 200, { ok: true, result })
      }
      if (url.pathname === '/studio/api/game/control' && req.method === 'POST') {
        const body = await readJson(req)
        const s = hub.getSession(body.sessionId)
        if (!s) return sendJson(req, res, 404, { error: 'Session not found' })
        const control = body.action === 'release'
          ? await s.control.releaseHuman(body.viewerId ?? '*')
          : s.control.takeHuman(body.viewerId ?? 'human')
        return sendJson(req, res, 200, { ok: true, control })
      }
      if (url.pathname === '/studio/api/game/regression-test' && req.method === 'POST') {
        const body = await readJson(req)
        const slug = String(body.slug || 'bug-regression').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'bug-regression'
        const source = buildRegressionTestSource({ slug, title: body.title, bookmark: body.bookmark, assert: body.assert })
        return sendJson(req, res, 200, { ok: true, filename: `engine/test/${slug}.mjs`, source })
      }

      // ── Worktree Verification & Live core.wasm Hot-Swap ──
      if (url.pathname === '/studio/api/worktree/list' && req.method === 'GET') {
        return sendJson(req, res, 200, { worktrees: await hub.listWorktrees() })
      }
      if (url.pathname === '/studio/api/worktree/verify' && req.method === 'POST') {
        const body = await readJson(req)
        const result = await hub.verifyWorktree(body)
        return sendJson(req, res, 200, { ok: true, result })
      }
      if (url.pathname === '/studio/api/worktree/core.wasm' && req.method === 'GET') {
        const wt = url.searchParams.get('worktree')
        if (!wt) return sendJson(req, res, 400, { error: 'worktree query parameter required' })
        const known = await hub.listWorktrees()
        const abs = resolve(wt)
        if (!known.some((w) => resolve(w.path) === abs)) {
          return sendJson(req, res, 403, { error: 'Not a registered git worktree of this repo' })
        }
        const wasmPath = join(abs, 'engine', 'page', 'core.wasm')
        if (!existsSync(wasmPath)) return sendJson(req, res, 404, { error: 'core.wasm not built in worktree' })
        const bytes = await readFile(wasmPath)
        res.writeHead(200, { 'Content-Type': 'application/wasm', ...corsHeaders(req) })
        return res.end(bytes)
      }

      // ── Context helper preview ──
      if (url.pathname === '/studio/api/context/preview' && req.method === 'POST') {
        const body = await readJson(req)
        return sendJson(req, res, 200, buildGameMessageContext(body))
      }

      sendJson(req, res, 404, { error: `Not found: ${url.pathname}` })
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 500
      if (!res.headersSent) sendJson(req, res, status, { error: err?.message ?? String(err) })
    }
  })

  // ── WebSocket Upgrades: `/studio/ws/t3` (Studio UI) and `/studio/ws/game` (Game Control Runtime) ──
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    if (!isLocalHost(req.headers.host) || !isLocalOrigin(req.headers.origin) || !authorized(req, url)) {
      return rejectUpgrade(socket, 403, 'Forbidden')
    }
    if (url.pathname === '/studio/ws/game') {
      const ws = acceptWebSocket(req, socket, head)
      if (!ws) return
      hub.attachSocket(ws, {
        sessionId: url.searchParams.get('session') || undefined,
        kind: url.searchParams.get('headless') === '1' ? 'headless' : 'live',
      })
      return
    }
    if (url.pathname === '/studio/ws/t3') {
      const ws = acceptWebSocket(req, socket, head)
      if (!ws) return
      uiSockets.add(ws)
      const subs = new Map()
      uiSubs.set(ws, subs)
      ws.sendJson({
        type: 'init',
        environments: t3.list(),
        activeEnvironmentId: t3.activeEnvironmentId,
        sessions: hub.listSessions(),
      })

      ws.on('message', async (raw) => {
        let msg
        try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) } catch { return }
        if (!msg || typeof msg !== 'object') return

        if (msg.type === 'rpc' && msg.id !== undefined) {
          const client = t3.get(msg.environmentId)
          if (!client) {
            ws.sendJson({ type: 'rpc.result', id: msg.id, ok: false, error: 'No T3 environment connected' })
            return
          }
          try {
            const result = await client.call(msg.method, msg.payload ?? {}, { timeoutMs: msg.timeoutMs ?? 30_000 })
            ws.sendJson({ type: 'rpc.result', id: msg.id, ok: true, result })
          } catch (err) {
            ws.sendJson({ type: 'rpc.result', id: msg.id, ok: false, error: err?.message ?? String(err) })
          }
          return
        }

        if (msg.type === 'subscribe' && msg.subId) {
          const client = t3.get(msg.environmentId)
          if (!client) {
            ws.sendJson({ type: 'sub.event', subId: msg.subId, event: { _streamError: 'No T3 environment connected' } })
            return
          }
          subs.get(msg.subId)?.()
          const unsub = client.subscribe(msg.method, msg.payload ?? {}, (event) => {
            ws.sendJson({ type: 'sub.event', subId: msg.subId, environmentId: client.environmentId, event })
          })
          subs.set(msg.subId, unsub)
          return
        }

        if (msg.type === 'unsubscribe' && msg.subId) {
          subs.get(msg.subId)?.()
          subs.delete(msg.subId)
        }
      })

      ws.on('close', () => {
        for (const unsub of subs.values()) unsub()
        subs.clear()
        uiSubs.delete(ws)
        uiSockets.delete(ws)
      })
      return
    }
    rejectUpgrade(socket, 404, 'Not Found')
  })

  await new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, '127.0.0.1', res)
  })

  const actualPort = server.address().port
  const url = `http://127.0.0.1:${actualPort}`
  hub.setBridgeInfo({ bridgeUrl: url, secret })

  await t3.load()
  if (autoConnectT3 && t3.list().length === 0) {
    void t3.autoConnectLocal({ stateDir: t3StateDir, t3Bin })
      .then((env) => say(`auto-connected to local T3 Code (${env.label})`))
      .catch(() => {})
  }

  if (writeRuntimeState) {
    await mkdir(dirname(BRIDGE_STATE_PATH), { recursive: true })
    await writeFile(
      BRIDGE_STATE_PATH,
      JSON.stringify({ version: 1, pid: process.pid, port: actualPort, url, secret, startedAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 },
    )
  }

  const link = `${gameUrl.replace(/\/$/, '')}/city?studio=1&fly=0#studio=${encodeURIComponent(url)}&secret=${encodeURIComponent(secret)}`

  const close = async () => {
    for (const ws of [...uiSockets]) ws.close(1001, 'shutdown')
    uiSockets.clear()
    await hub.closeAll()
    t3.dispose()
    if (writeRuntimeState) {
      await rm(BRIDGE_STATE_PATH, { force: true }).catch(() => {})
    }
    await new Promise((res) => { server.closeAllConnections?.(); server.close(res) })
  }

  return { url, port: actualPort, secret, link, t3, hub, mcp, server, close }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
  const bridge = await createStudioBridge({
    port: Number(flag('port', '5764')),
    gameUrl: flag('game', 'http://127.0.0.1:5740'),
    secret: flag('secret', undefined),
    autoConnectT3: !args.includes('--no-auto-t3'),
    say: (m) => console.log(`[studio] ${m}`),
  })
  console.log(`Voxelwright Studio Bridge listening on ${bridge.url} (loopback only)`)
  console.log(`MCP Streamable HTTP endpoint: ${bridge.url}/mcp`)
  console.log(`\nOpen the game with native T3 Studio + Game-Use enabled:\n\n  ${bridge.link}\n`)
  const shutdown = () => void bridge.close().finally(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
