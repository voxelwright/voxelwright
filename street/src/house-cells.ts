// A house of the block as cells (#138): the same narrow painted front as houses.ts describes,
// built to be broken into. Its walls are three cells through (painted boards outside, timber in
// the middle, plaster inside), with floors, two walls across each storey, doorways, panes of
// glass in every window and a door of wood, on a footing of stone that goes down past the
// trench. Its own frame is the house's: x towards the street (0 is the wall's face), y up from
// its floor, z along the street.
import type { Vec3 } from '../../home/src/engine/core.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import { cellsFrom, kindOf, pack, type Kind, type Solid } from '../../home/src/engine/voxels.ts'
import { GRADE } from './ground.ts'
import { BELOW, DEPTH, GARAGE, HOME, LOT, STOREY, TRIM, houseFrame, type House } from './houses.ts'

const GLASS = '#3d5468', BASE = '#b3aca1', ROOF = '#5f5964', GARAGE_DOOR = '#f1ead9', INSIDE = '#efe6d8', TIMBER = '#c9a77a'
const WALL = 0.3

/** Darker by a part in `by`: the lower lip of every other board. */
const shade = (hex: string, by: number) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - by)))).toString(16).padStart(2, '0')).join('')

/** A house as one still part of cells, in the house's own frame. */
export function houseCells(h: House, cell: number): ToySpec {
  const down = h.side > 0 ? -1 : 1
  const half = Math.floor((LOT / 2 - 0.02) / cell) * cell, top = GARAGE + STOREY * h.storeys, roof = top + 0.3
  const ground = (z: number) => -GRADE * (down * z + LOT / 2)
  const solids: Solid[] = []
  const wood = (paint?: string): Kind => (paint ? { material: 'maple', paint } : { material: 'maple' })
  const siding = wood(h.wall), trim = wood(TRIM), glass: Kind = { material: 'glass', paint: GLASS }
  /** A box from its low and high corners. */
  const box = (lo: Vec3, hi: Vec3, kind: Kind, hole = false) => solids.push({ shape: { kind: 'box', half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] }, at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], kind, ...(hole ? { hole } : {}) })
  const hole = (lo: Vec3, hi: Vec3) => box(lo, hi, siding, true)

  // The footing, then the walls from outside in, then the room they leave.
  box([-DEPTH, -BELOW, -half], [0, 0, half], { material: 'stone', paint: BASE })
  box([-DEPTH, 0, -half], [0, roof, half], siding)
  box([-DEPTH + cell, 0, -half + cell], [-cell, roof, half - cell], wood(TIMBER))
  box([-DEPTH + 2 * cell, 0, -half + 2 * cell], [-2 * cell, roof, half - 2 * cell], { material: 'plaster', paint: INSIDE })
  hole([-DEPTH + WALL, 0, -half + WALL], [-WALL, roof, half - WALL])
  // Floors: stone under the garage, boards above, the roof on top.
  box([-DEPTH, 0, -half], [0, 0.2, half], { material: 'stone', paint: '#9d978c' })
  for (let s = 0; s < h.storeys; s++) box([-DEPTH + cell, GARAGE + STOREY * s - 0.2, -half + cell], [-cell, GARAGE + STOREY * s, half - cell], wood(s % 2 ? '#b98a5a' : undefined))
  box([-DEPTH, top, -half], [0, roof, half], { material: 'asphalt', paint: ROOF })
  // Two walls across every storey, each with a doorway.
  const levels = [0.2, ...Array.from({ length: h.storeys }, (_, s) => GARAGE + STOREY * s)]
  const across = -Math.round(DEPTH * 0.55 / cell) * cell
  box([across - 0.1, 0.2, -half + WALL], [across + 0.1, top, half - WALL], { material: 'plaster', paint: INSIDE })
  box([-DEPTH + WALL, GARAGE, -0.1], [-WALL, top, 0.1], { material: 'plaster', paint: INSIDE })
  for (const y of levels) {
    hole([across - 0.1, y, down * 1.2 - 0.5], [across + 0.1, y + 2.1, down * 1.2 + 0.5])
    if (y >= GARAGE) { hole([-2.6, y, -0.1], [-1.6, y + 2.1, 0.1]); hole([across - 2.2, y, -0.1], [across - 1.2, y + 2.1, 0.1]) }
  }

  /** A window in a wall whose outer face is at `x` (it looks along +x): a hole through, a pane in it, a frame and a sill outside. */
  const window = (x: number, y: number, z: number, wide: number, tall: number, thick = WALL) => {
    hole([x - thick, y - tall / 2, z - wide / 2], [x + cell, y + tall / 2, z + wide / 2])
    box([x - 0.2, y - tall / 2, z - wide / 2], [x - 0.1, y + tall / 2, z + wide / 2], glass)
    box([x, y + tall / 2, z - wide / 2 - 0.1], [x + cell, y + tall / 2 + 0.1, z + wide / 2 + 0.1], trim)
    box([x, y - tall / 2 - 0.1, z - wide / 2 - 0.2], [x + 2 * cell, y - tall / 2, z + wide / 2 + 0.2], trim)
    for (const side of [-1, 1]) box([x, y - tall / 2, z + side * (wide / 2 + 0.05) - 0.05], [x + cell, y + tall / 2, z + side * (wide / 2 + 0.05) + 0.05], trim)
    // A bar across the middle of the sash.
    box([x - 0.2, y - 0.05, z - wide / 2], [x - 0.1, y + 0.05, z + wide / 2], trim)
  }
  /** A window in the back wall (it looks along -x) or a side wall is only a hole with a pane. */
  const pane = (lo: Vec3, hi: Vec3, mid: [Vec3, Vec3]) => { hole(lo, hi); box(mid[0], mid[1], glass) }

  // The front: a belt over the garage storey, a frieze in the door's colour and a cornice with brackets.
  box([0, GARAGE - 0.1, -half], [cell, GARAGE + 0.1, half], trim)
  box([0, top - 0.5, -half], [cell, top - 0.1, half], wood(h.door))
  box([0, top - 0.1, -half], [0.2, top + 0.1, half], trim)
  box([0, top + 0.1, -half], [0.4, roof + 0.1, half], trim)
  // The garage at the downhill end and the door at the uphill end, each sunk to the ground it stands on.
  const garageZ = down * (half - 0.6 - 1.25), garageFoot = Math.floor(ground(garageZ + down * 1.25) / cell) * cell, garageTop = Math.round((ground(garageZ) + 2.3) / cell) * cell
  hole([-WALL, garageFoot, garageZ - 1.25], [cell, garageTop, garageZ + 1.25])
  for (let y = garageFoot, i = 0; y < garageTop - 1e-6; y += cell, i++) box([-0.2, y, garageZ - 1.25], [-0.1, y + cell, garageZ + 1.25], wood(i % 5 === 4 ? shade(GARAGE_DOOR, 0.14) : GARAGE_DOOR))
  box([0, garageTop, garageZ - 1.4], [cell, garageTop + 0.2, garageZ + 1.4], trim)
  const doorZ = -down * (half - 0.8 - 0.5), doorFoot = Math.round(ground(doorZ) / cell) * cell, doorTop = doorFoot + 2.1
  hole([-WALL, doorFoot, doorZ - 0.5], [cell, doorTop + 0.4, doorZ + 0.5])
  box([-0.2, doorFoot, doorZ - 0.5], [-0.1, doorTop, doorZ + 0.5], wood(h.door))
  box([-0.2, doorTop + 0.1, doorZ - 0.5], [-0.1, doorTop + 0.4, doorZ + 0.5], glass)
  box([-0.2, doorTop, doorZ - 0.5], [-0.1, doorTop + 0.1, doorZ + 0.5], trim)
  box([0, doorTop + 0.4, doorZ - 0.7], [cell, doorTop + 0.6, doorZ + 0.7], trim)
  for (const side of [-1, 1]) box([0, doorFoot, doorZ + side * 0.6 - 0.1], [cell, doorTop + 0.4, doorZ + side * 0.6 + 0.1], trim)
  box([-0.1, doorFoot + 1, doorZ + down * 0.35 - 0.05], [0, doorFoot + 1.1, doorZ + down * 0.35 + 0.05], { material: 'brass' })
  // The way in from the door to the garage storey's floor: the footing is cut back behind it.
  hole([-1.4, doorFoot, doorZ - 0.5], [-WALL, Math.max(doorTop, 0.2 + 2.1), doorZ + 0.5])
  // The home's own door has a lantern beside it.
  if (h.number === HOME) { box([0, doorFoot + 1.8, doorZ - down * 0.95 - 0.1], [0.2, doorFoot + 2.1, doorZ - down * 0.95 + 0.1], { material: 'lamp', paint: '#ffd27a' }); box([0, doorFoot + 2.1, doorZ - down * 0.95 - 0.1], [0.2, doorFoot + 2.2, doorZ - down * 0.95 + 0.1], { material: 'steel', paint: '#2c3438' }) }

  const sill = (s: number) => GARAGE + STOREY * s + 1.55
  if (h.style === 'flat') {
    for (let s = 0; s < h.storeys; s++) for (const z of [-0.56, 0, 0.56]) window(0, sill(s), Math.round((z * half) / cell) * cell, 1.0, 1.7)
  } else {
    // A bay over the garage: a box of wall standing out from the front, open to the room behind it, with two windows on its face and one each side.
    const bay = { z: Math.round(garageZ / cell) * cell, wide: 3.0, out: 0.8, foot: GARAGE + 0.2, top: h.style === 'gable' ? top + 0.1 : top - 0.5 }
    box([0, bay.foot, bay.z - bay.wide / 2], [bay.out, bay.top, bay.z + bay.wide / 2], siding)
    box([0, bay.foot - 0.2, bay.z - bay.wide / 2 + 0.2], [bay.out - 0.1, bay.foot, bay.z + bay.wide / 2 - 0.2], trim)
    if (h.style === 'bay') box([0, bay.top, bay.z - bay.wide / 2 - 0.1], [bay.out + 0.1, bay.top + 0.2, bay.z + bay.wide / 2 + 0.1], trim)
    for (let s = 0; s < h.storeys; s++) {
      const floor = GARAGE + STOREY * s, ceiling = Math.min(floor + STOREY - 0.2, bay.top - 0.2)
      hole([-WALL, Math.max(floor, bay.foot + 0.2), bay.z - bay.wide / 2 + 0.2], [bay.out - 0.2, ceiling, bay.z + bay.wide / 2 - 0.2])
      if (floor >= bay.foot) box([-WALL, floor - 0.2, bay.z - bay.wide / 2 + 0.2], [bay.out - 0.2, floor, bay.z + bay.wide / 2 - 0.2], wood())
      for (const z of [-0.7, 0.7]) window(bay.out, sill(s), bay.z + z, 0.9, 1.7, 0.2)
      for (const side of [-1, 1]) { const z = bay.z + side * bay.wide / 2; pane([0.2, sill(s) - 0.85, z - 0.2], [0.6, sill(s) + 0.85, z + 0.2], [[0.2, sill(s) - 0.85, z - side * 0.1 - 0.05], [0.6, sill(s) + 0.85, z - side * 0.1 + 0.05]]) }
      if (s > 0) box([bay.out, floor, bay.z - bay.wide / 2], [bay.out + cell, floor + 0.2, bay.z + bay.wide / 2], trim)
      window(0, sill(s), Math.round(doorZ / cell) * cell, 1.0, 1.7)
    }
    if (h.style === 'gable') {
      // A gable over the bay: steps of white narrowing to a point, a small pane in it, a dark roof on its slopes.
      for (let i = 0; i * cell < bay.wide / 2 + 0.3; i++) {
        const reach = bay.wide / 2 + 0.3 - i * cell
        box([-0.6, bay.top + i * cell, bay.z - reach], [bay.out + 0.2, bay.top + (i + 1) * cell, bay.z + reach], trim)
        for (const side of [-1, 1]) box([-0.6, bay.top + i * cell, bay.z + side * reach - (side > 0 ? 0 : 0.2)], [bay.out + 0.3, bay.top + (i + 1) * cell, bay.z + side * reach + (side > 0 ? 0.2 : 0)], { material: 'asphalt', paint: ROOF })
      }
      box([bay.out + 0.1, bay.top + 0.4, bay.z - 0.3], [bay.out + 0.2, bay.top + 0.9, bay.z + 0.3], glass)
    }
  }
  // Brackets under the cornice.
  for (let i = 0; i < 7; i++) {
    const z = Math.round((-half + 0.3 + (i * (2 * half - 0.6)) / 6) / cell) * cell
    if (h.style !== 'gable' || Math.abs(z - garageZ) > 2) box([cell, top - 0.4, z - 0.05], [0.3, top - 0.1, z + 0.05], trim)
  }
  // The back: two plain windows to each storey above the garage.
  for (let s = 0; s < h.storeys; s++) for (const z of [-0.45, 0.45]) {
    const at = Math.round((z * half) / cell) * cell
    pane([-DEPTH - cell, sill(s) - 0.8, at - 0.5], [-DEPTH + WALL, sill(s) + 0.8, at + 0.5], [[-DEPTH + 0.1, sill(s) - 0.8, at - 0.5], [-DEPTH + 0.2, sill(s) + 0.8, at + 0.5]])
  }

  const { v, low } = cellsFrom(solids, cell)
  // Painted boards: every other course of the wall a little darker under its lip.
  const [nx, ny, nz] = v.size, wall = kindOf(v, siding.material, siding.paint), lip = kindOf(v, 'maple', shade(h.wall, 0.07))
  for (let y = 0; y < ny; y += 2) for (let i = y * nx * nz; i < (y + 1) * nx * nz; i++) if (v.cells[i] === wall) v.cells[i] = lip
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  const halfSize = v.size.map((n) => r((n * cell) / 2)) as Vec3
  return {
    id: `house-${h.number}`, label: `No. ${h.number}, a ${h.colour} house`, frame: houseFrame(h), gadgets: [], wires: [], inputs: {},
    parts: [{ id: 'walls', shape: { kind: 'box', half: halfSize }, material: 'maple', at: low.map((l, i) => r(l + halfSize[i])) as Vec3, cells: { size: [...v.size], cell, kinds: v.kinds, data: pack(v), low: halfSize.map((x) => -x) as Vec3, held: 1 } }],
  }
}
