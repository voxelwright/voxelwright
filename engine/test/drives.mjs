// A rule drives a living thing (#245, for #264). A page brings a car to life in a shared world; a rule that is no
// game (a valet) is told of it in `world.things` by the id of its record, what it is and where, and drives it up
// the street when someone says so, stops it, turns it; someone who gets on from a page has it while they ride; and
// the rule taken out, it is let go. Real Chrome, the real server and world process, nothing stubbed.
//
//   node test/drives.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve, still } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-drives-')), 'world.log')
const browser = await chrome()
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const post = async (path, body) => (await fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) })).json().catch(() => ({}))
const rules = async () => (await fetch(`${server.url}/world/rules`)).json()
const open = async (name) => {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error (${name}): ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&people=0&name=${name}`)
  await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await still(page)
  return page
}
const car = (page) => page.evaluate(() => { const e = globalThis.engine, t = e.alive.things[0], w = t && e.alive.where(t); return w ? { at: w.at, front: w.front, up: 1 - 2 * (w.rot[0] ** 2 + w.rot[2] ** 2), ref: t.ref, bodies: e.bodies } : null })
const asleep = (page) => page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.things.length === 1 && globalThis.engine.alive.where(globalThis.engine.alive.things[0]), null, { timeout: 30_000 })
// The valet: says what it is told of (as the name over someone standing by), and drives the first thing as it is asked.
const RULE = `on('start', (world) => world.actor('valet', {name: 'Valet', at: [700, 4009]}))
on('tick', (world) => { const t = world.things[0]; world.actor('valet', {say: t ? [t.id, t.name, t.scheme, t.at.join(' '), t.speed, t.mine ? 'mine' : 'free', t.upright ? 'up' : 'over'].join('|') : 'nothing'}) })
on('said', (world, e) => {
  const t = world.things[0]
  if (!t) return
  if (/bring it/.test(e.text)) world.drive(t.id, {go: 1})
  if (/round/.test(e.text)) world.drive(t.id, {turn: 1})
  if (/hold/.test(e.text)) world.drive(t.id, {go: 0, turn: 0})
  if (/leave it/.test(e.text)) world.drive(t.id, null)
  if (/ghost/.test(e.text)) world.drive('no-such-thing', {go: 1})
})`
try {
  const ada = await open('Ada')
  const made = await ada.evaluate(async () => { const e = globalThis.engine, x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10); const thing = await e.alive.spawn(e.car([x, ground + 5, z])); return { ref: thing.ref } })
  await asleep(ada)
  const parked = await car(ada)
  check((await post('ask', { by: 'tester', rule: { id: 'valet', name: 'A valet', source: RULE } })).asked, 'a rule that drives is taken')
  let heardTo = 0
  const valet = async (ok) => { let text = ''; for (let i = 0; i < 40; i++) { const a = await (await fetch(`${server.url}/world/around?by=watcher&since=${heardTo}`)).json(); for (const h of a.heard ?? []) { text = h.text; heardTo = Math.max(heardTo, h.n) } if (text && ok(text.split('|'))) return text.split('|'); await ada.waitForTimeout(250) } console.log('  the valet last said', text); return null }
  await post('join', { by: 'watcher', at: [700, 4020] })
  const first = await valet((t) => t[0] === made.ref)
  check(!!first && first[2] === 'drive' && first[5] === 'free' && first[6] === 'up' && Math.hypot(Number(first[3].split(' ')[0]) - parked.at[0], Number(first[3].split(' ')[2]) - parked.at[2]) < 3, `the rule is told of the car in world.things: its record's id (${first?.[0]}), what it is ("${first?.[1]}"), how it is driven (${first?.[2]}), where (${first?.[3]}), upright`)
  // Driven by the rule: nobody rides it, and it goes on going, though the rule said so once.
  await ada.evaluate(() => globalThis.engine.say('bring it'))
  await ada.waitForTimeout(1500)
  const going = await car(ada), went = Math.hypot(going.at[0] - parked.at[0], going.at[2] - parked.at[2])
  const mine = await valet((t) => t[5] === 'mine' && Number(t[4]) > 20)
  check(went > 30 && !(await ada.evaluate(() => !!globalThis.engine.alive.riding)) && !!mine, `said "bring it", the rule drives it: ${(went / 10).toFixed(1)} m up the street in a second and a half with nobody on it, and world.things says it is the rule's and going at ${mine?.[4]} cells a second`)
  await ada.evaluate(() => globalThis.engine.say('hold'))
  await ada.waitForTimeout(800)
  await asleep(ada)
  const held = await car(ada)
  check(held.bodies === 0, 'said "hold", it stops and sleeps')
  // Someone gets on from a page: it is theirs while they ride, whatever the rule asks.
  await ada.evaluate(() => globalThis.engine.say('bring it'))
  await ada.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); e.pose.x = w.at[0] / 10 - 2.5; e.pose.y = w.at[1] / 10 + 1.5; e.pose.z = w.at[2] / 10 + 4.5 })
  await ada.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 })
  await ada.keyboard.press('KeyE')
  await ada.keyboard.down('KeyS')
  await ada.waitForTimeout(700)
  const from = await car(ada)
  await ada.waitForTimeout(1500)
  const backed = await car(ada)
  await ada.keyboard.up('KeyS')
  const back = (from.at[0] - backed.at[0]) * from.front[0] + (from.at[2] - backed.at[2]) * from.front[2]
  check(back > 10, `someone who gets on and holds S has it, though the rule says forward: it backs ${(back / 10).toFixed(1)} m`)
  // Off again, the rule's word holds again.
  await ada.keyboard.press('KeyE')
  await ada.waitForTimeout(1800)
  const left = await car(ada)
  await ada.waitForTimeout(1500)
  const again = await car(ada)
  const on = (again.at[0] - left.at[0]) * left.front[0] + (again.at[2] - left.at[2]) * left.front[2]
  check(on > 20, `off again, the rule's word holds once more: it goes forward ${(on / 10).toFixed(1)} m`)
  await ada.evaluate(() => globalThis.engine.say('hold'))
  // What is not a living thing is refused, and the rule is told.
  await ada.evaluate(() => globalThis.engine.say('ghost'))
  await ada.waitForTimeout(1200)
  check(/world.drive is for a living thing/.test(JSON.stringify((await rules()).find((r) => r.id === 'valet'))), 'a thing there is not is refused, and the rule is told why')
  // The rule taken out, the car is let go: it stops and sleeps.
  await post('ask', { by: 'tester', unrule: 'valet' })
  await asleep(ada)
  check((await car(ada)).bodies === 0, 'the rule taken out, the car is let go: it stops and sleeps')
} catch (e) { failures.push(String(e.stack ?? e)) }
await browser.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('drives: ok')
process.exit(0)
