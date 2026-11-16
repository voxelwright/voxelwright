// The player from static files, measured (#419): the folder `npm run player` writes, served as any host of plain
// files would serve it (the usual types, a validator, and none of the page server's headers), opened in Chrome and
// in Playwright's WebKit. It says what the sample scene downloads, how long until it is seen, how the frames are
// with nothing touched and while it is poked, what a page that holds two of them gets, and that a browser with no
// WebGPU is told so within a second.
//
//   node test/player.mjs [--only chrome,webkit] [--shots ~/.village/engine/player] [--seconds 10] [--headed] [--look]
//
// Frames are counted by the page's own clock, in a window nobody sees (headless): the gaps between frames, and
// beside them how many pixels the page chose to draw (its scale), the GPU's time for the march and this thread's
// time a frame. A frame time alone flatters: the page draws fewer pixels to hold it.
// --look only opens the player, waits for it and takes the picture: for making a scene.
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, normalize, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { chromium, webkit } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from './kit.mjs'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm' }
/**
 * A host of plain files, as a static site's is: each file with its usual type, an ETag, and leave to keep it ten
 * minutes (what GitHub Pages sends). No header of the page server's: no COOP, no COEP, no CSP. `asked` is every
 * path it was asked for and what it answered.
 */
export async function plain(dir, host = '127.0.0.1') {
  const asked = []
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), rel = normalize(path).replace(/^[/\\]+/, ''), file = join(dir, rel)
    if (rel.split(sep).includes('..') || !(extname(rel) in TYPES) || !existsSync(file) || !statSync(file).isFile()) { asked.push({ path, status: 404 }); res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    const s = statSync(file), etag = `"${s.size.toString(16)}-${Math.round(s.mtimeMs).toString(16)}"`
    const headers = { 'Content-Type': TYPES[extname(rel)], ETag: etag, 'Last-Modified': s.mtime.toUTCString(), 'Cache-Control': 'max-age=600' }
    if (req.headers['if-none-match'] === etag) { asked.push({ path, status: 304 }); res.writeHead(304, headers); return res.end() }
    asked.push({ path, status: 200 })
    res.writeHead(200, { ...headers, 'Content-Length': s.size })
    createReadStream(file).pipe(res)
  })
  await new Promise((done) => server.listen(0, host, done))
  return { url: `http://${host}:${server.address().port}`, asked, stop: () => server.close() }
}

const middle = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
/** The gaps between frames, said shortly: the mean, the middle, the 95th of a hundred and the worst, ms; and how many were over 25 ms. */
const frames = (gaps) => { const s = [...gaps].sort((a, b) => a - b); return { frames: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), middle: round(s[s.length >> 1]), p95: round(s[Math.floor(s.length * 0.95)]), worst: round(s[s.length - 1]), late: s.filter((g) => g > 25).length } }

/** In a player's frame: empties its gaps, waits, and says how the frames were and what the page was drawing. */
const watch = (frame, seconds) => frame.evaluate(async (ms) => {
  const p = globalThis.player
  p.gaps.length = 0
  await new Promise((r) => setTimeout(r, ms))
  return { gaps: [...p.gaps], scale: p.scale, gpuMs: p.gpuMs, cpuMs: p.cpuMs, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], thrown: p.thrown, broken: p.broken, pieces: p.pieces, faults: p.faults, isolated: crossOriginIsolated, shared: typeof SharedArrayBuffer !== 'undefined' }
}, seconds * 1000)
const said = (w) => ({ ...frames(w.gaps), scale: w.scale, marchMs: round(w.gpuMs), cpuMs: round(w.cpuMs), canvas: w.canvas })

/** Pokes a player through the page's own mouse for some seconds: a tap, then a hold, at places across the picture, and a turn of the eye now and then. `box` is where the player is on the page. */
async function pokes(page, box, seconds) {
  const until = Date.now() + seconds * 1000
  for (let i = 0; Date.now() < until; i++) {
    const x = box.x + box.width * (0.3 + 0.4 * ((i * 0.37) % 1)), y = box.y + box.height * (0.35 + 0.3 * ((i * 0.61) % 1))
    await page.mouse.move(x, y)
    await page.mouse.down()
    if (i % 4 === 3) { await page.mouse.move(x + 60, y + 10, { steps: 6 }); await page.mouse.up(); continue }
    await page.waitForTimeout(i % 2 ? 700 : 40)
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
}

const dist = join(here, 'dist'), shots = arg('shots', join(homedir(), '.village', 'engine', 'player')), seconds = Number(arg('seconds', '10'))
const only = arg('only', 'chrome,webkit').split(',')
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

const built = spawnSync('npm', ['run', '-s', 'player'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
mkdirSync(shots, { recursive: true })
// The player on one origin and the page that holds two of them on another, as a post that borrows a scene would be.
const site = await plain(dist, '127.0.0.1'), other = await plain(dist, 'localhost')
const playerUrl = `${site.url}/player/index.html?scene=scenes/sample.json${arg('query', '')}`, hostUrl = `${other.url}/player/host.html?player=${encodeURIComponent(`${site.url}/player/index.html`)}`
const results = {}

const browsers = { chrome: () => chromium.launch({ ...CHROME, headless: !has('headed') }), webkit: () => webkit.launch({ headless: !has('headed') }) }
const back = has('look') ? await turn() : await quiet()
for (const name of only) {
  console.log(`\n${name}`)
  const browser = await browsers[name](), out = (results[name] = { version: browser.version() })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`${name} page error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  page ${m.type()}: ${m.text().slice(0, 400)}`) })
  const ready = async (p = page) => { await p.waitForFunction(() => ['ready', 'error', 'unsupported'].includes(document.documentElement.dataset.state), null, { timeout: 60000 }); return p.evaluate(() => ({ state: document.documentElement.dataset.state, said: document.documentElement.dataset.said, seen: globalThis.player?.seen })) }

  // ── Alone: the first visit, and visits after ──
  site.asked.length = 0
  await page.goto(playerUrl)
  const cold = await ready()
  check(cold.state === 'ready', `the scene is seen from plain files (${cold.state}${cold.said ? `: ${cold.said}` : ''})`)
  if (cold.state !== 'ready') { await browser.close(); continue }
  const loaded = [...new Set(site.asked.map((a) => a.path))]
  check(site.asked.every((a) => a.status === 200) && loaded.every((p) => existsSync(join(dist, p))), `it asked for ${loaded.length} files, all of the folder, and nothing else`)
  out.cold = { firstFrame: Math.round(cold.seen.first), seen: Math.round(cold.seen.whole) }
  if (has('look')) { await page.waitForTimeout(Number(arg('wait', '1500'))); await page.screenshot({ path: join(shots, `look-${name}.png`) }); console.log(`  ${join(shots, `look-${name}.png`)}`); await browser.close(); continue }
  if (!results.download) {
    const sizes = loaded.map((p) => { const body = readFileSync(join(dist, p)); return { path: p, raw: body.length, gzip: gzipSync(body, { level: 9 }).length, brotli: brotliCompressSync(body).length } })
    const sum = (k) => sizes.reduce((n, s) => n + s[k], 0)
    results.download = { files: sizes.length, raw: sum('raw'), gzip: sum('gzip'), brotli: sum('brotli'), biggest: sizes.sort((a, b) => b.brotli - a.brotli).slice(0, 4) }
  }
  const warm = []
  for (let i = 0; i < 5; i++) { await page.reload(); const w = await ready(); warm.push(w.seen) }
  out.warm = { firstFrame: Math.round(middle(warm.map((w) => w.first))), seen: Math.round(middle(warm.map((w) => w.whole))) }
  const alone = await watch(page, 1)
  check(alone.isolated === false, `it ran with no cross-origin isolation (crossOriginIsolated ${alone.isolated}, SharedArrayBuffer ${alone.shared ? 'there' : 'not there'})`)
  out.isolated = alone.isolated

  // ── Alone: nothing touched, then poked ──
  await page.waitForTimeout(3000)
  out.idle = said(await watch(page, seconds))
  await page.screenshot({ path: join(shots, `player-${name}.png`) })
  const before = await watch(page, 0.05), poking = watch(page, seconds)
  await pokes(page, { x: 0, y: 0, width: 1280, height: 720 }, seconds - 0.5)
  const poked = await poking
  out.poked = { ...said(poked), thrown: poked.thrown - before.thrown, edits: poked.broken - before.broken }
  check(out.poked.thrown > 0 && out.poked.edits > 0, `poked, it threw ${out.poked.thrown} balls and the world was changed ${out.poked.edits} times`)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, `player-${name}-poked.png`) })
  check(poked.faults.length === 0, `the GPU reported no fault${poked.faults.length ? `: ${poked.faults[0]}` : ''}`)
  await context.close()

  // ── Two in a page of another origin ──
  const twoContext = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 }), two = await twoContext.newPage()
  two.on('pageerror', (e) => failures.push(`${name} host page error: ${e.message}`))
  await two.goto(hostUrl)
  await two.waitForFunction(() => document.querySelectorAll('.scene[data-state]').length === 2, null, { timeout: 60000 })
  const heard = await two.evaluate(() => globalThis.heard.map((h) => ({ type: h.type, ms: h.ms })))
  check(heard.length === 2 && heard.every((h) => h.type === 'ready'), `two players in a page of another origin both said ready (${heard.map((h) => `${h.type} ${h.ms} ms`).join(', ')})`)
  const inner = two.frames().filter((f) => f.url().includes('/player/index.html'))
  if (inner.length === 2 && heard.every((h) => h.type === 'ready')) {
    await two.waitForTimeout(3000)
    const idle = await Promise.all(inner.map((f) => watch(f, seconds)))
    const box = await two.locator('.scene').first().boundingBox(), busy = Promise.all(inner.map((f) => watch(f, seconds)))
    await pokes(two, box, seconds - 0.5)
    const poked2 = await busy
    out.two = { ready: heard.map((h) => h.ms), idle: idle.map(said), poked: poked2.map(said) }
    check(idle.every((w) => w.isolated === false), 'neither was cross-origin isolated')
    await two.waitForTimeout(1000)
    await two.screenshot({ path: join(shots, `host-${name}.png`), fullPage: true })
  }
  await twoContext.close()

  // ── No WebGPU: the holder is told within a second ──
  out.none = {}
  for (const [why, script] of [
    ['no navigator.gpu', () => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined })],
    ['no adapter', () => { if (navigator.gpu) navigator.gpu.requestAdapter = async () => null }],
    ['an adapter that never answers', () => { if (navigator.gpu) navigator.gpu.requestAdapter = () => new Promise(() => {}) }],
  ]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 1100 } }), p = await c.newPage()
    await c.addInitScript(script)
    site.asked.length = 0
    await p.goto(hostUrl)
    await p.waitForFunction(() => document.querySelectorAll('.scene[data-state]').length === 2, null, { timeout: 20000 })
    const told = await p.evaluate(() => globalThis.heard.map((h) => ({ type: h.type, ms: h.ms, reason: h.data.reason })))
    out.none[why] = told.map((t) => t.ms)
    check(told.length === 2 && told.every((t) => t.type === 'unsupported' && t.ms < 1000), `${why}: both said unsupported, ${told.map((t) => `${t.ms} ms`).join(' and ')} after their frames were added ("${told[0]?.reason}")`)
    check(!site.asked.some((a) => a.path.endsWith('.wasm') || a.path.endsWith('player.js')), `${why}: the engine was not downloaded`)
    if (why === 'no navigator.gpu') await p.screenshot({ path: join(shots, `host-${name}-unsupported.png`), fullPage: true })
    await c.close()
  }
  await browser.close()
}
back()
site.stop(); other.stop()
console.log(`\n${JSON.stringify(results, null, 1)}`)
console.log(failures.length ? `\nFAILED:\n${failures.map((f) => `  ${f}`).join('\n')}` : `\nPASSED. Pictures in ${shots}`)
process.exit(failures.length ? 1 : 0)
