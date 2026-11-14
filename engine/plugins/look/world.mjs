// A look from a rule (#264; asked for by a beach landing, a kart race and a chase: "a rule cannot ask where things
// are: cover, parked cars, corners"). `world.look(id, {from, to})` asks what the world's own cells put between two
// places; `world.look(id, {from, round: true})` asks what is met the eight ways round. The rule that asked hears
// `seen` with the answer, on its next call. A look meets cells, not people: world.people says where people are.
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
/** The most looks a rule may ask for a second (a look round is eight): each walks up to 800 cells of the world. */
const LOOKS_A_SECOND = 32, EYES = 16
const place = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)

export default ({ folk, look, hear }) => {
  /** By rule: when its second began and how many looks it has had in it. */
  const looked = new Map()
  /** Where a look is from or to: a place, or the eyes of one of the rule's actors or of someone the world knows by that id. */
  const eyes = (rule, v) => {
    if (place(v)) return v.map((n) => Math.round(n) + 0.5)
    const p = typeof v === 'string' ? folk.get(`${rule.id}/${v}`) ?? folk.get(v) : undefined
    return p ? [Math.round(p.at[0]) + 0.5, p.at[1] + EYES + 0.5, Math.round(p.at[2]) + 0.5] : null
  }
  return {
    does: {
      look(rule, w, now, wrong) {
        if (typeof w.id !== 'string' || !ID.test(w.id)) return wrong('a look has an id of the rule\'s own, to know its answer by: lower-case letters, digits and dashes, up to 24')
        const from = eyes(rule, w.from)
        if (!from) return wrong(`look "${w.id}" is from: [x, y, z], or the id of an actor of this rule or of someone in world.people (their eyes)`)
        const cost = w.round === true ? 8 : 1, count = looked.get(rule.id)
        if (!count || now - count.since > 1000) looked.set(rule.id, { since: now, n: cost })
        else if ((count.n += cost) > LOOKS_A_SECOND) return wrong(`a rule looks at most ${LOOKS_A_SECOND} times a second (a look round is eight)`)
        const at = from.map(Math.floor)
        if (w.round === true) {
          const round = COMPASS.map((to, k) => { const a = k * Math.PI / 4, met = look(from, [Math.sin(a), 0, -Math.cos(a)]); return { to, far: met.far, material: met.at ? MATERIALS[met.kind & 15] : null } })
          return hear(rule.id, 'seen', { look: w.id, from: at, round })
        }
        const to = eyes(rule, w.to)
        if (!to) return wrong(`look "${w.id}" is to: [x, y, z] or an id as for from; or round: true for the eight ways round`)
        const way = to.map((v, a) => v - from[a]), long = Math.hypot(...way)
        if (!(long > 0)) return wrong(`look "${w.id}" is from and to the same place`)
        const met = look(from, way), clear = !met.at || met.far >= long - 1
        hear(rule.id, 'seen', { look: w.id, from: at, to: to.map(Math.floor), clear, far: Math.round(Math.min(met.far, long)), ...(clear ? {} : { at: met.at, material: MATERIALS[met.kind & 15] }) })
      },
    },
    dropped: (ruleId) => { looked.delete(ruleId) },
  }
}
