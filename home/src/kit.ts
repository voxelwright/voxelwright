// Props built from many small parts (#42 room): transforms and colours baked into
// vertices, parts merged per material, so a room of props costs a few draws.
//
// Loose things (#107): a mug, a book, a plate is its own thing you can pick up, but at rest it is
// still drawn inside the kit's merged meshes, so a room of loose things costs no more to draw
// than a room of fixed ones. Each loose thing gets a holder (an empty group at its middle) that
// carries its body data (src/physics/home.ts); the first time its body moves, its vertices are cut
// out of the merged meshes into meshes of its own under the holder (`cut`), and when it is put
// back where it stood they are merged in again (`mend`).
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { paintContact } from './paint'

export type Finish = 'matte' | 'satin' | 'gloss' | 'metal'

/** A transform: position, then yaw, pitch and roll, then scale. */
export function at(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s: [number, number, number] = [1, 1, 1]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(...s))
}

/** Keep only what every merged part shares, unindexed, so any parts merge. */
function plain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name)
  return g
}

/** What a loose thing is, for its body (src/physics/home.ts reads it from the holder's `userData.body`). */
export interface LooseBody {
  /** A registered material (src/engine/materials.ts). */
  material: string
  /** kg. */
  mass: number
  /**
   * Its body's shape, from the box round all its parts: a ball, or a can (a cylinder standing on
   * local y: a mug, a jar, a plate), so it rolls. Without it, its parts' boxes.
   */
  round?: 'ball' | 'can'
  /**
   * m: it is hollow (a bowl, a crate), with a floor this thick and walls round the box of all its parts, so
   * what lies in it rests inside and falls out when it tips. With `round: 'can'` the walls stand in a ring.
   */
  hollow?: number
}

/** A box turned any way: half sizes, middle and turn (a quaternion), in the frame it is kept in. */
export interface Turned { half: [number, number, number]; at: [number, number, number]; rotation: [number, number, number, number] }

/** What a holder carries in `userData.loose`: its shape, and its drawing in or out of the kit's merged meshes. */
export interface LooseParts {
  /** Its body's boxes in the holder's frame. */
  boxes: Turned[]
  /** Whether it is drawn by its own meshes (true) or still inside the kit's merged ones. */
  readonly out: boolean
  /** Draws it with meshes of its own under the holder, and takes it out of the merged ones. */
  cut(): void
  /** Draws it inside the merged meshes again, where it was made: for a thing that rests there. */
  mend(): void
}

interface Range { material: THREE.Material; start: number; count: number }
interface LooseThing { name: string; body: LooseBody; ranges: Range[]; boxes: THREE.Box3[]; turned: Turned[] }

/**
 * Props are many small parts. The kit bakes each part's transform and colour into
 * its vertices and merges parts by material, so the room's furniture costs a draw
 * (and a shadow draw) per material, not per part.
 */
export class Kit {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
  /** Vertices pushed so far per material: where the next part starts in the merged mesh. */
  private filled = new Map<THREE.Material, number>()
  /** What the parts added from now on are ("dresser"), so a merged kit can still say what stands where. */
  label: string | null = null
  private regions: Array<{ name: string | null; box: THREE.Box3; turned: Turned; metal: boolean; loose?: true }> = []
  private things: LooseThing[] = []
  private thing: LooseThing | null = null
  readonly finishes: Record<Finish, THREE.Material>
  constructor(phys: boolean) {
    const tint = (roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness })
    this.finishes = {
      matte: tint(0.88),
      satin: tint(0.6),
      // Glazed ceramics and enamel: a soft highlight, never a mirror.
      gloss: phys ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }) : tint(0.38),
      metal: tint(0.38, 0.75),
    }
  }
  /**
   * The parts added from now on are one loose thing (a mug, a stack is one thing per plate) with
   * this body, until the next call; `loose(null)` ends it and the parts after are the kit's fixed ones.
   */
  loose(name: string | null, body?: LooseBody) {
    this.thing = name && body ? { name, body, ranges: [], boxes: [], turned: [] } : null
    if (this.thing) this.things.push(this.thing)
  }
  part(geo: THREE.BufferGeometry, colour: string, finish: Finish, m: THREE.Matrix4) {
    const turned = turnedBox(geo, m)
    const g = plain(geo.applyMatrix4(m))
    const c = new THREE.Color(colour)
    const n = g.attributes.position.count
    const rgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    this.push(this.finishes[finish], g, turned)
  }
  dress(geo: THREE.BufferGeometry, material: THREE.Material, m: THREE.Matrix4) {
    const turned = turnedBox(geo, m)
    this.push(material, plain(geo.applyMatrix4(m)), turned)
  }
  private push(material: THREE.Material, g: THREE.BufferGeometry, turned: Turned) {
    g.computeBoundingBox()
    const box = g.boundingBox!.clone()
    // Metal (the stove, pans) is told apart for heat: it warms but never burns (src/physics/home.ts).
    this.regions.push({ name: this.label ?? this.thing?.name ?? null, box, turned, metal: ((material as THREE.MeshStandardMaterial).metalness ?? 0) >= 0.5, ...(this.thing ? { loose: true as const } : {}) })
    const start = this.filled.get(material) ?? 0
    const count = g.attributes.position.count
    this.filled.set(material, start + count)
    if (this.thing) {
      this.thing.ranges.push({ material, start, count })
      this.thing.boxes.push(box)
      this.thing.turned.push(turned)
    }
    const list = this.buckets.get(material) ?? []
    list.push(g)
    this.buckets.set(material, list)
  }
  /** `loose`: where the loose things' holders go, in place of the built group; it must stand in the kit's own frame. */
  build(name: string, loose?: THREE.Object3D): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    // Each part's box and label, in the group's frame: placing and build mode name what stands where (src/build/mount.ts).
    // `turned` is the part's box as it was made, before it was placed: a chair set at an angle keeps its own
    // shape as a body, not the wider box that stands square round it. A loose thing's boxes are marked: its
    // body is its own, not part of the kit's (src/physics/home.ts).
    group.userData.regions = this.regions
    const merged = new Map<THREE.Material, THREE.Mesh>()
    for (const [material, list] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(list), material)
      for (const g of list) g.dispose()
      mesh.castShadow = mesh.receiveShadow = true
      mesh.name = `${name} ${(material as THREE.MeshStandardMaterial).map ? 'textured' : 'tinted'}`
      group.add(mesh)
      merged.set(material, mesh)
    }
    for (const thing of this.things) if (thing.ranges.length) (loose ?? group).add(holder(thing, merged))
    return group
  }
}

const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3(), lc = new THREE.Vector3(), lh = new THREE.Vector3()
/** A part's own box (round its geometry as given), placed by `m`. */
function turnedBox(geo: THREE.BufferGeometry, m: THREE.Matrix4): Turned {
  geo.computeBoundingBox()
  m.decompose(lp, lq, ls)
  geo.boundingBox!.getCenter(lc).applyMatrix4(m)
  geo.boundingBox!.getSize(lh).multiply(ls).multiplyScalar(0.5)
  return { half: [Math.abs(lh.x), Math.abs(lh.y), Math.abs(lh.z)], at: [lc.x, lc.y, lc.z], rotation: [lq.x, lq.y, lq.z, lq.w] }
}

/** Walls, m thick, of a hollow thing's body. */
const WALL = 0.008
/** A floor and walls inside a box of these half sizes about the origin: four walls, or eight in a ring. */
function hollowBoxes(half: THREE.Vector3, floor: number, ring: boolean): Turned[] {
  const out: Turned[] = [{ half: [half.x, floor / 2, half.z], at: [0, -half.y + floor / 2, 0], rotation: [0, 0, 0, 1] }]
  const n = ring ? 8 : 4
  const r = Math.min(half.x, half.z)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    // A wall's middle is `reach` out along its turn; it is as wide as the gap between its neighbours.
    const reach = (ring ? r : i % 2 ? half.x : half.z) - WALL / 2
    const wide = ring ? r * Math.tan(Math.PI / n) : i % 2 ? half.z : half.x
    out.push({ half: [wide, half.y, WALL / 2], at: [Math.sin(a) * reach, 0, Math.cos(a) * reach], rotation: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] })
  }
  return out
}

/** A loose thing's holder: an empty group at the middle of its parts, with its body data and its drawing. */
function holder(thing: LooseThing, merged: Map<THREE.Material, THREE.Mesh>): THREE.Group {
  const all = new THREE.Box3()
  for (const b of thing.boxes) all.union(b)
  const middle = all.getCenter(new THREE.Vector3())
  const h = new THREE.Group()
  h.name = thing.name
  h.position.copy(middle)
  const { hollow, ...body } = thing.body
  // A hollow thing's ring of walls is its shape; the solver must not make one can of it.
  h.userData.body = { motion: 'dynamic', ...body, ...(hollow !== undefined ? { round: undefined } : {}) }
  const back = middle.clone().negate()
  const boxes: Turned[] = hollow !== undefined
    ? hollowBoxes(all.getSize(new THREE.Vector3()).multiplyScalar(0.5), hollow, thing.body.round === 'can')
    : thing.turned.map((t) => ({ ...t, at: [t.at[0] + back.x, t.at[1] + back.y, t.at[2] + back.z] }))
  const own: Array<{ mesh: THREE.Mesh; from: THREE.Mesh; start: number }> = []
  const parts: LooseParts = {
    boxes,
    get out() {
      return own.length > 0
    },
    cut() {
      if (own.length) return
      for (const r of thing.ranges) {
        const from = merged.get(r.material)!
        const g = new THREE.BufferGeometry()
        for (const [name, a] of Object.entries(from.geometry.attributes) as [string, THREE.BufferAttribute][]) {
          g.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(r.start * a.itemSize, (r.start + r.count) * a.itemSize), a.itemSize))
        }
        g.translate(back.x, back.y, back.z)
        const mesh = new THREE.Mesh(g, r.material)
        mesh.castShadow = mesh.receiveShadow = true
        mesh.name = `${thing.name} ${from.name}`
        h.add(mesh)
        own.push({ mesh, from, start: r.start })
        const into = from.geometry.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < r.count; i++) into.setXYZ(r.start + i, middle.x, middle.y, middle.z)
        into.addUpdateRange(r.start * 3, r.count * 3)
        into.needsUpdate = true
      }
    },
    mend() {
      for (const o of own) {
        const positions = o.mesh.geometry.attributes.position as THREE.BufferAttribute
        const into = o.from.geometry.attributes.position as THREE.BufferAttribute
        for (let i = 0; i < positions.count; i++) into.setXYZ(o.start + i, positions.getX(i) + middle.x, positions.getY(i) + middle.y, positions.getZ(i) + middle.z)
        into.addUpdateRange(o.start * 3, positions.count * 3)
        into.needsUpdate = true
        h.remove(o.mesh)
        o.mesh.geometry.dispose()
      }
      own.length = 0
    },
  }
  h.userData.loose = parts
  return h
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
export const cyl = (r0: number, r1: number, h: number, seg = 16) => new THREE.CylinderGeometry(r0, r1, h, seg)
export const ball = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h)


/** A plant in a woven basket: a soil disc, a rim, and long leaves on stems fanning out (golden-angle spacing). */
export function basketPlant(kit: Kit, wicker: THREE.Material, x: number, z: number, scale: number, seed: number) {
  kit.part(cyl(0.2 * scale, 0.16 * scale, 0.01, 18), '#4a3424', 'matte', at(x, 0.3 * scale, z))
  kit.dress(cyl(0.2 * scale, 0.16 * scale, 0.32 * scale, 24), wicker, at(x, 0.16 * scale, z))
  kit.part(new THREE.TorusGeometry(0.2 * scale, 0.014, 6, 24).rotateX(Math.PI / 2), '#a8784a', 'matte', at(x, 0.32 * scale, z))
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996 + seed, tilt = 0.25 + (i % 4) * 0.13, len = (0.5 + (i % 3) * 0.16) * scale
    const stem = at(x, 0.3 * scale, z, a, tilt)
    kit.part(cyl(0.006, 0.008, len, 6).translate(0, len / 2, 0), '#5f7a3a', 'matte', stem)
    const tip = stem.clone().multiply(at(0, len, 0, 0, 0.5))
    kit.part(ball(1, 10, 6).scale(0.075 * scale, 0.21 * scale, 0.012).translate(0, 0.17 * scale, 0), i % 2 ? '#4f7a32' : '#679a3e', 'matte', tip)
  }
}

/**
 * Soft contact shadows, one decal per footprint (x, z, width, depth, yaw), merged into
 * one draw. They sit 3.5 mm up: above 3 mm rugs, under the villagers' own at 4 mm, and
 * they hold at ?q=low, where sun shadows are coarser.
 */
export function contactDecals(prints: Array<[number, number, number, number, number]>, y = 0.0035): THREE.Mesh {
  // Each footprint gets a wide soft decal and a tight one at its base, so the shadow deepens where things touch.
  const quads = prints.flatMap(([x, z, w, d, yaw]) => [[w, d], [w * 0.78, d * 0.78]].map(([qw, qd]) =>
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).scale(qw, 1, qd).rotateY(yaw).translate(x, y, z)))
  const mesh = new THREE.Mesh(mergeGeometries(quads), new THREE.MeshBasicMaterial({ map: paintContact(), transparent: true, depthWrite: false }))
  mesh.material.userData.themeRole = 'contact' // a theme tints and deepens it (src/theme/tokens.ts)
  for (const q of quads) q.dispose()
  mesh.renderOrder = -2
  mesh.name = 'contact shadows'
  return mesh
}
