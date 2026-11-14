// The matter plugin's check: a rule sets what a material weighs, the core of the world's process is told, what is
// wrong is refused in words. (What a weight does to a fall is the core's own test: kinds.rs, bodies.rs.)
//
//   node plugins/matter/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
try {
  check(guideFor(await (await fetch(`${w.url}/world/`)).text()).includes('world.matter({of, weighs})'), 'a model writing rules is shown world.matter')
  const plugin = (await w.send('/plugins')).plugins.find((p) => p.name === 'matter')
  check(plugin && !plugin.error && plugin.does.includes('matter'), `the core this server runs has the table to set${plugin?.error ? `: ${plugin.error}` : ''}`)
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('moon', `
on('start', (world) => { world.actor('keeper', { name: 'Odile', at: [700, 4009] }); world.matter({ of: 'steel', weighs: 0.5 }) })
on('said', (world, e) => {
  if (/feathers/.test(e.text)) world.matter({ of: 'feathers', weighs: 1 })
  if (/heavy/.test(e.text)) world.matter({ of: 'wood', weighs: 900 })
  if (/back/.test(e.text)) world.matter({ of: 'steel', weighs: null })
  world.actor('keeper', { say: 'done ' + e.text })
})`)
  await until('the rule runs', async () => (await w.how('moon'))?.actors === 1)
  check((await w.how('moon')).error === '', 'a rule sets what steel weighs as it starts, with nothing wrong')
  for (const [say, why] of [['feathers', /what matter is of is one of/], ['heavy', /0\.05 to 50/]]) {
    await w.post('say', { by: 'wren', text: say })
    const how = await until(`refused: ${say}`, async () => { const r = await w.how('moon'); return why.test(r.error) && r })
    check(how.running, `"${say}" is refused in words and the rule goes on: ${how.error.slice(0, 60)}`)
  }
  await w.post('say', { by: 'wren', text: 'put it back' })
  await until('it is put back', async () => (await w.get('around?by=wren')).heard.some((h) => h.text === 'done put it back'))
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin matter')
