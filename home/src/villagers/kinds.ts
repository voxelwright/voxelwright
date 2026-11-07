// Four art directions for villagers on one rig. Every texture is painted here in code.
// Each villager gets its own materials, so the entries glow lights only the one under the pointer.
import * as THREE from 'three/webgpu'
import { color, dot, float, materialEmissive, max, mix, normalView, positionLocal, positionViewDirection, pow, smoothstep, uniform } from 'three/tsl'
import { canvas, makeNoise, rng, toTexture } from '../paint'
import type { Figure, Villager } from './rig'

export interface Spec { name: string; bark: string }
/** Per-villager touches: `accent` is the owner's colour, worn as a scarf where the direction has one. */
export interface Look { accent?: string }
export interface Kind { title: string; specs: Spec[]; build(i: number, phys: boolean, look?: Look): Figure }

type Prop = 'spoon' | 'duster' | 'can' | 'letter' | 'pouch'

function part<T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T {
  o.position.set(x, y, z)
  o.traverse((n) => {
    n.castShadow = true
    n.receiveShadow = true
  })
  parent.add(o)
  return o
}
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) => new THREE.Mesh(geo, mat)
function skeleton(name: string) {
  const root = new THREE.Group()
  root.name = `villager ${name}`
  const pose = new THREE.Group()
  const head = new THREE.Group()
  root.add(pose)
  pose.add(head)
  return { root, pose, head }
}
function hand(pose: THREE.Object3D, o: THREE.Object3D, x: number, y: number, z: number) {
  part(pose, o, x, y, z)
  o.userData.rest = new THREE.Vector3(x, y, z)
  return o
}

/** A held prop, built from the villager's own materials. Its origin is the grip. */
function prop(kind: Prop, mat: (c: string, rough?: number) => THREE.Material, scale = 1): THREE.Group {
  const g = new THREE.Group()
  if (kind === 'spoon') {
    const wood = mat('#c8935a', 0.6)
    part(g, mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 8), wood), 0, 0.05, 0)
    const bowl = part(g, mesh(new THREE.SphereGeometry(0.03, 14, 10), wood), 0, 0.165, 0)
    bowl.scale.set(1, 1.3, 0.45)
  } else if (kind === 'duster') {
    part(g, mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 8), mat('#8a5a3a', 0.6)), 0, 0.06, 0)
    const tuft = ['#e9b8c8', '#f3d27a', '#a9cfe0', '#f0e6d8', '#c9a8d8', '#e9b8c8']
    tuft.forEach((c, i) => {
      const a = (i / tuft.length) * Math.PI * 2
      part(g, mesh(new THREE.SphereGeometry(0.03, 10, 8), mat(c, 1)), Math.cos(a) * 0.025, 0.19 + (i % 2) * 0.02, Math.sin(a) * 0.025)
    })
  } else if (kind === 'can') {
    const tin = mat('#7fa6b8', 0.45)
    part(g, mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.085, 18), tin), 0, -0.06, 0.03)
    const spout = part(g, mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.12, 8), tin), 0, -0.04, 0.1)
    spout.rotation.x = 1.0
    const rose = part(g, mesh(new THREE.CylinderGeometry(0.018, 0.01, 0.015, 10), tin), 0, 0.005, 0.148)
    rose.rotation.x = 1.0
    const handle = part(g, mesh(new THREE.TorusGeometry(0.035, 0.007, 8, 16, Math.PI), tin), 0, -0.02, 0.03)
    handle.rotation.y = Math.PI / 2
  } else if (kind === 'letter') {
    const env = part(g, mesh(new THREE.BoxGeometry(0.11, 0.075, 0.004), mat('#f4ead6', 0.9)), 0, 0.02, 0.02)
    env.rotation.z = 0.2
    part(env, mesh(new THREE.CircleGeometry(0.01, 12), mat('#b83a3a', 0.5)), 0, 0, 0.0025)
  } else {
    const bag = part(g, mesh(new THREE.SphereGeometry(0.045, 14, 10), mat('#c9a77a', 1)), 0, -0.05, 0.01)
    bag.scale.set(1, 1.15, 0.9)
    part(g, mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 14), mat('#7a5a3a', 1)), 0, -0.005, 0.01).rotation.x = Math.PI / 2
  }
  g.scale.setScalar(scale)
  return g
}

// ─── a: peg dolls ──────────────────────────────────────────────────────────

type RGB = [number, number, number]

function woodGrain(g: CanvasRenderingContext2D, w: number, h: number, seed: number, base: RGB, vertical = true) {
  const n = makeNoise(seed, 64)
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = vertical ? x : y, b = vertical ? y : x
      const rings = Math.sin(a * 0.35 + n(a / 40, b / 90, 3) * 9)
      const t = 0.9 + 0.08 * Math.pow(0.5 + 0.5 * rings, 3) + (n(a / 3, b / 30, 2) - 0.5) * 0.08
      const i = (y * w + x) * 4
      img.data[i] = base[0] * t
      img.data[i + 1] = base[1] * t
      img.data[i + 2] = base[2] * t
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
}
const BEECH: RGB = [226, 186, 138]

interface PegSpec extends Spec { bodyH: number; baseR: number; headR: number; dress: string; trim: string; hair: string; pattern: 'apron' | 'stripes' | 'flowers'; hat: 'kerchief' | 'pompom' | 'straw'; prop: Prop }
const PEGS: PegSpec[] = [
  { name: 'Bramble, the cook', bark: "Soup's on for Thursday. Shall I add bread to the list?", bodyH: 0.31, baseR: 0.145, headR: 0.1, dress: '#c8553d', trim: '#f4ead6', hair: '#5a3522', pattern: 'apron', hat: 'kerchief', prop: 'spoon' },
  { name: 'Pip, the tidier', bark: 'I found three socks and a crayon under the sofa.', bodyH: 0.42, baseR: 0.1, headR: 0.084, dress: '#e0a63a', trim: '#5b7fa6', hair: '#2a1e18', pattern: 'stripes', hat: 'pompom', prop: 'duster' },
  { name: 'Juniper, the gardener', bark: 'The basil on the sill is thirsty. I am on it.', bodyH: 0.56, baseR: 0.082, headR: 0.078, dress: '#6f9a5b', trim: '#f2d36b', hair: '#b5793e', pattern: 'flowers', hat: 'straw', prop: 'can' },
]

function pegBodyTexture(s: PegSpec, seed: number) {
  const W = 256, H = 256
  const [c, g] = canvas(W, H)
  woodGrain(g, W, H, seed, BEECH)
  // Lathe v runs up the profile by point index; 10 points, canvas top is the top.
  const yOf = (j: number) => (1 - j / 9) * H
  const r = rng(seed)
  g.globalAlpha = 0.94
  g.fillStyle = s.dress
  g.fillRect(0, yOf(8.4), W, yOf(1.7) - yOf(8.4))
  g.globalAlpha = 1
  // Brush texture in the paint.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    g.fillRect(r() * W, yOf(8.4) + r() * (yOf(1.7) - yOf(8.4)), 8 + r() * 30, 1.5)
  }
  g.fillStyle = s.trim
  if (s.pattern === 'apron') {
    // An apron on the front (u = 0.25 faces +z on a lathe that starts at -x... see note) with a waist tie.
    g.fillRect(W * 0.25 - 34, yOf(6.2), 68, yOf(2.0) - yOf(6.2))
    g.fillRect(0, yOf(6.5), W, 10)
    g.fillStyle = s.dress
    for (let i = 0; i < 5; i++) g.fillRect(W * 0.25 - 30 + i * 14, yOf(2.3), 6, 6)
  } else if (s.pattern === 'stripes') {
    for (let j = 0; j < 5; j++) g.fillRect(0, yOf(2.2 + j * 1.15), W, 7)
  } else {
    for (let i = 0; i < 26; i++) {
      const x = r() * W, y = yOf(7.5) + r() * (yOf(2.0) - yOf(7.5))
      for (let k = 0; k < 5; k++) {
        g.beginPath()
        g.arc(x + Math.cos(k * 1.256) * 4, y + Math.sin(k * 1.256) * 4, 3, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#fff6e0'
      g.beginPath()
      g.arc(x, y, 2, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = s.trim
    }
  }
  // A collar line at the shoulders.
  g.fillStyle = s.trim
  g.fillRect(0, yOf(8.2), W, 5)
  return toTexture(c)
}

function faceTexture(skin: RGB, hair: string | null, seed: number, opts: { mouth?: 'smile' | 'stitch'; cheeks?: string; fuzz?: boolean } = {}) {
  const W = 256, H = 128
  const [c, g] = canvas(W, H)
  if (opts.fuzz) fuzzFill(g, W, H, seed, skin)
  else woodGrain(g, W, H, seed, skin, false)
  const fx = W * 0.25 // +z on a three.js sphere
  if (hair) {
    g.fillStyle = hair
    g.beginPath()
    g.rect(0, 0, W, H * 0.36)
    g.fill()
    // Hair falls down the back, away from the face.
    g.fillRect(fx + W * 0.2, 0, W * 0.6, H * 0.62)
    g.beginPath()
    g.ellipse(fx, H * 0.36, W * 0.14, H * 0.08, 0, Math.PI, 0)
    g.fill()
  }
  g.fillStyle = opts.cheeks ?? 'rgba(232, 120, 110, 0.5)'
  for (const s of [-1, 1]) {
    g.beginPath()
    g.ellipse(fx + s * W * 0.07, H * 0.6, 9, 6.5, 0, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = '#3a241a'
  g.lineWidth = 2.5
  g.lineCap = 'round'
  g.beginPath()
  if (opts.mouth === 'stitch') {
    for (let i = -2; i <= 2; i++) {
      const x = fx + i * 5, y = H * 0.64 + Math.abs(i) * -1.3
      g.moveTo(x - 2, y - 2)
      g.lineTo(x + 2, y + 2)
    }
  } else g.arc(fx, H * 0.58, 8, 0.2 * Math.PI, 0.8 * Math.PI)
  g.stroke()
  return toTexture(c)
}

function pegDoll(i: number, phys: boolean): Figure {
  const s = PEGS[i]
  const { root, pose, head } = skeleton(s.name)
  const lacquer = (map: THREE.Texture | null, c = '#ffffff', rough = 0.5) => phys
    ? new THREE.MeshPhysicalMaterial({ map, color: c, roughness: rough, clearcoat: 0.55, clearcoatRoughness: 0.3 })
    : new THREE.MeshStandardMaterial({ map, color: c, roughness: rough * 0.9 })
  const paint = (c: string, rough = 0.5) => lacquer(null, c, rough)
  const hip = 0.03
  const k = s.bodyH
  const R = s.baseR
  const profile = [[0, 0], [R * 0.94, 0], [R, 0.025], [R * 0.97, 0.07], [R * 0.82, k * 0.45], [R * 0.72, k * 0.68], [R * 0.75, k * 0.8], [R * 0.66, k * 0.9], [R * 0.4, k * 0.97], [0.001, k]]
  const body = part(pose, mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 40), lacquer(pegBodyTexture(s, 30 + i))), 0, hip, 0)
  body.rotation.y = -Math.PI / 2 // lathe u = 0.25 then faces +z
  const hy = hip + k + s.headR * 0.82
  head.position.set(0, hy, 0)
  part(head, mesh(new THREE.SphereGeometry(s.headR, 32, 20), lacquer(faceTexture(BEECH, s.hair, 50 + i))), 0, 0, 0)
  const eyes = [-1, 1].map((sx) => {
    const e = part(head, mesh(new THREE.SphereGeometry(0.0145, 12, 8), paint('#2b1d14', 0.25)), sx * s.headR * 0.36, s.headR * 0.1, s.headR * 0.92)
    e.scale.z = 0.5
    return e
  })
  // Hats and hair give each one its own silhouette.
  if (s.hat === 'kerchief') {
    const cloth = paint('#b83a3a', 0.8)
    const cap = part(head, mesh(new THREE.SphereGeometry(s.headR * 1.06, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), cloth), 0, 0.006, -0.006)
    cap.rotation.x = -0.25
    for (const sx of [-1, 1]) {
      const knot = part(head, mesh(new THREE.ConeGeometry(0.022, 0.06, 8), cloth), sx * 0.022, -0.01, -s.headR * 1.0)
      knot.rotation.set(-1.1, 0, sx * 0.7)
    }
    part(head, mesh(new THREE.SphereGeometry(0.05, 14, 10), paint(s.hair, 0.7)), 0, 0.02, -s.headR * 0.95).scale.set(1, 0.9, 0.7)
  } else if (s.hat === 'pompom') {
    const knit = paint('#5b7fa6', 0.9)
    part(head, mesh(new THREE.CylinderGeometry(0.03, s.headR * 1.03, 0.1, 20), knit), 0, s.headR * 0.6, -0.005).rotation.x = -0.12
    part(head, mesh(new THREE.TorusGeometry(s.headR * 0.98, 0.014, 8, 24), paint('#f4ead6', 0.9)), 0, s.headR * 0.18, -0.004).rotation.x = Math.PI / 2 - 0.12
    part(head, mesh(new THREE.SphereGeometry(0.03, 12, 10), paint('#f4ead6', 1)), 0, s.headR * 0.6 + 0.07, -0.016)
  } else {
    const straw = paint('#e7c879', 0.85)
    const hat = new THREE.Group()
    part(hat, mesh(new THREE.CylinderGeometry(0.17, 0.175, 0.008, 36), straw), 0, 0, 0)
    part(hat, mesh(new THREE.CylinderGeometry(0.068, 0.084, 0.07, 24), straw), 0, 0.035, 0)
    part(hat, mesh(new THREE.CylinderGeometry(0.0855, 0.0855, 0.018, 24), paint('#c8553d', 0.7)), 0, 0.012, 0)
    hat.rotation.set(-0.12, 0, 0.08)
    part(head, hat, 0, s.headR * 0.62, -0.005)
  }
  const handY = hip + k * 0.5
  const hands = [-1, 1].map((sx) => {
    const h = hand(pose, mesh(new THREE.SphereGeometry(0.026, 14, 10), lacquer(null, '#e2ba8a', 0.45)), sx * (R * 0.78 + 0.018), handY, 0.015)
    // A painted sleeve peg joins the bead hand to the body.
    const sleeve = part(h, mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.07, 12), paint(s.dress, 0.5)), -sx * 0.004, 0.04, -0.004)
    sleeve.rotation.z = sx * 0.18
    return h
  })
  part(hands[0], prop(s.prop, paint, 0.9), 0, 0, 0.01)
  const feet = [-1, 1].map((sx) => {
    const f = part(root, new THREE.Group(), sx * 0.05, 0, 0)
    part(f, mesh(new THREE.SphereGeometry(0.036, 14, 10), lacquer(null, '#d9ae7c', 0.45)), 0, 0.022, 0.035).scale.set(1, 0.7, 1.25)
    return f
  })
  return { root, pose, head, eyes, feet, hands, height: hy + s.headR, hip, side: 0.05, stride: 0.26, speed: 0.42, bob: 0.03 }
}

// ─── b: felt plush ─────────────────────────────────────────────────────────

function fuzzFill(g: CanvasRenderingContext2D, w: number, h: number, seed: number, base: RGB) {
  const n = makeNoise(seed, 64)
  const img = g.createImageData(w, h)
  const r = rng(seed)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = 0.92 + (n(x / 14, y / 14, 3) - 0.5) * 0.2 + (r() - 0.5) * 0.14
      const i = (y * w + x) * 4
      img.data[i] = base[0] * t
      img.data[i + 1] = base[1] * t
      img.data[i + 2] = base[2] * t
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
}
/** A CSS colour as 0..255 sRGB channels for the canvas painters. */
function srgb(c: string): RGB {
  const k = new THREE.Color(c).convertLinearToSRGB()
  return [k.r * 255, k.g * 255, k.b * 255]
}

/** Felt with fuzz and a running stitch down the front seam (u = 0.25 faces +z). */
function feltTexture(base: string, seed: number, opts: { belly?: string; band?: boolean } = {}) {
  const W = 256, H = 128
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(base))
  if (opts.belly) {
    g.fillStyle = opts.belly
    g.beginPath()
    g.ellipse(W * 0.25, H * 0.5, W * 0.09, H * 0.2, 0, 0, Math.PI * 2)
    g.fill()
    stitchPath(g, (t) => [W * 0.25 + Math.cos(t * Math.PI * 2) * W * 0.09, H * 0.5 + Math.sin(t * Math.PI * 2) * H * 0.2], 30)
  }
  stitchPath(g, (t) => [W * 0.75, H * (0.08 + t * 0.84)], 12)
  if (opts.band !== false) stitchPath(g, (t) => [t * W, H * 0.5 + Math.sin(t * Math.PI * 4) * 1.5], 40)
  return toTexture(c)
}
function stitchPath(g: CanvasRenderingContext2D, at: (t: number) => [number, number], n: number) {
  g.strokeStyle = 'rgba(70, 45, 35, 0.75)'
  g.lineWidth = 1.6
  g.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(i / n)
    const [x1, y1] = at((i + 0.55) / n)
    g.beginPath()
    g.moveTo(x0, y0)
    g.lineTo(x1, y1)
    g.stroke()
  }
}

/** `rim` is the strength of the warm rim light: stronger on the cooler felts so they don't sink into the shade. */
interface PlushSpec extends Spec { felt: string; belly: string; inner: string; r: number; tall: number; ears: 'floppy' | 'tuft' | 'round'; prop: Prop; rim: number }
const PLUSH: PlushSpec[] = [
  { name: 'Dumpling, the cook', bark: "Soup's on for Thursday. Shall I add bread to the list?", felt: '#e2b98a', belly: '#f6e6cc', inner: '#e8a3a0', r: 0.2, tall: 0.9, ears: 'floppy', prop: 'spoon', rim: 0.28 },
  { name: 'Tuft, the tidier', bark: 'I found three socks and a crayon under the sofa.', felt: '#8a9cba', belly: '#e6dccb', inner: '#e3a92b', r: 0.14, tall: 1.5, ears: 'tuft', prop: 'duster', rim: 0.55 },
  { name: 'Moss, the gardener', bark: 'The basil on the sill is thirsty. I am on it.', felt: '#97a85e', belly: '#ece3c0', inner: '#5f7f42', r: 0.17, tall: 1.1, ears: 'round', prop: 'can', rim: 0.45 },
]

function plush(i: number, phys: boolean, look: Look = {}): Figure {
  const s = PLUSH[i]
  const { root, pose, head } = skeleton(s.name)
  // A warm rim on every felt part, added to emissive so the entries glow still works.
  const rim = () => color('#ffc58a').mul(pow(float(1).sub(max(dot(normalView, positionViewDirection), 0)), 2.5)).mul(s.rim)
  // A soft outline in the owner's colour, raised when the villager is pointed at or written to.
  const outline = uniform(0)
  const outlineColour = color(look.accent ?? s.felt)
  const edge = () => outlineColour.mul(pow(float(1).sub(max(dot(normalView, positionViewDirection), 0)), 1.8)).mul(outline)
  const felt = (c: string, map: THREE.Texture | null = null) => {
    const m = phys
      ? new THREE.MeshPhysicalNodeMaterial({ color: map ? '#ffffff' : c, map, roughness: 1, sheen: 1, sheenColor: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55), sheenRoughness: 0.55 })
      : new THREE.MeshStandardNodeMaterial({ color: map ? '#ffffff' : c, map, roughness: 1 })
    m.emissiveNode = materialEmissive.add(rim()).add(edge())
    // The entries hover glow lifts emissive; on soft felt half of it reads as a glow rather than a bleach.
    m.emissiveIntensity = 0.5
    return m
  }
  const plain = (c: string) => felt(c, feltTexture(c, 95 + i, { band: false }))
  const hip = 0.035
  const R = s.r
  const bodyH = R * 2 * s.tall * 0.62
  const body = part(pose, mesh(new THREE.SphereGeometry(R, 32, 20), felt(s.felt, feltTexture(s.felt, 70 + i, { belly: s.belly }))), 0, hip + bodyH / 2, 0)
  body.scale.set(1, (bodyH / (2 * R)), 0.88)
  const hr = R * 0.82
  const hy = hip + bodyH + hr * 0.62
  head.position.set(0, hy, 0)
  const skull = part(head, mesh(new THREE.SphereGeometry(hr, 32, 20), felt(s.felt, feltTexture(s.felt, 80 + i, { band: false }))), 0, 0, 0)
  skull.scale.set(1.08, 0.92, 0.95)
  // Painted stitch smile on a felt muzzle.
  const muzzle = part(head, mesh(new THREE.SphereGeometry(hr * 0.42, 20, 12), felt(s.belly, faceTexture(srgb(s.belly), null, 90 + i, { mouth: 'stitch', cheeks: 'rgba(0,0,0,0)', fuzz: true }))), 0, -hr * 0.24, hr * 0.74)
  muzzle.scale.set(1.15, 0.75, 0.6)
  part(head, mesh(new THREE.SphereGeometry(hr * 0.1, 12, 8), plain('#4a2e28')), 0, -hr * 0.1, hr * 0.98).scale.set(1.3, 0.8, 0.8)
  for (const sx of [-1, 1]) part(head, mesh(new THREE.CircleGeometry(hr * 0.13, 16), plain('#e88f8a')), sx * hr * 0.58, -hr * 0.2, hr * 0.8).rotation.y = sx * 0.6
  const eyes = [-1, 1].map((sx) => {
    const e = part(head, mesh(new THREE.CylinderGeometry(hr * 0.13, hr * 0.13, 0.012, 18), new THREE.MeshStandardMaterial({ color: '#241a18', roughness: 0.25 })), sx * hr * 0.4, hr * 0.12, hr * 0.86)
    e.rotation.x = Math.PI / 2 - 0.15
    e.rotation.z = sx * 0.35
    return e
  })
  if (s.ears === 'floppy') {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.CapsuleGeometry(hr * 0.2, hr * 0.9, 6, 12), felt(s.felt)), sx * hr * 1.0, -hr * 0.1, -hr * 0.05)
      ear.rotation.z = sx * 0.28
      ear.scale.set(1, 1, 0.45)
      part(ear, mesh(new THREE.CapsuleGeometry(hr * 0.12, hr * 0.7, 6, 10), plain(s.inner)), 0, 0, hr * 0.05).scale.set(1, 1, 0.5)
    }
  } else if (s.ears === 'tuft') {
    const yarn = plain(s.inner)
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.32
      const strand = part(head, mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 8), yarn), Math.sin(a) * 0.03, hr * 0.95 + 0.03, Math.cos(a) * -0.01)
      strand.rotation.z = -a * 1.4
    }
  } else {
    for (const sx of [-1, 1]) {
      const ear = part(head, mesh(new THREE.SphereGeometry(hr * 0.32, 16, 12), felt(s.felt)), sx * hr * 0.7, hr * 0.72, -hr * 0.1)
      ear.scale.set(1, 1, 0.5)
      part(ear, mesh(new THREE.SphereGeometry(hr * 0.2, 12, 10), plain(s.inner)), 0, 0, hr * 0.12).scale.set(1, 1, 0.4)
    }
    const leaf = part(head, mesh(new THREE.SphereGeometry(0.05, 12, 8), plain('#4f8a3a')), 0.02, hr * 1.02, 0)
    leaf.scale.set(0.5, 0.12, 1)
    leaf.rotation.set(0.5, 0.4, 0.6)
  }
  // A scarf in the owner's colour; Tuft always wore one.
  const scarfColour = look.accent ?? (s.ears === 'tuft' ? '#c8553d' : null)
  if (scarfColour) {
    const wool = plain(scarfColour)
    const scarf = part(pose, mesh(new THREE.TorusGeometry(R * 0.8, 0.024, 10, 28), wool), 0, hip + bodyH * 0.96, 0)
    scarf.rotation.x = Math.PI / 2
    scarf.scale.set(1, 0.9, 1)
    const tail = part(pose, mesh(new THREE.CapsuleGeometry(0.024, 0.15, 4, 8), wool), R * 0.42, hip + bodyH * 0.8, R * 0.66)
    tail.rotation.z = 0.25
  }
  const handY = hip + bodyH * 0.55
  const hands = [-1, 1].map((sx) => {
    const arm = hand(pose, mesh(new THREE.CapsuleGeometry(0.034, 0.05, 6, 10), felt(s.felt)), sx * (R * 0.98), handY, 0.02)
    arm.rotation.z = sx * 0.5
    return arm
  })
  const held = part(hands[0], prop(s.prop, (c) => felt(c), 0.85), 0, -0.03, 0.02)
  held.rotation.z = -0.5
  const feet = [-1, 1].map((sx) => {
    const f = part(root, new THREE.Group(), sx * R * 0.5, 0, 0)
    part(f, mesh(new THREE.SphereGeometry(0.048, 16, 10), felt(s.felt)), 0, 0.03, 0.02).scale.set(1, 0.65, 1.3)
    return f
  })
  return { root, pose, head, eyes, feet, hands, height: hy + hr, hip, side: R * 0.5, stride: 0.24, speed: 0.38, bob: 0.04, stepped: true, outline }
}

// ─── c: paper cutouts ──────────────────────────────────────────────────────

type Pt = [number, number]
interface PaperSpec extends Spec { coat: string; trim: string; skin: string; hair: string; hat: 'brim' | 'scarf' | 'none'; glasses?: boolean; prop: Prop; wB: number; wS: number; sh: number; rH: number }
const PAPER: PaperSpec[] = [
  { name: 'Saffron, the cook', bark: "Soup's on for Thursday. Shall I add bread to the list?", coat: '#e07a2e', trim: '#f6e7c8', skin: '#c98d62', hair: '#3a2418', hat: 'scarf', prop: 'spoon', wB: 0.26, wS: 0.15, sh: 0.44, rH: 0.085 },
  { name: 'Quill, the letter-keeper', bark: 'Two postcards came today. One has a lighthouse on it.', coat: '#3f6fa8', trim: '#e9c46a', skin: '#f0c9a4', hair: '#8a8a8a', hat: 'none', glasses: true, prop: 'letter', wB: 0.17, wS: 0.16, sh: 0.5, rH: 0.08 },
  { name: 'Fern, the gardener', bark: 'The basil on the sill is thirsty. I am on it.', coat: '#5f8f4e', trim: '#f2d36b', skin: '#e8b48c', hair: '#a0522d', hat: 'brim', prop: 'can', wB: 0.2, wS: 0.14, sh: 0.4, rH: 0.078 },
]

/** A thin card cut to an outline, painted on its face, bent gently like real paper. */
function card(pts: Pt[], paintFace: (g: CanvasRenderingContext2D) => void, edge: THREE.Material, seed: number, opts: { depth?: number; px?: number } = {}) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const px = opts.px ?? 1400
  const W = Math.ceil((x1 - x0) * px) + 8, H = Math.ceil((y1 - y0) * px) + 8
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, [246, 238, 222])
  g.setTransform(px, 0, 0, -px, 4 - x0 * px, H - 4 + y0 * px)
  g.save()
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.clip()
  paintFace(g)
  g.restore()
  // Ink outline just inside the cut, and a pale cut edge.
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
  g.closePath()
  g.strokeStyle = 'rgba(60, 38, 26, 0.85)'
  g.lineWidth = 3.2 / px
  g.lineJoin = 'round'
  g.stroke()
  const tex = toTexture(c)
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const depth = opts.depth ?? 0.004
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 })
  geo.translate(0, 0, -depth / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k)
    uv.setXY(k, (x - x0 + 4 / px) / (W / px), (y - y0 + 4 / px) / (H / px))
    pos.setZ(k, pos.getZ(k) - x * x * 0.9)
  }
  geo.computeVertexNormals()
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 })
  return mesh(geo, [face, edge])
}
/** Watercolour fill with a soft wash. */
function wash(g: CanvasRenderingContext2D, c: string, path: () => void, seed: number) {
  const r = rng(seed)
  g.fillStyle = c
  g.beginPath()
  path()
  g.fill()
  g.save()
  g.clip()
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(80,40,20,0.06)'
    g.beginPath()
    g.ellipse(-0.2 + r() * 0.4, r() * 0.7, 0.01 + r() * 0.04, 0.005 + r() * 0.02, r() * 3, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}
const circlePts = (cx: number, cy: number, r: number, n = 28, a0 = 0, a1 = Math.PI * 2): Pt[] =>
  Array.from({ length: n }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / (n - (a1 - a0 >= Math.PI * 2 - 1e-6 ? 0 : 1))
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt
  })

function paperDoll(i: number, _phys: boolean): Figure {
  const s = PAPER[i]
  const { root, pose, head } = skeleton(s.name)
  const edge = new THREE.MeshStandardMaterial({ color: '#f7f0e1', roughness: 0.95 })
  const sheet = new THREE.Group() // the card facing the person; rig touch turns it
  pose.add(sheet)
  const hip = 0.16
  const { wB, wS, sh, rH } = s
  // Body: dress or coat from hip to shoulders, with a neck.
  const bodyPts: Pt[] = [[-wB / 2, hip], [wB / 2, hip], [wS / 2 + 0.01, sh - 0.04], [wS / 2 - 0.02, sh], [0.025, sh + 0.02], [-0.025, sh + 0.02], [-wS / 2 + 0.02, sh], [-wS / 2 - 0.01, sh - 0.04]]
  const bodyCard = part(sheet, card(bodyPts, (g) => {
    wash(g, s.coat, () => bodyPts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))), 200 + i)
    g.fillStyle = s.trim
    if (i === 0) {
      g.beginPath()
      g.moveTo(-wB * 0.28, hip + 0.02); g.lineTo(wB * 0.28, hip + 0.02); g.lineTo(wS * 0.3, sh - 0.12); g.lineTo(-wS * 0.3, sh - 0.12)
      g.fill()
      g.fillRect(-wS / 2, sh - 0.13, wS, 0.018)
    } else if (i === 1) {
      for (const y of [sh - 0.08, sh - 0.15, sh - 0.22]) {
        g.beginPath()
        g.arc(0, y, 0.008, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#7a4f2e'
      g.save(); g.translate(0.02, sh - 0.2); g.rotate(-0.6); g.fillRect(-0.004, -0.1, 0.008, 0.2); g.restore()
      g.fillRect(0.03, hip + 0.05, 0.06, 0.06)
    } else {
      g.fillRect(-wB / 2, hip + 0.06, wB, 0.02)
      g.fillStyle = '#f6e7c8'
      g.fillRect(-0.04, sh - 0.12, 0.08, 0.05)
    }
    g.fillStyle = s.skin
    g.fillRect(-0.025, sh - 0.01, 0.05, 0.04)
  }, edge, 210 + i), 0, 0, 0)
  bodyCard.name = 'body card'
  // Head card, pinned at the neck so it can tilt.
  head.removeFromParent()
  sheet.add(head)
  head.position.set(0, sh + 0.015, 0.003)
  const hc = rH * 0.95
  const headPts = circlePts(0, hc, rH, 32)
  part(head, card(headPts, (g) => {
    wash(g, s.skin, () => g.arc(0, hc, rH, 0, Math.PI * 2), 220 + i)
    g.fillStyle = s.hair
    g.beginPath()
    g.arc(0, hc, rH, 0.05 * Math.PI, 0.95 * Math.PI)
    g.lineTo(-rH * 0.7, hc + rH * 0.15)
    g.quadraticCurveTo(0, hc + rH * 0.55, rH * 0.7, hc + rH * 0.15)
    g.fill()
    g.fillStyle = 'rgba(225, 110, 100, 0.45)'
    for (const sx of [-1, 1]) {
      g.beginPath()
      g.ellipse(sx * rH * 0.48, hc - rH * 0.25, rH * 0.16, rH * 0.11, 0, 0, Math.PI * 2)
      g.fill()
    }
    g.strokeStyle = '#3a241a'
    g.lineWidth = 0.004
    g.lineCap = 'round'
    g.beginPath()
    g.arc(0, hc - rH * 0.28, rH * 0.2, 1.15 * Math.PI, 1.85 * Math.PI)
    g.stroke()
    if (s.glasses) {
      g.lineWidth = 0.003
      for (const sx of [-1, 1]) {
        g.beginPath()
        g.arc(sx * rH * 0.36, hc, rH * 0.24, 0, Math.PI * 2)
        g.stroke()
      }
    }
  }, edge, 230 + i), 0, 0, 0)
  const eyes = [-1, 1].map((sx) => {
    const e = part(head, mesh(new THREE.CircleGeometry(rH * 0.085, 12), new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.6 })), sx * rH * 0.36, hc, 0.0035)
    e.castShadow = false
    return e
  })
  // Hats are their own layered cards.
  if (s.hat === 'brim') {
    const brim: Pt[] = [[-rH * 1.9, hc + rH * 0.45], [rH * 1.9, hc + rH * 0.45], [rH * 1.6, hc + rH * 0.62], [rH * 0.75, hc + rH * 0.7], [rH * 0.6, hc + rH * 1.45], [-rH * 0.6, hc + rH * 1.45], [-rH * 0.75, hc + rH * 0.7], [-rH * 1.6, hc + rH * 0.62]]
    part(head, card(brim, (g) => {
      wash(g, '#e7c879', () => brim.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))), 240)
      g.fillStyle = '#c8553d'
      g.fillRect(-rH * 0.72, hc + rH * 0.7, rH * 1.44, rH * 0.18)
    }, edge, 241), 0, 0, 0.004)
  } else if (s.hat === 'scarf') {
    const capPts = circlePts(0, hc + rH * 0.42, rH * 1.06, 24, -0.12, Math.PI + 0.12)
    const knotPts = circlePts(0, hc + rH * 1.55, rH * 0.5, 20)
    const scarf = (g: CanvasRenderingContext2D, pts: Pt[], seed: number) => {
      wash(g, '#2f7f7a', () => pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))), seed)
      g.fillStyle = '#f2d36b'
      for (let k = 0; k < 12; k++) {
        g.beginPath()
        g.arc(-rH + (k % 4) * rH * 0.66, hc + rH * (0.3 + Math.floor(k / 4) * 0.55), 0.005, 0, Math.PI * 2)
        g.fill()
      }
    }
    part(head, card(knotPts, (g) => scarf(g, knotPts, 244), edge, 245), 0, 0, -0.003)
    part(head, card(capPts, (g) => scarf(g, capPts, 242), edge, 243), 0, 0, 0.004)
  }
  // Legs and an arm are separate cards pinned with brass paper fasteners.
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.8, roughness: 0.35 })
  const legs = [1, -1].map((sx) => {
    const pivot = part(sheet, new THREE.Group(), sx * wB * 0.22, hip + 0.025, -0.003)
    const L = hip + 0.025
    const legPts: Pt[] = [[-0.017, 0], [0.017, 0], [0.016, -L + 0.03], [0.04 * 1, -L + 0.022], [0.042, -L], [-0.02, -L], [-0.018, -L + 0.03]]
    part(pivot, card(legPts, (g) => {
      wash(g, i === 1 ? '#5a4a3e' : s.skin, () => legPts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))), 250 + i)
      g.fillStyle = '#4a3328'
      g.fillRect(-0.03, -L, 0.08, 0.028)
    }, edge, 251 + i), 0, 0, 0)
    part(pivot, mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), brass), 0, -0.012, 0.007).rotation.x = Math.PI / 2
    pivot.userData.length = L
    return pivot
  })
  const shoulder = part(sheet, new THREE.Group(), wS / 2 - 0.005, sh - 0.035, 0.005)
  const armPts: Pt[] = [[-0.016, 0.01], [0.016, 0.01], [0.018, -0.15], [0.026, -0.17], [0.0, -0.19], [-0.022, -0.17], [-0.016, -0.15]]
  part(shoulder, card(armPts, (g) => {
    wash(g, s.coat, () => armPts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))), 260 + i)
    g.fillStyle = s.skin
    g.beginPath()
    g.arc(0.002, -0.17, 0.02, 0, Math.PI * 2)
    g.fill()
  }, edge, 261 + i), 0, 0, 0)
  part(shoulder, mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), brass), 0, 0, 0.004).rotation.x = Math.PI / 2
  const held = part(shoulder, prop(s.prop, (c, rough) => new THREE.MeshStandardMaterial({ color: c, roughness: rough ?? 0.9 }), 0.85), 0.0, -0.18, 0.02)
  held.rotation.y = Math.PI / 2
  shoulder.userData.rest = shoulder.position.clone()
  const feet = [0, 1].map(() => part(root, new THREE.Group()))
  const local = new THREE.Vector3()
  return {
    root, pose, head, eyes, feet, hands: [], height: sh + 0.015 + hc + rH * 1.5, hip, side: wB * 0.22, stride: 0.3, speed: 0.4, bob: 0.025,
    touch(v: Villager) {
      // The card turns mostly toward the person, like a puppet held up to them.
      const toCam = Math.atan2(v.camera.x - v.pos.x, v.camera.z - v.pos.z)
      const rel = Math.atan2(Math.sin(toCam - v.yaw), Math.cos(toCam - v.yaw))
      sheet.rotation.y = rel * 0.85
      sheet.updateMatrixWorld(true)
      // Each leg swings from its fastener to where its foot really is.
      legs.forEach((pivot, k) => {
        const foot = feet[k]
        foot.getWorldPosition(local)
        sheet.worldToLocal(local)
        const dx = local.x - pivot.position.x
        const dy = local.y - pivot.position.y
        pivot.rotation.z = Math.atan2(dx, -dy) * (v.seated > 0.5 ? 0.2 : 1) + (v.seated > 0.5 ? (k ? -0.15 : 0.15) + Math.sin(v.t * 2.2 + k) * 0.08 : 0)
      })
      shoulder.rotation.z = -0.25 + Math.sin(v.phase * Math.PI * 2) * 0.35 * v.walk + v.working * Math.sin(v.t * 4) * 0.25 + v.talking * 0.5
    },
  }
}

// ─── d: soft-toon household spirits ────────────────────────────────────────

/** Three tones of light. One per material, since unloading releases each material's textures. */
function toonGradient() {
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255])
  const gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter
  gradient.needsUpdate = true
  return gradient
}
/** Toon shading with a vertical colour ramp and a warm rim; the entries glow still adds to emissive. */
function toon(low: string, high: string, y0: number, y1: number, rim = '#ffd9a8') {
  const m = new THREE.MeshToonNodeMaterial({ gradientMap: toonGradient() })
  m.colorNode = mix(color(low), color(high), smoothstep(float(y0), float(y1), positionLocal.y))
  const fres = pow(float(1).sub(max(dot(normalView, positionViewDirection), 0)), 3)
  m.emissiveNode = materialEmissive.add(color(rim).mul(fres).mul(0.45))
  return m
}

interface SpiritSpec extends Spec { low: string; high: string; shape: 'bun' | 'pear' | 'capsule'; prop: Prop }
const SPIRITS: SpiritSpec[] = [
  { name: 'Puff, the cook', bark: "Soup's on for Thursday. Shall I add bread to the list?", low: '#f0a868', high: '#fff1d6', shape: 'bun', prop: 'spoon' },
  { name: 'Nook, the tidier', bark: 'I found three socks and a crayon under the sofa.', low: '#7d6fa8', high: '#d9cdea', shape: 'capsule', prop: 'duster' },
  { name: 'Sprout, the gardener', bark: 'The basil on the sill is thirsty. I am on it.', low: '#5f9a5a', high: '#e8f0c4', shape: 'pear', prop: 'pouch' },
]

function spirit(i: number, _phys: boolean): Figure {
  const s = SPIRITS[i]
  const { root, pose, head } = skeleton(s.name)
  const dark = new THREE.MeshStandardMaterial({ color: '#1f1622', roughness: 0.2 })
  const shine = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6 })
  const blush = new THREE.MeshStandardMaterial({ color: '#f29a9a', roughness: 0.8, transparent: true, opacity: 0.8 })
  const plain = (c: string) => toon(c, new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.25).getStyle(), -0.05, 0.05)
  let height = 0, faceY = 0, faceZ = 0, hip = 0.03, side = 0.06, floats = false, w = 0.15
  let handY = 0
  if (s.shape === 'bun') {
    floats = true
    hip = 0.12
    const r = 0.19
    const b = part(pose, mesh(new THREE.SphereGeometry(r, 40, 24), toon(s.low, s.high, -r * 0.9, r * 0.6)), 0, hip + r * 0.8, 0)
    b.scale.set(1.1, 0.8, 1)
    faceY = hip + r * 0.85; faceZ = r * 0.95; w = r * 1.1; height = hip + r * 1.6; handY = hip + r * 0.6
    // Steam curls on top.
    const curl = toon('#ffffff', '#ffffff', 0, 1, '#ffffff')
    ;[-1, 0, 1].forEach((k) => {
      const c = part(pose, mesh(new THREE.TorusGeometry(0.03, 0.011, 8, 18, Math.PI * 1.4), curl), k * 0.055, hip + r * 1.62 + Math.abs(k) * -0.02, 0)
      c.rotation.z = k * 0.4 + 0.6
    })
    height += 0.06
  } else if (s.shape === 'capsule') {
    const r = 0.11, len = 0.32
    part(pose, mesh(new THREE.CapsuleGeometry(r, len, 10, 24), toon(s.low, s.high, -0.2, 0.25)), 0, hip + r + len / 2 + 0.02, 0)
    faceY = hip + r + len * 0.82; faceZ = r * 0.95; w = r; height = hip + 2 * r + len + 0.02; handY = hip + r + len * 0.35
    for (const sx of [-1, 1]) {
      const ear = part(pose, mesh(new THREE.CapsuleGeometry(0.03, 0.18, 6, 12), plain(s.low)), sx * 0.06, height + 0.07, -0.01)
      ear.rotation.z = -sx * 0.32
      part(ear, mesh(new THREE.CapsuleGeometry(0.016, 0.13, 4, 8), plain('#f2b8c6')), 0, 0, 0.018).scale.z = 0.5
    }
    height += 0.2
    // The tail is the duster: a fluffy cloud of puffs.
    const tail = toon('#e8def2', '#ffffff', -0.1, 0.1)
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2
      part(pose, mesh(new THREE.SphereGeometry(0.05, 14, 10), tail), Math.cos(a) * 0.04, hip + 0.16 + Math.sin(a) * 0.04, -r - 0.07 + Math.sin(a * 2) * 0.01)
    }
  } else {
    const prof = [[0.001, 0], [0.13, 0.01], [0.17, 0.08], [0.16, 0.17], [0.11, 0.27], [0.085, 0.34], [0.09, 0.42], [0.07, 0.48], [0.001, 0.5]]
    part(pose, mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 40), toon(s.low, s.high, 0, 0.45)), 0, hip, 0)
    faceY = hip + 0.36; faceZ = 0.087; w = 0.16; height = hip + 0.5; handY = hip + 0.16
    const leafMat = plain('#4f8a3a')
    for (const sx of [-1, 1]) {
      const leaf = part(pose, mesh(new THREE.SphereGeometry(0.06, 16, 10), leafMat), sx * 0.05, height + 0.04, 0)
      leaf.scale.set(1, 0.18, 0.5)
      leaf.rotation.z = sx * 0.5
    }
    part(pose, mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 6), leafMat), 0, height + 0.01, 0)
    height += 0.08
  }
  // Big glossy eyes with a highlight, and a little blush.
  head.position.set(0, faceY, faceZ)
  const eyes = [-1, 1].map((sx) => {
    const e = part(head, new THREE.Group(), sx * w * 0.36, 0, 0)
    part(e, mesh(new THREE.SphereGeometry(0.024, 16, 12), dark), 0, 0, 0).scale.set(0.85, 1.15, 0.45)
    part(e, mesh(new THREE.SphereGeometry(0.007, 8, 6), shine), 0.006, 0.01, 0.01)
    return e
  })
  for (const sx of [-1, 1]) part(head, mesh(new THREE.SphereGeometry(0.018, 12, 8), blush), sx * w * 0.55, -0.035, -0.008).scale.set(1.3, 0.7, 0.3)
  const mouth = part(head, mesh(new THREE.TorusGeometry(0.012, 0.004, 6, 12, Math.PI), dark), 0, -0.03, 0.004)
  mouth.rotation.z = Math.PI
  const hands = [-1, 1].map((sx) => hand(pose, mesh(new THREE.SphereGeometry(0.028, 14, 10), plain(s.low)), sx * (w * 0.98), handY, 0.035))
  part(hands[0], prop(s.prop, (c) => plain(c), 0.85), 0, 0, 0.01)
  const feet = floats ? [] : [-1, 1].map((sx) => {
    const f = part(root, new THREE.Group(), sx * side, 0, 0)
    part(f, mesh(new THREE.SphereGeometry(0.035, 14, 10), plain(s.low)), 0, 0.02, 0.025).scale.set(1, 0.6, 1.3)
    return f
  })
  return { root, pose, head, eyes, feet, hands, height, hip, side, stride: 0.22, speed: 0.4, bob: 0.03, floats }
}

export const KINDS: Record<string, Kind> = {
  a: { title: 'Peg dolls', specs: PEGS, build: pegDoll },
  b: { title: 'Felt plush', specs: PLUSH, build: plush },
  c: { title: 'Paper cutouts', specs: PAPER, build: paperDoll },
  d: { title: 'Household spirits', specs: SPIRITS, build: spirit },
}
