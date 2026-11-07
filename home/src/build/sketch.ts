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
 * The turn ring: a thin chalk circle drawn twice by hand, with a notch every 15°
 * (a longer one every 90°) so a turn reads as steps. White, tinted by the material.
 */
export function paintRing() {
  const S = 512, R = 236
  const [c, g] = canvas(S, S)
  const r = rng(31)
  g.lineCap = 'round'
  g.strokeStyle = '#ffffff'
  for (let pass = 0; pass < 2; pass++) {
    g.globalAlpha = pass ? 0.45 : 0.9
    g.lineWidth = pass ? 3 : 5
    g.beginPath()
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2 + pass * 0.03
      const rr = R - 6 + Math.sin(a * 3 + pass) * 1.6 + (r() - 0.5) * 1.2 - pass * 3
      const [x, y] = [S / 2 + Math.cos(a) * rr, S / 2 + Math.sin(a) * rr]
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    }
    g.stroke()
  }
  g.globalAlpha = 0.85
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const long = i % 6 === 0
    g.lineWidth = long ? 5 : 3.5
    const r0 = R - (long ? 30 : 20), r1 = R - 10
    g.beginPath()
    g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0)
    g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1)
    g.stroke()
  }
  return toTexture(c)
}

/** A hung thing's spot on the floor: a faint dotted chalk circle with a cross at its middle. */
export function paintDrop() {
  const S = 256
  const [c, g] = canvas(S, S)
  g.strokeStyle = '#ffffff'
  g.lineCap = 'round'
  g.lineWidth = 6
  g.setLineDash([2, 16])
  g.globalAlpha = 0.9
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2)
  g.stroke()
  g.setLineDash([])
  g.lineWidth = 4
  g.globalAlpha = 0.7
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    g.beginPath()
    g.moveTo(S / 2 - dx * 16, S / 2 - dy * 16)
    g.lineTo(S / 2 + dx * 16, S / 2 + dy * 16)
    g.stroke()
  }
  return toTexture(c)
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
export function drawKnob(g: CanvasRenderingContext2D, x: number, y: number, r: number, live: boolean) {
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
    cursor: not-allowed; opacity: 0.7; text-decoration: line-through rgba(166, 60, 44, 0.55) 1.5px; }
  ${commit}:not(${off}):hover, ${leave}:hover { translate: 0 -1px; }
  ${commit}:focus-visible, ${leave}:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; }
  `
}
