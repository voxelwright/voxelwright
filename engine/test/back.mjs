// A page loaded again is the same person (#366): what a rule gave them (flight, a coat) and the thing in their hand
// are theirs still when the page is back, though it was silent for longer than a page is taken to be there. The real
// server, world process and page; no model. Another tab is someone else.
//
//   node test/back.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chrome, serve } from './kit.mjs'

const file = join(mkdtempSync(join(tmpdir(), 'engine-back-')), 'world.log')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const server = await serve('/dev/null', ['--world', file])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
const post = (path, body) => send(path, { method: 'POST', body: JSON.stringify(body) })
const until = async (what, ask, ms = 15_000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(150)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }

// Whoever says "powers" is given flight, a dark coat and the lantern; the rule counts how often each id was first seen.
const GIVER = `
on('said', (world, e) => { if (/powers/i.test(e.text)) { world.person(e.by, { fly: 90, look: { coat: '#15161a', wear: ['glasses'] } }); world.give(e.by, { thing: 'lantern' }) } })
on('tick', (world) => { const seen = world.keep.seen ??= {}; for (const p of world.people) if (p.kind === 'page') seen[p.id] = (seen[p.id] ?? 0) + 1; world.show('seen', { line: Object.keys(seen).length + ' people seen' }) })`
let browser
try {
  await post('join', { by: 'wren', at: [700, 4040] })
  const feet = (await send('me?by=wren')).you.at[1]
  const rows = []
  for (let y = 0; y < 12; y++) for (let z = 0; z < 2; z++) rows.push(705, 707, feet + y, 4039 + z, y < 10 ? 10 : 15)
  await post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [706, feet + 14, 4040], thing: { id: 'lantern', name: 'a lantern', wish: 'a lantern', at: [706, feet, 4040], size: [2, 12, 2], facing: 'south' } })
  await post('ask', { by: 'tester', rule: { id: 'giver', name: 'Someone who gives powers', source: GIVER } })
  browser = await chrome()
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } }), page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  const up = async (p) => { await p.waitForFunction(() => globalThis.engine?.hands && globalThis.engine.me?.on && globalThis.engine.me.feet, null, { timeout: 120_000 }) }
  const mine = (p) => p.evaluate(() => ({ id: sessionStorage.getItem('village.me'), fly: globalThis.engine.me.can.fly, coat: globalThis.engine.me.limbs?.look?.coat ?? null, holding: globalThis.engine.hands.holding?.id ?? null, carried: globalThis.engine.me.carry?.length ?? 0 }))
  await page.goto(`${server.url}/city?fly=0&walk=1&shared=1&name=Ada&scale=0.5&people=0&sound=0&at=70.6,${(feet + 16) / 10},405`)
  await up(page)
  // Said until heard: a page's first words within seconds of opening can be refused.
  await until('Ada is given her powers', async () => { await page.evaluate(() => globalThis.engine.say('powers please')); await wait(700); const m = await mine(page); return m.fly === 90 && m.holding === 'lantern' && m.coat })
  const before = await mine(page)
  check(before.fly === 90 && before.coat === '#15161a' && before.holding === 'lantern', `a rule gives someone flight, a coat and a thing (${JSON.stringify(before)})`)
  // The page is loaded again, and is silent meanwhile for longer than a page is taken to be there.
  await page.goto('about:blank')
  await wait(7000)
  check((await send('things?id=lantern')).held === before.id, 'while their page is gone, what they held is still theirs and out of the world')
  await page.goBack()
  await up(page)
  const after = await until('the powers are back', async () => { const m = await mine(page); return m.fly === 90 && m.holding === 'lantern' && m.coat ? m : null }).catch(() => mine(page))
  check(after.id === before.id, `a page loaded again is the same person (${before.id}, ${after.id})`)
  check(after.fly === 90, `flight a rule gave is theirs still (fly ${after.fly})`)
  check(after.coat === '#15161a', `and the coat it dressed them in (${after.coat})`)
  check(after.holding === 'lantern' && after.carried > 0, `and the thing is in their hand, carried by their figure (${after.holding}, ${after.carried} boxes)`)
  // Another tab of the same browser is someone else.
  const other = await context.newPage()
  await other.goto(`${server.url}/city?fly=0&walk=1&shared=1&name=Bea&scale=0.5&people=0&sound=0&at=71.6,${(feet + 16) / 10},405`)
  await up(other)
  const bea = await mine(other)
  check(bea.id && bea.id !== before.id && !bea.fly && !bea.holding, `another tab is someone else, with nothing of theirs (${JSON.stringify(bea)})`)
} catch (e) { check(false, `the check ran to its end (${e.message})`) } finally { await browser?.close(); server.stop() }
if (failures.length) { console.log('FAILED'); for (const f of failures) console.log(`  ${f}`); process.exit(1) }
console.log('back: ok')
process.exit(0)
