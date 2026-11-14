// Living things, as a rule has them (#264, the BODIES lane): for the world's process.
//
// A rule is told the living things near people (`world.things`: each by the id of its record, which stays, what
// it is, where, which way it faces, how fast it goes) and drives one as a rider does (`world.drive`): how hard
// forward or back, which way it turns, up or down, a jump. What a rule asks is held until it asks otherwise or is
// taken out, for a rule is told the time only twice a second and a rider's word lasts one. Someone riding it from
// a page has it while they ride: their hands are on it, the rule's word waits.
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
 */
export function things({ alive, folk, drive }) {
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
        out.push({ id, name: a.name || '', scheme: a.controls.scheme, at: a.pose.at.map(Math.round), yaw: Number(Math.atan2(f[0], -f[2]).toFixed(2)), speed: Math.round(a.speed ?? 0), awake: !!a.awake, upright: up[1] > 0.5, ...(mine ? { mine: true } : held.has(id) ? { driven: true } : {}), ...(a.riders?.length ? { riders: a.riders.map((r) => r.id) } : {}), near: Number.isFinite(far) ? Math.round(far) : null })
      }
      return out.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (a.near ?? Infinity) - (b.near ?? Infinity)).slice(0, TOLD_MOST)
    },
    /** `world.drive(id, {go, turn, rise, jump})`: what a living thing is to do, until told otherwise; null lets it go. */
    drive(rule, w, now, wrong) {
      const a = typeof w.id === 'string' ? alive.get(w.id) : null
      if (!a) return wrong('world.drive is for a living thing: an id of world.things')
      const was = held.get(w.id)
      if (was && was.rule !== rule.id) return wrong('that living thing is another rule\'s to drive')
      if (w.go === null || w.let === true) { if (was) { held.delete(w.id); drive(a, 0, 0, 0, false) } return }
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
    /** A rule is taken out: what it drove is let go. */
    dropped(rule) { for (const [id, h] of held) if (h.rule === rule) { held.delete(id); const a = alive.get(id); if (a) drive(a, 0, 0, 0, false) } },
  }
}
