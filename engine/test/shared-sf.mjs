// A shared world on San Francisco (#526): `serve.mjs --world file --release <where>` keeps one world whose ground is
// the pinned release's city, held by the world's process (world.mjs) as a page's cores hold it. Two pages in it
// stand on the same real ground at three places of the release (the same as the world says from /world/at and
// /world/tops), see each other's blasts, bricks and bodies there; a page pinned to another release is refused with
// the reason shown; and the world lets go of tiles nobody is near. A server without --release is the town
// (`node test/shared.mjs` is its check).
//
//   node test/shared-sf.mjs [--release dist-sf] [--address] [--port 5971]
//
// --release is a built static realm (`node sf/build.mjs`) or a staged sf folder. --address serves that folder as a
// plain host on --port and gives the server its address in place of the folder: each object is then fetched from
// the host once and kept on disk, and a server started again on the same keeping fetches no tile again.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, chrome, has, here, serve, still } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const folder = resolve(here, arg('release', 'dist-sf'))
const scratch = mkdtempSync(join(tmpdir(), 'engine-shared-sf-'))
const file = join(scratch, 'world.log'), cache = join(scratch, 'kept')
const host = has('address') ? await plain(folder, '127.0.0.1', Number(arg('port', '5971'))) : null
const where = host ? `${host.url}/sf/current.json` : folder
const started = () => serve('/dev/null', ['--world', file, '--release', where, '--release-cache', cache])
let server = await started()
const json = async (path) => { const r = await fetch(`${server.url}${path}`); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json() }
const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// The world says what it stands on before anything else.
const said = await json('/world/ground')
check(/^[0-9a-f]{64}$/.test(said.release ?? '') && said.pointer === '/release/current.json' && said.arrive?.at?.length === 3, `the world says it stands on release ${said.release?.slice(0, 12)} and where one arrives (${said.arrive?.at?.map(Math.round)})`)
const arrive = said.arrive.at.map(Math.round)
// What is served under /release/ is the pinned release and nothing else, however a name is spelled; a bad one stops nothing.
const outside = await Promise.all(['%252e%252e/%252e%252e/%252e%252e/%252e%252e/serve.mjs', '..%5C..%5C..%5C..%5Cserve.mjs', '%2e%2e/%2e%2e/%2e%2e/%2e%2e/serve.mjs'].map((p) => fetch(`${server.url}/release/releases/${said.release}/${p}`).then((r) => r.status)))
const odd = (await fetch(`${server.url}/release/%E0`)).status, alive = (await fetch(`${server.url}/world/ground`)).status
check(outside.every((s) => s === 404) && odd >= 400 && alive === 200, `nothing outside the release is served under /release/ (${outside}), and a name that does not decode stops nothing (${odd}, then ${alive})`)
// Three places of the release: where one arrives (a hilltop park), more than a kilometre east of it on the flat by the
// bay, and west of it in a street of homes. The last two each straddle a tile's edge (tiles are 2,500 cells a side).
const places = [{ name: 'the arrival', x: arrive[0], z: arrive[2] }, { name: '1.1 km east, across a tile edge', x: 527496, z: 664000 }, { name: '0.4 km west, across a tile edge', x: 512496, z: 667000 }]
const STRIP = 8

const browser = await chrome()
const pages = []
const open = async (query = '') => {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  page error: ${m.text().slice(0, 300)}`) })
  await page.goto(`${server.url}/city?fly=0&shared=1&fire=0&scale=0.5&sound=0${query}`)
  return { page, errors }
}
/** A page's eye over a place, with the world round it made. */
const over = async (page, { x, z }) => {
  await page.evaluate(([x, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10, y: e.ground(x / 10, z / 10) + 3, z: z / 10, yaw: 0, pitch: -0.3 }) }, [x, z])
  await page.waitForTimeout(1200)
  await still(page, { limit: 120_000 })
}
/** What a page has of a strip of columns along x from a place: the ground's rule there, and the first solid cell down from y. */
const pageGround = (page, { x, z }, y) => page.evaluate(([x, z, y, n]) => {
  const e = globalThis.engine, ground = [], high = []
  for (let i = 0; i < n; i++) {
    ground.push(Math.round(e.ground((x + i) / 10, z / 10) * 10))
    let at = y
    for (; at > y - 400 && !e.kind(x + i, at, z); at--);
    high.push(at > y - 400 ? at : null)
  }
  return { ground, high }
}, [x, z, y, STRIP])
/** What the world's process says of the same columns. */
const worldGround = async ({ x, z }, y) => {
  const ground = []
  for (let i = 0; i < STRIP; i++) ground.push((await json(`/world/at?x=${x + i}&y=${y}&z=${z}`)).ground)
  const tops = await json(`/world/tops?x0=${x}&z0=${z}&x1=${x + STRIP}&z1=${z + 1}&y=${y}`)
  return { ground, high: tops.high }
}
/** A height to look down from at a place: 35 m over the world's ground there (a look down goes 40 m). */
const above = async ({ x, z }) => (await json(`/world/at?x=${x}&y=0&z=${z}`)).ground + 350
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

try {
  // ── Two pages, the same ground ───────────────────────────────────────────
  const a = await open(), b = await open()
  pages.push(a, b)
  for (const p of [a, b]) await p.page.waitForFunction(() => globalThis.engine, null, { timeout: 120_000 })
  const pinned = await a.page.evaluate(async () => (await globalThis.engine.tiles.where()).release)
  check(pinned === said.release, `a page with ?shared=1 takes the world's release from the server (${pinned?.slice(0, 12)})`)
  const heights = []
  for (const place of places) {
    for (const p of [a, b]) await over(p.page, place)
    const top = await above(place)
    const [onA, onB, world] = [await pageGround(a.page, place, top), await pageGround(b.page, place, top), await worldGround(place, top)]
    heights.push(world.ground[0])
    check(same(onA, onB) && same(onA, world) && world.ground.every((g) => g > 20) && world.high.every((h) => h !== null), `${place.name} (${place.x}, ${place.z}): both pages and the world have the same ground (${world.ground[0]} to ${world.ground[STRIP - 1]} cells) and the same first solid cells (${world.high[0]} to ${world.high[STRIP - 1]})`)
    if (!same(onA, world) || !same(onB, world)) console.log(`      a ${JSON.stringify(onA)}\n      b ${JSON.stringify(onB)}\n      world ${JSON.stringify(world)}`)
  }
  check(new Set(heights).size === 3, `the three places are land at three heights, not sea (${heights.map((h) => (h / 10).toFixed(1)).join(', ')} m)`)

  // ── A blast by one is seen by the other and by the world ─────────────────
  // Both over the arrival; a blast into the ground a few metres ahead of them.
  for (const p of [a, b]) await over(p.page, places[0])
  const spot = { x: places[0].x + 30, z: places[0].z - 40 }
  const top0 = await above(spot)
  const before = await worldGround(spot, top0)
  await a.page.evaluate(([x, y, z]) => globalThis.engine.strike([x, y, z], 14, false), [spot.x + 4, before.high[4], spot.z])
  await wait(2500)
  for (const p of [a, b]) await still(p.page, { limit: 120_000 })
  const [blastA, blastB, blastW] = [await pageGround(a.page, spot, top0), await pageGround(b.page, spot, top0), await worldGround(spot, top0)]
  check(!same(before.high, blastW.high) && same(blastA.high, blastW.high) && same(blastB.high, blastW.high), `a blast by one page breaks the ground for the other and for the world alike (first solid cells ${before.high.join(',')} before, ${blastW.high.join(',')} after)`)
  if (!same(blastA.high, blastW.high) || !same(blastB.high, blastW.high)) console.log(`      a ${blastA.high}\n      b ${blastB.high}\n      world ${blastW.high}`)

  // ── A brick laid by one stands for the other ───────────────────────────────
  const brickAt = [places[0].x - 40, 0, places[0].z + 20]
  brickAt[1] = (await worldGround({ x: brickAt[0], z: brickAt[2] }, top0)).high[0] + 1
  await b.page.evaluate(([x, y, z]) => globalThis.engine.set([x, y + 2, z], 2, 8), brickAt)
  await wait(2500)
  for (const p of [a, b]) await still(p.page, { limit: 120_000 })
  const cell = [brickAt[0], brickAt[1] + 1, brickAt[2]]
  const [kindA, kindB, kindW] = [await a.page.evaluate((c) => globalThis.engine.kind(...c), cell), await b.page.evaluate((c) => globalThis.engine.kind(...c), cell), await json(`/world/at?x=${cell[0]}&y=${cell[1]}&z=${cell[2]}`)]
  check((kindW.kind & 15) === 8 && kindA === kindW.kind && kindB === kindW.kind, `bricks laid by one page stand for the other and in the world (${kindA}, ${kindB}, ${kindW.kind}: brick is 8)`)

  // ── Each sees the other's body there ───────────────────────────────────────
  await a.page.waitForTimeout(600)
  const seen = [await a.page.evaluate(() => globalThis.engine.others), await b.page.evaluate(() => globalThis.engine.others)]
  const wren = await (await post('join', { by: 'wren' })).json()
  const near = Math.hypot(wren.you.at[0] - arrive[0], wren.you.at[2] - arrive[2])
  check(seen[0] === 1 && seen[1] === 1, `each page sees the other in the world (${seen})`)
  check(near < 120 && Math.abs(wren.you.at[1] - (await json(`/world/at?x=${wren.you.at[0]}&y=0&z=${wren.you.at[2]}`)).ground) < 40, `a seat that joins is set down where one arrives, on its ground (${wren.you.at}, ${Math.round(near)} cells off)`)
  const around = await json('/world/around?by=wren')
  check(around.residents.near === 0 && (await (await fetch(`${server.url}/world/`)).text()).includes('San Francisco at true size'), 'there are no residents in a released world, and the guide says it is San Francisco')
  await post('leave', { by: 'wren' })
  for (const p of [a, b]) check(!p.errors.length, `a page in it raised no error (${p.errors.join('; ').slice(0, 200)})`)
  for (const p of pages) await p.page.context().close()
  pages.length = 0

  // ── A page pinned to another release is refused ────────────────────────────
  const other = await open(`&release=${'a'.repeat(64)}`)
  pages.push(other)
  await other.page.waitForSelector('#refused', { timeout: 60_000 }).catch(() => null)
  const why = await other.page.evaluate(() => document.getElementById('refused')?.textContent ?? '')
  const joined = await other.page.evaluate(() => !!globalThis.engine)
  check(!joined && /pinned to San Francisco release aaaaaaaaaaaa/.test(why) && why.includes(said.release.slice(0, 12)), `a page pinned to another release does not join, and says why: "${why.slice(0, 120)}…"`)
  await other.page.context().close()
  pages.length = 0
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
await browser.close()

// ── What the world holds, and lets go of ─────────────────────────────────────
// One body at a page stands still at the arrival, then flies a kilometre east and stands, then another.
try {
  await wait(7000)
  const say = (at) => post('here', { by: 'flier', name: 'Juno', at, yaw: 0 })
  const hold = async (at, seconds) => { for (let t = 0; t < seconds * 4; t++) { await say(at); await wait(250) } return json('/world/ground') }
  const fly = async (from, metres) => { for (let m = 0; m <= metres; m += 10) { await say([from[0] + m * 10, from[1] + 600, from[2]]); await wait(100) } }
  const start = [arrive[0], arrive[1] + 20, arrive[2]]
  const still0 = await hold(start, 30)
  await fly(start, 1000)
  // Past what the world keeps of a place nobody is near (20 s) and its look round for such (every 5 s): 40 s.
  const first = await hold([start[0] + 10_000, start[1] + 600, start[2]], 40)
  await fly([start[0] + 10_000, start[1], start[2]], 1000)
  const second = await hold([start[0] + 20_000, start[1] + 600, start[2]], 40)
  const mb = (r) => `${Math.round(r.rss / 2 ** 20)} MB`
  console.log(`  standing still: ${still0.held.tiles} tiles held, ${mb(still0)}; a km on: ${first.held.tiles}, ${mb(first)}; another km on: ${second.held.tiles}, ${mb(second)}`)
  // What is held is the arrival's own ground (always) and the flier's own (#526): nothing of where the flier was is kept.
  check(first.held.spare === 0 && second.held.spare === 0 && first.held.tiles[0] <= first.held.own && second.held.tiles[0] <= 24 && second.rss < Math.max(still0.rss, first.rss) * 1.25, `the world lets go of tiles nobody is near (${still0.held.tiles[0]}, ${first.held.tiles[0]}, ${second.held.tiles[0]} of the finest held, the arrival's and the flier's own; ${second.held.spare} beyond) and its memory levels off (${mb(still0)}, ${mb(first)}, ${mb(second)})`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
server.stop()

// ── From an address: each object once, then from disk ────────────────────────
if (host) {
  const tiles = host.asked.filter((q) => /\/releases\/[0-9a-f]{64}\/tiles\//.test(q.path))
  const paths = tiles.map((q) => q.path), once = new Set(paths).size === paths.length
  check(tiles.length > 0 && once, `from an address, each tile was fetched from the host once (${paths.length} fetches, ${new Set(paths).size} tiles)`)
  const had = host.asked.length
  await wait(500)
  server = await started()
  await post('join', { by: 'wren' })
  await json(`/world/at?x=${arrive[0]}&y=900&z=${arrive[2]}`)
  const again = host.asked.slice(had).filter((q) => /\/releases\/[0-9a-f]{64}\//.test(q.path))
  check(again.length === 0, `a server started again on the same keeping holds the arrival from disk (${again.length} objects fetched again)`)
  server.stop()
  host.stop()
}
rmSync(scratch, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('shared-sf: ok')
