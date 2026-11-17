// A car a model makes is a car one drives (#245). The real page in Chrome, a shared world of its own, and the helper
// with stand-ins for the models: a reply of parts (test/made-cars/hatchback.json, cells of 10 cm, its nose at z 0)
// and a program (test/made-cars/roadster.js, cells of 2.5 cm, its nose at +x), each saying `drives`. Each is typed
// on the ask bar and stands alive: E gets on, W takes it the way its white lamps face (read from its own cells, not
// from its motor), its yellow stripe is on its left, V puts the eye in its seat. A punt with nothing that rolls is
// driven on small wheels under its corners, and the place says so. "make it drivable", aimed at a car
// made with no `drives`, brings that one to life where it stood. "a car" (make/kept/) is driven. The better model's
// car takes the quick one's place, alive, when nobody has ridden it, and is only kept when someone has. The card says
// as measured only what was measured. NO MODEL IS RUN: the helpers are given stand-ins.
//
//   node test/made-cars.mjs [--out dir]      dir: pictures of a made car beside the person, from behind while driven, and from its seat
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { helper } from '../helper.mjs'
import { undo } from '../make.mjs'
import { arg, chrome, here, serve } from './kit.mjs'
import { cardSays, measuredOnly } from './made-cars/card.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-made-cars-')), out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const PARTS = readFileSync(join(here, 'test/made-cars/hatchback.json'), 'utf8'), PROGRAM = readFileSync(join(here, 'test/made-cars/roadster.js'), 'utf8')
/** The hatchback with nothing said of driving it: a car as a model made them before. */
const STILL = JSON.stringify({ ...JSON.parse(PARTS), name: 'plain red box car', drives: undefined })
/** A punt with nothing that rolls: a hull on the ground, its nose at z 0, white lamps at the nose and a yellow stripe on its left. */
const PUNT = JSON.stringify({ name: 'flat wooden punt', size: [12, 6, 30], drives: { front: '-z' }, parts: [['box', 'wood', 'own', 0, 0, 0, 12, 4, 30], ['box', 'air', 'own', 1, 2, 2, 11, 4, 28], ['box', 'lamp', 'white', 2, 2, 0, 4, 4, 1], ['box', 'lamp', 'white', 8, 2, 0, 10, 4, 1], ['box', 'steel', '4:4', 11, 1, 8, 12, 3, 22]] })
/** Kinds in the made-up cars: the white lamps at the nose, the yellow stripe on the left flank. */
const WHITE_LAMP = 15 | (1 << 8), YELLOW = 12 | ((16 + 4 * 10 + 4) << 8)

const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const journal = join(dir, 'made.jsonl')
let asked = 0
// Helper A: parts from its model (no program writer). Helper B: a quick program at once, the better one when the check lets it.
const t00 = Date.now(), log = process.env.DEBUG ? (w) => console.log(`    helper ${((Date.now() - t00) / 1000).toFixed(1)}: ${w}`) : () => {}
const a = await helper({ world: server.url, port: 0, journal, say: log, kept: join(dir, 'shelf-a'), model: async ({ prompt }) => { asked++; return { text: /plain red box/.test(prompt) ? STILL : /punt/.test(prompt) ? PUNT : PARTS, model: 'a stand-in', ms: 0, cost: 0 } } })
const gates = []
const gate = () => { let open; const p = new Promise((r) => { open = r }); gates.push(open); return p }
const b = await helper({ world: server.url, port: 0, journal, say: log, kept: join(dir, 'shelf-b'), model: async () => { throw new Error('no parts here') }, first: async () => ({ text: PROGRAM, model: 'a quick stand-in', ms: 0, cost: 0 }), best: async () => { await gate(); return { text: PROGRAM.replace('name("blue test roadster")', 'name("blue test roadster, better")'), model: 'a best stand-in', ms: 0, cost: 0 } } })
await Promise.all([a.warm, b.warm])
const things = () => fetch(`${server.url}/world/things`).then((r) => r.json())
const one = (id) => fetch(`${server.url}/world/things?id=${id}`).then((r) => r.json())
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Where a car's nose points and which side its stripe is on, from its own cells as the world keeps them (its look, when it has one). */
async function nose(t) {
  let size, kinds
  if (t.controls.fine?.length) {
    const f = t.controls.fine[0]; size = f.size
    const bytes = new Uint8Array(await (await fetch(`${server.url}/world/fine/${f.kept}`)).arrayBuffer()); kinds = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  } else {
    const r = await one(t.id), rows = []
    for (let i = 0; i + 4 < r.cells.length; i += 5) rows.push(r.cells.slice(i, i + 5))
    const lo = [0, 2].map((a) => Math.min(...rows.map((q) => q[a === 0 ? 0 : 3]))), hi = [Math.max(...rows.map((q) => q[1])), Math.max(...rows.map((q) => q[3])) + 1], y0 = Math.min(...rows.map((q) => q[2])), y1 = Math.max(...rows.map((q) => q[2])) + 1
    size = [hi[0] - lo[0], y1 - y0, hi[1] - lo[1]]; kinds = new Uint16Array(size[0] * size[1] * size[2])
    for (const [x0, x1, y, z, k] of rows) for (let x = x0; x < x1; x++) kinds[((y - y0) * size[2] + z - lo[1]) * size[0] + x - lo[0]] = k
  }
  const mean = (want) => { let n = 0, x = 0, z = 0; for (let y = 0, i = 0; y < size[1]; y++) for (let zz = 0; zz < size[2]; zz++) for (let xx = 0; xx < size[0]; xx++, i++) if (want(kinds[i])) { n++; x += xx; z += zz } return [x / n, z / n] }
  const all = mean((k) => k !== 0), lamps = mean((k) => k === WHITE_LAMP), stripe = mean((k) => k === YELLOW)
  const f = [lamps[0] - all[0], lamps[1] - all[1]], n = Math.hypot(...f) || 1, s = [stripe[0] - all[0], stripe[1] - all[1]]
  // Facing (fx, fz) with y up, the left is (fz, -fx).
  return { way: [f[0] / n, f[1] / n], left: (s[0] * f[1] - s[1] * f[0]) / n }
}

const browser = await chrome()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }), page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  // What the helpers answered, line by line (what the place is told).
  const answered = []
  page.on('response', (r) => { if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/ask') void r.text().then((t) => answered.push(...t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { stage: 'unread', status: r.status(), text: l } } })), () => {}) })
  let opened = 0
  const open = async (h, at = '70,17.2,412', look = '0,-25') => {
    // (A new address each time: a page whose address differs only after # is not loaded again, and keeps its helper.)
    await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Ada&at=${at}&look=${look}&n=${++opened}${new URL(h.link).hash}`)
    await page.waitForFunction(() => globalThis.engine?.kept && engine.asker.known && engine.hud.line.onsubmit, null, { timeout: 90_000 })
    await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
  }
  /** Types words on the ask bar and presses Enter: what the bar read, and the record of what came of it (a new one, or one that changed). */
  const ask = async (words) => {
    const before = new Map((await things()).map((t) => [t.id, JSON.stringify(t)]))
    await page.keyboard.press('Enter')
    await page.keyboard.type(words, { delay: 30 })
    await page.waitForTimeout(1200)
    const label = await page.evaluate(() => { const b = document.querySelector('#ask-which'); return b && !b.hidden ? b.textContent : null })
    const was = answered.length
    await page.keyboard.press('Enter')
    // Done when the helper's answer has ended (its last line), and the page has it.
    for (let i = 0; i < 120 && !answered.slice(was).some((l) => l.stage === 'done'); i++) await page.waitForTimeout(250)
    await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(400)
    const now = await things()
    return { label, made: now.find((t) => !before.has(t.id)) ?? null, all: now }
  }
  /** Walks up beside a living thing, two and a half metres off its side, looking at it. */
  const walkUp = (ref) => page.evaluate((ref) => {
    const e = globalThis.engine, t = e.alive.things.find((t) => t.ref === ref), w = t && e.alive.where(t)
    if (!w) return
    const side = [-w.front[2], w.front[0]], n = Math.hypot(...side) || 1, x = w.at[0] / 10 + (side[0] / n) * 3.2, z = w.at[2] / 10 + (side[1] / n) * 3.2
    e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 1.7; e.pose.yaw = Math.atan2(w.at[0] / 10 - x, -(w.at[2] / 10 - z)); e.pose.pitch = -0.2; e.me.walk(true)
  }, ref)
  /** Gets on the thing near (E), and what the card says. */
  const getOn = async (ref) => {
    await walkUp(ref)
    await page.waitForFunction((ref) => engine.alive.near?.ref === ref, ref, { timeout: 10_000 }).catch(() => {})
    const near = await page.evaluate(() => engine.alive.near?.ref ?? null)
    await page.keyboard.press('KeyE'); await page.waitForTimeout(400)
    return { near, ...(await page.evaluate(() => ({ riding: engine.alive.riding?.ref ?? null, note: document.querySelector('#card p.note')?.textContent ?? '' }))) }
  }
  /** Holds W: how far it went and which way, in the world's cells. */
  const drive = async (ms = 1500, shot, key = 'KeyW') => {
    const where = () => page.evaluate(() => { const t = engine.alive.riding, w = t && engine.alive.where(t); return w ? w.at : null })
    const from = await where()
    await page.keyboard.down(key)
    await page.waitForTimeout(ms * 0.7)
    if (shot) await page.screenshot({ path: shot })
    await page.waitForTimeout(ms * 0.3)
    await page.keyboard.up(key)
    const to = await where()
    return from && to ? [to[0] - from[0], to[2] - from[2]] : [0, 0]
  }
  /**
   * A made car: alive, got on, driven forward by its nose, its stripe on its left, the eye in its seat. `asked`: what
   * the stand-in's reply asked of it (figures of this check's own, not read from the car): its card says that top
   * speed and a 0 to 100 near that time, as measured.
   */
  const driven = async (what, t, { pictures = false, asked } = {}) => {
    check(!!t?.controls?.motor && t.controls.motor.feet.length >= 4, `${what}: stands alive (${t?.name}: ${t?.controls ? `${t.controls.motor.feet.length} feet` : 'no controls'})`)
    if (!t?.controls) return
    const facts = t.facts ?? {}
    check(measuredOnly(facts), `${what}: its record says measured only what was measured, and something was: ${JSON.stringify(facts)}`)
    if (pictures && out) { await walkUp(t.id); await page.waitForFunction((ref) => engine.alive.near?.ref === ref, t.id, { timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(1500); await page.screenshot({ path: join(out, `${pictures}-beside.png`) }) }
    const n = await nose(t)
    const on = await getOn(t.id)
    check(on.near === t.id && on.riding === t.id, `${what}: E gets on it (near ${on.near === t.id}, riding ${on.riding === t.id})`)
    check(cardSays(on.note, asked, facts.measured?.zero_to_100_s), `${what}: the card says "${on.note}": ${asked.top_kmh ? `${asked.top_kmh} km/h as asked, ` : 'no top speed (none was asked), '}0 to 100 near the ${asked.zero_to_100_s} s asked, as measured in the engine's own solver`)
    const went = await drive(1500, pictures && out ? join(out, `${pictures}-behind.png`) : undefined), m = Math.hypot(...went) / 10
    const ahead = (went[0] * n.way[0] + went[1] * n.way[1]) / 10
    check(m > 1.5 && ahead > 0.9 * m, `${what}: W takes it ${m.toFixed(1)} m, ${ahead.toFixed(1)} m of it the way its white lamps face`)
    check(n.left > 0, `${what}: its yellow stripe is on its left (${n.left.toFixed(1)}), so it is not mirrored`)
    await page.keyboard.press('KeyV'); await page.waitForTimeout(500)
    const seat = await page.evaluate(() => engine.alive.inside)
    check(seat, `${what}: V puts the eye in its seat`)
    if (pictures && out) await page.screenshot({ path: join(out, `${pictures}-seat.png`) })
    await page.keyboard.press('KeyV'); await page.waitForTimeout(200)
    await page.keyboard.press('KeyE'); await page.waitForTimeout(300)
  }

  // ── Helper A: a reply of parts ──
  await open(a)
  const hatch = await ask('a little hatchback')
  check(hatch.label === 'Make', `"a little hatchback" reads ${hatch.label}`)
  await driven('a reply of parts', hatch.made, { pictures: 'parts', asked: { top_kmh: 160, zero_to_100_s: 11 } })
  const u1 = await undo({ world: server.url, journal, id: hatch.made?.id })
  check(u1.state === 'undone', `the hatchback is taken out again (${u1.state}${u1.why ? `: ${u1.why}` : ''})`)

  // "make it drivable", aimed at a car made with nothing said of driving it.
  await open(a)
  const still = await ask('a plain red box car')
  check(!!still.made && !still.made.controls, `a car made with no "drives" stands as cells (${still.made?.name}, controls ${!!still.made?.controls})`)
  const enliven = await ask('make it drivable')
  const alive = enliven.all.find((t) => t.controls && t.name === still.made?.name)
  check(enliven.label === 'Make' && !enliven.all.some((t) => t.id === still.made?.id) && !!alive, `"make it drivable" reads ${enliven.label}, and the car looked at is alive in its place (${alive ? alive.id : 'none'})`)
  check(!!alive && Math.hypot(alive.at[0] - still.made.at[0], alive.at[2] - still.made.at[2]) <= 3, `where it stood: ${still.made?.at} then ${alive?.at}`)
  const said = answered.filter((l) => l.stage === 'note').map((l) => l.why)
  check(said.includes('Your plain red box car is alive: walk up to it and press E'), `the place says so: ${JSON.stringify(said)}`)
  // Asked again before it is driven anywhere: aimed at a thing that lives, the words are not for bringing it to life,
  // and go where any words go (here a new thing is made of them); the living car is as it was.
  const was = answered.length, again = await ask('make it drivable')
  const same = again.all.find((t) => t.id === alive?.id)
  check(!!same?.controls && !answered.slice(was).some((l) => l.stage === 'note' && /alive/.test(l.why)), `"make it drivable" again, aimed at the living car, leaves it as it was (alive ${!!same?.controls}; ${JSON.stringify(answered.slice(was).filter((l) => l.stage === 'note').map((l) => l.why))})`)
  if (again.made) await undo({ world: server.url, journal, id: again.made.id })
  await driven('"make it drivable"', alive, { asked: { zero_to_100_s: 9 } })
  await undo({ world: server.url, journal, id: alive?.id })

  // What ships: "a car".
  await open(a)
  const shipped = await ask('a car')
  check(shipped.made?.name === 'blue saloon car', `"a car" is the car that comes with the engine (${shipped.made?.name})`)
  check(!!shipped.made?.controls && shipped.made.controls.fine?.length === 1, 'and stands alive in its look of 2.5 cm')
  if (shipped.made?.controls) {
    const on = await getOn(shipped.made.id)
    const went = await drive(1500), m = Math.hypot(...went) / 10
    check(on.riding === shipped.made.id && m > 1.5, `E gets on it and W drives it ${m.toFixed(1)} m`)
    // As it was kept (make/kept/): 190 km/h asked, 0 to 100 in 9.4 s measured.
    check(on.note === '190 km/h, 0 to 100 in 9.4 s', `its card says "${on.note}": 190 km/h as asked, 0 to 100 in 9.4 s as measured when it was kept`)
    await page.keyboard.press('KeyE'); await page.waitForTimeout(300)
  }
  await undo({ world: server.url, journal, id: shipped.made?.id })
  // Nothing that rolls: driven all the same, on small wheels under its corners, and the place says so.
  await open(a)
  const punt = await ask('a flat wooden punt')
  const told = answered.filter((l) => l.stage === 'note').map((l) => l.why)
  check(told.includes('nothing of it rolls: it goes on four small wheels under its corners'), `the place says what was done with a thing that has no wheels: ${JSON.stringify(told.slice(-1))}`)
  await driven('a punt (nothing rolls)', punt.made, { asked: { zero_to_100_s: 9 } })
  await undo({ world: server.url, journal, id: punt.made?.id })
  check(asked === 4, `helper A's stand-in was asked four times (the hatchback, the plain car, "make it drivable" aimed at the living car, as any words, and the punt): ${asked}`)

  // ── Helper B: a program at once, then better ──
  await open(b, '70,17.2,412')
  const quick = await ask('a roadster')
  await driven('a program', quick.made, { pictures: 'program', asked: { top_kmh: 220, zero_to_100_s: 6 } })
  // The better one arrives while someone sits in the quick one: it is kept for the next asker, and the rider drives on.
  const seated = await getOn(quick.made?.id)
  gates.shift()?.()
  const shelfB = join(dir, 'shelf-b'), best = () => { try { return readdirSync(shelfB).some((f) => JSON.parse(readFileSync(join(shelfB, f), 'utf8')).grade === 'best') } catch { return false } }
  for (let i = 0; i < 80 && !best(); i++) await wait(250)
  await wait(500)
  // (It may have been left nose against something by the drive above: it is backed off with S.)
  const kept = await things(), riding = await page.evaluate(() => engine.alive.riding?.ref ?? null), on = await drive(1500, undefined, 'KeyS')
  check(seated.riding === quick.made?.id && best() && kept.some((t) => t.id === quick.made?.id) && !kept.some((t) => /better/.test(t.name)) && riding === quick.made?.id && Math.hypot(...on) > 5, `the better one, come while someone sits in the quick one, is kept and not swapped in: the rider is still in it (${riding === quick.made?.id}) and backs it ${(Math.hypot(...on) / 10).toFixed(1)} m; the world has ${kept.map((t) => t.name).join(', ')}`)
  await page.keyboard.press('KeyE'); await page.waitForTimeout(300)
  await undo({ world: server.url, journal, id: quick.made?.id })
  // A second, left alone: the better one takes its place, alive.
  await open(b, '70,17.2,412')
  const second = await ask('a roadster')
  check(!!second.made?.controls && second.made.name === 'blue test roadster, better', `asked again, the better one kept is made at once (${second.made?.name}), alive`)
  await undo({ world: server.url, journal, id: second.made?.id })
  await open(b, '70,17.2,412')
  const third = await ask('a coupe roadster')
  check(!!third.made?.controls && !/better/.test(third.made.name), `"a coupe roadster" is made at once by the quick stand-in, alive (${third.made?.name})`)
  gates.shift()?.()
  let better = null
  for (let i = 0; i < 40 && !better; i++) { await wait(250); better = (await things()).find((t) => /better/.test(t.name)) ?? null }
  check(!!better?.controls && !(await things()).some((t) => t.id === third.made?.id) && !!third.made && Math.hypot(better.at[0] - third.made.at[0], better.at[2] - third.made.at[2]) <= 3, `left alone, the better one takes its place, alive (${better?.name} at ${better?.at}, was at ${third.made?.at})`)
  if (better) { await page.waitForTimeout(800); await driven('the better one', better, { asked: { top_kmh: 220, zero_to_100_s: 6 } }) }
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser.close()
await a.close(); await b.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('made-cars: ok (no model was run)')
process.exit(0)
