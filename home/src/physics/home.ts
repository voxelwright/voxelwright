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
import type { LooseParts, Turned } from '../kit'

export interface BodyData {
  /** A registered material (src/engine/materials.ts); walnut when not given. */
  material?: string
  motion?: 'static' | 'dynamic'
  /** kg, dynamic things: furniture is mostly air, so its boxes' volume would weigh far too much. */
  mass?: number
  /** Its body is the ball, or the can standing on its y, inside the box round all its parts (a mug, a plate, a ball), so it rolls. */
  round?: 'ball' | 'can'
  /** 1/s: how fast its spin dies, in place of what its material gives (an apple is no true ball: it rolls a little and lies still). */
  spin?: number
}

const DEFAULT: Required<Omit<BodyData, 'mass' | 'round' | 'spin'>> = { material: 'walnut', motion: 'static' }
/** A plane (a floor, a rug, a picture) gets this thickness, m, behind its drawn face. */
const THIN = 0.004
/** An instanced mesh past this many copies is left at its first ones (none in the house comes close). */
const MAX_INSTANCES = 256
/** Boxes are compared to this (m, and quaternion parts) to tell a changed thing from a swaying leaf. */
const SAME = 0.02

type Box = { half: Vec3; at: Vec3; rotation: Quat; round?: 'ball' | 'can' }
/** What a box of a merged kit is, for heat: its label ('sofa') and whether it is drawn as metal. */
type Label = { name: string | null; metal: boolean }

/**
 * What a part of the home is made of, for heat and fire, from what it is called: the first rule
 * whose words match its label (or, for the rest of a thing, the thing's name). Data: a new piece of
 * furniture burns right by adding its words here. Metal-finished parts are steel whatever their name.
 */
export const MATTER: [RegExp, string][] = [
  [/shade/, 'paper'],
  [/shared wall|doorway$/, 'plaster'],
  [/sofa|reading chair|armchair|cushion|pouf|blanket|throw|curtain|rug|furnish flat|coat/, 'felt'],
  [/\bbooks?\b|games|print|paper|card|swatch/, 'paper'],
  [/candle/, 'wax'],
  [/bowl|vase|mug|plate|plant|clementine/, 'ceramic'],
  [/stove|pans|fridge|lamp/, 'steel'],
]
const matterOf = (name: string | null | undefined) => (name ? MATTER.find(([words]) => words.test(name.toLowerCase()))?.[1] : undefined)
interface Found { object: THREE.Object3D; data: BodyData; meshes: THREE.Mesh[]; kits: Set<THREE.Object3D> }
interface Held { key: string; data: string; boxes: Box[]; motion: 'static' | 'dynamic'; material: string; parts: number }

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
    // A kit's loose thing (src/kit.ts) keeps its own boxes: the meshes it is drawn with while out of the kit add nothing.
    if (m.isMesh && m.geometry && !notAThing(m) && !thing.object.userData.loose) {
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
  return out.filter((f) => f.meshes.length || f.kits.size || f.object.userData.loose)
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

const tq = new THREE.Quaternion()
/** A box turned in some frame, as a box in the thing's frame, through `m` (that frame to the thing's). */
function turnedIn(m: THREE.Matrix4, t: Turned): Box | null {
  m.decompose(p, q, s)
  c.set(...t.at).applyMatrix4(m)
  q.multiply(tq.set(...t.rotation))
  // The frame's own scale is taken along the box's sides (kits are not scaled unevenly).
  const half: Vec3 = [Math.max(THIN / 4, t.half[0] * Math.abs(s.x)), Math.max(THIN / 4, t.half[1] * Math.abs(s.y)), Math.max(THIN / 4, t.half[2] * Math.abs(s.z))]
  if (!half.every(Number.isFinite) || ![c.x, c.y, c.z].every(Number.isFinite)) return null
  return { half, at: [c.x, c.y, c.z], rotation: [q.x, q.y, q.z, q.w], ...(t.round ? { round: t.round } : {}) }
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

/** A thing's boxes in its own frame: its world position and turn, at world scale; and what each kit box is (null for a mesh's). */
function boxesOf(f: Found, labels: (Label | null)[] = []): Box[] {
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
      if (b) {
        out.push(b)
        labels.push(null)
      }
    }
  }
  for (const kit of f.kits) {
    kit.updateWorldMatrix(true, false)
    m.multiplyMatrices(toThing, kit.matrixWorld)
    for (const r of kit.userData.regions as Array<{ box: THREE.Box3; turned?: Turned; name?: string | null; metal?: boolean; loose?: true }>) {
      // A loose thing's boxes are its own body's, below.
      if (r.loose) continue
      const b = r.turned ? turnedIn(m, r.turned) : boxIn(m, r.box)
      if (b) {
        out.push(b)
        labels.push({ name: r.name ?? null, metal: Boolean(r.metal) })
      }
    }
  }
  const loose = f.object.userData.loose as LooseParts | undefined
  if (loose) {
    m.makeScale(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))
    for (const box of loose.boxes) {
      const b = turnedIn(m, box)
      if (b) {
        out.push(b)
        labels.push(null)
      }
    }
  }
  if (f.data.round && out.length) return [roundOf(out, f.data.round)]
  return out
}

/** One round box over all of a thing's boxes (they stand square in its frame, or nearly: their corners are taken as they lie). */
function roundOf(boxes: Box[], round: 'ball' | 'can'): Box {
  const all = new THREE.Box3()
  const turn = new THREE.Quaternion()
  for (const b of boxes) {
    turn.set(...b.rotation)
    for (let i = 0; i < 8; i++) all.expandByPoint(c.set(i & 1 ? b.half[0] : -b.half[0], i & 2 ? b.half[1] : -b.half[1], i & 4 ? b.half[2] : -b.half[2]).applyQuaternion(turn).add(h.set(...b.at)))
  }
  all.getCenter(c)
  all.getSize(h).multiplyScalar(0.5)
  return { half: [h.x, h.y, h.z], at: [c.x, c.y, c.z], rotation: [0, 0, 0, 1], round }
}

const dataKey = (data: BodyData) => `${data.motion ?? ''}|${data.material ?? ''}|${data.mass ?? ''}|${data.round ?? ''}|${data.spin ?? ''}`
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

/**
 * A thing's named parts for heat: kit boxes grouped by label, each made of what its words say (or
 * steel if drawn as metal, or the thing's own material); unlabelled metal boxes together as
 * 'metal'; and the rest of the thing as one part named after the thing when its name says it is
 * made of something else (a rug drawn on its own).
 */
function partsOf(labels: (Label | null)[], thing: string, material: string) {
  const groups = new Map<string, { name: string; material: string; boxes: number[] }>()
  const rest: number[] = []
  const used = new Set<string>()
  labels.forEach((l, i) => {
    const name = l?.name ?? (l?.metal ? 'metal' : null)
    if (!name) return void rest.push(i)
    const made = l?.metal ? 'steel' : matterOf(name) ?? material
    const key = `${name}|${made}`
    let g = groups.get(key)
    if (!g) {
      // The same label in two materials (a lamp's steel stem and paper shade) is two parts.
      const unique = used.has(name) ? `${name} ${made}` : name
      used.add(unique)
      groups.set(key, (g = { name: unique, material: made, boxes: [] }))
    }
    g.boxes.push(i)
  })
  const own = matterOf(thing)
  if (own && own !== material && rest.length) groups.set(thing, { name: thing.replace(/[^\w .-]+/g, '-').slice(0, 40), material: own, boxes: rest })
  return [...groups.values()]
}

/** Total box volume, m³, for a dynamic thing that names no mass. */
const volume = (boxes: Box[]) => boxes.reduce((v, b) => v + 8 * b.half[0] * b.half[1] * b.half[2], 0)

export function homeBodies(world: World, scene: THREE.Scene, skip: THREE.Object3D[]) {
  const held = new Map<THREE.Object3D, Held>()
  const made = new WeakMap<THREE.Object3D, { p: Vec3; q: Quat }>()
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
      const labels: (Label | null)[] = []
      const boxes = boxesOf(f, labels)
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
      const parts = partsOf(labels, f.object.name || String(f.object.userData.furniture ?? ''), material)
      // A kit's loose thing is drawn inside the kit's merged meshes while it rests where it was made, and by its own while it does not.
      const loose = f.object.userData.loose as LooseParts | undefined
      const drawn = loose && motion === 'dynamic' ? { woke: () => loose.cut(), slept: (home: boolean) => void (home && loose.mend()) } : {}
      // Where a moving thing was made is kept from the first time it is seen (at rest, as drawn): bound again while it
      // lies thrown, its home is still there, so tidying finds it and it is never drawn merged where its body is not.
      if (motion === 'dynamic' && !made.has(f.object)) {
        f.object.matrixWorld.decompose(p, q, s)
        made.set(f.object, { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] })
      }
      const home = motion === 'dynamic' ? { home: made.get(f.object)! } : {}
      if (!boxes.length || !world.bind(key, f.object, { shape: { kind: 'compound', boxes }, motion, material, ...(mass !== undefined ? { mass } : {}), ...(parts.length ? { parts } : {}), ...drawn, ...home, ...(typeof f.data.spin === 'number' && f.data.spin >= 0 && f.data.spin <= 50 ? { spin: f.data.spin } : {}) })) {
        if (!before) used.delete(key)
        held.delete(f.object)
        refused.push(key)
        continue
      }
      held.set(f.object, { key, data: dataKey(f.data), boxes, motion, material, parts: parts.length })
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
    list: () => [...held].map(([o, h]) => ({ key: h.key, name: o.name, furniture: o.userData.furniture as string | undefined, motion: h.motion, material: h.material, parts: h.boxes.length, named: h.parts })),
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
