// The home as bodies (#74): every thing drawn in the house gets a body and a material, by one
// rule, from data on the object. A thing is a top-level scene object (what a plugin owns: the
// fridge, the build mode's walls and floor, a merged kit of furniture), or any object below one
// that declares its own body (a placed thing, a high chair, a lamp on the sideboard). Its shape is
// the boxes of its solid meshes (a merged kit's per-part boxes, src/kit.ts), fixed together in
// the thing's frame; its material and motion come from `userData.body`, set where it is made:
//
//   userData.body = { material: 'steel' }                          static, steel
//   userData.body = { motion: 'dynamic', material: 'maple', mass: 7 }  moves, 7 kg
//   userData.body = false                                          not a thing (a ghost, a light shaft, the notepad)
//
// Without data a thing is static walnut. Static is the default because most of what plugins
// draw cannot move as one: a kit's furniture is merged into one mesh per material, and the
// house plan is the record of where placed things stand (a nudge it did not record would be
// undone by the next version). Villagers are followers (world.ts), not things here.
// The scene is read again after every plan change, every top-level thing added or removed, and
// every few seconds (src/physics/start.ts): a thing that appeared gets
// its body, one whose parts changed (walls rebuilt, a door swung) gets a new one, one that left
// the scene loses it. Moving a thing as a whole is the world's (World.bind follows its object).
import * as THREE from 'three/webgpu'
import type { Quat, Vec3 } from '../engine/core'
import { isMaterial } from '../engine/materials'
import type { World } from '../engine/world'

export interface BodyData {
  /** A registered material (src/engine/materials.ts); walnut when not given. */
  material?: string
  motion?: 'static' | 'dynamic'
  /** kg, dynamic things: furniture is mostly air, so its boxes' volume would weigh far too much. */
  mass?: number
}

const DEFAULT: Required<Omit<BodyData, 'mass'>> = { material: 'walnut', motion: 'static' }
/** A plane (a floor, a rug, a picture) gets this thickness, m, behind its drawn face. */
const THIN = 0.004
/** An instanced mesh past this many copies is left at its first ones (none in the house comes close). */
const MAX_INSTANCES = 256
/** Boxes are compared to this (m, and quaternion parts) to tell a changed thing from a swaying leaf. */
const SAME = 0.02

type Box = { half: Vec3; at: Vec3; rotation: Quat }
interface Found { object: THREE.Object3D; data: BodyData; meshes: THREE.Mesh[]; kits: Set<THREE.Object3D> }
interface Held { key: string; data: string; boxes: Box[]; motion: 'static' | 'dynamic'; material: string }

/** Why a mesh has no body of its own thing, or null when it is part of one. */
export function notAThing(mesh: THREE.Object3D): string | null {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (o.userData.body === false) return 'not a thing'
    if (o.userData.villagerId !== undefined) return 'a villager (a follower)'
    // The yard, the garden, the trees and the sky round the dollhouse (a theme swaps them): scenery, not things in the house.
    if (o.userData.exterior) return 'outside the house'
  }
  const m = mesh as THREE.Mesh
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined
  // Light shafts, glows, steam and contact shadows: drawn see-through without depth.
  if (mat && mat.transparent && !mat.depthWrite) return 'see-through'
  return null
}

const dataOf = (o: THREE.Object3D): BodyData | null => {
  const d = o.userData.body
  return d && typeof d === 'object' ? (d as BodyData) : null
}

/** The things in the scene: each top-level object, and each object below one that declares a body. */
function find(scene: THREE.Scene, skip: Set<THREE.Object3D>): Found[] {
  const out: Found[] = []
  const visit = (o: THREE.Object3D, thing: Found) => {
    if (o.userData.body === false || o.userData.villagerId !== undefined || o.userData.exterior) return
    if (o !== thing.object && dataOf(o)) {
      const own: Found = { object: o, data: dataOf(o)!, meshes: [], kits: new Set() }
      out.push(own)
      thing = own
    }
    const m = o as THREE.Mesh
    if (m.isMesh && m.geometry && !notAThing(m)) {
      // A kit's merged meshes stand for its parts: their boxes are kept on the kit (src/kit.ts).
      if (m.parent?.userData.regions) thing.kits.add(m.parent)
      else thing.meshes.push(m)
    }
    for (const c of o.children) visit(c, thing)
  }
  for (const top of scene.children) {
    if (skip.has(top)) continue
    const thing: Found = { object: top, data: dataOf(top) ?? {}, meshes: [], kits: new Set() }
    out.push(thing)
    visit(top, thing)
  }
  return out.filter((f) => f.meshes.length || f.kits.size)
}

const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Vector3(), h = new THREE.Vector3()
/** An axis-aligned box in some frame, as a box in the thing's frame, through `m` (that frame to the thing's). */
function boxIn(m: THREE.Matrix4, box: THREE.Box3): Box | null {
  if (box.isEmpty()) return null
  m.decompose(p, q, s)
  box.getCenter(c).applyMatrix4(m)
  box.getSize(h).multiply(s).multiplyScalar(0.5)
  const half: Vec3 = [Math.max(THIN / 4, Math.abs(h.x)), Math.max(THIN / 4, Math.abs(h.y)), Math.max(THIN / 4, Math.abs(h.z))]
  if (!half.every(Number.isFinite) || ![c.x, c.y, c.z].every(Number.isFinite)) return null
  return { half, at: [c.x, c.y, c.z], rotation: [q.x, q.y, q.z, q.w] }
}

/**
 * A mesh's box in its own frame. A plane's box is given THIN depth behind the face it is drawn
 * with (its normal's other side), so a floor's top stays where it is drawn and things standing on
 * it touch it, not sink into it.
 */
function behind(g: THREE.BufferGeometry): THREE.Box3 {
  const box = g.boundingBox!.clone()
  const normal = g.attributes.normal as THREE.BufferAttribute | undefined
  const axes = ['x', 'y', 'z'] as const
  axes.forEach((axis, i) => {
    if (box.max[axis] - box.min[axis] >= THIN) return
    const side = normal ? Math.sign(normal.array[i]) || 1 : 1
    if (side > 0) box.min[axis] = box.max[axis] - THIN
    else box.max[axis] = box.min[axis] + THIN
  })
  return box
}

/** A thing's boxes in its own frame: its world position and turn, at world scale. */
function boxesOf(f: Found): Box[] {
  f.object.updateWorldMatrix(true, false)
  f.object.matrixWorld.decompose(p, q, s)
  const toThing = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert()
  const m = new THREE.Matrix4()
  const out: Box[] = []
  const each = new THREE.Matrix4()
  for (const mesh of f.meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    mesh.updateWorldMatrix(true, false)
    m.multiplyMatrices(toThing, mesh.matrixWorld)
    const local = behind(mesh.geometry)
    // An instanced mesh is many things drawn at once (reeds on a door): a box for each.
    const many = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null
    for (let i = 0; i < (many ? Math.min(many.count, MAX_INSTANCES) : 1); i++) {
      if (many) many.getMatrixAt(i, each)
      const b = boxIn(many ? each.premultiply(m) : m, local)
      if (b) out.push(b)
    }
  }
  for (const kit of f.kits) {
    kit.updateWorldMatrix(true, false)
    m.multiplyMatrices(toThing, kit.matrixWorld)
    for (const r of kit.userData.regions as Array<{ box: THREE.Box3 }>) {
      const b = boxIn(m, r.box)
      if (b) out.push(b)
    }
  }
  return out
}

const dataKey = (data: BodyData) => `${data.motion ?? ''}|${data.material ?? ''}|${data.mass ?? ''}`
const near = (a: readonly number[], b: readonly number[]) => {
  for (let k = 0; k < a.length; k++) if (Math.abs(a[k] - b[k]) > SAME) return false
  return true
}
/** The same parts, give or take SAME: a leaf swaying is not a changed thing. Allocates nothing: it runs over every box on every scan. */
const sameBoxes = (a: Box[], b: Box[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!near(a[i].half, b[i].half) || !near(a[i].at, b[i].at) || !near(a[i].rotation, b[i].rotation)) return false
  return true
}

/** Total box volume, m³, for a dynamic thing that names no mass. */
const volume = (boxes: Box[]) => boxes.reduce((v, b) => v + 8 * b.half[0] * b.half[1] * b.half[2], 0)

export function homeBodies(world: World, scene: THREE.Scene, skip: THREE.Object3D[]) {
  const held = new Map<THREE.Object3D, Held>()
  const skipped = new Set(skip)
  const used = new Set<string>()
  const refused: string[] = []
  let scans = 0
  /** Bodies made again because their thing's parts changed, by key. */
  const rebuilt = new Map<string, number>()
  const scanMs: number[] = []

  const keyFor = (o: THREE.Object3D) => {
    const name = String(o.userData.furniture ?? o.name ?? '').trim().replace(/[^\w .-]+/g, '-').slice(0, 40) || o.type.toLowerCase()
    const top = o.parent && o.parent !== scene ? `${(o.parent.name || 'thing').slice(0, 24)}/` : ''
    let key = `home/${top}${name}`
    for (let n = 2; used.has(key); n++) key = `home/${top}${name}#${n}`
    used.add(key)
    return key
  }

  /** Reads the scene and brings the bodies in line with it. */
  function scan() {
    const t0 = performance.now()
    const found = find(scene, skipped)
    const seen = new Set<THREE.Object3D>()
    for (const f of found) {
      seen.add(f.object)
      const boxes = boxesOf(f)
      const before = held.get(f.object)
      if (before && before.data === dataKey(f.data) && sameBoxes(before.boxes, boxes)) continue
      const key = before?.key ?? keyFor(f.object)
      if (before) {
        world.unbind(key)
        rebuilt.set(key, (rebuilt.get(key) ?? 0) + 1)
      }
      const material = isMaterial(f.data.material) ? f.data.material : DEFAULT.material
      const motion = f.data.motion === 'dynamic' ? 'dynamic' : 'static'
      const density = world.material(material)!.density
      const mass = motion === 'dynamic' ? (typeof f.data.mass === 'number' && f.data.mass > 0 && f.data.mass < 5000 ? f.data.mass : Math.min(500, Math.max(0.05, density * volume(boxes) * 0.2))) : undefined
      if (!boxes.length || !world.bind(key, f.object, { shape: { kind: 'compound', boxes }, motion, material, ...(mass !== undefined ? { mass } : {}) })) {
        if (!before) used.delete(key)
        held.delete(f.object)
        refused.push(key)
        continue
      }
      held.set(f.object, { key, data: dataKey(f.data), boxes, motion, material })
    }
    for (const [object, h] of held) {
      if (seen.has(object)) continue
      world.unbind(h.key)
      used.delete(h.key)
      held.delete(object)
    }
    scans++
    scanMs.push(performance.now() - t0)
    if (scanMs.length > 200) scanMs.splice(0, 100)
  }

  return {
    scan,
    /** The thing a mesh is part of: its body's key, or why it has none. */
    bodyOf(mesh: THREE.Object3D): { key: string } | { none: string } {
      const why = notAThing(mesh)
      if (why) return { none: why }
      let thing: THREE.Object3D | null = null
      for (let o: THREE.Object3D | null = mesh; o && o !== scene; o = o.parent) {
        if (held.has(o)) {
          thing = o
          break
        }
        if (skipped.has(o)) return { none: 'a physics toy' }
      }
      return thing ? { key: held.get(thing)!.key } : { none: 'no body' }
    },
    /** Every thing with a body: its key, name, motion, material and how many boxes it is made of. */
    list: () => [...held].map(([o, h]) => ({ key: h.key, name: o.name, furniture: o.userData.furniture as string | undefined, motion: h.motion, material: h.material, parts: h.boxes.length })),
    stats: () => {
      const sorted = [...scanMs].sort((a, b) => a - b)
      return { scans, refused: refused.slice(-10), rebuilt: Object.fromEntries(rebuilt), scanMs: { median: +(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2), max: +(sorted.at(-1) ?? 0).toFixed(2) } }
    },
    dispose() {
      for (const h of held.values()) world.unbind(h.key)
      held.clear()
    },
  }
}
