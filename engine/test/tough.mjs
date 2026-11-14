// How much a thing takes is a number (#245, for #264). No page: the real server and world process, and a rule
// that is no game (someone who tests karts against a wall). A kart as it is made runs into a wall at its top speed
// and is whole; made brittle by its rule it breaks on the same wall, and the rule hears; a kart made quicker for
// two seconds is quicker for two seconds; what is out of range is refused.
//
//   node test/tough.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-tough-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(300); continue } return r.json().catch(() => ({})) } }
const how = async () => JSON.stringify((await (await fetch(`${server.url}/world/rules`)).json()).find((r) => r.id === 'tester'))
const RULE = `on('start', (world) => { world.actor('tester', {name: 'Tester', at: [700, 4100]}); world.keep.broke = '' })
on('broke', (world, e) => { world.keep.broke += e.own + ' ' })
on('tick', (world) => { world.actor('tester', {say: (world.things.map((t) => [t.own || t.id, t.at[0], t.speed, t.tough, t.top, t.upright ? 'up' : 'over'].join('|')).join(' ; ') || 'nothing') + ' ; broke|' + world.keep.broke}) })
on('said', (world, e) => {
  if (/two karts/.test(e.text)) { world.thing('a', {like: 'kart', at: [790, 4072], yaw: Math.PI / 2}); world.thing('b', {like: 'kart', at: [790, 4092], yaw: Math.PI / 2}) }
  if (/brittle/.test(e.text)) world.thing('b', {tough: 20})
  if (/both go/.test(e.text)) { world.drive('a', {go: 1}); world.drive('b', {go: 1}) }
  if (/a goes/.test(e.text)) world.drive('a', {go: 1})
  if (/back/.test(e.text)) world.drive('a', {go: -1})
  if (/halt/.test(e.text)) { world.drive('a', {go: 0}); world.drive('b', {go: 0}) }
  if (/quick/.test(e.text)) world.thing('a', {top: 300, power: 300, for: 2})
  if (/too tough/.test(e.text)) world.thing('a', {tough: 99999})
})`
let since = 0
const says = async (ok, tries = 40) => { let text = ''; for (let i = 0; i < tries; i++) { const a = await (await fetch(`${server.url}/world/around?by=steward&since=${since}`)).json(); for (const h of a.heard ?? []) if (h.name === 'Tester') { text = h.text; since = Math.max(since, h.n) } const t = text && Object.fromEntries(text.split(' ; ').map((l) => l.split('|')).map((f) => [f[0], f[0] === 'broke' ? f[1] : { x: Number(f[1]), speed: Number(f[2]), tough: Number(f[3]), top: Number(f[4]), up: f[5] === 'up' }])); if (t && ok(t)) return t; await wait(200) } console.log('  the tester last said', text); return null }
try {
  const ground = Math.round((await (await fetch(`${server.url}/world/at?x=900&y=0&z=4082`)).json()).ground)
  await post('join', { by: 'steward', at: [704, 4104] })
  check((await post('ask', { by: 'tester', rule: { id: 'tester', name: 'A tester of karts', source: RULE } })).asked, 'a rule that sets how much its things take is taken')
  await wait(1200)
  // A wall of brick across the street eleven metres ahead of two karts.
  const rows = []
  for (let y = ground - 2; y < ground + 24; y++) for (let z = 4056; z < 4108; z++) rows.push(900, 906, y, z, 8)
  await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [903, ground + 30, 4082] })
  await post('say', { by: 'steward', text: 'two karts' })
  const made = await says((t) => t.a && t.b && t.a.speed === 0)
  check(!!made && made.a.tough === 300 && made.a.top === 140, `a kart as it is made takes ${made?.a.tough} and goes ${made?.a.top}: world.things says the numbers of what the rule brought`)
  await post('say', { by: 'steward', text: 'brittle' })
  const set = await says((t) => t.b?.tough === 20)
  await post('say', { by: 'steward', text: 'both go' })
  const hit = await says((t) => /b/.test(t.broke) && t.a && t.a.x > 870 && t.a.speed < 5, 60)
  await post('say', { by: 'steward', text: 'halt' })
  check(!!set && !!hit && hit.a.up && !hit.b, `both run into the wall at their top speed: the kart as made is whole and upright against it (at ${hit?.a.x}), the one its rule made brittle breaks and is gone, and the rule hears broke ("${hit?.broke.trim()}")`)
  // Quicker for a while.
  await post('say', { by: 'steward', text: 'back' })
  await wait(2500)
  await post('say', { by: 'steward', text: 'halt' })
  await says((t) => t.a && t.a.speed === 0 && t.a.x < 860)
  await post('say', { by: 'steward', text: 'quick' })
  const quick = await says((t) => t.a?.top === 300)
  const slow = await says((t) => t.a?.top === 140, 30)
  check(!!quick && !!slow, 'made quicker for two seconds, its numbers are the quicker ones and then, by themselves, as it was made')
  await post('say', { by: 'steward', text: 'too tough' })
  await wait(900)
  check(/tough is a number from 10 to 2000/.test(await how()), 'a number out of range is refused, and the rule is told why')
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('tough: ok')
process.exit(0)
