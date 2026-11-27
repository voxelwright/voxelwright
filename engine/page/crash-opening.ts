// The torn lamp or grille of a damaged car. Cut a shallow pocket in its fine skin,
// preserving the original cells for repair. Face words have the same layout as Born.faces.
import type { DeformState } from './deform.ts'
import { COUPE_KINDS } from './car-sculpt.ts'

export interface CrashOpening {
  face: readonly [number, number, number]
  root?: [number, number, number]
  axis: 0 | 2
  sign: number
  large: boolean
  cabin: Float64Array
  removed: Set<number>
  walls: Uint32Array
}

export function crashOpening(
  cells: Uint16Array, size: readonly [number, number, number], cell: number,
  face: readonly [number, number, number], axis: 0 | 2, sign: number, large: boolean, cabin: Float64Array, fender = false,
): CrashOpening {
  const across = 2 - axis, removed = new Set<number>(), walls: number[] = []
  let root: [number, number, number] | undefined, rootDistance = Infinity
  const halfWidth = (fender ? 1.85 : large ? 2.55 : 1.70) / cell
  const halfHeight = (fender ? 0.28 : large ? 0.90 : 0.65) / cell
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
    const lift = fender ? (0.64 * u + 0.50 * Math.max(0, u - 0.1) - 0.23 * Math.exp(-16 * (u + 0.34) ** 2)) / cell : halfHeight * 0.25 * u
    const centre = face[1] + lift + halfHeight * 0.12 * Math.sin(5 * u)
    for (let y = Math.max(0, Math.floor(centre - halfHeight)); y < Math.min(size[1], centre + halfHeight); y++) {
      const v = (y + 0.5 - centre) / halfHeight
      const shape = 1 - u*u - v*v
      if (shape <= 0) continue
      let skin = from
      while (skin >= 0 && skin < size[axis] && sign * (skin - until) >= 0 && !kind(skin, y, b)) skin -= sign
      if (skin < 0 || skin >= size[axis] || sign * (skin - until) < 0 || (kind(skin, y, b) & 15) === 11) continue
      // Behind the missing shell a dark back plate closes the housing, including on hollow cars.
      if (fender && !(kind(skin, y, b) & 128)) continue
      const depth = Math.max(1, Math.round((fender ? 0.26 + shape * 0.64 : 0.70 + shape * (large ? 0.90 : 0.45)) / cell))
      const back = Math.max(0, Math.min(size[axis] - 1, skin - sign * depth))
      // Keep the complete column, including its cap, out of the driver's survival box.
      if (Math.max(skin, back) + 1 >= cabin[axis] && Math.min(skin, back) <= cabin[axis + 3] &&
          b + 1 >= cabin[across] && b <= cabin[across + 3] && y + 1 >= cabin[1] && y <= cabin[4]) continue
      for (let a = skin; a !== back; a -= sign) removed.add(address(a, y, b))
      wall(address(back, y, b), axis, sign > 0, COUPE_KINDS.liner)
      // Choose the air inside the lower half of the socket. Its front lip occludes
      // the root when the player looks across the bonnet at the far lamp.
      const distance = u*u + (v + 0.45) ** 2
      if (!fender && skin !== back && distance < rootDistance) {
        rootDistance = distance
        const inside = back + 0.5 + sign * Math.max(1, Math.round(Math.abs(skin - back) * 0.35))
        root = axis === 0 ? [inside, y + 0.5, b + 0.5] : [b + 0.5, y + 0.5, inside]
      }
    }
  }
  // A broken lamp loses its connected lens, including the amber tip outside
  // the mouth. Other lights and neighbouring painted panels stay in place.
  if (!fender) {
    const pending = [...removed], lens = new Set<number>()
    for (const where of pending) {
      const coords = [where & 1023, (where >>> 10) & 1023, (where >>> 20) & 1023]
      for (let dim = 0; dim < 3; dim++) for (const step of [-1, 1]) {
        const q = [...coords]
        q[dim] += step
        if (q[dim] < 0 || q[dim] >= size[dim] || Math.abs(q[across] + 0.5 - face[across]) > halfWidth + 2 / cell) continue
        if (q.every((v,i) => v + 1 >= cabin[i] && v <= cabin[i+3])) continue
        const key = pack(q[0], q[1], q[2])
        if (!removed.has(key) && (kind(q[axis], q[1], q[across]) & 15) === 15) {
          removed.add(key)
          lens.add(key)
          pending.push(key)
        }
      }
    }
    // A lens can be thicker than the initial pocket. Discard its old back
    // plate before closing the housing at the first surviving cell.
    let kept = 0
    for (let i = 0; i < walls.length; i += 2) {
      if (lens.has(walls[i])) continue
      walls[kept++] = walls[i]
      walls[kept++] = walls[i+1]
    }
    walls.length = kept
    for (const where of lens) {
      const q = [where & 1023, (where >>> 10) & 1023, (where >>> 20) & 1023]
      q[axis] -= sign
      if (q[axis] < 0 || q[axis] >= size[axis]) continue
      const back = pack(q[0], q[1], q[2])
      if (!removed.has(back) && kind(q[axis], q[1], q[across])) wall(back, axis, sign > 0, COUPE_KINDS.liner)
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
      const lip = fender && Math.abs(coord[across] + 0.5 - face[across]) < halfWidth * 0.32 ? COUPE_KINDS.alloy : COUPE_KINDS.grille
      wall(neighbour, edge, step < 0, edge === 1 && step < 0 ? lip : COUPE_KINDS.barrel)
    }
  }
  return { face, root, axis, sign, large, cabin: cabin.slice(), removed, walls: new Uint32Array(walls) }
}

/** The upper edge of a hard side strike can split where the outer sheet turns
 * under to meet the wheel liner. Find the actual painted lip in the fine skin. */
export function fenderOpening(cells: Uint16Array, size: readonly [number, number, number], cell: number, state: DeformState) {
  const axis = state.front < 2 ? 2 : 0, along = 2 - axis
  const layer = size[0] * size[2]
  let best = Infinity, mouth: [number, number, number] | undefined, outward = 1
  for (let i = 0; i < state.dentCount; i++) {
    const d = state.dents[i]
    if (d.depth * cell < 0.8 || d.depth < 0.13 * d.radius || Math.abs(d.dir[axis]) < 0.68) continue
    const sign = d.dir[axis] < 0 ? 1 : -1, start = sign > 0 ? size[axis] - 1 : 0
    const targetY = d.center[1] + 0.46 * d.radius
    for (let b = Math.max(0, Math.floor(d.center[along] - 0.42 * d.radius)); b < Math.min(size[along], d.center[along] + 0.42 * d.radius); b++) {
      for (let y = Math.max(2, Math.floor(targetY - 0.24 * d.radius)); y < Math.min(size[1], targetY + 0.24 * d.radius); y++) {
        for (let j = 0; j < size[axis] * 0.22; j++) {
          const a = start - sign * j
          const x = axis === 2 ? b : a, z = axis === 2 ? a : b
          const at = x + z * size[0] + y * layer
          if (!cells[at]) continue
          // An exposed painted return above air or the dark liner. A continuous door stays whole.
          const below = cells[at - 2 * layer]
          if ((cells[at] & 128) && (!below || below === COUPE_KINDS.liner)) {
            const dx = b + 0.5 - d.center[along], dy = y + 0.5 - targetY, dz = a - d.center[axis]
            const score = (dx * dx + dy * dy + dz * dz * 0.22) / (d.depth * d.depth)
            if (score < best) {
              best = score
              mouth = [x + 0.5, y + 1, z + 0.5]
              mouth[axis] += sign * 0.5
              outward = sign
            }
          }
          break
        }
      }
    }
  }
  return mouth && crashOpening(cells, size, cell, mouth, axis, outward, false, state.cabin, true)
}
