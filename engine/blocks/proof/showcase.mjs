// The kit's own showcase drawn by the engine (#430, step 3), every part against the kit's WebGL2 renderer, pixel
// by pixel, by day and by night. Needs `node blocks/serve.mjs --port 5991 --as kit` and `npm run player`.
//
//   node blocks/proof/showcase.mjs [--port 5991] [--only chrome,webkit] [--page showcase/]
//
// Each part is drawn by the engine into its own canvas and read in the same turn; the same frame is then drawn by
// the kit's renderer into a 2D canvas. A pixel is off when any channel differs by 3 of 255 or more. It also keeps
// a picture of the whole page from each renderer.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, browsers, turn } from '../../test/kit.mjs'

const port = arg('port', '5991'), only = arg('only', 'chrome').split(','), where = arg('page', 'showcase/')
const dir = join(homedir(), '.village', 'engine', 'blocks', 'showcase')
mkdirSync(dir, { recursive: true })
await turn()
let failed = false
for (const name of only) {
  const browser = await browsers[name]()
  for (const scheme of ['light', 'dark']) {
    const open = async (query) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme }), page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${port}/${where}${query}`)
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 })
      await page.evaluate(async () => { await (await import('/packages/voxelmorphism/src/index.js')).ready(); await document.fonts.ready })
      await page.waitForTimeout(600)
      return { context, page, errors }
    }
    const ours = await open(''), theirs = await open('?gl')
    const tag = `${name}-${scheme === 'dark' ? 'night' : 'day'}`
    await ours.page.screenshot({ path: join(dir, `${tag}-engine.png`) })
    await theirs.page.screenshot({ path: join(dir, `${tag}-webgl2.png`) })
    for (const sel of ['#kit', '#shelf']) for (const [who, p] of [['engine', ours.page], ['webgl2', theirs.page]]) {
      const el = p.locator(sel).first()
      if (await el.count()) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(400); await p.screenshot({ path: join(dir, `${tag}-${sel.slice(1)}-${who}.png`) }) }
    }
    const said = await ours.page.evaluate(async () => {
      const kit = await import('/packages/voxelmorphism/src/index.js'), { Renderer } = await import('/packages/voxelmorphism/src/core/gl.js')
      const stage = kit.getStage(), r = globalThis.blocks
      if (!stage || !r) return { none: !r ? 'the engine gave no renderer' : 'the kit stayed plain' }
      const frame = () => new Promise((f) => requestAnimationFrame(f))
      // The dialog and the menu are nothing until they are open.
      document.querySelector('#dlg')?.showModal(); await frame(); await frame()
      for (let i = 0; i < 300 && stage.awake.size; i++) await frame()
      const frames = new Map(), draw = r.draw
      r.draw = (f, c) => { frames.set(c, f); return draw(f, c) }
      const ref = new Renderer(), rows = []
      for (const live of stage.lives.values()) {
        if (!live.wpx || !live.hpx || !live.el.isConnected || !live.el.getClientRects().length) continue
        const w = live.wpx, h = live.hpx, was = live.visible
        live.visible = true; live.dirty = true; live.draw(); void r.stage.settle(); live.visible = was
        const read = document.createElement('canvas'); read.width = w; read.height = h
        const rx = read.getContext('2d', { willReadFrequently: true }); rx.drawImage(live.canvas, 0, 0)
        const got = rx.getImageData(0, 0, w, h).data
        const want2 = document.createElement('canvas'); want2.width = w; want2.height = h
        const wx = want2.getContext('2d', { willReadFrequently: true }); ref.draw(frames.get(live.canvas), wx)
        const want = wx.getImageData(0, 0, w, h).data
        let off = 0, worst = 0, filled = 0
        for (let i = 0; i < want.length; i += 4) { let d = 0; for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(want[i + k] - got[i + k])); if (d > 2) off++; worst = Math.max(worst, d); if (got[i + 3]) filled++ }
        rows.push({ part: live.def.name, id: live.el.id || live.el.className.split(' ')[0], cubes: live.capacity, px: w * h, filled, off, worst })
      }
      document.querySelector('#dlg')?.close()
      return { rows, draws: r.stage.stats.draws, faults: r.stage.stats.faults }
    })
    if (said.none) { console.log(`${tag}: ${said.none}`); failed = true }
    else {
      const by = {}
      for (const row of said.rows) { const b = (by[row.part] ??= { parts: 0, cubes: 0, px: 0, off: 0, worst: 0, empty: 0 }); b.parts++; b.cubes += row.cubes; b.px += row.px; b.off += row.off; b.worst = Math.max(b.worst, row.worst); if (!row.filled) b.empty++ }
      console.log(`\n${tag}: ${said.rows.length} parts, ${said.draws} draws by the engine${said.faults.length ? `, faults: ${said.faults.join('; ')}` : ''}${ours.errors.length ? `, page errors: ${ours.errors.join('; ')}` : ''}`)
      console.log('  part        parts   cubes    pixels  off  worst  empty')
      for (const [part, b] of Object.entries(by)) console.log(`  ${part.padEnd(11)} ${String(b.parts).padStart(5)} ${String(b.cubes).padStart(7)} ${String(b.px).padStart(9)} ${String(b.off).padStart(4)} ${String(b.worst).padStart(6)} ${String(b.empty).padStart(6)}`)
      writeFileSync(join(dir, `${tag}.json`), JSON.stringify(said, null, 1))
      if (said.rows.some((r) => !r.filled && r.cubes > 0)) failed = true
    }
    await ours.context.close(); await theirs.context.close()
  }
  await browser.close()
}
console.log(failed ? '\nFAILED' : `\npictures in ${dir}`)
process.exit(failed ? 1 : 0)
