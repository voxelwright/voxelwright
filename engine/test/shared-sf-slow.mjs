// A shared world on San Francisco from a host that is slow or says nothing (#526, the third review): nothing is
// answered as water while its tile is on its way, a place whose tile never comes holds up nobody who is elsewhere
// (questions, `here`, asks), what the release does not list is never asked of its host, the world holds no more of the
// city than it may, and an ask that waits for its answer is told why it was not done. No browser: it asks the server.
//
//   node test/shared-sf-slow.mjs [--release dist-sf]
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, here, serve } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const folder = resolve(here, arg('release', 'dist-sf'))
const scratch = mkdtempSync(join(tmpdir(), 'engine-shared-sf-slow-'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clock = () => performance.now()

// The host: the release's folder, but one tile comes late (the first ask is never answered, the next after 12 s) and
// one never comes. Every path asked is counted.
const LATE = 'tiles/0/211_265.bay', DEAD = 'tiles/0/202_261.bay'
const asked = new Map(), hanging = []
let lateAsked = 0
const host = await plain(folder, '127.0.0.1', 0, {
  extra: (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    asked.set(path, (asked.get(path) ?? 0) + 1)
    if (path.endsWith(DEAD)) { hanging.push(res); return true }
    if (path.endsWith(LATE)) {
      if (++lateAsked === 1) { hanging.push(res); return true }
      void readFile(join(folder, decodeURIComponent(path))).then((b) => setTimeout(() => { res.writeHead(200); res.end(b) }, 12_000))
      return true
    }
    return false
  },
})
// The truth: the same release from the folder, on a server of its own. Every server is stopped however this ends.
const started = []
process.on('exit', () => { for (const s of started) s.stop() })
const truth = await serve('/dev/null', ['--world', join(scratch, 'truth.log'), '--release', folder])
const server = await serve('/dev/null', ['--world', join(scratch, 'world.log'), '--release', `${host.url}/sf/current.json`, '--release-cache', join(scratch, 'kept'), '--ground-wait', '3000', '--tiles-most', '64'])
started.push(truth, server)
const get = async (base, path) => { const t = clock(), r = await fetch(`${base}${path}`); return { status: r.status, text: await r.text(), ms: clock() - t } }
const json = async (base, path) => JSON.parse((await get(base, path)).text)
const post = (path, body) => fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) })
const said = await json(server.url, '/world/ground'), arrive = said.arrive.at.map(Math.round)
const at = (x, y, z) => `/world/at?x=${x}&y=${y}&z=${z}`
const centre = (key) => { const [tx, tz] = key.split('/').pop().replace('.bay', '').split('_').map(Number); return [tx * 2500 + 1250, tz * 2500 + 1250] }

try {
  // ── Warm: someone is at the arrival ─────────────────────────────────────────
  await post('join', { by: 'wren' })
  const warm = await get(server.url, at(arrive[0], 900, arrive[2]))
  check(warm.status === 200, `the arrival answers (${warm.status}, ${Math.round(warm.ms)} ms)`)

  // ── A tile that comes late is never answered as water ───────────────────────
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

  // ── A tile that never comes holds up nobody elsewhere ───────────────────────
  const [dx, dz] = centre(DEAD)
  const dead = get(server.url, at(dx, 500, dz))
  await wait(300)
  const [bystander, ground] = await Promise.all([get(server.url, at(arrive[0], 900, arrive[2])), get(server.url, '/world/ground')])
  await post('here', { by: 'juno', name: 'Juno', at: [arrive[0] + 30, arrive[1] + 20, arrive[2]], yaw: 0 })
  const around = await get(server.url, '/world/around?by=wren')
  const deadAnswer = await dead
  check(deadAnswer.status === 503 && deadAnswer.ms < 4500 && /ground/.test(deadAnswer.text), `a question where the tile never comes is answered why not within the bound (${deadAnswer.status} in ${Math.round(deadAnswer.ms)} ms: ${deadAnswer.text.slice(0, 60)})`)
  check(bystander.status === 200 && bystander.ms < 1000 && ground.ms < 1000 && around.ms < 1000 && JSON.parse(around.text).people.some((p) => p.name === 'Juno'), `meanwhile a question at the arrival took ${Math.round(bystander.ms)} ms, the world's ground ${Math.round(ground.ms)} ms, and a page's place was seen at once (${Math.round(around.ms)} ms)`)
  // Someone asks at the dead place every two seconds; someone else at the arrival four times a second.
  let worst = 0, stop = false
  const by = (async () => { while (!stop) { const a = await get(server.url, at(arrive[0], 900, arrive[2])); worst = Math.max(worst, a.ms); await wait(250) } })()
  const deadCodes = []
  for (let i = 0; i < 10; i++) { deadCodes.push((await get(server.url, at(dx + i, 500, dz))).status); await wait(2000) }
  stop = true; await by
  check(worst < 1000 && deadCodes.every((c) => c === 503), `asked at the dead place every 2 s for 20 s (${deadCodes.join(',')}), the arrival never took more than ${Math.round(worst)} ms`)
  // An ask that waits for its answer is told why it was not done.
  const refused = await post('ask', { by: 'wren', blast: [dx, 500, dz], radius: 3, wait: true }), why = await refused.text()
  const done = await post('ask', { by: 'wren', blast: [arrive[0] + 40, 830, arrive[2] + 40], radius: 3, wait: true })
  check(refused.status === 503 && /ground/.test(why) && done.status === 202, `a waited blast where the ground has not come is refused with why (${refused.status}: ${why.slice(0, 60)}), one at the arrival is done (${done.status})`)

  // ── Only what the release lists is asked of its host ────────────────────────
  const dir = `releases/${said.release}/`, manifest = await json(server.url, `/release/${dir}manifest.json`)
  const name = Object.values(manifest.names)[0].path
  const outside = await Promise.all([`${dir}nothing.bin`, `${dir}tiles/0/999_999.bay`, `${dir}names/%252e%252e/tiles/0/206_265.bay`].map((p) => get(server.url, `/release/${p}`).then((a) => a.status)))
  const named = [await get(server.url, `/release/${dir}${name}`), await get(server.url, `/release/${dir}${name}`)]
  const unlisted = [...asked.keys()].filter((p) => p.endsWith('nothing.bin') || p.includes('999_999'))
  check(outside.every((s) => s === 404) && !unlisted.length, `names the release does not list are not served (${outside}) nor asked of its host (${unlisted.length} asks)`)
  check(named.every((a) => a.status === 200) && asked.get(`/sf/${dir}${name}`) === 1, `a name it lists is served, checked and kept: asked of the host ${asked.get(`/sf/${dir}${name}`)} time for two asks`)

  // ── The world holds no more of the city than it may ─────────────────────────
  const keys = Object.keys(manifest.levels[0].tiles)
  let worstSweep = 0, stop2 = false
  const by2 = (async () => { while (!stop2) { const a = await get(server.url, at(arrive[0], 900, arrive[2])); worstSweep = Math.max(worstSweep, a.ms); await wait(200) } })()
  const t0 = clock(), codes = await Promise.all(keys.map((k) => get(server.url, at(...centre(k).flatMap((v, i) => (i ? [500, v] : [v])))).then((a) => a.status)))
  const sweptMs = clock() - t0, after = await json(server.url, '/world/ground')
  stop2 = true; await by2
  const counts = codes.reduce((o, c) => ({ ...o, [c]: (o[c] ?? 0) + 1 }), {})
  const arrival = await get(server.url, at(arrive[0], 900, arrive[2])), arrivalTruth = await get(truth.url, at(arrive[0], 900, arrive[2]))
  console.log(`  swept ${keys.length} tiles in ${Math.round(sweptMs)} ms: ${JSON.stringify(counts)}; held ${after.held.tiles}, ${Math.round(after.rss / 2 ** 20)} MB; the arrival's slowest answer meanwhile ${Math.round(worstSweep)} ms`)
  check(after.held.tiles[0] <= 64 && arrival.status === 200 && arrival.text === arrivalTruth.text, `a question at every tile at once leaves at most 64 held (${after.held.tiles[0]}), and the arrival still answers as it is (${arrival.text})`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
for (const res of hanging) res.destroy()
server.stop(); truth.stop(); host.stop()
rmSync(scratch, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('shared-sf-slow: ok')
