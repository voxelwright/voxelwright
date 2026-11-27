// One-gesture Bug-in-View (F9), Retroactive Rewind (F10), Auto-Anomaly Catch Toast,
// Interactive Frame Annotation, and 3D Spatial Thread Pins (#98).
// Builds directly on `engine.recorder` (#64) and emits native T3 Code `UnknownContextRecord`s
// (`game-frame`, `game-pick`, `game-timeline`, `game-perf`) + uploaded PNG/WebM attachments!
import type { Anomaly, PickInfo } from '../recorder.ts'
import type { AgentBridgeHandle } from './agent-bridge.ts'
import type { StudioExtensionRegistry } from './ext.ts'
import type {
  GameContextRecord,
  SpatialThreadPin,
  StudioCtx,
  StudioEngineHandle,
  ThreadLaunchDraft,
  UploadedFileDraft,
} from './types.ts'

export interface BugCaptureController {
  fireBugInView(prefill?: string): Promise<void>
  fireRewindBug(prefill?: string): Promise<void>
  setSpatialPins(pins: SpatialThreadPin[]): void
  setSpatialPinsVisible(on: boolean): void
  readonly spatialPinsVisible: boolean
  setAutoCatchEnabled(on: boolean): void
  readonly autoCatchEnabled: boolean
  dispose(): void
}

const OVERLAY_STYLE = /* css */ `
[data-panel="studio-bug"] { position: fixed; inset: 0; z-index: 60; pointer-events: auto; display: grid; place-items: center; padding: 16px; background: rgba(6, 9, 15, 0.74); backdrop-filter: blur(8px); font: 400 13.5px/1.4 var(--vx-font, system-ui, sans-serif); color: #eef2f7; user-select: text; -webkit-user-select: text; }
[data-panel="studio-bug"][hidden] { display: none !important; }
[data-panel="studio-bug"] * { box-sizing: border-box; }
[data-panel="studio-bug"] .sb-card { width: min(760px, calc(100vw - 28px)); max-height: calc(100vh - 28px); overflow: auto; background: #101622; border: 1.5px solid rgba(110, 150, 210, 0.45); border-radius: 8px; padding: 14px 16px; display: grid; gap: 10px; box-shadow: 0 24px 64px rgba(0,0,0,0.65); }
[data-panel="studio-bug"] .sb-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
[data-panel="studio-bug"] h2 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
[data-panel="studio-bug"] .sb-badge { font: 600 11px/1 ui-monospace, Menlo, monospace; padding: 3px 7px; border-radius: 4px; background: #1e3a7a; color: #b7d3ff; }
[data-panel="studio-bug"] .sb-canvas-wrap { position: relative; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.16); background: #070a10; cursor: crosshair; }
[data-panel="studio-bug"] canvas { position: static !important; inset: auto !important; width: 100% !important; height: auto !important; max-height: 42vh; display: block; aspect-ratio: 16/9; object-fit: contain; }
[data-panel="studio-bug"] textarea { width: 100%; min-height: 58px; padding: 8px 11px; border-radius: 5px; border: 1px solid rgba(130, 165, 215, 0.45); background: #0a0f18; color: #f4f7fb; font: 400 13.5px/1.45 inherit; resize: vertical; }
[data-panel="studio-bug"] .sb-toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
[data-panel="studio-bug"] button { font: 600 12.5px/1.1 inherit; padding: 7px 11px; border-radius: 5px; border: 1px solid rgba(140, 170, 215, 0.3); background: rgba(255,255,255,0.07); color: #e8eef6; cursor: pointer; }
[data-panel="studio-bug"] button.on { background: #2457e6; border-color: #6ea2ff; color: #fff; }
[data-panel="studio-bug"] button.primary { background: #2457e6; border-color: #5b93ff; color: #fff; }
[data-panel="studio-bug"] button.warn { background: #c9721b; border-color: #f3a953; color: #fff; }
[data-panel="studio-bug"] .sb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
[data-panel="studio-bug"] .sb-chip { font: 500 11.5px/1.2 ui-monospace, Menlo, monospace; padding: 3px 8px; border-radius: 999px; background: rgba(66, 128, 255, 0.16); border: 1px solid rgba(98, 152, 255, 0.36); color: #bcd7ff; }
[data-panel="studio-bug"] .sb-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-panel="studio-toast"] { position: fixed; right: 16px; bottom: 72px; z-index: 35; max-width: 360px; pointer-events: auto; }
[data-panel="studio-toast"] .st-card { background: rgba(24, 16, 14, 0.94); border: 1.5px solid rgba(245, 138, 66, 0.65); border-radius: 8px; padding: 10px 12px; color: #fdece1; font: 500 12.5px/1.35 system-ui, sans-serif; display: grid; gap: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
[data-panel="studio-toast"] .st-row { display: flex; gap: 6px; justify-content: flex-end; }
[data-panel="studio-toast"] button { font: 600 11.5px/1 inherit; padding: 6px 10px; border-radius: 5px; border: 0; background: rgba(255,255,255,0.14); color: #fff; cursor: pointer; }
[data-panel="studio-toast"] button.go { background: #e07628; color: #160c04; }
`

export function createBugCapture(opts: {
  engine: StudioEngineHandle
  bridge: AgentBridgeHandle
  registry: StudioExtensionRegistry
  getCtx: () => StudioCtx
  onOpenDraft: (draft: ThreadLaunchDraft, immediateLaunch?: boolean) => void
  onOpenPin: (pin: SpatialThreadPin) => void
}): BugCaptureController {
  const { engine, bridge, registry, getCtx } = opts
  const style = document.createElement('style')
  style.textContent = OVERLAY_STYLE
  document.head.append(style)

  const panel = engine.hud.panel('studio-bug')
  panel.hidden = true
  const toastPanel = engine.hud.panel('studio-toast')

  let leaveMode: (() => void) | null = null
  let autoCatchEnabled = true
  let spatialPinsVisible = false
  let currentPins: SpatialThreadPin[] = []
  let activeCues: Array<{ remove(): void }> = []
  const seenAnomalyIds = new Set<string>()
  let lastGpuFaultCount = engine.gpu?.faults?.length ?? 0

  const clearCues = () => {
    for (const c of activeCues) c.remove()
    activeCues = []
  }

  const renderSpatialPins = () => {
    clearCues()
    if (!spatialPinsVisible) return
    for (const pin of currentPins) {
      const cue = engine.hud.cue(
        `[T3] ${pin.title.slice(0, 32)}`,
        () => pin.at,
        () => opts.onOpenPin(pin),
      )
      activeCues.push(cue)
    }
  }

  const closeOverlay = () => {
    panel.hidden = true
    panel.replaceChildren()
    leaveMode?.()
    leaveMode = null
  }

  /** Opens the interactive Bug-in-View / Rewind annotation & T3 Thread dispatch sheet. */
  async function openCaptureModal(kind: 'view' | 'rewind', prefill = '') {
    if (!panel.hidden) return
    const ctx = getCtx()
    const bookmark = bridge.captureBookmark()
    const cleanShot = await bridge.captureFrame('color')
    let pick: (PickInfo & { farBuildingId?: number | null; farFace?: number | null }) | null = await bridge.pickAt(0.5, 0.5).catch(() => null)
    const trace = (await engine.recorder?.snapshot?.({ reason: kind === 'rewind' ? 'studio-rewind' : 'studio-bug-view', pick: false })) ?? null
    const extraRecords = await registry.collectContextRecords(ctx)
    const rollingClip = kind === 'rewind' ? await bridge.snapshotRollingVideoBase64() : null

    leaveMode = engine.input.push({ name: 'studio-bug', solid: true, text: true })
    panel.hidden = false

    const card = document.createElement('div')
    card.className = 'sb-card'
    const head = document.createElement('div')
    head.className = 'sb-head'
    const h2 = document.createElement('h2')
    h2.textContent = kind === 'rewind' ? 'What Just Happened? (30 s Rewind)' : 'Bug in View — Fire T3 Fix Thread'
    const badge = document.createElement('span')
    badge.className = 'sb-badge'
    badge.textContent = kind === 'rewind' ? 'F10 · Flight Recorder' : 'F9 · 3D Ray-Pick'
    h2.append(badge)
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.textContent = 'Esc'
    closeBtn.onclick = closeOverlay
    head.append(h2, closeBtn)

    // Interactive annotation canvas (pin, box, freehand stroke)
    const wrap = document.createElement('div')
    wrap.className = 'sb-canvas-wrap'
    const annCanvas = document.createElement('canvas')
    const baseImg = new Image()
    baseImg.src = cleanShot.dataUrl
    annCanvas.width = Math.max(640, cleanShot.width)
    annCanvas.height = Math.max(360, cleanShot.height)
    const a2d = annCanvas.getContext('2d')!
    type Mark = { kind: 'pin'; u: number; v: number } | { kind: 'box'; x0: number; y0: number; x1: number; y1: number } | { kind: 'pen'; pts: Array<[number, number]> }
    const marks: Mark[] = []
    let drawTool: 'pin' | 'box' | 'pen' = 'pin'
    let dragStart: [number, number] | null = null
    let activePen: Array<[number, number]> | null = null

    const redraw = () => {
      a2d.clearRect(0, 0, annCanvas.width, annCanvas.height)
      if (baseImg.complete) a2d.drawImage(baseImg, 0, 0, annCanvas.width, annCanvas.height)
      for (const m of marks) {
        a2d.strokeStyle = '#ffdf3b'
        a2d.fillStyle = 'rgba(255, 223, 59, 0.2)'
        a2d.lineWidth = Math.max(3, annCanvas.width / 320)
        if (m.kind === 'pin') {
          const x = m.u * annCanvas.width, y = m.v * annCanvas.height
          a2d.beginPath(); a2d.arc(x, y, 14, 0, Math.PI * 2); a2d.fill(); a2d.stroke()
          a2d.beginPath(); a2d.moveTo(x - 20, y); a2d.lineTo(x + 20, y); a2d.moveTo(x, y - 20); a2d.lineTo(x, y + 20); a2d.stroke()
        } else if (m.kind === 'box') {
          a2d.fillRect(m.x0 * annCanvas.width, m.y0 * annCanvas.height, (m.x1 - m.x0) * annCanvas.width, (m.y1 - m.y0) * annCanvas.height)
          a2d.strokeRect(m.x0 * annCanvas.width, m.y0 * annCanvas.height, (m.x1 - m.x0) * annCanvas.width, (m.y1 - m.y0) * annCanvas.height)
        } else if (m.kind === 'pen' && m.pts.length > 1) {
          a2d.beginPath()
          a2d.moveTo(m.pts[0][0] * annCanvas.width, m.pts[0][1] * annCanvas.height)
          for (let i = 1; i < m.pts.length; i++) a2d.lineTo(m.pts[i][0] * annCanvas.width, m.pts[i][1] * annCanvas.height)
          a2d.stroke()
        }
      }
    }
    baseImg.onload = redraw

    const uvOf = (e: PointerEvent): [number, number] => {
      const r = annCanvas.getBoundingClientRect()
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]
    }
    annCanvas.addEventListener('pointerdown', (e) => {
      const [u, v] = uvOf(e)
      if (drawTool === 'pin') {
        marks.push({ kind: 'pin', u, v })
        redraw()
        void bridge.pickAt(u, v).then((p) => { pick = p; renderChips() })
      } else if (drawTool === 'box') {
        dragStart = [u, v]
        marks.push({ kind: 'box', x0: u, y0: v, x1: u, y1: v })
      } else {
        activePen = [[u, v]]
        marks.push({ kind: 'pen', pts: activePen })
      }
    })
    annCanvas.addEventListener('pointermove', (e) => {
      if (!dragStart && !activePen) return
      const [u, v] = uvOf(e)
      if (dragStart) {
        const last = marks[marks.length - 1]
        if (last?.kind === 'box') { last.x1 = u; last.y1 = v }
        redraw()
      } else if (activePen) {
        activePen.push([u, v])
        redraw()
      }
    })
    const endDraw = () => { dragStart = null; activePen = null }
    annCanvas.addEventListener('pointerup', endDraw)
    annCanvas.addEventListener('pointerleave', endDraw)
    wrap.append(annCanvas)

    // Toolbar
    const toolbar = document.createElement('div')
    toolbar.className = 'sb-toolbar'
    const mkToolBtn = (id: 'pin' | 'box' | 'pen', label: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.className = drawTool === id ? 'on' : ''
      b.onclick = () => {
        drawTool = id
        for (const el of toolbar.querySelectorAll('button[data-tool]')) el.classList.toggle('on', el.getAttribute('data-tool') === id)
      }
      b.setAttribute('data-tool', id)
      return b
    }
    const heatToggle = document.createElement('button')
    heatToggle.type = 'button'
    heatToggle.textContent = '+ Include Heat Map'
    let includeHeat = false
    heatToggle.onclick = () => { includeHeat = !includeHeat; heatToggle.classList.toggle('on', includeHeat) }
    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.textContent = 'Clear Marks'
    clearBtn.onclick = () => { marks.length = 0; redraw() }
    toolbar.append(mkToolBtn('pin', 'Pin & 3D Pick'), mkToolBtn('box', 'Box'), mkToolBtn('pen', 'Draw'), heatToggle, clearBtn)

    // Context chips preview
    const chips = document.createElement('div')
    chips.className = 'sb-chips'
    const renderChips = () => {
      chips.replaceChildren()
      const items = [
        `game-frame @ ${bookmark.at.join(',')} (${bookmark.mode})`,
        ...(pick ? [`game-pick cell [${pick.cell.join(',')}]${pick.geo?.street ? ` · ${pick.geo.street}` : ''}${pick.farBuildingId ? ` · bldg #${pick.farBuildingId}` : ''}`] : []),
        ...(trace ? [`game-timeline · ${trace.keyframes.length} kf · ${trace.anomalies.length} anomalies`] : []),
        ...(rollingClip ? [`rewind.webm (${Math.round(rollingClip.durationMs / 1000)}s)`] : []),
        ...extraRecords.map((r) => `${r.kind}: ${r.label}`),
      ]
      for (const label of items) {
        const s = document.createElement('span')
        s.className = 'sb-chip'
        s.textContent = label
        chips.append(s)
      }
    }
    renderChips()

    const note = document.createElement('textarea')
    note.placeholder = kind === 'rewind'
      ? 'Describe what just happened (the last 30 s trace, anomalies, and clip are attached automatically)…'
      : 'Describe the bug in view (click/box on the frame to mark it; 3D voxel/building/camera state is attached automatically)…'
    note.value = prefill

    const foot = document.createElement('div')
    foot.className = 'sb-foot'
    const worktreeWrap = document.createElement('label')
    worktreeWrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:#b8c7dc'
    const wtCheck = document.createElement('input')
    wtCheck.type = 'checkbox'
    wtCheck.checked = true
    worktreeWrap.append(wtCheck, 'Start in isolated git worktree (origin/main)')

    const btns = document.createElement('div')
    btns.style.cssText = 'display:flex;gap:8px'
    const toComposer = document.createElement('button')
    toComposer.type = 'button'
    toComposer.textContent = 'Edit in Studio Composer'
    const fireNow = document.createElement('button')
    fireNow.type = 'button'
    fireNow.className = 'primary'
    fireNow.textContent = 'Fire T3 Fix Thread Now'

    const buildDraft = async (): Promise<ThreadLaunchDraft> => {
      const files: UploadedFileDraft[] = []
      const shotUrl = marks.length ? annCanvas.toDataURL('image/png') : cleanShot.dataUrl
      files.push({
        name: kind === 'rewind' ? 'rewind-frame.png' : 'bug-in-view.png',
        mimeType: 'image/png',
        dataBase64: shotUrl,
        label: marks.length ? 'Annotated Game Frame' : 'Game Frame',
        type: 'image',
      })
      if (includeHeat) {
        const heat = await bridge.captureFrame('heat')
        files.push({ name: 'raymarch-heat.png', mimeType: 'image/png', dataBase64: heat.dataUrl, label: 'Raymarch Step Heatmap', type: 'image' })
      }
      if (rollingClip) {
        files.push({ name: 'last-15s-rewind.webm', mimeType: rollingClip.mimeType, dataBase64: rollingClip.base64, label: 'Last 15s Video Clip', type: 'file' })
      }

      const contextRecords: GameContextRecord[] = [
        {
          kind: 'game-frame',
          label: `Scene @ ${bookmark.where || bookmark.at.join(',')}`,
          payload: {
            ...bookmark,
            perf: { frameMs: engine.frameMs, gpuMs: engine.gpuMs, cpuMs: engine.cpuMs },
            gpuFaults: (engine.gpu?.faults ?? []).slice(-10),
            viewport: [innerWidth, innerHeight],
            marks,
          },
        },
      ]
      if (pick) {
        contextRecords.push({
          kind: 'game-pick',
          label: pick.geo?.street ? `Pick: ${pick.geo.street}` : `Pick [${pick.cell.join(',')}]`,
          payload: pick as unknown as Record<string, unknown>,
        })
      }
      if (trace) {
        contextRecords.push({
          kind: 'game-timeline',
          label: `Flight Recorder (${trace.keyframes.length} kf, ${trace.anomalies.length} anomalies)`,
          payload: {
            sessionId: trace.sessionId,
            summary: trace.summary,
            anomalies: trace.anomalies.slice(-20),
            events: trace.events.slice(-60),
            edits: trace.edits.slice(-30),
            keyframes: trace.keyframes.slice(-25),
          },
        })
      }
      contextRecords.push(...extraRecords)

      const desc = note.value.trim() || (kind === 'rewind' ? 'Investigate and fix the issue from the attached 30s rewind trace.' : 'Investigate and fix the visual/gameplay bug shown in view.')
      const titlePrefix = kind === 'rewind' ? 'Rewind Bug' : 'Bug in View'
      const title = `${titlePrefix}: ${desc.slice(0, 52)}`
      const prompt = [
        desc,
        '',
        `Repro URL: ${bookmark.reproUrl}`,
        'Use the attached `game-frame`, `game-pick`, and `game-timeline` context plus the `voxelwright-game` MCP tools (`game_session_spawn`, `game_camera`, `game_snapshot`, `game_assert`) to reproduce the bug, fix it, verify before/after, and add an automated regression test.',
      ].join('\n')

      return {
        title,
        text: prompt,
        contextRecords,
        files,
        runtimeMode: 'auto',
        interactionMode: 'default',
        workspaceStrategy: wtCheck.checked ? { type: 'worktree', startFromOrigin: true } : { type: 'root' },
        bookmark,
      }
    }

    toComposer.onclick = async () => {
      toComposer.disabled = fireNow.disabled = true
      const draft = await buildDraft()
      closeOverlay()
      opts.onOpenDraft(draft, false)
    }
    fireNow.onclick = async () => {
      toComposer.disabled = fireNow.disabled = true
      fireNow.textContent = 'Launching…'
      const draft = await buildDraft()
      closeOverlay()
      opts.onOpenDraft(draft, true)
    }
    btns.append(toComposer, fireNow)
    foot.append(worktreeWrap, btns)

    card.append(head, wrap, toolbar, chips, note, foot)
    panel.replaceChildren(card)
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeOverlay() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); fireNow.click() }
    })
    note.focus()
  }

  // Hotkeys: F9 = Bug in View, F10 = What Just Happened (30s rewind).
  // Bound directly on window so they respond even when a text mode is active.
  const onHotKey = (e: KeyboardEvent) => {
    if (e.code === 'F9') {
      e.preventDefault()
      if (panel.hidden) void openCaptureModal('view')
      else closeOverlay()
    } else if (e.code === 'F10') {
      e.preventDefault()
      if (panel.hidden) void openCaptureModal('rewind')
      else closeOverlay()
    }
  }
  addEventListener('keydown', onHotKey)

  // Auto-anomaly & GPU fault watcher -> subtle corner toast offering 1-click T3 fix thread!
  let activeToastTimer: ReturnType<typeof setTimeout> | null = null
  const showAnomalyToast = (title: string, detail: string) => {
    if (!autoCatchEnabled || !panel.hidden) return
    if (activeToastTimer) clearTimeout(activeToastTimer)
    const c = document.createElement('div')
    c.className = 'st-card'
    const p = document.createElement('div')
    p.textContent = `${title}: ${detail}`
    const row = document.createElement('div')
    row.className = 'st-row'
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = 'Dismiss'
    dismiss.onclick = () => toastPanel.replaceChildren()
    const fix = document.createElement('button')
    fix.type = 'button'
    fix.className = 'go'
    fix.textContent = 'Fire T3 Fix Thread'
    fix.onclick = () => { toastPanel.replaceChildren(); void openCaptureModal('rewind', `${title}: ${detail}`) }
    row.append(dismiss, fix)
    c.append(p, row)
    toastPanel.replaceChildren(c)
    activeToastTimer = setTimeout(() => toastPanel.replaceChildren(), 10_000)
  }

  const pollTimer = setInterval(() => {
    if (!autoCatchEnabled) return
    const faults = engine.gpu?.faults ?? []
    if (faults.length > lastGpuFaultCount) {
      const latest = faults[faults.length - 1]
      lastGpuFaultCount = faults.length
      showAnomalyToast('WebGPU Fault', String(latest).slice(0, 140))
      return
    }
    const anomalies: readonly Anomaly[] = engine.recorder?.anomalies ?? []
    for (const a of anomalies) {
      if (seenAnomalyIds.has(a.id)) continue
      seenAnomalyIds.add(a.id)
      if (a.severity === 'critical' || a.severity === 'high') {
        showAnomalyToast(`Anomaly (${a.kind})`, a.summary.slice(0, 140))
        break
      }
    }
  }, 1500)

  return {
    fireBugInView: (prefill) => openCaptureModal('view', prefill),
    fireRewindBug: (prefill) => openCaptureModal('rewind', prefill),
    setSpatialPins(pins) {
      currentPins = pins
      renderSpatialPins()
    },
    setSpatialPinsVisible(on) {
      spatialPinsVisible = on
      renderSpatialPins()
    },
    get spatialPinsVisible() { return spatialPinsVisible },
    setAutoCatchEnabled(on) { autoCatchEnabled = on },
    get autoCatchEnabled() { return autoCatchEnabled },
    dispose() {
      removeEventListener('keydown', onHotKey)
      clearInterval(pollTimer)
      if (activeToastTimer) clearTimeout(activeToastTimer)
      clearCues()
      closeOverlay()
      toastPanel.replaceChildren()
      style.remove()
    },
  }
}
