// A thing given somewhere to go (#245, for #264). No page: the real server and world process, and a rule that is
// no game (someone who sends a kart on an errand). The kart is given a course of places and the world steers it:
// it arrives and the rule hears; a kart standing on its way is gone round, not run into; someone on foot in its
// way is stopped for, and it goes on when they have gone; and a course that loops is gone round again.
//
//   node test/course.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-course-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(300); continue } return r.json().catch(() => ({})) } }
const RULE = `on('start', (world) => { world.actor('sender', {name: 'Sender', at: [700, 4100]}); world.keep.arrived = '' })
on('arrived', (world, e) => { world.keep.arrived += e.own + '@' + e.at[0] + ' ' })
on('tick', (world) => { world.actor('sender', {say: (world.things.map((t) => [t.own || t.id, t.at[0], t.at[2], t.speed, t.upright ? 'up' : 'over', t.to ? t.to.join(',') : '-'].join('|')).join(' ; ') || 'nothing') + ' ; arrived|' + world.keep.arrived}) })
on('said', (world, e) => {
  if (/errand/.test(e.text)) { world.thing('a', {like: 'kart', at: [790, 4074], yaw: Math.PI / 2}); world.drive('a', {to: [[880, 4070], [960, 4078], [1040, 4072]]}) }
  if (/in the way/.test(e.text)) { world.thing('b', {like: 'kart', at: [1235, 4076], yaw: 0}); world.thing('c', {like: 'kart', at: [1130, 4074], yaw: Math.PI / 2}); world.drive('c', {to: [1320, 4076], pace: 0.6}) }
  if (/walker/.test(e.text)) { world.thing('d', {like: 'kart', at: [790, 4074], yaw: Math.PI / 2}); world.drive('d', {to: [1040, 4074], pace: 0.7}) }
  if (/round and round/.test(e.text)) { world.thing('e', {like: 'kart', at: [1225, 4051], yaw: Math.PI / 2}); world.drive('e', {to: [[1258, 4060], [1267, 4083], [1258, 4106], [1235, 4115], [1212, 4106], [1203, 4083], [1212, 4060], [1235, 4051]], loop: true, pace: 0.4}) }
  if (/away/.test(e.text)) for (const id of ['a', 'b', 'c', 'd', 'e']) world.thing(id, {like: null})
})`
let since = 0
const says = async (ok, tries = 60) => { let text = ''; for (let i = 0; i < tries; i++) { const a = await (await fetch(`${server.url}/world/around?by=steward&since=${since}`)).json(); for (const h of a.heard ?? []) if (h.name === 'Sender') { text = h.text; since = Math.max(since, h.n) } const t = text && Object.fromEntries(text.split(' ; ').map((l) => l.split('|')).map((f) => [f[0], f[0] === 'arrived' ? f[1] : { x: Number(f[1]), z: Number(f[2]), speed: Number(f[3]), up: f[4] === 'up', to: f[5] }])); if (t && ok(t)) return t; await wait(200) } console.log('  the sender last said', text); return null }
try {
  await post('join', { by: 'steward', at: [704, 4104] })
  check((await post('ask', { by: 'tester', rule: { id: 'sender', name: 'Someone who sends karts', source: RULE } })).asked, 'a rule that gives its things somewhere to go is taken')
  await wait(1200)
  // A course of three places: the world steers, the rule hears it arrive.
  await post('say', { by: 'steward', text: 'errand' })
  const came = await says((t) => /a@/.test(t.arrived))
  check(!!came && Math.hypot(came.a.x - 1040, came.a.z - 4072) < 30 && came.a.up && came.a.to === '-', `given a course of three places, the kart is steered along it by the world and the rule hears it arrive (${came?.arrived.trim()}; it stands at ${came?.a.x}, ${came?.a.z})`)
  await post('say', { by: 'steward', text: 'away' })
  await says((t) => !t.a)
  // A kart standing on the way, where there is room to pass (the crossing): gone round, not run into.
  await post('say', { by: 'steward', text: 'in the way' })
  const before = await says((t) => t.b && t.c)
  const round = await says((t) => /c@/.test(t.arrived), 80)
  check(!!round && !!before && Math.hypot(round.b.x - before.b.x, round.b.z - before.b.z) < 3 && round.c.up, `a kart standing in its way is gone round: the one on its course arrives, and the one standing was moved ${round && before ? Math.hypot(round.b.x - before.b.x, round.b.z - before.b.z).toFixed(0) : '?'} cells`)
  await post('say', { by: 'steward', text: 'away' })
  await says((t) => !t.b && !t.c)
  // Someone on foot in its way: stopped for, and on again when they have gone.
  await post('join', { by: 'walker', at: [900, 4074] })
  await post('say', { by: 'steward', text: 'walker' })
  const stopped = await says((t) => t.d && t.d.x > 820 && t.d.speed === 0, 50)
  check(!!stopped && stopped.d.x < 896, `someone standing in its way on foot is stopped for (it stands at ${stopped?.d.x}, they at 900)`)
  await post('join', { by: 'walker', at: [900, 4110] })
  const on = await says((t) => /d@/.test(t.arrived), 80)
  check(!!on, 'when they have gone it goes on and arrives')
  await post('say', { by: 'steward', text: 'away' })
  await says((t) => !t.d)
  // A course that loops: round a ring of eight places at the crossing, and round again.
  await post('say', { by: 'steward', text: 'round and round' })
  const seen = []
  for (let i = 0; i < 150 && seen.filter((p) => p === '1258,4060').length < 3; i++) { const t = await says((t) => t.e, 5); if (t?.e && t.e.to !== seen[seen.length - 1]) seen.push(t.e.to); await wait(150) }
  const last = await says((t) => t.e, 5)
  check(seen.filter((p) => p === '1258,4060').length >= 3 && last?.e.up, `a course that loops is gone round and round: it made for its first place ${seen.filter((p) => p === '1258,4060').length} times (${seen.length} places in all)`)
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('course: ok')
process.exit(0)
