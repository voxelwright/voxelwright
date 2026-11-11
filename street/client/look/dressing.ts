// What stands along the block, as the page draws it (#136): its trees and its poles, in the
// places the world has a tree and a lamp (src/scene.ts), and a little past the block's ends
// where only the page draws.
import * as THREE from 'three/webgpu'
import type { Vec3 } from '../../../home/src/engine/core.ts'
import type { Piece } from '../../../home/src/engine/toy.ts'
import { GRADE, HALF_L, planeAt } from '../../src/ground.ts'
import { FRONT, GARAGE, LOT, LOTS, STOREY, houseAt } from '../../src/houses.ts'
import { FURNITURE, palmPieces, treePieces } from '../../src/scene.ts'
import { DOWN, land } from '../place.ts'
import { poles, ties, type Pole, type Wire } from './poles.ts'
import { signs } from './signs.ts'
import { CURB } from './street.ts'
import { trees, type Tree } from './trees.ts'

const GREENS = ['#4f8f3c', '#3f7f3a', '#5f9a42', '#487f34']
/** Whether the page draws this part of the street's furniture itself, in place of the world's own shape. */
export const dressed = (part: string) => part.startsWith('tree') || part.startsWith('palm') || part.startsWith('lamp')

/** The blocks of the street beyond the block's own that get trees and poles too: the one up the hill and two down it. Only the page draws them. */
const BEYOND = [-1, 1, 2]

export function dressing(steady: boolean): THREE.Group {
  const LEN = Math.hypot(1, GRADE)
  const stood = FURNITURE.parts.map((p) => ({ id: p.id, at: [p.at[0], p.at[1] + CURB, p.at[2]] as Vec3, pieces: p.pieces ?? [] }))
  // A tree is drawn over the world's own shapes for it: its trunk's post and the balls of its crown.
  const grown = (at: Vec3, pieces: Piece[], seed: number): Tree => {
    const trunk = pieces.find((piece) => piece.shape.kind === 'cylinder')!.shape as { radius: number; halfHeight: number }
    const crown = pieces.flatMap((piece) => (piece.shape.kind === 'sphere' ? [{ at: piece.at, radius: piece.shape.radius }] : []))
    return { at, trunk: { radius: trunk.radius, height: trunk.halfHeight * 2 }, crown, seed, leaves: GREENS[seed % GREENS.length], palm: crown.length === 1 }
  }
  const own = stood.filter((p) => p.id.startsWith('tree') || p.id.startsWith('palm')), leafy: Tree[] = own.map((p, i) => grown(p.at, p.pieces, i + 11))
  // On the blocks beyond, trees of the same kinds in the same places along each, on the land as it lies there.
  for (const block of BEYOND) own.forEach((p, i) => {
    const z = p.at[2] + block * DOWN
    leafy.push(grown([p.at[0], land(p.at[0], z), z], p.id.startsWith('palm') ? palmPieces(i + block + 4) : treePieces(i + block * 3 + 9), i + 40 + block * 7))
  })
  // A pole where each lamp stands, and at the same places along the blocks beyond, so the wires run on down the hill and up it.
  const lamps = stood.filter((p) => p.id.startsWith('lamp'))
  const posts: (Pole & { own: boolean })[] = lamps.map((p, i) => ({ at: p.at, side: Math.sign(p.at[0]), light: true, can: i % 2 === 0, own: true }))
  for (const block of BEYOND) lamps.forEach((p, i) => {
    const z = p.at[2] + block * DOWN
    posts.push({ at: [p.at[0], land(p.at[0], z), z], side: Math.sign(p.at[0]), light: true, can: (i + block) % 3 === 0, own: false })
  })
  const wires: Wire[] = []
  for (const side of [-1, 1]) {
    const run = posts.filter((p) => p.side === side).sort((a, b) => a.at[2] - b.at[2])
    for (let i = 0; i < run.length - 1; i++) {
      const from = ties(run[i]), to = ties(run[i + 1]), far = run[i + 1].at[2] - run[i].at[2]
      from.forEach((tie, j) => wires.push({ from: tie, to: to[j], sag: far * (j === 6 ? 0.03 : 0.018 + j * 0.0015), ...(j === 6 ? { thick: 0.022 } : {}) }))
    }
    // From each pole of the block, a line down to the nearest house fronts on its own side.
    for (const p of run.filter((q) => q.own)) for (const way of [-1, 1]) {
      const lot = Math.max(0, Math.min(LOTS - 1, Math.floor((p.at[2] + HALF_L / LEN) / LOT) + (way > 0 ? 1 : -1))), h = houseAt(lot, side as -1 | 1)
      wires.push({ from: ties(p)[5 - (way > 0 ? 1 : 0)], to: [side * (FRONT + 0.05), planeAt(h.z0) + GARAGE + STOREY * h.storeys - 0.5, h.z0 + LOT / 2 + way * 1.1], sag: 0.35 })
    }
  }
  // Across the street, between the two poles of the block that face each other most nearly.
  const west = posts.filter((p) => p.side < 0 && p.own), east = posts.filter((p) => p.side > 0 && p.own)
  for (const a of west) {
    const b = east.reduce((best, q) => (Math.abs(q.at[2] - a.at[2]) < Math.abs(best.at[2] - a.at[2]) ? q : best), east[0])
    if (b && Math.abs(b.at[2] - a.at[2]) < 18) wires.push({ from: ties(a)[6], to: ties(b)[6], sag: 0.5, thick: 0.016 }, { from: ties(a)[4], to: ties(b)[5], sag: 0.4 })
  }
  const group = new THREE.Group()
  group.name = 'what stands along the street'
  const WIDE = 2.6, wood = trees(leafy, steady)
  let lines = poles(posts, wires, steady ? 1 : WIDE)
  group.add(wood, lines, signs({
    // Each stop sign faces whoever is coming to that end of the block from inside it.
    stops: stood.filter((p) => p.id.startsWith('stop')).map((p) => ({ at: p.at, faces: p.at[2] > 0 ? -1 : 1 })),
    poles: posts.filter((p) => p.own).map((p) => ({ at: p.at, side: p.side })),
  }))
  /** The page's tier changed: whether frames are blended now. */
  group.userData.steady = (blended: boolean) => {
    wood.userData.steady(blended)
    // The poles are stood again with their wires as thick as this tier needs.
    group.remove(lines)
    lines.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    lines = poles(posts, wires, blended ? 1 : WIDE)
    group.add(lines)
  }
  return group
}
