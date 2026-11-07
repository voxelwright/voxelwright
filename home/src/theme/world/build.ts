// Small builders the worlds share: boxes whose side faces are UV-mapped in metres, merging
// many parts into one mesh, and a bin that frees everything a world made.
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { canvas, toTexture } from '../../paint'
import type { World } from './index'

/** Collects what a world makes so `dispose()` frees all of it. */
export class Bin {
  readonly group = new THREE.Group()
  private readonly owned: Array<{ dispose(): void }> = []
  keep<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing)
    return thing
  }
  /** One mesh from many geometries (they are freed after the merge). Not pickable, out of the theme's walk. */
  mesh(parts: THREE.BufferGeometry[], material: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}) {
    const geo = this.keep(mergeGeometries(parts))
    for (const p of parts) p.dispose()
    const m = new THREE.Mesh(geo, this.keep(material))
    m.castShadow = opts.cast ?? false
    m.receiveShadow = opts.receive ?? false
    m.name = opts.name ?? ''
    m.raycast = () => {}
    this.group.add(m)
    return m
  }
  world(): World {
    return { group: this.group, dispose: () => this.owned.forEach((o) => o.dispose()) }
  }
}

/**
 * A box at (x, y0..y0+h, z), its side faces mapped in metres divided by `cell` (so a
 * repeating texture tiles at a fixed world size), offset by `shift` cells; top and bottom
 * faces sample one point (`flat`).
 */
export function cellBox(w: number, h: number, d: number, x: number, y0: number, z: number, cell: [number, number], shift: [number, number] = [0, 0], flat: [number, number] = [0.01, 0.01]) {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z)
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i)
    if (Math.abs(ny) > 0.5) uv.setXY(i, flat[0], flat[1])
    else uv.setXY(i, (Math.abs(nx) > 0.5 ? p.getZ(i) * -Math.sign(nx) : p.getX(i) * Math.sign(n.getZ(i))) / cell[0] + shift[0], p.getY(i) / cell[1] + shift[1])
  }
  return g
}

/** Paints every vertex of a geometry one colour (values above 1 bloom). */
export function tint<T extends THREE.BufferGeometry>(g: T, r: number, gg: number, b: number): T {
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.set([r, gg, b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/** A soft round glow, white at the middle and gone at the rim, for additive pools and streaks. */
export function glowTexture() {
  const [c, g] = canvas(128, 128)
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  return toTexture(c)
}

/** A flat ground quad facing up, centred at (x, y, z). */
export function flatQuad(w: number, d: number, x: number, y: number, z: number, turn = 0) {
  return new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).rotateY(turn).translate(x, y, z)
}
