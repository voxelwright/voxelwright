// The one layer of DOM over the picture (#243, #244): the line of numbers in the corner, the tools, the ask
// bar, what was said, a cue beside a thing ("E to sit"), a card of controls, short notices. A lane adds a
// panel of its own (`panel`); nobody else puts elements over the canvas. How it all looks is in index.html.
//
// Everything shown here that someone typed (a name, a wish, what was said) is put as text, never as markup.
import type { Input } from './input.ts'

/** Where a place in the world (the finest cells) is on the screen, in CSS pixels, or null if it is behind the eye. */
export type Project = (at: readonly [number, number, number]) => [number, number] | null

export interface Hud {
  /** The line of numbers in the corner. */
  status(text: string): void
  /** The tools along the bottom: a button each, numbered from 1. `picked` shows which is on. */
  tools(names: readonly string[], pick: (i: number) => void): { picked(i: number): void }
  /** The ask bar: one line to type on. Enter opens it (if anything takes what is typed), Enter sends, Escape puts it away. */
  readonly line: {
    placeholder: string
    /** What is done with a line that was sent. With none, Enter does not open the bar. */
    onsubmit: ((text: string) => void) | null
    readonly open: boolean
    show(): void
    hide(): void
  }
  /** A line added to what was said lately (the last five are shown). */
  heard(text: string): void
  /** A short notice that goes by itself. */
  notice(text: string, ms?: number): void
  /** The card of controls (while mounted): a title and pairs of key and what it does. Null takes it away. */
  card(card: { title: string; rows: readonly (readonly [string, string])[] } | null): void
  /** A cue beside a place in the world, kept there as the eye moves until it is removed. `at` is asked every frame. */
  cue(text: string, at: () => readonly [number, number, number] | null): { text: string; remove(): void }
  /** An empty element of a lane's own in the layer, by name (the same name gives the same element). Style it by `[data-panel="name"]`. */
  panel(name: string): HTMLElement
  /** Once a frame: puts the cues where their places are now. Costs nothing with no cue. */
  frame(project: Project): void
}

export function hud(input: Input): Hud {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string) => { const e = document.createElement(tag); e.id = id; return e }
  const layer = el('div', 'over'), status = document.querySelector<HTMLElement>('#hud')!, bar = document.querySelector<HTMLElement>('#tools')!
  const said = el('div', 'said'), line = el('input', 'line'), notices = el('div', 'notices'), card = el('div', 'card'), cues = el('div', 'cues')
  line.maxLength = 400
  line.autocomplete = 'off'
  line.enterKeyHint = 'send'
  line.setAttribute('aria-label', 'Type here')
  card.hidden = said.hidden = line.hidden = true
  layer.append(cues, said, notices, card, line)
  document.body.append(layer)

  // The ask bar. While it is open the page is in a text mode: keys are letters, not steps.
  let leave: (() => void) | null = null
  const self = {
    placeholder: '',
    onsubmit: null as ((text: string) => void) | null,
    get open() { return leave !== null },
    show() {
      if (leave) return
      leave = input.push({ name: 'typing', solid: true, text: true })
      line.placeholder = self.placeholder
      line.hidden = false
      line.focus()
    },
    hide() {
      if (!leave) return
      leave(); leave = null
      line.value = ''
      line.hidden = true
      line.blur()
    },
  }
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { const text = line.value.trim(); self.hide(); if (text) self.onsubmit?.(text) }
    else if (e.key === 'Escape') self.hide()
  })
  input.always('Enter', (e) => {
    if (e.metaKey || e.ctrlKey || !self.onsubmit) return
    e.preventDefault()
    self.show()
    return true
  })

  const lines: string[] = []
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
    },
    notice(text, ms = 4000) {
      const n = document.createElement('p')
      n.textContent = text
      notices.append(n)
      setTimeout(() => n.remove(), ms)
    },
    card(c) {
      card.hidden = !c
      if (!c) return
      const title = document.createElement('h2')
      title.textContent = c.title
      card.replaceChildren(title, ...c.rows.map(([key, what]) => { const p = document.createElement('p'), k = document.createElement('kbd'); k.textContent = key; p.append(k, what); return p }))
    },
    cue(text, at) {
      const e = document.createElement('p'), cue = { text, at, el: e }
      e.textContent = text
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
        if (on) cue.el.style.transform = `translate(${on[0].toFixed(1)}px, ${on[1].toFixed(1)}px) translate(-50%, -140%)`
      }
    },
  }
}
