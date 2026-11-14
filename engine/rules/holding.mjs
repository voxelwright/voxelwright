// Holding a thing (#264, the HANDS lane): for the world's process. A made thing is picked up, carried and put
// down. Picked up, its cells leave the world in one edit and it rides in the holder's right hand as a few boxes
// the figure carries (page/wear.ts `carry`); put down, its cells go back where the holder says, standing on what
// is there, into air only. A rule hears `held` and `put`, and on `act` what was in the hand (`e.using`); it may
// give someone a thing and take it from them.
//
// A thing is one person's at a time, and a person holds one thing. Whoever leaves puts theirs down where they stood.
import { materials, palette } from '../page/march.ts'

/** The most boxes a hand's thing is shown as, and how long (cells) the longest thing in a hand is drawn: longer is drawn smaller. */
const BOXES = 8, LONG = 14
const paints = palette(), stuffs = materials()
/** A kind's colour as the screen has it: #rrggbb. */
const hex = (kind) => { const c = kind >> 8 ? paints.subarray((kind >> 8) * 4, (kind >> 8) * 4 + 3) : stuffs.subarray((kind & 15) * 8, (kind & 15) * 8 + 3); return '#' + [...c].map((v) => Math.round(255 * Math.max(0, Math.min(1, v)) ** (1 / 2.2)).toString(16).padStart(2, '0')).join('') }
/** The box round rows of cells (x0, x1, y, z, kind each): [x0, y0, z0, x1, y1, z1], the high corner not filled. */
export const boxOf = (rows) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < rows.length; i += 5) { b[0] = Math.min(b[0], rows[i]); b[3] = Math.max(b[3], rows[i + 1]); b[1] = Math.min(b[1], rows[i + 2]); b[4] = Math.max(b[4], rows[i + 2] + 1); b[2] = Math.min(b[2], rows[i + 3]); b[5] = Math.max(b[5], rows[i + 3] + 1) } return b }

/**
 * A thing's cells as what a hand carries: up to eight boxes told from the hand, its longest way laid out past the
 * fingers (a figure's -y), each a slice of it in the colour most of that slice is. Drawn at its own size up to
 * 1.4 m long, smaller beyond.
 */
export function inHand(rows) {
  const b = boxOf(rows), size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]]
  const long = size.indexOf(Math.max(...size)), others = [0, 1, 2].filter((a) => a !== long)
  // Of the other two, the one that was up stays across the palm's up (a figure's z), if either was.
  const up = others.includes(1) ? 1 : others[1], side = others.find((a) => a !== up)
  const scale = Math.min(1, LONG / size[long]), n = Math.max(1, Math.min(BOXES, Math.ceil(size[long] / 2)))
  const slices = Array.from({ length: n }, () => ({ lo: [Infinity, Infinity], hi: [-Infinity, -Infinity], kinds: new Map() }))
  for (let i = 0; i < rows.length; i += 5) for (let x = rows[i]; x < rows[i + 1]; x++) {
    const c = [x, rows[i + 2], rows[i + 3]], s = slices[Math.min(n - 1, Math.floor(((c[long] - b[long]) / size[long]) * n))]
    s.lo[0] = Math.min(s.lo[0], c[side]); s.hi[0] = Math.max(s.hi[0], c[side] + 1); s.lo[1] = Math.min(s.lo[1], c[up]); s.hi[1] = Math.max(s.hi[1], c[up] + 1)
    s.kinds.set(rows[i + 4], (s.kinds.get(rows[i + 4]) ?? 0) + 1)
  }
  const out = [], each = (size[long] / n) * scale, mid = [(b[side] + b[side + 3]) / 2, (b[up] + b[up + 3]) / 2]
  slices.forEach((s, k) => {
    if (!s.kinds.size) return
    const kind = [...s.kinds].sort((p, q) => q[1] - p[1])[0][0], round = (v) => Number(v.toFixed(2))
    // A hand's width behind the palm, the rest out past the fingers.
    out.push({ on: 'handR', at: [round(((s.lo[0] + s.hi[0]) / 2 - mid[0]) * scale), round(1.5 - (k + 0.5) * each), round(-((s.lo[1] + s.hi[1]) / 2 - mid[1]) * scale)], size: [round(Math.max(0.2, (s.hi[0] - s.lo[0]) * scale)), round(Math.max(0.2, each)), round(Math.max(0.2, (s.hi[1] - s.lo[1]) * scale))], colour: hex(kind), shiny: (kind & 15) === 12 || (kind & 15) === 11 })
  })
  return out
}

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
      if (held.has(ask.by)) return 'that hand is full: put down what it holds first'
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
    /** Someone is gone: what they held is to be put down where they stood. Returns the ask for it, or nothing. */
    left: (p) => (held.has(p.by) ? { by: p.by, put: held.get(p.by).thing, at: p.at.map(Math.round) } : null),
    /** `world.give(person, {thing})`: a rule puts a made thing in someone's hand. The server has its cells, so it is asked. */
    give(rule, w, _now, wrong) {
      if (typeof w.id !== 'string' || !folk.has(w.id) || folk.get(w.id).rule) return wrong('who a thing is given to is an id of world.people: someone at a page or in a seat')
      if (typeof w.thing !== 'string' || w.thing.length > 64) return wrong('what is given is thing: the id of a made thing')
      if (held.has(w.id)) return wrong(`${w.id} already holds something: world.take(id) first`)
      want({ hold: { by: w.id, id: w.thing } })
    },
    /** `world.take(person)`: what they hold is put down at their feet. */
    take(rule, w, _now, wrong) { if (!held.has(w.id)) return wrong(`${String(w.id).slice(0, 24)} holds nothing`); want({ put: { by: w.id } }) },
  }
  return self
}
