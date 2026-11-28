// Anchor zones (#226), after Enshrouded's Flame Altar: what is done to a world inside a zone someone keeps there
// lasts; what is done outside every zone is healed back, a bounded batch at a time, once nobody has touched it for a
// while. A realm has none of this unless its server turns it on (serve.mjs --anchor-regen-ttl).
//
// This module keeps the rules and nothing of the engine's: which cells are protected, which are on their way back
// and to what, and which entries of a world's history say nothing any more. It reads no clock and no world: the
// time and the cells are given to it. world.mjs gives them; serve.mjs keeps what it says.
//
// A row of cells is [x0, x1, y, z, kind], x1 not included, in the world's cells of 10 cm, as the core's edits are.

/** How a realm heals where it does. Off unless said. */
export const POLICY = Object.freeze({ enabled: false, regenTtlMs: 600_000, maxCellsPerTick: 256, compactIntervalMs: 60_000 })
/** The most zones a realm keeps, how far one may reach (cells), and the most cells it remembers to heal: past that, what is done stays. */
export const ZONES_MOST = 64, RADIUS_MOST = 2000, CELLS_MOST = 500_000
const ZONE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

const whole = (v) => Number.isInteger(v) && Math.abs(v) <= 2 ** 30
const keyOf = (x, y, z) => `${x},${y},${z}`
/** Bottom up, then north to south, then west to east: what holds a cell up is back before it, and a batch makes long rows. */
const before = (a, b) => (a.y - b.y || a.z - b.z || a.x - b.x) < 0

/** A policy with what is unsaid or not a usable number taken from `POLICY`. */
export function policyOf(raw = {}) {
  const at = (key, least) => (Number.isFinite(raw?.[key]) && raw[key] >= least ? raw[key] : POLICY[key])
  return { enabled: raw?.enabled === true, regenTtlMs: at('regenTtlMs', 0), maxCellsPerTick: Math.floor(at('maxCellsPerTick', 1)), compactIntervalMs: at('compactIntervalMs', 0) }
}

/** A zone as it may be kept: {id, name, owner, center: [x, y, z], radius, createdAt}; or why not, as text. */
export function zoneOf(z) {
  if (!z || typeof z !== 'object' || typeof z.id !== 'string' || !ZONE_ID.test(z.id)) return 'an anchor zone has an id: lower-case letters, digits and dashes, up to 40'
  if (!Array.isArray(z.center) || z.center.length !== 3 || !z.center.every(whole)) return 'an anchor zone has a center: [x, y, z] in whole cells'
  if (!Number.isInteger(z.radius) || z.radius < 1 || z.radius > RADIUS_MOST) return `an anchor zone has a radius of 1 to ${RADIUS_MOST} cells`
  return { id: z.id, name: String(z.name ?? z.id).slice(0, 60), owner: String(z.owner ?? '').slice(0, 24), center: [...z.center], radius: z.radius, createdAt: Number.isFinite(z.createdAt) ? z.createdAt : 0 }
}

// An edit in the core's own form (page/edits.ts): balls [0, x, y, z, radius, kind], and lists of rows
// [type, n, rows...], whose rows of types 3 and 4 count cells 4 and 8 to one of the world's along each way.

/** The balls and lists of rows of an edit, in order: each with its own words, and `ball` or `runs` and `per`. */
export function* blocksOf(words) {
  for (let i = 0; i + 1 < words.length;) {
    if (words[i] === 0) { yield { words: words.slice(i, i + 6), ball: Array.from(words.slice(i + 1, i + 6)) }; i += 6; continue }
    const end = i + 2 + words[i + 1] * 5, runs = []
    for (let k = i + 2; k < end; k += 5) runs.push([words[k], words[k + 1], words[k + 2], words[k + 3], words[k + 4]])
    yield { words: words.slice(i, end), runs, per: words[i] === 3 ? 4 : words[i] === 4 ? 8 : 1 }
    i = end
  }
}

/** About how many of the world's cells an edit goes through. */
export function cellsAbout(words) {
  let n = 0
  for (const b of blocksOf(words)) {
    if (b.ball) n += Math.ceil(4.2 * reach(b.ball[3], b.ball[4]) ** 3)
    else for (const [x0, x1] of b.runs) n += x1 - x0
  }
  return n
}

/** Rows counted in finer cells, as the rows of the world's cells they lie in. */
export const worldRows = (runs, per = 1) => (per === 1 ? runs : runs.map(([x0, x1, y, z, kind]) => [Math.floor(x0 / per), Math.floor((x1 - 1) / per) + 1, Math.floor(y / per), Math.floor(z / per), kind]))

/** How far from its centre a ball may change a cell (page/edits.ts `reachOf`, and one over for where a cell is measured from). */
const reach = (radius, kind) => (kind === 0 ? Math.ceil((radius * 44) / 16) + 1 : radius) + 1

/** Whether a ball may change a cell. */
export const ballCovers = ([cx, cy, cz, radius, kind]) => (x, y, z) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= reach(radius, kind) ** 2

/** Every cell a ball may change, as rows. */
export function ballRows(cx, cy, cz, radius, kind) {
  const r = reach(radius, kind), out = []
  for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
    const left = r * r - dy * dy - dz * dz
    if (left < 0) continue
    const dx = Math.floor(Math.sqrt(left))
    out.push([cx - dx, cx + dx + 1, cy + dy, cz + dz, kind])
  }
  return out
}

/** Cells ({x, y, z, kind}), in `before`'s order, as rows. */
export function rowsOf(cells) {
  const runs = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last[1] === c.x && last[2] === c.y && last[3] === c.z && last[4] === c.kind) last[1]++
    else runs.push([c.x, c.x + 1, c.y, c.z, c.kind])
  }
  return runs
}

export class AnchorZoneManager {
  #anchors = new Map()
  /** Cells on their way back, by place: {x, y, z, kind (the baseline), at (last touched), due}. */
  #cells = new Map()
  /** Those not yet due, in the order they were last touched: the first is the next. */
  #waiting = new Map()
  /** Those due and not yet healed, a binary heap in `before`'s order. An entry touched again since is left behind. */
  #due = []

  constructor(policy = {}) {
    this.policy = policyOf(policy)
    this.healedTotal = 0
    /** Cells changed outside every zone that were not remembered because `CELLS_MOST` were: they stay as they are. */
    this.untracked = 0
  }

  get ephemeralCells() { return this.#cells.size }

  /** Keeps a zone (one of the same id is replaced). What was on its way back inside it stays as it is now. Throws why not. */
  addAnchor(zone) {
    const kept = zoneOf(zone)
    if (typeof kept === 'string') throw new Error(kept)
    if (!this.#anchors.has(kept.id) && this.#anchors.size >= ZONES_MOST) throw new Error(`a realm keeps at most ${ZONES_MOST} anchor zones`)
    this.#anchors.set(kept.id, kept)
    for (const [key, c] of this.#cells) if (this.isProtected(c.x, c.y, c.z)) this.#drop(key)
    return kept
  }

  /** What stood protected stays as it is: only what is done there from now on heals. */
  removeAnchor(id) { return this.#anchors.delete(id) }

  listAnchors() { return [...this.#anchors.values()].map((a) => ({ ...a, center: [...a.center] })) }

  /** Whether a cell lies in a zone: within its radius of its centre (a sphere). */
  isProtected(x, y, z) {
    for (const { center: [cx, cy, cz], radius: r } of this.#anchors.values()) {
      const dx = x - cx, dy = y - cy, dz = z - cz
      if (dx > r || dx < -r || dy > r || dy < -r || dz > r || dz < -r) continue
      if (dx * dx + dy * dy + dz * dz <= r * r) return true
    }
    return false
  }

  /**
   * What an edit does, before it is done: `runs` as they will be, `baselineReader(x, y, z)` what a cell is before it.
   * Cells in a zone are the world's for good. Outside, a cell is remembered with what it was the first time it was
   * changed, and each later change starts its wait again. Answers the rows parted into the two.
   */
  recordEdit(runs, baselineReader, nowMs) {
    const kept = [], loose = []
    for (const [x0, x1, y, z, kind] of runs) {
      for (let x = x0; x < x1; x++) {
        const key = keyOf(x, y, z), inside = this.isProtected(x, y, z), into = inside ? kept : loose
        const last = into[into.length - 1]
        if (last && last[1] === x && last[2] === y && last[3] === z && last[4] === kind) last[1]++
        else into.push([x, x + 1, y, z, kind])
        if (inside) { this.#drop(key); continue }
        let c = this.#cells.get(key)
        if (!c) {
          const base = baselineReader(x, y, z)
          if (base === kind) continue
          if (this.#cells.size >= CELLS_MOST) { this.untracked++; continue }
          this.#cells.set(key, (c = { x, y, z, kind: base, at: nowMs, due: false }))
        }
        c.at = nowMs
        c.due = false
        this.#waiting.delete(key)
        this.#waiting.set(key, c)
      }
    }
    return { protected: kept, ephemeral: loose }
  }

  /** Cells that are to stay as they are, wherever they lie: a made thing was put there or taken from there. */
  forget(runs) {
    if (!this.#cells.size) return 0
    let n = 0, long = 0
    for (const r of runs) long += r[1] - r[0]
    // A made thing may be millions of cells: then what is remembered is gone through instead, once.
    if (long <= this.#cells.size) {
      for (const [x0, x1, y, z] of runs) for (let x = x0; x < x1; x++) if (this.#drop(keyOf(x, y, z))) n++
      return n
    }
    const rows = new Map()
    for (const r of runs) { const of = rows.get(rowKey(r)); if (of) of.push(r); else rows.set(rowKey(r), [r]) }
    for (const [key, c] of this.#cells) if (rows.get(`${c.y},${c.z}`)?.some(([x0, x1]) => c.x >= x0 && c.x < x1) && this.#drop(key)) n++
    return n
  }

  /**
   * Takes up to `maxCells` cells that have waited their time, lowest first, and answers the rows that put them back.
   * One `canHeal(x, y, z, kind)` says no to (someone stands there) stays due for another time.
   */
  stepRegen(nowMs, maxCells = this.policy.maxCellsPerTick, canHeal = null) {
    for (const [key, c] of this.#waiting) {
      if (nowMs - c.at < this.policy.regenTtlMs) break
      this.#waiting.delete(key)
      c.due = true
      this.#push(c)
    }
    const healed = [], later = []
    while (healed.length < maxCells && this.#due.length) {
      const c = this.#pop(), key = keyOf(c.x, c.y, c.z)
      if (!c.due || this.#cells.get(key) !== c) continue
      if (canHeal && !canHeal(c.x, c.y, c.z, c.kind)) { later.push(c); continue }
      this.#cells.delete(key)
      healed.push(c)
    }
    for (const c of later) this.#push(c)
    this.healedTotal += healed.length
    return { runs: rowsOf(healed), healedCount: healed.length, remainingEphemeral: this.#cells.size }
  }

  compactLogEntries(entries, nowMs) { return compactLogEntries(entries, nowMs) }

  stats() { return { enabled: this.policy.enabled, anchors: this.listAnchors(), ephemeralCells: this.#cells.size, healedTotal: this.healedTotal, untrackedCells: this.untracked } }

  /** All of it as text: cells that lie in a row and were touched together are one [x0, x1, y, z, baseline, at]. */
  serialize() {
    const cells = []
    for (const c of this.#cells.values()) {
      const last = cells[cells.length - 1]
      if (last && last[1] === c.x && last[2] === c.y && last[3] === c.z && last[4] === c.kind && last[5] === c.at) last[1]++
      else cells.push([c.x, c.x + 1, c.y, c.z, c.kind, c.at])
    }
    return JSON.stringify({ version: 1, policy: this.policy, anchors: this.listAnchors(), healedTotal: this.healedTotal, untracked: this.untracked, cells })
  }

  /** A manager from what `serialize` made. `policy`, if given, is in place of the one kept. Throws on anything else. */
  static deserialize(json, policy) {
    const kept = typeof json === 'string' ? JSON.parse(json) : json
    if (kept?.version !== 1 || !Array.isArray(kept.anchors) || !Array.isArray(kept.cells)) throw new Error('not what an anchor zone manager kept')
    const m = new AnchorZoneManager(policy ?? kept.policy)
    for (const a of kept.anchors) m.addAnchor(a)
    m.healedTotal = Number(kept.healedTotal) || 0
    m.untracked = Number(kept.untracked) || 0
    for (const [x0, x1, y, z, kind, at] of [...kept.cells].sort((a, b) => a[5] - b[5])) {
      for (let x = x0; x < x1; x++) {
        const key = keyOf(x, y, z), c = { x, y, z, kind, at, due: false }
        m.#cells.set(key, c)
        m.#waiting.set(key, c)
      }
    }
    return m
  }

  #drop(key) {
    this.#waiting.delete(key)
    return this.#cells.delete(key)
  }

  #push(c) {
    const h = this.#due
    let i = h.length
    for (let up; i > 0 && before(c, h[(up = (i - 1) >> 1)]); i = up) h[i] = h[up]
    h[i] = c
  }

  #pop() {
    const h = this.#due, top = h[0], last = h.pop()
    if (!h.length) return top
    let i = 0
    for (;;) {
      let down = 2 * i + 1
      if (down >= h.length) break
      if (down + 1 < h.length && before(h[down + 1], h[down])) down++
      if (!before(h[down], last)) break
      h[i] = h[down]
      i = down
    }
    h[i] = last
    return top
  }
}

// ── Compacting a world's history ─────────────────────────────────────────
// A world is its history done again in order, and a cell is what the last entry to write it said. So a row that put a
// cell back (a heal) makes every earlier word about that cell worthless. An entry here is:
//   {runs}                         rows that may be cut down
//   {runs, heal: 'built'}          cells put back to something made there: kept, since it is the last word on them
//   {runs, heal: 'ground'}         cells put back to the ground as the planet's rule makes it: with all before it gone
//                                  there is nothing left to say, and the heal goes too
//   {fixed: true, runs?, covers?}  never changed (a made thing's cells, a blast not told as rows). `runs` or
//                                  `covers(x, y, z)` say what it writes: a heal over those is kept
//   {restated: true}               says only what the entries after it say as rows: dropped
// Anything else an entry carries stays with it. Nothing in a zone is ever healed, so nothing in a zone is cut.

const rowKey = (r) => `${r[2]},${r[3]}`

/** A set of cells by row, for asking which of a long row are in it without going along the row. */
class Cells {
  rows = new Map()
  add(x, key) { let r = this.rows.get(key); if (!r) this.rows.set(key, (r = new Set())); r.add(x) }
  /** The xs of a row that are in the set, in order. */
  in(run) {
    const r = this.rows.get(rowKey(run))
    if (!r) return []
    if (r.size < run[1] - run[0]) return [...r].filter((x) => x >= run[0] && x < run[1]).sort((a, b) => a - b)
    const out = []
    for (let x = run[0]; x < run[1]; x++) if (r.has(x)) out.push(x)
    return out
  }
  /** A row without the cells of it that are in the set: the row itself if none is. */
  without(run) {
    const gone = this.in(run)
    if (!gone.length) return [run]
    const out = []
    let from = run[0]
    for (const x of [...gone, run[1]]) {
      if (x > from) out.push([from, x, run[2], run[3], run[4]])
      from = x + 1
    }
    return out
  }
}

/**
 * A history without what heals have made worthless: the entries that still say something, in order, each the same
 * object where nothing of it changed and a copy with fewer `runs` where some did. What the world comes to when they
 * are done again is what it came to before. It is the heals in the history that say what is healed, whatever the
 * time is now (`_nowMs`).
 */
export function compactLogEntries(entries, _nowMs) {
  // First, forwards: which cells put back to the ground had something written there that stays. Those heals are kept.
  const ground = new Cells()
  for (const e of entries) if (e.heal === 'ground') for (const r of e.runs) for (let x = r[0]; x < r[1]; x++) ground.add(x, rowKey(r))
  const held = new Map()
  if (ground.rows.size) {
    const fixed = new Cells(), covers = []
    entries.forEach((e, i) => {
      if (e.fixed) {
        for (const r of e.runs ?? []) for (const x of ground.in(r)) fixed.add(x, rowKey(r))
        if (e.covers) covers.push(e.covers)
      } else if (e.heal === 'ground') {
        const stay = new Cells()
        for (const r of e.runs) for (let x = r[0]; x < r[1]; x++) if (fixed.rows.get(rowKey(r))?.has(x) || covers.some((c) => c(x, r[2], r[3]))) stay.add(x, rowKey(r))
        held.set(i, stay)
      }
    })
  }
  // Then backwards: a cell a later heal puts back needs nothing said of it before.
  const settled = new Cells(), out = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.restated) continue
    if (e.fixed) { out.push(e); continue }
    let runs = e.runs.flatMap((r) => settled.without(r))
    if (e.heal === 'ground') runs = runs.flatMap((r) => rowsOf(held.get(i).in(r).map((x) => ({ x, y: r[2], z: r[3], kind: r[4] }))))
    if (e.heal) for (const r of e.runs) for (let x = r[0]; x < r[1]; x++) settled.add(x, rowKey(r))
    if (!runs.length) continue
    out.push(runs.length === e.runs.length && runs.every((r, k) => r.every((v, j) => v === e.runs[k][j])) ? e : { ...e, runs })
  }
  return out.reverse()
}
