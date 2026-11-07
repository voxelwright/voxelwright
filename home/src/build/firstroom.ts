// A new room's first pieces (#48): a sofa against the far wall facing a low table on a
// braided rug, an armchair turned to the table, a floor lamp at the sofa's end and a
// picture above it. They are plan furniture, committed with the room in one version,
// so one undo takes both away and a reload draws them again. Every piece is checked
// by placing's own rules (mount.ts fit) against the house as the room makes it, the
// things already in the scene and the pieces laid before it; one that will not fit is
// nudged toward the room's middle, and left out if it still will not.
import * as THREE from 'three/webgpu'
import { releaseGpu } from '../kernel'
import { KINDS, fit, footprint, obstacles, seat, type Obstacle, type Size } from './mount'
import { curveOf, roomArea, type Anchor, type Furniture, type P, type Plan } from './plan'
import { draftGeometry, type Draft } from './resolve'

/** Rooms that get no sofa: a pantry or a bathroom is furnished by hand. */
const BARE = /\b(pantry|larder|stor(e|age)|closet|cupboard|bath(room)?|toilet|wc|laundry|utility|garage|hall(way)?|corridor|kitchen)\b/i

/** Below this floor area (m²) a room gets no armchair or lamp. */
const SMALL = 14

const sizes = new Map<string, Size>()
/** A kind's measured size, built once and thrown away. */
export function sizeOf(kind: string): Size {
  let s = sizes.get(kind)
  if (!s) {
    const k = KINDS[kind]
    const { holder, size } = seat(k.build(), k.mount)
    releaseGpu(holder)
    sizes.set(kind, s = size)
  }
  return s
}

const r3 = (v: number) => Math.round(v * 1000) / 1000
const yawTo = (v: P) => Math.atan2(v[0], v[1])

/**
 * The first pieces for a draft room, as plan furniture. `base` is the house before the
 * room, `made` the house with it (resolve.ts fit); `scene` is looked at for what is already
 * there, leaving out `skip` (the outline and its ghosts). Pass `known` to reuse a scan.
 */
export function firstPieces(base: Plan, made: Plan, d: Draft, scene: THREE.Scene | null, skip: THREE.Object3D[] = [], known?: Obstacle[]): Furniture[] {
  if (BARE.test(d.label)) return []
  const geo = draftGeometry(base, d)
  const T = geo.thickness
  const at = geo.at
  const back: P = [-geo.out[0], -geo.out[1]]
  const mid = (d.from + d.to) / 2
  const doorMid = (d.door.from + d.door.to) / 2
  // The armchair goes to the side away from the door, the lamp to the other.
  const side = doorMid > mid ? -1 : 1
  // Into a bay, if the far wall bows out: the fit rules pull it back until it clears the curve.
  const farIn = d.depth - T / 2 + (d.bend > 0 ? d.bend * 0.8 : d.bend)
  const [sw, , sd] = sizeOf('sofa'), [tw, , td] = sizeOf('low-table'), [, , ad] = sizeOf('armchair'), [lw, , ld] = sizeOf('floor-lamp')
  const facing = yawTo(back)
  const list = [...(known ?? (scene ? obstacles(scene, skip) : []))]
  const out: Furniture[] = []
  // Nudges toward the shared wall and the middle first, then any way, 10 cm at a time.
  const steps: P[] = [[0, 0]]
  for (let r = 0.1; r <= 1.21; r += 0.1) for (const [a, c] of [[0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 1], [-1, 1], [1, 1]] as const) steps.push([a * r, c * r])
  /** Lay a piece as near as it fits to (along, across); where it went, in the room's frame, or null. */
  const lay = (kind: string, along: number, across: number, yaw: number): P | null => {
    const size = sizeOf(kind)
    const toMid = Math.sign(mid - along) || 1
    for (const [da, dc] of steps) {
      const [x, z] = at(along + da * toMid, across + dc)
      const anchor: Anchor = { mount: 'floor', x: r3(x), z: r3(z), yaw: r3(yaw) }
      if (!fit({ plan: made, size, obstacles: list, supportAt: () => null }, anchor).ok) continue
      out.push({ id: `${d.roomId}.${kind}`, item: { kind }, at: anchor })
      // What stands is in the way of what comes after; a rug is not.
      if (size[1] >= 0.02) {
        const poly = footprint(anchor.x, anchor.z, size[0], size[2], anchor.yaw)
        const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1])
        list.push({ box: new THREE.Box3(new THREE.Vector3(Math.min(...xs), 0, Math.min(...zs)), new THREE.Vector3(Math.max(...xs), size[1], Math.max(...zs))), name: KINDS[kind].label })
      }
      return [along + da * toMid, across + dc]
    }
    return null
  }
  // The sofa first; the rest are laid round wherever it went.
  const [sa, sc] = lay('sofa', mid, farIn - 0.1 - sd / 2, facing) ?? [mid, farIn - 0.1 - sd / 2]
  const tableAt = sc - sd / 2 - 0.42 - td / 2
  lay('low-table', sa, tableAt, facing)
  lay('rug', sa, tableAt + 0.08, facing)
  // A small room (a study, a nook) keeps to the sofa, the table and the rug.
  if (roomArea(made, d.roomId) >= SMALL) {
    lay('armchair', sa + side * (tw / 2 + 0.38 + ad / 2), tableAt + 0.05, yawTo([-side * geo.dir[0], -side * geo.dir[1]]))
    lay('floor-lamp', sa - side * (sw / 2 + 0.1 + lw / 2), sc + sd / 2 - ld / 2, facing)
  }
  // A picture over the sofa, in the middle of the far wall (arc length when it bends).
  const far = made.walls.find((w) => w.id === `${d.roomId}.w2`)
  if (far) {
    const L = curveOf(made, far).length
    const size = sizeOf('picture')
    for (const da of [0, 0.3, -0.3, 0.6, -0.6]) {
      const anchor: Anchor = { mount: 'wall', wallId: far.id, roomId: d.roomId, along: r3(L / 2 + da), height: 1.62, spin: 0 }
      if (!fit({ plan: made, size, obstacles: list, supportAt: () => null }, anchor).ok) continue
      out.push({ id: `${d.roomId}.picture`, item: { kind: 'picture' }, at: anchor })
      break
    }
  }
  return out
}
