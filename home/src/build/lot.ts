// The lot answers the plan (#48): the lawn board, its painted edge, its soft shadow and the
// picket fence grow to hold every room and the room being staked out, a margin of lawn
// round each, and go back exactly as diorama.ts drew them when nothing reaches past the
// old board. The grown lawn is one rectangle with rounded corners holding the old board and
// each room's walls plus MARGIN, so it never steps in at a corner, drawn as one flat shape
// with world-metre UVs on a grass that tiles without seams; the fence runs round it at the
// old board's inset, keeping the old gate where the path still meets the fence.
import * as THREE from 'three/webgpu'
import { YARD_TOP } from '../diorama'
import { canvas, makeNoise, rng, toTexture } from '../paint'
import type { P } from './plan'

/** Lawn beyond a room's outermost wall, before its fence. */
export const MARGIN = 1.0
/** The fence stands this far inside the board's edge, as diorama.ts puts it. */
const INSET = 0.22
const PICKET_GAP = 0.14
const GATE = 0.55
/** One grass tile is this many metres, as diorama.ts lays it. */
const TILE = 3

export type Rect = { x0: number; x1: number; z0: number; z1: number }
const same = (a: Rect, b: Rect, eps = 1e-3) => Math.abs(a.x0 - b.x0) < eps && Math.abs(a.x1 - b.x1) < eps && Math.abs(a.z0 - b.z0) < eps && Math.abs(a.z1 - b.z1) < eps
const clampTo = (r: Rect, to: Rect): Rect => {
  const cx = (v: number) => Math.min(to.x1, Math.max(to.x0, v)), cz = (v: number) => Math.min(to.z1, Math.max(to.z0, v))
  return { x0: cx(r.x0), x1: cx(r.x1), z0: cz(r.z0), z1: cz(r.z1) }
}

/** Corner radius of the grown lawn, in metres; the fence's is this less its inset. */
const ROUND = 0.7

/** The rectangle holding all of these. */
const hull = (rects: Rect[]): Rect => ({
  x0: Math.min(...rects.map((r) => r.x0)), x1: Math.max(...rects.map((r) => r.x1)),
  z0: Math.min(...rects.map((r) => r.z0)), z1: Math.max(...rects.map((r) => r.z1)),
})

/**
 * A rectangle with rounded corners, counter-clockwise seen from above with x right and z down
 * the page: each corner is a quarter circle of `radius` in `steps` pieces.
 */
export function roundedRect(r: Rect, radius: number, steps = 6): P[] {
  const k = Math.max(0, Math.min(radius, (r.x1 - r.x0) / 2, (r.z1 - r.z0) / 2))
  const out: P[] = []
  // Corner centres in drawing order, each with the angle its quarter starts at.
  const corners: Array<[number, number, number]> = [[r.x0 + k, r.z0 + k, -Math.PI / 2], [r.x0 + k, r.z1 - k, Math.PI], [r.x1 - k, r.z1 - k, Math.PI / 2], [r.x1 - k, r.z0 + k, 0]]
  for (const [cx, cz, a0] of corners) for (let i = 0; i <= steps; i++) {
    const a = a0 - (i / steps) * (Math.PI / 2)
    out.push([cx + Math.cos(a) * k, cz + Math.sin(a) * k])
  }
  return out
}

/** diorama.ts's grass colours, painted so the tile wraps: noise on whole lattice periods and speckles drawn across the seams. */
function paintTiledGrass(seed: number) {
  const size = 512
  const [c, g] = canvas(size, size)
  const broad = makeNoise(seed, 8), blade = makeNoise(seed + 7, 128)
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = broad(x / 64, y / 64, 4)
    const b = blade(x / 4, y / 4, 2)
    const stripe = Math.floor(x / (size / 2)) % 2 ? 1 : 0.96
    const k = (0.84 + v * 0.3 + (b - 0.5) * 0.16) * stripe
    const i = (y * size + x) * 4
    img.data[i] = 102 * k + 22
    img.data[i + 1] = 136 * k + 10
    img.data[i + 2] = 56 * k
    img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  const r = rng(seed + 1)
  for (let i = 0; i < 70; i++) {
    const fill = r() < 0.5 ? 'rgba(255, 246, 220, 0.75)' : 'rgba(242, 214, 110, 0.7)'
    const x = r() * size, y = r() * size, rad = 1.6 + r() * 1.6
    g.fillStyle = fill
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath()
      g.arc(x + ox, y + oy, rad, 0, Math.PI * 2)
      g.fill()
    }
  }
  const t = toTexture(c, { repeat: [1 / TILE, 1 / TILE] })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export function makeLot(scene: THREE.Scene, parent: THREE.Object3D) {
  let found: {
    lawn: THREE.Mesh; edge: THREE.Mesh | null; shadow: THREE.Mesh | null; fence: THREE.InstancedMesh; rail: THREE.Mesh | null
    rect: Rect; board: number; gate: P | null
  } | null = null

  const find = () => {
    if (found) return found
    const lawn = scene.getObjectByName('yard lawn') as THREE.Mesh | undefined
    const fence = scene.getObjectByName('picket fence') as THREE.InstancedMesh | undefined
    if (!lawn?.parent || !fence?.isInstancedMesh) return null
    const kids = lawn.parent.children
    const edge = (kids[kids.indexOf(lawn) + 1] as THREE.Mesh | undefined) ?? null
    const shadow = (kids.find((c) => c.name === 'diorama contact shadow') as THREE.Mesh | undefined) ?? null
    const rail = (fence.parent?.children.find((c) => (c as THREE.Mesh).isMesh && c !== fence && (c as THREE.Mesh).material === fence.material) as THREE.Mesh | undefined) ?? null
    const { width: w, height: d } = (lawn.geometry as THREE.PlaneGeometry).parameters
    const rect = { x0: lawn.position.x - w / 2, x1: lawn.position.x + w / 2, z0: lawn.position.z - d / 2, z1: lawn.position.z + d / 2 }
    const board = (edge?.geometry as THREE.BoxGeometry | undefined)?.parameters.height ?? 0.06
    // The gate: the widest gap between neighbouring pickets on one side of the old fence.
    const f = { x0: rect.x0 + INSET, x1: rect.x1 - INSET, z0: rect.z0 + INSET, z1: rect.z1 - INSET }
    const m4 = new THREE.Matrix4(), at = new THREE.Vector3()
    const bySide: Record<keyof Rect, number[]> = { x0: [], x1: [], z0: [], z1: [] }
    for (let i = 0; i < fence.count; i++) {
      fence.getMatrixAt(i, m4)
      at.setFromMatrixPosition(m4)
      for (const s of ['x0', 'x1', 'z0', 'z1'] as const) {
        const onX = s[0] === 'x'
        if (Math.abs((onX ? at.x : at.z) - f[s]) < 0.03) bySide[s].push(onX ? at.z : at.x)
      }
    }
    let gate: P | null = null, widest = 0.3
    for (const s of ['x0', 'x1', 'z0', 'z1'] as const) {
      const v = bySide[s].sort((a, b) => a - b)
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > widest) {
        widest = v[i] - v[i - 1]
        const mid = (v[i] + v[i - 1]) / 2
        gate = s[0] === 'x' ? [f[s], mid] : [mid, f[s]]
      }
    }
    found = { lawn, edge, shadow, fence, rail, rect, board, gate }
    return found
  }

  // The grown lot: lawn, edge, shadow and fence, drawn while it reaches past the old board.
  const grown = new THREE.Group()
  grown.name = 'lot'
  grown.visible = false
  parent.add(grown)
  const grass = paintTiledGrass(5)
  const lawnMat = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 })
  // One board: its top is the lawn and its sides the painted edge, so no two faces lie a hair apart to flicker.
  const edge = new THREE.Mesh(new THREE.BufferGeometry())
  edge.name = 'lot lawn'
  edge.rotation.x = -Math.PI / 2
  const [shadowCanvas, sg] = canvas(256, 256)
  const shadowMap = toTexture(shadowCanvas)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, fog: false }))
  shadow.name = 'lot shadow'
  shadow.rotation.x = -Math.PI / 2
  grown.add(edge, shadow)
  let pickets: THREE.InstancedMesh | null = null
  const railBox = new THREE.BoxGeometry(1, 0.035, 0.02)
  const rails: THREE.Mesh[] = []

  /** Pickets and rails along the fence's line (already inset from the board's edge). */
  const runFence = (line: P[]) => {
    const f = found!
    if (!pickets) {
      pickets = new THREE.InstancedMesh(f.fence.geometry, f.fence.material, 1600)
      pickets.castShadow = pickets.receiveShadow = true
      pickets.frustumCulled = false
      pickets.name = 'lot pickets'
      grown.add(pickets)
    }
    // The gate stays only where the path still meets the fence.
    const onLine = (p: P) => line.some((a, i) => {
      const b = line[(i + 1) % line.length]
      const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2))
      return Math.hypot(p[0] - a[0] - (b[0] - a[0]) * t, p[1] - a[1] - (b[1] - a[1]) * t) < 0.05
    })
    const gp = f.gate && onLine(f.gate) ? f.gate : null
    let n = 0, railN = 0
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
    const rail = (ax: number, az: number, bx: number, bz: number, yaw: number) => {
      const l = Math.hypot(bx - ax, bz - az)
      if (l < 0.05) return
      for (const y of [0.12, 0.32]) {
        let m = rails[railN]
        if (!m) {
          m = new THREE.Mesh(railBox, f.fence.material)
          m.castShadow = true
          rails.push(m)
          grown.add(m)
        }
        m.visible = true
        m.position.set((ax + bx) / 2, YARD_TOP + y, (az + bz) / 2)
        m.rotation.set(0, -yaw, 0)
        m.scale.set(l, 1, 1)
        railN++
      }
    }
    const side = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az)
      const count = Math.max(1, Math.floor(len / PICKET_GAP))
      const yaw = Math.atan2(bz - az, bx - ax)
      q.setFromAxisAngle(up, -yaw)
      let runFrom: number | null = 0
      // The corner picket belongs to the side that ends there.
      for (let i = 1; i <= count; i++) {
        const t = i / count, x = ax + (bx - ax) * t, z = az + (bz - az) * t
        if (gp && Math.hypot(x - gp[0], z - gp[1]) < GATE) {
          if (runFrom !== null && runFrom < t) rail(ax + (bx - ax) * runFrom, az + (bz - az) * runFrom, x, z, yaw)
          runFrom = null
          continue
        }
        if (runFrom === null) runFrom = t
        if (n < pickets!.instanceMatrix.count) pickets!.setMatrixAt(n++, m4.compose(p.set(x, YARD_TOP + 0.22, z), q, one))
      }
      if (runFrom !== null) rail(ax + (bx - ax) * runFrom, az + (bz - az) * runFrom, bx, bz, yaw)
    }
    line.forEach((a, i) => {
      const b = line[(i + 1) % line.length]
      side(a[0], a[1], b[0], b[1])
    })
    pickets.count = n
    pickets.instanceMatrix.needsUpdate = true
    for (let i = railN; i < rails.length; i++) rails[i].visible = false
  }

  /** What is drawn now: the old board and one rectangle per grown room, each easing toward its goal. */
  let shown: Rect[] = []
  let goal: Rect[] = []
  let outline: P[] = []

  const lay = (rects: Rect[]) => {
    const f = found!
    // One clean shape: the old board and every room's rectangle in one rounded rectangle, so no corner steps in.
    const box = hull([f.rect, ...rects])
    outline = roundedRect(box, ROUND)
    // The shape lies in (x, -z) and is turned flat, so its UVs are world metres.
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
    edge.geometry.dispose()
    // ExtrudeGeometry's caps are group 0 (with UVs in shape units, world metres) and its sides group 1.
    edge.geometry = new THREE.ExtrudeGeometry(shape, { depth: f.board, bevelEnabled: false })
    edge.material = [lawnMat, (f.edge?.material as THREE.Material | undefined) ?? lawnMat]
    edge.position.y = YARD_TOP - f.board
    // The board's soft shadow on the table, painted from the same rectangles.
    const xs = outline.map((p) => p[0]), zs = outline.map((p) => p[1])
    const pad = 0.9
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad
    const sx = 256 / (x1 - x0), sz = 256 / (z1 - z0)
    sg.clearRect(0, 0, 256, 256)
    sg.filter = 'blur(18px)'
    sg.fillStyle = 'rgba(70, 38, 20, 0.8)'
    sg.beginPath()
    outline.forEach(([x, z], i) => (i ? sg.lineTo((x - x0) * sx, (z - z0) * sz) : sg.moveTo((x - x0) * sx, (z - z0) * sz)))
    sg.closePath()
    sg.fill()
    sg.filter = 'none'
    shadowMap.needsUpdate = true
    shadow.scale.set(x1 - x0, z1 - z0, 1)
    shadow.position.set((x0 + x1) / 2, YARD_TOP - f.board + 0.001, (z0 + z1) / 2)
    for (const o of [f.lawn, f.edge, f.shadow, f.fence, f.rail]) if (o) o.visible = false
    grown.visible = true
    runFence(roundedRect({ x0: box.x0 + INSET, x1: box.x1 - INSET, z0: box.z0 + INSET, z1: box.z1 - INSET }, ROUND - INSET))
  }

  /** Put the lot back exactly as diorama.ts drew it, and let go of the fence it ran. */
  const restore = () => {
    const f = found
    shown = goal = []
    outline = []
    grown.visible = false
    if (pickets) {
      pickets.removeFromParent()
      pickets.dispose()
      pickets = null
    }
    for (const m of rails.splice(0)) m.removeFromParent()
    if (!f) return
    for (const o of [f.lawn, f.edge, f.shadow, f.fence, f.rail]) if (o) o.visible = true
  }

  const rectOf = (poly: P[], m = MARGIN): Rect => {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1])
    return { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m }
  }

  /** Grow the lot to hold these footprints (world x, z) with a margin of lawn each; none puts it back. */
  const grow = (polys: P[][]) => {
    const f = find()
    if (!f) return
    goal = polys.map((p) => rectOf(p))
    // A new rectangle grows out of the old board's edge; one let go shrinks back into it.
    while (shown.length < goal.length) shown.push(clampTo(goal[shown.length], f.rect))
  }

  const frame = (dt: number) => {
    const f = found
    if (!f || (!shown.length && !goal.length)) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const e = reduce ? 1 : 1 - Math.exp(-dt * 9)
    let moving = false
    shown = shown.map((r, i) => {
      const to = goal[i] ?? clampTo(r, f.rect)
      // The last centimetre or two snaps, so a lot let go is back on the old board in well under a second.
      if (same(r, to, 0.02)) {
        if (!same(r, to, 1e-6)) moving = true
        return { ...to }
      }
      moving = true
      return { x0: r.x0 + (to.x0 - r.x0) * e, x1: r.x1 + (to.x1 - r.x1) * e, z0: r.z0 + (to.z0 - r.z0) * e, z1: r.z1 + (to.z1 - r.z1) * e }
    })
    while (shown.length > goal.length && same(shown[shown.length - 1], clampTo(shown[shown.length - 1], f.rect), 1e-4)) shown.pop()
    const reaches = shown.some((r) => !same(r, clampTo(r, f.rect), 1e-4))
    if (!reaches) {
      if (grown.visible) restore()
      return
    }
    if (moving || !grown.visible) lay(shown)
  }

  /**
   * Where the yard's flowers, stones and shrubs should step aside: the lawn round each room,
   * which would crowd it, and a strip along the old fence wherever the lot has grown past it.
   */
  const clearings = (polys: P[][]): P[][] => {
    const f = find()
    if (!f) return []
    const out: P[][] = []
    const ring = (r: Rect): P[] => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]
    for (const poly of polys) {
      const r = rectOf(poly, MARGIN + 0.3)
      if (same(r, clampTo(r, f.rect))) continue
      out.push(ring(r))
      // The old fence's side the room grew past: clear a strip along it, as wide as the room's reach.
      const b = f.rect, s = 1.4
      if (r.x0 < b.x0) out.push(ring({ x0: b.x0, x1: b.x0 + s, z0: r.z0, z1: r.z1 }))
      if (r.x1 > b.x1) out.push(ring({ x0: b.x1 - s, x1: b.x1, z0: r.z0, z1: r.z1 }))
      if (r.z0 < b.z0) out.push(ring({ x0: r.x0, x1: r.x1, z0: b.z0, z1: b.z0 + s }))
      if (r.z1 > b.z1) out.push(ring({ x0: r.x0, x1: r.x1, z0: b.z1 - s, z1: b.z1 }))
    }
    return out
  }

  const dispose = () => {
    restore()
    grown.removeFromParent()
    railBox.dispose()
    edge.geometry.dispose()
    shadow.geometry.dispose()
    ;(shadow.material as THREE.Material).dispose()
    shadowMap.dispose()
    lawnMat.dispose()
    grass.dispose()
  }

  return {
    grow,
    frame,
    restore,
    clearings,
    dispose,
    /** The lawn's outline as drawn (world x, z), or null while the old board stands. */
    lawn: () => (grown.visible ? outline.map((p) => [...p] as P) : null),
  }
}
