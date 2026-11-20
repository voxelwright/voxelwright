// The San Francisco realm in WebKit at a phone's size (#450): Playwright's WebKit has no WebGPU, so this opens the
// static folder in Safari on the iOS Simulator (Xcode's, on this Mac), at an iPhone's screen. It is WebKit's engine and
// its limits, drawn on this Mac's GPU: what it says of frame time is WebKit's, not a phone's GPU.
//
//   node test/sf-phone.mjs [--device "iPhone 17"] [--seconds 10] [--shots ~/.village/engine/sf]
//
// A page of the check's own (`/measure.html`, served only by this check, never in the folder) holds the realm in a
// frame of the same site, waits for it, then reads the realm's own numbers as test/sf.mjs does (when the park was
// shown and whole, frame gaps and the picture's scale at the park, on Taylor St and 150 m up, what every core holds)
// and posts them back here. Fails where the realm does not draw in WebKit, or 30 fps does not hold.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { arg, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const device = arg('device', 'iPhone 17'), seconds = Number(arg('seconds', '10')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf'))
mkdirSync(shots, { recursive: true })
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const sim = (...a) => execFileSync('xcrun', ['simctl', ...a], { encoding: 'utf8' })

const MEASURE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<iframe id="realm" src="/sf/index.html"></iframe>
<script>
const say = (what) => fetch('/report', { method: 'POST', body: JSON.stringify(what) })
const wait = (ask, ms) => new Promise((done, fail) => { const t0 = performance.now(); const tick = () => { let v; try { v = ask() } catch {} if (v) return done(v); if (performance.now() - t0 > ms) return fail(new Error('waited')); setTimeout(tick, 250) }; tick() })
onerror = (m) => say({ error: String(m) })
;(async () => {
  try {
    const frame = document.getElementById('realm')
    // The realm's own errors, caught as soon as its document is there (its module waits on the GPU before it can fail).
    const caught = []
    await wait(() => { const d = frame.contentDocument; return d && d.URL.endsWith('/sf/index.html') }, 30000)
    const w = frame.contentWindow
    w.addEventListener('error', (e) => { caught.push(String(e.message)); say({ caught: String(e.message) }) })
    w.addEventListener('unhandledrejection', (e) => { caught.push(String(e.reason?.message ?? e.reason)); say({ caught: String(e.reason?.stack ?? e.reason) }) })
    for (const kind of ['error', 'warn']) { const was = w.console[kind].bind(w.console); w.console[kind] = (...a) => { say({ [kind]: a.map(String).join(' ').slice(0, 400) }); was(...a) } }
    const where = () => ({ engine: !!w.engine, seen: w.engine?.seen, stats: w.engine?.world?.stats && { ready: w.engine.world.stats.ready, wanted: w.engine.world.stats.wanted, made: w.engine.world.stats.made }, tally: w.engine?.tiles?.tally, body: w.document.body?.innerText?.slice(0, 300) })
    setInterval(() => say({ where: where() }), 15000)
    say({ gpu: !!navigator.gpu, ua: navigator.userAgent, screen: [innerWidth, innerHeight, devicePixelRatio] })
    const e = await wait(() => w.engine?.seen?.first > 0 && w.engine, 180000)
    await wait(() => e.seen.whole > 0, 240000)
    const load = { first: Math.round(e.seen.first), near: Math.round(e.seen.near), whole: Math.round(e.seen.whole) }
    const park = { ...e.pose }, ground = e.ground(park.x, park.z), street = { x: 51590, z: 66300, yaw: -0.164, pitch: 0 }
    street.y = e.ground(street.x, street.z) + 1.7
    const frames = async (pose, fov) => {
      Object.assign(e.pose, pose); e.fov = fov
      await new Promise((r) => setTimeout(r, 1500)); await wait(() => e.world.stats.wanted === 0 && e.world.stats.stale === 0, 60000).catch(() => {}); await new Promise((r) => setTimeout(r, 2000))
      const gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ${seconds * 1000})); stop()
      const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => Math.round(g[Math.min(g.length - 1, Math.floor(g.length * p))] * 10) / 10
      return { frames: g.length, p50: q(0.5), p99: q(0.99), scale: e.scale, marchMs: Math.round(e.gpuMs * 10) / 10 }
    }
    const f = { park: await frames(park, 25.05), street: await frames(street, 70), up150: await frames({ x: park.x, y: ground + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70) }
    Object.assign(e.pose, park); e.fov = 25.05
    const m = await e.tiles.memory()
    say({ done: true, device: e.tiles.device, load, frames: f, memory: { coresMB: Math.round((m.page + m.workers.reduce((a, b) => a + b, 0)) / 1048576), pageCoreMB: Math.round(m.page / 1048576), workerCoresMB: m.workers.map((b) => Math.round(b / 1048576)), tilesHeldMB: Math.round(m.tiles / 1048576) }, controls: !!e.realmControls })
  } catch (x) { say({ error: String(x?.message ?? x) }) }
})()
</script>`

let report = null
const said = []
const extra = (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path === '/measure.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(MEASURE); return true }
  if (path === '/report' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c)); req.on('end', () => { const r = JSON.parse(body); said.push(r); console.log(`  said: ${body.slice(0, 300)}`); if (r.done || r.error) report = r; res.end() })
    return true
  }
  return false
}
const site = await plain(join(here, 'dist-sf'), '127.0.0.1', 0, { extra })
const id = sim('list', 'devices', 'available').split('\n').find((l) => l.trim().startsWith(`${device} (`))?.match(/\(([0-9A-F-]{36})\)/)?.[1]
if (!id) { console.error(`no simulator named ${device}`); process.exit(1) }
let back = () => {}
const stop = () => { try { sim('shutdown', id) } catch { /* already */ } site.stop(); back() }
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stop(); process.exit(1) })
try {
  back = await turn()
  try { sim('boot', id) } catch { /* booted */ }
  sim('bootstatus', id, '-b')
  console.log(`${device} (${id}): ${site.url}/measure.html`)
  sim('openurl', id, `${site.url}/measure.html`)
  const began = Date.now()
  while (!report && Date.now() - began < 10 * 60_000) await new Promise((r) => setTimeout(r, 1000))
  try { sim('io', id, 'screenshot', join(shots, 'phone-webkit.png')) } catch { /* no picture */ }
} finally { stop() }
writeFileSync(join(shots, 'phone-webkit.json'), JSON.stringify({ device, said, asked: site.asked }, null, 1))
// How far the page came, by what it asked for.
const kinds = {}
for (const a of site.asked) { const k = `${a.path.includes('/tiles/') ? 'tile' : a.path.split('/').slice(0, 3).join('/')} ${a.status}`; kinds[k] = (kinds[k] ?? 0) + 1 }
console.log(`  asked: ${JSON.stringify(kinds)}`)
const gpu = said.find((s) => 'gpu' in s)
check(!!gpu?.gpu, `WebGPU in WebKit (${gpu?.ua ?? 'no word from the page'})`)
check(!!report?.done, report?.done ? `the realm drew in WebKit: park shown ${report.load.near} ms, whole ${report.load.whole} ms (on localhost)` : `the realm did not finish in WebKit: ${report?.error ?? 'no answer in 10 minutes'}`)
if (report?.done) {
  for (const [where, f] of Object.entries(report.frames)) check(f.p50 <= 34, `${where}: p50 ${f.p50} ms, p99 ${f.p99} ms at scale ${f.scale}, march ${f.marchMs} ms (bound 30 fps)`)
  console.log(`  memory (${report.device}): ${JSON.stringify(report.memory)}; controls ${report.controls}`)
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
