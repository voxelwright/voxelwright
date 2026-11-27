// Frictionless in-game feedback & bug reporter (#64).
// Zero visible DOM while closed (strictly obeying game-hud / sf-hud.mjs clear-body rules).
// Opens via F8, the Settings panel "Report bug" button, or `/bug <note>` typed directly in the ask bar.
// Immediately freeze-captures the WebGPU canvas (canvas only — never HTML DOM/API keys), crosshair pick,
// and the last 30 s black-box trace before the user even finishes typing.
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { FeedbackPayload, Recorder } from './recorder.ts'

export interface FeedbackUi {
  open(prefill?: string): Promise<void>
  close(): void
  submit(message: string, category?: string): Promise<{ sent: boolean; id?: string; payload: FeedbackPayload }>
  readonly isOpen: boolean
}

const CATEGORIES = [
  ['building', 'Building looks off'],
  ['stuck', 'I’m stuck'],
  ['vehicle', 'Car / traffic glitch'],
  ['perf', 'Lag / visual bug'],
  ['other', 'Other'],
] as const

const STYLE = /* css */ `
[data-panel="feedback"] { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; background: rgba(8, 11, 16, 0.56); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); pointer-events: auto; font: 400 14px/1.4 -apple-system, system-ui, sans-serif; color: #eef2f7; }
[data-panel="feedback"][hidden] { display: none !important; }
[data-panel="feedback"] * { box-sizing: border-box; }
[data-panel="feedback"] .fb-card { width: min(520px, calc(100vw - 28px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px 18px 18px; border-radius: 6px; background: rgba(18, 24, 34, 0.96); border: 1.5px solid rgba(110, 138, 180, 0.48); box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); display: grid; gap: 10px; }
[data-panel="feedback"] .fb-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
[data-panel="feedback"] h2 { margin: 0; font: 700 15px/1.2 -apple-system, system-ui, sans-serif; letter-spacing: 0.02em; }
[data-panel="feedback"] .fb-hint { margin: 0; font-size: 12px; color: #9eb0c7; }
[data-panel="feedback"] .fb-shot-wrap { position: relative; border-radius: 4px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.14); background: #0b0e14; cursor: crosshair; aspect-ratio: 16 / 9; display: grid; place-items: center; }
[data-panel="feedback"] .fb-shot { width: 100%; height: 100%; object-fit: cover; display: block; }
[data-panel="feedback"] .fb-pin { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 2px solid #fff600; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.7); pointer-events: none; }
[data-panel="feedback"] .fb-shot-cap { position: absolute; left: 8px; bottom: 8px; padding: 3px 7px; border-radius: 3px; background: rgba(10, 14, 20, 0.78); font: 500 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d8e2ef; pointer-events: none; }
[data-panel="feedback"] .fb-cats { display: flex; flex-wrap: wrap; gap: 6px; }
[data-panel="feedback"] .fb-cats button { border: 1px solid rgba(130, 158, 198, 0.35); border-radius: 4px; padding: 5px 9px; background: rgba(255, 255, 255, 0.06); color: #dce4ee; font: 500 12px/1.2 -apple-system, system-ui, sans-serif; cursor: pointer; }
[data-panel="feedback"] .fb-cats button.on { background: #2154e4; border-color: #6ea2ff; color: #fff; }
[data-panel="feedback"] input.fb-text { width: 100%; padding: 10px 12px; border-radius: 4px; border: 1.5px solid rgba(120, 152, 198, 0.5); background: #0e131c; color: #f4f7fb; font: 500 15px/1.3 -apple-system, system-ui, sans-serif; outline: none; user-select: text; -webkit-user-select: text; }
[data-panel="feedback"] input.fb-text:focus { border-color: #4e9aff; }
[data-panel="feedback"] .fb-meta { font: 400 11.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #9ab0ca; overflow-wrap: anywhere; }
[data-panel="feedback"] .fb-row { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-panel="feedback"] .fb-row button { min-height: 36px; padding: 7px 14px; border-radius: 4px; border: 0; background: rgba(255, 255, 255, 0.12); color: #eef2f7; font: 600 13px/1 -apple-system, system-ui, sans-serif; cursor: pointer; }
[data-panel="feedback"] .fb-row button.go { background: #2154e4; color: #fff; }
[data-panel="feedback"] .fb-row button:disabled { opacity: 0.5; cursor: default; }
[data-panel="feedback"] .fb-status { margin: 0; font-size: 12.5px; color: #f6b26b; }
`

const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function feedbackUi(o: { hud: Hud; input: Input; recorder: Recorder }): FeedbackUi {
  const panel = o.hud.panel('feedback')
  panel.hidden = true
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const card = el('div', 'fb-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Report an issue')

  const head = el('div', 'fb-head')
  head.append(el('h2', '', 'Report what looks off'), el('span', 'fb-hint', 'F8 · canvas + last 30 s captured'))

  const shotWrap = el('div', 'fb-shot-wrap')
  const shotImg = el('img', 'fb-shot')
  shotImg.alt = 'Frozen game frame'
  const pinDot = el('span', 'fb-pin')
  pinDot.hidden = true
  const shotCap = el('span', 'fb-shot-cap', 'Click image to point at a spot')
  shotWrap.append(shotImg, pinDot, shotCap)

  const catsRow = el('div', 'fb-cats')
  const catButtons = new Map<string, HTMLButtonElement>()
  let selectedCat = ''
  for (const [id, label] of CATEGORIES) {
    const b = el('button', '', label)
    b.type = 'button'
    b.addEventListener('click', () => {
      selectedCat = selectedCat === id ? '' : id
      for (const [k, btn] of catButtons) btn.classList.toggle('on', k === selectedCat)
      if (!textIn.value.trim() && selectedCat && selectedCat !== 'other') {
        textIn.value = label
        textIn.select()
      }
      textIn.focus()
    })
    catButtons.set(id, b)
    catsRow.append(b)
  }

  const textIn = el('input', 'fb-text')
  textIn.type = 'text'
  textIn.maxLength = 2000
  textIn.placeholder = 'e.g. this building looks off · I’m stuck · car passed through another car'
  textIn.setAttribute('aria-label', 'What went wrong')

  const metaLine = el('div', 'fb-meta')
  const statusLine = el('p', 'fb-status')
  statusLine.hidden = true

  const actions = el('div', 'fb-row')
  const dlBtn = el('button', '', 'Download .json')
  dlBtn.type = 'button'
  dlBtn.hidden = true
  const cancelBtn = el('button', '', 'Cancel')
  cancelBtn.type = 'button'
  const sendBtn = el('button', 'go', 'Send report')
  sendBtn.type = 'button'
  actions.append(dlBtn, cancelBtn, sendBtn)

  card.append(head, shotWrap, catsRow, textIn, metaLine, statusLine, actions)
  panel.append(card)

  let leave: (() => void) | null = null
  let frozen: FeedbackPayload | null = null
  let pin: [number, number] | null = null
  let busy = false

  const close = () => {
    if (!leave && panel.hidden) return
    panel.hidden = true
    leave?.()
    leave = null
    frozen = null
    pin = null
    pinDot.hidden = true
    selectedCat = ''
    for (const btn of catButtons.values()) btn.classList.remove('on')
    textIn.value = ''
    statusLine.hidden = true
    dlBtn.hidden = true
    busy = false
    sendBtn.disabled = false
    sendBtn.textContent = 'Send report'
  }

  const updateMeta = () => {
    if (!frozen) { metaLine.textContent = ''; return }
    const parts: string[] = []
    const last = frozen.keyframes[frozen.keyframes.length - 1]
    if (last) parts.push(`pos ${last.pose[0]}, ${last.pose[1]}, ${last.pose[2]} m (${last.mode})`)
    if (frozen.pick?.geo?.tile) parts.push(`tile ${frozen.pick.geo.tile}`)
    if (frozen.pick?.geo?.latLon) parts.push(`${frozen.pick.geo.latLon[0]}, ${frozen.pick.geo.latLon[1]}`)
    if (frozen.pick?.geo?.street) parts.push(frozen.pick.geo.street)
    if (frozen.pick?.nearVehicle) parts.push(`near ${frozen.pick.nearVehicle.name}`)
    parts.push(`${frozen.keyframes.length} frames · ${frozen.anomalies.length} anomalies`)
    metaLine.textContent = parts.join(' · ')
  }

  shotWrap.addEventListener('click', (e) => {
    const r = shotWrap.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const v = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    pin = [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000]
    pinDot.style.left = `${u * 100}%`
    pinDot.style.top = `${v * 100}%`
    pinDot.hidden = false
    shotCap.textContent = `Pinned (${Math.round(u * 100)}%, ${Math.round(v * 100)}%)`
    void o.recorder.pickAt(pin).then((picked) => {
      if (frozen && picked) { frozen.pick = picked; updateMeta() }
    })
  })

  const open = async (prefill = '') => {
    if (!panel.hidden) { textIn.focus(); return }
    // Freeze the canvas & black-box state BEFORE showing the dialog so the moment isn't lost.
    const captured = await o.recorder.report('', { screenshot: true, submit: false })
    frozen = captured.payload
    pin = null
    pinDot.hidden = true
    shotCap.textContent = 'Click image to point at a spot'
    if (frozen.screenshot) {
      shotImg.src = frozen.screenshot
      shotWrap.hidden = false
    } else {
      shotWrap.hidden = true
    }
    leave = o.input.push({ name: 'feedback', solid: true, text: true })
    panel.hidden = false
    statusLine.hidden = true
    dlBtn.hidden = true
    textIn.value = prefill
    updateMeta()
    textIn.focus()
  }

  const doSend = async () => {
    if (busy || !frozen) return
    const message = textIn.value.trim()
    if (!message) {
      statusLine.textContent = 'Type a short note about what went wrong.'
      statusLine.hidden = false
      textIn.focus()
      return
    }
    busy = true
    sendBtn.disabled = true
    sendBtn.textContent = 'Sending…'
    statusLine.hidden = true

    const payload: FeedbackPayload = {
      ...frozen,
      feedback: {
        message: message.slice(0, 2000),
        ...(selectedCat ? { category: selectedCat } : {}),
        ...(pin ? { pin } : {}),
      },
    }
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({})) as { id?: string }
        close()
        o.hud.notice(`Feedback saved${body.id ? ` (${body.id})` : ''}`, 4500)
        return
      }
      statusLine.textContent = `This host does not accept /api/feedback yet (${res.status}). Download the trace bundle to replay locally.`
      statusLine.hidden = false
      dlBtn.hidden = false
      dlBtn.onclick = () => { downloadJson(`feedback-${payload.sessionId}.json`, payload); close(); o.hud.notice('Feedback bundle downloaded', 3500) }
    } catch {
      statusLine.textContent = 'Could not reach /api/feedback. Download the trace bundle to replay locally.'
      statusLine.hidden = false
      dlBtn.hidden = false
      dlBtn.onclick = () => { downloadJson(`feedback-${payload.sessionId}.json`, payload); close(); o.hud.notice('Feedback bundle downloaded', 3500) }
    } finally {
      busy = false
      sendBtn.disabled = false
      sendBtn.textContent = 'Send report'
    }
  }

  cancelBtn.addEventListener('click', close)
  sendBtn.addEventListener('click', () => void doSend())
  panel.addEventListener('click', (e) => { if (e.target === panel) close() })
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Enter' && !e.isComposing && e.target === textIn) { e.preventDefault(); void doSend() }
  })

  // F8 opens feedback anywhere (not a letter key, so keys.ts and rule offers are unaffected).
  o.input.always('F8', (e) => {
    e.preventDefault()
    if (panel.hidden) void open()
    else close()
    return true
  })

  // One-line `/bug <message>` or `/feedback <message>` right in the existing ask bar!
  const BUG_CMD = /^\/(?:bug|feedback|report)\b(.*)$/i
  o.hud.line.take((ask, dry) => {
    if (ask.picture || ask.link || !ask.wish) return false
    const m = BUG_CMD.exec(ask.wish.trim())
    if (!m) return false
    if (dry) return true
    const note = m[1].trim()
    if (!note) { void open(); return true }
    void o.recorder.report(note, { screenshot: true, submit: true }).then((r) => {
      if (r.sent) o.hud.notice(`Feedback saved${r.id ? ` (${r.id})` : ''}`, 4500)
      else o.hud.notice(`Feedback captured locally (${r.error ?? 'offline'})`, 5000)
    })
    return true
  }, 'Report')

  return {
    open,
    close,
    async submit(message, category) {
      const r = await o.recorder.report(message, { category, screenshot: true, submit: true })
      return { sent: r.sent, id: r.id, payload: r.payload }
    },
    get isOpen() { return !panel.hidden },
  }
}
