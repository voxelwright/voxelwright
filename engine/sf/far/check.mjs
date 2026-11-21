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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  // Landmarks by rule (#450, sf/heroes.json), each near, at a person's height (null: over the ground), and far.
  'gate-near': { size: [1280, 720], fov: 70, at: [46250, null, 65250], look: [305.6, 16] },
  'gate-far': { size: [1280, 720], fov: 50, at: [49500, 60, 65800], look: [295.8, 0] },
  'ferry-near': { size: [1280, 720], fov: 70, at: [53250, null, 66800], look: [54.6, 10] },
  'ferry-far': { size: [1280, 720], fov: 50, at: [55500, 60, 67500], look: [291, 0] },
  'coit-near': { size: [1280, 720], fov: 70, at: [51980, 70, 65900], look: [97.7, 8] },
  'coit-far': { size: [1280, 720], fov: 50, at: [53500, 40, 64600], look: [221.6, 1] },
  'sutro-near': { size: [1280, 720], fov: 70, at: [48480, null, 70920], look: [225.2, 30] },
  'sutro-far': { size: [1280, 720], fov: 50, at: [51100, 150, 68500], look: [227, 2] },
  'hall-near': { size: [1280, 720], fov: 70, at: [51300, null, 68520], look: [270, 12] },
  'hall-far': { size: [1280, 720], fov: 50, at: [49790, 105, 68850], look: [76.1, -1] },
  'palace-near': { size: [1280, 720], fov: 70, at: [48740, null, 65930], look: [270, 8] },
  'palace-far': { size: [1280, 720], fov: 50, at: [50200, 40, 65600], look: [258.7, -0.5] },
  // The foreground (#450): in #423's wedge through the realm's own 25 degree lens, where the far model begins 100 m off
  // (far.ts `farnear`): Grant Ave at a person's height, Chinatown from over it, and the park turned to each side of
  // the wedge (bearings 87 and 152 from its apex). The 100 m panel views (bay/neighbourhoods.json, fixed-poses.json)
  // at 70 degrees, where it does not.
  'grant-25': { size: [1280, 720], fov: 25, at: [52249.2, null, 66692.0], look: [340, 0] },
  'chinatown-over-25': { size: [1280, 720], fov: 25, at: [52249.2, 119.8, 66692.0], look: [300, -35] },
  'park-87': { size: [1280, 720], fov: 25, at: [51646.66, 85.98, 66402.26], look: [87, -3] },
  'park-152': { size: [1280, 720], fov: 25, at: [51646.66, 85.98, 66402.26], look: [152, -3] },
  'fidi-100m': { size: [960, 540], fov: 70, at: [52582.4, 103.7, 66777.5], look: [0, -90] },
  'chinatown-100m': { size: [960, 540], fov: 70, at: [52249.2, 119.8, 66692.0], look: [0, -90] },
  'russian-100m': { size: [960, 540], fov: 70, at: [51399.6, 138.0, 66113.0], look: [0, -90] },
}
const squeezed = new Map()
// The far model's paths are its listing's: beside the page (sf/far.json), or in the pinned release beside its manifest.
const pointer = JSON.parse(readFileSync(join(dist, 'sf', 'current.json'), 'utf8'))
const farBase = existsSync(join(dist, 'sf', 'far.json')) ? join(dist, 'sf') : join(dist, 'sf', pointer.manifest, '..')
const brotli = (path) => { let n = squeezed.get(path); if (n === undefined) { n = brotliCompressSync(readFileSync(join(farBase, path)), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length; squeezed.set(path, n) } return n }
// The four of round one unless asked: `--only landmarks` for the twelve landmark views, `--only foreground` for the
// foreground's, `--only all` for every one.
const FOREGROUND = ['park', 'street', 'grant-25', 'chinatown-over-25', 'park-87', 'park-152', 'fidi-100m', 'chinatown-100m', 'russian-100m']
const only = { landmarks: Object.keys(VIEWS).filter((k) => /-(near|far)$/.test(k)), foreground: FOREGROUND, all: Object.keys(VIEWS) }[arg('only', '')] ?? arg('only', 'park,downtown,pyramid,street').split(',')

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
  await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #credit, #realm { display: none !important }' })
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
  const r = { whole, heldBrotliMB: +(br / 1048576).toFixed(1), readyMs: ready, url, pose: said.pose, fov: said.fov, size: view.size, march: said.cost.march, withFar: said.cost.withFar, farMs: +(said.cost.withFar - said.cost.march).toFixed(2), fogMs: said.cost.withFog === null ? null : +(said.cost.withFog - said.cost.withFar).toFixed(2), faces: said.cost.faces, sections: said.cost.sections, tilesDrawn: said.cost.tiles, heldFaces: said.cost.held, heldMB: +(said.cost.heldBytes / 1048576).toFixed(1), fetched: said.cost.fetched, fetchedMB: +(said.cost.fetchedBytes / 1048576).toFixed(1), covered: said.cost.covered, errors }
  if (key === 'park') {
    // The skyline against the photograph (measure.py, #423's measures), leaving out the park's own tree beside the
    // eye: the lidar of 2023 has it and the photograph of 2021 has not, and it is the cells', not the far model's.
    const py = process.env.PY ?? join(homedir(), '.village', 'engine', 'landing', 'ina', 'venv', 'bin', 'python')
    const measured = spawnSync(py, ['-B', '-W', 'ignore', join(here, 'sf/far/measure.py'), join(out, 'shots', `${name}-park-ids.rgba`), `${view.size[0]}x${view.size[1]}`, '--leave', '1400,0,2000,130', '--json', join(out, 'shots', `${name}-park-measure.json`), '--picture', join(out, 'shots', `${name}-park.png`), '--out', join(out, 'shots', `${name}-park-overlay.jpg`)], { encoding: 'utf8' })
    const line = measured.stdout.split('\n').find((l) => l.startsWith('{'))
    r.overlay = line ? JSON.parse(line) : { failed: measured.stderr.slice(-300) }
  }
  results[key] = r
  console.log(key, JSON.stringify(r))
  await context.close()
}
writeFileSync(join(out, 'shots', `${name}.json`), JSON.stringify(results, null, 1))
// The park must still lie on the photograph as #423's landing does (PR 433: 1.0 px median, 3.0 at the 90th), when the
// far model is drawn; and no view may have said a WebGPU error.
const failures = []
const park = results.park?.overlay?.skyline
if (park && !/farreach=0/.test(arg('query', '')) && !(park.median <= 2 && park.p90 <= 4)) failures.push(`park skyline ${park.median} / ${park.p90} px, over 2 / 4`)
for (const [key, r] of Object.entries(results)) if (r.errors.length) failures.push(`${key}: ${r.errors[0]}`)
for (const f of failures) console.log('FAIL', f)
await browser.close()
back?.()
process.exit(failures.length ? 1 : 0)
