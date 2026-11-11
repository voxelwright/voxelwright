// The cars parked along the kerbs, as the page draws them (#136). The world holds a car as two
// boxes (src/scene.ts): a body and a cabin. What is seen is laid over those: a body with round
// corners and sides that swell a little, wheels in dark arches, a cabin of glass between
// pillars under a roof, lamps, bumpers and plates. The kinds and their sizes are the world's.
import * as THREE from 'three/webgpu'
import { vertexColor } from 'three/tsl'
import { GRADE } from '../../src/ground.ts'
import { CAR_KINDS, type CarKind, type Parked } from '../../src/scene.ts'
import { Mesher, rgb, type P3 } from './mesher.ts'

const TYRE = rgb('#17181a'), RIM = rgb('#b9bdc2'), DARK = rgb('#1d2023'), CHROME = rgb('#c9ccd0'), PLATE = rgb('#eef0f2'), GLASS: P3 = [0.5, 0.5, 0.5]

/** How many faces round each of a car's corners. */
const ROUND = 6
/** A ring of points round a rectangle with round corners, at one height: `x0` to `x1` along the car, `half` its half width, `r` the corner's radius. */
function ring(x0: number, x1: number, half: number, r: number, y: number): P3[] {
  const points: P3[] = [], corners: [number, number, number][] = [[x1 - r, half - r, 0], [x0 + r, half - r, 1], [x0 + r, -half + r, 2], [x1 - r, -half + r, 3]]
  for (const [cx, cz, quarter] of corners) for (let i = 0; i <= ROUND; i++) {
    const a = ((quarter + i / ROUND) * Math.PI) / 2
    points.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r])
  }
  return points
}
/** Whether the face from point `i` of a ring to the next is one of its four straight sides (the rest turn its corners). */
const straight = (i: number) => i % (ROUND + 1) === ROUND

/** Lays one car into the meshers, in its own frame: its nose towards -x, its wheels on y = 0. */
function car(body: Mesher, glass: Mesher, trim: Mesher, lamps: Mesher, k: CarKind, paint: P3) {
  const half = k.wide / 2, x0 = -k.long / 2, x1 = k.long / 2
  /** Faces up a stack of rings, each point to the one over it, lit smoothly round and up. `face` says what a face is made of, or nothing. `rolled` leans the top ring's light upward, where a lid follows. */
  const stack = (rings: P3[][], face: (band: number, i: number) => [Mesher, P3] | null, rolled = true) => {
    const count = rings[0].length
    const normals = rings.map((at, level) => at.map((_, i): P3 => {
      const before = at[(i + count - 1) % count], after = at[(i + 1) % count], below = rings[Math.max(0, level - 1)][i], above = rings[Math.min(rings.length - 1, level + 1)][i]
      const t = [after[0] - before[0], after[1] - before[1], after[2] - before[2]], u = [above[0] - below[0], above[1] - below[1], above[2] - below[2]]
      const n: P3 = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]], l = Math.hypot(...n) || 1
      const lift = rolled && level === rings.length - 1 ? 0.8 : 0
      return [n[0] / l, n[1] / l + lift, n[2] / l]
    }))
    for (let level = 0; level < rings.length - 1; level++) for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, made = face(level, i)
      if (made) made[0].smooth([rings[level][j], rings[level][i], rings[level + 1][i], rings[level + 1][j]], [normals[level][j], normals[level][i], normals[level + 1][i], normals[level + 1][j]], made[1])
    }
  }
  const lid = (into: Mesher, at: P3[], color: P3, up = true) => { for (let i = 1; i < at.length - 1; i++) up ? into.tri(at[0], at[i + 1], at[i], color) : into.tri(at[0], at[i], at[i + 1], color) }
  // The body: a sill, a swell at the wheels' height, a shoulder, and the deck over it.
  const deck = ring(x0 + 0.12, x1 - 0.12, half - 0.12, 0.36, k.belt)
  stack([ring(x0 + 0.08, x1 - 0.08, half - 0.06, 0.3, 0.19), ring(x0 - 0.02, x1 + 0.02, half + 0.012, 0.42, 0.3), ring(x0 - 0.02, x1 + 0.02, half + 0.012, 0.42, 0.4), ring(x0, x1, half, 0.42, 0.48), ring(x0 + 0.02, x1 - 0.02, half - 0.02, 0.42, k.belt - 0.14), ring(x0 + 0.05, x1 - 0.05, half - 0.05, 0.4, k.belt - 0.04), deck], (band) => (band < 2 ? [trim, DARK] : [body, paint]))
  lid(body, deck, paint)
  // The cabin: glass from the deck to the roof, leaning in; its corners are its pillars, in the body's paint.
  const c0 = x0 + k.cabin[0], c1 = x0 + k.cabin[1], top = k.belt + k.roof
  const crown = ring(c0 + k.rake[0] + 0.12, c1 - k.rake[1] - 0.12, half - 0.38, 0.2, top)
  stack([ring(c0, c1, half - 0.12, 0.3, k.belt - 0.01), ring(c0 + k.rake[0], c1 - k.rake[1], half - 0.26, 0.24, top - 0.06)], (_, i) => (straight(i) ? [glass, GLASS] : [body, paint]), false)
  stack([ring(c0 + k.rake[0], c1 - k.rake[1], half - 0.26, 0.24, top - 0.06), ring(c0 + k.rake[0] + 0.04, c1 - k.rake[1] - 0.04, half - 0.3, 0.22, top - 0.015), crown], () => [body, paint])
  lid(body, crown, paint)
  for (const side of [-1, 1]) {
    const mid = (c0 + k.rake[0] + c1 - k.rake[1]) / 2 + 0.1
    body.quad([mid - 0.06, k.belt, side * (half - 0.115)], [mid + 0.06, k.belt, side * (half - 0.115)], [mid + 0.06, top - 0.05, side * (half - 0.255)], [mid - 0.06, top - 0.05, side * (half - 0.255)], paint)
    body.quad([mid + 0.06, k.belt, side * (half - 0.115)], [mid - 0.06, k.belt, side * (half - 0.115)], [mid - 0.06, top - 0.05, side * (half - 0.255)], [mid + 0.06, top - 0.05, side * (half - 0.255)], paint)
    // A mirror on each door.
    body.box([c0 + k.rake[0] * 0.5, k.belt + 0.08, side * (half - 0.02)], [0.05, 0.04, 0.08], paint)
  }
  if (k.bed) {
    // A pickup's bed: open, its floor dark, walls of the body's paint round it.
    const b0 = c1 + 0.06, b1 = x1 - 0.12, wall = k.belt + 0.3
    for (const side of [-1, 1]) body.box([(b0 + b1) / 2, (k.belt + wall) / 2, side * (half - 0.14)], [(b1 - b0) / 2, (wall - k.belt) / 2, 0.05], paint, '-y')
    body.box([b1, (k.belt + wall) / 2, 0], [0.05, (wall - k.belt) / 2, half - 0.14], paint, '-y')
    trim.box([(b0 + b1) / 2, k.belt + 0.01, 0], [(b1 - b0) / 2, 0.01, half - 0.18], DARK, '-y')
  }
  // Wheels in dark arches, a pale rim in each.
  for (const x of [x0 + 0.82, x1 - 0.85]) for (const side of [-1, 1]) {
    const hub = new THREE.Matrix4().makeRotationX((side * Math.PI) / 2).setPosition(x, 0.32, side * (half - 0.26))
    const keep = trim.placed
    trim.place(keep.clone().multiply(hub))
    trim.post([0, 0, 0], 0.32, 0.24, TYRE, 20)
    trim.post([0, 0.236, 0], 0.215, 0.012, RIM, 16, 0.2)
    trim.post([0, 0.24, 0], 0.15, 0.012, DARK, 14, 0.14)
    trim.post([0, 0.244, 0], 0.07, 0.02, RIM, 10, 0.05)
    trim.place(keep)
    // The arch: a dark half round on the body's side.
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * Math.PI, a1 = ((i + 1) / 14) * Math.PI, r = 0.41, z = side * (half + 0.004)
      const p = (a: number): P3 => [x + Math.cos(a) * r, 0.3 + Math.sin(a) * r, z]
      if (side > 0) trim.tri([x, 0.3, z], p(a0), p(a1), DARK)
      else trim.tri([x, 0.3, z], p(a1), p(a0), DARK)
    }
  }
  // A grille, plates, and lamps let into the four corners.
  trim.box([x0 + 0.004, 0.62, 0], [0.012, 0.06, half - 0.72], DARK)
  for (const x of [x0 - 0.016, x1 + 0.016]) trim.box([x, 0.42, 0], [0.006, 0.065, 0.16], PLATE)
  for (const side of [-1, 1]) {
    lamps.box([x0 + 0.012, 0.64, side * (half - 0.5)], [0.02, 0.06, 0.13], [1, 0.97, 0.88])
    lamps.box([x1 - 0.012, 0.68, side * (half - 0.5)], [0.02, 0.065, 0.13], [0.75, 0.04, 0.03])
  }
}

/** The block's parked cars as four meshes. */
export function cars(list: Parked[]): THREE.Group {
  const body = new Mesher(), glass = new Mesher(), trim = new Mesher(), lamps = new Mesher()
  const lean = Math.atan(GRADE)
  for (const p of list) {
    // Where the world has it: on the hill, along the street, its nose up or down it.
    const m = new THREE.Matrix4().makeRotationX(lean).multiply(new THREE.Matrix4().makeTranslation(p.across, 0, p.along)).multiply(new THREE.Matrix4().makeRotationY(p.nose > 0 ? Math.PI / 2 : -Math.PI / 2))
    for (const mesher of [body, glass, trim, lamps]) mesher.place(m)
    car(body, glass, trim, lamps, CAR_KINDS[p.kind], rgb(p.paint))
  }
  // Paint under a clear coat; glass as a dark mirror; rubber and plastic dull; lamps with a little light of their own.
  const paint = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.42, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })
  paint.colorNode = vertexColor().rgb
  // A little dull, so the street it throws back is soft: the picture the street is lit by is a small one.
  const pane = new THREE.MeshStandardNodeMaterial({ roughness: 0.22, metalness: 1 })
  pane.colorNode = vertexColor().rgb.mul(0.3)
  const dull = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.15 })
  dull.colorNode = vertexColor().rgb
  const lit = new THREE.MeshStandardNodeMaterial({ roughness: 0.25 })
  lit.colorNode = vertexColor().rgb
  lit.emissiveNode = vertexColor().rgb.mul(0.6)
  const group = new THREE.Group()
  group.name = 'the parked cars'
  for (const [name, mesher, material] of [['paint', body, paint], ['glass', glass, pane], ['trim', trim, dull], ['lamps', lamps, lit]] as const) {
    const mesh = new THREE.Mesh(mesher.geometry(), material)
    mesh.name = `cars ${name}`
    mesh.castShadow = name !== 'lamps'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
