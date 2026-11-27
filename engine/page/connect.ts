// A visitor's own AI, connected (#526): the panel where they give a key and choose which model answers, and the model
// the page's maker asks (maker.ts `Seam.model`, main.ts `makingSeam`) through models.ts. Fetched the first time it is
// needed: a wish nothing kept answers, or the realm's settings key for it. Nothing of it is in the bytes before then.
//
// What holds:
//   - The key is in this file's closure, in models.ts's request headers to its own provider, in the password field while
//     it is typed, and under `village.ai` in this tab's storage (sessionStorage: gone when the tab closes), or, only
//     when the visitor ticks "Remember key in this browser", in this browser's (localStorage, #81). Nowhere else: not in the DOM as text once connected
//     (its last four characters at most), not in an address, a log, an error, a message to a host page or anything
//     `engine` holds. What this file hands back is the reply's text alone. A provider's own words are shown only with the
//     key taken out of them (`scrub`).
//   - Only what the visitor typed reaches the model: the maker asks only for a typed wish (maker.ts, `Ask.typed`), and
//     this file asks nothing of its own. Nothing a host page, a board or a link says opens the panel or fills it.
//   - A wish asked with nothing connected is not lost: it waits, in its turn, while the visitor connects, and is then
//     made as it was asked. Let go (Not now, or the panel shut without a key), it goes quietly ('let go', making.ts).
//   - Another tab that connects with its key remembered, or forgets a remembered one, is followed here (the storage
//     event). A key kept for one tab alone is that tab's.
//
// The panel is the Voxelmorphism kit's dialog (engine/kit): plain HTML first, voxels when the kit draws them. It sits
// outside the realm's controls (realm-ui.ts gives the keys back to the world when a pointer is let go there).
import { ABOUT, keep, kept, models, preferred, remembered, reply, Unanswered, type Connected, type Listed, type Route } from './models.ts'
import type { Ask, Stage } from './ask.ts'
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Making } from './making.ts'

type Kit = { adopt(root?: Element): void; refresh?(el: Element): void }
type Question = { system: string; prompt: string; pictures: { type: string; data: string }[] }

export interface Connect {
  /** Ensures a model is connected before making begins: with none, asks the visitor first and resolves to whether one is connected. */
  ready(ask: Ask | null): Promise<boolean>
  /** The model as the maker asks one: the connected one, or, with none, the visitor is asked to connect first and the wish waits. Throws a short line fit to show, never the key. */
  ask(q: Question, tell?: (stage: Stage) => void): Promise<{ text: string }>
  /** Opens the panel. */
  open(): void
}

const ROUTES = Object.keys(ABOUT) as Route[]
/** Thousands with a comma, as a bill shows them. */
const count = (n: number) => n.toLocaleString('en-US')
/** Whether this browser keeps anything for this site past the tab (a private window may not): whether a key can be remembered. */
const storable = () => { try { localStorage.setItem('village.ai.can', '1'); localStorage.removeItem('village.ai.can'); return true } catch { return false } }

const STYLE = /* css */ `
#connect { color: var(--vx-ink); font: 400 15px/1.5 var(--vx-font, system-ui, sans-serif); }
#connect[open] { display: flex; flex-direction: column; }
/* Kept inside what the phone shows above its keyboard (--seen, from visualViewport): the field and the key that acts on it stay in sight. */
#connect { margin: auto; max-block-size: min(calc(100dvh - 32px), calc(var(--seen, 100dvh) - 24px)); }
@media (pointer: coarse) { #connect { margin-block-start: max(12px, env(safe-area-inset-top)); } }
#connect > header { flex: none; }
#connect .vx-dialog-body { flex: 1 1 auto; min-block-size: 0; display: grid; gap: calc(var(--vx) * 4); padding-block-end: calc(var(--vx) * 3); }
/* (A key's solid stands up and to the left of its face by half its height: room for it under the words above.) */
#connect > footer { flex: none; align-items: center; padding-block-start: calc(var(--vx) * 6); }
#connect > footer .gap { margin-inline-end: auto; }
/* A phone held upright: the keys one under another, the main one first, each the panel's width. */
@media (max-width: 480px) {
  #connect > footer { flex-direction: column-reverse; align-items: stretch; row-gap: calc(var(--vx) * 5); padding-block-end: calc(var(--vx) * 8); }
  #connect > footer .vx-button { justify-content: center; }
  #connect > footer .gap { margin-inline-end: 0; }
}
#connect .wish { margin: 0; padding-inline-start: calc(var(--vx) * 3); border-inline-start: calc(var(--vx) * 1) solid var(--vx-signal); }
#connect .wish q { font-weight: 600; }
#connect .routes { inline-size: 100%; grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#connect .routes > label { padding-inline: calc(var(--vx) * 2.5); white-space: nowrap; justify-content: center; }
#connect .key { display: flex; gap: calc(var(--vx) * 2); align-items: stretch; }
#connect .key .vx-well { flex: 1; min-inline-size: 0; }
/* 16 px: under that Safari zooms the page to the field. */
#connect :is(.vx-well input, .pick select) { font-size: 16px; }
/* The model's list: a well as the key's is, drawn here (the kit's well is for a line to type on). */
#connect .pick { display: block; position: relative; background: color-mix(in oklab, var(--vx-chalk), #6b5a3a 16%); box-shadow: inset calc(var(--vx) * 1) calc(var(--vx) * 1) 0 rgb(10 15 61 / 0.22), inset 0 0 0 calc(var(--vx) * 0.5) var(--vx-slate); }
#connect .pick:has(select:focus-visible) { outline: 2px solid var(--vx-focus); outline-offset: calc(var(--vx) * 1); }
#connect .pick::after { content: ""; position: absolute; right: calc(var(--vx) * 4); top: 50%; inline-size: 0; block-size: 0; border-inline: 5px solid transparent; border-block-start: 7px solid var(--vx-ink); translate: 0 -30%; pointer-events: none; }
#connect .pick select { appearance: none; -webkit-appearance: none; padding-inline-end: calc(var(--vx) * 10); outline: none; cursor: pointer; }
#connect .pick select { display: block; box-sizing: border-box; inline-size: 100%; min-block-size: calc(var(--vx) * 11); padding: 0 calc(var(--vx) * 3); margin: 0; border: 0; border-radius: 0; background: none; color: var(--vx-ink); font: 500 16px/1.5 var(--vx-font); }
#connect .pick select option { color: #0a0f3d; background: #fbfcff; }
#connect .reveal { min-inline-size: calc(var(--vx) * 19); justify-content: center; }
#connect .named { display: flex; align-items: baseline; justify-content: flex-start; column-gap: 16px; flex-wrap: wrap; }
#connect .get { font-size: 14px; color: var(--vx-ink); font-weight: 600; text-underline-offset: 3px; }
#connect .said { margin: 0; font-weight: 600; }
#connect .said:empty { display: none; }
#connect .said[data-tone="bad"] { color: var(--vx-danger-text, #b3261e); }
#connect .truth { margin: 0; color: var(--vx-ink-quiet); font-size: 14px; }
#connect .remember { font-size: 14px; }
#connect .truth b { color: var(--vx-ink); font-weight: 600; }
#connect details { font-size: 14px; color: var(--vx-ink-quiet); }
#connect summary { cursor: pointer; font-weight: 600; color: var(--vx-ink); min-block-size: 32px; display: flex; align-items: center; gap: 8px; list-style: none; }
#connect summary::-webkit-details-marker { display: none; }
#connect summary::before { content: ""; inline-size: 0; block-size: 0; border-block: 5px solid transparent; border-inline-start: 7px solid currentColor; transition: rotate 0.15s ease-out; }
#connect details[open] summary::before { rotate: 90deg; }
@media (prefers-reduced-motion: reduce) { #connect summary::before { transition: none; } }
#connect details p { margin: calc(var(--vx) * 1) 0 0; }
#connect .on { display: grid; gap: calc(var(--vx) * 1); margin: 0; }
#connect .on dt { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#connect .on dd { margin: 0 0 calc(var(--vx) * 2); font-weight: 600; }
#connect .lamp { display: inline-block; inline-size: 10px; block-size: 10px; margin-inline-end: 8px; background: var(--vx-leaf, #23a84b); box-shadow: 0 0 6px var(--vx-leaf, #23a84b); vertical-align: 1px; }
#connect [hidden] { display: none !important; }
/* The bar's own line under it while a thing is made with the visitor's AI, and what came of it: as the bar's question is drawn (#choice). */
#ai-line { align-self: center; max-inline-size: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 12px; border-radius: 14px; background: rgba(12, 16, 22, 0.78); color: #e8ecf1; font: 500 14px/1.35 -apple-system, system-ui, sans-serif; pointer-events: auto; }
#ai-line[hidden] { display: none; }
/* By touch the thumb's keys stand down the right edge over the bar: the line keeps left of them, its Stop in reach. */
@media (pointer: coarse) { #ai-line { box-sizing: border-box; align-self: flex-start; max-inline-size: calc(100% - 88px); } }
#ai-line p { margin: 0; overflow-wrap: anywhere; }
#ai-line .quiet { color: rgba(232, 236, 241, 0.72); }
#ai-line .n { font-variant-numeric: tabular-nums; color: rgba(232, 236, 241, 0.72); }
#ai-line button { flex: none; border: 0; border-radius: 9px; min-block-size: 32px; padding: 0 12px; background: #e8ecf1; color: #10141a; font: 600 13px -apple-system, system-ui, sans-serif; touch-action: manipulation; }
/* Its state at a glance: breathing while it is made, green once made, amber when it was not. */
#ai-line .dot { flex: none; inline-size: 8px; block-size: 8px; background: #f2b84b; }
#ai-line[data-tone="good"] .dot { background: #8fd19e; }
#ai-line[data-tone="busy"] .dot { background: #8fb8ff; animation: ai-breathe 1.6s ease-in-out infinite; }
@keyframes ai-breathe { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { #ai-line .dot { animation: none; } }
.ai-hide { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`

export function connect(o: { hud: Hud; input: Input; wish: Making; /** The ask the maker last said it was asking a model for (main.ts hears it from the start: this file comes later). */ asking: () => Ask | null }): Connect {
  /** What is connected: kept in this browser, or for this page alone where it keeps nothing. */
  let held: Connected | null = kept()
  /** Model names by id, as the provider listed them. */
  const names = new Map<string, string>()
  const named = (id: string) => names.get(id) ?? id
  /** Takes any key this page holds out of words before they are shown or logged. */
  const scrub = (text: string) => {
    let out = text
    for (const k of [held?.key, field?.value]) if (k && k.length >= 6) out = out.split(k).join('…')
    // A provider that quotes part of a key back (OpenAI shows its start and end): nothing that looks like one is passed on.
    return out.replace(/\b(sk|AIza|key)[-_A-Za-z0-9]{8,}/g, '…')
  }
  addEventListener('storage', (e) => { if (e.key !== 'village.ai' && e.key !== null) return; held = kept(); if (dialog?.open) draw() })

  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  // ── The bar's line: what is being made with the visitor's AI, and what came of it ──
  const line = document.createElement('div'), lineText = document.createElement('p'), lineAct = document.createElement('button'), heard = document.createElement('p')
  line.id = 'ai-line'; line.hidden = true
  lineAct.type = 'button'
  heard.className = 'ai-hide'; heard.setAttribute('role', 'status')
  const dot = document.createElement('span')
  dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true')
  line.append(dot, lineText, lineAct)
  // Above the bar, in its column, as its question is: it rises with the bar over a phone's keyboard.
  ;(document.querySelector('#ask') ?? document.body).prepend(line)
  document.body.append(heard)
  let lineTimer: ReturnType<typeof setTimeout> | undefined
  /** Shows a line, with a key that does something, for a while (or until changed). `tell` is said to a screen reader. */
  const say = (parts: (string | [string, string])[], act?: { label: string; run: () => void }, ms = 0, tell = true, tone: 'busy' | 'good' | 'bad' = 'bad') => {
    clearTimeout(lineTimer)
    line.dataset.tone = tone
    line.title = ''
    lineText.replaceChildren(...parts.map((p) => { if (typeof p === 'string') return document.createTextNode(p); const s = document.createElement('span'); s.className = p[0]; s.textContent = p[1]; return s }))
    lineAct.hidden = !act
    if (act) { lineAct.textContent = act.label; lineAct.onclick = act.run }
    line.hidden = false
    if (tell) heard.textContent = lineText.textContent ?? ''
    if (ms) lineTimer = setTimeout(() => { line.hidden = true }, ms)
  }
  const quiet = () => { clearTimeout(lineTimer); line.hidden = true }

  // ── The wish being made, and what it cost ──
  const spent = new Map<Ask, { in: number; out: number; route: Route; model: string }>()
  /** What was said of a wish's last ask that went wrong (the maker asks up to three times): said again as it ends, with what it cost. */
  const failed = new Map<Ask, string>()
  let stopping: AbortController | null = null
  o.wish.on((stage: Stage, ask: Ask) => {
    if (stage.stage !== 'done') return
    const cost = spent.get(ask)
    // Made, and something is in the way: the bar asks where it goes (making.ts), and what it cost waits for how it ends.
    if (stage.state === 'held') { if (cost) quiet(); return }
    spent.delete(ask)
    const failure = failed.get(ask)
    failed.delete(ask)
    // (Not answered at all: `answer` has said why, with what to do next.)
    if (!cost) return
    const all = cost.in + cost.out, by = ABOUT[cost.route].name, counted = all ? ` · ${by} counted ${count(all)} tokens for the answer` : ''
    // An earlier answer stood though a later ask was stopped or went wrong (the maker builds the best it had): said so.
    if (stage.state === 'there' && failure) say([failure === 'stopped' ? 'Stopped, but what an earlier answer made stands' : 'What an earlier answer made stands', ['quiet', counted ? `${counted}. Type “undo” to take it out.` : ' · Type “undo” to take it out.']], undefined, 12000)
    else if (stage.state === 'there') { say(['Made with ', named(cost.model), ['quiet', all ? ` · ${count(all)} tokens from your ${by} account` : ` · ${by} gave no count`]], undefined, 9000, true, 'good'); line.title = all ? `${count(cost.in)} read, ${count(cost.out)} written, as ${by} counts them` : '' }
    else if (stage.why === 'let go' && failure && failure !== 'stopped') say([failure, ['quiet', counted]], undefined, 12000)
    else if (stage.why === 'let go' && failure) say(['Stopped. Nothing was made.', ['quiet', counted]], undefined, 8000)
    else if (stage.why === 'let go') quiet()
    else say([stage.state === 'refused' ? 'It could not be built from that answer' : 'It did not stand', ['quiet', counted]], undefined, 9000)
  })
  const what = (ask: Ask | null) => (ask?.wish ? ask.wish : ask?.picture ? 'what your picture shows' : 'that')

  /** One answer from what is connected, the wait shown as it streams; a reason that is not the visitor's to fix is said and the wish let go. */
  const answer = async (c: Connected, q: Question, ask: Ask | null, tell?: (stage: Stage) => void): Promise<{ text: string }> => {
    const stop = (stopping = new AbortController()), model = named(c.model), wished = what(ask)
    const writing = (letters: number, name?: string) => say([`${model} is making `, name ?? wished, ['n', letters ? ` · ${count(letters)} letters` : '']], { label: 'Stop', run: () => stop.abort() }, 0, false, 'busy')
    say([`${model} is making `, wished], { label: 'Stop', run: () => stop.abort() }, 0, true, 'busy')
    let shownName: string | undefined
    try {
      const r = await reply(c, q, {
        signal: stop.signal,
        each: (sofar) => { shownName ??= /"name"\s*:\s*"([^"\\]{1,48})"/.exec(sofar)?.[1]; writing(sofar.length, shownName) },
      })
      if (ask) { const was = spent.get(ask) ?? { in: 0, out: 0, route: c.route, model: r.model }; spent.set(ask, { in: was.in + r.tokens.in, out: was.out + r.tokens.out, route: c.route, model: c.model }) }
      say([`${model} answered. Building `, shownName ?? wished], undefined, 0, false, 'busy')
      return { text: r.text }
    } catch (e) {
      if (stop.signal.aborted) { if (ask) failed.set(ask, 'stopped'); say(['Stopped. Nothing was made.'], undefined, 5000); throw new Error('let go') }
      if (!(e instanceof Unanswered)) { console.info('not answered'); say(['Something went wrong while asking. Nothing was made.'], undefined, 8000); throw new Error('let go') }
      const by = ABOUT[c.route].name
      if (e.why === 'key') {
        // Back to the panel, the reason in it; once connected again the same wish goes on.
        say([`${by} did not take your key.`], { label: 'Connect again', run: () => open() }, 0)
        tell?.({ stage: 'connect' })
        const again = await open({ wish: ask, reason: `${by} did not take that key. Check it, or make a new one.` })
        if (again && held) { tell?.({ stage: 'asking', try: 1 }); return answer(held, q, ask, tell) }
        if (ask) failed.set(ask, `${by} did not take your key. Nothing was made.`)
        say([`${by} did not take your key. Nothing was made.`], { label: 'Your AI', run: () => open() }, 9000)
        throw new Error('let go')
      }
      const plain: Record<Exclude<typeof e.why, 'key'>, string> = {
        limit: `${by} says your key is at its limit or out of credit. Try again later, or connect another key.`,
        declined: `${model} would not make that one. Try other words.`,
        busy: `${by} is busy just now. Try again in a minute.`,
        asked: `${by} turned the request down${/: (.+)/.exec(scrub(e.message))?.[1] ? `: ${/: (.+)/.exec(scrub(e.message))![1]}` : ''}. Another model may take it.`,
        line: /part way/.test(e.message) ? `${by}'s answer was cut off part way. Nothing was made: try again.` : /answered with nothing/.test(e.message) ? `${model} answered with nothing. Try again.` : `${by} could not be reached. Check the connection and try again.`,
      }
      if (ask) failed.set(ask, plain[e.why])
      say([plain[e.why]], e.why === 'limit' || e.why === 'asked' ? { label: 'Your AI', run: () => open() } : undefined, 12000)
      throw new Error('let go')
    } finally { if (stopping === stop) stopping = null }
  }

  // ── The panel ──
  let dialog: HTMLDialogElement | null = null, field: HTMLInputElement | null = null
  /** Where the panel is: choosing a provider and giving a key, or showing what is connected. */
  let route: Route = held?.route ?? 'anthropic'
  let listed: { route: Route; key: string; list: Listed[] } | null = null, trying: AbortController | null = null
  let waiting: { wish: Ask | null; done: (connected: boolean) => void } | null = null
  let leave: (() => void) | null = null
  /** The kit, once it has come: what it drew while a part was hidden is drawn again as the part is shown. */
  let kit: Kit | null = null
  const $ = <T extends Element>(s: string) => dialog!.querySelector<T>(s)!

  const build = () => {
    const d = document.createElement('dialog')
    d.id = 'connect'; d.className = 'vx-dialog'
    d.setAttribute('aria-labelledby', 'connect-h')
    d.innerHTML = /* html */ `
      <header id="connect-h">Connect your own AI</header>
      <div class="vx-dialog-body">
        <p class="wish" hidden></p>
        <section class="giving">
          <div class="vx-toggle-group routes" role="radiogroup" aria-label="Whose AI">
            ${ROUTES.map((r) => `<label><input type="radio" name="connect-route" value="${r}">${ABOUT[r].name}</label>`).join('')}
          </div>
        </section>
        <div class="vx-field giving">
          <div class="named"><label class="vx-field-label" for="connect-key"></label><a class="get" target="_blank" rel="noopener noreferrer"></a></div>
          <div class="key">
            <span class="vx-well"><input id="connect-key" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="go" data-1p-ignore data-lpignore="true" data-bwignore aria-describedby="connect-said connect-truth"></span>
            <button class="vx-button reveal" type="button" aria-pressed="false" aria-controls="connect-key"><span>Show</span></button>
          </div>
        </div>
        <label class="vx-check giving remember"><input type="checkbox" id="connect-remember"><span class="vx-box"></span>Remember key in this browser</label>
        <dl class="on" hidden>
          <dt>Connected</dt><dd><span class="lamp" aria-hidden="true"></span><span class="who"></span></dd>
          <dt>Key</dt><dd class="ends"></dd>
          <dt>Kept</dt><dd class="where"></dd>
        </dl>
        <label class="vx-field models" hidden>
          <span class="vx-field-label">Which model makes things</span>
          <span class="pick"><select aria-describedby="connect-truth"></select></span>
        </label>
        <p class="said" id="connect-said" role="status"></p>
        <p class="truth" id="connect-truth"></p>
        <details>
          <summary>How this works</summary>
          <p class="how"></p>
        </details>
      </div>
      <footer>
        <button class="vx-button forget gap" type="button" data-vx-kind="danger" hidden><span>Forget this key</span></button>
        <button class="vx-button later" type="button"><span>Not now</span></button>
        <button class="vx-button go" type="button" data-vx-kind="main"><span>Connect</span></button>
      </footer>`
    document.body.append(d)
    dialog = d
    field = $<HTMLInputElement>('#connect-key')
    for (const r of d.querySelectorAll<HTMLInputElement>('input[name=connect-route]')) r.addEventListener('change', () => { if (!r.checked) return; route = r.value as Route; field!.value = ''; listed = null; trying?.abort(); said(''); draw() })
    const reveal = $<HTMLButtonElement>('.reveal')
    reveal.addEventListener('click', () => { const show = field!.type === 'password'; field!.type = show ? 'text' : 'password'; reveal.setAttribute('aria-pressed', String(show)); legend(reveal, show ? 'Hide' : 'Show'); field!.focus() })
    // A key pasted is tried at once (it costs nothing); one typed, when Enter is pressed: half a key is never tried.
    // Enter again, its models shown, connects.
    field.addEventListener('input', (e) => { listed = null; said(''); draw(); if ((e as InputEvent).inputType === 'insertFromPaste') void tryKey() })
    field.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault(); if (listed?.route === route && listed.key === field!.value.trim()) void go(); else void tryKey() })
    $<HTMLSelectElement>('select').addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value
      // Connected already: the choice is kept at once.
      if (held && !field!.value) { held = { ...held, model: id }; if (!keep(held, remembered())) { /* this page only */ } draw() }
    })
    $<HTMLButtonElement>('.go').addEventListener('click', () => void go())
    $<HTMLButtonElement>('.later').addEventListener('click', () => d.close())
    $<HTMLButtonElement>('.forget').addEventListener('click', () => {
      keep(null); held = null; listed = null; field!.value = ''
      said('Forgotten: this browser no longer holds your key.')
      draw()
      $<HTMLInputElement>(`input[name=connect-route][value=${route}]`).focus()
    })
    d.addEventListener('close', () => {
      trying?.abort()
      field!.value = ''; field!.type = 'password'; reveal.setAttribute('aria-pressed', 'false'); legend(reveal, 'Show')
      $<HTMLInputElement>('#connect-remember').checked = false
      leave?.(); leave = null
      const w = waiting; waiting = null
      w?.done(!!held)
    })
    // A phone's keyboard covers the bottom of the page: the panel is kept in what is seen above it.
    const fit = () => d.style.setProperty('--seen', `${Math.round(visualViewport?.height ?? innerHeight)}px`)
    visualViewport?.addEventListener('resize', fit); fit()
    field.addEventListener('focus', () => setTimeout(() => field!.scrollIntoView({ block: 'nearest' }), 300))
    // The kit's voxels, as the realm's controls have them (realm-ui.ts): the same module, already fetched.
    if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(new URL('../kit/src/index.js', import.meta.url).href).then((k: Kit) => { kit = k; k.adopt(d) }).catch(() => {})
  }

  /** A key's words, changed in its own span: the kit draws the key in a canvas inside it, which the key's text would take away. */
  const legend = (key: HTMLElement, words: string) => { const span = key.querySelector('span'); if (span && span.textContent !== words) { span.textContent = words; kit?.refresh?.(key) } }
  const said = (text: string, bad = false) => { const s = $<HTMLElement>('.said'); s.textContent = text; if (bad) s.dataset.tone = 'bad'; else delete s.dataset.tone }

  /** Lays the panel out for where it is. */
  const draw = () => {
    const connected = !!held && !field!.value, about = ABOUT[connected ? held!.route : route]
    $<HTMLElement>('#connect-h').textContent = connected ? 'Your own AI' : 'Connect your own AI'
    for (const el of dialog!.querySelectorAll<HTMLElement>('.giving')) el.hidden = connected
    $<HTMLElement>('.on').hidden = !connected
    for (const r of dialog!.querySelectorAll<HTMLInputElement>('input[name=connect-route]')) r.checked = r.value === route
    $<HTMLElement>('label[for=connect-key]').textContent = `Your ${about.name} key`
    const get = $<HTMLAnchorElement>('.get')
    get.href = about.keys; get.textContent = 'Get a key \u2197'; get.setAttribute('aria-label', `Get a key from ${about.name} (opens a new tab)`)
    if (connected) {
      $<HTMLElement>('.who').textContent = `${about.name} · ${named(held!.model)}`
      $<HTMLElement>('.ends').textContent = `Ending in ${held!.key.slice(-4)}`
      $<HTMLElement>('.where').textContent = remembered() ? 'In this browser, until you forget it' : 'In this tab, until it closes'
    }
    // The models: what the key being given can use, or what the connected one can.
    const list = listed && (connected ? listed.route === held!.route && listed.key === held!.key : listed.route === route && listed.key === field!.value.trim()) ? listed.list : null
    const choose = $<HTMLSelectElement>('select'), box = $<HTMLElement>('.models')
    box.hidden = !list?.length
    if (list?.length) {
      const pick = (connected ? preferred(held!.route, list, held!.model) : preferred(route, list, held?.route === route ? held.model : undefined)) ?? list[0]
      const ids = list.map((m) => m.id).join('\n')
      if (choose.dataset.ids !== ids) { choose.replaceChildren(...list.map((m) => new Option(m.name === m.id ? m.id : `${m.name}`, m.id))); choose.dataset.ids = ids; choose.value = pick.id }
      else if (!choose.value || (connected && choose.value !== held!.model)) choose.value = pick.id
    }
    const keeps = storable()
    // (A window that keeps nothing past the tab cannot remember: the box is not offered.)
    $<HTMLElement>('.remember').hidden = connected || !keeps
    $<HTMLElement>('.truth').replaceChildren(
      ...(connected ? [] : [document.createTextNode('Your key stays in this tab and goes only to '), Object.assign(document.createElement('b'), { textContent: about.name }), document.createTextNode('. ')]),
      document.createTextNode(`Each new thing is paid from your own ${about.name} account; kept things cost nothing.`),
      ...(keeps ? [] : [document.createTextNode(' This window keeps nothing: the key lasts until the page closes.')]),
    )
    $<HTMLElement>('.how').textContent = `When you ask for something nothing kept is called, this page sends your words and a brief on how to build to ${hostOf(connected ? held!.route : route)} with your key, straight from this browser: no server of this site sees either. ${keeps ? 'The key is held for this tab and forgotten when it closes, unless you tick “Remember key in this browser”: then it is kept in this browser’s storage for this site until you forget it here.' : 'This window keeps nothing, so the key is held only while the page is open.'} Checking a key only asks which models it can use, which costs nothing.`
    $<HTMLElement>('.forget').hidden = !connected
    // Connected, from the settings: Done alone closes it; a second key that does the same would be one too many.
    legend($<HTMLElement>('.later'), 'Not now')
    $<HTMLElement>('.later').hidden = connected && !waiting
    const go = $<HTMLButtonElement>('.go')
    legend(go, connected ? (waiting ? 'Make it' : 'Done') : waiting ? 'Connect and make it' : 'Connect')
    go.setAttribute('aria-busy', String(!!trying))
    if (connected && !list && !trying) void list_(held!.route, held!.key)
    // Parts that were hidden when the kit drew them (the model's well, the keys of the other view) are drawn as they are now.
    const shown = [...dialog!.querySelectorAll<HTMLElement>('.vx-well, .vx-button, .vx-toggle-group, .vx-check')].filter((el) => !el.closest('[hidden]')).map((el) => `${el.className}:${el.offsetWidth}x${el.offsetHeight}`).join()
    if (kit && shown !== drawn) { drawn = shown; requestAnimationFrame(() => { kit?.adopt(dialog!); for (const el of dialog!.querySelectorAll('.vx-well, .vx-button, .vx-toggle-group, .vx-check')) kit?.refresh?.(el) }) }
  }
  let drawn = ''
  const hostOf = (r: Route) => ({ anthropic: 'api.anthropic.com', openai: 'api.openai.com', gemini: 'generativelanguage.googleapis.com', openrouter: 'openrouter.ai' })[r]

  /** Asks which models a key can use: how a key is tried, at no cost. */
  const list_ = async (r: Route, key: string): Promise<boolean> => {
    trying?.abort()
    const t = (trying = new AbortController())
    try {
      const list = await models(r, key, { signal: t.signal })
      if (t.signal.aborted) return false
      for (const m of list) names.set(m.id, m.name)
      if (!list.length) { said(`${ABOUT[r].name} took the key, and lists no model it can use to make things.`, true); return false }
      listed = { route: r, key, list }
      return true
    } catch (e) {
      if (t.signal.aborted) return false
      said(e instanceof Unanswered ? (e.why === 'key' ? `${ABOUT[r].name} did not take that key. Check it, or make a new one.` : scrub(e.message)) : 'The key could not be tried just now.', true)
      return false
    } finally { if (trying === t) { trying = null; if (dialog?.open) draw() } }
  }
  const tryKey = async () => {
    const key = field!.value.trim()
    if (!key) return false
    if (listed?.route === route && listed.key === key) return true
    said(`Trying the key with ${ABOUT[route].name}…`)
    const ok = await list_(route, key)
    if (ok && field!.value.trim() === key) { said(`${ABOUT[route].name} accepted the key.`); draw() }
    return ok
  }
  /** The panel's main key: connect what was given, or, connected, be done. */
  const go = async () => {
    if (held && !field!.value) { dialog!.close(); return }
    const key = field!.value.trim()
    if (!key) { said(`Paste your ${ABOUT[route].name} key first.`, true); field!.focus(); return }
    if (!(await tryKey())) { field!.focus(); return }
    const model = $<HTMLSelectElement>('select').value || preferred(route, listed!.list)!.id
    held = { route, key, model }
    const remember = $<HTMLInputElement>('#connect-remember').checked && storable()
    const kept = keep(held, remember)
    field!.value = ''
    said(`Connected: ${ABOUT[route].name}, ${named(model)}.${!kept ? ' Until this page closes.' : remember ? ' Remembered in this browser.' : ' For this tab: it is forgotten when the tab closes.'}`)
    if (waiting) { dialog!.close(); return }
    draw()
    $<HTMLButtonElement>('.go').focus()
  }

  /** Opens the panel; with a wish waiting, resolves once it is shut: whether something is connected then. */
  const open = (how: { wish?: Ask | null; reason?: string } = {}): Promise<boolean> => {
    if (!dialog) build()
    // A key the provider refused is not kept, whether or not the panel is up already.
    if (how.reason) { held = null; keep(null) }
    const already = dialog!.open
    // Up already (from the settings) with no wish of its own: a wish that needs it waits on it from now, until it is shut.
    if (already && !('wish' in how)) return Promise.resolve(!!held)
    const done = new Promise<boolean>((r) => { waiting = 'wish' in how ? { wish: how.wish ?? null, done: r } : null; if (!waiting) r(!!held) })
    route = held?.route ?? route
    field!.value = ''; listed = null
    const w = $<HTMLElement>('.wish')
    w.hidden = !waiting
    if (waiting) { const q = document.createElement('q'); q.textContent = what(waiting.wish); w.replaceChildren(q, document.createTextNode(' is something new. Connect your own AI and it is made just as you asked.')) }
    said(how.reason ?? '', !!how.reason)
    draw()
    if (already) return done
    leave = o.input.push({ name: 'connect', solid: true, text: true })
    dialog!.showModal()
    // The first thing to do has the focus: the key, or the main key when connected. A task later: the panel may have been
    // opened by a key going down (1, for the bar's first answer), and that key's letter must not land in the field.
    setTimeout(() => { if (dialog!.open) (held ? $<HTMLButtonElement>('.go') : field!).focus() })
    return done
  }

  const ready = async (ask: Ask | null) => {
    if (held) return true
    // Nothing connected: the bar asks, and the wish waits in its turn while the visitor connects.
    const pick = await o.hud.choose(`“${what(ask).slice(0, 60)}” is something new. Your own AI can make it.`, ['Connect your AI', 'Not now'])
    if (pick !== 0 || !(await open({ wish: ask })) || !held) { quiet(); return false }
    return true
  }

  return {
    ready,
    async ask(q, tell) {
      const ask = o.asking()
      if (held) return answer(held, q, ask, tell)
      tell?.({ stage: 'connect' })
      if (!(await ready(ask)) || !held) throw new Error('let go')
      tell?.({ stage: 'asking', try: 1 })
      return answer(held, q, ask, tell)
    },
    open: () => void open(),
  }
}
