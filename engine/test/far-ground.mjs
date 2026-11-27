// node test/far-ground.mjs [--gpu] [--partial path/to/one-square/far.json] [--legacy path/to/manifest.json]
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, has, start } from './kit.mjs'
import { World, SIDE } from '../page/world.ts'
import { grounded } from '../page/far.ts'

const legacy = arg('legacy', null), partial = arg('partial', null)
const listing = (file) => { const r = JSON.parse(readFileSync(file)); return r.far ?? r }
const tile = (x, z) => `${Math.floor(x / 5000)}_${Math.floor(z / 5000)}`
const outside = tile(487424, 657408)
// Exercise the packer with the real survey frame and a single top face from each side of x=485000.
const dir = mkdtempSync(join(tmpdir(), 'far-ground-'))
const square = (key, xs) => {
  const home = join(dir, 'squares', key)
  mkdirSync(home, { recursive: true })
  const blocks = xs.map((x) => {
    const file = x + '.bin'
    writeFileSync(join(home, file), Buffer.from(new Uint32Array([1 << 22, 20 << 16, 1, 0, 0]).buffer))
    return { file, layer: 'ground', faces: 1, pos: [x, 0, 657000], size: [1, 1, 1], cell: 10 }
  })
  writeFileSync(join(home, 'index.json'), JSON.stringify({ square: key, blocks }))
}
const pack = () => {
  execFileSync(process.execPath, [new URL('../sf/far/pack.mjs', import.meta.url).pathname,
    '--squares', join(dir, 'squares'), '--heroes', join(dir, 'none'), '--place', join(dir, 'none'), '--out', join(dir, 'out')])
  return listing(join(dir, 'out', 'far.json'))
}
let patch, joined
try {
  square('547.7_4183.5', [483500, 486900])
  patch = partial ? listing(partial) : pack()
  square('548.7_4183.5', [487200])
  joined = pack()
} finally { rmSync(dir, { recursive: true, force: true }) }
const bridge = [125, 126, 127, 128].map((z) => '91_' + z)
const old = legacy ? listing(legacy) : { size: 5000, tiles: Object.fromEntries(bridge.map((k) => [k, [true]])) }
const results = []
const check = (ok, label) => { results.push(ok); console.log(`  ${ok ? 'ok' : 'FAIL'} ${label}`) }
check(outside in patch.tiles && !grounded(patch).has(outside), '547.7_4183.5 ends at 487000; the loaded tile at 487424 cannot replace coarse ground')
check(grounded(patch).has('96_131'), 'the tile fully inside the survey can replace coarse ground')
check(grounded(joined).has(outside), 'the neighboring survey square completes the tile across the seam')
check(bridge.every((k) => k in old.tiles && !grounded(old).has(k)), 'the four legacy bridge tiles keep ground under the deck')

// A 404 can occur after the world has scheduled this column. Its fallback must actually reach the worker.
globalThis.GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8, UNIFORM: 64 }
const sent = []
globalThis.Worker = class { postMessage(m) { if ('sx' in m) sent.push(m) } terminate() {} }
const device = { createBuffer: () => ({}), queue: { writeBuffer() {} } }
const world = new World(device, { grid: [4, 4, 4], levels: 2, poolWords: 1 << 16, workers: 32 })
world.farFrom = 1
// Exercise the frozen world's former listing-based optimization when running this check against it.
if ('farDraws' in world) world.farDraws = () => true
world.update([480100, 40, 657000])
check(sent.some((m) => m.level === 1 && m.sx === Math.floor(480100 / (2 * SIDE)) && m.sz === Math.floor(657000 / (2 * SIDE))), 'requested the central coarse column even with listed far geometry')

// Surveyed far-model ground skips redundant coarse tile fetches while streaming uncovered ground, and `refreshFar` streams fallback cells immediately if a far tile 404s.
const sentCovered = []
globalThis.Worker = class { postMessage(m) { if ('sx' in m) sentCovered.push(m) } terminate() {} }
const wCovered = new World(device, { grid: [4, 4, 4], levels: 2, poolWords: 1 << 16, workers: 32 })
wCovered.farFrom = 1
const cx = Math.floor(480100 / (2 * SIDE)), cz = Math.floor(657000 / (2 * SIDE))
let centerCovered = true
wCovered.farCovered = (x0, z0, x1, z1) => centerCovered && x0 === cx * 2 * SIDE && z0 === cz * 2 * SIDE && x1 === (cx + 1) * 2 * SIDE && z1 === (cz + 1) * 2 * SIDE
wCovered.update([480100, 40, 657000])
check(!sentCovered.some((m) => m.level === 1 && m.sx === cx && m.sz === cz), 'skipped a coarse column wholly covered by surveyed far ground')
check(sentCovered.some((m) => m.level === 1 && (m.sx !== cx || m.sz !== cz)), 'still streamed coarse columns outside surveyed far ground')
centerCovered = false
wCovered.refreshFar(cx * 2 * SIDE, cz * 2 * SIDE, (cx + 1) * 2 * SIDE, (cz + 1) * 2 * SIDE)
wCovered.update([480100, 40, 657000])
check(sentCovered.some((m) => m.level === 1 && m.sx === cx && m.sz === cz), 'refreshFar streamed the fallback coarse column after a far-tile failure')

const supplied = arg('far', null)
if (supplied) {
  const ground = grounded(listing(supplied))
  check(!ground.has(tile(451360, 614800)), 'the supplied listing leaves Wolfback Ridge to the cells')
  check(bridge.every((k) => !ground.has(k)), 'the supplied listing leaves ground under the north span to the cells')
}

if (has('gpu')) {
  const kit = await start()
  try {
    const page = await kit.page()
    await page.route('**/probe-ground', (r) => r.fulfill({ contentType: 'text/html', body: '' }))
    // One wall of the far model, 16 cells behind a coarse wall that stands in its place.
    const section = { layer: 'far', pos: [80, 0, 0], lo: [80, 0, 0], hi: [81, 64, 64], cell: 1,
      c0: [1, 0, 0], c2: [0, 0, 1], start: 0, count: 1, runs: [{ way: 2, start: 0, count: 1, lods: [1] }] }
    const head = Buffer.from(JSON.stringify({ sections: [section], grouped: false }))
    const body = Buffer.alloc(8 + head.length + 20)
    body.write('FAR1'); body.writeUInt32LE(head.length, 4); head.copy(body, 8)
    const at = 8 + head.length
    body.writeUInt32LE(64 << 16, at + 4)
    body.writeUInt32LE(64 | (1 << 10), at + 8)
    body.writeUInt32LE(123456, at + 16)
    await page.route('**/fixture/*.json', (r) => r.fulfill({ json: { size: 64, bands: [0], lods: [0], ground: ['1_0'],
      tiles: { '1_0': [{ path: r.request().url().endsWith('/ok.json') ? 'wall.far' : 'missing.far' }] } } }))
    await page.route('**/fixture/wall.far', (r) => r.fulfill({ body }))
    await page.route('**/fixture/missing.far', (r) => r.fulfill({ status: 404, body: '' }))
    await page.goto(kit.url + '/probe-ground')
    const hits = await page.evaluate(async () => {
      const { World } = await import('/page/world.ts'), { marcher } = await import('/page/march.ts')
      const device = await (await navigator.gpu.requestAdapter()).requestDevice()
      const world = new World(device, { grid: [8, 4, 4], levels: 1, poolWords: 4096, workers: 0 })
      const view = { eye: [8, 32, 32], forward: [1, 0, 0], up: [0, 1, 0], right: [0, 0, 1], tanHalf: 0.1 }
      world.update(view.eye)
      const level = world.levels[0]
      level.state.fill(3)
      level.show(level.slot(1, 0, 0), 0x80000008, 64)
      level.show(level.slot(3, 0, 0), 0x80000007, 64)
      world.update(view.eye)
      const march = await marcher(device, 'rgba8unorm', world)
      const first = await march.pick(view)
      const cover = new Uint32Array(128)
      cover[0] = 1 << 1
      march.farCover([0, 0], 64, 1, cover)
      const behind = await march.pick(view)
      march.farCover([0, 0], 64, 1, cover, null, null, [[96, 0, 0, 112, 64, 64]])
      const edited = await march.pick(view)
      const { far } = await import('/page/far.ts'), { offscreen } = await import('/probe/gpu.ts')
      const to = offscreen({ device, format: 'rgba8unorm' }, [1, 1])
      const pixel = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const scene = async (name) => {
        const model = await far(device, 'rgba8unorm', march, new URL('/fixture/' + name + '.json', location.href).href)
        model.reach = 0.1
        const fallbacks = []
        model.onFallback = (x0, z0, x1, z1) => fallbacks.push([x0, z0, x1, z1])
        const coveredBefore = model.covers(64, 0, 128, 64)
        const draw = () => {
          const encoder = device.createCommandEncoder()
          march.draw(encoder, to, view, 0, 0)
          model.drawIds(encoder, to.color, to.depth, to.size, view)
          encoder.copyTextureToBuffer({ texture: to.texture }, { buffer: pixel }, to.size)
          device.queue.submit([encoder.finish()])
        }
        draw()
        while (model.stats.coming) await new Promise((r) => setTimeout(r, 10))
        draw(); draw()
        await pixel.mapAsync(GPUMapMode.READ)
        const [r, g, b] = new Uint8Array(pixel.getMappedRange())
        pixel.unmap()
        return { id: r + (g << 8) + (b << 16), cell: await march.pick(view), failed: model.stats.failed, coveredBefore, coveredAfter: model.covers(64, 0, 128, 64), fallbacks }
      }
      return { first, behind, edited, ok: await scene('ok'), missing: await scene('404') }
    })
    check(hits.first?.t === 56 && hits.first.material === 8, `front wall drawn at 56 cells: ${JSON.stringify(hits.first)}`)
    check(hits.behind?.t === 184 && hits.behind.material === 7, `uncovered hill behind held tile drawn at 184 cells: ${JSON.stringify(hits.behind)}`)
    check(hits.edited?.t === 88 && hits.edited.material === 8, `edit inside the covered tile drawn at 88 cells: ${JSON.stringify(hits.edited)}`)
    check(hits.ok.id === 123456 && hits.ok.cell?.material === 7 && hits.ok.coveredBefore && hits.ok.coveredAfter && hits.ok.fallbacks.length === 0, `packed wall ID and hill behind it: ${JSON.stringify(hits.ok)}`)
    check(hits.missing.id === 0 && hits.missing.failed === 1 && hits.missing.cell?.material === 8 && hits.missing.coveredBefore && !hits.missing.coveredAfter && hits.missing.fallbacks.length === 1, `404 draws the fallback wall and triggers onFallback: ${JSON.stringify(hits.missing)}`)
  } catch (e) {
    kit.failures.push(String(e))
  } finally { await kit.finish('far-ground', results.every(Boolean) ? 0 : 1, results.every(Boolean) ? 'ok' : 'failed') }
}
process.exit(results.every(Boolean) ? 0 : 1)
