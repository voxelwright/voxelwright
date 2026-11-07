// The first pieces of a living room (#48): a sofa, an armchair, a low table, a floor
// lamp and a braided rug, built in code from soft rounded parts. They are kinds
// (plan.ts ItemRef), so a room keeps them as plan furniture and placing draws them.
// Each faces +z, the way mount.ts's floor anchor turns a thing by its yaw.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { paintBraid, paintFabric } from '../paint'
import type { Mount } from './plan'

type Build = () => THREE.Object3D

const felt = (base: [number, number, number], seed: number) =>
  new THREE.MeshStandardMaterial({ map: paintFabric(seed, base, 'velvet', base), roughness: 0.95 })
const wood = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 })

/** A soft box: w × h × d, its base at y. */
function soft(g: THREE.Group, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.05, tilt = 0) {
  const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m)
  b.position.set(x, y + h / 2, z)
  b.rotation.x = tilt
  g.add(b)
  return b
}

function legs(g: THREE.Group, m: THREE.Material, w: number, d: number, h: number) {
  const leg = new THREE.CylinderGeometry(0.022, 0.016, h, 10)
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
    const l = new THREE.Mesh(leg, m)
    l.position.set(x, h / 2, z)
    g.add(l)
  }
}

/** A deep sage sofa: two seat cushions, a back of two pillows, rolled arms, pine feet. */
const sofa: Build = () => {
  const g = new THREE.Group()
  const cover = felt([138, 160, 128], 31)
  const pine = wood('#b98a5a')
  legs(g, pine, 1.62, 0.66, 0.1)
  soft(g, cover, 1.8, 0.26, 0.84, 0, 0.1, 0, 0.06)
  for (const s of [-1, 1]) {
    soft(g, cover, 0.74, 0.14, 0.62, s * 0.38, 0.34, 0.07, 0.06)
    soft(g, cover, 0.76, 0.44, 0.2, s * 0.38, 0.4, -0.26, 0.08, -0.12)
    soft(g, cover, 0.16, 0.32, 0.84, s * 0.82, 0.32, 0, 0.07)
  }
  return g
}

/** A terracotta armchair, the kitchen's reading chair's cousin. */
const armchair: Build = () => {
  const g = new THREE.Group()
  const cover = felt([196, 112, 79], 32)
  const pine = wood('#b98a5a')
  legs(g, pine, 0.62, 0.6, 0.1)
  soft(g, cover, 0.8, 0.26, 0.78, 0, 0.1, 0, 0.06)
  soft(g, cover, 0.54, 0.13, 0.58, 0, 0.34, 0.07, 0.06)
  soft(g, cover, 0.58, 0.46, 0.2, 0, 0.38, -0.27, 0.08, -0.12)
  for (const s of [-1, 1]) soft(g, cover, 0.13, 0.3, 0.76, s * 0.335, 0.32, 0.01, 0.06)
  return g
}

/** A low pine table with a lower shelf, a book and a small bowl on top. */
const lowTable: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#c99a62')
  soft(g, pine, 0.96, 0.05, 0.52, 0, 0.35, 0, 0.02)
  soft(g, pine, 0.86, 0.025, 0.42, 0, 0.1, 0, 0.01)
  legs(g, pine, 0.84, 0.42, 0.36)
  soft(g, new THREE.MeshStandardMaterial({ color: '#2f5446', roughness: 0.8 }), 0.22, 0.035, 0.28, -0.22, 0.4, 0.02, 0.008)
  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.09, 0.04], [0.1, 0.06], [0.092, 0.062], [0.08, 0.042], [0, 0.012]].map(([u, v]) => new THREE.Vector2(u, v)), 24),
    new THREE.MeshStandardMaterial({ color: '#e6d6b8', roughness: 0.5, side: THREE.DoubleSide }),
  )
  bowl.position.set(0.22, 0.4, -0.02)
  g.add(bowl)
  return g
}

/** An iron floor lamp with a linen shade lit from inside. */
const floorLamp: Build = () => {
  const g = new THREE.Group()
  const iron = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.5, metalness: 0.2 })
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.36, 8), iron)
  pole.position.y = 0.7
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.025, 24), iron)
  foot.position.y = 0.0125
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, 0.26, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f6e6c8', emissive: '#ffc98a', emissiveIntensity: 0.55, roughness: 0.9, side: THREE.DoubleSide }),
  )
  shade.position.y = 1.47
  g.add(pole, foot, shade)
  return g
}

/** A braided oval rug, 2.2 × 1.5 m. Flat, so placing never counts it as in the way. */
const rug: Build = () => {
  // A disc a few millimetres thick, so it lies on the floor without fighting it.
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.008, 72), new THREE.MeshStandardMaterial({ map: paintBraid(6), roughness: 1 }))
  m.scale.set(1.1, 1, 0.75)
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  return g
}

/** The living room's first pieces, as kinds (mount.ts KINDS). */
export const LIVING: Record<string, { mount: Mount; label: string; build: Build }> = {
  sofa: { mount: 'floor', label: 'sofa', build: sofa },
  armchair: { mount: 'floor', label: 'armchair', build: armchair },
  'low-table': { mount: 'floor', label: 'low table', build: lowTable },
  'floor-lamp': { mount: 'floor', label: 'floor lamp', build: floorLamp },
  rug: { mount: 'floor', label: 'braided rug', build: rug },
}
