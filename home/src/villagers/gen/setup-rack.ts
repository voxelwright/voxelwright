// #47 setup, dev only: a small wooden rack of felt pattern cards at the back of the
// workshop table, one per persona template (the built-in ones A wrote, then the
// person's saved ones and the family's shared ones). Picking a card is picking a
// template; picking it again puts it back. Each card has a real button over it for
// the keyboard and screen readers. Templates are data, never code.
import * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import { HAND, MAT, TOP } from './workshop'
import type { PersonaTemplate } from './templates'

export interface RackCard { template: PersonaTemplate; source: 'built-in' | 'mine' | 'family'; maker?: string }

/** The felt a card is cut from, by its place on the rack; the slip's big card wears the same. */
export const feltFor = (i: number) => FELTS[i % FELTS.length]
/** Who a card is for or from, in a few words; empty for a plain built-in one. */
export const footFor = (card: RackCard) => card.source === 'built-in' ? (card.template.audience === 'adult' ? 'for grown-ups' : card.template.audience === 'child' ? 'for a child' : '') : card.source === 'mine' ? 'saved by you' : `shared by ${card.maker ?? 'family'}`
const W = 0.15, H = 0.19, GAP = 0.162

const FELTS: string[] = ['#c97b63', '#7b9a6e', '#d6b45c', '#6f86a8', '#b5654b', '#8a76a0', '#9db08a', '#d9a35f']
const MAX = 7

/** A card's felt and paper label; with a name, the name is written on the label too (for when the page's text is hidden). */
function paintCard(felt: string, name?: string) {
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
  if (name) {
    g.fillStyle = '#3d2a1c'
    g.font = `700 38px ${HAND}`
    g.textAlign = 'center'
    const lines: string[] = []
    let line = ''
    for (const w of name.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w
      if (g.measureText(next).width > W - 64 && line) {
        lines.push(line)
        line = w
      } else line = next
    }
    if (line) lines.push(line)
    const top = 58 + (H - 110) / 2 - ((Math.min(lines.length, 4) - 1) * 44) / 2 + 12
    lines.slice(0, 4).forEach((l, i) => g.fillText(l, W / 2, top + i * 44, W - 48))
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function rack(stage: Stage, onPick: (card: RackCard | null) => void) {
  const group = new THREE.Group()
  group.name = 'workshop rack'
  const wood = new THREE.MeshStandardMaterial({ color: '#b8875a', roughness: 0.6 })
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(5 * GAP + 0.03, 0.018, 0.05), wood)
  ledge.position.y = 0.009
  const lip = new THREE.Mesh(new THREE.BoxGeometry(5 * GAP + 0.03, 0.03, 0.008), wood)
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

  let cards: { card: RackCard; felt: string; mesh: THREE.Mesh; button: HTMLButtonElement; plain: THREE.Texture; named: THREE.Texture }[] = []
  // 'on': the names are page text you can pick; 'quiet': the same text, nothing to pick; 'off': no page
  // text (something stands in front of the rack), so the names are painted on the cards instead.
  let mode: 'on' | 'quiet' | 'off' = 'off'
  let picked: RackCard | null = null
  const corner = new THREE.Vector3()

  const clear = () => {
    for (const c of cards) {
      c.mesh.removeFromParent()
      c.mesh.geometry.dispose()
      const m = c.mesh.material as THREE.MeshStandardMaterial
      c.plain.dispose()
      c.named.dispose()
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
      // The ledge is as long as the row of cards.
      const k = (Math.max(shown.length, 3) * GAP + 0.03) / (5 * GAP + 0.03)
      ledge.scale.x = lip.scale.x = k
      shown.forEach((card, i) => {
        const felt = feltFor(i)
        const plain = paintCard(felt), named = paintCard(felt, card.template.name)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.004), new THREE.MeshStandardMaterial({ map: mode === 'off' ? named : plain, roughness: 0.95 }))
        mesh.position.set((i - (shown.length - 1) / 2) * GAP, H / 2 + 0.014, 0)
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
        const name = document.createElement('b')
        name.textContent = card.template.name
        button.append(name)
        const foot = footFor(card)
        if (foot) {
          const small = document.createElement('small')
          small.textContent = foot
          button.append(small)
        }
        button.addEventListener('click', () => api.pick(picked?.template.id === card.template.id ? null : card))
        shelf.append(button)
        cards.push({ card, felt, mesh, button, plain, named })
      })
      if (picked && !cards.some((c) => c.card.template.id === picked!.template.id)) api.pick(null)
      else api.pick(picked)
    },
    pick(card: RackCard | null) {
      picked = card
      for (const c of cards) {
        const on = c.card.template.id === card?.template.id
        // The picked card stands up out of the rack, a little bigger, facing you; the others sit back.
        c.mesh.position.y = H / 2 + 0.014 + (on ? 0.045 : 0)
        c.mesh.position.z = on ? 0.03 : 0
        c.mesh.rotation.x = on ? -0.08 : -0.28
        c.mesh.scale.setScalar(on ? 1.12 : 1)
        const m = c.mesh.material as THREE.MeshStandardMaterial
        m.emissive.set('#ffcf8a')
        m.emissiveIntensity = on ? 0.18 : 0
        m.color.setScalar(card && !on ? 0.82 : 1)
        c.button.setAttribute('aria-pressed', String(on))
        c.button.classList.toggle('on', on)
      }
      onPick(card)
    },
    get picked() {
      return picked
    },
    /** The picked card's felt colour, for the slip's big card. */
    feltOf(card: RackCard) {
      return cards.find((c) => c.card.template.id === card.template.id)?.felt ?? FELTS[0]
    },
    /** How wide the row of cards is, in metres. */
    width() {
      return Math.max(cards.length, 3) * GAP
    },
    arrange(layout: 'wide' | 'narrow') {
      group.position.set(MAT.x, TOP, layout === 'wide' ? -0.285 : -0.305)
    },
    enable(next: 'on' | 'quiet' | 'off') {
      mode = next
      shelf.classList.toggle('shown', next === 'on')
      shelf.classList.toggle('quiet', next === 'quiet')
      for (const c of cards) {
        c.button.tabIndex = next === 'on' ? 0 : -1
        const m = c.mesh.material as THREE.MeshStandardMaterial
        const map = next === 'off' ? c.named : c.plain
        if (m.map !== map) {
          m.map = map
          m.needsUpdate = true
        }
      }
    },
    /** The lowest card's bottom edge on screen, so the slip can lie clear of the rack (0 when no names show). */
    bottom: 0,
    frame() {
      if (mode === 'off') {
        api.bottom = 0
        return
      }
      let low = 0
      const r = stage.renderer.domElement.getBoundingClientRect()
      for (const c of cards) {
        c.mesh.updateMatrixWorld()
        corner.set(0, 0, 0).applyMatrix4(c.mesh.matrixWorld).project(stage.camera)
        const x = Math.round(r.left + ((corner.x + 1) / 2) * r.width)
        const y = Math.round(r.top + ((1 - corner.y) / 2) * r.height)
        corner.set(W / 2, H / 2, 0).applyMatrix4(c.mesh.matrixWorld).project(stage.camera)
        const w = Math.max(28, Math.abs(Math.round(r.left + ((corner.x + 1) / 2) * r.width) - x) * 2)
        const h = Math.max(36, Math.abs(Math.round(r.top + ((1 - corner.y) / 2) * r.height) - y) * 2)
        low = Math.max(low, y + h / 2)
        const at = `${x - w / 2 + 1}px ${y - h / 2}px`
        if (c.button.style.translate !== at) {
          c.button.style.translate = at
          c.button.style.width = `${w - 2}px`
          c.button.style.height = `${h}px`
          // The name fills the card's paper label: about a sixth of the card's width per letter height.
          // The longest word must fit across the label without breaking (handwriting runs about 0.55 em a letter).
          const longest = Math.max(...c.card.template.name.split(/\s+/).map((word) => word.length))
          c.button.style.fontSize = `${Math.max(9.5, Math.min(19, w * 0.165, (w * 0.88) / (longest * 0.55))).toFixed(1)}px`
        }
      }
      api.bottom = low
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
  .vs-pattern { position: absolute; left: 0; top: 0; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25em;
    padding: 1.1em 0.35em 0.6em; border: 0; border-radius: 4px; background: none; cursor: pointer; pointer-events: none; opacity: 0; transition: opacity 240ms ease;
    color: #3d2a1c; font: 700 14px/1.05 ${HAND}; text-align: center; overflow: hidden; }
  .vs-pattern b { font-weight: 700; }
  .vs-pattern small { font: 600 0.72em/1 ${HAND}; color: rgba(70, 48, 30, 0.75); }
  .vs-rack.shown .vs-pattern { pointer-events: auto; opacity: 1; }
  .vs-rack.quiet .vs-pattern { opacity: 1; }
  .vs-pattern:hover { box-shadow: 0 0 0 2px rgba(255, 236, 200, 0.9); }
  .vs-pattern.on, .vs-pattern:focus-visible { outline: none; box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.8); }
  .vs-pattern.on::after { content: ''; position: absolute; inset: 3px; border: 1.6px dashed rgba(47, 74, 107, 0.75); border-radius: 3px; }
  @media (prefers-reduced-motion: reduce) { .vs-pattern { transition: none; } }
  `
}
