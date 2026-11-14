// A chase a rule makes that can be got out of (#366), with the parts that are there: a pursuer that follows, slower
// than the one it is after, and is stood down by its rule when it has not seen them for a few seconds. No page: the
// real server and world process, a rule that is no game, someone in a seat who is chased, walks off round a wall
// and is lost.
//
//   node test/chase.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-chase-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(300); continue } return r.json().catch(() => ({})) } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 20_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(200)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
// A guard who goes after whoever says "catch me", at a pace under theirs, and gives up three seconds after losing sight of them.
const RULE = `on('start', (world) => world.actor('guard', {name: 'Guard', at: [700, 4083], pace: 8}))
on('said', (world, e) => { if (/catch me/.test(e.text)) { world.keep.after = e.by; world.keep.unseen = 0; world.actor('guard', {follow: e.by, keep: 12, say: 'After you.'}) } })
on('tick', (world) => {
  const after = world.keep.after
  if (!after) return
  world.keep.unseen = world.sees('guard', after) ? 0 : world.keep.unseen + 0.5
  if (world.keep.unseen >= 3 || !world.who(after)) { world.keep.after = null; world.actor('guard', {follow: null, say: 'Lost them.'}) }
})`
const heard = async () => (await send('around?by=runner&within=2000')).heard?.map((h) => h.text) ?? []
const guard = async () => (await send('around?by=runner&within=2000')).people.find((p) => p.name === 'Guard')
try {
  const ground = Math.round((await send('at?x=760&y=0&z=4083')).ground)
  await post('join', { by: 'runner', at: [780, 4083] })
  check((await post('ask', { by: 'tester', rule: { id: 'chase', name: 'A guard who gives chase', source: RULE } })).asked, 'a rule whose guard gives chase is taken')
  await until('the guard stands', guard)
  await until('heard', async () => { await post('say', { by: 'runner', text: 'catch me' }); await wait(600); return (await heard()).includes('After you.') })
  // The runner walks east down the street at a walk (13 cells a second); the guard comes after at 8.
  const from = (await guard()).at
  await post('walk', { by: 'runner', to: [1000, 4083] })
  await wait(5000)
  const g = await guard(), me = (await send('me?by=runner')).you
  const gap = Math.hypot(me.at[0] - g.at[0], me.at[2] - g.at[2])
  check(g.at[0] > from[0] + 20 && gap > 90, `the guard comes after them, and a pursuer slower than they are falls behind (it came ${Math.round(g.at[0] - from[0])} cells, they are ${Math.round(gap)} ahead)`)
  check(!(await heard()).includes('Lost them.'), 'while it sees them it keeps after them')
  // A wall across the street between them: out of its sight for three seconds, the rule stands it down.
  const rows = []
  for (let y = ground; y < ground + 30; y++) for (let z = 4043; z < 4123; z++) rows.push(me.at[0] - 30, me.at[0] - 28, y, z, 8)
  await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [me.at[0] - 29, ground + 32, 4083] })
  await until('the guard gives up', async () => (await heard()).includes('Lost them.'), 15_000)
  await wait(1500)
  const stood = await guard(), later = (await wait(2500), await guard())
  check(Math.hypot(later.at[0] - stood.at[0], later.at[2] - stood.at[2]) < 3, `out of its sight for three seconds it is stood down and comes no further (it stands at ${later.at[0]}, ${later.at[2]})`)
} catch (e) { check(false, `the check ran to its end (${e.message})`) } finally { server.stop() }
if (failures.length) { console.log('FAILED'); for (const f of failures) console.log(`  ${f}`); process.exit(1) }
console.log('chase: ok')
process.exit(0)
