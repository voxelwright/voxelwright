// The landing's easter eggs in the San Francisco realm (#450, page/eggs.ts), from the static folder, in Chrome with
// WebGPU. Sound is refused by a simulated browser rule (Playwright's evaluate counts as a press, so a real refusal
// cannot be had in a check): the egg plays muted, and Unmute, a real click, brings the sound.
//
//   node test/sf-eggs.mjs [--no-build] [--shots ~/.village/engine/sf/eggs] [--headed]
//
// For each egg: its trigger as a visitor makes it (keys typed, the line, a tool used), what it does to the picture
// (read from the canvas: the windows, the sky, the moon, against the picture before), that it is undone (Esc, a
// phrase, reset) and the sky comes back, and the frame gaps while it runs, beside the same sky without the window
// screen (what the screen itself costs). A video's windows are checked against the frame held on them: the light of
// the windows follows the picture's light and dark. Its sound: refused (simulated: it plays muted, and Unmute brings
// it), and decoded when a typed line started it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from './kit.mjs'
import { plain } from '../player/serve.mjs'

const shots = arg('shots', join(homedir(), '.village', 'engine', 'sf', 'eggs'))
const round = (n, to = 2) => Math.round(n * 10 ** to) / 10 ** to
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs')], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}
mkdirSync(shots, { recursive: true })
const site = await plain(join(here, 'dist-sf'), '127.0.0.1')
const back = await turn()
// The browser's rule for sound as a visitor's browser has it: no sound until the page has had a press or a tap.
const browser = await chromium.launch({ ...CHROME, args: [...CHROME.args, '--autoplay-policy=document-user-activation-required'] })
const results = {}

/** A page of the realm, up with the world round the park whole. */
const open = async (context) => {
  const page = await context.newPage()
  // A browser's refusal of sound, simulated: Playwright's evaluate counts as a press, so a check's page always may
  // play sound. While `refuseSound` is set, an unmuted video's play() is refused as a browser refuses it.
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () { return globalThis.refuseSound && !this.muted && this.src ? Promise.reject(new DOMException('refused (simulated)', 'NotAllowedError')) : play.call(this) }
  })
  page.errors = []
  page.said = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { page.said.push(m.text()); if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) page.errors.push(m.text()) })
  await page.goto(`${site.url}/sf/index.html?knock=0`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.eggs, null, { timeout: 180_000 })
  await page.evaluate(() => { globalThis.engine.scale = 1 })
  return page
}
const settle = (page) => page.waitForFunction(() => { const e = globalThis.engine, s = e.world.stats; return s.wanted === 0 && s.stale === 0 && e.march.sun.undrawn === 0 }, null, { timeout: 60_000, polling: 250 }).catch(() => null)
/** Until the sky has come round to what was asked (the hour's glide, the weather's change, the fog's front) and the screen is all the way up or down. */
const still = async (page) => {
  await page.waitForFunction(() => { const e = globalThis.engine; return !e.realmControls.sky.moving && [0, 1].includes(e.march.screen.up) }, null, { timeout: 40_000, polling: 200 }).catch(() => null)
  await settle(page)
  await page.waitForTimeout(600)
}
const state = (page) => page.evaluate(() => ({ ...globalThis.engine.eggs.state, status: document.querySelector('.egg-status')?.textContent, hour: globalThis.engine.hour, weather: globalThis.engine.realmControls.sky.weather, signs: Object.fromEntries(globalThis.engine.signs.list().map((s) => [s.id, s.own || !s.content ? null : 'text' in s.content ? s.content.text : 'video' in s.content ? 'video' : 'image'])) }))
/** Until an egg is running (a picture or a video is fetched when it starts). */
const started = (page, egg) => page.waitForFunction((egg) => globalThis.engine.eggs.state.running === egg, egg, { timeout: 30_000 }).catch(() => null)
/** Says something on the line, as a visitor does: Enter, the words, Enter. */
const sayTo = async (page, words) => { await page.keyboard.press('Enter'); await page.keyboard.type(words, { delay: 25 }); await page.keyboard.press('Enter') }

/** The canvas as a grid of 64 x 36 cells, each its mean linear-ish rgb (0 to 255); saved as a picture too. */
const grid = async (page, name) => {
  const png = await page.locator('canvas').first().screenshot(name ? { path: join(shots, `${name}.png`) } : {})
  return page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, img.width, img.height).data, W = 64, H = 36, out = new Float32Array(W * H * 3), n = new Float32Array(W * H)
    for (let y = 0; y < img.height; y++) for (let x0 = 0; x0 < img.width; x0++) {
      const i = (y * img.width + x0) * 4, k = Math.floor((y * H) / img.height) * W + Math.floor((x0 * W) / img.width)
      out[k * 3] += d[i]; out[k * 3 + 1] += d[i + 1]; out[k * 3 + 2] += d[i + 2]; n[k]++
    }
    for (let k = 0; k < W * H; k++) for (let c3 = 0; c3 < 3; c3++) out[k * 3 + c3] /= n[k]
    return [...out]
  }, `data:image/png;base64,${png.toString('base64')}`)
}
/** Cells of a grid in a box of the view (fractions: left, top, right, bottom): the city below the sky, clear of the controls. */
const CITY = [0.03, 0.2, 0.72, 0.85], SKY = [0.03, 0.02, 0.72, 0.12]
const cells = (g, [l, t, r, b]) => { const out = []; for (let y = Math.floor(t * 36); y < Math.ceil(b * 36); y++) for (let x = Math.floor(l * 64); x < Math.ceil(r * 64); x++) out.push([g[(y * 64 + x) * 3], g[(y * 64 + x) * 3 + 1], g[(y * 64 + x) * 3 + 2], x, y]); return out }
const mean = (cs, f) => cs.reduce((s, c) => s + f(c), 0) / cs.length
const light = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const corr = (a, b) => { const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2 } return ab / Math.sqrt(aa * bb || 1) }

/** Frame gaps for a few seconds: p50 and p99, ms, with the march's own GPU time. */
const frames = async (page, seconds = 4) => {
  const w = await page.evaluate(async (ms) => { const e = globalThis.engine, gaps = []; const stop = e.watch((g) => gaps.push(g)); await new Promise((r) => setTimeout(r, ms)); stop(); return { gaps, gpuMs: e.gpuMs } }, seconds * 1000)
  const g = w.gaps.filter((x) => x >= 2).sort((a, b) => a - b), q = (p) => round(g[Math.min(g.length - 1, Math.floor(g.length * p))], 1)
  return { frames: g.length, p50: q(0.5), p99: q(0.99), marchMs: round(w.gpuMs, 1) }
}
/** What an egg costs: the frames with it up, then the same sky with the window screen down (the picture still drawn, the windows not asking it). */
const cost = async (page, name) => {
  const on = await frames(page)
  await page.evaluate(() => { const e = globalThis.engine; e.eggsScreenHeld = e.march.screen.up; const keep = () => { if (e.eggsScreenHeld !== undefined) e.march.screen.up = 0 }; e.eggsKeep = e.watch(keep) })
  await page.waitForTimeout(800)
  const off = await frames(page)
  await page.evaluate(() => { const e = globalThis.engine; e.eggsKeep(); delete e.eggsScreenHeld })
  results[name] = { ...(results[name] ?? {}), frames: on, sameSkyNoScreen: off }
  console.log(`  ${name} frames: ${JSON.stringify(on)}; same sky, no screen: ${JSON.stringify(off)}`)
  // Measured beside other lanes' checks on one GPU: only a gross cost fails (the screen is a texel read per window pixel).
  return on.p50 <= off.p50 * 1.25 + 2
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await open(context)
  check(page.said.some((t) => t.includes('General Kenobi') && t.includes('not hiring')), 'the console greets: Hello there, General Kenobi, the ASCII park and the resume line')
  await settle(page)
  const before = await grid(page, 'before')
  const day = await frames(page)
  results.arrival = { frames: day }
  console.log(`  arrival frames: ${JSON.stringify(day)}`)

  // ── Sound is the visitor's to start: an egg started with no press plays muted, and Unmute is the press ──
  console.log('\nsound refused (simulated)')
  await page.evaluate(() => { globalThis.refuseSound = true; globalThis.engine.eggs.say('bad apple') })
  /** Until the video really plays (its clock past a third of a second) or its sound was refused, or it ended. */
  const begun = () => page.waitForFunction(() => { const s = globalThis.engine.eggs.state; return s.blocked || s.time > 0.3 || !s.running }, null, { timeout: 30_000 }).catch(() => null)
  await begun()
  await page.waitForFunction(() => globalThis.engine.eggs.state.time > 0.3, null, { timeout: 10_000 }).catch(() => null)
  let s = await state(page)
  const player = () => page.evaluate(() => { const p = document.querySelector('.egg-player'), r = p.getBoundingClientRect(), m = globalThis.engine.eggs.media; return { hidden: p.hidden, display: getComputedStyle(p).display, box: [r.x, r.y, r.width, r.height].map(Math.round), media: m && { paused: m.paused, ended: m.ended, error: m.error?.code ?? null, src: !!m.src } } })
  check(s.running === 'apple' && s.time > 0 && s.muted && s.blocked, `refused its sound, Bad Apple!! plays muted (${JSON.stringify({ running: s.running, time: round(s.time), muted: s.muted, blocked: s.blocked, status: s.status })})`)
  if (!(s.muted && s.blocked)) console.log('   ', JSON.stringify(await player()), page.said.slice(-6).join(' | '))
  check(await page.locator('.egg-player .mute').textContent() === 'Unmute', 'the player offers Unmute')
  try {
    await page.evaluate(() => { globalThis.refuseSound = false })
    await page.click('.egg-player .mute', { timeout: 5000 })
    await page.waitForTimeout(2500)
    s = await state(page)
    check(s.playing && !s.muted && s.sound > 0, `Unmute (a press) brings the sound: playing, unmuted, ${s.sound} bytes of sound decoded`)
    await page.click('.egg-player .stop', { timeout: 5000 })
    await page.waitForTimeout(300)
    check((await state(page)).running === null, 'Stop on the player ends it')
  } catch (e) {
    check(false, `the player's keys: ${String(e.message).split('\n')[0]} ${JSON.stringify(await player())}`)
    await page.evaluate(() => globalThis.engine.eggs.undo(true))
  }
  await still(page)

  // ── The Matrix, from the line: the board shows what is typed; code rain on the windows, a green night in fog ──
  console.log('\nthe Matrix')
  await page.keyboard.press('Enter')
  await page.keyboard.type('wake up', { delay: 25 })
  s = await state(page)
  check(s.typing && s.signs.support === '> wake up_', `what is typed shows on the board as it is typed ("${s.signs.support}")`)
  const walked = await page.evaluate(() => globalThis.engine.pose.x)
  await page.keyboard.press('Enter')
  check(await page.evaluate((x) => globalThis.engine.pose.x === x, walked), 'typing on the line moves nobody (W, A, S and D were letters)')
  await started(page, 'matrix')
  await still(page)
  s = await state(page)
  check(s.running === 'matrix' && s.up === 1 && s.weather === 'fog' && s.hour > 22, `the Matrix is up: the screen ${s.up}, ${s.weather}, ${round(s.hour)} h; banner "${s.signs.banner}", board "${s.signs.support}"`)
  const m1 = await grid(page, 'matrix'), m2 = (await page.waitForTimeout(400), await grid(page))
  const city0 = cells(before, CITY), city1 = cells(m1, CITY), city2 = cells(m2, CITY)
  const green = (cs) => mean(cs, (c) => c[1] - (c[0] + c[2]) / 2)
  check(green(city1) > green(city0) + 6, `the city's windows went green: green over red and blue ${round(green(city0), 1)} before, ${round(green(city1), 1)} in the Matrix`)
  const moved = mean(city1.map((c, i) => [c, city2[i]]), ([a, b]) => Math.abs(light(a) - light(b)))
  check(moved > 0.4, `the code falls: the city's light moved ${round(moved)} a cell in 0.4 s`)
  check(await cost(page, 'matrix'), 'the Matrix costs no more than a quarter more than its sky without the screen')
  await sayTo(page, 'blue pill')
  await page.waitForTimeout(400)
  s = await state(page)
  check(s.running === null && s.signs.banner === null, `"blue pill" leaves it (${s.running}), the signs are their own again`)
  await still(page)
  await page.waitForFunction(() => globalThis.engine.hour === null, null, { timeout: 20_000 }).catch(() => null)
  s = await state(page)
  const after = await grid(page, 'after-matrix'), lit0 = mean(city0, light), lit1 = mean(cells(after, CITY), light)
  check(s.hour === null && s.weather === 'clear' && s.up === 0 && Math.abs(lit1 - lit0) < Math.max(4, lit0 * 0.06), `the park as it was: the realm's own light (hour ${s.hour}), ${s.weather}, the city's light ${round(lit0, 1)} then ${round(lit1, 1)}`)

  // ── Bad Apple!!, from the line, with sound: the windows follow the frame held on them ──
  console.log('\nBad Apple!!')
  await sayTo(page, 'bad apple')
  await started(page, 'apple')
  await begun()
  await page.waitForTimeout(2500)
  s = await state(page)
  check(s.running === 'apple' && s.playing && !s.muted && s.sound > 0, `typed, it plays with its sound: ${s.sound} bytes decoded`)
  await still(page)
  check(await cost(page, 'bad-apple'), 'Bad Apple!! costs no more than a quarter more than its sky without the screen')
  const follows = async (at, name) => {
    await page.evaluate((t) => globalThis.engine.eggs.hold(t), at)
    await page.waitForFunction((t) => { const m = globalThis.engine.eggs.media; return m && !m.seeking && Math.abs(m.currentTime - t) < 0.2 }, at, { timeout: 10_000 }).catch(() => null)
    await page.waitForTimeout(700)
    // The picture the windows are given (march.screen), as the same grid.
    const pic = await page.evaluate(async () => {
      const e = globalThis.engine, d = e.gpu.device, t = e.march.screen.texture, b = d.createBuffer({ size: t.width * t.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = d.createCommandEncoder(); enc.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: t.width * 4 }, [t.width, t.height]); d.queue.submit([enc.finish()])
      await b.mapAsync(GPUMapMode.READ); const px = new Uint8Array(b.getMappedRange()), out = new Float32Array(64 * 36), n = new Float32Array(64 * 36)
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) { const k = Math.floor((y * 36) / t.height) * 64 + Math.floor((x * 64) / t.width), i = (y * t.width + x) * 4; out[k] += px[i]; n[k]++ }
      b.unmap(); return [...out].map((v, k) => v / n[k])
    })
    const shot = cells(await grid(page, name), CITY)
    const r = corr(shot.map(light), shot.map((c) => pic[c[4] * 64 + c[3]]))
    return r
  }
  const r1 = await follows(62, 'bad-apple'), r2 = await follows(95, 'bad-apple-2')
  results['bad-apple'].follows = [round(r1), round(r2)]
  check(r1 > 0.25 && r2 > 0.25, `the windows' light follows the frame held on them: correlation ${round(r1)} at 62 s, ${round(r2)} at 95 s`)
  await page.evaluate(() => globalThis.engine.eggs.hold(null))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  s = await state(page)
  check(s.running === null && !s.playing, 'Esc ends it')
  await still(page)

  // ── The knock-knock on the banner: it ends in the Rickroll, with sound ──
  console.log('\nknock knock, and the Rickroll')
  await page.evaluate(() => globalThis.engine.eggs.knock())
  s = await state(page)
  check(s.signs.banner === 'Knock knock', `the banner asks: "${s.signs.banner}"`)
  await sayTo(page, "who's there?")
  s = await state(page)
  check(s.signs.banner === 'Never gonna', `"who's there?" and the banner says "${s.signs.banner}"`)
  await sayTo(page, 'never gonna who?')
  await started(page, 'rickroll')
  await begun()
  await page.waitForTimeout(2500)
  s = await state(page)
  check(s.running === 'rickroll' && s.playing && !s.muted && s.sound > 0, `"never gonna who?" and Rick is on every window, with his sound (${s.sound} bytes decoded); banner "${s.signs.banner}"`)
  await still(page)
  await page.evaluate(() => globalThis.engine.eggs.hold(20))
  await page.waitForTimeout(1200)
  const rick = cells(await grid(page, 'rickroll'), CITY)
  check(mean(rick, light) > mean(city0, light) * 0.25, `the windows show him: the city's light ${round(mean(rick, light), 1)}`)
  await page.evaluate(() => globalThis.engine.eggs.hold(null))
  check(await cost(page, 'rickroll'), 'the Rickroll costs no more than a quarter more than its sky without the screen')
  await sayTo(page, 'stop')
  await page.waitForTimeout(300)
  check((await state(page)).running === null, '"stop" ends it')
  await still(page)

  // ── The moon: night, and a tool used at it makes it grow ──
  console.log('\nthe moon')
  await sayTo(page, 'moon')
  await page.waitForFunction(() => globalThis.engine.realmControls.sky.hour > 23, null, { timeout: 10_000 }).catch(() => null)
  await still(page)
  // From 150 m over the park: from the park itself a tower stands between the eye and the moon.
  const aim = await page.evaluate(() => { const e = globalThis.engine, [x, y, z] = e.march.sun.s; const yaw = Math.atan2(x, -z), pitch = Math.asin(y / Math.hypot(x, y, z)); e.pose.y += 150; e.pose.yaw = yaw; e.pose.pitch = pitch; return { yaw, pitch } })
  await page.waitForTimeout(800)
  const disc = (g) => cells(g, [0.4, 0.38, 0.6, 0.62]).filter((c) => light(c) > 150).length
  const moon1 = disc(await grid(page, 'moon-1'))
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForTimeout(600)
  const moon2 = disc(await grid(page, 'moon-2'))
  s = await state(page)
  check(s.moon === 1 && moon2 > moon1 * 1.8, `shot, the moon grows: ${moon1} bright cells, then ${moon2} (size ${s.moon + 1} of 3)`)
  results.moon = { aim, cells: [moon1, moon2] }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const moon3 = disc(await grid(page))
  check((await state(page)).moon === 0 && moon3 < moon2, `Esc and it is its own size (${moon3} bright cells)`)
  await page.evaluate(() => { const e = globalThis.engine; e.pose.y -= 150; e.pose.yaw = 2.097982; e.pose.pitch = -0.009161 })
  await still(page)

  // ── IDDQD: no tool breaks anything; again, and they do ──
  console.log('\nIDDQD')
  const edits = () => page.evaluate(() => globalThis.engine.world.done().length)
  await page.evaluate(() => globalThis.engine.pickTool(1))
  await sayTo(page, 'iddqd')
  const e0 = await edits()
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForTimeout(2500)
  const e1 = await edits()
  s = await state(page)
  check(s.shield && e1 === e0 && s.signs.banner === 'God mode', `under IDDQD a charge breaks nothing (${e0} edits, then ${e1}); banner "${s.signs.banner}"`)
  await sayTo(page, 'iddqd')
  await page.evaluate(() => globalThis.engine.input.use())
  await page.waitForFunction((n) => globalThis.engine.world.done().length > n, e1, { timeout: 15_000 }).catch(() => null)
  const e2 = await edits()
  check(!(await state(page)).shield && e2 > e1, `said again, a charge breaks things (${e2} edits)`)

  // ── Reset ends an egg and puts the sky back ──
  console.log('\nreset')
  await sayTo(page, 'neo')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(300)
  s = await state(page)
  check(s.running === null && s.weather === 'clear', `Backspace (reset) ends the Matrix and asks the weather back (${s.weather})`)
  await page.waitForFunction(() => globalThis.engine.hour === null && globalThis.engine.world.done().length === 0, null, { timeout: 20_000 }).catch(() => null)
  check(await page.evaluate(() => globalThis.engine.hour === null && globalThis.engine.world.done().length === 0), 'the world is as it was and lit by its own light')
  await still(page)

  // ── The Konami code: +30 lives on the banner; its B does not put the eye on foot ──
  console.log('\nthe Konami code')
  const foot = await page.evaluate(() => globalThis.engine.me.on)
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k)
  s = await state(page)
  check(s.signs.banner === '+30 lives' && (await page.evaluate(() => globalThis.engine.me.on)) === foot, `↑↑↓↓←→←→BA: banner "${s.signs.banner}", still ${foot ? 'on foot' : 'flying'}`)
  await page.keyboard.press('Escape')
  check((await state(page)).signs.banner === null, 'Esc gives the banner back')

  // ── The hour swung across dusk four times in four seconds: Bad Apple!! ──
  console.log('\nfour swings of the hour')
  for (const h of [21, 12, 21, 12]) { await page.evaluate((v) => { globalThis.engine.hour = v }, h); await page.waitForTimeout(250) }
  s = await state(page)
  check(s.running === 'apple', `black and white and black and white: ${s.running}`)
  await page.keyboard.press('Escape')

  // ── A barrel roll, and a line the city does not know ──
  console.log('\nthe rest')
  const yaw0 = await page.evaluate(() => globalThis.engine.pose.yaw)
  await sayTo(page, 'do a barrel roll')
  await page.waitForTimeout(400)
  const yawMid = await page.evaluate(() => globalThis.engine.pose.yaw)
  await page.waitForTimeout(800)
  const yaw1 = await page.evaluate(() => globalThis.engine.pose.yaw)
  check(Math.abs(yawMid - yaw0) > 0.5 && Math.abs(yaw1 - yaw0 - Math.PI * 2) < 0.01, `a barrel roll: the eye turns round once (${round(yaw1 - yaw0)} rad)`)
  await page.evaluate((y) => { globalThis.engine.pose.yaw = y }, yaw0)
  await sayTo(page, 'open sesame')
  s = await state(page)
  check(s.running === null && /no such thing/.test(s.signs.support ?? ''), `a line it does not know is answered on the board ("${s.signs.support}")`)
  await sayTo(page, 'xyzzy')
  s = await state(page)
  check(/Try: wake up/.test(s.signs.support ?? ''), `two misses and the board gives a hint ("${s.signs.support}")`)

  check(page.errors.length === 0, `no errors on the page${page.errors.length ? `: ${page.errors.slice(0, 3).join(' | ')}` : ''}`)
} catch (e) {
  console.error(e)
  failures.push(String(e))
} finally {
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1))
  await browser.close()
  back()
  site.close?.()
}
console.log(failures.length ? `\n${failures.length} failed:\n  ${failures.join('\n  ')}` : '\nall eggs ok')
process.exit(failures.length ? 1 : 0)
