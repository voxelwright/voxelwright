// What the kit's renderer on the engine costs (#430, step 5): bytes as a host would send them, how long until the
// page stage can draw, and what a browser with no WebGPU gets. Needs `npm run player` and
// `node blocks/serve.mjs --port 5991 --as kit`.
//
//   node blocks/proof/cost.mjs [--only chrome,webkit] [--port 5991]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { arg, browsers, here, quiet } from '../../test/kit.mjs'

const port = arg('port', '5991'), only = arg('only', 'chrome,webkit').split(',')
const weigh = (files) => { let raw = 0, gz = 0, br = 0; for (const f of files) { const b = readFileSync(f); raw += b.length; gz += gzipSync(b, { level: 9 }).length; br += brotliCompressSync(b).length } return `${(raw / 1024).toFixed(1)} KB as written, ${(gz / 1024).toFixed(1)} gzip, ${(br / 1024).toFixed(1)} brotli` }
const dist = (...names) => names.map((n) => join(here, 'dist', n))
console.log(`the kit's renderer on the engine (renderer, stage, pass, gpu): ${weigh(dist('blocks/renderer.js', 'blocks/stage.js', 'blocks/pass.js', 'probe/gpu.js'))}`)
console.log(`  of which the block pass: ${weigh(dist('blocks/pass.js'))}`)
console.log(`standing parts in the world, more (world.js): ${weigh(dist('blocks/world.js'))}`)
console.log(`the kit's WebGL2 renderer it replaces (gl.js): ${weigh([join(arg('kit', join(homedir(), 'Developer', 'plant-a-seed')), 'packages/voxelmorphism/src/core/gl.js')])}`)

// Its timings are quoted: no other thread's check may draw beside it (test/kit.mjs).
const back = await quiet()
const middle = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
for (const name of only) {
  // ── Start-up: a browser just started each time, the stage asked for at once ──
  const ready = [], first = []
  for (let i = 0; i < 5; i++) {
    const browser = await browsers[name](), page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage()
    await page.goto(`http://127.0.0.1:${port}/showcase/seam.html?gl`)
    const t = await page.evaluate(async () => {
      const { pageStage } = await import('/engine/blocks/stage.js'), { LIGHTS } = await import('/packages/voxelmorphism/src/core/materials.js'), a = performance.now()
      const stage = await pageStage(), b = performance.now()
      if (!stage) return null
      // one part: a cube, into a canvas in the page
      const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }); document.body.append(canvas)
      stage.put({ pos: new Float32Array([4.5, 4.5, 0.5, 1, 0, 0, 0, 1]), col: new Float32Array([0.055, 0.133, 1, 0]), ao: new Uint32Array(2), count: 1, wpx: 128, hpx: 128, ox: 32, oy: 32, s: 8, bounds: [-4, -4, 12, 12], light: LIGHTS.day, shear: [0.5, 0.5] }, canvas)
      await stage.settle()
      return { ready: b - a, first: performance.now() - a }
    })
    if (t) { ready.push(t.ready); first.push(t.first) }
    await browser.close()
  }
  console.log(`\n${name}: the page stage ready in ${middle(ready)?.toFixed(0)} ms (${ready.map((n) => n.toFixed(0)).join(', ')}); a first part drawn and done by the GPU ${middle(first)?.toFixed(0)} ms after it was asked for (${first.map((n) => n.toFixed(0)).join(', ')})`)

  // ── No WebGPU, and no adapter: the kit's showcase, handed the engine's renderer ──
  const browser = await browsers[name]()
  for (const [what, init] of [['no navigator.gpu', () => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined })], ['no adapter', () => { if (navigator.gpu) navigator.gpu.requestAdapter = async () => null }]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }), page = await context.newPage()
    await page.addInitScript(init)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${port}/showcase/`)
    const said = await page.evaluate(async () => { const kit = await import('/packages/voxelmorphism/src/index.js'); const stage = await kit.ready(); await new Promise((r) => setTimeout(r, 400)); return { stage: !!stage, plain: kit.plain(), live: document.querySelectorAll('[data-vx-live]').length, canvases: document.querySelectorAll('canvas.vx-canvas').length, button: getComputedStyle(document.querySelector('.vx-button')).backgroundColor } })
    await page.screenshot({ path: join(homedir(), '.village', 'engine', 'blocks', 'showcase', `${name}-${what.replace(/\W+/g, '-')}.png`) })
    console.log(`${name}, ${what}: ${said.plain && !said.stage && said.live === 0 ? 'the page is plain CSS' : 'NOT PLAIN'} (${JSON.stringify(said)})${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`)
    await context.close()
  }
  await browser.close()
}
back()
