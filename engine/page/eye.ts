// The eye that rides behind someone, on foot (person.ts) or in a seat (living.ts), is kept out of what stands (#264, #367).

/** How near what stands the eye comes (cells). */
const CLEAR = 3

/** What the eye cannot be in or see through: all that stands but water and leaves. */
export const standsBy = (kind: ((x: number, y: number, z: number) => number) | undefined) => (x: number, y: number, z: number) => { const k = (kind?.(Math.floor(x), Math.floor(y), Math.floor(z)) ?? 0) & 15; return k !== 0 && k !== 5 && k !== 13 }
/**
 * How much of the way from a head out to where the eye would ride is clear (0 to 1): the eye on foot and the eye
 * that rides are both kept out of what stands by this. From the head out to where the eye would be (and a little
 * past, for the picture's near edge), the first thing that stands is as far as it goes, less that little; and
 * nothing stands close beside where that leaves it (a wall met at a slant was a cell from the eye, and the
 * picture's near edge cut into it). With no room at all it is 0: the eye is at the head.
 */
export function clearWay(stands: (x: number, y: number, z: number) => boolean, head: readonly number[], off: readonly number[]): number {
  const far = Math.hypot(off[0], off[1], off[2])
  let free = 1
  if (far > 0) for (let s = 1; s <= far + CLEAR; s += 0.5) if (stands(head[0] + off[0] / far * s, head[1] + off[1] / far * s, head[2] + off[2] / far * s)) { free = Math.max(0, s - CLEAR) / far; break }
  const tight = (r: number) => { const x = head[0] + off[0] * r, y = head[1] + off[1] * r, z = head[2] + off[2] * r; return stands(x + 2, y, z) || stands(x - 2, y, z) || stands(x, y + 2, z) || stands(x, y - 2, z) || stands(x, y, z + 2) || stands(x, y, z - 2) }
  while (free > 0 && far > 0 && tight(free)) free = Math.max(0, free - 1 / far)
  return free
}
