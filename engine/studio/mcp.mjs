#!/usr/bin/env node
// Voxelwright Game-Use MCP Server (`voxelwright-game`, MCP 2025-03-26 JSON-RPC 2.0) (#98).
// Gives any AI agent inside T3 Code (Claude, Codex, Antigravity, OpenCode, Cursor) direct native
// perception and control over Voxelwright — identically across live user tabs (with SessionControl
// human takeover) and headless Playwright+WebGPU Chrome sessions.
//
// Two transports, one handler:
//   1. Mounted directly on Studio Bridge at `POST /mcp` (Streamable HTTP, loopback only)
//   2. Standalone stdio MCP process (`node engine/studio/mcp.mjs [--bridge http://127.0.0.1:5764]`)
//      configured in `.mcp.json` — proxies to a running Studio Bridge or boots an embedded GameSessionHub
//      on demand so headless QA works even when no user game tab is open!
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_INFO = { name: 'voxelwright-game', version: '1.0.0' }
export const BRIDGE_STATE_PATH = join(homedir(), '.village', 'engine', 'studio', 'bridge-runtime.json')

export const CORE_GAME_TOOLS = [
  {
    name: 'game_session_list',
    description: 'List all connected Voxelwright game sessions (live user browser tabs and headless Chrome instances), showing owner/control lease, URL, realm, viewport, and dynamic extension tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'game_session_spawn',
    description: 'Launch an isolated headless WebGPU Chrome session of Voxelwright (arbitrated via engine/test/kit.mjs GPU turns) owned exclusively by this agent. Optionally point at a git worktree, realm, camera pose, time, and weather.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional explicit game server base URL (e.g. http://127.0.0.1:5760).' },
        worktreePath: { type: 'string', description: 'Optional absolute git worktree path to serve and test.' },
        path: { type: 'string', description: 'Page path, default "/city".' },
        realm: { type: 'string', description: 'Optional realm id.' },
        at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Starting position [x, y, z] in metres.' },
        look: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Starting camera [yaw, pitch] in degrees.' },
        hour: { type: 'number', description: 'Optional time of day (0-24).' },
        weather: { type: 'string', enum: ['clear', 'overcast', 'fog', 'rain'] },
        viewport: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Viewport [width, height], default [1280, 720].' },
        waitSettled: { type: 'boolean', description: 'Wait for initial world sectors to settle (default true).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_session_close',
    description: 'Close an agent-owned headless game session and release its browser and GPU turn.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'game_status',
    description: 'Read compact live status of a game session (control owner, camera pose, movement mode, speed, active tool, realm, settling state, FPS, GPU/CPU ms, anomaly and GPU fault counts). Safe while human is playing.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'game_snapshot',
    description: 'Capture a semantic 3D snapshot of the game (like preview_snapshot, native to Voxelwright): camera pose, player/vehicle state, nearby entities/vehicles/things/signs with stable ref handles, HUD state, active recorder anomalies, GPU/console diagnostics, and optional screenshot PNG (includeImage=true or save=true). Safe while human is playing.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        includeImage: { type: 'boolean', description: 'Include PNG image content block for multimodal inspection (default false).' },
        save: { type: 'boolean', description: 'Write PNG to disk and return screenshotPath (default false).' },
        radiusM: { type: 'number', description: 'Entity search radius in metres (default 80).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_frame',
    description: 'Render and capture a game frame PNG: normal canvas, raymarch step heatmap (mode="heat"), or building/surface segmentation (mode="farIds"). Supports save=true and includeImage=true.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        mode: { type: 'string', enum: ['color', 'heat', 'farIds'], description: 'Capture mode (default "color").' },
        includeImage: { type: 'boolean' },
        save: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_pick',
    description: '3D ray-pick into the voxel world at normalized screen coordinates (u, v in 0..1; default center crosshair 0.5, 0.5). Returns exact voxel cell [x,y,z], distance, material kind, color, geo (tile, street, latLon), building id, and nearest vehicle/entity.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        u: { type: 'number', minimum: 0, maximum: 1, description: 'Horizontal screen fraction (0=left, 1=right, default 0.5).' },
        v: { type: 'number', minimum: 0, maximum: 1, description: 'Vertical screen fraction (0=top, 1=bottom, default 0.5).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_camera',
    description: 'Move or aim the camera/player in the game: teleport to at=[x,y,z] (metres), set look=[yaw,pitch] (degrees), lookAt=[x,y,z], set fov, or restore a saved bookmark. Requires agent control (not human-controlled).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        look: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        lookAt: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        fov: { type: 'number' },
        mode: { type: 'string', enum: ['flying', 'foot'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_act',
    description: 'Send native player/vehicle input to the game: press key, hold/release key for durationMs, turn camera lookDelta=[rightRad,upRad], pickTool (index or name), use tool, summonCar, mount/dismount, castSpell, or click a HUD selector. Requires agent control.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['press', 'hold', 'release', 'lookDelta', 'pickTool', 'use', 'summonCar', 'castSpell', 'clickHud', 'say'] },
        code: { type: 'string', description: 'KeyboardEvent.code (e.g. KeyW, Space, KeyE, KeyG, Digit1).' },
        durationMs: { type: 'number', description: 'Hold duration in ms for press/hold.' },
        delta: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[right, up] radians for lookDelta.' },
        tool: { description: 'Tool index (number) or tool name (string) for pickTool.' },
        spell: { type: 'string', description: 'Spell name for castSpell.' },
        selector: { type: 'string', description: 'CSS selector for clickHud.' },
        text: { type: 'string', description: 'Text for say.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'game_world',
    description: 'Mutate world environment or voxels: set hour, weather, rain, fog, graphics preset, resolution scale, blast/place/cut/ignite/set cells, or reset world. Requires agent control.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        hour: { type: ['number', 'null'] },
        weather: { type: 'string', enum: ['clear', 'overcast', 'fog', 'rain'] },
        rain: { type: 'number', minimum: 0, maximum: 1 },
        fog: { type: 'number', minimum: 0, maximum: 1 },
        graphics: { type: 'string', enum: ['low', 'medium', 'high'] },
        scale: { type: 'number', minimum: 0.25, maximum: 2 },
        op: { type: 'string', enum: ['blast', 'strike', 'ignite', 'place', 'cut', 'set', 'reset'] },
        at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Voxel cell [x,y,z] for edit ops.' },
        radius: { type: 'number' },
        kind: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_debug',
    description: 'Control engine debug flags and hot-reload: pause/resume rendering, step N frames, toggle shadows/mirrors/heat/flags, hot-swap core.wasm via recoreUrl, or trigger plugin reload.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        paused: { type: 'boolean' },
        stepFrames: { type: 'integer', minimum: 1, maximum: 120 },
        shadows: { type: 'boolean' },
        mirrors: { type: 'boolean' },
        heat: { type: 'boolean' },
        flags: { type: 'integer' },
        recoreUrl: { type: 'string', description: 'URL of newly built core.wasm to hot-swap in place.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_perf',
    description: 'Read live CPU/GPU/frame timings, world sector cache/pool pressure, and optionally run paced() or passes() GPU timestamp benchmarks.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        benchmark: { type: 'boolean', description: 'Run engine.paced() / engine.passes() GPU measurement (pauses rendering briefly).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_flight_recorder',
    description: 'Read the built-in black-box flight recorder (engine.recorder): last 30s of 5 Hz keyframes, discrete events, replay edits, all 16 passive anomaly detectors, and session summary.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        maxKeyframes: { type: 'integer', minimum: 1, maximum: 200 },
        includeEvents: { type: 'boolean' },
        includeAnomalies: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_wait_for',
    description: 'Wait until game conditions match: settled=true (!engine.settling), nearPose={at, radiusM}, mode, minFps, or a JS predicate expression.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        settled: { type: 'boolean' },
        mode: { type: 'string', enum: ['flying', 'foot', 'riding'] },
        minFps: { type: 'number' },
        expression: { type: 'string', description: 'JS boolean expression evaluated with `engine` in scope.' },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 60000 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_record_start',
    description: 'Start recording a WebM video clip of the WebGPU canvas synchronized with flight-recorder telemetry.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        fps: { type: 'integer', minimum: 5, maximum: 60 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_record_stop',
    description: 'Stop canvas recording, save the WebM clip to disk, and return its absolute videoPath and synchronized telemetry summary.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'game_assert',
    description: 'Verify structured game invariants in one call: zero GPU faults, zero critical anomalies, frameMs under budget, settled sectors, HUD clear of character box, or custom pose bounds.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        noGpuFaults: { type: 'boolean' },
        noCriticalAnomalies: { type: 'boolean' },
        maxFrameMs: { type: 'number' },
        hudClearOfBody: { type: 'boolean' },
        settled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'game_eval',
    description: 'Evaluate a bounded JavaScript expression in the game page with `engine` in scope (returns JSON-serializable value up to 64 KB). Requires agent control; refused when human drives.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        expression: { type: 'string' },
        awaitPromise: { type: 'boolean' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'game_worktree_verify',
    description: 'Prepare live verification of a git worktree: hot-swaps core.wasm in place if only core/ changed, reloads plugins if only plugins/ changed, or boots a worktree preview server and returns its URL.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: { type: 'string' },
        sessionId: { type: 'string' },
        forceServer: { type: 'boolean' },
      },
      required: ['worktreePath'],
      additionalProperties: false,
    },
  },
]

const jsonContent = (obj) => ({
  content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  structuredContent: obj,
})

const errorResult = (err) => ({
  isError: true,
  content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
})

/** Creates a reusable MCP JSON-RPC 2.0 handler backed directly by a GameSessionHub. */
export function createMcpHandler(hub, { agentId = 'mcp' } = {}) {
  async function listTools() {
    const dynamicTools = hub.listExtensionTools().map((t) => ({
      name: t.name,
      description: t.description || `Studio extension tool (${t.extensionId})`,
      inputSchema: t.schema ?? { type: 'object', properties: {} },
    }))
    return [...CORE_GAME_TOOLS, ...dynamicTools]
  }

  async function callTool(name, args = {}) {
    try {
      if (name === 'game_session_list') {
        return jsonContent({ sessions: hub.listSessions() })
      }
      if (name === 'game_session_spawn') {
        const res = await hub.spawnHeadless({ ...args, agentId })
        return jsonContent(res)
      }
      if (name === 'game_session_close') {
        const res = await hub.closeSession(args.sessionId, { agentId })
        return jsonContent(res)
      }
      if (name === 'game_worktree_verify') {
        const res = await hub.verifyWorktree(args)
        return jsonContent(res)
      }

      // Dynamic StudioExtension tool dispatch
      const dyn = hub.listExtensionTools().find((t) => t.name === name)
      if (dyn) {
        const res = await hub.invoke({
          sessionId: args.sessionId ?? dyn.sessionId,
          op: 'extensionTool',
          params: { name, args },
          access: dyn.access === 'act' ? 'act' : 'observe',
          agentId,
        })
        return jsonContent(typeof res === 'object' && res !== null ? res : { value: res })
      }

      const route = {
        game_status: { op: 'status', access: 'observe' },
        game_snapshot: { op: 'snapshot', access: 'observe' },
        game_frame: { op: 'frame', access: 'observe' },
        game_pick: { op: 'pick', access: 'observe' },
        game_camera: { op: 'camera', access: 'act' },
        game_act: { op: 'act', access: 'act' },
        game_world: { op: 'world', access: 'act' },
        game_debug: { op: 'debug', access: 'act' },
        game_perf: { op: 'perf', access: 'observe' },
        game_flight_recorder: { op: 'flightRecorder', access: 'observe' },
        game_wait_for: { op: 'waitFor', access: 'observe' },
        game_record_start: { op: 'recordStart', access: 'act' },
        game_record_stop: { op: 'recordStop', access: 'act' },
        game_assert: { op: 'assert', access: 'observe' },
        game_eval: { op: 'eval', access: 'act' },
      }[name]

      if (!route) return errorResult(`Unknown MCP tool: ${name}`)

      const { sessionId, ...params } = args ?? {}
      const raw = await hub.invoke({
        sessionId,
        op: route.op,
        params,
        access: route.access,
        agentId,
        timeoutMs: Math.max(25_000, Number(params.timeoutMs ?? 0) + 5000),
      })

      // Handle image/video binary persistence & multimodal image blocks cleanly.
      const content = []
      const payload = raw && typeof raw === 'object' ? { ...raw } : { value: raw }

      if ((name === 'game_snapshot' || name === 'game_frame') && typeof payload.imageBase64 === 'string') {
        const mimeType = payload.imageMimeType || 'image/png'
        const ext = mimeType.includes('webp') ? '.webp' : '.png'
        if (params.save) {
          payload.screenshotPath = await hub.saveCapture(name.replace('game_', ''), payload.imageBase64, ext)
        }
        const b64 = payload.imageBase64.replace(/^data:[^;]+;base64,/, '')
        delete payload.imageBase64
        delete payload.imageMimeType
        const wantImage = name === 'game_frame' ? params.includeImage !== false : Boolean(params.includeImage)
        if (wantImage) {
          content.push({ type: 'image', data: b64, mimeType })
        }
      }

      if (name === 'game_record_stop' && typeof payload.videoBase64 === 'string') {
        payload.videoPath = await hub.saveCapture('recording', payload.videoBase64, '.webm')
        delete payload.videoBase64
      }

      content.unshift({ type: 'text', text: JSON.stringify(payload, null, 2) })
      return { content, structuredContent: payload }
    } catch (err) {
      return errorResult(err)
    }
  }

  async function handleJsonRpc(msg) {
    if (!msg || typeof msg !== 'object') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
    }
    const { id, method, params } = msg
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return null
    }
    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: true } },
            serverInfo: MCP_SERVER_INFO,
          },
        }
      }
      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} }
      }
      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: await listTools() } }
      }
      if (method === 'tools/call') {
        const res = await callTool(params?.name, params?.arguments ?? {})
        return { jsonrpc: '2.0', id, result: res }
      }
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }
    }
  }

  return { handleJsonRpc, listTools, callTool }
}

/** Reads running Studio Bridge info from ~/.village/engine/studio/bridge-runtime.json if alive. */
function discoverRunningBridge() {
  if (!existsSync(BRIDGE_STATE_PATH)) return null
  try {
    const info = JSON.parse(readFileSync(BRIDGE_STATE_PATH, 'utf8'))
    if (!info?.url || !info?.secret || !Number.isInteger(info?.pid)) return null
    process.kill(info.pid, 0)
    return info
  } catch {
    return null
  }
}

/**
 * Standalone stdio MCP proxy/server entrypoint for `.mcp.json`:
 * - If a Studio Bridge is already running on localhost, forwards JSON-RPC to its `/mcp` endpoint
 *   (so the agent sees ALL live user tabs AND shared headless sessions!).
 * - If no Bridge is running yet, starts a private embedded Bridge automatically so headless QA works zero-setup!
 */
async function runStdio() {
  const args = process.argv.slice(2)
  const flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  let bridgeUrl = flag('bridge')
  let bridgeSecret = flag('secret')
  let embeddedBridge = null

  const resolveBridge = async () => {
    if (bridgeUrl && bridgeSecret) return { url: bridgeUrl, secret: bridgeSecret }
    const running = discoverRunningBridge()
    if (running) return running
    if (!embeddedBridge) {
      const { createStudioBridge } = await import('./bridge.mjs')
      embeddedBridge = await createStudioBridge({ port: 0, writeRuntimeState: false, autoConnectT3: false })
    }
    return { url: embeddedBridge.url, secret: embeddedBridge.secret }
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try { msg = JSON.parse(trimmed) } catch { return }
    try {
      const target = await resolveBridge()
      const res = await fetch(`${target.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studio-secret': target.secret,
        },
        body: JSON.stringify(msg),
        signal: AbortSignal.timeout(120_000),
      })
      if (res.status === 204) return
      const body = await res.text()
      if (body.trim()) process.stdout.write(body.trim() + '\n')
    } catch (err) {
      if (msg?.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        }) + '\n')
      }
    }
  })

  rl.on('close', async () => {
    if (embeddedBridge) await embeddedBridge.close().catch(() => {})
    process.exit(0)
  })
}

function isDirectMain() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return process.argv[1] === fileURLToPath(import.meta.url)
  }
}

if (isDirectMain()) {
  void runStdio()
}
