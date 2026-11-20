// Landmarks in the far model (#450): each landmark of the realm (sf/heroes.json) baked as faces from its rule in the
// core (core/src/heroes.rs `faces`), the rule the world's own cells are made by near the eye. Written as a source
// for pack.mjs, in the far model's faces (20 bytes each, page/far.ts), as landing/ina/heroes.mjs does for the Ina wedge.
//
//   node sf/far/heroes.mjs [--out ~/.village/engine/sf/far/heroes]
//
// A landmark whose far model the Ina wedge already has (`far: "place"`) is not baked again. pack.mjs leaves out the
// lidar's faces wherever a rule owns its place (heroes.rs `owns`), so that the two are never drawn together.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { place } from '../../page/bay.ts'
import { materials, palette } from '../../page/march.ts'
import { arg, here } from '../../test/kit.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'far', 'heroes'))
const core = (await WebAssembly.instantiate(readFileSync(join(here, 'page', 'core.wasm')), {})).instance.exports
const listed = JSON.parse(readFileSync(join(here, 'sf', 'heroes.json'), 'utf8'))
const colours = palette(), stuff = materials()
const byte = (linear) => Math.max(0, Math.min(255, Math.round(255 * linear ** (1 / 2.2))))
/** A block of a landmark is at most this many metres a side (a face's place in a block is 11 bits of cells). */
const BLOCK = 409.6

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const blocks = []
for (const [n, hero] of listed.entries()) {
  if (hero.far === 'place') continue
  const step = hero.step ?? 8, s = step / 10
  const box = [0, 1, 2, 3, 4, 5].map((i) => core.hero_reach(hero.sort, i))
  if (box.some(Number.isNaN)) { console.log(`no rule for ${hero.name}`); continue }
  const at = place(hero.at[0], hero.at[1]), toward = place(hero.toward[0], hero.toward[1])
  const turn = Math.atan2(toward.z - at.z, toward.x - at.x), cos = Math.cos(turn), sin = Math.sin(turn)
  // Every face of a landmark carries one number, past every building's: for measuring and for its windows.
  const id = 900100 + hero.sort
  const rgb = (kind) => {
    const c = kind >> 8, from = c ? colours.subarray(c * 4, c * 4 + 3) : stuff.subarray((kind & 15) * 8, (kind & 15) * 8 + 3)
    return [byte(from[0]), byte(from[1]), byte(from[2])]
  }
  let faces = 0
  const low = [0, 1, 2].map((a) => Math.floor(box[a] / s) * s)
  for (let w = low[2]; w < box[5]; w += BLOCK) for (let u = low[0]; u < box[3]; u += BLOCK) {
    const size = [Math.min(BLOCK, box[3] - u), box[4] - low[1], Math.min(BLOCK, box[5] - w)]
    const from = [u, low[1], w].map((v) => Math.round(v / s)), cells = size.map((v) => Math.min(1023, Math.ceil(v / s - 1e-6)))
    const words = core.hero_faces(hero.sort, step, ...from, ...cells)
    const two = new Uint32Array(core.memory.buffer, core.hero_faces_at(), words).slice()
    if (!two.length) continue
    // A landmark's face is a row of cells one cell high (pieces.ts); the far model's is five words (matte.py `pack`).
    const five = new Uint32Array((two.length / 2) * 5)
    let top = 0
    for (let i = 0; i < two.length; i += 2) {
      const a = two[i], b = two[i + 1]
      const x = a & 1023, y = (a >> 10) & 1023, z = (a >> 20) & 1023, long = b & 255, axis = (b >> 8) & 3, side = (b >> 10) & 1, kind = b >>> 16
      const [r, g, bl] = rgb(kind), mirror = stuff[(kind & 15) * 8 + 5] > 0
      // Its windows by the far model's rule where it is glass a building would have (no style: a landmark draws its own).
      const o = (i / 2) * 5
      let lu = 1, lw = 1, y0, y1, shade = 0
      if (axis === 1) { lu = long; y0 = y1 = (y + side) * step; if (!side) shade = 65535 }
      else if (axis === 2) { lu = long; y0 = y * step; y1 = (y + 1) * step }
      else { lw = long; y0 = y * step; y1 = (y + 1) * step }
      const way = axis === 1 ? 0 : axis === 2 ? 2 : 1
      five[o] = (x | (z << 11) | (lu << 22)) >>> 0
      five[o + 1] = (y0 | (y1 << 16)) >>> 0
      five[o + 2] = (lw | (way << 10) | (side << 12) | (shade << 13)) >>> 0
      five[o + 3] = ((r << 16) | (g << 8) | bl | ((mirror ? 15 : 0) << 24)) >>> 0
      five[o + 4] = id
      top = Math.max(top, y1)
    }
    const file = `hero-${hero.sort}-${blocks.length}.bin`
    writeFileSync(join(out, file), Buffer.from(five.buffer))
    blocks.push({ file, layer: 'hero', name: hero.name, faces: five.length / 5, cell: step, uw: [0, 0],
      pos: [at.x + (u * cos - w * sin) * 10, (hero.foot + low[1]) * 10, at.z + (u * sin + w * cos) * 10],
      size: [cells[0], top + 1, cells[2]], low: 0, c0: [cos, 0, sin], c2: [-sin, 0, cos] })
    faces += five.length / 5
  }
  console.log(`${hero.name}: ${faces} faces in cells of ${s} m`)
}
// Where each rule stands, for pack.mjs to leave the lidar's faces out where the rule owns its place.
const stands = listed.map((h) => { const at = place(h.at[0], h.at[1]), toward = place(h.toward[0], h.toward[1]); return { name: h.name, sort: h.sort, at: [at.x, at.z], turn: Math.atan2(toward.z - at.z, toward.x - at.x), reach: [0, 1, 2, 3, 4, 5].map((i) => core.hero_reach(h.sort, i)) } })
const rules = createHash('sha256').update(readFileSync(join(here, 'core', 'src', 'heroes.rs'))).update(readFileSync(join(here, 'sf', 'heroes.json'))).digest('hex').slice(0, 16)
writeFileSync(join(out, 'index.json'), JSON.stringify({ village: 'far', version: 1, turn: 0, rules, faces: blocks.reduce((n, b) => n + b.faces, 0), blocks, stands, sun: null, credit: "© OpenStreetMap contributors, Overture Maps Foundation (landmarks' outlines); U.S. Geological Survey 3DEP (their feet)" }))
