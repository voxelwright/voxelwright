// Residents a rule can take (#218, for #264): the ordinary people of a place become a rule's own when it asks.
// The real server and the real world process, and two pages in Chrome. The rule is no game: someone passing stops
// when a person says "excuse me", answers, and goes back to their round when thanked. What is checked: a rule is
// told of the residents near people by ids that stay the same; the one taken stands where they stood and is the
// same figure on every page, one that joins later too; let go, they walk back and are a resident again; and a
// rule's actors and what it keeps are there when the world is started again.
//
//   node test/taken.mjs [--out directory]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, serve, still } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-taken-')), 'world.log'), out = arg('out', '')
if (out) mkdirSync(out, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
let server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path)
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 8000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const how = async (id) => (await get('rules')).find((r) => r.id === id)
const around = () => get('around?by=wren&within=400')
const heard = async (match) => (await around()).heard.map((h) => h.text).find((t) => match.test(t))

const PASSING = `
on('tick', (world) => {
  // Whether the people it was told of half a second ago are the same people now.
  const k = world.keep, ids = world.residents.map((r) => r.id)
  if (k.ids) { k.same = ids.filter((id) => k.ids.includes(id)).length; k.of = Math.min(ids.length, k.ids.length) }
  k.ids = ids
})
on('said', (world, e) => {
  const k = world.keep, mine = world.people.filter((p) => p.mine)
  if (/excuse me/i.test(e.text)) {
    const r = world.residents.slice().sort((a, b) => Math.hypot(a.at[0] - e.at[0], a.at[2] - e.at[2]) - Math.hypot(b.at[0] - e.at[0], b.at[2] - e.at[2]))[0]
    if (!r) return
    k.stopped = (k.stopped || 0) + 1
    k.look = r.look
    world.actor('passer-' + k.stopped, { take: r.id, name: 'Someone passing', face: e.at, say: 'Yes? I was at ' + r.at[0] + ',' + r.at[2] + '; ' + k.same + ' of ' + k.of + ' round here are who they were.' })
  }
  if (/thank/i.test(e.text)) for (const p of mine) world.gone(p.id)
  // What they look like is theirs to read: the same person with glasses on, with no name, and in their own clothes again.
  if (/glasses/i.test(e.text) && mine[0]) world.actor(mine[0].id, { name: null, look: { ...mine[0].look, wear: [...mine[0].look.wear, 'glasses'] }, say: 'coat ' + mine[0].look.coat + ' as it was: ' + (mine[0].look.coat === k.look.coat) + '; asked by ' + (world.them && world.them.id === e.by && world.them.person) + ' ' + world.who(e.by).name })
  if (/as you were/i.test(e.text) && mine[0]) world.actor(mine[0].id, { look: null, name: 'Someone passing' })
  if (/how many/i.test(e.text) && mine[0]) world.actor(mine[0].id, { say: 'I am number ' + k.stopped + '.' })
  if (/twice/i.test(e.text) && mine[0]) { world.actor('second', { take: mine[0].was }); world.actor('third', { take: 'r0' }) }
})`
let browser
try {
  await post('join', { by: 'wren', at: [700, 4011] })
  const before = await around()
  check(before.residents.near > 3, `${before.residents.near} residents are near someone standing on the pavement`)
  await post('ask', { by: 'tester', rule: { id: 'passing', name: 'Someone passing stops to help', source: PASSING } })
  await until('the rule has heard two ticks', async () => (await how('passing'))?.calls >= 3)

  browser = await chrome()
  const open = async (name) => {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
    page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
    await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.5&hour=12&name=${name}`)
    await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
    return page
  }
  /** Everyone a page draws this frame: residents and bodies alike. */
  const drawn = (page) => page.evaluate(() => { const e = globalThis.engine; return e.folk.from.flatMap((f) => f(e.view(), 0)).map((p) => ({ seed: p.seed, name: p.name ?? '', at: [...p.at], yaw: p.yaw })) })
  const a = await open('iris')
  await a.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 70, y: e.ground(70, 404.6) + 3.2, z: 404.6, yaw: 0, pitch: -0.3 }) })
  await still(a)
  const town = await drawn(a)
  if (out) await a.screenshot({ path: join(out, 'taken-0-before.png') })

  await post('say', { by: 'wren', text: 'Excuse me!' })
  const yes = await until('someone stops', () => heard(/^Yes\?/))
  const [, x, z, same, of] = /at (-?\d+),(-?\d+); (\d+) of (\d+)/.exec(yes).map(Number)
  // How many are near goes by the clock (the rounds are real time): at least the one taken, and all but a couple of them the same.
  check(of >= 1 && same >= Math.max(1, of - 2), `the rule is told of the residents near people by ids that stay the same: ${same} of ${of} were who they were half a second before`)
  const stopped = (await around()).people.find((p) => p.name === 'Someone passing')
  check(stopped && Math.hypot(stopped.at[0] - x, stopped.at[2] - z) < 12 && stopped.doing === 'standing', `the one nearest stops and answers, standing where they walked (${stopped?.at} against ${x}, ${z})`)
  const round = await around(), them = round.people.find((p) => p.name === 'Someone passing')
  check(!round.residents.nearest.some((r) => Math.abs(r.far - them.far) <= 2 && r.towards === them.towards), 'and is no longer one of the residents round there')
  // On the page: one figure of that number, with a name over it now, and it did not jump.
  const taken = await until('the page has the actor', async () => { const all = await drawn(a); const them = all.filter((p) => p.name === 'Someone passing'); return them.length ? { them, all } : null })
  const seed = taken.them[0].seed, wasThere = town.find((p) => p.seed === seed)
  check(taken.all.filter((p) => p.seed === seed).length === 1 && (await a.evaluate(() => globalThis.engine.takenOff.size)) === 1, 'a page draws them once: the actor, and not the resident they were as well')
  check(wasThere && Math.hypot(taken.them[0].at[0] - x, taken.them[0].at[2] - z) < 12, `it is the same figure the page was drawing (the same number for its looks), where the resident was`)
  if (out) { await a.waitForTimeout(600); await a.screenshot({ path: join(out, 'taken-1-stopped.png') }) }

  // A rule reads what a resident looks like, adds to it, shows no name, and gives the clothes back.
  await post('say', { by: 'wren', text: 'put your glasses on' })
  const read = await until('it says what it read', () => heard(/^coat #/)).catch(async (e) => { throw new Error(`${e.message}: ${(await how('passing')).error}; heard ${(await around()).heard.map((h) => h.text).join(' | ')}`) })
  check(/^coat #[0-9a-f]{6} as it was: true; asked by true wren$/.test(read), `a rule reads what a resident looks like, taken or not, and knows who asked (${read})`)
  const worn = await until('the page has the glasses', async () => (await a.evaluate((seed) => { const e = globalThis.engine, p = e.folk.from.flatMap((f) => f(e.view(), 0)).find((p) => p.seed === seed); return p?.look?.wear?.includes('glasses') ? { name: p.name, coat: p.look.coat } : null }, seed)))
  check(worn.name === '' && read.includes(worn.coat), 'the page draws the same person with glasses on, and no name over their head')
  if (out) { await a.waitForTimeout(500); await a.screenshot({ path: join(out, 'taken-1b-glasses-no-name.png') }) }
  await post('say', { by: 'wren', text: 'as you were' })
  await until('its own clothes again', async () => a.evaluate((seed) => { const e = globalThis.engine, p = e.folk.from.flatMap((f) => f(e.view(), 0)).find((p) => p.seed === seed); return p && !p.look && p.name === 'Someone passing' }, seed))
  check(true, 'told to, it is in its own clothes again while still held, with its name back')

  // A page that joins later sees the same.
  const b = await open('june')
  const late = await until('the late page has the actor', async () => { const all = await drawn(b); return all.some((p) => p.name === 'Someone passing') ? all : null }, 15_000)
  check(late.filter((p) => p.seed === seed).length === 1, 'a page that joins later draws them once too')
  await b.context().close()

  // Refusals: a resident is one rule's at a time, and one nobody was told of cannot be taken.
  await post('say', { by: 'wren', text: 'twice' })
  await until('the rule is told what it got wrong', async () => /is somebody's actor already|no resident/.test((await how('passing'))?.error ?? ''))
  check((await how('passing')).actors === 1, `a resident already taken, and one nobody was told of, are not taken (${(await how('passing')).error})`)

  // The world started again: the actor is where it stood, still that resident, and the rule remembers.
  await wait(2500)
  server.stop()
  await wait(400)
  server = await serve('/dev/null', ['--world', file])
  await post('join', { by: 'wren', at: [700, 4011] })
  await until('the rule is back with its actor', async () => (await how('passing'))?.actors === 1)
  const back = (await around()).people.find((p) => p.name === 'Someone passing')
  check(back && Math.hypot(back.at[0] - stopped.at[0], back.at[2] - stopped.at[2]) < 2, `started again, the world has the rule's actor where it stood (${back?.at})`)
  await post('say', { by: 'wren', text: 'how many?' })
  check(await until('it remembers', () => heard(/^I am number 1\.$/)), 'and the rule has what it kept')
  await a.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.5&hour=12&name=iris`)
  await a.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
  await a.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { x: 70, y: e.ground(70, 404.6) + 3.2, z: 404.6, yaw: 0, pitch: -0.3 }) })
  await until('the page has it again', async () => (await drawn(a)).some((p) => p.name === 'Someone passing'), 15_000)
  check((await drawn(a)).filter((p) => p.seed === seed).length === 1, 'still that resident, drawn once')

  // Let go: it walks back to where its round has got to, and is a resident again.
  await post('say', { by: 'wren', text: 'Thank you' })
  await until('it is on its way back', async () => !(await around()).people.some((p) => p.name === 'Someone passing'))
  if (out) { await a.waitForTimeout(1500); await a.screenshot({ path: join(out, 'taken-2-going-back.png') }) }
  await until('it is a resident again', async () => (await a.evaluate(() => globalThis.engine.takenOff.size)) === 0, 60_000)
  const after = await drawn(a)
  check(after.filter((p) => p.seed === seed).length === 1 && after.find((p) => p.seed === seed).name === '' && (await how('passing')).actors === 0, 'thanked, they walk back to their round and are a resident again, drawn once, with no name')

  // A rule taken out lets its people go.
  await post('say', { by: 'wren', text: 'Excuse me!' })
  await until('someone stops again', async () => (await how('passing'))?.actors === 1)
  await post('ask', { by: 'tester', unrule: 'passing' })
  await until('they are let go', async () => (await a.evaluate(() => globalThis.engine.takenOff.size)) === 0, 60_000)
  check(true, 'a rule taken out lets the residents it held go back to their rounds')
} catch (e) {
  failures.push(String(e.stack ?? e))
}
await browser?.close().catch(() => {})
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('taken: ok')
process.exit(0)
