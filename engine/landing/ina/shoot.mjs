// The place as the engine draws it from where the photograph was taken (#423): the picture to lay over the
// photograph, and with it which building every pixel belongs to, for measuring how well the two line up.
//
//   node landing/ina/shoot.mjs [--place ina] [--name round] [--server http://127.0.0.1:5961] [--query "&haze=0.3"] [--out dir]
//                              [--fine 3] [--cells 1] [--eye side,up,along]
//
// `--fine 3` draws three pixels for each of the photograph's stated width (its own size, nearly): for painting the
// place (paint.py), with `--cells 1` which also writes <name>-cells.u32, the cell of the atlas each pixel shows.
// `--eye 2,30,0` stands the eye that many metres to the side, up and along the look: for judging a painted place
// from where the photograph was not taken.
//
// The camera is the place's own (its index says where the photograph's stood). The photograph's frame is a cut of a
// taller picture whose middle is the lens's middle, so that is what is drawn; overlay.py cuts the frame out.
// Writes <out>/<name>-full.png (the page as drawn), <name>-ids.rgba (four bytes a pixel: the building's number in
// three, which way the face looks in the fourth) and <name>.json (sizes, the cut, what was asked).
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome } from '../../test/kit.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'landing', 'ina', 'shots'))
mkdirSync(out, { recursive: true })
const server = arg('server', 'http://127.0.0.1:5961'), place = arg('place', 'ina'), name = arg('name', 'round')
const index = await (await fetch(`${server}/place/${place}/index.json`)).json()
const cam = index.camera
const [width, height] = cam.size

const fine = Number(arg('fine', '1')), moved = arg('eye', '').split(',').filter(Boolean).map(Number)
const browser = await chrome(), page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: fine })).newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)) })
const url = `${server}/city?place=${place}&fly=0&sound=0&people=0&scale=1${arg('query', '')}`
await page.goto(url)
await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0 && globalThis.engine?.spot, null, { timeout: 240_000 })
const began = Date.now()
await page.waitForFunction(() => engine.spot.coming === 0 && engine.world.stats.wanted === 0, null, { timeout: Number(arg('patience', '600000')) })
await page.waitForTimeout(Number(arg('wait', '3000')))
await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where { display: none }' })
if (moved.length === 3) {
  // To the side and along are level with the ground, along the look's own bearing.
  await page.evaluate(([side, up, along]) => { const p = engine.pose, c = Math.cos(p.yaw), s = Math.sin(p.yaw); p.x += c * side + s * along; p.z += s * side - c * along; p.y += up }, moved)
  await page.waitForTimeout(1500)
}
await page.waitForTimeout(300)
await page.screenshot({ path: join(out, `${name}-full.png`) })
const said = await page.evaluate(async (size) => {
  const bytes = await engine.spotIds(size)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { ids: btoa(text), faces: engine.spot.faces, frame: engine.frameMs ?? null }
}, [width, height])
writeFileSync(join(out, `${name}-ids.rgba`), Buffer.from(said.ids, 'base64'))
if (arg('cells', '')) {
  // A number a pixel is too much to send back at once: a band of rows at a time.
  const size = [width * fine, height * fine], parts = []
  for (let from = 0; from < size[1]; from += 256) {
    const text = await page.evaluate(async ({ size, from, to }) => {
      const bytes = new Uint8Array((await engine.spotCells(size, from, to)).buffer)
      let text = ''
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(text)
    }, { size, from, to: Math.min(size[1], from + 256) })
    parts.push(Buffer.from(text, 'base64'))
  }
  writeFileSync(join(out, `${name}-cells.u32`), Buffer.concat(parts))
}
const line = { name, place, size: [width, height], fine, eye: moved, crop: cam.crop, camera: cam, faces: said.faces, loadedMs: Date.now() - began, url }
writeFileSync(join(out, `${name}.json`), JSON.stringify(line, null, 1))
console.log(JSON.stringify(line))
await browser.close()
process.exit(0)
