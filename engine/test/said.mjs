// Say, make or cast (#220): what the ask bar reads while words are typed is what Enter then does. The real page in
// Chrome, in a shared world of its own, with the helper and what comes with the engine (make/kept/); in a world with
// no rules and in one with a rule, with the wand in hand and without, aimed at open ground and aimed where a kept
// thing has no place (open water to the west: no ground near), and aimed at made things: the asker's own, another's, the realm's. Each case types the words, lets the label settle, reads it,
// presses Enter and sees what was done: said to whoever is there, sent to the helper to be made, or cast.
// NO MODEL IS RUN: the helper's model is a stand-in that counts. Not covered: Enter pressed before the label has
// had the world's and the helper's answers (a few tens of milliseconds after a key).
//
//   node test/said.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { chrome, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-said-'))
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
let asked = 0
const h = await helper({ world: server.url, port: 0, model: async () => { asked++; throw new Error('no model is run here') }, journal: join(dir, 'made.jsonl'), kept: join(dir, 'shelf') })
await h.warm
const browser = await chrome()
/**
 * Words of each kind: a thing with its article, a plain word naming a kept thing, plain words naming nothing kept,
 * talk, a spell, words that point at a thing to be driven (#245: aimed here at no made thing, so read as any words
 * are; aimed at made things below), and words of driving and riding that do not point at it, which go where they always went.
 */
const POINTING = ['make it drivable', 'let me drive it', 'make this driveable']
const NOT_POINTING = ['make it alive', 'make the dragon alive', 'make the tree alive', 'ride that wave', 'drive it off the cliff', 'let me drive it home', 'can I ride the horse', 'let me ride the horse']
const WORDS = ['a car', 'car', 'sword', 'open sesame', 'hello there', 'fireball', ...POINTING, ...NOT_POINTING]
/** Where the eye is: on the main street, and over open water to the west where no ground near takes the car. (A hillside far to the west was the place until the car of make/kept/ came alive, November 16: its body stands level on a slope where its cells did not.) */
const PLACES = { ground: 'at=70,17.2,412&look=0,-25', 'no place': 'at=-300,19.4,-90&look=0,-89' }
const rows = []
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  // Sent to be made (`/ask`), or for a rule to be written (`/rule`): both are the bar's Make.
  let sent = 0, ruled = 0, placed = null
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().startsWith(h.url) && new URL(r.url()).pathname === '/ask') sent++; if (r.method() === 'POST' && r.url().startsWith(h.url) && new URL(r.url()).pathname === '/rule') ruled++ })
  page.on('response', (r) => { if (r.request().method() === 'POST' && r.url().startsWith(h.url) && new URL(r.url()).pathname === '/kept') void r.json().then((j) => { if (j.id) placed = !!j.at }, () => {}) })
  const open = async (place) => {
    await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Ada&${PLACES[place]}${new URL(h.link).hash}`)
    await page.waitForFunction(() => globalThis.engine?.kept && engine.asker.known && engine.hud.line.onsubmit, null, { timeout: 90_000 })
    await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
    // What Enter does, as it does it: said on the line to whoever is there, or a spell cast. What is sent to be made is counted above.
    await page.evaluate(() => {
      const e = globalThis.engine, say = e.hud.line.onsubmit, cast = e.wand.cast.bind(e.wand)
      globalThis.__did = []
      e.hud.line.onsubmit = (t) => { globalThis.__did.push('Say'); say(t) }
      e.wand.cast = () => { globalThis.__did.push('Cast'); cast() }
    })
  }
  const run = async (rules, place) => {
    for (const wand of [false, true]) {
      await page.evaluate((w) => { globalThis.engine.wand.held = w }, wand)
      for (const words of WORDS) {
        placed = null
        await page.keyboard.press('Enter')
        await page.keyboard.type(words, { delay: 40 })
        await page.waitForTimeout(1500)
        const label = await page.evaluate(() => { const b = document.querySelector('#ask-which'); return b && !b.hidden ? b.textContent : null })
        const was = sent, wasRuled = ruled, models = asked
        await page.evaluate(() => { globalThis.__did = [] })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(700)
        await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 20_000 }).catch(() => {})
        const did = [...(await page.evaluate(() => globalThis.__did)), ...(sent > was || ruled > wasRuled ? ['Make'] : [])]
        rows.push({ rules, place, wand, words, label, did: did.join('+') || 'nothing', placed, to: sent > was ? 'ask' : ruled > wasRuled ? 'rule' : '', model: asked > models })
        check(label !== null && did.length === 1 && did[0] === label, `${rules ? 'rules' : 'no rules'}, ${place}, ${wand ? 'wand in hand' : 'no wand'}: "${words}" reads ${label ?? '(no label)'}, Enter ${did.join(' and ') || 'did nothing'}`)
        await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 20_000 }).catch(() => {})
      }
    }
  }
  await open('ground'); await run(false, 'ground')
  await open('no place'); await run(false, 'no place')
  // A rule: someone there to hear what is said.
  await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'tester', rule: { id: 'listener', name: 'listener', source: "on('said', () => {})" } }) })
  for (let i = 0; i < 50 && !(await (await fetch(`${server.url}/world/rules`)).json()).some((r) => r.running); i++) await new Promise((r) => setTimeout(r, 100))
  await run(true, 'no place')
  await open('ground'); await run(true, 'ground')
  // The label is worked out again whenever what Enter would do can change, from the text Enter would send (with a
  // rule, aimed at ground, no wand): Tab pressed after typing, a picture given after typing, an address among words.
  await page.evaluate(() => { globalThis.engine.wand.held = false })
  const turned = async (name, steps) => {
    await page.keyboard.press('Enter')
    await steps()
    await page.waitForTimeout(1500)
    const label = await page.evaluate(() => { const b = document.querySelector('#ask-which'); return b && !b.hidden ? b.textContent : null })
    const was = sent
    await page.evaluate(() => { globalThis.__did = [] })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    const did = [...(await page.evaluate(() => globalThis.__did)), ...(sent > was ? ['Make'] : [])]
    check(label !== null && did.length === 1 && did[0] === label, `${name}: reads ${label ?? '(no label)'}, Enter ${did.join(' and ') || 'did nothing'}`)
    await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 20_000 }).catch(() => {})
  }
  await turned('Tab to Say, "open sesame" typed, Tab again', async () => { await page.keyboard.press('Tab'); await page.keyboard.type('open sesame', { delay: 40 }); await page.keyboard.press('Tab') })
  await turned('"dragon" typed, then a picture given', async () => {
    await page.keyboard.type('dragon', { delay: 40 })
    await page.waitForTimeout(800)
    // A made-up picture of 8 by 8, given as a paste or a drop gives it.
    await page.evaluate(async () => { const c = new OffscreenCanvas(8, 8), g = c.getContext('2d'); g.fillStyle = '#c04020'; g.fillRect(0, 0, 8, 8); await globalThis.engine.hud.line.give(await c.convertToBlob({ type: 'image/png' })) })
  })
  await turned('words with an address among them', async () => { await page.keyboard.type(`dragon ${server.url}/nothing-here.png`, { delay: 10 }) })
  // Words that point at a thing, aimed at a made thing (#245): the asker's own (Ada's, not alive) is brought to life by
  // the helper with no model; the realm's own (brought by a rule: 'the world') and another person's are not hers to
  // change, so the words do what they did before: with a rule here, said to the realm. Each stands where the eye meets
  // the ground, in turn.
  // (What the cases above made, the living saloon among them, is taken out first: the eye meets the nearest thing.)
  for (const t of await fetch(`${server.url}/world/things`).then((r) => r.json())) await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: t.by, gone: t.id, ...(t.controls ? {} : { release: [t.at[0], t.at[1] + 2, t.at[2]] }), wait: true }) })
  await page.waitForTimeout(1500)
  const meets = await page.evaluate(() => { const v = engine.view(); for (let d = 1; d < 4000; d += 0.5) { const p = v.eye.map((e, a) => e + v.forward[a] * d); if (engine.kind(p[0], p[1], p[2])) return p.map(Math.floor) } return null })
  const aimedAt = async (by, words) => {
    const id = `said-${by.replace(/\W/g, '').toLowerCase()}-${Date.now().toString(36)}`, [x, y, z] = meets, rows = []
    for (let yy = y + 1; yy < y + 9; yy++) for (let zz = z - 5; zz < z + 5; zz++) rows.push(x - 5, x + 5, yy, zz, 12)
    const put = await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by, edit: [1, rows.length / 5, ...rows], release: [x - 7, y + 2, z], thing: { id, name: 'grey test crate', wish: 'a grey test crate', at: [x, y + 1, z], size: [10, 8, 10], facing: 'south' }, wait: true }) })
    await page.waitForTimeout(800)
    const out = []
    for (const w of words) {
      await page.keyboard.press('Enter')
      await page.keyboard.type(w, { delay: 40 })
      await page.waitForTimeout(1500)
      const label = await page.evaluate(() => { const b = document.querySelector('#ask-which'); return b && !b.hidden ? b.textContent : null })
      const was = sent, models = asked
      await page.evaluate(() => { globalThis.__did = [] })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(700)
      await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 20_000 }).catch(() => {})
      const did = [...(await page.evaluate(() => globalThis.__did)), ...(sent > was ? ['Make'] : [])]
      // (Brought to life, it is a new thing in its place, under an id of its own.)
      const here_ = (await fetch(`${server.url}/world/things`).then((r) => r.json())).filter((t) => Math.hypot(t.at[0] - x, t.at[2] - z) <= 3)
      out.push({ words: w, label, did: did.join('+') || 'nothing', model: asked > models, alive: here_.some((t) => t.controls), one: here_.length === 1 })
    }
    for (const t of (await fetch(`${server.url}/world/things`).then((r) => r.json())).filter((t) => Math.hypot(t.at[0] - x, t.at[2] - z) <= 3)) await fetch(`${server.url}/world/ask`, { method: 'POST', body: JSON.stringify({ by: t.by, gone: t.id, ...(t.controls ? {} : { release: [x - 7, y + 2, z] }), wait: true }) })
    await page.waitForTimeout(500)
    return { put: put.status, out }
  }
  const POINT_AT = ['let me ride it', 'can I ride it?', 'make it drivable']
  for (const [whose, by] of [["the realm's own", 'the world'], ["Tomas's", 'Tomas']]) {
    const r = await aimedAt(by, POINT_AT)
    for (const o of r.out) check(r.put === 202 && o.label === 'Say' && o.did === 'Say' && !o.alive, `aimed at ${whose} crate, "${o.words}" reads ${o.label} and Enter said it to the realm (${o.did}); the crate does not live (${o.alive})`)
  }
  {
    const r = await aimedAt('Ada', ['make it drivable'])
    for (const o of r.out) check(r.put === 202 && o.label === 'Make' && o.did === 'Make' && !o.model && o.alive && o.one, `aimed at Ada's own crate, "${o.words}" reads ${o.label}, Enter sent it to the helper (${o.did}), no model was asked (${!o.model}), and one crate stands there, alive (${o.one}, ${o.alive})`)
  }
  // That the cases are the ones meant.
  const row = (rules, place, wand, words) => rows.find((r) => r.rules === rules && r.place === place && r.wand === wand && r.words === words)
  check(row(true, 'no place', false, 'a car')?.placed === false && row(true, 'ground', false, 'a car')?.placed === true, `"a car" had no place over the water and a place on the street (${row(true, 'no place', false, 'a car')?.placed}, ${row(true, 'ground', false, 'a car')?.placed})`)
  check(['ground', 'no place'].every((p) => row(true, p, false, 'car')?.did === 'Make' && row(true, p, false, 'sword')?.did === 'Make' && row(true, p, false, 'open sesame')?.did === 'Say'), 'with a rule, "car" and "sword" (kept) are made and "open sesame" said, aimed at ground and where there is no place')
  check(row(true, 'ground', true, 'fireball')?.did === 'Cast' && row(true, 'ground', false, 'fireball')?.did === 'Say' && row(false, 'ground', false, 'fireball')?.did === 'Make', 'with a rule "fireball" is cast with the wand in hand and said without; with no rule, made')
  // Words that point at what is looked at, aimed where nothing made stands, are read as any words are (#245); others go where they did before.
  const all = (words, want) => rows.filter((r) => r.words === words && !r.wand).every(want)
  // (Where there is no place for a new thing the helper refuses it before any model is asked.)
  check(['make the dragon alive', 'make the tree alive'].every((w) => all(w, (r) => r.to === 'ask' && (r.model || r.place === 'no place'))), '"make the dragon alive" and "make the tree alive" are new things the model is asked for, with a rule and without')
  check(row(true, 'ground', false, 'let me ride the horse')?.did === 'Say' && row(false, 'ground', false, 'let me ride the horse')?.to === 'rule' && row(true, 'ground', false, 'let me drive it home')?.did === 'Say', '"let me ride the horse" and "let me drive it home" are said to the realm with a rule, and ask for a rule without')
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser.close()
await h.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log(`said: ok (no model was run; the stand-in was asked ${asked} times)`)
process.exit(0)
