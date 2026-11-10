// The Elder's card (#87): a paper card by the notepad that shows a change the Elder is
// making as it goes (copy, parts, the picture before, the writing, each gate), then the
// home before and after, or the plain reason it failed.
//
// The card never keeps, undoes or turns down a change (host/src/approval.ts says why). Its
// "Look and decide" and "Undo" open the host's approval page in a new tab, and the card then
// follows the result. Everything on it is what the host said
// (host/src/elder-home.ts). It polls the host once a second while a run is going, every two
// seconds for a while after the approval page was opened, and does nothing per frame.
import { approvalLink, askElder, elderPicture, elderRun, elderState, type ElderRun, type ElderStage } from '../villager'

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const INK = '#23395a'
const POLL_MS = 1000
/** After the approval page was opened: how often, and for how long, the card looks for the decision. */
const WATCH_MS = 2000
const WATCH_FOR_MS = 15 * 60_000

const MARKS: Record<ElderStage['state'], string> = { pass: '✓', fail: '✕', now: '', waiting: '', skipped: '–', warn: '!' }
const STATE_WORDS: Record<ElderStage['state'], string> = { pass: 'done', fail: 'failed', now: 'now', waiting: 'not yet', skipped: 'not run', warn: 'a warning only' }

const clock = (ms = 0) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}
const cents = (usd: number | null | undefined) => (typeof usd === 'number' ? (usd < 0.995 ? `about ${Math.max(1, Math.round(usd * 100))}¢` : `about $${usd.toFixed(2)}`) : null)
const DISMISSED = 'village.elder.dismissed'

export interface ElderCard {
  /** Ask the Elder for a change in the person's own words. Answers with the villager's line about it. */
  ask(text: string): Promise<string>
  state(): { shown: boolean; status: string | null; id: string | null; stages: ElderStage[]; reason: string | null; said: string | null; pictures: boolean; polling: boolean; buttons: string[]; approval: string | null }
  dispose(): void
}

export function elderCard(): ElderCard {
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  const card = document.createElement('section')
  card.className = 'elder-card'
  card.setAttribute('aria-label', "The Elder's change")
  card.hidden = true
  document.body.append(card)

  let run: ElderRun | null = null
  let pics: { id: string; before: string | null; after: string | null } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let note: string | null = null
  let disposed = false
  /** The host's approval page addresses, from the Elder's state. */
  let approval: string[] | undefined
  /** Until when the card looks for a decision made on the approval page. */
  let watchUntil = 0

  const dismissed = () => {
    try {
      return sessionStorage.getItem(DISMISSED)
    } catch {
      return null
    }
  }
  const dismiss = (id: string) => {
    try {
      sessionStorage.setItem(DISMISSED, id)
    } catch {}
  }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  const button = (label: string, cls: string, act: () => void) => {
    const b = el('button', `elder-button ${cls}`, label)
    b.type = 'button'
    b.addEventListener('click', act)
    return b
  }
  /** A link to the approval page for this run, in a new tab; the card then watches for the decision. */
  const decide = (label: string, cls: string) => {
    const href = run ? approvalLink(approval, run.id) : null
    if (!href) return el('p', 'elder-note', "I can't find the page to decide on. Ask whoever looks after the house.")
    const a = el('a', `elder-button ${cls}`, label)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.addEventListener('click', () => {
      watchUntil = Date.now() + WATCH_FOR_MS
      poll()
    })
    return a
  }

  const render = () => {
    if (disposed) return
    const hadFocus = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key ?? null : null
    card.replaceChildren()
    if (!run) {
      card.hidden = true
      return
    }
    card.hidden = false
    card.dataset.status = run.status
    card.setAttribute('aria-busy', String(run.status === 'running'))
    card.append(el('div', 'elder-tape'))
    const head = el('p', 'elder-head', 'The Elder')
    card.append(head)
    card.append(el('p', 'elder-request', `“${run.request}”`))

    const status = el('p', 'elder-status')
    status.setAttribute('role', 'status')
    if (run.status === 'running') {
      status.textContent = `Making it. ${clock(run.totalMs)} so far; usually two or three minutes. Carry on, the pictures will come here.`
      card.append(stages(run.stages), status)
    } else if (run.status === 'passed') {
      status.textContent = 'It passed its checks. Keep it or not on its own page, and this card will follow.'
      card.append(pictures(), status)
      const row = el('div', 'elder-actions')
      const keep = decide('Look and decide', 'primary')
      keep.dataset.key = 'decide'
      row.append(keep)
      card.append(row)
    } else if (run.status === 'kept') {
      const where = run.liveUrl ? ` (${run.liveUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')})` : ''
      status.textContent = run.here
        ? "Kept. It's in the home now, the copy the family uses."
        : `Kept. It lives in the live home now${where}, the copy the family uses. This room is a separate copy, so it won't appear here.`
      card.append(pictures(), status)
      const row = el('div', 'elder-actions')
      const undo = decide('Undo', 'quiet')
      undo.dataset.key = 'undo'
      const done = button('Done', 'primary', () => (dismiss(run!.id), (run = null), render()))
      done.dataset.key = 'done'
      row.append(done, undo)
      card.append(row)
    } else if (run.status === 'declined') {
      status.textContent = 'Turned down. Nothing changed.'
      card.append(status)
      const row = el('div', 'elder-actions')
      const done = button('Done', 'primary', () => (dismiss(run!.id), (run = null), render()))
      done.dataset.key = 'done'
      row.append(done)
      card.append(row)
    } else if (run.status === 'undone') {
      status.textContent = "Undone. It's out of the live home again, and everything it changed is back as it was."
      card.append(status)
      const row = el('div', 'elder-actions')
      const done = button('Done', 'primary', () => (dismiss(run!.id), (run = null), render()))
      done.dataset.key = 'done'
      row.append(done)
      card.append(row)
    } else {
      // failed or interrupted
      status.textContent = run.status === 'interrupted' ? 'It was cut off.' : "It didn't work."
      card.append(stages(run.stages), status)
      card.append(el('p', 'elder-reason', run.reason ?? "The change didn't pass its checks."))
      if (run.detail) card.append(el('p', 'elder-detail', run.detail))
      const row = el('div', 'elder-actions')
      const away = button('Put it away', 'quiet', () => (dismiss(run!.id), (run = null), render()))
      away.dataset.key = 'decline'
      row.append(away)
      card.append(row)
    }
    if (note) {
      const n = el('p', 'elder-note', note)
      n.setAttribute('role', 'alert')
      card.append(n)
    }
    if (run.status !== 'running') {
      const facts = [run.totalMs ? `Took ${clock(run.totalMs)}` : null, cents(run.costUsd), run.warning ? 'one in-page hint' : null].filter(Boolean)
      if (facts.length) card.append(el('p', 'elder-facts', facts.join(' · ')))
    }
    if (hadFocus) (card.querySelector(`[data-key="${hadFocus}"]`) as HTMLElement | null)?.focus({ preventScroll: true })
  }

  const stages = (list: ElderStage[]) => {
    const ol = el('ol', 'elder-stages')
    for (const s of list) {
      const li = el('li', `elder-stage ${s.state}`)
      const mark = el('span', 'elder-mark', MARKS[s.state])
      mark.setAttribute('aria-hidden', 'true')
      const name = el('span', 'elder-name', s.label ?? s.name)
      const sr = el('span', 'elder-sr', `: ${STATE_WORDS[s.state]}`)
      li.append(mark, name, sr)
      if (s.ms !== undefined && (s.state === 'pass' || s.state === 'now' || s.state === 'fail')) li.append(el('span', 'elder-ms', clock(s.ms)))
      ol.append(li)
    }
    return ol
  }

  /** One picture with Before and After over it: switching in the same frame shows what changed, however small. */
  let showing: 'before' | 'after' = 'after'
  const pictures = () => {
    const fig = el('figure', 'elder-photo')
    const url = pics?.id === run?.id ? pics?.[showing] : null
    if (url) {
      const img = el('img')
      img.src = url
      img.alt = showing === 'before' ? 'The home before the change' : 'The home with the change'
      fig.append(img)
    } else fig.append(el('div', 'elder-nopic', run?.pictures ? '…' : 'no picture'))
    const tabs = el('div', 'elder-flip')
    tabs.setAttribute('role', 'group')
    tabs.setAttribute('aria-label', 'Picture of the home')
    for (const which of ['before', 'after'] as const) {
      const b = el('button', 'elder-flip-button', which === 'before' ? 'Before' : 'After')
      b.type = 'button'
      b.dataset.key = which
      b.setAttribute('aria-pressed', String(showing === which))
      b.addEventListener('click', () => {
        showing = which
        render()
      })
      tabs.append(b)
    }
    fig.append(tabs)
    return fig
  }

  const loadPictures = async () => {
    if (!run?.pictures || pics?.id === run.id) return
    const id = run.id
    const [before, after] = await Promise.all([elderPicture(id, 'before'), elderPicture(id, 'after')])
    if (disposed || run?.id !== id) {
      for (const u of [before, after]) if (u) URL.revokeObjectURL(u)
      return
    }
    if (pics) for (const u of [pics.before, pics.after]) if (u) URL.revokeObjectURL(u)
    pics = { id, before, after }
    render()
  }

  const take = (r: ElderRun | null | undefined) => {
    if (!r) return
    const was = run?.status
    run = r
    // The decision came in: stop looking for it until the approval page is opened again.
    if (was && was !== r.status && r.status !== 'running') watchUntil = 0
    render()
    if (r.status !== 'running') void loadPictures()
    // The result came in: offer the decision to the keyboard, without taking it from someone writing.
    if (was === 'running' && r.status !== 'running' && (document.activeElement === document.body || document.activeElement === null))
      (card.querySelector('.elder-button') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  /** A run going, or a decision being made on the approval page: what the card waits for. */
  const waiting = () => run?.status === 'running' || ((run?.status === 'passed' || run?.status === 'kept') && Date.now() < watchUntil)
  const refresh = async () => {
    if (!run || disposed) return
    const r = await elderRun(run.id)
    if (r.ok && r.run?.id === run?.id) take(r.run)
  }
  const poll = () => {
    if (timer || disposed || !waiting()) return
    timer = setTimeout(async () => {
      timer = null
      await refresh()
      poll()
    }, run?.status === 'running' ? POLL_MS : WATCH_MS)
  }
  // Back from the approval page: look once at once, without waiting for the next poll.
  const back = () => {
    if (document.visibilityState === 'visible' && run && run.status !== 'running') void refresh()
  }
  document.addEventListener('visibilitychange', back)
  addEventListener('focus', back)

  // On load: a run going on, or a decision still waiting, shows again.
  void elderState().then((r) => {
    if (!r.ok || disposed) return
    approval = r.approval
    if (!r.run || r.run.status === 'declined' || dismissed() === r.run.id) return render()
    take(r.run)
    poll()
  })

  return {
    async ask(text) {
      if (!approval) {
        const state = await elderState()
        if (state.ok) approval = state.approval
      }
      const r = await askElder(text)
      if (r.ok && r.run) {
        note = null
        pics = null
        showing = 'after'
        take(r.run)
        poll()
        return "I've asked the Elder. Its card is by your notepad."
      }
      if (!r.ok && r.why === 'refused') return r.message ?? "The Elder can't take that just now."
      if (!r.ok && r.why === 'link') return "I can't hear you until this device is paired. Open your pairing link and say it again."
      return r.ok ? "The Elder didn't answer." : "I can't reach the Elder just now."
    },
    state: () => ({
      shown: !card.hidden,
      status: run?.status ?? null,
      id: run?.id ?? null,
      stages: run?.stages.map((s) => ({ ...s })) ?? [],
      reason: run?.reason ?? null,
      said: note,
      pictures: Boolean(pics?.before && pics?.after && pics.id === run?.id),
      polling: timer !== null,
      buttons: [...card.querySelectorAll('button, a.elder-button')].map((b) => b.textContent ?? ''),
      approval: (card.querySelector('a.elder-button') as HTMLAnchorElement | null)?.href ?? null,
    }),
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', back)
      removeEventListener('focus', back)
      if (pics) for (const u of [pics.before, pics.after]) if (u) URL.revokeObjectURL(u)
      card.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  .elder-card { position: fixed; z-index: 6; right: clamp(16px, 28vw, 400px); bottom: 22px; width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
    padding: 22px 22px 16px; color: #3b2a1e; font: 15px/1.4 ${BOOK};
    background:
      radial-gradient(120% 90% at 20% 0%, rgba(255, 255, 255, 0.55), transparent 60%),
      repeating-linear-gradient(0deg, rgba(120, 90, 60, 0.035) 0 1px, transparent 1px 4px),
      linear-gradient(170deg, #fdf6e6, #f1e2c4);
    border-radius: 3px 5px 4px 6px; transform: rotate(-0.6deg);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 14px 28px -10px rgba(60, 30, 10, 0.45), 0 2px 4px rgba(60, 30, 10, 0.18);
    clip-path: polygon(0 1.2%, 6% 0, 19% 0.8%, 33% 0, 48% 0.9%, 63% 0.1%, 78% 0.9%, 92% 0, 100% 1%, 100% 99%, 93% 100%, 79% 99.2%, 64% 100%, 49% 99.1%, 34% 100%, 20% 99.3%, 7% 100%, 0 99%); }
  .elder-card[hidden] { display: none; }
  .elder-tape { position: absolute; left: 50%; top: -2px; width: 96px; height: 20px; transform: translateX(-50%) rotate(1.5deg);
    background: linear-gradient(90deg, rgba(196, 160, 92, 0.75), rgba(214, 184, 120, 0.7)); box-shadow: 0 1px 2px rgba(60, 30, 10, 0.15); }
  .elder-head { margin: 0; font: 600 11px/1 ${BOOK}; letter-spacing: 0.22em; text-transform: uppercase; color: #8a5a2b; }
  .elder-request { margin: 6px 0 12px; font: 21px/1.2 ${HAND}; color: ${INK}; }
  .elder-stages { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 3px; }
  .elder-stage { display: grid; grid-template-columns: 18px 1fr auto; align-items: baseline; color: #5a4636; }
  .elder-stage.waiting, .elder-stage.skipped { color: rgba(90, 70, 54, 0.45); }
  .elder-stage.now { color: #2c1e14; font-weight: 600; }
  .elder-stage.fail { color: #9a2f22; font-weight: 600; }
  .elder-mark { font-weight: 700; text-align: center; }
  .elder-stage.pass .elder-mark { color: #4f7a4a; }
  .elder-stage.warn .elder-mark { color: #b07a1c; }
  .elder-stage.now .elder-mark::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${INK}; vertical-align: 1px; }
  .elder-stage.waiting .elder-mark::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; border: 1px solid currentColor; vertical-align: 1px; box-sizing: border-box; }
  @media (prefers-reduced-motion: no-preference) {
    .elder-stage.now .elder-mark::before { animation: elder-breathe 1.6s ease-in-out infinite; }
  }
  @keyframes elder-breathe { 50% { opacity: 0.25; } }
  .elder-ms { font-size: 12px; color: rgba(90, 70, 54, 0.7); font-variant-numeric: tabular-nums; }
  .elder-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .elder-status { margin: 4px 0 10px; }
  .elder-reason { margin: 0 0 6px; font-weight: 600; color: #7d2a1f; }
  .elder-detail { margin: 0 0 10px; font: 11px/1.35 ui-monospace, Menlo, monospace; color: rgba(70, 50, 36, 0.75); overflow-wrap: anywhere; max-height: 4.2em; overflow: hidden; }
  .elder-note { margin: 8px 0 0; padding: 6px 8px; background: rgba(154, 47, 34, 0.08); border-left: 3px solid #9a2f22; }
  .elder-photo { position: relative; margin: 2px 0 10px; padding: 6px 6px 7px; background: #fffdf7; box-shadow: 0 3px 8px -2px rgba(60, 30, 10, 0.35); transform: rotate(-0.8deg); }
  .elder-photo img, .elder-nopic { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; background: #e8dcc4; }
  .elder-nopic { display: grid; place-items: center; font-size: 12px; color: rgba(90, 70, 54, 0.6); }
  .elder-flip { position: absolute; left: 12px; bottom: 13px; display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255, 250, 238, 0.92); box-shadow: 0 1px 3px rgba(60, 30, 10, 0.3); }
  .elder-flip-button { font: 15px/1 ${HAND}; color: ${INK}; background: none; border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
  .elder-flip-button[aria-pressed="true"] { background: ${INK}; color: #fdf6e6; }
  .elder-flip-button:focus-visible { outline: 3px solid #c48a2c; outline-offset: 1px; }
  .elder-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .elder-button { display: inline-flex; align-items: center; box-sizing: border-box; text-decoration: none; font: 600 15px/1 ${BOOK}; padding: 10px 16px; min-height: 40px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(60, 40, 26, 0.35); }
  .elder-button.primary { background: linear-gradient(#3d5c86, #2d4668); color: #fdf6e6; border-color: #22385a; box-shadow: 0 2px 0 #1c2f4c; }
  .elder-button.quiet { background: rgba(255, 252, 244, 0.7); color: #3b2a1e; }
  .elder-button:hover:not(:disabled) { filter: brightness(1.06); }
  .elder-button:focus-visible { outline: 3px solid #c48a2c; outline-offset: 2px; }
  .elder-button:disabled { opacity: 0.55; cursor: progress; }
  .elder-facts { margin: 10px 0 0; font-size: 12px; color: rgba(90, 70, 54, 0.75); }
  @media (max-width: 720px) { .elder-card { right: 16px; left: 16px; width: auto; bottom: 16px; } }
  `
}
