// Bodies do not pass through each other (#218, for #264): an actor does not stand in a person or in another actor.
// The real server and world process, a seat and a person at a page, and a rule that is no game (two waiters on a pavement).
// Watched ten times a second from outside: how near anyone's middle ever comes to anyone else's.
//
//   node test/apart.mjs [--out dir]   (with --out, pictures of them standing beside each other)
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const file = join(mkdtempSync(join(tmpdir(), 'engine-apart-')), 'world.log')
const server = await serve('/dev/null', ['--world', file])
const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(300); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 15_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(120)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const how = async (id) => (await send('rules')).find((r) => r.id === id)
const around = () => send('around?by=wren&within=1200')
const person = async (name) => (await around()).people.find((p) => p.name === name)
const heard = async (match) => (await around()).heard.map((h) => h.text).find((t) => match.test(t))
const say = (text) => post('say', { by: 'wren', text })
/** How near the two waiters and the person come to each other while something is done, sampled as it happens. */
const nearest = async (act, ms) => {
  let least = { wren: 1e9, each: 1e9 }, on = true
  const watch = (async () => { while (on) { const a = await around(), ada = a.people.find((p) => p.name === 'Ada'), ben = a.people.find((p) => p.name === 'Ben'); if (ada && ben) least = { wren: Math.min(least.wren, ada.far, ben.far), each: Math.min(least.each, Math.hypot(ada.at[0] - ben.at[0], ada.at[2] - ben.at[2])) }; await wait(90) } })()
  await act(); await wait(ms); on = false; await watch
  return least
}

const WAITERS = `
on('start', (world) => {
  // Both asked for on the very same spot.
  if (!world.people.some((p) => p.mine)) { world.actor('ada', { name: 'Ada', at: [760, 4009] }); world.actor('ben', { name: 'Ben', at: [760, 4009] }) }
})
on('said', (world, e) => {
  const t = e.text
  if (/ada, to me/i.test(t)) world.actor('ada', { to: [e.at[0], e.at[2]], pace: 26 })
  if (/ada, to iris/i.test(t)) { const i = world.people.find((p) => p.name === 'iris'); if (i) world.actor('ada', { to: [i.at[0], i.at[2]], pace: 26 }) }
  if (/ada, past me/i.test(t)) world.actor('ada', { to: [e.at[0] - 60, e.at[2]], pace: 26 })
  if (/both, to the lamp/i.test(t)) { world.actor('ada', { to: [800, 4010], pace: 20 }); world.actor('ben', { to: [800, 4010], pace: 20 }) }
  if (/ben, close/i.test(t)) world.actor('ben', { follow: e.by, keep: 1, pace: 26 })
  if (/ben, stay/i.test(t)) world.actor('ben', { follow: null })
  if (/what stopped/i.test(t)) for (const p of world.people) if (p.mine) world.actor(p.id, { say: p.name + ': ' + (p.stopped || 'nothing') })
})`
let browser
const look = (page, x, z) => page.evaluate(([x, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x, y: e.ground(x, z) + 2.1, z: z + 4.2, yaw: 0, pitch: -0.22 }) }, [x, z])
const shot = async (page, name, x, z) => { if (!out) return; await look(page, x / 10, z / 10); await wait(900); await page.screenshot({ path: join(out, name) }) }
try {
  // The page first (it may wait its turn on the GPU), then the person: a seat nobody asks anything of goes after three minutes.
  const page = await (async () => { browser = await chrome(); const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage(); await p.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.6&hour=10.5&people=0&name=iris`); await p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 }); await look(p, 70, 400.9); await still(p); return p })()
  await post('join', { by: 'wren', at: [700, 4009] })
  await post('ask', { by: 'tester', rule: { id: 'waiters', name: 'Two waiters on a pavement', source: WAITERS } })
  await until('they are there', async () => (await how('waiters'))?.actors === 2)
  const [ada, ben] = [await person('Ada'), await person('Ben')]
  const put = Math.hypot(ada.at[0] - ben.at[0], ada.at[2] - ben.at[2])
  check(put >= 6, `two actors asked for on one spot are put ${put.toFixed(1)} cells apart: nobody is put inside anybody`)

  // Told to walk to where the person stands: it stops beside them and says who.
  const toMe = await nearest(async () => { await say('Ada, to me'); await until('Ada has come', async () => { const p = await person('Ada'); return p && p.far < 12 && p.doing === 'standing' }) }, 600)
  await shot(page, 'apart-1-beside-a-person.png', 700, 4009)
  await say('what stopped you?')
  const why = await until('she says why', () => heard(/^Ada: /))
  check(toMe.wren >= 5.5 && /wren is standing where you were going/.test(why), `sent to where a person stands, an actor stops beside them, never nearer than ${toMe.wren} cells, and says who (${why})`)

  // Told to walk to a place the other side of the person: it goes round them.
  const past = await nearest(async () => { await say('Ada, past me'); await until('Ada is past', async () => { const p = await person('Ada'); return p && p.at[0] < 646 && p.doing === 'standing' }) }, 300)
  check(past.wren >= 5.5, `sent past a person who stands in the way, it goes round them: never nearer than ${past.wren} cells`)

  // Told to follow at a distance too small for two bodies: no nearer than two can stand.
  const close = await nearest(async () => { await say('Ben, close'); await until('Ben has come', async () => { const p = await person('Ben'); return p && p.far < 14 && p.doing === 'standing' }) }, 1500)
  check(close.wren >= 5.5, `told to follow one cell off, it stands ${(await person('Ben')).far} cells off and was never nearer than ${close.wren}`)
  await say('Ben, stay')

  // Two sent to one spot: one has it, the other stops beside.
  const lamp = await nearest(async () => { await say('both, to the lamp'); await until('both have stopped', async () => { const a = await around(); return a.people.filter((p) => p.name === 'Ada' || p.name === 'Ben').every((p) => p.doing === 'standing' && Math.hypot(p.at[0] - 800, p.at[2] - 4010) < 14) }, 30_000) }, 600)
  check(lamp.each >= 5.5 && lamp.wren >= 5.5, `two actors sent to one spot (past the person, both ways) end side by side, never nearer each other than ${lamp.each.toFixed(1)} cells nor the person than ${lamp.wren}`)

  await shot(page, 'apart-2-two-at-one-spot.png', 800, 4010)

  // And a seat's own walk: into an actor's place, it stops beside.
  const target = await person('Ada')
  await post('walk', { by: 'wren', to: [target.at[0], target.at[2]] })
  const me = await until('wren has stopped', async () => { const y = (await send('me?by=wren')).you; return y.walking ? null : y }, 30_000)
  const off = (await person('Ada')).far
  check(off >= 5.5 && /Ada is standing where you were going/.test(me.stopped ?? ''), `a seat walked at an actor stops ${off} cells off, and is told who (${me.stopped})`)

  // And the one the first model-written rule walked its agents into: a person at a page, who moves by their own page.
  await page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 74, y: e.ground(74, 400.9) + 1.6, z: 400.9, yaw: 0, pitch: 0 }) })
  const iris = await until('the page\'s person is where they stand', async () => { const p = await person('iris'); return p && Math.hypot(p.at[0] - 740, p.at[2] - 4009) < 3 ? p : null })
  await post('walk', { by: 'wren', to: [700, 4009] })
  await until('wren is out of the way', async () => !(await send('me?by=wren')).you.walking, 30_000)
  const gap = async () => { const a = await around(), i = a.people.find((p) => p.name === 'iris'), d = a.people.find((p) => p.name === 'Ada'); return i && d ? Math.hypot(i.at[0] - d.at[0], i.at[2] - d.at[2]) : 1e9 }
  let least = 1e9, on = true
  const watch = (async () => { while (on) { least = Math.min(least, await gap()); await wait(90) } })()
  await say('Ada, to iris')
  await until('Ada has come to the page\'s person', async () => (await gap()) < 12 && (await person('Ada')).doing === 'standing', 30_000)
  await wait(600); on = false; await watch
  await say('what stopped you?')
  const told = await until('she says why again', () => heard(/^Ada: iris/))
  check(least >= 5.5 && /iris is standing where you were going/.test(told), `sent to where a person at a page stands (feet ${iris.at[1]}), an actor stops beside them, never nearer than ${least.toFixed(1)} cells, and says who (${told})`)
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser?.close()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('apart: ok')
process.exit(0)
