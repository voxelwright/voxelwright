// The home's lot is an island in the sky. This is the earth under its lawn: a lip of turf,
// soil, then rock tapering to a point, cut in flat facets like a carved toy. It follows any
// lawn outline, so the lot can grow (src/build/lot.ts) and its island grows with it.
import * as THREE from 'three/webgpu'

type P = [number, number]

/** Depth below the lawn, how far the ring has drawn in towards the middle (0 none, 1 all the way), and its colour. */
const LAYERS: Array<[number, number, string]> = [
  [0, 0, '#7fae45'],
  [0.1, -0.012, '#6f9c3c'],
  [0.24, 0.004, '#8a5f3f'],
  [0.7, 0.05, '#7a5238'],
  [1.5, 0.16, '#8c7a66'],
  [2.6, 0.36, '#7b6c5e'],
  [3.7, 0.6, '#6a5d54'],
  [4.6, 0.84, '#5b5049'],
  [5.2, 1, '#4e4541'],
]
const STEP = 0.55

/** A stable 0..1 from a point, so a vertex keeps its jitter while the outline moves under it. */
const hash = (x: number, z: number, k: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** The outline walked in even steps, so the rock's facets are one size on straight sides and round corners alike. */
function resample(outline: P[]): P[] {
  const out: P[] = []
  let carry = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    let t = carry
    for (; t < len; t += STEP) out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len])
    carry = t - len
  }
  return out
}

/**
 * The island's body under a lawn outline (world x, z, any winding), its top ring at `top`.
 * Non-indexed with flat normals and vertex colours; use a material with `vertexColors`.
 */
export function islandBody(outline: P[], top: number): THREE.BufferGeometry {
  const ring = resample(outline)
  const n = ring.length
  let cx = 0, cz = 0
  for (const [x, z] of ring) { cx += x; cz += z }
  cx /= n
  cz /= n
  // The rock draws in towards the middle of the lot's long axis, not one point, so a long island keeps a keel.
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs)
  const keel = Math.max(0, Math.max(w, d) - Math.min(w, d)) * 0.3
  const alongX = w >= d
  const toward = (x: number, z: number): P => alongX
    ? [cx + Math.max(-keel, Math.min(keel, x - cx)), cz]
    : [cx, cz + Math.max(-keel, Math.min(keel, z - cz))]
  const depthScale = Math.min(1.25, Math.max(0.7, Math.min(w, d) / 14))
  const rows = LAYERS.map(([depth, inset, colour], li) => {
    const c = new THREE.Color(colour)
    return ring.map(([x, z], i) => {
      const [tx, tz] = toward(x, z)
      const rough = li < 3 ? 0 : (hash(ring[i][0], ring[i][1], li) - 0.5)
      const k = Math.min(1, Math.max(0, inset + rough * 0.14 * (1 - inset)))
      const y = top - depth * depthScale - (li < 3 ? 0 : rough * 0.5)
      const shade = 0.9 + hash(x, z, li + 20) * 0.2
      return { p: new THREE.Vector3(x + (tx - x) * k, y, z + (tz - z) * k), c: c.clone().multiplyScalar(shade) }
    })
  })
  const positions: number[] = [], colors: number[] = []
  const push = (...vs: Array<{ p: THREE.Vector3; c: THREE.Color }>) => {
    // One colour a facet (the first corner's), so each reads as a cut face.
    for (const v of vs) {
      positions.push(v.p.x, v.p.y, v.p.z)
      colors.push(vs[0].c.r, vs[0].c.g, vs[0].c.b)
    }
  }
  // Counter-clockwise from outside whatever the outline's winding.
  let area = 0
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1] }
  const flip = area > 0
  for (let li = 0; li < rows.length - 1; li++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = rows[li][i], b = rows[li][j], c = rows[li + 1][i], d2 = rows[li + 1][j]
    // Alternate the diagonal so the facets do not all lean one way.
    const tris = (i + li) % 2 ? [[a, c, b], [b, c, d2]] : [[a, c, d2], [a, d2, b]]
    for (const t of tris) flip ? push(t[0], t[2], t[1]) : push(t[0], t[1], t[2])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** The island's material: matte earth and rock in the facets' own colours. */
export const islandMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
