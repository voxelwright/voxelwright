// What is kept, made at once from the ask bar (#220): a kept wish is typed into the real page a key at a time; the
// thing it means is shown where it would stand, as a ghost, from the first key that makes it clear, and goes when
// the words stop meaning it; Enter stands it in the shared world. Timed: from a key to the frame that shows its
// ghost, and from Enter to the frame that has the thing standing. NO MODEL IS RUN: the helper is given none, and
// what came with the engine (make/kept) is what is made.
//
//   node test/kept.mjs [--out dir]      dir: pictures of the ghost and of the thing standing
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { arg, chrome, serve } from './kit.mjs'

/** The bounds, from what was measured (November 15, 2026, this machine, a shared world on its own server): a key to its ghost 56 to 77 ms, Enter to the car standing 336 to 465 ms (three runs). */
const KEY_MOST = 150, ENTER_MOST = 1000
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-kept-')), out = arg('out', '')
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
let asked = 0
const h = await helper({ world: server.url, port: 0, model: async () => { asked++; throw new Error('no model is run here') }, journal: join(dir, 'made.jsonl'), kept: join(dir, 'library') })
await h.warm
const browser = await chrome()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Ada&at=70,17.2,412&look=0,-25${new URL(h.link).hash}`)
  await page.waitForFunction(() => globalThis.engine?.kept && engine.asker.known, null, { timeout: 90_000 })
  await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
  // Typed as a person types: a key every 90 ms. After each, what the page shows.
  await page.keyboard.press('Enter')
  const typed = []
  for (const key of 'a car') {
    await page.keyboard.type(key)
    await page.waitForTimeout(90)
    typed.push(await page.evaluate(() => engine.kept.shown?.name ?? null))
  }
  const laps = await page.evaluate(() => engine.kept.laps.filter((l) => l.id))
  const first = typed.findIndex((n) => n)
  check(first >= 0 && first <= 3 && typed.slice(first).every((n) => n === typed[first]), `the ghost of what is kept shows from key ${first + 1} of "a car" and stays: ${typed.map((n, i) => `${'a car'.slice(0, i + 1)}: ${n ?? '-'}`).join('; ')}`)
  check(laps.length > 0 && laps.every((l) => l.ms < KEY_MOST), `from a key to the frame that shows its ghost: ${laps.map((l) => `${Math.round(l.ms)} ms ("${l.words}")`).join(', ')} (bound ${KEY_MOST} ms)`)
  if (out) { mkdirSync(out, { recursive: true }); await page.screenshot({ path: join(out, 'ghost.png') }) }
  // Words that stop meaning it take it away; back again, it is back.
  await page.keyboard.type('pet')
  await page.waitForTimeout(150)
  const carpet = await page.evaluate(() => engine.kept.shown)
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
  await page.waitForTimeout(150)
  const back = await page.evaluate(() => engine.kept.shown?.name ?? null)
  check(carpet === null && back === typed[first], `words that stop meaning it take it away ("a carpet": ${carpet?.name ?? 'nothing'}), and it is back with them ("a car": ${back})`)
  // Enter: timed from the key to the frame in which the thing's record and cells are in this page's world.
  const before = await page.evaluate(() => engine.things.all.size)
  // What Enter sends and what the helper then makes from: the ghost's own id, and the helper saying it made the chosen one
  // (without this the check passed whenever the plain wish found the same thing on the shelf).
  const ghost = await page.evaluate(() => engine.kept.shown?.id ?? null)
  const sent = { kept: undefined, chosen: null }
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/ask') { try { sent.kept = JSON.parse(r.postData() ?? '{}').kept ?? null } catch { /* not JSON */ } } })
  page.on('response', (r) => { if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/ask') void r.text().then((t) => { const m = /"stage":"chosen","id":"([0-9a-f]{24}[ms][0-9a-f]{8})"/.exec(t); sent.chosen = m ? m[1] : false }, () => {}) })
  await page.evaluate(() => {
    globalThis.__kept = { pressed: 0, stood: 0 }
    addEventListener('keydown', (e) => { if (e.key === 'Enter') globalThis.__kept.pressed = performance.now() }, { capture: true, once: true })
    const n = engine.things.all.size
    const look = () => { if (engine.things.all.size > n && !globalThis.__kept.stood) globalThis.__kept.stood = performance.now(); else requestAnimationFrame(look) }
    requestAnimationFrame(look)
  })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => globalThis.__kept.stood > 0, null, { timeout: 20_000 })
  const took = await page.evaluate(() => globalThis.__kept.stood - globalThis.__kept.pressed)
  const made = await page.evaluate(() => [...engine.things.all.values()].at(-1))
  // In cells of 2.5 cm: as finer cells (grain 4), or, a car that lives (#245, since November 16), as a look of them on its body.
  const fine = made?.grain ?? made?.controls?.fine?.[0]?.per
  check(made?.name === typed[first] && fine === 4 && (await page.evaluate(() => engine.things.all.size)) === before + 1, `Enter stands it in the shared world: ${made?.name}, ${made?.controls ? 'alive, a look' : 'grain'} of ${fine} to a cell, ${made ? made.cells.length / 5 : 0} rows`)
  check(took < ENTER_MOST, `from Enter to the frame that has it standing: ${Math.round(took)} ms (bound ${ENTER_MOST} ms)`)
  await page.waitForFunction(() => engine.asker.busy === 0 && engine.kept.shown === null, null, { timeout: 10_000 })
  await page.waitForTimeout(500)
  const still = await page.evaluate((id) => engine.things.all.has(id), made?.id)
  check(still, 'and it is still there once the ask is done (not taken out again)')
  check(asked === 0, 'no model was asked: what came with the engine was made')
  check(!!ghost && sent.kept === ghost && sent.chosen === ghost, `Enter sent the ghost's own id and the helper made that entry (ghost ${ghost}, sent ${sent.kept}, made from ${sent.chosen})`)
  if (out) { await page.waitForTimeout(800); await page.screenshot({ path: join(out, 'stands.png') }) }
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser.close()
await h.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('kept: ok (no model was run)')
process.exit(0)
