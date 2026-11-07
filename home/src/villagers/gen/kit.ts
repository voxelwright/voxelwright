// #47 look regroup 2, the trusted felt kit (screenshots/villager-gen/LEARNING-look.md). The model builds the
// species body and says where things go: its eyes (eye-left, eye-right) give the eye line, and its role mark
// (villager.mark()) gives the side and the holder. Village's own code then makes the parts that carry the
// character and the craft: button eyes and cheeks set into the felt, and one hand-made mark per role, sized
// against the head and dyed in the owner's felt. The role comes from the spec, so the mark cannot drift.
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

export interface KitInput {
  /** The model's meshes, world space (the group sits at the origin), with their slot and mark. */
  meshes: { mesh: THREE.Mesh; slot: Role; mark: boolean }[]
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
  if (!core) throw new Error('kit: no unmarked head part to anchor on')
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

  // ── Face ──────────────────────────────────────────────────────────────────
  const eyeSlots = (['eye-left', 'eye-right'] as const).map((slot) => meshes.filter((m) => m.slot === slot).map((m) => m.mesh))
  if (eyeSlots.some((l) => !l.length)) throw new Error('kit: an eye slot is empty')
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
    const colR = 0.27 * cw, bandH = 0.16 * cw
    const y0 = top - 0.28 * head.r.y
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
    const puffY = bandH + colH + 0.02 * cw
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      at(frame, new THREE.SphereGeometry(0.15 * cw, 18, 12), main, Math.cos(a) * 0.23 * cw, puffY, Math.sin(a) * 0.23 * cw)
    }
    at(frame, new THREE.SphereGeometry(0.2 * cw, 20, 14), main, 0, puffY + 0.07 * cw, 0)
  } else if (role === 'tutor') {
    // A mortarboard: a skullcap hugging the crown, a stitched felt board lying level on it, a cord and a fringed tassel.
    const tilt = -0.3
    const cap = at(frame, new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, 1.12), felt(dark, seamTexture(dark, seed + 5, false)))
    cap.userData.colour = dark
    cap.scale.copy(head.r).multiplyScalar(1.05)
    cap.rotation.x = tilt
    frame.position.copy(head.c)
    const capTop = head.r.y * 1.05 * Math.cos(tilt)
    const bw = THREE.MathUtils.clamp(ow, 1.1 * cw, 1.28 * cw), t = 0.09 * cw
    const bz = -0.12 * head.r.z
    const board = at(frame, new RoundedBoxGeometry(bw, t, bw, 3, t * 0.35), felt(accent, borderTexture(accent, seed + 9)), 0, capTop + t * 0.25, bz)
    board.rotation.y = 0.0
    const by = capTop + t * 0.75
    at(frame, new THREE.CylinderGeometry(0.06 * cw, 0.06 * cw, 0.04 * cw, 16), felt(dark), 0, by + 0.005 * cw, bz).userData.colour = dark
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
  } else if (role === 'gardener') {
    // A soft sun hat on the back of the head, tilted back: a domed crown with a ribbon, a felt brim with a rolled, stitched edge.
    const Rb = THREE.MathUtils.clamp(0.85 * ow, 0.8 * cw, 0.92 * cw)
    const cr = 0.85 * head.r.x
    // Tilted back only a little: a brim tilted back far is seen edge-on from the dollhouse camera (33 degrees up).
    frame.position.set(head.c.x, head.c.y + 0.55 * head.r.y, head.c.z - 0.45 * head.r.z)
    frame.rotation.x = -0.22
    at(frame, new THREE.SphereGeometry(cr, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), main).scale.set(1, 0.85, 1)
    const ribbon = at(frame, new THREE.TorusGeometry(cr * 0.97, 0.07 * cw, 10, 36), felt(dark, seamTexture(dark, seed + 5)), 0, 0.06 * cw, 0)
    ribbon.rotation.x = Math.PI / 2
    ribbon.userData.colour = dark
    at(frame, new THREE.SphereGeometry(Rb, 40, 12), felt(accent, seamTexture(accent, seed + 11, false)), 0, 0, 0).scale.set(1, 0.1, 1)
    const rim = at(frame, new THREE.TorusGeometry(Rb * 0.98, 0.045 * cw, 10, 56), felt(light, seamTexture(light, seed + 13)), 0, 0, 0)
    rim.rotation.x = Math.PI / 2
    rim.userData.colour = light
    // Back on the head until the face shows past the brim from 25 degrees steeper than the camera (checks.ts asks 20).
    const steep = 0.58 + THREE.MathUtils.degToRad(25)
    const upward = new THREE.Vector3(0, Math.sin(steep), Math.cos(steep))
    for (let k = 0; k < 8; k++) {
      frame.updateMatrixWorld(true)
      const blocked = eyeAt.some((e) => {
        ray.set(e.clone().addScaledVector(upward, 0.002), upward)
        ray.far = 2
        return ray.intersectObjects(frame.children, false).length > 0
      })
      if (!blocked) break
      frame.position.z -= 0.1 * head.r.z
      frame.position.y -= 0.03 * head.r.y
    }
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
    const L = 0.42 * H_, rp = 0.045 * H_
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
    // A magnifying lens swung up beside the head: a hinge knob on the temple, a solid arm, a thick open ring.
    const tube = 0.034 * H_, R = 0.085 * H_
    const hinge = onEllipsoid(head, new THREE.Vector3(side, 0.35, 0.05))
    const ring = new THREE.Vector3(head.c.x + side * (head.r.x + R * 0.9), top + 0.17 * H_ - R - tube, head.c.z + 0.1 * head.r.z)
    const lens = at(frame, new THREE.TorusGeometry(R, tube, 14, 40), felt(accent, seamTexture(accent, seed + 21)), ring.x, ring.y, ring.z)
    lens.rotation.y = -side * 0.3
    const toward = hinge.clone().sub(ring).setZ(0).normalize()
    const q = ring.clone().addScaledVector(toward, R)
    rod(frame, hinge, q, 0.02 * H_, felt(dark)).userData.colour = dark
    at(frame, new THREE.SphereGeometry(0.032 * H_, 14, 10), felt(dark), hinge.x, hinge.y, hinge.z).userData.colour = dark
  } else if (role === 'tidier') {
    // A feather duster: a felt knot capping the model's handle, and six feathers fanned up and out of it.
    slot = 'held'
    const handle = meshes.filter((m) => m.slot === 'held' && !m.mark).map((m) => m.mesh)
    const target = markAt ?? new THREE.Vector3(head.c.x + side * cw, top, head.c.z)
    let tip = target.clone(), axis = new THREE.Vector3(0, 1, 0)
    let best = Infinity
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
          tip = w
          const o = c.clone()
          o[k] -= (sign * s[k]) / 2
          axis = w.clone().sub(o.applyMatrix4(h.matrixWorld)).normalize()
        }
      }
    }
    if (!handle.length) notes.push('kit: no handle in the held slot; the plume stands where the model put it')
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
