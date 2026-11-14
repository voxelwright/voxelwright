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
// Other racers, a landing craft, a getaway car are a rule driving living things: nothing here knows those words.

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
 */
export function things({ alive, folk, drive, tell, happen, stand, changed }) {
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
        if (p.move?.seat) p.move = undefined
        if (a?.pose && (p.rule || p.seat)) { const x = a.pose.at[0] + 14, z = a.pose.at[2]; p.at = [x, stand(Math.round(x), Math.round(z)) ?? a.pose.at[1], z] }
        tell(p)
        happen('ride', { by: p.by, name: p.name, thing: was.thing, on: false })
      }
    }
    if (thing && p && alive.has(thing) && seats.get(by)?.thing !== thing) {
      seats.set(by, { thing, rule })
      happen('ride', { by: p.by, name: p.name, thing, on: true })
    }
  }
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
        out.push({ id, name: a.name || '', scheme: a.controls.scheme, at: a.pose.at.map(Math.round), yaw: Number(Math.atan2(f[0], -f[2]).toFixed(2)), speed: Math.round(a.speed ?? 0), awake: !!a.awake, upright: up[1] > 0.5, ...(mine ? { mine: true } : held.has(id) ? { driven: true } : {}), ...(riders(id, rule).length ? { riders: riders(id, rule) } : {}), near: Number.isFinite(far) ? Math.round(far) : null })
      }
      return out.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (a.near ?? Infinity) - (b.near ?? Infinity)).slice(0, TOLD_MOST)
    },
    /** `world.drive(id, {go, turn, rise, jump})`: what a living thing is to do, until told otherwise; {free: true} lets it go. */
    drive(rule, w, now, wrong) {
      const a = typeof w.id === 'string' ? alive.get(w.id) : null
      if (!a) return wrong('world.drive is for a living thing: an id of world.things')
      const was = held.get(w.id)
      if (was && was.rule !== rule.id) return wrong('that living thing is another rule\'s to drive')
      if (w.free === true) { if (was) { held.delete(w.id); drive(a, 0, 0, 0, false) } return }
      if (!was && [...held.values()].filter((h) => h.rule === rule.id).length >= DRIVEN_MOST) return wrong(`a rule drives at most ${DRIVEN_MOST} living things at once`)
      const h = { rule: rule.id, go: axis(w.go ?? was?.go), turn: axis(w.turn ?? was?.turn), rise: axis(w.rise ?? was?.rise), jump: w.jump === true, said: 0 }
      held.set(w.id, h)
    },
    /** Four times a second: what each rule asked of its things is said to the core again, as a rider's hands would. */
    step(now) {
      let any = false
      for (const [id, h] of held) {
        const a = alive.get(id)
        if (!a) { held.delete(id); continue }
        if (now - h.said < 250 || now - (a.ridden ?? -Infinity) < 1000) continue
        h.said = now
        // One that sleeps and is asked nothing is left asleep.
        if (!h.go && !h.turn && !h.rise && !h.jump && !a.awake) continue
        drive(a, h.go, h.turn, h.rise, h.jump)
        h.jump = false
        any = true
      }
      return any
    },
    /** `world.seat(who, {on: thing})`: puts someone on a living thing (an actor of this rule, or someone at a page); on: null gets them off. */
    seat(rule, w, now, wrong) {
      const p = typeof w.id === 'string' ? folk.get(`${rule.id}/${w.id}`) ?? folk.get(w.id) : null
      if (!p || (p.rule && p.rule !== rule.id) || p.rule === '~') return wrong('world.seat is for one of this rule\'s actors or someone at a page: an id of world.people')
      if (w.on === null) { ride(p.by, null, rule.id, now); if (!p.rule) changed(); return }
      if (typeof w.on !== 'string' || !alive.has(w.on)) return wrong('what someone is seated on is on: a living thing (an id of world.things), or null to get them off')
      ride(p.by, w.on, rule.id, now)
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
        if (!p || !a) { seats.delete(by); if (p) { if (p.move?.seat) p.move = undefined; tell(p); happen('ride', { by: p.by, name: p.name, thing: s.thing, on: false }) } if (p && !p.rule && s.rule) changed(); continue }
        if (!a.pose) continue
        const f = turned(a.pose.rot, FRONTS[a.controls.motor.front] ?? FRONTS[0])
        const at = [a.pose.at[0], a.pose.at[1] - 3, a.pose.at[2]], yaw = Math.atan2(f[0], -f[2])
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
      let any = false
      for (const [by, s] of [...seats]) if (s.rule === rule) { ride(by, null, rule, Date.now()); any = true }
      if (any) changed()
    },
  }
}
