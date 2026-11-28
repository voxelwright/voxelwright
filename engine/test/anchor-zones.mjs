// Anchor zones (#226): what is done inside one lasts, what is done outside every one is healed back a batch at a
// time to what each cell was before anybody touched it, and a world's file loses what the heals made worthless
// without coming to anything else. First the rules alone (anchor-zones.mjs: no server, no clock); then the real
// server with a world of its own, asked by plain requests: no page and no model. The core must be built (npm run core).
//
//   node test/anchor-zones.mjs [--rules]     --rules leaves the server out
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnchorZoneManager, CELLS_MOST, POLICY, compactLogEntries, healable, policyOf } from '../anchor-zones.mjs'
import { here } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── The rules ────────────────────────────────────────────────────────────
const key = (x, y, z) => `${x},${y},${z}`
/** A world as small as it can be: what each written cell is; the rest is its ground (7 below height 0, else air). */
const ground = (y) => (y < 0 ? 7 : 0)
function world() {
  const cells = new Map()
  const read = (x, y, z) => cells.get(key(x, y, z)) ?? ground(y)
  const write = (runs) => { for (const [x0, x1, y, z, kind] of runs) for (let x = x0; x < x1; x++) cells.set(key(x, y, z), kind) }
  return { read, write, edit: (m, runs, now) => { const parted = m.recordEdit(runs, read, now); write(runs); return parted } }
}
const kinds = (w, runs) => runs.flatMap(([x0, x1, y, z]) => Array.from({ length: x1 - x0 }, (_, i) => w.read(x0 + i, y, z)))
const TTL = 1000
const manager = (more = {}) => new AnchorZoneManager({ enabled: true, regenTtlMs: TTL, maxCellsPerTick: 256, ...more })
const ALTAR = { id: 'altar', name: 'Flame Altar', owner: 'ada', center: [0, 0, 0], radius: 5, createdAt: 1 }

check(same(policyOf(), POLICY) && !POLICY.enabled && POLICY.regenTtlMs === 600_000 && POLICY.maxCellsPerTick === 256 && POLICY.compactIntervalMs === 60_000 && policyOf({ enabled: 'yes', maxCellsPerTick: 0 }).maxCellsPerTick === 256 && !policyOf({ enabled: 'yes' }).enabled, 'a policy is off unless said, and takes 10 minutes, 256 cells a tick and a compaction a minute')
{
  const m = manager()
  m.addAnchor(ALTAR)
  check(m.isProtected(0, 0, 0) && m.isProtected(5, 0, 0) && m.isProtected(3, 4, 0) && !m.isProtected(6, 0, 0) && !m.isProtected(4, 4, 0), 'a zone protects the sphere within its radius, not the box round it')
  let threw = 0
  for (const bad of [{ ...ALTAR, radius: 0 }, { ...ALTAR, id: 'A B' }, { ...ALTAR, center: [0, 0.5, 0] }]) try { m.addAnchor(bad) } catch { threw++ }
  check(threw === 3 && m.listAnchors().length === 1, 'a zone with no radius, a bad id or a centre between cells is refused')

  // Inside stays for ever; a row that crosses the edge is parted.
  const w = world()
  const parted = w.edit(m, [[-2, 12, 0, 0, 9]], 0)
  check(same(parted.protected, [[-2, 6, 0, 0, 9]]) && same(parted.ephemeral, [[6, 12, 0, 0, 9]]) && m.ephemeralCells === 6, 'a row across a zone\'s edge is parted: its cells inside are for good, those outside remembered')
  check(m.stepRegen(TTL - 1).healedCount === 0, 'nothing heals before it has waited its time')
  const healed = m.stepRegen(TTL * 1000)
  w.write(healed.runs)
  check(same(healed.runs, [[6, 12, 0, 0, 0]]) && healed.remainingEphemeral === 0 && kinds(w, [[-2, 6, 0, 0]]).every((k) => k === 9) && kinds(w, [[6, 12, 0, 0]]).every((k) => k === 0), 'long after, what was done outside is back as it was and what was done inside is untouched')
  check(m.healedTotal === 6 && m.stats().healedTotal === 6 && m.stats().ephemeralCells === 0 && m.stats().anchors[0].id === 'altar', 'the stats count what was healed')
}
{
  const ball = (radius, kind = 0) => [0, 0, 0, 0, radius, kind], row = (n) => [1, 1, 0, n, 0, 0, 0]
  check([8, 18, 40].every((r) => healable(ball(r))) && healable(ball(40, 8)) && !healable([...ball(40), ...ball(40)]) && healable(row(CELLS_MOST)) && !healable(row(CELLS_MOST + 1)), 'every single ball an ask may have is healed; more than the widest blast, or more cells in rows than are remembered, stays')
}
{
  // Gradually, in bounded batches, to the first baseline, whatever was done between.
  const m = manager({ maxCellsPerTick: 25 }), w = world()
  w.write([[100, 105, 3, 100, 4]])
  const area = [[100, 120, -1, 100, 0], [100, 120, -1, 101, 0], [100, 120, 3, 100, 0], [100, 120, 4, 100, 0]]
  const first = kinds(w, area)
  w.edit(m, [[100, 120, 3, 100, 11], [100, 120, -1, 101, 0]], 0)
  w.edit(m, [[100, 120, 4, 100, 12], [100, 120, -1, 100, 0]], 10)
  w.edit(m, [[100, 120, 3, 100, 0]], 20)
  w.edit(m, [[100, 120, 3, 100, 13]], 500)
  check(m.ephemeralCells === 80, 'a cell changed more than once is remembered once')
  check(m.stepRegen(TTL + 10).healedCount === 25 && m.ephemeralCells === 55, 'one step puts back no more than a tick\'s cells')
  // The same again, healed to the end.
  const w2 = world(), m2 = manager({ maxCellsPerTick: 25 })
  w2.write([[100, 105, 3, 100, 4]])
  for (const [runs, now] of [[[[100, 120, 3, 100, 11], [100, 120, -1, 101, 0]], 0], [[[100, 120, 4, 100, 12], [100, 120, -1, 100, 0]], 10], [[[100, 120, 3, 100, 0]], 20], [[[100, 120, 3, 100, 13]], 500]]) w2.edit(m2, runs, now)
  const batches = []
  for (let now = TTL + 10; m2.ephemeralCells && batches.length < 20; now += 100) { const s = m2.stepRegen(now); if (s.healedCount) { batches.push({ ...s, now }); w2.write(s.runs) } }
  check(batches.every((b) => b.healedCount <= 25) && batches.reduce((n, b) => n + b.healedCount, 0) === 80 && same(kinds(w2, area), first), `all of it comes back in ${batches.length} bounded batches to exactly what it was first (the 4s too)`)
  check(batches.every((b) => b.now >= 1500 || b.runs.every((r) => r[2] !== 3)) && batches.some((b) => b.runs.some((r) => r[2] === 3)), 'a cell touched again waits its whole time from then')
  const ys = batches.slice(0, 3).flatMap((b) => b.runs.map((r) => r[2]))
  check(same(ys, [...ys].sort((a, b) => a - b)) && batches[0].runs.length <= 3 && batches[0].runs.some((r) => r[1] - r[0] > 1), 'a batch comes lowest first, in long rows')
}
{
  const m = manager(), w = world()
  w.edit(m, [[10, 12, 0, 0, 3]], 0)
  check(m.stepRegen(TTL, 256, (x) => x !== 10).healedCount === 1 && m.ephemeralCells === 1 && m.stepRegen(TTL + 1).healedCount === 1, 'a cell that may not be healed yet (someone stands there) stays due, and heals when it may')
  w.edit(m, [[20, 24, 0, 0, 3]], 0)
  check(m.forget([[20, 22, 0, 0, 3]]) === 2 && same(m.stepRegen(TTL * 2).runs, [[22, 24, 0, 0, 0]]), 'cells a made thing was put in are forgotten, and not healed')
  w.edit(m, [[30, 34, 0, 0, 3]], 0)
  check(m.forget([[-1_000_000, 32, 0, 0, 3], [33, 1_000_000, 0, 0, 3]]) === 3 && same(m.stepRegen(TTL * 3).runs, [[32, 33, 0, 0, 0]]), 'a thing far bigger than what is remembered is forgotten the same')
}
{
  // Adding a zone over what was on its way back keeps it; removing one lets what is done there afterwards heal.
  const m = manager(), w = world()
  w.edit(m, [[40, 44, 0, 0, 8]], 0)
  m.addAnchor({ ...ALTAR, center: [40, 0, 0], radius: 1 })
  check(m.ephemeralCells === 2 && same(m.stepRegen(TTL).runs, [[42, 44, 0, 0, 0]]) && w.read(40, 0, 0) === 8, 'a zone added over cells on their way back makes them the world\'s for good')
  w.write([[42, 44, 0, 0, 0]])
  check(m.removeAnchor('altar') && !m.removeAnchor('altar') && m.stepRegen(TTL * 100).healedCount === 0 && w.read(40, 0, 0) === 8, 'a zone taken out leaves what stood in it')
  w.edit(m, [[40, 42, 0, 0, 2]], TTL * 100)
  const s = m.stepRegen(TTL * 101)
  w.write(s.runs)
  check(same(s.runs, [[40, 42, 0, 0, 8]]) && w.read(40, 0, 0) === 8, 'what is done there afterwards heals, back to what was built while the zone stood')
}
{
  const m = manager(), w = world()
  m.addAnchor(ALTAR)
  w.edit(m, [[50, 60, 0, 0, 3]], 100)
  w.edit(m, [[50, 55, 1, 0, 4]], 700)
  m.stepRegen(TTL + 100, 3)
  const text = m.serialize(), back = AnchorZoneManager.deserialize(text)
  check(back.serialize() === text && same(back.listAnchors(), m.listAnchors()) && back.ephemeralCells === m.ephemeralCells && back.healedTotal === 3, 'kept as text and read back, it is the same')
  const steps = (x) => [TTL + 100, TTL + 700, TTL * 5].map((now) => x.stepRegen(now).runs)
  check(same(steps(back), steps(m)), 'and heals the same cells at the same times')
  let threw = 0
  for (const bad of ['{}', 'no', '{"version":2,"anchors":[],"cells":[]}']) try { AnchorZoneManager.deserialize(bad) } catch { threw++ }
  check(threw === 3 && AnchorZoneManager.deserialize(text, { enabled: true, regenTtlMs: 5 }).policy.regenTtlMs === 5, 'what is not its keeping is refused; a policy given is used in place of the kept one')
}
{
  // A history compacted comes to the same world, without what was healed and with all that a zone keeps.
  const replay = (log) => { const w = world(); for (const e of log) if (e.runs) w.write(e.runs); return w }
  const m = manager(), w = world(), log = []
  m.addAnchor(ALTAR)
  const did = (runs, now) => { w.edit(m, runs, now); log.push({ runs }) }
  const heal = (now) => { const s = m.stepRegen(now, 10_000); w.write(s.runs); const to = { ground: [], built: [] }; for (const r of s.runs) to[r[4] === ground(r[2]) ? 'ground' : 'built'].push(r); for (const [what, runs] of Object.entries(to)) if (runs.length) log.push({ runs, heal: what }) }
  did([[-3, 3, 0, 0, 9]], 0)
  for (let i = 0; i < 50; i++) { did([[100, 130, 0, 0, 1 + (i % 5)], [100, 130, -1, 0, 0]], i); }
  const protectedEntry = log[0]
  heal(TTL + 100)
  const left = compactLogEntries(log, TTL + 100)
  check(left.length === 1 && left[0] === protectedEntry, `fifty edits outside and their heal leave nothing: ${log.length} entries to ${left.length}, the one in the zone as it was`)
  did([[200, 210, 0, 0, 6]], 5000)
  const pending = m.compactLogEntries(log, 5000)
  check(pending.length === 2 && pending[1] === log.at(-1), 'what is not healed yet stays in the history')
  // What a made thing wrote is never cut, and a heal back to the ground over it is kept.
  const history = [{ fixed: true, runs: [[0, 4, 5, 5, 3]] }, { runs: [[0, 8, 5, 5, 0]] }, { runs: [[0, 8, 5, 5, 2]] }, { heal: 'ground', runs: [[0, 8, 5, 5, 0]] }, { restated: true }]
  const cut = compactLogEntries(history, 0)
  check(cut.length === 2 && cut[0] === history[0] && same(cut[1].runs, [[0, 4, 5, 5, 0]]) && replay(cut).read(1, 5, 5) === 0, 'a heal over what is never cut keeps its word there and only there; what is only restated goes')
  const covered = compactLogEntries([{ fixed: true, covers: (x) => x === 2 }, { runs: [[0, 4, 5, 5, 2]] }, { heal: 'ground', runs: [[0, 4, 5, 5, 0]] }], 0)
  check(covered.length === 2 && same(covered[1].runs, [[2, 3, 5, 5, 0]]), 'and the same where what is never cut says only which cells it covers')

  // Many histories at random, zones coming and going and compactions in between: the world is always the same.
  let seed = 1
  const next = (n) => { seed = (seed * 48271) % 2147483647; return seed % n }
  let wrong = 0, kept = 0, whole = 0
  for (let trial = 0; trial < 300; trial++) {
    const m = manager({ maxCellsPerTick: 1 + next(20) }), w = world(), base = world()
    let log = [], full = [], now = 0
    for (let step = 0; step < 60; step++) {
      now += next(600)
      const what = next(10), x = next(20), y = next(3) - 1, runs = [[x, x + 1 + next(8), y, next(2), next(3)]]
      if (what < 5) { w.edit(m, runs, now); log.push({ runs }); full.push({ runs }) }
      else if (what === 5) { m.forget(runs); w.write(runs); const e = { fixed: true, runs }; log.push(e); full.push(e) }
      else if (what === 6) m.addAnchor({ id: `z${next(2)}`, center: [next(25), 0, 0], radius: 1 + next(4) })
      else if (what === 7) m.removeAnchor(`z${next(2)}`)
      else if (what === 8) {
        const s = m.stepRegen(now)
        w.write(s.runs)
        const to = { ground: [], built: [] }
        for (const r of s.runs) to[r[4] === ground(r[2]) ? 'ground' : 'built'].push(r)
        for (const [heal, runs] of Object.entries(to)) if (runs.length) { log.push({ heal, runs }); full.push({ heal, runs }) }
      } else log = compactLogEntries(log, now)
    }
    log = compactLogEntries(log, now)
    const a = replay(log), b = replay(full)
    for (let x = 0; x < 30; x++) for (let y = -1; y < 2; y++) for (let z = 0; z < 2; z++) if (a.read(x, y, z) !== b.read(x, y, z) || a.read(x, y, z) !== w.read(x, y, z)) wrong++
    kept += log.length; whole += full.length
  }
  check(wrong === 0 && kept < whole, `300 histories at random, compacted along the way, come to the same worlds (${whole} entries to ${kept}; ${wrong} cells wrong)`)
}

// ── The server ───────────────────────────────────────────────────────────
if (!process.argv.includes('--rules')) {
  const dir = mkdtempSync(join(tmpdir(), 'engine-anchors-')), wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const serve = async (file, more = []) => {
    const child = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null', '--world', file, ...more], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
    let said = ''
    const url = await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { said += chunk; const m = /engine page on (http:\/\/127\.0\.0\.1:\d+)/.exec(said); if (m) resolve(m[1]) })
      child.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
    })
    const ask = async (path, init) => { const r = await fetch(url + path, init); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } } }
    const post = (path, body, headers) => ask(path, { method: 'POST', body: JSON.stringify(body), headers })
    /** What every cell of a box is, asked of the world. */
    const cells = async ([x0, y0, z0, x1, y1, z1]) => {
      const at = []
      for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) at.push(`/world/at?x=${x}&y=${y}&z=${z}`)
      const out = []
      for (let i = 0; i < at.length; i += 64) out.push(...(await Promise.all(at.slice(i, i + 64).map((p) => ask(p)))).map((r) => r.body.kind))
      return out
    }
    const stats = async () => (await ask('/world/anchors')).body
    const until = async (what, ms = 30_000) => { const began = Date.now(); while (Date.now() - began < ms) { if (await what()) return true; await wait(200) } return false }
    return { url, ask, post, cells, stats, until, said: () => said, stop: () => new Promise((r) => { child.on('exit', r); child.kill() }) }
  }
  // The street where the town starts: its top cells are about y 154, and above 157 is air.
  const OUT = [690, 150, 4064, 712, 162, 4076], IN = [756, 156, 4068, 764, 160, 4072], THING = [730, 156, 4068, 736, 160, 4072]
  const rows = (kind, [x0, y0, z0, x1, y1, z1]) => { const out = []; for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) out.push(x0, x1, y, z, kind); return [1, out.length / 5, ...out] }
  let server = null
  try {
    // Off, as every server is unless told: nothing is kept of it and nothing heals.
    const off = join(dir, 'off.log')
    server = await serve(off)
    const before = await server.cells(IN)
    await server.post('/world/ask', { by: 'check', edit: rows(8, IN), release: [760, 156, 4070], wait: true })
    await wait(2500)
    const refused = await server.post('/world/anchors', { by: 'ada', id: 'altar', center: [760, 157, 4070], radius: 12 })
    const told = await server.stats()
    check(told.enabled === false && refused.status === 409 && !same(await server.cells(IN), before) && !existsSync(`${off}.anchors.json`) && !readFileSync(off, 'latin1').includes('restated'), 'a server not told to heal has no anchor zones, keeps nothing of them, and what is done stays')
    await server.stop()

    const file = join(dir, 'world.log'), flags = ['--anchor-regen-ttl', '4', '--anchor-regen-cells', '150', '--anchor-compact-interval', '1']
    server = await serve(file, flags)
    const made = await server.post('/world/anchors', { by: 'ada', id: 'altar', name: 'Flame Altar', center: [760, 157, 4070], radius: 12 })
    const foreign = await server.post('/world/anchors', { by: 'eve', id: 'eve', center: [0, 0, 0], radius: 12 }, { Origin: 'https://example.com' })
    const bad = await server.post('/world/anchors', { by: 'ada', id: 'big', center: [0, 0, 0], radius: 1e9 })
    let state = await server.stats()
    check(made.status === 201 && made.body.anchor.owner === 'ada' && foreign.status === 403 && bad.status === 400 && state.enabled && state.anchors.length === 1 && state.policy.regenTtlMs === 4000, `a zone is kept and listed; another site and a radius past the most are refused (${made.status}, ${foreign.status}, ${bad.status})`)
    // A made thing, outside every zone: it is not healed away.
    const thing = await server.post('/world/ask', { by: 'check', edit: rows(10, THING), release: [733, 156, 4070], thing: { id: 'crate', name: 'Crate', wish: 'a crate', at: [733, 156, 4070], size: [6, 4, 4], facing: 'north' }, wait: true })
    const street = await server.cells(OUT), crate = await server.cells(THING)
    // Inside the zone: a block built. Outside: a blast in the street, a ball of brick and rows of it.
    await server.post('/world/ask', { by: 'check', edit: rows(8, IN), release: [760, 156, 4070], wait: true })
    const built = await server.cells(IN)
    await server.post('/world/ask', { by: 'check', blast: [700, 154, 4070], radius: 6, wait: true })
    await server.post('/world/ask', { by: 'check', edit: [0, 694, 160, 4070, 2, 8], release: [694, 160, 4070], wait: true })
    await server.post('/world/ask', { by: 'check', edit: rows(11, [704, 156, 4068, 710, 160, 4072]), release: [707, 156, 4070], wait: true })
    const broken = await server.cells(OUT)
    state = await server.stats()
    check(thing.status === 202 && !same(broken, street) && state.ephemeralCells > 150, `a blast and building outside the zone change the street, and ${state.ephemeralCells} cells are on their way back`)
    const early = state.healedTotal
    const gradual = await server.until(async () => { const s = await server.stats(); return s.healedTotal > 0 && s.ephemeralCells > 0 })
    check(early === 0 && gradual, 'nothing heals at once, and then it heals a batch at a time')
    // Rubble that lands late waits its own time.
    const healed = await server.until(async () => (await server.stats()).ephemeralCells === 0 && same(await server.cells(OUT), street), 60_000)
    state = await server.stats()
    check(healed && same(await server.cells(OUT), street), `the street comes back exactly as it was (${state.healedTotal} cells healed, ${state.ephemeralCells} left)`)
    check(same(await server.cells(IN), built) && same(await server.cells(THING), crate), 'what was built in the zone and the made thing outside it stand untouched')
    // A made thing broken heals back to what was made.
    await server.post('/world/ask', { by: 'check', edit: rows(0, [730, 158, 4068, 736, 160, 4072]), release: [733, 158, 4070], wait: true })
    check(!same(await server.cells(THING), crate) && await server.until(async () => same(await server.cells(THING), crate), 40_000), 'what is broken off a made thing outside the zones is put back as made')
    const shrunk = await server.until(async () => {
      const kept = readFileSync(file, 'latin1')
      return (await server.stats()).ephemeralCells === 0 && !kept.includes('"blast"') && !kept.includes('"heal":"ground"') && !kept.includes('"edit":[0,694') && /was compacted/.test(server.said())
    }, 40_000)
    check(shrunk, `the world's file is compacted: the blast, the ball and the heals of the street are gone from it (${statSync(file).size} bytes)`)
    const things = (await server.ask('/world/things?id=crate')).body
    check(things.cells?.length === rows(10, THING).length - 2, 'the made thing\'s record still finds its cells in the compacted file')
    // Left to heal over a restart.
    await server.post('/world/ask', { by: 'check', edit: rows(0, [700, 150, 4064, 704, 156, 4068]), release: [702, 150, 4066], wait: true })
    await wait(1300)
    await server.stop()
    server = await serve(file, flags)
    state = await server.stats()
    check(state.anchors.length === 1 && state.ephemeralCells > 0 && same(await server.cells(IN), built) && same(await server.cells(THING), crate), `started again, it has its zone, what stands in it and ${state.ephemeralCells} cells still to heal`)
    check(await server.until(async () => (await server.stats()).ephemeralCells === 0 && same(await server.cells(OUT), street), 60_000), 'and heals them back to the street as it was')
    await wait(2500)
    await server.stop()
    server = await serve(file)
    check(same(await server.cells(OUT), street) && same(await server.cells(IN), built) && same(await server.cells(THING), crate) && (await server.stats()).enabled === false, 'the compacted file alone comes to the same world, on a server that does not heal')
    await server.stop()
    server = await serve(file, flags)
    const gone = await server.ask('/world/anchors/altar', { method: 'DELETE' }), twice = await server.ask('/world/anchors/altar', { method: 'DELETE' })
    state = await server.stats()
    check(gone.status === 200 && twice.status === 404 && state.anchors.length === 0 && same(await server.cells(IN), built), 'a zone is taken out once, and what stood in it stays')
  } catch (e) { failures.push(String(e?.stack ?? e)) } finally {
    await server?.stop().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('anchor zones: ok')
