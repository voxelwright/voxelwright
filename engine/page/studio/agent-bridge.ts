// In-game Game-Use execution runtime (#98).
// Runs inside the game page (both live user tabs AND headless Chrome), connects to Studio Bridge's
// `/studio/ws/game`, executes every native MCP Game-Use command directly against `globalThis.engine`
// & `engine.recorder`, detects live human input for instant `SessionControl` takeover, and maintains
// an optional rolling WebM video ring buffer for `F10` ("What Just Happened?") & `game_record_*`.
import type { PickInfo } from '../recorder.ts'
import type { StudioExtensionRegistry } from './ext.ts'
import type { GameBookmark, StudioControlState, StudioCtx, StudioEngineHandle } from './types.ts'

const HEAT_FLAG = 4 // march.ts HEAT bit
const SHADOWS_FLAG = 1
const MIRRORS_FLAG = 2

/** CSP-safe property path reader for live tabs (no eval / new Function required). */
function readEngineExpr(engine: StudioEngineHandle, raw: string): unknown {
  const s = raw.trim()
  const neg = s.startsWith('!')
  const expr = neg ? s.slice(1).trim() : s
  const cmp = /^([a-zA-Z0-9_.]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?|true|false|null|'[^']*'|"[^"]*")$/.exec(expr)
  const resolvePath = (path: string): unknown => {
    const clean = path.startsWith('engine.') ? path.slice(7) : path === 'engine' ? '' : path
    let cur: unknown = engine
    for (const part of clean.split('.').filter(Boolean)) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[part]
    }
    return cur
  }
  if (cmp) {
    const lhs = resolvePath(cmp[1])
    const op = cmp[2]
    const rawRhs = cmp[3]
    const rhs = rawRhs === 'true' ? true : rawRhs === 'false' ? false : rawRhs === 'null' ? null
      : (rawRhs.startsWith("'") || rawRhs.startsWith('"')) ? rawRhs.slice(1, -1) : Number(rawRhs)
    let res = false
    if (op === '===' || op === '==') res = lhs === rhs
    else if (op === '!==' || op === '!=') res = lhs !== rhs
    else if (op === '>') res = Number(lhs) > Number(rhs)
    else if (op === '>=') res = Number(lhs) >= Number(rhs)
    else if (op === '<') res = Number(lhs) < Number(rhs)
    else if (op === '<=') res = Number(lhs) <= Number(rhs)
    return neg ? !res : res
  }
  if (/^[a-zA-Z0-9_.]+$/.test(expr)) {
    const val = resolvePath(expr)
    return neg ? !val : val
  }
  throw new Error('Live tabs enforce strict CSP (no unsafe-eval). Use dotted engine paths (e.g. engine.pose.x or engine.frameMs < 33), or spawn a headless session for arbitrary JS eval.')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

function nextAnimationFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

/** Captures the live WebGPU canvas as a PNG data URL on the next rendered frame. */
async function grabCanvasPng(canvas: HTMLCanvasElement): Promise<{ dataUrl: string; width: number; height: number }> {
  await nextAnimationFrame()
  await nextAnimationFrame()
  const dataUrl = canvas.toDataURL('image/png')
  return { dataUrl, width: canvas.width, height: canvas.height }
}

/** Converts `engine.farIds([w, h])` 4-byte building/face buffer into a false-color PNG data URL. */
function encodeFarIdsPng(bytes: Uint8Array, w: number, h: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx2d = c.getContext('2d')!
  const img = ctx2d.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const id = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)
    const face = bytes[o + 3]
    if (id === 0 && face === 0) {
      img.data[o] = 12; img.data[o + 1] = 18; img.data[o + 2] = 30; img.data[o + 3] = 255
    } else if (face === 6) {
      img.data[o] = 64; img.data[o + 1] = 178; img.data[o + 2] = 132; img.data[o + 3] = 255
    } else {
      img.data[o] = ((id * 73) & 191) + 48
      img.data[o + 1] = ((id * 151 + face * 37) & 191) + 48
      img.data[o + 2] = ((id * 227) & 191) + 48
      img.data[o + 3] = 255
    }
  }
  ctx2d.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

export interface AgentBridgeHandle {
  readonly sessionId: string
  readonly control: StudioControlState
  readonly connected: boolean
  captureBookmark(): GameBookmark
  teleportToBookmark(b: GameBookmark): void
  captureFrame(mode?: 'color' | 'heat' | 'farIds'): Promise<{ dataUrl: string; width: number; height: number; mode: string }>
  pickAt(u?: number, v?: number): Promise<PickInfo & { farBuildingId?: number | null; farFace?: number | null }>
  takeControl(): void
  releaseControl(): void
  startRollingVideo(fps?: number): boolean
  stopRollingVideo(): void
  snapshotRollingVideoBase64(): Promise<{ base64: string; mimeType: string; durationMs: number } | null>
  syncTools(): void
  dispose(): void
}

export function createAgentBridge(opts: {
  engine: StudioEngineHandle
  canvas: HTMLCanvasElement
  bridgeUrl: string | null
  secret: string | null
  requestedSessionId?: string | null
  headless: boolean
  registry: StudioExtensionRegistry
  getCtx: () => StudioCtx
  onControlChange: (control: StudioControlState) => void
  onAgentActivity: (info: { agentId: string; op: string }) => void
}): AgentBridgeHandle {
  const { engine, canvas, bridgeUrl, secret, headless, registry } = opts
  let sessionId = opts.requestedSessionId || `local_${crypto.randomUUID().slice(0, 8)}`
  let control: StudioControlState = {
    owner: headless ? null : 'human',
    agentId: null,
    generation: 0,
    closed: false,
    humanInControl: !headless,
    lastHumanActivityAt: null,
  }
  let ws: WebSocket | null = null
  let disposed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Active explicit recording (`game_record_start` / `game_record_stop`)
  let activeRec: { recorder: MediaRecorder; chunks: Blob[]; startedAt: number } | null = null
  // Rolling 15-second video ring buffer for `F10` ("What Just Happened?")
  let rollingRec: MediaRecorder | null = null
  const rollingChunks: Array<{ at: number; blob: Blob }> = []

  const getMode = (): 'flying' | 'foot' | 'riding' =>
    engine.alive?.riding ? 'riding' : engine.me?.on ? 'foot' : 'flying'

  const captureBookmark = (): GameBookmark => {
    const p = engine.pose
    const yawDeg = Number(deg(p.yaw).toFixed(2))
    const pitchDeg = Number(deg(p.pitch).toFixed(2))
    const at: [number, number, number] = [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))]
    const look: [number, number] = [yawDeg, pitchDeg]
    const weather = engine.realmControls?.sky?.weather ?? (engine.rain > 0.1 ? 'rain' : engine.fog > 0.25 ? 'fog' : 'clear')
    const realm = new URLSearchParams(location.search).get('realm')
    const u = new URL(location.pathname, location.origin)
    u.searchParams.set('fly', '0')
    u.searchParams.set('at', at.join(','))
    u.searchParams.set('look', look.join(','))
    if (engine.hour !== null && engine.hour !== undefined) u.searchParams.set('hour', String(Number(engine.hour.toFixed(2))))
    if (weather) u.searchParams.set('weather', weather)
    if (realm) u.searchParams.set('realm', realm)
    return {
      at,
      look,
      hour: engine.hour ?? null,
      weather,
      rain: Number((engine.rain ?? 0).toFixed(2)),
      fog: Number((engine.fog ?? 0).toFixed(2)),
      scale: Number((engine.scale ?? 1).toFixed(2)),
      flags: engine.flags ?? 0,
      mode: getMode(),
      realm,
      reproUrl: u.toString(),
      where: document.querySelector('#where > div')?.textContent?.trim() || undefined,
      capturedAt: new Date().toISOString(),
    }
  }

  const teleportToBookmark = (b: GameBookmark) => {
    if (engine.alive?.riding) engine.alive.mount(null)
    if (b.mode === 'flying' && engine.me?.on) engine.me.walk(false)
    engine.pose.x = b.at[0]
    engine.pose.y = b.at[1]
    engine.pose.z = b.at[2]
    engine.pose.yaw = rad(b.look[0])
    engine.pose.pitch = rad(b.look[1])
    if (b.hour !== undefined) engine.hour = b.hour
    if (typeof b.rain === 'number') engine.rain = b.rain
    if (typeof b.fog === 'number') engine.fog = b.fog
    if (b.weather && engine.realmControls?.sky?.setWeather) engine.realmControls.sky.setWeather(b.weather)
    if (typeof b.flags === 'number') engine.flags = b.flags
  }

  const captureFrame = async (mode: 'color' | 'heat' | 'farIds' = 'color') => {
    if (mode === 'farIds' && typeof engine.farIds === 'function') {
      const w = Math.min(640, Math.max(160, Math.round(canvas.width / 2)))
      const h = Math.min(360, Math.max(90, Math.round(canvas.height / 2)))
      const bytes = await engine.farIds([w, h])
      return { dataUrl: encodeFarIdsPng(bytes, w, h), width: w, height: h, mode }
    }
    if (mode === 'heat') {
      const prev = engine.flags
      engine.flags = prev | HEAT_FLAG
      try {
        const shot = await grabCanvasPng(canvas)
        return { ...shot, mode }
      } finally {
        engine.flags = prev
      }
    }
    const shot = await grabCanvasPng(canvas)
    return { ...shot, mode: 'color' }
  }

  const pickAt = async (u = 0.5, v = 0.5) => {
    const base: PickInfo = (await engine.recorder?.pickAt([u, v])) ?? {
      distanceM: 0,
      cell: [Math.round(engine.pose.x * 10), Math.round(engine.pose.y * 10), Math.round(engine.pose.z * 10)],
      material: 0,
      colour: 0,
    }
    let farBuildingId: number | null = null
    let farFace: number | null = null
    if (typeof engine.farIds === 'function') {
      try {
        const w = 160, h = 90
        const bytes = await engine.farIds([w, h])
        const px = Math.max(0, Math.min(w - 1, Math.floor(u * w)))
        const py = Math.max(0, Math.min(h - 1, Math.floor(v * h)))
        const o = (py * w + px) * 4
        const id = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)
        const face = bytes[o + 3]
        if (id > 0 && face >= 1 && face <= 5) {
          farBuildingId = id
          farFace = face
        }
      } catch { /* optional */ }
    }
    return { ...base, farBuildingId, farFace }
  }

  const buildStatus = () => {
    const recSummary = engine.recorder?.summary?.() ?? null
    return {
      sessionId,
      headless,
      control,
      url: location.href.split('#')[0],
      mode: getMode(),
      pose: {
        x: Number(engine.pose.x.toFixed(2)),
        y: Number(engine.pose.y.toFixed(2)),
        z: Number(engine.pose.z.toFixed(2)),
        yawDeg: Number(deg(engine.pose.yaw).toFixed(2)),
        pitchDeg: Number(deg(engine.pose.pitch).toFixed(2)),
      },
      tool: engine.tool,
      hour: engine.hour,
      rain: engine.rain,
      fog: engine.fog,
      scale: engine.scale,
      flags: engine.flags,
      settling: engine.settling,
      paused: engine.resting,
      perf: {
        frameMs: Number((engine.frameMs ?? 0).toFixed(2)),
        gpuMs: Number((engine.gpuMs ?? 0).toFixed(2)),
        cpuMs: Number((engine.cpuMs ?? 0).toFixed(2)),
        fps: engine.frameMs > 0 ? Math.round(1000 / engine.frameMs) : 0,
      },
      gpuFaults: engine.gpu?.faults?.length ?? 0,
      anomalies: recSummary?.anomalyCount ?? 0,
      criticalAnomalies: recSummary?.criticalCount ?? 0,
      where: document.querySelector('#where > div')?.textContent?.trim() || null,
    }
  }

  const executeOp = async (op: string, params: Record<string, unknown>): Promise<unknown> => {
    switch (op) {
      case 'status':
        return buildStatus()

      case 'snapshot': {
        const radiusM = Number(params.radiusM ?? 80)
        const status = buildStatus()
        const bookmark = captureBookmark()
        const trace = (await engine.recorder?.snapshot?.({ reason: 'mcp-snapshot', pick: false })) ?? null
        const lastKf = trace?.keyframes?.[trace.keyframes.length - 1] ?? null
        const nearbyVehicles = (lastKf?.cars ?? [])
          .map((c) => ({
            ref: `vehicle:${c.id}`,
            id: c.id,
            kind: c.kind,
            name: c.name,
            model: c.model,
            at: [Number(c.x.toFixed(1)), Number(c.y.toFixed(1)), Number(c.z.toFixed(1))],
            kmh: Number((c.v * 3.6).toFixed(1)),
            road: c.road,
            distanceM: Number(Math.hypot(c.x - engine.pose.x, c.z - engine.pose.z).toFixed(1)),
          }))
          .filter((v) => v.distanceM <= radiusM)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, 24)

        const hudButtons = [...document.querySelectorAll<HTMLElement>('button:not([hidden]), [role="button"]:not([hidden])')]
          .filter((el) => el.offsetParent !== null && !el.closest('[data-panel="studio"]'))
          .slice(0, 30)
          .map((el, i) => {
            const r = el.getBoundingClientRect()
            return {
              ref: `hud:${i}`,
              label: (el.getAttribute('aria-label') || el.textContent || el.title || '').trim().slice(0, 60),
              rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            }
          })

        const pick = await pickAt(0.5, 0.5).catch(() => null)
        let imageBase64: string | undefined
        if (params.includeImage || params.save) {
          const shot = await captureFrame('color')
          imageBase64 = shot.dataUrl
        }
        return {
          status,
          bookmark,
          crosshairPick: pick,
          nearbyVehicles,
          hudControls: hudButtons,
          anomalies: (trace?.anomalies ?? []).slice(-12),
          gpuFaults: (engine.gpu?.faults ?? []).slice(-10),
          worldStats: engine.world?.stats ?? null,
          ...(imageBase64 ? { imageBase64, imageMimeType: 'image/png' } : {}),
        }
      }

      case 'frame': {
        const mode = (params.mode === 'heat' || params.mode === 'farIds' ? params.mode : 'color')
        const shot = await captureFrame(mode)
        return {
          mode: shot.mode,
          width: shot.width,
          height: shot.height,
          bookmark: captureBookmark(),
          imageBase64: shot.dataUrl,
          imageMimeType: 'image/png',
        }
      }

      case 'pick': {
        const u = typeof params.u === 'number' ? Math.max(0, Math.min(1, params.u)) : 0.5
        const v = typeof params.v === 'number' ? Math.max(0, Math.min(1, params.v)) : 0.5
        return pickAt(u, v)
      }

      case 'camera': {
        if (params.mode === 'flying' && engine.me?.on) engine.me.walk(false)
        if (params.mode === 'foot' && engine.me && !engine.me.on) engine.me.walk(true)
        if (Array.isArray(params.at) && params.at.length === 3) {
          engine.pose.x = Number(params.at[0])
          engine.pose.y = Number(params.at[1])
          engine.pose.z = Number(params.at[2])
        }
        if (Array.isArray(params.look) && params.look.length === 2) {
          engine.pose.yaw = rad(Number(params.look[0]))
          engine.pose.pitch = rad(Number(params.look[1]))
        }
        if (Array.isArray(params.lookAt) && params.lookAt.length === 3) {
          const dx = Number(params.lookAt[0]) - engine.pose.x
          const dy = Number(params.lookAt[1]) - engine.pose.y
          const dz = Number(params.lookAt[2]) - engine.pose.z
          const horiz = Math.hypot(dx, dz)
          engine.pose.yaw = Math.atan2(dx, -dz)
          engine.pose.pitch = Math.atan2(dy, Math.max(0.001, horiz))
        }
        if (typeof params.fov === 'number') engine.fov = Math.max(20, Math.min(120, params.fov))
        await nextAnimationFrame()
        return { bookmark: captureBookmark() }
      }

      case 'act': {
        const action = String(params.action ?? '')
        if (action === 'press' && typeof params.code === 'string') {
          const dur = Math.max(30, Math.min(10_000, Number(params.durationMs ?? 120)))
          dispatchEvent(new KeyboardEvent('keydown', { code: params.code, bubbles: true }))
          engine.input.hold(params.code, true)
          await sleep(dur)
          engine.input.hold(params.code, false)
          dispatchEvent(new KeyboardEvent('keyup', { code: params.code, bubbles: true }))
          return { ok: true, action, code: params.code, durationMs: dur, pose: captureBookmark().at }
        }
        if (action === 'hold' && typeof params.code === 'string') {
          engine.input.hold(params.code, true)
          return { ok: true, action, code: params.code }
        }
        if (action === 'release' && typeof params.code === 'string') {
          engine.input.hold(params.code, false)
          return { ok: true, action, code: params.code }
        }
        if (action === 'lookDelta' && Array.isArray(params.delta) && params.delta.length === 2) {
          engine.pose.yaw += Number(params.delta[0])
          engine.pose.pitch = Math.max(-1.45, Math.min(1.45, engine.pose.pitch + Number(params.delta[1])))
          await nextAnimationFrame()
          return { ok: true, look: captureBookmark().look }
        }
        if (action === 'pickTool') {
          const idx = typeof params.tool === 'number' ? params.tool : 0
          engine.pickTool(idx)
          return { ok: true, tool: engine.tool }
        }
        if (action === 'use') {
          engine.input.use()
          await nextAnimationFrame()
          return { ok: true, action: 'use' }
        }
        if (action === 'summonCar') {
          await engine.summonCar?.()
          await nextAnimationFrame()
          return { ok: true, action: 'summonCar' }
        }
        if (action === 'castSpell' && typeof params.spell === 'string') {
          const res = engine.spell?.(params.spell)
          return { ok: true, result: res ?? null }
        }
        if (action === 'clickHud' && typeof params.selector === 'string') {
          const el = document.querySelector<HTMLElement>(params.selector)
          if (!el) throw new Error(`HUD element not found: ${params.selector}`)
          el.click()
          return { ok: true, clicked: params.selector }
        }
        if (action === 'say' && typeof params.text === 'string') {
          engine.say?.(params.text)
          return { ok: true }
        }
        throw new Error(`Unsupported game_act action: ${action}`)
      }

      case 'world': {
        if (params.hour !== undefined) engine.hour = params.hour === null ? null : Number(params.hour)
        if (typeof params.rain === 'number') engine.rain = params.rain
        if (typeof params.fog === 'number') engine.fog = params.fog
        if (typeof params.weather === 'string' && engine.realmControls?.sky?.setWeather) {
          engine.realmControls.sky.setWeather(params.weather)
        }
        if (typeof params.graphics === 'string' && engine.graphics) engine.graphics.preset = params.graphics
        if (typeof params.scale === 'number') engine.scale = params.scale
        const opName = typeof params.op === 'string' ? params.op : null
        const at = Array.isArray(params.at) && params.at.length === 3 ? params.at.map(Number) as [number, number, number] : null
        if (opName === 'reset') await engine.reset()
        else if (opName === 'blast') engine.blast(typeof params.radius === 'number' ? params.radius : undefined)
        else if (opName === 'strike' && at) engine.strike(at, typeof params.radius === 'number' ? params.radius : undefined)
        else if (opName === 'ignite' && at) engine.ignite(at, typeof params.radius === 'number' ? params.radius : undefined)
        else if (opName === 'place' && at) engine.place(at, typeof params.radius === 'number' ? params.radius : undefined, typeof params.kind === 'number' ? params.kind : undefined)
        else if (opName === 'cut' && at) engine.cut(at, typeof params.radius === 'number' ? params.radius : undefined)
        else if (opName === 'set' && at) engine.set(at, Number(params.radius ?? 5), Number(params.kind ?? 8))
        await nextAnimationFrame()
        return { ok: true, bookmark: captureBookmark() }
      }

      case 'debug': {
        if (typeof params.paused === 'boolean') engine.pause(params.paused)
        if (typeof params.flags === 'number') engine.flags = params.flags
        if (typeof params.shadows === 'boolean') engine.flags = params.shadows ? (engine.flags | SHADOWS_FLAG) : (engine.flags & ~SHADOWS_FLAG)
        if (typeof params.mirrors === 'boolean') engine.flags = params.mirrors ? (engine.flags | MIRRORS_FLAG) : (engine.flags & ~MIRRORS_FLAG)
        if (typeof params.heat === 'boolean') engine.flags = params.heat ? (engine.flags | HEAT_FLAG) : (engine.flags & ~HEAT_FLAG)
        if (typeof params.stepFrames === 'number') {
          const n = Math.max(1, Math.min(120, Math.round(params.stepFrames)))
          engine.pause(false)
          for (let i = 0; i < n; i++) await nextAnimationFrame()
          engine.pause(true)
        }
        let recoreMs: number | null = null
        if (typeof params.recoreUrl === 'string' && typeof engine.recore === 'function') {
          recoreMs = await engine.recore(params.recoreUrl)
        }
        return { ok: true, paused: engine.resting, flags: engine.flags, recoreMs }
      }

      case 'perf': {
        const base = {
          frameMs: Number((engine.frameMs ?? 0).toFixed(2)),
          gpuMs: Number((engine.gpuMs ?? 0).toFixed(2)),
          cpuMs: Number((engine.cpuMs ?? 0).toFixed(2)),
          scale: engine.scale,
          flags: engine.flags,
          worldStats: engine.world?.stats ?? null,
          recorderSummary: engine.recorder?.summary?.() ?? null,
        }
        if (params.benchmark) {
          const pacedMs = typeof engine.paced === 'function' ? await engine.paced(engine.flags) : null
          const passStats = typeof engine.passes === 'function' ? await engine.passes(engine.flags, 20) : null
          return { ...base, pacedMs, passes: passStats }
        }
        return base
      }

      case 'flightRecorder': {
        const trace = await engine.recorder?.snapshot?.({ reason: 'mcp-read', pick: false })
        if (!trace) return { available: false }
        const maxKf = Math.max(1, Math.min(200, Number(params.maxKeyframes ?? 30)))
        return {
          available: true,
          sessionId: trace.sessionId,
          summary: trace.summary,
          meta: trace.meta,
          keyframes: trace.keyframes.slice(-maxKf),
          ...(params.includeEvents !== false ? { events: trace.events.slice(-80) } : {}),
          ...(params.includeAnomalies !== false ? { anomalies: trace.anomalies } : {}),
          edits: trace.edits.slice(-40),
        }
      }

      case 'waitFor': {
        const timeoutMs = Math.max(100, Math.min(60_000, Number(params.timeoutMs ?? 15_000)))
        const deadline = performance.now() + timeoutMs
        while (performance.now() < deadline) {
          let matched = true
          if (params.settled === true && engine.settling) matched = false
          if (typeof params.mode === 'string' && getMode() !== params.mode) matched = false
          if (typeof params.minFps === 'number' && (engine.frameMs <= 0 || 1000 / engine.frameMs < params.minFps)) matched = false
          if (matched && typeof params.expression === 'string') {
            if (!readEngineExpr(engine, params.expression)) matched = false
          }
          if (matched) return { ok: true, status: buildStatus() }
          await sleep(100)
        }
        throw new Error(`game_wait_for timed out after ${timeoutMs} ms`)
      }

      case 'recordStart': {
        if (activeRec) throw new Error('A recording is already active.')
        const fps = Math.max(5, Math.min(60, Number(params.fps ?? 24)))
        const stream = canvas.captureStream(fps)
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
        const recorder = new MediaRecorder(stream, { mimeType: mime })
        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.start(500)
        activeRec = { recorder, chunks, startedAt: Date.now() }
        return { ok: true, recording: true, fps, mimeType: mime }
      }

      case 'recordStop': {
        if (!activeRec) throw new Error('No active recording.')
        const rec = activeRec
        activeRec = null
        await new Promise<void>((resolve) => {
          rec.recorder.onstop = () => resolve()
          rec.recorder.stop()
        })
        const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || 'video/webm' })
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return {
          ok: true,
          durationMs: Date.now() - rec.startedAt,
          sizeBytes: bytes.byteLength,
          videoBase64: btoa(bin),
          summary: engine.recorder?.summary?.() ?? null,
        }
      }

      case 'assert': {
        const failures: string[] = []
        const faults = engine.gpu?.faults?.length ?? 0
        const summary = engine.recorder?.summary?.()
        if (params.noGpuFaults !== false && faults > 0) failures.push(`Expected 0 GPU faults, found ${faults}`)
        if (params.noCriticalAnomalies !== false && (summary?.criticalCount ?? 0) > 0) {
          failures.push(`Expected 0 critical anomalies, found ${summary?.criticalCount}`)
        }
        if (typeof params.maxFrameMs === 'number' && engine.frameMs > params.maxFrameMs) {
          failures.push(`frameMs ${engine.frameMs.toFixed(1)} exceeded ${params.maxFrameMs}`)
        }
        if (params.settled === true && engine.settling) failures.push('World sectors are still settling')
        if (params.hudClearOfBody === true && engine.playHud?.body) {
          const box = engine.playHud.body()
          if (box) {
            const studioEl = document.querySelector<HTMLElement>('[data-panel="studio"] .vw-studio-pill')
            if (studioEl && studioEl.offsetParent !== null) {
              const r = studioEl.getBoundingClientRect()
              const overlaps = r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
              if (overlaps) failures.push('Studio HUD pill overlaps character box')
            }
          }
        }
        return { passed: failures.length === 0, failures, status: buildStatus() }
      }

      case 'eval': {
        const expr = String(params.expression ?? '')
        let value = readEngineExpr(engine, expr)
        if (params.awaitPromise !== false && value && typeof (value as Promise<unknown>).then === 'function') {
          value = await value
        }
        const serialized = JSON.stringify(value ?? null)
        if (serialized && serialized.length > 64_000) {
          return { value: serialized.slice(0, 64_000), truncated: true }
        }
        return { value: value ?? null }
      }

      case 'extensionTool': {
        const name = String(params.name ?? '')
        const args = (params.args as Record<string, unknown>) ?? {}
        return registry.runGameTool(name, opts.getCtx(), args)
      }

      default:
        throw new Error(`Unknown Game-Use op: ${op}`)
    }
  }

  const sendRegister = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'register',
      url: location.href.split('#')[0],
      title: document.title,
      realm: new URLSearchParams(location.search).get('realm') || 'home',
      viewport: [innerWidth, innerHeight],
      tools: registry.advertisedGameTools(),
    }))
  }

  const connectWs = () => {
    if (disposed || !bridgeUrl || !secret) return
    const wsUrl = new URL(`${bridgeUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/studio/ws/game`)
    wsUrl.searchParams.set('secret', secret)
    wsUrl.searchParams.set('session', sessionId)
    if (headless) wsUrl.searchParams.set('headless', '1')
    const sock = new WebSocket(wsUrl.toString())
    sock.addEventListener('open', () => {
      ws = sock
      sendRegister()
    })
    sock.addEventListener('message', (ev) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(String(ev.data)) as Record<string, unknown> } catch { return }
      if (msg.type === 'hello') {
        if (typeof msg.sessionId === 'string') sessionId = msg.sessionId
        if (msg.control && typeof msg.control === 'object') {
          control = msg.control as StudioControlState
          opts.onControlChange(control)
        }
        return
      }
      if (msg.type === 'control.state' && msg.control && typeof msg.control === 'object') {
        control = msg.control as StudioControlState
        opts.onControlChange(control)
        return
      }
      if (msg.type === 'agent.activity') {
        opts.onAgentActivity({ agentId: String(msg.agentId ?? 'agent'), op: String(msg.op ?? '') })
        return
      }
      if (msg.type === 'command' && msg.id !== undefined && typeof msg.op === 'string') {
        void executeOp(msg.op, (msg.params as Record<string, unknown>) ?? {})
          .then((result) => sock.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result })))
          .catch((err) => sock.send(JSON.stringify({ type: 'response', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })))
      }
    })
    sock.addEventListener('close', () => {
      if (ws === sock) ws = null
      if (!disposed && !reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWs() }, 2000)
      }
    })
  }

  // Detect live human game input -> immediately trigger SessionControl human takeover so agent never fights player!
  let lastNotify = 0
  const onHumanInput = (e: Event) => {
    if (headless) return
    if (e.target instanceof Element && e.target.closest('[data-panel="studio"]')) return
    const now = Date.now()
    if (now - lastNotify < 350) return
    lastNotify = now
    if (!control.humanInControl && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'human.activity' }))
    }
  }
  if (!headless) {
    addEventListener('keydown', onHumanInput, { capture: true })
    canvas.addEventListener('pointerdown', onHumanInput, { capture: true })
  }

  const unsubRegistry = registry.onChange(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tools.update', tools: registry.advertisedGameTools() }))
    }
  })

  connectWs()

  const startRollingVideo = (fps = 12): boolean => {
    if (rollingRec || typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') return false
    try {
      const stream = canvas.captureStream(fps)
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
      rollingChunks.length = 0
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          const now = Date.now()
          rollingChunks.push({ at: now, blob: ev.data })
          // Keep init chunk [0] + last ~15 seconds of chunks
          while (rollingChunks.length > 16 && now - rollingChunks[1].at > 15_000) {
            rollingChunks.splice(1, 1)
          }
        }
      }
      rec.start(1000)
      rollingRec = rec
      return true
    } catch {
      return false
    }
  }

  const stopRollingVideo = () => {
    if (!rollingRec) return
    try { rollingRec.stop() } catch { /* ignore */ }
    rollingRec = null
    rollingChunks.length = 0
  }

  const snapshotRollingVideoBase64 = async () => {
    if (!rollingChunks.length) return null
    const mimeType = rollingRec?.mimeType || 'video/webm'
    const blob = new Blob(rollingChunks.map((c) => c.blob), { type: mimeType })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const durationMs = rollingChunks.length > 1 ? rollingChunks[rollingChunks.length - 1].at - rollingChunks[0].at : 1000
    return { base64: btoa(bin), mimeType: mimeType.split(';')[0], durationMs }
  }

  return {
    get sessionId() { return sessionId },
    get control() { return control },
    get connected() { return ws?.readyState === WebSocket.OPEN },
    captureBookmark,
    teleportToBookmark,
    captureFrame,
    pickAt,
    takeControl() {
      control = { ...control, owner: 'human', humanInControl: true, generation: control.generation + 1 }
      opts.onControlChange(control)
      ws?.send(JSON.stringify({ type: 'control.take', viewerId: 'human' }))
    },
    releaseControl() {
      control = { ...control, owner: null, humanInControl: false, generation: control.generation + 1 }
      opts.onControlChange(control)
      ws?.send(JSON.stringify({ type: 'control.release', viewerId: 'human' }))
    },
    startRollingVideo,
    stopRollingVideo,
    snapshotRollingVideoBase64,
    syncTools: sendRegister,
    dispose() {
      disposed = true
      stopRollingVideo()
      unsubRegistry()
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (!headless) {
        removeEventListener('keydown', onHumanInput, { capture: true })
        canvas.removeEventListener('pointerdown', onHumanInput, { capture: true })
      }
      try { ws?.close(1000) } catch { /* ignore */ }
      ws = null
    },
  }
}
