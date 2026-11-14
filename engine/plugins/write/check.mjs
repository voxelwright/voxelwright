// The write plugin's check: a rule asks in words for a rule of its world to be changed or added, for someone at a
// page, and that person's page (and no other) is told; what a rule should not ask is left and said. The real
// server; no page and no model (test/helper.mjs has a page ask its helper, with a kept reply). Two rules that are
// not alike and are no game: a caretaker who has the market's rule changed when asked, and a herald who asks for a
// new rule.
//
//   node plugins/write/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
const wanted = () => w.said.filter((m) => m.plugin === 'write' && 'once' in m).map((m) => m.once)
const here = (by, at) => w.post('here', { by, name: by, at, yaw: 0 })
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.write({ask, for, rule})') && guide.includes('own model') && guide.includes('tried in a world of its own'), 'the guide says what a rule may ask to have written, whose model writes it, and that it is tried')
  const g = (await w.get('at?x=700&y=0&z=4060')).ground
  await here('ada', [700, g + 18, 4060]); await here('ben', [760, g + 18, 4060])
  await w.post('join', { by: 'seated', at: [720, 4012] })
  await w.rule('caretaker', `
on('said', (world, e) => {
  if (/more stalls/i.test(e.text)) world.write({ ask: 'the market has twice as many stalls, and their keepers call out to whoever passes', for: e.by, rule: 'market' })
  if (/for the seat/.test(e.text)) world.write({ ask: 'x', for: 'seated' })
  if (/nothing/.test(e.text)) world.write({ for: e.by })
  if (/myself/.test(e.text)) world.write({ ask: 'be cleverer', for: e.by, rule: 'caretaker' })
  if (/the director/.test(e.text)) world.write({ ask: 'be kinder', for: e.by, rule: 'director' })
  if (/run this/.test(e.text)) world.write({ ask: 'x', for: e.by, source: 'on("tick", () => {})' })
})`)
  await until('the caretaker runs', async () => (await w.how('caretaker'))?.running)
  const say = (by, text) => w.post('say', { by, name: by, text })
  // What should not be asked, first: none of it uses up the one ask in five minutes.
  for (const text of ['one for the seat', 'nothing at all', 'rewrite myself', 'change the director', 'run this']) { await here('ada', [700, g + 18, 4060]); await say('ada', text); await wait(250) }
  const how = await w.how('caretaker')
  check(wanted().length === 0 && /write|rule/.test(how.error), `for someone in a seat, with no ask, for itself, for the director, or with text of its own to run: nothing is asked of any page, and the rule is told (${how.error.slice(0, 80)})`)
  await here('ada', [700, g + 18, 4060])
  await say('ada', 'we need more stalls')
  const first = await until('the page is told', () => wanted()[0])
  check(first.for === 'ada' && first.rule === 'market' && first.by === 'caretaker' && first.ask.startsWith('the market has twice as many stalls'), `asked for by a rule, a change to a rule is asked of the page of the one it is for: "${first.ask.slice(0, 40)}..." for ${first.for}, to ${first.rule}`)
  // Once in five minutes for one person and for one rule.
  await here('ada', [700, g + 18, 4060]); await say('ada', 'more stalls again'); await wait(300)
  await here('ben', [760, g + 18, 4060]); await say('ben', 'more stalls for me too'); await wait(300)
  check(wanted().length === 1 && /5 minutes/.test((await w.how('caretaker')).error), 'asked again at once, for the same person or by the same rule for another: left, and the rule is told how often')
  // A herald: a new rule, for someone else.
  await w.rule('herald', `
on('said', (world, e) => { if (/a festival/i.test(e.text)) world.write({ ask: 'a festival begins at dusk: lanterns along the street and a band by the fountain', for: e.by }) })`)
  await until('the herald runs', async () => (await w.how('herald'))?.running)
  await here('ben', [760, g + 18, 4060])
  await say('ben', 'let there be a festival')
  const fest = await until('the festival is asked for', () => wanted().find((x) => x.by === 'herald'))
  check(fest.for === 'ben' && fest.rule === undefined, 'with no rule named, the page is asked with none: its helper changes the world\'s own rule if it has just one, else writes a new one')
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
w.finish('write plugin')
