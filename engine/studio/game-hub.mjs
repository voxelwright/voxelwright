// Unified Game Session Hub for live user browser tabs AND headless Playwright+WebGPU Chrome sessions (#98).
// Both live tabs and headless sessions connect to the exact same WebSocket control channel (`/studio/ws/game`)
// and obey `SessionControl` leases, so AI agents use the exact same Game-Use tools in interactive and headless runs.
// Also manages worktree preview servers and `core.wasm` / plugin hot-reload for 1-click "Verify Fix Here".
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GameControlInterruptedError, SessionControl } from './session-control.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(ENGINE_ROOT, '..')
export const DEFAULT_CAPTURES_DIR = join(homedir(), '.village', 'engine', 'studio', 'captures')

let cachedHeadlessRuntime = null

/**
 * Lazy-loads Playwright and the GPU-turn arbiter from `engine/test/kit.mjs`.
 * Fresh git worktrees often lack their own `engine/node_modules`, so when the local
 * import fails with ERR_MODULE_NOT_FOUND we fall back to the main checkout's
 * `engine/node_modules` and `engine/test/kit.mjs` via `git rev-parse --git-common-dir`.
 */
async function loadHeadlessRuntime() {
  if (cachedHeadlessRuntime) return cachedHeadlessRuntime
  try {
    const [{ chromium }, kit] = await Promise.all([
      import('playwright'),
      import('../test/kit.mjs'),
    ])
    cachedHeadlessRuntime = { chromium, CHROME: kit.CHROME, acquireGpuTurn: kit.turn }
    return cachedHeadlessRuntime
  } catch (localErr) {
    if (localErr?.code !== 'ERR_MODULE_NOT_FOUND') throw localErr
    let commonGitDir = ''
    try {
      commonGitDir = (await execAsync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO_ROOT })).trim()
    } catch { /* not a git worktree */ }
    if (!commonGitDir) throw localErr
    const mainRepoRoot = dirname(resolve(REPO_ROOT, commonGitDir))
    const fallbackPw = join(mainRepoRoot, 'engine', 'node_modules', 'playwright', 'index.mjs')
    const fallbackKit = join(mainRepoRoot, 'engine', 'test', 'kit.mjs')
    if (!existsSync(fallbackPw) || !existsSync(fallbackKit)) throw localErr
    const [{ chromium }, kit] = await Promise.all([
      import(pathToFileURL(fallbackPw).href),
      import(pathToFileURL(fallbackKit).href),
    ])
    cachedHeadlessRuntime = { chromium, CHROME: kit.CHROME, acquireGpuTurn: kit.turn }
    return cachedHeadlessRuntime
  }
}

const execAsync = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    execFile(cmd, args, { timeout: 120_000, maxBuffer: 4 << 20, ...opts }, (err, stdout, stderr) => {
      if (err) rej(new Error(String(stderr || err.message).slice(0, 400)))
      else res(stdout)
    })
  })

/** Finds a free ephemeral port for a worktree preview server by starting `serve.mjs --port 0`. */
function startEngineServer({ engineDir = ENGINE_ROOT, port = 0, extraArgs = [] } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(process.execPath, ['serve.mjs', '--port', String(port), ...extraArgs], {
      cwd: engineDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; child.kill('SIGTERM'); rejectStart(new Error(`serve.mjs timed out: ${out.slice(0, 200)}`)) }
    }, 15_000)
    const onChunk = (chunk) => {
      out += chunk.toString('utf8')
      const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(out)
      if (m && !done) {
        done = true
        clearTimeout(timer)
        resolveStart({
          url: m[1],
          process: child,
          close: () => new Promise((r) => {
            if (child.exitCode !== null) return r()
            child.once('exit', () => r())
            child.kill('SIGTERM')
            setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } r() }, 3000).unref?.()
          }),
        })
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.once('exit', (code) => {
      if (!done) { done = true; clearTimeout(timer); rejectStart(new Error(`serve.mjs exited ${code}: ${out.slice(0, 300)}`)) }
    })
  })
}

export class GameSessionHub {
  #sessions = new Map() // sessionId -> SessionRecord
  #worktreeServers = new Map() // worktreePath -> { url, close, startedAt, engineDir }
  #listeners = new Set()
  #capturesDir
  #defaultGameUrl
  #bridgeUrl
  #secret
  #nextReqId = 1

  constructor({
    capturesDir = DEFAULT_CAPTURES_DIR,
    defaultGameUrl = 'http://127.0.0.1:5740',
    bridgeUrl = null,
    secret = null,
  } = {}) {
    this.#capturesDir = capturesDir
    this.#defaultGameUrl = defaultGameUrl
    this.#bridgeUrl = bridgeUrl
    this.#secret = secret
  }

  setBridgeInfo({ bridgeUrl, secret }) {
    this.#bridgeUrl = bridgeUrl
    this.#secret = secret
  }

  onEvent(fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #emit(event) {
    for (const fn of this.#listeners) {
      try { fn(event) } catch { /* isolate */ }
    }
  }

  /** Lists all connected live tabs and headless sessions. */
  listSessions() {
    return [...this.#sessions.values()].map((s) => this.#summarize(s))
  }

  getSession(sessionId) {
    if (sessionId) return this.#sessions.get(sessionId) ?? null
    // Prefer an agent-owned headless session if requested implicitly? Otherwise latest live tab, else latest session.
    const all = [...this.#sessions.values()]
    return all.findLast((s) => s.kind === 'live') ?? all[all.length - 1] ?? null
  }

  #summarize(s) {
    return {
      sessionId: s.sessionId,
      kind: s.kind,
      connectedAt: s.connectedAt,
      lastSeenAt: s.lastSeenAt,
      url: s.meta.url ?? null,
      title: s.meta.title ?? null,
      realm: s.meta.realm ?? null,
      viewport: s.meta.viewport ?? null,
      worktreePath: s.meta.worktreePath ?? null,
      branch: s.meta.branch ?? null,
      control: s.control.status(),
      extensionTools: s.extensionTools,
    }
  }

  /** Aggregates all dynamic StudioExtension tools advertised by connected game sessions. */
  listExtensionTools() {
    const byName = new Map()
    for (const s of this.#sessions.values()) {
      for (const t of s.extensionTools) {
        if (!byName.has(t.name)) byName.set(t.name, { ...t, sessionId: s.sessionId })
      }
    }
    return [...byName.values()]
  }

  /** Registers an incoming WebSocket from a live browser tab or a spawned headless Chrome page. */
  attachSocket(ws, { sessionId: requestedId, kind = 'live', agentId = null } = {}) {
    const existing = requestedId ? this.#sessions.get(requestedId) : null
    const sessionId = existing ? existing.sessionId : (requestedId || `game_${randomUUID().slice(0, 8)}`)
    const control = existing?.control ?? new SessionControl({
      agentId,
      humanControlled: kind === 'live' && !agentId,
      onChange: (st) => {
        ws.sendJson({ type: 'control.state', control: st })
        this.#emit({ type: 'session.control', sessionId, control: st })
      },
    })

    const record = existing ?? {
      sessionId,
      kind,
      ws: null,
      control,
      meta: {},
      extensionTools: [],
      pending: new Map(),
      connectedAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      headless: null,
      readyResolvers: [],
    }
    record.ws = ws
    record.lastSeenAt = Date.now()
    this.#sessions.set(sessionId, record)

    ws.sendJson({ type: 'hello', sessionId, control: control.status() })

    ws.on('message', (raw) => {
      record.lastSeenAt = Date.now()
      let msg
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) } catch { return }
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'register') {
        record.meta = {
          ...record.meta,
          url: typeof msg.url === 'string' ? msg.url : record.meta.url,
          title: typeof msg.title === 'string' ? msg.title : record.meta.title,
          realm: typeof msg.realm === 'string' ? msg.realm : record.meta.realm,
          viewport: Array.isArray(msg.viewport) ? msg.viewport : record.meta.viewport,
          branch: typeof msg.branch === 'string' ? msg.branch : record.meta.branch,
        }
        if (Array.isArray(msg.tools)) {
          record.extensionTools = msg.tools
          this.#emit({ type: 'tools.changed', sessionId, tools: record.extensionTools })
        }
        for (const fn of record.readyResolvers.splice(0)) fn(record)
        this.#emit({ type: 'session.updated', session: this.#summarize(record) })
        return
      }

      if (msg.type === 'tools.update' && Array.isArray(msg.tools)) {
        record.extensionTools = msg.tools
        this.#emit({ type: 'tools.changed', sessionId, tools: record.extensionTools })
        return
      }

      if (msg.type === 'control.take') {
        control.takeHuman(msg.viewerId ?? 'human')
        return
      }

      if (msg.type === 'control.release') {
        void control.releaseHuman(msg.viewerId ?? 'human').catch(() => {})
        return
      }

      if (msg.type === 'human.activity') {
        if (record.kind === 'live') control.takeHuman('human')
        return
      }

      if (msg.type === 'event') {
        this.#emit({ type: 'game.event', sessionId, event: msg.event, detail: msg.detail })
        return
      }

      if (msg.type === 'response' && msg.id !== undefined) {
        const req = record.pending.get(String(msg.id))
        if (!req) return
        record.pending.delete(String(msg.id))
        clearTimeout(req.timer)
        if (msg.ok) req.resolve(msg.result)
        else req.reject(new Error(String(msg.error ?? 'Game command failed')))
      }
    })

    ws.on('close', () => {
      if (record.ws === ws) record.ws = null
      for (const [id, req] of record.pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Game tab disconnected'))
        record.pending.delete(id)
      }
      if (!record.headless) {
        void record.control.close()
        this.#sessions.delete(sessionId)
        this.#emit({ type: 'session.removed', sessionId })
      }
    })

    this.#emit({ type: 'session.added', session: this.#summarize(record) })
    return record
  }

  /** Sends one low-level RPC to a connected game session socket. */
  #sendCommand(record, op, params = {}, timeoutMs = 20_000) {
    if (!record.ws || !record.ws.open) {
      return Promise.reject(new Error(`Game session ${record.sessionId} is not connected.`))
    }
    const id = String(this.#nextReqId++)
    return new Promise((resolveCmd, rejectCmd) => {
      const timer = setTimeout(() => {
        if (record.pending.delete(id)) rejectCmd(new Error(`Game command "${op}" timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      record.pending.set(id, { resolve: resolveCmd, reject: rejectCmd, timer })
      record.ws.sendJson({ type: 'command', id, op, params })
    })
  }

  /**
   * Invokes a Game-Use operation on a live or headless session, enforcing `SessionControl`:
   * - `access: 'observe'` runs non-blocking even while the human drives.
   * - `access: 'act'` enforces exclusive ownership / no human in control, bumping cleanly on takeover.
   */
  async invoke({ sessionId, op, params = {}, access = 'observe', agentId = 'mcp', timeoutMs = 25_000 }) {
    const record = this.getSession(sessionId)
    if (!record) {
      throw new Error(
        sessionId
          ? `Game session "${sessionId}" was not found. Call game_session_list or game_session_spawn.`
          : 'No game session is connected. Open the game with ?studio=1 or call game_session_spawn.',
      )
    }
    const exec = async () => {
      if (op === 'eval' && record.headless?.page) {
        const expr = String(params.expression ?? '')
        const awaitPromise = params.awaitPromise !== false
        const wrapped = awaitPromise
          ? `(async () => { const engine = globalThis.engine; return await (${expr}); })()`
          : `(() => { const engine = globalThis.engine; return (${expr}); })()`
        const val = await record.headless.page.evaluate(wrapped)
        const serialized = JSON.stringify(val ?? null)
        if (serialized && serialized.length > 64_000) return { value: serialized.slice(0, 64_000), truncated: true }
        return { value: val ?? null }
      }
      return this.#sendCommand(record, op, params, timeoutMs)
    }
    if (access === 'observe') {
      return record.control.observe(exec)
    }
    // Notify the live page so it can show the subtle "Agent driving · Esc to take control" pill.
    if (record.ws?.open) {
      record.ws.sendJson({ type: 'agent.activity', agentId, op })
    }
    try {
      return await record.control.agent(agentId, exec, performance.now() + timeoutMs)
    } catch (err) {
      if (err instanceof GameControlInterruptedError) throw err
      throw err
    }
  }

  /** Saves a base64 PNG/WebP/WebM capture to disk and returns its absolute path. */
  async saveCapture(prefix, base64Data, ext = '.png') {
    await mkdir(this.#capturesDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(this.#capturesDir, `${prefix}-${stamp}-${randomUUID().slice(0, 6)}${ext}`)
    const clean = String(base64Data).replace(/^data:[^;]+;base64,/, '')
    await writeFile(file, Buffer.from(clean, 'base64'))
    return file
  }

  /**
   * Spawns a headless Playwright+WebGPU Chrome game session owned exclusively by `agentId`,
   * acquiring a GPU turn via engine/test/kit.mjs so concurrent runs never starve Metal/WebGPU.
   */
  async spawnHeadless({
    agentId = 'mcp',
    url,
    worktreePath,
    path = '/city',
    realm,
    at,
    look,
    hour,
    weather,
    flags,
    viewport = [1280, 720],
    waitSettled = true,
    timeoutMs = 45_000,
  } = {}) {
    if (!this.#bridgeUrl || !this.#secret) {
      throw new Error('Studio Bridge URL/secret not initialized before spawnHeadless.')
    }
    const sessionId = `headless_${randomUUID().slice(0, 8)}`
    let releaseTurn = () => {}
    let ownedServer = null
    let browser = null

    try {
      const { chromium, CHROME, acquireGpuTurn } = await loadHeadlessRuntime()
      releaseTurn = await acquireGpuTurn({ mine: false })
      let baseUrl = url
      if (!baseUrl) {
        if (worktreePath) {
          const wt = await this.ensureWorktreeServer(worktreePath)
          baseUrl = wt.url
        } else {
          // Reuse defaultGameUrl if reachable; otherwise spin up a private serve.mjs
          let reachable = false
          try {
            const probe = await fetch(this.#defaultGameUrl, { signal: AbortSignal.timeout(1500) })
            reachable = probe.ok || probe.status === 404
          } catch { /* not running */ }
          if (reachable) {
            baseUrl = this.#defaultGameUrl
          } else {
            ownedServer = await startEngineServer({ engineDir: ENGINE_ROOT, port: 0 })
            baseUrl = ownedServer.url
          }
        }
      }

      const target = new URL(path, baseUrl)
      target.searchParams.set('studio', '1')
      target.searchParams.set('headless', '1')
      target.searchParams.set('fly', '0')
      if (realm) target.searchParams.set('realm', realm)
      if (Array.isArray(at) && at.length === 3) target.searchParams.set('at', at.join(','))
      if (Array.isArray(look) && look.length === 2) target.searchParams.set('look', look.join(','))
      if (hour !== undefined) target.searchParams.set('hour', String(hour))
      if (weather) target.searchParams.set('weather', String(weather))
      if (flags !== undefined) target.searchParams.set('flags', String(flags))
      const hash = new URLSearchParams({
        studio: this.#bridgeUrl,
        secret: this.#secret,
        session: sessionId,
      })
      target.hash = hash.toString()

      const control = new SessionControl({ agentId, humanControlled: false })
      const record = {
        sessionId,
        kind: 'headless',
        ws: null,
        control,
        meta: { url: target.origin + target.pathname + target.search, worktreePath: worktreePath ?? null, viewport },
        extensionTools: [],
        pending: new Map(),
        connectedAt: new Date().toISOString(),
        lastSeenAt: Date.now(),
        headless: { browser: null, page: null, releaseTurn, ownedServer },
        readyResolvers: [],
      }
      this.#sessions.set(sessionId, record)

      let regTimer = null
      const registered = new Promise((res, rej) => {
        regTimer = setTimeout(() => rej(new Error(`Headless game did not connect to Studio Bridge within ${timeoutMs} ms`)), timeoutMs)
        record.readyResolvers.push(() => { clearTimeout(regTimer); regTimer = null; res(record) })
      })
      registered.catch(() => {})

      browser = await chromium.launch(CHROME)
      record.headless.browser = browser
      const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] } })
      const page = await context.newPage()
      record.headless.page = page
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(e.message))

      try {
        await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        await registered
      } finally {
        if (regTimer) { clearTimeout(regTimer); regTimer = null }
      }

      if (waitSettled) {
        await this.invoke({
          sessionId,
          op: 'waitFor',
          params: { settled: true, timeoutMs: Math.min(20_000, timeoutMs) },
          access: 'observe',
          agentId,
          timeoutMs: Math.min(25_000, timeoutMs),
        }).catch(() => {})
      }

      return {
        ...this.#summarize(record),
        pageErrors,
      }
    } catch (err) {
      this.#sessions.delete(sessionId)
      if (browser) await browser.close().catch(() => {})
      if (ownedServer) await ownedServer.close().catch(() => {})
      releaseTurn()
      throw err
    }
  }

  /** Closes an agent-owned headless session and releases its browser, server, and GPU turn. */
  async closeSession(sessionId, { agentId } = {}) {
    const record = this.#sessions.get(sessionId)
    if (!record) return { closed: false, reason: 'not_found' }
    if (record.kind !== 'headless') {
      return { closed: false, reason: 'cannot_close_live_user_tab' }
    }
    if (agentId && record.control.agentId && record.control.agentId !== agentId && agentId !== '*') {
      throw new GameControlInterruptedError('Cannot close a headless session owned by another agent.', 'agentMismatch')
    }
    this.#sessions.delete(sessionId)
    await record.control.close()
    try { record.ws?.close(1000, 'session closed') } catch { /* ignore */ }
    if (record.headless?.browser) await record.headless.browser.close().catch(() => {})
    if (record.headless?.ownedServer) await record.headless.ownedServer.close().catch(() => {})
    record.headless?.releaseTurn?.()
    this.#emit({ type: 'session.removed', sessionId })
    return { closed: true, sessionId }
  }

  /** Lists git worktrees in the repository so the in-game IDE can switch/verify any thread's branch. */
  async listWorktrees(repoRoot = REPO_ROOT) {
    const out = await execAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot })
    const items = []
    let cur = {}
    for (const line of out.split('\n')) {
      if (!line.trim()) {
        if (cur.path) items.push(cur)
        cur = {}
        continue
      }
      if (line.startsWith('worktree ')) cur.path = line.slice(9).trim()
      else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim()
      else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '').trim()
      else if (line === 'detached') cur.detached = true
    }
    if (cur.path) items.push(cur)
    return items.map((w) => ({
      ...w,
      previewUrl: this.#worktreeServers.get(w.path)?.url ?? null,
    }))
  }

  /** Ensures a worktree has a running `serve.mjs` preview server on an ephemeral loopback port. */
  async ensureWorktreeServer(worktreePath) {
    const abs = resolve(worktreePath)
    const existing = this.#worktreeServers.get(abs)
    if (existing && existing.process.exitCode === null) return existing
    const engineDir = join(abs, 'engine')
    if (!existsSync(join(engineDir, 'serve.mjs'))) {
      throw new Error(`Worktree does not contain engine/serve.mjs: ${abs}`)
    }
    if (!existsSync(join(engineDir, 'page', 'core.wasm'))) {
      await execAsync('node', ['core/build.mjs'], { cwd: engineDir })
    }
    const srv = await startEngineServer({ engineDir, port: 0 })
    const entry = { ...srv, worktreePath: abs, engineDir, startedAt: Date.now() }
    this.#worktreeServers.set(abs, entry)
    return entry
  }

  /**
   * 1-Click "Verify Fix Here" orchestration:
   * Inspects what changed in `worktreePath` vs `origin/main` and picks the fastest live verification path:
   * - `core/` only -> rebuilds `core.wasm` and hot-swaps via `engine.recore(url)` in place!
   * - `plugins/` only -> calls `POST /plugins/look` on the game server!
   * - `page/` / shaders / other -> starts/reuses a worktree preview server and returns its URL + bookmark!
   */
  async verifyWorktree({ worktreePath, sessionId, bookmark = null, forceServer = false }) {
    const abs = resolve(worktreePath)
    const engineDir = join(abs, 'engine')
    if (!existsSync(engineDir)) throw new Error(`Invalid worktree path: ${abs}`)

    let changed = []
    try {
      const committed = await execAsync('git', ['diff', '--name-only', 'origin/main...HEAD'], { cwd: abs })
      const dirty = await execAsync('git', ['diff', '--name-only', 'HEAD'], { cwd: abs })
      const untracked = await execAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: abs })
      changed = [...new Set(`${committed}\n${dirty}\n${untracked}`.split('\n').map((s) => s.trim()).filter(Boolean))]
    } catch { /* non-fatal */ }

    const coreOnly = !forceServer && changed.length > 0 && changed.every((f) => f.startsWith('engine/core/'))
    const pluginsOnly = !forceServer && changed.length > 0 && changed.every((f) => f.startsWith('engine/plugins/'))

    if (coreOnly) {
      await execAsync('node', ['core/build.mjs'], { cwd: engineDir })
      const wasmUrl = `${this.#bridgeUrl}/studio/api/worktree/core.wasm?worktree=${encodeURIComponent(abs)}&t=${Date.now()}`
      let recoreMs = null
      if (sessionId && this.#sessions.has(sessionId)) {
        const res = await this.invoke({ sessionId, op: 'debug', params: { recoreUrl: wasmUrl }, access: 'observe' })
        recoreMs = res?.recoreMs ?? null
      }
      return { mode: 'recore', worktreePath: abs, wasmUrl, recoreMs, changedFiles: changed, bookmark }
    }

    if (pluginsOnly) {
      let reloaded = false
      try {
        const r = await fetch(`${this.#defaultGameUrl}/plugins/look`, { method: 'POST', signal: AbortSignal.timeout(5000) })
        reloaded = r.ok
      } catch { /* fallback to server */ }
      if (reloaded) {
        return { mode: 'plugins', worktreePath: abs, reloaded: true, changedFiles: changed, bookmark }
      }
    }

    const srv = await this.ensureWorktreeServer(abs)
    const preview = new URL('/city', srv.url)
    preview.searchParams.set('studio', '1')
    preview.searchParams.set('fly', '0')
    if (bookmark?.at) preview.searchParams.set('at', bookmark.at.join(','))
    if (bookmark?.look) preview.searchParams.set('look', bookmark.look.join(','))
    if (bookmark?.hour !== undefined && bookmark?.hour !== null) preview.searchParams.set('hour', String(bookmark.hour))
    if (bookmark?.weather) preview.searchParams.set('weather', String(bookmark.weather))
    if (this.#bridgeUrl && this.#secret) {
      preview.hash = new URLSearchParams({ studio: this.#bridgeUrl, secret: this.#secret }).toString()
    }
    return {
      mode: 'server',
      worktreePath: abs,
      url: srv.url,
      openUrl: preview.toString(),
      changedFiles: changed,
      bookmark,
    }
  }

  async closeAll() {
    for (const id of [...this.#sessions.keys()]) {
      const s = this.#sessions.get(id)
      if (s?.kind === 'headless') await this.closeSession(id, { agentId: '*' })
      else {
        try { s?.ws?.close(1001, 'bridge closing') } catch { /* ignore */ }
        await s?.control?.close()
        this.#sessions.delete(id)
      }
    }
    for (const [k, srv] of this.#worktreeServers) {
      await srv.close().catch(() => {})
      this.#worktreeServers.delete(k)
    }
  }
}
