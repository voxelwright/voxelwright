// The houses along the block (#118): two rows of narrow painted fronts stepping down the hill,
// each a toy of the engine's own data (one still part made of pieces), so the world process,
// every page and an agent's `look` hold the same street. A house is described once (`House`)
// and drawn twice from that: whole for the block (`houseToy`), and plainer for the rows of
// the streets round it, which only the page draws (client/place.ts).
import type { Vec3 } from '../../home/src/engine/core.ts'
import { piecesShape, type Piece, type ToySpec } from '../../home/src/engine/toy.ts'
import { GRADE, HALF_L, HALF_W, planeAt } from './ground.ts'

/** How far from the street's middle the fronts stand. Trims come out as far as the old kerb wall's face, where a walker's own rule stops it (walk.ts). */
export const FRONT = HALF_W - 0.18
/** How many houses a side, and how wide and deep each lot is (m). */
export const LOTS = 8
export const LOT = (2 * HALF_L) / Math.hypot(1, GRADE) / LOTS
export const DEPTH = 10
/** The garage storey's height and each storey's above it. */
export const GARAGE = 2.9, STOREY = 3
/** How far a house goes on below its floor: down the hill across its lot, and past the trench's floor. */
export const BELOW = GRADE * LOT + 4.3

const WALLS: [string, string][] = [
  ['rose', '#e7a39c'], ['mint', '#a8d3c4'], ['butter', '#f2d88c'], ['sky blue', '#9dbbdc'], ['lavender', '#c6b3da'],
  ['peach', '#f1b58b'], ['sage', '#b5d09c'], ['cream', '#efe6d2'], ['teal', '#7fb3b6'], ['terracotta', '#d98d76'],
]
const DOORS = ['#c0392b', '#2f5d73', '#e3ad38', '#3d6b4f', '#7a4a8c', '#22323f']
export const TRIM = '#fbf6ea'
const GLASS = '#34465a', BASE = '#b3aca1', ROOF = '#6d6470', GARAGE_DOOR = '#f1ead9'

export type Style = 'flat' | 'bay' | 'gable'
export interface House {
  /** Its number on the street: odd on the west side, even on the east, rising down the hill. */
  number: number
  side: -1 | 1
  /** Where its lot starts (uphill) and its middle, world z. */
  z0: number
  storeys: 2 | 3
  style: Style
  wall: string
  /** The wall colour's name, for its label. */
  colour: string
  door: string
}

/** The number of the house whose door is the way into the home (server.ts is told the home's address): the first on the sunny side. */
export const HOME = 102

/** A small repeatable shuffle: the same house for the same numbers on every machine. */
const pick = (a: number, b: number, of: number) => (((a * 7919 + b * 104729 + 13) * 2654435761) >>> 0) % of

/** The house on lot `lot` (0 at the top of the hill) of `side`, on the street `street` (0 is the block's own; others stand round it). */
export function houseAt(lot: number, side: -1 | 1, street = 0, block = 0): House {
  const seed = lot * 2 + (side > 0 ? 1 : 0) + street * 31 + block * 57
  // Neighbours never share a colour: each side walks the palette by a step that has no factor in common with its length.
  const [colour, wall] = WALLS[(((lot * 3 + (side > 0 ? 5 : 0) + street * 7 + block * 4) % WALLS.length) + WALLS.length) % WALLS.length]
  const style = (['bay', 'gable', 'flat', 'bay', 'gable'] as Style[])[pick(seed, 1, 5)]
  return {
    number: 100 + lot * 2 + (side > 0 ? 2 : 1), side, z0: -HALF_L / Math.hypot(1, GRADE) + lot * LOT,
    storeys: pick(seed, 2, 3) === 0 ? 3 : 2, style, wall, colour, door: DOORS[pick(seed, 3, DOORS.length)],
  }
}

const r = (n: number) => Math.round(n * 1000) / 1000
const box = (half: Vec3, at: Vec3, paint: string, turn?: Vec3): Piece => ({ shape: { kind: 'box', half: half.map(r) as Vec3 }, at: at.map(r) as Vec3, paint, ...(turn ? { turn } : {}) })

/**
 * A house as boxes in its own frame: x towards the street (0 is the wall's face), y up from its floor (the
 * ground at its uphill edge), z along the street. `fine` adds what only shows near: window frames and sills,
 * side lights, brackets, the garage door's boards.
 */
export function housePieces(h: House, fine = true): Piece[] {
  // Which way is downhill in the house's own frame: the east row faces the other way, so its z is turned round.
  const down = h.side > 0 ? -1 : 1
  const half = LOT / 2 - 0.02, top = GARAGE + STOREY * h.storeys, roof = top + 0.5
  /** The ground's height at a place along the front. */
  const ground = (z: number) => -GRADE * (down * z + LOT / 2)
  const pieces: Piece[] = [
    box([DEPTH / 2, (roof + BELOW) / 2, half], [-DEPTH / 2, (roof - BELOW) / 2, 0], h.wall),
    // The foot of the wall, which the hill shows more of at the downhill end.
    box([0.03, (0.5 + BELOW) / 2, half], [0, (0.5 - BELOW) / 2, 0], BASE),
    // A belt over the garage storey, a frieze and a cornice at the top.
    box([0.03, 0.08, half], [0.03, GARAGE, 0], TRIM),
    box([0.03, 0.2, half], [0.03, top - 0.3, 0], h.door),
    box([0.1, 0.1, half], [0.1, top - 0.03, 0], TRIM),
    box([0.21, 0.13, half + 0.02], [0.21, top + 0.2, 0], TRIM),
    box([DEPTH / 2 - 0.3, 0.04, half - 0.3], [-DEPTH / 2, roof - 0.12, 0], ROOF),
  ]
  // The garage at the downhill end, its door sunk to the lowest of the ground it stands across.
  const garageZ = down * (half - 0.55 - 1.25), garageTop = ground(garageZ) + 2.3, garageFoot = ground(garageZ + down * 1.25) - 0.25
  pieces.push(box([0.02, (garageTop - garageFoot) / 2, 1.25], [0.05, (garageTop + garageFoot) / 2, garageZ], GARAGE_DOOR), box([0.03, 0.09, 1.42], [0.05, garageTop + 0.09, garageZ], TRIM))
  if (fine) for (let i = 1; i <= 3; i++) pieces.push(box([0.01, 0.012, 1.2], [0.075, garageTop - i * 0.55, garageZ], '#cfc6b2'))
  // The door at the uphill end, with a light over it.
  const doorZ = -down * (half - 0.8 - 0.5), doorFoot = ground(doorZ) - 0.12, doorTop = doorFoot + 2.3
  pieces.push(box([0.02, (doorTop - doorFoot) / 2 + 0.26, 0.68], [0.045, (doorTop + doorFoot) / 2 + 0.26, doorZ], TRIM), box([0.02, (doorTop - doorFoot) / 2, 0.5], [0.065, (doorTop + doorFoot) / 2, doorZ], h.door), box([0.02, 0.15, 0.5], [0.065, doorTop + 0.24, doorZ], GLASS))
  if (fine) pieces.push(box([0.025, 0.03, 0.03], [0.09, doorFoot + 1.1, doorZ + down * 0.36], '#e3c26a'))
  // The home's own door has a lantern beside it and a mat before it.
  if (fine && h.number === HOME) pieces.push(box([0.07, 0.11, 0.07], [0.12, doorFoot + 1.95, doorZ - down * 0.95], '#ffd27a'), box([0.09, 0.025, 0.09], [0.12, doorFoot + 2.085, doorZ - down * 0.95], '#2c3438'), box([0.3, 0.012, 0.45], [0.4, ground(doorZ) + 0.012, doorZ], '#8c5a3c'))

  /** A window on a face that looks at the street: its frame, its glass, and a sill when seen from near. */
  const window = (x: number, y: number, z: number, wide: number, tall: number) => {
    pieces.push(box([0.02, tall / 2 + 0.12, wide / 2 + 0.12], [x + 0.02, y, z], TRIM), box([0.02, tall / 2, wide / 2], [x + 0.04, y, z], GLASS))
    if (fine) pieces.push(box([0.06, 0.04, wide / 2 + 0.18], [x + 0.05, y - tall / 2 - 0.14, z], TRIM))
  }
  const floorY = (s: number) => GARAGE + STOREY * s + 1.55
  if (h.style === 'flat') {
    for (let s = 0; s < h.storeys; s++) for (const z of [-half * 0.56, 0, half * 0.56]) window(0, floorY(s), z, 1.0, 1.75)
  } else {
    // A bay over the garage, two lights on its face and one each side; one window over the door.
    const bay = { z: garageZ, wide: 2.9, out: 0.75, foot: GARAGE + 0.2, top: h.style === 'gable' ? top + 0.1 : top - 0.45 }
    pieces.push(box([bay.out / 2, (bay.top - bay.foot) / 2, bay.wide / 2], [bay.out / 2, (bay.top + bay.foot) / 2, bay.z], h.wall), box([bay.out / 2 - 0.08, 0.14, bay.wide / 2 - 0.25], [bay.out / 2 - 0.08, bay.foot - 0.14, bay.z], TRIM))
    if (h.style === 'bay') pieces.push(box([bay.out / 2 + 0.07, 0.1, bay.wide / 2 + 0.08], [bay.out / 2 + 0.05, bay.top + 0.1, bay.z], TRIM))
    for (let s = 0; s < h.storeys; s++) {
      for (const z of [-0.68, 0.68]) window(bay.out, floorY(s), bay.z + z, 0.86, 1.75)
      if (fine) for (const z of [-1, 1]) pieces.push(box([0.2, 0.875, 0.02], [bay.out / 2 + 0.02, floorY(s), bay.z + z * (bay.wide / 2 + 0.01)], GLASS))
      if (fine && s > 0) pieces.push(box([0.02, 0.07, bay.wide / 2], [bay.out + 0.01, GARAGE + STOREY * s + 0.1, bay.z], TRIM))
      window(0, floorY(s), doorZ, 1.05, 1.75)
    }
    if (h.style === 'gable') {
      // A square on its corner is a gable: the half above the bay is its roof, the half below is inside the wall.
      const reach = bay.wide / 2 + 0.32, side = reach / Math.SQRT2
      pieces.push(box([bay.out / 2 + 0.34, side, side], [bay.out / 2 - 0.26, bay.top, bay.z], TRIM, [Math.PI / 4, 0, 0]), box([0.02, 0.24, 0.24], [bay.out + 0.085, bay.top + 0.62, bay.z], GLASS, [Math.PI / 4, 0, 0]))
      // Its roof, a shade darker, a little proud of the white.
      for (const z of [-1, 1]) pieces.push(box([bay.out / 2 + 0.4, 0.05, reach / Math.SQRT2 + 0.12], [bay.out / 2 - 0.24, bay.top + reach / 2 + 0.06, bay.z + z * (reach / 2 + 0.03)], ROOF, [(z * Math.PI) / 4, 0, 0]))
    }
  }
  // Brackets under the cornice, on the flat of the wall.
  if (fine) for (let i = 0; i < 7; i++) {
    const z = -half + 0.3 + (i * (2 * half - 0.6)) / 6
    if (h.style !== 'gable' || Math.abs(z - garageZ) > 2) pieces.push(box([0.09, 0.15, 0.06], [0.12, top - 0.07, z], TRIM))
  }
  return pieces
}

/** Where a house's own frame stands in the world: at its front's middle, on its floor, facing the street. */
export const houseFrame = (h: House, across = 0) => ({ at: [r(across + h.side * FRONT), r(planeAt(h.z0)), r(h.z0 + LOT / 2)] as Vec3, yaw: h.side > 0 ? Math.PI : 0, tilt: 0 })

/** Where a house's door is, on the pavement a step out from it: a place to stand, in the world. */
export function doorOf(h: House): Vec3 {
  const z = h.z0 + 1.32
  return [r(h.side * (FRONT - 0.85)), r(planeAt(z)), r(z)]
}

/** A house of the block as a toy: one still part. */
export function houseToy(h: House): ToySpec {
  const pieces = housePieces(h)
  return {
    id: `house-${h.number}`, label: `No. ${h.number}, a ${h.colour} house`, frame: houseFrame(h), gadgets: [], wires: [], inputs: {},
    parts: [{ id: 'walls', shape: piecesShape(pieces), pieces, material: 'plaster', at: [0, 0, 0] }],
  }
}

/** The block's sixteen houses, top of the hill first. */
export const HOUSES: ToySpec[] = Array.from({ length: LOTS }, (_, lot) => [houseToy(houseAt(lot, -1)), houseToy(houseAt(lot, 1))]).flat()
