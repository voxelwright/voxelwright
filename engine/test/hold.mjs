// Holding a thing (#264): a made thing is picked up, carried in the figure's hand, used, put down, given and taken
// by a rule, put down for whoever leaves, and found standing after a restart. The real server, world process and
// page; nothing stubbed; no model. The thing and the rule are no game's: a lantern, and someone who minds it.
//
//   node test/hold.mjs [--out picture.png]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-hold-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path)
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 8000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(120)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const heard = async (by) => (await get(`around?by=${by}&within=1200`)).heard.map((h) => h.text)
const thing = () => get('things?id=lantern')
const cell = async (x, y, z) => (await get(`at?x=${x}&y=${y}&z=${z}`)).kind
/** How someone's figure looks, as the stream last told it. */
const look = async (by) => {
  const r = await fetch(`${server.url}/world/stream?from=1000000`), reader = r.body.getReader()
  let held = Buffer.alloc(0), found
  for (const end = Date.now() + 2500; Date.now() < end && found === undefined;) {
    const got = await Promise.race([reader.read(), wait(300).then(() => null)])
    if (!got) continue
    held = Buffer.concat([held, got.value])
    for (let at = 0; held.length - at >= 12;) { const kind = held.readUInt32LE(at), size = held.readUInt32LE(at + 8); if (held.length - at < 12 + size) { held = held.subarray(at); break } if (kind === 5) { const who = JSON.parse(held.subarray(at + 12, at + 12 + size).toString()); if (who.by === by) found = who.look ?? null } at += 12 + size; if (held.length === at) held = Buffer.alloc(0) }
  }
  void reader.cancel()
  return found
}

// Someone who minds a lantern: says who has it, gives it when asked, takes it back when told, and knows when it is used.
const MINDER = `
on('start', (world) => { world.actor('minder', { name: 'Tomas', at: [690, 4009] }); world.offer('raise', { word: 'Raise it' }) })
on('held', (world, e) => world.actor('minder', { say: e.name + ' has ' + e.called + '.' }))
on('put', (world, e) => world.actor('minder', { say: e.called + ' is down at ' + e.at[0] + ', ' + e.at[2] + '.' }))
on('act', (world, e) => world.actor('minder', { say: e.using ? e.name + ' raises ' + e.using.name + '.' : e.name + ' raises an empty hand.' }))
on('said', (world, e) => {
  if (/hand it to me/i.test(e.text)) world.give(e.by, { thing: 'lantern' })
  if (/take it back/i.test(e.text)) world.take(e.by)
  if (/who holds/i.test(e.text)) world.actor('minder', { say: 'Holding: ' + world.people.filter((p) => p.holds).map((p) => p.name + ' ' + p.holds.thing).join(', ') })
})`
try {
  await post('join', { by: 'wren', at: [700, 4040] })
  await post('join', { by: 'robin', at: [716, 4040] })
  const me = (await get('me?by=wren')).you, feet = me.at[1]
  // A lantern of cells beside wren: a steel post two cells square and ten high, a lamp on top.
  const rows = []
  for (let y = 0; y < 12; y++) for (let z = 0; z < 2; z++) rows.push(705, 707, feet + y, 4039 + z, y < 10 ? 12 | (5 << 8) : 15)
  check((await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [706, feet + 14, 4040], thing: { id: 'lantern', name: 'a lantern', wish: 'a lantern', at: [706, feet, 4040], size: [2, 12, 2], facing: 'south' } })).asked, 'a thing is made')
  await until('the lantern stands', async () => (await cell(705, feet + 5, 4039)) !== 0)
  await post('ask', { by: 'tester', rule: { id: 'minder', name: 'Someone who minds a lantern', source: MINDER } })
  await until('the rule runs', async () => (await get('rules')).find((r) => r.id === 'minder')?.actors === 1)

  // Picked up: its cells leave the world, its record says who holds it, the figure carries it, the rule hears.
  check((await post('ask', { by: 'wren', hold: 'lantern' })).asked, 'it is picked up')
  await until('its cells are gone', async () => (await cell(705, feet + 5, 4039)) === 0 && (await cell(706, feet + 11, 4040)) === 0)
  check((await thing()).held === 'wren', 'picked up, its cells leave the world and its record says who holds it')
  const carried = await until('the figure carries it', async () => { const l = await look('wren'); return l?.carry?.length ? l.carry : null })
  const long = carried.reduce((n, b) => n + b.size[1], 0)
  check(carried.length >= 2 && carried.length <= 8 && carried.every((b) => b.on === 'handR' && /^#[0-9a-f]{6}$/.test(b.colour)) && Math.abs(long - 12) < 0.5, `the holder's figure carries it in the right hand: ${carried.length} boxes, ${long.toFixed(1)} cells long, ${carried[0].colour} to ${carried.at(-1).colour}`)
  await until('the rule hears it', async () => (await heard('robin')).includes('wren has a lantern.'))
  check(true, 'a rule hears who picked what up')
  const twice = await post('ask', { by: 'robin', hold: 'lantern' })
  check(twice.refused === 409, `a thing is one person's at a time (${twice.why})`)
  // Used: an act says what was in the hand.
  const eyes = [me.at[0] + 0.5, feet + 16.5, me.at[2] + 0.5]
  await post('act', { by: 'wren', rule: 'minder', id: 'raise', from: eyes, to: [0, 0, -1] })
  await until('the rule hears what was used', async () => (await heard('robin')).includes('wren raises a lantern.'))
  await post('act', { by: 'robin', rule: 'minder', id: 'raise', from: eyes, to: [0, 0, -1] })
  await until('and an empty hand', async () => (await heard('wren')).includes('robin raises an empty hand.'))
  check(true, 'an act tells the rule what was in the hand, and an empty hand is nothing')
  await post('say', { by: 'robin', text: 'who holds what?' })
  await until('people say what they hold', async () => (await heard('robin')).includes('Holding: wren lantern'))
  check(true, 'world.people says who holds what')

  // Put down somewhere else: it stands there, on the ground, whole; the hand is empty.
  check((await post('ask', { by: 'wren', put: true, at: [724, feet + 3, 4046] })).asked, 'it is put down')
  const stood = await until('it stands where it was put', async () => { const t = await thing(); return !t.held && t.at[0] !== 706 ? t : null })
  const base = await cell(stood.at[0], stood.at[1], stood.at[2]), top = await cell(stood.at[0], stood.at[1] + 11, stood.at[2]), under = await cell(stood.at[0], stood.at[1] - 1, stood.at[2])
  check(Math.abs(stood.at[0] - 724) <= 1 && Math.abs(stood.at[2] - 4046) <= 1 && (base & 15) === 12 && (top & 15) === 15 && under !== 0, `put down, it stands there on the ground, post and lamp (at ${stood.at}, steel ${base & 15}, lamp ${top & 15}, on ${under & 15})`)
  check((await look('wren')) === null || !(await look('wren'))?.carry, 'and the hand is empty')
  await until('the rule hears it put', async () => (await heard('robin')).some((t) => /^a lantern is down at 72\d, 404\d\.$/.test(t)))

  // A rule gives and takes.
  await post('say', { by: 'robin', text: 'hand it to me' })
  await until('given by a rule', async () => (await thing()).held === 'robin')
  check((await cell(stood.at[0], stood.at[1] + 5, stood.at[2])) === 0, 'a rule gives someone a thing: it is in their hand and out of the world')
  await post('say', { by: 'robin', text: 'take it back' })
  const back = await until('taken by a rule', async () => { const t = await thing(); return !t.held ? t : null })
  const rob = (await get('me?by=robin')).you
  check(Math.hypot(back.at[0] - rob.at[0], back.at[2] - rob.at[2]) <= 2, `a rule takes it: it is put down at their feet (${back.at} by ${rob.at})`)

  // Whoever leaves puts theirs down where they stood.
  await post('ask', { by: 'wren', hold: 'lantern' })
  await until('held again', async () => (await thing()).held === 'wren')
  await post('leave', { by: 'wren' })
  const left = await until('put down for one who left', async () => { const t = await thing(); return !t.held ? t : null })
  check(Math.hypot(left.at[0] - me.at[0], left.at[2] - me.at[2]) <= 2 && ((await cell(left.at[0], left.at[1] + 2, left.at[2])) & 15) === 12, `someone who leaves puts theirs down where they stood (${left.at})`)

  // Held when the world stops: it stands again where it was taken from when the world starts.
  await post('ask', { by: 'robin', hold: 'lantern' })
  await until('held at the stop', async () => (await thing()).held === 'robin')
  await wait(300)
  server.stop()
  await wait(500)
  server = await serve('/dev/null', ['--world', file])
  const again = await until('standing after a restart', async () => { const t = await thing(); return t && !t.refused && !t.held ? t : null }, 15_000)
  check(((await cell(again.at[0], again.at[1] + 2, again.at[2])) & 15) === 12 && Math.hypot(again.at[0] - left.at[0], again.at[2] - left.at[2]) <= 2, `held when the world stopped, it stands again where it was taken from (${again.at})`)

  // The page: near a made thing and looking at it, a key and a button pick it up; the same put it down where the eye looks.
  await post('join', { by: 'robin', at: [716, 4040] })
  const browser = await chrome()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    // A little south of the lantern, looking north and down at it.
    await page.goto(`${server.url}/city?fly=0&shared=1&name=Ada&scale=0.5&people=0&at=${(again.at[0] + 0.5) / 10},${(again.at[1] + 16) / 10},${(again.at[2] + 28) / 10}&look=0,-18`)
    await page.waitForFunction(() => globalThis.engine?.hands && globalThis.engine.things.all.size === 1, null, { timeout: 90_000 })
    await page.waitForFunction(() => globalThis.engine.hands.reach?.id === 'lantern', null, { timeout: 60_000 })
    const says = await page.evaluate(() => document.querySelector('[data-panel="offers"] button[data-own]')?.textContent)
    check(/G\s*Pick up a lantern/.test(says ?? ''), `looked at from near, a made thing can be picked up (${says})`)
    await page.keyboard.press('KeyG')
    await page.waitForFunction(() => globalThis.engine.hands.holding?.id === 'lantern', null, { timeout: 10_000 })
    const put = await page.evaluate(() => document.querySelector('[data-panel="offers"] button[data-own]')?.textContent)
    check(/Put down a lantern/.test(put ?? '') && (await thing()).held, `the key picks it up, and now says ${put}`)
    // Looking at the ground a little to the east, the button puts it there.
    await page.evaluate(() => { globalThis.engine.pose.yaw = 0.5; globalThis.engine.pose.pitch = -0.45 })
    await page.waitForTimeout(400)
    await page.click('[data-panel="offers"] button[data-own]')
    const laid = await until('put down from the page', async () => { const t = await thing(); return !t.held ? t : null })
    await page.waitForFunction(() => !globalThis.engine.hands.holding, null, { timeout: 10_000 })
    check(laid.at[0] > again.at[0] + 3 && ((await cell(laid.at[0], laid.at[1] + 2, laid.at[2])) & 15) === 12, `its button puts it down where the eye looks (${again.at} to ${laid.at})`)
    // Someone else holding it is seen holding it.
    await post('ask', { by: 'robin', hold: 'lantern' })
    await until('robin holds it', async () => (await thing()).held === 'robin')
    const robin = (await get('me?by=robin')).you
    await page.evaluate(([x, y, z]) => { const p = globalThis.engine.pose; p.x = (x + 0.5) / 10; p.y = (y + 13) / 10; p.z = (z + 24) / 10; p.yaw = 0; p.pitch = -0.12 }, robin.at)
    await page.waitForFunction(() => { const st = globalThis.engine.world.stats; return st.wanted === 0 && st.stale === 0 && st.ready > 0 }, null, { timeout: 120_000 }).catch(() => {})
    await page.waitForTimeout(1200)
    if (arg('out')) await page.screenshot({ path: arg('out') })
    await context.close()
  } finally { await browser.close() }
} catch (e) {
  check(false, `the check ran to its end (${e.message.split('\n')[0]})`)
}
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('hold: ok')
process.exit(0)
