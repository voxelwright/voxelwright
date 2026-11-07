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
import { canvas, rng, toTexture } from '../paint'

export const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
export const CHALK = '#fff4dc'
export const CHALK_RED = '#d2543f'

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

/** What it bumps into, seen from above: a muted chalk-red dashed contour round its footprint, no fill. */
export function paintBlockOutline() {
  const [c, g] = canvas(256, 256)
  g.setLineDash([16, 12])
  g.lineCap = 'round'
  g.lineWidth = 6
  g.strokeStyle = 'rgba(196, 92, 70, 0.82)'
  g.beginPath()
  g.roundRect(10, 10, 236, 236, 26)
  g.stroke()
  return toTexture(c)
}

/** Where two things would meet: a small patch of chalk-red hatching with a soft edge. */
export function paintContact() {
  const [c, g] = canvas(128, 128)
  g.fillStyle = 'rgba(214, 96, 72, 0.22)'
  g.beginPath()
  g.roundRect(6, 6, 116, 116, 14)
  g.fill()
  g.clip()
  g.strokeStyle = 'rgba(190, 70, 50, 0.85)'
  g.lineWidth = 5
  g.lineCap = 'round'
  for (let s = -128; s < 256; s += 18) {
    g.beginPath()
    g.moveTo(s, 128)
    g.lineTo(s + 128, 0)
    g.stroke()
  }
  return toTexture(c)
}

/** Where a hung thing's cord meets the ceiling: a faint disc of the ceiling plane with a dotted pencil ring and a cross. */
export function paintCeilingMark() {
  const S = 256
  const [c, g] = canvas(S, S)
  const disc = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  disc.addColorStop(0, 'rgba(255, 246, 228, 0.75)')
  disc.addColorStop(0.6, 'rgba(255, 240, 214, 0.4)')
  disc.addColorStop(1, 'rgba(255, 236, 206, 0)')
  g.fillStyle = disc
  g.fillRect(0, 0, S, S)
  g.strokeStyle = 'rgba(122, 82, 54, 0.85)'
  g.lineCap = 'round'
  g.lineWidth = 5
  g.setLineDash([1, 12])
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 34, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  g.lineWidth = 4
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    g.beginPath()
    g.moveTo(S / 2 - dx * 30, S / 2 - dy * 30)
    g.lineTo(S / 2 + dx * 30, S / 2 + dy * 30)
    g.stroke()
  }
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
  ${leave} { border: 1.5px solid rgba(106, 70, 48, 0.75); background: rgba(255, 250, 240, 0.6); color: #4f3322; }
  ${commit} { border: 1.5px solid #6a4630; background: #7a5236; color: #fff6e6; box-shadow: 0 2px 0 rgba(60, 34, 18, 0.35); }
  ${commit}${off} { background: transparent; border: 1.5px dashed rgba(122, 82, 54, 0.5); color: rgba(91, 61, 43, 0.55); box-shadow: none;
    cursor: not-allowed; opacity: 0.75; }
  ${commit}${off}::before { content: '✕'; margin-right: 6px; color: #b8432f; font: 700 15px ui-rounded, system-ui, sans-serif; text-decoration: none; display: inline-block; }
  ${commit}:not(${off}):hover, ${leave}:hover { translate: 0 -1px; }
  ${commit}:focus-visible, ${leave}:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; }
  `
}
