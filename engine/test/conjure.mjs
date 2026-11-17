// A conjured thing arrives in the hand (#264): a rule hears someone ask for a thing, has it made for them with
// `world.make({wish, for, hold: true})`, and they are holding it: its cells are out of the world, their figure
// carries it, and the rule hears `held` with the thing's id. The real server, world process, helper and page.
//
// NO MODEL IS RUN HERE: a reply kept in this file stands in for one. That a real model's thing is held the same
// way is proved by a real run (the PR says which).
//
//   node test/conjure.mjs [--out picture.png]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { arg, chrome, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-conjure-')), server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const get = (path) => send(path), post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 20_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }
const heard = async () => (await get('around?by=wren&within=1200')).heard.map((h) => h.text)

// A thing as a model answers: a short sword standing on its point. It is asked for as a dirk: a sword for the hand
// comes with the engine (make/kept), and what is kept is made at once with no model asked (#220), so "a sword" would
// not reach this check's model.
const SWORD = { name: 'short sword', size: [5, 12, 1], parts: [['box', 'steel', 'own', 2, 0, 0, 3, 8, 1], ['box', 'steel', '3:5', 0, 8, 0, 5, 9, 1], ['box', 'wood', 'own', 2, 9, 0, 3, 12, 1]] }
let asked = 0
const model = async () => { asked++; return { text: JSON.stringify(SWORD), model: 'a kept reply', ms: 0, cost: 0 } }
const h = await helper({ world: server.url, port: 0, model, journal: join(dir, 'made.jsonl'), kept: join(dir, 'library') })
// An armourer, not a game: whoever asks for a thing by name is handed one, and the armourer says what they hold.
const ARMOURER = `
on('start', (world) => world.actor('armourer', { name: 'Hilde', at: [690, 4009] }))
on('said', (world, e) => { const m = /^(?:a|an|some) (.+)$/i.exec(e.text.trim()); if (m) world.make({ wish: 'a ' + m[1], for: e.by, hold: true }) })
on('held', (world, e) => world.actor('armourer', { say: e.name + ' holds ' + e.called + ' (' + e.thing + ').' }))`
const browser = await chrome()
try {
  await post('join', { by: 'wren', at: [700, 4040] })
  await post('ask', { by: 'tester', rule: { id: 'armourer', name: 'An armourer', source: ARMOURER } })
  await until('the rule runs', async () => (await get('rules')).find((r) => r.id === 'armourer')?.actors === 1)
  const guide = await (await fetch(`${server.url}/world/`)).text()
  check(guide.includes('world.make({wish, for, at, hold})') && !guide.includes('cannot yet be put in a hand'), 'the guide says a made thing can be put in a hand')
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&name=Ada&scale=0.5&people=0&at=70.05,17.4,402.8&look=0,-10${new URL(h.link).hash}`)
  await page.waitForFunction(() => globalThis.engine?.hands && globalThis.engine.asker?.known, null, { timeout: 90_000 })
  await page.waitForFunction(() => globalThis.engine.others >= 1, null, { timeout: 20_000 })
  // A page's first words can come before the world has its body (refused, 409): said until the page shows it heard.
  for (let i = 0; i < 8 && !(await page.evaluate(() => /a dirk/.test(document.querySelector('#said')?.textContent ?? ''))); i++) { await page.evaluate(() => globalThis.engine.say('a dirk')); await wait(1500) }
  const held = await until('the sword is in the hand', async () => { const all = await get('things'); const t = (Array.isArray(all) ? all : all.things ?? []).find((x) => x.held); return t ?? null }, 60_000)
  check(asked === 1 && /sword/.test(held.name), `said "a dirk", a thing is made for the one who said it, by their own helper (${held.name}, asked ${asked} time)`)
  await page.waitForFunction(() => globalThis.engine.hands.holding, null, { timeout: 10_000 })
  const mine = await page.evaluate(() => ({ id: globalThis.engine.hands.holding.id, name: globalThis.engine.hands.holding.name, says: document.querySelector('[data-panel="offers"] button[data-own]')?.textContent }))
  check(mine.id === held.id && /Put down short sword/.test(mine.says ?? ''), `and they are holding it: their page says so (${mine.says})`)
  const cells = await get(`things?id=${held.id}`)
  const mid = await get(`at?x=${cells.at[0]}&y=${cells.at[1] + 3}&z=${cells.at[2]}`)
  check(mid.kind === 0, 'its cells are out of the world')
  await until('the rule hears it held', async () => (await heard()).some((t) => t === `Ada holds short sword (${held.id}).`))
  check(true, `the rule that asked hears held, with the thing's id (${(await heard()).at(-1)})`)
  const people = await page.evaluate(() => globalThis.engine.hands.holding && true)
  check(people, 'a hand holds it until it is put down')
  // Asked again with the hand full: the first is put down and the second is held.
  await page.evaluate(() => globalThis.engine.say('a dirk'))
  await until('a second is held and the first stands', async () => { const all = await get('things'); const list = Array.isArray(all) ? all : all.things ?? []; return list.length === 2 && list.filter((x) => x.held).length === 1 && list.find((x) => x.held).id !== held.id }, 40_000).catch(async (e) => { console.log('   things:', JSON.stringify(await get('things')).slice(0, 600), 'asked', asked, (await heard()).slice(-3)); throw e })
  check(true, 'asked again with a full hand, the first is put down and the new one held')
  if (arg('out')) { await page.waitForFunction(() => { const st = globalThis.engine.world.stats; return st.wanted === 0 && st.stale === 0 && st.ready > 0 }, null, { timeout: 120_000 }).catch(() => {}); await page.waitForTimeout(600); await page.screenshot({ path: arg('out') }) }
  await context.close()
} catch (e) {
  check(false, `the check ran to its end (${e.message.split('\n')[0]})`)
}
await browser.close()
await h.close?.()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('conjure: ok (a kept reply stood in for the model: no model was run)')
process.exit(0)
