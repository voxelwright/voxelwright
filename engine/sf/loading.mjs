// The loader's pictures (#450, page/loading.html): the SF realm's first view, sharp, for the fog to lie over before the
// live picture takes over. The view's lens is fixed top to bottom (realm.json `fov`, and `upright.fov` for a picture
// taller than wide), so one picture wider than most windows, scaled to the window's height and centred, lies over the
// live one at any width. Each is taken at twice its size with every pixel marched (`?scale=1`) and halved, so it is as
// sharp as the city gets: the wide one 768 pixels tall and two and a half times as wide (a window wider than that has
// it mirrored at its sides), the upright one 900 square (as wide as upright goes: a picture just taller than wide).
// About 200 and 75 KB as WebP; sf/build.mjs writes each beside the page, and a visitor's page asks only for the one
// its window frames.
//
//   node sf/loading.mjs [--no-build] [--dist dist-sf]
//
// Writes sf/loading.json: { wide, upright } each { picture (a WebP data URL), sky (three colours, top to bottom, for
// the moment before the picture is decoded), skyline (where the city meets the sky across it) }, and the release
// they were taken from. Run it again when the first view changes: a new pin, the arrival, the lens, the air or the
// boards.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const dist = join(here, arg('dist', 'dist-sf'))
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
}
/** How tall each picture is, and how much it was taken larger. */
const ROWS = { wide: 768, upright: 900 }, OVER = 2
const site = await plain(dist, '127.0.0.1', 0, {}), back = await turn(), browser = await chromium.launch(CHROME)

/** The first view, whole, nothing of the page's own over it, `rows` tall and `cols` wide. */
const take = async (cols, rows) => {
  // (The upright one a pixel taller than wide, so that the page frames it upright.)
  const page = await browser.newPage({ viewport: { width: cols * OVER, height: rows * OVER + (cols === rows ? 1 : 0) } })
  await page.goto(`${site.url}/sf/index.html?scale=1`)
  await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0 && globalThis.engine.boards && globalThis.engine.far.whole, null, { timeout: 300_000 })
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' })
  await page.waitForTimeout(3000)
  const png = (await page.screenshot()).toString('base64')
  // Halved to its size (the extra row of the upright one cut off).
  const made = await page.evaluate(async ({ png, cols, rows }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const from = new OffscreenCanvas(cols, rows), g = from.getContext('2d'), w = cols, h = rows
    g.imageSmoothingQuality = 'high'
    g.drawImage(image, 0, 0, image.width, rows * 2, 0, 0, cols, rows)
    const pixels = from.getContext('2d').getImageData(0, 0, w, h).data
    // Where the city meets the sky in each hundredth of the width, as a share of the height from the top: the first
    // of a twenty-fifth of the height running that is not sky (light and blue) going down (the plane's banner is less). The loader's fog starts just under the
    // highest of them in the window and sinks from there.
    const sky = (x, y) => { const at = (y * w + x) * 4, r = pixels[at], gr = pixels[at + 1], b = pixels[at + 2]; return b > r + 30 && b > 160 && b > gr + 6 }
    const run = Math.round(h / 25), skyline = Array.from({ length: 100 }, (_, i) => {
      let top = h
      for (let x = Math.floor((i * w) / 100); x < Math.floor(((i + 1) * w) / 100); x += 2) {
        let solid = 0
        for (let y = 0; y < h; y++) { solid = sky(x, y) ? 0 : solid + 1; if (solid === run) { top = Math.min(top, y - run + 1); break } }
      }
      return Math.round((top / h) * 1000) / 1000
    })
    const row = (y) => { const s = [0, 0, 0]; for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) s[k] += pixels[(y * w + x) * 4 + k]; return `#${s.map((v) => Math.round(v / w).toString(16).padStart(2, '0')).join('')}` }
    const blob = await from.convertToBlob({ type: 'image/webp', quality: 0.72 })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let text = ''
    for (const b of bytes) text += String.fromCharCode(b)
    return { picture: `data:image/webp;base64,${btoa(text)}`, sky: [row(0), row(Math.round(h * 0.4)), row(h - 1)], skyline, size: [w, h], bytes: bytes.length }
  }, { png, cols, rows })
  await page.close()
  return made
}

try {
  const wide = await take(Math.round(ROWS.wide * 2.5), ROWS.wide), upright = await take(ROWS.upright, ROWS.upright)
  const pointer = JSON.parse(readFileSync(join(dist, 'sf/current.json'), 'utf8'))
  const file = join(here, 'sf/loading.json')
  writeFileSync(file, `${JSON.stringify({ release: pointer.release, wide, upright }, null, 2)}\n`)
  console.log(`sf/loading.json: wide ${wide.size.join(' x ')} (${Math.round(wide.bytes / 1024)} KB), upright ${upright.size.join(' x ')} (${Math.round(upright.bytes / 1024)} KB), release ${pointer.release}`)
} finally {
  await browser.close()
  back()
  site.stop()
}
