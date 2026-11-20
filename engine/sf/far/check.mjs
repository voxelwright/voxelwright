// The far model in the SF realm, measured (#450): the static folder `node sf/build.mjs` writes, served as plain
// files, opened in Chrome with WebGPU, from four eyes:
//   - park: the Ina Coolbrith Park camera at the photograph's own size, with each pixel's building beside the
//     picture, for sf/far/measure.py to lay over the photograph (#423's overlay measures);
//   - downtown: 150 m over California St, looking back at the park;
//   - pyramid: the Transamerica Pyramid from behind, from over the Bay 1.4 km east of it;
//   - street: at a person's height on California St, looking down it to the Bay.
// For each it says the faces drawn, the far model's bytes held and fetched, and the GPU's ms a frame for the march
// alone and with the far model (paired at full size). Pictures go to ~/.village/engine/sf/far/.
//
//   node sf/far/check.mjs [--no-build] [--far <dir>] [--only park,street] [--name run] [--query "&farreach=800"] [--night] [--quiet]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, constants } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from '../../test/kit.mjs'
import { plain } from '../../player/serve.mjs'

const dist = join(here, 'dist-sf'), out = join(homedir(), '.village', 'engine', 'sf', 'far'), name = arg('name', 'run')
mkdirSync(join(out, 'shots'), { recursive: true })
if (!has('no-build')) {
  const built = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), ...(arg('far') ? ['--far', arg('far')] : [])], { cwd: here, encoding: 'utf8' })
  if (built.status !== 0) { console.error(built.stdout + built.stderr); process.exit(1) }
  console.log(built.stdout.trim())
}

// Metres east and south of the frame's corner, and the look: bearing and pitch in degrees.
const VIEWS = {
  park: { size: [2018, 864], fov: null },
  downtown: { size: [1280, 720], fov: 70, at: [52440, 150, 66990], look: [301.8, -6] },
  pyramid: { size: [1280, 720], fov: 40, at: [54000, 120, 66900], look: [276.4, -0.5] },
  street: { size: [1280, 720], fov: 70, at: [51800, null, 67130], look: [80.6, -1.5] },
}
const squeezed = new Map()
const brotli = (path) => { let n = squeezed.get(path); if (n === undefined) { n = brotliCompressSync(readFileSync(join(dist, 'sf', path)), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length; squeezed.set(path, n) } return n }
const only = arg('only', Object.keys(VIEWS).join(',')).split(',')

const site = await plain(dist, '127.0.0.1')
// `--quiet`: every turn on the GPU, so that no other lane's check draws beside the timing (kit.mjs `quiet`).
const back = has('quiet') ? await quiet() : await turn()
const browser = await chromium.launch(CHROME)
const results = {}
for (const key of only) {
  const view = VIEWS[key]
  const context = await browser.newContext({ viewport: { width: view.size[0], height: view.size[1] }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if ((m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) || (m.type() === 'warning' && /match|Invalid|invalid|Error/.test(m.text()))) errors.push(m.text().slice(0, 300)) })
  const at = view.at ? `&at=${view.at.map((v) => v ?? 0).join(',')}&look=${view.look.join(',')}&fov=${view.fov}&roll=0` : ''
  const night = has('night') ? '&hour=22' : ''
  const url = `${site.url}/sf/index.html?scale=1&sound=0&people=0${at}${night}${arg('query', '')}`
  const began = Date.now()
  await page.goto(url)
  await page.waitForFunction(() => globalThis.engine?.far && globalThis.engine?.farIds, null, { timeout: 180_000 })
  if (view.at && view.at[1] === null) {
    // At a person's height over the street.
    await page.evaluate(() => { engine.pose.y = engine.ground(engine.pose.x, engine.pose.z) + 1.7 })
  }
  const whole = await page.waitForFunction(() => engine.world.stats.wanted === 0 && engine.world.stats.stale === 0 && engine.far.whole && engine.far.stats.coming === 0, null, { timeout: 420_000 }).then(() => true, () => false)
  const ready = Date.now() - began
  await page.waitForTimeout(2500)
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #credit { display: none }' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(out, 'shots', `${name}-${key}.png`) })
  const said = await page.evaluate(async (size) => {
    const bytes = await engine.farIds(size)
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const cost = await engine.farPasses(5)
    return { ids: btoa(text), cost, pose: { ...engine.pose }, fov: engine.fov, held: engine.far.held() }
  }, view.size)
  writeFileSync(join(out, 'shots', `${name}-${key}-ids.rgba`), Buffer.from(said.ids, 'base64'))
  // What the far model held here as a host would send it: Brotli 5, as the release counts it (release.md).
  const br = said.held.reduce((n, path) => n + brotli(path), 0)
  const r = { whole, heldBrotliMB: +(br / 1048576).toFixed(1), readyMs: ready, url, pose: said.pose, fov: said.fov, size: view.size, march: said.cost.march, withFar: said.cost.withFar, farMs: +(said.cost.withFar - said.cost.march).toFixed(2), faces: said.cost.faces, sections: said.cost.sections, tilesDrawn: said.cost.tiles, heldFaces: said.cost.held, heldMB: +(said.cost.heldBytes / 1048576).toFixed(1), fetched: said.cost.fetched, fetchedMB: +(said.cost.fetchedBytes / 1048576).toFixed(1), covered: said.cost.covered, errors }
  results[key] = r
  console.log(key, JSON.stringify(r))
  await context.close()
}
writeFileSync(join(out, 'shots', `${name}.json`), JSON.stringify(results, null, 1))
await browser.close()
back?.()
process.exit(0)
