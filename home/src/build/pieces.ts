// The first pieces of a new room (#48), built in code from soft rounded parts: a living
// room's sofa, armchair, low table, floor lamp and braided rugs; a playroom's play tent,
// little table and stools, and toy chest; a study's desk and chair; a bedroom's bed and
// side table; and, for any of them, a low bookcase and a potted plant. They are kinds
// (plan.ts ItemRef), so a room keeps them as plan furniture and placing draws them.
// Each faces +z, the way mount.ts's floor anchor turns a thing by its yaw, and stands on
// a soft contact shadow kept inside its own footprint.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { canvas, paintBraid, paintFabric, toTexture } from '../paint'
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

/** The soft shadow a thing casts on the floor right under it, painted once. */
let blob: HTMLCanvasElement | null = null
function contact(g: THREE.Group, w: number, d: number, strength = 0.42) {
  if (!blob) {
    const [c, x] = canvas(128, 128)
    x.filter = 'blur(9px)'
    x.fillStyle = 'rgba(48, 28, 14, 1)'
    x.beginPath()
    x.roundRect(20, 20, 88, 88, 26)
    x.fill()
    blob = c
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: toTexture(blob), transparent: true, opacity: strength, depthWrite: false, fog: false }))
  m.rotation.x = -Math.PI / 2
  m.position.y = 0.004
  m.renderOrder = 1
  m.userData.contact = true
  g.add(m)
}

/** A deep sage sofa: two seat cushions, a back of two pillows, rolled arms, pine feet. */
const sofa: Build = () => {
  const g = new THREE.Group()
  const cover = felt([138, 160, 128], 31)
  const pine = wood('#b98a5a')
  contact(g, 1.78, 0.82)
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
  contact(g, 0.78, 0.76)
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
  contact(g, 0.94, 0.5, 0.3)
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
  contact(g, 0.38, 0.38, 0.3)
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

/** A big braided rug, 2.8 × 2 m, to sit or play on. */
const bigRug: Build = () => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.008, 80), new THREE.MeshStandardMaterial({ map: paintBraid(9), roughness: 1 }))
  m.scale.set(1.4, 1, 1)
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  return g
}

/** A low pine bookcase, two shelves of books and a little jar on top. */
const lowBookcase: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#c4935e')
  contact(g, 0.98, 0.3)
  for (const x of [-0.48, 0.48]) soft(g, pine, 0.03, 0.7, 0.3, x, 0, 0, 0.008)
  for (const y of [0.02, 0.34, 0.67]) soft(g, pine, 0.99, 0.03, 0.3, 0, y, 0, 0.008)
  soft(g, pine, 0.96, 0.66, 0.015, 0, 0.03, -0.14, 0.004)
  const spines = ['#9a4a3a', '#3f6b5a', '#d9b26a', '#5a6f8f', '#b56a4a', '#7d8f5e', '#e2d3b4']
  for (const [row, y] of [[0, 0.05], [1, 0.37]] as const) {
    let x = -0.42
    for (let i = 0; x < 0.36; i++) {
      const w = 0.035 + ((i * 7 + row * 3) % 4) * 0.012, h = 0.2 + ((i * 5 + row) % 3) * 0.035
      soft(g, new THREE.MeshStandardMaterial({ color: spines[(i + row * 3) % spines.length], roughness: 0.8 }), w, h, 0.2, x + w / 2, y, 0.01, 0.006)
      x += w + 0.006
    }
  }
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 18), new THREE.MeshStandardMaterial({ color: '#d47a4a', roughness: 0.6 }))
  jar.position.set(0.28, 0.77, 0)
  g.add(jar)
  return g
}

/** A potted plant: a terracotta pot and a fan of broad leaves. */
const pottedPlant: Build = () => {
  const g = new THREE.Group()
  contact(g, 0.42, 0.42, 0.36)
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.32, 22), new THREE.MeshStandardMaterial({ color: '#c46a45', roughness: 0.85 }))
  pot.position.y = 0.16
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 22), new THREE.MeshStandardMaterial({ color: '#4a3324', roughness: 1 }))
  soil.position.y = 0.31
  g.add(pot, soil)
  const leaf = new THREE.SphereGeometry(1, 12, 8)
  const greens = ['#5f8a4a', '#6f9a52', '#557f44']
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, tilt = 0.35 + (i % 3) * 0.18
    const l = new THREE.Mesh(leaf, new THREE.MeshStandardMaterial({ color: greens[i % 3], roughness: 0.7 }))
    l.scale.set(0.07, 0.3, 0.025)
    l.position.set(Math.sin(a) * 0.12, 0.6 + (i % 3) * 0.06, Math.cos(a) * 0.12)
    l.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt, 'XYZ')
    g.add(l)
  }
  return g
}

/** A felt play tent: four poles crossed at the top, a soft cover with its door flap tied back. */
const playTent: Build = () => {
  const g = new THREE.Group()
  contact(g, 1.04, 1.04, 0.32)
  const cover = new THREE.MeshStandardMaterial({ map: paintFabric(44, [236, 214, 178], 'stripes', [214, 132, 96]), roughness: 0.95, side: THREE.DoubleSide })
  // Three closed sides and an open front: a four-sided cone with one face left out.
  const cone = new THREE.ConeGeometry(0.62, 1.35, 4, 1, true, Math.PI / 4, (Math.PI * 3) / 2)
  const m = new THREE.Mesh(cone, cover)
  m.position.y = 0.675
  m.castShadow = true
  g.add(m)
  const pine = wood('#b98a5a')
  const up = new THREE.Vector3(0, 1, 0)
  for (let i = 0; i < 4; i++) {
    // From the cover's corner on the floor, through the top, crossing a hand's width past it.
    const a = Math.PI / 4 + (i * Math.PI) / 2
    const foot = new THREE.Vector3(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6), tip = new THREE.Vector3(-Math.sin(a) * 0.07, 1.5, -Math.cos(a) * 0.07)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, foot.distanceTo(tip), 8), pine)
    pole.position.copy(foot).add(tip).multiplyScalar(0.5)
    pole.quaternion.setFromUnitVectors(up, tip.clone().sub(foot).normalize())
    g.add(pole)
  }
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 24), new THREE.MeshStandardMaterial({ color: '#8fa678', roughness: 1 }))
  cushion.position.set(0, 0.04, 0.02)
  g.add(cushion)
  return g
}

/** A little round play table with two stools and a few blocks on top. */
const playTable: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#d2a46c')
  contact(g, 1.26, 0.66, 0.34)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 32), pine)
  top.position.y = 0.46
  g.add(top)
  legs(g, pine, 0.36, 0.36, 0.44)
  const seat = (x: number, color: string) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }))
    s.position.set(x, 0.28, 0)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.26, 10), pine)
    leg.position.set(x, 0.13, 0)
    g.add(s, leg)
  }
  seat(-0.48, '#d9875c')
  seat(0.48, '#7fa0b8')
  const block = new THREE.BoxGeometry(0.06, 0.06, 0.06)
  for (const [x, z, y, c] of [[-0.08, 0.04, 0.51, '#c2412f'], [0.04, -0.06, 0.51, '#e3b54a'], [0.0, -0.02, 0.57, '#5a8fb0'], [0.14, 0.08, 0.51, '#6f9a52']] as const) {
    const b = new THREE.Mesh(block, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
    b.position.set(x, y, z)
    b.rotation.y = x * 4
    g.add(b)
  }
  return g
}

/** A painted toy chest with a rounded lid, a teddy's ear peeking over. */
const toyChest: Build = () => {
  const g = new THREE.Group()
  contact(g, 0.8, 0.44)
  const paint = new THREE.MeshStandardMaterial({ color: '#8fae9a', roughness: 0.75 })
  soft(g, paint, 0.82, 0.4, 0.46, 0, 0, 0, 0.03)
  soft(g, new THREE.MeshStandardMaterial({ color: '#e7d2a8', roughness: 0.7 }), 0.86, 0.06, 0.5, 0, 0.4, 0, 0.03)
  soft(g, wood('#b98a5a'), 0.16, 0.04, 0.03, 0, 0.26, 0.235, 0.01)
  const fur = new THREE.MeshStandardMaterial({ color: '#b07a4e', roughness: 1 })
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), fur)
  head.position.set(0.2, 0.55, -0.04)
  const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), fur)
  ear.position.set(0.12, 0.64, -0.04)
  const ear2 = ear.clone()
  ear2.position.set(0.28, 0.64, -0.04)
  g.add(head, ear, ear2)
  return g
}

/** A pine writing desk with a drawer, a lamp and a book, and its chair tucked in. */
const desk: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#c2905a')
  contact(g, 1.18, 0.98, 0.36)
  soft(g, pine, 1.2, 0.04, 0.6, 0, 0.72, -0.18, 0.012)
  legs(g, pine, 1.1, 0.5, 0.72)
  for (const c of g.children.slice(-4)) c.position.z -= 0.18
  soft(g, pine, 0.4, 0.12, 0.5, 0.34, 0.58, -0.18, 0.01)
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 18, 1, true), new THREE.MeshStandardMaterial({ color: '#e9c46a', emissive: '#ffc98a', emissiveIntensity: 0.4, roughness: 0.6, side: THREE.DoubleSide }))
  lamp.position.set(-0.42, 1.06, -0.32)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.5 }))
  stem.position.set(-0.42, 0.9, -0.32)
  g.add(lamp, stem)
  soft(g, new THREE.MeshStandardMaterial({ color: '#2f5446', roughness: 0.8 }), 0.24, 0.03, 0.3, 0.05, 0.76, -0.16, 0.006)
  // The chair, pulled up to it.
  const cover = felt([196, 112, 79], 33)
  soft(g, pine, 0.44, 0.05, 0.42, 0, 0.44, 0.24, 0.015)
  soft(g, cover, 0.4, 0.05, 0.38, 0, 0.49, 0.24, 0.02)
  soft(g, pine, 0.44, 0.4, 0.04, 0, 0.49, 0.43, 0.015)
  for (const [x, z] of [[-0.19, 0.06], [0.19, 0.06], [-0.19, 0.42], [0.19, 0.42]]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.44, 8), pine)
    l.position.set(x, 0.22, z)
    g.add(l)
  }
  return g
}

/** A double bed: a pine frame and headboard, a striped duvet folded back, two pillows. */
const bed: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#c4935e')
  contact(g, 1.56, 2.06)
  soft(g, pine, 1.6, 0.28, 2.08, 0, 0.06, 0, 0.03)
  legs(g, pine, 1.5, 1.98, 0.08)
  soft(g, pine, 1.6, 0.96, 0.07, 0, 0.06, -1.0, 0.035)
  soft(g, new THREE.MeshStandardMaterial({ color: '#f4ecdf', roughness: 0.95 }), 1.5, 0.18, 1.96, 0, 0.32, 0.02, 0.07)
  soft(g, new THREE.MeshStandardMaterial({ map: paintFabric(52, [214, 196, 220], 'stripes', [150, 120, 170]), roughness: 0.95 }), 1.54, 0.1, 1.3, 0, 0.44, 0.34, 0.05)
  for (const x of [-0.38, 0.38]) soft(g, new THREE.MeshStandardMaterial({ color: '#fbf5ea', roughness: 0.95 }), 0.6, 0.14, 0.36, x, 0.48, -0.74, 0.07)
  return g
}

/** A round side table on three legs, with a little lamp. */
const sideTable: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#c99a62')
  contact(g, 0.46, 0.46, 0.34)
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.035, 28), pine)
  top.position.y = 0.55
  g.add(top)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.55, 8), pine)
    l.position.set(Math.sin(a) * 0.15, 0.275, Math.cos(a) * 0.15)
    g.add(l)
  }
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.14, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#f6e6c8', emissive: '#ffc98a', emissiveIntensity: 0.5, roughness: 0.9, side: THREE.DoubleSide }))
  shade.position.set(0, 0.8, 0)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 16), new THREE.MeshStandardMaterial({ color: '#d47a4a', roughness: 0.6 }))
  base.position.set(0, 0.65, 0)
  g.add(shade, base)
  return g
}

/** A new room's first pieces, as kinds (mount.ts KINDS). */
export const LIVING: Record<string, { mount: Mount; label: string; build: Build }> = {
  sofa: { mount: 'floor', label: 'sofa', build: sofa },
  armchair: { mount: 'floor', label: 'armchair', build: armchair },
  'low-table': { mount: 'floor', label: 'low table', build: lowTable },
  'floor-lamp': { mount: 'floor', label: 'floor lamp', build: floorLamp },
  rug: { mount: 'floor', label: 'braided rug', build: rug },
  'big-rug': { mount: 'floor', label: 'big braided rug', build: bigRug },
  'low-bookcase': { mount: 'floor', label: 'low bookcase', build: lowBookcase },
  'potted-plant': { mount: 'floor', label: 'potted plant', build: pottedPlant },
  'play-tent': { mount: 'floor', label: 'play tent', build: playTent },
  'play-table': { mount: 'floor', label: 'little table and stools', build: playTable },
  'toy-chest': { mount: 'floor', label: 'toy chest', build: toyChest },
  desk: { mount: 'floor', label: 'desk and chair', build: desk },
  bed: { mount: 'floor', label: 'bed', build: bed },
  'side-table': { mount: 'floor', label: 'side table', build: sideTable },
}
