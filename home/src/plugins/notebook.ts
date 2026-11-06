import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace } from '../kernel'

const STORAGE_KEY = 'village.notebook.lines'
const HAND = 'italic 44px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
// Matches paintPage in paint.ts: lines are 52px apart and the page's own note uses the first two.
const lineY = (i: number) => 140 + 52 * (i + 1) - 10
const FIRST_FREE = 2
const SLOTS = 8 // rows before the doodle at the bottom of the page

function readLines(): string[] {
  try {
    const lines = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(lines) ? lines.filter((l) => typeof l === 'string') : []
  } catch {
    return []
  }
}

function saveLines(lines: string[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    return true
  } catch {
    return false
  }
}

/**
 * Write in the notebook on the table. Click, tap, or Tab then Enter brings the
 * page close; typing appears on the paper in handwriting; Enter keeps the line
 * (stored in this browser for now); Escape or a click elsewhere goes back.
 */
export default {
  name: 'notebook',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    const { scene } = ctx.stage
    const { view, entries } = ctx
    const lines = readLines()
    let draft = ''
    let open = false
    let caretOn = true

    // The entries layer gives the notebook its button, label and picking; the
    // notebook keeps a text field so the keyboard can write on the page.
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 48
    input.autocomplete = 'off'
    input.setAttribute('aria-label', 'A line for the notebook')
    input.className = 'village-offscreen'
    const style = document.createElement('style')
    style.textContent = '.village-offscreen { position: fixed; left: 50%; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; font-size: 16px; }'
    const showHint = entries.say

    const page = () => scene.getObjectByName('notebook right page') as THREE.Mesh | undefined
    const book = () => scene.getObjectByName('notebook')
    // Keep an untouched copy of each page canvas so writing can be redrawn and undone.
    const pristine = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

    const paint = () => {
      const mesh = page()
      const texture = (mesh?.material as THREE.MeshStandardMaterial | undefined)?.map
      const paper = texture?.image as HTMLCanvasElement | undefined
      if (!texture || !paper?.getContext) return
      let clean = pristine.get(paper)
      if (!clean) {
        clean = document.createElement('canvas')
        clean.width = paper.width
        clean.height = paper.height
        clean.getContext('2d')!.drawImage(paper, 0, 0)
        pristine.set(paper, clean)
      }
      const g = paper.getContext('2d')!
      g.drawImage(clean, 0, 0)
      g.font = HAND
      g.fillStyle = 'rgba(38, 58, 112, 0.86)'
      const rows = open ? [...lines.slice(-(SLOTS - 1)), draft + (caretOn ? '|' : '')] : lines.slice(-SLOTS)
      rows.forEach((text, i) => g.fillText(text, 120, lineY(FIRST_FREE + i), paper.width - 160))
      texture.needsUpdate = true
    }

    const restore = () => {
      const texture = (page()?.material as THREE.MeshStandardMaterial | undefined)?.map
      const paper = texture?.image as HTMLCanvasElement | undefined
      const clean = paper && pristine.get(paper)
      if (!texture || !paper || !clean) return
      paper.getContext('2d')!.drawImage(clean, 0, 0)
      texture.needsUpdate = true
    }

    const focusPose = () => {
      const mesh = page()
      if (!mesh) return null
      mesh.geometry.computeBoundingBox()
      const center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3())
      mesh.localToWorld(center)
      return { position: center.clone().add(new THREE.Vector3(-0.04, 0.66, 0.42)), look: center }
    }

    const enter = () => {
      const pose = focusPose()
      if (!pose) return
      open = true
      view.focus(pose)
      input.value = draft
      input.focus({ preventScroll: true })
      showHint('Write a line · Enter keeps it · Esc goes back')
      paint()
    }

    const leave = () => {
      if (!open) return
      open = false
      draft = ''
      input.value = ''
      input.blur()
      view.focus(null)
      paint()
    }

    const commit = () => {
      const text = draft.trim()
      if (!text) return
      lines.push(text)
      draft = ''
      input.value = ''
      showHint(saveLines(lines) ? 'Kept on the page' : 'Written, but this browser could not save it')
      paint()
    }

    const onInput = () => {
      draft = input.value
      caretOn = true
      paint()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
      // Escape bubbles to the entries layer, which leaves and refocuses the notebook's entry.
    }

    ctx.effect(() => {
      document.head.append(style)
      document.body.append(input)
      input.addEventListener('input', onInput)
      input.addEventListener('keydown', onKey)
      return () => {
        if (open) view.focus(null)
        restore()
        input.remove()
        style.remove()
      }
    }, 'notebook writing')

    // Register once the table has made the book.
    let removeEntry: (() => void) | null = null
    ctx.effect(() => () => removeEntry?.(), 'notebook entry')

    // Show kept lines once the table's page exists, and blink the caret while writing.
    let painted = false
    let blink = 0
    ctx.on('village/frame', (dt) => {
      if (!painted && page()) {
        painted = true
        paint()
        removeEntry = entries.add({ id: 'notebook', label: 'Notebook', object: book()!, select: enter, leave })
      }
      if (!open) return
      blink += dt
      if (blink > 0.53) {
        blink = 0
        caretOn = !caretOn
        paint()
      }
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
