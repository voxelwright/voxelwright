// Living things, as a rule has them (#264, the BODIES lane): for the world's process.
//
// A rule is told the living things near people (`world.things`: each by the id of its record, which stays, what
// it is, where, which way it faces, how fast it goes) and drives one as a rider does (`world.drive`): how hard
// forward or back, which way it turns, up or down, a jump. What a rule asks is held until it asks otherwise or is
// taken out, for a rule is told the time only twice a second and a rider's word lasts one. Someone riding it from
// a page has it while they ride: their hands are on it, the rule's word waits.
//
// And who rides: a rule puts someone in a living thing's seat (`world.seat`): one of its actors, who then goes
// where the thing goes, sitting; or someone at a page, whose page gets them on as if they had asked. A page that
// gets on or off by itself says so. Rules hear `ride` either way, and `world.things` says who is on what.
//
// And a rule brings a living thing into the world itself (`world.thing`): one of a small kept set (rules/kept.mjs:
// a kart, a car, a broom, a craft), set down where it says, facing as it says, in a colour; there at once, with
// no model. It is the rule's to take away again, and goes when the rule does.
//
// And what a fair start and a finish need. A rule holds a thing still whoever drives it (`world.drive(id, {hold:
// true})`: it stands where it is and nobody's hands move it, a rider's from a page neither), and it draws lines
// and places (`world.line`) and hears `crossed` when a living thing or a person goes over one or in or out of
// one: which, which way, where, how fast, and when to the hundredth of a second (worked back along the step it
// was crossed in). Laps, a finish and a checkpoint are then the rule's own numbers.
//
// And how much a thing takes, and how it goes, are numbers a rule sets on what it brought (`world.thing(id,
// {tough, top, power, grip, steer, jump})`): the motor's own. A thing that loses more speed in one step than its
// `tough` breaks (and its rule hears `broke`); one tough enough stops or glances off. With `for: seconds` the
// numbers go back by themselves: something picked up that makes a kart faster, or slippery, for a while.
//
// And a thing is given somewhere to go (`world.drive(id, {to})`): a place, or a course of places, once or round
// and round. The world's process steers it there ten times a second, as it walks an actor to its `to`: it turns
// towards the next place, eases off for a sharp turn, goes round a living thing that is in its way ahead and
// slows behind one it is closing on, and stops for a person on foot. The rule sets the course and the pace; it
// does not steer. What a person rides is the person's: a course waits while they drive.
//
// And nothing on wheels stays wedged. A thing that is asked to go, by a rider or a rule, and makes no way for a
// second and a half (on a kerb, against a wall, pinned by another, on its roof) is set back on its wheels where
// it last went freely, facing as it did then: what a racing game does, and fair to the one driving.
//
// Other racers, a landing craft, a getaway car are a rule driving living things: nothing here knows those words.

import { KEPT } from './kept.mjs'

/** How many living things a rule may have brought into the world at once. */
const MADE_MOST = 16
/** How many lines and places a rule may have, and the longest a line and the widest a place (cells). */
const LINES_MOST = 32, LINE_LONG = 4000
/** The most places a course has, how near a place counts as reached (cells), how far ahead a thing looks for what is in its way and how wide (cells). */
/** How long a thing asked to go may make no way before it is set back where it last went freely (ms), how little counts as no way (cells), and how fast counts as going freely (cells a second). */
const WEDGED = 1500, NO_WAY = 5, FREELY = 25
const COURSE_MOST = 64, REACHED = 22, AHEAD = 90, ABREAST = 17
/** The motor's numbers a rule may set on a thing it brought, each a least and a most (cells and seconds; `tough` is the speed lost in one step that breaks it), and the longest a change may be for (seconds). */
const TUNE = { tough: [10, 2000], top: [0, 400], power: [0, 400], grip: [0.05, 3], steer: [0, 1.5], jump: [0, 300] }, FOR_MOST = 600
/** How near someone a living thing must be for a rule to be told of it (cells), how many it is told of, and how many one rule drives. */
const NEAR = 1500, TOLD_MOST = 32, DRIVEN_MOST = 32
/** Which way a thing's front points in its own cells, by its motor's `front`. */
const FRONTS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
const turned = (q, v) => {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]
}
const axis = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)

/**
 * @param alive  the living things by their record's id: {body, controls, name, pose: {at, rot}, speed, awake, ridden}
 * @param folk   everyone with a body: {by, rule?, at}
 * @param drive  tells the core what a thing is to do: (thing, go, turn, rise, jump)
 * @param tell   says a body again to every page, as it now is
 * @param happen something happened that rules may hear
 * @param stand  the height of somewhere to stand at (x, z), or null
 * @param changed  who a rule has seated at a page has changed: their pages are to be told
 * @param bring  brings a kept thing to life: ({id, rule, thing, low, yaw}) => whether it lives
 * @param take   takes a living thing out of the world, by its id
 * @param place  puts a living thing at a place, turned so, and still: (thing, at, rot)
 * @param hear   one rule hears something: (rule id, event, e)
 * @param retune gives a living thing a motor of these numbers: (thing, motor)
 */
export function things({ alive, folk, drive, tell, happen, stand, changed, bring, take, place, hear, retune }) {
  /** By thing: the numbers its rule set on it for good, and those set for a while with when they end. */
  const tuned = new Map()
  /** A thing's motor as it now is: as it was made, then what was set for good, then each change for a while. */
  const motorOf = (id) => { const a = alive.get(id), t = tuned.get(id); return a && { ...a.controls.motor, ...(t?.set ?? {}), ...Object.assign({}, ...(t?.timed ?? []).map((c) => c.keys)) } }
  const tune = (id) => { const a = alive.get(id); if (a) retune(a, motorOf(id)) }
  /** By thing on wheels: where it last went freely (a short trail), and where and since when it has made no way though asked to go. */
  const going = new Map()
  /** By thing: the rule that holds it still, and where. */
  const stilled = new Map()
  /** A rule's lines and places, by `rule/id`: {rule, id, from, to} or {rule, id, at, within}. And where everything was when last looked at, by thing or person. */
  const lines = new Map(), was = new Map()
  const pair = (a) => Array.isArray(a) && (a.length === 2 || a.length === 3) && a.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)
  const flat = (a) => [a[0], a[a.length - 1]]
  /** How far along a step from p to q something went over a line or a place's edge (0 to 1) and which way, or null. */
  const over = (l, p, q) => {
    if (l.at) {
      const dp = Math.hypot(p[0] - l.at[0], p[1] - l.at[1]), dq = Math.hypot(q[0] - l.at[0], q[1] - l.at[1])
      if ((dp <= l.within) === (dq <= l.within)) return null
      return { t: dp === dq ? 0 : Math.max(0, Math.min(1, (l.within - dp) / (dq - dp))), way: dq <= l.within ? 'in' : 'out' }
    }
    // Which side of the line each end of the step is on, and where along the line the step meets it.
    const d = [l.to[0] - l.from[0], l.to[1] - l.from[1]], sp = d[0] * (p[1] - l.from[1]) - d[1] * (p[0] - l.from[0]), sq = d[0] * (q[1] - l.from[1]) - d[1] * (q[0] - l.from[0])
    if ((sp > 0) === (sq > 0) || sp === sq) return null
    const t = sp / (sp - sq), x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t, along = ((x - l.from[0]) * d[0] + (z - l.from[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])
    return along < 0 || along > 1 ? null : { t, way: sq > 0 ? 1 : -1 }
  }
  /** By thing: the rule that brought it into the world. */
  const made = new Map()
  /** A living thing by the id a rule gives: the world's own, or the rule's own word for one it made. */
  const find = (rule, id) => (typeof id === 'string' ? alive.get(id) ? id : alive.has(`${rule}-${id}`) ? `${rule}-${id}` : null : null)
  /** By person (the name the world knows them by): the thing they ride, and the rule that put them there, if one did. */
  const seats = new Map()
  const idOf = (p, rule) => (p.rule === rule ? p.short : p.by)
  /** Someone is on a thing, or off it: rules hear, and one who gets off is set down beside it. */
  const ride = (by, thing, rule, now) => {
    const p = folk.get(by), was = seats.get(by)
    if (was && (!thing || was.thing !== thing)) {
      seats.delete(by)
      const a = alive.get(was.thing)
      if (p) {
        p.riding = undefined
        if (p.move?.seat) p.move = undefined
        if (a?.pose && (p.rule || p.seat)) { const x = a.pose.at[0] + 14, z = a.pose.at[2]; p.at = [x, stand(Math.round(x), Math.round(z)) ?? a.pose.at[1], z] }
        tell(p)
        happen('ride', { by: p.by, name: p.name, thing: was.thing, on: false })
      }
    }
    if (thing && p && alive.has(thing) && seats.get(by)?.thing !== thing) {
      seats.set(by, { thing, rule, n: free(thing) })
      p.riding = thing
      happen('ride', { by: p.by, name: p.name, thing, on: true })
    }
  }
  /** The first seat of a thing that nobody is in, and whether there is one. */
  const free = (thing) => { const taken = new Set([...seats.values()].filter((s) => s.thing === thing).map((s) => s.n)); let n = 0; while (taken.has(n)) n++; return n }
  const room = (thing) => free(thing) < (alive.get(thing)?.controls.seats?.length ?? 1)
  /** Who is on a thing, as a rule is told them. */
  const riders = (thing, rule) => [...seats].filter(([, s]) => s.thing === thing).map(([by]) => folk.get(by)).filter(Boolean).map((p) => idOf(p, rule))
  /** By thing: the rule that drives it and what it asked. */
  const held = new Map()
  return {
    /** The living things near people, and every one this rule drives however far off: nearest first. */
    near(rule) {
      const out = []
      for (const [id, a] of alive) {
        if (!a.pose) continue
        let far = Infinity
        for (const p of folk.values()) if (p.rule !== '~') far = Math.min(far, Math.hypot(p.at[0] - a.pose.at[0], p.at[2] - a.pose.at[2]))
        const mine = held.get(id)?.rule === rule
        if (far > NEAR && !mine) continue
        const f = turned(a.pose.rot, FRONTS[a.controls.motor.front] ?? FRONTS[0]), up = turned(a.pose.rot, [0, 1, 0])
        out.push({ id, name: a.name || '', scheme: a.controls.scheme, at: a.pose.at.map(Math.round), yaw: Number(Math.atan2(f[0], -f[2]).toFixed(2)), speed: Math.round(a.speed ?? 0), awake: !!a.awake, upright: up[1] > 0.5, ...(mine ? { mine: true } : held.has(id) ? { driven: true } : {}), ...(stilled.has(id) ? { held: true } : {}), ...(mine && held.get(id).course ? { to: held.get(id).course.points[held.get(id).course.n] } : {}), ...(made.get(id) === rule ? { own: id.slice(rule.length + 1), ...Object.fromEntries(Object.keys(TUNE).map((k) => [k, motorOf(id)[k]])) } : {}), seats: a.controls.seats?.length ?? 1, ...(riders(id, rule).length ? { riders: riders(id, rule) } : {}), near: Number.isFinite(far) ? Math.round(far) : null })
      }
      return out.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (a.near ?? Infinity) - (b.near ?? Infinity)).slice(0, TOLD_MOST)
    },
    /** `world.drive(id, {go, turn, rise, jump})`: what a living thing is to do, until told otherwise; {free: true} lets it go. */
    drive(rule, w, now, wrong) {
      const id = find(rule.id, w.id), a = id && alive.get(id)
      if (!a) return wrong('world.drive is for a living thing: an id of world.things')
      const was = held.get(id)
      if (was && was.rule !== rule.id) return wrong('that living thing is another rule\'s to drive')
      if (w.free === true) { if (was) { held.delete(id); drive(a, 0, 0, 0, false) } if (stilled.get(id)?.rule === rule.id) stilled.delete(id); return }
      // Held still, whoever drives it; let go again with hold: false. Only the rule that holds it lets it go.
      if (w.hold !== undefined) {
        const s = stilled.get(id)
        if (s && s.rule !== rule.id) return wrong('that living thing is held still by another rule')
        if (w.hold === true) { if (!s && a.pose) stilled.set(id, { rule: rule.id, at: [...a.pose.at], rot: [...a.pose.rot] }); else if (!s) stilled.set(id, { rule: rule.id, at: null, rot: null }) }
        else if (w.hold === false) stilled.delete(id)
        else return wrong('whether a thing is held still is hold: true or false')
        if (w.go === undefined && w.turn === undefined && w.rise === undefined && w.jump === undefined && w.to === undefined) return
      }
      if (!was && [...held.values()].filter((h) => h.rule === rule.id).length >= DRIVEN_MOST) return wrong(`a rule drives at most ${DRIVEN_MOST} living things at once`)
      const h = { rule: rule.id, go: axis(w.go ?? was?.go), turn: axis(w.turn ?? was?.turn), rise: axis(w.rise ?? was?.rise), jump: w.jump === true, said: 0, course: was?.course }
      // Somewhere to go: a place or a course of them; to: null ends it. Told go or turn outright, the rule steers again.
      if (w.to === null || ((w.go !== undefined || w.turn !== undefined) && w.to === undefined)) h.course = undefined
      else if (w.to !== undefined) {
        const points = pair(w.to) ? [flat(w.to)] : Array.isArray(w.to) && w.to.length >= 1 && w.to.length <= COURSE_MOST && w.to.every(pair) ? w.to.map(flat) : null
        if (!points) return wrong(`where a thing is to go is to: [x, z], or a course of up to ${COURSE_MOST} of them: [[x, z], ...]`)
        h.course = { points, n: 0, loop: w.loop === true, pace: Number.isFinite(w.pace) ? Math.max(0.1, Math.min(1, w.pace)) : 1 }
        h.go = 0; h.turn = 0
      }
      if (h.course && Number.isFinite(w.pace)) h.course.pace = Math.max(0.1, Math.min(1, w.pace))
      held.set(id, h)
    },
    /** Four times a second: what each rule asked of its things is said to the core again, as a rider's hands would. */
    step(now) {
      let any = false
      for (const [id, h] of held) {
        const a = alive.get(id)
        if (!a) { held.delete(id); continue }
        if (now - (a.ridden ?? -Infinity) < 1000 || stilled.has(id)) continue
        // On a course the world steers, every time it looks: where the next place is from where the thing faces.
        if (h.course && a.pose) {
          const c = h.course, f = turned(a.pose.rot, FRONTS[a.controls.motor.front] ?? FRONTS[0]), long = Math.hypot(f[0], f[2]) || 1, ahead = [f[0] / long, f[2] / long], right = [-ahead[1], ahead[0]]
          let to = c.points[c.n], dx = to[0] - a.pose.at[0], dz = to[1] - a.pose.at[2]
          // Reached, or passed: a place close by that is now behind it is not turned back for (it circled one for ever).
          if (Math.hypot(dx, dz) < REACHED || (Math.hypot(dx, dz) < REACHED * 3 && dx * ahead[0] + dz * ahead[1] < 0)) {
            c.n++
            if (c.n >= c.points.length) {
              if (c.loop) c.n = 0
              else { h.course = undefined; h.go = 0; h.turn = 0; drive(a, 0, 0, 0, false); hear(h.rule, 'arrived', { thing: id, ...(made.get(id) === h.rule ? { own: id.slice(h.rule.length + 1) } : {}), at: a.pose.at.map(Math.round) }); any = true; continue }
            }
            to = c.points[c.n]; dx = to[0] - a.pose.at[0]; dz = to[1] - a.pose.at[2]
          }
          const far = Math.hypot(dx, dz) || 1, along = (dx * ahead[0] + dz * ahead[1]) / far, across = (dx * right[0] + dz * right[1]) / far
          let turn = Math.max(-1, Math.min(1, Math.atan2(across, along) * 1.6)), go = c.pace * (1 - 0.6 * Math.abs(turn))
          const speed = Math.abs(a.speed ?? 0), top = motorOf(id)?.top || 100
          // No faster than the turn can be made: into a sharp turn, or coming up to a place where the course turns sharply, it brakes first (it ran wide off the street at a hairpin).
          let fast = top * c.pace * (1 - 0.75 * Math.abs(turn))
          const next = c.points[c.n + 1] ?? (c.loop ? c.points[0] : null)
          if (next && far < 30 + speed * 0.5) { const nx = next[0] - to[0], nz = next[1] - to[1], nl = Math.hypot(nx, nz) || 1, bend = (nx * ahead[0] + nz * ahead[1]) / nl; if (bend < 0.6) fast = Math.min(fast, 22 + 30 * Math.max(0, bend)) }
          if (speed > fast + 8) go = speed > fast + 25 ? -1 : 0
          // What is in its way ahead: a living thing is gone round on the side with more room, and not run into from behind; a person on foot is stopped for.
          let nearest = Infinity
          for (const [other, b] of alive) {
            if (b === a || !b.pose) continue
            const rx = b.pose.at[0] - a.pose.at[0], rz = b.pose.at[2] - a.pose.at[2], on = rx * ahead[0] + rz * ahead[1], off = rx * right[0] + rz * right[1]
            // It looks further the faster it goes: a kart at its top speed is on what is 9 m ahead in two thirds of a second.
            const reach = AHEAD + speed * 1.2, closing = speed - Math.max(0, b.speed ?? 0)
            // How wide the other is, whichever way it stands: half its longer side, and half of this one's width beside it.
            const wide = (b.controls.size ? Math.max(b.controls.size[0], b.controls.size[2]) / 2 : 14) + 10
            if (on < 4 || on > reach || Math.abs(off) > Math.max(ABREAST, wide)) continue
            // It makes for a place beside what is in its way, a body's width clear, on the side it is already nearer; pulled only a little off its line it came back and clipped it.
            if (on < nearest) { nearest = on; turn = Math.max(-1, Math.min(1, Math.atan2(off + (off >= 0 ? -1 : 1) * (wide + 6), on) * 2.4)) }
            // Too near to get round at this speed: it brakes, and goes round slowly.
            // Coming up on what is dead ahead it slows to a speed it can still steer round at, braking only while it is faster than that (told to back off outright, it went to and fro a long way short).
            if (Math.abs(off) < 12 && on < 30 + closing * 0.9) { const safe = Math.max(18, (on - 20) * 0.9); go = closing > safe + 8 ? -1 : Math.min(go, 0.3) }
            // Right behind what it cannot get round, it waits: it does not push.
            if (Math.abs(off) < 12 && on < 26) go = Math.min(go, 0)
          }
          for (const p of folk.values()) {
            if (p.riding || p.rule === '~') continue
            const rx = p.at[0] - a.pose.at[0], rz = p.at[2] - a.pose.at[2], on = rx * ahead[0] + rz * ahead[1], off = rx * right[0] + rz * right[1]
            if (on > 4 && on < 20 + speed * 0.6 && Math.abs(off) < 10) go = speed > 15 ? -1 : 0
          }
          // Asked to go and making no way (against a kerb, a parked car, another kart): it backs out for a second, turned the other way, and tries again.
          if (go > 0.1 && speed < 4) { c.still = (c.still ?? now); if (now - c.still > 900) { c.back = now + 1100; c.still = undefined } } else c.still = undefined
          if (c.back > now) { go = -0.8; turn = -turn } else c.back = undefined
          drive(a, go, turn, 0, false)
          any = true
          continue
        }
        if (now - h.said < 250) continue
        h.said = now
        // One that sleeps and is asked nothing is left asleep.
        if (!h.go && !h.turn && !h.rise && !h.jump && !a.awake) continue
        drive(a, h.go, h.turn, h.rise, h.jump)
        h.jump = false
        any = true
      }
      return any
    },
    /** `world.line(id, {from, to})` or `world.line(id, {at, within})`: a line or a place the rule hears things and people cross; from: null takes it away. */
    line(rule, w, now, wrong) {
      if (typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(w.id)) return wrong('a line has an id of the rule\'s own: lower-case letters, digits and dashes, up to 24')
      const key = `${rule.id}/${w.id}`
      if (w.from === null || w.at === null) { lines.delete(key); return }
      if (!lines.has(key) && [...lines.values()].filter((l) => l.rule === rule.id).length >= LINES_MOST) return wrong(`a rule has at most ${LINES_MOST} lines and places`)
      if (pair(w.from) && pair(w.to)) {
        const from = flat(w.from), to = flat(w.to), long = Math.hypot(to[0] - from[0], to[1] - from[1])
        if (!(long >= 1 && long <= LINE_LONG)) return wrong(`a line is from one place to another, 1 to ${LINE_LONG} cells long`)
        lines.set(key, { rule: rule.id, id: w.id, from, to })
      } else if (pair(w.at) && Number.isFinite(w.within) && w.within >= 1 && w.within <= LINE_LONG) lines.set(key, { rule: rule.id, id: w.id, at: flat(w.at), within: w.within })
      else wrong(`a line is {from: [x, z], to: [x, z]}, or a place {at: [x, z], within: 1 to ${LINE_LONG}}`)
    },
    /** Ten times a second: what is held still stands where it was held, and whatever went over a line since the last look is told to the line's rule. */
    watch(now) {
      for (const [id, s] of stilled) {
        const a = alive.get(id)
        if (!a) { stilled.delete(id); continue }
        if (!a.pose) continue
        if (!s.at) { s.at = [...a.pose.at]; s.rot = [...a.pose.rot]; continue }
        // Let fall to where it rests, then kept there: only a thing that has gone along the ground is put back.
        if (Math.hypot(a.pose.at[0] - s.at[0], a.pose.at[2] - s.at[2]) > 0.3) place(a, [s.at[0], a.pose.at[1], s.at[2]], s.rot)
      }
      // Nothing on wheels stays wedged: asked to go and making no way, it is set back where it last went freely.
      for (const [id, a] of alive) {
        if (!a.pose || !a.controls.motor.feet.length || stilled.has(id)) { going.delete(id); continue }
        const g = going.get(id) ?? going.set(id, { trail: [], at: null, since: now }).get(id), h = held.get(id)
        const asked = now - (a.ridden ?? -Infinity) < 700 ? a.asked ?? 0 : h && !h.course ? h.go : 0, up = turned(a.pose.rot, [0, 1, 0])[1]
        if (Math.abs(a.speed ?? 0) > FREELY && up > 0.8) { g.trail.push({ at: [...a.pose.at], rot: [...a.pose.rot], t: now }); while (g.trail.length > 1 && now - g.trail[1].t > 900) g.trail.shift() }
        if (Math.abs(asked) < 0.3 || !g.at || Math.hypot(a.pose.at[0] - g.at[0], a.pose.at[2] - g.at[2]) > NO_WAY) { g.at = [...a.pose.at]; g.since = now; continue }
        if (now - g.since < WEDGED) continue
        // Back where it was going freely the best part of a second before, lifted a little, level, facing as it faced; with nowhere remembered, lifted where it is and levelled.
        const back = g.trail[0], f = turned((back ?? a.pose).rot, FRONTS[a.controls.motor.front] ?? FRONTS[0]), half = Math.atan2(-f[2], f[0]) / 2
        place(a, back ? [back.at[0], back.at[1] + 3, back.at[2]] : [a.pose.at[0], a.pose.at[1] + 6, a.pose.at[2]], [0, Math.sin(half), 0, Math.cos(half)])
        g.at = null; g.since = now; g.trail = back ? [back] : []
      }
      // A change for a while that has run out: the thing's numbers go back.
      for (const [id, t] of tuned) {
        if (!alive.has(id)) { tuned.delete(id); continue }
        const still = t.timed.filter((c) => c.until > now)
        if (still.length !== t.timed.length) { t.timed = still; tune(id) }
      }
      if (!lines.size) { if (was.size) was.clear(); return }
      const seen = new Set()
      const look = (key, at, e) => {
        seen.add(key)
        const p = was.get(key), q = [at[0], at[2]]
        was.set(key, { at: q, t: now })
        if (!p || now - p.t > 1000) return
        for (const l of lines.values()) {
          const o = over(l, p.at, q)
          if (!o) continue
          const dt = (now - p.t) / 1000, x = p.at[0] + (q[0] - p.at[0]) * o.t, z = p.at[1] + (q[1] - p.at[1]) * o.t
          hear(l.rule, 'crossed', { line: l.id, ...e(l.rule), way: o.way, at: [Math.round(x), Math.round(at[1]), Math.round(z)], speed: Math.round(Math.hypot(q[0] - p.at[0], q[1] - p.at[1]) / Math.max(dt, 0.001)), when: Number(((p.t + (now - p.t) * o.t) / 1000).toFixed(2)) })
        }
      }
      for (const [id, a] of alive) if (a.pose) look(`t:${id}`, a.pose.at, (rule) => ({ thing: id, ...(made.get(id) === rule ? { own: id.slice(rule.length + 1) } : {}), ...(riders(id, rule).length ? { riders: riders(id, rule) } : {}) }))
      // People too, on foot: one who rides is told with what they ride.
      for (const p of folk.values()) if (p.rule !== '~' && !p.riding) look(`p:${p.by}`, p.at, (rule) => ({ who: idOf(p, rule), name: p.name }))
      for (const key of was.keys()) if (!seen.has(key)) was.delete(key)
    },
    /** A living thing broke: the rule that brought it hears, and it is the rule's no longer. */
    broke(id) { const rule = made.get(id); held.delete(id); stilled.delete(id); tuned.delete(id); if (rule) { made.delete(id); hear(rule, 'broke', { thing: id, own: id.slice(rule.length + 1) }) } },
    /** Whether a thing is held still: then nobody's hands move it. */
    held: (id) => stilled.has(id),
    /** `world.thing(id, {like, at, yaw, colour})`: brings one of the kept living things into the world; like: null takes it away. */
    thing(rule, w, now, wrong) {
      if (typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,15}$/.test(w.id)) return wrong('a thing a rule brings has an id of its own: lower-case letters, digits and dashes, up to 16')
      const id = `${rule.id}-${w.id}`.slice(0, 40)
      if (w.like === null) { if (made.get(id) === rule.id) { made.delete(id); held.delete(id); tuned.delete(id); stilled.delete(id); take(id) } return }
      // One it brought, given numbers: how much it takes and how it goes; null puts a number back as it was made.
      if (made.get(id) === rule.id && alive.has(id) && w.like === undefined) {
        const keys = {}, back = []
        for (const [key, [least, most]] of Object.entries(TUNE)) {
          if (w[key] === undefined) continue
          if (w[key] === null) { back.push(key); continue }
          if (typeof w[key] !== 'number' || !Number.isFinite(w[key]) || w[key] < least || w[key] > most) return wrong(`a thing's ${key} is a number from ${least} to ${most}`)
          keys[key] = w[key]
        }
        if (!Object.keys(keys).length && !back.length) return wrong(`what a rule sets on a thing it brought is one of ${Object.keys(TUNE).join(', ')} (and for: seconds, to have it go back by itself)`)
        if (w.for !== undefined && !(typeof w.for === 'number' && w.for > 0 && w.for <= FOR_MOST)) return wrong(`how long a change is for is seconds, up to ${FOR_MOST}`)
        const t = tuned.get(id) ?? tuned.set(id, { set: {}, timed: [] }).get(id)
        for (const key of back) { delete t.set[key]; for (const c of t.timed) delete c.keys[key] }
        if (w.for !== undefined) { if (t.timed.length >= 8) t.timed.shift(); t.timed.push({ keys, until: now + w.for * 1000 }) } else Object.assign(t.set, keys)
        return tune(id)
      }
      if (made.has(id) && !alive.has(id)) made.delete(id)
      if (made.has(id) || alive.has(id)) return wrong(`"${w.id}" is in the world already: take it away first (like: null), or drive it where it is to be`)
      if (typeof w.like !== 'string' || !Object.hasOwn(KEPT, w.like)) return wrong(`what a rule can bring is like one of: ${Object.keys(KEPT).join(', ')}`)
      if (!Array.isArray(w.at) || w.at.length < 2 || w.at.length > 3 || !w.at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)) return wrong('where it is set down is at: [x, z]')
      if (w.yaw !== undefined && !Number.isFinite(w.yaw)) return wrong('which way it faces is yaw, in radians (as world.things says it)')
      if ([...made.values()].filter((r) => r === rule.id).length >= MADE_MOST) return wrong(`a rule has at most ${MADE_MOST} living things of its own in the world at once`)
      let colour = 0
      for (const ch of w.id) colour = (colour * 31 + ch.charCodeAt(0)) % 24
      const kept = KEPT[w.like](Number.isInteger(w.colour) ? w.colour : colour)
      const x = Math.round(w.at[0]), z = Math.round(w.at[w.at.length - 1]), y = stand(x, z)
      if (y === null) return wrong('there is nowhere to stand it at that place')
      if (!bring({ id, rule: rule.id, thing: kept, low: [x - (kept.size[0] >> 1), y + 1, z - (kept.size[2] >> 1)], yaw: w.yaw })) return wrong('it could not be brought to life there')
      made.set(id, rule.id)
    },
    /** `world.seat(who, {on: thing})`: puts someone on a living thing (an actor of this rule, or someone at a page); on: null gets them off. */
    seat(rule, w, now, wrong) {
      const p = typeof w.id === 'string' ? folk.get(`${rule.id}/${w.id}`) ?? folk.get(w.id) : null
      if (!p || (p.rule && p.rule !== rule.id) || p.rule === '~') return wrong('world.seat is for one of this rule\'s actors or someone at a page: an id of world.people')
      if (w.on === null) { ride(p.by, null, rule.id, now); if (!p.rule) changed(); return }
      const on = find(rule.id, w.on)
      if (!on) return wrong('what someone is seated on is on: a living thing (an id of world.things), or null to get them off')
      if (seats.get(p.by)?.thing !== on && !room(on)) return wrong('there is no seat left on that')
      ride(p.by, on, rule.id, now)
      if (!p.rule) changed()
    },
    /** A page says it has got on a thing, or off. */
    rides(by, thing, on, now) { if (!on) { if (seats.get(by)?.thing === thing) { ride(by, null, undefined, now); changed() } } else ride(by, thing, undefined, now) },
    /** What someone rides, if they ride. */
    seatOf: (by) => seats.get(by)?.thing ?? null,
    /** Who a rule has seated on what, by person: for the pages of those at a page, which get them on. */
    seated: () => Object.fromEntries([...seats].filter(([by, s]) => s.rule && folk.get(by) && !folk.get(by).rule).map(([by, s]) => [by, s.thing])),
    /** Ten times a second: whoever rides is where their thing is, sitting, facing as it faces. */
    carry(now) {
      for (const [by, s] of seats) {
        const p = folk.get(by), a = alive.get(s.thing)
        if (!p || !a) { seats.delete(by); if (p) { p.riding = undefined; if (p.move?.seat) p.move = undefined; tell(p); happen('ride', { by: p.by, name: p.name, thing: s.thing, on: false }) } if (p && !p.rule && s.rule) changed(); continue }
        if (!a.pose) continue
        const f = turned(a.pose.rot, FRONTS[a.controls.motor.front] ?? FRONTS[0])
        // Their own seat, if the thing says where its seats are (from its low corner, in its own cells: its middle is taken for where its weight is); else its middle.
        const c = a.controls, seat = c.seats?.[s.n], off = seat && c.size ? turned(a.pose.rot, [seat[0] - c.size[0] / 2, seat[1] - c.size[1] / 2, seat[2] - c.size[2] / 2]) : [0, -3, 0]
        const at = [a.pose.at[0] + off[0], a.pose.at[1] + off[1], a.pose.at[2] + off[2]], yaw = Math.atan2(f[0], -f[2])
        const moved = Math.hypot(at[0] - p.at[0], at[1] - p.at[1], at[2] - p.at[2]) > 0.05 || Math.abs(yaw - p.yaw) > 0.01
        if (!p.move?.seat) p.move = { n: (p.move?.n ?? 0) + 1, since: now, name: 'sit', long: 0.5, stays: true, seat: true }
        else if (!moved) continue
        p.at = at; p.yaw = yaw; p.goal = null
        tell(p)
      }
    },
    /** A rule is taken out: what it drove is let go, and whoever it seated at a page gets off. */
    dropped(rule) {
      for (const [id, h] of held) if (h.rule === rule) { held.delete(id); const a = alive.get(id); if (a) drive(a, 0, 0, 0, false) }
      for (const [id, r] of [...made]) if (r === rule) { made.delete(id); tuned.delete(id); take(id) }
      for (const [id, s] of [...stilled]) if (s.rule === rule) stilled.delete(id)
      for (const [key, l] of [...lines]) if (l.rule === rule) lines.delete(key)
      let any = false
      for (const [by, s] of [...seats]) if (s.rule === rule) { ride(by, null, rule, Date.now()); any = true }
      if (any) changed()
    },
  }
}
