// #47 regroup, strategy B: a fitting mirror. No table perspective: the villager stands full
// height in a tall felt-framed mirror, seen straight on, and the controls are built into the
// frame. A tape measure up the left side, whose brass marker sits at the villager's head (drag it
// to their height); the felt colours along the bottom; on the right, voice and energy dials and
// three short manner ribbons with the jokes switch. Before there is a villager the right side holds
// the pattern swatches, hanging like fabric samples, and the slip is tucked into the glass.
import * as THREE from 'three/webgpu'
import { HAND, MAT, TOP } from './workshop'
import type { Key } from './sliders'
import type { Scene, Strategy } from './setup-strategy'
import { footFor } from './setup-rack'

const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const RIBBON: Record<'warmth' | 'playful' | 'chatty', { ground: string; ends: [string, string] }> = {
  warmth: { ground: '#c4553f', ends: ['blunt', 'warm'] },
  playful: { ground: '#d6b45c', ends: ['serious', 'playful'] },
  chatty: { ground: '#6f86a8', ends: ['brief', 'chatty'] },
}
const DIAL: Record<'pitch' | 'pace' | 'energy', { name: string; ends: [string, string] }> = {
  pitch: { name: 'pitch', ends: ['low', 'high'] },
  pace: { name: 'pace', ends: ['slow', 'quick'] },
  energy: { name: 'energy', ends: ['calm', 'lively'] },
}

export function mirror(scene: Scene): Strategy {
  const { tools, patterns } = scene
  const el = (tag: string, cls: string, parent?: HTMLElement) => {
    const e = document.createElement(tag)
    e.className = cls
    parent?.append(e)
    return e
  }
  const frame = el('div', 'vs-mirror')
  const top = el('div', 'rail top', frame)
  const left = el('div', 'rail left', frame)
  const glass = el('div', 'glass', frame)
  const right = el('div', 'rail right', frame)
  const bottom = el('div', 'rail bottom', frame)
  void top
  void glass
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(frame)

  // A run of changes ends in one line from the villager, as on the bench.
  let lineTimer = 0
  const changed = () => {
    clearTimeout(lineTimer)
    lineTimer = window.setTimeout(() => scene.tuned(), 380)
  }
  /** A slider the keyboard reaches: arrows step, Page jumps, Home and End go to the ends. */
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
      tools.set(key, Math.min(1, Math.max(0, v)))
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
      tools.set(key, Math.min(1, Math.max(0, to(ev, from))))
      const move = (m: PointerEvent) => tools.set(key, Math.min(1, Math.max(0, to(m, from))))
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

  // ── Left: the tape measure up the side; its marker is at the villager's head ──
  const tape = el('div', 'tape', left)
  el('b', 'rail-name', left).textContent = 'height'
  const marker = el('div', 'marker', tape)
  slider(marker, 'size', 'Size: drag the marker to their height')
  /** The size for a head at page row y: the feet stay put, the height scales. */
  const sizeFor = (y: number) => {
    const r = scene.villager()
    if (!r) return tools.values.size
    const now = 2 ** ((tools.values.size - 0.5) * 0.64)
    const s = (now * Math.max(10, r.bottom - y)) / Math.max(10, r.bottom - r.top)
    return 0.5 + Math.log2(s) / 0.64
  }
  drag(tape, 'size', (ev) => sizeFor(ev.clientY))

  // ── Bottom: the felt colours ──
  const colours = el('div', 'colours', bottom)
  el('b', 'rail-name', colours).textContent = 'colour'
  colours.setAttribute('role', 'radiogroup')
  colours.setAttribute('aria-label', 'Felt colour')
  const dots = Array.from({ length: 7 }, (_, i) => {
    const d = el('button', 'dot', colours) as HTMLButtonElement
    d.type = 'button'
    d.setAttribute('role', 'radio')
    d.setAttribute('aria-label', i === 3 ? 'Colour as made' : `Colour turned ${i < 3 ? 'one way' : 'the other way'}, ${Math.abs(i - 3)} of 3`)
    d.dataset.key = 'hue'
    d.addEventListener('click', () => {
      tools.set('hue', i / 6)
      changed()
    })
    return d
  })

  // ── Right: voice and energy dials, three manner ribbons and the jokes switch ──
  const controls = el('div', 'controls', right)
  const dialRow = el('div', 'dials', controls)
  const knobs = (Object.keys(DIAL) as (keyof typeof DIAL)[]).map((key) => {
    const box = el('div', 'dial', dialRow)
    el('b', 'dial-name', box).textContent = DIAL[key].name
    const knob = el('div', 'knob', box)
    el('i', 'notch', knob)
    const ends = el('div', 'dial-ends', box)
    el('span', '', ends).textContent = DIAL[key].ends[0]
    el('span', '', ends).textContent = DIAL[key].ends[1]
    slider(knob, key, `${DIAL[key].name}, a dial from ${DIAL[key].ends[0]} to ${DIAL[key].ends[1]}`)
    // Turn it by dragging sideways or up.
    drag(knob, key, (ev, from) => from.v + ((ev.clientX - from.x) - (ev.clientY - from.y)) / 160)
    return { key, knob }
  })
  const manner = el('div', 'manner', controls)
  el('b', 'rail-name', manner).textContent = 'manner'
  const ribbons = (Object.keys(RIBBON) as (keyof typeof RIBBON)[]).map((key) => {
    const row = el('div', 'ribbon-row', manner)
    el('span', 'end', row).textContent = RIBBON[key].ends[0]
    const strip = el('div', 'ribbon', row)
    strip.style.setProperty('--ground', RIBBON[key].ground)
    const button = el('i', 'button', strip)
    el('span', 'end', row).textContent = RIBBON[key].ends[1]
    slider(strip, key, `${RIBBON[key].ends[0]} to ${RIBBON[key].ends[1]}, a ribbon`)
    drag(strip, key, (ev) => {
      const r = strip.getBoundingClientRect()
      return (ev.clientX - r.left) / r.width
    })
    return { key, strip, button }
  })
  const jokes = el('div', 'jokes', controls)
  el('b', 'rail-name', jokes).textContent = 'jokes'
  jokes.setAttribute('role', 'radiogroup')
  jokes.setAttribute('aria-label', 'Jokes')
  const steps = (['clean', 'cheeky', 'crude'] as const).map((word, i) => {
    const b = el('button', 'step', jokes) as HTMLButtonElement
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.textContent = word
    b.dataset.key = 'humour'
    b.addEventListener('click', () => {
      tools.set('humour', i / 2)
      changed()
    })
    return b
  })

  // ── Right (before there is a villager): the pattern swatches, hanging like fabric samples ──
  const swatches = el('div', 'swatches', right)
  el('b', 'rail-name', swatches).textContent = 'patterns'
  const hang = el('div', 'hang', swatches)
  let shown = ''
  const drawSwatches = () => {
    const cards = scene.cards()
    const sig = cards.map((c) => c.template.id).join(',') + `|${patterns.picked?.template.id}`
    if (sig === shown) return
    shown = sig
    hang.textContent = ''
    for (const card of cards) {
      const b = el('button', 'vs-swatch', hang) as HTMLButtonElement
      b.type = 'button'
      b.dataset.template = card.template.id
      b.style.setProperty('--felt', patterns.feltOf(card))
      b.setAttribute('aria-pressed', String(patterns.picked?.template.id === card.template.id))
      el('b', '', b).textContent = card.template.name
      const foot = footFor(card)
      if (foot) el('small', '', b).textContent = foot
      b.addEventListener('click', () => patterns.pick(patterns.picked?.template.id === card.template.id ? null : card))
    }
  }

  const narrow = () => scene.layout() === 'narrow'
  /** The frame's glass, on the page; laid out by CSS from the screen's shape. */
  const glassRect = () => glass.getBoundingClientRect()
  const showFrame = () => {
    const s = scene.state()
    return !scene.watching() && (s === 'empty' || s === 'failed' || s === 'stitching' || s === 'tuning')
  }
  const empty = () => {
    // No villager yet: straight on at the empty mat, the glass's height about half a metre of it.
    const g = glassRect()
    const fov = scene.lens(narrow() ? 50 : undefined)
    const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2))
    const dist = 0.55 / ((g.height / innerHeight) * 2 * tan)
    const wpp = (2 * dist * tan) / innerHeight
    const look = new THREE.Vector3(MAT.x, TOP + 0.16, MAT.z - 0.04)
    look.x += ((innerWidth / 2) - (g.left + g.width / 2)) * wpp
    look.y += ((g.top + g.height / 2) - innerHeight / 2) * wpp
    return { position: look.clone().addScaledVector(new THREE.Vector3(0, 0.1, 1).normalize(), dist), look }
  }

  return {
    id: 'b',
    standAt: () => new THREE.Vector3(MAT.x, TOP + 0.006, MAT.z - 0.04),
    // Square on to the mirror.
    turn: () => 0.05,
    toolsVisible: () => false,
    pose(state) {
      if (state === 'waiting') return scene.overMat()
      if (state === 'empty' || state === 'failed') return empty()
      if (state !== 'stitching' && state !== 'tuning') return null
      const g = glassRect()
      return scene.front({ top: g.top + (narrow() ? 96 : 120), bottom: g.bottom - 12, left: g.left + 8, right: g.right - 8, slope: 0.1, fov: narrow() ? 50 : undefined })
    },
    tuning() {
      frame.classList.add('tuning')
      marker.focus({ preventScroll: true })
    },
    leaving() {
      frame.classList.remove('tuning')
    },
    slip(w) {
      if (!showFrame()) return null
      const g = glassRect()
      const width = `${Math.round(Math.min(g.width - 20, 440))}px`
      if (scene.slip.style.width !== width && !scene.slip.classList.contains('invite')) scene.slip.style.width = width
      void w
      const h = scene.slip.offsetHeight
      return { x: g.left + g.width / 2, y: g.bottom - h / 2 - 12 }
    },
    place(what, w, h) {
      if (!showFrame()) return null
      const f = frame.getBoundingClientRect()
      if (what === 'name') {
        // A brass name plate on the frame's top rail.
        const t = top.getBoundingClientRect()
        return { x: t.left + t.width / 2 - w / 2, y: t.top + t.height / 2 - h / 2 }
      }
      if (what === 'card') return null
      if (!narrow()) return what === 'save' ? { x: Math.max(16, f.left - 24 - w), y: f.bottom - h } : { x: Math.min(innerWidth - 16 - w, f.right + 24), y: f.bottom - h }
      // A phone: both in the bottom rail's last row.
      return what === 'save' ? { x: f.left + 12, y: f.bottom - h - 10 } : { x: f.right - 12 - w, y: f.bottom - h - 10 }
    },
    frame() {
      const on = showFrame()
      frame.classList.toggle('shown', on)
      frame.classList.toggle('tuning', scene.state() === 'tuning' || scene.state() === 'stitching')
      patterns.group.visible = false
      if (!on) return
      drawSwatches()
      const v = tools.values
      // The marker rides the villager's head; the tape's ticks are only a ruler.
      const r = scene.villager(), t = tape.getBoundingClientRect()
      const y = r && scene.state() === 'tuning' ? THREE.MathUtils.clamp(r.top - t.top, 8, t.height - 8) : t.height * (1 - v.size)
      marker.style.top = `${Math.round(y)}px`
      marker.setAttribute('aria-valuenow', String(Math.round(v.size * 100)))
      dots.forEach((d, i) => {
        const c = scene.hueAt(i / 6)
        if (c) d.style.background = c
        const at = Math.abs(v.hue - i / 6) < 0.05
        d.classList.toggle('at', at)
        d.setAttribute('aria-checked', String(at))
      })
      for (const k of knobs) {
        k.knob.style.setProperty('--turn', `${Math.round(-135 + v[k.key] * 270)}deg`)
        k.knob.setAttribute('aria-valuenow', String(Math.round(v[k.key] * 100)))
      }
      for (const rb of ribbons) {
        rb.button.style.left = `${(v[rb.key] * 100).toFixed(1)}%`
        rb.strip.setAttribute('aria-valuenow', String(Math.round(v[rb.key] * 100)))
      }
      const at = Math.round(v.humour * 2)
      steps.forEach((s, i) => {
        s.classList.toggle('at', i === at)
        s.setAttribute('aria-checked', String(i === at))
      })
      // Crude shows only as a level the household's admin set: otherwise it is a locked mark, never a choice.
      steps[2].classList.toggle('locked', at !== 2)
    },
    api: {
      /** A control's middle on the page, to click or drag it. */
      control: (key: Key) => {
        const e = key === 'size' ? tape : key === 'hue' ? dots[0] : key === 'humour' ? steps[0] : (knobs.find((k) => k.key === key)?.knob ?? ribbons.find((r) => r.key === key)!.strip)
        const b = e.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }
      },
      glass: () => glassRect().toJSON(),
    },
    dispose() {
      clearTimeout(lineTimer)
      patterns.group.visible = true
      frame.remove()
      style.remove()
    },
  }
}

function css() {
  const felt = 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.4px) 0 0 / 4px 4px, radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1.4px) 2px 2px / 5px 5px'
  return `
  [data-vs-strategy=b] .vs-rack, [data-vs-strategy=b] .vs-saved { display: none !important; }
  .vs-mirror { position: fixed; z-index: 4; box-sizing: border-box; display: grid; opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity 320ms ease, visibility 0s linear 320ms;
    left: 50%; top: 20px; height: calc(100vh - 40px); translate: -50% 0;
    grid-template-columns: 92px calc((100vh - 40px - 56px - 96px) * 0.62) 280px; grid-template-rows: 56px 1fr 96px;
    grid-template-areas: 'top top top' 'left glass right' 'bottom bottom bottom';
    border: 11px solid #9a6534; border-radius: 14px; background: none;
    box-shadow: 0 18px 40px rgba(30, 15, 5, 0.45), inset 0 0 0 2px rgba(255, 220, 170, 0.35); }
  .vs-mirror.shown { opacity: 1; visibility: visible; transition: opacity 320ms ease; }
  .vs-mirror .rail { position: relative; background: ${felt}, #3f5e4a; pointer-events: auto; color: #fff3dc; }
  .vs-mirror .rail::after { content: ''; position: absolute; inset: 6px; border: 1.6px dashed rgba(255, 240, 210, 0.38); border-radius: 4px; pointer-events: none; }
  .vs-mirror .top { grid-area: top; border-radius: 4px 4px 0 0; }
  .vs-mirror .left { grid-area: left; display: flex; flex-direction: column; align-items: center; padding: 10px 0 12px; }
  .vs-mirror .right { grid-area: right; padding: 12px 16px; display: flex; flex-direction: column; }
  .vs-mirror .bottom { grid-area: bottom; display: flex; align-items: center; justify-content: center; border-radius: 0 0 4px 4px; }
  .vs-mirror .glass { grid-area: glass; position: relative; box-shadow: inset 0 0 0 4px #d9b07a, inset 0 0 0 6px rgba(80, 50, 20, 0.5), inset 0 0 50px rgba(20, 30, 40, 0.35);
    background: linear-gradient(118deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.02) 22%, transparent 40%, transparent 72%, rgba(255,255,255,0.07) 86%, transparent 100%); }
  .vs-mirror .rail-name { display: block; font: 700 17px/1.1 ${HAND}; color: #ffe9c4; letter-spacing: 0.02em; }
  /* The tape measure up the side. */
  .vs-mirror .tape { position: relative; flex: 1; width: 30px; margin: 4px 0 8px; border-radius: 3px; cursor: ns-resize; touch-action: none;
    background: repeating-linear-gradient(0deg, #5a3f22 0 1.5px, transparent 1.5px 9px) right / 9px 100% no-repeat, repeating-linear-gradient(0deg, #5a3f22 0 2px, transparent 2px 36px) right / 16px 100% no-repeat, #e9c45a;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(90, 60, 30, 0.4); }
  .vs-mirror .marker { position: absolute; left: -16px; width: 62px; height: 18px; margin-top: -9px; border-radius: 3px 9px 9px 3px; background: linear-gradient(180deg, #e2bd6a, #b88a3a);
    box-shadow: 0 2px 5px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 240, 200, 0.6); transition: top 120ms ease; }
  .vs-mirror .marker::after { content: '↕'; position: absolute; right: 6px; top: -1px; font: 700 14px/18px ${HAND}; color: #3d2a1c; }
  .vs-mirror .marker:focus-visible { outline: 3px solid #fffaf0; outline-offset: 2px; }
  /* The felt colours along the bottom. */
  .vs-mirror .colours { display: flex; align-items: center; gap: 12px; }
  .vs-mirror .colours .rail-name { margin-right: 6px; }
  .vs-mirror .dot { width: 40px; height: 40px; border: 0; border-radius: 50%; cursor: pointer; background: #d9a35f;
    background-image: radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1.4px); background-size: 4px 4px;
    box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.35), 0 3px 6px rgba(0,0,0,0.35); transition: translate 120ms ease; }
  .vs-mirror .dot.at { translate: 0 -5px; box-shadow: inset 0 0 0 2px rgba(255, 245, 225, 0.5), 0 0 0 3px #fff3dc, 0 6px 10px rgba(0,0,0,0.4); }
  .vs-mirror .dot:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 4px; }
  /* The right rail holds the controls once there is a villager, the pattern swatches before. */
  .vs-mirror .controls { display: none; flex-direction: column; justify-content: space-evenly; flex: 1; gap: 14px; }
  .vs-mirror.tuning .controls { display: flex; }
  .vs-mirror.tuning .swatches { display: none; }
  .vs-mirror.tuning .colours { visibility: visible; }
  .vs-mirror:not(.tuning) .colours, .vs-mirror:not(.tuning) .left > * { visibility: hidden; }
  .vs-mirror .dials { display: flex; justify-content: space-between; }
  .vs-mirror .dial { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 78px; }
  .vs-mirror .knob { position: relative; width: 58px; height: 58px; border-radius: 50%; cursor: grab; touch-action: none;
    background: radial-gradient(circle at 35% 30%, #c98a58, #8a5a2f 70%); box-shadow: 0 4px 8px rgba(0,0,0,0.4), inset 0 0 0 3px rgba(255, 220, 170, 0.35); }
  .vs-mirror .knob::before { content: ''; position: absolute; inset: -7px; border-radius: 50%; border: 2px dotted rgba(255, 240, 210, 0.5); clip-path: polygon(50% 50%, 0 100%, 0 0, 100% 0, 100% 100%); }
  .vs-mirror .notch { position: absolute; left: 50%; top: 6px; width: 4px; height: 20px; margin-left: -2px; border-radius: 2px; background: #fff3dc; transform-origin: 50% 23px; rotate: var(--turn, 0deg); }
  .vs-mirror .knob:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 5px; }
  .vs-mirror .dial-ends { display: flex; justify-content: space-between; width: 70px; font: 700 13px/1 ${HAND}; color: #ffe9c4; opacity: 0.9; }
  .vs-mirror .manner { display: flex; flex-direction: column; gap: 7px; }
  .vs-mirror .ribbon-row { display: grid; grid-template-columns: 58px 1fr 58px; align-items: center; gap: 6px; font: 700 14px/1 ${HAND}; }
  .vs-mirror .ribbon-row .end:first-child { text-align: right; }
  .vs-mirror .ribbon { position: relative; height: 18px; border-radius: 2px; cursor: pointer; touch-action: none; background: var(--ground);
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 2px, rgba(0,0,0,0.06) 2px 4px); box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
  .vs-mirror .ribbon::after { content: ''; position: absolute; inset: 3px 0; border-top: 1.4px dashed rgba(255, 248, 232, 0.6); border-bottom: 1.4px dashed rgba(255, 248, 232, 0.6); }
  .vs-mirror .ribbon .button { position: absolute; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: #e9dcc0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.4), inset 0 0 0 2px rgba(120, 80, 50, 0.35); z-index: 1; }
  .vs-mirror .ribbon .button::after { content: '⁘'; position: absolute; inset: 0; font: 15px/24px serif; text-align: center; color: #5a3d27; }
  .vs-mirror .ribbon:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 4px; }
  .vs-mirror .jokes { display: flex; align-items: center; gap: 6px; }
  .vs-mirror .jokes .rail-name { margin-right: 4px; }
  .vs-mirror .step { white-space: nowrap; padding: 4px 10px 5px; border: 0; border-radius: 4px 9px 9px 4px; cursor: pointer; background: rgba(255, 243, 220, 0.18); color: #fff3dc; font: 700 15px/1.1 ${HAND}; }
  .vs-mirror .step.at { background: #fffaf0; color: #23395a; box-shadow: 0 2px 6px rgba(0,0,0,0.3); }
  .vs-mirror .step.locked { opacity: 0.5; text-decoration: line-through 1px; }
  .vs-mirror .step.locked::after { content: ' 🔒'; font-size: 11px; text-decoration: none; }
  /* The pattern swatches: felt samples with pinked edges, hanging from a brass rod. */
  .vs-mirror .swatches { display: flex; flex-direction: column; gap: 8px; }
  .vs-mirror .hang { position: relative; display: flex; flex-wrap: wrap; gap: 12px 10px; padding-top: 12px; }
  .vs-mirror .hang::before { content: ''; position: absolute; left: -4px; right: -4px; top: 3px; height: 5px; border-radius: 3px; background: linear-gradient(180deg, #e2bd6a, #9a7330); box-shadow: 0 2px 3px rgba(0,0,0,0.35); }
  .vs-swatch { position: relative; width: 116px; min-height: 76px; padding: 12px 8px 14px; border: 0; cursor: pointer; background: var(--felt, #7b9a6e); color: #fffaf0;
    clip-path: polygon(0 0, 100% 0, 100% 88%, 95% 100%, 90% 88%, 85% 100%, 80% 88%, 75% 100%, 70% 88%, 65% 100%, 60% 88%, 55% 100%, 50% 88%, 45% 100%, 40% 88%, 35% 100%, 30% 88%, 25% 100%, 20% 88%, 15% 100%, 10% 88%, 5% 100%, 0 88%);
    text-align: center; text-shadow: 0 1px 0 rgba(40, 20, 8, 0.35); transform-origin: 50% 0; transition: rotate 200ms ease, translate 200ms ease; }
  .vs-swatch::before { content: ''; position: absolute; left: 50%; top: 3px; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: #e9dcc0; box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .vs-swatch b { display: block; font: 700 16px/1.1 ${HAND}; }
  .vs-swatch small { display: block; margin-top: 3px; font: italic 11.5px/1.2 ${BOOK}; opacity: 0.9; }
  .vs-swatch:nth-child(odd) { rotate: -1.5deg; } .vs-swatch:nth-child(even) { rotate: 1.2deg; }
  .vs-swatch[aria-pressed=true] { translate: 0 6px; rotate: 0deg; box-shadow: none; filter: brightness(1.08) drop-shadow(0 0 0 #fff); outline: none; }
  .vs-swatch[aria-pressed=true] b { text-decoration: underline 1.5px; text-underline-offset: 3px; }
  .vs-swatch:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 2px; }
  /* A phone: the frame fills the screen; no right rail, the controls and swatches below the glass. */
  @media (max-aspect-ratio: 9/10) {
    .vs-mirror { top: 8px; left: 8px; right: 8px; translate: none; width: auto; height: calc(100vh - 16px); border-width: 8px;
      grid-template-columns: 52px 1fr 10px; grid-template-rows: 46px minmax(0, 1fr) auto auto;
      grid-template-areas: 'top top top' 'left glass edge' 'bottom bottom bottom' 'right right right'; }
    .vs-mirror .glass { min-height: 0; }
    .vs-mirror .left .rail-name { font-size: 14px; }
    .vs-mirror .bottom { padding: 8px 0 4px; }
    .vs-mirror .dot { width: 30px; height: 30px; }
    .vs-mirror .colours { gap: 8px; }
    .vs-mirror .right { padding: 6px 12px 60px; }
    .vs-mirror .controls { gap: 8px; }
    .vs-mirror .knob { width: 46px; height: 46px; }
    .vs-mirror .notch { height: 15px; transform-origin: 50% 17px; }
    .vs-mirror .dial-ends { width: 64px; font-size: 12px; }
    .vs-mirror .ribbon-row { grid-template-columns: 52px 1fr 52px; font-size: 13px; }
    .vs-mirror .hang { gap: 8px 6px; }
    .vs-swatch { width: calc(33% - 6px); min-height: 60px; padding: 10px 4px 12px; }
    .vs-swatch b { font-size: 14px; }
    .vs-mirror:not(.tuning) .bottom { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .vs-mirror, .vs-mirror .marker, .vs-swatch, .vs-mirror .dot { transition: none; } }
  `
}
