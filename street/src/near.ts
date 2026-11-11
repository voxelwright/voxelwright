// Which made thing someone means (#118): where each one stands now, and the nearest to where they
// stand, one they face before one behind them. The world process picks the thing a sentence
// changes with this, and the page shows the same one before the sentence is sent.
import type { Vec3 } from '../../home/src/engine/core.ts'
import type { ToySpec } from '../../home/src/engine/toy.ts'
import { footprint } from './footprint.ts'

export interface Box { x0: number; x1: number; z0: number; z1: number }
/** How far from someone a made thing may be (to its nearest edge) and still be the one they mean. */
export const REACH = 9

/**
 * Where a made thing's own place is now. A thing with a part that stays is where it was put (a sword in a
 * stone, whatever the sword does); any other is moved as its first part has moved since. `where` says
 * where a part is now, or null when it is not known.
 */
export function placeOf(toy: ToySpec, where: (key: string) => Vec3 | null): [number, number] {
  const part = toy.parts.find((p) => (p.motion ?? 'static') === 'static') ?? toy.parts[0]
  const c = Math.cos(toy.frame.yaw), s = Math.sin(toy.frame.yaw), now = (part.motion ?? 'static') === 'static' ? null : where(`${toy.id}/${part.id}`)
  return now ? [now[0] - (part.at[0] * c + part.at[2] * s), now[2] - (-part.at[0] * s + part.at[2] * c)] : [toy.frame.at[0], toy.frame.at[2]]
}

/** The ground a made thing stands over now. */
export function standsOver(toy: ToySpec, where: (key: string) => Vec3 | null): Box {
  const f = footprint(toy), [px, pz] = placeOf(toy, where), x = px + f.off[0], z = pz + f.off[1]
  return { x0: x - f.half[0], x1: x + f.half[0], z0: z - f.half[1], z1: z + f.half[1] }
}

/** The thing someone standing at `from` and facing `yaw` means: the nearest within reach, measured to its nearest edge (a long bridge is near when you stand at its end), one in front before one behind. */
export function nearest<T extends { box: Box }>(things: T[], from: Vec3, yaw: number): T | null {
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  return things.map((thing) => {
    const { box } = thing
    const away = Math.hypot(Math.max(box.x0 - from[0], 0, from[0] - box.x1), Math.max(box.z0 - from[2], 0, from[2] - box.z1))
    const behind = ((box.x0 + box.x1) / 2 - from[0]) * fx + ((box.z0 + box.z1) / 2 - from[2]) * fz < 0
    return { thing, away, rank: away + (behind ? REACH : 0) }
  }).filter((m) => m.away <= REACH).sort((a, b) => a.rank - b.rank)[0]?.thing ?? null
}
