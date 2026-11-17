// A living thing made outside the engine, put on the asker's own shelf (#245): a car from the fast-voxels bench's
// library (a body of 10 cm cells, its motor as tuned in the engine's own solver, its seats and eye, its look in
// cells of 2.5 cm and its cabin in 1.25 cm, what it was asked to do and what was measured) as a reply of cells with
// `living` (make/alive.mjs), kept like anything made (make/library.mjs). Typed on the ask bar, it is then shown as a
// ghost and made at once on Enter, with no model.
//
//   node make/import.mjs ~/.village/engine/fast-voxels/library/bmw_x3.json --twin ~/.village/engine/fast-voxels/out/world/x3_twin.json
//   node make/import.mjs <file> [--twin file] [--shelf dir] [--wish "a bmw x3"]
//
// `--twin`: the bench's twin of the same car, whose cabin's cells the library leaves out (without it the car has its
// outside only). `--shelf`: where it is kept (the asker's own, ~/.village/engine/library, by default). Never into
// make/kept/, which ships with the engine. Kinds are turned back into named materials and colours: one that has no
// name (water, or bits a reply may not set) is refused, as from a model.
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MATERIALS } from './form.mjs'
import { ran, read, written } from './cells.mjs'
import { fieldKeys } from './form.mjs'
import { LIBRARY, SHIPPED, library } from './library.mjs'

const no = (why) => { throw new Error(why) }
/** 16-bit kinds from the bench: base64 of little-endian words, or a list. Every one must be a material and a colour with nothing else set. */
const kinds = (cells, n, what) => {
  let out
  if (typeof cells === 'string') { const b = Buffer.from(cells, 'base64'); out = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) } else if (Array.isArray(cells)) out = Uint16Array.from(cells)
  else no(`${what} has no cells`)
  if (out.length !== n) no(`${what} is ${out.length} cells and its size says ${n}`)
  const named = new Set(Object.values(MATERIALS))
  for (const k of new Set(out)) if (k && (!named.has(k & 15) || (k & 15) === 0 || (k & 0xf0))) no(`${what} has a kind (${k}) that is not a material and a colour`)
  return out
}
/** The numbers of an object, by snake_case names, at most 16. */
const numbers = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => /^[a-z][a-z0-9_]{0,31}$/.test(k) && typeof v === 'number' && Number.isFinite(v)).slice(0, 16))

/** A bench library entry (and its twin, for the cabin) as a reply of cells with `living`: the text, and what it is. */
export function imported(entry, twin) {
  const L = entry.living ?? no('it is not a living build: it has no "living"')
  const body = L.body, size = body?.size
  if (!Array.isArray(size) || size.length !== 3) no('its body has no size')
  const cells = kinds(body.cells, size[0] * size[1] * size[2], 'its body')
  const look = []
  const part = (p, cellsOf, what) => { const k = kinds(cellsOf, p.size[0] * p.size[1] * p.size[2], what); look.push({ size: p.size, per: p.per, low: p.low ?? [0, 0, 0], ...ran(k) }) }
  if (entry.parts?.whole) part(entry.parts.whole, entry.parts.whole.cells, 'its outside')
  const cabin = entry.parts?.cabin
  if (cabin && twin?.cabin) {
    if (twin.cabin.size.join() !== cabin.size.join() || twin.cabin.per !== cabin.per) no(`the twin's cabin (${twin.cabin.size.join('x')}) is not this car's (${cabin.size.join('x')})`)
    part(cabin, twin.cabin.cells, 'its cabin')
  }
  const facts = { ...(entry.asked ? { asked: numbers(entry.asked) } : {}), ...(entry.measured ? { measured: numbers(entry.measured) } : {}) }
  const living = { scheme: 'drive', motor: L.motor, ...(L.seats ? { seats: L.seats } : {}), ...(L.eye ? { eye: L.eye } : {}), ...(look.length ? { look } : {}), ...(Object.keys(facts).length ? { facts } : {}) }
  const name = String(entry.name ?? 'a car').slice(0, 60)
  const text = written({ name, size, cm: 10, cells }, { living })
  // Read as any reply is: what the maker would refuse is refused here.
  const thing = read(text)
  return { text, name, thing, cabin: !!(cabin && twin?.cabin) }
}

/** Keeps it on a shelf, under a wish (by default "a <name>"). Resolves to { wish, name, file, bytes, cabin, cells, look }. */
export async function importTo(file, { twin, shelf = LIBRARY, wish } = {}) {
  if (resolve(shelf) === resolve(SHIPPED)) no('make/kept/ ships with the engine: keep it on your own shelf')
  const entry = JSON.parse(await readFile(file, 'utf8')), tw = twin ? JSON.parse(await readFile(twin, 'utf8')) : null
  const got = imported(entry, tw)
  wish ??= `a ${got.name}`
  const lib = library(shelf, [])
  await lib.keep(wish, '', null, { name: got.name, model: `imported from ${basename(file)}`, fields: fieldKeys(), form: 'cells', grade: 'best', made: got.text, stands: true })
  const kept = (await lib.all()).find((e) => e.wish === wish && e.mine)
  return { wish, name: got.name, file: kept?.file, bytes: got.text.length, cabin: got.cabin, cells: got.thing.filled, look: got.thing.living.look.map((p) => `${p.size.join('x')} per ${p.per}, ${p.filled} filled`) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1] }
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  if (!file) { console.error('node make/import.mjs <a living build from the bench\'s library> [--twin file] [--shelf dir] [--wish words]'); process.exit(2) }
  try {
    const r = await importTo(file, { twin: flag('twin'), shelf: flag('shelf') ?? LIBRARY, wish: flag('wish') })
    console.log(`kept "${r.wish}" (${r.name}): a body of ${r.cells} cells, a look of ${r.look.join(' and ')}${r.cabin ? '' : ' (no cabin: give --twin)'}, ${(r.bytes / 1e6).toFixed(1)} MB, in ${r.file}`)
  } catch (e) { console.error(`not kept: ${e.message}`); process.exit(1) }
}
