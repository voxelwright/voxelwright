// A realm's director (#264): the rule kept under the id "director" works only while the realm's record says it has
// one and someone's model answers for the world. Otherwise it rests: told nothing, what it put into the world gone,
// the rule and what it keeps still there. No model runs here: a stand-in answers.
//   node test/director.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { key } from '../mind/door.mjs'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-director-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (what, fn, ms) => { for (const began = Date.now(); Date.now() - began < ms; await wait(100)) { const v = await fn(); if (v) return v } throw new Error(`never: ${what}`) }
/** Someone whose model answers for a world, for as long as it is not stopped: it asks what there is to answer, as a helper does. */
const voice = (world) => {
  const k = key(), stop = new AbortController()
  void (async () => { while (!stop.signal.aborted) { try { await (await fetch(`${world}/minds?voice=${k}`, { signal: stop.signal })).json() } catch { await wait(100) } } })()
  return async () => { stop.abort(); await fetch(`${world}/mind`, { method: 'POST', body: JSON.stringify({ voice: k, leave: true }) }) }
}
try {
  const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) })
  const made = await (await post(`${server.url}/realms`, { by: 'tester', name: 'A ring', director: true })).json()
  const world = `${server.url}/realm/${made.id}/world`
  const record = async () => (await fetch(`${world}/realm`)).json()
  check(made.director === true && (await record()).director === true, 'a realm is made with a director, and its record says so')
  check((await post(`${world}/ask`, { by: 'tester', realm: { director: 'yes' } })).status === 400, 'whether it has one is true or false, and nothing else')
  await post(`${world}/join`, { by: 'wren', at: [700, 4020] })
  // A director that casts someone each time it is started, named by how often and why; and a rule beside it that is not a director.
  const source = `on('start', (world, e) => { world.keep.n = (world.keep.n || 0) + 1; world.actor('cast', { at: [700, 4009], name: 'Dee ' + world.keep.n + ' ' + e.why }) })\non('tick', (world) => { world.keep.ticks = (world.keep.ticks || 0) + 1 })`
  await post(`${world}/ask`, { by: 'tester', rule: { id: 'director', name: 'The director', source } })
  await post(`${world}/ask`, { by: 'tester', rule: { id: 'other', source: `on('start', (world) => world.actor('o', { at: [704, 4009], name: 'Other' }))` } })
  const rule = async (id) => (await (await fetch(`${world}/rules`)).json()).find((r) => r.id === id)
  const names = async () => (await (await fetch(`${world}/around?by=wren&within=1200`)).json()).people.filter((p) => p.what === 'an actor of a rule').map((p) => p.name).sort()
  await until('the other rule runs', async () => (await names()).includes('Other'), 6000)
  await until('the director says what it listens for', async () => (await rule('director'))?.running, 6000)
  await wait(1500)
  let d = await rule('director')
  check(d.calls === 0 && d.actors === 0 && !d.error && (await names()).join() === 'Other', `with nobody's model to answer, the director rests: called ${d.calls} times, nobody cast, nothing wrong; the realm's other rule goes on`)
  // Someone's model comes: it is started.
  let leave = voice(world)
  await until('the director casts', async () => (await names()).some((n) => n.startsWith('Dee ')), 6000)
  check(true, `once a model answers, it is started and casts (${(await names()).join(', ')})`)
  await until('it hears the clock', async () => (await rule('director')).calls > 2, 6000)
  // Turned off: what it put into the world goes, at once; the rule stays, and is told nothing.
  await post(`${world}/ask`, { by: 'tester', realm: { director: false } })
  await until('its cast goes', async () => (await names()).join() === 'Other', 3000)
  const calls = (await rule('director')).calls
  await wait(1500)
  d = await rule('director')
  check(d.running && d.calls <= calls + 1 && d.actors === 0 && (await record()).director === false, 'turned off, its cast goes, it is told nothing more, and the rule is still there')
  // Turned on again: started, with what it kept.
  await post(`${world}/ask`, { by: 'tester', realm: { director: true } })
  await until('woken with what it kept', async () => (await names()).includes('Dee 3 woken'), 6000)
  check(true, 'turned on again, it is told so and has what it kept')
  // The voice goes: it rests again, and nothing is wrong.
  await leave()
  await until('its cast goes with the voice', async () => (await names()).join() === 'Other', 6000)
  d = await rule('director')
  check(d.running && !d.error, 'when the model that answered goes, it rests again, with nothing wrong')
  leave = voice(world)
  await until('woken by a voice', async () => (await names()).some((n) => n.startsWith('Dee 4')), 6000)
  check(true, 'and is woken when one comes back')
  await leave()
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('director: ok')
process.exit(0)
