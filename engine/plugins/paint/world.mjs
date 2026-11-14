// Marks on the ground (#264; asked for by a game of tag: "a rule can neither place cones or chalk nor paint lines on
// cells, so the area is told in words on screen"). `world.paint(id, {...})`: a rule draws a ring or a line on the
// ground, in a colour, as chalk is drawn: everyone there sees it, lying on the road and the pavement, hidden by
// what stands in front of it. It is not cells: the world is not changed by it and nothing remembers it but the rule
// that drew it. Taken out, the rule's marks go with it. What a mark means (where a game is played, a finish line, a
// stall's patch) is the rule's own: `world.mark` tells it who is inside one.
//
// Every field is a stranger's: what is wrong is said to the rule and left. The marks of every rule of the world are
// told to pages whenever one changes (`pages.state`): a page that joins later is given them.
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const COLOUR = /^#[0-9a-fA-F]{6}$/
/** The most marks a rule may have, and a world; the most points in a line; how far a mark may reach (cells, from its middle); the most changes a rule may make a second. */
export const MARKS_A_RULE = 16, MARKS_A_WORLD = 64, POINTS_MOST = 32, REACH_MOST = 2000, CHANGES_A_SECOND = 20
/** How wide a line is (cells), and how much of the inside is tinted, unless the rule says. */
const WIDE = [1, 40], FILL_MOST = 0.8, CHALK = '#f4f1e8'
const FIELDS = ['do', 'id', 'at', 'within', 'line', 'closed', 'colour', 'wide', 'fill', 'hide']
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const spot = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => num(v, -(2 ** 30), 2 ** 30))

/** A mark as it is told to pages, read again as a stranger's (a version before this one hands them on): or null. */
export function markOf(m) {
  if (!m || typeof m !== 'object' || typeof m.rule !== 'string' || !ID.test(m.id ?? '') || !COLOUR.test(m.colour ?? '') || !num(m.wide, WIDE[0], WIDE[1]) || !num(m.fill, 0, FILL_MOST)) return null
  const base = { rule: m.rule.slice(0, 64), id: m.id, colour: m.colour.toLowerCase(), wide: m.wide, fill: m.fill }
  if (spot(m.at) && num(m.within, 1, REACH_MOST)) return { ...base, at: m.at, within: m.within }
  if (Array.isArray(m.line) && m.line.length >= 2 && m.line.length <= POINTS_MOST && m.line.every(spot)) return { ...base, line: m.line, closed: m.closed === true }
  return null
}

export default ({ pages, was }) => {
  /** Every rule's marks, by `rule/id`, in the order they were first drawn. */
  const marks = new Map()
  for (const m of Array.isArray(was) ? was : []) { const ok = markOf(m); if (ok && marks.size < MARKS_A_WORLD) marks.set(`${ok.rule}/${ok.id}`, ok) }
  const tell = () => pages.state([...marks.values()])
  if (marks.size) tell()
  /** By rule: when its second began and how many changes it has made in it. */
  const changed = new Map()
  return {
    does: {
      paint(rule, w, now, wrong) {
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return wrong(`paint has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
        if (typeof w.id !== 'string' || !ID.test(w.id)) return wrong('a mark has an id of the rule\'s own: lower-case letters, digits and dashes, up to 24')
        const key = `${rule.id}/${w.id}`, old = marks.get(key)
        if (w.hide === true) { if (old) { marks.delete(key); tell() } return }
        if (w.hide !== undefined) return wrong('hide is true, to take the mark away, or left out')
        const count = changed.get(rule.id)
        if (!count || now - count.since > 1000) changed.set(rule.id, { since: now, n: 1 })
        else if (++count.n > CHANGES_A_SECOND) return wrong(`a rule changes its marks at most ${CHANGES_A_SECOND} times a second`)
        const next = old ? { ...old } : { rule: rule.id, id: w.id, colour: CHALK, wide: 3, fill: 0 }
        // The shape: a ring round a place, or a line through points. Given, it takes the place of the other.
        if (w.line !== undefined) {
          if (w.at !== undefined || w.within !== undefined) return wrong(`mark "${w.id}" is a ring (at and within) or a line: one of the two`)
          if (!Array.isArray(w.line) || w.line.length < 2 || w.line.length > POINTS_MOST || !w.line.every(spot)) return wrong(`a line is 2 to ${POINTS_MOST} points, each [x, z]`)
          const xs = w.line.map((p) => p[0]), zs = w.line.map((p) => p[1])
          if (Math.max(...xs) - Math.min(...xs) > REACH_MOST * 2 || Math.max(...zs) - Math.min(...zs) > REACH_MOST * 2) return wrong(`a line reaches at most ${REACH_MOST * 2} cells from end to end, each way`)
          next.line = w.line.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]); delete next.at; delete next.within
          if (next.closed === undefined) next.closed = false
        } else if (w.at !== undefined || w.within !== undefined) {
          const at = w.at ?? next.at, within = w.within ?? next.within
          if (!spot(at)) return wrong(`mark "${w.id}" is at: [x, z], the middle of its ring`)
          if (!num(within, 1, REACH_MOST)) return wrong(`within is how far the ring is from its middle: 1 to ${REACH_MOST} cells`)
          next.at = [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10]; next.within = Math.round(within * 10) / 10; delete next.line; delete next.closed
        } else if (!old) return wrong(`a new mark needs its shape: at: [x, z] and within: cells for a ring, or line: [[x, z], ...] for a line`)
        if (w.closed !== undefined) { if (next.line && typeof w.closed === 'boolean') next.closed = w.closed; else wrong('closed is true or false, for a line: true joins its last point to its first') }
        if (w.colour !== undefined) { if (typeof w.colour === 'string' && COLOUR.test(w.colour)) next.colour = w.colour.toLowerCase(); else wrong('colour is "#rrggbb"') }
        if (w.wide !== undefined) { if (num(w.wide, WIDE[0], WIDE[1])) next.wide = Math.round(w.wide * 10) / 10; else wrong(`wide is ${WIDE[0]} to ${WIDE[1]} cells`) }
        if (w.fill !== undefined) { if (num(w.fill, 0, FILL_MOST)) next.fill = Math.round(w.fill * 100) / 100; else wrong(`fill is 0 to ${FILL_MOST}: how much the inside of a ring or a closed line is tinted`) }
        if (!old) {
          let mine = 0
          for (const m of marks.values()) if (m.rule === rule.id) mine++
          if (mine >= MARKS_A_RULE) return wrong(`a rule has at most ${MARKS_A_RULE} marks: hide one first`)
          if (marks.size >= MARKS_A_WORLD) return wrong(`a world has at most ${MARKS_A_WORLD} marks, of all its rules`)
        }
        // Said only when it has changed: a rule may draw the same ring on every tick.
        if (old && JSON.stringify(old) === JSON.stringify(next)) return
        marks.set(key, next)
        tell()
      },
    },
    dropped(ruleId) {
      changed.delete(ruleId)
      let gone = false
      for (const [key, m] of marks) if (m.rule === ruleId) { marks.delete(key); gone = true }
      if (gone) tell()
    },
    state: () => [...marks.values()],
  }
}
