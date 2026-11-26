// Making in a lobby (#526): strangers' pages that joined a dedicated server (server.mjs, door.mjs) make things there
// with the page's own maker (page/maker.ts, handed the world over the door), and a made thing is its maker's. The real
// master (master/), server.mjs on the built static realm (`node sf/build.mjs`), two pages from a plain host, and
// clients on the wire (test/lobby.mjs) for what needs no picture: one an admin, one a hostile page.
//
//   node test/door-make.mjs [--release dist-sf] [--ports 6040]
//
// It fails unless:
//   - Ada types the words for a kept car and it stands for Bram too, and Bram drives it;
//   - Ada's words for a kept thing of cells make it: its cells are in the world (`/world/at`) and on Bram's page;
//   - with a stand-in model on Ada's page a new wish is made, Bram sees it, and the model was asked once;
//   - Bram cannot take Ada's thing out, change its record, bring it to life or pick it up, and is told why, and the
//     world is as it was; Ada's "undo" takes out hers and not Bram's; an admin takes out anyone's;
//   - with building for admins only, Ada's wish is refused before her model is asked, and says why;
//   - a hostile page on the wire is refused, the world unchanged, for: a record too big, cells outside its box, a
//     thing far from where it says it is, a thing too big, a living thing with a motor out of range, too many cells,
//     too many things standing; and over the things-a-minute limit Ada is refused while Bram still makes;
//   - a host that sends frames, notices, records and a realm shaped like wishes sends nothing to Ada's model.
// No model is run: the stand-in proves the pipeline only.
//
// Ports (from --ports, 6040 unless said): +1 the master, +2 the world's server (this machine only), +3 the pages'
// host, UDP +4 to +9 the door's ICE.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { wire as wireTo } from './lobby.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const folder = resolve(here, arg('release', 'dist-sf'))
const PORTS = Number(arg('ports', '6040')), port = (n) => PORTS + n
const scratch = mkdtempSync(join(tmpdir(), 'engine-door-make-'))
const file = join(scratch, 'world.log'), adminFile = join(scratch, 'admin'), ADMIN = 'cedar-kettle-17'
writeFileSync(adminFile, `${ADMIN}\n`, { mode: 0o600 })
const MASTER = `http://127.0.0.1:${port(1)}`, WORLD = `http://127.0.0.1:${port(2)}`
/** What one person may make here: few, so that each limit is met within the check. */
const LIMITS = { thingsMinute: 3, things: 6, cells: 400_000 }
const stops = []
const finish = (code) => { for (const s of stops.reverse()) { try { s() } catch { /* gone */ } } rmSync(scratch, { recursive: true, force: true }); process.exit(code) }

// ── The master, and the dedicated server ──
const masterDir = resolve(here, '..', 'master'), binary = join(masterDir, 'target', 'release', 'village-master')
if (!existsSync(binary) && spawnSync('cargo', ['build', '--release', '--quiet'], { cwd: masterDir, stdio: 'inherit' }).status !== 0) { console.error('the master did not build'); process.exit(1) }
const master = spawn(binary, ['--listen', `127.0.0.1:${port(1)}`, '--registrations-per-minute', '100', '--joins-per-minute', '1000', '--lookups-per-minute', '5000', '--max-lobbies-per-addr', '16'], { stdio: ['ignore', 'ignore', 'pipe'] })
stops.push(() => master.kill('SIGINT'))
for (let i = 0; ; i++) { try { await fetch(MASTER); break } catch { if (i > 100) { console.error('the master did not start'); finish(1) } await wait(100) } }
const server = spawn('node', ['server.mjs', '--world', file, '--release', folder, '--port', String(port(2)), '--master', MASTER, '--name', 'Willow Yard', '--most', '6', '--admin-password-file', adminFile, '--ice-ports', `${port(4)}-${port(9)}`,
  '--things-minute', String(LIMITS.thingsMinute), '--things', String(LIMITS.things), '--cells', String(LIMITS.cells)], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] })
stops.push(() => server.kill('SIGKILL'))
server.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(`  server: ${t}`) })
const lobby = await new Promise((done, no) => {
  const said = []
  server.stdout.on('data', (d) => { said.push(String(d)); const m = /lobby ([0-9a-z]{12}), code ([0-9a-z]{20})/.exec(said.join('')); if (m) done(m[1]) })
  server.on('exit', (code) => no(new Error(`the server ended (${code}): ${said.join('').slice(-400)}`)))
})
const site = await plain(folder, '127.0.0.1', port(3))
stops.push(() => site.stop())
const json = async (path) => { const r = await fetch(`${WORLD}${path}`); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json() }
const ground = await json('/world/ground')
const wire = (name, o = {}) => wireTo(name, { master: MASTER, lobby, pin: ground.release, stops, ...o })
const things = () => json('/world/things')

// ── Pages ──
const browser = await chrome()
stops.push(() => browser.close())
/** A page of the static realm from the plain host, joining the lobby, with making on. */
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  ${name}'s page: ${m.text().slice(0, 300)}`) })
  // A link that names a master and a lobby asks before it joins (main.ts `agreed`): this visitor says yes.
  page.on('dialog', (d) => void (d.type() === 'confirm' ? d.accept() : d.dismiss()))
  await page.goto(`${site.url}/sf/index.html?lobbies=1&master=${encodeURIComponent(MASTER)}&lobby=${lobby}&name=${name}&first=0&boards=0&fly=0&fire=0&scale=0.5&sound=0`)
  return { name, page, errors, context }
}
const joined = (p) => p.page.waitForFunction(() => globalThis.engine?.lobby?.you, null, { timeout: 120_000 }).then(() => true, () => false)
/** Stands a page's person on the street the realm parks its car in (sf/realm.json `kept`), looking west along it, once the page holds the tiles there. */
async function stand(page, dx = 0) {
  const at = () => page.evaluate((dx) => {
    const e = globalThis.engine, k = e.local.kept[0].at, x = k[0] + 80 + dx, z = k[2] + 2
    let y = 1500
    for (; y > 0 && !e.kind(x, y, z); y--);
    e.me.walk(false)
    Object.assign(e.pose, { x: x / 10, y: (y + 18) / 10, z: z / 10, yaw: -Math.PI / 2, pitch: -0.3 })
    return [x, y, z]
  }, dx)
  await at()
  await page.waitForTimeout(3000)
  const where = await at()
  await page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 }, null, { timeout: 120_000 }).catch(() => {})
  await still(page, { limit: 120_000 })
  return where
}
/** Asks the page's maker, as the bar does for words a person typed. */
const make = (p, wish, more = {}) => p.page.evaluate(([wish, more]) => globalThis.engine.ask({ wish, typed: true, ...more }), [wish, more])
const madeFor = (p, id, ms = 30_000) => p.page.waitForFunction((id) => globalThis.engine.things.all.has(id), id, { timeout: ms }).then(() => true, () => false)
const notice = (p) => p.page.evaluate(() => document.body.innerText)

try {
  // ── Two strangers, making on ─────────────────────────────────────────────────
  const ada = await open('Ada'), bram = await open('Bram')
  const both = [await joined(ada), await joined(bram)]
  check(both.every(Boolean), `two pages join the lobby through the door (${both})`)
  if (!both.every(Boolean)) throw new Error('not joined')
  const [adaYou, bramYou] = [await ada.page.evaluate(() => globalThis.engine.lobby.you), await bram.page.evaluate(() => globalThis.engine.lobby.you)]
  const adaAt = await stand(ada.page), bramAt = await stand(bram.page, 30)
  const bar = await ada.page.evaluate(() => ({ shown: getComputedStyle(document.querySelector('#ask')).display, unmake: typeof globalThis.engine.unmake }))
  check(bar.shown !== 'none' && bar.unmake === 'function', `in a lobby with making on, the bar is there (${bar.shown}) and so is the page's maker`)

  // ── A kept car: it stands for Bram, and Bram drives it ───────────────────────
  const car = await make(ada, 'a car')
  const carRecord = (await things()).find((t) => t.id === car.id)
  check(car.state === 'there' && carRecord?.by === adaYou && !!carRecord?.controls?.motor, `Ada's words for a kept car make it in the world: ${car.state}${car.why ? ` (${car.why})` : ''}, ${car.name}, by ${carRecord?.by}`)
  const bramSees = await bram.page.waitForFunction((id) => globalThis.engine.alive.things.some((t) => t.ref === id), car.id, { timeout: 30_000 }).then(() => true, () => false)
  check(bramSees, 'it stands, alive, on Bram\'s page')
  const drove = await bram.page.evaluate(async (id) => {
    const e = globalThis.engine, t = e.alive.things.find((t) => t.ref === id)
    e.alive.mount(t)
    await new Promise((r) => setTimeout(r, 800))
    const a = e.alive.where(t)?.at
    for (let i = 0; i < 30; i++) { e.alive.drive(t, 1, 0, 0); await new Promise((r) => setTimeout(r, 100)) }
    const b = e.alive.where(t)?.at
    e.alive.mount(null)
    return a && b ? Math.hypot(b[0] - a[0], b[2] - a[2]) / 10 : -1
  }, car.id)
  check(drove > 1, `Bram gets on and drives it: ${drove.toFixed(2)} m in three seconds`)

  // ── A kept thing of cells: in the world, and on Bram's page ──────────────────
  await ada.page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { yaw: e.pose.yaw + Math.PI }) })
  await ada.page.waitForTimeout(500)
  const stall = await make(ada, 'a market stall with a striped awning')
  const stallCells = stall.id ? (await json(`/world/things?id=${stall.id}`)) : null
  const sampled = []
  if (stallCells) { const g = stallCells.grain ?? 1, rows = stallCells.cells; for (let i = 0; i + 4 < rows.length; i += 5 * Math.max(1, Math.floor(rows.length / 5 / 24))) sampled.push([Math.floor(rows[i] / g), Math.floor(rows[i + 2] / g), Math.floor(rows[i + 3] / g)]) }
  const inWorld = (await Promise.all(sampled.map((c) => json(`/world/at?x=${c[0]}&y=${c[1]}&z=${c[2]}`)))).filter((a) => a.material !== 0).length
  await madeFor(bram, stall.id)
  await still(bram.page, { limit: 60_000 })
  const onBram = await bram.page.evaluate((cells) => cells.filter(([x, y, z]) => globalThis.engine.kind(x, y, z) !== 0).length, sampled)
  check(stall.state === 'there' && stallCells?.by === adaYou, `Ada's words for a kept thing of cells make it: ${stall.state}${stall.why ? ` (${stall.why})` : ''}, ${stall.name}, by ${stallCells?.by}`)
  check(sampled.length > 0 && inWorld === sampled.length && onBram === sampled.length, `its cells are in the world (${inWorld} of ${sampled.length} sampled) and on Bram's page (${onBram})`)

  // ── A new wish, with a stand-in model on Ada's page ─────────────────────────
  const STALL = { name: 'fruit stall', size: [34, 25, 18], parts: [
    ['box', 'wood', '2:6', 2, 0, 2, 4, 24, 4], ['box', 'wood', '2:6', 30, 0, 2, 32, 24, 4], ['box', 'wood', '2:6', 2, 0, 14, 4, 24, 16], ['box', 'wood', '2:6', 30, 0, 14, 32, 24, 16],
    ['box', 'wood', 'own', 2, 8, 2, 32, 9, 16], ['box', 'wood', '2:5', 4, 0, 3, 30, 8, 4],
    ['stripes', 'plaster', '0:4', 0, 24, 0, 34, 25, 18, 'x', 4, 'white'],
    ['box', 'leaves', '2:4', 6, 9, 5, 9, 11, 8], ['box', 'leaves', '0:4', 11, 9, 5, 14, 11, 8], ['ball', 'leaves', '8:4', 16, 9, 5, 19, 12, 8],
  ] }
  await ada.page.evaluate((reply) => { const e = globalThis.engine; globalThis.__asked = []; e.making.model = async (q) => { globalThis.__asked.push(q.prompt); return { text: reply } } }, JSON.stringify(STALL))
  await ada.page.evaluate(() => { const e = globalThis.engine; Object.assign(e.pose, { yaw: e.pose.yaw + Math.PI / 2 }) })
  await ada.page.waitForTimeout(500)
  const fruit = await make(ada, 'a fruit stall')
  const asked = await ada.page.evaluate(() => globalThis.__asked.slice())
  const bramSeesFruit = fruit.id ? await madeFor(bram, fruit.id) : false
  check(fruit.state === 'there' && bramSeesFruit && asked.length === 1 && asked[0] === 'a fruit stall', `with a stand-in model on Ada's page a new wish is made: ${fruit.state}${fruit.why ? ` (${fruit.why})` : ''}; Bram sees it (${bramSeesFruit}); the model was asked ${asked.length} time(s)`)

  // ── Bram and Ada's things ───────────────────────────────────────────────────
  const before = JSON.stringify((await things()).map((t) => [t.id, t.by, t.name, !!t.controls]).sort())
  const bramAsks = await bram.page.evaluate(async ({ stall, car, carControls, release }) => {
    const f = async (b) => { const r = await globalThis.engine.lobby.fetch('/world/ask', { method: 'POST', body: JSON.stringify(b) }); return [r.status, await r.text()] }
    return {
      out: await f({ gone: stall, release }),
      record: await f({ thing: { id: stall, sounds: { hum: 'bram was here' } } }),
      alive: await f({ thing: { id: stall, controls: carControls } }),
      hold: await f({ hold: stall }),
      carOut: await f({ gone: car }),
    }
  }, { stall: stall.id, car: car.id, carControls: { ...carRecord?.controls, rest: undefined, driven: undefined }, release: adaAt })
  check(Object.values(bramAsks).every(([s, why]) => s === 403 && /someone else's/.test(why)), `Bram cannot take Ada's things out, change their records, bring one to life or pick one up: ${Object.entries(bramAsks).map(([k, [s, why]]) => `${k} ${s}`).join(', ')} ("${bramAsks.out[1]}")`)
  await bram.page.evaluate((id) => globalThis.engine.hands.take(id), stall.id)
  const bramTold = await bram.page.waitForFunction(() => /someone else's/.test(document.body.innerText), null, { timeout: 10_000 }).then(() => true, () => false)
  const after = JSON.stringify((await things()).map((t) => [t.id, t.by, t.name, !!t.controls]).sort())
  check(bramTold && after === before, `his page says why when he reaches for one (${bramTold}), and the world is as it was (${after === before})`)
  const bramUndo = await bram.page.evaluate(() => globalThis.engine.unmake())
  check(bramUndo.state === 'refused' && (await things()).length === JSON.parse(before).length, `Bram's "undo" takes nothing of Ada's: ${bramUndo.why}`)

  // ── Undo is one's own last thing; an admin takes out anyone's ───────────────
  // (On the street further along, where nothing of Ada's stands.)
  const bramAt2 = await stand(bram.page, 160)
  const bramStall = await make(bram, 'a market stall with a striped awning')
  const adaUndo = await ada.page.evaluate(() => globalThis.engine.wish({ wish: 'undo' }))
  await wait(1500)
  const left = await things()
  check(bramStall.state === 'there' && adaUndo.state === 'there' && !left.some((t) => t.id === fruit.id) && left.some((t) => t.id === bramStall.id) && left.some((t) => t.id === stall.id), `Ada's "undo" takes out her last (the fruit stall) and leaves Bram's (${bramStall.state}): ${left.map((t) => `${t.name} of ${t.by === adaYou ? 'Ada' : t.by === bramYou ? 'Bram' : t.by}`).join(', ')}`)
  const cleo = await wire('Cleo')
  check((await cleo.ctl({ admin: ADMIN })).ok === true, 'Cleo, on the wire, is an admin')
  const adminOut = await cleo.fetch('/world/ask', { method: 'POST', body: { gone: bramStall.id, release: bramAt2, wait: true } })
  await wait(1000)
  check(adminOut.status === 202 && !(await things()).some((t) => t.id === bramStall.id), `an admin takes out Bram's stall (${adminOut.status} ${adminOut.text.slice(0, 80)})`)

  // ── Building for admins only: refused before any model is asked ─────────────
  check((await cleo.ctl({ lobby: { op: 'build', who: 'admins' } })).build === 'admins', 'Cleo says only admins build')
  const n0 = await ada.page.evaluate(() => globalThis.__asked.length)
  const shut = await make(ada, 'a green fruit stall')
  const n1 = await ada.page.evaluate(() => globalThis.__asked.length)
  check(shut.state === 'refused' && /only admins build/.test(shut.why ?? '') && n1 === n0, `Ada's wish is refused, and says why ("${shut.why}"), and her model was not asked (${n1 - n0})`)
  await cleo.ctl({ lobby: { op: 'build', who: 'everyone' } })

  // ── A hostile page on the wire ──────────────────────────────────────────────
  const dove = await wire('Dove')
  const doveAt = [bramAt[0] - 60, bramAt[1] + 17, bramAt[2] + 20]
  await dove.fetch('/world/here', { method: 'POST', body: { at: doveAt, yaw: 0 } })
  const floor = (await json(`/world/tops?x0=${doveAt[0]}&z0=${doveAt[2]}&x1=${doveAt[0] + 1}&z1=${doveAt[2] + 1}&y=${doveAt[1] + 100}`)).high[0] + 1
  let ids = 0
  /** A thing of whole cells, a box `size` with its footprint's middle at `at`, as an ask; `move` shifts its cells off its record. */
  const box = (at, size = [2, 2, 2], { kind = 8, move = [0, 0, 0], thing = {} } = {}) => {
    const rows = [], x0 = at[0] - (size[0] >> 1) + move[0], z0 = at[2] - (size[2] >> 1) + move[2]
    for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) rows.push(x0, x0 + size[0], at[1] + y + move[1], z0 + z, kind)
    return { edit: [1, rows.length / 5, ...rows], release: [at[0], at[1] + size[1] + 1, at[2]], thing: { id: `dove-${ids++}`, name: 'a crate', wish: 'a crate', at, size, facing: 'south', ...thing }, wait: true }
  }
  const spot = [doveAt[0], floor, doveAt[2]]
  const living = { ...carRecord.controls, rest: undefined, driven: undefined }
  const body = carRecord.size
  const hostile = {
    'a record too big': box(spot, [2, 2, 2], { thing: { parts: 'x'.repeat(14000), behaviour: 'y'.repeat(14000) } }),
    // (Four cells off: inside the room `allowed` gives any thing, outside its own box.)
    'cells outside its box': box(spot, [2, 2, 2], { move: [4, 0, 0] }),
    'far from where it says it is': box([spot[0] + 3000, spot[1], spot[2]]),
    'too big': box(spot, [300, 1, 2]),
    'a motor out of range': box(spot, body, { thing: { controls: { ...living, motor: { ...living.motor, top: 1e6 } } } }),
    'too many cells': box(spot, [100, 41, 100]),
    'a look that is no list': box(spot, body, { thing: { controls: { ...living, fine: {} } } }),
  }
  const w0 = JSON.stringify((await things()).map((t) => t.id).sort())
  const probes = [[spot[0] + 4, spot[1], spot[2]], [spot[0] + 5, spot[1] + 1, spot[2]], spot, [spot[0] + 3000, spot[1], spot[2]]]
  const cellsNow = () => Promise.all(probes.map((c) => json(`/world/at?x=${c[0]}&y=${c[1]}&z=${c[2]}`).then((a) => a.kind)))
  const k0 = JSON.stringify(await cellsNow())
  const refusedWhy = {}
  for (const [what, ask] of Object.entries(hostile)) { const r = await dove.fetch('/world/ask', { method: 'POST', body: ask }); refusedWhy[what] = r; await wait(300) }
  await wait(1000)
  const w1 = JSON.stringify((await things()).map((t) => t.id).sort())
  const kinds = await cellsNow()
  check(Object.values(refusedWhy).every((r) => r.status === 403) && w1 === w0 && JSON.stringify(kinds) === k0, `a hostile page is refused, and the world is unchanged (${w1 === w0}, cells ${kinds}): ${Object.entries(refusedWhy).map(([k, r]) => `${k}: ${r.status} "${r.text.slice(0, 70)}"`).join('; ')}`)
  // The same living thing with the car's own motor is taken: what was refused was its motor.
  const fair = await dove.fetch('/world/ask', { method: 'POST', body: box([spot[0] + 30, spot[1], spot[2]], body, { thing: { controls: living } }) })
  check(fair.status === 202, `the same body with the car's own motor is taken (${fair.status} ${fair.text.slice(0, 80)})`)
  // Things standing, all told: the most is LIMITS.things.
  const stood = []
  for (let i = 0; stood.length < LIMITS.things - 1 && i < 40; i++) {
    const r = await dove.fetch('/world/ask', { method: 'POST', body: box([spot[0] - 10 - stood.length * 4, spot[1], spot[2] - 10]) })
    if (r.status === 202) stood.push(r)
    else await wait(4000)
  }
  await wait(21_000)
  const over = await dove.fetch('/world/ask', { method: 'POST', body: box([spot[0] - 40, spot[1], spot[2] + 10]) })
  check(stood.length === LIMITS.things - 1 && over.status === 403 && /most one person may/.test(over.text), `Dove makes ${stood.length + 1} things, and the next is refused: ${over.status} "${over.text}"`)
  // Her own: taken out without its cells (which would leave them standing, counted against nobody), and put down out of reach.
  const crate = `dove-${ids - 2}`
  const recordOnly = await dove.fetch('/world/ask', { method: 'POST', body: { gone: crate } })
  const held = await dove.fetch('/world/ask', { method: 'POST', body: { hold: crate } })
  await wait(1500)
  const putFar = await dove.fetch('/world/ask', { method: 'POST', body: { put: true, at: [spot[0] + 3000, spot[1], spot[2]] } })
  const putNear = await dove.fetch('/world/ask', { method: 'POST', body: { put: true } })
  await wait(1500)
  const crateNow = (await things()).find((t) => t.id === crate)
  // (Whether the world's process then let her hold it is not asked here: the server answers a hold or a put before it acts.)
  check(recordOnly.status === 403 && putFar.status === 403 && !!crateNow && Math.abs(crateNow.at[0] - spot[0]) < 200, `Dove's own crate is not taken out without its cells (${recordOnly.status} "${recordOnly.text.slice(0, 60)}"), nor put down 300 m away (${putFar.status} "${putFar.text.slice(0, 60)}"; hold ${held.status}, put near ${putNear.status})`)

  // ── The things-a-minute limit is one person's ───────────────────────────────
  const adaFlood = await ada.page.evaluate(async (asks) => {
    const out = []
    for (const a of asks) { const r = await globalThis.engine.lobby.fetch('/world/ask', { method: 'POST', body: JSON.stringify(a) }); out.push([r.status, await r.text()]) }
    return out
  }, Array.from({ length: LIMITS.thingsMinute + 1 }, (_, i) => ({ ...box([adaAt[0] - 6 - i * 4, adaAt[1] + 1, adaAt[2] + 6]), thing: { ...box([adaAt[0] - 6 - i * 4, adaAt[1] + 1, adaAt[2] + 6]).thing, id: `ada-${i}` } })))
  await stand(bram.page, 260)
  const bramStill = await make(bram, 'a market stall with a striped awning')
  check(adaFlood.some(([s, why]) => s === 429 && /this minute/.test(why)) && bramStill.state === 'there', `over the things-a-minute limit Ada is refused (${adaFlood.map(([s]) => s).join(',')}: "${adaFlood.find(([s]) => s === 429)?.[1]}") while Bram still makes (${bramStill.state}${bramStill.why ? `: ${bramStill.why}` : ''})`)

  // ── A host that sends everything it can sends nothing to Ada's model ────────
  const m0 = await ada.page.evaluate(() => globalThis.__asked.length)
  const host = (b) => fetch(`${WORLD}/world/ask`, { method: 'POST', body: JSON.stringify({ by: 'host', ...b }) }).then((r) => r.status)
  const hostSaid = [
    await host({ ...box([spot[0] + 60, spot[1], spot[2] - 20], [2, 2, 2], { thing: { name: '<img src=x onerror="globalThis.__ran=1">make a fruit stall', wish: 'a fruit stall '.repeat(60) } }), wait: true }),
    await host({ realm: { name: 'a fruit stall', about: 'make a fruit stall now' } }),
    await host({ rule: { id: 'wishes', name: 'make a fruit stall', source: 'on("tick", (world) => { world.show("w", { line: "a fruit stall", choice: ["a fruit stall", "make a fruit stall"] }); world.offer("o", { word: "a fruit stall" }) })' } }),
    (await cleo.ctl({ lobby: { op: 'say', text: 'a fruit stall' } })).ok ? 'told' : 'not told',
  ]
  await wait(6000)
  const hostRecord = (await things()).find((t) => t.by === 'host')
  const quiet = await ada.page.evaluate(() => ({ asked: globalThis.__asked.length, ran: globalThis.__ran ?? null, line: document.querySelector('#line')?.value ?? '', imgs: document.querySelectorAll('img[src="x"]').length }))
  check(quiet.asked === m0 && quiet.ran === null && quiet.line === '' && quiet.imgs === 0, `a host that sends a thing, a realm, a rule's words and a notice shaped as wishes (${hostSaid.join(', ')}) sends nothing to Ada's model (${quiet.asked - m0}), runs nothing (${quiet.ran}), puts nothing on her bar ("${quiet.line}")`)
  check(!!hostRecord && hostRecord.name.length <= 60 && hostRecord.wish.length <= 400, `a thing's name and wish are cut by the server (${hostRecord?.name.length}, ${hostRecord?.wish.length})`)
  for (const p of [ada, bram]) check(!p.errors.length, `${p.name}'s page raised no error (${p.errors.join('; ').slice(0, 300)})`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); finish(1) }
console.log('door-make: ok (no model was run)')
finish(0)
