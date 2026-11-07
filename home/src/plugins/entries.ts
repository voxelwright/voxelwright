import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'

/** A meaningful object in the home that someone can choose: the home's menu. */
export interface Entry {
  id: string
  /** Short handwritten label shown on hover and keyboard focus. */
  label: string
  /** Hit target and highlight. Every mesh under it counts. */
  object: THREE.Object3D
  /** Choose the entry. */
  select(): void
  /** Back out of it: Escape, a click elsewhere, or choosing another entry. */
  leave?(): void
}

export interface EntryState {
  id: string
  label: string
  /** Projected centre of the object in CSS pixels, and whether it is on screen. */
  x: number
  y: number
  onScreen: boolean
}

export interface Entries {
  /** Register an entry; returns its removal. Call inside ctx.effect so unload removes it. */
  add(entry: Entry): () => void
  /** The entry that was chosen and not yet left, if any. */
  readonly active: string | null
  /** The entry under the pointer or holding keyboard focus, if any. */
  readonly hovered: string | null
  /** Leave the active entry, as Escape does. */
  back(): void
  /** Choose an entry by id, as a click on it would. False when there is no such entry. */
  choose(id: string): boolean
  /** Show a short line of text at the bottom of the screen, or hide it with null. */
  say(text: string | null): void
  /** Put the keyboard order in screen order, left to right, then top to bottom. */
  sort(): void
  list(): EntryState[]
}

declare module 'cordis' {
  interface Context {
    entries: Entries
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const GLOW = new THREE.Color('#ffd7a8')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'

interface Live extends Entry {
  button: HTMLButtonElement
  glow: number
  /** Each highlighted material's own emissive colour, restored when the glow ends. */
  originals: Map<THREE.MeshStandardMaterial, THREE.Color>
}

/**
 * The interaction layer. Any plugin registers an object as an entry with a
 * label and an action. Pointer hover glows it softly and shows the label;
 * click or tap chooses it; Tab cycles entries in screen order, Enter chooses,
 * Escape backs out. Each entry has a real button so screen readers and the
 * keyboard reach it.
 */
export default {
  name: 'entries',
  inject: ['stage'],
  apply(ctx: Context) {
    const { camera, renderer, scene } = ctx.stage
    const live = new Map<string, Live>()
    const owners = new Map<THREE.Object3D, Live>()
    let active: Live | null = null
    let hovered: Live | null = null
    let pointerHover: Live | null = null

    const nav = document.createElement('nav')
    nav.setAttribute('aria-label', 'Things in the room')
    nav.className = 'village-entries'
    const label = document.createElement('div')
    label.className = 'village-label'
    label.setAttribute('aria-hidden', 'true')
    const hint = document.createElement('div')
    hint.className = 'village-hint'
    hint.setAttribute('aria-live', 'polite')
    const style = document.createElement('style')
    style.textContent = `
      .village-entries button { position: fixed; left: 50%; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
      .village-label { position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0; white-space: nowrap;
        font: 600 22px ${HAND}; color: #fdf6ea; letter-spacing: 0.01em;
        text-shadow: 0 1px 2px rgba(60, 30, 10, 0.55), 0 0 14px rgba(60, 30, 10, 0.35);
        transform: translate(-50%, -100%) translateY(6px); transition: opacity 200ms ease, transform 200ms ease; }
      .village-label.shown { opacity: 1; transform: translate(-50%, -100%); }
      .village-label::after { content: ''; display: block; margin: 2px auto 0; width: 60%; height: 2px; border-radius: 2px;
        background: rgba(253, 246, 234, 0.7); box-shadow: 0 1px 2px rgba(60, 30, 10, 0.4); }
      .village-hint { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 8px); opacity: 0;
        padding: 10px 18px; border-radius: 999px; background: rgba(251, 243, 226, 0.92); color: #5a4030;
        font: italic 18px ${HAND}; box-shadow: 0 6px 24px rgba(60, 30, 10, 0.25);
        transition: opacity 240ms ease, transform 240ms ease; pointer-events: none; white-space: nowrap; }
      .village-hint.shown { opacity: 1; transform: translate(-50%, 0); }
      @media (prefers-reduced-motion: reduce) { .village-label, .village-hint { transition: none; } }
    `

    const say = (text: string | null) => {
      if (text) hint.textContent = text
      hint.classList.toggle('shown', Boolean(text))
    }

    const center = (e: Entry) => new THREE.Box3().setFromObject(e.object).getCenter(new THREE.Vector3())
    const top = (e: Entry) => {
      const box = new THREE.Box3().setFromObject(e.object)
      return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)
    }
    const toScreen = (p: THREE.Vector3) => {
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = p.clone().project(camera)
      return {
        x: rect.left + ((ndc.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - ndc.y) / 2) * rect.height,
        onScreen: ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
      }
    }

    const setHover = (next: Live | null) => {
      if (next === hovered) return
      hovered = next
      if (next) label.textContent = next.label
      label.classList.toggle('shown', Boolean(next))
    }

    /** Entries in view, in screen order: left to right, then top to bottom. */
    const inView = () => {
      const order = [...live.values()].map((e) => ({ e, s: toScreen(center(e)) })).filter((o) => o.s.onScreen)
      order.sort((a, b) => a.s.x - b.s.x || a.s.y - b.s.y)
      return order.map((o) => o.e)
    }
    // Moving a focused button in the DOM would drop its focus, so reorder only when none has it.
    const sort = () => {
      const shown = inView()
      for (const e of live.values()) e.button.hidden = !shown.includes(e)
      if (!nav.contains(document.activeElement)) for (const e of shown) nav.append(e.button)
      return shown
    }
    let sortIn = 0 // frames until the next sort, once new entries have a camera to be seen from

    const back = () => {
      const was = active
      if (!was) return
      active = null
      say(null)
      was.leave?.()
    }

    const choose = (e: Live) => {
      if (active && active !== e) back()
      active = e
      e.select()
    }

    // Pointer: hover on mouse and pen, tap or click to choose; touch skips hover.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pick = (event: PointerEvent): Live | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      // The nearest solid thing wins, so furniture blocks the entries behind it.
      for (const { object } of raycaster.intersectObject(scene, true)) {
        if (!solid(object)) continue
        for (let o: THREE.Object3D | null = object; o; o = o.parent) {
          const e = owners.get(o)
          if (e) return e
        }
        return null
      }
      return null
    }
    /** Seen and opaque to the eye: hidden rooms, light shafts, glows and motes don't block. */
    const solid = (object: THREE.Object3D) => {
      if (!(object as THREE.Mesh).isMesh) return false
      for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
      return ([] as THREE.Material[]).concat((object as THREE.Mesh).material).some((m) => m.visible && m.depthWrite)
    }
    let down: { x: number; y: number } | null = null
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      pointerHover = pick(event)
      renderer.domElement.style.cursor = pointerHover ? 'pointer' : ''
      setHover(pointerHover ?? (live.get((document.activeElement as HTMLElement)?.dataset?.entry ?? '') || null))
    }
    const onDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY })
    const onUp = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) return
      down = null
      const e = pick(event)
      if (e) choose(e)
      else back()
    }
    const onLeave = () => {
      pointerHover = null
      setHover(null)
    }

    // Keyboard: Tab wraps around the entries; Escape backs out from anywhere.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && active) {
        const was = active
        event.preventDefault()
        back()
        was.button.focus({ preventScroll: true })
      } else if (event.key === 'Tab') {
        const buttons = sort().map((e) => e.button)
        if (!buttons.length) return
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const step = event.shiftKey ? -1 : 1
        if (at === -1 && document.activeElement !== document.body && document.activeElement !== null) return
        event.preventDefault()
        const next = at === -1 ? (event.shiftKey ? buttons.length - 1 : 0) : (at + step + buttons.length) % buttons.length
        buttons[next].focus({ preventScroll: true })
      }
    }

    ctx.effect(() => {
      const canvas = renderer.domElement
      document.head.append(style)
      document.body.append(nav, label, hint)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointerleave', onLeave)
      addEventListener('keydown', onKey)
      return () => {
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointerleave', onLeave)
        removeEventListener('keydown', onKey)
        canvas.style.cursor = ''
        nav.remove()
        label.remove()
        hint.remove()
        style.remove()
      }
    }, 'entries layer')

    const glowTo = (e: Live, k: number) => {
      e.glow = k
      e.object.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        for (const material of ([] as THREE.Material[]).concat(mesh.material)) {
          const m = material as THREE.MeshStandardMaterial
          if (!m.emissive) continue
          if (!e.originals.has(m)) e.originals.set(m, m.emissive.clone())
          m.emissive.copy(e.originals.get(m)!).lerp(GLOW, 0.16 * k)
        }
      })
    }

    // Each frame: ease glows and keep the label over its object.
    ctx.on('village/frame', (dt) => {
      if (sortIn && --sortIn === 0) sort()
      for (const e of live.values()) {
        const goal = e === hovered && e !== active ? 1 : 0
        if (e.glow === goal) continue
        const k = reducedMotion.matches ? goal : e.glow + (goal - e.glow) * (1 - Math.exp(-dt * 10))
        glowTo(e, Math.abs(goal - k) < 0.01 ? goal : k)
      }
      if (hovered && hovered !== active) {
        const s = toScreen(top(hovered))
        label.style.left = `${s.x}px`
        label.style.top = `${s.y - 10}px`
        label.classList.toggle('shown', true)
      } else label.classList.remove('shown')
    })

    ctx.provide('entries', {
      add(entry: Entry) {
        if (live.has(entry.id)) throw new Error(`Entry "${entry.id}" is already registered`)
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = entry.label
        button.dataset.entry = entry.id
        const e: Live = { ...entry, button, glow: 0, originals: new Map() }
        button.addEventListener('click', () => choose(e))
        button.addEventListener('focus', () => setHover(e))
        button.addEventListener('blur', () => hovered === e && setHover(pointerHover))
        live.set(entry.id, e)
        owners.set(entry.object, e)
        nav.append(button)
        sortIn = 3
        return () => {
          if (active === e) back()
          if (hovered === e) setHover(null)
          if (pointerHover === e) pointerHover = null
          glowTo(e, 0)
          button.remove()
          live.delete(entry.id)
          owners.delete(entry.object)
        }
      },
      get active() {
        return active?.id ?? null
      },
      get hovered() {
        return hovered?.id ?? null
      },
      back,
      choose(id: string) {
        const e = live.get(id)
        if (e) choose(e)
        return Boolean(e)
      },
      say,
      sort,
      list: () => [...live.values()].map((e) => ({ id: e.id, label: e.label, ...toScreen(center(e)) })),
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
