// What rules have built (#264, the BUILD lane). A rule puts cells into its world and takes them out again
// (plugins/build says what shapes, and checks what a rule sends); this is the part that must not be lost or swapped
// away: for every build, which cells it changed and what was there before, so that taking it away puts the world
// back. A build is ordinary edits, made by the world's own process: echoed as an ask is, so the server keeps them
// with the world and every page applies them, and from then on the cells are the world's like any others (they
// break, burn and fall). Each edit carries `built: {rule, id, sum, k, of}`; the edits that take a build away carry
// `built: {rule, id, gone: true}`.
//
// Nothing here is written anywhere else. When a world starts again (or its core is swapped) the server sends its
// edits again in order, each with its `built`, and `replayed` reads what is there just before the edit goes in:
// the same cells it read the first time, so the same memory.
//
// Taking away: a cell is put back as it was only if it is still what the build made it (what was blasted since
// stays blasted, what fell there stays), is not another build's now, and nobody at a page stands in it or on it.

/** An edit is cut into tiles of this many columns a side: what comes loose is asked about in a box 160 across (core `SETTLE`), and a page makes again only the sectors a tile's box reaches. */
const TILE = 128
/** The most rows in one edit: serve.mjs takes 65,536 whole numbers an edit, five a row and two before them. */
const ROWS_AN_EDIT = 13_000
/** Round someone at a page, in cells: nothing is put or taken within this of their column, from the cell under their feet to over their head. */
const ROUND = 3, UNDER = 1, OVER = 20
/** Round where a living thing is (its middle), in cells. */
const LIVING = 16

/**
 * @param core     () => the core's exports, as they are now
 * @param apply    (echo) => {}   an edit as the world does an ask's: said to the server and put into the core
 * @param settle   (at) => {}   what an edit left unheld round a place is let fall, and pages are told the edit is done; with null nothing is asked and they are told the same
 * @param folk     everyone with a body, by name
 * @param lives    () => where each living thing is: [[x, y, z], ...]
 * @param footing  (x, y, z) => where feet come to rest in a column coming to it at a height, or null
 * @param stand    (x, z) => the highest place to stand near the ground there, or null
 * @param tell     (p) => {}   says where a body is to pages
 * @param busy     () => whether the core is being swapped this moment
 */
export function built({ core, apply, settle, folk, lives, footing, stand, tell, busy }) {
  /** By `rule/id`: {rule, id, sum, rows (what it made: x0, x1, y, z, kind), was (the same cells as they were), box, at (by "y|z": its runs of x), cells}. */
  const builds = new Map()
  const key = (rule, id) => `${rule}/${id}`
  /** A build's rows by "y|z": where in `rows` each begins. */
  const index = (b) => { b.at = new Map(); for (let i = 0; i < b.rows.length; i += 5) { const k = `${b.rows[i + 2]}|${b.rows[i + 3]}`, list = b.at.get(k); if (list) list.push(i); else b.at.set(k, [i]) } }
  const grow = (box, x0, x1, y, z) => { if (x0 < box[0]) box[0] = x0; if (y < box[1]) box[1] = y; if (z < box[2]) box[2] = z; if (x1 > box[3]) box[3] = x1; if (y + 1 > box[4]) box[4] = y + 1; if (z + 1 > box[5]) box[5] = z + 1 }
  const boxOf = (rows) => { const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < rows.length; i += 5) grow(box, rows[i], rows[i + 1], rows[i + 2], rows[i + 3]); return box }
  const meet = (a, b) => a[0] < b[3] && b[0] < a[3] && a[1] < b[4] && b[1] < a[4] && a[2] < b[5] && b[2] < a[5]
  /** Whether a build holds a cell. */
  const holds = (b, x, y, z) => { const list = b.at.get(`${y}|${z}`); if (list) for (const i of list) if (x >= b.rows[i] && x < b.rows[i + 1]) return true; return false }
  /**
   * A later build of the same rule is laid over cells an earlier one holds (a turf top on a cliff, a line painted
   * on a track): the cells pass to the later build, with what the earlier one remembered was there before. Each
   * cell has one build to put it back, and whichever is taken away, what comes back is the world as it was before
   * either. `made` and `was` are the later build's rows as read from the world; answers them with that memory.
   */
  function adopt(rule, self, made, was) {
    const box = boxOf(made), others = [...builds.values()].filter((o) => o !== self && o.rule === rule && meet(o.box, box))
    if (!others.length) return [made, was]
    const outMade = [], outWas = []
    for (let i = 0; i < made.length; i += 5) {
      const x0 = made[i], x1 = made[i + 1], y = made[i + 2], z = made[i + 3], kind = made[i + 4], key = `${y}|${z}`, taken = []
      for (const o of others) {
        const list = o.at.get(key)
        if (!list) continue
        for (const r of [...list]) {
          const a = o.rows[r], b = o.rows[r + 1], lo = Math.max(a, x0), hi = Math.min(b, x1)
          if (lo >= hi) continue
          taken.push([lo, hi, o.was[r + 4]])
          // The earlier build keeps what lies to either side of what it gave up.
          o.rows[r + 1] = lo; o.was[r + 1] = lo
          if (hi < b) { list.push(o.rows.length); o.rows.push(hi, b, y, z, o.rows[r + 4]); o.was.push(hi, b, y, z, o.was[r + 4]) }
          o.cells -= hi - lo
        }
      }
      if (!taken.length) { outMade.push(x0, x1, y, z, kind); outWas.push(x0, x1, y, z, was[i + 4]); continue }
      taken.sort((p, q) => p[0] - q[0])
      let at = x0
      for (const [lo, hi, old] of taken) {
        if (lo > at) { outMade.push(at, lo, y, z, kind); outWas.push(at, lo, y, z, was[i + 4]) }
        outMade.push(lo, hi, y, z, kind); outWas.push(lo, hi, y, z, old)
        at = hi
      }
      if (at < x1) { outMade.push(at, x1, y, z, kind); outWas.push(at, x1, y, z, was[i + 4]) }
    }
    return [outMade, outWas]
  }

  /** Rows as they are in the world now, cell by cell: only the cells that are not already `kind` (those need no change, and are nobody's). Answers [made, was], rows of the same cells. */
  function changed(rows) {
    const c = core(), made = [], was = []
    for (let i = 0; i < rows.length; i += 5) {
      const y = rows[i + 2], z = rows[i + 3], kind = rows[i + 4]
      let from = 0, old = -1
      for (let x = rows[i]; x <= rows[i + 1]; x++) {
        const now = x < rows[i + 1] ? c.world_kind(x, y, z) : -1, here = now === kind ? -1 : now
        if (here === old) continue
        if (old >= 0) { made.push(from, x, y, z, kind); was.push(from, x, y, z, old) }
        from = x; old = here
      }
    }
    return [made, was]
  }

  /** Those whose bodies the world does not move, as boxes nothing is put into or taken from under. */
  function bodies() {
    const out = []
    for (const p of folk.values()) if (!p.seat && !p.rule) out.push({ who: p.name || p.by, box: [Math.floor(p.at[0]) - ROUND, Math.floor(p.at[1]) - UNDER, Math.floor(p.at[2]) - ROUND, Math.floor(p.at[0]) + ROUND + 1, Math.floor(p.at[1]) + OVER, Math.floor(p.at[2]) + ROUND + 1] })
    for (const at of lives()) if (at) out.push({ who: 'something that lives', box: [Math.floor(at[0]) - LIVING, Math.floor(at[1]) - LIVING, Math.floor(at[2]) - LIVING, Math.floor(at[0]) + LIVING, Math.floor(at[1]) + LIVING, Math.floor(at[2]) + LIVING] })
    return out
  }
  /** The first of `bodies` a row reaches, or undefined. */
  const reaches = (bodies, x0, x1, y, z) => bodies.find(({ box }) => x0 < box[3] && x1 > box[0] && y >= box[1] && y < box[4] && z >= box[2] && z < box[5])

  /** Rows (flat, in any order) as edits: tiles of TILE columns, each sorted as the core reads rows (by y, then z, then x), with its box and the middle of it to ask what came loose. */
  function tiles(rows) {
    const by = new Map()
    for (let i = 0; i < rows.length; i += 5) {
      const tz = Math.floor(rows[i + 3] / TILE)
      for (let x = rows[i]; x < rows[i + 1];) {
        const tx = Math.floor(x / TILE), end = Math.min(rows[i + 1], (tx + 1) * TILE), k = `${tx}|${tz}`
        let list = by.get(k)
        if (!list || list.length >= ROWS_AN_EDIT) { if (list) by.set(`${k}|${by.size}`, list); by.set(k, list = []) }
        list.push([x, end, rows[i + 2], rows[i + 3], rows[i + 4]])
        x = end
      }
    }
    return [...by.values()].map((list) => {
      list.sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
      const flat = list.flat(), box = boxOf(flat)
      return { edit: [1, list.length, ...flat], box, release: [Math.floor((box[0] + box[3]) / 2), Math.floor((box[1] + box[4]) / 2), Math.floor((box[2] + box[5]) / 2)] }
    })
  }

  /** The bodies the world moves that stand where the world changed are stood again on what is there. */
  function restand(box) {
    for (const p of folk.values()) {
      if (!p.seat || p.at[0] < box[0] - 2 || p.at[0] > box[3] + 2 || p.at[2] < box[2] - 2 || p.at[2] > box[5] + 2) continue
      const feet = footing(p.at[0], p.at[1], p.at[2]) ?? stand(Math.round(p.at[0]), Math.round(p.at[2]))
      if (feet !== null && feet !== p.at[1]) { p.at[1] = feet; p.path = undefined; tell(p) }
    }
  }

  /**
   * Whether an edit, now that it is in, may have left something unheld: a cell it filled has nothing under it, or a
   * cell it emptied has something over it. A road laid on the ground and earth put back into a trench leave nothing
   * to fall, and asking the core what holds takes it 60 ms a tile (it gathers 16 m of world each time): a track of
   * 25 tiles stopped the world for a second and a half before this.
   */
  function loose(words) {
    const c = core()
    for (let i = 2; i < words.length; i += 5) {
      const y = words[i + 2], z = words[i + 3], other = words[i + 4] ? y - 1 : y + 1
      for (let x = words[i]; x < words[i + 1]; x++) if ((c.world_kind(x, other, z) === 0) === (words[i + 4] !== 0)) return true
    }
    return false
  }
  /** Does edits, each with what it is of: for each one echo, one edit and one answer of what came loose, as an ask has (a page counts them). */
  function send(rule, list, tag) {
    // All of it goes in before anything is asked about: a rail that crosses from one tile to the next hangs from posts in both, and asked about with half of it there, that half fell.
    list.forEach((t, k) => apply({ by: `rule ${rule}`.slice(0, 24), edit: t.edit, box: t.box, release: t.release, built: tag(k, list.length) }))
    for (const t of list) { if (loose(t.edit)) asking.push(t.release); else settle(null) }
    if (asking.length && !pump) pump = setTimeout(ask, 0)
  }
  /** The places still to be asked about, and the clock that asks: one at a time with the world's own work between, so a fenced track (25 tiles at 60 ms) holds nobody up for a second and a half. */
  const asking = []
  let pump = null
  function ask() {
    pump = null
    if (!busy()) settle(asking.shift())
    if (asking.length) pump = setTimeout(ask, busy() ? 100 : 20)
  }

  /** Takes a build away. Answers how many cells were put back and how many were left as they are. */
  function take(b) {
    const c = core(), others = [...builds.values()].filter((o) => o !== b && meet(o.box, b.box)), stood = bodies(), back = []
    let put = 0, left = 0
    for (let i = 0; i < b.rows.length; i += 5) {
      const y = b.rows[i + 2], z = b.rows[i + 3], kind = b.rows[i + 4], near = stood.filter(({ box }) => b.rows[i] < box[3] && b.rows[i + 1] > box[0] && y >= box[1] && y < box[4] && z >= box[2] && z < box[5])
      for (let x = b.rows[i]; x < b.rows[i + 1]; x++) {
        const old = b.was[i + 4]
        if (c.world_kind(x, y, z) !== kind || near.some(({ box }) => x >= box[0] && x < box[3]) || others.some((o) => holds(o, x, y, z))) { left++; continue }
        const last = back.length - 5
        if (last >= 0 && back[last + 1] === x && back[last + 2] === y && back[last + 3] === z && back[last + 4] === old) back[last + 1] = x + 1
        else back.push(x, x + 1, y, z, old)
        put++
      }
    }
    builds.delete(key(b.rule, b.id))
    // Something is always said, so that a world started again knows the build is gone: with nothing to put back, one cell as it is.
    if (!back.length) back.push(b.box[0], b.box[0] + 1, b.box[1], b.box[2], c.world_kind(b.box[0], b.box[1], b.box[2]))
    send(b.rule, tiles(back), () => ({ rule: b.rule, id: b.id, gone: true }))
    restand(b.box)
    return { put, left }
  }

  return {
    /** A rule's builds: [{id, sum, cells, rows, box}]. */
    of: (rule) => [...builds.values()].filter((b) => b.rule === rule).map((b) => ({ id: b.id, sum: b.sum, cells: b.cells, rows: b.rows.length / 5, box: b.box })),
    /** How many builds the world has. */
    count: () => builds.size,
    /**
     * Puts a build in, whole or not at all: `rows` are the cells it is to be (x0, x1, y, z, kind each, flat). One of
     * the same rule and id is taken away first. Answers {cells, rows, box, edits} or {error} in words for the rule.
     */
    put(rule, id, sum, rows) {
      if (busy()) return { error: 'the world is being put together again this moment: build again on the next call' }
      const old = builds.get(key(rule, id)), box = boxOf(rows)
      // Not into or from under anyone the world does not move.
      const stood = bodies().filter((b) => meet(b.box, box))
      for (let i = 0; i < rows.length && stood.length; i += 5) {
        const who = reaches(stood, rows[i], rows[i + 1], rows[i + 2], rows[i + 3])
        if (who) return { error: `${who.who} is in the way at ${who.box[0] + ROUND}, ${who.box[2] + ROUND}: nothing is built into or from under someone. Build beside them, or when they have moved (world.people says where everyone is)` }
      }
      // Not over cells another rule's build holds: what one rule built is not another's to change.
      for (const o of builds.values()) {
        if (o.rule === rule || !meet(o.box, box)) continue
        for (let i = 0; i < rows.length; i += 5) {
          const list = o.at.get(`${rows[i + 2]}|${rows[i + 3]}`)
          if (list) for (const r of list) if (rows[i] < o.rows[r + 1] && rows[i + 1] > o.rows[r]) return { error: `it would change cells of build "${o.id}", another rule's, at ${Math.max(rows[i], o.rows[r])}, ${rows[i + 2]}, ${rows[i + 3]}: build beside or on top of it` }
        }
      }
      if (old) take(old)
      const read = changed(rows)
      if (!read[0].length) return { cells: 0, rows: 0, box, edits: 0 }
      const [made, was] = adopt(rule, null, read[0], read[1])
      const b = { rule, id, sum, rows: made, was, box: boxOf(made), cells: 0 }
      for (let i = 0; i < made.length; i += 5) b.cells += made[i + 1] - made[i]
      index(b)
      builds.set(key(rule, id), b)
      const list = tiles(made)
      send(rule, list, (k, of) => ({ rule, id, sum, k, of }))
      restand(b.box)
      return { cells: b.cells, rows: made.length / 5, box: b.box, edits: list.length }
    },
    /** Takes a rule's build away, if it has one of that id. Answers {put, left}, or null. */
    clear(rule, id) {
      const b = builds.get(key(rule, id))
      return b && !busy() ? take(b) : null
    },
    /** A rule was taken out: what it built goes with it. */
    dropped(rule) { for (const b of [...builds.values()]) if (b.rule === rule) take(b) },
    /** An edit of a build's, sent again as the world starts (or its core is swapped), just before it goes in: what is there now is what it replaced. */
    replayed(tag, words) {
      if (!tag || typeof tag.rule !== 'string' || typeof tag.id !== 'string') return
      const k = key(tag.rule, tag.id)
      if (tag.gone) { builds.delete(k); return }
      let b = builds.get(k)
      if (!b || tag.k === 0 || b.sum !== tag.sum) builds.set(k, b = { rule: tag.rule, id: tag.id, sum: tag.sum, rows: [], was: [], box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], cells: 0, at: new Map() })
      const [made, was] = adopt(tag.rule, b, ...changed(Array.prototype.slice.call(words, 2)))
      for (let i = 0; i < made.length; i += 5) { b.rows.push(made[i], made[i + 1], made[i + 2], made[i + 3], made[i + 4]); b.was.push(was[i], was[i + 1], was[i + 2], was[i + 3], was[i + 4]); b.cells += made[i + 1] - made[i]; grow(b.box, made[i], made[i + 1], made[i + 2], made[i + 3]) }
      index(b)
    },
  }
}
