// #47 setup, dev only: a small wooden rack of felt pattern cards at the back of the
// workshop table, one per persona template (the built-in ones A wrote, then the
// person's saved ones and the family's shared ones). Picking a card is picking a
// template; picking it again puts it back. Each card has a real button over it for
// the keyboard and screen readers. Templates are data, never code.
import * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import { HAND, TOP } from './workshop'
import type { PersonaTemplate } from './templates'

export interface RackCard { template: PersonaTemplate; source: 'built-in' | 'mine' | 'family'; maker?: string }

const FELTS = ['#c97b63', '#7b9a6e', '#d6b45c', '#6f86a8', '#b5654b', '#8a76a0', '#9db08a', '#d9a35f']
const MAX = 7

function paintCard(card: RackCard, felt: string) {
  const W = 256, H = 340
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = felt
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 3, 1 + Math.random() * 3)
  }
  // A paper label stitched onto the felt.
  g.fillStyle = '#fbf3e1'
  g.fillRect(18, 58, W - 36, H - 110)
  g.strokeStyle = 'rgba(255, 248, 232, 0.8)'
  g.lineWidth = 4
  g.setLineDash([12, 9])
  g.strokeRect(9, 9, W - 18, H - 18)
  g.setLineDash([])
  g.fillStyle = '#3d2a1c'
  g.font = `700 40px ${HAND}`
  g.textAlign = 'center'
  const words = card.template.name.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width > W - 60 && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  lines.slice(0, 4).forEach((l, i) => g.fillText(l, W / 2, 112 + i * 46))
  g.font = `italic 26px ${HAND}`
  g.fillStyle = 'rgba(70, 48, 30, 0.75)'
  const foot = card.source === 'built-in' ? (card.template.audience === 'adult' ? 'for grown-ups' : card.template.audience === 'child' ? 'for a child' : '') : card.source === 'mine' ? 'saved by you' : `shared by ${card.maker ?? 'family'}`
  if (foot) g.fillText(foot, W / 2, H - 70)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function rack(stage: Stage, onPick: (card: RackCard | null) => void) {
  const group = new THREE.Group()
  group.name = 'workshop rack'
  group.position.set(0.28, TOP, -0.3)
  const wood = new THREE.MeshStandardMaterial({ color: '#b8875a', roughness: 0.6 })
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.018, 0.05), wood)
  ledge.position.y = 0.009
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.03, 0.008), wood)
  lip.position.set(0, 0.015, 0.024)
  group.add(ledge, lip)
  group.traverse((n) => { n.castShadow = n.receiveShadow = true })
  const shelf = document.createElement('div')
  shelf.className = 'vs-rack'
  shelf.setAttribute('role', 'group')
  shelf.setAttribute('aria-label', 'Personality patterns')
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(shelf)

  let cards: { card: RackCard; mesh: THREE.Mesh; button: HTMLButtonElement }[] = []
  let picked: RackCard | null = null
  const corner = new THREE.Vector3()

  const clear = () => {
    for (const c of cards) {
      c.mesh.removeFromParent()
      c.mesh.geometry.dispose()
      const m = c.mesh.material as THREE.MeshStandardMaterial
      m.map?.dispose()
      m.dispose()
      c.button.remove()
    }
    cards = []
  }

  const api = {
    group,
    set(list: RackCard[]) {
      clear()
      const shown = list.slice(0, MAX)
      shown.forEach((card, i) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.122, 0.004), new THREE.MeshStandardMaterial({ map: paintCard(card, FELTS[i % FELTS.length]), roughness: 0.95 }))
        mesh.position.set((i - (shown.length - 1) / 2) * 0.1, 0.075, 0)
        mesh.rotation.x = -0.28
        mesh.castShadow = true
        mesh.name = `rack card ${card.template.id}`
        group.add(mesh)
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'vs-pattern'
        button.setAttribute('aria-pressed', 'false')
        button.setAttribute('aria-label', `Personality pattern: ${card.template.name}${card.source === 'built-in' ? '' : card.source === 'mine' ? ', saved by you' : `, shared by ${card.maker ?? 'family'}`}`)
        button.dataset.template = card.template.id
        button.addEventListener('click', () => api.pick(picked?.template.id === card.template.id ? null : card))
        shelf.append(button)
        cards.push({ card, mesh, button })
      })
      if (picked && !cards.some((c) => c.card.template.id === picked!.template.id)) api.pick(null)
      else api.pick(picked)
    },
    pick(card: RackCard | null) {
      picked = card
      for (const c of cards) {
        const on = c.card.template.id === card?.template.id
        c.mesh.position.y = on ? 0.105 : 0.075
        c.mesh.rotation.x = on ? -0.12 : -0.28
        const m = c.mesh.material as THREE.MeshStandardMaterial
        m.emissive.set('#ffcf8a')
        m.emissiveIntensity = on ? 0.22 : 0
        c.button.setAttribute('aria-pressed', String(on))
      }
      onPick(card)
    },
    get picked() {
      return picked
    },
    enable(on: boolean) {
      shelf.classList.toggle('shown', on)
      for (const c of cards) c.button.tabIndex = on ? 0 : -1
    },
    frame() {
      if (!shelf.classList.contains('shown')) return
      const r = stage.renderer.domElement.getBoundingClientRect()
      for (const c of cards) {
        c.mesh.updateMatrixWorld()
        corner.set(0, 0, 0).applyMatrix4(c.mesh.matrixWorld).project(stage.camera)
        const x = Math.round(r.left + ((corner.x + 1) / 2) * r.width)
        const y = Math.round(r.top + ((1 - corner.y) / 2) * r.height)
        corner.set(0.046, 0.061, 0).applyMatrix4(c.mesh.matrixWorld).project(stage.camera)
        const w = Math.max(28, Math.abs(Math.round(r.left + ((corner.x + 1) / 2) * r.width) - x) * 2)
        const h = Math.max(36, Math.abs(Math.round(r.top + ((1 - corner.y) / 2) * r.height) - y) * 2)
        const at = `${x - w / 2}px ${y - h / 2}px`
        if (c.button.style.translate !== at) {
          c.button.style.translate = at
          c.button.style.width = `${w}px`
          c.button.style.height = `${h}px`
        }
      }
    },
    /** For the checks: the template ids in order and the picked one. */
    state: () => ({ cards: cards.map((c) => ({ id: c.card.template.id, name: c.card.template.name, source: c.card.source, humour: c.card.template.persona.dials?.humour ?? null })), picked: picked?.template.id ?? null }),
    dispose() {
      clear()
      shelf.remove()
      style.remove()
    },
  }
  return api
}

function css() {
  return `
  .vs-rack { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
  .vs-pattern { position: absolute; left: 0; top: 0; padding: 0; border: 0; border-radius: 6px; background: none; cursor: pointer; pointer-events: none; }
  .vs-rack.shown .vs-pattern { pointer-events: auto; }
  .vs-pattern:hover { box-shadow: 0 0 0 2px rgba(255, 236, 200, 0.85); }
  .vs-pattern:focus-visible { outline: none; box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.65); }
  `
}
