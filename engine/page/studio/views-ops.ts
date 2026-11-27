// Secondary T3 Code iOS parity & Game-Dev IDE views (#98):
//   - Pull Requests & Issues (PR list/detail/AI review guide/checks/review/merge; Issues list/create/comment)
//   - Tools (Playtest Session Mode + Voice Bookmarks + 3D Pins, Live Terminal, Preview & Devices, Game-Use Sessions)
//   - Ops (Multi-Environment Auto-Connect & Pairing, Workflows, Scheduled Cron Tasks, Usage Telemetry)
//   - Lab (Dynamic StudioExtension panel host + Quick-Launch AI Playbooks)
import type { StudioExtensionRegistry } from './ext.ts'
import type { StudioCtx } from './types.ts'
import { h, type StudioActions, type StudioState } from './views.ts'

export function renderPrIssuesView(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const wrap = h('div', { class: 'st-view' })
  const bar = h('div', { class: 'st-row' })
  const loadPrs = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Load Pull Requests')
  loadPrs.onclick = async () => {
    try {
      const res = await ctx.transport.rpc<{ pullRequests?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }>('pullRequests.list', { state: 'open' })
      state.prs = res?.pullRequests ?? res?.items ?? []
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  const loadIssues = h('button', { class: 'st-btn sm', type: 'button' }, 'Load Issues')
  loadIssues.onclick = async () => {
    try {
      const res = await ctx.transport.rpc<{ issues?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }>('issues.list', { state: 'open' })
      state.issues = res?.issues ?? res?.items ?? []
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  bar.append(loadPrs, loadIssues)
  wrap.append(bar)

  if (state.prs.length) {
    wrap.append(h('div', { class: 'st-label' }, `Pull Requests (${state.prs.length})`))
    for (const pr of state.prs.slice(0, 20)) {
      const card = h('div', { class: 'st-card' })
      const num = Number(pr.number ?? 0)
      card.append(
        h('div', { class: 'st-card-title' }, `#${num} ${String(pr.title ?? '')}`),
        h('div', { class: 'st-muted' }, `${String(pr.state ?? 'open')} · ${String(pr.headRefName ?? pr.branch ?? '')}`),
      )
      const row = h('div', { class: 'st-row' })
      const guideBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'AI Guide')
      guideBtn.onclick = async () => {
        state.prGuide = await ctx.transport.rpc<Record<string, unknown>>('pullRequests.getGuide', { number: num })
        actions.render()
      }
      const approveBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Approve')
      approveBtn.onclick = async () => {
        await ctx.transport.rpc('pullRequests.review', { number: num, verdict: 'approve', expectedHeadSha: pr.headSha })
        ctx.notice(`Approved PR #${num}`, 2000)
      }
      const mergeBtn = h('button', { class: 'st-btn sm accent', type: 'button' }, 'Merge')
      mergeBtn.onclick = async () => {
        await ctx.transport.rpc('pullRequests.merge', { number: num, expectedHeadSha: pr.headSha })
        ctx.notice(`Merged PR #${num}`, 2000)
      }
      row.append(guideBtn, approveBtn, mergeBtn)
      card.append(row)
      wrap.append(card)
    }
  }

  if (state.prGuide) {
    wrap.append(h('div', { class: 'st-label' }, 'PR Review Guide'), h('pre', { class: 'st-mono' }, JSON.stringify(state.prGuide, null, 2).slice(0, 6000)))
  }

  if (state.issues.length) {
    wrap.append(h('div', { class: 'st-label' }, `Issues (${state.issues.length})`))
    for (const iss of state.issues.slice(0, 20)) {
      const row = h('div', { class: 'st-mini-row st-row st-space' },
        h('span', { class: 'st-ellipsis' }, `${String(iss.key ?? iss.number ?? '')} ${String(iss.title ?? '')}`),
        (() => {
          const b = h('button', { class: 'st-btn sm', type: 'button' }, 'Start Task')
          b.onclick = () => {
            ctx.openComposerWithDraft({
              title: `Issue ${String(iss.key ?? iss.number ?? '')}: ${String(iss.title ?? '').slice(0, 44)}`,
              text: `Work on issue ${String(iss.key ?? iss.number ?? '')}: ${String(iss.title ?? '')}\n\n${String(iss.body ?? '').slice(0, 1200)}`,
              workspaceStrategy: { type: 'worktree', startFromOrigin: true },
            })
          }
          return b
        })(),
      )
      wrap.append(row)
    }
  }

  if (!state.prs.length && !state.issues.length) {
    wrap.append(h('div', { class: 'st-empty' }, 'Load Pull Requests or Issues from your connected T3 environment.'))
  }
  return wrap
}

export function renderToolsView(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const wrap = h('div', { class: 'st-view' })

  // 1. Playtest Session Mode (Rolling 15s WebM, Voice Bookmarks, 3D Spatial Thread Pins, Auto-Catch)
  const ptCard = h('div', { class: 'st-card' },
    h('div', { class: 'st-card-title' }, 'Playtest Session & Fast QA Loop'),
  )
  const ptRow = h('div', { class: 'st-row' })
  const ptToggle = h('button', { class: `st-btn sm ${state.playtestActive ? 'on' : 'primary'}`, type: 'button' }, state.playtestActive ? 'Stop Playtest (15s Ring On)' : 'Start Playtest Mode')
  ptToggle.onclick = () => actions.togglePlaytest(!state.playtestActive)
  const pinsBtn = h('button', { class: `st-btn sm ${state.spatialPinsOn ? 'on' : ''}`, type: 'button' }, '3D Thread Pins')
  pinsBtn.onclick = () => actions.toggleSpatialPins(!state.spatialPinsOn)
  const catchBtn = h('button', { class: `st-btn sm ${state.autoCatchOn ? 'on' : ''}`, type: 'button' }, 'Auto-Catch Faults')
  catchBtn.onclick = () => actions.toggleAutoCatch(!state.autoCatchOn)
  ptRow.append(ptToggle, pinsBtn, catchBtn)
  ptCard.append(ptRow)

  const noteRow = h('div', { class: 'st-row' })
  const noteIn = h('input', { class: 'st-input', placeholder: 'Quick playtest note or dictate…' })
  const addNoteBtn = h('button', { class: 'st-btn sm', type: 'button' }, '+ Note')
  addNoteBtn.onclick = () => {
    if (!noteIn.value.trim()) return
    void actions.addPlaytestNote(noteIn.value.trim())
    noteIn.value = ''
  }
  const voiceNoteBtn = h('button', { class: 'st-btn sm accent', type: 'button' }, '🎙 Voice Note')
  voiceNoteBtn.onclick = () => void actions.recordVoiceTo((txt) => { if (txt.trim()) void actions.addPlaytestNote(txt.trim()) })
  noteRow.append(noteIn, addNoteBtn, voiceNoteBtn)
  ptCard.append(noteRow)

  if (state.playtestNotes.length) {
    for (const n of state.playtestNotes) {
      const r = h('div', { class: 'st-mini-row st-row st-space' },
        h('span', { class: 'st-ellipsis', title: n.text }, n.text),
        (() => {
          const tp = h('button', { class: 'st-btn sm', type: 'button' }, 'Go')
          tp.onclick = () => ctx.teleportToBookmark(n.bookmark)
          return tp
        })(),
        (() => {
          const fire = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Fix in T3')
          fire.onclick = () => {
            ctx.openComposerWithDraft({
              title: `Playtest: ${n.text.slice(0, 48)}`,
              text: `${n.text}\n\nRepro URL: ${n.bookmark.reproUrl}`,
              contextRecords: [
                { kind: 'game-frame', label: 'Playtest Bookmark', payload: n.bookmark as unknown as Record<string, unknown> },
                ...(n.pick ? [{ kind: 'game-pick', label: 'Playtest Pick', payload: n.pick as unknown as Record<string, unknown> }] : []),
              ],
              files: n.screenshotDataUrl ? [{ name: 'playtest.png', mimeType: 'image/png', dataBase64: n.screenshotDataUrl, label: 'Playtest Frame', type: 'image' }] : [],
              workspaceStrategy: { type: 'worktree', startFromOrigin: true },
              bookmark: n.bookmark,
            })
          }
          return fire
        })(),
      )
      ptCard.append(r)
    }
  }
  wrap.append(ptCard)

  // 2. Game-Use Control & Sessions Monitor
  const guCard = h('div', { class: 'st-card' },
    h('div', { class: 'st-card-title' }, `Game-Use MCP Control (Session: ${ctx.sessionId})`),
    h('p', { class: 'st-muted' }, `Owner: ${state.control.owner ?? 'unclaimed'} · Human in control: ${String(state.control.humanInControl)} · Active bridge sessions: ${state.sessions.length}`),
  )
  const ctlRow = h('div', { class: 'st-row' })
  const takeBtn = h('button', { class: `st-btn sm ${state.control.humanInControl ? 'on' : ''}`, type: 'button' }, 'Take Human Control')
  takeBtn.onclick = () => actions.takeControl()
  const relBtn = h('button', { class: `st-btn sm ${!state.control.humanInControl ? 'on' : ''}`, type: 'button' }, 'Let Agent Drive')
  relBtn.onclick = () => actions.releaseControl()
  const refBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'Refresh')
  refBtn.onclick = () => void actions.refreshStatus()
  ctlRow.append(takeBtn, relBtn, refBtn)
  guCard.append(ctlRow)
  wrap.append(guCard)

  // 3. Live PTY Terminal (T3 iOS parity)
  const termCard = h('div', { class: 'st-card' }, h('div', { class: 'st-card-title' }, 'T3 Workspace Terminal'))
  const tBar = h('div', { class: 'st-row' })
  const openTerm = h('button', { class: 'st-btn sm primary', type: 'button' }, state.terminalId ? 'Reconnect PTY' : 'Open Terminal')
  openTerm.onclick = async () => {
    try {
      const res = await ctx.transport.rpc<{ terminalId?: string; id?: string }>('terminal.open', { threadId: state.selectedThreadId ?? undefined })
      state.terminalId = String(res?.terminalId ?? res?.id ?? 'default')
      ctx.transport.subscribe('terminal.subscribe', { terminalId: state.terminalId }, (ev) => {
        const chunk = (ev as Record<string, unknown>)?.data ?? (ev as Record<string, unknown>)?.output
        if (typeof chunk === 'string') { state.terminalLog = (state.terminalLog + chunk).slice(-8000); actions.render() }
      })
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  const cmdIn = h('input', { class: 'st-input', placeholder: 'Run command in T3 terminal…' })
  const sendCmd = h('button', { class: 'st-btn sm', type: 'button' }, 'Run')
  sendCmd.onclick = async () => {
    if (!state.terminalId || !cmdIn.value) return
    await ctx.transport.rpc('terminal.write', { terminalId: state.terminalId, data: `${cmdIn.value}\n` })
    cmdIn.value = ''
  }
  tBar.append(openTerm, cmdIn, sendCmd)
  termCard.append(tBar, h('pre', { class: 'st-mono' }, state.terminalLog || '(no terminal output yet)'))
  wrap.append(termCard)

  // 4. Preview & Mobile Simulators (T3 iOS parity)
  const pdCard = h('div', { class: 'st-card' }, h('div', { class: 'st-card-title' }, 'Preview Tabs & Mobile Devices'))
  const pdRow = h('div', { class: 'st-row' })
  const listPrev = h('button', { class: 'st-btn sm', type: 'button' }, 'List Previews')
  listPrev.onclick = async () => {
    const res = await ctx.transport.rpc<{ tabs?: Array<Record<string, unknown>> }>('preview.list', {})
    state.previews = res?.tabs ?? []
    actions.render()
  }
  const listDev = h('button', { class: 'st-btn sm', type: 'button' }, 'List Devices')
  listDev.onclick = async () => {
    const res = await ctx.transport.rpc<{ devices?: Array<Record<string, unknown>> }>('device.list', {})
    state.devices = res?.devices ?? []
    actions.render()
  }
  pdRow.append(listPrev, listDev)
  pdCard.append(pdRow)
  if (state.previews.length || state.devices.length) {
    pdCard.append(h('pre', { class: 'st-mono' }, JSON.stringify({ previews: state.previews, devices: state.devices }, null, 2).slice(0, 3000)))
  }
  wrap.append(pdCard)

  return wrap
}

export function renderOpsView(state: StudioState, ctx: StudioCtx, actions: StudioActions): HTMLElement {
  const wrap = h('div', { class: 'st-view' })

  // 1. Multi-Environment Manager (Auto-Connect Local T3 + Pair via URL/Code + Switch/Remove)
  const envCard = h('div', { class: 'st-card' },
    h('div', { class: 'st-card-title' }, `T3 Code Environments (${ctx.transport.mode} transport)`),
  )
  for (const env of state.environments) {
    const row = h('div', { class: 'st-mini-row st-row st-space' },
      h('span', { class: 'st-ellipsis' }, `${env.active ? '● ' : '○ '}${env.label} (${env.state} · ${env.tokenType})`),
      (() => {
        const useBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'Switch')
        useBtn.onclick = async () => { await ctx.transport.setActiveEnvironment(env.environmentId); await actions.refreshStatus(); await actions.refreshShell() }
        return useBtn
      })(),
      (() => {
        const delBtn = h('button', { class: 'st-btn sm danger', type: 'button' }, '×')
        delBtn.onclick = async () => { await ctx.transport.removeEnvironment(env.environmentId); await actions.refreshStatus() }
        return delBtn
      })(),
    )
    envCard.append(row)
  }

  const pairIn = h('input', { class: 'st-input', placeholder: 'Paste T3 pairing URL (http://127.0.0.1:3773#token=…) or host' })
  const codeIn = h('input', { class: 'st-input', placeholder: 'Pairing code (if host given separately)' })
  const envBtns = h('div', { class: 'st-row' })
  const autoBtn = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Auto-Connect Local T3')
  autoBtn.onclick = async () => {
    try { await ctx.transport.autoConnectLocal(); await actions.refreshStatus(); await actions.refreshShell() }
    catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  const pairBtn = h('button', { class: 'st-btn sm', type: 'button' }, 'Pair Environment')
  pairBtn.onclick = async () => {
    const raw = pairIn.value.trim()
    if (!raw) return
    try {
      await ctx.transport.pair(raw.includes('#') || raw.includes('token=') ? { pairingUrl: raw } : { host: raw, pairingCode: codeIn.value.trim() })
      pairIn.value = ''; codeIn.value = ''
      await actions.refreshStatus(); await actions.refreshShell()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  envBtns.append(autoBtn, pairBtn)
  envCard.append(pairIn, codeIn, envBtns)
  wrap.append(envCard)

  // 2. Workflows & Scheduled Cron Tasks
  const wfCard = h('div', { class: 'st-card' }, h('div', { class: 'st-card-title' }, 'Workflows & Scheduled Tasks'))
  const wfBtns = h('div', { class: 'st-row' })
  const loadCron = h('button', { class: 'st-btn sm', type: 'button' }, 'Load Schedules')
  loadCron.onclick = async () => {
    try {
      const res = await ctx.transport.rpc<{ tasks?: Array<Record<string, unknown>> }>('scheduledTasks.list', {})
      state.scheduledTasks = res?.tasks ?? []
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  const loadUsage = h('button', { class: 'st-btn sm', type: 'button' }, 'Usage Summary')
  loadUsage.onclick = async () => {
    try {
      state.usageSummary = await ctx.transport.rpc<Record<string, unknown>>('server.getUsageSummary', {})
      actions.render()
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); actions.render() }
  }
  wfBtns.append(loadCron, loadUsage)
  wfCard.append(wfBtns)
  if (state.scheduledTasks.length) {
    for (const st of state.scheduledTasks) {
      const r = h('div', { class: 'st-mini-row st-row st-space' },
        h('span', { class: 'st-ellipsis' }, `${String(st.title ?? st.id)} (${String(st.cronExpression ?? '')})`),
        (() => {
          const run = h('button', { class: 'st-btn sm primary', type: 'button' }, 'Run Now')
          run.onclick = async () => { await ctx.transport.rpc('scheduledTasks.runNow', { taskId: st.id }); ctx.notice('Scheduled task triggered', 2000) }
          return run
        })(),
      )
      wfCard.append(r)
    }
  }
  if (state.usageSummary) {
    wfCard.append(h('pre', { class: 'st-mono' }, JSON.stringify(state.usageSummary, null, 2).slice(0, 3000)))
  }
  wrap.append(wfCard)
  return wrap
}

export function renderLabView(
  state: StudioState,
  ctx: StudioCtx,
  registry: StudioExtensionRegistry,
  actions: StudioActions,
  onCleanup: (fn: () => void) => void,
): HTMLElement {
  const wrap = h('div', { class: 'st-view' })
  const panels = registry.panels()
  if (!panels.some((p) => p.id === state.activeLabPanel) && panels[0]) {
    state.activeLabPanel = panels[0].id
  }

  const pills = h('div', { class: 'st-pills' })
  for (const p of panels) {
    const b = h('button', { class: `st-pill ${state.activeLabPanel === p.id ? 'on' : ''}`, type: 'button' }, `${p.icon} ${p.title}`)
    b.onclick = () => { state.activeLabPanel = p.id; actions.render() }
    pills.append(b)
  }
  wrap.append(pills)

  const mountHost = h('div', { class: 'st-lab-host' })
  const active = panels.find((p) => p.id === state.activeLabPanel)
  if (active) {
    try {
      const cleanup = active.mount(mountHost, ctx)
      if (typeof cleanup === 'function') onCleanup(cleanup)
    } catch (e) {
      mountHost.append(h('div', { class: 'st-warn-card' }, `Extension panel error: ${e instanceof Error ? e.message : String(e)}`))
    }
  }
  wrap.append(mountHost)

  // Quick-Launch AI Playbooks from all extensions
  const exActions = registry.actions()
  if (exActions.length) {
    const pbCard = h('div', { class: 'st-card' }, h('div', { class: 'st-card-title' }, 'Quick-Launch Extension Playbooks'))
    for (const a of exActions) {
      const b = h('button', { class: 'st-btn sm', type: 'button' }, `✦ ${a.title}`)
      b.onclick = async () => {
        const draft = await a.prompt(ctx)
        ctx.openComposerWithDraft(draft)
      }
      pbCard.append(b)
    }
    wrap.append(pbCard)
  }

  // Dynamic MCP tools registered by extensions
  const tools = registry.advertisedGameTools()
  if (tools.length) {
    wrap.append(h('div', { class: 'st-muted' }, `MCP Extension Tools advertised to agents: ${tools.map((t) => t.name).join(', ')}`))
  }
  return wrap
}
