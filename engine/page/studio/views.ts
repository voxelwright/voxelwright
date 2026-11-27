// Core T3 Code iOS parity views for Voxelwright Studio (#98):
//   - Shared state & safe DOM helpers (never puts untrusted text into innerHTML)
//   - Threads (Active / Inbox / Pinned / Settled / Archived, Search, New Task, Live Detail,
//     Approvals / Questions / Secrets / Feedback / PeerLinks / Layout Commands, Subagents,
//     Queue controls, Voice Dictation, @ File Mentions, Game Context Chips)
//   - Review / Verify Fix Here (Before/After wipe & blink comparator, live worktree hot-swap,
//     1-click Regression Check export, Turn & Full Diffs, Checkpoints, Files, Git/VCS)
import type {
  GameBookmark,
  GameContextRecord,
  PlaytestNote,
  StudioControlState,
  StudioCtx,
  T3EnvironmentSummary,
  ThreadLaunchDraft,
  UploadedFileDraft,
} from './types.ts'

export type StudioTab = 'threads' | 'review' | 'prs' | 'tools' | 'ops' | 'lab'
export type StudioLayout = 'drawer' | 'wide' | 'bottom'

export interface ThreadSummary {
  id: string
  projectId?: string
  title?: string
  status?: string
  branch?: string | null
  worktreePath?: string | null
  updatedAt?: string
  createdAt?: string
  pinned?: boolean
  archived?: boolean
  settled?: boolean
  unread?: boolean
  snoozedUntil?: string | null
  pendingApprovalCount?: number
  pendingUserInputCount?: number
}

export interface ProjectSummary {
  id: string
  title?: string
  name?: string
  workspaceRoot?: string
}

export interface StudioState {
  open: boolean
  layout: StudioLayout
  tab: StudioTab
  environments: T3EnvironmentSummary[]
  activeEnvironmentId: string | null
  localT3: { origin: string; label: string; environmentId: string | null; serverVersion: string | null } | null
  control: StudioControlState
  agentActivity: { agentId: string; op: string; at: number } | null
  projects: ProjectSummary[]
  threads: ThreadSummary[]
  threadFilter: 'all' | 'inbox' | 'pinned' | 'settled' | 'archived'
  searchQuery: string
  selectedThreadId: string | null
  threadDetail: Record<string, unknown> | null
  commandOutput: string
  newTaskOpen: boolean
  composerDraft: {
    title: string
    text: string
    projectId: string
    runtimeMode: 'approval-required' | 'auto-accept-edits' | 'auto' | 'full-access'
    interactionMode: 'default' | 'plan'
    worktree: boolean
    model: string
    deliveryIntent: 'auto' | 'steer' | 'restart'
    contextRecords: GameContextRecord[]
    files: UploadedFileDraft[]
    bookmark: GameBookmark | null
  }
  reviewSubtab: 'verify' | 'diffs' | 'files' | 'git'
  worktrees: Array<{ path: string; head?: string; branch?: string; previewUrl?: string | null }>
  beforeShot: { dataUrl: string; label: string; bookmark: GameBookmark | null } | null
  afterShot: { dataUrl: string; label: string; bookmark: GameBookmark | null } | null
  compareMode: 'wipe' | 'blink'
  compareSplit: number
  regressionPreview: { filename: string; source: string } | null
  diffText: string
  filesPath: string
  filesEntries: Array<{ name: string; path: string; type?: string }>
  filePreview: { path: string; content: string } | null
  gitInfo: Record<string, unknown> | null
  playtestActive: boolean
  playtestNotes: PlaytestNote[]
  spatialPinsOn: boolean
  autoCatchOn: boolean
  sessions: Array<Record<string, unknown>>
  activeLabPanel: string
  prs: Array<Record<string, unknown>>
  selectedPr: Record<string, unknown> | null
  prGuide: Record<string, unknown> | null
  issues: Array<Record<string, unknown>>
  workflows: Array<Record<string, unknown>>
  scheduledTasks: Array<Record<string, unknown>>
  usageSummary: Record<string, unknown> | null
  terminalId: string | null
  terminalLog: string
  previews: Array<Record<string, unknown>>
  devices: Array<Record<string, unknown>>
  busy: string | null
  error: string | null
}

export interface StudioActions {
  render(): void
  refreshStatus(): Promise<void>
  refreshShell(): Promise<void>
  selectThread(threadId: string | null): void
  launchDraft(draft: ThreadLaunchDraft): Promise<void>
  sendToSelectedThread(): Promise<void>
  refreshWorktrees(): Promise<void>
  verifyWorktree(worktreePath: string): Promise<void>
  takeControl(): void
  releaseControl(): void
  togglePlaytest(on: boolean): void
  toggleSpatialPins(on: boolean): void
  toggleAutoCatch(on: boolean): void
  addPlaytestNote(text: string): Promise<void>
  recordVoiceTo(onText: (text: string) => void): Promise<void>
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | null | undefined> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else el.setAttribute(k, String(v))
  }
  for (const c of children) {
    if (c === null || c === undefined) continue
    el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

export function fmtAgo(iso?: string): string {
  if (!iso) return ''
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000))
  if (Number.isNaN(s)) return ''
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function parseBookmarkFromContext(rec: Record<string, unknown>): GameBookmark | null {
  const p = (rec.payload ?? rec) as Record<string, unknown>
  if (!Array.isArray(p.at) || p.at.length !== 3 || !Array.isArray(p.look) || p.look.length !== 2) return null
  return {
    at: [Number(p.at[0]), Number(p.at[1]), Number(p.at[2])],
    look: [Number(p.look[0]), Number(p.look[1])],
    hour: typeof p.hour === 'number' ? p.hour : null,
    weather: typeof p.weather === 'string' ? p.weather : null,
    rain: typeof p.rain === 'number' ? p.rain : 0,
    fog: typeof p.fog === 'number' ? p.fog : 0,
    scale: typeof p.scale === 'number' ? p.scale : 1,
    flags: typeof p.flags === 'number' ? p.flags : 0,
    mode: p.mode === 'foot' || p.mode === 'riding' ? p.mode : 'flying',
    realm: typeof p.realm === 'string' ? p.realm : null,
    reproUrl: typeof p.reproUrl === 'string' ? p.reproUrl : location.href,
    where: typeof p.where === 'string' ? p.where : undefined,
    capturedAt: typeof p.capturedAt === 'string' ? p.capturedAt : new Date().toISOString(),
  }
}

export function renderThreadsView(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const wrap = h('div', { class: 'st-view' })
  const activeEnv = state.environments.find((e) => e.environmentId === state.activeEnvironmentId) ?? state.environments[0]

  // Connection banner if disconnected
  if (!activeEnv || activeEnv.state !== 'connected') {
    const card = h('div', { class: 'st-card st-warn-card' },
      h('div', { class: 'st-card-title' }, activeEnv ? `T3 Code (${activeEnv.label}): ${activeEnv.state}` : 'Connect to T3 Code'),
      h('p', { class: 'st-muted' }, activeEnv?.lastError || 'Auto-connect to your local T3 Code server or open Ops -> Environments to pair via URL/code.'),
    )
    const row = h('div', { class: 'st-row' })
    const autoBtn = h('button', { class: 'st-btn primary', type: 'button' }, 'Auto-Connect Local T3')
    autoBtn.onclick = async () => {
      state.busy = 'Connecting to local T3 Code…'
      state.error = null
      actions.render()
      try {
        await ctx.transport.autoConnectLocal()
        await actions.refreshStatus()
        await actions.refreshShell()
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
      } finally {
        state.busy = null
        actions.render()
      }
    }
    const pairBtn = h('button', { class: 'st-btn', type: 'button' }, 'Pair / Settings')
    pairBtn.onclick = () => { state.tab = 'ops'; actions.render() }
    row.append(autoBtn, pairBtn)
    card.append(row)
    wrap.append(card)
  }

  // If creating a new task (or fired via F9/F10 -> Edit in Composer)
  if (state.newTaskOpen) {
    wrap.append(renderNewTaskSheet(state, ctx, actions))
    return wrap
  }

  // If a thread is selected, render full Thread Detail (T3 iOS parity)
  if (state.selectedThreadId) {
    wrap.append(renderThreadDetail(state, ctx, actions))
    return wrap
  }

  // Thread list view (Inbox / All / Pinned / Settled / Archived + Search + New Task)
  const topBar = h('div', { class: 'st-row st-toolbar' })
  const search = h('input', { class: 'st-input', type: 'search', placeholder: 'Search threads…', value: state.searchQuery })
  search.oninput = () => { state.searchQuery = search.value; actions.render() }
  search.onkeydown = async (e) => {
    if (e.key === 'Enter' && state.searchQuery.trim()) {
      try {
        const res = await ctx.transport.rpc<{ threads?: ThreadSummary[] }>('orchestration.searchThreads', { query: state.searchQuery.trim(), limit: 40 })
        if (Array.isArray(res?.threads)) { state.threads = res.threads; actions.render() }
      } catch { /* fallback to local filter */ }
    }
  }
  const newBtn = h('button', { class: 'st-btn primary', type: 'button' }, '+ New Task')
  newBtn.onclick = () => { state.newTaskOpen = true; actions.render() }
  const bugBtn = h('button', { class: 'st-btn accent', type: 'button', title: 'Bug in View (F9)' }, 'F9 Bug')
  bugBtn.onclick = () => void ctx.fireBugInView()
  topBar.append(search, newBtn, bugBtn)
  wrap.append(topBar)

  const filters = h('div', { class: 'st-pills' })
  const filterDefs: Array<[StudioState['threadFilter'], string]> = [
    ['all', 'Active'],
    ['inbox', 'Inbox'],
    ['pinned', 'Pinned'],
    ['settled', 'Settled'],
    ['archived', 'Archived'],
  ]
  for (const [id, label] of filterDefs) {
    const b = h('button', { class: `st-pill ${state.threadFilter === id ? 'on' : ''}`, type: 'button' }, label)
    b.onclick = async () => {
      state.threadFilter = id
      if (id === 'archived') {
        try {
          const snap = await ctx.transport.rpc<{ threads?: ThreadSummary[] }>('orchestration.getArchivedShellSnapshot', {})
          if (Array.isArray(snap?.threads)) state.threads = mergeThreads(state.threads, snap.threads)
        } catch { /* ignore */ }
      } else if (id === 'settled') {
        try {
          const snap = await ctx.transport.rpc<{ threads?: ThreadSummary[] }>('orchestration.getOlderSettledThreads', { limit: 50 })
          if (Array.isArray(snap?.threads)) state.threads = mergeThreads(state.threads, snap.threads)
        } catch { /* ignore */ }
      }
      actions.render()
    }
    filters.append(b)
  }
  wrap.append(filters)

  const q = state.searchQuery.trim().toLowerCase()
  const filtered = state.threads.filter((t) => {
    if (q && !String(t.title ?? t.id).toLowerCase().includes(q) && !String(t.branch ?? '').toLowerCase().includes(q)) return false
    if (state.threadFilter === 'archived') return Boolean(t.archived)
    if (state.threadFilter === 'pinned') return Boolean(t.pinned) && !t.archived
    if (state.threadFilter === 'settled') return Boolean(t.settled) && !t.archived
    if (state.threadFilter === 'inbox') return Boolean(t.unread || t.pendingApprovalCount || t.pendingUserInputCount) && !t.archived
    return !t.archived
  })

  if (!filtered.length) {
    wrap.append(h('div', { class: 'st-empty' }, state.threads.length ? 'No threads match this filter.' : 'No threads yet. Press F9 for Bug-in-View, F10 for Rewind, or + New Task.'))
    return wrap
  }

  const list = h('div', { class: 'st-list' })
  for (const t of filtered) {
    const item = h('div', { class: 'st-thread-row', 'data-thread-id': t.id })
    const head = h('div', { class: 'st-thread-head' },
      h('span', { class: `st-dot st-dot-${String(t.status || 'idle')}` }),
      h('span', { class: 'st-thread-title' }, t.title || t.id),
      h('span', { class: 'st-time' }, fmtAgo(t.updatedAt || t.createdAt)),
    )
    const meta = h('div', { class: 'st-thread-meta' })
    if (t.branch) meta.append(h('span', { class: 'st-tag' }, t.branch))
    if (t.status) meta.append(h('span', { class: 'st-tag' }, t.status))
    if (t.pendingApprovalCount) meta.append(h('span', { class: 'st-tag warn' }, `${t.pendingApprovalCount} approval`))
    if (t.pendingUserInputCount) meta.append(h('span', { class: 'st-tag accent' }, `${t.pendingUserInputCount} question`))
    if (t.pinned) meta.append(h('span', { class: 'st-tag' }, 'pinned'))
    item.append(head, meta)
    item.onclick = () => actions.selectThread(t.id)
    list.append(item)
  }
  wrap.append(list)
  return wrap
}

function mergeThreads(existing: ThreadSummary[], extra: ThreadSummary[]): ThreadSummary[] {
  const byId = new Map<string, ThreadSummary>()
  for (const t of existing) byId.set(t.id, t)
  for (const t of extra) byId.set(t.id, { ...byId.get(t.id), ...t })
  return [...byId.values()]
}

function renderNewTaskSheet(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const d = state.composerDraft
  const box = h('div', { class: 'st-card' })
  const head = h('div', { class: 'st-row st-space' },
    h('strong', {}, 'New T3 Code Task'),
    (() => {
      const c = h('button', { class: 'st-btn', type: 'button' }, 'Back')
      c.onclick = () => { state.newTaskOpen = false; actions.render() }
      return c
    })(),
  )

  const titleIn = h('input', { class: 'st-input', placeholder: 'Thread title (optional)', value: d.title })
  titleIn.oninput = () => { d.title = titleIn.value }

  const projSel = h('select', { class: 'st-select' })
  projSel.append(h('option', { value: '' }, 'Default Project'))
  for (const p of state.projects) {
    const opt = h('option', { value: p.id, selected: d.projectId === p.id }, p.title || p.name || p.workspaceRoot || p.id)
    projSel.append(opt)
  }
  projSel.onchange = () => { d.projectId = projSel.value }

  const modeRow = h('div', { class: 'st-row' })
  const rtSel = h('select', { class: 'st-select' })
  for (const m of ['auto', 'approval-required', 'auto-accept-edits', 'full-access'] as const) {
    rtSel.append(h('option', { value: m, selected: d.runtimeMode === m }, `Runtime: ${m}`))
  }
  rtSel.onchange = () => { d.runtimeMode = rtSel.value as typeof d.runtimeMode }

  const intSel = h('select', { class: 'st-select' })
  for (const m of ['default', 'plan'] as const) {
    intSel.append(h('option', { value: m, selected: d.interactionMode === m }, `Mode: ${m}`))
  }
  intSel.onchange = () => { d.interactionMode = intSel.value as typeof d.interactionMode }
  modeRow.append(rtSel, intSel)

  const wtLabel = h('label', { class: 'st-check' })
  const wtChk = h('input', { type: 'checkbox', checked: d.worktree })
  wtChk.onchange = () => { d.worktree = wtChk.checked }
  wtLabel.append(wtChk, 'Isolated git worktree (start from origin/main)')

  const promptIn = h('textarea', { class: 'st-textarea', rows: 5, placeholder: 'Describe the task, bug, or feature to build…' })
  promptIn.value = d.text
  promptIn.oninput = () => { d.text = promptIn.value }

  // Game Context quick-attach strip
  const ctxStrip = renderGameContextAttachRow(state, ctx, actions)

  const chips = h('div', { class: 'st-chips' })
  for (const rec of d.contextRecords) chips.append(h('span', { class: 'st-chip' }, `${rec.kind}: ${rec.label}`))
  for (const f of d.files) chips.append(h('span', { class: 'st-chip' }, `file: ${f.name}`))

  const foot = h('div', { class: 'st-row st-space' })
  const micBtn = h('button', { class: 'st-btn', type: 'button' }, '🎙 Dictate')
  micBtn.onclick = () => void actions.recordVoiceTo((txt) => {
    d.text = d.text ? `${d.text}\n${txt}` : txt
    actions.render()
  })
  const goBtn = h('button', { class: 'st-btn primary', type: 'button' }, 'Launch T3 Thread')
  goBtn.onclick = async () => {
    if (!d.text.trim()) { state.error = 'Write a prompt first.'; actions.render(); return }
    await actions.launchDraft({
      title: d.title.trim() || undefined,
      text: d.text.trim(),
      projectId: d.projectId || state.projects[0]?.id,
      runtimeMode: d.runtimeMode,
      interactionMode: d.interactionMode,
      workspaceStrategy: d.worktree ? { type: 'worktree', startFromOrigin: true } : { type: 'root' },
      contextRecords: d.contextRecords,
      files: d.files,
      bookmark: d.bookmark,
    })
  }
  foot.append(micBtn, goBtn)

  box.append(head, titleIn, projSel, modeRow, wtLabel, ctxStrip, chips, promptIn, foot)
  return box
}

function renderGameContextAttachRow(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const row = h('div', { class: 'st-row' })
  const d = state.composerDraft
  const addFrame = h('button', { class: 'st-btn sm', type: 'button' }, '+ Frame')
  addFrame.onclick = async () => {
    const bm = ctx.captureBookmark()
    const shot = await ctx.captureFrame('color')
    d.bookmark = bm
    d.files.push({ name: 'frame.png', mimeType: 'image/png', dataBase64: shot.dataUrl, label: 'Game Frame', type: 'image' })
    d.contextRecords.push({ kind: 'game-frame', label: `Scene @ ${bm.where || bm.at.join(',')}`, payload: bm as unknown as Record<string, unknown> })
    state.beforeShot = { dataUrl: shot.dataUrl, label: `Before (${bm.where || bm.at.join(',')})`, bookmark: bm }
    actions.render()
  }
  const addPick = h('button', { class: 'st-btn sm', type: 'button' }, '+ 3D Pick')
  addPick.onclick = async () => {
    const pick = await ctx.pickAt(0.5, 0.5)
    d.contextRecords.push({ kind: 'game-pick', label: `Cell [${pick.cell.join(',')}]`, payload: pick as unknown as Record<string, unknown> })
    actions.render()
  }
  const addHeat = h('button', { class: 'st-btn sm', type: 'button' }, '+ Heat Map')
  addHeat.onclick = async () => {
    const shot = await ctx.captureFrame('heat')
    d.files.push({ name: 'heat.png', mimeType: 'image/png', dataBase64: shot.dataUrl, label: 'Raymarch Heatmap', type: 'image' })
    actions.render()
  }
  const addTrace = h('button', { class: 'st-btn sm', type: 'button' }, '+ 30s Trace')
  addTrace.onclick = async () => {
    const tr = await ctx.readRecorder('studio-composer')
    if (tr) {
      d.contextRecords.push({
        kind: 'game-timeline',
        label: `Trace (${tr.keyframes.length} kf, ${tr.anomalies.length} anomalies)`,
        payload: { summary: tr.summary, anomalies: tr.anomalies.slice(-15), events: tr.events.slice(-40), keyframes: tr.keyframes.slice(-20) },
      })
      actions.render()
    }
  }
  const clearCtx = h('button', { class: 'st-btn sm', type: 'button' }, 'Clear')
  clearCtx.onclick = () => { d.contextRecords = []; d.files = []; actions.render() }
  row.append(addFrame, addPick, addHeat, addTrace, clearCtx)
  return row
}

function renderThreadDetail(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const tid = state.selectedThreadId!
  const summary = state.threads.find((t) => t.id === tid)
  const detail = state.threadDetail ?? {}
  const threadObj = (detail.thread ?? detail) as Record<string, unknown>
  const title = String(threadObj.title ?? summary?.title ?? tid)
  const branch = (threadObj.branch ?? summary?.branch ?? null) as string | null
  const worktreePath = (threadObj.worktreePath ?? summary?.worktreePath ?? null) as string | null
  const status = String(threadObj.status ?? summary?.status ?? 'idle')

  const root = h('div', { class: 'st-detail' })

  // Header & Thread Actions (Back, Verify Fix Here, Fork, Merge Back, Pin, Settle, Archive, Interrupt/Force-Stop)
  const top = h('div', { class: 'st-row st-space' })
  const backBtn = h('button', { class: 'st-btn sm', type: 'button' }, '← Threads')
  backBtn.onclick = () => actions.selectThread(null)
  const titleEl = h('strong', { class: 'st-ellipsis', title }, title)
  top.append(backBtn, titleEl, h('span', { class: 'st-tag' }, status))
  root.append(top)

  const actBar = h('div', { class: 'st-row' })
  if (worktreePath || branch) {
    const verifyBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Verify Fix Here')
    verifyBtn.onclick = () => {
      state.tab = 'review'
      state.reviewSubtab = 'verify'
      if (worktreePath) void actions.verifyWorktree(worktreePath)
      else actions.render()
    }
    actBar.append(verifyBtn)
  }
  const rpcAction = (label: string, cmd: Record<string, unknown>, cls = 'st-btn sm') => {
    const b = h('button', { class: cls, type: 'button' }, label)
    b.onclick = async () => {
      try {
        await ctx.transport.rpc('orchestration.dispatchCommand', { commandId: crypto.randomUUID(), threadId: tid, ...cmd })
        ctx.notice(`${label} sent`, 1800)
        await actions.refreshShell()
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
        actions.render()
      }
    }
    return b
  }
  actBar.append(
    rpcAction('Interrupt', { type: 'thread.turn.interrupt' }),
    rpcAction('Fork', { type: 'thread.fork' }),
    rpcAction(summary?.pinned ? 'Unpin' : 'Pin', { type: 'thread.meta.update', pinned: !summary?.pinned }),
    rpcAction(summary?.settled ? 'Unsettle' : 'Settle', { type: 'thread.meta.update', settled: !summary?.settled }),
    rpcAction('Archive', { type: 'thread.archive' }),
    (() => {
      const b = h('button', { class: 'st-btn sm danger', type: 'button' }, 'Force Stop')
      b.onclick = async () => {
        try {
          await ctx.transport.rpc('orchestration.forceStopThread', { threadId: tid })
          ctx.notice('Force Stop sent', 1800)
          await actions.refreshShell()
        } catch (e) {
          state.error = e instanceof Error ? e.message : String(e)
          actions.render()
        }
      }
      return b
    })(),
  )
  root.append(actBar)

  // Pending Interactive Requests (Approvals, User-Input Questions, Secrets, Feedback, Peer Links, Layout Commands)
  const pendingApprovals = asArray(detail.pendingApprovals ?? threadObj.pendingApprovals)
  for (const req of pendingApprovals) {
    const card = h('div', { class: 'st-card st-warn-card' },
      h('div', { class: 'st-card-title' }, `Approval Required: ${String(req.toolName ?? req.kind ?? 'Command')}`),
      h('pre', { class: 'st-mono' }, String(req.summary ?? req.command ?? JSON.stringify(req, null, 2)).slice(0, 600)),
    )
    const row = h('div', { class: 'st-row' })
    for (const [label, decision, cls] of [
      ['Approve Once', 'accept', 'st-btn sm primary'],
      ['Approve Session', 'acceptForSession', 'st-btn sm'],
      ['Deny', 'decline', 'st-btn sm danger'],
    ] as const) {
      const b = h('button', { class: cls, type: 'button' }, label)
      b.onclick = async () => {
        await ctx.transport.rpc('orchestration.dispatchCommand', {
          type: 'thread.approval.respond',
          commandId: crypto.randomUUID(),
          threadId: tid,
          requestId: req.requestId ?? req.id,
          decision,
        })
        actions.selectThread(tid)
      }
      row.append(b)
    }
    card.append(row)
    root.append(card)
  }

  const pendingQuestions = asArray(detail.pendingUserInputs ?? threadObj.pendingUserInputs)
  for (const q of pendingQuestions) {
    const card = h('div', { class: 'st-card st-accent-card' },
      h('div', { class: 'st-card-title' }, `Agent Question: ${String(q.prompt ?? q.question ?? 'Answer needed')}`),
    )
    const ansIn = h('input', { class: 'st-input', placeholder: 'Type answer…' })
    const sendBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Send Answer')
    sendBtn.onclick = async () => {
      await ctx.transport.rpc('orchestration.dispatchCommand', {
        type: 'thread.user-input.respond',
        commandId: crypto.randomUUID(),
        threadId: tid,
        requestId: q.requestId ?? q.id,
        answers: { answer: ansIn.value },
      })
      actions.selectThread(tid)
    }
    card.append(ansIn, sendBtn)
    root.append(card)
  }

  const pendingSecrets = asArray(detail.pendingSecrets ?? threadObj.pendingSecrets)
  for (const s of pendingSecrets) {
    const card = h('div', { class: 'st-card st-warn-card' },
      h('div', { class: 'st-card-title' }, `Secret Requested: ${String(s.label ?? 'Secret')}`),
      h('p', { class: 'st-muted' }, String(s.reason ?? '')),
    )
    const secIn = h('input', { class: 'st-input', type: 'password', placeholder: String(s.placeholder ?? 'Enter secret value') })
    const row = h('div', { class: 'st-row' })
    const submitBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Provide Secret')
    submitBtn.onclick = async () => {
      await ctx.transport.rpc('secrets.answerRequest', { requestId: s.requestId ?? s.id, accepted: true, value: secIn.value })
      secIn.value = ''
      actions.selectThread(tid)
    }
    const cancelBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'Decline')
    cancelBtn.onclick = async () => {
      await ctx.transport.rpc('secrets.answerRequest', { requestId: s.requestId ?? s.id, accepted: false })
      actions.selectThread(tid)
    }
    row.append(submitBtn, cancelBtn)
    card.append(secIn, row)
    root.append(card)
  }

  // Messages Timeline
  const timeline = h('div', { class: 'st-timeline' })
  const messages = asArray(detail.messages ?? threadObj.messages)
  if (!messages.length) {
    timeline.append(h('div', { class: 'st-empty' }, 'Waiting for messages…'))
  }
  for (const m of messages) {
    const role = String(m.role ?? m.author ?? 'assistant')
    const bubble = h('div', { class: `st-msg st-msg-${role}` })
    bubble.append(h('div', { class: 'st-msg-head' },
      h('span', { class: 'st-msg-role' }, role),
      h('span', { class: 'st-time' }, fmtAgo(typeof m.createdAt === 'string' ? m.createdAt : undefined)),
    ))
    const text = String(m.text ?? m.content ?? '')
    if (text) bubble.append(h('div', { class: 'st-msg-body' }, text))

    // Render clickable game-* context chips (teleport camera directly to bug spot!)
    const ctxObj = m.context as { records?: Array<Record<string, unknown>> } | undefined
    if (Array.isArray(ctxObj?.records) && ctxObj.records.length) {
      const chips = h('div', { class: 'st-chips' })
      for (const rec of ctxObj.records) {
        const bm = parseBookmarkFromContext(rec)
        if (bm) {
          const btn = h('button', { class: 'st-chip clickable', type: 'button', title: 'Teleport camera to this captured view' }, `⌖ ${String(rec.label || rec.kind)}`)
          btn.onclick = () => {
            ctx.teleportToBookmark(bm)
            ctx.notice(`Teleported to ${bm.where || bm.at.join(',')}`, 2000)
          }
          chips.append(btn)
        } else {
          chips.append(h('span', { class: 'st-chip' }, `${String(rec.kind)}: ${String(rec.label || '')}`))
        }
      }
      bubble.append(chips)
    }
    // Render attachments via CORP-safe bridge proxy!
    const atts = asArray(m.attachments)
    for (const att of atts) {
      if (att.type === 'image' && (att.url || att.path)) {
        const img = h('img', {
          class: 'st-thumb',
          src: ctx.transport.assetUrl(String(att.url ?? att.path)),
          alt: String(att.name ?? 'attachment'),
        })
        bubble.append(img)
      }
    }
    timeline.append(bubble)
  }

  // Activities / tool calls summary
  const activities = asArray(detail.activities ?? threadObj.activities).slice(-8)
  if (activities.length) {
    const det = h('details', { class: 'st-fold' }, h('summary', {}, `Activity (${activities.length} recent)`))
    for (const a of activities) {
      det.append(h('div', { class: 'st-act-line' }, `${String(a.kind ?? a.type ?? 'step')}: ${String(a.summary ?? a.title ?? '').slice(0, 120)}`))
    }
    timeline.append(det)
  }

  if (state.commandOutput) {
    timeline.append(h('details', { class: 'st-fold', open: true },
      h('summary', {}, 'Live Command Output'),
      h('pre', { class: 'st-mono' }, state.commandOutput.slice(-4000)),
    ))
  }

  // Message Queue strip (edit / promote to steer / cancel)
  const queued = asArray(detail.queuedMessages ?? threadObj.queuedMessages)
  if (queued.length) {
    const qBox = h('div', { class: 'st-card' }, h('div', { class: 'st-card-title' }, `Queued Messages (${queued.length})`))
    for (const qm of queued) {
      const row = h('div', { class: 'st-row st-space' },
        h('span', { class: 'st-ellipsis' }, String(qm.text ?? qm.id)),
        (() => {
          const b = h('button', { class: 'st-btn sm', type: 'button' }, 'Steer')
          b.onclick = async () => {
            await ctx.transport.rpc('orchestration.dispatchCommand', { type: 'thread.queue.promote_to_steer', commandId: crypto.randomUUID(), threadId: tid, queuedRunId: qm.id })
          }
          return b
        })(),
        (() => {
          const b = h('button', { class: 'st-btn sm danger', type: 'button' }, '×')
          b.onclick = async () => {
            await ctx.transport.rpc('orchestration.dispatchCommand', { type: 'thread.queue.cancel', commandId: crypto.randomUUID(), threadId: tid, queuedRunId: qm.id })
          }
          return b
        })(),
      )
      qBox.append(row)
    }
    timeline.append(qBox)
  }

  root.append(timeline)

  // Reply Composer
  const composer = h('div', { class: 'st-composer' })
  const d = state.composerDraft
  composer.append(renderGameContextAttachRow(state, ctx, actions))
  if (d.contextRecords.length || d.files.length) {
    const chips = h('div', { class: 'st-chips' })
    for (const r of d.contextRecords) chips.append(h('span', { class: 'st-chip' }, `${r.kind}: ${r.label}`))
    for (const f of d.files) chips.append(h('span', { class: 'st-chip' }, f.name))
    composer.append(chips)
  }
  const input = h('textarea', { class: 'st-textarea', rows: 3, placeholder: 'Reply, steer agent, or press 🎙 to dictate… (Cmd/Ctrl+Enter to send)' })
  input.value = d.text
  input.oninput = () => { d.text = input.value }
  input.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void actions.sendToSelectedThread()
    }
  }
  const cRow = h('div', { class: 'st-row st-space' })
  const intentSel = h('select', { class: 'st-select sm' })
  for (const intent of ['auto', 'steer', 'restart'] as const) {
    intentSel.append(h('option', { value: intent, selected: d.deliveryIntent === intent }, intent))
  }
  intentSel.onchange = () => { d.deliveryIntent = intentSel.value as typeof d.deliveryIntent }
  const micBtn = h('button', { class: 'st-btn sm', type: 'button' }, '🎙')
  micBtn.onclick = () => void actions.recordVoiceTo((txt) => { d.text = d.text ? `${d.text} ${txt}` : txt; actions.render() })
  const sendBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Send')
  sendBtn.onclick = () => void actions.sendToSelectedThread()
  cRow.append(intentSel, micBtn, sendBtn)
  composer.append(input, cRow)
  root.append(composer)

  return root
}

export function renderReviewView(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const wrap = h('div', { class: 'st-view' })
  const tabs = h('div', { class: 'st-pills' })
  for (const [id, label] of [
    ['verify', 'Verify Fix Here'],
    ['diffs', 'Diffs'],
    ['files', 'Files'],
    ['git', 'Git / Worktrees'],
  ] as const) {
    const b = h('button', { class: `st-pill ${state.reviewSubtab === id ? 'on' : ''}`, type: 'button' }, label)
    b.onclick = () => { state.reviewSubtab = id; actions.render() }
    tabs.append(b)
  }
  wrap.append(tabs)

  if (state.reviewSubtab === 'verify') {
    const card = h('div', { class: 'st-card' },
      h('div', { class: 'st-card-title' }, 'Live Fix Verification & Before/After Comparator'),
      h('p', { class: 'st-muted' }, 'Hot-swap a worktree core.wasm via engine.recore(), or open its preview server, then capture an After frame right beside the bug Before frame.'),
    )
    const wtRow = h('div', { class: 'st-row' })
    const refWt = h('button', { class: 'st-btn sm', type: 'button' }, 'Refresh Worktrees')
    refWt.onclick = () => void actions.refreshWorktrees()
    const capBefore = h('button', { class: 'st-btn sm', type: 'button' }, 'Capture Before')
    capBefore.onclick = async () => {
      const bm = ctx.captureBookmark()
      const shot = await ctx.captureFrame('color')
      state.beforeShot = { dataUrl: shot.dataUrl, label: `Before (${bm.where || bm.at.join(',')})`, bookmark: bm }
      actions.render()
    }
    const capAfter = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Capture After')
    capAfter.onclick = async () => {
      const bm = ctx.captureBookmark()
      const shot = await ctx.captureFrame('color')
      state.afterShot = { dataUrl: shot.dataUrl, label: `After (${bm.where || bm.at.join(',')})`, bookmark: bm }
      actions.render()
    }
    wtRow.append(refWt, capBefore, capAfter)
    card.append(wtRow)

    if (state.worktrees.length) {
      const list = h('div', { class: 'st-list' })
      for (const wt of state.worktrees) {
        const row = h('div', { class: 'st-row st-space st-mini-row' },
          h('span', { class: 'st-ellipsis', title: wt.path }, `${wt.branch || 'detached'} · ${wt.path.split('/').slice(-1)[0]}`),
          (() => {
            const b = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Verify Here')
            b.onclick = () => void actions.verifyWorktree(wt.path)
            return b
          })(),
        )
        list.append(row)
      }
      card.append(list)
    }

    // Interactive Before/After Comparator (Split Wipe & Blink)
    if (state.beforeShot || state.afterShot) {
      const cmp = h('div', { class: 'st-compare' })
      const modeBar = h('div', { class: 'st-row st-space' })
      const wipeBtn = h('button', { class: `st-btn sm ${state.compareMode === 'wipe' ? 'on' : ''}`, type: 'button' }, 'Split Wipe')
      wipeBtn.onclick = () => { state.compareMode = 'wipe'; actions.render() }
      const blinkBtn = h('button', { class: `st-btn sm ${state.compareMode === 'blink' ? 'on' : ''}`, type: 'button' }, 'Blink Toggle')
      blinkBtn.onclick = () => { state.compareMode = 'blink'; state.compareSplit = state.compareSplit > 50 ? 0 : 100; actions.render() }
      modeBar.append(h('div', { class: 'st-row' }, wipeBtn, blinkBtn))

      const stage = h('div', { class: 'st-compare-stage' })
      if (state.beforeShot) stage.append(h('img', { class: 'st-cmp-img', src: state.beforeShot.dataUrl, alt: state.beforeShot.label }))
      if (state.afterShot) {
        const over = h('img', { class: 'st-cmp-img st-cmp-over', src: state.afterShot.dataUrl, alt: state.afterShot.label })
        over.style.clipPath = state.compareMode === 'wipe'
          ? `inset(0 0 0 ${state.compareSplit}%)`
          : state.compareSplit > 50 ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)'
        stage.append(over)
      }
      const slider = h('input', { type: 'range', min: 0, max: 100, value: state.compareSplit, class: 'st-range-full' })
      slider.oninput = () => { state.compareSplit = Number(slider.value); actions.render() }
      cmp.append(modeBar, stage, slider)
      card.append(cmp)
    }

    // 1-Click Regression Test Generator
    const regBtn = h('button', { class: 'st-btn accent', type: 'button' }, 'Generate Regression Check (engine/test/*.mjs)')
    regBtn.onclick = async () => {
      const bm = state.beforeShot?.bookmark ?? ctx.captureBookmark()
      const slug = `regression-${Date.now().toString(36)}`
      try {
        state.regressionPreview = await ctx.transport.generateRegressionTest({
          slug,
          title: `Regression @ ${bm.where || bm.at.join(',')}`,
          bookmark: bm,
        })
        actions.render()
      } catch (e) {
        state.error = e instanceof Error ? e.message : String(e)
        actions.render()
      }
    }
    card.append(regBtn)
    if (state.regressionPreview) {
      card.append(
        h('div', { class: 'st-label' }, state.regressionPreview.filename),
        h('pre', { class: 'st-mono' }, state.regressionPreview.source),
      )
    }
    wrap.append(card)
    return wrap
  }

  if (state.reviewSubtab === 'diffs') {
    const row = h('div', { class: 'st-row' })
    const loadFull = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Load Full Thread Diff')
    loadFull.onclick = async () => {
      if (!state.selectedThreadId) { state.error = 'Select a thread first.'; actions.render(); return }
      try {
        const res = await ctx.transport.rpc<{ diff?: string; patch?: string }>('orchestration.getFullThreadDiff', { threadId: state.selectedThreadId })
        state.diffText = String(res?.diff ?? res?.patch ?? JSON.stringify(res, null, 2))
        actions.render()
      } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
    }
    const loadCommits = h('button', { class: 'st-btn sm', type: 'button' }, 'Branch Commits')
    loadCommits.onclick = async () => {
      try {
        const res = await ctx.transport.rpc('review.getBranchCommits', { threadId: state.selectedThreadId ?? undefined })
        state.diffText = JSON.stringify(res, null, 2)
        actions.render()
      } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
    }
    row.append(loadFull, loadCommits)
    wrap.append(row, h('pre', { class: 'st-mono st-diff' }, state.diffText || 'Select a thread and click "Load Full Thread Diff" to inspect unified changes.'))
    return wrap
  }

  if (state.reviewSubtab === 'files') {
    const bar = h('div', { class: 'st-row' })
    const pathIn = h('input', { class: 'st-input', value: state.filesPath, placeholder: 'Relative path (e.g. engine/page)' })
    const go = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Browse')
    go.onclick = async () => {
      state.filesPath = pathIn.value.trim()
      try {
        const res = await ctx.transport.rpc<{ entries?: Array<{ name: string; path: string; type?: string }> }>('projects.listEntries', {
          projectId: state.projects[0]?.id,
          path: state.filesPath || '.',
        })
        state.filesEntries = res?.entries ?? []
        actions.render()
      } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
    }
    bar.append(pathIn, go)
    wrap.append(bar)
    const list = h('div', { class: 'st-list' })
    for (const ent of state.filesEntries.slice(0, 60)) {
      const btn = h('button', { class: 'st-mini-row st-btn-row', type: 'button' }, `${ent.type === 'directory' ? '📁' : '📄'} ${ent.path || ent.name}`)
      btn.onclick = async () => {
        if (ent.type === 'directory') { state.filesPath = ent.path; go.click(); return }
        const r = await ctx.transport.rpc<{ content?: string }>('projects.readFile', { projectId: state.projects[0]?.id, path: ent.path })
        state.filePreview = { path: ent.path, content: String(r?.content ?? '') }
        actions.render()
      }
      list.append(btn)
    }
    wrap.append(list)
    if (state.filePreview) {
      wrap.append(h('div', { class: 'st-label' }, state.filePreview.path), h('pre', { class: 'st-mono' }, state.filePreview.content.slice(0, 12_000)))
    }
    return wrap
  }

  // Git / VCS status
  const gitBar = h('div', { class: 'st-row' })
  const loadRefs = h('button', { class: 'st-btn sm primary', type: 'button' }, 'List Branches & Worktrees')
  loadRefs.onclick = async () => {
    try {
      const res = await ctx.transport.rpc<Record<string, unknown>>('vcs.listRefs', { threadId: state.selectedThreadId ?? undefined })
      state.gitInfo = res
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  const pullBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'Pull')
  pullBtn.onclick = async () => {
    try {
      state.gitInfo = await ctx.transport.rpc<Record<string, unknown>>('vcs.pull', { threadId: state.selectedThreadId ?? undefined })
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  gitBar.append(loadRefs, pullBtn)
  wrap.append(gitBar, h('pre', { class: 'st-mono' }, state.gitInfo ? JSON.stringify(state.gitInfo, null, 2) : 'Click "List Branches & Worktrees" to inspect VCS state.'))
  return wrap
}
