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

// What edits cost a far copy (#140): --rows N lays N rows of road on the plain as edits of 12,000 rows, and times a
// sector that holds them at each coarseness: told the edits one after another, and told them merged for its column
// (what the page does from the eighth edit on). --wasm file times another build of the core.
const at = process.argv.indexOf('--rows')
if (at > 0) {
  const other = process.argv.indexOf('--wasm')
  const c = other > 0 ? (await WebAssembly.instantiate(await readFile(process.argv[other + 1]), {})).instance.exports : core
  const N = Number(process.argv[at + 1]), X = 45000, Z = 4300, rows = []
  // Strips one cell wide and 40 long, side by side and end to end, on the ground: a paved square.
  const wide = Math.ceil(Math.sqrt(N / 40)) * 40
  for (let i = 0; rows.length < N; i++) { const x = X + (i * 40) % wide, z = Z + Math.floor((i * 40) / wide); rows.push([x, x + 40, c.feet_at(x, z), z, 6]) }
  rows.sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
  const edits = []
  for (let i = 0; i < rows.length; i += 12000) { const part = rows.slice(i, i + 12000); edits.push(1, part.length, ...part.flat()) }
  const tell = (list) => { const room = c.edits_room(list.length); new Int32Array(c.memory.buffer, room, list.length).set(list) }
  const time = (run) => { const all = []; for (let i = 0; i < 9; i++) { const t = performance.now(); run(); all.push(performance.now() - t) } return all.sort((a, b) => a - b)[4] }
  console.log(`${N} rows in ${edits.length / 12000 | 0 || 1} edits, a square ${wide / 10} m wide`)
  for (const lod of [0, 1, 2, 3, 4, 6, 8]) {
    const size = 64 << lod, sx = Math.floor(X / size), sy = Math.floor(c.feet_at(X, Z) / size), sz = Math.floor(Z / size)
    tell([]); const bare = time(() => c.make_sector(sx, sy, sz, lod))
    tell(edits); const each = time(() => c.make_sector(sx, sy, sz, lod))
    const merge = time(() => { tell(edits); c.merge_rows(lod, sx * size, (sx + 1) * size, sz * size, (sz + 1) * size) })
    tell(edits); const n = c.merge_rows(lod, sx * size, (sx + 1) * size, sz * size, (sz + 1) * size)
    const merged = Array.from(new Int32Array(c.memory.buffer, c.merged_words(), n))
    tell(merged); const once = time(() => c.make_sector(sx, sy, sz, lod))
    // And with one small edit after the merged ones: what every sector of the column costs while something goes on there.
    const more = [...merged, 1, 1, X + 3, X + 9, c.feet_at(X + 3, Z + 3) + 2, Z + 3, 8]
    tell(more); const after = time(() => c.make_sector(sx, sy, sz, lod))
    console.log(`lod ${lod}: no edits ${bare.toFixed(2)} ms; edits one after another ${each.toFixed(2)} ms; merging them ${merge.toFixed(2)} ms into ${((n - 2) / 5) | 0} rows; made from the merged ${once.toFixed(2)} ms, and with one edit more ${after.toFixed(2)} ms`)
  }
}

// What a street coming down costs a far copy (#140): --ruin lays 400 edits round the street by the yard, one in four
// a blast and the rest 150 rows each (half emptying what stood, half putting rubble down), and times a sector there
// at each coarseness as the page tells it: the blasts, then all the rows merged (`tidy`), and unmerged. (--before: each run of rows
// between two blasts merged, as the page did before.)
if (process.argv.includes('--ruin')) {
  const other = process.argv.indexOf('--wasm')
  const c = other > 0 ? (await WebAssembly.instantiate(await readFile(process.argv[other + 1]), {})).instance.exports : core
  const X = 760, Z = 4062, list = []
  let seed = 7
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n }
  for (let e = 0; e < 400; e++) {
    const x = X - 200 + rnd(400), z = Z - 200 + rnd(400), g = c.ground_at(x, z)
    if (e % 4 === 0) { list.push([0, x, g + 10 + rnd(60), z, 16, 0]); continue }
    const rows = []
    for (let i = 0; i < 150; i++) { const up = i < 75, rx = x + rnd(60), rz = z + rnd(60); rows.push([rx, rx + 1 + rnd(12), up ? g + 1 + rnd(90) : c.ground_at(rx, rz) + 1 + rnd(6), rz, up ? 0 : 8 + 256 * 16]) }
    rows.sort((a, b) => a[2] - b[2] || a[3] - b[3] || a[0] - b[0])
    list.push([1, rows.length, ...rows.flat()])
  }
  const tell = (words) => { const room = c.edits_room(words.length); new Int32Array(c.memory.buffer, room, words.length).set(words) }
  const time = (run) => { const all = []; for (let i = 0; i < 9; i++) { const t = performance.now(); run(); all.push(performance.now() - t) } return all.sort((a, b) => a - b)[4] }
  console.log('a street coming down: 400 edits, 100 blasts, 45,000 rows')
  for (const lod of [0, 1, 2, 3, 4, 6, 8]) {
    const size = 64 << lod, sx = Math.floor(X / size), sy = Math.floor(c.ground_at(X, Z) / size), sz = Math.floor(Z / size)
    const tidy = () => { tell(list.flat()); const n = c.merge_rows(lod, sx * size, (sx + 1) * size, sz * size, (sz + 1) * size); return [...list.filter((e) => e[0] === 0), Array.from(new Int32Array(c.memory.buffer, c.merged_words(), n))] }
    const tidied = tidy().flat(), raw = list.flat()
    tell([]); const bare = time(() => c.make_sector(sx, sy, sz, lod))
    tell(raw); const each = time(() => c.make_sector(sx, sy, sz, lod))
    const merging = time(tidy)
    tell(tidied); const once = time(() => c.make_sector(sx, sy, sz, lod))
    // Eight more edits after the column was tidied (two blasts, six of rows): the sector as it is told meanwhile, and tidying again.
    const more = [...tidy(), ...list.slice(0, 8).map((e) => e[0] === 0 ? [0, e[1] + 30, e[2], e[3] + 30, e[4], 0] : e.map((v, i) => i > 1 && (i - 2) % 5 < 2 ? v + 30 : v))]
    tell(more.flat()); const meanwhile = time(() => c.make_sector(sx, sy, sz, lod))
    const again = time(() => { tell(more.flat()); c.merge_rows(lod, sx * size, (sx + 1) * size, sz * size, (sz + 1) * size) })
    console.log(`lod ${lod}: no edits ${bare.toFixed(2)} ms; unmerged ${each.toFixed(2)} ms; merging ${merging.toFixed(2)} ms into ${(tidied.length * 4 / 1024).toFixed(0)} kB; from the merged ${once.toFixed(2)} ms; with eight edits more ${meanwhile.toFixed(2)} ms, merging those in ${again.toFixed(2)} ms`)
  }
}
