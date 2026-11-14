// The workshop, from inside the game (#264): what models writing rules said the engine could not do, as cards, and
// a way for the owner of this machine to send one to a development session that builds the missing engine plugin.
// The helper on this machine does it (workshop/route.mjs); this is what is shown.
//
// A chip in the corner says how many things are waiting. Open, each is a card: what was asked, by whom, and what
// could not be done. "Send to the workshop" does not send: it shows the brief the session would be given, whole,
// to be read. Only "Start the session" under the brief sends it, and what is sent is that brief.
//
// Every word of a card and of a brief is put as text: a wish, a name or a model's line with markup in it is
// letters on the screen. Without a helper on this machine there is no chip: someone playing from elsewhere sees nothing of this.
import type { Asker } from './ask.ts'
import type { Hud } from './hud.ts'

interface Gap { id: string; at: string; by: string; wish: string; rule: string; line: string; sent: { thread: string; link: string; at: string } | null }
export interface Workshop {
  /** Asks the helper again what is waiting. Resolves to how many are not yet sent. */
  refresh(): Promise<number>
  /** Opens or closes the list. */
  show(open: boolean): void
  readonly open: boolean
}

const STYLE = `
[data-panel="workshop"] { position: fixed; right: 16px; top: 16px; z-index: 6; max-width: min(460px, calc(100vw - 32px)); font: 14px/1.4 system-ui, sans-serif; color: #eef1f4; pointer-events: none }
[data-panel="workshop"] * { box-sizing: border-box }
[data-panel="workshop"] button { font: inherit; color: inherit; border: 0; border-radius: 9px; padding: 7px 12px; background: #ffffff1f; cursor: pointer; pointer-events: auto; min-height: 36px }
[data-panel="workshop"] button:hover { background: #ffffff33 }
[data-panel="workshop"] button.go { background: #e2a03f; color: #1c1408; font-weight: 650 }
[data-panel="workshop"] button.go:hover { background: #f0b352 }
[data-panel="workshop"] button:disabled { opacity: .5; cursor: default }
[data-panel="workshop"] .chip { float: right; background: #14181dd9; backdrop-filter: blur(8px); border-radius: 999px; padding: 7px 14px }
[data-panel="workshop"] .chip b { color: #e2a03f; margin-left: 6px }
[data-panel="workshop"] .list { clear: both; margin-top: 46px; max-height: calc(100vh - 230px); overflow: auto; pointer-events: auto; background: #14181de6; backdrop-filter: blur(10px); border-radius: 14px; padding: 14px }
[data-panel="workshop"] h2 { margin: 0 0 2px; font-size: 15px; font-weight: 650 }
[data-panel="workshop"] .about { margin: 0 0 12px; color: #aab3bd; font-size: 13px }
[data-panel="workshop"] .gap { border-top: 1px solid #ffffff1a; padding: 11px 0 }
[data-panel="workshop"] .gap .line { margin: 0 0 4px }
[data-panel="workshop"] .gap .from { margin: 0 0 8px; color: #aab3bd; font-size: 12.5px; overflow-wrap: anywhere }
[data-panel="workshop"] .gap .sent { color: #8fd19e; font-size: 13px }
[data-panel="workshop"] pre { margin: 10px 0; padding: 11px; max-height: 30vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #0b0d10; border-radius: 9px; font: 12px/1.45 ui-monospace, Menlo, monospace; color: #d7dde3 }
[data-panel="workshop"] .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
[data-panel="workshop"] .why { color: #f0a8a0; font-size: 13px }
`

export function workshop(over: Hud, asker: Asker): Workshop {
  const panel = over.panel('workshop'), el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; return e }
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const chip = el('button', 'chip'), list = el('div', 'list')
  chip.type = 'button'
  chip.title = 'What the engine could not do yet, to send to a development session'
  panel.append(chip, list)
  panel.hidden = true
  list.hidden = true
  let gaps: Gap[] = [], open = false
  /** The brief being read, if one is: for which gap, its token, its words, and what came of sending it. */
  let reading: { gap: string; brief: string; text: string; busy: boolean; why: string } | null = null
  const waiting = () => gaps.filter((g) => !g.sent).length
  const draw = () => {
    panel.hidden = !gaps.length && !open
    chip.replaceChildren('Workshop', el('b', '', String(waiting())))
    list.hidden = !open
    if (!open) return
    list.replaceChildren(el('h2', '', 'The workshop'), el('p', 'about', 'What a rule could not do with what the engine offers. Send one to a development session on this machine: it builds the missing piece as a plugin and opens a pull request. Nothing is loaded until that is merged.'))
    if (!gaps.length) list.append(el('p', 'about', 'Nothing is waiting. When a rule is written and something was missing, it shows here.'))
    for (const g of gaps) {
      const card = el('div', 'gap')
      card.append(el('p', 'line', g.line), el('p', 'from', `${g.by} asked for: ${g.wish}`))
      if (g.sent) card.append(el('p', 'sent', `Sent to the workshop${g.sent.thread ? ` (thread ${g.sent.thread.slice(0, 8)})` : ''}. Its pull request comes next.`))
      else if (reading?.gap === g.id) {
        const r = reading, row = el('div', 'row'), go = el('button', 'go', r.busy ? 'Starting…' : 'Start the session'), no = el('button', '', 'Not now')
        go.disabled = r.busy
        go.addEventListener('click', () => void send())
        no.addEventListener('click', () => { reading = null; draw() })
        row.append(go, no)
        card.append(el('p', 'from', 'This is all the session will be told. Read it, then start it.'), el('pre', '', r.text), row)
        if (r.why) card.append(el('p', 'why', r.why))
      } else {
        const b = el('button', '', 'Send to the workshop')
        b.addEventListener('click', () => void read(g))
        card.append(b)
      }
      list.append(card)
    }
  }
  const refresh = async () => {
    const r = await asker.call('/workshop/gaps')
    if (r?.ok && Array.isArray(r.value.gaps)) gaps = r.value.gaps as Gap[]
    draw()
    return waiting()
  }
  /** The brief for a gap, asked of the helper and shown: nothing is sent. */
  const read = async (g: Gap) => {
    const r = await asker.call('/workshop/brief', { gap: g.id })
    if (r?.ok && typeof r.value.brief === 'string' && typeof r.value.text === 'string') reading = { gap: g.id, brief: r.value.brief, text: r.value.text, busy: false, why: '' }
    else over.notice(typeof r?.value.why === 'string' ? `The workshop: ${r.value.why}` : 'The helper on this machine could not be reached', 6000)
    draw()
  }
  /** The brief that is being read, sent as it was read. */
  const send = async () => {
    const r = reading
    if (!r || r.busy) return
    r.busy = true; r.why = ''
    draw()
    const sent = await asker.call('/workshop/send', { brief: r.brief })
    if (sent?.ok) { reading = null; over.notice('A development session has been started in T3 Code', 7000); await refresh() }
    else { r.busy = false; r.why = typeof sent?.value.why === 'string' ? sent.value.why : 'The helper on this machine could not be reached'; draw() }
  }
  const show = (to: boolean) => { open = to; if (open) void refresh(); else draw() }
  chip.addEventListener('click', () => show(!open))
  // Asked when the page starts and now and then: a rule written from the bar, or from a terminal, adds to the list.
  if (asker.known) { void refresh(); setInterval(() => { if (!document.hidden && !reading) void refresh() }, 15_000) }
  return { refresh, show, get open() { return open } }
}
