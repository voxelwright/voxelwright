// Getting about (#218, for #264): how a body the world's process moves gets from where it is to where it is
// going. A walk is a straight line while that is open. Stopped by something, the body looks for a way round
// over the world's own cells, edits and all (a search over a grid of standing places, each step one a person
// could take: along, up a kerb or a stair, down a drop, or up onto something waist-high with the hands), and
// walks that. A body can be told to follow someone, to keep away from them, or to keep a distance; and a rule
// hears `near` when a person comes within an actor's reach or into a place it marked, so it need not look
// every tick.
//
// For world.mjs, which owns the bodies (`folk`) and says what a cell is.

/** How far apart the standing places a way is searched over are (cells), and how many may be looked at in one search: about a tenth of a second of the world's one thread at the very most. */
const GRID = 4, LOOKED_MOST = 900
/** How high a body gets up onto something with its hands (cells: a car's bonnet, a wall to the waist), and how long that takes (ms). */
const HANDS = 10, CLIMB_MS = 550
/** How long a way that was not found is not looked for again (ms), and how often a body following someone looks again. */
const NO_WAY_FOR = 3000, AGAIN_AFTER = 700
/** The furthest an actor's reach and a marked place may go (cells), and the most places a rule may mark. */
export const REACH_MOST = 600, MARK_WITHIN_MOST = 2000, MARKS_MOST = 32

/**
 * @param folk     everyone with a body, by key
 * @param footing  (x, y, z) => where feet come to rest in a column, coming to it at a height (a step of two up, a drop), or null
 * @param kind     (x, y, z) => what a cell is (0: air)
 * @param tall     how tall a body is, cells
 * @param pace     a walk, cells a second
 * @param say      what stopped a body, as a sentence: (x, y, z) => string
 * @param hear     (ruleId, event, e) => a rule is told something
 */
export function about({ folk, footing, kind, tall, pace: PACE, say, hear }) {
  /** Where feet come to rest in a column, as `footing` says; or, with the hands, on top of something up to waist-high there. `[feet, climbed]` or null. */
  const stand = (x, y, z) => {
    const feet = footing(x, y, z)
    if (feet !== null) return [feet, false]
    x = Math.round(x); y = Math.round(y); z = Math.round(z)
    for (let up = 3; up <= HANDS; up++) {
      if (!kind(x, y + up - 1, z)) continue
      let room = true
      for (let k = 0; k < tall && room; k++) room = !kind(x, y + up + k, z)
      if (room) return [y + up, true]
    }
    return null
  }
  /** Whether a body can go straight from a place to another, a cell at a time, without its hands; and the height it arrives at. */
  const straight = (from, to, most = 60) => {
    const dx = to[0] - from[0], dz = to[1] - from[2], far = Math.hypot(dx, dz)
    if (far > most) return null
    let y = from[1]
    for (let d = 1; d <= far; d++) { const feet = footing(from[0] + dx / far * d, y, from[2] + dz / far * d); if (feet === null) return null; y = feet }
    return y
  }
  /**
   * A way from a place to another over standing places `GRID` apart: the places to pass, in order, the last of them
   * as near the end as could be got; or null if nothing nearer than the start was found. `spent` says how many
   * places were looked at.
   */
  function way(from, to) {
    const x0 = Math.round(from[0]), z0 = Math.round(from[2]), key = (i, j) => (i + 512) * 1024 + (j + 512)
    const h = (i, j) => Math.hypot(to[0] - (x0 + i * GRID), to[1] - (z0 + j * GRID))
    // By place on the grid: how high one stands there, how far it has been to get there, where from.
    const seen = new Map([[key(0, 0), { i: 0, j: 0, y: Math.round(from[1]), g: 0, f: h(0, 0), back: null, shut: false }]])
    const open = [seen.get(key(0, 0))]
    let best = open[0], looked = 0
    // One cell at a time along an edge, with the hands where the feet alone are stopped.
    const edge = (n, di, dj) => {
      let y = n.y, cost = 0
      const steps = di && dj ? Math.round(GRID * 1.414) : GRID
      for (let s = 1; s <= steps; s++) { const at = stand(x0 + (n.i + di * s / steps) * GRID, y, z0 + (n.j + dj * s / steps) * GRID); if (!at) return null; y = at[0]; cost += at[1] ? 30 : 0 }
      return { y, cost: cost + (di && dj ? GRID * 1.414 : GRID) }
    }
    while (open.length && looked < LOOKED_MOST) {
      let at = 0
      for (let k = 1; k < open.length; k++) if (open[k].f < open[at].f) at = k
      const n = open.splice(at, 1)[0]
      if (n.shut) continue
      n.shut = true; looked++
      const left = h(n.i, n.j)
      if (left < h(best.i, best.j)) best = n
      if (left <= GRID * 1.5) { best = n; break }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if ((!di && !dj) || Math.abs(n.i + di) > 500 || Math.abs(n.j + dj) > 500) continue
        const k = key(n.i + di, n.j + dj), old = seen.get(k)
        if (old?.shut) continue
        const e = edge(n, di, dj)
        if (!e) continue
        const g = n.g + e.cost
        if (old && old.g <= g) continue
        // A little greedy (1.3): fewer places looked at for a way a little longer than the shortest.
        const next = { i: n.i + di, j: n.j + dj, y: e.y, g, f: g + 1.3 * h(n.i + di, n.j + dj), back: n, shut: false }
        seen.set(k, next); open.push(next)
      }
    }
    way.spent = looked
    if (h(best.i, best.j) > h(0, 0) - GRID * 2) return null
    const out = []
    for (let n = best; n.back; n = n.back) out.unshift([x0 + n.i * GRID, z0 + n.j * GRID])
    // The end itself, if the last place has it in a straight line.
    const last = out[out.length - 1], lastY = best.y
    if (Math.hypot(to[0] - last[0], to[1] - last[1]) <= GRID * 1.5 && straight([last[0], lastY, last[1]], to, GRID * 2) !== null) out.push([to[0], to[1]])
    return out
  }
  way.spent = 0
  /** One search a tick for everyone together: the rest wait their turn standing. */
  let searched = -1
  const stats = { ways: 0, none: 0, looked: 0, ms: 0, worst: 0 }

  /** A body that follows someone, or keeps away from them, is given where to go this tick. */
  function towards(p, now) {
    const f = p.follow, them = folk.get(f.by)
    if (!them) { p.follow = undefined; p.goal = null; p.path = undefined; p.stopped = 'whoever it followed is gone'; return }
    const dx = them.at[0] - p.at[0], dz = them.at[2] - p.at[2], far = Math.hypot(dx, dz) || 1
    let goal = null
    // Following: up to `keep` cells of them, and no nearer. Keeping away: off along the line from them until `keep` cells lie between.
    if (!f.flee && far > f.keep + 3) goal = [them.at[0] - dx / far * f.keep, them.at[2] - dz / far * f.keep]
    else if (f.flee && far < f.keep) goal = [p.at[0] - dx / far * (f.keep - far + 20), p.at[2] - dz / far * (f.keep - far + 20)]
    if (!goal) { if (p.goal) { p.goal = null; p.path = undefined } if (!f.flee) p.yaw = Math.atan2(dx, -dz); return }
    // The way it was on is good while they have not gone far from where it led.
    if (p.path && p.pathTo && Math.hypot(goal[0] - p.pathTo[0], goal[1] - p.pathTo[1]) > 16 && now - (p.pathAt ?? 0) > AGAIN_AFTER) p.path = undefined
    p.goal = goal; p.stopped = ''
  }

  /**
   * A tenth of a second of a body's going: along its way if it has one, else straight; stopped, it looks for a way
   * round. Says whether it moved or changed (so that everyone is told).
   */
  function step(p, now, tick) {
    if (p.follow) towards(p, now)
    if (!p.goal || p.down > now || (p.climbs ?? 0) > now) return false
    for (let left = (p.pace ?? PACE) / 10; left > 0 && p.goal;) {
      // A way's next place is cut out when the one after can be walked to straight: the body does not zigzag a grid.
      if (p.path?.length > 1 && straight(p.at, p.path[1], 48) !== null) p.path.shift()
      const to = p.path?.length ? p.path[0] : p.goal
      const dx = to[0] - p.at[0], dz = to[1] - p.at[2], far = Math.hypot(dx, dz), stride = Math.min(far, left, PACE / 10)
      left -= stride
      if (far < 0.5) {
        if (!p.path?.length) { p.goal = null; break }
        p.path.shift()
        if (p.path.length) continue
        // The end of a way: there, or as near as could be got (and it says what kept it from the rest), or straight on for what is left.
        p.path = undefined
        if (p.short_of) { p.stopped = p.short_of; p.short_of = undefined; p.goal = null; break }
        continue
      }
      const x = p.at[0] + dx / far * stride, z = p.at[2] + dz / far * stride
      // On a way it may use its hands; walking straight it does not, and looks for a way when its feet are stopped.
      const feet = p.path ? null : footing(x, p.at[1], z), at = p.path ? stand(x, p.at[1], z) : feet === null ? null : [feet, false]
      if (at) {
        p.at = [x, at[0], z]; p.yaw = Math.atan2(dx, -dz)
        // Up onto something with the hands: a moment's climb, and it looks like one.
        if (at[1]) { p.climbs = now + CLIMB_MS; p.move = { n: (p.move?.n ?? 0) + 1, since: now, name: 'climb', long: 0.7, stays: false }; break }
        continue
      }
      // Stopped. A way round is looked for: one search a tick for everyone, and not again at once for one not found.
      const goal = p.goal
      if (p.noWay && now < p.noWay.until && Math.hypot(goal[0] - p.noWay.to[0], goal[1] - p.noWay.to[1]) < 12) { p.stopped = p.noWay.why; p.goal = null; p.path = undefined; break }
      if (searched === tick) break
      searched = tick
      const began = performance.now(), found = way(p.at, goal), took = performance.now() - began
      stats.looked += way.spent; stats.ms += took; stats.worst = Math.max(stats.worst, took)
      if (found) {
        stats.ways++
        p.path = found; p.pathTo = goal; p.pathAt = now
        const end = found[found.length - 1], short = Math.hypot(goal[0] - end[0], goal[1] - end[1])
        // As near as it can get, if it cannot get there: it walks that far and says what kept it from the rest.
        p.short_of = short > GRID * 1.5 ? `${say(x, p.at[1], z)}, and no way round was found: ${Math.round(short)} cells short of where it was going` : undefined
      } else {
        stats.none++
        const why = `${say(x, p.at[1], z)}, ${Math.round(Math.hypot(goal[0] - p.at[0], goal[1] - p.at[2]))} cells short of where you were going`
        p.noWay = { to: goal, until: now + NO_WAY_FOR, why }
        p.stopped = why; p.goal = null; p.path = undefined
      }
      break
    }
    return true
  }

  // ── Near ──
  /** By rule: the places it marked. And who is inside what, so that coming in and going out are each said once. */
  const marks = new Map(), inside = new Set()
  /** A rule marks a place, or takes a mark away: `world.mark(id, {at: [x, z], within})`, `world.mark(id, {at: null})`. */
  function mark(rule, w, _now, wrong) {
    if (typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(w.id)) return wrong('a marked place has a name of its rule\'s own: lower-case letters, digits and dashes, up to 24')
    const mine = marks.get(rule.id) ?? new Map()
    if (w.at === null) { mine.delete(w.id); return }
    if (!Array.isArray(w.at) || w.at.length < 2 || w.at.length > 3 || !w.at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30) || !Number.isFinite(w.within) || w.within <= 0) return wrong('a marked place is at: [x, z] and within: cells (or at: null to take it away)')
    if (!mine.has(w.id) && mine.size >= MARKS_MOST) return wrong(`a rule may mark ${MARKS_MOST} places`)
    mine.set(w.id, { at: [w.at[0], w.at[w.at.length - 1]], within: Math.min(MARK_WITHIN_MOST, w.within) })
    marks.set(rule.id, mine)
  }
  /** Who has come within an actor's reach or into a marked place since last asked, and who has gone: each rule is told (`near`). */
  function nearness() {
    const now = new Set()
    const people = [...folk.values()].filter((p) => !p.rule)
    const test = (rule, what, id, x, z, within) => {
      for (const who of people) {
        const far = Math.hypot(who.at[0] - x, who.at[2] - z), k = `${rule}|${what}|${id}|${who.by}`, was = inside.has(k)
        // A little further to go out than to come in, or someone on the edge is told of ten times a second.
        if (far <= (was ? within * 1.15 + 3 : within)) { now.add(k); if (!was) hear(rule, 'near', { who: who.by, name: who.name, [what]: id, far: Math.round(far), at: who.at.map(Math.round) }) }
        else if (was) hear(rule, 'near', { who: who.by, name: who.name, [what]: id, far: Math.round(far), at: who.at.map(Math.round), left: true })
      }
    }
    for (const p of folk.values()) if (p.rule && p.rule !== '~' && p.reach) test(p.rule, 'actor', p.short, p.at[0], p.at[2], p.reach)
    for (const [rule, mine] of marks) for (const [id, m] of mine) test(rule, 'place', id, m.at[0], m.at[1], m.within)
    // Whoever was inside something that is no more (a body gone, a mark taken away, a person who left) is not told of: they are just forgotten.
    inside.clear()
    for (const k of now) inside.add(k)
  }
  return { step, mark, nearness, dropped: (id) => { marks.delete(id) }, stats, way }
}
