// Whether one body can see another (#264, upgraded in #164): for the world's process and AI witnesses.
//
// Each person a rule is told of says whom they see (`sees`, ids of world.people): someone within sight whose head
// or chest has a clear line to their eyes through the world as it stands, edits and all, and who is in front of
// them or near enough to be noticed anyway. So "got away" is out of sight and not only far off, and a guard looks
// where it faces. Glass and water are seen through; leaves and everything else that stands hide.
//
// Upgraded (#164):
//   - XZ spatial-hash bucketing shrinks O(N^2) pair scans to local neighbor tiles.
//   - `actorToActor: true` enables full NPC<->NPC sight & witness detection (defaults to `false` for backward
//     compatibility with existing rules and `test/sees.mjs`).
//   - Per-actor LOD tick throttling: Ring 1 checks every `KEPT` ms, Ring 2 every `3 * KEPT` ms, Ring 3 skipped.

/** How far anyone sees (cells), how wide in front of them (the cosine of the half angle: a little behind the shoulder), how near someone is noticed whichever way one faces, and how long a look is kept (ms). */
export const SIGHT = 600, WIDE = -0.2, NOTICED = 25, KEPT = 400
/** LOD ring check cadences (ms): Ring 1 every KEPT, Ring 2 every 3 * KEPT, Ring 3 skipped. */
export const LOD_CADENCE = Object.freeze({ 1: KEPT, 2: 3 * KEPT, 3: Infinity })
/** Default distance cutoffs (cells) when automatic distance LOD is enabled. */
export const LOD_RING1_DIST = 400, LOD_RING2_DIST = 1200
/** A body's eyes, head and chest above its feet (cells). */
const EYES = 16, HEAD = 16, CHEST = 11
/** What is seen through: nothing, water and glass. */
const clear = (kind) => { const k = kind & 15; return k === 0 || k === 5 || k === 11 }

/**
 * @param {object} opts
 * @param {Map<string, object>} opts.folk  everyone with a body: {by, rule?, seat, at: [x, y, z] (their feet), yaw, lod?}
 * @param {(x: number, y: number, z: number) => number} opts.kind  what a cell of the world is made of
 * @param {boolean} [opts.actorToActor=false]  when true, two rule actors can see each other (witness detection)
 * @param {number} [opts.range=SIGHT]          maximum sight distance in 10 cm cells
 * @param {number} [opts.bucketSize=300]       spatial hash tile size in 10 cm cells
 * @param {boolean|{ring1?:number, ring2?:number, focus?:number[]}|null} [opts.lod=null]  enable distance-based LOD
 * @param {(person: object) => 1|2|3} [opts.lodOf=null]  custom per-actor LOD ring classifier
 */
export function sight({
  folk,
  kind,
  actorToActor = false,
  range = SIGHT,
  bucketSize = 300,
  lod = null,
  lodOf = null,
}) {
  const maxRange = Number.isFinite(range) && range > 0 ? range : SIGHT
  const cellSize = Math.max(64, Math.min(maxRange, Number.isFinite(bucketSize) && bucketSize > 0 ? bucketSize : 300))
  const neighborRadius = Math.ceil(maxRange / cellSize)

  // Canonical forward half-neighborhood offsets so every distinct pair of nearby buckets is visited once.
  const neighborOffsets = []
  for (let dz = 0; dz <= neighborRadius; dz++) {
    for (let dx = dz === 0 ? 1 : -neighborRadius; dx <= neighborRadius; dx++) {
      neighborOffsets.push([dx, dz])
    }
  }

  let at = -Infinity
  let seen = new Map()
  const lastChecked = new Map() // by -> timestamp of last visibility evaluation
  let lastStats = { pairs: 0, raycasts: 0, skippedLod: 0, deferredLod2: 0, buckets: 0 }

  /** Whether nothing that hides stands on the line between two places. */
  const open = (a, b) => {
    lastStats.raycasts++
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], far = Math.hypot(d[0], d[1], d[2])
    for (let s = 1; s < far; s += 1) {
      if (!clear(kind(Math.floor(a[0] + d[0] / far * s), Math.floor(a[1] + d[1] / far * s), Math.floor(a[2] + d[2] / far * s)))) return false
    }
    return true
  }

  /** Whether b is where a looks: in front of them, or near enough to be noticed. */
  const before = (a, b, far) => far <= NOTICED || (Math.sin(a.yaw) * (b.at[0] - a.at[0]) - Math.cos(a.yaw) * (b.at[2] - a.at[2])) / far >= WIDE

  /** Determine LOD ring (1, 2, or 3) for a body. */
  const ringFor = (p, anchors) => {
    if (typeof lodOf === 'function') {
      const r = lodOf(p)
      return r >= 3 ? 3 : r === 2 ? 2 : 1
    }
    if (typeof p.lod === 'number') {
      return p.lod >= 3 ? 3 : p.lod === 2 ? 2 : 1
    }
    if (!lod || !p.rule || anchors.length === 0) return 1
    const r1 = typeof lod === 'object' && Number.isFinite(lod.ring1) ? lod.ring1 : LOD_RING1_DIST
    const r2 = typeof lod === 'object' && Number.isFinite(lod.ring2) ? lod.ring2 : LOD_RING2_DIST
    let nearest = Infinity
    for (const anchor of anchors) {
      const d = Math.hypot(p.at[0] - anchor[0], p.at[2] - anchor[2])
      if (d < nearest) nearest = d
    }
    return nearest <= r1 ? 1 : nearest <= r2 ? 2 : 3
  }

  return {
    /** By person: whom they see now (the names the world knows them by). Worked out at most every `KEPT` ms. */
    now(now) {
      if (now - at < KEPT) return seen
      at = now
      lastStats = { pairs: 0, raycasts: 0, skippedLod: 0, deferredLod2: 0, buckets: 0 }

      const all = [...folk.values()].filter((p) => p.rule !== '~')
      const alive = new Set(all.map((p) => p.by))

      // Distance anchors for automatic LOD (explicit focus or non-rule players/seats).
      const anchors = []
      if (lod) {
        if (typeof lod === 'object' && Array.isArray(lod.focus) && lod.focus.length >= 3) {
          anchors.push(lod.focus)
        } else {
          for (const p of all) if (!p.rule) anchors.push(p.at)
        }
      }

      const nextSeen = new Map()
      const due = new Set()
      const buckets = new Map() // `${bx},${bz}` -> { bx, bz, list }

      for (const p of all) {
        const ring = ringFor(p, anchors)
        if (ring >= 3) {
          lastChecked.delete(p.by)
          lastStats.skippedLod++
          continue
        }

        const cadence = ring === 2 ? LOD_CADENCE[2] : LOD_CADENCE[1]
        const prevAt = lastChecked.get(p.by)
        const isDue = prevAt === undefined || (now - prevAt) >= cadence

        if (isDue) {
          due.add(p.by)
          lastChecked.set(p.by, now)
        } else {
          // Ring 2 actor between its 3*KEPT checks: preserve its cached sight pruned to alive bodies.
          lastStats.deferredLod2++
          const prevSet = seen.get(p.by)
          if (prevSet && prevSet.size > 0) {
            const kept = new Set()
            for (const id of prevSet) if (alive.has(id)) kept.add(id)
            if (kept.size > 0) nextSeen.set(p.by, kept)
          }
        }

        const bx = Math.floor(p.at[0] / cellSize)
        const bz = Math.floor(p.at[2] / cellSize)
        const key = `${bx},${bz}`
        let b = buckets.get(key)
        if (!b) { b = { bx, bz, list: [] }; buckets.set(key, b) }
        b.list.push(p)
      }

      // Drop stale lastChecked entries for departed bodies.
      for (const id of [...lastChecked.keys()]) {
        if (!alive.has(id)) lastChecked.delete(id)
      }

      lastStats.buckets = buckets.size

      const checkPair = (a, b) => {
        if (!actorToActor && a.rule && b.rule) return
        const aDue = due.has(a.by)
        const bDue = due.has(b.by)
        if (!aDue && !bDue) return
        lastStats.pairs++
        const far = Math.hypot(b.at[0] - a.at[0], b.at[2] - a.at[2])
        if (far > maxRange || Math.abs(b.at[1] - a.at[1]) > maxRange) return
        const ab = aDue && before(a, b, far)
        const ba = bDue && before(b, a, far)
        if (!ab && !ba) return
        // Eye to head, or eye to chest: one who shows their head over a wall is seen, and sees.
        const ea = [a.at[0], a.at[1] + EYES, a.at[2]]
        const eb = [b.at[0], b.at[1] + EYES, b.at[2]]
        if (
          !open(ea, [b.at[0], b.at[1] + HEAD, b.at[2]]) &&
          !open(ea, [b.at[0], b.at[1] + CHEST, b.at[2]]) &&
          !open(eb, [a.at[0], a.at[1] + CHEST, a.at[2]])
        ) return
        if (ab) (nextSeen.get(a.by) ?? nextSeen.set(a.by, new Set()).get(a.by)).add(b.by)
        if (ba) (nextSeen.get(b.by) ?? nextSeen.set(b.by, new Set()).get(b.by)).add(a.by)
      }

      for (const bucket of buckets.values()) {
        const list = bucket.list
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            checkPair(list[i], list[j])
          }
        }
        for (const [dx, dz] of neighborOffsets) {
          const other = buckets.get(`${bucket.bx + dx},${bucket.bz + dz}`)
          if (!other) continue
          for (let i = 0; i < list.length; i++) {
            for (let j = 0; j < other.list.length; j++) {
              checkPair(list[i], other.list[j])
            }
          }
        }
      }

      seen = nextSeen
      return seen
    },
    /** Diagnostics from the most recent sight pass (pair checks, raycasts, LOD skips, spatial buckets). */
    stats: () => ({ ...lastStats }),
  }
}
