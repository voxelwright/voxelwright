// Props built from many small parts (#42 room): transforms and colours baked into
// vertices, parts merged per material, so a room of props costs a few draws.
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

/**
 * Props are many small parts. The kit bakes each part's transform and colour into
 * its vertices and merges parts by material, so the room's furniture costs a draw
 * (and a shadow draw) per material, not per part.
 */
export class Kit {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
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
  part(geo: THREE.BufferGeometry, colour: string, finish: Finish, m: THREE.Matrix4) {
    const g = plain(geo.applyMatrix4(m))
    const c = new THREE.Color(colour)
    const n = g.attributes.position.count
    const rgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    this.push(this.finishes[finish], g)
  }
  dress(geo: THREE.BufferGeometry, material: THREE.Material, m: THREE.Matrix4) {
    this.push(material, plain(geo.applyMatrix4(m)))
  }
  private push(material: THREE.Material, g: THREE.BufferGeometry) {
    const list = this.buckets.get(material) ?? []
    list.push(g)
    this.buckets.set(material, list)
  }
  build(name: string): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    for (const [material, list] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(list), material)
      for (const g of list) g.dispose()
      mesh.castShadow = mesh.receiveShadow = true
      mesh.name = `${name} ${(material as THREE.MeshStandardMaterial).map ? 'textured' : 'tinted'}`
      group.add(mesh)
    }
    return group
  }
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
