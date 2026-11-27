// A living thing kept and made at once from the ask bar (#245): a car whose body is the engine's own hand-written
// car and whose look is its car of 2.5 cm (page/living.ts `fineCar`), written as a build from the bench would be,
// put on a shelf by the importer (make/import.mjs), and then typed on the ask bar of the real page a key at a time.
// Its ghost shows (its look, not its body); Enter stands it, alive and wearing its look; E gets on, the card says
// its figures, W drives it, V puts the eye in the seat; `make.mjs --undo` takes it out while it is ridden, and its
// rider is set down. Timed: a key to its ghost, Enter to the frame in which it stands in its look. NO MODEL IS RUN:
// the helper is given none.
//
//   node test/kept-car.mjs [--out dir]      dir: pictures of the ghost, of it standing, and from the seat
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { helper } from '../helper.mjs'
import { undo } from '../make.mjs'
import { importTo } from '../make/import.mjs'
import { SHIPPED } from '../make/library.mjs'
import { fineCar } from '../page/living.ts'
import { arg, chrome, serve } from './kit.mjs'

/** Bounds: the saloon's (test/kept.mjs) for a key to its ghost; Enter to a living car standing in its look, a second. */
const KEY_MOST = 150, ENTER_MOST = 1000
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-kept-car-')), out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })

// The build as the bench writes one (fast-voxels src/library.py `car`): its body, motor, seats, eye, look and figures.
const car = fineCar([0, 0, 0]), look = car.fine[0]
// The bench writes a material and a colour, never the polish a look's paint carries (spells.ts `POLISHED`).
const bench = (cells) => cells.map((k) => k & ~0xf0)
const build = { name: 'Toy Roadster', living: { body: { size: car.size, cells: [...car.cells] }, motor: car.motor, seats: car.seats, eye: car.eye }, parts: { whole: { size: look.size, per: look.per, low: look.low, cells: Buffer.from(bench(look.cells).buffer).toString('base64') } }, asked: { top_kmh: 80, zero_to_100_s: 9.0 }, measured: { top_kmh: 72.4, zero_to_100_s: 9.94, mass_kg: 900 } }
writeFileSync(join(dir, 'roadster.json'), JSON.stringify(build))
const shelf = join(dir, 'library'), journal = join(dir, 'made.jsonl')
let refused = ''
try { await importTo(join(dir, 'roadster.json'), { shelf: SHIPPED }) } catch (e) { refused = e.message }
check(/ships with the engine/.test(refused), `the importer will not write into make/kept/ (${refused})`)
const imported = await importTo(join(dir, 'roadster.json'), { shelf })
check(imported.wish === 'a Toy Roadster' && imported.look.length === 1, `imported onto a shelf of its own: "${imported.wish}", a body of ${imported.cells} cells, a look of ${imported.look.join(', ')}, ${(imported.bytes / 1000).toFixed(0)} KB`)

const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
let asked = 0
const h = await helper({ world: server.url, port: 0, model: async () => { asked++; throw new Error('no model is run here') }, journal, kept: shelf })
await h.warm
const browser = await chrome()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  const shown = []
  page.on('response', (r) => { if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/kept') void r.json().then((j) => { if (j.id) shown.push(j) }, () => {}) })
  await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Ada&at=70,17.2,412&look=0,-25${new URL(h.link).hash}`)
  await page.waitForFunction(() => globalThis.engine?.kept && engine.asker.known, null, { timeout: 90_000 })
  await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
  const words = 'a toy roadster'
  await page.keyboard.press('Enter')
  const typed = []
  for (const key of words) {
    await page.keyboard.type(key)
    await page.waitForTimeout(90)
    typed.push(await page.evaluate(() => engine.kept.shown?.name ?? null))
  }
  const first = typed.findIndex((n) => n)
  check(first >= 0 && typed.slice(first).every((n) => n === 'Toy Roadster'), `its ghost shows from key ${first + 1} of "${words}" and stays: ${typed.map((n, i) => `${words.slice(0, i + 1)}: ${n ?? '-'}`).join('; ')}`)
  const laps = await page.evaluate(() => engine.kept.laps.filter((l) => l.id))
  check(laps.length > 0 && laps.every((l) => l.ms < KEY_MOST), `from a key to the frame that shows its ghost: ${laps.map((l) => `${Math.round(l.ms)} ms ("${l.words}")`).join(', ')} (bound ${KEY_MOST} ms)`)
  // The ghost is its look (cells of 2.5 cm, 4 to the world's), not its body of 10 cm.
  const ghost = shown.at(-1)
  check(ghost?.grain === 4 && ghost.size[1] === look.size[1] && ghost.size[0] * ghost.size[2] === look.size[0] * look.size[2] && (['east', 'west'].includes(ghost.facing) ? ghost.size[0] === look.size[0] : ghost.size[0] === look.size[2]), `the ghost is its look, turned as it will stand (facing ${ghost?.facing}): grain ${ghost?.grain}, ${ghost?.size.join(' x ')} cells (its look is ${look.size.join(' x ')})`)
  if (out) await page.screenshot({ path: join(out, 'ghost.png') })
  // Enter: timed from the key to the frame in which a living thing stands in its look, its own cells not drawn.
  await page.evaluate(() => {
    globalThis.__car = { pressed: 0, stood: 0 }
    addEventListener('keydown', (e) => { if (e.key === 'Enter') globalThis.__car.pressed = performance.now() }, { capture: true, once: true })
    const look = () => { const e = globalThis.engine, t = e.alive.things.find((t) => t.ref && t.alive), l = t && e.alive.look(t); if (l && l.parts.length && l.parts[0].cell > 0 && l.body === 0 && !globalThis.__car.stood) globalThis.__car.stood = performance.now(); else requestAnimationFrame(look) }
    requestAnimationFrame(look)
  })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => globalThis.__car.stood > 0, null, { timeout: 20_000 })
  const took = await page.evaluate(() => globalThis.__car.stood - globalThis.__car.pressed)
  const made = await page.evaluate(() => { const t = engine.alive.things.find((t) => t.ref), r = t && engine.things.all.get(t.ref); return t && { ref: t.ref, name: t.name, facts: t.facts, body: engine.alive.look(t).body, parts: engine.alive.look(t).parts.map((p) => p.cell), controls: !!r?.controls, kept: r?.controls?.fine?.length ?? 0, facing: r?.facing } })
  check(!!made && made.name === 'Toy Roadster' && made.controls && made.kept === 1 && made.body === 0 && made.parts[0] === 0.25, `Enter stands it alive in its look: ${JSON.stringify(made)}`)
  check(took < ENTER_MOST, `from Enter to the frame in which it stands in its look: ${Math.round(took)} ms (bound ${ENTER_MOST} ms)`)
  await page.waitForFunction(() => engine.asker.busy === 0 && engine.kept.shown === null, null, { timeout: 10_000 })
  if (out) { await page.waitForTimeout(600); await page.screenshot({ path: join(out, 'stands.png') }) }
  // E gets on: the card says its figures.
  await page.waitForFunction(() => engine.alive.near?.ref, null, { timeout: 10_000 }).catch(() => {})
  const near = await page.evaluate(() => engine.alive.near?.name ?? null)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  const on = await page.evaluate(() => ({ riding: engine.alive.riding?.name ?? null, note: document.querySelector('#card p.note')?.textContent ?? null }))
  check(near === 'Toy Roadster' && on.riding === 'Toy Roadster', `E gets on it (near: ${near}, riding: ${on.riding})`)
  check(on.note === '72 km/h, 0 to 100 in 9.9 s', `the card says its figures as measured (it was asked 80 km/h and 9.0 s): "${on.note}"`)
  // W drives it: held for a second and a half.
  const where = () => page.evaluate(() => { const t = engine.alive.riding, w = t && engine.alive.where(t); return w ? w.at : null })
  const from = await where()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyW')
  const to = await where()
  const went = from && to ? Math.hypot(to[0] - from[0], to[2] - from[2]) / 10 : 0
  check(went > 1.5, `W drives it with its own motor: ${went.toFixed(1)} m in 1.5 s`)
  // V: the eye in the seat.
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(400)
  const seat = await page.evaluate(() => ({ inside: engine.alive.inside, tilted: !!engine.pose.tilt }))
  check(seat.inside && seat.tilted, `V puts the eye in the seat (inside ${seat.inside}, the frame turned with it ${seat.tilted})`)
  if (out) await page.screenshot({ path: join(out, 'seat.png') })
  // Taken out while it is ridden, away from where it was made: it is gone from every page, and its rider is on their feet.
  const u = await undo({ world: server.url, journal, by: 'Ada' })
  await page.waitForFunction((ref) => !engine.things.all.has(ref) && !engine.alive.things.some((t) => t.ref === ref), made?.ref, { timeout: 5000 }).catch(() => {})
  const after = await page.evaluate((ref) => ({ record: engine.things.all.has(ref), alive: engine.alive.things.some((t) => t.ref === ref), riding: engine.alive.riding?.name ?? null }), made?.ref)
  check(u.state === 'undone' && !after.record && !after.alive && after.riding === null, `--undo takes it out where it was driven to (${u.state}), its rider set down: record ${after.record}, alive ${after.alive}, riding ${after.riding}`)
  const things = await fetch(`${server.url}/world/things`).then((r) => r.json())
  check(things.length === 0, `and the world keeps no record of it (${things.length})`)
  check(asked === 0, 'no model was asked')
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser.close()
await h.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('kept-car: ok (no model was run)')
process.exit(0)
