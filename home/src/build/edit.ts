// Editing a placed thing (#79): a click or tap on it selects it (a chalk rim, like the placing ghost's) and a small
// paper tag offers "Move" and "Remove". Move starts the same session as placing; Remove is one committed house version.
// Delete or Backspace removes the selected thing, Escape or a click on empty space lets go.
//
// A press selects only when it lands on a placed thing and lifts without dragging. A press is never claimed here, so
// a drag that starts on a thing still orbits the camera (plugins/camera.ts listens on the canvas).
import * as THREE from 'three/webgpu'
import type { Stage } from '../kernel'
import { PlanError } from './plan'
import { StaleHead, type PlanHistory } from './history'
import { CHALK, HAND, rimMaterial, rimOf, tagCss } from './sketch'

/** Things that stop a click from selecting: build mode's wall drag and the room outline register here. */
export const busy = new Set<() => boolean>()
/** How far from the camera a click at (x, y) meets a placed thing this editor would select (Infinity: none). Build mode's wall grip yields to a thing in front of the wall. */
export const claims = new Set<(x: number, y: number) => number>()

export interface EditDeps {
  stage: Pick<Stage, 'camera' | 'renderer'>
  /** The group of holders, each tagged `userData.furniture`. */
  things: THREE.Object3D
  /** True while a placement session is open. */
  placing: () => boolean
  labelOf: (id: string) => string | undefined
  history: () => Promise<PlanHistory>
  move: (id: string) => void
}

/** A press that moves farther than this is a drag, not a click. */
const CLICK = 6
const RIM = 0.015

export function makeEditor(deps: EditDeps) {
  const { camera, renderer } = deps.stage
  const canvas = renderer.domElement
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let selected: { id: string; holder: THREE.Object3D; rims: THREE.Mesh[] } | null = null
  let pressed: { x: number; y: number; id: string | null; pointer: number } | null = null
  let pending = false

  const style = document.createElement('style')
  style.textContent = `
  .edit-tag { position: fixed; left: 0; top: 0; z-index: 40; display: grid; gap: 6px; min-width: 200px; max-width: min(320px, calc(100vw - 24px));
    padding: 14px 18px 12px 20px; font: 600 15px/1.25 ${HAND}; will-change: transform; }
  ${tagCss('.edit-tag', '.edit-tag button[data-edit=move]', '.edit-tag button[data-edit=remove]', '[aria-disabled=true]')}
  .edit-tag::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f4e6cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .edit-tag.below::after { bottom: auto; top: -8px; background: #fffaf0; border-radius: 4px 0 0 0; box-shadow: -2px -2px 4px rgba(60, 30, 10, 0.06); }
  .edit-tag strong { font: 700 20px/1.1 ${HAND}; letter-spacing: 0.01em; }
  .edit-tag .hint { font: 500 15px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif; color: #a63c2c; font-weight: 600; }
  .edit-tag .hint:empty { display: none; }
  .edit-tag .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; position: relative; z-index: 1; }
  .edit-tag.docked { left: 12px; right: 12px; top: auto; bottom: calc(14px + env(safe-area-inset-bottom)); max-width: none; transform: none; rotate: -0.6deg; }
  .edit-tag.docked::after { display: none; }
  .edit-tag.docked .row { justify-content: stretch; }
  .edit-tag.docked .row button { flex: 1; min-height: 48px; font-size: 18px; }
  `
  const tag = document.createElement('div')
  tag.className = 'edit-tag'
  tag.setAttribute('role', 'group')
  const name = document.createElement('strong')
  const hint = document.createElement('span')
  hint.className = 'hint'
  hint.setAttribute('role', 'status')
  const row = document.createElement('div')
  row.className = 'row'
  const button = (what: 'move' | 'remove', text: string, run: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.edit = what
    b.textContent = text
    b.addEventListener('click', run)
    return b
  }
  row.append(button('remove', 'Remove', () => void remove()), button('move', 'Move', () => go()))
  tag.append(name, hint, row)

  const aim = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect()
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
  }
  const shown = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false
    return true
  }
  /** The placed thing under a screen point, as its plan id. A wall thing hidden with its wall cannot be picked. */
  const hitAt = (x: number, y: number): { id: string; distance: number } | null => {
    aim(x, y)
    for (const hit of ray.intersectObjects(deps.things.children, true)) {
      if (!shown(hit.object)) continue
      for (let o: THREE.Object3D | null = hit.object; o && o !== deps.things; o = o.parent) {
        if (typeof o.userData.furniture === 'string') return { id: o.userData.furniture, distance: hit.distance }
      }
    }
    return null
  }
  const pick = (x: number, y: number) => hitAt(x, y)?.id ?? null

  const rimThing = (holder: THREE.Object3D) => {
    const rims: THREE.Mesh[] = []
    const meshes: THREE.Mesh[] = []
    holder.traverse((m) => {
      const mesh = m as THREE.Mesh
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && mesh.geometry?.attributes.position && mesh.name !== 'placement rim') meshes.push(mesh)
    })
    for (const m of meshes) {
      // The cord a hung thing swings from is not part of its outline.
      let cord = false
      for (let p: THREE.Object3D | null = m; p && p !== holder; p = p.parent) if (p.name === 'cord') cord = true
      if (cord) continue
      const scale = m.getWorldScale(new THREE.Vector3())
      const rim = rimOf(m, RIM, rimMaterial(CHALK, 0.95, RIM / Math.max(1e-3, (scale.x + scale.y + scale.z) / 3)))
      m.add(rim)
      rims.push(rim)
    }
    return rims
  }
  const unrim = (rims: THREE.Mesh[]) => {
    for (const r of rims) {
      r.removeFromParent()
      r.geometry.dispose()
      ;(r.material as THREE.Material).dispose()
    }
  }

  const select = (id: string | null) => {
    if (selected?.id === id) return
    if (selected) {
      unrim(selected.rims)
      tag.remove()
      style.remove()
      selected = null
    }
    if (!id) return
    const holder = deps.things.children.find((c) => c.userData.furniture === id)
    if (!holder) return
    selected = { id, holder, rims: rimThing(holder) }
    name.textContent = deps.labelOf(id) ?? 'Thing'
    hint.textContent = ''
    pending = false
    for (const b of row.querySelectorAll('button')) b.removeAttribute('aria-disabled')
    document.head.append(style)
    document.body.append(tag)
    layout()
  }

  const go = () => {
    if (!selected || pending) return
    const { id } = selected
    select(null)
    deps.move(id)
  }

  /** One committed version. A failed commit leaves the thing standing and says one line why. */
  async function remove() {
    if (!selected || pending) return
    const { id } = selected
    const label = (deps.labelOf(id) ?? 'thing').toLowerCase()
    pending = true
    for (const b of row.querySelectorAll('button')) b.setAttribute('aria-disabled', 'true')
    try {
      const history = await deps.history()
      await history.commit([{ op: 'removeItem', furnitureId: id }], `Removed the ${label}`)
      if (selected?.id === id) select(null)
    } catch (error) {
      console.warn('removing did not save', error)
      if (selected?.id !== id) return
      pending = false
      for (const b of row.querySelectorAll('button')) b.removeAttribute('aria-disabled')
      hint.textContent = error instanceof StaleHead
        ? 'The house changed while you were looking. Try again?'
        : error instanceof PlanError ? error.reasons[0] : "Couldn't remove it just now. Try again?"
      layout()
    }
  }

  const box = new THREE.Box3()
  const corner = new THREE.Vector3()
  /** The tag sits above the thing (below when there is no room), docked to the bottom on a phone. */
  const layout = () => {
    if (!selected) return
    const docked = innerWidth < 700 && innerHeight > innerWidth
    tag.classList.toggle('docked', docked)
    if (docked) return void (tag.style.transform = '')
    box.setFromObject(selected.holder)
    const rect = canvas.getBoundingClientRect()
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera)
      const x = rect.left + ((corner.x + 1) / 2) * rect.width, y = rect.top + ((1 - corner.y) / 2) * rect.height
      x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y)
    }
    const tw = tag.offsetWidth, th = tag.offsetHeight
    let ty = y0 - th - 22
    const below = ty < 12
    if (below) ty = Math.min(innerHeight - th - 12, y1 + 22)
    const cx = (x0 + x1) / 2
    const tx = Math.min(Math.max(cx - tw / 2, 12), innerWidth - tw - 12)
    tag.classList.toggle('below', below)
    tag.style.setProperty('--tail', `${Math.round(Math.min(Math.max(cx - tx, 24), tw - 24))}px`)
    tag.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) rotate(-1.2deg)`
  }

  const blocked = () => deps.placing() || [...busy].some((b) => b())
  const typing = () => {
    const a = document.activeElement
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement | null)?.isContentEditable
  }
  const onDown = (e: PointerEvent) => {
    // A second finger is a pinch or a twist: the camera's.
    if (!e.isPrimary) pressed = null
    if (e.button !== 0 || !e.isPrimary || e.target !== canvas || e.defaultPrevented || blocked()) return void (pressed = null)
    pressed = { x: e.clientX, y: e.clientY, id: pick(e.clientX, e.clientY), pointer: e.pointerId }
  }
  const onUp = (e: PointerEvent) => {
    const p = pressed
    pressed = null
    if (!p || e.pointerId !== p.pointer || e.type === 'pointercancel' || blocked()) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK) return
    if (p.id) select(p.id)
    else if (selected) select(null)
  }
  const onKey = (e: KeyboardEvent) => {
    if (!selected || typing() || deps.placing()) return
    if (e.key === 'Escape') select(null)
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopImmediatePropagation()
      e.preventDefault()
      void remove()
    }
  }
  const listening = new AbortController()
  const opts = { capture: true, signal: listening.signal }
  addEventListener('pointerdown', onDown, opts)
  addEventListener('pointerup', onUp, opts)
  addEventListener('pointercancel', onUp, opts)
  addEventListener('keydown', onKey, opts)
  const claim = (x: number, y: number) => (blocked() ? Infinity : hitAt(x, y)?.distance ?? Infinity)
  claims.add(claim)

  return {
    /** Every frame: the tag follows the thing, and lets go of one the plan took away or a session picked up. */
    frame() {
      if (!selected) return
      if (deps.placing() || selected.holder.parent !== deps.things) return select(null)
      layout()
    },
    selected: () => selected?.id ?? null,
    dispose() {
      claims.delete(claim)
      listening.abort()
      select(null)
    },
  }
}
