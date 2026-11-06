// Leaves, vines and pots for the living room's plant corner. Every leaf of a
// kind is one instance of one mesh, so a shelf of plants costs a few draw calls.
import * as THREE from 'three/webgpu'
import { canvas, makeNoise, rng, toTexture } from './paint'

/** Leaf outlines, each 1 long along +y from its stalk, gently cupped. */
const OUTLINES = {
  heart: (s: THREE.Shape) => {
    s.moveTo(0, 0)
    s.bezierCurveTo(0.42, 0.05, 0.5, 0.55, 0, 1)
    s.bezierCurveTo(-0.5, 0.55, -0.42, 0.05, 0, 0)
  },
  oval: (s: THREE.Shape) => {
    s.moveTo(0, 0)
    s.bezierCurveTo(0.34, 0.1, 0.36, 0.8, 0, 1)
    s.bezierCurveTo(-0.36, 0.8, -0.34, 0.1, 0, 0)
  },
  blade: (s: THREE.Shape) => {
    s.moveTo(-0.07, 0)
    s.bezierCurveTo(0.12, 0.3, 0.1, 0.8, 0, 1)
    s.bezierCurveTo(-0.1, 0.8, -0.12, 0.3, 0.07, 0)
  },
}
export type LeafKind = keyof typeof OUTLINES

export function leafGeometry(kind: LeafKind): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  OUTLINES[kind](shape)
  const geo = new THREE.ShapeGeometry(shape, 8)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i)
    pos.setZ(i, -Math.abs(x) * 0.35 + y * y * 0.18)
  }
  geo.computeVertexNormals()
  return geo
}

/** Collects leaves, then builds one instanced mesh for them. */
export class Foliage {
  private matrices: THREE.Matrix4[] = []
  private colors: THREE.Color[] = []
  constructor(private kind: LeafKind, private roughness = 0.55) {}

  /** A leaf with its stalk at base, pointing along dir, size metres long, rolled by roll radians. */
  add(base: THREE.Vector3, dir: THREE.Vector3, size: number, color: THREE.ColorRepresentation, roll = 0) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll))
    this.matrices.push(new THREE.Matrix4().compose(base, q, new THREE.Vector3(size, size, size)))
    this.colors.push(new THREE.Color(color))
  }

  build(name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      leafGeometry(this.kind),
      new THREE.MeshStandardMaterial({ roughness: this.roughness, side: THREE.DoubleSide }),
      this.matrices.length,
    )
    mesh.name = name
    this.matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, this.colors[i])
    })
    mesh.castShadow = true
    mesh.computeBoundingSphere()
    return mesh
  }
}

/** Glazed white ceramic with a carved leaf relief, painted in code. */
export function paintCeramic(seed: number): THREE.Texture {
  const [c, g] = canvas(512, 256)
  const n = makeNoise(seed, 32)
  const img = g.createImageData(512, 256)
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 512; x++) {
      const t = 0.95 + (n(x / 12, y / 12, 3) - 0.5) * 0.08
      const i = (y * 512 + x) * 4
      img.data[i] = 246 * t
      img.data[i + 1] = 243 * t
      img.data[i + 2] = 236 * t
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const r = rng(seed)
  g.lineCap = 'round'
  // Raised leaves: a shadowed edge under a light edge reads as relief.
  for (let i = 0; i < 40; i++) {
    const x = r() * 512, y = 40 + r() * 190, a = -Math.PI / 2 + (r() - 0.5) * 1.2, l = 26 + r() * 22
    for (const [dx, colour] of [[1.5, 'rgba(150,140,125,0.45)'], [-1, 'rgba(255,255,255,0.7)']] as const) {
      g.strokeStyle = colour
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(x + dx, y + dx, l / 2, l / 5, a, 0, Math.PI * 2)
      g.stroke()
    }
  }
  const t = toTexture(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}

/** A round pot of radius r and height h with a rim and dark soil, its base at the origin. */
export function pot(r: number, h: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const points = [
    new THREE.Vector2(r * 0.72, 0),
    new THREE.Vector2(r * 0.95, h * 0.5),
    new THREE.Vector2(r, h * 0.92),
    new THREE.Vector2(r * 1.04, h),
    new THREE.Vector2(r * 0.92, h),
  ]
  const body = new THREE.Mesh(new THREE.LatheGeometry(points, 28), material)
  body.castShadow = body.receiveShadow = true
  const soil = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 20), new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 1 }))
  soil.rotation.x = -Math.PI / 2
  soil.position.y = h * 0.93
  group.add(body, soil)
  return group
}

const POTHOS = ['#5f8f3a', '#6d9c3f', '#7fae48', '#8fbc4f', '#a6c95a', '#4f7f34']

/**
 * A pothos: a mound of heart leaves on top of a pot plus trailing vines that
 * hang over the edge. Leaves go into foliage; vine stems are returned as tubes.
 */
export function pothos(foliage: Foliage, top: THREE.Vector3, r: number, seed: number, trail: number, stemMat: THREE.Material, golden = false): THREE.Mesh[] {
  const rand = rng(seed)
  const tint = (c: string) => (golden ? new THREE.Color(c).lerp(new THREE.Color('#d8e86a'), 0.45) : new THREE.Color(c))
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, d = rand() * r * 0.9
    const base = top.clone().add(new THREE.Vector3(Math.cos(a) * d, 0.02 + rand() * 0.07, Math.sin(a) * d))
    const dir = new THREE.Vector3(Math.cos(a) * 0.9, 0.35 + rand() * 0.7, Math.sin(a) * 0.9 + 0.3)
    foliage.add(base, dir, 0.085 + rand() * 0.035, tint(POTHOS[Math.floor(rand() * POTHOS.length)]), rand() * 3)
  }
  const stems: THREE.Mesh[] = []
  for (let v = 0; v < trail; v++) {
    const a = Math.PI * 0.15 + (v / Math.max(1, trail - 1)) * Math.PI * 0.7 + (rand() - 0.5) * 0.3
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const length = 0.35 + rand() * 0.45
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 8; k++) {
      const u = k / 8
      const p = top.clone().addScaledVector(out, r * 0.9 + Math.min(u * 3, 1) * 0.07)
      p.y += 0.04 - u * u * length * 1.1 + Math.sin(u * 3 + v) * 0.01
      p.x += Math.sin(u * 5 + v) * 0.015
      pts.push(p)
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    stems.push(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0025, 4), stemMat))
    for (let k = 2; k < 18; k++) {
      const u = k / 18
      const p = curve.getPoint(u)
      const side = k % 2 ? 1 : -1
      const dir = curve.getTangent(u).cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(side).add(new THREE.Vector3(0, -0.4, 0.6))
      foliage.add(p, dir, 0.06 + rand() * 0.03, tint(POTHOS[Math.floor(rand() * POTHOS.length)]), rand() * 2)
    }
  }
  return stems
}
