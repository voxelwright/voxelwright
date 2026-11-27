// Voxelmorphism Native In-Game T3 Studio IDE Shell (#98).
// Mounts cleanly on `engine.hud.panel('studio')`, respects `engine.input.push()` when open,
// keeps a tiny non-overlapping status pill during play, shows live Agent Driving controls,
// and coordinates live T3 shell/thread subscriptions + voice dictation + worktree verification.
import type { AgentBridgeHandle } from './agent-bridge.ts'
import type { BugCaptureController } from './bug-capture.ts'
import type { StudioExtensionRegistry } from './ext.ts'
import type {
  SpatialThreadPin,
  StudioControlState,
  StudioCtx,
  StudioEngineHandle,
  T3Transport,
  ThreadLaunchDraft,
} from './types.ts'
import { h, renderReviewView, renderThreadsView, type StudioActions, type StudioState, type StudioTab, type ThreadSummary } from './views.ts'
import { renderLabView, renderOpsView, renderPrIssuesView, renderToolsView } from './views-ops.ts'

export interface StudioUIHandle {
  readonly open: boolean
  show(open: boolean): void
  toggle(): void
  openComposerWithDraft(draft: ThreadLaunchDraft, immediateLaunch?: boolean): void
  openThread(threadId: string, environmentId?: string): void
  onControlChange(control: StudioControlState): void
  onAgentActivity(info: { agentId: string; op: string }): void
  dispose(): void
}

const STUDIO_CSS = /* css */ `
[data-panel="studio"] {
  position: fixed; inset: 0; z-index: 40; pointer-events: none;
  font: 400 13px/1.4 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #f0f4fa; font-variant-numeric: tabular-nums;
}
[data-panel="studio"] * { box-sizing: border-box; }
[data-panel="studio"] .vw-studio-pill {
  position: fixed; top: max(12px, env(safe-area-inset-top)); right: max(68px, calc(env(safe-area-inset-right) + 68px));
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px;
  border-radius: 4px; background: rgba(21, 28, 40, 0.88); border: 1.5px solid #4e5d75;
  box-shadow: 0 6px 20px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  pointer-events: auto; z-index: 41;
}
[data-panel="studio"] .vw-studio-pill .st-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
[data-panel="studio"] .vw-agent-banner {
  position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 10px; padding: 6px 12px;
  border-radius: 4px; background: rgba(48, 28, 10, 0.94); border: 1.5px solid #f09d38;
  color: #fff3de; font-weight: 600; box-shadow: 0 8px 26px rgba(0,0,0,0.5); pointer-events: auto; z-index: 42;
}
[data-panel="studio"] .st-shell {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(490px, 100vw);
  background: rgba(17, 22, 32, 0.96); border-left: 2px solid #37445a;
  box-shadow: -14px 0 42px rgba(0,0,0,0.58); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  display: flex; flex-direction: column; pointer-events: auto; z-index: 45;
  user-select: text; -webkit-user-select: text;
}
[data-panel="studio"] .st-shell.layout-wide { width: min(760px, 96vw); }
[data-panel="studio"] .st-shell.layout-bottom {
  top: auto; left: 0; right: 0; bottom: 0; width: 100vw; height: min(50vh, 520px);
  border-left: 0; border-top: 2px solid #37445a; box-shadow: 0 -14px 42px rgba(0,0,0,0.58);
}
[data-panel="studio"] .st-top {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 9px 12px; background: #151c28; border-bottom: 1.5px solid #2b374c; flex: none;
}
[data-panel="studio"] .st-brand { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; letter-spacing: 0.01em; }
[data-panel="studio"] .st-tabs {
  display: flex; gap: 3px; padding: 6px 8px; background: #121824; border-bottom: 1px solid #263246;
  flex-wrap: nowrap; flex: none;
}
[data-panel="studio"] .st-tab {
  flex: 1 1 auto; text-align: center;
  border: 1px solid transparent; border-radius: 4px; padding: 5px 6px; background: transparent;
  color: #9eb0ca; font: 600 11.5px/1.1 inherit; cursor: pointer; white-space: nowrap;
}
[data-panel="studio"] .st-tab:hover { background: rgba(255,255,255,0.06); color: #f0f4fa; }
[data-panel="studio"] .st-tab.on { background: #2154e4; border-color: #4b79ff; color: #fff; }
[data-panel="studio"] .st-body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
[data-panel="studio"] .st-view, [data-panel="studio"] .st-detail, [data-panel="studio"] .st-ext-box { display: flex; flex-direction: column; gap: 9px; }
[data-panel="studio"] .st-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
[data-panel="studio"] .st-space { justify-content: space-between; }
[data-panel="studio"] .st-pills { display: flex; gap: 5px; flex-wrap: wrap; }
[data-panel="studio"] .st-pill {
  border: 1px solid #37445a; border-radius: 999px; padding: 4px 10px; background: #1a2130;
  color: #b7c6dc; font: 600 11.5px/1.1 inherit; cursor: pointer;
}
[data-panel="studio"] .st-pill.on { background: #2154e4; border-color: #4b79ff; color: #fff; }
[data-panel="studio"] .st-btn {
  border: 1px solid #3c4b64; border-radius: 4px; padding: 6px 10px; background: #242d3e;
  color: #f0f4fa; font: 600 12px/1.1 inherit; cursor: pointer; white-space: nowrap;
}
[data-panel="studio"] .st-btn:hover { background: #2f3b52; border-color: #5b6e8f; }
[data-panel="studio"] .st-btn.sm { padding: 4px 8px; font-size: 11.5px; }
[data-panel="studio"] .st-btn.primary { background: #2154e4; border-color: #4b79ff; color: #fff; }
[data-panel="studio"] .st-btn.primary:hover { background: #2d62f5; }
[data-panel="studio"] .st-btn.accent { background: #d67e1c; border-color: #f4aa4c; color: #170e04; }
[data-panel="studio"] .st-btn.danger { background: #8c2424; border-color: #d64e4e; color: #fff; }
[data-panel="studio"] .st-btn.on { background: #2154e4; border-color: #6b95ff; color: #fff; }
[data-panel="studio"] .st-card {
  background: #171f2e; border: 1.5px solid #2e3b52; border-radius: 6px; padding: 10px 11px;
  display: flex; flex-direction: column; gap: 8px;
}
[data-panel="studio"] .st-warn-card { border-color: #d68526; background: rgba(54, 34, 14, 0.72); }
[data-panel="studio"] .st-accent-card { border-color: #4b79ff; background: rgba(20, 38, 82, 0.52); }
[data-panel="studio"] .st-card-title { font-weight: 700; font-size: 12.5px; color: #f6f9ff; }
[data-panel="studio"] .st-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #8da2c2; }
[data-panel="studio"] .st-muted { margin: 0; font-size: 12px; color: #9eb0ca; }
[data-panel="studio"] .st-input, [data-panel="studio"] .st-select, [data-panel="studio"] .st-textarea {
  width: 100%; padding: 7px 9px; border-radius: 4px; border: 1px solid #3c4b64;
  background: #0d121c; color: #f0f4fa; font: 400 12.5px/1.4 inherit;
}
[data-panel="studio"] .st-select.sm { width: auto; padding: 4px 7px; font-size: 11.5px; }
[data-panel="studio"] .st-toolbar .st-input { flex: 1; min-width: 120px; }
[data-panel="studio"] .st-list { display: flex; flex-direction: column; gap: 6px; }
[data-panel="studio"] .st-thread-row {
  padding: 9px 10px; border-radius: 5px; background: #182131; border: 1px solid #2b384f;
  cursor: pointer; display: flex; flex-direction: column; gap: 4px;
}
[data-panel="studio"] .st-thread-row:hover { border-color: #4b79ff; background: #1d283d; }
[data-panel="studio"] .st-thread-head { display: flex; align-items: center; gap: 7px; }
[data-panel="studio"] .st-thread-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-panel="studio"] .st-thread-meta { display: flex; gap: 5px; flex-wrap: wrap; }
[data-panel="studio"] .st-tag { font: 600 10.5px/1.2 ui-monospace, Menlo, monospace; padding: 2px 6px; border-radius: 3px; background: rgba(158, 176, 202, 0.16); color: #c7d5e8; }
[data-panel="studio"] .st-tag.warn { background: rgba(235, 148, 38, 0.28); color: #ffd089; }
[data-panel="studio"] .st-tag.accent { background: rgba(75, 121, 255, 0.28); color: #bfd4ff; }
[data-panel="studio"] .st-dot { width: 8px; height: 8px; border-radius: 50%; background: #6d7f9c; display: inline-block; }
[data-panel="studio"] .st-dot-connected, [data-panel="studio"] .st-dot-completed { background: #3dd68c; }
[data-panel="studio"] .st-dot-running, [data-panel="studio"] .st-dot-starting, [data-panel="studio"] .st-dot-connecting { background: #4b9aff; }
[data-panel="studio"] .st-dot-failed, [data-panel="studio"] .st-dot-error { background: #ff6961; }
[data-panel="studio"] .st-dot-waiting { background: #f3b547; }
[data-panel="studio"] .st-time { font-size: 11px; color: #8093b0; }
[data-panel="studio"] .st-timeline { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; padding-right: 2px; }
[data-panel="studio"] .st-msg { padding: 8px 10px; border-radius: 5px; background: #161e2c; border: 1px solid #29364c; display: flex; flex-direction: column; gap: 5px; }
[data-panel="studio"] .st-msg-user { background: #1a2742; border-color: #355496; }
[data-panel="studio"] .st-msg-head { display: flex; justify-content: space-between; font-size: 11px; color: #9eb0ca; font-weight: 600; text-transform: uppercase; }
[data-panel="studio"] .st-msg-body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; }
[data-panel="studio"] .st-chips { display: flex; flex-wrap: wrap; gap: 5px; }
[data-panel="studio"] .st-chip {
  font: 500 11px/1.2 ui-monospace, Menlo, monospace; padding: 3px 7px; border-radius: 999px;
  background: rgba(75, 121, 255, 0.18); border: 1px solid rgba(105, 148, 255, 0.36); color: #c7dcff;
}
[data-panel="studio"] .st-chip.clickable { cursor: pointer; }
[data-panel="studio"] .st-chip.clickable:hover { background: rgba(75, 121, 255, 0.36); }
[data-panel="studio"] .st-thumb { max-width: 100%; max-height: 180px; border-radius: 4px; border: 1px solid #35455f; object-fit: contain; }
[data-panel="studio"] .st-mono {
  margin: 0; padding: 8px 9px; border-radius: 4px; background: #0a0e16; border: 1px solid #243044;
  color: #d4e0f0; font: 400 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: auto; max-height: 240px; white-space: pre-wrap; overflow-wrap: anywhere;
}
[data-panel="studio"] .st-composer { display: flex; flex-direction: column; gap: 7px; border-top: 1px solid #28354b; padding-top: 8px; }
[data-panel="studio"] .st-empty { padding: 18px 10px; text-align: center; color: #8c9fb9; font-size: 12.5px; }
[data-panel="studio"] .st-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #c6d3e6; cursor: pointer; }
[data-panel="studio"] .st-mini-row { padding: 6px 8px; border-radius: 4px; background: #141b28; border: 1px solid #253247; font-size: 12px; }
[data-panel="studio"] .st-btn-row { width: 100%; text-align: left; color: #dce6f5; cursor: pointer; }
[data-panel="studio"] .st-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
[data-panel="studio"] .st-compare-stage { position: relative; width: 100%; aspect-ratio: 16/9; background: #080c12; border-radius: 4px; overflow: hidden; border: 1px solid #364762; }
[data-panel="studio"] .st-cmp-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
[data-panel="studio"] .st-range-full { width: 100%; }
[data-panel="studio"] .st-grid { display: grid; gap: 6px; }
[data-panel="studio"] .st-slider { display: grid; gap: 2px; font-size: 11.5px; color: #b7c8e0; }
[data-panel="studio"] .st-fold { background: #121825; border: 1px solid #253147; border-radius: 4px; padding: 6px 8px; font-size: 12px; }
[data-panel="studio"] .st-act-line { padding: 2px 0; color: #a8bad4; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
[data-panel="studio"] .st-err { padding: 7px 9px; border-radius: 4px; background: rgba(160, 36, 36, 0.35); border: 1px solid #e05a5a; color: #ffd2d2; font-size: 12px; }
[data-panel="studio"] .st-busy { padding: 6px 9px; border-radius: 4px; background: rgba(33, 84, 228, 0.25); border: 1px solid #4b79ff; color: #cde0ff; font-size: 12px; }
`

export function createStudioUI(opts: {
  engine: StudioEngineHandle
  transport: T3Transport
  bridge: AgentBridgeHandle
  bugCapture: BugCaptureController
  registry: StudioExtensionRegistry
  getCtx: () => StudioCtx
}): StudioUIHandle {
  const { engine, transport, bridge, bugCapture, registry, getCtx } = opts

  const style = document.createElement('style')
  style.textContent = STUDIO_CSS
  document.head.append(style)

  const panel = engine.hud.panel('studio')
  let leaveInput: (() => void) | null = null
  let unsubShell: (() => void) | null = null
  let unsubThread: (() => void) | null = null
  let unsubCmdOut: (() => void) | null = null
  let labCleanup: (() => void) | null = null
  let voiceRec: MediaRecorder | null = null

  const state: StudioState = {
    open: false,
    layout: 'drawer',
    tab: 'threads',
    environments: [],
    activeEnvironmentId: null,
    localT3: null,
    control: bridge.control,
    agentActivity: null,
    projects: [],
    threads: [],
    threadFilter: 'all',
    searchQuery: '',
    selectedThreadId: null,
    threadDetail: null,
    commandOutput: '',
    newTaskOpen: false,
    composerDraft: {
      title: '',
      text: '',
      projectId: '',
      runtimeMode: 'auto',
      interactionMode: 'default',
      worktree: true,
      model: '',
      deliveryIntent: 'auto',
      contextRecords: [],
      files: [],
      bookmark: null,
    },
    reviewSubtab: 'verify',
    worktrees: [],
    beforeShot: null,
    afterShot: null,
    compareMode: 'wipe',
    compareSplit: 50,
    regressionPreview: null,
    diffText: '',
    filesPath: '',
    filesEntries: [],
    filePreview: null,
    gitInfo: null,
    playtestActive: false,
    playtestNotes: [],
    spatialPinsOn: false,
    autoCatchOn: true,
    sessions: [],
    activeLabPanel: 'voxel-inspector',
    prs: [],
    selectedPr: null,
    prGuide: null,
    issues: [],
    workflows: [],
    scheduledTasks: [],
    usageSummary: null,
    terminalId: null,
    terminalLog: '',
    previews: [],
    devices: [],
    busy: null,
    error: null,
  }

  const syncSpatialPins = () => {
    const pins: SpatialThreadPin[] = []
    for (const n of state.playtestNotes) {
      pins.push({
        threadId: n.threadId ?? n.id,
        title: n.text,
        status: n.threadId ? 'thread' : 'note',
        at: [Math.round(n.bookmark.at[0] * 10), Math.round(n.bookmark.at[1] * 10), Math.round(n.bookmark.at[2] * 10)],
        bookmark: n.bookmark,
      })
    }
    bugCapture.setSpatialPins(pins)
  }

  const applyShellEvent = (ev: unknown) => {
    if (!ev || typeof ev !== 'object') return
    const o = ev as Record<string, unknown>
    const snap = (o.snapshot ?? o.data ?? o) as Record<string, unknown>
    if (Array.isArray(snap.projects)) state.projects = snap.projects as StudioState['projects']
    if (Array.isArray(snap.threads)) state.threads = snap.threads as ThreadSummary[]
    if (o.type === 'thread.upsert' && o.thread && typeof o.thread === 'object') {
      const th = o.thread as ThreadSummary
      const idx = state.threads.findIndex((x) => x.id === th.id)
      if (idx >= 0) state.threads[idx] = { ...state.threads[idx], ...th }
      else state.threads.unshift(th)
    }
    render()
  }

  const subscribeShell = () => {
    unsubShell?.()
    unsubShell = transport.subscribe('orchestration.subscribeShell', {}, applyShellEvent)
  }

  const actions: StudioActions = {
    render: () => render(),
    async refreshStatus() {
      try {
        const s = await transport.status()
        state.environments = s.environments ?? []
        state.activeEnvironmentId = s.activeEnvironmentId ?? null
        state.localT3 = s.localT3 ?? null
        state.sessions = Array.isArray(s.sessions) ? (s.sessions as Array<Record<string, unknown>>) : []
      } catch { /* bridge may still be booting */ }
      render()
    },
    async refreshShell() {
      try {
        const snap = await transport.http<Record<string, unknown>>('GET', '/api/orchestration/shell')
        applyShellEvent(snap)
      } catch { /* fall through to subscribeShell which streams initial snapshot */ }
      try { subscribeShell() } catch { /* disconnected */ }
    },
    selectThread(threadId) {
      unsubThread?.(); unsubThread = null
      unsubCmdOut?.(); unsubCmdOut = null
      state.selectedThreadId = threadId
      state.threadDetail = null
      state.commandOutput = ''
      if (threadId) {
        void transport.http<Record<string, unknown>>('GET', `/api/orchestration/threads/${encodeURIComponent(threadId)}`)
          .then((snap) => { if (state.selectedThreadId === threadId) { state.threadDetail = snap; render() } })
          .catch(() => {})
        unsubThread = transport.subscribe('orchestration.subscribeThread', { threadId }, (ev) => {
          if (state.selectedThreadId !== threadId || !ev || typeof ev !== 'object') return
          const o = ev as Record<string, unknown>
          state.threadDetail = (o.snapshot ?? o.thread ? o : { ...state.threadDetail, ...o }) as Record<string, unknown>
          render()
        })
      }
      render()
    },
    async launchDraft(draft) {
      state.busy = 'Launching T3 thread…'
      state.error = null
      render()
      try {
        const res = await transport.launchThread(draft)
        const rObj = (res.result ?? {}) as Record<string, unknown>
        const newTid = String(rObj.threadId ?? (rObj.thread as Record<string, unknown> | undefined)?.id ?? '')
        state.newTaskOpen = false
        state.composerDraft.title = ''
        state.composerDraft.text = ''
        state.composerDraft.contextRecords = []
        state.composerDraft.files = []
        if (draft.bookmark && draft.files?.[0]) {
          state.beforeShot = { dataUrl: draft.files[0].dataBase64, label: draft.title || 'Before', bookmark: draft.bookmark }
        }
        getCtx().notice('Launched T3 Code thread', 2600)
        await actions.refreshShell()
        if (newTid) actions.selectThread(newTid)
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
      } finally {
        state.busy = null
        render()
      }
    },
    async sendToSelectedThread() {
      const tid = state.selectedThreadId
      const d = state.composerDraft
      if (!tid || !d.text.trim()) return
      state.busy = 'Sending message…'
      state.error = null
      render()
      try {
        await transport.sendMessage({
          threadId: tid,
          text: d.text.trim(),
          contextRecords: d.contextRecords,
          files: d.files,
          deliveryIntent: d.deliveryIntent,
        })
        d.text = ''
        d.contextRecords = []
        d.files = []
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
      } finally {
        state.busy = null
        render()
      }
    },
    async refreshWorktrees() {
      try {
        state.worktrees = await transport.listWorktrees()
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
      }
      render()
    },
    async verifyWorktree(worktreePath) {
      state.busy = `Verifying worktree ${worktreePath.split('/').slice(-1)[0]}…`
      state.error = null
      render()
      try {
        const bm = state.beforeShot?.bookmark ?? bridge.captureBookmark()
        const res = await transport.verifyWorktree({ worktreePath, sessionId: bridge.sessionId, bookmark: bm })
        if (res.mode === 'recore' && typeof res.wasmUrl === 'string' && typeof engine.recore === 'function') {
          const ms = await engine.recore(res.wasmUrl)
          getCtx().notice(`Hot-swapped core.wasm in ${ms} ms`, 3000)
          const after = await bridge.captureFrame('color')
          state.afterShot = { dataUrl: after.dataUrl, label: `After (recore ${ms} ms)`, bookmark: bridge.captureBookmark() }
        } else if (typeof res.previewUrl === 'string') {
          getCtx().notice(`Worktree server live at ${res.previewUrl}`, 4000)
          window.open(res.previewUrl, '_blank', 'noopener')
        }
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
      } finally {
        state.busy = null
        render()
      }
    },
    takeControl() { bridge.takeControl() },
    releaseControl() { bridge.releaseControl() },
    togglePlaytest(on) {
      state.playtestActive = on
      if (on) bridge.startRollingVideo(12)
      else bridge.stopRollingVideo()
      render()
    },
    toggleSpatialPins(on) {
      state.spatialPinsOn = on
      bugCapture.setSpatialPinsVisible(on)
      syncSpatialPins()
      render()
    },
    toggleAutoCatch(on) {
      state.autoCatchOn = on
      bugCapture.setAutoCatchEnabled(on)
      render()
    },
    async addPlaytestNote(text) {
      const bookmark = bridge.captureBookmark()
      const shot = await bridge.captureFrame('color')
      const pick = await bridge.pickAt(0.5, 0.5).catch(() => null)
      state.playtestNotes.unshift({
        id: `pt_${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        text,
        bookmark,
        screenshotDataUrl: shot.dataUrl,
        pick,
      })
      syncSpatialPins()
      getCtx().notice('Saved playtest bookmark', 1800)
      render()
    },
    async recordVoiceTo(onText) {
      if (voiceRec) {
        voiceRec.stop()
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        state.error = 'Microphone unavailable in this browser context.'
        render()
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const rec = new MediaRecorder(stream)
        const chunks: Blob[] = []
        voiceRec = rec
        state.busy = 'Recording voice… click 🎙 again to transcribe'
        render()
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        rec.onstop = async () => {
          voiceRec = null
          for (const t of stream.getTracks()) t.stop()
          state.busy = 'Transcribing voice via T3 Code…'
          render()
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
            const res = await transport.transcribeVoice(blob)
            const txt = String(res.text ?? res.transcript ?? '').trim()
            if (txt) onText(txt)
            else state.error = 'No speech detected.'
          } catch (e) {
            state.error = e instanceof Error ? e.message : String(e)
          } finally {
            state.busy = null
            render()
          }
        }
        rec.start()
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
        render()
      }
    },
  }

  const setOpen = (open: boolean) => {
    if (state.open === open) return
    state.open = open
    if (open) {
      leaveInput = engine.input.push({ name: 'studio', solid: true, text: true })
      void actions.refreshStatus()
      void actions.refreshWorktrees()
    } else {
      leaveInput?.()
      leaveInput = null
    }
    render()
  }

  const render = () => {
    labCleanup?.()
    labCleanup = null
    const ctx = getCtx()
    panel.replaceChildren()

    const activeEnv = state.environments.find((e) => e.environmentId === state.activeEnvironmentId) ?? state.environments[0]
    const dotClass = activeEnv?.state === 'connected' ? 'connected' : activeEnv?.state === 'connecting' ? 'connecting' : 'disconnected'
    const pendingCount = state.threads.reduce((n, t) => n + (t.pendingApprovalCount ?? 0) + (t.pendingUserInputCount ?? 0), 0)

    // Live Agent Driving Banner (shown even when IDE is collapsed so player is always in control!)
    if (state.control.owner === 'agent' && !state.control.humanInControl) {
      const banner = h('div', { class: 'vw-agent-banner' },
        h('span', {}, `Agent driving${state.agentActivity ? `: ${state.agentActivity.op}` : ''}`),
        (() => {
          const b = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Take Control (Esc)')
          b.onclick = () => actions.takeControl()
          return b
        })(),
      )
      panel.append(banner)
    }

    // Collapsed minimal corner status pill (top-right, clear of Settings gear and character body)
    if (!state.open) {
      const pill = h('div', { class: 'vw-studio-pill' })
      const openBtn = h('button', { class: 'st-btn sm primary', type: 'button', title: 'Open T3 Studio IDE (F2 / Cmd+Shift+I)' },
        pendingCount > 0 ? `T3 Studio (${pendingCount})` : 'T3 Studio',
      )
      openBtn.onclick = () => setOpen(true)
      const f9Btn = h('button', { class: 'st-btn sm accent', type: 'button', title: 'Bug in View (F9)' }, 'F9')
      f9Btn.onclick = () => void ctx.fireBugInView()
      const f10Btn = h('button', { class: 'st-btn sm', type: 'button', title: 'What Just Happened? 30s Rewind (F10)' }, 'F10')
      f10Btn.onclick = () => void ctx.fireRewindBug()
      pill.append(h('span', { class: `st-dot st-dot-${dotClass}`, title: activeEnv ? `${activeEnv.label}: ${activeEnv.state}` : 'Not connected' }), openBtn, f9Btn, f10Btn)
      panel.append(pill)
      return
    }

    // Open IDE Shell
    const shell = h('div', { class: `st-shell layout-${state.layout}` })
    const top = h('div', { class: 'st-top' },
      h('div', { class: 'st-brand' },
        h('span', { class: `st-dot st-dot-${dotClass}` }),
        'Voxelwright T3 Studio',
      ),
    )
    const controls = h('div', { class: 'st-row' })
    const dockBtn = h('button', { class: 'st-btn sm', type: 'button', title: 'Cycle Dock Layout (Drawer / Wide / Bottom)' }, state.layout === 'drawer' ? '⇔' : state.layout === 'wide' ? '⬓' : '◧')
    dockBtn.onclick = () => {
      state.layout = state.layout === 'drawer' ? 'wide' : state.layout === 'wide' ? 'bottom' : 'drawer'
      render()
    }
    const bugBtn = h('button', { class: 'st-btn sm accent', type: 'button', title: 'Bug in View (F9)' }, 'F9')
    bugBtn.onclick = () => { setOpen(false); void ctx.fireBugInView() }
    const rwBtn = h('button', { class: 'st-btn sm', type: 'button', title: '30s Rewind (F10)' }, 'F10')
    rwBtn.onclick = () => { setOpen(false); void ctx.fireRewindBug() }
    const closeBtn = h('button', { class: 'st-btn sm', type: 'button', title: 'Collapse Studio (F2 / Esc)' }, '✕')
    closeBtn.onclick = () => setOpen(false)
    controls.append(dockBtn, bugBtn, rwBtn, closeBtn)
    top.append(controls)

    const tabs = h('div', { class: 'st-tabs' })
    const tabDefs: Array<[StudioTab, string]> = [
      ['threads', pendingCount ? `Threads (${pendingCount})` : 'Threads'],
      ['review', 'Review'],
      ['prs', 'PRs'],
      ['tools', 'Tools'],
      ['lab', 'IDE Lab'],
      ['ops', 'Envs'],
    ]
    for (const [id, label] of tabDefs) {
      const b = h('button', { class: `st-tab ${state.tab === id ? 'on' : ''}`, type: 'button', 'data-tab': id }, label)
      b.onclick = () => { state.tab = id; state.error = null; render() }
      tabs.append(b)
    }

    const body = h('div', { class: 'st-body' })
    if (state.busy) body.append(h('div', { class: 'st-busy' }, state.busy))
    if (state.error) body.append(h('div', { class: 'st-err' }, state.error))

    if (state.tab === 'threads') body.append(renderThreadsView(state, ctx, actions))
    else if (state.tab === 'review') body.append(renderReviewView(state, ctx, actions))
    else if (state.tab === 'prs') body.append(renderPrIssuesView(state, ctx, actions))
    else if (state.tab === 'tools') body.append(renderToolsView(state, ctx, actions))
    else if (state.tab === 'lab') body.append(renderLabView(state, ctx, registry, actions, (fn) => { labCleanup = fn }))
    else body.append(renderOpsView(state, ctx, actions))

    shell.append(top, tabs, body)
    panel.append(shell)
  }

  // Hotkeys: F2 or Cmd/Ctrl+Shift+I toggles Studio IDE (works even while Studio's text mode is active);
  // Esc closes IDE or grabs human control from a driving agent.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'F2' || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyI')) {
      e.preventDefault()
      setOpen(!state.open)
      return
    }
    if (e.key === 'Escape') {
      if (state.open) {
        e.preventDefault()
        setOpen(false)
      } else if (state.control.owner === 'agent' && !state.control.humanInControl) {
        e.preventDefault()
        actions.takeControl()
      }
    }
  }
  addEventListener('keydown', onKeyDown)

  // Live bridge events (T3 connection updates, Game-Use session updates)
  const unsubBridgeEvents = transport.onEvent((ev) => {
    if (ev.channel === 't3' || ev.type === 'init') {
      void actions.refreshStatus()
      if (ev.type === 'connection.state' && ev.state === 'connected') void actions.refreshShell()
    }
    if (ev.channel === 'game') {
      void actions.refreshStatus()
    }
  })
  const unsubRegistry = registry.onChange(() => { if (state.open && state.tab === 'lab') render() })

  void transport.connect().then(async () => {
    await actions.refreshStatus()
    await actions.refreshShell()
  })
  render()

  return {
    get open() { return state.open },
    show: setOpen,
    toggle: () => setOpen(!state.open),
    openComposerWithDraft(draft, immediateLaunch = false) {
      state.tab = 'threads'
      state.selectedThreadId = null
      state.composerDraft.title = draft.title ?? ''
      state.composerDraft.text = draft.text
      state.composerDraft.contextRecords = [...(draft.contextRecords ?? [])]
      state.composerDraft.files = [...(draft.files ?? [])]
      state.composerDraft.bookmark = draft.bookmark ?? null
      state.composerDraft.worktree = draft.workspaceStrategy?.type !== 'root'
      if (draft.bookmark && draft.files?.[0]) {
        state.beforeShot = { dataUrl: draft.files[0].dataBase64, label: draft.title || 'Before', bookmark: draft.bookmark }
      }
      state.newTaskOpen = true
      setOpen(true)
      if (immediateLaunch) {
        void actions.launchDraft(draft)
      }
    },
    openThread(threadId) {
      state.tab = 'threads'
      state.newTaskOpen = false
      setOpen(true)
      actions.selectThread(threadId)
    },
    onControlChange(control) {
      state.control = control
      render()
    },
    onAgentActivity(info) {
      state.agentActivity = { ...info, at: Date.now() }
      render()
    },
    dispose() {
      removeEventListener('keydown', onKeyDown)
      unsubBridgeEvents()
      unsubRegistry()
      unsubShell?.()
      unsubThread?.()
      unsubCmdOut?.()
      labCleanup?.()
      leaveInput?.()
      panel.replaceChildren()
      style.remove()
    },
  }
}
