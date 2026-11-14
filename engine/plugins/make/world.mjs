// A thing made from a rule (#264, the making lane #244; asked for by "conjure any weapon", a hot dog handed over,
// item boxes that can be seen). `world.make({wish, for, at})`: a rule asks for a thing by words, for someone who is
// there. The world never runs a model, and neither does this: the wish is told to that person's own page, which
// asks their own helper for it as if they had typed it (the same checks, the same wait covered at the place, and a
// thing made before is made at once from what their helper kept). So a thing is only ever made for the person it
// is for, on their own machine, by their own model: a rule cannot spend anyone else's.
//
// Every field is a stranger's: what is wrong is left and said to the rule.
const FIELDS = ['do', 'id', 'wish', 'for', 'at']
/** How far from the one it is for a thing may be asked for, in cells; and how many one person's page is asked for in a minute. */
const REACH = 300, A_MINUTE = 6

export default ({ folk, text, stand, pages }) => {
  /** By person: when each of the last things asked for them was asked. */
  const asked = new Map()
  return {
    does: {
      make(rule, w, now, wrong) {
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return wrong(`make has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
        const wish = text(w.wish, 200)
        if (!wish) return wrong('make needs a wish: what the thing is, in words, up to 200 characters')
        const p = typeof w.for === 'string' ? folk.get(w.for) : undefined
        if (!p || p.rule || p.seat) return wrong('make is for someone at a page: for is their id in world.people (kind "page"). A thing is made by the model of the one it is for')
        let at = null
        if (w.at !== undefined) {
          if (!Array.isArray(w.at) || (w.at.length !== 2 && w.at.length !== 3) || !w.at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)) return wrong('at is [x, z] or [x, y, z]; left out, the thing is made in front of the one it is for')
          const x = Math.round(w.at[0]), z = Math.round(w.at[w.at.length - 1])
          if (Math.hypot(x - p.at[0], z - p.at[2]) > REACH) return wrong(`at is within ${REACH} cells of the one the thing is for`)
          const feet = stand(x, z)
          if (feet === null) return wrong(`there is no ground to make a thing on at ${x}, ${z}`)
          at = [x, feet, z]
        }
        const times = (asked.get(p.by) ?? []).filter((t) => now - t < 60_000)
        if (times.length >= A_MINUTE) return wrong(`at most ${A_MINUTE} things a minute are asked for one person`)
        asked.set(p.by, [...times, now])
        pages.once({ for: p.by, wish, at, rule: rule.id })
      },
    },
  }
}
