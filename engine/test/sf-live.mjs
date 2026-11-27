// The SF realm where it is deployed (#450, deploy/): opened from a URL in Chrome with WebGPU, measured the way
// test/sf.mjs measures the local folder, but from Chrome's own count of the bytes on the wire (CDP encodedDataLength,
// headers included), since this host is not ours to ask.
//
//   node test/sf-live.mjs [--url https://voxelwright.world/] [--mbit 25] [--shots ~/.village/engine/deploy] [--headed]
//
// It fails unless: the park is shown within 8 MB over the wire on a cold cache (25 Mbit/s, 40 ms); two clicks on the
// EXPLORE board take the visitor onto the roof; the credits are on the page; and every board's link, and the blog's
// own pages, answer without a 404. A local folder measured the same way: --url http://127.0.0.1:<port>/sf/index.html
// beside `node player/serve.mjs --dir dist-sf --port <port>`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME } from './kit.mjs'

const url = arg('url', 'https://voxelwright.world/'), mbit = Number(arg('mbit', '25')), shots = arg('shots', join(homedir(), '.village', 'engine', 'deploy'))
const mb = (n) => Math.round((n / 1048576) * 100) / 100
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
mkdirSync(shots, { recursive: true })

const browser = await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
/** Every response that finished: its address, its status, the bytes on the wire and when (ms since 1970). */
const asked = new Map(), done = []
cdp.on('Network.responseReceived', (e) => asked.set(e.requestId, { url: e.response.url, status: e.response.status, encoding: e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? '' }))
cdp.on('Network.loadingFinished', (e) => { const a = asked.get(e.requestId); if (a) done.push({ ...a, wire: e.encodedDataLength, at: Date.now() }) })
const sent = (to) => {
  const kinds = {}
  let n = 0, wire = 0
  for (const d of done) {
    if (d.at > to) continue
    n++; wire += d.wire
    const path = new URL(d.url).pathname, kind = path.includes('/tiles/') ? 'tiles' : path.includes('/far/') ? 'far' : path.includes('/releases/') ? 'release' : /\.(js|wasm|css|woff2)$/.test(path) ? 'code' : 'other'
    kinds[kind] = (kinds[kind] ?? 0) + d.wire
  }
  return { requests: n, wireMB: mb(wire), of: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, mb(v)])) }
}

const results = { url, at: new Date().toISOString() }
try {
  console.log(`${url}: first visit (cold cache, ${mbit} Mbit/s, 40 ms)`)
  await page.goto(url)
  await page.waitForFunction(() => globalThis.engine?.seen?.first > 0, null, { timeout: 180_000 })
  await page.waitForFunction(() => globalThis.engine.seen.near > 0, null, { timeout: 240_000 })
  await page.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
  const t = await page.evaluate(() => ({ origin: performance.timeOrigin, ...globalThis.engine.seen }))
  results.load = { firstFrameMs: Math.round(t.first), placeShownMs: Math.round(t.near), wholeMs: Math.round(t.whole), untilFirstFrame: sent(t.origin + t.first), untilPlaceShown: sent(t.origin + t.near), untilWhole: sent(t.origin + t.whole) }
  const brotli = done.filter((d) => new URL(d.url).pathname.includes('/releases/')), squeezed = brotli.filter((d) => d.encoding === 'br').length
  console.log(`  park shown at ${results.load.placeShownMs} ms: ${JSON.stringify(results.load.untilPlaceShown)}`)
  console.log(`  first frame: ${JSON.stringify(results.load.untilFirstFrame)}; whole: ${JSON.stringify(results.load.untilWhole)}`)
  check(results.load.untilPlaceShown.wireMB < 8, `${results.load.untilPlaceShown.wireMB} MB over the wire until the park is shown (bound 8 MB)`)
  check(brotli.length > 0 && squeezed === brotli.length, `${squeezed} of ${brotli.length} release files came as Brotli`)
  await page.screenshot({ path: join(shots, 'park.png') })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

  // The credits, opened from Settings.
  await page.click('#realm .fold')
  await page.waitForTimeout(300)
  await page.click('#realm .sky .sky-credits-link')
  await page.waitForTimeout(300)
  const text = await page.evaluate(() => document.querySelector('#first-credits').innerText)
  for (const name of ['OpenStreetMap', 'Mapillary', 'DataSF']) check(text.includes(name), `the Credits key opens a list naming ${name}`)
  await page.screenshot({ path: join(shots, 'credits.png') })
  await page.keyboard.press('Escape')
  await page.click('#realm .fold')

  // Every board's link, and the blog's own pages.
  const boards = await page.evaluate(() => globalThis.engine.boards.records.filter((r) => r.to).map((r) => ({ id: r.id, to: new URL(r.to, location.href).href })))
  const own = ['blog/', 'blog/tags/', 'blog/voxelmorphism/', 'blog/feed.xml', 'blog/sitemap.xml', 'blog/llms.txt', 'blog/index.md', 'blog/site.css', 'robots.txt', 'CREDITS.txt'].map((p) => ({ id: p, to: new URL(p, new URL('/', url)).href }))
  for (const b of [...boards, ...own]) {
    const status = await fetch(b.to, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36' } }).then((r) => r.status, (e) => `no answer (${e.message})`)
    // LinkedIn answers 999, and others 403, to every client they take for a robot: not a missing page, but only
    // another site's answer. This site's own pages must answer 2xx or 3xx.
    const elsewhere = new URL(b.to).host !== new URL(url).host
    check(typeof status === 'number' && (status < 400 || (elsewhere && (status === 999 || status === 403))), `${b.id} → ${b.to}: ${status}`)
  }
  results.boards = boards

  // The way in: two clicks on the EXPLORE board, then the visitor on the roof.
  // As test/sf-explore.mjs asks: one click lights the board, a second a moment later enters (a double click is one ask).
  await page.waitForFunction(() => globalThis.engine.boards && globalThis.engine.far.whole && globalThis.engine.explore && globalThis.engine.boards.where('explore'), null, { timeout: 120_000 })
  const at = () => page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return { x: w.x, y: w.y } })
  let w = await at()
  await page.mouse.click(w.x, w.y); await page.waitForTimeout(800)
  w = await at()
  await page.mouse.click(w.x, w.y)
  const from = Date.now()
  const inside = await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 60_000 }).then(() => true, () => false)
  check(inside, `two clicks on EXPLORE: on the roof ${inside ? `after ${Date.now() - from} ms` : 'not within 60 s'}`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(shots, 'explore.png') })
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  failures.push(String(e?.message ?? e))
  console.error(e)
} finally {
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(failures.length ? `${failures.length} failed` : 'all ok', `(pictures and results in ${shots})`)
process.exit(failures.length ? 1 : 0)
