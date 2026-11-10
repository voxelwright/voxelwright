// What the lawn is covered with, as a map anything can draw on. The yard says where the
// lawn is; the house, the stepping stones and the flower beds say where grass does not
// grow; the grass reads the result on the GPU, so the lawn follows the lot as it grows.
import * as THREE from 'three/webgpu'

type P = [number, number]
/** A bare patch: a closed outline, or a disc. Its edge is painted soft, so grass thins towards it. */
export type Bare = { ring: P[] } | { at: P; radius: number }

const SIZE = 512
const canvas = document.createElement('canvas')
canvas.width = canvas.height = SIZE
const g = canvas.getContext('2d')!
let map: THREE.CanvasTexture | null = null
let lawn: P[] = []
const bare = new Map<string, Bare[]>()
/** The square of ground the map covers, in world metres: x0, z0 and its side. */
export const extent = { x0: -16, z0: -20, side: 44 }
let dirty = true
let version = 0
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The lawn's outline (world x, z). */
export function setLawn(outline: P[]): void {
  // Callers say it again whenever they redraw; only a real change repaints.
  if (same(outline, lawn)) return
  lawn = outline
  dirty = true
}

/** Name a set of bare patches (replacing the set of that name); an empty list clears it. */
export function setBare(name: string, patches: Bare[]): void {
  if (same(patches, bare.get(name) ?? [])) return
  if (patches.length) bare.set(name, patches)
  else bare.delete(name)
  dirty = true
}

/** Changes each time the cover is repainted, for readers that keep their own copy. */
export const coverVersion = () => version

function paint() {
  dirty = false
  version++
  // Fit the map round the lawn with room to spare, on whole metres so it rarely moves.
  if (lawn.length) {
    const xs = lawn.map((p) => p[0]), zs = lawn.map((p) => p[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
    const side = Math.ceil(Math.max(x1 - x0, z1 - z0) / 4) * 4 + 4
    extent.side = side
    extent.x0 = Math.floor((x0 + x1) / 2 - side / 2)
    extent.z0 = Math.floor((z0 + z1) / 2 - side / 2)
  }
  const k = SIZE / extent.side
  const px = ([x, z]: P): P => [(x - extent.x0) * k, (z - extent.z0) * k]
  const trace = (ring: P[]) => {
    g.beginPath()
    ring.forEach((p, i) => { const [x, y] = px(p); i ? g.lineTo(x, y) : g.moveTo(x, y) })
    g.closePath()
  }
  g.filter = 'none'
  g.fillStyle = '#000'
  g.fillRect(0, 0, SIZE, SIZE)
  if (!lawn.length) return
  g.fillStyle = '#fff'
  trace(lawn)
  g.fill()
  // Bare patches with a soft edge, so the grass shortens towards a wall or a stone instead of stopping dead.
  g.filter = `blur(${(0.12 * k).toFixed(1)}px)`
  g.fillStyle = '#000'
  for (const patches of bare.values()) for (const b of patches) {
    if ('ring' in b) trace(b.ring)
    else {
      const [x, y] = px(b.at)
      g.beginPath()
      g.arc(x, y, b.radius * k, 0, Math.PI * 2)
    }
    g.fill()
  }
  g.filter = 'none'
}

/** The cover map: white where grass grows. Repainted here when something changed; call once a frame. */
export function cover(): THREE.CanvasTexture {
  if (!map) {
    map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.NoColorSpace
    map.generateMipmaps = false
    // Row 0 of the canvas is z0: read as painted, not turned over, so the shader and the tuft scatter agree.
    map.flipY = false
    map.minFilter = map.magFilter = THREE.LinearFilter
  }
  if (dirty) {
    paint()
    map.needsUpdate = true
  }
  return map
}
