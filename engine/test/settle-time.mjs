// Times the core's settling as wasm (#140): a house front blasted out, and how long it takes to say what falls.
//   node test/settle-time.mjs
import { readFile } from 'node:fs/promises'
const here = new URL('..', import.meta.url).pathname
const core = (await WebAssembly.instantiate(await readFile(here + 'page/core.wasm'), {})).instance.exports
let x = 700
while (core.ground_at(x, 4070) < 120) x += 1280
// A house front on the street's edge, and blasts along its ground floor.
const z = 4150, hx = x - (x % 1280) + 140 + 76 * 4 + 38, y = core.ground_at(hx, z) + 14
const balls = []
for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) balls.push(0, hx - 40 + i * 20, y, z + j * 30, 16, 0)
const at = core.edits_room(balls.length)
new Int32Array(core.memory.buffer, at, balls.length).set(balls)
for (let turn = 0; turn < 3; turn++) {
  const t0 = performance.now()
  const n = core.settle_round(hx, y, z)
  const ms = performance.now() - t0
  const words = new Int32Array(core.memory.buffer, core.settled_words(), n)
  let cells = 0, faces = 0, runs = 0, i = 2
  for (let m = 0; m < words[0]; m++) { cells += words[i + 2]; runs += words[i + 9]; faces += words[i + 10]; i += 11 + words[i + 9] * 5 + words[i + 10] * 2 }
  console.log(`settle: ${ms.toFixed(0)} ms, ${words[0]} pieces, ${cells} cells, ${runs} rows, ${faces} faces, ${words[1]} crumbs, ${(n * 4 / 1024).toFixed(0)} kB to tell it; memory ${(core.memory.buffer.byteLength / 1048576).toFixed(0)} MB`)
}
