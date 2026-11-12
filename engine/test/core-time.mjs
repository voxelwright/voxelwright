// Times the core as wasm (#140): how long a sector of the city takes to make, and how big it is.
//   node test/core-time.mjs
import { readFile } from 'node:fs/promises'
const here = new URL('..', import.meta.url).pathname
const { instance } = await WebAssembly.instantiate(await readFile(here + 'page/core.wasm'), {})
const core = instance.exports
const words = () => new Uint32Array(core.memory.buffer)
const ints = () => new Int32Array(core.memory.buffer)
// Somewhere on land: walk x until the ground is well above the sea.
let x = 0
while (core.ground_at(x, 4000) < 100) x += 640
console.log(`land at x ${x}: ground ${core.ground_at(x, 4000)} cells`)
for (const lod of [0, 1, 2, 3, 4, 6, 8]) {
  const size = 64 << lod, sx0 = Math.floor(x / size), sz0 = Math.floor(4000 / size)
  let made = 0, trees = 0, total = 0, ms = 0, spanMs = 0, most = 0, columns = 0
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const t0 = performance.now()
    const at = core.sector_span(sx0 + dx, sz0 + dz, lod) >> 2
    const [lo, hi] = [ints()[at], ints()[at + 1]]
    spanMs += performance.now() - t0
    columns++
    for (let sy = lo; sy <= hi; sy++) {
      core.edits_room(0)
      const t1 = performance.now()
      const n = core.make_sector(sx0 + dx, sy, sz0 + dz, lod)
      ms += performance.now() - t1
      made++
      if (n > 1) { trees++; total += n; most = Math.max(most, n) }
    }
  }
  console.log(`lod ${lod} (cell ${(0.1 * (1 << lod)).toFixed(1)} m): ${columns} columns, span ${(spanMs / columns).toFixed(2)} ms each; ${made} sectors made, ${(ms / made).toFixed(2)} ms each; ${trees} with trees, ${((total * 4) / trees / 1024).toFixed(1)} kB mean, ${((most * 4) / 1024).toFixed(1)} kB most`)
}
