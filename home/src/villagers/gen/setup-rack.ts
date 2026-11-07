// #47 setup, dev only: a small wooden rack of felt pattern cards at the back of the
// workshop table, one per persona template (the built-in ones A wrote, then the
// person's saved ones and the family's shared ones). Picking a card is picking a
// template; picking it again puts it back. Each card has a real button over it for
// the keyboard and screen readers. Templates are data, never code.
import * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import { HAND, MAT, TOP } from './workshop'
import type { PatternData } from '../../villager'

/** A pattern card: a host pattern (built-in, the person's own or the family's), its manner as persona fields. */
export interface RackCard { template: PatternData; source: 'built-in' | 'mine' | 'family'; maker?: string }
/** How the host names this pattern when making from it: a built-in id, or "<maker>:<id>". */
export const refOf = (card: RackCard, person: string) => card.source === 'built-in' ? card.template.id : `${card.template.maker ?? person}:${card.template.id}`

/** The felt a card is cut from, by its place on the rack; the slip's big card wears the same. */
export const feltFor = (i: number) => FELTS[i % FELTS.length]
/** Who a card is for or from, in a few words; empty for a plain built-in one. */
export const footFor = (card: RackCard) => card.source === 'built-in' ? (card.template.audience === 'adult' ? 'for grown-ups' : card.template.audience === 'child' ? 'for a child' : '') : card.source === 'mine' ? 'saved by you' : `shared by ${card.maker ?? 'family'}`
const W = 0.15, H = 0.19, GAP = 0.162
/** A phone's two-step rack: the back step's height and how far behind the front one it stands. */
const STEP = 0.22, BACK = 0.1
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

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
  // A phone's rack is a two-step stand: three cards on the raised back step, the rest on the front one, so each card is
  // big enough to read instead of five squeezed across.
  const riser = new THREE.Mesh(new THREE.BoxGeometry(1, STEP, 0.07), wood)
  const ledge2 = ledge.clone()
  const lip2 = lip.clone()
  group.add(ledge, lip, riser, ledge2, lip2)
  let layout: 'wide' | 'narrow' = 'wide'
  /** Card size and where card i of n stands (its centre's x, the step it stands on, and how far back). */
  const slots = (n: number) => {
    if (layout === 'narrow' && n > 3) {
      const k = 1.22, gap = GAP * k * 1.1, front = n - 3
      return { k, rows: 2, at: (i: number) => (i < 3 ? { x: (i - 1) * gap, y: STEP, z: -BACK } : { x: (i - 3 - (front - 1) / 2) * gap, y: 0, z: 0 }) }
    }
    // One row, as large as fits about a metre (a little under the gap between the vase and the fruit bowl).
    const k = layout === 'narrow' ? 1.3 : Math.min(1.22, 1.0 / (Math.max(n, 3) * GAP))
    return { k, rows: 1, at: (i: number) => ({ x: (i - (n - 1) / 2) * GAP * k, y: 0, z: 0 }) }
  }
  const build = () => {
    const n = cards.length
    const { k, rows } = slots(n)
    const row = (count: number) => (Math.max(count, rows === 2 ? 1 : 3) * GAP * k + 0.03) / (5 * GAP + 0.03)
    ledge.scale.x = lip.scale.x = row(rows === 2 ? n - 3 : n)
    ledge.scale.z = lip.scale.z = k
    for (const o of [riser, ledge2, lip2]) o.visible = rows === 2
    ledge2.scale.x = lip2.scale.x = row(3)
    riser.scale.x = row(3) * (5 * GAP + 0.03)
    ledge2.scale.z = lip2.scale.z = k
    riser.position.set(0, STEP / 2, -BACK)
    ledge2.position.set(0, STEP + 0.009, -BACK)
    lip2.position.set(0, STEP + 0.015, -BACK + 0.024 * k)
    lip.position.z = 0.024 * k
  }
  group.traverse((n) => { n.castShadow = n.receiveShadow = true })
  const shelf = document.createElement('div')
  shelf.className = 'vs-rack'
  shelf.setAttribute('role', 'group')
  shelf.setAttribute('aria-label', 'Personality patterns')
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(shelf)
  // A just-saved pattern drops into the rack with a stitched tag that says so.
  const savedTag = document.createElement('div')
  savedTag.className = 'vs-saved vs-tag'
  savedTag.setAttribute('aria-hidden', 'true')
  savedTag.textContent = 'saved'
  document.body.append(savedTag)
  let saved: { id: string; at: number } | null = null

  let cards: { card: RackCard; felt: string; mesh: THREE.Mesh; button: HTMLButtonElement; plain: THREE.Texture; named: THREE.Texture; y: number }[] = []
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
      shown.forEach((card, i) => {
        const felt = feltFor(i)
        const plain = paintCard(felt), named = paintCard(felt, card.template.name)
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.004), new THREE.MeshStandardMaterial({ map: mode === 'on' ? plain : named, roughness: 0.95 }))
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
        cards.push({ card, felt, mesh, button, plain, named, y: 0 })
      })
      build()
      if (picked && !cards.some((c) => c.card.template.id === picked!.template.id)) api.pick(null)
      else api.pick(picked)
    },
    pick(card: RackCard | null, notify = true) {
      picked = card
      const { k, at } = slots(cards.length)
      // While a villager is on the mat (off), the cards lie down in the ledge, out of its way; the one it was made from
      // and a just-saved one stand at the rack's right end, their names painted on, clear of the fruit bowl.
      const standing = cards.filter((c) => c.card.template.id === card?.template.id || c.card.template.id === saved?.id)
      for (const c of cards) {
        const on = c.card.template.id === card?.template.id
        // The picked card stands up out of the rack, a little bigger, facing you; the others sit back.
        const stands = mode === 'off' && standing.includes(c)
        const down = mode === 'off' && !stands
        // Standing cards (while a villager is on the mat) take the last places: the right end of the (front) row.
        const slot = at(stands ? cards.length - standing.length + standing.indexOf(c) : cards.indexOf(c))
        c.mesh.position.x = slot.x
        c.y = slot.y + (down ? 0.02 : (H * k) / 2 + 0.014 + (on ? 0.045 : 0))
        c.mesh.position.y = c.y
        c.mesh.position.z = slot.z + (on || stands ? 0.03 : down ? -0.05 : 0)
        c.mesh.rotation.x = on || stands ? -0.08 : down ? -1.45 : -0.28
        c.mesh.scale.setScalar(k * (on ? 1.12 : 1))
        const m = c.mesh.material as THREE.MeshStandardMaterial
        m.emissive.set('#ffcf8a')
        m.emissiveIntensity = on ? 0.18 : 0
        m.color.setScalar(card && !on ? 0.82 : 1)
        c.button.setAttribute('aria-pressed', String(on))
        c.button.classList.toggle('on', on)
      }
      if (notify) onPick(card)
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
      const { k, rows } = slots(cards.length)
      return (rows === 2 ? 3 : Math.max(cards.length, 3)) * GAP * k
    },
    arrange(next: 'wide' | 'narrow') {
      layout = next
      // A phone's two-step stand reaches back to the table's far edge.
      group.position.set(MAT.x, TOP, layout === 'wide' ? -0.285 : -0.21)
      build()
      api.pick(picked, false)
    },
    enable(next: 'on' | 'quiet' | 'off') {
      const was = mode
      mode = next
      // Back to choosing: the saved card is one of the rack's now.
      if (next !== 'off') saved = null
      if ((was === 'off') !== (next === 'off')) api.pick(picked, false)
      shelf.classList.toggle('shown', next === 'on')
      shelf.classList.toggle('quiet', next === 'quiet')
      for (const c of cards) {
        c.button.tabIndex = next === 'on' ? 0 : -1
        const m = c.mesh.material as THREE.MeshStandardMaterial
        // Quiet (the mat is busy) shows the names painted on, with nothing to pick.
        const map = next === 'on' ? c.plain : c.named
        if (m.map !== map) {
          m.map = map
          m.needsUpdate = true
        }
      }
    },
    /** A pattern just saved: it drops into the rack (standing at its end while a villager is on the mat) with a "saved" tag. */
    saved(id: string) {
      saved = { id, at: performance.now() }
      api.pick(picked, false)
    },
    /** The lowest card's bottom edge on screen, so the slip can lie clear of the rack (0 when no names show). */
    bottom: 0,
    frame() {
      const fresh = saved && cards.find((c) => c.card.template.id === saved!.id)
      if (fresh) {
        // Down from above the rack, landing with a small bounce.
        const u = Math.min(1, (performance.now() - saved!.at) / (reducedMotion.matches ? 1 : 700))
        const fall = u < 0.75 ? (1 - u / 0.75) ** 2 : 0
        const bounce = u >= 0.75 ? Math.sin(((u - 0.75) / 0.25) * Math.PI) * 0.012 : 0
        fresh.mesh.position.y = fresh.y + fall * 0.32 + bounce
        fresh.mesh.updateMatrixWorld()
        const r = stage.renderer.domElement.getBoundingClientRect()
        corner.set(0, H / 2, 0).applyMatrix4(fresh.mesh.matrixWorld).project(stage.camera)
        const at = `calc(${Math.round(r.left + ((corner.x + 1) / 2) * r.width)}px - 50%) calc(${Math.round(r.top + ((1 - corner.y) / 2) * r.height)}px - 100% - 6px)`
        if (savedTag.style.translate !== at) savedTag.style.translate = at
        savedTag.classList.toggle('shown', u >= 0.75)
      } else savedTag.classList.remove('shown')
      if (mode !== 'on') {
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
    state: () => ({ cards: cards.map((c) => ({ id: c.card.template.id, name: c.card.template.name, source: c.card.source, humour: (c.card.template.persona.humour as { lean?: string } | undefined)?.lean ?? null })), picked: picked?.template.id ?? null }),
    dispose() {
      clear()
      shelf.remove()
      savedTag.remove()
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
  .vs-pattern:hover { box-shadow: 0 0 0 2px rgba(255, 236, 200, 0.9); }
  .vs-pattern.on, .vs-pattern:focus-visible { outline: none; box-shadow: 0 0 0 3px #fffaf0, 0 0 0 5px rgba(47, 74, 107, 0.8); }
  .vs-pattern.on::after { content: ''; position: absolute; inset: 3px; border: 1.6px dashed rgba(47, 74, 107, 0.75); border-radius: 3px; }
  .vs-saved { position: fixed; z-index: 5; left: 0; top: 0; padding: 3px 10px 4px; font-size: 15px; color: #3f6a35; rotate: -3deg; pointer-events: none;
    opacity: 0; transition: opacity 200ms ease; }
  .vs-saved::after { content: ''; position: absolute; inset: 3px; border: 1.5px dashed rgba(63, 106, 53, 0.6); border-radius: 3px 7px 7px 3px; }
  .vs-saved.shown { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .vs-pattern, .vs-saved { transition: none; } }
  `
}
