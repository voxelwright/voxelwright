// #47 the trusted felt kit (screenshots/villager-gen/LEARNING-look.md), the default since the kit council. The model
// builds the species body and says where things go: its eye discs (eye-left, eye-right) give the eye line, and the one
// small anchor it passes to villager.mark() gives the side and the holder (the crown, above an ear, the back, or the
// duster handle's top knot). Village's own code then makes the parts that carry the character and the craft: button
// eyes and cheeks set into the felt, the held prop's handle closed in its mitten, and one hand-made mark per role,
// sized against the head, with stitched holes where ears come up through it, dyed in the owner's felt. The role is
// the requested one (assemble.ts), so the mark cannot drift with the model's about().
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { canvas, toTexture } from '../../paint'
import { fuzzFill, srgb, stitchPath } from '../kinds'
import type { Role } from '../../props/wire'

type Felt = (c: string, map?: THREE.Texture | null) => THREE.Material
/** A part the kit adds: its slot, and what assemble.ts and the checks read from userData. */
export interface KitPart { mesh: THREE.Mesh; slot: Role }
export interface KitResult { add: KitPart[]; remove: Set<THREE.Mesh>; notes: string[] }

/** Button eyes: radius over the head core's width (the hand-made plush: 0.06). */
const EYE = 0.06
/** A soft blush, kept off the owners' hues by the caller. */
export const BLUSH = '#e2a99c'

/** A colour mixed towards another, as #rrggbb. */
const mix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()

/** Felt with a stitched border inset from every edge: a board's top and sides. */
function borderTexture(base: string, seed: number) {
  const W = 128, H = 128
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(base))
  const m = 10
  stitchPath(g, (t) => {
    const p = t * 4, k = Math.floor(p), f = p - k
    const s = W - 2 * m
    return k === 0 ? [m + f * s, m] : k === 1 ? [W - m, m + f * s] : k === 2 ? [W - m - f * s, H - m] : [m, H - m - f * s]
  }, 36)
  return toTexture(c)
}

/** Knitted felt: fuzz with ribs running along v (a stocking cap's length). */
function knitTexture(base: string, seed: number) {
  const W = 256, H = 128
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(base))
  g.strokeStyle = 'rgba(40, 25, 20, 0.16)'
  g.lineWidth = 3
  for (let x = 4; x < W; x += 12) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, H)
    g.stroke()
  }
  g.strokeStyle = 'rgba(255, 245, 230, 0.12)'
  g.lineWidth = 2
  for (let x = 10; x < W; x += 12) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, H)
    g.stroke()
  }
  return toTexture(c)
}

/** Plain felt fuzz with one running stitch round the middle (a band, a brim's edge). */
function seamTexture(base: string, seed: number, stitches = true) {
  const W = 256, H = 64
  const [c, g] = canvas(W, H)
  fuzzFill(g, W, H, seed, srgb(base))
  if (stitches) stitchPath(g, (t) => [t * W, H * 0.5], 48)
  return toTexture(c)
}

interface Ellipsoid { c: THREE.Vector3; r: THREE.Vector3 }

/** The point on an axis-aligned ellipsoid in a direction from its centre. */
function onEllipsoid(e: Ellipsoid, dir: THREE.Vector3) {
  const d = dir.clone().normalize()
  const k = 1 / Math.sqrt((d.x / e.r.x) ** 2 + (d.y / e.r.y) ** 2 + (d.z / e.r.z) ** 2)
  return e.c.clone().addScaledVector(d, k)
}

/** A part's size in its own axes (as checks.ts volumeOf): a tilted brim does not outweigh the head. */
function volumeOf(m: THREE.Mesh) {
  m.geometry.computeBoundingBox()
  const s = m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(m.matrixWorld))
  return Math.abs(s.x * s.y * s.z)
}

/** Each mesh of a local frame as a world-space mesh (the frame carries no scale; only leaves are scaled). */
function flatten(frame: THREE.Object3D): THREE.Mesh[] {
  frame.updateMatrixWorld(true)
  const out: THREE.Mesh[] = []
  frame.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.matrixWorld.decompose(m.position, m.quaternion, m.scale)
    out.push(m)
  })
  for (const m of out) {
    m.removeFromParent()
    m.updateMatrix()
    m.updateMatrixWorld(true)
  }
  return out
}

const at = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}
/** A capsule from a to b in the frame. */
function rod(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b)
  const m = at(parent, new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 6, 12), mat)
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return m
}

/** Every vertex of a mesh in world space (its matrixWorld must be current). */
function worldVertices(m: THREE.Mesh, each: (v: THREE.Vector3) => void) {
  const p = m.geometry.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) each(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld))
}

/** Where a part passes through a plane: its section's centre and half extents in the plane's own x and z. */
interface Crossing { mesh: THREE.Mesh; x: number; z: number; hx: number; hz: number }

/**
 * The parts that pass through the plane y = 0 of `plane` (a frame with no scale): each triangle edge that crosses it
 * gives a point, and each part's points give its section's box in the plane. Ears, horns and stalks come up through a
 * hat this way; the kit leaves them room (a crown between them) and stitches a felt hole round each (a grommet).
 */
function crossings(plane: THREE.Object3D, parts: THREE.Mesh[]): Crossing[] {
  plane.updateMatrixWorld(true)
  const inv = plane.matrixWorld.clone().invert()
  const out: Crossing[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (const m of parts) {
    const toPlane = inv.clone().multiply(m.matrixWorld)
    const pos = m.geometry.attributes.position, index = m.geometry.index
    const n = index ? index.count : pos.count
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    const edge = (p: THREE.Vector3, q: THREE.Vector3) => {
      if ((p.y > 0) === (q.y > 0)) return
      const t = p.y / (p.y - q.y)
      const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    for (let i = 0; i + 2 < n; i += 3) {
      const at = (k: number) => (index ? index.getX(i + k) : i + k)
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(toPlane)
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(toPlane)
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(toPlane)
      edge(a, b); edge(b, c); edge(c, a)
    }
    if (x1 >= x0) out.push({ mesh: m, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 })
  }
  // An ear's lining inside the ear: one hole, the ear's.
  return out.filter((c) => !out.some((o) => o !== c && o.hx * o.hz > c.hx * c.hz && Math.abs(c.x - o.x) <= o.hx && Math.abs(c.z - o.z) <= o.hz))
}

/** A stitched felt hole round each crossing inside a hat's footprint, lying in the plane: the ear comes up through it. */
function grommets(plane: THREE.Object3D, list: Crossing[], tube: number, mat: THREE.Material, inside: (c: Crossing) => boolean) {
  for (const c of list) {
    if (!inside(c)) continue
    const r = (c.hx + c.hz) / 2 + tube * 0.45
    const g = at(plane, new THREE.TorusGeometry(r, tube, 8, 28), mat, c.x, 0, c.z)
    g.rotation.x = Math.PI / 2
    g.scale.set((c.hx + tube * 0.45) / r, (c.hz + tube * 0.45) / r, 1)
  }
}

/**
 * A stitched felt hole where each part comes up through a dome (a crown, a skullcap): the ellipsoid with radii `r` at
 * `shell`'s origin, in its own axes, above `minY`. The part's long axis is walked from end to end; where it passes
 * out through the dome a ring goes round it, shaped to the part's section and lying across its axis.
 */
function domeGrommets(shell: THREE.Object3D, r: THREE.Vector3, minY: number, parts: THREE.Mesh[], tube: number, mat: THREE.Material) {
  shell.updateMatrixWorld(true)
  const inv = shell.matrixWorld.clone().invert()
  let n = 0
  for (const m of parts) {
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox!
    const toShell = inv.clone().multiply(m.matrixWorld)
    const size = bb.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(toShell)).toArray().map(Math.abs)
    const k = size.indexOf(Math.max(...size))
    const c = bb.getCenter(new THREE.Vector3()), lo = c.clone(), hi = c.clone()
    lo.setComponent(k, bb.min.getComponent(k)); hi.setComponent(k, bb.max.getComponent(k))
    lo.applyMatrix4(toShell); hi.applyMatrix4(toShell)
    const f = (p: THREE.Vector3) => (p.x / r.x) ** 2 + (p.y / r.y) ** 2 + (p.z / r.z) ** 2 - 1
    let prev = lo.clone(), hit: THREE.Vector3 | null = null
    for (let i = 1; i <= 48 && !hit; i++) {
      const p = lo.clone().lerp(hi, i / 48)
      if ((f(prev) < 0) !== (f(p) < 0)) {
        const a = Math.abs(f(prev)), b = Math.abs(f(p))
        const q = prev.clone().lerp(p, a / Math.max(1e-9, a + b))
        if (q.y >= minY) hit = q
      }
      prev = p
    }
    if (!hit) continue
    const axes = [0, 1, 2].map((i) => new THREE.Vector3().setFromMatrixColumn(toShell, i).normalize())
    const [i, j] = [0, 1, 2].filter((x) => x !== k)
    const along = hi.clone().sub(lo).normalize()
    const ax = axes[i].clone().addScaledVector(along, -axes[i].dot(along)).normalize()
    const ay = new THREE.Vector3().crossVectors(along, ax)
    const ri = size[i] / 2 + tube * 0.4, rj = size[j] / 2 + tube * 0.4
    const rr = (ri + rj) / 2
    const g = at(shell, new THREE.TorusGeometry(rr, tube, 8, 28), mat, hit.x, hit.y, hit.z)
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, along))
    g.scale.set(ri / rr, rj / rr, 1)
    n++
  }
  return n
}

export interface KitInput {
  /** The model's meshes, world space (the group sits at the origin), with their slot, mark and felt colour as shown. */
  meshes: { mesh: THREE.Mesh; slot: Role; mark: boolean; colour: string }[]
  role: string
  accent: string
  felt: Felt
  seed: number
  /** The blush, moved off the owners' hues by the caller. */
  blush: string
}

/**
 * The kit on one villager. Returns the parts to add (world space, in their slot) and the model's parts to drop:
 * its eyes, and every part it passed to villager.mark(). Throws when there is no head or eye to anchor on.
 */
export function feltKit(input: KitInput): KitResult {
  const { meshes, role, accent, felt, seed } = input
  const notes: string[] = []
  const remove = new Set<THREE.Mesh>()
  const add: KitPart[] = []
  for (const { mesh } of meshes) mesh.updateMatrixWorld(true)

  // The head core: the largest unmarked head part that is not an eye (as checks.ts coresOf).
  const headParts = meshes.filter((m) => m.slot === 'head' && !m.mark).map((m) => m.mesh)
  const core = headParts.reduce<THREE.Mesh | null>((a, m) => (!a || volumeOf(m) > volumeOf(a) ? m : a), null)
  if (!core) throw new Error('the head itself is tagged with villager.mark(); the home makes the role\'s mark, so pass villager.mark() only the small anchor the module notes describe, never the head or a group holding it')
  const hb = new THREE.Box3().setFromObject(core, true)
  const head: Ellipsoid = { c: hb.getCenter(new THREE.Vector3()), r: hb.getSize(new THREE.Vector3()).multiplyScalar(0.5) }
  const cw = head.r.x * 2
  // The head as the eye reads it, ears and all: every unmarked head part's width.
  const outline = new THREE.Box3()
  for (const m of headParts) outline.expandByObject(m, true)
  const ow = Math.max(cw, outline.max.x - outline.min.x)
  const figure = new THREE.Box3()
  for (const { mesh, slot } of meshes) if (slot !== 'held') figure.expandByObject(mesh, true)
  const H = figure.max.y
  const top = head.c.y + head.r.y
  // The head as it reads from above near a hat: every unmarked head part's width between two heights (ears and flaps
  // there count; the tips of tall ears above the crown do not, or a rabbit's board would be sized to its ear tips).
  const widthBetween = (y0: number, y1: number) => {
    let x0 = head.c.x - head.r.x, x1 = head.c.x + head.r.x
    for (const m of headParts) worldVertices(m, (v) => {
      if (v.y >= y0 && v.y <= y1) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x) }
    })
    return x1 - x0
  }
  // Ears, horns, stalks: the unmarked head parts besides the core, the ones that can come up through a hat.
  const ears = headParts.filter((m) => m !== core)

  // ── Face ──────────────────────────────────────────────────────────────────
  const eyeSlots = (['eye-left', 'eye-right'] as const).map((slot) => meshes.filter((m) => m.slot === slot).map((m) => m.mesh))
  if (eyeSlots.some((l) => !l.length)) throw new Error('an eye slot is empty; tag one small dark disc where each eye goes with villager.tag(object, \'eye-left\') and \'eye-right\'')
  const centres = eyeSlots.map((list) => {
    const b = new THREE.Box3()
    for (const m of list) b.expandByObject(m, true)
    return b.getCenter(new THREE.Vector3())
  })
  // The eye's facing: its thinnest own axis (a button disc), turned outwards; a round eye faces out from the head and forwards.
  const facing = eyeSlots.map((list, i) => {
    const big = list.reduce((a, m) => (volumeOf(m) > volumeOf(a) ? m : a))
    big.geometry.computeBoundingBox()
    const s = big.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(big.matrixWorld)).toArray().map(Math.abs)
    const out = centres[i].clone().sub(head.c).normalize().add(new THREE.Vector3(0, 0, 0.8)).normalize()
    const k = s.indexOf(Math.min(...s))
    if (Math.min(...s) > 0.6 * Math.max(...s)) return out
    const axis = new THREE.Vector3().setFromMatrixColumn(big.matrixWorld, k).normalize()
    return axis.dot(out) < 0 ? axis.negate() : axis
  })
  // Symmetric about the head's middle: the mean of the two eyes, mirrored, so the pair is never irregular.
  const mid = (centres[0].x + centres[1].x) / 2
  const half = (Math.abs(centres[0].x - mid) + Math.abs(centres[1].x - mid)) / 2
  const eyeY = (centres[0].y + centres[1].y) / 2, eyeZ = (centres[0].z + centres[1].z) / 2
  const fx = (Math.abs(facing[0].x) + Math.abs(facing[1].x)) / 2, fy = (facing[0].y + facing[1].y) / 2, fz = (facing[0].z + facing[1].z) / 2
  // Faces the kit may sit on: every unmarked part but the eyes, the hands and the held prop.
  const surfaces = meshes.filter((m) => !m.mark && m.slot !== 'eye-left' && m.slot !== 'eye-right' && m.slot !== 'held' && m.slot !== 'hand-left' && m.slot !== 'hand-right').map((m) => m.mesh)
  const ray = new THREE.Raycaster()
  const normal = new THREE.Matrix3()
  /** Where a ray along -dir towards `p` meets the felt near `p` (within `reach`), and the felt's normal there. */
  const land = (p: THREE.Vector3, dir: THREE.Vector3, reach: number, on: THREE.Object3D[] = surfaces) => {
    ray.set(p.clone().addScaledVector(dir, 0.2), dir.clone().negate())
    ray.far = 0.2 + reach
    const hit = ray.intersectObjects(on, false).find((h) => h.point.distanceTo(p) <= reach && h.face)
    if (!hit) return null
    normal.getNormalMatrix(hit.object.matrixWorld)
    return { point: hit.point, normal: hit.face!.normal.clone().applyMatrix3(normal).normalize(), object: hit.object }
  }
  const r = THREE.MathUtils.clamp(EYE * cw, 0.011, 0.03)
  const button = new THREE.MeshStandardMaterial({ color: '#1e1715', roughness: 0.22 })
  const shine = new THREE.MeshStandardMaterial({ color: '#fbf6ee', roughness: 0.35, emissive: '#fbf6ee', emissiveIntensity: 0.25 })
  const blush = felt(input.blush)
  const Z = new THREE.Vector3(0, 0, 1)
  let placed = 0
  const eyeAt: THREE.Vector3[] = []
  for (const [i, sx] of [[0, Math.sign(centres[0].x - mid) || -1], [1, Math.sign(centres[1].x - mid) || 1]] as const) {
    const want = new THREE.Vector3(mid + sx * half, eyeY, eyeZ)
    const f = new THREE.Vector3(sx * fx, fy, fz).normalize()
    const hit = land(want, f, Math.max(2.5 * r, 0.03))
    const p = hit ? hit.point : want
    const n = hit ? hit.normal.clone().multiplyScalar(0.7).addScaledVector(f, 0.3).normalize() : f
    if (hit) placed++
    eyeAt.push(p.clone())
    const frame = new THREE.Group()
    frame.position.copy(p)
    frame.quaternion.setFromUnitVectors(Z, n)
    // A domed button sunk a little into the felt, so its rim never stands off a curved face.
    at(frame, new THREE.SphereGeometry(r, 20, 14), button, 0, 0, -0.12 * r).scale.set(1, 1, 0.5)
    at(frame, new THREE.SphereGeometry(r * 0.24, 10, 8), shine, -sx * r * 0.32, r * 0.36, 0.3 * r)
    for (const m of flatten(frame)) {
      m.userData.colour = m.material === button ? '#1e1715' : '#fbf6ee'
      add.push({ mesh: m, slot: i === 0 ? 'eye-left' : 'eye-right' })
    }
    // A felt cheek below and outside the eye, flat on the face.
    const cheekAt = want.clone().add(new THREE.Vector3(sx * r * 1.1, -r * 2.3, 0))
    // Only on the face the eye sits on (or the head core): never on a tusk, a trunk or a hand in front of it.
    const ch = land(cheekAt, f, Math.max(3 * r, 0.04), [...new Set([hit?.object ?? core, core])])
    if (ch) {
      const c = new THREE.Group()
      c.position.copy(ch.point)
      c.quaternion.setFromUnitVectors(Z, ch.normal)
      at(c, new THREE.SphereGeometry(r * 1.25, 16, 10), blush, 0, 0, -0.05 * r).scale.set(1, 0.72, 0.2)
      for (const m of flatten(c)) {
        m.userData.colour = input.blush
        add.push({ mesh: m, slot: 'head' })
      }
    }
  }
  for (const list of eyeSlots) for (const m of list) remove.add(m)
  notes.push(`kit: button eyes r ${r.toFixed(3)} (${placed} of 2 set on the felt), cheeks`)


  // ── Grip ──────────────────────────────────────────────────────────────────
  // The held prop's handle sits inside the mitten that holds it, and a felt wrap in the mitten's colour closes round
  // it, so the prop reads as held rather than hovering by the hand. The whole prop moves (at most a short way) so
  // the handle's axis runs through the mitten's middle; a chunky prop (a book, a can) is moved only until the
  // mitten overlaps its edge.
  const held = meshes.filter((m) => m.slot === 'held')
  const mittens = meshes.filter((m) => m.slot === 'hand-left' || m.slot === 'hand-right')
  if (held.length && mittens.length) {
    const hb = new THREE.Box3()
    for (const { mesh } of held) hb.expandByObject(mesh, true)
    const hc = hb.getCenter(new THREE.Vector3())
    const mitten = mittens.reduce((a, m) => (new THREE.Box3().setFromObject(m.mesh, true).distanceToPoint(hc) < new THREE.Box3().setFromObject(a.mesh, true).distanceToPoint(hc) ? m : a))
    const mBox = new THREE.Box3().setFromObject(mitten.mesh, true)
    const mc = mBox.getCenter(new THREE.Vector3())
    const mSize = mBox.getSize(new THREE.Vector3())
    const mr = Math.min(mSize.x, mSize.y, mSize.z) / 2
    // Handle-like parts: long, and thinner across than the mitten. The one whose axis passes nearest the mitten is the grip.
    let grip: { a: THREE.Vector3; b: THREE.Vector3; r: number; d: number; p: THREE.Vector3 } | null = null
    for (const { mesh } of held) {
      mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox!
      const s3 = bb.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld)).toArray().map(Math.abs)
      const k = s3.indexOf(Math.max(...s3))
      const across = Math.max(...s3.filter((_, i) => i !== k))
      if (s3[k] < 2 * across || across > 2.6 * mr) continue
      const c = bb.getCenter(new THREE.Vector3()), lo = c.clone(), hi = c.clone()
      lo.setComponent(k, bb.min.getComponent(k)); hi.setComponent(k, bb.max.getComponent(k))
      lo.applyMatrix4(mesh.matrixWorld); hi.applyMatrix4(mesh.matrixWorld)
      const seg = new THREE.Line3(lo, hi)
      const t = THREE.MathUtils.clamp(seg.closestPointToPointParameter(mc, false), 0.12, 0.88)
      const p = seg.at(t, new THREE.Vector3())
      const d = p.distanceTo(mc)
      if (!grip || d < grip.d) grip = { a: lo, b: hi, r: across / 2, d, p }
    }
    let move = new THREE.Vector3()
    if (grip) move = mc.clone().sub(grip.p)
    else if (hb.distanceToPoint(mc) > 0) move = mc.clone().sub(hb.clampPoint(mc, new THREE.Vector3())).multiplyScalar(1 + (0.5 * mr) / Math.max(1e-6, hb.distanceToPoint(mc)))
    const MAX = 0.08
    if (move.length() > MAX) move.setLength(MAX)
    if (move.length() > 1e-4) {
      for (const { mesh } of held) {
        mesh.position.add(move)
        mesh.updateMatrixWorld(true)
      }
      notes.push(`kit: held prop moved ${move.length().toFixed(3)} so ${grip ? 'its handle runs through the mitten' : 'the mitten overlaps it'}`)
    }
    if (grip) {
      // The wrap: a soft felt ring in the mitten's felt round the handle, at the mitten's middle, along the handle's axis.
      const axis = grip.b.clone().sub(grip.a).normalize()
      const w = new THREE.Group()
      w.position.copy(mc)
      w.quaternion.setFromUnitVectors(Z, axis)
      const tube = THREE.MathUtils.clamp(0.55 * mr, 0.008, 0.03)
      at(w, new THREE.TorusGeometry(grip.r + tube * 0.55, tube, 10, 24), felt(mitten.colour), 0, 0, 0).scale.set(1, 1, 1.5)
      for (const m of flatten(w)) {
        m.userData.colour = mitten.colour
        add.push({ mesh: m, slot: 'held' })
      }
      notes.push('kit: held prop wrapped in the mitten')
    }
  }

  // ── Role mark ─────────────────────────────────────────────────────────────
  const marked = meshes.filter((m) => m.mark)
  const mb = new THREE.Box3()
  for (const { mesh } of marked) mb.expandByObject(mesh, true)
  const markAt = mb.isEmpty() ? null : mb.getCenter(new THREE.Vector3())
  // The side a one-sided mark goes on: where the model put it, else +x.
  const side = markAt && Math.abs(markAt.x - head.c.x) > 0.02 * cw ? Math.sign(markAt.x - head.c.x) : 1
  const main = felt(accent, seamTexture(accent, seed + 3, false))
  const dark = mix(accent, '#2a1c16', 0.28), light = mix(accent, '#f4ead8', 0.32)
  const frame = new THREE.Group()
  let slot: Role = 'head'
  const H_ = H

  if (role === 'cook') {
    // A pleated toque: a stitched band sunk in the crown, a column flaring a little, a cloud of balls on top.
    // Between the ears: the column narrows (down to 0.18 of the head) so ears that rise beside it stay out of its felt.
    let colR = 0.27 * cw
    const bandH = 0.16 * cw
    const y0 = top - 0.28 * head.r.y
    const probe = new THREE.Group()
    probe.position.set(head.c.x, y0 + bandH, head.c.z - 0.05 * head.r.z)
    const gap = Math.min(...crossings(probe, ears).map((c) => Math.hypot(c.x, c.z) - Math.max(c.hx, c.hz)), Infinity)
    if (gap < colR * 1.16 + 0.02 * cw) {
      colR = Math.max(0.22 * cw, (gap - 0.02 * cw) / 1.16)
      notes.push(`kit: hat: toque narrowed to ${(colR / cw).toFixed(2)} of the head, between the ears`)
    }
    const colH = Math.max(0.62 * cw, 0.33 * H_ - (top - y0) - bandH - 0.24 * cw)
    frame.position.set(head.c.x, y0, head.c.z - 0.05 * head.r.z)
    const band = at(frame, new THREE.CylinderGeometry(colR * 1.12, colR * 1.12, bandH, 32), felt(accent, seamTexture(dark, seed + 5)), 0, bandH / 2, 0)
    band.userData.colour = dark
    const col = new THREE.CylinderGeometry(colR * 1.14, colR, colH, 36, 6)
    const p = col.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.05 * Math.cos(a * 12)
      p.setXYZ(i, x * k, p.getY(i), z * k)
    }
    col.computeVertexNormals()
    at(frame, col, main, 0, bandH + colH / 2 - 0.02 * cw, 0)
    const puffY = bandH + colH + 0.02 * cw, ps = Math.max(0.9, colR / (0.27 * cw))
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      at(frame, new THREE.SphereGeometry(0.15 * cw * ps, 18, 12), main, Math.cos(a) * 0.23 * cw * ps, puffY, Math.sin(a) * 0.23 * cw * ps)
    }
    at(frame, new THREE.SphereGeometry(0.2 * cw * ps, 20, 14), main, 0, puffY + 0.07 * cw * ps, 0)
  } else if (role === 'tutor') {
    // A mortarboard worn as a cap: a skullcap hugging the crown, a thin stitched board lying on it about as wide as
    // the head with its ears where the board sits (council: a wider, thicker board was a slab hiding the head from
    // above), a cord and a fringed tassel, and a stitched felt hole round each ear that comes up through the board.
    const tilt = -0.3
    const cap = at(frame, new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, 1.0), felt(dark, seamTexture(dark, seed + 5, false)))
    cap.userData.colour = dark
    cap.scale.copy(head.r).multiplyScalar(1.04)
    cap.rotation.x = tilt
    frame.position.copy(head.c)
    const capTop = head.r.y * 1.04 * Math.cos(tilt)
    const wBand = widthBetween(head.c.y - 0.2 * head.r.y, top + 0.05 * head.r.y)
    const bw = THREE.MathUtils.clamp(0.95 * wBand, 1.04 * cw, 1.18 * cw), t = 0.055 * cw
    const bz = -0.12 * head.r.z
    const board = at(frame, new RoundedBoxGeometry(bw, t, bw, 3, t * 0.4), felt(accent, borderTexture(accent, seed + 9)), 0, capTop + t * 0.2, bz)
    board.rotation.y = 0.0
    const by = capTop + t * 0.7
    at(frame, new THREE.CylinderGeometry(0.06 * cw, 0.06 * cw, 0.035 * cw, 16), felt(dark), 0, by + 0.005 * cw, bz).userData.colour = dark
    const corner = new THREE.Vector3(side * bw * 0.46, by, bz + bw * 0.46)
    rod(frame, new THREE.Vector3(0, by + 0.012 * cw, bz), corner.clone().setY(by + 0.012 * cw), 0.02 * cw, felt(dark)).userData.colour = dark
    const knot = at(frame, new THREE.SphereGeometry(0.045 * cw, 12, 10), felt(dark), corner.x, by - 0.01 * cw, corner.z)
    knot.userData.colour = dark
    const tcapY = by - t - 0.03 * cw
    at(frame, new THREE.CylinderGeometry(0.04 * cw, 0.055 * cw, 0.1 * cw, 14), felt(dark), corner.x, tcapY, corner.z).userData.colour = dark
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2
      const sx = Math.cos(a) * 0.03 * cw, sz = Math.sin(a) * 0.03 * cw
      rod(frame, new THREE.Vector3(corner.x + sx, tcapY - 0.02 * cw, corner.z + sz), new THREE.Vector3(corner.x + sx * 1.5, tcapY - 0.2 * cw, corner.z + sz * 1.5), 0.016 * cw, felt(light)).userData.colour = light
    }
    // Ears through the board: a hole stitched round each, in the board's plane.
    const plane = new THREE.Group()
    plane.position.set(0, capTop + t * 0.2, bz)
    frame.add(plane)
    frame.updateMatrixWorld(true)
    const through = crossings(plane, ears)
    grommets(plane, through, 0.4 * t + 0.012 * cw, felt(dark), (c) => Math.abs(c.x) < bw / 2 && Math.abs(c.z) < bw / 2)
    for (const g of plane.children) g.userData.colour = dark
    // And where they come out of the skullcap.
    const shell = new THREE.Group()
    shell.rotation.x = tilt
    frame.add(shell)
    const holes = domeGrommets(shell, head.r.clone().multiplyScalar(1.04), Math.cos(1.0) * head.r.y * 1.04, ears, 0.025 * cw, felt(dark))
    for (const g of shell.children) g.userData.colour = dark
    if (plane.children.length + holes) notes.push(`kit: hat: ${plane.children.length + holes} stitched hole(s) for ears (${holes} in the skullcap)`)
  } else if (role === 'gardener') {
    // A soft sun hat worn on the head, not behind it: a domed crown covering the skull with a ribbon, and a felt brim
    // with a rolled, stitched edge, tilted so its front lifts clear of the face (tilted, not slid back: slid back it
    // read as a halo). Ears and stalks come up through stitched holes in the crown or the brim, never through felt.
    const wBand = widthBetween(head.c.y, top + 0.05 * head.r.y)
    const Rb = THREE.MathUtils.clamp(0.78 * wBand, 0.76 * cw, 0.82 * cw)
    const lift = 0.5, cr = 0.9 * head.r.x, crz = 0.9 * head.r.z
    let tilt = -0.3
    frame.position.set(head.c.x, head.c.y + lift * head.r.y, head.c.z - 0.08 * head.r.z)
    frame.rotation.x = tilt
    at(frame, new THREE.SphereGeometry(Rb, 40, 12), felt(accent, seamTexture(accent, seed + 11, false)), 0, 0, 0).scale.set(1, 0.09, 1)
    const rim = at(frame, new THREE.TorusGeometry(Rb * 0.98, 0.045 * cw, 10, 56), felt(light, seamTexture(light, seed + 13)), 0, 0, 0)
    rim.rotation.x = Math.PI / 2
    rim.userData.colour = light
    // The crown covers the skull above the brim with room to spare, and rises at least an eighth of the height over
    // the head, so a small head on a big body (a snail) still wears a hat that breaks its outline.
    const crownH = Math.max(0.8 * cr, (1 - lift) * head.r.y + 0.12 * cw, top + 0.13 * H_ - (head.c.y + lift * head.r.y))
    at(frame, new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), main).scale.set(cr, crownH, crz)
    const ribbon = at(frame, new THREE.TorusGeometry(cr * 0.99, 0.06 * cw, 10, 36), felt(dark, seamTexture(dark, seed + 5)), 0, 0.05 * cw, 0)
    ribbon.rotation.x = Math.PI / 2
    ribbon.scale.set(1, crz / cr, 1)
    ribbon.userData.colour = dark
    // Tilt the front up until the face shows past the brim from 25 degrees steeper than the camera (checks.ts asks 20);
    // only past a 0.5 rad tilt (where the brim turns edge-on to the camera) does the hat move back a little.
    const steep = 0.58 + THREE.MathUtils.degToRad(25)
    const upward = new THREE.Vector3(0, Math.sin(steep), Math.cos(steep))
    for (let k = 0; k < 12; k++) {
      frame.updateMatrixWorld(true)
      const blocked = eyeAt.some((e) => {
        ray.set(e.clone().addScaledVector(upward, 0.002), upward)
        ray.far = 2
        return ray.intersectObjects(frame.children, false).length > 0
      })
      if (!blocked) break
      if (tilt > -0.5) frame.rotation.x = tilt -= 0.05
      else frame.position.z -= 0.08 * head.r.z
    }
    // Ears and stalks: a stitched hole where each comes out of the crown, or through the brim beyond it.
    frame.updateMatrixWorld(true)
    const before = frame.children.length
    const holes = domeGrommets(frame, new THREE.Vector3(cr, crownH, crz), 0.02 * cw, ears, 0.03 * cw, felt(dark))
    const through = crossings(frame, ears)
    grommets(frame, through, 0.035 * cw, felt(dark), (c) => Math.hypot(c.x / cr, c.z / crz) > 1 && Math.hypot(c.x, c.z) < Rb)
    for (const g of frame.children.slice(before)) g.userData.colour = dark
    notes.push(`kit: hat: sun hat tilted ${tilt.toFixed(2)}${frame.children.length > before ? `, ${frame.children.length - before} stitched hole(s) for ears (${holes} in the crown)` : ''}`)
  } else if (role === 'carer') {
    // A knitted stocking cap: a ribbed band, one bent tube narrowing to a blunt end, and a fluffy pom-pom swallowing it.
    const base = 0.3
    frame.position.set(head.c.x, head.c.y + base * head.r.y, head.c.z - 0.05 * head.r.z)
    frame.rotation.x = -0.15
    const rb = head.r.x * Math.sqrt(1 - base * base) * 0.97, rt = 0.32 * head.r.x
    const L = Math.max(1.05 * cw, 0.2 * H_ + (1 - base) * head.r.y)
    const bend = side * 0.75 * cw, droop = 0.5 * cw
    const geo = new THREE.CylinderGeometry(rt, rb, L, 28, 16)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + L / 2) / L
      p.setXYZ(i, p.getX(i) + bend * t * t, p.getY(i) + L / 2 - droop * t * t * t, p.getZ(i))
    }
    geo.computeVertexNormals()
    at(frame, geo, felt(accent, knitTexture(accent, seed + 15)))
    const band = at(frame, new THREE.TorusGeometry(rb * 1.02, 0.09 * cw, 10, 36), felt(dark, knitTexture(dark, seed + 17)), 0, 0.04 * cw, 0)
    band.rotation.x = Math.PI / 2
    band.userData.colour = dark
    // Ears up through the cap: a knitted hole round each, at the band.
    frame.updateMatrixWorld(true)
    const through = crossings(frame, ears)
    const before = frame.children.length
    grommets(frame, through, 0.04 * cw, felt(dark, knitTexture(dark, seed + 17)), (c) => Math.hypot(c.x, c.z) < rb)
    for (const g of frame.children.slice(before)) g.userData.colour = dark
    if (frame.children.length > before) notes.push(`kit: hat: ${frame.children.length - before} ear(s) through the cap, knitted holes`)
    const end = new THREE.Vector3(bend, L - droop, 0)
    const pr = Math.max(0.055 * H_, 0.3 * head.r.x)
    const pom = felt(light, seamTexture(light, seed + 19, false))
    at(frame, new THREE.SphereGeometry(pr * 0.8, 18, 12), pom, end.x, end.y, end.z).userData.colour = light
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, b = k % 2 ? 0.5 : -0.4
      const d = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b))
      at(frame, new THREE.SphereGeometry(pr * 0.5, 12, 10), pom, end.x + d.x * pr * 0.5, end.y + d.y * pr * 0.5, end.z + d.z * pr * 0.5).userData.colour = light
    }
  } else if (role === 'keeper') {
    // A fat felt pencil tucked behind one ear: eraser, ferrule, an octagonal body, a sharpened tip and a blunt lead.
    const L = 0.44 * H_, rp = 0.05 * H_
    const a = THREE.MathUtils.degToRad(38)
    const dir = new THREE.Vector3(side * Math.sin(a), Math.cos(a), -0.22).normalize()
    const anchor = onEllipsoid(head, new THREE.Vector3(side * 0.85, 0.45, -0.3))
    frame.position.copy(anchor).addScaledVector(dir, -0.16 * L)
    frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    const eraser = at(frame, new THREE.CapsuleGeometry(rp * 0.95, 0.06 * L, 6, 16), felt(light), 0, 0.05 * L, 0)
    eraser.userData.colour = light
    at(frame, new THREE.CylinderGeometry(rp * 1.06, rp * 1.06, 0.08 * L, 16), felt(dark, seamTexture(dark, seed + 5)), 0, 0.13 * L, 0).userData.colour = dark
    at(frame, new THREE.CylinderGeometry(rp, rp, 0.6 * L, 8), main, 0, 0.46 * L, 0)
    at(frame, new THREE.ConeGeometry(rp, 0.2 * L, 8), felt(light), 0, 0.86 * L, 0).userData.colour = light
    at(frame, new THREE.SphereGeometry(rp * 0.36, 10, 8), felt(dark), 0, 0.93 * L, 0).userData.colour = dark
  } else if (role === 'maker') {
    // A magnifying lens swung up beside the head: a hinge knob on the temple, a solid arm reaching up and out, an elbow
    // knob, and an open ring with a thick rim (council: the thin lens and its short, hidden arm did not read).
    const tube = 0.036 * H_, R = 0.1 * H_
    const hinge = onEllipsoid(head, new THREE.Vector3(side, 0.3, 0.3))
    const ring = new THREE.Vector3(head.c.x + side * (head.r.x + R + tube + 0.04 * H_), top + 0.17 * H_ - R - tube, head.c.z + 0.12 * head.r.z)
    const lens = at(frame, new THREE.TorusGeometry(R, tube, 16, 44), felt(accent, seamTexture(accent, seed + 21)), ring.x, ring.y, ring.z)
    lens.rotation.y = -side * 0.3
    const toward = hinge.clone().sub(ring).setZ(0).normalize()
    const q = ring.clone().addScaledVector(toward, R)
    rod(frame, hinge, q, 0.026 * H_, felt(dark)).userData.colour = dark
    at(frame, new THREE.SphereGeometry(0.036 * H_, 14, 10), felt(dark), hinge.x, hinge.y, hinge.z).userData.colour = dark
    at(frame, new THREE.SphereGeometry(0.034 * H_, 14, 10), felt(dark), q.x, q.y, q.z).userData.colour = dark
    // The glass: a pale, glossy, see-through disc in the ring, so it reads as a lens and not a felt doughnut. Not part
    // of the mark (it carries no owner colour), and it moves with the head.
    const glass = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 40), new THREE.MeshStandardMaterial({ color: '#dcebf0', roughness: 0.12, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }))
    glass.position.copy(ring)
    glass.rotation.y = -side * 0.3
    glass.updateMatrixWorld(true)
    glass.userData.colour = '#dcebf0'
    add.push({ mesh: glass, slot: 'head' })
  } else if (role === 'tidier') {
    // A feather duster: a felt knot capping the model's handle, and six feathers fanned up and out of it.
    slot = 'held'
    const handle = meshes.filter((m) => m.slot === 'held' && !m.mark).map((m) => m.mesh)
    const target = markAt ?? new THREE.Vector3(head.c.x + side * cw, top, head.c.z)
    let tip = target.clone(), axis = new THREE.Vector3(0, 1, 0)
    let best = Infinity, tipMesh: THREE.Mesh | null = null
    for (const h of handle) {
      h.geometry.computeBoundingBox()
      const b = h.geometry.boundingBox!, s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3())
      const k = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z'
      for (const sign of [-1, 1]) {
        const e = c.clone()
        e[k] += (sign * s[k]) / 2
        const w = e.clone().applyMatrix4(h.matrixWorld)
        const d = w.distanceTo(target)
        if (d < best) {
          best = d
          tipMesh = h
          tip = w
          const o = c.clone()
          o[k] -= (sign * s[k]) / 2
          axis = w.clone().sub(o.applyMatrix4(h.matrixWorld)).normalize()
        }
      }
    }
    if (!handle.length) notes.push('kit: no handle in the held slot; the plume stands where the model put it')
    // A handle that ends below the top of the head is lengthened along its own axis (in its own felt, at most a fifth
    // of the height), so the plume stands beside the head and not at the shoulder.
    const want = top + 0.06 * H_
    if (tipMesh && tip.y < want && axis.y > 0.3) {
      const len = Math.min(0.2 * H_, (want - tip.y) / axis.y)
      const own = meshes.find((m) => m.mesh === tipMesh)!
      const ext = new THREE.Group()
      const end = tip.clone().addScaledVector(axis, len)
      rod(ext, tip.clone().addScaledVector(axis, -0.01 * H_), end, 0.012 * H_, felt(own.colour))
      for (const m of flatten(ext)) {
        m.userData.colour = own.colour
        add.push({ mesh: m, slot: 'held' })
      }
      tip = end
      notes.push(`kit: held prop: the duster's handle lengthened ${len.toFixed(3)} so the plume clears the head`)
    }
    const kr = 0.035 * H_
    frame.position.copy(tip)
    // The fan opens across the view: its plane holds the handle's axis and faces forwards (+z).
    const across = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1))
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0)
    across.normalize()
    frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, axis, new THREE.Vector3().crossVectors(across, axis)))
    at(frame, new THREE.SphereGeometry(kr, 14, 10), felt(dark, seamTexture(dark, seed + 5)), 0, 0, 0).userData.colour = dark
    const fl = 0.22 * H_, fr = 0.042 * H_
    for (let k = 0; k < 7; k++) {
      const a = THREE.MathUtils.degToRad(-72 + k * 24)
      const d = new THREE.Vector3(Math.sin(a), Math.cos(a), (k % 2 ? 0.25 : -0.2)).normalize()
      const f = at(frame, new THREE.SphereGeometry(1, 14, 10), k % 2 ? felt(light) : main, 0, 0, 0)
      f.scale.set(fr, fl / 2, fr * 0.6)
      f.position.copy(d).multiplyScalar(fl / 2 + kr * 0.2)
      f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)
      if (k % 2) f.userData.colour = light
    }
  } else if (role === 'messenger') {
    // A post flag on the back: a pole sunk in the back, a waving felt flag to one side at the top, a ball finial.
    slot = 'body'
    const low = marked.reduce<THREE.Mesh | null>((a, m) => (!a || new THREE.Box3().setFromObject(m.mesh, true).min.y < new THREE.Box3().setFromObject(a, true).min.y ? m.mesh : a), null)
    const lb = low ? new THREE.Box3().setFromObject(low, true) : null
    const base = lb ? new THREE.Vector3((lb.min.x + lb.max.x) / 2, lb.min.y, (lb.min.z + lb.max.z) / 2) : new THREE.Vector3(head.c.x, top - 0.4 * H_, head.c.z - head.r.z)
    const pr = 0.02 * H_
    const poleTop = top + 0.36 * H_
    frame.position.copy(base)
    at(frame, new THREE.CylinderGeometry(pr, pr * 1.1, poleTop - base.y, 12), felt(dark, seamTexture(dark, seed + 5, false)), 0, (poleTop - base.y) / 2, 0).userData.colour = dark
    at(frame, new THREE.SphereGeometry(pr * 2, 14, 10), felt(light), 0, poleTop - base.y + pr, 0).userData.colour = light
    const fw = 0.24 * H_, fh = 0.14 * H_, ft = 0.025 * H_
    const flag = new RoundedBoxGeometry(fw, fh, ft, 2, ft * 0.45)
    // RoundedBox has few inner vertices; a gentle wave along x still bends its faces.
    const fp = flag.attributes.position
    for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) + Math.sin(((fp.getX(i) + fw / 2) / fw) * Math.PI) * 0.15 * fh)
    flag.computeVertexNormals()
    at(frame, flag, felt(accent, borderTexture(accent, seed + 23)), side * (fw / 2 - pr * 0.5), poleTop - base.y - fh / 2 - pr, 0)
  } else {
    notes.push(`kit: no mark for role "${role}"; the model's mark stays`)
    return { add, remove, notes }
  }
  for (const { mesh } of marked) remove.add(mesh)
  const parts = flatten(frame)
  for (const m of parts) {
    m.userData.mark = true
    m.userData.accent = true
    m.userData.colour ??= accent
    add.push({ mesh: m, slot })
  }
  notes.push(`kit: ${role}'s mark, ${parts.length} parts in the owner's felt (the model's ${marked.length} dropped)`)
  return { add, remove, notes }
}
