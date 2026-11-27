// End-to-end verification for Voxelwright's Native In-Game T3 Studio, Game-Use MCP, & IDE (#98).
// Tests:
//   1. Protocol & security units: RFC 9449 ES256 DPoP signing/thumbprint, SessionControl human/agent
//      takeover & epoch invalidation, UnknownContextRecord (`game-*`) builder, static `sf/build.mjs`
//      zero-byte leakage proof, Studio Bridge origin & secret enforcement.
//   2. Full wire-protocol Mock T3 Code Server: descriptor, DPoP /oauth/token exchange, wsTicket,
//      Effect RPC JSON over /ws (including `\u001e` multi-part frame reassembly & Ack), attachment
//      upload, CORP-safe asset proxy, voice transcription, live thread launch & shell stream.
//   3. Real WebGPU Chrome — default page (`/city?fly=0`) loads ZERO studio modules or DOM.
//   4. Real WebGPU Chrome — Live Studio tab (`?studio=1#studio=...&secret=...`): secret stripped from
//      hash, collapsed corner pill clear of body, F2 Studio IDE drawer opens with live T3 threads &
//      IDE Lab extensions, F9 Bug-in-View captures non-blank canvas + 3D pick + trace and launches
//      a thread on the mock T3 server, human-vs-agent control takeover works live.
//   5. Real WebGPU Chrome — Headless Game-Use MCP (`voxelwright-game`): initialize, tools/list
//      (19 core + dynamic extension tools), game_session_spawn, game_status, game_snapshot (saved
//      non-blank PNG), game_frame (color + heat), game_pick, game_camera, game_world, game_debug,
//      game_perf, game_flight_recorder, game_assert, game_eval, dynamic extension tool, close.
//
// Pass `--shots <dir>` to also save full-size UI inspection PNGs (collapsed, drawer, lab, F9 bug).
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve } from './kit.mjs'
import { createStudioBridge } from '../studio/bridge.mjs'
import { createDpopProof, dpopThumbprint, generateDpopKeyPair, importDpopKeyPair, normalizeDpopHtu } from '../studio/dpop.mjs'
import { SessionControl } from '../studio/session-control.mjs'
import { buildGameMessageContext, SOCKET_FRAME_PART_PREFIX } from '../studio/t3-client.mjs'
import { acceptWebSocket } from '../studio/ws-server.mjs'

const failures = []
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shotsDir = arg('shots', '')
if (shotsDir) mkdirSync(shotsDir, { recursive: true })

const workDir = join(tmpdir(), `vw-studio-test-${process.pid}-${Date.now()}`)
mkdirSync(workDir, { recursive: true })

// ── 1. Pure Unit & Static-Boundary Checks ───────────────────────────────────
{
  const kp = await generateDpopKeyPair()
  const reloaded = await importDpopKeyPair(kp.privateJwk)
  check(kp.thumbprint === reloaded.thumbprint && kp.thumbprint.length > 20, 'DPoP ES256 keypair export/import preserves RFC 7638 thumbprint')
  check(dpopThumbprint(kp.publicJwk) === kp.thumbprint, 'dpopThumbprint matches keypair thumbprint')
  check(normalizeDpopHtu('wss://t3.local:3773/ws?foo=1') === 'https://t3.local:3773/ws', 'normalizeDpopHtu normalizes wss -> https and strips query')
  const proof = await createDpopProof(kp, { method: 'POST', url: 'http://127.0.0.1:3773/oauth/token?x=1', accessToken: 'tok_abc' })
  const [hdrB64, payB64, sigB64] = proof.split('.')
  const hdr = JSON.parse(Buffer.from(hdrB64, 'base64url').toString('utf8'))
  const pay = JSON.parse(Buffer.from(payB64, 'base64url').toString('utf8'))
  check(hdr.typ === 'dpop+jwt' && hdr.alg === 'ES256' && !!sigB64, 'DPoP proof JWT header & ES256 signature valid')
  check(pay.htm === 'POST' && pay.htu === 'http://127.0.0.1:3773/oauth/token' && typeof pay.ath === 'string' && pay.ath.length > 20, 'DPoP proof payload has htm/htu/ath')

  // SessionControl human/agent exclusivity & epoch invalidation
  const ctl = new SessionControl({ humanControlled: false })
  let agentBlocked = false
  let ranInside = false
  const genBefore = ctl.generation
  await ctl.agent('agent-1', async () => {
    ranInside = true
    check(ctl.generation === genBefore, 'SessionControl generation stable during agent turn')
    ctl.takeHuman('human')
    check(ctl.generation > genBefore, 'SessionControl takeHuman immediately increments generation epoch')
  })
  check(ranInside, 'SessionControl ran agent callback')
  try {
    await ctl.agent('agent-1', async () => {})
  } catch (e) {
    agentBlocked = e?.reason === 'humanControl'
  }
  check(agentBlocked, 'SessionControl rejects agent action while human holds control')
  await ctl.releaseHuman('human')
  let ranAfterRelease = false
  await ctl.agent('agent-2', async () => { ranAfterRelease = true })
  check(ranAfterRelease, 'SessionControl allows agent action after human releases control')

  // UnknownContextRecord (`game-*`) builder
  const built = buildGameMessageContext({
    text: 'Fix this roof seam',
    records: [
      { kind: 'game-frame', label: 'Market St', payload: { at: [1, 2, 3] } },
      { kind: 'game-pick', label: 'Cell [10,20,30]', payload: { cell: [10, 20, 30] } },
      { kind: 'game-huge', label: 'Oversized', payload: { blob: 'x'.repeat(70_000) } },
    ],
  })
  check(built.context?.records?.length === 3, 'buildGameMessageContext builds 3 UnknownContextRecords')
  check(built.text.includes('t3-context://v1/game-frame/') && built.text.includes('t3-context://v1/game-pick/'), 'buildGameMessageContext embeds t3-context://v1 links')
  check(built.context?.records?.[2]?.payload?.truncated === true, 'buildGameMessageContext truncates payloads >62 KB')

  // Public static bundle isolation check (`sf/build.mjs` regex MUST match zero studio modules!)
  const mainSrc = readFileSync(new URL('../page/main.ts', import.meta.url), 'utf8')
  const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
  const studioMatches = [...mainSrc.matchAll(NAMED)].filter((m) => m[3].includes('studio'))
  check(studioMatches.length === 0, 'sf/build.mjs NAMED import walker reaches 0 Studio files from page/main.ts')

  // Default MCP auto-registration across Claude Code, Antigravity, and Codex
  const repoRoot = new URL('../..', import.meta.url)
  const mcpJson = JSON.parse(readFileSync(new URL('.mcp.json', repoRoot), 'utf8'))
  const claudeSettings = JSON.parse(readFileSync(new URL('.claude/settings.json', repoRoot), 'utf8'))
  const agyMcp = JSON.parse(readFileSync(new URL('.agents/plugins/voxelwright-game/mcp_config.json', repoRoot), 'utf8'))
  const codexToml = readFileSync(new URL('.codex/config.toml', repoRoot), 'utf8')
  check(mcpJson.mcpServers?.['voxelwright-game']?.args?.[0] === 'engine/studio/mcp.mjs', '.mcp.json registers voxelwright-game MCP server')
  check(claudeSettings.enabledMcpjsonServers?.includes('voxelwright-game'), '.claude/settings.json auto-enables voxelwright-game MCP server')
  check(agyMcp.mcpServers?.['voxelwright-game']?.args?.[0] === 'engine/studio/mcp.mjs', '.agents/plugins/voxelwright-game/mcp_config.json enables Antigravity MCP')
  check(codexToml.includes('[mcp_servers.voxelwright-game]') && codexToml.includes('engine/studio/mcp.mjs'), '.codex/config.toml enables Codex MCP')

  // Verify `serve.mjs --studio` injects meta tag, boots loopback Studio Bridge, and protects /studio/bootstrap
  const studioSrv = await serve('/dev/null', ['--studio', '--studio-port', '0'])
  try {
    const html = await fetch(`${studioSrv.url}/city`).then((r) => r.text())
    check(html.includes('<meta name="vw-studio" content="1">'), 'serve.mjs --studio injects vw-studio bootstrap meta tag on /city')
    // Wait briefly for in-process Studio Bridge startup
    let boot = { active: false }
    for (let i = 0; i < 20 && !boot.active; i++) {
      boot = await fetch(`${studioSrv.url}/studio/bootstrap`).then((r) => r.json())
      if (!boot.active) await sleep(100)
    }
    check(boot.active === true && typeof boot.url === 'string' && typeof boot.secret === 'string', 'serve.mjs --studio exposes loopback /studio/bootstrap with live bridge URL & secret')
    const badBoot = await fetch(`${studioSrv.url}/studio/bootstrap`, { headers: { Origin: 'https://evil.example' } })
    check(badBoot.status === 403, `GET /studio/bootstrap rejects foreign Origin (${badBoot.status})`)
  } finally {
    studioSrv.stop()
  }
}

// ── 2. Start Mock T3 Code Server (full Effect RPC + DPoP + Upload + Asset + Voice) ──
const mockState = {
  uploadedAttachments: new Map(),
  launchedThreads: [],
  sentMessages: [],
  voiceCalls: 0,
  dpopVerifiedCount: 0,
  shellSubs: new Set(),
  threads: [
    {
      id: 'thr_demo_1',
      projectId: 'proj_vw',
      title: 'Fix Embarcadero streetlamp glow',
      status: 'running',
      branch: 'feature/98-t3-game-studio',
      worktreePath: process.cwd(),
      updatedAt: new Date().toISOString(),
      pendingApprovalCount: 1,
      messages: [
        { id: 'm1', role: 'user', text: 'Check the streetlamp glow near Embarcadero', createdAt: new Date().toISOString() },
        { id: 'm2', role: 'assistant', text: 'Inspecting shader uniforms in engine/page/march.ts.', createdAt: new Date().toISOString() },
      ],
      pendingApprovals: [
        { requestId: 'appr_1', toolName: 'run_command', summary: 'npm run typecheck' },
      ],
    },
  ],
  projects: [{ id: 'proj_vw', title: 'Voxelwright', workspaceRoot: process.cwd() }],
}

const mockT3 = createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const readBuf = async () => {
    const parts = []
    for await (const c of req) parts.push(c)
    return Buffer.concat(parts)
  }

  if ((u.pathname === '/.well-known/t3/environment' || u.pathname === '/api/environment/descriptor') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({
      environmentId: 'env_mock_t3',
      label: 'Mock T3 Code Server',
      serverVersion: '0.99.0-test',
      capabilities: { voice: true, preview: true, devices: true, workflows: true },
    }))
  }

  if (u.pathname === '/oauth/token' && req.method === 'POST') {
    if (req.headers.dpop) mockState.dpopVerifiedCount++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({
      access_token: 'mock_dpop_access_token_12345',
      token_type: req.headers.dpop ? 'DPoP' : 'Bearer',
      expires_in: 3600,
      scope: 'orchestration:read orchestration:operate',
    }))
  }

  if (u.pathname === '/api/auth/websocket-ticket/rpc' && req.method === 'POST') {
    if (String(req.headers.authorization || '').startsWith('DPoP ') && req.headers.dpop) mockState.dpopVerifiedCount++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ticket: 'mock_ws_ticket_xyz' }))
  }

  if (u.pathname === '/api/orchestration/shell' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ projects: mockState.projects, threads: mockState.threads }))
  }

  if (u.pathname.startsWith('/api/orchestration/threads/') && req.method === 'GET') {
    const tid = decodeURIComponent(u.pathname.split('/').pop() ?? '')
    const th = mockState.threads.find((t) => t.id === tid) ?? mockState.threads[0]
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ thread: th, messages: th.messages, pendingApprovals: th.pendingApprovals ?? [] }))
  }

  if (u.pathname.startsWith('/api/attachments/upload/') && req.method === 'POST') {
    const token = u.pathname.split('/').pop()
    const buf = await readBuf()
    mockState.uploadedAttachments.set(token, { bytes: buf, contentType: req.headers['content-type'] })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, id: token, sizeBytes: buf.length }))
  }

  if (u.pathname === '/api/assets/test-png' && req.method === 'GET') {
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
    res.writeHead(200, { 'Content-Type': 'image/png' })
    return res.end(tinyPng)
  }

  if (u.pathname === '/api/voice/transcribe' && req.method === 'POST') {
    await readBuf()
    mockState.voiceCalls++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ text: 'the roof clips near Market Street' }))
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: `mock 404: ${u.pathname}` }))
})

mockT3.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (u.pathname !== '/ws' || u.searchParams.get('wsTicket') !== 'mock_ws_ticket_xyz') {
    socket.destroy()
    return
  }
  const ws = acceptWebSocket(req, socket, head)
  if (!ws) return

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    if (msg._tag === 'Ping') { ws.sendJson({ _tag: 'Pong' }); return }
    if (msg._tag !== 'Request') return
    const { id, tag, payload } = msg

    const replySuccess = (value) => {
      const json = JSON.stringify({ _tag: 'Exit', requestId: id, exit: { _tag: 'Success', value } })
      // Exercise `\u001e` multi-part frame splitting for large responses!
      if (json.length > 2000 && u.searchParams.get('frameParts') === '1') {
        const half = Math.floor(json.length / 2)
        ws.send(`${SOCKET_FRAME_PART_PREFIX}${json.slice(0, half)}`)
        ws.send(json.slice(half))
      } else {
        ws.send(json)
      }
    }

    if (tag === 'orchestration.getShellSnapshot') {
      return replySuccess({
        projects: mockState.projects,
        threads: mockState.threads,
        padding: 'x'.repeat(2400), // forces `\u001e` frameParts=1 split & reassembly!
      })
    }
    if (tag === 'orchestration.subscribeShell') {
      mockState.shellSubs.add({ ws, id })
      ws.sendJson({ _tag: 'Chunk', requestId: id, values: [{ snapshot: { projects: mockState.projects, threads: mockState.threads } }] })
      return
    }
    if (tag === 'orchestration.getThreadSnapshot') {
      const th = mockState.threads.find((t) => t.id === payload?.threadId) ?? mockState.threads[0]
      return replySuccess({ thread: th, messages: th.messages, pendingApprovals: th.pendingApprovals ?? [] })
    }
    if (tag === 'orchestration.subscribeThread') {
      const th = mockState.threads.find((t) => t.id === payload?.threadId) ?? mockState.threads[0]
      ws.sendJson({ _tag: 'Chunk', requestId: id, values: [{ thread: th, messages: th.messages, pendingApprovals: th.pendingApprovals ?? [] }] })
      return
    }
    if (tag === 'orchestration.subscribeCommandOutput') {
      ws.sendJson({ _tag: 'Chunk', requestId: id, values: [{ chunk: 'typecheck ok\n' }] })
      return
    }
    if (tag === 'attachments.createUploadUrl') {
      const attId = `att_${mockState.uploadedAttachments.size + 1}`
      return replySuccess({
        attachmentId: attId,
        relativeUrl: `/api/attachments/upload/${attId}`,
      })
    }
    if (tag === 'orchestration.launchThread') {
      const tid = payload?.threadId || `thr_${Date.now()}`
      const created = {
        id: tid,
        projectId: payload?.projectId ?? 'proj_vw',
        title: payload?.title || 'Game Bug Thread',
        status: 'running',
        branch: 'feature/studio-fix',
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: payload?.initialMessage?.messageId ?? 'm_init',
            role: 'user',
            text: payload?.initialMessage?.text ?? '',
            context: payload?.initialMessage?.context,
            attachments: payload?.initialMessage?.attachments ?? [],
            createdAt: new Date().toISOString(),
          },
        ],
      }
      mockState.launchedThreads.push(payload)
      mockState.threads.unshift(created)
      for (const sub of mockState.shellSubs) {
        if (sub.ws.open) sub.ws.sendJson({ _tag: 'Chunk', requestId: sub.id, values: [{ type: 'thread.upsert', thread: created }] })
      }
      return replySuccess({ threadId: tid, thread: created })
    }
    if (tag === 'orchestration.dispatchCommand') {
      mockState.sentMessages.push(payload)
      return replySuccess({ ok: true, commandId: payload?.commandId })
    }
    return replySuccess({ ok: true, echoTag: tag })
  })
})

await new Promise((r) => mockT3.listen(0, '127.0.0.1', r))
const mockT3Port = mockT3.address().port
const mockT3Url = `http://127.0.0.1:${mockT3Port}`

// Start real engine serve.mjs, Studio Bridge, and shared WebGPU Chrome
const gameServer = await serve('/dev/null')
const bridge = await createStudioBridge({
  port: 0,
  gameUrl: gameServer.url,
  studioDir: join(workDir, 'studio-state'),
  capturesDir: join(workDir, 'captures'),
  writeRuntimeState: false,
  autoConnectT3: false,
})
const browser = await chrome()

const mcpCall = async (method, params = {}) => {
  const res = await fetch(`${bridge.url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Secret': bridge.secret },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`MCP ${method} error: ${json.error.message}`)
  return json.result
}

const mcpTool = async (name, args = {}) => {
  const r = await mcpCall('tools/call', { name, arguments: args })
  if (r.isError) throw new Error(r.content?.[0]?.text || `Tool ${name} failed`)
  const textPart = r.content?.find((c) => c.type === 'text')?.text
  return { raw: r, data: textPart ? JSON.parse(textPart) : null }
}

try {
  // ── 2b. Studio Bridge Security + Full Mock T3 Wire Protocol Tests ──────────
  const evilRes = await fetch(`${bridge.url}/studio/status`, {
    headers: { Origin: 'https://evil.example', 'X-Studio-Secret': bridge.secret },
  })
  check(evilRes.status === 403, `Studio Bridge rejects foreign Origin (${evilRes.status})`)

  const unauthRes = await fetch(`${bridge.url}/studio/status`)
  check(unauthRes.status === 401, `Studio Bridge rejects missing X-Studio-Secret (${unauthRes.status})`)

  const pairRes = await fetch(`${bridge.url}/studio/api/t3/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Secret': bridge.secret },
    body: JSON.stringify({ pairingUrl: `${mockT3Url}/pair#token=bootstrap_code_98` }),
  })
  const pairJson = await pairRes.json()
  check(pairRes.ok && pairJson.environment?.state === 'connected' && pairJson.environment?.tokenType === 'DPoP', 'Bridge paired with Mock T3 via ES256 DPoP & connected Effect RPC /ws')
  check(mockState.dpopVerifiedCount >= 2, `Mock T3 verified DPoP proofs on token exchange & wsTicket (${mockState.dpopVerifiedCount})`)

  // Verify `\u001e` multi-part frame reassembly on large shell snapshot
  const snapRes = await fetch(`${bridge.url}/studio/api/t3/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Secret': bridge.secret },
    body: JSON.stringify({ method: 'orchestration.getShellSnapshot', payload: {} }),
  })
  const snapJson = await snapRes.json()
  check(snapJson.ok && snapJson.result?.threads?.length === 1 && snapJson.result?.padding?.length === 2400, 'Effect RPC reassembled \\u001e multi-part frame cleanly')

  // Verify CORP-safe asset proxy (critical under COEP: require-corp)
  const assetRes = await fetch(`${bridge.url}/studio/api/t3/asset?path=${encodeURIComponent('/api/assets/test-png')}&secret=${encodeURIComponent(bridge.secret)}`)
  check(assetRes.status === 200 && assetRes.headers.get('cross-origin-resource-policy') === 'cross-origin', 'CORP-safe /studio/api/t3/asset proxy sets Cross-Origin-Resource-Policy: cross-origin')

  // Verify Voice Transcription proxy
  const voiceRes = await fetch(`${bridge.url}/studio/api/t3/voice/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm', 'X-Studio-Secret': bridge.secret },
    body: Buffer.from('fake-webm-audio'),
  })
  const voiceJson = await voiceRes.json()
  check(voiceRes.ok && voiceJson.result?.text === 'the roof clips near Market Street' && mockState.voiceCalls === 1, 'Voice transcription proxy round-trips audio to /api/voice/transcribe')

  // Verify Regression Test generator endpoint
  const regRes = await fetch(`${bridge.url}/studio/api/game/regression-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Secret': bridge.secret },
    body: JSON.stringify({ slug: 'roof-seam', title: 'Roof seam check', bookmark: { at: [10, 42, -8], look: [15, -10], hour: 12 } }),
  })
  const regJson = await regRes.json()
  check(regRes.ok && regJson.filename === 'engine/test/roof-seam.mjs' && regJson.source.includes('at=10,42,-8'), 'Regression test generator creates runnable engine/test/*.mjs')

  // ── 3. Default Game Page (NO ?studio=1) Loads ZERO Studio Code or DOM ──────
  const cleanCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const cleanPage = await cleanCtx.newPage()
  const studioRequests = []
  cleanPage.on('request', (req) => { if (req.url().includes('/studio/')) studioRequests.push(req.url()) })
  await cleanPage.goto(`${gameServer.url}/city?fly=0`, { waitUntil: 'domcontentloaded' })
  await cleanPage.waitForFunction(() => Boolean(globalThis.engine?.recorder), null, { timeout: 30_000 })
  await sleep(600)
  const cleanCheck = await cleanPage.evaluate(() => ({
    hasStudioGlobal: Boolean(globalThis.engine?.studio),
    studioPanels: document.querySelectorAll('[data-panel="studio"], [data-panel="studio-bug"]').length,
  }))
  check(!cleanCheck.hasStudioGlobal && cleanCheck.studioPanels === 0 && studioRequests.length === 0, 'Default /city?fly=0 loads 0 Studio modules, 0 Studio DOM, and 0 network requests')
  await cleanCtx.close()

  // ── 4. Live Studio Tab: UI, F2 IDE, F9 Bug-in-View, Human/Agent Takeover ───
  const liveCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const livePage = await liveCtx.newPage()
  const liveErrors = []
  livePage.on('pageerror', (e) => liveErrors.push(e.message))
  await livePage.goto(
    `${gameServer.url}/city?studio=1&fly=0#studio=${encodeURIComponent(bridge.url)}&secret=${encodeURIComponent(bridge.secret)}`,
    { waitUntil: 'domcontentloaded' },
  )
  await livePage.waitForFunction(() => Boolean(globalThis.engine?.studio && globalThis.engine.studio.bridge.connected), null, { timeout: 30_000 })
  await sleep(1200)

  const liveBoot = await livePage.evaluate(() => ({
    hashStripped: !location.hash.includes('secret='),
    sessionId: globalThis.engine.studio.sessionId,
    hasPill: Boolean(document.querySelector('[data-panel="studio"] .vw-studio-pill')),
    pillRect: document.querySelector('[data-panel="studio"] .vw-studio-pill')?.getBoundingClientRect().toJSON() ?? null,
    extCount: globalThis.engine.studio.registry.list().length,
  }))
  check(liveBoot.hashStripped, 'Studio immediately stripped secret from location.hash via history.replaceState')
  check(liveBoot.hasPill && liveBoot.pillRect && liveBoot.pillRect.top < 60 && liveBoot.pillRect.right <= 1280, 'Collapsed Studio pill renders cleanly in top-right corner')
  check(liveBoot.extCount >= 5, `All ${liveBoot.extCount} built-in StudioExtensions registered`)

  if (shotsDir) await livePage.screenshot({ path: join(shotsDir, 'studio-collapsed.png') })

  // Open Studio IDE Drawer via F2
  await livePage.keyboard.press('F2')
  await livePage.waitForSelector('[data-panel="studio"] .st-shell', { timeout: 5000 })
  await livePage.waitForSelector('[data-panel="studio"] .st-thread-row', { timeout: 8000 })
  const openState = await livePage.evaluate(() => {
    const tabsEl = document.querySelector('[data-panel="studio"] .st-tabs')
    return {
      open: globalThis.engine.studio.open,
      threadText: document.querySelector('[data-panel="studio"] .st-thread-row')?.textContent ?? '',
      tabs: [...document.querySelectorAll('[data-panel="studio"] .st-tab')].map((b) => b.textContent),
      tabsNoOverflow: tabsEl ? tabsEl.scrollWidth <= tabsEl.clientWidth + 1 : false,
    }
  })
  check(openState.open && openState.threadText.includes('Fix Embarcadero streetlamp glow'), 'F2 Studio IDE opens and streams live T3 threads from Mock T3 server')
  check(openState.tabs.length === 6 && openState.tabsNoOverflow, `Studio IDE renders all 6 tabs without horizontal clipping (${openState.tabs.join(', ')})`)

  if (shotsDir) await livePage.screenshot({ path: join(shotsDir, 'studio-open-threads.png') })

  // Switch to IDE Lab tab & verify extension panels
  await livePage.click('[data-panel="studio"] .st-tab[data-tab="lab"]')
  await sleep(400)
  await livePage.click('[data-panel="studio"] .st-pill:has-text("Render Lab")')
  await sleep(300)
  const labHasSliders = await livePage.locator('[data-panel="studio"] .st-slider').count()
  check(labHasSliders >= 5, `IDE Lab mounts Render Lab extension with ${labHasSliders} live controls`)
  if (shotsDir) await livePage.screenshot({ path: join(shotsDir, 'studio-ide-lab.png') })

  // Close Studio IDE (F2) & trigger F9 Bug-in-View -> fire T3 Fix Thread!
  await livePage.keyboard.press('F2')
  await sleep(250)
  await livePage.keyboard.press('F9')
  await livePage.waitForSelector('[data-panel="studio-bug"] .sb-card', { timeout: 8000 })
  await sleep(400)
  await livePage.fill('[data-panel="studio-bug"] textarea', 'Window reflection flicker near Embarcadero')
  if (shotsDir) await livePage.screenshot({ path: join(shotsDir, 'studio-f9-bug.png') })

  await livePage.click('[data-panel="studio-bug"] button.primary')
  await sleep(1000)
  check(mockState.launchedThreads.length === 1, 'F9 Bug-in-View launched a real T3 thread via Bridge')
  const launched = mockState.launchedThreads[0]
  const recKinds = (launched?.initialMessage?.context?.records ?? []).map((r) => r.kind)
  check(recKinds.includes('game-frame') && recKinds.includes('game-pick') && recKinds.includes('game-timeline') && recKinds.includes('image'), `F9 attached structured game context & PNG (${recKinds.join(', ')})`)
  check(mockState.uploadedAttachments.size >= 1, `F9 uploaded ${mockState.uploadedAttachments.size} binary PNG attachment(s) to Mock T3`)

  // Human vs Agent SessionControl handoff on the live tab
  const liveSessionId = liveBoot.sessionId
  let blockedWhileHuman = false
  try {
    await mcpTool('game_camera', { sessionId: liveSessionId, at: [25, 55, 25], look: [45, -15] })
  } catch (e) {
    blockedWhileHuman = String(e.message).toLowerCase().includes('human')
  }
  check(blockedWhileHuman, 'MCP game_camera is blocked while human controls live tab')

  // Release control -> agent drives live tab -> human presses key -> human retakes control!
  await livePage.evaluate(() => {
    globalThis.engine.studio.show(false)
    globalThis.engine.studio.bridge.releaseControl()
  })
  await sleep(250)
  const movedLive = await mcpTool('game_camera', { sessionId: liveSessionId, at: [25, 55, 25], look: [45, -15] })
  check(Math.abs(movedLive.data.bookmark.at[0] - 25) < 0.5, 'After releaseControl, MCP agent drives live user tab cleanly')

  await livePage.keyboard.press('KeyW')
  await sleep(300)
  const controlAfterKey = await livePage.evaluate(() => globalThis.engine.studio.bridge.control.humanInControl)
  check(controlAfterKey === true, 'Pressing KeyW on live tab automatically returns SessionControl to human')
  check(liveErrors.length === 0, `Zero uncaught page errors in live Studio tab (${liveErrors.join('; ')})`)

  // ── 5. Game-Use MCP (`voxelwright-game`) Full Tool Suite on Headless Chrome ─
  const initRes = await mcpCall('initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 'studio-test', version: '1' } })
  check(initRes.serverInfo?.name === 'voxelwright-game', 'MCP initialize returns voxelwright-game server')

  const listRes = await mcpCall('tools/list')
  const toolNames = listRes.tools.map((t) => t.name)
  check(toolNames.includes('game_session_spawn') && toolNames.includes('game_snapshot') && toolNames.includes('game_frame') && toolNames.includes('game_assert'), `MCP tools/list exposes ${toolNames.length} core + extension tools`)
  check(toolNames.includes('game_ext_voxel_inspector_sample_column') && toolNames.includes('game_ext_city_tiles_teleport_landmark'), 'MCP tools/list dynamically advertises StudioExtension gameTools')

  // Spawn dedicated headless WebGPU Chrome session via MCP!
  const spawned = await mcpTool('game_session_spawn', {
    url: `${gameServer.url}/city?fly=0`,
    width: 960,
    height: 540,
  })
  const headlessId = spawned.data.sessionId
  check(typeof headlessId === 'string' && spawned.data.kind === 'headless', `MCP game_session_spawn booted headless WebGPU Chrome (${headlessId})`)

  const stRes = await mcpTool('game_status', { sessionId: headlessId })
  check(stRes.data.headless === true && stRes.data.gpuFaults === 0, 'MCP game_status reports clean headless WebGPU state')

  const snapMcp = await mcpTool('game_snapshot', { sessionId: headlessId, includeImage: true, save: true })
  const hasImgPart = snapMcp.raw.content.some((c) => c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 500)
  const savedPngPath = snapMcp.data.screenshotPath
  check(hasImgPart && savedPngPath && existsSync(savedPngPath) && statSync(savedPngPath).size > 2000, `MCP game_snapshot returns inline PNG & saves non-blank file (${savedPngPath})`)

  const heatFrame = await mcpTool('game_frame', { sessionId: headlessId, mode: 'heat' })
  check(heatFrame.data.mode === 'heat' && heatFrame.raw.content.some((c) => c.type === 'image'), 'MCP game_frame(mode=heat) captures raymarch step heatmap')

  const pickMcp = await mcpTool('game_pick', { sessionId: headlessId, u: 0.5, v: 0.5 })
  check(Array.isArray(pickMcp.data.cell) && pickMcp.data.cell.length === 3, `MCP game_pick returns 3D voxel cell [${pickMcp.data.cell}]`)

  const camMcp = await mcpTool('game_camera', { sessionId: headlessId, at: [12, 46, -18], look: [30, -12], mode: 'flying' })
  check(Math.abs(camMcp.data.bookmark.at[0] - 12) < 0.5 && Math.abs(camMcp.data.bookmark.at[2] + 18) < 0.5, 'MCP game_camera teleports headless camera accurately')

  const worldMcp = await mcpTool('game_world', { sessionId: headlessId, hour: 17.5, rain: 0.25 })
  check(worldMcp.data.ok && Math.abs(worldMcp.data.bookmark.hour - 17.5) < 0.1, 'MCP game_world adjusts time of day & rain')

  const dbgMcp = await mcpTool('game_debug', { sessionId: headlessId, paused: true, stepFrames: 2 })
  check(dbgMcp.data.ok && dbgMcp.data.paused === true, 'MCP game_debug pauses & steps exact frames')
  await mcpTool('game_debug', { sessionId: headlessId, paused: false })

  const perfMcp = await mcpTool('game_perf', { sessionId: headlessId })
  check(typeof perfMcp.data.frameMs === 'number' && typeof perfMcp.data.scale === 'number', `MCP game_perf returns frame timing (${perfMcp.data.frameMs} ms)`)

  const recMcp = await mcpTool('game_flight_recorder', { sessionId: headlessId, maxKeyframes: 10 })
  check(recMcp.data.available === true && Array.isArray(recMcp.data.keyframes), `MCP game_flight_recorder returns trace (${recMcp.data.keyframes.length} kf)`)

  const assertMcp = await mcpTool('game_assert', { sessionId: headlessId, noGpuFaults: true, noCriticalAnomalies: true })
  check(assertMcp.data.passed === true, 'MCP game_assert passes on healthy headless session')

  const evalMcp = await mcpTool('game_eval', { sessionId: headlessId, expression: 'Math.round(engine.pose.x)' })
  check(evalMcp.data.value === 12, `MCP game_eval reads engine.pose.x (${evalMcp.data.value})`)

  // Dynamic StudioExtension MCP tool calls!
  const extCol = await mcpTool('game_ext_voxel_inspector_sample_column', { sessionId: headlessId, x: 0, z: 0 })
  check(typeof extCol.data.ground === 'number' && Array.isArray(extCol.data.samples), `Dynamic extension MCP tool sample_column works (ground=${extCol.data.ground})`)

  const extTp = await mcpTool('game_ext_city_tiles_teleport_landmark', { sessionId: headlessId, landmark: 'coit' })
  check(extTp.data.landmark === 'coit' && Math.abs(extTp.data.bookmark.at[0] + 420) < 1, 'Dynamic extension MCP tool teleport_landmark moves headless camera')

  const closedMcp = await mcpTool('game_session_close', { sessionId: headlessId })
  check(closedMcp.data.closed === true, 'MCP game_session_close tears down headless Chrome cleanly')

  await liveCtx.close()
} finally {
  await bridge.close()
  await browser.close()
  gameServer.stop()
  await new Promise((r) => mockT3.close(r))
  rmSync(workDir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\nstudio check FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nstudio check: all passed')
