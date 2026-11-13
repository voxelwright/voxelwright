// Stands a kept instrument in a shared world (#247): a few cells for its body and a record whose `sounds` hold its
// voice and the surface it is played by (page/sound/instruments.ts). Walk up to it in the page and press E.
// No model is run: until the making lane's ask returns `sounds` with a thing, this is how one gets there.
//
//   node instrument.mjs piano --world http://127.0.0.1:5764 [--at x,z] [--sounds file.json]   (guitar, ocarina, piano)
//   node instrument.mjs --gone piano-1 --world http://127.0.0.1:5764
import { readFileSync } from 'node:fs'
import { INSTRUMENTS } from './page/sound/instruments.ts'
import { sounds } from './page/sound/patch.ts'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const world = arg('world', 'http://127.0.0.1:5764'), which = process.argv[2]
const post = async (body) => { const r = await fetch(`${world}/world/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'sound', ...body }) }); return { status: r.status, text: await r.text() } }
if (which === '--gone') { console.log(await post({ gone: process.argv[3] })); process.exit(0) }

const kept = INSTRUMENTS.find((i) => i.name === which)
// A file of sounds, or a kept reply of voice.mjs ({wish, tries, sounds}).
const file = arg('sounds', '') ? JSON.parse(readFileSync(arg('sounds'), 'utf8')) : null
const given = file ? ('wish' in file && 'sounds' in file ? file.sounds : file) : kept?.sounds
const read = sounds(given)
if ('refused' in read) { console.error(`not sounds: ${read.refused}`); process.exit(1) }
// What it stands as: a body of wood, with a pale top where it is played. Material and colour as the core has them.
const WOOD = 10 | (36 << 8), PALE = 9 | (1 << 8), BLUE = 9 | (176 << 8)
const [x, z] = (arg('at', '706,4012')).split(',').map(Number)
const ground = (await (await fetch(`${world}/world/at?x=${x}&y=0&z=${z}`)).json()).ground + 1
const size = which === 'ocarina' ? [6, 9, 4] : which === 'guitar' ? [8, 12, 3] : [14, 9, 6], rows = []
for (let dy = 0; dy < size[1]; dy++) for (let dz = 0; dz < size[2]; dz++) {
  const top = dy === size[1] - 1, post = which === 'ocarina' && dy < size[1] - 3
  const x0 = post ? x - 1 : x - (size[0] >> 1), x1 = post ? x + 1 : x - (size[0] >> 1) + size[0]
  if (post && dz !== 1 && dz !== 2) continue
  rows.push(x0, x1, ground + dy, z + dz, which === 'ocarina' && !post ? BLUE : top ? PALE : WOOD)
}
const id = `${which ?? 'instrument'}-${Date.now().toString(36).slice(-4)}`
const made = await post({ edit: [1, rows.length / 5, ...rows], release: [x, ground, z], thing: { id, name: arg('name', which ?? 'instrument'), wish: '', at: [x, ground, z + (size[2] >> 1)], size, facing: 'south' } })
if (made.status >= 300) { console.error(`the world did not take it: ${made.status} ${made.text}`); process.exit(1) }
const voiced = await post({ thing: { id, sounds: given } })
console.log(voiced.status < 300 ? `${id} stands at ${x}, ${ground}, ${z}: open ${world}/city?shared=1&at=${x / 10},${(ground + 16) / 10},${(z + 30) / 10}&look=0,-10 and press E` : `it stands, but its sounds were not taken: ${voiced.status} ${voiced.text}`)
