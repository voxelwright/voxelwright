// Looks closer at one part (blocks/proof): its picture from the kit's WebGL2 renderer, from the engine's, and where
// they differ, as three images side by side. Time is stepped by hand.
//
//   node blocks/proof/look.mjs --part dialog|card-broken|switch [--frames 12] [--dark] [--route own]
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, turn } from '../../test/kit.mjs'

const dir = join(homedir(), '.village', 'engine', 'blocks', 'proof'), part = arg('part', 'dialog'), n = Number(arg('frames', '12'))
mkdirSync(dir, { recursive: true })
await turn()
const browser = await chromium.launch(CHROME), page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
await page.goto(`http://127.0.0.1:${arg('port', '5990')}/blocks/proof/?run=${arg('route', 'own')}&frames=4&brief${has('dark') ? '&dark' : ''}`)
await page.waitForFunction(() => document.documentElement.dataset.done, null, { timeout: 120000 })
const got = await page.evaluate(async ({ part, n }) => {
  const { stage, pair } = globalThis.proof
  stage.manual = true
  let live
  if (part === 'dialog') { const d = document.querySelector('#dlg'); d.showModal(); live = stage.lives.get(d) }
  if (part === 'card-broken') { live = stage.lives.get(document.querySelector('.vx-card')); void live.play('crumble') }
  if (part === 'switch') { live = stage.lives.get(document.querySelector('.vx-switch')); document.querySelector('.vx-toggle input').click() }
  if (part === 'slider') live = stage.lives.get(document.querySelector('.vx-slider'))
  if (part === 'list') live = stage.lives.get(document.querySelector('.vx-list'))
  if (part === 'meter') live = stage.lives.get(document.querySelector('.vx-meter'))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) // the kit sees a new size and makes the part again; no time passes
  if (part === 'dialog') live = stage.lives.get(document.querySelector('#dlg'))
  for (let f = 0; f < n; f++) stage.advance(1 / 60)
  const way = (({ pixelsOff, worst }) => ({ pixelsOff, worst }))(globalThis.proof.against(live))
  const both = pair(live)
  // the three side by side, the third showing in red every pixel that differs by 3 or more
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src })
  const [a, b] = await Promise.all([load(both.kit), load(both.ours)]), w = a.width, h = a.height
  const c = document.createElement('canvas'); c.width = w * 3 + 40; c.height = h
  const x = c.getContext('2d'); x.fillStyle = getComputedStyle(document.documentElement).backgroundColor; x.fillRect(0, 0, c.width, h)
  x.drawImage(a, 0, 0); x.drawImage(b, w + 20, 0)
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tx = t.getContext('2d')
  tx.drawImage(a, 0, 0); const A = tx.getImageData(0, 0, w, h).data; tx.clearRect(0, 0, w, h); tx.drawImage(b, 0, 0); const B = tx.getImageData(0, 0, w, h)
  let off = 0
  for (let i = 0; i < A.length; i += 4) { let d = 0; for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(A[i + k] - B.data[i + k])); if (d > 2) { off++; B.data[i] = 255; B.data[i + 1] = 0; B.data[i + 2] = 60; B.data[i + 3] = 255 } else B.data[i + 3] = Math.round(B.data[i + 3] * 0.35) }
  tx.putImageData(B, 0, 0); x.drawImage(t, 2 * w + 40, 0)
  return { png: c.toDataURL(), off, size: [w, h], way }
}, { part, n })
const file = join(dir, `look-${part}-${n}${has('dark') ? '-dark' : ''}.png`)
writeFileSync(file, Buffer.from(got.png.split(',')[1], 'base64'))
console.log(`${part} after ${n} frames${has('dark') ? ', by night' : ''}: ${got.way.pixelsOff} pixels off of ${got.size[0] * got.size[1]} (worst ${got.way.worst}); kit, ours, difference in ${file}`)
await browser.close()
