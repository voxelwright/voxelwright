// Nothing a rule could hear or do has gone missing (#264). On November 13 one lane's merge took two other lanes'
// merged work out of main by settling conflicts with its own side of whole files, and nothing said so for an hour:
// each lane's own checks still passed. This asks a running server for the guide, which is what a model writes
// rules from, and fails if it no longer names something on the list. No page, a few seconds: run it before every
// merge (`node test/all.mjs --only whole`), and add what your PR gives rules to the list in the same PR.
//
//   node test/whole.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

/** What a rule can do, as `world.<name>`; what it can hear, as `on('<name>'`; and what else the guide must still say. */
const DOES = ['actor', 'gone', 'offer', 'show', 'sound', 'music', 'think', 'person', 'clock', 'throw', 'push', 'down', 'mark', 'look', 'matter', 'ask', 'answer']
const HEARS = ['start', 'said', 'tick', 'act', 'pick', 'thought', 'near', 'struck']
const SAYS = ['world.residents', 'world.people', 'world.keep', 'take:', 'follow', 'move', 'look.wear', '/realms', '/realm/<id>', '/world/rules']

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-whole-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
try {
  // The guide is put together from the plugins that have loaded, and for its first moments a server's guide is
  // without their lines (seen November 13: `world.music` and `world.look` missing from a guide asked for at once).
  // So it is asked until it is whole, for ten seconds; how long that took is said.
  const missing = (guide) => [...DOES.filter((n) => !guide.includes(`world.${n}(`)).map((n) => `world.${n}`), ...HEARS.filter((n) => !guide.includes(`on('${n}'`)).map((n) => `on('${n}')`), ...SAYS.filter((s) => !guide.includes(s))]
  const began = Date.now()
  let lost = missing(await (await fetch(`${server.url}/world/`)).text())
  const first = lost
  while (lost.length && Date.now() - began < 10_000) { await new Promise((r) => setTimeout(r, 200)); lost = missing(await (await fetch(`${server.url}/world/`)).text()) }
  if (first.length && !lost.length) console.log(`  note the guide was without ${first.join(', ')} for its first ${Date.now() - began} ms`)
  check(lost.length === 0, lost.length ? `the guide no longer names: ${lost.join(', ')}` : `the guide names all ${DOES.length} things a rule can do, all ${HEARS.length} it can hear, and ${SAYS.length} more`)
  // And the world's process agrees with the guide: a rule is told each name as something it can call.
  const source = `on('start', (world) => { const can = ${JSON.stringify(DOES)}.filter((n) => typeof world[n] === 'function'); world.actor('teller', { at: [700, 4009], name: can.length + ' of ${DOES.length}', say: can.join(' ') }) })`
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'whole', rule: { id: 'whole', source } }) })
  await fetch(`${server.url}/world/join`, { method: 'POST', body: JSON.stringify({ by: 'listener', at: [700, 4020] }) })
  let told = null
  for (let i = 0; i < 80 && !told; i++) { await new Promise((r) => setTimeout(r, 250)); const a = await (await fetch(`${server.url}/world/around?by=listener`)).json(); told = a.people?.find((p) => / of \d+$/.test(p.name)) ?? null }
  check(told?.name === `${DOES.length} of ${DOES.length}`, `a rule is given every one of them to call (${told?.name ?? 'the rule never said'})`)
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('whole: ok')
process.exit(0)
