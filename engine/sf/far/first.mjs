// The park as it is first shown (#450): the static folder `node sf/build.mjs` writes, served as a host would (Brotli
// where taken), opened cold on a link of `--mbit` (25 Mbit/s, 40 ms) at the photograph's size. The moment the page
// says the park is shown (engine.seen.near, as test/sf.mjs times it), the link is cut, so nothing more comes; then
// the picture and each pixel's far building are kept and laid over the photograph (measure.py, as check.mjs does).
// It says what crossed the wire until then by folder of the release, and how many named buildings stand.
//
//   node sf/far/first.mjs [--name now] [--mbit 25] [--size 2018x864] [--query "&farlanding=/sf/landing/landing.json"]
// Pictures go to ~/.village/engine/sf/far/load/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, here, turn } from '../../test/kit.mjs'
import { plain } from '../../player/serve.mjs'

const dist = join(here, 'dist-sf'), out = join(homedir(), '.village', 'engine', 'sf', 'far', 'load'), name = arg('name', 'now'), mbit = Number(arg('mbit', '25'))
const [w, h] = arg('size', '2018x864').split('x').map(Number)
mkdirSync(out, { recursive: true })
const site = await plain(dist, '127.0.0.1')
const back = await turn()
const browser = await chromium.launch(CHROME)
try {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
  await page.goto(`${site.url}/sf/index.html?sound=0&people=0${arg('query', '')}`)
  await page.waitForFunction(() => globalThis.engine?.seen?.near > 0, null, { timeout: 240_000, polling: 'raf' })
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  const t = await page.evaluate(() => ({ origin: performance.timeOrigin, ...globalThis.engine.seen, far: { ...globalThis.engine.far.stats } }))
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #credit { display: none }' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, `${name}-park.png`) })
  const ids = await page.evaluate(async (size) => {
    const bytes = await globalThis.engine.farIds(size)
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(text)
  }, [w, h])
  writeFileSync(join(out, `${name}-park-ids.rgba`), Buffer.from(ids, 'base64'))
  // What was asked for until the park was shown, by the release's folder (tiles/, far/, names/, …) or the page's own.
  const until = t.origin + t.near, folders = {}
  for (const a of site.asked) {
    if (a.status !== 200 || a.at > until) continue
    const m = a.path.match(/\/releases\/[0-9a-f]{64}\/([^/]+)\//), key = m ? m[1] : a.path.startsWith('/sf/releases/') ? 'manifest' : a.path.startsWith('/sf/landing/') ? 'landing (staged)' : 'page'
    const f = (folders[key] ??= { files: 0, wireMB: 0, rawMB: 0 })
    f.files++; f.wireMB += a.wire / 1048576; f.rawMB += a.bytes / 1048576
  }
  for (const f of Object.values(folders)) { f.wireMB = +f.wireMB.toFixed(2); f.rawMB = +f.rawMB.toFixed(2) }
  const wireMB = +Object.values(folders).reduce((n, f) => n + f.wireMB, 0).toFixed(2)
  const py = process.env.PY ?? join(homedir(), '.village', 'engine', 'landing', 'ina', 'venv', 'bin', 'python')
  const measured = spawnSync(py, ['-B', '-W', 'ignore', join(here, 'sf/far/measure.py'), join(out, `${name}-park-ids.rgba`), `${w}x${h}`, '--leave', '1400,0,2000,130', '--json', join(out, `${name}-park-measure.json`), '--picture', join(out, `${name}-park.png`), '--out', join(out, `${name}-park-overlay.jpg`)], { encoding: 'utf8' })
  const line = measured.stdout.split('\n').find((l) => l.startsWith('{'))
  const r = { link: `${mbit} Mbit/s, 40 ms`, size: [w, h], shownMs: Math.round(t.near), firstFrameMs: Math.round(t.first), wireMB, folders, far: t.far, overlay: line ? JSON.parse(line) : { failed: measured.stderr.slice(-300) } }
  writeFileSync(join(out, `${name}.json`), JSON.stringify(r, null, 1))
  console.log(JSON.stringify(r, null, 1))
} finally {
  await browser.close()
  site.stop()
  back?.()
}
