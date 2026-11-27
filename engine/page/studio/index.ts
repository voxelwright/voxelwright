// Lazy-loaded entrypoint for Voxelwright's Native In-Game T3 Studio & Game-Use Control Plane (#98).
// Loaded ONLY in local/dev sessions when `?studio=1` or `#studio=...` is present — never bundled
// into public `voxelwright.world` static builds.
import { createAgentBridge, type AgentBridgeHandle } from './agent-bridge.ts'
import { createBugCapture, type BugCaptureController } from './bug-capture.ts'
import { StudioExtensionRegistry } from './ext.ts'
import { registerBuiltInExtensions } from './extensions.ts'
import { createBridgeTransport, createDirectT3Transport } from './transport.ts'
import type { StudioCtx, StudioEngineHandle, StudioExtension, T3Transport } from './types.ts'
import { createStudioUI, type StudioUIHandle } from './ui.ts'

const CONN_STORAGE_KEY = 'voxelwright.studio.bridge.v1'

interface SavedBridgeParams {
  bridgeUrl: string
  secret: string
}

function readAndCleanBridgeParams(): { bridgeUrl: string | null; secret: string | null; sessionId: string | null } {
  const rawHash = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  const hp = new URLSearchParams(rawHash)
  const qp = new URLSearchParams(location.search)
  let bridgeUrl = hp.get('studio') || qp.get('studioUrl')
  let secret = hp.get('secret')
  const sessionId = hp.get('session') || qp.get('session')

  if (bridgeUrl && secret) {
    try {
      sessionStorage.setItem(CONN_STORAGE_KEY, JSON.stringify({ bridgeUrl, secret } satisfies SavedBridgeParams))
    } catch { /* ignore private browsing */ }
    // Strip the bridge secret from the URL bar and browser history immediately!
    hp.delete('studio')
    hp.delete('secret')
    hp.delete('session')
    const rest = hp.toString()
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`)
    } catch { /* ignore */ }
  } else {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CONN_STORAGE_KEY) || 'null') as SavedBridgeParams | null
      if (saved?.bridgeUrl && saved?.secret) {
        bridgeUrl = saved.bridgeUrl
        secret = saved.secret
      }
    } catch { /* ignore */ }
  }

  return { bridgeUrl: bridgeUrl || null, secret: secret || null, sessionId: sessionId || null }
}

export interface StudioRuntimeHandle {
  readonly open: boolean
  readonly sessionId: string
  readonly headless: boolean
  readonly transport: T3Transport
  readonly bridge: AgentBridgeHandle
  readonly registry: StudioExtensionRegistry
  readonly ctx: StudioCtx
  show(open: boolean): void
  toggle(): void
  fireBugInView(prefill?: string): Promise<void>
  fireRewindBug(prefill?: string): Promise<void>
  registerExtension(ext: StudioExtension): () => void
  dispose(): void
}

export async function bootStudio(opts: {
  engine: StudioEngineHandle
  canvas: HTMLCanvasElement
}): Promise<StudioRuntimeHandle> {
  const { engine, canvas } = opts
  const qp = new URLSearchParams(location.search)
  const headless = qp.get('headless') === '1'
  let { bridgeUrl, secret, sessionId } = readAndCleanBridgeParams()
  if ((!bridgeUrl || !secret) && !headless && ['127.0.0.1', 'localhost', '::1'].includes(location.hostname)) {
    try {
      const boot = await fetch('/studio/bootstrap').then((r) => (r.ok ? r.json() : null)) as { active?: boolean; url?: string; secret?: string } | null
      if (boot?.active && boot.url && boot.secret) {
        bridgeUrl = boot.url
        secret = boot.secret
      }
    } catch { /* direct T3 mode fallback */ }
  }

  const transport: T3Transport = bridgeUrl && secret
    ? createBridgeTransport(bridgeUrl, secret)
    : createDirectT3Transport()

  const registry = new StudioExtensionRegistry()
  registerBuiltInExtensions(registry)

  let ui: StudioUIHandle | null = null
  let bugCapture: BugCaptureController | null = null
  let ctx!: StudioCtx

  const bridge = createAgentBridge({
    engine,
    canvas,
    bridgeUrl,
    secret,
    requestedSessionId: sessionId,
    headless,
    registry,
    getCtx: () => ctx,
    onControlChange: (control) => ui?.onControlChange(control),
    onAgentActivity: (info) => ui?.onAgentActivity(info),
  })

  ctx = {
    engine,
    canvas,
    transport,
    get sessionId() { return bridge.sessionId },
    headless,
    get control() { return bridge.control },
    captureBookmark: () => bridge.captureBookmark(),
    teleportToBookmark: (b) => bridge.teleportToBookmark(b),
    captureFrame: (mode) => bridge.captureFrame(mode),
    pickAt: (u, v) => bridge.pickAt(u, v),
    readRecorder: async (reason) => (await engine.recorder?.snapshot?.({ reason: reason ?? 'studio', pick: false })) ?? null,
    openComposerWithDraft: (draft) => ui?.openComposerWithDraft(draft, false),
    openThread: (threadId, environmentId) => ui?.openThread(threadId, environmentId),
    fireBugInView: (prefill) => bugCapture ? bugCapture.fireBugInView(prefill) : Promise.resolve(),
    fireRewindBug: (prefill) => bugCapture ? bugCapture.fireRewindBug(prefill) : Promise.resolve(),
    setSpatialPins: (pins) => bugCapture?.setSpatialPins(pins),
    registerExtension: (ext) => registry.register(ext),
    notice: (text, ms) => engine.hud.notice(text, ms),
  }

  // Headless Chrome Game-Use sessions run ZERO Studio UI DOM so screenshots stay 100% pure game frames!
  if (!headless) {
    bugCapture = createBugCapture({
      engine,
      bridge,
      registry,
      getCtx: () => ctx,
      onOpenDraft: (draft, immediate) => ui?.openComposerWithDraft(draft, immediate),
      onOpenPin: (pin) => {
        bridge.teleportToBookmark(pin.bookmark)
        if (!pin.threadId.startsWith('pt_')) ui?.openThread(pin.threadId)
      },
    })
    ui = createStudioUI({
      engine,
      transport,
      bridge,
      bugCapture,
      registry,
      getCtx: () => ctx,
    })
  }

  const handle: StudioRuntimeHandle = {
    get open() { return ui?.open ?? false },
    get sessionId() { return bridge.sessionId },
    headless,
    transport,
    bridge,
    registry,
    ctx,
    show: (open) => ui?.show(open),
    toggle: () => ui?.toggle(),
    fireBugInView: (prefill) => ctx.fireBugInView(prefill),
    fireRewindBug: (prefill) => ctx.fireRewindBug(prefill),
    registerExtension: (ext) => registry.register(ext),
    dispose() {
      ui?.dispose()
      bugCapture?.dispose()
      bridge.dispose()
      transport.dispose()
    },
  }

  Object.assign(engine as unknown as Record<string, unknown>, { studio: handle })
  return handle
}
