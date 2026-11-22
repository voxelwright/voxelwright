// The way into the SF realm, for looking at (#450, page/explore.ts): the first view with its EXPLORE board, the board
// asked once, the flight and the round, the view from behind the shoulder with what the roof is for, a fall off the
// edge and a canopy down to the street.
//
//   node sf/explore-shots.mjs [--no-build] [--dist dist-sf] [--out ~/.village/engine/sf/explore] [--no-clip] [--only clip|stills|phone]
//
// Stills, into <out>: `first-…` at 1280 x 720 and on an upright phone (390 x 844, three pixels to one), `armed-…` at
// both, `flight-…` through the flight and the round, `third-…` from behind the shoulder at both, `fall-…`, `canopy-…`
// and `landed-…`, and `still-…` where motion is not wanted (the first view fading into the roof's).
// The clip (<out>/explore.mp4, 1280 x 720): from the park to a canopy's landing. Filmed with every turn on the GPU
// held (`quiet`) from its page coming up, so nothing else draws beside it; the stills take one turn like any check.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'explore')), only = arg('only', '')
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(out, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0, {}), back = await turn(), browser = await chromium.launch(CHROME)
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, WIDE = { viewport: { width: 1280, height: 720 } }
/** A page of the realm, shown and whole, the way in fetched, the banner in sight. */
const open = async (options) => {
  const context = await browser.newContext(options), page = await context.newPage(), from = Date.now()
  await page.goto(`${site.url}/sf/index.html?knock=0`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far.whole && globalThis.engine.explore, null, { timeout: 300_000 })
  await page.waitForFunction(() => { const p = globalThis.engine.boards.plane, b = p.box; return p.readable && b && b.x0 > innerWidth * 0.1 && b.x1 < innerWidth * 0.92 }, null, { timeout: 60_000 }).catch(() => null)
  await page.waitForTimeout(2500)
  return { context, page, from }
}
const board = (page) => page.evaluate(() => { const w = globalThis.engine.boards.where('explore'); return [w.x, w.y] })
const state = (page) => page.evaluate(() => globalThis.engine.explore.state)
const settled = (page) => page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet, null, { timeout: 60_000 })
/** Walks the body off the roof's edge, forward as it looks, at a run, and waits until it is 7 m down: well into the fall. */
const off = async (page, phone) => {
  if (phone) await page.evaluate(() => { globalThis.engine.input.hold('ShiftLeft', true); globalThis.engine.input.hold('KeyW', true) })
  else { await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW') }
  await page.waitForFunction(() => globalThis.engine.me.aloft && globalThis.engine.me.feet.at[1] < globalThis.engine.explore.roof - 70, null, { timeout: 20_000 })
}
try {
  for (const options of [WIDE, PHONE]) {
    const phone = options === PHONE, name = `${options.viewport.width}x${options.viewport.height}`
    if (only === 'clip' || (only === 'phone' && !phone) || (only === 'wide' && phone)) continue
    const { context, page } = await open(options)
    await page.screenshot({ path: join(out, `first-${name}.png`) })
    // The same by night, asked and not.
    await page.evaluate(() => { globalThis.engine.hour = 21.5 })
    await page.waitForTimeout(6500)
    await page.screenshot({ path: join(out, `first-night-${name}.png`) })
    { const [x, y] = await board(page); if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y) }
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(out, `armed-night-${name}.png`) })
    if (phone) await page.touchscreen.tap(20, 400); else await page.keyboard.press('Escape')
    await page.evaluate(() => { globalThis.engine.hour = 15 })
    await page.waitForTimeout(4000)
    // Asked once.
    const [x, y] = await board(page)
    if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y)
    await page.waitForTimeout(900)
    await page.screenshot({ path: join(out, `armed-${name}.png`) })
    console.log(name, 'armed:', await state(page))
    // Asked twice: the flight, a frame every 0.45 s.
    const [x2, y2] = await board(page)
    if (phone) await page.touchscreen.tap(x2, y2); else await page.mouse.click(x2, y2)
    const t0 = Date.now()
    for (let i = 1; i <= 26 && (await state(page)) !== 'in'; i++) { await page.screenshot({ path: join(out, `flight-${name}-${String(i).padStart(2, '0')}.png`) }); await page.waitForTimeout(Math.max(0, i * 450 - (Date.now() - t0))) }
    await settled(page)
    console.log(name, 'in after', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => globalThis.engine.explore.times)))
    await page.waitForTimeout(3500)
    await page.screenshot({ path: join(out, `third-${name}.png`) })
    // Off the edge, falling free; then again under a canopy.
    await page.evaluate(() => { globalThis.engine.explore.roof = globalThis.engine.me.feet.at[1] })
    await off(page, phone)
    await page.screenshot({ path: join(out, `fall-${name}.png`) })
    // (A fall of 19 m is over in two seconds: back over the roof for the canopy.)
    if (phone) await page.evaluate(() => { globalThis.engine.input.hold('KeyW', false); globalThis.engine.input.hold('ShiftLeft', false) })
    else { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft') }
    await page.evaluate(() => { const e = globalThis.engine, s = e.explore.stand; e.me.walk(false); Object.assign(e.pose, { x: s.x / 10 + 4.5, y: e.explore.roof / 10 + 7, z: s.z / 10 + 2, yaw: s.yaw, pitch: -0.25 }); e.me.walk(true) })
    await page.waitForFunction(() => globalThis.engine.me.aloft && globalThis.engine.me.feet, null, { timeout: 10_000 })
    await page.waitForTimeout(350)
    if (phone) await page.evaluate(() => { globalThis.engine.me.canopy = true })
    else await page.keyboard.press('Space')
    await page.waitForTimeout(1400)
    console.log(name, 'canopy:', await page.evaluate(() => ({ open: globalThis.engine.me.canopy, feet: globalThis.engine.me.feet.at.map(Math.round) })))
    await page.screenshot({ path: join(out, `canopy-${name}.png`) })
    await page.waitForFunction(() => !globalThis.engine.me.aloft, null, { timeout: 30_000 }).catch(() => null)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, `landed-${name}.png`) })
    await context.close()
  }
  if (only !== 'clip' && only !== 'phone') {
    // Where motion is not wanted: no flight, the still picture over the roof's view as it fades.
    const { context, page } = await open({ ...WIDE, reducedMotion: 'reduce' })
    const [x, y] = await board(page)
    await page.mouse.click(x, y)
    await page.waitForTimeout(700)
    await page.mouse.click(x, y)
    await page.waitForFunction(() => globalThis.engine.explore.state === 'in', null, { timeout: 60_000 })
    await page.waitForTimeout(380)
    await page.screenshot({ path: join(out, 'still-fading-1280x720.png') })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, 'still-faded-1280x720.png') })
    await context.close()
  }
  if (!has('no-clip') && only !== 'stills' && only !== 'phone' && only !== 'wide') {
    const raw = join(out, 'raw')
    rmSync(raw, { recursive: true, force: true })
    // Every turn, from the clip's page coming up (nothing of this process draws while `quiet` may wait).
    const alone = await quiet()
    const { context, page, from } = await open({ ...WIDE, recordVideo: { dir: raw, size: { width: 1280, height: 720 } } })
    const wait = (ms) => page.waitForTimeout(ms)
    const begins = (Date.now() - from) / 1000
    await wait(1500)
    // The pointer to the board, asked once, a breath, asked twice.
    const [x, y] = await board(page)
    await page.mouse.move(x - 220, y + 160)
    await page.mouse.move(x, y, { steps: 30 })
    await wait(500)
    await page.mouse.click(x, y)
    await wait(1700)
    const [x2, y2] = await board(page)
    await page.mouse.click(x2, y2)
    await settled(page)
    await wait(4200)
    // Off the edge at a walk; the canopy a moment into the fall; let down onto the street under the roof, turned a little along it.
    await page.evaluate(() => { globalThis.engine.explore.roof = globalThis.engine.me.feet.at[1] })
    await page.keyboard.down('KeyW')
    await page.waitForFunction(() => globalThis.engine.me.aloft && globalThis.engine.me.feet.at[1] < globalThis.engine.explore.roof - 35, null, { timeout: 20_000 })
    await page.keyboard.up('KeyW')
    await page.keyboard.press('Space')
    await wait(900)
    await page.keyboard.down('KeyD'); await wait(1300); await page.keyboard.up('KeyD')
    await page.waitForFunction(() => !globalThis.engine.me.aloft, null, { timeout: 30_000 }).catch(() => null)
    await wait(2500)
    const ends = (Date.now() - from) / 1000
    await context.close()
    alone()
    const video = readdirSync(raw).find((f) => f.endsWith('.webm'))
    const made = spawnSync('ffmpeg', ['-y', '-ss', String(begins), '-to', String(ends), '-i', join(raw, video), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(out, 'explore.mp4')], { encoding: 'utf8' })
    if (made.status !== 0) { console.error(made.stderr.slice(-800)); renameSync(join(raw, video), join(out, 'explore.webm')) }
    console.log(`clip in ${out}: ${made.status === 0 ? 'explore.mp4' : 'explore.webm'} (${Math.round(ends - begins)} s)`)
  }
} finally { await browser.close(); site.stop(); back() }
