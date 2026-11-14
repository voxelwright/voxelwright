// The ask plugin's check: one rule is a library for another (a clerk who keeps a tally for whoever asks), both in
// their boxes. How long an ask and its answer take is measured by the asker's own clock.
//
//   node plugins/ask/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.ask(id, {of, ...})') && guide.includes("on('asked'"), 'a model writing rules is shown world.ask and what the other rule hears')
  await w.post('join', { by: 'wren', at: [700, 4060] })
  // The library: it keeps a tally a name, and says it aloud through its own actor. It moves nobody else's.
  await w.rule('clerk', `
on('start', (world) => world.actor('clerk', { name: 'Bram', at: [704, 4009] }))
on('asked', (world, e) => {
  if (typeof e.name !== 'string' || !Number.isFinite(e.add)) return world.answer(e.ask, { to: e.by, error: 'a tally is {name, add}' })
  world.keep[e.name] = (world.keep[e.name] || 0) + e.add
  world.answer(e.ask, { to: e.by, name: e.name.slice(0, 20), total: world.keep[e.name], sent: e.sent })
})`)
  await w.rule('game', `
on('start', (world) => world.actor('host', { name: 'Odile', at: [696, 4009] }))
on('said', (world, e) => {
  if (/point/.test(e.text)) world.ask('p', { of: 'clerk', name: e.name, add: 1, sent: world.now })
  if (/nonsense/.test(e.text)) world.ask('n', { of: 'clerk', add: 'lots' })
  if (/myself/.test(e.text)) world.ask('m', { of: 'game' })
  if (/flood/.test(e.text)) for (let i = 0; i < 40; i++) world.ask('f', { of: 'clerk', name: 'x', add: 1 })
})
on('answered', (world, e) => { if (e.ask !== 'f') world.actor('host', { say: e.error ? 'The clerk says: ' + e.error : e.name + ' has ' + e.total + ' (' + Math.round((world.now - e.sent) * 1000) + ' ms)' }) })`)
  await until('both run', async () => (await w.how('game'))?.actors === 1 && (await w.how('clerk'))?.actors === 1)
  const heard = (re) => until(`heard ${re}`, async () => (await w.get('around?by=wren')).heard.find((h) => re.test(h.text)))
  await w.post('say', { by: 'wren', text: 'a point for me' })
  await heard(/wren has 1 /)
  await w.post('say', { by: 'wren', text: 'another point' })
  const two = await heard(/wren has 2 \((\d+) ms\)/)
  check(true, `one rule keeps a tally for another, each in its box: "${two.text}" (the ask and its answer, by the asker's clock)`)
  await w.post('say', { by: 'wren', text: 'nonsense' })
  check(!!(await heard(/The clerk says: a tally is/)), 'what the library is sent is data it checks: nonsense is answered in words')
  for (const [say, why] of [['myself', /another rule of this world/], ['flood', /at most 32 times a second/]]) {
    if (say === 'flood') await wait(1100)
    await w.post('say', { by: 'wren', text: say })
    const how = await until(`refused: ${say}`, async () => { const r = await w.how('game'); return why.test(r.error) && r })
    check(how.running, `"${say}" is refused in words and the rule goes on: ${how.error.slice(0, 60)}`)
  }
  const clerk = await w.how('clerk')
  check(clerk.running && clerk.ms < 5, `the library ran ${clerk.calls} calls at ${clerk.ms} ms each, inside a rule's budget`)
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin ask')
