// The one layer of DOM over the picture (#243, #244): the line of numbers in the corner, the tools, the ask
// bar, what was said, a cue beside a thing ("E to sit"), a card of controls, short notices. A lane adds a
// panel of its own (`panel`); nobody else puts elements over the canvas. How it all looks is in index.html.
//
// Everything shown here that someone typed (a name, a wish, what was said) is put as text, never as markup.
import type { Ask } from './ask.ts'
import type { Input } from './input.ts'
import { small } from './picture.ts'

/** Where a place in the world (the finest cells) is on the screen, in CSS pixels, or null if it is behind the eye. */
export type Project = (at: readonly [number, number, number]) => [number, number] | null

export interface Hud {
  /** The line of numbers in the corner. */
  status(text: string): void
  /** The tools along the bottom: a button each, numbered from 1. `picked` shows which is on. */
  tools(names: readonly string[], pick: (i: number) => void): { picked(i: number): void }
  /**
   * The ask bar: always there, one line to type on. Enter or a touch opens it, Enter sends, Escape puts it away.
   * Shift with Enter asks for the thing anew, even if one like it was made before and is kept.
   * What is typed is a wish (`onask`), with a picture or a link if one was given: pasted, dropped anywhere on the
   * page, picked from a phone's library or taken with its camera, or an address among the words. Where there are
   * others to speak to (`onsubmit`), Tab turns the bar to saying and back.
   */
  readonly line: {
    /** What the line shows while empty and saying. */
    placeholder: string
    /** What is done with words that were said. */
    onsubmit: ((text: string) => void) | null
    /** What is done with a wish: words, a picture, a link, or any of them together. */
    onask: ((ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>) => void) | null
    /**
     * Hears the words of a wish as they are typed (the ghost of what is kept, page/kept.ts): every change, with `sent`
     * false; the words when Enter sends them, with `sent` true; and '' when the bar is put away without.
     */
    ontyped: ((text: string, sent: boolean) => void) | null
    /**
     * Whether words set to be made would be said instead, as they stand (page/making.ts `says`): the bar then reads
     * "Say" while they are typed, so that it never says it will make what Enter says. Tab makes them a thing after all.
     */
    means: ((text: string) => Promise<boolean>) | null
    /**
     * Adds someone who may take a wish before it is made (the wand: words that call a known spell). True if it took
     * it; with `dry`, whether it would, doing nothing. While it would take what is typed the bar reads `label`.
     */
    take(taker: (ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>, dry?: boolean) => boolean, label?: string): void
    /** Wishes offered to start from while the line is empty. */
    starters: readonly string[]
    readonly open: boolean
    show(): void
    hide(): void
    /** Gives the bar a picture (a file) or a link, as if it were dropped there. */
    give(what: Blob | string): Promise<void>
  }
  /** A line added to what was said lately (the last five are shown). */
  heard(text: string): void
  /**
   * A question with a few answers, shown over the ask bar until one is picked: by its number key, a click or a touch.
   * Resolves to which (from 0), or -1 if it was put away with Escape. One question at a time: a second waits.
   */
  choose(text: string, options: readonly string[]): Promise<number>
  /** A short notice that goes by itself. */
  notice(text: string, ms?: number): void
  /** The card of controls (while mounted): a title and pairs of key and what it does. Null takes it away. */
  card(card: { title: string; note?: string; rows: readonly (readonly [string, string])[] } | null): void
  /** A cue beside a place in the world, kept there as the eye moves until it is removed. `at` is asked every frame. With `tap` it can be touched or clicked, and does that: on a phone there is no E. */
  cue(text: string, at: () => readonly [number, number, number] | null, tap?: () => void): { text: string; remove(): void }
  /** An empty element of a lane's own in the layer, by name (the same name gives the same element). Style it by `[data-panel="name"]`. */
  panel(name: string): HTMLElement
  /** Once a frame: puts the cues where their places are now. Costs nothing with no cue. */
  frame(project: Project): void
}

export function hud(input: Input): Hud {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string) => { const e = document.createElement(tag); e.id = id; return e }
  const layer = el('div', 'over'), status = document.querySelector<HTMLElement>('#hud')!, bar = document.querySelector<HTMLElement>('#tools')!
  let quiet: ReturnType<typeof setTimeout> | undefined
  const said = el('div', 'said'), notices = el('div', 'notices'), card = el('div', 'card'), cues = el('div', 'cues')
  const ask = el('div', 'ask'), starters = el('div', 'starters'), given = el('div', 'given'), row = el('div', 'ask-row'), line = el('input', 'line')
  const button = (id: string, label: string, text: string) => { const b = el('button', id); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label; return b }
  const which = button('ask-which', 'Make a thing, or say something: Tab changes it', 'Make'), library = button('ask-picture', 'Add a picture', '\u25a3'), camera = button('ask-camera', 'Take a picture', '\u25c9'), send = button('ask-send', 'Send', '\u2191')
  // Two ways to a picture on a phone: one asks for any (its sheet offers the library), one for the camera itself.
  const picked = document.createElement('input'), taken = document.createElement('input')
  for (const f of [picked, taken]) { f.type = 'file'; f.accept = 'image/*'; f.hidden = true }
  taken.setAttribute('capture', 'environment')
  camera.hidden = !matchMedia('(pointer: coarse)').matches
  // A realm is described at length: the line takes as much as a rule's ask reads.
  line.maxLength = 4000
  line.autocomplete = 'off'
  line.enterKeyHint = 'send'
  line.setAttribute('aria-label', 'What to make')
  row.append(which, line, library, camera, send)
  ask.append(starters, given, row, picked, taken)
  card.hidden = said.hidden = starters.hidden = true
  layer.append(cues, said, notices, card, ask)
  document.body.append(layer)

  // The ask bar. While it is open the page is in a text mode: keys are letters, not steps.
  let leave: (() => void) | null = null, wantsToSay = false
  /** The words typed would be said though the bar is set to make (`means`), and whether Tab has had them made all the same. */
  let heardAsSaid = false, makeAnyway = false, hearing = 0
  /** Whether what is typed is said, not made: only where there is someone to say it to, and always where nothing can be made. */
  const isSaying = () => (self.onask ? !!self.onsubmit && wantsToSay : true)
  let picture: { picture: NonNullable<Ask['picture']>; shown: string } | null = null, link = ''
  const ADDRESS = /https?:\/\/[^\s<>"']+/i
  const draw = () => {
    const saying = isSaying()
    const both = !!self.onask && !!self.onsubmit
    // What Enter will do with what is typed now: said if the bar is set to say; else taken by whoever would take
    // it first (the wand casts a spell it calls); else said if these words would be said; else made.
    const taker = saying ? undefined : takers.find((t) => t.take(asking(line.value).asked, true))
    const says = saying || (!taker && heardAsSaid && !makeAnyway)
    which.hidden = !both && !taker
    which.textContent = taker ? taker.label : says ? 'Say' : 'Make'
    which.title = !saying && says ? 'These words will be said to whoever is here: Tab makes them a thing' : 'Make a thing, or say something: Tab changes it'
    ask.dataset.which = says ? 'say' : 'make'
    line.placeholder = saying ? self.placeholder : leave ? 'A thing, a picture, a link' : 'Make something' + (camera.hidden ? '  (Enter)' : '')
    library.hidden = saying
    camera.hidden = saying || !matchMedia('(pointer: coarse)').matches
    ask.hidden = !self.onask && !self.onsubmit
    ask.classList.toggle('open', leave !== null)
    // What was given with the wish, each with a way to take it back.
    given.replaceChildren()
    if (!saying && picture) { const chip = document.createElement('span'), img = document.createElement('img'), x = button('', 'Take the picture away', '\u00d7'); img.src = picture.shown; img.alt = 'The picture given'; x.addEventListener('click', () => { drop(); draw(); void hear(); line.focus() }); chip.append(img, x); given.append(chip) }
    if (!saying && link) { const chip = document.createElement('span'), x = button('', 'Take the link away', '\u00d7'); chip.append(link.replace(/^https?:\/\//, '').slice(0, 40), x); x.addEventListener('click', () => { link = ''; draw(); void hear(); line.focus() }); given.append(chip) }
    given.hidden = !given.childElementCount
    // Somewhere to start from, while there is nothing yet.
    starters.hidden = !(leave && !saying && !line.value && !picture && !link && self.starters.length)
    if (!starters.hidden && !starters.childElementCount) starters.replaceChildren(...self.starters.map((wish) => { const b = button('', `Start from: ${wish}`, wish); b.addEventListener('click', () => { line.value = wish; draw(); line.focus() }); return b }))
  }
  const drop = () => { if (picture) URL.revokeObjectURL(picture.shown); picture = null }
  const takes = { say: null as ((text: string) => void) | null, ask: null as ((ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>) => void) | null }
  /** Who hears the words as they are typed, and what it was last told: told again only when they change. */
  let typed: ((text: string, sent: boolean) => void) | null = null, told = ''
  const tell = (text: string, sent = false) => { if (!typed || (text === told && !sent)) return; told = sent ? '' : text; typed(text, sent) }
  const self = {
    placeholder: '',
    get ontyped() { return typed },
    set ontyped(f: ((text: string, sent: boolean) => void) | null) { typed = f },
    // The bar is there as soon as anything takes what is typed: it is drawn again when either is given.
    get onsubmit() { return takes.say },
    set onsubmit(f: ((text: string) => void) | null) { takes.say = f; draw() },
    means: null as ((text: string) => Promise<boolean>) | null,
    get onask() { return takes.ask },
    set onask(f: ((ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>) => void) | null) { takes.ask = f; draw() },
    take(take: (ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>, dry?: boolean) => boolean, label = 'Make') { takers.push({ take, label }) },
    starters: [] as readonly string[],
    get open() { return leave !== null },
    show() {
      if (!self.onask && !self.onsubmit) return
      if (!leave) leave = input.push({ name: 'typing', solid: true, text: true })
      draw()
      if (document.activeElement !== line) line.focus()
    },
    hide() {
      if (!leave) return
      leave(); leave = null
      line.value = ''
      heardAsSaid = makeAnyway = false
      hearing++
      tell('')
      link = ''
      drop()
      draw()
      line.blur()
    },
    async give(what: Blob | string) {
      if (!self.onask) return
      wantsToSay = false
      if (typeof what === 'string') { const found = ADDRESS.exec(what)?.[0]; if (!found) return; link = found }
      else { try { const made = await small(what); drop(); picture = made } catch (e) { notice(e instanceof Error ? e.message : 'that is not a picture') ; return } }
      self.show()
      void hear()
    },
  }
  const takers: { take: (ask: Pick<Ask, 'wish' | 'picture' | 'link' | 'fresh'>, dry?: boolean) => boolean; label: string }[] = []
  /** What is typed, as it is asked for: an address among the words is a link, and the rest is the wish. */
  const asking = (text: string, fresh = false) => {
    const found = link || ADDRESS.exec(text)?.[0] || '', wish = (found ? text.replace(found, ' ') : text).replace(/\s+/g, ' ').trim()
    // Words that would be said, which Tab asked to have made: a thing all the same (page/making.ts reads `thing:`).
    const made = wish && heardAsSaid && makeAnyway ? `thing: ${wish}` : wish
    return { wish, found, asked: { ...(made ? { wish: made } : {}), ...(picture ? { picture: picture.picture } : {}), ...(found ? { link: found } : {}), ...(fresh ? { fresh } : {}) } }
  }
  /** `fresh` (Shift with Enter): make it anew, even if one like it was made before. */
  const submit = (fresh = false) => {
    const text = line.value.trim()
    if (isSaying()) { self.hide(); if (text) self.onsubmit?.(text); return }
    const { wish, found, asked } = asking(text, fresh)
    if (!wish && !picture && !found) { self.hide(); return }
    if (wish && !picture && !found && !fresh) tell(wish, true)
    self.hide()
    if (takers.some((taker) => taker.take(asked))) return
    self.onask?.(asked)
  }
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) submit(e.shiftKey)
    else if (e.key === 'Escape') self.hide()
    else if (e.key === 'Tab' && self.onask && self.onsubmit) { e.preventDefault(); turn(); draw(); void hear() }
  })
  /** Tab: from making to saying and back; words that would be said though set to make are made instead. */
  const turn = () => { if (!isSaying() && heardAsSaid && !makeAnyway) makeAnyway = true; else { wantsToSay = !isSaying(); makeAnyway = false } }
  /**
   * Asks what Enter would do with what is there now (`means`), the newest answer only: from the words Enter would
   * send (without an address among them), and never said with a picture or a link, which are made. Asked again
   * whenever that can change: a key, Tab, a picture or a link given or taken away.
   */
  const hear = async () => {
    const n = ++hearing, { wish, found } = asking(line.value)
    const said = !!self.means && !isSaying() && !picture && !found && !!wish && (await self.means(wish).catch(() => false))
    if (n !== hearing) return
    if (said !== heardAsSaid) { heardAsSaid = said; draw() }
  }
  line.addEventListener('input', () => { draw(); void hear(); if (!isSaying() && !picture && !link) tell(line.value) })
  line.addEventListener('focus', () => self.show())
  send.addEventListener('click', () => submit())
  which.addEventListener('click', () => { turn(); self.show(); void hear() })
  library.addEventListener('click', () => picked.click())
  camera.addEventListener('click', () => taken.click())
  for (const f of [picked, taken]) f.addEventListener('change', () => { const file = f.files?.[0]; f.value = ''; if (file) void self.give(file) })
  // A picture or an address pasted or dropped anywhere on the page is given to the bar.
  const taking = (data: DataTransfer | null): Blob | string | null => {
    const file = [...(data?.files ?? [])].find((f) => f.type.startsWith('image/'))
    if (file) return file
    const text = data?.getData('text/uri-list') || data?.getData('text/plain') || ''
    return ADDRESS.test(text) ? text : null
  }
  document.addEventListener('paste', (e) => {
    const what = taking(e.clipboardData)
    // Words pasted into the line are words, unless they are nothing but an address.
    if (what === null || !self.onask || (typeof what === 'string' && e.target === line && what.trim() !== ADDRESS.exec(what)?.[0])) return
    e.preventDefault()
    void self.give(what)
  })
  document.addEventListener('dragover', (e) => { if (self.onask) e.preventDefault() })
  document.addEventListener('drop', (e) => { if (!self.onask) return; e.preventDefault(); const what = taking(e.dataTransfer); if (what !== null) void self.give(what) })
  // A phone's keyboard covers the bottom of the page: the bar is kept over it.
  visualViewport?.addEventListener('resize', () => { ask.style.setProperty('--lift', `${Math.max(0, innerHeight - visualViewport!.height - visualViewport!.offsetTop)}px`) })
  input.always('Enter', (e) => {
    if (e.metaKey || e.ctrlKey || (!self.onask && !self.onsubmit)) return
    e.preventDefault()
    self.show()
    return true
  })
  const notice = (text: string, ms = 4000) => {
    const n = document.createElement('p')
    n.textContent = text
    // Under what a realm's rules show (page/hands.ts puts their cards where notices go): a notice over a card hid both (seen November 14).
    const cards = panels.get('shown')
    notices.style.top = cards && !cards.hidden && cards.offsetHeight ? `${cards.offsetTop + cards.offsetHeight + 6}px` : ''
    notices.append(n)
    setTimeout(() => n.remove(), ms)
  }
  queueMicrotask(draw)

  const lines: string[] = []
  const choice = el('div', 'choice')
  choice.hidden = true
  ask.prepend(choice)
  let choosing: Promise<unknown> = Promise.resolve()
  const choose = (text: string, options: readonly string[]) => {
    const mine = choosing.then(() => new Promise<number>((done) => {
      const said = document.createElement('p'), row = document.createElement('div')
      said.textContent = text
      const pick = (i: number) => { leave(); choice.hidden = true; choice.replaceChildren(); done(i) }
      // Its keys are its own while it is up; everything else still moves the player.
      const leave = input.push({ name: 'choosing', key: (code) => { const i = code === 'Escape' ? -1 : code.startsWith('Digit') ? Number(code.slice(5)) - 1 : -2; if (i < -1 || i >= options.length) return false; pick(i); return true } })
      options.forEach((label, i) => { const b = document.createElement('button'), n = document.createElement('i'); b.type = 'button'; n.textContent = String(i + 1); b.append(n, label); b.addEventListener('click', () => pick(i)); row.append(b) })
      choice.replaceChildren(said, row)
      choice.hidden = false
    }))
    choosing = mine
    return mine
  }
  const shown = new Set<{ text: string; at: () => readonly [number, number, number] | null; el: HTMLElement }>()
  const panels = new Map<string, HTMLElement>()
  return {
    status(text) { status.textContent = text },
    tools(names, pick) {
      bar.replaceChildren(...names.map((name, i) => {
        const b = document.createElement('button'), n = document.createElement('i')
        n.textContent = String(i + 1)
        b.append(n, name)
        b.addEventListener('click', () => pick(i))
        return b
      }))
      return { picked: (i) => bar.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i)) }
    },
    line: self,
    heard(text) {
      lines.push(text)
      if (lines.length > 5) lines.shift()
      said.textContent = lines.join('\n')
      said.hidden = false
      // What was said goes from the picture a quarter of a minute after the last of it (#367): it stayed for good,
      // five lines from minutes ago over the corner of the picture. The next thing said shows the last five again.
      clearTimeout(quiet)
      quiet = setTimeout(() => { said.hidden = true }, 15_000)
    },
    notice,
    choose,
    card(c) {
      card.hidden = !c
      if (!c) return
      const title = document.createElement('h2')
      title.textContent = c.title
      // One line under the title (a car's top speed and 0 to 100), when there is one.
      const note = document.createElement('p')
      note.className = 'note'
      note.textContent = c.note ?? ''
      card.replaceChildren(title, ...(c.note ? [note] : []), ...c.rows.map(([key, what]) => { const p = document.createElement('p'), k = document.createElement('kbd'); k.textContent = key; p.append(k, what); return p }))
    },
    cue(text, at, tap) {
      const e = document.createElement('p'), cue = { text, at, el: e }
      e.textContent = text
      if (tap) { e.style.pointerEvents = 'auto'; e.classList.add('tap'); e.addEventListener('click', tap) }
      e.hidden = true
      cues.append(e)
      shown.add(cue)
      return { get text() { return cue.text }, set text(t: string) { cue.text = t; e.textContent = t }, remove() { shown.delete(cue); e.remove() } }
    },
    panel(name) {
      let p = panels.get(name)
      if (!p) { p = document.createElement('div'); p.dataset.panel = name; panels.set(name, p); layer.append(p) }
      return p
    },
    frame(project) {
      for (const cue of shown) {
        const place = cue.at(), on = place && project(place)
        cue.el.hidden = !on
        // (Kept inside the screen: a thing near its edge has its cue whole, never cut off by it.)
        const half = on ? cue.el.offsetWidth / 2 + 8 : 0, x = on ? Math.max(half, Math.min(innerWidth - half, on[0])) : 0
        if (on) cue.el.style.transform = `translate(${x.toFixed(1)}px, ${on[1].toFixed(1)}px) translate(-50%, -140%)`
      }
    },
  }
}
