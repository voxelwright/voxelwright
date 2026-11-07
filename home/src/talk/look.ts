// The talk looks tried in the #42 regroup (ui-craft, "Plateau: regroup"), behind ?talk=npc&look=:
//   a  paper in the world: the pad held in perspective, a sent line folds into a note and
//      flies, replies are paper slips standing in the room beside their speaker, lit by it.
//   b  cinematic staging: an eye-level close-up with shallow depth of field, the table cuts
//      to whoever speaks, replies are inked comic balloons of one width.
//   c  no interface: no cards, tags or buttons; one felt caption strip says who speaks and what,
//      and the pad appears only while you write.
// Without ?look= the current look. Nothing here runs without ?talk=npc.
// The speech cards stay in the page in every look (the checks and the layout read them);
// a look only changes how they are drawn.
import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'
import { releaseGpu, type Stage } from '../kernel'
import { canvas, rng, toTexture } from '../paint'

export type Look = 'a' | 'b' | 'c' | null
const query = new URLSearchParams(location.search)
const asked = query.get('look')
export const LOOK: Look = query.get('talk') === 'npc' && (asked === 'a' || asked === 'b' || asked === 'c') ? asked : null

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'

/** Look b's depth of field: talk.ts sets where the focus is and how much, postfx reads them. */
export const focus = { distance: uniform(3), amount: uniform(0) }

/** What a look needs to know of a card's speaker. */
export interface Speaker { head: THREE.Vector3; colour: string; name: string }

// ── a: paper slips in the room ─────────────────────────────────────────────
interface Slip {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  c: HTMLCanvasElement
  g: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  key: string
  fade: number
  tilt: number
  seed: number
}
/** Room around the paper for its tab, in CSS pixels. */
const TAB = 16
const SCALE = 2

/**
 * Each villager's card drawn as a paper slip standing in the room at its speaker's depth,
 * where the card would be on screen and as big: lit by the room, a little crooked, with a
 * paper tab toward the speaker and its name on a strip of tape in the speaker's colour.
 */
export function paperSlips(stage: Stage, speaker: (person: string) => Speaker | null) {
  const { scene, camera } = stage
  const group = new THREE.Group()
  group.name = 'talk paper slips'
  scene.add(group)
  const slips = new Map<string, Slip>()
  const geometry = new THREE.PlaneGeometry(1, 1)
  const make = (person: string): Slip => {
    const [c, g] = canvas(64, 64)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    // Drawn over the room, so a chair or the lamp in front never cuts the words, and unlit at a level
    // under the bloom threshold, so the lamp over the table never bleaches them (round 1: the slip of
    // whoever was speaking under the pendant was the faintest thing on screen).
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.8, 0.75, 0.65), transparent: true, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.name = `talk slip ${person}`
    mesh.renderOrder = 6
    mesh.visible = false
    group.add(mesh)
    const seed = [...person].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 997
    const slip = { mesh, mat, c, g, tex, key: '', fade: 0, tilt: (rng(seed)() - 0.5) * 0.06, seed }
    slips.set(person, slip)
    return slip
  }

  const wrap = (g: CanvasRenderingContext2D, s: string, width: number) => {
    const out: string[] = []
    let line = ''
    for (const word of s.split(/(\s+)/)) {
      if (g.measureText(line + word).width > width && line.trim()) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line += word
    }
    if (line.trim()) out.push(line)
    return out
  }

  const paint = (slip: Slip, el: HTMLElement, who: Speaker, w: number, h: number) => {
    const W = (w + TAB * 2) * SCALE, H = (h + TAB * 2) * SCALE
    if (slip.c.width !== W || slip.c.height !== H) {
      slip.c.width = W
      slip.c.height = H
      // A new size needs a new GPU texture.
      slip.tex.dispose()
      slip.tex = new THREE.CanvasTexture(slip.c)
      slip.tex.colorSpace = THREE.SRGBColorSpace
      slip.tex.anisotropy = 4
      slip.mat.map = slip.tex
      slip.mat.needsUpdate = true
    }
    const g = slip.g
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
    g.clearRect(0, 0, w + TAB * 2, h + TAB * 2)
    const said = el.classList.contains('said')
    const beat = el.classList.contains('beat')
    const tail = el.dataset.tail ?? 'down'
    const at = parseFloat(el.style.getPropertyValue('--tail')) || (tail === 'down' ? w / 2 : 40)
    const r = rng(slip.seed)
    // The paper: a torn, slightly uneven sheet with a cut tab toward the speaker.
    const x0 = TAB, y0 = TAB, x1 = TAB + w, y1 = TAB + h
    const jag = () => (r() - 0.5) * 2.2
    g.beginPath()
    g.moveTo(x0 + 3, y0)
    for (let x = x0 + 14; x < x1 - 6; x += 14) g.lineTo(x, y0 + jag())
    g.lineTo(x1, y0 + 3)
    if (tail === 'right') {
      g.lineTo(x1 + jag(), y0 + at - 10)
      g.lineTo(x1 + TAB - 2, y0 + at + 2)
      g.lineTo(x1 + jag(), y0 + at + 8)
    }
    g.lineTo(x1 + jag(), y1 - 3)
    g.lineTo(x1 - 3, y1)
    if (tail === 'down') {
      g.lineTo(x0 + at + 9, y1 + jag())
      g.lineTo(x0 + at - 3, y1 + TAB - 2)
      g.lineTo(x0 + at - 10, y1 + jag())
    }
    for (let x = x1 - 14; x > x0 + 6; x -= 14) g.lineTo(x, y1 + jag())
    g.lineTo(x0 + 3, y1)
    if (tail === 'left') {
      g.lineTo(x0 + jag(), y0 + at + 8)
      g.lineTo(x0 - TAB + 2, y0 + at + 2)
      g.lineTo(x0 + jag(), y0 + at - 10)
    }
    g.lineTo(x0, y0 + 3)
    g.closePath()
    const fill = g.createLinearGradient(x0, y0, x1, y1)
    fill.addColorStop(0, said ? '#f6eedd' : '#fffaf0')
    fill.addColorStop(1, said ? '#eadcc0' : '#f3e5c8')
    g.fillStyle = fill
    g.fill()
    g.save()
    g.clip()
    for (let i = 0; i < (w * h) / 90; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(150,110,60,0.08)'
      g.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 6, 0.6)
    }
    // A soft crease across the middle, as a folded slip has.
    g.strokeStyle = 'rgba(150, 110, 60, 0.12)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x0, y0 + h * 0.52)
    g.lineTo(x1, y0 + h * 0.48)
    g.stroke()
    g.restore()
    g.strokeStyle = 'rgba(120, 85, 50, 0.35)'
    g.lineWidth = 0.8
    g.stroke()
    // The name on a strip of tape in the speaker's colour, stuck across the top left.
    g.save()
    g.translate(x0 + 12, y0 - 9)
    g.rotate(-0.035 + slip.tilt)
    const th = said ? 24 : 29
    g.font = `700 ${said ? 17 : 21}px ${HAND}`
    const nw = g.measureText(who.name).width + 26
    // Tape in the speaker's colour, a shade deeper so its light letters stand out.
    g.fillStyle = who.colour
    g.fillRect(0, 0, nw, th)
    g.fillStyle = 'rgba(30, 14, 4, 0.22)'
    g.fillRect(0, 0, nw, th)
    g.fillStyle = 'rgba(255, 248, 236, 0.16)'
    for (let x = 2; x < nw; x += 5) g.fillRect(x, 0, 1.2, th)
    // Torn tape ends.
    g.fillStyle = 'rgba(255, 248, 236, 0.0)'
    g.globalCompositeOperation = 'destination-out'
    for (let y = 0; y < th; y += 4) {
      g.fillRect(0, y, 1 + r() * 2, 2)
      g.fillRect(nw - 1 - r() * 2, y, 3, 2)
    }
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#fffaf0'
    g.textBaseline = 'middle'
    g.fillText(who.name, 13, th / 2 + 1)
    g.restore()
    // The words, in ink, where the card has them.
    const words = el.querySelector('.said')?.textContent ?? ''
    const px = said ? 16 : 19
    g.font = `${beat ? 'italic ' : ''}${px}px ${BOOK}`
    g.fillStyle = said ? '#5a4434' : '#24170f'
    g.textBaseline = 'alphabetic'
    let lines = wrap(g, words, w - 44)
    if (said && lines.length > 3) lines = [...lines.slice(0, 2), lines[2].replace(/\s*\S*$/, '') + ' …']
    const lead = px * 1.42
    lines.forEach((l, i) => g.fillText(l, x0 + 22, y0 + 24 + px + i * lead))
    // Still talking: three ink dots after the last word.
    const cue = el.querySelector('.cue') as HTMLElement | null
    if (cue && !cue.hidden && !said) {
      const last = lines.at(-1) ?? ''
      const cx = x0 + 22 + g.measureText(last).width + 10, cy = y0 + 24 + px + (Math.max(1, lines.length) - 1) * lead - 5
      g.fillStyle = who.colour
      for (let i = 0; i < 3; i++) {
        g.beginPath()
        g.arc(cx + i * 9, cy, 2.6, 0, Math.PI * 2)
        g.fill()
      }
    }
    slip.tex.needsUpdate = true
  }

  const ray = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const eye = new THREE.Vector3()
  const frame = (dt: number) => {
    camera.getWorldPosition(eye)
    camera.getWorldDirection(fwd)
    const fovY = THREE.MathUtils.degToRad(camera.fov)
    for (const el of document.querySelectorAll<HTMLElement>('.talk-card')) {
      const person = el.dataset.talkCard
      if (!person) continue
      const slip = slips.get(person) ?? make(person)
      const shown = el.classList.contains('shown')
      slip.fade += ((shown ? 1 : 0) - slip.fade) * (1 - Math.exp(-dt * 12))
      const who = speaker(person)
      if (slip.fade < 0.01 || !who) {
        slip.mesh.visible = false
        continue
      }
      const w = el.offsetWidth, h = el.offsetHeight
      const words = el.querySelector('.said')?.textContent ?? ''
      const cue = (el.querySelector('.cue') as HTMLElement | null)?.hidden
      const key = [w, h, words, cue, el.className, el.dataset.tail, el.style.getPropertyValue('--tail')].join('|')
      if (key !== slip.key) {
        slip.key = key
        paint(slip, el, who, w, h)
      }
      // Where the card is on screen, at the speaker's depth, as big as the card.
      const m = /(-?[\d.]+)px (-?[\d.]+)px/.exec(el.style.translate)
      if (!m) continue
      const cx = parseFloat(m[1]) + w / 2, cy = parseFloat(m[2]) + h / 2
      const depth = Math.max(0.4, ray.copy(who.head).sub(eye).dot(fwd) - 0.12)
      const ndcX = (cx / innerWidth) * 2 - 1, ndcY = 1 - (cy / innerHeight) * 2
      ray.set(ndcX, ndcY, 0.5).unproject(camera).sub(eye).normalize()
      const along = depth / Math.max(0.2, ray.dot(fwd))
      slip.mesh.position.copy(eye).addScaledVector(ray, along)
      const perPx = (2 * depth * Math.tan(fovY / 2)) / innerHeight
      slip.mesh.scale.set((w + TAB * 2) * perPx, (h + TAB * 2) * perPx, 1)
      slip.mesh.quaternion.copy(camera.quaternion)
      slip.mesh.rotateZ(slip.tilt)
      // Turned a little toward its speaker, so it stands in the room rather than on the glass.
      const toward = el.dataset.tail === 'left' ? -1 : el.dataset.tail === 'right' ? 1 : 0
      slip.mesh.rotateY(toward * 0.32)
      // Held, not pasted on the glass: it sways a hair, and settles as it appears.
      slip.mesh.rotateX((1 - slip.fade) * 0.5)
      // Whoever speaks now is full strength; what was said before steps back.
      slip.mat.opacity = slip.fade * (el.classList.contains('said') ? 0.68 : 1)
      slip.mesh.visible = true
    }
  }
  const dispose = () => {
    group.removeFromParent()
    for (const s of slips.values()) s.tex.dispose()
    releaseGpu(group)
  }
  return { frame, dispose }
}

/** Look a's "something for you" over a villager: a small folded note with a wax seal, not a felt "!". */
export function paperNote() {
  const [c, g] = canvas(128, 128)
  g.translate(64, 66)
  g.rotate(-0.12)
  g.shadowColor = 'rgba(60, 30, 10, 0.35)'
  g.shadowBlur = 6
  g.shadowOffsetY = 3
  g.fillStyle = '#fbf3e1'
  g.beginPath()
  g.roundRect(-48, -34, 96, 68, 4)
  g.fill()
  g.shadowColor = 'transparent'
  // The flap's folds and the paper's edge.
  g.strokeStyle = 'rgba(140, 100, 60, 0.5)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(-46, -32)
  g.lineTo(0, 6)
  g.lineTo(46, -32)
  g.stroke()
  g.strokeStyle = 'rgba(140, 100, 60, 0.3)'
  g.beginPath()
  g.moveTo(-46, 32)
  g.lineTo(-10, 0)
  g.moveTo(46, 32)
  g.lineTo(10, 0)
  g.stroke()
  // A wax seal where the folds meet.
  g.fillStyle = '#b8402e'
  g.beginPath()
  g.arc(0, 6, 13, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(255, 220, 190, 0.45)'
  g.beginPath()
  g.arc(-4, 2, 4, 0, Math.PI * 2)
  g.fill()
  return toTexture(c)
}

// ── c: one felt caption strip ──────────────────────────────────────────────
/** The words of whoever is speaking now, on a felt strip at the bottom of the view, in their colour. */
export function captionStrip() {
  const el = document.createElement('div')
  el.className = 'talk-caption'
  el.setAttribute('aria-hidden', 'true')
  const name = document.createElement('b')
  const words = document.createElement('span')
  el.append(name, words)
  document.body.append(el)
  let current: HTMLElement | null = null
  let since = 0
  const frame = (dt: number, writing: boolean) => {
    const cards = [...document.querySelectorAll<HTMLElement>('.talk-card.shown:not(.said)')]
    const card = cards.at(-1) ?? null
    if (card !== current) {
      current = card
      since = 0
    }
    since += dt
    if (card) {
      const tag = card.querySelector('.nametag b')?.textContent ?? ''
      el.style.setProperty('--c', card.style.getPropertyValue('--c'))
      if (name.textContent !== tag) name.textContent = tag
      const text = card.querySelector('.said')?.textContent ?? ''
      if (words.textContent !== text) words.textContent = text
      el.classList.toggle('beat', card.classList.contains('beat'))
    }
    el.classList.toggle('shown', Boolean(card && words.textContent) && !writing)
  }
  return { frame, dispose: () => el.remove() }
}

/** The styles each look adds; the cards' own styles live in talk.ts. */
export function lookCss(look: Look) {
  if (look === 'a') return `
  body.look-a .talk-card { opacity: 0 !important; }
  body.look-a .talk-tag:not(.hover) { display: none; }
  body.look-a .babble-toggle, body.look-a .music-note { opacity: 0.55; }
  @media (max-width: 600px) { body.look-a .babble-toggle, body.look-a .music-note { top: 14px; bottom: auto; } }
  `
  if (look === 'b') return `
  body.look-b .talk-card { width: 340px; min-width: 340px; max-width: min(340px, calc(100vw - 32px)); border-radius: 48% 52% 46% 54% / 56% 50% 50% 44%;
    padding: 26px 34px 24px; background: #fffdf6; box-shadow: 0 0 0 2.6px #2b1d14, 0 0 0 5px rgba(255, 252, 244, 0.9), 0 10px 22px rgba(30, 18, 8, 0.28); }
  body.look-b .talk-card::before { display: none; }
  body.look-b .talk-card::after { background: #fffdf6; width: 22px; height: 26px; border-radius: 0 0 4px 0; box-shadow: 2.6px 2.6px 0 #2b1d14; }
  body.look-b .talk-card[data-tail='left']::after, body.look-b .talk-card[data-tail='right']::after { background: #fffdf6; box-shadow: none; outline: 2.6px solid #2b1d14; clip-path: polygon(0 0, 100% 100%, 0 100%); }
  body.look-b .talk-card .words { font: 700 19px/1.38 ${HAND}; color: #21160f; text-align: center; letter-spacing: 0.01em; }
  body.look-b .talk-card .tab { left: 50%; top: -14px; translate: -50% 0; }
  body.look-b .talk-card .nametag { border-radius: 4px; padding: 2px 10px 3px; box-shadow: 0 0 0 2px #2b1d14; }
  body.look-b .talk-card .nametag::after { display: none; }
  body.look-b .talk-card .nametag b { font: 700 15px/1.1 ${HAND}; letter-spacing: 0.06em; text-transform: uppercase; }
  body.look-b .talk-card.said { width: 260px; min-width: 260px; opacity: 0.82; box-shadow: 0 0 0 2px #5a4636, 0 6px 12px rgba(30, 18, 8, 0.18); }
  body.look-b .talk-card.said .words { font-size: 16px; color: #5a4636; }
  body.look-b .talk-tag { display: none; }
  body.look-b .babble-toggle, body.look-b .music-note { display: none; }
  body.look-b::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 3;
    box-shadow: inset 0 0 160px rgba(30, 14, 4, 0.32); opacity: 0; transition: opacity 600ms ease; }
  body.look-b.talk-close::after { opacity: 1; }
  `
  if (look === 'c') return `
  body.look-c .talk-card, body.look-c .talk-tag:not(.hover), body.look-c .talk-journal, body.look-c .babble-toggle, body.look-c .music-note,
  body.look-c .talk-pad { opacity: 0 !important; pointer-events: none !important; }
  .talk-caption { position: fixed; z-index: 4; left: 50%; bottom: 34px; translate: -50% 12px; width: min(760px, calc(100vw - 28px)); box-sizing: border-box;
    display: flex; gap: 14px; align-items: baseline; padding: 16px 26px 18px; border-radius: 6px 10px 7px 9px;
    background: color-mix(in oklab, var(--c, #8a6a48) 78%, #2a1608);
    background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.2px), radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1.2px);
    background-size: 5px 5px, 7px 7px; background-position: 0 0, 2px 3px;
    box-shadow: 0 10px 24px rgba(40, 20, 8, 0.3), inset 0 -3px 0 rgba(0, 0, 0, 0.14);
    color: #fff8ec; opacity: 0; pointer-events: none; transition: opacity 260ms ease, translate 300ms cubic-bezier(.2, 1.3, .4, 1); }
  .talk-caption::before { content: ''; position: absolute; inset: 6px; border: 2px dashed rgba(255, 244, 222, 0.55); border-radius: 4px 7px 5px 6px; }
  .talk-caption.shown { opacity: 1; translate: -50% 0; }
  .talk-caption b { flex: none; font: 700 22px/1.2 ${HAND}; color: #fff3da; }
  .talk-caption b::after { content: ':'; }
  .talk-caption span { font: 21px/1.4 ${BOOK}; text-shadow: 0 1px 1px rgba(30, 14, 4, 0.4); }
  .talk-caption.beat span { font-style: italic; opacity: 0.9; }
  @media (max-width: 600px) { .talk-caption { bottom: 18px; padding: 12px 18px 14px; flex-direction: column; gap: 2px; } .talk-caption span { font-size: 18px; } }
  `
  return ''
}
