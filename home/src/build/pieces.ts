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
import { SEAT_Y } from '../villagers/world'
import type { Mount } from './plan'

/** How high a villager sits: talk.ts puts a 12 cm booster on a kitchen chair. Seats one settles on are cushioned up to it. */
export const VILLAGER_SEAT_Y = SEAT_Y + 0.12

/**
 * Where on a main piece a villager sits, in the piece's own frame (it faces +z): the seat's
 * middle, the way the sitter faces (a turn from +z), and the side it steps up from (-1 behind
 * the seat, as at a table or desk; 1 in front, as at a sofa or a bed's edge). Each is cushioned
 * to VILLAGER_SEAT_Y.
 */
export const SEATS: Record<string, Array<{ x: number; z: number; turn: number; from: -1 | 1 }>> = {
  'play-table': [{ x: -0.52, z: 0, turn: Math.PI / 2, from: -1 }, { x: 0.52, z: 0, turn: -Math.PI / 2, from: -1 }],
  sofa: [{ x: -0.38, z: 0.06, turn: 0, from: 1 }],
  desk: [{ x: 0, z: 0.24, turn: Math.PI, from: -1 }],
  bed: [{ x: 0.66, z: 0.45, turn: Math.PI / 2, from: 1 }],
}

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

/** A plump felt cushion from a seat's top up to where a villager sits, as talk.ts's boosters are. */
function booster(g: THREE.Group, color: string, x: number, z: number, from: number, w = 0.3, d = 0.3) {
  const h = Math.max(0.02, VILLAGER_SEAT_Y - from)
  soft(g, new THREE.MeshStandardMaterial({ color, roughness: 1 }), w, h, d, x, from, z, Math.min(0.06, h / 2))
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
  booster(g, '#e7c9a0', SEATS.sofa[0].x, SEATS.sofa[0].z, 0.48, 0.42, 0.4)
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

/** A low pine bookcase, two shelves of books, and on top a jar (or, in a playroom, a teddy, blocks and picture books). */
const shelf = (toys: boolean): Build => () => {
  const g = new THREE.Group()
  const pine = wood('#c4935e')
  contact(g, 0.98, 0.3)
  for (const x of [-0.48, 0.48]) soft(g, pine, 0.03, 0.7, 0.3, x, 0, 0, 0.008)
  for (const y of [0.02, 0.34, 0.67]) soft(g, pine, 0.99, 0.03, 0.3, 0, y, 0, 0.008)
  soft(g, pine, 0.96, 0.66, 0.015, 0, 0.03, -0.14, 0.004)
  const spines = ['#9a4a3a', '#3f6b5a', '#d9b26a', '#5a6f8f', '#b56a4a', '#7d8f5e', '#e2d3b4']
  const mat = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness })
  for (const [row, y] of [[0, 0.05], [1, 0.37]] as const) {
    // A playroom's bottom shelf holds two felt toy bins instead of books.
    if (toys && row === 0) {
      for (const [x, c] of [[-0.22, '#d9875c'], [0.22, '#8fae9a']] as const) soft(g, mat(c, 1), 0.4, 0.24, 0.26, x, y, 0.01, 0.03)
      continue
    }
    let x = -0.42
    for (let i = 0; x < 0.36; i++) {
      const w = 0.035 + ((i * 7 + row * 3) % 4) * 0.012, h = 0.2 + ((i * 5 + row) % 3) * 0.035
      soft(g, mat(spines[(i + row * 3) % spines.length]), w, h, 0.2, x + w / 2, y, 0.01, 0.006)
      x += w + 0.006
    }
  }
  if (!toys) {
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 18), mat('#d47a4a', 0.6))
    jar.position.set(0.28, 0.77, 0)
    g.add(jar)
    soft(g, mat('#3f6b5a'), 0.26, 0.04, 0.2, -0.22, 0.685, 0, 0.008)
    soft(g, mat('#d9b26a'), 0.22, 0.035, 0.17, -0.2, 0.725, 0.01, 0.008)
    return g
  }
  // On top: a teddy sitting up, a stack of blocks and two picture books flat.
  const fur = mat('#b07a4e', 1)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), fur)
  body.scale.set(1, 1.1, 0.9)
  body.position.set(0.26, 0.78, 0)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), fur)
  head.position.set(0.26, 0.91, 0.01)
  g.add(body, head)
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), fur)
    ear.position.set(0.26 + sx * 0.05, 0.97, 0)
    g.add(ear)
  }
  const block = new THREE.BoxGeometry(0.07, 0.07, 0.07)
  for (const [x, y, c] of [[-0.05, 0.72, '#c2412f'], [0.03, 0.72, '#e3b54a'], [-0.01, 0.79, '#5a8fb0']] as const) {
    const b = new THREE.Mesh(block, mat(c, 0.6))
    b.position.set(x, y, 0)
    b.rotation.y = x * 5
    g.add(b)
  }
  soft(g, mat('#5a6f8f'), 0.24, 0.03, 0.22, -0.3, 0.685, 0, 0.008)
  soft(g, mat('#e3b54a'), 0.2, 0.03, 0.18, -0.29, 0.715, 0.01, 0.008)
  return g
}
const lowBookcase = shelf(false)
const toyShelf = shelf(true)

/**
 * A playroom's wall at child height: felt bunting along a cord, two crayon drawings taped up under
 * it, and a low ledge of picture books turned face out. Hung with its middle at about 1.1 m.
 */
const playWall: Build = () => {
  const g = new THREE.Group()
  const W = 1.5
  // The cord sags a little between its two pins; the flags hang from it.
  const sag = (x: number) => 1.78 - 0.07 * (1 - (2 * x / W) ** 2)
  const cord = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => new THREE.Vector3(-W / 2 + (i / 8) * W, sag(-W / 2 + (i / 8) * W), 0.02))), 24, 0.005, 5),
    new THREE.MeshStandardMaterial({ color: '#f4ecdf', roughness: 1 }),
  )
  g.add(cord)
  const flag = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.075, 0), new THREE.Vector2(0.075, 0), new THREE.Vector2(0, -0.15)]))
  const colours = ['#d9703a', '#e3b54a', '#8fae9a', '#7fa0b8', '#c9a6c8', '#d9703a', '#e3b54a']
  colours.forEach((c, i) => {
    const x = -W / 2 + ((i + 0.5) / colours.length) * W
    const f = new THREE.Mesh(flag, new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }))
    f.position.set(x, sag(x), 0.022)
    f.rotation.z = -(x / W) * 0.18
    g.add(f)
  })
  // Two drawings on paper, a strip of tape at the top of each.
  const drawing = (seed: number) => {
    const [c, x] = canvas(160, 200)
    x.fillStyle = '#fbf6ea'
    x.fillRect(0, 0, 160, 200)
    x.lineCap = 'round'
    x.lineWidth = 7
    if (seed === 0) {
      x.strokeStyle = '#e3b54a'
      x.beginPath(); x.arc(118, 46, 22, 0, Math.PI * 2); x.stroke()
      x.strokeStyle = '#c2412f'
      x.beginPath(); x.moveTo(30, 120); x.lineTo(75, 78); x.lineTo(120, 120); x.closePath(); x.stroke()
      x.strokeStyle = '#5a8fb0'
      x.strokeRect(40, 120, 70, 54)
      x.strokeStyle = '#6f9a52'
      x.beginPath(); x.moveTo(8, 186); x.lineTo(152, 182); x.stroke()
    } else {
      x.strokeStyle = '#6f9a52'
      x.beginPath(); x.moveTo(80, 186); x.lineTo(80, 96); x.stroke()
      for (const [px, py, col] of [[80, 70, '#d9703a'], [52, 92, '#c9a6c8'], [108, 92, '#e3b54a']] as const) {
        x.fillStyle = col
        x.beginPath(); x.arc(px, py, 22, 0, Math.PI * 2); x.fill()
      }
      x.strokeStyle = '#7fa0b8'
      x.beginPath(); x.moveTo(10, 30); x.quadraticCurveTo(80, 0, 150, 30); x.stroke()
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.375), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.95 }))
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), new THREE.MeshStandardMaterial({ color: '#f2cf6b', roughness: 1, transparent: true, opacity: 0.85 }))
    tape.position.set(0, 0.18, 0.002)
    const d = new THREE.Group()
    d.add(m, tape)
    return d
  }
  for (const [i, x, y, r] of [[0, -0.3, 1.32, 0.05], [1, 0.32, 1.3, -0.04]] as const) {
    const d = drawing(i)
    d.position.set(x, y, 0.01)
    d.rotation.z = r
    g.add(d)
  }
  // The ledge: a pine lip at child height with picture books standing face out.
  const pine = wood('#c4935e')
  soft(g, pine, 1.1, 0.025, 0.12, 0, 0.42, 0.06, 0.008)
  soft(g, pine, 1.1, 0.06, 0.018, 0, 0.42, 0.115, 0.006)
  const covers = ['#5a8fb0', '#d9703a', '#8fae9a', '#e3b54a']
  covers.forEach((c, i) => {
    const b = soft(g, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), 0.2, 0.24, 0.02, -0.39 + i * 0.26, 0.445, 0.07, 0.008, -0.12)
    b.rotation.z = (i % 2 ? 1 : -1) * 0.03
  })
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

/** A round craft table with two felt-topped stools, blocks and a crayon pot on top, at a villager's sitting height. */
const playTable: Build = () => {
  const g = new THREE.Group()
  const pine = wood('#d2a46c')
  contact(g, 1.4, 0.72, 0.34)
  const H = VILLAGER_SEAT_Y + 0.1
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 36), pine)
  top.position.y = H - 0.02
  g.add(top)
  legs(g, pine, 0.4, 0.4, H - 0.04)
  for (const [i, { x }] of SEATS['play-table'].entries()) {
    const color = i ? '#7fa0b8' : '#d9875c'
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.035, 28), pine)
    s.position.set(x, VILLAGER_SEAT_Y - 0.075, 0)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, VILLAGER_SEAT_Y - 0.09, 12), pine)
    leg.position.set(x, (VILLAGER_SEAT_Y - 0.09) / 2, 0)
    const foot = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 8, 24), pine)
    foot.rotation.x = Math.PI / 2
    foot.position.set(x, 0.2, 0)
    g.add(s, leg, foot)
    booster(g, color, x, 0, VILLAGER_SEAT_Y - 0.058, 0.3, 0.3)
  }
  const block = new THREE.BoxGeometry(0.06, 0.06, 0.06)
  for (const [x, z, y, c] of [[-0.12, 0.06, 0, '#c2412f'], [0.02, -0.08, 0, '#e3b54a'], [-0.03, -0.04, 0.06, '#5a8fb0'], [0.16, 0.1, 0, '#6f9a52']] as const) {
    const b = new THREE.Mesh(block, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
    b.position.set(x, H + 0.03 + y, z)
    b.rotation.y = x * 4
    g.add(b)
  }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.09, 16), new THREE.MeshStandardMaterial({ color: '#e6d6b8', roughness: 0.6 }))
  pot.position.set(0.12, H + 0.045, -0.16)
  g.add(pot)
  for (const [i, c] of ['#c2412f', '#5a8fb0', '#e3b54a'].entries()) {
    const crayon = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }))
    crayon.position.set(0.12 + (i - 1) * 0.015, H + 0.1, -0.16 + (i - 1) * 0.01)
    crayon.rotation.z = (i - 1) * 0.2
    g.add(crayon)
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
  booster(g, '#e7c9a0', SEATS.desk[0].x, SEATS.desk[0].z, 0.54, 0.34, 0.32)
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
  // A folded throw on the edge, where a villager sits.
  booster(g, '#c9a6c8', SEATS.bed[0].x - 0.06, SEATS.bed[0].z, 0.54, 0.34, 0.42)
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
  'toy-shelf': { mount: 'floor', label: 'toy shelf', build: toyShelf },
  'play-wall': { mount: 'wall', label: 'bunting and drawings', build: playWall },
  'potted-plant': { mount: 'floor', label: 'potted plant', build: pottedPlant },
  'play-tent': { mount: 'floor', label: 'play tent', build: playTent },
  'play-table': { mount: 'floor', label: 'little table and stools', build: playTable },
  'toy-chest': { mount: 'floor', label: 'toy chest', build: toyChest },
  desk: { mount: 'floor', label: 'desk and chair', build: desk },
  bed: { mount: 'floor', label: 'bed', build: bed },
  'side-table': { mount: 'floor', label: 'side table', build: sideTable },
}
