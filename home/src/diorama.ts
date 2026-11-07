// The dollhouse shell around a room in ?cam=iso (#42): a base the floor stands on,
// four thick walls, and low cut stubs with a painted cap that replace any wall the
// camera stands behind. Built only in iso, so the seated view never sees it.
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvas, paintGrass, paintWorktable, rng, toTexture } from './paint'

export type Side = 'back' | 'front' | 'left' | 'right'

export interface Shell {
  /** Inner faces of the walls, in world metres. */
  x0: number
  x1: number
  z0: number
  z1: number
  height: number
  thickness: number
  wall: THREE.Material
  /** Whether the shell's walls throw shadows (the kitchen's sun needs them; the living room never had them). */
  casts: boolean
  /** Walls the room already builds at full height (tagged `inward`); the shell adds only their stubs and caps. */
  existing: Side[]
  /** Door openings along a wall, as world x (back, front) or z (left, right) ranges. */
  openings?: Partial<Record<Side, Array<[number, number, number]>>>
}

/** The painted cut face of the diorama: the colour of the wall caps, stub tops and the base's edge. */
export const CUT = '#7d5442'
const STUB = 0.42
const BASE = 0.3
/** Oiled planks: matte enough that the low sun leaves a soft glow, not a mirror streak (#42 room). */
export const FLOOR_ROUGHNESS = 0.86
/** The lawn of the yard sits a little below the house floor, so the foundation shows. */
export const YARD_TOP = -0.08
const BOARD = 0.26
const INWARD: Record<Side, THREE.Vector3> = {
  back: new THREE.Vector3(0, 0, 1),
  front: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
}

export function shell(spec: Shell): THREE.Group {
  const { x0, x1, z0, z1, height, thickness: T, wall } = spec
  const group = new THREE.Group()
  group.name = 'diorama shell'
  const cut = new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 })
  // Outer extents: walls stand outside the inner faces, the base runs under them.
  const ox0 = x0 - T, ox1 = x1 + T, oz0 = z0 - T, oz1 = z1 + T

  /** One straight run of wall between two corners, from y0 to y1, along x (back/front) or z (left/right). */
  const run = (side: Side, a: number, b: number, y0: number, y1: number) => {
    const alongX = side === 'back' || side === 'front'
    const len = b - a
    const geo = new THREE.BoxGeometry(alongX ? len : T, y1 - y0, alongX ? T : len)
    // Plaster mapped by world size so stubs and full walls share the grain.
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + a - ox0) / 8, (uv.getY(i) * (y1 - y0) + y0) / height)
    const m = new THREE.Mesh(geo, wall)
    const mid = (a + b) / 2
    const c = side === 'back' ? z0 - T / 2 : side === 'front' ? z1 + T / 2 : side === 'left' ? x0 - T / 2 : x1 + T / 2
    m.position.set(alongX ? mid : c, (y0 + y1) / 2, alongX ? c : mid)
    m.castShadow = spec.casts
    m.receiveShadow = true
    m.userData.inward = INWARD[side]
    const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : T + 0.004, 0.02, alongX ? T + 0.004 : len), cut)
    cap.position.set(m.position.x, y1 + 0.01, m.position.z)
    cap.userData.inward = INWARD[side]
    cap.castShadow = spec.casts
    return [m, cap]
  }
  /** A wall's span between corners, split around its openings (below `top` only). */
  const spans = (side: Side, a: number, b: number, below: number): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    let at = a
    for (const [o0, o1, top] of (spec.openings?.[side] ?? []).sort((p, q) => p[0] - q[0])) {
      if (top < below) continue
      out.push([at, o0])
      at = o1
    }
    out.push([at, b])
    return out
  }
  const extent: Record<Side, [number, number]> = {
    // The back and front walls run the full outer width; the side walls fit between them.
    back: [ox0, ox1], front: [ox0, ox1], left: [z0, z1], right: [z0, z1],
  }
  for (const side of ['back', 'front', 'left', 'right'] as Side[]) {
    const [a, b] = extent[side]
    if (!spec.existing.includes(side)) {
      for (const [p, q] of spans(side, a, b, 0)) group.add(...run(side, p, q, 0, height))
      // Lintels over the openings.
      for (const [o0, o1, top] of spec.openings?.[side] ?? []) group.add(...run(side, o0, o1, top, height))
    } else {
      // The room's own wall: add only its cap (and the corner it leaves open).
      const [, cap] = run(side, a, b, 0, height)
      group.add(cap)
    }
    for (const [p, q] of spans(side, a, b, STUB)) {
      for (const m of run(side, p, q, 0, STUB)) {
        m.userData.cutaway = true // shown in place of the full wall when the camera stands behind it
        m.visible = false
        group.add(m)
      }
    }
  }
  // Corners the room's own walls leave open: fill to full height so the outside reads solid.
  if (spec.existing.includes('back')) {
    for (const x of [ox0 + T / 2, ox1 - T / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(T, height, T), wall)
      post.position.set(x, height / 2, oz0 + T / 2)
      post.castShadow = true
      post.userData.inward = INWARD.back
      group.add(post)
    }
  }

  // The base: a painted slab under the floor and walls, with a soft contact shadow below.
  const base = new THREE.Mesh(new THREE.BoxGeometry(ox1 - ox0 + 0.08, BASE, oz1 - oz0 + 0.08), cut)
  base.position.set((ox0 + ox1) / 2, -BASE / 2 - 0.002, (oz0 + oz1) / 2)
  base.receiveShadow = true
  group.add(base)
  // The house stands on the yard's lawn; a soft darkening around its foundation seats it there.
  group.add(contactShadow(ox1 - ox0, oz1 - oz0, (ox0 + ox1) / 2, (oz0 + oz1) / 2, YARD_TOP + 0.003, 0.5))
  return group
}

/** A blurred dark rectangle under a footprint, so it sits on what is below. Not solid for picking. */
function contactShadow(w: number, d: number, x: number, z: number, y = -BASE - 0.02, pad = 1.4): THREE.Mesh {
  const [c, g] = canvas(256, 256)
  const sx = 256 / (w + pad * 2), sz = 256 / (d + pad * 2)
  g.filter = 'blur(18px)'
  g.fillStyle = 'rgba(70, 38, 20, 0.8)'
  g.fillRect(pad * sx * 0.7, pad * sz * 0.7, (w + pad * 0.6) * sx, (d + pad * 0.6) * sz)
  const map = toTexture(c)
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w + pad * 2, d + pad * 2),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false }),
  )
  m.rotation.x = -Math.PI / 2
  m.position.set(x, y, z)
  m.name = 'diorama contact shadow'
  return m
}

/** A plank floor sized to the room, so nothing runs past the walls. */
export function floor(x0: number, x1: number, z0: number, z1: number, map: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map, roughness: FLOOR_ROUGHNESS }))
  m.rotation.x = -Math.PI / 2
  m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
  m.receiveShadow = true
  m.name = 'diorama floor'
  m.material.userData.themeRole = 'floor'
  return m
}

/** A leafy clump: a sphere pushed in and out by low noise, so the crown has lobes, not facets. */
export function lumpy(r: number, seed: number, detail: [number, number] = [28, 18]): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, ...detail)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const k = 1 + 0.09 * Math.sin(v.x * 9 + seed) * Math.sin(v.y * 8 - seed) + 0.05 * Math.sin(v.z * 15 + seed * 2)
    p.setXYZ(i, v.x * k, v.y * k * 0.9, v.z * k)
  }
  geo.computeVertexNormals()
  return geo
}

/** Where a tree stands: x, z, scale, turn. */
export type TreeSpot = [number, number, number, number]

/**
 * Small garden trees, each a trunk and a lobed crown. All the trees in one call are
 * merged into three meshes (bark and two leaf shades), so an orchard costs three draws.
 */
export function trees(spots: TreeSpot[], y = 0): THREE.Group {
  const group = new THREE.Group()
  group.name = 'garden trees'
  const bark: THREE.BufferGeometry[] = []
  const clumps: THREE.BufferGeometry[][] = [[], []]
  for (const [tx, tz, scale, turn] of spots) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(tx, y, tz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn), new THREE.Vector3(scale, scale, scale))
    bark.push(new THREE.CylinderGeometry(0.07, 0.11, 2.6, 8).translate(0, 1.3, 0).applyMatrix4(m))
    const seed = Math.round(turn * 10)
    for (const [x, cy, z, r, k] of [[0, 3.0, 0, 0.85, 0], [0.55, 2.6, 0.2, 0.6, 1], [-0.5, 2.7, -0.1, 0.62, 1], [0.1, 3.5, -0.2, 0.55, 1], [-0.2, 2.45, 0.45, 0.5, 0]] as const) {
      clumps[k].push(lumpy(r, x * 7 + cy + seed, [20, 14]).translate(x, cy, z).applyMatrix4(m))
    }
  }
  const merged = (list: THREE.BufferGeometry[], material: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(list), material)
    for (const g of list) g.dispose()
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
  }
  merged(bark, new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.9 }))
  merged(clumps[0], new THREE.MeshStandardMaterial({ color: '#6c8c3c', roughness: 0.9 }))
  merged(clumps[1], new THREE.MeshStandardMaterial({ color: '#86a347', roughness: 0.9 }))
  return group
}

export interface Yard {
  /** The board's extent in world metres. */
  x0: number
  x1: number
  z0: number
  z1: number
  /** Where the picket fence opens and the stepping stones run, as world points from the house to the gate. */
  path: Array<[number, number]>
  seed: number
}

/**
 * The yard the dollhouse stands in (#42 room): a lawn board with a painted edge,
 * a low picket fence with a gate, stepping stones, flower clumps and shrubs, on a
 * warm wooden tabletop that runs out into the fog. Fence posts, stones and blooms
 * are instanced, so the whole yard is a dozen draws.
 */
export function yard(spec: Yard): THREE.Group {
  const { x0, x1, z0, z1 } = spec
  const group = new THREE.Group()
  group.name = 'diorama yard'
  const r = rng(spec.seed)
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2

  const grass = paintGrass(spec.seed)
  grass.repeat.set(w / 3, d / 3)
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.set(cx, YARD_TOP, cz)
  // The low sun would lay the house's 8 m shadow across the lawn in hard wedges; the
  // foundation's soft contact shadow grounds it instead.
  lawn.name = 'yard lawn'
  group.add(lawn)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, BOARD, d + 0.04), new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 }))
  edge.position.set(cx, YARD_TOP - BOARD / 2 - 0.002, cz)
  group.add(edge)

  // The worktable it all stands on, painted unlit so it reads the same in every room, its edges lost in the fog.
  const table = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), new THREE.MeshBasicMaterial({ map: paintWorktable(spec.seed) }))
  table.rotation.x = -Math.PI / 2
  table.position.set(cx, YARD_TOP - BOARD - 0.004, cz)
  table.name = 'worktable'
  group.add(table)
  group.add(contactShadow(w, d, cx, cz, YARD_TOP - BOARD + 0.001, 0.9))

  // Picket fence just inside the board's edge, with a gap where the path meets it.
  const inset = 0.22
  const gate = spec.path[spec.path.length - 1]
  const pickets: THREE.Matrix4[] = []
  const rails: THREE.BufferGeometry[] = []
  const side = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.floor(len / 0.14)
    const yaw = Math.atan2(bz - az, bx - ax)
    const open: Array<[number, number]> = []
    let at = 0
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t
      const inGate = Math.hypot(x - gate[0], z - gate[1]) < 0.55
      if (inGate) { if (at < t) open.push([at, t]); at = 2; continue }
      if (at > 1) at = t
      pickets.push(new THREE.Matrix4().compose(new THREE.Vector3(x, YARD_TOP + 0.22, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw), new THREE.Vector3(1, 1, 1)))
    }
    if (at <= 1) open.push([at, 1])
    for (const [t0, t1] of open) for (const y of [0.12, 0.32]) {
      const l = (t1 - t0) * len
      if (l < 0.05) continue
      const g = new THREE.BoxGeometry(l, 0.035, 0.02)
      g.rotateY(-yaw)
      const tm = (t0 + t1) / 2
      g.translate(ax + (bx - ax) * tm, YARD_TOP + y, az + (bz - az) * tm)
      rails.push(g)
    }
  }
  const fx0 = x0 + inset, fx1 = x1 - inset, fz0 = z0 + inset, fz1 = z1 - inset
  side(fx0, fz0, fx1, fz0)
  side(fx1, fz0, fx1, fz1)
  side(fx1, fz1, fx0, fz1)
  side(fx0, fz1, fx0, fz0)
  const paint = new THREE.MeshStandardMaterial({ color: '#f1e8d6', roughness: 0.7 })
  const picket = new THREE.BoxGeometry(0.055, 0.44, 0.022)
  // A pointed top: pull the top two corners' middle up by moving the top face's centre.
  const pp = picket.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pp.count; i++) if (pp.getY(i) > 0.2) pp.setY(i, 0.2 - Math.abs(pp.getX(i)) * 0.6)
  picket.computeVertexNormals()
  const fence = new THREE.InstancedMesh(picket, paint, pickets.length)
  pickets.forEach((m, i) => fence.setMatrixAt(i, m))
  fence.castShadow = fence.receiveShadow = true
  fence.name = 'picket fence'
  group.add(fence)
  const rail = new THREE.Mesh(mergeGeometries(rails), paint)
  for (const g of rails) g.dispose()
  rail.castShadow = true
  group.add(rail)

  // Stepping stones from the house to the gate, a stone every 0.42 m.
  const stones: THREE.Matrix4[] = []
  for (let i = 0; i < spec.path.length - 1; i++) {
    const [ax, az] = spec.path[i], [bx, bz] = spec.path[i + 1]
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.42))
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const s = 0.85 + r() * 0.3
      stones.push(new THREE.Matrix4().compose(
        new THREE.Vector3(ax + (bx - ax) * t + (r() - 0.5) * 0.08, YARD_TOP + 0.01, az + (bz - az) * t + (r() - 0.5) * 0.08),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI),
        new THREE.Vector3(s, 1, s * (0.75 + r() * 0.2)),
      ))
    }
  }
  const stone = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.18, 0.03, 9), new THREE.MeshStandardMaterial({ color: '#cfc0a6', roughness: 0.92 }), stones.length)
  stones.forEach((m, i) => stone.setMatrixAt(i, m))
  stone.receiveShadow = true
  stone.name = 'stepping stones'
  group.add(stone)

  // Flower clumps along the fence and the path: leaf mounds dotted with blooms, instanced by colour.
  const beds: Array<[number, number, number]> = []
  for (let i = 0; i < 9; i++) {
    const t = r()
    const along = [
      [fx0 + 0.35, fz0 + 0.35 + t * (fz1 - fz0 - 0.7)],
      [fx1 - 0.35, fz0 + 0.35 + t * (fz1 - fz0 - 0.7)],
      [fx0 + 0.35 + t * (fx1 - fx0 - 0.7), fz1 - 0.35],
    ][i % 3]
    if (Math.hypot(along[0] - gate[0], along[1] - gate[1]) < 1) continue
    beds.push([along[0], along[1], 0.35 + r() * 0.25])
  }
  const leaf = new THREE.MeshStandardMaterial({ color: '#5d7d33', roughness: 0.9 })
  const mounds: THREE.BufferGeometry[] = []
  const blooms: Array<[THREE.Matrix4, THREE.Color]> = []
  const petals = ['#f4d36b', '#fff4dc', '#f29a7a', '#e7849c', '#c9a2e0']
  for (const [bx, bz, br] of beds) {
    mounds.push(lumpy(br, bx + bz, [12, 8]).scale(1, 0.45, 1).translate(bx, YARD_TOP + br * 0.12, bz))
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, q = Math.sqrt(r()) * br * 0.85
      blooms.push([
        new THREE.Matrix4().makeTranslation(bx + Math.cos(a) * q, YARD_TOP + br * 0.12 + br * 0.4 * Math.sqrt(1 - (q / br) ** 2) * 0.95, bz + Math.sin(a) * q),
        new THREE.Color(petals[Math.floor(r() * petals.length)]),
      ])
    }
  }
  // Shrubs at the board's corners.
  for (const [sx, sz] of [[fx0 + 0.5, fz1 - 0.5], [fx1 - 0.5, fz1 - 0.5], [fx1 - 0.6, fz0 + 0.6]]) {
    mounds.push(lumpy(0.42, sx * 3 + sz, [14, 10]).translate(sx, YARD_TOP + 0.3, sz))
  }
  if (mounds.length) {
    const bush = new THREE.Mesh(mergeGeometries(mounds), leaf)
    for (const g of mounds) g.dispose()
    bush.castShadow = bush.receiveShadow = true
    bush.name = 'yard plants'
    group.add(bush)
  }
  const bloom = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), blooms.length)
  blooms.forEach(([m, c], i) => {
    bloom.setMatrixAt(i, m)
    bloom.setColorAt(i, c)
  })
  bloom.name = 'yard blooms'
  group.add(bloom)
  return group
}
