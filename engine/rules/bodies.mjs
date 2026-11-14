// What a body can do, and how fast the world goes (#264, the BODIES lane): for the world's process.
//
// A rule sets numbers for a person at a page (`world.person`): how fast they run, how high they jump, how high a
// wall they climb, how fast they fly, how much of the world's pull they feel. The page that moves that body takes
// them as its motor's numbers. "Walk up walls", "fly", "leap a street" are a rule setting numbers: nothing here or
// in the core knows those words. And a rule sets the world's clock (`world.clock`): everything the world moves goes
// that much slower or faster, and so does everyone in it but those the rule spares.
//
// And a rule gives that person's figure a look and a move (`world.person(id, {look, move, aim})`), by the same
// words as it gives its actors (the people lane's moves and looks, as data): everyone sees it by the same telling
// as any body's, and the person's own page, which draws its own figure, is told with the numbers.
//
// What a rule set goes back to how it was when the rule is taken out.

/** What a body can do, each a least and a most: cells and seconds. */
export const CAN = { pace: [0, 400], jump: [0, 300], climb: [0, 100000], fly: [0, 400], fall: [0, 3] }
/** The slowest and the fastest the world's clock goes, and the most people a rule may spare from it. */
const SLOWEST = 0.05, FASTEST = 4, SPARED_MOST = 64

/**
 * @param folk  everyone with a body, by the name the world knows them by: {by, rule?, seat}
 * @param tell  says something to the server (the bodies' numbers and the clock as they stand, for pages)
 * @param limbs  takes a look, a move and an aim for a body as a rule gave them (the world's own, as for an actor)
 * @param shown  says a body again to every page, as it now is
 * @param seated  who a rule has seated on what living thing, by person at a page (rules/things.mjs)
 */
export function bodies({ folk, tell, limbs, shown, seated = () => ({}) }) {
  /** By person: the rule that set them and the numbers it set. */
  const can = new Map()
  /** By person: the rule that gave their figure a look or a move. */
  const shaped = new Map()
  /** A figure as its own page is told it: the move whole (its keys with it), for this is said only when it changes. */
  const figure = (p) => ({ ...(p.look ? { look: p.look } : {}), ...(p.move ? { move: { n: p.move.n, ...(p.move.name ? { name: p.move.name } : { keys: p.move.data }), ...(p.move.aim ? { aim: p.move.aim } : {}) } } : {}) })
  let clock = { rate: 1, spare: [], rule: null }
  const said = () => {
    for (const by of can.keys()) if (!folk.has(by)) can.delete(by)
    for (const by of shaped.keys()) if (!folk.has(by)) shaped.delete(by)
    tell({ bodies: { clock: { rate: clock.rate, spare: clock.spare }, can: Object.fromEntries([...can].map(([by, c]) => [by, c.numbers])), figure: Object.fromEntries([...shaped.keys()].map((by) => [by, figure(folk.get(by))])), seat: seated() } })
  }
  return {
    /** Says the bodies' numbers again: something that goes with them has changed (who a rule has seated). */
    say: () => said(),
    /** How fast the world goes now. */
    get rate() { return clock.rate },
    /** `world.person(id, {pace, jump, climb, fly, fall, down, cling, look, move, aim})`: only the fields given change; null puts one back as it was. */
    person(rule, w, now, wrong) {
      const p = typeof w.id === 'string' ? folk.get(w.id) : null
      if (!p || p.rule || p.seat) return wrong('world.person is for someone at a page: an id of world.people whose kind is "page"')
      const numbers = { ...(can.get(p.by)?.numbers ?? {}) }
      for (const [key, [least, most]] of Object.entries(CAN)) {
        if (w[key] === undefined) continue
        if (w[key] === null) { delete numbers[key]; continue }
        if (typeof w[key] !== 'number' || !Number.isFinite(w[key]) || w[key] < least || w[key] > most) return wrong(`a person's ${key} is a number from ${least} to ${most}`)
        numbers[key] = w[key]
      }
      // Which way is down for them: a way in the world's axes (it need not be a unit), or null for the world's own.
      if (w.down === null) delete numbers.down
      else if (w.down !== undefined) {
        if (!Array.isArray(w.down) || w.down.length !== 3 || !w.down.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000) || !w.down.some((v) => v !== 0)) return wrong("a person's down is a way: [dx, dy, dz] (the world's own is [0, -1, 0]), or null to put it back")
        numbers.down = [...w.down]
      }
      // Whether they cling: their down turns to whatever face they walk onto.
      if (w.cling === null || w.cling === false) delete numbers.cling
      else if (w.cling !== undefined) {
        if (w.cling !== true) return wrong("a person's cling is true or false")
        numbers.cling = true
      }
      if (Object.keys(numbers).length) can.set(p.by, { rule: rule.id, numbers }); else can.delete(p.by)
      // Their figure: what it looks like and what it does with its limbs, as an actor's (null puts either back).
      if (w.look !== undefined || w.move !== undefined || w.aim !== undefined) {
        limbs(rule, p, w, now, wrong)
        if (p.look || p.move) shaped.set(p.by, rule.id); else shaped.delete(p.by)
        shown(p)
      }
      said()
    },
    /** `world.clock({rate, spare})`: how fast the world goes (1 as it does), and who is spared the change. */
    clock(rule, w, now, wrong) {
      if (typeof w.rate !== 'number' || !Number.isFinite(w.rate) || w.rate < SLOWEST || w.rate > FASTEST) return wrong(`the clock's rate is a number from ${SLOWEST} to ${FASTEST}: 1 is how the world goes by itself`)
      const spare = w.spare ?? []
      if (!Array.isArray(spare) || spare.length > SPARED_MOST || !spare.every((id) => typeof id === 'string' && id.length <= 64)) return wrong(`who the clock spares is a list of at most ${SPARED_MOST} ids of world.people`)
      clock = { rate: w.rate, spare: [...spare], rule: w.rate === 1 ? null : rule.id }
      said()
    },
    /** A rule is taken out: what it set goes back. */
    dropped(id) {
      let changed = false
      for (const [by, c] of can) if (c.rule === id) { can.delete(by); changed = true }
      for (const [by, theirs] of shaped) if (theirs === id) { const p = folk.get(by); if (p) { p.look = undefined; p.move = undefined; shown(p) } shaped.delete(by); changed = true }
      if (clock.rule === id) { clock = { rate: 1, spare: [], rule: null }; changed = true }
      if (changed) said()
    },
  }
}
