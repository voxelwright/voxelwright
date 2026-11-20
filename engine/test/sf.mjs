// The San Francisco realm from static files, measured (#450): the folder `node sf/build.mjs` writes, served as any
// host of plain files would serve it (player/serve.mjs: no COOP, COEP or CSP), opened in Chrome with WebGPU.
//
//   node test/sf.mjs [--no-build] [--seconds 10] [--shots ~/.village/engine/sf] [--headed]
//
// It says:
//   - what is downloaded until the first picture and until the world round the park is whole (raw, gzip, brotli), and when;
//   - frame gaps (p50, p99) at the park's camera, at street level on Taylor St and 150 m over the park, with the scale
//     the page chose and the GPU's time for the march beside them (a frame time alone flatters: the page draws fewer
//     pixels to hold it);
//   - the tile bytes fetched in a 60 s walk (the eye at a person's height along Taylor St at 5 m/s) and a 60 s flight
//     (a circle of 450 m, 150 m up, at 47 m/s): every core asks for its own tiles, so all requests and distinct files;
//   - whether each stage-1 feature works from plain files: walking, flying, a kept car driven, residents, a blast,
//     the hour and rain, reset, and that no model's helper is reached however one is offered.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, 'dist-sf'), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf')), seconds = Number(arg('seconds', '10'))
const M = 10
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}
mkdirSync(shots, { recursive: true })

// ── Bytes as a host would send them ──
// Code with gzip 9 and brotli 11, as a build would compress it ahead; tiles also with gzip 6 and brotli 5, as a host
// compressing as it sends might (one that compresses them at all: a host may send application/octet-stream as it is).
const squeezed = new Map()
const squeeze = (path) => {
  let s = squeezed.get(path)
  if (!s) {
    const body = readFileSync(join(dist, path)), tile = path.startsWith('/bay/')
    s = { raw: body.length, gz: gzipSync(body, { level: tile ? 6 : 9 }).length, br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: tile ? 5 : 11 } }).length }
    squeezed.set(path, s)
  }
  return s
}
const mb = (n) => round(n / 1048576, 2)
/** What was sent between two moments (ms since 1970): all of it and the tiles alone, every request and distinct files. */
const sent = (asked, from, to) => {
  const all = { raw: 0, gz: 0, br: 0, n: 0 }, tiles = { raw: 0, gz: 0, br: 0, n: 0, files: 0, filesRaw: 0 }, seen = new Set()
  for (const a of asked) {
    if (a.status !== 200 || a.at < from || a.at > to) continue
    const s = squeeze(a.path)
    for (const k of ['raw', 'gz', 'br']) all[k] += s[k]
    all.n++
    if (!a.path.startsWith('/bay/')) continue
    for (const k of ['raw', 'gz', 'br']) tiles[k] += s[k]
    tiles.n++
    if (!seen.has(a.path)) { seen.add(a.path); tiles.files++; tiles.filesRaw += s.raw }
  }
  return { all: { requests: all.n, raw: mb(all.raw), gzip: mb(all.gz), brotli: mb(all.br) }, tiles: { requests: tiles.n, raw: mb(tiles.raw), gzip: mb(tiles.gz), brotli: mb(tiles.br), files: tiles.files, filesRaw: mb(tiles.filesRaw) } }
}

const site = await plain(dist, '127.0.0.1')
const back = await turn()
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
// The helper a visitor might be offered (a link, or something kept from another page): it must never be asked.
const HELPER = 'http://127.0.0.1:5762'
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
await context.addInitScript((helper) => { try { localStorage.setItem('village.helper', JSON.stringify({ url: helper, secret: 'offered' })) } catch { /* none */ } }, HELPER)
const away = []
context.on('request', (r) => { if (!r.url().startsWith(site.url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) away.push(r.url()) })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(m.text()) })
const results = { url: `${site.url}/sf/index.html` }

try {
  // ── The first visit ──
  console.log('\nfirst visit (cold cache)')
  await page.goto(`${site.url}/sf/index.html#helper=${encodeURIComponent(HELPER)}&secret=offered`)
  await page.waitForFunction(() => globalThis.engine?.seen?.first > 0, null, { timeout: 120_000 })
  await page.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 180_000 })
  const t = await page.evaluate(() => ({ origin: performance.timeOrigin, ...globalThis.engine.seen, isolated: crossOriginIsolated, shared: typeof SharedArrayBuffer !== 'undefined', gpu: !!navigator.gpu }))
  results.load = {
    firstFrameMs: Math.round(t.first), wholeMs: Math.round(t.whole),
    untilFirstFrame: sent(site.asked, 0, t.origin + t.first), untilWhole: sent(site.asked, 0, t.origin + t.whole),
    crossOriginIsolated: t.isolated, sharedArrayBuffer: t.shared,
  }
  results.load.tilesBeforeFirst = site.asked.filter((a) => a.status === 200 && a.path.startsWith('/bay/') && a.at <= t.origin + t.first).map((a) => a.path.replace('/bay/', ''))
  console.log(JSON.stringify(results.load, null, 1))
  check(t.first > 0 && t.whole > 0, `drawn from plain files without COOP/COEP (crossOriginIsolated ${t.isolated}): first picture ${Math.round(t.first)} ms, world whole ${Math.round(t.whole)} ms`)
  const ground = await page.evaluate(() => { const e = globalThis.engine; return e.ground(e.pose.x, e.pose.z) })
  check(ground > 70 && ground < 86, `the tiles are under the park: ground ${round(ground)} m under an eye at 85.98 m`)

  // ── Frames ──
  const settle = () => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 90_000, polling: 250 }).catch(() => null)
  const frames = async (name, pose, fov, full = false) => {
    await page.evaluate(({ pose, fov }) => { const e = globalThis.engine; Object.assign(e.pose, pose); if (fov) e.fov = fov }, { pose, fov })
    await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(2000)
    // As the page steers its picture's size (it aims the march at six tenths of a frame), then with every pixel drawn: the second is the cost.
    const take = () => page.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); return { gaps, scale: e.scale, gpuMs: e.gpuMs, cpuMs: e.cpuMs, fov: e.fov, people: e.folk.drawn?.people ?? 0 } }, seconds * 1000)
    const said = (w) => { const g = w.gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => round(g[Math.min(g.length - 1, Math.floor(g.length * p))]); return { frames: g.length, p50: q(0.5), p99: q(0.99), worst: round(g[g.length - 1]), scale: w.scale, marchMs: round(w.gpuMs), cpuMs: round(w.cpuMs) } }
    // Once pinned the picture's size stays pinned: the passes at full size come after all the steered ones.
    if (full) { await page.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2000) }
    const w = await take()
    if (!full) await page.screenshot({ path: join(shots, `${name}.png`) })
    const r = { ...said(w), fov: w.fov, residentsDrawn: w.people }
    console.log(`  ${name}: ${JSON.stringify(r)}`)
    return r
  }
  console.log('\nframes')
  const park = await page.evaluate(() => ({ ...globalThis.engine.pose }))
  // Taylor St between Green and Union, looking north along it, a person's eye over the road.
  const street = { x: 51590, z: 66300 }
  street.y = await page.evaluate(({ x, z }) => globalThis.engine.ground(x, z), street) + 1.7
  const parkGround = ground
  results.frames = {
    park: await frames('park', park, 25.05),
    street: await frames('street', { ...street, yaw: -0.164, pitch: 0 }, 70),
    up150: await frames('up150', { x: park.x, y: parkGround + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70),
  }

  // ── Features ──
  console.log('\nfeatures')
  const f = (results.features = {})
  // Residents on the real pavements: drawn round the eye at street level.
  f.residents = results.frames.street.residentsDrawn
  console.log(`  (report) residents drawn at street level on Taylor St: ${f.residents}; at the park: ${results.frames.park.residentsDrawn}`)
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
  // The kept car: there, got into, driven.
  const car = await page.evaluate(async () => {
    const e = globalThis.engine, thing = e.alive.things.find((t) => t.alive)
    if (!thing) return null
    const w0 = e.alive.where(thing), at = w0.at
    Object.assign(e.pose, { x: at[0] / 10 - 6, y: at[1] / 10 + 3, z: at[2] / 10, yaw: Math.PI / 2, pitch: -0.2 })
    e.alive.mount(thing)
    const from = e.alive.where(thing).at
    for (let i = 0; i < 25; i++) { e.alive.drive(thing, 1, 0, 0); await new Promise((r) => setTimeout(r, 200)) }
    const to = e.alive.where(thing).at, riding = e.alive.riding === thing
    return { name: thing.name, from, to, moved: Math.hypot(to[0] - from[0], to[2] - from[2]) / 10, riding, look: e.alive.look(thing).parts.length }
  })
  await page.screenshot({ path: join(shots, 'car.png') })
  f.car = car
  check(!!car && car.riding && car.moved > 3, `a kept car (${car?.name}, ${car?.look} parts of fine look) got into and driven ${car ? round(car.moved) : 0} m in 5 s`)
  await page.evaluate(() => globalThis.engine.alive.mount(null))
  // Destruction: a blast at a house front over the street trees, then reset.
  const aim = { x: street.x, y: street.y + 10, z: street.z, yaw: -0.164 + Math.PI / 2, pitch: 0 }
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), aim)
  await page.waitForTimeout(1500); await settle()
  /** How many cells are solid within 3 m of a place. */
  const solid = (at) => page.evaluate((at) => { const e = globalThis.engine; let n = 0; for (let x = -30; x <= 30; x += 2) for (let y = -30; y <= 30; y += 2) for (let z = -30; z <= 30; z += 2) if (x * x + y * y + z * z <= 900 && e.kind(at[0] + x, at[1] + y, at[2] + z)) n++; return n }, at)
  const hit = await page.evaluate(async () => { const e = globalThis.engine, r = await e.blast(18); return r && { at: r.at, material: r.material, t: r.t } })
  await page.waitForTimeout(5000)
  const broken = hit && { edits: await page.evaluate(() => globalThis.engine.world.done().length), solid: await solid(hit.at) }
  // Seen from across the street.
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, { ...p, x: p.x - 25 * Math.sin(p.yaw), z: p.z + 25 * Math.cos(p.yaw), pitch: -0.1 }), aim)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'blast.png') })
  f.blast = { at: hit?.at, material: hit?.material, metresOff: hit ? round(hit.t / M) : null, editsAfter: broken?.edits, solidWithin3mAfter: broken?.solid }
  check(!!hit && broken.edits > 0, `a blast ${hit ? round(hit.t / M) : '?'} m off (material ${hit?.material}): ${broken?.edits} edits in the world, ${broken?.solid} solid cells left within 3 m (reset below says how many were there)`)
  // The hour and the weather.
  const look = await page.evaluate(() => { const e = globalThis.engine; e.hour = 20.5; e.rain = 1; return { hour: e.hour, rain: e.rain } })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'night-rain.png') })
  f.look = look
  check(look.hour === 20.5 && look.rain === 1, `the hour set to ${look.hour} and rain to ${look.rain}`)
  await page.evaluate(() => { const e = globalThis.engine; e.hour = 15; e.rain = 0 })
  // Reset.
  const reset = await page.evaluate(async (at) => {
    const e = globalThis.engine, began = performance.now()
    await e.reset()
    const ms = performance.now() - began
    for (let i = 0; i < 300 && (e.world.stats.wanted || e.world.stats.stale); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1000))
    return { ms: Math.round(ms), edits: e.world.done().length, things: e.alive.things.filter((t) => t.alive).length }
  }, hit?.at ?? null)
  reset.solidWithin3m = hit ? await solid(hit.at) : null
  await page.evaluate((p) => Object.assign(globalThis.engine.pose, { ...p, x: p.x - 25 * Math.sin(p.yaw), z: p.z + 25 * Math.cos(p.yaw), pitch: -0.1 }), aim)
  await page.waitForTimeout(2000); await settle()
  await page.screenshot({ path: join(shots, 'reset.png') })
  f.reset = reset
  check(reset.edits === 0 && reset.solidWithin3m > (broken?.solid ?? Infinity) && reset.things === 1, `reset: ${reset.edits} edits left, ${reset.solidWithin3m} solid cells within 3 m of the blast again (${broken?.solid} after it), ${reset.things} kept car set down again, in ${reset.ms} ms`)
  // No model: however a helper was offered, it is not known and nothing is sent to it.
  const models = await page.evaluate(async () => { const e = globalThis.engine; const done = await e.ask({ wish: 'a park bench' }).catch((x) => String(x)); return { rules: e.rules, known: e.asker.known, done: done?.state ?? done, bar: getComputedStyle(document.querySelector('#ask')).display } })
  await page.waitForTimeout(1000)
  f.models = { ...models, requestsAway: away.length }
  check(!models.rules.models && !models.known && away.length === 0 && models.bar === 'none', `no models: rules ${JSON.stringify(models.rules)}, helper known ${models.known}, an ask ${models.done}, ask bar ${models.bar}, ${away.length} requests off the site`)

  // ── Moving through the city: what the tiles cost ──
  console.log('\nmoving')
  await page.evaluate(() => globalThis.engine.reset())
  const travel = async (name, kind) => {
    const from = Date.now()
    const where = await page.evaluate(async (kind) => {
      const e = globalThis.engine, start = performance.now(), path = []
      // Taylor St from Vallejo northwards (bay/packs/*.json), cells.
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
    const to = Date.now(), cost = sent(site.asked, from, to)
    await page.screenshot({ path: join(shots, `${name}.png`) })
    console.log(`  ${name}: ${JSON.stringify(cost.tiles)} from ${where[0]} to ${where[where.length - 1]}`)
    return cost.tiles
  }
  results.moving = { walk60: await travel('walk60', 'walk'), flight60: await travel('flight60', 'fly') }
  // Every pixel drawn (scale 1): what each place costs the GPU, where the steered passes above say only that 60 fps holds.
  console.log('\nframes at full size')
  results.framesFull = {
    park: await frames('park-full', park, 25.05, true),
    street: await frames('street-full', { ...street, yaw: -0.164, pitch: 0 }, 70, true),
    up150: await frames('up150-full', { x: park.x, y: parkGround + 150, z: park.z, yaw: park.yaw, pitch: -0.35 }, 70, true),
  }
  results.errors = errors
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} finally {
  await browser.close()
  site.stop()
  back()
}
console.log('\n' + JSON.stringify(results))
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
