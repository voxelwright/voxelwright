// The gone plugin's check: an actor a rule sends away is no longer there, and nobody else's body can be sent away.
// (That a taken resident walks back to its round is checked with pages, in test/taken.mjs.)
//
//   node plugins/gone/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
try {
  check(guideFor(await (await fetch(`${w.url}/world/`)).text()).includes('world.gone(id)   the actor leaves'), 'a model writing rules is shown world.gone')
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('door', `
on('start', (world) => world.actor('caller', { name: 'Odile', at: [700, 4009] }))
on('said', (world, e) => { if (/goodbye/.test(e.text)) world.gone('caller'); if (/begone/.test(e.text)) world.gone(e.by) })`)
  const there = async (name) => (await w.get('around?by=wren&within=1200')).people.some((p) => p.name === name)
  await until('the actor is there', () => there('Odile'))
  await w.post('join', { by: 'finch', at: [720, 4060] })
  await w.post('say', { by: 'finch', text: 'begone' })
  await w.post('say', { by: 'wren', text: 'goodbye' })
  await until('the actor has left', async () => !(await there('Odile')))
  const how = await w.how('door')
  check(how.actors === 0 && how.error === '' && await there('finch'), 'sent away, the rule\'s actor is no longer there; someone who is not its actor stays')
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin gone')
