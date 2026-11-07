// Build mode's one drawing language (#48), shared by placing things (place.ts) and
// sketching a room (outline.ts): chalk and pencil on paper, painted in code.
//
// - A thing or wall that is only proposed is a see-through ghost with a thin chalk rim.
// - Where it can't go, the rim and the footprint turn chalk red; the thing keeps its colours.
// - What you can grab is a cream knob ringed in pencil.
// - Choices sit on one kind of paper tag: a cream card, a filled pill to commit, an outline pill to let go.
import * as THREE from 'three/webgpu'
import { normalLocal, positionLocal } from 'three/tsl'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvas, makeNoise, rng, toTexture } from '../paint'

export const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
export const CHALK = '#fff4dc'
export const CHALK_RED = '#d2543f'
export const PENCIL = 'rgba(74, 50, 34, 0.92)'

// ── The ghost's chalk rim: an inverted hull drawn after the ghost ─────────────

/**
 * A rim for a mesh: its own shape pushed out along smoothed normals, back faces only.
 * Drawn after the see-through ghost with the depth test on, the ghost's own depth hides
 * it inside the silhouette, so only the edge shows.
 */
export function rimOf(mesh: THREE.Mesh, width: number, material: THREE.Material): THREE.Mesh {
  const g = mesh.geometry
  // Smoothed normals so a box's corners close instead of splitting apart.
  const shape = new THREE.BufferGeometry()
  shape.setAttribute('position', g.attributes.position)
  if (g.index) shape.setIndex(g.index)
  const merged = mergeVertices(shape, 1e-4)
  merged.computeVertexNormals()
  shape.dispose()
  const rim = new THREE.Mesh(merged, material)
  rim.name = 'placement rim'
  rim.userData.width = width
  rim.renderOrder = 3
  rim.raycast = () => {}
  return rim
}

/** The rim's material: one per look (chalk or red), its push measured in the mesh's own units. */
export function rimMaterial(color: string, opacity: number, push: number) {
  const m = new THREE.MeshBasicNodeMaterial({ color, transparent: true, opacity, side: THREE.BackSide, depthWrite: false, fog: false })
  m.positionNode = positionLocal.add(normalLocal.mul(push))
  return m
}

// ── Painted pieces ─────────────────────────────────────────────────────────

/** A soft shadow where a held thing would touch: dark at the middle, gone at the edge. */
export function paintShadow() {
  const [c, g] = canvas(256, 256)
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 124)
  grad.addColorStop(0, 'rgba(58, 32, 16, 0.55)')
  grad.addColorStop(0.45, 'rgba(58, 32, 16, 0.32)')
  grad.addColorStop(1, 'rgba(58, 32, 16, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  return toTexture(c)
}

/** Where it can't go: a soft red wash with a chalk-red dashed edge, drawn on the footprint. */
export function paintNoGo() {
  const [c, g] = canvas(256, 256)
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128)
  grad.addColorStop(0, 'rgba(214, 86, 64, 0.34)')
  grad.addColorStop(0.75, 'rgba(214, 86, 64, 0.22)')
  grad.addColorStop(1, 'rgba(214, 86, 64, 0.05)')
  g.fillStyle = grad
  g.beginPath()
  g.roundRect(18, 18, 220, 220, 40)
  g.fill()
  g.setLineDash([18, 14])
  g.lineCap = 'round'
  g.lineWidth = 7
  g.strokeStyle = 'rgba(206, 78, 58, 0.9)'
  g.beginPath()
  g.roundRect(20, 20, 216, 216, 38)
  g.stroke()
  return toTexture(c)
}

/**
 * The turn ring: a cream band edged in pencil, laid on the floor with a soft shadow, with a
 * notch at each quarter so a turn reads. White-cream, tinted by the material (red where it can't go).
 */
export function paintRing() {
  const S = 512, R = 226
  const [c, g] = canvas(S, S)
  const r = rng(31)
  const loop = (rr: number, wob: number) => {
    g.beginPath()
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2
      const q = rr + Math.sin(a * 3) * wob + (r() - 0.5) * wob * 0.6
      const [x, y] = [S / 2 + Math.cos(a) * q, S / 2 + Math.sin(a) * q]
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.closePath()
  }
  // Shadow, a little down and soft.
  g.save()
  g.filter = 'blur(6px)'
  g.translate(3, 6)
  g.lineWidth = 22
  g.strokeStyle = 'rgba(60, 32, 14, 0.38)'
  loop(R, 1)
  g.stroke()
  g.restore()
  // The band: cream, edged in brown pencil on both sides.
  g.lineWidth = 18
  g.strokeStyle = 'rgb(250, 238, 214)'
  loop(R, 1.2)
  g.stroke()
  g.lineWidth = 3.5
  g.strokeStyle = 'rgba(116, 76, 50, 0.95)'
  loop(R + 9, 1.4)
  g.stroke()
  g.lineWidth = 2.5
  loop(R - 9, 1.4)
  g.stroke()
  // Quarter notches across the band.
  g.lineCap = 'round'
  g.lineWidth = 4
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    g.beginPath()
    g.moveTo(S / 2 + Math.cos(a) * (R - 8), S / 2 + Math.sin(a) * (R - 8))
    g.lineTo(S / 2 + Math.cos(a) * (R + 8), S / 2 + Math.sin(a) * (R + 8))
    g.stroke()
  }
  return toTexture(c)
}

/** A thread of dots, repeated down a hung thing's drop line. */
export function paintDots() {
  const [c, g] = canvas(16, 64)
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(8, 16, 6, 0, Math.PI * 2)
  g.fill()
  const t = toTexture(c, { repeat: [1, 1] })
  return t
}

/** A hung thing's spot on the floor: a warm pool of its light with a dotted chalk circle round it. */
export function paintDrop() {
  const S = 256
  const [c, g] = canvas(S, S)
  const pool = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  pool.addColorStop(0, 'rgba(255, 214, 150, 0.75)')
  pool.addColorStop(0.55, 'rgba(255, 206, 140, 0.35)')
  pool.addColorStop(1, 'rgba(255, 200, 130, 0)')
  g.fillStyle = pool
  g.fillRect(0, 0, S, S)
  g.strokeStyle = 'rgba(122, 82, 54, 0.85)'
  g.lineCap = 'round'
  g.lineWidth = 5
  g.setLineDash([1, 13])
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 26, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  return toTexture(c)
}

/** Turned earth for a plot being staked out: warm soil, crumbs and a few pebbles. Tiles. */
export function paintSoil(size: number) {
  const [c, g] = canvas(size, size)
  const n = makeNoise(17, 32)
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = n((x / size) * 32, (y / size) * 32, 4) * 0.7 + n((x / size) * 128 % 32, (y / size) * 128 % 32, 2) * 0.3
    const i = (y * size + x) * 4
    img.data[i] = 104 + v * 58
    img.data[i + 1] = 74 + v * 42
    img.data[i + 2] = 50 + v * 30
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const r = rng(23)
  for (let i = 0; i < 70; i++) {
    const x = r() * size, y = r() * size, rr = 1.5 + r() * 3.5
    g.fillStyle = r() > 0.5 ? 'rgba(205, 190, 170, 0.9)' : 'rgba(96, 70, 48, 0.55)'
    g.beginPath()
    g.ellipse(x, y, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2)
    g.fill()
  }
  return c
}

/** Tracing-paper grain: long soft fibres and a fine tooth, for multiplying over the paper. */
export function paperGrain(size: number) {
  const [c, g] = canvas(size, size)
  const n = makeNoise(5, 64)
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cloud = n(x / 90, y / 90, 4)
    const tooth = n(x / 2.2, y / 2.2, 2)
    const v = 255 - (cloud * 46 + tooth * 34)
    const i = (y * size + x) * 4
    img.data[i] = v
    img.data[i + 1] = v - 4
    img.data[i + 2] = v - 10
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const r = rng(9)
  g.lineCap = 'round'
  for (let i = 0; i < 260; i++) {
    const x = r() * size, y = r() * size, a = r() * Math.PI, l = 10 + r() * 50
    g.strokeStyle = r() > 0.5 ? 'rgba(120, 96, 70, 0.10)' : 'rgba(255, 255, 255, 0.22)'
    g.lineWidth = 0.8 + r() * 1.2
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 8, y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 8, x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  return c
}

/** A grip drawn on paper: a cream knob ringed in pencil, with a soft shadow; warmer while held or hovered. */
export function drawKnob(g: CanvasRenderingContext2D, x: number, y: number, r: number, live: boolean, grip?: { angle: number; both: boolean }) {
  g.save()
  g.filter = `blur(${Math.max(1, r * 0.25)}px)`
  g.fillStyle = 'rgba(60, 32, 14, 0.35)'
  g.beginPath()
  g.arc(x + r * 0.18, y + r * 0.28, r * 1.02, 0, Math.PI * 2)
  g.fill()
  g.restore()
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  // Darker than it looks: the scene's exposure and bloom lift it to cream.
  g.fillStyle = live ? '#c98c4c' : '#b79a74'
  g.fill()
  g.lineWidth = r * 0.16
  g.strokeStyle = 'rgba(70, 44, 28, 0.95)'
  g.stroke()
  g.setLineDash([r * 0.22, r * 0.2])
  g.lineWidth = r * 0.07
  g.strokeStyle = 'rgba(150, 110, 80, 0.6)'
  g.beginPath()
  g.arc(x, y, r * 0.66, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  if (!grip) return
  // Which way it moves: a small double arrow (or one way) pressed into the knob.
  g.save()
  g.translate(x, y)
  g.rotate(grip.angle)
  g.strokeStyle = 'rgba(62, 38, 24, 0.95)'
  g.lineWidth = r * 0.14
  g.lineCap = g.lineJoin = 'round'
  const a = r * 0.5, h = r * 0.24
  g.beginPath()
  g.moveTo(grip.both ? -a : -a * 0.3, 0)
  g.lineTo(a, 0)
  g.moveTo(a - h, -h)
  g.lineTo(a, 0)
  g.lineTo(a - h, h)
  if (grip.both) {
    g.moveTo(-a + h, -h)
    g.lineTo(-a, 0)
    g.lineTo(-a + h, h)
  }
  g.stroke()
  g.restore()
}

/** A strip of washi tape holding the paper down: translucent, striped, its ends torn. */
export function drawTape(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number, hue: string) {
  g.save()
  g.translate(x, y)
  g.rotate(angle)
  g.beginPath()
  const r = rng(Math.round(x * 7 + y * 13))
  g.moveTo(-w / 2, -h / 2)
  g.lineTo(w / 2, -h / 2)
  for (let i = 1; i <= 6; i++) g.lineTo(w / 2 + (r() - 0.5) * h * 0.18, -h / 2 + (h * i) / 6)
  g.lineTo(-w / 2, h / 2)
  for (let i = 5; i >= 0; i--) g.lineTo(-w / 2 + (r() - 0.5) * h * 0.18, -h / 2 + (h * i) / 6)
  g.closePath()
  g.fillStyle = hue
  g.globalAlpha = 0.78
  g.fill()
  g.clip()
  g.globalAlpha = 0.25
  g.fillStyle = '#ffffff'
  for (let s = -w; s < w; s += h * 0.45) g.fillRect(s, -h / 2, h * 0.18, h)
  g.restore()
}

/** A carpenter's pencil lying on the paper: flat red body, bare wood at the sharpened end, a graphite point. */
export function drawPencil(g: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number) {
  const w = len * 0.085
  g.save()
  g.translate(x, y)
  g.rotate(angle)
  g.save()
  g.filter = `blur(${Math.max(1, w * 0.35)}px)`
  g.fillStyle = 'rgba(50, 28, 12, 0.35)'
  g.fillRect(-len / 2 + w * 0.3, -w / 2 + w * 0.5, len, w)
  g.restore()
  const body = len * 0.8
  g.fillStyle = '#b5452e'
  g.fillRect(-len / 2, -w / 2, body, w)
  g.fillStyle = 'rgba(255, 220, 200, 0.35)'
  g.fillRect(-len / 2, -w / 2, body, w * 0.28)
  g.fillStyle = '#e2bf8c'
  g.beginPath()
  g.moveTo(-len / 2 + body, -w / 2)
  g.lineTo(len / 2 - w * 0.4, -w * 0.12)
  g.lineTo(len / 2 - w * 0.4, w * 0.12)
  g.lineTo(-len / 2 + body, w / 2)
  g.closePath()
  g.fill()
  g.fillStyle = '#3a3330'
  g.fillRect(len / 2 - w * 0.55, -w * 0.12, w * 0.55, w * 0.24)
  g.font = `700 ${w * 0.55}px sans-serif`
  g.fillStyle = 'rgba(255, 236, 200, 0.7)'
  g.fillText('VILLAGE', -len / 2 + w, w * 0.2)
  g.restore()
}

/** A cloth tape measure laid along a run: mustard, inked every 10 cm, a longer mark every half metre. */
export function drawTapeMeasure(g: CanvasRenderingContext2D, a: [number, number], b: [number, number], width: number, perMetre: number) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  g.save()
  g.translate(a[0], a[1])
  g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]))
  g.save()
  g.filter = `blur(${Math.max(1, width * 0.2)}px)`
  g.fillStyle = 'rgba(60, 34, 14, 0.3)'
  g.fillRect(width * 0.1, -width / 2 + width * 0.25, L, width)
  g.restore()
  g.fillStyle = '#dcae52'
  g.fillRect(0, -width / 2, L, width)
  g.fillStyle = 'rgba(255, 246, 220, 0.3)'
  g.fillRect(0, -width / 2, L, width * 0.3)
  g.strokeStyle = 'rgba(52, 34, 20, 0.85)'
  g.lineCap = 'butt'
  const step = perMetre / 10
  for (let i = 0, d = 0; d <= L + 0.5; i++, d = i * step) {
    const long = i % 5 === 0
    g.lineWidth = long ? width * 0.09 : width * 0.06
    g.beginPath()
    g.moveTo(d, -width / 2)
    g.lineTo(d, -width / 2 + width * (long ? 0.5 : 0.28))
    g.stroke()
  }
  // Brass ends.
  g.fillStyle = '#9c7a3c'
  g.fillRect(-width * 0.12, -width / 2, width * 0.22, width)
  g.fillRect(L - width * 0.1, -width / 2, width * 0.22, width)
  g.restore()
}

// ── The paper tag both features use ─────────────────────────────────────────

/**
 * Card and pill styles for a tag. `card` is the tag's selector, `commit` and `leave`
 * its two buttons; `off` marks the commit button while it is unavailable. On a phone
 * the tag docks to the bottom, in reach of a thumb.
 */
export function tagCss(card: string, commit: string, leave: string, off: string) {
  return `
  ${card} { background: radial-gradient(130% 100% at 15% 0%, #fffaf0 0%, #fbf3e2 55%, #f4e6cb 100%); color: #4a3428; border-radius: 14px;
    box-shadow: 0 12px 26px rgba(70, 40, 20, 0.22), 0 2px 0 rgba(255, 255, 255, 0.7) inset; font-family: ${HAND}; }
  ${card}::before { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 110, 80, 0.35); border-radius: 10px; pointer-events: none; }
  ${commit}, ${leave} { position: relative; z-index: 1; min-height: 44px; min-width: 44px; padding: 0 18px 2px; border-radius: 22px; font: 700 17px ${HAND};
    cursor: pointer; transition: translate 120ms ease, background 160ms ease, opacity 160ms ease; }
  ${leave} { border: 1.5px solid rgba(122, 82, 54, 0.45); background: transparent; color: #5b3d2b; }
  ${commit} { border: 1.5px solid #6a4630; background: #7a5236; color: #fff6e6; box-shadow: 0 2px 0 rgba(60, 34, 18, 0.35); }
  ${commit}${off} { background: transparent; border: 1.5px dashed rgba(122, 82, 54, 0.5); color: rgba(91, 61, 43, 0.55); box-shadow: none;
    cursor: not-allowed; opacity: 0.75; }
  ${commit}${off}::before { content: '✕'; margin-right: 6px; color: #b8432f; font: 700 15px ui-rounded, system-ui, sans-serif; text-decoration: none; display: inline-block; }
  ${commit}:not(${off}):hover, ${leave}:hover { translate: 0 -1px; }
  ${commit}:focus-visible, ${leave}:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; }
  `
}
