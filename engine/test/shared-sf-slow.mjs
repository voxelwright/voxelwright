// A shared world on San Francisco from a host that is slow or says nothing (#526, the third and fourth reviews): nothing
// is answered as water while its tile is on its way, a place whose tile never comes holds up nobody who is elsewhere,
// what the release does not list is never asked of its host, and an ask that waits for its answer is told why it was
// not done. People come first: the arrival and everyone's own ground are always held, whatever else is asked, and
// what else wants ground takes it from a small spare share. A change at a place where an earlier one was refused is
// not done, and a seat's walk sees what was asked before it. Living things where nobody is sleep and hold nothing,
// and wake when someone comes. A host that says nothing at the start stops the start, plainly. No browser.
//
//   node test/shared-sf-slow.mjs [--release dist-sf] [--only <words of a step's name>]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, here, serve } from './kit.mjs'
import { plain } from '../player/serve.mjs'
import { car } from '../page/living.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const folder = resolve(here, arg('release', 'dist-sf'))
const scratch = mkdtempSync(join(tmpdir(), 'engine-shared-sf-slow-'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clock = () => performance.now()
/** One part of the check, bounded: what it throws, or not finishing in time, is a failure of that part alone. */
async function step(name, ms, fn) {
  if (arg('only', '') && !name.includes(arg('only', ''))) return
  console.log(`── ${name}`)
  let timer
  try { await Promise.race([fn(), new Promise((_, no) => { timer = setTimeout(() => no(new Error(`not done in ${ms / 1000} s`)), ms) })]) } catch (e) { check(false, `${name}: ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')}`) } finally { clearTimeout(timer) }
}

// The host: the release's folder, but one tile comes late (the first ask is never answered, the next after 12 s) and
// one never comes; others come as late as `slow` says (ms, every ask). Under /p/ the pointer never comes, under /m/
// the manifest never does. Every path asked is counted.
const LATE = 'tiles/0/211_265.bay', DEAD = 'tiles/0/202_261.bay'
const asked = new Map(), hanging = [], slow = new Map()
let lateAsked = 0
const host = await plain(folder, '127.0.0.1', 0, {
  extra: (req, res) => {
    let path = new URL(req.url, 'http://x').pathname
    asked.set(path, (asked.get(path) ?? 0) + 1)
    if (path.startsWith('/p/') && path.endsWith('current.json')) { hanging.push(res); return true }
    if (path.startsWith('/m/') && path.endsWith('manifest.json')) { hanging.push(res); return true }
    if (path.startsWith('/m/')) path = path.slice(2)
    else if (!path.endsWith(DEAD) && !path.endsWith(LATE) && ![...slow.keys()].some((k) => path.endsWith(k))) return false
    if (path.endsWith(DEAD)) { hanging.push(res); return true }
    if (path.endsWith(LATE) && ++lateAsked === 1) { hanging.push(res); return true }
    const late = path.endsWith(LATE) ? 12_000 : [...slow].find(([k]) => path.endsWith(k))?.[1] ?? 0
    void readFile(join(folder, decodeURIComponent(path))).then((b) => setTimeout(() => { res.writeHead(200); res.end(b) }, late), () => { res.writeHead(404); res.end() })
    return true
  },
})
const address = `${host.url}/sf/current.json`
// The truth: the same release from the folder, on a server of its own. Every server is stopped however this ends.
const started = []
process.on('exit', () => { for (const s of started) s.stop() })
let worlds = 0
/** A server of a world of its own on the release (the folder, or `address` with a cache of its own): the spare share is 16 tiles and the most players 8 unless said. */
const world = async (more = [], release = folder) => { const n = worlds++, s = await serve('/dev/null', [...more, '--world', join(scratch, `w${n}.log`), '--release', release, '--release-cache', join(scratch, `kept${n}`), '--ground-wait', '3000', '--tiles-most', '16', '--most', '8']); started.push(s); return s }
const truth = await serve('/dev/null', ['--world', join(scratch, 'truth.log'), '--release', folder])
started.push(truth)
const get = async (base, path) => { const t = clock(), r = await fetch(`${base}${path}`); return { status: r.status, text: await r.text(), ms: clock() - t } }
const json = async (base, path) => JSON.parse((await get(base, path)).text)
const send = async (base, path, body) => { const t = clock(), r = await fetch(`${base}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, text: await r.text(), ms: clock() - t } }
const at = (x, y, z) => `/world/at?x=${x}&y=${y}&z=${z}`
const centre = (key) => { const [tx, tz] = key.split('/').pop().replace('.bay', '').split('_').map(Number); return [tx * 2500 + 1250, tz * 2500 + 1250] }
const said = await json(truth.url, '/world/ground'), arrive = said.arrive.at.map(Math.round)
const dir = `releases/${said.release}/`, manifest = await json(truth.url, `/release/${dir}manifest.json`)
const keys = Object.keys(manifest.levels[0].tiles)
const tileOf = (x, z) => [Math.floor(x / 2500), Math.floor(z / 2500)]
/** Tiles (keys) at least `apart` tiles from every place given (Chebyshev), each from the others too, as many as asked. */
function spread(n, apart, from = []) {
  const out = [], away = (k, places) => { const [tx, tz] = k.split('_').map(Number); return places.every(([px, pz]) => { const [ux, uz] = tileOf(px, pz); return Math.max(Math.abs(tx - ux), Math.abs(tz - uz)) >= apart }) }
  for (const k of keys) if (out.length < n && !k.includes('211_265') && !k.includes('202_261') && away(k, [...from, ...out.map(centre)])) out.push(k)
  return out
}
/** Which living things have a body now, as a page that joins is told: thing id to body. */
async function living(base) {
  const stop = new AbortController(), r = await fetch(`${base}/world/stream?from=999999999`, { signal: stop.signal }), reader = r.body.getReader(), out = new Map()
  let buf = new Uint8Array(0), now = false
  const quiet = setTimeout(() => stop.abort(), 1500)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const b = new Uint8Array(buf.length + value.length); b.set(buf); b.set(value, buf.length); buf = b
      while (buf.length >= 12) {
        const v = new DataView(buf.buffer, buf.byteOffset), kind = v.getUint32(0, true), size = v.getUint32(8, true)
        if (buf.length < 12 + size) break
        const payload = buf.slice(12, 12 + size); buf = buf.slice(12 + size)
        if (kind === 4) now = true
        else if (kind === 7 && now) { const l = JSON.parse(new TextDecoder().decode(payload)); out.set(l.thing, l.body) }
        else if (now) { stop.abort(); return out }
      }
    }
  } catch { /* stopped */ } finally { clearTimeout(quiet); stop.abort() }
  return out
}
/** Asks again every `every` ms until `ok` holds of what comes back, or `ms` pass: what came last. */
async function until(fn, ok, ms, every = 500) { const t0 = clock(); let v; for (;;) { v = await fn(); if (ok(v) || clock() - t0 > ms) return v; await wait(every) } }
/** A hand-written car's cells as an ask (page/living.ts `car`), lying at `low`, under an id. */
function carAsk(by, id, low) {
  const c = car(low), rows = []
  for (let y = 0; y < c.size[1]; y++) for (let z = 0; z < c.size[2]; z++) for (let x = 0; x < c.size[0];) {
    const k = c.cells[x + c.size[0] * (z + c.size[2] * y)]
    if (!k) { x++; continue }
    let x1 = x + 1
    while (x1 < c.size[0] && c.cells[x1 + c.size[0] * (z + c.size[2] * y)] === k) x1++
    rows.push(low[0] + x, low[0] + x1, low[1] + y, low[2] + z, k)
    x = x1
  }
  const mid = [low[0] + 21, low[1], low[2] + 9]
  return { by, edit: [1, rows.length / 5, ...rows], release: [low[0] - 2, low[1] + 1, low[2]], wait: true, thing: { id, name: 'car', wish: '', at: mid, size: c.size, facing: 'east', controls: { scheme: c.controls, motor: c.motor } } }
}

try {
  // ── The third review's steps, on a host that is slow ──────────────────────────
  await step('a late tile, a dead tile, and what the release does not list', 180_000, async () => {
    const server = await world([], address)
    await send(server.url, 'join', { by: 'wren' })
    const warm = await get(server.url, at(arrive[0], 900, arrive[2]))
    check(warm.status === 200, `the arrival answers (${warm.status}, ${Math.round(warm.ms)} ms)`)
    // What a seat at the arrival sees: once its ground has all come (the arrival's is asked for from the start).
    const first = await until(() => get(server.url, '/world/around?by=wren'), (a) => a.status === 200, 20_000)
    check(first.status === 200, `a seat at the arrival sees round it (${first.status})`)

    // A tile that comes late is never answered as water.
    const [lx, lz] = [527490, 664000], real = await get(truth.url, at(lx, 0, lz))
    const answers = []
    for (let t0 = clock(); clock() - t0 < 75_000;) {
      const a = await get(server.url, at(lx, 0, lz))
      answers.push(a)
      if (a.status === 200) break
      await wait(2000)
    }
    const wrong = answers.filter((a) => a.status === 200 && a.text !== real.text), last = answers.at(-1)
    check(!wrong.length && last.status === 200 && last.text === real.text, `a tile that comes late is answered only once it is there (${answers.map((a) => a.status).join(',')}; ${last.text} = ${real.text})`)
    check(answers.every((a) => a.ms < 4000), `and nobody waited on it more than the bound (longest ${Math.round(Math.max(...answers.map((a) => a.ms)))} ms)`)

    // A tile that never comes holds up nobody elsewhere.
    const [dx, dz] = centre(DEAD)
    const dead = get(server.url, at(dx, 500, dz))
    await wait(300)
    const [bystander, ground] = await Promise.all([get(server.url, at(arrive[0], 900, arrive[2])), get(server.url, '/world/ground')])
    await send(server.url, 'here', { by: 'juno', name: 'Juno', at: [arrive[0] + 30, arrive[1] + 20, arrive[2]], yaw: 0 })
    const around = await get(server.url, '/world/around?by=wren')
    const deadAnswer = await dead
    check(deadAnswer.status === 503 && deadAnswer.ms < 4500 && /ground/.test(deadAnswer.text), `a question where the tile never comes is answered why not within the bound (${deadAnswer.status} in ${Math.round(deadAnswer.ms)} ms: ${deadAnswer.text.slice(0, 60)})`)
    check(bystander.status === 200 && bystander.ms < 1000 && ground.ms < 1000 && around.ms < 1000 && JSON.parse(around.text).people.some((p) => p.name === 'Juno'), `meanwhile a question at the arrival took ${Math.round(bystander.ms)} ms, the world's ground ${Math.round(ground.ms)} ms, and a page's place was seen at once (${Math.round(around.ms)} ms)`)
    let worst = 0, stop = false
    const by = (async () => { while (!stop) { const a = await get(server.url, at(arrive[0], 900, arrive[2])); worst = Math.max(worst, a.ms); await wait(250) } })()
    const deadCodes = []
    for (let i = 0; i < 10; i++) { deadCodes.push((await get(server.url, at(dx + i, 500, dz))).status); await wait(2000) }
    stop = true; await by
    check(worst < 1000 && deadCodes.every((c) => c === 503), `asked at the dead place every 2 s for 20 s (${deadCodes.join(',')}), the arrival never took more than ${Math.round(worst)} ms`)
    const refused = await send(server.url, 'ask', { by: 'wren', blast: [dx, 500, dz], radius: 3, wait: true })
    const done = await send(server.url, 'ask', { by: 'wren', blast: [arrive[0] + 40, 830, arrive[2] + 40], radius: 3, wait: true })
    check(refused.status === 503 && /ground/.test(refused.text) && done.status === 202, `a waited blast where the ground has not come is refused with why (${refused.status}: ${refused.text.slice(0, 60)}), one at the arrival is done (${done.status})`)
    // A page's own ask (no wait) is answered once it is decided: refused with why where its ground does not come.
    const plainAsk = await send(server.url, 'ask', { by: 'juno', blast: [dx, 500, dz], radius: 3 })
    check(plainAsk.status === 503 && /ground/.test(plainAsk.text), `a page's ask that is refused is answered so, with why (${plainAsk.status} in ${Math.round(plainAsk.ms)} ms: ${plainAsk.text.slice(0, 50)})`)

    // Only what the release lists is asked of its host.
    const manifestHere = await json(server.url, `/release/${dir}manifest.json`), name = Object.values(manifestHere.names)[0].path
    const outside = await Promise.all([`${dir}nothing.bin`, `${dir}tiles/0/999_999.bay`, `${dir}names/%252e%252e/tiles/0/206_265.bay`].map((p) => get(server.url, `/release/${p}`).then((a) => a.status)))
    const named = [await get(server.url, `/release/${dir}${name}`), await get(server.url, `/release/${dir}${name}`)]
    const unlisted = [...asked.keys()].filter((p) => p.endsWith('nothing.bin') || p.includes('999_999'))
    check(outside.every((s) => s === 404) && !unlisted.length, `names the release does not list are not served (${outside}) nor asked of its host (${unlisted.length} asks)`)
    check(named.every((a) => a.status === 200) && asked.get(`/sf/${dir}${name}`) === 1, `a name it lists is served, checked and kept: asked of the host ${asked.get(`/sf/${dir}${name}`)} time for two asks`)

    // A question at every tile at once: the arrival and its people keep their ground, and nothing else passes the spare.
    let worstSweep = 0, stop2 = false
    const by2 = (async () => { while (!stop2) { const a = await get(server.url, at(arrive[0], 900, arrive[2])); worstSweep = Math.max(worstSweep, a.ms); await wait(200) } })()
    const t0 = clock(), codes = await Promise.all(keys.map((k) => get(server.url, at(...centre(k).flatMap((v, i) => (i ? [500, v] : [v])))).then((a) => a.status)))
    const sweptMs = clock() - t0, after = await json(server.url, '/world/ground')
    stop2 = true; await by2
    const counts = codes.reduce((o, c) => ({ ...o, [c]: (o[c] ?? 0) + 1 }), {})
    const arrival = await get(server.url, at(arrive[0], 900, arrive[2])), arrivalTruth = await get(truth.url, at(arrive[0], 900, arrive[2]))
    console.log(`  swept ${keys.length} tiles in ${Math.round(sweptMs)} ms: ${JSON.stringify(counts)}; held ${after.held.tiles} (own ${after.held.own}, spare ${after.held.spare}), ${Math.round(after.rss / 2 ** 20)} MB; the arrival's slowest answer meanwhile ${Math.round(worstSweep)} ms`)
    check(after.held.spare <= 16 && after.held.tiles[0] <= after.held.own + 16 && worstSweep < 1000 && arrival.status === 200 && arrival.text === arrivalTruth.text, `a question at every tile at once leaves at most 16 held beyond people's own (${after.held.tiles[0]} held, ${after.held.own} own), and the arrival still answers as it is (${arrival.text} = ${arrivalTruth.text})`)
    server.stop()
  })

  // ── People come first ───────────────────────────────────────────────────────
  await step('seven seats far apart, the arrival, a full server, and the spare used up', 120_000, async () => {
    const server = await world()
    let far = spread(7, 4, [[arrive[0], arrive[2]]]).map(centre)
    if (far.length < 7) far = spread(7, 3, [[arrive[0], arrive[2]]]).map(centre)
    const joins = []
    for (const [i, [x, z]] of far.entries()) joins.push(await send(server.url, 'join', { by: `seat-${i}`, at: [x, z] }))
    check(joins.every((j) => j.status === 200), `seven seats join a kilometre or more apart (${joins.map((j) => j.status)})`)
    const arriving = await send(server.url, 'join', { by: 'zed' }), there = await get(server.url, at(arrive[0], 900, arrive[2])), real = await get(truth.url, at(arrive[0], 900, arrive[2]))
    check(arriving.status === 200 && arriving.ms < 1500 && there.status === 200 && there.text === real.text, `then a join at the arrival is let in (${arriving.status} in ${Math.round(arriving.ms)} ms: ${arriving.text.slice(0, 50)}) and a question there answered (${there.status}, ${Math.round(there.ms)} ms)`)
    // Eight people now, each with their ground.
    await wait(1500)
    const mine = await Promise.all(far.map(([x, z]) => get(server.url, at(x, 0, z)).then(async (a) => a.status === 200 && a.text === (await get(truth.url, at(x, 0, z))).text)))
    const full = await json(server.url, '/world/ground')
    console.log(`  a full server of 8, seven a kilometre or more apart: ${full.held.tiles[0]} tiles held (${full.held.own} own, ${full.held.spare} spare), ${full.held.players} players, ${Math.round(full.rss / 2 ** 20)} MB`)
    check(mine.every(Boolean) && full.held.players === 8, `a full server of eight: each of them is answered where they stand (${mine.filter(Boolean).length} of 7 far, and the arrival)`)
    // Questions about 24 places nobody is at, all at once: the spare takes 16 at most, the rest are refused at once, and nobody's own ground is touched.
    const places = spread(24, 2, [...far, [arrive[0], arrive[2]]]).map(centre)
    const [answers, own] = await Promise.all([Promise.all(places.map(([x, z]) => get(server.url, at(x, 500, z)))), (async () => { await wait(50); return get(server.url, at(far[0][0], 0, far[0][1])) })()])
    const refusedFull = answers.filter((a) => a.status === 503 && /holds as much/.test(a.text)), after = await json(server.url, '/world/ground')
    check(places.length > 16 && refusedFull.length >= places.length - 16 && refusedFull.every((a) => a.ms < 1000) && own.status === 200 && own.ms < 1000 && after.held.spare <= 16, `with the spare used up, ${refusedFull.length} of ${places.length} far questions are refused, each in under a second (slowest ${Math.round(Math.max(0, ...refusedFull.map((a) => a.ms)))} ms), while a person's own ground answers in ${Math.round(own.ms)} ms; spare ${after.held.spare}`)
    server.stop()
  })

  await step('blasts high in the air everywhere do not keep a newcomer out', 90_000, async () => {
    const server = await world()
    const targets = spread(12, 2, [[arrive[0], arrive[2]]]).map(centre)
    const places = spread(6, 1, [[arrive[0], arrive[2]], ...targets]).map(centre)
    let stop = false, blasts = 0
    const vex = (async () => {
      for (let round = 0; !stop; round++) {
        if (round % 5 === 0) await Promise.all(targets.map(([x, z]) => send(server.url, 'ask', { by: 'vex', blast: [x, 3000, z], radius: 3 }).then(() => blasts++)))
        await send(server.url, 'here', { by: 'vex', name: 'Vex', at: [arrive[0], arrive[1] + 20, arrive[2]], yaw: 0 })
        await wait(2000)
      }
    })()
    await wait(1500)
    const newcomers = []
    for (const [i, [x, z]] of places.entries()) {
      const j = await send(server.url, 'join', { by: `new-${i}`, at: [x, z] }), a = await get(server.url, at(x, 0, z))
      newcomers.push(`${j.status}/${a.status}`)
      await wait(4000)
    }
    stop = true; await vex
    check(places.length === 6 && newcomers.every((n) => n === '200/200'), `while ${blasts} blasts went off over twelve far places, every newcomer joined and was answered where they stood (${newcomers.join(' ')})`)
    server.stop()
  })

  // ── A change waits for what was asked before it at its place ─────────────────
  await step('a change after a refused one at the same place is not done; elsewhere it is', 60_000, async () => {
    // A spare of 64: what is asked far off here waits for its tile, and is not refused at once for room.
    const server = await world(['--tiles-most', '64'], address)
    const [slowKey] = spread(1, 4, [[arrive[0], arrive[2]]]), [px, pz] = centre(slowKey)
    slow.set(`tiles/0/${slowKey}.bay`, 3300)
    const g = JSON.parse((await get(truth.url, at(px, 0, pz))).text).ground, [ax, az] = [arrive[0] + 60, arrive[2] + 60], ga = JSON.parse((await get(truth.url, at(ax, 0, az))).text).ground
    await send(server.url, 'join', { by: 'ada' })
    await until(() => get(server.url, '/world/around?by=ada'), (a) => a.status === 200, 20_000)
    const t0 = clock()
    const a = send(server.url, 'ask', { by: 'ada', edit: [0, px, g + 8, pz, 6, 8], release: [px, g + 8, pz], wait: true }).then((r) => ({ ...r, end: clock() - t0 }))
    await wait(500)
    const b = send(server.url, 'ask', { by: 'ada', edit: [0, px, g - 1, pz, 4, 0], release: [px, g, pz], wait: true }).then((r) => ({ ...r, end: clock() - t0 }))
    await wait(200)
    const c = await send(server.url, 'ask', { by: 'ada', edit: [0, ax, ga + 6, az, 2, 8], release: [ax, ga + 6, az], wait: true }), cEnd = clock() - t0
    const [A, B] = await Promise.all([a, b])
    check(A.status === 503 && B.status === 503 && /before this at the same place/.test(B.text), `A at a tile that comes in 3.3 s is refused (${A.status} at ${Math.round(A.end)} ms), and B, asked after it at the same place, is not done (${B.status} at ${Math.round(B.end)} ms: ${B.text.slice(0, 60)})`)
    check(c.status === 202 && /laid/.test(c.text) && cEnd < A.end, `meanwhile C elsewhere, by the same name, was laid at ${Math.round(cEnd)} ms, before A was answered`)
    const came = await until(() => get(server.url, at(px, g - 1, pz)), (r) => r.status === 200, 15_000)
    const real = await get(truth.url, at(px, g - 1, pz))
    check(came.status === 200 && came.text === real.text && JSON.parse(came.text).kind !== 0, `once the tile is there, the ground under B is whole: B's hole was never laid (${came.text} = ${real.text})`)
    slow.delete(`tiles/0/${slowKey}.bay`)

    // A seat walks after a wall is asked in its way, while an ask far off waits for its ground: the walk sees the wall.
    const [slowKey2] = spread(1, 4, [[arrive[0], arrive[2]], [px, pz]]), [qx, qz] = centre(slowKey2)
    slow.set(`tiles/0/${slowKey2}.bay`, 6000)
    const me = JSON.parse((await send(server.url, 'join', { by: 'bo', at: [arrive[0] - 300, arrive[2]] })).text).you
    await until(() => get(server.url, '/world/around?by=bo'), (r) => r.status === 200, 20_000)
    const [bx, by, bz] = me.at, wallZ = bz - 10, rows = []
    for (let y = by - 2; y < by + 30; y++) for (let z = wallZ - 12; z < wallZ; z++) rows.push(bx - 40, bx + 40, y, z, 7)
    void send(server.url, 'ask', { by: 'vex', blast: [qx, 500, qz], radius: 3 })
    await wait(100)
    void send(server.url, 'ask', { by: 'bo', edit: [1, rows.length / 5, ...rows], release: [bx, by + 31, wallZ - 3] })
    await wait(50)
    const walked = await send(server.url, 'walk', { by: 'bo', to: [bx, bz - 70] })
    const seen = []
    for (let t = clock(); clock() - t < 6000;) { const r = await get(server.url, '/world/around?by=bo'); if (r.status === 200) seen.push(JSON.parse(r.text).you.at); await wait(250) }
    // Where the wall stands, a body is on top of it (seats climb), or round it: never in it.
    const inside = seen.filter(([x, y, z]) => z >= wallZ - 12 && z < wallZ && Math.abs(x - bx) < 40 && y < by + 29)
    check(walked.status === 200 && seen.length > 10 && !inside.length, `a walk asked after a wall at the same place never goes through it (${inside.length} of ${seen.length} places inside it; highest ${Math.max(...seen.map((p) => p[1])) - by} cells up, last ${seen.at(-1)})`)
    slow.delete(`tiles/0/${slowKey2}.bay`)
    server.stop()
  })

  // ── Living things where nobody is ───────────────────────────────────────────
  await step('a living thing sleeps where nobody is, wakes when someone comes, and stands when its ground comes', 150_000, async () => {
    // A place on land a kilometre or more from the arrival.
    let fKey, g
    for (const k of spread(40, 4, [[arrive[0], arrive[2]]])) { g = JSON.parse((await get(truth.url, at(...centre(k).flatMap((v, i) => (i ? [0, v] : [v]))))).text).ground; if (g > 20) { fKey = k; break } }
    const [fx, fz] = centre(fKey), file = join(scratch, 'living.log')
    const first = await serve('/dev/null', ['--world', file, '--release', address, '--release-cache', join(scratch, 'kept-living-1'), '--ground-wait', '3000', '--tiles-most', '16', '--most', '8'])
    started.push(first)
    await send(first.url, 'join', { by: 'ines', at: [fx, fz] })
    const made = [await send(first.url, 'ask', carAsk('ines', 'car-a', [fx - 20, g + 2, fz - 60])), await send(first.url, 'ask', carAsk('ines', 'car-b', [fx - 20, g + 2, fz + 60]))]
    check(made.every((m) => m.status === 202 && /"alive":true/.test(m.text)), `two cars are made far from the arrival, where someone stands (${made.map((m) => m.text.slice(0, 40))})`)
    await send(first.url, 'leave', { by: 'ines' })
    const slept = await until(() => living(first.url), (l) => !l.get('car-a') && !l.get('car-b'), 15_000)
    check(!slept.get('car-a') && !slept.get('car-b'), `once nobody is near they sleep: no body in the world (${[...slept]})`)
    const bare = await until(() => json(first.url, '/world/ground'), (w) => w.held.spare === 0, 45_000, 1000)
    check(bare.held.spare === 0 && bare.held.asleep === 2, `and hold no tile: ${bare.held.tiles[0]} held, all of them the arrival's own (${bare.held.own}); ${bare.held.asleep} asleep`)
    let stop = false
    const juno = (async () => { while (!stop) { await send(first.url, 'here', { by: 'juno', name: 'Juno', at: [fx, g + 30, fz], yaw: 0 }); await wait(1000) } })()
    const woke = await until(() => living(first.url), (l) => l.get('car-a') > 0 && l.get('car-b') > 0, 20_000)
    stop = true; await juno
    check(woke.get('car-a') > 0 && woke.get('car-b') > 0, `someone comes to them and they wake (${[...woke]})`)
    first.stop()

    // Started again on a host that gives their ground only after 6 s: nobody is near, so they are not stood up; one is
    // taken out at once, and the other stands once someone comes and its ground has come.
    slow.set(`tiles/0/${fKey}.bay`, 6000)
    const again = await serve('/dev/null', ['--world', file, '--release', address, '--release-cache', join(scratch, 'kept-living-2'), '--ground-wait', '3000', '--tiles-most', '16', '--most', '8'])
    started.push(again)
    await wait(500)
    const out = await send(again.url, 'ask', { by: 'ines', gone: 'car-a', release: [fx, g + 5, fz - 50], wait: true })
    check(out.status === 202, `a thing not stood up yet is taken out at once (${out.status}: ${out.text.slice(0, 60)})`)
    stop = false
    const t0 = clock()
    const juno2 = (async () => { while (!stop) { await send(again.url, 'here', { by: 'juno', name: 'Juno', at: [fx, g + 30, fz], yaw: 0 }); await wait(1000) } })()
    const stood = await until(() => living(again.url), (l) => l.get('car-b') > 0, 25_000)
    stop = true; await juno2
    const things = await json(again.url, '/world/things')
    check(stood.get('car-b') > 0 && !stood.has('car-a') && !things.some((t) => t.id === 'car-a') && things.some((t) => t.id === 'car-b'), `the other stands once its ground has come (${Math.round(clock() - t0)} ms after someone came; ${[...stood]}), and the one taken out is gone`)
    slow.delete(`tiles/0/${fKey}.bay`)
    again.stop()
  })

  // ── A spare tile something waits on is never let go to make room ─────────────
  await step('a tile a question waits on is not let go for another', 40_000, async () => {
    const server = await world(['--tiles-most', '2'], address)
    // Two tiles side by side far from the arrival: the second comes in 2.6 s. A question over both waits on both.
    const pairKey = keys.find((k) => { const [tx, tz] = k.split('_').map(Number); return keys.includes(`${tx + 1}_${tz}`) && spread(200, 3, [[arrive[0], arrive[2]]]).includes(k) && !k.includes('202_261') && !k.includes('211_265') && !k.includes('210_265') })
    const [tx, tz] = pairKey.split('_').map(Number), edge = (tx + 1) * 2500, mz = tz * 2500 + 1250, other = `${tx + 1}_${tz}`
    slow.set(`tiles/0/${other}.bay`, 2600)
    const third = spread(200, 3, [[arrive[0], arrive[2]], [edge, mz]]).map(centre)[0]
    await send(server.url, 'join', { by: 'wren' })
    await until(() => get(server.url, '/world/around?by=wren'), (a) => a.status === 200, 20_000)
    const top = JSON.parse((await get(truth.url, at(edge, 0, mz))).text).ground + 150
    const box = `/world/tops?x0=${edge - 10}&z0=${mz - 5}&x1=${edge + 10}&z1=${mz + 5}&y=${top}`
    const tops = get(server.url, box)
    await wait(2200)
    const shove = await get(server.url, at(third[0], 500, third[1]))
    const [answer, real] = [await tops, await get(truth.url, box)]
    check(shove.status === 503 && /holds as much/.test(shove.text) && shove.ms < 1000, `with the spare (2) held by a question still waiting, another is refused at once (${shove.status} in ${Math.round(shove.ms)} ms)`)
    check(answer.status === 200 && answer.text === real.text && JSON.parse(answer.text).high.some((h) => h !== null), `and the waiting question is answered from the ground it waited for (${answer.status}: ${answer.text.slice(0, 60)} = ${real.text.slice(0, 60)})`)
    slow.delete(`tiles/0/${other}.bay`)
    server.stop()
  })

  // ── A host that says nothing at the start ────────────────────────────────────
  await step('a host that stalls the pointer or the manifest fails the start, plainly, in bounded time', 45_000, async () => {
    const start = (release, n) => new Promise((done) => {
      const t0 = clock(), child = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null', '--world', join(scratch, `stall${n}.log`), '--release', release, '--release-cache', join(scratch, `kept-stall${n}`)], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] })
      let err = ''
      child.stderr.on('data', (d) => { err += d })
      const kill = setTimeout(() => child.kill(), 30_000)
      child.on('exit', (code) => { clearTimeout(kill); done({ code, ms: clock() - t0, err: err.trim().split('\n').at(-1) ?? '' }) })
    })
    const [pointer, manifestStall] = await Promise.all([start(`${host.url}/p/sf/current.json`, 1), start(`${host.url}/m/sf/current.json`, 2)])
    for (const [what, r] of [['the pointer', pointer], ['the manifest', manifestStall]]) check(r.code !== 0 && r.code !== null && r.ms < 20_000 && /no release at/.test(r.err), `a host that never gives ${what}: the server stops in ${Math.round(r.ms / 1000)} s, saying "${r.err.slice(0, 110)}"`)
  })
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
for (const res of hanging) res.destroy()
for (const s of started) s.stop()
host.stop()
rmSync(scratch, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('shared-sf-slow: ok')
