// A new room's first pieces (#48), suited to its name: a playroom gets a play tent, a
// little table and stools on a big rug and a toy chest under the window; a study a desk
// under the window and a reading chair; a bedroom a bed and a side table; anything else a
// sofa facing a low table on a rug, an armchair and a floor lamp. Every room but the
// smallest also gets a low bookcase and a plant on the side away from the door, and a
// picture. They are plan furniture, committed with the room in one version, so one undo
// takes both away and a reload draws them again. The way in from the door is kept clear.
// Every piece is checked by placing's own rules (mount.ts fit) against the house as the
// room makes it, the things already in the scene and the pieces laid before it; one that
// will not fit is nudged toward the room's middle, and left out if it still will not.
import * as THREE from 'three/webgpu'
import { releaseGpu } from '../kernel'
import { KINDS, fit, footprint, obstacles, seat, type Obstacle, type Size } from './mount'
import { curveOf, pointAt, roomArea, type Anchor, type Furniture, type P, type Plan } from './plan'
import { draftGeometry, type Draft } from './resolve'

/** Rooms that get no sofa: a pantry or a bathroom is furnished by hand. */
const BARE = /\b(pantry|larder|stor(e|age)|closet|cupboard|bath(room)?|toilet|wc|laundry|utility|garage|hall(way)?|corridor|kitchen)\b/i

/** Below this floor area (m²) a room keeps to its main pieces. */
const SMALL = 14

/** What a room is for, by its name. */
const PLAY = /\b(play\s?room|play|toys?|kids?|nursery|children'?s?)\b/i
const STUDY = /\b(study|office|library|den|studio|workroom)\b/i
const BED = /\b(bed\s?room|bed|guest\s?room|sleep(ing)?)\b/i

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
  // `away` is the side of the room away from the door (-1 toward `from`, +1 toward `to`).
  const away = doorMid > mid ? -1 : 1
  /** The inside face of the side wall on side s, in metres along the host wall. */
  const sideWall = (s: number) => (s < 0 ? d.from + T / 2 : d.to - T / 2)
  /** Facing into the room from the side wall on side s. */
  const fromSide = (s: number) => yawTo([-s * geo.dir[0], -s * geo.dir[1]])
  // The far wall's inside, into a bay if it bows out: the fit rules pull a piece back until it clears the curve.
  const farIn = d.depth - T / 2 + (d.bend > 0 ? d.bend * 0.8 : d.bend)
  const facing = yawTo(back)
  const list = [...(known ?? (scene ? obstacles(scene, skip) : []))]
  // The way in: from the doorway a metre and a half into the room, a door's width and a little more.
  {
    const [ax, az] = at(d.door.from - 0.1, 0), [bx, bz] = at(d.door.to + 0.1, 1.5)
    list.push({ box: new THREE.Box3(new THREE.Vector3(Math.min(ax, bx), 0.03, Math.min(az, bz)), new THREE.Vector3(Math.max(ax, bx), 2, Math.max(az, bz))), name: 'way in' })
  }
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
  /** A piece against the side wall on side s, `across` metres out from the shared wall. */
  const bySide = (kind: string, s: number, across: number) => lay(kind, sideWall(s) - s * (sizeOf(kind)[2] / 2 + 0.06), across, fromSide(s))
  /** A piece against the far wall, `along` metres along the host wall. */
  const byFar = (kind: string, along: number) => lay(kind, along, farIn - 0.06 - sizeOf(kind)[2] / 2, facing)
  const roomy = roomArea(made, d.roomId) >= SMALL
  const label = d.label

  if (PLAY.test(label)) {
    // A big rug in the middle to play on, a little table and stools on it, the toy chest under the window.
    lay('big-rug', mid + away * 0.25, d.depth * 0.52, facing)
    byFar('toy-chest', mid)
    lay('play-table', mid + away * 0.3, d.depth * 0.5, fromSide(away))
    // The tent in the far corner on the quiet side.
    if (roomy) lay('play-tent', sideWall(away) - away * 0.7, farIn - 0.7, fromSide(away))
  } else if (STUDY.test(label)) {
    // The desk under the window, the reading chair and its lamp on the quiet side, a rug between.
    const [, dc] = byFar('desk', mid) ?? [mid, farIn - 0.5]
    lay('rug', mid, Math.min(dc - 0.9, d.depth * 0.45), facing)
    if (roomy) {
      lay('armchair', sideWall(away) - away * 0.6, d.depth * 0.5, fromSide(away))
      lay('floor-lamp', sideWall(away) - away * 0.3, d.depth * 0.5 + 0.65, facing)
    }
  } else if (BED.test(label)) {
    // The bed's head against the quiet side wall, a side table at its head, a rug at its foot.
    const [ba, bc] = bySide('bed', away, d.depth * 0.56) ?? [sideWall(away), d.depth * 0.56]
    lay('side-table', sideWall(away) - away * 0.3, bc + sizeOf('bed')[0] / 2 + 0.32, fromSide(away))
    lay('rug', ba - away * 1.3, bc, fromSide(away))
  } else {
    // A sofa against the far wall facing a low table on a big rug, an armchair turned to it, a lamp at the sofa's end.
    const [sw, , sd] = sizeOf('sofa'), [tw, , td] = sizeOf('low-table'), [, , ad] = sizeOf('armchair'), [lw, , ld] = sizeOf('floor-lamp')
    const [sa, sc] = lay('sofa', mid, farIn - 0.1 - sd / 2, facing) ?? [mid, farIn - 0.1 - sd / 2]
    const tableAt = sc - sd / 2 - 0.42 - td / 2
    lay('low-table', sa, tableAt, facing)
    lay('big-rug', sa, tableAt + 0.25, facing)
    if (roomy) {
      lay('armchair', sa + away * (tw / 2 + 0.38 + ad / 2), tableAt + 0.05, fromSide(-away))
      lay('floor-lamp', sa - away * (sw / 2 + 0.1 + lw / 2), sc + sd / 2 - ld / 2, facing)
    }
  }
  // The second grouping, on the quiet side near the shared wall: a low bookcase and a plant beside it.
  if (roomy) {
    const [, bc] = bySide('low-bookcase', away, T / 2 + 0.2 + sizeOf('low-bookcase')[0] / 2) ?? [0, 0]
    if (bc) bySide('potted-plant', away, bc + sizeOf('low-bookcase')[0] / 2 + 0.3)
  }
  // A picture on the quiet side wall, at eye height, in its middle (or the far wall's, when the window leaves room).
  const size = sizeOf('picture')
  for (const wall of made.walls.filter((w) => w.id.startsWith(`${d.roomId}.w`))) {
    const L = curveOf(made, wall).length
    const [mx, mz] = pointAt(curveOf(made, wall), L / 2)
    const onQuiet = dot2([mx - at(mid, d.depth / 2)[0], mz - at(mid, d.depth / 2)[1]], geo.dir) * away > 0.5
    if (!onQuiet) continue
    for (const da of [0.4, 0.1, 0.7, -0.2, 1.0]) {
      const anchor: Anchor = { mount: 'wall', wallId: wall.id, roomId: d.roomId, along: r3(L / 2 + da), height: 1.62, spin: 0 }
      if (!fit({ plan: made, size, obstacles: list, supportAt: () => null }, anchor).ok) continue
      out.push({ id: `${d.roomId}.picture`, item: { kind: 'picture' }, at: anchor })
      break
    }
    break
  }
  return out
}

const dot2 = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
