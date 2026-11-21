// The landing's pictures and its clip (#450): the SF realm's first view as a visitor meets it, for looking at.
//
//   node sf/landing-shots.mjs [--no-build] [--dist dist-sf] [--out ~/.village/engine/sf/landing4] [--no-clip] [--only clip]
//
// Stills, into <out>: the first view at 1280 x 720 and on an upright phone (390 x 844, three pixels to one), the big
// tree of the left foreground, a logo close by at night, the knock-knock on the banner. The clip (<out>/landing.mp4,
// about 36 s at 1280 x 720): the first view, Explore, a flight to a logo and back, the Matrix coming over and its two
// lines on the banner, and out again. Filmed with every turn on the GPU held (`quiet`), so nothing else draws beside it.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'landing4')), only = arg('only', '')
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(out, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0, {}), back = await quiet(), browser = await chromium.launch(CHROME)
/** A page of the realm at a size, shown and whole, its banner's cloth readable (its plane is kept in the first view). */
const open = async (options, query = 'knock=0') => {
  const context = await browser.newContext(options), page = await context.newPage(), from = Date.now()
  await page.goto(`${site.url}/sf/index.html?${query}`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far.whole, null, { timeout: 300_000 })
  await page.waitForTimeout(3000)
  return { context, page, from }
}
/** Until the banner can be read with a few seconds of its pass still before it (well inside the picture). */
const readable = (page, ms = 60_000) => page.waitForFunction(() => { const p = globalThis.engine.boards.plane, b = p.box; return p.readable && b && b.x0 > innerWidth * 0.12 && b.x1 < innerWidth * 0.9 }, null, { timeout: ms }).catch(() => null)
try {
  if (only !== 'clip') {
    // ── Stills ──
    const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    await readable(phone.page)
    await phone.page.screenshot({ path: join(out, 'first-390x844.png') })
    await phone.context.close()
    const { context, page } = await open({ viewport: { width: 1280, height: 720 } })
    await readable(page)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: join(out, 'first-1280x720.png') })
    await page.screenshot({ path: join(out, 'tree-after.png'), clip: { x: 100, y: 420, width: 360, height: 280 } })
    // The knock-knock: the city starts it on the banner.
    await page.evaluate(() => { globalThis.engine.first.engage(); globalThis.engine.eggs.knock() })
    await readable(page)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(out, 'knock-knock.png') })
    await page.keyboard.press('Escape')
    // A logo close by at night, and by day.
    await page.evaluate(() => { globalThis.engine.hour = 21.5 })
    for (const id of ['linkedin', 'twitch', 'x']) {
      await page.evaluate((id) => globalThis.engine.boards.fly(id), id)
      await page.waitForTimeout(7000)
      await page.screenshot({ path: join(out, `logo-night-${id}.png`) })
    }
    await page.evaluate(() => { globalThis.engine.hour = 15 })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(out, 'logo-day-x.png') })
    await context.close()
    console.log(`stills in ${out}`)
  }
  if (!has('no-clip')) {
    // ── The clip ──
    const raw = join(out, 'raw')
    rmSync(raw, { recursive: true, force: true })
    const { context, page, from } = await open({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: raw, size: { width: 1280, height: 720 } } })
    const wait = (ms) => page.waitForTimeout(ms)
    // From where the banner comes into its near pass.
    await page.evaluate(() => { const p = globalThis.engine.boards.plane; p.call(false); p.begin() })
    await wait(600)
    const begins = (Date.now() - from) / 1000
    await wait(6500)
    const key = await page.locator('#first .explore').boundingBox()
    await page.mouse.move(key.x + key.width / 2, key.y + key.height / 2, { steps: 20 })
    await page.mouse.down(); await wait(120); await page.mouse.up()
    await wait(2200)
    await page.evaluate(() => globalThis.engine.boards.fly('linkedin'))
    await wait(5200)
    const park = await page.evaluate(() => globalThis.engine.local.arrive)
    await page.evaluate((a) => Object.assign(globalThis.engine.pose, { x: a.at[0] / 10, y: a.at[1] / 10, z: a.at[2] / 10, yaw: a.yaw, pitch: a.pitch }), park)
    await wait(1800)
    await page.keyboard.press('Enter'); await page.keyboard.type('wake up', { delay: 70 }); await page.keyboard.press('Enter')
    // Its first line, read; then its second.
    await page.waitForFunction(() => globalThis.realm.signs.list().find((x) => x.id === 'banner')?.content?.text === 'Red pill or blue pill?', null, { timeout: 60_000 }).catch(() => null)
    await readable(page, 20_000)
    await wait(3200)
    await page.keyboard.press('Escape')
    await wait(3000)
    const ends = (Date.now() - from) / 1000
    await context.close()
    const webm = readdirSync(raw).find((f) => f.endsWith('.webm'))
    renameSync(join(raw, webm), join(raw, 'landing.webm'))
    const cut = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', begins.toFixed(2), '-t', (ends - begins).toFixed(2), '-i', join(raw, 'landing.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', '30', join(out, 'landing4.mp4')], { encoding: 'utf8' })
    console.log(cut.status === 0 ? `clip ${join(out, 'landing4.mp4')}, ${(ends - begins).toFixed(1)} s` : `the raw clip is ${join(raw, 'landing.webm')} (ffmpeg: ${cut.stderr || cut.error?.message})`)
  }
} finally { await browser.close(); site.stop(); back() }
