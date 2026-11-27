// The San Francisco realm from static files, measured (#450): the folder `node sf/build.mjs` writes, served as a host
// of plain files set up for a release would serve it (player/serve.mjs: Brotli where the browser takes it, a year's
// keep for what a release holds, the pointer asked every time; no COOP, COEP or CSP), opened in Chrome with WebGPU.
//
//   node test/sf.mjs [--no-build] [--dist dist-sf] [--far <far.json>] [--seconds 10] [--shots ~/.village/engine/sf/runtime] [--headed] [--plainly] [--mbit 25]
//
// It says, and fails where any is worse than its bound:
//   - what crosses the wire until the first picture, until the place is shown round the eye and until the world is
//     whole there (bytes as sent and as decoded), and when, on a link of `--mbit` (25 Mbit/s, 40 ms) from a cold cache;
//   - that only what the release lists is asked for: the page's code, the pointer once, its manifest and the files it
//     lists, nothing else and nothing twice, and no tile is ever made on asking;
//   - frame gaps (p50, p99) at the park's camera, at street level on Taylor St and 150 m over the park, with the scale
//     the page chose and the GPU's time for the march beside them, then the march at every pixel;
//   - the tile bytes in a 60 s walk and a 60 s flight;
//   - what every core holds in memory, and what the page holds for its workers;
//   - that the page carries on through a tile that fails, a maker of sectors that dies, a mover that dies, and a reset
//     sent while a blast's answer is on its way;
//   - whether each stage-1 feature works from plain files, and that no model's helper is reached however one is offered.
// `--plainly` serves every file as it is, as a host with no Brotli copies would: the page must work the same.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, REALM_CHROME, has, here, quiet, timed, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'runtime')), seconds = Number(arg('seconds', '10')), mbit = Number(arg('mbit', '25'))
const M = 10
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist, ...(arg('far', null) ? ['--far', arg('far')] : [])], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}
mkdirSync(shots, { recursive: true })
const pointer = JSON.parse(readFileSync(join(dist, 'sf/current.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(dist, 'sf', pointer.manifest), 'utf8'))
const releaseAt = `/sf/${pointer.manifest.replace(/manifest\.json$/, '')}`
/** Every address the page may ask for in a release: the manifest and what it lists. */
/** Every record's path in a manifest, wherever it lies (tiles, names, graphs, street life, cars, the far model). */
const paths = (v) => (Array.isArray(v) ? v.flatMap(paths) : v && typeof v === 'object' ? (typeof v.path === 'string' && typeof v.sha256 === 'string' ? [v.path] : Object.values(v).flatMap(paths)) : [])
const listed = new Set([`/sf/${pointer.manifest}`, ...paths(manifest).map((p) => releaseAt + p)])
// The public first view reads its locker layout. Only the private build reads a clip catalogue.
const eggIndexes = new Set(['/sf/eggs/lockers.json'])
if (readFileSync(join(dist, 'sf/index.html'), 'utf8').includes('<body data-egg-media>')) eggIndexes.add('/sf/eggs/memes.json')
const isTile = (path) => path.startsWith(releaseAt + 'tiles/')

// ── Faults, for the checks of what the page carries on through ──
/** Tiles to fail, by address: how many times more each is to fail. */
const failing = new Map()
const fail = (path) => { const n = failing.get(path); if (!n) return 0; failing.set(path, n - 1); return 503 }
const site = await plain(dist, '127.0.0.1', 0, { plainly: has('plainly'), fail })
let back = await turn()
// Stopped from outside (a timeout, ^C), the turn is given back as on any other way out.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { console.log(`\nstopped (${signal}) in ${current.name}`); back(); process.exit(1) })
/** Runs `measure` with every turn on the GPU (kit.mjs `quiet`): no other thread's check draws beside a timing. Its phase's clock starts once they are had. */
const alone = async (name, minutes, measure) => {
  // Our own turn is kept; `quiet` takes the rest (it counts the one this process holds). Waited for three minutes at
  // most: where other lanes keep the GPU busy, it is measured beside them and said so.
  Object.assign(current, { name: `${name} (waiting for the GPU to be quiet)`, deadline: Date.now() + 5 * 60_000 })
  const rest = await quiet({ within: 3 * 60_000 })
  try {
    phase(name, minutes)
    const r = await measure()
    return rest ? r : { ...r, sharedGPU: drawing() }
  } finally { rest?.() }
}
const browser = await chromium.launch({ ...REALM_CHROME, headless: !has('headed') })
// The helper a visitor might be offered (a link, or something kept from another page): it must never be asked.
const HELPER = 'http://127.0.0.1:5762'
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
await context.addInitScript((helper) => { try { localStorage.setItem('village.helper', JSON.stringify({ url: helper, secret: 'offered' })) } catch { /* none */ } }, HELPER)
const away = []
context.on('request', (r) => { if (!r.url().startsWith(site.url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) away.push(r.url()) })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/503 \(Service Unavailable\)/.test(m.text())) errors.push(m.text()) })
// ── Phases, each with its own time: one that runs over is said, fails the check, and closes the browser, so that
// whatever it waits on throws and the run ends through `finally` (the turn on the GPU given back). ──
const current = { name: 'starting', deadline: Infinity }
const phase = (name, minutes) => { Object.assign(current, { name, deadline: Date.now() + minutes * 60_000 }); console.log(`\n${name}`) }
const watchdog = setInterval(() => {
  if (Date.now() < current.deadline) return
  console.log(`  FAIL ${current.name}: timed out`)
  failures.push(`${current.name}: timed out`)
  current.deadline = Infinity
  void browser.close()
}, 1000)
const results = { url: `${site.url}/sf/index.html`, release: pointer.release, served: has('plainly') ? 'plainly' : 'brotli where taken' }

const mb = (n) => round(n / 1048576, 2)
/** Stops and starts this page's drawing (while it waits for the GPU without a turn: kit.mjs `quiet`). */
const resting = (on) => page.evaluate((on) => { if (globalThis.engine) globalThis.engine.resting = on }, on)
/** How many other browsers are drawing on this machine now (their GPU helpers), for a timing taken beside them. */
const drawing = () => Number(spawnSync('sh', ['-c', 'ps -axo command | grep -c "[G]oogle Chrome Helper (.*GPU)"'], { encoding: 'utf8' }).stdout.trim()) - 1
/** What was sent between two moments (ms since 1970): every request, and the tiles alone with their distinct files. */
const sent = (from, to) => {
  const all = { n: 0, raw: 0, wire: 0 }, tiles = { n: 0, raw: 0, wire: 0, files: 0 }, seen = new Set()
  for (const a of site.asked) {
    if (a.status !== 200 || a.at < from || a.at > to) continue
    all.n++; all.raw += a.bytes; all.wire += a.wire
    if (!isTile(a.path)) continue
    tiles.n++; tiles.raw += a.bytes; tiles.wire += a.wire
    if (!seen.has(a.path)) { seen.add(a.path); tiles.files++ }
  }
  return { all: { requests: all.n, wireMB: mb(all.wire), rawMB: mb(all.raw) }, tiles: { requests: tiles.n, files: tiles.files, wireMB: mb(tiles.wire), rawMB: mb(tiles.raw) } }
}

try {
  // ── The first visit, cold, on an ordinary link ──
  phase(`first visit (cold cache, ${mbit} Mbit/s, 40 ms)`, 5)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
  await page.goto(`${site.url}/sf/index.html?rest=0#helper=${encodeURIComponent(HELPER)}&secret=offered`)
  await page.waitForFunction(() => globalThis.engine?.seen?.first > 0, null, { timeout: 180_000 })
  await page.waitForFunction(() => globalThis.engine.seen.near > 0, null, { timeout: 240_000 })
  await page.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
  const t = await page.evaluate(() => ({ origin: performance.timeOrigin, ...globalThis.engine.seen, isolated: crossOriginIsolated }))
  results.load = {
    link: `${mbit} Mbit/s, 40 ms`, firstFrameMs: Math.round(t.first), placeShownMs: Math.round(t.near), wholeMs: Math.round(t.whole),
    untilFirstFrame: sent(0, t.origin + t.first), untilPlaceShown: sent(0, t.origin + t.near), untilWhole: sent(0, t.origin + t.whole),
    crossOriginIsolated: t.isolated,
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  console.log(JSON.stringify(results.load, null, 1))
  // The bounds are for a host that sends Brotli; a plain host sends nine times the bytes, and is checked only to work.
  const squeezed = !has('plainly')
  const shown = (v) => `the park shown round the eye in ${Math.round(v.near)} ms on ${mbit} Mbit/s (bound 8 s with Brotli; first frame ${Math.round(v.first)} ms${v.whole ? `, whole ${Math.round(v.whole)} ms` : ''})`
  if (!squeezed) check(t.near > 0, shown(t))
  else {
    // Measured again (kit.mjs `timed`): a cold visit as the first, in a browser of its own (nothing of the page's
    // shaders kept) on a host of its own (what this one was asked stays this visit's), with this page resting.
    const cold = async () => {
      const other = await plain(dist, '127.0.0.1', 0, {}), fresh = await chromium.launch({ ...REALM_CHROME, headless: !has('headed') })
      const ctx = await fresh.newContext({ viewport: { width: 1280, height: 720 } })
      await page.evaluate(() => { globalThis.engine.resting = true })
      try {
        const p = await ctx.newPage(), link = await ctx.newCDPSession(p)
        await link.send('Network.enable')
        await link.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
        await p.goto(`${other.url}/sf/index.html?rest=0`)
        await p.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 240_000 })
        return await p.evaluate(() => ({ first: globalThis.engine.seen.first, near: globalThis.engine.seen.near }))
      } finally { await fresh.close(); other.stop(); await page.evaluate(() => { globalThis.engine.resting = false }) }
    }
    const r = await timed({ check, first: t, measure: cold, passes: (v) => v.near > 0 && v.near < 8000, say: shown, again: () => phase('the first visit again, alone', 25), idle: resting })
    if (r !== t) results.load.alone = { firstFrameMs: Math.round(r.first), placeShownMs: Math.round(r.near) }
  }
  check(!squeezed || results.load.untilPlaceShown.all.wireMB < 8, `${results.load.untilPlaceShown.all.wireMB} MB over the wire until the park is shown (bound 8 MB)`)
  const firstTile = site.asked.find((a) => isTile(a.path) && a.status === 200)
  results.load.encoding = { accept: firstTile?.accept, sent: firstTile?.encoding }
  check(has('plainly') ? firstTile?.encoding === 'identity' : firstTile?.encoding === 'br', `tiles sent as ${firstTile?.encoding} (the browser takes "${firstTile?.accept}")`)
  const ground = await page.evaluate(() => { const e = globalThis.engine; return e.ground(e.pose.x, e.pose.z) })
  check(ground > 70 && ground < 86, `the tiles are under the park: ground ${round(ground)} m under an eye at 85.98 m`)
  const source = await page.evaluate(async () => { const s = await globalThis.engine.tiles.where(); return { release: s.release, checked: s.checked } })
  check(source.release === pointer.release, `pinned to release ${String(source.release).slice(0, 12)} (manifest hash checked: ${source.checked})`)

  // ── Frames ──
  const settle = () => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)
  /**
   * Frame gaps at a place: as the page steers its picture's size (it aims the march at six tenths of a frame, in steps
   * of 0.05, so it settles on either side of a bound), or with the size pinned (`pin`): at 0.7 for the bound, at 1 for
   * the cost. Once pinned it stays pinned, so the pinned passes come after the steered ones.
   */
  const frames = async (name, pose, fov, pin = null) => {
    await page.evaluate(({ pose, fov }) => { const e = globalThis.engine; Object.assign(e.pose, pose); if (fov) e.fov = fov }, { pose, fov })
    await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(2000)
    const take = () => page.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); return { gaps, scale: e.scale, gpuMs: e.gpuMs, cpuMs: e.cpuMs, fov: e.fov, people: e.folk.drawn?.people ?? 0 } }, seconds * 1000)
    const said = (w) => { const g = w.gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => round(g[Math.min(g.length - 1, Math.floor(g.length * p))]); return { frames: g.length, p50: q(0.5), p99: q(0.99), worst: round(g[g.length - 1]), scale: round(w.scale, 2), marchMs: round(w.gpuMs), cpuMs: round(w.cpuMs) } }
    if (pin) { await page.evaluate((v) => { globalThis.engine.scale = v }, pin); await page.waitForTimeout(2000) }
    // Other lanes draw on this GPU too, some outside the turns (kit.mjs): the bound's pass, short of 60 fps, is taken
    // again twice, ten seconds apart, and the best kept, with how many other browsers were drawing.
    let w = await take(), r = { ...said(w), fov: w.fov, residentsDrawn: w.people, tries: 1 }
    for (let again = 0; pin === 0.7 && again < 2 && r.p50 > 17.5; again++) {
      await page.waitForTimeout(10_000)
      w = await take()
      const next = { ...said(w), fov: w.fov, residentsDrawn: w.people, tries: r.tries + 1 }
      r = next.p50 < r.p50 ? next : { ...r, tries: next.tries }
    }
    if (r.tries > 1) r.besideOthers = drawing()
    if (!pin) await page.screenshot({ path: join(shots, `${name}.png`) })
    console.log(`  ${name}: ${JSON.stringify(r)}`)
    return r
  }
  const park = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  // Taylor St between Green and Union, looking north along it, a person's eye over the road.
  const street = { x: 51590, z: 66300 }
  street.y = await page.evaluate(({ x, z }) => globalThis.engine.ground(x, z), street) + 1.7
  const parkGround = ground
  // As the page steers it: reported, the bound is taken pinned at the end.
  results.frames = await alone('frames as steered', 6, async () => ({
    park: await frames('park', park, 25.05),
    street: await frames('street', { ...street, yaw: -0.164, pitch: 0 }, 70),
    up150: await frames('up150', { x: park.x, y: parkGround + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70),
  }))
  // ── Features ──
  phase('features', 4)
  const f = (results.features = {})
  f.residents = results.frames.street.residentsDrawn
  console.log(`  (report) residents drawn at street level on Taylor St: ${f.residents}; at the park: ${results.frames.park.residentsDrawn}`)
  // In the realm from here (#450: its first view is a still picture, and no key means anything in it; the way in is test/sf-explore.mjs's).
  await page.evaluate(() => globalThis.engine.first?.engage())
  // Sound from plain files: its worklet is beside its module. A key is a gesture, which lets the page make sound.
  await page.keyboard.press('KeyH'); await page.keyboard.press('KeyH')
  f.sound = await page.waitForFunction(() => globalThis.engine.ears !== null, null, { timeout: 15_000 }).then(() => true, () => false)
  check(f.sound, 'sound starts from plain files (its worklet found beside its module)')
  // Flying: the eye moves with the keys.
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), { ...street, yaw: -0.164, pitch: 0 })
  const before = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW')
  const after = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  f.flyMetres = round(Math.hypot(after.x - before.x, after.z - before.z))
  check(f.flyMetres > 5, `flying: W moved the eye ${f.flyMetres} m`)
  // Walking: on one's feet (B), W walks.
  await page.evaluate(() => globalThis.engine.me.walk(true))
  await page.waitForTimeout(2500)
  const feet0 = await page.evaluate(() => globalThis.engine.me.feet?.at ?? null)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW')
  await page.waitForTimeout(500)
  const feet1 = await page.evaluate(() => globalThis.engine.me.feet?.at ?? null)
  f.walkMetres = feet0 && feet1 ? round(Math.hypot(feet1[0] - feet0[0], feet1[2] - feet0[2]) / M) : 0
  check(f.walkMetres > 1, `walking: on foot, W walked ${f.walkMetres} m`)
  await page.evaluate(() => globalThis.engine.me.walk(false))
  // The kept car: at a kerb, got into, driven.
  const driving = page.evaluate(async () => {
    const e = globalThis.engine
    // Set down after the tiles round it came (main.ts `kerbside`): waited for, as a visitor would walk to it.
    for (let i = 0; i < 100 && !e.alive.things.some((t) => t.alive && t.name === 'grey saloon' && e.alive.where(t)); i++) await new Promise((r) => setTimeout(r, 100))
    const thing = e.alive.things.find((t) => t.alive && t.name === 'grey saloon' && e.alive.where(t))
    if (!thing) return { missing: { mended: e.mended, things: e.alive.things.map((t) => ({ name: t.name, alive: t.alive, where: !!e.alive.where(t) })) } }
    const w0 = e.alive.where(thing), at = w0.at, low = thing.low, size = thing.size
    // Where it stands: what the ground is under its middle, and whether anything of the world is in its box.
    let inBox = 0
    const g = e.ground(at[0] / 10, at[2] / 10) * 10
    for (let x = low[0] + 1; x < low[0] + size[0] - 1; x += 3) for (let z = low[2] + 1; z < low[2] + size[2] - 1; z += 3) for (let y = Math.round(g) + 2; y < Math.round(g) + size[1]; y += 3) if (e.kind(x, y, z)) inBox++
    const stands = { top: e.top(at[0], at[2]) & 15, inBox, at: at.map(Math.round) }
    // Seen as it stands, from across the street and a little up, before anyone gets in.
    Object.assign(e.pose, { x: at[0] / 10 + 2, y: at[1] / 10 + 5, z: at[2] / 10 + 12, yaw: 0, pitch: -0.3 })
    await new Promise((r) => setTimeout(r, 2500))
    globalThis.__parked = true
    for (let i = 0; i < 50 && globalThis.__parked; i++) await new Promise((r) => setTimeout(r, 100))
    Object.assign(e.pose, { x: at[0] / 10 - 6, y: at[1] / 10 + 3, z: at[2] / 10, yaw: Math.PI / 2, pitch: -0.2 })
    e.alive.mount(thing)
    const from = e.alive.where(thing).at
    for (let i = 0; i < 15; i++) { e.alive.drive(thing, 1, 0, 0); await new Promise((r) => setTimeout(r, 200)) }
    const end = e.alive.where(thing)
    if (!end) return { name: thing.name, stands, wrecked: true, moved: 0 }
    const to = end.at, riding = e.alive.riding === thing
    return { name: thing.name, from, to, moved: Math.hypot(to[0] - from[0], to[2] - from[2]) / 10, riding, look: e.alive.look(thing).parts.length, stands }
  })
  // The picture of it parked, taken while the page waits on it.
  if (await page.waitForFunction(() => globalThis.__parked === true, null, { timeout: 30_000 }).then(() => true, () => false)) { await page.screenshot({ path: join(shots, 'car-parked.png') }); await page.evaluate(() => { globalThis.__parked = false }) }
  const car = await driving
  await page.screenshot({ path: join(shots, 'car-driven.png') })
  if (car?.missing) console.log(`  car missing: ${JSON.stringify(car.missing)}`)
  f.car = car
  check(!!car?.stands && car.stands.top === 6 && car.stands.inBox === 0, `the kept car stands at a kerb: on asphalt (ground kind ${car?.stands.top}), ${car?.stands.inBox} cells of the world in its box, at ${car?.stands.at}`)
  check(!!car?.stands && car.riding && car.moved > 3, `a kept car (${car?.name}, ${car?.look} parts of fine look) got into and driven ${car?.moved ? round(car.moved) : 0} m in 3 s`)
  const carFile = site.asked.find((a) => a.path === '/sf/kept/saloon.json' && a.status === 200)
  f.carFile = carFile && { rawKB: Math.round(carFile.bytes / 1024), wireKB: Math.round(carFile.wire / 1024) }
  check(!!carFile && carFile.bytes < 11_222_339 / 20, `the car's file: ${f.carFile?.rawKB} KB (${f.carFile?.wireKB} KB sent), against 10,960 KB before (bound a twentieth)`)
  await page.evaluate(() => globalThis.engine.alive.mount(null))
  // Destruction: a blast at a house front over the street trees, then reset.
  const aim = { x: street.x, y: street.y + 10, z: street.z, yaw: -0.164 + Math.PI / 2, pitch: 0 }
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), aim)
  await page.waitForTimeout(1500); await settle()
  /** How many cells are solid within 3 m of a place. */
  const solid = (at) => page.evaluate((at) => { const e = globalThis.engine; let n = 0; for (let x = -30; x <= 30; x += 2) for (let y = -30; y <= 30; y += 2) for (let z = -30; z <= 30; z += 2) if (x * x + y * y + z * z <= 900 && e.kind(at[0] + x, at[1] + y, at[2] + z)) n++; return n }, at)
  const hit = await page.evaluate(async () => { const e = globalThis.engine, r = await e.blast(18); return r && { at: r.at, material: r.material, t: r.t } })
  await page.waitForTimeout(5000)
  const broken = hit && { edits: await page.evaluate(() => globalThis.engine.world.done().length - (globalThis.engine.boards?.edits ?? 0)), solid: await solid(hit.at) }
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, { ...p, x: p.x - 25 * Math.sin(p.yaw), z: p.z + 25 * Math.cos(p.yaw), pitch: -0.1 }), aim)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'blast.png') })
  f.blast = { at: hit?.at, material: hit?.material, metresOff: hit ? round(hit.t / M) : null, editsAfter: broken?.edits, solidWithin3mAfter: broken?.solid }
  check(!!hit && broken.edits > 0, `a blast ${hit ? round(hit.t / M) : '?'} m off (material ${hit?.material}): ${broken?.edits} edits in the world, ${broken?.solid} solid cells left within 3 m`)
  // The hour and the weather.
  const look = await page.evaluate(() => { const e = globalThis.engine; e.hour = 20.5; e.rain = 1; return { hour: e.hour, rain: e.rain } })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'night-rain.png') })
  f.look = look
  check(look.hour === 20.5 && look.rain === 1, `the hour set to ${look.hour} and rain to ${look.rain}`)
  await page.evaluate(() => { const e = globalThis.engine; e.hour = 15; e.rain = 0 })
  // Reset.
  const reset = await page.evaluate(async () => {
    const e = globalThis.engine, began = performance.now()
    await e.reset()
    const ms = performance.now() - began
    for (let i = 0; i < 300 && (e.world.stats.wanted || e.world.stats.stale); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1000))
    // The billboards are laid as edits again by reset (boards.ts): what is left beyond them.
    return { ms: Math.round(ms), edits: e.world.done().length - (e.boards?.edits ?? 0), boards: e.boards?.edits ?? 0, things: e.alive.things.filter((t) => t.alive && t.name === 'grey saloon').length }
  })
  reset.solidWithin3m = hit ? await solid(hit.at) : null
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, { ...p, x: p.x - 25 * Math.sin(p.yaw), z: p.z + 25 * Math.cos(p.yaw), pitch: -0.1 }), aim)
  await page.waitForTimeout(2000); await settle()
  await page.screenshot({ path: join(shots, 'reset.png') })
  f.reset = reset
  check(reset.edits === 0 && reset.solidWithin3m > (broken?.solid ?? Infinity) && reset.things === 1, `reset: ${reset.edits} edits left beyond the ${reset.boards} that lay the billboards, ${reset.solidWithin3m} solid cells within 3 m of the blast again (${broken?.solid} after it), ${reset.things} kept car set down again, in ${reset.ms} ms`)
  // No helper: however a helper was offered, rules.models is false, an untyped non-kept ask is refused, and nothing is sent off-site.
  const models = await page.evaluate(async () => { const e = globalThis.engine; const done = await e.ask({ wish: 'a purple submarine' }).catch((x) => String(x)); return { rules: e.rules, done: done?.state ?? done, bar: getComputedStyle(document.querySelector('#ask')).display } })
  await page.waitForTimeout(1000)
  f.models = { ...models, requestsAway: away.length }
  check(!models.rules.models && models.rules.making === true && models.done === 'refused' && away.length === 0 && models.bar !== 'none', `no helper: rules ${JSON.stringify(models.rules)}, untyped ask ${models.done}, ask bar ${models.bar}, ${away.length} requests off the site`)

  // ── What the page carries on through ──
  phase('faults', 5)
  const ff = (results.faults = {})
  await page.evaluate(() => { globalThis.engine.patience = 4000 })
  // A reset sent while a blast's answer is on its way: nothing of the blast may come down in the world put back.
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), aim); await settle()
  ff.race = await page.evaluate(async (at) => {
    const e = globalThis.engine, staleBefore = e.mended.staleAnswers
    e.strike(at, 14)
    await e.reset()
    await new Promise((r) => setTimeout(r, 4000))
    return { edits: e.world.done().length - (e.boards?.edits ?? 0), staleAnswers: e.mended.staleAnswers - staleBefore }
  }, hit?.at ?? [Math.round(aim.x * M), Math.round(aim.y * M), Math.round(aim.z * M)])
  check(ff.race.edits === 0 && ff.race.staleAnswers > 0, `reset while a blast is answered: ${ff.race.edits} edits after, ${ff.race.staleAnswers} answers of the old world let by`)
  // A mover that dies without a word, as in a tab out of memory: a blast still breaks the world after it.
  ff.mover = await page.evaluate(async (at) => {
    const e = globalThis.engine
    e.kill('mover')
    e.strike(at, 10)
    for (let i = 0; i < 120 && !e.mended.movers; i++) await new Promise((r) => setTimeout(r, 100))
    const hired = e.mended.movers, edits = e.world.done().length
    e.strike(at, 10)
    await new Promise((r) => setTimeout(r, 4000))
    return { hired, editsAfter: e.world.done().length - edits, things: e.alive.things.filter((t) => t.alive && t.name === 'grey saloon').length }
  }, hit?.at ?? [Math.round(aim.x * M), Math.round(aim.y * M), Math.round(aim.z * M)])
  check(ff.mover.hired === 1 && ff.mover.editsAfter > 0 && ff.mover.things === 1, `a mover that died was hired again (${ff.mover.hired}): a blast after made ${ff.mover.editsAfter} edits, the kept car set down again (${ff.mover.things})`)
  await page.evaluate(() => globalThis.engine.reset())
  // A tile that fails five times (two loads' worth of retries), and a maker of sectors that dies, on the way to a
  // part of the city not yet seen: the Financial District square, south of the park.
  const fidi = { x: 51900, z: 67350 }
  const tileThere = `${releaseAt}tiles/0/${Math.floor((fidi.x * M) / 2500)}_${Math.floor((fidi.z * M) / 2500)}.bay`
  check(listed.has(tileThere) && !site.asked.some((a) => a.path === tileThere), `a tile not yet asked for to fail: ${tileThere.slice(releaseAt.length)}`)
  failing.set(tileThere, 5)
  await page.evaluate(() => globalThis.engine.kill('maker'))
  const fy = await page.evaluate(({ x, z }) => globalThis.engine.ground(x, z), fidi)
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), { x: fidi.x, y: Math.max(fy, 0) + 40, z: fidi.z, yaw: 0, pitch: -0.6 })
  const cameBack = await page.waitForFunction(() => { const e = globalThis.engine, s = e.world.stats; return s.lacking > 0 && e.tiles.tally.failed > 0 }, null, { timeout: 120_000, polling: 500 }).then(() => true, () => false)
  // Each column made without the tile is made again 2, 4, 8 s after: by then the tile has come.
  await page.waitForTimeout(30_000); await settle()
  ff.tile = await page.evaluate(({ x, z }) => {
    // Across the whole of the tile that failed (2500 cells a side), 5 x 5 places: at each, the finest box that holds
    // the ground's top cell has its sector made and not air. Every column made without the tile, not only one.
    const e = globalThis.engine, tx = Math.floor((x * 10) / 2500) * 2500, tz = Math.floor((z * 10) / 2500) * 2500, places = []
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const cx = tx + 150 + i * 550, cz = tz + 150 + j * 550, g = e.ground(cx / 10, cz / 10) * 10 - 1
      const l = e.world.levels.find((l) => { const side = 64 << l.index; return l.holds(Math.floor(cx / side), Math.floor(g / side), Math.floor(cz / side)) })
      const side = 64 << (l?.index ?? 0), slot = l ? l.slot(Math.floor(cx / side), Math.floor(g / side), Math.floor(cz / side)) : -1
      places.push({ level: l?.index ?? null, groundM: Math.round(g) / 10, drawn: !!l && l.state[slot] === 3 && l.top[slot] !== 0 })
    }
    return { lacking: e.world.stats.lacking, crashed: e.world.stats.crashed, failed: e.tiles.tally.failed, retried: e.tiles.tally.retried, groundM: e.ground(x, z), drawnPlaces: places.filter((p) => p.drawn).length, places: places.length, notDrawn: places.filter((p) => !p.drawn), drawn: places.every((p) => p.drawn) }
  }, fidi)
  ff.tile.requests = site.asked.filter((a) => a.path === tileThere).map((a) => a.status)
  await page.screenshot({ path: join(shots, 'after-faults.png') })
  check(cameBack && ff.tile.drawn && ff.tile.requests.at(-1) === 200, `a tile that failed ${ff.tile.requests.filter((s) => s !== 200).length} times came on try ${ff.tile.requests.length}: ${ff.tile.lacking} columns made without it were made again, the ground drawn at ${ff.tile.drawnPlaces} of ${ff.tile.places} places across the tile${ff.tile.notDrawn.length ? ` (not: ${JSON.stringify(ff.tile.notDrawn.slice(0, 3))})` : ''}`)
  check(ff.tile.crashed >= 1, `a maker of sectors that died was hired again (${ff.tile.crashed}) and the world there came whole`)
  await page.evaluate(() => { globalThis.engine.patience = 10_000 })

  // ── Moving through the city: what the tiles cost ──
  phase('moving', 4)
  await page.evaluate(() => globalThis.engine.reset())
  const travel = async (name, kind) => {
    const from = Date.now()
    const where = await page.evaluate(async (kind) => {
      const e = globalThis.engine, start = performance.now(), path = []
      // Taylor St from Vallejo southwards (the squares' names), cells.
      const taylor = [[516129, 664399], [515957, 663367], [515869, 662836], [515785, 662329], [515699, 661813], [515617, 661294]]
      const along = (d) => { for (let i = 1; i < taylor.length; i++) { const [ax, az] = taylor[i - 1], [bx, bz] = taylor[i], l = Math.hypot(bx - ax, bz - az); if (d <= l) return [ax + ((bx - ax) * d) / l, az + ((bz - az) * d) / l, Math.atan2(bx - ax, -(bz - az))]; d -= l } return [...taylor[taylor.length - 1], 0] }
      const up = e.ground(51646.7, 66402.3) + 150
      await new Promise((done) => {
        const step = () => {
          const s = (performance.now() - start) / 1000
          if (s >= 60) return done()
          if (kind === 'walk') { const [x, z, yaw] = along(s * 50); Object.assign(e.pose, { x: x / 10, z: z / 10, y: e.ground(x / 10, z / 10) + 1.7, yaw, pitch: 0 }) }
          else { const a = (s * 47) / 450, cx = 51700, cz = 66230; Object.assign(e.pose, { x: cx + 450 * Math.sin(a), z: cz - 450 * Math.cos(a), y: up, yaw: a + Math.PI / 2, pitch: -0.3 }) }
          if (path.length < s) path.push([Math.round(e.pose.x), Math.round(e.pose.z)])
          requestAnimationFrame(step)
        }
        step()
      })
      return path
    }, kind)
    const cost = sent(from, Date.now())
    await page.screenshot({ path: join(shots, `${name}.png`) })
    console.log(`  ${name}: ${JSON.stringify(cost.tiles)} from ${where[0]} to ${where[where.length - 1]}`)
    return cost.tiles
  }
  results.moving = { walk60: await travel('walk60', 'walk'), flight60: await travel('flight60', 'fly') }

  // ── What is held ──
  phase('what is held and asked', 1)
  results.memory = await page.evaluate(async () => { const e = globalThis.engine, m = await e.tiles.memory(); return { device: e.tiles.device, coresMB: Math.round((m.page + m.workers.reduce((a, b) => a + b, 0)) / 1048576), pageCoreMB: Math.round(m.page / 1048576), workerCoresMB: m.workers.map((b) => Math.round(b / 1048576)), tilesHeldMB: Math.round(m.tiles / 1048576), jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, tally: e.tiles.tally, water: e.tiles.water() } })
  console.log(`\nmemory: ${JSON.stringify(results.memory)}`)
  check(results.memory.tilesHeldMB <= 96, `the page holds ${results.memory.tilesHeldMB} MB of tiles for its workers (cap 96 MB on a desktop), the cores ${results.memory.coresMB} MB`)

  // ── Only what the release lists, each once (and beside it, what the build makes from it: landmarks, the graph's road marks, the loader's picture and the eggs' two lists, eggs.ts) ──
  const tilesAsked = site.asked.filter((a) => isTile(a.path))
  const tileFiles = new Set(tilesAsked.map((a) => a.path))
  const failedOnPurpose = tilesAsked.filter((a) => a.status === 503).length
  const outside = site.asked.filter((a) => !(a.path.startsWith('/page/') || a.path.startsWith('/probe/') || a.path.startsWith('/kit/') || a.path.startsWith('/blocks/') || a.path.startsWith('/make/') || a.path === '/text.js' || a.path === '/sf/index.html' || a.path.startsWith('/sf/loading-') || a.path.startsWith('/sf/shelf/') || a.path === '/bay/heroes.json' || a.path === '/bay/marks.bin' || a.path === '/bay/marks-squares.bin' || a.path === '/bay/map.bin' || a.path === '/sf/current.json' || a.path.startsWith('/sf/kept/') || eggIndexes.has(a.path) || listed.has(a.path)))
  const pointerAsked = site.asked.filter((a) => a.path === '/sf/current.json').length
  const notFound = site.asked.filter((a) => a.status === 404)
  results.asked = { requests: site.asked.length, tileRequests: tilesAsked.length - failedOnPurpose, tileFiles: tileFiles.size, perFile: round((tilesAsked.length - failedOnPurpose) / tileFiles.size, 2), pointer: pointerAsked, outside: outside.map((a) => a.path), notFound: notFound.map((a) => a.path) }
  console.log(`\nasked: ${JSON.stringify(results.asked)}`)
  check(outside.length === 0 && notFound.length === 0 && pointerAsked === 1, `only what the release lists: ${outside.length} requests outside it, ${notFound.length} not found, the pointer asked ${pointerAsked} time`)
  check(results.asked.perFile <= 1.05, `each tile fetched once: ${results.asked.tileRequests} requests for ${results.asked.tileFiles} files (${results.asked.perFile} a file, before 3.2)`)

  // ── Every pixel drawn (scale 1): what each place costs the GPU ──
  // The bound: 60 fps with the picture at 0.7 of its size, pinned (headless Chrome is held to 60 Hz, so the gaps say
  // only whether 60 fps holds). Then the cost of every pixel. A place short of it is measured again with every turn
  // on the GPU held, and fails only if it is short again (kit.mjs `timed`).
  const at70 = { park: ['park-0.7', park, 25.05], street: ['street-0.7', { ...street, yaw: -0.164, pitch: 0 }, 70], up150: ['up150-0.7', { x: park.x, y: parkGround + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70] }
  results.frames70 = await alone('frames at 0.7', 4, async () => { const r = {}; for (const [where, [name, pose, fov]] of Object.entries(at70)) r[where] = await frames(name, pose, fov, 0.7); return r })
  for (const [where, [name, pose, fov]] of Object.entries(at70)) {
    results.frames70[where] = await timed({
      check, first: results.frames70[where], firstAlone: !('sharedGPU' in results.frames70), idle: resting,
      measure: () => frames(`${name}-alone`, pose, fov, 0.7), passes: (f) => f.p50 <= 17.5,
      say: (f) => `60 fps ${where} at picture scale 0.7: p50 ${f.p50} ms, p99 ${f.p99} ms, march ${f.marchMs} ms (bound 17.5 ms)`,
      again: () => phase(`frames at 0.7 again, alone: ${where}`, 25),
    })
  }
  results.framesFull = await alone('frames at full size', 4, async () => ({
    park: await frames('park-full', park, 25.05, 1),
    street: await frames('street-full', { ...street, yaw: -0.164, pitch: 0 }, 70, 1),
    up150: await frames('up150-full', { x: park.x, y: parkGround + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70, 1),
  }))
  // ── A phone's class (bay.ts DEVICE): Chrome at an iPhone's screen with touch, which the page takes for a phone ──
  phase('a phone\'s class (Chrome at 390 x 844, touch)', 4)
  // The desktop page is left pinned at full size, drawing about 30 ms of GPU work a frame; beside it a second page's
  // requestDevice waits until it stops (#450). The phone's class is measured alone: the desktop page rests meanwhile.
  await page.evaluate(() => { globalThis.engine.resting = true })
  const handheld = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const small = await handheld.newPage()
  small.on('pageerror', (e) => errors.push(`phone: ${e.message}`))
  await small.goto(`${site.url}/sf/index.html?rest=0`)
  await small.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 180_000 })
  await small.waitForTimeout(3000)
  results.phone = await small.evaluate(async (ms) => {
    const e = globalThis.engine, m = await e.tiles.memory(), gaps = []
    const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop()
    const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b)
    return { device: e.tiles.device, workers: m.workers.length, coresMB: Math.round((m.page + m.workers.reduce((a, b) => a + b, 0)) / 1048576), pageCoreMB: Math.round(m.page / 1048576), workerCoresMB: m.workers.map((b) => Math.round(b / 1048576)), tilesHeldMB: Math.round(m.tiles / 1048576), jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, wholeMs: Math.round(e.seen.whole), parkP50: g[Math.floor(g.length / 2)], scale: e.scale }
  }, 5000)
  await small.screenshot({ path: join(shots, 'phone-class.png') })
  await handheld.close()
  console.log(`  phone: ${JSON.stringify(results.phone)}`)
  check(results.phone.device === 'phone' && results.phone.workers === 3 && results.phone.tilesHeldMB <= 24, `a phone holds less: ${results.phone.workers} workers (two makers and the mover), ${results.phone.coresMB} MB in its cores, ${results.phone.tilesHeldMB} MB of tiles (cap 24)`)
  results.errors = errors.filter((e) => !/failed: 503|tiles\/0\/.*503/.test(e))
  check(results.errors.length === 0, `no page errors${results.errors.length ? `: ${results.errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  console.log(`  FAIL ${current.name}: ${String(e?.message ?? e).split('\n')[0]}`)
  if (!failures.some((f) => f.startsWith(current.name))) failures.push(`${current.name}: ${String(e?.message ?? e).split('\n')[0]}`)
} finally {
  clearInterval(watchdog)
  await browser.close().catch(() => {})
  site.stop()
  back()
}
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
console.log('\n' + JSON.stringify(results))
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
