// The city's windows as lockers (#450, eggs.ts): in the first view some of the windows hold an egg, as the coin
// lockers of a station hold what was left in them. Which windows, and what each holds, is sf/lockers.json (placed by
// sf/lockers.mjs where the landing's eye sees them, on a desk and on a phone held either way); the far model lights
// them (lockers.ts says how each looks), and this file says which is which, answers the pointer and keeps what this
// visitor has opened.
//
//   new      flickers like a television left on: something is in it, not yet seen. Its words: “???”.
//   seen     a steady green lamp: opened before. Its words: what is in it. A click plays it again.
//   locked   a dim red safelight: kept until its thing is found in the city (eggs-things.ts, `find`), then new.
//
// The pointer over one lights it up and says so beside it; a click or a tap opens it (eggs.ts plays what is in it). A
// key in the first view's corner, by the credits, counts what has been opened of how many there are, and opens the
// lockers as a grid: one square a locker, lit as its window is, which shows where its window is or plays it.
//
// What has been opened and found is kept in this browser (localStorage), and a browser that keeps nothing starts
// afresh each time. Fetched with eggs.ts, once the park is shown.
import type { View } from './march.ts'
import { LOCKED, NEW, SEEN, header, table, type Key, type State } from './lockers.ts'

/** A locker as sf/lockers.json has it: its egg, its window, where its glass is (cells); for one kept until it is found, what finds it in the city and a word of where. */
export interface Locker { egg: string; key: Key; at: readonly [number, number, number]; find?: string; hint?: string }

export interface LockersNeeds {
  canvas: HTMLCanvasElement
  view(): View
  /** Whether the first view is up as it opened: nobody on the way in, the eye where it arrived. */
  still(): boolean
  /** The far model's table (far.ts `lockers`, `lockerHeader`). */
  far: { lockers(words: Uint32Array<ArrayBuffer>): void; lockerHeader(words: Uint32Array<ArrayBuffer>): void }
  /** Where the lockers' key, card and words go: the first view's own layer. */
  layer: HTMLElement
  /** The corner the key stands in, beside the credits key (first.ts `corner`). */
  corner: HTMLElement | null
  /** What an egg is called, once it has been seen. */
  title(egg: string): string
  /** Starts an egg (eggs.ts `act`). */
  open(egg: string): void
  /** Where the page's folder is: sf/lockers.json is eggs/lockers.json there. */
  base: string
}

/** Where what this visitor has opened and found is kept. */
const KEPT = 'village.sf.lockers'
/** How near the pointer must be to a window's glass to be over it (px): at least this, more where the window is bigger. */
const NEAR = { fine: 9, coarse: 22 }
/** How long the words stay after a tap (ms), and after a locker shown from the grid. */
const TAP_WORDS = 2600, SHOWN_WORDS = 4200

const STYLE = /* css */ `
#egg-tip { position: fixed; left: 0; top: 0; z-index: 7; pointer-events: none; --vx: 3px; display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center;
  max-inline-size: min(260px, calc(100vw - 24px)); padding: 6px 10px 7px 8px; opacity: 0; translate: var(--x) calc(var(--y) + 4px); transition: opacity 0.14s ease-out, translate 0.18s cubic-bezier(0.23, 1, 0.32, 1); }
#egg-tip.up { opacity: 1; translate: var(--x) var(--y); }
#egg-tip b { font: 600 0.9375rem/1.25 var(--vx-font, system-ui); grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#egg-tip span { font: 400 0.8125rem/1.3 var(--vx-font, system-ui); color: var(--vx-ink-quiet); grid-column: 2; }
#egg-tip i, #egg-windows i, .egg-count i { grid-row: 1 / span 2; inline-size: 12px; block-size: 16px; border-radius: 1px; box-shadow: inset 0 0 0 2px rgb(0 0 0 / 0.55); }
/* The window's own light, as the city draws it (lockers.ts): a television's flicker, a green lamp, a red safelight. */
:is(#egg-tip, #egg-windows, .egg-count) i[data-state="new"] { background: #7fa6ff; animation: egg-tv 2.4s steps(1, end) infinite; }
:is(#egg-tip, #egg-windows, .egg-count) i[data-state="seen"] { background: #4fdc6e; }
:is(#egg-tip, #egg-windows, .egg-count) i[data-state="locked"] { background: #b7261c; }
@keyframes egg-tv { 0% { background: #7fa6ff; } 18% { background: #c4d4ff; } 31% { background: #5b7cf0; } 47% { background: #9a86ff; } 58% { background: #b5c8ff; } 74% { background: #f08ad6; } 82% { background: #8fb0ff; } }
#egg-tip[data-state="new"] b { letter-spacing: 0.12em; }

/* The key: a lit window and how many have been opened, beside the credits key. */
.egg-count { --vx: 3px; --vx-key-size: var(--vx-key-small); opacity: 0.86; gap: 7px; font-variant-numeric: tabular-nums; }
.egg-count:is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
.egg-count i { inline-size: 9px; block-size: 12px; flex: none; }
.egg-count .of { opacity: 0.6; font-weight: 400; }
.egg-count.more { animation: egg-more 0.5s cubic-bezier(0.23, 1, 0.32, 1); }
@keyframes egg-more { 30% { scale: 1.12; } }

/* The lockers as a grid: one square a locker, its window's light, its name once seen. */
#egg-windows { inline-size: min(calc(var(--vx) * 100), calc(100vw - 24px)); max-block-size: min(72vh, 560px); overflow: auto; }
#egg-windows .legend { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 0.8125rem; line-height: 1.35; color: var(--vx-ink-quiet); }
#egg-windows .legend li { display: grid; grid-template-columns: 12px 1fr; column-gap: 8px; align-items: center; }
#egg-windows .legend i { block-size: 14px; grid-row: auto; }
.egg-windows { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 6px; padding: 8px; border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 8px), color-mix(in oklab, var(--vx-slate, #9f998a) 55%, #5b5246); }
.egg-windows button { position: relative; display: grid; place-items: center; aspect-ratio: 3 / 4; padding: 0; border: 0; border-radius: 1px; cursor: pointer;
  background: #1d2129; box-shadow: inset 0 0 0 2px #2c2a27, 0 1px 0 rgb(255 255 255 / 0.18); font: 700 0.875rem/1 var(--vx-mono, ui-monospace, monospace); color: #10162e; }
/* (Under the card's id, as the swatches' size is: the window's light fills its square.) */
#egg-windows .egg-windows button i { position: absolute; inset: 4px; inline-size: auto; block-size: auto; border-radius: 0; box-shadow: none; }
#egg-windows .egg-windows button i[data-state="seen"] { box-shadow: 0 0 10px #6be38a99; }
#egg-windows .egg-windows button i[data-state="new"] { box-shadow: 0 0 10px #9cc2ffaa; }
.egg-windows button span { position: relative; text-shadow: 0 1px 0 rgb(255 255 255 / 0.4); }
.egg-windows button:focus-visible { outline: 2px solid var(--vx-focus, #174ec6); outline-offset: 2px; }
.egg-windows button:active { scale: 0.96; }
@media (hover: hover) { .egg-windows button:hover i { filter: brightness(1.25); } }
@media (prefers-reduced-motion: reduce) {
  :is(#egg-tip, #egg-windows, .egg-count) i[data-state="new"] { animation: none; background: #9db8ff; }
  #egg-tip { transition: opacity 0.14s ease-out; translate: var(--x) var(--y); }
  .egg-count.more { animation: none; }
}
`

export function lockers(o: LockersNeeds) {
  const touch = matchMedia('(pointer: coarse)')
  let list: Locker[] = []
  const state: State[] = []
  // ── What this visitor has opened, and the lockers found in the city ──
  const kept = (() => { try { const k = JSON.parse(localStorage.getItem(KEPT) ?? '{}'); return { seen: new Set<string>(k.seen ?? []), found: new Set<string>(k.found ?? []) } } catch { return { seen: new Set<string>(), found: new Set<string>() } } })()
  const keep = () => { try { localStorage.setItem(KEPT, JSON.stringify({ seen: [...kept.seen], found: [...kept.found] })) } catch { /* a browser that keeps nothing: afresh next time */ } }
  const stateOf = (l: Locker): State => (l.find && !kept.found.has(l.find) ? LOCKED : kept.seen.has(l.egg) ? SEEN : NEW)
  const NAMES: Record<State, string> = { [NEW]: 'new', [SEEN]: 'seen', [LOCKED]: 'locked' }
  const opened = () => list.filter((l, i) => state[i] === SEEN).length

  // ── The far model's table: laid again whenever a locker's state changes ──
  const lay = () => {
    list.forEach((l, i) => { state[i] = stateOf(l) })
    const { words, left } = table(list.map((l, i) => ({ key: l.key, state: state[i], slot: i })))
    for (const i of left) console.warn(`lockers: no room for ${list[i].egg}'s window`)
    o.far.lockers(words)
    // (The table's header was written over with it: written again at once, or the lockers blinked out for a frame.)
    lastHead = ''
    head()
    tally()
  }

  // ── Where each is on the page ──
  const rect = () => o.canvas.getBoundingClientRect()
  /** A locker's glass on the page (client px) and how tall its storey is there, or null behind the eye. */
  const onPage = (i: number) => {
    const p = list[i].at, v = o.view(), r = rect(), d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]
    if (far <= 1) return null
    const x = (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (r.width / r.height) * far), y = (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)
    // (A storey is about 3.1 m, 31 cells: how tall it is on the page.)
    return { x: r.left + ((x + 1) / 2) * r.width, y: r.top + ((1 - y) / 2) * r.height, tall: ((31 / far / v.tanHalf) * r.height) / 2 }
  }
  /** The locker whose window is under a point of the page, the nearest within reach; null for none. */
  const at = (x: number, y: number): number | null => {
    if (!o.still() || !shownTo) return null
    const least = touch.matches ? NEAR.coarse : NEAR.fine
    let best: number | null = null, nearest = Infinity
    for (let i = 0; i < list.length; i++) {
      const p = onPage(i)
      if (!p) continue
      const d = Math.hypot(x - p.x, y - p.y)
      if (d <= Math.max(least, p.tall * 0.55) && d < nearest) { nearest = d; best = i }
    }
    return best
  }

  // ── The words beside a window ──
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const tip = document.createElement('div')
  tip.id = 'egg-tip'
  tip.className = 'vx-tooltip'
  tip.setAttribute('role', 'status')
  tip.innerHTML = '<i aria-hidden="true"></i><b></b><span></span>'
  o.layer.append(tip)
  const [tipLight, tipTitle, tipLine] = [tip.querySelector('i')!, tip.querySelector('b')!, tip.querySelector('span')!]
  const verb = () => (touch.matches ? 'Tap' : 'Click')
  /** What the words say of a locker: its title and its line. */
  const wordsOf = (i: number, reveal: string | null): [string, string] => {
    const l = list[i], s = state[i]
    if (reveal !== null) return [o.title(l.egg), reveal]
    if (s === LOCKED) return ['Locked', l.hint ? `Find it in the city: ${l.hint}` : 'Find it somewhere in the city, then come back to watch it.']
    if (s === SEEN) return [o.title(l.egg), `${verb()} to play it again.`]
    return ['???', `What’s on in there? ${verb()} to find out.`]
  }
  /** The words over the window (under it where there is no room over it), kept inside the page. */
  const place = (i: number) => {
    const p = onPage(i)
    if (!p) return
    const w = tip.offsetWidth, h = tip.offsetHeight, gap = Math.max(10, p.tall * 0.6)
    const x = Math.min(innerWidth - w - 12, Math.max(12, p.x - w / 2))
    const y = p.y - gap - h < 12 ? p.y + gap : p.y - gap - h
    tip.style.setProperty('--x', `${Math.round(x)}px`)
    tip.style.setProperty('--y', `${Math.round(y)}px`)
  }

  // ── The pointer over a window, and a window opened ──
  /** The locker under the pointer, lit up and its words beside it. */
  let hot: number | null = null
  /** A locker held lit with its words for a while: one opened or tapped, or shown from the grid; and what its words say then. */
  let held: { i: number; until: number; reveal: string | null } | null = null
  /** The one just opened, and how bright its flash is still (0 to 1). */
  let flashing: number | null = null, flash = 0
  /** What the words are about now (null: none shown), and what they said. */
  let said: number | null = null, saidText = ''
  const hold = (i: number, ms: number, reveal: string | null = null) => { held = { i, until: performance.now() + ms, reveal } }
  const hover = (i: number | null) => {
    hot = i
    // (Another window under the pointer takes the words from one held.)
    if (i !== null && held && held.i !== i) held = null
  }
  /** The words of the locker held, else the one under the pointer; said again only as they change, and moved with it. */
  const words = () => {
    const i = held?.i ?? hot
    if (i === null || !shownTo) { if (said !== null) { said = null; tip.classList.remove('up') } return }
    const s = NAMES[state[i]], [title, line] = wordsOf(i, held?.i === i ? held.reveal : null), text = `${s}|${title}|${line}`
    if (said !== i || saidText !== text) {
      said = i
      saidText = text
      tipLight.dataset.state = s
      tip.dataset.state = s
      tipTitle.textContent = title
      tipLine.textContent = line
      tip.classList.add('up')
    }
    place(i)
  }
  const open = (i: number) => {
    const l = list[i]
    if (state[i] === LOCKED) return hold(i, TAP_WORDS)
    flashing = i
    flash = 1
    if (state[i] === NEW) {
      kept.seen.add(l.egg)
      keep()
      lay()
      count.classList.remove('more')
      void count.offsetWidth
      count.classList.add('more')
      const n = opened()
      hold(i, TAP_WORDS + 800, n === list.length ? `Found! That was the last of all ${n}.` : `Found! ${n} of ${list.length} opened.`)
    } else if (touch.matches) hold(i, TAP_WORDS)
    o.open(l.egg)
  }
  /** A thing used in the city (eggs-things.ts): what it finds is unlocked, and new. */
  const found = (thing: string) => {
    if (kept.found.has(thing) || !list.some((l) => l.find === thing)) return 0
    kept.found.add(thing)
    keep()
    lay()
    return list.filter((l) => l.find === thing).length
  }

  // ── The key in the corner, and the lockers as a grid ──
  const count = document.createElement('button')
  count.type = 'button'
  count.className = 'vx-button egg-count'
  count.setAttribute('popovertarget', 'egg-windows')
  count.hidden = true
  count.innerHTML = '<i aria-hidden="true" data-state="new"></i><span><span class="n">0</span><span class="of">/0</span></span>'
  const card = document.createElement('div')
  card.id = 'egg-windows'
  card.className = 'vx-popover'
  card.popover = 'auto'
  card.setAttribute('aria-label', 'The windows that hold something')
  card.innerHTML = `<h3>Lit windows</h3><p class="told"></p>
    <ul class="legend"><li><i data-state="new"></i>Flickering: something new is on.</li><li><i data-state="seen"></i>Green: you have seen it. Open it again any time.</li><li><i data-state="locked"></i>Red: locked. Find it in the city, then come back.</li></ul>
    <div class="egg-windows" role="group" aria-label="Every window"></div>`
  const told = card.querySelector<HTMLElement>('.told')!, grid = card.querySelector<HTMLElement>('.egg-windows')!
  ;(o.corner ?? o.layer).append(count)
  o.layer.append(card)
  // (The kit's voxels for the key, as the credits key has them, unless the page asks for plain keys: first.ts.)
  type Kit = { adopt(root?: Element): void; refresh(el: Element): void }
  let kit: Kit | null = null
  if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(new URL('../kit/src/index.js', import.meta.url).href).then((k: Kit) => { kit = k; k.adopt(count) }).catch(() => {})
  const tally = () => {
    const n = opened(), all = list.length
    count.hidden = !all
    count.querySelector('.n')!.textContent = String(n)
    count.querySelector('.of')!.textContent = `/${all}`
    count.querySelector('i')!.dataset.state = n === all ? 'seen' : 'new'
    count.setAttribute('aria-label', `Lit windows: ${n} of ${all} opened`)
    count.title = `${n} of ${all} windows opened`
    told.textContent = n === all ? `Some of the city’s windows hold something. You have opened all ${all}.` : `Some of the city’s windows hold something: ${all} of them. You have opened ${n}.`
    kit?.refresh(count)
    grid.replaceChildren(...list.map((l, i) => {
      const b = document.createElement('button'), s = state[i]
      b.type = 'button'
      b.dataset.slot = String(i)
      b.innerHTML = `<i data-state="${NAMES[s]}"></i>${s === SEEN ? '' : `<span>${s === LOCKED ? '' : '?'}</span>`}`
      b.setAttribute('aria-label', s === SEEN ? `${o.title(l.egg)}: play` : s === LOCKED ? 'Locked: find it in the city' : 'Something new: show me its window')
      b.title = s === SEEN ? o.title(l.egg) : s === LOCKED ? 'Locked' : '???'
      return b
    }))
  }
  // From the grid: a window seen plays; a new or locked one is shown where it is, lit up with its words, to be opened there.
  grid.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-slot]')
    if (!b) return
    const i = Number(b.dataset.slot)
    card.hidePopover()
    // (Chosen again while its window is shown: opened, for whoever cannot point at it.)
    if (state[i] === SEEN || (state[i] === NEW && held?.i === i)) open(i)
    else hold(i, SHOWN_WORDS)
  })

  // ── Every frame: how far they are shown, the header, the words where the window is ──
  /** Whether they are to be shown (the first view up), how far they are, and how far a check holds them (null: as they are). */
  let shownTo = false, shown = 0, forced: number | null = null, lastHead = ''
  /** The table's header as it is now: the one lit up, how far they are shown, the flash; written when it changes. */
  const head = () => {
    const lit = flashing ?? held?.i ?? hot, now = `${lit}:${shown.toFixed(3)}:${flash.toFixed(3)}`
    if (now !== lastHead) { lastHead = now; o.far.lockerHeader(header(lit ?? -1, shown, flash)) }
  }
  const frame = (dt: number) => {
    shownTo = o.still() && list.length > 0
    shown = forced ?? (shownTo ? Math.min(1, shown + dt / 0.6) : Math.max(0, shown - dt / 0.3))
    flash = Math.max(0, flash - dt / 0.6)
    if (!flash) flashing = null
    if (held && performance.now() > held.until) held = null
    head()
    words()
    count.hidden = !list.length || !shownTo
  }

  const ready = fetch(new URL('eggs/lockers.json', o.base)).then((r) => { if (!r.ok) throw Error(`lockers.json: ${r.status}`); return r.json() as Promise<Locker[]> }).then((l) => { list = l; lay() }).catch((e) => console.warn('the lockers did not load:', e))

  return {
    ready,
    /** The locker under a point of the page, or null. */
    at,
    hover,
    open,
    found,
    frame,
    /** For the checks: each locker, its state and where it is on the page; which is lit up, and what the words say. */
    get state() {
      return {
        lockers: list.map((l, i) => ({ egg: l.egg, state: NAMES[state[i]], on: onPage(i) })),
        hot, lit: flashing ?? held?.i ?? hot, shown, opened: opened(), count: count.hidden ? null : count.textContent,
        words: said !== null ? `${tipTitle.textContent} · ${tipLine.textContent}` : null,
      }
    },
    /** For the checks: holds how far they are shown (0 to 1; null: as the first view has it). */
    force(v: number | null) { forced = v },
    /** The grid and the key said again: what the eggs are called has come (the memes' titles). */
    relabel() { if (list.length) tally() },
    /** For the checks: forget what this visitor opened and found. */
    forget() { kept.seen.clear(); kept.found.clear(); keep(); lay() },
  }
}
