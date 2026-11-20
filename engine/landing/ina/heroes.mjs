// Landmarks in the place's far model (#423). The lidar sees a glass tower as its roof and a scatter of returns down
// its sides, and a bridge as a tent under its cables: both have a rule in the core (heroes.rs, PR 428) that says
// their shape better. This asks the core for a landmark's outside faces, as the page's own far models are asked
// for, and writes them as blocks of the place (page/matte.ts reads them): so the place is drawn by one pass, from
// plain files, and each landmark is measured against the photograph like any other building.
//
//   node landing/ina/heroes.mjs [--place ina-all]
//
// Run after matte.py (which writes the place's index and leaves the lidar's own columns out where a landmark's
// box is: it reads the boxes this writes to DATA/hero-boxes.json) and before cull.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { place } from '../../page/bay.ts'
import { materials, palette } from '../../page/march.ts'
import { arg, here } from '../../test/kit.mjs'

const lane = join(homedir(), '.village', 'engine', 'landing', 'ina')
const dir = join(lane, 'home', '.village', 'engine', 'place', arg('place', 'ina-all'))
// Which landmarks, the cells they are made in (10 cm each: 8 is 0.8 m, a pixel at 1.6 km), whether the lidar's
// columns are left out under them, and the number their faces carry (a named building's, or one past them all).
const WANTED = [
  { name: 'Salesforce Tower', step: 8, clear: true },
  { name: 'Bay Bridge, western span', step: 16, clear: false, id: 900004 },
]
const BLOCK = 409.6

const core = (await WebAssembly.instantiate(readFileSync(join(here, 'page', 'core.wasm')), {})).instance.exports
const listed = JSON.parse(readFileSync(join(here, 'bay', 'heroes.json'), 'utf8'))
const table = existsSync(join(lane, 'data', 'buildings.json')) ? JSON.parse(readFileSync(join(lane, 'data', 'buildings.json'), 'utf8')) : []
const colours = palette(), stuff = materials()
const byte = (linear) => Math.max(0, Math.min(255, Math.round(255 * linear ** (1 / 2.2))))

const boxes = [], blocks = []
for (const want of WANTED) {
  const hero = listed.find((h) => h.name === want.name)
  if (!hero) { console.log('no such landmark:', want.name); continue }
  const box = [0, 1, 2, 3, 4, 5].map((i) => core.hero_reach(hero.sort, i))
  const at = place(hero.at[0], hero.at[1]), toward = place(hero.toward[0], hero.toward[1])
  const turn = Math.atan2(toward.z - at.z, toward.x - at.x), cos = Math.cos(turn), sin = Math.sin(turn)
  const id = want.id ?? table.find((b) => b.name === want.name)?.id ?? 900000 + hero.sort
  // A landmark's own paint (heroes.json `colours`) over the palette's.
  const own = new Map(Object.entries(hero.colours ?? {}).map(([i, hex]) => [Number(i), [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))]))
  const rgb = (kind) => {
    const c = kind >> 8
    if (c && own.has(c)) return own.get(c)
    const from = c ? colours.subarray(c * 4, c * 4 + 3) : stuff.subarray((kind & 15) * 8, (kind & 15) * 8 + 3)
    return [byte(from[0]), byte(from[1]), byte(from[2])]
  }
  const s = want.step / 10
  const low = [0, 1, 2].map((a) => Math.floor(box[a] / 12.8) * 12.8)
  let faces = 0
  for (let w = low[2]; w < box[5]; w += BLOCK) for (let u = low[0]; u < box[3]; u += BLOCK) {
    const size = [Math.min(BLOCK, box[3] - u), box[4] - low[1], Math.min(BLOCK, box[5] - w)]
    const from = [u, low[1], w].map((v) => Math.round(v / s)), cells = size.map((v) => Math.min(1023, Math.ceil(v / s - 1e-6)))
    const words = core.hero_faces(hero.sort, want.step, ...from, ...cells)
    const hero_faces = new Uint32Array(core.memory.buffer, core.hero_faces_at(), words).slice()
    if (!hero_faces.length) continue
    // A landmark's face is a row of cells one cell high; the place's is five words (matte.py `pack`).
    const out = new Uint32Array((hero_faces.length / 2) * 5)
    let top = 0
    for (let i = 0; i < hero_faces.length; i += 2) {
      const a = hero_faces[i], b = hero_faces[i + 1]
      const x = a & 1023, y = (a >> 10) & 1023, z = (a >> 20) & 1023, long = b & 255, axis = (b >> 8) & 3, side = (b >> 10) & 1, kind = b >>> 16
      const [r, g, bl] = rgb(kind), mirror = stuff[(kind & 15) * 8 + 5] > 0
      const o = (i / 2) * 5
      let lu = 1, lw = 1, y0, y1, way, shade = 0
      if (axis === 1) { lu = long; y0 = y1 = (y + side) * want.step; way = 0; if (!side) shade = 65535 }  // a face that looks down is never in the sun
      else if (axis === 2) { lu = long; y0 = y * want.step; y1 = (y + 1) * want.step; way = 2 }
      else { lw = long; y0 = y * want.step; y1 = (y + 1) * want.step; way = 1 }
      out[o] = (x | (z << 11) | (lu << 22)) >>> 0
      out[o + 1] = (y0 | (y1 << 16)) >>> 0
      out[o + 2] = (lw | (way << 10) | (side << 12) | (shade << 13)) >>> 0
      out[o + 3] = (((r << 16) | (g << 8) | bl) | ((mirror ? 15 : 0) << 24)) >>> 0
      out[o + 4] = id
      top = Math.max(top, y1)
    }
    const file = `hero-${hero.sort}-${blocks.length}.bin`
    writeFileSync(join(dir, file), Buffer.from(out.buffer))
    blocks.push({ file, layer: 'hero', faces: out.length / 5, cell: want.step, uw: [0, 0],
      pos: [at.x + (u * cos - w * sin) * 10, (hero.foot + low[1]) * 10, at.z + (u * sin + w * cos) * 10],
      size: [cells[0], top + 1, cells[2]], low: 0, c0: [cos, 0, sin], c2: [-sin, 0, cos] })
    faces += out.length / 5
  }
  // The landmark's box on the ground, as four corners in the engine's cells of 10 cm: what the lidar's columns are left out of.
  if (want.clear) boxes.push({ name: want.name, corners: [[box[0], box[2]], [box[3], box[2]], [box[3], box[5]], [box[0], box[5]]].map(([u, w]) => [at.x + (u * cos - w * sin) * 10, at.z + (u * sin + w * cos) * 10]) })
  console.log(`${want.name}: ${faces} faces in cells of ${s} m, numbered ${id}`)
}
writeFileSync(join(lane, 'data', 'hero-boxes.json'), JSON.stringify(boxes))
if (existsSync(join(dir, 'index.json'))) {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  index.blocks = [...index.blocks.filter((b) => b.layer !== 'hero'), ...blocks]
  index.faces = index.blocks.reduce((n, b) => n + b.faces, 0)
  index.credit = index.credit.includes('OpenStreetMap') ? index.credit : `${index.credit}; © OpenStreetMap contributors, Overture Maps Foundation (landmarks' outlines)`
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index))
}
