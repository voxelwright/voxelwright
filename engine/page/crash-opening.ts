// The torn lamp or grille of a damaged car. Cut a shallow pocket in its fine skin,
// preserving the original cells for repair. Face words have the same layout as Born.faces.
import { COUPE_KINDS } from './car-sculpt.ts'

export interface CrashOpening {
  face: readonly [number, number, number]
  axis: 0 | 2
  sign: number
  large: boolean
  cabin: Float64Array
  removed: Set<number>
  walls: Uint32Array
}

export function crashOpening(
  cells: Uint16Array, size: readonly [number, number, number], cell: number,
  face: readonly [number, number, number], axis: 0 | 2, sign: number, large: boolean, cabin: Float64Array,
): CrashOpening {
  const across = 2 - axis, removed = new Set<number>(), walls: number[] = []
  const halfWidth = (large ? 2.55 : 1.70) / cell, halfHeight = (large ? 0.90 : 0.65) / cell
  const from = Math.max(0, Math.min(size[axis] - 1, Math.floor(face[axis] + sign * 2.0 / cell)))
  const until = face[axis] - sign * 1.7 / cell
  const pack = (x: number, y: number, z: number) => x | (y << 10) | (z << 20)
  const address = (a: number, y: number, b: number) => axis === 0 ? pack(a, y, b) : pack(b, y, a)
  const kind = (a: number, y: number, b: number) => axis === 0 ? cells[a + size[0] * (b + size[2] * y)] : cells[b + size[0] * (a + size[2] * y)]
  const wall = (where: number, normalAxis: number, positive: boolean, material: number) => {
    walls.push(where, 1 | (normalAxis << 8) | (Number(positive) << 10) | (material << 16))
  }
  for (let b = Math.max(0, Math.floor(face[across] - halfWidth)); b < Math.min(size[across], face[across] + halfWidth); b++) {
    const u = (b + 0.5 - face[across]) / halfWidth
    // The panel peels up at one tip. Stepped edges are the actual fine cells of the lamp surround.
    const centre = face[1] + halfHeight * (0.25 * u + 0.12 * Math.sin(5 * u))
    for (let y = Math.max(0, Math.floor(centre - halfHeight)); y < Math.min(size[1], centre + halfHeight); y++) {
      const v = (y + 0.5 - centre) / halfHeight
      const shape = 1 - u*u - v*v
      if (shape <= 0) continue
      let skin = from
      while (skin >= 0 && skin < size[axis] && sign * (skin - until) >= 0 && !kind(skin, y, b)) skin -= sign
      if (skin < 0 || skin >= size[axis] || sign * (skin - until) < 0 || (kind(skin, y, b) & 15) === 11) continue
      // Behind the missing shell a dark back plate closes the housing, including on hollow cars.
      const depth = Math.max(1, Math.round((0.70 + shape * (large ? 0.90 : 0.45)) / cell))
      const back = Math.max(0, Math.min(size[axis] - 1, skin - sign * depth))
      // Keep the complete column, including its cap, out of the driver's survival box.
      if (Math.max(skin, back) + 1 >= cabin[axis] && Math.min(skin, back) <= cabin[axis + 3] &&
          b + 1 >= cabin[across] && b <= cabin[across + 3] && y + 1 >= cabin[1] && y <= cabin[4]) continue
      for (let a = skin; a !== back; a -= sign) removed.add(address(a, y, b))
      wall(address(back, y, b), axis, sign > 0, COUPE_KINDS.liner)
    }
  }
  // Cap the edges exposed beside the opening. These faces move and cast shading with the skin.
  for (const where of removed) {
    const coord = [where & 1023, (where >>> 10) & 1023, (where >>> 20) & 1023]
    for (const edge of [across, 1]) for (const step of [-1, 1]) {
      const next = coord[edge] + step
      if (next < 0 || next >= size[edge]) continue
      const neighbour = where + step * (1 << (edge * 10))
      if (removed.has(neighbour)) continue
      const x = neighbour & 1023, y = (neighbour >>> 10) & 1023, z = (neighbour >>> 20) & 1023
      if (!cells[x + size[0] * (z + size[2] * y)]) continue
      wall(neighbour, edge, step < 0, edge === 1 && step < 0 ? COUPE_KINDS.grille : COUPE_KINDS.barrel)
    }
  }
  return { face, axis, sign, large, cabin: cabin.slice(), removed, walls: new Uint32Array(walls) }
}
