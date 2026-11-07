// The lot answers the plan (#48 look prototype, ?look=lot only): the lawn board, its
// painted edge and the picket fence grow to hold every room and the room being staked
// out, and shrink back exactly when it is let go. diorama.ts draws the yard; this
// stretches the lawn and edge at runtime (keeping the grass where it was), hides the
// old fence and runs a new one in the same paint around the grown boundary. A room
// just built arrives with its first pieces: a braided rug, a reading chair and a lamp.
import * as THREE from 'three/webgpu'
import { YARD_TOP } from '../diorama'
import type { P } from './plan'

/** Lawn beyond the outermost wall, before the fence. */
const MARGIN = 1.1
/** The fence stands this far inside the board's edge, as diorama.ts puts it. */
const INSET = 0.22
const PICKET_GAP = 0.14
const GATE = 0.55
/** How long the first pieces wait for the walls to rise, then how long they take to settle. */
const PIECES_AT = 650, PIECES_MS = 450

type Rect = { x0: number; x1: number; z0: number; z1: number }
type Side = 'x0' | 'x1' | 'z0' | 'z1'

export function makeLot(scene: THREE.Scene, parent: THREE.Object3D) {
  let found: {
    lawn: THREE.Mesh; edge: THREE.Mesh | null; shadow: THREE.Mesh | null; fence: THREE.InstancedMesh; rail: THREE.Mesh | null
    rect: Rect; repeat: THREE.Vector2; offset: THREE.Vector2
    lawnScale: THREE.Vector3; lawnPos: THREE.Vector3; edgeScale: THREE.Vector3; edgePos: THREE.Vector3; shadowScale: THREE.Vector3; shadowPos: THREE.Vector3
    gate: { side: Side; at: number } | null
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
    const map = (lawn.material as THREE.MeshStandardMaterial).map!
    // The gate: the widest gap between neighbouring pickets on one side of the old fence.
    const f = { x0: rect.x0 + INSET, x1: rect.x1 - INSET, z0: rect.z0 + INSET, z1: rect.z1 - INSET }
    const m4 = new THREE.Matrix4(), at = new THREE.Vector3()
    const bySide: Record<Side, number[]> = { x0: [], x1: [], z0: [], z1: [] }
    for (let i = 0; i < fence.count; i++) {
      fence.getMatrixAt(i, m4)
      at.setFromMatrixPosition(m4)
      for (const s of ['x0', 'x1', 'z0', 'z1'] as Side[]) {
        const onX = s[0] === 'x'
        if (Math.abs((onX ? at.x : at.z) - f[s]) < 0.03) bySide[s].push(onX ? at.z : at.x)
      }
    }
    let gate: { side: Side; at: number } | null = null, widest = 0.3
    for (const s of ['x0', 'x1', 'z0', 'z1'] as Side[]) {
      const v = bySide[s].sort((a, b) => a - b)
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > widest) {
        widest = v[i] - v[i - 1]
        gate = { side: s, at: (v[i] + v[i - 1]) / 2 }
      }
    }
    found = {
      lawn, edge, shadow, fence, rail, rect, gate, repeat: map.repeat.clone(), offset: map.offset.clone(),
      lawnScale: lawn.scale.clone(), lawnPos: lawn.position.clone(),
      edgeScale: edge?.scale.clone() ?? new THREE.Vector3(), edgePos: edge?.position.clone() ?? new THREE.Vector3(),
      shadowScale: shadow?.scale.clone() ?? new THREE.Vector3(), shadowPos: shadow?.position.clone() ?? new THREE.Vector3(),
    }
    return found
  }

  // The new fence: the old one's picket shape and paint, and rails as stretched unit boxes.
  const fenceGroup = new THREE.Group()
  fenceGroup.name = 'lot fence'
  fenceGroup.visible = false
  parent.add(fenceGroup)
  let pickets: THREE.InstancedMesh | null = null
  const railBox = new THREE.BoxGeometry(1, 0.035, 0.02)
  const rails: THREE.Mesh[] = []

  const runFence = (r: Rect) => {
    const f = found!
    if (!pickets) {
      pickets = new THREE.InstancedMesh(f.fence.geometry, f.fence.material, 1200)
      pickets.castShadow = pickets.receiveShadow = true
      pickets.frustumCulled = false
      pickets.name = 'lot pickets'
      fenceGroup.add(pickets)
    }
    const fx0 = r.x0 + INSET, fx1 = r.x1 - INSET, fz0 = r.z0 + INSET, fz1 = r.z1 - INSET
    const gate = f.gate
    // The gate stays where the path meets the fence, on the side it was on.
    const gatePoint = (): [number, number] | null => {
      if (!gate) return null
      const s = gate.side
      if (s === 'x0') return [fx0, gate.at]
      if (s === 'x1') return [fx1, gate.at]
      if (s === 'z0') return [gate.at, fz0]
      return [gate.at, fz1]
    }
    const gp = gatePoint()
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
          fenceGroup.add(m)
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
      for (let i = 0; i <= count; i++) {
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
    side(fx0, fz0, fx1, fz0)
    side(fx1, fz0, fx1, fz1)
    side(fx1, fz1, fx0, fz1)
    side(fx0, fz1, fx0, fz0)
    pickets.count = n
    pickets.instanceMatrix.needsUpdate = true
    for (let i = railN; i < rails.length; i++) rails[i].visible = false
  }

  let target: Rect | null = null
  let shown: Rect | null = null
  const same = (a: Rect, b: Rect, eps = 1e-3) => Math.abs(a.x0 - b.x0) < eps && Math.abs(a.x1 - b.x1) < eps && Math.abs(a.z0 - b.z0) < eps && Math.abs(a.z1 - b.z1) < eps

  const lay = (r: Rect) => {
    const f = found!
    const w0 = f.rect.x1 - f.rect.x0, d0 = f.rect.z1 - f.rect.z0
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2
    f.lawn.scale.set(f.lawnScale.x * w / w0, f.lawnScale.y * d / d0, f.lawnScale.z)
    f.lawn.position.set(cx, f.lawnPos.y, cz)
    // The grass stays put under the stretch: the texture repeats as often per metre and starts where it did.
    const map = (f.lawn.material as THREE.MeshStandardMaterial).map!
    map.repeat.set(f.repeat.x * w / w0, f.repeat.y * d / d0)
    map.offset.set(f.offset.x + (r.x0 - f.rect.x0) * f.repeat.x / w0, f.offset.y + (f.rect.z1 - r.z1) * f.repeat.y / d0)
    if (f.edge) {
      f.edge.scale.set(f.edgeScale.x * (w + 0.04) / (w0 + 0.04), f.edgeScale.y, f.edgeScale.z * (d + 0.04) / (d0 + 0.04))
      f.edge.position.set(cx, f.edgePos.y, cz)
    }
    if (f.shadow) {
      // diorama.ts pads the yard's contact shadow by 0.9 m on each side.
      f.shadow.scale.set(f.shadowScale.x * (w + 1.8) / (w0 + 1.8), f.shadowScale.y * (d + 1.8) / (d0 + 1.8), f.shadowScale.z)
      f.shadow.position.set(cx, f.shadowPos.y, cz)
    }
    f.fence.visible = false
    if (f.rail) f.rail.visible = false
    fenceGroup.visible = true
    runFence(r)
  }

  /** Put the lot back exactly as diorama.ts drew it. */
  const restore = () => {
    const f = found
    target = shown = null
    fenceGroup.visible = false
    if (!f) return
    f.lawn.scale.copy(f.lawnScale)
    f.lawn.position.copy(f.lawnPos)
    const map = (f.lawn.material as THREE.MeshStandardMaterial).map!
    map.repeat.copy(f.repeat)
    map.offset.copy(f.offset)
    if (f.edge) {
      f.edge.scale.copy(f.edgeScale)
      f.edge.position.copy(f.edgePos)
    }
    if (f.shadow) {
      f.shadow.scale.copy(f.shadowScale)
      f.shadow.position.copy(f.shadowPos)
    }
    f.fence.visible = true
    if (f.rail) f.rail.visible = true
  }

  /** Grow the lot to hold these footprints (world x, z) with a margin of lawn; none puts it back. */
  const grow = (polys: P[][]) => {
    const f = find()
    if (!f) return
    const r = { ...f.rect }
    for (const poly of polys) for (const [x, z] of poly) {
      r.x0 = Math.min(r.x0, x - MARGIN)
      r.x1 = Math.max(r.x1, x + MARGIN)
      r.z0 = Math.min(r.z0, z - MARGIN)
      r.z1 = Math.max(r.z1, z + MARGIN)
    }
    target = r
    shown ??= { ...f.rect }
  }

  const frame = (dt: number) => {
    if (!found || !target || !shown) return
    if (same(shown, target, 1e-6)) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const e = reduce ? 1 : 1 - Math.exp(-dt * 7)
    for (const k of ['x0', 'x1', 'z0', 'z1'] as const) shown[k] += (target[k] - shown[k]) * e
    if (same(shown, target)) shown = { ...target }
    if (same(shown, found.rect, 1e-6)) restore()
    else lay(shown)
  }

  // ── The first pieces ─────────────────────────────────────────────────────
  const pieces = new THREE.Group()
  pieces.name = 'lot first pieces'
  const velvet = new THREE.MeshStandardMaterial({ color: '#c4704f', roughness: 0.9 })
  const pine = new THREE.MeshStandardMaterial({ color: '#c99a62', roughness: 0.7 })
  const iron = new THREE.MeshStandardMaterial({ color: '#2b2420', roughness: 0.5, metalness: 0.2 })
  const made: THREE.BufferGeometry[] = []
  const geo = <G extends THREE.BufferGeometry>(g: G) => (made.push(g), g)
  let furnished: { roomId: string; at: number; items: THREE.Object3D[] } | null = null

  const chair = () => {
    const g = new THREE.Group()
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0) => {
      const b = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m)
      b.position.set(x, y, z)
      b.rotation.x = rx
      b.castShadow = b.receiveShadow = true
      g.add(b)
    }
    box(0.8, 0.26, 0.78, 0, 0.27, 0, velvet)
    box(0.58, 0.12, 0.6, 0, 0.46, 0.06, velvet)
    box(0.8, 0.52, 0.18, 0, 0.62, -0.31, velvet, -0.12)
    for (const s of [-1, 1]) box(0.14, 0.22, 0.74, s * 0.33, 0.5, 0.02, velvet)
    for (const [x, z] of [[-0.34, -0.32], [0.34, -0.32], [-0.34, 0.32], [0.34, 0.32]]) {
      const leg = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.022, 0.016, 0.14, 8)), pine)
      leg.position.set(x, 0.07, z)
      g.add(leg)
    }
    return g
  }
  const lamp = () => {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 8)), iron)
    pole.position.y = 0.7
    const foot = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.13, 0.14, 0.02, 20)), iron)
    foot.position.y = 0.01
    pole.castShadow = foot.castShadow = true
    g.add(pole, foot)
    const kitchenShade = scene.getObjectByName('reading lamp shade') as THREE.Mesh | undefined
    const shade = kitchenShade ? kitchenShade.clone() : new THREE.Mesh(geo(new THREE.CylinderGeometry(0.13, 0.19, 0.24, 24, 1, true)), new THREE.MeshStandardMaterial({ color: '#f6e6c8', emissive: '#ffc98a', emissiveIntensity: 0.55, side: THREE.DoubleSide }))
    shade.position.set(0, 1.46, 0)
    shade.rotation.set(0, 0, 0)
    g.add(shade)
    return g
  }

  /**
   * Furnish a room just built: a rug in its middle, a reading chair turned to it from the far
   * corner and a lamp beside the chair. `at(along, across)` is a floor point in the new room's
   * frame (along the shared wall, out from it); they rise in once the walls are up.
   */
  const furnish = (roomId: string, at: (along: number, across: number) => P, from: number, to: number, depth: number, dir: P) => {
    clearPieces()
    if (!pieces.parent) parent.add(pieces)
    const yaw = -Math.atan2(dir[1], dir[0])
    const mid = (from + to) / 2
    const items: THREE.Object3D[] = []
    const kitchenRug = scene.getObjectByName('braided rug') as THREE.Mesh | undefined
    if (kitchenRug) {
      const rug = kitchenRug.clone()
      const [x, z] = at(mid, depth / 2 + 0.1)
      const s = Math.min((to - from) * 0.3, depth * 0.4, 1.6)
      rug.scale.set(s, 1, s * 0.72)
      rug.position.set(x, 0.0025, z)
      rug.rotation.set(0, yaw, 0)
      rug.userData.rest = rug.scale.clone()
      items.push(rug)
    }
    const c = chair()
    const [cx, cz] = at(to - 0.75, depth - 0.8)
    const [rx, rz] = at(mid, depth / 2)
    c.position.set(cx, 0, cz)
    c.rotation.y = Math.atan2(rx - cx, rz - cz)
    c.userData.rest = c.scale.clone()
    items.push(c)
    const l = lamp()
    const [lx, lz] = at(to - 0.35, depth - 0.3)
    l.position.set(lx, 0, lz)
    l.userData.rest = l.scale.clone()
    items.push(l)
    for (const o of items) {
      o.scale.setScalar(0.0001)
      pieces.add(o)
    }
    furnished = { roomId, at: performance.now(), items }
  }
  const clearPieces = () => {
    for (const o of [...pieces.children]) o.removeFromParent()
    furnished = null
  }
  /** The pieces grow in after the walls; they go with their room if it is undone. */
  const framePieces = (rooms: string[]) => {
    if (!furnished) return
    if (!rooms.includes(furnished.roomId)) return clearPieces()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = reduce ? 1 : Math.max(0, Math.min(1, (performance.now() - furnished.at - PIECES_AT) / PIECES_MS))
    // A small overshoot, as if set down.
    const e = t >= 1 ? 1 : Math.max(0.0001, 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2))
    for (const o of furnished.items) {
      const rest = o.userData.rest as THREE.Vector3
      o.scale.set(rest.x * e, rest.y * e, rest.z * e)
    }
  }

  const dispose = () => {
    restore()
    clearPieces()
    pieces.removeFromParent()
    fenceGroup.removeFromParent()
    pickets?.dispose()
    railBox.dispose()
    for (const g of made) g.dispose()
    for (const m of [velvet, pine, iron]) m.dispose()
  }

  return { grow, frame, restore, furnish, framePieces, dispose, rect: () => shown && { ...shown } }
}
