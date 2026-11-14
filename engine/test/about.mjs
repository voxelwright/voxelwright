// Getting about (#218, for #264): a body the world moves goes round what is in its way, follows someone, keeps
// away from someone, and a rule hears when a person comes near an actor or into a place it marked. The real server
// and world process, a seat for the person, and a rule that is no game (a porter and a shy cat on a street).
//
//   node test/about.mjs [--out directory]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'

const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const file = join(mkdtempSync(join(tmpdir(), 'engine-about-')), 'world.log')
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 10_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const how = async (id) => (await send('rules')).find((r) => r.id === id)
const around = () => send('around?by=wren&within=1200')
const person = async (name) => (await around()).people.find((p) => p.name === name)
const heard = async (match) => (await around()).heard.map((h) => h.text).find((t) => match.test(t))
const say = (text) => post('say', { by: 'wren', text })
const walk = async (to) => { await post('walk', { by: 'wren', to }); await until('wren arrives', async () => { const me = (await send('me?by=wren')).you; return !me.walking }, 30_000) }

const STREET = `
on('start', (world) => {
  if (!world.people.some((p) => p.mine)) {
    world.actor('porter', { name: 'Porter', at: [854, 4012], reach: 40, look: { coat: '#5a2a2a', wear: ['uniform', 'cap #5a2a2a'] } })
    world.actor('cat', { name: 'A shy one', at: [760, 4010], look: { tall: 0.8, coat: '#3a3128' } })
  }
  world.mark('door', { at: [700, 4008], within: 25 })
})
on('near', (world, e) => {
  if (e.actor === 'porter') world.actor('porter', { say: (e.left ? 'Goodbye, ' : 'Good day, ') + e.name + '.', move: e.left ? null : 'wave' })
  if (e.place === 'door') world.actor('porter', { say: e.name + (e.left ? ' has left the door' : ' is at the door') })
})
on('said', (world, e) => {
  if (/across/i.test(e.text)) world.actor('porter', { to: [854, 4122] })
  if (/into the house/i.test(e.text)) world.actor('porter', { to: [854, 3960] })
  if (/come with me/i.test(e.text)) world.actor('porter', { follow: e.by, keep: 20, pace: 22 })
  if (/stay/i.test(e.text)) world.actor('porter', { follow: null })
  if (/shoo/i.test(e.text)) world.actor('cat', { flee: e.by, keep: 120, pace: 30 })
  if (/after the moon/i.test(e.text)) world.actor('porter', { follow: 'the-moon' })
  if (/what stopped/i.test(e.text)) { const p = world.people.find((p) => p.mine && p.id === 'porter'); world.actor('porter', { say: p.stopped ? 'Stopped: ' + p.stopped : 'Nothing stopped me.' }) }
})`
let browser
try {
  // The page first (it may wait its turn on the GPU for minutes), then the person: a seat nobody asks anything of goes after three.
  const page = out ? await (async () => { browser = await chrome(); const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage(); await p.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.6&hour=10.5&people=0&name=iris`); await p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 }); await p.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 88.5, y: e.ground(88.5, 409) + 14, z: 413.5, yaw: -0.25, pitch: -0.95 }) }); await still(p); return p })() : null
  await post('join', { by: 'wren', at: [700, 4070] })
  await post('ask', { by: 'tester', rule: { id: 'street', name: 'A porter and a shy cat', source: STREET } })
  await until('they are there', async () => (await how('street'))?.actors === 2)

  // Across the street: a parked car lies on the straight line (it stopped a model on November 12).
  const before = await person('Porter')
  await say('Porter, take this across the street')
  const shots = []
  if (page) for (let i = 0; i < 6; i++) { await wait(1400); shots.push(await page.screenshot({ path: join(out, `about-across-${i}.png`) })) }
  const across = await until('the porter is across', async () => { const p = await person('Porter'); return p && p.doing === 'standing' && Math.hypot(p.at[0] - 854, p.at[2] - 4122) < 8 ? p : null }, 30_000)
  await say('what stopped you?')
  check(await until('it answers', () => heard(/^Nothing stopped me\.$/)), `told to cross where a parked car is in the way, the porter goes round it and arrives (${before.at} to ${across.at})`)

  // Into a house: there is no way, it says what is in the way, and the world goes on answering meanwhile.
  await say('now go into the house')
  let slowest = 0
  const stopped = await until('it gives up', async () => { const t = performance.now(); await send('at?x=700&y=160&z=4070'); slowest = Math.max(slowest, performance.now() - t); await say('what stopped you?'); return heard(/^Stopped: /) }, 40_000)
  check(/in the way/.test(stopped) && slowest < 600, `sent into a house it gets as near as it can and says why (${stopped.slice(9, 70)}...); the world answered a question within ${Math.round(slowest)} ms throughout`)

  // Near: a person comes within the porter's reach, and goes; and into a marked place.
  const porter = await person('Porter')
  await walk([porter.at[0] + 30, porter.at[2] + 10])
  check(await until('greeted', () => heard(/^Good day, wren\.$/)), 'a person who comes within an actor\'s reach is told of to its rule (near), once')
  await say('come with me')
  await walk([760, 4070])
  const beside = await until('the porter has come along', async () => { const p = await person('Porter'); return p && p.far < 32 && p.doing === 'standing' ? p : null }, 30_000)
  check(beside.far >= 14 && beside.far < 32, `told to follow, it comes along and stops ${beside.far} cells off (it was to keep 20)`)
  const greetings = (await around()).heard.filter((h) => /^Good day, wren\.$/.test(h.text)).length
  check(greetings === 1, `walking beside someone who stays within reach, the rule heard near once, not every tick (${greetings})`)
  await say('stay here')
  await walk([760, 4060])
  await walk([700, 4012])
  check(await until('goodbye', () => heard(/^Goodbye, wren\.$/)) && await until('at the door', () => heard(/^wren is at the door$/)), 'going out of reach is told (left), and so is coming into a place the rule marked')

  // Keeping away.
  const cat = await person('A shy one')
  await say('shoo')
  await walk([cat.at[0] - 30, 4012])
  const fled = await until('the shy one keeps away', async () => { const p = await person('A shy one'); return p && p.far > 105 && p.doing === 'standing' ? p : null }, 30_000)
  check(fled.far > 105, `told to keep away, the shy one was ${cat.far} cells off, was walked up to, and is ${fled.far} cells off again`)
  await say('go after the moon')
  await until('the rule is told nobody is called that', async () => /nobody called "the-moon"/.test((await how('street'))?.error ?? ''))
  check(true, 'following someone who is not there is refused, and says so')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser?.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('about: ok')
process.exit(0)
