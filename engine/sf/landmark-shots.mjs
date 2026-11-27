// Photograph a built realm from fixed world-space cameras. The panel's fixed-poses.json uses the same format.
// node engine/sf/landmark-shots.mjs --dist /path/to/dist-sf --out /path/to/pictures [--place 'Golden Gate Bridge']
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { plain } from '../player/serve.mjs'
import { CHROME, turn } from '../test/kit.mjs'

const { values } = parseArgs({ options: {
  dist: { type: 'string' }, server: { type: 'string' }, out: { type: 'string' },
  poses: { type: 'string' }, place: { type: 'string', multiple: true },
  hour: { type: 'string', default: '14' }
} })
if (!values.out || Boolean(values.dist) === Boolean(values.server)) throw Error('Supply --out and one of --dist or --server')
const poses = JSON.parse(readFileSync(values.poses ?? new URL('./landmark-views.json', import.meta.url), 'utf8'))
const places = values.place ?? Object.keys(poses)
for (const name of places) if (!Object.hasOwn(poses, name)) throw Error(`No fixed camera for ${name}`)
const views = places.flatMap((name) => Object.entries(poses[name]).map(([view, camera]) => {
  if (!Array.isArray(camera) || camera.length !== 5 || !camera.every(Number.isFinite)) throw Error(`Invalid camera at ${name}, ${view}`)
  const file = [name, view].map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).join('--')
  return { name, view, camera, file }
}))
if (!views.length || new Set(views.map((v) => v.file)).size !== views.length) throw Error('Need distinct, named views')

const site = values.dist && await plain(resolve(values.dist))
const base = site?.url ?? values.server
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const back = await turn()
let browser
try {
  browser = await chromium.launch(CHROME)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  // A change to the cell rules can change the picture while every terrain tile keeps its digest.
  let coreHash
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.endsWith('/core.wasm') && r.ok()) {
      coreHash ??= r.body().then((bytes) => createHash('sha256').update(bytes).digest('hex'))
    }
  })
  let pin, runtime
  for (const { name, view, camera, file } of views) {
    coreHash = undefined
    const params = new URLSearchParams({ first: '0', street: '0', people: '0', sound: '0', scale: '1',
      hour: values.hour, fov: '65', at: camera.slice(0, 3).join(','), look: camera.slice(3).join(',') })
    const url = new URL('sf/index.html', base)
    url.search = params.toString()
    await page.goto(url.href, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const e = globalThis.engine
      return e?.seen?.whole && e.world.stats.wanted === 0 && e.world.stats.stale === 0 && e.far?.whole
    }, null, { timeout: 180_000, polling: 250 })
    const { release, tilesFailed, farFailed, eye, forward } = await page.evaluate(async () => {
      const e = globalThis.engine
      e.scale = 1
      const { eye, forward } = e.view()
      return { eye: [...eye], forward: [...forward], release: (await e.tiles.where()).release, tilesFailed: e.tiles.tally.failed, farFailed: e.far.stats.failed }
    })
    const wasm = await coreHash
    if (!release || !wasm || tilesFailed || farFailed || errors.length || (pin && pin !== release) || (runtime && runtime !== wasm)) {
      throw Error(`Incomplete capture at ${name}, ${view}: ${JSON.stringify({ release, wasm, tilesFailed, farFailed, errors })}`)
    }
    pin = release
    runtime = wasm
    await page.addStyleTag({ content: '#hud,#aim,#boom,#tools,#over,#where,#realm,#first,.minimap-root,#minimap,#ui{display:none!important}' })
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    await page.screenshot({ path: join(out, file + '.png') })
    writeFileSync(join(out, file + '.json'), JSON.stringify({ name, view, camera, eye, forward, hour: values.hour, fov: 65, release, wasm }) + '\n')
    console.log(`${name}, ${view}: ${file}.png (${release.slice(0, 12)})`)
  }
} finally {
  await browser?.close()
  back()
  site?.stop()
}
