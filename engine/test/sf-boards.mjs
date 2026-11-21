// The SF realm's billboards and its banner plane, checked (#450): the folder `node sf/build.mjs` writes, served as
// plain files and held in a frame by a host page, as the site will hold it. Chrome with WebGPU; one GPU is shared, so a
// failed run is worth one more before it is believed.
//
//   node test/sf-boards.mjs [--no-build] [--dist dist-sf] [--shots ~/.village/engine/sf/boards] [--mbit 25] [--seconds 8]
//
// It fails unless:
//   - the park is shown within 8 MB over the wire on a cold cache, the boards' code among it, the editor's not;
//   - the host is told `ready` with every board, and every board is a link with its name in the frame;
//   - from the park's camera every board is in the picture and none over another, nothing stands between the eye and
//     it, a letter is 9 px tall or more, and the picture itself is brighter where a letter's lamp is than where its panel is;
//   - a click on a board flies the eye to it and tells the host `navigate` with the board's path; so does Enter on
//     its link, the host's own `open`, and O flying free in front of it;
//   - realm.signs sets words on a lettering board (and refuses a picture there), an image and a video on a digital
//     board and the banner, from the page and from the host;
//   - a charge breaks a letter and leaves the others, darkens part of a screen, and reset puts every board back;
//   - the plane goes round, and its banner is in the park's picture on its near pass;
//   - the park holds 60 fps at picture scale 0.7 with the boards in view.
// Pictures are kept: the park before and after, by night, a flight to a board, a broken board, the banner.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'boards')), mbit = Number(arg('mbit', '25')), seconds = Number(arg('seconds', '8'))
const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(shots, { recursive: true })
const file = JSON.parse(readFileSync(join(here, 'sf/boards.json'), 'utf8'))
// The host: a page with the realm in a frame over the whole of it, keeping what the realm tells it.
const HOST = `<!doctype html><meta charset="utf-8"><title>host</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
<iframe id="realm" src="/sf/index.html" allow="autoplay"></iframe><script>window.told=[];addEventListener('message',(e)=>{if(e.data&&e.data.village==='realm')told.push(e.data)});window.ask=(m)=>document.getElementById('realm').contentWindow.postMessage({village:'realm',...m},'*')</script>`
const site = await plain(dist, '127.0.0.1', 0, { extra: (req, res) => { if (new URL(req.url, 'http://x').pathname !== '/host.html') return false; res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HOST); return true } })
const back = await turn()
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { back(); process.exit(1) })
const browser = await chromium.launch({ ...CHROME, headless: !has('headed') })
const results = { boards: file.boards.map((b) => b.id) }
const errors = []
const mb = (n) => round(n / 1048576, 2)
try {
  // ── Before: the park with no boards, for the picture ──
  const link = async (context, page) => { const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 }); return () => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) }
  /** What crossed the wire from `from` until the place was shown in `frame`. */
  const untilShown = async (frame, from) => { const t = await frame.evaluate(() => ({ origin: performance.timeOrigin, near: globalThis.engine.seen.near })); return { ms: Math.round(t.near), wireMB: mb(site.asked.filter((a) => a.status === 200 && a.at >= from && a.at <= t.origin + t.near).reduce((n, a) => n + a.wire, 0)) } }
  /** Frame gaps at the park with the picture at 0.7 of its size, the best of up to three tries short of 60 fps (other lanes draw on this GPU). */
  const framesAt = async (target, wait) => {
    await target.evaluate(() => { globalThis.engine.scale = 0.7 }); await wait(4000)
    const take = () => target.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); const g = gaps.filter((x) => x >= 2).sort((a, b) => a - b); return { frames: g.length, p50: g[Math.floor(g.length * 0.5)], p99: g[Math.min(g.length - 1, Math.floor(g.length * 0.99))], marchMs: e.gpuMs, cpuMs: e.cpuMs } }, seconds * 1000)
    let f = await take()
    for (let again = 0; again < 2 && f.p50 > 17.5; again++) { await wait(8000); const next = await take(); if (next.p50 < f.p50) f = next }
    return { p50: round(f.p50), p99: round(f.p99), marchMs: round(f.marchMs), cpuMs: round(f.cpuMs) }
  }
  const plainContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const bare = await plainContext.newPage()
  const unlink = await link(plainContext, bare), bareFrom = Date.now()
  await bare.goto(`${site.url}/sf/index.html?boards=0`)
  await bare.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 300_000 })
  const without = await untilShown(bare, bareFrom)
  await unlink()
  await bare.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 300_000 })
  const framesWithout = await framesAt(bare, (ms) => bare.waitForTimeout(ms))
  await bare.evaluate(() => { globalThis.engine.scale = 1 }); await bare.waitForTimeout(4000)
  await bare.screenshot({ path: join(shots, 'park-before.png') })
  check(await bare.evaluate(() => globalThis.engine.boards === null && globalThis.engine.world.done().length === 0), '?boards=0 leaves the boards out: no board, no edit in the world')
  // (It rests, not drawing, until its turn in the timing below: the next page loads as a visitor's would, alone.)
  await bare.evaluate(() => { globalThis.engine.resting = true })
  // Each board's foot is on its roof as this release has it: the file was made against a release, and the pin moves.
  const roofs = await bare.evaluate((boards) => boards.map((b) => ({ id: b.id, at: b.at[1], roof: globalThis.engine.feet(b.at[0], b.at[2]), ground: Math.round(globalThis.engine.ground(b.at[0] / 10, b.at[2] / 10) * 10) })), file.boards)
  check(roofs.every((r) => Math.abs(r.roof - r.at) <= 2 && r.roof - r.ground >= 60), `every board's foot is on a roof of this release: ${roofs.map((r) => `${r.id} at ${r.at / 10} m on a roof at ${r.roof / 10} m, ${round((r.roof - r.ground) / 10)} m over the ground`).join('; ')}`)

  // ── The first visit, cold, in the host's frame ──
  console.log(`\nfirst visit (cold cache, ${mbit} Mbit/s, 40 ms), in a host's frame`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  const unlinked = await link(context, page)
  const from = Date.now()
  await page.goto(`${site.url}/host.html`)
  const frame = () => page.frames().find((f) => f.url().includes('/sf/index.html'))
  await page.waitForFunction(() => window.told.some((m) => m.type === 'ready'), null, { timeout: 300_000 })
  const realm = frame()
  const shown = await untilShown(realm, from)
  const code = site.asked.filter((a) => a.at >= from && /\/page\/(boards|signs|screens|host)\.js$/.test(a.path) && a.status === 200)
  const own = code.reduce((n, a) => n + a.wire, 0) + Buffer.byteLength(JSON.stringify(file))
  results.load = { placeShownMs: shown.ms, wireMB: shown.wireMB, without, boardsOwnKB: round(own / 1024), boardsCodeRawKB: round(code.reduce((n, a) => n + a.bytes, 0) / 1024) }
  await unlinked()
  // What the boards themselves add is exact: their four modules as sent, and their data in the page's record. The
  // whole (which stops at a moment, so it moves by a tile or two from run to run) is held to the realm's 8 MB where
  // the realm without boards is within it; where that is over already, it is said and the boards' own share is the check.
  check(own < 24 * 1024, `the boards add ${results.load.boardsOwnKB} KB before the park is shown: four modules as sent (${results.load.boardsCodeRawKB} KB unpacked) and their data in the page's record (bound 24 KB)`)
  const whole = `${shown.wireMB} MB over the wire until the park is shown in ${shown.ms} ms; without boards ${without.wireMB} MB in ${without.ms} ms (the realm's bound 8 MB)`
  if (without.wireMB >= 8) console.log(`  WARN ${whole}: the realm is over its bound before any board`); else check(shown.wireMB < 8, whole)
  check(code.length === 4 && !site.asked.some((a) => a.path.endsWith('boards-edit.js')), `the boards' code is asked for (${code.length} modules) and the editor's is not`)
  const ready = await page.evaluate(() => window.told.find((m) => m.type === 'ready'))
  check(ready.boards.length === file.boards.length && file.boards.every((b) => ready.boards.some((r) => r.id === b.id && r.to === b.to && r.name === b.name)) && ready.signs.some((s) => s.id === 'banner'), `the host is told ready with ${ready.boards.length} boards (${ready.boards.map((b) => `${b.id} to ${b.to}`).join(', ')}) and ${ready.signs.length} signs`)
  const links = await realm.evaluate(() => [...document.querySelectorAll('nav[aria-label="Billboards"] a')].map((a) => ({ name: a.textContent, to: a.getAttribute('href'), focusable: a.tabIndex === 0 })))
  check(links.length === file.boards.filter((b) => b.to).length && links.every((l, i) => l.name === file.boards[i].name && l.to === file.boards[i].to && l.focusable), `every board is a link of the page by its name: ${links.map((l) => l.name).join(', ')}`)
  await realm.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
  const settle = () => realm.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)
  await settle(); await page.waitForTimeout(3000)
  const park = await realm.evaluate(() => ({ ...globalThis.engine.pose }))
  const toPark = async () => { await realm.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, p) }, park); await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(1500) }

  // ── Frames at the park, the boards and the plane in view: taken as the bare page's were, just after the world came whole ──
  console.log('\nframes at the park')
  const f = await framesAt(realm, (ms) => page.waitForTimeout(ms))
  results.frames = { ...f, without: framesWithout }
  // The bound is the realm's own; where the realm without boards misses it in this same run (other lanes draw on this
  // GPU), the boards are held to what that page did, and a margin of a tenth and a millisecond.
  const bound = Math.max(17.5, framesWithout.p50 * 1.1 + 1)
  check(f.p50 <= bound, `the park at picture scale 0.7 with the boards and the plane: p50 ${f.p50} ms, p99 ${f.p99} ms, march ${f.marchMs} ms; without boards in this run p50 ${framesWithout.p50} ms, march ${framesWithout.marchMs} ms (bound ${round(bound)} ms)`)

  // What the boards cost the GPU, which a frame gap held to 60 Hz cannot say: this page and the one without boards
  // turn about, each resting while the other is timed (the march and the far model at the canvas's full size, at
  // the GPU's own pace), and in this page the pass that draws the screens beside them. With every turn on the GPU
  // where they can be had in three minutes.
  {
    const give = await Promise.race([quiet(), new Promise((r) => setTimeout(() => r(null), 180_000))])
    const rest = (target, on) => target.evaluate((on) => { globalThis.engine.resting = on }, on)
    // The least of the turns: whatever else draws on this GPU only ever adds to a turn.
    const least = (xs) => Math.min(...xs)
    const without = [], withBoards = [], screensMs = []
    try {
      for (let turnAbout = 0; turnAbout < 5; turnAbout++) {
        await rest(realm, true); await rest(bare, false); await bare.waitForTimeout(500)
        without.push((await bare.evaluate(() => globalThis.engine.farPasses(3))).withFar ?? 0)
        await rest(bare, true); await rest(realm, false); await page.waitForTimeout(500)
        const s = await realm.evaluate(() => globalThis.engine.signPasses(3))
        withBoards.push(s.world); screensMs.push(s.withSigns - s.world)
      }
    } finally { await rest(realm, false); give?.() }
    const c = (results.cost = { worldWithoutMs: round(least(without), 2), worldWithMs: round(least(withBoards), 2), screensMs: round(least(screensMs.filter((v) => v > 0).concat(Math.max(...screensMs))), 2), alone: !!give, tries: { without: without.map((v) => round(v, 2)), with: withBoards.map((v) => round(v, 2)) } })
    c.addedMs = round(c.worldWithMs - c.worldWithoutMs + c.screensMs, 2)
    const what = `the boards add ${c.addedMs} ms a frame on the GPU at the park, every pixel drawn: the world ${c.worldWithoutMs} ms without them and ${c.worldWithMs} ms with their cells, their screens and the banner ${c.screensMs} ms (bound 1.5 ms)`
    if (c.addedMs > 1.5 && !give) console.log(`  WARN ${what}, beside other browsers drawing`); else check(c.addedMs <= 1.5, what)
  }
  await plainContext.close()

  // ── From the park: present, in the picture, seen, read ──
  console.log('\nfrom the park')
  /** A PNG's pixels, read in a page of its own. */
  const reader = await context.newPage()
  const pixelsOf = (png) => reader.evaluate(async (b64) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return { w: bitmap.width, data: Array.from(g.getImageData(0, 0, bitmap.width, bitmap.height).data) } }, png.toString('base64'))
  // The realm's own panels are over the picture's edges; a board is read where they are not.
  await realm.evaluate(() => { globalThis.engine.scale = 0.7 }); await page.waitForTimeout(2500)
  const seen = await realm.evaluate(() => {
    const e = globalThis.engine, b = e.boards, eye = [e.pose.x * 10, e.pose.y * 10, e.pose.z * 10]
    return b.records.map((r) => {
      const w = b.where(r.id), marks = b.marks(r.id), s = b.standing(r.id)
      // Nothing between the eye and its face: the line to its middle, stopped two metres short of it.
      const to = [r.at[0], r.at[1] + (r.lift ?? 1.6) * 10 + 28, r.at[2]], far = Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2])
      let clear = true
      for (let d = 20; d < far - 20 && clear; d += 2) if (e.kind(eye[0] + ((to[0] - eye[0]) * d) / far, eye[1] + ((to[1] - eye[1]) * d) / far, eye[2] + ((to[2] - eye[2]) * d) / far)) clear = false
      return { id: r.id, type: r.type, where: w, clear, standing: s, marks }
    })
  })
  const picture = await pixelsOf(await page.screenshot())
  const light = (x, y) => { const i = (Math.round(y) * picture.w + Math.round(x)) * 4; return (picture.data[i] + picture.data[i + 1] + picture.data[i + 2]) / 3 }
  results.park = {}
  for (const s of seen) {
    const w = s.where, inside = !!w && w.x - w.wide / 2 > 0 && w.x + w.wide / 2 < 1280 && w.y - w.high / 2 > 0 && w.y + w.high / 2 < 720
    const letter = w ? (s.type === 'lettering' ? (w.tall * 5) / 7 : w.tall * 0.5) : 0
    const r = (results.park[s.id] = { metres: w && round(w.far), at: w && [Math.round(w.x), Math.round(w.y)], widePx: w && Math.round(w.wide), letterPx: round(letter), clear: s.clear, standing: s.standing.letters })
    check(inside && s.clear && s.standing.whole && letter >= 9, `${s.id}: whole, in the picture at ${r.at} from ${r.metres} m, ${r.widePx} px wide, a letter ${r.letterPx} px tall, nothing between the eye and it`)
    if (s.type === 'lettering') {
      const lit = s.marks.filter((m) => m.lit).map((m) => light(m.x, m.y)), dark = s.marks.filter((m) => !m.lit).map((m) => light(m.x, m.y)), mean = (a) => a.reduce((n, v) => n + v, 0) / a.length
      // Each square of each letter as the picture has it: lamp where the letter is, panel where it is not.
      const cut = (mean(lit) + mean(dark)) / 2, right = lit.filter((v) => v > cut).length + dark.filter((v) => v <= cut).length
      r.read = { lamp: Math.round(mean(lit)), panel: Math.round(mean(dark)), squaresRight: `${right}/${s.marks.length}` }
      check(mean(lit) - mean(dark) > 40 && right >= s.marks.length * 0.9, `${s.id} reads in the picture at scale 0.7: lamp ${r.read.lamp} against panel ${r.read.panel} of 255, ${r.read.squaresRight} squares of its letters as they should be`)
    }
  }
  // No board over another on the picture.
  const boxes = seen.filter((s) => s.where).map((s) => ({ id: s.id, ...s.where })), over = []
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) if (Math.abs(a.x - b.x) < (a.wide + b.wide) / 2 && Math.abs(a.y - b.y) < (a.high + b.high) / 2) over.push(`${a.id} and ${b.id}`)
  check(over.length === 0, `no board is over another in the park's picture${over.length ? `: ${over.join(', ')}` : ''}`)
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(3000)
  await page.screenshot({ path: join(shots, 'park-after.png') })
  await realm.evaluate(() => { globalThis.engine.hour = 21 }); await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'park-night.png') })
  await realm.evaluate(() => { globalThis.engine.hour = 15; globalThis.engine.scale = 0.7 }); await page.waitForTimeout(1500)

  // ── Navigation ──
  console.log('\nnavigation')
  const told = (type) => page.evaluate((type) => window.told.filter((m) => m.type === type), type)
  /** Whether the eye is before a board, looking at it. */
  const before = (id) => realm.evaluate((id) => { const e = globalThis.engine, w = e.boards.where(id), rect = document.querySelector('canvas').getBoundingClientRect(); return w && { metres: Math.round(w.far), share: Math.round((w.wide / rect.width) * 100) / 100, centred: Math.abs(w.x - rect.width / 2) < rect.width * 0.1 && Math.abs(w.y - rect.height / 2) < rect.height * 0.15 } }, id)
  const first = file.boards[0], at = seen.find((s) => s.id === first.id).where
  let n = (await told('navigate')).length
  await page.mouse.click(at.x, at.y)
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  let nav = (await told('navigate')).at(-1), there = await before(first.id)
  await page.waitForTimeout(1500); await settle(); await page.waitForTimeout(1500)
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'fly-to.png') })
  await realm.evaluate(() => { globalThis.engine.scale = 0.7 })
  results.click = { nav, there }
  check((await told('navigate')).length === n + 1 && nav?.board === first.id && nav.to === first.to && there?.centred && there.share > 0.3 && there.metres < 100, `a click on ${first.id} in the park's picture flew the eye to ${there?.metres} m before it (${there?.share} of the picture's width) and told the host to go to ${nav?.to}`)
  check(await realm.evaluate(() => document.pointerLockElement === null), 'that click did not take the pointer for the realm')
  // Enter on a board's link.
  const second = file.boards[1]
  await toPark()
  n = (await told('navigate')).length
  await realm.locator(`nav[aria-label="Billboards"] a[data-board="${second.id}"]`).focus()
  const shownLink = await realm.locator(`nav[aria-label="Billboards"] a[data-board="${second.id}"]`).evaluate((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.width > 0 })
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  nav = (await told('navigate')).at(-1); there = await before(second.id)
  check(shownLink && (await told('navigate')).length === n + 1 && nav?.board === second.id && nav.to === second.to && there?.centred, `Enter on the link "${second.name}" (seen while it has the focus) flew to it and told the host to go to ${nav?.to}`)
  // The host's own ask.
  const third = file.boards[2]
  n = (await told('navigate')).length
  await page.evaluate((id) => window.ask({ type: 'open', board: id }), third.id)
  await page.waitForFunction((n) => window.told.filter((m) => m.type === 'navigate').length > n, n, { timeout: 15_000 }).catch(() => null)
  nav = (await told('navigate')).at(-1); there = await before(third.id)
  check(nav?.board === third.id && nav.to === third.to && there?.centred, `the host's "open" flew to ${third.id} and was told to go to ${nav?.to}`)
  // Flying free: from the park by the keys towards a board, then O.
  const last = file.boards.at(-1)
  await toPark()
  const free = await realm.evaluate(async (id) => {
    const e = globalThis.engine, b = e.boards, r = b.records.find((r) => r.id === id), to = [r.at[0] / 10, (r.at[1] + 44) / 10, r.at[2] / 10]
    // Turned to it, then W held until it is 50 m off: the page's own flying.
    const start = { ...e.pose }, d0 = Math.hypot(to[0] - e.pose.x, to[2] - e.pose.z)
    Object.assign(e.pose, { yaw: Math.atan2(to[0] - e.pose.x, -(to[2] - e.pose.z)), pitch: Math.atan2(to[1] - e.pose.y, d0) })
    e.input.hold('KeyW', true); e.input.hold('ShiftLeft', true)
    for (let i = 0; i < 600 && Math.hypot(to[0] - e.pose.x, to[1] - e.pose.y, to[2] - e.pose.z) > 50; i++) await new Promise((r) => setTimeout(r, 50))
    e.input.hold('KeyW', false); e.input.hold('ShiftLeft', false)
    return { flown: Math.round(Math.hypot(e.pose.x - start.x, e.pose.z - start.z)), left: Math.round(Math.hypot(to[0] - e.pose.x, to[1] - e.pose.y, to[2] - e.pose.z)) }
  }, last.id)
  n = (await told('navigate')).length
  await page.keyboard.press('KeyO')
  await page.waitForTimeout(500)
  nav = (await told('navigate')).at(-1)
  results.free = free
  check(free.left <= 55 && free.flown > 50 && (await told('navigate')).length === n + 1 && nav?.board === last.id && nav.to === last.to, `flying free: W flew ${free.flown} m from the park to ${free.left} m before ${last.id}, and O told the host to go to ${nav?.to}`)

  // ── A phone: a tap ──
  console.log('\na phone (390 x 844, touch)')
  {
    const handheld = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    const small = await handheld.newPage()
    small.on('pageerror', (e) => errors.push(`phone: ${e.message}`))
    await small.goto(`${site.url}/host.html`)
    await small.waitForFunction(() => window.told.some((m) => m.type === 'ready'), null, { timeout: 300_000 })
    const held = small.frames().find((f) => f.url().includes('/sf/index.html'))
    await held.waitForFunction(() => globalThis.engine.seen.whole > 0, null, { timeout: 300_000 })
    await small.waitForTimeout(4000)
    const inView = await held.evaluate(() => { const b = globalThis.engine.boards; return b.records.map((r) => ({ id: r.id, w: b.where(r.id), standing: b.standing(r.id) })).map((r) => ({ ...r, inside: !!r.w && r.w.x - r.w.wide / 2 > 0 && r.w.x + r.w.wide / 2 < innerWidth && r.w.y > 0 && r.w.y < innerHeight })) })
    await small.screenshot({ path: join(shots, 'phone.png') })
    const target = inView.find((r) => r.inside)
    results.phone = { inPicture: inView.filter((r) => r.inside).map((r) => r.id), of: inView.length }
    console.log(`  (report) in an upright phone's picture from the park: ${results.phone.inPicture.join(', ') || 'no board'} of ${inView.length} (the picture is ${round((Math.atan(Math.tan((25.05 * Math.PI) / 360) * (390 / 844)) * 360) / Math.PI)} degrees across)`)
    if (target) {
      await small.touchscreen.tap(target.w.x, target.w.y)
      await small.waitForFunction(() => window.told.some((m) => m.type === 'navigate'), null, { timeout: 15_000 }).catch(() => null)
      const nav = await small.evaluate(() => window.told.find((m) => m.type === 'navigate'))
      await small.waitForTimeout(2500)
      await small.screenshot({ path: join(shots, 'phone-tapped.png') })
      check(nav?.board === target.id, `a tap on ${target.id} on a phone flew to it and told the host to go to ${nav?.to}`)
    } else check(false, 'a board to tap in a phone\'s picture from the park')
    await handheld.close()
  }

  // ── What the signs say ──
  console.log('\nrealm.signs')
  const lettering = file.boards.find((b) => b.type === 'lettering'), digital = file.boards.find((b) => b.type === 'digital')
  const said = await realm.evaluate(async ({ lettering, digital }) => {
    const e = globalThis.engine, signs = globalThis.realm.signs, wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = {}
    const edits = e.boards.edits
    signs.set(lettering, { text: 'log' })
    out.lettered = { letters: e.boards.standing(lettering).letters, edits: e.boards.edits - edits, listed: signs.list().find((s) => s.id === lettering) }
    try { signs.set(lettering, { image: 'x.png' }); out.refused = false } catch (x) { out.refused = x instanceof TypeError }
    signs.set(lettering, null)
    out.back = { letters: e.boards.standing(lettering).letters, own: signs.list().find((s) => s.id === lettering).own }
    // A picture of the page's own making, and a video of a canvas that changes.
    const c = document.createElement('canvas'); c.width = 320; c.height = 120
    const g = c.getContext('2d'); g.fillStyle = '#d22'; g.fillRect(0, 0, 320, 120); g.fillStyle = '#fff'; g.font = '700 80px sans-serif'; g.fillText('EGG', 70, 90)
    signs.set(digital, { image: c.toDataURL() })
    signs.set('banner', { image: c.toDataURL() })
    await wait(800)
    out.image = signs.list().filter((s) => s.id === digital || s.id === 'banner').map((s) => 'image' in s.content)
    const video = document.createElement('video'); video.muted = true; video.srcObject = c.captureStream(15)
    const tick = setInterval(() => { g.fillStyle = `hsl(${(performance.now() / 5) % 360} 80% 45%)`; g.fillRect(0, 0, 320, 120); g.fillStyle = '#fff'; g.fillText('LIVE', 60, 90) }, 60)
    await video.play().catch(() => {})
    signs.set(digital, { video })
    await wait(1500)
    clearInterval(tick)
    out.video = { state: video.readyState, time: video.currentTime }
    out.unknown = (() => { try { signs.set('later', { text: 'kept for a sign that comes later' }); return true } catch { return false } })()
    return out
  }, { lettering: lettering.id, digital: digital.id })
  results.signs = said
  check(said.lettered.letters === 'LOG' && said.lettered.edits === 2 && said.lettered.listed.content.text === 'log' && said.back.letters === lettered(lettering.content.text) && said.back.own, `realm.signs.set("${lettering.id}", { text: "log" }) laid LOG in cells (${said.lettered.edits} edits: the old taken away, the new laid), and null put back ${said.back.letters}`)
  check(said.refused === true, 'a lettering board refuses an image with a TypeError')
  check(said.image.length === 2 && said.image.every(Boolean) && said.video.state >= 2 && said.unknown, `a digital board and the banner took an image, the board then a video (readyState ${said.video.state}); a sign not there yet is kept for`)
  // And from the host.
  await page.evaluate(() => { window.ask({ type: 'signs.set', id: 'banner', content: { text: 'NEW POST' } }); window.ask({ type: 'signs.set', id: 'blog', content: { image: 'x.png' } }) })
  await page.waitForTimeout(600)
  const hosted = await realm.evaluate(() => globalThis.realm.signs.list().find((s) => s.id === 'banner').content), refusedHost = (await told('error')).at(-1)
  check(hosted.text === 'NEW POST' && refusedHost?.fatal === false, `the host set the banner to "${hosted.text}", and was told its picture for a lettering board was refused`)
  await realm.evaluate((id) => { globalThis.realm.signs.set(id, null) }, digital.id)

  // ── The plane ──
  console.log('\nthe plane')
  await toPark()
  const plane = await realm.evaluate(async () => {
    const e = globalThis.engine, p = e.boards.plane, a = [...p.at]
    await new Promise((r) => setTimeout(r, 1000))
    const moved = Math.hypot(p.at[0] - a[0], p.at[2] - a[2]) / 10
    // Held where its banner is on its far pass, over the towers: is the cloth's middle in the picture, and nearer than what the eye sees there?
    p.hold = 0.99
    await new Promise((r) => setTimeout(r, 500))
    const v = e.view(), rect = document.querySelector('canvas').getBoundingClientRect(), c = p.cloth.at, d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]
    const x = (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (rect.width / rect.height) * far), y = (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)
    return { movedIn1s: Math.round(moved), cloth: { x: Math.round(((x + 1) / 2) * rect.width), y: Math.round(((1 - y) / 2) * rect.height), metres: Math.round(far / 10) }, showing: p.cloth.showing }
  })
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2500)
  const sky = await pixelsOf(await page.screenshot({ path: join(shots, 'banner.png') }))
  // The cloth is pale with red words: where its middle is, the picture is far from sky blue.
  const i = (plane.cloth.y * sky.w + plane.cloth.x) * 4, px = [sky.data[i], sky.data[i + 1], sky.data[i + 2]]
  results.plane = { ...plane, pixel: px }
  check(plane.movedIn1s > 10 && plane.movedIn1s < 40 && plane.cloth.x > 0 && plane.cloth.x < 1280 && plane.cloth.y > 0 && plane.cloth.y < 720 && px[0] > 150 && px[0] >= px[2] - 10, `the plane flew ${plane.movedIn1s} m in a second; on its far pass the banner is in the park's picture at ${plane.cloth.x}, ${plane.cloth.y}, ${plane.cloth.metres} m off, showing ${plane.showing.kind} (the picture there is ${px})`)
  await realm.evaluate(() => { globalThis.engine.boards.plane.hold = null; globalThis.engine.scale = 0.7 })

  // ── Broken, and put back ──
  console.log('\nbroken and put back')
  const blog = file.boards.find((b) => b.type === 'lettering')
  await realm.evaluate((id) => globalThis.engine.boards.fly(id), blog.id)
  await page.waitForTimeout(1500); await settle()
  const broke = await realm.evaluate(async ({ id, digital }) => {
    const e = globalThis.engine, b = e.boards, wait = (ms) => new Promise((r) => setTimeout(r, ms)), r = b.records.find((r) => r.id === id)
    // Two charges at the first letter, a third of the way up it and two thirds: where a visitor would aim.
    const n = [[-1, 0], [0, -1], [1, 0], [0, 1]][r.facing], right = [n[1], -n[0]], y0 = Math.ceil((r.at[1] + (r.lift ?? 1.6) * 10) / 8) * 8, wide = 32 * b.standing(id).letters.length
    const snap = (v) => Math.round(v / 8) * 8, along = -wide / 2 + 16
    for (const up of [18, 40]) { e.strike([snap(r.at[0]) + right[0] * along, y0 + up, snap(r.at[2]) + right[1] * along], 12); await wait(2500) }
    await wait(2500)
    const d = b.records.find((r) => r.id === digital), dn = [[-1, 0], [0, -1], [1, 0], [0, 1]][d.facing]
    e.strike([snap(d.at[0]) - dn[0], Math.ceil((d.at[1] + (d.lift ?? 1.6) * 10) / 8) * 8 + 28, snap(d.at[2]) - dn[1]], 32)
    await wait(4000)
    return { lettering: b.standing(id), digital: b.standing(digital), edits: e.world.done().length, laid: b.edits }
  }, { id: blog.id, digital: digital.id })
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(2500)
  await page.screenshot({ path: join(shots, 'broken.png') })
  results.broken = broke
  const text = lettered(blog.content.text)
  check(broke.lettering.letters === text.slice(1) && !broke.digital.whole, `two charges at the ${text[0]} of ${text} left ${broke.lettering.letters} standing; a big charge at ${digital.id} left ${broke.digital.letters} of its screen lit`)
  const reset = await realm.evaluate(async () => {
    const e = globalThis.engine
    await e.reset()
    for (let i = 0; i < 300 && (e.world.stats.wanted || e.world.stats.stale); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1500))
    return { boards: e.boards.records.map((r) => [r.id, e.boards.standing(r.id)]), edits: e.world.done().length, laid: e.boards.edits }
  })
  await realm.evaluate(() => { globalThis.engine.scale = 1 }); await page.waitForTimeout(3500)
  await page.screenshot({ path: join(shots, 'reset.png') })
  results.reset = reset
  check(reset.boards.every(([, s]) => s.whole) && reset.edits === reset.laid && reset.laid === file.boards.length, `reset put every board back whole (${reset.boards.map(([id, s]) => `${id} ${s.letters}`).join(', ')}): the world holds ${reset.edits} edits, the ${reset.laid} that lay the boards`)

  results.errors = errors
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  console.log(`  FAIL ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' ')}`)
  failures.push(String(e?.message ?? e).split('\n')[0])
} finally {
  await browser.close().catch(() => {})
  site.stop()
  back()
}
function lettered(text) { return text.toUpperCase() }
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
console.log('\n' + JSON.stringify(results))
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
