// A soft body for any Figure (#104): the felt is skinned to a short spine and to spring bones, so
// it bends, squashes in a wave and wobbles instead of pivoting as rigid parts.
//
// Weights are worked out here from the figure's rest shape, never authored: the hand-made plush and a
// generated villager (#47, a model-written body under a sewn skin) go through the same code.
//   - Body: every vertex is shared between hips, waist and chest by its height.
//   - Whatever stands clear of a slot's core (ears, a tuft, a tail, a hat brim) hangs off a "flop"
//     bone hinged where it leaves the core. The rig swings those on springs (rig.ts).
// Parts that lie on the core (eyes, a muzzle, a mark) are left as they are: plain meshes on their slot.
import * as THREE from 'three/webgpu'
import type { Figure } from './rig'

/** A spring bone: hinged at `bone`, its rest tip `tip` in the parent's space, and the particle the tip chases. */
export interface Flop {
  bone: THREE.Bone
  parent: THREE.Object3D
  tip: THREE.Vector3
  /** Rest length, hinge to tip, in the parent's units. */
  length: number
  /** The particle, in world space, and its velocity. */
  at: THREE.Vector3
  vel: THREE.Vector3
  /** Natural frequency in Hz: long, thin parts swing slower. */
  hz: number
  live: boolean
}

export interface Soft {
  waist: THREE.Bone
  chest: THREE.Bone
  flops: Flop[]
  skeleton: THREE.Skeleton
  /** How many meshes were skinned (the checks read it). */
  skinned: number
}

const MAX_FLOPS = 6
/** Where a part starts to count as standing clear of the core, in core radii, and where it is fully the flop's. */
const CLEAR = 1.1
const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : 0
}
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0
}

interface Piece { mesh: THREE.Mesh; at: THREE.Vector3[]; rho: number[]; group: Int32Array }
interface Cluster { points: { piece: Piece; i: number }[]; centre: THREE.Vector3; radius: number; flop?: number }

function meshesUnder(o: THREE.Object3D, stop: Set<THREE.Object3D>, out: THREE.Mesh[] = []) {
  for (const c of o.children) {
    if (stop.has(c)) continue
    if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.getAttribute('position')) out.push(c as THREE.Mesh)
    meshesUnder(c, stop, out)
  }
  return out
}

/** Each mesh's vertices in `space`, and how far each stands from the slot's core (1 is on it). */
function measure(meshes: THREE.Mesh[], space: THREE.Object3D): { pieces: Piece[]; centre: THREE.Vector3; half: THREE.Vector3 } {
  const inv = space.matrixWorld.clone().invert()
  const m = new THREE.Matrix4()
  if (!meshes.length) return { pieces: [], centre: new THREE.Vector3(), half: new THREE.Vector3(1, 1, 1) }
  const pieces: Piece[] = meshes.map((mesh) => {
    const pos = mesh.geometry.getAttribute('position')
    m.multiplyMatrices(inv, mesh.matrixWorld)
    const at = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m))
    return { mesh, at, rho: [], group: new Int32Array(pos.count).fill(-1) }
  })
  // The core: an ellipsoid about the median vertex, as wide as most of the surface. A long ear or a tail
  // moves a bounding box; it barely moves a median.
  // Measured on the slot's largest mesh alone (the trunk, the skull): small parts on one side would pull the centre over.
  const span = (p: Piece) => new THREE.Box3().setFromPoints(p.at).getSize(new THREE.Vector3())
  const volume = (p: Piece) => { const v = span(p); return v.x * v.y * v.z }
  const all = pieces.reduce((a, b) => (volume(b) > volume(a) ? b : a)).at
  const centre = new THREE.Vector3(median(all.map((p) => p.x)), median(all.map((p) => p.y)), median(all.map((p) => p.z)))
  const half = new THREE.Vector3(
    Math.max(1e-4, quantile(all.map((p) => Math.abs(p.x - centre.x)), 0.9)),
    Math.max(1e-4, quantile(all.map((p) => Math.abs(p.y - centre.y)), 0.9)),
    Math.max(1e-4, quantile(all.map((p) => Math.abs(p.z - centre.z)), 0.9)),
  )
  const raw = (p: THREE.Vector3) => Math.hypot((p.x - centre.x) / half.x, (p.y - centre.y) / half.y, (p.z - centre.z) / half.z)
  const unit = median(all.map(raw)) || 1
  for (const p of pieces) p.rho = p.at.map((q) => raw(q) / unit)
  return { pieces, centre, half }
}

/** The parts of a slot that stand clear of its core, each one a connected patch, patches that sit together joined. */
function clusters(pieces: Piece[]): Cluster[] {
  const found: Cluster[] = []
  for (const piece of pieces) {
    const n = piece.at.length
    const parent = Int32Array.from({ length: n }, (_, i) => i)
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]]
      return i
    }
    // A part its maker fixed to the body (userData.soft === false: a collar) bends with the spine and never flops.
    const fixed = piece.mesh.userData.soft === false
    const clear = (i: number) => !fixed && piece.rho[i] > CLEAR
    const index = piece.mesh.geometry.getIndex()
    const tri = index ? index.count / 3 : n / 3
    const corner = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k)
    for (let t = 0; t < tri; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2)
      if (clear(a) && clear(b)) parent[find(a)] = find(b)
      if (clear(b) && clear(c)) parent[find(b)] = find(c)
    }
    const byRoot = new Map<number, Cluster>()
    for (let i = 0; i < n; i++) {
      if (!clear(i)) continue
      const r = find(i)
      let c = byRoot.get(r)
      if (!c) byRoot.set(r, (c = { points: [], centre: new THREE.Vector3(), radius: 0 }))
      c.points.push({ piece, i })
    }
    found.push(...byRoot.values())
  }
  const settle = (c: Cluster) => {
    c.centre.set(0, 0, 0)
    for (const { piece, i } of c.points) c.centre.add(piece.at[i])
    c.centre.divideScalar(c.points.length)
    c.radius = Math.max(...c.points.map(({ piece, i }) => piece.at[i].distanceTo(c.centre)))
  }
  found.forEach(settle)
  // Join patches that are the same thing: an ear and its lining, the strands of one tuft, a sphere's seam.
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let a = 0; a < found.length; a++) {
      for (let b = a + 1; b < found.length; b++) {
        if (found[a].centre.distanceTo(found[b].centre) > 0.7 * Math.max(found[a].radius, found[b].radius)) continue
        found[a].points.push(...found[b].points)
        settle(found[a])
        found.splice(b, 1)
        merged = true
        break outer
      }
    }
  }
  return found.filter((c) => c.points.length >= 6).sort((a, b) => b.points.length - a.points.length)
}

/**
 * Skins a figure in place and returns its soft parts, or null when it has no body to bend
 * (a flat paper doll, a floating spirit: those keep their own motion).
 */
export function soften(fig: Figure): Soft | null {
  const { root, pose, head, hands } = fig
  root.updateMatrixWorld(true)
  const bodyMeshes = meshesUnder(pose, new Set<THREE.Object3D>([head, ...hands]))
  if (!bodyMeshes.length) return null
  const body = measure(bodyMeshes, pose)
  const ys = body.pieces.flatMap((p) => p.at.map((q) => q.y))
  const y0 = quantile(ys, 0.02), y1 = quantile(ys, 0.98)
  const tall = y1 - y0
  if (!(tall > 1e-3)) return null

  // The spine: hips (the pose group itself), then a waist and a chest that carry the head and hands.
  const waist = new THREE.Bone()
  waist.name = 'waist'
  waist.position.set(0, y0 + tall * 0.3, 0)
  const chest = new THREE.Bone()
  chest.name = 'chest'
  chest.position.set(0, tall * 0.32, 0)
  pose.add(waist)
  waist.add(chest)
  root.updateMatrixWorld(true)
  chest.attach(head)
  hands.forEach((h, i) => {
    chest.attach(h)
    // A hand that is itself a mesh gets a group to be its bone, so the mesh can stretch between chest and hand.
    if ((h as THREE.Mesh).isMesh) {
      const bone = new THREE.Group()
      bone.name = h.name
      bone.position.copy(h.position)
      bone.quaternion.copy(h.quaternion)
      bone.scale.copy(h.scale)
      bone.userData = h.userData
      h.userData = {}
      chest.add(bone)
      bone.add(h)
      h.position.set(0, 0, 0)
      h.quaternion.identity()
      h.scale.set(1, 1, 1)
      hands[i] = h = bone
    }
    if (h.userData.rest) (h.userData.rest as THREE.Vector3).copy(h.position)
  })
  root.updateMatrixWorld(true)
  // Arms: the meshes directly in a hand's group (what it holds sits a level deeper), measured from the body's axis.
  const armPieces = hands.map((h) => measure(h.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh), pose).pieces)

  const bones: THREE.Object3D[] = [pose, waist, chest, head, ...hands]
  const flops: Flop[] = []
  const headSlot = measure(meshesUnder(head, new Set()), head)
  const slots = [
    // A body part hangs off the spine bone at its own height: a tail off the hips, a scarf end off the chest.
    { ...body, space: pose as THREE.Object3D, clusters: clusters(body.pieces), parentAt: (y: number): THREE.Object3D => ((y - y0) / tall < 0.25 ? pose : (y - y0) / tall < 0.6 ? waist : chest) },
    { ...headSlot, space: head as THREE.Object3D, clusters: clusters(headSlot.pieces), parentAt: (): THREE.Object3D => head },
  ]
  // The largest few parts flop; the rest stay rigid on their slot.
  const chosen = slots.flatMap((s) => s.clusters.map((c) => ({ s, c }))).sort((a, b) => b.c.points.length - a.c.points.length).slice(0, MAX_FLOPS)
  for (const { s, c } of chosen) {
    // Hinged where the part leaves the core (the mean of its points nearest the core), its tip the mean of the farthest.
    const sorted = [...c.points].sort((a, b) => a.piece.rho[a.i] - b.piece.rho[b.i])
    const at = (q: { piece: Piece; i: number }) => q.piece.at[q.i]
    const mean = (ps: typeof sorted) => ps.reduce((v, q) => v.add(at(q)), new THREE.Vector3()).divideScalar(ps.length)
    const k = Math.max(1, Math.ceil(sorted.length * 0.2))
    let hinge = mean(sorted.slice(0, k))
    let tip = mean(sorted.slice(-k))
    const lo = sorted[0].piece.rho[sorted[0].i], hi = sorted[sorted.length - 1].piece.rho[sorted[sorted.length - 1].i]
    // Only what sticks out flops: its far end well clear of where it leaves the core.
    if (hi - lo < 0.25) continue
    if (tip.distanceTo(hinge) < 0.6 * c.radius) {
      // A part that lies along the core (an ear hanging down the side of the head) has no near and far end by
      // that measure. Take the two ends of its length instead: it is sewn on at the upper one and hangs from it.
      const far = (from: THREE.Vector3) => c.points.reduce((a, b) => (at(b).distanceTo(from) > at(a).distanceTo(from) ? b : a))
      const a = at(far(c.centre)), b = at(far(a))
      const [top, bottom] = a.y >= b.y ? [a, b] : [b, a]
      const span = top.distanceTo(bottom)
      hinge = mean(c.points.filter((q) => at(q).distanceTo(top) < span * 0.25))
      tip = mean(c.points.filter((q) => at(q).distanceTo(bottom) < span * 0.25))
    }
    if (tip.distanceTo(hinge) < 1e-3) continue
    // In the parent bone's space (the slot is measured in `space`).
    const parent = s.parentAt(hinge.y)
    const toParent = new THREE.Matrix4().multiplyMatrices(parent.matrixWorld.clone().invert(), s.space.matrixWorld)
    const bone = new THREE.Bone()
    bone.name = `flop ${flops.length}`
    bone.position.copy(hinge).applyMatrix4(toParent)
    parent.add(bone)
    const tipIn = tip.clone().applyMatrix4(toParent)
    const length = tipIn.distanceTo(bone.position)
    c.flop = bones.length
    bones.push(bone)
    // Soft at the hinge, the flop's own from 70% of the way to the tip.
    const along = tip.clone().sub(hinge)
    const reach = along.lengthSq()
    for (const q of c.points) {
      q.piece.group[q.i] = c.flop
      q.piece.rho[q.i] = smooth(0.05, 0.7, at(q).clone().sub(hinge).dot(along) / reach) // from here on: the flop's share of this vertex
    }
    flops.push({ bone, parent, tip: tipIn, length, at: new THREE.Vector3(), vel: new THREE.Vector3(), hz: THREE.MathUtils.clamp(0.45 / Math.sqrt(length * 10), 1.4, 3.4), live: false })
  }
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[])

  let skinned = 0
  const seen = new WeakSet<THREE.BufferGeometry>()
  const skin = (piece: Piece, slot: 'body' | 'head' | number): THREE.SkinnedMesh | null => {
    const n = piece.at.length
    if (slot === 'head' && !piece.group.some((g) => g >= 0)) return null
    // An arm: the end nearest the body stays on the chest, the far end goes with the hand.
    const reach = typeof slot === 'number' ? piece.at.map((q) => Math.hypot(q.x, q.z)) : []
    const near = Math.min(...reach), far = Math.max(...reach)
    const index = new Uint16Array(n * 4)
    const weight = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const flop = piece.group[i] >= 0 ? piece.rho[i] : 0
      const rest = 1 - flop
      if (slot === 'head') {
        index[i * 4] = 3
        weight[i * 4] = rest
      } else if (typeof slot === 'number') {
        const out = smooth(0.1, 0.75, (reach[i] - near) / Math.max(1e-6, far - near))
        index.set([2, slot], i * 4)
        weight.set([1 - out, out], i * 4)
      } else {
        // Hips below, chest above, the waist between: two of the three at any height.
        const u = (piece.at[i].y - y0) / tall
        const up = smooth(0.08, 0.5, u), top = smooth(0.42, 0.86, u)
        index.set([0, 1, 2], i * 4)
        weight.set([(1 - up) * rest, (up - top) * rest, top * rest], i * 4)
      }
      if (flop > 0) {
        index[i * 4 + 3] = piece.group[i]
        weight[i * 4 + 3] = flop
      }
    }
    const old = piece.mesh
    const geometry = seen.has(old.geometry) ? old.geometry.clone() : old.geometry
    seen.add(geometry)
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4))
    const mesh = new THREE.SkinnedMesh(geometry, old.material)
    mesh.name = old.name
    mesh.userData = old.userData
    mesh.castShadow = old.castShadow
    mesh.receiveShadow = old.receiveShadow
    mesh.renderOrder = old.renderOrder
    mesh.visible = old.visible
    mesh.layers.mask = old.layers.mask
    mesh.position.copy(old.position)
    mesh.quaternion.copy(old.quaternion)
    mesh.scale.copy(old.scale)
    const parent = old.parent!
    const at = parent.children.indexOf(old)
    for (const c of [...old.children]) mesh.add(c)
    parent.children[at] = mesh
    mesh.parent = parent
    old.parent = null
    mesh.updateMatrixWorld(true)
    mesh.bind(skeleton, mesh.matrixWorld)
    // The bind pose's bounds would cull a villager bent out of them; they are small and almost always on screen.
    mesh.frustumCulled = false
    skinned++
    return mesh
  }
  for (const p of body.pieces) skin(p, 'body')
  for (const p of headSlot.pieces) skin(p, 'head')
  armPieces.forEach((ps, i) => ps.forEach((p) => skin(p, 4 + i)))
  return { waist, chest, flops, skeleton, skinned }
}

/**
 * What the checks read off a softened figure as it stands: how much was skinned, the largest error in a vertex's
 * weights (they must sum to 1), and how far skinning moves any vertex at rest (it must move none), in the mesh's units.
 */
export function softReport(fig: Figure) {
  const soft = fig.soft
  if (!soft) return null
  fig.root.updateMatrixWorld(true)
  soft.skeleton.update()
  let weightError = 0, restError = 0, vertices = 0
  const rest = new THREE.Vector3(), now = new THREE.Vector3()
  fig.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const pos = m.geometry.getAttribute('position'), w = m.geometry.getAttribute('skinWeight')
    for (let i = 0; i < pos.count; i++) {
      weightError = Math.max(weightError, Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1))
      restError = Math.max(restError, m.getVertexPosition(i, now).distanceTo(rest.fromBufferAttribute(pos, i)))
    }
    vertices += pos.count
  })
  return { skinned: soft.skinned, flops: soft.flops.length, bones: soft.skeleton.bones.length, vertices, weightError, restError }
}
