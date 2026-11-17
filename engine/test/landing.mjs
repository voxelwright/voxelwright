// The landing world, checked and measured (#421): the folder `npm run player` writes, served as any host of plain
// files would serve it, with the home page (landing/site/index.html) opened as a visitor would open it, in Chrome
// and in Playwright's WebKit. It says how long until the page's links can be used and until the street's signs
// can, how the frames are with nothing touched and while it is played with, what is downloaded, and that the page
// stands alone where the street cannot or should not be shown. It checks the things the street promises: a sign
// chosen is flown to and its link followed, what breaks mends, the face stretches and comes back, and nothing is
// drawn while nobody can see it.
//
//   node test/landing.mjs [--only chrome,webkit] [--shots ~/.village/engine/landing] [--seconds 8] [--clip] [--headed]
//
// Frames are counted by the street's own clock, in a window nobody sees (headless): the gaps between frames, and
// beside them how many pixels it chose to draw (its scale). A frame time alone flatters.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { chromium, webkit } from 'playwright'
import { arg, CHROME, has, here, quiet } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const round = (n, to = 1) => Math.round(n * 10 ** to) / 10 ** to
const middle = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const frames = (gaps) => { const s = gaps.filter((g) => g >= 2).sort((a, b) => a - b); return { frames: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), p95: round(s[Math.floor(s.length * 0.95)]), worst: round(s[s.length - 1]), late: s.filter((g) => g > 25).length } }
const dist = join(here, 'dist'), shots = arg('shots', join(homedir(), '.village', 'engine', 'landing')), seconds = Number(arg('seconds', '8'))
const only = arg('only', 'chrome,webkit').split(','), failures = [], results = {}
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

const built = spawnSync('npm', ['run', '-s', 'player'], { cwd: here, encoding: 'utf8' })
if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
mkdirSync(shots, { recursive: true })
const site = await plain(dist, '127.0.0.1', Number(arg('port', '5952')))
const home = `${site.url}/landing/site/index.html`
const browsers = { chrome: () => chromium.launch({ ...CHROME, headless: !has('headed') }), webkit: () => webkit.launch({ headless: !has('headed') }) }
const back = await quiet()

/** The street's own frame in the page. */
const street = (page) => page.frames().find((f) => f !== page.mainFrame())
/** Waits until the eye has landed at a place. */
const landed = (page, id, timeout = 20000) => page.waitForFunction((id) => globalThis.home.at === id && !globalThis.home.flying, id, { timeout })
/** In the street: empties its gaps, waits, and says how the frames were. */
const watch = (frame, s) => frame.evaluate(async (ms) => { const on = globalThis.landing.on; on.gaps.length = 0; await new Promise((r) => setTimeout(r, ms)); return { gaps: [...on.gaps], scale: on.scale, gpuMs: on.gpuMs, canvas: [on.canvas.width, on.canvas.height], faults: on.gpu.faults } }, s * 1000)
const said = (w) => ({ ...frames(w.gaps), scale: w.scale, canvas: w.canvas })
/** Where a place in the world is on the page, px. */
const spot = (frame, at) => frame.evaluate((at) => globalThis.landing.spot(at), at)
/** A press at a place for so long: a tap, or a hold. */
const press = async (page, [x, y], ms) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up() }
const open = async (browser, more = {}, before) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, ...more }), page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  if (before) await before(page)
  return { context, page }
}

for (const name of only) {
  console.log(`\n${name}`)
  const out = (results[name] = {})

  // ── A first visit, cold: a browser just started, three of them, the middle one said ──
  const colds = []
  for (let i = 0; i < 3; i++) {
    const b = await browsers[name](), { page } = await open(b)
    site.asked.length = 0
    await page.goto(home)
    await landed(page, 'home', 60000)
    const t = await page.evaluate(() => ({ ...globalThis.home.times, paint: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0), decided: globalThis.home.decided }))
    colds.push(t)
    if (i === 0) {
      out.version = b.version()
      check(t.decided[0] === '3d' && t.decided[1] === 'able', `a visitor who chose nothing, where the street can be drawn, is shown it (${t.decided})`)
      await street(page).waitForFunction(() => globalThis.landing.on.seen.whole > 0, null, { timeout: 60000 })
      const loaded = [...new Set(site.asked.map((a) => a.path))]
      check(site.asked.every((a) => a.status === 200) && loaded.every((path) => existsSync(join(dist, path))), `it asked for ${loaded.length} files, all of the folder, and nothing else`)
      const sizes = loaded.map((path) => { const body = readFileSync(join(dist, path)); return { path, raw: body.length, gzip: gzipSync(body, { level: 9 }).length, brotli: brotliCompressSync(body).length } })
      const sum = (list, k) => list.reduce((n, size) => n + size[k], 0), flat = sizes.filter((s) => s.path.includes('/site/'))
      results.download ??= { files: sizes.length, raw: sum(sizes, 'raw'), gzip: sum(sizes, 'gzip'), brotli: sum(sizes, 'brotli'), page: { files: flat.length, raw: sum(flat, 'raw'), gzip: sum(flat, 'gzip'), brotli: sum(flat, 'brotli') }, biggest: sizes.sort((x, y) => y.brotli - x.brotli).slice(0, 5).map((s) => `${s.path} ${round(s.brotli / 1024)} KB`) }
    }
    await b.close()
  }
  const mid = (k) => middle(colds.map((c) => c[k]))
  out.cold = { linksPainted: mid('paint'), streetAsked: mid('asked'), streetReady: mid('ready'), streetShown: mid('street'), signsUsable: mid('menu') }

  const browser = await browsers[name]()
  // ── The flight in, cut short ──
  {
    const { context, page } = await open(browser)
    await page.goto(home)
    await page.waitForFunction(() => globalThis.home.view === '3d', null, { timeout: 60000 })
    await page.keyboard.press('ArrowRight')
    await landed(page, 'home')
    const t = await page.evaluate(() => globalThis.home.times)
    out.skipped = { streetShown: t.street, signsUsable: t.menu }
    check(t.menu - t.street < 400, `a key cuts the flight in short: the signs can be used ${t.menu - t.street} ms after the street is shown (${t.menu} ms after the page was asked for)`)
    await context.close()
  }

  const { context, page } = await open(browser)
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  page ${m.type()}: ${m.text().slice(0, 300)}`) })
  await page.goto(home)
  await landed(page, 'home', 60000)
  const inner = street(page)
  await inner.waitForFunction(() => globalThis.landing.on.seen.whole > 0, null, { timeout: 60000 })

  // ── The page under the street: Tab, and the switch ──
  await page.keyboard.press('Tab')
  check(await page.evaluate(() => document.activeElement?.id) === 'plain', 'the first Tab stop is the way to the plain page')
  const href = page.url()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const drawn = await inner.evaluate(() => globalThis.landing.on.frames)
  await page.waitForTimeout(1000)
  const flat = await page.evaluate(() => ({ view: globalThis.home.view, focus: document.activeElement?.id, inert: document.querySelector('#page').inert }))
  check(flat.view === '2d' && flat.focus === 'plain' && page.url() === href && !flat.inert, `the switch shows the page, keeps the address and the focus (${flat.view}, focus on ${flat.focus})`)
  check(await inner.evaluate(() => globalThis.landing.on.frames) === drawn, 'under the page the street draws nothing')
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await page.focus('#street')
  await page.keyboard.press('Enter')
  await landed(page, 'home')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => globalThis.home.view === '3d' && document.activeElement?.id === 'street' && document.querySelector('#page').inert) && page.url() === href, 'and back to the street, the same')
  check(await inner.evaluate(() => globalThis.landing.on.frames) > drawn, 'which draws again')
  // The tab hidden: nothing is drawn.
  await inner.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.waitForTimeout(200)
  const hiddenAt = await inner.evaluate(() => globalThis.landing.on.frames)
  await page.waitForTimeout(800)
  check(await inner.evaluate(() => globalThis.landing.on.frames) === hiddenAt, 'with the tab hidden the street draws nothing')
  await inner.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })

  // ── A tap knocks, a hold breaks ──
  const places = await inner.evaluate(() => globalThis.landing.places)
  const leg = [places.table.at[0] - 13, places.table.at[1] - 15, places.table.at[2] + 8]
  for (let i = 0; i < 3; i++) { await press(page, await spot(inner, leg), 60); await page.waitForTimeout(700) }
  const tapped = await inner.evaluate(() => ({ thrown: globalThis.landing.on.thrown, broken: globalThis.landing.on.broken }))
  check(tapped.thrown === 3 && tapped.broken === 0, `three taps on the table's glass leg throw three balls and break nothing (${tapped.broken} changes)`)
  await press(page, await spot(inner, leg), 900)
  await inner.waitForFunction(() => globalThis.landing.on.broken > 0, null, { timeout: 5000 }).catch(() => {})
  check(await inner.evaluate(() => globalThis.landing.on.broken) > 0, 'a hold on the same leg breaks it')
  await inner.evaluate(() => globalThis.landing.mend())
  await page.waitForTimeout(600)

  // ── Frames: nothing touched, then played with ──
  await page.mouse.move(640, 300)
  await page.waitForTimeout(2500)
  out.idle = said(await watch(inner, seconds))
  await page.screenshot({ path: join(shots, `street-${name}.png`) })
  const playing = watch(inner, seconds)
  const until = Date.now() + (seconds - 0.5) * 1000
  for (let i = 0; Date.now() < until; i++) {
    const at = [places.table.at, places.signs[i % 4].at, [places.table.at[0] - 14, places.table.at[1] - 15, places.table.at[2] + 8]][i % 3]
    await press(page, await spot(inner, at), i % 2 ? 850 : 320)
    if (i % 4 === 3) { await page.mouse.move(700, 200); await page.mouse.down(); await page.mouse.move(640, 215, { steps: 8 }); await page.mouse.up() }
    await page.waitForTimeout(150)
  }
  const played = await playing
  out.playing = { ...said(played), thrown: await inner.evaluate(() => globalThis.landing.on.thrown) - 4, edits: await inner.evaluate(() => globalThis.landing.on.broken) }
  check(out.playing.thrown > 0 && out.playing.edits > 0, `played with, it threw ${out.playing.thrown} balls and the world was changed ${out.playing.edits} times`)
  check(played.faults.length === 0, `the GPU reported no fault${played.faults.length ? `: ${played.faults[0]}` : ''}`)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, `street-${name}-broken.png`) })

  // ── What breaks mends ──
  check(await page.evaluate(() => globalThis.home.heard.includes('broke')), 'the page was told something broke')
  // (It was mended once already, by hand, after the hold above: this waits for the one it does by itself.)
  await page.waitForFunction(() => globalThis.home.heard.filter((h) => h === 'mended').length > 1, null, { timeout: 40000 }).catch(() => {})
  await inner.waitForFunction(() => { const s = globalThis.landing.on.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(500)
  const mended = await inner.evaluate(() => ({ dirty: globalThis.landing.dirty, bodies: globalThis.landing.on.bodies, pieces: globalThis.landing.on.pieces }))
  check(await page.evaluate(() => globalThis.home.heard.filter((h) => h === 'mended').length > 1) && !mended.dirty && mended.bodies === 0 && mended.pieces === 0, `left alone, the corner mended itself (${JSON.stringify(mended)})`)
  await page.screenshot({ path: join(shots, `street-${name}-mended.png`) })
  // Ten more times: what was done to the world is forgotten each time, so the list of it stays as long as the scene's own, and frames cost what they did.
  for (let i = 0; i < 10; i++) {
    await press(page, await spot(inner, places.signs[i % 4].at), 850)
    await page.waitForTimeout(900)
    await inner.evaluate(() => globalThis.landing.mend())
    await page.waitForTimeout(500)
  }
  await inner.waitForFunction(() => { const s = globalThis.landing.on.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 20000 })
  const kept = await inner.evaluate(() => ({ edits: globalThis.landing.on.world.edits.length, scene: globalThis.landing.on.scene.edits.length, broken: globalThis.landing.on.broken }))
  out.mends = { ...kept, after: said(await watch(inner, 3)) }
  check(kept.edits === kept.scene && kept.broken > out.playing.edits, `broken and mended ten times more (${kept.broken} changes in all), the world holds ${kept.edits} edit, the scene's own; frames after: ${out.mends.after.mean} ms at scale ${out.mends.after.scale}`)

  // ── The face ──
  await page.keyboard.press('f')
  await landed(page, 'face')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, `face-${name}.png`) })
  const nose = await spot(inner, [places.face.at[0] - 8, places.face.at[1] - 6, places.face.at[2]])
  await page.mouse.move(nose[0], nose[1]); await page.mouse.down(); await page.mouse.move(nose[0] + 170, nose[1] - 90, { steps: 12 })
  await page.waitForTimeout(150)
  const pulled = await inner.evaluate(() => ({ held: globalThis.landing.head.held, stretch: globalThis.landing.head.stretch }))
  await page.screenshot({ path: join(shots, `face-${name}-pulled.png`) })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const wobbling = await inner.evaluate(() => globalThis.landing.head.stretch)
  await inner.waitForFunction(() => globalThis.landing.head.stretch === 0, null, { timeout: 8000 }).catch(() => {})
  check(pulled.held && pulled.stretch > 8 && wobbling > 0.2 && await inner.evaluate(() => globalThis.landing.head.stretch) === 0, `the face is taken hold of and pulled ${round(pulled.stretch)} cells, wobbles when let go, and comes back`)

  // ── Choosing: by the link, then by the sign itself ──
  await page.keyboard.press('Escape')
  await landed(page, 'home')
  await page.focus('#menu a[data-sign="village"]')
  await page.keyboard.press('ArrowDown')
  await landed(page, 'tags')
  check(await page.evaluate(() => document.activeElement?.dataset.sign === 'tags' && document.activeElement.getAttribute('aria-current') === 'true'), 'the arrow keys go from link to link, and the eye flies to each sign')
  await page.screenshot({ path: join(shots, `sign-${name}.png`) })
  await page.keyboard.press('Enter')
  await page.waitForURL('**/tags/index.html', { timeout: 10000 }).catch(() => {})
  check(page.url().endsWith('/landing/site/tags/index.html'), `Enter on the link flies through the sign and follows the link (${page.url().split('/landing/')[1]})`)
  await page.goto(home)
  await landed(page, 'home', 60000)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  const again = street(page)
  await press(page, await spot(again, places.signs[0].at), 60)
  await page.waitForURL('**/blog/index.html', { timeout: 10000 }).catch(() => {})
  check(page.url().endsWith('/landing/site/blog/index.html'), `a tap on a sign flies to it and follows its link (${page.url().split('/landing/')[1]})`)
  await context.close()

  // ── A phone's shape, with a finger ──
  {
    const { context: small, page: phone } = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: name === 'chrome' })
    await phone.goto(home)
    await landed(phone, 'home', 60000)
    await street(phone).waitForFunction(() => globalThis.landing.on.seen.whole > 0, null, { timeout: 60000 })
    await phone.waitForTimeout(800)
    await phone.screenshot({ path: join(shots, `phone-${name}.png`) })
    const fits = await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#menu a, .switch button')].every((a) => { const r = a.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height + 14 >= 44 }))
    check(fits, 'at 390 px wide nothing spills, and every control can be hit')
    const before = await street(phone).evaluate(() => globalThis.landing.on.thrown)
    const [tx, ty] = await spot(street(phone), (await street(phone).evaluate(() => globalThis.landing.places)).table.at)
    await phone.touchscreen.tap(Math.max(60, Math.min(330, tx)), Math.max(120, Math.min(560, ty)))
    await phone.waitForTimeout(500)
    check(await street(phone).evaluate(() => globalThis.landing.on.thrown) > before, 'a finger\'s tap throws a ball')
    // The face is round the corner: a drag turns the eye to it, a tap goes to it, and it is pulled there.
    const ph = street(phone), fp = (await ph.evaluate(() => globalThis.landing.places)).face
    await phone.mouse.move(120, 300); await phone.mouse.down(); await phone.mouse.move(300, 300, { steps: 8 }); await phone.mouse.up()
    const [fx, fy] = await spot(ph, [fp.at[0] - 6, fp.at[1], fp.at[2]])
    await phone.touchscreen.tap(fx, fy)
    await landed(phone, 'face', 8000).catch(() => {})
    await phone.waitForTimeout(300)
    const [nx, ny] = await spot(ph, [fp.at[0] - 8, fp.at[1] - 6, fp.at[2]])
    await phone.mouse.move(nx, ny); await phone.mouse.down(); await phone.mouse.move(nx + 90, ny - 60, { steps: 8 })
    const far = await ph.evaluate(() => globalThis.landing.head.stretch)
    await phone.screenshot({ path: join(shots, `phone-${name}-face.png`) })
    await phone.mouse.up()
    check(await phone.evaluate(() => globalThis.home.at) === 'face' && far > 5, `on a phone the face is found by a drag and a tap (the tap landed at ${Math.round(fx)}, ${Math.round(fy)}), and pulled ${round(far)} cells`)
    await phone.tap('#plain')
    await phone.waitForTimeout(800)
    await phone.screenshot({ path: join(shots, `phone-${name}-page.png`) })
    await small.close()
  }

  // ── Where the street is not shown ──
  const page2d = async (what, more, before, query = '') => {
    const { context: c, page: p } = await open(browser, more, before)
    await p.goto(home + query)
    await p.waitForFunction(() => globalThis.home?.decided, null, { timeout: 10000 })
    await p.waitForTimeout(1200)
    const got = await p.evaluate(() => ({ decided: globalThis.home.decided, view: globalThis.home.view, frames: document.querySelectorAll('iframe').length, links: document.querySelectorAll('#menu a[href]').length, ms: globalThis.home.times.decided }))
    check(got.view === '2d' && got.frames === 0 && got.links === 4, `${what}: the page, and the street is never asked for (${got.decided[1]}, decided at ${got.ms} ms)`)
    return { c, p, got }
  }
  {
    const { c, p } = await page2d('less motion asked for', { reducedMotion: 'reduce' })
    await p.screenshot({ path: join(shots, `page-${name}.png`) })
    await c.close()
  }
  {
    const { c, p } = await page2d('no WebGPU', {}, (p) => p.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }) }))
    await p.click('#street')
    await p.waitForTimeout(300)
    check(await p.evaluate(() => !document.querySelector('#note').hidden && globalThis.home.view === '2d'), 'and asked for the street there, it says why there is none')
    await c.close()
  }
  { const { c } = await page2d('an adapter that never answers', {}, (p) => p.addInitScript(() => { navigator.gpu.requestAdapter = () => new Promise(() => {}) })); await c.close() }
  { const { c } = await page2d('?view=2d', {}, null, '?view=2d'); await c.close() }
  {
    // A device that draws it slowly (every frame made to take 60 ms more): the street says so, and the page comes back with a word of why.
    const { context: c, page: p } = await open(browser)
    await p.goto(home + '?drag=60')
    await p.waitForFunction(() => globalThis.home.heard.includes('slow'), null, { timeout: 30000 }).catch(() => {})
    await p.waitForTimeout(800)
    const got = await p.evaluate(() => ({ heard: globalThis.home.heard.includes('slow'), view: globalThis.home.view, note: document.querySelector('#note').textContent, hidden: document.querySelector('#note').hidden, times: globalThis.home.times }))
    check(got.heard && got.view === '2d' && !got.hidden && /slowly/.test(got.note), `frames too slow in the street's first two seconds: the page comes back and says why (${got.times.slow - got.times.ready} ms after the street was ready)`)
    await p.click('#street')
    await p.waitForTimeout(600)
    check(await p.evaluate(() => globalThis.home.view === '3d'), 'and Street shows it all the same')
    await c.close()
  }
  {
    // The choice is kept: Plain page chosen once, the next visit is the page, whatever the address says.
    const { context: c, page: p } = await open(browser)
    await p.goto(home)
    await landed(p, 'home', 60000)
    await p.click('#plain')
    await p.goto(home + '?view=3d')
    await p.waitForFunction(() => globalThis.home?.decided)
    await p.waitForTimeout(800)
    const got = await p.evaluate(() => ({ decided: globalThis.home.decided, frames: document.querySelectorAll('iframe').length }))
    check(got.decided[0] === '2d' && got.decided[1] === 'kept' && got.frames === 0, `the visitor's own choice comes first: Plain page chosen once, the next visit is the page even with ?view=3d (${got.decided})`)
    await p.click('#street')
    await landed(p, 'home', 60000)
    await p.reload()
    await landed(p, 'home', 60000)
    check(await p.evaluate(() => globalThis.home.decided.join() === '3d,kept'), 'and Street chosen, the next visit is the street')
    await c.close()
  }
  {
    // Less motion, and the street asked for all the same: no flights, the eye is put where it is going.
    const { context: c, page: p } = await open(browser, { reducedMotion: 'reduce' })
    await p.goto(home)
    await p.waitForFunction(() => globalThis.home?.decided)
    await p.click('#street')
    await landed(p, 'home', 60000)
    const t = await p.evaluate(() => globalThis.home.times)
    check(t.menu - t.street < 300, `less motion and the street asked for: no flight in (the signs can be used ${t.menu - t.street} ms after it is shown)`)
    await c.close()
  }
  await browser.close()
}

// ── A film of one run ──
if (has('clip')) {
  console.log('\na film')
  const browser = await browsers.chrome(), dir = join(shots, 'film')
  rmSync(dir, { recursive: true, force: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1280, height: 720 } } }), page = await context.newPage()
  const began = Date.now(), moments = {}
  await page.goto(home)
  await landed(page, 'home', 60000)
  const inner = street(page), places = await inner.evaluate(() => globalThis.landing.places)
  await page.waitForTimeout(1200)
  // Knock the table over, break a sign, wait for both to mend.
  await press(page, await spot(inner, [places.table.at[0] - 13, places.table.at[1] - 15, places.table.at[2] + 8]), 900)
  await page.waitForTimeout(1600)
  await press(page, await spot(inner, places.signs[1].at), 900)
  await page.waitForTimeout(700)
  await press(page, await spot(inner, places.signs[3].at), 900)
  moments.broken = (Date.now() - began) / 1000 + 0.9
  await page.waitForFunction(() => globalThis.home.heard.includes('mended'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1800)
  // The face.
  await page.keyboard.press('f')
  await landed(page, 'face')
  await page.waitForTimeout(500)
  const nose = await spot(inner, [places.face.at[0] - 8, places.face.at[1] - 6, places.face.at[2]])
  await page.mouse.move(nose[0], nose[1]); await page.mouse.down(); await page.mouse.move(nose[0] + 190, nose[1] - 70, { steps: 25 }); moments.pulled = (Date.now() - began) / 1000 + 0.15; await page.waitForTimeout(350); await page.mouse.up()
  await page.waitForTimeout(1300)
  const ear = await spot(inner, [places.face.at[0] - 5, places.face.at[1] + 2, places.face.at[2] - 17])
  await page.mouse.move(ear[0], ear[1]); await page.mouse.down(); await page.mouse.move(ear[0] - 160, ear[1] + 40, { steps: 20 }); await page.waitForTimeout(300); await page.mouse.up()
  await page.waitForTimeout(1500)
  // Back, along the signs, and in through one.
  await page.keyboard.press('Escape')
  await landed(page, 'home')
  await page.waitForTimeout(500)
  await page.focus('#menu a[data-sign="blog"]')
  for (const id of ['village', 'tags']) { await page.keyboard.press('ArrowDown'); await landed(page, id); await page.waitForTimeout(450) }
  await page.keyboard.press('Enter')
  await page.waitForURL('**/tags/index.html', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await context.close()
  await browser.close()
  const made = readdirSync(dir).find((f) => f.endsWith('.webm'))
  if (made) {
    renameSync(join(dir, made), join(shots, 'landing.webm'))
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, 'landing.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', join(shots, 'landing.mp4')])
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(shots, 'landing.webm'), '-vf', 'fps=0.6,scale=480:-1,tile=5x5', '-frames:v', '1', join(shots, 'landing-strip.jpg')])
    for (const [what, at] of Object.entries(moments)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', join(shots, 'landing.webm'), '-frames:v', '1', join(shots, `film-${what}.jpg`)])
    console.log(`  ${join(shots, 'landing.webm')}\n  ${join(shots, 'landing.mp4')}\n  ${join(shots, 'landing-strip.jpg')}`)
  } else failures.push('no film was made')
  rmSync(dir, { recursive: true, force: true })
}

back()
site.stop()
console.log(`\n${JSON.stringify(results, null, 1)}`)
if (failures.length) { console.error(`\nFAILED:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('\nlanding: all of it held')
process.exit(0)
