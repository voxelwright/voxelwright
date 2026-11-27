// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`.
//
// Measures the realm's network waterfall in headless Chrome with WebGPU: every request the page AND its workers make
// (raw CDP, auto-attached to every worker), whether it went to the network or came from the HTTP cache, bytes on the
// wire and decoded, and when. Four phases in one browser context, so the HTTP cache carries over:
//   cold-landing -> cold-explore (two clicks on EXPLORE, then walk and turn for --explore seconds)
//   -> warm-landing (a new page, same cache) -> warm-explore
// It draws with the GPU, so it takes a turn first (engine/test/kit.mjs): ENGINE_TURN_WAIT=3600 where the lanes are busy.
//
//   node probes/network-82/measure.mjs --url https://voxelwright.world/ --out live.json [--explore 90] [--mbit 25] [--query farthest=6000] [--no-warm] [--disk-cache]
//   node probes/network-82/measure.mjs --local /path/to/engine/dist-sf --out local.json [--overlay <dir laid over it>]
//
// "Worker requests" are network requests (cache hits excluded, 304s included) to the paths deploy/cloudflare.config.ts
// sends to the Worker first: /releases/*, /bay/*, /weather.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { chromium } from '../../engine/node_modules/playwright/index.mjs'
import { arg, has, CHROME, turn } from '../../engine/test/kit.mjs'
import { plain } from '../../engine/player/serve.mjs'

const local = arg('local', null), exploreFor = Number(arg('explore', '90')), mbit = Number(arg('mbit', '0')), out = arg('out', 'measure.json'), query = arg('query', '')
// The local folder answers as the live host does (measured November 26): what is not under releases/ is
// `max-age=0, must-revalidate` with an ETag, so every context asks again and gets a 304. player/serve.mjs alone keeps
// such files ten minutes, which hides the workers' repeats. What it answered is the ground truth beside CDP's count.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' }
const answered = []
const overlay = arg('overlay', null)
const asLive = (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname), over = overlay && !path.includes('..') && existsSync(join(overlay, path)) && statSync(join(overlay, path)).isFile(), file = join(over ? overlay : local, path)
  if (over && path.includes('/releases/')) {
    // An overlay's release files (--overlay, pack-release.mjs): as the release's are, kept a year, Brotli where there is a copy.
    const br = existsSync(`${file}.br`) ? `${file}.br` : null, body = readFileSync(br ?? file)
    answered.push({ path, status: 200, release: true })
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Length': body.length, Vary: 'Accept-Encoding', ...(br ? { 'Content-Encoding': 'br' } : {}) }); res.end(body)
    return true
  }
  if (path.includes('/releases/') || path.includes('..') || !(extname(path) in TYPES) || !existsSync(file)) return false
  const s = statSync(file), br = /\bbr\b/.test(String(req.headers['accept-encoding'] ?? '')) && existsSync(`${file}.br`) ? `${file}.br` : null
  const headers = { 'Content-Type': TYPES[extname(path)], ETag: `"${s.size.toString(16)}-${Math.round(s.mtimeMs).toString(16)}${br ? '-br' : ''}"`, 'Cache-Control': path.endsWith('current.json') ? 'no-cache' : 'public, max-age=0, must-revalidate', Vary: 'Accept-Encoding' }
  if (req.headers['if-none-match'] === headers.ETag) { answered.push({ path, status: 304 }); res.writeHead(304, headers); res.end(); return true }
  const body = readFileSync(br ?? file)
  answered.push({ path, status: 200 })
  res.writeHead(200, { ...headers, 'Content-Length': body.length, ...(br ? { 'Content-Encoding': 'br' } : {}) }); res.end(body)
  return true
}
const site = local ? await plain(local, '127.0.0.1', 0, { extra: asLive }) : null
const base = site ? `${site.url}/sf/index.html` : arg('url', 'https://voxelwright.world/')
const url = query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base
const PORT = 9300 + Math.floor(Math.random() * 500)

const back = await turn()
// --disk-cache: a profile on disk for the run, so the HTTP cache is a visitor's (on disk, hundreds of MB). Without it
// the context is Chrome's incognito kind, whose cache is in memory and small: a cold landing and an explore (94 MB)
// push each other out of it, and a "warm" landing fetches nearly everything again (measured: 226 of 244 release files).
const profile = has('disk-cache') ? mkdtempSync(join(tmpdir(), 'vw-net82-')) : null
const launch = { ...CHROME, args: [...CHROME.args, `--remote-debugging-port=${PORT}`] }
const browser = profile ? null : await chromium.launch(launch)
const context = profile ? await chromium.launchPersistentContext(profile, { ...launch, viewport: { width: 1280, height: 720 } }) : await browser.newContext({ viewport: { width: 1280, height: 720 } })

// ── Raw CDP: one socket to the browser, attached to every page and worker, Network on in each. ──
const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json())
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no })
let nextId = 1
const sent = new Map()
const send = (method, params = {}, sessionId) => { sent.set(nextId, `${method} to ${targets.get(sessionId) ?? 'browser'}`); ws.send(JSON.stringify({ id: nextId++, method, params, ...(sessionId ? { sessionId } : {}) })) }
const targets = new Map(), reqs = new Map(), log = [], attached = {}
let phase = 'cold-landing', phaseStart = Date.now()
ws.onmessage = (m) => {
  const e = JSON.parse(m.data), p = e.params, key = `${e.sessionId}:${p?.requestId}`
  if (e.id && e.error && has('debug')) console.log('cdp error:', sent.get(e.id), e.error.message)
  if (e.method === 'Target.attachedToTarget') {
    targets.set(p.sessionId, p.targetInfo.type)
    attached[p.targetInfo.type] = (attached[p.targetInfo.type] ?? 0) + 1
    send('Network.enable', {}, p.sessionId)
    if (mbit && p.targetInfo.type !== 'browser') send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 }, p.sessionId)
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, p.sessionId)
    // Held until here (waitForDebuggerOnStart): a worker's first fetches (its core's files) are not missed.
    send('Runtime.runIfWaitingForDebugger', {}, p.sessionId)
  } else if (e.method === 'Network.requestWillBeSent') {
    if (p.request.url.startsWith('http')) reqs.set(key, { url: p.request.url, by: targets.get(e.sessionId) ?? '?', phase, start: Math.round(p.wallTime * 1000 - phaseStart), mono: p.timestamp, decoded: 0, cached: false })
  } else if (e.method === 'Network.requestServedFromCache') { const r = reqs.get(key); if (r) r.cached = true }
  else if (e.method === 'Network.responseReceived') {
    const r = reqs.get(key); if (!r) return
    const h = Object.fromEntries(Object.entries(p.response.headers).map(([k, v]) => [k.toLowerCase(), v]))
    Object.assign(r, { status: p.response.status, cached: r.cached || !!p.response.fromDiskCache || !!p.response.fromPrefetchCache, encoding: h['content-encoding'] ?? '', cache: h['cache-control'] ?? '', cf: h['cf-cache-status'] ?? '', protocol: p.response.protocol })
  } else if (e.method === 'Network.dataReceived') { const r = reqs.get(key); if (r) r.decoded += p.dataLength }
  else if (e.method === 'Network.loadingFinished') { const r = reqs.get(key); if (r) { r.wire = p.encodedDataLength; r.end = Math.round(r.start + (p.timestamp - r.mono) * 1000); log.push(r); reqs.delete(key) } }
  else if (e.method === 'Network.loadingFailed') { const r = reqs.get(key); if (r) { r.failed = p.errorText; r.end = Math.round(r.start + (p.timestamp - r.mono) * 1000); log.push(r); reqs.delete(key) } }
}
send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Until nothing has finished or begun for `quiet` ms (or `most` ms have passed). */
const idle = async (quiet = 4000, most = 90_000) => { const from = Date.now(); let n = -1, since = Date.now(); while (Date.now() - from < most) { const now = log.length + reqs.size * 1e6; if (now !== n) { n = now; since = Date.now() } else if (Date.now() - since > quiet && reqs.size === 0) return; await sleep(250) } }
const marks = {}, poses = []
const begin = (name) => { phase = name; phaseStart = Date.now() }

async function landing(name) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  begin(name)
  await page.goto(url)
  await page.waitForFunction(() => globalThis.engine?.seen?.first > 0, null, { timeout: 180_000 })
  await page.waitForFunction(() => globalThis.engine.seen.near > 0, null, { timeout: 240_000 })
  await page.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
  const seen = await page.evaluate(() => ({ ...globalThis.engine.seen }))
  await idle()
  marks[name] = { firstFrameMs: Math.round(seen.first), placeShownMs: Math.round(seen.near), wholeMs: Math.round(seen.whole), idleMs: Date.now() - phaseStart, errors }
  console.log(name, JSON.stringify(marks[name]))
  return page
}
async function explore(page, name) {
  await page.waitForFunction(() => globalThis.engine.boards && globalThis.engine.far.whole && globalThis.engine.explore && globalThis.engine.boards.where('explore'), null, { timeout: 120_000 })
  const at = () => page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return { x: w.x, y: w.y } })
  begin(name)
  let w = await at()
  await page.mouse.click(w.x, w.y); await sleep(800)
  w = await at()
  await page.mouse.click(w.x, w.y)
  const inside = await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 60_000 }).then(() => true, () => false)
  marks[name] = { insideMs: Date.now() - phaseStart, inside }
  // A visitor's minute: run forward, look round with the mouse, run again. Where it stands and looks, twice a second.
  const pose = () => page.evaluate(() => { const e = globalThis.engine, p = e.pose; return { at: [p.x, p.y, p.z], yaw: p.yaw, pitch: p.pitch, fov: e.fov, far: { fetched: e.far.stats.fetched, bytes: e.far.stats.fetchedBytes } } }).catch(() => null)
  const until = Date.now() + exploreFor * 1000
  let step = 0
  const sampler = setInterval(async () => { const p = await pose(); if (p) poses.push({ phase: name, t: Date.now() - phaseStart, ...p }) }, 500)
  while (Date.now() < until) {
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW')
    await sleep(4000)
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
    // Looking round: a third of a turn over a second and a half, the way a test turns the eye (engine.pose).
    for (let i = 0; i < 15; i++) { await page.evaluate(() => { globalThis.engine.pose.yaw += (2 * Math.PI) / 3 / 15 }); await sleep(100) }
    step++
  }
  clearInterval(sampler)
  marks[name].farStats = (await pose())?.far
  marks[name].exploreMs = Date.now() - phaseStart
  console.log(name, JSON.stringify(marks[name]))
}

try {
  const first = await landing('cold-landing')
  if (exploreFor > 0) await explore(first, 'cold-explore')
  await first.close()
  if (!has('no-warm')) {
    const again = await landing('warm-landing')
    if (exploreFor > 0) await explore(again, 'warm-explore')
    await again.close()
  }
} finally {
  await sleep(500)
  for (const r of reqs.values()) log.push({ ...r, unfinished: true })
  ws.close()
  await (browser ?? context).close()
  if (profile) rmSync(profile, { recursive: true, force: true })
  site?.stop()
  back()
}

// ── The tables. ──
const WORKER_FIRST = (path) => path.startsWith('/releases/') || path.startsWith('/bay/') || path === '/weather'
const origin = new URL(url).origin
const kindOf = (u) => {
  const { pathname: p, origin: o } = new URL(u)
  if (o !== origin) return 'third-party'
  if (p.includes('/packs/')) return 'far packs'
  if (p.includes('/far/landing/')) return 'far-landing'
  if (p.includes('/far/')) return 'far-bands'
  if (p.includes('/tiles/')) return 'tiles(.bay)'
  for (const k of ['life', 'names', 'graph', 'cars']) if (p.includes(`/releases/`) && p.includes(`/${k}/`)) return k
  if (p.endsWith('manifest.json')) return 'manifest'
  if (/\/bay\/(heroes\.json|marks-squares\.bin)$/.test(p)) return 'bay heroes+squares'
  if (p.includes('/bay/')) return 'bay other'
  if (/\.js$/.test(p)) return 'js'
  if (/\.(wasm|css|woff2)$/.test(p)) return 'wasm/css/font'
  return 'other'
}
const mb = (n) => Math.round((n / 1048576) * 1000) / 1000
const summary = {}
for (const name of Object.keys(marks)) {
  const rows = log.filter((r) => r.phase === name), kinds = {}
  const tot = { requests: 0, network: 0, cached: 0, revalidated304: 0, worker: 0, wireMB: 0, decodedMB: 0 }
  for (const r of rows) {
    const path = new URL(r.url).pathname.replace(/^\/sf\//, '/'), same = new URL(r.url).origin === origin, k = kindOf(r.url)
    const net = !r.cached, worker = same && net && WORKER_FIRST(path)
    const row = (kinds[k] ??= { requests: 0, network: 0, worker: 0, wireKB: 0, decodedKB: 0, byWorkers: 0 })
    row.requests++; tot.requests++
    if (net) { row.network++; tot.network++; row.wireKB += (r.wire ?? 0) / 1024; tot.wireMB += r.wire ?? 0 } else tot.cached++
    if (r.status === 304) tot.revalidated304++
    if (worker) { row.worker++; tot.worker++ }
    if (r.by !== 'page') row.byWorkers++
    row.decodedKB += r.decoded / 1024; tot.decodedMB += r.decoded
  }
  for (const v of Object.values(kinds)) { v.wireKB = Math.round(v.wireKB); v.decodedKB = Math.round(v.decodedKB) }
  tot.wireMB = mb(tot.wireMB); tot.decodedMB = mb(tot.decodedMB)
  // The landing's cuts: what had finished by the first frame, by the place shown, by the whole picture.
  const until = {}
  if (marks[name].wholeMs) for (const [cut, t] of [['firstFrame', marks[name].firstFrameMs], ['placeShown', marks[name].placeShownMs], ['whole', marks[name].wholeMs]]) {
    const got = rows.filter((r) => r.end <= t && !r.cached)
    until[cut] = { ms: t, network: got.length, worker: got.filter((r) => new URL(r.url).origin === origin && WORKER_FIRST(new URL(r.url).pathname.replace(/^\/sf\//, '/'))).length, wireMB: mb(got.reduce((n, r) => n + (r.wire ?? 0), 0)) }
  }
  summary[name] = { ...marks[name], total: tot, until, kinds }
  console.log(`\n== ${name}: ${JSON.stringify(tot)}`)
  if (marks[name].wholeMs) console.log('until', JSON.stringify(until))
  console.table(kinds)
}
// How often each address was asked for from the network in the cold landing: the repeats.
const repeats = {}
for (const r of log.filter((r) => r.phase === 'cold-landing' && !r.cached)) { const p = new URL(r.url).pathname; repeats[p] = (repeats[p] ?? 0) + 1 }
summary.repeatsColdLanding = Object.fromEntries(Object.entries(repeats).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 20))
console.log('asked more than once (cold landing, network):', summary.repeatsColdLanding)
console.log('targets attached:', attached)
summary.attached = attached
if (site) {
  const served = site.asked.length + answered.length
  for (const a of answered) if (a.release) site.asked.push(a)
  const count = (list, re) => list.filter((a) => re.test(a.path)).length
  summary.serverSaw = { 'bay/heroes.json': count(answered, /heroes\.json$/), 'bay/marks-squares.bin': count(answered, /marks-squares\.bin$/), js: count(answered, /\.js$/), js304: answered.filter((a) => /\.js$/.test(a.path) && a.status === 304).length, releases: site.asked.length }
  console.log('the server saw:', summary.serverSaw)
  console.log(`cross-check: the local server answered ${served} requests; CDP logged ${log.filter((r) => !r.cached && new URL(r.url).origin === origin).length} to the network`)
  summary.serverAnswered = served
}
writeFileSync(out, JSON.stringify({ url, at: new Date().toISOString(), mbit, exploreFor, summary, poses, log }, null, 1))
console.log(`wrote ${out}`)
process.exit(0)
