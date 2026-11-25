// Making in the page (#526, page/maker.ts), checked: the folder `node sf/build.mjs` writes, served as plain files, with
// no helper and no world's server. Chrome with WebGPU; one GPU is shared, so a failed run is worth one more.
//
//   node test/sf-make.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/make/check] [--headed]
//
// It fails unless:
//   - without `?making=1` (the realm's rule is "preview") there is no bar, nothing of the maker or its shelf is asked
//     for, by the bar or by anything said on it, and words sent to be made make nothing;
//   - with it, in the realm: the bar is there; typing the words for a kept car shows its ghost, Enter makes it, and
//     there is one living thing more than before, which drives a metre and more;
//   - words for a kept thing of cells make it: its record is in `engine.things`, and its cells are in the page's own
//     core at places sampled from that record;
//   - `engine.unmake()` takes the last one out (record and cells), and "undo" on the bar takes out the car;
//   - words nothing kept answers make nothing, and say so;
//   - nothing of the maker or the shelf was asked for before the bar was used.
// No model is run.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'make', 'check'))
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0)
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const errors = []
/** What of the maker a page asked for: its module, the modules only it reaches, its shelf. */
const MAKER = /^\/(page\/maker\.js|make\/|text\.js|sf\/shelf\/)/
const makerAsked = (from = 0) => site.asked.filter((a) => a.at >= from && MAKER.test(a.path)).map((a) => a.path)

/** A page of the realm, in once the park is whole: by the host's way in (explore.ts `go`), then stood on the street at the kept car's kerb, looking along it. */
const open = async (query) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  const from = Date.now()
  await page.goto(`${site.url}/sf/index.html${query}`)
  await page.waitForFunction(() => globalThis.engine?.explore && globalThis.engine.seen?.whole > 0, null, { timeout: 300_000 })
  const before = makerAsked(from).length
  await page.evaluate(() => globalThis.engine.explore.go())
  await page.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in', null, { timeout: 60_000 })
  // Off the roof the flight leaves the visitor on, to the street the realm parks its car in (sf/realm.json `kept`),
  // looking west along it; once the page holds the tiles there, the eye 1.7 m over the street's top.
  const stand = () => page.evaluate(() => {
    const e = globalThis.engine, k = e.local.kept[0].at, x = k[0] + 80, z = k[2] + 2
    let y = 1500
    for (; y > 0 && !e.kind(x, y, z); y--);
    e.me.walk(false)
    Object.assign(e.pose, { x: x / 10, y: (y + 18) / 10, z: z / 10, yaw: -Math.PI / 2, pitch: -0.3 })
    return y
  })
  await stand()
  await page.waitForTimeout(3000)
  await stand()
  await page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 }, null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  return { context, page, from, before }
}
/** Types words on the bar as a person would, and waits for the ghost (or a while for none). */
const type = async (page, words) => {
  await page.evaluate(() => globalThis.engine.hud.line.show())
  await page.fill('#line', '')
  await page.type('#line', words, { delay: 40 })
}

// ── Without ?making=1 ──
{
  const { context, page, from, before } = await open('')
  const off = await page.evaluate(async () => {
    const e = globalThis.engine, bar = getComputedStyle(document.querySelector('#ask')).display
    const done = await e.ask({ wish: 'a car', typed: true }).catch((x) => ({ state: String(x) }))
    return { bar, known: e.asker.known, done: done.state, unmake: typeof e.unmake, alive: e.alive.things.length, things: e.things.all.size }
  })
  await page.waitForTimeout(1500)
  check(off.bar === 'none' && !off.known && off.unmake === 'undefined', `without ?making=1: no bar (${off.bar}), no helper known, no unmake`)
  check(off.done === 'refused' && off.things === 0, `words sent to be made make nothing (${off.done}, ${off.things} things)`)
  check(before === 0 && makerAsked(from).length === 0, `nothing of the maker or its shelf asked for (${makerAsked(from).join(', ') || 'none'})`)
  await context.close()
}

// ── With ?making=1 ──
{
  const { context, page, from, before } = await open('?making=1')
  check(before === 0, `with ?making=1, nothing of the maker asked for before the park is shown and the visitor is in (${before})`)
  const bar = await page.evaluate(() => getComputedStyle(document.querySelector('#ask')).display)
  check(bar !== 'none' && makerAsked(from).length === 0, `in the realm the bar is there (${bar}), and nothing of the maker is asked for until it is used`)

  // A kept car: its ghost as it is typed, then Enter.
  const alive0 = await page.evaluate(() => globalThis.engine.alive.things.length)
  await type(page, 'a car')
  const ghost = await page.waitForFunction(() => globalThis.engine.kept.shown, null, { timeout: 30_000 }).then((h) => h.jsonValue(), () => null)
  check(!!ghost && /car/.test(ghost.name), `typing "a car" shows the kept car's ghost (${ghost ? ghost.name : 'none'})`)
  check(makerAsked(from).some((p) => p.endsWith('/page/maker.js')) && makerAsked(from).some((p) => p.endsWith('/shelf/index.json')), `the maker and the shelf came when the bar was used (${makerAsked(from).length} files)`)
  const madeCar = page.evaluate(() => new Promise((done) => { const off = globalThis.engine.wish.on((s) => { if (s.stage === 'done') { off(); done(s) } }) }))
  await page.keyboard.press('Enter')
  const car = await madeCar
  await page.waitForTimeout(500)
  const alive1 = await page.evaluate(() => globalThis.engine.alive.things.length)
  check(car.state === 'there' && alive1 === alive0 + 1, `Enter made it: ${car.state}${car.why ? ` (${car.why})` : ''}, ${car.name}; living things ${alive0} then ${alive1}`)
  const drove = await page.evaluate(async () => {
    const e = globalThis.engine, t = e.alive.things.at(-1), a = e.alive.where(t)?.at
    for (let i = 0; i < 30; i++) { e.alive.drive(t, 1, 0, 0); await new Promise((r) => setTimeout(r, 100)) }
    const b = e.alive.where(t)?.at
    return a && b ? Math.hypot(b[0] - a[0], b[2] - a[2]) / 10 : -1
  })
  check(drove > 1, `it drives: ${drove.toFixed(2)} m in three seconds`)
  await page.screenshot({ path: join(shots, 'car.png') })

  // A kept thing of cells: its record, and its cells in the page's own core.
  const things0 = await page.evaluate(() => globalThis.engine.things.all.size)
  await page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { yaw: e.pose.yaw + Math.PI }) })
  await page.waitForTimeout(500)
  const chair = await page.evaluate(async () => {
    const e = globalThis.engine, done = await e.ask({ wish: 'a market stall with a striped awning', typed: true })
    const t = done.id && e.things.all.get(done.id)
    if (!t) return { done, things: e.things.all.size }
    const g = t.grain ?? 1, cells = []
    for (let i = 0; i + 4 < t.cells.length; i += 5 * Math.max(1, Math.floor(t.cells.length / 5 / 24))) cells.push([Math.floor(t.cells[i] / g), Math.floor(t.cells[i + 2] / g), Math.floor(t.cells[i + 3] / g)])
    return { done, things: e.things.all.size, grain: g, sampled: cells.length, held: cells.filter(([x, y, z]) => e.kind(x, y, z) !== 0).length, cells }
  })
  check(chair.done.state === 'there' && chair.things === things0 + 1, `a kept thing of cells is made: ${chair.done.state}${chair.done.why ? ` (${chair.done.why})` : ''}, ${chair.done.name}; its record in engine.things (${things0} then ${chair.things})`)
  check(chair.sampled > 0 && chair.held === chair.sampled, `its cells are in the page's core: ${chair.held} of ${chair.sampled} sampled (grain ${chair.grain})`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(shots, 'stall.png') })

  // Taken out again.
  const out = await page.evaluate(async (cells) => {
    const e = globalThis.engine, done = await e.unmake()
    // (A cell of it that lay in the land's own top is the land again, as a world's server takes a thing out.)
    return { done, things: e.things.all.size, left: cells.filter(([x, y, z]) => e.kind(x, y, z) !== 0 && y > e.ground(x / 10, z / 10) * 10 + 1).length }
  }, chair.cells ?? [])
  check(out.done.state === 'there' && out.things === things0 && out.left === 0, `engine.unmake() takes it out: ${out.done.state}${out.done.why ? ` (${out.done.why})` : ''}, ${out.things} records, ${out.left} of its cells left`)
  const undo = await page.evaluate(async () => { const e = globalThis.engine, n = e.alive.things.length; const done = await e.wish({ wish: 'undo' }); return { done, before: n, after: e.alive.things.length } })
  check(undo.done.state === 'there' && undo.after === undo.before - 1, `"undo" on the bar takes out the car: ${undo.done.state}${undo.done.why ? ` (${undo.done.why})` : ''}, living ${undo.before} then ${undo.after}`)

  // Words nothing kept answers.
  const none = await page.evaluate(async () => { const e = globalThis.engine, n = e.things.all.size; const done = await e.ask({ wish: 'a purple submarine', typed: true }); return { done, more: e.things.all.size - n } })
  check(none.done.state === 'refused' && /AI/.test(none.done.why ?? '') && none.more === 0, `words nothing kept answers make nothing, and say so: ${none.done.why}`)
  await context.close()
}

check(!errors.length, `no errors on the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
await browser.close()
back()
console.log(failures.length ? `sf-make: ${failures.length} failed` : 'sf-make: ok (no model was run)')
process.exit(failures.length ? 1 : 0)
