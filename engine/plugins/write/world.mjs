// A rule asked for from a rule (#264, the MAKER lane: the director's "change the realm's own rules", the first
// thing the first written director said it could not do). `world.write({ask, for, rule})`: a rule says in words how
// another rule of its world should change, or what new one there should be, for someone who is there. The world
// never runs a model and never runs what a rule hands it: the words are told to that person's own page, which asks
// their own helper as if they had typed them into the bar (the same writer, the same trial in a world of its own,
// put in only if it runs). So what is written is written by the model of the one it is for, on their machine, and
// is a rule like any other: a rule cannot have text of its own run, and cannot spend anyone's model but theirs.
//
// Every field is a stranger's: what is wrong is left and said to the rule.
const FIELDS = ['do', 'id', 'ask', 'for', 'rule']
const RULE = /^[a-z0-9][a-z0-9-]{0,23}$/
/** Rules the world itself knows by id (the engine's talk, a realm's director): a rule does not have them rewritten. */
const KEPT = ['talk', 'director']
/** How often one person's page is asked to write, and one rule may ask, in ms: writing takes minutes of someone's model. */
const APART = 5 * 60_000

export default ({ folk, text, pages }) => {
  /** When each person was last asked to write, and when each rule last asked. */
  const person = new Map(), asker = new Map()
  return {
    does: {
      write(rule, w, now, wrong) {
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return wrong(`write has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
        const ask = text(w.ask, 600)
        if (!ask) return wrong('write needs an ask: what should change or be added, in words, up to 600 characters')
        const p = typeof w.for === 'string' ? folk.get(w.for) : undefined
        if (!p || p.rule || p.seat) return wrong('write is for someone at a page: for is their id in world.people (kind "page"). It is written by the model of the one it is for')
        if (w.rule !== undefined && (typeof w.rule !== 'string' || !RULE.test(w.rule))) return wrong('rule is the id of the rule to change (world.others does not say: it is in GET /world/rules); left out, the world\'s own rule if it has one, else a new one')
        if (w.rule === rule.id) return wrong('a rule does not ask for itself to be rewritten: change another, or leave rule out')
        if (KEPT.includes(w.rule)) return wrong(`"${w.rule}" is not a rule's to have rewritten: the people who answer and the director are changed by a person asking`)
        if (now - (person.get(p.by) ?? -Infinity) < APART || now - (asker.get(rule.id) ?? -Infinity) < APART) return wrong(`something is written at most once in ${APART / 60_000} minutes for one person, and by one rule: it takes minutes of their model`)
        person.set(p.by, now); asker.set(rule.id, now)
        pages.once({ for: p.by, ask, by: rule.id, ...(w.rule ? { rule: w.rule } : {}) })
      },
    },
  }
}
