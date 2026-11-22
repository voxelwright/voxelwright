// The landing's pictures and its clip (#450): the SF realm's first view as a visitor meets it, for looking at.
//
//   node sf/landing-shots.mjs [--no-build] [--dist dist-sf] [--out ~/.village/engine/sf/landing6] [--no-clip] [--only clip] [--tag first]
//
// Stills, into <out>: the first view at 1280 x 720 and on an upright phone (390 x 844, three pixels to one) by day
// and by night (`<tag>-…`, so that another build's can be kept beside them), the controls shown at both sizes, the
// big tree of the left foreground by night, dusk coming at the park (`dusk-<hour>.png`, an hour at a time from 17 to
// 21), downtown close by at night, a logo close by at night and by day. The clip (<out>/landing6.mp4, 30 s at
// 1280 x 720): the park from the late afternoon into the night, the hour run from 16.5 to 21.5 over 24 s and the
// night held. Filmed with every turn on the GPU held (`quiet`) from its page coming up, so nothing else draws beside it;
// the stills take one turn like any check.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf')), out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'landing6')), only = arg('only', ''), tag = arg('tag', 'first')
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
mkdirSync(out, { recursive: true })
const site = await plain(dist, '127.0.0.1', 0, {}), back = await turn(), browser = await chromium.launch(CHROME)
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
    for (const size of [[390, 844], [1280, 720]]) {
      const phone = size[0] < 600, name = size.join('x')
      const { context, page } = await open(phone ? { viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: size[0], height: size[1] } })
      await readable(page)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(out, `${tag}-${name}.png`) })
      if (!phone) await page.screenshot({ path: join(out, 'tree-after.png'), clip: { x: 100, y: 420, width: 360, height: 280 } })
      // The same by night: the plane held where it is, the hour set, the lights given time to come.
      await page.evaluate(() => { const p = globalThis.engine.boards.plane; p.hold = p.phase; globalThis.engine.hour = 21.5 })
      await page.waitForTimeout(6000)
      await page.screenshot({ path: join(out, `${tag}-night-${name}.png`) })
      if (!phone) await page.screenshot({ path: join(out, 'tree-night.png'), clip: { x: 100, y: 420, width: 360, height: 280 } })
      /** The controls shown, by night: no sign under any of them. */
      const engaged = async () => { await page.evaluate(() => globalThis.engine.first.engage()); await page.waitForTimeout(3500); await page.screenshot({ path: join(out, `explore-night-${name}.png`) }) }
      if (phone && !has('only-first')) await engaged()
      if (!phone && !has('only-first')) {
        // Dusk coming at the park, an hour at a time.
        const park = await page.evaluate(() => ({ ...globalThis.engine.pose }))
        for (const hour of [17, 18, 19, 20, 21]) {
          await page.evaluate((h) => { globalThis.engine.hour = h }, hour)
          await page.waitForTimeout(4000)
          await page.screenshot({ path: join(out, `dusk-${hour}.png`) })
        }
        // Downtown close by at night: 700 m on along the park's own look, 40 m higher.
        await page.evaluate((p) => { const e = globalThis.engine; e.hour = 21.5; Object.assign(e.pose, { x: p.x + Math.sin(p.yaw) * 700, y: p.y + 40, z: p.z - Math.cos(p.yaw) * 700 }) }, park)
        await page.waitForTimeout(9000)
        await page.screenshot({ path: join(out, 'downtown-night.png') })
        await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), park)
        await page.waitForTimeout(4000)
        await engaged()
        await page.evaluate(() => { globalThis.engine.hour = 15 })
        await page.waitForTimeout(3500)
        await page.screenshot({ path: join(out, 'explore-1280x720.png') })
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
      }
      await context.close()
    }
    console.log(`stills in ${out}`)
  }
  if (!has('no-clip')) {
    // ── The clip ──
    const raw = join(out, 'raw')
    rmSync(raw, { recursive: true, force: true })
    // Every turn, from the clip's page coming up (nothing of this process draws while `quiet` may wait).
    const alone = await quiet()
    const { context, page, from } = await open({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: raw, size: { width: 1280, height: 720 } } })
    const wait = (ms) => page.waitForTimeout(ms)
    // From where the banner comes into its near pass, in the late afternoon; then the hour run on into the night.
    await page.evaluate(() => { const p = globalThis.engine.boards.plane; p.call(false); p.begin(); globalThis.engine.hour = 16.5 })
    await wait(2500)
    const begins = (Date.now() - from) / 1000
    await wait(1500)
    await page.evaluate(() => new Promise((done) => { const began = performance.now(), step = () => { const t = Math.min(1, (performance.now() - began) / 24000); globalThis.engine.hour = 16.5 + 5 * t; if (t < 1) requestAnimationFrame(step); else done() }; step() }))
    await wait(4500)
    const ends = (Date.now() - from) / 1000
    await context.close()
    alone()
    const webm = readdirSync(raw).find((f) => f.endsWith('.webm'))
    renameSync(join(raw, webm), join(raw, 'landing.webm'))
    const cut = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', begins.toFixed(2), '-t', (ends - begins).toFixed(2), '-i', join(raw, 'landing.webm'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', '30', join(out, 'landing6.mp4')], { encoding: 'utf8' })
    console.log(cut.status === 0 ? `clip ${join(out, 'landing6.mp4')}, ${(ends - begins).toFixed(1)} s` : `the raw clip is ${join(raw, 'landing.webm')} (ffmpeg: ${cut.stderr || cut.error?.message})`)
  }
} finally { await browser.close(); site.stop(); back() }
