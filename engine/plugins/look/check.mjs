// The look plugin's check: a rule that is no game (a watchman who says whether he can see whoever speaks, and what
// is round him) looks at the world, and hears what its cells put in the way. The real server; no page.
//
//   node plugins/look/check.mjs
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.look(id, {from, to})') && guide.includes("on('seen'"), 'a model writing rules is shown world.look and what it hears (the guide, as make/rules.mjs cuts it)')
  // The watchman stands on the north pavement; the houses' walls are just north of him (z 3995).
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('watch', `
on('start', (world) => world.actor('watchman', { name: 'Bram', at: [700, 4010] }))
on('said', (world, e) => {
  if (/see me/.test(e.text)) world.look('them', { from: 'watchman', to: e.by })
  if (/behind/.test(e.text)) world.look('wall', { from: 'watchman', to: [700, 175, 3900] })
  if (/round/.test(e.text)) world.look('round', { from: 'watchman', round: true })
  if (/nobody/.test(e.text)) world.look('x', { from: 'nobody-here', to: e.by })
  if (/flood/.test(e.text)) for (let i = 0; i < 6; i++) world.look('f' + i, { from: 'watchman', round: true })
})
on('seen', (world, e) => {
  if (e.look === 'wall') world.actor('watchman', { say: 'wall ' + JSON.stringify([e.clear, e.material, e.far, e.at[2]]) })
  if (e.look === 'round') world.actor('watchman', { say: 'round ' + JSON.stringify(e.round.map((r) => [r.to.split('-').map((p) => p[0]).join(''), r.far, r.material])) })
  if (e.look === 'them') world.actor('watchman', { say: e.clear ? 'I see you, ' + e.far + ' cells off.' : 'Something is in the way.' })
})`)
  await until('the rule runs', async () => (await w.how('watch'))?.actors === 1)
  // What the rule heard, it says: the check reads it as anyone standing there would.
  const told = (word) => until(`the watchman says ${word}`, async () => { const h = (await w.get('around?by=wren')).heard.find((h) => h.text.startsWith(`${word} `)); return h && JSON.parse(h.text.slice(word.length + 1)) })
  await w.post('say', { by: 'wren', text: 'can you see me?' })
  const said = await until('the watchman answers', async () => (await w.get('around?by=wren')).heard.find((h) => /I see you/.test(h.text)))
  check(/I see you, (4\d|5\d) cells off/.test(said.text), `across an open street the look is clear, and the rule hears how far: "${said.text}"`)
  await w.post('say', { by: 'wren', text: 'what is behind you' })
  const [clear, material, far, z] = await told('wall')
  check(clear === false && z < 4010 && z > 3980 && typeof material === 'string' && far < 30, `a look north meets the houses' wall: ${material} ${far} cells off at z ${z}`)
  await w.post('say', { by: 'wren', text: 'look round' })
  const round = await told('round')
  check(round.length === 8 && round[0][0] === 'n' && round[1][0] === 'ne' && round[0][1] < 30 && round[4][1] > round[0][1], `a look round says the eight ways: north ${round[0][2]} at ${round[0][1]}, south ${round[4][2] ?? 'nothing'} at ${round[4][1]}`)
  for (const [say, why] of [['nobody', /is from: \[x, y, z\]/], ['flood', /at most 32 times a second/]]) {
    if (say === 'flood') await wait(1100)
    await w.post('say', { by: 'wren', text: say })
    const how = await until(`refused: ${say}`, async () => { const r = await w.how('watch'); return why.test(r.error) && r })
    check(how.running, `"${say}" is refused in words and the rule goes on: ${how.error.slice(0, 70)}`)
  }
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin look')
