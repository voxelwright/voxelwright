// Actors that get about as a person can (#218, for #264): a rule gives its actor the numbers it would give a
// person (jump, climb, fly, fall) and the world's process moves it by them. The real server and world process,
// a seat to speak, and a rule that is no game (a roofer between two sheds). Watched ten times a second.
//
//   node test/able.mjs [--out dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'

const out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const file = join(mkdtempSync(join(tmpdir(), 'engine-able-')), 'world.log')
let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(300); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 20_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(100)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const around = () => send('around?by=wren&within=1500')
const roofer = async () => (await around()).people.find((p) => p.name === 'Rook')
const heard = async (match) => (await around()).heard.map((h) => h.text).find((t) => match.test(t))
const say = (text) => post('say', { by: 'wren', text })
/** Where the roofer is while something is done, ten times a second, until it is done. */
let snap = async () => {}
const watched = async (text, done, ms = 25_000, picture = null) => {
  const seen = []
  await say(text)
  await until(text, async () => { const p = await roofer(); if (p) seen.push(p.at); if (p && picture && picture.when(p.at)) { const name = picture.name; picture = null; await snap(name) } return p && done(p, seen) }, ms)
  return seen
}
const most = (seen, k) => Math.max(...seen.map((a) => a[k])), least = (seen, k) => Math.min(...seen.map((a) => a[k]))
const jumps = (seen) => { let j = 0; for (let i = 1; i < seen.length; i++) j = Math.max(j, Math.abs(seen[i][1] - seen[i - 1][1])); return j }

const ROOFER = `
on('start', (world) => { if (!world.people.some((p) => p.mine)) world.actor('rook', { name: 'Rook', at: [680, 4009], pace: 30 }) })
on('said', (world, e) => {
  const t = e.text, n = (name) => { const m = t.match(new RegExp(name + ' (-?[0-9.]+)')); return m ? Number(m[1]) : undefined }
  const to = t.match(/to (-?[0-9]+) (-?[0-9]+)(?: (-?[0-9]+))?/)
  const give = {}
  for (const k of ['jump', 'climb', 'fly', 'fall']) { if (n(k) !== undefined) give[k] = n(k); if (new RegExp('no ' + k).test(t)) give[k] = null }
  if (to) give.to = to[3] ? [Number(to[1]), Number(to[2]), Number(to[3])] : [Number(to[1]), Number(to[2])]
  if (/after me/.test(t)) { give.follow = e.by; give.keep = 12 }
  const kite = t.match(/kite up ([0-9]+)/)
  if (kite) world.actor('kite', { name: 'Kite', at: [760, 4025], fly: 60, to: [760, Number(kite[1]), 4025] })
  if (/after the kite/.test(t)) { give.follow = 'kite'; give.keep = 12 }
  if (/stay/.test(t)) give.follow = null
  if (Object.keys(give).length) world.actor('rook', give)
  if (/how are you/.test(t)) { const me = world.people.find((p) => p.mine); world.actor('rook', { say: 'Rook: ' + JSON.stringify({ can: me.can ?? null, aloft: !!me.aloft, stopped: me.stopped ?? '' }) }) }
})`
let browser
try {
  const page = out ? await (async () => { browser = await chrome(); const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage(); await p.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.6&hour=10.5&people=0&name=iris`); await p.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 }); await p.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 66.5, y: e.ground(70, 401) + 4.2, z: 408.6, yaw: 0.75, pitch: -0.08 }) }); await still(p); return p })() : null
  if (page) snap = (name) => page.screenshot({ path: join(out, name) })
  const wren = (await post('join', { by: 'wren', at: [740, 4020] })).you
  // Two sheds three metres high on the pavement, two metres apart.
  const y0 = Math.round(wren.at[1]) - 3, top = y0 + 33, sheds = []
  for (const x of [700, 750]) for (let y = y0; y < top; y++) for (let z = 4004; z < 4014; z++) sheds.push(x, x + 29, y, z, 8)
  check(!(await post('ask', { by: 'tester', edit: [1, sheds.length / 5, ...sheds], release: [740, top + 5, 4009] })).refused, 'two sheds are built')
  // The sheds are asked for and made a moment later: the rule is not put in until the far one is there.
  await until('the sheds stand', async () => (await send(`at?x=765&y=${top - 2}&z=4009`)).kind)
  await post('ask', { by: 'tester', rule: { id: 'roofer', name: 'A roofer between two sheds', source: ROOFER } })
  await until('the roofer is there', roofer)

  // As it is, an actor only walks: the roof is no place it can get to.
  await watched('Rook, to 715 4009', (p) => p.doing === 'standing' && true, 20_000)
  await wait(500)
  const below = await roofer()
  check(below.at[1] < top - 20 && below.at[0] < 700, `as it is, sent onto a roof three metres up, it stops in the street (at x ${below.at[0]}, ${top - below.at[1]} cells under the roof)`)

  // Given climb, it goes up the wall's face, a pace at a time.
  const up = await watched('Rook, climb 60 to 715 4009', (p) => p.doing === 'standing' && p.at[1] >= top - 1 && Math.hypot(p.at[0] - 715, p.at[2] - 4009) < 6, 25_000, { name: 'able-1-up-the-wall.png', when: (a) => a[1] > top - 17 && a[1] < top - 5 })
  check(jumps(up) < 12 && up.filter((a) => a[1] > below.at[1] + 4 && a[1] < top - 4).length >= 3, `given climb, it goes up the wall and stands on the roof; it was seen part of the way up ${up.filter((a) => a[1] > below.at[1] + 4 && a[1] < top - 4).length} times, never more than ${jumps(up)} cells between two looks`)

  // The next roof, two metres off: with climb alone it goes down and up again; given jump, it leaps.
  const over = await watched('Rook, no climb jump 30 to 765 4009', (p) => p.doing === 'standing' && Math.hypot(p.at[0] - 765, p.at[2] - 4009) < 6, 25_000, { name: 'able-2-over-the-gap.png', when: (a) => a[0] > 734 && a[0] < 746 })
  const inGap = over.filter((a) => a[0] > 731 && a[0] < 748)
  check(least(over, 1) >= top - 1 && inGap.length >= 1 && inGap.every((a) => a[1] >= top), `given jump, it leaps the two metres to the next roof: over the gap ${inGap.length} times seen, ${Math.round(most(over, 1) - top)} cells over the roofs at its highest, never under them`)

  // Given fly, it goes to a place in the air and stays.
  await watched(`Rook, no jump fly 60 to 715 ${top + 45} 4009`, (p) => p.doing === 'standing' && Math.hypot(p.at[0] - 715, p.at[1] - (top + 45), p.at[2] - 4009) < 3, 25_000, { name: 'able-3-flying.png', when: (a) => a[0] < 750 && a[1] > top + 12 })
  await wait(1200)
  const hangs = await roofer()
  await say('Rook, how are you?')
  const told = await until('it says how it is', () => heard(/^Rook: \{/))
  check(Math.abs(hangs.at[1] - (top + 45)) < 3 && /"aloft":true/.test(told) && /"fly":60/.test(told), `given fly, it goes to a place in the air over the roofs and stays there (${Math.round(hangs.at[1] - top)} cells over them; it reads ${told})`)
  await snap('able-4-in-the-air.png')

  // It follows a person through the air, over a shed that is in the way, and comes down to their height.
  await post('walk', { by: 'wren', to: [800, 4016] })
  const after = await watched('Rook, after me', (p, seen) => seen.length > 30 && p.doing === 'standing' && p.far < 22 && Math.abs(p.at[1] - wren.at[1]) < 8, 40_000)
  check(after.length > 0, `flying, it follows a person and comes to their height, ${Math.round((await roofer()).far)} cells off`)

  // Sent down onto where a person stands, it does not come down into them: it stays over them and says who.
  const her = (await until('she has stopped walking', async () => { const y = (await send('me?by=wren')).you; return y.walking ? null : y }, 30_000)).at
  await watched(`Rook, stay to ${Math.round(her[0])} ${Math.round(her[1]) + 50} ${Math.round(her[2])}`, (p) => p.doing === 'standing' && Math.hypot(p.at[0] - her[0], p.at[2] - her[2]) < 2 && p.at[1] > her[1] + 45)
  const onto = await watched(`Rook, to ${Math.round(her[0])} ${Math.round(her[2])}`, (p, seen) => seen.length > 15 && p.doing === 'standing' && p.at[1] < her[1] + 30)
  await say('Rook, how are you?')
  const overHer = await until('it says why it stopped', () => heard(/stopped over them/))
  check(least(onto, 1) >= her[1] + 17 && /wren is standing where you were going/.test(overHer), `sent down onto where a person stands, it stops over them, never lower than ${Math.round(least(onto, 1) - her[1])} cells over their feet, and says who`)

  // Someone who rises is followed up: another actor hangs eight metres over the street, and it goes up after it.
  await say(`kite up ${top + 80}`)
  const kite = await until('the kite is up', async () => { const k = (await around()).people.find((p) => p.name === 'Kite'); return k && k.at[1] > top + 77 && k })
  const rose = await watched('Rook, after the kite', (p) => p.doing === 'standing' && Math.hypot(p.at[0] - kite.at[0], p.at[1] - kite.at[1], p.at[2] - kite.at[2]) < 18, 30_000)
  const last = rose[rose.length - 1]
  check(last[1] > top + 60 && Math.hypot(last[0] - kite.at[0], last[2] - kite.at[2]) >= 5.5, `it follows one who is up in the air up to them: ${Math.round(Math.hypot(last[0] - kite.at[0], last[1] - kite.at[1], last[2] - kite.at[2]))} cells off, ${Math.round(last[1] - top)} over the roofs`)

  // Kept over a restart: what it can do, and where in the air it is.
  await say('Rook, stay to 760 ' + (top + 50) + ' 4009')
  await until('it is over the second shed', async () => { const p = await roofer(); return p && Math.hypot(p.at[0] - 760, p.at[1] - (top + 50)) < 3 })
  await wait(2600)
  server.stop(); await wait(600)
  server = await serve('/dev/null', ['--world', file])
  await post('join', { by: 'wren', at: [800, 4016] })
  const kept = await until('the roofer is back', roofer)
  await say('Rook, how are you?')
  const again = await until('it says how it is', () => heard(/^Rook: \{/))
  check(Math.abs(kept.at[1] - (top + 50)) < 3 && /"fly":60/.test(again), `started again, it still flies and hangs where it hung (${Math.round(kept.at[1] - top)} cells over the roofs)`)

  // No longer able to fly, it comes down onto what is under it, as slowly as fall says.
  const down = await watched('Rook, no fly fall 0.25', (p) => Math.abs(p.at[1] - top) < 1.5, 20_000)
  check(down.length >= 8 && jumps(down) < 14, `fly taken away, it comes down onto the roof under it; with a quarter of the world's pull that took ${down.length} looks, never more than ${jumps(down)} cells between two`)
  const bad = await post('ask', { by: 'tester', rule: { id: 'wrong', name: 'Asks too much', source: `on('start', (world) => { world.actor('x', {at: [690, 4020], climb: 'high', fly: 99999}) })` } })
  const x = await until('the other actor', async () => (await around()).people.find((p) => p.name === 'x'))
  const said = JSON.stringify((await send('rules')).find((r) => r.id === 'wrong'))
  check(!!x && /climb is a number/.test(said), 'a number that is no number is said to the rule; one past its range is cut to it')
  void bad
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser?.close()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('able: ok')
process.exit(0)
