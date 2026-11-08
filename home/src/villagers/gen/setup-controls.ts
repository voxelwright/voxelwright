// #47 the fitting's controls, one owner for B (the mirror panel) and D (the cheval mirror in the room,
// the default): the tape measure whose brass marker rides the head, the felt colour dots, the voice and
// energy dials, the manner ribbons, the jokes switch and the pattern swatches. Each strategy builds them
// into its own surfaces and styles them; the behaviour is here. Every value goes through the tools'
// set(), so the jokes lock ("set by the household's admin") and the host's pin hold on every surface.
// Keyboard: the tape, dials and ribbons are sliders (arrows step, Page jumps, Home and End go to the
// ends); the colours and the jokes are radio groups with one tab stop (arrows, Home and End move it).
import * as THREE from 'three/webgpu'
import type { Key } from './sliders'
import type { Scene } from './setup-strategy'
import { footFor } from './setup-rack'

export const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
export const RIBBON: Record<'warmth' | 'playful' | 'chatty', { ground: string; ends: [string, string] }> = {
  warmth: { ground: '#c4553f', ends: ['blunt', 'warm'] },
  playful: { ground: '#d6b45c', ends: ['serious', 'playful'] },
  chatty: { ground: '#6f86a8', ends: ['brief', 'chatty'] },
}
export const DIAL: Record<'pitch' | 'pace' | 'energy', { ends: [string, string] }> = {
  pitch: { ends: ['low', 'high'] },
  pace: { ends: ['slow', 'quick'] },
  energy: { ends: ['calm', 'lively'] },
}
const JOKES = ['clean', 'cheeky', 'crude'] as const
const HUES = 7

/** The size for a head at page row y: the feet stay put, the height scales. */
export function sizeAt(scene: Scene, y: number) {
  const r = scene.villager()
  const v = scene.tools.values.size
  if (!r) return v
  const s = (2 ** ((v - 0.5) * 0.64) * Math.max(10, r.bottom - y)) / Math.max(10, r.bottom - r.top)
  return 0.5 + Math.log2(s) / 0.64
}

/** Embroidery thread for words on felt: dark on a light felt, cream on a dark one. */
const INK = { dark: '#21170f', cream: '#fffaf0' }
const luminance = (hex: string) => {
  const c = new THREE.Color(hex)
  // THREE.Color holds linear values once parsed from a hex string.
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
/**
 * A pattern's felt for words sewn on it, and the thread that reads on it at 4.8:1 or more (WCAG AA small text is 4.5:1;
 * the margin covers a felt's texture and a picked card's lift). A mid felt that neither thread clears is dyed a little
 * deeper until cream does.
 */
export function feltInk(felt: string): { felt: string; ink: string } {
  const c = new THREE.Color(felt)
  for (let i = 0; i < 12; i++) {
    const hex = `#${c.getHexString()}`, l = luminance(hex)
    if (ratio(l, luminance(INK.dark)) >= 4.8) return { felt: hex, ink: INK.dark }
    if (ratio(l, luminance(INK.cream)) >= 4.8) return { felt: hex, ink: INK.cream }
    c.multiplyScalar(0.9)
  }
  return { felt: `#${c.getHexString()}`, ink: INK.cream }
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  e.className = cls
  parent?.append(e)
  return e
}

export function fittingControls(scene: Scene) {
  const { tools, patterns } = scene
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  /** The host pins the jokes at crude only for a grown-up whose household admin set it. */
  const crudeShown = () => scene.humour().locked === 'crude'
  // A run of changes ends in one line from the villager.
  let lineTimer = 0
  const changed = () => {
    clearTimeout(lineTimer)
    lineTimer = window.setTimeout(() => scene.tuned(), 380)
  }
  const slider = (e: HTMLElement, key: Key, label: string) => {
    e.tabIndex = 0
    e.setAttribute('role', 'slider')
    e.setAttribute('aria-label', label)
    e.setAttribute('aria-valuemin', '0')
    e.setAttribute('aria-valuemax', '100')
    e.dataset.key = key
    e.addEventListener('keydown', (ev) => {
      const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[ev.key]
      const v = step !== undefined ? tools.values[key] + step : ev.key === 'Home' ? 0 : ev.key === 'End' ? 1 : null
      if (v === null) return
      ev.preventDefault()
      tools.set(key, clamp(v))
      changed()
    })
  }
  /** Drag on an element: `to` maps the pointer to a value. */
  const drag = (e: HTMLElement, key: Key, to: (ev: PointerEvent, from: { x: number; y: number; v: number }) => number) => {
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      ev.preventDefault()
      e.focus({ preventScroll: true })
      e.setPointerCapture(ev.pointerId)
      const from = { x: ev.clientX, y: ev.clientY, v: tools.values[key] }
      tools.set(key, clamp(to(ev, from)))
      const move = (m: PointerEvent) => tools.set(key, clamp(to(m, from)))
      const up = () => {
        e.removeEventListener('pointermove', move)
        e.removeEventListener('pointerup', up)
        e.removeEventListener('pointercancel', up)
        changed()
      }
      e.addEventListener('pointermove', move)
      e.addEventListener('pointerup', up)
      e.addEventListener('pointercancel', up)
    })
  }
  /** A radio group with one tab stop: `count` choices, choice i is value i / (count - 1); the arrows stop at `last()`. */
  const radios = (group: HTMLElement, items: HTMLButtonElement[], key: Key, last = () => items.length - 1) => {
    const n = items.length - 1
    const pick = (i: number) => {
      tools.set(key, clamp(i / n))
      changed()
      // Focus follows the choice that holds (a locked choice leaves it where it was).
      items[Math.round(tools.values[key] * n)]?.focus({ preventScroll: true })
    }
    items.forEach((b, i) => {
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.key = key
      b.addEventListener('click', () => pick(i))
    })
    group.addEventListener('keydown', (ev) => {
      const at = Math.round(tools.values[key] * n)
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: last() }[ev.key]
      if (to === undefined) return
      ev.preventDefault()
      pick(Math.min(last(), Math.max(0, to)))
    })
  }

  /** The tape measure; its marker rides the villager's head. */
  const tape = (parent: HTMLElement, ends?: [string, string]) => {
    const t = el('div', 'tape', parent)
    const marker = el('div', 'marker', t)
    slider(marker, 'size', 'Height: drag the marker to their head')
    drag(t, 'size', (ev) => sizeAt(scene, ev.clientY))
    if (ends) {
      el('span', 'end top', t).textContent = ends[1]
      el('span', 'end bottom', t).textContent = ends[0]
    }
    return { tape: t, marker }
  }
  const colours = (parent: HTMLElement) => {
    const group = el('div', 'colours', parent)
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', 'Felt colour')
    const dots = Array.from({ length: HUES }, (_, i) => {
      const d = el('button', 'dot', group)
      d.setAttribute('aria-label', i === 3 ? 'Colour as made' : `Colour turned ${i < 3 ? 'one way' : 'the other way'}, ${Math.abs(i - 3)} of 3`)
      return d
    })
    radios(group, dots, 'hue')
    return { colours: group, dots }
  }
  const dials = (parent: HTMLElement, named = true) => (Object.keys(DIAL) as (keyof typeof DIAL)[]).map((key) => {
    const box = el('div', 'dial', parent)
    box.dataset.key = key
    if (named) el('b', 'dial-name', box).textContent = key
    const knob = el('div', 'knob', box)
    el('i', 'notch', knob)
    const ends = el('div', 'dial-ends', box)
    el('span', '', ends).textContent = DIAL[key].ends[0]
    el('span', '', ends).textContent = DIAL[key].ends[1]
    slider(knob, key, `${key}, a dial from ${DIAL[key].ends[0]} to ${DIAL[key].ends[1]}`)
    // Turn it by dragging sideways or up.
    drag(knob, key, (ev, from) => from.v + ((ev.clientX - from.x) - (ev.clientY - from.y)) / 160)
    return { key, knob, box }
  })
  const ribbons = (parent: HTMLElement) => (Object.keys(RIBBON) as (keyof typeof RIBBON)[]).map((key) => {
    const row = el('div', 'ribbon-row', parent)
    row.dataset.key = key
    el('span', 'end', row).textContent = RIBBON[key].ends[0]
    const strip = el('div', 'ribbon', row)
    strip.style.setProperty('--ground', RIBBON[key].ground)
    const button = el('i', 'button', strip)
    el('span', 'end', row).textContent = RIBBON[key].ends[1]
    slider(strip, key, `${RIBBON[key].ends[0]} to ${RIBBON[key].ends[1]}, a ribbon`)
    drag(strip, key, (ev) => {
      const r = strip.getBoundingClientRect(), b = button.offsetWidth * (getComputedStyle(strip).getPropertyValue('--b') ? 1 : 0)
      return (ev.clientX - r.left - b / 2) / Math.max(1, r.width - b)
    })
    return { key, strip, button }
  })
  const jokes = (parent: HTMLElement) => {
    parent.setAttribute('role', 'radiogroup')
    parent.setAttribute('aria-label', 'Jokes')
    const steps = JOKES.map((word) => {
      const b = el('button', 'step', parent)
      b.textContent = word
      return b
    })
    // Crude is a position only when the household's admin set it (the host pins the dial there); otherwise the
    // switch is clean and cheeky, and nobody sees an option they can't use.
    radios(parent, steps, 'humour', () => (crudeShown() ? 2 : 1))
    return steps
  }
  /** The pattern swatches, felt samples; drawn again only when the cards or the pick change. */
  const swatches = (hang: HTMLElement) => {
    let shown = ''
    return () => {
      const cards = scene.cards()
      const sig = cards.map((c) => c.template.id).join(',') + `|${patterns.picked?.template.id}`
      if (sig === shown) return
      shown = sig
      hang.textContent = ''
      for (const card of cards) {
        const b = el('button', 'vs-swatch', hang)
        b.type = 'button'
        b.dataset.template = card.template.id
        const f = feltInk(patterns.feltOf(card))
        b.style.setProperty('--felt', f.felt)
        b.style.setProperty('--ink', f.ink)
        b.setAttribute('aria-pressed', String(patterns.picked?.template.id === card.template.id))
        // The felt is its own layer, so the pinked edge can clip it while the card itself lifts, glows and casts a shadow.
        const felt = el('span', 'felt', b)
        el('b', '', felt).textContent = card.template.name
        const foot = footFor(card)
        if (foot) el('small', '', felt).textContent = foot
        b.addEventListener('click', () => patterns.pick(patterns.picked?.template.id === card.template.id ? null : card))
      }
    }
  }

  /** Show the values on the controls; the marker at `markerY` (page px from the tape's top) when given. */
  const sync = (c: { marker: HTMLElement; tape: HTMLElement; dots: HTMLElement[]; knobs: { key: Key; knob: HTMLElement }[]; ribbons: { key: Key; strip: HTMLElement; button: HTMLElement }[]; steps: HTMLElement[] }) => {
    const v = tools.values
    const r = scene.villager(), t = c.tape.getBoundingClientRect()
    const y = r && scene.state() === 'tuning' ? THREE.MathUtils.clamp(r.top - t.top, 8, t.height - 8) : t.height * (1 - v.size)
    c.marker.style.top = `${Math.round(y)}px`
    c.marker.setAttribute('aria-valuenow', String(Math.round(v.size * 100)))
    c.dots.forEach((d, i) => {
      const colour = scene.hueAt(i / (HUES - 1))
      if (colour) d.style.background = colour
      const here = Math.abs(v.hue - i / (HUES - 1)) < 0.05
      d.classList.toggle('at', here)
      d.setAttribute('aria-checked', String(here))
      d.tabIndex = here || (i === 3 && !c.dots.some((_, j) => Math.abs(v.hue - j / (HUES - 1)) < 0.05)) ? 0 : -1
    })
    for (const k of c.knobs) {
      k.knob.style.setProperty('--turn', `${Math.round(-135 + v[k.key] * 270)}deg`)
      k.knob.setAttribute('aria-valuenow', String(Math.round(v[k.key] * 100)))
    }
    for (const rb of c.ribbons) {
      // The button travels inside the ribbon (its own width short of each end), so at either end it never covers the word.
      rb.button.style.left = `calc(${v[rb.key].toFixed(3)} * (100% - var(--b, 0px)) + var(--b, 0px) / 2)`
      rb.strip.setAttribute('aria-valuenow', String(Math.round(v[rb.key] * 100)))
    }
    const level = Math.round(v.humour * 2)
    c.steps.forEach((s, i) => {
      s.classList.toggle('at', i === level)
      s.setAttribute('aria-checked', String(i === level))
      s.tabIndex = i === level ? 0 : -1
    })
    // Crude shows only as the level the household's admin set; otherwise it is not there at all.
    c.steps[2].hidden = !crudeShown()
    const dial = scene.humour()
    const why = dial.locked === null ? '' : dial.by === 'admin' ? "set by the household's admin" : 'kept clean, as asked'
    if ((c.steps[0].parentElement!.getAttribute('aria-description') ?? '') !== why) {
      if (why) c.steps[0].parentElement!.setAttribute('aria-description', why)
      else c.steps[0].parentElement!.removeAttribute('aria-description')
    }
  }

  /** A control's middle on the page, to click or drag it (for the checks). */
  const control = (c: Parameters<typeof sync>[0], key: Key) => {
    const e = key === 'size' ? c.tape : key === 'hue' ? c.dots[0] : key === 'humour' ? c.steps[0] : (c.knobs.find((k) => k.key === key)?.knob ?? c.ribbons.find((r) => r.key === key)!.strip)
    const b = e.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }
  }

  return {
    tape, colours, dials, ribbons, jokes, swatches, sync, control,
    dispose: () => clearTimeout(lineTimer),
  }
}
