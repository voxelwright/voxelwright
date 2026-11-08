import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { WALL_Z, WINDOW } from '../layout'
import { canvas, toTexture } from '../paint'
import { prepare, themes, type LookInfo } from '../theme'
import type { Shift, Theme } from '../theme/tokens'

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const INK = '#4a3326'
const STRIPS = 7
/** What the villagers say when a look can't be written (as the always-on input does). */
const FAILED = 'I couldn\'t change the look just now.'

/** What a chip on a look's card stands for: a thing in the kitchen and the role that colours it. */
const CHIPS: Array<{ base: string; pick: (t: Theme) => Shift }> = [
  { base: '#e6dccb', pick: (t) => t.surfaces.wall }, // plaster
  { base: '#dcb27c', pick: (t) => t.surfaces.floor }, // pine
  { base: '#c2714f', pick: (t) => t.surfaces.other }, // terracotta felt
  { base: '#6a9a3a', pick: (t) => t.surfaces.other }, // leaves
  { base: '#ffd59a', pick: (t) => t.light.practical }, // the lamp
]

const c = new THREE.Color(), pull = new THREE.Color(), lit = new THREE.Color(), fill = new THREE.Color()
const shiftOf = (base: string, s: Shift, out: THREE.Color) => {
  out.set(base)
  if (s.color && s.tint) out.lerp(pull.set(s.color), s.tint)
  if (s.gain !== undefined) out.multiplyScalar(s.gain)
  return out
}
/**
 * A look's colours, worked out from its tokens the way the theme plugin and postfx would
 * shift these five things in the kitchen (role shift, the sun and fill light's colour,
 * exposure, warmth, saturation), and snapped to the palette when the look has one.
 * Approximate: no shadows, no tone mapping.
 */
export function chips(t: Theme): string[] {
  const palette = t.post.stages.find((s) => s.kind === 'pixel')?.palette.map((h) => new THREE.Color(h))
  // How the room's light differs from the home's: half sun, half sky fill, relative to white.
  shiftOf('#ffffff', t.light.key, lit).multiplyScalar(0.5).add(shiftOf('#ffffff', t.light.fill, fill).multiplyScalar(0.5))
  lit.multiplyScalar(t.light.exposure / 1.25)
  return CHIPS.map(({ base, pick }, i) => {
    shiftOf(base, pick(t), c)
    // The lamp chip is the lamp's own light; the others are lit by the room.
    if (i < CHIPS.length - 1) c.multiply(pull.setRGB(Math.min(1.2, 0.35 + lit.r * 0.65), Math.min(1.2, 0.35 + lit.g * 0.65), Math.min(1.2, 0.35 + lit.b * 0.65)))
    c.r *= t.post.warm[0]
    c.g *= t.post.warm[1]
    c.b *= t.post.warm[2]
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
    const k = t.post.grade.saturation
    c.setRGB(l + (c.r - l) * k, l + (c.g - l) * k, l + (c.b - l) * k)
    if (palette) c.copy(palette.reduce((a, p) => (dist(p, c) < dist(a, c) ? p : a)))
    return `#${c.getHexString()}`
  })
}
const dist = (a: THREE.Color, b: THREE.Color) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2

/** The fan deck's strips, painted in code: chips down each strip, a paper foot with a rule. */
function paintStrips(looks: Theme[]) {
  const W = 64, H = 256
  const [cv, g] = canvas(W * STRIPS, H)
  for (let i = 0; i < STRIPS; i++) {
    const x = i * W
    g.fillStyle = '#f7f0e2'
    g.fillRect(x, 0, W, H)
    const colours = chips(looks[i % looks.length])
    colours.forEach((col, j) => {
      g.fillStyle = col
      g.fillRect(x + 5, 6 + j * 38, W - 10, 34)
    })
    g.fillStyle = 'rgba(90, 64, 48, 0.55)'
    g.fillRect(x + 10, 206, W - 20, 2)
    g.fillRect(x + 10, 218, W - 30, 2)
    g.strokeStyle = 'rgba(90, 64, 48, 0.25)'
    g.strokeRect(x + 0.5, 0.5, W - 1, H - 1)
  }
  return toTexture(cv)
}

/**
 * The swatch book (#50): a paint fan deck propped on the window sill, where colours are
 * held up to the light. Choosing it lays its looks out as painted paper strips; choosing a
 * strip switches the home live; your own looks can be saved, renamed and torn out; and a
 * slip at the end takes a written request when the theme writer is there.
 */
export default {
  name: 'swatchbook',
  inject: ['stage', 'entries'],
  apply(ctx: Context) {
    const { entries } = ctx
    const builtIns = themes.list().filter((l) => !l.mine).map((l) => themes.get(l.id)!)

    // ── The object: seven strips fanned from a brass rivet, leaning back on the glass ──
    const deck = new THREE.Group()
    deck.name = 'swatch book'
    const strips = paintStrips(builtIns)
    const paper = new THREE.MeshStandardMaterial({ map: strips, roughness: 0.85, side: THREE.DoubleSide })
    const sw = 0.05, sh = 0.2
    for (let i = 0; i < STRIPS; i++) {
      const geo = new THREE.PlaneGeometry(sw, sh).translate(0, sh / 2 - 0.012, 0)
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let v = 0; v < uv.count; v++) uv.setX(v, (i + uv.getX(v)) / STRIPS)
      const strip = new THREE.Mesh(geo, paper)
      strip.rotation.z = THREE.MathUtils.degToRad(38 - (i * 76) / (STRIPS - 1))
      strip.position.z = i * 0.0012
      strip.castShadow = true
      deck.add(strip)
    }
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#b08a4a', roughness: 0.35, metalness: 0.8 }))
    rivet.position.set(0, 0, 0.004)
    deck.add(rivet)
    // On the sill's right end, clear of the potted plant and the villagers' window spot on the floor.
    deck.position.set(WINDOW.x1 - 0.28, WINDOW.y0 + 0.012, WALL_Z + 0.1)
    deck.rotation.set(-0.22, -0.12, 0)
    own(ctx, deck)

    // ── The cards ──
    const fan = document.createElement('div')
    fan.className = 'swatch-fan'
    fan.setAttribute('role', 'dialog')
    fan.setAttribute('aria-label', 'Swatch book: looks for the home')
    fan.hidden = true
    const style = document.createElement('style')
    style.textContent = css()
    let editing: string | null = null // a card being renamed, or 'new' for "save this look"
    let asking = false
    let asked = '' // the request being mixed, kept on the slip while the model writes
    let note = ''

    const button = (cls: string, text: string, onClick: () => void, label?: string) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = text
      if (label) b.setAttribute('aria-label', label)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        onClick()
      })
      return b
    }
    /** A line to write on. onCancel runs on Escape; returning false lets Escape close the book instead. */
    const field = (value: string, placeholder: string, label: string, onEnter: (v: string) => void, onCancel: () => void | boolean) => {
      const input = document.createElement('input')
      input.className = 'swatch-field'
      input.value = value
      input.placeholder = placeholder
      input.maxLength = 40
      input.setAttribute('aria-label', label)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnter(input.value)
        } else if (e.key === 'Escape' && onCancel() !== false) {
          e.preventDefault()
          e.stopPropagation()
        }
      })
      return input
    }

    const card = (look: LookInfo, index: number, count: number) => {
      const t = themes.get(look.id)!
      const wrap = document.createElement('div')
      wrap.className = `swatch-slot${look.current ? ' current' : ''}${look.mine ? ' mine' : ''}`
      wrap.style.setProperty('--r', `${(index - (count - 1) / 2) * 3.2}deg`)
      const b = button('swatch-card', '', () => themes.set(look.id), `${look.label}${look.current ? ', on the walls now' : ''}`)
      b.dataset.look = look.id
      b.title = look.about
      if (look.current) b.setAttribute('aria-current', 'true')
      const list = document.createElement('span')
      list.className = 'chips'
      for (const col of chips(t)) {
        const chip = document.createElement('span')
        chip.style.background = col
        list.append(chip)
      }
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = look.label
      b.append(list, name)
      if (look.current) {
        const now = document.createElement('span')
        now.className = 'now'
        now.textContent = 'on the walls'
        b.append(now)
      }
      if (look.mine) {
        const tab = document.createElement('span')
        tab.className = 'yours'
        tab.textContent = 'yours'
        b.append(tab)
      }
      wrap.append(b)
      if (look.mine) {
        if (editing === look.id) {
          const input = field(look.label, 'a name', `New name for ${look.label}`, (v) => {
            if (themes.rename(look.id, v)) editing = null
            render(`[data-look="${look.id}"]`)
          }, () => {
            editing = null
            render(`[data-look="${look.id}"]`)
          })
          wrap.append(input)
          queueMicrotask(() => input.focus())
        } else {
          const tools = document.createElement('span')
          tools.className = 'tools'
          tools.append(
            button('swatch-tool', 'rename', () => {
              editing = look.id
              render()
            }, `Rename ${look.label}`),
            button('swatch-tool', 'tear out', () => {
              themes.remove(look.id)
              render('[data-look]')
            }, `Tear out ${look.label}`),
          )
          wrap.append(tools)
        }
      }
      return wrap
    }

    const render = (focus?: string) => {
      const looks = themes.list()
      fan.replaceChildren()
      const row = document.createElement('div')
      row.className = 'swatch-row'
      const count = looks.length + 1
      looks.forEach((l, i) => row.append(card(l, i, count)))
      // "Save this look": a blank strip; the look on screen, a blend included, goes under a name.
      const blank = document.createElement('div')
      blank.className = 'swatch-slot blank'
      blank.style.setProperty('--r', `${(count - 1 - (count - 1) / 2) * 3.2}deg`)
      if (editing === 'new') {
        const input = field('', 'a name', 'Name for this look', (v) => {
          const id = themes.save(v)
          if (id) editing = null
          render(id ? `[data-look="${id}"]` : undefined)
        }, () => {
          editing = null
          render('.swatch-save')
        })
        const hint = document.createElement('span')
        hint.className = 'name'
        hint.textContent = 'name this look'
        blank.append(hint, input)
        queueMicrotask(() => input.focus())
      } else {
        const save = button('swatch-card swatch-save', '', () => {
          editing = 'new'
          render()
        }, 'Save this look')
        const plus = document.createElement('span')
        plus.className = 'plus'
        plus.textContent = '+'
        const name = document.createElement('span')
        name.className = 'name'
        name.textContent = 'save this look'
        save.append(plus, name)
        blank.append(save)
      }
      row.append(blank)

      // The written request. The theme writer (#50, another unit) adds village.theme.ask.
      const slip = document.createElement('div')
      slip.className = 'swatch-ask'
      const ask = (themes as { ask?: (text: string) => Promise<unknown> | unknown }).ask
      const head = document.createElement('span')
      head.className = 'ask-head'
      head.textContent = 'Ask for a look'
      const input = field('', 'make it cozier, more autumn', 'Ask for a look in your own words', async (v) => {
        const text = v.trim()
        if (!text || asking) return
        if (typeof ask !== 'function') {
          note = 'Looks written from words aren\'t here yet. Your words were not sent.'
          render('.swatch-ask input')
          return
        }
        asking = true
        asked = text
        note = ''
        render('.swatch-ask input')
        let said: string
        try {
          // ask() answers { ok, note, label } or { ok: false, why }; it throws only on a fault.
          const r = await ask.call(themes, text) as { ok?: boolean; note?: string; label?: string } | undefined
          said = r?.ok ? r.note || `Now ${r.label ?? 'a new look'}.` : FAILED
        } catch {
          said = FAILED
        }
        asking = false
        note = said
        render(fan.contains(document.activeElement) ? '.swatch-ask input' : undefined)
      }, () => {
        // Escape clears what is written; on an empty line it closes the book, as anywhere else.
        if (!input.value) return false
        input.value = ''
      })
      input.maxLength = 200
      // Read-only, not disabled, while the paint is mixed, so focus stays on the slip.
      input.readOnly = asking
      if (asking) input.value = asked
      input.addEventListener('input', () => (asked = input.value))
      const status = document.createElement('span')
      status.className = `ask-note${asking ? ' mixing' : ''}`
      status.setAttribute('role', 'status')
      if (asking) {
        const pot = document.createElement('span')
        pot.className = 'pot'
        pot.setAttribute('aria-hidden', 'true')
        status.append(pot, 'Mixing the paint')
        const dots = document.createElement('span')
        dots.className = 'dots'
        dots.setAttribute('aria-hidden', 'true')
        dots.textContent = '...'
        status.append(dots)
      } else status.textContent = note || (typeof ask === 'function' ? '' : 'not here yet: looks from words are coming')
      slip.classList.toggle('busy', asking)
      slip.append(head, input, status)
      fan.append(row, slip)
      if (!fan.hidden) place()
      if (focus) (fan.querySelector<HTMLElement>(focus) ?? fan.querySelector<HTMLElement>('.current .swatch-card'))?.focus({ preventScroll: true })
    }

    // Tab and Shift+Tab stay inside the open book; Escape is the entries layer's (it calls leave).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = [...fan.querySelectorAll<HTMLElement>('button, input:not(:disabled)')]
      if (!items.length) return
      e.preventDefault()
      const at = items.indexOf(document.activeElement as HTMLElement)
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus({ preventScroll: true })
    }
    fan.addEventListener('keydown', onKey)

    // The cards open out of the deck on the sill: the row stands on the sill line, centred on
    // the deck as far as the screen allows, and each card grows out of the rivet.
    const pivot = new THREE.Vector3()
    const anchor = () => {
      deck.getWorldPosition(pivot).project(ctx.stage.camera)
      const rect = ctx.stage.renderer.domElement.getBoundingClientRect()
      return { x: rect.left + ((pivot.x + 1) / 2) * rect.width, y: rect.top + ((1 - pivot.y) / 2) * rect.height }
    }
    const place = () => {
      const a = anchor()
      const row = fan.querySelector<HTMLElement>('.swatch-row')
      if (!row) return a
      const w = fan.offsetWidth, h = row.offsetHeight
      fan.style.left = `${Math.min(innerWidth - 16 - w / 2, Math.max(16 + w / 2, a.x))}px`
      fan.style.top = `${Math.max(12, Math.min(innerHeight - fan.offsetHeight - 12, a.y - h + 6))}px`
      return a
    }
    const spring = 'cubic-bezier(.2, 1.15, .35, 1)'
    const fly = (a: { x: number; y: number }, out: boolean) => {
      if (reducedMotion.matches) return
      const slots = [...fan.querySelectorAll<HTMLElement>('.swatch-slot')]
      slots.forEach((slot, i) => {
        const r = slot.getBoundingClientRect()
        const from = `translate(${a.x - (r.left + r.width / 2)}px, ${a.y - r.bottom}px) scale(0.16) rotate(${(i - slots.length / 2) * 9}deg)`
        const frames = [{ transform: from, opacity: 0.4 }, { transform: 'none', opacity: 1 }]
        slot.animate(out ? frames.reverse() : frames, { duration: out ? 150 : 360, delay: out ? 0 : i * 22, easing: out ? 'ease-in' : spring, fill: 'backwards' })
      })
      const slip = fan.querySelector<HTMLElement>('.swatch-ask')
      slip?.animate([{ opacity: 0, transform: 'translateY(-10px) scaleY(0.6)' }, { opacity: 1, transform: 'none' }], { duration: out ? 120 : 260, delay: out ? 0 : 160, easing: 'ease-out', fill: 'backwards', direction: out ? 'reverse' : 'normal' })
    }
    const onResize = () => !fan.hidden && place()

    let closing = 0
    const open = () => {
      prepare()
      clearTimeout(closing)
      editing = null
      note = ''
      fan.hidden = false
      render('.current .swatch-card')
      fly(place(), false)
    }
    const close = () => {
      editing = null
      if (reducedMotion.matches || fan.hidden) {
        fan.hidden = true
        return
      }
      fly(anchor(), true)
      closing = window.setTimeout(() => (fan.hidden = true), 150)
    }
    addEventListener('resize', onResize)
    ctx.effect(() => () => {
      removeEventListener('resize', onResize)
      clearTimeout(closing)
    }, 'swatch book placement')

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(fan)
      return () => {
        fan.remove()
        style.remove()
      }
    }, 'swatch book cards')
    // Another way in (the API, a written request) changes the look: keep the marks true.
    ctx.on('village/theme', () => {
      if (!fan.hidden) queueMicrotask(() => render(fan.contains(document.activeElement) ? `[data-look="${themes.current()}"]` : undefined))
    })
    ctx.effect(() => entries.add({
      id: 'swatch-book',
      label: 'Swatch book',
      object: deck,
      select: open,
      leave: close,
    }), 'swatch book entry')
  },
}

function css() {
  const paper = 'radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 55%, #f3e3c4 100%)'
  return `
  .swatch-fan { position: fixed; z-index: 5; left: 50%; top: 40%; translate: -50% 0; display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: calc(100vw - 32px); }
  .swatch-fan[hidden] { display: none; }
  .swatch-row { display: flex; align-items: flex-end; gap: 0; padding: 18px 10px 0; }
  .swatch-slot { position: relative; display: flex; flex-direction: column; align-items: center; margin: 0 -1px; rotate: var(--r, 0deg); transform-origin: 50% 300%;
    transition: translate 200ms cubic-bezier(.2, 1.3, .4, 1), rotate 200ms ease; }
  .swatch-slot:hover, .swatch-slot:focus-within { translate: 0 -14px; z-index: 2; }
  .swatch-card { position: relative; width: 112px; height: 214px; box-sizing: border-box; padding: 8px 8px 0; border: 0; border-radius: 6px 6px 10px 10px; cursor: pointer;
    background: ${paper}; color: ${INK}; display: flex; flex-direction: column; align-items: stretch; gap: 0;
    box-shadow: 0 10px 24px rgba(60, 30, 10, 0.28), 0 1px 0 rgba(255, 255, 255, 0.8) inset, 0 -2px 0 rgba(120, 80, 50, 0.12) inset; }
  .swatch-card:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.95); outline-offset: 3px; }
  .swatch-card .chips { display: flex; flex-direction: column; gap: 4px; }
  .swatch-card .chips span { display: block; height: 26px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(60, 30, 10, 0.12), inset 0 -6px 10px rgba(255, 255, 255, 0.08); }
  .swatch-card .name { margin-top: 8px; font: 700 17px/1.1 ${HAND}; text-align: center; overflow-wrap: anywhere; }
  .swatch-slot.current .swatch-card { box-shadow: 0 14px 30px rgba(60, 30, 10, 0.34), 0 1px 0 rgba(255, 255, 255, 0.8) inset; }
  .swatch-card .now { position: absolute; left: 50%; top: -15px; translate: -50% 0; padding: 2px 10px 3px; border-radius: 9px; background: #c2714f; color: #fffaf0;
    font: italic 700 14px ${HAND}; white-space: nowrap; box-shadow: 0 3px 8px rgba(60, 30, 10, 0.25); }
  .swatch-card .yours { position: absolute; right: 7px; bottom: 5px; font: italic 13px ${HAND}; color: rgba(74, 51, 38, 0.85); }
  .swatch-slot .tools { display: flex; gap: 4px; margin-top: 6px; }
  .swatch-tool { border: 0; padding: 4px 10px; border-radius: 8px; background: rgba(251, 243, 226, 0.96); color: ${INK}; font: italic 15px ${HAND}; cursor: pointer;
    box-shadow: 0 3px 8px rgba(60, 30, 10, 0.2); }
  .swatch-tool:focus-visible, .swatch-field:focus-visible { outline: 3px solid rgba(255, 236, 200, 0.95); outline-offset: 2px; }
  .swatch-slot.blank .swatch-card { background: rgba(251, 243, 226, 0.9); box-shadow: inset 0 0 0 2px rgba(120, 80, 50, 0.35); justify-content: center; align-items: center; }
  .swatch-slot.blank .swatch-card::before { content: ''; position: absolute; inset: 6px; border: 2px dashed rgba(120, 80, 50, 0.35); border-radius: 5px; }
  .swatch-slot.blank .plus { font: 700 40px/1 ${HAND}; color: rgba(74, 51, 38, 0.7); }
  .swatch-slot.blank > .name { width: 112px; padding-top: 70px; text-align: center; font: 700 17px ${HAND}; color: #fffaf0; text-shadow: 0 1px 2px rgba(60, 30, 10, 0.6); }
  .swatch-field { width: 112px; box-sizing: border-box; margin-top: 6px; padding: 5px 8px; border: 0; border-radius: 8px; background: #fbf3e1; color: ${INK}; font: 15px ${BOOK};
    box-shadow: 0 4px 12px rgba(60, 30, 10, 0.25), inset 0 0 0 1.5px rgba(150, 100, 60, 0.35); }
  .swatch-ask { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; align-items: center; width: min(520px, calc(100vw - 32px)); box-sizing: border-box;
    padding: 12px 18px 10px; border-radius: 12px; background: ${paper}; color: ${INK};
    background-image: repeating-linear-gradient(transparent 0 25px, rgba(60, 90, 138, 0.16) 25px 26px), ${paper};
    box-shadow: 0 8px 22px rgba(60, 30, 10, 0.26), 0 1px 0 rgba(255, 255, 255, 0.8) inset; }
  .swatch-ask .ask-head { font: 700 18px ${HAND}; color: #9a5a35; }
  .swatch-ask .swatch-field { width: 100%; margin: 0; background: rgba(255, 252, 244, 0.85); font: italic 17px ${HAND}; }
  .swatch-ask .ask-note { grid-column: 1 / -1; min-height: 1.2em; display: flex; align-items: center; gap: 8px; font: italic 15px ${HAND}; color: rgba(74, 51, 38, 0.9); }
  .swatch-ask.busy .swatch-field { color: rgba(74, 51, 38, 0.6); }
  .swatch-ask .pot { position: relative; width: 22px; height: 22px; border-radius: 50%; flex: none;
    background: conic-gradient(#c2714f, #e0b25c, #8fae5a, #6f8fb3, #b07aa1, #c2714f); animation: swatch-mix 1.1s linear infinite;
    box-shadow: inset 0 0 0 2px rgba(255, 250, 240, 0.7), 0 2px 5px rgba(60, 30, 10, 0.3); }
  .swatch-ask .pot::after { content: ''; position: absolute; inset: 7px; border-radius: 50%; background: #fbf1dd; }
  .swatch-ask .dots { display: inline-block; width: 1.4em; overflow: hidden; vertical-align: bottom; animation: swatch-dots 1.4s steps(4) infinite; white-space: nowrap; }
  @keyframes swatch-mix { to { rotate: 360deg; } }
  @keyframes swatch-dots { from { width: 0; } to { width: 1.4em; } }
  @media (prefers-reduced-motion: reduce) { .swatch-fan, .swatch-slot { transition: none; } .swatch-ask .pot, .swatch-ask .dots { animation: none; } }
  @media (max-width: 700px) { .swatch-card { width: 78px; height: 170px; } .swatch-card .chips span { height: 18px; } .swatch-card .name { font-size: 14px; } }
  `
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
