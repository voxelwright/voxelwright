// Going fast through the city must not stutter (#73). The real page in Chrome with WebGPU; nothing is stubbed.
//
//   node test/drive-smooth.mjs [--sf [folder]] [--curve] [--car] [--ahead] [--kmh 180] [--seconds 12] [--scale 0.5|own] [--dpr 1]
//                              [--hour 12.5] [--route ax,az,bx,bz] [--busy] [--profile] [--report-only] [--beside] [--json file] [--headed]
//
// The eye is carried along a long straight street at `--kmh`, a person's height over the road, the same cells every
// run; before it, the same page stands at the street's start for five seconds. Every gap between the page's frames is
// kept with what the page's thread spent in each part of the frame (`engine.laps`) and between frames (the makers'
// answers, the mover's, timers, tile work), the march's time on the GPU, how many sectors are still wanted and how
// many of the sun's tiles are not drawn. The picture's size is pinned (`--scale`), so that a cost shows as time and
// is not hidden by the page drawing fewer pixels.
//
// It fails where going fast costs more than standing does by more than the bounds below (other checks draw on this
// GPU too, so a bound in milliseconds alone would be theirs to break), or where the world round the eye falls behind.
//   --curve   the same street at 0, 60, 120 and 180 km/h (`--speeds`), each twice in turn, then a stop: what each speed costs
//   --car     the summoned coupe got into and driven flat out along the street by a pilot that only steers
//   --ahead   that car four times in one session, drawn as the mover last said it and drawn on to the frame's time in turn
//   --sf      San Francisco: this checkout's page over the release in a folder `node sf/build.mjs` wrote (by default
//             ENGINE_SF_DIST or dist-sf here), so its 6.6 GB of tiles are not written again. Without it, the town.
//   --busy    a second page of the same place draws beside this one: a GPU with no time to spare
//   --profile Chrome's own samples of the page's thread: which functions the time went to
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, serve, timed, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const seconds = Number(arg('seconds', '12')), kmh = Number(arg('kmh', '180')), scale = arg('scale', '0.5') === 'own' ? null : Number(arg('scale', '0.5'))
const sf = has('sf'), profile = has('profile'), reportOnly = has('report-only'), curve = has('curve'), car = has('car')
/**
 * What going fast may cost beside standing in the same run: frames over 33 ms, as a share of all frames more than
 * standing's; the page's thread, ms a frame at the 99th in a hundred and at most; the march on the GPU, times
 * standing's. And what the page must do about it: give the sun's tiles no more than their share of a moving frame
 * on average (times this: a count of whole tiles, by a reading of what a tile takes that moves from frame to frame),
 * have every tile drawn within so many seconds of stopping, and keep the makers up with the eye (sectors still
 * wanted over the last third of the way). The town's bounds; San Francisco's thread is busier (street life, the far
 * model), and its makers fall behind from about 180 km/h.
 */
const BOUND = { late: 0.04, thread99: sf ? 16 : 12, threadMost: 34, march: 1.35, share: 1.5, drawn: 20, wanted: 1500 }

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const mean = (fs, get) => fs.reduce((n, f) => n + get(f), 0) / Math.max(1, fs.length)

// ── Where the page comes from ──
/** This checkout's page over a built San Francisco: every module the page asks for is this checkout's source, stripped as sf/build.mjs strips it; the release, its tiles and the realm's page are the folder's. */
const overlay = async (dist, code) => {
  const NAMED = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|new URL\(\s*)(['"`])(\.{1,2}\/[^'"`?$]+?)\.(ts|mjs)\b/g
  const made = new Map()
  const source = (rel) => {
    if (rel === 'page/core.wasm') return { file: join(code, rel), type: 'application/wasm' }
    if (extname(rel) !== '.js') return null
    for (const ext of ['.ts', '.mjs', '.js']) { const file = join(code, rel.replace(/\.js$/, ext)); if (existsSync(file)) return { file, type: 'text/javascript; charset=utf-8', strip: ext === '.ts' } }
    return null
  }
  return plain(dist, '127.0.0.1', 0, {
    extra: (req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '')
      if (rel.includes('..') || !/^(page|make|kit\/src|blocks|probe)\//.test(rel)) return false
      const s = source(rel)
      if (!s) return false
      const at = statSync(s.file).mtimeMs
      let body = made.get(s.file)
      if (!body || body.at !== at) { const raw = readFileSync(s.file); body = { at, bytes: s.type.startsWith('text') ? Buffer.from((s.strip ? stripTypeScriptTypes(String(raw)) : String(raw)).replace(NAMED, '$1$2$3.js')) : raw }; made.set(s.file, body) }
      res.writeHead(200, { 'Content-Type': s.type, 'Cache-Control': 'no-store', 'Content-Length': body.bytes.length })
      res.end(body.bytes)
      return true
    },
  })
}
/** `--sf`, or `--sf <folder>`. */
const sfNamed = sf ? process.argv[process.argv.indexOf('--sf') + 1] : null
const sfDist = sf ? resolve(sfNamed && !sfNamed.startsWith('--') ? sfNamed : (process.env.ENGINE_SF_DIST ?? join(here, 'dist-sf'))) : null
if (sf && !existsSync(join(sfDist, 'sf/index.html'))) { console.error(`${sfDist} is not a built San Francisco (node sf/build.mjs): name one with --sf <folder> or ENGINE_SF_DIST`); process.exit(1) }
/** `--code <engine folder>`: another checkout's page (the one before a change), measured by this script. */
const code = resolve(arg('code', here))
/** Under `node test/all.mjs`: the page server every check shares. */
const kit = !sf && code === here && process.env.ENGINE_KIT ? JSON.parse(process.env.ENGINE_KIT) : null
const site = kit ? { url: kit.url, stop: () => {} } : sf ? await overlay(sfDist, code) : code === here ? await serve() : await (await import(join(code, 'test/kit.mjs'))).serve()
const back = await turn()
// A browser of its own (not the one a run of every check shares): its frames are timed.
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(arg('dpr', '1')) })
const page = await context.newPage()
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)|Failed to load resource/.test(m.text())) console.log(`  page error: ${m.text().slice(0, 300)}`) })

// ── What the page's thread spends its time on, by who called: set before any of the page's own code runs ──
await page.addInitScript(() => {
  const P = (globalThis.__prof = { cat: {}, loaf: [], heard: [], buffers: {} })
  const add = (k, ms) => { P.cat[k] = (P.cat[k] ?? 0) + ms }
  let depth = 0
  // (`thread` is everything timed here, counted once: a timer set off inside a frame is the frame's.)
  const wrap = (k, fn, top = true) => (typeof fn !== 'function' ? fn : function (...a) { const t = performance.now(); if (top) depth++; try { return fn.apply(this, a) } finally { const ms = performance.now() - t; add(k, ms); if (top && --depth === 0) add('thread', ms) } })
  const raf = globalThis.requestAnimationFrame.bind(globalThis)
  globalThis.requestAnimationFrame = (cb) => raf(wrap('frame', cb))
  for (const name of ['setTimeout', 'setInterval']) { const was = globalThis[name].bind(globalThis); globalThis[name] = (cb, ...rest) => was(wrap('timers', cb), ...rest) }
  const W = globalThis.Worker, heard = Object.getOwnPropertyDescriptor(W.prototype, 'onmessage')
  globalThis.Worker = class extends W {
    constructor(url, o) { super(url, o); this.__k = `from ${String(url).split('/').pop().split('?')[0].replace(/\.(ts|js)$/, '')}` }
    get onmessage() { return heard.get.call(this) }
    set onmessage(f) { const k = this.__k, timed = wrap(k, f); heard.set.call(this, k === 'from mover' ? function (e) { P.heard.push(performance.now()); return timed.call(this, e) } : timed) }
  }
  const port = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')
  Object.defineProperty(MessagePort.prototype, 'onmessage', { get: port.get, set(f) { port.set.call(this, wrap('tile asks', f)) } })
  // The core's part in taking and dropping a tile on this thread (bay.ts `take`): its exports cannot be written over, so a copy with those timed.
  const streaming = WebAssembly.instantiateStreaming.bind(WebAssembly)
  WebAssembly.instantiateStreaming = async (...a) => {
    const made = await streaming(...a), exports = Object.create(null)
    for (const [k, v] of Object.entries(made.instance.exports)) exports[k] = /^bay_(load|drop)$/.test(k) ? wrap(k, v, false) : v
    return { module: made.module, instance: { exports } }
  }
  if (globalThis.GPUQueue) {
    const note = (who, bytes, ms) => { const b = (P.buffers[who] ??= { n: 0, bytes: 0, ms: 0, most: 0 }); b.n++; b.bytes += bytes; b.ms += ms; b.most = Math.max(b.most, bytes) }
    const write = GPUQueue.prototype.writeBuffer
    GPUQueue.prototype.writeBuffer = function (buffer, offset, data, at, size) { const t = performance.now(); try { return write.call(this, buffer, offset, data, at, size) } finally { const ms = performance.now() - t, bytes = (size ?? (data.length ?? data.byteLength) - (at ?? 0)) * (data.BYTES_PER_ELEMENT ?? 1); add('writeBuffer', ms); add('written KB', bytes / 1024); note(`write ${buffer.label || 'unnamed'}`.replace(/\d+_\d+\/\d+/, '<tile>'), bytes, ms) } }
    for (const name of ['createBuffer', 'createTexture', 'createBindGroup', 'createRenderPipeline', 'createShaderModule']) { const was = GPUDevice.prototype[name]; GPUDevice.prototype[name] = function (...a) { const t = performance.now(); try { return was.apply(this, a) } finally { const ms = performance.now() - t; add(name, ms); if (name === 'createBuffer' || name === 'createTexture') note(`${name} ${a[0]?.label || 'unnamed'}`.replace(/\d+_\d+\/\d+/, '<tile>'), name === 'createBuffer' ? a[0].size : 0, ms) } } }
  }
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) P.loaf.push({ at: e.startTime, ms: e.duration, scripts: e.scripts.map((s) => ({ by: s.invoker, in: `${s.sourceURL.split('/').pop()} ${s.sourceFunctionName}`, ms: s.duration })) }) }).observe({ type: 'long-animation-frame', buffered: false })
  } catch { /* a Chrome before it */ }
})

const results = {}
try {
  const t0 = Date.now()
  const address = sf ? `${site.url}/sf/index.html?hour=${arg('hour', '12.5')}&rest=0` : `${site.url}/city?fly=0&fire=0&rest=0`
  await page.goto(address)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 240_000 })
  await page.evaluate(() => globalThis.engine.first?.engage())
  // `--busy`: the same place in a second page, drawing beside this one at the size it steers itself to, as other work
  // on the GPU does: two pages that each fill what they find free leave neither any time to spare.
  if (has('busy')) {
    const other = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(arg('dpr', '1')) })).newPage()
    await other.goto(address)
    await other.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 240_000 })
    await page.waitForTimeout(5000)
    console.log(`  a second page draws beside it (at ${await other.evaluate(() => globalThis.engine.scale)} of its size)`)
  }
  console.log(`the ${sf ? 'San Francisco realm' : 'town'} was whole in ${round((Date.now() - t0) / 1000)} s (${code === here ? 'this checkout' : code})`)
  const line = await route(page)
  console.log(`route: ${line.name}, ${round(Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]) / 10)} m from ${line.from.map(Math.round)} to ${line.to.map(Math.round)}; the picture ${scale ? `at ${scale}` : 'at the page\'s own choice'} of ${1280 * Number(arg('dpr', '1'))} x ${720 * Number(arg('dpr', '1'))}`)

  const client = profile ? await context.newCDPSession(page) : null
  const pass = async (how) => {
    if (client) { await client.send('Profiler.enable'); await client.send('Profiler.setSamplingInterval', { interval: 200 }); await client.send('Profiler.start') }
    const out = await page.evaluate(run, { line, scale, sunMost: null, ...how })
    if (client) out.profile = (await client.send('Profiler.stop')).profile
    return out
  }
  if (curve) {
    // Every other check's drawing is waited out (three minutes at most): a gap counted beside another page's march is not this page's.
    const rest = await quiet({ within: 3 * 60_000 })
    if (!rest) console.log('  (measured beside other checks on the GPU: the gaps may be theirs)')
    try {
      // What each speed costs: the same street, slowest to fastest and again, then a stop after the fastest.
      console.log('  km/h · frames · over 33 ms · p50 p95 p99 worst gap · march ms · thread ms a frame, its 99th, its most · sectors wanted (mean, end) · sun tiles undrawn (mean, end) · sun tiles drawn a frame · KB written a frame · late frames of those drawing 0, 1 to 2, 3 or more tiles · the picture\'s scale')
      results.curve = []
      // (`--sun-most 8,own`: each speed with the sun's tiles a frame held to each of those in turn, `own` the page's own count, to find what they cost.)
      const mosts = arg('sun-most', null)?.split(',').map((n) => (n === 'own' ? null : Number(n))) ?? [null], speeds = arg('speeds', '0,60,120,180').split(',').map(Number)
      for (const turnOf of [1, 2]) for (const speed of speeds) for (const sunMost of mosts) {
        const shot = arg('shots', null) && turnOf === 1 && speed > 0
        const r = await pass({ mode: 'eye', kmh: speed, seconds: Math.min(seconds, 12), stand: 0, hold: turnOf === 2 && speed === speeds.at(-1) ? 8 : 0, sunMost, freeze: shot })
        // (`--shots <folder>`: the picture where each speed's first run ended, with the sun's maps as they were while it went.)
        // (At full size where the picture's size is pinned, and so set again by the next run; a size the page chose is left to it, since a size set stays set.)
        if (shot) { mkdirSync(arg('shots'), { recursive: true }); if (scale) await page.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(700); await page.screenshot({ path: join(arg('shots'), `${sf ? 'sf' : 'town'}-${speed}-${sunMost === null ? 'own' : sunMost}.png`) }) }
        const s = summary(r.frames.filter((f) => !f.held))
        results.curve.push({ kmh: speed, sunMost, ...s })
        console.log(`    ${String(speed).padStart(4)} ${rowOf(s)}${mosts.length < 2 ? '' : sunMost === null ? '   (the page\'s own count of sun tiles)' : `   (${sunMost} sun tiles a frame)`}`)
        const stopped = r.frames.filter((f) => f.held)
        if (!stopped.length) continue
        // Stopped after the fastest: what the march costs while the sun's tiles are drawn, second by second.
        console.log('  stopped after it, second by second: march ms · sun tiles undrawn · sectors wanted · frames over 33 ms')
        for (let sec = 0; sec < 8; sec++) {
          const fs = stopped.filter((f) => f.t - stopped[0].t >= sec * 1000 && f.t - stopped[0].t < (sec + 1) * 1000)
          if (fs.length) console.log(`    ${sec}: ${String(round(mean(fs, (f) => f.gpu), 2)).padStart(6)} ${String(Math.round(mean(fs, (f) => f.sun))).padStart(6)} ${String(Math.round(mean(fs, (f) => f.wanted))).padStart(6)} ${String(fs.filter((f) => f.gap > 33).length).padStart(4)} of ${fs.length}`)
        }
      }
    } finally { rest?.() }
  } else if (has('ahead')) {
    // The same car run with things drawn as the mover last said them and drawn on to the frame's time, turn about, in one session.
    console.log('  drawn · km/h · frames · over 33 ms · frames it stood in · frames it jumped in · off by, of a frame\'s way, at the 95th and 99th · the mover\'s answers apart at the 99th, ms')
    results.ahead = []
    for (const on of [false, true, false, true]) {
      const r = await pass({ mode: 'car', kmh: Number(arg('from', '100')), seconds, stand: 0, hold: 0, ahead: on })
      const even = evenness(r.frames), s = summary(r.frames), gaps = r.heard.slice(1).map((t, i) => t - r.heard[i]).sort((a, b) => a - b), speeds = r.frames.map((f) => f.kmh).sort((a, b) => a - b)
      results.ahead.push({ on, ...even, late: s.over33, why: r.why })
      console.log(`    ${on ? 'on to the frame ' : 'as last said    '} ${String(Math.round(speeds[speeds.length >> 1] ?? 0)).padStart(4)} ${String(even.frames).padStart(5)} ${String(s.over33).padStart(4)} ${String(even.stood).padStart(5)} ${String(even.jumped).padStart(5)}   ${String(even.off95).padStart(5)} ${String(even.off99).padStart(5)}   ${String(round(gaps[Math.floor(gaps.length * 0.99)] ?? 0)).padStart(6)}${r.why ? `   (${r.why})` : ''}`)
    }
  } else {
    const how = car ? { mode: 'car', kmh: Number(arg('from', '100')), seconds, stand: 5, hold: 0 } : { mode: 'eye', kmh, seconds, stand: 5, hold: BOUND.drawn }
    // Measuring only (`--report-only`, `--profile`): alone on the GPU where it can be had in three minutes (`--beside`: without waiting for that).
    const rest = (reportOnly || profile) && !has('beside') ? await quiet({ within: 3 * 60_000 }) : null
    let first
    try { first = judged(await pass(how), true) } finally { rest?.() }
    for (const c of first.held) check(c.ok, c.what)
    if (reportOnly) for (const c of first.timings) check(c.ok, c.what)
    // What a busy GPU slows is measured once more with every turn on it held, and fails only if it is missed again (kit.mjs `timed`).
    const timings = reportOnly ? first : await timed({ check, first, firstAlone: !!rest, measure: async () => judged(await pass(how), false), passes: (j) => j.timings.every((c) => c.ok), say: (j) => j.timings.map((c) => `${c.ok ? '' : 'MISSED '}${c.what}`).join('; '), idle: (on) => page.evaluate((on) => { globalThis.engine.resting = on }, on) })
    results.pass = timings.summary
  }
  if (arg('json', null)) writeFileSync(arg('json'), JSON.stringify(results))
} finally {
  await browser.close()
  site.stop()
  back()
}
if (failures.length && !reportOnly) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log(`drive-smooth: ${failures.length ? 'over its bounds (reported only)' : 'ok'}`)
process.exit(0)

/** The street to go along: named (`--route`), the town's own, or San Francisco's pinned one. */
async function route(page) {
  const named = arg('route', null)
  if (named) { const [ax, az, bx, bz] = named.split(',').map(Number); return { from: [ax, az], to: [bx, bz], name: 'the route named' } }
  // Geary Boulevard and O'Farrell Street eastward from Divisadero, 3 km through the Western Addition, the Tenderloin
  // and Union Square (found once by `--find`, and pinned: the same cells every run).
  if (sf && !has('find')) return { from: [497011, 679075], to: [526506, 674170], name: 'Geary Boulevard and O\'Farrell Street eastward from Divisadero' }
  if (sf) return sfRoute(page)
  return page.evaluate(() => {
    // The town's streets run along x every 80 m (city.rs BLOCK_Z): the one nearest the start, eastward.
    const e = globalThis.engine, z0 = Math.round(e.pose.z * 10), x0 = Math.round(e.pose.x * 10)
    let best = null
    for (let z = z0 - 900; z <= z0 + 900; z += 4) { let run = 0; for (let x = x0; x < x0 + 30000 && (e.top(x, z) & 15) === 6; x += 20) run = x - x0; if (!best || run > best.run) best = { z, run } }
    // (Its middle: the asphalt's two edges across it.)
    let lo = best.z, hi = best.z
    while ((e.top(x0 + 200, lo - 1) & 15) === 6) lo--
    while ((e.top(x0 + 200, hi + 1) & 15) === 6) hi++
    return { from: [x0 + 100, (lo + hi) / 2], to: [x0 + best.run, (lo + hi) / 2], name: 'the town\'s street eastward from its start' }
  })
}

/** A long straight street of San Francisco from the release's own graph round the arrival (`--find`): the longest run of roads, each going on from the last within a few degrees. */
async function sfRoute(page) {
  await page.waitForFunction(() => globalThis.engine.street?.ready, null, { timeout: 180_000 })
  return page.evaluate(() => {
    const e = globalThis.engine, x0 = e.pose.x * 10, z0 = e.pose.z * 10
    const roads = e.street.roads(x0, z0, 40000).filter((r) => r.open !== false && !(r.flags & 4)), byKey = new Map(roads.map((r) => [r.key, r]))
    const dir = (l, i) => Math.atan2(l[i + 3] - l[i + 1], l[i + 2] - l[i]), turn = (a, b) => { let d = a - b; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return Math.abs(d) }
    let best = null
    for (const first of roads) {
      const a0 = dir(first.line, 0), seen = new Set([first.key])
      let r = first, steep = 0
      for (;;) {
        const end = dir(r.line, r.line.length - 4)
        const next = r.next.map((k) => byKey.get(k)).filter((n) => n && !seen.has(n.key) && turn(dir(n.line, 0), end) < 0.12 && turn(dir(n.line, n.line.length - 4), a0) < 0.06).sort((p, q) => turn(dir(p.line, 0), end) - turn(dir(q.line, 0), end))[0]
        if (!next) break
        seen.add(next.key); r = next
      }
      const from = [first.line[0], first.line[1]], to = [r.line[r.line.length - 2], r.line[r.line.length - 1]], run = Math.hypot(to[0] - from[0], to[1] - from[1])
      // A street a car leaves the ground on is another check's: the steepest 100 m of it is under 1 in 12.
      for (let d = 0; d + 1000 <= run; d += 500) { const at = (k) => e.ground((from[0] + ((to[0] - from[0]) * k) / run) / 10, (from[1] + ((to[1] - from[1]) * k) / run) / 10); steep = Math.max(steep, Math.abs(at(d + 1000) - at(d)) / 100) }
      if (steep < 0.085 && (!best || run > best.run)) best = { from, to, run, name: `a street of ${seen.size} roads` }
    }
    // Its lane: 1.65 m right of the line (a road that runs both ways has its line between them).
    if (best) { const l = best.run, nx = -(best.to[1] - best.from[1]) / l, nz = (best.to[0] - best.from[0]) / l; for (const p of [best.from, best.to]) { p[0] += nx * 16.5; p[1] += nz * 16.5 } }
    return best
  })
}

/**
 * In the page: the eye (or the coupe with the eye behind it) along the line. It stands at the start `stand` seconds
 * first; then goes `seconds` (a car: once it is above `kmh`), every frame kept; then stays where it stopped `hold` seconds.
 */
async function run({ line, mode, kmh, seconds, stand, hold, scale, sunMost, freeze, ahead }) {
  const e = globalThis.engine, P = globalThis.__prof
  const dx = line.to[0] - line.from[0], dz = line.to[1] - line.from[1], length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  /** The world round the eye made, and the sun's maps drawn. */
  const settled = async (limit = 60_000) => { for (const until = performance.now() + limit; performance.now() < until;) { const s = e.world.stats; if (s.wanted === 0 && s.stale === 0 && e.march.sun.undrawn === 0) return true; await sleep(200) } return false }
  const yaw = Math.atan2(ux, -uz), eyeAt = (along) => { const x = line.from[0] + ux * along, z = line.from[1] + uz * along; Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 1.5, yaw, pitch: -0.03 }); return [x, e.pose.y * 10, z] }
  // How many of the sun's tiles each frame draws (and, for finding what they cost, no more than `sunMost` of them).
  if (!P.plan) { P.plan = e.march.sun.plan.bind(e.march.sun); e.march.sun.plan = (eye, most, ready) => { const out = P.plan(eye, Math.min(most, P.sunMost ?? most), ready); P.cat.tiles = (P.cat.tiles ?? 0) + out.length; return out } }
  P.sunMost = sunMost ?? undefined
  // (A page with the sun's share, #73: `sunMost` tiles whatever they cost, or its own count with `null`.)
  if (e.sunRoom) { e.sunRoom.fixed = sunMost; P.sunMost = undefined }
  // (`--ahead`: things drawn on to the frame's own time, or as the mover last said them.)
  if (ahead !== undefined && 'ahead' in e) e.ahead = ahead
  let thing = null
  if (e.alive.riding) e.alive.mount(null)
  if (e.me.on) e.me.walk(false)
  if (scale) e.scale = scale
  eyeAt(0)
  await sleep(1500); await settled()
  if (mode === 'car') {
    // The fast one (summon.ts: the coupe, 212 km/h), set down facing along the street and got into.
    for (let tries = 0; tries < 5 && !thing; tries++) { thing = await e.summonCar(); if (!thing) await sleep(700) }
    if (!thing) return { why: 'no car could be set down', still: [], buffers: {}, frames: [], loaf: [], heard: [] }
    const x = Math.round(line.from[0] + ux * 60), z = Math.round(line.from[1] + uz * 60), ground = Math.round(e.ground(x / 10, z / 10) * 10)
    const own = [0, Math.PI, -Math.PI / 2, Math.PI / 2][thing.motor.front], q = own - Math.atan2(uz, ux), w = e.alive.where(thing), low = w ? w.at[1] - Math.round(e.ground(w.at[0] / 10, w.at[2] / 10) * 10) : 8
    e.alive.place(thing, [x, ground + low + 1, z], [0, Math.sin(q / 2), 0, Math.cos(q / 2)])
    await sleep(1500)
    e.alive.mount(thing)
    await sleep(800); await settled()
  }
  let steer = 0, steering = 0
  const turnTo = (way) => { if (way === steering) return; if (steering) e.input.hold(steering > 0 ? 'KeyD' : 'KeyA', false); if (way) e.input.hold(way > 0 ? 'KeyD' : 'KeyA', true); steering = way }
  const release = () => { turnTo(0); for (const k of ['KeyW', 'ShiftLeft', 'KeyS']) e.input.hold(k, false) }
  const taken = (gap, more) => { const cat = P.cat, s = e.world.stats; P.cat = {}; return { gap, laps: { ...e.laps }, cat, wanted: s.wanted, flying: s.flying, sun: e.march.sun.undrawn, gpu: e.gpuMs, scale: e.scale, step: e.fell?.stepMs ?? 0, room: e.sunRoom ? { drew: e.sunRoom.drew, tileMs: e.sunRoom.tileMs, moving: e.sunRoom.moving, share: e.sunRoom.share } : null, ...more } }
  // Standing at the start: what this GPU gives the same page with nothing passing.
  const still = []
  if (stand) { P.cat = {}; const stop = e.watch((gap) => still.push(taken(gap, { t: 0, kmh: 0 }))); await sleep(stand * 1000); stop(); still.shift() }
  if (thing) { e.input.hold('KeyW', true); e.input.hold('ShiftLeft', true) }
  const frames = [], t0 = performance.now()
  let began = mode === 'eye' ? t0 : 0, done = null, stopAt = mode === 'eye' ? began + seconds * 1000 : Infinity, slow = 0, stopped = 0
  const finished = new Promise((r) => (done = r))
  P.cat = {}; P.loaf.length = 0; P.heard.length = 0; P.buffers = {}
  const stop = e.watch((gap) => {
    const now = performance.now()
    let at, speed = kmh
    if (stopped) {
      if (now > stopped + hold * 1000) return done(null)
      frames.push(taken(gap, { t: now - began, kmh: 0, held: true }))
      return
    }
    if (thing) {
      const w = e.alive.where(thing)
      if (!w || !thing.alive) return done('the car was lost')
      at = w.at
      speed = e.alive.telemetry?.kmh ?? 0
      // The pilot: flat out with the boost, steering for a point 60 m on along the line.
      const along = (at[0] - line.from[0]) * ux + (at[2] - line.from[1]) * uz, tx = line.from[0] + ux * (along + 600) - at[0], tz = line.from[1] + uz * (along + 600) - at[2]
      let err = Math.atan2(tz, tx) - Math.atan2(w.front[2], w.front[0])
      err -= Math.round(err / (2 * Math.PI)) * 2 * Math.PI
      const left = length - along
      if (left < 400 || now > stopAt) { release(); return done(left < 400 ? 'the street ended' : null) }
      // The wheel is a key held or not: how much of the time it is held is how far it is turned.
      steer += Math.max(-1, Math.min(1, err * 3))
      if (steer > 0.5) { steer -= 1; turnTo(1) } else if (steer < -0.5) { steer += 1; turnTo(-1) } else turnTo(0)
      if (!began && speed >= kmh) { began = now; stopAt = now + seconds * 1000; P.buffers = {}; P.cat = {} }
      // Stopped by something in the road: what follows is a crash, which is another check's.
      if (began && speed < kmh * 0.4 && ++slow > 20) { release(); return done(`the car was stopped ${Math.round((now - began) / 100) / 10} s in (${Math.round(speed)} km/h)`) }
      if (!began && now - t0 > 40_000) { release(); return done(`never reached ${kmh} km/h (${Math.round(speed)})`) }
    } else {
      const went = Math.min(length - 300, ((now - began) / 1000) * (kmh / 3.6) * 10)
      at = eyeAt(went)
      if (went >= length - 300 || now > stopAt) {
        // For a picture of the shadows as they were while it went (`--shots`): where a run of this speed always ends, and no tile drawn from here on.
        if (freeze) { eyeAt(Math.min(length - 300, seconds * (kmh / 3.6) * 10)); P.sunMost = 0; if (e.sunRoom) e.sunRoom.fixed = 0 }
        if (hold) { stopped = now; return }
        return done(went >= length - 300 ? 'the street ended' : null)
      }
    }
    if (began) frames.push(taken(gap, { t: now - began, kmh: speed, at: [Math.round(at[0]), Math.round(at[1]), Math.round(at[2])], eye: e.view().eye.map((v) => Math.round(v * 10) / 10) }))
  })
  // Where the car is drawn in each frame: asked after the page's own frame has run (this was asked for after it, so runs after it).
  let watching = true
  const after = () => { if (!watching) return; const f = frames.at(-1), w = thing && f && !f.shown && e.alive.where(thing); if (w) f.shown = [w.at[0], w.at[1], w.at[2]]; requestAnimationFrame(after) }
  if (thing) requestAnimationFrame(after)
  const why = await finished
  watching = false
  stop()
  release()
  return { why, still, buffers: P.buffers, frames, loaf: P.loaf.filter((l) => l.at >= began), heard: P.heard.filter((t) => t >= began).map((t) => t - began), tiles: e.tiles ? { ...e.tiles.tally } : null, crashed: e.world.stats.crashed, full: e.world.stats.full }
}

/**
 * How a car is shown going: where it is in each frame against where its speed and the frame's own gap put it. A frame in
 * which it has not come half as far is one it stood still in; one in which it has come half as far again, a jump.
 */
function evenness(frames) {
  const at = (f) => f.shown ?? f.at
  // (A frame's place is asked after it is drawn; its gap is the time since the frame before it.)
  const shown = frames.slice(1).map((f, i) => Math.hypot(at(f)[0] - at(frames[i])[0], at(f)[2] - at(frames[i])[2]) / Math.max(1e-6, (f.kmh / 3.6) * 10 * (f.gap / 1000)))
  const off = shown.map((v) => Math.abs(v - 1)).sort((a, b) => a - b)
  return { frames: shown.length, stood: shown.filter((v) => v < 0.5).length, jumped: shown.filter((v) => v > 1.5).length, off95: round(off[Math.floor(off.length * 0.95)] ?? 0, 2), off99: round(off[Math.floor(off.length * 0.99)] ?? 0, 2) }
}

/** The gaps of some frames, and what they cost the page's thread and the GPU. */
function summary(frames) {
  const sorted = (get) => frames.map(get).sort((a, b) => a - b), at = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0
  const gaps = sorted((f) => f.gap), thread = sorted((f) => f.cat.thread ?? 0), third = Math.max(1, Math.floor(frames.length / 3))
  return {
    frames: frames.length, over33: gaps.filter((g) => g > 33).length, over50: gaps.filter((g) => g > 50).length, over100: gaps.filter((g) => g > 100).length,
    late: gaps.filter((g) => g > 33).length / Math.max(1, gaps.length),
    p50: round(at(gaps, 0.5)), p95: round(at(gaps, 0.95)), p99: round(at(gaps, 0.99)), worst: round(gaps.at(-1) ?? 0),
    march: round(mean(frames, (f) => f.gpu), 2), thread: round(mean(frames, (f) => f.cat.thread ?? 0), 2), thread99: round(at(thread, 0.99)), threadMost: round(thread.at(-1) ?? 0),
    wanted: Math.round(mean(frames, (f) => f.wanted)), wantedEnd: Math.round(mean(frames.slice(-third), (f) => f.wanted)),
    sun: Math.round(mean(frames, (f) => f.sun)), sunEnd: Math.round(mean(frames.slice(-third), (f) => f.sun)),
    scale: round(mean(frames, (f) => f.scale), 2), tiles: round(mean(frames, (f) => f.cat.tiles ?? 0), 2), kb: Math.round(mean(frames, (f) => f.cat['written KB'] ?? 0)),
    lateBy: [[0, 0], [1, 2], [3, 99]].map(([lo, hi]) => { const fs = frames.filter((f) => (f.cat.tiles ?? 0) >= lo && (f.cat.tiles ?? 0) <= hi); return `${fs.filter((f) => f.gap > 33).length}/${fs.length}` }).join(' '),
  }
}
function rowOf(s) {
  return `${String(s.frames).padStart(5)} ${String(s.over33).padStart(4)}  ${String(s.p50).padStart(5)} ${String(s.p95).padStart(5)} ${String(s.p99).padStart(5)} ${String(s.worst).padStart(6)}  ${String(s.march).padStart(6)}  ${String(s.thread).padStart(6)} ${String(s.thread99).padStart(5)} ${String(s.threadMost).padStart(6)}  ${String(s.wanted).padStart(6)} ${String(s.wantedEnd).padStart(6)}  ${String(s.sun).padStart(5)} ${String(s.sunEnd).padStart(5)}  ${String(s.tiles).padStart(5)} ${String(s.kb).padStart(6)}  ${s.lateBy}  ${String(s.scale).padStart(5)}`
}

function report(r) {
  const all = r.frames.filter((f) => !f.held), s = summary(all), rest = summary(r.still)
  if (r.why) console.log(`  the run ended early: ${r.why}`)
  const speeds = all.map((f) => f.kmh).sort((a, b) => a - b), median = round(speeds[speeds.length >> 1] ?? 0)
  const metres = all.length ? round(Math.hypot(all.at(-1).at[0] - all[0].at[0], all.at(-1).at[2] - all[0].at[2]) / 10) : 0
  console.log(`  ${all.length} frames in ${round((all.at(-1)?.t ?? 0) / 1000)} s over ${metres} m at ${median} km/h (top ${round(speeds.at(-1) ?? 0)})`)
  console.log('             frames · over 33 ms · p50 p95 p99 worst gap · march ms · thread ms a frame, its 99th, its most · sectors wanted (mean, end) · sun tiles undrawn (mean, end) · sun tiles drawn a frame · KB written a frame · late frames of those drawing 0, 1 to 2, 3 or more tiles · the picture\'s scale')
  console.log(`    standing ${rowOf(rest)}`)
  console.log(`    going    ${rowOf(s)}   (over 50 ms: ${s.over50}, over 100 ms: ${s.over100})`)
  if (r.heard.length > 2) {
    // How evenly the eye moved: each frame's speed over its own gap against the last one's, as a share (a car that waits and then jumps reads 0 then 2).
    const eyeSpeed = all.slice(1).map((f, i) => Math.hypot(f.eye[0] - all[i].eye[0], f.eye[2] - all[i].eye[2]) / Math.max(1, f.gap))
    const jerk = eyeSpeed.slice(1).map((v, i) => Math.abs(v - eyeSpeed[i]) / Math.max(1e-6, (v + eyeSpeed[i]) / 2)).sort((a, b) => a - b), gaps = r.heard.slice(1).map((t, i) => t - r.heard[i]).sort((a, b) => a - b)
    console.log(`  the eye's speed from one frame to the next differs by ${round(jerk[jerk.length >> 1] ?? 0, 2)} of itself at the median, ${round(jerk[Math.floor(jerk.length * 0.95)] ?? 0, 2)} at the 95th; the mover answered ${r.heard.length} times, ${round(gaps[gaps.length >> 1] ?? 0)} ms apart at the median, ${round(gaps[Math.floor(gaps.length * 0.99)] ?? 0)} at the 99th, ${round(gaps.at(-1) ?? 0)} at most`)
    const even = evenness(all), steps = all.map((f) => f.step).sort((a, b) => a - b)
    console.log(`  the car as shown: in ${even.stood} of ${even.frames} frames it had not come half as far as its speed says, in ${even.jumped} half as far again (off by ${even.off95} of a frame's way at the 95th, ${even.off99} at the 99th); the mover's steps took ${round(steps[steps.length >> 1] ?? 0)} ms at the median, ${round(steps[Math.floor(steps.length * 0.99)] ?? 0)} at the 99th, ${round(steps.at(-1) ?? 0)} at most`)
  }
  // Where the page's thread spent each frame: the parts of the frame (laps), and what ran between frames.
  const late = all.filter((f) => f.gap > 33), keys = new Set()
  for (const f of all) { for (const k of Object.keys(f.laps)) keys.add(`lap ${k}`); for (const k of Object.keys(f.cat)) keys.add(k) }
  const of = (f, k) => (k.startsWith('lap ') ? f.laps[k.slice(4)] : f.cat[k]) ?? 0, most = (fs, k) => fs.reduce((n, f) => Math.max(n, of(f, k)), 0)
  const rows = [...keys].map((k) => ({ k, rest: mean(r.still, (f) => of(f, k)), all: mean(all, (f) => of(f, k)), late: mean(late, (f) => of(f, k)), max: most(all, k) })).filter((x) => x.max >= 0.5).sort((a, b) => b.all - a.all)
  console.log(`  where the page's thread went (ms a frame): standing · going · the ${late.length} frames over 33 ms · the most in any`)
  for (const x of rows) console.log(`    ${x.k.padEnd(22)} ${String(round(x.rest, 2)).padStart(8)} ${String(round(x.all, 2)).padStart(8)} ${String(round(x.late, 2)).padStart(8)} ${String(round(x.max, 1)).padStart(8)}`)
  console.log('  the frames whose thread time was longest:')
  for (const f of [...all].sort((a, b) => (b.cat.thread ?? 0) - (a.cat.thread ?? 0)).slice(0, 6)) {
    const parts = [...keys].filter((k) => !/KB|thread/.test(k)).map((k) => [k, of(f, k)]).filter(([, v]) => v >= 1.5).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k} ${round(v)}`).join(', ')
    console.log(`    ${String(round(f.cat.thread ?? 0)).padStart(6)} ms (gap ${round(f.gap)}) at ${round(f.t / 1000, 2)} s, ${Math.round(f.kmh)} km/h, ${f.wanted} wanted, sun ${f.sun}: ${parts}`)
  }
  console.log('  second by second: km/h · frames · over 33 ms · worst gap · march ms · sectors wanted · sun tiles undrawn · thread ms a frame')
  for (let sec = 0; sec * 1000 <= (all.at(-1)?.t ?? -1); sec++) {
    const fs = all.filter((f) => f.t >= sec * 1000 && f.t < (sec + 1) * 1000)
    if (fs.length) console.log(`    ${String(sec).padStart(2)}: ${String(Math.round(mean(fs, (f) => f.kmh))).padStart(4)} ${String(fs.length).padStart(4)} ${String(fs.filter((f) => f.gap > 33).length).padStart(4)} ${String(round(Math.max(...fs.map((f) => f.gap)))).padStart(7)} ${String(round(mean(fs, (f) => f.gpu))).padStart(6)} ${String(Math.round(mean(fs, (f) => f.wanted))).padStart(6)} ${String(Math.round(mean(fs, (f) => f.sun))).padStart(5)} ${String(round(mean(fs, (f) => f.cat.thread ?? 0))).padStart(6)}`)
  }
  const bufs = Object.entries(r.buffers ?? {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)
  if (bufs.length) { console.log('  what was written to the GPU (calls · MB · ms · the most in one, KB):'); for (const [k, b] of bufs) console.log(`    ${k.padEnd(34)} ${String(b.n).padStart(6)} ${String(round(b.bytes / 1e6)).padStart(8)} ${String(round(b.ms)).padStart(8)} ${String(Math.round(b.most / 1024)).padStart(8)}`) }
  if (r.loaf.length) {
    const by = new Map()
    for (const l of r.loaf) for (const sc of l.scripts) { const k = `${sc.by} → ${sc.in}`; const had = by.get(k) ?? { n: 0, ms: 0, max: 0 }; had.n++; had.ms += sc.ms; had.max = Math.max(had.max, sc.ms); by.set(k, had) }
    console.log(`  ${r.loaf.length} long animation frames (Chrome's own count of frames over 50 ms), their scripts:`)
    for (const [k, v] of [...by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8)) console.log(`    ${String(Math.round(v.ms)).padStart(6)} ms in ${String(v.n).padStart(3)}, most ${Math.round(v.max)}: ${k.slice(0, 150)}`)
  }
  if (r.tiles) console.log(`  tiles: ${JSON.stringify(r.tiles)}${r.crashed ? `; ${r.crashed} makers failed` : ''}${r.full ? `; ${r.full} sectors did not fit the pool` : ''}`)
  if (r.profile) sampled(r.profile)
}

/**
 * A pass held to its bounds: `held` are what the page does whatever else draws on the GPU, `timings` what a busy GPU
 * slows (measured again alone before they fail). `say` prints where the time went.
 */
function judged(r, say) {
  if (say) report(r)
  const going = r.frames.filter((f) => !f.held), stopped = r.frames.filter((f) => f.held), s = summary(going), rest = summary(r.still)
  const speeds = going.map((f) => f.kmh).sort((a, b) => a - b), median = round(speeds[speeds.length >> 1] ?? 0)
  // The sun's maps: what the tiles of a moving frame took of it (what a tile was last measured to take on the GPU, times those drawn), and how long after stopping until all were drawn and the world round the eye made.
  const moving = going.filter((f) => f.room?.moving), share = mean(moving, (f) => f.room.share), tile = mean(moving, (f) => f.room.tileMs), drew = mean(moving, (f) => f.room.drew)
  const drawnAt = stopped.find((f) => f.sun === 0 && f.wanted === 0), drawn = drawnAt ? round((drawnAt.t - stopped[0].t) / 1000) : null
  const held = [
    { ok: !r.why || r.why === 'the street ended', what: `it went its ${seconds} s${r.why ? ` (${r.why})` : ''}` },
    { ok: median >= Math.min(kmh, 100), what: `it went fast: ${median} km/h at the median` },
    { ok: moving.length > 0 && drew * tile <= share * BOUND.share, what: moving.length ? `the sun's tiles kept to their share of a moving frame: ${round(drew, 2)} a frame, ${moving.reduce((n, f) => Math.max(n, f.room.drew), 0)} at most, at ${round(tile, 2)} ms of the GPU a tile (${round(drew * tile, 2)} ms a frame; the share is ${round(share, 2)} ms)` : `the page gives the sun's tiles no share of a frame: ${s.tiles} a frame on average, ${going.reduce((n, f) => Math.max(n, f.cat.tiles ?? 0), 0)} at most` },
    // (The eye alone stops where it is told to. A car is another matter, and is not held to it.)
    ...(stopped.length ? [{ ok: drawn !== null, what: `stopped, every tile of the sun's maps was drawn and the world made in ${drawn ?? `more than ${BOUND.drawn}`} s (${stopped[0].sun} tiles were not when it stopped)` }] : []),
    // (In San Francisco the makers fall behind from about 180 km/h, before this check and after: said, and held to nothing there.)
    { ok: sf || s.wantedEnd <= BOUND.wanted, what: `${sf && s.wantedEnd > BOUND.wanted ? 'the makers fell behind' : 'the makers kept up'}: ${s.wanted} sectors wanted on average, ${s.wantedEnd} over the last third${sf ? '' : ` (${BOUND.wanted} allowed)`}` },
  ]
  const timings = [
    { ok: s.late - rest.late <= BOUND.late, what: `frames over 33 ms going at ${median} km/h: ${round(s.late * 100)}% (${s.over33} of ${s.frames}), standing ${round(rest.late * 100)}% (no more than ${BOUND.late * 100} points over)` },
    { ok: s.thread99 <= BOUND.thread99 && s.threadMost <= BOUND.threadMost, what: `the page's thread ${s.thread} ms a frame, ${s.thread99} at the 99th of a hundred (${BOUND.thread99} allowed), ${s.threadMost} at most (${BOUND.threadMost})` },
    { ok: s.march <= Math.max(rest.march * BOUND.march, rest.march + 1), what: `the march ${s.march} ms going, ${rest.march} standing (no more than ${BOUND.march} times it)` },
  ]
  return { held, timings, summary: { standing: rest, going: s, kmh: median, tiles: round(drew, 2), tileMs: round(tile, 2), drawn, why: r.why } }
}

/** Chrome's samples of the page's thread: the functions the time was in, itself and with what it called. */
function sampled(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map(), total = new Map(), parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`
  let all = 0
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000, n = nodes.get(id)
    all += dt
    self.set(name(n), (self.get(name(n)) ?? 0) + dt)
    const seen = new Set()
    for (let at = id; at !== undefined; at = parent.get(at)) { const k = name(nodes.get(at)); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) ?? 0) + dt) } }
  })
  const idle = (self.get('(idle) :0') ?? 0) + (self.get('(program) :0') ?? 0)
  console.log(`  Chrome's samples: ${Math.round(all)} ms, ${Math.round(all - idle)} ms of it the page's own code. By itself:`)
  for (const [k, v] of [...self].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(`    ${String(Math.round(v)).padStart(6)} ms  ${k}`)
  console.log('  with what each called:')
  for (const [k, v] of [...total].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 36)) console.log(`    ${String(Math.round(v)).padStart(6)} ms  ${k}`)
}
