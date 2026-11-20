// Cuts the place's far model down to what can be seen (#423). matte.py bakes every face of every column in the
// wedge, eleven million of them: far more than a page should be sent, and most are roofs behind other roofs. The
// page itself says which faces a view can see (page/matte.ts `seen`: each face's number drawn in place of its
// colour); this asks it from the photograph's eye and from eyes round it and over it, and keeps the faces any of
// them saw.
//
//   node landing/ina/cull.mjs [--from ina-all] [--to ina] [--server http://127.0.0.1:5961]
//
// The eyes: the photograph's own, drawn wider than its frame and finer than its pixels; the same a little to
// each side, up and down (someone looks round); and three raised over it, looking down (a flight up and out).
// A flight that goes further than that sees holes, and wants its own eyes added here.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome } from '../../test/kit.mjs'

const home = join(homedir(), '.village', 'engine', 'landing', 'ina', 'home', '.village', 'engine', 'place')
const from = arg('from', 'ina-all'), to = arg('to', 'ina'), server = arg('server', 'http://127.0.0.1:5961')
const index = JSON.parse(readFileSync(join(home, from, 'index.json'), 'utf8'))
const cam = index.camera

// Eyes: metres to the side, up and along the look from the photograph's eye; degrees the look is turned and tipped; the field of view from top to bottom; the picture's size.
const WIDE = [7000, 2800], MID = [4200, 1700]
const eyes = [
  { side: 0, up: 0, along: 0, turn: 0, tip: 0, fov: 33, size: WIDE },
  { side: 2, up: 0, along: 0, turn: 0, tip: 0, fov: 33, size: MID },
  { side: -2, up: 0, along: 0, turn: 0, tip: 0, fov: 33, size: MID },
  { side: 0, up: 1.5, along: 0, turn: 0, tip: 0, fov: 33, size: MID },
  { side: 0, up: -1, along: 0, turn: 0, tip: 0, fov: 33, size: MID },
  { side: 0, up: 0, along: 3, turn: 0, tip: 0, fov: 33, size: MID },
  { side: 0, up: 30, along: 0, turn: 0, tip: -4, fov: 36, size: MID },
  { side: 0, up: 100, along: 0, turn: 0, tip: -12, fov: 40, size: MID },
  { side: 0, up: 250, along: 0, turn: 0, tip: -26, fov: 44, size: MID },
]

const browser = await chrome(), page = await (await browser.newContext({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)) })
await page.goto(`${server}/city?place=${from}&fly=0&sound=0&people=0&scale=0.3&heroes=0`)
await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0 && globalThis.engine?.spot, null, { timeout: 240_000 })
await page.waitForFunction(() => engine.spot.coming === 0, null, { timeout: 900_000 })
const began = Date.now()
const marks = await page.evaluate(async ({ cam, eyes }) => {
  engine.pause(true)
  const rad = Math.PI / 180
  const marks = engine.spot.index.blocks.map((b) => new Uint8Array(b.faces))
  for (const e of eyes) {
    const yaw = (cam.look[0] + e.turn) * rad, pitch = (cam.look[1] + e.tip) * rad, cp = Math.cos(pitch)
    const forward = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp], right = [Math.cos(yaw), 0, Math.sin(yaw)]
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]
    // The eye is moved level with the ground: along the look's own bearing, not down it.
    const ahead = [Math.sin(cam.look[0] * rad), 0, -Math.cos(cam.look[0] * rad)]
    const eye = [0, 1, 2].map((a) => (cam.at[a] + right[a] * e.side + ahead[a] * e.along + (a === 1 ? e.up : 0)) * 10)
    const got = await engine.spot.seen([{ eye, forward, right, up, tanHalf: Math.tan((e.fov * rad) / 2) }], e.size)
    for (let b = 0; b < got.length; b++) for (let i = 0; i < got[b].length; i++) if (got[b][i]) marks[b][i] = 1
  }
  // A byte a face is too much to send back as numbers: eight faces a byte, as text.
  return marks.map((m) => { const bits = new Uint8Array(Math.ceil(m.length / 8)); for (let i = 0; i < m.length; i++) if (m[i]) bits[i >> 3] |= 1 << (i & 7); let text = ''; for (let i = 0; i < bits.length; i += 0x8000) text += String.fromCharCode(...bits.subarray(i, i + 0x8000)); return btoa(text) })
}, { cam, eyes })
await browser.close()

rmSync(join(home, to), { recursive: true, force: true })
mkdirSync(join(home, to), { recursive: true })
const blocks = []
let kept = 0
for (const [n, b] of index.blocks.entries()) {
  const bits = Buffer.from(marks[n], 'base64'), all = readFileSync(join(home, from, b.file)), out = Buffer.alloc(all.length)
  let faces = 0
  for (let i = 0; i < b.faces; i++) if (bits[i >> 3] & (1 << (i & 7))) { all.copy(out, faces * 20, i * 20, i * 20 + 20); faces++ }
  if (!faces) continue
  writeFileSync(join(home, to, b.file), out.subarray(0, faces * 20))
  blocks.push({ ...b, faces })
  kept += faces
}
writeFileSync(join(home, to, 'index.json'), JSON.stringify({ ...index, faces: kept, blocks, seenFrom: eyes }))
const by = {}
for (const b of blocks) by[b.layer] = (by[b.layer] ?? 0) + b.faces
console.log(`${kept} of ${index.faces} faces kept (${(kept * 20 / 1e6).toFixed(1)} MB) in ${blocks.length} blocks, ${Math.round((Date.now() - began) / 1000)} s: ${JSON.stringify(by)}`)
process.exit(0)
