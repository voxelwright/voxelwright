// Shared TypeScript interfaces for Voxelwright's native in-game T3 Studio & Game-Use IDE (#98).
// Uses strictly erasable syntax (Node stripTypeScriptTypes + tsconfig erasableSyntaxOnly).
import type { Hud } from '../hud.ts'
import type { Input } from '../input.ts'
import type { Recorder, PickInfo, SessionTrace, Anomaly } from '../recorder.ts'

export interface StudioControlState {
  owner: string | null
  agentId: string | null
  generation: number
  closed: boolean
  humanInControl: boolean
  lastHumanActivityAt: number | null
}

export interface GameBookmark {
  at: [number, number, number]
  look: [number, number]
  hour: number | null
  weather: string | null
  rain: number
  fog: number
  scale: number
  flags: number
  mode: 'flying' | 'foot' | 'riding'
  realm: string | null
  reproUrl: string
  where?: string
  capturedAt: string
}

export interface GameContextRecord {
  kind: string
  label: string
  contextId?: string
  payload?: Record<string, unknown>
  attachmentId?: string
  name?: string
  mimeType?: string
  sizeBytes?: number
}

export interface UploadedFileDraft {
  name: string
  mimeType: string
  dataBase64: string
  label?: string
  type?: 'image' | 'file'
}

export interface ThreadLaunchDraft {
  title?: string
  text: string
  projectId?: string
  contextRecords?: GameContextRecord[]
  files?: UploadedFileDraft[]
  runtimeMode?: 'approval-required' | 'auto-accept-edits' | 'auto' | 'full-access'
  interactionMode?: 'default' | 'plan'
  workspaceStrategy?: { type: 'root' } | { type: 'worktree'; baseRef?: string; branch?: string; startFromOrigin?: boolean }
  modelSelection?: { provider?: string; instanceId?: string; model: string; options?: Record<string, unknown> }
  bookmark?: GameBookmark | null
}

export interface T3EnvironmentSummary {
  environmentId: string
  label: string
  httpBaseUrl: string
  tokenType: 'DPoP' | 'Bearer'
  scopes: string[]
  state: 'disconnected' | 'connecting' | 'connected' | 'blocked' | 'error'
  lastError: string | null
  serverVersion: string | null
  capabilities: Record<string, unknown>
  expiresAt?: string
  active?: boolean
}

export interface SpatialThreadPin {
  threadId: string
  title: string
  status: string
  at: [number, number, number] // world cells (10 cells = 1 m)
  bookmark: GameBookmark
}

export interface PlaytestNote {
  id: string
  at: string
  text: string
  category?: string
  bookmark: GameBookmark
  screenshotDataUrl?: string
  pick?: PickInfo | null
  threadId?: string | null
}

export interface StudioPanelDef {
  id: string
  title: string
  icon: string
  slot: 'rail' | 'bottom' | 'overlay'
  mount(container: HTMLElement, ctx: StudioCtx): () => void
}

export interface StudioContextCollector {
  kind: string
  label: string
  collect(ctx: StudioCtx): Promise<Record<string, unknown> | null> | Record<string, unknown> | null
}

export interface StudioGameToolDef {
  name: string
  description: string
  schema: Record<string, unknown>
  access: 'observe' | 'act'
  run(ctx: StudioCtx, args: Record<string, unknown>): Promise<unknown> | unknown
}

export interface StudioActionDef {
  id: string
  title: string
  shortcut?: string
  prompt(ctx: StudioCtx): Promise<ThreadLaunchDraft> | ThreadLaunchDraft
}

export interface StudioExtension {
  id: string
  title?: string
  panels?: StudioPanelDef[]
  collectors?: StudioContextCollector[]
  gameTools?: StudioGameToolDef[]
  actions?: StudioActionDef[]
}

export interface StudioEngineHandle {
  pose: { x: number; y: number; z: number; yaw: number; pitch: number }
  gpu: { faults: string[]; canTime?: boolean }
  input: Input
  hud: Hud
  march?: { rain: number; day: number; flags?: number; pick(v: unknown): Promise<{ t: number; kind?: number; colour?: number } | null> }
  world?: { stats: { wanted: number; stale: number; cached?: number; poolPct?: number; poolFull?: number; crashed?: number }; options?: Record<string, unknown> }
  view(): { eye: [number, number, number]; forward: [number, number, number]; right: [number, number, number]; up: [number, number, number] }
  kind(x: number, y: number, z: number): number
  ground(x: number, z: number): number
  feet(x: number, z: number): number
  top(x: number, z: number): number
  pickTool(i: number): void
  tool: string
  hour: number | null
  rain: number
  fog: number
  scale: number
  flags: number
  fov: number
  resting: boolean
  settling: boolean
  frameMs: number
  gpuMs: number
  cpuMs: number
  bodies: number
  dropping: number
  burning: number
  flowing: boolean
  pause(on: boolean): void
  reset(): Promise<unknown> | unknown
  blast(radius?: number, sparks?: boolean): void
  strike(at: [number, number, number], radius?: number, spark?: boolean): void
  ignite(at: [number, number, number], radius?: number): void
  place(at: [number, number, number], radius?: number, kind?: number): void
  cut(at: [number, number, number], radius?: number): void
  set(at: [number, number, number], radius: number, kind: number): void
  say?(text: string): void
  spell?(words: string): unknown
  summonCar?(): Promise<unknown> | unknown
  recore?(url: string): Promise<number>
  paced?(flags?: number): Promise<number>
  passes?(flags?: number, times?: number): Promise<unknown>
  farIds?(size: [number, number]): Promise<Uint8Array>
  recorder?: Recorder
  me?: { on: boolean; walk(on: boolean): void; feet: { at: [number, number, number]; yaw: number } | null; view: string }
  alive?: { riding: { id: number; name?: string; at?: [number, number, number] } | null; mount(which: unknown): void; all?: () => unknown[] }
  street?: { snap?(): unknown[]; vehicles?: unknown[] }
  playHud?: { mode: string | null; body?(): { left: number; top: number; right: number; bottom: number } | null }
  realmControls?: { sky?: { weather?: string; setWeather?(w: string): void } }
  graphics?: { presets: readonly string[]; preset: string; resolution?: { scale: number; auto: boolean; target: number; fixed: boolean } }
  ears?: { voice?: unknown; radio?: unknown }
  workshop?: { refresh(): Promise<number>; show(open: boolean): void; readonly open: boolean }
  watch?(fn: (gap: number) => void): () => void
}

export interface T3Transport {
  readonly mode: 'bridge' | 'direct'
  readonly bridgeUrl: string | null
  readonly secret: string | null
  connect(): Promise<void>
  dispose(): void
  status(): Promise<{
    environments: T3EnvironmentSummary[]
    activeEnvironmentId: string | null
    localT3?: { origin: string; label: string; environmentId: string | null; serverVersion: string | null } | null
    sessions?: unknown[]
  }>
  autoConnectLocal(): Promise<T3EnvironmentSummary>
  pair(input: { pairingUrl?: string; host?: string; pairingCode?: string; accessToken?: string; httpBaseUrl?: string; label?: string }): Promise<T3EnvironmentSummary>
  setActiveEnvironment(environmentId: string): Promise<void>
  removeEnvironment(environmentId: string): Promise<void>
  rpc<T = unknown>(method: string, payload?: Record<string, unknown>, environmentId?: string): Promise<T>
  http<T = unknown>(method: string, path: string, body?: unknown, environmentId?: string): Promise<T>
  subscribe(method: string, payload: Record<string, unknown>, onEvent: (ev: unknown) => void, environmentId?: string): () => void
  launchThread(draft: ThreadLaunchDraft & { environmentId?: string }): Promise<{ result: unknown; attachments?: unknown[] }>
  sendMessage(input: {
    threadId: string
    text: string
    contextRecords?: GameContextRecord[]
    files?: UploadedFileDraft[]
    modelSelection?: ThreadLaunchDraft['modelSelection']
    dispatchMode?: Record<string, unknown>
    deliveryIntent?: 'auto' | 'steer' | 'restart'
    freshContext?: boolean
    environmentId?: string
  }): Promise<{ result: unknown; attachments?: unknown[] }>
  uploadAttachment(file: Blob | Uint8Array, name: string, mimeType: string, environmentId?: string): Promise<{ attachmentId: string; name: string; mimeType: string; sizeBytes: number; type: string }>
  assetUrl(path: string, environmentId?: string): string
  transcribeVoice(audio: Blob, opts?: { provider?: string; model?: string; environmentId?: string }): Promise<{ text?: string; transcript?: string }>
  listWorktrees(): Promise<Array<{ path: string; head?: string; branch?: string; previewUrl?: string | null }>>
  verifyWorktree(input: { worktreePath: string; sessionId?: string; bookmark?: GameBookmark | null; forceServer?: boolean }): Promise<Record<string, unknown>>
  generateRegressionTest(input: { slug: string; title: string; bookmark: GameBookmark; assert?: Record<string, unknown> }): Promise<{ filename: string; source: string }>
  onEvent(fn: (ev: Record<string, unknown>) => void): () => void
}

export interface StudioCtx {
  readonly engine: StudioEngineHandle
  readonly canvas: HTMLCanvasElement
  readonly transport: T3Transport
  readonly sessionId: string
  readonly headless: boolean
  readonly control: StudioControlState
  captureBookmark(): GameBookmark
  teleportToBookmark(bookmark: GameBookmark): void
  captureFrame(mode?: 'color' | 'heat' | 'farIds'): Promise<{ dataUrl: string; width: number; height: number; mode: string }>
  pickAt(u?: number, v?: number): Promise<PickInfo & { farBuildingId?: number | null; farFace?: number | null }>
  readRecorder(reason?: string): Promise<SessionTrace | null>
  openComposerWithDraft(draft: ThreadLaunchDraft): void
  openThread(threadId: string, environmentId?: string): void
  fireBugInView(prefill?: string): Promise<void>
  fireRewindBug(prefill?: string): Promise<void>
  setSpatialPins(pins: SpatialThreadPin[]): void
  registerExtension(ext: StudioExtension): () => void
  notice(text: string, ms?: number): void
  onAnomaly?(fn: (a: Anomaly) => void): () => void
}
