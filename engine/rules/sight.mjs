// Whether one body can see another (#264, the BODIES lane): for the world's process.
//
// Each person a rule is told of says whom they see (`sees`, ids of world.people): someone within sight whose head
// or chest has a clear line to their eyes through the world as it stands, edits and all, and who is in front of
// them or near enough to be noticed anyway. So "got away" is out of sight and not only far off, and a guard looks
// where it faces. Glass and water are seen through; leaves and everything else that stands hide.
//
// Lines are asked of the world's own cells a cell at a time, for pairs with at least one person at a page or in a
// seat (two actors seeing each other is nobody's game yet), and kept for a moment: rules are told twice a second.

/** How far anyone sees (cells), how wide in front of them (the cosine of the half angle: a little behind the shoulder), how near someone is noticed whichever way one faces, and how long a look is kept (ms). */
export const SIGHT = 600, WIDE = -0.2, NOTICED = 25, KEPT = 400
/** A body's eyes, head and chest above its feet (cells). */
const EYES = 16, HEAD = 16, CHEST = 11
/** What is seen through: nothing, water and glass. */
const clear = (kind) => { const k = kind & 15; return k === 0 || k === 5 || k === 11 }

/**
 * @param folk  everyone with a body: {by, rule?, seat, at: [x, y, z] (their feet), yaw}
 * @param kind  what a cell of the world is made of: (x, y, z) => kind
 */
export function sight({ folk, kind }) {
  let at = -Infinity, seen = new Map()
  /** Whether nothing that hides stands on the line between two places. */
  const open = (a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], far = Math.hypot(d[0], d[1], d[2])
    for (let s = 1; s < far; s += 1) if (!clear(kind(Math.floor(a[0] + d[0] / far * s), Math.floor(a[1] + d[1] / far * s), Math.floor(a[2] + d[2] / far * s)))) return false
    return true
  }
  /** Whether b is where a looks: in front of them, or near enough to be noticed. */
  const before = (a, b, far) => far <= NOTICED || (Math.sin(a.yaw) * (b.at[0] - a.at[0]) - Math.cos(a.yaw) * (b.at[2] - a.at[2])) / far >= WIDE
  return {
    /** By person: whom they see now (the names the world knows them by). Worked out at most every `KEPT` ms. */
    now(now) {
      if (now - at < KEPT) return seen
      at = now
      seen = new Map()
      const all = [...folk.values()].filter((p) => p.rule !== '~')
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j]
        if (a.rule && b.rule) continue
        const far = Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2])
        if (far > SIGHT || Math.abs(b.at[1] - a.at[1]) > SIGHT) continue
        const ab = before(a, b, far), ba = before(b, a, far)
        if (!ab && !ba) continue
        // Eye to head, or eye to chest: one who shows their head over a wall is seen, and sees.
        const ea = [a.at[0], a.at[1] + EYES, a.at[2]], eb = [b.at[0], b.at[1] + EYES, b.at[2]]
        if (!open(ea, [b.at[0], b.at[1] + HEAD, b.at[2]]) && !open(ea, [b.at[0], b.at[1] + CHEST, b.at[2]]) && !open(eb, [a.at[0], a.at[1] + CHEST, a.at[2]])) continue
        if (ab) (seen.get(a.by) ?? seen.set(a.by, new Set()).get(a.by)).add(b.by)
        if (ba) (seen.get(b.by) ?? seen.set(b.by, new Set()).get(b.by)).add(a.by)
      }
      return seen
    },
  }
}
