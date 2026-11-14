// The make plugin's check: a rule asks for a thing by words for someone at a page, and that person's page (and no
// other) is told to have it made; what a rule should not ask is left and said. The real server; no page and no
// model (test/helper.mjs has the page make it, with a kept reply). Two rules that are not alike and are no game:
// a stall-keeper who hands over what is asked for, and a gardener who plants a tree where told.
//
//   node plugins/make/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
const wanted = () => w.said.filter((m) => m.plugin === 'make' && 'once' in m).map((m) => m.once)
const here = (by, at) => w.post('here', { by, name: by, at, yaw: 0 })
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.make({wish, for, at, hold})') && guide.includes('own model'), 'the guide says what a rule may ask to be made, and whose model makes it')
  const g = (await w.get('at?x=700&y=0&z=4060')).ground
  // Two people at pages, and one in a seat.
  await here('ada', [700, g + 18, 4060]); await here('ben', [760, g + 18, 4060])
  await w.post('join', { by: 'seated', at: [720, 4012] })
  await w.rule('stall', `
on('start', (world) => world.actor('keeper', { name: 'Odile', at: [700, 4012] }))
on('said', (world, e) => {
  const m = /^one (.+), please$/i.exec(e.text)
  if (m) { world.make({ wish: m[1], for: e.by }); world.actor('keeper', { say: 'Coming up.' }) }
  if (/for the seat/.test(e.text)) world.make({ wish: 'a stool', for: 'seated' })
  if (/nothing/.test(e.text)) world.make({ for: e.by })
  if (/far away/.test(e.text)) world.make({ wish: 'a stool', for: e.by, at: [5000, 5000] })
  if (/run this/.test(e.text)) world.make({ wish: 'a stool', for: e.by, source: 'x' })
})`)
  await until('the stall runs', async () => (await w.how('stall'))?.running)
  const say = (by, text) => w.post('say', { by, name: by, text })
  await here('ada', [700, g + 18, 4060])
  await say('ada', 'one paper cup of tea, please')
  const first = await until('the page is told', () => wanted()[0])
  check(first.for === 'ada' && first.wish === 'paper cup of tea' && first.at === null && first.rule === 'stall', `asked for by a rule, a thing is wanted of the page of the one it is for: "${first.wish}" for ${first.for}, in front of them`)
  // What should not be asked.
  await here('ada', [700, g + 18, 4060])
  for (const text of ['one for the seat', 'nothing at all', 'somewhere far away', 'run this']) { await say('ada', text); await wait(250) }
  const how = await w.how('stall')
  check(wanted().length === 1 && /make/.test(how.error), `for someone in a seat, with no wish, 500 m away, or with a field of its own: nothing is wanted, and the rule is told (${how.error.slice(0, 70)})`)
  // A gardener: a tree where told, at a place.
  await w.rule('garden', `
on('said', (world, e) => { if (/plant a tree here/i.test(e.text)) world.make({ wish: 'a young apple tree', for: e.by, at: [e.at[0] + 20, e.at[2] - 30] }) })`)
  await until('the gardener runs', async () => (await w.how('garden'))?.running)
  await here('ben', [760, g + 18, 4060])
  await say('ben', 'plant a tree here')
  const tree = await until('the tree is wanted', () => wanted().find((x) => x.rule === 'garden'))
  check(tree.for === 'ben' && tree.wish === 'a young apple tree' && tree.at.length === 3 && tree.at[0] === 780 && tree.at[2] === 4030 && Math.abs(tree.at[1] - g) < 12, `a place given is the ground there: ${tree.at}`)
  // No more than so many a minute for one person.
  for (let i = 0; i < 8; i++) { await here('ben', [760, g + 18, 4060]); await say('ben', 'plant a tree here'); await wait(120) }
  await wait(300)
  check(wanted().filter((x) => x.for === 'ben').length === 6 && /a minute/.test((await w.how('garden')).error), 'six a minute for one person, and no more')
} catch (e) { check(false, `the check itself failed: ${e.stack ?? e}`) }
w.finish('make plugin')
