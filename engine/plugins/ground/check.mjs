// The ground plugin's check: two rules that are not alike and neither a game. A surveyor tells whoever asks what
// the ground round them is like; a lighthouse keeper looks for the nearest shore, puts a beacon on it and says
// where it is. What they are told is checked against the world itself. The real server; no page and no model.
//
//   node plugins/ground/check.mjs
import { readFileSync } from 'node:fs'
import { guideFor } from '../../make/rules.mjs'
import { until, wait, world } from '../../test/plugkit.mjs'

const w = await world(), { check } = w
const HOME = [700, 4070]
const SURVEYOR = `
const note = (world, e) => { world.keep.heard = (world.keep.heard || []).concat([e]).slice(-12) }
on('ground', note)
on('said', (world, e) => {
  if (/ground like/.test(e.text)) world.ground('here', { at: [e.at[0], e.at[2]], within: 300 })
  if (/fine grid/.test(e.text)) world.ground('fine', { at: [e.at[0], e.at[2]], within: 160, grid: 17 })
  if (/sand/.test(e.text)) world.ground('plain', { find: 'sand', near: [${HOME}], room: 1500 })
  if (/level as a table/.test(e.text)) world.ground('table', { find: 'sand', near: [${HOME}], room: 3000, flat: 3, within: 400000 })
  if (/moon/.test(e.text)) world.ground('moon', { find: 'moon', near: [${HOME}] })
  if (/nowhere/.test(e.text)) world.ground('nowhere', { within: 300 })
  if (/too wide/.test(e.text)) world.ground('wide', { at: [${HOME}], within: 90000 })
  if (/too much room/.test(e.text)) world.ground('room', { find: 'grass', near: [${HOME}], room: 90000 })
  if (/flood/.test(e.text)) for (let i = 0; i < 6; i++) world.ground('f' + i, { at: [${HOME}], within: 50, grid: 3 })
})`
const KEEPER = `
on('start', (world) => { if (!world.keep.shore) world.ground('shore', { find: 'shore', near: [${HOME}], room: 400 }) })
on('ground', (world, e) => {
  if (e.ground === 'shore' && e.found) { world.keep.shore = e; world.build('beacon', { at: [e.at[0], e.at[2]], parts: [['posts', 'rock', 'own', [[0, 0]], 8, 30], ['posts', 'lamp', '4:4', [[0, 0]], 4, 6, 30]] }) }
  if (e.ground === 'look') world.keep.look = e
})
on('built', (world, e) => { if (e.build === 'beacon' && !e.failed) { world.keep.beacon = e; world.ground('look', { at: [e.at[0], e.at[2]], within: 200, grid: 5 }) } })`

const kept = (rule) => { try { return JSON.parse(readFileSync(`${w.file}.people.json`, 'utf8'))[rule]?.keep ?? {} } catch { return {} } }
const told = (what, ok) => until(`the surveyor hears ${what}`, async () => (kept('surveyor').heard ?? []).find(ok), 15_000)
const at = (x, y, z) => w.get(`at?x=${x}&y=${y}&z=${z}`)
const say = (text) => w.post('say', { by: 'wren', text })
const WAYS = { north: [0, -1], 'north-east': [1, -1], east: [1, 0], 'south-east': [1, 1], south: [0, 1], 'south-west': [-1, 1], west: [-1, 0], 'north-west': [-1, -1] }

try {
  const guide = guideFor(await (await fetch(`${w.url}/world/`)).text())
  check(guide.includes('world.ground(id, {at, within, grid})') && guide.includes("on('ground'") && guide.includes('looks for ground once a second'), 'a model writing rules is shown world.ground, every line of it, and what it hears (the guide, as make/rules.mjs cuts it)')
  await w.post('join', { by: 'wren', at: HOME })
  await w.rule('surveyor', SURVEYOR)
  await until('the surveyor runs', async () => (await w.how('surveyor'))?.running)

  // ── The lie of the land where someone stands: the street, the houses along it, and how it slopes.
  await say('what is the ground like here?')
  const here = await told('of the street', (e) => e.ground === 'here')
  check(here.h.length === 9 && here.h.every((r) => r.length === 9) && here.of.every((r) => r.length === 9) && here.up.length === 9 && here.step === 75, `the ground round someone is told as a grid of ${here.h.length} by ${here.h[0].length}, a column every ${here.step} cells`)
  check(here.of.join('').includes('a') && here.up.flat().some((u) => u > 20) && here.town !== null && here.most === 'asphalt' && here.clear > 0.3 && here.clear < 1, `in the town it is a road (${here.of[4]}) with houses standing along it (up to ${Math.max(...here.up.flat())} cells over the ground), ${here.clear} of it clear`)
  const [row, col] = [6, 2], x = here.at[0] - here.within + col * here.step, z = here.at[2] - here.within + row * here.step, real = (await at(x, 0, z)).ground
  check(Math.abs(here.h[row][col] - (real + 1)) <= 1 && here.high - here.low > 10 && here.h[0][0] !== here.h[8][8], `the heights are the world's own (told ${here.h[row][col]} at ${x}, ${z}; the ground's top there is ${real}) and the street slopes ${here.high - here.low} cells across it`)
  await say('a fine grid please')
  const fine = await told('the fine grid', (e) => e.ground === 'fine')
  check(fine.h.length === 17 && fine.step === 20, 'a finer grid is told when asked for (17 a side)')

  // ── Where there is room: the plain is kilometres east, and the answer is ground that is what was asked.
  await say('where is there sand to build on?')
  const plain = await told('of the plain', (e) => e.ground === 'plain')
  check(plain.found && plain.of === 'sand' && plain.at[0] > HOME[0] + 30000 && plain.far > 30000 && plain.rise <= 250 && plain.town === null, `sand with 150 m of room round it is found ${(plain.far / 10000).toFixed(1)} km off to the east, at ${plain.at}, rising ${plain.rise} cells across it`)
  const top = (await at(plain.at[0], plain.at[1] - 1, plain.at[2])), over = await at(plain.at[0], plain.at[1], plain.at[2])
  check(top.material === 4 && over.material === 0, 'and the world agrees: sand under the feet there, air over it')
  // A search that cannot succeed looks far and long: the world goes on answering meanwhile.
  await say('find me ground as level as a table')
  let worst = 0
  for (const end = Date.now() + 1200; Date.now() < end;) { const t = performance.now(); await at(1, 1, 1); worst = Math.max(worst, performance.now() - t) }
  const table = await told('that there is none', (e) => e.ground === 'table')
  check(table.found === false && /no sand with 3000 cells/.test(table.why) && worst < 250, `ground that is not there is said not to be, in words ("${table.why.slice(0, 50)}..."), and the world answered a question within ${worst.toFixed(0)} ms while it was looked for`)

  // ── Asked as a stranger asks.
  for (const [word, why] of [['the moon', /find is one of open, grass/], ['nowhere', /at is \[x, z\]/], ['too wide', /within is how far from at/], ['too much room', /room is how far/]]) {
    await say(word)
    const how = await until(`refused: ${word}`, async () => { const r = await w.how('surveyor'); return why.test(r.error) && r })
    check(how.running, `"${word}" is refused in words and the rule goes on: ${how.error.slice(0, 70)}`)
  }
  await wait(1100)
  await say('flood')
  const flood = await until('the flood is refused', async () => { const r = await w.how('surveyor'); return /at most 4 times a second/.test(r.error) && r })
  check(flood.running, `a rule that asks too often is told so: ${flood.error.slice(0, 60)}`)

  // ── The keeper: finds the shore, builds on it, and the ground it then asks about has the beacon standing on it.
  await w.rule('keeper', KEEPER)
  const shore = await until('the keeper finds the shore', async () => kept('keeper').shore, 15_000)
  const way = WAYS[shore.water.to], land = (await at(shore.at[0], 0, shore.at[2])).ground, sea = (await at(shore.at[0] + way[0] * shore.water.far, 0, shore.at[2] + way[1] * shore.water.far)).ground
  check(shore.found && land >= -1 && sea < -1 && shore.town === null, `a shore is found ${(shore.far / 10000).toFixed(1)} km off: land at ${shore.at} (the ground ${land}), the sea ${shore.water.far} cells to the ${shore.water.to} (its bed ${sea})`)
  const look = await until('the keeper looks at its beacon', async () => kept('keeper').look, 15_000), beacon = kept('keeper').beacon
  check(beacon.cells > 1000 && look.up[2][2] === 36 && look.up[0][0] === 0, `what was built there is in the ground a rule is told of: the beacon stands ${look.up[2][2]} cells over the middle column, and nothing stands at the corner`)
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
w.finish('plugin ground')
