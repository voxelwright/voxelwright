// Where someone who joins a server stands (#526). The host's world says where one arrives (its realm's `arrive`, from
// `--arrive` or the realm's own record), and that is a stranger's data: read here as a column and a facing, never as a
// height, and taken only where this page itself finds something to stand on there. Otherwise the realm's own meeting
// place (sf/realm.json `meet`) is used. Round whichever it is, each person who joins has a place of their own:
//
//   - places 3 m apart on a grid round the middle, square to its facing: the middle first, then 6 m behind and 3 m to a
//     side, then nearer behind, beside, and ahead last (whoever comes later has the middle in sight, on a phone held
//     upright too, and stands in nobody's view), dealt out in lanes by the number the door gave this
//     connection (door.mjs `spot`: the lowest no one else in the server holds), so that people who join in the same
//     second never try the same place, and someone already standing in a place is gone round;
//   - a place is ground or a roof at the middle's level (within 3 m), level under the body, with 2 m of air over it,
//     nothing standing in it (a made thing is cells), not water, inside what the release lists, and 2.5 m from anyone;
//   - and it looks at something: 20 m of air ahead, at the knee and the eye, over ground that climbs no more than a
//     gentle street (a hill's face or a wall is no view), and 8 m of it a little to either side (nobody is put with a
//     bank or a wall filling half the picture). The facing asked for first, then turned an eighth at a time; the look
//     down at the ground 16 m ahead, inside what was found clear, so that a wish there is made there (down a hill, a
//     level look meets the street 50 m off, where something else may stand).
//
// Nothing here touches the page: main.ts gives it the ground as its core has it and sets the person down.

/** A column and a facing: cells, radians. */
export interface Place { x: number; z: number; yaw: number }
/** The ground as this page's core has it, once its tiles round the place have come. */
export interface Ground {
  /** Whether the release lists the finest tile at a column (bay.ts `lists`). */
  within(x: number, z: number): boolean
  /** Where feet would stand at a column: the ground, or a roof (core `feet_at`). */
  feet(x: number, z: number): number
  /** What a cell is made of, 0 for air (core `world_kind`): what the world holds now, made things too. */
  kind(x: number, y: number, z: number): number
}
export interface Stood { at: [number, number, number]; yaw: number; pitch: number; /** Whose place it is round: the host's, or the realm's own. */ round: 'host' | 'own' }

/** The lens in the realm, degrees (wider where the picture is taller than wide, which sees a third as much across): the way in opens it on the roof (explore.ts), and an arrival here as it sets someone down. Not the first view's long one. */
export const LENS = { wide: 58, upright: 80 }
/** How far apart places are, cells; how many lanes they are dealt in (people who join together, at most, who never meet). */
export const STEP = 30, LANES = 8
const WATER = 5, HEAD = 20, LEVEL = 30, APART = 25, AHEAD = 200, LOOK = 160, FOOT = 4, RINGS = 9
/** A column a release could hold, cells (the core takes 32-bit whole numbers). */
const FAR = 1 << 27
const num = (v: unknown, most: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= most
const turnOf = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * A place a host said, read as a stranger's data: `{at: [x, z] or [x, y, z], yaw}` with every number finite and in
 * reach, or null. The height and any pitch are dropped: where feet go, and where the eye looks, are this page's to find.
 */
export function said(a: unknown): Place | null {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null
  const { at, yaw = 0 } = a as Record<string, unknown>
  if (!Array.isArray(at) || (at.length !== 2 && at.length !== 3) || !at.every((v) => num(v, FAR))) return null
  if (!num(yaw, 1e4)) return null
  return { x: Math.round(at[0]), z: Math.round(at[at.length - 1]), yaw: turnOf(yaw) }
}

/**
 * The places round a middle that faces `yaw`: offsets in cells on a grid square to it (`side` to the right, `ahead`),
 * in the order they are dealt. The same for every page that is told the same middle.
 */
const around = (yaw: number): [number, number][] => {
  const all: { at: [number, number]; cost: number; side: number; ahead: number }[] = [], c = Math.cos(yaw), s = Math.sin(yaw)
  for (let side = -RINGS; side <= RINGS; side++) for (let ahead = -RINGS; ahead <= RINGS; ahead++) {
    // In steps: how far, and more for a place ahead (in the view), straight behind, beside, or behind but more to the side
    // than half as far back (the middle out of sight: a phone held upright sees some 20 degrees to either side).
    const cost = side || ahead ? Math.hypot(side, ahead) + (ahead > 0 ? 2 : ahead === 0 ? 1.5 : 0) + (side === 0 ? 1.5 : 0) + (ahead < 0 && Math.abs(side) * 2 > -ahead ? 1 : 0) : 0
    all.push({ at: [Math.round((side * c + ahead * s) * STEP), Math.round((side * s - ahead * c) * STEP)], cost, side, ahead })
  }
  return all.sort((a, b) => a.cost - b.cost || b.side - a.side || a.ahead - b.ahead).map((p) => p.at)
}

/** Where feet stand at a column if a person may stand there: in the release, on something that is not water, level under the body, with air over it. Else null. */
export function footing(g: Ground, x: number, z: number): number | null {
  if (!num(x, FAR) || !num(z, FAR) || !g.within(x, z)) return null
  const ruled = g.feet(x, z)
  if (!num(ruled, FAR)) return null
  // (Where feet stand by the land's rule may be a cell of the street's own surface, its paint: the first air over it.)
  let f = ruled
  while (f < ruled + 3 && g.kind(x, f, z)) f++
  const under = g.kind(x, f - 1, z)
  if (!under || (under & 15) === WATER) return null
  for (let dx = -FOOT; dx <= FOOT; dx += 2) for (let dz = -FOOT; dz <= FOOT; dz += 2) {
    if (Math.abs(g.feet(x + dx, z + dz) - ruled) > 2) return null
    // (From a little over the feet: a kerb, a step or the street's paint under the body is ground, not in the way.)
    for (let y = f + 3; y < f + HEAD; y++) if (g.kind(x + dx, y, z + dz)) return null
  }
  return f
}

/** Whether a person at feet `f` sees ahead along `yaw`: air at the knee and the eye for 20 m, and for 8 m 23 degrees to either side, over ground that rises no more than a gentle street. */
export function sees(g: Ground, x: number, f: number, z: number, yaw: number): boolean {
  return clear(g, x, f, z, yaw, AHEAD) && clear(g, x, f, z, yaw - 0.4, AHEAD * 0.4) && clear(g, x, f, z, yaw + 0.4, AHEAD * 0.4)
}
function clear(g: Ground, x: number, f: number, z: number, yaw: number, far: number): boolean {
  const sx = Math.sin(yaw), sz = -Math.cos(yaw)
  for (let d = 6; d <= far; d += 4) {
    const cx = Math.round(x + sx * d), cz = Math.round(z + sz * d), there = g.feet(cx, cz)
    if (!num(there, FAR) || there - f > d * 0.12 + 4) return false
    for (const h of [4, 16]) if (g.kind(cx, Math.max(f, there) + h, cz)) return false
  }
  return true
}

/**
 * Where this person stands: round the host's place if it is one (`host`, already read by `said`), else round the
 * realm's own (`own`); in the lane of their door's number (`spot`), clear of everyone `others` says stands (feet, cells),
 * looking at something. Null if nowhere round either will do.
 */
export function stand(o: { host: Place | null; own: Place; spot: number; ground: Ground; others: readonly (readonly number[])[] }): Stood | null {
  const g = o.ground, lane = Number.isInteger(o.spot) && o.spot >= 0 ? o.spot % LANES : 0
  const middles: [Place, Stood['round']][] = []
  if (o.host && footing(g, o.host.x, o.host.z) !== null) middles.push([o.host, 'host'])
  middles.push([o.own, 'own'])
  for (const [m, round] of middles) {
    const level = footing(g, m.x, m.z) ?? g.feet(m.x, m.z), GRID = around(m.yaw)
    if (!num(level, FAR)) continue
    // This lane's places first; then any (someone may have left a lane's every place taken by walking into it).
    for (const mine of [true, false]) for (let i = 0; i < GRID.length; i++) {
      if (mine !== (i % LANES === lane)) continue
      const x = m.x + GRID[i][0], z = m.z + GRID[i][1], f = footing(g, x, z)
      if (f === null || Math.abs(f - level) > LEVEL) continue
      if (o.others.some((p) => p.length >= 3 && Math.hypot(p[0] - x, p[2] - z) < APART)) continue
      for (let k = 0; k < 8; k++) {
        const yaw = turnOf(m.yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4))
        if (!sees(g, x, f, z, yaw)) continue
        const ground = g.feet(Math.round(x + Math.sin(yaw) * LOOK), Math.round(z - Math.cos(yaw) * LOOK))
        return { at: [x, f, z], yaw, pitch: Math.max(-0.45, Math.min(0.05, Math.atan2(ground - f - 26, LOOK))), round }
      }
    }
  }
  return null
}
