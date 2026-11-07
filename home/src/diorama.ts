// The dollhouse shell around a room in ?cam=iso (#42): a base the floor stands on,
// four thick walls, and low cut stubs with a painted cap that replace any wall the
// camera stands behind. Built only in iso, so the seated view never sees it.
import * as THREE from 'three/webgpu'
import { canvas, toTexture } from './paint'

export type Side = 'back' | 'front' | 'left' | 'right'

export interface Shell {
  /** Inner faces of the walls, in world metres. */
  x0: number
  x1: number
  z0: number
  z1: number
  height: number
  thickness: number
  wall: THREE.Material
  /** Whether the shell's walls throw shadows (the kitchen's sun needs them; the living room never had them). */
  casts: boolean
  /** Walls the room already builds at full height (tagged `inward`); the shell adds only their stubs and caps. */
  existing: Side[]
  /** Door openings along a wall, as world x (back, front) or z (left, right) ranges. */
  openings?: Partial<Record<Side, Array<[number, number, number]>>>
}

/** The painted cut face of the diorama: the colour of the wall caps, stub tops and the base's edge. */
export const CUT = '#7d5442'
const STUB = 0.42
const BASE = 0.3
const INWARD: Record<Side, THREE.Vector3> = {
  back: new THREE.Vector3(0, 0, 1),
  front: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
}

export function shell(spec: Shell): THREE.Group {
  const { x0, x1, z0, z1, height, thickness: T, wall } = spec
  const group = new THREE.Group()
  group.name = 'diorama shell'
  const cut = new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 })
  // Outer extents: walls stand outside the inner faces, the base runs under them.
  const ox0 = x0 - T, ox1 = x1 + T, oz0 = z0 - T, oz1 = z1 + T

  /** One straight run of wall between two corners, from y0 to y1, along x (back/front) or z (left/right). */
  const run = (side: Side, a: number, b: number, y0: number, y1: number) => {
    const alongX = side === 'back' || side === 'front'
    const len = b - a
    const geo = new THREE.BoxGeometry(alongX ? len : T, y1 - y0, alongX ? T : len)
    // Plaster mapped by world size so stubs and full walls share the grain.
    const uv = geo.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + a - ox0) / 8, (uv.getY(i) * (y1 - y0) + y0) / height)
    const m = new THREE.Mesh(geo, wall)
    const mid = (a + b) / 2
    const c = side === 'back' ? z0 - T / 2 : side === 'front' ? z1 + T / 2 : side === 'left' ? x0 - T / 2 : x1 + T / 2
    m.position.set(alongX ? mid : c, (y0 + y1) / 2, alongX ? c : mid)
    m.castShadow = spec.casts
    m.receiveShadow = true
    m.userData.inward = INWARD[side]
    const cap = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : T + 0.004, 0.02, alongX ? T + 0.004 : len), cut)
    cap.position.set(m.position.x, y1 + 0.01, m.position.z)
    cap.userData.inward = INWARD[side]
    cap.castShadow = spec.casts
    return [m, cap]
  }
  /** A wall's span between corners, split around its openings (below `top` only). */
  const spans = (side: Side, a: number, b: number, below: number): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    let at = a
    for (const [o0, o1, top] of (spec.openings?.[side] ?? []).sort((p, q) => p[0] - q[0])) {
      if (top < below) continue
      out.push([at, o0])
      at = o1
    }
    out.push([at, b])
    return out
  }
  const extent: Record<Side, [number, number]> = {
    // The back and front walls run the full outer width; the side walls fit between them.
    back: [ox0, ox1], front: [ox0, ox1], left: [z0, z1], right: [z0, z1],
  }
  for (const side of ['back', 'front', 'left', 'right'] as Side[]) {
    const [a, b] = extent[side]
    if (!spec.existing.includes(side)) {
      for (const [p, q] of spans(side, a, b, 0)) group.add(...run(side, p, q, 0, height))
      // Lintels over the openings.
      for (const [o0, o1, top] of spec.openings?.[side] ?? []) group.add(...run(side, o0, o1, top, height))
    } else {
      // The room's own wall: add only its cap (and the corner it leaves open).
      const [, cap] = run(side, a, b, 0, height)
      group.add(cap)
    }
    for (const [p, q] of spans(side, a, b, STUB)) {
      for (const m of run(side, p, q, 0, STUB)) {
        m.userData.cutaway = true // shown in place of the full wall when the camera stands behind it
        m.visible = false
        group.add(m)
      }
    }
  }
  // Corners the room's own walls leave open: fill to full height so the outside reads solid.
  if (spec.existing.includes('back')) {
    for (const x of [ox0 + T / 2, ox1 - T / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(T, height, T), wall)
      post.position.set(x, height / 2, oz0 + T / 2)
      post.castShadow = true
      post.userData.inward = INWARD.back
      group.add(post)
    }
  }

  // The base: a painted slab under the floor and walls, with a soft contact shadow below.
  const base = new THREE.Mesh(new THREE.BoxGeometry(ox1 - ox0 + 0.08, BASE, oz1 - oz0 + 0.08), cut)
  base.position.set((ox0 + ox1) / 2, -BASE / 2 - 0.002, (oz0 + oz1) / 2)
  base.receiveShadow = true
  group.add(base)
  group.add(contactShadow(ox1 - ox0, oz1 - oz0, (ox0 + ox1) / 2, (oz0 + oz1) / 2))
  return group
}

/** A blurred dark rectangle under the base, so the diorama sits on the backdrop. Not solid for picking. */
function contactShadow(w: number, d: number, x: number, z: number): THREE.Mesh {
  const pad = 1.4
  const [c, g] = canvas(256, 256)
  const sx = 256 / (w + pad * 2), sz = 256 / (d + pad * 2)
  g.filter = 'blur(18px)'
  g.fillStyle = 'rgba(70, 38, 20, 0.8)'
  g.fillRect(pad * sx * 0.7, pad * sz * 0.7, (w + pad * 0.6) * sx, (d + pad * 0.6) * sz)
  const map = toTexture(c)
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w + pad * 2, d + pad * 2),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false }),
  )
  m.rotation.x = -Math.PI / 2
  m.position.set(x, -BASE - 0.02, z)
  m.name = 'diorama contact shadow'
  return m
}

/** A plank floor sized to the room, so nothing runs past the walls. */
export function floor(x0: number, x1: number, z0: number, z1: number, map: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map, roughness: 0.62 }))
  m.rotation.x = -Math.PI / 2
  m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
  m.receiveShadow = true
  m.name = 'diorama floor'
  return m
}
