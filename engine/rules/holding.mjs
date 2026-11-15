// Holding a thing (#264, the HANDS lane): for the world's process. A made thing is picked up, carried and put
// down. Picked up, its cells leave the world in one edit and it rides in the holder's right hand as a few boxes
// the figure carries (page/wear.ts `carry`); put down, its cells go back where the holder says, standing on what
// is there, into air only. A rule hears `held` and `put`, and on `act` what was in the hand (`e.using`); it may
// give someone a thing and take it from them.
//
// A thing is one person's at a time, and a person holds one thing. Whoever leaves puts theirs down where they stood.
import { boxOf, inHand } from '../page/held.ts'

export { boxOf, inHand }

/**
 * @param folk   everyone with a body, by name: {by, name, at (feet), rule?}
 * @param kind   what a cell is: (x, y, z) => kind
 * @param hear   tells every rule something happened: (event, e)
 * @param seen   someone's look changed: they are told of again
 * @param want   asks the server for something only it can start (a thing's cells are its to give)
 */
export function holding({ folk, kind, hear, seen, want }) {
  /** By holder: the thing, its name, its cells as they were, and what the hand carries. */
  const held = new Map()
  // A thing of finer cells (#372: `grain` 4 or 8 of its cells lie along one of the world's) is taken out and put back
  // as rows of those cells: it is the same thing in the hand and on the ground. Places and boxes told to others are
  // always in the world's cells.
  const rowsEdit = (rows, grain = 1) => { const out = [grain === 4 ? 3 : grain === 8 ? 4 : 1, rows.length / 5]; for (const v of rows) out.push(v); return out }
  /** The most a hand takes: this far along any side (the world's cells), so many rows and so many cells. Everything done with a held thing is a walk through these. */
  const SIDE_MOST = 64, ROWS_MOST = 40_000, CELLS_MOST = 1_500_000
  const liftable = (rows, g) => {
    if (rows.length / 5 > ROWS_MOST) return false
    let cells = 0
    for (let i = 0; i < rows.length; i += 5) { cells += rows[i + 1] - rows[i]; if (cells > CELLS_MOST) return false }
    const b = boxOf(rows)
    return [0, 1, 2].every((a) => (b[a + 3] - b[a]) / g <= SIDE_MOST)
  }
  /** A box of rows counted in finer cells, in the world's cells. */
  const coarse = (b, g) => (g === 1 ? b : [Math.floor(b[0] / g), Math.floor(b[1] / g), Math.floor(b[2] / g), Math.ceil(b[3] / g), Math.ceil(b[4] / g), Math.ceil(b[5] / g)])
  /** Rows of finer cells as rows of the world's: a cell wherever any of them lies. What is thrown is a body of the world's cells. */
  const coarseRows = (rows, g) => {
    if (g === 1) return rows
    const cells = new Map()
    for (let i = 0; i < rows.length; i += 5) for (let x = Math.floor(rows[i] / g); x <= Math.floor((rows[i + 1] - 1) / g); x++) cells.set(`${Math.floor(rows[i + 2] / g)},${Math.floor(rows[i + 3] / g)},${x}`, [x, Math.floor(rows[i + 2] / g), Math.floor(rows[i + 3] / g), rows[i + 4]])
    const out = []
    for (const [x, y, z, k] of [...cells.values()].sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])) out.push(x, x + 1, y, z, k)
    return out
  }
  /** Where a thing's cells go when it is put down at a place: moved so the middle of its foot is there, standing on the highest thing under it, into air only. */
  const placed = (rows, at, g = 1) => {
    // Moved by whole cells of the world, so a thing of finer cells keeps where it lies in them.
    const b = boxOf(rows), dx = Math.round(at[0] - (b[0] + b[3]) / 2 / g) * g, dz = Math.round(at[2] - (b[2] + b[5]) / 2 / g) * g
    const lo = coarse([b[0] + dx, b[1], b[2] + dz, b[3] + dx, b[4], b[5] + dz], g)
    let top = -Infinity
    for (let x = lo[0]; x < lo[3]; x += g === 1 ? 2 : 1) for (let z = lo[2]; z < lo[5]; z += g === 1 ? 2 : 1) { let y = Math.round(at[1]) + 12; for (let k = 0; k < 60 && !kind(x, y - 1, z); k++) y--; top = Math.max(top, y) }
    const dy = top * g - b[1], out = []
    for (let i = 0; i < rows.length; i += 5) {
      // A row is cut where something already is: nothing of the world is written over.
      let from = null
      for (let x = rows[i] + dx; x <= rows[i + 1] + dx; x++) {
        const free = x < rows[i + 1] + dx && !kind(Math.floor(x / g), Math.floor((rows[i + 2] + dy) / g), Math.floor((rows[i + 3] + dz) / g))
        if (free && from === null) from = x
        if (!free && from !== null) { out.push(from, x, rows[i + 2] + dy, rows[i + 3] + dz, rows[i + 4]); from = null }
      }
      // Cut into more rows than a thing may be (stood in a comb of other things): there is no room for it there.
      if (out.length / 5 > 120_000) return []
    }
    return out
  }
  const over = (b) => [(b[0] + b[3]) >> 1, b[4] + 2, (b[2] + b[5]) >> 1]
  const self = {
    /** What someone holds: {thing, name}, or nothing. */
    of: (by) => { const h = held.get(by); return h ? { thing: h.thing, name: h.name } : undefined },
    /** What their hand carries, as a figure is to draw it. */
    carried: (by) => held.get(by)?.carry,
    /**
     * An ask to pick a thing up, with the thing's cells from the server: made whole here (the edit that takes its
     * cells out, what the hand carries). Says why not, or nothing.
     */
    hold(ask, rows) {
      const p = folk.get(ask.by)
      if (!p) return 'nobody of that name has a body here'
      if (!rows?.length) return 'that thing has no cells to pick up'
      // What a hand takes is bounded here, before anything goes through its cells: rows are what some client sent.
      if (!liftable(rows, ask.grain === 4 || ask.grain === 8 ? ask.grain : 1)) return 'that is too big to pick up'
      const g = ask.grain === 4 || ask.grain === 8 ? ask.grain : 1, box = coarse(boxOf(rows), g), gone = []
      for (let i = 0; i < rows.length; i += 5) gone.push(rows[i], rows[i + 1], rows[i + 2], rows[i + 3], 0)
      const carry = inHand(rows, g)
      held.set(ask.by, { thing: ask.hold, name: ask.name ?? ask.hold, rows: Array.from(rows), carry, grain: g })
      delete ask.grain
      Object.assign(ask, { edit: rowsEdit(gone, g), box, release: over(box), thing: { id: ask.hold, held: ask.by } })
      seen(p)
      hear('held', { by: ask.by, name: p.name, thing: ask.hold, called: ask.name ?? ask.hold, at: p.at.map(Math.round) })
      return ''
    },
    /** An ask to put down what someone holds, at a place (or at their feet): made whole here. Says why not, or nothing. */
    put(ask) {
      const h = held.get(ask.by), p = folk.get(ask.by)
      if (!h) return 'that hand is empty'
      const g = h.grain ?? 1, at = ask.at ?? p?.at ?? over(coarse(boxOf(h.rows), g)), rows = placed(h.rows, at, g)
      if (!rows.length) return 'there is no room for it there'
      held.delete(ask.by)
      const box = coarse(boxOf(rows), g)
      Object.assign(ask, { put: h.thing, at: at.map(Math.round), edit: rowsEdit(rows, g), box, release: over(box), thing: { id: h.thing, held: null, at: [(box[0] + box[3]) >> 1, box[1], (box[2] + box[5]) >> 1] } })
      if (p) seen(p)
      hear('put', { by: ask.by, name: p?.name ?? ask.by, thing: h.thing, called: h.name, at: ask.thing.at })
      return ''
    },
    /** A world started again finds a thing still marked as held, with nobody to hold it: it is put down where it was taken from. Returns the ask, made whole. */
    settle(id, rows, at, grain) {
      const g = grain === 4 || grain === 8 ? grain : 1, placedRows = placed(rows, at ?? over(coarse(boxOf(rows), g)), g)
      if (!placedRows.length) return null
      const box = coarse(boxOf(placedRows), g)
      return { by: 'the world', put: id, at: (at ?? over(box)).map(Math.round), edit: rowsEdit(placedRows, g), box, release: over(box), thing: { id, held: null, at: [(box[0] + box[3]) >> 1, box[1], (box[2] + box[5]) >> 1] } }
    },
    /** What someone holds leaves their hand to be thrown: the hand is empty, and its cells (as rows, where they last stood) are the thrower's to make a body of. Or nothing. */
    letGo(by) {
      const h = held.get(by), p = folk.get(by)
      if (!h) return null
      held.delete(by)
      if (p) seen(p)
      hear('thrown', { by, name: p?.name ?? by, thing: h.thing, called: h.name, at: (p?.at ?? [0, 0, 0]).map(Math.round) })
      return { thing: h.thing, called: h.name, rows: coarseRows(h.rows, h.grain ?? 1) }
    },
    /** Someone is gone: what they held is to be put down where they stood. Returns the ask for it, or nothing. */
    left: (p) => (held.has(p.by) ? { by: p.by, put: held.get(p.by).thing, at: p.at.map(Math.round) } : null),
    /** `world.give(person, {thing})`: a rule puts a made thing in someone's hand. The server has its cells, so it is asked. */
    give(rule, w, _now, wrong) {
      if (typeof w.id !== 'string' || !folk.has(w.id) || folk.get(w.id).rule) return wrong('who a thing is given to is an id of world.people: someone at a page or in a seat')
      if (typeof w.thing !== 'string' || w.thing.length > 64) return wrong('what is given is thing: the id of a made thing')
      want({ hold: { by: w.id, id: w.thing } })
    },
    /** `world.take(person)`: what they hold is put down at their feet. */
    take(rule, w, _now, wrong) { if (!held.has(w.id)) return wrong(`${String(w.id).slice(0, 24)} holds nothing`); want({ put: { by: w.id } }) },
  }
  return self
}
