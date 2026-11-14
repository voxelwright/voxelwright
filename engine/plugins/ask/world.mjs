// One rule asks another (#264, the workshop's experiment: can something new for rules be made of a rule, so that it
// loads from anyone as a rule does?). `world.ask(id, {of, ...})` is heard by the rule `of` as `asked`; that rule
// does what it does with its own doors and may `world.answer(id, {to, ...})`, heard by the asker as `answered`.
// Both are rules in their boxes: nothing here runs anyone's text, and what passes between them is data, checked
// for size. So a rule can be a library for other rules (a referee, a way round a house worked out with looks, a
// scoreboard): with a rule's budget and a rule's doors, and no more.
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/
/** The most one rule may ask and answer a second, and how big what it sends may be (JSON characters). */
const A_SECOND = 32, MOST = 4000

export default ({ hear }) => {
  const sent = new Map()
  const pass = (event, key) => (rule, w, now, wrong) => {
    const { do: _, id, [key]: other, ...rest } = w
    if (typeof id !== 'string' || !ID.test(id)) return wrong(`an ${event === 'asked' ? 'ask' : 'answer'} has an id of the rule's own: lower-case letters, digits and dashes, up to 24`)
    if (typeof other !== 'string' || !ID.test(other) || other === rule.id) return wrong(`${key} is the id of another rule of this world`)
    let json
    try { json = JSON.stringify(rest) } catch { json = null }
    if (json === null || json.length > MOST) return wrong(`what is sent to another rule is data, at most ${MOST} characters as JSON`)
    const count = sent.get(rule.id)
    if (!count || now - count.since > 1000) sent.set(rule.id, { since: now, n: 1 })
    else if (++count.n > A_SECOND) return wrong(`a rule asks and answers other rules at most ${A_SECOND} times a second`)
    hear(other, event, { ask: id, by: rule.id, ...JSON.parse(json) })
  }
  return { does: { ask: pass('asked', 'of'), answer: pass('answered', 'to') }, dropped: (ruleId) => { sent.delete(ruleId) } }
}
