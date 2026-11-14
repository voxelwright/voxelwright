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
  const rowsEdit = (rows) => [1, rows.length / 5, ...rows]
  /** Where a thing's cells go when it is put down at a place: moved so the middle of its foot is there, standing on the highest thing under it, into air only. */
  const placed = (rows, at) => {
    const b = boxOf(rows), dx = Math.round(at[0] - (b[0] + b[3]) / 2), dz = Math.round(at[2] - (b[2] + b[5]) / 2)
    let top = -Infinity
    for (let x = b[0] + dx; x < b[3] + dx; x += 2) for (let z = b[2] + dz; z < b[5] + dz; z += 2) { let y = Math.round(at[1]) + 12; for (let k = 0; k < 60 && !kind(x, y - 1, z); k++) y--; top = Math.max(top, y) }
    const dy = top - b[1], out = []
    for (let i = 0; i < rows.length; i += 5) {
      // A row is cut where something already is: nothing of the world is written over.
      let from = null
      for (let x = rows[i] + dx; x <= rows[i + 1] + dx; x++) {
        const free = x < rows[i + 1] + dx && !kind(x, rows[i + 2] + dy, rows[i + 3] + dz)
        if (free && from === null) from = x
        if (!free && from !== null) { out.push(from, x, rows[i + 2] + dy, rows[i + 3] + dz, rows[i + 4]); from = null }
      }
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
      const box = boxOf(rows), gone = []
      for (let i = 0; i < rows.length; i += 5) gone.push(rows[i], rows[i + 1], rows[i + 2], rows[i + 3], 0)
      const carry = inHand(rows)
      held.set(ask.by, { thing: ask.hold, name: ask.name ?? ask.hold, rows: Array.from(rows), carry })
      Object.assign(ask, { edit: rowsEdit(gone), box, release: over(box), thing: { id: ask.hold, held: ask.by } })
      seen(p)
      hear('held', { by: ask.by, name: p.name, thing: ask.hold, called: ask.name ?? ask.hold, at: p.at.map(Math.round) })
      return ''
    },
    /** An ask to put down what someone holds, at a place (or at their feet): made whole here. Says why not, or nothing. */
    put(ask) {
      const h = held.get(ask.by), p = folk.get(ask.by)
      if (!h) return 'that hand is empty'
      const at = ask.at ?? p?.at ?? over(boxOf(h.rows)), rows = placed(h.rows, at)
      if (!rows.length) return 'there is no room for it there'
      held.delete(ask.by)
      const box = boxOf(rows)
      Object.assign(ask, { put: h.thing, at: at.map(Math.round), edit: rowsEdit(rows), box, release: over(box), thing: { id: h.thing, held: null, at: [(box[0] + box[3]) >> 1, box[1], (box[2] + box[5]) >> 1] } })
      if (p) seen(p)
      hear('put', { by: ask.by, name: p?.name ?? ask.by, thing: h.thing, called: h.name, at: ask.thing.at })
      return ''
    },
    /** A world started again finds a thing still marked as held, with nobody to hold it: it is put down where it was taken from. Returns the ask, made whole. */
    settle(id, rows, at) {
      const placedRows = placed(rows, at ?? over(boxOf(rows)))
      if (!placedRows.length) return null
      const box = boxOf(placedRows)
      return { by: 'the world', put: id, at: (at ?? over(box)).map(Math.round), edit: rowsEdit(placedRows), box, release: over(box), thing: { id, held: null, at: [(box[0] + box[3]) >> 1, box[1], (box[2] + box[5]) >> 1] } }
    },
    /** What someone holds leaves their hand to be thrown: the hand is empty, and its cells (as rows, where they last stood) are the thrower's to make a body of. Or nothing. */
    letGo(by) {
      const h = held.get(by), p = folk.get(by)
      if (!h) return null
      held.delete(by)
      if (p) seen(p)
      hear('thrown', { by, name: p?.name ?? by, thing: h.thing, called: h.name, at: (p?.at ?? [0, 0, 0]).map(Math.round) })
      return { thing: h.thing, rows: h.rows }
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
