// A kept living thing as a plain file a static page reads (#450): the shelf's record (make/cells.mjs reads it, with
// its body, motor, seats and look in finer cells) written as living.ts `Making` has it, its cells as runs: a count
// and a kind, both unsigned LEB128, in base64 (`runs`), which the page reads back (main.ts `unrun`). A car's look is
// a few million cells, nearly all air, so this is about 40 times smaller than the cells themselves.
// The page sets it down where the realm says (local.ts `kept`) and it is driven as any living thing is: in the page's
// own solver, with no world's process and no helper.
//
//   node sf/kept.mjs <record.json> <out.json> [--name "red saloon"]
import { readFileSync, writeFileSync } from 'node:fs'
import { read } from '../make/cells.mjs'

const [from, to] = process.argv.slice(2)
const at = process.argv.indexOf('--name'), named = at > 0 ? process.argv[at + 1] : null
if (!from || !to) { console.error('node sf/kept.mjs <record.json> <out.json> [--name words]'); process.exit(1) }
const record = JSON.parse(readFileSync(from, 'utf8'))
const t = read(record.made, { joined: true })
if (!t.living) { console.error(`${from} is not a living thing`); process.exit(1) }
/** Cells as their kinds (`palette`) and runs of the same one: a count and which kind, each unsigned LEB128, the bytes in base64. */
const runs = (values) => {
  const bytes = [], palette = [], which = new Map()
  const leb = (v) => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b) } while (v) }
  for (let i = 0; i < values.length;) {
    let j = i + 1
    while (j < values.length && values[j] === values[i]) j++
    const v = values[i] >>> 0
    if (!which.has(v)) { which.set(v, palette.length); palette.push(v) }
    leb(j - i); leb(which.get(v)); i = j
  }
  return { palette, runs: Buffer.from(bytes).toString('base64') }
}
const look = (t.living.look ?? []).map((f) => ({ size: f.size, per: f.per, low: f.low, ...runs(f.kinds) }))
const making = {
  // A make's name is a trademark: a kept library for visitors says what it is, not whose.
  name: named ?? t.name,
  size: t.size,
  body: runs(t.cells),
  motor: t.living.motor,
  controls: t.living.scheme ?? 'drive',
  ...(t.living.seats ? { seats: t.living.seats } : {}),
  ...(t.living.eye ? { eye: t.living.eye } : {}),
  ...(look.length ? { fine: look } : {}),
}
writeFileSync(to, JSON.stringify(making))
console.log(`${to}: ${making.name}, body ${t.size.join('x')}, ${look.length} parts of look, ${(JSON.stringify(making).length / 1024).toFixed(0)} KB`)
