// The San Francisco realm's sky and its controls (#450), from the static folder: beside test/sf.mjs, which measures
// the rest of the realm. Served as any host of plain files serves it, opened in Chrome with WebGPU.
//
//   node test/sf-look.mjs [--no-build] [--base dist-sf-base] [--only gate,look,controls] [--rounds 5] [--shots ~/.village/engine/sf/look]
//
// It says:
//   - gate: what the march costs on a clear dry day at the park's camera, at street level on Taylor St and 150 m over
//     the park, this folder (B) against `--base`, a folder built from the commit before the weather (A): both pages up
//     in one browser, measured in turn (A B, B A, ...) at 1280 x 720 by the page's own `paced`, each pair counted only
//     when the fixed work (`quiet`) said the GPU was quiet beside it. At 1280 x 720, as test/sf.mjs measures. Fails where B is dearer than A by more than the
//     pairs lie apart and 3%.
//   - look: clear, overcast, fog rolling in, rain and night at the park, each a picture and a number that says it
//     took (the picture's light and contrast, the march's own state), and a change of weather caught halfway.
//   - controls: every control there and named, used by a mouse at 1280 x 720 and by touch on a phone's 390 x 844
//     (the stick, the look, up and down, the tool's key), and reset from its key.
//
// The base folder: `git worktree add /tmp/base <base>; cd /tmp/base/engine; npm ci; npm run core; node sf/build.mjs --out <here>/dist-sf-base`,
// or from this checkout before the change. Without it the gate fails (`--only look,controls` leaves it out).
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, 'dist-sf'), base = join(here, arg('base', 'dist-sf-base')), shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'look'))
const only = new Set(arg('only', 'gate,look,controls').split(',')), rounds = Number(arg('rounds', '5'))
const round = (n, to = 2) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}
mkdirSync(shots, { recursive: true })

// The gate times the GPU against another build: it holds every turn on it (kit.mjs `quiet`), so no other thread's check draws beside it.
const back = only.has('gate') ? await quiet() : await turn()
const browser = await chromium.launch(CHROME)
const sites = []
const serve = async (dir) => { const s = await plain(dir, '127.0.0.1'); sites.push(s); return s }
/** A page of a folder, up with the world round the park whole. */
const open = async (site, context) => {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 180_000 })
  page.errors = errors
  return page
}
const settle = (page) => page.waitForFunction(() => { const e = globalThis.engine, s = e.world.stats; return s.wanted === 0 && s.stale === 0 && e.march.sun.undrawn === 0 && e.march.sun.spoiled === 0 }, null, { timeout: 90_000, polling: 250 }).catch(() => null)
const PARK = { x: 51646.7, y: 85.98, z: 66402.3, yaw: 2.09798, pitch: -0.00916 }
/** The three places test/sf.mjs times: the park's camera (fov 25), Taylor St at a person's eye, 150 m over the park. */
const places = async (page) => {
  const ground = await page.evaluate(({ x, z }) => globalThis.engine.ground(x, z), PARK)
  const street = { x: 51590, z: 66300, yaw: -0.164, pitch: 0 }
  street.y = (await page.evaluate(({ x, z }) => globalThis.engine.ground(x, z), street)) + 1.7
  return [['park', PARK, 25.05], ['street', street, 70], ['up150', { ...PARK, y: ground + 150, pitch: -0.35 }, 70]]
}
const pose = (page, at, fov) => page.evaluate(({ at, fov }) => { const e = globalThis.engine; Object.assign(e.pose, at); e.fov = fov }, { at, fov })

try {
  // ── The gate: a clear dry day costs what it cost ──
  if (only.has('gate')) {
    console.log('\ngate: the march on a clear dry day, this folder (B) against the base (A)')
    if (!existsSync(join(base, 'sf/index.html'))) check(false, `no base folder at ${base}: build one from the commit before the weather`)
    else {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
      const pages = { A: await open(await serve(base), context), B: await open(await serve(dist), context) }
      for (const p of Object.values(pages)) await p.evaluate(() => { const e = globalThis.engine; e.scale = 1; e.resting = true })
      const measure = (page) => page.evaluate(async () => {
        const e = globalThis.engine, quiet = [await e.quiet()], three = []
        for (let i = 0; i < 3; i++) three.push(await e.paced(3))
        quiet.push(await e.quiet())
        e.resting = true
        return { ms: three.sort((a, b) => a - b)[1], quiet: Math.max(...quiet) }
      })
      let least = Infinity
      for (let i = 0; i < 6; i++) least = Math.min(least, await pages.A.evaluate(async () => { const e = globalThis.engine, q = await e.quiet(); e.resting = true; return q }))
      console.log(`  the fixed work takes ${least.toFixed(2)} ms at its least; a pair counts under ${(least * 1.3).toFixed(2)} ms`)
      for (const [name, at, fov] of await places(pages.A)) {
        for (const p of Object.values(pages)) { await pose(p, at, fov); await p.evaluate(() => { globalThis.engine.resting = false }); await p.waitForTimeout(500); await settle(p); await p.waitForTimeout(500); await p.evaluate(() => { globalThis.engine.resting = true }) }
        const pairs = []
        let tried = 0
        for (; pairs.length < rounds && tried < rounds * 5; tried++) {
          const order = tried % 2 ? ['B', 'A'] : ['A', 'B'], got = {}
          for (const way of order) got[way] = await measure(pages[way])
          least = Math.min(least, got.A.quiet, got.B.quiet)
          if (got.A.quiet < least * 1.3 && got.B.quiet < least * 1.3) pairs.push(got)
        }
        if (!pairs.length) { check(false, `${name}: the GPU was never quiet in ${tried} pairs`); continue }
        const mid = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1], ratios = pairs.map((g) => g.B.ms / g.A.ms).sort((a, b) => a - b)
        const a = mid(pairs.map((g) => g.A.ms)), b = mid(pairs.map((g) => g.B.ms)), r = mid(ratios), spread = Math.max(1 - ratios[0], ratios.at(-1) - 1)
        check(r - 1 <= Math.max(0.03, spread), `${name}: march ${round(a)} ms before, ${round(b)} ms after (${((r - 1) * 100).toFixed(1)}%; pairs lie between ${((ratios[0] - 1) * 100).toFixed(1)}% and ${((ratios.at(-1) - 1) * 100).toFixed(1)}%, ${pairs.length} of ${tried} kept)`)
      }
      for (const [way, p] of Object.entries(pages)) if (p.errors.length) check(false, `${way}: page errors: ${p.errors.slice(0, 3).join(' | ')}`)
      await context.close()
    }
  }

  // ── The look: each weather, a change of it caught halfway, night ──
  /** The picture's mean light and its contrast (the spread of light), 0 to 255, from a screenshot of the canvas alone. */
  const lightOf = async (page, name) => {
    const png = await page.locator('canvas').first().screenshot({ path: join(shots, `${name}.png`) })
    return page.evaluate(async (url) => {
      const img = new Image(); img.src = url; await img.decode()
      const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, img.width, img.height).data
      let sum = 0, sq = 0, bright = 0, n = 0
      for (let i = 0; i < d.length; i += 16) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; sq += l * l; n++; if (l > 150) bright++ }
      const mean = sum / n
      return { mean: Math.round(mean), contrast: Math.round(Math.sqrt(sq / n - mean * mean)), bright: Math.round((bright / n) * 1000) / 10 }
    }, `data:image/png;base64,${png.toString('base64')}`)
  }
  const until = (page, js, ms = 30_000) => page.waitForFunction(js, null, { timeout: ms, polling: 100 }).then(() => true, () => false)
  if (only.has('look')) {
    console.log('\nlook')
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await open(await serve(dist), context)
    const [, , up150] = await places(page)
    const at = async (where, fov) => { await pose(page, where, fov); await page.waitForTimeout(800); await settle(page) }
    const sky = (w) => page.evaluate((w) => globalThis.engine.realmControls.sky.set(w), w)
    const calm = () => until(page, () => !globalThis.engine.realmControls.sky.moving)
    await at(PARK, 25.05)
    await page.evaluate(() => { globalThis.engine.hour = 15 })
    await page.waitForTimeout(1500); await settle(page)
    const seen = {}
    for (const w of ['clear', 'overcast', 'fog', 'rain']) {
      await sky(w)
      const settled = await calm()
      await page.waitForTimeout(1200)
      const m = await page.evaluate(() => { const e = globalThis.engine; return { rain: e.march.rain, cloud: e.march.cloud, fog: e.march.fog, weather: e.realmControls.sky.weather } })
      seen[w] = { ...(await lightOf(page, `${w}`)), ...m }
      console.log(`  ${w}: ${JSON.stringify(seen[w])}`)
      check(settled && m.weather === w, `${w}: the march came round to it (rain ${round(m.rain)}, cloud ${round(m.cloud)}, fog ${round(m.fog)})`)
    }
    check(seen.overcast.mean < seen.clear.mean * 0.9 && seen.overcast.bright < seen.clear.bright * 0.6, `overcast is duller than clear: light ${seen.overcast.mean} against ${seen.clear.mean}, ${seen.overcast.bright}% of it bright against ${seen.clear.bright}%`)
    check(seen.fog.contrast < seen.clear.contrast * 0.85 && seen.fog.mean > seen.clear.mean, `fog whitens and takes the contrast: light ${seen.fog.mean} against ${seen.clear.mean}, contrast ${seen.fog.contrast} against a clear day's ${seen.clear.contrast}`)
    check(seen.rain.rain === 1, 'rain: it rains hard')
    // Fog rolling in, 150 m over the park: caught a few seconds in, the front still on its way east.
    await sky('clear'); await calm()
    await at(up150[1], 70)
    const before = await lightOf(page, 'fog-before')
    await sky('fog')
    // Caught when the front is half a kilometre short of the eye (it starts 6 km west): what a time alone catches
    // depends on how fast this page is drawing.
    const began = Date.now()
    await page.waitForFunction(() => { const e = globalThis.engine; return e.march.front - e.pose.x * 10 > -5000 }, null, { timeout: 30_000, polling: 50 }).catch(() => null)
    const caughtMs = Date.now() - began
    const rolling = await page.evaluate(() => { const e = globalThis.engine; return { fog: e.march.fog, front: e.march.front, eye: e.pose.x * 10, moving: e.realmControls.sky.moving } })
    const mid = await lightOf(page, 'fog-rolling-in')
    await calm(); await page.waitForTimeout(1000)
    const whole = await lightOf(page, 'fog-from-150m')
    console.log(`  fog rolling in, 150 m up: before ${JSON.stringify(before)}, ${round(caughtMs / 1000, 1)} s in ${JSON.stringify(mid)} (front ${round((rolling.front - rolling.eye) / 10, 0)} m east of the eye), all in ${JSON.stringify(whole)}`)
    check(rolling.moving && rolling.front < 1e8 && mid.contrast < before.contrast && whole.contrast < mid.contrast, `a change of weather is smooth: ${round(caughtMs / 1000, 1)} s into the fog the front is ${round((rolling.front - rolling.eye) / 10, 0)} m from the eye and the contrast ${before.contrast}, ${mid.contrast}, ${whole.contrast} falls as it comes`)
    // The hour, glided: halfway there a moment after it was asked for.
    await sky('clear'); await calm()
    await at(PARK, 25.05)
    await page.evaluate(() => globalThis.engine.realmControls.sky.glide(22))
    await page.waitForTimeout(350)
    const halfway = await page.evaluate(() => globalThis.engine.hour)
    await until(page, () => globalThis.engine.hour === 22)
    await page.waitForTimeout(2000); await settle(page)
    const night = await lightOf(page, 'night-park')
    console.log(`  night at the park: ${JSON.stringify(night)}; the hour ${round(halfway)} a third of a second into going from 15 to 22`)
    check(halfway > 15 && halfway < 22, `the hour goes round smoothly: ${round(halfway)} on its way from 15 to 22`)
    check(night.mean < seen.clear.mean * 0.5 && night.bright > 0, `night at the park: light ${night.mean} against the day's ${seen.clear.mean}, ${night.bright}% of it lit windows and lamps`)
    await sky('rain'); await calm(); await page.waitForTimeout(1000)
    await lightOf(page, 'night-rain')
    if (page.errors.length) check(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`)
    await context.close()
  }

  // ── The controls: there, named, used by a mouse and by touch ──
  if (only.has('controls')) {
    console.log('\ncontrols, by a mouse at 1280 x 720')
    const site = await serve(dist)
    const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await open(site, desk)
    await page.waitForFunction(() => document.querySelector('#realm [data-vx-live]'), null, { timeout: 30_000 }).catch(() => null)
    await page.waitForTimeout(1500)
    const roles = {
      time: page.getByRole('slider', { name: 'Time of day' }),
      weather: page.getByRole('radiogroup', { name: 'Weather' }),
      tools: page.getByRole('radiogroup', { name: 'Tool' }),
      reset: page.getByRole('button', { name: 'Reset world' }),
    }
    const counts = { weather: await roles.weather.getByRole('radio').count(), tools: await roles.tools.getByRole('radio').count() }
    const live = await page.evaluate(() => document.querySelectorAll('#realm [data-vx-live]').length)
    check(await roles.time.isVisible() && counts.weather === 4 && counts.tools === 7 && await roles.reset.isVisible(), `there and named: the time of day, ${counts.weather} weathers, ${counts.tools} tools, reset (${live} of them drawn as voxels by the kit)`)
    check(await page.evaluate(() => getComputedStyle(document.getElementById('tools')).display === 'none' && getComputedStyle(document.getElementById('boom')).display === 'none'), 'the page\'s plain bar of tools and its round key are this panel\'s now')
    await page.screenshot({ path: join(shots, 'controls-desk.png') })
    // Each weather by a click.
    for (const name of ['Overcast', 'Fog', 'Rain', 'Clear']) {
      await roles.weather.getByText(name, { exact: true }).click()
      const w = await page.evaluate(() => globalThis.engine.realmControls.sky.weather)
      check(w === name.toLowerCase(), `a click on ${name}: the weather asked for is ${w}`)
    }
    // Each tool by a click, and back from the keys: the bank follows.
    for (const [i, name] of ['Hammer', 'Charge', 'Big charge', 'Cannon', 'Torch', 'Cutter', 'Brick'].entries()) {
      await roles.tools.locator('label').nth(i).click()
      check((await page.evaluate(() => globalThis.engine.tool)) === name, `a click on ${i + 1} ${name}: the tool in hand is ${name}`)
    }
    await page.keyboard.press('Digit2')
    await page.waitForTimeout(500)
    check(await roles.tools.getByRole('radio').nth(1).isChecked(), 'the key 2 picks Charge and the bank shows it')
    // The keys are the world's again after a click: W flies.
    const p0 = await page.evaluate(() => ({ ...globalThis.engine.pose }))
    await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW')
    const p1 = await page.evaluate(() => ({ ...globalThis.engine.pose }))
    check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, `after a click on the panel W still flies: ${round(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1)} m`)
    await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), PARK)
    // The fader, dragged by the mouse: what the frames cost while it moves, the kit drawing (live) and not (plain).
    const drag = async (p) => {
      const box = await p.getByRole('slider', { name: 'Time of day' }).boundingBox()
      const gaps = p.evaluate(() => new Promise((done) => { const g = [], stop = globalThis.engine.watch((x) => g.push(x)); setTimeout(() => { stop(); done(g) }, 2600) }))
      await p.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2)
      await p.mouse.down()
      for (let k = 0; k <= 60; k++) { await p.mouse.move(box.x + box.width * (0.55 + 0.35 * (k / 60)), box.y + box.height / 2); await p.waitForTimeout(30) }
      await p.mouse.up()
      const g = (await gaps).filter((x) => x >= 2).sort((a, b) => a - b), q = (f) => round(g[Math.min(g.length - 1, Math.floor(g.length * f))], 1)
      return { frames: g.length, p50: q(0.5), p99: q(0.99), hour: await p.evaluate(() => globalThis.engine.realmControls.sky.hour) }
    }
    await page.evaluate(() => { globalThis.engine.scale = 0.75 })
    const liveDrag = await drag(page)
    check(liveDrag.hour > 18, `the fader dragged to the right: the hour asked for is ${round(liveDrag.hour)}`)
    const stats = await page.evaluate(async () => { const k = globalThis.engine.realmControls.kit; const s = k ? await k.ready() : null; return s?.renderer?.stage?.stats ?? null })
    const plainPage = await (async () => { const p = await desk.newPage(); await p.goto(`${site.url}/sf/index.html?kit=plain`); await p.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 180_000 }); await p.waitForTimeout(1500); await p.evaluate(() => { globalThis.engine.scale = 0.75 }); return p })()
    await page.evaluate(() => { globalThis.engine.resting = true })
    const plainDrag = await drag(plainPage)
    await plainPage.screenshot({ path: join(shots, 'controls-plain.png') })
    await plainPage.close()
    await page.evaluate(() => { globalThis.engine.resting = false })
    const liveDrag2 = await drag(page)
    console.log(`  (report) frames while the fader is dragged, scale 0.75: kit live ${JSON.stringify(liveDrag)} then ${JSON.stringify(liveDrag2)}, plain ${JSON.stringify(plainDrag)}; the kit's stage ${JSON.stringify(stats && { draws: stats.draws, drawMs: round(stats.drawMs), flushes: stats.flushes, flushMs: round(stats.flushMs) })}`)
    // Reset from its key: a blast, then the key, and the world is as it was.
    await page.evaluate(async () => { await globalThis.engine.blast(12) })
    await page.waitForTimeout(1500)
    const edits = await page.evaluate(() => globalThis.engine.world.done().length)
    await roles.reset.click()
    await page.waitForTimeout(1500)
    const after = await page.evaluate(() => globalThis.engine.world.done().length)
    check(edits > 0 && after === 0, `reset from its key: ${edits} edits, then ${after}`)
    if (page.errors.length) check(false, `page errors: ${page.errors.slice(0, 3).join(' | ')}`)
    await desk.close()

    console.log('\ncontrols, by touch on a phone (390 x 844)')
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
    const tp = await open(site, phone)
    await tp.waitForTimeout(2500)
    const cdp = await phone.newCDPSession(tp)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
    const holdAt = async (x, y, ms, to = null) => { await touch('touchStart', x, y); if (to) for (let k = 1; k <= 10; k++) await touch('touchMove', x + ((to[0] - x) * k) / 10, y + ((to[1] - y) * k) / 10); await tp.waitForTimeout(ms); await touch('touchEnd') }
    const centre = async (sel) => { const b = await tp.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2] }
    const shown = await tp.evaluate(() => [...document.querySelectorAll('#realm .stick, #realm .up, #realm .down, #realm .use, #realm .fold, #realm .tools')].map((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }))
    check(shown.length === 6 && shown.every(Boolean), `on a phone the stick, up, down, use, the sky's key and the tools are there and inside the screen (${shown.map((x) => (x ? 'in' : 'out')).join(', ')})`)
    await tp.screenshot({ path: join(shots, 'controls-phone.png') })
    const q = () => tp.evaluate(() => ({ ...globalThis.engine.pose }))
    // The stick: a thumb on the left half pushed up flies forward; the cap follows it.
    let a = await q()
    await touch('touchStart', 90, 690)
    for (let k = 1; k <= 10; k++) await touch('touchMove', 90, 690 - 5 * k)
    await tp.waitForTimeout(900)
    const capMoved = await tp.evaluate(() => getComputedStyle(document.querySelector('#realm .stick .cap')).transform)
    await tp.screenshot({ path: join(shots, 'controls-phone-stick.png') })
    await touch('touchEnd')
    let b = await q()
    check(Math.hypot(b.x - a.x, b.z - a.z) > 2 && capMoved !== 'none', `the stick: a thumb pushed up flew ${round(Math.hypot(b.x - a.x, b.z - a.z), 1)} m, its cap under the thumb (${capMoved})`)
    // The look: a drag on the right half turns the head.
    a = await q(); await holdAt(300, 180, 200, [220, 180]); b = await q()
    check(Math.abs(b.yaw - a.yaw) > 0.1, `a drag on the right half turns the head ${round(b.yaw - a.yaw)} rad`)
    // Up and down, held.
    a = await q(); await holdAt(...(await centre('#realm .up')), 900); b = await q()
    check(b.y - a.y > 2, `Up held: ${round(b.y - a.y, 1)} m higher`)
    a = await q(); await holdAt(...(await centre('#realm .down')), 900); b = await q()
    check(a.y - b.y > 2, `Down held: ${round(a.y - b.y, 1)} m lower`)
    // A tool by a tap, then Use on what is ahead.
    await tp.locator('#realm .tools label').nth(2).tap()
    check((await tp.evaluate(() => globalThis.engine.tool)) === 'Big charge', 'a tap on 3 picks Big charge')
    await tp.evaluate((p) => Object.assign(globalThis.engine.pose, p), { ...PARK, pitch: -0.3 })
    await tp.waitForTimeout(1500)
    const e0 = await tp.evaluate(() => globalThis.engine.world.done().length)
    await tp.locator('#realm .use').tap()
    const used = await until(tp, (n) => globalThis.engine.world.done().length > 0, 8000)
    check(used, `Use, tapped: the world has ${await tp.evaluate(() => globalThis.engine.world.done().length)} edits (${e0} before)`)
    // The sky's panel, opened by its key; a weather by a tap.
    await tp.locator('#realm .fold').tap()
    await tp.getByRole('radiogroup', { name: 'Weather' }).getByText('Rain', { exact: true }).tap()
    check((await tp.evaluate(() => globalThis.engine.realmControls.sky.weather)) === 'rain', 'the sky\'s key opens its panel, and a tap on Rain asks for rain')
    await tp.waitForTimeout(1500)
    await tp.screenshot({ path: join(shots, 'controls-phone-sky.png') })
    if (tp.errors.length) check(false, `page errors: ${tp.errors.slice(0, 3).join(' | ')}`)
    await phone.close()
  }
} finally {
  await browser.close()
  for (const s of sites) s.stop()
  back()
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
